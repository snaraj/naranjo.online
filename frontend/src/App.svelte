<script lang="ts">
  import PageHeader from './lib/components/PageHeader.svelte';
  import RefreshAll from './lib/components/RefreshAll.svelte';

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
  <h1 id="page-title">Hello World!</h1>

  <!-- The panels are one centered column, each a self-contained tracker
    stacked below the last: OSRS stats, then version-control activity, then
    token usage, then whatever lands next. They used to live in a fixed
    right-hand rail and a bottom-docked bar that overlaid the page and had to
    reserve gutters so the hero cleared them; now they flow in the document,
    so adding a tracker is one mount line and the page grows to fit it with
    no gutter arithmetic and nothing to overlap. -->
  <div class="panel-stack">
    <!-- The trackers' own control, at the head of the stack it acts on: one
      refresh for all of them, never one per card. -->
    <RefreshAll />
    <!-- panels:mount:begin -- exactly one line per panel, anywhere between the fences -->
    <BossLog />
    <ActivityBar />
    <TokenUsagePanel />
    <!-- panels:mount:end -->
  </div>
</main>
