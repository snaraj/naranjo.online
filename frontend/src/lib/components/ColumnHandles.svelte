<script lang="ts">
  import { onMount } from 'svelte';
  import {
    applyStoredColumnWidth,
    browserStore,
    clampColumnRem,
    columnBounds,
    columnKeyIntent,
    columnKeyWidth,
    columnSignFor,
    columnWidthValue,
    documentHost,
    dragColumnRem,
    railsFit,
    railsMediaQuery,
    readColumnTokens,
    writeStoredColumn,
    type ColumnBounds,
    type ColumnDrag,
    type ColumnStore,
    type ColumnTokens
  } from '../columnWidth';

  // Every number, every clamp and every keystroke's meaning lives in
  // columnWidth.ts and is executed by the dependency-free runner. What is left
  // here is the part that genuinely needs a browser: which element was
  // grabbed, where the pointer is, when to ask for the next frame.
  const host = documentHost();
  const store: ColumnStore | null = browserStore();

  // The two edges, named once. Hoisted out of the markup so the keyed each
  // block iterates one stable array rather than a fresh literal on every
  // width change.
  const handles = [
    { edge: 'start', label: 'Page width, start edge' },
    { edge: 'end', label: 'Page width, end edge' }
  ];

  let tokens = $state<ColumnTokens | null>(null);
  // fits is the one condition under which any of this exists: enough viewport
  // for the column, its gutters and both hit lanes. Below it the handles are
  // not rendered at all — matched by a display rule in styles.css, so losing
  // either answer still leaves a phone exactly as it has always been.
  let fits = $state(false);
  let width = $state(0);
  let bounds = $state<ColumnBounds>({ min: 0, max: 0 });
  // Both marks go live during a drag, not just the grabbed one: both edges are
  // moving, and lighting only the one under the finger would make the other
  // look like it had come loose.
  let dragging = $state(false);

  // One drag at a time, tracked by pointer id so a second finger arriving
  // mid-gesture cannot steer the column.
  let drag: ColumnDrag | null = null;
  let capturedBy: HTMLElement | null = null;
  let pointerId = -1;
  // The frame handle and the position waiting for it. Pointer moves arrive far
  // faster than the screen repaints, so a handler that wrote on every one
  // would do several style writes per frame and the browser would throw all
  // but the last away. One write per frame, and the position it writes is
  // whichever arrived last.
  let frame = 0;
  let pendingPx = 0;

  const pixels = (rem: number): number => Math.round(rem * (tokens?.rootFontPx ?? 0));

  // sync re-reads the world: the token layer, whether the rails fit, the
  // bounds now in force, and the width to apply. It is the SAME call the
  // pre-paint path in main.ts makes, so there is one apply path rather than
  // one for arrival and another for everything after it.
  function sync(): void {
    const read = tokens ?? readColumnTokens(host);
    if (read === null) {
      return;
    }
    tokens = read;
    const applied = applyStoredColumnWidth(host, store);
    fits = applied !== null;
    if (applied === null) {
      return;
    }
    width = applied;
    bounds = columnBounds(read, host.viewportPx());
  }

  onMount(() => {
    const read = readColumnTokens(host);
    if (read === null) {
      return;
    }
    tokens = read;
    // The query is BUILT from the tokens, so the script and the stylesheet ask
    // one question. A literal here would be a second copy free to disagree.
    const query = window.matchMedia(railsMediaQuery(read));
    query.addEventListener('change', sync);
    sync();
    return () => {
      query.removeEventListener('change', sync);
    };
  });

  // A resize changes the ceiling (the viewport gives the column less room) and
  // can cross the breakpoint in either direction. Re-running the one apply
  // path answers both at once.
  function onResize(): void {
    if (drag !== null) {
      return;
    }
    sync();
  }

  function setWidth(next: number): void {
    if (next === width) {
      return;
    }
    width = next;
    host.write(columnWidthValue(next));
  }

  function signOf(handle: HTMLElement): -1 | 1 {
    const box = handle.getBoundingClientRect();
    return columnSignFor(box.left + box.width / 2, host.viewportPx());
  }

  function commit(): void {
    frame = 0;
    if (drag === null || tokens === null) {
      return;
    }
    // The bounds were measured once, at the grab. Reading the viewport again
    // here would force the browser to finish layout in the middle of a frame
    // it is still building — the classic read-after-write stall — and the
    // viewport cannot change mid-drag without a resize event that re-syncs.
    setWidth(dragColumnRem(drag, pendingPx, tokens, bounds));
  }

  function onPointerDown(event: PointerEvent): void {
    // Primary button only: a right-click belongs to the context menu, and a
    // middle-click to the browser.
    if (tokens === null || !fits || drag !== null || event.button !== 0) {
      return;
    }
    const handle = event.currentTarget as HTMLElement;
    drag = { sign: signOf(handle), pointerPx: event.clientX, widthRem: width };
    bounds = columnBounds(tokens, host.viewportPx());
    pointerId = event.pointerId;
    capturedBy = handle;
    // Capture is what makes the gesture survive the pointer leaving the 44px
    // lane, which it does immediately — the reader is dragging the edge away
    // from under their own finger. It is an enhancement rather than a
    // requirement, and it throws for a pointer the browser no longer considers
    // active — a race a fast tap can genuinely lose. Losing it costs the drag
    // nothing until the pointer leaves the lane; losing the DRAG to an
    // exception would cost the reader the whole gesture.
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* Uncapturable pointer; the gesture proceeds without capture. */
    }
    dragging = true;
    // The whole page stops selecting text and wears the resize cursor for the
    // duration, so the gesture reads as one action rather than as a control
    // the pointer keeps sliding off.
    document.documentElement.setAttribute('data-column-resizing', '');
  }

  function onPointerMove(event: PointerEvent): void {
    if (drag === null || event.pointerId !== pointerId) {
      return;
    }
    pendingPx = event.clientX;
    if (frame !== 0) {
      return;
    }
    frame = requestAnimationFrame(commit);
  }

  function endDrag(event: PointerEvent): void {
    if (drag === null || event.pointerId !== pointerId) {
      return;
    }
    // A frame still owed carries the reader's last position; dropping it would
    // leave the column a few pixels short of where they let go.
    if (frame !== 0) {
      cancelAnimationFrame(frame);
      commit();
    }
    if (capturedBy?.hasPointerCapture(pointerId) === true) {
      capturedBy.releasePointerCapture(pointerId);
    }
    drag = null;
    capturedBy = null;
    pointerId = -1;
    dragging = false;
    document.documentElement.removeAttribute('data-column-resizing');
    // Persisted once, at the end. Writing storage on every frame would put a
    // synchronous disk-backed call inside the drag's hot path.
    writeStoredColumn(store, width);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (tokens === null || !fits) {
      return;
    }
    const handle = event.currentTarget as HTMLElement;
    const live = columnBounds(tokens, host.viewportPx());
    const next = columnKeyWidth(columnKeyIntent(event.key, signOf(handle)), width, live);
    if (next === null) {
      return;
    }
    // Only for keys this widget answers: Tab still tabs, and an unclaimed
    // arrow still scrolls the page.
    event.preventDefault();
    bounds = live;
    setWidth(next);
    writeStoredColumn(store, next);
  }

  // Double-click on a divider returning it to its default is the convention
  // every editor with a split view already taught the reader.
  function onDoubleClick(): void {
    if (tokens === null || !fits) {
      return;
    }
    const live = columnBounds(tokens, host.viewportPx());
    bounds = live;
    const next = clampColumnRem(tokens.base, live);
    setWidth(next);
    writeStoredColumn(store, next);
  }
