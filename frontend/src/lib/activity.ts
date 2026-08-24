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
import { projectHost, projectHostLabel } from './projects.ts';

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
 * non-negative counts, commit rows of repo/sha/message/at strings, and —
 * when present — an endDate that is a plain calendar date. Anything else
 * returns null and the panel renders its honest empty state; a data fault
 * degrades one panel, never the page.
 *
 * sha is checked for TYPE only here, never for shape or non-emptiness —
 * unlike repo, which the server never legitimately serves blank. The
 * embedded snapshot predates the SHA field and truthfully serves "" for
 * every one of its rows; rejecting the whole payload over that would turn
 * an honest gap in old data into an outage of the whole commit list. The
 * 40-lowercase-hex shape check lives at USE time (isValidCommitSha), the
 * same layering isValidRepoSlug already uses for repo: a single row with a
 * malformed value loses only that row's own capability, never the page. */
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
      typeof commit.sha !== 'string' ||
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
      sha: (commit as { sha: string }).sha,
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

/* Outbound navigation for the recent-commits rows (issue 157). Every entry
 * becomes real navigation, but only from fields the payload actually proves:
 * the repository slug always; the title's destination is either the
 * trailing "(#N)" a squash merge writes at the end of the subject ("…
 * (#123)", this very repository's own convention), or — when no such
 * reference resolves — the commit's own validated SHA, carried through the
 * wire contract precisely so this fallback has something real to point at
 * (VCSCommit.sha in panels.ts, mirroring internal/panels/mapping.go, which
 * validates the identical 40-lowercase-hex shape before this module ever
 * sees it).
 *
 * The "(#N)" destination is deliberately /issues/N, never /pull/N, and the
 * accessible name calls it a "reference", never a "pull request": this
 * module can prove the SUBJECT carries a trailing number in the squash-merge
 * convention, but nothing here — or anywhere this frontend can reach without
 * a new outbound call this origin's zero-egress doctrine forbids for a
 * decorative link — confirms N actually names a pull request rather than an
 * issue. The host's own numbering answers that ambiguity for us: issues and
 * pull requests share one sequence per repository, and /issues/N redirects
 * to /pull/N when N is a pull request, so the visitor still lands on exactly
 * the right page either way. Saying anything more specific than "reference"
 * would be a claim this module cannot back up.
 *
 * Every href below is CONSTRUCTED from a validated field, never interpolated
 * from the raw string: a repo slug that fails the pattern, a subject whose
 * trailing parenthetical is not a clean positive integer, or a SHA that is
 * not 40 lowercase hex digits (including the empty string the embedded
 * snapshot's pre-existing rows still carry) all produce `null` for their own
 * branch, and the caller falls through to the next candidate or, with none
 * left, renders plain text. The host itself is imported from projects.ts
 * rather than spelled a second time — that module already names the owner's
 * account once, on purpose, and this import keeps that true. */

/* The character set the host actually accepts for a repository name: ASCII
 * letters, digits, dots, hyphens and underscores, 1-100 characters, and
 * never starting with anything outside that set. A repo string that fails
 * this can carry a quote, a scheme, a path segment, or whitespace, so
 * admission happens BEFORE any href is built, never after. */
const repoSlugPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function isValidRepoSlug(repo: string): boolean {
  return repoSlugPattern.test(repo);
}

/* The repository's own address, or null when the slug does not validate. */
export function commitRepoUrl(repo: string): string | null {
  return isValidRepoSlug(repo) ? `${projectHost}/${repo}` : null;
}

/* The accessible name a repo-name link carries — the same shape
 * projectLinkLabel already gives the Coding Projects feed's own outbound
 * links, so a reader hears one convention for "this leaves the page"
 * everywhere on the page. */
export function commitRepoLinkLabel(repo: string): string {
  return `${repo} on ${projectHostLabel}, opens in a new tab`;
}

/* The trailing "(#123)" a squash-merged subject line carries. Anchored at
 * the very end of the string so an incidental parenthetical mid-sentence can
 * never be mistaken for one, and admitting only a clean positive integer
 * with no leading zero and no runaway digit string — "(#007)", "(#12e3)"
 * and "(#0)" all fail closed to null rather than guess at what was meant. */
const pullRequestPattern = /\(#([1-9]\d{0,6})\)\s*$/;

export function commitPullRequestNumber(message: string): number | null {
  const match = pullRequestPattern.exec(message);
  if (match === null) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/* The commit's "(#N)" reference destination: /issues/N (never /pull/N — see
 * the block comment above) when the repo validates and the subject resolves
 * a trailing reference number, otherwise null. */
export function commitReferenceUrl(commit: { repo: string; message: string }): string | null {
  const repo = commitRepoUrl(commit.repo);
  if (repo === null) {
    return null;
  }
  const pr = commitPullRequestNumber(commit.message);
  return pr === null ? null : `${repo}/issues/${pr}`;
}

/* The accessible name a "(#N)" reference link carries. Deliberately neutral
 * — "reference", never "pull request" — because the payload proves only
 * that the subject carries this repository's own trailing-number
 * convention, not that the number specifically names a pull request. */
export function commitReferenceLinkLabel(message: string): string {
  return `${message}, reference, opens in a new tab`;
}

/* The commit identity's own shape: 40 lowercase hex digits, matching
 * internal/panels's isCommitIdentity exactly. The embedded snapshot's
 * pre-existing rows still serve the empty string here — a legitimate,
 * truthful absence — and this fails it closed exactly like every other
 * shape that is not a real commit identity. */
const commitShaPattern = /^[0-9a-f]{40}$/;

export function isValidCommitSha(sha: string): boolean {
  return commitShaPattern.test(sha);
}

/* The commit's own permalink — the fallback destination used only once
 * commitReferenceUrl has already returned null for the same commit. Null
 * when the repo or the SHA fails to validate, in which case the entry
 * renders as plain text rather than link to an address nobody served. */
export function commitShaUrl(commit: { repo: string; sha: string }): string | null {
  const repo = commitRepoUrl(commit.repo);
  if (repo === null || !isValidCommitSha(commit.sha)) {
    return null;
  }
  return `${repo}/commit/${commit.sha}`;
}

/* The accessible name a commit-permalink link carries. The short form — the
 * leading 7 hex digits — is the host's own convention for a human-readable
 * commit reference; the href commitShaUrl builds always carries the
 * validated full 40, this label's slice is display-only. */
export function commitShaLinkLabel(message: string, sha: string): string {
  return `${message}, commit ${sha.slice(0, 7)}, opens in a new tab`;
}
