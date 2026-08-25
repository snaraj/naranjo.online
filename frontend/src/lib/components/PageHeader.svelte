<!-- PageHeader carries the page's chrome: the reading mode, small and
  icon-only, pinned to the viewport's top-end corner (owner directive, issue
  168) — OUTSIDE the feed column and independent of its width, so dragging
  the feed never moves it. It used to sit IN the document flow, taking the
  column's own width; the fixed position (styles.css, since the static shell
  renders the same empty row before any icon hydrates into it) is what
  removes that coupling at its cause, rather than picking a different offset
  for the drift to reappear in.

  It used to carry a second control, a manual "refresh all trackers" button,
  which is gone (owner directive, issue 179): the site is responsive on its
  own, and a data-retrieval failure now logs an error (see panels.ts'
  loadPanel) rather than waiting on a visitor to notice and press something.
  That was also the last reason this row needed to reserve room for two
  icons side by side — one now fills it. -->
<script lang="ts">
  import ThemeMenu from '../ThemeMenu.svelte';
</script>

<header class="page-header">
  <ThemeMenu />
</header>
