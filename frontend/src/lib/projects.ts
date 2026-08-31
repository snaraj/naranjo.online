/* The Projects section's information module (owner directive, issue 134; live
 * since issue 242): the seven repositories this section tracks, most recently
 * pushed first.
 *
 * SEVEN, and curated rather than derived: the roster is the owner's call, not
 * a query that sweeps an account. PR #255 read the owner's 2026-08-29 ruling
 * as dropping the foobar2000-* trio; the owner corrected that reading (issue
 * 256) — those three stay. Adding or removing a repository is an owner
 * decision expressed as a row below AND a source in
 * `internal/panels/config/fetch.json`, never a query that sweeps an account.
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
import { recordedOutOfBand, type EntryCount, type EntryLogProps } from './blocks.ts';
import { formatWhole } from './grid.ts';
import { panelKinds } from './panels.ts';
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

/* The owner's public repositories. The order here is a MAINTENANCE order — the
 * order these rows are written down in — and it is no longer the order the
 * section renders (issue 252). The feed sorts by last push, most recent first,
 * derived from the instants below and from the panel's when it has one, so a
 * repository the owner pushed to five minutes ago leads the section without an
 * edit to this file. What this list still fixes is WHICH repositories the
 * section may show and what each one's link, key and accessible name are; a
 * payload can reorder the rows and it can never introduce, rename or relink
 * one. */
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

/* The repository's address. */
export function projectUrl(project: Project): string {
  return `${projectHost}/${project.name}`;
}

/* The accessible name one project link carries. It names the destination and
 * says the link leaves the page, because a link that opens a new tab without
 * warning is a surprise for anyone who cannot see it happen. */
export function projectLinkLabel(project: Project): string {
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
  project: Project,
  live?: CodingProjectRow,
  now: number = Date.now()
): EntryCount[] {
  const recorded = live === undefined || live.recorded === true;
  const stars = recorded ? project.stars : live.stars;
  const pushedAt = effectivePushedAt(project, live);
  const commitFigure = formatWhole(project.commits);
  const commitLabel = `${commitFigure} ${project.commits === 1 ? 'commit' : 'commits'}`;
  const starLabel =
    stars === null ? 'stars unknown' : `${formatWhole(stars)} ${stars === 1 ? 'star' : 'stars'}`;
  const starFigure = stars === null ? unknownFigure : formatWhole(stars);
  const age = relativeAge(pushedAt, now);
  return [
    {
      key: 'commits',
      glyph: 'node',
      label: commitLabel,
      value: commitFigure,
      /* Always: the count is captured however fresh the row beside it is. */
      marked: true,
      detail: countDetail(commitLabel, commitFigure, true)
    },
    {
      key: 'stars',
      glyph: 'star',
      label: starLabel,
      value: starFigure,
      marked: recorded,
      detail: countDetail(starLabel, starFigure, recorded)
    },
    /* How long since the last update (owner directive, 0.1.52; live since
     * issue 268), computed from the instant against the reader's own clock
     * rather than shipped as frozen words — see pushedAt above. `since` is
     * what tells the log to keep recomputing it: the value and label here are
     * the FIRST rendering, and the component re-derives both on every
     * minute-aligned tick, so a card open on a desk stays true. */
    {
      key: 'updated',
      glyph: 'clock',
      label: age.phrase,
      value: age.compact,
      since: pushedAt,
      marked: recorded,
      detail: ageDetail(pushedAt, now, recorded)
    },
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
 * in the feed can never disagree about which push they mean. */
function effectivePushedAt(project: Project, live?: CodingProjectRow): string {
  if (live === undefined || live.recorded === true) {
    return project.pushedAt;
  }
  return live.pushedAt ?? project.pushedAt;
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

/* parseCodingProjects admits only payloads carrying the exact shape the feed
 * renders: a repos array of rows with a non-empty name, a string description,
 * a null-or-non-negative-integer star tally, an optional ISO push instant, and
 * an optional boolean provenance flag. Anything else returns null and the feed
 * falls back to its captured rows — a data fault degrades one section's
 * freshness, never the page.
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
    if (typeof name !== 'string' || name.length === 0 || typeof description !== 'string') {
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

/* projectEntry builds one feed entry from a captured row and, when the panel
 * had something to say about it, the live one. The captured row is what fixes
 * the entry's IDENTITY — its name, its URL, its accessible name — so a payload
 * can never introduce a repository the owner did not list, rename one, or
 * point a link somewhere else. Only the CONTENT is live. */
function projectEntry(project: Project, live: CodingProjectRow | undefined, now?: number) {
  const recorded = live === undefined || live.recorded === true;
  return {
    key: project.name,
    title: project.name,
    href: projectUrl(project),
    linkLabel: projectLinkLabel(project),
    glyph: 'code' as const,
    counts: projectCounts(project, live, now),
    /* A live row with an empty description means the repository has none,
       which is a true thing to render as nothing rather than a reason to fall
       back to a sentence the host no longer carries. */
    summary: recorded ? project.description : live.description
  };
}

/* The adapter (issue 165, live since issue 242): the coding-projects envelope
 * in, EntryLog props out.
 *
 * A null envelope, a wrong kind, or a payload that fails admission all render
 * the CAPTURED rows rather than nothing. That is deliberate and it is the
 * honest-states floor rather than an exception to it: the fallback is a true
 * thing to show — these figures were really read, on the date recorded above,
 * and the page says so with the provenance mark — not a placeholder pretending
 * to be data. It also means the section's first paint is already true, so
 * nothing is reserved for late content and the panel's arrival shifts no
 * layout.
 *
 * The ORDER is derived here rather than declared anywhere (issue 252): most
 * recently pushed first, against each row's effective instant, so the section
 * answers "what has the owner been working on" instead of "what order was this
 * file written in". Sorting at this layer rather than in the producer is what
 * lets it hold in all three states — a live payload, a payload whose rows fell
 * back to the shipped snapshot, and no payload at all — because this is the
 * only layer where the live and captured instants are both in hand.
 *
 * `toSorted` rather than `sort`: `projects` is a module-level constant that
 * every other consumer reads, and sorting it in place would reorder theirs
 * too, once, at whichever render happened first. */
export function codingProjectsProps(envelope: PanelEnvelope | null, now?: number): EntryLogProps {
  const payload =
    envelope !== null && envelope.kind === panelKinds.codingProjects
      ? parseCodingProjects(envelope.data)
      : null;
  const byName = new Map((payload?.repos ?? []).map((row) => [row.name, row]));
  const ordered = projects.toSorted(
    (left, right) =>
      Date.parse(effectivePushedAt(right, byName.get(right.name))) -
      Date.parse(effectivePushedAt(left, byName.get(left.name)))
  );
  return {
    variant: 'compact',
    titleLevel: 4,
    entries: ordered.map((project) => projectEntry(project, byName.get(project.name), now))
  };
}
