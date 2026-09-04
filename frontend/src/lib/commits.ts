/* The commits block's adapter (owner directive, 2026-09-03, issue 287): one
 * section that shows a cycling calendar over a log of recent commits.
 *
 * IT READS TWO PANELS, and that is the whole reason this module exists rather
 * than the work living in lib/activity.ts. The calendar cycles between the
 * version-control contributions and each token source's daily series — three
 * pictures of the same year — so the section's props cannot be built from one
 * envelope. The block binding is a multi-panel one (lib/blocks.ts), the two
 * envelopes arrive here in the order the binding names them, and every domain
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
  contributionsLabel,
  isValidCommitSha,
  parseVCSActivity,
  shownEntryRows
} from './activity.ts';
import type { CommitLogProps, CommitLogRow, CommitLogSet } from './blocks.ts';
import {
  addDays,
  calendarColumns,
  formatMagnitude,
  formatWhole,
  pendingWeeks,
  seriesCells
} from './grid.ts';
import { panelAge, panelKinds, panelStaleNote } from './panels.ts';
import type { PanelEnvelope, TokenUsageSource, VCSActivityData } from './panels';
import { tokenUsagePanelId, tokenUsageSources, usageDataThrough } from './token-usage.ts';

/* The two panels this block binds, in the order the adapter reads them. The
 * block module names them once, from here, so the order the binding declares
 * and the order this adapter unpacks can never disagree. */
export const commitPanelIds: readonly string[] = [activityPanelId, tokenUsagePanelId];

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

/* The source whose calendar the section opens on — a payload label, matched
 * exactly, so a payload that stops reporting it simply opens on whatever set
 * comes first instead. */
export const leadTokenSource = 'codex';

export function tokenSetLabel(source: string): string {
  return `Tokens · ${source}`;
}

export const contributionsEmptyNote = activityStripEmptyNote;
export const tokenSeriesEmptyNote = 'no daily series captured';

/* The contributions caption: the total the payload reported, worded against
 * the coverage it declared, and the streak beside it. */
export function contributionsCaption(activity: VCSActivityData): string {
  return `${formatWhole(activity.totalContributions)}${contributionsLabel(activity.coverage)} · ${formatWhole(activity.streak)}-day streak`;
}

/* One token source's caption. Every number in it is measured from the days the
 * payload actually carries: the sum over them, how many of them there are, the
 * largest single day, and the last day covered. */
export function tokenCaption(source: TokenUsageSource): string {
  const totals = source.series?.totals ?? [];
  const days = totals.length;
  const sum = totals.reduce((running, value) => running + value, 0);
  const peak = totals.reduce((largest, value) => (value > largest ? value : largest), 0);
  const through = source.series ? addDays(source.series.startDate, days - 1) : '';
  const parts = [
    `${formatMagnitude(sum)} tokens over ${formatWhole(days)} ${days === 1 ? 'day' : 'days'}`,
    `peak ${formatMagnitude(peak)}`
  ];
  if (through !== '') {
    parts.push(`data through ${through}`);
  }
  return parts.join(' · ');
}

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

export function commitLogProps(
  envelopes: readonly (PanelEnvelope | null)[],
  now: Date = new Date()
): CommitLogProps {
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

  const contributions: CommitLogSet = {
    key: 'contributions',
    label: contributionsSetLabel,
    columns: activity === null ? [] : calendarColumns(activityCells(activity), pendingWeeks, anchor),
    caption: activity === null ? contributionsEmptyNote : contributionsCaption(activity),
    noun: 'contribution',
    stripLabel:
      activity === null
        ? 'contribution calendar'
        : `contribution calendar: ${activity.weeks.length} weeks of daily counts, newest last`,
    emptyNote: contributionsEmptyNote,
    format: formatWhole
  };
  const tokenSets: CommitLogSet[] = [];
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
      caption: tokenCaption(source),
      noun: 'token',
      stripLabel: `${source.label} token calendar: daily totals, newest last`,
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
  const sets: CommitLogSet[] = [
    ...tokenSets.filter((set) => set.key === leadTokenSource),
    ...tokenSets.filter((set) => set.key !== leadTokenSource),
    contributions
  ];

  const rows: CommitLogRow[] =
    activity === null
      ? []
      : activity.recentCommits.slice(0, shownEntryRows).map((commit, index) => ({
          key: `${commit.repo}-${commit.sha}-${index}`,
          age: panelAge(commit.at, now),
          source: {
            text: commit.repo,
            href: commitRepoUrl(commit.repo),
            label: commitRepoLinkLabel(commit.repo)
          },
          title: commitTitleLink(commit),
          mark: commitShaUrl(commit) === null ? noMark : commitMark(commit.sha)
        }));

  return {
    status: activityEnvelope?.status ?? 'unavailable',
    generatedAt: activityEnvelope?.generatedAt,
    sets,
    rows,
    rowsNote: activityEntriesNote,
    /* The staleness line is the CALENDAR's, because the calendar is what this
       section leads with; the token sets carry their own data-through inside
       their captions, which is where a reader meets them. */
    staleNote:
      panelStaleNote(
        activityEnvelope?.status ?? 'unavailable',
        activityEnvelope?.generatedAt,
        activity?.endDate,
        now
      ) ?? usageThroughNote(usageEnvelope, sources, now)
  };
}

/* The token panel's own data-through line, used only when the calendar has
 * nothing to say about staleness: two stale lines over one section would be
 * the same caveat twice, and the calendar's is the one that describes what the
 * section leads with. */
function usageThroughNote(
  envelope: PanelEnvelope | null,
  sources: readonly TokenUsageSource[],
  now: Date
): string | undefined {
  if (envelope === null) {
    return undefined;
  }
  return panelStaleNote(envelope.status, envelope.generatedAt, usageDataThrough(sources), now);
}
