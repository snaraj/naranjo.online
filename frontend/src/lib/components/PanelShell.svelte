<!-- PanelShell is the one chrome every panel shares: a heading and a content
  slot. Deliberately minimal and shaped, not styled: every color and metric
  reads a panel custom property with a dark-native default, so the theme layer
  restyles panels by overriding variables, never by editing components.

  Neither half of the old freshness widget renders here any more, and the two
  left for different reasons.

  The ACTION left twice over. Every card used to carry its own refresh button
  beside the title, which implied that refreshing was a per-card decision when
  it is one gesture — that button moved to a single page-header control
  instead. That control is gone too now (owner directive, issue 179): the site
  is responsive on its own, and a data-retrieval failure logs an error
  (panels.ts' loadPanel) rather than waiting on a visitor to press something.
  No panel offers a manual refresh of any kind any more.

  The READING — "stale, updated 8d ago" beside every heading — left at the
  owner's direction (issue 127): three cards each announcing their own age
  is chrome competing with the data it describes. What left is the BADGE, not
  the model behind it. Status and provenance still arrive on every envelope,
  still ride this element as data attributes, and every panel still renders an
  explicit unavailable state in its own body when it has nothing true to show;
  what no longer happens is a card interrupting itself to say how old it is.
  The attributes are deliberate: a reading nobody displays is still a reading
  the page can be audited for, and it is what a lane or a future presentation
  reads instead of re-deriving freshness from scratch. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { PanelStatus } from '../panels';

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
</script>

<section class="panel-shell" data-panel-status={status} data-panel-generated-at={generatedAt}>
  <header class="panel-head">
    <h2 class="panel-title">{title}</h2>
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

  /* The heading is the whole row now. It keeps the flex box rather than
     collapsing to a bare h2 so a later addition lands beside the title
     instead of under it — the geometry a card reserves must not depend on
     what happens to be in the row today. */
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

  .panel-body {
    display: block;
  }
</style>
