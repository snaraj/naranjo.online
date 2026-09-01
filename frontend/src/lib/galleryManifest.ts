/* gallery/v1 — the runtime contract between the operator's media volume and
 * this frontend (issue 182's cutover, issue 207).
 *
 * WHY A MANIFEST AT ALL. The gallery's items are RUNTIME data, not build
 * data: publishing a photograph or a film is an operator copying files onto
 * the media volume, with no git commit, no CI run, and no release. Something
 * has to tell the page what is there, and it cannot be the bundle — the
 * bundle is exactly what publishing must not touch. So the volume carries its
 * own index, this module reads it, and the shipped build learns about media
 * that did not exist when it was built.
 *
 * WHAT IT IS NOT. It is not a general data feed and it is not trusted input.
 * Every rule below exists because a file on a mounted volume is one operator
 * mistake — or one bad day — away from being attacker-shaped, and the page
 * must degrade rather than obey. Concretely:
 *
 *   - the document is fetched from the MUTABLE media class, whose responses
 *     the origin serves `no-store` with no validator, so a replaced manifest
 *     is never masked by a stale 304;
 *   - every CONTENT file is addressed through the IMMUTABLE class instead,
 *     which is why each file object carries its own sha256: the digest is the
 *     cache identity, so one URL can only ever mean one set of bytes;
 *   - every URL is built by lib/media.ts and nothing else, so reserved
 *     operator namespaces, traversal, and hidden segments are refused by the
 *     same validator the origin's own 404 policy mirrors;
 *   - the fetch is byte-capped and cancelled the moment it goes over, so an
 *     enormous or endless response costs a bounded read rather than the tab;
 *   - admission is by MEMBERSHIP, never by shape-guessing — the idiom
 *     lib/panels.ts and lib/token-usage.ts already use. A closed set of kinds,
 *     a closed set of media types, a closed set of keys per object. An
 *     unknown `kind` refuses THAT ITEM, never the document, because one
 *     unreadable row must not blank a gallery.
 *
 * WHAT HAPPENS WHEN IT IS ABSENT is the honest half, and it is deliberately
 * boring: nothing. `loadGalleryManifest` answers null for a disabled media
 * subsystem, a 404, a malformed document, and a document that yields no
 * usable item alike, and the caller keeps rendering the vendored bootstrap
 * set it was built with (issue 182's sanctioned explicit offline fallback).
 * No error state, no empty frame, no invented row — the reader sees the
 * gallery the build shipped, which is a true thing to show. */

import { mediaUrl } from './media.ts';

/* The schema pin. Like the panel envelope, this outer identity is stable by
 * design: a breaking change to what an item means mints gallery/v2 and this
 * module refuses gallery/v1's successor rather than half-reading it. */
export const galleryManifestSchema = 'gallery/v1';

/* Where the document lives, volume-relative, in the mutable class. The
 * gallery/ prefix is the operator's own directory; `manifest.json` sits
 * inside it rather than under the reserved `manifests/` namespace precisely
 * BECAUSE that namespace is operator-only and the origin serves nothing from
 * it — this document is public by design, the files it indexes are public,
 * and anything genuinely internal stays behind the reserved names. */
export const galleryManifestPath = 'gallery/manifest.json';

/* Bounds. Every one of these is a refusal threshold, not a target: a document
 * over any of them is treated as absent rather than truncated, because half a
 * gallery is a lie about what was published. The byte cap is generous for
 * hundreds of items of JSON and small enough that a hostile or corrupt
 * response cannot cost more than one bounded read. */
export const maxGalleryManifestBytes = 65536;
export const maxGalleryManifestItems = 120;
/* One video item may offer at most this many renditions. The browser picks
 * the first source it can play, so the list is a preference ladder (typically
 * a high-efficiency 4K rung, a universal 1080p floor, and nothing else). */
export const maxGalleryVideoSources = 3;
/* Text bounds. Prose that exceeds them is a manifest fault, not a long
 * caption, and refusing the item is cheaper than discovering a megabyte of
 * "alt text" inside the accessibility tree. */
export const maxGalleryTextLengths = {
  key: 128,
  alt: 500,
  title: 160,
  description: 800,
  set: 40,
  label: 160,
  href: 512
} as const;

/* The kinds an item may declare. Membership, and the whole point of the set:
 * a kind this build cannot render is refused rather than guessed at. */
const galleryKinds: ReadonlySet<string> = new Set(['image', 'video']);

