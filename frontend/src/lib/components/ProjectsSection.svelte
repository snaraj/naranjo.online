<!-- ProjectsSection is the Projects section of the stacked page, in two halves
  the owner named (issue 134): Art first, then Coding Projects.

  ART is the gallery component below — a feed of eight deliberately heavy
  placeholder photographs served by the origin's media route, never carried in
  this repository.

  CODING PROJECTS is a feed of the owner's six public repositories: each one's
  name as the link to it, the description the repository itself carries, and its
  commit and star counts as a glyph beside a figure. Both feeds are built from
  the same FeedCard primitive — this one supplies its own header region,
  because a link with two counters beside it is not something a title string can
  express, and that is exactly what the header snippet is for.

  The static Coding Projects rows are not fetched from GitHub; no code
  automatically requests projectHost; the validated GitHub URLs are used
  only for visitor-activated navigation. They are data in lib/projects.ts,
  captured out of band on a stated date (projectsCapturedOn) — requirement 1
  keeps this frontend local-origin-only and live refresh is off by default.
  A visitor-facing caption used to spell out the capture date and the
  network posture in prose; the owner removed both (issue 167), because
  provenance and how the data got here are maintainer/reviewer facts, not
  something a visitor came to this page to read. The underlying guarantee
  the caption used to describe is unchanged and stays ENFORCED regardless —
  by the structural no-transport-primitive / no-runtime-fetch tests
  (`frontend/tests/sections.test.mjs`) that scope to THIS section, never by
  a sentence on the page (Daybreak Blue's review of this pull request,
  round 4, finding 1: two earlier wordings here both overstated the
  invariant — first "no remote origin anywhere in frontend source," then
  "nothing in this tree ISSUES a request," the second still false because
  ActivityBar.svelte, a separate consumer of the same `projectHost`, calls
  `watchPanel`, whose production default DOES call `fetch`; this wording
  claims nothing beyond what this section itself does). projectsCapturedOn
  remains the maintenance record for when the six counts below were
  captured; it is simply no longer printed. The repository addresses reach
  the DOM only as href values — real outbound navigation targets a visitor
  may follow, never a request this section's own code makes itself.

  The glyphs are drawn here, in the same language as the page's own chrome — a
  24-unit box, currentColor, round caps — rather than vendored from anyone's
  icon set: a third-party mark would need its license reviewed and its
  attribution recorded, and none of that buys a reader anything a plain glyph
  does not. Every glyph is decorative: the figure and the word it counts are
  rendered as text beside it, so nothing on this card is carried by a picture
  alone. -->
<script lang="ts">
  import ArtGallery from './ArtGallery.svelte';
  import FeedCard from './FeedCard.svelte';
  import { artNote, artProvenance } from '../art.ts';
  import { projectCounts, projectLinkLabel, projects, projectUrl } from '../projects.ts';
</script>

<section class="page-section" id="projects" aria-labelledby="projects-title">
  <h2 class="section-title" id="projects-title">Projects</h2>

  <div class="page-subsection">
    <h3 class="subsection-title">Art</h3>
    <p class="subsection-intro">{artNote}</p>
    <p class="section-note">{artProvenance}</p>
    <ArtGallery />
  </div>

  <div class="page-subsection">
    <h3 class="subsection-title">Coding Projects</h3>
    <ul class="project-feed">
      {#each projects as project (project.name)}
        <li>
          <FeedCard variant="compact">
            {#snippet header()}
              <div class="project-head">
                <h4 class="project-heading">
                  <a
                    class="project-link"
                    href={projectUrl(project)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={projectLinkLabel(project)}
                  >
                    <svg class="project-glyph" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        d="M9.5 7 4.5 12l5 5"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                      <path
                        d="M14.5 7l5 5-5 5"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                    <span class="project-name">{project.name}</span>
                  </a>
                </h4>
                <ul class="project-counts">
                  {#each projectCounts(project) as count (count.kind)}
                    <li class="project-count">
                      {#if count.kind === 'commits'}
                        <svg class="project-glyph" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                          <circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="2" />
                          <path
                            d="M3.5 12h5.1M15.4 12h5.1"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                          />
                        </svg>
                      {:else}
                        <svg class="project-glyph" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                          <path
                            d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"
                            fill="currentColor"
                          />
                        </svg>
                      {/if}
                      <span class="project-count-text">{count.label}</span>
                    </li>
                  {/each}
                </ul>
              </div>
            {/snippet}
            <p class="project-description">{project.description}</p>
          </FeedCard>
        </li>
      {/each}
    </ul>
  </div>
</section>

<style>
  .project-feed {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: var(--feed-gap);
  }

  /* The counts sit at the row's end edge on a wide column and wrap under the
     name on a narrow one; nothing here is pinned to a width, so the wrap
     happens when the content needs it rather than at a guessed breakpoint. */
  .project-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--card-meta-gap);
  }

  .project-heading {
    margin: 0;
    font-family: var(--card-title-family);
    font-size: var(--card-meta-size);
    font-weight: var(--card-title-weight);
  }

  /* The link is the whole touch target: 44px of block size from the floor,
     with the padding pulled back on the inline start so the glyph still lines
     up with the description under it. The size is a MINIMUM rather than a
     fixed box — a reader who enlarges their base font gets a taller target,
     never a clipped one. */
  .project-link {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-block-size: 2.75rem;
    min-inline-size: 2.75rem;
    padding-inline-end: 0.5rem;
    color: var(--card-ink);
    text-decoration-color: var(--color-border-strong);
    text-underline-offset: 0.2em;
  }

  .project-link:hover .project-name,
  .project-link:focus-visible .project-name {
    color: var(--color-brand);
  }

  .project-link:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .project-glyph {
    flex: none;
    color: var(--card-meta-ink);
  }

  .project-name {
    /* A repository name is one token and must not be broken across lines by a
       hyphen the name does not have; on a 320px card it scrolls nothing
       because the flex row is allowed to shrink under it. */
    overflow-wrap: anywhere;
    font-size: var(--card-title-size);
    letter-spacing: var(--card-title-tracking);
  }

  .project-counts {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--card-meta-gap);
  }

  .project-count {
    display: inline-flex;
    align-items: center;
    gap: 0.3125rem;
    font-size: var(--card-meta-size);
    font-variant-numeric: tabular-nums;
    color: var(--card-meta-ink);
  }

  .project-count-text {
    white-space: nowrap;
  }

  .project-description {
    margin: 0;
    max-inline-size: var(--card-measure);
    font-size: var(--card-meta-size);
    line-height: var(--card-body-leading);
  }
</style>
