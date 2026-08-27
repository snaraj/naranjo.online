/* Drives the shared contribution-grid helpers directly: the three series
 * lenses, the magnitude bucketing, the column padding, the month axis, and
 * the accessible cell text both panels depend on. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  addDays,
  calendarColumns,
  cellLabel,
  cellPeriod,
  daysInMonth,
  formatMagnitude,
  formatMonthLabel,
  formatWhole,
  gridLevel,
  gridLevels,
  gridMinColumns,
  gridRows,
  isSeriesView,
  magnitudeFloor,
  monthTicks,
  peakValue,
  pendingColumns,
  pendingWeeks,
  seriesCells,
  seriesViews,
  stripColumns,
  toColumns,
  viewColumns,
  weekdayAxis,
  weekStartsOn
} from '../src/lib/grid.ts';

const grid = await readFile(
  new URL('../src/lib/components/ContributionGrid.svelte', import.meta.url),
  'utf8'
);

// A tiny helper: two dated columns, one fully real and one with a trailing
// absent (future) day — the shape calendarColumns actually produces, and the
// shape viewColumns has to read correctly.
function twoColumns() {
  return [
    [
      { value: 1, date: '2026-08-09' },
      { value: 2, date: '2026-08-10' },
      { value: 3, date: '2026-08-11' },
      { value: 4, date: '2026-08-12' },
      { value: 5, date: '2026-08-13' },
      { value: 6, date: '2026-08-14' },
      { value: 7, date: '2026-08-15' }
    ],
    [
      { value: 10, date: '2026-08-16' },
      { value: 0, date: '2026-08-17', absent: true },
      { value: 0, date: '2026-08-18', absent: true },
      { value: 0, date: '2026-08-19', absent: true },
      { value: 0, date: '2026-08-20', absent: true },
      { value: 0, date: '2026-08-21', absent: true },
      { value: 0, date: '2026-08-22', absent: true }
    ]
  ];
}

test('viewColumns reads one series three ways, on ALIGNED COLUMNS rather than array position (issue 189)', () => {
  const columns = twoColumns();

  // Daily is the series itself, copied rather than aliased — a caller may
  // freely mutate what it gets back without corrupting the input columns.
  const daily = viewColumns(columns, 'daily');
  assert.deepEqual(daily, columns);
  assert.notEqual(daily[0], columns[0], 'the daily lens must copy each column, never alias it');
  assert.notEqual(daily[0][0], columns[0][0], 'the daily lens must copy each cell, never alias it');

  // Weekly: every REAL cell in a column shows that column's own sum — 28 for
  // the full first week (1+2+...+7), 10 for the second (only one real day).
  const weekly = viewColumns(columns, 'weekly');
  assert.deepEqual(
    weekly[0].map((cell) => cell.value),
    [28, 28, 28, 28, 28, 28, 28],
    'every real cell in a full column must carry that column total'
  );
  assert.deepEqual(
    weekly[1].map((cell) => cell.value),
    [10, 0, 0, 0, 0, 0, 0],
    'a short trailing week sums only its real cells, not the absent padding'
  );
  // Absence itself must survive the lens untouched — a level cannot paint
  // for a day the window does not cover, in any view.
  for (const cell of weekly[1].slice(1)) {
    assert.equal(cell.absent, true);
  }

  // Cumulative: a running total across real cells only, in window order —
  // 1, 3, 6, 10, 15, 21, 28 through the first week, then +10 = 38 on the one
  // real day of the second, absent cells left alone.
  const cumulative = viewColumns(columns, 'cumulative');
  assert.deepEqual(
    cumulative[0].map((cell) => cell.value),
    [1, 3, 6, 10, 15, 21, 28]
  );
  assert.equal(cumulative[1][0].value, 38, 'the running total must carry across the column boundary');
  for (const cell of cumulative[1].slice(1)) {
    assert.equal(cell.absent, true);
    assert.equal(cell.value, 0, 'an absent cell must not be handed a running total it never earned');
  }

  // No columns is no columns, in every lens.
  for (const view of seriesViews) {
    assert.deepEqual(viewColumns([], view), []);
  }
});

test('series views are a closed set', () => {
  assert.deepEqual([...seriesViews], ['daily', 'weekly', 'monthly', 'cumulative']);
  for (const view of seriesViews) {
    assert.ok(isSeriesView(view));
  }
  for (const rogue of ['hourly', '', null, 7, undefined]) {
    assert.equal(isSeriesView(rogue), false, `${String(rogue)} must not pass as a view`);
  }
});

test('levels quantize against the peak, and nothing is level 0 by accident', () => {
  assert.equal(gridLevel(0, 100), 0, 'no activity is level 0');
  assert.equal(gridLevel(5, 0), 0, 'a peakless window cannot rank anything');
  assert.equal(gridLevel(1, 100), 1, 'a single unit of activity must still be visible');
  assert.equal(gridLevel(100, 100), gridLevels - 1, 'the peak day is always the brightest');
  assert.equal(gridLevel(50, 100), 2);
  assert.equal(gridLevel(1000, 100), gridLevels - 1, 'a level can never exceed the ramp');
});

test('peakValue ignores padding cells', () => {
  assert.equal(peakValue([{ value: 3, date: '' }, { value: 9, date: '', absent: true }]), 3);
  assert.equal(peakValue([]), 0);
});

test('columns are always full height, padded with dated-less absent cells', () => {
  const columns = toColumns(seriesCells('2026-08-01', [1, 2, 3, 4, 5, 6, 7, 8, 9]));
  assert.equal(columns.length, 2);
  for (const column of columns) {
    assert.equal(column.length, gridRows, 'every column must be full height so the grid never reflows');
  }
  assert.equal(columns[0][0].date, '2026-08-01');
  assert.equal(columns[1][1].date, '2026-08-09');
  assert.equal(columns[1][2].absent, true, 'days the window does not cover are holes, not zeros');
  assert.equal(toColumns([]).length, 0);
});

test('day arithmetic is UTC calendar arithmetic and survives month ends', () => {
  assert.equal(addDays('2026-08-30', 3), '2026-09-02');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29', 'leap days are real days');
  assert.equal(addDays('not-a-date', 1), '');
});

test('weekStartsOn and weekdayAxis are the one Sunday-start convention every column and every gutter reads (issue 189)', () => {
  assert.equal(
    weekStartsOn,
    0,
    "the convention is Sunday-start, sourced from activity.ts's own \"Columns run Sunday..Saturday\" comment and the VCS snapshot's endDate"
  );
  assert.deepEqual(
    weekdayAxis.map((entry) => [entry.row, entry.label]),
    [
      [1, 'Mon'],
      [3, 'Wed'],
      [5, 'Fri']
    ],
    'a Sunday-start week puts Monday on row 1, Wednesday on row 3, Friday on row 5 (zero-based)'
  );
});

test('calendarColumns falls back to positional chunking for an undated series, rather than inventing a calendar for one', () => {
  const undated = [
    { value: 1, date: '' },
    { value: 2, date: '' },
    { value: 3, date: '' }
  ];
  assert.deepEqual(calendarColumns(undated, 5), toColumns(undated));
});

test('every calendarColumns window opens on the weekStartsOn weekday, whatever weekday the series itself starts on', () => {
  for (const start of [
    '2026-08-09',
    '2026-08-10',
    '2026-08-11',
    '2026-08-12',
    '2026-08-13',
    '2026-08-14',
    '2026-08-15'
  ]) {
    const columns = calendarColumns(seriesCells(start, [1]), 4);
    assert.equal(columns.length, 4);
    assert.equal(
      new Date(`${columns[0][0].date}T00:00:00Z`).getUTCDay(),
      weekStartsOn,
      `a series starting ${start} must still open its window on the shared week-start weekday`
    );
    // Every column, not only the first, opens on the same weekday.
    for (const column of columns) {
      assert.equal(new Date(`${column[0].date}T00:00:00Z`).getUTCDay(), weekStartsOn);
    }
  }
});

// The direction the owner's reference designs draw: a series younger than
// its window front-pads with DATED absences, never a blank hole — "before
// the series existed" still names a real calendar day.
test('calendarColumns front-pads a series younger than its window with dated absences (issue 189)', () => {
  // 2026-08-12 is a Wednesday; 2026-08-14 (its last real day) is a Friday.
  const cells = seriesCells('2026-08-12', [1, 2, 3]);
  const columns = calendarColumns(cells, 2);
  assert.equal(columns.length, 2, 'the window is always exactly the requested number of weeks');
  assert.deepEqual(columns[0].map((cell) => cell.date), [
    '2026-08-02',
    '2026-08-03',
    '2026-08-04',
    '2026-08-05',
    '2026-08-06',
    '2026-08-07',
    '2026-08-08'
  ]);
  for (const cell of columns[0]) {
    assert.equal(cell.absent, true, 'a day before the series existed is a dated absence, not a dateless hole');
    assert.equal(cell.value, 0);
  }
  assert.deepEqual(columns[1].map((cell) => cell.value), [0, 0, 0, 1, 2, 3, 0]);
  assert.deepEqual(
    columns[1].map((cell) => Boolean(cell.absent)),
    [true, true, true, false, false, false, true]
  );
  assert.equal(columns[1][3].date, '2026-08-12', 'the series own first real day keeps its own date');
  assert.equal(
    columns[1][6].date,
    '2026-08-15',
    'a future day in the anchor week still carries a real calendar date even though nothing was measured there'
  );
});

test('calendarColumns defaults to the fixed pendingWeeks window and truncates a much longer series to its newest days', () => {
  const cells = seriesCells('2020-01-01', new Array(1000).fill(1));
  const columns = calendarColumns(cells);
  assert.equal(
    columns.length,
    pendingWeeks,
    'the default window is the same fixed trailing calendar the empty-state chrome reserves'
  );
  const oldestKept = columns[0][0].date;
  const lastColumn = columns[columns.length - 1];
  const newestKept = lastColumn[lastColumn.length - 1].date;
  const newestReal = cells[cells.length - 1].date;
  assert.notEqual(
    oldestKept,
    cells[0].date,
    'the oldest day of a thousand-day series must not survive a 53-week window'
  );
  assert.ok(
    Date.parse(newestReal) <= Date.parse(newestKept),
    'the window cannot end before the newest real day it is supposed to be showing'
  );
  const windowSpanDays = (Date.parse(newestKept) - Date.parse(oldestKept)) / 86_400_000;
  assert.equal(
    windowSpanDays,
    pendingWeeks * gridRows - 1,
    'the window spans exactly weeks*7 days from its first cell to its last, by construction'
  );
});

test('calendarColumns is idempotent on its own output, so an already-aligned source does not drift on a second pass (issue 189)', () => {
  const cells = seriesCells('2026-01-05', new Array(400).fill(2));
  const once = calendarColumns(cells);
  const twice = calendarColumns(once.flat(), once.length);
  assert.deepEqual(twice, once);
});

test('the month axis marks each month once, at the column it starts in, with a three-letter abbreviation (issue 189)', () => {
  const ticks = monthTicks(toColumns(seriesCells('2026-08-01', new Array(70).fill(1))));
  assert.deepEqual(
    ticks.map((tick) => tick.abbrev),
    ['Aug', 'Sep', 'Oct'],
    'August, September, October, each marked once, spelled out enough to tell March from May'
  );
  assert.equal(ticks[0].column, 0);
  assert.equal(ticks[0].name, 'August');
  assert.ok(ticks[1].column > 0);
  // A grid whose cells carry no dates simply has no axis.
  assert.deepEqual(monthTicks([[{ value: 1, date: '' }]]), []);
});

// The month a column belongs to is read off ANY dated cell in it, including
// one that carries no count: calendarColumns dates its own front padding (a
// day before the series existed), and the axis has to span that padding
// exactly like the reference designs do, not stop wherever real data begins.
test('the month axis reads a dated-but-absent column too, not only a column with real data (issue 189)', () => {
  const columns = [[{ value: 0, date: '2026-08-01', absent: true }]];
  assert.deepEqual(monthTicks(columns).map((tick) => tick.abbrev), ['Aug']);
});

// A fixed trailing window almost never opens on a month boundary, so its
// first column is often a one- or two-column fragment of a month that
// collides with the tick right beside it. The axis drops only that leading
// fragment — every other tick keeps its own column.
test('a leading month tick fewer than three columns from the next is dropped, so it cannot collide with it (issue 189)', () => {
  const columns = [
    [{ value: 1, date: '2026-07-25' }],
    [{ value: 1, date: '2026-08-01' }],
    [{ value: 1, date: '2026-08-08' }],
    [{ value: 1, date: '2026-09-05' }]
  ];
  const ticks = monthTicks(columns);
  assert.deepEqual(
    ticks.map((tick) => tick.abbrev),
    ['Aug', 'Sep'],
    'the one-column July fragment must not survive to collide with August'
  );
  assert.equal(ticks[0].column, 1, 'August now starts the axis, at its own real column');
  assert.equal(ticks[1].column, 3);

  // The boundary itself: three columns is the floor a leading fragment must
  // clear to survive, not merely a rough gap. A two-column fragment is still
  // dropped; a three-column one is not.
  const narrow = [
    [{ value: 1, date: '2026-07-01' }],
    [{ value: 1, date: '2026-07-02' }],
    [{ value: 1, date: '2026-08-01' }],
    [{ value: 1, date: '2026-09-01' }]
  ];
  assert.deepEqual(
    monthTicks(narrow).map((tick) => tick.abbrev),
    ['Aug', 'Sep'],
    'a two-column-wide leading fragment is still narrower than the floor'
  );

  const exactlyThree = [
    [{ value: 1, date: '2026-07-01' }],
    [{ value: 1, date: '2026-07-02' }],
    [{ value: 1, date: '2026-07-03' }],
    [{ value: 1, date: '2026-08-01' }],
    [{ value: 1, date: '2026-09-01' }]
  ];
  assert.deepEqual(
    monthTicks(exactlyThree).map((tick) => tick.abbrev),
    ['Jul', 'Aug', 'Sep'],
    'a three-column-wide leading fragment is wide enough to keep its own tick'
  );
});

test('cell text always carries the count, so color is never the only encoding', () => {
  assert.equal(cellLabel({ value: 1, date: '2026-08-12' }, 'contribution'), '1 contribution on Aug 12');
  assert.equal(cellLabel({ value: 0, date: '2026-08-12' }, 'contribution'), '0 contributions on Aug 12');
  assert.equal(cellLabel({ value: 12000, date: '' }, 'token'), '12,000 tokens');
  assert.equal(
    cellLabel({ value: 5, date: '2026-08-12' }, 'token', 'cumulative'),
    '5 tokens through week of Aug 9, 2026',
    'an aggregated reading must say which reading it is, in the same phrase the reference designs use'
  );
  assert.equal(
    cellLabel({ value: 28, date: '2026-08-12' }, 'token', 'weekly'),
    '28 tokens week of Aug 9, 2026',
    'the weekly reading names its own week, without cumulative’s "through" prefix'
  );
  assert.equal(cellLabel({ value: 0, date: '', absent: true }, 'token'), 'no data for this day');
});

// cellPeriod is the one place a view is turned into a phrase, shared by
// cellLabel's accessible text and the token panel's DetailTip card (issue
// 189) — pinning it directly here is what keeps the two readable
// independently of cellLabel's own concatenation.
test('cellPeriod reads the view-scoped phrase the reference designs pair with a value (issue 189)', () => {
  assert.equal(cellPeriod({ value: 1, date: '2026-08-13' }, 'daily'), 'on Aug 13');
  // Aug 13, 2026 is a Thursday; its calendar week (weekStartsOn = Sunday)
  // starts on Aug 9.
  assert.equal(
    cellPeriod({ value: 1, date: '2026-08-13' }, 'weekly'),
    'week of Aug 9, 2026',
    'a Thursday belongs to the week that started the Sunday before it'
  );
  // Aug 16, 2026 is itself a Sunday, so it is already its own week start.
  assert.equal(cellPeriod({ value: 1, date: '2026-08-16' }, 'weekly'), 'week of Aug 16, 2026');
  assert.equal(cellPeriod({ value: 1, date: '2026-08-13' }, 'cumulative'), 'through week of Aug 9, 2026');
  assert.equal(cellPeriod({ value: 1, date: '' }, 'daily'), '', 'an undated cell has no calendar phrase');
  assert.equal(cellPeriod({ value: 1, date: '' }, 'weekly'), '');
  // A week start can fall in the prior month, and the phrase must say so.
  assert.equal(
    cellPeriod({ value: 1, date: '2026-08-01' }, 'weekly'),
    'week of Jul 26, 2026',
    'Aug 1, 2026 is a Saturday; its week starts the Sunday before, in July'
  );
  // A hostile-string date that cannot be calendar-parsed still degrades to
  // the raw string rather than throwing or blanking it (the same
  // never-corrupt-a-payload floor formatCalendarDate documents).
  assert.equal(cellPeriod({ value: 1, date: 'not-a-date' }, 'daily'), 'on not-a-date');
});

/* The monthly lens (issue 158) — the period the source CLIs cycle to and this
 * grid could not reach, because a month is the one calendar period that is
 * NOT the column a contribution strip is built from. */
