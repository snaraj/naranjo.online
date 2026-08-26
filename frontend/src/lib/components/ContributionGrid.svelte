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

  Its INLINE size used to be its data, in columns (issue #141, residual risk
  2: a fifteen-day series was three columns pinned to the left edge of
  fifty-three columns of nothing, which read as a graph that had lost its
  data rather than as a short one). Issue 189 SUPERSEDES that rule for any
  series lib/grid.ts's calendarColumns can date: it always hands back exactly
  pendingWeeks columns, front-padded with dated-but-absent cells when the
  series is younger than the window, so `columns.length` is pendingWeeks by
  construction and stripColumns' floor never engages for it — the "lost its
  data" misread that rule protected against cannot recur once the window's
  own faint absent cells and month axis say where the real data starts. The
  cap below is what stays: a MAXIMUM rather than a width, so a narrow screen
  still shrinks the block and the strip still scrolls inside itself, whatever
  produced its column count.

  Sizing to content and reserving space are not in tension here, and the
  reason is arithmetic rather than luck: the empty state's chrome is one year
  wide, the calendar that lands in it is one year wide, and now a short
  series padded up to the window is ALSO one year wide, so no arrival changes
  this dimension. Every side of that equality is pinned — pendingWeeks in
  lib/grid.ts, calendarColumns' own fixed-width construction, and the
  shipped calendar in the origin's own test — and the rendering lanes measure
  the box across a real arrival.

  Two axes (issue 189, matched to owner-supplied reference designs): a
  three-letter month tick above the strip, at the column each month begins
  and inside it — scrolling with the cells, since a month label only means
  anything beside the columns it names — and a Mon/Wed/Fri weekday gutter
  BESIDE the strip, in its own flex row so the labels stay put while the
  cells scroll past them. Both read lib/grid.ts's weekdayAxis, the single
  place the Sunday-start convention (verified against the origin's own
  vcs-activity payload) is written down, so the two grids can never disagree
  about which row a Wednesday is.

  It opens on the NEWEST data (owner directive, issue 127). Cells run oldest
  first, so a strip that opens where its content starts opens on January and
  hides everything the visitor came to see off the right edge; the strip is
  scrolled to its end as soon as its content changes size, and history is one
  swipe to the left. The scroll position is set outright rather than animated:
  this is where the strip STARTS, not a journey the reader takes, so there is
  no motion for a reduced-motion preference to be asked about.

  With no columns it renders the graph's chrome and says so, instead of
  replacing the graph with a sentence. Every placeholder cell is absent —
  valueless, undated and marked decorative — because a fabricated zero would
  look like a quiet day, and the honest rendering of no data is a graph with
  no data in it.

  That state is a RESERVE FOR A PAYLOAD IN FLIGHT and nothing else, and the
  distinction is the whole of the owner's ruling of 2026-08-24. It holds open
  exactly the box the arriving data will fill — measured, in the rendering
  lanes — so a calendar that lands a moment after first paint lands without
  moving the page. It is NOT a rendering for a source that has already
  answered and said it keeps no daily record: nothing is on its way there, and
  a box held open forever is a permanent hole, not layout stability. A caller
  that knows there is no series to wait for renders no grid at all — see the
  token panel, which gates its whole graph region on having columns to draw.

  How that state LOOKS is a separate decision from what it contains, and the
  two were conflated until issue 134. The placeholders used to be drawn as
  holes, identically to a missing day inside a real window, which made an
  empty panel read as a graph that failed to load. They now render as one
  flat, even field inside a framed plate, under a label set as a state rather
  than as an apology, with the magnitude legend hidden because there is no
  magnitude to explain — see the empty treatment in the styles below. Not one
  datapoint moved.

  Issue 189 carries that same finding one step further, into a real series: a
  day INSIDE the window the strip draws — before the series existed, or a
  future day in the calendar week that has not happened yet — is absent for
  exactly the reason issue 134 named, and reads the same way now: a faint,
  filled field, not an outlined hole. The distinction issue 134 drew stays
  exact underneath the paint — absent still means no count, a level-0 cell is
  still a real measured zero, and cellLabel still refuses to read a value off
  an absent one — only the two states' PAINT converged, because both are the
  identical honest "nothing was measured here" this component has always
  meant by absent. -->
