<!-- UsageTracker renders per-source usage inside the shared PanelShell: one
  block per source, straight from UsageTrackerProps (lib/blocks.ts). It is a
  generic primitive with NO domain knowledge — every source label, figure,
  heading and noun arrives as data built by an adapter in the binding layer,
  so a new tool appears by shipping data, never by editing code.

  Each source block is, top to bottom: a tile grid of headline figures (a
  final odd tile spans the full width); the usage windows with their
  utilization meters, the numeric reading always rendered beside the fill so
  severity is never color alone; an activity section whose
  Daily/Weekly/Cumulative toggle re-reads ONE daily series through three
  lenses with no extra payload; and an insights list.

  Every section is optional and every absence is honest. A figure the origin
  does not report arrives as an explicit dash, and a payload that fails
  admission arrives as no sections at all, rendering the empty state — never
  invented numbers.

  Provenance is drawn by EXCEPTION rather than on every figure (owner
  directive, issue 134). The suffix used to render on each tile and each
  insight — around a hundred repetitions on one screen, every one of them the
  same word — which is a label that distinguishes nothing. The adapter
  decides per source (provenanceIsMixed beside the data): figures that all
  share one provenance carry no marker, because the envelope's status already
  says where the payload came from; figures that DISAGREE arrive with
  `marked` set on the recorded ones, because those are the ones that would
  otherwise borrow the freshness of the live figures beside them. Nothing
  left the payload, and the mixed case is exactly what a successful refresh
  produces.

  A source with no daily series renders NO graph region at all (owner ruling,
  2026-08-24) — not an empty one, not a dimmed one, not a placeholder one.
  The two designs before it were both wrong in the same direction. First a
  line of text where the graph belongs, which explained the ORIGIN's refresh
  configuration to a visitor who had asked about usage. Then the graph's
  chrome under a note calling the series unarrived, which was honest about its
  cells — every one absent, valueless and undated — and false about its
  premise, because nothing was on its way. A source that reports no daily
  record is not waiting for one, and space held for data that can never arrive
  is a permanent hole rather than layout stability. So the adapter carries an
  activity region only when there is a series, the render below still gates on
  there being columns to draw, and a seriesless source keeps every figure it
  genuinely has — its tiles, its windows, its insights — with no graph on it.
  (The retired wording is quoted in the tests that pin its absence, so this
  file cannot be the place it comes back from.)

  Every color and metric reads a custom property with a dark-native default,
  so themes restyle by overriding variables. -->
<script lang="ts">
  import type { UsageActivity, UsageTrackerProps } from '../blocks.ts';
  import {
    calendarColumns,
    formatMagnitude,
    seriesCells,
    seriesViews,
    viewColumns,
    type SeriesView
  } from '../grid';
  import ContributionGrid from './ContributionGrid.svelte';
  import PanelShell from './PanelShell.svelte';

  let { id, title, status, generatedAt, sections, emptyNote }: UsageTrackerProps = $props();

  /* One view choice PER SOURCE (owner directive, 2026-08-25).

     This used to be a single `view` for the whole panel, on the argument that
     sources read side by side should not be compared through different
     lenses. The owner reversed it after using the page: the panel renders a
     graph per source, each with its own toggle sitting over its own strip,
     and pressing one toggle re-read the OTHER source's graph too — which
     reads as a bug whatever the rationale, because a control beside one graph
     that changes a different graph is not a control that says what it does.

     Keyed by the source's own key rather than held in a child component, so
     the state survives a payload refresh: the adapter rebuilds its sections
     every delivery, and a lens parked in a component instance would reset to
     daily every sixty seconds. A source whose key has never been pressed
     reads `daily`, the shipped default, so a source appearing mid-session
     needs no initialisation.

     It is still the ONE piece of state that lives here rather than in the
     adapter, because it is presentation — the same series read three ways —
     and the lens math (lib/grid.ts) knows no source either. */
  let views = $state<Record<string, SeriesView>>({});

  function viewOf(key: string): SeriesView {
    return views[key] ?? 'daily';
  }

  /* activityColumns realigns a region's daily series onto true calendar
     weeks (issue 189: calendarColumns, so the shared weekday axis is
     truthful for every column) and only THEN re-reads the aligned columns
     through that source's active lens (viewColumns) — the order matters,
     because a weekly or cumulative reading has to sum real calendar weeks,
     and only calendarColumns knows where those actually fall once the series
     has been padded to the fixed trailing window. */
  function activityColumns(activity: UsageActivity, view: SeriesView) {
    return viewColumns(calendarColumns(seriesCells(activity.series.startDate, activity.series.totals)), view);
  }