test('the monthly lens sums real calendar months across column boundaries', () => {
  // Two columns straddling a month boundary: Aug 30-31 then Sep 1-5, with one
  // absent day inside September and the week's tail absent.
  const columns = [
    [
      { value: 0, date: '2026-08-29', absent: true },
      { value: 5, date: '2026-08-30' },
      { value: 7, date: '2026-08-31' },
      { value: 1, date: '2026-09-01' },
      { value: 2, date: '2026-09-02' },
      { value: 0, date: '2026-09-03', absent: true },
      { value: 4, date: '2026-09-04' }
    ],
    [
      { value: 8, date: '2026-09-05' },
      { value: 0, date: '2026-09-06', absent: true },
      { value: 0, date: '2026-09-07', absent: true },
      { value: 0, date: '2026-09-08', absent: true },
      { value: 0, date: '2026-09-09', absent: true },
      { value: 0, date: '2026-09-10', absent: true },
      { value: 0, date: '2026-09-11', absent: true }
    ]
  ];
  const monthly = viewColumns(columns, 'monthly');
  // August's real days are 30 and 31: 12. September's are 1, 2, 4 and 5: 15 —
  // summed ACROSS the column boundary, which is the whole point: a weekly
  // lens would have reported one number for a column holding both months.
  assert.deepEqual(
    monthly[0].map((cell) => cell.value),
    [0, 12, 12, 15, 15, 0, 15]
  );
  assert.deepEqual(
    monthly[1].map((cell) => cell.value),
    [15, 0, 0, 0, 0, 0, 0],
    'the second column carries the same September total, not its own sum'
  );
  // Absent cells keep their absence and their zero in this lens exactly as in
  // every other: a hole cannot be handed a total it never contributed to.
  assert.equal(monthly[0][0].absent, true);
  assert.equal(monthly[0][5].absent, true);
  assert.equal(monthly[0][5].days, undefined, 'an absent cell must carry no coverage claim');
  // And every real cell records how many of its month's days the window
  // actually covered — the honest half, read back by cellPeriod below.
  assert.equal(monthly[0][1].days, 2, 'August contributed two covered days here');
  assert.equal(monthly[0][3].days, 4, 'September contributed four covered days here');
  assert.equal(monthly[1][0].days, 4);
  // The input is never mutated, in this lens like every other.
  assert.equal(columns[0][1].value, 5);
  assert.equal(columns[0][1].days, undefined);
  assert.deepEqual(viewColumns([], 'monthly'), []);
});

