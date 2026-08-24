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
     (owner directive, 2026-08-24). They used to be 2.75rem filled discs, each
     rimmed and — when chosen — ringed again two pixels thick, which made the
     five quietest choices on the page its heaviest objects and read as
     nothing like the small translucent glyphs above them. What they are now
     is one grammar, shared with those glyphs and derived from their tokens
     rather than restating them: the same painted box
     (--chrome-icon-glyph-size), the same line weight (--chrome-icon-stroke),
     no disc, no border, no fill, and the same brand-ink hover.

     A swatch still has to say which palette it selects, so the palette moved
     INSIDE the glyph instead of behind it. Every glyph is one shape drawn
     twice over: the outline is the PAGE's own ink, which is what keeps the
     mark legible on the popover in all four reading modes and is the family
     trait it shares with the chrome; the enclosed area is that MODE's own
     surface token; and the detail inside — the moon's craters — is that
     mode's own ink. Nothing here is a second copy of a palette value.

     Auto splits its circle down the middle between the two surfaces it
     chooses between, light wears the sun, and the three darks wear the same
     moon. Those three are told apart by their craters' temperature —
     neutral, cool, warm — which is the honest distinction, because they ARE
     the same kind of mode at different temperatures and inventing a third
     shape would claim a difference the modes do not have. The craters used to
     mark the true dark alone; at the chrome's icon size they are also the
     only place a dark mode's INK can be shown, and all three have one, so
     withholding them from two of the modes would have hidden the very value
     that tells those two apart.

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
          <!-- Auto owns no palette: it is whichever of the two the device
            asks for, so its glyph is one circle split down the middle
            between those two page surfaces, outlined in the page's own ink
            like every other glyph here. -->
          <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
            <path class="auto-half-light" d="M12 3A9 9 0 0 0 12 21Z" />
            <path class="auto-half-dark" d="M12 3A9 9 0 0 1 12 21Z" />
            <circle class="chip-edge" cx="12" cy="12" r="9" />
          </svg>
        {:else if mode.id === 'light'}
          <!-- The sun's body is the palette chip — filled with light's own
            page surface — and its rays are line work in the page's ink, at
            the same weight the refresh glyph beside it is drawn in. -->
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
        {:else}
          <!-- One moon for all three darks, filled with that mode's own page
            surface and cratered in that mode's own ink — neutral for the
            true dark, cool for slate, warm for sepia. -->
          <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
            <path class="chip" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
            <circle class="crater" cx="9.3" cy="15.2" r="2.5" />
            <circle class="crater" cx="13.2" cy="17.4" r="1.7" />
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
     and the refresh button beside it cannot drift apart. Only the swatches,
     which preview palettes, are styled here. */
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
    border-radius: 1.875rem;
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

  /* One shape, drawn twice over. The outline is the PAGE's ink — the only
     ink guaranteed legible on the popover in all four reading modes, and the
     reason a swatch needs no disc behind it to be seen — and the enclosed
     area is the mode's own page surface. */
  .chip,
  .chip-edge,
  .ray {
    stroke: currentColor;
    stroke-width: var(--swatch-stroke);
    stroke-linejoin: round;
  }

  .chip-edge,
  .ray {
    fill: none;
  }

  .ray {
    stroke-linecap: round;
  }

  .crater,
  .auto-half-light,
  .auto-half-dark {
    stroke: none;
  }

  .swatch-auto .auto-half-light {
    fill: var(--palette-light-surface);
  }

  .swatch-auto .auto-half-dark {
    fill: var(--palette-dark-surface);
  }

  .swatch-light .chip {
    fill: var(--palette-light-surface);
  }

  .swatch-dark .chip {
    fill: var(--palette-dark-surface);
  }

  .swatch-dark .crater {
    fill: var(--palette-dark-accent);
  }

  .swatch-slate .chip {
    fill: var(--palette-slate-surface);
  }

  /* Slate's craters are its own accent, measured at 10.38:1 on its own
     surface — the palette already holds a foreground this far from its
     background, and a 3px mark needs every bit of it. */
  .swatch-slate .crater {
    fill: var(--palette-slate-accent);
  }

  .swatch-sepia .chip {
    fill: var(--palette-sepia-surface);
  }

  /* Sepia's accent, unmixed, at 7.09:1 on sepia's own surface. It used to be
     mixed one step darker so a 44px moon would not shout; the moon is 18px
     now and its craters are 3px, and a mark that small needs the palette's
     brightest ink rather than a dimmed one. Dropping the mix also drops this
     component's only color-mix() — a function a browser inside this site's
     support window may not know, which does not degrade but INVALIDATES the
     declaration it sits in — so the @supports fallback it needed goes with
     it. The page still uses one elsewhere (the usage meter's track), guarded
     the other legal way, by a plain declaration of the same property above
     it; the progressive-feature pin covers both forms and still has a
     subject. */
  .swatch-sepia .crater {
    fill: var(--palette-sepia-accent);
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
