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
    note,
    children
  }: {
    title: string;
    status?: PanelStatus;
    generatedAt?: string;
    /* The honest data-through line (issue 285), for a panel whose body is a
       RESERVED box: the calendar holds every region at a fixed height so its
       arrival costs no layout shift, which leaves the head — the row this
       shell keeps open for exactly "a later addition beside the title" — as
       the one place a line can appear without moving anything. Adapter-built
       words, rendered only when there are any; a fresh panel draws nothing
       here, which is what keeps this from being the retired freshness badge. */
    note?: string;
    children?: Snippet;
  } = $props();
</script>

<section class="panel-shell" data-panel-status={status} data-panel-generated-at={generatedAt}>
  <header class="panel-head">
    <h2 class="panel-title">{title}</h2>
    {#if note}<span class="panel-note" data-panel-note>{note}</span>{/if}
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

  /* The heading is the whole row now. It keeps the flex box rather than
     collapsing to a bare h2 so a later addition lands beside the title
     instead of under it — the geometry a card reserves must not depend on
     what happens to be in the row today. */
  /* A GRID, so the two cells shrink in a stated ORDER rather than in
     proportion to how long their text happens to be. Both truncate — neither
     may wrap, because the head is the panel's reserve — but the title is the
     panel's identity and the note is its freshness, so the title takes the
     width it needs and the note takes what is left. As a flex row the note's
     long sentence dominated the basis and squeezed the title first: "GitHub"
     drew as "GIT…" on a 390px screen, which is a worse answer than a shorter
     date. */
  .panel-head {
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr);
    align-items: center;
    gap: 0.5rem;
  }

  /* Every dimension of the heading is a token, for the reason the rest of this
     component's are: the ledger sets it as the sheet's mono label — small,
     tracked out, uppercase, muted — and the panel layer is where that decision
     belongs rather than in a second rule here. The fallbacks are the values
     this row shipped with, so a token layer that lost one degrades to what it
     used to look like rather than to nothing. */
  /* ONE LINE, TRUNCATING, for the same reason the note below is — and the
     head is the reserve, so this is the half that was missing. A title that
     WRAPS makes the head taller, and the head that waits is not the head that
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

  /* One line at the head's far edge, a step smaller than the title so the
     row's height stays the title's: a note that could wrap would grow the
     reserved row on arrival, so on a card too narrow for its words it
     truncates instead. Its own size token, defaulting to the same step the
     usage tracker's body line reads, and the same muted ink. */
  .panel-note {
    min-inline-size: 0;
    font-family: var(--panel-note-family, inherit);
    letter-spacing: var(--panel-note-tracking, normal);
    text-transform: var(--panel-note-transform, none);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    text-align: end;
    font-size: var(--panel-note-size, 0.6875rem);
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .panel-body {
    display: block;
  }
</style>
