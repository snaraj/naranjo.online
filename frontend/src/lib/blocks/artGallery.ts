/* The Art block (issue 165, redesigned issue 176, cut over to the media
 * volume in issue 207): the generic MediaGallery bound to whichever set of
 * items actually exists.
 *
 * TWO SOURCES, ONE COMPONENT, AND THE ORDER MATTERS. The build ships the
 * vendored bootstrap rows in lib/gallery.ts — files under
 * assets/images/gallery/, a narrow and dated requirement-11 exception with
 * provenance in its SOURCES.md — and they render FIRST, before any request
 * exists. If the operator's media volume is serving a gallery/v1 manifest,
 * lib/galleryManifest.ts reads it once and this adapter replaces the whole
 * props object with the volume's items. If it is not — media disabled, no
 * manifest, a malformed one — the read answers null and the vendored set
 * simply stays, which is issue 182's sanctioned explicit offline fallback.
 * Nothing renders an error, a spinner, or an empty frame, because none of
 * those would be true.
 *
 * WHY THE URL MAP IS BUILT HERE, still: import.meta.glob is the bundler's,
 * mirroring lib/blocks/osrsStats.ts's icon-map pattern. gallery.ts names
 * FILES so it stays importable by plain Node in tests/sections.test.mjs, and
 * this is the one place those names become content-hashed URLs. The volume's
 * items need no such map — their URLs were built by lib/media.ts inside the
 * manifest reader, and this module never assembles one of its own. */

import { runtimeBlock, type MediaGalleryItem, type MediaGalleryProps, type PageBlock } from '../blocks.ts';
import { galleryHeight, galleryPhotos, galleryWidth } from '../gallery.ts';
import { loadGalleryManifest, type GalleryItem } from '../galleryManifest.ts';
import MediaGallery from '../components/MediaGallery.svelte';

const galleryFiles = import.meta.glob('../../assets/images/gallery/*.webp', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>;

function resolve(file: string): string {
  return galleryFiles[`../../assets/images/gallery/${file}`];
}

/* The vendored bootstrap props. Optional metadata passes through UNCHANGED
 * and UNDEFAULTED (issue 202): an absent title stays undefined here rather
 * than becoming '' or a placeholder, because the component's
 * absent-renders-nothing contract depends on absence surviving this layer.
 * The three fields ride the SAME pass-through the volume items get through
 * toGalleryItem below, which is issue 182's whole point — a vendored item and
 * a volume item carry metadata identically, so the cutover changes where the
 * URLs come from and nothing else. */
const vendored: MediaGalleryProps = {
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
};

/* One admitted manifest item becomes one component item. Every URL already
 * exists — lib/galleryManifest.ts built them through lib/media.ts and refused
 * any item whose paths could not produce one — so this function does no
 * string work at all beyond choosing the poster. */
function toGalleryItem(item: GalleryItem): MediaGalleryItem {
  const rendered: {
    key: string;
    previewSrc: string;
    fullSrc: string;
    alt: string;
    width: number;
    height: number;
    title?: string;
    description?: string;
    link?: { href: string; label: string };
    video?: { posterSrc: string; sources: readonly { src: string; type: string }[] };
  } = {
    key: item.key,
    previewSrc: item.preview.url,
    fullSrc: item.full.url,
    alt: item.alt,
    width: item.full.width,
    height: item.full.height
  };
  if (item.title !== undefined) {
    rendered.title = item.title;
  }
  if (item.description !== undefined) {
    rendered.description = item.description;
  }
  if (item.link !== undefined) {
    rendered.link = item.link;
  }
  if (item.kind === 'video' && item.sources !== undefined) {
    rendered.video = {
      /* A dedicated poster when the operator published one, the large still
         otherwise — the same picture the lightbox would have shown anyway,
         so the default is a real frame rather than a blank rectangle. */
      posterSrc: (item.poster ?? item.full).url,
      /* Manifest order, untouched: the browser picks the first source it can
         play, so reordering here would silently change which rendition a
         reader receives. */
      sources: item.sources.map((source) => ({ src: source.url, type: source.type }))
    };
  }
  return rendered;
}

export const artGallery: PageBlock = runtimeBlock(
  'art-gallery',
  MediaGallery,
  vendored,
  async () => {
    const items = await loadGalleryManifest();
    if (items === null) {
      return null;
    }
    return {
      items: items.map(toGalleryItem),
      /* The gallery-level box the vendored set declares stays the DEFAULT for
         a volume item that omits its own; every item this adapter builds
         carries one, so this is the shape of the contract rather than a
         number anything currently reads. */
      width: galleryWidth,
      height: galleryHeight
    };
  },
  { heading: 'Art' }
);
