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
