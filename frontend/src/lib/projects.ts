/* The Projects section's information module (owner directive, issue 134; live
 * since issue 242): the owner's public repositories, most recently pushed
 * first.
 *
 * THE ROSTER IS THE PANEL'S (issue 281). The owner's ruling reversed the
 * curated-seven reading of 2026-08-29: a new public repository must appear
 * on the site without a release, so the origin enumerates the account's own
 * public listing and this module renders whatever roster the payload
 * carries. Curation lives server-side as an explicit exclusion list in
 * `internal/panels/config/fetch.json` — data, never a whitelist that goes
 * stale. What this module still fixes is the LINK SHAPE: every entry's href
 * is the one `projectHost` constant plus a name admitted through the
 * repository-name grammar below, so a payload can decide which of the
 * owner's repositories show and can never point a link at another host or
 * an unparseable path. The rows captured below remain as the no-payload
 * fallback and as the source of the one figure no listing reports — the
 * captured commit totals.
 *
 * IT IS NO LONGER A CAPTURE. It was one, deliberately: `PANELS_REFRESH` was
 * default-off, so a live count would have been a promise the deployment could
 * not keep. That premise expired on 2026-08-27, when the owner enabled refresh
 * together with its egress allowance, and the gap showed up immediately — the
 * owner changed a repository description on the host and the site did not
 * follow. The origin now reads the repository metadata itself, on the panels
 * refresh cadence, and serves it as the coding-projects/v1 panel; this module
 * adapts that panel and keeps the rows below as its FALLBACK.
 *
 * The page still makes no outbound request of its own. Requirement 1 keeps the
 * frontend local-origin-only: the panel is read from this origin's own
 * /api/panels path like every other panel, the host URLs here remain link
 * TARGETS a human may click, and no code in this module requests `projectHost`.
 * What changed is which side of the origin does the reading, not whether the
 * browser leaves it.
 *
 * Two figures stay recorded, and both say so on the page:
 *
 *   - Commit totals. The repository API reports no total, and deriving one
 *     would mean paginating a whole default branch on every refresh. The
 *     captured count stays captured and carries the provenance mark.
 *   - Every figure of a row whose live read failed. That row falls back to the
 *     values below and marks all of them, rather than borrowing the freshness
 *     of the rows beside it.
 *
 * Vendor names are data. The host label lives in this module beside the rows
 * it describes, exactly as the panels keep theirs in config data, so the
 * components stay neutral and a move to another host is a data edit.
 *
 * One fallback description is shipped shortened, and deliberately: the
 * repository's own text names the deployment's edge provider, and owner
 * requirement R9 (the deployment-provider contract in AGENTS.md, enforced by
 * internal/doctrine/provider_neutrality_test.go over this whole tree) admits a
 * provider name nowhere but the chart's values defaults. Splitting the word up
 * to slip past that scan would defeat a fail-closed pin rather than respect
 * it, so the clause is dropped and the omission is stated here. The LIVE row
 * carries whatever the host currently says, which is the owner's own text on
 * the owner's own origin and not this repository's tree at all. */

import { ageDetail, relativeAge } from './age.ts';
import {
  recordedOutOfBand,
  type EntryCount,
  type LedgerCount,
  type LedgerTableProps,
  type LedgerTableRow
} from './blocks.ts';
import { formatWhole } from './grid.ts';
import { panelAge, panelKinds } from './panels.ts';
import type { CodingProjectRow, CodingProjectsData, PanelEnvelope } from './panels';
import type { TipDetail } from './tooltip.ts';

export interface Project {
  /* The repository name — the visible title, the stable key, and the last
   * path segment of its URL. */
  readonly name: string;
  /* The repository's own description, verbatim (see the R9 note above). */
  readonly description: string;
  /* Commits on the default branch at the capture date. */
  readonly commits: number;
  /* Stars at the capture date. */
  readonly stars: number;
  /* The repository's last push, as the ISO instant GitHub reported at the
   * capture date (owner directive, 0.1.52: an icon showing how long since
   * the last update). An INSTANT rather than a pre-written "3 days ago",
   * because the words drift the moment they are captured: the page turns
   * this into a sentence against the reader's own clock, so the label stays
   * as true as the capture itself, and goes stale only the way the counts
   * beside it already do. */
  readonly pushedAt: string;
}

/* The host label the section shows and the accessible names carry. */
export const projectHostLabel = 'GitHub';

