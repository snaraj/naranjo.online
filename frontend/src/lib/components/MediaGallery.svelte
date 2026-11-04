<!-- MediaGallery is the sheet's last section (owner directive, 2026-09-03,
  issue 287): a mosaic of tiles, a page at a time, and a native <dialog> that
  is the stage. Drawings and films share the one grid (owner, 2026-11-02,
  issue 399: "let's combine videos and drawings"), so the set switch that
  chose between them is gone; what an item is lives under it on the stage.
  Their order is chance, once per visit (owner, 2026-11-04, issue 405: "this
  is fine, just make it random"): the grid lays a shuffled copy of the items,
  and the manifest's own order means nothing to it. So a drawing lands in a
  wide tile as often as in a square, and every tile shows its picture WHOLE,
  at the width its shape spans and in the picture's own proportions (owner,
  2026-11-04, on the 0.1.104 preview: "just zoom out instead of having the
  ugly border, make the picture smaller. it doesn't have to work out to be a
  perfect square, the bottom side can be uneven"). Nothing is cropped and
  nothing is padded: a tile is as tall as its picture makes it, and a row
  ends as unevenly as its pictures do.

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

  The tiles are a MOSAIC, not a carousel: five to a page, squares and wide
  tiles in a fixed pattern for each count (lib/mosaic.ts) that fills every row
  of six columns at the reading width and of two on a phone, edge to edge,
  with the shared pager under it. Every dimension is a token in styles.css;
  the component states no colour, length, radius or duration of its own. -->
<script lang="ts">
  import { tick } from 'svelte';
  import FeedCard from './FeedCard.svelte';
  import Icon from './Icon.svelte';
  import Pager from './Pager.svelte';
  import { browserMedia, spreadMediaQuery, watchMedia } from '../columnWidth';
  import { swipeHorizontal } from '../gesture.ts';
  import { mosaicShapes, shuffled } from '../mosaic.ts';
  import { pageCount, pageRows } from '../stream.ts';
  import type { MediaGalleryItem, MediaGalleryProps } from '../blocks.ts';

  let { items, width, height, pageSize = 5 }: MediaGalleryProps = $props();

  /* THE VISIT'S ORDER (owner, 2026-11-04, issue 405): every item, films and
     drawings together, shuffled ONCE per item list — the bootstrap set as the
     component mounts, and the runtime manifest once, as it lands — because
     this derived reads nothing but `items`, and the host hands a new list
     exactly when the set itself changes (Block.svelte). A page turn, the
     stage, a rotation and a re-render read `order` and never reach the
     shuffle, so the pager, the stage's walk and the tile a closed stage hands
     focus back to all follow the one order. It is computed before the tiles
     of that list are first drawn, and it changes no count, so the reserve and
     the shapes below are the same whatever it draws: zero CLS. */
  const order = $derived(shuffled(items, Math.random));

  /* THE MOSAIC'S PAGE (owner, 2026-11-02, issue 399): a page of tiles at a
     time out of the visit's order. */
  let page = $state(1);
  const pages = $derived(pageCount(order.length, pageSize));
  const at = $derived(Math.min(page, pages));
  const pageTiles = $derived(pageRows(order, at, pageSize));

  /* WHICH GRID THE PAGE IS LAID IN is a question the SCRIPT asks, through the
     media seam the column handles use (lib/columnWidth.ts): the tiles' shapes
     are chosen for six columns or for two, and the grid takes its columns from
     the same answer, so the pattern and the grid it fills can never be read
     from two different widths. Read once for the first paint, then kept
     current for a reader who rotates a phone. */
  let wide = $state(browserMedia(spreadMediaQuery).matches);
  $effect(() => watchMedia(browserMedia, spreadMediaQuery, (matches) => (wide = matches)));
  const columns = $derived(wide ? 6 : 2);
  const shapes = $derived(mosaicShapes(pageTiles.length, columns));

  function itemNoun(candidate: MediaGalleryItem): string {
    return candidate.video === undefined ? 'photograph' : 'film';
  }
  /* THE STAGE pages EVERY item, stills and films alike (issue 384; one set
     since the mosaic, issue 399), in the visit's order (issue 405): a film is
     opened exactly as a picture is, and the next item is the next tile.
     index is assigned in exactly three places — open, next and previous — and
     read clamped, so items shrinking under it (a manifest load) can never
     leave it pointing past the end. */
  let index = $state(0);
  let enlarged = $state(false);
  const total = $derived(order.length);
  const shown = $derived(Math.min(index, Math.max(0, total - 1)));
  const item = $derived(order[shown]);
  let openerEl: HTMLElement | undefined;
  /* WHICH FILM A PRESS ASKED FOR. The press on a film's tile is the reader
     asking to watch it, so the film that press opened starts; paging onto a
     film — the pair, an arrow key, a swipe — asks only to see it, so it
     arrives on its poster and waits. A plain variable rather than state:
     nothing renders from it, it is read once by the stage player as it
     mounts, and every other road onto the stage clears it first. */
  let pressedKey: string | undefined;
  function open(chosen: MediaGalleryItem, from: EventTarget | null): void {
    index = Math.max(0, order.indexOf(chosen));
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
      <div class="gallery-grid" data-gallery-tiles={pageTiles.length} data-columns={columns}>
        {#each pageTiles as tile, place (tile.key)}
          <!-- ONE TILE SHAPE for every item (issue 384): a still and a film
            are the same button over the same lazy preview, so a press on a
            film's picture opens the stage exactly as a press on a still's
            does. A film's tile adds a play mark, centred and hidden from the
            accessibility tree: it says what the tile holds, and the button's
            own name already says so in words.
            The thumb's width and height are the item's declared box — the
            gallery's own where the item states none — and they are what
            gives the tile its proportions before a byte arrives (below). -->
          <button
            type="button"
            class="gallery-tile"
            data-gallery-kind={tile.video ? 'video' : 'image'}
            data-key={tile.key}
            data-shape={shapes[place]}
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
      <Pager page={at} {pages} previousLabel="Earlier pictures" nextLabel="Later pictures" onturn={(next) => (page = next)} />
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
            aria-label={`Previous ${itemNoun(order[(shown - 1 + total) % total])}`}
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
            aria-label={`Next ${itemNoun(order[(shown + 1) % total])}`}
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
  /* THE MOSAIC (owner, 2026-11-02, issue 399): six columns at the reading
     width and two on a phone, and each tile spanning the columns its shape
     names (lib/mosaic.ts), so a page of any count fills every row to the edge
     (owner rule: content short of its container's edge is a defect). The grid
     takes its columns from the same answer the shapes were chosen for — the
     data attribute — never from a media query of its own, so the pattern and
     the grid cannot disagree at any width.

     A ROW IS AS TALL AS ITS TALLEST PICTURE (owner, 2026-11-04, on the
     0.1.104 preview: "it doesn't have to work out to be a perfect square, the
     bottom side can be uneven"). Every tile starts at its row's top, so a
     shorter picture's tile ends above its neighbour's and the wall shows
     under it. The heights are the pictures', and the grid reserves none of
     its own: each tile has its box before a byte arrives (the thumb, below),
     so a lazy thumbnail moves nothing, and what changes the mosaic's height
     is a different set of pictures — a page turn, or the runtime manifest
     replacing the vendored set as it lands — the same class of change as the
     page count moving.

     The rows are max-content rather than auto, which lays them out the same
     here — the grid's height is its rows', so auto has no space to stretch
     a row into — because WebKit keeps an auto row's height when its columns
     change width but not number. MEASURED in WebKit on the vendored set:
     widening the window from 1440px to 1920px left the rows 209 and 316px
     tall under tiles 262 and 394px tall, so the wide tiles overlapped the
     squares by 46px, and narrowing from 1920px to 1280px left 86px between
     the rows. Chromium and Gecko lay both values identically, and
     max-content holds in all three. */
  .gallery-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    grid-auto-rows: max-content;
    gap: var(--gallery-mosaic-gap);
  }
  .gallery-grid[data-columns='2'] {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .gallery-tile[data-shape='sq'] {
    grid-column: span 2;
  }
  .gallery-tile[data-shape='wd'] {
    grid-column: span 3;
  }
  .gallery-tile[data-shape='full'] {
    grid-column: span 6;
  }
  .gallery-grid[data-columns='2'] .gallery-tile[data-shape='sq'] {
    grid-column: span 1;
  }
  .gallery-grid[data-columns='2'] .gallery-tile[data-shape='wd'],
  .gallery-grid[data-columns='2'] .gallery-tile[data-shape='full'] {
    grid-column: span 2;
  }

  /* A tile is its picture at the width its shape spans: stretched across its
     columns, but starting at its row's top rather than stretched down it, so
     it is exactly as tall as its picture and pads and crops nothing. The one
     exception is the touch floor: a picture so wide that its tile would be
     under 44px tall keeps the 44px, with the ground under it. No radius, no
     border, no shadow — the page frame is the sheet's only line. Its ground
     shows only until the picture paints, because the picture is the whole
     tile. */
  .gallery-tile {
    position: relative;
    display: block;
    justify-self: stretch;
    align-self: start;
    min-inline-size: var(--control-target);
    min-block-size: var(--control-target);
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
  /* THE PICTURE, WHOLE (owner, 2026-11-04): the tile's width, and the height
     its own proportions give it, fitted to no box but its own. Its width and
     height attributes are the item's declared box, which the engine maps to
     the box's aspect ratio, so the tile has its final size before the bytes
     land and their arrival moves nothing: zero CLS. */
  .gallery-thumb {
    display: block;
    inline-size: 100%;
    block-size: auto;
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
