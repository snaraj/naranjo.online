/* Daily-series calendar mathematics for the full-history activity dashboard
 * (issue #158) — the information layer under a stat tracker or activity grid,
 * kept deliberately domain-agnostic: everything here speaks a start date plus
 * an array of daily counts, never a token, a vendor, or a panel. A component
 * that renders OSRS kills tomorrow consumes these functions exactly as the
 * token dashboard does today, which is the three-layer contract issue #165
 * names (information / components / feed).
 *
 * Two rules bind every function in this file:
 *
 *   1. NUMERIC ADMISSION IS SAFE-INTEGER ADMISSION. A count is a non-negative
 *      integer inside JavaScript's exact range (Number.isSafeInteger), and
 *      every sum is CHECKED — a derivation whose arithmetic would leave the
 *      safe range refuses whole (null / empty) rather than silently losing
 *      precision. This mirrors the direction of the 2026-08-24 security
 *      review of the usage pipeline (PR #154, finding 9): the Go boundary
 *      gained checked summation and the frontend was told to require
 *      non-negative safe integers, so this module is born under that
 *      contract instead of retrofitted to it.
 *
 *   2. GAPS ARE GAPS. A day the series does not cover is an absent hole, a
 *      rolling window that is not yet full is null, and a partial calendar
 *      week or month says how many days it really covers. Nothing here
 *      interpolates, extrapolates, or rounds a smaller truth into a nicer
 *      figure.
 *
 * Everything is a plain function over plain data so a node test drives every
 * rule without a browser, and every function is N-day-agnostic: the same code
 * serves the embedded 15-day snapshot, a multi-year history, and the empty
 * cold state, because the dashboard must never assume which one it got. */

import { addDays, gridRows, type GridCell } from './grid.ts';

/* isSafeCount is the numeric admission gate for this module: a non-negative
 * integer that JavaScript represents exactly. Fractions, negatives, NaN,
 * infinities, 2^53, and every non-number refuse. Deliberately STRICTER than
 * a plain finiteness check: a count outside the safe range cannot be summed,
 * compared, or partitioned without silent precision loss, so it is refused at
 * the door instead of corrupting a figure three derivations later. */
export function isSafeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/* checkedAdd sums two admitted counts, or refuses. The check works because
 * IEEE doubles round any true sum above the safe range onto a value outside
 * it (the first non-representable integer is 2^53 + 1, and everything at or
 * beyond 2^53 fails Number.isSafeInteger), so a sum that passes the guard is
 * exactly right and a sum that would have lied returns null. */
export function checkedAdd(a: number, b: number): number | null {
  if (!isSafeCount(a) || !isSafeCount(b)) {
    return null;
  }
  const sum = a + b;
  return Number.isSafeInteger(sum) ? sum : null;
}

/* checkedTotal folds checkedAdd over a series: the exact total, or null the
 * moment any element or any running sum refuses. An empty series totals 0 —
 * a real figure, not a refusal. */
export function checkedTotal(values: number[]): number | null {
  let total = 0;
  for (const value of values) {
    const sum = checkedAdd(total, value);
    if (sum === null) {
      return null;
    }
    total = sum;
  }
  return total;
}

/* isCalendarDate admits only a REAL calendar day in YYYY-MM-DD form. The
 * shape test alone is not admission — '2026-99-99' is perfectly shaped — so
 * the candidate must also round-trip through UTC date construction unchanged,
 * which refuses impossible days ('2026-02-30' normalizes to March and no
 * longer equals itself) and non-leap February 29ths. The same
 * membership-over-shape lesson the usage pipeline's H1 review finding
 * taught: validate what a thing IS, not what it looks like. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/* dayOfWeek names a calendar date's weekday in UTC: 0 is Sunday through 6 is
 * Saturday, or null for anything that is not a real date. UTC on purpose —
 * dates in this layer are calendar labels, never instants, so the answer
 * must not depend on the visitor's time zone. */
