/* The chronicle's adapter (owner direction, 2026-10-16): the trackers' board
 * and the calendar, composed into ONE diagram on one timeline.
 *
 * Nothing is re-derived here. The calendar's sets come from
 * contributionCalendarProps and the figures, facts and model rows from
 * tokenBoardProps — the same two adapters, with every rule they already prove
 * — and this module only lays them side by side: every set becomes a layer
 * the line plots AND the calendar paints, each with the figures its seal
 * reads, the first source the one it opens on, and the board's cards become
 * the accounts under the diagram. Because every set is laid on the same anchor and the same number
 * of weeks, the line and the cells share their days by construction, which is
 * what lets one cursor read both.
 *
 * Pure, so the node suite executes it directly. */

import type {
  CalendarSet,
  ChronicleAccount,
  ChronicleDay,
  ChronicleHeadline,
  ChronicleLayer,
  ChronicleProps,
  ChronicleSeries,
  LedgerCard,
  LedgerFact
} from './blocks.ts';
import { activityCells, parseVCSActivity } from './activity.ts';
import { calendarPanelIds, contributionCalendarProps } from './commits.ts';
import { formatCalendarDate, formatWhole, monthTicks, pendingWeeks, type GridCell } from './grid.ts';
import { panelKinds, type PanelEnvelope } from './panels.ts';
import { codingProjectsPanelId, parseCodingProjects } from './projects.ts';
import {
  formatStatValue,
  knownSourceKeys,
  maxDrawnModels,
  sourceName,
  tokenBoardProps,
  tokenUsageSources
} from './token-usage.ts';

/* The diagram reads the calendar's two panels, in the calendar's order, and
 * the projects panel for the pull requests its repositories have closed. */
export const chroniclePanelIds: readonly string[] = [...calendarPanelIds, codingProjectsPanelId];

/* The figures beside the graph, in the owner's words (2026-10-16): the
 * contributions' two, and the words a source's two are made of (2026-10-21). */
export const pullsLabel = 'Pull Requests Closed';
export const commitsLabel = 'Commits Pushed';
export const tokensWord = 'Tokens';
export const overallCaption = 'overall';
export const latestLabel = 'Latest Day';

/* AN ACCOUNT IS A LEAF OF THE CHAINED TOME (owner, 2026-10-20, picking T3 of
 * the tome's five settings, after "remove 'itemised' insted just put cache
 * write and cache read"). It opens on its lifetime, in all, and then reads the
 * same rows in the same order as every other account (owner, 2026-10-16:
 * "they must be aligned"): its cache, read and written; the two windows every
 * source reports; and its records. The input and output totals and the row
 * that said how much of the lifetime they itemised are not printed — what
 * each model took in and gave out reads on the tome's second leaf, model by
 * model, and two cache rows beside a lifetime claim no split of it. */
const tomeClasses: readonly string[] = ['cache-read', 'cache-write'];

/* The streak reads as one row, the current run and the longest beside it. */
export const streakTerm = 'streak';
const accountRecords: readonly { key: string; term: string }[] = [
  { key: 'sessions', term: 'sessions' },
  { key: 'current-streak', term: streakTerm },
  { key: 'longest-session', term: 'longest session' }
];

/* THE ROOM AN ACCOUNT HOLDS (AGENTS.md "Zero CLS": space for late content is
 * reserved up front; browser lanes, 2026-10-16: the trackers' board was 157px
 * while its data was in flight and 952px once it landed). An account's rows
 * are its two cache classes, the two usage windows every source reports
 * (today and this week) and its three records — and the board's five model
 * rows. It holds that much room whether the payload has arrived or not, and
 * whether or not it filled every row; a payload carrying more rows grows it
 * rather than being cut. */
const reportedWindows = 2;
export const accountFactSlots = tomeClasses.length + reportedWindows + accountRecords.length;
export const accountModelSlots = maxDrawnModels;
/* Every seal's figures: a source's lifetime and latest day, the
 * contributions' pull requests and commits. The roll holds this many while
 * its payloads are in flight, so their landing moves nothing. */
export const chronicleFigureSlots = 2;

