/* Drives the windowing engine (lib/periods.ts) directly: the closed range
 * vocabulary, how many weeks each range draws over an unbounded history, what
 * a drawn window actually contains, and the two sentences under the graph
 * that have to describe THAT window rather than the payload behind it.
 *
 * Two things are pinned here that no other suite can pin:
 *
 *   - the honest-gap rule, in both directions. A day the window draws and the
 *     capture never covered is an absent, DATED hole and is counted in no
 *     total; a real zero is a measured quiet day and is counted in every one.
 *     Conflating the two is the failure mode this whole layer exists to
 *     avoid, so it is asserted per range and per lens rather than once.
 *
 *   - the no-regression floor. The shipped fifteen-day snapshot, through the
 *     range this panel opens on, must produce EXACTLY the columns the strip
 *     drew before this control existed and EXACTLY the sentence the adapter
 *     used to build. Both halves are checked against the real snapshot bytes
 *     in a full checkout.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  activityReading,
  checkedAdd,
  coverageReading,
  defaultSeriesRange,
  formatDateRange,
  isSafeCount,
  isSeriesRange,
  periodTotals,
  rangeColumns,
  coverageColumns,
  coverageWindow,
  rangeDays,
  rangeWeeks,
  seriesRanges,
  seriesReading
} from '../src/lib/periods.ts';
import {
  addDays,
  calendarColumns,
  formatMagnitude,
  gridMinColumns,
  gridRows,
  peakValue,
  pendingWeeks,
  seriesCells,
  viewColumns
} from '../src/lib/grid.ts';

/* The same capability gate the other cross-tree pins use: in a full checkout
 * (every local run, the PR gate's application job) the snapshot is mandatory
 * and a missing file fails loudly; in the container's frontend-only build
 * context the pin skips by name. The probe reads the TREE, never the file
 * under pin, so deleting the snapshot can never become a silent skip. */
const fullCheckout = existsSync(new URL('../../internal/panels', import.meta.url));

const real = (cells) => cells.flat().filter((cell) => !cell.absent);
const dates = (columns) => columns.flat().map((cell) => cell.date);

test('the range vocabulary is closed, and its default is the window the strip already drew', () => {
  assert.deepEqual([...seriesRanges], ['30d', '90d', '12mo', 'all']);
  for (const range of seriesRanges) {
    assert.ok(isSeriesRange(range));
  }
  for (const rogue of ['365d', '12MO', 'ALL', '', ' 30d', null, 30, undefined, {}]) {
    assert.equal(isSeriesRange(rogue), false, `${String(rogue)} must not pass as a range`);
  }
  // Membership, not shape: a string that merely looks like a range is refused
  // exactly like a number is.
  assert.equal(isSeriesRange('7d'), false);
  assert.equal(defaultSeriesRange, '12mo');
  assert.ok(isSeriesRange(defaultSeriesRange), 'the default must be a member of its own vocabulary');
  // The default resolves to the grid's own reserve width — one number read
  // two ways, which is what makes "nothing changed for a reader who never
  // touches this control" true rather than approximately true.
  assert.equal(rangeWeeks([], defaultSeriesRange), pendingWeeks);
  assert.deepEqual(Object.keys(rangeDays).sort(), [...seriesRanges].sort());
  assert.equal(rangeDays.all, null, 'the unbounded range must declare no fixed length');
});

