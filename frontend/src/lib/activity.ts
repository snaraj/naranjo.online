/* The vcs-activity information module: admission, date arithmetic, link
 * validation, and the adapter that turns the panel envelope into the generic
 * ActivityTracker's props — all plain functions a node test drives directly.
 * Everything here mirrors the vcs-activity/v1 contract in
 * internal/panels/types.go: week columns of seven non-negative daily counts,
 * totals, the current streak, an optional end date, and recent commits.
 *
 * The bucketing, ramp, month axis, and cell text live in lib/grid.ts — one
 * heatmap implementation shared with the token-activity grid, so the two
 * cannot drift. */

import type { ActivityLink } from './blocks.ts';
import { addDays, type GridCell } from './grid.ts';

import type { VCSActivityData, VCSCoverage } from './panels';
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
 * non-negative counts, commit rows of repo/message/at strings (sha
 * optional, see below), and — when present — an endDate that is a plain
 * calendar date. Anything else returns null and the panel renders its
 * honest empty state; a data fault degrades one panel, never the page.
 *
 * sha is OPTIONAL, not merely type-checked: a row may omit the key
 * entirely, and that is admitted exactly like an explicitly empty string,
 * never like a malformed value (Daybreak Blue's review, round 3, finding
 * 1). This is a ROLLING-COMPATIBILITY requirement, not a style choice —
 * vcs-activity/v1 is an unversioned-forever envelope contract (see the
 * module doc above), and this chart runs a RollingUpdate across multiple
 * replicas: a browser holding the new frontend can reach an OLD replica
 * mid-rollout that still serves pre-this-PR v1 rows with no `sha` key at
 * all. Rejecting a row — or worse, the WHOLE payload, since one bad row
 * used to fail admission entirely — over an absent key one of this
 * deployment's own replicas can legitimately still send would turn a
 * routine rolling deploy into a blank activity panel for every visitor
 * mid-rollout. So: absent is truthful absence, normalized to '' below,
 * exactly like the embedded snapshot's pre-existing rows already are; the
 * only thing this loop still rejects is a PRESENT sha of the wrong type
 * (a number, an object, a boolean) — that is a genuine decode fault, not a
 * version gap. The 40-lowercase-hex shape check lives at USE time
 * (isValidCommitSha), the same layering isValidRepoSlug already uses for
 * repo: a single row with a malformed or absent value loses only that
 * row's own SHA-permalink capability, never the row, never the page. */
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
  /* Coverage is admitted by MEMBERSHIP of the closed vocabulary, never by
   * shape: it decides rendered COPY, and a free-text value here would let a
   * payload put arbitrary words beside the owner's contribution total. A
   * value outside the vocabulary refuses the payload rather than degrading
   * quietly, because a coverage nobody recognises is a claim nobody can
   * word. Absent is not a value — it is the rolling-compatibility state,
   * normalized away below exactly as an absent sha is. */
  const { coverage } = document;
  if (coverage !== undefined && coverage !== 'public' && coverage !== 'complete') {
    return null;
  }
  for (const commit of recentCommits) {
    if (
      !isRecord(commit) ||
      typeof commit.repo !== 'string' ||
      commit.repo.length === 0 ||
      (commit.sha !== undefined && typeof commit.sha !== 'string') ||
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
      sha: typeof (commit as { sha?: unknown }).sha === 'string' ? (commit as { sha: string }).sha : '',
      message: (commit as { message: string }).message,
      at: (commit as { at: string }).at
    }))
  };
  if (typeof endDate === 'string') {
    activity.endDate = endDate;
  }
  if (coverage !== undefined) {
    activity.coverage = coverage;
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
 * the repository slug always; the title's destination PREFERS the commit's
 * own validated SHA permalink whenever the row carries a valid one, and
 * falls back to the trailing "(#N)" a squash merge writes at the end of the
 * subject ("… (#123)", this very repository's own convention) only when no
 * valid SHA is present.
 *
 * This precedence is deliberate, not incidental (Daybreak Blue's review,
 * round 3, finding 3): a valid 40-lowercase-hex SHA is the ONE association
 * this module can actually prove — it is the exact identity
 * internal/panels/mapping.go validated through isCommitIdentity before ever
 * serving the row. A trailing "(#N)" is a weaker claim: pure subject-line
 * syntax this repository's own squash-merge convention happens to write,
 * true of nothing about the target beyond "some number was typed here" —
 * `(#9999999)` parses exactly as cleanly as a real one. Preferring the
 * syntactic guess over the proven identity, as an earlier revision of this
 * module did, meant a fabricated or stale trailing number could silently
 * outrank a row's own verified commit — this module now falls back to that
 * guess only when there is nothing stronger to link to at all (an old
 * rolling-compatible row with no sha, or a malformed one).
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
 * a trailing reference number, otherwise null. This is the WEAKER of the two
 * destination candidates (see the precedence note above commitShaUrl) — the
 * caller consults commitShaUrl FIRST and only falls back to this one when no
 * valid SHA exists for the same row. */
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

/* The commit's own permalink — the PREFERRED destination whenever the row
 * carries a valid SHA (Daybreak Blue's review, round 3, finding 3): it is
 * the one thing this module can prove is THIS commit, rather than a number
 * that merely appears at the end of the subject. The caller tries this
 * FIRST and falls back to commitReferenceUrl only when it returns null —
 * never the other order. Null when the repo or the SHA fails to validate,
 * in which case the caller falls through to the reference link or, with
 * neither available, plain text rather than a link to an address nobody
 * served. */
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

/* ---------------------------------------------------------------------------
 * What the COMMITS section renders from (owner directive, 2026-09-03, issue
 * 287). The adapter that turned this envelope into a whole panel's props moved
 * and became a composite: the calendar it drew is now one of three the commits
 * section cycles between, and the section reads two panels, so its adapter
 * lives in lib/commits.ts. Everything the panel's own rendering depended on —
 * admission, the calendar's cells, every validated destination, and the words
 * for each honest empty state — stays here, beside the payload it describes,
 * and is imported from there.
 * ------------------------------------------------------------------------ */

/* The log shows at most this many rows; the payload may carry more and the
 * rest simply do not render. */
export const shownEntryRows = 5;

/* contributionsLabel words the headline figure against the coverage the
 * payload declared, and it exists because the two producers count different
 * things.
 *
 * An anonymous read of the public document reports only what an anonymous
 * reader may see; a credentialed read reports the account holder's whole
 * record. Serving either under one unlabelled "contributions" would make the
 * figure change meaning — by hundreds — the day a credential is added or
 * expires, with nothing on the page to say why. So the narrower one says it is
 * narrow, and the complete one simply reads as the total it is.
 *
 * An absent coverage is the pre-field payload state and words the figure the
 * way it has always been worded, so a mid-rollout replica renders no worse
 * than it did before this existed. */
export function contributionsLabel(coverage: VCSCoverage | undefined): string {
  return coverage === 'public' ? ' public contributions' : ' contributions';
}

/* The two honest empty-state lines, verbatim from the retired component. The
 * third — the figures note — left with the figures row: the headline totals
 * are the commits caption now, and a caption with nothing to say is the
 * caption's own empty state rather than a second one. */
export const activityStripEmptyNote = 'activity data unavailable';
export const activityEntriesNote = 'no recent commits reported';

/* The title half of an entry row, encoding the destination precedence the
 * validators above document (Daybreak Blue's review, round 3, finding 3):
 * the validated SHA permalink FIRST — the one association this module can
 * prove — then the weaker "(#N)" reference, then plain text (a null href).
 * The reference is consulted only after the SHA branch answers null, never
 * independently, so the two candidates can never both win for one row. */
export function commitTitleLink(commit: { repo: string; sha: string; message: string }): ActivityLink {
  const shaHref = commitShaUrl(commit);
  if (shaHref !== null) {
    return {
      text: commit.message,
      href: shaHref,
      label: commitShaLinkLabel(commit.message, commit.sha)
    };
  }
  return {
    text: commit.message,
    href: commitReferenceUrl(commit),
    label: commitReferenceLinkLabel(commit.message)
  };
}
