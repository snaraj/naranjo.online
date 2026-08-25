<!-- EmptyNote renders one honest empty state: a single flat card carrying one
  sentence of muted text. It is a generic primitive with NO domain knowledge —
  the sentence arrives through EmptyNoteProps (lib/blocks.ts) from the block
  that has nothing to show yet.

  It exists because a section the nav names has to exist and land somewhere
  real, and a section that invented content to look finished would be the
  exact failure the honest-states floor is about — the panels serve an
  explicit unavailable state rather than a plausible number, and a page
  section is held to the same standard.

  It is already a feed card, in the flat variant: no frame, because a bordered
  box around one sentence would announce itself as content. When real copy is
  written, its block swaps this component for a fuller one in the manifest —
  data and one manifest line, rather than surgery. -->
<script lang="ts">
  import FeedCard from './FeedCard.svelte';
  import type { EmptyNoteProps } from '../blocks.ts';

  let { note }: EmptyNoteProps = $props();
</script>

<FeedCard variant="flat">
  <p class="empty-note">{note}</p>
</FeedCard>

<style>
  .empty-note {
    margin: 0;
    max-inline-size: var(--card-measure);
    color: var(--card-meta-ink);
  }
</style>