export function dayOfWeek(date: string): number | null {
  if (!isCalendarDate(date)) {
    return null;
  }
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/* weekStart is the calendar convention this module aligns to: weeks begin on
 * Sunday, the convention contribution calendars established. One deliberate
 * constant, not a configuration — a per-caller week start would let two
 * blocks on one page disagree about what a week is. */
export const weekStart = 0;

/* weekAlignedCells lays a daily series onto real calendar weeks: absent
 * lead-in holes from the week's start to the series' first day, the dated
 * values, then absent tail holes to the week's end, so the result's length is
 * always a whole number of weeks and position modulo seven IS the weekday.
 * The existing toColumns math chunks "seven days from wherever the series
 * begins", which draws a fine compact strip but makes a column a fiction —
 * this alignment is what lets month labels, weekly buckets, and the grid's
 * columns all mean the same calendar week.
 *
 * Absent cells deliberately carry no date: a hole claims nothing, exactly
 * like the pending-plate cells, so a renderer cannot accidentally read
 * coverage into padding. A hostile series — any non-safe count, a fake start
 * date — refuses to an empty list, never a partial grid. */
export function weekAlignedCells(startDate: string, values: number[]): GridCell[] {
  if (!isCalendarDate(startDate) || values.length === 0 || !values.every(isSafeCount)) {
    return [];
  }
  const cells: GridCell[] = [];
  const lead = (dayOfWeek(startDate) as number) - weekStart;
  for (let hole = 0; hole < lead; hole += 1) {
    cells.push({ value: 0, date: '', absent: true });
  }
  values.forEach((value, index) => {
    cells.push({ value, date: addDays(startDate, index) });
  });
  while (cells.length % gridRows !== 0) {
    cells.push({ value: 0, date: '', absent: true });
  }
  return cells;
}

/* weekColumns chunks the aligned cells into full-height grid columns — the
 * exact GridCell[][] shape ContributionGrid consumes — where every column is
 * one real calendar week starting on weekStart. */
export function weekColumns(startDate: string, values: number[]): GridCell[][] {
  const cells = weekAlignedCells(startDate, values);
  const columns: GridCell[][] = [];
  for (let start = 0; start < cells.length; start += gridRows) {
    columns.push(cells.slice(start, start + gridRows));
  }
  return columns;
}

const monthInitials = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

const monthShorts = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

export interface MonthLabel {
  /* Zero-based column where this month first leads a column. */
  column: number;
  /* One letter for the axis at grid density, e.g. 'A'. */
  initial: string;
  /* The year-qualified accessible name, e.g. 'August 2026'. */
  name: string;
}

/* monthLabels marks the column where each month first appears as a column's
 * leading dated day. It exists beside grid.ts monthTicks for one reason the
 * full-history grid makes load-bearing: the NAME carries the year. A
 * two-year series contains two Augusts, and an axis whose accessible text
 * says 'August' twice is ambiguous exactly where a long history needs it
 * not to be. Columns whose cells carry no dates simply produce no labels. */
export function monthLabels(columns: GridCell[][]): MonthLabel[] {
  const labels: MonthLabel[] = [];
  let previous = '';
  columns.forEach((column, index) => {
    const dated = column.find((cell) => !cell.absent && cell.date.length >= 7);
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
    labels.push({
      column: index,
      initial: monthInitials[ordinal - 1],
      name: `${monthNames[ordinal - 1]} ${dated.date.slice(0, 4)}`
    });
  });
  return labels;
}

/* One aggregated calendar period: a real week below, a real month further
 * down. `days` is how many days the series actually covers in the period, so
 * a partial edge period is legible instead of quietly totalling smaller. */
export interface PeriodBucket {
  /* First covered day, YYYY-MM-DD. */
  start: string;
  /* Last covered day, YYYY-MM-DD. */
  end: string;
  /* How many days the series covers inside this period. */
  days: number;
  /* The checked total over those days. */
  total: number;
}

/* weeklyBuckets aggregates a daily series into real calendar weeks. The
 * first and last buckets may be partial — their `days` says so — and every
 * total is checked; one refusing sum refuses the whole derivation, because a
 * table of weeks where one row silently wrapped is worse than no table. */
export function weeklyBuckets(startDate: string, values: number[]): PeriodBucket[] | null {
  if (!isCalendarDate(startDate) || !values.every(isSafeCount)) {
    return null;
  }
  const buckets: PeriodBucket[] = [];
  let current: PeriodBucket | null = null;
  for (let index = 0; index < values.length; index += 1) {
    const date = addDays(startDate, index);
    if (current === null || dayOfWeek(date) === weekStart) {
      current = { start: date, end: date, days: 0, total: 0 };
      buckets.push(current);
    }
    const total = checkedAdd(current.total, values[index]);
    if (total === null) {
      return null;
    }
    current.total = total;
    current.end = date;
    current.days += 1;
  }
  return buckets;
}

/* weeklyValues re-reads every day as its CALENDAR week's total — the aligned
 * counterpart of the grid's weekly lens. Where the existing lens paints
 * seven-day chunks from the series start, this paints real weeks, so a
 * series starting midweek shows a first block that honestly totals only the
 * days that week covers. */
export function weeklyValues(startDate: string, values: number[]): number[] | null {
  const buckets = weeklyBuckets(startDate, values);
  if (buckets === null) {
    return null;
  }
  const painted: number[] = [];
  for (const bucket of buckets) {
    for (let day = 0; day < bucket.days; day += 1) {
      painted.push(bucket.total);
    }
  }
  return painted;
}

export interface MonthBucket extends PeriodBucket {
  /* The calendar month, YYYY-MM. */
  month: string;
  /* Year-qualified display name, e.g. 'August 2026'. */
  name: string;
  /* How long the calendar month really is, so `days < daysInMonth` reads as
   * the partial coverage it is. */
  daysInMonth: number;
}

/* monthlyBuckets aggregates a daily series into real calendar months, edge
 * months partial and marked as such. Month lengths come from the calendar —
 * leap Februaries included — never from an average. */
export function monthlyBuckets(startDate: string, values: number[]): MonthBucket[] | null {
  if (!isCalendarDate(startDate) || !values.every(isSafeCount)) {
    return null;
  }
  const buckets: MonthBucket[] = [];
  let current: MonthBucket | null = null;
  for (let index = 0; index < values.length; index += 1) {
    const date = addDays(startDate, index);
    const month = date.slice(0, 7);
    if (current === null || current.month !== month) {
      const year = Number(date.slice(0, 4));
      const ordinal = Number(date.slice(5, 7));
      current = {
        month,
        name: `${monthNames[ordinal - 1]} ${date.slice(0, 4)}`,
        start: date,
        end: date,
        days: 0,
        daysInMonth: new Date(Date.UTC(year, ordinal, 0)).getUTCDate(),
        total: 0
      };
      buckets.push(current);
    }
    const total = checkedAdd(current.total, values[index]);
    if (total === null) {
      return null;
    }
    current.total = total;
    current.end = date;
    current.days += 1;
  }
  return buckets;
}

/* cumulativeValues is the running total, checked at every step: the day a
 * prefix sum would leave the safe range, the whole lens refuses rather than
 * drawing a curve whose tail is quietly wrong. */
export function cumulativeValues(values: number[]): number[] | null {
  const running: number[] = [];
  let sum = 0;
  for (const value of values) {
    const next = checkedAdd(sum, value);
    if (next === null) {
      return null;
    }
    sum = next;
    running.push(sum);
  }
  return running;
}

/* rollingAverage is the trailing mean over exactly `window` days. Positions
 * where the window is not yet full are null — a mean over fewer days than
 * claimed is a different figure wearing the same label, so the early days
 * render as gaps instead. The running sum is checked on the way in; the
 * subtraction on the way out is exact by construction (both operands admitted,
 * the difference a smaller non-negative integer). Hostile input — a bad
 * window, a non-safe count — refuses the whole derivation. */
export function rollingAverage(values: number[], window: number): Array<number | null> | null {
  if (!Number.isSafeInteger(window) || window <= 0 || !values.every(isSafeCount)) {
    return null;
  }
  const averages: Array<number | null> = new Array(values.length).fill(null);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    const next = checkedAdd(sum, values[index]);
    if (next === null) {
      return null;
    }
    sum = next;
    if (index >= window) {
      sum -= values[index - window];
    }
    if (index >= window - 1) {
      averages[index] = sum / window;
    }
  }
  return averages;
}