/* The owner's account, and the only remote origin this repository's frontend
 * source spells. Every project URL is this plus the repository name, so the
 * host is written once and a row cannot point somewhere else by typo. The
 * recent-commits feed's outbound links (lib/activity.ts, issue 157) import
 * this constant rather than writing a second one, which is what keeps the
 * claim in this comment true as a second consumer arrives. */
export const projectHost = 'https://github.com/snaraj';

/* The registry identifier the projects feed loads; the one place the id is
 * spelled on the frontend. */
export const codingProjectsPanelId = 'coding-projects';

/* The ISO date these counts were read on. A maintenance record ONLY (issue
 * 167) — no longer rendered by the section, since the capture date is a
 * maintainer/reviewer fact rather than visitor information. Provenance
 * stays truthful without display: this constant exists so the date is
 * recorded somewhere durable, and the no-fetch guarantee it used to
 * accompany on the page is enforced structurally, not by announcing it. */
export const projectsCapturedOn = '2026-08-29';

/* The CAPTURED rows: the owner's public repositories as read on the capture
 * date above. Since issue 281 this list no longer fixes the roster — the
 * panel's payload does, and a repository created after this capture renders
 * from the payload alone. What these rows still are: the complete fallback
 * face when no payload has arrived or none was admitted (a true thing to
 * show, dated and marked), and the only source of each repository's captured
 * commit total, which no listing endpoint reports. The order is a
 * MAINTENANCE order; the feed sorts by last push (issue 252). */
export const projects: readonly Project[] = [
  {
    name: 'naranjo.online',
    description: 'Personal Website & Media Gallery',
    commits: 127,
    stars: 1,
    pushedAt: '2026-08-29T07:02:14Z'
  },
  {
    name: 'website-infrastructure',
    description:
      'My infrastructure for self-hosting scalable and secure applications using Kubernetes',
    commits: 105,
    stars: 1,
    pushedAt: '2026-08-29T08:12:06Z'
  },
  {
    name: 'lidersea.com',
    description: 'The home of lidersea.com',
    commits: 92,
    stars: 1,
    pushedAt: '2026-08-29T07:01:55Z'
  },
  {
    name: 'dotfiles',
    description: 'My dotfiles',
    commits: 9,
    stars: 0,
    pushedAt: '2026-08-29T10:13:44Z'
  },
  {
    name: 'foobar2000-lyricsbuddy',
    description:
      'LyricsBuddy is a native x64 lyrics panel for foobar2000. It combines a Spotify-inspired reading experience with local-first lyric discovery, precise LRC synchronization, safe customization, and an extensible provider model.',
    commits: 1,
    stars: 2,
    pushedAt: '2026-08-07T00:19:49Z'
  },
  {
    name: 'foobar2000-library-visualizer',
    description:
      'Library Visualizer is a highly customizable Foobar2000 Component that renders and displays selected music library.',
    commits: 20,
    stars: 2,
    pushedAt: '2026-08-07T00:16:32Z'
  },
  {
    name: 'foobar2000-album-visualizer',
    description:
      'Album Visualizer is a highly customizable foobar2000 component that displays the complete track list for either the album currently playing or the album selected in a playlist or Media Library view.',
    commits: 1,
    stars: 2,
    pushedAt: '2026-08-02T05:49:53Z'
  }
];

/* The repository's address: the ONE host constant plus a name. Every name
 * that reaches this function has passed the repository-name grammar — the
 * captured rows by review, a payload row by parseCodingProjects — so the
 * link can only ever point inside the owner's own account. */
export function projectUrl(project: Pick<Project, 'name'>): string {
  return `${projectHost}/${project.name}`;
}

/* The accessible name one project link carries. It names the destination and
 * says the link leaves the page, because a link that opens a new tab without
 * warning is a surprise for anyone who cannot see it happen. */
export function projectLinkLabel(project: Pick<Project, 'name'>): string {
  return `${project.name} on ${projectHostLabel}, opens in a new tab`;
}

/* The rendering for a figure this card has no number for. It is deliberately
 * not a zero: "nothing open" and "not reported" are different claims and only
 * one of them is supported. */
const unknownFigure = '—';

/* The detail one counter carries: the full phrase as its name, and the
 * provenance row when the figure was recorded out of band.
 *
 * The grammar is bossLog.ts's `summaryDetail`, deliberately — a tile shows the
 * short form and the detail's NAME is the long one — so the two grids and this
 * feed present one idea one way rather than three. A DASH gets no provenance
 * row: there is no figure there to have been recorded, and marking an absence
 * would claim a capture nobody made. */
