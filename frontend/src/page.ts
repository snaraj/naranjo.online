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
import { codingProjects } from './lib/blocks/codingProjects.ts';
import { commitLog } from './lib/blocks/commitLog.ts';
import { mediaGallery } from './lib/blocks/mediaGallery.ts';
import { tokenSquares } from './lib/blocks/tokenSquares.ts';
import { workHistory } from './lib/blocks/workHistory.ts';

/* THE LEDGER'S FIVE SECTIONS (owner directive, 2026-09-03, issue 287), and
 * every one of them is one line, which is the whole point of the manifest.
 *
 * The page used to be three sections: Professional Experience, Projects (with
 * the media gallery folded into it), and a Trackers stack holding all three
 * live panels. The redesign gives each of the owner's five headings a section
 * of its own — 01 through 05 down the sheet — which moves exactly two things
 * and adds one:
 *
 *   * COMMITS is now its own section rather than a card inside Trackers. It
 *     leads with the contribution calendar, and the calendar cycles between
 *     that and each token source's daily series, so the section is one block
 *     reading two panels (lib/blocks/commitLog.ts).
 *   * GALLERY leaves Projects, where it was a sub-heading, and becomes the
 *     sheet's last section under its own number.
 *   * TRACKERS keeps its stack layout and keeps exactly the two blocks that
 *     are still trackers once the calendar has moved out: the board of token
 *     squares and the boss ticker.
 *
 * The IDS do not move. An id is the fragment a nav link jumps to and an
 * address a reader may already have shared, so `work` stays `work` — renaming
 * it would break those to change a word nobody reads off the URL. `commits`
 * and `gallery` are new ids because they name new sections.
 *
 * "About Me" is still gone (owner directive, 2026-08-28), and its absence is
 * still one missing line rather than a gap left behind. */
export const page: readonly PageSection[] = [
  section('work', 'Professional Experience', [workHistory]),
  section('projects', 'Projects', [codingProjects]),
  section('commits', 'Commits', [commitLog], { layout: 'stack' }),
  section('trackers', 'Trackers', [tokenSquares, bossTicker], { layout: 'stack' }),
  section('gallery', 'Gallery', [mediaGallery])
];