export const chronicleEmptyNote = 'no tracker data captured yet';
export const contributionsKey = 'contributions';
/* The figure a day reads as when nothing was measured on it. */
export const noReading = '—';
/* The span the graph and the calendar cover (owner, 2026-10-16: "make the
 * graph represent the entire heatmap not just a subsection"), as the figures'
 * captions name it. */
export const windowName = 'past year';
/* The ink the contributions layer is drawn in: the calendar's own green. */
export const gridTone = 'grid';

function flatten(columns: readonly (readonly GridCell[])[]): GridCell[] {
  return columns.flat();
}

/* One set's days as a series, parallel to the window's days. A set with no
 * columns (its panel did not answer) is a series of nulls the same length, so
 * every series always lines up with every other one. */
function seriesOf(set: CalendarSet, length: number, label: string = set.label): ChronicleSeries {
  const cells = flatten(set.columns);
  const values: (number | null)[] = [];
  for (let index = 0; index < length; index += 1) {
    const cell = cells[index];
    values.push(cell === undefined || cell.absent ? null : cell.value);
  }
  return {
    key: set.key,
    label,
    values,
    figures: values.map((value) => (value === null ? noReading : set.format(value)))
  };
}

/* A layer: its series, the ink it is drawn in, each day in words, and the
 * figures it reads beside the graph. */
function layerOf(
  set: CalendarSet,
  series: ChronicleSeries,
  tone: string,
  headlines: readonly ChronicleHeadline[]
): ChronicleLayer {
  return {
    key: set.key,
    label: series.label,
    tone,
    series,
    readings: series.values.map((value, index) =>
      value === null ? noReading : `${series.figures[index]} ${value === 1 ? set.noun : `${set.noun}s`}`
    ),
    headlines
  };
}

/* A source's two figures: its tokens over its whole life, read day by day as
 * the reader scrubs, and its latest measured day, named. */
function tokenHeadlines(
  series: ChronicleSeries,
  overall: string,
  days: readonly ChronicleDay[],
  last: number
): ChronicleHeadline[] {
  let latest = -1;
  for (let index = Math.min(last, series.values.length - 1); index >= 0; index -= 1) {
    if (series.values[index] !== null) {
      latest = index;
      break;
    }
  }
  return [
    { key: 'overall', label: `${series.label} ${tokensWord}`, figure: overall, caption: overallCaption, daily: series },
    {
      key: 'latest',
      label: latestLabel,
      figure: latest < 0 ? noReading : series.figures[latest],
      caption: latest < 0 ? noReading : days[latest].label
    }
  ];
}

/* The window's last day: today, or the last day it covers. */
function lastDayOf(days: readonly ChronicleDay[]): number {
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (!days[index].absent) {
      return index;
    }
  }
  return -1;
}

function cardByKey(cards: readonly LedgerCard[], key: string): LedgerCard | undefined {
  return cards.find((card) => card.key === key);
}

/* The source a token set stands for: its key IS the source's label. */
function sourceLabelOf(set: CalendarSet): string {
  return set.key;
}

