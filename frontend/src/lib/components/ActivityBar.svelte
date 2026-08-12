<!-- ActivityBar is the version-control activity status bar: a compact
  contribution strip (week columns of seven daily cells), the window totals
  and current streak, and the latest commits — all from the vcs-activity/v1
  panel served same-origin by internal/panels. Shaped, not styled, like every
  panel: colors and metrics read activity custom properties with dark-native
  defaults, so the future theme layer restyles by overriding variables and
  never edits this component.

  The cell ramp is one blue hue with monotone lightness — near-zero recedes
  toward the panel surface and the peak day is brightest — and a count is
  never encoded by color alone: every cell carries its date and count as
  tooltip and accessible label, and totals ride beside the strip as text.
  Every region has a fixed block size, so data arriving never shifts layout,
  and a wide window scrolls inside the strip, never the page. -->
<script lang="ts">
  import PanelShell from './PanelShell.svelte';
  import { panelAge, panelKinds, watchPanel, type PanelEnvelope } from '../panels';
  import {
    activityLevel,
    activityLevels,
    activityPanelId,
    cellDate,
    cellLabel,
    maxDailyCount,
    parseVCSActivity
  } from '../activity';

  /* The commits region shows at most this many rows inside its fixed box;
     the payload may carry more and the rest simply do not render. */
  const shownCommitRows = 5;

  const legendLevels = Array.from({ length: activityLevels }, (_, level) => level);

  let envelope = $state<PanelEnvelope | null>(null);

  $effect(() => watchPanel(activityPanelId, (loaded) => (envelope = loaded)));

  /* A payload renders only when the envelope carries the pinned kind AND the
     data passes strict admission; anything else is the honest empty state. */
  const activity = $derived(
    envelope !== null && envelope.kind === panelKinds.vcsActivity
      ? parseVCSActivity(envelope.data)
      : null
  );
  const peak = $derived(activity === null ? 0 : maxDailyCount(activity.weeks));
  const commits = $derived(
    activity === null ? [] : activity.recentCommits.slice(0, shownCommitRows)
  );
  const stripLabel = $derived(
    activity === null
      ? 'contribution calendar'
      : `contribution calendar: ${activity.weeks.length} weeks of daily counts, newest last`
  );
</script>

