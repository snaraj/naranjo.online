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
import { about } from './lib/blocks/about.ts';
import { artGallery } from './lib/blocks/artGallery.ts';
import { codingProjects } from './lib/blocks/codingProjects.ts';
import { osrsStats } from './lib/blocks/osrsStats.ts';
import { tokenUsage } from './lib/blocks/tokenUsage.ts';
import { vcsActivity } from './lib/blocks/vcsActivity.ts';
import { workHistory } from './lib/blocks/workHistory.ts';

/* Two owner directives of 2026-08-25 are visible here, and both are one line
 * each, which is the whole point of the manifest.
 *
 * The first section is "Professional Experience" now that it holds the real
 * history rather than placeholder copy. Its ID stays `work`: the id is the
 * fragment a nav link jumps to and an address a reader may already have
 * shared, and renaming it would break those to change a word nobody reads
 * off the URL.
 *
 * The trackers stack reversed its two ends — the token tracker used to render
 * under the game one and now opens the section, with the game tracker at the
 * bottom. The version-control tracker between them did not move, and About Me
 * is still the last thing on the page. */
export const page: readonly PageSection[] = [
  section('work', 'Professional Experience', [workHistory]),
  section('projects', 'Projects', [codingProjects, artGallery]),
  section('trackers', 'Trackers', [tokenUsage, vcsActivity, osrsStats], { layout: 'stack' }),
  section('about', 'About Me', [about])
];
