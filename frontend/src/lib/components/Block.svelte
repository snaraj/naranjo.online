<!-- Block is the host that turns one manifest entry into one rendered
  component (issue 165). It is the ONLY place the three layers meet at
  runtime: the binding names an information source, the adapter shapes that
  source's payload into props, and the component renders the props — this
  file merely holds the three together and adds nothing of its own. No
  markup, no styles, no domain knowledge.

  A static binding renders immediately: its props are data the build already
  carries. A panel binding subscribes through watchPanel — the same
  visibility-aware delivery every panel has always used — and re-runs its
  adapter on every envelope; until the first envelope arrives the adapter
  answers null and the block renders nothing, which is the honest state for
  a card whose data has not spoken yet (each tracker's adapter decides what
  its own loading face is; returning props for a null envelope IS that
  face). -->
<script lang="ts">
  import type { PageBlock } from '../blocks.ts';
  import { watchPanel, type PanelEnvelope } from '../panels';

  let { block }: { block: PageBlock } = $props();

  let envelope = $state<PanelEnvelope | null>(null);

  $effect(() => {
    if (block.binding.source !== 'panel') {
      return;
    }
    return watchPanel(block.binding.panelId, (loaded) => (envelope = loaded));
  });

  /* Named `rendered` rather than `props`: svelte-check's generated module
     already binds that identifier, and shadowing it is a compile error. */
  const rendered = $derived(
    block.binding.source === 'panel' ? block.binding.adapt(envelope) : block.binding.props
  );
</script>

{#if rendered !== null}
  {@const This = block.component}
  <This {...rendered} />
{/if}
