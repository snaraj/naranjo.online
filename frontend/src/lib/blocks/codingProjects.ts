/* The coding-projects block (issue 165; live since issue 242): the generic
 * EntryLog bound to the coding-projects panel through its adapter in
 * lib/projects.ts. The binding layer is the one place the component, the panel
 * id and the adapter meet; the component knows no repository and no host.
 *
 * It became a PANEL binding when the owner's live-data directive landed: the
 * origin now reads the repository metadata itself on the panels refresh
 * cadence, so a description the owner edits on the host reaches the page
 * without a release. Requirement 1 is untouched — the page reads this origin's
 * own /api/panels path like every other panel, and the repository URLs remain
 * link targets a human may click.
 *
 * The adapter renders the captured rows for a null, wrong-kinded, or
 * inadmissible envelope, so this block has no loading face and reserves
 * nothing: its first paint is already true, and the panel's arrival replaces
 * content without moving layout. */

import { panelBlock, type PageBlock } from '../blocks.ts';
import EntryLog from '../components/EntryLog.svelte';
import { codingProjectsPanelId, codingProjectsProps } from '../projects.ts';

export const codingProjects: PageBlock = panelBlock(
  'coding-projects',
  EntryLog,
  codingProjectsPanelId,
  (envelope) => codingProjectsProps(envelope),
  { heading: 'Coding Projects' }
);
