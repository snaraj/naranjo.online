<!-- WorkSection is the first section of the stacked page (owner directive,
  issue 134): two placeholder roles, each a heading, a location line, and a
  short paragraph.

  Each entry is the shared FeedCard primitive — the same object the art feed
  and the projects feed are built from — with the role as its title and the
  location as its byline. Nothing here styles a card: every border, radius,
  padding and type step comes from the --card-* tokens in styles.css, so this
  section moves with the rest of the page when one of them changes.

  The copy is placeholder and the section says so out loud. That note is not
  decoration — the honest-states floor is what stops a page from presenting
  Latin under a real name as though it described a real job, and a reader who
  cannot see the Latin (a screen reader announcing the heading and moving on)
  gets the same warning a sighted reader does. -->
<script lang="ts">
  import FeedCard from './FeedCard.svelte';
  import { workEntries, workPlaceholderNote } from '../work.ts';
</script>

<section class="page-section" id="work" aria-labelledby="work-title">
  <h2 class="section-title" id="work-title">Work</h2>
  <p class="section-note">{workPlaceholderNote}</p>
  <ol class="work-feed">
    {#each workEntries as entry (entry.title)}
      <li class="work-entry" data-placeholder="true">
        <FeedCard title={entry.title} byline={entry.location} titleLevel={3}>
          <p class="work-summary">{entry.summary}</p>
        </FeedCard>
      </li>
    {/each}
  </ol>
</section>

<style>
  .work-feed {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: var(--feed-gap);
  }

  .work-summary {
    margin: 0;
    max-inline-size: var(--card-measure);
  }
</style>
