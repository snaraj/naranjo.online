<!-- Sparkline is the page's daily line (owner directive, 2026-09-11): one
  series, drawn edge to edge along the bottom of whatever card hands it one,
  and SCRUBBED — a pointer, a finger or an arrow key along it names a day, and
  the card it sits in prints that day instead of its own lifetime (issue 316:
  "as I run the mouse through this hovering or clicking, I expected to see
  more information").

  IT COMPUTES NOTHING. Every coordinate comes from lib/spark.ts, which node
  executes directly, so a day nobody measured, a window of nothing but zeros,
  a single-day series and a pointer outside the box are all decided in a unit
  test rather than in a browser. A series with nothing plottable renders no
  chart at all — the card keeps its figures and simply has no line, which is
  the honest-states floor at the one place a chart would otherwise draw a flat
  line along its own floor and look like a measurement.

  IT NAMES NOTHING EITHER. The accessible label, every day's date and both of
  every day's figures arrive written, from an adapter that knows which source
  it read; this component knows only that it was handed some numbers, some
  words for them, and a name for the whole. The figures printed above the line
  are the non-colour channel the dataviz floor asks for, which is why the
  drawing carries no axis, no caption and no legend — and why the scrub adds
  no text of its own either.

  IT NEVER FIGHTS THE NATIVE SCROLL, and it does not decide that for itself:
  the whole pointer binding is lib/gesture.ts's scrubAlong, which is where
  this page keeps every rule about whose gesture a finger belongs to. The
  declaration that hands the vertical axis back — `touch-action: pan-y` — is
  in the sheet beside the rest of this chart's paint.

  THE BOX IS SQUASHED, THE STROKE AND THE MARKS ARE NOT. The SVG is
  `preserveAspectRatio="none"` so the line spans the card at any width; the
  stroke keeps its own thickness through `vector-effect`, and both dots — the
  mark on the newest reading and the scrubber's cursor — are real elements
  positioned in percentages rather than circles inside the squashed space,
  which would be ellipses whose eccentricity is the card's aspect ratio. -->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { SparklineProps } from '../blocks.ts';
  import { scrubAlong } from '../gesture.ts';
  import { isChord } from '../keys.ts';
  import { sparkBox, sparkIndexAt, sparklinePath, sparkPointAt } from '../spark.ts';

  let { totals, ariaLabel, dayLabels, dayFigures, dayExact, onScrub }: SparklineProps = $props();

  const path = $derived(sparklinePath(totals, sparkBox));
  const viewBox = `0 0 ${sparkBox.width} ${sparkBox.height}`;

  let plot = $state<HTMLElement>();
  /* WHICH DAY IS BEING READ, or null for "the line is at rest". The card owns
     its own copy through onScrub; this one exists because the cursor and the
     hairline are drawn here. */
  let cursor = $state<number | null>(null);
  const point = $derived(cursor === null ? null : sparkPointAt(totals, sparkBox, cursor));

  /* THE SLIDER'S RESTING VALUE IS THE NEWEST DAY, which is the one the mark
     is already on: a slider must report a value, and reporting the day a
     reader can see marked is the only answer that is true before anybody has
     scrubbed. The TEXT at rest is the line's own name — the reading is not a
     day yet, so announcing one would be an invention. */
  const newest = $derived(totals.length - 1);
  const valueText = $derived(
    cursor === null
      ? ariaLabel
      : `${dayLabels[cursor] ?? ''} ${dayExact[cursor] ?? ''}`.trim() || ariaLabel
  );

  function report(index: number | null): void {
    if (index === cursor) {
      return;
    }
    cursor = index;
    onScrub?.(index);
  }

  /* A NEW SERIES IS A NEW SET OF DAYS, and a reading taken from the last one
     must not survive it: the thirty-second poll rebuilds every card, and a
     cursor left pointing at index 5 would silently become a different day.
     `untrack` for the reason ContributionGrid's own payload effect uses it —
     report() reads the cursor, and reading it reactively here would make this
     effect re-run on every scrub, which is the reset it exists to avoid. */
  $effect(() => {
    void totals;
    untrack(() => report(null));
  });

  /* Which day a viewport x names. The box is read at the moment of the event
     rather than cached: this element's width changes with the card's, and a
     stale box is a reading off by days. */
  function scrubAt(clientX: number): void {
    const box = plot?.getBoundingClientRect();
    if (box === undefined || box.width <= 0) {
      return;
    }
    report(sparkIndexAt((clientX - box.left) / box.width, totals.length));
  }

  /* THE POINTER PLUMBING IS THE GESTURE LAYER'S, not this component's: which
     events belong to a reading, when a finger has earned one, and what a tap
     leaves behind are decided in lib/gesture.ts, where the unit suite drives
     them with no DOM at all. What stays here is the only half that is about
     a CHART — turning an x into a day. */
  const scrubBinding = { read: scrubAt, clear: () => report(null) };

  /* THE KEYBOARD WALKS THE DAYS AND STOPS AT BOTH ENDS. lib/keys.ts's
     ringTarget is deliberately not used: it WRAPS, which is right for a
     segmented control and wrong for a timeline — stepping back from the
     oldest day to the newest would read as time running backwards. A chord is
     addressed elsewhere (Cmd+Arrow is the browser's Back, Ctrl+Home is
     top-of-document) and is neither acted on nor swallowed. */
  function onKeydown(event: KeyboardEvent): void {
    if (isChord(event) || totals.length === 0) {
      return;
    }
    if (event.key === 'Escape') {
      /* Only when there is a reading to dismiss: swallowing Escape otherwise
         would take it from whatever else on the page is listening for it. */
      if (cursor === null) {
        return;
      }
      event.preventDefault();
      report(null);
      return;
    }
    /* A cold first press opens on the newest day — the one the mark is on and
       the one the slider already reports. */
    const from = cursor ?? totals.length - 1;
    let target: number;
    switch (event.key) {
      case 'ArrowRight':
        target = Math.min(totals.length - 1, from + 1);
        break;
      case 'ArrowLeft':
        target = Math.max(0, from - 1);
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = totals.length - 1;
        break;
      default:
        return;
    }
    /* The key belonged to the chart, so the page must not also act on it —
       including at a boundary, where a cursor that cannot go further must not
       become a page scroll instead. */
    event.preventDefault();
    report(target);
  }
</script>

{#if path}
  <span
    class="spark"
    bind:this={plot}
    role="slider"
    tabindex="0"
    aria-label={ariaLabel}
    aria-valuemin={0}
    aria-valuemax={newest}
    aria-valuenow={cursor ?? newest}
    aria-valuetext={valueText}
    use:scrubAlong={scrubBinding}
    onkeydown={onKeydown}
    onblur={() => report(null)}>
    <svg
      class="spark-plot"
      {viewBox}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false">
      <path class="spark-area" d={path.area} />
      <path class="spark-line" d={path.line} />
    </svg>
    <span
      class="spark-mark"
      style:--spark-mark-x={`${path.last.x}%`}
      style:--spark-mark-y={`${path.last.y}%`}></span>
    <!-- THE CURSOR AND ITS HAIRLINE ARE ALWAYS MOUNTED and merely unlit at
      rest, which is what lets the fade be a fade: an element that arrives with
      the reading has nothing to travel from. They cost the card no layout
      either way — both are taken out of flow — so the zero-CLS floor is
      untouched by construction. -->
    <span
      class="spark-guide"
      data-scrubbing={point === null ? 'false' : 'true'}
      style:--spark-cursor-x={`${point?.x ?? 0}%`}></span>
    <span
      class="spark-cursor"
      data-scrubbing={point === null ? 'false' : 'true'}
      style:--spark-cursor-x={`${point?.x ?? 0}%`}
      style:--spark-cursor-y={`${point?.y ?? 0}%`}></span>
  </span>
{/if}
