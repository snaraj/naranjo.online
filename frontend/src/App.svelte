<script lang="ts">
  import PageHeader from './lib/components/PageHeader.svelte';

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

<main aria-labelledby="page-title">
  <h1 id="page-title">Samuel Naranjo</h1>

  <!-- The panels are the page's content: each a self-contained tracker —
    OSRS stats, then the version-control calendar, then token usage, then
    whatever lands next. They used to live in a fixed right-hand rail and a
    bottom-docked bar that overlaid the page and had to reserve gutters so the
    hero cleared them; now they flow in the document, so adding a tracker is
    one mount line and the page grows to fit it with no gutter arithmetic and
    nothing to overlap.

    The stack holds ONLY panels. Both page-level controls — the reading mode
    and the refresh — sit together in the header's top-end corner (owner
    directive, issue 127): the refresh used to head this stack, which put one
    control above the centered title and the other beside it, so the two read
    as unrelated chrome flanking the page's name. -->
  <div class="panel-stack">
    <!-- panels:mount:begin -- exactly one line per panel, anywhere between the fences -->
    <BossLog />
    <ActivityBar />
    <TokenUsagePanel />
    <!-- panels:mount:end -->
  </div>
</main>
