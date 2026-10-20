<!-- Chronicle is the trackers' one diagram (owner direction, 2026-10-16): the
  large figures beside the graph, the picked layer's daily line, and the same
  layer's calendar of cells under it, with each source's account below.

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
  import stone0 from '../../assets/images/props/stone-0.svg';
  import stone1 from '../../assets/images/props/stone-1.svg';
  import stone2 from '../../assets/images/props/stone-2.svg';
  import stone3 from '../../assets/images/props/stone-3.svg';
  import stone4 from '../../assets/images/props/stone-4.svg';

  /* A day on the calendar is a wall stone, bare on a quiet day and mossier as
     the day gets busier (owner, 2026-10-19: "castle wall fixtures").

     THE STONES ARE ONE PICTURE. Drawn inside the calendar's SVG — a pattern
     per level, or a picture per day — WebKit without a GPU rasterised every
     stone again whenever the calendar repainted: on the iPhone profile, in the
     1200ms after the page was resized to 1440px, J drew 5 or 6 frames of his
     flight in five runs out of five, and with the stones on one canvas 9 to
     31, what he draws with no texture at all. So each stone drawing is
     rasterised once, at its own pixels, and every day's stone is painted from
     it onto one canvas under the cells, at the screen's own pixels; the cells
     keep only their outlines and the reader's pointer. The canvas brings the
     stones in week by week and repaints a chosen layer as a wave, with the
     cells' own timings, and under reduced motion they are simply there. */
  const stones = [stone0, stone1, stone2, stone3, stone4];
  const STONE_RISE = { length: 480, step: 14 };
  const STONE_WAVE = { length: 420, step: 9 };

  let {
    status,
    generatedAt,
    days,
    weeks,
    layers,
    headlines,
    accounts,
    months,
    factSlots,
    modelSlots,
    lastDay,
    emptyNote,
    ariaLabel
  }: ChronicleProps = $props();

  /* The rows an account holds beyond the ones it filled. */
  function room(slots: number, filled: number): number[] {
    return Array.from({ length: Math.max(0, slots - filled) }, (_, index) => index);
  }

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
  let calSvg = $state<SVGSVGElement>();
  let stoneCanvas = $state<HTMLCanvasElement>();
  let calW = $state(0);
  let cursor = $state<number | null>(null);
  let layerKey = $state<string | null>(null);
  let shown = $state(false);
  let pointerY = 0;

  const layer = $derived(layers.find((candidate) => candidate.key === layerKey) ?? layers[0]);
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
  const stamp = $derived(cursor === null ? '' : `${layer?.readings[cursor] ?? ''} · ${days[cursor]?.label ?? ''}`);

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
     host with no observer shows it at once. */
  $effect(() => {
    if (chartBox === undefined || shown) {
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
    observer.observe(chartBox);
    return () => observer.disconnect();
  });

  /* --- The stones, painted ---------------------------------------------- */

  /* Each stone drawing rasterised once at its own pixels, by level. */
  let stoneArt = $state<HTMLCanvasElement[] | null>(null);

  $effect(() => {
    let live = true;
    const loads = stones.map(
      (href) =>
        new Promise<HTMLCanvasElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            const art = document.createElement('canvas');
            art.width = image.naturalWidth;
            art.height = image.naturalHeight;
            art.getContext('2d')?.drawImage(image, 0, 0);
            resolve(art);
          };
          image.onerror = reject;
          image.src = href;
        })
    );
    Promise.all(loads).then(
      (art) => {
        if (live) {
          stoneArt = art;
        }
      },
      () => undefined
    );
    return () => {
      live = false;
    };
  });

  /* How each day's stone is moving: from one level to another (null is no
     stone, a day nobody measured), starting at a time, for a length; a rise is
     the stone arriving, growing in as it brightens. Kept across redraws, so a
     resize mid-wave carries the wave on rather than restarting it. */
  type StoneMotion = { from: number | null; to: number | null; start: number; length: number; rise: boolean };
  const stoneMotions = new Map<number, StoneMotion>();
  let stonesRisen = false;

  $effect(() => {
    const canvas = stoneCanvas;
    const svg = calSvg;
    const art = stoneArt;
    const list = cells;
    const open = shown;
    void calW;
    const context = canvas?.getContext('2d');
    if (canvas === undefined || svg === undefined || art === null || context === null || context === undefined) {
      return;
    }
    const quiet = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const now = performance.now();
    /* Before the calendar is seen, with motion welcome, no stone is laid. */
    const rising = !quiet && open && !stonesRisen;
    const listed = new Set<number>();
    for (const cell of list) {
      listed.add(cell.index);
      const to = cell.measured ? cell.level : null;
      const motion = stoneMotions.get(cell.index);
      if (quiet || (!rising && motion === undefined)) {
        stoneMotions.set(cell.index, { from: to, to, start: 0, length: 0, rise: false });
      } else if (rising) {
        stoneMotions.set(cell.index, { from: null, to, start: now + cell.column * STONE_RISE.step, length: STONE_RISE.length, rise: true });
      } else if (motion !== undefined && motion.to !== to) {
        const halfway = now >= motion.start + motion.length * 0.5;
        stoneMotions.set(cell.index, {
          from: halfway ? motion.to : motion.from,
          to,
          start: now + cell.column * STONE_WAVE.step,
          length: STONE_WAVE.length,
          rise: false
        });
      }
    }
    for (const index of [...stoneMotions.keys()]) {
      if (!listed.has(index)) {
        stoneMotions.delete(index);
      }
    }
    if (rising) {
      stonesRisen = true;
    }
    const laid = quiet || open;
    let frame = 0;
    const paint = (time: number): void => {
      if (paintStones(context, canvas, svg, list, art, laid, time)) {
        frame = requestAnimationFrame(paint);
      }
    };
    paint(now);
    return () => cancelAnimationFrame(frame);
  });

  /* One frame of the stones: the canvas sized to its box at the screen's own
     pixels, each day's stone placed where its cell is drawn on screen (the
     calendar's own transform, so the SVG's scaling is followed exactly) and
     snapped to whole pixels, the drawing's pixels kept square. True while a
     stone is still moving. */
  function paintStones(
    context: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    svg: SVGSVGElement,
    list: typeof cells,
    art: HTMLCanvasElement[],
    laid: boolean,
    time: number
  ): boolean {
    const ratio = window.devicePixelRatio || 1;
    const box = canvas.getBoundingClientRect();
    const width = Math.round(box.width * ratio);
    const height = Math.round(box.height * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.clearRect(0, 0, width, height);
    const matrix = svg.getScreenCTM();
    if (!laid || matrix === null) {
      return false;
    }
    context.imageSmoothingEnabled = false;
    let moving = false;
    for (const cell of list) {
      const motion = stoneMotions.get(cell.index);
      if (motion === undefined) {
        continue;
      }
      const raw = motion.length > 0 ? (time - motion.start) / motion.length : 1;
      const progress = Math.min(1, Math.max(0, raw));
      moving ||= progress < 1;
      const x = Math.round((matrix.a * cell.x + matrix.e - box.left) * ratio);
      const y = Math.round((matrix.d * cell.y + matrix.f - box.top) * ratio);
      const size = Math.round(matrix.a * CELL * ratio);
      if (motion.rise) {
        const grown = 1 - (1 - progress) ** 3;
        if (motion.to === null || grown <= 0) {
          continue;
        }
        const side = size * (0.4 + 0.6 * grown);
        context.globalAlpha = grown;
        context.drawImage(art[motion.to], x + (size - side) / 2, y + (size - side) / 2, side, side);
        continue;
      }
      const eased = progress * progress * (3 - 2 * progress);
      if (motion.from !== null && eased < 1) {
        context.globalAlpha = motion.to === null ? 1 - eased : 1;
        context.drawImage(art[motion.from], x, y, size, size);
      }
      if (motion.to !== null) {
        context.globalAlpha = eased;
        context.drawImage(art[motion.to], x, y, size, size);
      }
    }
    context.globalAlpha = 1;
    return moving;
  }

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
      {#if days.length === 0 && headlines.length === 0}
        <p class="chronicle-note">{emptyNote}</p>
      {:else}
        <div class="chronicle-top">
          <div class="chronicle-side">
          {#if days.length > 0 && layers.length > 1}
            <!-- The diagram's layer, chosen at the top left of the board
              (owner direction, 2026-10-16): what the line plots and the
              calendar paints. -->
            <div class="chronicle-layers" role="group" aria-label="Diagram layer">
              {#each layers as option (option.key)}
                <button
                  type="button"
                  aria-pressed={option.key === layer?.key}
                  onclick={() => pickLayer(option.key)}>{option.label}</button>
              {/each}
            </div>
          {:else if weeks > 0}
            <!-- The switch's row, held while the layers are on their way. -->
            <div class="chronicle-layers" aria-hidden="true"></div>
          {/if}
          <dl class="chronicle-headlines">
            {#each headlines as headline (headline.key)}
              <div class="chronicle-headline">
                <dt class="chronicle-label">{headline.label}</dt>
                <dd class="chronicle-figure">{headlineFigure(headline.figure, headline.daily)}</dd>
                <dd class="chronicle-caption">{headlineCaption(headline.caption, headline.daily)}</dd>
              </div>
            {/each}
          </dl>
          </div>

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
                  <span class="chronicle-stamp" use:placeStamp={{ x: cursorX, width: chartW, words: stamp }}>{stamp}</span>
                {/if}
              </div>
              {/if}

              <div
                class="chronicle-calendar"
                bind:this={calBox}
                use:scrubAlong={calendarBinding}
                onpointermovecapture={trackY}
                onpointerdowncapture={press}>
                <canvas class="chronicle-stones" bind:this={stoneCanvas} aria-hidden="true"></canvas>
                <svg class="chronicle-svg" bind:this={calSvg} viewBox={`0 0 ${calWidth} ${CAL_HEIGHT}`} aria-hidden="true" focusable="false">
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
                      style:--chronicle-column={cell.column} />
                  {/each}
                  {#each shownMonths as month (month.column)}
                    <text class="chronicle-month" x={month.x} y={CAL_HEIGHT - 4} font-size={monthSize} text-anchor={month.anchor}>{month.label}</text>
                  {/each}
                </svg>
              </div>
            </div>
          {/if}
        </div>

        {#if weeks > 0}
          <div class="chronicle-keys">
            <div class="chronicle-scale" aria-hidden="true">
              less{#each [0, 1, 2, 3, 4] as level (level)}<i class="chronicle-step" data-grid-level={level}></i>{/each}more
            </div>
          </div>
        {/if}

        {#if accounts.length > 0}
          <div class="chronicle-accounts">
            {#each accounts as account (account.key)}
              <!-- An account holds the room of every row it can carry,
                filled or not (an account with no name is one whose payload
                is still on its way), so a payload landing never grows the
                board under the reader. -->
              <section
                class="chronicle-account"
                aria-label={account.label === '' ? undefined : account.label}
                aria-hidden={account.label === '' ? 'true' : undefined}>
                <h3 class="chronicle-account-name">{account.label}</h3>
                <dl class="chronicle-facts">
                  {#each account.facts as fact (fact.key)}
                    <div class="chronicle-fact"><dt>{fact.term}</dt><dd>{fact.value}</dd></div>
                  {/each}
                  {#each room(factSlots, account.facts.length) as slot (slot)}
                    <div class="chronicle-fact-room" aria-hidden="true"></div>
                  {/each}
                </dl>
                {#each account.lines as line (line)}<p class="chronicle-line-note">{line}</p>{/each}
                <ul class="chronicle-models">
                  {#each account.models as model (model.key)}
                    <li class="chronicle-model">
                      <span class="chronicle-model-name">{model.label}</span>
                      <span class="chronicle-model-reading">{model.reading}</span>
                      <span class="chronicle-track"><span class="chronicle-fill" style:--chronicle-share={model.fillPct / 100}></span></span>
                      <span class="chronicle-model-detail">{model.detail ?? ''}</span>
                    </li>
                  {/each}
                  {#each room(modelSlots, account.models.length) as slot (slot)}
                    <li class="chronicle-room" aria-hidden="true">
                      <span class="chronicle-model-name"></span>
                      <span class="chronicle-model-reading"></span>
                      <span class="chronicle-track"></span>
                      <span class="chronicle-model-detail"></span>
                    </li>
                  {/each}
                </ul>
              </section>
            {/each}
          </div>
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

  /* --- The figures above the graph ----------------------------------------- */

  /* The figures sit in one row above the graph at every width, and the graph
     and its calendar take the column's whole width under them (owner,
     2026-10-19: "large awkward gap in between here, either expand the heatmap
     or find a way to present the information in a better way"). Beside the
     graph the figures were a tall, narrow column that left the calendar a
     third of the room: at 1100px a 490px calendar of 9px stones beside a wide
     empty band. */
  .chronicle-top {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.25rem;
  }

  .chronicle-side {
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 1.25rem;
    min-inline-size: 0;
  }

  /* Side by side, three to a row where three fit. */
  .chronicle-headlines {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    align-content: space-evenly;
    gap: 1rem;
    margin: 0;
  }

  .chronicle-headline {
    display: grid;
    gap: 0.125rem;
    min-inline-size: 0;
  }

  .chronicle-headline dd {
    margin: 0;
  }

  .chronicle-label {
    font-family: var(--font-display);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--ledger-muted);
  }

  .chronicle-figure {
    font-family: var(--font-display);
    font-size: clamp(1.625rem, 2.8vw, 2.375rem);
    font-weight: 800;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
    color: var(--ledger-ink);
  }

  .chronicle-caption {
    min-block-size: 1.4em;
    font-family: var(--font-mono);
    font-size: var(--ledger-figure-size);
    line-height: 1.4;
    color: var(--ledger-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* --- The graph ------------------------------------------------------------ */

  .chronicle-plotting {
    display: grid;
    gap: 0.5rem;
    min-inline-size: 0;
  }

  .chronicle-chart {
    position: relative;
    block-size: clamp(11rem, 20vw, 15rem);
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

  .chronicle-baseline {
    stroke: var(--color-border);
    stroke-width: 1;
  }

  /* The layer's ink: the first source's brand, the second's page ink, and the
     contributions the calendar's own green. */
  .chronicle-plot,
  .chronicle-dot {
    --chronicle-ink: var(--color-brand);
    --chronicle-wash: 0.14;
  }

  [data-tone='1'] {
    --chronicle-ink: var(--ledger-ink);
    --chronicle-wash: 0.08;
  }

  [data-tone='grid'] {
    --chronicle-ink: var(--color-highlight);
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
    stroke: var(--ledger-muted);
    stroke-width: 1;
  }

  .chronicle-dot {
    fill: var(--ledger-raised);
    stroke: var(--chronicle-ink);
    stroke-width: 2;
  }

  /* The day's reading above the cursor. */
  .chronicle-stamp {
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: var(--chronicle-stamp-x, 0);
    transform: translateX(-50%);
    font-family: var(--font-mono);
    font-size: var(--ledger-figure-size);
    color: var(--ledger-muted);
    white-space: nowrap;
    pointer-events: none;
  }

  /* --- The calendar --------------------------------------------------------- */

  .chronicle-calendar {
    position: relative;
    cursor: crosshair;
    touch-action: pan-y;
  }

  /* Each level is its stone, by how much moss covers it as well as by colour,
     so a level never rests on colour alone; the key below draws the same
     stones from the same files. The stones lie on one canvas under the cells,
     over the calendar's whole box, and take no pointer; the cells above them
     are bare but for their outlines. */
  .chronicle-stones {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
    pointer-events: none;
  }

  .chronicle-calendar > .chronicle-svg {
    position: relative;
  }

  .chronicle-cell {
    fill: transparent;
  }

  .chronicle-step[data-grid-level='1'] {
    background-image: var(--keep-stone-1);
  }

  .chronicle-step[data-grid-level='2'] {
    background-image: var(--keep-stone-2);
  }

  .chronicle-step[data-grid-level='3'] {
    background-image: var(--keep-stone-3);
  }

  .chronicle-step[data-grid-level='4'] {
    background-image: var(--keep-stone-4);
  }

  /* The busiest day shown: the mossiest stone, ringed in the ramp's own peak,
     a step past its fourth. */
  .chronicle-cell[data-peak='true'] {
    stroke: var(--grid-cell-peak);
    stroke-width: 1;
  }

  /* A day nobody measured: an outline, never the quiet-day fill. */
  .chronicle-cell[data-measured='false'] {
    fill: transparent;
    stroke: var(--color-border);
    stroke-width: 1;
    stroke-dasharray: 2 1.5;
  }

  .chronicle-cell[data-today='true'] {
    stroke: var(--ledger-ink);
    stroke-width: 1.4;
  }

  .chronicle-cell[data-picked='true'] {
    stroke: var(--ledger-ink);
    stroke-width: 2;
  }

  .chronicle-month {
    font-family: var(--font-display);
    font-weight: 700;
    letter-spacing: 0.06em;
    fill: var(--ledger-muted);
  }

  /* --- The scale and the layer switch ---------------------------------------- */

  .chronicle-keys {
    display: flex;
    justify-content: flex-end;
    font-family: var(--font-mono);
    font-size: var(--ledger-figure-size);
    color: var(--ledger-muted);
  }

  /* The switch has no ground and no box: the chosen layer is marked by the
     brand ink and its underline. */
  /* One row at every width, so the row is the same height before its layers
     arrive as after: where the names do not fit (a narrow phone) the row
     scrolls inside its own box. */
  .chronicle-layers {
    display: flex;
    flex-wrap: nowrap;
    justify-self: start;
    gap: 0.25rem;
    min-block-size: 2.75rem;
    max-inline-size: 100%;
    overflow-x: auto;
  }

  .chronicle-layers button {
    flex: 1 1 auto;
    /* 44px on both axes at every width: a short layer name in a narrow face
       came to 40px with its padding, and it is still a whole touch target. */
    min-inline-size: 2.75rem;
    min-block-size: 2.75rem;
    padding-inline: 0.5rem;
    border: 0;
    border-block-end: 2px solid transparent;
    background: none;
    color: var(--ledger-muted);
    font-family: var(--font-display);
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    white-space: nowrap;
    cursor: pointer;
  }

  /* The picked layer is underlined by a sword (owner, 2026-10-19: "we should
     have swords"), lying under its name. */
  .chronicle-layers button[aria-pressed='true'] {
    color: var(--color-brand);
    background: var(--keep-sword-underline);
  }

  /* Drawn inside the button: the row scrolls, so an outline outside it would
     be cut by the row's own edge. */
  .chronicle-layers button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }

  /* The narrowest phones set the names a size smaller and closer, so the
     row fits its column rather than scrolling: about 8px to spare at 320px
     (Linux sets the letters about 4px wider than macOS, and a row one pixel
     over scrolls). Each button still clears the touch floor on both axes,
     the short name's by its own minimum rather than by its letters. */
  @media (max-width: 22.5rem) {
    .chronicle-layers {
      gap: 0;
    }

    .chronicle-layers button {
      padding-inline: 0.25rem;
      font-size: 0.625rem;
      letter-spacing: 0;
    }
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
    background: var(--keep-stone-0) center / 100% 100% no-repeat;
  }

  /* --- The accounts: one shape for every source ------------------------------ */

  /* Parted from the diagram by a branch rather than a rule (owner,
     2026-10-19: "the plain lines should be tree branches, or vines"). */
  .chronicle-accounts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
    gap: 1.25rem 2.5rem;
    padding-block-start: 1.25rem;
    background: var(--keep-branch-3) left top / var(--keep-branch-tile) repeat-x;
  }

  /* Every row of an account is one fixed line box, so the account's height
     is a function of its width alone — the same before its payload lands as
     after. A value too long for its line is cut with an ellipsis rather than
     taking a second one. */
  .chronicle-account {
    display: grid;
    grid-template-rows: auto auto 1fr;
    align-content: start;
    gap: 0.625rem;
    min-inline-size: 0;
  }

  .chronicle-account-name {
    min-block-size: 1.5em;
    line-height: 1.5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin: 0;
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--ledger-ink);
  }

  .chronicle-facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
    gap: 0.25rem 1.75rem;
    margin: 0;
  }

  .chronicle-fact,
  .chronicle-fact-room {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    min-block-size: 1.6em;
    font-family: var(--font-mono);
    font-size: var(--ledger-figure-size);
    line-height: 1.6;
    white-space: nowrap;
  }

  .chronicle-fact dt {
    color: var(--ledger-muted);
  }

  .chronicle-fact dd {
    min-inline-size: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
    text-align: end;
  }

  .chronicle-line-note {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--ledger-figure-size);
    color: var(--ledger-muted);
  }

  .chronicle-models {
    display: grid;
    align-content: start;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .chronicle-model,
  .chronicle-room {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.1875rem 0.75rem;
    align-items: baseline;
  }

  .chronicle-model-name,
  .chronicle-model-reading {
    min-block-size: 1.4em;
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chronicle-model-name {
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .chronicle-model-reading {
    font-family: var(--font-mono);
    font-size: var(--ledger-figure-size);
    font-variant-numeric: tabular-nums;
  }

  /* The room a model row holds when the account has fewer models than its
     room: the same boxes, painted nothing, and no row a reader or a lane
     counts as a member. */
  .chronicle-room {
    visibility: hidden;
  }

  /* A model's share is a sword (owner, 2026-10-19: "we should have
     swords"): the hilt and the point are always whole, and the blade between
     them is the share — a model with every token draws a sword the full width
     of the account, one with almost none a hilt and its point. The blade is
     one pixel column of steel repeated, so it lengthens without stretching,
     and the share is printed beside it, so the length is never the only way
     to read it. */
  .chronicle-track {
    grid-column: 1 / -1;
    block-size: 7px;
  }

  .chronicle-fill {
    --sword-hilt: 13px;
    --sword-tip: 6px;
    display: block;
    box-sizing: border-box;
    block-size: 100%;
    inline-size: calc(var(--sword-hilt) + var(--sword-tip) + (100% - var(--sword-hilt) - var(--sword-tip)) * var(--chronicle-share, 0));
    padding-inline: var(--sword-hilt) var(--sword-tip);
    background:
      var(--keep-sword-hilt) left center / var(--sword-hilt) 100% no-repeat border-box,
      var(--keep-sword-tip) right center / var(--sword-tip) 100% no-repeat border-box,
      var(--keep-sword-blade) left center / 1px 100% repeat-x content-box;
  }

  /* A model's own figures hold one line, and two on a phone — by the
     screen's width, never by what the line says, so every model row is the
     same height whatever it carries. (By the screen and not the account: a
     size container on the account sent Blink's layout into a loop that never
     returned, measured 2026-10-16.) */
  .chronicle-model-detail {
    grid-column: 1 / -1;
    block-size: 1.5em;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 0.625rem;
    line-height: 1.5;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--ledger-muted);
  }

  /* --- A phone: the figures go above the graph, two to a row ---------------- */
  @media (max-width: 47.99rem) {
    .chronicle-headlines {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.75rem;
    }

    .chronicle-figure {
      font-size: clamp(0.9375rem, 4.6vw, 1.625rem);
    }

    .chronicle-model-detail {
      block-size: 3em;
      white-space: normal;
    }

    /* Three to a row is narrow: a caption wraps rather than losing its
       words, and holds three lines whatever it says, so reading a day — a
       date in place of a total — never moves the diagram under it. */
    .chronicle-caption {
      white-space: normal;
      min-block-size: 4.2em;
    }

  }

  /* --- Motion: the line writes itself the first time it is seen and again
     on every layer chosen; the calendar's cells arrive week by week once, and
     repaint as a wave when the layer changes. Everything moving is inside
     this guard; with reduced motion the drawing is simply there. */
  @media (prefers-reduced-motion: no-preference) {
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

    .chronicle-figure,
    .chronicle-caption,
    .chronicle-layers button {
      transition: color var(--ledger-hover) var(--ledger-ease);
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
