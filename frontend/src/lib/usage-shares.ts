/* Labeled-share partition mathematics for the dashboard's breakdown rows
 * (issue #158) — the information layer under a composition strip or a share
 * table, domain-agnostic like usage-history.ts: it partitions LABELED TOTALS
 * and knows nothing about categories, models, tokens, or panels. Vocabulary
 * bounds (which keys may exist, how many) belong to the admission boundary
 * upstream; this module's own admission is structural — keys are non-empty
 * and unique, counts are non-negative safe integers, sums are checked — the
 * same numeric direction the 2026-08-24 usage-pipeline review set (PR #154,
 * finding 9: unchecked addition wrapped MaxInt64 + MaxInt64 + 2 into a
 * "valid" partition on the Go side, and the frontend was told to require
 * non-negative safe integers).
 *
 * Why an INTEGER partition exists beside exact float shares: a strip of
 * percentages is read as a sentence — "34% + 33% + 33%" — and float shares
 * rendered independently round to sentences that total 99 or 101. The
 * largest-remainder method spends exactly 100 points, entry order is
 * preserved (color follows the entity, never its rank), and the quotients
 * are computed in BigInt so no float ever decides a floor. */

import { checkedTotal, isSafeCount } from './usage-history.ts';

/* One labeled total awaiting partition. */
export interface ShareEntry {
  key: string;
  total: number;
}

/* One partitioned share: the entry, its exact integer percent. */
export interface Share {
  key: string;
  total: number;
  pct: number;
}

/* integerShares partitions labeled totals into integer percentages summing
 * to exactly 100, by largest remainder:
 *
 *   - every entry first takes floor(total * 100 / grand), computed in BigInt
 *     because near the safe-range ceiling `total * 100` is not exactly
 *     representable as a double — the quotient's floor usually survives that,
 *     but the REMAINDERS the next step ranks are giant integers whose float
 *     error (~2^6 at this scale) is far larger than the gaps between near-tied
 *     remainders, so only exact arithmetic keeps the point allocation honest;
 *   - the remaining points (at most entries - 1) go one each to the largest
 *     division remainders, earliest entry winning ties, so the result is
 *     deterministic and stable across renders;
 *   - entry ORDER is preserved throughout — a share's position identifies
 *     its entity, so sorting here would repaint entities downstream.
 *
 * Refusals, whole and loud: a duplicate or empty key (two rows claiming one
 * entity cannot partition anything), a count that is not a non-negative safe
 * integer, or a grand total that leaves the safe range all return null. An
 * empty list partitions to an empty list, and a grand total of zero yields
 * honest zero shares — the entities exist and none of them was used, which
 * is a statement, not an error. */
export function integerShares(entries: ShareEntry[]): Share[] | null {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry.key !== 'string' || entry.key === '' || seen.has(entry.key)) {
      return null;
    }
    seen.add(entry.key);
    if (!isSafeCount(entry.total)) {
      return null;
    }
  }
  const grand = checkedTotal(entries.map((entry) => entry.total));
  if (grand === null) {
    return null;
  }
  if (grand === 0) {
    return entries.map((entry) => ({ key: entry.key, total: entry.total, pct: 0 }));
  }
  const divisor = BigInt(grand);
  const floors = entries.map((entry) => {
    const scaled = BigInt(entry.total) * 100n;
    return { floor: Number(scaled / divisor), remainder: scaled % divisor };
  });
  let leftover = 100 - floors.reduce((sum, part) => sum + part.floor, 0);
  const byRemainder = floors
    .map((part, index) => ({ remainder: part.remainder, index }))
    .sort((a, b) => {
      if (a.remainder !== b.remainder) {
        return a.remainder > b.remainder ? -1 : 1;
      }
      return a.index - b.index;
    });
  const bonus = new Set<number>();
  for (const candidate of byRemainder) {
    if (leftover === 0) {
      break;
    }
    bonus.add(candidate.index);
    leftover -= 1;
  }
  return entries.map((entry, index) => ({
    key: entry.key,
    total: entry.total,
    pct: floors[index].floor + (bonus.has(index) ? 1 : 0)
  }));
}

/* shareOfTotal is the exact part-of-whole percentage for a single figure —
 * a meter width, a "N% of the window" aside — as a plain number the caller
 * rounds for display. Checked in both directions: both figures must be
 * admitted counts, and a part EXCEEDING its whole refuses, because a share
 * above 100% of its own total is a contradiction, not a big number. A zero
 * whole holds only a zero part, which is honestly 0%. */
export function shareOfTotal(part: number, whole: number): number | null {
  if (!isSafeCount(part) || !isSafeCount(whole) || part > whole) {
    return null;
  }
  if (whole === 0) {
    return 0;
  }
  return (part / whole) * 100;
}