/* The headline aggregates of one daily series — the textual reading of the
 * whole graph, which is also its accessible summary. */
export interface SeriesSummary {
  /* Days covered. */
  days: number;
  /* Checked grand total. */
  total: number;
  /* The single largest day. */
  peak: number;
  /* The FIRST day reaching the peak — deterministic under ties. */
  peakDate: string;
  /* Days with any activity at all. */
  activeDays: number;
  /* total / days, exact division for display rounding downstream. */
  dailyMean: number;
  /* First and last covered days. */
  first: string;
  last: string;
}

/* seriesSummary derives the headline figures, or refuses: an empty series
 * has no summary (null, never a row of fake zeros claiming a coverage that
 * does not exist), and a series whose total cannot be summed exactly refuses
 * whole. */
export function seriesSummary(startDate: string, values: number[]): SeriesSummary | null {
  if (!isCalendarDate(startDate) || values.length === 0 || !values.every(isSafeCount)) {
    return null;
  }
  const total = checkedTotal(values);
  if (total === null) {
    return null;
  }
  let peak = 0;
  let peakIndex = 0;
  let activeDays = 0;
  values.forEach((value, index) => {
    if (value > peak) {
      peak = value;
      peakIndex = index;
    }
    if (value > 0) {
      activeDays += 1;
    }
  });
  return {
    days: values.length,
    total,
    peak,
    peakDate: addDays(startDate, peakIndex),
    activeDays,
    dailyMean: total / values.length,
    first: startDate,
    last: addDays(startDate, values.length - 1)
  };
}

