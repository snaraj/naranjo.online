<!-- DetailTip is the page's ONE hover-detail primitive (owner directive,
  issue 136 rule 1: one card object, not per-section markup — and the same
  rule applies to the readout that hangs off one).

  It exists because there were two of them, and only one was any good. The
  boss tiles had a designed detail — the row's name in the brand orange,
  then its figures as labelled rows — while the skill tiles had a bare
  `title=` attribute, which is the browser's own tooltip: no styling, no
  tokens, a half-second delay before it appears, and a shape that varies by
  operating system. The owner asked for the two to be ALIGNED rather than for
  the better one to be copied, so there is now one component and both call
  sites render it.

  CONTENT IS DATA, NOT MARKUP. A caller passes a TipDetail — a name and a
  list of labelled rows — and this component decides how a detail LOOKS. That
  is what makes "the skill tip and the boss tip are the same object" a
  property rather than a resemblance: a change to the presentation moves both,
  and there is no second implementation to forget. Every field is interpolated
  as TEXT; nothing here renders markup from a payload, so a hostile row name
  arriving from the hiscores is inert by construction rather than by escaping.

  EVERY VISUAL DIMENSION IS A TOKEN (issue 136 rule 3), including the two the
  BEHAVIOUR reads: --tip-pointer-gap is how far the box sits from the cursor
  and --tip-edge-margin is how close to a viewport edge it may come, so the
  feel of the thing is tunable from the token layer exactly like its padding.
  Nothing below states a color, a length or a weight.

  WHERE IT GOES is lib/tooltip.ts, which explains the position: fixed anchor
  and why it replaced the per-column absolute one. The action is applied here
  rather than at the call site so rendering the primitive is the WHOLE of
  adding a detail — a caller that had to remember a second step is a caller
  that eventually does not. -->
<script lang="ts">
  import { hoverDetail, type TipDetail } from '../tooltip.ts';

  let {
    detail
  }: {
    /* The row this detail describes: its name, and its figures as labelled
       rows. Built by pure functions beside the data they read (bossDetail,
       skillDetail and summaryDetail in lib/bossLog.ts), so the grammar the
       two grids share is executed by tests rather than repeated in markup. */
    detail: TipDetail;
  } = $props();

  /* Whether the box is showing. It is the component's own state rather than
     an attribute the action writes, so the reveal rule below is a selector
     the compiler can see; a runtime-only attribute is a rule Svelte prunes
     as unused, which is a detail that never appears and a green build. The
     action reports into it from the pointer handler, and the update lands in
     the same task's microtask checkpoint — before the frame paints, which is
     the responsiveness the owner asked to keep. */
  let open = $state(false);
</script>

<!-- aria-hidden because the tile itself already carries every figure below in
  its accessible name: a reader who cannot see the box hears the row once,
  not twice. The tip is the SIGHTED reader's copy of that same text. -->
<span
  class="cell-tip"
  role="tooltip"
  aria-hidden="true"
  data-tip-open={open}
  use:hoverDetail={(next) => (open = next)}
>
  <span class="cell-tip-name">{detail.name}</span>
  {#each detail.rows as row (row.label)}
    <span class="cell-tip-row">{row.label}: {row.value}</span>
  {/each}
</span>

<style>
  /* Fixed, not absolute. The containing block is the viewport, so no
     ancestor's overflow can clip this box and no position it takes can grow
     the document — which is the guarantee the per-column anchoring it
     replaced existed to provide, now held at every edge instead of only the
     inline ones. --tip-x/--tip-y are written by the action; the fallbacks are
     what a document renders with before the first pointer event, never a
     position anything is shown at. */
  .cell-tip {
    position: fixed;
    left: var(--tip-x);
    top: var(--tip-y);
    z-index: var(--tip-layer);
    display: flex;
    flex-direction: column;
    gap: var(--tip-gap);
    /* Sized by its content and bounded by the viewport, claiming no minimum:
       the narrowest phone this site supports is the width it must fit. */
    inline-size: max-content;
    max-inline-size: var(--tip-max-inline-size);
    padding: var(--tip-padding);
    background: var(--tip-surface);
    border: var(--tip-border-width) var(--tip-border-style) var(--tip-border-color);
    border-radius: var(--tip-radius);
    font-size: var(--tip-size);
    line-height: var(--tip-leading);
    color: var(--tip-ink);
    visibility: hidden;
    opacity: 0;
    /* The box follows the cursor, so it is the one element on the page that
       must never be able to receive it: a tip that could be hovered would
       take the pointer off the tile that opened it, close itself, hand the
       pointer back, and flicker. It is also why the reveal below can be a
       single attribute rather than a hover state with hysteresis. */
    pointer-events: none;
  }

  /* Reveal is an attribute the action sets, in the same task as the pointer
     event that caused it, so the box appears in the frame the pointer entered
     rather than after one. There is deliberately no transition: the owner
     asked for the responsiveness to be kept, and a fade is a frame of
     latency a reader can feel. Nothing here animates, so there is nothing for
     a reduced-motion preference to have to switch off. */
  .cell-tip[data-tip-open='true'] {
    visibility: visible;
    opacity: 1;
  }

  /* The row's name, in the one chromatic token the panel layer carries. */
  .cell-tip-name {
    font-weight: var(--tip-title-weight);
    color: var(--tip-title-ink);
  }

  /* A figure squeezed by a very narrow viewport wraps rather than being
     clipped: the tip is the place the full number is supposed to survive. */
  .cell-tip-row {
    overflow-wrap: anywhere;
  }
</style>
