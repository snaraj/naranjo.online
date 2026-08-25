<!-- StatTracker renders grids of stat cells inside the shared PanelShell:
  each grid a dense table of three columns — small icon (or its initials
  fallback), a right-aligned figure — wrapping downward and ending where the
  data ends. It is a generic primitive with NO domain knowledge: every name,
  figure, label and detail arrives through StatTrackerProps (lib/blocks.ts),
  built by an adapter in the binding layer. The game-stats block renders it
  today; a fitness block renders it tomorrow without an edit here.

  Two grid scales, both laid out the way the owner's reference client lays
  its readout panel out (issue 127; the reference is named where the domain
  lives, in the binding layer): `compact` is the fixed-rhythm readout grid
  — 18px icons, 1.625rem cells, optionally closed by captioned total cells
  filling the last row's gap — and `roomy` is the taller tally grid with 26px
  icons. Which rows land in which grid is the adapter's decision, not this
  file's.

  The grids do not scroll (owner directive, issue 134): "it doesn't need
  scrolling if it just goes down in columns of 3". The tally grid has been all
  three arrangements — a tall box that scrolled down inside the card, then a
  two-row strip that scrolled sideways, and now the same three-column table
  the readout grid uses, wrapping downward. The scroll region is GONE rather
  than merely unused: the tracks are minmax(0, 1fr), so three columns always
  fit the card exactly and there is never a width at which either box has
  something to scroll to. A figure squeezed by a very narrow card truncates
  with an ellipsis and keeps its full number in the cell's accessible name and
  its detail, because a silently clipped number is a wrong number.

  Every tile in every grid carries the same detail, through the same primitive
  (DetailTip, issue 136 rule 1), with content the adapter built from the pure
  builders beside its data. A cell whose source ships no icon renders a clean
  initials tile rather than a hole.

  A row listed without a rank is real information, not a gap: its figure may
  still be genuine, so the cell is muted rather than hidden and the detail
  says the state in words. Cells have fixed dimensions and icons declare their
  box and load lazily, so nothing shifts as data or images arrive. -->
<script lang="ts">
  import DetailTip from './DetailTip.svelte';
  import PanelShell from './PanelShell.svelte';
  import type { StatTrackerProps } from '../blocks.ts';

  let { title, status, generatedAt, grids, note }: StatTrackerProps = $props();
</script>

