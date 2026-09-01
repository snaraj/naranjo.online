/* gallery/v1 admission and loading (issue 207).
 *
 * These run the real module against real Response objects, so the byte cap,
 * the cancellation, and the JSON decode are exercised rather than described.
 * Every refusal below is stated as a BEHAVIOUR — what a reader ends up
 * seeing — because that is what the contract promises: a bad row costs one
 * row, a bad document costs the whole document and the build's own pictures
 * stay on screen. */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  admitGalleryItem,
  galleryManifestPath,
  galleryManifestSchema,
  galleryPosterAsset,
  galleryVideoSourceMedia,
  loadGalleryManifest,
  maxGalleryManifestBytes,
  maxGalleryManifestItems,
  maxGalleryTextLengths,
  maxGalleryVideoSources,
  parseGalleryManifest
} from '../src/lib/galleryManifest.ts';
import { runtimeBlock } from '../src/lib/blocks.ts';

const digest = (marker) => marker.repeat(64).slice(0, 64);
const photoDigest = digest('a');
const previewDigest = digest('b');
const posterDigest = digest('c');
const filmDigest = digest('d');

const asset = (sha256, path, width = 3840, height = 2160) => ({
  path,
  sha256,
  width,
  height
});

const imageItem = (overrides = {}) => ({
  kind: 'image',
  key: 'harbour-at-dusk',
  alt: 'A photograph the operator described',
  full: asset(photoDigest, 'gallery/harbour-full.webp'),
  preview: asset(previewDigest, 'gallery/harbour-preview.webp', 1280, 720),
  ...overrides
});

const videoItem = (overrides = {}) => ({
  kind: 'video',
  key: 'harbour-in-motion',
  alt: 'A film the operator described',
  full: asset(photoDigest, 'gallery/motion-still.webp'),
  preview: asset(previewDigest, 'gallery/motion-preview.webp', 1280, 720),
  poster: asset(posterDigest, 'gallery/motion-poster.webp'),
  sources: [
    { path: 'gallery/motion-2160.mp4', sha256: filmDigest, type: 'video/mp4; codecs="hvc1"', height: 2160 },
    { path: 'gallery/motion-1080.mp4', sha256: digest('e'), type: 'video/mp4', height: 1080 }
  ],
  ...overrides
});

const manifest = (items) => ({ schema: galleryManifestSchema, items });

/* A silent console for the whole suite: the module logs a warning per refused
 * item and an error for a failed load, deliberately, and a test run should not
 * be a wall of expected noise. The calls are captured so a test can assert
 * that a refusal was actually reported rather than swallowed. */
let warnings;
let errors;
const realWarn = console.warn;
const realError = console.error;

beforeEach(() => {
  warnings = [];
  errors = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));
});

afterEach(() => {
  console.warn = realWarn;
  console.error = realError;
});

const respond = (body, init = {}) => new Response(body, { status: 200, ...init });
const jsonResponse = (document) => respond(JSON.stringify(document));

