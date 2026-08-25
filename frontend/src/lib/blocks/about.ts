/* The about block (issue 165): the nav names the section, so it has to exist
 * and land somewhere real, and nothing has been written for it yet. The
 * generic EmptyNote states exactly that — an honest empty state, never
 * filler, because a section that invented a biography to look finished would
 * be the exact failure the honest-states floor is about. When the copy is
 * written, this block's data gains it; the manifest line does not move. */

import { staticBlock, type PageBlock } from '../blocks.ts';
import EmptyNote from '../components/EmptyNote.svelte';

export const about: PageBlock = staticBlock('about', EmptyNote, {
  note: 'This section has not been written yet.'
});
