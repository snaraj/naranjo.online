/* The work-history block (issue 165): the generic LedgerLog bound to the
 * captured rows in lib/work.ts. Static — the build already carries the data.
 *
 * It used to bind EntryLog, which drew four cards with every accomplishment
 * on the page at once. The owner's ledger redesign (2026-09-03, issue 287)
 * made the section a summary that opens: the same four roles, the same order,
 * the same accomplishments, as ruled rows with a drawer each.
 *
 * THE ONE THING THIS MODULE DOES OF ITS OWN is turn each role's mark FILE NAME
 * into the URL the bundler emitted for it (owner ruling, 2026-09-12, issue
 * 326), through the same import.meta.glob pattern lib/blocks/mediaGallery.ts
 * uses for the gallery. The rule is the same one that keeps a file name out of
 * MediaGallery.svelte: naming files is the bundler's business and a component
 * that spelled one would be a component the build could silently break. So
 * work.ts names files, LedgerLog.svelte receives URLs, and this is the single
 * seam between them. */

import { staticBlock, type PageBlock } from '../blocks.ts';
import LedgerLog from '../components/LedgerLog.svelte';
import { roleLedgerProps } from '../work.ts';

const markFiles = import.meta.glob('../../assets/images/marks/*.png', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>;

function markUrl(file: string): string {
  return markFiles[`../../assets/images/marks/${file}`];
}

export const workHistory: PageBlock = staticBlock(
  'work-history',
  LedgerLog,
  roleLedgerProps(markUrl)
);
