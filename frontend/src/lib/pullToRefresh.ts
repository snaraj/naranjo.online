/* Pull-to-refresh: the arithmetic, kept out of the component exactly as
 * lib/tooltip.ts and lib/gesture.ts are, so the behaviour is executable by a
 * test rather than inferred from markup.
 *
 * `overscroll-behavior-y: none` ON html AND body STAYS. It suppressed the
 * BROWSER'S own pull-to-refresh at issue 187, where the owner reported the
 * page left "stuck dragged-down" on iOS Safari — the native rubber-band
 * overshoot never settled flush and the document stayed translated below its
 * own top edge. Removing it reintroduces that exactly. It is also what makes
 * this implementation possible rather than what it fights: with the native
 * boundary effect suppressed, no browser animation competes for the same drag,
 * so the offset below is the only thing moving the surface and the settle is
 * ours to guarantee.
 *
 * THE FOUR RULES THIS OWES.
 *
 *   - It engages ONLY at the top. A drag that begins with the document
 *     scrolled is the page's, and is never claimed.
 *   - It never claims a gesture before proving it is a downward pull, so a
 *     reader flicking upward from the top scrolls, and a horizontal gesture
 *     inside the page reaches whatever it was for.
 *   - It ALWAYS returns to zero. Every exit — committed, abandoned, or
 *     cancelled by the browser — runs through the same settle, because a
 *     surface left displaced is the original defect.
 *   - AND IT IS LEGIBLE (owner report, 2026-08-28: "pull to refresh feels
 *     broken"). A gesture whose whole visible life is shorter than its own
 *     settle animation has not communicated anything; the reader sees a
 *     flicker and concludes the site ignored them. So the refreshing hold has
 *     a MINIMUM dwell and ends in a brief acknowledgement — see PullMetrics
 *     and refreshCycle. This adds no delay to the reader's data, which has
 *     already landed by then; it adds the time it takes to see that it did.
 */

import { claimsHorizontal, frameCoalescer, gestureSlop, rubberBand, type FrameView } from './gesture.ts';

/* How far the surface may ever travel, how far it must travel to arm, and how
 * long the reader is shown the answer. The distances are absolute pixels
 * rather than ratios — a pull is a thumb's reach, and a thumb is the same size
 * on a phone and a tablet — and the durations are absolute milliseconds for
 * the same kind of reason: they are about human perception, not about layout. */
export interface PullMetrics {
  /* The asymptote of the resistance curve — the distance the pull approaches
     but never reaches, however hard it is dragged. */
  limit: number;
  /* How far the RESISTED surface must move before releasing would refresh. */
  threshold: number;
  /* Where the surface rests while the refresh is actually running, so the
     reader can see that something is happening rather than watching it snap
     back and hoping. */
  rest: number;
  /* THE FLOOR UNDER THE HOLD, and the whole of the owner's "pull to refresh
     feels broken" (2026-08-28). The work this gesture triggers is
     `refreshPanels()`, five same-origin conditional GETs that the origin
     answers from prepared bytes — MEASURED at tens of milliseconds. So the
     armed hold at `rest` collapsed before it had rendered: the mark appeared,
     the settle animation was cut off partway, and the surface snapped home.
     A reader saw a flicker and concluded nothing had happened.
     The floor is a MINIMUM, never a delay added to a slow refresh: the hold
     ends when BOTH the work and this have elapsed, so a slow origin is still
     shown for exactly as long as it takes. 700ms is chosen against the
     260ms settle this state has to outlive twice over, plus enough dwell for
     the caption to be read. */
  dwell: number;
  /* And then it SAYS SO. A refresh that ends by silently going home is
     indistinguishable from one that never ran; a brief completed state is the
     acknowledgement. Short on purpose — it is a receipt, not a dialog. */
  done: number;
}

export const pullMetrics: PullMetrics = {
  limit: 160,
  threshold: 64,
  rest: 48,
  dwell: 700,
  done: 350
};