test('a monthly cell says which month it is, and how much of that month it really covers', () => {
  // A whole month reads plainly. February 2026 is 28 days; a cell claiming 28
  // covered days is a complete month and needs no fraction.
  assert.equal(
    cellPeriod({ value: 9, date: '2026-02-14', days: 28 }, 'monthly'),
    'in Feb 2026',
    'a fully covered month must not be labelled with a fraction'
  );
  // A partial month says so — the window's edge months and a capture gap are
  // both smaller than the month's name implies.
  assert.equal(
    cellPeriod({ value: 9, date: '2026-02-14', days: 12 }, 'monthly'),
    'in Feb 2026 (12 of 28 days)'
  );
  // Leap February is 29, so the same 28 days is now a PARTIAL month. A month
  // length taken from an average would get this wrong in both directions.
  assert.equal(
    cellPeriod({ value: 9, date: '2028-02-14', days: 28 }, 'monthly'),
    'in Feb 2028 (28 of 29 days)'
  );
  assert.equal(cellPeriod({ value: 9, date: '2028-02-14', days: 29 }, 'monthly'), 'in Feb 2028');
  // The year is part of the label, not decoration: a multi-year strip holds
  // more than one August, and a bare month name is ambiguous exactly where
  // the history is long enough for it to matter.
  assert.equal(cellPeriod({ value: 9, date: '2025-08-03', days: 31 }, 'monthly'), 'in Aug 2025');
  assert.notEqual(
    cellPeriod({ value: 9, date: '2025-08-03', days: 31 }, 'monthly'),
    cellPeriod({ value: 9, date: '2026-08-03', days: 31 }, 'monthly')
  );
  // No coverage claim at all reads as the plain month rather than as a
  // fabricated fraction.
  assert.equal(cellPeriod({ value: 9, date: '2026-02-14' }, 'monthly'), 'in Feb 2026');
  // An undated cell has no calendar phrase, in this lens like the others; a
  // hostile string degrades to itself rather than being blanked or thrown on.
  assert.equal(cellPeriod({ value: 9, date: '' }, 'monthly'), '');
  assert.equal(cellPeriod({ value: 9, date: '2026-13-01', days: 3 }, 'monthly'), 'in 2026-13-01');
  assert.equal(cellPeriod({ value: 9, date: 'not-a-date' }, 'monthly'), 'in not-a-date');
  // The accessible text folds the same phrase in, so a screen reader hears
  // the coverage the sighted tooltip shows.
  assert.equal(
    cellLabel({ value: 12, date: '2026-02-14', days: 12 }, 'token', 'monthly'),
    '12 tokens in Feb 2026 (12 of 28 days)'
  );
});

