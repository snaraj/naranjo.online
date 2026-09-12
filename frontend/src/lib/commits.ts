/* The two multi-panel adapters the commit record feeds (owner directive,
 * 2026-09-03, issue 287; split by the owner's 2026-09-11 directive, issue
 * 318): a cycling calendar, and a log beside the repositories it happened in.
 *
 * THE SECTION SPLIT, THE CODE DID NOT. The commits section used to be one
 * block — a calendar over a log. The owner's design decision moved the log
 * into the sheet's paired section, beside the repositories table, and the
 * calendar down into Trackers under the token cards. So this module now builds
 * TWO props bags from the same pieces: `contributionCalendarProps` takes the
 * sets, `projectsCommitsProps` takes the rows and hands the table half
 * straight through from lib/projects.ts. Nothing is duplicated — the sets, the
 * rows, the window anchor and every honest empty note are the same functions
 * they were.
 *
 * BOTH READ SEVERAL PANELS, and that is the whole reason this module exists
 * rather than the work living in lib/activity.ts. The calendar cycles between
 * the version-control contributions and each token source's daily series —
 * three pictures of the same year; the sheet pairs the repositories panel with
 * the contributions one. Neither section's props can be built from one
 * envelope. The block bindings are multi-panel ones (lib/blocks.ts), the
 * envelopes arrive here in the order each binding names them, and every domain
 * word on the way through — a repository, a vendor, a commit — stays on this
 * side of the component boundary exactly as it does in every other adapter.
 *
 * EVERY SET SHARES ONE CALENDAR. calendarColumns is given the SAME anchor for
 * all of them, so the week that ends on the contributions window's last day is
 * the last column of every picture and they can be read against each other. A
 * token series shorter than the window fills the rest of it with the dated
 * absences the grid already draws for "nothing was measured here"; a day
 * outside the captured range is not a zero, and the caption says how many days
 * were actually captured rather than letting the empty cells imply an answer.
 *
 * HOW MANY SETS THERE ARE IS DATA. One per token source that actually reports
 * days, then the contributions calendar — a source with no daily record is
 * offered no segment at all, because a segment over a grid drawing its
 * placeholder reserve is a box held open for something that cannot arrive
 * (owner ruling, 2026-08-24). A third reporting source would add a fourth
 * segment with no edit anywhere.
 *
 * THE CALENDAR OPENS ON THE BUSIEST SERIES (owner directive, 2026-09-04,
 * issue 294: "Codex has the most activity"). The lead source is named once
 * below; its set goes first, the other token sets follow in payload order,
 * and the contributions calendar closes the row. The component draws sets[0]
 * until a reader presses a segment, so the order IS the default.
 *
 * NO PANEL LABEL (same directive). The activity envelope's title names the
 * version-control host, and a calendar that opens on a token series cannot
 * wear that name; the segments name every source, so the shell gets none.
 *
 * Nothing here invents a figure. Every caption is composed from counts the
 * payloads carry, and a payload that carries none produces the set's own empty
 * note instead of a sentence about nothing.
 */

import {
  activityCells,
  activityEntriesNote,
  activityPanelId,
  activityStripEmptyNote,
  commitRepoLinkLabel,
  commitRepoUrl,
  commitShaUrl,
  commitTitleLink,
  isValidCommitSha,
  parseVCSActivity
} from './activity.ts';
import type { CalendarSet, CommitLogRow, ContributionCalendarProps, LedgerSpreadProps } from './blocks.ts';
import {
  calendarColumns,
  formatMagnitude,
  formatWhole,
  pendingWeeks,
  seriesCells
} from './grid.ts';
import { panelAge, panelKinds, panelStaleNote } from './panels.ts';
import type {
  PanelEnvelope,
  TokenUsageSource,
  VCSActivityData,
  VCSCommit,
  VCSPrivateDay
} from './panels';
import { codingProjectsPanelId, projectTableProps } from './projects.ts';
import { sourceName, tokenUsagePanelId, tokenUsageSources } from './token-usage.ts';

/* The panels each block binds, in the order its adapter reads them. The block
 * modules name them once, from here, so the order a binding declares and the
 * order the adapter unpacks can never disagree. */
export const calendarPanelIds: readonly string[] = [activityPanelId, tokenUsagePanelId];
export const spreadPanelIds: readonly string[] = [codingProjectsPanelId, activityPanelId];

