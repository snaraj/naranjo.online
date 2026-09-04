/* The coding-projects block (issue 165; live since issue 242): the generic
 * LedgerTable bound to the coding-projects panel through its adapter in
 * lib/projects.ts. The binding layer is the one place the component, the panel
 * id and the adapter meet; the component knows no repository and no host.
 *
 * It is a PANEL binding: the origin reads the repository metadata itself on
 * the panels refresh cadence, so a description the owner edits on the host
 * reaches the page without a release. Requirement 1 is untouched — the page
 * reads this origin's own /api/panels path like every other panel, and the
 * repository URLs remain link targets a human may click.
 *
 * The adapter renders the captured rows for a null, wrong-kinded, or
 * inadmissible envelope, so this block has no loading face and reserves
 * nothing: its first paint is already true, and the panel's arrival replaces
 * content without moving layout.
 *
 * The shape it renders changed with the ledger (owner directive, 2026-09-03,
 * issue 287): a ruled table of the four most recently pushed repositories,
 * with the roster it was selected from counted in the head, rather than a feed
 * of cards. The adapter picks and orders; this line binds. */

import { panelBlock, type PageBlock } from '../blocks.ts';
import LedgerTable from '../components/LedgerTable.svelte';
import { codingProjectsPanelId, projectTableProps } from '../projects.ts';

export const codingProjects: PageBlock = panelBlock(
  'coding-projects',
  LedgerTable,
  codingProjectsPanelId,
  (envelope) => projectTableProps(envelope)
);
