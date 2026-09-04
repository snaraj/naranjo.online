/* Pure helpers behind ContributionGrid.svelte — the ONE contribution-heatmap
 * implementation this site has. Two panels render one: token consumption per
 * day and version-control contributions per day. They differ only in the noun
 * they count, so the grid takes prepared cells and knows nothing about either
 * source.
 *
 * Everything here is a plain function so a node test can drive the bucketing,
 * the view transforms, the month axis and the pointer arithmetic directly,
 * with no browser. */

/* The one point shape this page has, borrowed rather than restated: a type-only
 * import, erased at build and at test time, so this module still pulls nothing
 * in at run time and a coordinate cannot come to mean two things. */
import type { TipPoint } from './tooltip.ts';

/* A grid column is one week: seven stacked cells, oldest day at the top. */
export const gridRows = 7;

/* Magnitude buckets: level 0 is "nothing happened" and levels 1..4 are
 * quartiles of the window's peak, so a single unit of activity is always
 * visible and the peak cell is always the brightest. The component declares
 * exactly one color custom property per level. */
export const gridLevels = 5;

export interface GridCell {
  /* The measured magnitude for this day. */
  value: number;
  /* ISO calendar date (YYYY-MM-DD), or '' when the source cannot date it. */
  date: string;
  /* True for a padding cell that stands for a day the window does not cover —
   * a future day in the current week, or a lead-in day before the series
   * starts. Absent cells render as holes and carry no count. */
  absent?: boolean;
}

/* gridLevel buckets one cell into 0..gridLevels-1 against the window's peak. */
export function gridLevel(value: number, peak: number): number {
  if (value <= 0 || peak <= 0) {
    return 0;
  }
  return Math.min(gridLevels - 1, Math.ceil((value / peak) * (gridLevels - 1)));
}

/* peakValue is the anchor the levels quantize against. */
export function peakValue(cells: GridCell[]): number {
  let peak = 0;
  for (const cell of cells) {
    if (!cell.absent && cell.value > peak) {
      peak = cell.value;
    }
  }
  return peak;
}

/* toColumns slices a day-ordered cell list into grid columns of gridRows,
 * padding the final column with absent cells so every column is full height
 * and the grid's geometry never depends on where the window happens to end. */
export function toColumns(cells: GridCell[]): GridCell[][] {
  const columns: GridCell[][] = [];
  for (let start = 0; start < cells.length; start += gridRows) {
    const column = cells.slice(start, start + gridRows);
    while (column.length < gridRows) {
      column.push({ value: 0, date: '', absent: true });
    }
    columns.push(column);
  }
  return columns;
}

/* The shared calendar-week convention (issue 189): row 0 of every column is
 * Sunday, matching the origin's own vcs-activity payload — activityCells
 * (lib/activity.ts) resolves it from that payload's own "Columns run
 * Sunday..Saturday" shape, and the weekday axis below is written from the
 * SAME convention rather than a second guess at it. A Monday label on row 1,
 * a Wednesday on row 3, a Friday on row 5 (both zero-based) is what a
 * Sunday-start week means; a different convention would move all three. */
export const weekStartsOn = 0;

export interface WeekdayAxisLabel {
  /* Zero-based row this label marks. */
  row: number;
  readonly label: string;
}

export const weekdayAxis: readonly WeekdayAxisLabel[] = [
  { row: 1, label: 'Mon' },
  { row: 3, label: 'Wed' },
  { row: 5, label: 'Fri' }
];

