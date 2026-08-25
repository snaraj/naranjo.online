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
 * held. */

export interface GalleryPhoto {
  readonly src: string;
  readonly previewSrc: string;
  readonly alt: string;
  readonly sourceUrl: string;
}

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
    sourceUrl: 'https://picsum.photos/seed/naranjo-gallery-01/3840/2160'
  },
  {
    src: 'gallery-02-full.webp',
    previewSrc: 'gallery-02-preview.webp',
    alt: 'Placeholder photograph 2 of 8',
    sourceUrl: 'https://picsum.photos/seed/naranjo-gallery-02/3840/2160'
  },
  {
    src: 'gallery-03-full.webp',
    previewSrc: 'gallery-03-preview.webp',
    alt: 'Placeholder photograph 3 of 8',
    sourceUrl: 'https://picsum.photos/seed/naranjo-gallery-03/3840/2160'
  },
  {
    src: 'gallery-04-full.webp',
    previewSrc: 'gallery-04-preview.webp',
    alt: 'Placeholder photograph 4 of 8',
    sourceUrl: 'https://picsum.photos/seed/naranjo-gallery-04/3840/2160'
  },
  {
    src: 'gallery-05-full.webp',
    previewSrc: 'gallery-05-preview.webp',
    alt: 'Placeholder photograph 5 of 8',
    sourceUrl: 'https://picsum.photos/seed/naranjo-gallery-05/3840/2160'
  },
  {
    src: 'gallery-06-full.webp',
    previewSrc: 'gallery-06-preview.webp',
    alt: 'Placeholder photograph 6 of 8',
    sourceUrl: 'https://picsum.photos/seed/naranjo-gallery-06/3840/2160'
  },
  {
    src: 'gallery-07-full.webp',
    previewSrc: 'gallery-07-preview.webp',
    alt: 'Placeholder photograph 7 of 8',
    sourceUrl: 'https://picsum.photos/seed/naranjo-gallery-07/3840/2160'
  },
  {
    src: 'gallery-08-full.webp',
    previewSrc: 'gallery-08-preview.webp',
    alt: 'Placeholder photograph 8 of 8',
    sourceUrl: 'https://picsum.photos/seed/naranjo-gallery-08/3840/2160'
  }
];
