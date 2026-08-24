/* Drives the daily-series calendar mathematics behind the full-history
 * activity dashboard (issue #158): safe-integer admission and checked sums,
 * real-calendar-date admission, week alignment, month labels, calendar
 * weekly/monthly aggregation, cumulative and rolling lenses, the series
 * summary, trailing windows, and the locale-independent labels. The hostile
 * tables mirror the numeric direction the 2026-08-24 usage-pipeline review
 * set (PR #154, finding 9): non-negative safe integers only, checked
 * summation, refusal over silent precision loss. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { gridRows } from '../src/lib/grid.ts';
import {
  checkedAdd,
  checkedTotal,
  cumulativeValues,
  dayOfWeek,
  formatDayLabel,
  formatRangeLabel,
  isCalendarDate,
  isSafeCount,
  lastWindow,
  monthLabels,
  monthlyBuckets,
  rollingAverage,
  seriesSummary,
  weekAlignedCells,
  weekColumns,
  weekStart,
  weeklyBuckets,
  weeklyValues
} from '../src/lib/usage-history.ts';

const MAX = Number.MAX_SAFE_INTEGER;

/* The realistic fixture: fifteen days from the embedded snapshot's own start
 * date (2026-08-10, a Monday), valued 1..15 so every aggregate is checkable
 * by hand. */
const start = '2026-08-10';
const fifteen = Array.from({ length: 15 }, (_, index) => index + 1);

test('isSafeCount admits exactly the non-negative safe integers', () => {
  for (const good of [0, 1, 7, 10_000, MAX]) {
    assert.ok(isSafeCount(good), `${good} is an admissible count`);
  }
  const hostile = [
    [-1, 'a negative count'],
    [-0.5, 'a negative fraction'],
    [0.5, 'a fraction'],
    [MAX + 1, 'the first integer doubles cannot count exactly'],
    [2 ** 53, '2^53 itself'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'positive infinity'],
    [Number.NEGATIVE_INFINITY, 'negative infinity'],
    ['12', 'a numeric string'],
    [null, 'null'],
    [undefined, 'undefined'],
    [true, 'a boolean'],
    [[], 'an array'],
    [{}, 'an object']
  ];
  for (const [candidate, why] of hostile) {
    assert.equal(isSafeCount(candidate), false, `${why} must refuse admission`);
  }
});

test('checked addition refuses the wrap instead of serving it', () => {
  assert.equal(checkedAdd(2, 3), 5);
  assert.equal(checkedAdd(MAX, 0), MAX, 'the ceiling itself is a real sum');
  assert.equal(checkedAdd(MAX, 1), null, 'one past the ceiling refuses');
  assert.equal(checkedAdd(MAX, MAX), null);
  assert.equal(checkedAdd(1.5, 1), null, 'an inadmissible operand refuses');
  assert.equal(checkedAdd(-1, 1), null);

  assert.equal(checkedTotal([]), 0, 'an empty series really totals zero');
  assert.equal(checkedTotal(fifteen), 120);
  // The reviewer's overflow reproduction from PR #154 finding 9, translated
  // to this side's ceiling: three admissible values whose true sum leaves
  // the exact range must refuse whole, never wrap into a "valid" figure.
  assert.equal(checkedTotal([MAX, MAX, 2]), null);
  assert.equal(checkedTotal([1, MAX]), null, 'order must not hide the overflow');
  assert.equal(checkedTotal([1, 2.5, 3]), null, 'one bad element refuses the total');
});

test('calendar-date admission is membership in the real calendar, not shape', () => {
  for (const real of ['2026-08-10', '2026-12-31', '2028-02-29', '2000-01-01']) {
    assert.ok(isCalendarDate(real), `${real} is a real day`);
  }
  const hostile = [
    ['2026-99-99', 'a well-shaped impossible month'],
    ['2026-02-30', 'a well-shaped impossible day'],
    ['2027-02-29', 'February 29th of a non-leap year'],
    ['2026-8-4', 'unpadded fields'],
    ['2026-08-4', 'a half-padded day'],
    ['2026-08-10T00:00:00Z', 'an instant is not a calendar date'],
    ['2026-08-10\n', 'a trailing newline'],
    [' 2026-08-10', 'leading whitespace'],
    ['', 'the empty string'],
    [20260810, 'a number'],
    [null, 'null']
  ];
  for (const [candidate, why] of hostile) {
    assert.equal(isCalendarDate(candidate), false, `${why} must refuse`);
  }
});

