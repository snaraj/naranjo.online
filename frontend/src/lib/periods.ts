/* Calendar-date arithmetic, and the one sentence that renders a covered range
 * (issue 158, reduced by issue 287): what a date string is worth as a number,
 * and how a first-and-last pair is written at the shortest honest length.
 *
 * IT USED TO BE THE WINDOWING LAYER, and that layer is gone. The module was
 * built to answer "how much history is the reader looking at" for a
 * full-history activity strip: a closed range vocabulary, the week arithmetic
 * that turned a range into columns, the per-panel coverage window of issue
 * 268, and the truthful sentences describing exactly the slice on screen. The
 * ledger redesign (owner directive, 2026-09-03, issue 287) retired every one
 * of those readers together — UsageTracker, ActivityTracker and StatTracker
 * went, and with them the range control, the lens control and the per-panel
 * window — so the commits block now draws all three of its heatmaps on ONE
 * shared calendar through lib/grid.ts, per SPEC §8.8 and §1.6. Nothing was
 * weakened to get here; the code was removed because its callers were, and
 * what is left is what the page still reads.
 *
 * Two rules still bind what remains:
 *
 *   1. A DATE IS ADMITTED OR IT IS REFUSED. dayNumber is the one membership
 *      check every caller shares, and its round trip is what stops a
 *      well-shaped impossible date — February 30th — from being quietly
 *      answered as March 2nd.
 *
 *   2. NOTHING HERE KNOWS A DOMAIN. Both functions speak calendar dates and
 *      nothing else, so any dated series this site grows can read them — the
 *      information/components split issue 165 draws.
 */

import { formatCalendarDate } from './grid.ts';

/* dayNumber is a calendar date as a count of whole days, and the ONE
 * membership check every caller shares: a date this refuses is a date
 * no arithmetic here will touch.
 *
 * The round trip is the check, and it is not belt-and-braces. Shape alone
 * admits '2026-99-99', and Date.parse alone is worse than useless here —
 * asked for '2026-02-30T00:00:00Z' it does NOT return NaN, because the ISO
 * parse fails and the engine falls back to a lenient parser that silently
 * answers March 2nd. MEASURED: this function returned a valid day number for
 * February 30th until this test row was written. Re-serialising and demanding
 * the identical string back is what refuses a day that does not exist. */
export function dayNumber(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  const time = parsed.getTime();
  if (Number.isNaN(time) || parsed.toISOString().slice(0, 10) !== date) {
    return null;
  }
  return Math.round(time / 86_400_000);
}

/* formatDateRange renders a covered range at the shortest honest length: one
 * day is that day, a same-month range elides the repeated month, a same-year
 * range elides the repeated year, and a range crossing a year spells both
 * ends. Built from the grid's own date formatter so a range and a cell can
 * never write the same date two ways, and hand-assembled so the output is
 * identical in every runtime locale — a rendered figure is part of the tested
 * contract and must never depend on the visitor's environment.
 *
 * A reversed or malformed range renders as nothing: an impossible range is
 * refused, never quietly reordered into a claim nobody made. */
export function formatDateRange(first: string, last: string): string {
  const from = dayNumber(first);
  const to = dayNumber(last);
  if (from === null || to === null || to < from) {
    return '';
  }
  const opening = formatCalendarDate(first, false);
  const openingWithYear = formatCalendarDate(first, true);
  const closing = formatCalendarDate(last, true);
  if (opening === null || openingWithYear === null || closing === null) {
    return '';
  }
  if (first === last) {
    return closing;
  }
  if (first.slice(0, 7) === last.slice(0, 7)) {
    return `${opening}–${Number(last.slice(8, 10))}, ${last.slice(0, 4)}`;
  }
  if (first.slice(0, 4) === last.slice(0, 4)) {
    return `${opening} – ${closing}`;
  }
  return `${openingWithYear} – ${closing}`;
}
