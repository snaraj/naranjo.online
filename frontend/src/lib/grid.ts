/* Pure helpers behind ContributionGrid.svelte — the ONE contribution-heatmap
 * implementation this site has. Two panels render one: token consumption per
 * day and version-control contributions per day. They differ only in the noun
 * they count, so the grid takes prepared cells and knows nothing about either
 * source.
 *
 * Everything here is a plain function so a node test can drive the bucketing,
 * the view transforms, and the month axis directly, with no browser. */

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
  /* How many real days this cell's AGGREGATE reading covers, for a lens whose
   * period can be covered only partly (issue 158's monthly lens: a window's
   * first and last months are almost never whole, and a reader shown one
   * number for "August" deserves to know it is twelve days of August rather
   * than thirty-one). Set by the aggregating lens, read by cellPeriod, and
   * absent everywhere else — the daily lens covers exactly one day by
   * construction and the weekly lens' period is the column a reader can
   * already see. */
  days?: number;
}

/* The four ways the same daily series can be read. Daily is the raw day,
 * weekly re-reads every day as its week's total, monthly as its calendar
 * month's total, and cumulative as the running total to that point — one
 * series, four lenses, no extra payload.
 *
 * Monthly is the period the source CLIs cycle to and this grid could not
 * reach (issue 158): a week is the column a contribution strip is built from,
 * so weekly falls out of the geometry, but a month is a calendar fact that
 * crosses columns and has to be summed from the dates themselves. */
export const seriesViews = ['daily', 'weekly', 'monthly', 'cumulative'] as const;
export type SeriesView = (typeof seriesViews)[number];

/* viewColumns re-reads one series through one lens — on ALIGNED CALENDAR
 * COLUMNS (issue 189), never on the raw array position viewValues used to
 * bucket by. That distinction is the whole fix: once calendarColumns can pad
 * the front of a series to its week boundary, "every 7th array entry" and
 * "every real day in this calendar week" are no longer the same grouping, and
 * the weekly/cumulative lenses have to read the grouping a reader can
 * actually see (the grid's own columns) rather than the one the payload
 * happened to arrive in.
 *
 * Absent cells are passed through unchanged rather than folded into a sum or
 * a running total: they carry no count by definition (cellLabel already
 * refuses to read a value off one), and a level-0 real zero must stay
 * distinguishable from a day the window does not cover — this is exactly the
 * distinction issue 134 drew for the daily lens, unaffected by which lens is
 * active. */
export function viewColumns(columns: GridCell[][], view: SeriesView): GridCell[][] {
  if (view === 'daily') {
    return columns.map((column) => column.map((cell) => ({ ...cell })));
  }
  if (view === 'weekly') {
    return columns.map((column) => {
      const sum = column.reduce((total, cell) => (cell.absent ? total : total + cell.value), 0);
      return column.map((cell) => (cell.absent ? { ...cell } : { ...cell, value: sum }));
    });
  }
  if (view === 'monthly') {
    return monthlyColumns(columns);
  }
  // Cumulative: a running total across real cells only, walked in window
  // order (oldest column first) so "through week of X" means what it says
  // regardless of which end of the strip the reader scrolled to.
  let running = 0;
  return columns.map((column) =>
    column.map((cell) => {
      if (cell.absent) {
        return { ...cell };
      }
      running += cell.value;
      return { ...cell, value: running };
    })
  );
}

/* monthlyColumns re-reads every real cell as its CALENDAR month's total over
 * the days the drawn window covers, and records how many of that month's days
 * the window actually carried.
 *
 * It sums by DATE rather than by column because a month is not a column: a
 * calendar week straddling the first of the month belongs to two months, and
 * a lens that painted a whole column with one figure would report September's
 * total on two days that are still August. So the fold walks cells, keyed on
 * the cell's own YYYY-MM, which is the same "read the real calendar, not the
 * array position" rule calendarColumns already established for the columns
 * themselves.
 *
 * `days` is the honest half. The window's first and last months are almost
 * always partial, and a capture gap inside a month leaves real days
 * uncovered; both are counted here as covered-days and rendered by cellPeriod
 * as the fraction they are, so a partial month is never read as a whole one.
 * Absent cells stay absent — they carry no count to fold in and none to
 * receive, exactly as in every other lens. */
function monthlyColumns(columns: GridCell[][]): GridCell[][] {
  const totals = new Map<string, { total: number; days: number }>();
  for (const column of columns) {
    for (const cell of column) {
      if (cell.absent || cell.date.length < 7) {
        continue;
      }
      const month = cell.date.slice(0, 7);
      const carried = totals.get(month) ?? { total: 0, days: 0 };
      carried.total += cell.value;
      carried.days += 1;
      totals.set(month, carried);
    }
  }
  return columns.map((column) =>
    column.map((cell) => {
      if (cell.absent || cell.date.length < 7) {
        return { ...cell };
      }
      const carried = totals.get(cell.date.slice(0, 7));
      if (carried === undefined) {
        return { ...cell };
      }
      return { ...cell, value: carried.total, days: carried.days };
    })
  );
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
 * array) passes through unchanged rather than drifting on a second pass. */