</script>

<!-- The reader's grip on the page width (owner directive, 2026-08-24).

  TWO handles, mirrored, and that is a consequence of the layout rather than a
  preference: the column is centred, so both of its edges are equally "the
  edge" and neither has a claim to be the one you drag. Mirroring also makes
  the arithmetic exact — a centred column that grows by two rem puts one on
  each side, so doubling the pointer's travel is what makes the edge track the
  finger one-for-one — and it means the nearer edge is always the one to reach
  for, whichever half of a wide monitor the window is on.

  The ARIA is the WAI-ARIA Authoring Practices Window Splitter pattern
  (https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/), which is exactly
  this widget: role="separator" made FOCUSABLE, which is what promotes a
  separator from a decorative rule to a value-bearing control, plus the value
  trio it then requires. aria-orientation is "vertical" because it describes
  the SEPARATOR — a vertical line dividing what is on either side of it — and
  not the axis it travels along; the ARIA default is horizontal, so a splitter
  between left and right has to say so. The arrows move the splitter and Home
  and End take the column to its minimum and maximum, per the same pattern.

  The values are CSS pixels rather than the percentage the pattern's examples
  use, because a percentage of what is exactly the question a centred column
  cannot answer — the viewport is not the pane's parent in any way a reader
  would recognise. Pixels with an explicit minimum and maximum say the same
  thing without inventing a denominator. -->