test('month lengths come from the calendar, never from an average', () => {
  assert.equal(daysInMonth('2026-01-31'), 31);
  assert.equal(daysInMonth('2026-02-01'), 28);
  assert.equal(daysInMonth('2028-02-01'), 29, '2028 is a leap year');
  assert.equal(daysInMonth('2000-02-01'), 29, '2000 is divisible by 400 and IS a leap year');
  assert.equal(daysInMonth('1900-02-01'), 28, '1900 is divisible by 100 and is NOT a leap year');
  assert.equal(daysInMonth('2026-04-01'), 30);
  assert.equal(daysInMonth('2026-12-01'), 31);
  // A bare month is enough; a nonsense month or a non-date is refused rather
  // than guessed at.
  assert.equal(daysInMonth('2026-06'), 30);
  assert.equal(daysInMonth('2026-13'), null);
  assert.equal(daysInMonth('2026-00'), null);
  assert.equal(daysInMonth('not-a-date'), null);
  assert.equal(daysInMonth(''), null);
  assert.equal(formatMonthLabel('2026-08-13'), 'Aug 2026');
  assert.equal(formatMonthLabel('2026-08'), 'Aug 2026');
  assert.equal(formatMonthLabel('2026-13-01'), null);
  assert.equal(formatMonthLabel('nope'), null);
});