function countDetail(label: string, value: string, marked: boolean): TipDetail {
  return {
    name: label,
    rows: marked && value !== unknownFigure ? [{ label: '', value: recordedOutOfBand }] : []
  };
}

/* projectCounts renders one row's five figures against whatever the panel
 * could actually vouch for.
 *
 * `live` is the panel's row when one arrived and was admitted; absent means
 * this row is serving its captured values, and every figure on it is then
 * marked. The commit count is marked either way — no repository API reports a
 * total, so it is captured no matter how fresh the row beside it is.
 *
 * EVERY FIGURE IS NOW TERSE (issue 268, owner directive): the visible channel
 * is the glyph and the bare number, and the WORD it counts moves into the
 * counter's clipped accessible name and into its detail. The dataviz floor is
 * unchanged — a value is carried by glyph plus number, never by the glyph
 * alone — and the plural is still derived rather than assumed, because "1
 * commits" is the kind of small lie a page tells when nobody executes its
 * labels and two of the seven rows genuinely are one commit today. The
 * derivation is executed by test against synthetic rows rather than resting on
 * whichever figures the tracked repositories carry this week.
 *
 * A star tally the host did not report renders as an explicit unknown, never
 * as a zero: those are different claims, and only one of them is true. */
export function projectCounts(
  project: Project | undefined,
  live?: CodingProjectRow,
  now: number = Date.now()
): EntryCount[] {
  const recorded = live === undefined || live.recorded === true;
  const stars = recorded ? (project?.stars ?? null) : live.stars;
  const pushedAt = effectivePushedAt(project, live);
  const starLabel =
    stars === null ? 'stars unknown' : `${formatWhole(stars)} ${stars === 1 ? 'star' : 'stars'}`;
  const starFigure = stars === null ? unknownFigure : formatWhole(stars);
  /* Cluster order per the owner's sketch (2026-08-31, issue 275): stars and
   * freshness on the first row, the captured commit total and open issues on
   * the second, open pulls on the last — the live figures lead and the one
   * always-captured figure no longer fronts the card. */
  return [
    {
      key: 'stars',
      glyph: 'star',
      label: starLabel,
      value: starFigure,
      marked: recorded,
      detail: countDetail(starLabel, starFigure, recorded)
    },
    updatedCount(pushedAt, recorded, now),
    commitCount(project),
    /* The two open-work counters (owner directive, issue 252 — the first two
     * counters to go terse, and since issue 268 the shape every counter has).
     *
     * Both come from the panel or from nowhere. There is no captured fallback
     * for them and there should not be: these are the fastest-moving figures
     * on the card — an issue closes and the number is wrong — so a frozen one
     * would be the least true thing in the section. Nothing to report renders
     * as a dash, which says "not known"; a reported zero renders as 0, which
     * says "nothing open". Those are different claims and the card makes only
     * the one it can support. */
    openWorkCount('issues', 'issue', live?.openIssues, recorded),
    openWorkCount('pulls', 'pull', live?.openPulls, recorded)
  ];
}

/* How long since the last update (owner directive, 0.1.52; live since issue
 * 268), computed from the instant against the reader's own clock rather than
 * shipped as frozen words. `since` is what tells the log to keep recomputing
 * it: the value and label here are the FIRST rendering, and the component
 * re-derives both on every minute-aligned tick, so a card open on a desk
 * stays true. An instant nobody reported — representable since a payload row
 * may omit pushedAt and a dynamic row has no captured fallback — renders as
 * the honest dash, never as an age of nothing. */
function updatedCount(pushedAt: string | undefined, recorded: boolean, now: number): EntryCount {
  if (pushedAt === undefined) {
    const label = 'last update not reported';
    return {
      key: 'updated',
      glyph: 'clock',
      label,
      value: unknownFigure,
      detail: countDetail(label, unknownFigure, false)
    };
  }
  const age = relativeAge(pushedAt, now);
  return {
    key: 'updated',
    glyph: 'clock',
    label: age.phrase,
    value: age.compact,
    since: pushedAt,
    marked: recorded,
    detail: ageDetail(pushedAt, now, recorded)
  };
}

