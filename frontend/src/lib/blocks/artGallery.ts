/* The Art block (issue 165, redesigned issue 176): the generic MediaGallery
 * bound to the vendored rows in lib/gallery.ts. Static — the files are
 * vendored under assets/images/gallery/ (a narrow, dated requirement-11
 * exception; see lib/gallery.ts and its SOURCES.md) and the origin serves
 * no bytes for them, so there is nothing to fetch and nothing that can go
 * "unserved".
 *
 * The URL map is built HERE because import.meta.glob is the bundler's,
 * mirroring lib/blocks/osrsStats.ts's icon-map pattern: gallery.ts names
 * FILES so it stays importable by plain Node in tests/sections.test.mjs,
 * and this is the one place those names become content-hashed URLs. */

import { staticBlock, type PageBlock } from '../blocks.ts';
import { galleryHeight, galleryPhotos, galleryWidth } from '../gallery.ts';
import MediaGallery from '../components/MediaGallery.svelte';

const galleryFiles = import.meta.glob('../../assets/images/gallery/*.webp', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>;

function resolve(file: string): string {
  return galleryFiles[`../../assets/images/gallery/${file}`];
}

export const artGallery: PageBlock = staticBlock(
  'art-gallery',
  MediaGallery,
  {
    /* The three optional metadata fields pass through UNCHANGED and
     * UNDEFAULTED (issue 202): an absent title stays undefined here rather
     * than becoming '' or a placeholder, because the component's whole
     * absent-renders-nothing contract depends on absence surviving this
     * layer. The adapter's job is URL resolution and nothing else. */
    items: galleryPhotos.map((photo) => ({
      key: photo.src,
      previewSrc: resolve(photo.previewSrc),
      fullSrc: resolve(photo.src),
      alt: photo.alt,
      title: photo.title,
      description: photo.description,
      link: photo.link
    })),
    width: galleryWidth,
    height: galleryHeight
  },
  { heading: 'Art' }
);
