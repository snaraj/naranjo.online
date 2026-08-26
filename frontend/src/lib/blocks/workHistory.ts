/* The work-history block (issue 165): the generic EntryLog bound to the
 * captured rows in lib/work.ts. Static — the build already carries the data.
 *
 * It used to declare a section note as well, the "placeholder entries" line
 * the page printed over two lorem-ipsum records. The owner supplied the real
 * history (2026-08-25), so both the copy and its disclaimer are gone: an
 * honest-state note over four real roles would itself be the false statement
 * the note existed to prevent. */

import { staticBlock, type PageBlock } from '../blocks.ts';
import EntryLog from '../components/EntryLog.svelte';
import { workHistoryProps } from '../work.ts';

export const workHistory: PageBlock = staticBlock('work-history', EntryLog, workHistoryProps);