/* calendarColumns realigns a dated cell list onto TRUE calendar weeks, so
 * every column starts on the same weekday (weekStartsOn) and a weekday axis
 * beside the grid is truthful for every column rather than for whichever one
 * happens to start where the series does.
 *
 * toColumns chunks by array position: row N's weekday floats with wherever
 * the series' startDate fell, which is fine for a strip with no weekday axis
 * but wrong the moment one is added. This instead walks real calendar dates:
 * it anchors on the newest dated cell (the last real day if there is one,
 * else the newest dated cell at all — an all-absent VCS tail is still real
 * information that the current week is not over), rounds that up to the
 * Saturday that ends its week, counts back weeks*7 days to the Sunday that
 * starts the trailing window, and rebuilds every day in between — a real
 * cell wherever the input already described that date, a dated-but-absent
 * cell everywhere else (issue 189: "before the series existed" and "future
 * day in the current week" are the same honest absence, just on opposite
 * ends of the window, and both keep a real date rather than the bare '' a
 * source that cannot date itself produces).
 *
 * Fixed-width by construction (issue 189 supersedes stripColumns' sizing for
 * any series calendarColumns can date): the output is always exactly `weeks`
 * columns, front-padded when the series is younger than the window and
 * silently truncated to the newest `weeks` when it is older — never fewer,
 * never more, because the day-by-day loop below runs from windowStart to
 * windowEnd and nowhere else.
 *
 * An undated series (every cell.date === '') has no calendar to align to, so
 * this falls back to the old positional chunking rather than guessing one:
 * guessing would date every cell wrongly, the same reasoning activityCells
 * already applies when the origin sends no endDate.
 *
 * Idempotent on already-aligned input: re-running it on its own output
 * recomputes the identical anchor from the identical newest dated cell, so a
 * source that is already calendar-aligned (the VCS payload's own weeks
 * array) passes through unchanged rather than drifting on a second pass.
 *
 * `anchor` OVERRIDES the newest-cell anchor above, and it is what lets several
 * series share ONE window (issue 268). Left alone, each series ends its window
 * on its own newest day — right for a lone strip, and wrong the moment two
 * strips sit in one panel and have to be read against each other, because a
 * source that stopped capturing a week early would silently draw a window a
 * week behind the one above it. A caller that knows the panel's window passes
 * its last day here and every source lays its cells onto the same calendar; a
 * date this cannot parse is ignored rather than obeyed, so a malformed anchor
 * degrades to the per-series answer instead of to an empty grid. */
export function calendarColumns(
  cells: GridCell[],
  weeks: number = pendingWeeks,
  anchor?: string
): GridCell[][] {
  const dated = cells.filter((cell) => cell.date !== '');
  if (dated.length === 0) {
    return toColumns(cells);
  }
  const byDate = new Map(dated.map((cell) => [cell.date, cell]));
  const real = dated.filter((cell) => !cell.absent);
  const supplied = anchor !== undefined && addDays(anchor, 0) === anchor ? anchor : null;
  const anchorDate =
    supplied ?? (real.length > 0 ? real[real.length - 1] : dated[dated.length - 1]).date;
  const anchorWeekday = new Date(`${anchorDate}T00:00:00Z`).getUTCDay();
  const windowEnd = addDays(anchorDate, gridRows - 1 - anchorWeekday);
  const totalDays = Math.max(0, weeks) * gridRows;
  const windowStart = addDays(windowEnd, -(totalDays - 1));
  const columns: GridCell[][] = [];
  for (let week = 0; week < weeks; week += 1) {
    const column: GridCell[] = [];
    for (let day = 0; day < gridRows; day += 1) {
      const date = addDays(windowStart, week * gridRows + day);
      column.push(byDate.get(date) ?? { value: 0, date, absent: true });
    }
    columns.push(column);
  }
  return columns;
}

/* The width of an empty graph, in columns: one year, the same window the
 * contribution calendar covers, so a panel still waiting for its series
 * renders the same shaped box the panel beside it renders full.
 *
 * That "same shaped box" is now LOAD-BEARING rather than decorative, because
 * a block is sized to its own column count (see stripColumns). The reserve
 * and the arrival must therefore be the same number of columns or the
 * calendar resizes the moment its payload lands, which is the zero-CLS floor
 * breaking. The origin's shipped calendar is pinned to exactly this many
 * weeks by TestVCSActivityPanelShipsARenderableGraph in
 * internal/panels/registry_test.go, and this constant is pinned to the same
 * number from this side; the two must move together. */
export const pendingWeeks = 53;

/* The narrowest a graph may be drawn, in columns.
 *
 * Sizing a strip to its data was the whole point once (issue #141, residual
 * risk 2): fifteen days is three columns, and three columns hard against the
 * left edge of a box built for fifty-three read as a graph that had lost its
 * data rather than as a short one. Issue 189 SUPERSEDES that rule for any
 * series calendarColumns can date: a fixed weekday axis is only truthful
 * across a fixed trailing window, and the misread the sizing rule protected
 * against is gone by construction once the window's own faint, dated absent
 * cells and its month axis say plainly "the window starts here, the data
 * doesn't" — both being visible is what used to require a short strip, not a
 * rule that shrinks the strip itself. stripColumns and this floor stay live
 * for the one case calendarColumns still falls back on: a series with no
 * dates to align by, where sizing to data is still the honest choice because
 * there is no calendar to draw a window against. The less/more key under
 * every graph measures 123.38px in all three engines, so ten columns (127px)
 * is the first count that carries it and nine (114px) is not — the key would
 * spill out of the block's start edge, which is the same defect one step
 * smaller. The rendering lanes MEASURE that per engine rather than trusting
 * this arithmetic. */