describe('gallery/v1 item admission', () => {
  it('turns an admitted still into immutable, digest-addressed URLs', () => {
    const item = admitGalleryItem(imageItem());
    assert.ok(item !== null);
    assert.equal(item.kind, 'image');
    assert.equal(item.full.url, `/media/immutable/${photoDigest}/gallery/harbour-full.webp`);
    assert.equal(item.preview.url, `/media/immutable/${previewDigest}/gallery/harbour-preview.webp`);
    assert.equal(item.preview.width, 1280);
    // A still carries no video machinery at all.
    assert.equal(item.poster, undefined);
    assert.equal(item.sources, undefined);
  });

  it('keeps a film’s source ladder in the manifest’s own order', () => {
    const item = admitGalleryItem(videoItem());
    assert.ok(item !== null);
    assert.deepEqual(
      item.sources.map((source) => source.type),
      ['video/mp4; codecs="hvc1"', 'video/mp4'],
      'the ladder must survive admission in the order it arrived — the browser picks the first it can play'
    );
    assert.equal(item.sources[0].url, `/media/immutable/${filmDigest}/gallery/motion-2160.mp4`);
    assert.equal(item.poster.url, `/media/immutable/${posterDigest}/gallery/motion-poster.webp`);
  });

  it('refuses a kind this build cannot render, and refuses it BY MEMBERSHIP', () => {
    for (const kind of ['audio', 'Image', 'image ', '', 'model/gltf', 3, null]) {
      assert.equal(admitGalleryItem(imageItem({ kind })), null, `kind ${JSON.stringify(kind)} must refuse the item`);
    }
  });

  it('refuses a still that carries video fields, and a film that carries none', () => {
    assert.equal(admitGalleryItem(imageItem({ sources: [] })), null);
    assert.equal(admitGalleryItem(imageItem({ poster: asset(posterDigest, 'gallery/p.webp') })), null);
    assert.equal(admitGalleryItem(videoItem({ sources: undefined })), null);
    assert.equal(admitGalleryItem(videoItem({ sources: [] })), null);
  });

  it('refuses a key this contract does not name — the shape is closed', () => {
    assert.equal(admitGalleryItem({ ...imageItem(), unexpected: 'value' }), null);
    assert.equal(admitGalleryItem(imageItem({ full: { ...asset(photoDigest, 'a.webp'), extra: 1 } })), null);
    assert.equal(
      admitGalleryItem(videoItem({ sources: [{ path: 'gallery/v.mp4', sha256: filmDigest, type: 'video/mp4', height: 1080, extra: 1 }] })),
      null
    );
  });

  it('refuses every path the Go origin hides, through lib/media.ts’s own validator', () => {
    // Not a second copy of the rule: the item is refused because building its
    // URL throws, so this contract can never drift from the URL contract.
    for (const path of [
      '../originals/master.mov',
      'gallery/originals/master.mov',
      'gallery/METADATA/notes.json',
      '.hidden/photo.webp',
      '_staging/photo.webp',
      'gallery\\photo.webp',
      ''
    ]) {
      assert.equal(admitGalleryItem(imageItem({ full: asset(photoDigest, path) })), null, `${path} must refuse the item`);
    }
  });

  it('requires a canonical lowercase digest on every file', () => {
    for (const sha256 of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'not-a-digest', 64, null]) {
      assert.equal(admitGalleryItem(imageItem({ preview: { ...asset(previewDigest, 'gallery/p.webp'), sha256 } })), null);
    }
  });

  it('refuses a dimension that is not a real, whole, positive pixel count', () => {
    for (const width of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1280', null, 100001]) {
      assert.equal(admitGalleryItem(imageItem({ preview: { ...asset(previewDigest, 'gallery/p.webp'), width } })), null);
    }
  });

  it('admits only media types the origin actually serves, codecs parameter included', () => {
    const withType = (type) =>
      admitGalleryItem(videoItem({ sources: [{ path: 'gallery/v.mp4', sha256: filmDigest, type, height: 1080 }] }));
    assert.ok(withType('video/mp4') !== null);
    assert.ok(withType('video/webm') !== null);
    assert.ok(withType('video/mp4; codecs="avc1.640028,mp4a.40.2"') !== null);
    for (const type of [
      'video/quicktime',
      'application/octet-stream',
      'text/html',
      'video/mp4; codecs="<script>"',
      'video/mp4; charset=utf-8',
      'video/mp4; codecs="avc1"; codecs="hvc1"',
      '',
      7
    ]) {
      assert.equal(withType(type), null, `${JSON.stringify(type)} must refuse the item`);
    }
  });

  it('refuses one bad rung by refusing the whole ladder — never by dropping it silently', () => {
    const item = videoItem({
      sources: [
        { path: 'gallery/good.mp4', sha256: filmDigest, type: 'video/mp4', height: 1080 },
        { path: 'gallery/originals/raw.mp4', sha256: digest('f'), type: 'video/mp4', height: 2160 }
      ]
    });
    assert.equal(
      admitGalleryItem(item),
      null,
      'silently deleting a rung would change which rendition a reader gets with nobody saying so'
    );
  });

  it('bounds the ladder at the documented rung count', () => {
    const rung = (n) => ({ path: `gallery/v${n}.mp4`, sha256: digest('a'), type: 'video/mp4', height: 1080 });
    const sources = Array.from({ length: maxGalleryVideoSources + 1 }, (_unused, n) => rung(n));
    assert.equal(admitGalleryItem(videoItem({ sources })), null);
    assert.ok(admitGalleryItem(videoItem({ sources: sources.slice(0, maxGalleryVideoSources) })) !== null);
  });

  it('carries optional metadata through unchanged, and refuses an unreadable one', () => {
    const item = admitGalleryItem(
      imageItem({
        title: '  Harbour at dusk  ',
        description: 'What the operator wrote about it.',
        link: { href: 'https://example.org/work/harbour', label: 'The full series' },
        set: '  OldSchool RuneScape  '
      })
    );
    assert.ok(item !== null);
    assert.equal(item.title, 'Harbour at dusk', 'surrounding whitespace is trimmed, the words are not touched');
    assert.equal(item.description, 'What the operator wrote about it.');
    assert.deepEqual(item.link, { href: 'https://example.org/work/harbour', label: 'The full series' });
    /* The set label rides the same trim (issue 275): it is the dropdown's
       verbatim entry, and two operators writing the same set with different
       padding must land in ONE group, not two. */
    assert.equal(item.set, 'OldSchool RuneScape');
    // Absent means absent: no empty string, no placeholder, no key at all.
    const bare = admitGalleryItem(imageItem());
    assert.equal('title' in bare, false);
    assert.equal('description' in bare, false);
    assert.equal('link' in bare, false);
    assert.equal('set' in bare, false);
    /* An unreadable set refuses the ITEM (a picture silently landing in the
       wrong dropdown group is a caption-level lie), and the bound holds. */
    assert.equal(admitGalleryItem(imageItem({ set: '   ' })), null);
    assert.equal(admitGalleryItem(imageItem({ set: 42 })), null);
    assert.equal(admitGalleryItem(imageItem({ set: 'x'.repeat(maxGalleryTextLengths.set + 1) })), null);
  });

  it('refuses any link scheme that is not https, by PARSING rather than prefix-matching', () => {
    for (const href of [
      'javascript:alert(1)',
      ' javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'http://example.org/work',
      'file:///etc/passwd',
      '//example.org/work',
      'not a url'
    ]) {
      assert.equal(
        admitGalleryItem(imageItem({ link: { href, label: 'Elsewhere' } })),
        null,
        `${href} must refuse the item`
      );
    }
  });

  it('refuses a link missing either half, because the component invents no label', () => {
    assert.equal(admitGalleryItem(imageItem({ link: { href: 'https://example.org/' } })), null);
    assert.equal(admitGalleryItem(imageItem({ link: { label: 'Elsewhere' } })), null);
    assert.equal(admitGalleryItem(imageItem({ link: { href: 'https://example.org/', label: '   ' } })), null);
  });

  it('bounds every text field, so a manifest cannot smuggle prose into the accessibility tree', () => {
    assert.equal(admitGalleryItem(imageItem({ alt: 'x'.repeat(maxGalleryTextLengths.alt + 1) })), null);
    assert.equal(admitGalleryItem(imageItem({ title: 'x'.repeat(maxGalleryTextLengths.title + 1) })), null);
    assert.equal(
      admitGalleryItem(imageItem({ description: 'x'.repeat(maxGalleryTextLengths.description + 1) })),
      null
    );
    assert.equal(admitGalleryItem(imageItem({ alt: '   ' })), null, 'a blank alt is no alt');
  });

  it('refuses a key that is not a safe render identity', () => {
    for (const key of ['', '   ', '.hidden', '-leading', 'has space', 'has/slash', 'x'.repeat(maxGalleryTextLengths.key + 1)]) {
      assert.equal(admitGalleryItem(imageItem({ key })), null, `key ${JSON.stringify(key)} must refuse the item`);
    }
  });
});

