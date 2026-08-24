/* Sub-series mathematics for the full-history dashboard's per-model views
 * (issues #158 and #170) — the information layer under small multiples, a
 * stacked activity strip, and share-over-time reading. Domain-agnostic like
 * its siblings: everything here speaks LABELED SUB-SERIES of an aggregate
 * daily series — {key, slot, totals} — and never a model, vendor, or panel.
 * The closed label vocabulary, the entry-count bound, and the window ceiling
 * are the admission boundary's job (they live in parity-pinned DATA, because
 * the vendor-name doctrine keeps tool and model names out of production
 * code); this module enforces what STRUCTURE can enforce and refuses whole
 * on any violation.
 *
 * The wire contract these functions assume (the token-usage/v2 spec on issue
 * #158): sub-series are TRAILING-ALIGNED — every entry carries the same
 * number of days L, covering the aggregate's last L days — and they EXACTLY
 * PARTITION the aggregate over that suffix: per covered day, the entries sum
 * to the aggregate's own total, unattributed remainder included as an
 * explicit entry rather than derived or implied. Both directions of that
 * equality are violations: a day where the entries sum past the aggregate is
 * a lie, and a day where they fall short is a hole wearing a partition's
 * label. `slot` is the entry's fixed identity ordinal (color follows the
 * entity through it, payload after payload); slot 0 is the neutral ordinal
 * the rest/unattributed entry wears.
 *
 * The same two rules as usage-history.ts bind everything: safe-integer
 * admission with checked summation (PR #154 finding 9's direction), and
 * refusal over silent repair — no clamping, no truncation, no backfill. */

import { checkedAdd, checkedTotal, isCalendarDate, isSafeCount } from './usage-history.ts';
import { addDays } from './grid.ts';

/* One labeled sub-series of an aggregate daily series. */
export interface SubSeries {
  /* Opaque machine label — data, never interpreted here. */
  key: string;
  /* Fixed identity ordinal for palette-slot binding; 0 is the neutral
   * rest/unattributed ordinal. */
  slot: number;
  /* Daily counts, trailing-aligned to the owning aggregate. */
  totals: number[];
}

/* admitSubSeries is the structural gate every function below shares: a
 * non-empty entry list; non-empty unique keys; unique non-negative safe
 * integer slots; totals arrays of one uniform non-zero length whose every
 * value is an admissible count. Returns defensive copies, or null — a
 * hostile list never half-passes. */
function admitSubSeries(entries: SubSeries[]): SubSeries[] | null {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }
  const keys = new Set<string>();
  const slots = new Set<number>();
  const length = Array.isArray(entries[0]?.totals) ? entries[0].totals.length : 0;
  if (length === 0) {
    return null;
  }
  const admitted: SubSeries[] = [];
  for (const entry of entries) {
    if (typeof entry.key !== 'string' || entry.key === '' || keys.has(entry.key)) {
      return null;
    }
    keys.add(entry.key);
    if (!isSafeCount(entry.slot) || slots.has(entry.slot)) {
      return null;
    }
    slots.add(entry.slot);
    if (!Array.isArray(entry.totals) || entry.totals.length !== length || !entry.totals.every(isSafeCount)) {
      return null;
    }
    admitted.push({ key: entry.key, slot: entry.slot, totals: [...entry.totals] });
  }
  return admitted;
}

/* The aligned reading of a sub-series set against its aggregate: where the
 * shared window starts, how long it is, and how far into the aggregate its
 * first day sits. */
export interface AlignedSubSeries {
  /* Calendar date of the window's first day. */
  startDate: string;
  /* The uniform window length L. */
  length: number;
  /* Index of the window's first day inside the aggregate series. */
  offset: number;
  /* The admitted entries, defensively copied, order preserved. */
  entries: SubSeries[];
}

/* alignSubSeries validates a sub-series set against its aggregate and
 * resolves the trailing window: the entries must fit inside the aggregate
 * (L <= aggregate days) and must exactly partition it over the covered
 * suffix — per day, the checked sum across entries equals the aggregate's
 * own value, in BOTH directions. Any violation, either numeric or
 * structural, refuses the whole alignment: there is no partial per-model
 * story, exactly as there is no partial category breakdown. */
export function alignSubSeries(
  aggStartDate: string,
  aggValues: number[],
  entries: SubSeries[]
): AlignedSubSeries | null {
  const admitted = admitSubSeries(entries);
  if (admitted === null || aggValues.length === 0 || !aggValues.every(isSafeCount)) {
    return null;
  }
  if (!isCalendarDate(aggStartDate)) {
    return null;
  }
  const length = admitted[0].totals.length;
  if (length > aggValues.length) {
    return null;
  }
  const offset = aggValues.length - length;
  for (let day = 0; day < length; day += 1) {
    const sum = checkedTotal(admitted.map((entry) => entry.totals[day]));
    if (sum === null || sum !== aggValues[offset + day]) {
      return null;
    }
  }
  return {
    startDate: addDays(aggStartDate, offset),
    length,
    offset,
    entries: admitted
  };
}

