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
  patterned border is a token edit there, never code here. -->
<script lang="ts">
  import FeedCard from './FeedCard.svelte';
  import type { MediaGalleryProps } from '../blocks.ts';

  let { items, width, height }: MediaGalleryProps = $props();

  const total = $derived(items.length);

  let index = $state(0);
  let enlarged = $state(false);

  const item = $derived(items[index]);

  function next(): void {
    index = (index + 1) % total;
  }

  function previous(): void {
    index = (index - 1 + total) % total;
  }

  let dialogEl: HTMLDialogElement | undefined = $state();

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
        <button type="button" class="gallery-image-button" onclick={() => (enlarged = true)}>
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

  <dialog
    bind:this={dialogEl}
    class="gallery-lightbox"
    aria-label={item.alt}
    onclose={onDialogClose}
    onkeydown={onDialogKeydown}
    onclick={onBackdropClick}
  >
    {#if enlarged}
      <div class="gallery-lightbox-border">
        <img class="gallery-lightbox-image" src={item.fullSrc} alt={item.alt} />
      </div>
    {/if}
    <button
      type="button"
      class="icon-button gallery-lightbox-close"
      onclick={() => dialogEl?.close()}
      aria-label="Close enlarged photograph"
    >
      <svg class="gallery-glyph" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </button>
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

  .gallery-image-button {
    display: grid;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
    /* The reserved box, and the reason nothing on this page moves when the
       photograph lands: the same ratio and the same ceiling every media
       card on the page shares. */
    aspect-ratio: var(--card-media-aspect);
    max-block-size: var(--card-media-max-block-size);
    overflow: hidden;
    border-radius: var(--card-radius);
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
    padding: 0;
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

  .gallery-lightbox-close {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    background: var(--gallery-close-surface, rgba(0, 0, 0, 0.5));
    border-radius: 999px;
    color: var(--gallery-close-ink, white);
  }
</style>
