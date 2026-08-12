/* Pure helpers behind ActivityBar.svelte, kept out of the component so the
 * strip's admission and date arithmetic are plain functions a node test can
 * drive directly. Everything here mirrors the vcs-activity/v1 contract in
 * internal/panels/types.go: week columns of seven non-negative daily counts,
 * totals, the current streak, an optional end date, and recent commits.
 *
 * The bucketing, ramp, month axis, and cell text live in lib/grid.ts — one
 * heatmap implementation shared with the token-activity grid, so the two
 * cannot drift. */

import { addDays, type GridCell } from './grid.ts';
import type { VCSActivityData } from './panels';

/* The registry identifier the activity strip loads; the one place the id is
 * spelled on the frontend. */
export const activityPanelId = 'vcs-activity';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/* parseVCSActivity admits only payloads carrying the exact shape the strip
 * renders: non-negative totals and streak, week columns of exactly seven
 * non-negative counts, commit rows of repo/message/at strings, and — when
 * present — an endDate that is a plain calendar date. Anything else returns
 * null and the panel renders its honest empty state; a data fault degrades
 * one panel, never the page. */
export function parseVCSActivity(document: unknown): VCSActivityData | null {
  if (!isRecord(document)) {
    return null;
  }
  const { totalContributions, weeks, streak, recentCommits, endDate } = document;
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
  if (endDate !== undefined && (typeof endDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(endDate))) {
    return null;
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
  const activity: VCSActivityData = {
    totalContributions,
    weeks: weeks as number[][],
    streak,
    recentCommits: recentCommits.map((commit) => ({
      repo: (commit as { repo: string }).repo,
      message: (commit as { message: string }).message,
      at: (commit as { at: string }).at
    }))
  };
  if (typeof endDate === 'string') {
    activity.endDate = endDate;
  }
  return activity;
}

/* activityCells turns the payload's week columns into dated grid cells.
 *
 * The final week is padded to seven days like every other, so on its own the
 * padding is indistinguishable from genuine quiet days. endDate is the anchor
 * that resolves it: days after it are days the window does not cover, and
 * they are marked absent so the grid draws them as holes rather than as
 * zero-contribution days that have not happened yet.
 *
 * Without an endDate the counts still render — they are real — but undated
 * and unpadded, because guessing the anchor would date every cell wrongly. */
export function activityCells(activity: VCSActivityData): GridCell[] {
  const days = activity.weeks.flat();
  if (days.length === 0) {
    return [];
  }
  const end = activity.endDate ? new Date(`${activity.endDate}T00:00:00Z`) : null;
  if (!end || Number.isNaN(end.getTime())) {
    return days.map((value) => ({ value, date: '' }));
  }
  /* Columns run Sunday..Saturday, so the padded tail is however much of the
   * final column sits after the end date's weekday. */
  const padded = 6 - end.getUTCDay();
  const lastReal = days.length - 1 - padded;
  return days.map((value, index) => {
    const offset = index - lastReal;
    const date = addDays(activity.endDate as string, offset);
    return offset > 0 ? { value: 0, date, absent: true } : { value, date };
  });
}
