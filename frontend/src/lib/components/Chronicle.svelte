<!-- Chronicle is the trackers' one diagram (owner direction, 2026-10-16): the
  large figures beside the graph, the picked layer's daily line, and the same
  layer's calendar of cells under it, with each source's account below.

  IT IS WRITTEN ON A ROLL (owner, 2026-10-20, picking "The Rotulus" of ten
  ways to make the trackers one piece with the tome under them): parchment
  hung level on the wall by a cord between two upright rollers, the role
  scroll's own rollers stood on end. The figures open it as its incipit under
  one illuminated initial; the line is inked across it and the days are
  squares inked in the calendar's greens, darker as a day was busier, with no
  mark for the busiest ("we don't need to highlight the highest day like
  that"). Three wax seals hanging from its first roller pick what it shows,
  and a green seal hangs under its edge at the day being read. It unrolls
  from its middle the first time it is seen.

  The line IS the calendar read as a line ("make the graph represent the entire
  heatmap not just a subsection"): it covers exactly the weeks the calendar
  shows, each day standing over its own week's column, and picking a layer
  redraws both ("it makes no sense that the graph doesn't change to show
  contributions when I pick contributions"). It moves the way a brokerage chart
  does: a pointer, a finger or the arrow keys pick a day, the day's reading
  rides above the cursor, the line ahead of it dims, its cell is outlined, and
  every figure reads that day until the reader lets go; pointing at a cell
  names that day too.

  It formats nothing and names nothing: every figure, caption and label
  arrives written from lib/chronicle.ts. A day nobody measured is drawn hollow
  rather than as a quiet day (lib/grid.ts measuredCell). -->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { ChronicleProps, ChronicleSeries } from '../blocks.ts';
  import { scrubAlong } from '../gesture.ts';
  import { measuredCell } from '../grid.ts';
  import { isChord } from '../keys.ts';
  import FeedCard from './FeedCard.svelte';
  import PanelShell from './PanelShell.svelte';
  import Tome from './Tome.svelte';

  let {
    status,
    generatedAt,
    days,
    weeks,
    layers,
    accounts,
    months,
    factSlots,
    modelSlots,
    lastDay,
    emptyNote,
    ariaLabel
  }: ChronicleProps = $props();

  const uid = $props.id();

  /* The graph is drawn in CSS pixels: its box is measured, so a line keeps
     its weight and the reading its size at every width. */
  const PAD_TOP = 30;
  const PAD_BOTTOM = 4;

  /* The calendar is drawn in its own units and scaled to its box: a column is
     PITCH wide and holds a CELL square; the month names sit under it. */
  const PITCH = 14;
  const CELL = 11;
  const HEAT = 7 * PITCH;
  const MONTHS = 18;
  const CAL_HEIGHT = HEAT + MONTHS;
  /* The narrowest column the calendar will draw, in CSS pixels. */
  const MIN_PITCH_PX = 9;

  let chartBox = $state<HTMLElement>();
  let chartW = $state(0);
  let chartH = $state(0);
  let calBox = $state<HTMLElement>();
  let scroll = $state<HTMLElement>();
  let calW = $state(0);
  let cursor = $state<number | null>(null);
  let layerKey = $state<string | null>(null);
  let shown = $state(false);
  let pointerY = 0;

  const layer = $derived(layers.find((candidate) => candidate.key === layerKey) ?? layers[0]);
  /* The figures beside the graph are the picked seal's own (owner, 2026-10-21). */
  const headlines = $derived(layer?.headlines ?? []);
  const firstPresent = $derived(days.findIndex((day) => !day.absent));

  /* --- The calendar's weeks --------------------------------------------- */

  /* A phone cannot show a year of legible cells, so the calendar shows the
     latest weeks that fit — and the line covers exactly those weeks. */
  const shownWeeks = $derived(
    calW <= 0 ? weeks : Math.max(Math.min(13, weeks), Math.min(weeks, Math.floor(calW / MIN_PITCH_PX)))
  );
  const firstColumn = $derived(weeks - shownWeeks);
  const firstDay = $derived(firstColumn * 7);
  /* The earliest day either half can be read at. */
  const low = $derived(Math.max(firstDay, firstPresent));

  /* --- The graph -------------------------------------------------------- */

  /* A day's x is its place in the calendar's shown weeks: its week's column,
     and its weekday across that column's width. */
  function chartX(index: number): number {
    return ((index - firstDay + 0.5) / Math.max(1, shownWeeks * 7)) * chartW;
  }

  /* The layer's scale, taken over the weeks shown. */
  const peak = $derived.by(() => {
    let max = 0;
    const values = layer?.series.values ?? [];
    for (let index = firstDay; index <= lastDay; index += 1) {
      const value = values[index];
      if (value !== null && value !== undefined && value > max) {
        max = value;
      }
    }
    return max;
  });

  const baseline = $derived(Math.max(PAD_TOP, chartH - PAD_BOTTOM));

  function chartY(value: number): number {
    if (peak <= 0) {
      return baseline;
    }
    return PAD_TOP + (baseline - PAD_TOP) * (1 - value / peak);
  }

  /* A line breaks where a day was not measured: a gap is drawn as a gap. */
  function paths(series: ChronicleSeries): { line: string; area: string } {
    let line = '';
    let area = '';
    let run: number[] = [];
    const close = (): void => {
      if (run.length > 0) {
        area += `L${run[run.length - 1].toFixed(1)},${baseline.toFixed(1)}L${run[0].toFixed(1)},${baseline.toFixed(1)}Z`;
      }
      run = [];
    };
    for (let index = firstDay; index <= lastDay; index += 1) {
      const value = series.values[index];
      if (value === null || value === undefined) {
        close();
        continue;
      }
      const x = chartX(index);
      const point = `${x.toFixed(1)},${chartY(value).toFixed(1)}`;
      line += `${run.length === 0 ? 'M' : 'L'}${point}`;
      area += `${run.length === 0 ? 'M' : 'L'}${point}`;
      run.push(x);
    }
    close();
    return { line, area };
  }

  const drawn = $derived(chartW > 0 && layer !== undefined ? paths(layer.series) : null);

  const cursorX = $derived(cursor !== null && cursor >= firstDay ? chartX(cursor) : null);
  const cursorValue = $derived(cursor === null ? null : (layer?.series.values[cursor] ?? null));
  /* The reading above the cursor stays inside the graph's box at either end,
     by its own width — measured from its box once its new words are in
     (the update runs before the text is written, so the measurement waits
     for the end of that same update), rather than reported a frame later by
     an observer: either way a reading that grew longer was clamped by the
     width of the one before it and ran past the graph. */
  function placeStamp(node: HTMLElement, at: { x: number; width: number; words: string }): { update: (next: typeof at) => void } {
    const place = ({ x, width }: typeof at): void => {
      queueMicrotask(() => {
        // Half its width, and half a pixel for an engine that rounds the
        // centring shift to its own layout grid.
        const half = node.getBoundingClientRect().width / 2 + 0.5;
        node.style.setProperty('--chronicle-stamp-x', `${Math.min(Math.max(x, half), Math.max(half, width - half))}px`);
      });
    };
    place(at);
    return { update: place };
  }
  /* The cursor's dot stays whole inside the graph at the first and last day. */
  const DOT_REACH = 5;
  const dotX = $derived(cursorX === null ? 0 : Math.min(Math.max(cursorX, DOT_REACH), Math.max(DOT_REACH, chartW - DOT_REACH)));

  /* --- The calendar ----------------------------------------------------- */

  const calWidth = $derived(Math.max(1, shownWeeks * PITCH));
  /* The month names are drawn in the calendar's units, so a narrow frame would
     shrink them with it; their size is set so they land near 11px on screen. */
  const monthSize = $derived(calW > 0 ? Math.min(16, Math.max(9, (11 * calWidth) / calW)) : 9);

  /* The cells and the line share one scale: the same layer over the same
     weeks. The busiest day shown keeps the calendar's peak green. */
  const cells = $derived.by(() => {
    const out: { index: number; x: number; y: number; level: number; measured: boolean; busiest: boolean; column: number }[] = [];
    for (let index = firstDay; index < days.length; index += 1) {
      if (days[index].absent) {
        continue;
      }
      const column = Math.floor(index / 7) - firstColumn;
      const value = layer?.series.values[index];
      const state = measuredCell(value, peak);
      out.push({
        index,
        x: column * PITCH + (PITCH - CELL) / 2,
        y: (index % 7) * PITCH + (PITCH - CELL) / 2,
        level: state.level,
        measured: state.measured,
        busiest: peak > 0 && value === peak,
        column
      });
    }
    return out;
  });

  /* The month names under the weeks. A name that would run past the
     calendar's right edge is set flush against that edge instead — unless
     that would crowd the name before it, in which case it is left out. Only
     the choice rests on a width estimate (a three-letter name in the display
     face measures about 1.9 of its size; "fits" is judged at 2.4, generously,
     "crowds" at 2.1 plus a gap); a name set flush ends a quarter of its size
     inside the edge whatever its real width, and one set from its column
     starts a quarter in — clear of the side bearings, which Gecko counts
     about a pixel and a half wider than Blink does. */
  const shownMonths = $derived.by(() => {
    const fits = 2.4 * monthSize;
    const wide = 2.1 * monthSize;
    const inset = monthSize / 4;
    const out: { column: number; label: string; x: number; anchor: 'start' | 'end' }[] = [];
    for (const month of months) {
      if (month.column < firstColumn) {
        continue;
      }
      const x = (month.column - firstColumn) * PITCH + inset;
      if (x + fits <= calWidth - inset) {
        out.push({ column: month.column, label: month.label, x, anchor: 'start' });
        continue;
      }
      const previous = out[out.length - 1];
      if (previous === undefined || previous.x + wide + 0.3 * monthSize <= calWidth - inset - wide) {
        out.push({ column: month.column, label: month.label, x: calWidth - inset, anchor: 'end' });
      }
    }
    return out;
  });

  /* --- Reading a day ---------------------------------------------------- */

  function headlineFigure(figure: string, daily: ChronicleSeries | undefined): string {
    return cursor !== null && daily !== undefined ? (daily.figures[cursor] ?? figure) : figure;
  }

  function headlineCaption(caption: string, daily: ChronicleSeries | undefined): string {
    return cursor !== null && daily !== undefined ? (days[cursor]?.label ?? caption) : caption;
  }

  /* What rides above the cursor: the day's reading, then the day. */
  const stampReading = $derived(cursor === null ? '' : (layer?.readings[cursor] ?? ''));
  const stampDay = $derived(cursor === null ? '' : (days[cursor]?.label ?? ''));
  const stamp = $derived(cursor === null ? '' : `${stampReading} · ${stampDay}`);

  const valueText = $derived(
    cursor === null
      ? `${ariaLabel}: ${layer?.label ?? ''}`
      : `${stamp}; ${headlines
          .map((headline) => `${headline.label} ${headlineFigure(headline.figure, headline.daily)}`)
          .join(', ')}`
  );

  function present(index: number): number | null {
    if (days.length === 0 || lastDay < 0 || low < 0) {
      return null;
    }
    let target = Math.max(low, Math.min(lastDay, index));
    while (target > low && days[target]?.absent) {
      target -= 1;
    }
    return days[target]?.absent ? null : target;
  }

  /* A new payload is a new set of days: a reading taken from the last one is
     dropped rather than carried over. */
  $effect(() => {
    void days;
    untrack(() => {
      cursor = null;
    });
  });

  function measure(node: HTMLElement | undefined, write: (width: number, height: number) => void): (() => void) | undefined {
    if (node === undefined || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    /* A reported size is written on the next frame, not inside the
       observer's delivery: the write re-cuts the calendar to the weeks that
       fit, which changes the sheet's height, and the torches watch the sheet.
       A box shallower than the one reported that changes during the delivery
       is skipped, and the engine reports a loop — WebKit did, resizing from
       1440px to 320px (2026-10-19). */
    let pending = 0;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => write(box?.width ?? 0, box?.height ?? 0));
    });
    observer.observe(node);
    /* The first size now, not at the observer's first report: that comes with
       a rendering update, and where an engine draws slowly the calendar was
       laid out a whole year wide and then re-cut to the weeks that fit, 30px
       taller on a phone (WebKit without a GPU). Neither box has padding or a
       border, so its box is its content box. */
    const box = node.getBoundingClientRect();
    write(box.width, box.height);
    return () => {
      cancelAnimationFrame(pending);
      observer.disconnect();
    };
  }

  $effect(() =>
    measure(chartBox, (width, height) => {
      chartW = width;
      chartH = height;
    })
  );
  $effect(() =>
    measure(calBox, (width) => {
      calW = width;
    })
  );

  /* The diagram draws itself the first time it is seen — and only then. A
     host with no observer shows it at once. What is watched is the roll, not
     the graph: until it unrolls, the roll clips the graph to nothing, and an
     observer of the graph would never see it. */
  $effect(() => {
    const roll = scroll;
    if (chartBox === undefined || roll === undefined || shown) {
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      shown = true;
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          shown = true;
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(roll);
    return () => observer.disconnect();
  });

  const chartBinding = {
    read(clientX: number): void {
      const box = chartBox?.getBoundingClientRect();
      if (box === undefined || box.width <= 0) {
        return;
      }
      const fraction = (clientX - box.left) / box.width;
      cursor = present(firstDay + Math.floor(fraction * shownWeeks * 7));
    },
    clear: () => (cursor = null)
  };

  const calendarBinding = {
    read(clientX: number): void {
      const box = calBox?.getBoundingClientRect();
      if (box === undefined || box.width <= 0) {
        return;
      }
      const scale = calWidth / box.width;
      const x = (clientX - box.left) * scale;
      const y = (pointerY - box.top) * scale;
      const column = Math.max(0, Math.min(shownWeeks - 1, Math.floor(x / PITCH))) + firstColumn;
      const row = Math.max(0, Math.min(6, Math.floor(y / PITCH)));
      cursor = present(column * 7 + row);
    },
    clear: () => (cursor = null)
  };

  function trackY(event: PointerEvent): void {
    pointerY = event.clientY;
  }

  /* A press on the calendar leaves focus where it was: cancelling the press
     cancels the compatibility mousedown a touch sends after it, which would
     otherwise take focus off the graph — and the graph's blur clears the day
     the calendar had just picked. Scrolling is touch-action's, not this. */
  function press(event: PointerEvent): void {
    trackY(event);
    event.preventDefault();
  }

  function pickLayer(key: string): void {
    layerKey = key;
    cursor = null;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (isChord(event) || lastDay < 0) {
      return;
    }
    if (event.key === 'Escape') {
      if (cursor !== null) {
        event.preventDefault();
        cursor = null;
      }
      return;
    }
    const from = cursor ?? lastDay;
    const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, PageDown: 7, PageUp: -7 };
    let target: number;
    if (event.key in steps) {
      target = from + steps[event.key];
    } else if (event.key === 'Home') {
      target = low;
    } else if (event.key === 'End') {
      target = lastDay;
    } else {
      return;
    }
    event.preventDefault();
    cursor = present(target);
  }
</script>

<PanelShell {status} {generatedAt}>
  <FeedCard variant="board">
    <div class="chronicle" data-shown={shown ? 'true' : 'false'}>
      {#if days.length === 0 && layers.length === 0}
        <p class="chronicle-note">{emptyNote}</p>
      {:else}
        <!-- THE ROLL: a cord between two pegs, two upright rollers, and the
          parchment between them; all but the parchment is drawn, and none of
          it takes a pointer. -->
        <div class="chronicle-scroll" bind:this={scroll}>
          <i class="chronicle-cord" aria-hidden="true"></i>
          <div class="chronicle-roll">
          <i class="chronicle-reel" data-side="start" aria-hidden="true"><i class="chronicle-roller" data-side="start"></i></i>
          <i class="chronicle-reel" data-side="end" aria-hidden="true"><i class="chronicle-roller" data-side="end"></i></i>
          <div class="chronicle-sheet">
            <div class="chronicle-top">
              <!-- The incipit: the figures open the roll, the first under its
                illuminated initial (the letter is the label's own first, so
                the label reads whole). -->
              <dl class="chronicle-headlines">
                {#each headlines as headline, index (headline.key)}
                  <div class="chronicle-headline" data-opening={index === 0 ? 'true' : 'false'}>
                    <dt class="chronicle-label">
                      {#if index === 0}<span class="chronicle-initial">{headline.label.charAt(0)}</span>{headline.label.slice(1)}{:else}{headline.label}{/if}
                    </dt>
                    <dd class="chronicle-figure">{headlineFigure(headline.figure, headline.daily)}</dd>
                    <dd class="chronicle-caption">{headlineCaption(headline.caption, headline.daily)}</dd>
                  </div>
                {/each}
              </dl>

              {#if weeks > 0}
                <div class="chronicle-plotting">
                  {#if days.length === 0}
                    <!-- The graph's box, held while its days are on their way;
                      nothing is drawn in it and nothing can be read from it. -->
                    <div class="chronicle-chart" aria-hidden="true"></div>
                  {:else}
                  <div
                    class="chronicle-chart"
                    bind:this={chartBox}
                    role="slider"
                    tabindex="0"
                    aria-label={ariaLabel}
                    aria-valuemin={Math.max(0, low)}
                    aria-valuemax={Math.max(0, lastDay)}
                    aria-valuenow={cursor ?? Math.max(0, lastDay)}
                    aria-valuetext={valueText}
                    data-scrubbing={cursor !== null ? 'true' : 'false'}
                    use:scrubAlong={chartBinding}
                    onkeydown={onKeydown}
                    onblur={() => (cursor = null)}>
                    {#if chartW > 0 && chartH > 0}
                      <svg class="chronicle-svg" viewBox={`0 0 ${chartW} ${chartH}`} aria-hidden="true" focusable="false">
                        <defs>
                          <clipPath id={`${uid}-past`}>
                            <rect x="0" y="0" width={cursorX ?? chartW} height={chartH} />
                          </clipPath>
                        </defs>
                        <!-- The ruling a scribe lays before writing. -->
                        {#each [0.25, 0.5, 0.75] as rule (rule)}
                          <line class="chronicle-rule" x1="0" y1={PAD_TOP + (baseline - PAD_TOP) * rule} x2={chartW} y2={PAD_TOP + (baseline - PAD_TOP) * rule} />
                        {/each}
                        <line class="chronicle-baseline" x1="0" y1={baseline} x2={chartW} y2={baseline} />
                        <!-- A new layer is drawn afresh, the way the diagram first
                          draws itself. -->
                        {#key layer?.key}
                          {#if drawn !== null}
                            <g class="chronicle-plot" data-tone={layer?.tone}>
                              {#if cursorX !== null}
                                <path class="chronicle-line chronicle-ahead" d={drawn.line} />
                              {/if}
                              <g clip-path={`url(#${uid}-past)`}>
                                <path class="chronicle-area" d={drawn.area} />
                                <path class="chronicle-line" d={drawn.line} />
                              </g>
                            </g>
                          {/if}
                        {/key}
                        {#if cursorX !== null}
                          <line class="chronicle-cursor" x1={cursorX} y1={PAD_TOP - 6} x2={cursorX} y2={baseline} />
                          {#if cursorValue !== null}
                            <circle class="chronicle-dot" data-tone={layer?.tone} cx={dotX} cy={chartY(cursorValue)} r="4" />
                          {/if}
                        {/if}
                      </svg>
                    {/if}
                    {#if cursorX !== null}
                      <span class="chronicle-stamp" use:placeStamp={{ x: cursorX, width: chartW, words: stamp }}><span>{stampReading}</span> <span>· {stampDay}</span></span>
                    {/if}
                  </div>
                  {/if}

                  <div
                    class="chronicle-calendar"
                    bind:this={calBox}
                    use:scrubAlong={calendarBinding}
                    onpointermovecapture={trackY}
                    onpointerdowncapture={press}>
                    <svg class="chronicle-svg" viewBox={`0 0 ${calWidth} ${CAL_HEIGHT}`} aria-hidden="true" focusable="false">
                      {#each cells as cell (cell.index)}
                        <rect
                          class="chronicle-cell"
                          data-grid-cell
                          data-grid-level={cell.level}
                          data-measured={cell.measured ? 'true' : 'false'}
                          data-peak={cell.busiest ? 'true' : 'false'}
                          data-today={cell.index === lastDay ? 'true' : 'false'}
                          data-picked={cell.index === cursor ? 'true' : 'false'}
                          x={cell.x}
                          y={cell.y}
                          width={CELL}
                          height={CELL}
                          rx="1.5"
                          style:--chronicle-column={cell.column} />
                      {/each}
                      {#each shownMonths as month (month.column)}
                        <text class="chronicle-month" x={month.x} y={CAL_HEIGHT - 4} font-size={monthSize} text-anchor={month.anchor}>{month.label}</text>
                      {/each}
                    </svg>
                  </div>

                  <div class="chronicle-keys">
                    <div class="chronicle-scale" aria-hidden="true">
                      less{#each [0, 1, 2, 3, 4] as level (level)}<i class="chronicle-step" data-grid-level={level}></i>{/each}more
                    </div>
                  </div>

                  <!-- The green seal on its ribbon, hanging under the roll's
                    edge at the day being read. -->
                  <i
                    class="chronicle-seal"
                    aria-hidden="true"
                    data-on={cursorX !== null ? 'true' : 'false'}
                    style:--chronicle-seal-x={`${cursorX ?? 0}px`}></i>
                </div>
              {/if}
            </div>
          </div>
          </div>

          {#if days.length > 0 && layers.length > 1}
            <!-- The diagram's layer (owner direction, 2026-10-16): three wax
              seals hanging from the roll's first roller, each its layer's
              name and nothing else; the picked one hangs lower, and its name
              is written beside them. -->
            <div class="chronicle-layers" role="group" aria-label="Diagram layer">
              {#each layers as option (option.key)}
                <button
                  type="button"
                  data-tone={option.tone}
                  data-initial={option.label.charAt(0)}
                  aria-pressed={option.key === layer?.key}
                  onclick={() => pickLayer(option.key)}>{option.label}</button>
              {/each}
            </div>
            <span class="chronicle-layer-name" aria-hidden="true">{layer?.label ?? ''}</span>
          {:else if weeks > 0}
            <!-- The seals' room, held while the layers are on their way. -->
            <div class="chronicle-layers" aria-hidden="true"></div>
          {/if}
        </div>

        {#if accounts.length > 0}
          <Tome {accounts} {factSlots} {modelSlots} />
        {/if}

      {/if}
    </div>
  </FeedCard>
</PanelShell>

<style>
  /* One column that may shrink: an auto column would hold the frame at its
     content's natural width and push a 320px phone sideways. */
  .chronicle {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.25rem;
    color: var(--ledger-ink);
  }

  .chronicle-note {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--ledger-figure-size);
    color: var(--ledger-muted);
  }

  /* --- The roll ------------------------------------------------------------- */

  /* The roll hangs from its cord (the room above the parchment), and its
     seals hang under it, the picked layer's name written beside them. Its
     parchment and inks are the role scroll's (styles.css, the parchment
     tokens), so both scrolls on the page are one material. */
  .chronicle-scroll {
    --chronicle-roller: calc(8 * var(--keep-prop));
    --chronicle-pad-end: 1.25rem;
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    column-gap: 0.75rem;
    padding-block-start: 1.75rem;
  }

  .chronicle-roll {
    position: relative;
    grid-column: 1 / -1;
  }

  /* The cord, from one peg to the other and down to each roller's knob. */
  .chronicle-cord {
    position: absolute;
    inset-block-start: 0.35rem;
    inset-inline: calc(4 * var(--keep-prop));
    block-size: calc(1.4rem - 3 * var(--keep-prop));
    border: 1px solid var(--palette-keep-bone-deep);
    border-block-end: 0;
    pointer-events: none;
  }

  .chronicle-cord::before,
  .chronicle-cord::after {
    content: '';
    position: absolute;
    inset-block-start: -5px;
    inline-size: 9px;
    block-size: 9px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, var(--palette-keep-iron-1), var(--palette-keep-torch-iron-dark) 70%);
    box-shadow: 0 1px 2px var(--palette-keep-tome-shadow);
  }

  .chronicle-cord::before {
    inset-inline-start: -5px;
  }

  .chronicle-cord::after {
    inset-inline-end: -5px;
  }

  /* Each roller rides a reel half the roll wide, at its own end of it. The
     reel is what travels as the roll opens — by its own width less a
     roller's, since a transform's percentage is the box's own width — so the
     travel is half the roll in the same layout as any resize. (A half
     measured by script lagged a resize by a frame, and a desk-wide half held
     for that frame on a phone threw both rollers clean off the page.) */
  .chronicle-reel {
    position: absolute;
    z-index: 1;
    inset-block: 0;
    inline-size: 50%;
    pointer-events: none;
  }

  .chronicle-reel[data-side='start'] {
    inset-inline-start: 0;
  }

  .chronicle-reel[data-side='end'] {
    inset-inline-end: 0;
  }

  /* Each roller is the role scroll's own roller stood upright: the rolled
     edge tiled between two knobs, a little taller than the parchment. */
  .chronicle-roller {
    position: absolute;
    inset-block: calc(-3 * var(--keep-prop));
    inline-size: var(--chronicle-roller);
    box-sizing: border-box;
    padding-block: calc(5 * var(--keep-prop));
    background:
      var(--keep-scroll-knob-top) center top / 100% calc(5 * var(--keep-prop)) no-repeat border-box,
      var(--keep-scroll-knob-bottom) center bottom / 100% calc(5 * var(--keep-prop)) no-repeat border-box,
      var(--keep-scroll-roll-upright) center top / 100% var(--keep-prop) repeat-y content-box;
    filter: drop-shadow(0 4px 3px var(--palette-keep-tome-shadow));
    pointer-events: none;
  }

  .chronicle-roller[data-side='start'] {
    inset-inline-start: 0;
  }

  .chronicle-roller[data-side='end'] {
    inset-inline-end: 0;
  }

  /* The parchment darkens over a band four props wide where it curls onto
     each roller, and its words begin well inside that band. */
  .chronicle-sheet {
    margin-inline: calc(6 * var(--keep-prop));
    padding: 1.5rem calc(6 * var(--keep-prop) + 1.25rem) var(--chronicle-pad-end);
    background: linear-gradient(
      to right,
      var(--keep-parchment-edge),
      var(--keep-parchment) calc(4 * var(--keep-prop)),
      var(--keep-parchment) calc(100% - 4 * var(--keep-prop)),
      var(--keep-parchment-edge)
    );
    color: var(--keep-parchment-ink);
    box-shadow: 0 1.25rem 1.75rem -1.1rem var(--palette-keep-tome-shadow);
  }

  /* --- The incipit: the figures open the roll -------------------------------- */

  /* Beside the writing on a desk, the three figures down the roll's first
     column; on a phone, above it. */
  .chronicle-top {
    display: grid;
    grid-template-columns: minmax(9.5rem, 13rem) minmax(0, 1fr);
    gap: 1.25rem 2rem;
  }

  .chronicle-headlines {
    display: grid;
    align-content: space-between;
    gap: 1rem;
    margin: 0;
  }

  .chronicle-headline {
    position: relative;
    display: grid;
    gap: 0.1rem;
    min-inline-size: 0;
  }

  /* The first figure sits beside the initial that opens the roll. */
  .chronicle-headline[data-opening='true'] {
    padding-inline-start: 3.4rem;
    min-block-size: 2.9rem;
  }

  .chronicle-headline dd {
    margin: 0;
  }

  /* Capitals drawn small: the vendored face carries no small capitals of its
     own, and the page synthesises none. */
  .chronicle-label {
    font-family: var(--font-tome);
    font-size: 0.74rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    line-height: 1.2;
    color: var(--keep-parchment-muted);
  }

  /* The initial: a blackletter capital in lapis on a square of rubric dotted
     in vellum, the tome's own fixture. */
  .chronicle-initial {
    position: absolute;
    inset-inline-start: 0;
    inset-block-start: 0.1rem;
    display: grid;
    place-items: center;
    inline-size: 2.75rem;
    block-size: 2.75rem;
    border-radius: 2px;
    font-family: var(--font-initial);
    font-size: 2.2rem;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    line-height: 1;
    color: var(--palette-keep-lapis);
    text-shadow:
      1px 1px 0 var(--palette-keep-lapis-deep),
      -1px 0 0 var(--palette-keep-lapis-deep);
    background: radial-gradient(circle, var(--palette-keep-vellum) 0 0.8px, transparent 1.3px) 0 0 / 6px 6px, var(--palette-keep-rubric);
    box-shadow:
      inset 0 0 0 2px var(--palette-keep-rubric),
      inset 0 0 0 3px var(--palette-keep-vellum-edge);
  }

  .chronicle-figure {
    font-family: var(--font-tome);
    font-size: clamp(1.6rem, 2.6vw, 2.15rem);
    font-weight: 600;
    line-height: 1.05;
    font-variant-numeric: lining-nums tabular-nums;
    color: var(--keep-parchment-ink);
  }

  .chronicle-caption {
    min-block-size: 1.3em;
    font-family: var(--font-tome);
    font-size: 0.95rem;
    font-style: italic;
    font-weight: 500;
    line-height: 1.3;
    color: var(--keep-parchment-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* --- The graph ------------------------------------------------------------ */

  .chronicle-plotting {
    position: relative;
    display: grid;
    gap: 0.5rem;
    min-inline-size: 0;
  }

  .chronicle-chart {
    position: relative;
    block-size: clamp(10rem, 18vw, 13.5rem);
    cursor: crosshair;
    touch-action: pan-y;
  }

  .chronicle-chart:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 4px;
  }

  .chronicle-chart .chronicle-svg {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
  }

  .chronicle-svg {
    display: block;
    inline-size: 100%;
    block-size: auto;
    overflow: visible;
  }

  /* The scribe's ruling and the foot of the writing. */
  .chronicle-rule {
    stroke: var(--keep-parchment-muted);
    stroke-opacity: 0.14;
    stroke-width: 1;
  }

  .chronicle-baseline {
    stroke: var(--keep-parchment-muted);
    stroke-opacity: 0.35;
    stroke-width: 1;
  }

  /* The layer's ink on parchment: the first source's in the brand as the
     page writes it on paper, the second's in lapis, the contributions in the
     roll's green. */
  .chronicle-plot,
  .chronicle-dot {
    --chronicle-ink: var(--keep-parchment-mark);
    --chronicle-wash: 0.12;
  }

  [data-tone='1'] {
    --chronicle-ink: var(--palette-keep-lapis-mid);
    --chronicle-wash: 0.1;
  }

  [data-tone='grid'] {
    --chronicle-ink: var(--palette-keep-verdigris);
    --chronicle-wash: 0.14;
  }

  .chronicle-line {
    fill: none;
    stroke: var(--chronicle-ink);
    stroke-width: 1.75;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  /* The line ahead of the cursor, dimmed: what the reader has not reached. */
  .chronicle-ahead {
    opacity: 0.28;
  }

  .chronicle-area {
    fill: var(--chronicle-ink);
    opacity: var(--chronicle-wash);
  }

  .chronicle-cursor {
    stroke: var(--keep-parchment-muted);
    stroke-opacity: 0.6;
    stroke-width: 1;
  }

  .chronicle-dot {
    fill: var(--keep-parchment);
    stroke: var(--chronicle-ink);
    stroke-width: 2;
  }

  /* The day's reading above the cursor. It is never wider than the graph (a
     hair under it, for the half pixel the clamp allows an engine's rounding):
     on a phone narrower than its one line, the day drops under the figure,
     and it breaks there and nowhere else. */
  .chronicle-stamp {
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: var(--chronicle-stamp-x, 0);
    inline-size: max-content;
    max-inline-size: calc(100% - 2px);
    transform: translateX(-50%);
    font-family: var(--font-tome);
    font-size: 0.95rem;
    font-style: italic;
    font-weight: 600;
    line-height: 1.3;
    text-align: center;
    color: var(--keep-parchment-ink);
    pointer-events: none;
  }

  .chronicle-stamp > span {
    white-space: nowrap;
  }

  /* --- The calendar --------------------------------------------------------- */

  .chronicle-calendar {
    position: relative;
    cursor: crosshair;
    touch-action: pan-y;
  }

  /* A day is a square inked on the parchment: a quiet day a faint square,
     and a busier one in a deeper green, the calendar's greens from the
     lightest to the darkest, as ink deepens on a skin. The busiest day is
     simply the deepest (owner, 2026-10-20). The key below inks the same five
     steps, and every day says its count in words when it is read. */
  .chronicle-cell {
    fill: var(--keep-parchment-ink);
    fill-opacity: 0.09;
  }

  .chronicle-cell[data-grid-level='1'] {
    fill: var(--palette-dark-grid-4);
    fill-opacity: 0.75;
  }

  .chronicle-cell[data-grid-level='2'] {
    fill: var(--palette-dark-grid-3);
    fill-opacity: 0.92;
  }

  .chronicle-cell[data-grid-level='3'] {
    fill: var(--palette-dark-grid-2);
    fill-opacity: 0.92;
  }

  .chronicle-cell[data-grid-level='4'] {
    fill: var(--palette-dark-grid-1);
    fill-opacity: 0.92;
  }

  /* A day nobody measured: an outline, never the quiet-day square. */
  .chronicle-cell[data-measured='false'] {
    fill: none;
    stroke: var(--keep-parchment-muted);
    stroke-opacity: 0.45;
    stroke-width: 1;
    stroke-dasharray: 2 1.5;
  }

  .chronicle-cell[data-today='true'] {
    stroke: var(--keep-parchment-ink);
    stroke-width: 1.4;
  }

  .chronicle-cell[data-picked='true'] {
    stroke: var(--keep-parchment-ink);
    stroke-width: 2;
  }

  .chronicle-month {
    font-family: var(--font-tome);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    fill: var(--keep-parchment-muted);
  }

  /* --- The key -------------------------------------------------------------- */

  .chronicle-keys {
    display: flex;
    justify-content: flex-end;
    font-family: var(--font-tome);
    font-size: 0.9rem;
    font-style: italic;
    color: var(--keep-parchment-muted);
  }

  .chronicle-scale {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  .chronicle-step {
    display: inline-block;
    inline-size: 0.6875rem;
    block-size: 0.6875rem;
    border-radius: 2px;
    background: var(--keep-parchment-ink);
    opacity: 0.09;
  }

  .chronicle-step[data-grid-level='1'] {
    background: var(--palette-dark-grid-4);
    opacity: 0.75;
  }

  .chronicle-step[data-grid-level='2'] {
    background: var(--palette-dark-grid-3);
    opacity: 0.92;
  }

  .chronicle-step[data-grid-level='3'] {
    background: var(--palette-dark-grid-2);
    opacity: 0.92;
  }

  .chronicle-step[data-grid-level='4'] {
    background: var(--palette-dark-grid-1);
    opacity: 0.92;
  }

  /* --- The seal at the day being read ---------------------------------------- */

  /* A green seal on its ribbon, hanging under the roll's edge at the day the
     reader is on; it is drawn, and takes no pointer. */
  .chronicle-seal {
    position: absolute;
    inset-block-start: calc(100% + var(--chronicle-pad-end));
    inset-inline-start: 0;
    inline-size: 1.25rem;
    block-size: 2rem;
    opacity: 0;
    pointer-events: none;
    transform: translateX(calc(var(--chronicle-seal-x, 0px) - 50%));
  }

  .chronicle-seal[data-on='true'] {
    opacity: 1;
  }

  .chronicle-seal::before,
  .chronicle-seal::after {
    content: '';
    position: absolute;
    inset-inline-start: 50%;
    transform: translateX(-50%);
  }

  .chronicle-seal::before {
    inset-block-start: 0;
    inline-size: 4px;
    block-size: 0.875rem;
    background: var(--palette-keep-verdigris);
  }

  .chronicle-seal::after {
    inset-block-start: 0.65rem;
    inline-size: 1.25rem;
    block-size: 1.25rem;
    border-radius: 47% 53% 50% 48% / 52% 46% 54% 48%;
    background: radial-gradient(circle at 50% 50%, var(--palette-keep-verdigris) 55%, var(--palette-dark-grid-1) 100%);
    box-shadow: 0 2px 3px var(--palette-keep-tome-shadow);
  }

  /* --- The seals that pick the layer ----------------------------------------- */

  /* Each seal is its layer's name and nothing else: the name is the button's
     words, set at no size, and the wax is drawn over them with the name's
     first letter pressed in it. 44px on both axes. */
  .chronicle-layers {
    display: flex;
    gap: 0.5rem;
    min-block-size: 3.75rem;
    padding-inline-start: calc(2 * var(--keep-prop));
    margin-block-start: 0.5rem;
  }

  .chronicle-layers button {
    --chronicle-wax: var(--palette-keep-oak-1);
    position: relative;
    display: grid;
    place-items: center;
    inline-size: 2.75rem;
    block-size: 2.75rem;
    padding: 0;
    border: 0;
    background: none;
    color: transparent;
    font-size: 0;
    cursor: pointer;
  }

  .chronicle-layers button[data-tone='grid'] {
    --chronicle-wax: var(--palette-keep-verdigris);
  }

  .chronicle-layers button[data-tone='1'] {
    --chronicle-wax: var(--palette-keep-lapis-mid);
  }

  /* The cord the seal hangs on, up to the roll's foot. */
  .chronicle-layers button::after {
    content: '';
    position: absolute;
    inset-block-end: calc(50% + 1rem);
    inset-inline-start: 50%;
    inline-size: 1px;
    block-size: 1.25rem;
    background: var(--palette-keep-bone-deep);
  }

  .chronicle-layers button::before {
    content: attr(data-initial);
    display: grid;
    place-items: center;
    inline-size: 2.15rem;
    block-size: 2.15rem;
    border-radius: 47% 53% 50% 48% / 52% 46% 54% 48%;
    font-family: var(--font-initial);
    font-size: 1.15rem;
    line-height: 1;
    color: var(--palette-keep-tome-crease);
    background: radial-gradient(circle at 50% 50%, var(--chronicle-wax) 55%, var(--palette-keep-umbra) 150%);
    box-shadow: 0 3px 4px var(--palette-keep-tome-shadow);
    opacity: 0.82;
  }

  /* The picked seal hangs lower, full in its colour. */
  .chronicle-layers button[aria-pressed='true'] {
    transform: translateY(0.5rem);
  }

  .chronicle-layers button[aria-pressed='true']::before {
    opacity: 1;
  }

  .chronicle-layers button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
    border-radius: 50%;
  }

  .chronicle-layer-name {
    align-self: center;
    margin-block-start: 0.5rem;
    font-family: var(--font-tome);
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--palette-keep-bone-mid);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* --- A phone: the figures above the writing -------------------------------- */
  @media (max-width: 47.99rem) {
    .chronicle-top {
      grid-template-columns: minmax(0, 1fr);
    }

    /* The writing starts just past the curl band, so a 320px phone keeps
       its graph wide enough to read a day. */
    .chronicle-sheet {
      padding: 1.1rem calc(4 * var(--keep-prop) + 0.5rem) var(--chronicle-pad-end);
    }

    .chronicle-headlines {
      gap: 0.6rem;
    }

    /* Each figure's day reads beside it, in a line that holds whatever it
       says, so reading a day never moves the roll under it. */
    .chronicle-headline {
      grid-template-columns: auto minmax(0, 1fr);
      align-items: baseline;
      column-gap: 0.5rem;
    }

    .chronicle-label {
      grid-column: 1 / -1;
    }

    /* The figure holds a column as wide as the widest figure it sets (a
       grouped count to 999,999 or a compact 999.9M, measured in this face at
       about 3.1em), so the day beside it starts in one place whatever day is
       read. */
    .chronicle-figure {
      font-size: 1.55rem;
      min-inline-size: 3.25em;
    }
  }

  /* --- Motion: the roll unrolls from its middle the first time it is seen,
     the line writes itself after it and again on every layer chosen, and the
     calendar's days arrive week by week once. Everything moving is inside
     this guard; with reduced motion the roll is simply open. */
  @media (prefers-reduced-motion: no-preference) {
    .chronicle[data-shown='false'] .chronicle-sheet,
    .chronicle[data-shown='false'] .chronicle-cord {
      clip-path: inset(-3rem 50%);
    }

    .chronicle[data-shown='false'] .chronicle-reel[data-side='start'] {
      transform: translateX(calc(100% - var(--chronicle-roller)));
    }

    .chronicle[data-shown='false'] .chronicle-reel[data-side='end'] {
      transform: translateX(calc(var(--chronicle-roller) - 100%));
    }

    .chronicle[data-shown='true'] .chronicle-sheet,
    .chronicle[data-shown='true'] .chronicle-cord {
      animation: chronicle-unroll 1300ms cubic-bezier(0.45, 0.05, 0.25, 1) both;
    }

    .chronicle[data-shown='true'] .chronicle-reel[data-side='start'] {
      animation: chronicle-roll-start 1300ms cubic-bezier(0.45, 0.05, 0.25, 1) both;
    }

    .chronicle[data-shown='true'] .chronicle-reel[data-side='end'] {
      animation: chronicle-roll-end 1300ms cubic-bezier(0.45, 0.05, 0.25, 1) both;
    }

    .chronicle[data-shown='false'] .chronicle-plot {
      clip-path: inset(-10% 100% -10% -2%);
    }

    .chronicle[data-shown='false'] .chronicle-cell {
      opacity: 0;
    }

    .chronicle[data-shown='true'] .chronicle-plot {
      animation: chronicle-write 1100ms cubic-bezier(0.3, 0.7, 0.2, 1) both;
    }

    .chronicle[data-shown='true'] .chronicle-area {
      animation: chronicle-fade 700ms ease-out 500ms both;
    }

    .chronicle-cell {
      transition: opacity 300ms ease;
    }

    .chronicle[data-shown='true'] .chronicle-cell {
      animation: chronicle-cell 480ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
      animation-delay: calc(var(--chronicle-column, 0) * 14ms);
      transform-box: fill-box;
      transform-origin: center;
    }

    .chronicle[data-shown='true'] .chronicle-cell[data-today='true'] {
      animation:
        chronicle-cell 480ms cubic-bezier(0.2, 0.7, 0.2, 1) both,
        chronicle-glow 2600ms ease-in-out 1600ms infinite;
      animation-delay: calc(var(--chronicle-column, 0) * 14ms), 1600ms;
    }

    .chronicle-seal {
      transition:
        opacity 200ms ease,
        transform 240ms cubic-bezier(0.2, 0.8, 0.25, 1);
    }

    .chronicle-layers button {
      transition: transform 500ms cubic-bezier(0.3, 1.5, 0.5, 1);
    }

    .chronicle-figure,
    .chronicle-caption {
      transition: color var(--ledger-hover) var(--ledger-ease);
    }
  }

  @keyframes chronicle-unroll {
    from {
      clip-path: inset(-3rem 50%);
    }
    to {
      clip-path: inset(-3rem 0);
    }
  }

  @keyframes chronicle-roll-start {
    from {
      transform: translateX(calc(100% - var(--chronicle-roller)));
    }
    to {
      transform: none;
    }
  }

  @keyframes chronicle-roll-end {
    from {
      transform: translateX(calc(var(--chronicle-roller) - 100%));
    }
    to {
      transform: none;
    }
  }

  @keyframes chronicle-write {
    from {
      clip-path: inset(-10% 100% -10% -2%);
    }
    to {
      clip-path: inset(-10% -2% -10% -2%);
    }
  }

  @keyframes chronicle-fade {
    from {
      opacity: 0;
    }
  }

  @keyframes chronicle-cell {
    from {
      opacity: 0;
      transform: scale(0.4);
    }
  }

  @keyframes chronicle-glow {
    50% {
      stroke-width: 2.6;
    }
  }
</style>
