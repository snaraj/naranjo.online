<!-- FeedCard is the page's card primitive (owner directive, issue 134): one
  object that wraps any kind of content in the same chrome, because the page is
  becoming a feed of many content types rather than a layout for one.

  REGIONS, not a fixed shape. A card can carry a header (a title, a byline, a
  date — or a caller-supplied header snippet where those three cannot express
  it), a media region that runs to the card's own edges, a body, and a footer
  for tags and meta. Every region is optional and every one is drawn only when
  it holds something: the art feed passes no title today, and a card that
  reserved a blank band for one would be the defect, not the feature. Which
  regions draw is decided by feedCardRegions in lib/feed.ts, where both the
  present and the absent branch of each are executed by tests rather than
  pattern-matched here.

  EVERY VISUAL DIMENSION IS A TOKEN. Nothing below states a color, a length, a
  weight or a font stack: each reads a --card-* custom property whose default
  is declared once, globally, in styles.css against the reading-mode tokens. So
  three things follow that would each otherwise need discipline to hold —
  moving one global token moves every card on the page at once; a reading mode
  restyles the whole feed without this component knowing which mode is active
  (every value resolves through --color-*, never a literal); and tweaking ONE
  card is a local custom-property override, through the style prop below, never
  an edit here and never a hardcoded value at the call site.

  VARIANTS, not booleans. A distinct look is a variant that remaps the card's
  own tokens — framed, flat, media-led, compact — so a new content type is a
  new variant plus its tokens rather than another flag threaded through here.
  The list lives in lib/feed.ts and a test proves every variant it admits is
  actually styled. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { feedCardRegions, formatIsoDate, type FeedCardVariant } from '../feed.ts';

  let {
    title,
    titleHref,
    byline,
    date,
    titleLevel = 3,
    variant = 'framed',
    style,
    header,
    media,
    children,
    footer
  }: {
    /* The card's own heading, when its content has one. */
    title?: string;
    /* Where the heading points, when the thing the card is about has a home
       of its own (owner directive, 2026-08-28, issue 243: the Professional
       Experience employers "turn them into links"). The card renders the
       IDENTICAL title either way — same element, same class, same type step,
       same ink — and only wraps it in outbound navigation, because the
       instruction was explicitly "do not change the styling".
       It lives here rather than in the header snippet the linked EntryLog
       branch already uses because that branch replaces the whole header
       region, byline and all, and these cards need to keep theirs. */
    titleHref?: string;
    /* A source, a place, an author — whatever names the content's origin. */
    byline?: string;
    /* An ISO calendar date; rendered in words beside a machine-readable one. */
    date?: string;
    /* The heading level this card sits at in the document outline. A card is
       not always at the same depth, and a fixed h3 would break the outline
       wherever it is not. */
    titleLevel?: 2 | 3 | 4 | 5 | 6;
    variant?: FeedCardVariant;
    /* The per-instance tweak channel: a local custom-property override, e.g.
       style="--card-radius: 0". It exists so a one-off look never becomes a
       hardcoded value at the call site or a new prop here. */
    style?: string;
    /* Replaces the title/byline/date rendering when those cannot express the
       header — a link and its counters, for instance. */
    header?: Snippet;
    /* Runs to the card's edges: pictures, video, a full-bleed graphic. */
    media?: Snippet;
    children?: Snippet;
    footer?: Snippet;
  } = $props();

  const regions = $derived(
    feedCardRegions({
      title,
      byline,
      date,
      header: header !== undefined,
      media: media !== undefined,
      body: children !== undefined,
      footer: footer !== undefined
    })
  );
</script>