/* The id the commit column answers to (owner design decision, 2026-09-11,
 * issue 318). The log had a numbered section of its own until that directive
 * and the nav no longer links this word — but an address a reader already
 * shared has to keep landing them on the log (issue 287's rule: never break a
 * URL), so the column carries the old section's id and the page keeps
 * resolving it. It is the PAGE's word, not the host's, which is why it is
 * spelled here in the adapter and reaches the component as data. */
export const commitColumnId = 'commits';

/* The commit column's own ruled head. The table beside it names five columns;
 * this one names the whole stream, because the owner's ruling is that it is
 * every repository's record rather than a selection (issue #315). */
export const commitColumnHead = 'Commits · every repository';

/* How many characters of a commit identity the log prints. Seven is the
 * host's own convention for a human-readable short reference; the href always
 * carries the validated full forty. */
export const shownShaLength = 7;

/* The mark a row shows when its own identity is not one this module can
 * vouch for — an older rolling-compatible row with no sha, or a malformed
 * one. A dash, never a truncated guess. */
const noMark = '—';

/* The three sets' own words. `Contributions` is what the calendar has always
 * counted; a token set is named for the source that reported it, which is
 * payload data, so adding a third source adds a fourth segment with no edit
 * anywhere. */
export const contributionsSetLabel = 'Contributions';

/* The activity a series carries: the sum over every day it reports. */
function seriesSum(totals: readonly number[]): number {
  return totals.reduce((running, value) => running + value, 0);
}

/* The source whose calendar the section opens on: the one that reported the
 * MOST activity, measured as the sum over the days its series carries, with
 * payload order breaking a tie. The owner's directive (2026-09-04, issue 294)
 * named the lead for exactly that reason — "has the most activity" — so the
 * rule keeps the reason and drops the name: a source that overtakes another
 * opens the section without an edit here, a payload that stops reporting the
 * lead opens on whichever set remains, and no wire key is spelled in this
 * file (the vocabulary sweep, issue #267). A source with no days carries no
 * activity and cannot lead, exactly as it is offered no segment below. */
export function leadTokenSource(sources: readonly TokenUsageSource[]): string | undefined {
  let lead: string | undefined;
  let most = -1;
  for (const source of sources) {
    const series = source.series;
    if (series === undefined || series.totals.length === 0) {
      continue;
    }
    const activity = seriesSum(series.totals);
    if (activity > most) {
      most = activity;
      lead = source.label;
    }
  }
  return lead;
}

/* A token set is named for the source that reported it, through the ONE
 * function that turns a wire key into words (issue #311): the segment a
 * reader presses and the card on the board above it say the same name because
 * both ask sourceName, and a source the vocabulary has not been taught prints
 * its raw key here exactly as it does there. */
export function tokenSetLabel(source: string): string {
  return `Tokens · ${sourceName(source)}`;
}

export const contributionsEmptyNote = activityStripEmptyNote;
export const tokenSeriesEmptyNote = 'no daily series captured';

/* The anchor every set's calendar ends on. It is the contributions window's
 * own last day — today while the producer is live, and the payload's own end
 * when that end is ahead of the reader's clock — which is the identical rule
 * lib/activity.ts applies to its own strip, so the two sections cannot draw
 * two different windows of the same year. */
function windowAnchor(activity: VCSActivityData | null, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  return activity !== null && activity.endDate !== undefined && activity.endDate > today
    ? activity.endDate
    : today;
}

/* The short identity a log row prints, or the honest dash. */
export function commitMark(sha: string): string {
  return isValidCommitSha(sha) ? sha.slice(0, shownShaLength) : noMark;
}

/* The word a PRIVATE row wears where a public row wears its repository name.
 * It is the host's own word for the same thing, and it is deliberately not a
 * link: there is nothing a reader could be sent to, and a link to a
 * repository they cannot open would be worse than no link at all. */
export const privateRowLabel = 'private';

/* What one private day says, in the host's own wording (owner directive,
 * 2026-09-11, issue #315): how many contributions, across how many
 * repositories, and not one word more. No name, no identity, no subject —
 * the aggregate IS the row, and a plural that reads "1 contributions" is the
 * kind of small lie a page tells when nobody says its sentences out loud. */
export function privateRowText(day: VCSPrivateDay): string {
  const contributions = `${formatWhole(day.contributions)} ${day.contributions === 1 ? 'contribution' : 'contributions'}`;
  const repositories = `${formatWhole(day.repositories)} private ${day.repositories === 1 ? 'repository' : 'repositories'}`;
  return `${contributions} in ${repositories}`;
}

