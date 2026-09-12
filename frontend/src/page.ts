/* The page manifest (owner directive, issue 165): the ONE ordered statement
 * of what the page is. Each section is an id, a label, and its blocks; each
 * block is a generic component bound to an information source in
 * lib/blocks/. Reordering the page is moving one line here. The section nav
 * derives from this same array, so a link can never point at a section
 * nobody rendered — and tests/sections.test.mjs executes that pairing
 * against this module directly.
 *
 * The labels below are the page's own words. Domain labels — a game, a
 * vendor, a host — live in the adapters and binding modules, and never
 * render. */

import { section, type PageSection } from './lib/blocks.ts';
import { bossTicker } from './lib/blocks/bossTicker.ts';
import { contributionCalendar } from './lib/blocks/contributionCalendar.ts';
import { mediaGallery } from './lib/blocks/mediaGallery.ts';
import { projectsCommits } from './lib/blocks/projectsCommits.ts';
import { tokenBoard } from './lib/blocks/tokenBoard.ts';
import { workHistory } from './lib/blocks/workHistory.ts';

/* THE LEDGER'S FOUR SECTIONS (owner design decision, 2026-09-11, issue 318),
 * and every one of them is one line, which is the whole point of the manifest.
 *
 * The sheet had five. The owner's decision — option B on the design canvas —
 * pairs Projects and Commits into ONE section of two columns and sends the
 * contribution calendar down into Trackers, under the token cards it already
 * shares a 53-week window with:
 *
 *   * PROJECTS · COMMITS is one block reading two panels: the repositories on
 *     the left (the owner's pinned set plus the one pushed most recently
 *     outside it) and, beside them, every commit on every repository. They are
 *     one picture — what the owner keeps, and what actually landed in it — and
 *     the two columns reserve one height, which a pair of sections could not
 *     promise (lib/blocks/projectsCommits.ts).
 *   * TRACKERS takes the calendar back. It is a tracker: a year of daily
 *     counts the reader cycles between three sources, which is what the board
 *     above it and the ticker below it are too.
 *
 * The IDS do not move. An id is the fragment a nav link jumps to and an
 * address a reader may already have shared, so `projects` stays `projects`.
 * `commits` is no longer a SECTION id — but it is still an address, so the
 * commit column carries it (lib/commits.ts names it once, the adapter hands it
 * through, and the nav never links it): a reader who bookmarked #commits still
 * lands on the commits.
 *
 * "About Me" is still gone (owner directive, 2026-08-28), and its absence is
 * still one missing line rather than a gap left behind.
 *
 * EACH SECTION ALSO CARRIES ITS MARK (owner design decision, 2026-09-11,
 * issue 313). The nav prints the mark and the number where the words used to
 * be, and the section head prints the mark beside them; both read this one
 * entry, so the two can never show different marks for one section. The
 * NUMBER is not here — it is the entry's position in this array, so a section
 * moved renumbers itself and no two can claim the same number. */
export const page: readonly PageSection[] = [
  section('work', 'Professional Experience', [workHistory], { mark: 'work' }),
  section('projects', 'Projects · Commits', [projectsCommits], { mark: 'folder' }),
  section('trackers', 'Trackers', [tokenBoard, contributionCalendar, bossTicker], {
    mark: 'chip',
    layout: 'stack'
  }),
  section('gallery', 'Gallery', [mediaGallery], { mark: 'photo' })
];