test('a fixed range rounds up to whole weeks; "all" is measured from the data and has no ceiling', () => {
  assert.equal(rangeWeeks([], '30d'), 5, '30 days needs 5 columns; 4 would draw 28');
  assert.equal(rangeWeeks([], '90d'), 13);
  assert.equal(rangeWeeks([], '12mo'), 53);
  for (const range of ['30d', '90d', '12mo']) {
    assert.ok(rangeWeeks([], range) * gridRows >= rangeDays[range], `${range} draws fewer days than it claims`);
  }

  // 'all' over a fifteen-day capture measures three real calendar weeks
  // (Sun Aug 9 through Sat Aug 29, 2026) and is floored to the width below
  // which the graph's own less/more key no longer fits beside it.
  const young = seriesCells('2026-08-10', new Array(15).fill(1));
  assert.equal(rangeWeeks(young, 'all'), gridMinColumns);

  // 'all' over a real multi-year capture is unbounded: 800 days from
  // Jan 1 2024 spans 115 calendar weeks, and nothing clamps it.
  const long = seriesCells('2024-01-01', new Array(800).fill(1));
  const weeks = rangeWeeks(long, 'all');
  assert.ok(weeks > pendingWeeks, `a multi-year capture must exceed the reserve width, got ${weeks}`);
  assert.ok(weeks * gridRows >= 800, 'the window must cover every captured day');
  assert.ok(weeks * gridRows < 800 + 2 * gridRows, 'the window must not overshoot by more than its two edge weeks');

  // Growth is monotone: one more day never draws fewer columns.
  let previous = 0;
  for (const days of [1, 7, 8, 70, 71, 365, 366, 1000]) {
    const measured = rangeWeeks(seriesCells('2026-01-01', new Array(days).fill(1)), 'all');
    assert.ok(measured >= previous, `${days} days drew fewer columns than the window before it`);
    previous = measured;
  }

  // An undated series has no calendar to measure, so it falls back to the
  // reserve width — calendarColumns ignores the count there anyway and chunks
  // positionally, which is the behaviour that must not change.
  const undated = [{ value: 1, date: '' }, { value: 2, date: '' }];
  assert.equal(rangeWeeks(undated, 'all'), pendingWeeks);
  assert.deepEqual(rangeColumns(undated, 'all'), calendarColumns(undated, pendingWeeks));
});

test('every range ends on the newest captured day and draws the rest as dated holes', () => {
  const cells = seriesCells('2026-08-10', new Array(15).fill(3));
  for (const range of seriesRanges) {
    const columns = rangeColumns(cells, range);
    assert.equal(columns.length, rangeWeeks(cells, range), `${range} drew a width it did not claim`);
    for (const column of columns) {
      assert.equal(column.length, gridRows, `${range} drew a short column`);
    }
    // The window ENDS on the week of the newest captured day, in every range:
    // a reader asking for less history must never be shown less of the
    // present.
    const drawn = dates(columns);
    assert.ok(drawn.includes('2026-08-24'), `${range} lost the newest captured day`);
    assert.equal(drawn[drawn.length - 1], '2026-08-29', `${range} does not end on the newest week`);
    // Every captured day survives every range here, because fifteen days fit
    // inside the shortest of them.
    assert.equal(real(columns).length, 15, `${range} lost captured days`);
    // And every uncovered day is a DATED hole carrying no count — never a
    // zero, which would be a measured quiet day.
    for (const cell of columns.flat()) {
      if (cell.absent) {
        assert.notEqual(cell.date, '', `${range} drew an undated hole inside a dated window`);
        assert.equal(cell.value, 0);
      }
    }
  }

  // A range SHORTER than the capture clips the OLD end, never the new one.
  // This series ends on a Saturday (2026-08-29), so its window has no
  // trailing holes and the arithmetic is exact: 5 columns, 35 covered days.
  const long = seriesCells(addDays('2026-08-29', -799), new Array(800).fill(1));
  const short = rangeColumns(long, '30d');
  assert.equal(short.length, 5);
  assert.equal(real(short).length, 35, 'a 5-week window ending on a Saturday is fully covered');
  const shortDates = dates(short);
  assert.equal(shortDates[shortDates.length - 1], '2026-08-29');
  assert.equal(shortDates[0], addDays('2026-08-29', -34));

  // And a capture that stops MIDWEEK leaves the rest of its own week drawn as
  // dated holes rather than as zeros — a Tuesday capture does not make
  // Wednesday a quiet day, it makes it a day nobody has measured yet.
  const midweek = rangeColumns(seriesCells('2026-08-10', new Array(15).fill(1)), '30d');
  const tail = midweek[midweek.length - 1];
  assert.equal(tail[0].date, '2026-08-23');
  assert.deepEqual(
    tail.map((cell) => Boolean(cell.absent)),
    [false, false, true, true, true, true, true],
    'Aug 23 and 24 are captured; the rest of their week must be holes'
  );
  assert.equal(real(midweek).length, 15);
});