test('thousands grouping is locale-independent', () => {
  assert.equal(formatWhole(0), '0');
  assert.equal(formatWhole(999), '999');
  assert.equal(formatWhole(1000), '1,000');
  assert.equal(formatWhole(1234567), '1,234,567');
});

/* Human-readable magnitudes (owner directive, 2026-08-25: a heatmap cell read
 * "627,742,457 on Aug 11" while the sentence under the same graph read "7.7B
 * tokens over 15 days" — two ways of writing one number, on one card). This
 * is the ONE implementation both readings now come from; lib/token-usage's
 * formatTokenCount is a name for it, pinned against it in its own suite. */
test('a magnitude is written the way a person reads one', () => {
  // Below the floor the exact figure is both readable and more informative,
  // so nothing is rounded away that a reader could have used.
  assert.equal(formatMagnitude(0), '0');
  assert.equal(formatMagnitude(1284), '1,284');
  assert.equal(formatMagnitude(9999), '9,999');
  assert.equal(magnitudeFloor, 10_000);
  // ...and above it, one decimal, with a trailing .0 trimmed.
  assert.equal(formatMagnitude(10_000), '10K');
  assert.equal(formatMagnitude(12_900), '12.9K');
  assert.equal(formatMagnitude(9_421_770), '9.4M');
  assert.equal(formatMagnitude(627_742_457), '627.7M');
  assert.equal(formatMagnitude(7_700_000_000), '7.7B');
  // The T step, which is not decoration: this site's own cumulative lens
  // passes a trillion, and without it the reading would be "7700B".
  assert.equal(formatMagnitude(1_000_000_000_000), '1T');
  assert.equal(formatMagnitude(7_700_000_000_000), '7.7T');
  // A figure that rounds to 1000 of its own unit reads one unit up...
  assert.equal(formatMagnitude(999_950), '1M');
  assert.equal(formatMagnitude(999_950_000_000), '1T');
  // ...except at the top, where there is no unit above it to promote to and
  // the honest reading is the big one rather than a wrong one.
  assert.equal(formatMagnitude(999_950_000_000_000), '1000T');
  // Nothing a caller can hand it turns into a lie: a value this cannot scale
  // falls back to the exact rendering rather than inventing a unit.
  assert.equal(formatMagnitude(Number.NaN), 'NaN');
  // The magnitude reading rides the cell label too, so the tooltip and the
  // accessible text of one cell can never be two different numbers — and the
  // default is still exact, for the grid that counts commits.
  const cell = { value: 627_742_457, date: '2026-08-11' };
  assert.equal(cellLabel(cell, 'token', 'daily'), '627,742,457 tokens on Aug 11');
  assert.equal(
    cellLabel(cell, 'token', 'daily', formatMagnitude),
    '627.7M tokens on Aug 11'
  );
  // An absent cell has no value to format, and no formatter is ever asked for
  // one: the honesty floor sits ahead of the formatting step.
  assert.equal(
    cellLabel({ value: 0, date: '2026-08-11', absent: true }, 'token', 'daily', () => 'INVENTED'),
    'no data for this day'
  );
});

