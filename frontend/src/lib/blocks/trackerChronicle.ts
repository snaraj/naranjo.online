/* The tracker-chronicle block (owner direction, 2026-10-16): the token board
 * and the contribution calendar, drawn as ONE diagram on one timeline — the
 * daily lines over the year's cells, the large figures above and each
 * source's account below.
 *
 * It binds the calendar's two panels, in the calendar's order, through the
 * composite adapter in lib/chronicle.ts, which itself only lays the two
 * existing adapters side by side. The component still knows no panel, no
 * vendor and no host. */

import { panelsBlock, type PageBlock } from '../blocks.ts';
import { chroniclePanelIds, chronicleProps } from '../chronicle.ts';
import Chronicle from '../components/Chronicle.svelte';

export const trackerChronicle: PageBlock = panelsBlock(
  'tracker-chronicle',
  Chronicle,
  chroniclePanelIds,
  (envelopes) => chronicleProps(envelopes)
);
