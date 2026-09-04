/* Drives what is left of lib/periods.ts directly: the date admission every
 * caller shares, and the range sentence rendered at the shortest honest
 * length.
 *
 * THE WINDOWING SUITE THAT USED TO LIVE HERE IS GONE, deliberately. It pinned
 * a closed range vocabulary, the week arithmetic behind each range, the
 * per-panel coverage window of issue 268, and the two sentences under a
 * windowed graph. The ledger redesign (owner directive, 2026-09-03, issue
 * 287) retired every reader of those — the range control, the lens control
 * and the per-panel window went with UsageTracker, ActivityTracker and
 * StatTracker — and SPEC §8.8 replaces the coverage window with ONE shared
 * 52/53-week calendar that all three commits heatmaps draw on. The tests went
 * with their subjects, not around them: nothing here was weakened to make a
 * removal pass.
 *
 * What that leaves is still worth pinning, and one of the two rows below is
 * the only thing standing between a well-shaped impossible date and an
 * arithmetic answer for it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { dayNumber, formatDateRange } from '../src/lib/periods.ts';
import { calendarColumns, seriesCells, viewColumns } from '../src/lib/grid.ts';

test('a date is admitted by round trip, so a well-shaped impossible day is refused', () => {
  // The positive case, and the property every caller relies on: consecutive
  // days are consecutive numbers, so a difference is a day count.
  const epoch = dayNumber('1970-01-01');
  assert.equal(epoch, 0);
  assert.equal(dayNumber('1970-01-02') - epoch, 1);
  assert.equal(dayNumber('2026-08-24') - dayNumber('2026-08-10'), 14);
  // A month end and a leap day are ordinary calendar arithmetic, never a
  // 30-day approximation.
  assert.equal(dayNumber('2026-03-01') - dayNumber('2026-02-28'), 1);
  assert.equal(dayNumber('2028-03-01') - dayNumber('2028-02-28'), 2, '2028 is a leap year');
  // MEASURED: Date.parse answers March 2nd for February 30th, because the ISO
  // parse fails and the engine falls back to a lenient parser. The round trip
  // is what refuses a day that does not exist.
  assert.equal(dayNumber('2026-02-30'), null);
  assert.equal(dayNumber('2026-02-29'), null, '2026 is not a leap year');
  assert.equal(dayNumber('2028-02-29'), 21243, '2028 is, and the day is real');
  assert.equal(dayNumber('2026-99-99'), null);
  assert.equal(dayNumber('2026-13-01'), null);
  assert.equal(dayNumber('2026-00-01'), null);
  assert.equal(dayNumber('2026-01-00'), null);
  // Shape alone is refused too: a partial date, a timestamp, a non-date and
  // an empty string all fail the pattern before any parsing happens.
  assert.equal(dayNumber('2026-08'), null);
  assert.equal(dayNumber('2026-08-24T00:00:00Z'), null);
  assert.equal(dayNumber('tomorrow'), null);
  assert.equal(dayNumber(''), null);
});

test('a date range is written at the shortest honest length, and an impossible one is refused', () => {
  assert.equal(formatDateRange('2026-08-24', '2026-08-24'), 'Aug 24, 2026');
  assert.equal(formatDateRange('2026-08-10', '2026-08-24'), 'Aug 10–24, 2026');
  assert.equal(formatDateRange('2026-08-10', '2026-09-02'), 'Aug 10 – Sep 2, 2026');
  assert.equal(formatDateRange('2025-12-30', '2026-01-02'), 'Dec 30, 2025 – Jan 2, 2026');
  // Reversed is refused rather than reordered: an impossible range is not a
  // claim to be tidied into a possible one.
  assert.equal(formatDateRange('2026-08-24', '2026-08-10'), '');
  // And so is a date that does not exist, however well-shaped it looks.
  assert.equal(formatDateRange('2026-02-30', '2026-03-05'), '');
  assert.equal(formatDateRange('2026-13-01', '2026-13-05'), '');
  assert.equal(formatDateRange('', '2026-08-24'), '');
  assert.equal(formatDateRange('2026-08-24', 'tomorrow'), '');
});

/* PARKED HERE, and it belongs in tests/grid.test.mjs. Its subject is
 * lib/grid.ts's monthly lens, not this module — it only ever lived here
 * because the retired rangeColumns was the convenient way to build a windowed
 * series, and that is now calendarColumns directly. It is kept rather than
 * dropped because these are the only rows anywhere that read the lens ACROSS
 * A YEAR BOUNDARY: grid.test.mjs pins month-boundary summation, coverage
 * days, leap-February length and the year in a month's label, but nothing
 * there proves two same-named months a year apart stay two figures. */
test('months are read across a year boundary, with the edge months flagged as partial', () => {
  // Dec 20 2025 through Jan 10 2026: 22 days, one token each, spanning a year
  // boundary — the case a bare month name cannot describe.
  const cells = seriesCells('2025-12-20', new Array(22).fill(1));
  const windowed = calendarColumns(cells, 10);
  const monthly = viewColumns(windowed, 'monthly');
  const byDate = new Map(monthly.flat().map((cell) => [cell.date, cell]));

  // December contributed 12 captured days (Dec 20..31), January 10 (Jan 1..10).
  assert.equal(byDate.get('2025-12-20').value, 12);
  assert.equal(byDate.get('2025-12-31').value, 12);
  assert.equal(byDate.get('2026-01-01').value, 10);
  assert.equal(byDate.get('2026-01-10').value, 10);
  assert.equal(byDate.get('2025-12-20').days, 12);
  assert.equal(byDate.get('2026-01-01').days, 10);
  // Neither edge month is whole, and both say so — a partial month totalled
  // silently is the interpolation this doctrine forbids, wearing a month's
  // name.
  assert.ok(byDate.get('2025-12-20').days < 31);
  assert.ok(byDate.get('2026-01-01').days < 31);
  // The two Decembers of a two-year capture never collapse into one figure.
  const twoYears = viewColumns(
    calendarColumns(seriesCells('2024-12-01', new Array(400).fill(2)), 60),
    'monthly'
  );
  const across = new Map(
    twoYears
      .flat()
      .filter((cell) => !cell.absent)
      .map((cell) => [cell.date, cell])
  );
  assert.equal(across.get('2024-12-01').value, 62, 'December 2024 is 31 covered days at 2 each');
  assert.equal(across.get('2025-12-01').value, 62, 'December 2025 is its own month, not the same one');
  assert.equal(across.get('2024-12-01').days, 31);
  assert.equal(across.get('2025-12-01').days, 31);
  // A leap February is 29 covered days, never 28.
  const leap = viewColumns(
    calendarColumns(seriesCells('2028-02-01', new Array(29).fill(1)), 10),
    'monthly'
  );
  const february = leap.flat().find((cell) => cell.date === '2028-02-29');
  assert.equal(february.value, 29);
  assert.equal(february.days, 29);
});
