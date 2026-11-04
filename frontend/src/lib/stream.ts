/* The stream's paging and filtering (owner, 2026-11-02, issue #399: "Keep it
 * at 5 entries with sleek pagination"). Three pure functions the stream
 * component pages and filters its rows with, kept here rather than in the
 * component so the node suite executes them: which rows a filter keeps, how
 * many pages they make, and which rows one page shows. The gallery's mosaic
 * pages its tiles with the same two page functions. */

import type { StreamFilter, StreamKind, StreamRow } from './blocks.ts';

/* The kinds each feed keeps (owner, 2026-11-03, issue #401): the commit feed
 * is the public commits and the private days among them, the merge feed the
 * merged pull requests, the release feed the releases. Every kind is in
 * exactly one feed, so every entry is too. */
const feedKinds: Readonly<Record<StreamFilter['key'], readonly StreamKind[]>> = {
  commit: ['commit', 'private'],
  merge: ['merge'],
  release: ['release']
};

/* The rows a feed keeps, in the order they arrived. */
export function filterRows(rows: readonly StreamRow[], key: StreamFilter['key']): readonly StreamRow[] {
  const kinds = feedKinds[key];
  return rows.filter((row) => kinds.includes(row.kind));
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
