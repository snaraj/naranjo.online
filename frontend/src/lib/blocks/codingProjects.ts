/* The coding-projects block (issue 165): the generic EntryLog bound to the
 * captured rows in lib/projects.ts. Static — requirement 1 keeps this page
 * local-origin-only: the static Coding Projects rows are not fetched from
 * GitHub; no code automatically requests projectHost; the validated GitHub
 * URLs are used only for visitor-activated navigation. No caption states any
 * of that on the page (issue 167) — capture provenance is a maintainer fact,
 * recorded in lib/projects.ts and enforced by tests/sections.test.mjs, not
 * something a visitor came here to read. */

import { staticBlock, type PageBlock } from '../blocks.ts';
import EntryLog from '../components/EntryLog.svelte';
import { codingProjectsProps } from '../projects.ts';

export const codingProjects: PageBlock = staticBlock('coding-projects', EntryLog, codingProjectsProps, {
  heading: 'Coding Projects'
});
