<!-- ActivityBar is the version-control activity panel: the contribution
  calendar, the window totals and current streak, and the latest commits — all
  from the vcs-activity/v1 panel served same-origin by internal/panels.

  The calendar renders through ContributionGrid, the same component the token
  panel's activity heatmap uses, so the two grids cannot drift. Shaped, not
  styled, like every panel: colors and metrics read custom properties with
  dark-native defaults, so the future theme layer restyles by overriding
  variables and never edits this component.

  It used to dock to the viewport's bottom-start corner as fixed chrome, which
  meant the page had to reserve a strip below itself for a bar that overlaid
  it, and the bar had to bound its own height against that same reserve so the
  two could not disagree. It is now an ordinary card in the page's panel
  stack: it takes the column's width, grows to its own content, and neither
  overlays anything nor asks the page to hold space open for it — so the
  gutter token, the height bound, and the narrow-viewport reflow branch that
  existed only to undo the docking are all gone with it.

  Every region has a fixed block size, so data arriving never shifts layout,
  and a wide window scrolls inside the grid, never the page. -->
<script lang="ts">
  import PanelShell from './PanelShell.svelte';
  import ContributionGrid from './ContributionGrid.svelte';
  import { panelAge, panelKinds, watchPanel, type PanelEnvelope } from '../panels';
  import { activityCells, activityPanelId, parseVCSActivity } from '../activity';
  import { formatWhole, toColumns } from '../grid';

  /* The commits region shows at most this many rows inside its fixed box;
     the payload may carry more and the rest simply do not render. */
  const shownCommitRows = 5;

  let envelope = $state<PanelEnvelope | null>(null);

  $effect(() => {
    return watchPanel(activityPanelId, (loaded) => (envelope = loaded));
  });

  /* A payload renders only when the envelope carries the pinned kind AND the
     data passes strict admission; anything else is the honest empty state. */
  const activity = $derived(
    envelope !== null && envelope.kind === panelKinds.vcsActivity
      ? parseVCSActivity(envelope.data)
      : null
  );
  const columns = $derived(activity === null ? [] : toColumns(activityCells(activity)));
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
          <span><strong>{formatWhole(activity.totalContributions)}</strong> contributions</span>
          <span><strong>{formatWhole(activity.streak)}</strong>-day streak</span>
        {:else}
          <span class="activity-empty">no activity data</span>
        {/if}
      </p>
      <ContributionGrid
        {columns}
        noun="contribution"
        label={stripLabel}
        emptyNote="activity data unavailable"
      />
      <ol class="activity-commits">
        {#if commits.length === 0}
          <!-- The contribution calendar carries no commit rows, so an empty
            list is the truthful state rather than a gap to fill with
            invented history. -->
          <li class="activity-commit activity-empty">no recent commits reported</li>
        {:else}
          {#each commits as commit}
            <li class="activity-commit">
              <span class="activity-commit-repo">{commit.repo}</span>
              <span class="activity-commit-message" title={commit.message}>{commit.message}</span>
              <span class="activity-commit-age">{panelAge(commit.at)}</span>
            </li>
          {/each}
        {/if}
      </ol>
    </div>
  </PanelShell>
</aside>

<style>
  /* An ordinary block in the page's panel stack. The stack owns the column
     width and the gap between cards, so this panel declares neither: the one
     thing that used to make it special — being fixed — is exactly what made
     it fight the page, and the gutter token, the self-imposed height bound,
     and the narrow-viewport branch that existed only to undo the docking all
     left with it. */
  .activity-bar {
    display: block;
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

  .activity-empty {
    margin: 0;
    color: var(--panel-muted, rgb(158, 158, 158));
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
