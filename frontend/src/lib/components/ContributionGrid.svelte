<!-- ContributionGrid is the site's ONE contribution heatmap: columns of seven
  daily cells, a magnitude ramp of five levels, an optional month axis, and a
  less/more legend. Both the token-activity grid and the version-control
  contribution calendar render through it, so the two never drift apart.

  It is deliberately dumb: callers pass prepared cells (lib/grid.ts builds
  them), and the component only lays them out. A magnitude is never encoded by
  color alone — every cell carries its count and date as tooltip and
  accessible label — and the grid has a fixed block size with its own
  horizontal scroll, so a wide window scrolls inside the panel and never
  shifts the page.

  It opens on the NEWEST data (owner directive, issue 127). Cells run oldest
  first, so a strip that opens where its content starts opens on January and
  hides everything the visitor came to see off the right edge; the strip is
  scrolled to its end as soon as its content changes size, and history is one
  swipe to the left. The scroll position is set outright rather than animated:
  this is where the strip STARTS, not a journey the reader takes, so there is
  no motion for a reduced-motion preference to be asked about.

  With no series at all it renders the graph's chrome and says so, instead of
  replacing the graph with a sentence. Every placeholder cell is absent —
  valueless, undated and marked decorative — because a fabricated zero would
  look like a quiet day, and the honest rendering of no data is a graph with
  no data in it.

  How that state LOOKS is a separate decision from what it contains, and the
  two were conflated until issue 134. The placeholders used to be drawn as
  holes, identically to a missing day inside a real window, which made an
  empty panel read as a graph that failed to load. They now render as one
  flat, even field inside a framed plate, under a label set as a state rather
  than as an apology, with the magnitude legend hidden because there is no
  magnitude to explain — see the empty treatment in the styles below. Not one
  datapoint moved. -->
<script lang="ts">
  import {
    cellLabel,
    gridLevel,
    gridLevels,
    monthTicks,
    peakValue,
    pendingColumns,
    type GridCell,
    type SeriesView
  } from '../grid';

  let {
    columns,
    noun = 'contribution',
    view = 'daily' as SeriesView,
    label,
    showMonths = true,
    emptyNote = 'no activity data'
  }: {
    columns: GridCell[][];
    noun?: string;
    view?: SeriesView;
    label: string;
    showMonths?: boolean;
    emptyNote?: string;
  } = $props();

  const legendLevels = Array.from({ length: gridLevels }, (_, level) => level);
  const peak = $derived(peakValue(columns.flat()));
  const ticks = $derived(showMonths ? monthTicks(columns) : []);
  const chrome = pendingColumns();

  let strip = $state<HTMLDivElement>();
  /* Bookkeeping, deliberately NOT reactive: these record what has already
     been anchored so the strip is not re-anchored for a change that did not
     move its newest column. -1 is "nothing measured yet", which no real
     count or width can be. */
  let anchoredColumns = -1;
  let anchoredWidth = -1;

  /* Past the maximum on purpose: engines clamp to it, so this asks for "the
     end" without computing it. (This page is LTR; in an RTL document the end
     edge would be the other one.) */
  function anchorToEnd(node: HTMLDivElement): void {
    node.scrollLeft = node.scrollWidth;
  }

  /* Anchoring on the column COUNT rather than on every payload: a
     sixty-second refresh that returns the same window must not yank a reader
     who has scrolled back through their own history, while a window that
     actually grew has a new newest column and belongs on screen. */
  $effect(() => {
    const count = columns.length;
    if (strip === undefined || count === anchoredColumns) {
      return;
    }
    anchoredColumns = count;
    anchoredWidth = strip.clientWidth;
    anchorToEnd(strip);
  });

  /* And again whenever the strip's own box changes width, because the scroll
     position that means "the end" is a function of that box. A card in this
     page's stack genuinely resizes under its content — a viewport change, a
     rotation, a stack that re-tiles — and a strip anchored before the resize
     is left showing the middle of its history afterwards. MEASURED: this is
     what the contribution calendar did at 1920px until the stack stopped
     re-tiling as panels mounted. Height changes are ignored; only the inline
     axis moves the end edge. */
  $effect(() => {
    const node = strip;
    if (node === undefined || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === anchoredWidth) {
        return;
      }
      anchoredWidth = node.clientWidth;
      anchorToEnd(node);
    });
    observer.observe(node);
    return () => observer.disconnect();
  });
