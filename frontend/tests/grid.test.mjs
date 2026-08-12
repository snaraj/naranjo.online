/* Drives the shared contribution-grid helpers directly: the three series
 * lenses, the magnitude bucketing, the column padding, the month axis, and
 * the accessible cell text both panels depend on. */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addDays,
  cellLabel,
  formatWhole,
  gridLevel,
  gridLevels,
  gridRows,
  isSeriesView,
  monthTicks,
  peakValue,
  seriesCells,
  seriesViews,
  toColumns,
  viewValues
} from '../src/lib/grid.ts';

test('the three series lenses read one daily series three ways', () => {
  const totals = [1, 2, 3, 4, 5, 6, 7, 10, 0, 0, 0, 0, 0, 0];

  assert.deepEqual(viewValues(totals, 'daily'), totals, 'the daily lens is the series itself');
  assert.notEqual(viewValues(totals, 'daily'), totals, 'the daily lens must copy, never alias the payload');

  // Weekly buckets align with the grid's own columns, so a column renders as
  // one flat block of its week total.
  assert.deepEqual(
    viewValues(totals, 'weekly'),
    [28, 28, 28, 28, 28, 28, 28, 10, 10, 10, 10, 10, 10, 10],
    'every day in a column must carry that column total'
  );

  assert.deepEqual(
    viewValues([1, 2, 3], 'cumulative'),
    [1, 3, 6],
    'the cumulative lens is the running total'
  );

  // A short trailing week must not be dropped or mis-summed.
  assert.deepEqual(viewValues([5, 5], 'weekly'), [10, 10]);
  assert.deepEqual(viewValues([], 'weekly'), []);
});

test('series views are a closed set', () => {
  assert.deepEqual([...seriesViews], ['daily', 'weekly', 'cumulative']);
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

test('the month axis marks each month once, at the column it starts in', () => {
  const ticks = monthTicks(toColumns(seriesCells('2026-08-01', new Array(70).fill(1))));
  assert.deepEqual(
    ticks.map((tick) => tick.initial),
    ['A', 'S', 'O'],
    'August, September, October, each marked once'
  );
  assert.equal(ticks[0].column, 0);
  assert.equal(ticks[0].name, 'August');
  assert.ok(ticks[1].column > 0);
  // A grid whose cells carry no dates simply has no axis.
  assert.deepEqual(monthTicks([[{ value: 1, date: '' }]]), []);
});

test('cell text always carries the count, so color is never the only encoding', () => {
  assert.equal(cellLabel({ value: 1, date: '2026-08-12' }, 'contribution'), '1 contribution on 2026-08-12');
  assert.equal(cellLabel({ value: 0, date: '2026-08-12' }, 'contribution'), '0 contributions on 2026-08-12');
  assert.equal(cellLabel({ value: 12000, date: '' }, 'token'), '12,000 tokens');
  assert.equal(
    cellLabel({ value: 5, date: '2026-08-12' }, 'token', 'cumulative'),
    '5 tokens (cumulative) on 2026-08-12',
    'an aggregated reading must say which reading it is'
  );
  assert.equal(cellLabel({ value: 0, date: '', absent: true }, 'token'), 'no data for this day');
});

test('thousands grouping is locale-independent', () => {
  assert.equal(formatWhole(0), '0');
  assert.equal(formatWhole(999), '999');
  assert.equal(formatWhole(1000), '1,000');
  assert.equal(formatWhole(1234567), '1,234,567');
});
