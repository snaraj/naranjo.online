/* The page's ONE hand-gesture layer (issue 219): the arithmetic a drag is
 * decided by, and the pointer binding that drives it, kept apart for the same
 * reason lib/tooltip.ts keeps them apart — the arithmetic is then executable
 * by a test rather than pattern-matched out of a component, and the two halves
 * cannot drift.
 *
 * WHY IT IS HAND-ROLLED. Requirement 1: no third-party runtime dependency may
 * enter this frontend, so there is no gesture library to reach for. That is a
 * constraint rather than a hardship — everything below is Pointer Events,
 * which every engine this site is measured on implements, and a library would
 * mostly be supplying the two curves in this file.
 *
 * THE RULE THAT SHAPES EVERYTHING: NEVER FIGHT THE NATIVE SCROLL. A page that
 * steals vertical panning to run a horizontal gesture is a page a reader
 * cannot scroll, and one that swallows the browser's own overscroll is how the
 * last pull-to-refresh on this site had to be removed (issue 187). So:
 *
 *   - the caller declares `touch-action` and the binding never contradicts it.
 *     A horizontal swipe surface says `pan-y`, which hands vertical panning to
 *     the compositor and keeps only the horizontal axis for us;
 *   - a gesture must PROVE it is horizontal before it claims anything. Until
 *     the pointer has moved further across than down, the browser owns it;
 *   - once the browser has claimed a gesture it sends `pointercancel`, and
 *     that is treated as the authoritative "not yours" it is — the drag
 *     settles back rather than fighting for it.
 */

/* How far, how fast, and how straight a drag has to be before it counts.
 * Every one is a RATIO or a rate rather than a pixel count, so the same
 * numbers behave the same way on a 320px phone and a 1440px desktop. */
export interface SwipeMetrics {
  /* Fraction of the travelled axis that a slow drag must cross. A fifth is
     the platform convention: far enough that a fidget is not a page turn,
     near enough that a deliberate push always is. */
  distance: number;
  /* Pixels per millisecond past which a SHORT drag still counts — the flick.
     Without it a fast, small gesture reads as a fidget, which is exactly the
     gesture an experienced reader makes. 0.5 px/ms is 500px/s. */
  velocity: number;
}

export const swipeMetrics: SwipeMetrics = { distance: 0.2, velocity: 0.5 };

/* THE RESISTANCE CURVE, shared by every rubber-band on the page: the swipe's
 * ends and the pull-to-refresh alike.
 *
 * It is asymptotic rather than linear-then-clamped, and that is the whole
 * point. A linear pull with a hard stop tells the reader nothing until it
 * suddenly tells them everything; a curve that yields less the further it goes
 * says "there is nothing past here" continuously, in the only language a drag
 * has. `limit` is the distance the pull can never reach however hard it is
 * dragged, so the surface stays attached to the finger while making it
 * increasingly clear the finger is asking for something that is not there.
 *
 * Exponential, so the derivative at zero is exactly 1: the first pixel of pull
 * moves the surface one pixel, which is what makes it feel connected rather
 * than sluggish. Negative distances mirror, so one function serves both
 * directions. A non-positive limit yields nothing at all, which is the honest
 * answer for a surface with no give. */
export function rubberBand(distance: number, limit: number): number {
  if (limit <= 0) {
    return 0;
  }
  const sign = distance < 0 ? -1 : 1;
  return sign * limit * (1 - Math.exp(-Math.abs(distance) / limit));
}

/* Which way a finished drag went: -1 for the previous item, 1 for the next,
 * 0 for "not enough — put it back". The two ways to earn a turn are
 * deliberately independent: a long slow drag qualifies on distance, a short
 * fast one on velocity, and a reader who does neither gets their surface
 * back. `span` is the axis the drag is measured against (the frame's own
 * width), so the distance test is proportional rather than absolute.
 *
 * The sign is inverted from the delta on purpose: dragging the surface
 * LEFT (a negative dx) pulls the next item into view, exactly as turning a
 * page does. */