export function calendarColumns(cells: GridCell[], weeks: number = pendingWeeks): GridCell[][] {
  const dated = cells.filter((cell) => cell.date !== '');
  if (dated.length === 0) {
    return toColumns(cells);
  }
  const byDate = new Map(dated.map((cell) => [cell.date, cell]));
  const real = dated.filter((cell) => !cell.absent);
  const anchor = (real.length > 0 ? real[real.length - 1] : dated[dated.length - 1]).date;
  const anchorWeekday = new Date(`${anchor}T00:00:00Z`).getUTCDay();
  const windowEnd = addDays(anchor, gridRows - 1 - anchorWeekday);
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

/* formatMonthLabel renders a calendar date's MONTH as 'Aug 2026' — the year
 * is not decoration here the way it can be on a single day: a full-history
 * strip contains more than one August, and a monthly figure labelled with a
 * bare month name is ambiguous exactly where the history is long enough to
 * matter. Null for anything that is not a well-formed calendar month, so a
 * caller falls back to the raw string rather than mis-labelling one. */
export function formatMonthLabel(date: string): string | null {
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(date);
  if (!match) {
    return null;
  }
  const ordinal = Number(match[2]);
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 12) {
    return null;
  }
  return `${monthAbbreviations[ordinal - 1]} ${match[1]}`;
}

const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/* daysInMonth is how long the calendar says a date's month really is — leap
 * Februaries included, because the alternative is an average, and an average
 * month length would make "12 of 30 days" a claim about no month that exists.
 *
 * Computed from the Gregorian rule rather than from a Date, deliberately:
 * Date.UTC maps a two-digit year onto the twentieth century, so the obvious
 * "day zero of the following month" trick answers for 1999 when asked about
 * 0099. The rule below has no such corner and needs no time zone. */
export function daysInMonth(date: string): number | null {
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(date);
  if (!match) {
    return null;
  }
  const ordinal = Number(match[2]);
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 12) {
    return null;
  }
  if (ordinal !== 2) {
    return monthLengths[ordinal - 1];
  }
  const year = Number(match[1]);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return leap ? 29 : 28;
}

/* weekStartDate rounds a calendar date back to the Sunday that starts its
 * week (weekStartsOn), the same convention calendarColumns aligns columns to.
 * Empty on anything addDays cannot parse, mirroring addDays' own fail-empty
 * shape rather than throwing. */
function weekStartDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return addDays(date, -parsed.getUTCDay());
}

/* cellPeriod is the view-scoped period phrase the owner's reference designs
 * pair with a value — "on Aug 13" for a day, "week of Aug 16, 2026" for a
 * week, "through week of Aug 23, 2026" for the running total through one
 * (issue 189). It reads the SAME phrase cellLabel's accessible text and the
 * token panel's DetailTip card both show, so the two can never drift apart by
 * one growing its own date formatting later — there is only ever the one
 * function that knows how a period reads. Empty for an undated cell: there is
 * no calendar phrase for a source that cannot date itself. */
export function cellPeriod(cell: GridCell, view: SeriesView): string {
  if (!cell.date) {
    return '';
  }
  if (view === 'daily') {
    return `on ${formatCalendarDate(cell.date, false) ?? cell.date}`;
  }
  if (view === 'monthly') {
    const label = formatMonthLabel(cell.date);
    if (label === null) {
      return `in ${cell.date}`;
    }
    const length = daysInMonth(cell.date);
    if (cell.days === undefined || length === null || cell.days >= length) {
      return `in ${label}`;
    }
    /* The partial-coverage reading, and the reason GridCell carries `days` at
       all: a window's edge month, or a month with a capture gap in it, is a
       smaller number than the month's name implies, and saying so is cheaper
       than the reader assuming otherwise. */
    return `in ${label} (${cell.days} of ${length} days)`;
  }
  const weekStart = weekStartDate(cell.date) || cell.date;
  const phrase = `week of ${formatCalendarDate(weekStart, true) ?? cell.date}`;
  return view === 'cumulative' ? `through ${phrase}` : phrase;
}

/* How a cell's figure is written out. Exact digits are right for a count a
 * reader wants exactly — commits, kills, sessions — and wrong for a count in
 * the hundreds of millions, which is why this is the caller's decision rather
 * than this file's: ContributionGrid draws both kinds of series and knows
 * neither of them. */
export type ValueFormat = (value: number) => string;

/* cellLabel is the one accessible text a cell carries — tooltip and
 * aria-label alike — so a magnitude is never encoded by color alone. The
 * formatter defaults to exact digits, so a caller that says nothing gets the
 * reading this function has always produced. */
export function cellLabel(
  cell: GridCell,
  noun: string,
  view: SeriesView = 'daily',
  format: ValueFormat = formatWhole
): string {
  if (cell.absent) {
    return 'no data for this day';
  }
  const counted = `${format(cell.value)} ${cell.value === 1 ? noun : `${noun}s`}`;
  const period = cellPeriod(cell, view);
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
