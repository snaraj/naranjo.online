/* Pull-to-refresh: the arithmetic, kept out of the component exactly as
 * lib/tooltip.ts and lib/gesture.ts are, so the behaviour is executable by a
 * test rather than inferred from markup.
 *
 * WHAT WAS HERE BEFORE, AND WHY IT WENT. Nothing — and that is the point. This
 * site never had a custom pull-to-refresh. It had two separate things, both
 * removed in the same commit:
 *
 *   1. A manual refresh BUTTON (RefreshAll.svelte), deleted at issue 179 on
 *      the owner's ruling that the page must stay current on its own rather
 *      than depend on a visitor pressing something.
 *   2. The BROWSER'S OWN pull-to-refresh, suppressed at issue 187 by
 *      `html, body { overscroll-behavior-y: none }`, because the owner
 *      reported the page left "stuck dragged-down" after the gesture on iOS
 *      Safari: the native rubber-band overshoot never settled flush and the
 *      document stayed translated below its own top edge. That is precisely
 *      the "it did not slingshot back to place" this replacement has to fix.
 *
 * THE DECLARATION STAYS. `overscroll-behavior-y: none` is a defended fix, and
 * removing it would reintroduce issue 187 exactly. It is also what makes this
 * implementation POSSIBLE rather than what it has to fight: with the native
 * boundary effect suppressed there is no browser animation competing for the
 * same drag, so the offset below is the only thing moving the surface and the
 * settle is ours to guarantee. A custom pull layered on TOP of a live native
 * bounce is the thing that cannot be made to settle, and it is what the
 * removed behaviour actually was.
 *
 * THE THREE RULES THIS OWES.
 *
 *   - It engages ONLY at the top. A drag that begins with the document
 *     scrolled is the page's, and is never claimed.
 *   - It never claims a gesture before proving it is a downward pull, so a
 *     reader flicking upward from the top scrolls, and a horizontal gesture
 *     inside the page reaches whatever it was for.
 *   - It ALWAYS returns to zero. Every exit — committed, abandoned, or
 *     cancelled by the browser — runs through the same settle, because a
 *     surface left displaced is the original defect.
 */

import { claimsHorizontal, rubberBand } from './gesture.ts';

/* How far the surface may ever travel, and how far it must travel to arm.
 * Both are absolute pixels rather than ratios: a pull is a thumb's reach, and
 * a thumb is the same size on a phone and a tablet. */
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
}

export const pullMetrics: PullMetrics = { limit: 160, threshold: 64, rest: 48 };

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

/* The four states the control is ever in, in the order a completed pull walks
 * through them. Named rather than derived from a pile of booleans, because the
 * indicator's copy, its aria-live announcement and the settle all branch on the
 * same one thing. */
export type PullPhase = 'idle' | 'pulling' | 'armed' | 'refreshing';

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
  metrics?: PullMetrics;
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
  view: { requestAnimationFrame(fn: (t: number) => void): number } = globalThis
): () => void {
  if (reduced || from === to) {
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
      view.requestAnimationFrame(frame);
    }
  };
  view.requestAnimationFrame(frame);
  return () => {
    cancelled = true;
  };
}

/* pullToRefresh binds the gesture to an element — in practice the document
 * body, because the thing being pulled is the page. It writes no style and
 * knows no class: every visible consequence goes through `render`. */
