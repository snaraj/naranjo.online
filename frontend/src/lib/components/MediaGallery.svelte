<!-- MediaGallery renders one photograph at a time from a vendored set (owner
  UX directive, issue 176): a single visible frame, icon-only prev/next
  controls, and a click-to-enlarge native <dialog> lightbox showing the
  full-resolution derivative. It is a generic primitive with NO domain
  knowledge — every item's preview/full URL and alt text arrive through
  MediaGalleryProps (lib/blocks.ts), built by an adapter in the binding
  layer; this component knows no digest, no file name and no vendoring
  decision of its own.

  It used to render a FEED of every picture stacked full-resolution (issue
  134) — eight frames a reader had to scroll past to see any one of them.
  Issue 176 replaced that with exactly one visible frame at a time: the
  shared FeedCard primitive in its media-led variant still supplies the
  chrome (issue 136's one-card doctrine), but only the current item's small
  preview mounts inside it. Clicking the photograph opens a native <dialog>
  — free focus trap, Escape-to-close and backdrop, per lib/disclosure.ts's
  choice for the theme popover — showing the full-resolution derivative,
  which loads for the first time only then. Arrow keys navigate the
  lightbox; its own close button and a genuine backdrop click also close
  it.

  The frame is reserved before any byte arrives — same box, same ratio,
  same place — through the shared --card-media-* tokens every media card on
  the page uses, so nothing here computes a shape of its own.

  The enlarged frame's border is TOKENS ONLY — see the --gallery-frame-*
  block in styles.css; border-image's initial value is 'none', so a future
  patterned border is a token edit there, never code here.

  ISSUE 202 — three owner findings from a live review, all answered here:

  1. CENTRED FRAME. The visible frame is narrower than the 1fr track it sits
     in on any column wider than 35.5rem, and `justify-self: normal` behaves
     as START rather than stretch for a box with an aspect ratio, so the
     whole surplus used to land on one side — MEASURED at 1280px: a 568.9px
     frame at the left of an 842px track, 273px of dead space on the right
     alone. A .gallery-stage wrapper now carries a DEFINITE width built from
     the same two tokens the reserved box is, and centres itself with auto
     margins. It is a wrapper rather than an alignment property on the button
     because an aligned grid item is sized by its CONTENT — with the lazy
     image blocked, `justify-self: center` alone reserved 0x0 on Gecko,
     194.6x109.4 on Blink and 163x91.7 on WebKit, which would have traded the
     owner's dead gutter for a broken zero-CLS floor.
  2. A CLOSE MARK THAT DOES NOT SIT ON THE ARTWORK. The close control used
     to be a 44px filled disc stamped over the photograph's top-right
     corner. It is now a small mark in a reserved lane ABOVE the frame: the
     44px touch target survives as an INVISIBLE hit box (rendering lanes
     stage 1), aligned so the painted mark tucks into the lane and never
     overlaps the picture. Placing it outside the dialog was measured and
     rejected: a native <dialog> is width:fit-content with UA overflow:auto,
     and pushing the control past its box turned the dialog scrollable
     (scrollWidth 1194 against clientWidth 1154 at a 1280px viewport).
  3. OPTIONAL PER-ITEM METADATA. title, description and link are each
     independently optional, and ABSENT RENDERS NOTHING — no empty row, no
     dash, no reserved band. Nothing here supplies a default, because a
     default is how an honest empty state becomes a fabricated one. The
     caption sits AFTER the counter, the last thing in the block, so an item
     that carries one moves neither the photograph, the arrows nor the
     counter; the deliberate trade (owner's own instruction: reserve space
     only when the specific item has something to show) is that content
     BELOW the gallery reflows when a captioned item comes round, which is
     content arriving rather than a layout promise being broken. -->
<script lang="ts">
  import FeedCard from './FeedCard.svelte';
  import type { MediaGalleryProps } from '../blocks.ts';

  let { items, width, height }: MediaGalleryProps = $props();

  const total = $derived(items.length);

  let index = $state(0);
  let enlarged = $state(false);

  const item = $derived(items[index]);

  /* Truthiness, not `!== undefined`: an empty string is as absent as a
     missing field for a reader, and rendering an empty row for one is the
     "no blank fields" failure this exists to prevent. */
  const hasCaption = $derived(Boolean(item.title) || Boolean(item.description));
  const hasMeta = $derived(hasCaption || item.link !== undefined);

  function next(): void {
    index = (index + 1) % total;
  }

  function previous(): void {
    index = (index - 1 + total) % total;
  }

  let dialogEl: HTMLDialogElement | undefined = $state();

  /* The control that opens the lightbox, kept so closing can put focus back
     on it. A native <dialog> does restore focus to whatever was focused
     before showModal(), but a mouse click does not focus a <button> on
     macOS WebKit at all — so on the engine every iOS browser runs, the
     "previously focused element" is the document body and a reader who
     closes the lightbox lands nowhere. Restoring explicitly is the same
     element in every engine. */
  let frameButtonEl: HTMLButtonElement | undefined = $state();

  // showModal()/close() are imperative; this is the one place the dialog's
  // own open state is kept in step with `enlarged`.
  $effect(() => {
    if (dialogEl === undefined) return;
    if (enlarged && !dialogEl.open) dialogEl.showModal();
    else if (!enlarged && dialogEl.open) dialogEl.close();
  });

  // The dialog's native 'close' event covers Escape, the close button and a
  // backdrop click alike, so this is the single place `enlarged` resets.
  function onDialogClose(): void {
    enlarged = false;
    frameButtonEl?.focus();
  }

  function onDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight') next();
    else if (event.key === 'ArrowLeft') previous();
  }

  // A click landing on the <dialog> element itself (never on its content)
  // is a backdrop click.
  function onBackdropClick(event: MouseEvent): void {
    if (event.target === dialogEl) dialogEl?.close();
  }
