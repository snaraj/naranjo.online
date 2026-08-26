<!-- EntryLog renders a feed of titled entries, each one a FeedCard (the ONE
  card primitive, issue 136). It is a generic primitive with NO domain
  knowledge — every title, byline, link, counter and summary arrives through
  EntryLogProps (lib/blocks.ts), built by an adapter in the binding layer.
  The work history and the coding-project list are both this component today,
  bound to different data; a reading log is this component tomorrow without
  an edit here.

  An entry comes in two shapes, and the shape is decided by its data:

  UNLINKED — a title, an optional byline, a summary. The card's own title
  region renders them, at the heading depth the log declares, so the entry
  reads as a plain record.

  LINKED — the title is outbound navigation, optionally with a drawn mark
  before it and counters beside it. That is not something a title string can
  express, so this component supplies the card's header region itself, which
  is exactly what the header snippet is for.

  Nothing here is fetched, and nothing here styles a card: every border,
  radius, padding and type step comes from the --card-* tokens in styles.css,
  so the log moves with the rest of the page when one of them changes. An
  href reaches the DOM only as the anchor's value — text is never rendered as
  markup — and no request is made for it from this page.

  The glyphs are drawn here, in the same language as the page's own chrome — a
  24-unit box, currentColor, round caps — rather than vendored from anyone's
  icon set: a third-party mark would need its license reviewed and its
  attribution recorded, and none of that buys a reader anything a plain glyph
  does not. Every glyph is decorative: the figure and the word it counts are
  rendered as text beside it, so nothing on this card is carried by a picture
  alone.

  A placeholder entry says so in the DOM (`data-placeholder`), because the
  honest-states floor is what stops a page from presenting filler under a
  real heading as though it described a real record. -->
<script lang="ts">
  import FeedCard from './FeedCard.svelte';
  import type { EntryLogEntry, EntryLogProps } from '../blocks.ts';

  let { entries, variant, titleLevel = 3 }: EntryLogProps = $props();
</script>