test('weekday arithmetic is UTC and anchored to known days', () => {
  assert.equal(dayOfWeek('2026-08-23'), 0, '2026-08-23 is a Sunday');
  assert.equal(dayOfWeek('2026-08-24'), 1, '2026-08-24 is a Monday');
  assert.equal(dayOfWeek('2026-01-01'), 4, '2026-01-01 is a Thursday');
  assert.equal(dayOfWeek('2028-02-29'), 2, 'the leap day of 2028 is a Tuesday');
  assert.equal(dayOfWeek('2026-02-30'), null, 'a fake date has no weekday');
  assert.equal(weekStart, 0, 'weeks align to Sunday, the contribution-calendar convention');
});

test('week alignment pads real holes and never invents a datum', () => {
  const cells = weekAlignedCells(start, fifteen);
  assert.equal(cells.length, 21, 'one lead hole + fifteen days + five tail holes');
  assert.equal(cells.length % gridRows, 0, 'always a whole number of weeks');
  assert.deepEqual(cells[0], { value: 0, date: '', absent: true }, 'Monday start leaves one Sunday hole');
  assert.deepEqual(cells[1], { value: 1, date: '2026-08-10' });
  assert.deepEqual(cells[15], { value: 15, date: '2026-08-24' }, 'one lead hole shifts the last day to index 15');
  assert.equal(cells[16].absent, true, 'days past the series end are holes');
  assert.equal(
    cells.filter((cell) => cell.absent).every((cell) => cell.date === '' && cell.value === 0),
    true,
    'a hole carries no date and no count — padding must never read as coverage'
  );
  // A Sunday start needs no lead hole at all.
  assert.equal(weekAlignedCells('2026-08-23', [4])[0].date, '2026-08-23');
});

test('week alignment refuses hostile series whole, never partially', () => {
  const rows = [
    [['2026-08-10', [1, 2.5, 3]], 'a fractional count'],
    [['2026-08-10', [1, -1, 3]], 'a negative count'],
    [['2026-08-10', [1, Number.NaN]], 'NaN'],
    [['2026-08-10', [1, MAX + 1]], 'an unsafe count'],
    [['2026-08-10', [1, '2']], 'a numeric string'],
    [['2026-99-99', [1, 2]], 'a fake start date'],
    [['2026-08-10', []], 'an empty series has no cells']
  ];
  for (const [[from, values], why] of rows) {
    assert.deepEqual(weekAlignedCells(from, values), [], `${why} must yield no grid at all`);
  }
});

test('week columns are real calendar weeks in the shape the grid consumes', () => {
  const columns = weekColumns(start, fifteen);
  assert.equal(columns.length, 3);
  for (const column of columns) {
    assert.equal(column.length, gridRows, 'every column is full height');
  }
  for (const column of columns) {
    const [top] = column;
    if (!top.absent) {
      assert.equal(dayOfWeek(top.date), weekStart, 'a dated top cell is always the week start');
    }
  }
  assert.equal(columns[1][0].date, '2026-08-16', 'the second column starts on the next Sunday');
});

test('month labels carry the year, so two Augusts can never read as one', () => {
  const december = weekColumns('2026-12-28', Array.from({ length: 10 }, () => 1));
  const ticks = monthLabels(december);
  assert.deepEqual(
    ticks.map((tick) => [tick.column, tick.initial, tick.name]),
    [
      [0, 'D', 'December 2026'],
      [1, 'J', 'January 2027']
    ],
    'a year boundary yields two labels, each naming its own year'
  );

  const twoYears = monthLabels(weekColumns('2026-08-01', Array.from({ length: 400 }, () => 0)));
  const names = twoYears.map((tick) => tick.name);
  assert.ok(names.includes('August 2026'), 'the first August is its own label');
  assert.ok(names.includes('August 2027'), 'the second August is its own label, one year on');
  assert.equal(new Set(names).size, names.length, 'no two labels may collapse into one');

  assert.deepEqual(monthLabels([[{ value: 1, date: '' }]]), [], 'undated cells produce no axis');
});

