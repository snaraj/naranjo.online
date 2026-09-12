/* The Projects · Commits block (issue 165; live since issue 242; paired with
 * the commit log by the owner's design decision of 2026-09-11, issue 318): the
 * generic LedgerSpread bound to TWO live panels — the repository metadata and
 * the contributions record — through the composite adapter in lib/commits.ts.
 * The binding layer is the one place the component, the panel ids and the
 * adapter meet; the component knows no repository, no commit and no host.
 *
 * BOTH ARE PANEL BINDINGS: the origin reads the repository listing and the
 * contributions record itself on the panels refresh cadence, so a repository
 * the owner pins on the host, and a commit pushed a minute ago, reach the page
 * without a release. Requirement 1 is untouched — the page reads this origin's
 * own /api/panels path like every other panel, and the host URLs remain link
 * targets a human may click.
 *
 * The adapter renders the captured repository rows for a null, wrong-kinded or
 * inadmissible projects envelope, so this block has no loading face: its first
 * paint is already true, and the panel's arrival replaces content without
 * moving layout. The commit column has no captured face and needs none — its
 * box is reserved at the table's own row count, so an empty log is a reserved
 * box with an honest note in it rather than a gap that closes later. */

import { panelsBlock, type PageBlock } from '../blocks.ts';
import { projectsCommitsProps, spreadPanelIds } from '../commits.ts';
import LedgerSpread from '../components/LedgerSpread.svelte';

export const projectsCommits: PageBlock = panelsBlock(
  'projects-commits',
  LedgerSpread,
  spreadPanelIds,
  (envelopes) => projectsCommitsProps(envelopes)
);
