<script lang="ts">
  import PageHeader from './lib/components/PageHeader.svelte';
  import SectionNav from './lib/components/SectionNav.svelte';
  import WorkSection from './lib/components/WorkSection.svelte';
  import ProjectsSection from './lib/components/ProjectsSection.svelte';
  import AboutSection from './lib/components/AboutSection.svelte';

  /* Panel mount imports. One import line per panel, matching the one mount
     line inside the panels-mount fences below. Sibling changes insert their
     line anywhere between a fence pair so parallel additions merge cleanly. */
  /* panels:imports:begin -- exactly one import line per panel */
  import BossLog from './lib/components/BossLog.svelte';
  import TokenUsagePanel from './lib/components/TokenUsagePanel.svelte';
  import ActivityBar from './lib/components/ActivityBar.svelte';
  /* panels:imports:end */
</script>

<svelte:head>
  <meta
    name="description"
    content="naranjo.online, served from a Raspberry Pi Kubernetes cluster."
  />
</svelte:head>

<PageHeader />

<!-- The page is ONE stacked column (owner directive, issue 134): the name, the
  section nav under it, then every section top to bottom in the order the nav
  lists them. It used to tile its panels across the whole viewport, which the
  owner rejected in favour of a single centred container — a wider one than the
  30rem ribbon that arrangement replaced, which is why the column token grew
  rather than reverting.

  The sections are components rather than markup here for the same reason the
  panels are: this file stays a table of contents, and a section's copy,
  structure and styling live with the section. -->
<main aria-labelledby="page-title">
  <div class="page-intro">
    <h1 id="page-title">Samuel Naranjo</h1>
    <SectionNav />
  </div>

  <WorkSection />
  <ProjectsSection />

  <!-- The trackers section holds the panel stack: each panel a self-contained
    tracker — OSRS stats, then the version-control calendar, then token usage,
    then whatever lands next. They used to be the page's whole content; they
    are one section of it now, and the nav names them.

    The stack holds ONLY panels. Both page-level controls — the reading mode
    and the refresh — sit together in the header's top-end corner (owner
    directive, issue 127): the refresh used to head this stack, which put one
    control above the centered title and the other beside it, so the two read
    as unrelated chrome flanking the page's name. -->
  <section class="page-section" id="trackers" aria-labelledby="trackers-title">
    <h2 class="section-title" id="trackers-title">Trackers</h2>
    <div class="panel-stack">
      <!-- panels:mount:begin -- exactly one line per panel, anywhere between the fences -->
      <BossLog />
      <ActivityBar />
      <TokenUsagePanel />
      <!-- panels:mount:end -->
    </div>
  </section>

  <AboutSection />
</main>
