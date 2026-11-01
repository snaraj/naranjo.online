/* Drives the calendar helpers directly: the magnitude bucketing, the column
 * padding, the calendar weeks, the month axis, and the accessible cell text
 * the panels depend on. The grid component these once also pinned retired
 * with the redesign of 2026-10-16 (the Chronicle draws the calendar now). */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addDays,
  calendarColumns,
  cellLabel,
  cellPeriod,
  formatMagnitude,
  formatWhole,
  gridLevel,
  gridLevels,
  gridRows,
  magnitudeFloor,
  monthTicks,
  visibleMonths,
  pendingWeeks,
  seriesCells,
  toColumns,
  weekStartsOn
} from '../src/lib/grid.ts';

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

test('levels quantize against the peak, and nothing is level 0 by accident', () => {
  assert.equal(gridLevel(0, 100), 0, 'no activity is level 0');
  assert.equal(gridLevel(5, 0), 0, 'a peakless window cannot rank anything');
  assert.equal(gridLevel(1, 100), 1, 'a single unit of activity must still be visible');
  assert.equal(gridLevel(100, 100), gridLevels - 1, 'the peak day is always the brightest');
  assert.equal(gridLevel(50, 100), 2);
  assert.equal(gridLevel(1000, 100), gridLevels - 1, 'a level can never exceed the ramp');
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

test('weekStartsOn is the one Sunday-start convention every column reads (issue 189)', () => {
  assert.equal(
    weekStartsOn,
    0,
    "the convention is Sunday-start, sourced from activity.ts's own \"Columns run Sunday..Saturday\" comment and the VCS snapshot's endDate"
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
  assert.equal(cellLabel({ value: 0, date: '', absent: true }, 'token'), 'no data for this day');
});

// cellPeriod is the one place a view is turned into a phrase, shared by
// cellLabel's accessible text and the token panel's DetailTip card (issue
// 189) — pinning it directly here is what keeps the two readable
// independently of cellLabel's own concatenation.
test('cellPeriod reads the day phrase the reference designs pair with a value (issue 189)', () => {
  assert.equal(cellPeriod({ value: 1, date: '2026-08-13' }), 'on Aug 13');
  assert.equal(cellPeriod({ value: 1, date: '' }), '', 'an undated cell has no calendar phrase');
  // A hostile-string date that cannot be calendar-parsed still degrades to
  // the raw string rather than throwing or blanking it (the same
  // never-corrupt-a-payload floor formatCalendarDate documents).
  assert.equal(cellPeriod({ value: 1, date: 'not-a-date' }), 'on not-a-date');
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
  assert.equal(formatMagnitude(999), '999');
  assert.equal(formatMagnitude(1284), '1,284');
  assert.equal(formatMagnitude(9999), '9,999');
  assert.equal(magnitudeFloor, 10_000);
  // ...and above it, one decimal, with a trailing .0 trimmed. A whole figure
  // drops the decimal entirely rather than reading "100.0K".
  assert.equal(formatMagnitude(10_000), '10K');
  assert.equal(formatMagnitude(12_900), '12.9K');
  assert.equal(formatMagnitude(100_000), '100K');
  assert.equal(formatMagnitude(182_340), '182.3K');
  assert.equal(formatMagnitude(2_103_980), '2.1M');
  assert.equal(formatMagnitude(9_421_770), '9.4M');
  assert.equal(formatMagnitude(627_742_457), '627.7M');
  assert.equal(formatMagnitude(1_250_000_000), '1.3B');
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
  assert.equal(cellLabel(cell, 'token'), '627,742,457 tokens on Aug 11');
  assert.equal(
    cellLabel(cell, 'token', formatMagnitude),
    '627.7M tokens on Aug 11'
  );
  // An absent cell has no value to format, and no formatter is ever asked for
  // one: the honesty floor sits ahead of the formatting step.
  assert.equal(
    cellLabel({ value: 0, date: '2026-08-11', absent: true }, 'token', () => 'INVENTED'),
    'no data for this day'
  );
});

// The calendar's window, in weeks. The reserve a panel holds while its
// series is on the way and the payload that lands in it must be the SAME
// number of columns, or the calendar changes width on arrival and the
// zero-CLS floor is gone. The other side of this number is
// TestVCSActivityPanelShipsARenderableGraph in
// internal/panels/registry_test.go, which pins the shipped calendar to
// exactly 53 weeks and names this constant when it fails. Move one and the
// other goes red. (The placeholder columns this test also pinned retired
// with the grid that drew them, 2026-10-16.)
test('the calendar window is exactly the shipped year of weeks', () => {
  assert.equal(
    pendingWeeks,
    53,
    'the reserve must stay exactly as wide as the shipped calendar; see internal/panels/registry_test.go'
  );
});

// The series arrives from a capture file on the owner's machine, through a
// snapshot, through the origin, into this DOM — so every string on that path
// has to reach the page as TEXT and never as markup (owner directive,
// 2026-08-24). The browser lanes prove the rendered result; this proves the
// label builder hands a payload string back verbatim. (The component half —
// no {@html} — follows the calendar into the Chronicle: activity.test.mjs.)
test('a cell label carries a payload string verbatim, never sanitised', () => {
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
});


test('the current month remains visible at the mobile right edge without overlapping the preceding label', () => {
  const labels = visibleMonths([{ column: 44, label: 'Sep' }, { column: 48, label: 'Oct' }, { column: 52, label: 'Nov' }], 30, 16, 23 * 16, 16);
  assert.equal(labels.at(-1).label, 'Nov');
  assert.equal(labels.at(-1).anchor, 'end');
  assert.ok(labels.at(-2).x + 2.1 * 16 + 0.3 * 16 <= labels.at(-1).x - 2.1 * 16);
  assert.ok(labels.every((label) => label.x >= 0 && label.x <= 23 * 16));
  const desktop = visibleMonths([{ column: 44, label: 'Sep' }, { column: 48, label: 'Oct' }, { column: 52, label: 'Nov' }], 0, 16, 53 * 16, 9);
  assert.deepEqual(desktop.map((label) => label.label), ['Sep', 'Oct', 'Nov']);
});

test('a month beginning midweek is labelled on its first represented day, never from future padding', () => {
  const throughNovember = calendarColumns(seriesCells('2026-10-01', new Array(61).fill(1)), 12, '2026-11-30');
  const throughDecember = calendarColumns(seriesCells('2026-10-01', new Array(62).fill(1)), 12, '2026-12-01');
  assert.equal(monthTicks(throughNovember).at(-1).abbrev, 'Nov');
  assert.equal(monthTicks(throughDecember).at(-1).abbrev, 'Dec');
  assert.equal(monthTicks(throughDecember).at(-1).column, 11);
});