export function swipeDecision(
  dx: number,
  elapsedMs: number,
  span: number,
  metrics: SwipeMetrics = swipeMetrics
): -1 | 0 | 1 {
  if (span <= 0 || dx === 0) {
    return 0;
  }
  const far = Math.abs(dx) >= span * metrics.distance;
  /* A zero or negative elapsed time cannot produce a rate, and a clock that
     has not moved is not evidence of speed. Distance alone decides then. */
  const fast = elapsedMs > 0 && Math.abs(dx) / elapsedMs >= metrics.velocity;
  if (!far && !fast) {
    return 0;
  }
  return dx < 0 ? 1 : -1;
}

/* THE SLOP: how far a finger may travel before anything on this page treats
 * it as a deliberate direction. A finger is never perfectly still, and a
 * gesture layer that acts on the first pixel acts on tremor.
 *
 * It is EXPORTED because two gestures now read it (issue 265). The pull's
 * native-touch defence has to answer "is this drag going downward on purpose?"
 * before it may contest the browser's own scroll claim, and the honest answer
 * is the same one the swipe already uses for "is this drag going across on
 * purpose?" — one number, so the two can never disagree about what a still
 * finger is. Writing a second literal beside the first is how a defence ends
 * up defending a different gesture from the one it was reasoned about. */
export const gestureSlop = 8;

/* Has this drag proven itself horizontal? Until it has, the browser owns the
 * gesture and the surface must not move at all — claiming early is how a
 * carousel eats the page's vertical scroll. The threshold is a small absolute
 * distance (a finger is never perfectly still) AND a genuine bias across
 * rather than down. */
export function claimsHorizontal(dx: number, dy: number, slop = gestureSlop): boolean {
  return Math.abs(dx) > slop && Math.abs(dx) > Math.abs(dy);
}

/* What the reader is allowed to drag a bounded surface by. Inside its range a
 * drag tracks the finger exactly; past either end it meets the curve above,
 * so a gallery at its last photograph still MOVES — it just refuses to go
 * anywhere, which is a boundary a reader can feel instead of a control that
 * has silently stopped responding. A wrapping surface has no ends and is
 * never resisted. */
export function boundedDrag(
  dx: number,
  atStart: boolean,
  atEnd: boolean,
  span: number
): number {
  const past = (dx > 0 && atStart) || (dx < 0 && atEnd);
  if (past) {
    /* A third of the span is how far the resisted end can ever travel: enough
       to read as give, never enough to look like a turn that failed. */
    return rubberBand(dx, span / 3);
  }
  /* AND ONE SPAN IS ALL THERE IS, wrapping or not (issue 265). A wrapping
     surface has no END to resist at, which is why nothing above stops it —
     but it does have a LAST THING TO SHOW. One span of travel puts the
     incoming item exactly where the outgoing one was; past that the reader is
     dragging toward a third item this strip never mounted, so the stage goes
     EMPTY. MEASURED before this clamp: -552px past the edge, a blank stage a
     reader had to drag back from.
     A hard stop rather than a curve, deliberately: the curve above says
     "there is nothing past here" at an END, and this is not an end — the next
     item is already fully in place, so the honest statement is that the
     surface has arrived, not that it is straining. Inside one span a drag
     still tracks the finger exactly.
     A span of zero is a surface nobody has measured yet (the stage's own
     width, read at gesture start, before layout). Clamping to it would freeze
     every drag at zero, so an unmeasured surface passes through untouched —
     the same "no give stated, none applied" answer rubberBand gives. */
  return span > 0 ? Math.min(span, Math.max(-span, dx)) : dx;
}