/* THE LOG IS ONE LIST, newest first, of two kinds of row (issue #315): a
 * public commit, and a day of private contribution the account made without
 * publishing it. Interleaving them is the whole of the owner's ruling — a
 * separate private section would read as a footnote to the record rather than
 * as part of it — and the merge is a plain two-pointer walk over two lists
 * that each already arrive newest first, so nothing here sorts and nothing
 * here can reorder a row its producer dated.
 *
 * A private day is dated at the END of its day (23:59:59Z) rather than at its
 * start, so a day's private work sits above the public commits of that same
 * day rather than under the oldest of them. It is the only instant this module
 * invents, it is invented from the row's own date, and it decides ORDER only —
 * the row itself prints a day-granular age because a day is all the aggregate
 * knows.
 *
 * NOTHING IS SLICED HERE ANY MORE. The log used to hand the component exactly
 * the rows its box could hold; the box is now a RESERVE that scrolls (owner
 * ruling, 2026-09-11), so every row the wire carried renders and the wire's own
 * cap is what bounds the list. A cap in this function would be the page
 * quietly deciding the record stops at whatever the box happens to hold. */
function logRows(activity: VCSActivityData, now: Date): CommitLogRow[] {
  const commits = activity.recentCommits;
  const days = activity.privateActivity ?? [];
  const rows: CommitLogRow[] = [];
  let commit = 0;
  let day = 0;
  while (commit < commits.length || day < days.length) {
    const nextCommit = commits[commit];
    const nextDay = days[day];
    const takeDay =
      nextCommit === undefined ||
      (nextDay !== undefined && privateInstant(nextDay) > nextCommit.at);
    if (takeDay && nextDay !== undefined) {
      rows.push(privateRow(nextDay, now));
      day += 1;
      continue;
    }
    if (nextCommit === undefined) {
      break;
    }
    rows.push(publicRow(nextCommit, commit, now));
    commit += 1;
  }
  return rows;
}

/* The instant a private day is ORDERED by: the last second of the day it
 * covers, in the same shape every commit instant arrives in, so the comparison
 * is a string comparison over two RFC 3339 instants and never a Date. */
function privateInstant(day: VCSPrivateDay): string {
  return `${day.date}T23:59:59Z`;
}

function privateRow(day: VCSPrivateDay, now: Date): CommitLogRow {
  const text = privateRowText(day);
  return {
    key: `private-${day.date}`,
    age: panelAge(privateInstant(day), now),
    /* No href on either half: a private row has no destination this page may
       offer, and an anchor pointing nowhere is a promise the page cannot
       keep. The component renders plain text for a null href. */
    source: { text: privateRowLabel, href: null, label: privateRowLabel },
    title: { text, href: null, label: text },
    /* And no identity. A private commit's sha is exactly the kind of fact
       that must never reach the wire, so there is nothing to shorten. */
    mark: noMark
  };
}

function publicRow(commit: VCSCommit, index: number, now: Date): CommitLogRow {
  return {
    key: `${commit.repo}-${commit.sha}-${index}`,
    age: panelAge(commit.at, now),
    source: {
      text: commit.repo,
      href: commitRepoUrl(commit.repo),
      label: commitRepoLinkLabel(commit.repo)
    },
    title: commitTitleLink(commit),
    mark: commitShaUrl(commit) === null ? noMark : commitMark(commit.sha)
  };
}