test('weekly buckets are calendar weeks with honest partial edges', () => {
  const buckets = weeklyBuckets(start, fifteen);
  assert.deepEqual(buckets, [
    { start: '2026-08-10', end: '2026-08-15', days: 6, total: 21 },
    { start: '2026-08-16', end: '2026-08-22', days: 7, total: 70 },
    { start: '2026-08-23', end: '2026-08-24', days: 2, total: 29 }
  ]);
  assert.deepEqual(weeklyBuckets(start, []), [], 'no days, no weeks');
  assert.equal(weeklyBuckets(start, [1, MAX]), null, 'an overflowing week refuses the whole table');
  assert.equal(weeklyBuckets('2026-13-01', [1]), null, 'a fake start refuses');
});

test('the calendar weekly lens paints real weeks, not seven-day chunks', () => {
  const painted = weeklyValues(start, fifteen);
  assert.equal(painted.length, fifteen.length, 'one painted value per covered day');
  // The existing chunked lens would paint the first SEVEN days with 28
  // (1+..+7). The calendar lens must paint the first SIX days — Monday
  // through Saturday of a week the series enters midstream — with 21.
  assert.deepEqual(painted.slice(0, 6), [21, 21, 21, 21, 21, 21]);
  assert.equal(painted[6], 70, 'the first full calendar week begins on Sunday the 16th');
  assert.deepEqual(painted.slice(13), [29, 29], 'the trailing partial week totals only its own days');
  assert.equal(weeklyValues(start, [0.5]), null, 'hostile input refuses the lens');
});

test('monthly buckets use real month lengths and mark partial coverage', () => {
  assert.deepEqual(monthlyBuckets(start, fifteen), [
    {
      month: '2026-08',
      name: 'August 2026',
      start: '2026-08-10',
      end: '2026-08-24',
      days: 15,
      daysInMonth: 31,
      total: 120
    }
  ]);

  const yearEnd = monthlyBuckets('2026-12-28', Array.from({ length: 10 }, () => 2));
  assert.deepEqual(
    yearEnd.map((bucket) => [bucket.month, bucket.name, bucket.days, bucket.daysInMonth, bucket.total]),
    [
      ['2026-12', 'December 2026', 4, 31, 8],
      ['2027-01', 'January 2027', 6, 31, 12]
    ],
    'a year boundary splits into two honestly partial months'
  );

  const leap = monthlyBuckets('2028-02-01', Array.from({ length: 29 }, () => 1));
  assert.equal(leap[0].daysInMonth, 29, 'a leap February is 29 days long');
  assert.equal(leap[0].days, 29);

  assert.equal(monthlyBuckets(start, [MAX, MAX]), null, 'overflow refuses the whole table');
});

test('the cumulative lens refuses the day its running total would lie', () => {
  assert.deepEqual(cumulativeValues([1, 2, 3]), [1, 3, 6]);
  assert.deepEqual(cumulativeValues([]), []);
  assert.equal(cumulativeValues([MAX, 1]), null, 'a wrapping prefix refuses the whole curve');
  assert.equal(cumulativeValues([1, MAX]), null);
  assert.equal(cumulativeValues([1, 2.5]), null, 'inadmissible counts refuse');
});

