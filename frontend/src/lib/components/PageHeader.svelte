<!-- PageHeader carries the page's chrome: the reading mode, small and
  icon-only, in the top-end corner.

  It used to carry a second control, a manual "refresh all trackers" button,
  which is gone (owner directive, issue 179): the site is responsive on its
  own, and a data-retrieval failure now logs an error (see panels.ts'
  loadPanel) rather than waiting on a visitor to notice and press something.
  That was also the last reason this row needed to reserve room for two
  icons side by side — one now fills it.

  The static shell reserves this row's height, so the control arriving at
  hydration fills space the document already held open. -->
<script lang="ts">
  import ThemeMenu from '../ThemeMenu.svelte';
</script>

<header class="page-header">
  <ThemeMenu />
</header>
