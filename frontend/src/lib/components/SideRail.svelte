<!-- SideRail is the collapsible right-hand rail the panels live in. Its
  chrome is recreated purely in CSS from RuneLite's published palette values
  — panel surface 40,40,40; borders 23,23,23; brand orange 220,138,0 —
  copying facts, never artwork: no sprite, image, or logo is included. Every
  color and metric reads a component-scoped custom property with the
  dark-native default, so the future theme layer restyles the rail by
  overriding --panel-rail-* variables and never edits this component. The
  rail is fixed-position chrome floating over the page: opening, closing, or
  populating it never reflows the document, so it contributes no layout
  shift. On narrow viewports it starts collapsed to keep the first paint
  clear of overlay chrome. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let { label = 'Site panels', children }: { label?: string; children?: Snippet } = $props();

  /* Collapsed by default on narrow viewports, evaluated once at mount; the
     visitor's toggle choice then owns the state for the rest of the visit. */
  let collapsed = $state(window.matchMedia('(max-width: 60rem)').matches);

  /* The rail is fixed chrome floating over the page, so the page has to know
     when it is occupying that strip: a centered in-flow panel would otherwise
     be laid out underneath an open rail on a wide viewport. The state is
     published on the document root exactly as the reading mode is (see
     lib/themes.ts), and styles.css turns it into the reserved gutter — one
     attribute out, no component reaching into another's layout. */
  $effect(() => {
    document.documentElement.dataset.railOpen = collapsed ? 'false' : 'true';
    return () => {
      delete document.documentElement.dataset.railOpen;
    };
  });
</script>

<aside class="side-rail" data-collapsed={collapsed} aria-label={label}>
  <button
    type="button"
    class="rail-toggle"
    aria-expanded={!collapsed}
    aria-controls="side-rail-panels"
    onclick={() => (collapsed = !collapsed)}
  >
    <span class="rail-toggle-glyph" aria-hidden="true">{collapsed ? '❮' : '❯'}</span>
    <span class="rail-toggle-text">{collapsed ? 'Show panels' : 'Hide panels'}</span>
  </button>
  <div class="rail-panels" id="side-rail-panels">
    {#if children}{@render children()}{/if}
  </div>
</aside>

<style>
  .side-rail {
    /* RuneLite chrome, expressed as overridable tokens: the inner value of
       each var() pair is the dark-native default; the outer --panel-rail-*
       name is the theme layer's override point. */
    --rail-surface: var(--panel-rail-surface, rgb(40, 40, 40));
    --rail-border: var(--panel-rail-border, rgb(23, 23, 23));
    --rail-accent: var(--panel-rail-accent, rgb(220, 138, 0));
    --rail-text: var(--panel-rail-text, rgb(230, 230, 230));
    --rail-muted: var(--panel-rail-muted, rgb(158, 158, 158));
    --rail-width: var(--panel-rail-width, 16.25rem);

    position: fixed;
    inset-block: 0;
    inset-inline-end: 0;
    /* One entry in the document's stacking scale (styles.css), above the
       passive activity bar and below the reading-mode control. */
    z-index: var(--layer-rail, 20);
    display: flex;
    align-items: stretch;
    /* Fixed chrome pinned to the viewport edges has to clear the notch and
       the home indicator itself; the page's own padding cannot help it. */
    padding-block: env(safe-area-inset-top) env(safe-area-inset-bottom);
    padding-inline-end: env(safe-area-inset-right);
    color: var(--rail-text);
  }

  .rail-toggle {
    inline-size: var(--panel-rail-toggle-width, 1.375rem);
    padding: 0.75rem 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid var(--rail-border);
    border-inline-end: none;
    border-start-start-radius: 4px;
    border-end-start-radius: 4px;
    background: var(--rail-surface);
    color: var(--rail-muted);
    font: inherit;
    font-size: 0.6875rem;
    cursor: pointer;
  }

  .rail-toggle:hover,
  .rail-toggle:focus-visible {
    color: var(--rail-accent);
  }

  .rail-toggle:focus-visible {
    outline: 1px solid var(--rail-accent);
    outline-offset: -1px;
  }

  .rail-toggle-glyph {
    color: var(--rail-accent);
  }

  .rail-toggle-text {
    writing-mode: vertical-rl;
    letter-spacing: 0.06em;
  }

  /* min-block-size: 0 lets a filling panel inside actually shrink, so its own
     scrolling region reaches the bottom of the rail instead of pushing the
     rail past the viewport. */
  .rail-panels {
    inline-size: var(--rail-width);
    min-block-size: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem;
    background: var(--rail-surface);
    border-inline-start: 1px solid var(--rail-border);
    scrollbar-width: thin;
  }

  .side-rail[data-collapsed='true'] .rail-panels {
    display: none;
  }
</style>