/* How far the surface has actually moved for a given raw drag. The curve is
 * lib/gesture.ts's, shared with the gallery's ends, so the two rubber-bands on
 * this page are the same rubber-band. An upward drag yields nothing at all —
 * there is no such thing as a negative pull, and letting one accumulate is how
 * a gesture ends up owing the reader travel it never asked for. */
export function pullDistance(dragged: number, metrics: PullMetrics = pullMetrics): number {
  return dragged <= 0 ? 0 : rubberBand(dragged, metrics.limit);
}

/* Whether releasing HERE would refresh. Separate from the distance so the
 * indicator and the release decision read the identical rule — a control that
 * says "let go now" at one distance and acts at another is worse than one that
 * says nothing. */
export function pullArmed(distance: number, metrics: PullMetrics = pullMetrics): boolean {
  return distance >= metrics.threshold;
}

/* How far through the arming a pull is, 0..1 — the indicator's own progress,
 * so the reader can see the threshold approaching instead of discovering it.
 * Clamped at 1: past the threshold the answer is "yes", not "more yes". */
export function pullProgress(distance: number, metrics: PullMetrics = pullMetrics): number {
  if (metrics.threshold <= 0) {
    return distance > 0 ? 1 : 0;
  }
  return Math.min(1, Math.max(0, distance / metrics.threshold));
}

/* The five states the control is ever in, in the order a completed pull walks
 * through them. Named rather than derived from a pile of booleans, because the
 * indicator's copy, its aria-live announcement and the settle all branch on the
 * same one thing.
 *
 * `complete` is the state the 0.1.55 gesture had no way to express, which is
 * why it read as broken: it went from `refreshing` straight back to `idle` in
 * the same tens of milliseconds the work took, so the only thing a reader
 * could perceive was the mark disappearing again. */
export type PullPhase = 'idle' | 'pulling' | 'armed' | 'refreshing' | 'complete';

/* A clock, injectable for the same reason the frame view is: a test that
 * waited 700 real milliseconds per case would make layer 1 of the motion
 * battery exactly the slow, flaky thing it exists not to be. */
export type PullWait = (ms: number) => Promise<void>;

const defaultWait: PullWait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/* THE REFRESH CYCLE, in one place, because there are TWO ways to ask for a
 * refresh — the gesture and the keyboard control — and a reader who presses
 * the control deserves the identical acknowledgement a reader who pulled gets.
 * Splitting the timing across the two call sites is how they drift.
 *
 * It never rejects and never leaves the caller mid-phase: `refresh` failing is
 * caught here, so `idle` is reached on every path. That is the settle
 * guarantee stated at the top of this file, extended to cover the phase as
 * well as the offset. */
export async function refreshCycle(
  refresh: () => Promise<void>,
  enter: (phase: PullPhase) => void,
  wait: PullWait = defaultWait,
  metrics: PullMetrics = pullMetrics
): Promise<void> {
  enter('refreshing');
  /* BOTH, not either: the hold lasts as long as the slower of the work and
     the floor. A settled promise still resolves through Promise.all, so a
     refresh that finishes in 12ms waits out the floor, and one that takes two
     seconds is shown for two seconds. */
  await Promise.all([refresh().catch(() => {}), wait(metrics.dwell)]);
  enter('complete');
  await wait(metrics.done);
  enter('idle');
}

export interface PullBinding {
  /* True when the surface is at the very top and a pull may begin. Injected
     rather than read here so a test can drive it and so this file never
     assumes which element scrolls. */
  atTop: () => boolean;
  /* The live offset, in pixels, and the phase that goes with it. */
  render: (distance: number, phase: PullPhase) => void;
  /* The actual work. Whatever it resolves to, the surface settles afterwards;
     whatever it rejects with, the surface still settles — a gesture must not
     be able to strand the page on a failed request. */
  refresh: () => Promise<void>;
  /* Whether the reader has asked for reduced motion. Injected for the same
     reason atTop is: this file reads no media query and no DOM. */
  reduced?: () => boolean;
  /* Scroll the page by `top` pixels — the road an eaten flick is given back
     on (see handoff below). Optional: a surface that cannot scroll has
     nothing to hand back. */
  scrollBy?: (top: number, smooth: boolean) => void;
  metrics?: PullMetrics;
  /* The clock the dwell floor and the completion hold are measured on, and
     the frame clock the live drag is coalesced against. Injected for tests;
     production takes the platform's own. */
  wait?: PullWait;
  view?: FrameView;
}

