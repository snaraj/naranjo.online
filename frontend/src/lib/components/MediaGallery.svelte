<!-- MediaGallery is the sheet's last section (owner directive, 2026-09-03,
  issue 287): a row of square tiles — the first few of the chosen set — beside
  one control tile, and a native <dialog> that is the stage.

  This supersedes the single visible frame of issues 176, 202, 219, 243 and
  265, and it keeps what those rulings were FOR rather than their markup: one
  full-size picture at a time (the dialog), the full derivative fetched only
  on demand, nothing autoplaying, a film playing INLINE in its own tile behind
  one play control and never in the dialog (issue 233), every box reserved
  before a byte arrives so arrival moves nothing, prev/next as real 44px
  controls with the swipe as an addition to them, Escape and the backdrop and
  the close mark all closing, and focus handed back to the tile that opened
  the stage. What went with the strip is the strip: the drag-follow and its
  settle, the offset writes, the neighbour warming and the caption lane, none
  of which a tile grid has a surface for.

  The tiles are a GRID, not a carousel: at the reading width the mock draws
  four squares and the control tile across the column, and on a phone the same
  tiles fold to two across. Which set the tiles show is data — an item's set
  is the manifest's word when it wrote one and the kind-derived default when
  it did not — and the control tile offers a set only when there is more than
  one to choose (honest-states floor: a set exists exactly when something is
  in it). Every dimension is a token in styles.css; the component states no
  colour, length, radius or duration of its own. -->
