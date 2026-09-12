# Organisation marks — sources and terms

Owner ruling, 2026-09-12 (issue 326): the Professional Experience rows wear the
real marks of the organisations they name — "LinkedIn style … they all have to
be uniform so square may be the best way" — in place of the two-letter
monograms issue 313 drew. Four files, one per role, ~10 KB for the whole set.

**Why they are vendored.** The origin serves `default-src 'self'`, so an
external image cannot load at all: a mark on this page is a file in this
repository or it is nothing. These four are a narrow, dated exception to
requirement 11's general rule in the same sense the gallery's placeholders and
Rime's flight sheet are — bounded to these four small tiles, reviewed here, and
pinned by `tests/sections.test.mjs`, which allows exactly the files the work
entries name and nothing else.

**Terms, plainly and without legal advice.** The Panasonic wordmark carries an
explicit public-domain licence, quoted below. The other three are each
organisation's own published mark, reproduced here unaltered (beyond scaling)
to identify the organisations this page's author actually worked for or
attended — nominative, identifying use. None of these organisations has granted
a licence, and every mark remains its owner's trademark. UMBC additionally
publishes a usage rule, quoted below, which these tiles comply with.

**What was done to each file.** Nothing was traced, redrawn, recoloured or
generated. Each source was fetched once, cropped to its own alpha bounding box
so the fit measures the mark rather than the transparent padding the file
shipped with, scaled proportionally (Lanczos) into an inner box of 80 % of the
tile, and centred on a flat `#faf9f5` square — the site's own paper. No border
is baked in: the hairline a reader sees is the stylesheet's, the same rule the
rest of the sheet is drawn with. Each tile is 96 × 96 px, 8-bit palette PNG,
written at the smaller of an RGB and a 256-colour encoding. A 96 px file in a
28 px box is the mark still resolving on a 3× display.

| File | Bytes | Mark inside the tile | Origin |
| --- | --- | --- | --- |
| `panasonic.png` | 1,630 | 77 × 12 | Wikimedia Commons, `File:Panasonic_logo.svg` (rendered at 960 px by Wikimedia's own server) |
| `fathom5.png` | 1,575 | 77 × 77 | Fathom5's own site, the `apple-touch-icon` circle mark on brand navy |
| `ontrajectory.png` | 3,300 | 77 × 77 | OnTrajectory's own site, the square monogram it serves as its browser icon |
| `umbc.png` | 3,557 | 67 × 77 | UMBC Brand and Style Guide, the standalone colour shield for light backgrounds |

## Panasonic Avionics Corporation — `panasonic.png`

The Panasonic wordmark, from Wikimedia Commons
(<https://commons.wikimedia.org/wiki/File:Panasonic_logo.svg>).

**Licence, quoted from the Commons file page:** public domain — *"This logo
image consists only of simple geometric shapes or text. It does not meet the
threshold of originality needed for copyright protection."* Tagged
`PD-textlogo`, with the note that under Japanese copyright law *"Logos composed
merely of geometric shapes and texts are also not copyrightable in general."*
The same page carries a trademark warning: *"This work includes material that
may be protected as a trademark in some jurisdictions."*

Panasonic Avionics' own site publishes a lock-up setting the subsidiary's full
name in a generic grotesque; at 8.7:1 it is illegible in a square tile, and it
is not the Panasonic brand wordmark, so the recognisable mark won. The
wordmark is wide by nature — 77 × 12 px inside a 96 px tile — which is what a
wordmark in a square looks like on this row and on any other site that squares
one.

## Fathom5 — `fathom5.png`

The circle mark on brand navy (`#E4ECEE` on `#1B2747`), from the company's own
site, used unaltered. Fathom5's two published vector assets are drawn only in a
near-white ghost ink for a dark ground and would be invisible on this paper; no
dark variant is published, and recolouring a trademark was rejected in favour
of shipping the official bytes the company itself ships for light surroundings.

## OnTrajectory — `ontrajectory.png`

The lime `#dbe247` monogram OnTrajectory serves as its own light-background
browser icon, used unaltered.

**Known limit:** `#dbe247` on `#faf9f5` is roughly 1.3:1, so this tile reads
paler than the other three. The shape is thick enough to hold, and the colour
is the brand's own, so it has not been darkened — a recoloured mark would be a
different mark. The full lock-up (monogram plus wordmark) has better contrast
but sets the wordmark ~12 px tall in a 96 px tile, which is worse in the box
this page actually draws.

## University of Maryland, Baltimore County — `umbc.png`

The official standalone Maryland-flag shield, colour variant for light
backgrounds, from the UMBC Brand and Style Guide
(<https://styleguide.umbc.edu/graphic-elements/>). No wordmark, no Retriever.

**Usage rule, quoted from that guide:** *"The UMBC shield can be used as a
graphic element, but should not be used in a way that adds elements to the
shield, distorts it in any way, and/or changes the colors."* These tiles scale
it proportionally and add nothing, so they comply. The social-media variant
published beside it carries an opaque grey background that would stamp a grey
block onto the paper tile; the transparent shield is what is vendored here.
