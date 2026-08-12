<!-- ContributionGrid is the site's ONE contribution heatmap: columns of seven
  daily cells, a magnitude ramp of five levels, an optional month axis, and a
  less/more legend. Both the token-activity grid and the version-control
  contribution calendar render through it, so the two never drift apart.

  It is deliberately dumb: callers pass prepared cells (lib/grid.ts builds
  them), and the component only lays them out. A magnitude is never encoded by
  color alone — every cell carries its count and date as tooltip and
  accessible label — and the grid has a fixed block size with its own
  horizontal scroll, so a wide window scrolls inside the panel and never
  shifts the page. -->
<script lang="ts">
  import { cellLabel, gridLevel, gridLevels, monthTicks, peakValue, type GridCell, type SeriesView } from '../grid';

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
</script>

<div class="grid-block">
  <!-- The strip clips wide windows behind its own horizontal scrollbar, and a
    scrollable region is keyboard-reachable only when focusable, so the
    tabindex is deliberate. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="grid-strip" role="region" aria-label={label} tabindex="0">
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
      <p class="grid-empty">{emptyNote}</p>
    {/if}
  </div>
  <p class="grid-legend" aria-hidden="true">
    <span>less</span>
    {#each legendLevels as level}
      <span class="grid-cell" data-grid-level={level}></span>
    {/each}
    <span>more</span>
  </p>
</div>

<style>
  .grid-block {
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

  .grid-empty {
    margin: 0;
    font-style: italic;
    color: var(--panel-muted, rgb(158, 158, 158));
  }
</style>