/* The settle, in one place, because "it did not slingshot back" is the defect
 * this whole module exists to fix and every exit must use the same road home.
 *
 * It is a rAF loop rather than a CSS transition for one reason: the surface
 * has to be able to settle from wherever the finger left it, INCLUDING while a
 * refresh is still running and the rest offset is holding — a transition would
 * need its start point re-declared on every path and would be interrupted by
 * the next drag mid-flight with no way to hand the current position back.
 *
 * A reduced-motion reader gets the destination immediately. That is not a
 * degraded settle, it IS the settle: the guarantee is that the surface ends at
 * the offset it should be at, and animation is only how a sighted reader is
 * shown it happening. */
export function settleTo(
  from: number,
  to: number,
  reduced: boolean,
  step: (value: number) => void,
  view: FrameView = globalThis
): () => void {
  /* NO FRAME CLOCK, NO JOURNEY — and arriving immediately is the correct
     degradation rather than a settle that never runs, exactly as
     frameCoalescer's own header argues for the drag. A host with no
     requestAnimationFrame (a server render, a bare Node context) cannot
     animate; what it must not do is leave the surface displaced, which is the
     one thing this function exists to prevent. */
  const frames = view.requestAnimationFrame?.bind(view);
  if (reduced || from === to || frames === undefined) {
    step(to);
    return () => {};
  }
  let cancelled = false;
  /* null rather than 0, because `started ||= now` would refuse to record a
     genuine timestamp of zero and restart the clock on every frame. Engines
     essentially never hand out 0 here, which is exactly what makes it the
     kind of bug that ships. */
  let started: number | null = null;
  /* 260ms and an ease-out: long enough to read as the surface returning
     rather than vanishing, short enough that a reader who pulled by accident
     is not made to watch it. */
  const duration = 260;
  const frame = (now: number): void => {
    if (cancelled) {
      return;
    }
    started ??= now;
    const t = Math.min(1, (now - started) / duration);
    /* Cubic ease-out: fastest at the start, so the surface visibly leaves the
       finger's last position rather than creeping away from it. */
    const eased = 1 - (1 - t) ** 3;
    step(from + (to - from) * eased);
    if (t < 1) {
      frames(frame);
    }
  };
  frames(frame);
  return () => {
    cancelled = true;
  };
}

/* How long a handed-back flick keeps travelling after the finger lifts, in
 * milliseconds of its last measured velocity. A native fling decays over
 * several hundred milliseconds; this is the same order, short enough that a
 * reader who stopped their finger deliberately is not carried past where
 * they stopped. */
export const handoffFlingMs = 300;

/* pullToRefresh binds the gesture to an element — in practice the document
 * body, because the thing being pulled is the page. It writes no style and
 * knows no class: every visible consequence goes through `render`. */
