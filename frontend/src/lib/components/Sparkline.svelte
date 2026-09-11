<!-- Sparkline is the page's daily line (owner directive, 2026-09-11): one
  series, drawn edge to edge along the bottom of whatever card hands it one.

  IT COMPUTES NOTHING. Every coordinate comes from sparklinePath in lib/spark.ts,
  which node executes directly, so a day nobody measured, a window of nothing
  but zeros and a single-day series are decided in a unit test rather than in a
  browser. A series with nothing plottable renders no chart at all — the card
  keeps its figures and simply has no line, which is the honest-states floor at
  the one place a chart would otherwise draw a flat line along its own floor
  and look like a measurement.

  IT NAMES NOTHING EITHER. The accessible label arrives written, from an
  adapter that knows which source it read; this component knows only that it
  was handed some numbers and a name for them. The figures printed above the
  line are the non-colour channel the dataviz floor asks for, which is why the
  drawing carries no axis, no caption and no legend.

  THE BOX IS SQUASHED, THE STROKE AND THE MARK ARE NOT. The SVG is
  `preserveAspectRatio="none"` so the line spans the card at any width; the
  stroke keeps its own thickness through `vector-effect`, and the mark on the
  newest reading is a real element positioned in percentages rather than a
  circle inside the squashed space, which would be an ellipse whose
  eccentricity is the card's aspect ratio. -->
<script lang="ts">
  import type { LedgerSpark } from '../blocks.ts';
  import { sparkBox, sparklinePath } from '../spark.ts';

  let { totals, ariaLabel }: LedgerSpark = $props();

  const path = $derived(sparklinePath(totals, sparkBox));
  const viewBox = `0 0 ${sparkBox.width} ${sparkBox.height}`;
</script>

{#if path}
  <span class="spark" role="img" aria-label={ariaLabel}>
    <svg class="spark-plot" {viewBox} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path class="spark-area" d={path.area} />
      <path class="spark-line" d={path.line} />
    </svg>
    <span
      class="spark-mark"
      style:--spark-mark-x={`${path.last.x}%`}
      style:--spark-mark-y={`${path.last.y}%`}></span>
  </span>
{/if}
