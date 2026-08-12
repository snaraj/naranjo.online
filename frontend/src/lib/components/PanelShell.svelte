<!-- PanelShell is the one chrome every panel shares: a heading, an honest
  status badge (envelope status plus the coarse age of generatedAt), and a
  content slot. Deliberately minimal and shaped, not styled: every color and
  metric reads a panel custom property with a dark-native default, so the
  future theme layer restyles panels by overriding variables, never by
  editing components. -->
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

  /* The badge reads a ticking clock, not the mount instant: an age computed
     once would read "just now" for the life of the tab, which is worse than
     no badge — a freshness claim that quietly becomes false. */
  let now = $state(new Date());
  $effect(() => watchClock((tick) => (now = tick)));

  const age = $derived(panelAge(generatedAt, now));
</script>

<section class="panel-shell" data-panel-status={status}>
  <header class="panel-head">
    <h2 class="panel-title">{title}</h2>
    <p class="panel-badge" data-panel-status={status}>
      <span class="panel-badge-dot" aria-hidden="true"></span>
      {status}{#if age}<span class="panel-badge-age"> · {age}</span>{/if}
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
    align-items: baseline;
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

  .panel-badge-dot {
    inline-size: 0.5em;
    block-size: 0.5em;
    border-radius: 50%;
    background: var(--panel-status-unavailable, rgb(110, 110, 110));
  }

  .panel-badge[data-panel-status='ok'] .panel-badge-dot {
    background: var(--panel-status-ok, rgb(94, 171, 94));
  }

  .panel-badge[data-panel-status='stale'] .panel-badge-dot {
    background: var(--panel-status-stale, var(--panel-accent, rgb(220, 138, 0)));
  }

  .panel-badge-age {
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .panel-body {
    display: block;
  }
</style>
