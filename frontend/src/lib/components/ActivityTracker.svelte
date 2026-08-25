<!-- ActivityTracker renders one activity feed inside the shared PanelShell:
  headline figures, a contribution strip, and a short log of linked entries.
  It is a generic primitive with NO domain knowledge — every heading, noun,
  figure, link and label arrives through ActivityTrackerProps
  (lib/blocks.ts), built by an adapter in the binding layer. The
  version-control block renders it today; a workout log renders it tomorrow
  without an edit here.

  The heading is whatever the adapter supplies, and for the version-control
  block that is whatever the ORIGIN calls the panel: the owner's rename
  (issue 127) lives in the origin's config data, because neither this file
  nor the adapter may spell a service's name — both sides are pinned against
  it, so swapping where the data comes from is a data edit and never a code
  edit.

  The strip renders through ContributionGrid, the same component the usage
  tracker's heatmap uses, so the two grids cannot drift. Shaped, not styled,
  like every panel: colors and metrics read custom properties with
  dark-native defaults, so the theme layer restyles by overriding variables
  and never edits this component.

  Every region has a fixed block size, so data arriving never shifts layout,
  and a wide window scrolls inside the grid, never the page.

  An entry row is real navigation exactly where the information layer could
  vouch for a destination (issue 157): each half of a row arrives as an
  ActivityLink whose href is already validated — or null, in which case the
  text renders as the plain text it always was rather than as a link nobody
  addressed. This component builds no URL and interpolates no payload into an
  href; it renders the link it is handed or it renders text. Text stays text
  either way: neither branch below renders payload data as markup. -->
<script lang="ts">
  import PanelShell from './PanelShell.svelte';
  import ContributionGrid from './ContributionGrid.svelte';
  import type { ActivityTrackerProps } from '../blocks.ts';

  let {
    title,
    status,
    generatedAt,
    figures,
    figuresNote,
    strip,
    entries,
    entriesNote
  }: ActivityTrackerProps = $props();
</script>

<aside class="activity-tracker" data-activity-panel>
  <PanelShell {title} {status} {generatedAt}>
    <div class="activity">
      <p class="activity-totals">
        {#if figures.length > 0}
          {#each figures as figure (figure.key)}
            <span><strong>{figure.lead}</strong>{figure.rest}</span>
          {/each}
        {:else}
          <span class="activity-empty">{figuresNote}</span>
        {/if}
      </p>
      <ContributionGrid
        columns={strip.columns}
        noun={strip.noun}
        label={strip.label}
        emptyNote={strip.emptyNote}
      />
      <ol class="activity-entries">
        {#if entries.length === 0}
          <!-- An empty log is the truthful state rather than a gap to fill
            with invented history. -->
          <li class="activity-entry activity-empty">{entriesNote}</li>
        {:else}
          {#each entries as entry}
            <li class="activity-entry">
              {#if entry.source.href}
                <a
                  class="activity-entry-source"
                  href={entry.source.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={entry.source.label}
                >{entry.source.text}</a>
              {:else}
                <span class="activity-entry-source">{entry.source.text}</span>
              {/if}
              {#if entry.title.href}
                <a
                  class="activity-entry-title"
                  href={entry.title.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={entry.title.text}
                  aria-label={entry.title.label}
                >{entry.title.text}</a>
              {:else}
                <span class="activity-entry-title" title={entry.title.text}>{entry.title.text}</span>
              {/if}
              <span class="activity-entry-age">{entry.age}</span>
            </li>
          {/each}
        {/if}
      </ol>
    </div>
  </PanelShell>
</aside>

<style>
  /* An ordinary block in the page's tracker stack. The stack owns the column
     width and the gap between cards, so this panel declares neither: the one
     thing that used to make its predecessor special — being fixed — is
     exactly what made it fight the page, and the gutter token, the
     self-imposed height bound, and the narrow-viewport branch that existed
     only to undo the docking all left with it. */
  .activity-tracker {
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

  /* Five rows at the 44px touch floor (issue 157: two cells in every row can
     be real navigation, and AGENTS.md's touch-target floor applies to a link
     exactly as it does to a button — there is no "it is small text"
     exception). The row grew from 1.125rem to 2.75rem to make that floor
     real rather than decorative; the list's own fixed block-size grew with
     it, five times over, so the box is still reserved up front and nothing
     here shifts when the payload lands — the reservation is simply taller
     than it used to be. */
  .activity-entries {
    margin: 0;
    padding: 0;
    list-style: none;
    block-size: 13.75rem;
    overflow: hidden;
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .activity-entry {
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
     fix left open (issue 157 follow-up): a valid one-character source name —
     the shortest string the information layer's validators admit — has
     almost no intrinsic content width, and the grid's auto column sizes to
     that content absent a floor, so the shortest admitted name rendered a
     ~7px-wide anchor even though the row's height already cleared 44px.
     The floor sits well under
     max-inline-size, so it only ever WIDENS a column that content already
     starves; every realistic source name is wider than 2.75rem on its own
     and is unaffected. */
  .activity-entry-source {
    color: var(--activity-source-ink, var(--panel-accent, rgb(220, 138, 0)));
    max-inline-size: 9rem;
    min-inline-size: 2.75rem;
    min-block-size: 2.75rem;
    line-height: 2.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    text-decoration: none;
  }

  .activity-entry-title {
    color: var(--panel-text, rgb(230, 230, 230));
    min-block-size: 2.75rem;
    line-height: 2.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    text-decoration: none;
  }

  /* A row that is not a link (the fallback <span> for an entry the
     information layer could not vouch for) never reaches these rules — only
     a real <a> gets the hover/focus affordance, so nothing here implies
     navigation the payload did not earn. The outline sits INSIDE the border
     box (a negative offset) because both elements clip their own overflow
     for the ellipsis above, and a ring drawn outside that box would be
     cropped by the same rule that makes the truncation work. */
  a.activity-entry-source:hover,
  a.activity-entry-source:focus-visible,
  a.activity-entry-title:hover,
  a.activity-entry-title:focus-visible {
    text-decoration: underline;
  }

  a.activity-entry-source:focus-visible,
  a.activity-entry-title:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }

  .activity-entry-age {
    color: var(--panel-muted, rgb(158, 158, 158));
  }
</style>
