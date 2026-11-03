/* The stream's paging and filtering (owner, 2026-11-02, issue #399: "Keep it
 * at 5 entries with sleek pagination"). Three pure functions the stream
 * component pages and filters its rows with, kept here rather than in the
 * component so the node suite executes them: which rows a filter keeps, how
 * many pages they make, and which rows one page shows. The gallery's mosaic
 * pages its tiles with the same two page functions. */

import type { StreamFilter, StreamRow } from './blocks.ts';

/* The rows a filter keeps, in the order they arrived: everything, the public
 * commits that carry no release, or the entries that carry one (owner,
 * 2026-11-03, issue #401: pressing the first two marks changed nothing). A
 * release rides on the commit it was cut from, so a commit filter that kept
 * every public commit kept the releases too, and differed from everything only
 * by the private days. The plain commits and the releases now split the
 * public rows between them, each row in exactly one; a private day shows under
 * everything alone. */
export function filterRows(rows: readonly StreamRow[], key: StreamFilter['key']): readonly StreamRow[] {
  if (key === 'commit') {
    return rows.filter((row) => row.kind === 'commit' && row.release === undefined);
  }
  if (key === 'release') {
    return rows.filter((row) => row.release !== undefined);
  }
  return rows;
}

/* How many pages `total` rows make at `size` a page. Never fewer than one:
 * an empty list is still one page, so the pager always has a page to say. */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

/* The rows page `page` (1-based) shows. A page past either end is clamped to
 * the nearest real one, so rows that shrink under a reader (a payload
 * landing) leave them on the last page rather than on an empty one. */
export function pageRows<Row>(rows: readonly Row[], page: number, size: number): readonly Row[] {
  const at = Math.min(Math.max(1, page), pageCount(rows.length, size));
  return rows.slice((at - 1) * size, at * size);
}