/* The poster choice (issue 239), EXECUTED rather than described. It is the one
 * decision the strip makes about a film before a reader touches anything, and
 * it used to reach for the 4K master: the poster is painted into a stage a few
 * hundred CSS pixels wide, and the full still is never shown at any size —
 * enlarging is stills-only — so the strip paid for a rendition nothing on the
 * page uses. */
describe('the poster a film shows before it plays', () => {
  it('takes the operator’s published poster when there is one', () => {
    const item = admitGalleryItem(videoItem());
    assert.ok(item !== null);
    assert.equal(galleryPosterAsset(item).url, item.poster.url);
    // Not vacuous: the chosen file is a DIFFERENT file from either stand-in,
    // so a function returning the preview or the full still would fail here.
    assert.notEqual(item.poster.url, item.preview.url);
    assert.notEqual(item.poster.url, item.full.url);
  });

  it('stands the PREVIEW derivative in when the operator published none, never the full-size still', () => {
    const item = admitGalleryItem(videoItem({ poster: undefined }));
    assert.ok(item !== null);
    assert.equal(item.poster, undefined);
    assert.equal(
      galleryPosterAsset(item).url,
      item.preview.url,
      'an absent poster must fall back to the small derivative, not to the 4K master'
    );
    assert.notEqual(
      galleryPosterAsset(item).url,
      item.full.url,
      'the full-size still is the rendition the lightbox stopped showing; the strip must not fetch it'
    );
    // The dimensions are the reason, stated as a measurement rather than a
    // claim: the stand-in is genuinely the smaller picture.
    assert.ok(
      galleryPosterAsset(item).width < item.full.width,
      `the poster stand-in is ${galleryPosterAsset(item).width}px wide against the full still's ${item.full.width}px; it is not the smaller rendition`
    );
  });

  it('always has an answer, because every admitted item carries a preview', () => {
    // A still never reaches this function through the adapter, but the
    // function is total over admitted items and says so.
    for (const candidate of [imageItem(), videoItem(), videoItem({ poster: undefined })]) {
      const item = admitGalleryItem(candidate);
      assert.ok(item !== null);
      assert.ok(galleryPosterAsset(item).url.length > 0, 'an admitted item resolved to no poster at all');
    }
  });
});