/* WHERE THE INCOMING ITEM STARTS (issue 265), and it is the drag's own last
 * position carried one span forward.
 *
 * A committed turn used to mount the new item at the OLD offset and settle it
 * to zero, so the picture slid in BACKWARDS from the side it had just left —
 * MEASURED at 120-202px of wrong-way travel per swipe. The repair is that the
 * new item enters from the side it is coming from and only ever moves the way
 * the finger did.
 *
 * `offset + direction * span` rather than a bare `direction * span`: the
 * finger left the surface at `offset`, and the item behind it was exactly one
 * span further along, so this is the position the reader was ALREADY looking
 * at when they let go. Starting at the full span instead would jump the strip
 * to an empty stage for one frame and then slide in from nothing.
 *
 * It can never point backwards, and that is a property of the pair rather
 * than of this line: boundedDrag clamps |offset| to one span, so a forward
 * turn (direction 1, dragged left, offset in [-span, 0]) starts in [0, span]
 * and travels down to zero — the same direction the finger went. The two
 * changes are one change; separating them reintroduces the defect. */
export function entryOffset(offset: number, direction: -1 | 1, span: number): number {
  return offset + direction * span;
}

/* ONE VISIBLE UPDATE PER FRAME, and this is the whole of the owner's "swiping
 * is NOT very smooth on the phone" (2026-08-28).
 *
 * A finger reports pointermove far more often than a display can draw one:
 * 120Hz on the phones this site is read on, and every engine coalesces its own
 * OS-level samples into rather more events than frames. Each of those events
 * used to run the binding's `move`, which on the gallery sets a custom
 * property on the stage — and a custom property write invalidates style for
 * the whole subtree beneath it. So a drag paid for two to four style recalcs
 * per painted frame, all but the last of which the reader never saw.
 *
 * The fix is the one the column rail already uses (lib/columnWidth.ts's
 * consumer, pinned by its own lane): keep only the NEWEST value and hand it
 * over once, inside an animation frame. It is not a delay — the value applied
 * is always the latest the pointer reported, and it is applied in the frame
 * that is about to paint it, which is the earliest moment it could matter.
 *
 * `view` is injected for the same reason settleTo's is: a test drives a
 * deterministic clock rather than a real display. A view without
 * cancelAnimationFrame is tolerated — the queued callback then finds nothing
 * pending and does nothing, which is the same outcome by a slower road. */
export interface FrameView {
  requestAnimationFrame?(fn: (time: number) => void): number;
  cancelAnimationFrame?(handle: number): void;
}

export interface FrameCoalescer<Value> {
  /* Record the newest value; it is delivered at most once per frame. */
  push(value: Value): void;
  /* Deliver NOW, dropping anything queued — the settle's final position,
     which must not be overtaken by a stale drag frame. */
  flush(value: Value): void;
  /* Drop anything queued without delivering it. */
  cancel(): void;
}

export function frameCoalescer<Value>(
  deliver: (value: Value) => void,
  view: FrameView = globalThis
): FrameCoalescer<Value> {
  let handle: number | null = null;
  let queued: { value: Value } | null = null;
  const run = (): void => {
    handle = null;
    const pending = queued;
    queued = null;
    if (pending !== null) {
      deliver(pending.value);
    }
  };
  const cancel = (): void => {
    if (handle !== null) {
      view.cancelAnimationFrame?.(handle);
      handle = null;
    }
    queued = null;
  };
  /* NO FRAME CLOCK, NO COALESCING — and delivering immediately is the correct
     degradation rather than a silent drop. A host with no requestAnimationFrame
     has no frames to coalesce against (a server render, a bare Node context,
     a test harness that only wants the arithmetic), so "at most one per frame"
     is a statement with no content there; what still has content is that every
     value reaches the caller. Queuing against a clock that never ticks would
     lose the drag entirely. */
  const framed = typeof view.requestAnimationFrame === 'function';
  return {
    push(value) {
      if (!framed) {
        deliver(value);
        return;
      }
      queued = { value };
      if (handle === null) {
        handle = view.requestAnimationFrame?.(run) ?? null;
      }
    },
    flush(value) {
      cancel();
      deliver(value);
    },
    cancel
  };
}

