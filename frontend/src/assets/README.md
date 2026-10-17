# Small build-time assets only

This tree is for small, version-controlled UI material that belongs in the
Svelte build: `images/` for lightweight interface artwork, `audio/` and
`video/` for tiny component-local cues only, `icons/` for interface symbols,
and `fonts/` for reviewed webfonts and licenses. Large photographs, FLAC files,
source video, and delivery derivatives never belong here because Vite would
copy them into the frontend, Go would embed them, and the OCI image would
inherit their size and lifecycle. Those assets use the logical `/media/...`
contract from `src/lib/media.ts` and remain on the separately managed,
read-only data volume described by ADR 0012.

## Made here, so nothing to license

The Keep's surfaces (owner direction, 2026-10-16) carry no third-party
material. `images/keep/parchment.jpg` (3,477 bytes) is the light sheet's paper,
generated locally from seeded noise; `images/frame/rampart.svg` is the frames'
pixel pattern, drawn for this page; the night sky behind the sheet is drawn in
code (`src/lib/sky.ts`) and ships no image at all.

The picture bands and their `textures/` directory are gone (owner direction,
2026-10-16: "remove the stock image from this only leave it with my name"),
the citadel painting with them — its licence was never verified, and the four
Unsplash photographs before it had stopped being shown. They remain in the
repository's history.
