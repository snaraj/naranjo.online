/* Drives the sub-series mathematics behind the per-model views (issues #158
 * and #170): trailing alignment with exact both-direction partition against
 * the aggregate, deterministic top-N-plus-rest folding, share-over-time with
 * honest zero-day gaps, and stacked spans whose top edge is the day's own
 * total. Hostile tables per the finding-9 numeric contract: non-negative
 * safe integers, checked summation, refusal over silent repair. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { alignSubSeries, shareOverTime, stackedSpans, topSubSeries } from '../src/lib/usage-models.ts';

const MAX = Number.MAX_SAFE_INTEGER;

/* Ten aggregate days of 10 from the snapshot's own start date; the entries
 * cover the trailing four days and partition each of them exactly. */
const aggStart = '2026-08-10';
const agg = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
const entries = [
  { key: 'a', slot: 1, totals: [4, 5, 0, 10] },
  { key: 'b', slot: 2, totals: [6, 5, 0, 0] },
  { key: 'other', slot: 0, totals: [0, 0, 10, 0] }
];

test('alignment resolves the trailing window and preserves entry order', () => {
  const aligned = alignSubSeries(aggStart, agg, entries);
  assert.equal(aligned.length, 4, 'the uniform entry length is the window');
  assert.equal(aligned.offset, 6, 'four trailing days of ten start at index six');
  assert.equal(aligned.startDate, '2026-08-16', 'the window start is a real re-dated day');
  assert.deepEqual(
    aligned.entries.map((entry) => entry.key),
    ['a', 'b', 'other'],
    'entry order is preserved — identity rides position and slot, never rank'
  );
  assert.notEqual(aligned.entries[0].totals, entries[0].totals, 'aligned entries copy, never alias the payload');
});

test('the partition is exact in BOTH directions, or there is no partition', () => {
  // One token over on the last covered day: the entries claim more than the
  // aggregate reports.
  const over = [
    { key: 'a', slot: 1, totals: [4, 5, 0, 11] },
    { key: 'b', slot: 2, totals: [6, 5, 10, 0] }
  ];
  assert.equal(alignSubSeries(aggStart, agg, over), null, 'a sum past the aggregate is a lie');
  // One token short: a hole wearing a partition's label.
  const short = [
    { key: 'a', slot: 1, totals: [4, 5, 0, 9] },
    { key: 'b', slot: 2, totals: [6, 5, 10, 0] }
  ];
  assert.equal(alignSubSeries(aggStart, agg, short), null, 'a sum below the aggregate is a hole, not a partition');
});

test('alignment refuses hostile structures whole', () => {
  const rows = [
    [[{ key: 'a', slot: 1, totals: [10, 10] }, { key: 'a', slot: 2, totals: [10, 10] }], 'a duplicate key'],
    [[{ key: 'a', slot: 1, totals: [10, 10] }, { key: 'b', slot: 1, totals: [10, 10] }], 'a duplicate slot'],
    [[{ key: '', slot: 1, totals: [10, 10] }], 'an empty key'],
    [[{ key: 'a', slot: -1, totals: [10, 10] }], 'a negative slot'],
    [[{ key: 'a', slot: 1.5, totals: [10, 10] }], 'a fractional slot'],
    [[{ key: 'a', slot: 1, totals: [10, 10] }, { key: 'b', slot: 2, totals: [10] }], 'ragged lengths'],
    [[{ key: 'a', slot: 1, totals: [] }], 'an empty window'],
    [[{ key: 'a', slot: 1, totals: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }], 'a window longer than the aggregate'],
    [[{ key: 'a', slot: 1, totals: [10, 10.5] }], 'a fractional count'],
    [[{ key: 'a', slot: 1, totals: [10, -1] }], 'a negative count'],
    [[], 'an empty entry list — an absent section is the caller state, not an empty partition']
  ];
  for (const [hostile, why] of rows) {
    assert.equal(alignSubSeries(aggStart, agg, hostile), null, `${why} must refuse the whole alignment`);
  }
  assert.equal(alignSubSeries('2026-99-99', agg, entries), null, 'a fake aggregate start refuses');
  assert.equal(alignSubSeries(aggStart, [10, 0.5], [{ key: 'a', slot: 1, totals: [10] }]), null, 'a hostile aggregate refuses');
  assert.equal(alignSubSeries(aggStart, [], entries), null, 'an empty aggregate holds no window');
});