export interface SwipeBinding {
  /* The distance the gesture is measured against — the surface's own width.
     Read at gesture START rather than stored, so a resize between gestures
     never measures against a stale box. */
  span: () => number;
  /* A FINGER IS ON THE SURFACE (issue 265), before anything is claimed. The
     gallery's snap-back is a CSS transition the component arms for the length
     of a settle and disarms on a free-running timer, and a swipe that began
     inside that window dragged through a still-armed transition — MEASURED at
     66-93px of lag between the finger and the picture. Nothing but the next
     pointerdown can know that the settle is over early, so the binding says
     so: the one event that is always first, on every path into a gesture.
     Optional, because a surface with no settle to disarm needs no hook. */
  down?: () => void;
  /* Live drag feedback, in pixels. Called with 0 when the gesture settles. */
  move: (offset: number) => void;
  /* A committed turn. */
  commit: (direction: -1 | 1) => void;
  /* The surface has let go: settle whatever `move` was showing. */
  settle: () => void;
  /* Whether the surface is at either end, for the resistance above. A
     wrapping surface answers false to both and is never resisted. */
  atStart?: () => boolean;
  atEnd?: () => boolean;
  /* The frame clock the live drag is coalesced against. Injected for tests
     exactly as settleTo's is; production takes the display's own. */
  view?: FrameView;
}

/* swipeHorizontal binds the whole gesture to one element. It writes no style
 * and knows no class: every visible consequence goes through `move`,
 * `commit` and `settle`, so the component keeps its own presentation and this
 * file stays testable arithmetic plus event plumbing. */