<script lang="ts">
  import {
    cellLabel,
    cellPeriod,
    formatWhole,
    gridLevel,
    gridLevels,
    monthTicks,
    peakValue,
    pendingColumns,
    stripColumns,
    weekdayAxis,
    type GridCell,
    type SeriesView,
    type ValueFormat
  } from '../grid';
  import DetailTip from './DetailTip.svelte';

  let {
    columns,
    noun = 'contribution',
    view = 'daily' as SeriesView,
    label,
    showMonths = true,
    emptyNote = 'no activity data',
    fullWidth = false,
    cardTitle,
    formatValue = formatWhole
  }: {
    columns: GridCell[][];
    noun?: string;
    view?: SeriesView;
    label: string;
    showMonths?: boolean;
    emptyNote?: string;
    /* How a cell's figure is written out, in the card AND in the accessible
       text, so the two can never disagree (owner directive, 2026-08-25). The
       default is exact digits, which is right for the calendar: a reader
       wants "3 contributions", not "3.0". A series whose days run to nine
       digits passes formatMagnitude instead — "627.7M tokens on Aug 11"
       rather than the log line that was there. */
    formatValue?: ValueFormat;
    /* The strip claims its container's full width instead of just the
       columns it draws (issue 178: the token panel's graph rendered as a
       tiny left-aligned block beside a card the other trackers fill).
       BOTH of this site's grids ask for it now (owner directive,
       2026-08-25: the contribution calendar "stops well short of the card's
       right edge", the same dead gap the token panel was fixed for). It
       stays a prop rather than becoming the component's only behaviour
       because the two questions are genuinely separate — how many columns
       there are is the caller's data, whether the block stretches to its
       container is the caller's layout — and a caller that wants a
       content-sized strip is a prop away rather than a fork of this
       component. */
    fullWidth?: boolean;
    /* When set, a cell's detail is the page's OSRS-style card (DetailTip)
       instead of the browser's native title= tooltip, titled with this text
       and showing the cell's value alone — no date, which the axes already
       carry (issue 178). Opt-in for the same reason fullWidth is: the
       calendar keeps its native tooltip. */
    cardTitle?: string;
  } = $props();

  const legendLevels = Array.from({ length: gridLevels }, (_, level) => level);
  const peak = $derived(peakValue(columns.flat()));
  const ticks = $derived(showMonths ? monthTicks(columns) : []);
  const chrome = pendingColumns();

  /* The block's width, in columns, handed to the stylesheet as a number so
     the geometry is decided once — here, from the columns actually drawn —
     instead of being a constant the CSS guesses at. The empty state sizes
     itself to the chrome it renders for exactly the same reason the series
     state sizes itself to its data: whichever is on screen, the box is the
     box its contents need. And because the chrome is one year wide and the
     calendar that replaces it is one year wide, that arrival changes no
     dimension at all. */
  const claimedColumns = $derived(
    stripColumns(columns.length > 0 ? columns.length : chrome.length)
  );

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
<div
  class="grid-block"
  data-grid-state={columns.length > 0 ? 'series' : 'empty'}
  data-grid-columns={claimedColumns}
  data-grid-fullwidth={fullWidth}
  style:--grid-columns={claimedColumns}