<PanelShell {title} {status} {generatedAt}>
  {#each grids as grid (grid.key)}
    {#if grid.cells.length > 0 || !grid.emptyNote}
      {@const iconSize = grid.size === 'compact' ? 18 : 26}
      <ul class="stat-grid" data-cells={grid.size} aria-label={grid.label}>
        {#each grid.cells as cell (cell.key)}
          <!-- Focusable so the detail's keyboard reveal matches its hover
            reveal; there is no action to perform, so a button would be the
            wrong semantics. -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <!-- The muted flag renders as data only where the adapter states it:
            a grid whose source never ranks its rows carries no attribute at
            all, so the DOM never claims a distinction the data does not
            draw. -->
          <li
            class="stat-cell"
            tabindex="0"
            data-muted={cell.muted === undefined ? undefined : String(cell.muted)}
            aria-label={cell.label}
          >
            {#if cell.icon}
              <img
                class="stat-icon"
                src={cell.icon}
                alt=""
                width={iconSize}
                height={iconSize}
                loading="lazy"
                decoding="async"
              />
            {:else}
              <span class="stat-icon stat-glyph" aria-hidden="true">{cell.glyph}</span>
            {/if}
            <span class="stat-figure">{cell.figure}</span>
            <DetailTip detail={cell.detail} />
          </li>
        {/each}
        <!-- The captioned totals that close the grid's last row. They are
          cells of the same grid, not a caption under it, because the gap is
          what they exist to close. -->
        {#each grid.closing ?? [] as cell (cell.key)}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <li class="stat-cell stat-closing" tabindex="0" aria-label={cell.label}>
            <span class="stat-closing-caption" aria-hidden="true">{cell.caption}</span>
            <span class="stat-figure">{cell.figure}</span>
            <DetailTip detail={cell.detail} />
          </li>
        {/each}
      </ul>
    {:else}
      <p class="stat-note">{grid.emptyNote}</p>
    {/if}
  {/each}
  {#if grids.length === 0 && note}
    <p class="stat-note">{note}</p>
  {/if}
</PanelShell>

<style>
  /* Both scales share the reference client's cell chrome: a hairline gap over the
     border color reads as a grid rule without a border per cell, and the
     tracks are minmax(0, 1fr) so three columns always fit the card at every
     width and neither box ever has a scrollable overflow to reveal. The
     tracks cannot be given a fixed width instead — a bare 5.25rem minimum
     would lay out 252px of columns in a 266px card at 320px and, one narrower
     device later, scroll. */
  .stat-grid {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    background: var(--panel-border, rgb(23, 23, 23));
    border: 1px solid var(--panel-border, rgb(23, 23, 23));
  }

  /* The compact grid never scrolls either, and for the further reason that
     its size is known before any data arrives: a fixed cell count tiles it
     exactly, so the card's geometry is identical before and after the
     payload lands. */
  .stat-grid[data-cells='compact'] {
    flex: none;
  }

  .stat-cell {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    /* A cell must be allowed to shrink below the width of its own contents,
       or three of them refuse to fit the column on a phone and the table
       scrolls sideways with the leading digits cut off. */
    min-inline-size: 0;
    padding-inline: 0.25rem;
    background: var(--panel-surface, rgb(40, 40, 40));
  }

  .stat-grid[data-cells='compact'] .stat-cell {
    block-size: 1.625rem;
  }

  /* No containing block here, deliberately. The detail is anchored to the
     VIEWPORT rather than to whichever tile spawned it (see lib/tooltip.ts) —
     which is what lets it follow the cursor, and what makes it impossible for
     it to grow the document or be clipped by an ancestor. A relative position
     on this rule would be inert, and inert declarations are how the next
     reader concludes the tip is still cell-anchored. */
  .stat-grid[data-cells='roomy'] .stat-cell {
    block-size: var(--stat-cell-height, 2.125rem);
  }

  /* The totals that close the compact grid's last row. Same cell, different
     contents: a short caption where a stat shows its icon, so the pair reads
     as part of the table rather than as a caption stuck to the end of it.
     Both figures are held on one line at every width — a wrapped number in a
     1.625rem cell would spill over the row below it — and the full name rides
     the accessible text, which is where it fits and a 320px column does not. */
  .stat-closing {
    /* Tighter than a stat cell's gap on purpose: a nine-digit total plus its
       caption is the widest thing this table ever has to fit, and the
       narrowest column it has to fit into is a third of a 320px card.
       MEASURED there at 72px of content in 79px of cell. */
    gap: 0.125rem;
    white-space: nowrap;
    overflow: hidden;
  }

  .stat-closing-caption {
    flex: none;
    font-size: 0.5625rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  /* Every tile is a focus stop, so every tile wears the same ring. */
  .stat-cell:focus-visible {
    outline: 1px solid var(--panel-accent, rgb(220, 138, 0));
    outline-offset: -1px;
  }

  .stat-grid[data-cells='compact'] .stat-icon {
    flex: none;
    inline-size: 18px;
    block-size: 18px;
    object-fit: contain;
  }

  .stat-grid[data-cells='roomy'] .stat-icon {
    flex: none;
    inline-size: 26px;
    block-size: 26px;
    object-fit: contain;
  }

  .stat-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.625rem;
    font-weight: 650;
    color: var(--panel-accent, rgb(220, 138, 0));
    border: 1px solid var(--panel-border, rgb(23, 23, 23));
    border-radius: 3px;
  }

  /* A muted tile is dimmed rather than hidden: the figure beside it can
     still be real, and the detail says the state in words. */
  .stat-cell[data-muted='true'] .stat-figure {
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  /* A figure squeezed by a very narrow card truncates VISIBLY. The cells
     shrink with the column instead of scrolling, so the last defence against
     a card too narrow for its own digits is the ellipsis: a silently clipped
     number reads as a smaller number, and the whole figure is still in the
     cell's accessible name and its detail. */
  .stat-figure {
    flex: 1;
    min-inline-size: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    text-align: right;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .stat-grid[data-cells='compact'] .stat-figure {
    font-size: 0.6875rem;
  }

  /* Strictly more specific than the compact rule above, deliberately: the
     closing cells sit in the compact grid, and the rule that ships the
     narrower figure has to win. Written at equal specificity it silently
     rendered at 11px and overflowed the cell on a 320px phone — MEASURED,
     not theorised. */
  .stat-grid[data-cells='compact'] .stat-closing .stat-figure {
    font-size: 0.625rem;
  }

  /* Every rule that drew, positioned or revealed a detail is GONE from this
     file rather than overridden — no absolute box, no per-column nth-child
     anchoring, no hover reveal — because there is one detail primitive
     (DetailTip) and this component is one of its callers. The containment
     those column rules provided is held by viewport clamping in
     lib/tooltip.ts, at every edge instead of only the inline ones, and
     MEASURED at 320px by the browser lanes. */

  .stat-note {
    margin: 0;
    font-size: 0.75rem;
    color: var(--panel-muted, rgb(158, 158, 158));
  }
</style>
