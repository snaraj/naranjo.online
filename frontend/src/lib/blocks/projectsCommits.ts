/* The Ongoing Work block (issue 165; live since issue 242; one stream since the
 * owner's direction of 2026-11-02, issue #399): the generic Stream bound to TWO
 * live panels — the repository metadata and the contributions record — through
 * the composite adapter in lib/commits.ts. The binding layer is the one place
 * the component, the panel ids and the adapter meet; the component knows no
 * repository, no commit and no host.
 *
 * BOTH ARE PANEL BINDINGS: the origin reads the repository listing and the
 * contributions record itself on the panels refresh cadence, so a release cut
 * on the host, and a commit pushed a minute ago, reach the page without a
 * release of this site. Requirement 1 is untouched — the page reads this
 * origin's own /api/panels path like every other panel, and the host URLs
 * remain link targets a human may click.
 *
 * The stream has no loading face: its list reserves a page of entries before
 * either payload lands, so an empty stream is a reserved box with an honest
 * note in it rather than a gap that closes later. */

import { panelsBlock, type PageBlock } from '../blocks.ts';
import { projectsCommitsProps, spreadPanelIds } from '../commits.ts';
import Stream from '../components/Stream.svelte';

export const projectsCommits: PageBlock = panelsBlock(
  'projects-commits',
  Stream,
  spreadPanelIds,
  (envelopes) => projectsCommitsProps(envelopes)
);
