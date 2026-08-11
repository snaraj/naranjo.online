<script lang="ts">
  import { applyTheme, documentTheme, themes, type ThemeId } from './themes';

  // The origin stamps the chosen mode on <html> before any script runs, so
  // the initial radio state reads the document itself — never a second
  // source of truth that could disagree with what the visitor already sees.
  let selected = $state<ThemeId | null>(documentTheme());
  let menu = $state<HTMLDetailsElement>();

  function choose(id: ThemeId): void {
    selected = id;
    applyTheme(id);
    if (menu) {
      menu.open = false;
    }
  }
</script>

<!-- A native disclosure (details/summary) plus a native radio group: fully
     keyboard- and screen-reader-accessible without custom ARIA wiring, no
     dependencies, no inline scripts — the wiki's popup select, minimally. -->
<details class="theme-menu" bind:this={menu}>
  <summary>Reading mode</summary>
  <fieldset>
    <legend>Reading mode</legend>
    {#each themes as theme (theme.id)}
      <label>
        <input
          type="radio"
          name="reading-mode"
          value={theme.id}
          checked={selected === theme.id}
          onchange={() => choose(theme.id)}
        />
        {theme.label}
      </label>
    {/each}
  </fieldset>
</details>

<style>
  .theme-menu {
    position: fixed;
    top: 1rem;
    right: 1rem;
    font-size: 0.875rem;
    color: var(--color-text);
  }

  summary {
    cursor: pointer;
    user-select: none;
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    background: var(--color-surface-raised);
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  .theme-menu[open] summary {
    background: var(--color-surface-overlay);
    border-color: var(--color-border-strong);
  }

  fieldset {
    position: absolute;
    right: 0;
    margin: 0.4rem 0 0;
    padding: 0.5rem;
    display: grid;
    gap: 0.25rem;
    min-width: 9rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    background: var(--color-surface-raised);
  }

  /* Visually hidden, still announced: the group name for assistive tech. */
  legend {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.15rem 0.35rem;
    border-radius: 0.25rem;
    cursor: pointer;
  }

  label:hover {
    background: var(--color-surface-overlay);
  }

  input {
    accent-color: var(--color-accent);
    margin: 0;
  }
</style>
