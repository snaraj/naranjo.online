/* The Projects section's data (owner directive, issue 134): the owner's six
 * public repositories, each with the description the repository itself
 * carries, its commit count and its star count.
 *
 * DATA, not a fetch. The origin makes no outbound request for this and neither
 * does the page: requirement 1 keeps the frontend local-origin-only and
 * `PANELS_REFRESH` is default-off, so a live count would be a promise the
 * deployment cannot keep. These figures were captured out of band on the date
 * recorded below (projectsCapturedOn) — a maintenance record kept for
 * provenance, no longer rendered on the page (issue 167: a visitor-facing
 * caption used to spell out the capture date and the network posture in
 * prose; the owner removed both, because that is a maintainer/reviewer fact,
 * not something a visitor came to this page to read). The underlying
 * guarantee the caption used to describe — no live fetch, ever — is
 * unchanged and stays ENFORCED regardless, structurally rather than by a
 * sentence on the page: the static Coding Projects rows are not fetched
 * from GitHub; no code automatically requests `projectHost`; the validated
 * GitHub URLs are used only for visitor-activated navigation (Daybreak
 * Blue's review of this pull request, round 4, finding 1 — two earlier
 * wordings here both overstated the invariant, first as "no remote origin
 * anywhere" and then as "no transport primitive... in this module and the
 * components that read it," the second still false because
 * lib/activity.ts, a separate consumer of this same `projectHost`, feeds a
 * panel-bound block whose host calls `watchPanel`, whose production default
 * DOES call `fetch`; this wording claims nothing beyond what this module
 * and its own feed do). The host URLs here are link TARGETS: they reach the
 * DOM as href values a human may click.
 *
 * Vendor names are data. The host label lives in this module beside the rows
 * it describes, exactly as the panels keep theirs in config data, so the
 * components stay neutral and a move to another host is a data edit.
 *
 * One description is shipped shortened, and deliberately: the repository's own
 * text names the deployment's edge provider, and owner requirement R9 (the
 * deployment-provider contract in AGENTS.md, enforced by
 * internal/doctrine/provider_neutrality_test.go over this whole tree) admits a
 * provider name nowhere but the chart's values defaults. Splitting the word up
 * to slip past that scan would defeat a fail-closed pin rather than respect
 * it, so the clause is dropped and the omission is stated here. */

import type { EntryLogProps } from './blocks.ts';
import { formatWhole } from './grid.ts';

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

/* One count beside a project: the figure, and the words that carry it when the
 * icon cannot. A value is never encoded by icon alone (dataviz floor) — the
 * number is always rendered, and this label is what a screen reader hears
 * instead of a decorative glyph. */
export interface ProjectCount {
  /* Which glyph the card draws; also the keyed-each key. */
  readonly kind: 'commits' | 'stars' | 'updated';
  /* The visible text: the grouped figure and the word it counts, singular
   * where the figure genuinely is one. */
  readonly label: string;
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

/* projectCounts renders a project's two figures. Both are exact integers the
 * owner captured, so neither is ever rounded or abbreviated, and one is
 * genuinely 1 in two of the six rows — "1 commits" is the kind of small lie a
 * page tells when nobody executes its labels, so the plural is derived rather
 * than assumed.
 *
 * The word ships with the number and is VISIBLE rather than hidden behind the
 * glyph: an icon is a second channel for a figure, never the only one, and a
 * monochrome render or a screen reader has to convey the same thing the icon
 * does (dataviz floor). Grouped through the same whole-number renderer the
 * trackers use, so a four-figure count reads the way every other figure on the
 * page does. */
export function projectCounts(project: Project, now: number = Date.now()): ProjectCount[] {
  return [
    {
      kind: 'commits',
      label: `${formatWhole(project.commits)} ${project.commits === 1 ? 'commit' : 'commits'}`
    },
    {
      kind: 'stars',
      label: `${formatWhole(project.stars)} ${project.stars === 1 ? 'star' : 'stars'}`
    },
    /* Third and last (owner directive, 0.1.52): how long since the last
     * update, computed from the captured instant against the reader's own
     * clock rather than shipped as frozen words — see pushedAt above. */
    {
      kind: 'updated',
      label: updatedLabel(project.pushedAt, now)
    }
  ];
}

/* The adapter (issue 165): the rows above as EntryLog props. Each entry is a
 * linked title — the code glyph, then the name — with the two counts beside
 * it and the repository's own description as the summary. Compact cards at
 * h4: the feed sits under the "Coding Projects" h3 the manifest declares.
 * No caption rides along (issue 167): the capture date and network posture
 * stay maintainer facts in this module, per the head comment above. */
export const codingProjectsProps: EntryLogProps = {
  variant: 'compact',
  titleLevel: 4,
  entries: projects.map((project) => ({
    key: project.name,
    title: project.name,
    href: projectUrl(project),
    linkLabel: projectLinkLabel(project),
    glyph: 'code',
    counts: projectCounts(project).map((count) => ({
      key: count.kind,
      glyph:
        count.kind === 'commits'
          ? ('node' as const)
          : count.kind === 'stars'
            ? ('star' as const)
            : ('clock' as const),
      label: count.label
    })),
    summary: project.description
  }))
};