/* WHICH VIEWPORT GETS WHICH RUNG (issue 241). The defect these run against was
 * measured on the live volume's own film at 0.1.54: an engine that can decode
 * the high-efficiency rung — WebKit and Gecko both can — took the 2160p master
 * into a 242x136 box on a phone, and the 720p rung was selected by nobody at
 * any viewport, because nothing on the page ever asked how BIG a rendition
 * should be. Each assertion below is the rule executed, not described. */
describe('the size a viewport is allowed to ask a film for', () => {
  const laddered = (heights) =>
    admitGalleryItem(
      videoItem({
        sources: heights.map((height, at) => ({
          path: `gallery/motion-${height}-${at}.mp4`,
          sha256: digest(String.fromCharCode(97 + at)),
          type: at === 0 ? 'video/mp4; codecs="hvc1"' : 'video/mp4',
          height
        }))
      })
    );

  it('offers the smallest rung to every viewport and each larger one from the next rung’s own native width', () => {
    const item = laddered([2160, 1080, 720]);
    assert.ok(item !== null);
    /* The item is 3840x2160, so a 1080-tall rung is natively 1920 wide and a
       720-tall one is 1280. Each rung above the floor is offered from the
       width at which the rung BELOW it would start being upscaled. */
    assert.deepEqual(galleryVideoSourceMedia(item), [
      '(min-width: 1920px)',
      '(min-width: 1280px)',
      undefined
    ]);
  });

  it('never leaves a film unplayable: the floor carries no query at all', () => {
    for (const heights of [[2160, 1080, 720], [2160, 720], [1080], [720, 2160]]) {
      const item = laddered(heights);
      assert.ok(item !== null);
      const media = galleryVideoSourceMedia(item);
      const floor = Math.min(...heights);
      for (const [at, height] of heights.entries()) {
        if (height === floor) {
          assert.equal(media[at], undefined, `the smallest rung of [${heights}] was gated behind ${media[at]}`);
        }
      }
      assert.ok(
        media.some((query) => query === undefined),
        `every rung of [${heights}] carries a query, so a narrow viewport is offered nothing at all`
      );
    }
  });

  it('gives every rung of ONE size the same query, so codec fallback inside a size class is untouched', () => {
    /* Two 1080p rungs (a high-efficiency one and the universal one) above a
       720p floor: the pair must be offered together, or the browser's own
       first-playable choice between them would depend on the viewport. */
    const item = laddered([1080, 1080, 720]);
    assert.ok(item !== null);
    const media = galleryVideoSourceMedia(item);
    assert.equal(media[0], media[1], 'two rungs of the same height were offered to different viewports');
    assert.equal(media[2], undefined);
    assert.equal(media[0], '(min-width: 1280px)');
  });

  it('says nothing when there is nothing to choose between', () => {
    // One size class: every rung is the floor, so no query is written at all.
    assert.deepEqual(galleryVideoSourceMedia(laddered([1080, 1080])), [undefined, undefined]);
    // And a still has no ladder to speak about.
    const still = admitGalleryItem(imageItem());
    assert.ok(still !== null);
    assert.deepEqual(galleryVideoSourceMedia(still), []);
  });

  it('reads the ITEM’s own aspect, never an assumed 16:9', () => {
    /* A square film: a 1080-tall rung is 1080 wide, not 1920. The breakpoint
       has to come from the manifest's declared box or it is a guess dressed as
       arithmetic. */
    const item = admitGalleryItem(
      videoItem({
        full: asset(photoDigest, 'gallery/square-still.webp', 2160, 2160),
        sources: [
          { path: 'gallery/square-2160.mp4', sha256: filmDigest, type: 'video/mp4', height: 2160 },
          { path: 'gallery/square-1080.mp4', sha256: digest('e'), type: 'video/mp4', height: 1080 }
        ]
      })
    );
    assert.ok(item !== null);
    assert.deepEqual(galleryVideoSourceMedia(item), ['(min-width: 1080px)', undefined]);
  });

  it('answers positionally, in the manifest’s own order', () => {
    // The caller zips this against item.sources, so a reordered answer would
    // silently attach one rung's query to another's bytes.
    const item = laddered([720, 2160, 1080]);
    assert.ok(item !== null);
    const media = galleryVideoSourceMedia(item);
    assert.equal(media.length, item.sources.length);
    assert.deepEqual(media, [undefined, '(min-width: 1920px)', '(min-width: 1280px)']);
    assert.deepEqual(
      item.sources.map((source) => source.height),
      [720, 2160, 1080],
      'admission reordered the ladder, which this answer is aligned to'
    );
  });
});

