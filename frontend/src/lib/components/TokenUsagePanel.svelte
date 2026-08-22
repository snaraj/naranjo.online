<!-- TokenUsagePanel renders the token-usage/v1 panel inside the shared
  PanelShell chrome: one block per source, iterated straight from the API
  payload. Source labels are data supplied by the origin — this component
  knows no vendor, so a new tool appears by shipping data, never by editing
  code.

  Each source block is, top to bottom: a tile grid of headline figures (a
  final odd tile spans the full width); the usage windows with their
  utilization meters, the numeric value always rendered beside the fill so
  severity is never color alone; a "Token activity" section whose
  Daily/Weekly/Cumulative toggle re-reads ONE daily series through three
  lenses with no extra payload; and an "Activity insights" list.

  Every section is optional and every absence is honest. A figure the origin
  does not report renders as an explicit dash, a figure captured out of band
  wears a "recorded" marker instead of borrowing the panel's freshness, and a
  payload that fails admission renders an empty state, never invented numbers.
  The envelope's status rides the shell's badge, and watchPanel keeps the
  whole block current while the tab is visible.

  Every color and metric reads a custom property with a dark-native default,
  so themes restyle by overriding variables. -->
<script lang="ts">
  import type { PanelEnvelope, TokenUsageData, TokenUsageSource } from '../panels';
  import { watchPanel } from '../panels';
  import {
    formatStatValue,
    formatTokenCount,
    formatUtilization,
    meterFillPct,
    meterSeverity,
    resetsIn,
    tokenUsageSources
  } from '../token-usage';
  import { peakValue, seriesCells, seriesViews, toColumns, viewValues, type SeriesView } from '../grid';
  import ContributionGrid from './ContributionGrid.svelte';
  import PanelShell from './PanelShell.svelte';

  let envelope = $state<PanelEnvelope<TokenUsageData> | undefined>(undefined);

  $effect(() => {
    return watchPanel<TokenUsageData>('token-usage', (loaded) => (envelope = loaded));
  });

  /* One view choice for the whole panel: the sources are read side by side,
     so switching lens on one and not the other would be a comparison trap. */
  let view = $state<SeriesView>('daily');

  const sources = $derived(envelope ? tokenUsageSources(envelope.data) : []);
  /* The unavailablePanel fallback carries an empty title; the panel's own
     registry title stands in so the shell heading never renders blank. */
  const title = $derived(envelope?.title || 'Token usage');

  /* gridColumns re-reads a source's daily series through the active lens and
     lays it out as grid columns. A source without a series simply has none. */
  function gridColumns(source: TokenUsageSource) {
    if (!source.series) {
      return [];
    }
    return toColumns(seriesCells(source.series.startDate, viewValues(source.series.totals, view)));
  }

  function seriesTotal(source: TokenUsageSource): number {
    return source.series ? source.series.totals.reduce((sum, total) => sum + total, 0) : 0;
  }

  function seriesPeak(source: TokenUsageSource): number {
    return source.series ? peakValue(seriesCells(source.series.startDate, source.series.totals)) : 0;
  }
</script>

