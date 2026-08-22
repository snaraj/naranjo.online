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

<!-- The wiki's toggle, minimally: a compact moon button opening a popover of
     one round swatch per choice. Each swatch's background IS its mode's page
     surface — read from that mode's own palette tokens, never a second copy
     of the values — with a split light/dark disc for auto, a sun on the light
     surface, a cratered moon on the dark surface, and a plain dark moon on
     the sepia surface. Native buttons only; the glyphs are inline SVG. Plain
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
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
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
          <!-- Two half-discs, each drawn in the ink of the half it sits on,
            so the glyph previews both palettes at once and every half of it
            is high-contrast against its own background. -->
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path class="auto-half-light" d="M12 3.4A8.6 8.6 0 0 0 12 20.6Z" />
            <path class="auto-half-dark" d="M12 3.4A8.6 8.6 0 0 1 12 20.6Z" />
          </svg>
        {:else if mode.id === 'light'}
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="12" cy="12" r="4.6" fill="currentColor" />
            <g stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <line x1="12" y1="1.6" x2="12" y2="4.4" />
              <line x1="12" y1="19.6" x2="12" y2="22.4" />
              <line x1="1.6" y1="12" x2="4.4" y2="12" />
              <line x1="19.6" y1="12" x2="22.4" y2="12" />
              <line x1="4.65" y1="4.65" x2="6.6" y2="6.6" />
              <line x1="17.4" y1="17.4" x2="19.35" y2="19.35" />
              <line x1="17.4" y1="6.6" x2="19.35" y2="4.65" />
              <line x1="4.65" y1="19.35" x2="6.6" y2="17.4" />
            </g>
          </svg>
        {:else if mode.id === 'dark'}
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" fill="currentColor" />
            <circle class="crater" cx="9.2" cy="9.6" r="1.3" />
            <circle class="crater" cx="12" cy="15" r="1.7" />
            <circle class="crater" cx="7.4" cy="13.6" r="0.9" />
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" fill="currentColor" />
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
    gap: 0.5rem;
    padding: 0.5rem;
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

  /* Each swatch previews its own palette: the background is that mode's page
     surface token and the glyph color one of its foreground tokens — values
     referenced from styles.css, never duplicated here. 2.75rem = 44px: the
     minimum comfortable touch target. */
  .swatch {
    width: 2.75rem;
    height: 2.75rem;
    display: grid;
    place-items: center;
    padding: 0;
    cursor: pointer;
    border-radius: 50%;
    border: 1px solid var(--color-border-strong);
  }

  /* Auto has no palette of its own — it is whichever of the two the visitor's
     device asks for — so its swatch shows both, split down the middle, and
     each half of the glyph is drawn in the ink that belongs to its side. */
  .swatch-auto {
    background: linear-gradient(
      90deg,
      var(--palette-light-surface) 0 50%,
      var(--palette-dark-surface) 50% 100%
    );
  }

  .swatch-auto .auto-half-light {
    fill: var(--palette-light-text);
  }

  .swatch-auto .auto-half-dark {
    fill: var(--palette-dark-text);
  }

  .swatch-light {
    background: var(--palette-light-surface);
    color: var(--palette-light-accent);
  }

  .swatch-dark {
    background: var(--palette-dark-surface);
    color: var(--palette-dark-accent);
  }

  .swatch-dark .crater {
    fill: var(--palette-dark-surface);
  }

  .swatch-sepia {
    background: var(--palette-sepia-surface);
    /* Still a dark-brown moon, but mixed one step toward the accent so the
       glyph clears WCAG 1.4.11's 3:1 with real margin (≈4.4:1) on the sepia
       surface — tokens only, no restated value (review F4). */
    color: color-mix(in srgb, var(--palette-sepia-border-strong) 60%, var(--palette-sepia-accent));
  }

  .swatch[aria-pressed='true'] {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px var(--color-accent);
  }

  .swatch:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
