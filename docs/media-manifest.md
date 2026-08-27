# The gallery manifest — `gallery/v1`

The gallery's items are runtime data. Publishing a photograph or a film is an
operator copying files onto the media volume: no commit, no CI run, no
release, and no validation gate beyond the origin's own runtime defences
(issue #182, item 4). This document is the contract that makes that possible
— what the volume carries, what the frontend will accept, and what happens
when none of it is there.

Nothing in this document asserts that media is enabled anywhere. It is not:
`chart/values.yaml` ships `media.enabled: false`, and turning it on needs
ADR 0012's storage evidence and the platform lane's provisioning receipt for
the claim. What is prepared is the shape of the thing; enablement is a
separate, later, reviewed step.

## Where it lives

Two publication classes, and the split is the whole cache design:

| | class | URL shape | cache | who uses it |
| --- | --- | --- | --- | --- |
| the manifest | mutable | `/media/mutable/gallery/manifest.json` | `no-store`, no validator | the frontend, once per page load |
| every file it names | immutable | `/media/immutable/<sha256>/<path>` | long-lived, immutable | the browser, per picture and per film |

A manifest is replaced in place, so it must never be cached and must never
answer a stale `304` — the origin serves the mutable class `no-store` with a
zeroed modification time precisely because an atomic replacement can preserve
both size and timestamp. Content files are the opposite: their URL carries
their own SHA-256, so one URL can only ever mean one set of bytes, and the
browser may keep them forever.

That is why every file object in the manifest carries a `sha256` beside its
path. The digest is not metadata about the file; it is half of the file's
address.

Paths are volume-relative and the frontend never concatenates one by hand:
`frontend/src/lib/media.ts` is the only place a media URL is built, and it
refuses reserved operator namespaces (`originals`, `staging`, `metadata`,
`manifests`, `checksums`, `internal`, `lost+found`), traversal, hidden and
underscore-prefixed segments, and anything outside a canonical ASCII
segment. A path that cannot produce a URL refuses the item that named it.

## The document

```json
{
  "schema": "gallery/v1",
  "items": [
    {
      "kind": "image",
      "key": "harbour-at-dusk",
      "alt": "What the photograph shows, in the operator's own words",
      "full":    { "path": "gallery/harbour-full.webp",    "sha256": "<64 hex>", "width": 3840, "height": 2160 },
      "preview": { "path": "gallery/harbour-preview.webp", "sha256": "<64 hex>", "width": 1280, "height": 720 },
      "title": "Harbour at dusk",
      "description": "One paragraph, optional.",
      "link": { "href": "https://example.org/series", "label": "The full series" }
    },
    {
      "kind": "video",
      "key": "harbour-in-motion",
      "alt": "What the film shows",
      "full":    { "path": "gallery/motion-still.webp",   "sha256": "<64 hex>", "width": 3840, "height": 2160 },
      "preview": { "path": "gallery/motion-preview.webp", "sha256": "<64 hex>", "width": 1280, "height": 720 },
      "poster":  { "path": "gallery/motion-poster.webp",  "sha256": "<64 hex>", "width": 3840, "height": 2160 },
      "sources": [
        { "path": "gallery/motion-2160.mp4", "sha256": "<64 hex>", "type": "video/mp4; codecs=\"hvc1\"", "height": 2160 },
        { "path": "gallery/motion-1080.mp4", "sha256": "<64 hex>", "type": "video/mp4", "height": 1080 }
      ]
    }
  ]
}
```

The `schema` string is a pin, not a version hint: a breaking change to what an
item MEANS mints `gallery/v2`, and this build refuses its successor outright
rather than half-reading it. That is the same rule the panel envelope lives
by (`panel/v1`).

## What the frontend accepts

Admission is by MEMBERSHIP, never by shape-guessing — the idiom
`frontend/src/lib/panels.ts` and `frontend/src/lib/token-usage.ts` already
use. The complete rule set, as implemented in
`frontend/src/lib/galleryManifest.ts` and exercised by
`frontend/tests/gallery-manifest.test.mjs`:

**The document**

- `schema` must equal `gallery/v1` exactly.
- `items` must be an array of at most 120 entries.
- The response is read with a hard cap of 65536 bytes and the transfer is
  CANCELLED the moment it goes over. Bytes that are not valid UTF-8 are a
  fault, not a document.
- A failure at this level refuses the whole document.

**Each item** — a failure here refuses THAT ITEM and nothing else, so one bad
row costs one row.

- Every object is a CLOSED shape: a key this contract does not name refuses
  the object. Growth happens in `gallery/v2`.
- `kind` must be `image` or `video`. An unknown kind refuses the item, never
  the document.
- `key` is a render identity, never displayed and never a URL: at most 128
  characters, opening with an alphanumeric, otherwise alphanumerics, `.`,
  `_`, `~` and `-`. Two rows claiming one key: the first keeps it.
- `alt` is required and non-empty, at most 500 characters.
- `full` and `preview` are required file objects: `path`, `sha256` (64
  lowercase hex), `width` and `height` (whole numbers, 1 to 100000).
- `kind: image` must carry NEITHER `poster` nor `sources`.
- `kind: video` must carry `sources`: one to three entries of `path`,
  `sha256`, `type` and `height`, in the operator's own preference order.
  `poster` is optional; without one the large still is the poster.
- A source `type` must be `video/mp4` or `video/webm`, optionally with a
  single `codecs="…"` parameter over a narrow character set. Those two are
  the video rows of the origin's own reviewed media types — offering the
  browser a type the origin will not send is a promise the page cannot keep.
  ONE unusable rung refuses the whole ladder rather than being dropped:
  quietly deleting a rung changes which rendition a reader receives with
  nobody saying so.
- `title` (160), `description` (800) and `link` are each independently
  optional, and absent means absent — nothing renders, nothing is reserved.
  A `link` carries `href` and `label` together, and the `href` must parse as
  an absolute `https:` URL. It is parsed, not prefix-matched, so
  `javascript:`, `data:`, and every whitespace or case trick around them are
  refused the way the browser would resolve them.

## What happens when it is not there

`loadGalleryManifest` answers `null` — one answer for every failure, because
the caller's response to all of them is identical:

- media disabled in the chart, so the route serves nothing;
- no manifest published (404);
- the origin at its transfer ceiling (503);
- a network fault;
- a body that is not JSON, is not UTF-8, or exceeds the byte cap;
- a document of the wrong schema;
- a manifest that yields no usable item — including a well-formed empty one.

In every one of those cases the Art block keeps rendering the vendored
bootstrap set the build shipped with (`frontend/src/lib/gallery.ts`, files
under `frontend/src/assets/images/gallery/` with provenance in their
`SOURCES.md`). That is issue #182's sanctioned explicit offline fallback, and
it is the honest-states floor in its simplest form: the reader sees a gallery,
because a gallery is a true thing to show. No error state, no spinner, no
empty frame, no invented row.

What is reported, and where, is deliberately narrow. A refused ITEM and a
malformed, oversized or undecodable DOCUMENT are written to the browser
console, where a developer will find them. An ordinary absence — a `404`
because nothing is published, or a route that is not serving because media is
off — is NOT: the browser already logs that request failure itself, and a
second line saying the same thing would be noise a reader can see in a
devtools panel and a developer learns to ignore.

Both were observed against a real binary: with a manifest live, two of four
rows admitted and two console warnings for the refused pair; with media
disabled, the vendored eight rendering, zero media URLs requested, and the
browser's own 404 line as the only console output. The frame's measured box
was byte-identical between the two runs and the page reported a cumulative
layout shift of 0 across the swap.

There is no layout shift between the two sets. The frame's reserved box comes
from the shared `--card-media-*` tokens and is identical for every item; the
manifest's `width`/`height` are the element's intrinsic-size HINT, not the
reservation. The vendored set therefore renders before any request exists, and
a live manifest replaces its CONTENT without moving its box.

## Publishing, from the operator's side

The volume's directory layout IS the URL layout — the origin resolves a
request path directly inside the delivery root, so the class and the digest
are real directory levels, not a rewrite:

```text
<volume root>/
  mutable/
    gallery/
      manifest.json
  immutable/
    <sha256 of the file>/
      gallery/
        <file>
```

1. Produce the renditions on the workstation (never on the host, and never
   from inside this repository — originals never enter it).
2. Compute each file's SHA-256.
3. Place each file at `immutable/<its digest>/<its manifest path>`, outside
   every reserved namespace. A file is stored once, under its own digest;
   re-encoding it produces a different digest and therefore a different
   directory, which is what makes the immutable cache safe. Hard links are
   refused by the origin, so each publication is a real copy.
4. Write the manifest and move it into place atomically, LAST, so a reader
   never sees a manifest naming a file that has not landed.

Removing a file is the same operation in reverse: take it out of the manifest
first, then delete it. Nothing here touches git, CI, or a release — that is
the entire point of the design.

Everything about the volume's own provisioning — where it comes from, how it
is backed up, how the operator reaches the host — is deliberately outside this
repository (requirement 12). This document describes only what the origin
serves and what the frontend accepts.

## The manifest's content type

`.json` IS among the origin's reviewed media types (`mediaTypes`,
`internal/server/types.go`), so the media route serves the manifest as
`application/json`. It was briefly not: an earlier revision of this document
recorded the octet-stream-with-attachment treatment as a known cosmetic gap
and declined to widen the table as a side effect. Composing this change with
the rest of the wave made it a deliberate edit rather than a side effect, and
typing a JSON document as an opaque download was simply the wrong answer, so
the row landed with its own row in `TestMediaMIMETypes` — the conscious edit
`AGENTS.md` sanctions.

Nothing about admission changed. `application/json` is not active browser
content; every media response still carries `X-Content-Type-Options: nosniff`,
asserted beside the type in the same test; every other extension the origin
has not reviewed still serves as `application/octet-stream` with an attachment
disposition, which is the fail-closed default this row is an exception to and
not a relaxation of.

The frontend does not depend on the served type either way: the loader reads
the response body as bytes and parses the text itself, precisely so the byte
cap applies to the transfer. What changes is what a human sees — opening the
manifest URL directly now renders the document instead of offering a download.
