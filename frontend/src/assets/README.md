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

## The Keep's surfaces

The sheet is a castle wall (owner direction, 2026-10-19). Its two tiles,
`images/keep/wall-night.webp` (113,926 bytes) and `images/keep/wall-day.webp`
(60,650 bytes), are derived from ONE third-party photograph, credited with its
licence in the repository's `ATTRIBUTION.md`: cropped, made seamless, sharpened
by local contrast, drawn at 2160x1440 for a 1440x960 tile and toned once dark
and once pale. The frame,
`images/frame/castle.svg`, is castle stone drawn in pixels for this page, and
so are the ivy and grass on it (`images/frame/ivy-*.svg`,
`images/frame/grass-*.svg`) and the props on the sheet (`images/props/`: the
vine, branch and twig that stand in for rules, the sword whose blade is a
share, the iron ring a role opens from and the roller of the scroll it unrolls
as, the calendar's five stones, bare to mossy, and the stone's grain the
torches' light falls through); none carries third-party material. The sky
behind the sheet and the torches' fire, sparks and lit dust are drawn in code
(`src/lib/sky.ts`, `src/lib/fire.ts`) and ship no image at all.

The picture bands and their `textures/` directory are gone (owner direction,
2026-10-16: "remove the stock image from this only leave it with my name"),
the citadel painting with them — its licence was never verified, and the four
Unsplash photographs before it had stopped being shown. They remain in the
repository's history.
