<!-- ContributionCalendar is the cycling calendar (owner directive, 2026-09-03,
  issue 287; moved into Trackers by the owner's design decision of 2026-09-11,
  issue 318): a segmented control that chooses which daily series the heatmap
  draws, the shared grid drawing it, and that series' own reading under it.

  THE LOG THAT USED TO SIT UNDER IT LEFT, not the calendar. The commits section
  was a calendar over a log; the owner's decision made the log the right-hand
  column of the sheet's paired section and left this a tracker among the
  trackers, under the token cards it shares a window with. The rows are built
  by the same function in lib/commits.ts they always were — one adapter split
  in two, not a second copy.

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
  the same block, each a button that is currently on — which is the same
  shape the gallery's set switch uses, so the page has one grammar for "pick
  which of these to show" rather than two.

  It names no series, no vendor and no host: which sets exist, what each
  counts, how each figure is written and where each entry points are all the
  adapter's, arriving as data. -->
<script lang="ts">
  import type { ContributionCalendarProps } from '../blocks.ts';
  import ContributionGrid from './ContributionGrid.svelte';
  import FeedCard from './FeedCard.svelte';
  import PanelShell from './PanelShell.svelte';

  let { status, generatedAt, sets }: ContributionCalendarProps = $props();

  /* Which set is drawn, by KEY rather than by index: the payload decides how
     many sets there are (a source that reports no daily series contributes
     none), so an index remembered across a delivery could name a set that no
     longer exists. A key that vanishes falls back to the first set — the
     adapter puts the busiest token series there (owner directive, 2026-09-04,
     issue 294), and the contributions calendar last. */
  let chosen = $state('');
  const active = $derived(sets.find((set) => set.key === chosen) ?? sets[0]);
</script>

<!-- No panel label (owner directive, 2026-09-04, issue 294): the envelope's
  title names the version-control host, and a calendar that opens on a token
  series cannot wear it. The segments name every source, one line below. -->
<PanelShell {status} {generatedAt}>
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
    {/if}
  </FeedCard>
</PanelShell>