</script>

<aside class="usage-tracker" data-panel-id={id} aria-label={title}>
  <PanelShell {title} {status} {generatedAt}>
    {#if sections.length === 0}
      <p class="usage-empty">{emptyNote}</p>
    {:else}
      {#each sections as source (source.key)}
        <section class="usage-source">
          <header class="usage-source-head">
            <h3 class="usage-source-label">{source.label}</h3>
            {#if source.sublabel}<span class="usage-account">{source.sublabel}</span>{/if}
          </header>

          {#if source.tiles && source.tiles.length > 0}
            <ul class="usage-tiles">
              {#each source.tiles as tile (tile.key)}
                <li class="usage-tile" data-usage-tile>
                  <span class="usage-tile-value">{tile.figure}</span>
                  <span class="usage-tile-label">
                    {tile.label}{#if tile.marked}<span
                        class="usage-recorded"
                        title="recorded out of band, not fetched live">· recorded</span
                      >{/if}
                  </span>
                </li>
              {/each}
            </ul>
          {/if}

          {#if source.note}
            <p class="usage-empty">{source.note}</p>
          {/if}

          {#if source.windows && source.windows.length > 0}
            <ul class="usage-windows">
              {#each source.windows as usageWindow}
                <li class="usage-window">
                  <div class="usage-window-head">
                    <span class="usage-period">{usageWindow.period}</span>
                    {#if usageWindow.reset}<span class="usage-reset">{usageWindow.reset}</span>{/if}
                  </div>
                  {#if usageWindow.meter}
                    <div class="usage-meter" data-severity={usageWindow.meter.severity}>
                      <div class="usage-meter-track" aria-hidden="true">
                        <div
                          class="usage-meter-fill"
                          style:inline-size={`${usageWindow.meter.fillPct}%`}
                        ></div>
                      </div>
                      <span class="usage-meter-value">
                        {usageWindow.meter.reading}
                      </span>
                    </div>
                  {/if}
                  <p class="usage-pairs" title={usageWindow.pairsLabel}>
                    {#each usageWindow.pairs as pair (pair.key)}
                      <span class="usage-pair">
                        <span class="usage-pair-label">{pair.label}</span>
                        <span class="usage-pair-value">{pair.figure}</span>
                      </span>
                    {/each}
                  </p>
                </li>
              {/each}
            </ul>
          {/if}

          <!-- The whole region, heading and lens toggle included, and not
            merely the graph inside it: a heading over a three-way toggle with
            nothing to toggle is the hole by another name. A source with no
            columns to draw renders none of this and reads as what it is — a
            source that reports figures and no daily record. See the ruling in
            this file's opening comment. -->
          {#if source.activity}
            {@const view = viewOf(source.key)}
            {@const columns = activityColumns(source.activity, view)}
            {#if columns.length > 0}
              <section class="usage-activity">
                <header class="usage-activity-head">
                  <h4 class="usage-section-title">{source.activity.heading}</h4>
                  <!-- One radio group, styled as a segmented pill: the choice
                    is exclusive, so radios carry the right semantics for
                    free. -->
                  <!-- Named for its own source, so a screen reader hears
                    which graph the group belongs to rather than three
                    identically named groups on one panel — the audible half
                    of the same decoupling. -->
                  <div
                    class="usage-views"
                    role="radiogroup"
                    aria-label={`${source.label} ${source.activity.heading} view`}
                  >
                    {#each seriesViews as candidate}
                      <button
                        type="button"
                        class="usage-view"
                        role="radio"
                        aria-checked={view === candidate}
                        onclick={() => (views[source.key] = candidate)}
                      >
                        {candidate}
                      </button>
                    {/each}
                  </div>
                </header>
                <ContributionGrid
                  {columns}
                  noun={source.activity.noun}
                  {view}
                  label={`${source.activity.label}, ${view} view`}
                  fullWidth
                  cardTitle="Tokens used"
                  formatValue={formatMagnitude}
                />
                <p class="usage-activity-total">
                  {source.activity.summary}
                </p>
              </section>
            {/if}
          {/if}

          {#if source.insights && source.insights.rows.length > 0}
            <section class="usage-insights">
              <h4 class="usage-section-title">{source.insights.heading}</h4>
              <ul class="usage-insight-rows">
                {#each source.insights.rows as insight (insight.key)}
                  <li class="usage-insight">
                    <span class="usage-insight-label">
                      {insight.label}{#if insight.marked}<span
                          class="usage-recorded"
                          title="recorded out of band, not fetched live">· recorded</span
                        >{/if}
                    </span>
                    <span class="usage-insight-track" aria-hidden="true">
                      <span
                        class="usage-insight-fill"
                        style:inline-size={`${insight.fillPct}%`}
                      ></span>
                    </span>
                    <span class="usage-insight-value">
                      {insight.reading}
                    </span>
                  </li>
                {/each}
              </ul>
            </section>
          {/if}
        </section>
      {/each}
    {/if}
  </PanelShell>
</aside>

<style>
  /* An ordinary block in the page's panel stack. This panel used to be the
     only one laid out in the document, so it centred itself and reserved its
     own page padding; the stack owns both now, and a panel that decided its
     own page position would fight whatever the stack decided. */
  .usage-tracker {
    display: block;
  }

  .usage-source {
    display: flex;
    flex-direction: column;
    gap: var(--usage-row-gap, 0.375rem);
  }

  .usage-source + .usage-source {
    margin-block-start: var(--usage-source-gap, 0.75rem);
    padding-block-start: var(--usage-source-gap, 0.75rem);
    border-block-start: 1px solid var(--panel-border, rgb(23, 23, 23));
  }

  .usage-source-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .usage-source-label {
    margin: 0;
    font-size: var(--panel-font-size, 0.8125rem);
    font-weight: 650;
    letter-spacing: 0.02em;
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .usage-account {
    font-size: var(--panel-badge-size, 0.6875rem);
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  /* Two columns of tiles; a final odd tile spans the row, which is exactly
     the 2x2-plus-one-wide arrangement the owner's reference shows, with no
     per-tile layout data and no count-dependent branching. */
  .usage-tiles {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--usage-tile-gap, 0.375rem);
  }

  .usage-tile {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-block-size: 3.25rem;
    padding: var(--usage-tile-padding, 0.5rem 0.625rem);
    background: var(--usage-tile-surface, var(--panel-tip-surface, rgb(23, 23, 23)));
    border: 1px solid var(--panel-border, rgb(23, 23, 23));
    border-radius: var(--usage-tile-radius, 8px);
  }

  .usage-tile:last-child:nth-child(odd) {
    grid-column: 1 / -1;
  }

  .usage-tile-value {
    font-size: var(--usage-tile-value-size, 1.125rem);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1.15;
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .usage-tile-label {
    font-size: var(--panel-badge-size, 0.6875rem);
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .usage-recorded {
    font-style: italic;
  }

  .usage-windows {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--usage-window-gap, 0.5rem);
  }

  .usage-window {
    display: flex;
    flex-direction: column;
    gap: var(--usage-row-gap, 0.375rem);
  }

  .usage-window-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .usage-period {
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .usage-reset {
    font-size: var(--panel-badge-size, 0.6875rem);
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .usage-meter {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    --usage-meter-fill-color: var(--usage-meter-ok, var(--panel-status-ok, rgb(94, 171, 94)));
  }

  .usage-meter[data-severity='warning'] {
    --usage-meter-fill-color: var(
      --usage-meter-warning,
      var(--panel-status-stale, var(--panel-accent, rgb(220, 138, 0)))
    );
  }

  .usage-meter[data-severity='critical'] {
    --usage-meter-fill-color: var(--usage-meter-critical, rgb(208, 59, 59));
  }

  /* The unfilled track is a faint step of the fill's own color — same-ramp,
     so the meter's state reads across the whole bar, not just the filled
     part. The plain declaration above the color-mix is the fallback for
     engines without color-mix support; the value label carries the reading
     either way. */
  .usage-meter-track {
    flex: 1;
    block-size: var(--usage-meter-thickness, 0.375rem);
    border-radius: 999px;
    overflow: hidden;
    background: var(--panel-border, rgb(23, 23, 23));
    background: color-mix(
      in srgb,
      var(--usage-meter-fill-color) var(--usage-meter-track-strength, 24%),
      var(--usage-meter-track-base, transparent)
    );
  }

  .usage-meter-fill {
    block-size: 100%;
    border-radius: inherit;
    background: var(--usage-meter-fill-color);
  }

  /* The utilization figure is always visible and wears the text token, never
     the fill color; tabular figures keep the small column of percentages
     aligned across a source's windows. */
  .usage-meter-value {
    min-inline-size: 2.75rem;
    text-align: end;
    font-variant-numeric: tabular-nums;
    font-size: var(--panel-badge-size, 0.6875rem);
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .usage-pairs {
    margin: 0;
    display: flex;
    gap: var(--usage-pair-gap, 0.75rem);
  }

  .usage-pair-label {
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .usage-pair-value {
    font-weight: 650;
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .usage-activity,
  .usage-insights {
    display: flex;
    flex-direction: column;
    gap: var(--usage-row-gap, 0.375rem);
  }

  .usage-activity-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .usage-section-title {
    margin: 0;
    font-size: var(--panel-font-size, 0.8125rem);
    font-weight: 650;
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .usage-views {
    display: inline-flex;
    padding: 2px;
    border-radius: 999px;
    background: var(--usage-tile-surface, var(--panel-tip-surface, rgb(23, 23, 23)));
    border: 1px solid var(--panel-border, rgb(23, 23, 23));
  }

  /* Segments are 44px tall so the pill clears the repository's touch-target
     floor; the visual pill stays compact through the transparent padding. */
  .usage-view {
    min-block-size: 2.75rem;
    padding-inline: 0.625rem;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--panel-muted, rgb(158, 158, 158));
    font: inherit;
    font-size: var(--panel-badge-size, 0.6875rem);
    text-transform: lowercase;
    cursor: pointer;
  }

  .usage-view[aria-checked='true'] {
    background: var(--usage-view-active, var(--panel-surface, rgb(40, 40, 40)));
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .usage-view:focus-visible {
    outline: 1px solid var(--panel-accent, rgb(220, 138, 0));
    outline-offset: -1px;
  }

  .usage-activity-total {
    margin: 0;
    font-size: var(--panel-badge-size, 0.6875rem);
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .usage-insight-rows {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--usage-row-gap, 0.375rem);
  }

  .usage-insight {
    display: grid;
    grid-template-columns: minmax(6rem, auto) 1fr auto;
    align-items: center;
    gap: 0.5rem;
    block-size: 1.25rem;
    font-size: var(--panel-badge-size, 0.6875rem);
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .usage-insight-track {
    block-size: var(--usage-meter-thickness, 0.375rem);
    border-radius: 999px;
    overflow: hidden;
    background: var(--panel-border, rgb(23, 23, 23));
  }

  .usage-insight-fill {
    display: block;
    block-size: 100%;
    border-radius: inherit;
    background: var(--usage-insight-fill, var(--panel-accent, rgb(220, 138, 0)));
  }

  .usage-insight-value {
    font-variant-numeric: tabular-nums;
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .usage-empty {
    margin: 0;
    font-style: italic;
    color: var(--panel-muted, rgb(158, 158, 158));
  }
</style>