test('a single-day history renders, in every range, without inventing a second day', () => {
  const one = seriesCells('2026-08-24', [42]);
  for (const range of seriesRanges) {
    const columns = rangeColumns(one, range);
    const captured = real(columns);
    assert.equal(captured.length, 1, `${range} invented days around a one-day capture`);
    assert.equal(captured[0].date, '2026-08-24');
    assert.equal(captured[0].value, 42);
    const reading = seriesReading(columns);
    assert.equal(reading.days, 1);
    assert.equal(reading.total, 42);
    assert.equal(reading.peak, 42);
    assert.equal(reading.first, '2026-08-24');
    assert.equal(reading.last, '2026-08-24');
    // Singular everywhere it should be, in the sentence a reader sees.
    assert.equal(activityReading(columns, 'token', formatMagnitude), '42 tokens over 1 day, peaking at 42');
    assert.match(coverageReading(columns), /^Aug 24, 2026 · 1 of \d+(,\d{3})* days captured$/);
  }
  // And one single token on one single day is singular in the noun too.
  const single = rangeColumns(seriesCells('2026-08-24', [1]), '30d');
  assert.equal(activityReading(single, 'token', formatMagnitude), '1 token over 1 day, peaking at 1');
});

test('a reading counts real days only, and tells a zero from a hole', () => {
  // Three captured days, the middle one a MEASURED zero, inside a window that
  // draws far more days than that.
  const columns = rangeColumns(seriesCells('2026-08-20', [5, 0, 7]), '30d');
  const reading = seriesReading(columns);
  assert.equal(reading.total, 12);
  assert.equal(reading.days, 3, 'a measured zero is a captured day and must be counted as one');
  assert.equal(reading.peak, 7);
  assert.equal(reading.first, '2026-08-20');
  assert.equal(reading.last, '2026-08-22');
  assert.equal(reading.span, 35, 'the span is what the window DRAWS, captured or not');
  assert.equal(reading.windowLast, '2026-08-22', 'the window ends on the newest captured week');
  assert.ok(reading.windowFirst < reading.first);

  // The same three days with the zero HOLLOWED OUT instead of measured: one
  // fewer captured day, the same total. This is the distinction the whole
  // layer exists to keep, so it is asserted as a pair rather than separately.
  const hollowed = rangeColumns(
    seriesCells('2026-08-20', [5, 0, 7]).map((cell, index) =>
      index === 1 ? { ...cell, absent: true } : cell
    ),
    '30d'
  );
  const gapped = seriesReading(hollowed);
  assert.equal(gapped.total, 12, 'a hole contributes nothing, exactly like the zero it replaced');
  assert.equal(gapped.days, 2, 'a hole is not a captured day');
  assert.equal(gapped.span, 35, 'a hole does not shrink the window it sits in');

  // A run of gaps reads as a run of gaps: nothing is interpolated across it,
  // and the days on either side keep their own values.
  const run = seriesCells('2026-08-10', [9, 0, 0, 0, 0, 0, 4]).map((cell, index) =>
    index > 0 && index < 6 ? { ...cell, absent: true } : cell
  );
  const runReading = seriesReading(rangeColumns(run, '30d'));
  assert.equal(runReading.days, 2);
  assert.equal(runReading.total, 13);
  assert.equal(runReading.peak, 9, 'a gap run must not be filled with a neighbouring value');
  assert.equal(runReading.first, '2026-08-10');
  assert.equal(runReading.last, '2026-08-16');
  // Through the weekly lens the gap run still contributes nothing. Aug 10 is
  // a Monday and Aug 16 the Sunday that opens the next calendar week, so the
  // two survivors land in different columns and each column totals only its
  // own real day — five holes between them are summed as the nothing they
  // are, never spread across the week.
  const weekly = viewColumns(rangeColumns(run, '30d'), 'weekly');
  assert.deepEqual(real(weekly).map((cell) => cell.value), [9, 4]);
});