export function contributionCalendarProps(
  envelopes: readonly (PanelEnvelope | null)[],
  now: Date = new Date()
): ContributionCalendarProps {
  const [activityEnvelope = null, usageEnvelope = null] = envelopes;
  const activity =
    activityEnvelope !== null && activityEnvelope.kind === panelKinds.vcsActivity
      ? parseVCSActivity(activityEnvelope.data)
      : null;
  const sources =
    usageEnvelope !== null && usageEnvelope.kind === panelKinds.tokenUsage
      ? tokenUsageSources(usageEnvelope.data)
      : [];
  const anchor = windowAnchor(activity, now);

  const contributions: CalendarSet = {
    key: 'contributions',
    label: contributionsSetLabel,
    columns: activity === null ? [] : calendarColumns(activityCells(activity), pendingWeeks, anchor),
    noun: 'contribution',
    stripLabel:
      activity === null
        ? 'contribution calendar'
        : `contribution calendar: ${activity.weeks.length} weeks of daily counts, newest last`,
    emptyNote: contributionsEmptyNote,
    format: formatWhole
  };
  const tokenSets: CalendarSet[] = [];
  /* A SOURCE WITH NO DAILY SERIES IS OFFERED NO SEGMENT (owner ruling,
     2026-08-24). Pushing a set for it would put a pressable segment over a
     grid that draws its 371-cell reserve and an empty note underneath — a
     graph-shaped box held open for data that cannot arrive, which is the
     exact arrangement that ruling threw out. A reserve is a promise that
     something is coming; for a source the payload carries no series for,
     nothing is.
     The source keeps its square on the board and its figures on the page, so
     nothing is hidden — only the calendar it has no days for. And skipping it
     costs the shared window nothing: the sets that remain still lay on one
     anchor in one box, which is what lets the reader cycle them. */
  for (const source of sources) {
    const series = source.series;
    if (series === undefined || series.totals.length === 0) {
      continue;
    }
    tokenSets.push({
      key: source.label,
      label: tokenSetLabel(source.label),
      columns: calendarColumns(seriesCells(series.startDate, series.totals), pendingWeeks, anchor),
      noun: 'token',
      stripLabel: `${sourceName(source.label)} token calendar: daily totals, newest last`,
      /* The note the grid would draw if this set were ever empty. The guard
         above means it is not — a token set exists only when its source
         reported days — so this is the component's contract being satisfied
         rather than a state the adapter can produce. */
      emptyNote: tokenSeriesEmptyNote,
      format: formatMagnitude
    });
  }
  /* Lead source first, the rest in payload order, contributions last. A
     stable partition rather than a sort comparator, so two payload orders
     that agree about the lead agree about everything. */
  const lead = leadTokenSource(sources);
  const sets: CalendarSet[] = [
    ...tokenSets.filter((set) => set.key === lead),
    ...tokenSets.filter((set) => set.key !== lead),
    contributions
  ];

  return {
    status: activityEnvelope?.status ?? 'unavailable',
    generatedAt: activityEnvelope?.generatedAt,
    sets
  };
}

/* The contributions panel's own staleness line. The calendar's head stopped
 * drawing one at issue 323, so the paired section below is the last reader. */
function activityStaleNote(
  envelope: PanelEnvelope | null,
  activity: VCSActivityData | null,
  now: Date
): string | undefined {
  return panelStaleNote(
    envelope?.status ?? 'unavailable',
    envelope?.generatedAt,
    activity?.endDate,
    now
  );
}

/* THE SHEET'S PAIRED SECTION (owner design decision, 2026-09-11, issue 318):
 * the repositories table from lib/projects.ts on the left, this module's
 * commit rows on the right, in one props bag because they are one section.
 *
 * The two halves are handed through rather than rebuilt: the table half IS
 * `projectTableProps`, with every rule it already proved — the payload's
 * roster, the effective instant, the captured fallback face, the three honest
 * staleness states and the one validated href shape — and the log half is the
 * same `logRows` walk the calendar block used to render under its own grid.
 *
 * THE SHELL'S READING IS THE TABLE'S. One section, one head row, and the head
 * holds one line: the sheet opens with the repositories, so their envelope is
 * what the shell's status, timestamp and note describe, and the commits panel
 * speaks for itself inside its own column — an unavailable one renders the
 * log's honest empty note where its rows would be, which is a truer statement
 * than a second caveat in a row that has space for one. The activity note is
 * the fallback exactly where the table has nothing to say, so a wedged
 * contributions panel is never silent.
 *
 * NOTHING IS SLICED. The log renders every row the wire carried and the box
 * scrolls for the rest (issue #315); the RESERVE — how many rows the box holds
 * open — is a stylesheet fact built from `shownProjectRows`, because it is the
 * table beside it that decides how tall the pair is. */
export function projectsCommitsProps(
  envelopes: readonly (PanelEnvelope | null)[],
  now: Date = new Date()
): LedgerSpreadProps {
  const [projectsEnvelope = null, activityEnvelope = null] = envelopes;
  const table = projectTableProps(projectsEnvelope, now.getTime());
  const activity =
    activityEnvelope !== null && activityEnvelope.kind === panelKinds.vcsActivity
      ? parseVCSActivity(activityEnvelope.data)
      : null;
  return {
    ...table,
    logHead: commitColumnHead,
    logAnchor: commitColumnId,
    logRows: activity === null ? [] : logRows(activity, now),
    logNote: activityEntriesNote,
    staleNote: table.staleNote ?? activityStaleNote(activityEnvelope, activity, now)
  };
}
