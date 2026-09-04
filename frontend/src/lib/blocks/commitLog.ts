/* The commits block (owner directive, 2026-09-03, issue 287): the generic
 * CommitLog bound to TWO live panels at once through the composite adapter in
 * lib/commits.ts.
 *
 * It is the first multi-panel binding on this page and it exists because the
 * section is genuinely one picture of two sources: the calendar cycles between
 * the version-control contributions and each token source's daily series, laid
 * onto the same 53-week window so the three can be read against each other.
 * Binding two panels is one line here (panelsBlock) rather than a component
 * that fetches for itself, so the layer boundary the manifest architecture
 * draws is exactly where it always was — the component still knows no panel,
 * no vendor and no host.
 *
 * The panel ids come from lib/commits.ts, in the order that adapter unpacks
 * them, so the declaration and the read cannot disagree. */

import { panelsBlock, type PageBlock } from '../blocks.ts';
import { commitLogProps, commitPanelIds } from '../commits.ts';
import CommitLog from '../components/CommitLog.svelte';

export const commitLog: PageBlock = panelsBlock(
  'commit-log',
  CommitLog,
  commitPanelIds,
  (envelopes) => commitLogProps(envelopes)
);
