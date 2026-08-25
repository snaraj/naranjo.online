<script lang="ts">
  import { tick } from 'svelte';
  import {
    createDisclosure,
    dismiss,
    focusLeft,
    outsidePress,
    pressBegan,
    swatchKeyTarget,
    triggerClick,
    triggerPointerDown
  } from './disclosure';
  import { applyMode, documentMode, modes, type ModeId } from './themes';

  // The origin stamps the chosen mode on <html> before any script runs, so
  // the initial state reads the document itself — never a second source of
  // truth that could disagree with what the visitor already sees. An
  // unstamped document reads as auto, which is the state every visitor
  // starts in.
  let selected = $state<ModeId>(documentMode());
  // Every open/close decision lives in the extracted disclosure state
  // machine (see disclosure.ts for the engine-order rationale); this
  // component only renders it and moves focus.
  const disclosure = $state(createDisclosure());
  let root = $state<HTMLDivElement>();
  let trigger = $state<HTMLButtonElement>();
  let popover = $state<HTMLDivElement>();

  function swatches(): HTMLButtonElement[] {
    return Array.from(popover?.querySelectorAll('button') ?? []);
  }

  function onTriggerPointerdown(): void {
    triggerPointerDown(disclosure);
  }

  // A press beginning on a swatch arms the focusout suppression that keeps
  // the popover visible until the swatch's click lands (WebKit fires the
  // widget's focusout mid-press because buttons never take focus there).
  function onSwatchPointerdown(): void {
    pressBegan(disclosure);
  }

  // Any press outside the widget dismisses — independent of focus, which may
  // already sit on the page after a suppressed focusout or abandoned press.
  function onWindowPointerdown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Node && (root?.contains(target) ?? false))) {
      outsidePress(disclosure);
    }
  }

  async function onTriggerClick(): Promise<void> {
    if (triggerClick(disclosure) !== 'opened') {
      return;
    }
    // Move focus into the popover on the current choice (or the first swatch
    // when nothing is chosen yet) so keyboard and switch users land inside.
    await tick();
    const buttons = swatches();
    (buttons.find((button) => button.getAttribute('aria-pressed') === 'true') ?? buttons[0])?.focus();
  }

  function choose(id: ModeId): void {
    selected = id;
    applyMode(id);
    if (dismiss(disclosure)) {
      trigger?.focus();
    }
  }

  // Focus leaving the whole widget (tab-out, or a click that moves focus
  // elsewhere) dismisses the popover without stealing focus back.
  function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    focusLeft(disclosure, next instanceof Node && (root?.contains(next) ?? false));
  }

  function onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && dismiss(disclosure)) {
      event.preventDefault();
      trigger?.focus();
    }
  }

  function onSwatchKeydown(event: KeyboardEvent): void {
    const buttons = swatches();
    const target = swatchKeyTarget(
      event.key,
      buttons.indexOf(event.currentTarget as HTMLButtonElement),
      buttons.length
    );
    if (target === null) {
      return;
    }
    event.preventDefault();
    if (target === 'dismiss') {
      if (dismiss(disclosure)) {
        trigger?.focus();
      }
      return;
    }
    buttons[target]?.focus();
  }
</script>

<!-- The wiki's toggle, minimally: a compact moon icon opening a popover of
     one swatch per choice.

     The swatches are LINE ICONS, like the two header controls they sit under
     (owner directive, 2026-08-24): the same painted box
     (--chrome-icon-glyph-size), the same line weight (--chrome-icon-stroke),
     no disc, no border, no fill, and the same brand-ink hover.

     Redesigned again (owner UX directive, issue 180, 2026-08-25): "these
     icons do not tell me at all what the modes are, they all look exactly
     the same" — the three dark variants used to be one moon shape told apart
     only by their craters' TEMPERATURE (a color difference too small to read
     at 18px). Every glyph now draws a genuinely different SILHOUETTE — sun,
     half-sun/half-moon, plain crescent, crescent-with-stars, split disc — so
     the five are tellable apart by SHAPE alone, which is also the dataviz
     floor applied to the toggle itself (a value is never encoded by color
     alone). Every path paints `currentColor`: the glyph is the SAME ink the
     swatch already answers hover and selection with, so no mode needs its
     own palette rule and there is zero theme branching to keep in step.

     Native buttons only; the glyphs are inline SVG. Plain
     aria-expanded disclosure semantics on purpose: aria-haspopup would
     announce a menu, but the popover is a group of pressed-state buttons
     (review F4).

     The widget sits in the page header's flow and takes its position from
     there. It used to be fixed chrome offset by the side rail's gutter, which
     meant the control slid sideways every time a panel opened — a control
     that moves when the visitor touches something else reads as broken. Only
     the popover is layered, because it overlaps the panel stack below it. -->