</script>

{#if total > 0}
  <FeedCard variant="media">
    {#snippet media()}
      <div class="gallery-frame">
        <button type="button" class="icon-button" onclick={previous} aria-label="Previous photograph">
          <svg class="gallery-glyph" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M14.5 6l-6 6 6 6"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <div class="gallery-stage">
          <button
            type="button"
            class="gallery-image-button"
            bind:this={frameButtonEl}
            onclick={() => (enlarged = true)}
          >
            <img
              class="gallery-image"
              src={item.previewSrc}
              alt={item.alt}
              {width}
              {height}
              loading="lazy"
              decoding="async"
            />
          </button>
        </div>
        <button type="button" class="icon-button" onclick={next} aria-label="Next photograph">
          <svg class="gallery-glyph" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M9.5 6l6 6-6 6"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
    {/snippet}
  </FeedCard>
  <p class="gallery-count" aria-live="polite">{index + 1} / {total}</p>

  {#if hasCaption}
    <div class="gallery-caption">
      {#if item.title}<p class="gallery-caption-title">{item.title}</p>{/if}
      {#if item.description}<p class="gallery-caption-text">{item.description}</p>{/if}
    </div>
  {/if}

  <dialog
    bind:this={dialogEl}
    class="gallery-lightbox"
    aria-label={item.alt}
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
    {#if enlarged}
      <div class="gallery-lightbox-border">
        <img class="gallery-lightbox-image" src={item.fullSrc} alt={item.alt} />
      </div>
      {#if hasMeta}
        <div class="gallery-lightbox-meta">
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
        </div>
      {/if}
    {/if}
  </dialog>
{/if}

<style>
  .gallery-frame {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--card-meta-gap);
  }

  .gallery-glyph {
    color: inherit;
  }

  /* Issue 202, the owner's "large dead gap on the right". The frame is
     narrower than its 1fr track on any wide column, because the block cap
     below transfers through aspect-ratio into an inline cap; `justify-self:
     normal` behaves as START (not stretch) for a box with an aspect ratio,
     so the whole surplus used to land on one side — MEASURED at 1280px: a
     568.9px frame at the left of an 842px track.

     The stage is what fixes it, and it is a wrapper rather than an alignment
     property on the button for a reason MEASURED on all three engines: an
     aligned (non-stretched) grid item is sized by its CONTENT, and the
     content here is a lazy image, so `justify-self: center` alone reserved
     nothing until the byte landed — 0x0 on Gecko, 194.6x109.4 on Blink,
     163x91.7 on WebKit with the image blocked. Giving the stage a DEFINITE
     width instead keeps the reservation byte-independent and centres it with
     auto margins, and the width is built from the same two tokens the
     reserved box itself is built from, so the two cannot disagree. */
  .gallery-stage {
    position: relative;
    inline-size: min(100%, calc(var(--card-media-max-block-size) * (var(--card-media-aspect))));
    margin-inline: auto;
    /* The reserved box, and the reason nothing on this page moves when the
       photograph lands: the same ratio and the same ceiling every media
       card on the page shares. It sits on the STAGE and not on the button
       because a <button> is a form control — its `auto` inline size is
       fit-content in every engine, so a button carrying the ratio is sized
       by whatever has loaded inside it, which is the opposite of a
       reservation. The stage's width is definite; the button stretches into
       it as an ordinary grid item. */
    aspect-ratio: var(--card-media-aspect);
    max-block-size: var(--card-media-max-block-size);
    overflow: hidden;
    border-radius: var(--card-radius);
  }

  /* Filling the stage by INSETS, not by a size: a size on a control is a
     number the touch-floor sweep must be able to read, and "100%" is not one.
     The insets say the same thing without stating a length at all, and they
     mean the button is exactly the reserved box in every engine (WebKit
     stretched a grid item here to a square, MEASURED, so grid stretch was
     not enough). */
  .gallery-image-button {
    position: absolute;
    inset: 0;
    display: grid;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
  }

  .gallery-image {
    inline-size: 100%;
    block-size: 100%;
    object-fit: var(--card-media-fit);
  }

  .gallery-count {
    margin: 0.375rem 0 0;
    text-align: center;
    font-size: var(--card-meta-size);
    font-variant-numeric: tabular-nums;
    color: var(--card-meta-ink);
  }

  .gallery-lightbox {
    position: relative;
    max-inline-size: var(--gallery-lightbox-max-inline, min(94vw, 90rem));
    /* The close mark's lane, reserved above the frame so the mark has
       somewhere to live that is NOT the photograph (issue 202). Only the
       block-start side is padded; the dialog is otherwise flush. */
    padding: var(--gallery-close-lane, 1.5rem) 0 0;
    border: none;
    background: none;
  }

  .gallery-lightbox::backdrop {
    background: var(--gallery-scrim, rgba(0, 0, 0, 0.7));
  }

  /* The frame border, entirely token-driven (issue 176): nothing here
     states a width, color or image of its own -- see styles.css. */
  .gallery-lightbox-border {
    display: grid;
    padding: var(--gallery-frame-padding);
    background: var(--gallery-frame-color);
    border: var(--gallery-frame-width) solid var(--gallery-frame-color);
    border-image: var(--gallery-frame-image);
    border-radius: var(--gallery-frame-radius);
  }

  .gallery-lightbox-image {
    display: block;
    max-inline-size: 90vw;
    /* The static viewport unit is never used here (issue #26): the base is a
       fixed cap, generous enough that a browser without svh still shows a
       whole photograph, and the dynamic unit is a pure upgrade on top of it. */
    max-block-size: var(--gallery-image-max-block, 40rem);
    border-radius: calc(var(--gallery-frame-radius) - var(--gallery-frame-width));
  }

  @supports (max-block-size: 1svh) {
    .gallery-lightbox-image {
      /* Not tokenized, unlike the fixed cap above: a custom property accepts
         any value unconditionally, so an svh DEFAULT would sit outside this
         guard while looking textually identical to an unguarded progressive
         value — see the note beside --gallery-image-max-block in
         styles.css. */
      max-block-size: 80svh;
    }
  }

  /* The close control is a 44px touch target that paints NOTHING of its own
     (issue 202): the hit box keeps the rendering-lanes stage-1 floor while
     the only visible thing is the small mark below, aligned to the lane's
     top-right so it sits above the photograph rather than on it. */
  .gallery-lightbox-close {
    position: absolute;
    inset-block-start: 0;
    inset-inline-end: 0;
    place-items: start end;
    background: none;
    color: var(--gallery-close-ink, white);
  }

  /* What the reader actually sees: 1.125rem against the 2.75rem disc this
     replaced — 59% narrower, and past the owner's "at least 50% smaller".
     It rests translucent and comes to full strength on hover or keyboard
     focus, so it is unobtrusive without ever being invisible. */
  .gallery-close-mark {
    display: grid;
    place-items: center;
    inline-size: var(--gallery-close-size, 1.125rem);
    block-size: var(--gallery-close-size, 1.125rem);
    border-radius: 999px;
    background: var(--gallery-close-surface, rgba(0, 0, 0, 0.5));
    opacity: var(--gallery-close-rest-opacity, 0.55);
  }

  .gallery-lightbox-close:hover .gallery-close-mark,
  .gallery-lightbox-close:focus-visible .gallery-close-mark {
    opacity: 1;
  }

  /* Optional metadata, both surfaces (issue 202). Neither container exists
     when its item has nothing to put in it, so an item without metadata
     reserves no band and leaves no empty row — the absent state is the
     absence of the element, not an element rendering blank. */
  .gallery-caption {
    display: grid;
    gap: var(--gallery-caption-gap, 0.125rem);
    margin-block-start: var(--gallery-caption-space, 0.25rem);
    text-align: center;
    font-size: var(--card-meta-size);
    line-height: var(--card-meta-leading);
    color: var(--card-meta-ink);
  }

  .gallery-caption-title,
  .gallery-caption-text,
  .gallery-meta-title,
  .gallery-meta-text {
    margin: 0;
  }

  .gallery-caption-title,
  .gallery-meta-title {
    font-weight: var(--card-title-weight);
  }

  .gallery-caption-title {
    color: var(--card-title-ink);
  }

  /* The lightbox metadata sits on the scrim, which is the same near-black in
     every reading mode (see the --gallery-scrim note in styles.css), so its
     ink does not branch by mode either. */
  .gallery-lightbox-meta {
    display: grid;
    justify-items: center;
    gap: var(--gallery-meta-gap, 0.125rem);
    margin-block-start: var(--gallery-meta-space, 0.5rem);
    text-align: center;
    font-size: var(--card-meta-size);
    line-height: var(--card-meta-leading);
    color: var(--gallery-meta-ink, white);
  }

  /* A link is a control, so it carries the same 44px target every other
     control on the page does. */
  .gallery-meta-link {
    display: inline-flex;
    align-items: center;
    min-block-size: 2.75rem;
    padding-inline: var(--gallery-meta-link-padding, 0.5rem);
    color: inherit;
  }
</style>