<ol class="entry-log" data-variant={variant}>
  {#each entries as entry (entry.key)}
    <li data-placeholder={entry.placeholder ? 'true' : undefined}>
      {#if entry.href}
        <FeedCard {variant}>
          {#snippet header()}
            <div class="entry-head">
              <svelte:element this={`h${titleLevel}`} class="entry-heading">
                <a
                  class="entry-link"
                  href={entry.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={entry.linkLabel}
                >
                  {#if entry.glyph === 'code'}
                    <svg class="entry-glyph" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        d="M9.5 7 4.5 12l5 5"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                      <path
                        d="M14.5 7l5 5-5 5"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  {/if}
                  <span class="entry-name">{entry.title}</span>
                </a>
              </svelte:element>
              {#if entry.counts && entry.counts.length > 0}
                <ul class="entry-counts">
                  {#each entry.counts as count (count.key)}
                    <li class="entry-count">
                      {#if count.glyph === 'node'}
                        <svg class="entry-glyph" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                          <circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="2" />
                          <path
                            d="M3.5 12h5.1M15.4 12h5.1"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                          />
                        </svg>
                      {:else}
                        <svg class="entry-glyph" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                          <path
                            d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"
                            fill="currentColor"
                          />
                        </svg>
                      {/if}
                      <span class="entry-count-text">{count.label}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/snippet}
          {@render body(entry)}
        </FeedCard>
      {:else}
        <FeedCard {variant} title={entry.title} byline={entry.byline} {titleLevel}>
          {@render body(entry)}
        </FeedCard>
      {/if}
    </li>
  {/each}
</ol>

<!-- One entry's body, shared by both card shapes above so the linked and the
  unlinked branch cannot grow different bodies. Each region is drawn only when
  the entry has it: a paragraph, a list of points, or both. An entry with
  neither renders an empty body, which is a call site with nothing to say —
  refused for every entry this site ships by tests/sections.test.mjs rather
  than papered over here. Points are TEXT, never markup, exactly like every
  other value on this card. -->
{#snippet body(entry: EntryLogEntry)}
  {#if entry.summary}
    <p class="entry-summary">{entry.summary}</p>
  {/if}
  {#if entry.points && entry.points.length > 0}
    <ul class="entry-points">
      {#each entry.points as point (point)}
        <li>{point}</li>
      {/each}
    </ul>
  {/if}
{/snippet}

<style>
  .entry-log {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: var(--feed-gap);
  }

  /* Deterministic by viewport, never by content (issue 188). The previous
     rule was flex-wrap: a short title happened to leave room for the
     counters on the same line while a long title pushed them below — the
     identical card shape reading differently card to card, which is what
     the owner's screenshot caught (naranjo.online/lidersea.com inline,
     website-infrastructure/foobar2000-* wrapped, same viewport). Below
     --breakpoint-card-meta the row is a column outright: title, then
     counters, always two rows. At or above it the row is flex, nowrap,
     always one row. No title's length enters the decision either side. */
  .entry-head {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--card-meta-gap);
  }

  @media (min-width: 30rem) {
    .entry-head {
      flex-direction: row;
      flex-wrap: nowrap;
      align-items: center;
      justify-content: space-between;
    }
  }

  .entry-heading {
    margin: 0;
    font-family: var(--card-title-family);
    font-size: var(--card-meta-size);
    font-weight: var(--card-title-weight);
  }

  /* The link is the whole touch target: 44px of block size from the floor,
     with the padding pulled back on the inline start so the glyph still lines
     up with the description under it. The size is a MINIMUM rather than a
     fixed box — a reader who enlarges their base font gets a taller target,
     never a clipped one.

     The resting underline is gone (owner directive, 2026-08-25: the repo
     card titles "rendered underlined" and the owner wants no always-on
     underline anywhere on the site). This rule used to TINT the browser's
     default underline rather than remove it, which is why three card titles
     shipped ruled off under a heading.

     The a11y position is the one .section-link already rests on, and it is
     about channels rather than taste: identifying a link by color alone
     serves fewer readers, so a resting link here is identified by POSITION
     and ROLE before color enters — a card TITLE, at the card's own title
     type step and weight, in the header region of every entry, where this
     feed puts nothing else. None of these links sits in running prose, which
     is the case the underline convention exists for. And the moment intent
     is shown the mark returns: hover and keyboard focus both add the
     underline back along with the brand ink, and focus-visible keeps the
     site-wide ring below untouched. */
  .entry-link {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-block-size: 2.75rem;
    min-inline-size: 2.75rem;
    padding-inline-end: 0.5rem;
    color: var(--card-ink);
    text-decoration: none;
    text-underline-offset: 0.2em;
  }

  .entry-link:hover .entry-name,
  .entry-link:focus-visible .entry-name {
    color: var(--color-brand);
    text-decoration: underline;
  }

  .entry-link:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .entry-glyph {
    flex: none;
    color: var(--card-meta-ink);
  }

  .entry-name {
    /* A name is one token and must not be broken across lines by a hyphen
       the name does not have; on a 320px card it scrolls nothing because the
       flex row is allowed to shrink under it. */
    overflow-wrap: anywhere;
    font-size: var(--card-title-size);
    letter-spacing: var(--card-title-tracking);
  }

  .entry-counts {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--card-meta-gap);
  }

  .entry-count {
    display: inline-flex;
    align-items: center;
    gap: 0.3125rem;
    font-size: var(--card-meta-size);
    font-variant-numeric: tabular-nums;
    color: var(--card-meta-ink);
  }

  .entry-count-text {
    white-space: nowrap;
  }

  .entry-summary {
    margin: 0;
    max-inline-size: var(--card-measure);
  }

  /* An entry's points, at the card's own body rhythm: the reading measure the
     paragraph uses, the card's body gap between items, and the marker pulled
     just far enough in that a wrapped line still lines up under the first
     word rather than under the bullet. Every length is a token or derived
     from one — nothing here is a value this component chose for itself. */
  .entry-points {
    margin: 0;
    /* Stated rather than inherited: this list sits inside the log's own <ol>,
       so the browser's nesting rule would pick its marker for it — the card
       would change bullet the day the log stopped being an ordered list. */
    list-style-type: disc;
    padding-inline-start: 1.125rem;
    max-inline-size: var(--card-measure);
    display: grid;
    gap: var(--card-body-gap);
  }

  /* The compact log reads its summaries at the meta step — the same line the
     framed log's byline uses — so a dense list stays dense without a second
     copy of the type scale. */
  .entry-log[data-variant='compact'] .entry-summary {
    font-size: var(--card-meta-size);
    line-height: var(--card-body-leading);
  }
</style>
