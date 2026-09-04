# Band textures — sources and licence

Owner directive, 2026-09-03 (issue 287, the Ledger redesign): the page opens
and closes on a texture band, and the band's picture follows the reading mode.
One per mode since 2026-09-04 (issue 292): the owner cut the cycle box, and the
second picture of each pair left with the only control that could reach it.

**Provenance.** Four photographs from the owner's own wallpaper library,
originally downloaded from Unsplash. They are vendored here rather than
fetched, because requirement 1 keeps this frontend local-origin-only: nothing
on this page reaches a CDN at run time.

**Licence.** Unsplash photography under the Unsplash Licence: free to use,
commercially or not, with no permission needed and no attribution required.
That is what was verified for this set; nothing more is claimed.

**Encoding.** Each file is re-encoded locally to a wide crop (1400–1600px on
the long edge, roughly 4:1, the band's own proportion) at JPEG quality ~80,
with all EXIF/metadata stripped. Total vendored weight: 285,782 bytes (286 KB)
across four files, the largest 83 KB — inside the small-asset ceiling this
tree's own README states, and a fraction of one gallery derivative.

| File | Reading mode | Original |
| --- | --- | --- |
| `light-spikes.jpg` | light | abstract-purple-and-gold-wavy-forms-with-spiked-chain.jpg (owner pick, 2026-09-03) |
| `dark-refraction.jpg` | dark | transparent-blue-curved-shapes-with-light-refraction-against-a-black.jpg (owner pick, 2026-09-03) |
| `slate-fluid.jpg` | slate | fluid-ink.jpg |
| `sepia-galaxy.jpg` | sepia | galaxy.jpg |

Which file a reading mode shows is decided in `src/lib/textures.ts`, never
here and never in a component: this file is provenance, that one is the
mapping, and the band component knows only the list it is handed. Swapping a
mode's picture is one file and one line there; the retired pictures
(`light-plaster`, `dark-wave`, `slate-stars`, `sepia-eclipse`) remain in the
repository's history should the owner want one back.