/* The base media types a video source may declare. These mirror the video
 * rows of `mediaTypes` in internal/server/types.go — the origin serves those
 * bytes with those exact types, and offering the browser a type the origin
 * will not send is a promise this page cannot keep. Adding a rung here is a
 * conscious edit on BOTH sides, the same way a new MIME type is. */
const galleryVideoBaseTypes: ReadonlySet<string> = new Set(['video/mp4', 'video/webm']);

/* A `type` may carry the codecs parameter, and that is not decoration: the
 * whole reason to list several MP4 sources is so the browser can tell a
 * high-efficiency rung from the universal one and pick the first it can
 * actually decode. Without codecs it takes the first source unconditionally.
 * The parameter's charset is deliberately narrow — codec identifiers, dots,
 * commas, and spaces — so nothing else can ride into the attribute. */
const codecsParameter = /^codecs="[A-Za-z0-9.,\- ]{1,120}"$/;

/* A file's content digest, in the same canonical lowercase form the immutable
 * URL class and the origin's own validator use. */
const contentDigest = /^[0-9a-f]{64}$/;

/* An item key is an identity for the keyed render, never a URL and never
 * displayed. Narrow on purpose: it ends up in DOM attributes. */
const safeKey = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;

/* --- The admitted shapes -------------------------------------------------
 * Note what is NOT here: no path, and no digest. By the time an item leaves
 * this module its files are URLs, built by lib/media.ts, and a file whose
 * path or digest could not produce one never became an item at all. Nothing
 * downstream can therefore assemble a media URL of its own. */

export interface GalleryAsset {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

export interface GalleryVideoSource {
  readonly url: string;
  /* Verbatim from the manifest, already admitted: `video/mp4` or the same
   * with a codecs parameter. It becomes the <source type> attribute. */
  readonly type: string;
  readonly height: number;
}

/* An outbound destination an item may carry. Both halves travel together, so
 * nothing downstream invents label copy for a link it did not write. */
export interface GalleryManifestLink {
  readonly href: string;
  readonly label: string;
}

export interface GalleryItem {
  readonly kind: 'image' | 'video';
  readonly key: string;
  readonly alt: string;
  /* The large derivative — the still a reader enlarges to, and the frame a
   * video plays inside. */
  readonly full: GalleryAsset;
  /* The small derivative the single visible feed frame shows. */
  readonly preview: GalleryAsset;
  /* Video only, and optional even then: the frame the <video> element shows
   * before play. Absent is the ordinary case and costs the operator nothing —
   * galleryPosterAsset below decides what stands in, and saves publishing the
   * same image twice. */
  readonly poster?: GalleryAsset;
  /* Video only, in the manifest's own order: the browser takes the first it
   * can play, so order IS the preference and this module never reorders it. */
  readonly sources?: readonly GalleryVideoSource[];
  readonly title?: string;
  readonly description?: string;
  readonly link?: GalleryManifestLink;
  /* The named set this item belongs to (owner sketch, 2026-08-31, issue
   * 275): the Media block's dropdown groups items by this label, verbatim.
   * Optional and additive — an item without one falls into the kind-derived
   * default set downstream (image → Drawings, video → Videos), so every
   * manifest written before this field existed renders exactly as it did. */
  readonly set?: string;
}

/* --- Admission ----------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* Closed-shape enforcement, stated once. An object carrying a key this
 * contract does not name is refused rather than ignored: a key nobody
 * validates is a key nobody is thinking about, and gallery/v2 is how this
 * schema is allowed to grow. */
function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function admitText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    return null;
  }
  return trimmed;
}

/* A pixel dimension: a real, positive, whole number small enough to be a
 * picture. Non-integers, zero, negatives, NaN and Infinity all fail here
 * rather than reaching an attribute where they would read as a guess. */
function admitDimension(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 100000) {
    return null;
  }
  return value;
}

const assetKeys = ['path', 'sha256', 'width', 'height'] as const;

function admitAsset(value: unknown): GalleryAsset | null {
  if (!isRecord(value) || !hasOnlyKeys(value, assetKeys)) {
    return null;
  }
  const { path, sha256 } = value;
  const width = admitDimension(value.width);
  const height = admitDimension(value.height);
  if (
    typeof path !== 'string' ||
    typeof sha256 !== 'string' ||
    !contentDigest.test(sha256) ||
    width === null ||
    height === null
  ) {
    return null;
  }
  /* The one place a manifest path becomes a URL. mediaUrl throws on reserved
   * namespaces, traversal, hidden segments and non-canonical characters, and
   * a throw here refuses the file — which refuses the item — rather than
   * escaping to refuse the document. */
  try {
    return { url: mediaUrl({ kind: 'immutable', sha256, path }), width, height };
  } catch {
    return null;
  }
}

