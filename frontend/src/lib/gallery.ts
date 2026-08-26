/* Gallery placeholder photography (issue 176, owner UX directive
 * 2026-08-25): eight different 4K photos from Lorem Picsum, vendored as
 * WebP pairs under assets/images/gallery/ because the origin's media
 * pipeline (lib/media.ts) needs a data volume this frontend-only change
 * cannot provision — a narrow, dated requirement-11 exception; full
 * provenance in assets/images/gallery/SOURCES.md.
 *
 * src and previewSrc name the vendored FILES, not resolved URLs: this
 * plain module is imported directly, under Node, by
 * frontend/tests/sections.test.mjs, and import.meta.glob (which resolves
 * a file name to a content-hashed URL) is Vite-only syntax that belongs in
 * the binding layer (lib/blocks/artGallery.ts) — mirroring the OSRS icon
 * maps in lib/blocks/osrsStats.ts — never in this data module.
 *
 * Nothing here claims to know what a photograph depicts — "photograph N of
 * 8" is what is verifiably true, the same discipline the retired art.ts
 * held.
 *
 * OPTIONAL METADATA (owner directive 2026-08-25, issue 202). A photograph
 * MAY carry a title, a description and a link; all three are optional and
 * every one of them is independently absent-able, because the honest state
 * of a placeholder nobody has reviewed is that there is nothing to say about
 * it. They live HERE, in the per-entry manifest row, and not in the adapter
 * or the component, precisely so issue 182's coming media-volume cutover
 * stays a URL-mapping change: the row keeps its metadata when src/previewSrc
 * stop naming vendored files and start naming media-pipeline paths. Metadata
 * is therefore never coupled to the vendored bootstrap WebP set.
 *
 * What today's eight rows may truthfully carry is exactly one thing, and it
 * is already recorded in assets/images/gallery/SOURCES.md: the fixed-seed URL
 * each vendored file was fetched from. That becomes `link`. No row carries a
 * `title` or a `description`, because nobody has reviewed what these
 * placeholders depict and a caption invented to look finished is the same
 * failure as a panel inventing a figure. */

/* A link the reader may follow out of the site. Both halves are required
 * together: an href with no label is a link with nothing to click, and this
 * component never invents label copy of its own. */
export interface GalleryLink {
  readonly href: string;
  readonly label: string;
}

export interface GalleryPhoto {
  readonly src: string;
  readonly previewSrc: string;
  readonly alt: string;
  readonly sourceUrl: string;
  /* Optional, and absent means ABSENT: nothing renders, nothing is
   * reserved, and no empty row appears in its place. */
  readonly title?: string;
  readonly description?: string;
  readonly link?: GalleryLink;
}

/* The one label the vendored bootstrap set can truthfully wear: SOURCES.md
 * records the fixed-seed Lorem Picsum URL each file was fetched from, so the
 * link says that and nothing more. */
export const gallerySourceLinkLabel = 'Lorem Picsum source';

/* Every photograph is the same shape, and the frame reserves it before a
 * byte arrives — stated once, here, so the adapter's props and the
 * stylesheet's reserved box cannot disagree about the ratio. */
export const galleryWidth = 3840;
export const galleryHeight = 2160;

export const galleryLicenseNote =
  'Placeholder photography from Lorem Picsum (Unsplash Licence — free use, no attribution required), vendored temporarily and replaced by real work later.';

export const galleryPhotos: readonly GalleryPhoto[] = [
  {
    src: 'gallery-01-full.webp',
    previewSrc: 'gallery-01-preview.webp',
    alt: 'Placeholder photograph 1 of 8',
    sourceUrl: 'https://picsum.photos/seed/naranjo-gallery-01/3840/2160',
    link: { href: 'https://picsum.photos/seed/naranjo-gallery-01/3840/2160', label: gallerySourceLinkLabel }
  },
  {
    src: 'gallery-02-full.webp',
    previewSrc: 'gallery-02-preview.webp',
    alt: 'Placeholder photograph 2 of 8',
    sourceUrl: 'https://picsum.photos/seed/naranjo-gallery-02/3840/2160',
    link: { href: 'https://picsum.photos/seed/naranjo-gallery-02/3840/2160', label: gallerySourceLinkLabel }
  },
  {
    src: 'gallery-03-full.webp',
    previewSrc: 'gallery-03-preview.webp',
    alt: 'Placeholder photograph 3 of 8',
    sourceUrl: 'https://picsum.photos/seed/naranjo-gallery-03/3840/2160',
    link: { href: 'https://picsum.photos/seed/naranjo-gallery-03/3840/2160', label: gallerySourceLinkLabel }
  },
  {
    src: 'gallery-04-full.webp',
    previewSrc: 'gallery-04-preview.webp',
    alt: 'Placeholder photograph 4 of 8',
    sourceUrl: 'https://picsum.photos/seed/naranjo-gallery-04/3840/2160',
    link: { href: 'https://picsum.photos/seed/naranjo-gallery-04/3840/2160', label: gallerySourceLinkLabel }
  },
  {
    src: 'gallery-05-full.webp',
    previewSrc: 'gallery-05-preview.webp',
    alt: 'Placeholder photograph 5 of 8',
    sourceUrl: 'https://picsum.photos/seed/naranjo-gallery-05/3840/2160',
    link: { href: 'https://picsum.photos/seed/naranjo-gallery-05/3840/2160', label: gallerySourceLinkLabel }
  },
  {
    src: 'gallery-06-full.webp',
    previewSrc: 'gallery-06-preview.webp',
    alt: 'Placeholder photograph 6 of 8',
    sourceUrl: 'https://picsum.photos/seed/naranjo-gallery-06/3840/2160',
    link: { href: 'https://picsum.photos/seed/naranjo-gallery-06/3840/2160', label: gallerySourceLinkLabel }
  },
  {
    src: 'gallery-07-full.webp',
    previewSrc: 'gallery-07-preview.webp',
    alt: 'Placeholder photograph 7 of 8',
    sourceUrl: 'https://picsum.photos/seed/naranjo-gallery-07/3840/2160',
    link: { href: 'https://picsum.photos/seed/naranjo-gallery-07/3840/2160', label: gallerySourceLinkLabel }
  },
  {
    src: 'gallery-08-full.webp',
    previewSrc: 'gallery-08-preview.webp',
    alt: 'Placeholder photograph 8 of 8',
    sourceUrl: 'https://picsum.photos/seed/naranjo-gallery-08/3840/2160',
    link: { href: 'https://picsum.photos/seed/naranjo-gallery-08/3840/2160', label: gallerySourceLinkLabel }
  }
];