{#if envelope}
  <aside class="token-usage" data-panel-id="token-usage" aria-label={title}>
    <PanelShell {title} status={envelope.status} generatedAt={envelope.generatedAt}>
      {#if sources.length === 0}
        <p class="usage-empty">No usage data available.</p>
      {:else}
        {#each sources as source (source.label)}
          <section class="usage-source">
            <header class="usage-source-head">
              <h3 class="usage-source-label">{source.label}</h3>
              {#if source.account}<span class="usage-account">{source.account}</span>{/if}
            </header>

            {#if source.stats && source.stats.length > 0}
              <ul class="usage-tiles">
                {#each source.stats as stat (stat.key)}
                  <li class="usage-tile" data-usage-tile>
                    <span class="usage-tile-value">{formatStatValue(stat.value, stat.unit)}</span>
                    <span class="usage-tile-label">
                      {stat.label}{#if stat.recorded}<span class="usage-recorded" title="recorded out of band, not fetched live">
                          · recorded
                        </span>{/if}
                    </span>
                  </li>
                {/each}
              </ul>
            {/if}

            {#if source.windows.length === 0 && (!source.stats || source.stats.length === 0)}
              <p class="usage-empty">No usage recorded for this source yet.</p>
            {:else if source.windows.length > 0}
              <ul class="usage-windows">
                {#each source.windows as usageWindow}
                  {@const reset = resetsIn(usageWindow.resetsAt)}
                  <li class="usage-window">
                    <div class="usage-window-head">
                      <span class="usage-period">{usageWindow.period}</span>
                      {#if reset}<span class="usage-reset">{reset}</span>{/if}
                    </div>
                    {#if usageWindow.utilizationPct !== undefined}
                      <div class="usage-meter" data-severity={meterSeverity(usageWindow.utilizationPct)}>
                        <div class="usage-meter-track" aria-hidden="true">
                          <div
                            class="usage-meter-fill"
                            style:inline-size={`${meterFillPct(usageWindow.utilizationPct)}%`}
                          ></div>
                        </div>
                        <span class="usage-meter-value">
                          {formatUtilization(usageWindow.utilizationPct)}
                        </span>
                      </div>
                    {/if}
                    <p
                      class="usage-tokens"
                      title={`${usageWindow.inputTokens} input tokens, ${usageWindow.outputTokens} output tokens`}
                    >
                      <span class="usage-token">
                        <span class="usage-token-label">in</span>
                        <span class="usage-token-value">{formatTokenCount(usageWindow.inputTokens)}</span>
                      </span>
                      <span class="usage-token">
                        <span class="usage-token-label">out</span>
                        <span class="usage-token-value">{formatTokenCount(usageWindow.outputTokens)}</span>
                      </span>
                    </p>
                  </li>
                {/each}
              </ul>
            {/if}

            <section class="usage-activity">
              <header class="usage-activity-head">
                <h4 class="usage-section-title">Token activity</h4>
                <!-- One radio group, styled as a segmented pill: the choice is
                  exclusive, so radios carry the right semantics for free. -->
                <div class="usage-views" role="radiogroup" aria-label="Token activity view">
                  {#each seriesViews as candidate}
                    <button
                      type="button"
                      class="usage-view"
                      role="radio"
                      aria-checked={view === candidate}
                      onclick={() => (view = candidate)}
                    >
                      {candidate}
                    </button>
                  {/each}
                </div>
              </header>
              <ContributionGrid
                columns={gridColumns(source)}
                noun="token"
                {view}
                label={`${source.label} token activity, ${view} view`}
                emptyNote="no activity series — live refresh is off"
              />
              {#if source.series}
                <p class="usage-activity-total">
                  {formatTokenCount(seriesTotal(source))} tokens over
                  {source.series.totals.length}
                  {source.series.totals.length === 1 ? 'day' : 'days'}, peaking at
                  {formatTokenCount(seriesPeak(source))}
                </p>
              {/if}
            </section>

            {#if source.insights && source.insights.length > 0}
              <section class="usage-insights">
                <h4 class="usage-section-title">Activity insights</h4>
                <ul class="usage-insight-rows">
                  {#each source.insights as insight (insight.label)}
                    <li class="usage-insight">
                      <span class="usage-insight-label">
                        {insight.label}{#if insight.recorded}<span
                            class="usage-recorded"
                            title="recorded out of band, not fetched live">· recorded</span
                          >{/if}
                      </span>
                      <span class="usage-insight-track" aria-hidden="true">
                        <span
                          class="usage-insight-fill"
                          style:inline-size={`${insight.pct === null ? 0 : meterFillPct(insight.pct)}%`}
                        ></span>
                      </span>
                      <span class="usage-insight-value">
                        {insight.pct === null ? '--' : formatUtilization(insight.pct)}
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
{/if}

<style>
  /* An ordinary block in the page's panel stack. This panel used to be the
     only one laid out in the document, so it centred itself and reserved its
     own page padding; the stack owns both now, and a panel that decided its
     own page position would fight whatever the stack decided. */
  .token-usage {
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

  .usage-tokens {
    margin: 0;
    display: flex;
    gap: var(--usage-token-gap, 0.75rem);
  }

  .usage-token-label {
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .usage-token-value {
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