// The graph a panel renders while it waits for its series (owner directive,
// issue 127). It replaced a line of text where the graph belongs, and the
// honesty invariant is the whole design: an empty graph must contain exactly
// as many datapoints as the source has reported, which is none.
test('the pending graph is chrome with no datapoints in it', () => {
  const columns = pendingColumns();
  assert.equal(columns.length, pendingWeeks, 'the empty graph is a year wide, like the real one');
  // Parity pin, and it became load-bearing the day a block started sizing
  // itself to its column count: the reserve and the payload that lands in it
  // must be the SAME number of columns, or the calendar changes width on
  // arrival and the zero-CLS floor is gone. The other side of this number is
  // TestVCSActivityPanelShipsARenderableGraph in
  // internal/panels/registry_test.go, which pins the shipped calendar to
  // exactly 53 weeks and names this constant when it fails. Move one and the
  // other goes red.
  assert.equal(
    pendingWeeks,
    53,
    'the reserve must stay exactly as wide as the shipped calendar; see internal/panels/registry_test.go'
  );
  for (const column of columns) {
    assert.equal(column.length, gridRows, 'every column is a full week, like the real ones');
    for (const cell of column) {
      // Absent is what makes this honest rather than decorative: an absent
      // cell carries no value and no date, so it can never be read as a
      // measurement. How it is DRAWN is the component's decision and is
      // pinned separately below.
      assert.equal(cell.absent, true);
      assert.equal(cell.value, 0);
      assert.equal(cell.date, '', 'a placeholder day must not claim a date it was never told');
    }
  }
  // Every cell absent means no peak, so the ramp cannot paint a level: a
  // placeholder can never be mistaken for activity, whatever it is passed to.
  assert.equal(peakValue(columns.flat()), 0);
  assert.equal(cellLabel(columns[0][0], 'token'), 'no data for this day');
  // ...and no month axis either, since an undated column cannot be labelled.
  assert.deepEqual(monthTicks(columns), []);
  // A caller asking for nothing gets nothing, never a negative-length loop.
  assert.deepEqual(pendingColumns(0), []);
  assert.deepEqual(pendingColumns(-3), []);
});

// How WIDE a graph is drawn (issue #141, residual risk 2). The box used to be
// a year wide whatever it held, so a fifteen-day series was three columns
// against the left edge of fifty-three columns of nothing. Both directions are
// pinned here because either alone is satisfied by a page that got it wrong: a
// block that always claims 53 passes "never narrower than the minimum", and a
// block that always claims 1 passes "never wider than its data".
test('a graph claims the columns it draws, never more, and never collapses', () => {
  // The direction the owner reported: more box than series.
  assert.equal(stripColumns(3), gridMinColumns, 'a short series must not claim a year of columns');
  assert.equal(stripColumns(53), 53, 'a full calendar keeps every column it draws');
  assert.equal(
    stripColumns(pendingWeeks),
    pendingWeeks,
    'the reserved chrome claims exactly the columns it renders'
  );
  for (const drawn of [11, 12, 26, 40, 53, 104]) {
    assert.equal(stripColumns(drawn), drawn, `a ${drawn} column graph must be ${drawn} columns wide`);
  }

  // The other direction: a claim is never smaller than what is drawn, so a
  // graph can never be clipped by its own box.
  for (const drawn of [1, 2, 3, 9, 10, 11, 53]) {
    assert.ok(
      stripColumns(drawn) >= drawn,
      `a ${drawn} column graph may not be drawn into a narrower box`
    );
  }

  // The floor is the block's own furniture, not a preference: it is the first
  // count whose strip carries the less/more key printed under it (measured at
  // 123.38px in all three engines, and re-measured per engine in the
  // rendering lanes). Nine columns is 114px and would spill it.
  assert.equal(gridMinColumns, 10);
  assert.ok(gridMinColumns * (0.625 + 0.1875) - 0.1875 >= 123.38 / 16, 'the floor must carry the legend');
  assert.ok(
    (gridMinColumns - 1) * (0.625 + 0.1875) - 0.1875 < 123.38 / 16,
    'the floor is the SMALLEST count that carries the legend; a larger one is padding'
  );

  // Nothing a caller can pass produces a box that is not a box.
  for (const rogue of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(stripColumns(rogue), gridMinColumns, `${String(rogue)} columns must still draw a graph`);
  }
  assert.equal(stripColumns(3.9), gridMinColumns, 'a fractional column count never widens the box');
});

