<!-- PageHeader carries the one control that acts on the whole DOCUMENT rather
  than on any of its content: the reading mode. It sits alone in the top-end
  corner, in the document flow.

  Flow is the point. The reading-mode control used to be fixed to the viewport
  with an inline offset that included the side rail's gutter, so it slid
  sideways every time a panel opened or closed — a control that moves when the
  visitor touches something else reads as broken, and no fixed position is
  correct in both states. Here there is no gutter to track and nothing to
  drift.

  The refresh control deliberately does NOT live here. It acts on the
  trackers, not on the page, so it belongs to the stack (see RefreshAll) —
  putting the two side by side implied they had the same scope. The static
  shell reserves this row's height, so the control arriving at hydration
  fills space the document already held open. -->
<script lang="ts">
  import ThemeMenu from '../ThemeMenu.svelte';
</script>

<header class="page-header">
  <ThemeMenu />
</header>
