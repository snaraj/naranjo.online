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
     content arriving rather than a layout promise being broken.

  MOVING ITEMS (issue 207). An item carrying a `video` bag is a film; every
  other item is exactly the still it was before that field existed. Three
  rules make it safe as well as legible:

  1. THE STRIP NEVER MOUNTS A VIDEO. The single visible frame shows the
     poster's small derivative through the same <img> every photograph uses,
     with a small drawn mark so a reader can tell a film from a photograph
     before opening it. A gallery that mounted eight <video> elements to show
     eight thumbnails is the weight problem the one-frame redesign removed,
     reintroduced in a heavier form.
  2. NOTHING EVER AUTOPLAYS. The element carries `controls`, `playsinline`
     and `preload="none"`, and it carries no `autoplay` attribute anywhere in
     this file — not conditionally, not muted, not "just for the poster".
     That is also how prefers-reduced-motion is honoured STRUCTURALLY rather
     than by a media query: there is no motion to suppress until a reader
     presses play, and a reader pressing play has asked for it. `preload` of
     none additionally means the enlarged frame costs a poster image, not a
     multi-gigabyte transfer, until they do.
  3. SOURCE ORDER IS THE MANIFEST'S. The <source> children render in the
     order they arrive and this component neither sorts nor filters them,
     because the browser takes the first it can decode — a typical ladder is
     a high-efficiency rung ahead of a universal one, and reordering it would
     silently hand a reader different bytes. -->