/* The captured commit total — always marked, since no listing reports one —
 * or the honest dash for a repository the module list has no capture for,
 * which is every repository discovered after the capture date (issue 281).
 * The dash carries no provenance row: there is no figure there to have been
 * recorded. */
function commitCount(project: Project | undefined): EntryCount {
  if (project === undefined) {
    const label = 'commit total not recorded';
    return {
      key: 'commits',
      glyph: 'node',
      label,
      value: unknownFigure,
      detail: countDetail(label, unknownFigure, false)
    };
  }
  const figure = formatWhole(project.commits);
  const label = `${figure} ${project.commits === 1 ? 'commit' : 'commits'}`;
  return {
    key: 'commits',
    glyph: 'node',
    label,
    value: figure,
    /* Always: the count is captured however fresh the row beside it is. */
    marked: true,
    detail: countDetail(label, figure, true)
  };
}

/* One open-work counter: the terse glyph-and-figure pair, or a dash when the
 * panel reported no figure. The accessible sentence is always complete and
 * always plural-correct, because "1 open issues" is the kind of small lie a
 * page tells when nobody reads its labels out loud. */
function openWorkCount(
  key: string,
  glyph: 'issue' | 'pull',
  tally: number | undefined,
  recorded: boolean
): EntryCount {
  const noun = glyph === 'issue' ? 'issue' : 'pull request';
  if (tally === undefined) {
    const label = `open ${noun}s not reported`;
    return {
      key,
      glyph,
      label,
      value: unknownFigure,
      detail: countDetail(label, unknownFigure, false)
    };
  }
  const figure = formatWhole(tally);
  const label = `${figure} open ${tally === 1 ? noun : `${noun}s`}`;
  return {
    key,
    glyph,
    label,
    value: figure,
    marked: recorded,
    detail: countDetail(label, figure, recorded)
  };
}

/* The instant a row is ORDERED and dated by: the panel's when it vouched for
 * one, the captured one otherwise. It is the one place that choice is made, so
 * the sentence a card shows ("updated 3 days ago") and the position it holds
 * in the feed can never disagree about which push they mean. Undefined when
 * neither side reports one, which the counter renders as a dash and the sort
 * places last. */
function effectivePushedAt(
  project: Project | undefined,
  live?: CodingProjectRow
): string | undefined {
  if (live !== undefined && live.recorded !== true) {
    return live.pushedAt ?? project?.pushedAt;
  }
  return project?.pushedAt ?? live?.pushedAt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* An open-work tally is absent or a non-negative whole number. Absent is the
 * only "unknown" this field has: the producer omits the key rather than
 * writing null, which is what makes the pair additive, so an explicit null is
 * drift and refused with everything else. */
function isOptionalTally(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
  );
}

/* The repository-name grammar, the frontend's half of the identity gate the
 * origin's mapRepositoryListing applies (issue 281): letters, digits, dots,
 * underscores and dashes, bounded, and never a filesystem dot name. Since the
 * roster is the payload's, this is what makes a payload name safe to build
 * an owner-account href from — the host is the one constant, and a name this
 * grammar admits cannot escape its path segment or read as anything but a
 * repository. */
const repositoryNamePattern = /^[A-Za-z0-9._-]{1,100}$/;

function isRepositoryName(name: string): boolean {
  return name !== '.' && name !== '..' && repositoryNamePattern.test(name);
}

/* parseCodingProjects admits only payloads carrying the exact shape the feed
 * renders: a repos array of rows with a grammatical repository name, a string
 * description, a null-or-non-negative-integer star tally, an optional ISO
 * push instant, and an optional boolean provenance flag. Anything else
 * returns null and the feed falls back to its captured rows — a data fault
 * degrades one section's freshness, never the page.
 *
 * The refusal is WHOLESALE rather than per row, and that is the fail-closed
 * direction here: a payload that half-parses is drift, and a half-parsed
 * repository list looks exactly like an owner who deleted a project. */
