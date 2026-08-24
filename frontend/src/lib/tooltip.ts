/* The page's ONE hover-detail mechanism: the placement arithmetic and the
 * behaviour that drives it, kept out of the component so both halves are
 * executable rather than pattern-matched (the arrangement lib/bossLog.ts and
 * lib/feed.ts already use).
 *
 * WHY IT MOVED. The boss detail used to be an absolutely positioned box
 * anchored to its own grid cell, opening toward the end edge in the first
 * column, from its own centre in the middle one and toward the start edge in
 * the last. That anchoring existed for a real reason — a tip is wider than a
 * cell, so a start-anchored one in the last column hangs past the card, and an
 * absolutely positioned box with no clipping ancestor drags the DOCUMENT
 * sideways when it does, which is the floor this site is pinned against at
 * 320px. It also had a cost the owner named: the box appears where the CELL
 * is, not where the POINTER is, so hovering a tile near the end of a row put
 * the readout a full row away from the finger that asked for it.
 *
 * The replacement keeps the guarantee and drops the cost. The tip is
 * `position: fixed`, so its containing block is the viewport and no ancestor's
 * overflow can clip it and no anchor of it can grow the document — a fixed box
 * is outside the scrollable overflow region by construction. Clamping then
 * does the job the per-column anchoring did, and does it at every edge rather
 * than only the inline ones: the tip flips to the other side of its anchor
 * near the end and bottom edges and clamps at the start and top ones, so it
 * cannot reach past the viewport whatever it is anchored to.
 *
 * TWO ANCHORS, ONE PRIMITIVE. What differs between a mouse and a finger is
 * only WHERE the box is anchored, so that is the only thing that branches:
 *
 *   - a fine pointer (mouse, trackpad) anchors the tip to the POINTER, offset
 *     by --tip-pointer-gap, and re-anchors as the pointer moves;
 *   - a finger or a keyboard has no pointer to follow, so the tip anchors to
 *     the CELL, centred over it and flipped below when there is no room above.
 *
 * The split is a capability question — matchMedia('(hover: hover) and
 * (pointer: fine)') plus the pointerType the event itself reports — and never
 * a user-agent string. A touch on a hybrid laptop, which answers the media
 * query as a fine pointer because it also has a trackpad, still takes the
 * anchored branch, because the EVENT knows it was a finger.
 *
 * The move handler is rAF-throttled and does no layout reading at all: the
 * tip's box, the viewport and the two spacing tokens are measured once when
 * the tip opens, so a flood of pointermove events costs arithmetic and two
 * custom-property writes per FRAME rather than per event. */

/* One labelled figure in a detail: "KC", "1,234". */
export interface TipRow {
  label: string;
  value: string;
}

/* The whole of a detail's content. Every consumer builds one of these and the
 * primitive renders it, which is what keeps two callers from drifting into two
 * presentations of the same idea. */
export interface TipDetail {
  name: string;
  rows: TipRow[];
}

export interface TipSize {
  width: number;
  height: number;
}

export interface TipPoint {
  x: number;
  y: number;
}

/* The anchor a cell offers: the box it occupies, in viewport coordinates. */
export interface TipRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/* The box the tip must stay inside: the visual viewport, excluding scrollbars. */
export interface TipFrame {
  width: number;
  height: number;
}

/* The two spacing decisions placement makes, both read from tokens at runtime
 * (--tip-pointer-gap, --tip-edge-margin) so they are tweakable exactly like
 * every other dimension of the card system (issue #136 rule 3). */
export interface TipMetrics {
  /* How far the tip sits from whatever it is anchored to. */
  gap: number;
  /* How close to a viewport edge the tip is allowed to come. */
  margin: number;
}

/* The values the tokens carry. Duplicated here ONLY as the fallback for a
 * document whose stylesheet has not resolved — and pinned against styles.css
 * by a parity test, each failure naming the other file, so the two can never
 * quietly disagree. */
export const tipMetricsFallback: TipMetrics = { gap: 12, margin: 4 };

/* The capability that decides which anchor a reader gets. A pointer that can
 * hover AND is fine enough to aim is a pointer worth following; anything else
 * has no cursor for a tip to track. */
export const finePointerQuery = '(hover: hover) and (pointer: fine)';

/* A CSS length in pixels, or null when this parser cannot read it. Null is
 * never treated as "fine": the caller falls back to the pinned constant above
 * rather than placing a tip at NaN. */
export function pixelLength(value: string): number | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)px\s*$/.exec(value);
  if (match === null) {
    return null;
  }
  const px = Number(match[1]);
  return Number.isFinite(px) ? px : null;
}

/* One axis of the containment rule: never past the near edge, never past the
 * far one. The near-edge clamp is written LAST so it wins — a tip wider than
 * the space it has left is pinned to the start edge rather than pushed off the
 * opposite one, which is the difference between a squeezed readout and a
 * readout nobody can see. */
export function clampAxis(desired: number, size: number, extent: number, margin: number): number {
  return Math.max(margin, Math.min(desired, extent - margin - size));
}