describe('gallery/v1 document admission', () => {
  it('refuses a document that is not a gallery/v1 manifest at all', () => {
    for (const document of [null, [], 'gallery', 42, {}, { schema: 'gallery/v2', items: [] }, { schema: galleryManifestSchema }]) {
      assert.throws(() => parseGalleryManifest(document));
    }
  });

  it('drops one unreadable item and keeps the rest — a bad row costs one row', () => {
    const items = parseGalleryManifest(
      manifest([imageItem(), imageItem({ kind: 'hologram', key: 'unknown-kind' }), videoItem()])
    );
    assert.deepEqual(items.map((item) => item.key), ['harbour-at-dusk', 'harbour-in-motion']);
    assert.equal(warnings.length, 1, 'the refusal is reported, not swallowed');
  });

  it('keeps the first of two rows claiming one identity', () => {
    const items = parseGalleryManifest(
      manifest([imageItem({ alt: 'first' }), imageItem({ alt: 'second' })])
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].alt, 'first');
  });

  it('refuses a document declaring more items than the documented ceiling', () => {
    const rows = Array.from({ length: maxGalleryManifestItems + 1 }, (_unused, n) => imageItem({ key: `row-${n}` }));
    assert.throws(() => parseGalleryManifest(manifest(rows)), /more than/);
  });
});

