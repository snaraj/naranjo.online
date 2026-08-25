/* The Work section's entries (owner directive, issue 134).
 *
 * The copy is PLACEHOLDER and the owner asked for it in exactly this shape:
 * two entries, each a heading, a location line, and a short lorem-ipsum
 * paragraph, with the two paragraphs different from one another. Real roles
 * come later; nothing here describes anyone's actual employment, and the
 * section says so on the page rather than leaving a reader to work it out from
 * the Latin.
 *
 * The rows live here rather than inside the component so the properties that
 * carry meaning — two entries, each complete, the paragraphs genuinely
 * distinct — are executed by tests/sections.test.mjs instead of pattern
 * matched through an each-block. */

import type { EntryLogProps } from './blocks.ts';

export interface WorkEntry {
  /* The role heading, and the keyed-each key. */
  readonly title: string;
  /* Where the role is, on its own line under the heading. */
  readonly location: string;
  /* The short paragraph under the location. */
  readonly summary: string;
}

/* The note the section renders above the entries. It is the honest-state half
 * of shipping placeholder copy: the page never implies these are real roles. */
export const workPlaceholderNote = 'Placeholder entries — the real roles are not written yet.';

export const workEntries: readonly WorkEntry[] = [
  {
    title: 'Job Description One',
    location: 'California, USA',
    summary:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.'
  },
  {
    title: 'Job Description Two',
    location: 'Texas, USA',
    summary:
      'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure.'
  }
];

/* The adapter (issue 165): the rows above as EntryLog props. Every entry is
 * marked placeholder — the honest-states flag the DOM carries — and the
 * titles sit at h3, directly under the section's own h2. The default framed
 * card variant is deliberate: these are the page's primary records, not a
 * compact list. */
export const workHistoryProps: EntryLogProps = {
  entries: workEntries.map((entry) => ({
    key: entry.title,
    title: entry.title,
    byline: entry.location,
    summary: entry.summary,
    placeholder: true
  })),
  titleLevel: 3
};