export const gridMinColumns = 10;

/* stripColumns is the width a grid block claims, in columns: exactly the
 * columns it draws, floored at gridMinColumns. Pure, so a node test can drive
 * it and a browser lane can measure what it produced.
 *
 * A block never claims MORE columns than it draws. That direction is the one
 * the owner reported, and it is the one a regression would take: a fixed
 * fifty-three used to be a claim about a series nobody had — now, for any
 * dated series, calendarColumns hands back exactly pendingWeeks columns by
 * construction, so stripColumns(claimed) resolves to exactly pendingWeeks
 * every time and this function's own floor never engages there. It stays the
 * real answer for the undated fallback above. */
export function stripColumns(drawn: number): number {
  if (!Number.isFinite(drawn) || drawn <= 0) {
    return gridMinColumns;
  }
  return Math.max(gridMinColumns, Math.trunc(drawn));
}

/* pendingColumns is the graph's CHROME with no data in it: every cell absent,
 * valueless and undated. It exists because "no series yet" was rendering as a
 * line of text where a graph belongs, which reads as a broken panel rather
 * than as a panel waiting; an outlined empty grid says the same thing in the
 * shape the reader is looking for.
 *
 * Absent is the whole point. An absent cell carries no value and no date, so
 * this fills a graph with EXACTLY as much information as the source has
 * reported, which is none. A zero would be a datapoint, and inventing one per
 * day for a year would be a doctrine violation with a very tidy look.
 *
 * How the component DRAWS these is its own decision and no longer the same
 * one it makes for a missing day inside a real window: a field of outlined
 * holes read as a graph that had failed to load (issue 134), so the empty
 * state is styled as a reserved plate instead. The data these cells carry —
 * none — is unchanged either way. */
export function pendingColumns(weeks: number = pendingWeeks): GridCell[][] {
  return Array.from({ length: Math.max(0, weeks) }, () =>
    Array.from({ length: gridRows }, () => ({ value: 0, date: '', absent: true }))
  );
}

/* addDays walks a calendar date forward in UTC. Dates in this file are plain
 * calendar labels, never instants, so UTC arithmetic keeps them stable in
 * every visitor's time zone. */
export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const moved = new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate() + days)
  );
  return moved.toISOString().slice(0, 10);
}

/* seriesCells turns a start date plus daily magnitudes into grid cells. */
export function seriesCells(startDate: string, totals: readonly number[]): GridCell[] {
  return totals.map((value, index) => ({ value, date: addDays(startDate, index) }));
}

/* monthAbbreviations indexes month numbers 1..12 with the three-letter form
 * (issue 189: replaces the earlier single-initial axis, which could not tell
 * March from May or June from July — exactly the ambiguity the owner's
 * reference designs avoid by spelling three letters). */
const monthAbbreviations = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
];

export interface MonthTick {
  /* Zero-based column the month's first covered day falls in. */
  column: number;
  /* The month's three-letter abbreviation, e.g. 'Aug' for August. */
  abbrev: string;
  /* The full month name, for the axis's accessible text. */
  name: string;
}

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

/* monthTicks marks the column where each new month begins, so the axis can
 * label the grid without a date on every cell. Columns whose cells carry no
 * date (a source that cannot date its series) simply produce no ticks.
 *
 * A column's month is read off ANY dated cell in it, absent or not (issue
 * 189): calendarColumns dates its padding — a day before the series existed
 * still has a real calendar date, it just has no count — and the axis has to
 * span that padding exactly like the reference designs do, dotted region and
 * all, rather than stopping wherever the real data happens to start.
 *
 * The leading tick is dropped when the next one sits fewer than three columns
 * away (issue 189): a fixed trailing window almost never starts on a month
 * boundary, so its first, partial month is often one or two columns wide and
 * collides with the label right beside it. Every other tick keeps its own
 * dedicated column — only the window's own left edge produces a fragment
 * short enough to collide. */
