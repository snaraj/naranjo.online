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
  face).

  A runtime binding (issue 207) is the third and the quietest: the build's
  own props render immediately — before any request exists — and are replaced
  only if a one-shot read answers with a complete replacement set. There is no
  loading state to render because nothing is ever waiting on anything: the
  first paint is already true. A read that answers null leaves the build's
  props exactly where they were, which is why an absent media volume looks
  like a gallery rather than like a fault. -->
<script lang="ts">
  import type { BlockProps, PageBlock } from '../blocks.ts';
  import { watchPanel, type PanelEnvelope } from '../panels';

  let { block }: { block: PageBlock } = $props();

  let envelope = $state<PanelEnvelope | null>(null);
  /* One slot per bound panel for a multi-panel block, in the binding's own
     order. Reassigned rather than mutated on every delivery, because a
     rune-tracked array is what tells the derived props below that one of its
     several sources answered. */
  let envelopes = $state<readonly (PanelEnvelope | null)[]>([]);
  let runtime = $state<BlockProps | null>(null);

  $effect(() => {
    if (block.binding.source !== 'panel') {
      return;
    }
    return watchPanel(block.binding.panelId, (loaded) => (envelope = loaded));
  });

  $effect(() => {
    const binding = block.binding;
    if (binding.source !== 'panels') {
      return;
    }
    /* Every panel is watched through the SAME watchPanel every single-panel
       block uses — the visibility-aware, never-stacking, last-good-on-failure
       delivery — so a block reading two panels is two ordinary subscriptions
       rather than a second retrieval path. The slots start null and stay in
       the binding's declared order, so the adapter always reads the same
       position for the same panel however the two deliveries interleave. */
    const slots: (PanelEnvelope | null)[] = binding.panelIds.map(() => null);
    envelopes = slots.slice();
    const stops = binding.panelIds.map((id, index) =>
      watchPanel(id, (loaded) => {
        slots[index] = loaded;
        envelopes = slots.slice();
      })
    );
    return () => {
      for (const stop of stops) {
        stop();
      }
    };
  });

  $effect(() => {
    const binding = block.binding;
    if (binding.source !== 'runtime') {
      return;
    }
    /* One read, and a mount flag rather than an AbortController: the load is
       a plain promise the binding owns, and a block torn down mid-flight must
       not write into a component that is gone. */
    let mounted = true;
    void binding.load().then((loaded) => {
      if (mounted && loaded !== null) {
        runtime = loaded;
      }
    });
    return () => {
      mounted = false;
    };
  });

  /* Named `rendered` rather than `props`: svelte-check's generated module
     already binds that identifier, and shadowing it is a compile error. */
  const rendered = $derived.by(() => {
    if (block.binding.source === 'panel') {
      return block.binding.adapt(envelope);
    }
    if (block.binding.source === 'panels') {
      return block.binding.adapt(envelopes);
    }
    if (block.binding.source === 'runtime') {
      return runtime ?? block.binding.fallback;
    }
    return block.binding.props;
  });
</script>

{#if rendered !== null}
  {@const This = block.component}
  <This {...rendered} />
{/if}