/* The pointer anchor: down and to the end side of the cursor by one gap,
 * flipping to the other side of it when that would cross an edge. The flip is
 * what keeps the tip from ever being clamped ONTO the cursor near the end and
 * bottom edges, which is where a merely-clamped tip covers the very tile the
 * reader is pointing at. */
export function pointerPlacement(
  pointer: TipPoint,
  size: TipSize,
  frame: TipFrame,
  metrics: TipMetrics
): TipPoint {
  const forward = { x: pointer.x + metrics.gap, y: pointer.y + metrics.gap };
  const fits = {
    x: forward.x + size.width <= frame.width - metrics.margin,
    y: forward.y + size.height <= frame.height - metrics.margin
  };
  return {
    x: clampAxis(
      fits.x ? forward.x : pointer.x - metrics.gap - size.width,
      size.width,
      frame.width,
      metrics.margin
    ),
    y: clampAxis(
      fits.y ? forward.y : pointer.y - metrics.gap - size.height,
      size.height,
      frame.height,
      metrics.margin
    )
  };
}

/* The cell anchor, for readers with no cursor: centred over the tile and one
 * gap above it, flipped below when the tile is too near the top of the
 * viewport for the tip to fit above it. */
export function anchoredPlacement(
  cell: TipRect,
  size: TipSize,
  frame: TipFrame,
  metrics: TipMetrics
): TipPoint {
  const above = cell.top - metrics.gap - size.height;
  const fits = above >= metrics.margin;
  return {
    x: clampAxis(
      cell.left + (cell.right - cell.left) / 2 - size.width / 2,
      size.width,
      frame.width,
      metrics.margin
    ),
    y: clampAxis(
      fits ? above : cell.bottom + metrics.gap,
      size.height,
      frame.height,
      metrics.margin
    )
  };
}

/* What opened the tip, and therefore what closes it. Tracking the origin is
 * what keeps a tab away from a hovered tile from closing a tip the mouse is
 * still on, and a second tap from being read as a first one. */
type TipOrigin = 'pointer' | 'focus' | 'touch';

interface OpenTip {
  close(): void;
}

/* At most one detail is open at a time, page-wide. Two readouts on screen at
 * once is the state a tip that never closes produces, and it is also how a
 * stale one survives a tap somewhere else. */
let opened: OpenTip | null = null;

/* hoverDetail is the whole behaviour, applied to the tip element itself: it
 * binds the CELL around it as the hover target and positions the tip inside
 * the viewport. The action lives on the tip rather than the cell so a caller
 * adds a detail by rendering the primitive and nothing else — there is no
 * second thing to remember to wire up, which is precisely how two call sites
 * drift into two behaviours.
 *
 * `report` is how the component learns the box is open. Visibility is the
 * primitive's own reactive state rather than an attribute written from here,
 * so the reveal rule is a selector the compiler can SEE — a runtime-only
 * attribute is a rule Svelte prunes as unused, which is a tooltip that never
 * appears and a build that says nothing. Position is the opposite case and
 * stays a direct style write: it changes every frame of a follow, and routing
 * that through the reactive graph would put a scheduler between a pointer and
 * a box that is supposed to track it.
 *
 * A tip with no parent element and no window has nothing to attach to; it
 * returns an inert handle rather than throwing, because a component rendered
 * outside a document is a test harness, not a defect. */
export function hoverDetail(node: HTMLElement, report: (open: boolean) => void) {
  const parent = node.parentElement;
  const owner = node.ownerDocument.defaultView;
  return parent === null || owner === null
    ? { destroy() {} }
    : bindDetail(node, parent, owner, report);
}

