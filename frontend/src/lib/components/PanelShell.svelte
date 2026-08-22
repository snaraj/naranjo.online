<!-- PanelShell is the one chrome every panel shares: a heading, an honest
  freshness control, and a content slot. Deliberately minimal and shaped, not
  styled: every color and metric reads a panel custom property with a
  dark-native default, so the future theme layer restyles panels by overriding
  variables, never by editing components.

  The freshness READING is per-panel and stays here: the envelope's status
  drives a dot whose SHAPE differs per state — filled, hollow, square — so
  status is never carried by color alone, and the full sentence ("stale,
  updated 8d ago") rides the badge's own tooltip.

  The freshness ACTION is not per-panel and no longer lives here. Every card
  used to carry its own refresh button in its heading, which put a control the
  reader rarely wants beside the title they always read, once per card, and
  implied that refreshing was a per-panel decision when it is really one
  gesture: bring everything up to date. One control for the whole stack does
  that (see RefreshAll), and it rides the same single-flight watchers this
  panel already polls with. What is genuinely per-panel — how old THIS data
  is — is exactly what stayed. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { PanelStatus } from '../panels';
  import { panelAge, watchClock } from '../panels';

  let {
    title,
    status = 'unavailable',
    generatedAt,
    children
  }: {
    title: string;
    status?: PanelStatus;
    generatedAt?: string;
    children?: Snippet;
  } = $props();

  /* The freshness reading follows a ticking clock, not the mount instant: an
     age computed once would read "just now" for the life of the tab, which is
     worse than no reading at all — a freshness claim that quietly becomes
     false. */
  let now = $state(new Date());
  $effect(() => watchClock((tick) => (now = tick)));

  const age = $derived(panelAge(generatedAt, now));
  /* One sentence, used twice: the badge's visible label and its native
     tooltip, so the reading is legible whether or not it fits the card. */
  const freshness = $derived(age ? `${status}, updated ${age}` : status);
</script>

<section class="panel-shell" data-panel-status={status}>
  <header class="panel-head">
    <h2 class="panel-title">{title}</h2>
    <p class="panel-badge" data-panel-status={status} title={freshness}>
      <span class="panel-badge-dot" data-panel-status={status} aria-hidden="true"></span>
      <span class="panel-badge-age">{freshness}</span>
    </p>
  </header>
  <div class="panel-body">
    {#if children}{@render children()}{/if}
  </div>
</section>

<style>
  .panel-shell {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap, 0.5rem);
    padding: var(--panel-padding, 0.625rem);
    background: var(--panel-surface, rgb(40, 40, 40));
    border: 1px solid var(--panel-border, rgb(23, 23, 23));
    border-radius: var(--panel-radius, 3px);
    color: var(--panel-text, rgb(230, 230, 230));
    font-size: var(--panel-font-size, 0.8125rem);
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .panel-title {
    margin: 0;
    font-size: var(--panel-title-size, 0.8125rem);
    font-weight: 650;
    letter-spacing: 0.02em;
    color: var(--panel-heading, var(--panel-accent, rgb(220, 138, 0)));
  }

  .panel-badge {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    font-size: var(--panel-badge-size, 0.6875rem);
    color: var(--panel-muted, rgb(158, 158, 158));
    text-transform: lowercase;
  }

  /* Status is dot COLOR plus dot SHAPE — filled for ok, hollow for stale,
     square for unavailable — so the state survives a reader who cannot tell
     the colors apart, and the words ride the tooltip regardless. */
  .panel-badge-dot {
    flex: none;
    inline-size: 0.5em;
    block-size: 0.5em;
    border: 1px solid var(--panel-status-unavailable, rgb(110, 110, 110));
    background: var(--panel-status-unavailable, rgb(110, 110, 110));
  }

  .panel-badge-dot[data-panel-status='ok'] {
    border-radius: 50%;
    border-color: var(--panel-status-ok, rgb(94, 171, 94));
    background: var(--panel-status-ok, rgb(94, 171, 94));
  }

  .panel-badge-dot[data-panel-status='stale'] {
    border-radius: 50%;
    border-color: var(--panel-status-stale, var(--panel-accent, rgb(220, 138, 0)));
    background: none;
  }

  .panel-badge-age {
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .panel-body {
    display: block;
  }
</style>