/* lastWindow slices the trailing `days` of a series, re-dating the start —
 * the mechanism behind '30d / 90d / all' period controls. N-day-agnostic on
 * purpose: asking for more days than exist returns the whole series
 * unchanged, so a '90d' control over a 15-day capture shows the 15 real days
 * (and the caller labels the range it actually got, via formatRangeLabel).
 * The values come back as a copy, never an alias into the payload. */
export function lastWindow(
  startDate: string,
  values: number[],
  days: number
): { startDate: string; values: number[] } | null {
  if (!isCalendarDate(startDate) || !Number.isSafeInteger(days) || days <= 0 || !values.every(isSafeCount)) {
    return null;
  }
  if (days >= values.length) {
    return { startDate, values: [...values] };
  }
  const offset = values.length - days;
  return { startDate: addDays(startDate, offset), values: values.slice(offset) };
}

/* formatDayLabel renders a calendar date as reading copy — 'Aug 24, 2026' —
 * built by hand so the output is identical in every runtime locale, exactly
 * like the panel's thousands grouping: a rendered figure is part of the
 * tested contract and must never depend on the visitor's environment. A
 * non-date renders as nothing. */
export function formatDayLabel(date: string): string {
  if (!isCalendarDate(date)) {
    return '';
  }
  const ordinal = Number(date.slice(5, 7));
  return `${monthShorts[ordinal - 1]} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;
}

/* formatRangeLabel renders a covered range at the shortest honest length:
 * one day is that day; a same-month range elides the repeated month
 * ('Aug 10–24, 2026'); a same-year range elides the repeated year
 * ('Aug 10 – Sep 2, 2026'); a cross-year range spells both ends. A reversed
 * or malformed range renders as nothing — an impossible range is refused,
 * never reordered into a claim nobody made. */
export function formatRangeLabel(first: string, last: string): string {
  if (!isCalendarDate(first) || !isCalendarDate(last) || last < first) {
    return '';
  }
  if (first === last) {
    return formatDayLabel(first);
  }
  const month = Number(first.slice(5, 7));
  if (first.slice(0, 7) === last.slice(0, 7)) {
    return `${monthShorts[month - 1]} ${Number(first.slice(8, 10))}–${Number(last.slice(8, 10))}, ${first.slice(0, 4)}`;
  }
  if (first.slice(0, 4) === last.slice(0, 4)) {
    const lastMonth = Number(last.slice(5, 7));
    return `${monthShorts[month - 1]} ${Number(first.slice(8, 10))} – ${monthShorts[lastMonth - 1]} ${Number(last.slice(8, 10))}, ${first.slice(0, 4)}`;
  }
  return `${formatDayLabel(first)} – ${formatDayLabel(last)}`;
}