<script lang="ts">
  import FeedCard from './FeedCard.svelte';
  import { swipeHorizontal } from '../gesture.ts';
  import { isChord, ringTarget } from '../keys.ts';
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

  /* An item's own intrinsic box when it declared one, the gallery's otherwise.
     This is the element's size HINT; the reserved frame comes from the
     --card-media-* tokens and is the same box for every item, which is why
     swapping one set of items for another shifts no layout. */
  const itemWidth = $derived(item.width ?? width);
  const itemHeight = $derived(item.height ?? height);

  function next(): void {
    index = (index + 1) % total;
  }

  function previous(): void {
    index = (index - 1 + total) % total;
  }

  /* THE SWIPE (issue 219). The owner's report was "I can't swipe/motion
     through the image", and it was exactly right: this gallery shows one
     photograph and offered only two arrow buttons to move between them, which
     on a phone is the least reachable control on the card.

     Three constraints shape what is below, and all three are contract rather
     than taste. Requirement 1 forbids a gesture library, so the arithmetic is
     lib/gesture.ts and hand-rolled on Pointer Events. Vertical scrolling is
     never stolen: the stage declares `touch-action: pan-y`, the binding claims
     nothing until a drag has proven itself horizontal, and a `pointercancel`
     from the browser ends the gesture rather than contesting it. And every
     gesture owes a non-gesture equivalent, so the arrows stay, the dots below
     are real buttons, and arrow keys drive the frame — the swipe is an
     ADDITION to the ways through this gallery, never the only one. */
  let dragX = $state(0);
  let settling = $state(false);
  let stageEl: HTMLDivElement | undefined = $state();

  const swipe = {
    span: () => stageEl?.getBoundingClientRect().width ?? 0,
    move: (offset: number) => (dragX = offset),
    commit: (direction: -1 | 1) => (direction === 1 ? next() : previous()),
    /* The transition is switched ON only for the settle, so the DRAG itself
       tracks the finger with no easing between it and the pixels — a
       transition during a drag is the lag that makes a carousel feel broken.
       It is switched off again after the settle so the next drag is direct.
       A reduced-motion reader gets no transition at all (the stylesheet
       decides that, not this file), and because the offset still lands on
       zero either way the surface is never left displaced. */
    settle: () => {
      settling = true;
      /* Long enough to cover the token duration below, and harmless if it
         fires late: it only clears a flag that the next pointerdown would
         otherwise leave set. */
      setTimeout(() => (settling = false), 240);
    },
    /* The gallery WRAPS — the counter reads "1 / 8" and pressing previous at
       the first photograph goes to the last — so there is no end to resist
       at, and pretending otherwise would make the wrap feel like a fault. */
    atStart: () => false,
    atEnd: () => false
  };

  /* Arrow keys on the frame itself, so the gesture's keyboard equivalent is
     on the same control rather than only inside the lightbox. */
  function onFrameKeydown(event: KeyboardEvent): void {
    if (isChord(event)) {
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      next();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      previous();
    }
  }

  /* THE POSITION DOTS' KEYBOARD, and why it is a radiogroup (issue 219 review
     round 2). What shipped was a `tablist` of `tab`s with a roving tabindex
     and no keydown handler at all — the exact shape this same PR fixed in the
     token panel's segmented pills, reintroduced eight files away. MEASURED:
     tabindex ["0","-1","-1","-1","-1","-1","-1","-1"], and ArrowRight,
     ArrowDown, End and Home on the one tabbable dot all left the counter at
     `1 / 8`, whose own click handler is `index = at` where `at === index` — a
     no-op. Seven of eight dots were unreachable by keyboard and the eighth
     did nothing. A roving tabindex is HALF a composite widget; the arrows are
     the other half, and shipping one without the other is worse than shipping
     neither, because it removes seven tab stops in exchange for nothing.

     The role changed with it. `tablist`/`tab` promises tab panels, and these
     dots control none — there is no `aria-controls`, no `tabpanel`, and no
     second region to swap. What they actually are is a single choice from a
     set, announced as such: a `radiogroup`, exactly the pattern the token
     panel's pills already use, so the two composite widgets on this page are
     one pattern rather than two. The movement itself is lib/keys.ts's ring,
     shared with those pills and with the reading-mode swatches. */
  let dotsEl: HTMLDivElement | undefined = $state();

  function onDotsKeydown(event: KeyboardEvent): void {
    if (isChord(event)) {
      return;
    }
    const target = ringTarget(event.key, index, total);
    if (target === null) {
      return;
    }
    /* The arrows belong to the group once focus is inside it, so the page
       must not scroll underneath the reader as well. */
    event.preventDefault();
    index = target;
    /* Focus follows selection: in a radio group the checked control IS the
       tab stop, so leaving focus behind would strand it on a dot that just
       became untabbable. */
    dotsEl?.querySelectorAll<HTMLElement>('[role="radio"]')[target]?.focus();
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
        <!-- The gesture surface is the STAGE, not the button inside it: the
          drag has to be available across the whole photograph, and the button
          is the thing the drag must not accidentally press (lib/gesture.ts
          suppresses exactly one click after a real drag). aria-hidden is
          wrong here and deliberately absent — the stage carries no semantics
          of its own, and everything a reader needs is already on the button,
          the arrows and the dots. -->
        <div
          class="gallery-stage"
          bind:this={stageEl}
          use:swipeHorizontal={swipe}
          data-gallery-settling={settling ? 'true' : undefined}
          style:--gallery-drag={`${dragX}px`}
        >
          <button
            type="button"
            class="gallery-image-button"
            bind:this={frameButtonEl}
            onkeydown={onFrameKeydown}
            onclick={() => (enlarged = true)}
          >
            <img
              class="gallery-image"
              src={item.previewSrc}
              alt={item.alt}
              width={itemWidth}
              height={itemHeight}
              loading="lazy"
              decoding="async"
            />
            {#if item.video}
              <!-- Signposting, not a control: the whole frame already opens the
                lightbox, so this mark is aria-hidden and the item's alt text is
                what a screen reader is told. It is drawn rather than an
                overlaid glyph font, and it is absolutely positioned so adding
                it moves nothing in the reserved box. -->
              <span class="gallery-play-mark" aria-hidden="true">
                <svg class="gallery-glyph" viewBox="0 0 24 24" width="16" height="16">
                  <path d="M9 7.5l8 4.5-8 4.5z" fill="currentColor" />
                </svg>
              </span>
            {/if}
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
  <!-- The position affordance the swipe owes (issue 219). A counter alone
    tells a reader WHERE they are; it does not tell them the surface can be
    moved, and it cannot be pressed. The dots say both — how many, which one,
    and that the set is navigable — and each is a real button, so the gesture's
    keyboard-and-tap equivalent is the same control that shows the position
    rather than a second one somewhere else. The counter stays beside them
    because a dot row stops being countable past a handful, and it keeps the
    live region: a number is what assistive technology can usefully announce
    on a change, and eight identical dots are not.
    "Reachable by keyboard" is a claim with a shape: one tab stop for the
    group, the arrows moving inside it, Home and End at the ends, and focus
    following the choice — see onDotsKeydown. A roving tabindex without that
    is not a keyboard affordance, it is seven controls taken away. -->
  <div class="gallery-position">
    <p class="gallery-count" aria-live="polite">{index + 1} / {total}</p>
    {#if total > 1}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="gallery-dots"
        role="radiogroup"
        tabindex="-1"
        aria-label="Choose a photograph"
        bind:this={dotsEl}
        onkeydown={onDotsKeydown}
      >
        {#each items as dot, at (dot.previewSrc)}
          <button
            type="button"
            class="gallery-dot"
            role="radio"
            aria-checked={at === index}
            tabindex={at === index ? 0 : -1}
            aria-label={`Photograph ${at + 1} of ${total}`}
            onclick={() => (index = at)}
          ><span class="gallery-dot-mark" aria-hidden="true"></span></button>
        {/each}
      </div>
    {/if}
  </div>

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
        {#if item.video}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video
            class="gallery-lightbox-image"
            controls
            playsinline
            preload="none"
            poster={item.video.posterSrc}
            aria-label={item.alt}
            width={itemWidth}
            height={itemHeight}
          >
            {#each item.video.sources as source (source.src)}
              <source src={source.src} type={source.type} />
            {/each}
          </video>
        {:else}
          <img class="gallery-lightbox-image" src={item.fullSrc} alt={item.alt} />
        {/if}
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
    /* Absolute, filling the stage. Issue 207 wanted a containing block here
       for the moving-item mark below and added `position: relative`; composing
       that with issue 202's centred stage left the property declared TWICE
       with `relative` last, which took the button out of its absolute fill and
       let a <button>'s fit-content sizing decide the frame's width again —
       measured off centre by 569px in Firefox and WebKit at 1440px, the exact
       dead gutter issue 202 removed. One declaration, and it is `absolute`:
       an absolutely positioned box is already a containing block for
       absolutely positioned descendants, so the mark needs nothing further. */
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

  /* The moving-item mark (issue 207). Absolutely positioned inside the
     already-reserved frame, so a film's frame is exactly a photograph's
     frame and adding the mark moves nothing. It is the only difference the
     strip draws between the two kinds; everything else about a film's
     thumbnail IS a photograph. */
  .gallery-play-mark {
    position: absolute;
    inset-block-end: var(--gallery-play-inset, 0.5rem);
    inset-inline-end: var(--gallery-play-inset, 0.5rem);
    display: grid;
    place-items: center;
    inline-size: var(--gallery-play-size, 1.75rem);
    block-size: var(--gallery-play-size, 1.75rem);
    border-radius: 999px;
    background: var(--gallery-play-surface, rgba(0, 0, 0, 0.55));
    color: var(--gallery-play-ink, white);
  }


  .gallery-position {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.125rem;
  }

  .gallery-count {
    margin: 0.375rem 0 0;
    text-align: center;
    font-size: var(--card-meta-size);
    font-variant-numeric: tabular-nums;
    color: var(--card-meta-ink);
  }

  .gallery-dots {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
  }

  /* A 44px hit box around a small painted mark, exactly as the lightbox's
     close control is built (issue 202): the touch floor is about what a
     finger can hit, never about how big the ink is, and a row of 44px discs
     would be a bigger object than the photograph's own caption. The mark is
     drawn by the child span so the button can be transparent chrome. */
  .gallery-dot {
    display: grid;
    place-items: center;
    /* 44px on BOTH axes, not just the block one. The inline floor is not
       belt-and-braces here and the token panel learned it the hard way
       (UsageTracker.svelte): a floor that depends on how wide the content
       happens to be is not a floor, and a dot's content is 6px. The row
       wraps, so eight of them still fit a 320px viewport without taking the
       page's scrollbar sideways. */
    min-inline-size: 2.75rem;
    min-block-size: 2.75rem;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }

  .gallery-dot-mark {
    inline-size: 0.375rem;
    block-size: 0.375rem;
    border-radius: 999px;
    background: var(--card-meta-ink);
    opacity: 0.35;
  }

  /* Position is never carried by the fill alone: the current dot is both
     brighter AND larger, so the state survives a reading mode that flattens
     contrast and a reader who cannot separate the two tones. */
  .gallery-dot[aria-checked='true'] .gallery-dot-mark {
    opacity: 1;
    transform: scale(1.5);
  }

  .gallery-dot:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -6px;
    border-radius: 999px;
  }

  /* THE DRAG SURFACE. `pan-y` is the load-bearing declaration on this whole
     feature: it hands the vertical axis to the compositor unconditionally, so
     a reader scrolling the page through the photograph scrolls the page — the
     gesture layer never even sees that gesture. Only the horizontal axis is
     ours to claim, and lib/gesture.ts still refuses to claim it until a drag
     has proven itself horizontal. */
  .gallery-stage {
    touch-action: pan-y;
  }

  /* The drag itself: a plain translate, so it is composited rather than
     re-laid-out, and it changes no box — the reserved frame is exactly where
     it was, which is what keeps a drag from costing layout stability. The
     fallback is the un-transformed frame, which is the correct degradation:
     no movement rather than a broken one. */
  .gallery-stage :global(.gallery-image-button) {
    transform: translateX(var(--gallery-drag, 0px));
  }

  /* THE SNAP-BACK, and it is only ever on for the settle. A transition during
     the drag would put easing between the finger and the pixels; a settle
     with no transition would teleport. The attribute is written by the
     component for the length of the settle alone.

     Stated inside `no-preference` rather than cancelled inside `reduce`, per
     this page's rule: a cancelling block is reachable only by a browser that
     HAS the media feature, so it leaves the animation running everywhere the
     feature is unknown, while stating it here never starts it there. Nothing
     is lost for a reader who gets no transition — the offset lands on zero
     either way, so the surface is never left displaced; only the journey to
     zero is skipped. */
  @media (prefers-reduced-motion: no-preference) {
    .gallery-stage[data-gallery-settling='true'] :global(.gallery-image-button) {
      transition: transform var(--gallery-settle-duration, 200ms) cubic-bezier(0.22, 1, 0.36, 1);
    }
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

  /* The enlarged element carries its intrinsic box as attributes so the
     frame has a shape before a poster or a frame decodes. Auto sizing is what
     lets the caps above take over from those attributes instead of fighting
     them, and it keeps the aspect ratio intact on the way down. */
  .gallery-lightbox-image {
    inline-size: auto;
    block-size: auto;
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
     control on the page does — and it obeys the page's link doctrine
     (issue 203): no resting underline, and a visible mark on hover or
     keyboard focus so a link with no underline is still announced. */
  .gallery-meta-link {
    display: inline-flex;
    align-items: center;
    min-block-size: 2.75rem;
    padding-inline: var(--gallery-meta-link-padding, 0.5rem);
    color: inherit;
    text-decoration: none;
  }

  .gallery-meta-link:hover,
  .gallery-meta-link:focus-visible {
    text-decoration: underline;
  }
</style>
