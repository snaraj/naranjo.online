/* Rendering lanes, stage 2 (issue #26): one navigation per stage-1 floor, in
 * every engine and at phone size, asserting what the ENGINE reports rather
 * than what the source says.
 *
 * These lanes and the source pins in tests/experience.test.mjs are halves of
 * one guarantee and neither replaces the other. A source pin proves the rule
 * the next build inherits, including on engines nobody can run here; a lane
 * proves this build's declarations survived a real cascade — that env() was
 * understood rather than dropped, that 44px of CSS became 44px of box, that
 * a reduced-motion preference actually reaches the motion it governs.
 */
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

/* The model vocabulary, read from the one file every consumer reads (issue
 * #302). The lane below builds its payload from it rather than from a list
 * typed here, so it exercises the widest block the shipped vocabulary can
 * actually produce and grows with it. */
const modelVocabulary = JSON.parse(
  readFileSync(new URL('../../internal/panels/config/models.json', import.meta.url), 'utf8')
);

/* The SOURCE vocabulary, read the same way (issue #311). The wire carries a
   machine key and the page prints the written name this file gives it, so a
   lane that looks a source up on the page has to resolve the key the same way
   the page does — and does it from the file rather than from a table typed
   here. */
const sourceVocabulary = JSON.parse(
  readFileSync(new URL('../../internal/panels/config/sources.json', import.meta.url), 'utf8')
);
const sourceName = (key) =>
  sourceVocabulary.sources.find((entry) => entry.key === key)?.name ?? key;

/* The longest the sky and the fire wait between drawings (lib/sky.ts, pace):
   where a frame is dear, as in WebKit without a GPU, each draws once every
   ten times what its last drawing cost the page, down to this floor. A lane
   that waits for them to move waits the floor and a drawing more, read from
   the rule rather than typed here, so the window follows the rule; a loop
   that never moves still fails. */
const loopFloor = Number(
  /export const skySlowestInterval = ([\d_]+);/
    .exec(readFileSync(new URL('../src/lib/sky.ts', import.meta.url), 'utf8'))?.[1]
    ?.replaceAll('_', '')
);
if (!(loopFloor > 0)) {
  throw new Error('lib/sky.ts states no skySlowestInterval this spec can read');
}
const motionWindow = loopFloor + 5_000;

/* The model group a served source belongs to (issue #369). A source may carry
   only its own vendor's models plus the residual, so a lane that stages model
   rows on a source takes them from that source's group, resolved through the
   same two vocabulary files the page reads. */
const ownGroup = (label) => {
  const vendor = sourceVocabulary.sources.find((entry) => entry.key === label)?.vendor;
  const group = modelVocabulary.groups.find((entry) => entry.key === vendor);
  expect(group, `the served source "${label}" belongs to no vendor group`).toBeTruthy();
  return group;
};

// The narrowest viewport this site supports, and the sizes it must fit
// between there and a large phone. 320 is the floor named in AGENTS.md;
// 360/390/412 are widths ordinary Android and iPhone screens report.
const phoneWidths = [320, 360, 390, 412];

// iOS Safari zooms the page in when a focused field's text is under this, and
// does not zoom back out.
const textEntryFloorPx = 16;

// The comfortable minimum for a finger, in CSS pixels.
const touchFloorPx = 44;

/* THE 448px STAGE CAP IS GONE (owner directive, 2026-09-03, issue 287).
 * galleryStageCapPx pinned --gallery-stage-size, the 28rem ceiling the single
 * visible frame was sized by, and it was written here as a literal rather
 * than read back off the page because Daybreak Blue's review of PR #161
 * proved the self-referential shape lets a 28rem -> 280rem mutation survive:
 * expectation and behaviour move together when both derive from the one
 * mutated token.
 *
 * The frame it capped is retired. The gallery is a GRID of square tiles that
 * spans the reading column, and a cap on that grid would put back the dead
 * gutter the owner's no-dead-space rule forbids — the grid filling its column
 * is the point of the redesign, not an accident of it. What replaces the cap
 * is the opposite measurement, and it is still independent of every token:
 * the grid's own right edge against the COLUMN's, and the cells' widths
 * against each other, in the fill lane below.
 *
 * The film's box went the same way. A film is a tile like any other now, so
 * the three constants that once described its widescreen stage — and then the
 * shared square cap that replaced them (issue 243) — are answered by
 * comparing a film's tile against the still's tile beside it, two boxes of
 * one page rather than any number this file states. */

/* One gallery/v1 manifest carrying a still and a film, served from the media
 * volume's own mutable path so the page takes the route it takes in
 * production: lib/galleryManifest.ts reads it once, admits it, and the Media
 * block replaces its vendored bootstrap items wholesale.
 *
 * The FILES it names are never served — the e2e origin runs with no media
 * volume — and that is deliberate rather than a gap. Every assertion in the
 * film lane below is about the element, its attributes, its reserved box and
 * the controls beside it, all of which are byte-independent by this page's
 * own zero-CLS floor; a lane that needed real frames to decode would be
 * asserting the operator's pipeline rather than this build. Publishing a
 * fixture film into the repository to change that would also be exactly the
 * heavy media requirement 11 keeps out of git. */
/* THE ITEMS CARRY TITLES AND A DESCRIPTION, and where they may appear is now
 * exactly one place: the stage's meta block. The tile grid has no caption
 * lane — the lane, and the zero-shift lane that measured it, went with the
 * strip (owner directive, 2026-09-03, issue 287) — so an item's words reach
 * a reader only when that item is opened, and since issue 384 a film is
 * opened exactly as a still is. The film's description is kept for precisely
 * that reason: it is the copy that must render ONLY while the film is on the
 * stage — nowhere on a page where the film's tile is on screen the whole
 * time, nowhere once the stage pages on to the still, nowhere after it closes
 * — and the film lane reads it in all four states. A fixture with nothing to
 * leak could not show that.
 * The two are DELIBERATELY UNEQUAL and the taller one is deliberately SECOND,
 * as they were: a lane that only ever measured the first item's metadata is
 * one a mutation walks straight past. */
/* BOTH ITEMS NAME ONE EXPLICIT SET (issue 275), which is what puts a still
 * and a film in the SAME tile row: an operator publishes a mixed set exactly
 * this way, and without the field the component's kind-derived default would
 * split the fixture into Photographs and Videos and every mixed-row
 * measurement below would silently be taken against a one-tile row.
 * The set control's own lane serves this fixture with the field STRIPPED, so
 * the two-set branch is exercised by the same data through the same admitted
 * path rather than by a second fixture nobody else uses. */
const galleryManifestFixture = {
  schema: 'gallery/v1',
  items: [
    {
      kind: 'image',
      key: 'lane-still',
      alt: 'A still, served by the lane',
      title: 'A still with a title',
      set: 'Lane fixtures',
      full: { path: 'gallery/still.webp', sha256: 'a'.repeat(64), width: 3840, height: 2160 },
      preview: { path: 'gallery/still-preview.webp', sha256: 'b'.repeat(64), width: 960, height: 540 },
    },
    {
      kind: 'video',
      key: 'lane-film',
      alt: 'A film, served by the lane',
      title: 'A film with a title',
      set: 'Lane fixtures',
      description:
        'And a description long enough to wrap onto a second line on a phone, which is exactly what makes this the taller caption of the two at every width the matrix measures.',
      full: { path: 'gallery/film.webp', sha256: 'c'.repeat(64), width: 3840, height: 2160 },
      preview: { path: 'gallery/film-preview.webp', sha256: 'd'.repeat(64), width: 960, height: 540 },
      poster: { path: 'gallery/film-poster.webp', sha256: 'e'.repeat(64), width: 1920, height: 1080 },
      /* Three rungs, high-efficiency first: the ORDER is the preference, and
         the lane reads it back off the DOM to prove nothing re-ranked it.
         THREE rather than the two this fixture used to carry (issue 241),
         because a ladder with one size class has no size question to answer:
         the item is 3840x2160, so these heights are natively 3840, 1920 and
         1280 wide, and the rung ladder's own rule offers each above the floor
         from the next smaller rung's native width. */
      sources: [
        { path: 'gallery/film-2160.mp4', sha256: 'f'.repeat(64), type: 'video/mp4; codecs="hvc1"', height: 2160 },
        { path: 'gallery/film-1080.mp4', sha256: '0'.repeat(64), type: 'video/mp4', height: 1080 },
        { path: 'gallery/film-720.mp4', sha256: '1'.repeat(64), type: 'video/mp4', height: 720 },
      ],
    },
  ],
};

async function serveGalleryManifest(page) {
  await page.route('**/media/mutable/gallery/manifest.json', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify(galleryManifestFixture),
    })
  );
}

/* Sub-pixel tolerance for a MEASURED box. Layout arithmetic lands on
 * fractional pixels in every engine (a hairline border, a scaled viewport),
 * so a box that should be exactly 44 can be reported as 43.999998. The
 * tolerance is a rounding allowance and nothing more — one hundredth of a
 * pixel cannot hide a control that is genuinely too small. */
const subPixel = 0.01;

/* The panels fetch their envelopes after hydration and the page grows as they
 * paint, so a measurement taken at load is a measurement of an empty page —
 * which would pass every floor below while proving nothing about the site
 * anyone visits. This waits for the document to stop growing rather than for
 * a fixed time, and it is the first thing every test does. (Measured: the
 * Pixel 5 lane read 431px of panel stack immediately after load and 2173px
 * once the panels landed.) */
/* Height alone is not enough, and the 2026-08-26 round-5 review is why
 * (finding 8): the static shell in index.html is deliberately the same
 * HEIGHT as the hydrated chrome, so that a zero-CLS hydration is possible at
 * all. A height that has stopped changing is therefore satisfied by the shell
 * BEFORE the app mounts, and every assertion that followed was racing
 * hydration against its own 5-second default. Under a loaded machine
 * hydration lost once, and `[webkit] each column edge carries a handle`
 * reported 0 separators instead of 2.
 *
 * The fix is a STRICTER precondition, not a longer tolerance anywhere: the
 * shell carries `data-static-fallback` and mounting replaces it, so its
 * absence is the document's own statement that hydration finished. Nothing
 * any test asserts changed — what changed is that the wait now covers the
 * thing it always meant to cover, on the 15s budget it always had. */
/* And height plus hydration is STILL not enough, which is what issue 210 was
 * (found on the ios-safari lane of PR #208's browser-lanes run). Hydration
 * only means the app mounted; a panel-bound block renders nothing at all
 * until its own envelope arrives, so the moment after mount the page has its
 * chrome and none of its data — and two consecutive scrollHeight reads agree
 * happily in that window, because nothing is growing YET. The reading-mode
 * lane snapshotted there, a panel landed 1071px of stack between the snapshot
 * and the swap, and the swap was blamed for growth the fetch caused.
 *
 * Waiting longer would only make it rarer. What makes it impossible is asking
 * the page two questions it can actually answer.
 *
 * `data-panels-pending` on the document root (panels.ts) counts the mounted
 * panels that have not yet received their FIRST envelope. Zero is arrival,
 * exactly, with no polling luck in it — and it covers the failure paths too,
 * since a refused fetch delivers an unavailable envelope and the panel has
 * finished arriving as surely as a successful one. It is required to EXIST as
 * well as to be zero, because an absent attribute means the bundle has not
 * run and a zero one means every panel has answered; treating those the same
 * would restore the exact race, one step earlier.
 *
 * `data-block-count` on each `.panel-stack` (PageSection.svelte) answers the
 * neighbouring question: every block the manifest declared has actually
 * rendered. The two are not redundant — the first is about requests
 * completing, the second about the page being whole, and a block whose
 * adapter answers null forever would satisfy the first and fail the second.
 *
 * Height stability is kept alongside both rather than replaced: arrival is not
 * the only thing that grows a page (a font, an image, a late layout pass),
 * and the conditions are cheap to hold together — this costs three property
 * reads per poll and no extra round trip. */
async function settled(page) {
  let previous = -1;
  /* The last read, named in the failure: which of the conditions below never
     held, at what width, is the first thing anyone debugging a red lane needs,
     and the poll's own message cannot carry it. */
  let last = null;
  let reads = 0;
  let frameless = 0;
  try {
    await expect
      .poll(
        async () => {
          /* EACH READ WAITS FOR TWO RENDERED FRAMES. A media query's change, a
             resize observer's report and every update they cause are delivered
             only by a rendering update, and a forced layout between updates
             reads the page at its new size with the components still in their
             old state. Two equal reads with no frame between them were exactly
             that on WebKit without a GPU, where the first updates after a mount
             or a resize come late: the popover lane read Ongoing Work's 320px
             height with its log still in the desktop form, 1756px taller than
             the page it then measured. A page that renders no frame for two
             seconds reads as not settled, never as settled. */
          const measured = await page.evaluate(
            () =>
              new Promise((resolve) => {
                const read = (rendered) => {
                  const stacks = [...window.document.querySelectorAll('.panel-stack')];
                  return {
                    width: window.innerWidth,
                    rendered,
                    height: window.document.documentElement.scrollHeight,
                    hydrated: window.document.querySelector('[data-static-fallback]') === null,
                    /* Read as a STRING and compared to '0'. Number('') is 0, so a
                       missing attribute would read as "every panel has answered" —
                       which is the one reading that must never be possible here. */
                    pending: window.document.documentElement.getAttribute('data-panels-pending'),
                    /* A stack that declares no count is a stack this lane cannot
                       reason about, and it must not read as "whole": NaN compares
                       false against everything, which would silently restore the old
                       behaviour. It is reported as a distinct falsehood instead. */
                    described: stacks.every((stack) => /^\d+$/.test(stack.dataset.blockCount ?? '')),
                    whole: stacks.every(
                      (stack) => stack.children.length === Number(stack.dataset.blockCount)
                    ),
                  };
                };
                let answered = false;
                const answer = (rendered) => {
                  if (!answered) {
                    answered = true;
                    resolve(read(rendered));
                  }
                };
                requestAnimationFrame(() => requestAnimationFrame(() => answer(true)));
                setTimeout(() => answer(false), 2_000);
              })
          );
          const stable =
            measured.rendered &&
            measured.height > 0 &&
            measured.height === previous &&
            measured.hydrated &&
            measured.pending === '0' &&
            measured.described &&
            measured.whole;
          reads += 1;
          if (!measured.rendered) frameless += 1;
          last = { ...measured, previous, reads, frameless };
          previous = measured.height;
          return stable;
        },
        {
          message:
            'the page never stopped growing, rendered no frame, never hydrated, still has a panel waiting for its first envelope, or has a stack short of the blocks it declares',
          timeout: 15_000,
        }
      )
      .toBe(true);
  } catch (error) {
    error.message += `\nlast read: ${JSON.stringify(last)}`;
    throw error;
  }
}

/* Today at a given hour of the clock the browser reads (the runner's own
 * zone), for page.clock.setFixedTime. The sky followed the reader's hour for
 * part of 2026-10-19 and no longer does (the owner asked for night by default
 * and a toggle instead), so the one lane that sets the clock sets it to prove
 * the page ignores it. */
function atHour(hour) {
  const at = new Date();
  at.setHours(hour, 0, 0, 0);
  return at;
}

async function visit(page) {
  await page.goto('/');
  await settled(page);
}

/* finePointer is GONE (owner directive, 2026-09-03, issue 287), and it is
 * removed rather than kept warm for the same reason alphaOf was: a helper
 * nothing calls is a helper nobody maintains. It answered "is this project's
 * emulated device one the gallery's stage pair is SHOWN on", which was a real
 * question only while the pair was gated behind a fine pointer — the
 * 2026-08-31 sketch retired that gate (issue 275) and the tile grid has no
 * capability-gated control at all, so its last caller went with the strip.
 * The pointer capability IS still asked, by followsPointer further down this
 * file, which is the detail-tip battery's own question and has callers. */

/* Moves the OPEN STAGE to the still whose count line reads `label`, through
 * the dialog's own next control (owner directive, 2026-09-03, issue 287: the
 * strip and its position row are gone, and paging is something only the
 * enlarged surface does now). The walk is bounded by the longest set this
 * suite serves, so a label nothing carries fails loudly on the arrival check
 * rather than looping. */
async function goToItem(page, label) {
  const count = page.locator('.gallery-count');
  const next = page.locator('.gallery-nav[data-gallery-nav="next"]');
  for (let presses = 0; presses < 8; presses += 1) {
    if ((await count.textContent())?.trim() === label) {
      break;
    }
    await next.click();
  }
  await expect(count).toHaveText(label);
}

/* WCAG 2.2 relative luminance and contrast, over whatever spelling of a color
 * the engine computed. Twin of the source-side helper in
 * tests/experience.test.mjs: that one measures the palette the stylesheet
 * DECLARES, this one measures what an engine actually resolved after the
 * fallback chain ran, which is the only place the two can disagree. */
function channels(color) {
  const parsed = color.match(/[\d.]+/g);
  expect(parsed, `"${color}" carries no color components this lane can read`).not.toBeNull();
  const components = parsed.slice(0, 3).map(Number);
  /* Every engine in this matrix computes a color-mix() result as
     `color(srgb r g b)` with 0-1 components, and everything else as rgb()
     with 0-255 ones. Reading the first as the second is not a rounding error:
     it turns a mid-brown into near-black and reports a passing contrast as
     1.17:1, which is exactly what it did before this branch existed. An
     unrecognised color space fails loudly rather than being measured in the
     wrong units. */
  if (!color.trimStart().startsWith('color(')) return components;
  expect(color, 'a color space this lane cannot convert').toContain('color(srgb');
  return components.map((component) => component * 255);
}

function relativeLuminance(color) {
  const [red, green, blue] = channels(color).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground, background) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (first, second) => second - first
  );
  return (lighter + 0.05) / (darker + 0.05);
}

/* alphaOf is GONE (owner directive, 2026-09-03, issue 287). It read the alpha
 * channel out of whatever spelling of a colour an engine computed, and it had
 * exactly one consumer: the pin on the fixed reading-mode control's backdrop
 * plate. The ledger's masthead is an in-flow row, nothing scrolls beneath it,
 * and that lane now asserts the structural fact that makes a backdrop
 * unnecessary instead of the backdrop's own opacity — so the helper has no
 * caller left. It is removed rather than kept warm: a helper nothing calls is
 * a helper nobody maintains, and the contrast readers above (channels,
 * relativeLuminance, contrastRatio) are the colour machinery this file
 * actually uses. */

/* THE NIGHT, AND THE DAY KEPT AS LOGIC (owner, 2026-10-19: "always set it to
 * night by default", then, of the control that turned it to day, "do away
 * with this all together but keep the logic"). Every visit opens on the night
 * whatever the device prefers, and nothing on the page turns it. The day is
 * still whole in the stylesheet, keyed on the root's data-sky, and the app
 * writes that attribute once and never again — so writing it here uncovers the
 * day palette and nothing overwrites it. That is the only way a lane can
 * change the page's colours now. It is NOT the reader's day: the sky canvas
 * and the torches take their phase from the app's constant, so they stay the
 * night's (the scene lane states what follows and what does not).
 *
 * Nothing is pressed, so nothing can scroll or take focus on the way, and the
 * turn is proved the way the page states it — the root names the scene asked
 * for — two rendered frames later, before anything is measured. */
const turnScene = async (page, sky) => {
  await page.evaluate((wanted) => {
    window.document.documentElement.dataset.sky = wanted;
  }, sky);
  await sceneIs(page, sky);
};

/* The root names the scene, two rendered frames after whatever turned it. */
const sceneIs = (page, sky) =>
  expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise((resolve) => {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve(window.document.documentElement.dataset.sky))
              );
            })
        ),
      { message: `the page never turned to ${sky}` }
    )
    .toBe(sky);

/* A subject brought near the top of the viewport and settled, so the scroll
 * position a turn is held to is a real offset into the document, where a nudge
 * either way would show, and the first reading is of a page that has stopped
 * moving. A whole-pixel offset a little above the subject: scrollIntoView
 * lands on a fraction an engine then rounds. */
const readFrom = async (page, selector) => {
  await page.evaluate((target) => {
    const top = window.document.querySelector(target).getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, Math.floor(top) - 16));
  }, selector);
  await settled(page);
};

/* The token panel's display controls are GONE (owner directive, 2026-08-28,
 * reversing the 0.1.52 decision after seeing it live: "remove this entire
 * menu. it doesnt look good and it doesn't provide any value"). The helper
 * that opened the per-source popover, pressed a radio and closed it again
 * went with them; every lane below now measures the ONE graph each source
 * draws, and the lane at the end of this file's token-panel group is the one
 * that proves no control is left to press.
 */

test('the page fits every phone width instead of scrolling sideways', async ({ page }) => {
  await visit(page);
  for (const width of phoneWidths) {
    await page.setViewportSize({ width, height: 720 });
    /* The document element, not the body: a body can be narrower than its own
       overflowing content, and it is the DOCUMENT that scrolls. */
    const observed = await page.evaluate(() => ({
      scrollWidth: window.document.documentElement.scrollWidth,
      clientWidth: window.document.documentElement.clientWidth,
    }));
    expect(
      observed.scrollWidth,
      `the page scrolls sideways at ${width}px: ${observed.scrollWidth}px of content in ${observed.clientWidth}px of viewport`
    ).toBeLessThanOrEqual(observed.clientWidth);
  }
});

test('wide panel content scrolls inside its own container', async ({ page }) => {
  await visit(page);
  await page.setViewportSize({ width: phoneWidths[0], height: 720 });
  await settled(page);
  /* The floor is not "nothing is ever too wide" — a year of contributions
     genuinely is. It is that anything too wide is HELD by its own box, and
     that the page is never the box that holds it (asserted above).

     Held has two forms, and the lane originally knew only one. A year of
     contribution columns is held by SCROLLING: the content stays reachable
     and the strip takes the sideways movement. A commit subject on a 320px
     phone is held by CLIPPING: `overflow: hidden` with `text-overflow:
     ellipsis`, the full text on the title attribute — and its scrollWidth
     still reports the untruncated line, so it measures as wide even though
     nothing of it is anywhere to be seen. Counting that as an escape was
     wrong twice over: a clipped box cannot make the document scroll (which
     is the floor, proven independently in the test above), and the panel is
     deliberately truncating rather than accidentally overflowing.

     So both are containment, and both buckets are asserted: nothing escapes,
     and something is still held by scrolling — which keeps the SCROLL half of
     the floor from quietly becoming a page of clipped boxes.

     A DRAWING INSIDE AN <svg> HAS NO SCROLL BOX (re-aimed 2026-10-16, when the
     trackers became one diagram drawn in SVG). `scrollWidth` is a CSS-box
     property, and a graphics element inside an <svg> is not a CSS box:
     MEASURED, Chromium reports a month label 24px wide on screen as 1361 and
     1680 of "scroll width", while Gecko reports 0 — so the lane named four
     innocent labels in one engine and could never see a real escape in the
     other. Such an element is measured by the box it actually PAINTS, which is
     the same question asked in the only units it has, and the ancestor walk
     climbs through the drawing to the boxes that can hold it. */
  const wide = await page.evaluate(() => {
    const overflowOf = (node) => getComputedStyle(node).overflowX;
    const scrolls = (node) => ['auto', 'scroll'].includes(overflowOf(node));
    const clips = (node) => ['hidden', 'clip'].includes(overflowOf(node));
    const viewport = window.document.documentElement.clientWidth;
    const width = (node) =>
      node instanceof SVGElement && node.ownerSVGElement !== null
        ? node.getBoundingClientRect().width
        : node.scrollWidth;
    const scrolled = [];
    const clipped = [];
    const escaping = [];
    for (const node of window.document.querySelectorAll('body *')) {
      if (width(node) <= viewport) continue;
      const name = `${node.tagName.toLowerCase()}.${node.getAttribute('class') ?? ''}`;
      let held = null;
      for (let parent = node; parent instanceof Element; parent = parent.parentElement) {
        if (scrolls(parent)) held = 'scrolled';
        else if (clips(parent) && held === null) held = 'clipped';
      }
      if (held === 'scrolled') scrolled.push(name);
      else if (held === 'clipped') clipped.push(name);
      else escaping.push(name);
    }
    return { scrolled, clipped, escaping };
  });
  expect(
    wide.escaping,
    'content wider than the phone that neither scrolls nor is clipped by an ancestor'
  ).toEqual([]);
  /* And the check is not vacuous: this page really does render content wider
     than a 320px phone — the boss ticker's band, since the contribution grids
     that used to scroll became one diagram that fits its box (2026-10-16) — so
     a run that finds none has stopped rendering the thing the floor is about. */
  expect(
    wide.scrolled.length,
    'nothing on the page is held by a scrolling box any more; this lane no longer proves scroll containment'
  ).toBeGreaterThan(0);
});

test('every control clears the touch floor on both axes', async ({ page }) => {
  await visit(page);
  /* Controls, meaning things with an activation behavior. A focusable scroll
     region, or a boss cell that takes focus only so its tooltip can appear
     ("there is no action to perform", StatTracker.svelte), is not a target you tap
     to do something, and sizing a data cell like a button would make the table
     unreadable. */
  const controls = page.locator(
    'button, a[href], input, select, textarea, summary, [role="button"]'
  );
  const total = await controls.count();
  expect(
    total,
    'the page renders no controls at all; this lane would prove nothing'
  ).toBeGreaterThan(1);
  for (let index = 0; index < total; index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible())) continue;
    const label = (await control.getAttribute('aria-label')) ?? (await control.innerText());
    const box = await control.boundingBox();
    expect(box, `"${label}" has no rendered box`).not.toBeNull();
    expect(box.width, `"${label}" is ${box.width}px wide`).toBeGreaterThanOrEqual(
      touchFloorPx - subPixel
    );
    expect(box.height, `"${label}" is ${box.height}px tall`).toBeGreaterThanOrEqual(
      touchFloorPx - subPixel
    );
  }
});

test('a text field renders at or above the zoom threshold', async ({ page }) => {
  await visit(page);
  /* The site ships no form control yet, so the probe supplies the ELEMENT and
     the site supplies the RULE. That is the right split: the assertion is
     about styles.css, and a field created here inherits exactly the cascade
     the first real one will — including, crucially, the 13px panel font-size
     it would otherwise inherit inside a card. */
  const measured = await page.evaluate(
    (tags) =>
      tags.map((tag) => {
        const probe = window.document.createElement(tag);
        window.document.body.append(probe);
        const size = getComputedStyle(probe).fontSize;
        probe.remove();
        return [tag, size];
      }),
    ['input', 'select', 'textarea']
  );
  for (const [tag, size] of measured) {
    expect(
      Number.parseFloat(size),
      `<${tag}> renders at ${size}, under the ${textEntryFloorPx}px zoom threshold`
    ).toBeGreaterThanOrEqual(textEntryFloorPx);
  }
});

test('the page keeps its gutters and its dynamic height in this engine', async ({ page }) => {
  await visit(page);
  const observed = await page.evaluate(() => {
    const app = window.document.getElementById('app');
    const style = getComputedStyle(app);
    return {
      insets: CSS.supports('padding: env(safe-area-inset-top)'),
      dynamicHeight: CSS.supports('min-height: 100dvh'),
      paddingInlineStart: Number.parseFloat(style.paddingLeft),
      paddingInlineEnd: Number.parseFloat(style.paddingRight),
      paddingBlockEnd: Number.parseFloat(style.paddingBottom),
      bodyMinHeight: Number.parseFloat(getComputedStyle(window.document.body).minHeight),
      viewportHeight: window.innerHeight,
    };
  });
  /* Both queries are expected TRUE on every engine in this matrix — which is
     why they are asserted: if one ever reports false, the stylesheet's
     @supports fallbacks stop being theory, and the padding and height measured
     below are then the base rather than the upgrade. */
  expect(
    observed.insets,
    'this engine does not understand env(); the page is running on its fallback'
  ).toBe(true);
  expect(
    observed.dynamicHeight,
    'this engine does not understand dvh; the page is running on its fallback'
  ).toBe(true);
  /* A desktop or emulated phone reports zero insets, so these resolve to the
     plain gutter — and that is exactly the regression worth catching: were the
     max()/env() declaration dropped rather than resolved, the padding would be
     0 and the text would sit against both edges of the screen. */
  expect(observed.paddingInlineStart).toBeGreaterThan(0);
  expect(observed.paddingInlineEnd).toBeGreaterThan(0);
  expect(observed.paddingBlockEnd).toBeGreaterThan(0);
  expect(
    observed.bodyMinHeight,
    `the body claims ${observed.bodyMinHeight}px against a ${observed.viewportHeight}px viewport`
  ).toBeCloseTo(observed.viewportHeight, 0);
});

/* THE NIGHT AND THE DAY KEPT BEHIND IT (owner, 2026-10-19: night on every
 * visit, and of the control that turned it to day, "do away with this all
 * together but keep the logic"). The footer control that offered five modes is
 * gone, the device's own preference no longer reaches the page, and nothing on
 * the page turns it; the day palette is still whole behind the root's data-sky
 * (turnScene). So the swap this lane holds still is that palette — night on
 * arrival, day, and back — which is the zero-CLS floor for whatever brings a
 * day back. */
test('switching the reading mode repaints without moving anything', async ({ page }) => {
  await visit(page);
  const geometry = () =>
    page.evaluate(async () => {
      /* The diagram's days cross-fade into a mode's ramp rather than snapping
         (motion welcome) — a paint-only transition, so it can move nothing,
         but a read taken inside it would see a fill between two modes. Every
         finite animation on the diagram is let finish first. */
      const diagram = window.document.querySelector('.chronicle');
      await Promise.all(
        window.document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.target instanceof Element &&
              diagram?.contains(animation.effect.target) &&
              animation.effect.getComputedTiming().endTime !== Infinity
          )
          .map((animation) => animation.finished.catch(() => {}))
      );
      /* TODAY'S GLOW BREATHES FOREVER — an endless stroke-width animation on
         one calendar day — and Gecko counts a shape's stroke in its box ("SVG
         SHAPES ARE MEASURED BY THEIR GEOMETRY", further down this file), so
         two reads taken at different breaths differ in Firefox with nothing
         having moved: MEASURED as 0.3px of calendar on the dark swap once the
         lane read with the diagram in view. Each read holds every endless
         animation on the diagram at its first moment, so both reads see the
         glow at the same breath and the swap is the only thing left that can
         differ between them. */
      for (const animation of window.document.getAnimations()) {
        if (
          animation.effect?.target instanceof Element &&
          diagram?.contains(animation.effect.target) &&
          animation.effect.getComputedTiming().endTime === Infinity
        ) {
          animation.pause();
          animation.currentTime = 0;
        }
      }
      const boxes = {};
      const shifted = ({ x, y, width, height }, offset) => ({ x, y: y + offset, width, height });
      const round = ({ x, y, width, height }) =>
        [x, y, width, height].map((value) => Math.round(value * 100) / 100);
      /* DOCUMENT coordinates, not viewport ones (owner directive, 2026-09-03,
         issue 287), and the scroll position beside them. A viewport-relative
         box moves for two different reasons — the page re-laid out, or the
         document scrolled — and this lane's claim is about the first. The two
         are asserted separately below so a failure says which one happened. */
      const scrollY = window.scrollY;
      /* J's seat joins the list in place of the chrome row he left (owner
         direction, 2026-10-16): he is sized in the name's own measure, so a
         mode that resized the name would move him too. The intro joins it
         (owner, 2026-10-19): the name and J are one centred group in it. */
      /* The trackers' one diagram and the Ongoing Work columns join the list
         in place of the heatmap blocks they replaced (owner direction,
         2026-10-16): the chart, the calendar under it and every column of the
         paired section, each read by name. A reading mode may repaint all of
         them and resize none. */
      for (const selector of [
        '#app',
        'main',
        '.page-intro',
        'h1',
        '.page-j',
        '.panel-stack',
        '.chronicle',
        '.chronicle-chart',
        '.chronicle-calendar',
        '.chronicle-accounts',
        '.ongoing',
        '.log-box',
        '.ticker-strip',
      ]) {
        const node = window.document.querySelector(selector);
        if (node === null) continue;
        boxes[selector] = round(shifted(node.getBoundingClientRect(), scrollY));
      }
      /* Every calendar day the diagram draws, as one figure: a mode that
         resized the cells would move their sum. */
      const cells = [...window.document.querySelectorAll('.chronicle-cell')];
      boxes['chronicle-cells'] = [
        cells.length,
        Math.round(cells.reduce((sum, cell) => sum + cell.getBoundingClientRect().width, 0) * 100) / 100,
      ];
      /* WHAT A MODE REPAINTS, which is not the document's ground (THE KEEP,
         owner direction, 2026-10-16): the sky is a canvas drawn in code, and
         the owner took every competing ground off the sheet the same day ("I
         don't like having 3 different conflicting colors fighting for a
         background"), so nothing inside the sheet paints a ground of its own
         and a comparison of the document's paint could read "unchanged" for a
         swap that genuinely happened. What each scene DOES repaint is the
         sheet itself — its ground (pale wall or night), the ink set on it, and
         the ring the calendar draws round its busiest day in the scene's own
         ramp peak — so that reading is the non-vacuity probe: a day that
         painted the night sheet would pass every no-movement check below
         while not existing. (The ring replaced the quiet day's fill here on
         2026-10-19, when the calendar's days became moss on stone: the stones
         are one set of pictures in both scenes, so their fill no longer says
         which scene painted them.) */
      const sheet = getComputedStyle(window.document.querySelector('main'));
      const busiest = window.document.querySelector('.chronicle-cell[data-peak="true"]');
      return {
        boxes,
        scrollY,
        scrollHeight: window.document.documentElement.scrollHeight,
        surface: `${sheet.backgroundColor} | ${sheet.backgroundImage === 'none' ? 'plain' : 'textured'} | ${sheet.color} | ${
          busiest === null ? 'no busiest day' : getComputedStyle(busiest).stroke
        }`,
      };
    });

  /* Measured into the page: the diagram near the top of the viewport
     (readFrom), so the scroll position the swap is held to is a real offset
     rather than the document's top, where a nudge upward could not show. */
  await readFrom(page, '.chronicle');
  const before = await geometry();
  expect(before.scrollY, 'the page did not scroll to the diagram, so the no-scroll check reads the top').toBeGreaterThan(0);
  expect(before.surface, 'the calendar rings no busiest day; this lane reads half a sheet').not.toContain('no busiest day');
  expect(before.boxes['.chronicle-chart'], 'the diagram drew no chart for a mode to move').toBeDefined();
  expect(before.boxes['chronicle-cells'][0], 'the diagram drew no calendar days for a mode to resize').toBeGreaterThan(0);

  /* BOTH scenes, there and back. Each step is compared against the ORIGINAL
     geometry rather than against its predecessor, so a drift that accumulates
     a fraction at a time cannot hide inside a chain of individually equal
     steps. */
  for (const scene of ['day', 'night']) {
    await turnScene(page, scene);
    const after = await geometry();
    /* Assert the turn actually happened before asserting nothing moved —
       otherwise a turn that did nothing at all would pass this test
       perfectly: day paints a different sheet from the night the reader
       arrived on, and the way back to night returns to exactly that one. */
    if (scene === 'day') {
      expect(after.surface, 'day paints the same sheet as night').not.toBe(before.surface);
    } else {
      expect(after.surface, 'the way back to night does not paint what the page painted on arrival').toBe(
        before.surface
      );
    }
    /* NO SCROLL, stated on its own: a swap that nudges the document is a
       jolt the reader feels even when not one box re-laid out, and it is a
       different defect from a relayout — measured on WebKit as a 2px scroll
       when focus returned to a masthead control sitting inside a stale
       `scroll-padding-top`. It is asserted exactly, not roughly. */
    expect(
      after.scrollY,
      `the turn to ${scene} scrolled the document from ${before.scrollY} to ${after.scrollY}`
    ).toBe(before.scrollY);
    expect(after.boxes, `the turn to ${scene} moved the page under the reader`).toEqual(before.boxes);
    expect(after.scrollHeight, `the turn to ${scene} changed the page height`).toBe(before.scrollHeight);
  }
});

/* THE SCENE: NIGHT ON EVERY VISIT, THE DAY KEPT AS LOGIC (owner, 2026-10-19:
 * "always set it to night by default", then, of the toggle that turned the
 * page to day, "do away with this all together but keep the logic"). This lane
 * was the toggle's — night by default, day on request, nothing remembered —
 * and with the control gone it holds what is left of that, end to end in
 * every engine:
 *
 *   (a) the page OPENS AT NIGHT whatever the device prefers: under an emulated
 *       light AND an emulated dark preference the root names the night, the
 *       page declares a dark colour scheme, the toolbars are told the night's
 *       sheet, and the sheet's surface is one and the same colour — so a
 *       stylesheet that let prefers-color-scheme back in fails on whichever
 *       preference it answered;
 *   (b) NOTHING ON THE PAGE TURNS IT: no sky control anywhere, and the name's
 *       block holds no control and no keyboard stop at all. This replaces the
 *       toggle's own checks — a named 44px target in the name's block, and
 *       "the keyboard reaches it with Tab, and Enter turns it" — which went
 *       with their subject; a control that came back unasked fails here;
 *   (c) the day is still whole behind data-sky: written there, it paints the
 *       day's sheet, declares a light colour scheme, and moves nothing. The
 *       toolbars keep the night's colour, because only the app tells them,
 *       once, at hydration — stated as measured, so a page that starts
 *       following the attribute is a conscious edit here;
 *   (d) the page keeps nothing: no cookie and nothing in either storage, on
 *       load or after the day is uncovered;
 *   (e) a reload opens at night. */
test('the page opens at night whatever the device prefers, keeps the day behind data-sky, and remembers nothing (owner 2026-10-19)', async ({
  page,
  context,
}) => {
  const scene = () =>
    page.evaluate(() => {
      const root = window.document.documentElement;
      return {
        sky: root.dataset.sky,
        colorScheme: getComputedStyle(root).colorScheme,
        surface: getComputedStyle(window.document.querySelector('main')).getPropertyValue('--color-surface').trim(),
        themeColor: window.document.head.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
        prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
      };
    });
  const storage = () =>
    page.evaluate(() => ({
      cookie: window.document.cookie,
      local: Object.keys(window.localStorage).map((key) => `${key}=${window.localStorage.getItem(key)}`),
      session: Object.keys(window.sessionStorage).map((key) => `${key}=${window.sessionStorage.getItem(key)}`),
    }));
  const nothingKept = { cookie: '', local: [], session: [] };

  /* (a) Night under either preference. The emulation is proved to have
     reached the page (the media query answers it), so "the same surface" is a
     statement about a page that was really asked twice. */
  const arrivals = {};
  for (const preference of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: preference });
    await visit(page);
    const arrived = await scene();
    expect(arrived.prefersDark, `the emulated ${preference} preference never reached the page`).toBe(preference === 'dark');
    expect(arrived.sky, `under a ${preference} preference the page opened on "${arrived.sky}", not the night`).toBe('night');
    expect(arrived.colorScheme, `under a ${preference} preference the night declares "${arrived.colorScheme}"`).toBe('dark');
    expect(arrived.surface, 'the sheet has no surface colour to compare').not.toBe('');
    expect(arrived.themeColor, `under a ${preference} preference the toolbars were not told the night's sheet`).toBe(
      arrived.surface
    );
    /* (d), on load: a first visit writes nothing anywhere. */
    expect(await storage(), `under a ${preference} preference the page kept something on load`).toEqual(nothingKept);
    expect(await context.cookies(), `under a ${preference} preference the page set a cookie on load`).toEqual([]);
    arrivals[preference] = arrived.surface;
  }
  expect(arrivals.dark, 'the night paints a different sheet under the device’s light and dark preferences').toBe(
    arrivals.light
  );

  /* (b) Nothing on the page turns it. */
  const controls = await page.evaluate(() => ({
    toggles: window.document.querySelectorAll('.sky-toggle').length,
    intro: [...window.document.querySelector('main .page-intro').querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].map(
      (node) => node.outerHTML.slice(0, 80)
    ),
  }));
  expect(controls.toggles, 'a sky control is on the page again').toBe(0);
  expect(controls.intro, 'the name’s block holds a control or a keyboard stop').toEqual([]);
  await expect(
    page.getByRole('button', { name: /switch to (?:day|night)/i }),
    'a control offers to turn the scene'
  ).toHaveCount(0);

  /* (c) The day behind data-sky, read at arrival, where a reader first is. */
  const layout = () =>
    page.evaluate(() => {
      const at = (selector) => {
        const box = window.document.querySelector(selector).getBoundingClientRect();
        return [box.left, box.top + window.scrollY, box.width, box.height].map((value) => Math.round(value * 100) / 100);
      };
      return {
        scrollY: window.scrollY,
        name: at('h1'),
        j: at('.j-flight'),
        firstSection: at('.page-section'),
        height: window.document.documentElement.scrollHeight,
      };
    });
  const night = await scene();
  const still = await layout();
  await turnScene(page, 'day');
  const day = await scene();
  expect(day.colorScheme, `the day declares "${day.colorScheme}"`).toBe('light');
  expect(day.surface, 'the day paints the night’s sheet').not.toBe(night.surface);
  expect(
    day.themeColor,
    'the toolbars followed the attribute; only the app tells them, at hydration, and this lane says so'
  ).toBe(night.surface);
  expect(await layout(), 'uncovering the day moved the page').toEqual(still);

  /* (d), after the day: still nothing kept. */
  expect(await storage(), 'uncovering the day left a cookie or a stored value behind').toEqual(nothingKept);
  expect(await context.cookies(), 'uncovering the day set a cookie').toEqual([]);

  /* (e) A reload is a new visit, and a new visit is the night. */
  await page.reload();
  await settled(page);
  const reloaded = await scene();
  expect(reloaded.sky, 'a reload kept the day').toBe('night');
  expect(reloaded.surface, 'a reload opened on a sheet other than the night’s').toBe(night.surface);
});

/* ===========================================================================
 * Experience pass 1 (issue 127)
 *
 * The owner's directives are about what the page LOOKS like, which is the one
 * class of claim a source pin cannot settle: "fills the viewport", "no blank
 * tiles", "opens on today" are all properties of a rendered box. These lanes
 * measure them in every engine, at the widths where each is decided.
 * ======================================================================== */

// The widths the desktop directive is about. 1440 is a laptop, 1920 a
// monitor; both must fill, and the second must fill with MORE cards rather
// than with one card stretched across it.
const desktopWidths = [1440, 1920];

// The page's own gutter, in CSS pixels (--page-gutter: 1rem, doubled). A
// filled page is the viewport minus exactly this and nothing else.
const gutterPx = 32;

/* The width the arrangement before this one was rejected FOR: a 30rem ribbon
 * down the middle of a desktop. The owner asked for one centred container,
 * wider than that (issue 134), so a column that failed to clear it would be
 * the ribbon under a new name. */
const ribbonPx = 480;

test('the page is one centred column on a wide viewport, and everything stacks down it', async ({
  page,
}) => {
  await visit(page);
  for (const width of desktopWidths) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    const observed = await page.evaluate(() => {
      const root = window.document.documentElement;
      const stack = window.document.querySelector('.panel-stack');
      const main = window.document.querySelector('main');
      const box = main.getBoundingClientRect();
      /* THE COLUMN'S CONTENT BOX (THE KEEP, owner direction, 2026-10-16): the
         sheet is framed and padded now, so what the sections stack down is
         the column less its frame and its padding, and a stack inside a
         framed board less that board's own. Each is read off the engine's
         computed style rather than restated, and the column itself is still
         the token's border box, which is what the reader sizes. */
      const inner = (node) => {
        const style = getComputedStyle(node);
        return node.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      };
      /* The column the STYLESHEET asks for, resolved here rather than
         duplicated: the token is the one knob this width has, and a lane that
         hardcoded the number would keep passing after somebody changed it. */
      const declared = getComputedStyle(root).getPropertyValue('--page-column-width').trim();
      const rem = Number.parseFloat(getComputedStyle(root).fontSize);
      return {
        viewport: root.clientWidth,
        declared,
        column: Number.parseFloat(declared) * (declared.endsWith('rem') ? rem : 1),
        main: box.width,
        content: inner(main),
        left: box.left,
        right: box.right,
        sections: [...window.document.querySelectorAll('.page-section')].map(
          (section) => Math.round(section.getBoundingClientRect().width * 100) / 100
        ),
        stack: stack.getBoundingClientRect().width,
        stackContent: inner(stack),
        tracks: getComputedStyle(stack).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
        cards: [...stack.querySelectorAll('.panel-shell')].map(
          (card) => Math.round(card.getBoundingClientRect().width * 100) / 100
        ),
      };
    });
    expect(observed.declared, 'the page column is not a length any more').toMatch(/rem$/);
    /* The column is what the token says, and it is a COLUMN: narrower than the
       viewport it sits in. A page that filled the viewport — the arrangement
       the owner replaced — fails the second of these by hundreds of pixels. */
    expect(
      observed.main,
      `the page holds ${observed.main}px of a ${observed.viewport}px viewport`
    ).toBeCloseTo(observed.column, 0);
    expect(observed.main).toBeLessThan(observed.viewport - gutterPx);
    /* ...and wider than the ribbon the owner asked us to grow past. */
    expect(
      observed.main,
      `the column is ${observed.main}px; the design it replaces was ${ribbonPx}px and the owner asked for a wider one`
    ).toBeGreaterThan(ribbonPx);
    /* Centred, which is the other half of "one container": equal margin on
       both sides, to within a rounding pixel. */
    expect(
      Math.abs(observed.left - (observed.viewport - observed.right)),
      `the column sits ${observed.left}px from one edge and ${observed.viewport - observed.right}px from the other`
    ).toBeLessThanOrEqual(1);
    /* Stacked, not tiled: one track, and every card the full width of it. The
       arrangement the owner rejected shows up here as three tracks and cards a
       third of the column wide. */
    expect(
      observed.tracks,
      `${observed.viewport}px lays out ${observed.tracks} column(s) of trackers`
    ).toBe(1);
    expect(observed.content, 'the framed sheet leaves its sections no room').toBeGreaterThan(ribbonPx);
    for (const section of observed.sections) {
      expect(section, `a section is ${section}px wide in a ${observed.content}px sheet`).toBeCloseTo(
        observed.content,
        0
      );
    }
    expect(observed.stack, `the tracker stack is ${observed.stack}px in a ${observed.content}px sheet`).toBeCloseTo(
      observed.content,
      0
    );
    expect(observed.cards.length, 'the tracker stack holds no cards to measure').toBeGreaterThan(0);
    for (const card of observed.cards) {
      expect(card, `a card is ${card}px wide in a ${observed.stackContent}px board`).toBeCloseTo(
        observed.stackContent,
        0
      );
    }
  }
});

/* The page's own top rhythm (owner directive, 2026-08-25: the name "almost
 * feels like it's about to escape"). This lane was "the page name clears the
 * fixed chrome row rather than starting under it", and its chrome-row half is
 * retired with the row (owner direction, 2026-10-16: "do away with it for
 * now"). What stays is the half with a subject: the page still keeps its sky
 * above the sheet, and the sheet still opens on the name — nothing above it in
 * the column any more. (A phone's J used to overhang into that sky, and this
 * note pointed at the lane that kept the overhang on screen; since 2026-10-19
 * he flies in the room the name keeps at its end, and the J lane below holds
 * his picture inside the intro and the column instead.)
 *
 * Measured at a phone width as well as the desktop projects, because that is
 * where a safe-area inset would join the calculation on a real device. */
test('the sheet opens on the name, under the sky the page keeps above it', async ({ page }) => {
  await visit(page);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await settled(page);
    const measured = await page.evaluate(() => {
      const main = window.document.querySelector('main');
      const app = window.document.getElementById('app');
      return {
        mainTop: main.getBoundingClientRect().top,
        firstChild: main.firstElementChild?.className ?? '',
        headingInFirst: main.firstElementChild?.querySelector('h1') !== null,
        reserved: parseFloat(getComputedStyle(app).paddingBlockStart),
        header: window.document.querySelector('header.page-header, .band') !== null,
      };
    });
    expect(
      measured.reserved,
      `the page reserves ${measured.reserved}px above its sheet at ${width}px`
    ).toBeGreaterThanOrEqual(60 - subPixel);
    expect(measured.mainTop, `at ${width}px the sheet starts ${measured.mainTop}px down, not at the reserve`).toBeCloseTo(
      measured.reserved,
      0
    );
    expect(measured.header, `at ${width}px a chrome row or a picture band is back above the name`).toBe(false);
    expect(
      measured.headingInFirst,
      `at ${width}px the sheet opens on "${measured.firstChild}" rather than on the name`
    ).toBe(true);
  }
});

/* J FLIES OFF THE NAME (owner direction, 2026-10-16: "do away with [the bar]
 * for now, put J elsewhere"; the flight itself is the same day's "swap him for
 * the flying J again and give him a bit of a back-forth rotation, subtle").
 * He bookended the chrome row from two seats (issue 314, and issue 325's
 * mirrored one facing inwards); the row is gone and he has ONE seat, beside
 * the name. Since 2026-10-19 the name and J are ONE CENTRED GROUP: the name
 * keeps a room at its end the size of J's flight (a margin of the gap plus his
 * square), the heading with that room is centred in the intro — so the name
 * sits left of the middle — and J flies in the room, placed from the name's
 * own end edge and centred on its two lines ("work my name also towards the
 * left side stacked and put J on the white space flying", then, of the name
 * at the column's very start, "way too much to the left"). He no longer
 * perches on the frame's corner on a phone or hangs half into the sheet's
 * margin on a monitor; what replaces those measurements is that his picture
 * stays inside the intro and inside the column's content box, and that the
 * group is centred.
 *
 * AS THE DOT OF THE J since 2026-10-20 (the owner's pick of six settings,
 * "the dot of the j, stacked", and of its size: "make the title not be
 * GIGANTIC"). The name is two centred lines, its j drawn dotless, and J
 * hovers where the dot would be: over the stem, his feet a breath over the
 * second line's x-height and his head under the first line's letters. "He
 * covers no letter" is measured on INK now rather than on line boxes — he is
 * inside the name's block by design, between its lines — and the face's own
 * facts are read off the engine's drawing of it, not off the stylesheet.
 *
 * The source pins in tests/experience.test.mjs hold the declarations; this
 * holds what an engine did with them, which for a sprite beside a line of
 * display type is the only place the claims can be tested at all: "he covers
 * no letter" is a property of where three engines put the glyphs and where
 * they put him, "the picture advances" is 480 background positions a
 * compositor steps through, and "he rocks gently" is a rotation an engine
 * computes frame by frame.
 *
 * ONE PICTURE PER READER: the flight sheet only where motion is welcome, the
 * small still everywhere else, so a reader who asked for less motion never
 * downloads the 882kB sheet. COUNTED from the network rather than reasoned
 * about.
 *
 * Both halves of the motion doctrine are measured, because "no animation" must
 * never mean "no dragon": with the preference reduced he is still there, still
 * his size, showing the still, level — he simply holds it. */
/* Vite names an emitted file `<name>-<hash>.webp`; the unhashed name is what a
 * dev server serves. Both shapes are read, and the still's own name is
 * excluded from the sheet's. */
const jSheetPath = /\/j-flight(?!-still)(?:-[^/]*)?\.webp$/;
const jStillPath = /\/j-flight-still(?:-[^/]*)?\.webp$/;

/* The picture's own box, from the ::before's computed insets — the one box a
 * script cannot ask a pseudo-element for directly — widened to its bounding
 * box at the given rotation. Screen pixels, like getBoundingClientRect. */
const jPictureBox = (node, degrees) => {
  const seat = node.getBoundingClientRect();
  const art = getComputedStyle(node, '::before');
  const width = parseFloat(art.width);
  const height = parseFloat(art.height);
  const centreX = parseFloat(art.left) + width / 2;
  const centreY = parseFloat(art.top) + height / 2;
  const turn = (Math.abs(degrees) * Math.PI) / 180;
  const halfWidth = (width * Math.cos(turn) + height * Math.sin(turn)) / 2;
  const halfHeight = (width * Math.sin(turn) + height * Math.cos(turn)) / 2;
  return {
    left: seat.left + centreX - halfWidth,
    right: seat.left + centreX + halfWidth,
    top: seat.top + centreY - halfHeight,
    bottom: seat.top + centreY + halfHeight,
  };
};

test('J flies off the name from one picture, covering no letter of it, with a gentle rock where motion is welcome and still where it is not (owner 2026-09-11 issue 314, 2026-10-16)', async ({
  browser,
}) => {
  const pictures = {};
  for (const motion of ['no-preference', 'reduce']) {
    const context = await browser.newContext({
      reducedMotion: motion === 'reduce' ? 'reduce' : 'no-preference',
    });
    const page = await context.newPage();
    /* Counted from before the navigation, so the picture's own first load is
       in the tally rather than only whatever a later viewport change
       provokes. */
    const requested = { sheet: [], still: [] };
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (jSheetPath.test(pathname)) requested.sheet.push(request.url());
      if (jStillPath.test(pathname)) requested.still.push(request.url());
    });
    await visit(page);
    /* 1440 is a monitor where his 120px ceiling binds; 1000 a smaller one
       at a smaller name; 721 and 720 straddle the page's 45rem phone
       breakpoint; 390 and 320 are phones, where his 48px floor binds. */
    for (const width of [1440, 1000, 721, 720, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await settled(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.locator('.j-flight'), `the page does not draw exactly one of him at ${width}px`).toHaveCount(1);
      /* HIS BOX IS RESERVED AND SQUARE, and its size is the one the source
         states: 0.46 of a name-size, but never past 120px — his flight is
         drawn in 80px frames, and the owner saw him pixelated at 253px — and
         never under 40px, so a phone still sees him, unless that would be
         more than 0.55 of a name-size, where he would reach the line above
         (styles.css, the name: min(0.55em, clamp(2.5rem, 0.46em, 7.5rem)) on
         the heading). Computed here from the name's own font size as the
         engine resolved it, so the share and every bound are one exact claim,
         held to half a pixel. This replaced half a name-size between 48px and
         120px (J beside the name, 2026-10-19), "0.78 to 0.82 of the name"
         before it and "more than 0.45 of the name" before that. */
      const seat = await page.evaluate(() => {
        const node = window.document.querySelector('.j-flight');
        const box = node.getBoundingClientRect();
        const heading = window.document.querySelector('h1');
        return {
          width: box.width,
          height: box.height,
          name: parseFloat(getComputedStyle(heading).fontSize),
          rem: parseFloat(getComputedStyle(window.document.documentElement).fontSize),
        };
      });
      expect(Math.abs(seat.width - seat.height), `J's box is ${seat.width}x${seat.height} at ${width}px, not square`).toBeLessThan(0.5);
      const stated = Math.min(0.55 * seat.name, Math.min(7.5 * seat.rem, Math.max(2.5 * seat.rem, 0.46 * seat.name)));
      expect(
        Math.abs(seat.width - stated),
        `J is ${seat.width}px beside a ${seat.name}px name at ${width}px; the source states ${stated}px`
      ).toBeLessThanOrEqual(0.5);
      expect(seat.width, `J is drawn at ${seat.width}px at ${width}px, past the 120px his 80px frames allow`).toBeLessThanOrEqual(120 + subPixel);

      /* HE COVERS NO LETTER OF THE NAME, the page does not scroll sideways
         because of him, his picture stays inside the intro and inside the
         column's content box, the name is centred, and he is the dot of its j
         — each measured at the far ends of the rock, not wherever it happened
         to be: the rotation widens his body's box. Where the rock runs it is
         held at BOTH extremes in turn (the swing's start and its end); with
         the rock gone the still is level and measured once.

         ON INK. His drawn body is the part of his square from 0.075 to 0.8875
         across and 0.15 to 0.8875 down (measured off the still and every
         flight frame), turned about the square's centre by the rock. The
         letters' ink is read off the engine's own drawing of the face: the
         second word's baseline is his seat's top (a box with no font sits on
         the baseline), the first word's is one line above it, the x-height is
         the face's drawn x, and the dotless j's stem is found by drawing the
         letter and reading its ink half way up the x-height. The name has no
         ascender in its second word and no descender in its first, so between
         the first line's baseline and the second's x-height there is no ink
         at all — and his body must stay inside that band, over the stem.

         THE NAME IS CENTRED (owner, 2026-10-20: J no longer keeps a room at
         its end): the heading's middle is the intro's middle within 2px. This
         REPLACES "the name and J are one centred group" (2026-10-19), which
         REPLACED "the name starts at the column's start". */
      const extremes = motion === 'reduce' ? [null] : [0, 1];
      for (const extreme of extremes) {
        /* Hold the rock (where it runs) and read the angle the engine drew. */
        const degrees = await page.evaluate((at) => {
          const node = window.document.querySelector('.j-flight');
          if (at !== null) {
            for (const animation of node.getAnimations({ subtree: true })) {
              if (!/j-rock/.test(animation.animationName)) continue;
              animation.pause();
              const swing = animation.effect.getComputedTiming().duration;
              animation.currentTime = at === 0 ? 0 : swing - 1;
            }
          }
          const matrix = /^matrix\(([^,]+),\s*([^,]+),/.exec(getComputedStyle(node, '::before').transform);
          return matrix ? (Math.atan2(Number(matrix[2]), Number(matrix[1])) * 180) / Math.PI : 0;
        }, extreme);
        const picture = await page.locator('.j-flight').evaluate(jPictureBox, degrees);
        /* Measure the page there, then let the rock run again. */
        const measured = await page.evaluate((turned) => {
          const heading = window.document.querySelector('h1');
          const size = parseFloat(getComputedStyle(heading).fontSize);
          /* The name's lines: the distinct rows its text is drawn on, J's own
             box aside. */
          const rows = new Set();
          const walker = window.document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            if (node.parentElement?.closest('.page-j') !== null) continue;
            const range = window.document.createRange();
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) {
              if (rect.width > 0) rows.add(Math.round(rect.top));
            }
          }
          /* The face, as this engine draws it. */
          const canvas = window.document.createElement('canvas');
          canvas.width = Math.ceil(size * 2);
          canvas.height = Math.ceil(size * 2);
          const ink = canvas.getContext('2d', { willReadFrequently: true });
          ink.font = `400 ${size}px 'Instrument Serif'`;
          const xHeight = ink.measureText('x').actualBoundingBoxAscent;
          const pad = size / 2;
          const base = size * 1.5;
          ink.fillText('\u0237', pad, base);
          const row = ink.getImageData(0, Math.round(base - xHeight / 2), canvas.width, 1).data;
          let first = -1;
          let last = -1;
          for (let x = 0; x < canvas.width; x += 1) {
            if (row[x * 4 + 3] > 128) {
              if (first < 0) first = x;
              last = x;
            }
          }
          const lineNodes = [...heading.querySelectorAll('.page-name-line')].map((node) => node.getBoundingClientRect());
          const seatNode = window.document.querySelector('.page-j-seat').getBoundingClientRect();
          const letterNode = window.document.querySelector('.page-name-j').getBoundingClientRect();
          const square = window.document.querySelector('.j-flight').getBoundingClientRect();
          /* His body, turned about the square's centre. */
          const centre = { x: square.left + square.width / 2, y: square.top + square.height / 2 };
          const corners = [
            [0.075, 0.15],
            [0.8875, 0.15],
            [0.075, 0.8875],
            [0.8875, 0.8875],
          ].map(([u, v]) => {
            const dx = (u - 0.5) * square.width;
            const dy = (v - 0.5) * square.height;
            const turn = (turned * Math.PI) / 180;
            return [centre.x + dx * Math.cos(turn) - dy * Math.sin(turn), centre.y + dx * Math.sin(turn) + dy * Math.cos(turn)];
          });
          const body = {
            left: Math.min(...corners.map(([x]) => x)),
            right: Math.max(...corners.map(([x]) => x)),
            top: Math.min(...corners.map(([, y]) => y)),
            bottom: Math.max(...corners.map(([, y]) => y)),
          };
          const overflow = window.document.documentElement.scrollWidth - window.document.documentElement.clientWidth;
          const contentBox = (node) => {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return {
              left: rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
              right: rect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
              top: rect.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
            };
          };
          const introNode = window.document.querySelector('.page-intro');
          const intro = introNode.getBoundingClientRect();
          const name = heading.getBoundingClientRect();
          for (const animation of window.document.querySelector('.j-flight').getAnimations({ subtree: true })) {
            animation.play();
          }
          const secondBaseline = seatNode.top;
          return {
            rows: rows.size,
            size,
            xHeight,
            stem: first < 0 ? null : letterNode.left + ((first + last) / 2 - pad),
            body,
            secondBaseline,
            firstBaseline: secondBaseline - (lineNodes[1].top - lineNodes[0].top),
            overflow,
            viewport: window.document.documentElement.clientWidth,
            intro: { left: intro.left, right: intro.right, top: intro.top, bottom: intro.bottom },
            introContent: contentBox(introNode),
            column: contentBox(window.document.querySelector('main')),
            name: { left: name.left, right: name.right },
          };
        }, degrees);
        const where = `at ${width}px${extreme === null ? '' : ` with the rock held at its ${extreme === 0 ? 'start' : 'end'} (${degrees.toFixed(2)}°)`}`;
        expect(measured.rows, `the name is not two lines ${where}`).toBe(2);
        expect(measured.overflow, `the page scrolls ${measured.overflow}px sideways ${where}`).toBeLessThanOrEqual(0);
        expect(picture.right, `J's picture runs past the viewport's end ${where}`).toBeLessThanOrEqual(measured.viewport + subPixel);
        /* No ink of the name under his body. */
        const xLine = measured.secondBaseline - measured.xHeight;
        expect(
          measured.body.bottom,
          `J's feet reach ${(measured.body.bottom - xLine).toFixed(1)}px into the second line's letters ${where}`
        ).toBeLessThanOrEqual(xLine + subPixel);
        expect(
          measured.body.top,
          `J's head reaches ${(measured.firstBaseline - measured.body.top).toFixed(1)}px into the first line's letters ${where}`
        ).toBeGreaterThanOrEqual(measured.firstBaseline - subPixel);
        /* The dot of the j: over its stem, and hovering a breath over the
           x-height — no more than a tenth of a name-size — rather than
           anywhere in the band. */
        expect(measured.stem, `the dotless j drew no stem to measure ${where}`).not.toBeNull();
        const bodyMiddle = (measured.body.left + measured.body.right) / 2;
        expect(
          Math.abs(bodyMiddle - measured.stem),
          `J is ${(bodyMiddle - measured.stem).toFixed(1)}px off the j's stem ${where}`
        ).toBeLessThanOrEqual(2);
        expect(
          xLine - measured.body.bottom,
          `J hovers ${(xLine - measured.body.bottom).toFixed(1)}px over the x-height ${where}, too far to be its dot`
        ).toBeLessThanOrEqual(0.1 * measured.size);
        /* The name is centred. */
        const nameMiddle = (measured.name.left + measured.name.right) / 2;
        const introMiddle = (measured.introContent.left + measured.introContent.right) / 2;
        expect(
          Math.abs(nameMiddle - introMiddle),
          `the name spans ${measured.name.left.toFixed(1)}-${measured.name.right.toFixed(1)}px, centred ${(nameMiddle - introMiddle).toFixed(1)}px off the intro's middle ${where}`
        ).toBeLessThanOrEqual(2);
        /* In his seat: inside the intro, inside the column. */
        for (const [edge, inside] of [
          ['left', picture.left >= measured.intro.left - subPixel],
          ['right', picture.right <= measured.intro.right + subPixel],
          ['top', picture.top >= measured.intro.top - subPixel],
          ['bottom', picture.bottom <= measured.intro.bottom + subPixel],
        ]) {
          expect(inside, `J's picture leaves the intro on its ${edge} ${where}: ${JSON.stringify(picture)} in ${JSON.stringify(measured.intro)}`).toBe(true);
        }
        for (const [edge, inside] of [
          ['start', picture.left >= measured.column.left - subPixel],
          ['end', picture.right <= measured.column.right + subPixel],
          ['top', picture.top >= measured.column.top - subPixel],
        ]) {
          expect(inside, `J's picture runs into the sheet's margin at its ${edge} ${where}: ${JSON.stringify(picture)} in ${JSON.stringify(measured.column)}`).toBe(true);
        }
      }
      /* THE PICTURE TAKES NO POINTER: a press at his very centre lands on
         whatever is under him, never on him. */
      const pressed = await page.evaluate(() => {
        const box = window.document.querySelector('.j-flight').getBoundingClientRect();
        return (
          window.document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest('.j-flight, .page-j') !==
          null
        );
      });
      expect(pressed, `a press on J at ${width}px lands on his picture`).toBe(false);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await settled(page);
    /* ONE PICTURE, AND THE RIGHT ONE. One distinct URL requested at most once;
       a set of one already requires at least one request, so the pair is exact
       without pinning a count an engine's preload heuristics could
       legitimately change. The OTHER picture is never asked for: the sheet is
       the cost of the flight and only a reader who welcomes the flight pays
       it, and a reader who does gets no still on top. */
    const [drawn, skipped] = motion === 'reduce' ? ['still', 'sheet'] : ['sheet', 'still'];
    expect(
      new Set(requested[drawn]).size,
      `the page asked for ${new Set(requested[drawn]).size} different ${drawn} files with motion ${motion}: ${[...new Set(requested[drawn])].join(', ')}`
    ).toBe(1);
    expect(
      requested[drawn].length,
      `the ${drawn} was requested ${requested[drawn].length} times with motion ${motion}`
    ).toBeLessThanOrEqual(1);
    expect(requested[skipped], `the ${skipped} was downloaded with motion ${motion}, where nothing draws it`).toHaveLength(0);

    const mark = page.locator('.j-flight');
    const declared = await mark.evaluate((node) => {
      const art = getComputedStyle(node, '::before');
      return {
        name: art.animationName,
        timing: art.animationTimingFunction,
        direction: art.animationDirection,
        position: art.backgroundPosition,
        artTransform: art.transform,
        cell: parseFloat(art.width),
        transform: getComputedStyle(node).transform,
        image: art.backgroundImage,
        hidden: node.getAttribute('aria-hidden'),
      };
    });
    /* AS RENDERED: the flight faces screen-left, which from the room beside
       the name is toward it, so his box carries no flip — the mirrored seat
       left with the row it faced into. */
    expect(declared.transform, `J's box computed transform "${declared.transform}"; he is flipped`).toBe('none');
    /* THE SPRITE REALLY MOVES AND HE REALLY ROCKS, sampled rather than
       reasoned: every animation frame for 1200ms, counting the DISTINCT
       background positions and the rotation an engine actually computed for
       the picture. A declaration that named the keyframes but never advanced —
       a sheet that failed to load, an engine that dropped a var() inside
       @keyframes — passes every source pin and fails here. The flight draws a
       new cell every 16.67ms, so 1200ms is up to 72 cells; the floor is 8 on a
       desktop engine and 4 on the emulated phones, whose hosted runners paint
       fewer frames. */
    const sampled = await mark.evaluate(
      (node) =>
        new Promise((done) => {
          const positions = new Set();
          const angles = [];
          const opened = performance.now();
          const sample = () => {
            const art = getComputedStyle(node, '::before');
            positions.add(art.backgroundPosition);
            const matrix = /^matrix\(([^,]+),\s*([^,]+),/.exec(art.transform);
            angles.push(matrix ? (Math.atan2(Number(matrix[2]), Number(matrix[1])) * 180) / Math.PI : 0);
            if (performance.now() - opened < 1200) requestAnimationFrame(sample);
            else done({ positions: [...positions], angles });
          };
          requestAnimationFrame(sample);
        })
    );

    if (motion === 'reduce') {
      expect(declared.name, `J animates (${declared.name}) with the reader's motion reduced`).toBe('none');
      expect(sampled.positions, `J advanced through ${sampled.positions.length} positions with the reader's motion reduced`).toHaveLength(1);
      expect(declared.artTransform, `J leans (${declared.artTransform}) with the reader's motion reduced`).toBe('none');
      /* He is the still, drawn from its own origin — the pose, not a blank
         box. */
      expect(declared.position, `J rests at ${declared.position} rather than at the still's own origin`).toMatch(
        /^0(?:px|%)? 0(?:px|%)?$/
      );
    } else {
      for (const keyframes of ['j-flight-row', 'j-flight-sheet', 'j-rock']) {
        expect(declared.name, `J computed animation-name "${declared.name}", which does not include ${keyframes}`).toContain(keyframes);
      }
      /* steps() for the sprite, not a tween: a sprite has no in-between state,
         and an interpolating timing function paints two half-frames at once.
         The rock is the one smooth motion, and it swings back. */
      expect(declared.timing, `J has tweened frames, or a rock that is not a smooth swing (${declared.timing})`).toMatch(
        /^steps\(20(?:, (?:jump-)?end)?\), steps\(24(?:, (?:jump-)?end)?\), ease-in-out$/
      );
      expect(declared.direction, `J does not rock back and forth (${declared.direction})`).toMatch(/, alternate$/);
      const floor = test.info().project.use.isMobile ? 4 : 8;
      expect(
        sampled.positions.length,
        `J drew only ${sampled.positions.length} distinct frames in 1200ms (floor ${floor}): ${sampled.positions.slice(0, 4).join(' / ')}`
      ).toBeGreaterThanOrEqual(floor);
      /* AND EVERY ONE OF THEM IS A WHOLE CELL: each position the engine
         computed is a whole number of cells into the 20 x 24 grid, so the
         picture never shows the edges of two frames at once. The cell is the
         picture's own square, read from the engine. */
      for (const position of sampled.positions) {
        const offsets = /^(-?[\d.]+)px (-?[\d.]+)px$/.exec(position);
        expect(offsets, `J computed a position "${position}" this lane cannot read as pixels`).not.toBeNull();
        for (const [axis, cells, count] of [
          ['column', -Number(offsets[1]) / declared.cell, 20],
          ['row', -Number(offsets[2]) / declared.cell, 24],
        ]) {
          expect(Math.abs(cells - Math.round(cells)), `J drew ${position}, ${cells} ${axis}s into the sheet rather than a whole cell`).toBeLessThan(0.02);
          expect(Math.round(cells), `J drew ${position}, off the sheet's ${count} ${axis}s`).toBeGreaterThanOrEqual(0);
          expect(Math.round(cells), `J drew ${position}, off the sheet's ${count} ${axis}s`).toBeLessThan(count);
        }
      }
      /* THE ROCK IS REAL AND SUBTLE: the picture's rotation changes over the
         sample, and never passes a few degrees either way. */
      const [least, most] = [Math.min(...sampled.angles), Math.max(...sampled.angles)];
      expect(most - least, `J did not rock in 1200ms (${least.toFixed(2)}° to ${most.toFixed(2)}°)`).toBeGreaterThan(0.2);
      expect(Math.max(Math.abs(least), Math.abs(most)), 'J leans past a few degrees').toBeLessThanOrEqual(6);
    }

    /* ...AND IT IS THE PICTURE THE NETWORK SAW, asked of the element rather
       than of the request log: a picture under some other name would slip
       past a name-based tally. */
    expect(declared.image, `J does not draw the ${drawn}`).toMatch(
      motion === 'reduce' ? /j-flight-still(?:-[^/]*)?\.webp/ : /j-flight(?!-still)(?:-[^/]*)?\.webp/
    );
    pictures[drawn] = /url\("?([^")]+)"?\)/.exec(declared.image)[1];

    /* AND THE ENGINE CAN DECODE IT (review of #359, F4). Every check above
       reads a name, a header, a request or a computed position, and all of
       them stay green on a file whose pixels are gone: so the picture is
       decoded here and held to its intrinsic size — the sheet's 20 x 24 cells
       of 80 x 80, the still's one cell — and the same bytes with their image
       chunk zeroed are decoded too and must be REFUSED, which is what proves
       this decode tells a picture from a corpse in this engine rather than
       passing whatever it is handed. createImageBitmap reads a Blob directly,
       so the page's image policy is not what decides it. */
    const decoded = await page.evaluate(async (url) => {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const decode = async (data) => {
        try {
          const bitmap = await createImageBitmap(new Blob([data], { type: 'image/webp' }));
          const size = [bitmap.width, bitmap.height];
          bitmap.close();
          return size;
        } catch {
          return null;
        }
      };
      const corrupt = bytes.slice();
      const view = new DataView(corrupt.buffer);
      let zeroed = 0;
      for (let at = 12; at + 8 <= corrupt.length; ) {
        const fourcc = String.fromCharCode(...corrupt.subarray(at, at + 4));
        const size = view.getUint32(at + 4, true);
        if (fourcc === 'VP8 ' || fourcc === 'VP8L') {
          corrupt.fill(0, at + 8, at + 8 + size);
          zeroed += size;
        }
        at += 8 + size + (size % 2);
      }
      return { size: await decode(bytes), corrupt: await decode(corrupt), zeroed };
    }, pictures[drawn]);
    expect(decoded.size, `the ${drawn} does not decode in this engine`).toEqual(
      motion === 'reduce' ? [80, 80] : [80 * 20, 80 * 24]
    );
    expect(decoded.zeroed, `no image chunk was found in the ${drawn} to corrupt`).toBeGreaterThan(0);
    expect(decoded.corrupt, `the ${drawn} with its image chunk zeroed still decoded, so this check proves nothing`).toBeNull();

    /* THE STILL IS FRAME 0. Both pictures are known by now (the flight was
       resolved in the first context), so the still is decoded beside the
       sheet's first cell and the two are compared pixel by pixel: a still
       that drifted from the frame the flight starts from — a different pose,
       a re-render, a crop off by a cell — is a reader with less motion seeing
       a different dragon. Fetched only after the request tally above, so the
       comparison never counts as the page asking for the sheet. */
    if (motion === 'reduce') {
      const difference = await page.evaluate(async ({ sheet, still }) => {
        const pixels = async (url, crop) => {
          const blob = await (await fetch(url)).blob();
          const bitmap = await createImageBitmap(blob, 0, 0, crop, crop);
          const canvas = new OffscreenCanvas(crop, crop);
          const context = canvas.getContext('2d');
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          return context.getImageData(0, 0, crop, crop).data;
        };
        const [a, b] = await Promise.all([pixels(sheet, 80), pixels(still, 80)]);
        let total = 0;
        let worst = 0;
        let ink = 0;
        for (let index = 0; index < a.length; index += 1) {
          const gap = Math.abs(a[index] - b[index]);
          total += gap;
          worst = Math.max(worst, gap);
          if (index % 4 === 3 && b[index] > 0) ink += 1;
        }
        return { mean: total / a.length, worst, ink };
      }, pictures);
      expect(difference.ink, 'the still has no visible pixels, so comparing it proves nothing').toBeGreaterThan(400);
      expect(
        difference.mean,
        `the still differs from the flight's first frame by ${difference.mean.toFixed(3)}/255 on average (worst ${difference.worst})`
      ).toBeLessThan(1);
    }

    /* SILENT AND UNREACHABLE: a decorative dragon beside the name adds no
       stop to the keyboard order and no name to the accessibility tree. Asked
       of the markup rather than by pressing Tab, because engines in this
       matrix disagree about whether a plain link is tabbable and that
       disagreement would decide the result instead of the change under test.
       The name's block holds no stop at all — as it did before the sky's
       control briefly sat in it on 2026-10-19 — and he is inside the heading
       now, so the heading's accessible name is asked for exactly the name:
       a picture that leaked a name of its own into it fails there. */
    expect(declared.hidden, 'J is no longer hidden from assistive technology').toBe('true');
    const stops = await page.evaluate(() =>
      [...window.document.querySelector('.page-intro').querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].map(
        (node) => node.outerHTML.slice(0, 80)
      )
    );
    expect(stops, 'the name’s own block holds a keyboard stop; J is decoration').toEqual([]);
    await expect(page.getByRole('heading', { level: 1, name: 'Samuel Naranjo', exact: true })).toHaveCount(1);
    await context.close();
  }
});

/* RETIRED WITH THE NAV (owner direction, 2026-10-16: "do away with it for
 * now"): "the section links are centred on the chrome row, not on what its two
 * ends leave over". Its subject was the row's three-column grid and the links
 * in its middle; the row, its two ends and the links are all gone, so there is
 * nothing left to centre. */

test('a phone still renders the single full-width column it always did', async ({ page }) => {
  await visit(page);
  for (const width of phoneWidths) {
    await page.setViewportSize({ width, height: 800 });
    await settled(page);
    const observed = await page.evaluate(() => {
      const stack = window.document.querySelector('.panel-stack');
      const main = window.document.querySelector('main');
      /* A box's content width, from the engine's own computed padding: the
         sheet and the tracker board are framed and padded since THE KEEP
         (owner direction, 2026-10-16), so "full width" is a claim about the
         column's border box and "fills it" a claim about what sits inside its
         content box. */
      const inner = (node) => {
        const style = getComputedStyle(node);
        return node.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      };
      return {
        viewport: window.document.documentElement.clientWidth,
        column: main.getBoundingClientRect().width,
        content: inner(main),
        stack: stack.getBoundingClientRect().width,
        stackContent: inner(stack),
        tracks: getComputedStyle(stack).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
        sections: [...window.document.querySelectorAll('.page-section')].map(
          (section) => Math.round(section.getBoundingClientRect().width * 100) / 100
        ),
        cards: [...stack.querySelectorAll('.panel-shell')].map(
          (card) => Math.round(card.getBoundingClientRect().width * 100) / 100
        ),
      };
    });
    /* Exactly one column, full width, at every phone size — the presentation
       the owner praised and the desktop change was required not to touch. A
       tiling rule whose card minimum could not shrink would report two
       columns here, or one column wider than the screen. */
    expect(
      observed.tracks,
      `a ${width}px phone lays out ${observed.tracks} columns of panels`
    ).toBe(1);
    /* THE FULL WIDTH, two gutters and nothing else (owner defect report, issue
       264, 2026-08-31: on a phone the page showed a dead strip roughly 60px
       wide down its inline end). Issue 241 had subtracted a third term here —
       the 44px lane the page reserved for the fixed reading-mode control — and
       that lane is retired: issue 264 glued the control to the document, and
       the control itself went with the footer (owner, 2026-10-19), so nothing
       has to be held back for it.

       THE COLUMN carries that claim now, and what is inside it carries the
       rest (THE KEEP, owner direction, 2026-10-16): the sheet's frame and
       padding sit inside the column, so the column's own box is still two
       gutters short of the screen and nothing else, every section fills the
       sheet's content box, and every tracker fills the framed board's. A dead
       strip reopened anywhere in that chain fails at the level it opened. */
    const expected = observed.viewport - gutterPx;
    expect(observed.column, `the column is ${observed.column}px on a ${width}px phone`).toBeCloseTo(expected, 0);
    for (const section of observed.sections) {
      expect(section, `a section is ${section}px in a ${observed.content}px sheet at ${width}px`).toBeCloseTo(
        observed.content,
        0
      );
    }
    expect(observed.stack, `the tracker board is ${observed.stack}px in a ${observed.content}px sheet at ${width}px`).toBeCloseTo(
      observed.content,
      0
    );
    expect(observed.cards.length, 'the tracker board holds no cards to measure').toBeGreaterThan(0);
    for (const card of observed.cards) {
      expect(card, `a card is ${card}px wide in a ${observed.stackContent}px board on a ${width}px phone`).toBeCloseTo(
        observed.stackContent,
        0
      );
    }
    /* The footer control's own check stood here — inside the column, and
       carried by the document rather than the viewport — and it went with the
       footer (owner, 2026-10-19): there is no control left for a corner or a
       scroll to cover. */
  }
});

/* SVG SHAPES ARE MEASURED BY THEIR GEOMETRY. Gecko reports an SVG shape's
   getBoundingClientRect with its STROKE included and Blink and WebKit do
   not, so a hollow (outlined) day, the picked day's outline or the line's
   own stroke read as a bigger, shifted box in Firefox only — measured: a
   hollow first day at 11.52px against a filled one at 10.57px, and "15
   rows" of days at 320px. Each lane that measures a shape maps its
   geometry (getBBox, through getScreenCTM) to the viewport instead, which
   is the same number in every engine. */

/* THE CALENDAR OPENS ON ITS NEWEST WEEK, AND THE GRAPH COVERS EXACTLY THE
 * WEEKS IT SHOWS (owner direction, 2026-10-16; this lane was "every strip
 * opens on its newest data and scrolls back for history").
 *
 * The heatmap strips it measured were scrollers: a year of columns in a box a
 * phone could not hold, opened at the right-hand end so the newest day was on
 * screen. The trackers are one diagram now, and its calendar does not scroll —
 * it draws as many whole weeks as its box holds, newest last — and the graph
 * above it is that calendar read as a line (owner: "make the graph represent
 * the entire heatmap not just a subsection"), so the span buttons that once
 * reached back for history are gone with it. What the old claim was for is
 * asked of the new shape at the phone floor, a phone and a desktop:
 *
 *   - THE NEWEST DAY IS ON SCREEN: the day marked as today is drawn, inside the
 *     calendar's own box, in its last column;
 *   - THE GRAPH AND THE CALENDAR ARE ONE RULER: their boxes share both edges
 *     to the pixel, the line STARTS over the calendar's first column and ENDS
 *     over the column of the newest day it measured — each end inside its
 *     column's slot, measured from the cells' own spacing rather than from any
 *     number this file states (the newest MEASURED day, not today: a feed that
 *     stopped leaves its later days hollow, and a line has nothing to draw
 *     there);
 *   - AND THE OLDEST DAY SHOWN IS REACHABLE: Home walks the graph to the first
 *     day it reports, and the cell it picks is in the calendar's first column. */
test('the calendar opens on its newest week, and the graph covers exactly the weeks it shows (owner 2026-10-16)', async ({
  page,
}) => {
  await visit(page);
  const chart = page.locator('.chronicle-chart');
  for (const width of [320, 393, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    const opened = await page.evaluate(() => {
      const shapeBox = (node) => {
        if (node instanceof SVGGraphicsElement && node.ownerSVGElement !== null) {
          const bbox = node.getBBox();
          const matrix = node.getScreenCTM();
          const a = new DOMPoint(bbox.x, bbox.y).matrixTransform(matrix);
          const b = new DOMPoint(bbox.x + bbox.width, bbox.y + bbox.height).matrixTransform(matrix);
          const left = Math.min(a.x, b.x);
          const top = Math.min(a.y, b.y);
          const width = Math.abs(b.x - a.x);
          const height = Math.abs(b.y - a.y);
          return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top };
        }
        return node.getBoundingClientRect();
      };
      const calendar = window.document.querySelector('.chronicle-calendar');
      const cells = [...window.document.querySelectorAll('.chronicle-cell')].map((cell) => {
        const box = shapeBox(cell);
        return { left: box.left, right: box.right, today: cell.getAttribute('data-today') === 'true' };
      });
      const frame = calendar.getBoundingClientRect();
      const today = cells.filter((cell) => cell.today);
      return {
        cells: cells.length,
        today: today.length,
        todayLeft: today[0]?.left ?? null,
        todayRight: today[0]?.right ?? null,
        lastColumn: Math.max(...cells.map((cell) => cell.left)),
        frameLeft: frame.left,
        frameRight: frame.right,
      };
    });
    expect(opened.cells, `the calendar drew no days at ${width}px`).toBeGreaterThan(0);
    expect(opened.today, `the calendar marks ${opened.today} days as today at ${width}px`).toBe(1);
    expect(
      opened.todayLeft,
      `today sits at ${opened.todayLeft}px while the newest column is at ${opened.lastColumn}px (${width}px)`
    ).toBeCloseTo(opened.lastColumn, 1);
    expect(opened.todayLeft, `today is drawn before the calendar's start at ${width}px`).toBeGreaterThanOrEqual(
      opened.frameLeft - subPixel
    );
    expect(opened.todayRight, `today is drawn past the calendar's end at ${width}px`).toBeLessThanOrEqual(
      opened.frameRight + subPixel
    );

    /* ONE RULER: the boxes, then the line's own two ends over their columns.
       The diagram has to have finished drawing itself first — the line writes
       itself on arrival where motion is welcome. */
    await chart.scrollIntoViewIfNeeded();
    await expect(page.locator('.chronicle')).toHaveAttribute('data-shown', 'true');
    await diagramAtRest(page);
    const ruler = await page.evaluate(() => {
      const shapeBox = (node) => {
        if (node instanceof SVGGraphicsElement && node.ownerSVGElement !== null) {
          const bbox = node.getBBox();
          const matrix = node.getScreenCTM();
          const a = new DOMPoint(bbox.x, bbox.y).matrixTransform(matrix);
          const b = new DOMPoint(bbox.x + bbox.width, bbox.y + bbox.height).matrixTransform(matrix);
          const left = Math.min(a.x, b.x);
          const top = Math.min(a.y, b.y);
          const width = Math.abs(b.x - a.x);
          const height = Math.abs(b.y - a.y);
          return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top };
        }
        return node.getBoundingClientRect();
      };
      const chartBox = window.document.querySelector('.chronicle-chart').getBoundingClientRect();
      const calendarBox = window.document.querySelector('.chronicle-calendar').getBoundingClientRect();
      const svg = window.document.querySelector('.chronicle-chart svg');
      const line = window.document.querySelector('.chronicle-plot .chronicle-line:not(.chronicle-ahead)');
      const cells = [...window.document.querySelectorAll('.chronicle-cell')].map((cell) => ({
        box: shapeBox(cell),
        measured: cell.getAttribute('data-measured') === 'true',
      }));
      const lefts = [...new Set(cells.map((cell) => Math.round(cell.box.left * 100) / 100))].sort((a, b) => a - b);
      /* A column's slot is its cell widened by half the gap to the next
         column on each side: the stretch of the ruler that column owns. */
      const width = cells[0]?.box.width ?? 0;
      const gutter = lefts.length > 1 ? (lefts[1] - lefts[0] - width) / 2 : 0;
      /* The cells are drawn in day order, so the last measured one is the
         newest day the layer has a reading for. */
      const newest = cells.filter((cell) => cell.measured).at(-1)?.box ?? null;
      let lineBox = null;
      if (svg !== null && line !== null) {
        const origin = svg.getBoundingClientRect();
        const scale = origin.width / (svg.viewBox.baseVal?.width || origin.width);
        const bbox = line.getBBox();
        lineBox = { left: origin.left + bbox.x * scale, right: origin.left + (bbox.x + bbox.width) * scale };
      }
      return {
        chart: { left: chartBox.left, right: chartBox.right },
        calendar: { left: calendarBox.left, right: calendarBox.right },
        firstSlot: lefts.length === 0 ? null : { left: lefts[0] - gutter, right: lefts[0] + width + gutter },
        newestSlot: newest === null ? null : { left: newest.left - gutter, right: newest.right + gutter },
        line: lineBox,
      };
    });
    const at = `at ${width}px`;
    expect(ruler.chart.left, `the graph starts ${(ruler.chart.left - ruler.calendar.left).toFixed(2)}px off the calendar ${at}`).toBeGreaterThanOrEqual(ruler.calendar.left - 1);
    expect(ruler.chart.left).toBeLessThanOrEqual(ruler.calendar.left + 1);
    expect(ruler.chart.right, `the graph ends ${(ruler.chart.right - ruler.calendar.right).toFixed(2)}px off the calendar ${at}`).toBeGreaterThanOrEqual(ruler.calendar.right - 1);
    expect(ruler.chart.right).toBeLessThanOrEqual(ruler.calendar.right + 1);
    expect(ruler.line, `the graph plots no line ${at}`).not.toBeNull();
    expect(ruler.firstSlot, `the calendar drew no first column ${at}`).not.toBeNull();
    expect(ruler.newestSlot, `the calendar measured no day ${at}`).not.toBeNull();
    expect(
      ruler.line.left,
      `the line starts at ${ruler.line.left.toFixed(2)}px, outside the calendar's first column [${ruler.firstSlot.left.toFixed(2)}, ${ruler.firstSlot.right.toFixed(2)}] ${at}`
    ).toBeGreaterThanOrEqual(ruler.firstSlot.left - subPixel);
    expect(ruler.line.left).toBeLessThanOrEqual(ruler.firstSlot.right + subPixel);
    expect(
      ruler.line.right,
      `the line ends at ${ruler.line.right.toFixed(2)}px, outside the newest measured day's column [${ruler.newestSlot.left.toFixed(2)}, ${ruler.newestSlot.right.toFixed(2)}] ${at}`
    ).toBeGreaterThanOrEqual(ruler.newestSlot.left - subPixel);
    expect(ruler.line.right).toBeLessThanOrEqual(ruler.newestSlot.right + subPixel);

    /* The oldest day shown, from the keyboard. */
    await chart.focus();
    await chart.press('Home');
    await expect(chart).toHaveAttribute('aria-valuenow', (await chart.getAttribute('aria-valuemin')) ?? '');
    const picked = await page.evaluate(() => {
      const shapeBox = (node) => {
        if (node instanceof SVGGraphicsElement && node.ownerSVGElement !== null) {
          const bbox = node.getBBox();
          const matrix = node.getScreenCTM();
          const a = new DOMPoint(bbox.x, bbox.y).matrixTransform(matrix);
          const b = new DOMPoint(bbox.x + bbox.width, bbox.y + bbox.height).matrixTransform(matrix);
          const left = Math.min(a.x, b.x);
          const top = Math.min(a.y, b.y);
          const width = Math.abs(b.x - a.x);
          const height = Math.abs(b.y - a.y);
          return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top };
        }
        return node.getBoundingClientRect();
      };
      const cells = [...window.document.querySelectorAll('.chronicle-cell')];
      const first = Math.min(...cells.map((cell) => shapeBox(cell).left));
      const chosen = window.document.querySelector('.chronicle-cell[data-picked="true"]');
      return { first, left: chosen === null ? null : shapeBox(chosen).left };
    });
    expect(picked.left, `Home picked no cell ${at}`).not.toBeNull();
    expect(picked.left, `Home picked a cell outside the calendar's first column ${at}`).toBeCloseTo(picked.first, 1);
    await chart.press('Escape');
  }
});

/* THE CALENDAR FILLS ITS COLUMN WITH WHOLE, SQUARE DAYS (owner direction,
 * 2026-10-16; this lane was "every graph occupies exactly the width its class
 * prescribes", and it carries the claims of the retired "the calendar fills its
 * card, and its day bound still stops and squares a day").
 *
 * The heatmap component those lanes measured — its content-sized and
 * full-width classes, its weekday gutter, its less/more key inside the block,
 * the day bound a caller could set — is gone with the strips. What the owner's
 * rulings behind them were FOR is a property of any calendar and is measured
 * here on the one the page draws now, at the phone floor, a phone, and two
 * desktops:
 *
 *   - IT FILLS ITS COLUMN (issue 178's dead gap, and the no-dead-space rule):
 *     the drawing spans the plotting column edge to edge, exactly as wide as
 *     the graph above it, so the calendar and the line read on one ruler;
 *   - A DAY IS A SQUARE (issue 158's refusal of bar-chart days), at every
 *     width the box can take;
 *   - THE WEEKS ARE WHOLE AND SEVEN DAYS TALL: every column the calendar draws
 *     holds the days it claims, no day spills past the drawing's own edges,
 *     and a narrow box draws fewer weeks rather than thinner ones — never
 *     fewer than a quarter's worth, never more than the year. */
test('the calendar fills its column with whole, square days at every width (owner 2026-10-16)', async ({
  page,
}) => {
  await visit(page);
  for (const width of [320, 390, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    const drawn = await page.evaluate((tolerance) => {
      const shapeBox = (node) => {
        if (node instanceof SVGGraphicsElement && node.ownerSVGElement !== null) {
          const bbox = node.getBBox();
          const matrix = node.getScreenCTM();
          const a = new DOMPoint(bbox.x, bbox.y).matrixTransform(matrix);
          const b = new DOMPoint(bbox.x + bbox.width, bbox.y + bbox.height).matrixTransform(matrix);
          const left = Math.min(a.x, b.x);
          const top = Math.min(a.y, b.y);
          const width = Math.abs(b.x - a.x);
          const height = Math.abs(b.y - a.y);
          return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top };
        }
        return node.getBoundingClientRect();
      };
      const round = (value) => Math.round(value * 100) / 100;
      const chart = window.document.querySelector('.chronicle-chart').getBoundingClientRect();
      const calendar = window.document.querySelector('.chronicle-calendar').getBoundingClientRect();
      const svg = window.document.querySelector('.chronicle-calendar svg').getBoundingClientRect();
      const cells = [...window.document.querySelectorAll('.chronicle-cell')].map((cell) => shapeBox(cell));
      const columns = new Set(cells.map((cell) => round(cell.left)));
      const rows = new Set(cells.map((cell) => round(cell.top)));
      return {
        chart: { left: round(chart.left), right: round(chart.right) },
        calendar: { left: round(calendar.left), right: round(calendar.right) },
        svg: { left: round(svg.left), right: round(svg.right), top: svg.top, bottom: svg.bottom },
        cells: cells.length,
        columns: columns.size,
        rows: rows.size,
        squares: cells.filter((cell) => Math.abs(cell.width - cell.height) > 0.05).length,
        smallest: Math.min(...cells.map((cell) => cell.width)),
        outside: cells.filter(
          (cell) =>
            cell.left < svg.left - tolerance ||
            cell.right > svg.right + tolerance ||
            cell.top < svg.top - tolerance ||
            cell.bottom > svg.bottom + tolerance
        ).length,
      };
    }, subPixel);
    const at = `at ${width}px`;
    expect(drawn.cells, `the calendar drew no days ${at}`).toBeGreaterThan(0);
    expect(drawn.calendar.left, `the calendar does not start where the graph does ${at}`).toBeCloseTo(drawn.chart.left, 1);
    expect(drawn.calendar.right, `the calendar stops short of the graph's end ${at}`).toBeCloseTo(drawn.chart.right, 1);
    expect(drawn.svg.left, `the drawing does not start at the calendar's edge ${at}`).toBeCloseTo(drawn.calendar.left, 1);
    expect(drawn.svg.right, `the drawing leaves a dead gap before the calendar's end ${at}`).toBeCloseTo(
      drawn.calendar.right,
      1
    );
    expect(drawn.squares, `${drawn.squares} days are not square ${at}`).toBe(0);
    expect(drawn.smallest, `a day is drawn ${drawn.smallest}px wide ${at}`).toBeGreaterThan(4);
    expect(drawn.outside, `${drawn.outside} days are drawn outside the calendar ${at}`).toBe(0);
    expect(drawn.rows, `the calendar is ${drawn.rows} days tall ${at}`).toBe(7);
    expect(drawn.columns, `the calendar draws ${drawn.columns} weeks ${at}`).toBeGreaterThanOrEqual(13);
    expect(drawn.columns, `the calendar draws ${drawn.columns} weeks ${at}`).toBeLessThanOrEqual(53);
    /* Whole weeks: every column but the newest holds all seven of its days. */
    expect(
      drawn.cells,
      `${drawn.cells} days in ${drawn.columns} columns ${at}; a column short of its week is a week the frame lost`
    ).toBeGreaterThan((drawn.columns - 1) * 7);
  }
});

/* RETIRED 2026-10-16 WITH THE STRIPS IT MEASURED: "every strip still holds all
 * of its own rows once the engine has taken its scrollbar" (issue 130). Its
 * subject was a heatmap strip that clipped a year behind its own horizontal
 * scrollbar inside a fixed box, and the measured gutter main.ts published for
 * it. The trackers' calendar is drawn to fit its box and never scrolls (owner
 * direction, 2026-10-16), so no box on the page reserves a scrollbar any more
 * and the gutter measurement left with it; the calendar's own fit — whole,
 * square days inside its drawing at every width — is measured by "the calendar
 * fills its column with whole, square days at every width". */

/* Re-serves the origin's own token-usage envelope with one source's series
 * replaced, so a lane can put a series of any length on the real page without
 * inventing a payload shape. `edit` receives the decoded envelope and mutates
 * it in place; everything it leaves alone is what the origin actually served.
 * Must be installed before the first navigation, so the panel's own fetch and
 * any read-back see the identical bytes. */
async function stageUsagePayload(page, edit) {
  await page.route('**/api/panels/token-usage', async (route) => {
    /* A request still in flight when the test ends is not a finding, and it
       must not be reported as one (issue 201). When a probe fails, Playwright
       tears the context down under whatever this handler was awaiting, and
       `route.fetch()` rejects with "Test ended" — which surfaced as a second,
       louder error beside the real one and sent the reader looking at the
       route instead of at the failure. Swallowing it here is not tolerance of
       a product fault: an aborted route serves nothing, so any assertion that
       depended on this payload still fails, and it fails on its own terms. */
    let response;
    try {
      response = await route.fetch();
    } catch {
      await route.abort().catch(() => {});
      return;
    }
    const envelope = await response.json();
    edit(envelope);
    const body = JSON.stringify(envelope);
    /* The origin's own headers, MINUS the length of the body it sent. Passing
       the upstream response through verbatim carries its content-length with
       it, and an edited envelope is a different number of bytes — a longer one
       arrives truncated and unparseable, which reads in a lane as "the page
       did not render it" and is really "the lane did not serve it". */
    const headers = { ...response.headers() };
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === 'content-length') delete headers[name];
    }
    await route.fulfill({ status: response.status(), headers, body });
  });
}

/* THE OWNER'S SIX-CARD BOARD, staged from the shipped vocabulary.
 *
 * The embedded snapshot this origin serves carries two sources with lifetime
 * figures, daily series, one lifetime split and both daily partitions, so
 * the board it draws is already six cards; the geometry lanes still stage
 * their own so what they measure never depends on which sample the snapshot
 * was last rebuilt from. This gives each source a split (one through the
 * lifetime accounting, one through the windowed partition, so BOTH kinds of
 * models card are on the board), a
 * window row and the session record, which is exactly the six the owner's
 * drawing lays out three by two.
 *
 * Every key comes from the vocabulary files rather than from a list typed
 * here, so the staged payload is one the origin could actually serve.
 *
 * `fullSplit` gives the lead source's lifetime split EVERY member of its own
 * vendor group, each with a full accounting line, which is the shape the owner
 * ruled on (2026-10-13, issue #369): more members than a card draws. Usage
 * rises through the vocabulary's order, so the rows the card keeps are the
 * group's LAST members and a cut taken before the sort would draw the wrong
 * ones. What it staged is returned, filled in when the page fetches. */
async function stageSixCards(page, { fullSplit = false } = {}) {
  const staged = {};
  await stageUsagePayload(page, (envelope) => {
    const sources = envelope?.data?.sources ?? [];
    expect(
      sources.length,
      'the origin serves fewer than two usage sources; this lane cannot lay out six cards'
    ).toBeGreaterThan(1);
    const [lead, follower] = sources;
    /* Each source's rows come from its OWN vendor group (issue #369). */
    const [first, second] = ownGroup(lead.label).members.map((member) => member.key);
    const [third, fourth] = ownGroup(follower.label).members.map((member) => member.key);
    lead.windows = [{ period: 'today', inputTokens: 12_900_000, outputTokens: 49_500 }];
    lead.stats = [
      ...(lead.stats ?? []),
      { key: 'longest-session', label: 'Longest session', value: 150_900, unit: 'seconds' },
    ];
    lead.modelStats = [
      { key: first, totals: { input: 2, output: 3, 'cache-read': 60, 'cache-write': 5 } },
      { key: second, totals: { input: 1, output: 1, 'cache-read': 26, 'cache-write': 2 } },
    ];
    if (fullSplit) {
      const members = ownGroup(lead.label).members.map((member) => member.key);
      lead.modelStats = members.map((key, index) => ({
        key,
        totals: {
          input: (index + 1) * 1_200_000,
          output: (index + 1) * 45_000,
          'cache-read': (index + 1) * 96_000_000,
          'cache-write': (index + 1) * 3_100_000,
        },
      }));
      staged.splitName = sourceName(lead.label);
      staged.splitMembers = members.length;
    }
    follower.windows = [{ period: 'week', inputTokens: 3_300_000_000, outputTokens: 4_300_000 }];
    /* The SAME start as the lead's own series, so the two overlap and the
       total card has a combined line to draw: the intersection rule is proven
       in the unit suite, and a staged board that never overlapped would leave
       this lane measuring a card with no chart on it. */
    follower.series = {
      startDate: lead.series?.startDate ?? '2026-08-10',
      totals: [5, 8, 5, 9, 12, 7, 5],
      recorded: true,
      models: [
        { key: third, totals: [4, 6, 4, 7, 9, 5, 4] },
        { key: fourth, totals: [1, 2, 1, 2, 3, 2, 1] },
      ],
    };
  });
  return staged;
}

/* A synthetic daily series of `days` days, ending today. Values ramp so the
 * five-level magnitude ramp has something to quantize; the shape is what the
 * lane is about, not the numbers. */
function syntheticSeries(days) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return {
    startDate: start.toISOString().slice(0, 10),
    totals: Array.from({ length: days }, (_, day) => (day % 5) * 1000 + 1),
    recorded: true,
  };
}

/* ONE CALENDAR, EVERY LAYER (owner directive, 2026-09-03, issue 287, SPEC 8.8;
 * re-aimed 2026-10-16 at the trackers' one diagram, whose calendar the reader
 * paints with a LAYER where the old section cycled a SEGMENT).
 *
 * The claim is unchanged and so is its reason: every set the calendar can show
 * — the version-control contributions and each token source's daily series —
 * is drawn on ONE window, so a layer switch changes what the days say and
 * never which days are drawn, and the sets stay comparable. It is measured by
 * pressing every layer on a real page: the same days, in the same columns,
 * under the same month names. A set placed on a window of its own fails every
 * one of them.
 *
 * And the coverage moves the DATA, never the FRAME. The first source's series
 * is restaged at three very different lengths — a fortnight, most of a year,
 * far past the window — and its layer must draw more measured days as the
 * capture grows, while the calendar it draws them in does not move: the same
 * days, the same months, and a long capture cut at the window's OLDEST end so
 * the newest day is the one a short capture drew too. Measured at a desktop
 * width, where the calendar shows the whole year: a phone shows its newest
 * weeks only (see "the calendar opens on its newest week"), which would cap
 * every coverage at the same count and prove nothing about the window. */
test('every layer paints ONE calendar, and coverage moves the data rather than the frame (owner 2026-09-03, issue 287; 2026-10-16)', async ({
  page,
}) => {
  const shapes = [15, 200, 900];
  const measured = [];
  let stagedLabel = '';
  for (const days of shapes) {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await stageUsagePayload(page, (envelope) => {
      const sources = envelope?.data?.sources ?? [];
      expect(sources.length, 'the origin serves fewer than two usage sources').toBeGreaterThan(1);
      stagedLabel = sourceName(sources[0].label);
      sources[0].series = syntheticSeries(days);
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await visit(page);
    await expect(page.locator('.chronicle-cell').first()).toBeAttached();
    const layers = page.locator('.chronicle-layers button');
    const count = await layers.count();
    expect(
      count,
      `the diagram offers ${count} calendar layer(s) at ${days} days; an identity claim needs at least two to compare`
    ).toBeGreaterThan(1);
    const sets = [];
    for (let index = 0; index < count; index += 1) {
      await layers.nth(index).click();
      await expect(layers.nth(index)).toHaveAttribute('aria-pressed', 'true');
      sets.push(
        await page.evaluate(() => {
          const cells = [...window.document.querySelectorAll('.chronicle-cell')];
          const measuredCells = cells.filter((cell) => cell.getAttribute('data-measured') === 'true');
          const pressed = window.document.querySelector('.chronicle-layers button[aria-pressed="true"]');
          return {
            label: pressed?.textContent.trim() ?? '',
            cells: cells.length,
            /* THE WINDOW'S OWN CALENDAR, fingerprinted the way a reader reads
               it: each month's name and the drawing coordinate it sits at.
               Two layers that agree here are drawing the same weeks in the
               same places. */
            calendar: [...window.document.querySelectorAll('.chronicle-month')]
              .map((month) => `${month.textContent}@${month.getAttribute('x')}`)
              .join('|'),
            frame: window.document.querySelector('.chronicle-calendar svg').getAttribute('viewBox'),
            realCount: measuredCells.length,
            /* The newest measured day, as its place in the window. */
            realLast: cells.lastIndexOf(measuredCells[measuredCells.length - 1]),
          };
        })
      );
    }
    measured.push({ days, sets });
  }

  for (const shape of measured) {
    const [lead, ...others] = shape.sets;
    expect(lead.cells, `"${lead.label}" drew ${lead.cells} days at ${shape.days} days`).toBeGreaterThan(7);
    expect(lead.calendar.length, 'the calendar named no months to compare').toBeGreaterThan(0);
    for (const other of others) {
      expect(
        other.cells,
        `at ${shape.days} days "${lead.label}" drew ${lead.cells} days and "${other.label}" drew ${other.cells}`
      ).toBe(lead.cells);
      expect(other.frame, `"${other.label}" drew in a different frame from "${lead.label}"`).toBe(lead.frame);
      expect(
        other.calendar,
        `at ${shape.days} days "${other.label}" and "${lead.label}" drew different calendars`
      ).toBe(lead.calendar);
    }
  }

  expect(stagedLabel, 'the staged source has no name to find its layer by').not.toBe('');
  const staged = measured.map((shape) => {
    const set = shape.sets.find((candidate) => candidate.label === stagedLabel);
    expect(set, `no "${stagedLabel}" layer at ${shape.days} days`).toBeDefined();
    return set;
  });
  const [short, middle, deep] = staged;
  expect(
    middle.realCount,
    `two hundred days measured ${middle.realCount} days, no more than the fortnight's ${short.realCount}`
  ).toBeGreaterThan(short.realCount);
  expect(
    deep.realCount,
    `nine hundred days measured ${deep.realCount} days, no more than two hundred days' ${middle.realCount}`
  ).toBeGreaterThan(middle.realCount);
  /* The window is a CAP, and a trailing one. */
  expect(deep.realCount, `nine hundred days measured ${deep.realCount}; the window is cutting nothing`).toBeLessThan(900);
  expect(deep.realLast, 'the capped window does not end on the newest day the short capture drew').toBe(
    short.realLast
  );
  expect(short.realLast, 'no measured day to compare').toBeGreaterThanOrEqual(0);
  /* ...and through all of that the frame never moved. */
  expect(
    new Set(staged.map((set) => set.cells)).size,
    `the staged layer drew ${staged.map((set) => set.cells).join(', ')} days across the three coverages; the window is being sized to the data again`
  ).toBe(1);
  expect(
    new Set(staged.map((set) => set.calendar)).size,
    'the staged layer drew different months at a different coverage; the window is being sized to the data again'
  ).toBe(1);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/* AN UNMEASURED SHARE DRAWS NOTHING, MEASURED (issue 246, finding 1).
 *
 * The insight rows carry a proportion each, and a source may report one it
 * never measured. The honest-states floor says such a figure serves null and
 * renders as a dash rather than as a zero — and the row must draw NO FILL AT
 * ALL, not a zero-width one, because a zero-width fill is pixel-identical to
 * a measured 0% and the row would look like a measurement while the reading
 * beside it says otherwise.
 *
 * The component states that in a guard (`{#if insight.fillPct !== null}`) and
 * the data half is pinned in tests/token-usage.test.mjs — an unmeasured share
 * becomes a null fillPct and a "--" reading. The RENDER half was pinned at no
 * layer at all, which is the review finding: removing that guard and
 * rendering the fill unconditionally left every suite green.
 *
 * So this lane asks a real engine what it actually painted. Both directions,
 * because "no fill" alone is satisfied by a component that draws no bars for
 * anybody. */
/* A MEMBER THAT CARRIED NOTHING IS NOT A ROW (owner directive, 2026-09-11).
 *
 * This lane used to measure the opposite half of the same rule: a share the
 * data could not support drew no FILL, because a zero-width fill is
 * pixel-identical to a measured 0%. The board no longer has that state to
 * draw — the adapter drops a member with no tokens and the residual with it,
 * so every row that reaches a card has a positive total and a fill it can
 * honestly draw. The rule did not relax; it moved up, from a guard in the
 * component to a state that cannot be constructed, and this is the measured
 * half of THAT: what the engine actually drew for the rows that survived.
 */
test('every model row an account draws is a real member with a real rule', async ({ page }) => {
  /* RE-AIMED 2026-10-16: the board's cards became the diagram's accounts
     (owner direction), and each source's model rows moved with them — the
     same rows, built by the same adapter, drawn as `.chronicle-model`. */
  /* The rows are staged on the first served source, so they are members of
     that source's own vendor group (issue #369). */
  let group = null;
  const classes = (count) => ({ input: count, output: 0, 'cache-read': 0, 'cache-write': 0 });
  /* BOTH kinds of card, because they are two quantities (issue #267): a
     source that reports its LIFETIME split per model (`modelStats`) shows
     shares of that, and one that reports only the daily partition shows the
     window summed per member. The served payload carries the first for its
     first source, so a lane that staged the partition alone would be
     measuring rows it never staged. Same two members, same 4:1, both ways. */
  for (const lifetime of [true, false]) {
    await stageUsagePayload(page, (envelope) => {
      const sources = envelope?.data?.sources ?? [];
      expect(sources.length, 'the origin serves no usage source to restage').toBeGreaterThan(0);
      envelope.data.sources = [sources[0]];
      group = ownGroup(sources[0].label);
      const [big, small] = group.members.map((member) => member.key);
      sources[0].series = {
        startDate: '2026-06-01',
        totals: [5, 5, 5],
        recorded: true,
        models: [
          { key: big, totals: [4, 4, 4] },
          { key: small, totals: [1, 1, 1] },
        ],
      };
      if (lifetime) {
        sources[0].modelStats = [
          { key: big, totals: classes(4) },
          { key: small, totals: classes(1) },
        ];
      } else {
        delete sources[0].modelStats;
      }
    });
    await visit(page);
    const rows = page.locator('.chronicle-account .chronicle-model');
    await expect(rows, `${lifetime ? 'lifetime' : 'window'}: the account did not draw exactly the two staged members`).toHaveCount(2);
    const observed = await rows.evaluateAll((nodes) =>
      nodes.map((node) => {
        const fill = node.querySelector('.chronicle-fill');
        const track = node.querySelector('.chronicle-track');
        const width = (box) =>
          box === null ? null : Math.round(box.getBoundingClientRect().width * 100) / 100;
        return {
          label: node.querySelector('.chronicle-model-name').textContent.trim(),
          reading: node.querySelector('.chronicle-model-reading').textContent.trim(),
          fill: width(fill),
          // The track is always present — it is the groove — so it is the
          // control that proves the row rendered at all.
          track: width(track),
        };
      })
    );
    const [largest, lesser] = observed;
    expect(largest.label, 'the rows did not render in the vocabulary order').toBe(
      group.members[0].label
    );
    for (const row of observed) {
      expect(row.track, `"${row.label}" drew no groove; this lane cannot tell a bar from nothing`).toBeGreaterThan(0);
      expect(row.fill, `"${row.label}" painted no bar at all`).toBeGreaterThan(0);
      expect(row.fill, `"${row.label}" painted past its own track`).toBeLessThanOrEqual(
        row.track + subPixel
      );
      expect(row.reading, `"${row.label}" printed a nought share`).not.toBe('0%');
      expect(row.reading.length, `"${row.label}" printed no reading beside its rule`).toBeGreaterThan(0);
      /* The reading says WHICH quantity it is: a lifetime row is a share of
         the whole, a window row is the member's own count — never a share of
         a window dressed as a share of a lifetime. */
      if (lifetime) {
        expect(row.reading, `"${row.label}" printed no share of the lifetime`).toMatch(/%$/);
      } else {
        expect(row.reading, `"${row.label}" printed a window as if it were a lifetime share`).not.toMatch(/%$/);
      }
    }
    /* THE LONGEST ROW RUNS THE ACCOUNT'S FULL WIDTH and the rest are read against
       it, which is what makes the rules comparable without a scale.

       A ROW IS A SWORD since 2026-10-19 ("we should have swords"): the hilt
       (13px) and the point (6px) are always whole, and only the blade between
       them carries the share, so a bar is 19px plus the share of the rest of
       its track — held here to that formula within a pixel, which replaced
       "a quarter of the track to within 0.05" (a ratio a 19px sword part
       shifts by several hundredths on a phone). The share is the member's
       total against the largest member's (token-usage.ts: "against the
       LARGEST member, not against the sum"), so the staged 4:1 is a full
       sword and a quarter blade — NOT the printed percent, which on a
       lifetime card is each member's share of the source's whole lifetime. */
    const sword = (track, share) => 19 + (track - 19) * share;
    for (const [row, share] of [
      [largest, 1],
      [lesser, 0.25],
    ]) {
      expect(
        Math.abs(row.fill - sword(row.track, share)),
        `"${row.label}" draws a ${row.fill}px sword in a ${row.track}px track; a share of ${share} is ${sword(row.track, share).toFixed(2)}px`
      ).toBeLessThanOrEqual(1);
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

/* AN ACCOUNT THAT HIDES A ROW IS AN ACCOUNT THAT LIES (owner directive,
 * 2026-09-03, issue 287; the model-row ruling of 2026-10-13, issue #369;
 * re-aimed 2026-10-16 when the board's cards became the diagram's accounts).
 *
 * The lane this replaces measured the board's cards: fixed boxes whose
 * `overflow: hidden` made a sizing mistake SILENT, and a models card that drew
 * only the rows its grid row left it. The accounts under the diagram are not
 * boxes of a fixed height — each grows to its own facts and rows — so the
 * board-specific half of the ruling (a models card never setting its grid
 * row's height, the rows spread through a card's slack) has no subject any
 * more. What the rulings were FOR still does, and is measured here at a phone
 * width and a desktop one:
 *
 *   - every fact an account prints is inside the account's own box, and no
 *     account holds more content than it shows;
 *   - every model row is painted WHOLE — never cut through its name or its
 *     rule by an ancestor that clips — inside its account, across the full
 *     width of its list, and in the list's own rhythm (one gap token between
 *     each pair, so no row is crowded and none floats);
 *   - the source staged with every member of its group reaches the page as the
 *     adapter's five rows, and all five are shown (issue #369: "just show the
 *     top 4-5");
 *   - and every account wears ONE paint (issue 323). */
test('every account shows its content whole, and the full split as the five rows it was handed (owner 2026-09-03, 2026-10-13, 2026-10-16)', async ({
  page,
}) => {
  const handed = 5;
  const staged = await stageSixCards(page, { fullSplit: true });
  await visit(page);
  expect(staged.splitMembers, 'the staged split has no more members than an account draws; the cut is not on the page').toBeGreaterThan(
    handed
  );
  const readAccounts = () =>
    page.evaluate(() =>
      [...window.document.querySelectorAll('.chronicle-account')].map((account) => {
        const box = account.getBoundingClientRect();
        const list = account.querySelector('.chronicle-models');
        const lane = list?.getBoundingClientRect().width ?? 0;
        const rows = [...account.querySelectorAll('.chronicle-model')];
        const facts = [...account.querySelectorAll('.chronicle-fact')];
        const inside = (node) => {
          const seat = node.getBoundingClientRect();
          return (
            seat.top >= box.top - 1 && seat.bottom <= box.bottom + 1 && seat.left >= box.left - 1 && seat.right <= box.right + 1
          );
        };
        /* What of a row the engine can paint: its box cut by every ancestor
           whose computed overflow clips, up to the root. */
        const whole = (node) => {
          const seat = node.getBoundingClientRect();
          let clip = { top: seat.top, bottom: seat.bottom, left: seat.left, right: seat.right };
          for (let up = node.parentElement; up !== null; up = up.parentElement) {
            const style = getComputedStyle(up);
            if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
            const frame = up.getBoundingClientRect();
            clip = {
              top: Math.max(clip.top, frame.top),
              bottom: Math.min(clip.bottom, frame.bottom),
              left: Math.max(clip.left, frame.left),
              right: Math.min(clip.right, frame.right),
            };
          }
          return (
            clip.top <= seat.top + 1 && clip.bottom >= seat.bottom - 1 && clip.left <= seat.left + 1 && clip.right >= seat.right - 1
          );
        };
        const seats = rows.map((row) => row.getBoundingClientRect());
        return {
          label: account.querySelector('.chronicle-account-name')?.textContent.trim() ?? '',
          paint: getComputedStyle(account).backgroundColor,
          ink: getComputedStyle(account).color,
          scrollHeight: account.scrollHeight,
          clientHeight: account.clientHeight,
          facts: facts.length,
          factsShown: facts.filter(inside).length,
          rows: rows.map((row, index) => ({
            whole: whole(row),
            inside: inside(row),
            ownWhole: row.scrollHeight <= row.clientHeight + 1,
            spans: seats[index].width >= lane - 1,
          })),
          gap: list === null ? 0 : Number.parseFloat(getComputedStyle(list).rowGap),
          between: seats.slice(1).map((seat, index) => seat.top - seats[index].bottom),
        };
      })
    );

  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    const observed = await readAccounts();
    const at = `at ${width}px`;
    expect(observed.length, `the diagram drew fewer than two accounts ${at}`).toBeGreaterThan(1);
    for (const account of observed) {
      expect(
        account.scrollHeight,
        `"${account.label}" holds ${account.scrollHeight}px of content in a ${account.clientHeight}px account ${at}`
      ).toBeLessThanOrEqual(account.clientHeight + 1);
      expect(account.factsShown, `"${account.label}" prints ${account.facts} facts ${at} and shows ${account.factsShown}`).toBe(
        account.facts
      );
      account.rows.forEach((row, index) => {
        expect(row.whole, `"${account.label}" paints model row ${index + 1} cut off ${at}`).toBe(true);
        expect(row.inside, `"${account.label}" paints model row ${index + 1} outside its account ${at}`).toBe(true);
        expect(row.ownWhole, `"${account.label}" model row ${index + 1} clips its own name or rule ${at}`).toBe(true);
        expect(row.spans, `"${account.label}" model row ${index + 1} does not span its list ${at}`).toBe(true);
      });
      for (const space of account.between) {
        expect(
          Math.abs(space - account.gap),
          `"${account.label}" spaces two model rows ${space}px apart against a ${account.gap}px gap ${at}`
        ).toBeLessThanOrEqual(1);
      }
    }
    const split = observed.find((account) => account.label.endsWith(staged.splitName));
    expect(split, `no account is headed by "${staged.splitName}" ${at}`).toBeTruthy();
    expect(
      split.rows.length,
      `the ${staged.splitMembers}-member split reached the page as ${split.rows.length} rows ${at}`
    ).toBe(handed);
    /* Non-vacuity: accounts that all held a single short figure would satisfy
       everything above without exercising the shapes that clipped. */
    expect(Math.max(...observed.map((account) => account.facts)), `no account prints a fact ladder ${at}`).toBeGreaterThan(1);
    const paints = new Set(observed.map((account) => `${account.paint} on ${account.ink}`));
    expect([...paints], `the accounts wear ${paints.size} different paints ${at}; every one must wear one`).toHaveLength(1);
  }
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/* THE DIAGRAM FILLS ITS BOARD, AND ITS ACCOUNTS ARE THE LEAVES OF A TOME
 * CENTRED ON ITS WALL (the no-dead-space rule; this lane was "the board is
 * three cards across in two equal rows, filling the column", re-aimed
 * 2026-10-16 when the six cards became the trackers' one diagram and its
 * accounts, and again 2026-10-20 when the accounts became the chained tome:
 * owner, T3, "the corbel").
 *
 * Measured rather than declared, and measured the way the gallery's fill lane
 * is: edges against edges and boxes against each other, so no token value can
 * satisfy it by moving expectation and behaviour together. The diagram reaches
 * both edges of its framed board and the tome's wall both edges of the
 * diagram — the room either side of the book is the corbel's and the chain's,
 * not dead space — and the book stands in the middle of it. On a desktop an
 * opening's two leaves are equal, meet at the gutter and reach the book's
 * page edges, and every leaf lies in its side's one place; on a phone every
 * leaf lies in the one page's place and spans it, and nothing takes the
 * document sideways. */
test('the diagram fills its board, and its accounts are the leaves of a tome centred on it (owner 2026-09-11; 2026-10-16; 2026-10-20)', async ({
  page,
}) => {
  await stageSixCards(page);
  await visit(page);
  const read = () =>
    page.evaluate(() => {
      const round = (value) => Math.round(value * 100) / 100;
      const board = window.document.querySelector('#trackers .panel-stack');
      const style = getComputedStyle(board);
      const boardBox = board.getBoundingClientRect();
      const inner = {
        left: boardBox.left + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft),
        right: boardBox.right - Number.parseFloat(style.borderRightWidth) - Number.parseFloat(style.paddingRight),
      };
      const chronicle = window.document.querySelector('.chronicle').getBoundingClientRect();
      const grid = window.document.querySelector('.chronicle-accounts').getBoundingClientRect();
      const book = window.document.querySelector('.tome-book').getBoundingClientRect();
      const leaves = window.document.querySelector('.tome-pages').getBoundingClientRect();
      const accounts = [...window.document.querySelectorAll('.chronicle-account')].map((account) => {
        const box = account.getBoundingClientRect();
        return { x: round(box.x), y: round(box.y), width: round(box.width), right: round(box.right) };
      });
      const root = window.document.documentElement;
      return {
        board: { left: round(inner.left), right: round(inner.right) },
        chronicle: { left: round(chronicle.left), right: round(chronicle.right) },
        grid: { left: round(grid.left), right: round(grid.right) },
        book: { left: round(book.left), right: round(book.right) },
        leaves: { left: round(leaves.left), right: round(leaves.right) },
        accounts,
        rows: new Set(accounts.map((account) => Math.round(account.y))).size,
        columns: new Set(accounts.map((account) => Math.round(account.x))).size,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
      };
    });
  for (const width of desktopWidths) {
    await page.setViewportSize({ width, height: 1200 });
    await settled(page);
    const observed = await read();
    const at = `at ${width}px`;
    expect(observed.chronicle.left, `the diagram starts inside its board ${at}`).toBeCloseTo(observed.board.left, 0);
    expect(observed.chronicle.right, `the diagram stops short of its board ${at}`).toBeCloseTo(observed.board.right, 0);
    expect(observed.grid.left, `the tome's wall starts inside the diagram ${at}`).toBeCloseTo(observed.chronicle.left, 0);
    expect(observed.grid.right, `the tome's wall stops short of the diagram ${at}`).toBeCloseTo(observed.chronicle.right, 0);
    expect(
      Math.abs(observed.book.left - observed.grid.left - (observed.grid.right - observed.book.right)),
      `the tome stands ${observed.book.left - observed.grid.left}px from the left and ${observed.grid.right - observed.book.right}px from the right ${at}`
    ).toBeLessThanOrEqual(1);
    expect(observed.accounts.length, `the diagram drew ${observed.accounts.length} accounts ${at}`).toBeGreaterThan(1);
    expect(observed.rows, `the accounts laid out on ${observed.rows} rows ${at}`).toBe(1);
    expect(observed.columns, `the leaves lie in ${observed.columns} places rather than the opening's two ${at}`).toBe(2);
    const [left, right] = observed.accounts;
    expect(left.x, `the first leaf starts inside the book's pages ${at}`).toBeCloseTo(observed.leaves.left, 0);
    expect(right.right, `the second leaf stops short of the book's pages ${at}`).toBeCloseTo(observed.leaves.right, 0);
    expect(right.x, `the opening's two leaves do not meet at the gutter ${at}`).toBeCloseTo(left.right, 0);
    for (const [index, account] of observed.accounts.entries()) {
      expect(
        account.width,
        `account ${index + 1} is ${account.width}px against account 1's ${observed.accounts[0].width}px ${at}`
      ).toBeCloseTo(observed.accounts[0].width, 0);
    }
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await settled(page);
  const phone = await read();
  expect(phone.columns, 'the phone leaves are not a single page').toBe(1);
  expect(phone.rows, 'a phone turns one page at a time, and its leaves lie in more than one place').toBe(1);
  for (const account of phone.accounts) {
    expect(account.width, 'a phone leaf does not span the book\u2019s page').toBeCloseTo(phone.leaves.right - phone.leaves.left, 0);
  }
  expect(
    phone.scrollWidth,
    `the diagram takes the document ${phone.scrollWidth - phone.clientWidth}px sideways at 390px`
  ).toBeLessThanOrEqual(phone.clientWidth + 1);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/* THE GRAPH IS A SCRUBBER, AND READING IT MOVES NOTHING (owner directive,
 * 2026-09-11, issue 316: "as I run the mouse through this hovering or
 * clicking, I expected to see more information, like you can in Robinhood when
 * looking at a stock price... the value should update accordingly also on the
 * card"; re-aimed 2026-10-16 at the trackers' one diagram, whose graph took
 * over every board card's daily line: "look at what options robinhood gives to
 * view the graph and how it moves/behaves").
 *
 * THE FIGURES ARE KNOWN WITHOUT A SECOND FORMATTER. The staged series is a
 * week of small integers on ONE source, so the diagram's daily token figure is
 * that series itself, below the magnitude floor, and this lane states each
 * reading outright instead of re-implementing the formatter and then proving
 * nothing when both copies drift together.
 *
 * THE FIGURE IS THE PICKED SOURCE'S OWN (owner, 2026-10-21, issue 385: the
 * figures "follow the picked seal"). A second source reports a quiet week of
 * its own beside the staged one, so a token figure that summed the sources
 * — the retired "Total Tokens Used" — reads one more than the staged day
 * and fails, where with one source alone a sum and a source are the same
 * number and the lane could not tell them apart.
 *
 * ZERO CLS IS MEASURED RATHER THAN DECLARED, and it is measured where a shift
 * would land: every figure beside the graph changes its text while a day is
 * read, so the graph, the calendar, the controls, the accounts, every headline
 * box and the document's own height are read before and during the scrub and
 * must be identical. The figure and its caption ARE the reading — their text
 * changes, so their boxes change width — and they are held to the edge they are
 * read from instead, which is the claim a reader can check with their eyes.
 * Chromium's layout-shift observer is the second channel where it exists. */

/* The staged week: [days back from the newest day, the figure that day reads].
 * Five days apart and carrying different values, so a cursor stuck at one end
 * reads as a failure rather than a coincidence. */
const stagedWeek = [5, 8, 5, 9, 12, 7, 5];
const scrubbedDays = [
  [5, '8'],
  [1, '7'],
];

/* The week a second source reports beside the staged one: one token a day,
 * every day of the staged week. Where either seal falls in the roll's order
 * is the vocabulary's to say, so the lanes press the staged one by its name
 * (pickTokenLayer) and switch to another by what it is, never by position. */
const besideWeek = stagedWeek.map(() => 1);

/* One source, one week ending today: the diagram's daily token figure is then
 * exactly this series. With `beside`, the origin's second source stays too,
 * reporting that week over the same days. Returns the staged source's key,
 * filled in once the payload is served. */
async function stageChronicleWeek(page, totals = stagedWeek, beside = null) {
  const staged = { label: null };
  await stageUsagePayload(page, (envelope) => {
    const sources = envelope?.data?.sources ?? [];
    expect(sources.length, 'the origin serves no usage source to restage').toBeGreaterThan(beside === null ? 0 : 1);
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - (totals.length - 1));
    const series = (values) => ({ startDate: start.toISOString().slice(0, 10), totals: values, recorded: true });
    envelope.data.sources = beside === null ? [sources[0]] : [sources[0], sources[1]];
    sources[0].series = series(totals);
    if (beside !== null) sources[1].series = series(beside);
    staged.label = sources[0].label;
  });
  return staged;
}

/* Wait until the diagram has finished arriving: its graph writes itself and
 * its days come in as a wave the first time it is seen, and a box read inside
 * that wave is a box mid-flight. Infinite animations (today's slow glow) never
 * end and move nothing, so only the finite ones are waited for.
 *
 * THE ROLL OPENS FIRST (2026-10-20). The diagram is written on a roll that
 * unrolls from its middle the first time it is seen, and until it has, its
 * sheet is clipped — and a clip takes the pointer with it, so a day aimed at
 * near either end of the graph lands on nothing. The roll is seen a frame or
 * more after it is scrolled to, which is why its own flag is waited for
 * before the animations are gathered: gathered any earlier, the unroll is
 * not running yet and there is nothing to wait for. */
async function diagramAtRest(page) {
  await expect(page.locator('.chronicle'), 'the roll never opened: the diagram was never seen').toHaveAttribute(
    'data-shown',
    'true'
  );
  await page.evaluate(() => {
    const diagram = window.document.querySelector('.chronicle');
    return Promise.all(
      window.document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.target instanceof Element &&
            diagram?.contains(animation.effect.target) &&
            animation.effect.getComputedTiming().endTime !== Infinity
        )
        .map((animation) => animation.finished.catch(() => {}))
    );
  });
}

/* The headline that reads the token series, found by its own words rather
 * than by its place in the row. Since the figures follow the picked seal
 * (owner, 2026-10-21, issue 385) it is a token seal's first figure, its
 * source's tokens; the contributions' seal carries none. */
const tokenHeadline = (page) =>
  page.locator('.chronicle-headline').filter({ has: page.locator('.chronicle-label', { hasText: /token/i }) });

/* A string matched as itself inside a pattern. */
const literally = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Everything on the diagram whose position a reading could move, plus the
 * page's own height, to a hundredth of a pixel. */
function chronicleFrame(page) {
  return page.evaluate(() => {
    const round = (value) => Math.round(value * 100) / 100;
    const boxes = (selector) =>
      [...window.document.querySelectorAll(selector)].map((node) => {
        const box = node.getBoundingClientRect();
        return [round(box.x), round(box.y + window.scrollY), round(box.width), round(box.height)];
      });
    return {
      chronicle: boxes('.chronicle'),
      chart: boxes('.chronicle-chart'),
      calendar: boxes('.chronicle-calendar'),
      layers: boxes('.chronicle-layers'),
      keys: boxes('.chronicle-keys'),
      accounts: boxes('.chronicle-account'),
      headlines: boxes('.chronicle-headline'),
      height: window.document.documentElement.scrollHeight,
    };
  });
}

/* The two edges a reader reads a headline from: the figure's and the
 * caption's start edges and tops. */
function anchoredEdges(page) {
  return page.evaluate(() =>
    [...window.document.querySelectorAll('.chronicle-headline')].map((node) => {
      const round = (value) => Math.round(value * 100) / 100;
      const figure = node.querySelector('.chronicle-figure').getBoundingClientRect();
      const caption = node.querySelector('.chronicle-caption').getBoundingClientRect();
      return [round(figure.x), round(figure.y + window.scrollY), round(caption.x), round(caption.y + window.scrollY)];
    })
  );
}

/* Chromium's own shift accounting, where the engine has it, counting any entry
 * that names a node outside the reading itself (the figures and captions) and
 * outside the graph (whose cursor and date track the pointer on purpose). A
 * node the entry cannot name is counted too. */
async function watchShift(page) {
  return page.evaluate(() => {
    const supported =
      typeof PerformanceObserver !== 'undefined' && (PerformanceObserver.supportedEntryTypes ?? []).includes('layout-shift');
    if (!supported) {
      window.__shift = null;
      return false;
    }
    window.__shift = [];
    const reading = (node) =>
      node instanceof Element &&
      (node.closest('.chronicle-figure') !== null ||
        node.closest('.chronicle-caption') !== null ||
        node.closest('.chronicle-chart') !== null);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        const moved = [...(entry.sources ?? [])].filter((source) => !reading(source.node));
        if (moved.length === 0 && (entry.sources ?? []).length > 0) continue;
        window.__shift.push({
          value: entry.value,
          moved: moved.map(
            (source) => `${source.node?.tagName?.toLowerCase() ?? 'unnamed'}.${source.node?.getAttribute?.('class') ?? ''}`
          ),
        });
      }
    }).observe({ type: 'layout-shift', buffered: false });
    return true;
  });
}

/* Press the staged source's seal, found by its written name, so the graph
 * plots the series a lane staged and the figures beside it are that source's.
 * The graph follows the layer (owner direction, 2026-10-16), the figures
 * follow the seal (owner, 2026-10-21, issue 385), and a lane that reads a
 * token figure off the line has to be looking at its own source's line. The
 * roll opens on the vocabulary's first source, which the staged one need not
 * be, so the press is made and checked rather than trusted to the order. */
async function pickTokenLayer(page, label) {
  const name = sourceName(label);
  const seal = page.locator('.chronicle-layers button').filter({ hasText: new RegExp(`^\\s*${literally(name)}\\s*$`) });
  await expect(seal, `the diagram offers no "${name}" seal to pick`).toHaveCount(1);
  await seal.click();
  await expect(seal).toHaveAttribute('aria-pressed', 'true');
  await expect(
    tokenHeadline(page).locator('.chronicle-label'),
    `the token figure beside the "${name}" seal is not "${name}"'s own`
  ).toHaveText(new RegExp(`^\\s*${literally(name)} `));
}

/* Put the pointer on one day of the graph. The day a viewport x names is the
 * graph's own arithmetic, so the pointer is aimed by proportion and then
 * corrected against what the slider reports; the claim under test is what a
 * day READS, and an aim off by a pixel is not a finding.
 *
 * The correction BRACKETS rather than steps. The graph spans the calendar's
 * whole weeks, so the days after today in the newest week are drawn and read
 * as today: on a Sunday the right six sevenths of the last week answer the
 * newest day, and an aim taken from the slider's range lands there. Stepping
 * back half a day per try could not cross that in eight tries (every lane that
 * scrubbed to yesterday failed the CI run that began on Sunday 2026-10-18 UTC).
 * The day under the pointer never falls from left to right, so each reading
 * halves the span the day must lie in, whatever the graph's geometry. */
async function scrubTo(page, day) {
  const chart = page.locator('.chronicle-chart');
  const box = await chart.boundingBox();
  const start = Number(await chart.getAttribute('aria-valuemin'));
  const last = Number(await chart.getAttribute('aria-valuemax'));
  const y = box.y + box.height / 2;
  let left = box.x + 1;
  let right = box.x + box.width - 1;
  let x = box.x + ((day - start) / Math.max(1, last - start)) * box.width;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    x = Math.min(Math.max(x, left), right);
    await page.mouse.move(x, y);
    const now = Number(await chart.getAttribute('aria-valuenow'));
    if (now === day && (await chart.getAttribute('data-scrubbing')) === 'true') return;
    if (now < day) left = x;
    if (now > day) right = x;
    x = now === day ? x + 1 : (left + right) / 2;
  }
  expect(Number(await chart.getAttribute('aria-valuenow')), `the pointer could not be put on day ${day}`).toBe(day);
}

test('the graph scrubs to a day and every figure reads it, moving nothing (owner 2026-09-11, issue 316; 2026-10-16)', async ({
  page,
}) => {
  /* Two sources, the staged one leading: the figure each scrubbed day reads
     below is the staged source's own day, and a sum of the two would read one
     more (owner, 2026-10-21, issue 385). */
  const staged = await stageChronicleWeek(page, stagedWeek, besideWeek);
  await visit(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await settled(page);
    const chart = page.locator('.chronicle-chart');
    const figure = tokenHeadline(page).locator('.chronicle-figure');
    const caption = tokenHeadline(page).locator('.chronicle-caption');
    await expect(tokenHeadline(page), 'no headline reads the token series').toHaveCount(1);
    /* ON SCREEN BEFORE ANYTHING IS MEASURED: a pointer is driven in viewport
       coordinates, and the diagram sits below the fold at both widths. */
    await chart.scrollIntoViewIfNeeded();
    await diagramAtRest(page);
    await pickTokenLayer(page, staged.label);
    await page.mouse.move(0, 0);
    const last = Number(await chart.getAttribute('aria-valuemax'));
    const rest = (await figure.textContent()).trim();
    const restCaption = (await caption.textContent()).trim();
    expect(rest, 'the token headline carries no figure of its own to return to').not.toBe('');

    const observed = await watchShift(page);
    const before = await chronicleFrame(page);
    const anchors = await anchoredEdges(page);
    for (const [back, reading] of scrubbedDays) {
      const day = last - back;
      await scrubTo(page, day);
      await expect(figure, `the token figure did not follow the pointer onto day ${day} at ${width}px`).toHaveText(reading);
      /* The caption reads the day it is: a written date, never the machine's. */
      await expect(caption).toHaveText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
      const date = (await caption.textContent()).trim();
      /* OVER THE CURSOR, THE LAYER'S READING AND THE DAY (owner direction,
         2026-10-16): "<figure> <noun> · <date>", the token line's figure
         being the staged one. */
      const stamp = page.locator('.chronicle-stamp');
      await expect(stamp, 'no reading rides over the cursor').toHaveCount(1);
      await expect(stamp).toHaveText(`${reading} tokens · ${date}`);
      /* The graph says the same thing to a screen reader, once: the reading,
         then every headline's figure for that day. */
      await expect(chart).toHaveAttribute('aria-valuenow', String(day));
      await expect(chart).toHaveAttribute(
        'aria-valuetext',
        new RegExp(`^${reading} tokens · ${date}; .*[Tt]okens[^,;]* ${reading}(,|$)`)
      );
      await expect(page.locator('.chronicle-cursor'), 'no cursor is drawn on the read day').toHaveCount(1);
      expect(await chronicleFrame(page), `the diagram moved while day ${day} was read at ${width}px`).toEqual(before);
      expect(await anchoredEdges(page), `a reading moved off its own anchors while day ${day} was read at ${width}px`).toEqual(
        anchors
      );
    }

    /* AND IT GIVES THE FIGURES BACK. A reading that outlived the pointer would
       be a lifetime permanently showing one day of its own history. */
    await page.mouse.move(0, 0);
    await expect(figure).toHaveText(rest);
    await expect(caption).toHaveText(restCaption);
    await expect(chart).toHaveAttribute('data-scrubbing', 'false');
    await expect(page.locator('.chronicle-stamp')).toHaveCount(0);
    expect(await chronicleFrame(page), `the diagram moved when the pointer left at ${width}px`).toEqual(before);
    if (observed) {
      const shifts = await page.evaluate(() => window.__shift);
      expect(
        shifts,
        `the engine measured layout shift outside the reading at ${width}px: ${shifts
          .map((shift) => `${shift.value.toFixed(5)} (${shift.moved.join(', ')})`)
          .join('; ')}`
      ).toEqual([]);
    }
  }
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('the graph walks its days from the keyboard, clamped at both ends, and Escape gives the figures back (owner 2026-09-11, issue 316; 2026-10-16)', async ({
  page,
}) => {
  /* Two sources, the staged one leading: each day the keys reach reads the
     staged source's own figure, never the two summed (owner, 2026-10-21,
     issue 385: the figures follow the picked seal). */
  const staged = await stageChronicleWeek(page, stagedWeek, besideWeek);
  await visit(page);
  const chart = page.locator('.chronicle-chart');
  const figure = tokenHeadline(page).locator('.chronicle-figure');
  const seals = page.locator('.chronicle-layers button');
  /* Every figure beside the graph, with its label and caption, as read. */
  const figures = () =>
    page
      .locator('.chronicle-headline')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent.replace(/\s+/g, ' ').trim()));
  await chart.scrollIntoViewIfNeeded();
  await diagramAtRest(page);
  /* A seal that is not the staged source's, and its own figures, read at rest
     before any day is: the switch at the end of this lane must give back
     exactly these. Pressed the way that switch is, by a script that moves no
     focus. Found by its name, which a press never changes. */
  const other = seals
    .filter({ hasNotText: new RegExp(`^\\s*${literally(sourceName(staged.label))}\\s*$`) })
    .first();
  await other.evaluate((button) => button.click());
  await expect(other).toHaveAttribute('aria-pressed', 'true');
  const switchedRest = await figures();
  expect(switchedRest, 'the other seal carries no figures of its own to give back').not.toEqual([]);
  await pickTokenLayer(page, staged.label);
  await diagramAtRest(page);
  const first = Number(await chart.getAttribute('aria-valuemin'));
  const last = Number(await chart.getAttribute('aria-valuemax'));
  expect(last - first, 'the graph opens on a span of no days').toBeGreaterThan(stagedWeek.length);
  const rest = (await figure.textContent()).trim();
  await chart.focus();
  /* Focus alone reads nothing: the slider reports the newest day and the
     figures are still the span's own. */
  await expect(chart).toHaveAttribute('aria-valuenow', String(last));
  await expect(figure).toHaveText(rest);
  await expect(chart).toHaveAttribute('data-scrubbing', 'false');

  /* A cold first press opens on the newest day rather than jumping. */
  await chart.press('ArrowRight');
  await expect(chart).toHaveAttribute('aria-valuenow', String(last));
  await expect(figure).toHaveText(String(stagedWeek.at(-1)));
  await chart.press('ArrowLeft');
  await expect(chart).toHaveAttribute('aria-valuenow', String(last - 1));
  await expect(figure).toHaveText(String(stagedWeek.at(-2)));
  /* A week at a time, and a day nobody measured reads the dash, never a nought. */
  await chart.press('PageUp');
  await expect(chart).toHaveAttribute('aria-valuenow', String(last - 8));
  await expect(figure).toHaveText('—');
  await chart.press('Home');
  await expect(chart).toHaveAttribute('aria-valuenow', String(first));
  /* CLAMPED, NEVER WRAPPED: stepping back from the oldest day to the newest
     would read as time running backwards. */
  await chart.press('ArrowLeft');
  await expect(chart).toHaveAttribute('aria-valuenow', String(first));
  await chart.press('End');
  await expect(chart).toHaveAttribute('aria-valuenow', String(last));
  await chart.press('ArrowRight');
  await expect(chart).toHaveAttribute('aria-valuenow', String(last));
  await expect(chart).toHaveAttribute('data-scrubbing', 'true');
  /* Escape gives the figures back. */
  await chart.press('Escape');
  await expect(figure).toHaveText(rest);
  await expect(chart).toHaveAttribute('data-scrubbing', 'false');
  await expect(page.locator('.chronicle-stamp')).toHaveCount(0);
  /* And a layer switch is a new question: the reading does not survive it
     (the span switch this used to press is gone with the span buttons, owner
     direction 2026-10-16). Pressed WITHOUT taking focus off the graph — a
     script-dispatched click moves no focus — because leaving the graph
     clears the reading on its own, and a lane that clicked for real would
     pass for a switch that kept the reading. */
  await chart.press('ArrowLeft');
  await expect(chart).toHaveAttribute('data-scrubbing', 'true');
  await other.evaluate((button) => button.click());
  await expect(other).toHaveAttribute('aria-pressed', 'true');
  expect(
    await chart.evaluate((node) => window.document.activeElement === node),
    'the switch took focus off the graph; the clear below would prove nothing'
  ).toBe(true);
  await expect(chart).toHaveAttribute('data-scrubbing', 'false');
  /* The figures are the new seal's own now (owner, 2026-10-21), and every one
     of them reads at rest: a reading carried over would put the day just read
     on the new seal's line into its first figure and caption. */
  await expect
    .poll(figures, { message: 'a layer switch carried the reading onto the new seal\u2019s figures' })
    .toEqual(switchedRest);
  await expect(page.locator('.chronicle-stamp')).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('a refresh drops the reading rather than re-pointing it at a different day (owner 2026-09-11, issue 316; 2026-10-16)', async ({
  page,
}) => {
  /* A READING IS A READ OF THE CURRENT PAYLOAD, NEVER A REMEMBERED ONE. The
     page rebuilds the diagram on its own schedule — the thirty-second poll and
     the visibility catch-up — and a cursor left on a day of the old series
     would silently read a different figure, or none, from the new one. So the
     arrival takes the reading with it: the figures go back to the span's own
     and the graph back to reporting its newest day. The catch-up is driven
     rather than waited for. */
  let days = 7;
  let stagedLabel = null;
  await stageUsagePayload(page, (envelope) => {
    const sources = envelope?.data?.sources ?? [];
    envelope.data.sources = [sources[0]];
    stagedLabel = sources[0].label;
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - (days - 1));
    sources[0].series = {
      startDate: start.toISOString().slice(0, 10),
      totals: Array.from({ length: days }, (_, day) => day + 1),
      recorded: true,
    };
  });
  await visit(page);
  const chart = page.locator('.chronicle-chart');
  const figure = tokenHeadline(page).locator('.chronicle-figure');
  await chart.scrollIntoViewIfNeeded();
  await diagramAtRest(page);
  /* The token line is the one the shorter series redraws, and the token
     figure the one it reads: the staged source's own (owner, 2026-10-21). */
  await pickTokenLayer(page, stagedLabel);
  const rest = (await figure.textContent()).trim();
  const last = Number(await chart.getAttribute('aria-valuemax'));
  await scrubTo(page, last - 1);
  await expect(figure, 'the graph did not scrub before the refresh').toHaveText('6');
  const drawn = await page.locator('.chronicle-line').first().getAttribute('d');

  /* A SHORTER SERIES: the day the cursor named reads something else now. */
  days = 3;
  await page.evaluate(() => window.document.dispatchEvent(new Event('visibilitychange')));
  await expect
    .poll(() => page.locator('.chronicle-line').first().getAttribute('d'), { message: 'the shorter series never arrived' })
    .not.toBe(drawn);
  await expect(figure, 'the token figure kept a reading from a payload the page no longer holds').toHaveText(rest);
  await expect(chart).toHaveAttribute('data-scrubbing', 'false');
  await expect(chart, 'the graph still reports a day the reader is no longer reading').toHaveAttribute(
    'aria-valuenow',
    String(last)
  );
  await expect(page.locator('.chronicle-stamp')).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('a finger taps a day and the answer stays, without taking the page its scroll (owner 2026-09-11, issue 316; 2026-10-16)', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'this project emulates no touchscreen');
  await stageChronicleWeek(page);
  await visit(page);
  const chart = page.locator('.chronicle-chart');
  const figure = tokenHeadline(page).locator('.chronicle-figure');
  await chart.scrollIntoViewIfNeeded();
  await diagramAtRest(page);
  const box = await chart.boundingBox();
  const last = Number(await chart.getAttribute('aria-valuemax'));
  /* A TOUCH POINTER IS DESTROYED THE INSTANT IT LIFTS, so an answer cleared on
     leave would be readable for exactly as long as the finger covered it. The
     tap lands on the newest day's end of the graph, whichever day that names:
     the graph's last half pixel, because a day on a phone is about a pixel
     and a third wide (the line spans the calendar's weeks day by day), so
     two pixels in names the day before whenever the newest day ends its
     week — measured on a Saturday, 2026-10-17 UTC. */
  await page.touchscreen.tap(box.x + box.width - 0.5, box.y + box.height / 2);
  await expect(chart, 'a tap on the graph read no day').toHaveAttribute('data-scrubbing', 'true');
  await expect(chart).toHaveAttribute('aria-valuenow', String(last));
  await expect(figure).toHaveText(String(stagedWeek.at(-1)));
  /* AND THE CALENDAR ANSWERS A TAP TOO: the day under the finger is picked and
     named. */
  const cell = page.locator('.chronicle-cell[data-today="true"]');
  const cellBox = await cell.boundingBox();
  await page.touchscreen.tap(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2);
  await expect(cell, 'a tap on the calendar picked no day').toHaveAttribute('data-picked', 'true');
  await expect(figure).toHaveText(String(stagedWeek.at(-1)));
  /* THE PAGE KEEPS ITS OWN AXIS on both surfaces: the declaration is `pan-y`,
     and this is the engine confirming it rather than the sheet claiming it. */
  for (const surface of ['.chronicle-chart', '.chronicle-calendar']) {
    const action = await page.locator(surface).evaluate((node) => getComputedStyle(node).touchAction);
    expect(action, `${surface} declares touch-action: ${action}`).toBe('pan-y');
  }
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/* NOTHING ON THE DIAGRAM MOVES FOR A READER WHO ASKED FOR LESS MOTION (owner
 * direction, 2026-10-16: the graph writes itself and the calendar's days arrive
 * as a wave — inside the no-preference guard). The state is still all there —
 * a scrubbed day is drawn and named the same — and nothing travels into place:
 * the engine's own animation list for the diagram is EMPTY at rest, after a
 * scrub and after a layer switch (the span switch it also pressed is gone with
 * the span buttons, 2026-10-16). Both directions, because an empty list alone
 * is what a diagram with no motion anywhere would report: with motion welcome
 * the same diagram must be animating — on arrival, and again when a layer
 * switch writes the new line on (owner direction, 2026-10-16). */
test('the diagram runs no animation for a reader who asked for less motion, and still reads its days (owner 2026-10-16)', async ({
  browser,
}) => {
  const animating = (page) =>
    page.evaluate(() => {
      const diagram = window.document.querySelector('.chronicle');
      return window.document
        .getAnimations()
        .filter((animation) => animation.effect?.target instanceof Element && diagram.contains(animation.effect.target))
        .map((animation) => animation.animationName ?? animation.transitionProperty ?? 'animation');
    });
  for (const motion of ['reduce', 'no-preference']) {
    const context = await browser.newContext({ reducedMotion: motion });
    const page = await context.newPage();
    await stageChronicleWeek(page);
    await visit(page);
    const chart = page.locator('.chronicle-chart');
    await chart.scrollIntoViewIfNeeded();
    if (motion === 'no-preference') {
      await expect
        .poll(async () => (await animating(page)).length, { message: 'the diagram never animated with motion welcome; the reduced half proves nothing' })
        .toBeGreaterThan(0);
      /* A layer switch writes the new line on, the way the diagram first drew
         itself: once the arrival has finished, pressing a layer starts motion
         on the plot again. */
      await diagramAtRest(page);
      const plotting = () =>
        page.evaluate(() => {
          const plot = window.document.querySelector('.chronicle-plot');
          return window.document
            .getAnimations()
            .filter(
              (animation) =>
                animation.effect?.target instanceof Element &&
                plot !== null &&
                plot.contains(animation.effect.target) &&
                animation.playState === 'running'
            ).length;
        });
      /* Polled, not read once: the plot is drawn when the graph has measured
         its own box, which can be a frame after the calendar's wave began, so
         a single read straight after the wave can land inside the plot's own
         arrival (measured on WebKit). An arrival that never ends fails the
         poll. */
      await expect
        .poll(plotting, { message: 'the plot never came to rest after it arrived', timeout: 10_000 })
        .toBe(0);
      /* A real switch: a seal that is not the one down, whichever place in
         the roll's order it holds. */
      const seals = page.locator('.chronicle-layers button');
      const up = await seals.evaluateAll((nodes) => nodes.findIndex((node) => node.getAttribute('aria-pressed') !== 'true'));
      expect(up, 'every seal is down, so there is nothing to switch to').toBeGreaterThanOrEqual(0);
      const other = seals.nth(up);
      await other.click();
      await expect(other).toHaveAttribute('aria-pressed', 'true');
      await expect
        .poll(plotting, { message: 'a layer switch drew the new line with no write-on where motion is welcome' })
        .toBeGreaterThan(0);
      await context.close();
      continue;
    }
    /* The diagram has been seen, so whatever would animate on arrival has had
       its chance. */
    await expect(page.locator('.chronicle')).toHaveAttribute('data-shown', 'true');
    expect(await animating(page), 'the diagram animates at rest with motion reduced').toEqual([]);
    await scrubTo(page, Number(await chart.getAttribute('aria-valuemax')) - 1);
    await expect(page.locator('.chronicle-cursor'), 'the scrubbed day is not drawn with motion reduced').toHaveCount(1);
    await expect(tokenHeadline(page).locator('.chronicle-figure')).toHaveText(String(stagedWeek.at(-2)));
    expect(await animating(page), 'the scrub animates with motion reduced').toEqual([]);
    await page.mouse.move(0, 0);
    const layers = page.locator('.chronicle-layers button');
    if ((await layers.count()) > 1) {
      await layers.nth(1).click();
      expect(await animating(page), 'a layer switch animates with motion reduced').toEqual([]);
    }
    await context.close();
  }
});

/* THE READING RIDES OVER THE CURSOR AND STAYS INSIDE THE GRAPH (owner
 * direction, 2026-10-16). It is centred on the cursor, so at either end of the
 * graph a centred label would hang half outside the box — over the figures on
 * one side and past the board's edge on the other, which on a phone is the
 * document scrolling sideways. It reads "<figure> <noun> · <date>", so its
 * width is the LAYER's as much as the day's: measured at the oldest and the
 * newest day the graph shows, under every layer, at the phone floor, a phone
 * and a desktop. (Until the span buttons left the same day it was measured per
 * span; the graph now always shows the calendar's weeks, and the layers are
 * what change the label's length.) */
test('the reading over the cursor stays inside the graph at both ends, under every layer (owner 2026-10-16)', async ({
  page,
}) => {
  await visit(page);
  const chart = page.locator('.chronicle-chart');
  const layers = page.locator('.chronicle-layers button');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    await chart.scrollIntoViewIfNeeded();
    await diagramAtRest(page);
    const count = await layers.count();
    expect(count, `the diagram offers ${count} layers at ${width}px`).toBeGreaterThan(1);
    for (let index = 0; index < count; index += 1) {
      const span = (await layers.nth(index).textContent()).trim();
      await layers.nth(index).click();
      await chart.focus();
      for (const key of ['Home', 'End']) {
        await chart.press(key);
        /* What it says, before where it sits: a reading, the separator, and
           the written day. */
        await expect(page.locator('.chronicle-stamp')).toHaveText(/^(—|\S+ \S+) · [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
        const placed = await page.evaluate(() => {
          const box = window.document.querySelector('.chronicle-chart').getBoundingClientRect();
          const stamp = window.document.querySelector('.chronicle-stamp')?.getBoundingClientRect() ?? null;
          return {
            box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
            stamp: stamp === null ? null : { left: stamp.left, right: stamp.right, top: stamp.top, bottom: stamp.bottom },
            scrollWidth: window.document.documentElement.scrollWidth,
            clientWidth: window.document.documentElement.clientWidth,
          };
        });
        const at = `at ${width}px, ${span}, ${key}`;
        expect(placed.stamp, `no reading rides over the cursor ${at}`).not.toBeNull();
        expect(placed.stamp.left, `the reading starts ${placed.box.left - placed.stamp.left}px before the graph ${at}`).toBeGreaterThanOrEqual(
          placed.box.left - subPixel
        );
        expect(placed.stamp.right, `the reading runs ${placed.stamp.right - placed.box.right}px past the graph ${at}`).toBeLessThanOrEqual(
          placed.box.right + subPixel
        );
        expect(placed.stamp.top, `the reading rises above the graph ${at}`).toBeGreaterThanOrEqual(placed.box.top - subPixel);
        expect(placed.stamp.bottom, `the reading drops below the graph ${at}`).toBeLessThanOrEqual(placed.box.bottom + subPixel);
        expect(placed.scrollWidth, `the reading took the document sideways ${at}`).toBeLessThanOrEqual(placed.clientWidth);
      }
      await chart.press('Escape');
    }
  }
});

/* THE CURSOR AND THE PICKED DAY ARE ONE DAY, MEASURED (owner direction,
 * 2026-10-16: the graph spans the whole heatmap shown, column for column, so
 * a day's x sits over its own week's column and the graph and the calendar
 * line up exactly; the picked cell's outline stays while a day is read).
 *
 * The slider's value and the cell's flag could agree while the two drawings
 * disagreed — a line laid on a different ruler from the calendar under it
 * still picks the right cell by index. So the claim is measured as BOXES: the
 * cursor drawn on the graph falls inside the picked cell's column slot (the
 * cell widened by half the measured gap to its neighbours), for days reached
 * from the keyboard at both ends and in between, and for days the pointer
 * names at three places along the graph — at the phone floor, a phone and a
 * desktop, where the calendar shows a different number of weeks. */
test('a read day is picked on the calendar directly under the cursor (owner 2026-10-16)', async ({ page }) => {
  await visit(page);
  const chart = page.locator('.chronicle-chart');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    await chart.scrollIntoViewIfNeeded();
    await expect(page.locator('.chronicle')).toHaveAttribute('data-shown', 'true');
    await diagramAtRest(page);
    const under = () =>
      page.evaluate(() => {
        const shapeBox = (node) => {
          if (node instanceof SVGGraphicsElement && node.ownerSVGElement !== null) {
            const bbox = node.getBBox();
            const matrix = node.getScreenCTM();
            const a = new DOMPoint(bbox.x, bbox.y).matrixTransform(matrix);
            const b = new DOMPoint(bbox.x + bbox.width, bbox.y + bbox.height).matrixTransform(matrix);
            const left = Math.min(a.x, b.x);
            const top = Math.min(a.y, b.y);
            const width = Math.abs(b.x - a.x);
            const height = Math.abs(b.y - a.y);
            return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top };
          }
          return node.getBoundingClientRect();
        };
        const line = window.document.querySelector('.chronicle-cursor');
        const cursor = line === null ? null : shapeBox(line);
        const picked = [...window.document.querySelectorAll('.chronicle-cell[data-picked="true"]')].map((cell) =>
          shapeBox(cell)
        );
        const lefts = [
          ...new Set(
            [...window.document.querySelectorAll('.chronicle-cell')].map(
              (cell) => Math.round(shapeBox(cell).left * 100) / 100
            )
          ),
        ].sort((first, second) => first - second);
        const cell = picked[0] ?? null;
        const gutter = lefts.length > 1 && cell !== null ? (lefts[1] - lefts[0] - cell.width) / 2 : 0;
        return {
          x: cursor === null ? null : cursor.left + cursor.width / 2,
          picked: picked.length,
          left: cell === null ? null : cell.left - gutter,
          right: cell === null ? null : cell.right + gutter,
        };
      });
    const check = async (how) => {
      const at = `${how} at ${width}px`;
      await expect(page.locator('.chronicle-cell[data-picked="true"]'), `no single day is picked ${at}`).toHaveCount(1);
      const seen = await under();
      expect(seen.x, `no cursor is drawn ${at}`).not.toBeNull();
      expect(seen.picked, `${seen.picked} days are picked ${at}`).toBe(1);
      expect(
        seen.x,
        `the cursor at ${seen.x.toFixed(2)}px is outside the picked day's column [${seen.left.toFixed(2)}, ${seen.right.toFixed(2)}] ${at}`
      ).toBeGreaterThanOrEqual(seen.left - subPixel);
      expect(
        seen.x,
        `the cursor at ${seen.x.toFixed(2)}px is outside the picked day's column [${seen.left.toFixed(2)}, ${seen.right.toFixed(2)}] ${at}`
      ).toBeLessThanOrEqual(seen.right + subPixel);
    };
    await chart.focus();
    for (const [key, presses] of [
      ['Home', 1],
      ['End', 1],
      ['PageUp', 3],
      ['ArrowLeft', 2],
    ]) {
      for (let press = 0; press < presses; press += 1) {
        await chart.press(key);
      }
      await check(`after ${key}`);
    }
    await chart.press('Escape');
    await expect(chart).toHaveAttribute('data-scrubbing', 'false');
    const box = await chart.boundingBox();
    for (const fraction of [0.2, 0.5, 0.8]) {
      await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
      await expect(chart, `pointing at ${fraction * 100}% of the graph read no day at ${width}px`).toHaveAttribute(
        'data-scrubbing',
        'true'
      );
      await check(`pointing at ${fraction * 100}% of the graph`);
    }
    await page.mouse.move(0, 0);
  }
});

/* THE DIAGRAM KEEPS ITSELF INSIDE ITS OWN BOX, AT REST AND WHILE A DAY IS READ
 * (AGENTS.md rendering lanes: no horizontal body scroll at 320px or wider,
 * wide content scrolls inside its own container; owner direction 2026-10-16).
 *
 * The diagram has no scroller of its own, so the floor is containment: no
 * part of it — a figure, a caption, the layer switch, the graph's reading, a
 * month name, an account — may cross the diagram's own edges, and the document
 * may not go sideways. Asked at rest and with the oldest and the newest day
 * read, because a read day rewrites every headline's figure and caption and
 * those are the texts that grow. */
test('the diagram keeps every part of itself inside its own box at 320, 390 and 1440, read or at rest (owner 2026-10-16)', async ({
  page,
}) => {
  await visit(page);
  const chart = page.locator('.chronicle-chart');
  const contained = () =>
    page.evaluate(() => {
      const diagram = window.document.querySelector('.chronicle');
      const frame = diagram.getBoundingClientRect();
      const root = window.document.documentElement;
      const crossing = [];
      const shapeBox = (node) => {
        if (node instanceof SVGGraphicsElement && node.ownerSVGElement !== null) {
          const bbox = node.getBBox();
          const matrix = node.getScreenCTM();
          const a = new DOMPoint(bbox.x, bbox.y).matrixTransform(matrix);
          const b = new DOMPoint(bbox.x + bbox.width, bbox.y + bbox.height).matrixTransform(matrix);
          const left = Math.min(a.x, b.x);
          const top = Math.min(a.y, b.y);
          const width = Math.abs(b.x - a.x);
          const height = Math.abs(b.y - a.y);
          return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top };
        }
        return node.getBoundingClientRect();
      };
      for (const node of diagram.querySelectorAll('*')) {
        const box = shapeBox(node);
        if (box.width === 0 && box.height === 0) continue;
        const over = Math.max(frame.left - box.left, box.right - frame.right);
        if (over > 0.5) {
          crossing.push(`${node.tagName.toLowerCase()}.${(node.getAttribute('class') ?? '').split(' ')[0]} by ${over.toFixed(1)}px`);
        }
      }
      return { crossing: [...new Set(crossing)], scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
    });
  /* Every width and every state is read before anything is asserted, so a
     failure names ALL the places the diagram escapes rather than the first. */
  const escapes = [];
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    await chart.scrollIntoViewIfNeeded();
    await expect(page.locator('.chronicle')).toHaveAttribute('data-shown', 'true');
    await diagramAtRest(page);
    for (const state of ['at rest', 'Home', 'End']) {
      if (state !== 'at rest') {
        await chart.focus();
        await chart.press(state);
        await expect(chart).toHaveAttribute('data-scrubbing', 'true');
      }
      const seen = await contained();
      const at = `${state === 'at rest' ? 'at rest' : `with ${state}'s day read`} at ${width}px`;
      for (const part of seen.crossing) escapes.push(`${part} ${at}`);
      if (seen.scrollWidth > seen.clientWidth) {
        escapes.push(`the document goes sideways ${at} (${seen.scrollWidth} > ${seen.clientWidth})`);
      }
    }
    await chart.press('Escape');
  }
  expect(escapes, 'parts of the diagram cross its own edges').toEqual([]);
});

/* THE LAYER SWITCH IS A ROW OF REAL TARGETS (AGENTS.md: touch targets ≥ 44px;
 * owner direction, 2026-10-16: the switch wears no ground or box, like the
 * range buttons it was matched to). A control that lost its box must not lose
 * its target with it: every layer button clears the floor on both axes at the
 * phone floor, a phone and a desktop. */
test('every layer button clears the touch floor at 320, 390 and 1440 (owner 2026-10-16)', async ({ page }) => {
  await visit(page);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    const buttons = await page.locator('.chronicle-layers button').evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { label: node.textContent.trim(), width: box.width, height: box.height };
      })
    );
    expect(buttons.length, `the diagram offers ${buttons.length} layer buttons at ${width}px`).toBeGreaterThan(1);
    for (const button of buttons) {
      expect(button.width, `"${button.label}" is ${button.width.toFixed(1)}px wide at ${width}px`).toBeGreaterThanOrEqual(
        touchFloorPx - subPixel
      );
      expect(button.height, `"${button.label}" is ${button.height.toFixed(1)}px tall at ${width}px`).toBeGreaterThanOrEqual(
        touchFloorPx - subPixel
      );
    }
  }
});

/* THE NIGHT SKY IS SCENERY (owner direction, 2026-10-16: a starry night
 * behind the sheet). NightSky.svelte promises four things, and each is a
 * thing a reader would meet if it broke:
 *
 *   - it is FIXED to the viewport, covering it, and stays put while the page
 *     scrolls;
 *   - it is BEHIND everything and never a target: hidden from assistive
 *     technology, no pointer events, so a point on the page answers with the
 *     page and never with the sky;
 *   - it takes NO ROOM: taking it out of the layout altogether moves no box on
 *     the page and changes neither of the document's extents;
 *   - and for a reader who asked for less motion it is ONE STILL FRAME: two
 *     samples of its pixels a second apart are identical — while with motion
 *     welcome the same two samples differ, so the still half is about a sky
 *     that would otherwise move. It does draw something: a canvas left blank
 *     would be perfectly still. */
test('the night sky is fixed behind the sheet, takes no room or pointer, and holds still for a reader who asked for less motion (owner 2026-10-16)', async ({
  page,
}) => {
  /* Room for one wait of the sky's pace on top of the lane's own budget. */
  test.setTimeout(test.info().timeout + motionWindow);
  /* THE NIGHT, which is every visit's arrival (owner, 2026-10-19: "always set
     it to night by default"), and the only sky with stars to move — so the
     motion half below is about a sky that would otherwise move. The scene
     lane further down proves the arrival itself. */
  const sample = () =>
    page.evaluate(() => {
      const canvas = window.document.querySelector('canvas.night-sky');
      const context = canvas.getContext('2d');
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 0;
      let lit = 0;
      for (let index = 0; index < data.length; index += 4) {
        hash = (Math.imul(hash, 31) + data[index] + data[index + 1] * 7 + data[index + 2] * 13 + data[index + 3]) | 0;
        if (data[index + 3] > 0 && data[index] + data[index + 1] + data[index + 2] > 0) lit += 1;
      }
      return { hash, lit, pixels: data.length / 4 };
    });

  for (const motion of ['reduce', 'no-preference']) {
    await page.emulateMedia({ reducedMotion: motion });
    await visit(page);
    await expect(page.locator('canvas.night-sky'), 'the page draws no night sky, or more than one').toHaveCount(1);
    await expect(page.locator('html'), 'the page did not open on the night').toHaveAttribute('data-sky', 'night');

    if (motion === 'reduce') {
      const placed = await page.evaluate(() => {
        const canvas = window.document.querySelector('canvas.night-sky');
        const style = getComputedStyle(canvas);
        const box = canvas.getBoundingClientRect();
        const main = window.document.querySelector('main').getBoundingClientRect();
        const heading = window.document.querySelector('h1').getBoundingClientRect();
        const at = (x, y) => window.document.elementFromPoint(x, y);
        return {
          hidden: canvas.getAttribute('aria-hidden'),
          position: style.position,
          z: Number.parseInt(style.zIndex, 10),
          pointer: style.pointerEvents,
          box: [box.left, box.top, box.width, box.height],
          /* The initial containing block a fixed box with no inset covers:
             the viewport less any classic scrollbar. */
          viewport: [window.document.documentElement.clientWidth, window.document.documentElement.clientHeight],
          /* A point on the page answers with the page; a point beside the
             sheet, where only the sky is drawn, answers with the document. */
          onHeading: at(heading.left + heading.width / 2, heading.top + heading.height / 2) === canvas,
          beside: main.left > 4 ? at(2, Math.min(window.innerHeight - 2, 200)) === canvas : false,
        };
      });
      expect(placed.hidden, 'the sky is exposed to assistive technology').toBe('true');
      expect(placed.position, 'the sky is not fixed to the viewport').toBe('fixed');
      expect(placed.z, 'the sky is not stacked behind the page').toBeLessThan(0);
      expect(placed.pointer, 'the sky can take the pointer').toBe('none');
      expect(placed.box[0], 'the sky does not start at the viewport’s edge').toBeCloseTo(0, 0);
      expect(placed.box[1], 'the sky does not start at the viewport’s top').toBeCloseTo(0, 0);
      expect(Math.abs(placed.box[2] - placed.viewport[0]), `the sky is ${placed.box[2]}px wide in a ${placed.viewport[0]}px viewport`).toBeLessThanOrEqual(
        1
      );
      expect(Math.abs(placed.box[3] - placed.viewport[1]), `the sky is ${placed.box[3]}px tall in a ${placed.viewport[1]}px viewport`).toBeLessThanOrEqual(1);
      expect(placed.onHeading, 'a point on the name answers with the sky').toBe(false);
      expect(placed.beside, 'a point beside the sheet answers with the sky').toBe(false);

      /* Fixed: scrolling the page leaves it where it was. */
      await page.evaluate(() => window.scrollTo(0, 600));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      const scrolled = await page.locator('canvas.night-sky').evaluate((canvas) => {
        const box = canvas.getBoundingClientRect();
        return [box.left, box.top, box.width, box.height];
      });
      expect(scrolled, 'the sky scrolled with the page').toEqual(placed.box);
      await page.evaluate(() => window.scrollTo(0, 0));

      /* No room: the page's boxes and extents without the sky at all. */
      const layout = () =>
        page.evaluate(() => {
          const root = window.document.documentElement;
          const boxes = [...window.document.querySelectorAll('main, .page-section')].map((node) => {
            const box = node.getBoundingClientRect();
            return [box.left, box.top + window.scrollY, box.width, box.height].map((value) => Math.round(value * 100) / 100);
          });
          return { boxes, width: root.scrollWidth, height: root.scrollHeight };
        });
      const withSky = await layout();
      await page.locator('canvas.night-sky').evaluate((canvas) => {
        canvas.style.display = 'none';
      });
      const withoutSky = await layout();
      await page.locator('canvas.night-sky').evaluate((canvas) => {
        canvas.style.display = '';
      });
      expect(withoutSky, 'taking the sky out of the page moved the page').toEqual(withSky);
    }

    /* Motion: two samples a second apart. */
    const first = await sample();
    expect(first.lit, `the sky drew no star at all (${motion})`).toBeGreaterThan(0);
    if (motion === 'reduce') {
      await page.waitForTimeout(1_000);
      const second = await sample();
      expect(second.hash, 'the sky was redrawn over time for a reader who asked for less motion').toBe(first.hash);
    } else {
      await expect
        .poll(async () => (await sample()).hash, {
          message: 'the sky never moved with motion welcome; the still half proves nothing',
          timeout: motionWindow,
        })
        .not.toBe(first.hash);
    }
  }
  await page.emulateMedia({ reducedMotion: null });
});

/* THE SKY IS THE NIGHT, WHATEVER THE HOUR (owner, 2026-10-19). This lane was
 * "the sky follows the reader's hour: a still blue day, and a dawn that keeps
 * a few stars moving"; later the same day the owner asked for the night by
 * default and a toggle for the day, and then for the toggle to go too ("do
 * away with this all together but keep the logic"). What it measures now is
 * the half with a subject on the page: the page ignores the clock — at midday
 * it still opens on the night, drawn as the night (no blue day sky), so a sky
 * that went back to reading the hour fails here.
 *
 * The other half, "the day is a still blue sky", went with the toggle: the
 * sky canvas takes its phase from the app's constant, so nothing on the page
 * can draw the day sky now, and the attribute the stylesheet's day palette
 * keys on does not reach it. That is stated as measured below, so a page that
 * starts drawing the day from the attribute is a conscious edit here; the day
 * preset itself is still pinned at the source by tests/sky.test.mjs. */
test('the sky ignores the reader’s hour and opens on the night (owner 2026-10-19)', async ({
  page,
}) => {
  const sample = () =>
    page.evaluate(() => {
      const canvas = window.document.querySelector('canvas.night-sky');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let red = 0;
      let blue = 0;
      for (let index = 0; index < data.length; index += 4) {
        red += data[index];
        blue += data[index + 2];
      }
      return { red, blue, sky: window.document.documentElement.dataset.sky };
    });

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.setFixedTime(atHour(13));
  await visit(page);
  const midday = await sample();
  expect(midday.sky, 'at 13:00 the page opened on the day; the sky is reading the clock again').toBe('night');
  expect(midday.blue, 'at 13:00 the sky is drawn blue; the canvas is reading the clock again').toBeLessThanOrEqual(midday.red * 1.4);

  /* The day palette's attribute does not draw the day sky (stated, above). */
  await turnScene(page, 'day');
  await page.waitForTimeout(500);
  const attributeOnly = await sample();
  expect(
    attributeOnly.blue,
    'the sky turned blue from the attribute alone; the canvas now follows data-sky, so this lane needs its day half back'
  ).toBeLessThanOrEqual(attributeOnly.red * 1.4);
  await page.emulateMedia({ reducedMotion: null });
});

/* THE TORCHES BURN AT NIGHT (owner, 2026-10-19). They are scenery on the
 * frame: a pair at each seat, one on each side band, inside the sheet's outer
 * edge so the page never widens; at night — every visit — every torch on
 * screen draws a flame, and the flame moves with motion welcome and holds
 * still for a reader who asked for less. A flame is read from its canvas, so a
 * torch that drew nothing would be caught rather than counted. (This lane also
 * held them out by day while a toggle could bring the day; see the note at its
 * end.) */
test('the torches burn on both sides of the frame at night and hold still for less motion (owner 2026-10-19)', async ({
  page,
}) => {
  /* Room for a wait of the fire's pace at each of the four polls below (the
     flame, then its light, at each of two widths) on top of the lane's own
     budget. */
  test.setTimeout(test.info().timeout + 4 * motionWindow);
  /* No page error while they burn: the torches' effects once wrote state they
     also read, and Svelte stopped the loop with effect_update_depth_exceeded
     while the page went on looking right. */
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const read = () =>
    page.evaluate(() => {
      const main = window.document.querySelector('main');
      const sheet = main.getBoundingClientRect();
      const frame = getComputedStyle(main);
      const torches = [...window.document.querySelectorAll('.torch')].map((torch) => {
        const box = torch.getBoundingClientRect();
        const canvas = torch.querySelector('canvas.torch-flame');
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let lit = 0;
        let hash = 0;
        for (let index = 0; index < data.length; index += 4) {
          if (data[index + 3] > 0) lit += 1;
          hash = (Math.imul(hash, 31) + data[index] + data[index + 1] * 7 + data[index + 2] * 13 + data[index + 3]) | 0;
        }
        const halo = torch.querySelector('.torch-halo').getBoundingClientRect();
        return {
          side: torch.dataset.side,
          left: box.left,
          right: box.right,
          top: box.top + window.scrollY,
          lit,
          hash,
          glow: Number(getComputedStyle(torch.querySelector('.torch-light')).opacity),
          light: torch.style.getPropertyValue('--torch-light'),
          halo: { left: halo.left, right: halo.right },
          pointer: getComputedStyle(torch.closest('.keep-torches')).pointerEvents,
          hidden: torch.closest('.keep-torches').getAttribute('aria-hidden'),
          layer: getComputedStyle(torch.closest('.keep-torches')).zIndex,
        };
      });
      return {
        torches,
        sheet: { left: sheet.left, right: sheet.right },
        words: {
          left: sheet.left + parseFloat(frame.borderLeftWidth) + parseFloat(frame.paddingLeft),
          right: sheet.right - parseFloat(frame.borderRightWidth) - parseFloat(frame.paddingRight),
        },
        width: window.document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      };
    });

  /* SEATED: a torch pair stands at every seat the sheet has room for. The
     seats follow the sheet's height through a resize observer, which an
     engine delivers with a rendering update — WebKit without a GPU, a second
     after the page settled — so the lane waits for the count the height
     calls for rather than reading whatever stood at that moment. */
  const seated = () =>
    expect
      .poll(
        () =>
          page.evaluate(() => {
            const layer = window.document.querySelector('.keep-torches');
            const style = getComputedStyle(layer);
            const first = parseFloat(style.getPropertyValue('--torch-first-px'));
            const spacing = parseFloat(style.getPropertyValue('--torch-spacing-px'));
            const foot = parseFloat(style.getPropertyValue('--torch-foot-px'));
            const height = window.document.querySelector('main').clientHeight;
            let seats = 0;
            for (let top = first; top + foot <= height; top += spacing) seats += 1;
            return seats > 0 && window.document.querySelectorAll('.torch').length === seats * 2;
          }),
        { message: 'the torches never stood at every seat the sheet has room for' }
      )
      .toBe(true);

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 320, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    /* The night is the arrival (owner, 2026-10-19), so no clock is set: a
       page that stopped opening on the night fails right here. */
    await visit(page);
    await expect(page.locator('html'), 'the page did not open on the night').toHaveAttribute('data-sky', 'night');
    await seated();
    const night = await read();
    expect(night.torches.length, `no torches at ${viewport.width}px`).toBeGreaterThanOrEqual(2);
    expect(night.torches.filter((torch) => torch.side === 'start').length).toBe(
      night.torches.filter((torch) => torch.side === 'end').length
    );
    expect(night.width, `the torches widened the page at ${viewport.width}px`).toBe(night.viewport);
    for (const torch of night.torches) {
      expect(torch.hidden, 'a torch is exposed to assistive technology').toBe('true');
      expect(torch.pointer, 'a torch can take the pointer').toBe('none');
      expect(torch.left, 'a torch pokes past the sheet’s outer edge').toBeGreaterThanOrEqual(night.sheet.left - 0.5);
      expect(torch.right, 'a torch pokes past the sheet’s outer edge').toBeLessThanOrEqual(night.sheet.right + 0.5);
      /* Under the words, and the hot light beside the flame stops short of
         them (owner, 2026-10-19: "readable, very readable"). */
      expect(torch.layer, 'the torches paint over the sheet’s words').toBe('-1');
      if (torch.side === 'start') {
        expect(torch.halo.right, `a torch’s hot light reaches over the words (${viewport.width}px)`).toBeLessThanOrEqual(night.words.left + 0.5);
      } else {
        expect(torch.halo.left, `a torch’s hot light reaches over the words (${viewport.width}px)`).toBeGreaterThanOrEqual(night.words.right - 0.5);
      }
    }
    const first = night.torches[0];
    expect(first.lit, `the first torch drew no flame at night (${viewport.width}px)`).toBeGreaterThan(0);
    expect(first.glow, 'a burning torch throws no light').toBeGreaterThan(0);
    await expect
      .poll(async () => (await read()).torches[0].hash, {
        message: 'the flame never moved with motion welcome',
        timeout: motionWindow,
      })
      .not.toBe(first.hash);
    /* The light on the stone moves with the fire: it brightens and dims. */
    await expect
      .poll(async () => (await read()).torches[0].light, {
        message: 'the torchlight never moved with the flame',
        timeout: motionWindow,
      })
      .not.toBe(first.light);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await visit(page);
    const still = (await read()).torches[0];
    expect(still.lit, 'a reader who asked for less motion sees no flame at all').toBeGreaterThan(0);
    expect(still.glow, 'a reader who asked for less motion sees a torch throw no light').toBeGreaterThan(0);
    await page.waitForTimeout(1_000);
    const later = (await read()).torches[0];
    expect(later.hash, 'the flame moved for a reader who asked for less motion').toBe(still.hash);
    expect(later.light, 'the torchlight moved for a reader who asked for less motion').toBe(still.light);
    /* "Out by day" is retired with the toggle that brought the day (owner,
       2026-10-19: "do away with this all together but keep the logic"): the
       torches take their lit state from the app's constant phase, which is
       always the night, so the page has no day for them to be out in. */
  }
  await page.emulateMedia({ reducedMotion: null });
  expect(errors, 'the page threw while the torches stood').toEqual([]);
});

/* NO RED ANYWHERE (owner directive, 2026-09-11).
 *
 * The sheet's one chromatic mark used to be a red that belonged to no palette
 * — the same value on paper as on near-black. It is now a green of each
 * reading mode's OWN calendar ramp, mapped once in the token layer so every
 * surface that spends the mark moves with one declaration. Not the ramp's
 * peak: the mark is always TEXT — the ticker's figure at 0.75rem among its
 * surfaces — and the light peak measures under 2:1 on the page. The busiest
 * calendar day keeps the peak, so this lane measures BOTH greens in the
 * engine, after the whole fallback chain has run — the only place a stale
 * literal could still show — proves they differ, and holds the mark to the
 * 4.5:1 text floor against the page it is printed on.
 *
 * RE-AIMED 2026-10-16 (owner direction: one diagram, no board ground, "I
 * don't like having 3 different conflicting colors fighting for a
 * background"). Two halves moved:
 *
 * - THE PAGE IT IS PRINTED ON is MEASURED now, not named: the ticker lost its
 *   own glass and reads off the sheet, and the sheet is a stone wall, dark
 *   at night and pale by day. So the ground
 *   is every background colour from the figure up to the document,
 *   composited by the engine itself onto one pixel — what the reader's eye
 *   actually gets behind the figure, rather than a token that is no longer
 *   the surface. (The wall is an image over its own base colour, held to a
 *   narrow band of brightness around it; the base colour is what is
 *   measured, as for every other lane.)
 * - THE BUSIEST DAY'S PEAK moved with the calendar: the old calendar marked
 *   its busiest day with `data-grid-peak`; the chronicle's calendar marks it
 *   `data-peak` (restored the same day, owner issues 287/292 asked for the
 *   peak), and its peak green is measured as the engine resolved it — on its
 *   fill until 2026-10-19, on the ring it wears since the days became moss on
 *   stone. The token half stays: the mark must still not BE the peak green.
 *
 * RE-AIMED 2026-10-20 (the Rotulus; owner: "We don't need to highlight the
 * highest day like that"). The days are squares inked on the roll's
 * parchment in five steps, and the busiest day is simply the deepest: it
 * wears no ring of its own, and its green is the deepest step's ink as the
 * engine resolved it on the key, so the mark is held apart from THAT, the
 * busiest green the page actually paints.
 */
test('the page spends its one mark on its own green, legible as text, in every reading mode (owner 2026-09-11)', async ({
  page,
}) => {
  await visit(page);
  /* Both palettes the page has: the night it opens on, and the day kept
     behind data-sky (owner, 2026-10-19; the control that offered slate and
     sepia besides went with the footer the same day). */
  for (const mode of ['night', 'day']) {
    await turnScene(page, mode);
    /* The page's colours ease to a new mode (transitions, with motion
       allowed), so what is painted is read once the repaint has landed: every
       running transition is waited out — transitions only, because today's
       cell glows on an endless animation. */
    await page.evaluate(async () => {
      await new Promise((frame) => requestAnimationFrame(frame));
      await Promise.all(
        window.document
          .getAnimations()
          .filter((animation) => animation instanceof window.CSSTransition)
          .map((animation) => animation.finished.catch(() => undefined))
      );
    });
    const observed = await page.evaluate(() => {
      const root = window.document.documentElement;
      const resolve = (token) => {
        const probe = window.document.createElement('span');
        probe.style.color = `var(${token})`;
        root.appendChild(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      };
      const figure = window.document.querySelector('.ticker-item[data-peak="true"] .ticker-figure');
      /* The ground behind the figure, composited by the engine: every
         ancestor's background colour, document first, painted onto one
         pixel. The document's own colour is opaque in every mode, so the
         pixel is fully determined by the page and not by the canvas. */
      let ground = null;
      if (figure !== null) {
        /* An element's own ground, then any ground it paints on a generated
           box behind its content: the sheet paints its ground on
           `main::before` since the 2026-10-16 glass repair (a backdrop-filter
           on `main` itself made it the containing block of every fixed
           detail), and a walk that read only elements would composite the
           figure straight onto the night. A generated box is counted only
           when it is generated at all (`content` other than none). */
        const layers = [];
        for (let node = figure; node !== null; node = node.parentElement) {
          const own = [getComputedStyle(node).backgroundColor];
          for (const pseudo of ['::before', '::after']) {
            const style = getComputedStyle(node, pseudo);
            if (style.content !== 'none' && style.content !== 'normal') own.push(style.backgroundColor);
          }
          layers.unshift(...own);
        }
        const canvas = window.document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, 1, 1);
        for (const layer of layers) {
          context.fillStyle = layer;
          context.fillRect(0, 0, 1, 1);
        }
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
        ground = `rgb(${r}, ${g}, ${b})`;
      }
      const busiest = [...window.document.querySelectorAll('.chronicle-cell[data-peak="true"]')];
      const step = (level) => window.document.querySelector(`.chronicle-step[data-grid-level="${level}"]`);
      return {
        /* The busiest green the page paints: the key's deepest step, and the
           step under it, as the engine resolved them. */
        peak: step(4) === null ? null : getComputedStyle(step(4)).backgroundColor,
        under: step(3) === null ? null : getComputedStyle(step(3)).backgroundColor,
        mark: resolve('--ledger-highlight'),
        page: ground,
        ticker: figure === null ? null : getComputedStyle(figure).color,
        busiest: busiest.map((cell) => ({
          level: cell.dataset.gridLevel,
          fill: getComputedStyle(cell).fill,
          stroke: getComputedStyle(cell).stroke,
          /* Today's and the picked day's own rings are drawn in the ledger's
             ink, so only a busiest day that is neither can show whether the
             busiest day is ringed for being the busiest. */
          plain: cell.dataset.today !== 'true' && cell.dataset.picked !== 'true',
        })),
      };
    });
    expect(observed.peak, `${mode}: the peak token resolves to nothing`).toMatch(/rgb/);
    expect(observed.busiest.length, `${mode}: the calendar marks no busiest day`).toBeGreaterThan(0);
    /* THE BUSIEST DAY IS THE DEEPEST INK, AND NOTHING MORE (owner,
       2026-10-20). Its square is the fifth step, inked exactly as the key
       inks that step — a step the key draws apart from the one under it —
       and a busiest day that is neither today nor picked wears no ring. */
    expect(observed.under, `${mode}: the key draws no fourth step`).toMatch(/rgb/);
    expect(observed.peak, `${mode}: the deepest step is inked as the one under it`).not.toBe(observed.under);
    for (const day of observed.busiest) {
      expect(day.level, `${mode}: the busiest day is not the deepest step`).toBe('4');
      expect(day.fill, `${mode}: the busiest day is inked ${day.fill}, not the key's deepest ${observed.peak}`).toBe(
        observed.peak
      );
    }
    const plain = observed.busiest.filter((day) => day.plain);
    expect(plain.length, `${mode}: every busiest day is also today or picked, so whether it is ringed cannot be read`).toBeGreaterThan(0);
    for (const day of plain) {
      expect(day.stroke, `${mode}: the busiest day is ringed ${day.stroke} for being the busiest`).toBe('none');
    }
    expect(observed.mark, `${mode}: the mark resolves to nothing`).toMatch(/rgb/);
    expect(observed.page, `${mode}: the ticker printed no peak figure to measure`).not.toBeNull();
    expect(
      observed.ticker,
      `${mode}: the ticker's own accent is ${observed.ticker}, not the sheet's mark`
    ).toBe(observed.mark);
    /* Non-vacuity, three ways: the mark is a GREEN — more green than red — so
       a lane that measured two names for the same stale red would fail; it is
       NOT the peak, so a repaint that spent the peak as text would fail; and
       it is legible as text on the ground it is actually printed on at the
       4.5:1 floor, which neither the peak nor light's fourth step reaches. */
    const [red, green] = channels(observed.mark);
    expect(green, `${mode}: the mark ${observed.mark} is not a green at all`).toBeGreaterThan(red);
    expect(observed.mark, `${mode}: the mark and the busiest day are one value`).not.toBe(
      observed.peak
    );
    const ratio = contrastRatio(observed.mark, observed.page);
    expect(
      ratio,
      `${mode}: the mark ${observed.mark} on the page ${observed.page} is ${ratio.toFixed(2)}:1`
    ).toBeGreaterThanOrEqual(4.5);
  }
});

/* CLICKING AN ACCOUNT REPAINTS NOTHING (owner directive, 2026-09-11, issue
 * 316: "these shouldn't change colour when I click on them"; re-aimed
 * 2026-10-16 when the board's cards became the diagram's accounts, and
 * 2026-10-20 when the accounts became the leaves of the chained tome).
 *
 * A press on the tome now turns its leaf (owner, 2026-10-20: no "turn the
 * leaf" button — the tome itself turns), so the press is no longer a press
 * that does nothing, and this lane proves it reached the tome: the leaf it
 * landed on closes. What the directive forbade is unchanged and measured the
 * same way: every paint the press could change is read before and after and
 * must be IDENTICAL — the account's and the board's — and an account offers
 * no control's cursor or pressed state. And every account wears the same paint
 * (owner directive, 2026-09-12, issue 323: "everything should follow the same
 * pattern"), read in both motion preferences. */
test('an account never repaints when it is clicked, and every account wears one paint (owner 2026-09-11 issue 316, 2026-09-12 issue 323; 2026-10-16; 2026-10-20)', async ({
  browser,
}) => {
  for (const motion of ['no-preference', 'reduce']) {
    const context = await browser.newContext({ reducedMotion: motion });
    const page = await context.newPage();
    await stageSixCards(page);
    await visit(page);
    const read = (account) =>
      account.evaluate((node) => {
        const board = window.document.querySelector('#trackers .panel-stack');
        return {
          pressed: node.getAttribute('aria-pressed'),
          tag: node.tagName.toLowerCase(),
          background: getComputedStyle(node).backgroundColor,
          ink: getComputedStyle(node).color,
          cursor: getComputedStyle(node).cursor,
          board: getComputedStyle(board).backgroundColor,
        };
      });
    const accounts = page.locator('.chronicle-account');
    const drawn = await accounts.count();
    expect(drawn, 'the diagram drew no accounts to compare').toBeGreaterThan(1);
    const account = accounts.first();
    const before = await read(account);
    expect(before.tag, 'an account is a control element').toBe('section');
    expect(before.pressed, 'an account announces a pressed state').toBeNull();
    expect(before.cursor, 'an account offers a control cursor').not.toBe('pointer');
    /* THE PRESS, and the paint that must not move. The pointer is taken off
       the account before the second read, so a hover paint left behind cannot
       read as the press having changed something. */
    await expect(account, 'the first account is not the leaf the tome opens on').toHaveAttribute('data-open', 'true');
    await account.locator('.chronicle-account-name').click();
    await page.mouse.move(0, 0);
    await expect(account, `the press did not reach the tome with motion ${motion}; nothing below proves a press repaints nothing`).toHaveAttribute(
      'data-open',
      'false'
    );
    const after = await read(account);
    expect(after.background, `clicking an account repainted it with motion ${motion}`).toBe(before.background);
    expect(after.ink, `clicking an account repainted its ink with motion ${motion}`).toBe(before.ink);
    expect(after.board, `clicking an account repainted the board with motion ${motion}`).toBe(before.board);
    for (let index = 0; index < drawn; index += 1) {
      const paint = await read(accounts.nth(index));
      expect(paint.background, `account ${index} wears a different paint with motion ${motion}`).toBe(before.background);
      expect(paint.ink, `account ${index} wears a different ink with motion ${motion}`).toBe(before.ink);
    }
    await context.close();
  }
});

/* THE TOME TURNS ITS LEAF, SAYS WHERE IT IS, AND MOVES NOTHING (owner,
 * 2026-10-20: T3, the chained tome on its corbel; "do not have a button that
 * says turn the new leaf").
 *
 * A press anywhere on the tome turns its leaf, and Enter on its lifted corner
 * — the keyboard's one way in — turns it the same; each turn says the opening
 * it arrives at in a polite live region, so a reader who cannot see the leaf
 * still learns where they are. Every leaf of a side lies in that side's one
 * place, so the tome and the page under it are the same box before a turn,
 * in the middle of one and after it, at a desk width and a phone width; and
 * under reduced motion the leaf changes with no leaf in the air at all. */
test('the tome turns its leaf on a press and on its corner, says the new opening, and moves nothing (owner 2026-10-20)', async ({
  browser,
}) => {
  /* EACH LEAF IN THE AIR BRINGS ITS OWN TIME. A turn is 1.5s in the air by
     design (Tome.svelte, TURN_MS) and this lane allows each leaf `landing` to
     come down. With motion welcome it lifts one per opening it walks through,
     six with two accounts (two openings at a desk, four at a phone): about
     twelve seconds of animation in every engine, which the suite's 30s was
     never sized for. So each leaf lifted adds its own `landing` to the lane's
     budget as it is lifted. A tome with more accounts brings its own time,
     and nothing is granted where no leaf flies. Every wait and every
     assertion is as it was. */
  const landing = 5_000;
  for (const motion of ['no-preference', 'reduce']) {
    const lift = () => {
      if (motion === 'no-preference') test.setTimeout(test.info().timeout + landing);
    };
    const context = await browser.newContext({ reducedMotion: motion });
    const page = await context.newPage();
    await visit(page);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await settled(page);
      const at = `at ${width}px with motion ${motion}`;
      const tome = page.locator('.tome');
      await tome.scrollIntoViewIfNeeded();
      const frame = () =>
        page.evaluate(() => {
          const round = (value) => Math.round(value * 100) / 100;
          const box = (node) => {
            const rect = node.getBoundingClientRect();
            return [round(rect.x), round(rect.y + window.scrollY), round(rect.width), round(rect.height)];
          };
          return {
            tome: box(window.document.querySelector('.tome')),
            pages: box(window.document.querySelector('.tome-pages')),
            height: window.document.documentElement.scrollHeight,
            scrollWidth: window.document.documentElement.scrollWidth,
            clientWidth: window.document.documentElement.clientWidth,
          };
        });
      const open = () =>
        page.locator('.tome-page[data-open="true"]').evaluateAll((leaves) => leaves.map((leaf) => leaf.dataset.leaf));
      const before = await frame();
      const first = await open();
      expect(first.length, `the tome opens on no leaf ${at}`).toBeGreaterThan(0);
      expect(before.scrollWidth, `the tome takes the document sideways ${at}`).toBeLessThanOrEqual(before.clientWidth + 1);

      // A press on the leaf itself.
      lift();
      await page.locator('.tome-page[data-open="true"]').first().click({ position: { x: 24, y: 24 } });
      if (motion === 'no-preference') {
        await expect(page.locator('.tome-leaves .tome-leaf'), `a press lifted no leaf ${at}`).toHaveCount(1);
        expect(await frame(), `a leaf in the air moved the tome ${at}`).toEqual(before);
      } else {
        expect(await page.locator('.tome-leaves .tome-leaf').count(), `a leaf is in the air for a reader who asked for less motion ${at}`).toBe(0);
      }
      await expect(page.locator('.tome-leaves .tome-leaf'), `the leaf never landed ${at}`).toHaveCount(0, { timeout: landing });
      const second = await open();
      expect(second, `a press did not turn the leaf ${at}`).not.toEqual(first);
      await expect(page.locator('.tome-said'), `the turn said nothing ${at}`).toHaveText(/the (?:totals|models)/);
      expect(await frame(), `a turn moved the tome or the page ${at}`).toEqual(before);

      // Enter on the corner, until the tome is back where it opened.
      const corner = page.locator('.tome-corner');
      for (let turns = 0; turns < 8 && JSON.stringify(await open()) !== JSON.stringify(first); turns += 1) {
        await expect(corner, `the corner did not come back after a turn ${at}`).toHaveAttribute('data-away', 'false', { timeout: landing });
        await corner.focus();
        lift();
        await page.keyboard.press('Enter');
        await expect(page.locator('.tome-leaves .tome-leaf'), `the leaf never landed ${at}`).toHaveCount(0, { timeout: landing });
      }
      expect(await open(), `Enter on the corner never brought the tome back to its first opening ${at}`).toEqual(first);
      expect(await frame(), `turning back moved the tome or the page ${at}`).toEqual(before);
    }
    await context.close();
  }
});

/* THE PICTURE BANDS ARE GONE (owner direction, 2026-10-16: "remove the stock
 * image from this only leave it with my name"). This lane was "the picture
 * band mounts the texture showing and the one it left, never the whole set,
 * and carries no control" (issue 287; issue 292) — a mount rule for a band the
 * page no longer draws, retired with it. What an engine can still be asked is
 * the removal itself: no band on the page, and no band picture ever requested,
 * on arrival or after a reading-mode switch (the switch used to be what
 * fetched the next picture; since 2026-10-19 it is the day palette uncovered
 * behind data-sky, the only switch the page keeps). */
test('the page draws no picture band and fetches no band picture, before or after a reading-mode switch (owner 2026-10-16)', async ({
  page,
}) => {
  const fetched = [];
  page.on('request', (request) => {
    if (/\/(?:band-|light-spikes|dark-refraction|slate-fluid|sepia-galaxy)[^/]*\.jpg$/.test(new URL(request.url()).pathname)) {
      fetched.push(request.url());
    }
  });
  await visit(page);
  await expect(page.locator('.band, .band-layer'), 'a picture band is on the page again').toHaveCount(0);
  await turnScene(page, 'day');
  await settled(page);
  await expect(page.locator('.band, .band-layer'), 'a reading-mode switch brought a picture band back').toHaveCount(0);
  expect(fetched, 'the page asked for a band picture').toEqual([]);
});

/* RESPONSIVENESS (owner directive, 2026-08-24). The page column is a single
 * token the reader can drag, so this lane tests the token's RANGE rather than
 * its current value: whatever width the reader ends up choosing, the trackers'
 * diagram stays inside its board, its calendar draws whole square days inside
 * its own drawing, and nothing takes the document sideways. The token is driven
 * from the outside exactly as the handle drives it.
 *
 * Re-aimed 2026-10-16 from the heatmap strips to the diagram that replaced
 * them. The strips' WIDTH-INDEPENDENT HEIGHT is retired with them: a strip was
 * a fixed block-size reserve that scrolled, so its height owed nothing to the
 * column; the diagram's calendar is drawn to fit its box and is taller in a
 * wider column by design. What a reader can see break at a narrow width — a
 * drawing past its board, a squashed day, a sideways page — is asked here. */
test('the diagram survives the whole range of the page column token', async ({ page }) => {
  await visit(page);
  const declared = await page.evaluate(() =>
    getComputedStyle(window.document.documentElement).getPropertyValue('--page-column-width').trim()
  );
  expect(declared, 'the page column token is not declared; this lane drives nothing').not.toBe('');
  for (const width of ['20rem', '32rem', '48rem', '60rem', '90rem', '140rem']) {
    await page.evaluate((value) => {
      window.document.documentElement.style.setProperty('--page-column-width', value);
    }, width);
    await settled(page);
    const observed = await page.evaluate(() => {
      const box = (node) => node.getBoundingClientRect();
      const board = window.document.querySelector('#trackers .panel-stack');
      const style = getComputedStyle(board);
      const frame = box(board);
      const shapeBox = (node) => {
        if (node instanceof SVGGraphicsElement && node.ownerSVGElement !== null) {
          const bbox = node.getBBox();
          const matrix = node.getScreenCTM();
          const a = new DOMPoint(bbox.x, bbox.y).matrixTransform(matrix);
          const b = new DOMPoint(bbox.x + bbox.width, bbox.y + bbox.height).matrixTransform(matrix);
          const left = Math.min(a.x, b.x);
          const top = Math.min(a.y, b.y);
          const width = Math.abs(b.x - a.x);
          const height = Math.abs(b.y - a.y);
          return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top };
        }
        return node.getBoundingClientRect();
      };
      const svg = box(window.document.querySelector('.chronicle-calendar svg'));
      const cells = [...window.document.querySelectorAll('.chronicle-cell')].map(shapeBox);
      const chronicle = box(window.document.querySelector('.chronicle'));
      return {
        scrollWidth: window.document.documentElement.scrollWidth,
        clientWidth: window.document.documentElement.clientWidth,
        boardLeft: frame.left + Number.parseFloat(style.borderLeftWidth),
        boardRight: frame.right - Number.parseFloat(style.borderRightWidth),
        chronicleLeft: chronicle.left,
        chronicleRight: chronicle.right,
        cells: cells.length,
        unsquare: cells.filter((cell) => Math.abs(cell.width - cell.height) > 0.05).length,
        outside: cells.filter((cell) => cell.left < svg.left - 0.01 || cell.right > svg.right + 0.01).length,
      };
    });
    expect(
      observed.scrollWidth,
      `a ${width} page column scrolls the document sideways (${observed.scrollWidth} > ${observed.clientWidth})`
    ).toBeLessThanOrEqual(observed.clientWidth + subPixel);
    expect(observed.cells, `the calendar drew no days at a ${width} page column`).toBeGreaterThan(0);
    expect(observed.chronicleLeft, `the diagram starts outside its board at a ${width} page column`).toBeGreaterThanOrEqual(
      observed.boardLeft - subPixel
    );
    expect(observed.chronicleRight, `the diagram runs past its board at a ${width} page column`).toBeLessThanOrEqual(
      observed.boardRight + subPixel
    );
    expect(observed.unsquare, `${observed.unsquare} days are not square at a ${width} page column`).toBe(0);
    expect(observed.outside, `${observed.outside} days are drawn outside the calendar at a ${width} page column`).toBe(0);
  }
  await page.evaluate(() => window.document.documentElement.style.removeProperty('--page-column-width'));
});

/* SECURITY of the rendered surface (owner directive, 2026-08-24). The series
 * and its labels travel from a capture file on the owner's machine, through a
 * snapshot in the repository, to the origin, to this DOM. Source labels pass
 * through admission as data on purpose — the panel knows no vendor, so it
 * cannot enumerate the labels it will be asked to render — which makes "as
 * TEXT, never as markup" the property that has to hold. Svelte escapes
 * interpolations, so this lane is proving the component never left that path:
 * no {@html}, no innerHTML, no attribute that becomes a script.
 *
 * The start date is the other half and it fails the other way: it is matched
 * against a calendar-date pattern at admission, so a hostile one is not
 * rendered safely — it is not rendered at all, and it takes the whole payload
 * with it. Both halves run here, in that order, because they are the two ways
 * a string from that file can end up on a screen. */
test('a hostile label reaches the page as text and never as markup', async ({ page }) => {
  const hostile = '<img src=x onerror="window.__pwned = true">';
  const hostileAccount = '</h3><script>window.__pwned = true</script>';

  await stageUsagePayload(page, (envelope) => {
    const sources = envelope?.data?.sources ?? [];
    expect(sources.length, 'the origin serves no usage source to restage').toBeGreaterThan(0);
    sources[0].label = hostile;
    sources[0].account = hostileAccount;
    /* A WELL-FORMED series beside the hostile labels: this half is about what
       a rendered string does, so the payload has to be one the panel renders.
       The served lifetime split goes too: a label no source file declares
       belongs to no vendor group, so it may carry no named model (issue
       #369), and a split naming one would refuse the whole payload before a
       label was ever drawn. */
    sources[0].series = { startDate: '2026-08-10', totals: [1, 2, 3], recorded: true };
    delete sources[0].modelStats;
  });
  await visit(page);
  /* THE LABEL REACHES THREE SURFACES OF THE DIAGRAM, AND ALL ARE MEASURED
     (re-aimed 2026-10-16 from the board's card heads and the calendar's
     segments, owner direction): the button that picks the source's layer, the
     graph's accessible value once that layer is picked, and the head of its
     account. (The key beside the graph that named each line was the third
     surface until the legend was removed the same day — the graph draws one
     layer at a time and the layer switch names it.) Since the accounts became
     the chained tome (owner, 2026-10-20) the head is two: the account's totals
     leaf and its models leaf, each titled with an illuminated initial — the
     label's first letter in a span of the component's own, the rest in
     another. Since the figures follow the picked seal (owner, 2026-10-21,
     issue 385) the label reaches one more: the seal's first figure is that
     source's tokens, named for it under the roll's illuminated initial. A
     string that became markup in any of them is caught. */
  const hostileLayer = page.locator('.chronicle-layers button', { hasText: 'onerror' });
  await expect(hostileLayer, 'the hostile source was offered no layer').toHaveCount(1);
  await hostileLayer.click();
  const observed = await page.evaluate(
    ([label, account]) => {
      const diagram = window.document.querySelector('.chronicle');
      const read = (selector) =>
        [...diagram.querySelectorAll(selector)].map((node) => ({ text: node.textContent, children: node.children.length }));
      const layers = read('.chronicle-layers button');
      const heads = [...diagram.querySelectorAll('.tome-title')].map((node) => ({
        text: node.textContent,
        parts: [...node.children].map((child) => child.classList[0]),
        children: [...node.children].reduce((count, child) => count + child.children.length, 0),
      }));
      const value = diagram.querySelector('.chronicle-chart')?.getAttribute('aria-valuetext') ?? '';
      const opening = diagram.querySelector('.chronicle-headline[data-opening="true"] .chronicle-label');
      const figure = {
        text: opening?.textContent.trim() ?? '',
        parts: [...(opening?.children ?? [])].map((child) => child.classList[0]),
        children: [...(opening?.children ?? [])].reduce((count, child) => count + child.children.length, 0),
      };
      return {
        pwned: window.__pwned === undefined ? 'clean' : 'executed',
        injected: diagram.querySelectorAll('img, script, iframe, object, embed').length,
        layers,
        heads,
        figure,
        matches: {
          layer: layers.some((node) => node.text === label),
          value: value.endsWith(`: ${label}`),
          head: heads.some((node) => node.text === label),
          models: heads.some((node) => node.text === `Models of ${label}`),
          figure: figure.text.startsWith(`${label} `),
        },
        /* THE ACCOUNT IS NOT A RENDERED SURFACE. It is still admitted into the
           model (lib/token-usage.ts) and no component draws it, so the honest
           assertion is that it reaches the document nowhere at all. */
        accountAnywhere: window.document.body.textContent.includes(account),
        measured: diagram.querySelectorAll('.chronicle-cell[data-measured="true"]').length,
      };
    },
    [hostile, hostileAccount]
  );

  expect(observed.pwned, 'a payload string executed in the page').toBe('clean');
  expect(observed.injected, 'a payload string created elements in the diagram').toBe(0);
  /* Rendered, and rendered VERBATIM: a lane that only checked "nothing
     executed" would pass on a diagram that silently dropped the label. */
  expect(observed.matches.layer, 'the hostile label did not reach its layer button as its own literal text').toBe(true);
  expect(observed.matches.value, 'the hostile label did not reach the graph’s accessible value as its own literal text').toBe(true);
  expect(observed.matches.head, 'the hostile label did not reach its account as its own literal text').toBe(true);
  expect(observed.matches.models, 'the hostile label did not reach its models leaf as its own literal text').toBe(true);
  expect(observed.matches.figure, `the hostile label did not reach its seal's token figure as its own literal text: "${observed.figure.text}"`).toBe(true);
  /* The figure's label is drawn from the component's one initial and the
     label's own text, never from an element the label brought. */
  expect(observed.figure.parts, 'the token figure\u2019s label is drawn from elements the component never wrote').toEqual(['chronicle-initial']);
  expect(observed.figure.children, 'the token figure\u2019s label grew element children from its payload string').toBe(0);
  expect(
    observed.accountAnywhere,
    'the account reached the document; no component draws it, so a string that arrives there is a surface nobody reviewed'
  ).toBe(false);
  for (const node of [...observed.layers, ...observed.heads]) {
    expect(node.children, 'a source name grew element children from its payload string').toBe(0);
  }
  /* A head's own elements are the component's two, never one the label
     brought: its initial and the rest of the name. */
  for (const head of observed.heads) {
    expect(head.parts, `the head "${head.text}" is drawn from elements the component never wrote`).toEqual(['tome-initial', 'tome-rest']);
  }
  expect(observed.measured, 'the staged payload drew no calendar; this half proved nothing').toBeGreaterThan(0);

  /* The other half: a start date that is not a calendar date. The calendar
     does day arithmetic on that string, so admission refuses the WHOLE payload
     rather than rendering the parts of it that happened to parse — and the
     diagram says so honestly: no source is offered a layer, a line or an
     account, and no figure on the roll claims a token count at all. (It was
     the shared total's dash until the figures came to follow the picked seal,
     owner 2026-10-21, issue 385: with no source there is no token seal, so
     the roll reads the contributions' own figures and nothing else.) The
     version-control calendar comes from a DIFFERENT panel and keeps drawing,
     which is what keeps this from asserting that the wrong panel went blank. */
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await stageUsagePayload(page, (envelope) => {
    const sources = envelope?.data?.sources ?? [];
    sources[0].series = { startDate: '"><script>window.__pwned = true</script>', totals: [1] };
  });
  await visit(page);
  const refused = await page.evaluate(() => {
    const diagram = window.document.querySelector('.chronicle');
    const token = [...diagram.querySelectorAll('.chronicle-headline')].find((node) =>
      /token/i.test(node.querySelector('.chronicle-label')?.textContent ?? '')
    );
    return {
      pwned: window.__pwned === undefined ? 'clean' : 'executed',
      injected: diagram.querySelectorAll('img, script, iframe, object, embed').length,
      /* The graph draws one layer at a time; a token layer's plot is any
         plot not drawn in the calendar's own tone. */
      lines: diagram.querySelectorAll('.chronicle-plot:not([data-tone="grid"])').length,
      accounts: diagram.querySelectorAll('.chronicle-account').length,
      tokenLayers: diagram.querySelectorAll('.chronicle-layers button').length,
      tokenFigure: token?.querySelector('.chronicle-figure')?.textContent.trim() ?? null,
      figures: diagram.querySelectorAll('.chronicle-headline').length,
      tone: diagram.querySelector('.chronicle-plot')?.getAttribute('data-tone') ?? null,
      cells: diagram.querySelectorAll('.chronicle-cell').length,
    };
  });
  expect(refused.pwned, 'a malformed start date executed in the page').toBe('clean');
  expect(refused.injected, 'a malformed start date created elements in the diagram').toBe(0);
  expect(refused.lines, 'a refused payload still drew a token line').toBe(0);
  expect(refused.accounts, 'a refused payload still printed an account').toBe(0);
  expect(refused.tokenLayers, 'a refused payload still offered a token layer').toBe(0);
  expect(refused.tone, 'the roll does not read the contributions once the token payload is refused').toBe('grid');
  expect(refused.figures, 'the contributions\u2019 seal prints no figures of its own; the next line would pass on an empty roll').toBeGreaterThan(0);
  expect(refused.tokenFigure, `a refused payload still prints a token figure: ${refused.tokenFigure}`).toBeNull();
  expect(refused.cells, 'the version-control calendar went blank with the token payload').toBeGreaterThan(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/* THE BOSS LOG IS A TICKER NOW (owner directive, 2026-09-03, issue 287).
 *
 * The three-column table this lane used to measure is retired. The owner's
 * non-negotiable for its replacement is exact — "the ticker is a scrollable
 * strip under reduced motion" — and it inverts the old claim rather than
 * bending it: the old table's whole point was that nothing scrolled, and the
 * strip's whole point is that it does. So the assertion is re-aimed, not
 * relaxed, and the floor underneath is the one AGENTS.md states for any wide
 * content: it scrolls INSIDE ITS OWN CONTAINER and never takes the document
 * sideways.
 *
 * Four things are pinned, and each fails on its own:
 *
 *   - the strip is a real scroll region with somewhere to scroll to, and the
 *     document beside it is not;
 *   - the whole collection is there — one readable copy of every entry the
 *     payload carries, with the marquee's second lane hidden from assistive
 *     technology rather than double-counted;
 *   - the vendored art actually painted, measured off the decoded images
 *     rather than off the markup, which is what the retired icon count did;
 *   - and the strip is REACHABLE without a pointer. A pan only a mouse can
 *     drive leaves most of the collection unreadable, which is exactly the
 *     failure the base-state-is-a-scroller rule in styles.css exists to
 *     prevent.
 *
 * The reduced-motion half runs the same measurements with the preference
 * emulated, because that is the state the owner named: the run must carry no
 * animation and the strip must still be pannable. A build that had made the
 * animation the only way across fails there and nowhere else. */
test('the boss ticker pans inside its own box, and still pans with the motion off', async ({
  page,
}) => {
  await visit(page);
  const readTicker = () =>
    page.evaluate(() => {
      const strip = window.document.querySelector('.ticker-strip');
      const run = strip.querySelector('.ticker-run');
      const lanes = [...strip.querySelectorAll('.ticker-lane')];
      /* The marquee draws its lane twice so the band can wrap without a seam.
         Exactly one copy is readable; the other is aria-hidden, and counting
         both would report twice the collection. */
      const readable = lanes.filter((lane) => lane.getAttribute('aria-hidden') !== 'true');
      const items = readable.flatMap((lane) => [...lane.querySelectorAll('.ticker-item')]);
      const style = getComputedStyle(strip);
      return {
        lanes: lanes.length,
        readableLanes: readable.length,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        scrollWidth: strip.scrollWidth,
        clientWidth: strip.clientWidth,
        clientHeight: strip.clientHeight,
        /* The BAND's own height, not the strip's scrollHeight. Each entry
           carries the page's hover-detail, which is a fixed-position element
           an engine may count into the scroller's overflow even though it is
           never laid out in the band; measuring the run is measuring the thing
           that must not be clipped. */
        runHeight: Math.round(run.getBoundingClientRect().height * 100) / 100,
        docScrollWidth: window.document.documentElement.scrollWidth,
        docClientWidth: window.document.documentElement.clientWidth,
        items: items.length,
        labelled: items.every((item) => (item.getAttribute('aria-label') ?? '') !== ''),
        /* Every entry carries a mark of some kind — the vendored artwork, or
           the glyph an entry with no art falls back to — so an entry rendering
           bare is visible here rather than inferred. */
        marked: items.filter((item) => item.querySelector('.ticker-icon') !== null).length,
        art: items.filter((item) => item.querySelector('img.ticker-icon') !== null).length,
        /* PAINTED, not merely present, and only where painting is due. The
           artwork is lazily loaded and this strip is mostly off its own box,
           so an engine is right to have decoded nothing out there — counting
           the whole band would be asserting against the lazy attribute rather
           than against the art. What must hold is that every image the reader
           can actually SEE decoded: a broken reference reports a natural width
           of zero and fails here, which is the failure the retired icon count
           could not see either way.
           
           Measured while the band is RUNNING this is a read of wherever the
           marquee happens to be, which on a phone is often the lead alone —
           the lead is wider than the strip's box there — so the reading is
           taken as data here and ASSERTED only in the reduced-motion half
           below, where the strip is a scroller this lane can put items into
           deterministically. */
        inView: (() => {
          const box = strip.getBoundingClientRect();
          const visible = items
            .map((item) => item.querySelector('img.ticker-icon'))
            .filter((art) => art !== null)
            .filter((art) => {
              const seat = art.getBoundingClientRect();
              return seat.right > box.left && seat.left < box.right;
            });
          return { count: visible.length, decoded: visible.filter((art) => art.naturalWidth > 0).length };
        })(),
        tabbable: strip.getAttribute('tabindex'),
        named: (strip.getAttribute('aria-label') ?? '') !== '',
        animation: getComputedStyle(run).animationName,
      };
    });

  const running = await readTicker();
  /* The collection is all there, once. The payload carries the owner's whole
     boss log, so a strip that rendered a handful of entries — or that counted
     its own hidden duplicate — misses this by a wide margin. */
  expect(running.lanes, 'the marquee lost the second lane it wraps with').toBe(2);
  expect(running.readableLanes, 'both marquee lanes are readable; the collection is doubled').toBe(
    1
  );
  expect(running.items, 'the ticker rendered no entries').toBeGreaterThan(50);
  expect(running.labelled, 'a ticker entry carries no accessible name').toBe(true);
  expect(running.marked, 'a ticker entry rendered with no mark of any kind').toBe(running.items);
  expect(running.art, 'the ticker rendered none of the vendored artwork').toBeGreaterThan(50);
  /* A scroll region with somewhere to go, on the inline axis only. */
  expect(running.overflowX, 'the ticker is not a scroller on the inline axis').toBe('auto');
  expect(running.overflowY, 'the ticker scrolls on the block axis too').toBe('hidden');
  expect(
    running.scrollWidth,
    `the ticker has ${running.scrollWidth}px of content in a ${running.clientWidth}px box; there is nothing to pan`
  ).toBeGreaterThan(running.clientWidth + subPixel);
  expect(
    running.runHeight,
    `the band is ${running.runHeight}px inside a ${running.clientHeight}px strip, so it is clipped on the block axis`
  ).toBeLessThanOrEqual(running.clientHeight + subPixel);
  /* ...and the document beside it stays put, which is the floor the strip's
     own scroller exists to satisfy. */
  expect(
    running.docScrollWidth,
    `the ticker took the document sideways (${running.docScrollWidth} > ${running.docClientWidth})`
  ).toBeLessThanOrEqual(running.docClientWidth + subPixel);
  /* Reachable without a pointer. */
  expect(running.tabbable, 'the ticker is a scroller no keyboard can reach').toBe('0');
  expect(running.named, 'the ticker scroll region carries no accessible name').toBe(true);

  /* THE STATE THE OWNER NAMED. With the preference set the run carries no
     animation at all, and every measurement above still holds — the strip is
     the scroller it always was, so the collection stays readable by pan. */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await visit(page);
  /* The strip is panned past its lead so that entries — not only the lead's
     own mark — are inside its box, then the art inside the box is given the
     time a lazy image legitimately takes to decode. The wait is bounded and
     it is a wait for the ENGINE (Firefox and WebKit decode a lazy image
     measurably later than Chromium, exactly as the gallery lane records); it
     widens nothing about what is asserted, which is that every image inside
     the box decoded and none of them decoded to nothing. */
  await page.locator('.ticker-strip').evaluate((strip) => {
    /* Into the VIEWPORT first, then panned. A lazy image loads when it meets
       the viewport, and Firefox and WebKit hold to that literally — an image
       panned into a strip's box while the strip itself is a screen below the
       fold is never loaded there, however long the lane waits. Chromium's far
       larger lazy margin is what made the same lane pass in one engine and
       time out in two. */
    strip.scrollIntoView({ block: 'center' });
    strip.scrollLeft = strip.querySelector('.ticker-item').getBoundingClientRect().width;
  });
  await expect
    .poll(async () => (await readTicker()).inView, {
      message: 'the artwork inside the panned strip never decoded',
      timeout: 10_000,
    })
    .toEqual(expect.objectContaining({ count: expect.any(Number) }));
  await expect
    .poll(
      async () => {
        const seen = (await readTicker()).inView;
        return seen.count > 0 && seen.decoded === seen.count;
      },
      { message: 'an icon inside the visible strip decoded to nothing', timeout: 10_000 }
    )
    .toBe(true);
  const still = await readTicker();
  expect(
    still.inView.count,
    'no artwork is inside the panned strip, so the decode check proves nothing'
  ).toBeGreaterThan(0);
  expect(
    still.inView.decoded,
    `${still.inView.count - still.inView.decoded} of the ${still.inView.count} visible icons decoded to nothing`
  ).toBe(still.inView.count);
  expect(
    still.animation,
    `the ticker still runs "${still.animation}" for a reader who asked for less motion`
  ).toBe('none');
  expect(still.items, 'the ticker lost its entries under reduced motion').toBe(running.items);
  expect(still.overflowX, 'the ticker stopped being a scroller under reduced motion').toBe('auto');
  expect(
    still.scrollWidth,
    'under reduced motion the ticker has nothing to pan, so most of the collection is unreachable'
  ).toBeGreaterThan(still.clientWidth + subPixel);
  expect(
    still.tabbable,
    'under reduced motion the ticker is a scroller no keyboard can reach'
  ).toBe('0');
  expect(
    still.docScrollWidth,
    'under reduced motion the ticker took the document sideways'
  ).toBeLessThanOrEqual(still.docClientWidth + subPixel);
  await page.emulateMedia({ reducedMotion: null });
});

/* THE BOSS STRIP (owner, 2026-10-19). Three rulings, measured together:
 *   - ITS ORDER IS THE HISCORES' OWN ("by the order in which they appear in
 *     the runelite plugin viewer"): the strip follows the payload and sorts
 *     nothing. Staged with the payload reversed, so a strip that sorted by
 *     kill count — or kept any order of its own — draws a different sequence
 *     from the one it was handed; the staging is checked to be unsorted first.
 *   - IT READS 15% LARGER ("increase the size of this by 15%"): a 25px icon,
 *     0.65rem by 1rem around each boss, and the figure at 1.15 times the
 *     ledger's figure size, each read from the engine.
 *   - NOTHING PARTS THE BOSSES BUT SPACE ("the skulls here do not look good"):
 *     no border and no picture on any boss and no frame round the strip.
 *   - NOTHING LEADS THEM (the same day, of the lead's figure and its blade:
 *     "remove this"): the strip's first item in either lane is a boss. */
test('the boss strip keeps the payload’s order, reads 15% larger, and parts its bosses by space alone (owner 2026-10-19)', async ({
  page,
}) => {
  let staged = [];
  await page.route('**/api/panels/boss-log', async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    envelope.data.bosses.reverse();
    staged = envelope.data.bosses.map((boss) => ({ name: boss.name, kc: boss.kc ?? -1 }));
    await route.fulfill({ response, json: envelope });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await visit(page);
  expect(staged.length, 'the origin served too few bosses to order').toBeGreaterThan(2);
  const byCount = [...staged].sort((a, b) => b.kc - a.kc).map((boss) => boss.name);
  expect(byCount, 'the staged order is already the kill-count order, so this lane cannot tell order from sorting').not.toEqual(
    staged.map((boss) => boss.name)
  );
  const observed = await page.evaluate(() => {
    const rem = Number.parseFloat(getComputedStyle(window.document.documentElement).fontSize);
    const probe = window.document.createElement('span');
    probe.style.fontSize = 'var(--ledger-figure-size)';
    window.document.body.appendChild(probe);
    const figureToken = Number.parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    const strip = window.document.querySelector('#trackers .ticker-strip');
    const lane = strip.querySelector('.ticker-lane:not([aria-hidden="true"])');
    const parts = (node) => {
      const style = getComputedStyle(node);
      return {
        borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].map(Number.parseFloat),
        picture: style.backgroundImage,
        ground: style.backgroundColor,
      };
    };
    const items = [...lane.querySelectorAll('.ticker-item')];
    const first = items[0];
    const icon = first.querySelector('.ticker-icon').getBoundingClientRect();
    const itemStyle = getComputedStyle(first);
    return {
      rem,
      figureToken,
      labels: items.map((item) => item.getAttribute('aria-label') ?? ''),
      icon: [icon.width, icon.height],
      padding: [itemStyle.paddingTop, itemStyle.paddingRight, itemStyle.paddingBottom, itemStyle.paddingLeft].map(Number.parseFloat),
      figure: Number.parseFloat(getComputedStyle(first.querySelector('.ticker-figure')).fontSize),
      items: items.map(parts),
      leads: [...strip.querySelectorAll('.ticker-lane')].map((each) => ({
        first: each.firstElementChild?.className ?? '',
        pictures: each.querySelectorAll('img:not(.ticker-icon), svg').length,
      })),
      strip: parts(strip),
    };
  });
  /* The order. */
  expect(observed.labels.length, 'the strip drew a different number of bosses from the payload').toBe(staged.length);
  for (const [index, boss] of staged.entries()) {
    expect(observed.labels[index], `boss ${index} is not the payload's ${boss.name}`).toMatch(new RegExp(`^${boss.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `));
  }
  /* The size. */
  expect(observed.icon[0], `a boss icon is ${observed.icon[0]}px wide`).toBeCloseTo(25, 1);
  expect(observed.icon[1], `a boss icon is ${observed.icon[1]}px tall`).toBeCloseTo(25, 1);
  expect(observed.padding, 'a boss is not padded 0.65rem by 1rem').toEqual([
    expect.closeTo(0.65 * observed.rem, 1),
    expect.closeTo(observed.rem, 1),
    expect.closeTo(0.65 * observed.rem, 1),
    expect.closeTo(observed.rem, 1),
  ]);
  expect(observed.figureToken, 'the ledger figure size resolves to nothing').toBeGreaterThan(0);
  expect(
    observed.figure,
    `a boss's figure is ${observed.figure}px against the ledger's ${observed.figureToken}px figure`
  ).toBeCloseTo(1.15 * observed.figureToken, 1);
  /* Space alone. */
  for (const [index, item] of observed.items.entries()) {
    expect(item.borders, `boss ${index} draws a border`).toEqual([0, 0, 0, 0]);
    expect(item.picture, `boss ${index} paints a picture (a separator)`).toBe('none');
  }
  expect(observed.strip.borders, 'the strip draws a frame').toEqual([0, 0, 0, 0]);
  /* No lead. */
  expect(observed.leads.length, 'the strip lost its loop, or grew a third lane').toBe(2);
  for (const [index, lane] of observed.leads.entries()) {
    expect(lane.first, `lane ${index} opens on "${lane.first}" rather than a boss`).toMatch(/^ticker-item\b/);
    expect(lane.pictures, `lane ${index} draws a picture that is not a boss's icon`).toBe(0);
  }
});

/* THE TRACKERS' FIGURES OPEN THE ROLL, AND THE WRITING FILLS THE REST OF IT
 * (owner, 2026-10-19: "large awkward gap in between here, either expand the
 * heatmap or find a way to present the information in a better way"; the
 * Rotulus, picked 2026-10-20). The figures are the roll's incipit: on a desk
 * they stand in one column at the start of the parchment, wholly beside the
 * graph, and on a phone they stand above it. Whichever, the graph and the
 * calendar under it run to the end of the parchment's writing — on a phone
 * from its start as well — and the calendar's DRAWING does too: its first and
 * last days sit within their own half-gap of its box's two edges, at the scale
 * the engine drew them, so no empty band opens beside the days however the
 * figures are set. The writing is the sheet's content box, read off its own
 * padding. Measured at the owner's 1100px, at a monitor, at the page's
 * breakpoint and at two phones. */
test('the trackers open their roll with the figures and fill the rest of it with the graph and calendar, at every width (owner 2026-10-19; 2026-10-20)', async ({
  page,
}) => {
  await visit(page);
  for (const width of [1440, 1100, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    const observed = await page.evaluate(() => {
      const box = (node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
      };
      const sheet = window.document.querySelector('.chronicle-sheet');
      const style = getComputedStyle(sheet);
      const sheetBox = box(sheet);
      const calendar = window.document.querySelector('.chronicle-calendar');
      const drawing = calendar.querySelector('svg');
      const view = drawing.viewBox.baseVal;
      const scale = drawing.getBoundingClientRect().width / view.width;
      const cells = [...drawing.querySelectorAll('.chronicle-cell')].map((cell) => ({
        x: Number(cell.getAttribute('x')),
        width: Number(cell.getAttribute('width')),
      }));
      const drawn = drawing.getBoundingClientRect();
      return {
        writing: {
          left: sheetBox.left + Number.parseFloat(style.paddingLeft),
          right: sheetBox.right - Number.parseFloat(style.paddingRight),
        },
        headlines: [...window.document.querySelectorAll('.chronicle-headline')].map(box),
        chart: box(window.document.querySelector('.chronicle-chart')),
        calendar: box(calendar),
        firstDay: drawn.left + Math.min(...cells.map((cell) => cell.x)) * scale,
        lastDay: drawn.left + Math.max(...cells.map((cell) => cell.x + cell.width)) * scale,
        /* The first column's own inset in the drawing: half the gap between
           two days, at the scale drawn. */
        halfGap: Math.min(...cells.map((cell) => cell.x)) * scale,
        cells: cells.length,
      };
    });
    const at = `at ${width}px`;
    const phone = width < 768;
    const { writing, headlines, chart, calendar } = observed;
    expect(headlines.length, `the roll opens on fewer than two figures ${at}`).toBeGreaterThan(1);
    expect(observed.cells, `the calendar draws no days ${at}`).toBeGreaterThan(0);
    /* The figures: one column from the writing's start, each under the last. */
    for (const [index, headline] of headlines.entries()) {
      expect(Math.abs(headline.left - writing.left), `figure ${index} starts ${(headline.left - writing.left).toFixed(1)}px into the writing ${at}`).toBeLessThanOrEqual(1);
      if (index > 0) {
        expect(headline.top, `figure ${index} is not under the one before it ${at}`).toBeGreaterThanOrEqual(headlines[index - 1].bottom - subPixel);
      }
      if (phone) {
        expect(headline.bottom, `a figure reaches below the graph's top ${at}`).toBeLessThanOrEqual(chart.top + subPixel);
      } else {
        expect(headline.right, `a figure reaches into the graph ${at}`).toBeLessThanOrEqual(chart.left + subPixel);
      }
    }
    /* The graph and the calendar: one column, to the writing's end. */
    for (const [name, part] of [
      ['graph', chart],
      ['calendar', calendar],
    ]) {
      expect(Math.abs(part.right - writing.right), `the ${name} ends ${(writing.right - part.right).toFixed(1)}px short of the writing ${at}`).toBeLessThanOrEqual(1);
      if (phone) {
        expect(Math.abs(part.left - writing.left), `the ${name} starts ${(part.left - writing.left).toFixed(1)}px into the writing ${at}`).toBeLessThanOrEqual(1);
      }
    }
    expect(Math.abs(calendar.left - chart.left), `the calendar and the graph start apart ${at}`).toBeLessThanOrEqual(1);
    expect(calendar.top, `the calendar is not under the graph ${at}`).toBeGreaterThanOrEqual(chart.bottom - subPixel);
    expect(
      observed.firstDay - calendar.left,
      `the calendar's first day starts ${(observed.firstDay - calendar.left).toFixed(1)}px into its box ${at}: an empty band`
    ).toBeLessThanOrEqual(observed.halfGap + 1);
    expect(
      calendar.right - observed.lastDay,
      `the calendar's last day ends ${(calendar.right - observed.lastDay).toFixed(1)}px short of its box ${at}: an empty band`
    ).toBeLessThanOrEqual(observed.halfGap + 1);
  }
});

/* The detail this table used to draw itself is now the page's one hover-detail
   primitive, anchored to the VIEWPORT rather than to a grid cell, and it has
   its own battery at the end of this file — including the containment floor
   this test used to carry: nothing the detail does may make the page scroll
   sideways at 320px. That floor did not move, it got stronger; it is now
   measured at every viewport edge rather than only the inline ones. */

test('the page names its owner, carries no badges, and wears no button chrome', async ({ page }) => {
  await visit(page);
  const observed = await page.evaluate(() => {
    /* EVERY .icon-button in the document, open or not: the shape is shared
       (issue 176 reuses it for the gallery's close control), and since the
       footer and its reading-mode trigger went, and the sky's control after
       them (owner, 2026-10-19), the gallery's lightbox close is the only
       control that wears it. Read as computed style, which an engine answers
       for a closed dialog's contents too, so the shape is measured without
       opening anything. */
    const icons = [...window.document.querySelectorAll('.icon-button')];
    return {
      heading: window.document.querySelector('h1')?.textContent?.trim(),
      titles: [...window.document.querySelectorAll('.panel-title')].map((n) => n.textContent.trim()),
      badges: window.document.querySelectorAll('.panel-badge').length,
      provenance: [...window.document.querySelectorAll('.panel-shell')].every((n) =>
        n.hasAttribute('data-panel-status')
      ),
      icons: icons.map((node) => {
        const style = getComputedStyle(node);
        return {
          label: node.getAttribute('aria-label'),
          inLightbox: node.closest('dialog.gallery-lightbox') !== null,
          border: Number.parseFloat(style.borderTopWidth),
          radius: Number.parseFloat(style.borderTopLeftRadius),
          background: style.backgroundColor,
        };
      }),
    };
  });
  expect(observed.heading).toBe('Samuel Naranjo');
  /* The heading the ORIGIN serves for the version-control panel, chosen in
     config data because neither source tree may spell a vendor name. It used
     to be read off the rendered card; the commits block renders no panel
     label now (owner directive, 2026-09-04, issue 294 — the calendar opens on
     a token series, so the host's name over it would be false), so the path
     is proved one link shorter: config, Go overlay, envelope. The component
     link is proved the other way round — the name must NOT reach the page. */
  const activityTitle = await page.evaluate(async () => {
    const envelope = await (await fetch('/api/panels/vcs-activity')).json();
    return envelope?.title ?? '';
  });
  expect(activityTitle).toBe('GitHub');
  expect(observed.titles, 'the commits block wears the host name over a token calendar again').not.toContain(
    'GitHub'
  );
  /* No card announces its own age any more, and every card still carries the
     status the badge used to read from. */
  expect(observed.badges, 'a freshness badge is rendering again').toBe(0);
  expect(observed.provenance, 'a card lost the status the badge used to display').toBe(true);
  /* NO CHROME CONTROL IS LEFT. The page's own chrome carried one icon — the
     reading mode, in the header row and then the footer — after the manual
     refresh beside it retired (issue 179); the footer took it (owner,
     2026-10-19), and the sky's control that took its place the same day went
     too ("do away with this all together but keep the logic"). So the icon
     shape lives only inside the gallery's lightbox, and one that turns up
     anywhere else is chrome coming back. The position rules (the corner of
     issue 168, the footer of 2026-10-16) and the touch target held here went
     with their subject; the lightbox close is held to the 44px floor by its
     own lane ("the lightbox close mark is small, off the artwork, and still a
     44px target"), with the lightbox open. */
  expect(observed.icons.length, 'no control wears the shared icon shape; the checks below prove nothing').toBeGreaterThan(0);
  expect(
    observed.icons.filter((icon) => !icon.inLightbox).map((icon) => icon.label),
    'the page wears an icon control outside the gallery lightbox again'
  ).toEqual([]);
  for (const icon of observed.icons) {
    /* Icons, not buttons: no disc, no border, no fill. */
    expect(icon.border, `"${icon.label}" wears a border`).toBe(0);
    expect(icon.radius, `"${icon.label}" wears a disc`).toBe(0);
    expect(icon.background, `"${icon.label}" wears a fill`).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  }
});

/* ===========================================================================
 * The refresh and the fragment (owner report, issue 171)
 *
 * "Refreshing the website twice in Orion browser iphone causes the screen to
 * go to #trackers immediately." Two behaviors had to hold at once: a refresh
 * loads the page at the top rather than wherever the reader had been, and a
 * direct visit to a shared .../#trackers URL still deep-links, because that
 * half is desirable and stays. tests/sections.test.mjs pins the shape of the
 * fix; these execute the actual reload against a real History API.
 *
 * The nav's half of it is retired with the nav (owner direction, 2026-10-16:
 * "do away with it for now"): "a nav tap does not leave a fragment for a
 * refresh to re-apply" tapped a link no page carries any more. Its refresh
 * half never needed the nav — a browser restores a scroll offset per history
 * entry whether or not a fragment led there — so it is measured from a plain
 * scroll now, against the page-level setting that answers it.
 * ======================================================================== */

test('a refresh loads the page at the top rather than where the reader had scrolled (issue 171)', async ({ page }) => {
  await visit(page);
  await page.locator('#trackers').scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled, 'the page did not scroll, so this check proves nothing').toBeGreaterThan(0);
  // The refresh this issue is actually about: a page whose scroll offset is
  // restored here loads mid-page, which is the defect Orion reported.
  await page.reload();
  await settled(page);
  const scrollTop = await page.evaluate(() => window.scrollY);
  expect(scrollTop, `a refresh restored a ${scrolled}px scroll position instead of loading at the top`).toBe(0);
});

test('a direct visit to a shared fragment URL still deep-links (issue 171)', async ({ page }) => {
  await page.goto('/#trackers');
  await settled(page);
  await expect(page.locator('#trackers')).toBeInViewport();
});

/* A SOURCE WITH NO DAILY SERIES IS OFFERED NO CALENDAR AND KEEPS ITS FIGURES
 * (owner ruling, 2026-08-24; re-aimed by the ledger redesign, issue 287, and
 * again on 2026-10-16 when the trackers became one diagram).
 *
 * The ruling: a calendar held open for a source that has no daily record to
 * publish is a permanent hole, not a zero-CLS reserve. In the diagram a
 * source's calendar is a LAYER and its graph a LINE, so the ruling's shape here
 * is that a seriesless source is offered neither — nothing to press, no line
 * drawn flat along the floor on its behalf.
 *
 * Both directions, because either half alone is satisfied by a page that got
 * it badly wrong: a build that offered no token layers at all passes "the
 * seriesless source has none", and the old arrangement passes "the source with
 * a series draws its calendar".
 *
 * And the third claim is what stops "offer no calendar" from quietly becoming
 * "drop the source": the seriesless source keeps its ACCOUNT under the
 * diagram, with its figures intact. A source that vanished from the page
 * entirely would satisfy the first two and be a worse outcome than the hole.
 *
 * The page is judged against the ORIGIN's own payload, and one source's series
 * is staged away rather than waited for, so the lane always has one source of
 * each kind on the same screen. */
test('a seriesless source is offered no calendar and keeps its figures', async ({ page }) => {
  await stageUsagePayload(page, (envelope) => {
    const sources = envelope?.data?.sources ?? [];
    expect(
      sources.length,
      'the origin serves fewer than two usage sources; this lane cannot show one of each'
    ).toBeGreaterThan(1);
    delete sources[0].series;
  });
  await visit(page);
  const observed = await page.evaluate(async () => {
    const response = await fetch('/api/panels/token-usage');
    const envelope = await response.json();
    const diagram = window.document.querySelector('.chronicle');
    return {
      reported: (envelope?.data?.sources ?? []).map((source) => ({
        label: source.label,
        series: Array.isArray(source?.series?.totals) && source.series.totals.length > 0,
      })),
      layers: [...diagram.querySelectorAll('.chronicle-layers button')].map((node) => node.textContent.trim()),
      accounts: [...diagram.querySelectorAll('.chronicle-account')].map((account) => ({
        label: account.querySelector('.chronicle-account-name')?.textContent.trim() ?? '',
        facts: account.querySelectorAll('.chronicle-fact').length,
      })),
      measured: diagram.querySelectorAll('.chronicle-cell[data-measured="true"]').length,
    };
  });

  const bare = observed.reported.filter((source) => !source.series);
  const drawn = observed.reported.filter((source) => source.series);
  expect(bare.length, 'no source reports an absent series even with one staged away').toBeGreaterThan(0);
  expect(drawn.length, 'every source lost its series; the other half would pass for free').toBeGreaterThan(0);

  /* THE LINES, read by pressing each layer: the graph draws ONE layer at a
     time and has no legend (owner direction, 2026-10-16), so a source's line
     exists exactly when its layer can be pressed and draws a path when it is.
     A source with no layer therefore has no line by construction, and the
     lane proves the other direction for every source that has one. */
  await page.locator('.chronicle-chart').scrollIntoViewIfNeeded();
  await expect(page.locator('.chronicle')).toHaveAttribute('data-shown', 'true');
  const lines = [];
  for (const label of observed.layers) {
    await page.locator('.chronicle-layers button', { hasText: label }).first().click();
    const drawn = await page
      .locator('.chronicle-plot .chronicle-line:not(.chronicle-ahead)')
      .getAttribute('d', { timeout: 5_000 })
      .catch(() => null);
    if (drawn !== null && drawn.trim() !== '') lines.push(label);
  }
  for (const source of bare) {
    const name = sourceName(source.label);
    /* NOTHING TO PRESS, AND THEREFORE NO LINE. */
    expect(observed.layers, `"${source.label}" reports no series and is still offered a calendar layer`).not.toContain(name);
    expect(lines, `"${source.label}" reports no series and still draws a line`).not.toContain(name);
    /* ...and it is still ON the page, with its figures. */
    const account = observed.accounts.find((candidate) => candidate.label === name);
    expect(account, `"${source.label}" reports no series and lost its account as well as its calendar`).toBeDefined();
    expect(account.facts, `"${source.label}" kept its account and lost the figures in it`).toBeGreaterThan(0);
  }
  for (const source of drawn) {
    const name = sourceName(source.label);
    expect(observed.layers, `"${source.label}" reports a series and is offered no calendar layer`).toContain(name);
    expect(lines, `"${source.label}" reports a series and draws no line`).toContain(name);
    expect(
      observed.accounts.some((candidate) => candidate.label === name),
      `"${source.label}" reports a series and prints no account`
    ).toBe(true);
  }
  expect(observed.measured, 'the calendar drew no measured day at all').toBeGreaterThan(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/* ONE BOX, WHICHEVER LAYER IS IN IT (issues 178/268; owner directive,
 * 2026-09-03, issue 287; re-aimed 2026-10-16 at the trackers' one diagram,
 * whose graph AND calendar the reader repaints with a LAYER — the span buttons
 * this lane also pressed were removed the same day, when the graph became the
 * whole calendar read as a line).
 *
 * The guarantee is the zero-CLS floor at its sharpest, because here the reader
 * causes the change: pressing a layer must change what the diagram says and
 * nothing about where anything is. A box that resized on a press would move
 * every tracker below it under a reader who just pressed a button.
 *
 * What a press SAYS is measured as hard as what it moves (owner direction,
 * 2026-10-16: "it makes no sense that the graph doesn't change to show
 * contributions when I pick contributions"): every layer draws its OWN line —
 * a path and an ink no other layer shares — and only ONE is ever drawn.
 *
 * It is a DIFFERENT claim from the calendar-identity lane and neither covers
 * the other: a build could draw every layer on the same days and still size
 * one of them differently, and it could hold the geometry perfectly while
 * painting one layer a week to the left. And it stages NOTHING: it takes the
 * origin's real payload and refuses to run on a diagram offering fewer than two
 * layers, which is what stops it degenerating into a box compared with itself. */
test('every layer shares one box, draws its own line, and a switch moves none of it (issues 178/268; owner 2026-09-03, issue 287; 2026-10-16)', async ({
  page,
}) => {
  await visit(page);
  await expect(page.locator('.chronicle-cell').first()).toBeAttached();
  await page.locator('.chronicle-chart').scrollIntoViewIfNeeded();
  await expect(page.locator('.chronicle')).toHaveAttribute('data-shown', 'true');
  await diagramAtRest(page);
  const layers = page.locator('.chronicle-layers button');
  const layerCount = await layers.count();
  expect(layerCount, `the diagram offers ${layerCount} layer(s); a shared-box claim needs at least two`).toBeGreaterThan(1);
  const measure = () =>
    page.evaluate(() => {
      const box = (node) => {
        if (node === null) return null;
        const rect = node.getBoundingClientRect();
        return `${Math.round(rect.x * 100) / 100},${Math.round((rect.y + window.scrollY) * 100) / 100} ${Math.round(rect.width * 100) / 100}x${Math.round(rect.height * 100) / 100}`;
      };
      const query = (selector) => window.document.querySelector(selector);
      const shapeBox = (node) => {
        if (node instanceof SVGGraphicsElement && node.ownerSVGElement !== null) {
          const bbox = node.getBBox();
          const matrix = node.getScreenCTM();
          const a = new DOMPoint(bbox.x, bbox.y).matrixTransform(matrix);
          const b = new DOMPoint(bbox.x + bbox.width, bbox.y + bbox.height).matrixTransform(matrix);
          const left = Math.min(a.x, b.x);
          const top = Math.min(a.y, b.y);
          const width = Math.abs(b.x - a.x);
          const height = Math.abs(b.y - a.y);
          return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top };
        }
        return node.getBoundingClientRect();
      };
      const cells = [...window.document.querySelectorAll('.chronicle-cell')];
      return {
        layer: query('.chronicle-layers button[aria-pressed="true"]')?.textContent.trim() ?? '',
        levels: cells.map((cell) => cell.getAttribute('data-grid-level')).join(''),
        plots: window.document.querySelectorAll('.chronicle-plot').length,
        lines: window.document.querySelectorAll('.chronicle-line:not(.chronicle-ahead)').length,
        tone: query('.chronicle-plot')?.getAttribute('data-tone') ?? null,
        path: query('.chronicle-plot .chronicle-line:not(.chronicle-ahead)')?.getAttribute('d') ?? null,
        diagram: box(query('.chronicle')),
        chart: box(query('.chronicle-chart')),
        calendar: box(query('.chronicle-calendar')),
        day: (() => {
          if (cells[0] === undefined) return null;
          const rect = shapeBox(cells[0]);
          return `${Math.round(rect.x * 100) / 100},${Math.round((rect.y + window.scrollY) * 100) / 100} ${Math.round(rect.width * 100) / 100}x${Math.round(rect.height * 100) / 100}`;
        })(),
        days: cells.length,
        keys: box(query('.chronicle-keys')),
        accounts: box(query('.chronicle-accounts')),
        section: box(query('.chronicle').closest('.page-section')),
        height: window.document.documentElement.scrollHeight,
      };
    });
  const geometry = (reading) => {
    const { layer, levels, plots, lines, tone, path, ...boxes } = reading;
    return boxes;
  };

  const first = await measure();
  expect(first.day, 'the calendar draws a day of no size').not.toMatch(/ 0x0$/);
  expect(first.chart, 'the graph draws a box of no size').not.toMatch(/ 0x0$/);
  const seen = { levels: new Set([first.levels]), paths: new Set(), tones: new Set() };
  for (let index = 0; index < layerCount; index += 1) {
    await layers.nth(index).click();
    await expect(layers.nth(index)).toHaveAttribute('aria-pressed', 'true');
    await diagramAtRest(page);
    const set = await measure();
    seen.levels.add(set.levels);
    expect(geometry(set), `pressing the "${set.layer}" layer moved the diagram`).toEqual(geometry(first));
    /* ONE line at a time: one plot, one drawn line (the dimmed line ahead of
       a cursor only exists while a day is read). */
    expect(set.plots, `the "${set.layer}" layer draws ${set.plots} plots at once`).toBe(1);
    expect(set.lines, `the "${set.layer}" layer draws ${set.lines} lines at once`).toBe(1);
    expect(set.path, `the "${set.layer}" layer draws an empty line`).toMatch(/^M/);
    expect(set.tone, `the "${set.layer}" layer's plot carries no ink`).not.toBeNull();
    seen.paths.add(set.path);
    seen.tones.add(set.tone);
  }
  /* Non-vacuity, and the owner's claim itself: the presses really changed
     what the diagram SAYS — every layer painted the calendar its own way and
     drew a line no other layer drew, in an ink no other layer wears — so
     "nothing moved" is a statement about real switches. */
  expect(seen.levels.size, 'every layer painted the calendar identically; the layer switch did nothing').toBeGreaterThan(1);
  expect(seen.paths.size, `${layerCount} layers drew ${seen.paths.size} distinct lines; the graph does not follow the layer`).toBe(layerCount);
  expect(seen.tones.size, `${layerCount} layers drew in ${seen.tones.size} distinct inks`).toBe(layerCount);
});

/* A DIAGRAM WHOSE DATA IS STILL ON ITS WAY HOLDS EXACTLY THE BOX THAT DATA
 * WILL FILL (AGENTS.md, "Zero CLS": "async data arrivals cause no layout
 * shift; space for late content is reserved up front"; re-aimed 2026-10-16 at
 * the trackers' one diagram, which took over the calendar this lane measured).
 *
 * The calendar and the token series both fetch after hydration, and the box
 * the page holds for them while they are in flight must be the box they land
 * in: the trackers' board, and everything under it on the page, must not move
 * when they arrive. The payloads are delayed deliberately — served from the
 * embedded snapshot on localhost they land within a frame of first paint, so
 * the waiting state is real but too brief to measure, and a lane that cannot
 * observe the state it is about proves nothing. The third panel the diagram
 * reads (the repositories, for the pull-request figure) is left on time, which
 * is the order a real visit can take. */
test('a diagram whose data is still on its way holds exactly the box that data will fill', async ({
  page,
}) => {
  await page.route(/\/api\/panels\/(vcs-activity|token-usage)$/, async (route) => {
    await new Promise((resume) => setTimeout(resume, 3_000));
    await route.continue();
  });
  /* The engine's own layout-shift ledger, armed before the navigation and
     attributed to the trackers' board: the whole page is loading in this
     window, and only a shift naming something inside the board is the board's
     to answer for. Chromium only; the box comparisons run everywhere. */
  await page.addInitScript(() => {
    window.__shifts = { supported: false, page: 0, board: 0 };
    const types = window.PerformanceObserver?.supportedEntryTypes ?? [];
    if (!types.includes('layout-shift')) return;
    window.__shifts.supported = true;
    new window.PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        window.__shifts.page += entry.value;
        const board = window.document.querySelector('#trackers .panel-stack');
        const ours = [...(entry.sources ?? [])].some((source) => source.node && board !== null && board.contains(source.node));
        if (ours) window.__shifts.board += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/');
  const measure = () =>
    page.evaluate(() => {
      const board = window.document.querySelector('#trackers .panel-stack');
      const gallery = window.document.getElementById('gallery');
      if (board === null || gallery === null) return null;
      const box = board.getBoundingClientRect();
      return {
        diagram: window.document.querySelector('.chronicle') !== null,
        ticker: window.document.querySelector('.ticker-strip') !== null,
        chart: window.document.querySelector('.chronicle-chart') !== null,
        days: window.document.querySelectorAll('.chronicle-cell').length,
        note: window.document.querySelector('.chronicle-note') !== null,
        figures: window.document.querySelectorAll('.chronicle-headline').length,
        initials: window.document.querySelectorAll('.chronicle-initial').length,
        height: Math.round(box.height * 100) / 100,
        width: Math.round(box.width * 100) / 100,
        below: Math.round((gallery.getBoundingClientRect().top + window.scrollY) * 100) / 100,
      };
    });
  /* The waiting state: the page is up, the board holds the diagram and the
     ticker, the calendar has not arrived — and the board has stopped growing
     for two reads in a row, so what is measured is the face the page holds
     while it waits rather than a frame of it assembling. */
  let previous = null;
  await expect
    .poll(
      async () => {
        const now = await measure();
        const still =
          now !== null && now.diagram && now.ticker && now.days === 0 && previous !== null && previous.height === now.height;
        previous = now;
        return still;
      },
      { message: 'the board never held a still waiting face to measure', intervals: [100], timeout: 2_500 }
    )
    .toBe(true);
  const waiting = await measure();
  await expect
    .poll(async () => (await measure())?.days ?? 0, { message: 'the delayed payloads never arrived' })
    .toBeGreaterThan(0);
  await settled(page);
  const arrived = await measure();

  expect(waiting.days, 'the waiting state drew days it was never given').toBe(0);
  expect(arrived.chart, 'the diagram arrived with no graph; this lane proves nothing').toBe(true);
  /* WHAT IS COMING IS NOT NOTHING (issue 385): the roll holds the figures its
     first seal will fill, says nothing was captured only when nothing is on
     its way, and draws no illuminated initial before there is a letter. */
  expect(waiting.note, 'the roll said nothing was captured while its data was on its way').toBe(false);
  expect(waiting.figures, 'the roll held a different number of figures from the ones that landed').toBe(arrived.figures);
  expect(arrived.figures, 'the landed roll carries no figures; this lane proves nothing').toBeGreaterThan(0);
  expect(waiting.initials, 'the waiting roll drew an illuminated initial with no letter').toBe(0);
  expect(arrived.initials, 'the landed roll opens without its initial').toBe(1);
  expect(
    arrived.height,
    `the trackers' board was ${waiting.height}px while its data was on its way and ${arrived.height}px once it landed`
  ).toBe(waiting.height);
  expect(arrived.width, 'the trackers’ board changed width when its data arrived').toBe(waiting.width);
  expect(
    arrived.below,
    `the section under the board moved ${(arrived.below - waiting.below).toFixed(2)}px when the board's data arrived`
  ).toBe(waiting.below);
  const shifts = await page.evaluate(() => window.__shifts);
  if (shifts.supported) {
    expect(
      shifts.board,
      `the trackers' board accounted for ${shifts.board} of layout shift on arrival (page total across the load: ${shifts.page})`
    ).toBe(0);
  }
});

/* NOTHING DRAWN IS NOT NOTHING REPORTED (AGENTS.md "Honest states"; issue 385).
 * With the calendar refused and no source sending a series there is nothing
 * to draw and nothing on its way, so the roll is not drawn at all; the
 * accounts the sources DID send read alone rather than under a note saying
 * nothing was captured. With the usage refused as well, the note is the
 * whole truth, and it says so. */
test('with nothing to draw the accounts read alone, and with nothing at all the roll says so', async ({ page }) => {
  await page.route('**/api/panels/vcs-activity', (route) => route.abort());
  await stageUsagePayload(page, (envelope) => {
    const sources = envelope?.data?.sources ?? [];
    expect(sources.length, 'the origin serves no usage source to strip').toBeGreaterThan(0);
    for (const source of sources) delete source.series;
  });
  await visit(page);
  const read = () =>
    page.evaluate(() => {
      const diagram = window.document.querySelector('.chronicle');
      return {
        roll: diagram.querySelectorAll('.chronicle-scroll').length,
        note: diagram.querySelectorAll('.chronicle-note').length,
        accounts: [...diagram.querySelectorAll('.chronicle-account-name')].map((node) => node.textContent.trim()),
      };
    });
  const alone = await read();
  expect(alone.accounts.length, 'the sources sent their figures and no account reads them').toBeGreaterThan(0);
  expect(alone.accounts.every((name) => name !== ''), 'an account reads with no name').toBe(true);
  expect(alone.note, 'the roll says nothing was captured over accounts that were').toBe(0);
  expect(alone.roll, 'an empty roll is drawn with nothing to draw and nothing on its way').toBe(0);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.route('**/api/panels/vcs-activity', (route) => route.abort());
  await page.route('**/api/panels/token-usage', (route) => route.abort());
  await visit(page);
  const none = await read();
  expect(none.accounts, 'an account reads with nothing reported').toEqual([]);
  expect(none.roll, 'a roll is drawn with nothing reported').toBe(0);
  expect(none.note, 'with nothing reported the roll does not say so').toBe(1);
});

/* Outbound navigation for the recent-commits rows (issue 157), measured
 * against a real render rather than only against the pure functions in
 * tests/activity.test.mjs. The origin's own data is well behaved, which is
 * exactly why it cannot demonstrate the hostile half: the response is
 * intercepted and its rows replaced — one with a payload shape a raw
 * interpolation would have turned into a working (and in one case
 * executable) href, the other with a genuine reference. */
test('a hostile commit entry renders as text and never becomes a live link', async ({ page }) => {
  const hostileRepo = 'evil.example" onmouseover="window.__activityEscaped = true';
  const unresolvedPR = 'release (#12e3)'; // not a clean trailing integer
  const hostileSha = '0000000000000000000000000000000000000001" onmouseover="window.__activityShaEscaped = true';
  await page.route('**/api/panels/vcs-activity', async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    envelope.data.recentCommits = [
      { repo: hostileRepo, sha: '', message: 'a merge (#1)', at: '2026-08-01T00:00:00Z' },
      { repo: 'naranjo.online', sha: '', message: unresolvedPR, at: '2026-08-01T00:00:00Z' },
      // Third entry (issue 157 follow-up): a valid repo, no resolvable
      // reference, AND a hostile SHA shaped to break out of an href if it were
      // ever raw-interpolated — the SHA fallback's own hostile probe.
      { repo: 'naranjo.online', sha: hostileSha, message: unresolvedPR, at: '2026-08-01T00:00:00Z' },
    ];
    await route.fulfill({ response, json: envelope });
  });
  await visit(page);

  /* THE ENTRY IS ONE LINK OR NONE (owner direction, 2026-10-16: an Ongoing
     Work entry is a two-line block whose title is its one link, and the
     repository is text on its supporting line). So each staged entry is read
     whole — found by what it says rather than by its position, since the log
     interleaves private days by date — and every one of them must be the
     PLAIN form, its strings literal and inert. */
  const rendered = await page.evaluate(
    ([repo, message]) => {
      const entries = [...window.document.querySelectorAll('#projects .log-entry')];
      const read = (entry) => ({
        plain: entry.querySelector('.log-plain') !== null,
        anchors: entry.querySelectorAll('a').length,
        source: entry.querySelector('.log-source')?.textContent ?? null,
        message: entry.querySelector('.log-message')?.textContent ?? null,
      });
      return {
        hostileRepo: entries.filter((entry) => entry.querySelector('.log-source')?.textContent === repo).map(read),
        unresolved: entries.filter((entry) => entry.querySelector('.log-message')?.textContent === message).map(read),
        anchors: entries.flatMap((entry) => [...entry.querySelectorAll('a')].map((a) => a.getAttribute('href'))),
        escaped: window.__activityEscaped === true,
        shaEscaped: window.__activityShaEscaped === true,
      };
    },
    [hostileRepo, unresolvedPR]
  );

  /* The hostile repository reached the DOM as literal text, in an entry that
     is no link at all, and the string it carries never executed. */
  expect(rendered.hostileRepo, 'the hostile-repo entry disappeared; this lane proves nothing').toHaveLength(1);
  expect(rendered.hostileRepo[0].plain, 'the hostile-repo entry became a link').toBe(true);
  expect(rendered.hostileRepo[0].anchors).toBe(0);
  expect(rendered.escaped, 'the hostile repo string executed').toBe(false);
  /* Both unresolved-reference entries are plain text: "(#12e3)" is no
     reference, the second has no identity at all, and the third's identity is
     not forty hex digits — so neither the reference nor the permalink
     fallback may build a link out of either. */
  expect(rendered.unresolved, 'an unresolved-reference entry disappeared').toHaveLength(2);
  for (const entry of rendered.unresolved) {
    expect(entry.plain, 'an unresolved-reference entry became a link').toBe(true);
    expect(entry.anchors).toBe(0);
    expect(entry.source).toBe('naranjo.online');
  }
  expect(rendered.shaEscaped, 'the hostile SHA string executed').toBe(false);
  /* And no anchor ANYWHERE in the log carries a hostile payload. */
  for (const href of rendered.anchors) {
    expect(href, `an anchor carries the hostile payload: ${href}`).not.toContain('evil.example');
    expect(href, `an anchor carries the hostile payload: ${href}`).not.toContain('onmouseover');
  }
});

test('an old-shape vcs-activity/v1 payload with no sha key on any row still renders real activity, not a blank panel (issue 157, Daybreak Blue round 3 finding 1)', async ({
  page,
}) => {
  /* The regression Daybreak Blue's review proved with a real intercepted
     payload: this chart runs a RollingUpdate across replicas, vcs-activity/v1
     is an unversioned-forever envelope, and this repository's own earlier
     releases serve rows with no `sha` key at all. Before the fix any such row
     failed admission and one bad row rejected the WHOLE payload — a blank
     panel for every visitor caught mid-rollout. The served response is
     mutated to strip `sha` from every row, the way an old replica would. */
  await page.route('**/api/panels/vcs-activity', async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    for (const commit of envelope.data.recentCommits) {
      delete commit.sha;
    }
    await route.fulfill({ response, json: envelope });
  });
  await visit(page);

  /* The calendar drew REAL DAYS: a measured day on the contributions' own
     layer is proof the payload was admitted. That layer is the roll's LAST
     seal since it opens on the first token source (owner, 2026-10-21, issue
     385), so it is pressed first — a measured day on the token layer the roll
     opens on would be the OTHER panel's, and would pass with this payload
     refused. The seal is told by the calendar's own green ink. */
  const contributions = page.locator('.chronicle-layers button').last();
  await expect(contributions, 'the old-shape payload was offered no contributions seal').toHaveAttribute('data-tone', 'grid');
  await contributions.click();
  await expect(contributions).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('.chronicle-cell[data-measured="true"]').first(),
    'the calendar drew no measured day from an old-shape payload'
  ).toBeAttached();

  const entries = page.locator('#projects .log-entry');
  expect(
    await entries.count(),
    'no commit entries rendered from an old-shape payload — this is the outage Daybreak Blue proved'
  ).toBeGreaterThan(0);
  /* The sha's absence degrades only an entry's own permalink, never the
     reference link a subject still resolves, never the entry, never the rest
     of the payload. */
  expect(
    await page.locator('#projects .log-link').count(),
    'every entry lost its link too, not just its sha capability'
  ).toBeGreaterThan(0);
});

/* Independent capability probe (issue 157 follow-up, correcting a finding in
 * Daybreak Blue's review of PR #161): whether this engine's default keyboard
 * configuration EVER moves focus onto a plain <a href> at all, measured
 * against the page's FIRST NAV LINK — reached by one real Tab from the page
 * header's own last control — which has nothing to do with the commit list
 * this file's commit-row test uses it to gate. That independence is the
 * whole point: the PREVIOUS version of that test derived its WebKit skip
 * from the very Tab press it used to check the repo link's own
 * reachability, so an `inert` attribute added to the commit list and a
 * genuine engine limitation looked identical — both landed the check on a
 * non-'A' element, and both took the skip branch. Measuring the capability
 * here, against a control the commit list cannot affect, means a mutation
 * that breaks JUST the commit list can never be masked as "this engine
 * skips links." Desktop Safari's own default keyboard configuration is
 * "Text boxes and lists only" and omits plain links from the tab order
 * entirely; WebKit's automation build mirrors that setting, which is the
 * true case this probe still legitimately reports.
 *
 * THE ANCHOR IT MEASURES FROM MOVED (owner directive, 2026-09-03, issue 287),
 * and getting this wrong is worse than a failing test — it is a SKIP, which
 * is a lane reporting nothing while looking green. The ledger's masthead puts
 * the section nav INSIDE the header, between the page mark and the reading-
 * mode control, so the reading-mode trigger is no longer the control that
 * precedes the first nav link: a Tab from it now lands on the first section's
 * own drawer button, which is not an anchor, and this probe reported "this
 * engine does not tab to links" on an engine that plainly does. It measures
 * from the page mark instead, which is the control immediately before the
 * first nav link in both the DOM and the tab order — the same relationship
 * the probe always had, against the same nav link, and still nothing the
 * commit list can reach.
 *
 * AND IT MOVED AGAIN, because the nav is gone (owner direction, 2026-10-16:
 * "do away with it for now"): no nav link, and no page mark before one. It
 * measures from the LAST role row in Professional Experience instead — the
 * control immediately before the Ongoing Work section's first repository link,
 * the same walk the issue-157 nav lane already proved. The landing is named by
 * STRUCTURE rather than by class (that section is being rebuilt, and its link
 * class with it): an anchor inside #projects and outside the commit column
 * (#commits), so nothing the commit list does can move it. An anchor anywhere
 * else fails loudly rather than reading as "this engine does not tab to
 * links", so a reshuffle cannot hide inside a skip. */
async function engineTabsToPlainLinks(page) {
  await page
    .locator('#work .ledger-entry')
    .last()
    .locator('.ledger-row')
    .evaluate((node) => node.focus());
  await page.keyboard.press('Tab');
  const landed = await page.evaluate(() => {
    const el = window.document.activeElement;
    return {
      tag: el.tagName,
      classes: typeof el.className === 'string' ? el.className : '',
      inProjects: el.closest('#projects') !== null,
      inCommits: el.closest('#commits') !== null,
    };
  });
  if (landed.tag !== 'A') return false;
  expect(
    landed.inProjects && !landed.inCommits,
    `the walk out of the last role row landed on an anchor carrying "${landed.classes}" rather than the repositories' first link; the tab order moved and this probe no longer knows where it is`
  ).toBe(true);
  return true;
}

/* The control a Tab leaves to reach the log's first link (owner direction,
 * 2026-10-16): the LAST figure of the last repository in the column beside it,
 * which is a focus stop of its own. Same shape as every version of this walk —
 * focus a known preceding control, then a real Tab — anchored on a control
 * that is not the link under test. */
async function focusBeforeLog(page) {
  await page
    .locator('#projects .repo-entry')
    .last()
    .locator('.repo-figure')
    .last()
    .evaluate((node) => node.focus());
}

test('a resolvable commit entry is real, keyboard-reachable navigation', async ({ page }) => {
  await page.route('**/api/panels/vcs-activity', async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    envelope.data.recentCommits = [
      {
        repo: 'naranjo.online',
        sha: '',
        message: 'release(0.1.34): six-lane integration bundle (#152)',
        at: '2026-08-24T00:00:00Z',
      },
    ];
    await route.fulfill({ response, json: envelope });
  });
  await visit(page);

  const entry = page.locator('#projects .log-entry').filter({ hasText: 'six-lane integration bundle' });
  await expect(entry, 'the staged entry is not in the log').toHaveCount(1);
  await entry.scrollIntoViewIfNeeded();
  const attrs = await entry.evaluate((node) => {
    const link = node.querySelector('a');
    return {
      anchors: node.querySelectorAll('a').length,
      tag: link?.tagName ?? null,
      href: link?.getAttribute('href') ?? null,
      target: link?.getAttribute('target') ?? null,
      rel: link?.getAttribute('rel') ?? null,
      label: link?.getAttribute('aria-label') ?? '',
      /* The repository rides the supporting line as TEXT inside the one link
         (owner direction, 2026-10-16), never as a second anchor. */
      source: node.querySelector('.log-source')?.textContent ?? null,
      sourceInLink: link?.contains(node.querySelector('.log-source')) ?? false,
    };
  });
  expect(attrs.anchors, 'the entry carries more than its one link').toBe(1);
  expect(attrs.source).toBe('naranjo.online');
  expect(attrs.sourceInLink, 'the repository is not part of the entry it names').toBe(true);
  /* /issues/152, never /pull/152, and "reference" rather than "pull request"
     in the accessible name: the subject's trailing "(#152)" proves only that
     this repository's squash-merge convention wrote a number there (issue 157,
     Daybreak Blue's review, finding 1). GitHub's own numbering redirects
     /issues/N to /pull/N when N is a pull request, so the destination is still
     exactly right. */
  expect(attrs.tag).toBe('A');
  expect(attrs.href).toBe('https://github.com/snaraj/naranjo.online/issues/152');
  expect(attrs.target).toBe('_blank');
  expect(attrs.rel).toBe('noopener noreferrer');
  expect(attrs.label).toContain('opens in a new tab');
  expect(attrs.label).toContain('reference');
  expect(attrs.label, 'the accessible name asserts a fact the payload never proved').not.toContain('pull request');

  const engineTabsLinks = await engineTabsToPlainLinks(page);
  await focusBeforeLog(page);
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const el = window.document.activeElement;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName,
      isEntryLink: el.classList.contains('log-link') && el.textContent.includes('six-lane integration bundle'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  test.skip(
    !engineTabsLinks,
    "this engine's default keyboard configuration does not include plain links in the tab order, measured independently against the repositories' own first link (matches desktop Safari's own default) — nothing left to measure here"
  );
  /* From here the engine is INDEPENDENTLY proven capable of tabbing to plain
     links, so failing to reach the entry's link is a real regression — the
     assertion an `inert` mutant on the log must fail. */
  expect(focus.tag, 'a real Tab from the last repository figure did not land on any anchor at all').toBe('A');
  expect(focus.isEntryLink, 'a real Tab from the last repository figure did not land on the entry link').toBe(true);
  expect(focus.outlineStyle, 'the entry link has no visible keyboard focus ring').not.toBe('none');
  expect(parseFloat(focus.outlineWidth), 'the entry link focus ring has zero width').toBeGreaterThan(0);

  /* ACTIVATION, not merely attributes (issue 157, finding 3), and popup
     isolation as BEHAVIOUR (round 3, finding 6): a real Enter on the focused
     link opens its href, intercepted and fulfilled locally so nothing reaches
     github.com, and the opened page has no opener and was sent no Referer. */
  let capturedReferer;
  await page.context().route('https://github.com/**', (route) => {
    capturedReferer = route.request().headers()['referer'];
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
  });
  const [popup] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('Enter')]);
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  expect(popup.url(), 'Enter on the focused entry link did not navigate to its own href').toBe(attrs.href);
  const openerIsNull = await popup.evaluate(() => window.opener === null);
  expect(openerIsNull, 'the opened page can reach back to this one via window.opener').toBe(true);
  expect(capturedReferer, 'the activating request leaked a Referer header').toBeUndefined();
  await popup.close();
});

test('a valid-SHA commit entry with no resolvable reference is real, keyboard-reachable navigation to its own commit permalink (issue 157, Daybreak Blue round 3 finding 5)', async ({
  page,
}) => {
  /* The positive case for the {:else if shaHref} branch actually WINNING: a
     commit with a real identity and no trailing reference number, which is
     what an ordinary non-squash commit looks like. An `inert` on only this
     anchor branch survived every other lane; this one is what fails it. */
  const validSha = '0123456789abcdef0123456789abcdef01234567';
  await page.route('**/api/panels/vcs-activity', async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    envelope.data.recentCommits = [
      {
        repo: 'naranjo.online',
        sha: validSha,
        message: 'a commit with no trailing reference number at all',
        at: '2026-08-24T00:00:00Z',
      },
    ];
    await route.fulfill({ response, json: envelope });
  });
  await visit(page);

  const entry = page.locator('#projects .log-entry').filter({ hasText: 'no trailing reference number' });
  await expect(entry, 'the staged entry is not in the log').toHaveCount(1);
  await entry.scrollIntoViewIfNeeded();
  const attrs = await entry.evaluate((node) => {
    const link = node.querySelector('a');
    return {
      tag: link?.tagName ?? null,
      href: link?.getAttribute('href') ?? null,
      target: link?.getAttribute('target') ?? null,
      rel: link?.getAttribute('rel') ?? null,
      label: link?.getAttribute('aria-label') ?? '',
      mark: node.querySelector('.log-mark')?.textContent ?? null,
    };
  });
  expect(attrs.tag, 'the sha-fallback branch did not render as a link at all').toBe('A');
  expect(attrs.href).toBe(`https://github.com/snaraj/naranjo.online/commit/${validSha}`);
  expect(attrs.target).toBe('_blank');
  expect(attrs.rel).toBe('noopener noreferrer');
  expect(attrs.label).toContain('opens in a new tab');
  expect(attrs.label).toContain(`commit ${validSha.slice(0, 7)}`);
  /* The short identity the supporting line prints is the validated one. */
  expect(attrs.mark).toBe(validSha.slice(0, 7));

  const engineTabsLinks = await engineTabsToPlainLinks(page);
  /* ONE Tab now: the entry is one link, and the repository that used to be a
     second stop before it is text inside it (owner direction, 2026-10-16). */
  await focusBeforeLog(page);
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const el = window.document.activeElement;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName,
      isEntryLink: el.classList.contains('log-link') && el.textContent.includes('no trailing reference number'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  test.skip(
    !engineTabsLinks,
    "this engine's default keyboard configuration does not include plain links in the tab order, measured independently against the repositories' own first link — nothing left to measure here"
  );
  expect(focus.tag, 'a real Tab did not land on any anchor at all').toBe('A');
  expect(focus.isEntryLink, 'a real Tab did not land on the sha-fallback link').toBe(true);
  expect(focus.outlineStyle, 'the sha-fallback link has no visible keyboard focus ring').not.toBe('none');
  expect(parseFloat(focus.outlineWidth), 'the sha-fallback link focus ring has zero width').toBeGreaterThan(0);

  let capturedReferer;
  await page.context().route('https://github.com/**', (route) => {
    capturedReferer = route.request().headers()['referer'];
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
  });
  const [popup] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('Enter')]);
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  expect(popup.url(), 'Enter on the focused sha-fallback link did not navigate to its own href').toBe(attrs.href);
  const openerIsNull = await popup.evaluate(() => window.opener === null);
  expect(openerIsNull, 'the opened page can reach back to this one via window.opener').toBe(true);
  expect(capturedReferer, 'the activating request leaked a Referer header').toBeUndefined();
  await popup.close();
});

test('a valid SHA outranks an unverifiable trailing reference on the SAME entry (issue 157, Daybreak Blue round 3 finding 3)', async ({
  page,
}) => {
  /* Daybreak Blue's own product probe: an entry carrying BOTH a proven commit
     identity AND a syntactically-valid but nothing-proves-it-real trailing
     reference. Before the fix the reference won and this entry linked to
     /issues/9999999, outlinking a commit this document could vouch for. */
  const validSha = '0123456789abcdef0123456789abcdef01234567';
  await page.route('**/api/panels/vcs-activity', async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    envelope.data.recentCommits = [
      {
        repo: 'naranjo.online',
        sha: validSha,
        message: 'handwritten reference to nowhere (#9999999)',
        at: '2026-08-24T00:00:00Z',
      },
    ];
    await route.fulfill({ response, json: envelope });
  });
  await visit(page);
  const link = page.locator('#projects .log-entry').filter({ hasText: 'handwritten reference to nowhere' }).locator('a');
  await expect(link, 'the staged entry is not one link').toHaveCount(1);
  const href = await link.getAttribute('href');
  expect(
    href,
    'the entry linked to the unverifiable /issues/9999999 reference instead of its own proven commit'
  ).toBe(`https://github.com/snaraj/naranjo.online/commit/${validSha}`);
  expect(href).not.toContain('/issues/9999999');
});

/* The commit log's rhythm (owner directive, 2026-08-25: "awkward large
 * vertical gaps between rows, almost like there should be something there";
 * re-aimed 2026-10-16 at Ongoing Work's two-line entries, owner direction:
 * "show 1 less entry per but give more information and make it more
 * readable").
 *
 * Each entry is a subject line and a supporting line between two paddings — a
 * PITCH the section decides before any payload lands — and the pitch is closed
 * by a rule, which is what turns the space into a list instead of dead air.
 * Measured here, with the property that made the rule safe: entries stay
 * flush, every one is at least a finger's height, the rule is painted as a
 * BACKGROUND that grows no entry's box (an inset shadow until 2026-10-19, a
 * twig since: "the plain lines should be tree branches, or vines"), no entry
 * draws a border, the last entry draws no rule, and the box still reserves
 * exactly the entries the column beside it shows — five repository entries
 * tall on a wide sheet, and on a phone the collapsed five plus the control
 * that reveals the rest. */
test('the commit log reads as ruled two-line entries at the touch pitch, not text in dead air (owner 2026-08-25; 2026-10-16)', async ({
  page,
}) => {
  await visit(page);
  const observed = await page.evaluate(() => {
    const box = window.document.querySelector('#projects .log-box');
    const entries = [...box.querySelectorAll('.log-entry')];
    const repos = [...window.document.querySelectorAll('#projects .repo-entry')];
    const more = box.querySelector('.log-more');
    return {
      box: box.getBoundingClientRect().height,
      overflowY: getComputedStyle(box).overflowY,
      repos: repos.map((repo) => repo.getBoundingClientRect().height),
      control: more === null ? null : more.getBoundingClientRect().height,
      controlGap: more === null ? null : Number.parseFloat(getComputedStyle(more).marginBlockStart),
      subjectPx: entries.length === 0 ? 0 : Number.parseFloat(getComputedStyle(entries[0].querySelector('.log-message')).fontSize),
      entries: entries.map((entry) => {
        const rect = entry.getBoundingClientRect();
        const style = getComputedStyle(entry);
        return { top: rect.top, height: rect.height, rule: style.backgroundImage, border: style.borderBlockEndWidth };
      }),
    };
  });
  expect(observed.entries.length, 'the commit log rendered no entries to measure').toBeGreaterThan(1);
  /* The type step: small text in a tall entry is what read as dead air. */
  expect(observed.subjectPx, `the commit subjects are set at ${observed.subjectPx}px`).toBeGreaterThanOrEqual(13);
  for (const [index, entry] of observed.entries.entries()) {
    expect(entry.height, `commit entry ${index} is ${entry.height}px tall`).toBeGreaterThanOrEqual(touchFloorPx - subPixel);
    if (index > 0) {
      const previous = observed.entries[index - 1];
      expect(
        entry.top,
        `commit entry ${index} starts ${entry.top - (previous.top + previous.height)}px after the entry above it`
      ).toBeCloseTo(previous.top + previous.height, 0);
    }
    expect(parseFloat(entry.border), `commit entry ${index} draws its rule as a border, which grows its box`).toBe(0);
    if (index === observed.entries.length - 1) {
      expect(entry.rule, 'the final entry draws a rule, so the list reads as missing its next entry').toBe('none');
    } else {
      expect(entry.rule, `commit entry ${index} draws no rule, so the pitch reads as dead air`).not.toBe('none');
    }
  }
  /* AND THE BOX IS THE RESERVE, paired with the column beside it: the number
     is read off the repositories the page drew, never typed here. */
  expect(observed.repos.length, 'the repositories column drew no entries to pair the reserve against').toBeGreaterThan(0);
  if (observed.control !== null) {
    /* A phone: the collapsed five, the control at the touch floor and the gap
       above it, and every entry exactly the tall pitch so the sum is exact. */
    const pitch = observed.entries[0].height;
    for (const entry of observed.entries) {
      expect(entry.height, 'a phone entry is not the one pitch the reserve is computed from').toBeCloseTo(pitch, 0);
    }
    expect(observed.control, 'the log control is under the touch floor').toBeGreaterThanOrEqual(touchFloorPx - subPixel);
    expect(
      observed.box,
      'the collapsed phone log is not exactly five entries, the control and its gap'
    ).toBeCloseTo(5 * pitch + observed.control + observed.controlGap, 0);
  } else {
    const pitch = observed.repos[0];
    for (const repo of observed.repos) {
      expect(repo, 'the repository entries are not one pitch').toBeCloseTo(pitch, 0);
    }
    expect(observed.overflowY, 'the log box does not scroll for the entries past its reserve').toBe('auto');
    expect(
      observed.box,
      `the log reserves ${observed.box}px, not the ${observed.repos.length} repository entries beside it`
    ).toBeCloseTo(observed.repos.length * pitch, 0);
  }
});

/* RETIRED 2026-10-16: "the shortest admitted repo slug still clears the touch
 * floor on both axes" (issue 157). Its subject was the commit row's own
 * repository LINK, which a one-character slug shrank to a 6.6px anchor. The
 * repository is text on an entry's supporting line now (owner direction,
 * 2026-10-16: the entry is one link, and the repository stays one press away
 * on the commit's own page and in the column beside it), so there is no
 * repository link in the log to shrink. The entry link that replaced it is
 * held to the floor on both axes by "every control clears the touch floor on
 * both axes" and by the ruled-entries lane above. */

/* ===========================================================================
 * The stacked page (issue 134)
 *
 * The section addresses and the gallery are two surfaces whose correctness is
 * a property of the RENDERED page rather than of the source: an address that
 * names a section nobody rendered still looks perfect in the markup, and a
 * single visible photograph plus a click-to-enlarge dialog (issue 176) are
 * exactly the kind of interactive behavior no source pin can prove.
 * ======================================================================== */

/* EVERY SECTION IS STILL AN ADDRESS. This lane was "every section the nav
 * names is on the page, and its link reaches it"; the nav is gone with the
 * chrome row (owner direction, 2026-10-16: "do away with it for now"), and its
 * link half went with it. Its other half has a subject still: each section's
 * id is an address a reader may already have shared, and the commit column
 * keeps the retired #commits (issue 318), so each is visited directly and
 * must land on its own box. */
test('every section the page draws is an address that lands on it, and #commits still does (owner 2026-10-16)', async ({
  page,
}) => {
  await visit(page);
  const ids = await page.evaluate(() =>
    [...window.document.querySelectorAll('.page-section')].map((node) => node.id)
  );
  expect(ids, 'the page no longer draws the owner’s four sections at their addresses').toEqual([
    'work',
    'projects',
    'trackers',
    'gallery',
  ]);
  for (const id of [...ids, 'commits']) {
    await page.goto(`/#${id}`);
    await settled(page);
    await expect(page.locator(`#${id}`), `#${id} names nothing on this page`).toHaveCount(1);
    const landed = await page.locator(`#${id}`).evaluate((node) => ({
      top: node.getBoundingClientRect().top,
      viewport: window.innerHeight,
    }));
    /* And the jump lands: the section is in view rather than somewhere far
       below the fold. The last section cannot always reach the very top of
       the window — there is nothing under it to scroll — so the assertion is
       that it is visible, not that it is flush. */
    expect(landed.top, `#${id} did not bring its section into view (${Math.round(landed.top)}px from the top)`).toBeLessThan(
      landed.viewport
    );
    expect(landed.top, `#${id} scrolled its section past the top`).toBeGreaterThanOrEqual(-1);
  }
});

/* RETIRED WITH THE NAV (owner direction, 2026-10-16): "the nav link is quiet
 * at rest and marks itself the moment intent shows (issue 157)". Its subject
 * was the nav link — its idle and hover decoration, its focus ring, and Enter
 * reaching its section — and no nav link is left to press. The site-wide link
 * doctrine it applied is still measured on every rendered link by "every
 * rendered link is unmarked at rest and marks itself on hover", and its
 * engine-capability probe lives on in engineTabsToPlainLinks above. */

/* The section that used to be "Work" (owner directive, 2026-08-25): the real
 * history replaced two lorem-ipsum records, so what this measures is that the
 * page renders four complete roles under the new heading AND that neither the
 * filler nor the disclaimer it needed survived anywhere in the rendered
 * document. The heading moves with the section because both are read off the
 * one manifest entry, which is what this reads back off the page. (It read the
 * nav link's word too, until the nav left with the chrome row — owner
 * direction, 2026-10-16; the heading is the one place the word is printed
 * now, and the engine is asked for it by role below.) */
test('the experience section renders four complete roles, and no placeholder survives', async ({
  page,
}) => {
  await visit(page);
  /* THE ROLE MARKS ARE PICTURES NOW (owner ruling, 2026-09-12, issue 326), so
     "is the tile there" stopped being "is there a box": an <img> pointed at
     bytes the build never emitted paints an empty frame of exactly the right
     size, and every geometry assertion in this file would be satisfied by it.
     Waiting for the decode is what makes the rest of the measurement mean
     something, and it is the one question a source pin cannot answer. */
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            [...window.document.querySelectorAll('#work .ledger-mark')].filter(
              (tile) => tile.complete && tile.naturalWidth > 0
            ).length
        ),
      {
        message:
          'the role marks never decoded; a row is pointing at bytes this build did not emit',
      }
    )
    .toBe(4);
  const observed = await page.evaluate(() => {
    const section = window.document.querySelector('#work');
    return {
      heading: section.querySelector('.section-title')?.textContent.trim(),
      /* The id is the address a reader may already have shared; renaming a
         label must not move it. */
      id: section.id,
      placeholders: section.querySelectorAll('[data-placeholder]').length,
      notes: section.querySelectorAll('.section-note').length,
      text: section.textContent.toLowerCase(),
      /* THE ROLES ARE COLLAPSIBLE LEDGER ROWS NOW (owner directive,
         2026-09-03, issue 287): each is a summary line that expands on
         request, so the employer, the span, the role and the place are four
         cells of one row rather than a card title and a composed byline. Each
         is read separately, which is STRICTER than the retired byline regex —
         that pattern was satisfied by any string with two separators in it,
         and these fail by name when one field goes missing. */
      entries: [...section.querySelectorAll('.ledger-entry')].map((entry) => ({
        title: entry.querySelector('.ledger-name')?.textContent.trim() ?? '',
        span: entry.querySelector('.ledger-span')?.textContent.trim() ?? '',
        role: entry.querySelector('.ledger-role')?.textContent.trim() ?? '',
        place: entry.querySelector('.ledger-place')?.textContent.trim() ?? '',
        points: entry.querySelectorAll('.ledger-points > li').length,
        /* Closed on arrival, which is the owner's own instruction for this
           section: it opens as a summary and expands on request. */
        open: entry.querySelector('.ledger-drawer')?.getAttribute('data-open') ?? '',
        expandLabel: entry.querySelector('.ledger-row')?.getAttribute('aria-label') ?? '',
        /* THE ORGANISATION'S OWN MARK, replacing the monogram (owner ruling,
           2026-09-12, issue 326). Read from the DOM rather than through a role
           query, as everything else in this snapshot is: the drawer is closed
           and a closed drawer's contents are correctly absent from the
           accessibility tree. */
        markTag: entry.querySelector('.ledger-mark')?.tagName ?? '',
        markAlt: entry.querySelector('.ledger-mark')?.getAttribute('alt') ?? null,
        /* The employer link's own text, which is the HOST it goes to since the
           same ruling — where, not who — and the name it declares, which still
           says whose site it is. */
        linkText: entry.querySelector('.ledger-link')?.textContent.trim() ?? '',
        linkLabel: entry.querySelector('.ledger-link')?.getAttribute('aria-label') ?? '',
        anchors: entry.querySelectorAll('a').length,
        /* And the count the ruling is actually about: how many times the row's
           own visible text says the organisation's name. The split is
           case-sensitive on purpose — a host is lower case and is nobody's
           second mention of the name as written. */
        rowText: entry.textContent,
      })),
    };
  });
  expect(observed.heading).toBe('Professional Experience');
  /* And the engine agrees, which is the assertion that matters: an accessible
     name is computed, not declared, so only a real accessibility tree can say
     the printed word actually became the heading's name — the mark and the
     number beside it are aria-hidden, and a stray label or a hidden word
     would each change the answer. With no nav, the heading is how a screen
     reader finds this section, so it is asked for by role. */
  await expect(
    page.getByRole('heading', { level: 2, name: 'Professional Experience', exact: true }),
    'no heading answers to the section word any more'
  ).toHaveCount(1);
  expect(observed.id, 'the section id moved with the label').toBe('work');
  expect(observed.entries, 'the section renders the wrong number of roles').toHaveLength(4);
  for (const entry of observed.entries) {
    expect(entry.title, 'a role row renders no employer').not.toBe('');
    /* The three facts the owner supplied beside the employer, each in its own
       cell. The composition is executed in tests/sections.test.mjs; this is
       the half that proves each one reached the page. */
    expect(entry.span, `"${entry.title}" renders no span`).not.toBe('');
    expect(entry.role, `"${entry.title}" renders no role`).not.toBe('');
    expect(entry.place, `"${entry.title}" renders no place`).not.toBe('');
    expect(entry.points, `"${entry.title}" renders no accomplishments`).toBeGreaterThan(0);
    /* The organisation's own mark, named for the organisation it shows (issue
       326: the tiles land "named") with the same short name the heading
       prints. It is not a second announcement: the tile sits inside the row's
       control, whose aria-label replaces its content in the accessible-name
       computation — the accessibility lane above reads one name per row. */
    expect(entry.markTag, `"${entry.title}" draws no mark tile`).toBe('IMG');
    expect(entry.markAlt, `"${entry.title}" gives its mark a name other than its own`).toBe(entry.title);
    /* And the employer is named ONCE (owner ruling, 2026-09-12, issue 326).
       The row keeps its one outbound link — the ruling was about the NAME —
       and that link prints the host it goes to, so the only visible mention of
       the organisation is the heading. */
    expect(entry.anchors, `"${entry.title}" renders ${entry.anchors} anchors; the drawer holds exactly one`).toBe(1);
    expect(
      entry.rowText.split(entry.title).length - 1,
      `"${entry.title}" is printed ${entry.rowText.split(entry.title).length - 1} times in its own row`
    ).toBe(1);
    expect(entry.linkText, `"${entry.title}" carries no employer link to name`).not.toBe('');
    expect(
      entry.linkText,
      `"${entry.title}" links through "${entry.linkText}", which is not a bare host`
    ).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    expect(entry.linkText, 'the drawer prints a host with the www label still on it').not.toMatch(/^www\./);
    /* Closed on arrival, and the control says what pressing it will do. */
    expect(entry.open, `"${entry.title}" opens its drawer before anyone asked`).toBe('false');
    expect(
      entry.expandLabel,
      `"${entry.title}" has a drawer control that does not name what it opens`
    ).toContain(entry.title);
  }
  expect(observed.placeholders, 'a real role is still marked placeholder in the DOM').toBe(0);
  expect(observed.notes, 'the placeholder disclaimer is still printed over real roles').toBe(0);
  expect(observed.text, 'the filler copy is still on the page').not.toContain('lorem');

  /* EACH SURFACE NAMES ITSELF (issue 243; review finding, 2026-08-28; re-aimed
     2026-09-03 for issue 287). The finding then was that turning the employer
     into a link put an `aria-label` inside the HEADING, and a heading's
     accessible name is computed from its descendants — with an `aria-label`
     REPLACING the labelled node's contribution — so the heading list a
     screen-reader user navigates by became a list of tab warnings.

     The ledger has no per-role heading to borrow a name from: the section
     carries one heading and each role is a disclosure BUTTON over a drawer. So
     the same principle is measured on the two surfaces that do exist. The
     button must answer to what pressing it does, naming its own employer —
     EXACTLY, which is also what proves the tile beside it contributes nothing
     to that name: a mark that grew an alt would append its words here and the
     count would fall to zero. And the drawer's link must still tell a reader
     whose site it is and that a new tab is coming, which its accessible name
     carries while its visible text prints only the host (owner ruling,
     2026-09-12, issue 326). Measured through `getByRole` rather than read off
     the source, because an accessible name is something the ENGINE computes
     and only an engine can settle. */
  for (const entry of observed.entries) {
    const control = page.getByRole('button', { name: `Expand ${entry.title}`, exact: true });
    await expect(
      control,
      `the "${entry.title}" row control does not answer to its own employer name`
    ).toHaveCount(1);
    /* THE DRAWER IS OPENED, and what it discloses is the assertion: the
       points, and nothing that names the employer again. A closed drawer's
       contents are correctly out of the accessibility tree, so an open one is
       the only place this can be settled — and a control whose press changed
       nothing fails on the count below rather than on the press. */
    await control.click();
    await expect(
      page.getByRole('button', { name: `Collapse ${entry.title}`, exact: true }),
      `pressing the "${entry.title}" row did not open it`
    ).toHaveCount(1);
    const opened = page.locator('#work .ledger-entry').filter({ hasText: entry.title });
    await expect(
      opened.locator('.ledger-points > li'),
      `the "${entry.title}" drawer opened onto nothing`
    ).toHaveCount(entry.points);
    /* The link is disclosed, it prints where it goes, and its NAME still tells
       a reader whose site it is and that a new tab is coming — the
       accessibility tree was never the visible repetition the owner counted.
       The name's composition is executed against the entries in
       tests/sections.test.mjs; what only an engine can settle is that the
       declared name is the one the accessibility tree actually computed. */
    expect(
      entry.linkLabel,
      `the "${entry.title}" link declares "${entry.linkLabel}", which does not name a site or a new tab`
    ).toMatch(/^.+ website, opens in a new tab$/);
    expect(
      entry.linkLabel.replace(/ website, opens in a new tab$/, ''),
      'the link is named after the host it prints rather than after its employer'
    ).not.toBe(entry.linkText);
    await expect(
      opened.getByRole('link', { name: entry.linkLabel, exact: true }),
      `the "${entry.title}" employer link no longer answers to the name it declares`
    ).toHaveCount(1);
    /* Left as it was found, so the next role is measured from the same closed
       start this section ships in. */
    await page.getByRole('button', { name: `Collapse ${entry.title}`, exact: true }).click();
  }
  /* And the section still carries exactly ONE heading — the thing the retired
     per-card headings turned into a list of tab warnings cannot come back as a
     list of anything. */
  await expect(
    page.locator('#work').getByRole('heading'),
    'the experience section grew a second heading level back'
  ).toHaveCount(1);
});

/* The trackers stack, in the order the owner asked for on 2026-08-25: the
 * token tracker opens the section and the game tracker closes it. Read off the
 * rendered stack rather than off the manifest — tests/sections.test.mjs pins
 * the manifest, and this is the half that proves the page renders it in that
 * order.
 *
 * ONE DIAGRAM, THEN THE TICKER (owner direction, 2026-10-16): the token board
 * and the contribution calendar that sat between it and the ticker are one
 * diagram now, so the stack is two blocks — and the claim keeps its shape: the
 * tokens still open the section, the game log still closes it, and the
 * version-control calendar is still IN the section rather than left behind in
 * one of its own, which is now a statement about where the diagram's calendar
 * is. Every block is identified by a structure only it draws. */
test('the trackers stack renders the diagram first and the game tracker last', async ({ page }) => {
  await visit(page);
  const order = await page.evaluate(() =>
    [...window.document.querySelectorAll('#trackers .panel-stack > *')].map((slot) => {
      const carries = (selector) => slot.matches(selector) || slot.querySelector(selector) !== null;
      if (carries('.chronicle')) return 'diagram';
      if (carries('.ticker-strip')) return 'boss-log';
      return 'unknown';
    })
  );
  expect(order, 'the trackers no longer stack in the order the owner asked for').toEqual(['diagram', 'boss-log']);
  const placed = await page.evaluate(() => ({
    sections: [...window.document.querySelectorAll('.page-section')].map((node) => node.id),
    diagrams: window.document.querySelectorAll('.chronicle').length,
    calendars: window.document.querySelectorAll('.chronicle-calendar').length,
    section: window.document.querySelector('.chronicle-calendar')?.closest('.page-section')?.id ?? null,
    /* The token series and the contributions are both on it: a layer for
       the contributions and one per token source, and the graph drawing the
       one that is picked (owner direction, 2026-10-16: one line at a time,
       no legend). */
    lines: window.document.querySelectorAll('.chronicle-plot').length,
    layers: [...window.document.querySelectorAll('.chronicle-layers button')].length,
  }));
  expect(placed.diagrams, 'the trackers diagram is not on the page exactly once').toBe(1);
  expect(placed.calendars, 'the calendar is not on the page exactly once').toBe(1);
  expect(placed.section, 'the calendar did not land in the trackers stack').toBe('trackers');
  expect(placed.lines, 'the diagram does not draw exactly one line').toBe(1);
  expect(placed.layers, 'the diagram offers no contributions layer beside the tokens').toBeGreaterThan(1);
  expect(placed.sections, 'the sheet no longer renders the owner’s four sections in order').toEqual([
    'work',
    'projects',
    'trackers',
    'gallery',
  ]);
});

/* No link on this page wears a resting underline (owner directive,
 * 2026-08-25: the three repo card titles "render underlined"), and every one
 * of them still marks itself the moment intent shows.
 *
 * The source pin in tests/experience.test.mjs proves the DECLARATIONS; this
 * is what the engine computed from them, over every link the page actually
 * rendered rather than the one class that was reported. Both directions,
 * because a page that removed the mark and never brought it back would be
 * identifying links by color alone. */
test('every rendered link is unmarked at rest and marks itself on hover', async ({ page, isMobile }) => {
  await visit(page);
  const links = page.locator('a[class]:visible');
  const count = await links.count();
  expect(count, 'the page rendered no classed links; this lane proves nothing').toBeGreaterThan(3);
  /* The anchor AND the text it holds, because the two-line entries carry their
     words in spans of their own (owner direction, 2026-10-16) and a resting
     underline declared on a span is as visible as one on the anchor. */
  const idle = await links.evaluateAll((nodes) =>
    nodes.flatMap((node) =>
      [node, ...node.querySelectorAll('span')].map((part) => ({
        classes: part.getAttribute('class') ?? '',
        line: getComputedStyle(part).textDecorationLine,
      }))
    )
  );
  for (const link of idle) {
    expect(link.line, `"${link.classes}" carries a resting underline`).toBe('none');
  }
  test.skip(Boolean(isMobile), 'a touch device has no hover state to measure');
  /* The repository's name is the exact element the owner reported, so it is
     the one this hovers. The anchor is the whole two-line entry now (owner
     direction, 2026-10-16), and the mark lands on the NAME inside it — the
     words a reader is pointing at — rather than on the description under it. */
  const entry = page.locator('#projects .repo-link').first();
  await entry.scrollIntoViewIfNeeded();
  /* The pointer goes where a reader's does, onto the name. The entry's
     figures sit over the link's far end on purpose — they carry their own
     detail — so the link's centre lands on them whenever the row is narrower
     than twice their width, and hovering there never reaches the link. */
  await entry.locator('.repo-name').hover();
  const hovered = await entry.locator('.repo-name').evaluate((node) => getComputedStyle(node).textDecorationLine);
  expect(hovered, 'hover leaves the repository name unmarked, so nothing announces it as a link').toBe('underline');
});

/* ===========================================================================
 * THE GALLERY IS A TILE GRID AND A STAGE (owner directive, 2026-09-03,
 * issue 287)
 *
 * Every lane below used to drive one visible frame with a swipe strip under
 * it. The frame is gone: the sheet's last section draws the first five squares
 * of the chosen set across the column (owner, 2026-10-17: no control tile
 * beside them), and the stage is a native <dialog> a tile opens. What the rulings of issues 176, 202, 219, 233, 241,
 * 243, 265 and 275 were FOR survives that move and is re-aimed here — one
 * full-size picture at a time, the full derivative fetched only on demand,
 * nothing autoplaying, a film opened by its tile like a picture (issue 384),
 * every box reserved before a byte arrives, prev/next as real 44px targets with the swipe as an
 * addition to them, Escape and the backdrop and the close mark all closing,
 * focus handed back to the tile that opened the stage. What was about the
 * STRIP itself is deleted rather than re-pointed, each with the reason on the
 * line where the lane used to be, because a lane re-aimed at a surface that
 * cannot have the defect is a lane that reports green for nothing.
 * ======================================================================== */

test('the gallery mounts one thumbnail per tile and exactly one enlarged photograph, never eight stacked (issue 176; owner 2026-09-03, issue 287)', async ({
  page,
}) => {
  await visit(page);
  // Vendored WebP, not a media-route fetch: the pictures actually decode,
  // which the old remote-media "pending frame" case could never measure. They
  // are also `loading="lazy"` (issue 176), and engines differ on how far ahead
  // of the viewport a lazy image is fetched — Firefox measurably later than
  // Chromium/WebKit here — so this polls for decode rather than asserting it
  // the instant the page settles.
  const grid = page.locator('.gallery-grid');
  await grid.scrollIntoViewIfNeeded();
  const thumbs = page.locator('img.gallery-thumb');
  await expect
    .poll(
      async () =>
        thumbs.evaluateAll((nodes) => {
          const drawn = nodes.filter((img) => img.getClientRects().length > 0);
          return drawn.length > 0 && drawn.every((img) => img.complete && img.naturalWidth > 0);
        }),
      { message: 'the vendored previews never finished decoding', timeout: 10_000 }
    )
    .toBe(true);

  const observed = await page.evaluate(() => {
    const gridNode = window.document.querySelector('.gallery-grid');
    const all = [...window.document.querySelectorAll('.gallery-tile')];
    const tiles = all.filter((tile) => tile.getClientRects().length > 0);
    const images = tiles.flatMap((tile) => [...tile.querySelectorAll('img.gallery-thumb')]);
    return {
      declared: gridNode.getAttribute('data-gallery-tiles'),
      mounted: all.length,
      tiles: tiles.length,
      images: images.length,
      /* One picture per tile, and every one of them the PREVIEW derivative:
         the point of the row is that eight masters are not stacked into it. */
      perTile: tiles.map((tile) => tile.querySelectorAll('img.gallery-thumb').length),
      lazy: images.map((image) => image.getAttribute('loading')),
      fit: images.map((image) => getComputedStyle(image).objectFit),
      previews: images.every((image) => /-preview-/.test(image.currentSrc)),
      masters: images.filter((image) => /-full-/.test(image.currentSrc)).length,
      /* Nothing enlarged exists until a tile is opened, which is the other
         half of "one loaded photograph": the closed page mounts no stage at
         all, so there is no second copy of anything to load. */
      enlarged: window.document.querySelectorAll('.gallery-lightbox-image').length,
      /* No box of information beside the row and no instructions in it
         (owner, 2026-10-17): the row is pictures and nothing else. */
      boxes: window.document.querySelectorAll('.gallery-control, .gallery-set-name').length,
      words: window.document.querySelector('.gallery-grid').textContent.trim(),
    };
  });
  /* A phone shows four of the five (two full rows), a wider screen all five. */
  const drawn = (page.viewportSize()?.width ?? 1280) <= 720 ? 4 : 5;

  expect(observed.mounted, 'the gallery mounted a number of tiles other than the five it declares').toBe(5);
  expect(observed.declared, 'the grid stopped declaring how many tiles it drew').toBe('5');
  expect(observed.tiles, `the row draws ${observed.tiles} tiles at this width, not ${drawn}`).toBe(drawn);
  expect(observed.boxes, 'a box of information is back beside the row').toBe(0);
  expect(observed.words, 'the row explains itself in words again').toBe('');
  expect(observed.images, 'the row draws a number of pictures other than one per tile').toBe(drawn);
  expect(observed.perTile, 'a tile mounts something other than exactly one picture').toEqual(Array(drawn).fill(1));
  expect(observed.lazy, 'a thumbnail stopped being lazy, so the row costs a reader who never reaches it').toEqual(
    Array(drawn).fill('lazy')
  );
  expect(observed.fit, 'a thumbnail is letterboxed inside its square instead of filling it').toEqual(
    Array(drawn).fill('cover')
  );
  expect(observed.previews, 'a tile is showing something other than the preview derivative').toBe(true);
  expect(observed.masters, 'a full-size master is mounted in the tile row').toBe(0);
  expect(observed.enlarged, 'an enlarged picture is mounted before anybody opened one').toBe(0);
  // ...and opening one mounts exactly ONE enlarged picture, not eight.
  await page.locator('.gallery-tile[data-gallery-kind="image"]').first().click();
  await expect(page.locator('dialog.gallery-lightbox')).toBeVisible();
  await expect(page.locator('.gallery-lightbox-image')).toHaveCount(1);
  await expect(page.locator('.gallery-count')).toHaveText('Photograph 1 of 8');
});

/* THE FULL DERIVATIVE IS FETCHED ON DEMAND AND NOT BEFORE (issue 176, issue
 * 241; owner directive, 2026-09-03, issue 287).
 *
 * The old frame proved this by mounting one <img> at a time. A grid mounts
 * four, so the claim has to be made where it is now decided — in the network,
 * against the requests an engine actually issued. The vendored set names the
 * two derivatives apart (`-preview-` against `-full-`), so this needs no
 * fixture and no route interception to read: a request either happened before
 * the press or it did not. */
test('a tile costs a reader its preview and the master arrives only when one is opened (issue 176; owner 2026-09-03, issue 287)', async ({
  page,
}) => {
  const requested = [];
  page.on('request', (request) => {
    const name = request.url().split('/').pop();
    if (/^gallery-\d+-(full|preview)-/.test(name ?? '')) {
      requested.push(name);
    }
  });
  await visit(page);
  const tile = page.locator('.gallery-tile[data-gallery-kind="image"]').first();
  await tile.scrollIntoViewIfNeeded();
  await expect
    .poll(() => requested.filter((name) => name.includes('-preview-')).length, {
      message: 'no preview was ever requested, so this lane measured no loading at all',
      timeout: 10_000,
    })
    .toBeGreaterThan(0);

  const before = requested.filter((name) => name.includes('-full-'));
  expect(
    before,
    `the row pulled ${before.length} full-size master(s) nobody asked to see: ${before.join(', ')}`
  ).toEqual([]);

  await tile.click();
  await expect(page.locator('dialog.gallery-lightbox')).toBeVisible();
  /* And the press pulls exactly one — the picture that was opened, not the
     set. A neighbour-warming scheme would show up here as two or three. */
  await expect
    .poll(() => requested.filter((name) => name.includes('-full-')).length, {
      message: 'opening a tile requested no master at all, so the stage is showing the thumbnail',
      timeout: 15_000,
    })
    .toBe(1);
  expect(
    requested.filter((name) => name.includes('-full-'))[0],
    'the stage pulled a master other than the tile that was opened'
  ).toMatch(/^gallery-01-full-/);
});

test('prev/next cycle the enlarged photograph without leaving the page (issue 176; owner 2026-09-03, issue 287)', async ({
  page,
}) => {
  await visit(page);
  const url = page.url();
  const dialog = page.locator('dialog.gallery-lightbox');
  await page.locator('.gallery-tile[data-gallery-kind="image"]').first().click();
  await expect(dialog).toBeVisible();
  const enlarged = page.locator('img.gallery-lightbox-image');
  const before = await enlarged.getAttribute('src');

  await page.getByRole('button', { name: 'Next photograph' }).click();
  await expect(page.locator('.gallery-count')).toHaveText('Photograph 2 of 8');
  const after = await enlarged.getAttribute('src');
  expect(after, 'next must actually change which photograph is enlarged').not.toBe(before);
  await page.getByRole('button', { name: 'Previous photograph' }).click();
  await expect(page.locator('.gallery-count')).toHaveText('Photograph 1 of 8');
  expect(await enlarged.getAttribute('src')).toBe(before);
  /* WITHOUT LEAVING THE PAGE, which is the half the title is about: the stage
     is still open and the document is still the one the reader arrived on. */
  await expect(dialog).toHaveJSProperty('open', true);
  expect(page.url(), 'paging the stage navigated the page').toBe(url);
});

/* THE STAGE PAIR, ON EVERY DEVICE (owner sketch 2026-08-31, issue 275; the
 * desktop half was owner 2026-08-29: "on the web browser, I lost the ability
 * to move through the images/videos, only on full screen I can do it").
 *
 * RE-AIMED at the stage the pair now lives on (owner directive, 2026-09-03,
 * issue 287), with every claim that was about the READER: two real 44px
 * targets, visible on every device rather than gated behind a fine pointer,
 * sitting ON the picture's own edges instead of adrift in a track, and a set
 * that WRAPS in both directions so neither end is a dead stop.
 *
 * The "pages every KIND" half is BACK (issue 384): a film is opened on the
 * stage like a still, so the stage pages the whole set, and the mixed fixture
 * — one still and one film in one set — is walked through the pair from the
 * still onto the film and round again, with the pair on the FILM's own edges
 * as well as the picture's.
 *
 * The absent branch rides the same lane, because "when there is more than one
 * item" is the condition the pair is drawn under: the same fixture served
 * untagged splits into a set of one still and a set of one film, and a stage
 * with nothing to page to must offer no pair and no count at all rather than
 * two controls that do nothing. */
test('the stage pair pages the set inside 44px targets on every device, wraps both ways, and is absent when there is nowhere to go (owner sketch 2026-08-31; owner 2026-09-03, issue 287)', async ({
  page,
}) => {
  await visit(page);
  await page.locator('.gallery-tile[data-gallery-kind="image"]').first().click();
  const dialog = page.locator('dialog.gallery-lightbox');
  await expect(dialog).toBeVisible();
  const previous = page.locator('.gallery-nav[data-gallery-nav="previous"]');
  const next = page.locator('.gallery-nav[data-gallery-nav="next"]');
  await expect(previous).toHaveCount(1);
  await expect(next).toHaveCount(1);
  await expect(previous).toBeVisible();
  await expect(next).toBeVisible();

  /* At the touch floor, and ON the work rather than adrift beside it — each
     control's centre sits within the picture's own span, which is the
     adjacency the pre-241 arrows lost by 212px. */
  const picture = await page.locator('img.gallery-lightbox-image').boundingBox();
  for (const control of [previous, next]) {
    const box = await control.boundingBox();
    expect(box.width, 'a stage control fell under the touch floor').toBeGreaterThanOrEqual(
      touchFloorPx - subPixel
    );
    expect(box.height, 'a stage control fell under the touch floor').toBeGreaterThanOrEqual(
      touchFloorPx - subPixel
    );
    const centre = box.x + box.width / 2;
    expect(centre, 'a nav control sits off the work’s own span').toBeGreaterThanOrEqual(
      picture.x - subPixel
    );
    expect(centre, 'a nav control sits off the work’s own span').toBeLessThanOrEqual(
      picture.x + picture.width + subPixel
    );
  }

  /* IT WRAPS, both ways, and the walk is the whole set rather than one step:
     eight presses of next return the reader to where they started, and one
     press of previous from the first item lands on the last. */
  for (let step = 1; step < 8; step += 1) {
    await next.click();
    await expect(page.locator('.gallery-count')).toHaveText(`Photograph ${step + 1} of 8`);
  }
  await next.click();
  await expect(
    page.locator('.gallery-count'),
    'the end of the set is a dead stop instead of a wrap'
  ).toHaveText('Photograph 1 of 8');
  await previous.click();
  await expect(
    page.locator('.gallery-count'),
    'the start of the set is a dead stop instead of a wrap'
  ).toHaveText('Photograph 8 of 8');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();

  /* EVERY KIND (issue 384): the mixed fixture's set is a still and a film, so
     the walk from the still goes onto the film and wraps back, and the pair
     sits on the film's own span exactly as it sits on the picture's. */
  await serveGalleryManifest(page);
  await visit(page);
  await page.locator('.gallery-tile[data-gallery-kind="image"]').first().click();
  await expect(dialog).toBeVisible();
  await expect(page.locator('.gallery-count')).toHaveText('Photograph 1 of 2');
  await expect(next).toHaveAttribute('aria-label', 'Next film');
  await next.click();
  await expect(page.locator('.gallery-count'), 'the stage skipped the film in its own set').toHaveText(
    'Film 2 of 2'
  );
  const film = await page.locator('dialog video.gallery-lightbox-film').boundingBox();
  expect(film, 'paging onto a film staged no player').not.toBeNull();
  for (const control of [previous, next]) {
    const box = await control.boundingBox();
    expect(box.width, 'a stage control fell under the touch floor on a film').toBeGreaterThanOrEqual(
      touchFloorPx - subPixel
    );
    expect(box.height, 'a stage control fell under the touch floor on a film').toBeGreaterThanOrEqual(
      touchFloorPx - subPixel
    );
    const centre = box.x + box.width / 2;
    expect(centre, 'a nav control sits off the film’s own span').toBeGreaterThanOrEqual(film.x - subPixel);
    expect(centre, 'a nav control sits off the film’s own span').toBeLessThanOrEqual(
      film.x + film.width + subPixel
    );
  }
  await expect(previous).toHaveAttribute('aria-label', 'Previous photograph');
  await next.click();
  await expect(page.locator('.gallery-count'), 'the end of a mixed set is a dead stop').toHaveText(
    'Photograph 1 of 2'
  );
  await expect(page.locator('dialog video'), 'the film’s player outlived the page it was on').toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();

  /* AND THE ABSENT BRANCH, on a set with exactly one item: served untagged,
     the fixture's still is the whole of the Photographs set, so there is
     nowhere to page to and nothing may be drawn that says otherwise. */
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.route('**/media/mutable/gallery/manifest.json', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify({
        schema: 'gallery/v1',
        items: galleryManifestFixture.items.map(({ set: _set, ...item }) => item),
      }),
    })
  );
  await visit(page);
  await expect(page.locator('.gallery-tile')).toHaveCount(1);
  await page.locator('.gallery-tile[data-gallery-kind="image"]').first().click();
  await expect(dialog).toBeVisible();
  await expect(
    page.locator('.gallery-nav'),
    'a stage with one item still draws a pair of controls that can only return to it'
  ).toHaveCount(0);
  await expect(
    page.locator('.gallery-count'),
    'a stage with one item counts a position nobody can move'
  ).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/* THE SET CONTROL (owner sketch 2026-08-31, issue 275; RE-AIMED by the owner
 * directive of 2026-09-03, issue 287; 2026-10-17). The dropdown became a switch
 * above the row — one pressed button per set, drawn only when there is a
 * choice, with no menu to open and therefore no overlap to trade against. What the ruling was FOR is
 * unchanged and is what this measures: an entry exists exactly for a set
 * something is published in, choosing one really filters the row, and the
 * choice costs the page no layout.
 *
 * It serves the fixture UNTAGGED, so the sets under test are the kind-derived
 * defaults — the still is a Photograph, the film a Video — which is both
 * halves of the data-driven claim at once: entries exist for what the
 * manifest holds, and nothing (no OldSchool RuneScape, no empty promise) is
 * listed for a set nobody has published. The one-set branch is measured on
 * the vendored bootstrap row first, because a switch offering a choice of one
 * is a control that lies about having a choice. */
test('the set switch lists only sets that exist, filters the row without moving the page, and offers no choice when there is one set (issue 275; owner 2026-09-03, issue 287)', async ({
  page,
}) => {
  await visit(page);
  const grid = page.locator('.gallery-grid');
  await grid.scrollIntoViewIfNeeded();
  /* ONE SET, so no switch at all, and no label in its place (owner,
     2026-10-17): a button nobody can press to any effect is worse than
     nothing, and so is a word that only says what the pictures already show. */
  await expect(
    page.locator('.gallery-set'),
    'a set switch is drawn for a row with only one set to choose'
  ).toHaveCount(0);
  await expect(page.locator('.gallery-sets')).toHaveCount(0);
  await expect(page.locator('.gallery-set-name')).toHaveCount(0);

  await page.route('**/media/mutable/gallery/manifest.json', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify({
        schema: 'gallery/v1',
        items: galleryManifestFixture.items.map(({ set: _set, ...item }) => item),
      }),
    })
  );
  await visit(page);
  await grid.scrollIntoViewIfNeeded();
  const sets = page.locator('.gallery-set');
  await expect(
    sets,
    'the switch lists a set the manifest never published, or lost one it did'
  ).toHaveText([' · 1', ' · 1']);
  /* THE SET'S WORD IS ITS ACCESSIBLE NAME NOW (owner design decision,
     2026-09-11, issue 313): the segment prints a mark and the figure, and the
     engine's own accessibility tree is what has to still carry the word. */
  for (const name of ['Photographs · 1', 'Videos · 1']) {
    await expect(
      page.getByRole('button', { name, exact: true }),
      `no segment answers to "${name}"`
    ).toHaveCount(1);
  }
  /* ...and the marks differ, which is the whole reason a word could go: two
     segments drawn identically would be two segments nobody can tell apart. */
  const markShapes = await sets.evaluateAll((nodes) =>
    nodes.map((node) => node.querySelector('svg')?.innerHTML ?? '')
  );
  expect(markShapes[0], 'a gallery segment draws no mark at all').not.toBe('');
  expect(markShapes[0], 'both gallery segments draw the same mark').not.toBe(markShapes[1]);
  await expect(page.locator('.gallery-set-name')).toHaveCount(0);
  await expect(page.locator('.gallery-sets')).toHaveAttribute('aria-label', 'Media set');
  for (const index of [0, 1]) {
    const box = await sets.nth(index).boundingBox();
    expect(box.width + subPixel, 'a set button is under the touch floor').toBeGreaterThanOrEqual(
      touchFloorPx
    );
    expect(box.height + subPixel, 'a set button is under the touch floor').toBeGreaterThanOrEqual(
      touchFloorPx
    );
  }
  /* The chosen set says so in the accessibility tree, not by ink alone — the
     dataviz floor applied to a control (AGENTS.md, "a value is never encoded
     by color alone"). */
  await expect(sets.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(sets.nth(1)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.gallery-tile[data-gallery-kind="image"]')).toHaveCount(1);
  await expect(page.locator('.gallery-tile[data-gallery-kind="video"]')).toHaveCount(0);

  const heightBefore = await page.evaluate(() => window.document.documentElement.scrollHeight);
  const gridBefore = await grid.boundingBox();
  await sets.nth(1).click();
  await expect(sets.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(sets.nth(0)).toHaveAttribute('aria-pressed', 'false');
  /* Choosing really filters the row: the film set holds the film and nothing
     else, and the still is gone rather than merely dimmed. */
  await expect(page.locator('.gallery-tile[data-gallery-kind="video"]')).toHaveCount(1);
  await expect(page.locator('.gallery-tile[data-gallery-kind="image"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => window.document.documentElement.scrollHeight),
    'choosing a set grew the document'
  ).toBe(heightBefore);
  const gridAfter = await grid.boundingBox();
  expect(
    { x: Math.round(gridAfter.x), width: Math.round(gridAfter.width), height: Math.round(gridAfter.height) },
    'choosing a set moved or resized the row it filters'
  ).toEqual({
    x: Math.round(gridBefore.x),
    width: Math.round(gridBefore.width),
    height: Math.round(gridBefore.height),
  });
  /* AND THE KEYBOARD IS NEVER STRANDED BY A CHOICE. The buttons are keyed by
     the set they name, so pressing one does not unmount it — which is exactly
     what the retired dropdown had to repair by hand, and what this shape gets
     for free. A real Enter on a focused button is what proves it: a CLICK
     cannot, because macOS WebKit does not focus a <button> on a mouse press
     at all (MEASURED: activeElement is the body there), and that is an engine
     policy rather than anything this page decides.
     It doubles as the keyboard half of the control — the switch is reachable
     and operable without a pointer, on every engine. */
  await sets.nth(0).focus();
  await page.keyboard.press('Enter');
  await expect(sets.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.gallery-tile[data-gallery-kind="image"]')).toHaveCount(1);
  expect(
    await page.evaluate(() => {
      const buttons = [...window.document.querySelectorAll('.gallery-set')];
      return buttons.indexOf(window.document.activeElement);
    }),
    'the choice stranded keyboard focus'
  ).toBe(0);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('opening a tile shows a real modal dialog with a larger, unframed photograph; Escape closes it and hands the tile back its focus (issue 202; owner 2026-09-03, issue 287)', async ({
  page,
}) => {
  await visit(page);
  const dialog = page.locator('dialog.gallery-lightbox');
  await expect(dialog).not.toBeVisible();
  /* The tile's picture has to have decoded before the comparison below, which
     is between two PAINTED areas rather than two boxes. */
  const tile = page.locator('.gallery-tile[data-gallery-kind="image"]').first();
  await tile.scrollIntoViewIfNeeded();
  const thumb = tile.locator('img.gallery-thumb');
  await expect
    .poll(async () => thumb.evaluate((img) => img.complete && img.naturalWidth > 0), {
      message: 'the vendored preview never finished decoding',
      timeout: 10_000,
    })
    .toBe(true);
  const tileBox = await tile.boundingBox();

  await tile.click();
  await expect(dialog).toBeVisible();
  // A native <dialog> shown with showModal() reports itself open, and its
  // ::backdrop is what makes the rest of the page inert to a pointer.
  const modal = await dialog.evaluate((node) => node.matches(':modal'));
  expect(modal, 'the dialog did not open as a real top-layer modal').toBe(true);
  const enlarged = page.locator('img.gallery-lightbox-image');
  await expect(enlarged).toBeVisible();
  const enlargedBox = await enlarged.boundingBox();

  /* "Larger" is measured, not assumed. The tile's thumbnail is `object-fit:
     cover`, so the picture it paints IS its square box — no contain
     arithmetic to do, and the comparison is between the pixels a reader can
     actually see in each of the two states. */
  expect(
    enlargedBox.width * enlargedBox.height,
    `the enlarged photograph paints ${Math.round(enlargedBox.width * enlargedBox.height)}px² against the tile's ${Math.round(tileBox.width * tileBox.height)}px²`
  ).toBeGreaterThan(tileBox.width * tileBox.height);

  /* And it is UNFRAMED (owner directive, 2026-08-28: "get rid of those ugly
     outlines"). Issue 176's v1 painted a "static, simple, almost
     non-existent" border here and this lane pinned that it was real; the
     wrapper that carried it — .gallery-lightbox-border and its three
     --gallery-frame-* tokens — is gone with the redesign, so what the pin
     becomes is that nothing took its place: the picture sits directly in its
     <picture>, wearing no line and no mat, on a dialog that paints no surface
     of its own behind it. Each half fails on its own if a frame returns. */
  const frame = await page.evaluate(() => {
    const image = window.document.querySelector('.gallery-lightbox-image');
    const style = getComputedStyle(image);
    const dialogNode = window.document.querySelector('dialog.gallery-lightbox');
    const stage = window.document.querySelector('.gallery-stage');
    const imageBox = image.getBoundingClientRect();
    const stageBox = stage.getBoundingClientRect();
    return {
      wrappers: window.document.querySelectorAll('.gallery-lightbox-border').length,
      borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].map(
        Number.parseFloat
      ),
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(
        Number.parseFloat
      ),
      dialogBackground: getComputedStyle(dialogNode).backgroundColor,
      /* The stage adds no band of its own around the picture either, which is
         where a reintroduced mat would actually land now. */
      band: {
        width: stageBox.width - imageBox.width,
        height: stageBox.height - imageBox.height,
      },
    };
  });
  expect(frame.wrappers, 'the retired frame wrapper came back around the photograph').toBe(0);
  expect(frame.borders, 'the enlarged photograph wears a border again').toEqual([0, 0, 0, 0]);
  expect(frame.padding, 'the enlarged photograph reserves a band inside its own box').toEqual([0, 0, 0, 0]);
  expect(frame.dialogBackground, 'the dialog paints a mat behind the photograph').toMatch(
    /rgba\(0, 0, 0, 0\)|transparent/
  );
  /* Half a CSS pixel of allowance rather than this file's usual hundredth,
     because this is a difference between two boxes on a scaled device: the
     Pixel 5 lane snaps layout to its 2.75x grid and reported a 0.03125px band
     around an image that has no padding at all. Half a pixel cannot hide a
     frame — the smallest band the retired tokens could produce was a
     quarter-rem of padding on both sides, which is 8px. */
  const bandGrainPx = 0.5;
  expect(
    Math.max(frame.band.width, frame.band.height),
    `the stage is ${frame.band.width}x${frame.band.height} larger than the photograph inside it`
  ).toBeLessThanOrEqual(bandGrainPx);

  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  /* And focus comes back to the TILE it was invoked from (issue 202), the
     exact one rather than any of them. The native dialog's own restoration
     cannot be relied on here: a mouse click does not focus a <button> on
     macOS WebKit, so on the engine every iOS browser runs the "previously
     focused element" is the body — this assertion is exactly what fails if
     the component stops restoring it explicitly. */
  const focused = await page.evaluate(() => {
    const active = window.document.activeElement;
    const tiles = [...window.document.querySelectorAll('.gallery-tile')];
    return { index: tiles.indexOf(active), label: active?.getAttribute?.('aria-label') ?? null };
  });
  expect(
    focused.index,
    `Escape left focus on "${focused.label}" rather than on the tile that opened the stage`
  ).toBe(0);
});

/* ===========================================================================
 * THE LIGHTBOX KEEPS THE READER'S PLACE (owner report, 0.1.52; issue 233)
 *
 * "When I close the media, it returns me to the top of the page, that is not
 * right at all." The position was lost at OPEN rather than at close, and the
 * two engines differed only in the clean-up: MEASURED at a 1280x720 viewport
 * on the live 0.1.52 origin, scrollY 1943 before the click and 0 while the
 * dialog was open on Chromium AND WebKit, after which WebKit restored 1943
 * and Chromium did not. One defect, invisible on Safari and page-breaking on
 * Chrome — the exact shape a single-engine lane would have called fixed. So
 * this measures the real offset on every engine the matrix runs, across all
 * three ways the dialog can be closed.
 *
 * It drives a STILL's tile because the vendored set it reads is all stills;
 * a film's tile opens this same dialog since issue 384, and the film lane
 * below proves its close hands focus back to the film's own tile. The focus
 * half is asserted by IDENTITY rather than
 * by class — the tile that was pressed, not merely something that looks like
 * one — because a grid has four of them and a restore to the wrong one is
 * exactly the defect a class check cannot see.
 * ======================================================================== */
test('opening and closing the enlarged media leaves the reader exactly where they were, focus included (issue 233; owner 2026-09-03, issue 287)', async ({
  page,
}) => {
  await visit(page);
  const dialog = page.locator('dialog.gallery-lightbox');
  /* The THIRD tile, not the first: a restore that always lands on the row's
     first tile would satisfy this lane from the first tile and fail a reader
     who opened any other. */
  const tile = page.locator('.gallery-tile[data-gallery-kind="image"]').nth(2);
  await tile.scrollIntoViewIfNeeded();
  await settled(page);
  await page.evaluate(() => {
    const tiles = [...window.document.querySelectorAll('.gallery-tile')];
    window.__opener = tiles[2];
  });

  const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
  const start = await scrollY();
  /* Vacuity guard: a page sitting at its own top cannot prove it kept its
     place, and this lane would pass by measuring nothing. */
  expect(
    start,
    'the gallery is inside the first viewport here, so this lane proves nothing'
  ).toBeGreaterThan(150);

  for (const close of ['escape', 'the close control', 'a backdrop click']) {
    await tile.click();
    await expect(dialog).toHaveJSProperty('open', true);
    await expect(page.locator('.gallery-count')).toHaveText('Photograph 3 of 8');
    /* The defect was HERE, one step before the one the owner reported: the
       dialog took the reader with it as it opened. */
    expect(await scrollY(), `opening the lightbox moved the page from ${start}`).toBe(start);

    if (close === 'escape') {
      await page.keyboard.press('Escape');
    } else if (close === 'the close control') {
      await page.locator('.gallery-lightbox-close').click();
    } else {
      // The dialog's own box, never its content: that is what a backdrop
      // click is, and the close lane's padding is where one can land.
      const box = await dialog.boundingBox();
      await page.mouse.click(Math.round(box.x + 3), Math.round(box.y + 3));
    }
    await expect(dialog).toHaveJSProperty('open', false);
    await settled(page);

    const after = await scrollY();
    expect(
      Math.abs(after - start),
      `closing by ${close} moved the page from ${start} to ${after}`
    ).toBeLessThanOrEqual(1);
    /* The accessibility half of the same close, and the reason the fix is a
       placement rather than a suppressed scroll: focus still returns to the
       control that opened the dialog, so a keyboard reader lands on the
       photograph rather than nowhere.
       The two engines do NOT agree here on their own, and the component's
       explicit restore is what makes them: MEASURED, deleting that restore
       leaves this assertion GREEN on Chromium — whose native dialog returns
       focus to the previously-focused element by itself, the button having
       been focused by the click — and RED on WebKit, where a mouse click
       never focused the button, so the reader lands on the document body.
       WebKit is therefore the engine this half is about, and it is the engine
       every iOS browser runs. */
    const focused = await page.evaluate(() => ({
      same: window.document.activeElement === window.__opener,
      where: window.document.activeElement?.getAttribute?.('aria-label') ?? window.document.activeElement?.tagName ?? 'none',
    }));
    expect(
      focused.same,
      `closing by ${close} left focus on "${focused.where}" rather than on the tile that opened the stage`
    ).toBe(true);
  }
});

/* A FILM'S TILE OPENS THE STAGE LIKE A PICTURE'S (issue 384; RE-AIMED from
 * issues 233 and 243 and the owner directive of 2026-09-03, issue 287).
 *
 * The user, on an iPhone, 2026-10-22: "the videos are not responsive to the
 * touch, I should be able to click the video to expand it just as the
 * pictures in the gallery". That supersedes the film this lane used to prove
 * — played INLINE in its own tile behind one play control ("the sensitive
 * area should only be the button and not the entire video") and never in the
 * dialog — because a press on the film's picture did nothing, which is the
 * defect the user reported. What the older rulings were FOR is kept and
 * measured: "make it one single block that doesn't expand, reduce based on the
 * media" (2026-08-28) holds for the TILE, which is the still's identical box,
 * and for the stage, which reserves the film's box from what the item
 * declares; nothing ever autoplays; the source ladder is the manifest's own.
 *
 * What it proves, in a real engine, on a gallery whose items came down a
 * manifest exactly as the operator's own would:
 *   - the film's tile is a BUTTON, the same box as the still's tile, over the
 *     film's own preview, with a centred play mark that is decoration only;
 *   - the page holds ZERO <video> until the press;
 *   - pressing the film's tile opens the dialog with exactly one <video> in
 *     it: native controls, playsinline, preload metadata, the manifest's
 *     poster, the ladder in the manifest's order with its types, no autoplay
 *     attribute, and a box reserved from the item's declared size;
 *   - that press called play() exactly once, and paging onto the still and
 *     back onto the film — by the pair and by the arrow keys — calls it NO
 *     further times;
 *   - a horizontal swipe across the film's stage does not page, and an arrow
 *     key pressed on the film's own player does not either;
 *   - a keyboard reader turning between the film and the still keeps focus
 *     on the pair, though the turn swaps the stage the pair sits in;
 *   - the film's description renders while the film is staged and nowhere
 *     else, before, between or after;
 *   - closing hands focus back to the film's tile, leaves no <video> on the
 *     page, and the row behind the scrim never moved.
 *
 * play() is COUNTED rather than observed. The e2e origin serves no media
 * volume, so the fixture's files 404 and no engine could ever report the film
 * playing; publishing a fixture film into the repository to change that would
 * be exactly the heavy media requirement 11 keeps out of git. A wrapper
 * installed before the page's own script records each call and hands it
 * straight on to the engine's own play(), so the component runs unchanged and
 * the count is the one fact this lane needs. */
test('a film’s tile is a button that opens the stage, where one native player starts on that press and never on a page turn (issue 384; issues 233, 243, 207)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const enginePlay = HTMLMediaElement.prototype.play;
    window.__playCalls = [];
    HTMLMediaElement.prototype.play = function countedPlay(...args) {
      window.__playCalls.push(this.closest('dialog') === null ? 'page' : 'stage');
      return enginePlay.apply(this, args);
    };
  });
  await serveGalleryManifest(page);
  await visit(page);
  const grid = page.locator('.gallery-grid');
  await grid.scrollIntoViewIfNeeded();
  const dialog = page.locator('dialog.gallery-lightbox');
  const counter = page.locator('.gallery-count');
  const filmTile = page.locator('.gallery-tile[data-gallery-kind="video"]');
  const description = galleryManifestFixture.items[1].description;
  const plays = () => page.evaluate(() => window.__playCalls.slice());
  /* Two painted frames: every state change this lane makes is flushed by the
     component before the next frame, so anything still to happen has. */
  const painted = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))
    );
  const onPage = (text) => page.evaluate((copy) => window.document.documentElement.textContent.includes(copy), text);

  // The manifest replaced the vendored set wholesale, so the row is the
  // fixture's own: one still and one film, and nothing beside them.
  await expect(page.locator('.gallery-tile')).toHaveCount(2);
  await expect(page.locator('.gallery-control')).toHaveCount(0);
  const rowBefore = await galleryRowShape(page);

  const tiles = await page.evaluate(() => {
    const round = (box) => ({
      width: Math.round(box.width * 10) / 10,
      height: Math.round(box.height * 10) / 10,
    });
    const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    const still = window.document.querySelector('.gallery-tile[data-gallery-kind="image"]');
    const film = window.document.querySelector('.gallery-tile[data-gallery-kind="video"]');
    const mark = film.querySelector('.gallery-play-disc');
    const filmBox = film.getBoundingClientRect();
    const markBox = mark?.getBoundingClientRect();
    return {
      still: round(still.getBoundingClientRect()),
      stillTag: still.tagName,
      film: round(filmBox),
      filmTag: film.tagName,
      label: film.getAttribute('aria-label'),
      videos: window.document.querySelectorAll('video').length,
      thumbs: [...film.querySelectorAll('img')].map((image) => ({
        src: image.getAttribute('src'),
        thumb: image.classList.contains('gallery-thumb'),
        loading: image.getAttribute('loading'),
      })),
      /* Nothing a reader can reach sits inside the tile: the tile IS the
         target, all of it, which is the whole of the user's report. */
      reachable: film.querySelectorAll('button, a, video, [tabindex]').length,
      stillMarks: still.querySelectorAll('.gallery-play-disc').length,
      mark:
        mark === null
          ? null
          : {
              hidden: mark.getAttribute('aria-hidden'),
              dx: Math.abs(centre(markBox).x - centre(filmBox).x),
              dy: Math.abs(centre(markBox).y - centre(filmBox).y),
              width: markBox.width,
            },
    };
  });

  /* ONE TILE SHAPE: the film's tile is the button the still's is, the same
     box in one layout, over the film's own preview. */
  expect(tiles.stillTag, 'a still’s tile stopped being the button that opens the stage').toBe('BUTTON');
  expect(tiles.filmTag, 'a film’s tile is not a button, so a press on its picture does nothing').toBe('BUTTON');
  expect(tiles.label, 'a film’s tile does not say what pressing it will open').toBe(
    'Open film: A film, served by the lane'
  );
  expect(
    tiles.film,
    `a film’s tile is ${tiles.film.width}x${tiles.film.height} against a still’s ${tiles.still.width}x${tiles.still.height}; the block changes size with the media`
  ).toEqual(tiles.still);
  expect(tiles.thumbs, 'a film’s tile does not show the film’s own lazy preview').toEqual([
    {
      src: expect.stringContaining(`/media/immutable/${'d'.repeat(64)}/gallery/film-preview.webp`),
      thumb: true,
      loading: 'lazy',
    },
  ]);
  expect(tiles.reachable, 'a film’s tile holds a control of its own again').toBe(0);
  expect(tiles.videos, 'the row mounts a player before anybody pressed anything').toBe(0);
  expect(tiles.stillMarks, 'a still’s tile carries the film’s play mark').toBe(0);
  expect(tiles.mark, 'a film’s tile carries no play mark').not.toBeNull();
  expect(tiles.mark.hidden, 'the play mark is a second thing an assistive reader is told about').toBe('true');
  expect(tiles.mark.width, 'the play mark paints nothing').toBeGreaterThan(0);
  expect(Math.max(tiles.mark.dx, tiles.mark.dy), 'the play mark is not centred over the picture').toBeLessThanOrEqual(1);
  expect(await onPage(description), 'the film’s description is on the page before the film was opened').toBe(false);
  expect(await plays(), 'something started a film before anybody pressed one').toEqual([]);

  /* THE PRESS ON THE FILM'S PICTURE opens the stage, with exactly one player
     in it, and that press is the one start. */
  await filmTile.click();
  await expect(dialog).toHaveJSProperty('open', true);
  await expect(counter).toHaveText('Film 2 of 2');
  await expect
    .poll(plays, { message: 'pressing the film’s tile did not start it', timeout: 5_000 })
    .toEqual(['stage']);

  const staged = await page.evaluate(() => {
    const dialogNode = window.document.querySelector('dialog.gallery-lightbox');
    const video = dialogNode.querySelector('video');
    const box = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    return {
      videos: window.document.querySelectorAll('video').length,
      inDialog: dialogNode.querySelectorAll('video').length,
      controls: video.controls,
      autoplay: video.hasAttribute('autoplay') || video.autoplay,
      /* The ATTRIBUTE, not the IDL mirror. Gecko implements the attribute's
         behaviour but exposes no `playsInline` property, so reading the
         property here reported `undefined` on Firefox (MEASURED) — and the
         stage-1 floor is about the declaration anyway, which is what every
         engine agrees on. */
      playsinline: video.hasAttribute('playsinline'),
      preload: video.preload,
      poster: video.getAttribute('poster'),
      label: video.getAttribute('aria-label'),
      fit: style.objectFit,
      declared: { width: Number(video.getAttribute('width')), height: Number(video.getAttribute('height')) },
      box: { width: box.width, height: box.height },
      stageCap: Number.parseFloat(getComputedStyle(dialogNode).maxWidth),
      blockCap: Number.parseFloat(style.maxHeight),
      sources: [...video.querySelectorAll('source')].map((source) => ({
        src: source.getAttribute('src'),
        type: source.getAttribute('type'),
        media: source.getAttribute('media'),
        /* What the ENGINE makes of that query at this viewport, which is
           the only thing that decides whether the rung is a candidate. */
        eligible: source.media === '' || window.matchMedia(source.media).matches,
      })),
      close: dialogNode.querySelector('.gallery-lightbox-close').getAttribute('aria-label'),
    };
  });
  expect(staged.videos, 'the page holds a number of players other than the one on the stage').toBe(1);
  expect(staged.inDialog, 'the film’s player is not on the stage').toBe(1);
  expect(staged.controls, 'the staged film offers the reader no controls').toBe(true);
  expect(staged.autoplay, 'the staged film declares autoplay').toBe(false);
  expect(staged.playsinline, 'the film would go fullscreen on a phone instead of playing on the stage').toBe(true);
  expect(staged.preload).toBe('metadata');
  expect(staged.label).toBe('A film, served by the lane');
  expect(staged.close, 'the close mark calls a film a photograph').toBe('Close enlarged film');
  await expect(page.locator('.gallery-meta-title')).toHaveText('A film with a title');
  await expect(page.locator('.gallery-meta-text'), 'the staged film does not say what it is').toHaveText(
    description
  );

  /* THE LADDER IS THE MANIFEST'S OWN, in its own order, with the poster the
     manifest published rather than the item's large still. */
  expect(staged.sources.map((source) => source.type)).toEqual([
    'video/mp4; codecs="hvc1"',
    'video/mp4',
    'video/mp4',
  ]);
  expect(staged.sources[0].src).toContain(`/media/immutable/${'f'.repeat(64)}/gallery/film-2160.mp4`);
  expect(staged.sources[1].src).toContain(`/media/immutable/${'0'.repeat(64)}/gallery/film-1080.mp4`);
  expect(staged.sources[2].src).toContain(`/media/immutable/${'1'.repeat(64)}/gallery/film-720.mp4`);
  expect(staged.poster).toContain(`/media/immutable/${'e'.repeat(64)}/gallery/film-poster.webp`);

  /* THE LADDER ALSO STATES A SIZE (issue 241), and the engine agrees with the
     arithmetic. The queries are the manifest's own numbers through the item's
     declared aspect; the floor carries none, so some rung always matches. */
  expect(staged.sources.map((source) => source.media)).toEqual(['(min-width: 1920px)', '(min-width: 1280px)', null]);
  expect(
    staged.sources.filter((source) => source.eligible).length,
    'no rung is eligible at this viewport; the film is unplayable'
  ).toBeGreaterThan(0);
  expect(
    staged.sources.at(-1).eligible,
    'the smallest rung is gated behind a query, so a narrow viewport can be offered nothing'
  ).toBe(true);

  /* THE BOX IS RESERVED, with not one byte of the film or its poster served:
     the stage's own inline cap, a block size from the size the item declares,
     the block cap over that, and the film reduced inside it. */
  expect(staged.fit, 'the staged film is cropped to its box rather than reduced inside it').toBe('contain');
  expect(staged.declared, 'the staged film declares no size of its own, so its box waits for bytes').toEqual({
    width: galleryManifestFixture.items[1].full.width,
    height: galleryManifestFixture.items[1].full.height,
  });
  expect(
    Math.abs(staged.box.width - staged.stageCap),
    `the staged film is ${staged.box.width}px across a ${staged.stageCap}px stage`
  ).toBeLessThanOrEqual(1);
  const reserved = Math.min(
    (staged.box.width * staged.declared.height) / staged.declared.width,
    staged.blockCap
  );
  expect(
    Math.abs(staged.box.height - reserved),
    `the staged film is ${staged.box.height}px tall with nothing loaded, not the ${reserved}px its declared size reserves`
  ).toBeLessThanOrEqual(1);

  /* A DRAG ACROSS THE FILM IS THE SCRUBBER'S, never a turn of the page: the
     same deliberate leftward swipe that turns a still's stage, dispatched as
     real touch PointerEvents on the film's stage, changes nothing. */
  const stageBox = await page.locator('.gallery-stage').boundingBox();
  await page.evaluate(
    ([xs, y]) => {
      const stageNode = window.document.querySelector('.gallery-stage');
      const send = (type, x) =>
        stageNode.dispatchEvent(
          new PointerEvent(type, { pointerId: 31, pointerType: 'touch', clientX: x, clientY: y, bubbles: true })
        );
      send('pointerdown', xs[0]);
      for (const x of xs.slice(1)) send('pointermove', x);
      send('pointerup', xs.at(-1));
    },
    [[0.8, 0.7, 0.55, 0.4, 0.25].map((at) => stageBox.x + stageBox.width * at), stageBox.y + stageBox.height / 2]
  );
  await page.waitForTimeout(320);
  await expect(counter, 'a horizontal drag across the film turned the page').toHaveText('Film 2 of 2');

  /* PAGING NEVER STARTS A FILM. Onto the still by the pair, back onto the
     film by the pair, and the same round again by the keyboard: the film
     arrives on its poster each time and play() is never called again. */
  const next = page.locator('.gallery-nav[data-gallery-nav="next"]');
  const previous = page.locator('.gallery-nav[data-gallery-nav="previous"]');
  await next.click();
  await expect(counter).toHaveText('Photograph 1 of 2');
  await expect(page.locator('video'), 'the film’s player outlived its page').toHaveCount(0);
  await expect(page.locator('.gallery-meta-text'), 'the film’s description stayed on the still').toHaveCount(0);
  expect(await onPage(description), 'the film’s description is on the page with the still staged').toBe(false);
  await previous.click();
  await expect(counter).toHaveText('Film 2 of 2');
  await expect(page.locator('dialog video')).toHaveCount(1);

  /* THE KEYBOARD KEEPS ITS PLACE ACROSS A KIND. A turn between a film and a
     still swaps the stage the pair sits in, so the control a reader pressed
     is replaced by its twin: a real Enter on the focused control, and the
     arrow keys after it, must each land with focus on the pair rather than
     on the document, where the next key would reach nothing. */
  const onPair = (side) =>
    page.evaluate(
      (which) => window.document.activeElement?.matches?.(`.gallery-nav[data-gallery-nav="${which}"]`) === true,
      side
    );
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(counter).toHaveText('Photograph 1 of 2');
  await expect
    .poll(() => onPair('next'), { message: 'a turn from the film onto the still dropped the keyboard' })
    .toBe(true);
  await page.keyboard.press('ArrowRight');
  await expect(counter, 'an arrow key on the still’s pair did not turn the stage').toHaveText('Film 2 of 2');
  await expect
    .poll(() => onPair('next'), { message: 'a turn from the still onto the film dropped the keyboard' })
    .toBe(true);
  await page.keyboard.press('ArrowLeft');
  await expect(counter).toHaveText('Photograph 1 of 2');
  await page.keyboard.press('ArrowLeft');
  await expect(counter).toHaveText('Film 2 of 2');
  await expect(page.locator('dialog video')).toHaveCount(1);
  /* An arrow pressed ON the film's player is the player's — it seeks — and
     the stage stays where it is. */
  await page.locator('dialog video').dispatchEvent('keydown', { key: 'ArrowRight' });
  await painted();
  await expect(counter, 'an arrow on the film’s own player turned the stage').toHaveText('Film 2 of 2');
  expect(await plays(), 'paging onto a film started it').toEqual(['stage']);

  /* CLOSING ends it: no player anywhere, focus on the film's own tile, the
     description gone with the stage, and the row behind the scrim unmoved. */
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveJSProperty('open', false);
  await expect(page.locator('video'), 'closing the stage left a player on the page').toHaveCount(0);
  const focused = await page.evaluate(() => {
    const active = window.document.activeElement;
    return {
      same: active === window.document.querySelector('.gallery-tile[data-gallery-kind="video"]'),
      where: active?.getAttribute?.('aria-label') ?? active?.tagName ?? 'none',
    };
  });
  expect(focused.same, `closing the film left focus on "${focused.where}" rather than on its tile`).toBe(true);
  expect(await onPage(description), 'the film’s description outlived the stage').toBe(false);
  expect(await galleryRowShape(page), 'opening and paging the film reshaped the row behind it').toEqual(rowBefore);
  expect(await plays(), 'closing the stage started a film').toEqual(['stage']);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/* THE RUNG A VIEWPORT ACTUALLY PULLS (issue 241).
 *
 * The lane above proves the queries are written and that the engine agrees
 * with them. This one proves the consequence, which is the whole defect: what
 * the browser REQUESTS. Before the queries existed the ladder's size was
 * decided by codec support alone, so every engine that decodes the
 * high-efficiency rung — WebKit and Gecko both do — streamed the 2160p master
 * into a phone-sized box, and the smallest rung was requested by nobody at any
 * viewport.
 *
 * The expectation is derived from the engine's own viewport rather than stated
 * per project, so the phone lanes and the desktop lanes assert the same rule
 * and neither is a special case. The files 404 (the e2e origin serves no media
 * volume), which is exactly right here: this measures resource SELECTION, and
 * selection happens before a single byte of the file is read.
 *
 * The player lives on the stage now (issue 384): the row mounts no <video>
 * and so asks for no rendition at all — asserted here before the press — and
 * the press on the film's tile mounts the one player, whose
 * `preload="metadata"` and start send it after a rendition at once, so the
 * selection this lane is about happens on that press. */
test('a phone never pulls the 4K rung, and the smallest rung is reachable at all (issue 241)', async ({
  page,
}) => {
  const requested = [];
  await page.route('**/gallery/film-*.mp4', (route) => {
    requested.push(route.request().url());
    return route.fulfill({ status: 404, body: '' });
  });
  await serveGalleryManifest(page);
  await visit(page);
  const filmTile = page.locator('.gallery-tile[data-gallery-kind="video"]');
  await filmTile.scrollIntoViewIfNeeded();
  await settled(page);
  expect(requested, 'the row asked for a rendition before anybody opened the film').toEqual([]);
  await filmTile.click();
  await expect(page.locator('dialog.gallery-lightbox')).toHaveJSProperty('open', true);

  // preload="metadata" means the element goes and gets one, so this waits for
  // the selection to have happened rather than for a fixed time.
  await expect
    .poll(() => requested.length, {
      message: 'the player requested no rendition at all, so this lane measured no selection',
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  const viewport = await page.evaluate(() => window.innerWidth);
  const pulled = requested.map((url) => Number(/film-([0-9]+)[.]mp4/.exec(url)[1]));

  /* THE 4K RUNG IS OFF-LIMITS BELOW ITS OWN BREAKPOINT. 1920px is the 1080p
     rung's native width through this item's declared 3840x2160 box — the
     manifest's own number, not this file's. */
  if (viewport < 1920) {
    expect(
      pulled,
      `a ${viewport}px viewport pulled the 2160p master: ${requested.join(', ')}`
    ).not.toContain(2160);
  }
  // And below the middle rung's own breakpoint the floor is the only rendition
  // there is — which is the rung that used to be selected by nobody.
  if (viewport < 1280) {
    expect(
      [...new Set(pulled)],
      `a ${viewport}px viewport pulled something other than the 720p floor: ${requested.join(', ')}`
    ).toEqual([720]);
  }

  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/* THE GRID FILLS ITS COLUMN (issue 202, re-aimed by the owner directive of
 * 2026-09-03, issue 287, and by the owner's standing no-dead-space rule:
 * content short of its container's right edge is a defect).
 *
 * The complaint this lane was born from — "568.9px of frame at the left of an
 * 842px track, 273px of dead space on the right alone" — was answered for the
 * old frame by CENTRING it, which is the best a box with a transferred inline
 * size can do. The tile grid does not need centring because it does not fall
 * short: its five tracks are `minmax(0, 1fr)` of the column, so the right
 * answer is the stronger one, and it is what the redesign is FOR. Both edges
 * are measured against the reading column's own, and the cells against each
 * other, so nothing here derives from the stylesheet or a token. */
test('the gallery grid fills the reading column edge to edge, in five equal cells on a desktop (issue 202; owner 2026-09-03, issue 287)', async ({
  page,
}) => {
  await visit(page);
  for (const width of desktopWidths) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    const observed = await page.evaluate(() => {
      const round = (value) => Math.round(value * 100) / 100;
      const grid = window.document.querySelector('.gallery-grid').getBoundingClientRect();
      /* The column's CONTENT box (owner direction, 2026-10-16): the Keep
         frames the sheet and pads it, and those are the column's own margin
         now — what the row must reach is the edge every other block reaches,
         measured on the page, never a number this file states. */
      const main = window.document.querySelector('main');
      const mainBox = main.getBoundingClientRect();
      const mainStyle = getComputedStyle(main);
      const column = {
        left: mainBox.left + Number.parseFloat(mainStyle.borderLeftWidth) + Number.parseFloat(mainStyle.paddingLeft),
        right: mainBox.right - Number.parseFloat(mainStyle.borderRightWidth) - Number.parseFloat(mainStyle.paddingRight),
      };
      const cells = [...window.document.querySelectorAll('.gallery-tile')].filter((cell) => cell.getClientRects().length > 0).map(
        (cell) => {
          const box = cell.getBoundingClientRect();
          return { x: round(box.x), y: round(box.y), width: round(box.width) };
        }
      );
      return {
        left: round(grid.left - column.left),
        right: round(column.right - grid.right),
        cells,
        rows: [...new Set(cells.map((cell) => Math.round(cell.y)))].length,
        columns: [...new Set(cells.map((cell) => Math.round(cell.x)))].length,
      };
    });
    const at = `at ${width}px`;
    /* ONE PIXEL, and it is a rounding allowance rather than a tolerance for
       dead space: the gutter the owner reported was 273px, and the smallest
       gap this grid could leave from a real regression is one whole track. */
    expect(
      observed.right,
      `the grid stops ${observed.right}px short of the column's right edge ${at}`
    ).toBeLessThanOrEqual(1);
    expect(observed.right, `the grid runs past the column's right edge ${at}`).toBeGreaterThanOrEqual(-1);
    expect(observed.left, `the grid starts ${observed.left}px inside the column ${at}`).toBeLessThanOrEqual(1);
    expect(observed.left, `the grid starts ${observed.left}px outside the column ${at}`).toBeGreaterThanOrEqual(-1);
    /* FIVE CELLS, ONE ROW, EQUAL WIDTHS — five pictures, which is what makes
       the row fill the column with no track left over (owner, 2026-10-17). */
    expect(observed.cells.length, `the row holds ${observed.cells.length} cells ${at}`).toBe(5);
    expect(observed.rows, `the five cells wrapped onto ${observed.rows} rows ${at}`).toBe(1);
    expect(observed.columns, `the row draws ${observed.columns} columns ${at}`).toBe(5);
    const widths = observed.cells.map((cell) => cell.width);
    for (const [index, cell] of widths.entries()) {
      expect(
        cell,
        `cell ${index + 1} is ${cell}px against cell 1's ${widths[0]}px ${at}; the tracks are not equal`
      ).toBeCloseTo(widths[0], 0);
    }
  }
});

/* THE STILL-ONTO-FILM ZERO-SHIFT LANE IS DELETED (owner directive,
 * 2026-09-03, issue 287: the strip is gone). It measured the document, the
 * reserved frame, the caption lane and the section below the gallery across a
 * navigation from a still to a film and back — a navigation the tile grid
 * does not have, because a still and a film are on screen at the same time
 * and neither replaces the other. The claim it was protecting is not dropped,
 * it is made stronger and measured elsewhere: the film lane above compares
 * a film's tile against the still's tile in ONE layout, which no reservation
 * bug can satisfy by moving both boxes together. The stage does page from a
 * still onto a film again (issue 384), and that lane holds the row behind the
 * scrim to its exact shape across the whole round. */

/* THE PAGE DOES NOT SCROLL BEHIND THE LIGHTBOX (issue 241).
 *
 * showModal() makes the document inert to POINTER interaction and nothing
 * else, so a wheel and a PageDown both moved the page under the scrim —
 * MEASURED on 0.1.54 at +485px on an iPhone 13 viewport and +1400px at
 * 1280x720 — and closing then landed the reader somewhere they never chose.
 * Both halves are measured here: the lock while open, and the exact restore on
 * close. The wheel is a real wheel event rather than window.scrollBy, which
 * would scroll an overflow:hidden root programmatically and measure nothing. */
test('the document holds still while the lightbox is open, and is unchanged after (issue 241)', async ({
  page,
  browserName,
  isMobile,
}) => {
  /* ONE CAPABILITY BOUNDARY, named rather than skipped around: Playwright
     cannot deliver a wheel to mobile WebKit ("Mouse wheel is not supported in
     mobile WebKit"). The keyboard half runs on every engine including that
     one, and the keyboard is the same scroller — so no project asserts
     nothing here; the wheel is simply an extra input where one can be sent. */
  const canWheel = !(browserName === 'webkit' && isMobile);
  await visit(page);
  const dialog = page.locator('dialog.gallery-lightbox');
  const tile = page.locator('.gallery-tile[data-gallery-kind="image"]').first();
  await tile.scrollIntoViewIfNeeded();
  await settled(page);

  const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
  /* Every scroll this lane sends is INPUT, never `scrollTo`: a locked root is
     `overflow: hidden`, which stops a reader scrolling and leaves the document
     programmatically scrollable, so a scripted scroll would move the page in
     both states and measure nothing.

     Which makes "the engine moved the page from an input event" a
     precondition, not an assumption — and it is measured HERE, on the
     unlocked page, before anything is opened. An engine that never answers a
     synthetic scroll would otherwise read as a perfect lock and then fail the
     release half for a reason that has nothing to do with the lock. */
  const scrollInput = async () => {
    if (canWheel) {
      await page.mouse.move(10, 10);
      await page.mouse.wheel(0, -400);
    }
    await page.keyboard.press('Home');
  };
  const settledStart = await scrollY();
  await scrollInput();
  /* Waited for, not read once: a scroll the page animates has not landed by
     the time the press returns, and reading immediately would report every
     smooth-scrolling engine as one that cannot scroll at all. */
  const answered = await page
    .waitForFunction((from) => window.scrollY < from, settledStart, { timeout: 4000 })
    .then(
      () => true,
      () => false
    );
  /* ONE PROJECT MAY NOT OPT OUT. A precondition that every project is allowed
     to skip on is a matrix that reports green for a site nobody can scroll:
     `html { overflow: hidden }` written unconditionally skips this lane
     everywhere and leaves the whole suite passing — measured by the
     adversarial review of this branch, 463 passed / 27 skipped / 0 failed with
     the unit suite still 437/0. So desktop Chromium, the project where this
     page scrolls by construction (a fixed-width desktop viewport, a document
     several times its height, and an engine whose synthetic input this file
     depends on throughout), asserts it instead of skipping — measured
     answering on all five projects today, so nothing is being carved out for a
     known failure. The named boundary stays for the other four, where an
     engine's synthetic-input behaviour is its own business and a skip is
     honest; it is loud in the run output either way. */
  const mustScroll = browserName === 'chromium' && !isMobile;
  if (mustScroll) {
    expect(answered, 'the page never scrolls from a synthetic input, locked or not').toBe(true);
  }
  test.skip(
    !answered,
    `${browserName} does not move the page from a synthetic scroll here, so neither half of this lane could mean anything on it`
  );
  await tile.scrollIntoViewIfNeeded();
  await settled(page);

  const start = await scrollY();
  expect(start, 'the gallery is inside the first viewport here, so this lane proves nothing').toBeGreaterThan(150);
  /* Zero CLS across the lock is measured on the READING COLUMN, not on the
     viewport: taking the document's overflow away takes its scrollbar with it,
     which on a classic-scrollbar platform WIDENS the viewport by design — what
     must not move is the content the reader is looking at, which the measured
     giveback holds still. On every engine in this matrix the scrollbar costs
     the layout nothing — measured: setting the giveback's fallback to 20px
     moved this column on all five projects, so the property is never set and
     the difference it is measured from is zero — which is why this lane
     asserts the half that holds on every platform, and the arithmetic that
     only a space-taking scrollbar exercises is pinned as structure in
     `tests/experience.test.mjs`. */
  const columnShape = () =>
    page.evaluate(() => {
      const box = window.document.querySelector('main').getBoundingClientRect();
      return { x: Math.round(box.x * 10) / 10, width: Math.round(box.width * 10) / 10 };
    });
  const shapeBefore = await columnShape();

  await tile.click();
  await expect(dialog).toHaveJSProperty('open', true);
  /* The lock is an ATTRIBUTE on the document element, written by an effect so
     it cannot be left behind — asserted in both directions below, because a
     lock that is never released is the same defect wearing the other face. */
  await expect(page.locator('html')).toHaveAttribute('data-modal-open', 'true');

  expect(await columnShape(), 'opening the lightbox moved the page under the reader').toEqual(shapeBefore);

  if (canWheel) {
    await page.mouse.move(10, 10);
    await page.mouse.wheel(0, 800);
    await page.mouse.wheel(0, -800);
  }
  await page.keyboard.press('PageDown');
  await page.keyboard.press('End');
  /* Both directions, so no engine can pass this by having nowhere to go: the
     document below the gallery is as tall as its own content makes it, but
     `start` is always over 150px from the top, so `Home` always has room. */
  await page.keyboard.press('Home');
  expect(
    await scrollY(),
    `the page scrolled behind the open lightbox, from ${start}`
  ).toBe(start);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveJSProperty('open', false);
  await expect(page.locator('html')).not.toHaveAttribute('data-modal-open', /.*/);
  expect(await scrollY(), 'closing the lightbox left the reader somewhere else').toBe(start);
  expect(await columnShape(), 'closing the lightbox moved the page under the reader').toEqual(shapeBefore);
  /* And the lock is RELEASED, not merely ineffective: the page scrolls again.
     Without this half the same green could be bought by a page that can never
     scroll at all.

     UPWARD, because that is the direction this lane can prove has somewhere to
     go: `start` is over 150px down the document, whereas whether there is a
     further page BELOW the gallery depends on how tall the rest of the page
     renders on a given engine — the first form of this half scrolled down and
     went red on the CI runner's desktop WebKit with the page already at its
     own end, where a press is refused by the document being over rather than
     by any lock.

     It is the SAME input the precondition above proved this engine answers, so
     a failure here can only be the lock. */
  await scrollInput();
  await expect.poll(scrollY, { message: 'the page never scrolls again after the lightbox closes' }).toBeLessThan(start);
});

/* Every cell of the row, measured as one shape. Used twice by the reservation
 * lane below — once with every gallery byte refused, once with them served —
 * so the comparison is between two MEASURED states of the same page rather
 * than against any number this file or the stylesheet states. */
async function galleryRowShape(page) {
  await page.locator('.gallery-grid').scrollIntoViewIfNeeded();
  return page.evaluate(() => {
    const round = (value) => Math.round(value * 10) / 10;
    const grid = window.document.querySelector('.gallery-grid').getBoundingClientRect();
    return {
      grid: { width: round(grid.width), height: round(grid.height) },
      /* Each cell relative to the row's own origin, never in viewport
         coordinates: a panel painting elsewhere on the page would move every
         absolute y at once and make this read as a gallery shift it is not. */
      cells: [...window.document.querySelectorAll('.gallery-tile')].filter((cell) => cell.getClientRects().length > 0).map((cell) => {
        const box = cell.getBoundingClientRect();
        return {
          x: round(box.left - grid.left),
          y: round(box.top - grid.top),
          width: round(box.width),
          height: round(box.height),
        };
      }),
    };
  });
}

/* EVERY TILE RESERVES ITS SQUARE BEFORE A BYTE ARRIVES (issue 202, re-aimed
 * by the owner directive of 2026-09-03, issue 287).
 *
 * The gap the #204 adversarial review found (finding 3): the zero-CLS
 * reservation was pinned at source only, and a centring lane survives the
 * naive `justify-self: center` regression because a zero-width box still has
 * two equal gutters. This closes it where the evidence was actually gathered —
 * an ALIGNED grid item is sized by its CONTENT, so with the bytes refused
 * that regression measured 0x0 on Gecko, 194.6x109.4 on Blink and 0x0 on
 * WebKit, none of which equals the served box.
 *
 * There are four boxes to hold now rather than one, and that is a stronger
 * question than the frame's was: a reservation that came from the picture
 * rather than from the track would leave the row shorter, re-flow the cells
 * beside it — all of which this reads, cell by cell, against the page's own
 * other state. */
test('every tile reserves the SAME square with its picture refused as with it served (issue 202; owner 2026-09-03, issue 287)', async ({
  page,
}) => {
  await page.route('**/gallery-*.webp', (route) => route.abort());
  await visit(page);
  const refused = await galleryRowShape(page);
  const drawn = (page.viewportSize()?.width ?? 1280) <= 720 ? 4 : 5;
  expect(refused.cells.length, 'the row drew a different number of cells with the pictures refused').toBe(drawn);
  for (const [index, cell] of refused.cells.entries()) {
    expect(
      cell.width,
      `cell ${index + 1} reserved no width at all with its picture refused`
    ).toBeGreaterThan(0);
    expect(
      cell.height,
      `cell ${index + 1} reserved no height with its picture refused`
    ).toBeGreaterThan(0);
  }

  await page.unroute('**/gallery-*.webp');
  await visit(page);
  const thumbs = page.locator('img.gallery-thumb');
  await page.locator('.gallery-grid').scrollIntoViewIfNeeded();
  await expect
    .poll(
      async () =>
        thumbs.evaluateAll((nodes) => {
          const drawn = nodes.filter((img) => img.getClientRects().length > 0);
          return drawn.length > 0 && drawn.every((img) => img.complete && img.naturalWidth > 0);
        }),
      { message: 'the vendored previews never finished decoding', timeout: 10_000 }
    )
    .toBe(true);
  const served = await galleryRowShape(page);

  expect(
    refused,
    `the row is ${refused.grid.width}x${refused.grid.height} without its pictures and ${served.grid.width}x${served.grid.height} with them — the boxes are not reserved, they are discovered`
  ).toEqual(served);
});

/* THE ROW FOLDS TO TWO ACROSS, AT EVERY WIDTH THIS SITE SUPPORTS (issue 275,
 * re-aimed by the owner directive of 2026-09-03, issue 287, which replaced
 * the position row this lane used to sweep with the grid's own phone form).
 *
 * The claim that survives the ordinal's retirement is the one that was ever
 * about the reader: whatever the gallery draws, it draws it INSIDE the page
 * at every width the contract names, and never takes the document sideways.
 * The phone form adds a second claim of its own — the mock's two tiles across
 * rather than five squeezed ones — and it is measured as the number of
 * distinct column origins the engine actually laid out, which is a fact about
 * the rendered row rather than about the token that produced it. */
test('the gallery row folds to two tiles across on a phone, at every width this site supports (issue 275; owner 2026-09-03, issue 287)', async ({
  page,
}) => {
  await visit(page);
  for (const width of phoneWidths) {
    await page.setViewportSize({ width, height: 800 });
    await settled(page);
    const row = await page.evaluate(() => {
      const round = (value) => Math.round(value * 100) / 100;
      const root = window.document.documentElement;
      const grid = window.document.querySelector('.gallery-grid').getBoundingClientRect();
      /* The column's CONTENT box, as the desktop lane above measures it
         (owner direction, 2026-10-16: the Keep frames and pads the sheet). */
      const main = window.document.querySelector('main');
      const mainBox = main.getBoundingClientRect();
      const mainStyle = getComputedStyle(main);
      const column = {
        left: mainBox.left + Number.parseFloat(mainStyle.borderLeftWidth) + Number.parseFloat(mainStyle.paddingLeft),
        right: mainBox.right - Number.parseFloat(mainStyle.borderRightWidth) - Number.parseFloat(mainStyle.paddingRight),
      };
      const cells = [...window.document.querySelectorAll('.gallery-tile')].filter((cell) => cell.getClientRects().length > 0).map(
        (cell) => {
          const box = cell.getBoundingClientRect();
          return { x: Math.round(box.x), y: Math.round(box.y), width: round(box.width) };
        }
      );
      const rows = new Map();
      for (const cell of cells) {
        rows.set(cell.y, (rows.get(cell.y) ?? 0) + 1);
      }
      return {
        columns: [...new Set(cells.map((cell) => cell.x))].length,
        perRow: [...rows.values()],
        widths: cells.map((cell) => cell.width),
        right: round(column.right - grid.right),
        left: round(grid.left - column.left),
        documentScrolls: root.scrollWidth > root.clientWidth,
        overflow: root.scrollWidth - root.clientWidth,
      };
    });
    expect(row.columns, `the row draws ${row.columns} columns at ${width}px, not the two the phone form asks for`).toBe(2);
    /* Four of the five tiles in two columns is two full rows: no row holds
       more than two, and no tile stands alone in one (owner, 2026-10-17). */
    expect(row.perRow, `the phone rows hold ${row.perRow.join(', ')} tiles at ${width}px`).toEqual([2, 2]);
    for (const [index, cell] of row.widths.entries()) {
      expect(
        cell,
        `cell ${index + 1} is ${cell}px against cell 1's ${row.widths[0]}px at ${width}px`
      ).toBeCloseTo(row.widths[0], 0);
    }
    expect(row.right, `the row stops ${row.right}px short of the column at ${width}px`).toBeLessThanOrEqual(1);
    expect(row.left, `the row starts ${row.left}px inside the column at ${width}px`).toBeLessThanOrEqual(1);
    expect(
      row.documentScrolls,
      `the page itself scrolls sideways at ${width}px, by ${row.overflow}px; the gallery row took the document with it`
    ).toBe(false);
  }
});

/* THE ENLARGED SURFACE OFFERS A PHONE THE RENDITION IT CAN SEE (issue 241).
 *
 * MEASURED on 0.1.54: the lightbox loaded the 3840px master — 1.8 MiB on the
 * volume's own work — into a 351px box on an iPhone 13 viewport, because the
 * element named one file and no other. The fixture's still publishes a 960px
 * preview and a 3840px full, so the breakpoint under test is the preview's own
 * declared width and nothing this file states. `currentSrc` is what the engine
 * SELECTED, which is decided before a byte is read — the fixture's files 404,
 * and that is not a gap here. */
test('a phone enlarges to the preview and a wide screen to the master (issue 241)', async ({ page }) => {
  await serveGalleryManifest(page);
  await visit(page);
  await page.locator('.gallery-tile[data-gallery-kind="image"]').first().click();
  const enlarged = page.locator('img.gallery-lightbox-image');
  await expect(enlarged).toBeVisible();
  const chosen = await page.evaluate(() => ({
    src: window.document.querySelector('.gallery-lightbox-image').currentSrc,
    viewport: window.innerWidth,
    sources: [...window.document.querySelectorAll('.gallery-lightbox picture source')].map((source) => ({
      media: source.getAttribute('media'),
      srcset: source.getAttribute('srcset'),
    })),
  }));
  expect(chosen.sources.map((source) => source.media)).toEqual(['(max-width: 960px)']);
  expect(chosen.sources[0].srcset).toContain('still-preview.webp');
  if (chosen.viewport <= 960) {
    expect(
      chosen.src,
      `a ${chosen.viewport}px viewport enlarged to ${chosen.src}, which is the master`
    ).toContain('still-preview.webp');
  } else {
    expect(
      chosen.src,
      `a ${chosen.viewport}px viewport enlarged to ${chosen.src}, which is the preview upscaled`
    ).toContain('/gallery/still.webp');
  }
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('two fingers on the artwork can still zoom it (issue 241)', async ({ page }) => {
  /* `touch-action: pan-y` hands the compositor the vertical axis and refuses
     everything else — including the pinch a reader makes to look closer at a
     drawing, on the one element anybody would ever try it on. The artwork
     moved into the dialog with the redesign (owner directive, 2026-09-03,
     issue 287), so the surface under test is the stage inside the OPEN
     lightbox; the claim is unchanged, and so is the reason the value is read
     back off the engine rather than off the stylesheet — an engine that did
     not understand `pinch-zoom` would DROP the declaration, and the base under
     it is what this proves survived either way. */
  await visit(page);
  await page.locator('.gallery-tile[data-gallery-kind="image"]').first().click();
  await expect(page.locator('dialog.gallery-lightbox')).toBeVisible();
  const declared = await page.evaluate(
    () => getComputedStyle(window.document.querySelector('.gallery-stage')).touchAction
  );
  expect(declared, `the stage declares "${declared}", so a pinch on the artwork is refused`).toContain('pinch-zoom');
  expect(declared, 'the stage stopped handing the page its own vertical scrolling').toContain('pan-y');
});

test('the lightbox close mark is small, off the artwork, and still a 44px target (issue 202)', async ({
  page,
}) => {
  await visit(page);
  await page.locator('.gallery-tile[data-gallery-kind="image"]').first().click();
  const dialog = page.locator('dialog.gallery-lightbox');
  await expect(dialog).toBeVisible();

  const observed = await page.evaluate(() => {
    const rect = (node) => {
      const box = node.getBoundingClientRect();
      return { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height };
    };
    const control = window.document.querySelector('.gallery-lightbox-close');
    const mark = window.document.querySelector('.gallery-close-mark');
    const image = window.document.querySelector('.gallery-lightbox-image');
    const dialogNode = window.document.querySelector('dialog.gallery-lightbox');
    return {
      hit: rect(control),
      mark: rect(mark),
      /* The artwork itself is what the mark must stay off, now that the frame
         wrapper it used to be measured against is retired (owner directive,
         2026-09-03, issue 287). It is the tighter of the two comparisons: the
         wrapper carried no band, so the picture's own box IS the box the old
         assertion was really about. */
      image: rect(image),
      controlBackground: getComputedStyle(control).backgroundColor,
      markBackground: getComputedStyle(mark).backgroundColor,
      label: control.getAttribute('aria-label'),
      overflow: {
        inline: dialogNode.scrollWidth - dialogNode.clientWidth,
        block: dialogNode.scrollHeight - dialogNode.clientHeight,
      },
    };
  });

  /* The touch floor survives the shrink: what got smaller is the PAINT, not
     the target. */
  expect(observed.hit.width, 'the close control fell under the touch floor').toBeGreaterThanOrEqual(
    touchFloorPx - subPixel
  );
  expect(observed.hit.height, 'the close control fell under the touch floor').toBeGreaterThanOrEqual(
    touchFloorPx - subPixel
  );
  /* At least half off, measured against the target it sits in — the owner
     asked for "at least 50% smaller" than the 44px disc this replaced. */
  expect(
    observed.mark.width,
    `the visible mark is ${observed.mark.width.toFixed(1)}px inside a ${observed.hit.width.toFixed(1)}px control`
  ).toBeLessThanOrEqual(observed.hit.width / 2 + subPixel);
  expect(observed.mark.height).toBeLessThanOrEqual(observed.hit.height / 2 + subPixel);
  /* And the control itself paints nothing — the disc is gone, not merely
     shrunk behind a smaller one. */
  expect(observed.controlBackground, 'the close control still paints a surface of its own').toMatch(
    /rgba\(0, 0, 0, 0\)|transparent/
  );
  expect(observed.markBackground, 'the mark paints nothing, so there is no close affordance at all').not.toMatch(
    /rgba\(0, 0, 0, 0\)|transparent/
  );

  /* "It pollutes the image" — answered as geometry rather than taste: the
     painted mark's box does not intersect the photograph's box at all. */
  const intersects =
    observed.mark.left < observed.image.right &&
    observed.mark.right > observed.image.left &&
    observed.mark.top < observed.image.bottom &&
    observed.mark.bottom > observed.image.top;
  expect(
    intersects,
    `the close mark (${observed.mark.top.toFixed(1)}-${observed.mark.bottom.toFixed(1)}) overlaps the photograph (${observed.image.top.toFixed(1)}-${observed.image.bottom.toFixed(1)})`
  ).toBe(false);
  // It is at the photograph's TOP-RIGHT, not merely somewhere else.
  expect(observed.mark.bottom).toBeLessThanOrEqual(observed.image.top + subPixel);
  expect(observed.mark.right).toBeGreaterThan(observed.image.left + observed.image.width / 2);

  /* Reserving the lane inside the dialog rather than pushing the control
     outside it is what keeps the dialog from scrolling: a native <dialog> is
     width:fit-content with UA overflow:auto, and the outside placement was
     MEASURED turning it scrollable (scrollWidth 1194 against clientWidth
     1154 at 1280px). */
  expect(observed.overflow.inline, 'the lightbox scrolls sideways').toBeLessThanOrEqual(subPixel);
  expect(observed.overflow.block, 'the lightbox scrolls').toBeLessThanOrEqual(subPixel);
  expect(observed.label).toBe('Close enlarged photograph');
});

test('optional metadata renders what an item has and nothing it has not (issue 202)', async ({ page }) => {
  /* Both shapes are live on this page at once, which is what makes this a
     measurement rather than a demonstration: every bootstrap row carries a
     link (the fixed-seed source SOURCES.md records) and NO row carries a
     title or a description, because nobody has reviewed what a placeholder
     depicts. So the present branch and the absent branch are both exercised
     against the real DOM. */
  await visit(page);
  const grid = page.locator('.gallery-grid');
  await grid.scrollIntoViewIfNeeded();

  /* ABSENT ON THE ROW, and it is the row's whole answer now: the caption lane
     the strip carried is retired with it (owner directive, 2026-09-03, issue
     287), so an item's words reach a reader only on the stage they open. The
     row must therefore carry NO caption surface at all — not an empty one,
     which would charge the page a constant band for nothing (MEASURED at
     +12px of document height for a zero-height box), and not a populated one
     either. The tiles' only text is the label an assistive reader is given. */
  await expect(
    page.locator('.gallery-caption'),
    'a caption band came back onto the tile row'
  ).toHaveCount(0);
  const rowText = await grid.evaluate((node) => {
    const cells = [...node.querySelectorAll('.gallery-tile')];
    return cells.map((cell) => cell.innerText.trim()).join('');
  });
  expect(rowText, 'a tile painted copy of its own').toBe('');

  /* AND THE ROW IS THE LAST THING IN ITS BLOCK. The count above would still
     pass if the gallery had left some other empty box behind it, so the
     geometry says the same thing independently: nothing after the grid takes
     any part in layout — the dialog is `display: none` while closed and
     nothing else may be there. */
  const trailing = await page.evaluate(() => {
    const gridNode = window.document.querySelector('.gallery-grid');
    const block = gridNode.parentElement;
    return {
      blockBottom: block.getBoundingClientRect().bottom,
      gridBottom: gridNode.getBoundingClientRect().bottom,
      inFlowAfter: [...block.children]
        .slice([...block.children].indexOf(gridNode) + 1)
        .filter((node) => window.getComputedStyle(node).display !== 'none')
        .map((node) => node.className.toString()),
    };
  });
  expect(trailing.inFlowAfter, 'the gallery left a box in flow after its row').toEqual([]);
  expect(
    trailing.blockBottom,
    `the gallery block runs ${trailing.blockBottom - trailing.gridBottom}px past its own row`
  ).toBeCloseTo(trailing.gridBottom, 1);

  /* PRESENT ON THE STAGE: the link the manifest gave, and only the link —
     for every one of the eight, not for the one that happens to open first.
     Zero CLS rides along: paging the whole set never moves the row behind the
     scrim, which is what a reader sees the moment they close it. */
  const rowBefore = await galleryRowShape(page);
  await page.locator('.gallery-tile[data-gallery-kind="image"]').first().click();
  await expect(page.locator('dialog.gallery-lightbox')).toBeVisible();
  for (let step = 0; step < 8; step += 1) {
    const meta = await page.evaluate(() => {
      const link = window.document.querySelector('.gallery-meta-link');
      const box = link.getBoundingClientRect();
      return {
        blocks: window.document.querySelectorAll('.gallery-lightbox-meta').length,
        titles: window.document.querySelectorAll('.gallery-meta-title').length,
        texts: window.document.querySelectorAll('.gallery-meta-text').length,
        count: window.document.querySelector('.gallery-count')?.getAttribute('aria-live') ?? null,
        text: link.textContent.trim(),
        href: link.getAttribute('href'),
        target: link.getAttribute('target'),
        rel: link.getAttribute('rel'),
        label: link.getAttribute('aria-label'),
        height: box.height,
        ink: getComputedStyle(link).color,
      };
    });
    const at = `on item ${step + 1}`;
    expect(meta.blocks, `the metadata block did not render ${at}`).toBe(1);
    expect(meta.titles, `a title element rendered for an item with no title ${at}`).toBe(0);
    expect(meta.texts, `a description element rendered for an item with no description ${at}`).toBe(0);
    expect(meta.count, 'the position line stopped announcing itself').toBe('polite');
    expect(meta.text).toBe('Lorem Picsum source');
    expect(meta.href).toMatch(/^https:\/\/picsum\.photos\/seed\/naranjo-gallery-\d{2}\/3840\/2160$/);
    expect(meta.target).toBe('_blank');
    expect(meta.rel, 'the outbound link can reach back into this page').toBe('noopener noreferrer');
    expect(meta.label).toBe('Lorem Picsum source (opens in a new tab)');
    expect(meta.height, `the link is under the touch floor ${at}`).toBeGreaterThanOrEqual(
      touchFloorPx - subPixel
    );
    // It reads against the scrim it sits on, which is near-black in every mode.
    expect(meta.ink).toBe('rgb(255, 255, 255)');
    await goToItem(page, `Photograph ${((step + 1) % 8) + 1} of 8`);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.gallery-lightbox')).not.toBeVisible();
  expect(
    await galleryRowShape(page),
    'paging the whole set through the stage reshaped the row behind it'
  ).toEqual(rowBefore);
});

test('the lightbox also closes on a backdrop click and its own close button', async ({ page }) => {
  await visit(page);
  const dialog = page.locator('dialog.gallery-lightbox');
  const tile = page.locator('.gallery-tile[data-gallery-kind="image"]').first();
  await tile.click();
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Close enlarged photograph' }).click();
  await expect(dialog).not.toBeVisible();

  await tile.click();
  await expect(dialog).toBeVisible();
  // A click on the dialog element itself, outside its content box, is the
  // backdrop — clicking at the very top-left corner of the viewport lands
  // there whatever size the enlarged photograph happens to render at.
  await page.mouse.click(2, 2);
  await expect(dialog).not.toBeVisible();
});

/* A READING MODE REPAINTS THE GALLERY AND MOVES NONE OF IT (owner directive,
 * 2026-09-03, issue 287; the zero-CLS floor of AGENTS.md's "Frontend and UX
 * floors").
 *
 * The page-wide swap lane earlier in this file measures the chrome, the
 * column and the diagram; it does not reach the gallery, and the gallery is
 * exactly where a mode is most tempted to move something — the tiles sit on
 * `--gallery-stage-ground`, which IS one of the tokens the night block
 * overrides. A reading-mode block may declare only custom properties and
 * `color-scheme` (AGENTS.md, "Frontend and UX floors"), which is what makes a
 * zero-CLS swap structural rather than a promise; this lane is what an engine
 * did with that rule, on the one gallery surface whose ground changes with
 * the mode. Since 2026-10-19 the page is the night on every visit and the day
 * is kept behind the root's data-sky (turnScene), so the swap is that palette
 * — night on arrival, day, and back — with the gallery in view. */
test('switching the reading mode repaints the gallery without moving any of it (owner 2026-09-03, issue 287)', async ({
  page,
}) => {
  await visit(page);
  const shape = () =>
    page.evaluate(() => {
      const round = (value) => Math.round(value * 100) / 100;
      const scrollY = window.scrollY;
      const boxed = (node) => {
        const box = node.getBoundingClientRect();
        return [round(box.x), round(box.y + scrollY), round(box.width), round(box.height)];
      };
      const grid = window.document.querySelector('.gallery-grid');
      return {
        grid: boxed(grid),
        cells: [...window.document.querySelectorAll('.gallery-tile')].filter((cell) => cell.getClientRects().length > 0).map(boxed),
        ground: getComputedStyle(window.document.querySelector('.gallery-tile')).backgroundColor,
        scrollY,
        scrollHeight: window.document.documentElement.scrollHeight,
      };
    });

  /* Measured where a reader sees it: the gallery near the top of the
     viewport (readFrom), so the scroll position the swaps are held to is a
     real offset into the document rather than its top. */
  await readFrom(page, '.gallery-grid');
  const before = await shape();
  expect(before.scrollY, 'the page did not scroll to the gallery, so the no-scroll check reads the top').toBeGreaterThan(0);
  expect(before.cells.length, 'the gallery rendered no cells; this lane measures nothing').toBe(
    (page.viewportSize()?.width ?? 1280) <= 720 ? 4 : 5
  );

  /* BOTH scenes, there and back, each compared against the ORIGINAL rather
     than against its predecessor, so a drift that accumulates a fraction at a
     time cannot hide inside a chain of individually equal steps. */
  const grounds = new Map([['arrival', before.ground]]);
  for (const scene of ['day', 'night']) {
    await turnScene(page, scene);
    const after = await shape();
    expect(
      after.scrollY,
      `the turn to ${scene} scrolled the document from ${before.scrollY} to ${after.scrollY}`
    ).toBe(before.scrollY);
    expect(after.grid, `the turn to ${scene} moved or resized the gallery row`).toEqual(before.grid);
    expect(after.cells, `the turn to ${scene} moved a tile under the reader`).toEqual(before.cells);
    expect(after.scrollHeight, `the turn to ${scene} changed the page height`).toBe(before.scrollHeight);
    grounds.set(scene, after.ground);
  }
  /* NON-VACUITY: the scenes really do repaint the tile's own ground, so
     "nothing moved" is a statement about a surface that changed rather than
     about one nothing touched. */
  expect(
    new Set(grounds.values()).size,
    `night and day paint ${new Set(grounds.values()).size} distinct grounds under the tiles`
  ).toBeGreaterThan(1);
  /* And the way back is the page the reader arrived on, not a third paint. */
  expect(grounds.get('night'), 'the way back to night does not paint what the page painted on arrival').toBe(
    before.ground
  );
});

test('the Coding Projects subsection renders no capture-date or no-fetch caption, in the actual DOM (issue 167, Daybreak Blue round 3 finding 4)', async ({
  page,
}) => {
  /* The node-level pin at tests/sections.test.mjs checks the adapter's
     executed props and the binding's source for the removed caption's exact
     spellings. Daybreak Blue proved a source-only pin vacuous against
     indirection: exporting the identical removed sentence as a constant
     from projects.ts and rendering it through a variable left every
     source-text scan green while the caption still reached the page. A
     source scan can only ever see literal bytes;
     it cannot see what actually painted. This lane instead reads the REAL
     RENDERED TEXT of the Coding Projects subsection after a real navigation
     — robust against ANY indirection technique, because it is checking the
     one thing that cannot be laundered through a constant, a snippet, or a
     second component: what a visitor's browser actually put on the screen. */
  await visit(page);

  /* Anchored on the block itself, not on a subsection heading: it declares no
     heading since the owner's clean-Projects ruling (2026-08-31, issue 275
     wave), so there is no wrapper and no h3 to filter by. The feed became a
     ruled table on 2026-09-03 (issue 287); the scope is the panel that holds
     it, which is what a reader sees under the section head. */
  const codingProjects = page.locator('#projects .panel-shell');
  await expect(codingProjects, 'the Coding Projects block is not on the page at all').toHaveCount(1);

  const text = await codingProjects.innerText();

  /* Sanity: the scope itself must be real content, not an empty shell that
     would make the negative assertions below trivially true. Measured as rows
     rather than as one named repository, because the roster is truncated to
     the latest few (owner ruling, 2026-09-03) and which repositories those are
     changes with every push — a lane naming one of them would go red on an
     ordinary day's work with nothing wrong with the page. */
  expect(text.length, 'the Coding Projects subsection rendered no text at all').toBeGreaterThan(0);
  /* The rows are the Ongoing Work entries since the table retired (owner
     direction, 2026-10-16). */
  await expect(
    page.locator('#projects .repo-entry'),
    'the project rows are missing from the rendered subsection'
  ).not.toHaveCount(0);

  /* Both halves of the removed caption, checked independently exactly like
     the source-text pin does, but against RENDERED text this time. */
  expect(text, 'the rendered DOM still shows the capture-date caption').not.toMatch(
    /Counts captured from/
  );
  expect(text, 'the rendered DOM still shows the no-fetch caption').not.toMatch(/fetches nothing/);

  /* The clean-Projects ruling, measured. The Media block moved to a section of
     its own on 2026-09-03 (issue 287), so #projects now holds exactly one
     block and no subsection heading at all — a revived 'Coding Projects' h3
     would show up here as a count of one. The section still names itself
     through the ledger's own head, which is what a reader navigates by, so
     that is asserted alongside rather than left implicit. */
  await expect(
    page.locator('#projects h3.subsection-title'),
    'a subsection heading came back under Projects'
  ).toHaveCount(0);
  await expect(
    page.locator('#projects .section-head .section-title'),
    'the Projects section stopped naming itself'
  ).toHaveText('Ongoing Work'); // owner direction, 2026-10-16; the id stays `projects`
});

/* THE HEAD ROW IS THE RESERVE WITHOUT A TITLE (owner directive, 2026-09-04,
 * issue 292), AND NOW WITHOUT ANYTHING IN IT AT ALL (2026-09-12, issue 323).
 *
 * Most panels render no label, and their heads used to hold the data-through
 * line when there was one. The owner removed that line from every head, so
 * most heads are empty boxes — and a row whose height came from its contents
 * would now be nothing at all, which is the zero-CLS floor breaking in the one
 * row the shell keeps open for a later arrival. Measured rather than trusted:
 * every bare head is exactly as tall as every titled head on the page, and no
 * head anywhere carries a freshness line. Review finding 1 on PR #293 showed
 * the declaration could be deleted with every suite green; the source pin in
 * tests/sections.test.mjs and this lane are the two halves that close it.
 *
 * RE-AIMED 2026-10-16 (owner direction: the redesign). No panel on the page
 * carries a title any more, so there is no titled head left to read the
 * reserve off — and a lane that skipped for want of one would be green for a
 * page whose bare heads had collapsed to nothing. The reference is BUILT
 * instead: a copy of a real head, in the same shell and under the same
 * component scope, given the title the shell would render, measured, and
 * removed. And THE KEEP hides the trackers' heads outright (`display: none`,
 * the board is one framed diagram with no head row): a head that is never
 * drawn reserves nothing and receives nothing, so it is the one named
 * exemption — asserted by place and count, so a head hidden anywhere else
 * still fails. */
test('a panel head with no title keeps the reserved row, and no head draws a freshness line (issues 292, 323)', async ({
  page,
}) => {
  await visit(page);
  const measured = await page.evaluate(() => {
    const heads = [...window.document.querySelectorAll('.panel-head')];
    const height = (head) => head.getBoundingClientRect().height;
    const drawn = heads.filter((head) => getComputedStyle(head).display !== 'none');
    const hidden = heads.filter((head) => getComputedStyle(head).display === 'none');
    const titled = drawn.filter((head) => head.querySelector('.panel-title') !== null);
    const bare = drawn.filter((head) => head.querySelector('.panel-title') === null);
    /* The titled reference: the first drawn head, copied beside itself with
       the h2 the shell renders for a title, wearing the component's own
       scoped class so the copy is styled exactly as a real title would be. */
    const references = [];
    if (bare.length > 0) {
      const original = bare[0];
      const scope = [...original.classList].find((name) => name.startsWith('svelte-')) ?? '';
      const copy = original.cloneNode(false);
      const title = window.document.createElement('h2');
      title.className = `panel-title ${scope}`.trim();
      title.textContent = 'Reference title';
      copy.appendChild(title);
      original.after(copy);
      references.push(height(copy));
      copy.remove();
    }
    return {
      titled: [...titled.map(height), ...references],
      bare: bare.map(height),
      bareSections: bare.map((head) => head.closest('.page-section')?.id ?? null),
      hiddenSections: hidden.map((head) => head.closest('.page-section')?.id ?? null),
      notes: window.document.querySelectorAll('[data-panel-note], .panel-note').length,
      statuses: [...window.document.querySelectorAll('.panel-shell')].map((shell) =>
        shell.getAttribute('data-panel-status')
      ),
    };
  });
  expect(measured.titled.length, 'no titled panel head to measure the reserve against').toBeGreaterThan(0);
  /* One drawn bare head now: Ongoing Work's (issue 292). The diagram and the
     ticker share the trackers board, whose heads THE KEEP does not draw at
     all (2026-10-16) — the exemption, by place and by count. */
  expect(measured.bareSections, 'the drawn heads without a label are not exactly Ongoing Work').toEqual([
    'projects',
  ]);
  expect(
    measured.hiddenSections,
    'a head is hidden somewhere other than the trackers board'
  ).toEqual(['trackers', 'trackers']);
  const reserve = measured.titled[0];
  for (const height of measured.titled) {
    expect(height, 'titled heads disagree about the row height').toBeCloseTo(reserve, 1);
  }
  for (const height of measured.bare) {
    expect(height, 'a head with no title is not as tall as one with').toBeCloseTo(reserve, 1);
  }
  /* NO HEAD DRAWS A FRESHNESS LINE, and the reading it carried is still on the
     page as data — which is the whole of what issue 323 removed and the whole
     of what it kept. */
  expect(measured.notes, 'a panel head draws a freshness line again').toBe(0);
  expect(
    measured.statuses.filter((status) => status !== null).length,
    'panels stopped publishing their own status'
  ).toBe(measured.statuses.length);
});

/* THE PHONE CHROME AND THE MASTHEAD (owner directives, 2026-09-04, issue 294),
 * measured in every project so the phone viewports prove the same things the
 * desktop one does:
 *  - the name breaks after its first word at every width — two lines, counted
 *    as the distinct rows its text is drawn on (each word is its own line
 *    since 2026-10-20, when J became the dot of its j, so the heading's first
 *    text is one word and no longer the whole name);
 *  - (the chrome row's one rule and its reserve were measured here until the
 *    row was removed — owner direction, 2026-10-16: "do away with it for
 *    now"; and the rule drawn under the name, until THE KEEP set the name as
 *    a centred plaque with no rule under it the same day — their subjects are
 *    gone, so they are);
 *  - the roll opens on its first token source, in the source vocabulary's
 *    order, with any source the vocabulary does not name after those in the
 *    payload's order and the contributions last (owner, 2026-10-21, issue
 *    385: "put Codex tokens the first thing that renders on the website, the
 *    order should be codex, then claude then contributions"; this replaces
 *    both the 2026-10-16 direction that the contributions open it and the
 *    2026-09-04 rule that the busiest source does), each seal carries its own figures — the same
 *    number of them on every seal, so a change of seal moves nothing, and a
 *    token count only on a token seal, named for its own source (the
 *    owner's answer the same day: the figures "follow the picked seal") —
 *    and the diagram wears no panel label;
 *  - the browser's chrome is told the sheet's colour, once, at hydration (it
 *    was told again whenever the scene turned, while a control could turn it);
 *  - the document root no longer refuses the native overscroll (the pull
 *    gesture that needed that refusal is gone, owner ruling, same issue). */
test('the name is two lines, the roll opens on its first token source with the contributions last, and the toolbars wear the sheet (issue 294; 2026-10-16; issue 385, 2026-10-21)', async ({
  page,
}) => {
  /* The rows the name's own text is drawn on, J's picture aside. */
  await page.addInitScript(() => {
    window.nameRows = () => {
      const heading = window.document.querySelector('h1');
      const rows = new Set();
      const walker = window.document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.parentElement?.closest('.page-j') !== null) continue;
        const range = window.document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width > 0) rows.add(Math.round(rect.top));
        }
      }
      return rows.size;
    };
  });
  await visit(page);
  await expect(page.locator('.chronicle-layers button').first()).toBeAttached();
  const observed = await page.evaluate(async () => {
    const heading = window.document.querySelector('h1');
    const lines = window.nameRows();
    const main = window.document.querySelector('main').getBoundingClientRect();
    const diagram = window.document.querySelector('.chronicle').closest('.panel-shell');
    const layers = [...diagram.querySelectorAll('.chronicle-layers button')].map((node) => ({
      text: node.textContent.trim(),
      pressed: node.getAttribute('aria-pressed') === 'true',
    }));
    /* Every source with a series, in the payload's order, read from the
       payload the diagram reads. */
    const envelope = await (await fetch('/api/panels/token-usage')).json();
    const reporting = (envelope?.data?.sources ?? [])
      .filter((source) => Array.isArray(source?.series?.totals) && source.series.totals.length > 0)
      .map((source) => source.label);
    const surface = getComputedStyle(window.document.documentElement).getPropertyValue('--color-surface').trim();
    return {
      heading: heading.textContent.trim(),
      lines,
      headingWidth: heading.getBoundingClientRect().width,
      mainWidth: main.width,
      layers,
      reporting,
      diagramLabel: diagram.querySelector('.panel-title')?.textContent ?? null,
      surface,
      themeColor: window.document.head.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
      overscroll: {
        html: getComputedStyle(window.document.documentElement).overscrollBehaviorY,
        body: getComputedStyle(window.document.body).overscrollBehaviorY,
      },
      pullSurface: window.document.querySelector('.pull-indicator, .pull-control') !== null,
    };
  });
  expect(observed.heading).toBe('Samuel Naranjo');
  expect(observed.lines, 'the name is not set on exactly two lines').toBe(2);
  expect(observed.headingWidth, 'the heading box is not its longest word').toBeLessThan(observed.mainWidth);
  /* The two lines are the RULE, not the viewport's accident: at this
     project's own width the name may wrap on its own, so the count is taken
     again on a monitor wide enough for the whole name to fit on one line —
     where only the min-content box keeps the break — and then at a phone. */
  const before = page.viewportSize();
  const linesAt = async (width, height) => {
    await page.setViewportSize({ width, height });
    return page.evaluate(() => window.nameRows());
  };
  expect(await linesAt(1920, 1080), 'on a wide monitor the name runs on one line').toBe(2);
  expect(await linesAt(390, 844), 'on a phone the name is not two lines').toBe(2);
  await page.setViewportSize(before);
  expect(observed.layers.length, 'fewer than two calendar layers to order').toBeGreaterThan(1);
  /* The order the seals must run in: the sources the vocabulary names, in its
     order, then any other in the payload's, then the contributions. */
  const named = sourceVocabulary.sources.map((entry) => entry.key);
  const order = [
    ...named.filter((key) => observed.reporting.includes(key)),
    ...observed.reporting.filter((label) => !named.includes(label)),
  ];
  expect(order.length, 'no source reports a series to lead the token layers').toBeGreaterThan(0);
  expect(observed.layers[0].text, "the roll does not open on the vocabulary's first reporting source").toBe(sourceName(order[0]));
  expect(observed.layers[0].pressed, 'the roll does not open on its first seal').toBe(true);
  expect(
    observed.layers.slice(1).every((layer) => !layer.pressed),
    'more than one layer is pressed at once'
  ).toBe(true);
  expect(observed.layers.at(-1).text, 'the contributions are not the last seal').toBe('Contributions');
  expect(
    observed.layers.map((layer) => layer.text),
    'the seals do not run the vocabulary\u2019s order, then any other source, then the contributions'
  ).toEqual([...order.map(sourceName), 'Contributions']);

  /* THE FIGURES FOLLOW THE PICKED SEAL. Each seal is pressed in turn, by a
     script that moves nothing, and read: every seal carries as many figures
     as the one the roll opens on, a token seal's first is its own source's
     tokens, and the contributions' seal claims no token count at all. */
  const seals = page.locator('.chronicle-layers button');
  const carried = [];
  for (let index = 0; index < observed.layers.length; index += 1) {
    await seals.nth(index).evaluate((button) => button.click());
    await expect(seals.nth(index)).toHaveAttribute('aria-pressed', 'true');
    carried.push({
      seal: observed.layers[index].text,
      labels: (await page.locator('.chronicle-headline .chronicle-label').allTextContents()).map((text) => text.trim()),
    });
  }
  expect(carried[0].labels.length, 'the seal the roll opens on carries no figures').toBeGreaterThan(0);
  for (const { seal, labels } of carried) {
    expect(labels.length, `the "${seal}" seal carries ${labels.length} figures and the first carries ${carried[0].labels.length}`).toBe(
      carried[0].labels.length
    );
    const tokens = labels.filter((label) => /token/i.test(label));
    if (seal === 'Contributions') {
      expect(tokens, 'the contributions\u2019 seal claims a token count').toEqual([]);
    } else {
      expect(tokens, `the "${seal}" seal does not carry exactly one token figure, its own source's`).toHaveLength(1);
      expect(tokens[0].startsWith(`${seal} `), `the "${seal}" seal's token figure is "${tokens[0]}"`).toBe(true);
    }
  }
  expect(observed.diagramLabel, 'the diagram wears a panel label').toBeNull();
  expect(observed.overscroll.html, 'the root still refuses the native overscroll').toBe('auto');
  expect(observed.overscroll.body, 'the body still refuses the native overscroll').toBe('auto');
  expect(observed.pullSurface, 'the retired pull surface is back in the document').toBe(false);
  expect(observed.surface, 'the sheet token is unreadable').not.toBe('');
  expect(observed.themeColor, 'the toolbars were not told the sheet colour').toBe(observed.surface);

  /* The toolbars are told once, at hydration (App.svelte), and the night is
     every visit's scene, so that one telling is the whole contract now. The
     half that held them following a turn of the scene went with the control
     that turned it (owner, 2026-10-19: "do away with this all together but
     keep the logic"); what the kept day palette does to them is the scene
     lane's to state. */
});

/* THE REPOSITORIES, MEASURED (issue 188; owner sketch 2026-08-31; the ruled
 * table of issue 287; RESHAPED by the owner's direction of 2026-10-16 into
 * Ongoing Work's two-line entries: "show 1 less entry per but give more
 * information and make it more readable").
 *
 * Every claim that was ever about the READER rather than the markup is
 * re-measured against the entries:
 *
 *   - the roster is the owner's pinned set and nothing outside it, cut to the
 *     five entries the column holds, most recently pushed first;
 *   - on a wide sheet the figures sit beside the name and end at the entry's
 *     own end edge (the no-dead-space rule at 1440px), and the name never runs
 *     under them;
 *   - every column of figures starts at the same x in every entry (the
 *     2026-08-29 cross-row alignment ruling);
 *   - on a phone the figures take a line of their own under the name and
 *     description, all four on that one line, in order, from the entry's own
 *     start edge — and nothing takes the document sideways. */
test('the repositories are one ruled entry each, aligned across entries, and they restack on a phone (issue 188; owner 2026-09-03, issue 287; 2026-09-12; 2026-10-16)', async ({
  page,
}) => {
  await visit(page);
  const entries = page.locator('#projects .repo-entry');
  const count = await entries.count();
  expect(count, 'the repositories column rendered no entries').toBeGreaterThan(1);

  /* THE ROSTER IS SELECTED, NOT TRUNCATED (owner ruling, 2026-09-12: "remove
     latest, this makes no sense"), and cut at the column's five (owner
     direction, 2026-10-16). The bound is read from the origin's own envelope
     rather than typed here. */
  const roster = await page.evaluate(async () => {
    const response = await fetch('/api/panels/coding-projects');
    const envelope = await response.json();
    const repos = Array.isArray(envelope?.data?.repos) ? envelope.data.repos : null;
    if (repos === null) return null;
    const instant = (repo) => Date.parse(repo.pushedAt ?? '') || 0;
    const ordered = [...repos].sort((left, right) => instant(right) - instant(left));
    return {
      total: repos.length,
      pinned: ordered.filter((repo) => repo.pinned === true).map((repo) => repo.name),
      newestUnpinned: ordered.find((repo) => repo.pinned !== true)?.name ?? null,
    };
  });
  expect(roster, 'the origin served no roster to bound the column against').not.toBeNull();
  expect(roster.pinned.length, 'the served roster flags no pinned repositories at all').toBeGreaterThan(0);
  expect(roster.newestUnpinned, 'the served roster is entirely pinned, so "nothing outside the set" has no subject').not.toBeNull();
  const shown = roster.pinned.slice(0, 5);
  expect(count, `the column drew ${count} entries of a ${roster.total}-repository roster`).toBe(shown.length);
  const drawnNames = await entries.locator('.repo-name').allTextContents();
  expect(drawnNames.map((name) => name.trim()), 'the column is not the most recently pushed of the pinned set, in push order').toEqual(shown);
  expect(drawnNames, `the newest unpinned repository (${roster.newestUnpinned}) is in the column`).not.toContain(
    roster.newestUnpinned
  );

  const overlapsVertically = (first, second) => first.y < second.y + second.height && second.y < first.y + first.height;
  const measure = async () => {
    const shape = [];
    for (let index = 0; index < count; index += 1) {
      const entry = entries.nth(index);
      const box = await entry.boundingBox();
      const name = await entry.locator('.repo-name').boundingBox();
      const figures = [];
      const figureCount = await entry.locator('.repo-figure').count();
      for (let figure = 0; figure < figureCount; figure += 1) {
        figures.push(await entry.locator('.repo-figure').nth(figure).boundingBox());
      }
      expect(box, `entry ${index} never rendered a box`).not.toBeNull();
      expect(name, `entry ${index}'s name never rendered a box`).not.toBeNull();
      shape.push({ box, name, figures });
    }
    return shape;
  };

  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    const shape = await measure();
    for (const [index, entry] of shape.entries()) {
      /* FOUR figures since issue #317: pull requests closed, the released
         version, stars, and the age. */
      expect(entry.figures.length, `at ${width}px entry ${index} lost a figure`).toBe(4);
      for (const [figure, box] of entry.figures.entries()) {
        expect(overlapsVertically(entry.name, box), `at ${width}px entry ${index}'s figure ${figure} dropped off the name's line`).toBe(true);
      }
      const end = entry.box.x + entry.box.width;
      const last = entry.figures.at(-1);
      expect(
        last.x + last.width,
        `at ${width}px entry ${index}'s last figure ends ${(end - last.x - last.width).toFixed(1)}px short of its end edge`
      ).toBeGreaterThanOrEqual(end - 8);
      expect(entry.name.x + entry.name.width, `at ${width}px entry ${index}'s name runs under its figures`).toBeLessThanOrEqual(
        entry.figures[0].x + 1
      );
      expect(entry.name.x, `at ${width}px entry ${index}'s name is at a different x than entry 0's`).toBeCloseTo(shape[0].name.x, 0);
      for (const [figure, box] of entry.figures.entries()) {
        expect(box.x, `at ${width}px entry ${index}'s figure ${figure} is at a different x than entry 0's`).toBeCloseTo(
          shape[0].figures[figure].x,
          0
        );
      }
    }
  }

  for (const width of [320, 375, 412]) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    const shape = await measure();
    const document = await page.evaluate(() => ({
      scrollWidth: window.document.documentElement.scrollWidth,
      clientWidth: window.document.documentElement.clientWidth,
    }));
    expect(
      document.scrollWidth,
      `at ${width}px the repositories took the document sideways (${document.scrollWidth} > ${document.clientWidth})`
    ).toBeLessThanOrEqual(document.clientWidth + subPixel);
    for (const [index, entry] of shape.entries()) {
      expect(entry.figures.length, `at ${width}px entry ${index} lost a figure`).toBe(4);
      expect(
        overlapsVertically(entry.name, entry.figures[0]),
        `at ${width}px entry ${index} did not restack; its figures are still beside its name`
      ).toBe(false);
      for (const cell of [1, 2, 3]) {
        expect(
          overlapsVertically(entry.figures[0], entry.figures[cell]),
          `at ${width}px entry ${index}'s figure ${cell} left the figures' line`
        ).toBe(true);
        expect(
          entry.figures[cell].x,
          `at ${width}px entry ${index}'s figure ${cell} is drawn on top of figure ${cell - 1}`
        ).toBeGreaterThan(entry.figures[cell - 1].x + entry.figures[cell - 1].width - 1);
      }
      expect(entry.figures[0].x, `at ${width}px entry ${index}'s figures do not start at its own edge`).toBeCloseTo(entry.box.x, 0);
      expect(entry.box.x + entry.box.width, `at ${width}px entry ${index} runs past the viewport`).toBeLessThanOrEqual(
        document.clientWidth + subPixel
      );
    }
  }
});

/* RETIRED 2026-10-16 WITH THE STRIP: "the weekday gutter stays visually
 * stationary while the strip scrolls under it" (issue 189). Its subject was a
 * Mon/Wed/Fri gutter beside a heatmap strip that scrolled sideways under it.
 * The trackers' calendar draws as many whole weeks as its box holds and never
 * scrolls (owner direction, 2026-10-16), and it prints no weekday gutter, so
 * there is nothing left to scroll and nothing beside it to hold still. */

/* A DAY IS NAMED IN WORDS, NEVER IN THE MACHINE'S DATE (issue 189's period
 * phrase, issue 178's format floor; re-aimed 2026-10-16 from the token
 * calendar's detail card to the trackers' one diagram, whose figures name the
 * day a reader points at). Read in a real engine, on a real day, from both
 * surfaces a reader points with: the graph, and the calendar under it. What
 * survives from #178 is the FORMAT floor — never the raw ISO date the payload
 * carries — and from the owner's 2026-09-12 caption ruling (issue 323) that no
 * sentence under the calendar restates the reading. */
test('a day the reader points at is named in words, never as a raw ISO date (issues 178, 189, 323; 2026-10-16)', async ({
  page,
}) => {
  await visit(page);
  test.skip(!(await followsPointer(page)), 'no fine pointer here; the tap lanes name a day for a finger');
  const chart = page.locator('.chronicle-chart');
  await chart.scrollIntoViewIfNeeded();
  await diagramAtRest(page);
  /* A headline that reads days: the token one (the pull requests have no
     daily record, so their caption stays whole while a day is read). */
  const caption = tokenHeadline(page).locator('.chronicle-caption');
  const read = async () => ({
    caption: (await caption.textContent()).trim(),
    stamp: (await page.locator('.chronicle-stamp').count()) === 1 ? (await page.locator('.chronicle-stamp').textContent()).trim() : null,
    valuetext: (await chart.getAttribute('aria-valuetext')) ?? '',
  });
  const human = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;
  const iso = /\d{4}-\d{2}-\d{2}/;

  const box = await chart.boundingBox();
  await page.mouse.move(0, 0);
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  await expect(chart).toHaveAttribute('data-scrubbing', 'true');
  const graph = await read();
  /* The reading over the cursor is "<reading> · <day>" (owner direction,
     2026-10-16): the DAY is its last part, and that part is in words. */
  const named = graph.stamp?.split(' · ').at(-1) ?? null;
  expect(graph.stamp, `the graph's reading "${graph.stamp}" names no day after its figure`).toMatch(/ · /);
  expect(named, `the graph names its day as "${named}"`).toMatch(human);
  expect(graph.stamp, `the graph's reading "${graph.stamp}" carries the machine's date`).not.toMatch(iso);
  expect(graph.caption, 'the figures do not name the day the graph names').toBe(named);
  expect(graph.valuetext, `the graph announces "${graph.valuetext}"`).not.toMatch(iso);

  /* The calendar names the same way. */
  const cell = page.locator('.chronicle-cell[data-measured="true"]').first();
  const cellBox = await cell.boundingBox();
  await page.mouse.move(0, 0);
  await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2);
  await expect(cell, 'pointing at a calendar day picked no day').toHaveAttribute('data-picked', 'true');
  const calendar = await read();
  expect(calendar.caption, `the calendar names its day as "${calendar.caption}"`).toMatch(human);
  expect(calendar.caption, 'the calendar named a day in the machine’s format').not.toMatch(iso);
  await page.mouse.move(0, 0);

  /* AND THERE IS NO SENTENCE UNDER THE CALENDAR (issue 323): the diagram's
     own paragraphs, if any, carry none of the retired reading sentence. */
  const sentences = await page.evaluate(() =>
    [...window.document.querySelectorAll('.chronicle p')].map((node) => node.textContent.trim())
  );
  expect(
    sentences.filter((line) => /tokens over|peak |data through/.test(line)),
    `the retired reading sentence is on the page again: ${sentences.join(' | ')}`
  ).toHaveLength(0);
});

/* ===========================================================================
 * The hover detail (owner directive, 2026-08-24)
 *
 * Two complaints, one root fix. The detail "spawns anchored to its grid cell",
 * so hovering a tile near the end of a row put the readout a full row away
 * from the cursor — "confusing and weird" — and the skill tiles never got the
 * designed readout at all, only the browser's own `title=` tooltip. There is
 * one primitive now, both grids render it, and on a pointer that HAS a cursor
 * it follows one.
 *
 * These lanes measure the part no source pin can: what an engine did with it.
 * The distances below are taken from the SYNTHETIC POINTER POSITION rather
 * than from the tile, because the reported defect was a distance from the
 * pointer — a suite that measures a tile can watch the box land a row away
 * and call it correct. The arithmetic those distances come from is executed
 * separately in tests/tooltip.test.mjs; neither half replaces the other.
 * ======================================================================== */

/* The two placement tokens, read from the page. The lanes measure against the
   same numbers the primitive places by, so retuning the feel from the token
   layer retunes the assertions with it instead of breaking them. */
async function tipTokens(page) {
  return page.evaluate(() => {
    const style = getComputedStyle(window.document.documentElement);
    const px = (name) => Number(style.getPropertyValue(name).trim().replace('px', ''));
    return { gap: px('--tip-pointer-gap'), margin: px('--tip-edge-margin') };
  });
}

/* Whether THIS engine, at THIS viewport, reports a pointer worth following.
   The capability, never the project name: a lane that branched on which
   browser it is would be asserting the configuration rather than the page. */
const followsPointer = (page) =>
  page.evaluate(() => window.matchMedia('(hover: hover) and (pointer: fine)').matches);

/* One tile's detail, measured where the engine actually put it. */
function detailBox(page, selector, index) {
  return page.evaluate(
    ([css, at]) => {
      const cell = window.document.querySelectorAll(css)[at];
      /* The detail is a child of its own figure in the per-element form, and
         ONE detail for the whole band in the region form, rendered beside the
         band outside its moving run, so the card is the host that holds it. */
      const node = cell.querySelector('.cell-tip') ?? cell.closest('.feed-card')?.querySelector('.cell-tip');
      const box = node.getBoundingClientRect();
      const tile = cell.getBoundingClientRect();
      const root = window.document.documentElement;
      const style = getComputedStyle(node);
      /* Hit-testing the box's own centre. A detail that follows the cursor is
         the one element on the page that must be transparent to it: one that
         could be hovered would take the pointer off the tile that opened it,
         close itself, and hand the pointer back — forever. */
      const under = window.document.elementFromPoint(
        Math.round(box.left + box.width / 2),
        Math.round(box.top + box.height / 2)
      );
      return {
        open: node.getAttribute('data-tip-open'),
        visibility: style.visibility,
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
        text: node.textContent.replace(/\s+/g, ' ').trim(),
        catchesPointer: under === node || node.contains(under),
        tile: { left: tile.left, top: tile.top, right: tile.right, bottom: tile.bottom },
        viewport: { width: root.clientWidth, height: root.clientHeight },
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
      };
    },
    [selector, index]
  );
}

/* THE TWO HOSTS THIS BATTERY MEASURES (owner directive, 2026-09-03, issue
   287; re-aimed 2026-10-16). The point of measuring two was never that there
   were two grids — it was the owner's complaint that only one of them had a
   designed readout, so identical measurement on two hosts is what "aligned"
   means once ONE component renders them all. The pair exercises the
   primitive's TWO WIRING FORMS rather than one form twice:

     - the REGION form, where a single detail serves a whole surface and a
       resolver says which item a point names. Its host was the contribution
       calendar; the calendar became the trackers' diagram, which names a day
       in its own figures instead of a detail (owner direction, 2026-10-16), so
       the region form's host is the boss ticker now — one detail for the whole
       band, rendered outside its moving run;
     - the PER-ELEMENT form, where the detail describes its own parent: a
       repository's figure in Ongoing Work, which took over from the retired
       table's counter.

   THE BAND IS STOPPED for every lane that points at it, exactly as the
   hostile-name lane below stops it: its items travel while it runs, so
   nothing can be put under a pointer, and stopping it is a state the owner
   named — under reduced motion the band is a scroller a reader pans, and
   every item is a target. The detail itself has no motion of its own, so
   nothing it is measured for changes with the preference. */
const tickerItem = '.ticker-lane:not([aria-hidden="true"]) .ticker-item';
const repoFigure = '#projects .repo-figure';

/* A tile's box once it has STOPPED MOVING. Some of the placements below need
   a tile at a specific edge of the screen, which means scrolling the page by
   hand — and a hand-rolled scroll is where the engines stop agreeing. WebKit
   scrolls asynchronously: window.scrollBy updates the document's scroll
   position immediately while the visual viewport settles a frame later, so a
   rect read straight afterwards can be a frame stale, and a synthetic pointer
   aimed at it lands on the neighbouring tile and enters nothing at all.
   (MEASURED: one run in roughly three, WebKit only, and only on the
   hand-scrolled cases — Playwright's own scrollIntoViewIfNeeded already waits
   for this.) Polling for two agreeing frames is the wait that ends when the
   page is actually still. */
async function settledBox(page, locator) {
  let previous = null;
  await expect
    .poll(
      async () => {
        await page.evaluate(() => new Promise((frame) => requestAnimationFrame(frame)));
        const box = await locator.boundingBox();
        const still =
          previous !== null &&
          Math.abs(box.x - previous.x) < subPixel &&
          Math.abs(box.y - previous.y) < subPixel;
        previous = box;
        return still;
      },
      { message: 'the tile never stopped moving', timeout: 5_000 }
    )
    .toBe(true);
  return previous;
}

/* Open the REGION detail, whichever way this device can. The region form takes
   its content from the item being pointed at, so a lane that needs the box to
   hold something has to put an item under a pointer or a finger first. Both
   routes are here because this matrix runs three desktop projects and two
   phone ones, and the detail is meant to work on all five. The band must be
   stopped first (see the hosts above). */
async function openRegionDetail(page) {
  const item = page.locator(tickerItem).nth(2);
  await item.scrollIntoViewIfNeeded();
  if (await followsPointer(page)) {
    const box = await item.boundingBox();
    await page.mouse.move(0, 0);
    await page.mouse.move(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
  } else {
    await item.tap();
  }
  await expect(page.locator('.ticker-strip').locator('xpath=..').locator('.cell-tip')).toHaveAttribute(
    'data-tip-open',
    'true'
  );
  return true;
}

/* Put a tile under the pointer and return where the pointer went. Playwright's
   own hover() aims at a tile's centre; several assertions below need a
   specific corner of one, so the move is explicit. */
async function hoverAt(page, selector, index, place) {
  const tile = page.locator(selector).nth(index);
  await tile.scrollIntoViewIfNeeded();
  const box = await tile.boundingBox();
  const at = place(box);
  /* Leave whatever the pointer was on first. A detail opens on the ENTER,
     and an engine sends no enter for a pointer that is already inside the
     element — so a lane that moved straight from one measurement to the next
     could be reading a tile it never actually entered. (MEASURED: WebKit at
     390px, where the second viewport in a sweep put the cursor inside the
     same tile it had just left.) */
  await page.mouse.move(0, 0);
  await page.mouse.move(at.x, at.y);
  return at;
}

test('the detail opens beside the cursor, follows it, and never catches it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await visit(page);
  test.skip(!(await followsPointer(page)), 'no fine pointer here; the anchored branch is measured below');
  const { gap } = await tipTokens(page);

  /* Both grids, because the owner's second complaint was that only one of
     them had a designed readout. Identical measurement, identical result, is
     what "aligned" means once one component renders both. */
  for (const [selector, index] of [
    [tickerItem, 3],
    [repoFigure, 0],
  ]) {
    const at = await hoverAt(page, selector, index, (box) => ({
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    }));
    const shown = await detailBox(page, selector, index);
    expect(shown.open, `${selector} did not open its detail on hover`).toBe('true');
    expect(shown.visibility, `${selector} opened an invisible detail`).toBe('visible');
    expect(shown.height, `${selector} rendered a detail with no height`).toBeGreaterThan(0);
    /* THE measurement. One gap from the pointer on both axes — not from the
       tile, not from the column, not from the row. */
    expect(shown.left - at.x, `${selector}: the detail is ${shown.left - at.x}px from the pointer`).toBeCloseTo(gap, 0);
    expect(shown.top - at.y, `${selector}: the detail is ${shown.top - at.y}px below the pointer`).toBeCloseTo(gap, 0);
    /* And the same fact stated the way the defect was reported, so the
       regression is legible rather than arithmetic: the box opens a gap's
       reach from the cursor and no further.

       The bound used to be the TILE's own height, which meant something when a
       tile was a 44px stat square and means nothing against a 10px calendar
       cell (owner directive, 2026-09-03, issue 287: those grids are retired).
       It is the exact diagonal of the two gaps instead — which is STRICTER
       than the height it replaces, not looser: a placement that drifted by a
       few pixels on either axis passed "less than a row" and fails this. */
    const away = Math.hypot(shown.left - at.x, shown.top - at.y);
    expect(
      away,
      `${selector}: the detail opened ${Math.round(away)}px from the cursor, not the ${Math.round(Math.hypot(gap, gap))}px its own gap allows`
    ).toBeCloseTo(Math.hypot(gap, gap), 0);
    expect(shown.catchesPointer, `${selector}: the detail can receive the pointer, so it will flicker`).toBe(false);
  }

  /* The hybrid case, which no project in this matrix is: a machine that
     answers the media query as a fine pointer AND has a touchscreen. A
     finger there must not open a box that then tries to follow a cursor
     nobody is holding, and the EVENT is what knows it was a finger. Synthetic
     because it is the only way to ask this engine that question. */
  await page.mouse.move(0, 0);
  const finger = await page.evaluate(async ([css, at]) => {
    const cell = window.document.querySelectorAll(css)[at];
    /* The detail is a child of its own figure in the per-element form, and
       ONE detail for the whole band in the region form, rendered beside the
       band outside its moving run, so the card is the host that holds it. */
    const node = cell.querySelector('.cell-tip') ?? cell.closest('.feed-card')?.querySelector('.cell-tip');
    const box = cell.getBoundingClientRect();
    cell.dispatchEvent(
      new PointerEvent('pointerenter', {
        clientX: Math.round(box.left + 4),
        clientY: Math.round(box.top + 4),
        bubbles: true,
        pointerType: 'touch',
      })
    );
    /* A frame, deliberately: reading straight back reads the attribute the
       reveal has not written yet and passes whatever the code did, which is
       an assertion that cannot fail. */
    await new Promise((frame) => requestAnimationFrame(frame));
    return {
      open: node.getAttribute('data-tip-open'),
      visibility: getComputedStyle(node).visibility,
    };
  }, [tickerItem, 2]);
  expect(
    finger.open,
    'a finger opened the following branch; on a touchscreen laptop that box would chase a cursor that is not there'
  ).toBe('false');
  expect(finger.visibility, 'a finger made a following detail visible').toBe('hidden');

  /* HOW FAST it appears, measured rather than asserted (owner directive,
     2026-08-24). The owner praised the old readout's responsiveness and
     asked for it to be kept, so "immediately" needs a number: the box is
     PLACED in the same task as the pointer event — synchronously, before the
     handler returns — and it is VISIBLE before the frame that follows that
     event paints, which is what makes zero animation frames the honest
     figure rather than a rounding of one. */
  const latency = await page.evaluate(
    async ([css, at, gapPx]) => {
      const cell = window.document.querySelectorAll(css)[at];
      /* The detail is a child of its own figure in the per-element form, and
         ONE detail for the whole band in the region form, rendered beside the
         band outside its moving run, so the card is the host that holds it. */
      const node = cell.querySelector('.cell-tip') ?? cell.closest('.feed-card')?.querySelector('.cell-tip');
      cell.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, pointerType: 'mouse' }));
      await new Promise((frame) => requestAnimationFrame(frame));
      const box = cell.getBoundingClientRect();
      const spot = { x: Math.round(box.left + 4), y: Math.round(box.top + box.height / 2) };
      cell.dispatchEvent(
        new PointerEvent('pointerenter', {
          clientX: spot.x,
          clientY: spot.y,
          bubbles: true,
          pointerType: 'mouse',
        })
      );
      /* Read before yielding: this is the same task the event ran in. */
      const placed = node.style.getPropertyValue('--tip-x');
      let frames = 0;
      /* One microtask turn is where the reveal lands. Counting FRAMES is the
         question a reader can feel, so the loop counts those and the answer
         must be none of them. */
      await null;
      while (getComputedStyle(node).visibility !== 'visible' && frames < 8) {
        await new Promise((frame) => requestAnimationFrame(frame));
        frames += 1;
      }
      return { placed, expected: `${spot.x + gapPx}px`, frames, visible: getComputedStyle(node).visibility };
    },
    [tickerItem, 3, gap]
  );
  expect(
    latency.placed,
    'the detail is not placed in the same task as the pointer event that opened it'
  ).toBe(latency.expected);
  expect(latency.visible, 'the detail never became visible').toBe('visible');
  expect(
    latency.frames,
    `the detail took ${latency.frames} animation frames to appear; it must be visible before the next one paints`
  ).toBe(0);

  /* A multi-step move: the box re-anchors on every one of them rather than
     being placed once where the pointer entered. */
  const start = await hoverAt(page, tickerItem, 3, (box) => ({
    x: Math.round(box.x + 4),
    y: Math.round(box.y + box.height / 2),
  }));
  for (const step of [2, 6, 10, 14]) {
    await page.mouse.move(start.x + step, start.y);
    const moved = await detailBox(page, tickerItem, 3);
    expect(
      moved.left - (start.x + step),
      `the detail lagged ${moved.left - (start.x + step) - gap}px behind step ${step} of the move`
    ).toBeCloseTo(gap, 0);
  }
});

test('a flood of pointer moves costs one placement per frame, using the newest position', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await visit(page);
  test.skip(!(await followsPointer(page)), 'no fine pointer here; there is nothing to follow');
  const { gap } = await tipTokens(page);
  const at = await hoverAt(page, tickerItem, 3, (box) => ({
    x: Math.round(box.x + 4),
    y: Math.round(box.y + box.height / 2),
  }));

  /* A pointer reports far more moves than a display can draw. Every one of
     them would otherwise be a style write, so the handler coalesces into one
     placement per animation frame — and this measures BOTH halves of that
     claim, because each half has its own way of being wrong.

     The flood is dispatched synchronously, inside one task, so no frame can
     run in the middle of it. If the handler placed the box directly, the
     position would already have moved by the time the loop ends; it must not
     have. And a MutationObserver counts the style-attribute writes, which is
     what separates "one placement" from "forty placements that happen to
     agree" — the shape a lost throttle guard takes. */
  const flood = await page.evaluate(
    async ([sel, at, x, y]) => {
      const cell = window.document.querySelectorAll(sel)[at];
      /* The detail is a child of its own figure in the per-element form, and
         ONE detail for the whole band in the region form, rendered beside the
         band outside its moving run, so the card is the host that holds it. */
      const node = cell.querySelector('.cell-tip') ?? cell.closest('.feed-card')?.querySelector('.cell-tip');
      const placed = () => node.style.getPropertyValue('--tip-x');
      const before = placed();
      let delivered = 0;
      const observer = new MutationObserver((records) => {
        delivered += records.length;
      });
      observer.observe(node, { attributes: true, attributeFilter: ['style'] });
      /* Count the frames the page ASKS FOR as well as the writes it makes.
         The two catch different regressions and one of them hides the other:
         a handler that schedules a frame per event still writes once, because
         the first callback consumes the queued position and the rest find
         nothing to do — so the page looks right while it registers forty
         callbacks per flick of the wrist. Only this counter sees that. */
      const nativeFrame = window.requestAnimationFrame;
      let scheduled = 0;
      window.requestAnimationFrame = (callback) => {
        scheduled += 1;
        return nativeFrame.call(window, callback);
      };
      const moves = 40;
      for (let step = 1; step <= moves; step += 1) {
        cell.dispatchEvent(
          new PointerEvent('pointermove', {
            clientX: x + step,
            clientY: y,
            bubbles: true,
            pointerType: 'mouse',
          })
        );
      }
      window.requestAnimationFrame = nativeFrame;
      const during = placed();
      const midFlood = observer.takeRecords().length;
      await new Promise((settle) => requestAnimationFrame(() => requestAnimationFrame(settle)));
      const after = placed();
      const writes = delivered + midFlood + observer.takeRecords().length;
      observer.disconnect();
      return { before, during, after, midFlood, writes, scheduled, moves, last: x + moves };
    },
    [tickerItem, 3, at.x, at.y]
  );

  expect(
    flood.during,
    `${flood.moves} pointer moves placed the detail synchronously; the frame throttle is gone`
  ).toBe(flood.before);
  expect(flood.midFlood, 'a style write landed inside the flood, before any frame ran').toBe(0);
  expect(
    flood.writes,
    `${flood.moves} pointer moves produced ${flood.writes} style writes; the throttle coalesces them into one`
  ).toBe(1);
  expect(
    flood.scheduled,
    `${flood.moves} pointer moves scheduled ${flood.scheduled} animation frames; the guard coalesces them into one`
  ).toBe(1);
  /* Coalescing must never mean lagging: the one placement that runs uses the
     LAST position reported, not the first one it happened to see. */
  expect(
    flood.after,
    `the frame placed the detail at ${flood.after} for a pointer that ended at ${flood.last}px`
  ).toBe(`${flood.last + gap}px`);
});

test('the detail never grows the document at any viewport edge, and holds the edges its placement still answers for', async ({
  page,
}) => {
  await visit(page);
  test.skip(!(await followsPointer(page)), 'no fine pointer here; the anchored branch is measured below');
  const { gap, margin } = await tipTokens(page);

  /* The narrowest viewport this site supports, and the figure that decides:
     the one furthest toward the end edge, scrolled so its bottom edge is at
     the bottom of the screen. Pointing at its far corner asks the box to go
     past two edges at once, which is exactly the placement the retired
     per-column anchoring could not express and the reason the document used
     to grow sideways.

     MEASURED ON THE PER-ELEMENT HOST (re-aimed 2026-10-16). This lane used
     the calendar's cells, the region form, and recorded at length that the
     region form measures its box BEFORE the content for the pointed-at cell
     exists — so neither flip could be asserted there (lib/tooltip.ts's aim()
     places synchronously while the caller's detail lands a microtask later;
     not this redesign's, and still true of the region form's one host, the
     ticker). A repository figure is the per-element form: its detail is its
     own and never changes content, so its box is measured whole and the
     placement can be held to EVERY edge — which is what this lane now does,
     strictly more than it could before. */
  await page.setViewportSize({ width: phoneWidths[0], height: 640 });
  await settled(page);
  const lastColumn = await page.evaluate((css) => {
    const cells = [...window.document.querySelectorAll(css)];
    const rightmost = Math.max(...cells.map((cell) => Math.round(cell.getBoundingClientRect().right)));
    return cells.findLastIndex((cell) => Math.round(cell.getBoundingClientRect().right) === rightmost);
  }, repoFigure);
  expect(lastColumn, 'no figure sits at the end of its line; this lane proves nothing').toBeGreaterThan(0);

  const corner = page.locator(repoFigure).nth(lastColumn);
  await corner.scrollIntoViewIfNeeded();
  await corner.evaluate((cell) => {
    const box = cell.getBoundingClientRect();
    window.scrollBy(0, box.bottom - window.document.documentElement.clientHeight + 2);
  });
  const box = await settledBox(page, corner);
  /* Two pixels inside the figure's far corner, floored: a box's edges land on
     fractional pixels in every engine, so `right - 1` rounds OUTSIDE it often
     enough to matter, and a pointer outside sends no enter. */
  const at = {
    x: Math.floor(box.x + box.width) - 2,
    y: Math.floor(box.y + box.height) - 2,
  };
  await page.mouse.move(0, 0);
  await page.mouse.move(at.x, at.y);
  const edge = await detailBox(page, repoFigure, lastColumn);
  expect(edge.open, 'the corner figure did not open its detail').toBe('true');
  expect(edge.left, 'the detail reaches past the start edge').toBeGreaterThanOrEqual(margin - subPixel);
  expect(edge.top, 'the detail reaches past the top edge').toBeGreaterThanOrEqual(margin - subPixel);
  /* Flipped, not merely clamped, on both axes: a clamped box near the end
     edge sits ON the cursor and covers the figure being pointed at; a flipped
     one is on the other side of it. */
  expect(edge.right, `the detail runs ${Math.round(edge.right - (edge.viewport.width - margin))}px past the end edge`).toBeLessThanOrEqual(
    edge.viewport.width - margin + subPixel
  );
  expect(edge.bottom, `the detail runs ${Math.round(edge.bottom - (edge.viewport.height - margin))}px past the bottom edge`).toBeLessThanOrEqual(
    edge.viewport.height - margin + subPixel
  );
  expect(edge.catchesPointer, 'the flipped detail sits under the pointer').toBe(false);
  /* THE floor: a fixed box is outside the document's scrollable overflow, so
     this is structural rather than lucky — measured while the box is open at
     the worst corner of the narrowest screen. */
  expect(
    edge.scrollWidth,
    `the detail grew the document to ${edge.scrollWidth}px inside a ${edge.clientWidth}px viewport`
  ).toBe(edge.clientWidth);

  /* The other corner: a figure at the very top of the screen, where the box
     must clamp rather than flip off the top. */
  const first = page.locator(repoFigure).first();
  await first.scrollIntoViewIfNeeded();
  await first.evaluate((cell) => {
    window.scrollBy(0, cell.getBoundingClientRect().top - 1);
  });
  const head = await settledBox(page, first);
  await page.mouse.move(0, 0);
  await page.mouse.move(Math.ceil(head.x) + 2, Math.ceil(head.y) + 2);
  const top = await detailBox(page, repoFigure, 0);
  expect(top.open, 'the top figure did not open its detail').toBe('true');
  expect(top.top, 'the detail reaches past the top edge').toBeGreaterThanOrEqual(margin - subPixel);
  expect(top.left, 'the detail reaches past the start edge').toBeGreaterThanOrEqual(margin - subPixel);
  expect(top.scrollWidth, 'the detail grew the document at the top edge').toBe(top.clientWidth);

  /* Every column width between the phone floor and a desktop, on BOTH hosts:
     the region form is still held to the edges it can answer for, and the
     per-element form to all of them. */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [phoneWidths[0], phoneWidths[2], 768, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    await settled(page);
    for (const [selector, index] of [
      [tickerItem, 3],
      [repoFigure, 0],
    ]) {
      const spot = await hoverAt(page, selector, index, (tile) => ({
        x: Math.round(tile.x + tile.width / 2),
        y: Math.round(tile.y + tile.height / 2),
      }));
      const shown = await detailBox(page, selector, index);
      expect(shown.open, `${selector}: the detail did not open at ${width}px`).toBe('true');
      expect(shown.left, `${selector}: the detail reaches past the start edge at ${width}px`).toBeGreaterThanOrEqual(margin - subPixel);
      expect(shown.right, `${selector}: the detail reaches past the end edge at ${width}px`).toBeLessThanOrEqual(
        width - margin + subPixel
      );
      expect(
        Math.abs(shown.left - spot.x),
        `${selector}: the detail sits ${Math.round(Math.abs(shown.left - spot.x))}px from the pointer at ${width}px`
      ).toBeLessThanOrEqual(gap + shown.width);
      expect(shown.scrollWidth, `${selector}: the detail grew the document at ${width}px`).toBe(shown.clientWidth);
    }
  }
  await page.emulateMedia({ reducedMotion: null });
});

test('a tap opens the detail over its own tile, and a second tap closes it', async ({ page }) => {
  await visit(page);
  test.skip(await followsPointer(page), 'this engine reports a cursor; the following branch is measured above');
  const { gap, margin } = await tipTokens(page);

  /* No cursor, so nothing to follow: the box anchors to the TILE, which is
     the arrangement the pointer branch replaced and the correct one here. A
     finger covers the tile it is on, so the box goes above it.
     
     MEASURED ON THE PER-ELEMENT HOST — a repository figure since the owner's
     direction of 2026-10-16, the table counter before it — and the reason is
     the one the edge lane above records: in the region form the box is measured before
     its content for the tapped cell exists, so it is placed as the short,
     narrow box it was a moment ago and then renders full-size over the very
     tile it should sit above (measured on a 393px phone: tile 388–398, box
     362–425). That ordering ships on main today, it is not this redesign's,
     and it is stated rather than papered over. The figure is the per-element
     form, whose content never changes, and it is where the finger branch can
     be measured honestly: above its tile, clear of it, and closed again by a
     second tap. */
  const tile = page.locator(repoFigure).first();
  await tile.scrollIntoViewIfNeeded();
  await tile.tap();
  const shown = await detailBox(page, repoFigure, 0);
  expect(shown.open, 'a tap opened no detail').toBe('true');
  expect(shown.visibility, 'a tap opened an invisible detail').toBe('visible');
  expect(
    shown.bottom,
    `the detail runs to ${Math.round(shown.bottom)}px over a tile that starts at ${Math.round(shown.tile.top)}px`
  ).toBeLessThanOrEqual(shown.tile.top - gap + subPixel);
  /* ANCHORED, not merely above: one gap above its tile and on the screen.
     "Above" alone was satisfied by a box drawn 1,500px up and off the top of
     the page — measured 2026-10-16, when a backdrop-filter on the sheet made
     it the containing block of the fixed detail and every detail landed off
     the screen with this lane still green. */
  expect(
    shown.bottom,
    `the detail ends ${Math.round(shown.tile.top - gap - shown.bottom)}px further above its tile than its gap`
  ).toBeGreaterThanOrEqual(shown.tile.top - gap - 1);
  expect(shown.top, 'the detail reaches past the top edge').toBeGreaterThanOrEqual(margin - subPixel);
  /* Centred on the tile it describes, unless an edge clamped it. */
  const tileCentre = (shown.tile.left + shown.tile.right) / 2;
  const boxCentre = (shown.left + shown.right) / 2;
  const clamped =
    shown.left <= margin + subPixel || shown.right >= shown.viewport.width - margin - subPixel;
  if (!clamped) {
    expect(
      Math.abs(boxCentre - tileCentre),
      `the detail is centred ${Math.round(Math.abs(boxCentre - tileCentre))}px away from its tile`
    ).toBeLessThanOrEqual(1);
  }
  expect(shown.left, 'the detail reaches past the start edge').toBeGreaterThanOrEqual(margin - subPixel);
  expect(shown.right, 'the detail reaches past the end edge').toBeLessThanOrEqual(
    shown.viewport.width - margin + subPixel
  );
  expect(shown.scrollWidth, 'the detail grew the document on a phone').toBe(shown.clientWidth);

  /* A finger has no "away", so the tap is a TOGGLE: the same tile again
     closes it, and there is no state in which a reader is stuck with a box
     they cannot dismiss. */
  await tile.tap();
  const closed = await detailBox(page, repoFigure, 0);
  expect(closed.open, 'a second tap left the detail open').toBe('false');
  expect(closed.visibility, 'a second tap left the detail visible').toBe('hidden');
});

test('keyboard focus opens the detail', async ({ page }) => {
  await visit(page);
  const { gap, margin } = await tipTokens(page);

  /* ONE KEYBOARD ROUTE NOW (re-aimed 2026-10-16; this lane was "keyboard
     focus opens the detail on both grids"). It drove two hosts that a
     keyboard reached differently: the calendar's listbox, whose cells took no
     tab stop and whose cursor an arrow moved, and the table's counters, each
     an ordinary tab stop opening its own readout. The listbox left with the
     calendar it navigated — the trackers' diagram is a slider whose day is
     read in its own figures, and its keyboard walk has lanes of its own — so
     the route left to measure is the per-element one, on the repository
     figures that took over from the counters.

     A real key press, never a programmatic focus: `:focus-visible` is what
     separates a keyboard reader from a click, and only a genuine keyboard
     interaction sets it. The repository's own link is the tab stop
     immediately before its first figure, so one real Tab lands there. */
  const entry = page.locator('#projects .repo-entry').first();
  await entry.scrollIntoViewIfNeeded();
  await entry.locator('.repo-link').evaluate((node) => node.focus());
  await page.keyboard.press('Tab');
  const focused = await page.evaluate((css) => window.document.activeElement?.matches(css) === true, repoFigure);
  expect(focused, `Tab did not land on ${repoFigure}`).toBe(true);
  const index = await page.evaluate(
    (css) => [...window.document.querySelectorAll(css)].indexOf(window.document.activeElement),
    repoFigure
  );
  const shown = await detailBox(page, repoFigure, index);
  expect(shown.open, 'a repository figure does not open its detail for a keyboard').toBe('true');
  expect(shown.visibility, 'a repository figure opened an invisible detail for a keyboard').toBe('visible');
  /* Anchored to the figure, because a keyboard has no cursor to anchor to —
     the same branch a finger takes. Above it by preference, below it when the
     figure is too near the top of the screen, and never ON it either way. */
  const clear = shown.bottom <= shown.tile.top - gap + subPixel || shown.top >= shown.tile.bottom + gap - subPixel;
  expect(
    clear,
    `the keyboard detail (${Math.round(shown.top)}–${Math.round(shown.bottom)}) overlaps its own figure (${Math.round(shown.tile.top)}–${Math.round(shown.tile.bottom)})`
  ).toBe(true);
  /* AND BESIDE IT, on the screen: one gap above the figure or one gap below.
     "Not on it" alone was satisfied by a box drawn far off the top of the
     page (measured 2026-10-16, when a backdrop-filter on the sheet made it
     the containing block of the fixed detail). */
  const above = Math.abs(shown.bottom - (shown.tile.top - gap)) <= 1;
  const below = Math.abs(shown.top - (shown.tile.bottom + gap)) <= 1;
  expect(
    above || below,
    `the keyboard detail (${Math.round(shown.top)}–${Math.round(shown.bottom)}) is not a gap from its figure (${Math.round(shown.tile.top)}–${Math.round(shown.tile.bottom)})`
  ).toBe(true);
  expect(shown.top, 'the keyboard detail reaches past the top edge').toBeGreaterThanOrEqual(margin - subPixel);
  expect(shown.bottom, 'the keyboard detail reaches past the bottom edge').toBeLessThanOrEqual(
    shown.viewport.height - margin + subPixel
  );
  expect(shown.left, 'the keyboard detail reaches past the start edge').toBeGreaterThanOrEqual(margin - subPixel);
  expect(shown.right, 'the keyboard detail reaches past the end edge').toBeLessThanOrEqual(
    shown.viewport.width - margin + subPixel
  );
  expect(shown.scrollWidth, 'the keyboard detail grew the document').toBe(shown.clientWidth);
});

/* ===========================================================================
 * The token-activity heatmap (issue 178) — RETIRED 2026-10-16 with the
 * heatmap: the token series and the contribution calendar are one diagram now
 * (owner direction, 2026-10-16), and what these lanes measured moved with it:
 *
 *   - "the calendar fills its card, and its day bound still stops and squares
 *     a day" became "the calendar fills its column with whole, square days at
 *     every width". The caller-set day bound it drove from outside (the
 *     retired token card's --grid-day-max/--grid-day-size) left with the
 *     heatmap component that read it; the diagram's calendar sizes its own
 *     days to its box, and squareness is asserted at every width instead;
 *   - "a token-activity cell card is titled 'Tokens used' and reads a human
 *     period phrase" and "a tap opens the token-activity card, and a second
 *     tap closes it" had a subject in the heatmap's per-cell detail. The
 *     diagram has no per-cell detail: pointing at a day — on the graph or on
 *     the calendar — names it in the diagram's own figures, which "a day the
 *     reader points at is named in words" and "a finger taps a day and the
 *     answer stays" measure in every engine.
 * ======================================================================== */

/* THE DIAGRAM OFFERS ITS LAYERS AND NOTHING ELSE (owner directive,
 * 2026-08-28, reversing the 0.1.52 decision after seeing it live: "remove this
 * entire menu. it doesnt look good and it doesn't provide any value";
 * re-aimed 2026-10-16, when the owner's direction for the trackers' one
 * diagram brought back one control — the layer, which the graph and the
 * calendar both follow. The row of spans that came back beside it the same
 * morning was removed again that day, with the window outline it drew on the
 * calendar and the legend under the graph.)
 *
 * Both directions, like the lane it replaces: the display menu, its radios and
 * its pills stay gone, the spans, the window and the legend stay gone, and
 * every button the diagram holds is in its one sanctioned group — so a
 * display control cannot come back wearing a button — and every source the
 * payload reports with a daily series is offered its layer and draws its line,
 * on the same calendar. A page that had simply lost its graphs would satisfy
 * the first half perfectly, which is why the second half is here.
 *
 * The chained tome under the diagram (owner, 2026-10-20) turns its leaf on a
 * press anywhere on it, with no "turn the leaf" button; its lifted corner is
 * the keyboard's one way to the same turn, so it is the one other control the
 * diagram may hold — exactly one, named for the leaf it turns to — and every
 * other button is still a stray. */
test('the diagram offers its layers, the tome its corner, and no other control, and every reported source draws its line and layer (owner 2026-08-28; 2026-10-16; 2026-10-20)', async ({
  page,
}) => {
  await visit(page);
  const diagram = page.locator('.panel-shell').filter({ has: page.locator('.chronicle') });
  await expect(diagram).toBeVisible();
  const controls = await diagram.evaluate((node) => ({
    triggers: node.querySelectorAll('.filter-trigger, [aria-haspopup]').length,
    radiogroups: node.querySelectorAll('[role="radiogroup"]').length,
    radios: node.querySelectorAll('[role="radio"]').length,
    menus: node.querySelectorAll('[role="menu"], [role="listbox"], select').length,
    groups: [...node.querySelectorAll('[role="group"]')].map((group) => ({
      sanctioned: group.matches('.chronicle-layers'),
      named: (group.getAttribute('aria-label') ?? '').trim() !== '',
    })),
    stray: [...node.querySelectorAll('button, [role="button"]')]
      .filter((button) => button.closest('.chronicle-layers') === null && !button.matches('.tome .tome-corner'))
      .map((button) => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim()),
    corners: [...node.querySelectorAll('.tome .tome-corner')].map((corner) => ({
      role: corner.getAttribute('role'),
      focusable: corner.tabIndex === 0,
      name: (corner.getAttribute('aria-label') ?? '').trim(),
    })),
    unpressable: [...node.querySelectorAll('.chronicle-layers button')].filter(
      (button) => !['true', 'false'].includes(button.getAttribute('aria-pressed'))
    ).length,
    pressed: {
      layers: node.querySelectorAll('.chronicle-layers button[aria-pressed="true"]').length,
    },
    /* The surfaces the owner removed on 2026-10-16, by the names they wore. */
    retired: node.querySelectorAll('.chronicle-ranges, .chronicle-window, .chronicle-legend, .chronicle-footnote').length,
    sliders: [...node.querySelectorAll('[role="slider"]')].map((slider) => ({
      chart: slider.classList.contains('chronicle-chart'),
      name: (slider.getAttribute('aria-label') ?? '').trim(),
      now: slider.getAttribute('aria-valuenow'),
      max: slider.getAttribute('aria-valuemax'),
    })),
  }));
  expect(controls.triggers, 'a display trigger is back on the diagram').toBe(0);
  expect(controls.radiogroups, 'a radio group is back on the diagram').toBe(0);
  expect(controls.radios, 'a radio is back on the diagram').toBe(0);
  expect(controls.menus, 'a menu is back on the diagram').toBe(0);
  expect(controls.stray, `the diagram holds a button outside its layer switch: ${controls.stray.join(', ')}`).toEqual([]);
  expect(controls.corners, 'the tome does not offer exactly one corner to turn its leaf').toHaveLength(1);
  expect(controls.corners[0].role, 'the tome\u2019s corner is not a control').toBe('button');
  expect(controls.corners[0].focusable, 'the keyboard cannot reach the tome\u2019s corner').toBe(true);
  expect(controls.corners[0].name, 'the tome\u2019s corner does not say which leaf it turns to').toMatch(/^The next leaf: \S/);
  expect(controls.groups, 'the diagram does not offer exactly its one named control group').toEqual([
    { sanctioned: true, named: true },
  ]);
  expect(controls.unpressable, 'a layer button does not report its state').toBe(0);
  expect(controls.pressed.layers, 'the diagram does not show exactly one layer').toBe(1);
  expect(controls.retired, 'a span row, a window outline or a legend is back on the diagram').toBe(0);
  /* And the one slider IS the graph, named and reporting a real day. */
  expect(controls.sliders, 'the diagram does not offer exactly one slider').toHaveLength(1);
  expect(controls.sliders[0].chart, 'the slider on the diagram is not its graph').toBe(true);
  expect(controls.sliders[0].name, 'the graph offers no accessible name').not.toBe('');
  expect(Number(controls.sliders[0].max), 'the graph reports no last day').toBeGreaterThan(0);
  expect(Number(controls.sliders[0].now), 'the graph reports no current day').toBeGreaterThanOrEqual(0);

  /* Half two: every source the payload reports with a daily series draws its
     line and is offered its layer — read from the API the diagram reads, so a
     page that quietly dropped one fails here rather than passing on the
     survivors — and every layer paints the same days. */
  const sets = await page.evaluate(async () => {
    const response = await fetch('/api/panels/token-usage');
    const envelope = await response.json();
    return (envelope?.data?.sources ?? [])
      .filter((source) => Array.isArray(source?.series?.totals) && source.series.totals.length > 0)
      .map((source) => source.label);
  });
  expect(sets.length, 'no source reports a daily series; this lane cannot compare two layers').toBeGreaterThan(1);
  await page.locator('.chronicle-chart').scrollIntoViewIfNeeded();
  await expect(page.locator('.chronicle')).toHaveAttribute('data-shown', 'true');
  const drawn = [];
  for (const label of sets) {
    const layer = page.locator('.chronicle-layers button').filter({ hasText: sourceName(label) });
    await expect(layer, `"${label}" reports a daily series and is offered no layer named "${sourceName(label)}"`).toHaveCount(1);
    await layer.click();
    /* Its LINE is the graph's one plot once its layer is pressed. */
    await expect(
      page.locator('.chronicle-plot .chronicle-line:not(.chronicle-ahead)'),
      `"${label}" reports a daily series and draws no line`
    ).toHaveAttribute('d', /^M/);
    drawn.push({ label, days: await page.locator('.chronicle-cell').count() });
  }
  for (const set of drawn.slice(1)) {
    expect(set.days, `"${drawn[0].label}" paints ${drawn[0].days} days and "${set.label}" paints ${set.days}`).toBe(drawn[0].days);
  }
});

test('the band detail and the repository detail are the same object, measured', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await visit(page);

  /* The owner's second complaint, measured rather than eyeballed: one readout
     must not merely resemble the other, it must BE it. Every value below is
     read from the engine's computed style, and every one of them also has to
     resolve from a token — a raw length would pass a parity check and still be
     the drift issue #136 rule 5 forbids.

     THE TWO SURFACES MOVED AGAIN (re-aimed 2026-10-16). It was the boss grid
     against the skill grid, then the calendar against the repository table;
     the calendar became the trackers' diagram, which names a day in its own
     figures rather than in a detail. It is now the boss ticker against a
     repository's figure — still the primitive's two WIRING FORMS, one detail
     serving a whole band and a detail describing its own parent, so parity
     here still proves the object is the same across the deeper of the two
     possible divergences.

     The band's detail has to be OPENED before it can be compared: in the
     region form the box takes its content from whichever item is pointed at,
     so an unopened one is genuinely empty. A repository figure's detail
     describes its own parent and always carries it. */
  const opened = await openRegionDetail(page);
  expect(opened, 'the band never opened a detail to compare').toBe(true);

  const measure = (css) => {
    const node = window.document.querySelector(css);
    const box = getComputedStyle(node);
    const title = getComputedStyle(node.querySelector('.cell-tip-name'));
    const row = getComputedStyle(node.querySelectorAll('span')[1]);
    return {
      padding: [box.paddingTop, box.paddingRight, box.paddingBottom, box.paddingLeft].join(' '),
      radius: box.borderTopLeftRadius,
      border: `${box.borderTopWidth} ${box.borderTopStyle} ${box.borderTopColor}`,
      background: box.backgroundColor,
      ink: box.color,
      size: box.fontSize,
      leading: box.lineHeight,
      gap: box.rowGap,
      pointerEvents: box.pointerEvents,
      position: box.position,
      titleInk: title.color,
      titleWeight: title.fontWeight,
      rowInk: row.color,
      rows: node.querySelectorAll('span').length,
    };
  };
  const band = await page.evaluate(measure, '.ticker-strip + .cell-tip');
  /* A repository's terse figures carry no row (the provenance sentence every
     counter used to state is gone — owner directive, 2026-09-06, issue 299),
     so a bare figure's detail is its heading alone. Its AGE still states the
     absolute instant as a row, through the same primitive in the same parent
     form, so the age — the last figure of an entry — is the side measured. */
  const repository = await page.evaluate(measure, '#projects .repo-entry .repo-figure:last-child .cell-tip');

  for (const property of [
    'padding',
    'radius',
    'border',
    'background',
    'ink',
    'size',
    'leading',
    'gap',
    'pointerEvents',
    'position',
    'titleInk',
    'titleWeight',
    'rowInk',
  ]) {
    expect(
      repository[property],
      `the repository detail's ${property} is "${repository[property]}" where the band detail's is "${band[property]}"`
    ).toBe(band[property]);
  }
  /* Non-vacuity: a parity check between two empty boxes proves nothing, so
     both must actually carry a heading and at least one row. */
  expect(band.rows, 'the band detail rendered no rows').toBeGreaterThanOrEqual(2);
  expect(repository.rows, 'the repository detail rendered no rows').toBeGreaterThanOrEqual(2);
  /* The heading is the panel layer's one chromatic token and the rows are
     not, which is the visual grammar the owner called the reference. */
  expect(band.titleInk, 'the detail heading is painted in the body ink').not.toBe(band.ink);
  expect(band.rowInk, 'a detail row is painted in the heading colour').toBe(band.ink);

  /* And every one of those numbers resolves from the token layer rather than
     being stated in the component: moving a token moves both details. */
  const fromTokens = await page.evaluate(() => {
    const style = getComputedStyle(window.document.documentElement);
    const node = window.document.querySelector('.ticker-strip + .cell-tip');
    const box = getComputedStyle(node);
    const read = (name) => style.getPropertyValue(name).trim();
    return {
      declaredPadding: read('--tip-padding'),
      computedPadding: `${box.paddingTop} ${box.paddingRight}`,
      declaredRadius: read('--tip-radius'),
      computedRadius: box.borderTopLeftRadius,
      declaredSize: read('--tip-size'),
      computedSize: box.fontSize,
    };
  });
  const rem = (value) => `${Number(value.replace('rem', '')) * 16}px`;
  const [blockPad, inlinePad] = fromTokens.declaredPadding.split(/\s+/);
  expect(fromTokens.computedPadding, 'the detail padding is not the token').toBe(`${rem(blockPad)} ${rem(inlinePad)}`);
  expect(fromTokens.computedRadius, 'the detail radius is not the token').toBe(fromTokens.declaredRadius);
  expect(fromTokens.computedSize, 'the detail type size is not the token').toBe(rem(fromTokens.declaredSize));
  await page.emulateMedia({ reducedMotion: null });
});

test('a hostile row name reaches the detail as text and nothing else', async ({ page }) => {
  /* Detail content is PAYLOAD — the row names arrive over the network from the
     origin's own snapshot — so "it renders as text" is a security property,
     not a formatting one. The origin's data is well behaved, which is exactly
     why it cannot demonstrate this: the response is intercepted and one name
     replaced with markup that would be loud if it ever executed.
     
     ONE SURFACE RATHER THAN TWO (owner directive, 2026-09-03, issue 287). The
     lane used to stage a boss name and a skill name and expect two details to
     carry the string; the skill grid is retired, so the skills half is gone
     and only the boss row is staged. The row is drawn in a marquee that
     renders its lane TWICE so the band can wrap without a seam, and only one
     copy is readable — the other is `aria-hidden` — so the accessible-name
     count below is taken over the readable copy alone rather than being
     doubled by the duplicate. */
  const hostile = '<img src=x onerror="window.__tipEscaped = true">';
  await page.route('**/api/panels/boss-log', async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    envelope.data.bosses[0].name = hostile;
    await route.fulfill({ response, json: envelope });
  });
  /* The band is stopped first. Its items are geometrically in motion while it
     runs, so nothing can be put under a pointer — and stopping it is not a
     workaround but a state the owner named: under reduced motion the strip is
     a scroller a reader pans, and every item is a target. */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await visit(page);

  /* The staged row is found by its own name rather than by position: the band
     keeps the payload's own order (owner, 2026-10-19), so the row replaced is
     the first one drawn today — but a lane that assumed so would measure an
     innocent neighbour the day the order moved again. Exactly one readable
     copy must match. */
  const staged = page.locator(
    '.ticker-lane:not([aria-hidden="true"]) .ticker-item[aria-label^="<img src=x"]'
  );
  await expect(
    staged,
    'the staged row is not in the band; this lane has nothing to measure'
  ).toHaveCount(1);
  await staged.scrollIntoViewIfNeeded();
  const box = await staged.boundingBox();
  await page.mouse.move(0, 0);
  await page.mouse.move(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
  await expect(
    page.locator('.ticker-strip').locator('xpath=..').locator('.cell-tip'),
    'the staged row opened no detail; this lane proves nothing'
  ).toHaveAttribute('data-tip-open', 'true');

  const rendered = await page.evaluate((text) => {
    const tips = [...window.document.querySelectorAll('.cell-tip')];
    const carrying = tips.filter((node) => node.textContent.includes(text));
    const readable = [
      ...window.document.querySelectorAll('.ticker-lane:not([aria-hidden="true"]) [aria-label]'),
    ].filter((node) => node.getAttribute('aria-label').includes(text));
    return {
      carrying: carrying.length,
      elements: carrying.flatMap((node) => [...node.querySelectorAll('*')].map((n) => n.tagName)),
      images: window.document.querySelectorAll('img[src="x"]').length,
      executed: window.__tipEscaped === true,
      labels: readable.length,
    };
  }, hostile);

  /* Exactly one detail carries it, as literal text. */
  expect(rendered.carrying, 'the hostile name never reached a detail; this lane proves nothing').toBe(1);
  /* Nothing it contained became an element, anywhere. */
  expect(rendered.images, 'the payload name became a real <img> in the document').toBe(0);
  expect(rendered.executed, 'markup from the payload executed').toBe(false);
  /* And the only elements inside that detail are the primitive's own spans:
     the payload contributed text nodes and no structure at all. */
  expect(
    [...new Set(rendered.elements)],
    'a detail carrying payload text contains an element the primitive did not render'
  ).toEqual(['SPAN']);
  /* The same text also lands in the row's accessible name, and is inert there
     too — the aria-label path is a second place a payload reaches the DOM and
     it must be no different. */
  expect(rendered.labels, 'the hostile name never reached an accessible name').toBe(1);
  await page.emulateMedia({ reducedMotion: null });
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/* ===========================================================================
 * The reader-controlled column (owner directive, 2026-08-24)
 *
 * "Give me very sleek and seamless ability to drag the feed in or out on its
 * X axis", and — equally weighted — "make sure that all objects stay
 * responsive and that there is no way to break the website in an ugly way, so
 * there should be unit test of users making the website very small, the width
 * very small etc.. everything should have safe boundaries of min/max values
 * that work across different screen sizes, and devices."
 *
 * The arithmetic is executed in tests/column-width.test.mjs against a fake
 * host that records every style write. These lanes answer what a source pin
 * cannot: whether a real engine, given a real pointer, produces a column that
 * is where it should be, within the bounds, at every width, on five engines
 * and at phone size — and whether the reader ever sees it move.
 * ======================================================================== */

// The viewport width the rails exist from: --page-rails-from, stated at
// 67.5rem in styles.css now that the shipped column is the ceiling (issue 292)
// and pinned against that token in tests/column-width.test.mjs; used here as
// the width at which a handle is first expected to exist.
const railsBreakpointPx = 67.5 * 16;

// The shipped column at a given viewport (owner directive, 2026-09-04, issue
// 292: the page ships at its ceiling): the 100rem token or the viewport less
// its two gutters and two hit lanes, whichever is smaller — the same bracket
// styles.css and columnWidth.ts each hold on their own side.
const shippedColumnPx = (column) =>
  Math.min(100 * column.rem, column.clientWidth - (2 * 1 + 2 * 2.75) * column.rem);

// The storage entry the reader's preference lives in. The grammar it accepts
// is executed in tests/column-width.test.mjs; these lanes only need the name.
const columnStorageKey = 'page-column-width';

const handles = (page) => page.getByRole('separator');

// The column, and everything a width assertion needs to know about it.
const columnBox = (page) =>
  page.evaluate(() => {
    const main = window.document.querySelector('main');
    const box = main.getBoundingClientRect();
    const root = window.document.documentElement;
    return {
      width: box.width,
      left: box.left,
      right: box.right,
      rem: Number.parseFloat(getComputedStyle(root).fontSize),
      token: getComputedStyle(root).getPropertyValue('--page-column-width').trim(),
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth
    };
  });

// Grab point for one handle: the centre of its lane, at a y inside the window.
const grabPoint = (page, edge) =>
  page.evaluate((wanted) => {
    const handle = window.document.querySelector(`.column-handle[data-edge="${wanted}"]`);
    const box = handle.getBoundingClientRect();
    return {
      x: box.left + box.width / 2,
      y: Math.min(Math.max(box.top + 80, 24), window.innerHeight - 24)
    };
  }, edge);

async function dragHandle(page, edge, byPx) {
  const from = await grabPoint(page, edge);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + byPx, from.y, { steps: 12 });
  await page.mouse.up();
  return from;
}

/* The same gesture, dispatched as pointer events the test composes itself.
 * It exists for ONE reason: a pointer thrown far past the edge of the window.
 * Playwright's Firefox driver reports clientX 0 for a position outside the
 * viewport (measured: a move to x+6000 arrived as x=0, and the column
 * obediently went to its minimum), so a real-pointer lane cannot ask what
 * happens beyond the screen — while a real browser, holding a captured
 * pointer, delivers exactly those out-of-window coordinates. Composing the
 * events keeps the question askable in every engine, and the ordinary drag
 * above stays a real pointer. */
const syntheticDrag = (page, edge, toClientX) =>
  page.evaluate(
    ([wanted, target]) => {
      const handle = window.document.querySelector(`.column-handle[data-edge="${wanted}"]`);
      const box = handle.getBoundingClientRect();
      const y = Math.min(Math.max(box.top + 80, 24), window.innerHeight - 24);
      const send = (type, x, buttons) =>
        handle.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 11,
            isPrimary: true,
            button: 0,
            buttons,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true
          })
        );
      send('pointerdown', box.left + box.width / 2, 1);
      send('pointermove', target, 1);
      send('pointerup', target, 0);
    },
    [edge, toClientX]
  );

/* One load, observed from document-start: the width the reader stored, the
 * heading's box in the FIRST animation frame, and the layout shift the engine
 * scored for the whole page.
 *
 * The heading is the measurement that carries the pre-paint claim, and it is
 * the one every engine can make. The static document paints exactly one thing
 * — a centred h1 in a centred column — and a centred box inside a centred box
 * sits in the same place at every column width. So whatever the module's
 * timing turns out to be on a given engine, there is nothing painted before it
 * that a width could move. (Measured, Chromium: first paint at 28ms with the
 * shipped column, the stored width applied at 44ms, the heading's box
 * identical either side of it.)
 */
async function loadAndObserve(context, stored) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(
    ([key, value]) => {
      try {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
      } catch {
        /* A context without storage simply gets the shipped width. */
      }
      window.__columnFirstFrame = null;
      requestAnimationFrame(() => {
        const heading = window.document.querySelector('h1');
        const box = heading === null ? null : heading.getBoundingClientRect();
        window.__columnFirstFrame = {
          heading: box === null ? null : [box.x, box.y, box.width, box.height].map(Math.round),
          token: getComputedStyle(window.document.documentElement)
            .getPropertyValue('--page-column-width')
            .trim()
        };
      });
      window.__columnShift = 0;
      window.__columnShiftScored = false;
      try {
        new PerformanceObserver((list) => {
          window.__columnShiftScored = true;
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.__columnShift += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {
        /* Only Chromium implements the Layout Instability API; every other
           engine is held to the heading measurement instead. */
      }
    },
    [columnStorageKey, stored]
  );
  await page.goto('/');
  await settled(page);
  const column = await columnBox(page);
  const observed = await page.evaluate(() => ({
    firstFrame: window.__columnFirstFrame,
    /* The same heading once the page has settled, in the same shape as the
       first frame, so the two can be compared within ONE load. */
    settledHeading: (() => {
      const box = window.document.querySelector('h1').getBoundingClientRect();
      return [box.x, box.y, box.width, box.height].map(Math.round);
    })(),
    shift: window.__columnShift,
    scored: window.__columnShiftScored
  }));
  await page.close();
  return { column, ...observed };
}

test('each column edge carries a handle, flush with the column and painting nothing (issue 177)', async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  await expect(handles(page)).toHaveCount(2);

  const column = await columnBox(page);
  const measured = await page.evaluate(() => {
    const seen = [];
    for (const handle of window.document.querySelectorAll('.column-handle')) {
      const box = handle.getBoundingClientRect();
      const mark = getComputedStyle(handle, '::before');
      seen.push({
        edge: handle.getAttribute('data-edge'),
        left: box.left,
        right: box.right,
        width: box.width,
        height: box.height,
        orientation: handle.getAttribute('aria-orientation'),
        label: handle.getAttribute('aria-label'),
        now: Number(handle.getAttribute('aria-valuenow')),
        min: Number(handle.getAttribute('aria-valuemin')),
        max: Number(handle.getAttribute('aria-valuemax')),
        focusable: handle.tabIndex,
        cursor: getComputedStyle(handle).cursor,
        /* No bar at all now (issue 177): a pseudo-element with no `content`
           paints nothing regardless of what any other property says, so this
           is the one property that can prove absence rather than merely
           echo a resting color that happens to be transparent. */
        markContent: mark.content
      });
    }
    return { seen };
  });

  for (const handle of measured.seen) {
    /* A hit lane, not a hairline: the target is the same 44px every other
       control on this page clears. */
    expect(handle.width, `the ${handle.edge} handle is ${handle.width}px wide`).toBeGreaterThanOrEqual(
      touchFloorPx - subPixel
    );
    expect(handle.height, `the ${handle.edge} handle is ${handle.height}px tall`).toBeGreaterThanOrEqual(
      touchFloorPx - subPixel
    );
    expect(handle.cursor, `the ${handle.edge} handle does not offer a resize cursor`).toBe('col-resize');
    /* The WAI-ARIA Window Splitter pattern, as an engine reports it: a
       focusable separator carrying a value and the range it moves in. */
    expect(handle.orientation).toBe('vertical');
    expect(handle.label, 'a handle with no accessible name').toBeTruthy();
    expect(handle.focusable, 'a splitter no keyboard can reach').toBe(0);
    expect(handle.min).toBeLessThan(handle.now);
    /* AT the ceiling, not under it: the page ships at its maximum (owner
       directive, 2026-09-04, issue 292), so at rest the value IS the range's
       top and the splitter can only move one way. */
    expect(handle.now).toBeLessThanOrEqual(handle.max);
    expect(handle.now, 'the page did not ship at its ceiling').toBeCloseTo(handle.max, 0);
    expect(handle.now, 'the reported width is not the width on screen').toBeCloseTo(column.width, 0);
    expect(handle.markContent, `the ${handle.edge} handle still paints a bar`).toBe('none');
  }
  expect(
    new Set(measured.seen.map((handle) => handle.label)).size,
    'both handles answer to the same name'
  ).toBe(2);
  /* Flush with the column, to the pixel: the start handle ENDS where the
     column begins and the end handle BEGINS where it ends, so the rail is the
     boundary rather than something parked near it. */
  const [start, end] = ['start', 'end'].map((edge) =>
    measured.seen.find((handle) => handle.edge === edge)
  );
  expect(start.right, 'the start handle is not on the column edge').toBeCloseTo(column.left, 0);
  expect(end.left, 'the end handle is not on the column edge').toBeCloseTo(column.right, 0);
  /* ...and neither of them puts a pixel outside the page. */
  expect(column.scrollWidth).toBe(column.clientWidth);
  expect(start.left).toBeGreaterThanOrEqual(0);
  expect(end.right).toBeLessThanOrEqual(column.clientWidth + subPixel);

  /* Pointing at the edge changes NOTHING visible (issue 177: "no bar, no
     highlight, no animation"). The cursor is the whole affordance, and it
     was already asserted above — this proves hovering adds no second one. */
  const boxAndMark = () =>
    page.evaluate(() => {
      const handle = window.document.querySelector('.column-handle[data-edge="end"]');
      const box = handle.getBoundingClientRect();
      /* DOCUMENT-relative, not viewport-relative. The handle is taller than
         any viewport, so bringing it under the pointer scrolls the page —
         and how far it scrolls is a function of where the column starts, not
         of anything hover did. Viewport coordinates read that scroll as the
         handle having moved, which is how this comparison went red the day
         the page reserved space above its own name (owner directive,
         2026-08-25) with nothing about the handle changed at all. The claim
         is that hover alters the handle's geometry and paint; the page being
         allowed to scroll is not part of it. */
      return {
        /* Gecko may re-report the same device-pixel edge a few ten-thousandths
           of a CSS pixel apart after pointer placement. Quantize below one
           thousandth: far beneath a drawable pixel, while any real geometry
           or paint change still fails this exact comparison. */
        box: [box.left + window.scrollX, box.top + window.scrollY, box.width, box.height].map(
          (value) => Math.round(value * 1000) / 1000
        ),
        markContent: getComputedStyle(handle, '::before').content
      };
    });
  const resting = await boxAndMark();
  await page.locator('.column-handle[data-edge="end"]').hover();
  const hovered = await boxAndMark();
  expect(hovered, 'hovering the handle changed something it must not').toEqual(resting);

  /* Focus is the one exception, and it is the SITE'S own ring — the same
     width, token and offset as every other focusable thing on the page —
     never a bar of the handle's own invention. This is the "invisible until
     addressed" non-pointer affordance the owner asked to keep on issue 168:
     a mouse or touch drag never reaches :focus-visible, so it never sees it. */
  await page.locator('.column-handle[data-edge="end"]').focus();
  const focused = await page.evaluate(() => {
    const handle = window.document.querySelector('.column-handle[data-edge="end"]');
    const ring = getComputedStyle(handle);
    return {
      ring: [ring.outlineWidth, ring.outlineStyle, ring.outlineColor, ring.outlineOffset],
      markContent: getComputedStyle(handle, '::before').content
    };
  });
  expect(focused.ring[1], 'a focused handle draws no ring').not.toBe('none');
  expect(Number.parseFloat(focused.ring[0])).toBeGreaterThanOrEqual(2);
  expect(Number.parseFloat(focused.ring[3])).toBeGreaterThanOrEqual(2);
  expect(focused.markContent, 'focus painted a bar; the ring alone is the affordance now').toBe('none');
});

test('a real pointer drag moves the edge exactly as far as the pointer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  /* The handles are the SUBJECT here, so their arrival is a precondition and
     not something to discover halfway through a gesture: settled() waits for
     the page to stop growing, which a slow enough machine can satisfy while
     the application is still mounting. Waiting for them explicitly makes a
     starved run fail saying so, instead of stalling inside a focus or a grab.
     (Observed twice on WebKit under heavy contention, both times inside
     locator.focus(), whose wait is bounded only by the test timeout.) */
  await expect(handles(page)).toHaveCount(2);
  const before = await columnBox(page);

  /* INWARD, because the page ships at its ceiling (owner directive,
     2026-09-04, issue 292) and there is nothing to drag out into: the end
     handle is pulled 160px toward the middle. */
  await dragHandle(page, 'end', -160);
  const after = await columnBox(page);

  /* The edge tracks the finger one for one, which for a CENTRED column means
     the width shrank by twice the travel. Both halves are asserted: the width
     halving alone would also be satisfied by an edge racing ahead of the
     pointer. */
  expect(after.right - before.right, 'the grabbed edge did not follow the pointer').toBeCloseTo(-160, 0);
  expect(after.width - before.width, 'a centred column must shrink from both sides').toBeCloseTo(-320, 0);
  expect(after.left - before.left).toBeCloseTo(160, 0);
  expect(after.scrollWidth).toBe(after.clientWidth);
  /* The reading-mode control this lane also held to the dragged sheet (owner
     directive, 2026-09-03, issue 287) went with the footer (owner,
     2026-10-19): the sheet carries no chrome control for a drag to move. */

  /* The start handle mirrors it, and undoes it: pulled 160px outward, it
     gives the column back the 320px the end handle took. */
  await dragHandle(page, 'start', -160);
  const undone = await columnBox(page);
  expect(undone.width, 'the start handle does not mirror the end one').toBeCloseTo(before.width, 0);

  /* And the choice survives the visit: the width the reader let go of is the
     width in storage, in the bare-decimal grammar the parser accepts. */
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), columnStorageKey);
  expect(stored, 'the reader choice was not persisted').toMatch(/^\d+(?:\.\d+)?$/);
  expect(Number(stored) * undone.rem).toBeCloseTo(undone.width, 0);
});

test('dragging past both extremes clamps instead of breaking the page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  /* The handles are the SUBJECT here, so their arrival is a precondition and
     not something to discover halfway through a gesture: settled() waits for
     the page to stop growing, which a slow enough machine can satisfy while
     the application is still mounting. Waiting for them explicitly makes a
     starved run fail saying so, instead of stalling inside a focus or a grab.
     (Observed twice on WebKit under heavy contention, both times inside
     locator.focus(), whose wait is bounded only by the test timeout.) */
  await expect(handles(page)).toHaveCount(2);
  const bounds = await page.evaluate(() => {
    const handle = window.document.querySelector('.column-handle');
    return {
      min: Number(handle.getAttribute('aria-valuemin')),
      max: Number(handle.getAttribute('aria-valuemax'))
    };
  });

  for (const [name, travel, expected] of [
    ['as far out as the pointer can go', 100000, bounds.max],
    ['as far in as the pointer can go', -100000, bounds.min]
  ]) {
    await syntheticDrag(page, 'end', travel);
    await settled(page);
    const column = await columnBox(page);
    expect(column.width, `dragging ${name} produced a ${column.width}px column`).toBeCloseTo(
      expected,
      0
    );
    /* The floor this whole feature is measured against: whatever the reader
       does with the handle, the document does not scroll sideways. */
    expect(
      column.scrollWidth,
      `the page scrolls sideways at the ${name} extreme: ${column.scrollWidth}px in ${column.clientWidth}px`
    ).toBe(column.clientWidth);
    /* And the handles are still on the column's edges rather than off the
       screen, which is what the reserved lanes in the ceiling are for. */
    const rails = await page.evaluate(() =>
      [...window.document.querySelectorAll('.column-handle')].map((handle) => {
        const box = handle.getBoundingClientRect();
        return { left: box.left, right: box.right };
      })
    );
    for (const rail of rails) {
      expect(rail.left).toBeGreaterThanOrEqual(-subPixel);
      expect(rail.right).toBeLessThanOrEqual(column.clientWidth + subPixel);
    }
  }
});

test('the keyboard resizes the column, and a double click puts it back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  /* The handles are the SUBJECT here, so their arrival is a precondition and
     not something to discover halfway through a gesture: settled() waits for
     the page to stop growing, which a slow enough machine can satisfy while
     the application is still mounting. Waiting for them explicitly makes a
     starved run fail saying so, instead of stalling inside a focus or a grab.
     (Observed twice on WebKit under heavy contention, both times inside
     locator.focus(), whose wait is bounded only by the test timeout.) */
  await expect(handles(page)).toHaveCount(2);
  const shipped = await columnBox(page);
  /* THE PAGE SHIPS AT ITS CEILING (owner directive, 2026-09-04, issue 292), so
     at rest there is nothing to widen INTO: the first key that changes anything
     narrows, and a press toward the ceiling from the ceiling is refused rather
     than drifting. */
  expect(shipped.width, 'the page did not ship at its ceiling').toBeCloseTo(shippedColumnPx(shipped), 0);

  const end = page.locator('.column-handle[data-edge="end"]');
  await end.focus();
  await expect(end).toBeFocused();

  /* The arrows move the SPLITTER (WAI-ARIA Window Splitter): right on the end
     handle widens, left narrows, and the reported value follows the box. */
  await page.keyboard.press('ArrowLeft');
  const narrowed = await columnBox(page);
  expect(narrowed.width, 'ArrowLeft on the end handle did not narrow the column').toBeLessThan(
    shipped.width
  );
  await page.keyboard.press('ArrowRight');
  expect((await columnBox(page)).width).toBeCloseTo(shipped.width, 0);
  await page.keyboard.press('ArrowRight');
  expect(
    (await columnBox(page)).width,
    'ArrowRight at the ceiling moved the column past it'
  ).toBeCloseTo(shipped.width, 0);

  /* The start handle answers the same keys in the opposite direction, because
     "left" is a direction in the window and not in the column. */
  const start = page.locator('.column-handle[data-edge="start"]');
  await start.focus();
  await page.keyboard.press('ArrowRight');
  expect(
    (await columnBox(page)).width,
    'ArrowRight on the start handle must narrow, not widen'
  ).toBeLessThan(shipped.width);
  await page.keyboard.press('ArrowLeft');

  await page.keyboard.press('Home');
  const home = await columnBox(page);
  await page.keyboard.press('End');
  const end2 = await columnBox(page);
  expect(home.width, 'Home did not take the column to its minimum').toBeLessThan(shipped.width);
  expect(end2.width, 'End did not take the column back to its maximum, the shipped width').toBeCloseTo(
    shipped.width,
    0
  );
  const reported = await page.evaluate(() =>
    Number(window.document.querySelector('.column-handle').getAttribute('aria-valuenow'))
  );
  expect(reported, 'the splitter reports a width it is not at').toBeCloseTo(end2.width, 0);

  /* Double click resets, which is the convention every split view already
     taught this reader. From the minimum, so the reset is a move this lane can
     see rather than a no-op at the ceiling. */
  await page.keyboard.press('Home');
  await start.dblclick();
  const reset = await columnBox(page);
  expect(reset.width, 'a double click did not return the shipped column').toBeCloseTo(
    shipped.width,
    0
  );
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), columnStorageKey);
  expect(Number(stored) * reset.rem).toBeCloseTo(shipped.width, 0);
});

test('a stored width is on the page before it paints, and moves nothing', async ({ page }) => {
  const context = page.context();
  /* Font-neutral on purpose: this lane compares the first-frame heading box
     across TWO loads of the same context, and the self-hosted typeface loads
     `font-display: swap` — whether it lands before the first frame is a race
     the second load wins more often (warm cache), which measured as a 2px
     heading-width delta in Firefox and failed this pin against a page that
     shifts nothing. What this lane measures is the stored COLUMN width, not
     typography, so both loads run on identical fallback metrics; the
     typeface has its own pins in tests/sections.test.mjs. */
  await context.route('**/*.woff2', (route) => route.abort());
  const shipped = await loadAndObserve(context, null);
  const chosen = await loadAndObserve(context, '40');

  expect(chosen.column.width, 'the stored width was not applied at all').toBeCloseTo(
    40 * chosen.column.rem,
    0
  );
  expect(chosen.column.token).toBe('40rem');
  expect(shipped.column.width, 'a page with no preference must ship at its own column').toBeCloseTo(
    shippedColumnPx(shipped.column),
    0
  );

  /* The pre-paint guarantee, measured in every engine and RE-EXPRESSED for
     the ledger (owner directive, 2026-09-03, issue 287). This used to compare
     the first-frame heading of the stored-width load against the SHIPPED
     load's, because the heading sat in a fixed-width intro and a stored
     column could not move it. The masthead fills the column now — the heading
     is 960px wide at the shipped width and 640px at the stored one — so that
     equality would assert a stored width has no effect, which is the opposite
     of the feature.
     
     What the title claims is what is asserted instead: the stored width is on
     the page BEFORE it paints, so within the stored-width load the heading's
     first frame is the heading's settled frame — nothing arrived later and
     moved it. The shipped load is held to the same standard, so a shell that
     drifted from the hydrated page is caught on either. */
  expect(shipped.firstFrame?.heading, 'no heading was painted to measure').toBeTruthy();
  /* EVERY READER WHO HAS NEVER DRAGGED THE COLUMN — which is most of them —
     gets a page whose first frame is its settled frame. Exact, in every
     engine, and it is the assertion that caught the shell drifting from the
     hydrated masthead during this redesign. */
  expect(
    shipped.firstFrame.heading,
    `the shipped page painted its heading at ${shipped.firstFrame.heading} and settled it at ${shipped.settledHeading}; the shell reserves a different page from the one that mounts`
  ).toEqual(shipped.settledHeading);

  /* WHAT IS NOT ASSERTED, AND WHY, so nobody reads the silence as coverage or
     "fixes" it the wrong way (owner directive, 2026-09-03, issue 287).
     
     With a stored NON-DEFAULT width the first frame is NOT the settled frame:
     the shell paints the masthead at the default column and the module resizes
     it at mount. MEASURED under this lane's own request interception, which is
     the ordering a real network produces: first frame [240, 280, 960, 297],
     settled [400, 280, 640, 297] — one resize of one element, on the inline
     axis only, once per load, visible only to a reader who has dragged the
     column. The restore lives in the bundle because this origin's CSP admits
     no inline script to run it earlier, and index.html's own comment records
     that the repository declines to widen `default-src` even for its boot
     status line; a column-width restore is not a better reason. CSS cannot
     read storage, the shell must reserve the masthead's exact box to satisfy
     the hydration pin below, and a box equal to the masthead is by definition
     column-dependent — so there is no shape of the shell that is right at
     every stored width. The gap is real, bounded, and named here and in the
     PR body rather than closed by a security posture changed inside a
     redesign. What is asserted for the stored width is the feature itself:
     the restore HAPPENS, which the column and token checks above prove, so a
     page that ignored storage still fails this lane. */

  /* And the engine's own score for the whole load, where an engine keeps one.
     The comparison is against the SHIPPED page rather than against zero: this
     page already scores a small shift as the feed cards resolve (measured
     0.0036 in Chromium at the shipped column, sourced to ARTICLE.feed-card),
     and asserting zero would be asserting somebody else's bug fixed. What
     must hold is that choosing a width costs nothing on top of it. */
  if (chosen.scored) {
    expect(
      chosen.shift,
      `a chosen width scored ${chosen.shift} of layout shift against ${shipped.shift} for the shipped page`
    ).toBeLessThanOrEqual(shipped.shift + 0.001);
    /* ...and both stay inside the Core Web Vitals "good" band, so the claim is
       an absolute one as well as a relative one. */
    expect(chosen.shift).toBeLessThan(0.1);
  }
});

/* THE STATIC SHELL RESERVES THE HYDRATED CHROME, MEASURED (owner directive,
 * 2026-09-03, issue 287). `settled()` above records why this is a floor and
 * not a nicety: the shell in index.html is deliberately the same height as
 * the hydrated chrome, "so that a zero-CLS hydration is possible at all". It
 * was measured nowhere directly — the stored-width lane used to catch a
 * mismatch only when an engine's first animation frame happened to land before
 * hydration, which WebKit does and Chromium never does, so the same defect was
 * red on one engine and invisible on another.
 *
 * This measures it on purpose and in every engine: one load with the entry
 * module refused, which is exactly the shell a visitor sees while the bundle
 * is still on its way, and one ordinary load. The heading and the sheet must
 * be in the same place and the same size in both, or mounting moves the page
 * under a reader who has already started reading it.
 *
 * The chrome row and the band reserve the shell used to hold open are gone
 * with what they reserved for (owner direction, 2026-10-16), so the shell is
 * the name in the same intro block the mounted page draws it in — and J, who
 * arrives with the mounted page, is out of the flow, so he is measured here
 * too: his arrival must move nothing. Since 2026-10-19 the name and J are one
 * centred group, the name keeping J's room as a margin at its end so the
 * shell, which has no J, centres the name exactly where the mounted page
 * does; measured at a phone width as well as a monitor, because the room is a
 * different share of the column at each and both must agree. */
test('the static shell holds the heading where hydration will put it', async ({ page }) => {
  const read = () =>
    page.evaluate(() => {
      const box = (selector) => {
        const node = window.document.querySelector(selector);
        if (node === null) return null;
        const rect = node.getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height].map(Math.round);
      };
      return {
        shell: window.document.querySelector('[data-static-fallback]') !== null,
        heading: box('h1'),
        main: box('main'),
        j: box('.j-flight'),
      };
    });

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    /* The shell alone. Scripts are refused at the network, which is the honest
       boot state issue 239 describes, not a synthetic one. */
    await page.route('**/*.js', (route) => route.abort());
    await page.goto('/');
    await page.waitForLoadState('load');
    /* Both reads wait for the webfonts. The heading's box is its longest word
       now (issue 294), so its width is the FONT's to decide: read in a fallback
       face it is narrower than in the vendored one, and WebKit reached `load`
       before the swap. The claim here is that the shell reserves the hydrated
       page's geometry, not that a font arrives before the load event. */
    await page.evaluate(() => window.document.fonts.ready);
    const before = await read();
    expect(before.shell, `the page did not render its static shell with scripts refused at ${width}px`).toBe(true);
    expect(before.heading, `the shell painted no heading at ${width}px`).not.toBeNull();
    await page.unroute('**/*.js');

    /* The hydrated page, on the same viewport. */
    await visit(page);
    await page.evaluate(() => window.document.fonts.ready);
    const after = await read();
    expect(after.shell, 'the page never hydrated').toBe(false);

    expect(
      after.heading,
      `hydration moved the heading from ${before.heading} to ${after.heading} at ${width}px; the shell reserves a different page from the one that mounts`
    ).toEqual(before.heading);
    expect(before.j, 'the shell draws J, who should arrive with the mounted page').toBeNull();
    expect(after.j, 'the mounted page draws no J').not.toBeNull();
    expect(
      after.main[1],
      `hydration moved the column's top edge from ${before.main[1]} to ${after.main[1]} at ${width}px`
    ).toBe(before.main[1]);
  }
});

test('a poisoned preference lands the page on the width it ships at', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  /* Storage is attacker-writable — a shared machine, another tab, a console
     paste — so each of these is a value the site may genuinely be handed. The
     full battery is executed in tests/column-width.test.mjs; these are the
     shapes worth proving against a real CSS parser, because a browser is the
     one thing that could be persuaded to interpret them. */
  for (const poison of [
    '99999px',
    '-40rem',
    'garbage',
    '',
    '60rem; background: url(https://example.invalid/beacon)',
    '{"rem":60}'
  ]) {
    const context = page.context();
    const fresh = await context.newPage();
    await fresh.setViewportSize({ width: 1440, height: 900 });
    await fresh.addInitScript(
      ([key, value]) => {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          /* Nothing to poison. */
        }
      },
      [columnStorageKey, poison]
    );
    await fresh.goto('/');
    await settled(fresh);
    const column = await columnBox(fresh);
    expect(column.width, `${JSON.stringify(poison)} produced a ${column.width}px column`).toBeCloseTo(
      shippedColumnPx(column),
      0
    );
    expect(column.scrollWidth).toBe(column.clientWidth);
    /* Nothing it contained reached the document: the token holds a length this
       page constructed, and no declaration it smuggled took effect. */
    expect(column.token).toMatch(/^\d+(?:\.\d+)?rem$/);
    await fresh.close();
  }
});

test('a phone gets no handle and the page it has always had', async ({ page }) => {
  await visit(page);
  for (const width of [...phoneWidths, 768, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await settled(page);
    await expect(handles(page), `a ${width}px viewport rendered a resize handle`).toHaveCount(0);
    /* Absent from the DOCUMENT, not merely from the accessibility tree. The
       two guards fail differently and this is the one that separates them: a
       component that stopped asking matchMedia would still be invisible
       behind the stylesheet's display rule, and a lane that only counted
       roles would report that as fine. */
    await expect(
      page.locator('.column-handle'),
      `a ${width}px viewport built a resize handle it then had to hide`
    ).toHaveCount(0);
    const column = await columnBox(page);
    /* Byte for byte the arrangement the phone lanes above already prove: the
       column is the screen less its two gutters and nothing else, and nothing
       scrolls sideways. Issue 241 subtracted a third term here — the lane the
       page reserved for the fixed reading-mode control — and issue 264 retired
       it (the control was document-glued below the handle breakpoint), and the
       control itself went with the footer (owner, 2026-10-19), so nothing
       costs the column a lane at any width. The 100rem token is far above
       every width here (issue 292), so the min() is the viewport's, exactly
       as it always was on a phone. */
    expect(column.width).toBeCloseTo(Math.min(100 * column.rem, width - gutterPx), 0);
    expect(column.scrollWidth).toBe(column.clientWidth);
  }
  /* And the boundary is where the stylesheet says it is, not near it. */
  await page.setViewportSize({ width: railsBreakpointPx - 1, height: 900 });
  await expect(handles(page)).toHaveCount(0);
  await page.setViewportSize({ width: railsBreakpointPx, height: 900 });
  await expect(handles(page)).toHaveCount(2);
});

test('every width the handle can reach keeps every section intact', async ({ page }) => {
  /* The owner's own scenario, and the mid-range with it: "users making the
     website very small, the width very small". The smallest window that has
     handles at all, and then the whole continuous range across it — extremes
     alone would miss a section that only breaks halfway. */
  await page.setViewportSize({ width: railsBreakpointPx, height: 900 });
  await visit(page);
  const range = await page.evaluate(() => {
    const handle = window.document.querySelector('.column-handle');
    return {
      min: Number(handle.getAttribute('aria-valuemin')),
      max: Number(handle.getAttribute('aria-valuemax'))
    };
  });
  const widths = [
    ['its minimum', range.min],
    ['a quarter along its range', range.min + (range.max - range.min) * 0.25],
    ['halfway along its range', range.min + (range.max - range.min) * 0.5],
    ['its maximum', range.max],
    /* And one width no handle could ever ask for. The two clamps stand in
       front of each other, so a lane driven from aria-valuemax measures the
       SCRIPT's ceiling and would keep passing with the stylesheet's removed
       (measured: breaking the rail reservation in CSS left this lane green).
       Writing the token straight past the script is what puts the browser's
       own ceiling under measurement. */
    ['a width past anything the handle can ask for', 100 * 16]
  ];

  for (const [name, target] of widths) {
    await page.evaluate((value) => {
      window.document.documentElement.style.setProperty('--page-column-width', `${value / 16}rem`);
    }, target);
    await settled(page);
    const state = await page.evaluate(() => {
      /* THE LEDGER'S OWN BLOCKS (owner directive, 2026-09-03, issue 287).
         The three-column boss table is retired; what has to survive every
         column width now is the marquee strip and the flip-square board, so
         those are what is counted. */
      const strip = window.document.querySelector('.ticker-strip');
      const readable = [...strip.querySelectorAll('.ticker-lane')].filter(
        (lane) => lane.getAttribute('aria-hidden') !== 'true'
      );
      /* The gallery's TILES, since the frame they used to be one of retired
         (owner directive, 2026-09-03, issue 287). The row is measured against
         its own column here rather than against a ceiling: every cell keeps
         its square and the row keeps filling the column, at every width a
         reader can drag the page down to. */
      const gridBox = window.document.querySelector('.gallery-grid').getBoundingClientRect();
      const tiles = [...window.document.querySelectorAll('.gallery-tile')].map((tile) => {
        const box = tile.getBoundingClientRect();
        return { width: box.width, height: box.height };
      });
      /* Against the column's CONTENT box since the Keep framed the sheet
         (owner direction, 2026-10-16): the frame and the sheet's own padding
         are the column's margin now, and the row is held to reach both of
         the content box's edges — the same box every other block fills. */
      const main = window.document.querySelector('main');
      const mainBox = main.getBoundingClientRect();
      const mainStyle = getComputedStyle(main);
      const contentLeft =
        mainBox.left + Number.parseFloat(mainStyle.borderLeftWidth) + Number.parseFloat(mainStyle.paddingLeft);
      const contentRight =
        mainBox.right - Number.parseFloat(mainStyle.borderRightWidth) - Number.parseFloat(mainStyle.paddingRight);
      const galleryFill = {
        left: Math.round((gridBox.left - contentLeft) * 10) / 10,
        right: Math.round((contentRight - gridBox.right) * 10) / 10,
      };
      const chronicle = (selector) => window.document.querySelector(selector)?.getBoundingClientRect().width ?? 0;
      const root = window.document.documentElement;
      return {
        column: window.document.querySelector('main').getBoundingClientRect().width,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        tickerItems: readable.reduce(
          (count, lane) => count + lane.querySelectorAll('.ticker-item').length,
          0
        ),
        tickerPans: strip.scrollWidth > strip.clientWidth,
        tickerOverflow: getComputedStyle(strip).overflowX,
        /* The board cards and the heatmap strips retired into ONE diagram
           (owner direction, 2026-10-16): the chronicle's accounts are what
           the cards were, and its calendar and graph are what the strips
           were. Counting nodes alone would pass a diagram squeezed to
           nothing, so the graph and the calendar must keep a drawable box
           at every width as well — at least the 44px every control on this
           page clears, because the graph IS a control (a slider). */
        accounts: window.document.querySelectorAll('.chronicle-account').length,
        days: window.document.querySelectorAll('.chronicle-cell').length,
        chartWidth: chronicle('.chronicle-chart'),
        calendarWidth: chronicle('.chronicle-calendar'),
        /* The nav left with the chrome row (owner direction, 2026-10-16); J,
           who left it too, is the chrome that has to survive every width. */
        marks: window.document.querySelectorAll('.j-flight').length,
        sections: window.document.querySelectorAll('.page-section').length,
        rails: [...window.document.querySelectorAll('.column-handle')].map((handle) => {
          const rail = handle.getBoundingClientRect();
          return { left: rail.left, right: rail.right };
        }),
        tiles,
        galleryFill,
        /* Nothing anywhere escapes its own box: the same containment rule the
           phone lane proves, asked at every width a reader can produce. Asked
           of CSS boxes: an SVG's own box is one, but the shapes and text
           inside it are not, and Blink answers `scrollWidth` for an SVG
           <text> with a number that is no box's width at all (1,200–1,550 for
           a three-letter month at an 18rem column, measured 2026-10-16). The
           drawing inside the diagram's SVG is held to the diagram's box by
           its own lane, measured as geometry. */
        escaping: [...window.document.querySelectorAll('body *')]
          .filter((node) => {
            if (node instanceof SVGElement && !(node instanceof SVGSVGElement)) return false;
            if (node.scrollWidth <= root.clientWidth) return false;
            for (let parent = node; parent instanceof HTMLElement; parent = parent.parentElement) {
              const overflow = getComputedStyle(parent).overflowX;
              if (['auto', 'scroll', 'hidden', 'clip'].includes(overflow)) return false;
            }
            return true;
          })
          .map((node) => `${node.tagName.toLowerCase()}.${node.getAttribute('class')}`)
      };
    });

    const at = `at ${name} (${Math.round(state.column)}px)`;
    expect(state.column, `${at} the column is outside its own bounds`).toBeGreaterThanOrEqual(
      range.min - 1
    );
    expect(state.column).toBeLessThanOrEqual(range.max + 1);
    expect(state.scrollWidth, `the page scrolls sideways ${at}`).toBe(state.clientWidth);
    /* The handles stay on the column's edges and inside the page — which is
       what the reserved lanes in the ceiling exist for, and the thing that
       fails first when that reservation goes. */
    for (const rail of state.rails) {
      expect(rail.left, `a handle starts ${rail.left}px off the page ${at}`).toBeGreaterThanOrEqual(
        -subPixel
      );
      expect(rail.right, `a handle reaches ${rail.right}px past the page ${at}`).toBeLessThanOrEqual(
        state.clientWidth + subPixel
      );
    }
    expect(state.escaping, `content escapes its box ${at}`).toEqual([]);
    /* The whole collection is still in the strip, and the strip is still the
       thing that scrolls rather than the page — at every width, not only at
       the one the ticker was designed against. A narrow column is exactly
       where a band would be tempted to push the document sideways, and the
       page-level check above would catch that; this is the other half, that
       it did not silently drop entries to avoid it. */
    expect(state.tickerItems, `the ticker lost entries ${at}`).toBeGreaterThan(50);
    expect(state.tickerOverflow, `the ticker stopped being a scroller ${at}`).toBe('auto');
    expect(state.tickerPans, `the ticker has nothing left to pan ${at}`).toBe(true);
    expect(state.accounts, `the chronicle's accounts disappeared ${at}`).toBeGreaterThan(0);
    expect(state.days, `the chronicle's calendar drew no days ${at}`).toBeGreaterThan(0);
    expect(state.chartWidth, `the chronicle's graph is ${state.chartWidth.toFixed(1)}px wide ${at}`).toBeGreaterThan(touchFloorPx);
    expect(
      state.calendarWidth,
      `the chronicle's calendar is ${state.calendarWidth.toFixed(1)}px wide ${at}`
    ).toBeGreaterThan(touchFloorPx);
    expect(state.marks, `J is not drawn exactly once ${at}`).toBe(1);
    expect(state.sections, `the page lost a section ${at}`).toBeGreaterThan(2);
    /* The pictures still reserve the boxes they will fill, and since
       2026-09-03 those boxes are a ROW of squares rather than one capped
       stage (owner directive, issue 287). Two properties are under test at
       every column width, and neither is a number this file or the
       stylesheet states: every tile stays SQUARE, so a narrow column shrinks
       the work rather than distorting it, and the row still reaches both of
       the column's edges, so no width a reader can drag to reopens the dead
       gutter the redesign closed. The 448px ceiling this block used to
       compare against is gone with the frame it capped — a cap on a row that
       is supposed to span its column would BE the defect — and what replaced
       it as the independent expectation is the column itself, measured on
       the same page in the same pass. */
    expect(state.tiles.length, `the gallery rendered no tiles ${at}`).toBeGreaterThan(0);
    for (const [index, tile] of state.tiles.entries()) {
      expect(tile.width, `gallery tile ${index + 1} reserves nothing ${at}`).toBeGreaterThan(0);
      expect(
        tile.height,
        `gallery tile ${index + 1} is ${tile.width.toFixed(1)}x${tile.height.toFixed(1)} ${at}, not square`
      ).toBeCloseTo(tile.width, 0);
    }
    expect(
      state.galleryFill.right,
      `the gallery row stops ${state.galleryFill.right}px short of the column ${at}`
    ).toBeLessThanOrEqual(1);
    expect(
      state.galleryFill.left,
      `the gallery row starts ${state.galleryFill.left}px inside the column ${at}`
    ).toBeLessThanOrEqual(1);
  }
});

test('the drag writes once a frame and never stalls on layout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  /* A synthetic sweep, dispatched in ONE task: 120 pointer moves with no
     opportunity for the browser to render between them. Whatever the handler
     does, at most one animation frame can run across the whole burst — so the
     number of style writes it produces is the throttle, measured rather than
     asserted. An unthrottled handler writes 120 times here. */
  const swept = await page.evaluate(() => {
    const handle = window.document.querySelector('.column-handle[data-edge="end"]');
    const box = handle.getBoundingClientRect();
    const y = Math.min(Math.max(box.top + 80, 24), window.innerHeight - 24);
    const writes = [];
    const original = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function patched(name, value, priority) {
      if (name === '--page-column-width') writes.push(value);
      return original.call(this, name, value, priority);
    };
    const send = (type, x) =>
      handle.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 7,
          isPrimary: true,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true
        })
      );
    const startX = box.left + box.width / 2;
    const began = performance.now();
    send('pointerdown', startX);
    for (let step = 1; step <= 120; step += 1) send('pointermove', startX + step);
    const moves = performance.now() - began;
    send('pointerup', startX + 120);
    CSSStyleDeclaration.prototype.setProperty = original;
    return { writes, moves, dispatched: 120 };
  });

  /* At most one write for the whole burst, plus the one the release commits.
     The invariant is "never more than one per frame"; a burst inside a single
     task is the sharpest place to observe it. */
  expect(
    swept.writes.length,
    `${swept.dispatched} pointer moves produced ${swept.writes.length} style writes`
  ).toBeLessThanOrEqual(2);
  /* ...and it is not vacuous: the sweep really did resize the column. */
  const column = await columnBox(page);
  expect(column.token).toMatch(/^\d+(?:\.\d+)?rem$/);
  /* Speed, as a number rather than a feeling: 120 pointer moves cost this
     much wall clock, and they cost it because nothing in the handler reads
     layout. The threshold is generous by two orders of magnitude — several
     agent lanes share this machine — so only a handler that started measuring
     the page on every move can breach it. */
  expect(swept.moves, `120 pointer moves took ${swept.moves.toFixed(1)}ms`).toBeLessThan(250);
});

/* ===========================================================================
 * Filled width beats the reading measure (owner directive 2026-08-26,
 * issue 212)
 *
 * The rendered half of the standing rule. tests/experience.test.mjs pins the
 * DECLARATIONS — no bare inline cap outside one named exception — which binds
 * every surface including the ones this page does not render yet. This binds
 * the ones it does: what an engine actually laid out.
 *
 * The two are not redundant and neither substitutes for the other. A source
 * pin cannot see a box that a flex parent, a grid track or a shrink-to-fit
 * ancestor left short with no cap anywhere in sight; a lane cannot see a cap
 * written for a component that has not shipped. The measurement is the one
 * the owner made by eye three times: where does the text stop, relative to
 * where the card's padding says it should.
 * ======================================================================== */

/* The card-body surfaces the ruling covers, by the class the page gives them
 * (owner directive, 2026-09-03, issue 287). It was a summary paragraph and a
 * bullet list on the retired feed cards; the ledger's one card-body prose
 * surface is the accomplishments list inside a role's drawer, so that is what
 * the ruling covers now.
 *
 * The repository table's description cell is DELIBERATELY not here. It is one
 * column of a ruled row, sized against its neighbours, and it is supposed to
 * stop where its column stops — measuring it against the card's own edge would
 * assert that a table has no columns. Its own geometry is pinned by the repo
 * table lane instead. */
const filledCardBodies = ['.ledger-points'];

/* The widths this rule is measured at, and why they are COLUMN values rather
 * than only viewport ones. The page ships at its 100rem ceiling now (issue
 * 292), bounded by each viewport's own lanes, so the viewport loop measures
 * the fill at two bounded widths. The axis that genuinely changes a card's
 * width is the reader's own column drag, so the sweep drives that token
 * directly as well, exactly as the strip lane above drives it: 60rem, the
 * width the page used to ship at and a mid-range a reader can narrow to, and
 * the 100rem ceiling, where a re-introduced cap would leave the widest dead
 * band this page can produce (measured: 902px of a 1574px card). */
const filledColumnWidths = ['60rem', '100rem'];

/* One measurement pass over every card on the page. Returns one row per
 * card-body block: how far its own box stops short of the card's content edge,
 * how many lines the engine drew inside it, and how far the longest of those
 * lines stops short. */
const measureCardFill = (page) =>
  page.evaluate((selectors) => {
    const px = (value) => Number.parseFloat(value) || 0;
    /* The card's own content edge, derived from the CARD exactly the way the
       stylesheet derives it: its border box less its border and the padding
       the token layer put there. Measuring against .feed-card-body's box
       instead would compare the container with itself and stay green on a card
       whose body was the thing that shrank. */
    const contentEnd = (element) => {
      const style = getComputedStyle(element);
      return (
        element.getBoundingClientRect().right - px(style.paddingRight) - px(style.borderRightWidth)
      );
    };
    /* Every text RUN inside a block, as the list of line boxes the engine drew
       for it. One run per text node, walked recursively, so a bullet list
       reports each item separately — and that separation is the whole point.
       Counting line boxes across the block would call a two-bullet card
       "wrapped" when neither bullet wrapped at all, which is how a first
       version of this lane produced a false failure at a 100rem column. */
    const textRuns = (element) => {
      const runs = [];
      const walk = (node) => {
        if (node.nodeType === 3) {
          if (!node.data.trim()) return;
          const range = window.document.createRange();
          range.selectNodeContents(node);
          const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
          /* Each run carries the END EDGE OF THE BOX IT WAS LAID OUT IN, not
             the card's (owner directive, 2026-09-03, issue 287). A broken line
             stands within one word of the width ACTUALLY AVAILABLE TO IT, and
             what is available is its own containing block — which is the card
             for a full-width paragraph and one track for a list the ledger
             lays out in two columns. Measuring every line against the card
             would call a correctly filled second column a two-thirds failure.
             For the single-column blocks this rule was written against the two
             edges are the same edge, so nothing is relaxed where the old shape
             held. */
          if (rects.length > 0) {
            runs.push({ rects, end: node.parentElement.getBoundingClientRect().right });
          }
          return;
        }
        if (node.nodeType !== 1) return;
        if (getComputedStyle(node).display === 'none') return;
        for (const child of node.childNodes) walk(child);
      };
      walk(element);
      return runs;
    };
    const rows = [];
    const prop = Number.parseFloat(getComputedStyle(window.document.documentElement).getPropertyValue('--keep-prop'));
    for (const card of window.document.querySelectorAll('.feed-card')) {
      const edge = contentEnd(card);
      for (const selector of selectors) {
        for (const block of card.querySelectorAll(selector)) {
          const runs = textRuns(block);
          /* A ROLE OPENS AS A SCROLL (owner, 2026-10-19): its points are set
             on a parchment inset from the card by three prop pixels a side,
             so the paper's rollers can be a little wider than the paper. The
             block is held to the PARCHMENT's content edge, and the parchment
             to exactly that inset from the card's — so a cap on the block, or
             a parchment narrowed past its stated inset, still fails here. */
          const parchment = block.closest('.ledger-scroll');
          /* The line boxes that PROVE a width: every line of a wrapped run
             except its last. A last line is as long as the sentence ran out —
             a layout tells you nothing there — but a line the engine chose to
             BREAK was broken because the next word did not fit, so it stands
             within one word of the width actually available. */
          const broken = runs.flatMap((run) =>
            run.rects.slice(0, -1).map((rect) => run.end - rect.right)
          );
          rows.push({
            selector,
            card: Math.round(card.getBoundingClientRect().width),
            short: (parchment === null ? edge : contentEnd(parchment)) - block.getBoundingClientRect().right,
            inset: parchment === null ? null : edge - parchment.getBoundingClientRect().right,
            prop,
            runs: runs.length,
            broken: broken.length,
            /* The WORST of them: the broken line that stops furthest from its
               own containing block's edge. */
            ink: broken.length === 0 ? 0 : Math.max(...broken),
          });
        }
      }
    }
    return rows;
  }, filledCardBodies);

/* The rule itself, applied to one measurement pass. `where` names the width
 * the pass was taken at, so a failure says which one it was. */
function expectCardsFilled(observed, where) {
  /* Vacuity guards, both halves. This lane proves nothing if the page rendered
     no cards, so both surfaces must be present — the work log's bullets and
     the project log's summaries... */
  for (const selector of filledCardBodies) {
    expect(
      observed.filter((row) => row.selector === selector).length,
      `${where} rendered no ${selector}; this lane measured nothing`
    ).toBeGreaterThan(0);
  }
  /* ...and at least one line must have been BROKEN somewhere on the page, or
     the line half of the rule never executes and this silently degrades to a
     box-only check. */
  expect(
    observed.reduce((total, row) => total + row.broken, 0),
    `nothing wrapped at ${where}, so the line-length half of this rule proved nothing`
  ).toBeGreaterThan(0);

  for (const row of observed) {
    /* The card has to be wide enough for the defect to be visible at all, or
       "it fills" is a claim about a box nobody could see leaning. */
    expect(
      row.card,
      `a card holding ${row.selector} is only ${row.card}px wide at ${where}`
    ).toBeGreaterThan(ribbonPx);
    /* THE RULE. The block's own box ends ON the content edge of the surface
       it is set on: the card's, or since 2026-10-19 the role's parchment,
       which sits exactly its three prop pixels inside the card's. The padding
       is the only thing between the text and its edge, and nothing narrows it
       further. Before the ruling this read 262.0px short for .entry-points and
       270.0px for .entry-summary. */
    if (row.inset !== null) {
      expect(
        row.inset,
        `the parchment holding ${row.selector} is inset ${row.inset.toFixed(1)}px from the card's content edge at ${where}, not its three ${row.prop}px prop pixels`
      ).toBeCloseTo(3 * row.prop, 1);
    }
    expect(
      row.short,
      `${row.selector} stops ${row.short.toFixed(1)}px short of its surface's content edge at ${where} (${((row.short / row.card) * 100).toFixed(1)}% of the card left blank)`
    ).toBeLessThanOrEqual(subPixel);
    /* ...and does not overhang it either, which is the opposite defect and the
       one that takes the document sideways. */
    expect(
      row.short,
      `${row.selector} overhangs the card's content edge at ${where}`
    ).toBeGreaterThanOrEqual(-subPixel);
    /* The ink follows the box — but only where the engine made a width
       DECISION. A run drawn on one line is as long as its sentence and no
       longer ("Welcome to my personal website" is thirty characters; no width
       made it that), so measuring it would refuse honest short copy. A line
       the engine BROKE is different: it broke because the next word did not
       fit, so it stands within one word of the width the block really had.
       Every such line must run out to within a third of the card, or the box
       is filling while the text inside it still sits in a narrow column —
       which is the defect wearing a wider box, and the only way a cap
       reintroduced anywhere but max-inline-size could hide from the check
       above. */
    if (row.broken > 0) {
      expect(
        row.ink,
        `a line inside ${row.selector} was broken ${row.ink.toFixed(1)}px short of its own block's edge in a ${row.card}px card at ${where}; the box fills but the text does not`
      ).toBeLessThan(row.card / 3);
    }
  }
}

test('card text fills the card and stops at its padding, never two thirds of the way across (issue 212)', async ({
  page,
}) => {
  await visit(page);
  /* THE PROSE IS BEHIND A DISCLOSURE NOW (owner directive, 2026-09-03, issue
     287): the accomplishments live in each role's drawer and the section opens
     as a summary, so every drawer is opened before anything is measured. A
     closed drawer is clipped to nothing, and measuring one would report a
     block that fills its card perfectly by being empty. */
  const drawers = page.locator('#work .ledger-row');
  const drawerCount = await drawers.count();
  expect(drawerCount, 'the experience section rendered no role rows to open').toBeGreaterThan(0);
  for (let index = 0; index < drawerCount; index += 1) {
    await drawers.nth(index).click();
  }
  for (const width of desktopWidths) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    expectCardsFilled(await measureCardFill(page), `a ${width}px viewport`);
  }
  /* The reader's own column, across its range. This is the axis the viewport
     loop above cannot reach: at both of those widths the column is whatever
     the viewport's lanes leave it, so without this the rule would never be
     measured at a width the reader chose. */
  for (const column of filledColumnWidths) {
    await page.evaluate((value) => {
      window.document.documentElement.style.setProperty('--page-column-width', value);
    }, column);
    await settled(page);
    expectCardsFilled(await measureCardFill(page), `a ${column} page column`);
  }
  await page.evaluate(() =>
    window.document.documentElement.style.removeProperty('--page-column-width')
  );
});

/* A ROLE OPENS AS A SCROLL (owner, 2026-10-19: "when you open up the work
 * experience have it open up like a scroll instead of just re-using the plain
 * background"). The points and the link are set on a parchment in the day's
 * inks; its upper roller is the parchment's own first box, inside the
 * drawer's clip, and its lower roller is the drawer's second row, after the
 * clip, shown only while the role is open. Measured with the motion reduced,
 * where the scroll is simply open, so every box is read at rest:
 *   - closed, no roller shows: the clip shows nothing (so neither the paper nor
 *     its upper roller is on the page) and the lower roller takes no box;
 *   - open, both show, each eight prop pixels tall and drawn as a picture, the
 *     upper one inside what the clip shows and the lower one directly under
 *     the parchment;
 *   - the parchment's ink is legible ON THE PARCHMENT at the 4.5:1 text floor,
 *     measured against the paper's own colour as the engine resolved it;
 *   - and nothing outside the drawer moves except by the drawer's own growth:
 *     the role's row and the section's head stand still, and the next role and
 *     the next section move down by exactly what the drawer grew. */
test('a role opens as a scroll: no rollers while closed, both when open, legible ink on the parchment, and nothing moves but by the drawer (owner 2026-10-19)', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await visit(page);
  expect(await page.locator('#work .ledger-entry').count(), 'the experience section drew fewer than two roles').toBeGreaterThan(1);
  const read = () =>
    page.evaluate(() => {
      const entry = window.document.querySelector('#work .ledger-entry');
      const doc = (node) => {
        const rect = node.getBoundingClientRect();
        return {
          top: Math.round((rect.top + window.scrollY) * 100) / 100,
          bottom: Math.round((rect.bottom + window.scrollY) * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
        };
      };
      const scroll = entry.querySelector('.ledger-scroll');
      const end = entry.querySelector('.ledger-scroll-end');
      const roller = getComputedStyle(scroll, '::before');
      const endStyle = getComputedStyle(end);
      const resolve = (token) => {
        const probe = window.document.createElement('span');
        probe.style.color = `var(${token})`;
        scroll.appendChild(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      };
      const link = scroll.querySelector('.ledger-link');
      return {
        prop: Number.parseFloat(getComputedStyle(window.document.documentElement).getPropertyValue('--keep-prop')),
        row: doc(entry.querySelector('.ledger-row')),
        drawer: doc(entry.querySelector('.ledger-drawer')),
        clip: doc(entry.querySelector('.ledger-drawer-clip')),
        parchment: doc(scroll),
        upper: { content: roller.content, display: roller.display, height: Number.parseFloat(roller.height), picture: roller.backgroundImage },
        lower: { display: endStyle.display, box: endStyle.display === 'none' ? null : doc(end), picture: endStyle.backgroundImage },
        paper: resolve('--keep-parchment'),
        inks: [
          ['a point', getComputedStyle(scroll.querySelector('.ledger-point')).color],
          ...(link === null ? [] : [['the link', getComputedStyle(link).color]]),
        ],
        next: doc(entry.nextElementSibling.querySelector('.ledger-row')),
        head: doc(window.document.querySelector('#work .section-head')),
        after: doc(window.document.querySelector('#projects')),
      };
    });

  const closed = await read();
  expect(closed.clip.height, 'a closed role shows part of its scroll').toBeLessThanOrEqual(subPixel);
  expect(closed.lower.display, 'a closed role draws its lower roller').toBe('none');

  await page.locator('#work .ledger-entry').first().locator('.ledger-row').click();
  await settled(page);
  const open = await read();
  const roller = 8 * open.prop;
  expect(open.prop, 'the prop pixel token resolves to nothing').toBeGreaterThan(0);
  expect(open.upper.content, 'the open scroll draws no upper roller').not.toBe('none');
  expect(open.upper.height, `the upper roller is ${open.upper.height}px, not eight prop pixels`).toBeCloseTo(roller, 1);
  expect(open.upper.picture, 'the upper roller paints no picture').not.toBe('none');
  expect(open.parchment.top, 'the parchment starts above what the open clip shows').toBeGreaterThanOrEqual(open.clip.top - subPixel);
  expect(open.parchment.top + roller, 'the upper roller is cut off by the clip').toBeLessThanOrEqual(open.clip.bottom + subPixel);
  expect(open.lower.display, 'the open scroll draws no lower roller').not.toBe('none');
  expect(open.lower.box.height, `the lower roller is ${open.lower.box.height}px, not eight prop pixels`).toBeCloseTo(roller, 1);
  expect(open.lower.picture, 'the lower roller paints no picture').not.toBe('none');
  expect(
    Math.abs(open.lower.box.top - open.parchment.bottom),
    `the lower roller starts ${(open.lower.box.top - open.parchment.bottom).toFixed(2)}px from the parchment's foot`
  ).toBeLessThanOrEqual(1);
  for (const [what, ink] of open.inks) {
    const ratio = contrastRatio(ink, open.paper);
    expect(ratio, `${what} is ${ink} on the parchment ${open.paper}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  }

  const grew = open.drawer.height - closed.drawer.height;
  expect(grew, 'opening the role grew its drawer by nothing').toBeGreaterThan(roller);
  expect(open.row.top, 'the role’s own row moved when it opened').toBeCloseTo(closed.row.top, 1);
  expect(open.head.top, 'the section’s head moved when a role opened').toBeCloseTo(closed.head.top, 1);
  expect(open.next.top - closed.next.top, 'the next role moved by something other than the drawer’s growth').toBeCloseTo(grew, 0);
  expect(open.after.top - closed.after.top, 'the next section moved by something other than the drawer’s growth').toBeCloseTo(grew, 0);
});

/* ===========================================================================
 * MOBILE INTERACTION (issue 219). Four defects the owner reported from an
 * iPhone, each measured here as behaviour in a real engine rather than as a
 * declaration in the source. The source halves live in tests/gesture.test.mjs
 * (the arithmetic), tests/grid.test.mjs and tests/panels-ui.test.mjs (the
 * structure); neither half replaces the other.
 * ======================================================================== */

/* A FINGER, not a cursor, on every engine. The detail binding branches on
 * `event.pointerType === 'touch'`, so proving the touch path means producing a
 * touch pointer — and Playwright's touchscreen API exists only on the two
 * projects configured with hasTouch. Dispatching the PointerEvents directly
 * runs the identical code path on all five, which is the stronger coverage:
 * the desktop engines are exactly where a hybrid laptop's touchscreen lives,
 * and a touch regression there would otherwise be invisible to this matrix.
 * The events are real PointerEvents delivered to the real element from
 * elementFromPoint — what is synthesised is the hand, never the handler. */
async function tapAt(page, x, y) {
  await page.evaluate(
    ([atX, atY]) => {
      const target = window.document.elementFromPoint(atX, atY) ?? window.document.body;
      for (const type of ['pointerdown', 'pointerup']) {
        target.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 33,
            pointerType: 'touch',
            clientX: atX,
            clientY: atY,
            bubbles: true,
          }),
        );
      }
    },
    [x, y],
  );
  await page.waitForTimeout(120);
}

/* DEFECT 1: A VALUE A FINGER CANNOT ASK ABOUT (issue 219; re-aimed 2026-10-16
 * from the heatmap grids to the trackers' one diagram).
 *
 * A calendar encodes magnitude as a colour shade, so a day nobody can
 * interrogate breaks AGENTS.md's dataviz floor — "a value is never encoded by
 * color alone" — on every touch device. The grids this lane measured answered
 * a tap with a readout over the cell; the diagram answers it in its own
 * figures, naming the day and what was measured on it. Measured on BOTH
 * surfaces a finger can land on, the graph and the calendar, on every engine:
 * the touch PointerEvents are dispatched directly, so the desktop engines —
 * where a hybrid laptop's touchscreen lives — run the identical code path the
 * phones do.
 *
 * Deliberately NOT a cell centre on the calendar: a day is a few pixels and a
 * finger is forty-four, so the interaction only works if the calendar resolves
 * the nearest day to wherever the touch actually landed, gaps included. */
test('the diagram answers a tap with a real reading on both of its surfaces, on every engine (issue 219; 2026-10-16)', async ({
  page,
}) => {
  await visit(page);
  const chart = page.locator('.chronicle-chart');
  await chart.scrollIntoViewIfNeeded();
  await diagramAtRest(page);
  const reading = () =>
    page.evaluate(() => {
      const chart = window.document.querySelector('.chronicle-chart');
      const picked = window.document.querySelector('.chronicle-cell[data-picked="true"]');
      return {
        scrubbing: chart.getAttribute('data-scrubbing'),
        now: chart.getAttribute('aria-valuenow'),
        captions: [...window.document.querySelectorAll('.chronicle-caption')].map((node) => node.textContent.trim()),
        picked: picked === null ? null : picked.getAttribute('data-measured'),
        pickedWidth: picked === null ? null : Number.parseFloat(getComputedStyle(picked).strokeWidth),
      };
    });
  const named = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;

  /* The calendar: a tap between days resolves to one and names it. */
  const calendar = await page.locator('.chronicle-calendar').boundingBox();
  await tapAt(page, Math.round(calendar.x + calendar.width * 0.7) + 0.5, Math.round(calendar.y + calendar.height * 0.3));
  const onCalendar = await reading();
  expect(onCalendar.scrubbing, 'a tap on the calendar read no day').toBe('true');
  expect(
    onCalendar.captions.some((caption) => named.test(caption)),
    `a tap on the calendar named no day: ${onCalendar.captions.join(' | ')}`
  ).toBe(true);
  expect(onCalendar.picked, 'a tap on the calendar marked no day').not.toBeNull();
  expect(onCalendar.pickedWidth, 'the calendar picked a day without marking it').toBeGreaterThan(0);

  /* The graph: the same answer, from the line. */
  const graph = await chart.boundingBox();
  await tapAt(page, Math.round(graph.x + graph.width * 0.4), Math.round(graph.y + graph.height / 2));
  const onGraph = await reading();
  expect(onGraph.scrubbing, 'a tap on the graph read no day').toBe('true');
  expect(
    onGraph.captions.some((caption) => named.test(caption)),
    `a tap on the graph named no day: ${onGraph.captions.join(' | ')}`
  ).toBe(true);
  expect(onGraph.now, 'the graph named the same day the calendar did; the two taps were one').not.toBe(onCalendar.now);
});

/* RETIRED 2026-10-16 WITH THE GRID LISTBOX (issue 219's keyboard half). Six
 * lanes measured the heatmap strips' own keyboard cursor — a listbox whose
 * cells took no tab stop and whose arrows moved a cursor through a strip that
 * scrolled: "the keyboard cursor survives a scroll, and every arrow opens a
 * cold strip", "the keyboard cursor is scrolled into its own strip, and a
 * readout panned out of it closes", "bringing the cursor into view is instant,
 * whatever motion the reader asked for", "a refresh keeps the keyboard cursor
 * on the day it named", "the grid listbox owns its options directly", and "a
 * wide grid still pans natively, and never takes the page sideways". Every
 * subject they had — the listbox, its options, its scrollport, its native pan
 * — left with the strips. The diagram that replaced them is ONE slider whose
 * day is read in its own figures and which never scrolls; its keyboard walk,
 * its clamping, its Escape, its refresh and its chords are measured by "the
 * graph walks its days from the keyboard", "a refresh drops the reading rather
 * than re-pointing it at a different day" and "a widget’s arrows do not
 * swallow the browser’s own chords"; its fit by "the calendar fills its column
 * with whole, square days at every width". */

/* DEFECT 2. Nothing was swipeable. The gallery showed one photograph and had
 * only two arrow buttons to move between them.
 *
 * RE-AIMED at the surface a swipe now belongs to (owner directive,
 * 2026-09-03, issue 287): the tile row is a grid a reader scrolls past, and
 * the thing with a next and a previous is the STAGE. The gesture that was
 * added for defect 2 moved there with it, and so did both halves of what this
 * lane has always proved — a deliberate drag turns the page, and a fidget
 * does not.
 *
 * The settle half changed shape rather than going away. The strip followed
 * the finger and eased home, so "settled back" was a transform read off the
 * outgoing item; the stage is commit-only — `move` and `settle` are empty, on
 * purpose, because a picture anchored to the viewport that slid with the
 * finger would slide off it — so the same claim is now that NOTHING is
 * displaced at all, at any point, which is the stronger statement and the one
 * a returning drag-follow would fail. */
test('the stage advances on a swipe and stays put on a fidget (issue 219; owner 2026-09-03, issue 287)', async ({
  page,
}) => {
  await visit(page);
  await page.locator('.gallery-tile[data-gallery-kind="image"]').first().click();
  await expect(page.locator('dialog.gallery-lightbox')).toBeVisible();
  const stage = page.locator('.gallery-stage');
  const counter = page.locator('.gallery-count');
  const readIndex = async () => (await counter.innerText()).trim();
  const start = await readIndex();

  const box = await stage.boundingBox();
  const midY = box.y + box.height / 2;

  // The vertical axis is the page's, unconditionally. This is the single
  // declaration the whole feature rests on.
  expect(
    await stage.evaluate((node) => window.getComputedStyle(node).touchAction),
    'the gallery stage stopped handing vertical panning to the page'
  ).toContain('pan-y');

  /* A finger, dispatched as real PointerEvents with pointerType "touch".
     Playwright's touchscreen API offers only tap(), and its mouse API cannot
     produce a touch pointer at all — so a synthesised sequence is the only way
     to drive the path a thumb actually takes. The events are genuine
     PointerEvents delivered to the real element, so everything downstream of
     `pointerdown` is the shipping code path; what is synthesised is the hand,
     not the handler. */
  const drag = (offsets, gapMs = 0) =>
    page.evaluate(
      async ([xs, y, pause]) => {
        const stageNode = window.document.querySelector('.gallery-stage');
        const send = (type, x) =>
          stageNode.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 21,
              pointerType: 'touch',
              clientX: x,
              clientY: y,
              bubbles: true,
            }),
          );
        send('pointerdown', xs[0]);
        for (const x of xs.slice(1)) {
          send('pointermove', x);
          if (pause > 0) {
            await new Promise((resolve) => setTimeout(resolve, pause));
          }
        }
        send('pointerup', xs.at(-1));
      },
      [offsets, midY, gapMs],
    );

  // A real leftward drag: down, several moves (a single jump is not a drag and
  // the binding is right to ignore it), up.
  await drag([0.8, 0.7, 0.55, 0.4, 0.25].map((at) => box.x + box.width * at));
  await expect(counter, 'a leftward swipe did not advance the stage').not.toHaveText(start);

  // A FIDGET — a few pixels, slowly — must change nothing. This is the half
  // that stops a carousel turning on every touch. Slow AND short: 11px over
  // 180ms clears neither the distance nor the velocity test, which is exactly
  // what a fidget is.
  const held = await readIndex();
  const from = box.x + box.width * 0.6;
  await drag([from, from - 4, from - 8, from - 11], 60);
  await page.waitForTimeout(320);
  expect(await readIndex(), 'a small slow drag turned the page anyway').toBe(held);

  /* ...and NOTHING WAS EVER DISPLACED. The commit-only binding writes no
     offset at all, so the picture, the stage around it and the dialog holding
     both must every one of them sit at an identity transform after a
     committed turn and after a refused one alike. A reintroduced drag-follow
     — or a settle that failed to come home, which is the pull-to-refresh
     defect in another costume — shows up here as a translation. */
  const resting = await page.evaluate(() =>
    ['dialog.gallery-lightbox', '.gallery-stage', '.gallery-lightbox-image'].map((selector) => {
      const node = window.document.querySelector(selector);
      const matrix = new DOMMatrixReadOnly(window.getComputedStyle(node).transform);
      return { selector, x: matrix.m41, y: matrix.m42 };
    })
  );
  for (const surface of resting) {
    expect(
      Math.abs(surface.x) + Math.abs(surface.y),
      `${surface.selector} is displaced by ${surface.x},${surface.y} after the gesture`
    ).toBeLessThan(1);
  }
});

/* THE ARRIVAL-DIRECTION LANE IS DELETED (owner directive, 2026-09-03, issue
 * 287: the strip is gone). "A committed swipe brings the new item in from its
 * own side" (issue 265, defect 5) measured the frames an engine painted after
 * a release, because the strip mounted the incoming item at the old drag
 * offset and eased it home from the wrong direction — 120-202px of backwards
 * travel per swipe on 0.1.65. The stage has no drag offset to mount anything
 * at and no settle to ease: `move` and `settle` are empty and a turn is a
 * state change, so there is no travel to have a direction. The arithmetic
 * that produced the defect (entryOffset, boundedDrag) is still owned by
 * tests/gesture.test.mjs, which is where it belongs while nothing paints it.
 *
 * THE FILM-SWIPE LANE IS DELETED with it. "A film swipes like a still until
 * the reader presses play" (issue 243) was about a film sharing the strip's
 * one stage behind a veil that carried the gesture, and .gallery-film-veil
 * does not exist. A film shares the dialog with the stills again since issue
 * 384, but its stage carries no swipe at all — a horizontal drag across a
 * film is the native scrubber's — and the claims that were about the READER
 * are all measured in the film lane earlier in this file: a drag across the
 * film never turns the page, the press on the film's tile is the one start,
 * and that press hands over the native controls.
 *
 * THE OFFSET-WRITE LANE IS DELETED with both. "A dragged gallery writes its
 * offset once a frame, not once an event" (issue 243) counted --gallery-drag
 * writes against painted frames, and the owner's "swiping is NOT very smooth
 * on the phone" was a style invalidation per pointermove. A binding whose
 * `move` is empty writes nothing at all, per frame or per event, which is the
 * limit that lane was pushing toward; frameCoalescer itself is still exercised
 * exhaustively, and deterministically, by tests/gesture.test.mjs. */

test('the gallery is reachable without a gesture, and says where it is (issue 219; issue 275; owner 2026-09-03, issue 287)', async ({
  page,
}) => {
  await visit(page);
  const dialog = page.locator('dialog.gallery-lightbox');
  const counter = page.locator('.gallery-count');

  /* EVERY TILE IS A REAL BUTTON — a tab stop with no roving apparatus to get
     wrong — and it says what pressing it will do rather than leaving a reader
     to infer it from a picture with an empty alt. */
  const tiles = page.locator('.gallery-tile[data-gallery-kind="image"]');
  await expect(tiles).toHaveCount(5);
  const labels = await tiles.evaluateAll((nodes) =>
    nodes.map((node) => ({ tag: node.tagName, label: node.getAttribute('aria-label') }))
  );
  for (const [index, tile] of labels.entries()) {
    expect(tile.tag, `tile ${index + 1} is not a button, so a keyboard cannot reach it`).toBe('BUTTON');
    expect(tile.label, `tile ${index + 1} does not say what opening it will show`).toMatch(
      /^Open photograph: /
    );
  }

  /* A REAL ENTER OPENS THE STAGE — the keyboard equivalent of the press, and
     the thing a click test cannot prove (issue 219 review round 2,
     finding 3). */
  await tiles.first().focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(counter).toHaveText('Photograph 1 of 8');
  await expect(counter, 'the position stopped announcing itself').toHaveAttribute(
    'aria-live',
    'polite'
  );

  /* The stage pair are ordinary buttons too, so an Enter on a focused control
     pages exactly as a press does. */
  const next = page.locator('.gallery-nav[data-gallery-nav="next"]');
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(counter).toHaveText('Photograph 2 of 8');

  // And so do the arrow keys, anywhere inside the open stage.
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText('Photograph 3 of 8');
  await page.keyboard.press('ArrowLeft');
  await expect(counter).toHaveText('Photograph 2 of 8');

  /* ...and Escape leaves by the same road it came in on, handing the tile
     back its focus so the reader is never stranded on the document body. */
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(() => {
      const tileNodes = [...window.document.querySelectorAll('.gallery-tile')];
      return tileNodes.indexOf(window.document.activeElement);
    }),
    'Escape left focus somewhere other than the tile that opened the stage'
  ).toBe(0);
});

/* Finding 4. A SWIPE ATE THE READER'S NEXT ACTIVATION. A drag across a
 * control ends in a click nobody meant, so a real drag suppresses exactly one
 * click — but a touch swipe past the platform's slop produces NO click, and
 * the suppression simply waited for whatever came next. MEASURED in both
 * engines at 390x844: swipe the gallery, focus the control, press a real
 * Enter, and nothing happened.
 *
 * RE-AIMED at the stage (owner directive, 2026-09-03, issue 287). The control
 * a stray click can now reach is not the picture — the picture is not a
 * button any more — it is the prev/next pair sitting INSIDE the swipe
 * surface, which is if anything the sharper form of the same trap: the drag
 * ends with the finger over the control it would otherwise press.
 *
 * Both halves are here, because the cheap repair is to stop suppressing at
 * all — which hands back the accidental turn the suppression exists to
 * prevent. */
test('a swipe does not eat the next activation, and still eats its own click (issue 219; owner 2026-09-03, issue 287)', async ({
  page,
}) => {
  await visit(page);
  await page.locator('.gallery-tile[data-gallery-kind="image"]').first().click();
  await expect(page.locator('dialog.gallery-lightbox')).toBeVisible();
  const stage = page.locator('.gallery-stage');
  const counter = page.locator('.gallery-count');
  const box = await stage.boundingBox();
  const midY = box.y + box.height / 2;
  const xs = [0.8, 0.7, 0.55, 0.4, 0.25].map((at) => box.x + box.width * at);
  /* The position as a NUMBER, so a lane can say how many turns happened
     rather than only that something changed — which is the whole question
     when a suppressed click and a delivered one both leave the counter
     somewhere other than where it started. */
  const position = async () =>
    Number(/Photograph (\d+) of/.exec((await counter.innerText()).trim())[1]);
  const turns = (from, to) => (to - from + 8) % 8;

  /* A hand. Playwright's touchscreen API offers only tap() and its mouse API
     cannot produce a touch pointer at all, so the HAND is synthesised and
     everything downstream of pointerdown is the shipping code path. */
  const drive = (pointerType, thenClickDetail) =>
    page.evaluate(
      ([offsets, y, kind, detail]) => {
        const node = window.document.querySelector('.gallery-stage');
        const control = window.document.querySelector('.gallery-nav[data-gallery-nav="next"]');
        const send = (type, x) =>
          node.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 71,
              pointerType: kind,
              button: 0,
              buttons: 1,
              clientX: x,
              clientY: y,
              bubbles: true,
            }),
          );
        send('pointerdown', offsets[0]);
        for (const x of offsets.slice(1)) send('pointermove', x);
        send('pointerup', offsets.at(-1));
        /* The drag's OWN compatibility click, dispatched in the same task as
           its pointerup — which is exactly how a user agent orders them for a
           mouse, and therefore the only honest way to ask whether the
           suppression still works. It lands on the control the finger ended
           over, which is the press a reader never meant to make. */
        if (detail !== null) {
          control.dispatchEvent(new MouseEvent('click', { detail, bubbles: true, cancelable: true }));
        }
      },
      [xs, midY, pointerType, thenClickDetail],
    );

  const start = await position();
  await drive('touch', null);
  await expect(counter, 'the swipe did not turn the page').not.toHaveText(`Photograph ${start} of 8`);
  const afterSwipe = await position();

  /* An ordinary press of the control, after that swipe. A touch swipe produces
     no click, so the suppression the gesture armed was still waiting — and
     this is the press it ate. */
  await page.locator('.gallery-nav[data-gallery-nav="next"]').click();
  await expect(counter).toHaveText(`Photograph ${((afterSwipe % 8) + 1)} of 8`);

  // The same question from the keyboard, which is where it was measured: a
  // real Enter, after a real swipe.
  const beforeKeyboard = await position();
  await drive('touch', null);
  await expect(counter).not.toHaveText(`Photograph ${beforeKeyboard} of 8`);
  const afterSecondSwipe = await position();
  await page.locator('.gallery-nav[data-gallery-nav="next"]').focus();
  await page.keyboard.press('Enter');
  await expect(
    counter,
    'a swipe ate the reader’s next keyboard activation'
  ).toHaveText(`Photograph ${((afterSecondSwipe % 8) + 1)} of 8`);

  /* ...and the suppression is not simply gone: a drag's own click, in the
     task that ended it, must still be swallowed. The drag itself turns the
     page once; a delivered trailing click would turn it twice. */
  const beforeDrag = await position();
  await drive('mouse', 1);
  await page.waitForTimeout(250);
  const afterDrag = await position();
  expect(
    turns(beforeDrag, afterDrag),
    `a mouse drag moved the stage ${turns(beforeDrag, afterDrag)} places; its own trailing click reached the control`
  ).toBe(1);

  // While an ordinary click, after that gesture is over, still works — or the
  // assertion above would be satisfied by a control that never pages at all.
  await page.locator('.gallery-nav[data-gallery-nav="next"]').click();
  await expect(
    counter,
    'the stage pair stopped paging on an ordinary click'
  ).toHaveText(`Photograph ${((afterDrag % 8) + 1)} of 8`);
});

/* Finding 5. MODIFIER CHORDS ARE THE BROWSER'S AND THE PLATFORM'S. Both new
 * key handlers branched on `event.key` alone, so `Cmd+ArrowLeft` and
 * `Alt+ArrowLeft` (Back) and `Ctrl+Home` (top of document) were all swallowed:
 * measured `defaultPrevented === true` for every one of them on the grid strip
 * and on the token panel's segmented pills. The strip is gone; the widget that
 * owns arrow keys on its surface now is the trackers' graph (re-aimed
 * 2026-10-16), a slider whose handler must make the same distinction. */
test('a widget’s arrows do not swallow the browser’s own chords (issue 219)', async ({ page }) => {
  await visit(page);
  const measured = await page.evaluate(() => {
    const fire = (target, key, mods) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        ...mods,
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    /* Every composite widget on this page that owns arrow keys. The token
       panel's display pills left when the owner deleted the menu on
       2026-08-28, and the gallery's dot radiogroup left with the dots on
       2026-08-31 (issue 275) — the gallery's set-menu listbox is its
       successor, but it mounts only while open on a multi-set strip, so
       this always-rendered sweep cannot reach it and its chord discipline
       is the component's own keydown guard: onSetMenuKeydown opens on
       isChord, asserted by the media-sets pin in tests/sections.test.mjs.
       What remains reachable here is asserted genuinely present below, so
       losing it fails loudly rather than shrinking in silence. */
    const surfaces = {
      graph: window.document.querySelector('.chronicle-chart[role="slider"]'),
    };
    const readings = {};
    for (const [name, node] of Object.entries(surfaces)) {
      if (node === null) {
        readings[name] = null;
        continue;
      }
      readings[name] = {
        bare: fire(node, 'ArrowLeft', {}),
        meta: fire(node, 'ArrowLeft', { metaKey: true }),
        alt: fire(node, 'ArrowLeft', { altKey: true }),
        ctrlHome: fire(node, 'Home', { ctrlKey: true }),
      };
    }
    return readings;
  });

  for (const [name, reading] of Object.entries(measured)) {
    expect(reading, `${name} is not on this page; the sweep proves less than it claims`).not.toBeNull();
    // The widget still owns its own keys — without this the chord assertions
    // below are satisfied by a handler that was simply deleted.
    expect(reading.bare, `${name} stopped handling its own ArrowLeft`).toBe(true);
    expect(reading.meta, `${name} swallowed Cmd+ArrowLeft, which is the browser’s Back`).toBe(false);
    expect(reading.alt, `${name} swallowed Alt+ArrowLeft, which is the browser’s Back`).toBe(false);
    expect(reading.ctrlHome, `${name} swallowed Ctrl+Home, which is top-of-document`).toBe(false);
  }
});

/* A deliberate wide pull: 240px of downward travel, sampled the way a finger
 * reports it. The two wobble variants are the exact first samples measured
 * killing the gesture at HEAD — a 1px upward tremor, and a thumb arc's
 * 10-across/4-down — so each matrix row is a regression that was real. */
const widePull = (x, y0, wobble = []) => [
  [x, y0],
  ...wobble.map(([dx, dy]) => [x + dx, y0 + dy]),
  [x, y0 + 30],
  [x, y0 + 80],
  [x, y0 + 150],
  [x, y0 + 240],
];

test('a horizontal swipe over the enlarged photograph still swipes, downward drift and all (issue 277; owner 2026-09-03, issue 287)', async ({
  page,
}) => {
  /* The Media strip this lane was written against is retired; the surface
     that still arbitrates a horizontal drag against the page's own gestures
     is the STAGE, so that is where the drifting swipe is driven now. The
     ruling is untouched: a swipe whose finger wanders downward is still a
     swipe, and the pull must keep its hands off it. */
  await visit(page);
  await page.locator('.gallery-tile[data-gallery-kind="image"]').first().click();
  await expect(page.locator('dialog.gallery-lightbox')).toBeVisible();
  const stage = page.locator('.gallery-stage');
  const counter = page.locator('.gallery-count');
  const before = (await counter.innerText()).trim();
  const box = await stage.boundingBox();

  /* A leftward swipe whose finger drifts DOWNWARD as it goes — the wobble the
     pull's wider arbitration must keep its hands off. The drift stays under
     the travel (a swipe, not a diagonal), and the swipe must still turn the
     page while the pull claims nothing. */
  const y = box.y + box.height / 2;
  await page.evaluate(
    async ({ left, width, y }) => {
      const send = (type, x, yAt) => {
        const target = window.document.elementFromPoint(x, yAt) ?? window.document.body;
        target.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 278,
            pointerType: 'touch',
            clientX: x,
            clientY: yAt,
            bubbles: true,
          }),
        );
      };
      const frame = () => new Promise((resolve) => window.requestAnimationFrame(resolve));
      send('pointerdown', left + width * 0.8, y);
      for (const [at, drift] of [
        [0.65, 4],
        [0.5, 8],
        [0.35, 12],
        [0.22, 15],
      ]) {
        send('pointermove', left + width * at, y + drift);
        await frame();
      }
      send('pointerup', left + width * 0.22, y + 15);
    },
    { left: box.x, width: box.width, y },
  );

  await expect(counter, 'a drifting horizontal swipe no longer turns the stage').not.toHaveText(
    before,
  );
});

/* REAL TOUCH, THROUGH THE ENGINE'S OWN INPUT PIPELINE (issue 285). Every other
 * touch lane in this file dispatches PointerEvents, which no browser
 * arbitrates — the 0.1.67 header records that those drives kept every lane
 * green while a physical phone was broken. Chromium exposes its input pipeline
 * over the devtools protocol, and a touch dispatched there runs the browser's
 * gesture recogniser exactly as a finger does: the scroll claim, pointercancel,
 * uncancelable follow-up touchmoves. These lanes measure that arbitration
 * rather than the pointer path, so they run on the one engine that offers it
 * and skip where it is not offered (capability, never project name). */
async function realTouchDrive(client, points, stepMs) {
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: points[0].x, y: points[0].y }],
  });
  for (const point of points.slice(1)) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y }] });
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

function straightLine(x, y, dx, dy, steps) {
  return Array.from({ length: steps + 1 }, (_, index) => ({
    x: Math.round(x + (dx * index) / steps),
    y: Math.round(y + (dy * index) / steps),
  }));
}

/* THE NEIGHBOUR-WARMING LANE IS DELETED (owner directive, 2026-09-03, issue
 * 287: the strip is gone). "A real gallery swipe finds its incoming picture
 * already decoded, even on a slow network" (issue 285) drove a real Chromium
 * touch across the strip on a throttled 3G and required zero blank frames
 * after the commit, because the strip warmed its neighbours and the lane
 * proved the warming reached a real engine.
 *
 * There are no neighbours to warm. The stage pages between pictures whose
 * previews the reader has ALREADY loaded — the tile row IS the preview set —
 * and the enlarged <img> carries its own preview as a CSS background, so what
 * paints while the master decodes is the picture the reader was just looking
 * at, at every network speed rather than only the ones a warm cache happened
 * to cover. A lane asserting "never blank" against a background-image would
 * be measuring the engine's compositing rather than this build, and the
 * question it was really asking — does a reader pay for a master they never
 * open — is measured directly by the master-on-demand lane earlier in this
 * file. */

/* THE CALENDAR SHOWS THE DAYS SINCE ITS DATA STOPPED (issue 285; re-aimed
 * 2026-10-16 at the trackers' one diagram, owner direction: "github heatmap is
 * not updating properly, and not catching it means a fault in testing
 * procedures"). This lane's origin serves the embedded snapshot exactly as a
 * cold deployment does — status stale, endDate weeks back — which is the state
 * the live site was measured in: a calendar two weeks old with nothing saying
 * so.
 *
 * Issue 285 answered that twice: a dated line in the head, and a window whose
 * right edge is the reader's own day with every day the payload never reached
 * drawn as a dated absence. The owner removed the line on 2026-09-12 (issue
 * 323); the DRAWN half is what this lane measures, plus the machine-readable
 * status the line was worded from, which stays. In the diagram the window ends
 * on TODAY rather than on the week's last day — a day still in the future is
 * not drawn at all — and every day between the payload's last and today is a
 * hollow day, never a quiet one. Every engine, both viewport classes. */
test('the contributions calendar trails today past a stalled payload, and says so only as data (issues 285, 323; 2026-10-16)', async ({
  page,
  request,
}) => {
  await visit(page);
  const envelope = await (await request.get('/api/panels/vcs-activity')).json();
  expect(envelope.status, 'this lane needs the cold-start snapshot, which serves stale').toBe('stale');
  const endDate = envelope.data.endDate;
  expect(endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  const panel = page.locator('.panel-shell').filter({ has: page.locator('.chronicle') });
  /* NOT A WORD ABOUT IT IN THE HEAD (owner directive, 2026-09-12, issue 323),
     and the reading the head used to word still published as data. */
  await expect(panel.locator('[data-panel-note], .panel-note'), 'the diagram draws a data-through line again').toHaveCount(0);
  await expect(panel).toHaveAttribute('data-panel-status', 'stale');
  const generatedAt = await panel.getAttribute('data-panel-generated-at');
  expect(generatedAt, 'the panel stopped publishing when it was generated').toMatch(/^\d{4}-\d{2}-\d{2}T/);
  /* (The reserved head row this lane also measured is retired for the
     trackers: THE KEEP frames the diagram and the ticker as one board whose
     panels carry no title, and hides their head rows outright — owner
     direction, 2026-10-16. Every OTHER panel's reserve is measured by "a panel
     head with no title keeps the reserved row".) */

  /* The contributions are the roll's LAST seal now — it opens on the first
     token source (owner, 2026-10-21, issue 385) — so the lane presses it
     before it reads their days. The seal is told by the calendar's own green
     ink, not by its place alone: a token seal in that place reads a series
     that stopped elsewhere, and a lane reading it would be measuring the
     wrong payload. */
  const contributions = panel.locator('.chronicle-layers button').last();
  await expect(contributions, 'the last seal is not the contributions').toHaveAttribute('data-tone', 'grid');
  await contributions.click();
  await expect(contributions).toHaveAttribute('aria-pressed', 'true');
  await expect(
    panel.locator('.chronicle-plot'),
    'the graph does not draw the contributions once their seal is pressed'
  ).toHaveAttribute('data-tone', 'grid');
  const observed = await page.evaluate(() => {
    const cells = [...window.document.querySelectorAll('.chronicle-cell')];
    let trailing = 0;
    for (let index = cells.length - 1; index >= 0 && cells[index].getAttribute('data-measured') === 'false'; index -= 1) {
      trailing += 1;
    }
    return {
      cells: cells.length,
      today: cells.at(-1)?.getAttribute('data-today') ?? null,
      trailing,
      months: [...window.document.querySelectorAll('.chronicle-month')].map((month) => month.textContent.trim()),
    };
  });
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const payloadEnd = Date.parse(`${endDate}T00:00:00Z`);
  const expectedTrailing = Math.round((today - payloadEnd) / 86_400_000);
  expect(observed.cells, 'the calendar drew no days').toBeGreaterThan(0);
  expect(observed.today, 'the calendar does not end on today').toBe('true');
  expect(
    observed.trailing,
    `${observed.trailing} hollow days drawn after a payload ending ${endDate}; the calendar should run ${expectedTrailing} days past it`
  ).toBe(expectedTrailing);
  expect(observed.months, 'the calendar does not name the month the reader is in').toContain(
    now.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  );
});

/* A FACE THAT MISSES THE MOUNT MOVES NOTHING WHEN IT LANDS (the review of
 * eaa62d1, finding 1). main.ts mounts the application once its faces load or
 * after a short bound, and every ordinary load in these lanes finishes the
 * preloads inside the bound, so none of them takes the branch where the bound
 * wins. This lane takes it on purpose: every font file is HELD until the lane
 * lets it go — a fixed delay could run out before the first measurement and
 * leave the lane measuring nothing — so the page mounts with every face still
 * on its way. Then the faces are released, the lane waits until the engine
 * reports EACH family loaded (one family landing is not all: the review of
 * 33f9817 held the mono face back and a wait for either one measured before it
 * came), and the name (the display stack, Instrument Serif since 2026-10-19), a role's
 * name (the sans stack), a role's date (the mono stack), the first role row and
 * the page's height must be exactly where they were, with no late family in
 * the stack that sets them. Swapped into painted text, the late face
 * widened the name by 78px and moved the roles by 4px at 1440px (0.013); the
 * mono face, whose figures share its fallback's advance, moved the page by 1px
 * in Chromium and nothing in WebKit, so for it the stack is the evidence. */
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`a face that misses the mount moves nothing when it lands, at ${viewport.width}px`, async ({ page }) => {
    let release = () => {};
    const released = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/*.woff2', async (route) => {
      await released;
      await route.continue();
    });
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      window.__lateShift = { supported: false, armed: false, total: 0 };
      const types = window.PerformanceObserver?.supportedEntryTypes ?? [];
      if (!types.includes('layout-shift')) return;
      window.__lateShift.supported = true;
      new window.PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (window.__lateShift.armed && !entry.hadRecentInput) window.__lateShift.total += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: false });
    });
    /* Not visit(): the load event waits for the preloaded font files, and this
       lane is holding them. settled() still waits for the application. */
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await settled(page);
    const geometry = () =>
      page.evaluate(() => {
        const box = (node) => {
          const rect = node.getBoundingClientRect();
          return [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 100) / 100);
        };
        const name = window.document.querySelector('h1');
        const employer = window.document.querySelector('#work .ledger-name');
        const date = window.document.querySelector('#work .ledger-span');
        return {
          name: box(name),
          employer: box(employer),
          date: box(date),
          role: box(window.document.querySelector('#work .ledger-row')),
          height: window.document.documentElement.scrollHeight,
          stacks: [name, employer, date].map((node) => getComputedStyle(node).fontFamily),
        };
      });
    /* The branch under test, proved rather than assumed: the bound won, so
       every stack was marked before the application mounted. */
    const marked = await page.evaluate(() => [
      window.document.documentElement.getAttribute('data-face-sans'),
      window.document.documentElement.getAttribute('data-face-mono'),
      window.document.documentElement.getAttribute('data-face-display'),
    ]);
    expect(marked, 'the page mounted as though its faces had loaded; the lane is not on the late branch').toEqual([
      'fallback',
      'fallback',
      'fallback',
    ]);
    const before = await geometry();
    await page.evaluate(() => {
      window.__lateShift.armed = true;
    });
    release();
    /* EACH family, by name: an engine may quote a family name, so the quotes
       are dropped before it is compared. */
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            [
              ...new Set(
                [...window.document.fonts]
                  .filter((face) => face.status === 'loaded' && face.style === 'normal')
                  .map((face) => face.family.replace(/["']/g, ''))
                  .filter((family) => family === 'Archivo' || family === 'Instrument Serif' || family === 'JetBrains Mono')
              ),
            ].sort()
          ),
        { message: 'a held face never loaded after release; the lane measured nothing arriving', timeout: 15_000 }
      )
      .toEqual(['Archivo', 'Instrument Serif', 'JetBrains Mono']);
    await settled(page);
    const after = await geometry();
    expect(after.stacks[0], 'the name is set in its late face').not.toMatch(/Instrument Serif/);
    expect(after.stacks[1], 'a role name is set in its late face').not.toMatch(/Archivo/);
    expect(after.stacks[2], 'a role date is set in its late face').not.toMatch(/JetBrains Mono/);
    expect(after.name, 'the name moved when its late face landed').toEqual(before.name);
    expect(after.employer, 'a role name moved when its late face landed').toEqual(before.employer);
    expect(after.date, 'a role date moved when its late face landed').toEqual(before.date);
    expect(after.role, 'the first role row moved when its late face landed').toEqual(before.role);
    expect(after.height, 'the page changed height when its late face landed').toBe(before.height);
    const shift = await page.evaluate(() => window.__lateShift);
    if (shift.supported) {
      expect(shift.total, 'the engine recorded a layout shift as the late faces landed').toBe(0);
    }
  });
}

/* THE NAME'S OWN SUBSET THAT MISSES THE MOUNT MOVES NOTHING EITHER (the review
 * of fc87a89). The lane above holds every file at once. This one holds only
 * Instrument Serif's latin-ext file, the one the name's dotless j is drawn
 * from, and lets every other file load. Waited for with no text, the display
 * stack counted as loaded on its latin file alone, the page mounted with it
 * unmarked, and the j swapped into the painted name when its file landed
 * (Chromium: 288.9px to 273.1px at 1440px, 210.1px to 198.6px at 390px). Now
 * the display stack must mount marked; J must hang over the stem of the j the
 * fallback face drew, which the stylesheet's Instrument Serif metrics alone
 * put 0.17em to its right; and the name and the page must not move when the
 * held file lands. Motion is reduced so J is level and his body's middle is
 * his square's. */
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`the name's late subset moves nothing when it lands, and J keeps to the drawn j, at ${viewport.width}px`, async ({ page }) => {
    let release = () => {};
    const released = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/InstrumentSerif-Regular-latin-ext*.woff2', async (route) => {
      await released;
      await route.continue();
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      window.__lateShift = { supported: false, armed: false, total: 0 };
      const types = window.PerformanceObserver?.supportedEntryTypes ?? [];
      if (!types.includes('layout-shift')) return;
      window.__lateShift.supported = true;
      new window.PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (window.__lateShift.armed && !entry.hadRecentInput) window.__lateShift.total += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: false });
    });
    /* Not visit(): the load event waits for the preloaded file this lane is
       holding. settled() still waits for the application. */
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await settled(page);
    expect(
      await page.evaluate(() => window.document.documentElement.getAttribute('data-face-display')),
      'the page mounted with the display stack unmarked while the j it draws was still on its way'
    ).toBe('fallback');
    const measure = () =>
      page.evaluate(() => {
        const heading = window.document.querySelector('h1');
        const letter = window.document.querySelector('.page-name-j');
        const art = getComputedStyle(letter, '::before');
        const size = parseFloat(art.fontSize);
        const canvas = window.document.createElement('canvas');
        canvas.width = Math.ceil(size * 2);
        canvas.height = Math.ceil(size * 2);
        const ink = canvas.getContext('2d', { willReadFrequently: true });
        ink.font = `${art.fontWeight} ${size}px ${art.fontFamily}`;
        const pad = size / 2;
        const base = size * 1.5;
        ink.fillText(String.fromCodePoint(0x237), pad, base);
        const row = ink.getImageData(0, Math.round(base - ink.measureText('x').actualBoundingBoxAscent / 2), canvas.width, 1).data;
        let first = -1;
        let last = -1;
        for (let x = 0; x < canvas.width; x += 1) {
          if (row[x * 4 + 3] > 128) {
            if (first < 0) first = x;
            last = x;
          }
        }
        const square = window.document.querySelector('.j-flight').getBoundingClientRect();
        const round = (value) => Math.round(value * 100) / 100;
        const box = (node) => {
          const rect = node.getBoundingClientRect();
          return [rect.x, rect.y, rect.width, rect.height].map(round);
        };
        return {
          stem: first < 0 ? null : letter.getBoundingClientRect().left + (first + last) / 2 - pad,
          body: square.left + ((0.075 + 0.8875) / 2) * square.width,
          name: box(heading),
          j: box(window.document.querySelector('.j-flight')),
          height: window.document.documentElement.scrollHeight,
          stack: getComputedStyle(heading).fontFamily,
        };
      });
    const before = await measure();
    expect(before.stem, 'the fallback face drew the dotless j with no stem to measure').not.toBeNull();
    expect(
      Math.abs(before.body - before.stem),
      `J is ${(before.body - before.stem).toFixed(1)}px off the stem of the j the fallback face drew`
    ).toBeLessThanOrEqual(2);
    await page.evaluate(() => {
      window.__lateShift.armed = true;
    });
    release();
    await page.evaluate(() => window.document.fonts.load("1em 'Instrument Serif'", String.fromCodePoint(0x237)));
    await settled(page);
    const after = await measure();
    expect(after.stack, 'the name is set in its late face').not.toMatch(/Instrument Serif/);
    expect(after.name, 'the name moved when the file its j is drawn from landed').toEqual(before.name);
    expect(after.j, 'J moved when the file the j is drawn from landed').toEqual(before.j);
    expect(after.height, 'the page changed height when the file the j is drawn from landed').toBe(before.height);
    const shift = await page.evaluate(() => window.__lateShift);
    if (shift.supported) {
      expect(shift.total, 'the engine recorded a layout shift as the j landed').toBe(0);
    }
  });
}

/* ===========================================================================
 * The Hairline icon family (owner design decision, 2026-09-11, issue 313)
 *
 * Marks replaced words on nine surfaces. The source pins in
 * tests/icons.test.mjs bind the module to the components and the words to the
 * accessibility tree; only an engine can answer the two questions those pins
 * cannot: did a mark MOVE anything, and can a keyboard still get through the
 * chrome it now sits in.
 *
 * Both viewports, because the ledger rows lay out differently on a phone —
 * the row restacks into a mark column, a text column and the chevron — so a
 * measurement taken only at the reading width would be a measurement of one
 * of the two layouts. (The chrome row and its place label, which hid below
 * 45rem, were the other reason, until the row was removed — owner direction,
 * 2026-10-16: "do away with it for now".)
 * ======================================================================== */

const markViewports = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

for (const viewport of markViewports) {
  test(`the marks move nothing on the sheet at ${viewport.width}px`, async ({ page }) => {
    /* The engine's own layout-shift ledger, armed before the navigation so it
       records ACROSS the arrival rather than after it, and attributed: the
       whole page is loading through this window and a ledger that summed the
       document would be measuring the page's load rather than the marks. Only
       Chromium implements the entry type; the box comparisons below are the
       measurement that runs in every engine. */
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript(() => {
      window.__markShift = { supported: false, chrome: 0, roles: 0 };
      const types = window.PerformanceObserver?.supportedEntryTypes ?? [];
      if (!types.includes('layout-shift')) return;
      window.__markShift.supported = true;
      new window.PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.hadRecentInput) continue;
          /* The chrome is the name's own block now — the name and J beside it
             (owner direction, 2026-10-16) — rather than the row it replaced. */
          const chrome = window.document.querySelector('.page-intro');
          const roles = window.document.querySelector('#work');
          for (const source of entry.sources ?? []) {
            if (!source.node) continue;
            if (chrome !== null && chrome.contains(source.node)) {
              window.__markShift.chrome += entry.value;
            }
            if (roles !== null && roles.contains(source.node)) {
              window.__markShift.roles += entry.value;
            }
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await visit(page);
    /* The four role marks are PICTURES since the owner's ruling of 2026-09-12
       (issue 326), so they are waited for rather than assumed: an <img> whose
       bytes never arrived paints an empty frame at exactly the size this lane
       is about to measure, and every box below would be satisfied by it. */
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              [...window.document.querySelectorAll('.ledger-mark')].filter(
                (tile) => tile.complete && tile.naturalWidth > 0
              ).length
          ),
        {
          message:
            'the role marks never decoded; a row is pointing at bytes this build did not emit',
        }
      )
      .toBe(4);

    const observed = await page.evaluate(() => {
      const round = (value) => Math.round(value * 100) / 100;
      const box = (node) => {
        const rect = node.getBoundingClientRect();
        return {
          x: round(rect.x),
          y: round(rect.y),
          width: round(rect.width),
          height: round(rect.height),
        };
      };
      return {
        shift: window.__markShift,
        /* Every mark on the page, as the engine painted it: a mark that
           resolved no size token renders at the SVG default 300x150 and would
           push the row it sits in clean off the sheet — and nothing would go
           red, which is why this is measured rather than assumed. */
        marks: [...window.document.querySelectorAll('.icon')].map((mark) => ({
          classes: mark.getAttribute('class'),
          ...box(mark),
          ink: getComputedStyle(mark).color,
          shapes: mark.children.length,
          /* A mark inside something the page is not showing has no box at
             all, and that is correct rather than broken — but "has no box"
             and "resolved no size" look identical from the outside, so each
             boxless mark has to NAME why. Two reasons are legitimate: the
             enlarged stage is a closed <dialog>, and a section head prints
             the title alone, hiding the number and the mark beside it (owner
             direction, 2026-10-16, when the heads were plaques; plain type
             since 2026-10-19, and still title alone) — named by the computed
             display of the number block itself, so a mark hidden any other
             way is still caught. (The repositories table's phone column head
             and the chrome row's place label were the others, until the table
             became Ongoing Work's one-word heads and the row was removed —
             owner direction, 2026-10-16.) Anything else is a mark nobody can
             see and nobody would notice. */
          laidOut: mark.getClientRects().length > 0,
          hiddenBy:
            mark.closest('dialog:not([open])') !== null
              ? 'the closed stage'
              : mark.closest('.section-number') !== null &&
                  getComputedStyle(mark.closest('.section-number')).display === 'none'
                ? 'the section number the head does not print'
                : 'nothing',
        })),
        /* The mark column: one square per role, all the same size, every
           picture actually decoded, and every employer name starting at the
           same inline offset. A track that varied per row is the defect a
           fixed column exists to prevent, and it is invisible until two rows
           are compared. The organisation's own tile replaced the monogram on
           the owner's ruling of 2026-09-12 (issue 326), so "square" is now a
           claim about a PICTURE: a tile the bundler emitted at some other
           aspect would be drawn into this box and distorted. */
        markTiles: [...window.document.querySelectorAll('.ledger-mark')].map((tile) => ({
          ...box(tile),
          tag: tile.tagName,
          alt: tile.getAttribute('alt'),
          name: tile.closest('.ledger-row')?.querySelector('.ledger-name')?.textContent.trim() ?? null,
          decoded: tile.complete && tile.naturalWidth > 0,
          square: tile.naturalWidth === tile.naturalHeight,
          sameOrigin:
            new URL(tile.currentSrc || tile.src, window.location.href).origin ===
            window.location.origin,
        })),
        names: [...window.document.querySelectorAll('.ledger-name')].map((node) => box(node).x),
        /* No sideways scroll: the ledger row gained a column, and that is the
           kind of addition that pushes a 390px sheet into a horizontal
           scrollbar. */
        documentWidth: window.document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });

    if (observed.shift.supported) {
      expect(observed.shift.chrome, 'the name or J beside it shifted as the page loaded').toBeLessThan(0.01);
      expect(observed.shift.roles, 'the roles section shifted as the page loaded').toBeLessThan(0.01);
    }

    expect(observed.marks.length, 'the page draws no marks at all').toBeGreaterThan(5);
    for (const mark of observed.marks.filter((candidate) => !candidate.laidOut)) {
      expect(
        mark.hiddenBy,
        `a mark (${mark.classes}) is on the page with no box and nothing hiding it`
      ).not.toBe('nothing');
    }
    for (const mark of observed.marks.filter((candidate) => candidate.laidOut)) {
      expect(mark.shapes, `a mark (${mark.classes}) draws no shapes`).toBeGreaterThan(0);
      /* The three slots are 18, 16 and 12 CSS pixels at the default root, and
         every mark is square. The bound is generous on purpose — this is the
         "did the token resolve at all" floor, not a re-pin of the token's
         value, which tests/icons.test.mjs owns. */
      expect(mark.width, `a mark (${mark.classes}) painted at ${mark.width}px`).toBeGreaterThan(8);
      expect(mark.width, `a mark (${mark.classes}) painted at ${mark.width}px`).toBeLessThan(32);
      expect(mark.height, `a mark (${mark.classes}) is not square`).toBeCloseTo(mark.width, 1);
      /* Ink is inherited, never named: a mark with no colour of its own is
         what makes the family follow both reading modes with no branch. */
      expect(mark.ink, `a mark (${mark.classes}) painted no ink`).toMatch(/^rgba?\(/);
    }

    expect(observed.markTiles, 'the roles render no mark tiles').toHaveLength(4);
    for (const tile of observed.markTiles) {
      expect(tile.tag, 'a role mark is not an image').toBe('IMG');
      /* Named for the organisation it shows (issue 326), and the CSP's own
         subject: the origin serves `default-src 'self'`, so a mark that ever
         pointed off-origin would not load at all — this is the measurement
         that says the vendored bytes are what arrived. */
      expect(tile.alt, 'a role mark carries no organisation name').toBe(tile.name);
      expect(tile.decoded, 'a role mark painted an empty frame; its bytes never arrived').toBe(true);
      expect(tile.sameOrigin, 'a role mark loaded from somewhere other than the origin').toBe(true);
      expect(tile.square, 'a role mark tile is not a square file; drawing it square distorts it').toBe(
        true
      );
      expect(tile.height, 'a mark tile is not drawn square').toBeCloseTo(tile.width, 1);
      expect(tile.width, 'a mark tile has a different size from its siblings').toBeCloseTo(
        observed.markTiles[0].width,
        1
      );
    }
    expect(
      new Set(observed.names).size,
      `the employer names start at ${new Set(observed.names).size} different offsets; the mark column varies per row`
    ).toBe(1);
    /* THE NAV'S HALF OF THIS LANE IS RETIRED WITH THE NAV (owner direction,
       2026-10-16: "do away with it for now"). It measured the four section
       words as one scrolling line in the chrome row — one top edge, a
       carousel on a phone, each link a 44px target, no aria-label beside the
       word. The words are still printed, on the section heads, where the
       experience lane asks the accessibility tree for them; the strip they
       ran in is gone. */

    expect(
      observed.documentWidth,
      `the sheet scrolls sideways at ${viewport.width}px (${observed.documentWidth}px of document)`
    ).toBeLessThanOrEqual(observed.viewportWidth);
  });
}

/* A CLOSED DRAWER HOLDS NO STOP (issue 329). The drawer closes by clipping its
 * contents to zero height, and clipping alone left the employer link a Tab
 * stop and in the accessibility tree, so Chromium and Firefox walked row,
 * invisible link, row, invisible link. The closed drawer is `inert`
 * (LedgerLog.svelte), and this measures what each engine DOES with that at
 * both layouts: every drawer closed, the walk goes row to row; one drawer
 * open, its link is the stop between its row and the next; and the open still
 * grows where motion is welcome and still opens where it is not.
 *
 * Two halves, because WebKit cannot answer the walk. Its automation build
 * leaves plain links out of the tab order (engineTabsToPlainLinks, earlier in
 * this file) and the role rows' buttons with them — a Tab from one row was
 * measured landing on the projects table, past every row and every link — so
 * a walk there proves nothing either way. An inert subtree refuses
 * programmatic focus in every engine, so that half, and the grow, are
 * asserted everywhere; the walks are asserted wherever the independent probe
 * — one Tab out of the last row — reaches an anchor. */
for (const viewport of markViewports) {
  test(`a closed role drawer holds no keyboard stop and an open one does, at ${viewport.width}px (issue 329)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await visit(page);
    const entries = page.locator('#work .ledger-entry');
    const count = await entries.count();
    expect(count, 'the experience section rendered fewer than two rows to walk').toBeGreaterThan(1);
    const drawers = () =>
      entries.evaluateAll((nodes) =>
        nodes.map((entry) => {
          const link = entry.querySelector('.ledger-link');
          link.focus({ preventScroll: true });
          const focusable = window.document.activeElement === link;
          link.blur();
          return [entry.querySelector('.ledger-drawer').inert, focusable];
        })
      );
    const stop = () =>
      page.evaluate(() => {
        const active = window.document.activeElement;
        const at = (selector) => [...window.document.querySelectorAll(selector)].indexOf(active);
        return { row: at('#work .ledger-row'), link: at('#work .ledger-link') };
      });
    const closed = [true, false];
    const open = [false, true];

    expect(await drawers(), 'a closed drawer is not inert, or still lets its link take focus').toEqual(
      Array(count).fill(closed)
    );
    await entries.last().locator('.ledger-row').focus();
    await page.keyboard.press('Tab');
    const engineTabsLinks = await page.evaluate(
      () => window.document.activeElement?.tagName === 'A'
    );
    if (engineTabsLinks) {
      await entries.first().locator('.ledger-row').focus();
      for (let index = 1; index < count; index += 1) {
        await page.keyboard.press('Tab');
        expect(
          await stop(),
          `with every drawer closed, the Tab after row ${index - 1} did not land on row ${index}`
        ).toEqual({ row: index, link: -1 });
      }
    }

    /* Opened where motion is welcome: the drawer leaves inert at once and
       still GROWS — a running grid-template-rows transition the engine itself
       reports — and its link is the next stop after its own row. */
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const first = entries.first();
    await first.locator('.ledger-row').click();
    expect(
      await first
        .locator('.ledger-drawer')
        .evaluate((drawer) =>
          drawer.getAnimations().some((motion) => motion.transitionProperty === 'grid-template-rows')
        ),
      'the drawer opened without growing where motion is welcome'
    ).toBe(true);
    expect(await drawers(), 'the opened drawer still refuses focus, or another one stopped refusing').toEqual(
      [open, ...Array(count - 1).fill(closed)]
    );
    if (engineTabsLinks) {
      await first.locator('.ledger-row').focus();
      await page.keyboard.press('Tab');
      expect(await stop(), 'the Tab after an opened row did not land on its own link').toEqual({
        row: -1,
        link: 0,
      });
      await page.keyboard.press('Tab');
      expect(await stop(), 'the Tab out of an opened drawer did not land on the next row').toEqual({
        row: 1,
        link: -1,
      });
    }

    /* Opened where it is not: the same two states, applied instantly. */
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await entries.nth(1).locator('.ledger-row').click();
    expect(
      await entries
        .nth(1)
        .locator('.ledger-drawer')
        .evaluate((drawer) => drawer.getAnimations().length),
      'the drawer travels for a reader who asked for less motion'
    ).toBe(0);
    expect(await drawers(), 'a drawer opened without motion still refuses focus').toEqual([
      open,
      open,
      ...Array(count - 2).fill(closed),
    ]);
    await page.emulateMedia({ reducedMotion: null });
  });
}

/* THE FIGURES' MARKS ARE A COLUMN, AND SO ARE THEIR NUMERALS (owner directive,
 * 2026-09-11, issue #317; re-aimed 2026-10-16).
 *
 * Two measurements, and the reason each is a lane rather than a source pin is
 * the same: both are claims about BOXES the engine laid out, and a stylesheet
 * that declares grid tracks proves nothing about where the engine put them. A
 * mark has to sit over the marks under it, and no numeral may move between
 * rows — which is issue 188's own claim, one level down: a figure that pushed
 * its own mark sideways would make the column of marks ragged exactly as a
 * figure that pushed its neighbours made the cluster ragged.
 *
 * RE-AIMED 2026-10-16 (owner direction: "Ongoing Work", two-line entries).
 * The table and its five-cell HEAD ROW of marks are gone — every figure now
 * carries its own mark and its own words — so the head's half of this lane
 * (its marks over the marks under them, and its five words) has no subject
 * and is retired. What replaced the head is asserted instead: every figure
 * carries its words for a reader who cannot see the drawing. And WHICH edge of
 * a numeral lines up changed with the owner's ruling of 2026-10-15 ("211
 * [tag]" read as 211 tags): the value sits hard against its own mark at every
 * width now, so the LEADING edge is the column at both widths, and the gap
 * from a mark to its value is one length across every figure on the page.
 *
 * Measured at BOTH viewports, because the phone restacks and a claim proved
 * only at 1440 is a claim about half the readers. */
for (const width of [1440, 390]) {
  test(`the repository figures align their marks and their numerals at ${width}px (owner 2026-09-11, issue #317; 2026-10-16)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await visit(page);
    const measured = await page.evaluate(() => {
      const round = (value) => Math.round(value * 100) / 100;
      const rows = [...window.document.querySelectorAll('#projects .repo-entry')];
      const columns = rows.map((row) =>
        [...row.querySelectorAll('.repo-figure')].map((cell) => {
          const mark = cell.querySelector('.repo-glyph')?.getBoundingClientRect() ?? null;
          const figure = cell.querySelector('.repo-value');
          const value = figure?.getBoundingClientRect() ?? null;
          return {
            markLeft: mark === null ? null : round(mark.left),
            markRight: mark === null ? null : round(mark.right),
            markWidth: mark === null ? null : round(mark.width),
            figureLeft: value === null ? null : round(value.left),
            text: figure === null ? '' : figure.textContent.trim(),
            words: (cell.querySelector('.ongoing-clipped')?.textContent ?? '').trim(),
            label: (cell.getAttribute('aria-label') ?? '').trim(),
          };
        })
      );
      return { rows: rows.length, columns };
    });
    expect(
      measured.rows,
      'the repositories column drew no entries; the measurement below would prove nothing'
    ).toBeGreaterThan(1);
    // Every entry draws the same number of figures, or "a column" is not a
    // thing this measurement can be about.
    const counts = new Set(measured.columns.map((row) => row.length));
    expect(counts.size, `entries draw different numbers of figures: ${[...counts]}`).toBe(1);
    expect(measured.columns[0].length, 'an entry draws no figures at all').toBeGreaterThan(0);
    const gaps = new Set();
    for (let column = 0; column < measured.columns[0].length; column += 1) {
      const marks = measured.columns.map((row) => row[column].markLeft);
      const texts = measured.columns.map((row) => row[column].text);
      expect(
        new Set(marks).size,
        `figure ${column}'s marks sit at ${[...new Set(marks)]} across entries reading ${texts}`
      ).toBe(1);
      const edge = measured.columns.map((row) => row[column].figureLeft);
      expect(
        new Set(edge).size,
        `figure ${column}'s numerals start at ${[...new Set(edge)]} across entries reading ${texts}`
      ).toBe(1);
      for (const row of measured.columns) {
        // Every mark really drew: a zero-width box would satisfy the
        // alignment above by drawing nothing at all.
        expect(row[column].markWidth, 'a figure mark drew no box').toBeGreaterThan(0);
        expect(row[column].words, `the figure reading "${row[column].text}" carries no words`).not.toBe('');
        expect(row[column].label, `the figure reading "${row[column].text}" has no accessible name`).not.toBe('');
        gaps.add(Math.round((row[column].figureLeft - row[column].markRight) * 10) / 10);
      }
    }
    /* HARD AGAINST ITS MARK (owner ruling, 2026-10-15): one gap, everywhere.
       A value pushed to the end of its track — the shape this lane used to
       pin on a desktop — opens a gap that depends on the track's width. */
    expect(gaps.size, `a value sits ${[...gaps].join(' / ')}px from its own mark across figures`).toBe(1);
  });
}

/* THE LOG RESERVES FIVE ENTRIES AND SCROLLS FOR THE REST ON A DESKTOP (owner
 * direction, 2026-10-16: five two-line entries per column; six at the ruling
 * of 2026-09-12, seven at issue 318, ten at issue #315), and the reserve is a
 * HEIGHT the engine gave the box rather than a number in a stylesheet. The
 * claim is the zero-CLS one: the box is exactly as tall as its reserve whether
 * it holds three entries or thirty, so a payload landing after first paint
 * moves nothing under the reader — and it is exactly as tall as the
 * REPOSITORIES beside it, which is the pairing the owner asked for and the
 * reason this lane measures that column's entries rather than typing a number.
 * Since 2026-10-16 the two columns are measured ending on one line, because
 * that is what the pairing looks like.
 *
 * A PHONE DOES THE OPPOSITE, and it has a lane of its own below: there the box
 * takes no overflow at all. */
test('the commit log holds its reserve and scrolls inside it at 1440px (owner 2026-09-12; 2026-10-16)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  const measured = await page.evaluate(() => {
    const box = window.document.querySelector('#projects .log-box');
    if (box === null) {
      return null;
    }
    /* The paired column's own entries: the reserve is expressed in terms of
       the column beside it, so the lane asks the page how many entries that
       column drew, and how tall, rather than restating the stylesheet. */
    const entries = [...window.document.querySelectorAll('#projects .repo-entry')];
    const rows = [...box.querySelectorAll('.log-entry')];
    const rect = box.getBoundingClientRect();
    return {
      height: rect.height,
      clientHeight: box.clientHeight,
      scrollHeight: box.scrollHeight,
      overflowY: getComputedStyle(box).overflowY,
      rows: rows.length,
      rowHeights: rows.map((row) => row.getBoundingClientRect().height),
      paired: entries.length,
      pitches: entries.map((entry) => entry.getBoundingClientRect().height),
      boxBottom: rect.bottom,
      pairedBottom: entries.at(-1)?.getBoundingClientRect().bottom ?? null,
      /* The box's own right edge against its column's: a scrollbar may take
         width from the entries, and must never push the box past its column. */
      boxRight: rect.right,
      columnRight: box.closest('.ongoing-column').getBoundingClientRect().right,
      /* No control here: the disclosure belongs to the width that has no
         scroll, and it is absent from the DOM rather than hidden. */
      controls: window.document.querySelectorAll('#projects .log-more').length,
    };
  });
  expect(measured, 'the sheet drew no log box').not.toBeNull();
  /* Five is what the pinned set comes to (`shownProjectRows`, lib/projects.ts)
     and what the reserve is built from. */
  expect(measured.paired, 'the repositories column drew no five entries to pair against').toBe(5);
  for (const pitch of measured.pitches) {
    expect(pitch, 'the repository entries are not one fixed pitch').toBeCloseTo(measured.pitches[0], 1);
  }
  const reserve = measured.pitches.reduce((sum, pitch) => sum + pitch, 0);
  // THE RESERVE: five entries at the pitch this viewport draws them at.
  expect(
    measured.height,
    `the log box is ${measured.height.toFixed(2)}px, want the ${reserve.toFixed(2)}px ${measured.paired}-entry reserve`
  ).toBeCloseTo(reserve, 0);
  expect(measured.boxBottom, 'the two columns do not end on one line').toBeCloseTo(measured.pairedBottom, 0);
  expect(measured.overflowY, 'the log box does not scroll for the entries past its reserve').toBe('auto');
  /* Every entry is at least the pitch the reserve is computed from, so the
     box's fifth entry ends where the repositories' fifth does. A subject that
     needs its second line may take it (owner direction, 2026-10-16) — inside
     a box whose height is fixed either way. */
  for (const [index, height] of measured.rowHeights.entries()) {
    expect(
      height,
      `log entry ${index} is ${height.toFixed(2)}px, under the ${measured.pitches[0].toFixed(2)}px pitch`
    ).toBeGreaterThanOrEqual(measured.pitches[0] - subPixel);
  }
  // And the box never widens past the column it sits in, whatever the engine
  // charged for its scrollbar.
  expect(measured.boxRight).toBeLessThanOrEqual(measured.columnRight + subPixel);
  // The shipped snapshot carries more entries than the reserve holds, which is
  // what makes the scroll real rather than theoretical.
  expect(
    measured.rows,
    `the log drew ${measured.rows} entries; the reserve holds ${measured.paired}, so fewer would not exercise the scroll`
  ).toBeGreaterThan(measured.paired);
  expect(measured.scrollHeight).toBeGreaterThan(measured.clientHeight);
  expect(measured.controls, 'the phone’s disclosure control rendered at a desktop width').toBe(0);
});

/* THE LOG DRAWS NO SCROLLBAR, AND ITS EDGES SAY WHERE THERE IS MORE (owner,
 * 2026-10-19: "this scroll wheel is quite the eyesore … don't have any cool
 * transition"). The box keeps its scroll — a wheel, a finger and the keys
 * still move it — but takes no width for a bar, and fades an edge only while
 * there is more beyond it: at the top the end fades and the start does not,
 * part-way both do, at the bottom the start does and the end does not. The
 * box reports where it is on data-at-start and data-at-end, and the fades
 * are the two registered lengths the mask is built from, read from the
 * engine. And a wheel that reaches the end stays in the box rather than
 * carrying on into the page (overscroll-behavior: contain), which is what a
 * reader feels when they scroll to the last commit and keep going. */
test('the commit log fades only an edge with more beyond it, draws no scrollbar, and keeps a wheel past its end to itself (owner 2026-10-19)', async ({
  page,
  isMobile,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  const box = page.locator('#projects .log-box');
  const read = () =>
    box.evaluate((node) => {
      const style = getComputedStyle(node);
      const rem = Number.parseFloat(getComputedStyle(window.document.documentElement).fontSize);
      return {
        atStart: node.dataset.atStart,
        atEnd: node.dataset.atEnd,
        fadeStart: Math.round(Number.parseFloat(style.getPropertyValue('--log-fade-start')) * 10) / 10,
        fadeEnd: Math.round(Number.parseFloat(style.getPropertyValue('--log-fade-end')) * 10) / 10,
        fade: Math.round(2.5 * rem * 10) / 10,
        mask: style.maskImage || style.webkitMaskImage || 'none',
        scrollTop: node.scrollTop,
        room: node.scrollHeight - node.clientHeight,
        clientWidth: node.clientWidth,
        offsetWidth: node.offsetWidth,
        overscroll: style.overscrollBehaviorY,
      };
    });
  const first = await read();
  expect(first.room, 'the log has nothing past its reserve, so its edges have nothing to say').toBeGreaterThan(0);
  expect(first.mask, 'the log box draws no mask for its fades').not.toBe('none');
  expect(first.clientWidth, `a scrollbar takes ${first.offsetWidth - first.clientWidth}px of the log box`).toBe(first.offsetWidth);
  expect(first.overscroll, 'a scroll that reaches the log’s end carries on into the page').toBe('contain');

  /* Each position is waited into: the attributes follow a scroll event and
     the fades ease where motion is welcome, so the read is the settled one. */
  const at = async (where, scrollTop, expected) => {
    await box.evaluate((node, top) => {
      node.scrollTop = top;
    }, scrollTop);
    await expect
      .poll(
        async () => {
          const now = await read();
          return { atStart: now.atStart, atEnd: now.atEnd, fadeStart: now.fadeStart, fadeEnd: now.fadeEnd };
        },
        { message: `the log's edges at its ${where}` }
      )
      .toEqual({
        atStart: expected.atStart,
        atEnd: expected.atEnd,
        fadeStart: expected.startFaded ? first.fade : 0,
        fadeEnd: expected.endFaded ? first.fade : 0,
      });
  };
  await at('top', 0, { atStart: 'true', atEnd: 'false', startFaded: false, endFaded: true });
  await at('middle', Math.round(first.room / 2), { atStart: 'false', atEnd: 'false', startFaded: true, endFaded: true });
  await at('bottom', first.room, { atStart: 'false', atEnd: 'true', startFaded: true, endFaded: false });
  const bottom = await read();
  expect(bottom.clientWidth, 'a scrollbar appeared once the log was scrolled').toBe(bottom.offsetWidth);

  /* THE WHEEL. A desktop pointer's gesture: an emulated phone has no wheel to
     turn (a finger's overscroll is held by the same declaration, read above).
     First the wheel is proved to reach the box at all — from the top it moves
     the log and not the page — then, at the bottom, more wheel moves neither. */
  if (isMobile) {
    test.info().annotations.push({ type: 'capability', description: 'an emulated phone has no wheel; overscroll containment is read from the engine above' });
    return;
  }
  await box.evaluate((node) => {
    const top = node.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, Math.floor(top) - 80));
    node.scrollTop = 0;
  });
  await settled(page);
  const page0 = await page.evaluate(() => window.scrollY);
  const rect = await box.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await read()).scrollTop, { message: 'a wheel over the log never moved it' }).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY), 'a wheel inside the log scrolled the page instead').toBe(page0);
  await box.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect.poll(async () => (await read()).atEnd).toBe('true');
  await page.mouse.wheel(0, 600);
  await page.evaluate(() => new Promise((done) => setTimeout(done, 400)));
  expect(await page.evaluate(() => window.scrollY), 'a wheel past the log’s end carried on into the page').toBe(page0);
});

/* THE PHONE LOG IS NOT A SCROLL TRAP (owner ruling, 2026-09-12, on the live
 * page: at 390px the log is "quite busy ... an endless scroll field that I have
 * to fight out of"). Re-aimed at the Ongoing Work markup on 2026-10-16; every
 * claim is the one it was.
 *
 * Every claim here is about boxes the engine produced, because every one of
 * them is a thing a thumb meets: the box has no scroll of its own to capture a
 * gesture meant for the page, the collapsed list is five entries and a control
 * that says what pressing it does, the press reveals the whole log inline, and
 * nothing ABOVE the log moves when it does. The document never goes sideways in
 * either state. */
test('at 390 the log shows five entries and a control, and the only scroll is the page’s (owner 2026-09-12)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page);

  const shape = () =>
    page.evaluate(() => {
      const round = (value) => Math.round(value * 100) / 100;
      const box = window.document.querySelector('#projects .log-box');
      const list = window.document.querySelector('#projects .log-list');
      const control = window.document.querySelector('#projects .log-more');
      const section = window.document.getElementById('projects');
      /* The column's own top edge stands where its head did: the visible
         head went (owner, 2026-10-19: "remove this heading … remove the icons
         there as well"), and its word stays for a screen reader, clipped. */
      const head = window.document.querySelector('#commits');
      const word = window.document.querySelector('#commits > .ongoing-clipped');
      const table = window.document.querySelector('#projects .ongoing-column:not(#commits)');
      const box2 = (node) => {
        if (node === null) return null;
        const rect = node.getBoundingClientRect();
        return { top: round(rect.top + window.scrollY), height: round(rect.height), right: round(rect.right) };
      };
      return {
        clientHeight: Math.round(box.clientHeight),
        scrollHeight: Math.round(box.scrollHeight),
        overflowY: getComputedStyle(box).overflowY,
        rows: list.querySelectorAll('.log-entry').length,
        listId: list.id,
        control:
          control === null
            ? null
            : {
                tag: control.tagName,
                type: control.getAttribute('type'),
                expanded: control.getAttribute('aria-expanded'),
                controls: control.getAttribute('aria-controls'),
                text: control.textContent.trim(),
                height: round(control.getBoundingClientRect().height),
                width: round(control.getBoundingClientRect().width),
                marks: control.querySelectorAll('svg').length,
              },
        listWidth: round(list.getBoundingClientRect().width),
        sectionBox: box2(section),
        headBox: box2(head),
        word:
          word === null
            ? null
            : { text: word.textContent.trim(), width: word.getBoundingClientRect().width, height: word.getBoundingClientRect().height },
        visibleHeads: window.document.querySelectorAll('#projects .ongoing-head').length,
        tableBox: box2(table),
        boxTop: box2(box).top,
        documentWidth: window.document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });

  /* The wire's own row count, so "the rest" is a number the origin served
     rather than one typed here. */
  const served = await page.evaluate(async () => {
    const response = await fetch('/api/panels/vcs-activity');
    const envelope = await response.json();
    return Array.isArray(envelope?.data?.recentCommits) ? envelope.data.recentCommits.length : null;
  });
  expect(served, 'the origin served no commits to collapse').not.toBeNull();
  expect(served, 'the served log already fits in five entries; the disclosure has no subject').toBeGreaterThan(5);

  const collapsed = await shape();
  expect(collapsed.headBox, 'the log column is missing').not.toBeNull();
  expect(collapsed.visibleHeads, 'a visible head is back over an Ongoing Work column').toBe(0);
  expect(collapsed.word, 'the log column lost the word a screen reader names it by').not.toBeNull();
  expect(collapsed.word.text.length, 'the log column’s clipped word is empty').toBeGreaterThan(0);
  expect(collapsed.word.width * collapsed.word.height, 'the log column’s word is painted again').toBeLessThanOrEqual(1);
  expect(collapsed.tableBox, 'the repositories column is missing').not.toBeNull();
  /* NO SCROLL OF ITS OWN: the box is exactly as tall as what is in it, and its
     overflow is the initial one. Either half alone would still trap a thumb. */
  expect(
    collapsed.scrollHeight,
    `the collapsed log scrolls inside itself (${collapsed.scrollHeight} > ${collapsed.clientHeight})`
  ).toBe(collapsed.clientHeight);
  expect(collapsed.overflowY, 'the log still takes an overflow of its own on a phone').toBe('visible');
  // FIVE ENTRIES, and a control under them that says how many the press brings.
  expect(collapsed.rows, 'the collapsed log does not show five entries').toBe(5);
  expect(collapsed.control, 'the collapsed log drew no control to reveal the rest').not.toBeNull();
  expect(collapsed.control.tag, 'the control is not a real button').toBe('BUTTON');
  expect(collapsed.control.type, 'a button inside no form still declares its type').toBe('button');
  expect(collapsed.control.expanded, 'the control does not report its state').toBe('false');
  expect(collapsed.control.controls, 'the control does not name the list it grows').toBe(
    collapsed.listId
  );
  expect(collapsed.listId, 'the list has no id for the control to name').not.toBe('');
  expect(collapsed.control.text, 'the control says nothing a reader could read').toBe(
    `show all ${served}`
  );
  expect(collapsed.control.marks, 'the control draws a mark instead of saying what it does').toBe(0);
  // The touch floor, measured rather than declared.
  expect(collapsed.control.height, 'the control is under the 44px touch floor').toBeGreaterThanOrEqual(44);
  /* AND IT TAKES THE LOG'S WHOLE WIDTH. A <button> is one of the few elements
     whose own `auto` width does not fill its parent, so this is a real claim
     rather than a default: the same control laid out as a plain block measured
     99px of a 358px column, which is a target a thumb has to find under a list
     that spans the screen. */
  expect(
    collapsed.control.width,
    `the control is ${collapsed.control.width}px under a ${collapsed.listWidth}px list`
  ).toBeCloseTo(collapsed.listWidth, 0);
  expect(
    collapsed.documentWidth,
    `the collapsed log took the document sideways (${collapsed.documentWidth} > ${collapsed.viewportWidth})`
  ).toBeLessThanOrEqual(collapsed.viewportWidth + subPixel);

  /* THE ENGINE'S OWN SHIFT LEDGER, armed just before the press, and scoped to
     the complement of what a disclosure is ALLOWED to move. Opening a list
     grows it: the log's own box changes, the section around it changes with it,
     and everything after it on the page moves down — that is the reader's own
     press doing exactly what they pressed for, and the owner's ruling asks for
     it in preference to a box they have to fight out of.

     What must not move is anything ABOVE or BESIDE the log: the section's top
     edge, the repositories column, the log's own head. So an entry is counted
     when it names a node that is neither inside the log, nor an ancestor of it,
     nor anywhere after it in the document — which is exactly that set, and is
     a set the engine can genuinely report. `hadRecentInput` is deliberately NOT
     filtered here: filtering it would excuse every shift a click causes, which
     is the whole of what this press does, and the channel would report nothing
     whatever the page did. A node the entry cannot name is counted too — an
     unattributable shift is the one most worth hearing about. */
  const watching = await page.evaluate(() => {
    const types = PerformanceObserver.supportedEntryTypes ?? [];
    if (!types.includes('layout-shift')) return false;
    const box = window.document.querySelector('#projects .log-box');
    window.__logShift = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const above = [...(entry.sources ?? [])].filter((source) => {
          const node = source.node;
          if (!(node instanceof Element)) return true;
          if (box.contains(node) || node.contains(box)) return false;
          return (
            (box.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) === 0
          );
        });
        if (above.length === 0) continue;
        window.__logShift.push({
          value: entry.value,
          moved: above.map((source) => `${source.node?.tagName ?? 'unnamed'}.${source.node?.getAttribute?.('class') ?? ''}`),
        });
      }
    }).observe({ type: 'layout-shift', buffered: false });
    return true;
  });

  await page.locator('#projects .log-more').click();
  await settled(page);
  const expanded = await shape();

  // EVERY ENTRY, inline, and the control now offers the way back.
  expect(expanded.rows, `pressing the control revealed ${expanded.rows} entries, not the ${served} served`).toBe(
    served
  );
  expect(expanded.control.expanded, 'the control does not report its new state').toBe('true');
  expect(expanded.control.text, 'the control offers no way back').toBe('show fewer');
  /* STILL NO SCROLL OF ITS OWN: the log grew into the page rather than into a
     box, which is the whole of the owner's ruling. */
  expect(
    expanded.scrollHeight,
    `the expanded log scrolls inside itself (${expanded.scrollHeight} > ${expanded.clientHeight})`
  ).toBe(expanded.clientHeight);
  expect(expanded.clientHeight, 'the expanded log is no taller than the collapsed one').toBeGreaterThan(
    collapsed.clientHeight
  );
  expect(
    expanded.documentWidth,
    `the expanded log took the document sideways (${expanded.documentWidth} > ${expanded.viewportWidth})`
  ).toBeLessThanOrEqual(expanded.viewportWidth + subPixel);

  /* NOTHING ABOVE THE LOG MOVED. The section's own top, the repositories
     column above it and the log column's own top (where its head stood until
     2026-10-19) are all where they were; the section
     is TALLER by exactly the log's growth, which is the reader's own press
     expanding the thing they pressed on. */
  expect(expanded.sectionBox.top, 'the section moved when the log opened').toBeCloseTo(
    collapsed.sectionBox.top,
    1
  );
  expect(expanded.tableBox.height, 'the repositories column changed size when the log opened').toBeCloseTo(
    collapsed.tableBox.height,
    1
  );
  expect(expanded.headBox.top, 'the log’s column moved when the log opened').toBeCloseTo(
    collapsed.headBox.top,
    1
  );
  expect(expanded.boxTop, 'the log box itself moved instead of growing').toBeCloseTo(collapsed.boxTop, 1);
  expect(
    expanded.sectionBox.height - collapsed.sectionBox.height,
    'the section grew by something other than the log’s own growth'
  ).toBeCloseTo(expanded.clientHeight - collapsed.clientHeight, 1);

  const shifts = await page.evaluate(() => window.__logShift ?? null);
  if (watching) {
    expect(
      shifts,
      `the press moved something above or beside the log: ${JSON.stringify(shifts)}`
    ).toEqual([]);
  } else {
    expect(shifts, 'the layout-shift observer was armed but reported nothing at all').toBeNull();
  }

  // AND BACK: the control closes what it opened, and the page returns to the
  // shape it started in.
  await page.locator('#projects .log-more').click();
  await settled(page);
  const closed = await shape();
  expect(closed.rows, 'the control cannot close what it opened').toBe(5);
  expect(closed.control.text).toBe(`show all ${served}`);
  expect(closed.sectionBox.height, 'closing the log left the section a different size').toBeCloseTo(
    collapsed.sectionBox.height,
    1
  );
});

/* ===========================================================================
 * 02 / ONGOING WORK — the sheet's paired section
 * (owner design decision, 2026-09-11, issue 318, option B on the design
 * canvas; renamed and rebuilt as two-line entries by the owner direction of
 * 2026-10-16)
 *
 * Three claims an engine has to settle, because every one of them is about
 * boxes rather than declarations: the two columns fill the sheet at the width
 * the owner reviews it at, no entry on a phone spends a line it did not
 * reserve, and the section does not move when its payloads land.
 * ======================================================================== */

test('the sheet numbers four sections and the paired one reads as one head (owner 2026-09-11, issue 318)', async ({
  page,
}) => {
  await visit(page);
  const observed = await page.evaluate(() => ({
    sections: [...window.document.querySelectorAll('.page-section')].map((node) => ({
      id: node.id,
      number: node.querySelector('.section-number')?.textContent?.trim() ?? '',
      title: node.querySelector('.section-title')?.textContent?.trim() ?? '',
      heads: node.querySelectorAll('.section-head').length,
    })),
    /* The old address, resolved against the real document: #commits is no
       longer a section and must still land a reader on the commits. */
    commitsAnchor: window.document.getElementById('commits')?.getAttribute('class') ?? null,
    commitsInProjects:
      window.document.getElementById('projects')?.contains(window.document.getElementById('commits')) ??
      false,
    logRowsUnderAnchor:
      window.document.getElementById('commits')?.querySelectorAll('.log-entry').length ?? 0,
  }));
  expect(
    observed.sections.map((section) => [section.number, section.title]),
    'the sheet no longer numbers the owner’s four sections in order'
  ).toEqual([
    ['01', 'Professional Experience'],
    ['02', 'Ongoing Work'],
    ['03', 'Trackers'],
    ['04', 'Gallery'],
  ]);
  expect(
    observed.sections.map((section) => section.id),
    'a section id moved; an address a reader shared stopped resolving'
  ).toEqual(['work', 'projects', 'trackers', 'gallery']);
  // ONE head over the pair: two columns, one section, one rule.
  for (const section of observed.sections) {
    expect(section.heads, `${section.id} draws ${section.heads} section heads`).toBe(1);
  }
  /* #commits still resolves, inside the paired section, onto the column that
     actually holds the commits. (The nav that never linked it is gone with
     the chrome row — owner direction, 2026-10-16 — and the address is still
     exactly one place.) */
  expect(observed.commitsAnchor, 'the retired #commits address resolves to nothing').toContain(
    'ongoing-column'
  );
  expect(observed.commitsInProjects, '#commits landed outside the paired section').toBe(true);
  expect(observed.logRowsUnderAnchor, '#commits lands somewhere with no commits in it').toBeGreaterThan(0);
});

/* A SECTION HEAD IS ITS TITLE AND A VINE (owner, 2026-10-19: the plain titles
 * with "left + line", the owner's pick of three settings tried on the page,
 * then "the plain lines should be tree branches, or vines"). The head is a
 * row: the title at the column's start, then the vine — a band nine prop
 * pixels tall (--keep-prop, 2px a pixel: 18px), painted as a picture — that
 * takes whatever the title leaves, to the column's end. The vine is a
 * generated box, so its own width is read from the engine and laid end to end
 * with the title and the gap between them: the three must reach exactly the
 * column's content end. A vine that stopped short, ran into the sheet's
 * margin, wrapped under the title (a head turned back into a column), shrank
 * back to a hairline or lost its picture is a measurement off here, at a
 * desktop and both phone widths. */
test('every section head sets its title at the column’s start and runs its vine to the column’s end (owner 2026-10-19)', async ({
  page,
}) => {
  await visit(page);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    const observed = await page.evaluate(() => {
      const main = window.document.querySelector('main');
      const sheet = main.getBoundingClientRect();
      const frame = getComputedStyle(main);
      return {
        prop: parseFloat(getComputedStyle(window.document.documentElement).getPropertyValue('--keep-prop')),
        column: {
          start: sheet.left + parseFloat(frame.borderLeftWidth) + parseFloat(frame.paddingLeft),
          end: sheet.right - parseFloat(frame.borderRightWidth) - parseFloat(frame.paddingRight),
        },
        heads: [...window.document.querySelectorAll('.section-head')].map((head) => {
          const style = getComputedStyle(head);
          const line = getComputedStyle(head, '::after');
          const title = head.querySelector('.section-title').getBoundingClientRect();
          return {
            id: head.closest('.page-section')?.id ?? '',
            direction: style.flexDirection,
            gap: parseFloat(style.columnGap),
            title: { left: title.left, right: title.right },
            line: {
              content: line.content,
              width: parseFloat(line.width),
              height: parseFloat(line.height),
              picture: line.backgroundImage,
            },
          };
        }),
      };
    });
    expect(observed.heads.length, `the sheet draws no section heads at ${width}px`).toBeGreaterThan(0);
    for (const head of observed.heads) {
      const at = `${head.id} at ${width}px`;
      expect(head.direction, `the head of ${at} is not a row`).toBe('row');
      expect(
        Math.abs(head.title.left - observed.column.start),
        `the title of ${at} starts at ${head.title.left}px, not at the column's start ${observed.column.start}px`
      ).toBeLessThanOrEqual(1);
      expect(head.line.content, `the head of ${at} draws no vine`).not.toBe('none');
      expect(observed.prop, 'the prop pixel token resolves to nothing').toBeGreaterThan(0);
      expect(
        head.line.height,
        `the vine of ${at} is ${head.line.height}px, not nine ${observed.prop}px prop pixels`
      ).toBeCloseTo(9 * observed.prop, 1);
      expect(head.line.height, `the vine of ${at} is back to a hairline`).toBeGreaterThan(1);
      expect(head.line.picture, `the vine of ${at} paints no picture`).not.toBe('none');
      expect(head.line.width, `the vine of ${at} has no length`).toBeGreaterThan(0);
      const end = head.title.right + head.gap + head.line.width;
      expect(
        Math.abs(end - observed.column.end),
        `the vine of ${at} ends at ${end.toFixed(2)}px, not at the column's end ${observed.column.end.toFixed(2)}px`
      ).toBeLessThanOrEqual(1);
    }
  }
});

/* EVERY PROP IS PAINTED AT ITS OWN GRAIN. The branches under the roles and
 * the tome, the twigs under the lists and the stone grain the torchlight
 * falls through are pixel drawings, each tiled at its own viewBox times
 * --keep-prop, so every pixel is square. sections.test.mjs pins the tile
 * tokens; nothing there sees what a painted box does with them, and a role
 * row sized `1px 1px` in place of its token passed every frontend test (the
 * review of 97c7a60, finding 2). So this reads what the engine resolved: every
 * box on the page, and its ::before and ::after, whose background or mask
 * carries one of these drawings must size that layer at exactly the drawing's
 * viewBox in prop pixels, however the size was spelled and in whichever rule.
 * Each drawing must be found painted at both widths, so a lane that measured
 * nothing cannot pass. */
const grained = Object.fromEntries(
  ['branch-1', 'branch-2', 'branch-3', 'branch-4', 'twig-1', 'twig-2', 'twig-3', 'grain'].map((name) => {
    const drawing = readFileSync(new URL(`../src/assets/images/props/${name}.svg`, import.meta.url), 'utf8');
    const [, w, h] = /viewBox="0 0 (\d+) (\d+)"/.exec(drawing) ?? [];
    return [name, { w: Number(w), h: Number(h) }];
  })
);
test('every branch, twig and grain is painted at its own drawing’s size in prop pixels', async ({ page }) => {
  for (const [name, { w, h }] of Object.entries(grained)) {
    expect(w > 0 && h > 0, `${name}.svg no longer states a viewBox this lane can read`).toBe(true);
  }
  await visit(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    const observed = await page.evaluate((names) => {
      const drawing = new RegExp(`/(${names.join('|')})-[\\w-]+\\.svg`);
      const layers = (value) => (!value || value === 'none' ? [] : value.split(/,(?![^(]*\))/).map((part) => part.trim()));
      const painted = [];
      for (const element of window.document.querySelectorAll('*')) {
        for (const pseudo of [null, '::before', '::after']) {
          const style = getComputedStyle(element, pseudo);
          for (const [kind, images, sizes] of [
            ['background', style.backgroundImage, style.backgroundSize],
            ['mask', style.maskImage || style.webkitMaskImage, style.maskSize || style.webkitMaskSize],
          ]) {
            const sized = layers(sizes);
            layers(images).forEach((image, index) => {
              const found = drawing.exec(image);
              if (found) {
                painted.push({
                  where: `${element.tagName.toLowerCase()}${[...element.classList].map((name) => `.${name}`).join('')}${pseudo ?? ''}`,
                  kind,
                  name: found[1],
                  size: sized[index % Math.max(1, sized.length)] ?? '',
                });
              }
            });
          }
        }
      }
      return {
        prop: parseFloat(getComputedStyle(window.document.documentElement).getPropertyValue('--keep-prop')),
        painted,
      };
    }, Object.keys(grained));
    expect(observed.prop, 'the prop pixel token resolves to nothing').toBeGreaterThan(0);
    const seen = [...new Set(observed.painted.map(({ name }) => name))].sort();
    expect(seen, `at ${width}px the page no longer paints every branch, twig and grain`).toEqual(Object.keys(grained).sort());
    for (const { where, kind, name, size } of observed.painted) {
      const { w, h } = grained[name];
      const [across, down] = size.split(/\s+/).map((part) => (part.endsWith('px') ? parseFloat(part) : Number.NaN));
      expect(
        Math.abs(across - w * observed.prop) <= 0.01 && Math.abs(down - h * observed.prop) <= 0.01,
        `${where} at ${width}px paints ${name} as a ${kind} at ${size}, not its ${w}x${h} drawing at ` +
          `${observed.prop}px a pixel (${w * observed.prop}px ${h * observed.prop}px)`
      ).toBe(true);
    }
  }
});

test('at 1440 the two columns fill the sheet with no dead space (owner 2026-09-11, issue 318; 2026-10-16)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page);
  const measured = await page.evaluate(() => {
    const round = (value) => Math.round(value * 100) / 100;
    const spread = window.document.querySelector('#projects .ongoing');
    const columns = [...spread.children];
    const card = spread.parentElement;
    const right = (node) => (node === null ? null : round(node.getBoundingClientRect().right));
    return {
      columns: columns.length,
      boxes: columns.map((column) => {
        const rect = column.getBoundingClientRect();
        return { left: round(rect.left), right: round(rect.right), width: round(rect.width) };
      }),
      cardLeft: round(card.getBoundingClientRect().left),
      cardRight: round(card.getBoundingClientRect().right),
      /* WHAT A ROW PRINTS AT ITS END, not the row's own box: an entry is a
         grid item stretched across its column, so its box reaches the edge
         whatever is drawn in it. On a repository the figures are pushed to
         the column's end; on a commit the age and the short identity hold it
         (LedgerSpread.svelte). Those are what must reach. */
      repoEnds: [...spread.querySelectorAll('.repo-entry')].map((row) => right(row.querySelector('.repo-figures'))),
      logEnds: [...spread.querySelectorAll('.log-entry')]
        .slice(0, 5)
        .map((row) => right(row.querySelector('.log-meta > :last-child'))),
      /* NO VISIBLE HEADS since 2026-10-19 ("remove this heading … remove the
         icons there as well"): each column opens on its first entry, and its
         word is kept clipped for a screen reader. */
      heads: spread.querySelectorAll('.ongoing-head').length,
      words: columns.map((column) => {
        const word = column.querySelector(':scope > .ongoing-clipped');
        if (word === null) return null;
        const rect = word.getBoundingClientRect();
        return { text: word.textContent.trim(), area: rect.width * rect.height };
      }),
      marksBeforeFirst: columns.map((column) => {
        const first = column.querySelector('.repo-entry, .log-box');
        return [...column.querySelectorAll('svg')].filter(
          (mark) => first !== null && (mark.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        ).length;
      }),
      documentWidth: window.document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  expect(measured.columns, 'the paired section is not two columns').toBe(2);
  // EQUAL HALVES, and the pair spans the sheet edge to edge.
  expect(measured.boxes[0].width, 'the two columns are not equal halves').toBeCloseTo(
    measured.boxes[1].width,
    0
  );
  expect(measured.boxes[0].left, 'the left column does not start at the sheet’s edge').toBeCloseTo(
    measured.cardLeft,
    0
  );
  expect(measured.boxes[1].right, 'the right column stops short of the sheet’s edge').toBeCloseTo(
    measured.cardRight,
    0
  );
  /* NO DEAD SPACE INSIDE EITHER COLUMN (the owner's standing ruling, measured
     at 1440): every entry prints to its own column's end edge, so neither
     column is a narrow strip in a wide track. The tolerance is the hairline
     the entry rules are drawn with plus the sub-pixel allowance. */
  const reaches = (ends, edge, name) => {
    expect(ends.length, `${name} drew nothing to measure`).toBeGreaterThan(0);
    for (const [index, end] of ends.entries()) {
      expect(end, `${name} ${index} printed nothing at its end`).not.toBeNull();
      expect(
        end,
        `${name} ${index} ends ${(edge - end).toFixed(1)}px short of its column's end edge`
      ).toBeGreaterThanOrEqual(edge - 1 - subPixel);
    }
  };
  reaches(measured.repoEnds, measured.boxes[0].right, 'the repository entry');
  reaches(measured.logEnds, measured.boxes[1].right, 'the commit entry');
  expect(measured.heads, 'a visible head is back over an Ongoing Work column').toBe(0);
  for (const [index, word] of measured.words.entries()) {
    expect(word, `column ${index} lost the word a screen reader names it by`).not.toBeNull();
    expect(word.text.length, `column ${index}'s clipped word is empty`).toBeGreaterThan(0);
    expect(word.area, `column ${index}'s word is painted again`).toBeLessThanOrEqual(1);
  }
  expect(measured.marksBeforeFirst, 'a column draws a mark above its first entry, where its head’s icon was').toEqual([0, 0]);
  expect(
    measured.documentWidth,
    `the paired section took the document sideways (${measured.documentWidth} > ${measured.viewportWidth})`
  ).toBeLessThanOrEqual(measured.viewportWidth + subPixel);
});

/* AT 390 THE COLUMNS STACK, AND NO ENTRY SPENDS A LINE IT DID NOT RESERVE.
 *
 * Until 2026-10-16 this was "no row spends a third line": a repository and a
 * commit were each one ruled row. The owner's direction of that day made
 * every entry TWO-LINE on purpose ("give more information and make it more
 * readable"), and on a phone a repository reserves four lines (its name, two
 * of description, its figures) and a commit three (two of subject, then
 * where/when/which) — so the claim is re-aimed at what those entries
 * promise, measured the same way: the lines a reader sees are never more than
 * the lines the entry reserved, every entry in a column is ONE height (the
 * fixed pitch the zero-CLS reserve is built from), and a hostile subject
 * neither spends a third line of its own nor takes the document sideways.
 *
 * Retired the same day, with its subject: "the seven-character identity is
 * not in the DOM on a phone". The owner's direction puts WHICH — the short
 * identity — on every commit's supporting line at every width. */
test('at 390 the columns stack and no entry spends a line it did not reserve (owner 2026-09-11, issue 318; 2026-10-16)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  /* A SUBJECT WITH NO SPACES, which is the hostile case for a clamped
     subject: a 200-character token cannot break at a space, so an entry that
     did not clamp would either run on past its two lines or push the
     document sideways. Staged through the real envelope so admission is
     unchanged. */
  const unbreakable = `fix:${'x'.repeat(200)}`;
  await page.route('**/api/panels/vcs-activity', async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    envelope.data.recentCommits = [
      { repo: 'naranjo.online', sha: '', message: unbreakable, at: '2026-09-11T00:00:00Z' },
      ...envelope.data.recentCommits,
    ];
    await route.fulfill({ response, json: envelope });
  });
  await visit(page);

  const measured = await page.evaluate((hostile) => {
    const round = (value) => Math.round(value * 100) / 100;
    const spread = window.document.querySelector('#projects .ongoing');
    const columns = [...spread.children].map((column) => column.getBoundingClientRect());
    /* AN ENTRY'S LINES, measured rather than counted from the markup: the
       LINE BOXES its painted text actually occupies, merged into bands by
       whether they overlap vertically. A clamped subject is one leaf drawing
       two line boxes, which is why the line rects are read rather than the
       leaves: a leaf counted once would hide its own second line. The clipped
       words and the hover detail are excluded because neither is in the
       entry's flow: one is a 1px clip for the accessibility tree, the other a
       fixed-position tip. */
    const lines = (row) => {
      const rects = [];
      const walker = window.document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if ((node.textContent ?? '').trim() === '') continue;
        const parent = node.parentElement;
        if (parent.closest('.ongoing-clipped') !== null || parent.closest('.cell-tip') !== null) continue;
        /* Text the entry clips away is not a line a reader sees: only line
           boxes that intersect the clamping ancestor's own box are counted. */
        const clip = parent.closest('.log-message, .repo-about') ?? parent;
        const clipBox = clip.getBoundingClientRect();
        const range = window.document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width <= 0 || rect.height <= 0) continue;
          if (rect.bottom <= clipBox.top + 0.5 || rect.top >= clipBox.bottom - 0.5) continue;
          rects.push(rect);
        }
      }
      rects.sort((first, second) => first.top - second.top);
      let bands = 0;
      let bandBottom = -Infinity;
      for (const rect of rects) {
        if (rect.top >= bandBottom - 0.5) {
          bands += 1;
          bandBottom = rect.bottom;
        } else {
          bandBottom = Math.max(bandBottom, rect.bottom);
        }
      }
      return {
        bands,
        height: round(row.getBoundingClientRect().height),
        text: row.textContent.trim().replace(/\s+/g, ' ').slice(0, 48),
      };
    };
    const hostileEntry = [...spread.querySelectorAll('.log-entry')].find((row) =>
      (row.textContent ?? '').includes(hostile)
    );
    const message = hostileEntry?.querySelector('.log-message') ?? null;
    return {
      columns,
      repoRows: [...spread.querySelectorAll('.repo-entry')].map(lines),
      logRows: [...spread.querySelectorAll('.log-entry')].map(lines),
      hostile:
        message === null
          ? null
          : {
              height: round(message.getBoundingClientRect().height),
              lineHeight: Number.parseFloat(getComputedStyle(message).lineHeight),
            },
      documentWidth: window.document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  }, unbreakable);

  // STACKED, repositories first: the second column starts below the first.
  expect(measured.columns.length, 'the paired section is not two columns').toBe(2);
  expect(
    measured.columns[1].top,
    'the two columns are still side by side at 390px'
  ).toBeGreaterThanOrEqual(measured.columns[0].bottom - subPixel);

  expect(measured.repoRows.length, 'no repository entries to measure').toBeGreaterThan(1);
  expect(measured.logRows.length, 'no commit entries to measure').toBeGreaterThan(1);
  for (const [name, rows, reserved] of [
    ['repository', measured.repoRows, 4],
    ['commit', measured.logRows, 3],
  ]) {
    for (const [index, row] of rows.entries()) {
      expect(
        row.bands,
        `the ${name} entry "${row.text}" spends ${row.bands} lines; it reserves ${reserved}`
      ).toBeLessThanOrEqual(reserved);
      /* ONE HEIGHT PER COLUMN: the fixed pitch the reserve is built from,
         whatever the entry's words. */
      expect(
        row.height,
        `the ${name} entry ${index} is ${row.height}px against entry 0's ${rows[0].height}px`
      ).toBeCloseTo(rows[0].height, 0);
    }
  }
  /* The hostile subject is present and clamped at its two lines. */
  expect(measured.hostile, 'the staged unbreakable subject never reached the log').not.toBeNull();
  expect(
    measured.hostile.height,
    `the unbreakable subject draws ${measured.hostile.height}px, more than two ${measured.hostile.lineHeight}px lines`
  ).toBeLessThanOrEqual(2 * measured.hostile.lineHeight + subPixel);
  expect(
    measured.documentWidth,
    `a 200-character unbreakable subject took the document sideways (${measured.documentWidth} > ${measured.viewportWidth})`
  ).toBeLessThanOrEqual(measured.viewportWidth + subPixel);
});

/* ZERO CLS ACROSS THE ARRIVAL, at both viewports. The section's whole shape —
 * the repository entries, the log's reserve — is decided before either payload
 * lands, so the two envelopes are held at the route until the page has been
 * measured and released afterwards: if the section's top or its height moves
 * between the two reads, something under a reader's finger moved with it.
 * (Re-aimed at the Ongoing Work markup and the trackers' one diagram,
 * 2026-10-16; the claim is unchanged.) */
for (const width of [1440, 390]) {
  test(`the paired section holds still while its payloads land at ${width}px (owner 2026-09-11, issue 318)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let release = () => {};
    const held = new Promise((resolve) => {
      release = resolve;
    });
    for (const id of ['coding-projects', 'vcs-activity']) {
      await page.route(`**/api/panels/${id}`, async (route) => {
        await held;
        await route.continue();
      });
    }
    await page.goto('/');
    /* The section is on the page with its captured face and its reserved log
       box, and nothing else is still growing: the OTHER panels are ungated, so
       they settle first and cannot be mistaken for this section moving. */
    await expect(page.locator('#projects .repo-entry').first()).toBeVisible();
    await expect(page.locator('#projects .log-box')).toHaveCount(1);
    await expect(page.locator('#trackers .chronicle')).toHaveCount(1);
    await expect(page.locator('.ticker-strip')).toHaveCount(1);
    const shape = () =>
      page.evaluate(() => {
        const section = window.document.getElementById('projects');
        const rect = section.getBoundingClientRect();
        const box = window.document.querySelector('#projects .log-box').getBoundingClientRect();
        return {
          top: Math.round((rect.top + window.scrollY) * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          reserve: Math.round(box.height * 100) / 100,
          rows: window.document.querySelectorAll('#projects .log-entry').length,
        };
      });
    let previous = null;
    await expect
      .poll(async () => {
        const now = await shape();
        const stable = previous !== null && now.height === previous.height;
        previous = now;
        return stable;
      }, { message: 'the page never stopped growing before the gated payloads were released' })
      .toBe(true);
    const before = await shape();
    expect(before.rows, 'the log drew entries before its payload was released').toBe(0);

    release();
    await settled(page);
    const after = await shape();

    expect(after.rows, 'the released payload drew no commit entries').toBeGreaterThan(0);
    expect(
      after.top,
      `the section moved ${(after.top - before.top).toFixed(2)}px when its payloads landed`
    ).toBeCloseTo(before.top, 1);
    expect(
      after.height,
      `the section grew ${(after.height - before.height).toFixed(2)}px when its payloads landed`
    ).toBeCloseTo(before.height, 1);
    expect(
      after.reserve,
      `the log box grew ${(after.reserve - before.reserve).toFixed(2)}px when its entries arrived`
    ).toBeCloseTo(before.reserve, 1);
  });
}