describe('loadGalleryManifest', () => {
  it('reads the manifest from the mutable class, whose responses carry no validator', async () => {
    let requested = null;
    await loadGalleryManifest(async (url) => {
      requested = url;
      return jsonResponse(manifest([imageItem()]));
    });
    assert.equal(requested, `/media/mutable/${galleryManifestPath}`);
  });

  it('answers with the admitted items when the volume is serving one', async () => {
    const items = await loadGalleryManifest(async () => jsonResponse(manifest([imageItem(), videoItem()])));
    assert.equal(items.length, 2);
    assert.equal(items[1].kind, 'video');
  });

  it('answers null for every way the manifest can be absent or wrong', async () => {
    const cases = {
      'a 404 — no manifest published': async () => respond('', { status: 404 }),
      'a 503 — media disabled or over capacity': async () => respond('', { status: 503 }),
      'a network fault': async () => {
        throw new Error('connection refused');
      },
      'a body that is not JSON': async () => respond('<html>not json</html>'),
      'a document of the wrong schema': async () => jsonResponse({ schema: 'gallery/v2', items: [] }),
      'a manifest whose every row was refused': async () =>
        jsonResponse(manifest([imageItem({ kind: 'hologram' })])),
      'an empty but well-formed manifest': async () => jsonResponse(manifest([]))
    };
    for (const [description, fetcher] of Object.entries(cases)) {
      assert.equal(await loadGalleryManifest(fetcher), null, `${description} must answer null so the vendored set stays`);
    }
  });

  it('caps the read and cancels the body rather than buffering it', async () => {
    let cancelled = false;
    const oversized = new ReadableStream({
      pull(controller) {
        // Endless, on purpose: without the cap this test would never finish,
        // which is exactly the failure the cap exists to prevent.
        controller.enqueue(new Uint8Array(8192));
      },
      cancel() {
        cancelled = true;
      }
    });
    const result = await loadGalleryManifest(async () => new Response(oversized));
    assert.equal(result, null);
    assert.equal(cancelled, true, 'an oversized response must be cancelled, not drained');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /gallery manifest failed to load/);
  });

  it('admits a manifest that sits just under the byte cap', async () => {
    const rows = [];
    let body = '';
    // Grow the document until one more row would cross the cap, then prove
    // that document IS admitted — so the cap is a real boundary with a
    // passing side, not a threshold nothing ever reaches.
    for (let n = 0; n < maxGalleryManifestItems; n += 1) {
      const candidate = [...rows, imageItem({ key: `row-${n}` })];
      const candidateBody = JSON.stringify(manifest(candidate));
      if (candidateBody.length > maxGalleryManifestBytes) {
        break;
      }
      rows.push(imageItem({ key: `row-${n}` }));
      body = candidateBody;
    }
    assert.ok(rows.length > 1, 'the cap must admit more than one row, or it is not a useful bound');
    assert.ok(body.length <= maxGalleryManifestBytes);
    const items = await loadGalleryManifest(async () => respond(body));
    assert.equal(items.length, rows.length);
  });

  it('refuses bytes that are not UTF-8 rather than decoding them loosely', async () => {
    const invalid = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff, 0xfe, 0xfd]));
        controller.close();
      }
    });
    assert.equal(await loadGalleryManifest(async () => new Response(invalid)), null);
  });
});

describe('the runtime binding a manifest feeds', () => {
  it('carries the build’s own props as the fallback and the read as a one-shot', async () => {
    const fallback = { items: [], width: 3840, height: 2160 };
    const replacement = { items: [], width: 1920, height: 1080 };
    const block = runtimeBlock('probe', /** @type {never} */ (null), fallback, async () => replacement);
    assert.equal(block.binding.source, 'runtime');
    assert.deepEqual(block.binding.fallback, fallback, 'the fallback is data the build already carries');
    assert.deepEqual(await block.binding.load(), replacement);
  });

  it('lets its load answer null, which is how the fallback survives', async () => {
    const fallback = { items: [], width: 3840, height: 2160 };
    const block = runtimeBlock('probe', /** @type {never} */ (null), fallback, async () => null);
    assert.equal(await block.binding.load(), null);
  });
});