test('a rolling mean claims nothing until its window is really full', () => {
  const averaged = rollingAverage([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 7);
  assert.deepEqual(averaged.slice(0, 6), [null, null, null, null, null, null], 'six days cannot carry a seven-day mean');
  assert.deepEqual(averaged.slice(6), [4, 5, 6, 7], 'each full window is the exact trailing mean');
  assert.deepEqual(rollingAverage([5, 5, 5], 7), [null, null, null], 'a window longer than the series is all gaps');
  assert.deepEqual(rollingAverage([3, 9], 1), [3, 9], 'a one-day window is the series itself');
  for (const [window, why] of [
    [0, 'a zero window'],
    [-7, 'a negative window'],
    [2.5, 'a fractional window'],
    [MAX + 1, 'an unsafe window']
  ]) {
    assert.equal(rollingAverage([1, 2, 3], window), null, `${why} must refuse`);
  }
  assert.equal(rollingAverage([1, -2, 3], 2), null, 'hostile values refuse the whole lens');
});

test('the series summary is the exact textual reading of the graph', () => {
  assert.deepEqual(seriesSummary('2026-08-10', [0, 5, 2, 5, 0]), {
    days: 5,
    total: 12,
    peak: 5,
    peakDate: '2026-08-11',
    activeDays: 3,
    dailyMean: 2.4,
    first: '2026-08-10',
    last: '2026-08-14'
  });
  assert.equal(
    seriesSummary('2026-08-10', [0, 5, 2, 5, 0]).peakDate,
    '2026-08-11',
    'a tied peak names its FIRST day, deterministically'
  );
  assert.equal(seriesSummary('2026-08-10', []), null, 'an empty series has no summary, not a fake zero row');
  assert.equal(seriesSummary('2026-08-10', [MAX, MAX]), null, 'an unsummable series has no summary');
  assert.equal(seriesSummary('not-a-date', [1]), null);
});

test('trailing windows slice honestly and never pad what does not exist', () => {
  const seven = lastWindow(start, fifteen, 7);
  assert.equal(seven.startDate, '2026-08-18');
  assert.deepEqual(seven.values, [9, 10, 11, 12, 13, 14, 15]);

  const all = lastWindow(start, fifteen, 90);
  assert.equal(all.startDate, start, 'asking for more days than exist returns the real coverage');
  assert.deepEqual(all.values, fifteen);
  assert.notEqual(all.values, fifteen, 'the window must copy, never alias the payload');

  for (const [days, why] of [
    [0, 'a zero-day window'],
    [-30, 'a negative window'],
    [1.5, 'a fractional window']
  ]) {
    assert.equal(lastWindow(start, fifteen, days), null, `${why} must refuse`);
  }
  assert.equal(lastWindow(start, [1, 0.5], 1), null, 'hostile values refuse the slice');
});

test('every derivation is N-day-agnostic: one day, the snapshot, or beyond the current origin bound', () => {
  // The dashboard must never assume a series length. 800 days exceeds the
  // origin's present 732-day serving bound on purpose: bounds are the
  // admission boundary's job, and the derivation layer stays length-free so
  // a raised bound needs no edits here.
  for (const days of [1, 15, 800]) {
    const values = Array.from({ length: days }, (_, index) => (index % 3 === 0 ? 2 : 0));
    const columns = weekColumns('2026-08-10', values);
    assert.equal(columns.length, Math.ceil((1 + days) / gridRows), `${days} days column count`);
    const summary = seriesSummary('2026-08-10', values);
    assert.equal(summary.days, days);
    assert.equal(summary.total, values.reduce((sum, value) => sum + value, 0));
    assert.equal(cumulativeValues(values).length, days);
  }
});

test('day and range labels are locale-independent reading copy', () => {
  assert.equal(formatDayLabel('2026-08-24'), 'Aug 24, 2026');
  assert.equal(formatDayLabel('2026-01-05'), 'Jan 5, 2026', 'no leading zero on the day');
  assert.equal(formatDayLabel('2026-02-30'), '', 'a fake date renders as nothing');

  assert.equal(formatRangeLabel('2026-08-24', '2026-08-24'), 'Aug 24, 2026', 'one day is that day');
  assert.equal(formatRangeLabel('2026-08-10', '2026-08-24'), 'Aug 10–24, 2026', 'a same-month range elides the month');
  assert.equal(formatRangeLabel('2026-08-10', '2026-09-02'), 'Aug 10 – Sep 2, 2026', 'a same-year range elides the year');
  assert.equal(
    formatRangeLabel('2026-12-28', '2027-01-03'),
    'Dec 28, 2026 – Jan 3, 2027',
    'a cross-year range spells both ends'
  );
  assert.equal(formatRangeLabel('2026-08-24', '2026-08-10'), '', 'a reversed range is refused, never reordered');
  assert.equal(formatRangeLabel('2026-99-99', '2026-08-10'), '', 'a fake endpoint refuses');
});
