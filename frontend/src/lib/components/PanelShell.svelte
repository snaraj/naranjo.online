<!-- PanelShell is the one chrome every panel shares: a heading, an honest
  freshness control, and a content slot. Deliberately minimal and shaped, not
  styled: every color and metric reads a panel custom property with a
  dark-native default, so the future theme layer restyles panels by overriding
  variables, never by editing components.

  The freshness control replaced a "stale · 8d ago" text badge (issue #78).
  Nothing about the honesty was dropped, only the ugliness: the envelope's
  status still drives a dot whose SHAPE differs per state — filled, hollow,
  square — so status is never carried by color alone, and the full sentence
  ("stale, updated 8d ago") rides the button's accessible name and its native
  tooltip, where it is readable by pointer, keyboard, and screen reader alike.
  What the reader gains is the ability to DO something about it: pressing the
  control forces an immediate re-read through the same single-flight watcher
  the panel already polls with, so a visitor never has to reload the page to
  find out whether the origin has newer data. A panel that supplies no
  refresher renders the same badge as a plain, non-interactive element. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { PanelStatus } from '../panels';
  import { panelAge, watchClock } from '../panels';

  let {
    title,
    status = 'unavailable',
    generatedAt,
    fill = false,
    refresh,
    children
  }: {
    title: string;
    status?: PanelStatus;
    generatedAt?: string;
    /* fill lets a panel claim the remaining height of a flex parent — the
       rail — so its own scrolling region reaches the bottom of the viewport
       instead of stopping at its content's natural height. */
    fill?: boolean;
    /* refresh is the panel watcher's forced read. Optional: a panel that
       does not supply one simply has no control to press. */
    refresh?: () => Promise<void>;
    children?: Snippet;
  } = $props();

  /* The freshness reading follows a ticking clock, not the mount instant: an
     age computed once would read "just now" for the life of the tab, which is
     worse than no reading at all — a freshness claim that quietly becomes
     false. */
  let now = $state(new Date());
  $effect(() => watchClock((tick) => (now = tick)));

  const age = $derived(panelAge(generatedAt, now));
  /* One sentence, used three ways: the button's accessible name, its native
     tooltip, and (when there is no refresher) the plain badge's own label. */
  const freshness = $derived(age ? `${status}, updated ${age}` : status);

  let busy = $state(false);

  async function force(): Promise<void> {
    if (busy || !refresh) {
      return;
    }
    busy = true;
    try {
      await refresh();
    } finally {
      /* Even a failed read releases the control: loadPanel turns a failure
         into the honest unavailable envelope rather than a rejection, and a
         button that could latch busy forever would be its own defect. */
      busy = false;
    }
  }
</script>

<section class="panel-shell" class:panel-shell-fill={fill} data-panel-status={status}>
  <header class="panel-head">
    <h2 class="panel-title">{title}</h2>
    {#if refresh}
      <button
        type="button"
        class="panel-refresh"
        data-panel-status={status}
        aria-label={`Refresh ${title}. ${freshness}.`}
        aria-busy={busy}
        title={`${freshness} — refresh`}
        disabled={busy}
        onclick={force}
      >
        <span class="panel-badge-dot" data-panel-status={status} aria-hidden="true"></span>
        <svg class="panel-refresh-glyph" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M20 12a8 8 0 1 1-2.34-5.66"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
          />
          <path d="M20 3.5V9h-5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    {:else}
      <p class="panel-badge" data-panel-status={status} title={freshness}>
        <span class="panel-badge-dot" data-panel-status={status} aria-hidden="true"></span>
        <span class="panel-badge-age">{freshness}</span>
      </p>
    {/if}
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

  /* The fill variant hands its own height down to the body, which hands it to
     whatever scrolling region the panel renders. min-block-size: 0 at every
     step is what lets a flex child actually shrink below its content. */
  .panel-shell-fill {
    flex: 1;
    min-block-size: 0;
  }

  .panel-shell-fill .panel-body {
    flex: 1;
    min-block-size: 0;
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap, 0.5rem);
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

  .panel-refresh {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    padding: 0.125rem 0.25rem;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--panel-radius, 3px);
    color: var(--panel-muted, rgb(158, 158, 158));
    font: inherit;
    cursor: pointer;
  }

  /* The visible control stays small enough for a dense panel header, while
     its HIT AREA is expanded to the 44px minimum comfortable touch target by
     a transparent overlay that occupies no layout space. */
  .panel-refresh::after {
    content: '';
    position: absolute;
    inset: 50% 50%;
    inline-size: 2.75rem;
    block-size: 2.75rem;
    transform: translate(50%, 50%);
  }

  .panel-refresh:hover,
  .panel-refresh:focus-visible {
    color: var(--panel-accent, rgb(220, 138, 0));
    border-color: var(--panel-border, rgb(23, 23, 23));
  }

  .panel-refresh:focus-visible {
    outline: 1px solid var(--panel-accent, rgb(220, 138, 0));
    outline-offset: 1px;
  }

  .panel-refresh[disabled] {
    cursor: progress;
  }

  /* Status is dot COLOR plus dot SHAPE — filled for ok, hollow for stale,
     square for unavailable — so the state survives a reader who cannot tell
     the colors apart, and the words ride the label and tooltip regardless. */
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

  .panel-refresh-glyph {
    display: block;
  }

  @media (prefers-reduced-motion: no-preference) {
    .panel-refresh[aria-busy='true'] .panel-refresh-glyph {
      animation: panel-refresh-spin 900ms linear infinite;
    }

    @keyframes panel-refresh-spin {
      to {
        transform: rotate(360deg);
      }
    }
  }

  /* Reduced motion still needs an in-flight signal, so the busy state dims
     the glyph instead of spinning it. */
  @media (prefers-reduced-motion: reduce) {
    .panel-refresh[aria-busy='true'] .panel-refresh-glyph {
      opacity: 0.4;
    }
  }

  .panel-badge-age {
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .panel-body {
    display: block;
  }
</style>
