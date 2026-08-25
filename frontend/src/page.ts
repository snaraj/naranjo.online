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

export const page: readonly PageSection[] = [
  section('work', 'Work', [workHistory]),
  section('projects', 'Projects', [codingProjects, artGallery]),
  section('trackers', 'Trackers', [osrsStats, vcsActivity, tokenUsage], { layout: 'stack' }),
  section('about', 'About Me', [about])
];
