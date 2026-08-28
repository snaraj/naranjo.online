<!-- UsageFilterMenu collapses one source's display choices — the view lens,
  the trailing range, and (when the source reports one) the category lens —
  behind a single compact trigger (owner directive, 2026-08-28: "organize all
  of the different filters into menus that look and read more sleek …they
  should be hidden behind"). The three exposed pill rows read as settings; the
  questions they ask are occasional, so they now live in a popover the reader
  opens on purpose.

  The open/close behaviour is lib/disclosure.ts — the SAME state machine the
  reading-mode toggle runs, because its focus/press ordering rules were earned
  on real engines (WebKit fires focusout mid-press; see disclosure.ts) and a
  second hand-rolled popover is how a page collects two different bugs with
  one name. This component only renders state and moves focus.

  The values themselves stay in UsageTracker's per-source maps — presentation
  state that must survive the adapter rebuilding sections on every delivery —
  and arrive here as props beside their setters. The groups keep their radio
  semantics and the shared roving-tabindex keyboard (ringTarget), exactly as
  they had exposed; hiding controls behind a disclosure is presentation, not
  an excuse to shed the composite-widget contract. -->
<script lang="ts">
  import { tick } from 'svelte';
  import {
    createDisclosure,
    dismiss,
    focusLeft,
    outsidePress,
    pressBegan,
    triggerClick,
    triggerPointerDown
  } from '../disclosure';
  import { isChord, ringTarget } from '../keys.ts';

  interface FilterGroup {
    // A short question label ("view", "range", …) — popover section heading
    // and the audible group name suffix.
    label: string;
    options: readonly { key: string; label: string }[];
    current: string;
    choose: (next: string) => void;
  }

  let {
    sourceLabel,
    groups
  }: {
    sourceLabel: string;
    groups: readonly FilterGroup[];
  } = $props();

  const disclosure = $state(createDisclosure());
  let root = $state<HTMLDivElement>();
  let trigger = $state<HTMLButtonElement>();
  let popover = $state<HTMLDivElement>();

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
    // Land keyboard focus on the first group's checked segment, which is that
    // group's one tab stop.
    await tick();
    popover?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
  }

  function onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && dismiss(disclosure)) {
      event.preventDefault();
      trigger?.focus();
    }
  }

  function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    focusLeft(disclosure, next instanceof Node && (root?.contains(next) ?? false));
  }

  // Escape anywhere in the popover closes it and returns focus to the
  // trigger; the arrows stay the property of whichever radio group holds
  // focus (onGroupKeydown below).
  function onPopoverKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && dismiss(disclosure)) {
      event.preventDefault();
      event.stopPropagation();
      trigger?.focus();
    }
  }

  /* The shared segmented-pill keyboard (issue 219): roving tabindex, arrows
     moving choice and focus together on lib/keys.ts's ring, chords left to
     the platform. Same contract as when the groups rendered exposed. */
  function onGroupKeydown(event: KeyboardEvent, group: FilterGroup): void {
    if (isChord(event)) {
      return;
    }
    const keys = group.options.map((option) => option.key);
    const next = ringTarget(event.key, keys.indexOf(group.current), keys.length);
    if (next === null) {
      return;
    }
    event.preventDefault();
    group.choose(keys[next]);
    const element = event.currentTarget;
    if (element instanceof HTMLElement) {
      element.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointerdown} />

<div class="filter-menu" bind:this={root} onfocusout={onFocusOut}>
  <button
    type="button"
    class="filter-trigger"
    aria-label={`${sourceLabel} display options`}
    aria-expanded={disclosure.open}
    bind:this={trigger}
    onpointerdown={() => triggerPointerDown(disclosure)}
    onclick={onTriggerClick}
    onkeydown={onTriggerKeydown}
  >
    <!-- Three offset slider rails: the conventional "filters" silhouette,
      stroked with the panel's own ink. -->
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      >
        <line x1="4" y1="7" x2="20" y2="7" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="17" x2="20" y2="17" />
      </g>
      <g fill="currentColor" stroke="none">
        <circle cx="9" cy="7" r="2.1" />
        <circle cx="15" cy="12" r="2.1" />
        <circle cx="7" cy="17" r="2.1" />
      </g>
    </svg>
    <span class="filter-trigger-word">display</span>
  </button>

  <!-- role=group, not menu: the popover is labeled radio groups, and menu
    semantics would promise item-per-action interaction these don't have
    (the reading-mode popover's review F4, same call). The container-level
    keydown is Escape-to-dismiss alone — the group is not itself interactive,
    it catches the one key its interactive children deliberately leave to
    their ancestor, which is the pattern the linter cannot see. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="filter-popover"
    role="group"
    aria-label={`${sourceLabel} display options`}
    hidden={!disclosure.open}
    bind:this={popover}
    onkeydown={onPopoverKeydown}
  >
    {#each groups as group (group.label)}
      <div class="filter-group">
        <span class="filter-group-label" aria-hidden="true">{group.label}</span>
        <div
          class="usage-views"
          role="radiogroup"
          tabindex="-1"
          aria-label={`${sourceLabel} ${group.label}`}
          onkeydown={(event) => onGroupKeydown(event, group)}
        >
          {#each group.options as option (option.key)}
            <button
              type="button"
              class="usage-view"
              role="radio"
              aria-checked={group.current === option.key}
              tabindex={group.current === option.key ? 0 : -1}
              onpointerdown={() => pressBegan(disclosure)}
              onclick={() => group.choose(option.key)}
            >
              {option.label}
            </button>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .filter-menu {
    position: relative;
    display: inline-flex;
  }

  /* The trigger is a quiet pill — icon plus one lowercase word — sized to
     the repository's touch floor like every segment it replaced. */
  .filter-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-block-size: 2.75rem;
    min-inline-size: 2.75rem;
    padding-inline: 0.75rem;
    border: 1px solid var(--panel-border, rgb(23, 23, 23));
    border-radius: 999px;
    background: var(--usage-tile-surface, var(--panel-tip-surface, rgb(23, 23, 23)));
    color: var(--panel-muted, rgb(158, 158, 158));
    font: inherit;
    font-size: var(--panel-badge-size, 0.6875rem);
    text-transform: lowercase;
    cursor: pointer;
  }

  .filter-trigger:hover,
  .filter-trigger:focus-visible,
  .filter-trigger[aria-expanded='true'] {
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .filter-trigger:focus-visible {
    outline: 1px solid var(--panel-accent, rgb(220, 138, 0));
    outline-offset: -1px;
  }

  /* Anchored under the trigger's end edge and layered over the strip below;
     the same surface grammar as the panel's tips. */
  .filter-popover {
    position: absolute;
    inset-block-start: 100%;
    inset-inline-end: 0;
    margin-block-start: 0.375rem;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    padding: 0.75rem;
    border: 1px solid var(--panel-border, rgb(23, 23, 23));
    border-radius: 0.75rem;
    background: var(--panel-popover-surface, var(--panel-card, rgb(16, 16, 18)));
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  }

  .filter-popover[hidden] {
    display: none;
  }

  .filter-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .filter-group-label {
    font-size: var(--panel-badge-size, 0.6875rem);
    color: var(--panel-muted, rgb(158, 158, 158));
    text-transform: lowercase;
  }

  /* The pills inside keep the exposed rows' exact grammar (shared classes,
     same tokens), wrapping when a vocabulary outgrows one line. */
  .usage-views {
    display: inline-flex;
    flex-wrap: wrap;
    padding: 2px;
    border-radius: 999px;
    background: var(--usage-tile-surface, var(--panel-tip-surface, rgb(23, 23, 23)));
    border: 1px solid var(--panel-border, rgb(23, 23, 23));
  }

  .usage-view {
    min-block-size: 2.75rem;
    min-inline-size: 2.75rem;
    padding-inline: 0.625rem;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--panel-muted, rgb(158, 158, 158));
    font: inherit;
    font-size: var(--panel-badge-size, 0.6875rem);
    text-transform: lowercase;
    cursor: pointer;
  }

  .usage-view[aria-checked='true'] {
    background: var(--usage-view-active, var(--panel-surface, rgb(40, 40, 40)));
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .usage-view:focus-visible {
    outline: 1px solid var(--panel-accent, rgb(220, 138, 0));
    outline-offset: -1px;
  }
</style>