// The component half: the number above has to reach the stylesheet, and the
// stylesheet has to spend it on a CAP rather than a width — a fixed width
// would push a year of columns past a 320px viewport and take the page's own
// scrollbar sideways with it, which is a stage-1 floor.
test('the block is sized from the columns it rendered, as a cap', () => {
  assert.match(
    grid,
    /stripColumns\(columns\.length > 0 \? columns\.length : chrome\.length\)/,
    'the width must come from the columns actually drawn, not from a constant'
  );
  assert.match(grid, /style:--grid-columns=\{claimedColumns\}/, 'the count never reaches the stylesheet');
  const block = /\.grid-block \{([^}]*)\}/.exec(grid);
  assert.ok(block, 'the grid block lost its rule');
  assert.match(
    block[1],
    /max-inline-size:\s*calc\(/,
    'the size must be a maximum, so a narrow screen still shrinks it'
  );
  assert.match(
    block[1],
    /var\(--grid-columns/,
    'the cap must still be driven by the columns actually rendered'
  );
  assert.doesNotMatch(
    block[1],
    /(?:^|[\s;])inline-size:/,
    'a fixed inline size would overflow a 320px viewport instead of scrolling inside the strip'
  );
  // The box and the cells must be laid out from the SAME cell metrics, or a
  // token change resizes one and not the other.
  for (const token of ['--grid-cell-size, 0.625rem', '--grid-cell-gap, 0.1875rem']) {
    assert.ok(block[1].includes(token), `the box computes its width from a different ${token}`);
  }
  // Issue 189: the weekday gutter shares this box's horizontal budget with
  // the strip, so the cap must reserve the gutter's own fixed width and the
  // row-gap beside it too — reading the SAME --grid-axis-width token
  // .grid-weekday-axis is sized from, so the two can never disagree about
  // how wide "the gutter" is.
  assert.ok(
    block[1].includes('--grid-axis-width, 1.25rem'),
    'the cap no longer reserves the weekday gutter its own width'
  );
  const gutter = /\.grid-weekday-axis \{([^}]*)\}/.exec(grid);
  assert.ok(gutter, 'the weekday gutter rule is missing');
  assert.match(
    gutter[1],
    /inline-size:\s*var\(--grid-axis-width,\s*1\.25rem\)/,
    'the gutter must be sized from the SAME token the block reserves room for'
  );
});

// The opt-in override (issue #178): a full-width call site drops the cap
// above rather than replacing it, so the calendar's own content-sized box is
// unaffected by a rule scoped to the [data-grid-fullwidth='true'] attribute.
test('a full-width call site stretches to its container instead of its columns', () => {
  const wide = /\.grid-block\[data-grid-fullwidth='true'\] \{([^}]*)\}/.exec(grid);
  assert.ok(wide, 'the full-width override rule is missing');
  assert.match(wide[1], /max-inline-size:\s*none/, 'the content-sized cap survives the opt-in');
  assert.match(wide[1], /inline-size:\s*100%/);
  // Cells and the month axis stretch together, floored at the same token the
  // capped layout uses, so a short series fills the card instead of leaving
  // a tiny graph beside empty space — and a long one still overflows into
  // the strip's own scroll, exactly as the capped layout already does.
  const tracks = /\.grid-block\[data-grid-fullwidth='true'\] \.grid-cells,\s*\n\s*\.grid-block\[data-grid-fullwidth='true'\] \.grid-months \{([^}]*)\}/.exec(
    grid
  );
  assert.ok(tracks, 'the full-width track rule is missing, or no longer covers both the cells and the month axis');
  // The fallback is load-bearing: --grid-cell-size has no :root definition
  // anywhere, only fallback usages, so a var() here without one is invalid
  // at computed-value time and silently drops the whole declaration to
  // `none` — which falls through to the capped layout's fixed-size columns
  // rather than stretching. MEASURED: that regression shipped here once.
  assert.match(tracks[1], /minmax\(var\(--grid-cell-size,\s*0\.625rem\),\s*1fr\)/);
});

