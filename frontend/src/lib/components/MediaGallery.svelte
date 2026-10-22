<!-- MediaGallery is the sheet's last section (owner directive, 2026-09-03,
  issue 287): a row of square tiles — the first few of the chosen set — and a
  native <dialog> that is the stage. Five pictures span the column with nothing
  beside them (owner, 2026-10-17: no box of information and dead content); a
  set switch sits above them only when there is a set to switch to, and what an
  item is lives under it on the stage.

  A FILM'S TILE OPENS THE STAGE LIKE A PICTURE'S (issue 384). The user, on an
  iPhone, 2026-10-22: "the videos are not responsive to the touch, I should be
  able to click the video to expand it just as the pictures in the gallery".
  That supersedes two earlier rulings this component carried — a film playing
  INLINE in its own tile and never in the dialog (issue 233), and "the
  sensitive area should only be the button and not the entire video" (the play
  control of issue 243) — because together they made a film the one tile in
  the row that a press on the picture did nothing to. So every tile is now the
  same button over the same lazy preview, a film's carrying a play mark that
  is decoration rather than a second target; the stage pages the whole set,
  stills and films alike; and a film on the stage is one native player. The
  press on a film's tile starts it, because that press asked for it. Paging
  onto a film never does.

  This supersedes the single visible frame of issues 176, 202, 219, 243 and
  265, and it keeps what those rulings were FOR rather than their markup: one
  full-size item at a time (the dialog), the full derivative fetched only on
  demand, nothing autoplaying, every box reserved before a byte arrives so
  arrival moves nothing, prev/next as real 44px controls with the swipe as an
  addition to them on a still (a horizontal drag on a film belongs to its
  native scrubber), Escape and the backdrop and the close mark all closing,
  and focus handed back to the tile that opened the stage. What went with the
  strip is the strip: the drag-follow and its settle, the offset writes, the
  neighbour warming and the caption lane, none of which a tile grid has a
  surface for.

  The tiles are a GRID, not a carousel: at the reading width five squares
  fill the column, and on a phone the first four fold to two across. Which set
  the tiles show is data — an item's set is the manifest's word when it wrote
  one and the kind-derived default when it did not — and the switch offers a
  set only when there is more than one to choose (honest-states floor: a set
  exists exactly when something is in it). Every dimension is a token in styles.css; the component states no
  colour, length, radius or duration of its own. -->