export function monthTicks(columns: GridCell[][]): MonthTick[] {
  const ticks: MonthTick[] = [];
  let previous = '';
  columns.forEach((column, index) => {
    const dated = column.find((cell) => cell.date.length >= 7);
    if (!dated) {
      return;
    }
    const month = dated.date.slice(0, 7);
    if (month === previous) {
      return;
    }
    previous = month;
    const ordinal = Number(dated.date.slice(5, 7));
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 12) {
      return;
    }
    ticks.push({ column: index, abbrev: monthAbbreviations[ordinal - 1], name: monthNames[ordinal - 1] });
  });
  if (ticks.length >= 2 && ticks[1].column - ticks[0].column < 3) {
    ticks.shift();
  }
  return ticks;
}

/* formatCalendarDate renders a plain ISO date as "Aug 12" (or, with a year,
 * "Aug 12, 2026") the way the owner's reference designs read a date — never
 * as the ISO form a machine wrote it in. Returns null for anything that is
 * not a well-formed calendar date, so a caller can fall back to the RAW
 * string rather than mis-format one: the hostile-string floor (a payload
 * value must reach the DOM verbatim, never silently rewritten into something
 * that swallows it) survives this formatting step exactly because a string
 * this cannot parse comes back unchanged, not blanked. */
export function formatCalendarDate(date: string, withYear: boolean): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const ordinal = Number(month);
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 12) {
    return null;
  }
  const label = `${monthAbbreviations[ordinal - 1]} ${Number(day)}`;
  return withYear ? `${label}, ${year}` : label;
}

/* cellPeriod is the day phrase the owner's reference designs pair with a
 * value — "on Aug 13" (issue 189). It is the ONE function that knows how a
 * cell's date reads, so cellLabel's accessible text and the DetailTip card can
 * never drift apart by one growing its own date formatting later. Empty for
 * an undated cell: there is no calendar phrase for a source that cannot date
 * itself. The weekly, monthly and cumulative phrasings left with the display
 * lenses (owner directive, 2026-09-03, issue 287: one graph per source,
 * cycled, never re-read through a lens). */
export function cellPeriod(cell: GridCell): string {
  if (!cell.date) {
    return '';
  }
  return `on ${formatCalendarDate(cell.date, false) ?? cell.date}`;
}

/* How a cell's figure is written out. Exact digits are right for a count a
 * reader wants exactly — commits, kills, sessions — and wrong for a count in
 * the hundreds of millions, which is why this is the caller's decision rather
 * than this file's: ContributionGrid draws both kinds of series and knows
 * neither of them. */
export type ValueFormat = (value: number) => string;

/* The detail card's default title, built from the caller's own noun (issue
 * 219). Every grid carries a card now, so every grid needs a title, and a
 * caller that has not chosen one should not be made to invent a string — its
 * noun is already adapter data naming exactly this. Capitalised and left
 * SINGULAR on purpose: the card's next row is the figure, so "Contribution /
 * 3 / on Jun 3" reads correctly for every count including one, where a
 * guessed plural would not. Callers with a better phrase pass `cardTitle`
 * (the token strip says "Tokens used"). */
export function nounTitle(noun: string): string {
  return noun.length === 0 ? '' : `${noun[0].toUpperCase()}${noun.slice(1)}`;
}

/* WHICH CELL A POINT NAMES (issue 219; corrected by the owner's 2026-08-31
 * defect report, "the hover bleeds").
 *
 * The strip is laid out on a fixed pitch — a cell plus the gap that follows
 * it — so a point maps to a cell by arithmetic rather than by hit-testing
 * every box. That arithmetic lives here, out of the component, so both of its
 * decisions are executable rather than pattern-matched.
 *
 * THE GAP IS THE WHOLE QUESTION, and the answer depends on who is asking.
 * Flooring a point into its slot resolves a point in the GAP to the cell
 * before it, which is right for a finger — a 10px cell cannot offer a 44px
 * target, and reaching for a cell and landing 2px past it is what fingers do —
 * and wrong for a mouse. The owner reported exactly that wrongness: hovering
 * near the edge of a cell showed the NEIGHBOUR's reading, because the
 * neighbour is what the gap resolves to and a mouse is pixel-exact enough to
 * sit in one. So a fine pointer gets no forgiveness: a point outside a cell's
 * own drawn box is -1, which the caller reads as "nothing here" and closes on,
 * rather than a confident answer about the wrong day.
 *
 * Out-of-range points still clamp for a coarse pointer, because a finger a
 * little past the last column is still reaching for the last column; for a
 * fine pointer they are outside every cell like any other gap point. */
