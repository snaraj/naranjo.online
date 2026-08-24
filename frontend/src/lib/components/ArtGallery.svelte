<!-- ArtGallery is the Art half of the Projects section (owner directive, issue
  134): a feed of eight full-resolution placeholder photographs, deliberately
  heavy, so the owner can watch a real page carry real weight.

  A FEED, not a mosaic: one vertical column of cards, each card one picture
  filling the card's width, which is the arrangement the owner sketched for the
  whole page and asked for by name here. Every card is the shared FeedCard
  primitive in its media-led variant, so these pictures already have the header,
  date, byline and footer regions the owner wants later — they are simply given
  nothing to put in them today, and a card with no title renders no title band
  rather than an empty one.

  The pictures are NOT in this repository (requirement 11). Each frame asks the
  origin's media route for one immutable publication, addressed by the digest
  of its own bytes through lib/media.ts — this component knows no host, no
  volume and no path, and could not construct one if it wanted to.

  Media delivery is off unless an operator enables it, which makes the
  not-serving case the ORDINARY case rather than the exception, so it is
  designed rather than handled. Every frame is drawn before any byte arrives —
  same box, same ratio, same place — and a frame whose picture the origin does
  not serve simply keeps the frame. Nothing shifts when a photograph lands,
  nothing shows a browser's broken-image glyph, and the note above the feed
  says plainly that this origin is not serving media rather than implying that
  something went wrong.

  Weight is the point, so the pictures are not shrunk to make the page feel
  quick: the first is fetched eagerly because it is the one a visitor is
  looking at, and every other is deferred until it is scrolled toward. -->
<script lang="ts">
  import FeedCard from './FeedCard.svelte';
  import {
    artHeight,
    artLabel,
    artPieces,
    artSource,
    artUnavailableNote,
    artWidth
  } from '../art.ts';

  /* The rows whose picture the origin did not serve, by digest. Tracked per
     row because each frame answers for itself, and every frame keeps its own
     box whether its picture arrives or not.

     The NOTE, though, hangs off the first row alone, and that is a lazy-
     loading fact rather than a preference: every picture after the first is
     deferred until it is scrolled toward, so a reader at the top of the feed
     has only ever asked for one of them. Waiting for all eight to answer means
     the explanation never appears for anyone who does not scroll the whole
     gallery — measured, in every engine: two, three and six of eight had
     answered when the lane looked. The first picture is the one always
     requested, so it is the one that can carry the explanation. */
  let missing = $state<string[]>([]);

  const unserved = $derived(missing.includes(artPieces[0]?.sha256 ?? ''));

  function markMissing(sha256: string): void {
    if (!missing.includes(sha256)) {
      missing.push(sha256);
    }
  }
</script>

<div class="art-feed">
  {#if unserved}
    <p class="section-note" data-art-unserved="true">{artUnavailableNote}</p>
  {/if}
  {#each artPieces as piece, index (piece.sha256)}
    <FeedCard variant="media">
      {#snippet media()}
        <div class="art-frame">
          {#if missing.includes(piece.sha256)}
            <!-- The designed empty frame: the same box the photograph would
              occupy, so its arrival — or its absence — moves nothing. -->
            <span class="art-pending" data-art-pending="true">
              {artLabel(index, artPieces.length)}
            </span>
          {:else}
            <img
              class="art-image"
              src={artSource(piece)}
              alt={artLabel(index, artPieces.length)}
              width={artWidth}
              height={artHeight}
              loading={index === 0 ? 'eager' : 'lazy'}
              decoding="async"
              onerror={() => markMissing(piece.sha256)}
            />
          {/if}
        </div>
      {/snippet}
    </FeedCard>
  {/each}
</div>

<style>
  .art-feed {
    display: grid;
    gap: var(--feed-gap);
  }

  /* The reserved box, and the reason nothing on this page moves when six
     megabytes of photography arrives. The minimum height is the base an engine
     without aspect-ratio keeps; the ratio is the upgrade, and it is the same
     token the markup's width and height attributes describe, so the two cannot
     disagree about the shape of the hole they are holding open. */
  .art-frame {
    display: grid;
    min-block-size: 8rem;
    aspect-ratio: var(--card-media-aspect);
  }

  .art-image {
    inline-size: 100%;
    block-size: 100%;
    object-fit: var(--card-media-fit);
  }

  /* The frame with no picture in it. It reads as a deliberate empty frame —
     the number of the placeholder, centred, in the same muted ink every other
     secondary line on the page uses — rather than as a hole or a failure. */
  .art-pending {
    display: grid;
    place-items: center;
    padding: var(--card-padding-compact);
    text-align: center;
    font-size: var(--card-meta-size);
    letter-spacing: var(--card-meta-tracking);
    color: var(--card-meta-ink);
  }
</style>
