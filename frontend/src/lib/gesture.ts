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

/* Has this drag proven itself horizontal? Until it has, the browser owns the
 * gesture and the surface must not move at all — claiming early is how a
 * carousel eats the page's vertical scroll. The threshold is a small absolute
 * distance (a finger is never perfectly still) AND a genuine bias across
 * rather than down. */
export function claimsHorizontal(dx: number, dy: number, slop = 8): boolean {
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
  /* A third of the span is how far the resisted end can ever travel: enough
     to read as give, never enough to look like a turn that failed. */
  return past ? rubberBand(dx, span / 3) : dx;
}

export interface SwipeBinding {
  /* The distance the gesture is measured against — the surface's own width.
     Read at gesture START rather than stored, so a resize between gestures
     never measures against a stale box. */
  span: () => number;
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
}

/* swipeHorizontal binds the whole gesture to one element. It writes no style
 * and knows no class: every visible consequence goes through `move`,
 * `commit` and `settle`, so the component keeps its own presentation and this
 * file stays testable arithmetic plus event plumbing. */
export function swipeHorizontal(node: HTMLElement, binding: SwipeBinding) {
  let pointer = -1;
  let startX = 0;
  let startY = 0;
  let startedAt = 0;
  let claimed = false;
  let span = 0;
  /* Whether the gesture that just ended actually moved anything. The frame is
     a button, and a drag across it ends in a click the reader never meant —
     so a real drag suppresses exactly one click, at capture, before it
     reaches the control. */
  let dragged = false;

  function reset(): void {
    pointer = -1;
    claimed = false;
    binding.move(0);
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
    binding.move(
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
       go back to zero either way, and THAT is the snap-back the reader sees. */
    binding.move(0);
    binding.settle();
  }

  /* The browser has taken the gesture — a scroll it decided was vertical, a
     second finger, a system edge swipe. Not ours to argue with. */
  function onCancel(event: PointerEvent): void {
    if (event.pointerId === pointer) {
      reset();
    }
  }

  function onClickCapture(event: MouseEvent): void {
    if (!dragged) {
      return;
    }
    dragged = false;
    event.preventDefault();
    event.stopPropagation();
  }

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', onCancel);
  node.addEventListener('click', onClickCapture, true);

  return {
    destroy() {
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onCancel);
      node.removeEventListener('click', onClickCapture, true);
    }
  };
}
