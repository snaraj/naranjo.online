/* Pure helpers behind ActivityBar.svelte, kept out of the component so the
 * strip's admission, quantization, and date arithmetic are plain functions a
 * node test can drive directly. Everything here mirrors the vcs-activity/v1
 * contract in internal/panels/types.go: week columns of seven non-negative
 * daily counts, totals, the current streak, and recent commits. */

import type { VCSActivityData } from './panels';

/* The registry identifier the activity strip loads; the one place the id is
 * spelled on the frontend. */
export const activityPanelId = 'vcs-activity';

/* activityLevels is the number of magnitude buckets the strip renders: level
 * 0 is "no contributions" and levels 1..4 are quartiles of the window's peak
 * day. The sequential cell ramp in ActivityBar.svelte has exactly one color
 * custom property per level. */
export const activityLevels = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/* parseVCSActivity admits only payloads carrying the exact shape the strip
 * renders: non-negative totals and streak, week columns of exactly seven
 * non-negative counts, and commit rows of repo/message/at strings. Anything
 * else returns null and the panel renders its honest empty state — a data
 * fault degrades one panel, never the page. */
export function parseVCSActivity(document: unknown): VCSActivityData | null {
  if (!isRecord(document)) {
    return null;
  }
  const { totalContributions, weeks, streak, recentCommits } = document;
  if (!isCount(totalContributions) || !isCount(streak)) {
    return null;
  }
  if (!Array.isArray(weeks) || !Array.isArray(recentCommits)) {
    return null;
  }
  for (const week of weeks) {
    if (!Array.isArray(week) || week.length !== 7 || !week.every(isCount)) {
      return null;
    }
  }
  for (const commit of recentCommits) {
    if (
      !isRecord(commit) ||
      typeof commit.repo !== 'string' ||
      commit.repo.length === 0 ||
      typeof commit.message !== 'string' ||
      typeof commit.at !== 'string'
    ) {
      return null;
    }
  }
  return {
    totalContributions,
    weeks: weeks as number[][],
    streak,
    recentCommits: recentCommits.map((commit) => ({
      repo: (commit as { repo: string }).repo,
      message: (commit as { message: string }).message,
      at: (commit as { at: string }).at
    }))
  };
}

/* maxDailyCount is the window's peak day, the anchor the level buckets are
 * quantized against. */
export function maxDailyCount(weeks: number[][]): number {
  let max = 0;
  for (const week of weeks) {
    for (const count of week) {
      if (count > max) {
        max = count;
      }
    }
  }
  return max;
}

/* activityLevel buckets one day into levels 0..4: zero days stay level 0,
 * and any non-zero day lands in the quartile of the window's peak — so a
 * single contribution is always visible and the peak day is always level 4. */
export function activityLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) {
    return 0;
  }
  return Math.min(activityLevels - 1, Math.ceil((count / max) * (activityLevels - 1)));
}

/* cellDate derives one cell's UTC calendar date from the envelope's
 * generatedAt instant. The payload carries counts only, so the anchor is the
 * contract's shape itself: weeks are whole, oldest first, and the last day of
 * the last week is the capture day. An absent or malformed instant yields ''
 * and the cell label carries the count alone. */
export function cellDate(
  generatedAt: string | undefined,
  weekCount: number,
  week: number,
  day: number
): string {
  if (!generatedAt) {
    return '';
  }
  const at = new Date(generatedAt);
  if (Number.isNaN(at.getTime())) {
    return '';
  }
  const offsetDays = (weekCount - 1 - week) * 7 + (6 - day);
  const cell = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - offsetDays)
  );
  return cell.toISOString().slice(0, 10);
}

/* cellLabel is the one accessible text a cell carries — tooltip and
 * aria-label alike — so the count is never encoded by color alone. */
export function cellLabel(count: number, date: string): string {
  const noun = count === 1 ? 'contribution' : 'contributions';
  return date ? `${count} ${noun} on ${date}` : `${count} ${noun}`;
}