<script lang="ts">
  import { tick } from 'svelte';
  import FeedCard from './FeedCard.svelte';
  import Icon from './Icon.svelte';
  import { swipeHorizontal } from '../gesture.ts';
  import type { MediaGalleryItem, MediaGalleryProps } from '../blocks.ts';
  import type { IconName } from '../icons.ts';

  let { items, width, height, tiles = 5 }: MediaGalleryProps = $props();

  /* The set an item belongs to: the manifest's word, else its kind's. */
  function setOf(candidate: MediaGalleryItem): string {
    return candidate.set ?? (candidate.video === undefined ? 'Photographs' : 'Videos');
  }
  const sets = $derived([...new Set(items.map(setOf))]);
  let chosenSet = $state<string | undefined>(undefined);
  /* A choice that no longer names a set (the items were replaced under it —
     a manifest load) resolves to the first set rather than to nothing. */
  const activeSet = $derived(
    chosenSet !== undefined && sets.includes(chosenSet) ? chosenSet : sets[0]
  );
  const visible = $derived(items.filter((candidate) => setOf(candidate) === activeSet));
  const shownTiles = $derived(visible.slice(0, Math.max(1, tiles)));
  function countOf(name: string): number {
    return items.filter((candidate) => setOf(candidate) === name).length;
  }
  /* A SET'S MARK IS ITS CONTENTS, not its word (owner design decision,
     2026-09-11, issue 313). The segment buttons print a mark where they used
     to print "Photographs" or "Videos", and the mark is decided the same way
     the default NAME already is — by what the set holds — so a manifest that
     names its own set still gets the right drawing, and a set that is all
     films is the only one that reads as film. A mixed set reads as pictures,
     which is the honest answer: it is not all films. */
  function setGlyph(name: string): IconName {
    const members = items.filter((candidate) => setOf(candidate) === name);
    return members.every((candidate) => candidate.video !== undefined) ? 'film' : 'photo';
  }
  function itemNoun(candidate: MediaGalleryItem): string {
    return candidate.video === undefined ? 'photograph' : 'film';
  }
  /* THE STAGE pages the WHOLE chosen set, stills and films alike (issue
     384): a film is opened exactly as a picture is. index is assigned in
     exactly four places — open, next, previous and a set change — and read
     clamped, so a set shrinking under it (a manifest load) can never leave it
     pointing past the end. */
  let index = $state(0);
  let enlarged = $state(false);
  const total = $derived(visible.length);
  const shown = $derived(Math.min(index, Math.max(0, total - 1)));
  const item = $derived(visible[shown]);
  let openerEl: HTMLElement | undefined;
  /* WHICH FILM A PRESS ASKED FOR. The press on a film's tile is the reader
     asking to watch it, so the film that press opened starts; paging onto a
     film — the pair, an arrow key, a swipe — asks only to see it, so it
     arrives on its poster and waits. A plain variable rather than state:
     nothing renders from it, it is read once by the stage player as it
     mounts, and every other road onto the stage clears it first. */
  let pressedKey: string | undefined;
  function open(chosen: MediaGalleryItem, from: EventTarget | null): void {
    index = Math.max(0, visible.indexOf(chosen));
    openerEl = from instanceof HTMLElement ? from : undefined;
    pressedKey = chosen.video === undefined ? undefined : chosen.key;
    enlarged = true;
  }
  function next(): void {
    pressedKey = undefined;
    index = (shown + 1) % total;
    void keepPairFocus();
  }
  function previous(): void {
    pressedKey = undefined;
    index = (shown - 1 + total) % total;
    void keepPairFocus();
  }
  /* A TURN KEEPS THE KEYBOARD ON THE PAIR. A turn between a still and a film
     swaps the stage the pair sits in, so the control a keyboard reader just
     pressed is replaced by its twin. Which one had focus is read BEFORE the
     swap, and focus follows it to the twin, rather than falling to the
     document where the next key reaches nothing. A turn that swaps nothing
     focuses the control that already has it. */
  async function keepPairFocus(): Promise<void> {
    const side = document.activeElement?.getAttribute('data-gallery-nav');
    if (!side) return;
    await tick();
    dialogEl?.querySelector<HTMLElement>(`.gallery-nav[data-gallery-nav="${side}"]`)?.focus();
  }
  function selectSet(name: string): void {
    if (name !== activeSet) {
      chosenSet = name;
      pressedKey = undefined;
      index = 0;
    }
  }
  const hasMeta = $derived(
    item !== undefined && (Boolean(item.title) || Boolean(item.description) || item.link !== undefined)
  );

  /* THE ONE PLACE A FILM IS STARTED: the stage player, as it mounts, when it
     is the film a tile press asked for. Nothing calls play() from paging, a
     lifecycle or a scroll, and no element asks to start itself. The player
     is keyed by item, so every film arrives as a fresh element and this runs
     once per arrival; closing the stage removes the element, which ends the
     playback with it. A refused start (no rendition this engine can play, a
     platform that wants a second press) leaves the native controls to the
     reader rather than surfacing an error. */
  function startIfPressed(node: HTMLVideoElement, key: string): void {
    if (key === pressedKey) {
      pressedKey = undefined;
      void node.play().catch(() => {});
    }
  }

  /* The swipe pages the stage and nothing more: no drag-follow, no settle,
     because the enlarged picture is not a strip and a picture that slid with
     the finger would slide out of the viewport it is anchored to. lib/gesture.ts
     still decides what counts as a horizontal swipe, so the page's vertical
     scroll is never contested. */
  let dialogEl: HTMLDialogElement | undefined = $state();
  const swipe = {
    span: () => dialogEl?.getBoundingClientRect().width ?? 0,
    move: () => {},
    commit: (direction: -1 | 1) => (direction === 1 ? next() : previous()),
    settle: () => {},
    atStart: () => false,
    atEnd: () => false
  };

  /* A stage with nothing to show closes rather than showing nothing. */
  $effect(() => {
    if (enlarged && item === undefined) {
      enlarged = false;
    }
  });

  /* THE DOCUMENT HOLDS STILL UNDER THE OPEN STAGE (issue 241). A modal makes
     the document inert to pointer interaction and nothing else: a wheel, a
     two-finger drag, PageDown and the space bar all still scroll the page
     underneath the scrim, and closing then returned the reader to a place
     they never chose. The lock is one attribute on the document element, read
     by one rule in styles.css (`overflow: hidden`). It is written by an effect
     rather than by the open/close handlers so it cannot be left behind: an
     effect's teardown runs when `enlarged` goes false AND when this component
     unmounts with the dialog still open, which no pair of handlers can promise.
     The giveback beside it is the zero-CLS half: removing the document's
     overflow removes its scrollbar, so on a classic-scrollbar platform the
     column would widen by the scrollbar's thickness as the stage opened. That
     thickness is a platform fact no stylesheet can name — 0 wherever
     scrollbars overlay — so it is measured HERE, while the scrollbar is still
     taking its space, and handed to the rule as root padding. */
  $effect(() => {
    if (!enlarged) {
      return;
    }
    const root = document.documentElement;
    const giveback = window.innerWidth - root.clientWidth;
    if (giveback > 0) {
      root.style.setProperty('--modal-scrollbar-giveback', `${giveback}px`);
    }
    root.setAttribute('data-modal-open', 'true');
    return () => {
      root.removeAttribute('data-modal-open');
      root.style.removeProperty('--modal-scrollbar-giveback');
    };
  });
  $effect(() => {
    if (dialogEl === undefined) return;
    if (enlarged && !dialogEl.open) dialogEl.showModal();
    else if (!enlarged && dialogEl.open) dialogEl.close();
  });
  /* Escape, the backdrop and the close mark all arrive here, so this is the
     single place `enlarged` resets. Focus goes back to the tile that opened
     the stage explicitly: a native <dialog> restores it to whatever was
     focused before showModal(), and on macOS WebKit a mouse click does not
     focus a <button> at all, so on the engine every iOS browser runs the
     "previously focused element" would be the document body. */
  async function onDialogClose(): Promise<void> {
    enlarged = false;
    await tick();
    openerEl?.focus();
  }
  function onDialogKeydown(event: KeyboardEvent): void {
    /* An arrow pressed on a film's own player is the player's — it seeks —
       the keyboard twin of the drag the film's stage leaves to its scrubber
       (issue 384). Everywhere else in the open stage an arrow turns it. */
    if (event.target instanceof HTMLMediaElement) return;
    if (event.key === 'ArrowRight') next();
    else if (event.key === 'ArrowLeft') previous();
  }
  function onBackdropClick(event: MouseEvent): void {
    if (event.target === dialogEl) dialogEl?.close();
  }
