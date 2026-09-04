/* The work-history block (issue 165): the generic LedgerLog bound to the
 * captured rows in lib/work.ts. Static — the build already carries the data.
 *
 * It used to bind EntryLog, which drew four cards with every accomplishment
 * on the page at once. The owner's ledger redesign (2026-09-03, issue 287)
 * made the section a summary that opens: the same four roles, the same order,
 * the same accomplishments, as ruled rows with a drawer each. One line here,
 * because that is what the manifest architecture is for. */

import { staticBlock, type PageBlock } from '../blocks.ts';
import LedgerLog from '../components/LedgerLog.svelte';
import { roleLedgerProps } from '../work.ts';

export const workHistory: PageBlock = staticBlock('work-history', LedgerLog, roleLedgerProps);
