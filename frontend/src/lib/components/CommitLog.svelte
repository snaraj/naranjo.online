<!-- CommitLog is the cycling calendar over a ruled log (owner directive,
  2026-09-03, issue 287): a segmented control that chooses which daily series
  the heatmap draws, the shared grid drawing it, that series' own reading
  under it, and the recent entries below.

  ONE GRID, NOT THREE. The sets are swapped through the SAME
  ContributionGrid instance rather than stacked and cross-faded, and that is a
  correctness property before it is a performance one: this page has exactly
  one heatmap implementation (issue 189), and three mounted copies of it would
  be three scroll positions, three keyboard cursors and three detail cards for
  one picture — the strip opens on its newest column, and a hidden copy that
  had never been laid out would open somewhere else the moment it was shown.
  Swapping the props means the set changes and every one of those behaviours
  stays exactly where the reader left it.

  THE SEGMENTS ARE PRESSED BUTTONS, deliberately not a radiogroup. A radio
  group makes the three one value a reader commits to; these are three views of
  the same section, each a button that is currently on — which is the same
  shape the gallery's set switch uses, so the page has one grammar for "pick
  which of these to show" rather than two.

  It names no series, no vendor and no host: which sets exist, what each
  counts, how each figure is written and where each entry points are all the
  adapter's, arriving as data. -->
<script lang="ts">
  import type { CommitLogProps } from '../blocks.ts';
  import ContributionGrid from './ContributionGrid.svelte';
  import FeedCard from './FeedCard.svelte';
  import PanelShell from './PanelShell.svelte';

  let { title, status, generatedAt, sets, rows, rowsNote, staleNote }: CommitLogProps = $props();

  /* Which set is drawn, by KEY rather than by index: the payload decides how
     many sets there are (a source that reports no daily series contributes
     none), so an index remembered across a delivery could name a set that no
     longer exists. A key that vanishes falls back to the first set, which is
     the contributions calendar. */
  let chosen = $state('');
  const active = $derived(sets.find((set) => set.key === chosen) ?? sets[0]);
</script>

<PanelShell {title} {status} {generatedAt} note={staleNote}>
  <FeedCard variant="ledger">
    {#if sets.length > 0 && active}
      <div class="commit-segments">
        {#each sets as set (set.key)}
          <button
            class="commit-segment"
            type="button"
            aria-pressed={set.key === active.key}
            onclick={() => (chosen = set.key)}>{set.label}</button>
        {/each}
      </div>
      <div class="commit-grid">
        <ContributionGrid
          columns={active.columns}
          noun={active.noun}
          label={active.stripLabel}
          emptyNote={active.emptyNote}
          formatValue={active.format}
          cardTitle={active.label}
          fullWidth />
      </div>
      <p class="commit-caption">{active.caption}</p>
    {/if}
    <!-- The log's box is RESERVED, not grown into: it is exactly as tall as
      the rows the adapter is allowed to hand it, so a payload landing a moment
      after first paint lands without moving the page under a reader. The empty
      note sits inside the same box for the same reason. -->
    <div class="commit-rows">
      {#if rows.length === 0}
        <p class="commit-note">{rowsNote}</p>
      {:else}
        {#each rows as row (row.key)}
          <div class="commit-row">
            <span class="commit-age">{row.age}</span>
            {#if row.source.href}
              <a
                class="commit-source"
                href={row.source.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={row.source.label}>{row.source.text}</a>
            {:else}
              <span class="commit-source-text">{row.source.text}</span>
            {/if}
            {#if row.title.href}
              <a
                class="commit-title"
                href={row.title.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={row.title.label}>{row.title.text}</a>
            {:else}
              <span class="commit-title-text">{row.title.text}</span>
            {/if}
            <span class="commit-mark">{row.mark}</span>
          </div>
        {/each}
      {/if}
    </div>
  </FeedCard>
</PanelShell>
