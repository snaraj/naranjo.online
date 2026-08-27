/* The windowing layer under a full-history activity strip (issue 158): which
 * slice of a growing daily series a reader is looking at, and the truthful
 * sentences that describe exactly that slice.
 *
 * It exists because the grid's own calendar math answers a different
 * question. lib/grid.ts knows how to lay dated cells onto real calendar
 * weeks and how to re-read them through a lens; what it has never known is
 * HOW MUCH history to draw — calendarColumns' fixed fifty-three weeks was a
 * constant, and a constant is a ceiling the day the capture pipeline runs
 * long enough to pass it. This module makes that span a reader's choice over
 * an unbounded history, and then makes the prose under the graph describe the
 * span the reader actually chose rather than the whole series behind it.
 *
 * Three rules bind everything here:
 *
 *   1. GAPS ARE GAPS. A day inside the drawn window that the capture never
 *      covered is an absent cell — dated, valueless, drawn as a hole — and
 *      never a zero, an average, or an interpolation. That distinction is
 *      already load-bearing one level down (a level-0 cell is a MEASURED
 *      quiet day) and this layer must not blur it: every count below is taken
 *      from real cells only, and every ratio states its own denominator.
 *
 *   2. FIGURES ARE CHECKED. A reported total is summed under
 *      Number.isSafeInteger admission and refuses whole rather than silently
 *      losing precision — the direction the 2026-08-24 security review of the
 *      usage pipeline set for both sides of that boundary. A figure this
 *      module cannot compute exactly is stated as unavailable, never
 *      approximated.
 *
 *   3. NOTHING HERE KNOWS A DOMAIN. Everything speaks prepared GridCells, a
 *      noun, and a value formatter, so the same window controls serve any
 *      dated daily series this site grows — the information/components split
 *      issue 165 draws.
 */

import {
  addDays,
  formatCalendarDate,
  formatWhole,
  gridMinColumns,
  gridRows,
  pendingWeeks,
  calendarColumns,
  type GridCell,
  type ValueFormat
} from './grid.ts';

/* The trailing windows a reader can ask for, shortest first. Closed by
 * design: the control is a radiogroup over exactly these, and a stored or
 * URL-borne value is admitted by MEMBERSHIP against this list (isSeriesRange)
 * rather than by shape, so no string outside it ever reaches the arithmetic
 * below.
 *
 * '12mo' is the DEFAULT, and that is not an arbitrary pick: fifty-three
 * columns is exactly what the strip has always drawn (pendingWeeks), so a
 * page that never touches this control renders precisely what it rendered
 * before this control existed. */
export const seriesRanges = ['30d', '90d', '12mo', 'all'] as const;
export type SeriesRange = (typeof seriesRanges)[number];

export function isSeriesRange(value: unknown): value is SeriesRange {
  return typeof value === 'string' && (seriesRanges as readonly string[]).includes(value);
}

export const defaultSeriesRange: SeriesRange = '12mo';

/* How many days each fixed range covers; 'all' has no fixed length by
 * definition — it is measured from the data, which is the whole point of a
 * history with no ceiling. 365 rounds up to the 53 columns the strip already
 * draws, so the default range and the shipped geometry are the same number
 * read two ways rather than two numbers that happen to agree. */
export const rangeDays: Readonly<Record<SeriesRange, number | null>> = {
  '30d': 30,
  '90d': 90,
  '12mo': 365,
  all: null
};

/* dayNumber is a calendar date as a count of whole days, and the ONE
 * membership check every caller below shares: a date this refuses is a date
 * no arithmetic here will touch.
 *
 * The round trip is the check, and it is not belt-and-braces. Shape alone
 * admits '2026-99-99', and Date.parse alone is worse than useless here —
 * asked for '2026-02-30T00:00:00Z' it does NOT return NaN, because the ISO
 * parse fails and the engine falls back to a lenient parser that silently
 * answers March 2nd. MEASURED: this function returned a valid day number for
 * February 30th until this test row was written. Re-serialising and demanding
 * the identical string back is what refuses a day that does not exist. */
function dayNumber(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  const time = parsed.getTime();
  if (Number.isNaN(time) || parsed.toISOString().slice(0, 10) !== date) {
    return null;
  }
  return Math.round(time / 86_400_000);
}

/* weekdayOf names a real calendar date's weekday in UTC — 0 is Sunday — and
 * refuses anything dayNumber refuses, so the two can never disagree about
 * which strings are dates. UTC on purpose: these are calendar labels, never
 * instants, and the answer must not move with the visitor's time zone. */