export function swipeHorizontal(node: HTMLElement, binding: SwipeBinding) {
  /* The live drag, at one delivery per painted frame — see frameCoalescer.
     Only the DRAG goes through it: every terminal position (the settle's
     zero) is flushed, so a gesture can never end on a frame that never
     arrived. */
  const frames = frameCoalescer<number>((offset) => binding.move(offset), binding.view);
  let pointer = -1;
  let startX = 0;
  let startY = 0;
  let startedAt = 0;
  let claimed = false;
  let span = 0;
  /* Whether the gesture that just ended actually moved anything. The frame is
     a button, and a drag across it ends in a click the reader never meant —
     so a real drag suppresses exactly one click, at capture, before it
     reaches the control.
     WHAT DISARMS IT IS A POINTERDOWN, and that is enough for every POINTER
     reader: a mouse drag's own compatibility click arrives in the same task
     as its pointerup and consumes the flag, and any later click necessarily
     begins with a pointerdown on this node, which resets it in onDown. The
     reader the flag could still reach is the one who produces no pointer
     event at all — see onClickCapture. */
  let dragged = false;

  function reset(): void {
    pointer = -1;
    claimed = false;
    frames.flush(0);
    binding.settle();
  }

  function onDown(event: PointerEvent): void {
    /* A secondary button is a context menu, not a drag, and a second finger
       is a pinch the browser owns. */
    if (pointer !== -1 || (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }
    pointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startedAt = event.timeStamp;
    claimed = false;
    dragged = false;
    span = binding.span();
    /* AFTER the guards, never before: a second finger and a right button are
       not gestures, and telling the surface a gesture started for one of them
       would disarm a settle nobody interrupted. */
    binding.down?.();
  }

  function onMove(event: PointerEvent): void {
    if (event.pointerId !== pointer) {
      return;
    }
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!claimed) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
        /* A vertical gesture is the page's. Standing down explicitly — rather
           than simply not acting — is what keeps a later horizontal wobble in
           the same gesture from suddenly grabbing a scroll in progress. */
        pointer = -1;
        return;
      }
      if (!claimsHorizontal(dx, dy)) {
        return;
      }
      claimed = true;
      dragged = true;
      /* Capture only AFTER the gesture is proven horizontal. Capturing at
         pointerdown would take every tap and every vertical scroll that
         happened to begin on this element.
         Guarded, because capture is the one call here that can throw: the
         spec makes it a NotFoundError when the pointer is no longer active,
         which a pointer released between this move and its dispatch genuinely
         is. Losing capture costs the drag its out-of-bounds tracking; letting
         the throw escape would abandon the gesture mid-flight with the surface
         displaced, which is the exact failure this whole feature exists to
         prevent. */
      try {
        node.setPointerCapture(event.pointerId);
      } catch {
        /* Tracked without capture; pointerup still settles it. */
      }
    }
    frames.push(
      boundedDrag(dx, binding.atStart?.() ?? false, binding.atEnd?.() ?? false, span)
    );
  }

  function onUp(event: PointerEvent): void {
    if (event.pointerId !== pointer) {
      return;
    }
    const dx = event.clientX - startX;
    const elapsed = event.timeStamp - startedAt;
    const wasClaimed = claimed;
    pointer = -1;
    claimed = false;
    if (!wasClaimed) {
      return;
    }
    const direction = swipeDecision(dx, elapsed, span);
    const blocked =
      (direction === -1 && (binding.atStart?.() ?? false)) ||
      (direction === 1 && (binding.atEnd?.() ?? false));
    if (direction !== 0 && !blocked) {
      binding.commit(direction);
    }
    /* Always settle, turn or no turn: the offset the drag was showing has to
       go back to zero either way, and THAT is the snap-back the reader sees.
       FLUSHED rather than queued: a coalesced drag frame still pending here
       would land AFTER the zero and leave the surface displaced by whatever
       the finger's last sample said — the exact defect this whole layer
       exists to prevent, reintroduced by an optimisation. */
    frames.flush(0);
    binding.settle();
  }

  /* The browser has taken the gesture — a scroll it decided was vertical, a
     second finger, a system edge swipe. Not ours to argue with. */
  function onCancel(event: PointerEvent): void {
    if (event.pointerId === pointer) {
      reset();
    }
  }

  /* A KEYBOARD ACTIVATION IS NEVER A STRAY DRAG CLICK, and `detail` is how
     the platform says so: a click synthesised from Enter or Space on a
     <button> reports a click count of 0, while every pointer-driven click
     reports at least 1.
     This is the whole of the repair for a real, measured defect. A touch
     swipe past the platform's own slop produces NO click, so the suppression
     the drag armed was never consumed — and unlike a pointer reader, whose
     next activation begins with a pointerdown that disarms it, a keyboard
     reader produces no pointer event at all and walked straight into it.
     MEASURED in both engines at 390x844: swipe the gallery (counter
     1/8 -> 2/8), focus the frame, press Enter, and `dialog.open` was false.
     Returning rather than consuming the flag is deliberate — the keypress was
     not this gesture's to spend, so it passes through untouched and a
     suppression still owed to a pointer stays owed. */
  function onClickCapture(event: MouseEvent): void {
    if (!dragged || event.detail === 0) {
      return;
    }
    dragged = false;
    event.preventDefault();
    event.stopPropagation();
  }

  /* PASSIVE, all four, and it is a promise rather than a hint: none of these
     handlers calls preventDefault, and saying so up front lets the engine
     dispatch them without first waiting to find out. The declaration that
     keeps the page's vertical scroll is `touch-action: pan-y` on the surface
     itself (see the header), never a preventDefault here, which is what makes
     the promise one this binding can actually keep.
     The click listener stays non-passive and in CAPTURE: it exists precisely
     to preventDefault a drag's trailing click. */
  const passive = { passive: true } as const;
  node.addEventListener('pointerdown', onDown, passive);
  node.addEventListener('pointermove', onMove, passive);
  node.addEventListener('pointerup', onUp, passive);
  node.addEventListener('pointercancel', onCancel, passive);
  node.addEventListener('click', onClickCapture, true);

  return {
    destroy() {
      frames.cancel();
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onCancel);
      node.removeEventListener('click', onClickCapture, true);
    }
  };
}