const sourceKeys = ['path', 'sha256', 'type', 'height'] as const;

function admitVideoType(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 200) {
    return null;
  }
  const [base, ...rest] = value.split(';');
  if (!galleryVideoBaseTypes.has(base.trim().toLowerCase())) {
    return null;
  }
  if (rest.length === 0) {
    return base.trim().toLowerCase();
  }
  if (rest.length !== 1 || !codecsParameter.test(rest[0].trim())) {
    return null;
  }
  return `${base.trim().toLowerCase()}; ${rest[0].trim()}`;
}

function admitVideoSource(value: unknown): GalleryVideoSource | null {
  if (!isRecord(value) || !hasOnlyKeys(value, sourceKeys)) {
    return null;
  }
  const type = admitVideoType(value.type);
  const height = admitDimension(value.height);
  if (type === null || height === null) {
    return null;
  }
  /* A source's path and digest are admitted by the same asset rule, with a
   * dimension pair the source itself does not carry — a rung declares only
   * its height, and the width follows the item's own box. */
  const asset = admitAsset({ path: value.path, sha256: value.sha256, width: height, height });
  if (asset === null) {
    return null;
  }
  return { url: asset.url, type, height };
}

const linkKeys = ['href', 'label'] as const;

function admitLink(value: unknown): GalleryManifestLink | null {
  if (!isRecord(value) || !hasOnlyKeys(value, linkKeys)) {
    return null;
  }
  const href = admitText(value.href, maxGalleryTextLengths.href);
  const label = admitText(value.label, maxGalleryTextLengths.label);
  if (href === null || label === null) {
    return null;
  }
  /* HTTPS only, parsed rather than prefix-matched. `javascript:` and `data:`
   * are the reason: a scheme check written as a substring test has been
   * bypassed by every trick from leading whitespace to embedded newlines, and
   * URL parsing settles the question the way the browser will. */
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') {
    return null;
  }
  return { href: parsed.href, label };
}

const itemKeys = [
  'kind',
  'key',
  'alt',
  'full',
  'preview',
  'poster',
  'sources',
  'title',
  'description',
  'link',
  'set'
] as const;

/* admitItem returns null for every item this build cannot render honestly.
 * The caller drops it and keeps the rest: one bad row must cost one row. */
export function admitGalleryItem(value: unknown): GalleryItem | null {
  if (!isRecord(value) || !hasOnlyKeys(value, itemKeys)) {
    return null;
  }
  const { kind } = value;
  if (typeof kind !== 'string' || !galleryKinds.has(kind)) {
    return null;
  }
  const key = admitText(value.key, maxGalleryTextLengths.key);
  const alt = admitText(value.alt, maxGalleryTextLengths.alt);
  if (key === null || !safeKey.test(key) || alt === null) {
    return null;
  }
  const full = admitAsset(value.full);
  const preview = admitAsset(value.preview);
  if (full === null || preview === null) {
    return null;
  }

  const item: {
    kind: 'image' | 'video';
    key: string;
    alt: string;
    full: GalleryAsset;
    preview: GalleryAsset;
    poster?: GalleryAsset;
    sources?: readonly GalleryVideoSource[];
    title?: string;
    description?: string;
    link?: GalleryManifestLink;
    set?: string;
  } = { kind: kind as 'image' | 'video', key, alt, full, preview };

  if (kind === 'video') {
    if (!Array.isArray(value.sources)) {
      return null;
    }
    if (value.sources.length < 1 || value.sources.length > maxGalleryVideoSources) {
      return null;
    }
    const sources: GalleryVideoSource[] = [];
    for (const candidate of value.sources) {
      const source = admitVideoSource(candidate);
      if (source === null) {
        /* One unplayable rung invalidates the LADDER, not just itself: the
         * browser picks by order, and silently deleting a rung would change
         * which rendition a reader gets without anybody saying so. */
        return null;
      }
      sources.push(source);
    }
    item.sources = sources;
    if (value.poster !== undefined) {
      const poster = admitAsset(value.poster);
      if (poster === null) {
        return null;
      }
      item.poster = poster;
    }
  } else if (value.sources !== undefined || value.poster !== undefined) {
    /* Closed shape, both ways: a still carrying video fields is a manifest
     * that means something this build does not understand. */
    return null;
  }

  /* The three optional metadata fields, absent-means-absent (issue 202's
   * contract, carried unchanged): an unreadable one refuses the item rather
   * than being quietly dropped, because a caption that vanishes is worse than
   * a picture that does. */
  if (value.title !== undefined) {
    const title = admitText(value.title, maxGalleryTextLengths.title);
    if (title === null) {
      return null;
    }
    item.title = title;
  }
  if (value.description !== undefined) {
    const description = admitText(value.description, maxGalleryTextLengths.description);
    if (description === null) {
      return null;
    }
    item.description = description;
  }
  if (value.link !== undefined) {
    const link = admitLink(value.link);
    if (link === null) {
      return null;
    }
    item.link = link;
  }
  /* The set label rides the same absent-means-absent contract as the three
   * fields above: an unreadable one refuses the item, because a picture
   * silently landing in the wrong dropdown group is a caption-level lie. */
  if (value.set !== undefined) {
    const set = admitText(value.set, maxGalleryTextLengths.set);
    if (set === null) {
      return null;
    }
    item.set = set;
  }
  return item;
}