/* topSubSeries reduces a sub-series set to the `keep` largest entries plus
 * one folded rest — the shape small multiples want when the vocabulary holds
 * more lines than a reader can follow. Ranking is by checked window total,
 * descending; ties resolve by ascending slot, then original order, so the
 * result is deterministic across renders. Slot-0 entries are rest-natured by
 * definition and always fold when any folding happens — the neutral ordinal
 * never displaces a named entry from the top. The fold sums per day with
 * checked addition under the caller's `restKey` and the neutral slot 0.
 * When nothing needs folding the ranked entries return as they are, slot-0
 * members included, and no rest row is invented. A `restKey` colliding with
 * a kept entry's key refuses — two rows claiming one identity is the
 * downstream confusion this module exists to prevent. */
export function topSubSeries(entries: SubSeries[], keep: number, restKey: string): SubSeries[] | null {
  const admitted = admitSubSeries(entries);
  if (admitted === null || !Number.isSafeInteger(keep) || keep < 1) {
    return null;
  }
  if (typeof restKey !== 'string' || restKey === '') {
    return null;
  }
  const totals = admitted.map((entry) => checkedTotal(entry.totals));
  if (totals.some((total) => total === null)) {
    return null;
  }
  const ranked = admitted
    .map((entry, index) => ({ entry, total: totals[index] as number, index }))
    .sort((a, b) => {
      if (a.total !== b.total) {
        return b.total - a.total;
      }
      if (a.entry.slot !== b.entry.slot) {
        return a.entry.slot - b.entry.slot;
      }
      return a.index - b.index;
    });
  if (ranked.length <= keep) {
    return ranked.map((candidate) => candidate.entry);
  }
  const kept = ranked.filter((candidate) => candidate.entry.slot !== 0).slice(0, keep);
  const folded = ranked.filter((candidate) => !kept.includes(candidate));
  if (kept.some((candidate) => candidate.entry.key === restKey)) {
    return null;
  }
  const length = admitted[0].totals.length;
  const rest: SubSeries = { key: restKey, slot: 0, totals: new Array<number>(length).fill(0) };
  for (const candidate of folded) {
    for (let day = 0; day < length; day += 1) {
      const sum = checkedAdd(rest.totals[day], candidate.entry.totals[day]);
      if (sum === null) {
        return null;
      }
      rest.totals[day] = sum;
    }
  }
  return [...kept.map((candidate) => candidate.entry), rest];
}

/* shareOverTime reads each entry's share of every day, in percent of that
 * day's own checked sum across entries. A day whose entries sum to zero has
 * NO shares — every entry reads null there, a gap, because "0% of nothing"
 * and "100% of nothing" are equally empty claims. Result is indexed
 * [entry][day], entry order preserved. */
export function shareOverTime(entries: SubSeries[]): Array<Array<number | null>> | null {
  const admitted = admitSubSeries(entries);
  if (admitted === null) {
    return null;
  }
  const length = admitted[0].totals.length;
  const shares = admitted.map(() => new Array<number | null>(length).fill(null));
  for (let day = 0; day < length; day += 1) {
    const sum = checkedTotal(admitted.map((entry) => entry.totals[day]));
    if (sum === null) {
      return null;
    }
    if (sum === 0) {
      continue;
    }
    admitted.forEach((entry, index) => {
      shares[index][day] = (entry.totals[day] / sum) * 100;
    });
  }
  return shares;
}

/* One stacked segment: a day's [from, to) integer span for one entry, in the
 * day's own count units, from = to when the entry contributed nothing. */
export interface StackedSpan {
  from: number;
  to: number;
}

/* stackedSpans lays a sub-series set out as stacked segments per day —
 * the arithmetic under a stacked activity strip. Segments stack in entry
 * order with checked running sums, so the top of the last segment IS the
 * day's total and can never silently disagree with it. Result is indexed
 * [entry][day], entry order preserved. */
export function stackedSpans(entries: SubSeries[]): StackedSpan[][] | null {
  const admitted = admitSubSeries(entries);
  if (admitted === null) {
    return null;
  }
  const length = admitted[0].totals.length;
  const spans = admitted.map(() => new Array<StackedSpan>(length));
  for (let day = 0; day < length; day += 1) {
    let running = 0;
    for (let index = 0; index < admitted.length; index += 1) {
      const next = checkedAdd(running, admitted[index].totals[day]);
      if (next === null) {
        return null;
      }
      spans[index][day] = { from: running, to: next };
      running = next;
    }
  }
  return spans;
}