</script>

{#if items.length > 0}
  <FeedCard variant="flat">
    {#snippet media()}
      {#if sets.length > 1}
        <div class="gallery-sets" role="group" aria-label="Media set">
          {#each sets as name (name)}
            <!-- The set's WORD moved to the accessible name and nowhere else:
              aria-label replaces a control's contents in the accessibility
              tree, so a screen reader hears "Photographs · 1" where the eye
              reads a mark and a figure. The count stays visible because a
              figure is a fact, not a label. -->
            <button
              type="button"
              class="gallery-set"
              aria-pressed={name === activeSet}
              aria-label={`${name} · ${countOf(name)}`}
              onclick={() => selectSet(name)}
              ><Icon name={setGlyph(name)} slot="row" /> · {countOf(name)}</button>
          {/each}
        </div>
      {/if}
      <div class="gallery-grid" data-gallery-tiles={shownTiles.length}>
        {#each shownTiles as tile (tile.key)}
          <!-- ONE TILE SHAPE for every item (issue 384): a still and a film
            are the same button over the same lazy preview, so a press on a
            film's picture opens the stage exactly as a press on a still's
            does. A film's tile adds a play mark, centred and hidden from the
            accessibility tree: it says what the tile holds, and the button's
            own name already says so in words. -->
          <button
            type="button"
            class="gallery-tile"
            data-gallery-kind={tile.video ? 'video' : 'image'}
            onclick={(event) => open(tile, event.currentTarget)}
            aria-label={`Open ${itemNoun(tile)}: ${tile.alt}`}
          >
            <img
              class="gallery-thumb"
              src={tile.previewSrc}
              alt=""
              width={tile.width ?? width}
              height={tile.height ?? height}
              loading="lazy"
              decoding="async"
            />
            {#if tile.video}
              <span class="gallery-play-disc" aria-hidden="true">
                <Icon name="play" slot="chrome" />
              </span>
            {/if}
          </button>
        {/each}
      </div>
    {/snippet}
  </FeedCard>

  <dialog
    bind:this={dialogEl}
    class="gallery-lightbox"
    aria-label={item?.alt ?? ''}
    onclose={onDialogClose}
    onkeydown={onDialogKeydown}
    onclick={onBackdropClick}
  >
    <button
      type="button"
      class="icon-button gallery-lightbox-close"
      onclick={() => dialogEl?.close()}
      aria-label={item === undefined ? 'Close' : `Close enlarged ${itemNoun(item)}`}
    >
      <span class="gallery-close-mark">
        <Icon name="close" slot="cell" />
      </span>
    </button>
    {#if enlarged && item !== undefined}
      <!-- The pair is one pair whichever kind is staged: the same two 44px
        controls on the item's own edges, drawn only when there is somewhere
        to go. -->
      {#snippet pager()}
        {#if total > 1}
          <button
            type="button"
            class="gallery-nav"
            data-gallery-nav="previous"
            onclick={previous}
            aria-label={`Previous ${itemNoun(visible[(shown - 1 + total) % total])}`}
          >
            <span class="gallery-nav-disc">
              <Icon name="chevron-left" slot="row" />
            </span>
          </button>
          <button
            type="button"
            class="gallery-nav"
            data-gallery-nav="next"
            onclick={next}
            aria-label={`Next ${itemNoun(visible[(shown + 1) % total])}`}
          >
            <span class="gallery-nav-disc">
              <Icon name="chevron-right" slot="row" />
            </span>
          </button>
        {/if}
      {/snippet}
      {#if item.video}
        <!-- A FILM ON THE STAGE (issue 384): one native player, its poster
          the manifest's, its ladder the manifest's own order, its box
          reserved from the item's declared size before a byte arrives. Its
          stage carries NO swipe binding: a horizontal drag across a film is
          the reader scrubbing it with the native controls, never a turn of
          the page.
          The PLAYER is keyed by item, so paging always builds a fresh one: a
          player whose <source> children are swapped under it keeps the
          rendition it already chose, and the start rule runs once per
          arrival. The stage and its pair are not keyed, so a keyboard reader
          paging from film to film keeps the control they were pressing. -->
        <div class="gallery-stage">
          {#key item.key}
            <video
              class="gallery-lightbox-film"
              controls
              playsinline
              preload="metadata"
              poster={item.video.posterSrc}
              aria-label={item.alt}
              width={item.width ?? width}
              height={item.height ?? height}
              use:startIfPressed={item.key}
            >
              {#each item.video.sources as source (source.src)}
                <source src={source.src} type={source.type} media={source.media} />
              {/each}
            </video>
          {/key}
          {@render pager()}
        </div>
      {:else}
        <!-- The full derivative can be megabytes; until it decodes, the small
          preview — already in cache, it is the tile — paints as the element's
          background so the stage opens onto the picture instead of a void.
          WHICH DERIVATIVE is a media query on the VIEWPORT (issue 241): at or
          below the preview's own declared width the preview covers the box at
          better than 2x on a phone; above it the master is the honest answer.
          An item whose source declares no preview width loads the full
          derivative exactly as before.
          A still is NOT keyed: paging from still to still changes the
          picture in place, and the engine keeps painting the outgoing
          picture until the incoming one has a size. A rebuilt <img> has no
          size until its bytes arrive — MEASURED with the still keyed, the
          dialog collapsed to 96px for a frame on one turn of four in
          Chromium, served from localhost; unkeyed, it held its height on
          every turn in all three engines. -->
        <div class="gallery-stage" use:swipeHorizontal={swipe}>
          <picture>
            {#if item.previewWidth !== undefined}
              <source media={`(max-width: ${item.previewWidth}px)`} srcset={item.previewSrc} />
            {/if}
            <img
              class="gallery-lightbox-image"
              src={item.fullSrc}
              alt={item.alt}
              style={`background-image: url("${item.previewSrc}")`}
            />
          </picture>
          {@render pager()}
        </div>
      {/if}
      <div class="gallery-lightbox-meta">
        {#if total > 1}
          <p class="gallery-count" aria-live="polite">
            {itemNoun(item).charAt(0).toUpperCase()}{itemNoun(item).slice(1)} {shown + 1} of {total}
          </p>
        {/if}
        {#if hasMeta}
          {#if item.title}<p class="gallery-meta-title">{item.title}</p>{/if}
          {#if item.description}<p class="gallery-meta-text">{item.description}</p>{/if}
          {#if item.link}
            <a
              class="gallery-meta-link"
              href={item.link.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${item.link.label} (opens in a new tab)`}>{item.link.label}</a
            >
          {/if}
        {/if}
      </div>
    {/if}
  </dialog>
{/if}

<style>
  /* THE GRID: one track per tile, so the row fills the column with no
     gutter left dead (owner rule: content short of its container's edge is a
     defect). The column count is a token the phone block halves, and there
     only the first four tiles show, so no tile stands alone in a row. */
  .gallery-grid {
    display: grid;
    grid-template-columns: repeat(var(--gallery-columns), minmax(0, 1fr));
    gap: var(--gallery-tile-gap);
  }

  /* EVERY TILE RESERVES ITS SQUARE before a byte arrives: the box is the
     track's width by aspect, never the picture's, so a lazy thumbnail or a
     poster in flight moves nothing under a reader. */
  .gallery-tile {
    position: relative;
    display: block;
    justify-self: stretch;
    min-inline-size: var(--control-target);
    min-block-size: var(--control-target);
    aspect-ratio: var(--gallery-tile-aspect);
    margin: 0;
    padding: 0;
    border: 0;
    overflow: hidden;
    background: var(--gallery-stage-ground);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .gallery-tile:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }
  .gallery-thumb {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
  }

  /* A film's play mark (issue 384): decoration centred over the picture,
     translucent at rest so it never becomes the picture, and brightened by
     the tile it sits on — the whole tile is the target now, not the mark. */
  .gallery-play-disc {
    position: absolute;
    inset: 0;
    margin: auto;
    display: grid;
    place-items: center;
    inline-size: var(--gallery-play-button-size);
    block-size: var(--gallery-play-button-size);
    border-radius: 999px;
    background: var(--gallery-play-button-surface);
    color: var(--gallery-play-button-ink);
    opacity: var(--gallery-play-button-rest-opacity);
    padding-inline-start: var(--gallery-play-button-nudge);
  }
  .gallery-tile:hover .gallery-play-disc,
  .gallery-tile:focus-visible .gallery-play-disc {
    opacity: 1;
  }

  /* THE SET SWITCH, only when there is a choice: a centred row above the
     strip with no box and no ground, the chosen set marked by the brand ink
     and its underline, like every other switch on the sheet. */
  .gallery-sets {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--gallery-sets-gap);
    margin-block-end: var(--gallery-sets-gap);
  }
  .gallery-set {
    display: inline-flex;
    align-items: center;
    gap: var(--icon-gap);
    min-inline-size: var(--control-target);
    min-block-size: var(--control-target);
    padding: 0 var(--gallery-sets-gap);
    border: 0;
    border-block-end: 2px solid transparent;
    background: none;
    color: var(--ledger-muted);
    font-family: var(--font-mono);
    font-size: var(--ledger-label-size);
    letter-spacing: var(--ledger-label-tracking);
    text-transform: uppercase;
    cursor: pointer;
  }
  /* The chosen set is underlined by a sword, like the trackers' picked layer
     (owner, 2026-10-19: "we should have swords"). */
  .gallery-set[aria-pressed='true'] {
    color: var(--color-brand);
    background: var(--keep-sword-underline);
  }
  .gallery-set:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  /* THE STAGE: a native dialog anchored to the viewport, the picture
     edge-to-edge against the scrim, the prev/next pair on the picture's own
     edges inside 44px targets, the close mark off the artwork. */
  .gallery-lightbox {
    position: fixed;
    inset: 0;
    margin: auto;
    inline-size: fit-content;
    block-size: fit-content;
    max-inline-size: var(--gallery-lightbox-max-inline);
    padding: var(--gallery-close-lane) 0 0;
    border: none;
    background: none;
  }
  .gallery-lightbox::backdrop {
    background: var(--gallery-scrim);
  }
  .gallery-stage {
    position: relative;
    /* The plain value is the stage-1 fallback; the pair is what lets two
       fingers zoom the artwork instead of being refused (issue 241). */
    touch-action: pan-y;
    touch-action: pan-y pinch-zoom;
  }
  .gallery-lightbox-image {
    display: block;
    inline-size: auto;
    block-size: auto;
    max-inline-size: var(--gallery-lightbox-max-inline);
    max-block-size: var(--gallery-image-max-block);
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
  }
  /* A FILM ON THE STAGE reserves its whole box before a byte arrives (issue
     384): the stage's own inline cap, a block size from the width and height
     the item declares, the still's block cap over it, and the film reduced
     inside that box on the ground a poster in flight sits on. */
  .gallery-lightbox-film {
    display: block;
    inline-size: var(--gallery-lightbox-max-inline);
    block-size: auto;
    max-block-size: var(--gallery-image-max-block);
    object-fit: contain;
    background: var(--gallery-stage-ground);
  }
  @supports (max-block-size: 1svh) {
    .gallery-lightbox-image {
      max-block-size: 80svh;
    }
    .gallery-lightbox-film {
      max-block-size: 80svh;
    }
  }
  .gallery-nav {
    position: absolute;
    inset-block: 0;
    margin: auto 0;
    display: grid;
    place-items: center;
    inline-size: var(--control-target);
    block-size: var(--control-target);
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    color: var(--gallery-nav-ink);
  }
  .gallery-nav[data-gallery-nav='previous'] {
    inset-inline-start: var(--gallery-nav-inset);
  }
  .gallery-nav[data-gallery-nav='next'] {
    inset-inline-end: var(--gallery-nav-inset);
  }
  .gallery-nav-disc {
    display: grid;
    place-items: center;
    inline-size: var(--gallery-nav-size);
    block-size: var(--gallery-nav-size);
    border-radius: 999px;
    background: var(--gallery-nav-surface);
    opacity: var(--gallery-nav-rest-opacity);
  }
  .gallery-nav:hover .gallery-nav-disc,
  .gallery-nav:focus-visible .gallery-nav-disc {
    opacity: 1;
  }
  .gallery-nav:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -4px;
    border-radius: 999px;
  }
  .gallery-lightbox-close {
    position: absolute;
    inset-block-start: 0;
    inset-inline-end: 0;
    place-items: start end;
    background: none;
    color: var(--gallery-close-ink);
  }
  .gallery-close-mark {
    display: grid;
    place-items: center;
    inline-size: var(--gallery-close-size);
    block-size: var(--gallery-close-size);
    border-radius: 999px;
    background: var(--gallery-close-surface);
    opacity: var(--gallery-close-rest-opacity);
  }
  .gallery-lightbox-close:hover .gallery-close-mark,
  .gallery-lightbox-close:focus-visible .gallery-close-mark {
    opacity: 1;
  }
  .gallery-lightbox-meta {
    display: grid;
    justify-items: center;
    gap: var(--gallery-meta-gap);
    margin-block-start: var(--gallery-meta-space);
    text-align: center;
    font-size: var(--card-meta-size);
    line-height: var(--card-meta-leading);
    color: var(--gallery-meta-ink);
  }
  .gallery-count,
  .gallery-meta-title,
  .gallery-meta-text {
    margin: 0;
  }
  .gallery-meta-title {
    font-weight: var(--card-title-weight);
  }
  .gallery-meta-link {
    display: inline-flex;
    align-items: center;
    min-block-size: var(--control-target);
    padding-inline: var(--gallery-meta-link-padding);
    color: inherit;
    text-decoration: none;
  }
  .gallery-meta-link:hover,
  .gallery-meta-link:focus-visible {
    text-decoration: underline;
  }
</style>
