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
 * ONE figure stays recorded: every figure of a row whose live read failed.
 * That row falls back to the values below and marks all of them, rather than
 * borrowing the freshness of the rows beside it. The captured COMMIT TOTAL
 * that used to be the other one left with the column that drew it (owner
 * directive, 2026-09-11, issue #317): the table's four metrics are pull
 * requests closed, the released version, stars and the last push, and none of
 * them is a figure only a capture can report.
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
 * it, so the clause is dropped and the omission is stated here. The embedded
 * snapshot these rows mirror carries the same one-clause trim for the same
 * reason, and for the same one row. The LIVE row carries whatever the host
 * currently says, which is the owner's own text on the owner's own origin and
 * not this repository's tree at all. */

import { ageDetail, relativeAge } from './age.ts';
import {
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
export const projectsCapturedOn = '2026-09-11';

/* The CAPTURED rows: the owner's public repositories as read on the capture
 * date above. Since issue 281 this list no longer fixes the roster — the
 * panel's payload does, and a repository created after this capture renders
 * from the payload alone. What these rows still are: the complete fallback
 * face when no payload has arrived or none was admitted (a true thing to
 * show, dated), and the only source of each repository's captured
 * repository. The order is a MAINTENANCE order — alphabetical, deliberately
 * NOT the push order the feed sorts by, so a deleted sort fails a test rather
 * than passing by luck (tests/sections.test.mjs). */
export const projects: readonly Project[] = [
  {
    name: "dotfiles",
    description:
      "My dotfiles",
    stars: 0,
    pushedAt: "2026-09-11T15:27:59Z"
  },
  {
    name: "foobar2000-library-visualizer",
    description:
      "Library Visualizer is a highly customizable Foobar2000 Component that renders and displays selected music library.",
    stars: 2,
    pushedAt: "2026-08-07T00:16:32Z"
  },
  {
    name: "foobar2000-lyricsbuddy",
    description:
      "LyricsBuddy is a native x64 lyrics panel for foobar2000. It combines a Spotify-inspired reading experience with local-first lyric discovery, precise LRC synchronization, safe customization, and an extensible provider model.",
    stars: 2,
    pushedAt: "2026-08-07T00:19:49Z"
  },
  {
    name: "lidersea.com",
    description:
      "The home of lidersea.com",
    stars: 1,
    pushedAt: "2026-09-08T03:25:34Z"
  },
  {
    name: "naranjo.online",
    description:
      "Personal Website & Media Gallery",
    stars: 1,
    pushedAt: "2026-09-11T20:58:39Z"
  },
  {
    name: "obsync",
    description:
      "obsync: self-hosted, end-to-end encrypted live sync for Obsidian. One dependency-free Rust binary with a dashboard, plus an Obsidian plugin.",
    stars: 1,
    pushedAt: "2026-09-11T22:46:22Z"
  },
  {
    name: "platform",
    description:
      "My infrastructure for self-hosting scalable and secure applications using Kubernetes",
    stars: 1,
    pushedAt: "2026-09-11T19:19:57Z"
  },
  {
    name: "platform-k8s-infra",
    description:
      "Application GitOps composition for the homelab platform.",
    stars: 1,
    pushedAt: "2026-09-11T21:48:07Z"
  },
  {
    name: "SpotiPlus",
    description:
      "Retired historical showcase. No longer maintained or supported.",
    stars: 0,
    pushedAt: "2026-09-08T01:52:09Z"
  },
  {
    name: "theme",
    description:
      "Minimal, blazing fast CLI to manage the aesthethics of your terminal and desktop",
    stars: 1,
    pushedAt: "2026-09-11T22:22:14Z"
  },
  {
    name: "Tiger-Book",
    description:
      "Retired historical showcase. No longer maintained or supported.",
    stars: 0,
    pushedAt: "2026-09-08T01:52:17Z"
  },
  {
    name: "world",
    description:
      "Retired historical showcase. No longer maintained or supported.",
    stars: 0,
    pushedAt: "2026-09-08T01:51:36Z"
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

/* The detail one counter carries: the full phrase as its name. The grammar is
 * bossLog.ts's `summaryDetail`, deliberately — a tile shows the short form and
 * the detail's NAME is the long one — so the two grids and this feed present
 * one idea one way rather than three. */
function countDetail(label: string): TipDetail {
  return { name: label, rows: [] };
}

/* projectColumns renders one row's FOUR figures — the owner's columns, in the
 * owner's order (2026-09-11, issue #317): pull requests closed, the released
 * version, stars, and how long since the last push. Open issues and open pull
 * requests left the page with the same directive, and the origin stopped
 * reading them at all.
 *
 * `live` is the panel's row when one arrived and was admitted; absent means
 * this row is serving its captured values, and the page says nothing about
 * provenance on any counter (owner directive, 2026-09-06, issue 299).
 *
 * EVERY FIGURE IS TERSE (issue 268, owner directive): the visible channel is
 * the mark and the bare figure, and the WORD it counts lives in the counter's
 * clipped accessible name and in its detail. The dataviz floor is unchanged —
 * a value is carried by mark plus number, never by the mark alone — and the
 * plural is still derived rather than assumed, because "1 pull requests" is
 * the kind of small lie a page tells when nobody reads its labels out loud.
 *
 * A figure the host did not report renders as an explicit unknown, never as a
 * zero: those are different claims, and only one of them is true. */
export function projectColumns(
  project: Project | undefined,
  live?: CodingProjectRow,
  now: number = Date.now()
): { readonly counts: LedgerCount[]; readonly updated: LedgerCount } {
  const recorded = live === undefined || live.recorded === true;
  const stars = recorded ? (project?.stars ?? null) : live.stars;
  const starLabel =
    stars === null ? 'stars unknown' : `${formatWhole(stars)} ${stars === 1 ? 'star' : 'stars'}`;
  return {
    counts: [
      closedPullCount(live?.closedPulls),
      releaseCount(live?.release),
      {
        key: 'stars',
        glyph: 'star',
        label: starLabel,
        value: stars === null ? unknownFigure : formatWhole(stars),
        detail: countDetail(starLabel)
      }
    ],
    updated: updatedCount(effectivePushedAt(project, live), now)
  };
}

/* The closed pull-request column. There is no captured fallback for it and
 * there should not be: it is the figure the panel reads live or not at all, so
 * nothing to report renders as a dash — "not known" — while a reported zero
 * renders as 0, which says "none ever". Those are different claims and the
 * table makes only the one it can support. */
function closedPullCount(tally: number | undefined): LedgerCount {
  if (tally === undefined) {
    const label = 'closed pull requests not reported';
    return { key: 'pulls', glyph: 'pull', label, value: unknownFigure, detail: countDetail(label) };
  }
  const figure = formatWhole(tally);
  const label = `${figure} closed pull ${tally === 1 ? 'request' : 'requests'}`;
  return { key: 'pulls', glyph: 'pull', label, value: figure, detail: countDetail(label) };
}

/* The version column: the release tag exactly as the host names it. A
 * repository that has never released and a read that could not report one both
 * render the dash, because both are "no version to show" — and inventing one,
 * or printing a zero, would be the fabrication the honest-states floor
 * forbids. */
function releaseCount(release: string | undefined): LedgerCount {
  if (release === undefined || release === '') {
    const label = 'no released version';
    return { key: 'release', glyph: 'tag', label, value: unknownFigure, detail: countDetail(label) };
  }
  const label = `version ${release}`;
  return { key: 'release', glyph: 'tag', label, value: release, detail: countDetail(label) };
}

/* How long since the last update (owner directive, 0.1.52), computed from the
 * instant against the reader's own clock rather than shipped as frozen words.
 * The table is redrawn from a fresh envelope on the panels' own 60-second
 * cadence, so the age advances by the delivery rather than by a second clock
 * inside the component. An instant nobody reported renders as the honest dash,
 * never as an age of nothing. */
function updatedCount(pushedAt: string | undefined, now: number): LedgerCount {
  if (pushedAt === undefined) {
    const label = 'last update not reported';
    return {
      key: 'updated',
      glyph: 'clock',
      label,
      value: unknownFigure,
      detail: countDetail(label)
    };
  }
  const age = relativeAge(pushedAt, now);
  return {
    key: 'updated',
    glyph: 'clock',
    label: age.phrase,
    value: age.compact,
    detail: ageDetail(pushedAt, now)
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

/* A tally is absent or a non-negative whole number. Absent is the only
 * "unknown" this field has: the producer omits the key rather than writing
 * null, which is what makes it additive, so an explicit null is drift and
 * refused with everything else. */
function isOptionalTally(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
  );
}

/* The release-tag grammar, the frontend's half of the gate the origin's
 * isReleaseTag applies (issue #317). The cell prints the tag verbatim, so this
 * is what stops a payload printing a sentence, a path or a control character
 * where a version belongs — the same layering the repository name already
 * has. */
const releaseTagPattern = /^[A-Za-z0-9._-]{1,64}$/;

function isReleaseTag(tag: string): boolean {
  return tag !== '.' && tag !== '..' && releaseTagPattern.test(tag);
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
    const { name, description, stars, pushedAt, closedPulls, release, pinned, recorded } = entry;
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
    if (!isOptionalTally(closedPulls)) {
      return null;
    }
    if (release !== undefined && (typeof release !== 'string' || !isReleaseTag(release))) {
      return null;
    }
    if (pinned !== undefined && typeof pinned !== 'boolean') {
      return null;
    }
    if (recorded !== undefined && typeof recorded !== 'boolean') {
      return null;
    }
    const row: CodingProjectRow = { name, description, stars };
    if (typeof pushedAt === 'string') {
      row.pushedAt = pushedAt;
    }
    if (typeof closedPulls === 'number') {
      row.closedPulls = closedPulls;
    }
    if (typeof release === 'string') {
      row.release = release;
    }
    if (pinned === true) {
      row.pinned = true;
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
 * closes. The credentialed origin refreshes this panel each minute, with a
 * quarter-hour anonymous fallback, and its rate-limit cooldown tops out at
 * fifteen minutes. Two hours is therefore far past every legitimate quiet
 * spell: a stall, not a nap. */
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
 * repositories rather than a feed of cards. The head used to count the roster
 * they were chosen from ("latest 4 of <total> · by last push"); the owner cut
 * that line (2026-09-04, issue 292), so the table shows its four and says
 * nothing about the rest.
 *
 * Everything the cards proved stays proved. The roster is still the payload's,
 * the order is still derived from each row's effective instant, the captured
 * face is still what renders when no payload arrived, the staleness line is
 * still the same three honest states, and every href is still the fixed host
 * constant plus a name that passed the repository grammar. What changed is the
 * SHAPE the same facts are handed to a component in.
 * ------------------------------------------------------------------------ */

/* The table's column heads, in column order. They are the page's words for
 * what each column holds, and they are here rather than in the component for
 * the reason every label on this page is: a component that named a column
 * would be a component that knows what it is showing. */
export const projectTableHeads: readonly string[] = [
  'Repository',
  'Description',
  'PRs closed',
  'Version',
  'Stars',
  'Updated'
];

/* How many rows the table shows. The owner asked for the four most recent
 * (2026-09-03). */
export const shownProjectRows = 4;

export const projectsEmptyNote = 'no repositories reported';

/* The row's own dash, for a repository whose description the host does not
 * carry: an empty cell reads as a rendering fault, and this reads as what it
 * is. */
const noDescription = '—';

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
    const columns = projectColumns(project, live, now);
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
      updated: columns.updated,
      counts: columns.counts
    };
  });
  /* No title: the section head "02 / Projects" already names this table, and
     the origin's own "Coding Projects" beneath it was one label too many
     (owner directive, 2026-09-04, issue 292). The shell keeps the head row at
     the title's height for the stale line. */
  return {
    status: envelope?.status ?? 'unavailable',
    generatedAt: envelope?.generatedAt,
    heads: projectTableHeads,
    rows,
    emptyNote: projectsEmptyNote,
    staleNote: projectsStaleNote(envelope, now)
  };
}