<script lang="ts">
  import { tick } from 'svelte';
  import FeedCard from './FeedCard.svelte';
  import { swipeHorizontal } from '../gesture.ts';
  import type { MediaGalleryItem, MediaGalleryProps } from '../blocks.ts';

  let { items, width, height, tiles = 4 }: MediaGalleryProps = $props();

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
  /* The stage pages the set's STILLS: a film is played where it sits. */
  const stills = $derived(visible.filter((candidate) => candidate.video === undefined));
  function countOf(name: string): number {
    return items.filter((candidate) => setOf(candidate) === name).length;
  }
  function itemNoun(candidate: MediaGalleryItem): string {
    return candidate.video === undefined ? 'photograph' : 'film';
  }
  const note = $derived(
    visible.length > shownTiles.length
      ? `${shownTiles.length} of ${visible.length} shown · open one to page through all`
      : `${visible.length} ${visible.length === 1 ? 'item' : 'items'}`
  );

  /* THE STAGE. index is assigned in exactly four places — open, next,
     previous and a set change — and read clamped, so a set shrinking under
     it (a manifest load) can never leave it pointing past the end. */
  let index = $state(0);
  let enlarged = $state(false);
  const total = $derived(stills.length);
  const shown = $derived(Math.min(index, Math.max(0, total - 1)));
  const item = $derived(stills[shown]);
  let openerEl: HTMLElement | undefined;
  function open(still: MediaGalleryItem, from: EventTarget | null): void {
    index = Math.max(0, stills.indexOf(still));
    openerEl = from instanceof HTMLElement ? from : undefined;
    enlarged = true;
  }
  function next(): void {
    index = (shown + 1) % total;
  }
  function previous(): void {
    index = (shown - 1 + total) % total;
  }
  function selectSet(name: string): void {
    if (name !== activeSet) {
      chosenSet = name;
      playingKey = undefined;
      index = 0;
    }
  }
  const hasMeta = $derived(
    item !== undefined && (Boolean(item.title) || Boolean(item.description) || item.link !== undefined)
  );

  /* FILMS play in their tile (issue 233): one at a time, by key rather than
     by flag so no tile can wear another tile's surface, and never started by
     anything but the press on the control — nothing here calls play() from a
     lifecycle or a scroll. The key is cleared by a set change and by the film
     ending, which hands the tile back to its poster and play control. */
  let playingKey = $state<string | undefined>(undefined);
  let players = $state<Record<string, HTMLVideoElement | undefined>>({});
  function startFilm(key: string): void {
    playingKey = key;
    void players[key]?.play().catch(() => {});
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
      <div class="gallery-grid" data-gallery-tiles={shownTiles.length}>
        {#each shownTiles as tile (tile.key)}
          {#if tile.video}
            <!-- A film's tile IS its player: the poster until the press, the
              native controls after it. The tile keeps the same square box
              and the film reduces inside it against the stage ground, so a
              set of films and a set of stills lay out identically. -->
            <div class="gallery-tile" data-gallery-kind="video">
              <video
                class="gallery-player"
                controls={playingKey === tile.key}
                playsinline
                preload="metadata"
                poster={tile.video.posterSrc}
                aria-label={tile.alt}
                width={tile.width ?? width}
                height={tile.height ?? height}
                onended={() => (playingKey = undefined)}
                bind:this={players[tile.key]}
              >
                {#each tile.video.sources as source (source.src)}
                  <source src={source.src} type={source.type} media={source.media} />
                {/each}
              </video>
              {#if playingKey !== tile.key}
                <button
                  type="button"
                  class="gallery-play"
                  onclick={() => startFilm(tile.key)}
                  aria-label={`Play ${tile.alt}`}
                >
                  <span class="gallery-play-disc">
                    <svg class="gallery-glyph" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                      <path d="M9 6.5l9 5.5-9 5.5z" fill="currentColor" />
                    </svg>
                  </span>
                </button>
              {/if}
            </div>
          {:else}
            <button
              type="button"
              class="gallery-tile"
              data-gallery-kind="image"
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
            </button>
          {/if}
        {/each}
        <div class="gallery-control">
          <p class="gallery-control-label">Gallery</p>
          {#if sets.length > 1}
            <div class="gallery-sets" role="group" aria-label="Media set">
              {#each sets as name (name)}
                <button
                  type="button"
                  class="gallery-set"
                  aria-pressed={name === activeSet}
                  onclick={() => selectSet(name)}>{name} · {countOf(name)}</button>
              {/each}
            </div>
          {:else}
            <p class="gallery-set-name">{activeSet}</p>
          {/if}
          <p class="gallery-control-note">{note}</p>
        </div>
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
      aria-label="Close enlarged photograph"
    >
      <span class="gallery-close-mark">
        <svg class="gallery-glyph" viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        </svg>
      </span>
    </button>
    {#if enlarged && item !== undefined}
      <!-- The full derivative can be megabytes; until it decodes, the small
        preview — already in cache, it is the tile — paints as the element's
        background so the stage opens onto the picture instead of a void.
        WHICH DERIVATIVE is a media query on the VIEWPORT (issue 241): at or
        below the preview's own declared width the preview covers the box at
        better than 2x on a phone; above it the master is the honest answer.
        An item whose source declares no preview width loads the full
        derivative exactly as before. -->
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
        {#if total > 1}
          <button
            type="button"
            class="gallery-nav"
            data-gallery-nav="previous"
            onclick={previous}
            aria-label={`Previous ${itemNoun(stills[(shown - 1 + total) % total])}`}
          >
            <span class="gallery-nav-disc">
              <svg class="gallery-glyph" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M14.5 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
          </button>
          <button
            type="button"
            class="gallery-nav"
            data-gallery-nav="next"
            onclick={next}
            aria-label={`Next ${itemNoun(stills[(shown + 1) % total])}`}
          >
            <span class="gallery-nav-disc">
              <svg class="gallery-glyph" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
          </button>
        {/if}
      </div>
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
  /* THE GRID: the tiles and the control tile share one track list, so the
     control tile is exactly one tile wide and the row fills the column with
     no gutter left dead (owner rule: content short of its container's edge is
     a defect). The column count is a token the phone block halves. */
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
  }
  .gallery-tile[data-gallery-kind='image'] {
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
  .gallery-player {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
    object-fit: contain;
  }

  /* The film's play control (issue 243): one 44px target centred on the
     tile, translucent at rest so it never becomes the picture. */
  .gallery-play {
    position: absolute;
    inset: 0;
    margin: auto;
    display: grid;
    place-items: center;
    inline-size: var(--control-target);
    block-size: var(--control-target);
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    color: var(--gallery-play-button-ink);
  }
  .gallery-play-disc {
    display: grid;
    place-items: center;
    inline-size: var(--gallery-play-button-size);
    block-size: var(--gallery-play-button-size);
    border-radius: 999px;
    background: var(--gallery-play-button-surface);
    opacity: var(--gallery-play-button-rest-opacity);
    padding-inline-start: var(--gallery-play-button-nudge);
  }
  .gallery-play:hover .gallery-play-disc,
  .gallery-play:focus-visible .gallery-play-disc {
    opacity: 1;
  }
  .gallery-play:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -4px;
    border-radius: 999px;
  }

  /* THE CONTROL TILE, in the ledger's own grammar: a hairline box, a mono
     label, the set switch (only when there is a choice) and one honest line
     about how much of the set the row shows. */
  .gallery-control {
    display: grid;
    align-content: start;
    gap: var(--gallery-control-gap);
    min-inline-size: 0;
    padding: var(--gallery-control-pad);
    border: var(--ledger-hairline) solid var(--ledger-rule);
    background: var(--ledger-bg);
  }
  .gallery-control-label,
  .gallery-control-note,
  .gallery-set-name {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--ledger-label-size);
    letter-spacing: var(--ledger-label-tracking);
    text-transform: uppercase;
    color: var(--ledger-muted);
  }
  .gallery-set-name,
  .gallery-control-note {
    letter-spacing: 0;
    text-transform: none;
  }
  .gallery-sets {
    display: grid;
    gap: var(--gallery-control-gap);
  }
  .gallery-set {
    display: inline-flex;
    align-items: center;
    min-inline-size: var(--control-target);
    min-block-size: var(--control-target);
    padding: 0 var(--gallery-control-gap);
    border: var(--ledger-hairline) solid var(--ledger-rule);
    background: var(--ledger-bg);
    color: var(--ledger-ink);
    font-family: var(--font-mono);
    font-size: var(--ledger-label-size);
    letter-spacing: var(--ledger-label-tracking);
    text-transform: uppercase;
    cursor: pointer;
  }
  .gallery-set[aria-pressed='true'] {
    background: var(--ledger-ink);
    color: var(--ledger-bg);
    border-color: var(--ledger-ink);
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
  @supports (max-block-size: 1svh) {
    .gallery-lightbox-image {
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
  .gallery-glyph {
    color: inherit;
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