export interface StripGeometry {
  /* Viewport coordinates of the first cell's top-left corner. */
  readonly left: number;
  readonly top: number;
  /* One cell plus the gap after it, per axis. */
  readonly pitchX: number;
  readonly pitchY: number;
  /* The cell's own drawn box — the pitch minus the gap. Equal to the pitch
   * only in a grid with no gap at all, where every point inside the strip is
   * inside some cell and the two rules below agree. */
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly columns: number;
  /* How many cells the strip actually holds; a slot past the last one is no
   * cell however the arithmetic lands. */
  readonly count: number;
}

export function stripIndexAt(
  point: TipPoint,
  box: StripGeometry,
  pointer: 'fine' | 'coarse',
  rows: number = gridRows
): number {
  if (box.pitchX <= 0 || box.pitchY <= 0 || box.columns <= 0 || rows <= 0) {
    return -1;
  }
  const offsetX = point.x - box.left;
  const offsetY = point.y - box.top;
  const rawColumn = Math.floor(offsetX / box.pitchX);
  const rawRow = Math.floor(offsetY / box.pitchY);
  if (pointer === 'fine') {
    /* Inside a real cell, or nothing: both the slot and the position WITHIN
       the slot have to land on the cell, and a point before the strip starts
       floors to a negative slot rather than to cell zero. */
    if (rawColumn < 0 || rawColumn >= box.columns || rawRow < 0 || rawRow >= rows) {
      return -1;
    }
    if (offsetX - rawColumn * box.pitchX >= box.cellWidth) {
      return -1;
    }
    if (offsetY - rawRow * box.pitchY >= box.cellHeight) {
      return -1;
    }
    const index = rawColumn * rows + rawRow;
    return index < box.count ? index : -1;
  }
  const column = Math.min(box.columns - 1, Math.max(0, rawColumn));
  const row = Math.min(rows - 1, Math.max(0, rawRow));
  const index = column * rows + row;
  return index < box.count ? index : -1;
}

/* WHERE A KEY PRESS PUTS THE GRID'S CURSOR (issue 219).
 *
 * The strip is one focus stop holding many cells, so the arrows move a cursor
 * INSIDE it — the listbox shape. This is that decision as arithmetic, out of
 * the component so it is executable rather than pattern-matched, the same
 * arrangement columnKeyIntent and swatchKeyTarget already use for the two
 * other keyboard surfaces on this page.
 *
 * `null` means "not this grid's key": the caller does nothing and, crucially,
 * does not preventDefault, so Tab still leaves and PageDown still scrolls.
 * `-1` is "no cell is current", which only Escape produces. Anything else is
 * the index the cursor lands on, and a refused move answers the CURRENT
 * cursor rather than null, so the key is still swallowed — the arrows belong
 * to the grid even at its boundary, or a reader stepping off the end gets a
 * surprise page scroll.
 *
 * THE EMPTY CURSOR IS THE CASE THAT WAS WRONG. The first arrow press on a
 * strip nobody has selected in must open on the newest data, whichever arrow
 * it is. The component used to reach that by stepping from `cells.length - 1`,
 * which works only for a NEGATIVE step: ArrowRight and ArrowDown stepped
 * PAST the end, hit the range guard and returned, so they were dead keys —
 * measured in WebKit as five ArrowRight presses and two ArrowDown presses
 * moving nothing at all while ArrowLeft moved normally (2026-08-27). A
 * reader whose cursor had been dropped — which a page scroll used to do, see
 * lib/tooltip.ts — could never get it back with the arrow that reads as
 * "forwards". Opening on the newest cell for EVERY arrow is what the
 * handler's own comment always claimed, and it is direction-symmetric, so
 * the defect cannot come back through the other axis. */
export function gridCursorTarget(
  key: string,
  cursor: number,
  dated: readonly boolean[],
  rows: number = gridRows
): number | null {
  if (key === 'Escape') {
    return cursor >= 0 ? -1 : null;
  }
  if (dated.length === 0 || rows <= 0) {
    return null;
  }
  /* The first dated cell at or after `from`, walking in `direction`. An
     undated cell is pending chrome: it carries no count, no date and no
     reading, so a cursor must never land on one. */
  const dating = (from: number, direction: number): number => {
    for (let at = from; at >= 0 && at < dated.length; at += direction) {
      if (dated[at]) {
        return at;
      }
    }
    return -1;
  };
  const newest = (): number => dating(dated.length - 1, -1);
  if (key === 'Home') {
    const first = dating(0, 1);
    return first >= 0 ? first : cursor;
  }
  if (key === 'End') {
    const last = newest();
    return last >= 0 ? last : cursor;
  }
  /* Left/right step a WEEK, up/down step a DAY: cells are emitted
     column-major, so one column along is `rows` cells along. */
  const step =
    key === 'ArrowLeft'
      ? -rows
      : key === 'ArrowRight'
        ? rows
        : key === 'ArrowUp'
          ? -1
          : key === 'ArrowDown'
            ? 1
            : null;
  if (step === null) {
    return null;
  }
  if (cursor < 0) {
    const opening = newest();
    return opening >= 0 ? opening : cursor;
  }
  const next = cursor + step;
  if (next < 0 || next >= dated.length) {
    return cursor;
  }
  const landed = dating(next, step > 0 ? 1 : -1);
  return landed >= 0 ? landed : cursor;
}