<svelte:window onpointerdown={onWindowPointerdown} />

<div class="theme-menu" bind:this={root} onfocusout={onFocusOut}>
  <button
    type="button"
    class="icon-button trigger"
    aria-label="Reading mode"
    aria-expanded={disclosure.open}
    aria-controls="reading-mode-menu"
    bind:this={trigger}
    onpointerdown={onTriggerPointerdown}
    onclick={onTriggerClick}
    onkeydown={onTriggerKeydown}
  >
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" fill="currentColor" />
    </svg>
  </button>

  <div
    class="popover"
    id="reading-mode-menu"
    role="group"
    aria-label="Reading mode"
    hidden={!disclosure.open}
    bind:this={popover}
  >
    {#each modes as mode (mode.id)}
      <button
        type="button"
        class="swatch swatch-{mode.id}"
        aria-label={mode.label}
        aria-pressed={selected === mode.id}
        onpointerdown={onSwatchPointerdown}
        onclick={() => choose(mode.id)}
        onkeydown={onSwatchKeydown}
      >
        {#if mode.id === 'auto'}
          <!-- Half sun, half moon: the device's own choice previewed as the
            one glyph that is genuinely neither light's sun nor dark's
            crescent — a filled left half (the dark side) inside an open ring
            wearing three rays on its right edge (the light side). -->
          <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
            <path class="chip" d="M12 3a9 9 0 0 0 0 18Z" />
            <circle class="chip-edge" cx="12" cy="12" r="9" />
            <g class="ray">
              <line x1="19.8" y1="12" x2="22.1" y2="12" />
              <line x1="17.51" y1="17.51" x2="19.14" y2="19.14" />
              <line x1="17.51" y1="6.49" x2="19.14" y2="4.86" />
            </g>
          </svg>
        {:else if mode.id === 'light'}
          <!-- The sun: a filled disc with eight rays, all one ink. -->
          <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
            <g class="ray">
              <line x1="12" y1="1.9" x2="12" y2="4.2" />
              <line x1="12" y1="19.8" x2="12" y2="22.1" />
              <line x1="1.9" y1="12" x2="4.2" y2="12" />
              <line x1="19.8" y1="12" x2="22.1" y2="12" />
              <line x1="4.86" y1="4.86" x2="6.49" y2="6.49" />
              <line x1="17.51" y1="17.51" x2="19.14" y2="19.14" />
              <line x1="17.51" y1="6.49" x2="19.14" y2="4.86" />
              <line x1="4.86" y1="19.14" x2="6.49" y2="17.51" />
            </g>
            <circle class="chip" cx="12" cy="12" r="5" />
          </svg>
        {:else if mode.id === 'dark'}
          <!-- The true dark: a plain crescent, unadorned — the simplest of
            the three night modes, so the other two read as ADDING something
            to it rather than all three competing on crater color. -->
          <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
            <path class="chip" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
          </svg>
        {:else if mode.id === 'slate'}
          <!-- Slate: the same crescent plus two small marks beside it — a
            night sky rather than a bare moon, which is the "stars-midnight"
            silhouette issue 180 asks for. -->
          <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
            <path class="chip" d="M20 15.5A7.5 7.5 0 1 1 12.9 5.3 6 6 0 0 0 20 15.5Z" />
            <path class="chip" d="M5 4.2l0.55 1.3L6.85 6l-1.3 0.55L5 7.85l-0.55-1.3L3.15 6l1.3-0.55Z" />
            <circle class="chip" cx="4.5" cy="16" r="0.85" />
          </svg>
        {:else}
          <!-- Sepia: a "contrast disc" rather than a moon at all — a ring
            with one half filled, split on the HORIZONTAL where every other
            glyph here splits on the vertical or draws no split at all, so it
            cannot be mistaken for auto's half-and-half at a glance. -->
          <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
            <circle class="chip-edge" cx="12" cy="12" r="9" />
            <path class="chip" d="M3 12a9 9 0 0 0 18 0Z" />
          </svg>
        {/if}
      </button>
    {/each}
  </div>
</div>

<style>
  /* An in-flow inline control: the header decides where it sits, and the
     popover anchors to the trigger. Nothing here is fixed, so opening the
     popover reflows nothing and the control cannot drift when other page
     chrome changes size. */
  .theme-menu {
    position: relative;
    display: inline-flex;
  }

  /* The trigger's chrome is the shared .icon-button rule in styles.css — one
     definition for every page-level icon control, so the reading-mode button
     and the refresh button beside it cannot drift apart. Only the popover and
     its swatches are styled here. */
  .popover {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    /* The one layered element in the widget: the popover hangs over the
       panel stack, which is later in the document and would otherwise paint
       on top of it. */
    z-index: var(--layer-menu, 30);
    display: flex;
    gap: var(--swatch-gap);
    padding: var(--swatch-popover-padding);
    border: 1px solid var(--color-border);
    /* A real design, not the generic floating pill (owner directive, issue
       169, 2026-08-24): the same flat radius the rest of the page's chrome
       wears (--card-radius, --tip-radius) rather than a bespoke 1.875rem
       curve found nowhere else on the site. */
    border-radius: var(--theme-menu-radius, 3px);
    background: var(--color-surface-raised);
  }

  .popover[hidden] {
    display: none;
  }

  @media (prefers-reduced-motion: no-preference) {
    .popover {
      animation: reveal 120ms ease-out;
    }

    @keyframes reveal {
      from {
        opacity: 0;
        transform: translateY(-0.25rem);
      }
    }
  }

  /* A swatch is a bare icon, exactly like the two controls in the header:
     no disc, no border, no fill, and 2.75rem = 44px of hit area around a
     glyph that paints a fraction of it. The 44px is written as a literal
     rather than read from a token on purpose — the touch-floor walk in
     tests/experience.test.mjs measures the declaration, and it can only
     measure a length it can read, so routing this one through var() would
     switch off the guard that protects it.

     Translucent at rest and fully present when addressed, which is the same
     move the chrome makes with its ink: nothing about the box changes, so
     hovering or choosing a mode repaints and never reflows. */
  .swatch {
    position: relative;
    inline-size: 2.75rem;
    block-size: 2.75rem;
    display: grid;
    place-items: center;
    padding: 0;
    cursor: pointer;
    border: 0;
    background: none;
    color: var(--color-text);
    opacity: var(--swatch-rest-opacity);
  }

  /* Full presence for the mode already chosen and for whichever one is being
     addressed — never MORE than the chrome's, which is why the active value
     is a token rather than a number written here. */
  .swatch:hover,
  .swatch:focus-visible,
  .swatch[aria-pressed='true'] {
    opacity: var(--swatch-active-opacity);
  }

  /* ...and the chrome's own answer to a pointer, on the chrome's own token:
     the ink becomes the brand mark, which is a defined color in every reading
     mode rather than a translucency that depends on what is behind it. It
     moves the OUTLINE and the chosen-mode bar; the palette enclosed by the
     glyph is data and never recolors. */
  .swatch:hover,
  .swatch:focus-visible {
    color: var(--color-brand);
  }

  @media (prefers-reduced-motion: no-preference) {
    .swatch {
      transition:
        opacity 120ms ease-out,
        color 120ms ease-out;
    }
  }

  /* The painted glyph is the chrome's, to the pixel: the size and the line
     weight are the shared tokens, so a change to the header icons carries
     the swatches with it instead of leaving them behind. */
  .glyph {
    inline-size: var(--swatch-glyph-size);
    block-size: var(--swatch-glyph-size);
  }

  /* Every glyph paints ONE ink — currentColor, the same ink the swatch
     already answers rest/hover/chosen with — so no mode needs its own
     palette rule and there is zero theme branching for a reading mode to
     fall out of step with (issue 180: shape tells the five apart now, not
     color). .chip is a filled shape, .chip-edge a stroked ring, .ray a
     stroked line; all three share the chrome's line weight, .chip included
     — its own stroke is none, but the family reads one line-weight token
     regardless of which part of a glyph is asked for it. */
  .chip,
  .chip-edge,
  .ray {
    stroke-width: var(--swatch-stroke);
    stroke-linejoin: round;
  }

  .chip {
    fill: currentColor;
    stroke: none;
  }

  .chip-edge,
  .ray {
    fill: none;
    stroke: currentColor;
  }

  .ray {
    stroke-linecap: round;
  }

  /* The chosen mode, marked by SHAPE rather than by color alone (the dataviz
     floor): a bar under its glyph. It is a pseudo-element, so it occupies no
     space in the row and choosing a mode cannot move the one beside it. */
  .swatch[aria-pressed='true']::after {
    content: '';
    position: absolute;
    inset-block-end: var(--swatch-mark-inset);
    inline-size: var(--swatch-mark-size);
    block-size: var(--swatch-mark-thickness);
    border-radius: var(--swatch-mark-thickness);
    background: currentColor;
  }

  .swatch:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