export function chronicleProps(
  envelopes: readonly (PanelEnvelope | null)[],
  now: Date = new Date()
): ChronicleProps | null {
  const [activityEnvelope = null, usageEnvelope = null, projectsEnvelope = null] = envelopes;
  /* Nothing has answered yet: render nothing rather than an empty frame, so
     the block waits for its first delivery the way every panel block does. */
  if (activityEnvelope === null && usageEnvelope === null && projectsEnvelope === null) {
    return null;
  }
  const calendar = contributionCalendarProps([activityEnvelope, usageEnvelope], now);
  const board = tokenBoardProps(usageEnvelope);
  const cards = board?.cards ?? [];

  /* The window: every set shares one anchor and one week count, so the first
     set with columns gives the DATES for all of them. Which of those days the
     window covers is NOT that set's to say: a day is outside the window only
     when it is padding or still in the future. A source that stopped
     reporting leaves its later days unmeasured — drawn hollow — instead of
     taking them out of the window, which is how a stale feed used to read as
     a calendar that simply ended early (owner, 2026-10-16: "github heatmap is
     not updating properly, and not catching it means a fault in testing
     procedures"). The last day is today, or a later day a payload already
     measured, which is the calendar's own anchor rule. */
  const reference = calendar.sets.find((set) => set.columns.length > 0);
  const cells = reference === undefined ? [] : flatten(reference.columns);
  const today = now.toISOString().slice(0, 10);
  let anchor = today;
  for (const set of calendar.sets) {
    for (const cell of flatten(set.columns)) {
      if (!cell.absent && cell.date > anchor) {
        anchor = cell.date;
      }
    }
  }
  const days: ChronicleDay[] = cells.map((cell) => ({
    date: cell.date,
    label: formatCalendarDate(cell.date, true) ?? '',
    absent: cell.date === '' || cell.date > anchor
  }));
  const length = days.length;

  const tokenSets = calendar.sets.filter((set) => set.key !== contributionsKey && set.columns.length > 0);
  const contributionSet = calendar.sets.find((set) => set.key === contributionsKey);

  const lines = tokenSets.map((set) => {
    const card = cardByKey(cards, `source-${sourceLabelOf(set)}`);
    return seriesOf(set, length, card?.label ?? set.label);
  });

  const last = lastDayOf(days);
  const sources = usageEnvelope === null ? [] : tokenUsageSources(usageEnvelope.data);
  /* A source's lifetime, worded as its account in the tome words it. */
  const lifetimeOf = (label: string): string => {
    const lifetime = sources
      .find((candidate) => candidate.label === label)
      ?.stats?.find((candidate) => candidate.key === 'lifetime');
    return lifetime === undefined || lifetime.value === null ? noReading : formatStatValue(lifetime.value, lifetime.unit);
  };

  /* PULL REQUESTS CLOSED: every repository the projects panel lists, summed.
     The panel carries no per-day record of them, so the figure stays whole
     while the reader scrubs, and a payload that reports none prints the dash. */
  const projects =
    projectsEnvelope?.kind === panelKinds.codingProjects ? parseCodingProjects(projectsEnvelope.data) : null;
  const closed = (projects?.repos ?? [])
    .map((repo) => repo.closedPulls)
    .filter((count): count is number => typeof count === 'number');
  const pulls: ChronicleHeadline = {
    key: 'pulls',
    label: pullsLabel,
    figure: closed.length === 0 ? noReading : formatWhole(closed.reduce((sum, count) => sum + count, 0)),
    caption: 'all time'
  };

  /* COMMITS PUSHED: the activity panel's own daily commit counts, laid on the
     window by date; the figure is the window's total. A payload that predates
     them prints the dash. */
  const activity =
    activityEnvelope?.kind === panelKinds.vcsActivity ? parseVCSActivity(activityEnvelope.data) : null;
  let commits: ChronicleSeries | undefined;
  if (activity?.commitWeeks !== undefined) {
    const byDate = new Map(
      activityCells({ ...activity, weeks: activity.commitWeeks })
        .filter((cell) => cell.date !== '' && cell.absent !== true)
        .map((cell) => [cell.date, cell.value])
    );
    const values = days.map((day) => byDate.get(day.date) ?? null);
    commits = { key: 'commits', label: commitsLabel, values, figures: values.map((value) => (value === null ? noReading : formatWhole(value))) };
  }
  const pushed: ChronicleHeadline = {
    key: 'commits',
    label: commitsLabel,
    figure: activity?.totalCommits === undefined ? noReading : formatWhole(activity.totalCommits),
    caption: windowName,
    daily: commits
  };

  /* THE FIGURES FOLLOW THE PICKED SEAL, and the tokens open the roll (owner,
     2026-10-21: "put Codex tokens the first thing that renders on the website,
     the order should be codex, then claude then contributions"; asked what
     the figures should read, the owner picked "follow the picked seal"). A
     source's seal reads that source's tokens over its whole life, followed
     day by day as the reader scrubs, and its latest measured day; the
     contributions' seal reads what the contributions are made of. Every seal
     carries the same number of figures (chronicleFigureSlots), so a change
     of seal moves nothing. The token seals keep the calendar's order, which
     is the vocabulary's (commits.ts). */
  const layers: ChronicleLayer[] = tokenSets.map((set, index) =>
    layerOf(set, lines[index], String(index), tokenHeadlines(lines[index], lifetimeOf(sourceLabelOf(set)), days, last))
  );
  if (contributionSet !== undefined && contributionSet.columns.length > 0) {
    layers.push(layerOf(contributionSet, seriesOf(contributionSet, length), gridTone, [pulls, pushed]));
  }

  /* Every source that reported keeps its account — the ones with a daily
     line in the calendar's order, then any that sent figures but no line,
     which the diagram has nothing to plot for but the account still reads. */
  /* While the usage payload is still in flight, each source the vocabulary
     names holds its account's room, empty: it is coming, so its box is
     reserved rather than grown into when it lands. */
  const pendingAccounts: ChronicleAccount[] =
    usageEnvelope === null ? knownSourceKeys.map((key) => ({ key, label: '', total: '', facts: [], lines: [], models: [] })) : [];
  const accountLabels = tokenSets.map(sourceLabelOf);
  for (const source of sources) {
    if (!accountLabels.includes(source.label)) {
      accountLabels.push(source.label);
    }
  }
  const accounts: ChronicleAccount[] = accountLabels
    .map((label): ChronicleAccount => {
      const card = cardByKey(cards, `source-${label}`);
      const models = cardByKey(cards, `models-${label}`);
      const source = sources.find((candidate) => candidate.label === label);
      const records: LedgerFact[] = [];
      const statValue = (key: string): number | undefined => {
        const stat = source?.stats?.find((candidate) => candidate.key === key);
        return stat === undefined || stat.value === null ? undefined : stat.value;
      };
      for (const record of accountRecords) {
        const stat = source?.stats?.find((candidate) => candidate.key === record.key);
        const current = stat === undefined || stat.value === null ? undefined : formatStatValue(stat.value, stat.unit);
        if (record.term !== streakTerm) {
          if (current !== undefined) {
            records.push({ key: `${label}-${record.key}`, term: record.term, value: current });
          }
          continue;
        }
        const longest = statValue('longest-streak');
        const value =
          current === undefined
            ? longest === undefined
              ? undefined
              : `longest ${formatWhole(longest)}`
            : longest === undefined
              ? current
              : `${current}, longest ${formatWhole(longest)}`;
        if (value !== undefined) {
          records.push({ key: `${label}-${record.key}`, term: record.term, value });
        }
      }
      const accounting = (card?.facts ?? []).filter((fact) => tomeClasses.includes(fact.key) || fact.key.startsWith('window-'));
      return {
        key: label,
        label: card?.label ?? sourceName(label),
        total: lifetimeOf(label),
        facts: [...accounting, ...records],
        lines: card?.sub ?? [],
        models: models?.models ?? []
      };
    })
    .filter((account) => account.facts.length + account.lines.length + account.models.length > 0)
    .concat(pendingAccounts);

  const months = reference === undefined ? [] : monthTicks(reference.columns).map((tick) => ({ column: tick.column, label: tick.abbrev }));

  return {
    status: activityEnvelope?.status ?? usageEnvelope?.status ?? 'unavailable',
    generatedAt: activityEnvelope?.generatedAt ?? usageEnvelope?.generatedAt,
    days,
    /* The calendar's weeks; while either calendar panel is still in flight,
       the year it will fill, so the graph and the calendar hold their boxes
       and draw no day they were not given. A panel that answered with nothing
       holds nothing (owner ruling, 2026-08-24: a reserve is a promise that
       something is coming). */
    weeks: reference?.columns.length ?? (activityEnvelope === null || usageEnvelope === null ? pendingWeeks : 0),
    layers,
    accounts,
    months,
    factSlots: accountFactSlots,
    modelSlots: accountModelSlots,
    figureSlots: chronicleFigureSlots,
    lastDay: last,
    emptyNote: chronicleEmptyNote,
    ariaLabel: 'Trackers over the past year'
  };
}