// The series arrives from a capture file on the owner's machine, through a
// snapshot, through the origin, into this DOM — so every string on that path
// has to reach the page as TEXT and never as markup (owner directive,
// 2026-08-24). The browser lane proves the rendered result; this proves the
// two places the component could leave the escaped path, which is where such
// a regression is actually written.
test('payload strings reach the grid as text, never as markup', () => {
  // The one label a cell carries is built here, and it must hand back what it
  // was given rather than sanitising it — a helper that stripped markup would
  // hide the bug the escaping is there to prevent, and would silently corrupt
  // a legitimate label containing an angle bracket.
  const hostile = '<img src=x onerror="window.pwned=1">';
  assert.equal(
    cellLabel({ value: 7, date: '2026-08-12' }, hostile),
    `7 ${hostile}s on Aug 12`,
    'the cell label must carry the payload string verbatim'
  );
  assert.ok(cellLabel({ value: 1, date: hostile }, 'token').includes(hostile));

  // ...and the component must never take a raw-HTML route with it. Both
  // spellings, because one is Svelte's and one is the DOM's.
  assert.doesNotMatch(grid, /\{@html/, 'the grid renders a payload string as raw HTML');
  assert.doesNotMatch(grid, /innerHTML|insertAdjacentHTML|outerHTML/, 'the grid writes markup by hand');
  // The cell text reaches the DOM through attribute bindings, which Svelte
  // escapes; pinning the spelling keeps a later edit from hand-rolling one.
  // Anchored on the attribute boundary, not on the substring: `data-title=`
  // ends in `title=` and would satisfy a loose match while the cell had lost
  // its tooltip entirely (a surviving mutant, caught by the kill matrix).
  assert.match(grid, /\saria-label=\{text\}/);
  assert.match(grid, /\stitle=\{text\}/);
});

// How the empty state LOOKS, which is a different question from what it
// contains and was conflated with it until issue 134: the placeholders were
// drawn as outlined holes, identically to a missing day inside a real window,
// so a panel with nothing to plot read as a graph that had failed to load.
test('the empty graph is styled as a reserved plate, not as a graph of holes', () => {
  assert.match(
    grid,
    /data-grid-state=\{columns\.length > 0 \? 'series' : 'empty'\}/,
    'the state must be declared on the block, not inferred by a selector'
  );
  const emptyCell = /\.grid-block\[data-grid-state='empty'\] \.grid-cell\[data-grid-pending\]\s*\{([^}]*)\}/.exec(grid);
  assert.ok(emptyCell, 'the empty state gives its placeholder cells no treatment of their own');
  assert.match(emptyCell[1], /box-shadow:\s*none/, 'the placeholder outlines must be cleared');
  assert.match(emptyCell[1], /background:\s*var\(--grid-cell-empty/, 'a flat field needs a fill');

  const emptyStrip = /\.grid-block\[data-grid-state='empty'\] \.grid-strip\s*\{([^}]*)\}/.exec(grid);
  assert.ok(emptyStrip, 'the empty state does not frame its plate');
  // Load-bearing, and the reason the rule is written the way it is: block-size
  // is content-box, so a border would add two pixels to the strip's bounding
  // rectangle and an empty panel would stop being exactly as tall as a full
  // one — which is the zero-CLS floor and a rendering-lane assertion both.
  assert.match(emptyStrip[1], /box-shadow:\s*inset/);
  assert.doesNotMatch(
    emptyStrip[1],
    /(?:^|[\s;])border(?:-block|-inline|-top|-bottom|-left|-right)?:/,
    'a border grows the strip box; the empty and filled panels must be the same height'
  );

  const emptyLegend = /\.grid-block\[data-grid-state='empty'\] \.grid-legend\s*\{([^}]*)\}/.exec(grid);
  assert.ok(emptyLegend, 'the magnitude legend still explains a magnitude that is not there');
  // Hidden, never removed: display:none would take the legend's box out of
  // flow and shorten the panel, which is the same shift by another route.
  assert.match(emptyLegend[1], /visibility:\s*hidden/);
  assert.doesNotMatch(emptyLegend[1], /display:\s*none/);

  const note = /\.grid-empty\s*\{([^}]*)\}/.exec(grid);
  assert.ok(note, 'the empty note lost its rule');
  assert.match(note[1], /position:\s*absolute/, 'the note stays out of flow');
  assert.match(note[1], /text-transform:\s*uppercase/, 'a state reads as a label, not as prose');
  assert.doesNotMatch(
    note[1],
    /font-style:\s*italic/,
    'italics are the typography of an apology; an unavailable series is a state, not a fault'
  );
});

// Issue 189 carries issue 134's finding one step further: a day INSIDE the
// window a real series draws — before the series existed, or a future day in
// its current week — is absent for the same reason a whole empty panel is,
// and now PAINTS the same honest way: a faint filled field, never an
// outlined hole. Deliberately a DIFFERENT rule from the pending/empty
// state's own plate treatment above (a whole panel with nothing to plot
// stays visually distinct from a few missing days inside a real one), so
// this pins the general, unscoped selector rather than reusing the empty
// state's.
test('an absent day inside a real series paints as a faint filled field, not an outlined hole (issue 189)', () => {
  const rule = /(?:^|\n)[ \t]*\.grid-cell\[data-grid-absent='true'\]\s*\{([^}]*)\}/.exec(grid);
  assert.ok(rule, 'the general in-window absent-cell treatment rule is missing, or was rescoped under another selector');
  assert.match(rule[1], /background:\s*var\(--grid-cell-absent/, 'an absence still needs a fill, not a bare outline');
  assert.match(
    rule[1],
    /box-shadow:\s*none/,
    "the outlined-hole treatment issue 134 retired for the empty state must stay cleared here too"
  );
});

// The gutter has to render EVERY time — series or empty — because it draws
// calendar structure (weekdayAxis), never data: an empty panel still has
// Mondays and Fridays, it just has no counts on them yet.
test('the weekday gutter sits beside the strip in one flex row, and renders unconditionally rather than gated on a series arriving (issue 189)', () => {
  const body = /<div class="grid-body">([\s\S]*?)\n {2}<\/div>\n {2}\{#if columns\.length === 0\}/.exec(grid);
  assert.ok(body, 'the grid-body wrapper is missing, or no longer matches the shape the weekday gutter needs');
  assert.match(
    body[1],
    /<div class="grid-weekday-axis" aria-hidden="true">/,
    'the weekday gutter markup is missing from grid-body'
  );
  assert.match(
    body[1],
    /\{#each weekdayAxis as weekday \(weekday\.row\)\}/,
    'the gutter must read the SAME weekdayAxis constant the Sunday-start convention is written down in once'
  );
  assert.match(
    body[1],
    /style:grid-row=\{weekday\.row \+ 1\}/,
    'a label must land on the row grid.ts declared for it, not a hand-picked one'
  );
  // The weekday gutter's own markup must sit BEFORE the {#if columns.length
  // > 0} branch that gates the strip's series/empty content — outside that
  // conditional is what makes "renders in both states" a fact rather than a
  // comment.
  const weekdayIndex = body[1].indexOf('grid-weekday-axis');
  const conditionalIndex = body[1].indexOf('{#if columns.length > 0}');
  assert.ok(weekdayIndex >= 0, 'the weekday gutter markup was not found inside grid-body');
  assert.ok(conditionalIndex >= 0, 'the series/empty conditional was not found inside grid-body');
  assert.ok(
    weekdayIndex < conditionalIndex,
    'the weekday gutter must render outside (before) the series/empty conditional, not inside it'
  );
});