/* parseGalleryManifest admits the DOCUMENT and returns the items that
 * survived. It throws only for a document that is not a gallery/v1 manifest
 * at all; a document whose rows are individually bad returns the good ones,
 * and returns an empty list when there are none. */
export function parseGalleryManifest(document: unknown): GalleryItem[] {
  if (!isRecord(document)) {
    throw new Error('gallery manifest must be a JSON object');
  }
  if (document.schema !== galleryManifestSchema) {
    throw new Error(`gallery manifest schema must be ${galleryManifestSchema}`);
  }
  if (!Array.isArray(document.items)) {
    throw new Error('gallery manifest must carry an items array');
  }
  if (document.items.length > maxGalleryManifestItems) {
    throw new Error(`gallery manifest declares more than ${maxGalleryManifestItems} items`);
  }
  const items: GalleryItem[] = [];
  const seen = new Set<string>();
  for (const candidate of document.items) {
    const item = admitGalleryItem(candidate);
    if (item === null) {
      console.warn('gallery manifest: refused an item that does not match gallery/v1');
      continue;
    }
    if (seen.has(item.key)) {
      /* Two rows claiming one identity would make the keyed render's choice
       * arbitrary; the first row keeps the key. */
      console.warn('gallery manifest: refused an item repeating an earlier key');
      continue;
    }
    seen.add(item.key);
    items.push(item);
  }
  return items;
}

/* --- Reading an admitted item -------------------------------------------- */

/* WHICH FILE STANDS IN FOR AN ABSENT POSTER, decided here beside the field
 * that declares one optional (issue 239). It is a pure read over an already
 * admitted item — no admission, no URL building, no I/O — and it lives in this
 * module rather than in the binding layer so the rule and the `poster?`
 * comment above cannot drift apart, and so it can be EXECUTED by a test
 * instead of described by one.
 *
 * The order is poster, then preview, and the second half is the fix. A
 * published poster wins, always: it is the one frame the operator chose. With
 * none, the stand-in is the PREVIEW derivative and no longer the full-size
 * still, because a poster is painted into a stage of a few hundred CSS pixels
 * and the still is a 4K master — on the volume's own film the two measure
 * ~86-91 KB against ~315 KB for the same visible frame. The old default was
 * defended as "the picture the lightbox would have shown anyway", and that
 * defence expired: enlarging is stills-only, so a film's full-size still is
 * never shown to anybody at any size, and the strip was paying 3.5x for a
 * rendition nothing else on the page uses.
 *
 * There is no third rung and no null: `preview` is required of every admitted
 * item, so this function always has an answer. */
export function galleryPosterAsset(item: GalleryItem): GalleryAsset {
  return item.poster ?? item.preview;
}