>
  <!-- The weekday gutter (issue 189) sits OUTSIDE the scrolling strip, in its
    own row of this flex pair, so a Mon/Wed/Fri label stays put while the
    cells beside it scroll past — a label that scrolled with the strip would
    read a different weekday every time the reader dragged it. It renders in
    both states: this is calendar structure (weekdayAxis, lib/grid.ts), never
    data, so the pending/empty chrome carries it exactly like a real series
    does, and only the undated month axis below is series-only. aria-hidden
    because every cell already carries its own weekday inside its date. -->
  <div class="grid-body">
    <div class="grid-weekday-axis" aria-hidden="true">
      {#each weekdayAxis as weekday (weekday.row)}
        <span class="grid-weekday" style:grid-row={weekday.row + 1}>{weekday.label}</span>
      {/each}
    </div>
    <!-- The strip clips wide windows behind its own horizontal scrollbar, and a
      scrollable region is keyboard-reachable only when focusable, so the
      tabindex is deliberate. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="grid-strip" role="region" aria-label={label} tabindex="0" bind:this={strip}>
      {#if columns.length > 0}
        <div class="grid-cells">
          {#each columns as column}
            {#each column as cell}
              {@const text = cellLabel(cell, noun, view, formatValue)}
              {#if cardTitle && !cell.absent}
                <!-- Mirrors BossLog's own cell: the visible tile doubles as the
                  DetailTip host, so the card is the whole of adding a detail
                  and there is no separate wrapper to keep in step (issue
                  178). aria-label keeps the full value-and-date reading for
                  assistive tech; the card shows the value AND the
                  view-scoped period phrase (issue 189, amending #178's
                  value-only decision to match the owner's reference
                  designs) — both rows label-less, so cellPeriod supplies the
                  ONLY date reading in the card, the same phrase cellLabel
                  folds into the accessible text above. -->
                <span
                  class="grid-cell"
                  data-grid-cell
                  data-grid-absent="false"
                  data-grid-level={gridLevel(cell.value, peak)}
                  role="img"
                  aria-label={text}
                  tabindex="0"
                >
                  <DetailTip
                    detail={{
                      name: cardTitle,
                      rows: [
                        { label: '', value: formatValue(cell.value) },
                        { label: '', value: cellPeriod(cell, view) }
                      ]
                    }}
                  />
                </span>
              {:else}
                <span
                  class="grid-cell"
                  data-grid-cell
                  data-grid-absent={cell.absent ? 'true' : 'false'}
                  data-grid-level={cell.absent ? '' : gridLevel(cell.value, peak)}
                  role="img"
                  aria-label={text}
                  title={text}
                ></span>
              {/if}
            {/each}
          {/each}
        </div>
        {#if ticks.length > 0}
          <p class="grid-months" aria-hidden="true">
            {#each ticks as tick}
              <span class="grid-month" style:grid-column={tick.column + 1} title={tick.name}>
                {tick.abbrev}
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
    /* The block is exactly as wide as its two horizontal neighbors need,
       side by side: the weekday gutter, the row-gap beside it, and n cells
       plus their n-1 gaps. A CAP rather than a width, so the box still
       shrinks on a narrow screen and the strip scrolls inside it — a fixed
       width here would push a year of columns past a 320px viewport and take
       the page's own scrollbar sideways with it.

       Issue 189 added the gutter as a THIRD sibling sharing this box's
       horizontal budget with the strip (.grid-body, below): leaving the cap
       at cells-only arithmetic would squeeze the strip narrower than its own
       cells need it to be, and every grid would carry a permanent, pointless
       few pixels of horizontal scroll it never had before. --grid-axis-width
       is what makes that budget exact rather than approximate: the gutter
       below is sized to the SAME token, so the two can never disagree about
       how much of this box belongs to the gutter and how much to the cells.

       --grid-columns is written by the component from the columns it
       actually rendered (see claimedColumns), so the box cannot claim a
       series that is not there. The cell-size and cell-gap custom properties
       are the same ones the cells and the month axis are laid out with, and
       the fallbacks repeat theirs, so the box and its contents can never be
       computed from two different cell sizes. Nothing here reads a
       reading-mode token: the four modes restyle a grid and none of them
       resizes one. */
    max-inline-size: calc(
      var(--grid-axis-width, 1.25rem) + var(--grid-gap, 0.25rem) + var(--grid-columns, 53) *
        (var(--grid-cell-size, 0.625rem) + var(--grid-cell-gap, 0.1875rem)) -
        var(--grid-cell-gap, 0.1875rem)
    );
  }

  /* Full-width call sites (issue 178) drop the content-sized cap and stretch
     the cells to the container's own width instead: each column becomes a
     flexible track floored at the token cell size, so a short series fills
     the card the way every other tracker does and a long one still overflows
     into the strip's own scroll exactly as it always has. */
  .grid-block[data-grid-fullwidth='true'] {
    max-inline-size: none;
    inline-size: 100%;
  }

  .grid-block[data-grid-fullwidth='true'] .grid-cells,
  .grid-block[data-grid-fullwidth='true'] .grid-months {
    /* The fallback is load-bearing, not decoration: --grid-cell-size has no
       :root definition anywhere in this file, only fallback usages, so a
       var() here without one is invalid at computed-value time — which does
       not degrade, it drops this whole declaration to its initial value
       (none) and silently falls through to the capped layout's fixed-size
       columns. MEASURED: that is exactly what shipped here once already. */
    grid-template-columns: repeat(var(--grid-columns), minmax(var(--grid-cell-size, 0.625rem), 1fr));
    inline-size: 100%;
    /* An upper bound on how far a FEW columns may stretch (issue 158). A
       full-width strip divides its container between however many columns it
       drew, which is right at a year's width and wrong at a month's: five
       columns of a thirty-day window drew 88px-wide cells in a 914px card,
       and a heatmap cell nine times wider than it is tall has stopped being
       a heatmap cell. MEASURED at 1440px before this bound existed.

       The bound is per-cell and the caller's to set, because how wide a cell
       may honestly be is a question about the series, not about this
       component. Its default is deliberately unreachable — 100vw per cell
       means the cap can never bind — so a call site that says nothing keeps
       the stretching behaviour it has today, byte for byte. --grid-columns is
       written by the component just above, so this arithmetic is over the
       columns actually drawn rather than an assumption about them; the month
       axis shares the rule so the two can never disagree about their width. */
    max-inline-size: calc(
      var(--grid-columns) * (var(--grid-day-max, 100vw) + var(--grid-cell-gap, 0.1875rem))
    );
  }

  /* The track above stretches; the cell inside it does not, by default — a
     grid item with its OWN declared width is sized to that width and merely
     placed inside a wider track, not stretched to fill it (the CSS Grid
     `stretch` default only governs items whose used width is auto). Scoped
     to `.grid-cells` alone, not `.grid-legend`: the legend's own swatches
     stay the fixed token size in every mode, full width or not. MEASURED:
     without this rule every shape drew an identical 10px cell regardless of
     how many columns shared the row. */
  .grid-block[data-grid-fullwidth='true'] .grid-cells .grid-cell {
    inline-size: auto;
  }

  /* The weekday gutter sits BESIDE .grid-strip (issue 189), not above or
     below it, so it changes this row's INLINE size and never its block
     size — the 7rem arithmetic right below is unaffected by the gutter's
     own width and stays exactly what it already was. align-items: flex-start
     keeps the gutter from being stretched to the strip's full 7rem (cells
     plus month axis plus scrollbar gutter): it only has seven rows of labels
     to draw, sized to match .grid-cells below, and stretching it taller would
     only leave empty grid tracks under real content. */
  .grid-body {
    display: flex;
    align-items: flex-start;
    gap: var(--grid-gap, 0.25rem);
  }

  /* The SAME row template .grid-cells uses (7 rows of --grid-cell-size, the
     same --grid-cell-gap between them) so a label sits exactly on the row it
     names rather than drifting against it — two independent grids computing
     the same seven positions from the same two tokens, not one grid copying
     the other's arithmetic by hand. Sized to the cells alone (5.5rem: 7 *
     --grid-cell-size + 6 * --grid-cell-gap), not the full 7rem strip, so it
     ends exactly where the last cell row does and never reaches into the
     month-axis strip beside it. */
  .grid-weekday-axis {
    display: grid;
    grid-template-rows: repeat(7, var(--grid-cell-size, 0.625rem));
    row-gap: var(--grid-cell-gap, 0.1875rem);
    block-size: calc(7 * var(--grid-cell-size, 0.625rem) + 6 * var(--grid-cell-gap, 0.1875rem));
    /* Fixed rather than intrinsic (issue 189): an un-sized flex child would
       shrink to whatever its widest label's glyphs happen to measure, which
       .grid-block's own cap (above) has no way to read back — the two would
       silently disagree about how wide "the gutter" is the moment a theme's
       font metrics shifted by a pixel. Reading the SAME token both places
       makes the two provably agree instead. 1.25rem clears "Wed"/"Fri" at
       the axis font size in every shipped theme, right-aligned inside it.

       flex: none is what makes "fixed" true rather than nearly true, and it
       is load-bearing under a full-width strip (owner directive, 2026-08-25).
       A declared inline-size is still a flex BASIS: the item may shrink below
       it when the row's items ask for more than the row has. MEASURED, the
       moment the calendar started stretching: the strip's own basis grows
       with its month labels, so this gutter was squeezed to 19.45px in a
       series state and stayed 20px in the empty one — the reserve and the
       arrival disagreeing about the box by half a pixel, which is the
       zero-CLS floor failing quietly. */
    flex: none;
    inline-size: var(--grid-axis-width, 1.25rem);
    font-size: var(--grid-axis-size, 0.5625rem);
    line-height: 1;
    color: var(--grid-axis-color, var(--panel-muted, rgb(158, 158, 158)));
  }

  .grid-weekday {
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  /* The strip's box, DERIVED from the rows it holds rather than stated as one
     number (issue 130). It used to read `block-size: 7rem` under a comment
     claiming "5.5rem of cells, 0.75rem of month axis, 0.75rem of scrollbar
     gutter" — arithmetic that came to 7rem only because it forgot the month
     axis's own 0.1875rem top margin. The real reserve was 0.5625rem: 9px for a
     scrollbar that is 15px on a classic Windows or Linux theme, so the month
     row clipped there (issue 130 reported ~3px against a 12px reserve; the
     margin is why it was worse than that).

     Every term below is now the SAME token the thing it measures is laid out
     with — the cell rows and their gaps from .grid-cells, the axis margin and
     height from .grid-months — so the box cannot be computed from one set of
     numbers while its contents are drawn from another.

     The last term is measured rather than guessed. lib/scrollbar.ts probes the
     platform's real scrollbar thickness before the application mounts and
     writes it here; the fallback is the 12px reserve the stylesheet ships
     with, and the measurement only ever widens past it, never under. A wide
     window scrolling inside the strip still never changes its outer height,
     and data arriving still shifts nothing. Unaffected by the weekday gutter
     beside it (.grid-body, above): that gutter changes this row's INLINE size
     only. */
  .grid-strip {
    block-size: calc(
      7 * var(--grid-cell-size, 0.625rem) + 6 * var(--grid-cell-gap, 0.1875rem) +
        var(--grid-month-gap, 0.1875rem) + var(--grid-month-size, 0.75rem) +
        var(--grid-scrollbar-size, 0.75rem)
    );
    overflow-x: auto;
    overflow-y: hidden;
    flex: 1 1 auto;
    min-inline-size: 0;
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

  /* A day the window does not cover is absent, not a zero, and is still
     labelled as carrying no data (cellLabel refuses to read a value off it
     either way) — but it PAINTS as a faint, filled field now (issue 189),
     not the outlined hole this rule drew before. That is the same finding
     issue 134 made about the panel's OWN empty state — a field of outlines
     reads as a graph that failed to load — extended to a real series' own
     in-window absences (a day before the series existed, or a future day
     in its current week): both classes of absence read identically to a
     reader now, which is honest, because both ARE identical honest
     "nothing was measured here" statements, only on opposite ends of the
     window. This rule is what a pending/empty-state cell would ALSO paint
     as, except that state's own more specific selector
     (.grid-block[data-grid-state='empty'] .grid-cell[data-grid-pending],
     below) overrides it with its own framed-plate treatment — the two
     empty looks stayed deliberately distinct: a whole panel with nothing to
     plot is still a different state from a few missing days inside a real
     one. */
  .grid-cell[data-grid-absent='true'] {
    background: var(--grid-cell-absent, rgba(120, 120, 120, 0.18));
    box-shadow: none;
  }

  .grid-strip .grid-cell:hover {
    outline: 1px solid var(--grid-cell-ring, rgba(255, 255, 255, 0.6));
    outline-offset: 1px;
  }

  /* Its margin and its height are tokens because .grid-strip's own box is
     computed from them (issue 130): two literals here and two more up there
     would be two copies of one fact, free to disagree the day either moved. */
  .grid-months {
    margin: var(--grid-month-gap, 0.1875rem) 0 0;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: var(--grid-cell-size, 0.625rem);
    gap: var(--grid-cell-gap, 0.1875rem);
    inline-size: max-content;
    block-size: var(--grid-month-size, 0.75rem);
    /* The SAME two axis tokens the weekday gutter reads (.grid-weekday-axis,
       above), so the month row and the weekday column always render at one
       shared size and ink rather than two that happen to agree today. */
    font-size: var(--grid-axis-size, 0.5625rem);
    line-height: 1;
    color: var(--grid-axis-color, var(--panel-muted, rgb(158, 158, 158)));
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