</script>

<!-- The state is on the block rather than inferred by a selector, so the
  empty treatment below is one attribute a reader can see in the DOM instead
  of a rule that fires on the absence of something. -->
<div class="grid-block" data-grid-state={columns.length > 0 ? 'series' : 'empty'}>
  <!-- The strip clips wide windows behind its own horizontal scrollbar, and a
    scrollable region is keyboard-reachable only when focusable, so the
    tabindex is deliberate. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="grid-strip" role="region" aria-label={label} tabindex="0" bind:this={strip}>
    {#if columns.length > 0}
      <div class="grid-cells">
        {#each columns as column}
          {#each column as cell}
            {@const text = cellLabel(cell, noun, view)}
            <span
              class="grid-cell"
              data-grid-cell
              data-grid-absent={cell.absent ? 'true' : 'false'}
              data-grid-level={cell.absent ? '' : gridLevel(cell.value, peak)}
              role="img"
              aria-label={text}
              title={text}
            ></span>
          {/each}
        {/each}
      </div>
      {#if ticks.length > 0}
        <p class="grid-months" aria-hidden="true">
          {#each ticks as tick}
            <span class="grid-month" style:grid-column={tick.column + 1} title={tick.name}>
              {tick.initial}
            </span>
          {/each}
        </p>
      {/if}
    {:else}
      <!-- Chrome, and nothing but: no cell here carries a count, a date, or a
        label, and the whole block is hidden from assistive technology so the
        empty note below is the only thing it reads out. There is no month
        axis either — an undated column cannot be labelled with a month it
        was never told. -->
      <div class="grid-cells" aria-hidden="true">
        {#each chrome as column}
          {#each column as _cell}
            <span class="grid-cell" data-grid-pending data-grid-absent="true"></span>
          {/each}
        {/each}
      </div>
    {/if}
  </div>
  {#if columns.length === 0}
    <p class="grid-empty">{emptyNote}</p>
  {/if}
  <p class="grid-legend" aria-hidden="true">
    <span>less</span>
    {#each legendLevels as level}
      <span class="grid-cell" data-grid-level={level}></span>
    {/each}
    <span>more</span>
  </p>
</div>

<style>
  /* Positioned for the empty note alone, which is laid OVER the chrome rather
     than in the column: a note in the flow would make an empty panel a
     different height from a full one, and the day a series arrives the page
     would shift under whoever was reading it. */
  .grid-block {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--grid-gap, 0.25rem);
  }

  /* 7 cell rows plus their 6 gaps measure 5.5rem, the month axis 0.75rem, and
     the remaining 0.75rem is the horizontal scrollbar's reserved gutter — so
     a wide window scrolling inside the strip never changes its outer height
     and data arriving shifts nothing. */
  .grid-strip {
    block-size: 7rem;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .grid-strip:focus-visible {
    outline: 1px solid var(--panel-accent, rgb(220, 138, 0));
    outline-offset: 1px;
  }

  .grid-cells {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(7, var(--grid-cell-size, 0.625rem));
    grid-auto-columns: var(--grid-cell-size, 0.625rem);
    gap: var(--grid-cell-gap, 0.1875rem);
    inline-size: max-content;
  }

  /* The sequential ramp: one hue, monotone lightness — level 0 is a
     near-surface neutral and levels 1..4 step brighter. The theme layer
     restyles or re-anchors the ramp by overriding these five properties. */
  .grid-cell {
    inline-size: var(--grid-cell-size, 0.625rem);
    block-size: var(--grid-cell-size, 0.625rem);
    border-radius: var(--grid-cell-radius, 2px);
    background: var(--grid-cell-0, #383835);
  }

  .grid-cell[data-grid-level='1'] {
    background: var(--grid-cell-1, #1c5cab);
  }

  .grid-cell[data-grid-level='2'] {
    background: var(--grid-cell-2, #2a78d6);
  }

  .grid-cell[data-grid-level='3'] {
    background: var(--grid-cell-3, #5598e7);
  }

  .grid-cell[data-grid-level='4'] {
    background: var(--grid-cell-4, #86b6ef);
  }

  /* A day the window does not cover is a hole, not a zero: outlined, unfilled,
     and labelled as having no data. */
  .grid-cell[data-grid-absent='true'] {
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--grid-cell-absent, rgba(120, 120, 120, 0.35));
  }

  .grid-strip .grid-cell:hover {
    outline: 1px solid var(--grid-cell-ring, rgba(255, 255, 255, 0.6));
    outline-offset: 1px;
  }

  .grid-months {
    margin: 0.1875rem 0 0;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: var(--grid-cell-size, 0.625rem);
    gap: var(--grid-cell-gap, 0.1875rem);
    inline-size: max-content;
    block-size: 0.75rem;
    font-size: 0.5625rem;
    line-height: 1;
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .grid-month {
    grid-row: 1;
  }

  .grid-legend {
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--grid-cell-gap, 0.1875rem);
    block-size: 0.875rem;
    font-size: 0.6875rem;
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .grid-legend span:first-child {
    margin-inline-end: 0.25rem;
  }

  .grid-legend span:last-child {
    margin-inline-start: 0.25rem;
  }

  /* Centred over the chrome it describes, out of flow, so the panel's height
     is identical empty and full. It covers the whole block rather than
     claiming the strip's height for itself: a second copy of that number
     would be a second thing to keep in step with the first.

     Set as a label rather than as an apology. The italic it used to wear is
     the typography of a caveat, and a source that has no daily record is not
     a fault the reader needs apologising to about — it is a state the panel
     is deliberately in. Small caps with letter spacing read as a state; a
     line of italics reads as something that went wrong. */
  .grid-empty {
    position: absolute;
    inset: 0;
    margin: 0;
    display: grid;
    place-items: center;
    font-size: var(--panel-badge-size, 0.6875rem);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  /* The empty treatment, and the reason it is a treatment at all: with no
     series the strip used to be three hundred and seventy-one outlined
     squares — every one of them the rendering a MISSING DAY inside a real
     window gets — which reads as a graph that failed to load rather than as a
     panel with nothing to plot (owner directive, issue 134).

     Nothing about the information changes: the cells stay absent, valueless,
     undated and hidden from assistive technology, so the block still contains
     exactly as many datapoints as the source has reported, which is none. What
     changes is that they stop impersonating holes. A flat, even, near-invisible
     field inside a framed plate is a reserved space; a field of outlines is a
     grid missing its data. Neutral greys on purpose, so the treatment holds in
     every reading mode without the token layer having to know about it.

     The legend goes with them. A less-to-more ramp explains a magnitude
     encoding, and there is no magnitude here to encode — but it keeps its box
     rather than being removed, because the panel's height must not depend on
     whether its series has arrived. */
  .grid-block[data-grid-state='empty'] .grid-cell[data-grid-pending] {
    background: var(--grid-cell-empty, rgba(128, 128, 128, 0.1));
    box-shadow: none;
  }

  /* An inset shadow, never a border: a border would grow the strip's box by
     two pixels and the empty panel would stop being exactly as tall as the
     full one. */
  .grid-block[data-grid-state='empty'] .grid-strip {
    box-shadow: inset 0 0 0 1px var(--grid-empty-frame, rgba(128, 128, 128, 0.2));
    border-radius: var(--grid-empty-radius, 6px);
  }

  .grid-block[data-grid-state='empty'] .grid-legend {
    visibility: hidden;
  }
</style>
