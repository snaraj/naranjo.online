# Gallery placeholder photography — sources and licence

Owner UX directive, issue 176: eight different royalty-free 4K photographs,
curled once from Lorem Picsum with fixed seeds and vendored into this
repository (no runtime fetch). Real photography replaces every row here
later; nothing about this note or the code that reads these files claims to
know what any photograph depicts.

**Licence.** Lorem Picsum serves Unsplash photography under the Unsplash
Licence: free to use, no attribution required. That is what was verified
here; nothing more is claimed.

**Pipeline note (AGENTS.md requirement 11).** The origin's separate media
pipeline (`src/lib/media.ts` + the Go server's `/media/` route) needs an
operator-provisioned, read-only data volume (ADR 0012) that a frontend-only
change cannot provision — enabling it is a platform/deploy decision, still
pending. Routing these eight placeholders through that pipeline today would
mean the gallery keeps showing empty frames, which is exactly the "8 ugly
placeholder boxes" problem issue 176 asks to fix. Vendoring these two-encode
WebP pairs directly is issue 176's own explicit, dated instruction and a
narrow, stated exception to requirement 11's general rule — scoped to this
temporary placeholder set alone, reviewed here, and retired the day real
photography replaces it.

**Encoding.** Each row below is fetched once at `3840x2160` (4K, 16:9) from
`https://picsum.photos/seed/<seed>/3840/2160`, then re-encoded locally to two
WebP derivatives — `*-full.webp` (long edge 3840px, ~q82) for the enlarged
view and `*-preview.webp` (long edge 1280px, ~q78) for the single visible
feed frame — stripping all EXIF/metadata in the process. Total vendored
weight: 5.8 MB across 16 files, every `*-full.webp` under 1.1 MB.

| File pair | Seed | Fixed-seed source URL | Picsum photo id (resolved) |
| --- | --- | --- | --- |
| `gallery-01-full.webp` / `gallery-01-preview.webp` | `naranjo-gallery-01` | <https://picsum.photos/seed/naranjo-gallery-01/3840/2160> | 372 |
| `gallery-02-full.webp` / `gallery-02-preview.webp` | `naranjo-gallery-02` | <https://picsum.photos/seed/naranjo-gallery-02/3840/2160> | 904 |
| `gallery-03-full.webp` / `gallery-03-preview.webp` | `naranjo-gallery-03` | <https://picsum.photos/seed/naranjo-gallery-03/3840/2160> | 916 |
| `gallery-04-full.webp` / `gallery-04-preview.webp` | `naranjo-gallery-04` | <https://picsum.photos/seed/naranjo-gallery-04/3840/2160> | 436 |
| `gallery-05-full.webp` / `gallery-05-preview.webp` | `naranjo-gallery-05` | <https://picsum.photos/seed/naranjo-gallery-05/3840/2160> | 411 |
| `gallery-06-full.webp` / `gallery-06-preview.webp` | `naranjo-gallery-06` | <https://picsum.photos/seed/naranjo-gallery-06/3840/2160> | 405 |
| `gallery-07-full.webp` / `gallery-07-preview.webp` | `naranjo-gallery-07` | <https://picsum.photos/seed/naranjo-gallery-07/3840/2160> | 490 |
| `gallery-08-full.webp` / `gallery-08-preview.webp` | `naranjo-gallery-08` | <https://picsum.photos/seed/naranjo-gallery-08/3840/2160> | 153 |

Each seed is fixed, so re-fetching the same URL reproduces the same source
photograph — the eight ids above are the verifiable record of which
photograph each row names, captured 2026-08-25.