test('a reading is window-scoped, so the sentence under a graph describes that graph', () => {
  // 400 days of one token each, ending on Saturday 2026-08-29 so no window
  // here carries a trailing partial week and every figure below is exact.
  const cells = seriesCells(addDays('2026-08-29', -399), new Array(400).fill(1));
  const whole = seriesReading(rangeColumns(cells, 'all'));
  const quarter = seriesReading(rangeColumns(cells, '90d'));
  const month = seriesReading(rangeColumns(cells, '30d'));
  assert.equal(whole.total, 400, 'the unbounded range must hold every captured day');
  assert.equal(whole.days, 400);
  assert.equal(quarter.days, 91, 'a 13-week window holds exactly 91 days of a longer capture');
  assert.equal(quarter.total, 91);
  assert.equal(month.days, 35);
  assert.equal(month.total, 35);
  // Same newest day in all three: a narrower window drops history, never the
  // present.
  for (const reading of [whole, quarter, month]) {
    assert.equal(reading.last, '2026-08-29');
  }
  assert.ok(whole.first < quarter.first && quarter.first < month.first);
  // And the sentences say so, in the reader's own words.
  assert.equal(
    activityReading(rangeColumns(cells, '90d'), 'token', formatMagnitude),
    '91 tokens over 91 days, peaking at 1'
  );
  assert.equal(
    coverageReading(rangeColumns(cells, '90d')),
    'May 31 – Aug 29, 2026 · every day in range captured'
  );
});

test('the reading describes the PERIOD the active lens groups by', () => {
  /* Twenty-eight consecutive days of exactly 1, starting on a Sunday, so the
     weekly grouping is four full columns and the monthly grouping is two
     calendar months with a known split — 16 days of August and 12 of
     September. Every figure below is therefore derivable by hand. */
  const cells = seriesCells('2026-08-16', Array.from({ length: 28 }, () => 1));
  const columns = rangeColumns(cells, '30d');

  assert.equal(
    activityReading(columns, 'token', formatMagnitude, 'daily'),
    '28 tokens over 28 days, peaking at 1'
  );
  assert.equal(
    activityReading(columns, 'token', formatMagnitude, 'weekly'),
    '28 tokens over 4 weeks, averaging 7 per week, peaking at 7 in one week'
  );
  assert.equal(
    activityReading(columns, 'token', formatMagnitude, 'monthly'),
    '28 tokens over 2 months, averaging 14 per month, peaking at 16 in one month'
  );
  /* Cumulative states no peak, and that is not an omission: the peak of a
     running total IS the total, so naming it would repeat the figure the
     sentence opens with. What the lens actually adds is the rate. */
  assert.equal(
    activityReading(columns, 'token', formatMagnitude, 'cumulative'),
    '28 tokens accumulated over 28 days, averaging 1 per day'
  );

  /* The default is daily, so every caller that predates the view argument
     keeps the sentence it had. */
  assert.equal(
    activityReading(columns, 'token', formatMagnitude),
    activityReading(columns, 'token', formatMagnitude, 'daily')
  );

  /* THE FIGURES COME FROM THE DAILY CELLS, and this is the assertion that
     proves it rather than asserting it. viewColumns' own output repeats one
     aggregate across every day it covers, so a reading taken from it would
     count each week seven times: 196 tokens over 28 days instead of 28. */
  const weekly = viewColumns(columns, 'weekly');
  assert.equal(seriesReading(weekly).total, 196);
  assert.equal(seriesReading(columns).total, 28);
  assert.match(activityReading(columns, 'token', formatMagnitude, 'weekly'), /^28 tokens/);

  /* Singular units, in the sentence a reader sees. */
  const week = rangeColumns(seriesCells('2026-08-16', [1, 1]), '30d');
  assert.equal(
    activityReading(week, 'token', formatMagnitude, 'weekly'),
    '2 tokens over 1 week, averaging 2 per week, peaking at 2 in one week'
  );
  assert.equal(
    activityReading(week, 'token', formatMagnitude, 'monthly'),
    '2 tokens over 1 month, averaging 2 per month, peaking at 2 in one month'
  );
});

test('a period with no captured day is no period at all', () => {
  /* Two real days three weeks apart. The window draws every week between
     them, and a per-period average that counted the empty weeks would divide
     by a denominator the capture never measured — the same hole-versus-zero
     rule the daily reading follows, one grouping up. */
  const cells = [
    { value: 4, date: '2026-08-16' },
    ...Array.from({ length: 21 }, (_, index) => ({
      value: 0,
      date: addDays('2026-08-17', index),
      absent: true
    })),
    { value: 6, date: '2026-09-07' }
  ];
  const columns = rangeColumns(cells, '90d');
  assert.deepEqual(periodTotals(columns, 'weekly'), [4, 6]);
  assert.equal(
    activityReading(columns, 'token', formatMagnitude, 'weekly'),
    '10 tokens over 2 weeks, averaging 5 per week, peaking at 6 in one week'
  );
  /* A measured ZERO is a period, exactly as it is a day: it was captured. */
  const withZero = rangeColumns(seriesCells('2026-08-16', [0, 0, 0, 0, 0, 0, 0, 5]), '30d');
  assert.deepEqual(periodTotals(withZero, 'weekly'), [0, 5]);
});

