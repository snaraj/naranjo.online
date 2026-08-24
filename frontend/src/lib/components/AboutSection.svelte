<!-- AboutSection closes the stacked page (owner directive, issue 134). The nav
  names four sections, so all four have to exist and land somewhere real; this
  one exists and has nothing in it yet.

  What it renders is therefore an honest empty state, not filler. Nothing here
  describes the owner, because no copy has been written and a section that
  invented a biography to look finished would be the exact failure the honest
  states floor is about — the panels serve an explicit unavailable state rather
  than a plausible number, and a page section is held to the same standard.

  It is already a feed card, in the flat variant: no frame, because a bordered
  box around one sentence would announce itself as content. When the copy is
  written it goes into the card that is already here, and gaining a title, a
  date or a picture is data rather than surgery. -->
<script lang="ts">
  import FeedCard from './FeedCard.svelte';
</script>

<section class="page-section" id="about" aria-labelledby="about-title">
  <h2 class="section-title" id="about-title">About Me</h2>
  <FeedCard variant="flat">
    <p class="section-empty">This section has not been written yet.</p>
  </FeedCard>
</section>

<style>
  .section-empty {
    margin: 0;
    max-inline-size: var(--card-measure);
    color: var(--card-meta-ink);
  }
</style>