export function pullToRefresh(node: HTMLElement, binding: PullBinding) {
  const metrics = binding.metrics ?? pullMetrics;
  const reduced = () => binding.reduced?.() ?? false;

  let pointer = -1;
  let startX = 0;
  let startY = 0;
  let claimed = false;
  let distance = 0;
  let phase: PullPhase = 'idle';
  let cancelSettle: (() => void) | null = null;

  function show(next: number, nextPhase: PullPhase): void {
    distance = next;
    phase = nextPhase;
    binding.render(next, nextPhase);
  }

  function settle(to: number, nextPhase: PullPhase): void {
    cancelSettle?.();
    cancelSettle = settleTo(distance, to, reduced(), (value) => show(value, nextPhase));
  }

  function onDown(event: PointerEvent): void {
    /* A pull is a FINGER. A mouse has a scrollbar and a keyboard has the
       control below the fold; claiming the mouse here would mean a drag on the
       page selecting text stopped working, which is a real regression to trade
       for nothing. */
    if (event.pointerType !== 'touch' || pointer !== -1 || !binding.atTop()) {
      return;
    }
    cancelSettle?.();
    cancelSettle = null;
    pointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    claimed = false;
    node.addEventListener('touchmove', onTouchMove, { passive: false });
  }

  function onMove(event: PointerEvent): void {
    if (event.pointerId !== pointer || phase === 'refreshing') {
      return;
    }
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!claimed) {
      /* Upward, or no longer at the top: the page's gesture, and standing
         down explicitly stops a later downward wobble in the same gesture
         from grabbing a scroll already in progress. */
      if (dy <= 0 || !binding.atTop()) {
        pointer = -1;
        return;
      }
      /* AND A GESTURE MUST PROVE ITSELF, which this one did not. The header
         of lib/gesture.ts states the rule the whole layer rests on — "a
         gesture must PROVE it is horizontal before it claims anything" — and
         its swipe binding stands down explicitly when a drag turns out to be
         the other axis. The pull asked only for downward travel, so a
         mostly-HORIZONTAL drag with any downward drift claimed it too:
         MEASURED at the top of the document, a drag of dx 160 / dy 20 set
         `data-pulling="true"` and moved the page 18.8px, and a sloppier
         diagonal reaches the arming threshold and fires a real refresh.
         claimsHorizontal is the SAME predicate the swipe stands down on —
         one definition of "this drag is across, not down", so the two
         gestures on this page can never disagree about which of them a
         diagonal belongs to. Standing down rather than merely waiting is
         deliberate for the reason gesture.ts gives: a later downward wobble
         inside a gesture the reader is using to swipe something must not
         suddenly grab the page. */
      if (claimsHorizontal(dx, dy)) {
        pointer = -1;
        return;
      }
      if (dy < 12) {
        return;
      }
      claimed = true;
    }
    const next = pullDistance(dy, metrics);
    show(next, pullArmed(next, metrics) ? 'armed' : 'pulling');
  }

  /* THE NATIVE-TOUCH HALF, and the reason the pull works on a physical phone
     and not only under synthetic pointers (owner report, 2026-08-28: "pull to
     refresh is broken, it doesn't work"). An earlier revision deliberately
     never called preventDefault, on the argument that overscroll-behavior-y
     already told the browser the gesture had nowhere to go. That argument
     holds for the RUBBER BAND and not for the CLAIM: real iOS Safari still
     claims a downward touch at the top as a scroll gesture, fires
     pointercancel (exactly the behaviour lib/gesture.ts's header documents),
     and the pull dies before it renders a pixel — while dispatched pointer
     events, which no browser arbitrates, sailed through and made every
     emulated lane green.

     So the pull now contests the claim, as narrowly as it can be contested:
     a NON-PASSIVE touchmove listener is attached only inside an eligible
     touch (finger down at the document's top) and removed when that touch
     ends, and it prevents default only once the drag has PROVEN itself a
     pull (claimed, downward). An unclaimed touch — upward scroll, a
     horizontal swipe, any drag once the page has left the top — falls
     through untouched to the browser. The permanent listener alternative
     would disable scroll optimisation for every touch on the page; this one
     costs only the touches that begin at the very top. */
  function onTouchMove(event: TouchEvent): void {
    if (!event.cancelable) {
      return;
    }
    if (claimed) {
      event.preventDefault();
      return;
    }
    /* The proving window needs the same defence: Safari can claim the
       gesture during the first 12 downward pixels, before `claimed` flips,
       and a pull that only defends itself after proof still dies on a real
       phone. An eligible, still-tracked touch moving DOWNWARD at the top is
       defended; everything else — upward, horizontal stand-down (pointer is
       already -1), a page no longer at its top — falls through to the
       browser untouched. */
    const touch = event.touches[0];
    if (pointer !== -1 && touch !== undefined && touch.clientY - startY > 0 && binding.atTop()) {
      event.preventDefault();
    }
  }

  function onUp(event: PointerEvent): void {
    if (event.pointerId !== pointer) {
      return;
    }
    node.removeEventListener('touchmove', onTouchMove);
    pointer = -1;
    if (!claimed || phase === 'refreshing') {
      return;
    }
    claimed = false;
    if (!pullArmed(distance, metrics)) {
      /* THE SNAP-BACK. Not armed, so nothing happens except the surface
         going back exactly where it was — which is the whole of what the
         removed behaviour failed to do. */
      settle(0, 'idle');
      return;
    }
    /* Armed: hold at the rest offset while the work runs, then settle home
       whether it succeeded or not. */
    settle(metrics.rest, 'refreshing');
    void binding
      .refresh()
      .catch(() => {})
      .finally(() => settle(0, 'idle'));
  }

  function onCancel(event: PointerEvent): void {
    if (event.pointerId !== pointer) {
      return;
    }
    node.removeEventListener('touchmove', onTouchMove);
    pointer = -1;
    claimed = false;
    if (phase !== 'refreshing') {
      settle(0, 'idle');
    }
  }

  node.addEventListener('pointerdown', onDown, { passive: true });
  node.addEventListener('pointermove', onMove, { passive: true });
  node.addEventListener('pointerup', onUp, { passive: true });
  node.addEventListener('pointercancel', onCancel, { passive: true });

  return {
    destroy() {
      cancelSettle?.();
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onCancel);
      node.removeEventListener('touchmove', onTouchMove);
    }
  };
}