test('a period total that cannot be computed exactly refuses the whole sentence', () => {
  const overflowing = rangeColumns(
    seriesCells('2026-08-16', [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]),
    '30d'
  );
  assert.equal(periodTotals(overflowing, 'weekly'), null);
  assert.equal(periodTotals(overflowing, 'monthly'), null);
  for (const view of ['daily', 'weekly', 'monthly', 'cumulative']) {
    assert.equal(
      activityReading(overflowing, 'token', formatMagnitude, view),
      'exact token figures unavailable for this range',
      `${view} reported a figure it could not compute`
    );
  }
  /* periodTotals answers only for the two lenses that GROUP; the other two
     have no period to fold into and say so rather than returning an empty
     list a caller could mistake for "no periods". */
  const columns = rangeColumns(seriesCells('2026-08-16', [1]), '30d');
  assert.equal(periodTotals(columns, 'daily'), null);
  assert.equal(periodTotals(columns, 'cumulative'), null);
});

test('figures are checked, and a figure that cannot be computed exactly is stated as unavailable', () => {
  assert.equal(isSafeCount(0), true);
  assert.equal(isSafeCount(Number.MAX_SAFE_INTEGER), true);
  for (const rogue of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '4', null, undefined]) {
    assert.equal(isSafeCount(rogue), false, `${String(rogue)} must not pass as a count`);
  }
  assert.equal(checkedAdd(2, 3), 5);
  assert.equal(checkedAdd(Number.MAX_SAFE_INTEGER, 0), Number.MAX_SAFE_INTEGER);
  // The overflow row: the sum a double would round into a lie refuses instead
  // (the direction the 2026-08-24 usage-pipeline review set for both sides).
  assert.equal(checkedAdd(Number.MAX_SAFE_INTEGER, 1), null);
  assert.equal(checkedAdd(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), null);
  assert.equal(checkedAdd(1, -1), null);
  assert.equal(checkedAdd(1.5, 1), null);

  // A window whose total leaves the safe range refuses WHOLE rather than
  // reporting a rounded one, and says which figure it declined to compute.
  const overflowing = rangeColumns(
    seriesCells('2026-08-23', [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]),
    '30d'
  );
  assert.equal(seriesReading(overflowing), null);
  assert.equal(
    activityReading(overflowing, 'token', formatMagnitude),
    'exact token figures unavailable for this range'
  );
  assert.equal(coverageReading(overflowing), '');
  // A fractional or negative count is refused at the same door.
  assert.equal(seriesReading(rangeColumns(seriesCells('2026-08-23', [1.5]), '30d')), null);
  assert.equal(seriesReading(rangeColumns(seriesCells('2026-08-23', [-1]), '30d')), null);
  // A window with nothing captured in it has no reading to give — and states
  // that rather than reporting a total of zero, which is a different claim.
  assert.equal(seriesReading([]), null);
  assert.equal(seriesReading([[{ value: 0, date: '2026-08-01', absent: true }]]), null);
  assert.equal(coverageReading([]), '');
});

