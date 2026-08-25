/* The art block (issue 165): the generic MediaGallery bound to the captured
 * rows in lib/art.ts. Static — the addresses are build-time facts and the
 * origin serves the bytes — and the subsection heading plus the two
 * provenance lines are declared here, where the page introduces the block. */

import { artGalleryProps, artNote, artProvenance } from '../art.ts';
import { staticBlock, type PageBlock } from '../blocks.ts';
import MediaGallery from '../components/MediaGallery.svelte';

export const artGallery: PageBlock = staticBlock('art-gallery', MediaGallery, artGalleryProps, {
  heading: 'Art',
  intro: artNote,
  note: artProvenance
});