export function parseCodingProjects(document: unknown): CodingProjectsData | null {
  if (!isRecord(document) || !Array.isArray(document.repos)) {
    return null;
  }
  const repos: CodingProjectRow[] = [];
  for (const entry of document.repos) {
    if (!isRecord(entry)) {
      return null;
    }
    const { name, description, stars, pushedAt, openIssues, openPulls, recorded } = entry;
    if (typeof name !== 'string' || !isRepositoryName(name) || typeof description !== 'string') {
      return null;
    }
    if (
      stars !== null &&
      !(typeof stars === 'number' && Number.isSafeInteger(stars) && stars >= 0)
    ) {
      return null;
    }
    if (pushedAt !== undefined && typeof pushedAt !== 'string') {
      return null;
    }
    if (!isOptionalTally(openIssues) || !isOptionalTally(openPulls)) {
      return null;
    }
    if (recorded !== undefined && typeof recorded !== 'boolean') {
      return null;
    }
    const row: CodingProjectRow = { name, description, stars };
    if (typeof pushedAt === 'string') {
      row.pushedAt = pushedAt;
    }
    if (typeof openIssues === 'number') {
      row.openIssues = openIssues;
    }
    if (typeof openPulls === 'number') {
      row.openPulls = openPulls;
    }
    if (recorded === true) {
      row.recorded = true;
    }
    repos.push(row);
  }
  return { repos };
}

/* One feed row's two sides: the captured record, the live one, or both. */
type ProjectView = readonly [Project | undefined, CodingProjectRow | undefined];

/* The instant one view is ordered by; an unreported instant sorts last, the
 * honest place for a row nobody can date. */