<aside class="activity-bar" data-activity-panel>
  <PanelShell
    title={envelope?.title || 'Version-control activity'}
    status={envelope?.status ?? 'unavailable'}
    generatedAt={envelope?.generatedAt}
  >
    <div class="activity">
      <p class="activity-totals">
        {#if activity}
          <span><strong>{activity.totalContributions}</strong> contributions</span>
          <span><strong>{activity.streak}</strong>-day streak</span>
        {:else}
          <span class="activity-empty">no activity data</span>
        {/if}
      </p>
      <!-- The strip clips wide windows behind its own horizontal scrollbar,
        and a scrollable region is keyboard-reachable only when focusable, so
        the tabindex is deliberate. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="activity-strip" role="region" aria-label={stripLabel} tabindex="0">
        {#if activity}
          <div class="activity-graph">
            {#each activity.weeks as week, weekIndex}
              {#each week as count, dayIndex}
                {@const label = cellLabel(
                  count,
                  cellDate(envelope?.generatedAt, activity.weeks.length, weekIndex, dayIndex)
                )}
                <span
                  class="activity-cell"
                  data-activity-cell
                  data-activity-level={activityLevel(count, peak)}
                  role="img"
                  aria-label={label}
                  title={label}
                ></span>
              {/each}
            {/each}
          </div>
        {:else}
          <p class="activity-empty">activity data unavailable</p>
        {/if}
      </div>
      <p class="activity-legend" aria-hidden="true">
        <span>less</span>
        {#each legendLevels as level}
          <span class="activity-cell" data-activity-level={level}></span>
        {/each}
        <span>more</span>
      </p>
      <ol class="activity-commits">
        {#each commits as commit}
          <li class="activity-commit">
            <span class="activity-commit-repo">{commit.repo}</span>
            <span class="activity-commit-message" title={commit.message}>{commit.message}</span>
            <span class="activity-commit-age">{panelAge(commit.at)}</span>
          </li>
        {/each}
      </ol>
    </div>
  </PanelShell>
</aside>

<style>
  /* The bar docks at the viewport's bottom start corner like a status bar,
     out of the document flow, so mounting it never reflows the page. Width
     is bounded against the viewport; anything wider scrolls inside. */
  .activity-bar {
    position: fixed;
    inset-block-end: var(--activity-inset-block, 0.75rem);
    inset-inline-start: var(--activity-inset-inline, 0.75rem);
    inline-size: min(var(--activity-width, 21rem), calc(100vw - 1.5rem));
    z-index: var(--activity-layer, 10);
  }

  /* Short viewports flow the bar after the page content instead of
     overlaying the centered shell. */
  @media (max-height: 30rem) {
    .activity-bar {
      position: static;
      margin: 1rem auto;
    }
  }

  .activity {
    display: flex;
    flex-direction: column;
    gap: var(--activity-gap, 0.5rem);
  }

  /* Every region owns a fixed block size so the panel's geometry is
     identical before, during, and after data arrival — zero layout shift. */
  .activity-totals {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 1rem;
    block-size: 1.25rem;
    white-space: nowrap;
    overflow: hidden;
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .activity-totals strong {
    font-weight: 650;
    color: var(--activity-emphasis, var(--panel-text, rgb(230, 230, 230)));
  }

  /* 7 cell rows plus their 6 gaps measure 5.5rem; the remaining 0.75rem is
     the horizontal scrollbar's reserved gutter, so a wide window scrolling
     inside the strip never changes the strip's outer height. */
  .activity-strip {
    block-size: 6.25rem;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .activity-strip:focus-visible {
    outline: 1px solid var(--panel-accent, rgb(220, 138, 0));
    outline-offset: 1px;
  }

  .activity-graph {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(7, var(--activity-cell-size, 0.625rem));
    grid-auto-columns: var(--activity-cell-size, 0.625rem);
    gap: var(--activity-cell-gap, 0.1875rem);
    inline-size: max-content;
  }

  /* The sequential cell ramp: one hue, monotone lightness, anchored for the
     dark surface — level 0 is a near-surface neutral and levels 1..4 step
     brighter (validated: monotone lightness, visible step gaps, level 1
     clears 2:1 against the panel surface). The theme layer overrides the
     five custom properties to restyle or re-anchor the ramp. */
  .activity-cell {
    inline-size: var(--activity-cell-size, 0.625rem);
    block-size: var(--activity-cell-size, 0.625rem);
    border-radius: var(--activity-cell-radius, 2px);
    background: var(--activity-cell-0, #383835);
  }

  .activity-cell[data-activity-level='1'] {
    background: var(--activity-cell-1, #1c5cab);
  }

  .activity-cell[data-activity-level='2'] {
    background: var(--activity-cell-2, #2a78d6);
  }

  .activity-cell[data-activity-level='3'] {
    background: var(--activity-cell-3, #5598e7);
  }

  .activity-cell[data-activity-level='4'] {
    background: var(--activity-cell-4, #86b6ef);
  }

  .activity-strip .activity-cell:hover {
    outline: 1px solid var(--activity-cell-ring, rgba(255, 255, 255, 0.6));
    outline-offset: 1px;
  }

  .activity-empty {
    margin: 0;
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .activity-legend {
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--activity-cell-gap, 0.1875rem);
    block-size: 0.875rem;
    font-size: 0.6875rem;
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .activity-legend span:first-child {
    margin-inline-end: 0.25rem;
  }

  .activity-legend span:last-child {
    margin-inline-start: 0.25rem;
  }

  .activity-commits {
    margin: 0;
    padding: 0;
    list-style: none;
    block-size: 5.625rem;
    overflow: hidden;
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .activity-commit {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: baseline;
    gap: 0.5rem;
    block-size: 1.125rem;
    white-space: nowrap;
  }

  .activity-commit-repo {
    color: var(--activity-repo, var(--panel-accent, rgb(220, 138, 0)));
    max-inline-size: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .activity-commit-message {
    color: var(--panel-text, rgb(230, 230, 230));
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .activity-commit-age {
    color: var(--panel-muted, rgb(158, 158, 158));
  }
</style>
