<!-- RefreshAll is the trackers' own control: ONE button that re-reads every
  mounted tracker at once. It sits at the head of the stack, attached to the
  cards it acts on, rather than in the page header — the page header is for
  controls that act on the document, and a refresh acts on the data.

  One button, not one per card. Every tracker used to carry its own refresh in
  its heading, which put a control the visitor rarely wants beside the title
  they always read, three times over, and made "refresh" look like a
  per-tracker decision when in practice it is one gesture: bring everything up
  to date. The per-card freshness READING stays exactly where it was — each
  card still says, honestly, how old its own data is — because that genuinely
  is per-tracker information.

  The read rides each tracker's existing single-flight watcher, so pressing
  this costs the origin at most one request per mounted tracker however hard
  it is pressed, and it resolves only when the slowest of them has settled. -->
<script lang="ts">
  import { refreshPanels } from '../panels';

  let busy = $state(false);

  async function refresh(): Promise<void> {
    if (busy) {
      return;
    }
    busy = true;
    try {
      await refreshPanels();
    } finally {
      /* Released in a finally: a read that fails still resolves as the honest
         unavailable envelope loadPanel produces, and a control that could
         latch busy forever would be its own defect. */
      busy = false;
    }
  }
</script>

<div class="refresh-all">
  <button
    type="button"
    class="icon-button"
    aria-label="Refresh all trackers"
    aria-busy={busy}
    title="Refresh all trackers"
    disabled={busy}
    onclick={refresh}
  >
    <svg class="refresh-glyph" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M20 12a8 8 0 1 1-2.34-5.66"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
      />
      <path
        d="M20 3.5V9h-5.5"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </button>
</div>

<style>
  .refresh-all {
    display: flex;
    justify-content: flex-end;
  }

  @media (prefers-reduced-motion: no-preference) {
    .refresh-glyph {
      /* Only while a read is genuinely in flight; the control is disabled for
         exactly that long, so the motion and the disabled state cannot
         disagree about whether anything is happening. */
      animation: refresh-all-spin 900ms linear infinite;
      animation-play-state: paused;
    }

    :global(.icon-button[aria-busy='true']) .refresh-glyph {
      animation-play-state: running;
    }

    @keyframes refresh-all-spin {
      to {
        transform: rotate(360deg);
      }
    }
  }

  /* Reduced motion still needs an in-flight signal, so the busy state dims
     the glyph instead of spinning it. */
  @media (prefers-reduced-motion: reduce) {
    :global(.icon-button[aria-busy='true']) .refresh-glyph {
      opacity: 0.4;
    }
  }
</style>
