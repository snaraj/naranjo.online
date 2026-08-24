<!-- PageHeader carries the page's chrome: the reading mode and the refresh,
  together, small and icon-only, in the top-end corner of the document flow.

  Both, and together, is an owner directive (issue 127). The refresh used to
  head the panel stack — attached to the trackers it acts on — while the
  reading mode sat up here alone, which put one control above the centered
  title and the other below it, stacked vertically around the page's name.
  Scope was the argument for splitting them and it lost to what the
  arrangement actually looked like: two lonely buttons flanking the heading.
  One corner holds both, and the h1 between them is uncluttered.

  Flow is still the point. This row is in the document, not fixed to the
  viewport: the reading-mode control used to be fixed chrome with an inline
  offset that included the side rail's gutter, so it slid sideways every time
  a panel opened or closed — a control that moves when the visitor touches
  something else reads as broken, and no fixed position is correct in both
  states. Here there is no gutter to track and nothing to drift.

  The reading mode is LAST, so it is the rightmost control and its popover —
  which opens from this widget's end edge — stays inside the page instead of
  hanging off it. The static shell reserves this row's height, so the controls
  arriving at hydration fill space the document already held open. -->
<script lang="ts">
  import RefreshAll from './RefreshAll.svelte';
  import ThemeMenu from '../ThemeMenu.svelte';
</script>

<header class="page-header">
  <RefreshAll />
  <ThemeMenu />
</header>