function viewInstant([project, live]: ProjectView): number {
  const instant = effectivePushedAt(project, live);
  const parsed = instant === undefined ? Number.NaN : Date.parse(instant);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/* projectsStaleAfterMs is how far behind the wall clock the envelope's own
 * generatedAt may fall before the card must SAY its data has stopped
 * advancing, even while the status still reads ok — the wedged-loop state a
 * status alone cannot see, the same #267 gap the usage panel's threshold
 * closes. The origin refreshes this panel on a quarter-hour cadence and its
 * rate-limit cooldown tops out at fifteen minutes, so two hours is eight
 * silent ticks past every legitimate quiet spell: a stall, not a nap. */
export const projectsStaleAfterMs = 2 * 60 * 60 * 1000;

/* projectsStaleNote is the honest staleness line (issue 281, defect 2: the
 * envelope said stale while the card LOOKED fresh). It renders in three
 * proven states and invents nothing: the origin says stale — the retained
 * figures are real and the note dates them by the envelope's own generatedAt;
 * the origin says unavailable — the captured fallback renders and the note
 * says which face the reader is seeing; or the origin says ok but its
 * generatedAt has fallen past projectsStaleAfterMs. A fresh ok panel, and the
 * pre-envelope captured face, carry no note. */
export function projectsStaleNote(
  envelope: PanelEnvelope | null,
  now: number = Date.now()
): string | undefined {
  if (envelope === null) {
    return undefined;
  }
  if (envelope.status === 'unavailable') {
    return 'live repository data unavailable · showing captured figures';
  }
  const at = envelope.generatedAt === undefined ? Number.NaN : Date.parse(envelope.generatedAt);
  const aged = !Number.isNaN(at) && now - at > projectsStaleAfterMs;
  if (envelope.status !== 'stale' && !aged) {
    return undefined;
  }
  const age = panelAge(envelope.generatedAt, new Date(now));
  return age === '' ? 'stale · the last successful read is not current' : `stale · data as of ${age}`;
}


/* ---------------------------------------------------------------------------
 * The ledger table (owner directive, 2026-09-03, issue 287)
 *
 * The section became a ruled table of the four most recently pushed
 * repositories rather than a feed of cards, and the head says so: "latest 4 of
 * <total> · by last push", where the total is the roster the payload actually
 * served — not a constant, and not the length of the captured list, because
 * the number a reader is told the four were chosen FROM has to be the number
 * that was really there.
 *
 * Everything the cards proved stays proved. The roster is still the payload's,
 * the order is still derived from each row's effective instant, the captured
 * face is still what renders when no payload arrived, the staleness line is
 * still the same three honest states, and every href is still the fixed host
 * constant plus a name that passed the repository grammar. What changed is the
 * SHAPE the same facts are handed to a component in.
 * ------------------------------------------------------------------------ */

/* The shell heading before any envelope arrives, or when one arrives with an
 * empty title; otherwise the ORIGIN's own title rides the envelope, exactly as
 * every other panel's does. */
export const projectsFallbackTitle = 'Coding projects';

/* The table's column heads, in column order. They are the page's words for
 * what each column holds, and they are here rather than in the component for
 * the reason every label on this page is: a component that named a column
 * would be a component that knows what it is showing. */
export const projectTableHeads: readonly string[] = [
  'Repository',
  'Description',
  'Stars',
  'Open',
  'PRs',
  'Pushed'
];

/* How many rows the table shows. The owner asked for the four most recent
 * (2026-09-03); the rest of the roster is still counted in the caption, so the
 * page says what it is showing a selection OF rather than quietly showing a
 * selection. */
export const shownProjectRows = 4;

export const projectsEmptyNote = 'no repositories reported';

/* The row's own dash, for a repository whose description the host does not
 * carry: an empty cell reads as a rendering fault, and this reads as what it
 * is. */
const noDescription = '—';

/* The three counters the table draws, out of the five the card drew. The two
 * that do not appear are not lost, they moved: the age has a column of its
 * own, and the captured commit total left with the card that had room for it
 * (owner directive, 2026-09-03 — the table's columns are the owner's list, and
 * the commit total is not on it). Each keeps the glyph, the bare figure and
 * the clipped words the terse-counter rule (issue 268) gave it. */
function tableCount(count: EntryCount, glyph: LedgerCount['glyph']): LedgerCount {
  const row: LedgerCount = {
    key: count.key,
    glyph,
    value: count.value,
    label: count.label,
    detail: count.detail
  };
  return count.marked === undefined ? row : { ...row, marked: count.marked };
}

function tableCounts(counts: readonly EntryCount[]): LedgerCount[] {
  const glyphs: readonly LedgerCount['glyph'][] = ['star', 'issue', 'pull'];
  const rows: LedgerCount[] = [];
  for (const glyph of glyphs) {
    const found = counts.find((count) => count.glyph === glyph);
    if (found !== undefined) {
      rows.push(tableCount(found, glyph));
    }
  }
  return rows;
}

/* The age column, taken from the same counter the card rendered — one
 * derivation, two presentations, so the figure, its words, its provenance and
 * the absolute instant behind it all stay the ones projectCounts built. An
 * instant nobody reported keeps the honest dash it already had.
 *
 * The one thing that did NOT come across is the live minute tick the card's
 * counter carried (`since`, issue 268): the card was a long-lived surface a
 * reader could leave open with a frozen "3h" on it, and the table is redrawn
 * from a fresh envelope on the panels' own 60-second cadence — the same
 * minute the tick was re-deriving against — so the age advances by the
 * delivery rather than by a second clock inside the component. */
function tableUpdated(counts: readonly EntryCount[]): LedgerCount {
  const found = counts.find((count) => count.glyph === 'clock');
  return found === undefined
    ? {
        key: 'updated',
        glyph: 'clock',
        value: unknownFigure,
        label: 'last update not reported',
        detail: { name: 'last update not reported', rows: [] }
      }
    : tableCount(found, 'clock');
}

export function projectTableProps(envelope: PanelEnvelope | null, now?: number): LedgerTableProps {
  const payload =
    envelope !== null && envelope.kind === panelKinds.codingProjects
      ? parseCodingProjects(envelope.data)
      : null;
  const capturedByName = new Map(projects.map((project) => [project.name, project]));
  const views: readonly ProjectView[] =
    payload !== null && payload.repos.length > 0
      ? payload.repos.map((row) => [capturedByName.get(row.name), row] as const)
      : projects.map((project) => [project, undefined] as const);
  const ordered = views.toSorted((left, right) => viewInstant(right) - viewInstant(left));
  const rows: LedgerTableRow[] = ordered.slice(0, shownProjectRows).map(([project, live]) => {
    const name = project?.name ?? live?.name ?? '';
    const recorded = live === undefined || live.recorded === true;
    const counts = projectCounts(project, live, now);
    const description = recorded
      ? (project?.description ?? live?.description ?? '')
      : live.description;
    return {
      key: name,
      link: {
        text: name,
        href: projectUrl({ name }),
        label: projectLinkLabel({ name })
      },
      summary: description.length > 0 ? description : noDescription,
      updated: tableUpdated(counts),
      counts: tableCounts(counts)
    };
  });
  return {
    title: envelope?.title || projectsFallbackTitle,
    status: envelope?.status ?? 'unavailable',
    generatedAt: envelope?.generatedAt,
    heads: projectTableHeads,
    rows,
    caption: `latest ${rows.length} of ${ordered.length} · by last push`,
    emptyNote: projectsEmptyNote,
    staleNote: projectsStaleNote(envelope, now)
  };
}
