/* Pure helpers behind the page's calendar heatmap — the Chronicle's year of
 * cells (owner direction, 2026-10-16). Token consumption per day and
 * version-control contributions per day are laid on it alike; they differ
 * only in the noun they count, so these helpers take prepared cells and know
 * nothing about either source.
 *
 * Everything here is a plain function so a node test can drive the bucketing,
 * the calendar weeks and the month axis directly, with no browser. */

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
 * Sunday..Saturday" shape. */
export const weekStartsOn = 0;

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
 * Fixed-width by construction (issue 189): for any series it can date, the
 * output is always exactly `weeks` columns, front-padded when the series is
 * younger than the window and
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
 * The reserve and the arrival must be the same number of columns or the
 * calendar resizes the moment its payload lands, which is the zero-CLS floor
 * breaking. The origin's shipped calendar is pinned to exactly this many
 * weeks by TestVCSActivityPanelShipsARenderableGraph in
 * internal/panels/registry_test.go, and this constant is pinned to the same
 * number from this side; the two must move together. */
export const pendingWeeks = 53;

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
 * than this file's: the calendar draws both kinds of series and knows
 * neither of them. */
export type ValueFormat = (value: number) => string;

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
  const step = magnitudeStep(value);
  return step === null ? formatWhole(value) : `${step.scaled}${step.suffix}`;
}

/* formatMagnitudeFixed is the same reading with the decimal place KEPT: the
 * token board's figures are read down a column against each other, and a
 * column that alternates "129M" with "44.9B" is a column whose digits no
 * longer line up (owner directive, 2026-09-11 — the approved board prints
 * "129.0M"). Identical below the floor, where the exact grouped figure is
 * what both write.
 *
 * It shares magnitudeStep with formatMagnitude rather than repeating the step
 * walk, so the two spellings can never disagree about which UNIT a figure
 * reads in — which is the whole reason the table below is stated once. */
export function formatMagnitudeFixed(value: number): string {
  const step = magnitudeStep(value);
  return step === null ? formatWhole(value) : `${step.scaled.toFixed(1)}${step.suffix}`;
}

/* magnitudeStep picks the unit a value reads in and scales the value into it,
 * or answers null for a figure that stays exact. The promotion below is why
 * this is one function rather than two: a figure that rounds to 1000 of its
 * own unit reads better one unit up, so 999,950 is "1M" and never "1000K",
 * and both spellings above have to agree about that. */
function magnitudeStep(value: number): { scaled: number; suffix: string } | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  if (Math.abs(value) < magnitudeFloor) {
    return null;
  }
  let index = 0;
  while (index + 1 < magnitudeSteps.length && Math.abs(value) >= magnitudeSteps[index + 1][0]) {
    index += 1;
  }
  let scaled = Math.round((value / magnitudeSteps[index][0]) * 10) / 10;
  if (Math.abs(scaled) >= 1000 && index + 1 < magnitudeSteps.length) {
    index += 1;
    scaled = Math.round((value / magnitudeSteps[index][0]) * 10) / 10;
  }
  return { scaled, suffix: magnitudeSteps[index][1] };
}

/* A calendar cell's state. A day nobody measured is NOT a day that measured
 * nothing: the first is drawn hollow, the second as the empty step of the
 * ramp. Conflating them is how a feed that stopped arriving reads as a quiet
 * month (owner, 2026-10-16: "github heatmap is not updating properly, and not
 * catching it means a fault in testing procedures"). */
export function measuredCell(value: number | null | undefined, peak: number): { measured: boolean; level: number } {
  if (value === null || value === undefined) {
    return { measured: false, level: 0 };
  }
  return { measured: true, level: gridLevel(value, peak) };
}
