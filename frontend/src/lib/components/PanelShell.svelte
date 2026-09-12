<!-- PanelShell is the one chrome every panel shares: a heading and a content
  slot. Deliberately minimal and shaped, not styled: every color and metric
  reads a panel custom property with a dark-native default, so the theme layer
  restyles panels by overriding variables, never by editing components.

  NOTHING ABOUT FRESHNESS IS DRAWN HERE ANY MORE, and the pieces left in three
  separate rulings.

  The ACTION left twice over. Every card used to carry its own refresh button
  beside the title, which implied that refreshing was a per-card decision when
  it is one gesture — that button moved to a single page-header control
  instead. That control is gone too now (owner directive, issue 179): the site
  is responsive on its own, and a data-retrieval failure logs an error
  (panels.ts' loadPanel) rather than waiting on a visitor to press something.
  No panel offers a manual refresh of any kind any more.

  The BADGE — "stale, updated 8d ago" beside every heading — left at the
  owner's direction (issue 127): three cards each announcing their own age is
  chrome competing with the data it describes.

  The LINE that replaced it — "data through Sep 11, 2026 · last capture 11h
  ago", the same reading worded as a sentence in the head's end column — left
  on 2026-09-12 for the same reason the badge did, once the owner read it on
  the live page. What leaves is the DRAWING, not the model behind it. Status
  and provenance still arrive on every envelope and still ride this element as
  data attributes, and every panel still renders an explicit unavailable state
  in its own body when it has nothing true to show. The attributes are
  deliberate: a reading nobody displays is still a reading the page can be
  audited for, and it is what a lane or a future presentation reads instead of
  re-deriving freshness from scratch. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { PanelStatus } from '../panels';

  let {
    title,
    status = 'unavailable',
    generatedAt,
    children
  }: {
    /* The panel's own name, or nothing. A block whose section head already
       names it renders no second label (owner directive, 2026-09-04, issue
       292: three stacked headers over Projects read as noise), and the head
       row stays at the title's own height either way — see .panel-head. */
    title?: string;
    status?: PanelStatus;
    generatedAt?: string;
    children?: Snippet;
  } = $props();
</script>

<section class="panel-shell" data-panel-status={status} data-panel-generated-at={generatedAt}>
  <header class="panel-head">
    {#if title}<h2 class="panel-title">{title}</h2>{/if}
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
    border: var(--panel-border-width, 1px) solid var(--panel-border, rgb(23, 23, 23));
    border-radius: var(--panel-radius, 3px);
    color: var(--panel-text, rgb(230, 230, 230));
    font-size: var(--panel-font-size, 0.8125rem);
  }

  /* The heading is the whole row now. It keeps its own box rather than
     collapsing to a bare h2 so a later addition lands beside the title
     instead of under it — the geometry a card reserves must not depend on
     what happens to be in the row today. */
  .panel-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    /* THE ROW IS THE RESERVE WHETHER OR NOT IT HAS A TITLE (owner directive,
       2026-09-04, issue 292: the Projects table renders no label of its own).
       Its minimum is one line of the title's own type: the row wears the
       title's face and size, and `1lh` is the line box that face draws at
       that size — exactly the box the h2 occupies when it is here — so a head
       with no title is as tall as one with, and a late arrival lands in a row
       that was already there. The em fallback under it is the same line at
       the face's normal leading, for an engine without the unit. */
    font-family: var(--panel-title-family, inherit);
    font-size: var(--panel-title-size, 0.8125rem);
    /* A unitless leading inherits as a proportion, so a smaller child keeps a
       smaller line box instead of Firefox recomputing `normal` two pixels
       taller than the title row reserved. */
    line-height: var(--panel-head-leading, 1.1);
    min-block-size: 1.3em;
    min-block-size: 1lh;
  }

  /* Every dimension of the heading is a token, for the reason the rest of this
     component's are: the ledger sets it as the sheet's mono label — small,
     tracked out, uppercase, muted — and the panel layer is where that decision
     belongs rather than in a second rule here. The fallbacks are the values
     this row shipped with, so a token layer that lost one degrades to what it
     used to look like rather than to nothing. */
  /* ONE LINE, TRUNCATING, because the head is the reserve. A title that WRAPS
     makes the head taller, and the head that waits is not the head that
     arrives: the version-control panel's fallback title is longer than the
     origin's served one, so on a 393px screen the shell drew a two-line head
     and mounting pulled 28px out from under everything below it. Measured on
     a Pixel 5: `.panel-head` 42px before the envelope, 14px after. The words
     are still in the accessible name; what truncates is the drawing. */
  .panel-title {
    margin: 0;
    min-inline-size: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-family: var(--panel-title-family, inherit);
    font-size: var(--panel-title-size, 0.8125rem);
    font-weight: var(--panel-title-weight, 650);
    letter-spacing: var(--panel-title-tracking, 0.02em);
    text-transform: var(--panel-title-transform, none);
    color: var(--panel-heading, var(--panel-accent, rgb(220, 138, 0)));
  }

  .panel-body {
    display: block;
  }
</style>
