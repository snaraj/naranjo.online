/* The page's own table of contents (owner directive, issue 134): a row of
 * in-page links under the name, one per section of the stacked page.
 *
 * The list lives here rather than inside the nav component because two things
 * have to agree about it — the link that jumps and the section that is jumped
 * to — and a nav that spelled its own targets could point at a section nobody
 * rendered. One list, rendered by the nav and pinned against the markup by
 * tests/sections.test.mjs, is what makes a dead in-page link a red build
 * instead of a click that does nothing.
 *
 * The ids are the fragment identifiers the sections carry, so `href="#work"`
 * and `id="work"` are the same string from the same place. */

export interface PageSection {
  /* The fragment identifier, and the id the section element carries. */
  readonly id: string;
  /* The visible link text, exactly as the owner named it. */
  readonly label: string;
}

/* The four sections, in the order the page stacks them. The nav reads left to
 * right in the same order the reader scrolls down. */
export const pageSections: readonly PageSection[] = [
  { id: 'work', label: 'Work' },
  { id: 'projects', label: 'Projects' },
  { id: 'trackers', label: 'Trackers' },
  { id: 'about', label: 'About Me' }
];

/* The href one nav link carries. Trivial by design: it exists so the '#' is
 * written once, in a function a test can execute, rather than concatenated
 * inside a template where a lost character renders a link to the page root. */
export function sectionHref(section: PageSection): string {
  return `#${section.id}`;
}
