# Third-party content attribution

## JetBrains Mono webfont

The site's figure typeface is [JetBrains Mono](https://www.jetbrains.com/lp/mono/),
copyright 2020 The JetBrains Mono Project Authors, used under the SIL Open
Font License 1.1. The license text ships beside the font files as
`frontend/src/assets/fonts/OFL.txt`, per this repository's webfont
convention. The four `.woff2` files are the variable face (weights 100–800,
upright and italic) split into the latin and latin-ext character ranges, as
compiled and subset by the Google Fonts pipeline from the same OFL sources
(fonts.gstatic.com, jetbrainsmono v24); they are vendored here so the page
serves them from its own origin and no visitor request ever leaves it.

Figures, labels, hashes and dates are still set in it. Everything a person
READS is set in Archivo, below.

## Archivo webfont

The ledger's reading face (owner directive, 2026-09-03, issue #287) is
[Archivo](https://fonts.google.com/specimen/Archivo), copyright The Archivo
Project Authors, used under the SIL Open Font License 1.1 — the same licence
and the same convention as the mono face above. The licence text ships beside
the files as `frontend/src/assets/fonts/OFL-Archivo.txt`. The two `.woff2`
files are the variable face carrying BOTH of its axes — weight 100–900 and
width 62–125% — split into the latin and latin-ext character ranges by the
Google Fonts pipeline from the same OFL sources (fonts.gstatic.com), and
vendored here for the same reason: requirement 1 keeps this frontend
local-origin-only, so no visitor request may leave the origin to fetch a
letterform. Two axes in two files is what lets the masthead be set at 900 and
the prose at 400 with no second download.

## Band textures

The eight photographs under `frontend/src/assets/textures/` — two per reading
mode, cycled by the arrows on the band — are the owner's own wallpaper
library, originally from Unsplash and used under the Unsplash Licence. Their
provenance, licence, encoding recipe and exact vendored weight are recorded
beside the files in `frontend/src/assets/textures/SOURCES.md`, which is the
document a reviewer should read: it states what was verified and claims
nothing beyond it.

## Old School RuneScape boss icons

The images under `frontend/src/assets/icons/bosses/` are small downscaled
thumbnails of Old School RuneScape artwork, sourced from the
[Old School RuneScape Wiki](https://oldschool.runescape.wiki/) — thanks to
the wiki community for hosting and curating them. The underlying artwork is
Jagex intellectual property, used on this personal, non-commercial site as
fan content:

> Created using intellectual property belonging to Jagex Limited under the
> terms of Jagex's Fan Content Policy. This content is not endorsed by or
> affiliated with Jagex.

### The reviewed batch (2026-08-20, issue #78)

The panel serves every row the hiscores report, and the icon set covers all of
them: **71 boss icons, 404,452 bytes in total**. Six were already vendored and
are unchanged; that batch added the other 65 (369,141 bytes). Every file is the
wiki's own thumbnail bytes, unmodified — nothing was re-encoded, recoloured, or
cropped — so any reviewer can re-derive the exact bytes.

**The skills directory is retired (2026-09-03, issue #287.)** The batch also
vendored 25 skill icons (5,673 bytes), for a levels grid the owner has since
cut. They are deleted rather than kept: this document's own rule is that
third-party art must never outlive the data that justifies it, and art nothing
renders is art nothing justifies. Re-vendoring them is the same recipe below,
against the wiki's `<Skill> icon.png` files at their native size.

**How each file was derived.** Boss icons come from the lead image of the
wiki page named by the hiscores row, requested through the MediaWiki API at
`pithumbsize=52`. Each file is named by the slug of the data name it serves
(`bossSlug` in `frontend/src/lib/bossIcons.ts`), and a frontend test holds the
set to exactly the rows the origin serves — in both directions, so a missing
icon and an orphaned one both fail.

Twenty-three boss rows do not name their own wiki file, and each is recorded
here rather than left to be rediscovered:

| Hiscores row | Wiki file |
| --- | --- |
| Abyssal Sire | `Abyssal_Sire_(phase_1).png` |
| Alchemical Hydra | `Alchemical_Hydra_(serpentine).png` |
| Barrows Chests | `Chest (Barrows).png` |
| Chambers of Xeric: Challenge Mode | `Chambers of Xeric logo.png` |
| Crazy Archaeologist | `Crazy_archaeologist.png` |
| Deranged Archaeologist | `Deranged_archaeologist.png` |
| Grotesque Guardians | `Dawn.png` |
| Kree'Arra | `Kree'arra.png` |
| Lunar Chests | `Lunar_Chest_(closed).png` |
| Mad Angel | `Mad Angel.png` |
| Mimic | `Mimic_detail.png` |
| Nightmare | `The_Nightmare.png` |
| Phosani's Nightmare | `The_Nightmare.png` |
| Phantom Muspah | `Phantom_Muspah_(ranged).png` |
| Shellbane Gryphon | `Shellbane_gryphon.png` |
| The Gauntlet | `Crystalline Hunllef.png` |
| The Corrupted Gauntlet | `Corrupted Hunllef.png` |
| The Royal Titans | `Eldric_the_Ice_King.png` |
| Theatre of Blood: Hard Mode | `Theatre of Blood logo.png` |
| Thermonuclear Smoke Devil | `Thermonuclear_smoke_devil.png` |
| Tombs of Amascut: Expert Mode | `Tombs_of_Amascut.png` |
| Wintertodt | `Wintertodt icon.png` |
| Zalcano | `Zalcano_(weakened).png` |

Four of those are judgement calls worth stating plainly: a raid's challenge
or expert mode shares the base raid's artwork because the wiki has no
separate image for it; Grotesque Guardians and The Royal Titans are pairs, so
one of the two is shown; Phosani's Nightmare shares The Nightmare's image for
the same reason; and Wintertodt uses the wiki's own 25px interface icon
because its lead image is an animation, not a PNG.

The initials fallback stays in the component regardless of how complete this
set is: Jagex ships new bosses, and a row with no icon yet must render as a
designed state rather than a hole. Widening the set remains an owner
decision, taken one reviewed batch at a time.

## RuneLite-style panel chrome

The site's side rail recreates the look of the RuneLite client's side panel
purely in CSS from RuneLite's published palette values (RuneLite is
BSD-2-Clause open source). Color values are facts; no RuneLite artwork,
sprites, or logo — a registered trademark — are included in this repository.
RuneLite ships skill icons of its own under
`runelite-client/src/main/resources/skill_icons/`; they were deliberately not
used then and are not used now, so this boundary stays true and all game art in
this repository has one source and one licence story.