/* WHICH RUNG A VIEWPORT IS ALLOWED TO ASK FOR, decided here beside the ladder
 * that declares them (issue 241). The `sources` comment above is true and was
 * not enough: the browser takes the first source it can PLAY, and "can play"
 * is a question about codecs alone. So on every engine that decodes the
 * high-efficiency rung — WebKit and Gecko both do — a phone streamed the 4K
 * master into a box a few hundred CSS pixels wide, and the smallest rung on
 * the ladder was selected by nobody, ever. MEASURED on the live volume's own
 * film at 0.1.54: a 874 MiB 2160p file into a 242x136 box on an iPhone 13
 * viewport, with the 720p rung dead on the page.
 *
 * `media` on a <source> is the mechanism the resource selection algorithm
 * already has for this: a source whose media query does not match is SKIPPED
 * before its type is ever considered, so the ladder becomes two questions in
 * the right order — how big a rendition may this viewport ask for, then which
 * of the rungs that size can it decode.
 *
 * THE BREAKPOINTS ARE THE MANIFEST'S OWN NUMBERS, never a per-film literal.
 * Rungs are grouped by height, and each group above the SMALLEST is offered
 * from the viewport width at which the next smaller rung would start being
 * upscaled — that rung's own native width, derived from its height through
 * the item's declared aspect (`full`'s width and height, both admitted). For
 * a 3840x2160 item publishing 2160/1080/720 that reads: 720p is the floor and
 * carries no query at all, 1080p from 1280px, 2160p from 1920px. A phone gets
 * the floor, a laptop the middle rung, a large display the master.
 *
 * Two properties fall out of it and both are deliberate. The floor NEVER
 * carries a query, so some source always matches and a film can never become
 * unplayable by arithmetic. And every rung of one height carries the SAME
 * query, so codec fallback inside a size class is untouched — order still
 * decides which of two equally sized renditions a browser takes, which is the
 * rule the `sources` field already states.
 *
 * The answer is per-source and positional, so the caller can zip it against
 * `item.sources` without this module reordering anything. A still, or a film
 * whose rungs are all one height, gets undefined for every source: there is
 * nothing to choose between, and an unnecessary query is one more way for a
 * viewport to be told no. */
export function galleryVideoSourceMedia(item: GalleryItem): readonly (string | undefined)[] {
  const sources = item.sources;
  if (sources === undefined) {
    return [];
  }
  const heights = [...new Set(sources.map((source) => source.height))].sort((first, second) => first - second);
  /* The native width a rung of height H covers, through the item's own
     declared aspect. Rounded to a whole pixel because it becomes a media
     query, and a query is a number a reader could check by hand. */
  const nativeWidth = (height: number): number => Math.round((height * item.full.width) / item.full.height);
  return sources.map((source) => {
    const rung = heights.indexOf(source.height);
    if (rung < 1) {
      return undefined;
    }
    return `(min-width: ${nativeWidth(heights[rung - 1])}px)`;
  });
}

export type GalleryManifestFetcher = (url: string) => Promise<Response>;

/* The wrapper keeps fetch called as a plain global (never an unbound method)
 * and gives tests a seam without touching globals — the same seam
 * lib/panels.ts uses. */
const defaultFetcher: GalleryManifestFetcher = (url) => globalThis.fetch(url);

/* readCapped consumes at most `cap` bytes and CANCELS the body the moment the
 * response goes over, so an oversized or endless manifest costs a bounded
 * read rather than the tab. Decoding is fatal: bytes that are not UTF-8 are a
 * fault, not a document. */
async function readCapped(response: Response, cap: number): Promise<string> {
  const body = response.body;
  if (body === null) {
    throw new Error('gallery manifest response carried no body');
  }
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    bytes += chunk.value.byteLength;
    if (bytes > cap) {
      await reader.cancel();
      throw new Error(`gallery manifest exceeds ${cap} bytes`);
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

/* loadGalleryManifest performs exactly one same-origin request — no retries,
 * no backoff, no polling. A gallery does not change while a reader is looking
 * at it, and the honest answer to "the volume is not there" is the build's
 * own pictures, not a spinner that never resolves.
 *
 * null is the ONE failure answer, deliberately: media disabled, 404, network
 * fault, oversized body, malformed JSON, wrong schema, and a document whose
 * every row was refused are indistinguishable to the caller, because the
 * caller's response to all of them is identical — render what shipped. */
export async function loadGalleryManifest(
  fetcher: GalleryManifestFetcher = defaultFetcher
): Promise<GalleryItem[] | null> {
  const url = mediaUrl({ kind: 'mutable', path: galleryManifestPath });
  try {
    const response = await fetcher(url);
    if (!response.ok) {
      return null;
    }
    /* Read as bytes and parsed here rather than through response.json(),
       because the cap has to be applied to the TRANSFER, not to a body
       already in memory. That the loader is indifferent to the served
       content type falls out of it: the origin types the manifest
       application/json (`.json` is a reviewed media type — `mediaTypes`,
       internal/server/types.go), and this path would parse it the same way
       if it did not. Admission never depends on the header either way; see
       docs/media-manifest.md. */
    const items = parseGalleryManifest(JSON.parse(await readCapped(response, maxGalleryManifestBytes)));
    return items.length > 0 ? items : null;
  } catch (error) {
    /* Logged, not rendered (issue 179's rule for the panel loader): a visitor
     * gets the vendored set with no sign anything was attempted, and a
     * developer with a console open gets the reason. */
    console.error('gallery manifest failed to load', error);
    return null;
  }
}