export function pullToRefresh(node: HTMLElement, binding: PullBinding) {
  const metrics = binding.metrics ?? pullMetrics;
  const reduced = () => binding.reduced?.() ?? false;
  const wait = binding.wait ?? defaultWait;

  let pointer = -1;
  let startX = 0;
  let startY = 0;
  let claimed = false;
  /* Whether the native-touch defence below has already contested this touch.
     Once it has, the browser's own scroll is gone for the rest of the touch
     (see onTouchMove), so a drag that then turns out to be an upward flick is
     the pull's to hand back — `handoff` is that state, and the two clocks
     under it are the last sample the page was scrolled to and when. */
  let contested = false;
  let handoff = false;
  let handoffY = 0;
  let handoffAt = 0;
  let velocity = 0;
  /* WHICH FINGER THIS GESTURE IS (issue 265). A TouchList is every finger on
     the screen, and the native-touch defence below used to read `touches[0]`
     — the FIRST one down, which is not promised to be the one this binding is
     tracking. A pointer that began while an earlier finger was already on the
     page therefore defended itself against a stranger's coordinates.
     It is ADOPTED rather than compared, because `Touch.identifier` and
     `PointerEvent.pointerId` are unrelated counters that no specification
     relates: the first touchmove of a tracked gesture names the touch, and
     every later move is matched against that name. `null` means no touch has
     been seen yet in this gesture, which is a state no identifier can wear. */
  let touchId: number | null = null;
  let distance = 0;
  let phase: PullPhase = 'idle';
  let cancelSettle: (() => void) | null = null;
  /* BUSY IS ONE FLAG, not a phase comparison, and the difference is a real
     defect avoided. The cycle now spans two phases — `refreshing` and
     `complete` — and a second gesture starting inside the completion hold
     would drive the surface while a queued `enter('idle')` was still on its
     way to settle it home. Asking "is a cycle in flight" instead of "which
     phase is showing" makes that unrepresentable rather than handled.

     IT IS CHECKED IN EXACTLY ONE PLACE, and the invariant that allows that is
     worth stating because a later edit could quietly break it: `busy` is set
     only in onUp, which has just set `pointer` to -1, and onDown is the only
     thing that sets `pointer` back. So while a cycle is in flight NO pointer
     is tracked, and every handler below already returns on the pointer id it
     does not recognise. The 0.1.55 shape needed a second check inside onMove
     because its onDown admitted a gesture mid-refresh; refusing at the door
     instead means the downstream checks would be guards no input can reach,
     and this repository does not keep those. */
  let busy = false;
  /* Nothing renders after the action is destroyed. The cycle is asynchronous
     and outlives an unmount by up to a dwell plus a completion hold, and a
     render into a torn-down component is a defect the previous, synchronous
     shape could not have. One check, in `show`, for the same reason: every
     path that renders — the drag, each settle frame, each phase change — goes
     through it. */
  let alive = true;

  /* One visible drag update per frame (see frameCoalescer in lib/gesture.ts).
     The DRAG only: every settle frame and every terminal position goes
     through `show` directly, because those are already frame-paced or are the
     final word. */
  const frames = frameCoalescer<{ next: number; phase: PullPhase }>(
    ({ next, phase: nextPhase }) => binding.render(next, nextPhase),
    binding.view
  );

  function show(next: number, nextPhase: PullPhase): void {
    distance = next;
    phase = nextPhase;
    /* The coalescer holds at most one queued drag frame; a direct show is the
       newer truth and must not be overtaken by it. */
    frames.cancel();
    if (alive) {
      binding.render(next, nextPhase);
    }
  }

  /* The live drag: internal state updates NOW — every decision below reads
     `distance` and `phase` synchronously — and only the visible consequence
     waits for the frame. */
  function showLive(next: number, nextPhase: PullPhase): void {
    distance = next;
    phase = nextPhase;
    frames.push({ next, phase: nextPhase });
  }

  function settle(to: number, nextPhase: PullPhase): void {
    cancelSettle?.();
    /* The SAME frame clock the drag is coalesced against, which is what
       PullBinding promises `view` is for. It defaulted to the platform's own
       before, so an injected clock drove the drag and the real display drove
       the settle — the one part of this gesture a test could not step
       through, and the part the mid-settle strand above lives in. */
    cancelSettle = settleTo(distance, to, reduced(), (value) => show(value, nextPhase), binding.view);
  }

  /* LETTING GO OF THE FINGER, and nothing else. Every path out of a gesture
     ends here, and the INVARIANT is that `pointer` is never cleared anywhere
     else: one place stops tracking, one place removes the non-passive
     touchmove listener, one place forgets which touch this was. The listener
     leak was a real defect (MEASURED: it survived on document.body for the
     rest of the session after the first non-pull touch that began at the top,
     making the whole page a scroll-blocking region), and it was a leak
     precisely because three exits each did part of this by hand. */
  function release(): void {
    node.removeEventListener('touchmove', onTouchMove);
    pointer = -1;
    claimed = false;
    touchId = null;
    contested = false;
    handoff = false;
    velocity = 0;
  }

  /* THE SURFACE IS NOT THE FINGER'S ANY MORE — and it goes home. This is rule
     3 at the top of this file, made a function rather than a promise: every
     exit that is not a committed refresh runs through it, so there is no path
     left that can clear the pointer and leave the page displaced.
     The defect it closes: a second touch during the 260ms snap-back cancels
     the settle in flight (onDown), and if that touch then turns out to be a
     scroll — an upward flick, a horizontal swipe, a tap — the old code simply
     stopped tracking. The page stayed frozen wherever the cancelled settle had
     reached (MEASURED at 39.98px, `data-pulling="true"` for the rest of the
     session, the indicator pinned at the viewport top 1500px down the page).
     The settle is restarted only when there is travel to undo, so an ordinary
     touch that never moved the page renders nothing at all. */
  function standDown(): void {
    release();
    if (distance > 0) {
      settle(0, 'idle');
    }
  }

  /* WHICH TOUCH IS OURS, adopted on first sight — see `touchId`. A gesture
     whose first touchmove carries no touch at all names nothing and defends
     nothing, which is the conservative direction: an unattributable touch is
     the browser's. */
  function trackedTouch(event: TouchEvent): Touch | undefined {
    const touches = Array.from(event.touches);
    if (touchId === null) {
      const first = touches[0];
      if (first === undefined) {
        return undefined;
      }
      touchId = first.identifier;
    }
    return touches.find((candidate) => candidate.identifier === touchId);
  }

  function onDown(event: PointerEvent): void {
    /* A pull is a FINGER. A mouse has a scrollbar and a keyboard has the
       control below the fold; claiming the mouse here would mean a drag on the
       page selecting text stopped working, which is a real regression to trade
       for nothing. */
    if (event.pointerType !== 'touch' || pointer !== -1 || busy || !binding.atTop()) {
      return;
    }
    cancelSettle?.();
    cancelSettle = null;
    pointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    claimed = false;
    touchId = null;
    node.addEventListener('touchmove', onTouchMove, { passive: false });
  }

  function onMove(event: PointerEvent): void {
    /* No `busy` check here: while a cycle is in flight no pointer is tracked,
       so this one already rejects every event a busy cycle could see. See the
       invariant beside `busy`. */
    if (event.pointerId !== pointer) {
      return;
    }
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    /* THE HANDED-BACK FLICK: the page follows the finger, sample by sample,
       and remembers how fast it was going for the fling on release. Page
       travel is the finger's travel inverted — a finger moving up scrolls
       the page down — which is what `scrollBy` takes. */
    if (handoff) {
      binding.scrollBy?.(handoffY - event.clientY, false);
      const elapsed = event.timeStamp - handoffAt;
      if (elapsed > 0) {
        velocity = (handoffY - event.clientY) / elapsed;
      }
      handoffY = event.clientY;
      handoffAt = event.timeStamp;
      return;
    }
    if (!claimed) {
      /* No longer at the top: the page's gesture. Standing down explicitly
         stops a later downward wobble in the same gesture from grabbing a
         scroll already in progress. */
      if (!binding.atTop()) {
        standDown();
        return;
      }
      /* Upward PAST THE SLOP: the page's flick, permanently. Past the slop
         and not on the first pixel, and the difference is the whole of the
         owner's "it works only in one band" (issue 277, real iPhone). This
         used to stand down on ANY dy <= 0, so the tremor a real finger
         plants before a pull — MEASURED: one sample 1px UP, then 240px
         straight down — killed the gesture on every engine, because a
         stand-down is for the rest of the touch. lib/gesture.ts's own rule
         is that nothing acts before the slop, and the same courtesy the
         swipe extends to a wobbling finger is extended here: a drag has to
         GO upward to be an upward flick, not merely waver.
         IF THE DEFENCE ALREADY CONTESTED THIS TOUCH, standing down is not
         enough: the browser's scroll is gone for the rest of it (the first
         touchmove decided — see onTouchMove), so the flick the reader made
         would simply do nothing. That was the owner's 2026-08-31 report,
         and conceding the first sample to avoid it is what killed the pull
         instead. So the page is handed the flick by hand: the travel so far
         now, every later sample as it comes, and a fling on release. */
      if (dy < -gestureSlop) {
        if (contested) {
          handoff = true;
          handoffY = event.clientY;
          handoffAt = event.timeStamp;
          binding.scrollBy?.(-dy, false);
          if (distance > 0 && cancelSettle === null) {
            settle(0, 'idle');
          }
          return;
        }
        standDown();
        return;
      }
      /* Everything else about an unproven drag DECIDES NOTHING PERMANENT —
         it is watched, sample by sample, until the drag itself picks a
         direction. That is the other half of issue 277: a thumb pulling
         from low on the screen arcs, so its FIRST past-slop sample reads
         horizontal (MEASURED: dx 10 / dy 4, then 240px straight down), and
         the old per-first-sample stand-down handed the whole pull to a
         swipe that does not exist at the top of this page. claimsHorizontal
         is still the one shared definition of "across, not down" — while
         the CUMULATIVE drag reads horizontal the pull claims nothing, so
         the mostly-horizontal drag 0.1.67 measured (dx 160 / dy 20) still
         never claims, and a swipe wobbling downward stays unclaimed until
         it has genuinely travelled further down than across. What a
         watched sample DOES owe is the settle guarantee: a second touch
         cancels a snap-back just by arriving (onDown), and if that touch
         then drifts sideways forever, nobody else is left to bring the
         displaced page home. */
      if (claimsHorizontal(dx, dy) || dy < 12) {
        if (distance > 0 && cancelSettle === null) {
          settle(0, 'idle');
        }
        return;
      }
      claimed = true;
      /* The watch above may have started that settle; the surface is the
         finger's now, and two writers — a settle easing home and the drag
         below — must not share it. */
      cancelSettle?.();
      cancelSettle = null;
    }
    const next = pullDistance(dy, metrics);
    showLive(next, pullArmed(next, metrics) ? 'armed' : 'pulling');
  }

  /* THE NATIVE-TOUCH HALF, and the reason the pull works on a physical phone
     and not only under synthetic pointers (owner report, 2026-08-28: "pull to
     refresh is broken, it doesn't work"). An earlier revision deliberately
     never called preventDefault, on the argument that overscroll-behavior-y
     already told the browser the gesture had nowhere to go. That argument
     holds for the RUBBER BAND and not for the CLAIM: a browser still claims
     a downward touch at the top as a scroll gesture, fires pointercancel
     (exactly the behaviour lib/gesture.ts's header documents), and the pull
     dies before it renders a pixel — while dispatched pointer events, which
     no browser arbitrates, sail through and make every emulated lane green.

     So the pull contests the claim, as narrowly as it can be contested: a
     NON-PASSIVE touchmove listener is attached only inside an eligible touch
     (finger down at the document's top) and removed when that touch ends.
     The permanent-listener alternative would disable scroll optimisation for
     every touch on the page; this one costs only the touches that begin at
     the very top.

     THE FIRST CANCELABLE TOUCHMOVE DECIDES THE WHOLE TOUCH, and that is
     measured rather than read: driven through the browser's own touch input
     (issue 285, Chromium), an un-prevented first touchmove is followed by
     pointercancel in the same millisecond and every later touchmove arrives
     uncancelable — there is no second chance. 0.1.69 conceded that sample
     whenever it was inside the 8px slop, reasoning that "a pull that needs
     one more sample to engage is a gesture that works". On an engine that
     coalesces sub-slop movement (Chromium's first touchmove lands at ~16px)
     the concession never bit; on one that dispatches every pixel — the
     owner's iPhone — it handed every deliberate pull's opening sample to the
     scroll claim, and the pull was dead on the phone it exists for. So the
     defence contests any downward first sample at the top, however small,
     and a horizontal-reading one too: a thumb-arc pull opens across before
     it goes down, and nothing at the top of this page pans sideways. What
     it never contests is a touch it did not adopt (issue 265), an upward
     sample (the page's flick), or a page that has left its top. The one
     flick this can eat — a real upward flick whose first sample drifts
     down — is handed back by onMove rather than conceded up front. */
  function onTouchMove(event: TouchEvent): void {
    if (!event.cancelable) {
      return;
    }
    if (claimed || handoff) {
      event.preventDefault();
      return;
    }
    const touch = trackedTouch(event);
    if (pointer !== -1 && touch !== undefined && touch.clientY - startY > 0 && binding.atTop()) {
      contested = true;
      event.preventDefault();
    }
  }

  function onUp(event: PointerEvent): void {
    if (event.pointerId !== pointer) {
      return;
    }
    /* A handed-back flick ends the way a native one does: the page keeps
       going for a moment at the speed the finger left it. Smooth unless the
       reader asked for less motion, in which case the distance lands at once
       — the same rule settleTo applies to the surface. */
    if (handoff) {
      const fling = velocity * handoffFlingMs;
      standDown();
      if (Math.abs(fling) >= 1) {
        binding.scrollBy?.(fling, !reduced());
      }
      return;
    }
    /* An unclaimed release is an exit like any other, and it is an exit that
       could be holding travel: the finger that just lifted may have been the
       second touch of a strand — down inside a settle (which onDown cancels),
       up again without ever proving itself a pull. Standing down restarts the
       settle it interrupted instead of leaving the page where the cancelled
       one stopped. */
    if (!claimed || !pullArmed(distance, metrics)) {
      /* THE SNAP-BACK. Not armed, so nothing happens except the surface
         going back exactly where it was — which is the whole of what the
         removed behaviour failed to do. */
      standDown();
      return;
    }
    /* Armed: hold at the rest offset for as long as the work AND the dwell
       floor take, acknowledge, and then settle home — whether the work
       succeeded or not, and whether or not this action is still mounted.
       RELEASE, NEVER STAND DOWN: this is the one exit that must not settle to
       zero, because the cycle below is about to settle it to `rest` and hold
       it there. Both helpers clear the pointer, which is what keeps the `busy`
       invariant below true on every path. */
    release();
    busy = true;
    void refreshCycle(binding.refresh, enterPhase, wait, metrics).finally(() => {
      busy = false;
    });
  }

  /* What each phase of the cycle DOES to the surface. The cycle owns the
     timing; this owns the pixels, which is why the keyboard control in
     PullToRefresh.svelte can run the identical cycle without inheriting a
     gesture's displacement. */
  function enterPhase(next: PullPhase): void {
    if (next === 'refreshing') {
      settle(metrics.rest, 'refreshing');
      return;
    }
    if (next === 'complete') {
      /* HOLD, do not travel: the acknowledgement is shown at the same offset
         the work was, so the reader reads a state change rather than watching
         the surface move twice. The in-flight settle is cancelled first —
         otherwise its own queued frames would write `refreshing` back over
         the phase that just changed. */
      cancelSettle?.();
      cancelSettle = null;
      show(distance, 'complete');
      return;
    }
    settle(0, 'idle');
  }

  function onCancel(event: PointerEvent): void {
    if (event.pointerId !== pointer) {
      return;
    }
    standDown();
  }

  node.addEventListener('pointerdown', onDown, { passive: true });
  node.addEventListener('pointermove', onMove, { passive: true });
  node.addEventListener('pointerup', onUp, { passive: true });
  node.addEventListener('pointercancel', onCancel, { passive: true });

  return {
    destroy() {
      alive = false;
      frames.cancel();
      cancelSettle?.();
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onCancel);
      node.removeEventListener('touchmove', onTouchMove);
    }
  };
}
