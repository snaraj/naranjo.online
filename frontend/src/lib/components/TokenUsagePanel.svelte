<!-- TokenUsagePanel renders the token-usage/v1 panel inside the shared
  PanelShell chrome: one /usage-shaped block per source, iterated straight from
  the API payload. Source labels are data supplied by the origin — this
  component knows no vendor, so a new tool appears by shipping data, never by
  editing code. Each window row shows its human-formatted input/output counts,
  a utilization meter when the source reports one (the numeric value is always
  rendered beside the fill, so severity is never color alone), and the reset
  instant as coarse relative time. The envelope's honest status rides the
  shell's badge; a payload that fails admission renders an explicit empty
  state, never fake numbers. Every color and metric reads a custom property
  with a dark-native default, so themes restyle by overriding variables. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { PanelEnvelope, TokenUsageData } from '../panels';
  import { loadPanel } from '../panels';
  import {
    formatTokenCount,
    formatUtilization,
    meterFillPct,
    meterSeverity,
    resetsIn,
    tokenUsageSources
  } from '../token-usage';
  import PanelShell from './PanelShell.svelte';

  let envelope = $state<PanelEnvelope<TokenUsageData> | undefined>(undefined);

  onMount(async () => {
    envelope = await loadPanel<TokenUsageData>('token-usage');
  });

  const sources = $derived(envelope ? tokenUsageSources(envelope.data) : []);
  /* The unavailablePanel fallback carries an empty title; the panel's own
     registry title stands in so the shell heading never renders blank. */
  const title = $derived(envelope?.title || 'Token usage');
</script>

{#if envelope}
  <aside class="token-usage" data-panel-id="token-usage" aria-label={title}>
    <PanelShell {title} status={envelope.status} generatedAt={envelope.generatedAt}>
      {#if sources.length === 0}
        <p class="usage-empty">No usage data available.</p>
      {:else}
        {#each sources as source}
          <section class="usage-source">
            <h3 class="usage-source-label">{source.label}</h3>
            {#if source.windows.length === 0}
              <p class="usage-empty">No usage reported.</p>
            {:else}
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
          </section>
        {/each}
      {/if}
    </PanelShell>
  </aside>
{/if}

<style>
  .token-usage {
    display: block;
    max-inline-size: var(--usage-max-inline, 30rem);
    margin: 0 auto;
    padding: var(--usage-mount-padding, 0 1rem 2rem);
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

  .usage-source-label {
    margin: 0;
    font-size: var(--panel-font-size, 0.8125rem);
    font-weight: 650;
    letter-spacing: 0.02em;
    color: var(--panel-text, rgb(230, 230, 230));
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

  .usage-empty {
    margin: 0;
    font-style: italic;
    color: var(--panel-muted, rgb(158, 158, 158));
  }
</style>
