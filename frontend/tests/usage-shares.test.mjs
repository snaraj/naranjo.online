/* Drives the labeled-share partition mathematics (issue #158): the exact-100
 * largest-remainder integer partition and the checked part-of-whole share.
 * The giant-value rows pin BigInt-exact expected outputs computed with
 * arbitrary-precision arithmetic outside JavaScript, because at that scale
 * float remainders are wrong by more than the gaps that decide who gets the
 * leftover points — the numeric direction PR #154's finding 9 set. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { integerShares, shareOfTotal } from '../src/lib/usage-shares.ts';

const MAX = Number.MAX_SAFE_INTEGER;

test('integer shares always spend exactly 100 points', () => {
  const tables = [
    [
      [
        { key: 'x', total: 1 },
        { key: 'y', total: 1 },
        { key: 'z', total: 1 }
      ],
      [34, 33, 33],
      'thirds cannot round to 99 — the earliest tied remainder takes the point'
    ],
    [
      [
        { key: 'x', total: 3 },
        { key: 'y', total: 3 },
        { key: 'z', total: 1 }
      ],
      [43, 43, 14],
      'two leftover points land on the two largest remainders'
    ],
    [
      [
        { key: 'x', total: 5 },
        { key: 'y', total: 3 },
        { key: 'z', total: 2 }
      ],
      [50, 30, 20],
      'an exact partition needs no remainder points at all'
    ],
    [[{ key: 'only', total: 7 }], [100], 'a lone entry owns the whole strip'],
    [
      [
        { key: 'u', total: 0 },
        { key: 'v', total: 9 }
      ],
      [0, 100],
      'a zero entry is honestly zero, never rounded up to visibility'
    ]
  ];
  for (const [entries, expected, why] of tables) {
    const shares = integerShares(entries);
    assert.deepEqual(
      shares.map((share) => share.pct),
      expected,
      why
    );
    assert.equal(
      shares.reduce((sum, share) => sum + share.pct, 0),
      100,
      'every partition sums to exactly 100'
    );
    assert.deepEqual(
      shares.map((share) => share.key),
      entries.map((entry) => entry.key),
      'entry order is preserved — a share identifies its entity by position'
    );
  }
});

test('order follows the entity, never the magnitude', () => {
  const shares = integerShares([
    { key: 'small', total: 1 },
    { key: 'large', total: 99 }
  ]);
  assert.deepEqual(
    shares.map((share) => [share.key, share.pct]),
    [
      ['small', 1],
      ['large', 99]
    ],
    'a filter or sort inside the partition would repaint entities downstream'
  );
});

test('giant totals partition exactly — pinned against arbitrary-precision arithmetic', () => {
  // Three near-thirds summing to exactly Number.MAX_SAFE_INTEGER. The
  // expected points were computed with exact integer arithmetic outside
  // JavaScript: the leftover point belongs to `c`, whose remainder is
  // largest by an amount far smaller than float error at this scale.
  const thirds = integerShares([
    { key: 'a', total: 3002399751580329 },
    { key: 'b', total: 3002399751580330 },
    { key: 'c', total: 3002399751580332 }
  ]);
  assert.deepEqual(
    thirds.map((share) => share.pct),
    [33, 33, 34]
  );

  // Two entries one token apart at half the ceiling: the floors are 49 and
  // 50, and the single leftover point must go to `p` — the NEAR-TOTAL
  // remainder — not to `q`, whose quotient cleared the integer instead.
  const halves = integerShares([
    { key: 'p', total: 4503599627370495 },
    { key: 'q', total: 4503599627370496 }
  ]);
  assert.deepEqual(
    halves.map((share) => share.pct),
    [50, 50],
    'the near-tie at the ceiling resolves by exact remainders'
  );

  // A realistic five-way split at cache-heavy magnitudes.
  const categories = integerShares([
    { key: 'input', total: 4503599627370496 },
    { key: 'output', total: 2251799813685248 },
    { key: 'cache-read', total: 1125899906842624 },
    { key: 'cache-write', total: 12345 },
    { key: 'reasoning', total: 0 }
  ]);
  assert.deepEqual(
    categories.map((share) => share.pct),
    [57, 29, 14, 0, 0]
  );
});

test('an empty partition is empty and a zero grand total is honest zeros', () => {
  assert.deepEqual(integerShares([]), []);
  const idle = integerShares([
    { key: 'a', total: 0 },
    { key: 'b', total: 0 }
  ]);
  assert.deepEqual(
    idle.map((share) => share.pct),
    [0, 0],
    'entities that exist unused are a statement, not an error'
  );
});

test('hostile partitions refuse whole, never render a half-true strip', () => {
  const rows = [
    [[{ key: 'a', total: -1 }], 'a negative total'],
    [[{ key: 'a', total: 1.5 }], 'a fractional total'],
    [[{ key: 'a', total: MAX + 1 }], 'an unsafe total'],
    [[{ key: 'a', total: Number.NaN }], 'NaN'],
    [[{ key: 'a', total: '9' }], 'a numeric string'],
    [
      [
        { key: 'a', total: 1 },
        { key: 'a', total: 2 }
      ],
      'a duplicate key — two rows claiming one entity'
    ],
    [[{ key: '', total: 1 }], 'an empty key'],
    [[{ key: 7, total: 1 }], 'a non-string key'],
    [
      [
        { key: 'a', total: MAX },
        { key: 'b', total: MAX },
        { key: 'c', total: 2 }
      ],
      'a grand total past the exact range — the finding-9 wrap, refused not served'
    ]
  ];
  for (const [entries, why] of rows) {
    assert.equal(integerShares(entries), null, `${why} must refuse the whole partition`);
  }
});

test('a part-of-whole share is checked in both directions', () => {
  assert.equal(shareOfTotal(1, 4), 25);
  assert.equal(shareOfTotal(0, 9), 0);
  assert.equal(shareOfTotal(9, 9), 100);
  assert.equal(shareOfTotal(0, 0), 0, 'none of nothing is honestly zero');
  const rows = [
    [[5, 4], 'a part exceeding its whole is a contradiction, not a big number'],
    [[1, 0], 'a nonzero part of a zero whole is impossible'],
    [[-1, 4], 'a negative part'],
    [[1, -4], 'a negative whole'],
    [[0.5, 4], 'a fractional part'],
    [[1, MAX + 1], 'an unsafe whole'],
    [['1', 4], 'a numeric string']
  ];
  for (const [[part, whole], why] of rows) {
    assert.equal(shareOfTotal(part, whole), null, `${why} must refuse`);
  }
});