function bindDetail(
  node: HTMLElement,
  host: HTMLElement,
  view: Window & typeof globalThis,
  report: (open: boolean) => void
) {
  const fine = view.matchMedia(finePointerQuery);

  let shown = false;
  let origin: TipOrigin = 'pointer';
  let follows = false;
  let frame = 0;
  let pending: TipPoint | null = null;
  /* Measured once per opening and reused for every frame of the follow, so
     the move path reads no layout at all. */
  let size: TipSize = { width: 0, height: 0 };
  let viewport: TipFrame = { width: 0, height: 0 };
  let metrics: TipMetrics = tipMetricsFallback;
  /* Where the tile was when the tip opened. A fixed box does not travel with
     the page, so the tip must go when the tile moves out from under it — but
     the TEST is whether the tile moved, not whether a scroll event arrived.
     Those are different questions, and answering the easy one was a real
     defect: scroll events are delivered at a rendering opportunity rather
     than synchronously, so a scroll that finished BEFORE the pointer arrived
     still lands after it, and the detail closed itself in the same frame it
     opened. MEASURED in Chromium at 28ms after pointerenter. */
  let anchor: TipRect = { left: 0, top: 0, right: 0, bottom: 0 };

  const self: OpenTip = { close: hide };

  function place(at: TipPoint): void {
    node.style.setProperty('--tip-x', `${at.x}px`);
    node.style.setProperty('--tip-y', `${at.y}px`);
  }

  /* Every layout read the tip needs, taken together and BEFORE anything is
     written, so opening costs one style/layout pass rather than one per
     question asked. */
  function measure(): TipRect {
    const box = node.getBoundingClientRect();
    const cell = host.getBoundingClientRect();
    const root = view.document.documentElement;
    const style = view.getComputedStyle(node);
    size = { width: box.width, height: box.height };
    viewport = { width: root.clientWidth, height: root.clientHeight };
    metrics = {
      gap: pixelLength(style.getPropertyValue('--tip-pointer-gap')) ?? tipMetricsFallback.gap,
      margin: pixelLength(style.getPropertyValue('--tip-edge-margin')) ?? tipMetricsFallback.margin
    };
    return { left: cell.left, top: cell.top, right: cell.right, bottom: cell.bottom };
  }

  function reveal(pointer: TipPoint | null, from: TipOrigin): void {
    anchor = measure();
    follows = pointer !== null;
    place(
      pointer === null
        ? anchoredPlacement(anchor, size, viewport, metrics)
        : pointerPlacement(pointer, size, viewport, metrics)
    );
    if (opened !== null && opened !== self) {
      opened.close();
    }
    origin = from;
    if (shown) {
      return;
    }
    shown = true;
    opened = self;
    report(true);
    /* Both listeners ask whether the world MOVED, never merely whether an
       event arrived — see the anchor comment above. They also keep the
       cached measurements honest: nothing can resize the viewport or shift
       the tile while a tip is open without closing it first. */
    view.addEventListener('scroll', onScrolled, { capture: true, passive: true });
    view.addEventListener('resize', onResized);
    view.addEventListener('pointerdown', onElsewhere, true);
  }

  function hide(): void {
    if (!shown) {
      return;
    }
    shown = false;
    follows = false;
    if (opened === self) {
      opened = null;
    }
    report(false);
    if (frame !== 0) {
      view.cancelAnimationFrame(frame);
      frame = 0;
    }
    pending = null;
    view.removeEventListener('scroll', onScrolled, true);
    view.removeEventListener('resize', onResized);
    view.removeEventListener('pointerdown', onElsewhere, true);
  }

  /* Half a pixel: below that a difference is layout arithmetic on a
     fractional device ratio, not the page having moved. */
  const stillPx = 0.5;

  function onScrolled(): void {
    const now = host.getBoundingClientRect();
    if (Math.abs(now.top - anchor.top) < stillPx && Math.abs(now.left - anchor.left) < stillPx) {
      return;
    }
    hide();
  }

  function onResized(): void {
    const root = view.document.documentElement;
    if (root.clientWidth === viewport.width && root.clientHeight === viewport.height) {
      return;
    }
    hide();
  }

  function onElsewhere(event: Event): void {
    const target = event.target;
    if (target instanceof Node && host.contains(target)) {
      return;
    }
    hide();
  }

  function onEnter(event: PointerEvent): void {
    /* A finger produces pointerenter too, immediately before its
       pointerdown. Ignoring it here is what makes the tap a TOGGLE rather
       than an open that a second tap re-opens. */
    if (event.pointerType === 'touch') {
      return;
    }
    reveal(fine.matches ? { x: event.clientX, y: event.clientY } : null, 'pointer');
  }

  function onMove(event: PointerEvent): void {
    if (!shown || !follows || event.pointerType === 'touch') {
      return;
    }
    pending = { x: event.clientX, y: event.clientY };
    /* THE THROTTLE. A pointer can report far more moves than the display can
       draw, and every one of them would otherwise be a style write. The
       guard is what collapses a flood into exactly one placement per frame,
       and the frame that runs uses the LAST position rather than the first,
       so coalescing never means lagging. */
    if (frame !== 0) {
      return;
    }
    frame = view.requestAnimationFrame(() => {
      frame = 0;
      const next = pending;
      pending = null;
      if (next !== null && shown && follows) {
        place(pointerPlacement(next, size, viewport, metrics));
      }
    });
  }

  function onLeave(event: PointerEvent): void {
    if (event.pointerType === 'touch' || origin !== 'pointer') {
      return;
    }
    hide();
  }

  function onDown(event: PointerEvent): void {
    if (event.pointerType !== 'touch') {
      return;
    }
    if (shown && origin === 'touch') {
      hide();
      return;
    }
    reveal(null, 'touch');
  }

  function onFocus(): void {
    /* Only a keyboard reveal. A click focuses the cell too, and that reader
       already has the tip through hover — opening a second, cell-anchored
       one under their cursor would be the flicker this primitive exists to
       avoid. */
    if (!host.matches(':focus-visible')) {
      return;
    }
    reveal(null, 'focus');
  }

  function onBlur(): void {
    if (origin !== 'focus') {
      return;
    }
    hide();
  }

  host.addEventListener('pointerenter', onEnter);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerleave', onLeave);
  host.addEventListener('pointerdown', onDown);
  host.addEventListener('focusin', onFocus);
  host.addEventListener('focusout', onBlur);

  return {
    destroy() {
      hide();
      host.removeEventListener('pointerenter', onEnter);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('focusin', onFocus);
      host.removeEventListener('focusout', onBlur);
    }
  };
}
