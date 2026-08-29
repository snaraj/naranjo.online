/* The Projects section's information module (owner directive, issue 134; live
 * since issue 242): the owner's six public repositories.
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

import type { EntryCount, EntryLogProps } from './blocks.ts';
import { formatWhole } from './grid.ts';
import { panelKinds } from './panels.ts';
import type { CodingProjectRow, CodingProjectsData, PanelEnvelope } from './panels';

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
export const projectsCapturedOn = '2026-08-27';

/* The six public repositories, in the order the owner listed them. */
export const projects: readonly Project[] = [
  {
    name: 'naranjo.online',
    description: 'Welcome to my personal website',
    commits: 118,
    stars: 1,
    pushedAt: '2026-08-28T02:36:21Z'
  },
  {
    name: 'website-infrastructure',
    description:
      'My infrastructure for self-hosting scalable and secure applications using Kubernetes',
    commits: 95,
    stars: 1,
    pushedAt: '2026-08-28T02:58:56Z'
  },
  {
    name: 'lidersea.com',
    description: 'The home of lidersea.com',
    commits: 89,
    stars: 1,
    pushedAt: '2026-08-27T23:20:26Z'
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

/* How long ago an instant was, as the coarse sentence a project card carries
 * ("updated 3 days ago"). Coarse on purpose: the capture is a maintenance
 * record, not a clock, so hours would claim a precision the data does not
 * have — a repository pushed within the last day simply reads "today".
 * Thirty-day months and 365-day years for the same reason: this is a reading
 * aid, and the calendar-exact arithmetic would change no reader's takeaway.
 * `now` is injectable so the unit suite can execute every band against a
 * fixed clock instead of asserting around a moving one. */
export function updatedLabel(pushedAt: string, now: number = Date.now()): string {
  const days = Math.floor((now - Date.parse(pushedAt)) / 86_400_000);
  if (days < 1) {
    return 'updated today';
  }
  if (days < 30) {
    return `updated ${days} ${days === 1 ? 'day' : 'days'} ago`;
  }
  const months = Math.floor(days / 30);
  if (days < 365) {
    return `updated ${months} ${months === 1 ? 'month' : 'months'} ago`;
  }
  const years = Math.floor(days / 365);
  return `updated ${years} ${years === 1 ? 'year' : 'years'} ago`;
}

/* projectCounts renders one row's three figures against whatever the panel
 * could actually vouch for.
 *
 * `live` is the panel's row when one arrived and was admitted; absent means
 * this row is serving its captured values, and every figure on it is then
 * marked. The commit count is marked either way — no repository API reports a
 * total, so it is captured no matter how fresh the row beside it is.
 *
 * Every figure ships with the WORD it counts, visibly, rather than behind the
 * glyph: an icon is a second channel for a figure, never the only one, and a
 * monochrome render or a screen reader has to convey the same thing the icon
 * does (dataviz floor). The plural is derived rather than assumed — "1
 * commits" is the kind of small lie a page tells when nobody executes its
 * labels, and two of the six rows genuinely are one.
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
  const pushedAt = recorded ? project.pushedAt : (live.pushedAt ?? project.pushedAt);
  return [
    {
      key: 'commits',
      glyph: 'node',
      label: `${formatWhole(project.commits)} ${project.commits === 1 ? 'commit' : 'commits'}`,
      /* Always: the count is captured however fresh the row beside it is. */
      marked: true
    },
    {
      key: 'stars',
      glyph: 'star',
      label:
        stars === null ? 'stars unknown' : `${formatWhole(stars)} ${stars === 1 ? 'star' : 'stars'}`,
      marked: recorded
    },
    /* Third and last (owner directive, 0.1.52): how long since the last
     * update, computed from the instant against the reader's own clock rather
     * than shipped as frozen words — see pushedAt above. */
    {
      key: 'updated',
      glyph: 'clock',
      label: updatedLabel(pushedAt, now),
      marked: recorded
    }
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    const { name, description, stars, pushedAt, recorded } = entry;
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
    if (recorded !== undefined && typeof recorded !== 'boolean') {
      return null;
    }
    const row: CodingProjectRow = { name, description, stars };
    if (typeof pushedAt === 'string') {
      row.pushedAt = pushedAt;
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
 * layout. */
export function codingProjectsProps(envelope: PanelEnvelope | null, now?: number): EntryLogProps {
  const payload =
    envelope !== null && envelope.kind === panelKinds.codingProjects
      ? parseCodingProjects(envelope.data)
      : null;
  const byName = new Map((payload?.repos ?? []).map((row) => [row.name, row]));
  return {
    variant: 'compact',
    titleLevel: 4,
    entries: projects.map((project) => projectEntry(project, byName.get(project.name), now))
  };
}