/* cellLabel is the one accessible text a cell carries — tooltip and
 * aria-label alike — so a magnitude is never encoded by color alone. The
 * formatter defaults to exact digits, so a caller that says nothing gets the
 * reading this function has always produced. */
export function cellLabel(cell: GridCell, noun: string, format: ValueFormat = formatWhole): string {
  if (cell.absent) {
    return 'no data for this day';
  }
  const counted = `${format(cell.value)} ${cell.value === 1 ? noun : `${noun}s`}`;
  const period = cellPeriod(cell);
  return period ? `${counted} ${period}` : counted;
}

/* formatWhole groups thousands by hand so the output is identical in every
 * runtime locale — a rendered figure is part of the tested contract and must
 * never depend on the visitor's environment. */
export function formatWhole(value: number): string {
  const digits = String(Math.round(value));
  let grouped = '';
  for (let index = 0; index < digits.length; index += 1) {
    const fromEnd = digits.length - index;
    if (index > 0 && fromEnd % 3 === 0 && digits[index - 1] !== '-') {
      grouped += ',';
    }
    grouped += digits[index];
  }
  return grouped;
}

/* The magnitude steps, smallest first. T is not decoration: this site already
 * serves a token series whose cumulative lens passes a trillion, and without
 * the step it would read "7700B". */
const magnitudeSteps: ReadonlyArray<readonly [number, string]> = [
  [1_000, 'K'],
  [1_000_000, 'M'],
  [1_000_000_000, 'B'],
  [1_000_000_000_000, 'T']
];

/* magnitudeFloor is where compaction starts. Below it the exact figure is
 * both readable and more informative — "1,284" says more than "1.3K" — so
 * nothing is rounded away that a reader could have used. */
export const magnitudeFloor = 10_000;

/* formatMagnitude is how a large count is written for a person to read:
 * exact grouped digits below ten thousand, then one-decimal K, M, B and T
 * steps with a trailing .0 trimmed. 1,284 stays "1,284"; 12,900 becomes
 * "12.9K"; 627,742,457 becomes "627.7M".
 *
 * It lives beside formatWhole rather than in a panel's adapter because it is
 * arithmetic about magnitudes, not knowledge about any source — the same
 * reason the level ramp and the calendar arithmetic live here. lib/token-usage
 * calls it for every figure it renders, and the heatmap calls it for the
 * cells of a series whose counts run to nine digits, so the panel's summary
 * line and the tooltip above it cannot come to write the same number two
 * different ways.
 *
 * A rounded figure is still a MEASURED figure: this shortens a reading, and
 * nothing here ever turns an absent value into a zero — cellLabel refuses to
 * read a value off an absent cell before this function is ever reached, and
 * an unreported figure renders as its own explicit dash upstream. */
export function formatMagnitude(value: number): string {
  if (!Number.isFinite(value)) {
    return formatWhole(value);
  }
  if (Math.abs(value) < magnitudeFloor) {
    return formatWhole(value);
  }
  let index = 0;
  while (index + 1 < magnitudeSteps.length && Math.abs(value) >= magnitudeSteps[index + 1][0]) {
    index += 1;
  }
  let scaled = Math.round((value / magnitudeSteps[index][0]) * 10) / 10;
  /* A figure that rounds to 1000 of its own unit reads better one unit up:
   * 999,950 is "1M", never "1000K". */
  if (Math.abs(scaled) >= 1000 && index + 1 < magnitudeSteps.length) {
    index += 1;
    scaled = Math.round((value / magnitudeSteps[index][0]) * 10) / 10;
  }
  return `${scaled}${magnitudeSteps[index][1]}`;
}