<article class="feed-card" data-variant={variant} {style}>
  {#if regions.header}
    <header class="feed-card-header">
      {#if header}
        {@render header()}
      {:else}
        {#if title}
          <!-- A LINKED HEADING NAMES ITSELF (review finding, 2026-08-28). The
            accessible name of a heading is computed from its descendants, and
            the anchor's aria-label REPLACES the anchor's contribution — so a
            linked card's heading announced "Panasonic Avionics (opens in a new
            tab)" as its own name, and the heading list a screen-reader user
            navigates by turned into a list of tab warnings. Naming the heading
            explicitly with the bare title puts each surface back in charge of
            its own name: the heading says what the role is, the link inside it
            still says where the press goes. Unlinked cards name themselves from
            their text, exactly as they always have. -->
          <svelte:element
            this={`h${titleLevel}`}
            class="feed-card-title"
            aria-label={titleHref ? title : undefined}>
            {#if titleHref}
              <!-- The href reaches the DOM as the anchor's value and nothing
                else; the title is TEXT, exactly as it is on an unlinked card.
                New tab with the opener severed, like every other outbound link
                on this page, and the accessible name says so — a reader using
                assistive technology is told a new tab is coming rather than
                discovering it. -->
              <a
                class="feed-card-title-link"
                href={titleHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${title} (opens in a new tab)`}>{title}</a
              >
            {:else}
              {title}
            {/if}
          </svelte:element>
        {/if}
        {#if regions.meta}
          <p class="feed-card-meta">
            {#if byline}<span class="feed-card-byline">{byline}</span>{/if}
            {#if date}<time class="feed-card-date" datetime={date}>{formatIsoDate(date)}</time>{/if}
          </p>
        {/if}
      {/if}
    </header>
  {/if}
  {#if regions.media}
    <div class="feed-card-media">{@render media?.()}</div>
  {/if}
  {#if regions.body}
    <div class="feed-card-body">{@render children?.()}</div>
  {/if}
  {#if regions.footer}
    <footer class="feed-card-footer">{@render footer?.()}</footer>
  {/if}
</article>

<style>
  /* The card itself. Every declaration reads a token; the defaults live in
     styles.css, and the variants below remap them on this element rather than
     restating any value. */
  .feed-card {
    display: grid;
    gap: var(--card-gap);
    /* Unbounded by default — the page column is the bound. It is a token so a
       feed of narrow cards is an override rather than a second component. */
    max-inline-size: var(--card-max-inline-size);
    padding: var(--card-padding);
    background: var(--card-surface);
    border: var(--card-border-width) var(--card-border-style) var(--card-border-color);
    border-radius: var(--card-radius);
    box-shadow: var(--card-shadow);
    color: var(--card-ink);
  }

  /* Media-led: the picture is the card, so the chrome stops taking room from
     it. The padding goes to zero and the media region's own negative inset
     (below) has nothing left to pull back — which is why a media card with a
     header still lines its title up with the picture's edge. */
  .feed-card[data-variant='media'] {
    --card-padding: 0rem;
    --card-gap: 0rem;
  }

  /* Flat: no frame at all, for content that must not read as a card. */
  .feed-card[data-variant='flat'] {
    --card-surface: transparent;
    --card-border-width: 0rem;
    --card-shadow: none;
    --card-padding: 0rem;
  }

  /* Compact: the framed card at a tighter rhythm, for dense rows. */
  .feed-card[data-variant='compact'] {
    --card-padding: var(--card-padding-compact);
    --card-gap: var(--card-gap-compact);
  }

  /* THE LEDGER FAMILY (owner directive, 2026-09-03, issue 287). Four looks,
     zero new rules of substance: each is a remap of the card's own tokens onto
     the ledger roles declared in styles.css, so the redesign moves what a card
     paints without this component learning a single value. A ledger block is
     the page's own paper with no frame, no radius and no shadow — the rules
     that separate its rows are drawn by the rows themselves, one hairline
     each, which is what makes a ledger read as one continuous sheet rather
     than as a stack of boxes. */
  .feed-card[data-variant='ledger'],
  .feed-card[data-variant='table'],
  .feed-card[data-variant='board'],
  .feed-card[data-variant='strip'] {
    --card-surface: transparent;
    --card-border-width: 0rem;
    --card-radius: 0rem;
    --card-shadow: none;
    --card-padding: 0rem;
    --card-gap: 0rem;
    --card-ink: var(--ledger-ink);
  }

  /* The board and the strip open a gap the ledger does not: a grid of squares
     needs air under the head it sits below, and the ticker needs the same
     under the board. The ledger and the table draw their own separation with
     rules instead, so a gap there would double it. */
  .feed-card[data-variant='board'],
  .feed-card[data-variant='strip'] {
    --card-gap: var(--square-gap);
  }

  .feed-card-header {
    display: grid;
    gap: var(--card-header-gap);
  }

  .feed-card-title {
    margin: 0;
    font-family: var(--card-title-family);
    font-size: var(--card-title-size);
    font-weight: var(--card-title-weight);
    letter-spacing: var(--card-title-tracking);
    line-height: var(--card-title-leading);
    color: var(--card-title-ink);
  }

  /* A LINKED TITLE LOOKS EXACTLY LIKE AN UNLINKED ONE (issue 243). The owner's
     instruction was "do not change the styling ... instead turn them into
     links", so every visual property is inherited from the heading above:
     the family, the size, the weight, the tracking and the INK, which is why
     `color: inherit` is stated rather than a token — the token is already
     resolved on the parent, and reading it again here would be a second place
     for the two to disagree. The resting underline is removed for the page's
     standing link doctrine (issue 203: nothing is underlined at rest) and
     returns the moment intent is shown, which is what keeps the link
     announced rather than hidden.

     THE ONE THING THAT IS NOT INHERITED IS THE BOX, and it is not a style
     choice. A link is a control, and every control on this page clears the
     44px touch floor on both axes (AGENTS.md, rendering lanes stage 1) — an
     inline anchor around a 17px line is 21px tall and fails it. So the anchor
     takes the identical treatment .entry-link already gives the repo card
     titles: an inline-flex box at the floor, with the text centred in it. The
     visible consequence is that the card's title row is taller than it was
     and the two title-bearing card families on this page now measure the
     same; the visible TEXT is unchanged, which is what the instruction was
     about. Waiving the floor for a control that happens to look like a
     heading was the other option and is not one: the floor is about what a
     finger can hit. */
  .feed-card-title-link {
    display: inline-flex;
    align-items: center;
    min-block-size: var(--card-link-target);
    min-inline-size: var(--card-link-target);
    color: inherit;
    text-decoration: none;
    text-underline-offset: var(--card-link-underline-offset);
  }

  .feed-card-title-link:hover,
  .feed-card-title-link:focus-visible {
    color: var(--color-brand);
    text-decoration: underline;
  }

  .feed-card-title-link:focus-visible {
    outline: var(--card-focus-ring-width) solid var(--color-accent);
    outline-offset: var(--card-focus-ring-offset);
  }

  .feed-card-meta,
  .feed-card-footer {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--card-meta-gap);
    font-family: var(--card-meta-family);
    font-size: var(--card-meta-size);
    font-weight: var(--card-meta-weight);
    letter-spacing: var(--card-meta-tracking);
    line-height: var(--card-meta-leading);
    color: var(--card-meta-ink);
  }

  /* The media region runs to the card's own edges: it pulls back the card's
     padding on every side, so a framed card crops its picture at the border
     and a media-led card (padding zero) pulls back nothing. One rule, both
     arrangements, no variant-specific media styling. */
  .feed-card-media {
    margin: calc(-1 * var(--card-padding));
    overflow: hidden;
    border-radius: calc(var(--card-radius) - var(--card-border-width));
  }

  /* A media region with anything under it must not also eat the gap below
     itself, so the pull-back is dropped on the block-end side when it is not
     the card's last region. */
  .feed-card-media:not(:last-child) {
    margin-block-end: 0;
  }

  /* A grid item's automatic minimum size is its MIN-CONTENT, so a region
     holding an unbreakable row — a segmented control, a table head — refuses
     to shrink and drags the card past the column, which the page then scrolls
     sideways to reveal. Zero as the minimum lets every region be exactly the
     card it was given, and anything genuinely too wide scrolls inside its own
     box instead. */
  .feed-card-header,
  .feed-card-body,
  .feed-card-footer {
    min-inline-size: 0;
  }

  .feed-card-body {
    display: grid;
    gap: var(--card-body-gap);
    font-size: var(--card-body-size);
    line-height: var(--card-body-leading);
  }
</style>
