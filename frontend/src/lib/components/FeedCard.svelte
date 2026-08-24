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
          <svelte:element this={`h${titleLevel}`} class="feed-card-title">{title}</svelte:element>
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

  .feed-card-body {
    display: grid;
    gap: var(--card-body-gap);
    font-size: var(--card-body-size);
    line-height: var(--card-body-leading);
  }
</style>
