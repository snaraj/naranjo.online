<script lang="ts">
  import ThemeMenu from './lib/ThemeMenu.svelte';

  /* Panel mount imports. One import line per panel, matching the one mount
     line inside the panels-mount fences below. Sibling changes insert their
     line anywhere between a fence pair so parallel additions merge cleanly. */
  /* panels:imports:begin -- exactly one import line per panel */
  /* panels:imports:end */
</script>

<svelte:head>
  <meta
    name="description"
    content="naranjo.online, served from a Raspberry Pi Kubernetes cluster."
  />
</svelte:head>

<ThemeMenu />

<main aria-labelledby="page-title">
  <h1 id="page-title">Hello World!</h1>
</main>

<div class="panels-mount">
  <!-- panels:mount:begin -- exactly one line per panel, anywhere between the fences -->
  <!-- panels:mount:end -->
</div>