<svelte:window onresize={onResize} />

{#if fits}
  {#each handles as handle (handle.edge)}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- Svelte's a11y rules classify `separator` as non-interactive, which is
      true of the ordinary one and false of this one: WAI-ARIA defines
      `separator` as a WIDGET role when it is focusable, and the Window
      Splitter pattern is that form of it. The suppressions are narrow — two
      named rules on one element — because the alternative is a role that
      describes this control less accurately in order to satisfy a linter. -->
    <div
      class="column-handle"
      data-edge={handle.edge}
      data-live={dragging || undefined}
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      aria-label={handle.label}
      aria-valuenow={pixels(width)}
      aria-valuemin={pixels(bounds.min)}
      aria-valuemax={pixels(bounds.max)}
      aria-valuetext="{pixels(width)} pixels"
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={endDrag}
      onpointercancel={endDrag}
      onkeydown={onKeyDown}
      ondblclick={onDoubleClick}
    ></div>
  {/each}
{/if}

<style>
  /* The rails' geometry is in styles.css, in the same rule as the column
     itself, because a handle that computed the column's edge from its own copy
     of that expression would be a second derivation free to drift. What is
     here is what the handle LOOKS like, which is the part that belongs to the
     handle.

     Quiet until touched, which is what "seamless" has to mean for a control
     that is always on screen: at rest the mark paints NOTHING, because the
     ink token resolves to transparent, so there is no hairline sitting on
     the column edge for a reader who is not interacting with it. The 44px
     lane around it is still fully reserved and still invisible; the live
     mark — hover or keyboard focus, in the brand ink every other hover on
     this page answers in — is the only paint this control ever puts on the
     page. */
  .column-handle {
    -webkit-user-select: none;
    user-select: none;
  }

  .column-handle::before {
    content: '';
    position: absolute;
    inset-block: 0;
    inline-size: var(--page-rail-line);
    background: var(--page-rail-ink);
  }

  /* The mark sits on the INNER edge of each lane — against the column, where
     the boundary actually is — rather than in the middle of a 44px strip of
     empty margin. */
  .column-handle[data-edge='start']::before {
    inset-inline-end: 0;
  }

  .column-handle[data-edge='end']::before {
    inset-inline-start: 0;
  }

  /* Hover, focus and the drag itself are one state as far as the mark is
     concerned: the reader is acting on the width, so the edge answers in the
     brand ink every other hover on this page uses and thickens enough to be
     unmistakable without becoming furniture. */
  .column-handle:hover::before,
  .column-handle:focus-visible::before,
  .column-handle[data-live]::before {
    inline-size: var(--page-rail-line-live);
    background: var(--page-rail-ink-live);
  }

  /* The site's focus ring, to the letter — the same width, the same token and
     the same offset as .icon-button and .section-link in styles.css. A control
     that invented its own would be a control a keyboard reader has to learn
     separately. */
  .column-handle:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: no-preference) {
    .column-handle::before {
      transition:
        background-color 120ms ease-out,
        inline-size 120ms ease-out;
    }
  }
</style>