test('the coverage line states its own denominator', () => {
  const cells = seriesCells('2026-08-10', new Array(15).fill(1));
  // Fifteen days out of thirty-five and fifteen out of three hundred and
  // seventy-one are the same summary sentence and very different graphs.
  assert.equal(coverageReading(rangeColumns(cells, '30d')), 'Aug 10–24, 2026 · 15 of 35 days captured');
  assert.equal(coverageReading(rangeColumns(cells, '90d')), 'Aug 10–24, 2026 · 15 of 91 days captured');
  assert.equal(coverageReading(rangeColumns(cells, '12mo')), 'Aug 10–24, 2026 · 15 of 371 days captured');
  assert.equal(coverageReading(rangeColumns(cells, 'all')), 'Aug 10–24, 2026 · 15 of 70 days captured');
  // A fully covered window says so instead of reciting "371 of 371".
  const dense = seriesCells('2026-06-21', new Array(70).fill(1));
  assert.equal(coverageReading(rangeColumns(dense, 'all')), 'Jun 21 – Aug 29, 2026 · every day in range captured');
  // A multi-year capture crosses a year boundary, so both ends of the range
  // spell their year — and the denominator is the 805-day window its 115
  // calendar weeks really draw, not the 800 days of data inside it.
  const years = seriesCells('2024-01-01', new Array(800).fill(1));
  assert.equal(
    coverageReading(rangeColumns(years, 'all')),
    'Jan 1, 2024 – Mar 10, 2026 · 800 of 805 days captured'
  );
  // Thousands are grouped, because a bare four-digit count reads as a year.
  // One hollowed day keeps this partial, so both figures render.
  const decade = seriesCells('2016-01-03', new Array(3654).fill(1)).map((cell, index) =>
    index === 5 ? { ...cell, absent: true } : cell
  );
  assert.match(coverageReading(rangeColumns(decade, 'all')), / · 3,653 of 3,6\d\d days captured$/);
  // An undated series has no window to be a fraction of, so it carries the
  // range alone rather than a ratio it cannot compute.
  assert.equal(coverageReading([[{ value: 4, date: '' }]]), '');
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

test('months are read across a year boundary, with the edge months flagged as partial', () => {
  // Dec 20 2025 through Jan 10 2026: 22 days, one token each, spanning a year
  // boundary — the case a bare month name cannot describe.
  const cells = seriesCells('2025-12-20', new Array(22).fill(1));
  const windowed = rangeColumns(cells, 'all');
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
  const twoYears = viewColumns(rangeColumns(seriesCells('2024-12-01', new Array(400).fill(2)), 'all'), 'monthly');
  const across = new Map(twoYears.flat().filter((cell) => !cell.absent).map((cell) => [cell.date, cell]));
  assert.equal(across.get('2024-12-01').value, 62, 'December 2024 is 31 covered days at 2 each');
  assert.equal(across.get('2025-12-01').value, 62, 'December 2025 is its own month, not the same one');
  assert.equal(across.get('2024-12-01').days, 31);
  assert.equal(across.get('2025-12-01').days, 31);
  // A leap February is 29 covered days, never 28.
  const leap = viewColumns(rangeColumns(seriesCells('2028-02-01', new Array(29).fill(1)), 'all'), 'monthly');
  const february = leap.flat().find((cell) => cell.date === '2028-02-29');
  assert.equal(february.value, 29);
  assert.equal(february.days, 29);

  // The monthly lens does not change what the window CONTAINS, only how it
  // is read: the reading is taken from the windowed cells for exactly that
  // reason, and summing the lens' output instead would count every month
  // once per day in it.
  const reading = seriesReading(windowed);
  assert.equal(reading.total, 22);
  const wrong = seriesReading(monthly);
  assert.equal(wrong.total, 12 * 12 + 10 * 10, 'this is the miscount the component must not make');
  assert.notEqual(wrong.total, reading.total);
});

test('the shipped fifteen-day snapshot renders identically under the default range', { skip: fullCheckout ? false : 'reduced build context ships only frontend/; the full-checkout gate enforces this pin' }, async () => {
  const snapshot = JSON.parse(
    await readFile(new URL('../../internal/panels/snapshots/token-usage.json', import.meta.url), 'utf8')
  );
  const sources = snapshot?.data?.sources ?? [];
  assert.ok(sources.length > 0, 'the shipped snapshot serves no sources; this pin proves nothing');

  const expected = {
    anthropic: '7.7B tokens over 15 days, peaking at 1.9B',
    codex: '3B tokens over 15 days, peaking at 1B'
  };
  let checked = 0;
  for (const source of sources) {
    const series = source.series;
    if (!series || series.totals.length === 0) {
      continue;
    }
    const cells = seriesCells(series.startDate, series.totals);
    const columns = rangeColumns(cells, defaultSeriesRange);
    // The geometry: byte-for-byte the columns the strip drew before this
    // control existed, which called calendarColumns with its own default.
    assert.deepEqual(columns, calendarColumns(cells), `${source.label} draws a different window than it used to`);
    assert.equal(columns.length, pendingWeeks);

    // The sentence: byte-for-byte what the adapter used to build from the
    // whole series, recomputed here by that retired formula so the two are
    // compared rather than restated.
    const total = series.totals.reduce((sum, value) => sum + value, 0);
    const days = series.totals.length;
    const peak = peakValue(cells);
    const retired = `${formatMagnitude(total)} tokens over ${days} ${days === 1 ? 'day' : 'days'}, peaking at ${formatMagnitude(peak)}`;
    assert.equal(activityReading(columns, 'token', formatMagnitude), retired, `${source.label}'s summary sentence changed`);
    if (expected[source.label] !== undefined) {
      assert.equal(activityReading(columns, 'token', formatMagnitude), expected[source.label]);
      checked += 1;
    }

    // What IS new is the line under it, and it is honest about the window the
    // default range draws: fifteen captured days inside three hundred and
    // seventy-one drawn ones.
    assert.equal(coverageReading(columns), 'Aug 10–24, 2026 · 15 of 371 days captured');
  }
  assert.equal(checked, 2, 'the snapshot no longer carries the two sources this pin names');
});

/* THE PANEL'S OWN WINDOW (owner directive, issue 268). Executed, not
 * pattern-matched: this is arithmetic, and every failure it prevents is one
 * somebody has already shipped or reported once.
 *
 * RE-AIMED from "one fixed window at every series length" (issue 233). That
 * rule drew fifty-three columns whatever the capture was, which the owner
 * reported as a graph mostly made of nothing: a fortnight of real days against
 * fifty weeks of dated emptiness reads as a year that failed rather than as a
 * fortnight that worked. The truthful-axis half of issue 189's doctrine is
 * what SURVIVES the re-aim, and it is what these assertions are now about —
 * one window per panel, identical across its sources, so a column at the same
 * x is the same week on every strip in the card. */
test('the window is the panel’s coverage, week-aligned, floored and capped (issue 268)', () => {
  // Week-aligned at BOTH ends: the window starts on the Sunday that opens the
  // oldest captured week and ends on the Saturday that closes the newest, so
  // the weekday gutter beside it is truthful for every column.
  const fortnight = seriesCells('2026-08-10', new Array(15).fill(1));
  const window = coverageWindow([fortnight]);
  assert.equal(window.end, '2026-08-29', 'the window does not close on a Saturday');
  const drawn = coverageColumns(fortnight, window);
  assert.equal(drawn.length, window.weeks);
  for (const column of drawn) {
    assert.equal(column.length, gridRows);
  }
  assert.equal(drawn.at(-1).at(-1).date, '2026-08-29');
  assert.equal(drawn[0][0].date, addDays('2026-08-29', -(window.weeks * gridRows - 1)));

  /* FLOORED at gridMinColumns, which is the width the graph's own less/more
     key needs beside it (lib/grid.ts records the measurement). A capture
     shorter than that draws its lead-in days as the dated holes they are. */
  for (const days of [1, 15, 58]) {
    const cells = seriesCells('2026-01-01', new Array(days).fill(1));
    assert.equal(
      coverageWindow([cells]).weeks,
      gridMinColumns,
      `a ${days}-day capture drew a window narrower than the legend fits in`
    );
  }
  // And between the floor and the cap the window is the CAPTURE, which is the
  // whole change: a hundred days is fifteen weeks, not fifty-three.
  const hundred = seriesCells('2026-01-01', new Array(100).fill(1));
  assert.equal(coverageWindow([hundred]).weeks, rangeWeeks(hundred, 'all'));
  assert.ok(
    coverageWindow([hundred]).weeks < pendingWeeks,
    'a hundred-day capture still draws the full fixed frame; the re-aim did not land'
  );

  /* CAPPED at the reserve, TRAILING. A capture past a year is shown from its
     newest end — the strip scrolls, exactly as it always has — rather than
     compressed or cropped at the wrong end. */
  for (const days of [400, 800, 2000]) {
    const cells = seriesCells('2024-01-01', new Array(days).fill(2));
    const measured = coverageWindow([cells]);
    assert.equal(measured.weeks, pendingWeeks, `a ${days}-day capture drew ${measured.weeks} columns`);
    const real = coverageColumns(cells, measured)
      .flat()
      .filter((cell) => !cell.absent);
    // The NEWEST captured day survives and the oldest does not: that is what
    // makes the cap trailing rather than leading.
    assert.equal(real.at(-1).date, addDays('2024-01-01', days - 1));
    assert.ok(
      real[0].date > '2024-01-01',
      `a ${days}-day capture kept its oldest day in a window narrower than itself`
    );
  }

  // Monotone up to the cap: no capture length draws a narrower graph than a
  // shorter one — the property a reader watching history accrue depends on.
  let previous = 0;
  for (const days of [1, 100, 371, 372, 500, 1500]) {
    const measured = coverageWindow([seriesCells('2026-01-01', new Array(days).fill(1))]).weeks;
    assert.ok(measured >= previous, `${days} days drew fewer columns than the capture before it`);
    previous = measured;
  }

  // A panel with nothing captured has no window to share, and an undated
  // series has no calendar to align to; both fall back rather than inventing
  // a frame, and calendarColumns still chunks an undated series positionally.
  assert.equal(coverageWindow([]), null);
  assert.equal(coverageWindow([[]]), null);
  const undated = [
    { value: 1, date: '' },
    { value: 2, date: '' },
  ];
  assert.equal(coverageWindow([undated]), null);
  assert.deepEqual(coverageColumns(undated, null), calendarColumns(undated));

  /* A window sized from its own PADDING would grow on every pass, without
     limit: run the output back through and the front-padded absent cells must
     not widen it. Only REAL days measure a window. */
  const padded = coverageColumns(fortnight, window).flat();
  assert.deepEqual(
    coverageWindow([padded]),
    window,
    'the window grew when re-measured from its own output'
  );
});

test('one window serves every source in the panel, whatever each one captured (issue 268)', () => {
  /* THE NON-VACUITY OF THE RE-AIM. A per-series window would satisfy every
     assertion above — each source would simply measure its own coverage — and
     it is exactly what the owner's stacked strips must not do. So the claim is
     stated where a per-series window FAILS it: two sources of one panel, one
     of them both shorter AND ending earlier, drawing the identical calendar.
     (Codex inside anthropic's span, as the shipped snapshot has it, with the
     ends pulled apart so the two windows cannot coincide by luck.) */
  const longer = seriesCells('2026-05-01', new Array(120).fill(3));
  const shorter = seriesCells('2026-07-01', new Array(20).fill(1));
  const panel = coverageWindow([longer, shorter]);
  const drawnLong = coverageColumns(longer, panel);
  const drawnShort = coverageColumns(shorter, panel);

  const frame = (columns) => columns.flat().map((cell) => cell.date);
  assert.deepEqual(
    frame(drawnShort),
    frame(drawnLong),
    'the two sources of one panel drew different calendars'
  );
  assert.equal(drawnShort.length, drawnLong.length);

  /* And the per-series answer genuinely differs, so the equality above is a
     property of the panel window rather than a coincidence of these two
     series. This is the assertion a re-introduced per-series window turns
     red. */
  assert.notDeepEqual(
    frame(coverageColumns(shorter, coverageWindow([shorter]))),
    frame(drawnShort),
    'the shorter source measures the same window alone as it does in the panel; this lane proves nothing'
  );

  // FRONT-PAD SURVIVES: the shorter source keeps every day it captured and
  // draws the panel's earlier weeks as the dated holes they are.
  const realShort = drawnShort.flat().filter((cell) => !cell.absent);
  assert.equal(realShort.length, 20, 'the shorter source lost a captured day to the panel window');
  assert.equal(realShort[0].date, '2026-07-01');
  assert.ok(
    drawnShort.flat().filter((cell) => cell.absent && cell.date !== '').length > 0,
    'the front pad is not drawn as dated absences'
  );
  // The window's span is the UNION: it opens on the older source's week and
  // closes on the newer source's, so neither is cropped by the other.
  assert.equal(panel.end, coverageWindow([longer]).end, 'the panel closed before its newest capture');
  assert.equal(drawnLong.flat().filter((cell) => !cell.absent).length, 120);
});