function weekdayOf(date: string): number | null {
  if (dayNumber(date) === null) {
    return null;
  }
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/* rangeWeeks is how many columns a range draws.
 *
 * A fixed range rounds UP to whole weeks, because the strip's column IS a
 * calendar week and half a column cannot be drawn: 30 days asks for 5 weeks,
 * 90 for 13, 365 for exactly the 53 the grid already reserves.
 *
 * 'all' is measured instead: from the week that contains the OLDEST real day
 * through the week that contains the newest, which is the same anchor
 * calendarColumns resolves, so the two agree about where the window ends. It
 * has no ceiling — a five-year capture returns 261 columns and the strip
 * scrolls, which is the requirement — and one floor: gridMinColumns, the
 * width below which the graph's own less/more key no longer fits beside it.
 * A young series under 'all' therefore renders a legible short window with
 * its lead-in days drawn as the dated holes they are, rather than a
 * three-column sliver.
 *
 * An undated series has no calendar to measure, so it falls back to the
 * reserve width; calendarColumns ignores the count entirely in that case and
 * chunks positionally, exactly as it does today. */
export function rangeWeeks(cells: readonly GridCell[], range: SeriesRange): number {
  const days = rangeDays[range];
  if (days !== null) {
    return Math.ceil(days / gridRows);
  }
  const dated = cells.filter((cell) => cell.date !== '');
  if (dated.length === 0) {
    return pendingWeeks;
  }
  const real = dated.filter((cell) => !cell.absent);
  const oldest = (real.length > 0 ? real[0] : dated[0]).date;
  const newest = (real.length > 0 ? real[real.length - 1] : dated[dated.length - 1]).date;
  const oldestWeekday = weekdayOf(oldest);
  const newestWeekday = weekdayOf(newest);
  if (oldestWeekday === null || newestWeekday === null) {
    return pendingWeeks;
  }
  const start = dayNumber(addDays(oldest, -oldestWeekday));
  const end = dayNumber(addDays(newest, gridRows - 1 - newestWeekday));
  if (start === null || end === null || end < start) {
    return pendingWeeks;
  }
  return Math.max(gridMinColumns, Math.ceil((end - start + 1) / gridRows));
}

/* rangeColumns draws one range: the grid's own calendar alignment, told how
 * many weeks to cover. Everything the window covers and the series does not
 * comes back as a dated absent cell — the honest hole — which is what makes a
 * '90d' choice over a fifteen-day capture legible rather than a lie in either
 * direction: fifteen real days, seventy-six visible holes, and a coverage
 * line below that counts both. */
export function rangeColumns(cells: GridCell[], range: SeriesRange): GridCell[][] {
  return calendarColumns(cells, rangeWeeks(cells, range));
}

/* isSafeCount is this module's numeric admission: a non-negative integer
 * JavaScript represents exactly. Stricter than a finiteness test on purpose —
 * a magnitude outside the safe range cannot be summed without lying, so it is
 * refused at the door rather than corrupting a headline figure. */
export function isSafeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/* checkedAdd sums two admitted counts, or refuses. The guard works because a
 * true sum above the safe range rounds onto a value that fails
 * Number.isSafeInteger, so a sum that passes is exactly right and a sum that
 * would have lied is null. */
export function checkedAdd(a: number, b: number): number | null {
  if (!isSafeCount(a) || !isSafeCount(b)) {
    return null;
  }
  const sum = a + b;
  return Number.isSafeInteger(sum) ? sum : null;
}

/* What one drawn window actually contains. Every field is measured from the
 * cells on screen, so a sentence built from this describes the graph the
 * reader is looking at and not the payload behind it. */
export interface SeriesReading {
  /* Checked total over the window's REAL days. */
  total: number;
  /* Real (captured) days inside the window. */
  days: number;
  /* Calendar days the window DRAWS, captured or not. Zero for an undated
   * series, which has no window to be a fraction of. */
  span: number;
  /* The largest single real day in the window. */
  peak: number;
  /* First and last captured days in the window. */
  first: string;
  last: string;
  /* First and last days the window draws. */
  windowFirst: string;
  windowLast: string;
}

/* seriesReading measures a windowed, DAILY-lens column set. It is read before
 * a lens is applied, because a lens repeats one aggregate across the days it
 * covers and summing that would count every week seven times — the same
 * reason the panel's summary sentence has always been lens-independent.
 *
 * Refuses (null) on a window with no captured day in it and on any figure it
 * cannot compute exactly. */
export function seriesReading(columns: readonly GridCell[][]): SeriesReading | null {
  let total = 0;
  let days = 0;
  let span = 0;
  let peak = 0;
  let first = '';
  let last = '';
  let windowFirst = '';
  let windowLast = '';
  for (const column of columns) {
    for (const cell of column) {
      if (cell.date !== '') {
        span += 1;
        if (windowFirst === '') {
          windowFirst = cell.date;
        }
        windowLast = cell.date;
      }
      if (cell.absent) {
        continue;
      }
      const sum = checkedAdd(total, cell.value);
      if (sum === null) {
        return null;
      }
      total = sum;
      days += 1;
      if (cell.value > peak) {
        peak = cell.value;
      }
      if (first === '') {
        first = cell.date;
      }
      last = cell.date;
    }
  }
  if (days === 0) {
    return null;
  }
  return { total, days, span, peak, first, last, windowFirst, windowLast };
}

/* activityReading is the sentence under the strip: what the drawn window
 * holds, in the caller's own noun and figure format.
 *
 * It is the ONE implementation of that sentence. It used to live in the token
 * panel's adapter, over the whole series, which was true only while the strip
 * drew the whole series — the moment a reader can choose a shorter window,
 * an adapter-built sentence describes a graph nobody is looking at. A
 * sentence about a window belongs where the window is decided.
 *
 * A refused reading says so rather than falling silent or rounding: an
 * unstated figure and a missing line are different claims, and only one of
 * them is honest about arithmetic it declined to do. */
export function activityReading(
  columns: readonly GridCell[][],
  noun: string,
  format: ValueFormat = formatWhole
): string {
  const reading = seriesReading(columns);
  if (reading === null) {
    return `exact ${noun} figures unavailable for this range`;
  }
  const counted = `${format(reading.total)} ${reading.total === 1 ? noun : `${noun}s`}`;
  const over = `${reading.days} ${reading.days === 1 ? 'day' : 'days'}`;
  return `${counted} over ${over}, peaking at ${format(reading.peak)}`;
}

/* coverageReading is the second half of the same honesty, and the half a
 * summary sentence structurally cannot carry: "15 days" says how much data
 * there is, never how much of the chosen window that is. Fifteen days out of
 * thirty and fifteen out of three hundred and seventy-one are the same
 * sentence above and very different graphs, so the denominator is stated.
 *
 * The range label leads, because the first question a windowed graph raises
 * is which days it is showing. An undated series carries no window to be a
 * fraction of and gets the range alone. */
export function coverageReading(columns: readonly GridCell[][]): string {
  const reading = seriesReading(columns);
  if (reading === null) {
    return '';
  }
  const label = formatDateRange(reading.first, reading.last);
  if (reading.span === 0) {
    return label;
  }
  if (reading.days >= reading.span) {
    return `${label} · every day in range captured`;
  }
  return `${label} · ${formatWhole(reading.days)} of ${formatWhole(reading.span)} days captured`;
}

/* formatDateRange renders a covered range at the shortest honest length: one
 * day is that day, a same-month range elides the repeated month, a same-year
 * range elides the repeated year, and a range crossing a year spells both
 * ends. Built from the grid's own date formatter so a range and a cell can
 * never write the same date two ways, and hand-assembled so the output is
 * identical in every runtime locale — a rendered figure is part of the tested
 * contract and must never depend on the visitor's environment.
 *
 * A reversed or malformed range renders as nothing: an impossible range is
 * refused, never quietly reordered into a claim nobody made. */
export function formatDateRange(first: string, last: string): string {
  const from = dayNumber(first);
  const to = dayNumber(last);
  if (from === null || to === null || to < from) {
    return '';
  }
  const opening = formatCalendarDate(first, false);
  const openingWithYear = formatCalendarDate(first, true);
  const closing = formatCalendarDate(last, true);
  if (opening === null || openingWithYear === null || closing === null) {
    return '';
  }
  if (first === last) {
    return closing;
  }
  if (first.slice(0, 7) === last.slice(0, 7)) {
    return `${opening}–${Number(last.slice(8, 10))}, ${last.slice(0, 4)}`;
  }
  if (first.slice(0, 4) === last.slice(0, 4)) {
    return `${opening} – ${closing}`;
  }
  return `${openingWithYear} – ${closing}`;
}