test('top-N keeps the largest named entries and folds the rest deterministically', () => {
  const four = [
    { key: 'a', slot: 1, totals: [30] },
    { key: 'b', slot: 2, totals: [50] },
    { key: 'c', slot: 3, totals: [10] },
    { key: 'other', slot: 0, totals: [100] }
  ];
  const reduced = topSubSeries(four, 2, 'rest');
  assert.deepEqual(
    reduced.map((entry) => [entry.key, entry.slot, entry.totals[0]]),
    [
      ['b', 2, 50],
      ['a', 1, 30],
      ['rest', 0, 110]
    ],
    'slot 0 is rest-natured: its size never displaces a named entry from the top'
  );
  assert.equal(
    reduced.reduce((sum, entry) => sum + entry.totals[0], 0),
    190,
    'folding loses nothing — the reduced set still totals the original'
  );
});

test('top-N ranking ties resolve by ascending slot, and a wide-enough keep folds nothing', () => {
  const tied = [
    { key: 'late', slot: 2, totals: [20] },
    { key: 'early', slot: 1, totals: [20] }
  ];
  assert.deepEqual(
    topSubSeries(tied, 1, 'rest').map((entry) => entry.key),
    ['early', 'rest'],
    'equal totals rank by ascending slot, deterministically'
  );
  const all = topSubSeries(tied, 5, 'rest');
  assert.deepEqual(
    all.map((entry) => entry.key),
    ['early', 'late'],
    'nothing to fold means no rest row is invented'
  );
});

test('top-N refuses hostile folds instead of repairing them', () => {
  const four = [
    { key: 'a', slot: 1, totals: [30] },
    { key: 'b', slot: 2, totals: [50] },
    { key: 'c', slot: 3, totals: [10] }
  ];
  for (const [keep, why] of [
    [0, 'a zero keep'],
    [-1, 'a negative keep'],
    [1.5, 'a fractional keep']
  ]) {
    assert.equal(topSubSeries(four, keep, 'rest'), null, `${why} must refuse`);
  }
  assert.equal(topSubSeries(four, 2, ''), null, 'an empty rest key refuses');
  assert.equal(topSubSeries(four, 2, 'b'), null, 'a rest key colliding with a kept entry refuses');
  const overflow = [
    { key: 'x', slot: 1, totals: [MAX] },
    { key: 'y', slot: 2, totals: [MAX] },
    { key: 'z', slot: 3, totals: [1] }
  ];
  assert.equal(topSubSeries(overflow, 1, 'rest'), null, 'a fold whose sum leaves the exact range refuses whole');
});

test('shares read per day, and a zero day is a gap for every entry', () => {
  const shares = shareOverTime([
    { key: 'a', slot: 1, totals: [1, 0, 3] },
    { key: 'b', slot: 2, totals: [3, 0, 1] }
  ]);
  assert.deepEqual(shares[0], [25, null, 75], 'entry a: quarter, gap, three quarters');
  assert.deepEqual(shares[1], [75, null, 25], 'entry b mirrors it');
  assert.equal(shareOverTime([{ key: 'a', slot: 1, totals: [0.5] }]), null, 'hostile counts refuse');
});

test('stacked spans accumulate in entry order and top out at the day total', () => {
  const spans = stackedSpans([
    { key: 'a', slot: 1, totals: [2, 0] },
    { key: 'b', slot: 2, totals: [3, 7] }
  ]);
  assert.deepEqual(spans[0], [{ from: 0, to: 2 }, { from: 0, to: 0 }], 'a zero contribution is an empty span, not a missing one');
  assert.deepEqual(spans[1], [{ from: 2, to: 5 }, { from: 0, to: 7 }]);
  assert.equal(
    stackedSpans([
      { key: 'x', slot: 1, totals: [MAX] },
      { key: 'y', slot: 2, totals: [1] }
    ]),
    null,
    'a stack whose running sum leaves the exact range refuses whole'
  );
});
