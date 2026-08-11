<script lang="ts">
  import { tick } from 'svelte';
  import { applyTheme, documentTheme, themes, type ThemeId } from './themes';

  // The origin stamps the chosen mode on <html> before any script runs, so
  // the initial state reads the document itself — never a second source of
  // truth that could disagree with what the visitor already sees.
  let selected = $state<ThemeId | null>(documentTheme());
  let open = $state(false);
  let root = $state<HTMLDivElement>();
  let trigger = $state<HTMLButtonElement>();
  let popover = $state<HTMLDivElement>();

  function swatches(): HTMLButtonElement[] {
    return Array.from(popover?.querySelectorAll('button') ?? []);
  }

  async function toggleOpen(): Promise<void> {
    open = !open;
    if (!open) {
      return;
    }
    // Move focus into the popover on the current choice (or the first swatch
    // when nothing is chosen yet) so keyboard and switch users land inside.
    await tick();
    const buttons = swatches();
    (buttons.find((button) => button.getAttribute('aria-pressed') === 'true') ?? buttons[0])?.focus();
  }

  function choose(id: ThemeId): void {
    selected = id;
    applyTheme(id);
    close(true);
  }

  function close(refocus: boolean): void {
    if (!open) {
      return;
    }
    open = false;
    if (refocus) {
      trigger?.focus();
    }
  }

  // Focus leaving the whole widget (tab-out, or a click that moves focus
  // elsewhere) dismisses the popover without stealing focus back.
  function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (!(next instanceof Node && root?.contains(next))) {
      close(false);
    }
  }

  function onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    }
  }

  function onSwatchKeydown(event: KeyboardEvent): void {
    const buttons = swatches();
    const current = buttons.indexOf(event.currentTarget as HTMLButtonElement);
    let next = -1;
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        close(true);
        return;
      case 'ArrowRight':
      case 'ArrowDown':
        next = (current + 1) % buttons.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (current - 1 + buttons.length) % buttons.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = buttons.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    buttons[next]?.focus();
  }
</script>

<!-- The wiki's toggle, minimally: a compact moon button opening a popover of
     one round swatch per reading mode. Each swatch's background IS its
     theme's page surface — read from that theme's own palette tokens, never
     a second copy of the values — with a sun on the light surface, a
     cratered moon on the dark surface, and a plain dark moon on the sepia
     surface. Native buttons only; the glyphs are inline SVG. -->
<div class="theme-menu" bind:this={root} onfocusout={onFocusOut}>
  <button
    type="button"
    class="trigger"
    aria-label="Reading mode"
    aria-haspopup="true"
    aria-expanded={open}
    aria-controls="reading-mode-menu"
    bind:this={trigger}
    onclick={toggleOpen}
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
    hidden={!open}
    bind:this={popover}
  >
    {#each themes as theme (theme.id)}
      <button
        type="button"
        class="swatch swatch-{theme.id}"
        aria-label={theme.label}
        aria-pressed={selected === theme.id}
        onclick={() => choose(theme.id)}
        onkeydown={onSwatchKeydown}
      >
        {#if theme.id === 'light'}
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
        {:else if theme.id === 'dark'}
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
  /* Fixed in the shell's header corner: opening the popover reflows nothing
     and can never introduce horizontal overflow, even at 320px. */
  .theme-menu {
    position: fixed;
    top: 1rem;
    right: 1rem;
  }

  .trigger,
  .swatch {
    /* 2.75rem = 44px: the minimum comfortable touch target. */
    width: 2.75rem;
    height: 2.75rem;
    display: grid;
    place-items: center;
    padding: 0;
    cursor: pointer;
    border-radius: 50%;
  }

  .trigger {
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
  }

  .trigger[aria-expanded='true'],
  .trigger:hover {
    background: var(--color-surface-overlay);
    border-color: var(--color-border-strong);
  }

  .popover {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
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

  /* Each swatch previews its own palette: the background is that theme's
     page surface token and the glyph color one of its foreground tokens —
     values referenced from styles.css, never duplicated here. */
  .swatch {
    border: 1px solid var(--color-border-strong);
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
    color: var(--palette-sepia-border-strong);
  }

  .swatch[aria-pressed='true'] {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px var(--color-accent);
  }

  .trigger:focus-visible,
  .swatch:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
