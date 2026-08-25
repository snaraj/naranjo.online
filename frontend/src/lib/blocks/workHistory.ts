/* The work-history block (issue 165): the generic EntryLog bound to the
 * captured rows in lib/work.ts. Static — the build already carries the data —
 * and the placeholder note the section prints is declared here, where the
 * page introduces the block. */

import { staticBlock, type PageBlock } from '../blocks.ts';
import EntryLog from '../components/EntryLog.svelte';
import { workHistoryProps, workPlaceholderNote } from '../work.ts';

export const workHistory: PageBlock = staticBlock('work-history', EntryLog, workHistoryProps, {
  note: workPlaceholderNote
});
