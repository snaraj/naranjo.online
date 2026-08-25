<!-- ActivityBar is the version-control activity panel: the contribution
  calendar, the window totals and current streak, and the latest commits — all
  from the vcs-activity/v1 panel served same-origin by internal/panels.

  The heading is whatever the ORIGIN calls this panel, and the owner's rename
  (issue 127) landed there rather than here for a reason worth stating: the
  name the owner chose is the name of a service, and neither this file nor
  the Go package may spell one — both are pinned against it, so that swapping
  where the data comes from is a data edit and never a code edit. The origin
  reads the title from its own config data and serves it on the envelope; the
  fallback below is the neutral name, used only when no envelope has arrived
  yet.

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
  and a wide window scrolls inside the grid, never the page.

  Every commit row is real navigation now (issue 157). The repo name links to
  the repository, and the subject PREFERS the commit's own permalink whenever
  its SHA validates, falling back to its trailing "(#N)" reference only when
  no valid SHA is present (Daybreak Blue's review, round 3, finding 3: the
  SHA is the one association this document can actually prove, so it must
  never be outranked by a syntactic guess a subject line happens to carry) —
  every href comes from lib/activity.ts's validated builders, never from
  interpolating the payload's own strings, so a row this document cannot
  vouch for renders as the plain text it always was rather than as a link
  nobody addressed. Text stays text either way: neither branch below renders
  payload data as markup. -->
<script lang="ts">
  import PanelShell from './PanelShell.svelte';
  import ContributionGrid from './ContributionGrid.svelte';
  import { panelAge, panelKinds, watchPanel, type PanelEnvelope } from '../panels';
  import {
    activityCells,
    activityPanelId,
    commitReferenceLinkLabel,
    commitReferenceUrl,
    commitRepoLinkLabel,
    commitRepoUrl,
    commitShaLinkLabel,
    commitShaUrl,
    parseVCSActivity
  } from '../activity';
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
            {@const repoHref = commitRepoUrl(commit.repo)}
            {@const shaHref = commitShaUrl(commit)}
            {@const referenceHref = shaHref ? null : commitReferenceUrl(commit)}
            <li class="activity-commit">
              {#if repoHref}
                <a
                  class="activity-commit-repo"
                  href={repoHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={commitRepoLinkLabel(commit.repo)}
                >{commit.repo}</a>
              {:else}
                <span class="activity-commit-repo">{commit.repo}</span>
              {/if}
              {#if shaHref}
                <a
                  class="activity-commit-message"
                  href={shaHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={commit.message}
                  aria-label={commitShaLinkLabel(commit.message, commit.sha)}
                >{commit.message}</a>
              {:else if referenceHref}
                <a
                  class="activity-commit-message"
                  href={referenceHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={commit.message}
                  aria-label={commitReferenceLinkLabel(commit.message)}
                >{commit.message}</a>
              {:else}
                <span class="activity-commit-message" title={commit.message}>{commit.message}</span>
              {/if}
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

  /* Five rows at the 44px touch floor (issue 157: two cells in every row are
     now real navigation, and AGENTS.md's touch-target floor applies to a
     link exactly as it does to a button — there is no "it is small text"
     exception). The row grew from 1.125rem to 2.75rem to make that floor
     real rather than decorative; the list's own fixed block-size grew with
     it, five times over, so the box is still reserved up front and nothing
     here shifts when the payload lands — the reservation is simply taller
     than it used to be. */
  .activity-commits {
    margin: 0;
    padding: 0;
    list-style: none;
    block-size: 13.75rem;
    overflow: hidden;
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .activity-commit {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.5rem;
    min-block-size: 2.75rem;
    white-space: nowrap;
  }

  /* min-block-size plus a matching line-height is what makes the touch floor
     real without reaching for flex: a grid item is blockified regardless of
     whether it renders as <a> or <span> (the validated-vs-fallback branch),
     so both variants of a cell claim the same 44px box and the same vertical
     centering, and a row never changes height depending on which branch a
     given entry took. min-inline-size covers the OTHER axis the block-size
     fix left open (issue 157 follow-up): a valid one-character repo slug —
     "a" is admitted by isValidRepoSlug — has almost no intrinsic content
     width, and the grid's auto column sizes to that content absent a floor,
     so the shortest admitted slug rendered a ~7px-wide anchor even though
     the row's height already cleared 44px. The floor sits well under
     max-inline-size, so it only ever WIDENS a column that content already
     starves; every realistic repo name is wider than 2.75rem on its own and
     is unaffected. */
  .activity-commit-repo {
    color: var(--activity-repo, var(--panel-accent, rgb(220, 138, 0)));
    max-inline-size: 9rem;
    min-inline-size: 2.75rem;
    min-block-size: 2.75rem;
    line-height: 2.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    text-decoration: none;
  }

  .activity-commit-message {
    color: var(--panel-text, rgb(230, 230, 230));
    min-block-size: 2.75rem;
    line-height: 2.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    text-decoration: none;
  }

  /* A row that is not a link (the fallback <span> for an entry this document
     cannot vouch for) never reaches these rules — only a real <a> gets the
     hover/focus affordance, so nothing here implies navigation the payload
     did not earn. The outline sits INSIDE the border box (a negative offset)
     because both elements clip their own overflow for the ellipsis above,
     and a ring drawn outside that box would be cropped by the same rule that
     makes the truncation work. */
  a.activity-commit-repo:hover,
  a.activity-commit-repo:focus-visible,
  a.activity-commit-message:hover,
  a.activity-commit-message:focus-visible {
    text-decoration: underline;
  }

  a.activity-commit-repo:focus-visible,
  a.activity-commit-message:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }

  .activity-commit-age {
    color: var(--panel-muted, rgb(158, 158, 158));
  }
</style>
