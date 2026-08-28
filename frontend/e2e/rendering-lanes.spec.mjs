/* Rendering lanes, stage 2 (issue #26): one navigation per stage-1 floor, in
 * every engine and at phone size, asserting what the ENGINE reports rather
 * than what the source says.
 *
 * These lanes and the source pins in tests/experience.test.mjs are halves of
 * one guarantee and neither replaces the other. A source pin proves the rule
 * the next build inherits, including on engines nobody can run here; a lane
 * proves this build's declarations survived a real cascade — that env() was
 * understood rather than dropped, that 44px of CSS became 44px of box, that
 * a reduced-motion preference actually reaches the popover.
 */
import { expect, test } from '@playwright/test';

// The narrowest viewport this site supports, and the sizes it must fit
// between there and a large phone. 320 is the floor named in AGENTS.md;
// 360/390/412 are widths ordinary Android and iPhone screens report.
const phoneWidths = [320, 360, 390, 412];

// iOS Safari zooms the page in when a focused field's text is under this, and
// does not zoom back out.
const textEntryFloorPx = 16;

// The comfortable minimum for a finger, in CSS pixels.
const touchFloorPx = 44;

/* The gallery stage's ceiling: 28rem at this page's unmodified 16px root,
 * --gallery-stage-size's value in MediaGallery.svelte.
 *
 * It replaces the 20rem --card-media-max-block-size cap this constant used to
 * carry (issue 157). The gallery stopped borrowing the feed card's 16:9 media
 * box on 2026-08-28 — the owner's drawings are portrait scans, and a wide
 * frame either cropped them or drowned them in dead side space, so the stage
 * is now a SQUARE sized by its own token and the picture is `contain` inside
 * it. The cap moved with the box; the reason this is a literal did not.
 *
 * A gallery-cap assertion below compares a MEASURED box against this fixed
 * number, never against getComputedStyle(stage).maxBlockSize read back from
 * the same page — Daybreak Blue's review of PR #161 proved that
 * self-referential shape lets a 28rem -> 280rem mutation survive undetected,
 * because the expectation and the rendered behavior move together when both
 * derive from the one (mutated) token. */
const galleryStageCapPx = 448;

/* The film's stage, which is a different shape and a bigger one (issue 233,
 * owner directive 2026-08-28: a film "should be enlarged"). 27rem block edge
 * at this page's unmodified 16px root, times the 16:9 the item's kind selects
 * — 432px tall inside 768px wide, against the still's 448 square. Literals
 * here for exactly the reason the constant above is one: an expectation read
 * back off the page moves with the token it is supposed to be checking. */
const galleryVideoStageBlockPx = 432;
const galleryVideoStageInlinePx = 768;
const galleryVideoAspect = 1.7778;

/* One gallery/v1 manifest carrying a still and a film, served from the media
 * volume's own mutable path so the page takes the route it takes in
 * production: lib/galleryManifest.ts reads it once, admits it, and the Art
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
const galleryManifestFixture = {
  schema: 'gallery/v1',
  items: [
    {
      kind: 'image',
      key: 'lane-still',
      alt: 'A still, served by the lane',
      full: { path: 'gallery/still.webp', sha256: 'a'.repeat(64), width: 3840, height: 2160 },
      preview: { path: 'gallery/still-preview.webp', sha256: 'b'.repeat(64), width: 960, height: 540 },
    },
    {
      kind: 'video',
      key: 'lane-film',
      alt: 'A film, served by the lane',
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
async function settled(page) {
  let previous = -1;
  await expect
    .poll(
      async () => {
        const measured = await page.evaluate(() => ({
          height: window.document.documentElement.scrollHeight,
          hydrated: window.document.querySelector('[data-static-fallback]') === null
        }));
        const stable = measured.height > 0 && measured.height === previous && measured.hydrated;
        previous = measured.height;
        return stable;
      },
      { message: 'the page never stopped growing, or never hydrated', timeout: 15_000 }
    )
    .toBe(true);
}

async function visit(page) {
  await page.goto('/');
  await settled(page);
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

/* The alpha channel of whatever spelling of a color the engine computed —
 * `rgba(r, g, b, a)`, `color(srgb r g b / a)`, or an opaque form that carries
 * no alpha component at all and therefore means 1. It reads the LAST
 * component only when the notation actually carries four, so an opaque
 * `rgb(r, g, b)` can never be mistaken for a 62%-transparent one. */
function alphaOf(color) {
  const parsed = (color.match(/[\d.]+/g) ?? []).map(Number);
  return parsed.length > 3 ? parsed[3] : 1;
}

const openReadingModes = async (page) => {
  await page.getByRole('button', { name: 'Reading mode' }).click();
  await expect(page.locator('#reading-mode-menu')).toBeVisible();
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
     the floor from quietly becoming a page of clipped boxes. */
  const wide = await page.evaluate(() => {
    const overflowOf = (node) => getComputedStyle(node).overflowX;
    const scrolls = (node) => ['auto', 'scroll'].includes(overflowOf(node));
    const clips = (node) => ['hidden', 'clip'].includes(overflowOf(node));
    const scrolled = [];
    const clipped = [];
    const escaping = [];
    for (const node of window.document.querySelectorAll('body *')) {
      if (node.scrollWidth <= window.document.documentElement.clientWidth) continue;
      const name = `${node.tagName.toLowerCase()}.${node.className}`;
      let held = null;
      for (let parent = node; parent instanceof HTMLElement; parent = parent.parentElement) {
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
     than a 320px phone — the contribution grids — so a run that finds none has
     stopped rendering the thing the floor is about. */
  expect(
    wide.scrolled.length,
    'nothing on the page is held by a scrolling box any more; this lane no longer proves scroll containment'
  ).toBeGreaterThan(0);
});

test('every control clears the touch floor on both axes', async ({ page }) => {
  await visit(page);
  await openReadingModes(page);
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

/* SUPERSEDED twice over, and superseded rather than deleted both times so the
 * reason stays on the record.
 *
 * First by "every swatch still says which palette it selects, in every
 * reading mode" (2026-08-24 restyle): this lane guarded a color-mix() that no
 * longer exists, measuring only that the sepia glyph had not fallen back to
 * the PAGE's ink. That assertion widened into one lane covering all five
 * swatches: each one's outline against the popover, and each dark mode's
 * craters against its own moon.
 *
 * Then that lane's own premise was superseded (issue #180, 2026-08-25): the
 * owner reported the three dark craters unreadable at 18px — "they all look
 * exactly the same" — so the glyphs stopped previewing a palette at all and
 * now paint ONE ink (currentColor), telling the five modes apart by SHAPE
 * instead. "Every swatch paints a distinct silhouette, at a legible ink, in
 * every reading mode" is the current lane: it measures the inverse of what
 * this one did — that every swatch now SHARES its ink and instead draws a
 * silhouette no other swatch draws. */

test('switching the reading mode repaints without moving anything', async ({ page }) => {
  await visit(page);
  const geometry = () =>
    page.evaluate(() => {
      const boxes = {};
      const round = ({ x, y, width, height }) =>
        [x, y, width, height].map((value) => Math.round(value * 100) / 100);
      for (const selector of ['#app', '.page-header', 'main', 'h1', '.panel-stack']) {
        const node = window.document.querySelector(selector);
        if (node === null) continue;
        boxes[selector] = round(node.getBoundingClientRect());
      }
      /* Every heatmap block by name, not just the first. A graph is now sized
         to the columns it draws out of the cell-metric custom properties, and
         a reading mode is allowed to restyle those cells but never to resize
         them — so the four modes are exactly where that rule is tested. */
      for (const block of window.document.querySelectorAll('.grid-block')) {
        const label = block.querySelector('.grid-strip')?.getAttribute('aria-label') ?? 'grid';
        boxes[`grid:${label}`] = round(block.getBoundingClientRect());
      }
      return {
        boxes,
        scrollHeight: window.document.documentElement.scrollHeight,
        surface: getComputedStyle(window.document.documentElement).backgroundColor,
      };
    });

  const before = await geometry();

  /* EVERY stamped mode, not one of them. The floor is that no reading mode
     moves the page, and a lane that only ever clicked Dark said nothing about
     the others — which is precisely where a mode added later would land.
     Each is compared against the ORIGINAL geometry rather than against its
     predecessor, so a drift that accumulates a fraction at a time cannot hide
     inside a chain of individually equal steps. */
  const painted = new Map();
  for (const [label, id] of [
    ['Dark', 'dark'],
    ['Slate', 'slate'],
    ['Sepia', 'sepia'],
    ['Light', 'light'],
  ]) {
    await openReadingModes(page);
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', id);
    const after = await geometry();
    /* Assert the switch actually happened before asserting nothing moved —
       otherwise a toggle that did nothing at all would pass this test
       perfectly. Distinctness across all four is the stronger form of that
       check: four modes that painted one surface would satisfy a per-step
       "something changed" comparison while three of them did not exist. */
    for (const [other, surface] of painted) {
      expect(after.surface, `${label} paints the same page surface as ${other}`).not.toBe(surface);
    }
    painted.set(label, after.surface);
    expect(after.boxes, `the ${label} swap moved the page under the reader`).toEqual(before.boxes);
    expect(after.scrollHeight, `the ${label} swap changed the page height`).toBe(before.scrollHeight);
  }

  /* Auto is the way back, and it is the ABSENCE of a stamp rather than a
     fifth palette — so what it has to prove is that un-stamping is as free of
     layout effect as stamping, and that the document returns to exactly the
     rendering the visitor arrived on. */
  await openReadingModes(page);
  await page.getByRole('button', { name: 'Auto', exact: true }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
  const unstamped = await geometry();
  expect(unstamped.boxes, 'returning to auto moved the page under the reader').toEqual(before.boxes);
  expect(unstamped.scrollHeight).toBe(before.scrollHeight);
  expect(
    unstamped.surface,
    'auto no longer paints what the unstamped document painted on arrival'
  ).toBe(before.surface);
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

/* The lane the page reserves on its inline end for the fixed reading-mode
 * control, below the handle breakpoint (issue 241). It is the same 44px every
 * control on this page is, and it is why a phone's column is its viewport less
 * its two gutters AND this — the arrangement that stops body text from
 * scrolling under a control it cannot move. Above the breakpoint the column's
 * own ceiling reserves two rail lanes instead and this term does not apply. */
const controlLanePx = 44;

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
        left: box.left,
        right: box.right,
        stack: stack.getBoundingClientRect().width,
        tracks: getComputedStyle(stack).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
        cards: [...window.document.querySelectorAll('.panel-shell')].map(
          (card) => Math.round(card.getBoundingClientRect().width)
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
    expect(observed.stack).toBeCloseTo(observed.main, 0);
    for (const card of observed.cards) {
      expect(card, `a card is ${card}px wide in a ${observed.main}px column`).toBeCloseTo(
        observed.stack,
        0
      );
    }
  }
});

/* The page's own top rhythm (owner directive, 2026-08-25). The header row is
 * fixed, so it occupies no flow space and reserved none: the h1 began at the
 * document's first pixel and the owner reported the name "almost feels like
 * it's about to escape". The reserve is derived — the chrome row's own top
 * inset plus the 44px hit box it is — and this measures the two boxes against
 * each other in a real engine rather than trusting the arithmetic.
 *
 * Measured at a phone width as well as the desktop projects, because that is
 * where the two boxes are closest to each other and where a safe-area inset
 * would join the calculation on a real device. */
test('the page name clears the fixed chrome row rather than starting under it', async ({ page }) => {
  await visit(page);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await settled(page);
    const measured = await page.evaluate(() => {
      const header = window.document.querySelector('.page-header');
      const name = window.document.querySelector('main h1');
      const app = window.document.getElementById('app');
      return {
        headerBottom: header.getBoundingClientRect().bottom,
        nameTop: name.getBoundingClientRect().top,
        reserved: parseFloat(getComputedStyle(app).paddingBlockStart),
      };
    });
    expect(
      measured.reserved,
      `the page reserves ${measured.reserved}px above its name at ${width}px`
    ).toBeGreaterThanOrEqual(60 - subPixel);
    expect(
      measured.nameTop,
      `at ${width}px the name starts at ${measured.nameTop}px, above the chrome row's own bottom edge at ${measured.headerBottom}px`
    ).toBeGreaterThanOrEqual(measured.headerBottom - subPixel);
  }
});

test('a phone still renders the single full-width column it always did', async ({ page }) => {
  await visit(page);
  for (const width of phoneWidths) {
    await page.setViewportSize({ width, height: 800 });
    await settled(page);
    const observed = await page.evaluate(() => {
      const stack = window.document.querySelector('.panel-stack');
      return {
        viewport: window.document.documentElement.clientWidth,
        stack: stack.getBoundingClientRect().width,
        tracks: getComputedStyle(stack).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
        cards: [...window.document.querySelectorAll('.panel-shell')].map((card) =>
          Math.round(card.getBoundingClientRect().width)
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
    /* Full width MINUS the fixed control's own lane since issue 241: a phone's
       column ends where the reading-mode control starts, because a column that
       ran under it put body text beneath a 44px control at every phone width
       (MEASURED on 0.1.54). The stack still fills every pixel it is given —
       what changed is how many it is given, and by exactly one control. */
    const expected = observed.viewport - gutterPx - controlLanePx;
    expect(observed.stack).toBeCloseTo(expected, 0);
    for (const card of observed.cards) {
      expect(card, `a card is ${card}px wide on a ${width}px phone`).toBeCloseTo(expected, 0);
    }
  }
});

test('every strip opens on its newest data and scrolls back for history', async ({ page }) => {
  await visit(page);
  /* Measured at a phone width in every project, including the desktop ones:
     a 1280px card fits a whole year of contributions, so the anchor would be
     trivially satisfied at 0 and this lane would prove nothing. */
  await page.setViewportSize({ width: 390, height: 800 });
  await settled(page);
  const strips = await page.evaluate(() =>
    [...window.document.querySelectorAll('.grid-strip')].map((strip) => ({
      label: strip.getAttribute('aria-label'),
      scrollLeft: Math.round(strip.scrollLeft),
      max: Math.round(strip.scrollWidth - strip.clientWidth),
    }))
  );
  expect(strips.length, 'the page renders no heatmaps; this lane proves nothing').toBeGreaterThan(0);
  /* Non-vacuity, moved off the individual strip and onto the page. A strip
     with nothing to scroll cannot demonstrate WHERE it opens — but "nothing
     to scroll" stopped meaning "the panel is broken" the day a source shipped
     a series SHORTER than its own box: two weeks of daily totals is a real
     recorded window that simply fits, and demanding it overflow would be
     demanding the panel pad it with days it never measured. So a short strip
     is skipped, and the lane still insists that at least one strip on the
     page has history to scroll back through. */
  const anchorable = strips.filter((strip) => strip.max > 0);
  expect(
    anchorable.length,
    'every heatmap fits its box at 390px, so none of them can show where it opens'
  ).toBeGreaterThan(0);
  for (const strip of anchorable) {
    expect(
      strip.scrollLeft,
      `"${strip.label}" opens ${strip.max - strip.scrollLeft}px short of its newest column`
    ).toBeCloseTo(strip.max, 0);
  }
});

/* Every graph occupies exactly the width its class prescribes.
 *
 * There are two classes and the page now renders only one of them. A
 * CONTENT-SIZED block is as wide as the columns it draws and no wider (issue
 * #141, residual risk 2: "the Anthropic grid reads small — fifteen days is
 * three columns in a strip sized for 53, hard against the left edge"). A
 * FULL-WIDTH block claims its card regardless of its data (issue #178, and
 * — since the owner's directive of 2026-08-25 — the contribution calendar as
 * well, which had the same dead gap on its right-hand side). Both remain
 * props on the one shared component; what changed is that both of this site's
 * callers now ask for the stretch, so the content-sized class has no live
 * example and its own box arithmetic is exercised by tests/grid.test.mjs's
 * stripColumns pins rather than by a rectangle on this page.
 *
 * Everything that is true of a graph WHATEVER its class stays measured here,
 * for every graph on the page, and none of it was specific to the sizing
 * rule: a block never claims fewer columns than it draws, its own less/more
 * key fits inside it, and the strip plus the weekday gutter account for every
 * pixel of the block around them. The class-specific measurement is then made
 * per class, so a full-width block that quietly stopped filling its card fails
 * here and not only in the token panel's own lane. */
test('every graph occupies exactly the width its class prescribes', async ({ page }) => {
  await visit(page);
  const observed = await page.evaluate(() => {
    const width = (node) => Math.round(node.getBoundingClientRect().width * 100) / 100;
    return [...window.document.querySelectorAll('.grid-block')].map((block) => {
      const body = block.querySelector('.grid-body');
      const weekdayAxis = block.querySelector('.grid-weekday-axis');
      const strip = block.querySelector('.grid-strip');
      const cells = block.querySelector('.grid-cells');
      const legend = block.querySelector('.grid-legend');
      const cell = cells.querySelector('.grid-cell');
      const gap = parseFloat(getComputedStyle(cells).columnGap || '0');
      /* The weekday gutter (issue 189) shares .grid-body's horizontal budget
         with the strip, so "the block is exactly its cells" is no longer the
         whole story — the block is the gutter, the row-gap beside it, AND
         the cells. Measured off the DOM like every other figure here, never
         hardcoded from the token defaults, so a themed override of
         --grid-axis-width or --grid-gap cannot silently desync this lane
         from what an engine actually painted. */
      const axisWidth = weekdayAxis === null ? 0 : width(weekdayAxis);
      const bodyGap = parseFloat(getComputedStyle(body).columnGap || getComputedStyle(body).gap || '0');
      /* The legend's INTRINSIC width: it is a nowrap flex row, so its own
         box tells you nothing about whether its contents fit inside it. */
      const legendChildren = [...legend.children];
      const legendGap = parseFloat(getComputedStyle(legend).columnGap || '0');
      const legendWidth =
        legendChildren.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0) +
        legendGap * Math.max(0, legendChildren.length - 1) +
        legendChildren.reduce((sum, child) => {
          const style = getComputedStyle(child);
          return (
            sum +
            parseFloat(style.marginInlineStart || '0') +
            parseFloat(style.marginInlineEnd || '0')
          );
        }, 0);
      return {
        label: strip.getAttribute('aria-label'),
        state: block.getAttribute('data-grid-state'),
        fullWidth: block.getAttribute('data-grid-fullwidth') === 'true',
        claimed: Number(block.getAttribute('data-grid-columns')),
        /* Counted off the DOM, never read back off the same attribute the
           claim came from: a lane that compared an attribute with itself
           would agree with any value at all. */
        drawn: Math.ceil(cells.querySelectorAll('.grid-cell').length / 7),
        cellSize: width(cell),
        gap,
        axisWidth,
        bodyGap,
        block: width(block),
        strip: width(strip),
        cells: width(cells),
        available: width(block.parentElement),
        legend: Math.round(legendWidth * 100) / 100,
      };
    });
  });
  expect(observed.length, 'the page renders no heatmaps; this lane proves nothing').toBeGreaterThan(
    0
  );

  /* Non-vacuity: at least one year-wide graph must be on the page, or the
     "a claim covers its data" direction below is proved against nothing. */
  const long = observed.filter((grid) => grid.drawn >= 52);
  expect(long.length, 'no year-wide graph is on the page to measure').toBeGreaterThan(0);

  for (const grid of observed) {
    /* CLASS-INDEPENDENT, all three of them.

       The claim covers the data: a box narrower than its own cells would clip
       a series the panel says it is showing. */
    expect(grid.claimed, `"${grid.label}" claims fewer columns than it draws`).toBeGreaterThanOrEqual(
      grid.drawn
    );
    /* The floor is the block's own furniture, measured per engine rather
       than taken from the source constant: the less/more key printed under
       every graph has to fit in the graph's box. */
    expect(
      grid.block,
      `"${grid.label}" is ${grid.block}px wide and its less/more key needs ${grid.legend}px`
    ).toBeGreaterThanOrEqual(Math.min(grid.legend, grid.available) - subPixel);
    /* And the strip fills what the block leaves it once the gutter (issue
       189) has taken its own fixed share, so the frame drawn around an
       empty plate is the frame around the box the data will land in — the
       block is no longer the strip alone, but the two must still account
       for every pixel of each other. */
    expect(
      grid.strip + grid.axisWidth + grid.bodyGap,
      `"${grid.label}" strip, gutter and block disagree about their combined width`
    ).toBeCloseTo(grid.block, 1);

    if (grid.fullWidth) {
      /* A full-width block IS its container, whatever its data — the dead
         gap on the right of the card is exactly what the owner reported on
         both graphs, and this is where its absence is measured for every
         one of them rather than for the token panel alone. */
      expect(
        grid.block,
        `"${grid.label}" is ${grid.block}px inside ${grid.available}px of card, leaving a dead gap`
      ).toBeCloseTo(grid.available, 0);
      continue;
    }
    /* A content-sized block is exactly the columns it claims. The gutter
       (issue 189) is part of that box's own budget, not only the cells —
       see .grid-block's own calc(), which this mirrors term for term rather
       than approximating. */
    const expected = grid.axisWidth + grid.bodyGap + grid.claimed * (grid.cellSize + grid.gap) - grid.gap;
    /* Never wider than what it claims — the reported defect. */
    expect(
      grid.block,
      `"${grid.label}" draws ${grid.drawn} columns and occupies ${grid.block}px, ${expected}px of box`
    ).toBeLessThanOrEqual(expected + subPixel);
    /* ...and it takes that whole width unless the card it sits in is
       narrower, in which case the strip scrolls inside itself rather than
       taking the page's scrollbar sideways with it. */
    expect(
      grid.block,
      `"${grid.label}" is ${grid.block}px inside ${grid.available}px of card, short of its ${expected}px`
    ).toBeGreaterThanOrEqual(Math.min(expected, grid.available) - subPixel);
    expect(
      expected,
      `"${grid.label}" claims ${grid.claimed} columns for ${grid.drawn} columns of cells`
    ).toBeGreaterThanOrEqual(grid.cells - subPixel);
  }
});

/* The scrollbar gutter, measured in the engine that draws the scrollbar
 * (issue 130). The strip clips a wide window behind its own horizontal
 * scrollbar and reserves room for it inside a FIXED box; the reserve was a
 * guess, and the guess was 9px against a scrollbar that is 15px on a classic
 * Windows or Linux theme, so the month axis clipped.
 *
 * The claim is not "the gutter is N pixels" — no N is right on every
 * platform. It is that whatever this engine's scrollbar takes, the strip's
 * CLIENT box still holds every row the strip draws: seven cells, their gaps,
 * and the month axis under them. That is measurable on an overlay-scrollbar
 * engine and a classic-scrollbar one alike, and it is exactly what fails on
 * the arithmetic this replaced. */
test('every strip still holds all of its own rows once the engine has taken its scrollbar', async ({
  page,
}) => {
  await visit(page);
  const observed = await page.evaluate(() => {
    const height = (node) => (node === null ? 0 : node.getBoundingClientRect().height);
    return [...window.document.querySelectorAll('.grid-block')].map((block) => {
      const strip = block.querySelector('.grid-strip');
      const cells = block.querySelector('.grid-cells');
      const months = block.querySelector('.grid-months');
      const monthGap = months === null ? 0 : parseFloat(getComputedStyle(months).marginBlockStart || '0');
      return {
        label: strip.getAttribute('aria-label'),
        /* What the engine actually gave the scrollbar: the difference
           between the strip's border box and the box its content sees. */
        scrollbar: strip.offsetHeight - strip.clientHeight,
        client: strip.clientHeight,
        rows: height(cells) + monthGap + height(months),
        gutter: getComputedStyle(window.document.documentElement).getPropertyValue(
          '--grid-scrollbar-size'
        ),
      };
    });
  });
  expect(observed.length, 'the page renders no heatmaps; this lane proves nothing').toBeGreaterThan(0);
  for (const strip of observed) {
    /* The measurement was published before the page mounted, so the reserve
       every strip was laid out with is the one this engine reports. */
    expect(strip.gutter.trim(), 'nothing measured this platform’s scrollbar').toMatch(/^\d+px$/);
    expect(
      parseFloat(strip.gutter),
      'the published gutter is under the reserve the stylesheet ships with'
    ).toBeGreaterThanOrEqual(12);
    /* The claim: the scrollbar takes its share out of the RESERVE, never out
       of the rows. A strip whose client box is shorter than its own content
       is one clipping its month axis, which is the defect issue 130
       reported. */
    expect(
      strip.client,
      `"${strip.label}" gave ${strip.scrollbar}px to its scrollbar and has ${strip.client}px of client box left for ${strip.rows}px of rows`
    ).toBeGreaterThanOrEqual(strip.rows - subPixel);
  }
});

/* Re-serves the origin's own token-usage envelope with one source's series
 * replaced, so a lane can put a series of any length on the real page without
 * inventing a payload shape. `edit` receives the decoded envelope and mutates
 * it in place; everything it leaves alone is what the origin actually served.
 * Must be installed before the first navigation, so the panel's own fetch and
 * any read-back see the identical bytes. */
async function stageUsagePayload(page, edit) {
  await page.route('**/api/panels/token-usage', async (route) => {
    const response = await route.fetch();
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

/* LOOK, at every length a real series can be (owner directive, 2026-08-24;
 * RETARGETED by issue 178, RETARGETED AGAIN by issue 189). Sizing a box to
 * its data was only an improvement if the box's GRAMMAR survived the short
 * end — that used to mean "the same cell, the same gap, the legend in the
 * same place" while the CELL COUNT still tracked the series length one-for-
 * one. Issue 189 retired that second half: every dated series, however
 * short or long, now realigns onto the SAME fixed pendingWeeks trailing
 * window (calendarColumns) — a fixed weekday axis is only truthful across a
 * fixed window, so a strip that still resized its column count with its
 * data could never promise one. What this lane proves is therefore the
 * stronger, simpler claim issue 189 makes true: the box, the cell size, the
 * gap, the row height and the legend placement are now IDENTICAL for every
 * series length, not merely "no narrower than the shortest." A strip that
 * quietly still varied its column count with the data, or that let its key
 * drift at one length and not another, would pass every OTHER assertion in
 * this file and still be wrong. So the four shapes are rendered on the real
 * page and compared to each other. */
test('the full-width strip draws the identical fixed window at every series length (issue 189)', async ({ page }) => {
  const shapes = [1, 15, 31];
  const measured = [];
  for (const days of shapes) {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await stageUsagePayload(page, (envelope) => {
      const sources = envelope?.data?.sources ?? [];
      expect(sources.length, 'the origin serves no usage source to restage').toBeGreaterThan(0);
      sources[0].series = syntheticSeries(days);
    });
    await visit(page);
    measured.push({
      days,
      ...(await page.evaluate(() => {
        const block = window.document.querySelector('.usage-source .grid-block');
        const rect = (node) => node.getBoundingClientRect();
        const cells = block.querySelector('.grid-cells');
        const legend = block.querySelector('.grid-legend');
        const cell = cells.querySelector('.grid-cell');
        const round = (value) => Math.round(value * 100) / 100;
        return {
          claimed: Number(block.getAttribute('data-grid-columns')),
          drawn: Math.ceil(cells.querySelectorAll('.grid-cell').length / 7),
          cell: round(rect(cell).width),
          cellHeight: round(rect(cell).height),
          gap: round(parseFloat(getComputedStyle(cells).columnGap || '0')),
          rows: getComputedStyle(cells).gridTemplateRows.split(' ').length,
          block: round(rect(block).width),
          /* Placement, measured as the offset of the key's END edge from the
             block's END edge: the legend is right-aligned under the graph, and
             "right-aligned" is a relationship, not a width. */
          legendOffset: round(rect(block).right - rect(legend).right),
          legendTop: round(rect(legend).top - rect(block).top),
          strip: round(rect(block.querySelector('.grid-strip')).height),
        };
      })),
    });
  }

  const [first, ...rest] = measured;
  for (const shape of measured) {
    // The fixed window (issue 189): every dated series, whatever its own
    // length, realigns onto the SAME pendingWeeks trailing calendar, so
    // "drawn" no longer tracks the series length at all.
    expect(
      shape.drawn,
      `a ${shape.days}-day series drew ${shape.drawn} columns instead of the fixed trailing window it claims (${shape.claimed})`
    ).toBe(shape.claimed);
    expect(shape.rows, `a ${shape.days} day series stopped being seven days tall`).toBe(7);
  }
  for (const shape of rest) {
    /* The grammar that survives full width: identical BOX (the card's own
       width, not the data's), identical row height, identical gap, identical
       legend placement relative to that unchanging box — and now, because
       the fixed window means the column count itself never varies with the
       series length either, identical CELL size too. A strip whose own
       window never changes shape has nothing left that data length could
       stretch or shrink. */
    expect(
      shape.claimed,
      `the fixed window changed width at ${shape.days} days (${first.claimed} columns at 1 day, ${shape.claimed} here)`
    ).toBe(first.claimed);
    expect(
      shape.block,
      `the box resized from ${first.block}px at 1 day to ${shape.block}px at ${shape.days} days; full width means the card decides the box, not the data`
    ).toBe(first.block);
    expect(
      shape.cell,
      `the cell width moved at ${shape.days} days even though the fixed window never changes column count`
    ).toBe(first.cell);
    expect(shape.cellHeight, `the cell height moved at ${shape.days} days`).toBe(first.cellHeight);
    expect(shape.gap, `the gap moved at ${shape.days} days`).toBe(first.gap);
    expect(shape.strip, `the strip changed height at ${shape.days} days`).toBe(first.strip);
    expect(
      shape.legendOffset,
      `the less/more key sits ${shape.legendOffset}px from the block edge at ${shape.days} days and ${first.legendOffset}px at 1 day`
    ).toBe(first.legendOffset);
    expect(shape.legendTop, `the key changed row at ${shape.days} days`).toBe(first.legendTop);
  }
  /* The reserve is genuinely the width all three claim, rather than a number
     they happen to agree on: a one-day series and a month-long one both draw
     the same fifty-three columns, which is the direction a stray data-driven
     code path would break at one end of the range and not the other. */
  for (const shape of measured) {
    expect(shape.claimed, `a ${shape.days}-day series no longer claims the reserve`).toBe(53);
  }

  /* AND THE OTHER SIDE OF THE WINDOW (issue 233). The reserve stopped being a
     CEILING when the display menu was deleted: keeping the retired 12mo
     default would have silently dropped every day past a year, which is the
     defect the deleted range control existed to remove, so the fixed window
     is the wider of the reserve and the capture (fullDepthColumns,
     lib/periods.ts). Measured here rather than only in that module's own
     tests, because "the strip grew" is a claim about a rendered box: a
     four-hundred-day capture must draw MORE than the reserve, must draw the
     width it claims, and must still be seven days tall in a box the card
     still decides. */
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await stageUsagePayload(page, (envelope) => {
    const sources = envelope?.data?.sources ?? [];
    expect(sources.length, 'the origin serves no usage source to restage').toBeGreaterThan(0);
    sources[0].series = syntheticSeries(400);
  });
  await visit(page);
  const deep = await page.evaluate(() => {
    const block = window.document.querySelector('.usage-source .grid-block');
    const cells = block.querySelector('.grid-cells');
    const round = (value) => Math.round(value * 100) / 100;
    return {
      claimed: Number(block.getAttribute('data-grid-columns')),
      drawn: Math.ceil(cells.querySelectorAll('.grid-cell').length / 7),
      rows: getComputedStyle(cells).gridTemplateRows.split(' ').length,
      block: round(block.getBoundingClientRect().width),
    };
  });
  expect(
    deep.claimed,
    `a 400-day capture drew ${deep.claimed} columns; the reserve is a ceiling again`
  ).toBeGreaterThan(53);
  expect(deep.claimed * 7, 'the window is too narrow to hold the capture it drew').toBeGreaterThanOrEqual(400);
  expect(deep.drawn, 'the deep window drew a width it did not claim').toBe(deep.claimed);
  expect(deep.rows, 'the deep window stopped being seven days tall').toBe(7);
  expect(deep.block, 'the card stopped deciding the box once the capture outgrew the reserve').toBe(first.block);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/* RESPONSIVENESS (owner directive, 2026-08-24). The page column is a single
 * token and a parallel lane is making it user-continuous, so this lane tests
 * the token's RANGE rather than its current value: whatever width the reader
 * ends up choosing, a data-sized strip must stay inside its card, keep its
 * scroll inside itself, and never take the document sideways. The token is
 * driven from the outside exactly as a user control would drive it — this
 * lane knows nothing about how that control is built. */
test('the strip survives the whole range of the page column token', async ({ page }) => {
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
    const observed = await page.evaluate(() => ({
      scrollWidth: window.document.documentElement.scrollWidth,
      clientWidth: window.document.documentElement.clientWidth,
      grids: [...window.document.querySelectorAll('.grid-block')].map((block) => {
        const strip = block.querySelector('.grid-strip');
        const cells = block.querySelector('.grid-cells');
        return {
          label: strip.getAttribute('aria-label'),
          block: Math.round(block.getBoundingClientRect().width * 100) / 100,
          card: Math.round(block.parentElement.getBoundingClientRect().width * 100) / 100,
          cells: Math.round(cells.getBoundingClientRect().width * 100) / 100,
          overflowing: strip.scrollWidth > strip.clientWidth,
          height: Math.round(block.getBoundingClientRect().height * 100) / 100,
        };
      }),
    }));
    expect(
      observed.scrollWidth,
      `a ${width} page column scrolls the document sideways (${observed.scrollWidth} > ${observed.clientWidth})`
    ).toBeLessThanOrEqual(observed.clientWidth + subPixel);
    expect(observed.grids.length, `no heatmap rendered at a ${width} page column`).toBeGreaterThan(0);
    for (const grid of observed.grids) {
      expect(
        grid.block,
        `"${grid.label}" is ${grid.block}px inside a ${grid.card}px card at a ${width} page column`
      ).toBeLessThanOrEqual(grid.card + subPixel);
      /* Wider content than box is legal — that is what the strip's own
         scroller is for — but only ever inside the strip. */
      if (grid.cells > grid.block + subPixel) {
        expect(
          grid.overflowing,
          `"${grid.label}" overflows its box at a ${width} page column without scrolling inside itself`
        ).toBe(true);
      }
      expect(
        grid.height,
        `"${grid.label}" changed height at a ${width} page column; the block-size reserve is not width-independent`
      ).toBeCloseTo(observed.grids[0].height, 1);
    }
  }
  await page.evaluate(() =>
    window.document.documentElement.style.removeProperty('--page-column-width')
  );
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
       a rendered string does, so the payload has to be one the panel renders. */
    sources[0].series = { startDate: '2026-08-10', totals: [1, 2, 3], recorded: true };
  });
  await visit(page);
  const observed = await page.evaluate(
    ([label, account]) => {
      const panel = window.document.querySelector('[data-panel-id="token-usage"]');
      const heads = [...panel.querySelectorAll('.usage-source-label')].map((node) => ({
        text: node.textContent,
        children: node.children.length,
      }));
      return {
        pwned: window.__pwned === undefined ? 'clean' : 'executed',
        injected: panel.querySelectorAll('img, script, iframe, object, embed').length,
        heads,
        matchesLabel: heads.some((head) => head.text === label),
        matchesAccount: [...panel.querySelectorAll('.usage-account')].some(
          (node) => node.textContent === account
        ),
        /* The graph the hostile source DOES get: a real series, drawn from
           strings that never became markup. */
        graphs: panel.querySelectorAll('.grid-block').length,
      };
    },
    [hostile, hostileAccount]
  );

  expect(observed.pwned, 'a payload string executed in the page').toBe('clean');
  expect(observed.injected, 'a payload string created elements in the panel').toBe(0);
  /* Rendered, and rendered VERBATIM: a lane that only checked "nothing
     executed" would pass on a panel that silently dropped the label. */
  expect(observed.matchesLabel, 'the hostile label did not render as its own literal text').toBe(
    true
  );
  expect(
    observed.matchesAccount,
    'the hostile account did not render as its own literal text'
  ).toBe(true);
  for (const head of observed.heads) {
    expect(head.children, 'a source heading grew element children from its payload string').toBe(0);
  }
  expect(observed.graphs, 'the staged payload rendered no graph; this half proved nothing')
    .toBeGreaterThan(0);

  /* The other half: a start date that is not a calendar date. The grid does
     day arithmetic on that string, so admission refuses the WHOLE payload
     rather than rendering the parts of it that happened to parse — and the
     panel says so instead of showing a partial one. */
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await stageUsagePayload(page, (envelope) => {
    const sources = envelope?.data?.sources ?? [];
    sources[0].series = { startDate: '"><script>window.__pwned = true</script>', totals: [1] };
  });
  await visit(page);
  const refused = await page.evaluate(() => {
    const panel = window.document.querySelector('[data-panel-id="token-usage"]');
    return {
      pwned: window.__pwned === undefined ? 'clean' : 'executed',
      injected: panel.querySelectorAll('img, script, iframe, object, embed').length,
      sources: panel.querySelectorAll('.usage-source').length,
      graphs: panel.querySelectorAll('.grid-block').length,
      empty: panel.querySelector('.usage-empty')?.textContent ?? '',
    };
  });
  expect(refused.pwned, 'a malformed start date executed in the page').toBe('clean');
  expect(refused.injected, 'a malformed start date created elements in the panel').toBe(0);
  expect(refused.sources, 'a payload with a malformed series rendered part of itself anyway').toBe(
    0
  );
  expect(refused.graphs, 'a payload with a malformed series still drew a graph').toBe(0);
  expect(refused.empty, 'a refused payload renders no honest empty state').not.toBe('');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('the boss log is three columns that never scroll', async ({
  page,
}) => {
  await visit(page);
  const table = await page.evaluate(() => {
    const box = window.document.querySelector('.stat-grid[data-cells="roomy"]');
    const style = getComputedStyle(box);
    const cells = [...box.querySelectorAll('.stat-cell')];
    const distinct = (values) => new Set(values.map((value) => Math.round(value))).size;
    return {
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      scrollWidth: box.scrollWidth,
      clientWidth: box.clientWidth,
      scrollHeight: box.scrollHeight,
      clientHeight: box.clientHeight,
      cells: cells.length,
      /* The shape the engine actually laid out, measured from the tiles
         rather than read back off the CSS: three columns, wrapping downward
         for as many rows as the payload needs. */
      columns: distinct(cells.map((cell) => cell.getBoundingClientRect().left)),
      rows: distinct(cells.map((cell) => cell.getBoundingClientRect().top)),
      icons: box.querySelectorAll('img.stat-icon').length,
    };
  });
  /* The owner asked for the scrolling to go away, not to be pointed in
     another direction (issue 134). This table has been a vertical scroller
     and a sideways one; the assertion now is that there is no scroll region
     left at all — no overflow, and nothing to scroll to on either axis. */
  expect(table.overflowX, 'the boss table is a scroll region again').toBe('visible');
  expect(table.overflowY, 'the boss table is a scroll region again').toBe('visible');
  expect(table.scrollWidth, 'the boss table has content to scroll across').toBe(table.clientWidth);
  expect(table.scrollHeight, 'the boss table has content to scroll down to').toBe(
    table.clientHeight
  );
  /* Columns of three, going down — the owner's words. The arrangement this
     replaced would report two rows and dozens of columns. */
  expect(table.cells, 'the boss table rendered no tiles').toBeGreaterThan(50);
  expect(table.columns, `the boss table laid out ${table.columns} columns`).toBe(3);
  expect(
    table.rows,
    `the boss table laid out ${table.rows} rows for ${table.cells} tiles in three columns`
  ).toBe(Math.ceil(table.cells / 3));
  /* The owner locked the vendored art exactly as it renders, so the lane
     counts what actually painted rather than trusting the markup. */
  expect(table.icons, 'the boss table rendered no icons').toBeGreaterThan(50);
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
    // Scoped to the header: .icon-button is a shared control shape (issue
    // 176 reuses it for the gallery's prev/next/close), and this test's own
    // claim is specifically about the page's top-end-corner chrome.
    const icons = [...window.document.querySelectorAll('.page-header .icon-button')];
    return {
      heading: window.document.querySelector('h1')?.textContent?.trim(),
      titles: [...window.document.querySelectorAll('.panel-title')].map((n) => n.textContent.trim()),
      badges: window.document.querySelectorAll('.panel-badge').length,
      provenance: [...window.document.querySelectorAll('.panel-shell')].every((n) =>
        n.hasAttribute('data-panel-status')
      ),
      viewport: window.document.documentElement.clientWidth,
      icons: icons.map((node) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          label: node.getAttribute('aria-label'),
          top: Math.round(box.top),
          left: Math.round(box.left),
          right: Math.round(box.right),
          width: box.width,
          height: box.height,
          border: Number.parseFloat(style.borderTopWidth),
          radius: Number.parseFloat(style.borderTopLeftRadius),
          background: style.backgroundColor,
        };
      }),
    };
  });
  expect(observed.heading).toBe('Samuel Naranjo');
  /* The heading the ORIGIN serves for the version-control panel, chosen in
     config data because neither source tree may spell a vendor name. Reading
     it off the rendered card is what proves the whole path — config, Go
     overlay, envelope, component — rather than any one link in it. */
  expect(observed.titles).toContain('GitHub');
  /* No card announces its own age any more, and every card still carries the
     status the badge used to read from. */
  expect(observed.badges, 'a freshness badge is rendering again').toBe(0);
  expect(observed.provenance, 'a card lost the status the badge used to display').toBe(true);
  /* The one remaining control, in the top-end corner. A second — the manual
     refresh — used to sit beside it and is retired now (issue 179); before
     that, the reading mode alone sat above the title while the refresh
     headed the panel stack below it (issue 127). Neither stacked arrangement
     survives. */
  expect(observed.icons.length, 'the page chrome is not one icon').toBe(1);
  for (const icon of observed.icons) {
    expect(icon.top, `"${icon.label}" is not in the top row`).toBeLessThan(64);
    expect(
      icon.left,
      `"${icon.label}" starts at ${icon.left}px, in the start half of a ${observed.viewport}px page`
    ).toBeGreaterThan(observed.viewport / 2);
    /* Icons, not buttons: no disc, no border, no fill... */
    expect(icon.border, `"${icon.label}" wears a border`).toBe(0);
    expect(icon.radius, `"${icon.label}" wears a disc`).toBe(0);
    expect(icon.background, `"${icon.label}" wears a fill`).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    /* ...and the touch target is untouched by any of that. */
    expect(icon.width, `"${icon.label}" is ${icon.width}px wide`).toBeGreaterThanOrEqual(
      touchFloorPx - subPixel
    );
    expect(icon.height, `"${icon.label}" is ${icon.height}px tall`).toBeGreaterThanOrEqual(
      touchFloorPx - subPixel
    );
  }
  /* Pinned to the VIEWPORT'S own corner, not the column's (owner directive,
     issue 168): "push the icons all the way to the top right, outside of the
     feed." Measuring against the column would measure the centring instead
     of the thing that actually changed — the header used to share the
     column's own inline-size rule and does not any more. A single gutter's
     worth of gap on each edge is what a fixed corner control with no notch
     to clear resolves to (env(safe-area-inset-*) is 0 on every engine this
     lane runs without a device that reports one). */
  const [icon] = observed.icons;
  expect(icon.top, `the icon sits ${icon.top}px from the top edge`).toBeLessThanOrEqual(gutterPx / 2 + subPixel);
  expect(
    observed.viewport - icon.right,
    `the icon sits ${observed.viewport - icon.right}px from the viewport's end edge`
  ).toBeLessThanOrEqual(gutterPx / 2 + subPixel);
});

/* ===========================================================================
 * The section nav's fragment (owner report, issue 171)
 *
 * "Refreshing the website twice in Orion browser iphone causes the screen to
 * go to #trackers immediately." The nav links are plain fragment anchors, and
 * an ordinary tap writes that fragment into the URL and leaves it there —
 * every later refresh re-applies it, so the page snaps to the section instead
 * of loading at the top. Two behaviors have to hold at once, and this is the
 * lane that can tell them apart from a source pin: a tap must not leave the
 * fragment behind for a refresh to find, and a direct visit to a shared
 * .../#trackers URL must still deep-link, because that half is desirable and
 * stays. tests/sections.test.mjs pins the shape of the fix; this executes the
 * actual reload against a real History API.
 * ======================================================================== */

test('a nav tap does not leave a fragment for a refresh to re-apply (issue 171)', async ({ page }) => {
  await visit(page);
  await page.getByRole('link', { name: 'Trackers' }).click();
  await expect(page.locator('#trackers')).toBeInViewport();
  // The tap itself must not have parked the fragment in the URL.
  await expect(page, 'the nav tap left a fragment in the URL').not.toHaveURL(/#/);

  // The refresh this issue is actually about: a page that left the fragment
  // behind restores the scrolled-to-section here instead of loading at the
  // top, which is the defect Orion reported on iPhone.
  await page.reload();
  await settled(page);
  const scrollTop = await page.evaluate(() => window.scrollY);
  expect(
    scrollTop,
    'a refresh after a nav tap restored a scroll position instead of loading at the top'
  ).toBe(0);
});

test('a direct visit to a shared fragment URL still deep-links (issue 171)', async ({ page }) => {
  await page.goto('/#trackers');
  await settled(page);
  await expect(page.locator('#trackers')).toBeInViewport();
});

/* INVERTED by the owner's ruling of 2026-08-24, and the inversion is the
 * finding. This lane used to REQUIRE the empty grid on the live page: a
 * `.grid-empty` note reading exactly "series pending" over more than three
 * hundred placeholder cells. Every cell was honest about itself — absent,
 * valueless, undated — and the arrangement was still false, because "pending"
 * is a claim about the future and this source has no daily record to publish.
 * The panel was holding a graph-shaped box open for data that cannot arrive,
 * which is a permanent hole rather than the zero-CLS reserve it looked like.
 *
 * So the new guarantee is the opposite one, and it is asserted in both
 * directions because either half alone is satisfied by a page that got it
 * badly wrong: a site that dropped every heatmap passes "no empty grid", and
 * the old page passed "the real grid renders".
 *
 * The page is judged against the ORIGIN's own payload rather than against
 * itself. Which sources report a daily series is a fact the API states, so
 * reading it there and then looking for the matching graph makes the lane
 * name the offending source by label — instead of inferring what the page
 * meant to do from what the page did, which is how a rendering test comes to
 * agree with every regression it was written to catch.
 *
 * One source's series is STAGED away rather than waited for, and that is a
 * repair, not a shortcut. The lane needs a seriesless source and a serialised
 * one on the same screen; it used to get both by accident, because the
 * shipped snapshot happened to carry a series for one source and none for the
 * other. The day a real capture landed for the second source (issue #140) the
 * lane went red on its own non-vacuity check — with nothing wrong with the
 * page. A guarantee about how the page treats an absent series must not
 * depend on the owner's usage records happening to be missing one, so the
 * absence is now produced from the origin's OWN envelope, one field deleted
 * from one source. Everything else on the wire is the origin's real payload,
 * and the assertions still name sources by the label the API gave them. */
test('a source with no series renders no graph, and one with a series still renders all of it', async ({
  page,
}) => {
  /* Staged before the first navigation so the panel's own fetch and the
     read-back below see the identical envelope. */
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
    const panel = window.document.querySelector('[data-panel-id="token-usage"]');
    if (panel === null) return null;
    const response = await fetch('/api/panels/token-usage');
    const envelope = await response.json();
    const strip = (node) =>
      Math.round(node.querySelector('.grid-strip').getBoundingClientRect().height);
    const rendered = {};
    for (const source of panel.querySelectorAll('.usage-source')) {
      const block = source.querySelector('.grid-block');
      rendered[source.querySelector('.usage-source-label').textContent.trim()] = {
        region: source.querySelector('.usage-activity') !== null,
        blocks: source.querySelectorAll('.grid-block').length,
        /* What tells a source WITH a graph from one without, now that the
           display menu is gone (issue 233): the activity heading. It used to
           be the count of that source's lens toggles, and both halves of this
           lane would now read zero — a discriminator that cannot
           discriminate. The heading is scoped to the activity region because
           the insights section carries the same class. */
        activityHeadings: source.querySelectorAll('.usage-activity .usage-section-title').length,
        toggles: source.querySelectorAll('[role="radiogroup"]').length,
        datapoints: source.querySelectorAll('[data-grid-cell]').length,
        placeholders: source.querySelectorAll('[data-grid-pending]').length,
        notes: source.querySelectorAll('.grid-empty').length,
        /* What a source still has to show for itself once its graph is gone.
           A block with no figures left would be the hole this ruling was
           about, moved rather than closed. */
        tiles: source.querySelectorAll('[data-usage-tile]').length,
        stripHeight: block === null ? 0 : strip(block),
      };
    }
    return {
      /* What the origin SAYS, read from the same API the panel reads. */
      reported: (envelope?.data?.sources ?? []).map((source) => ({
        label: source.label,
        series: Array.isArray(source?.series?.totals) && source.series.totals.length > 0,
      })),
      rendered,
      pending: panel.querySelectorAll('[data-grid-pending]').length,
      notes: panel.querySelectorAll('.grid-empty').length,
      /* The other heatmap on the page, and the geometry the shared component
         guarantees. The graph that STAYED must render in exactly that box:
         this is the height comparison the retired lane made between an empty
         grid and a full one, made between two full ones instead. */
      calendarStrip: (() => {
        const block = window.document.querySelector('[data-activity-panel] .grid-block');
        return block === null ? 0 : strip(block);
      })(),
    };
  });
  expect(observed, 'the token panel never painted; this lane proves nothing').not.toBeNull();

  const bare = observed.reported.filter((source) => !source.series);
  const drawn = observed.reported.filter((source) => source.series);
  expect(
    bare.length,
    'no source reports an absent series even with one staged away; the panel is reading something other than the payload'
  ).toBeGreaterThan(0);
  expect(
    drawn.length,
    'every source lost its series; a page with no heatmaps would pass the other half for free'
  ).toBeGreaterThan(0);

  for (const source of bare) {
    const shown = observed.rendered[source.label];
    expect(shown, `the origin reports "${source.label}" and the page does not render it`).toBeDefined();
    /* No grid element in the DOM — not an empty one, not a dimmed one, not a
       placeholder one. */
    expect(shown.blocks, `"${source.label}" reports no series and renders a grid anyway`).toBe(0);
    expect(shown.datapoints, `"${source.label}" rendered datapoints it was never given`).toBe(0);
    expect(shown.placeholders, `"${source.label}" renders placeholder cells again`).toBe(0);
    expect(shown.notes, `"${source.label}" renders an empty-grid note again`).toBe(0);
    /* Nor the heading the graph came with: a heading over no series is the
       same hole in different markup. */
    expect(shown.region, `"${source.label}" kept the graph region around an absent graph`).toBe(
      false
    );
    expect(
      shown.activityHeadings,
      `"${source.label}" kept an activity heading with nothing under it`
    ).toBe(0);
    /* And it is still a complete block rather than something with a hole in
       it: the figures the source genuinely reports are all still there. */
    expect(shown.tiles, `"${source.label}" lost its figures along with its graph`).toBeGreaterThan(0);
  }

  for (const source of drawn) {
    const shown = observed.rendered[source.label];
    expect(shown, `the origin reports "${source.label}" and the page does not render it`).toBeDefined();
    expect(shown.region, `"${source.label}" reports a series and renders no graph region`).toBe(true);
    expect(
      shown.datapoints,
      `"${source.label}" reports a series and renders a graph with nothing in it`
    ).toBeGreaterThan(0);
    expect(shown.placeholders, `"${source.label}" pads its real series with placeholders`).toBe(0);
    expect(shown.notes, `"${source.label}" renders an empty-grid note over a real series`).toBe(0);
    /* The heading is the other half of the discriminator: a source that
       reports a series carries exactly one activity heading, and a source
       that reports none carries none. */
    expect(shown.activityHeadings, `"${source.label}" lost the heading over its graph`).toBe(1);
    /* And it carries no display control, in either case — the panel offers
       nothing to press since 2026-08-28. Asserted on the SOURCE rather than
       only panel-wide so a control growing back beside one graph fails here
       too. */
    expect(shown.toggles, `"${source.label}" grew a display control back`).toBe(0);
    /* MEASURED, not asserted: the graph that stayed renders in exactly the
       box the shared component gives the other panel's calendar, so removing
       the region beside it moved nothing about it. */
    expect(observed.calendarStrip, 'no second heatmap to measure against').toBeGreaterThan(0);
    expect(
      shown.stripHeight,
      `"${source.label}" renders its graph in a different box from the page's other heatmap`
    ).toBe(observed.calendarStrip);
  }

  /* Nothing anywhere in this panel is a placeholder. */
  expect(observed.pending, 'the token panel renders placeholder cells somewhere').toBe(0);
  expect(observed.notes, 'the token panel renders an empty-grid note somewhere').toBe(0);
});

/* The other half of the ruling, and the reason the empty state was not simply
 * deleted from the shared component. A reserve for a payload that is IN
 * FLIGHT is not the hole this ruling was about: the version-control calendar
 * fetches after hydration, and the box held for it is exactly the box it
 * lands in. That is the zero-CLS floor AGENTS.md requires, and it is the one
 * thing the retired lane was measuring that was worth keeping — so it is
 * measured here, across a real arrival, instead of between two panels that
 * never had the same data.
 *
 * The payload is delayed deliberately. Served from the embedded snapshot on
 * localhost it lands within a frame of first paint, so the waiting state is
 * real but too brief to measure, and a lane that cannot observe the state it
 * is about proves nothing. */
test('a panel whose data is still on its way holds exactly the box that data will fill', async ({
  page,
}) => {
  await page.route('**/api/panels/vcs-activity', async (route) => {
    await new Promise((resume) => setTimeout(resume, 1_200));
    await route.continue();
  });
  /* The engine's own layout-shift ledger, started before the navigation so it
     is recording across the arrival rather than after it. Only Chromium
     implements the entry type; the box comparisons below are the measurement
     that runs everywhere, and this is the corroborating one where it exists.
     (Owner directive, 2026-08-24: keep the reservation MEASURED.) */
  await page.addInitScript(() => {
    window.__shifts = { supported: false, page: 0, calendar: 0 };
    const types = window.PerformanceObserver?.supportedEntryTypes ?? [];
    if (!types.includes('layout-shift')) return;
    window.__shifts.supported = true;
    new window.PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        window.__shifts.page += entry.value;
        /* Attributed, because the whole page is loading during this window
           and every other panel is arriving too. A ledger that summed the
           document would be a measurement of the page's load, and the claim
           under test is about ONE box. The engine names the nodes that
           moved; only a shift naming something inside the activity panel is
           this reserve's to answer for. */
        const card = window.document.querySelector('[data-activity-panel]');
        const ours = [...(entry.sources ?? [])].some(
          (source) => source.node && card !== null && card.contains(source.node)
        );
        if (ours) window.__shifts.calendar += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/');
  const measure = () =>
    page.evaluate(() => {
      const card = window.document.querySelector('[data-activity-panel]');
      const block = card === null ? null : card.querySelector('.grid-block');
      if (block === null) return null;
      const box = (node) => Math.round(node.getBoundingClientRect().height);
      /* Width joined height here the day a block started sizing itself to
         its column count. Before that the box was a year wide whatever it
         held, so only its height could move; now the reserve and the arrival
         have to agree about BOTH axes or the calendar re-lays out under the
         reader the moment its payload lands. */
      const across = (node) => Math.round(node.getBoundingClientRect().width);
      return {
        state: block.getAttribute('data-grid-state'),
        columns: Number(block.getAttribute('data-grid-columns')),
        datapoints: block.querySelectorAll('[data-grid-cell]').length,
        strip: box(block.querySelector('.grid-strip')),
        stripWidth: across(block.querySelector('.grid-strip')),
        block: box(block),
        blockWidth: across(block),
        card: box(card),
        cardWidth: across(card),
      };
    });
  const state = async () => (await measure())?.state;

  await expect
    .poll(state, { message: 'the calendar never rendered a waiting state to measure' })
    .toBe('empty');
  const waiting = await measure();
  await expect
    .poll(state, { message: 'the delayed activity payload never arrived' })
    .toBe('series');
  const arrived = await measure();

  /* The reserve carries no data, and the arrival does. Without both, the
     comparison below is two measurements of the same thing. */
  expect(waiting.datapoints, 'the waiting state rendered datapoints it was never given').toBe(0);
  expect(arrived.datapoints, 'the calendar arrived empty; this lane proves nothing').toBeGreaterThan(
    0
  );
  expect(
    arrived.strip,
    'the calendar arrived in a different strip from the one held for it'
  ).toBe(waiting.strip);
  expect(arrived.block, 'the grid block changed height when its data arrived').toBe(waiting.block);
  expect(arrived.card, 'the panel changed height when its data arrived').toBe(waiting.card);

  /* The inline axis, which a sized block is the reason to measure. The
     reserve claims a year of columns and the calendar that lands in it has a
     year of columns, so the width is identical — and it is identical because
     both numbers are pinned to each other (pendingWeeks in
     frontend/src/lib/grid.ts, TestVCSActivityPanelShipsARenderableGraph in
     internal/panels/registry_test.go), not because they happen to match
     today. */
  expect(
    arrived.columns,
    'the calendar arrived with a different column count from the reserve held for it'
  ).toBe(waiting.columns);
  expect(arrived.stripWidth, 'the strip changed width when its data arrived').toBe(
    waiting.stripWidth
  );
  expect(arrived.blockWidth, 'the grid block changed width when its data arrived').toBe(
    waiting.blockWidth
  );
  expect(arrived.cardWidth, 'the panel changed width when its data arrived').toBe(waiting.cardWidth);
  /* Non-vacuity for the pair above: a calendar that arrived one column wide
     would satisfy "the two agree" by shrinking the reserve to match. */
  expect(arrived.columns, 'the calendar no longer covers a year of columns').toBe(53);

  /* SPEED: the sizing must settle in one pass. A box computed from a custom
     property that is itself written by the component is exactly the shape that
     can oscillate — width changes, observer fires, width changes back — and an
     oscillation is invisible in a single measurement. So the box is sampled
     across ten consecutive frames AFTER the arrival and every sample must be
     the same number. */
  const frames = await page.evaluate(async () => {
    const block = window.document.querySelector('[data-activity-panel] .grid-block');
    const samples = [];
    for (let frame = 0; frame < 10; frame += 1) {
      await new Promise((paint) => window.requestAnimationFrame(paint));
      samples.push(Math.round(block.getBoundingClientRect().width * 100) / 100);
    }
    return samples;
  });
  expect(
    new Set(frames).size,
    `the calendar box settled on ${[...new Set(frames)].join(', ')} across ten frames`
  ).toBe(1);

  /* And the engine's own ledger, where it keeps one. The calendar's own
     reserve must answer for exactly nothing; the page figure rides alongside
     it as context, since the rest of the stack is still arriving in this
     window and is not this panel's to account for. */
  const shifts = await page.evaluate(() => window.__shifts);
  if (shifts.supported) {
    expect(
      shifts.calendar,
      `the reserved calendar accounted for ${shifts.calendar} of layout shift on arrival (page total across the load: ${shifts.page})`
    ).toBe(0);
  }
});

/* Outbound navigation for the recent-commits rows (issue 157), measured
 * against a real render rather than only against the pure functions in
 * tests/activity.test.mjs. The origin's own data is well behaved, which is
 * exactly why it cannot demonstrate the hostile half: the response is
 * intercepted and its rows replaced — one with a payload shape a raw
 * interpolation would have turned into a working (and in one case
 * executable) href, the other with a genuine reference. */
test('a hostile commit row renders as text and never becomes a live link', async ({ page }) => {
  const hostileRepo = 'evil.example" onmouseover="window.__activityEscaped = true';
  const unresolvedPR = 'release (#12e3)'; // not a clean trailing integer
  const hostileSha = '0000000000000000000000000000000000000001" onmouseover="window.__activityShaEscaped = true';
  await page.route('**/api/panels/vcs-activity', async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    envelope.data.recentCommits = [
      { repo: hostileRepo, sha: '', message: 'a merge (#1)', at: '2026-08-01T00:00:00Z' },
      { repo: 'naranjo.online', sha: '', message: unresolvedPR, at: '2026-08-01T00:00:00Z' },
      // Third row (issue 157 follow-up): a valid repo, no resolvable PR
      // reference, AND a hostile SHA shaped to break out of an href if it
      // were ever raw-interpolated. This is the SHA-fallback's own hostile
      // probe, mirroring the repo probe above rather than merely trusting
      // isValidCommitSha by inference.
      { repo: 'naranjo.online', sha: hostileSha, message: unresolvedPR, at: '2026-08-01T00:00:00Z' },
    ];
    await route.fulfill({ response, json: envelope });
  });
  await visit(page);

  const rendered = await page.evaluate(() => {
    const rows = [...window.document.querySelectorAll('.activity-entry')];
    const repoCell = rows[0]?.querySelector('.activity-entry-source');
    const messageCell = rows[1]?.querySelector('.activity-entry-title');
    const shaMessageCell = rows[2]?.querySelector('.activity-entry-title');
    return {
      repoTag: repoCell?.tagName ?? null,
      repoText: repoCell?.textContent ?? null,
      messageTag: messageCell?.tagName ?? null,
      messageText: messageCell?.textContent ?? null,
      shaMessageTag: shaMessageCell?.tagName ?? null,
      shaMessageText: shaMessageCell?.textContent ?? null,
      anchors: rows.flatMap((row) =>
        [...row.querySelectorAll('a')].map((a) => a.getAttribute('href'))
      ),
      escaped: window.__activityEscaped === true,
      shaEscaped: window.__activityShaEscaped === true,
    };
  });

  /* The hostile repo reached the DOM as literal text in a plain <span> —
     never an anchor, and the string it carries never executed. */
  expect(rendered.repoTag, 'the hostile repo row disappeared; this lane proves nothing').toBe('SPAN');
  expect(rendered.repoText).toContain(hostileRepo);
  expect(rendered.escaped, 'the hostile repo string executed').toBe(false);

  /* The second row's repo is genuine, so the guard is scoped per FIELD
     rather than blanking a whole row the moment anything about it looks
     wrong — its title still renders as plain text because "(#12e3)" is not
     a resolvable PR reference, and its SHA is the empty string (no
     fallback destination either). */
  expect(rendered.messageTag, 'the unresolved-PR title row disappeared').toBe('SPAN');
  expect(rendered.messageText).toContain(unresolvedPR);

  /* The third row's SHA fails isValidCommitSha (a real 40-hex prefix
     followed by an injection attempt is still not 40 hex digits), so the
     fallback refuses it exactly like the repo/PR guards refuse their own
     hostile shapes — plain text, never a link, never executed. */
  expect(rendered.shaMessageTag, 'the hostile-SHA title row disappeared').toBe('SPAN');
  expect(rendered.shaMessageText).toContain(unresolvedPR);
  expect(rendered.shaEscaped, 'the hostile SHA string executed').toBe(false);

  /* And no anchor ANYWHERE in any row carries a hostile payload — not
     merely "these cells are spans", but "nothing built a link out of this
     payload at all", which is what closes off a raw-interpolation
     regression landing somewhere this test did not think to look. */
  for (const href of rendered.anchors) {
    expect(href, `an anchor carries the hostile payload: ${href}`).not.toContain('evil.example');
    expect(href, `an anchor carries the hostile payload: ${href}`).not.toContain('onmouseover');
  }
});

test('an old-shape vcs-activity/v1 payload with no sha key on any row still renders real activity, not a blank panel (issue 157, Daybreak Blue round 3 finding 1)', async ({
  page,
}) => {
  /* The exact regression Daybreak Blue's review proved with a real
     intercepted payload: this chart runs a RollingUpdate across multiple
     replicas, vcs-activity/v1 is an unversioned-forever envelope, and this
     repository's OWN preceding release legitimately serves rows with no
     `sha` key in the JSON at all. A browser holding the new frontend can
     reach an OLD replica mid-rollout. Before this fix, ANY row missing the
     key failed admission, and one bad row rejected the WHOLE payload —
     turning a routine deploy into a blank "no activity data" panel for
     every visitor caught mid-rollout. This lane mutates the REAL served
     response to strip `sha` from every row (the mixed-version shape), the
     way an old replica actually would, and proves the panel still renders
     its real totals and real commit rows rather than the empty state. */
  await page.route('**/api/panels/vcs-activity', async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    // Simulate the OLD v1 shape precisely: delete the key, never set it to
    // '', because a real old replica's JSON encoder never wrote it at all.
    for (const commit of envelope.data.recentCommits) {
      delete commit.sha;
    }
    await route.fulfill({ response, json: envelope });
  });
  await visit(page);

  const totals = await page.locator('.activity-totals').innerText();
  expect(totals, 'the panel fell back to its empty state on an old-shape payload').not.toContain(
    'no activity data'
  );

  const rows = page.locator('.activity-entry');
  const rowCount = await rows.count();
  expect(rowCount, 'no commit rows rendered from an old-shape payload — this is the outage Daybreak Blue proved').toBeGreaterThan(0);

  /* Each row's repo cell is still real navigation — the sha's absence must
     degrade only that row's own sha-permalink capability, never the repo
     link, never the row itself, never the rest of the payload. */
  const repoLinks = await page.locator('.activity-entry-source').count();
  expect(repoLinks, 'every row lost its repo link too, not just its sha capability').toBeGreaterThan(0);
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
 * true case this probe still legitimately reports. */
async function engineTabsToPlainLinks(page) {
  await page.locator('.theme-menu .trigger').evaluate((node) => node.focus());
  await page.keyboard.press('Tab');
  return page.evaluate(() => window.document.activeElement.tagName === 'A');
}

test('a resolvable commit row is real, keyboard-reachable navigation', async ({ page }) => {
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

  const messageLink = page.locator('.activity-entry-title').first();
  await messageLink.scrollIntoViewIfNeeded();

  const attrs = await page.evaluate(() => {
    const row = window.document.querySelector('.activity-entry');
    const repo = row.querySelector('.activity-entry-source');
    const message = row.querySelector('.activity-entry-title');
    const read = (el) => ({
      tag: el.tagName,
      href: el.getAttribute('href'),
      target: el.getAttribute('target'),
      rel: el.getAttribute('rel'),
      label: el.getAttribute('aria-label'),
    });
    return { repo: read(repo), message: read(message) };
  });

  expect(attrs.repo.tag).toBe('A');
  expect(attrs.repo.href).toBe('https://github.com/snaraj/naranjo.online');
  expect(attrs.repo.target).toBe('_blank');
  expect(attrs.repo.rel).toBe('noopener noreferrer');
  expect(attrs.repo.label).toContain('opens in a new tab');

  /* /issues/152, never /pull/152, and "reference" rather than "pull
     request" in the accessible name: the subject's trailing "(#152)" proves
     only that this repository's squash-merge convention wrote a number
     there, never that GitHub confirms it names a pull request specifically
     (issue 157, Daybreak Blue's review, finding 1). GitHub's own issue/PR
     numbering answers the ambiguity for us — /issues/N redirects to /pull/N
     when N is a pull request — so the destination is still exactly right. */
  expect(attrs.message.tag).toBe('A');
  expect(attrs.message.href).toBe('https://github.com/snaraj/naranjo.online/issues/152');
  expect(attrs.message.target).toBe('_blank');
  expect(attrs.message.rel).toBe('noopener noreferrer');
  expect(attrs.message.label).toContain('opens in a new tab');
  expect(attrs.message.label).toContain('reference');
  expect(
    attrs.message.label,
    'the accessible name asserts a fact the payload never proved'
  ).not.toContain('pull request');

  const engineTabsLinks = await engineTabsToPlainLinks(page);

  /* This row's own natural tab-order boundary: .grid-strip is
     ContributionGrid's ONE focusable region (the calendar's individual
     cells carry no tabindex of their own), and it sits immediately before
     the commit list in both the DOM and the tab order — the same "focus a
     known preceding control, then real Tab" shape the nav test below uses,
     anchored on a control that is neither of the two links this test
     checks. Scoped to [data-activity-panel] because UsageTracker renders
     the identical ContributionGrid component for its own heatmap and would
     otherwise make '.grid-strip' ambiguous. */
  await page.locator('[data-activity-panel] .grid-strip').evaluate((node) => node.focus());
  await page.keyboard.press('Tab');
  const repoFocus = await page.evaluate(() => {
    const el = window.document.activeElement;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName,
      isRepoLink: el.classList.contains('activity-entry-source'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  test.skip(
    !engineTabsLinks,
    "this engine's default keyboard configuration does not include plain links in the tab order, measured independently against the page's own nav link (matches desktop Safari's own default) — nothing left to measure here"
  );
  /* From here the engine is INDEPENDENTLY proven capable of tabbing to
     plain links, so failing to reach the repo link is a real regression,
     never a platform quirk — this is exactly the assertion the `inert`
     mutant on the commit list must now fail. */
  expect(repoFocus.tag, 'a real Tab from the strip did not land on any anchor at all').toBe('A');
  expect(repoFocus.isRepoLink, 'a real Tab from the strip did not land on the repo link').toBe(true);
  expect(repoFocus.outlineStyle, 'the repo link has no visible keyboard focus ring').not.toBe('none');
  expect(
    parseFloat(repoFocus.outlineWidth),
    'the repo link focus ring has zero width'
  ).toBeGreaterThan(0);

  await page.keyboard.press('Tab');
  const messageFocus = await page.evaluate(() => {
    const el = window.document.activeElement;
    const style = getComputedStyle(el);
    return {
      isMessageLink: el.classList.contains('activity-entry-title'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  expect(messageFocus.isMessageLink, 'Tab from the repo link did not land on the title link').toBe(
    true
  );
  expect(messageFocus.outlineStyle, 'the title link has no visible keyboard focus ring').not.toBe(
    'none'
  );
  expect(
    parseFloat(messageFocus.outlineWidth),
    'the title link focus ring has zero width'
  ).toBeGreaterThan(0);

  /* ACTIVATION, not merely attributes (issue 157, Daybreak Blue's review,
     finding 3): a real Enter keypress on the now-focused title link must
     actually trigger the navigation its href promises — target="_blank"
     opens a new page, intercepted and fulfilled locally so this proof never
     makes a real outbound request to github.com. Matching markup with no
     working key handler would pass every assertion above and still leave a
     keyboard reader stranded; this is what rules that out. */
  let capturedReferer;
  await page.context().route('https://github.com/**', (route) => {
    capturedReferer = route.request().headers()['referer'];
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
  });
  const [popup] = await Promise.all([
    page.context().waitForEvent('page'),
    page.keyboard.press('Enter'),
  ]);
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  expect(popup.url(), 'Enter on the focused title link did not navigate to its own href').toBe(
    attrs.message.href
  );

  /* Popup isolation, BEHAVIOR not just markup (issue 157, Daybreak Blue's
     review, round 3, finding 6): rel="noopener noreferrer" is asserted
     above as an ATTRIBUTE — a click handler that flipped rel to plain
     "opener" immediately before the default activation would contradict it
     without failing a single assertion before this point, and Daybreak
     Blue proved exactly that survives every check that stops at the
     attribute string. These two checks close that gap on the REAL,
     browser-mediated activation: the opened page must carry no
     window.opener back to this one, and the request that opened it must
     have carried no Referer header — the two actual security properties
     noopener/noreferrer exist to guarantee. */
  const openerIsNull = await popup.evaluate(() => window.opener === null);
  expect(openerIsNull, 'the opened page can reach back to this one via window.opener').toBe(true);
  expect(capturedReferer, 'the activating request leaked a Referer header').toBeUndefined();

  await popup.close();
});

test('a valid-SHA commit row with no resolvable reference is real, keyboard-reachable navigation to its own commit permalink (issue 157, Daybreak Blue round 3 finding 5)', async ({
  page,
}) => {
  /* The positive browser-lane case Daybreak Blue's review found missing:
     every existing lane exercised either the hostile SHA path (rejected) or
     a row with sha: '' falling back to a resolvable "(#N)" reference. None
     exercised the {:else if shaHref} branch actually WINNING — the happy
     path for a commit with a real identity but no trailing reference number
     in its subject, which is exactly what an ordinary non-squash commit (or
     one from a repository with a different merge convention) looks like.
     Adding `inert` to only this one anchor branch survived every other
     lane; this test is what makes that mutant fail. */
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

  const messageLink = page.locator('.activity-entry-title').first();
  await messageLink.scrollIntoViewIfNeeded();

  const attrs = await page.evaluate(() => {
    const row = window.document.querySelector('.activity-entry');
    const message = row.querySelector('.activity-entry-title');
    return {
      tag: message.tagName,
      href: message.getAttribute('href'),
      target: message.getAttribute('target'),
      rel: message.getAttribute('rel'),
      label: message.getAttribute('aria-label'),
    };
  });

  expect(attrs.tag, 'the sha-fallback branch did not render as a link at all').toBe('A');
  expect(attrs.href).toBe(`https://github.com/snaraj/naranjo.online/commit/${validSha}`);
  expect(attrs.target).toBe('_blank');
  expect(attrs.rel).toBe('noopener noreferrer');
  expect(attrs.label).toContain('opens in a new tab');
  expect(attrs.label).toContain(`commit ${validSha.slice(0, 7)}`);

  const engineTabsLinks = await engineTabsToPlainLinks(page);

  await page.locator('[data-activity-panel] .grid-strip').evaluate((node) => node.focus());
  await page.keyboard.press('Tab'); // repo link
  await page.keyboard.press('Tab'); // message link (the sha-fallback anchor under test)
  const focus = await page.evaluate(() => {
    const el = window.document.activeElement;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName,
      isMessageLink: el.classList.contains('activity-entry-title'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  test.skip(
    !engineTabsLinks,
    "this engine's default keyboard configuration does not include plain links in the tab order, measured independently against the page's own nav link — nothing left to measure here"
  );
  /* This is exactly the assertion an `inert` mutant on ONLY the
     {:else if shaHref} anchor branch must now fail: every OTHER lane in
     this file exercises a different branch (the reference link, or the
     hostile/rejected paths), so a mutation scoped to just this branch left
     every one of them green. */
  expect(focus.tag, 'a real Tab sequence did not land on any anchor at all').toBe('A');
  expect(focus.isMessageLink, 'a real Tab sequence did not land on the sha-fallback link').toBe(true);
  expect(focus.outlineStyle, 'the sha-fallback link has no visible keyboard focus ring').not.toBe(
    'none'
  );
  expect(
    parseFloat(focus.outlineWidth),
    'the sha-fallback link focus ring has zero width'
  ).toBeGreaterThan(0);

  /* ACTIVATION, plus the same post-activation popup-isolation proof as the
     reference-link test above (finding 6): both anchor branches are
     independent <a> elements in the source, so a mutation scoped to only
     one of them needs its own activation+isolation proof. */
  let capturedReferer;
  await page.context().route('https://github.com/**', (route) => {
    capturedReferer = route.request().headers()['referer'];
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
  });
  const [popup] = await Promise.all([
    page.context().waitForEvent('page'),
    page.keyboard.press('Enter'),
  ]);
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  expect(popup.url(), 'Enter on the focused sha-fallback link did not navigate to its own href').toBe(
    attrs.href
  );
  const openerIsNull = await popup.evaluate(() => window.opener === null);
  expect(openerIsNull, 'the opened page can reach back to this one via window.opener').toBe(true);
  expect(capturedReferer, 'the activating request leaked a Referer header').toBeUndefined();
  await popup.close();
});

test('a valid SHA outranks an unverifiable trailing reference on the SAME row (issue 157, Daybreak Blue round 3 finding 3)', async ({
  page,
}) => {
  /* Daybreak Blue's own product probe, reproduced verbatim: a rendered row
     carrying BOTH a proven commit identity AND a syntactically-valid but
     nothing-proves-it-real trailing reference number. Before this fix, the
     reference always won — this exact row linked to /issues/9999999,
     outlinking a commit this document could actually vouch for. */
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

  const attrs = await page.evaluate(() => {
    const message = window.document.querySelector('.activity-entry-title');
    return { tag: message.tagName, href: message.getAttribute('href') };
  });

  expect(attrs.tag).toBe('A');
  expect(
    attrs.href,
    'the row linked to the unverifiable /issues/9999999 reference instead of its own proven commit'
  ).toBe(`https://github.com/snaraj/naranjo.online/commit/${validSha}`);
  expect(attrs.href).not.toContain('/issues/9999999');
});

/* The commit log's rhythm (owner directive, 2026-08-25: "awkward large
 * vertical gaps between rows, almost like there should be something there").
 *
 * The pitch itself is the 44px touch floor and cannot close — the lane
 * directly below measures exactly that, on the links inside these rows — so
 * what was normalized is the reading: the row is set at the panel's own type
 * step rather than a step under it, and the pitch is closed by the page's
 * border token, which is what turns 44px of space into a list instead of dead
 * air. Both facts are measured here, along with the property that made the
 * separator safe: rows stay flush and the reservation still holds exactly five
 * of them, so nothing was traded for the line. */
test('the commit log reads as ruled rows at the touch pitch, not text in dead air', async ({
  page,
}) => {
  await visit(page);
  const observed = await page.evaluate(() => {
    const list = window.document.querySelector('.activity-entries');
    const rows = [...list.querySelectorAll('.activity-entry')];
    return {
      listHeight: list.getBoundingClientRect().height,
      fontPx: parseFloat(getComputedStyle(list).fontSize),
      rows: rows.map((row) => ({
        top: row.getBoundingClientRect().top,
        height: row.getBoundingClientRect().height,
        rule: getComputedStyle(row).boxShadow,
        border: getComputedStyle(row).borderBlockEndWidth,
      })),
    };
  });
  expect(observed.rows.length, 'the commit log rendered no rows to measure').toBeGreaterThan(1);
  /* The type step: 12px text in a 44px row is what read as dead air. */
  expect(observed.fontPx, `the commit rows are set at ${observed.fontPx}px`).toBeGreaterThanOrEqual(13);
  for (const [index, row] of observed.rows.entries()) {
    expect(row.height, `commit row ${index} is ${row.height}px tall`).toBeGreaterThanOrEqual(
      touchFloorPx - subPixel
    );
    /* Flush: the pitch IS the row, so no gap was added on top of the floor. */
    if (index > 0) {
      const previous = observed.rows[index - 1];
      expect(
        row.top,
        `commit row ${index} starts ${row.top - (previous.top + previous.height)}px after the row above it`
      ).toBeCloseTo(previous.top + previous.height, 0);
    }
    /* Drawn as a shadow, never a border: a border would add its pixel to
       every row and push the fifth out of a five-row reservation. */
    expect(
      parseFloat(row.border),
      `commit row ${index} draws its rule as a border, which grows the row box`
    ).toBe(0);
    const last = index === observed.rows.length - 1;
    if (last) {
      expect(row.rule, 'the final row draws a rule, so the list reads as missing its next row').toBe(
        'none'
      );
    } else {
      expect(row.rule, `commit row ${index} draws no rule, so the pitch reads as dead air`).not.toBe(
        'none'
      );
    }
  }
  /* And the reservation is still exactly the five rows the adapter caps at,
     unchanged by the rule the rows now carry. */
  expect(observed.listHeight, 'the five-row reservation changed size').toBeCloseTo(
    5 * touchFloorPx,
    0
  );
});

test('the shortest admitted repo slug still clears the touch floor on both axes (issue 157)', async ({
  page,
}) => {
  /* Daybreak Blue's review of PR #161 measured this exact probe: a
     one-character repo slug — "a" is admitted by isValidRepoSlug, the
     shortest string the pattern accepts — rendered a 6.625px-wide anchor
     even though the row already cleared the 44px touch floor on its BLOCK
     axis. max-inline-size alone bounds the upper end of
     .activity-entry-source; nothing bounded the lower end until
     min-inline-size was added (ActivityTracker.svelte), so a column sized
     purely to this content's own width. */
  await page.route('**/api/panels/vcs-activity', async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    envelope.data.recentCommits = [
      { repo: 'a', sha: '', message: 'fix: shortest admitted slug (#1)', at: '2026-08-24T00:00:00Z' },
    ];
    await route.fulfill({ response, json: envelope });
  });
  await visit(page);

  const repoLink = page.locator('.activity-entry-source').first();
  await repoLink.scrollIntoViewIfNeeded();
  const box = await repoLink.boundingBox();
  expect(box, 'the shortest admitted repo slug rendered no box at all').not.toBeNull();
  expect(
    box.width,
    `the repo link is ${box.width.toFixed(2)}px wide, under the ${touchFloorPx}px touch floor`
  ).toBeGreaterThanOrEqual(touchFloorPx - subPixel);
  expect(
    box.height,
    `the repo link is ${box.height.toFixed(2)}px tall, under the ${touchFloorPx}px touch floor`
  ).toBeGreaterThanOrEqual(touchFloorPx - subPixel);
});

test('the popover animates only where motion is welcome', async ({ page }) => {
  await visit(page);
  await openReadingModes(page);
  const animation = () =>
    page.locator('#reading-mode-menu').evaluate((node) => getComputedStyle(node).animationName);
  /* Both directions on ONE page, because either half alone proves nothing: a
     stylesheet with no animation at all satisfies the reduce assertion, and a
     preference that never reaches the page satisfies the other.
     page.emulateMedia is deliberate — a describe-level
     `test.use({ reducedMotion: 'reduce' })` was MEASURED not reaching the page
     in this Playwright version (the document still reported no-preference),
     so the preference is set here, where its effect is observable. */
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(
    await animation(),
    'nothing animates even with motion allowed; the reduce assertion below would then prove nothing'
  ).not.toBe('none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await animation(), 'the popover animates for a reader who asked for less motion').toBe(
    'none'
  );
});

/* ===========================================================================
 * The stacked page (issue 134)
 *
 * The nav and the gallery are two surfaces whose correctness is a property
 * of the RENDERED page rather than of the source: a link that names a
 * section nobody rendered still looks perfect in the markup, and a single
 * visible photograph plus a click-to-enlarge dialog (issue 176) are exactly
 * the kind of interactive behavior no source pin can prove.
 * ======================================================================== */

test('every section the nav names is on the page, and its link reaches it', async ({ page }) => {
  await visit(page);
  const links = page.locator('.section-link');
  const count = await links.count();
  expect(count, 'the page renders no section links at all').toBeGreaterThan(2);
  for (let index = 0; index < count; index += 1) {
    const link = links.nth(index);
    const href = await link.getAttribute('href');
    expect(href, 'a nav link points nowhere').toMatch(/^#[a-z-]+$/);
    /* The section exists. This is the assertion a source pin cannot make on
       the assembled page: the nav is one component and the sections are
       three others, and only the rendered document knows they agree. */
    await expect(page.locator(href), `${href} names no section on this page`).toHaveCount(1);
    await link.click();
    const landed = await page.locator(href).evaluate((node) => ({
      top: node.getBoundingClientRect().top,
      viewport: window.innerHeight,
    }));
    /* And the jump lands: the section is in view rather than somewhere far
       below the fold. The last section cannot always reach the very top of
       the window — there is nothing under it to scroll — so the assertion is
       that it is visible, not that it is flush. */
    expect(
      landed.top,
      `${href} did not bring its section into view (${Math.round(landed.top)}px from the top)`
    ).toBeLessThan(landed.viewport);
    expect(landed.top).toBeGreaterThanOrEqual(-1);
  }
});

test('the nav link is quiet at rest and marks itself the moment intent shows (issue 157)', async ({
  page,
}) => {
  await visit(page);
  const link = page.locator('.section-link').first();
  await link.scrollIntoViewIfNeeded();

  const idle = await link.evaluate((node) => getComputedStyle(node).textDecorationLine);
  expect(idle, 'the nav link carries an idle underline; the owner asked for it gone').toBe('none');

  await link.hover();
  const hovered = await link.evaluate((node) => getComputedStyle(node).textDecorationLine);
  expect(hovered, 'hover must mark the link somehow now that idle carries no mark').toBe('underline');

  /* Independent capability probe, corrected after Daybreak Blue's review of
     PR #161 found the same self-derived-skip defect here as in the
     commit-row test above: the earlier version's WebKit skip came from the
     very Tab press it used to check the nav link's OWN reachability, so a
     regression that broke just the nav link's tabbability would look
     identical to a genuine engine limitation. The nav link cannot probe
     itself, so this walks PAST every nav link instead — Work carries zero
     focusable elements of its own and Coding Projects now sits directly
     after it (issue 176 moved Art, whose prev/next/enlarge controls ARE
     focusable, after Coding Projects instead) between the nav and the
     feed (a fact this exploits rather than assumes: if that ever stops
     being true, this walk lands somewhere unexpected and the assertion
     below fails loudly rather than skipping quietly) — to the feed's first
     entry link: a plain anchor with nothing to do with the nav. */
  const navCount = await page.locator('.section-link').count();
  await page.locator('.theme-menu .trigger').evaluate((node) => node.focus());
  for (let step = 0; step < navCount + 1; step += 1) {
    await page.keyboard.press('Tab');
  }
  const probe = await page.evaluate(() => {
    const el = window.document.activeElement;
    return { tag: el.tagName, isEntryLink: el.classList.contains('entry-link') };
  });
  const engineTabsLinks = probe.tag === 'A' && probe.isEntryLink;

  /* Keyboard focus keeps the site's own ring — a real Tab from a throwaway
     starting point, the same pattern this file uses everywhere else it
     proves :focus-visible rather than merely programmatic focus. The reading
     mode's own trigger is the last control the page header holds (it is
     deliberately LAST, PageHeader.svelte says why), so one real Tab from it
     is the cheapest way to reach the first nav link without walking every
     stop from the top of the document. */
  await page.locator('.theme-menu .trigger').evaluate((node) => node.focus());
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => {
    const el = window.document.activeElement;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName,
      isSectionLink: el.classList.contains('section-link'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  test.skip(
    !engineTabsLinks,
    "this engine's default keyboard configuration does not include plain links in the tab order, measured independently against the Coding Projects feed's own first link (matches desktop Safari's own default) — nothing left to measure here"
  );
  /* From here the engine is INDEPENDENTLY proven capable of tabbing to
     plain links, so failing to reach the nav link is a real regression,
     never a platform quirk. */
  expect(
    focused.isSectionLink,
    'Tab from the reading-mode trigger did not land on the first nav link'
  ).toBe(true);
  expect(focused.outlineStyle, 'the nav link lost its focus ring').not.toBe('none');
  expect(parseFloat(focused.outlineWidth), 'the nav link focus ring has zero width').toBeGreaterThan(0);

  /* ACTIVATION, not merely attributes: a real Enter keypress on the focused
     nav link must actually bring its target section into view — this is an
     in-page anchor, so activation is a scroll rather than a navigation
     event, and matching markup with no working key handler would pass
     every assertion above while leaving a keyboard reader stranded. */
  const targetId = await page.evaluate(() => window.document.activeElement.getAttribute('href'));
  await page.keyboard.press('Enter');
  await expect(page.locator(targetId)).toBeInViewport();
});

/* The section that used to be "Work" (owner directive, 2026-08-25): the real
 * history replaced two lorem-ipsum records, so what this measures is that the
 * page renders four complete roles under the new heading AND that neither the
 * filler nor the disclaimer it needed survived anywhere in the rendered
 * document. The nav label moves with the section because both are read off the
 * one manifest entry, which is what this reads back off the page. */
test('the experience section renders four complete roles, and no placeholder survives', async ({
  page,
}) => {
  await visit(page);
  const observed = await page.evaluate(() => {
    const section = window.document.querySelector('#work');
    return {
      heading: section.querySelector('.section-title')?.textContent.trim(),
      firstNavLabel: window.document.querySelector('.section-link')?.textContent.trim(),
      /* The id is the address a reader may already have shared; renaming a
         label must not move it. */
      linkedFromNav: window.document.querySelector('.section-link')?.getAttribute('href'),
      placeholders: section.querySelectorAll('[data-placeholder]').length,
      notes: section.querySelectorAll('.section-note').length,
      text: section.textContent.toLowerCase(),
      entries: [...section.querySelectorAll('.entry-log > li')].map((entry) => ({
        title: entry.querySelector('.feed-card-title')?.textContent.trim() ?? '',
        byline: entry.querySelector('.feed-card-byline')?.textContent.trim() ?? '',
        points: entry.querySelectorAll('.entry-points > li').length,
      })),
    };
  });
  expect(observed.heading).toBe('Professional Experience');
  expect(observed.firstNavLabel, 'the nav still names the section by its old label').toBe(
    'Professional Experience'
  );
  expect(observed.linkedFromNav, 'the section id moved with the label').toBe('#work');
  expect(observed.entries, 'the section renders the wrong number of roles').toHaveLength(4);
  for (const entry of observed.entries) {
    expect(entry.title, 'a role card renders no employer').not.toBe('');
    /* The byline carries the three facts the owner supplied beside the
       employer; the composition itself is executed in tests/sections.test.mjs,
       and this is the half that proves it reached the page. */
    expect(entry.byline, `"${entry.title}" renders no role, span or place`).toMatch(/·.*·/);
    expect(entry.points, `"${entry.title}" renders no accomplishments`).toBeGreaterThan(0);
  }
  expect(observed.placeholders, 'a real role is still marked placeholder in the DOM').toBe(0);
  expect(observed.notes, 'the placeholder disclaimer is still printed over real roles').toBe(0);
  expect(observed.text, 'the filler copy is still on the page').not.toContain('lorem');
});

/* The trackers stack, in the order the owner asked for on 2026-08-25: the
 * token tracker opens the section and the game tracker closes it, with the
 * version-control tracker unmoved between them. Read off the rendered stack
 * rather than off the manifest — tests/sections.test.mjs pins the manifest,
 * and this is the half that proves the page renders it in that order. */
test('the trackers stack renders token usage first and the game tracker last', async ({ page }) => {
  await visit(page);
  const order = await page.evaluate(() =>
    [...window.document.querySelectorAll('#trackers .panel-stack > *')].map((slot) => {
      /* The stack's child IS the panel's own root element for two of the
         three, so a descendant-only lookup would miss exactly the two that
         moved. */
      const carries = (selector) => slot.matches(selector) || slot.querySelector(selector) !== null;
      if (carries('[data-panel-id="token-usage"]')) return 'token-usage';
      if (carries('[data-activity-panel]')) return 'vcs-activity';
      if (carries('.stat-grid')) return 'stats';
      return 'unknown';
    })
  );
  expect(order, 'the trackers no longer stack in the order the owner asked for').toEqual([
    'token-usage',
    'vcs-activity',
    'stats',
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
  const idle = await links.evaluateAll((nodes) =>
    nodes.map((node) => ({
      classes: node.className,
      line: getComputedStyle(node).textDecorationLine,
    }))
  );
  for (const link of idle) {
    expect(link.line, `"${link.classes}" carries a resting underline`).toBe('none');
  }
  test.skip(Boolean(isMobile), 'a touch device has no hover state to measure');
  /* The repo card title is the exact element the owner reported, so it is the
     one this hovers: its mark moves onto the name inside the anchor, which is
     where the ink change lives too. */
  const name = page.locator('.entry-link .entry-name').first();
  await name.scrollIntoViewIfNeeded();
  await name.hover();
  const hovered = await name.evaluate((node) => getComputedStyle(node).textDecorationLine);
  expect(hovered, 'hover leaves the card title unmarked, so nothing announces it as a link').toBe(
    'underline'
  );
});

test('the gallery shows exactly one loaded photograph, never eight stacked (issue 176)', async ({ page }) => {
  await visit(page);
  // Vendored WebP, not a media-route fetch: the picture actually decodes,
  // which the old remote-media "pending frame" case could never measure. It
  // is also `loading="lazy"` (issue 176), and engines differ on how far
  // ahead of the viewport a lazy image is fetched — Firefox measurably later
  // than Chromium/WebKit here — so this polls for decode rather than
  // asserting it the instant the page settles.
  const image = page.locator('img.gallery-image');
  await image.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => image.evaluate((img) => img.complete && img.naturalWidth > 0), {
      message: 'the vendored preview never finished decoding',
      timeout: 10_000,
    })
    .toBe(true);
  const observed = await page.evaluate(() => {
    const frames = [...window.document.querySelectorAll('.gallery-image-button')];
    const images = [...window.document.querySelectorAll('img.gallery-image')];
    const counter = window.document.querySelector('.gallery-count');
    const counterStyle = counter === null ? null : getComputedStyle(counter);
    const counterBox = counter === null ? null : counter.getBoundingClientRect();
    /* The track the stage centres itself in, measured rather than read off a
       token, because it is the thing the stage's own cap has to be compared
       AGAINST. Since issue 241 the track IS the frame: the arrows moved out of
       this row and into the control row under the work, so the whole of it
       belongs to the stage. */
    const row = window.document.querySelector('.gallery-frame');
    const track = row.getBoundingClientRect().width;
    return {
      arrowsInFrame: row.querySelectorAll(':scope > .icon-button').length,
      frameCount: frames.length,
      imageCount: images.length,
      track,
      count: counter?.textContent?.trim(),
      /* The counter is still in the tree and still says where the reader is —
         it is the dots' aria-live voice — but it is CLIPPED out of view
         (owner directive, 2026-08-28: "I only like the dots"). */
      counterWidth: counterBox === null ? null : counterBox.width,
      counterClip: counterStyle === null ? null : counterStyle.clipPath,
      /* The visible position mark, which is now the dots alone. */
      dots: [...window.document.querySelectorAll('.gallery-dot')].map((dot) => {
        const box = dot.getBoundingClientRect();
        return {
          checked: dot.getAttribute('aria-checked') === 'true',
          painted: box.width > 0 && box.height > 0,
        };
      }),
      fit: images.map((image) => getComputedStyle(image).objectFit),
      sizes: frames.map((frame) => {
        const box = frame.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }),
    };
  });
  expect(observed.frameCount, 'the gallery must render exactly one visible frame, never eight').toBe(1);
  expect(observed.imageCount, 'exactly one <img> may be mounted in the feed frame').toBe(1);
  expect(
    observed.arrowsInFrame,
    'an arrow is back inside the frame, taking inline size from the work it points at'
  ).toBe(0);
  /* The number survives as the live region — an assistive reader can be told
     "2 / 8", and cannot usefully be told that the second of eight identical
     dots lit up — but it is clipped rather than painted, so the visible
     position mark is the dots and nothing else. */
  expect(observed.count).toBe('Photograph 1 of 8');
  expect(
    observed.counterWidth,
    `the counter paints ${observed.counterWidth}px of visible text beside the dots`
  ).toBeLessThanOrEqual(1 + subPixel);
  expect(observed.counterClip, 'the counter is not clipped, only shrunk').toContain('inset');
  expect(observed.dots.length, 'the dots must offer one position per photograph').toBe(8);
  expect(observed.dots.filter((dot) => dot.checked).length, 'no single dot is marked current').toBe(1);
  for (const dot of observed.dots) {
    expect(dot.painted, 'a position dot paints no box at all').toBe(true);
  }
  /* The box is reserved before the byte arrives, and since 2026-08-28 it is a
     SQUARE stage rather than the feed's 16:9 media box: the owner's drawings
     are portrait scans, so a wide frame cropped them ("the art is cut off
     significantly") or surrounded them with dead space. The stage takes the
     SMALLER of its 1fr track and its own 28rem token, and the picture is
     `contain` inside it — whole, never cropped — which is why a single 4K
     photograph still costs the page no layout shift. */
  const [box] = observed.sizes;
  expect(box.height, 'the gallery frame reserves no height').toBeGreaterThan(0);
  expect(observed.fit, 'the photograph is cropped to fill its stage instead of shown whole').toEqual([
    'contain',
  ]);
  expect(
    box.height,
    `the gallery stage is ${box.width.toFixed(1)}x${box.height.toFixed(1)}, not the square the owner asked for`
  ).toBeCloseTo(box.width, 0);
  const expectedWidth = Math.min(observed.track, galleryStageCapPx);
  expect(
    box.width,
    `the gallery stage is ${box.width.toFixed(1)}px inside a ${observed.track.toFixed(1)}px track, not the expected ${expectedWidth.toFixed(1)}px`
  ).toBeCloseTo(expectedWidth, 0);
  /* The cap must be doing real work somewhere, not coincidentally matching
     the track — but this test runs across every project, including the phone
     emulations, whose own viewport genuinely renders a track under 300px wide
     (MEASURED: 242px on an iPhone 13), where the cap is correctly inert.
     Gating on the track's own MEASURED width — a layout fact independent of
     whatever the size token currently says — rather than on the project name
     (this file's own capability-over-project-name doctrine) restricts the
     strict-inequality proof to viewports wide enough to exercise it, without
     ever weakening what it proves there: on a desktop-width track this still
     fails exactly as hard against the 28rem -> 280rem mutant, which would let
     the stage grow to the full track. */
  if (observed.track > galleryStageCapPx) {
    expect(
      box.width,
      `the stage filled its whole ${observed.track.toFixed(1)}px track; the size cap did not engage`
    ).toBeLessThan(observed.track);
  }
});

test('prev/next cycle the visible photograph without leaving the page', async ({ page }) => {
  await visit(page);
  const image = page.locator('img.gallery-image');
  const before = await image.getAttribute('src');
  await page.getByRole('button', { name: 'Next photograph' }).click();
  await expect(page.locator('.gallery-count')).toHaveText('Photograph 2 of 8');
  const after = await image.getAttribute('src');
  expect(after, 'next must actually change which photograph is visible').not.toBe(before);
  await page.getByRole('button', { name: 'Previous photograph' }).click();
  await expect(page.locator('.gallery-count')).toHaveText('Photograph 1 of 8');
  const backToStart = await image.getAttribute('src');
  expect(backToStart).toBe(before);
});

test('clicking the photograph opens a real modal dialog with a larger, unframed image; Escape closes it', async ({
  page,
}) => {
  await visit(page);
  const dialog = page.locator('dialog.gallery-lightbox');
  await expect(dialog).not.toBeVisible();
  /* The strip's picture has to have decoded before the comparison below, which
     reads its intrinsic ratio to work out how much of its square stage the
     photograph actually paints. */
  const strip = page.locator('img.gallery-image');
  await strip.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => strip.evaluate((img) => img.complete && img.naturalWidth > 0), {
      message: 'the vendored preview never finished decoding',
      timeout: 10_000,
    })
    .toBe(true);
  await page.locator('.gallery-image-button').click();
  await expect(dialog).toBeVisible();
  // A native <dialog> shown with showModal() reports itself open, and its
  // ::backdrop is what makes the rest of the page inert to a pointer.
  const modal = await dialog.evaluate((node) => node.matches(':modal'));
  expect(modal, 'the dialog did not open as a real top-layer modal').toBe(true);
  const enlarged = page.locator('img.gallery-lightbox-image');
  await expect(enlarged).toBeVisible();
  const [previewBox, enlargedBox, frame] = await Promise.all([
    /* The PAINTED picture in the strip, not the box around it (issue 241).
       The stage is a square and the photograph is `contain` inside it, so the
       element's box has always been larger than the picture it shows — and
       since the stage took back the width the arrows used to occupy, that
       difference is big enough on a phone to make a box-to-box comparison
       claim the enlargement shrank the photograph. What "larger" means here
       is the pixels a reader can see, so the contain fit is computed from the
       element's own intrinsic ratio. */
    page.evaluate(() => {
      const image = window.document.querySelector('img.gallery-image');
      const box = image.getBoundingClientRect();
      const ratio = image.naturalWidth / image.naturalHeight;
      const painted = box.width / box.height > ratio
        ? { width: box.height * ratio, height: box.height }
        : { width: box.width, height: box.width / ratio };
      return painted;
    }),
    enlarged.boundingBox(),
    page.evaluate(() => {
      const wrapper = window.document.querySelector('.gallery-lightbox-border');
      const style = getComputedStyle(wrapper);
      const wrapperBox = wrapper.getBoundingClientRect();
      const imageBox = wrapper.querySelector('.gallery-lightbox-image').getBoundingClientRect();
      return {
        borderWidth: Number.parseFloat(style.borderTopWidth),
        background: style.backgroundColor,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(
          Number.parseFloat
        ),
        band: {
          width: wrapperBox.width - imageBox.width,
          height: wrapperBox.height - imageBox.height,
        },
      };
    }),
  ]);
  // "Larger" is measured, not assumed: the enlarged image's rendered area
  // must exceed the feed frame's, on every viewport this lane runs.
  expect(
    enlargedBox.width * enlargedBox.height,
    'the enlarged photograph is not measurably larger than the feed frame'
  ).toBeGreaterThan(previewBox.width * previewBox.height);
  /* And it is UNFRAMED (owner directive, 2026-08-28: "get rid of those ugly
     outlines"). Issue 176's v1 painted a "static, simple, almost
     non-existent" border here and this lane pinned that it was real; the
     three --gallery-frame-* tokens that decide it are now width 0, colour
     transparent and padding 0, so what the enlarged work wears against the
     scrim is nothing at all.
     The wrapper survives — it is still the one place a future patterned
     border would be a token edit — so the pin is that it ADDS nothing: no
     line, no fill, and not one pixel of band around the picture. Each of the
     three tokens fails this on its own if it comes back. */
  expect(frame.borderWidth, 'the enlarged photograph wears a border again').toBe(0);
  expect(frame.background, 'the frame wrapper paints a mat behind the photograph').toMatch(
    /rgba\(0, 0, 0, 0\)|transparent/
  );
  expect(frame.padding, 'the frame wrapper reserves a band around the photograph').toEqual([0, 0, 0, 0]);
  /* Half a CSS pixel of allowance rather than this file's usual hundredth,
     because this is a difference between two boxes on a scaled device: the
     Pixel 5 lane snaps layout to its 2.75x grid and reported a 0.03125px band
     around an image that has no padding at all. Half a pixel cannot hide a
     frame — the smallest band any of these tokens can produce is a quarter-rem
     of padding on both sides, which is 8px. */
  const bandGrainPx = 0.5;
  expect(
    Math.max(frame.band.width, frame.band.height),
    `the frame wrapper is ${frame.band.width}x${frame.band.height} larger than the photograph inside it`
  ).toBeLessThanOrEqual(bandGrainPx);

  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  /* And focus comes back to the frame it was invoked from (issue 202). The
     native dialog's own restoration cannot be relied on here: a mouse click
     does not focus a <button> on macOS WebKit, so on the engine every iOS
     browser runs the "previously focused element" is the body — this
     assertion is exactly what fails if the component stops restoring it
     explicitly. */
  const focused = await page.evaluate(() =>
    window.document.activeElement?.classList.contains('gallery-image-button')
  );
  expect(focused, 'Escape left focus somewhere other than the frame that opened the lightbox').toBe(true);
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
 * It drives the STILL's stage deliberately: the lightbox is images-only since
 * this same PR made films play in the strip, so the surface this lane is
 * about is the one a still still opens.
 * ======================================================================== */
test('opening and closing the enlarged media leaves the reader exactly where they were (issue 233)', async ({
  page,
}) => {
  await visit(page);
  const dialog = page.locator('dialog.gallery-lightbox');
  const frame = page.locator('.gallery-image-button').first();
  await frame.scrollIntoViewIfNeeded();
  await settled(page);

  const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
  const start = await scrollY();
  /* Vacuity guard: a page sitting at its own top cannot prove it kept its
     place, and this lane would pass by measuring nothing. */
  expect(
    start,
    'the gallery is inside the first viewport here, so this lane proves nothing'
  ).toBeGreaterThan(150);

  for (const close of ['escape', 'the close control', 'a backdrop click']) {
    await frame.click();
    await expect(dialog).toHaveJSProperty('open', true);
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
    const focused = await page.evaluate(
      () => window.document.activeElement?.className ?? 'none'
    );
    expect(focused, `closing by ${close} left focus on "${focused}"`).toContain(
      'gallery-image-button'
    );
  }
});

/* THE FILM PLAYS WHERE IT SITS (issue 233, owner directive 2026-08-28:
 * "remove the play icon from all videos, its just there doing nothing.
 * Instead develop the ability to treat them like youtube videos where I can
 * just play it in this small minimal version, which should be enlarged").
 *
 * Every half of that sentence is a measurement here, in a real engine, on a
 * real gallery whose items came down a manifest exactly as the operator's own
 * would: the mark is gone, the player is real and inline, it has not started
 * itself, its stage is the wider and larger of the two shapes, and the still
 * beside it is untouched.
 *
 * Both items ride one navigation so the two stages are compared as two states
 * of ONE page rather than against numbers this file states — the same
 * discipline the reservation lane below uses. */
test('a film plays inline on an enlarged widescreen stage, and the play mark is gone (issue 233)', async ({
  page,
}) => {
  await serveGalleryManifest(page);
  await visit(page);

  const stage = page.locator('.gallery-stage');
  await stage.scrollIntoViewIfNeeded();

  // The manifest replaced the vendored set wholesale, so the strip opens on
  // its first item — the still — and the counter says how many there are.
  await expect(page.locator('.gallery-count')).toHaveText('Photograph 1 of 2');
  const still = await page.evaluate(() => {
    const node = window.document.querySelector('.gallery-stage');
    const box = node.getBoundingClientRect();
    return {
      kind: node.getAttribute('data-gallery-kind'),
      width: box.width,
      height: box.height,
      buttons: window.document.querySelectorAll('.gallery-image-button').length,
      videos: window.document.querySelectorAll('video').length,
      marks: window.document.querySelectorAll('.gallery-play-mark').length,
    };
  });
  expect(still.kind, 'a still’s stage does not declare its own kind').toBe('image');
  expect(still.buttons, 'a still lost the enlarge button it has always had').toBe(1);
  expect(still.videos, 'a still’s stage mounts a player').toBe(0);
  expect(
    still.height,
    `the still’s stage is ${still.width.toFixed(1)}x${still.height.toFixed(1)}, not the square it keeps`
  ).toBeCloseTo(still.width, 0);

  /* The arrow names the item it will REACH (issue 241), so the control that
     moves onto a film says so — which is also this lane's proof that the
     kind-aware naming reaches a real engine rather than only the source. */
  await page.getByRole('button', { name: 'Next film' }).click();
  await expect(page.locator('.gallery-count')).toHaveText('Film 2 of 2');

  const film = await page.evaluate(() => {
    const node = window.document.querySelector('.gallery-stage');
    const box = node.getBoundingClientRect();
    const video = window.document.querySelector('video');
    const player = video === null ? null : video.getBoundingClientRect();
    const arrow = window.document.querySelector('.gallery-controls > .icon-button');
    const arrowGlyph = arrow.querySelector('svg').getBoundingClientRect();
    const arrowBox = arrow.getBoundingClientRect();
    const dot = window.document.querySelector('.gallery-dot[aria-checked="true"]');
    const dotMark = dot.querySelector('.gallery-dot-mark').getBoundingClientRect();
    const dotBox = dot.getBoundingClientRect();
    return {
      kind: node.getAttribute('data-gallery-kind'),
      width: box.width,
      height: box.height,
      videos: window.document.querySelectorAll('video').length,
      marks: window.document.querySelectorAll('.gallery-play-mark').length,
      buttons: window.document.querySelectorAll('.gallery-image-button').length,
      dialogVideos: window.document.querySelectorAll('dialog video').length,
      player:
        video === null
          ? null
          : {
              tag: video.tagName,
              controls: video.controls,
              autoplay: video.autoplay,
              /* The ATTRIBUTE, not the IDL mirror. Gecko implements the
                 attribute's behaviour but exposes no `playsInline` property,
                 so reading the property here reported `undefined` on Firefox
                 (MEASURED) — and the stage-1 floor is about the declaration
                 anyway, which is what every engine agrees on. */
              playsinline: video.hasAttribute('playsinline'),
              preload: video.preload,
              paused: video.paused,
              currentTime: video.currentTime,
              poster: video.getAttribute('poster'),
              inStage: node.contains(video),
              sources: [...video.querySelectorAll('source')].map((source) => ({
                src: source.getAttribute('src'),
                type: source.getAttribute('type'),
                media: source.getAttribute('media'),
                /* What the ENGINE makes of that query at this viewport, which
                   is the only thing that decides whether the rung is a
                   candidate at all. */
                eligible: source.media === '' || window.matchMedia(source.media).matches,
              })),
              width: player.width,
              height: player.height,
            },
      arrow: { glyph: arrowGlyph.width, hit: { width: arrowBox.width, height: arrowBox.height } },
      dot: { mark: dotMark.width, hit: { width: dotBox.width, height: dotBox.height } },
    };
  });

  /* THE MARK IS GONE, on the item it used to be drawn on. */
  expect(film.marks, 'the decorative play mark is painted on a film again').toBe(0);

  /* THE PLAYER IS REAL, INLINE, AND IN THE STRIP — not in a dialog, and not
     one of eight: exactly one <video> exists on the whole page, and it is
     inside the current item's own stage. */
  expect(film.kind, 'a film’s stage does not declare its own kind').toBe('video');
  expect(film.videos, 'the strip mounts a number of players other than exactly one').toBe(1);
  expect(film.dialogVideos, 'the lightbox mounts a player again').toBe(0);
  expect(film.buttons, 'a film’s stage still carries the enlarge button that would eat its presses').toBe(0);
  expect(film.player.tag).toBe('VIDEO');
  expect(film.player.inStage, 'the player is not inside the stage it is supposed to fill').toBe(true);
  expect(film.player.controls, 'the player offers the reader no controls').toBe(true);
  expect(film.player.playsinline, 'the player would go fullscreen on a phone instead of playing in place').toBe(true);
  expect(film.player.preload).toBe('metadata');

  /* NOTHING EVER AUTOPLAYS, measured rather than read off the source: the
     element declares no autoplay AND has not started itself. */
  expect(film.player.autoplay, 'the player declares autoplay').toBe(false);
  expect(film.player.paused, 'the player started without the reader pressing anything').toBe(true);
  expect(film.player.currentTime, 'the player advanced without being asked').toBe(0);

  /* THE LADDER IS THE MANIFEST'S OWN, in its own order, with the poster the
     manifest published rather than the item's large still. */
  expect(film.player.sources.map((source) => source.type)).toEqual([
    'video/mp4; codecs="hvc1"',
    'video/mp4',
    'video/mp4',
  ]);
  expect(film.player.sources[0].src).toContain(`/media/immutable/${'f'.repeat(64)}/gallery/film-2160.mp4`);
  expect(film.player.sources[1].src).toContain(`/media/immutable/${'0'.repeat(64)}/gallery/film-1080.mp4`);
  expect(film.player.sources[2].src).toContain(`/media/immutable/${'1'.repeat(64)}/gallery/film-720.mp4`);
  expect(film.player.poster).toContain(`/media/immutable/${'e'.repeat(64)}/gallery/film-poster.webp`);

  /* THE LADDER ALSO STATES A SIZE (issue 241), and the engine agrees with the
     arithmetic. The queries are the manifest's own numbers through the item's
     declared aspect; the floor carries none, so some rung always matches. */
  expect(film.player.sources.map((source) => source.media)).toEqual([
    '(min-width: 1920px)',
    '(min-width: 1280px)',
    null,
  ]);
  const eligible = film.player.sources.filter((source) => source.eligible);
  expect(eligible.length, 'no rung is eligible at this viewport; the film is unplayable').toBeGreaterThan(0);
  expect(
    film.player.sources.at(-1).eligible,
    'the smallest rung is gated behind a query, so a narrow viewport can be offered nothing'
  ).toBe(true);

  /* THE STAGE IS WIDESCREEN AND ENLARGED. The ratio holds at every viewport
     this lane runs, because it is the item's own aspect; the SIZE comparison
     is gated on a track wide enough to show it, exactly as the still's own
     cap assertion is — on a 320px phone both stages are the track's width and
     the film is correctly the shorter of the two. */
  expect(
    film.width / film.height,
    `the film’s stage is ${film.width.toFixed(1)}x${film.height.toFixed(1)}, not the widescreen shape it asks for`
  ).toBeCloseTo(galleryVideoAspect, 1);
  expect(
    film.width,
    'the film’s stage is narrower than the square it replaces'
  ).toBeGreaterThanOrEqual(still.width - subPixel);
  if (still.width >= galleryStageCapPx - subPixel) {
    expect(
      film.width,
      `the film’s stage is ${film.width.toFixed(1)}px against the still’s ${still.width.toFixed(1)}px; it was not enlarged`
    ).toBeGreaterThan(still.width);
    expect(
      film.width * film.height,
      'the film’s stage covers no more area than the square it replaces'
    ).toBeGreaterThan(still.width * still.height);
    // And it is the token's own box rather than whatever the track allowed.
    expect(film.width).toBeCloseTo(galleryVideoStageInlinePx, 0);
    expect(film.height).toBeCloseTo(galleryVideoStageBlockPx, 0);
  }
  // The player fills the stage it was given, so the reserved box is the box.
  expect(film.player.width).toBeCloseTo(film.width, 0);
  expect(film.player.height).toBeCloseTo(film.height, 0);

  /* AND ON A PHONE IT USES THE WHOLE FRAME (issue 241). The arrows used to
     flank the stage inside this row and took 116px of a 288px card with them,
     which left a film 172px wide and 97px tall — smaller than the ~48px
     control bar the player draws inside itself, so half the picture was
     chrome. With the arrows in the control row the stage is the frame, and on
     any viewport too narrow for the film's own token width that is exactly
     what it measures. */
  const frameWidth = await page.evaluate(
    () => window.document.querySelector('.gallery-frame').getBoundingClientRect().width
  );
  if (frameWidth < galleryVideoStageInlinePx) {
    expect(
      film.width,
      `the film stage is ${film.width.toFixed(1)}px inside a ${frameWidth.toFixed(1)}px frame; something else is taking its width`
    ).toBeCloseTo(frameWidth, 0);
  }

  /* THE CONTROLS SHRANK AND THE TARGETS DID NOT (owner: reduce "left, right,
     current media"). Both halves, because a shrink that took the touch target
     with it is the stage-1 floor broken. */
  expect(film.arrow.glyph, `the arrow glyph paints ${film.arrow.glyph}px; it did not shrink`).toBeLessThanOrEqual(
    12 + subPixel
  );
  expect(film.arrow.hit.width).toBeGreaterThanOrEqual(touchFloorPx - subPixel);
  expect(film.arrow.hit.height).toBeGreaterThanOrEqual(touchFloorPx - subPixel);
  /* The current dot is the LARGEST of them (it is the scaled one), so bounding
     it bounds every dot on the row. Four CSS pixels, scaled by 1.5. */
  expect(film.dot.mark, `the position mark paints ${film.dot.mark}px; it did not shrink`).toBeLessThanOrEqual(
    6 + subPixel
  );
  expect(film.dot.hit.width).toBeGreaterThanOrEqual(touchFloorPx - subPixel);
  expect(film.dot.hit.height).toBeGreaterThanOrEqual(touchFloorPx - subPixel);

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
 * selection happens before a single byte of the file is read. */
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

  await page.getByRole('button', { name: 'Next film' }).click();
  await expect(page.locator('.gallery-count')).toHaveText('Film 2 of 2');
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

test('the gallery frame is centred in its track, with no dead gutter (issue 202)', async ({ page }) => {
  /* The owner's complaint, measured: the frame's inline size is TRANSFERRED
     from its block cap through aspect-ratio, so on a column wider than
     35.5rem the button is narrower than its own 1fr track. Before this
     landed it sat at the track's start edge — 568.9px of frame at the left
     of an 842px track at a 1280px viewport, 273px of dead space on the right
     alone. Both gutters are measured against the ARROWS that bound the
     track, so this compares two rendered boxes and derives its expectation
     from neither the stylesheet nor a token. */
  await visit(page);
  const frame = page.locator('.gallery-image-button');
  await frame.scrollIntoViewIfNeeded();
  const observed = await page.evaluate(() => {
    /* The gutters are measured against the FRAME's own edges since issue 241.
       They used to be measured against the arrows that bounded the 1fr track,
       and the arrows have moved into the control row under the work — where
       they are adjacent to it at every width instead of floating 212px away
       at a desktop one, which was the other half of the same dead-gutter
       complaint. Two rendered boxes still, and an expectation derived from
       neither the stylesheet nor a token. */
    const row = window.document.querySelector('.gallery-frame').getBoundingClientRect();
    const button = window.document.querySelector('.gallery-image-button').getBoundingClientRect();
    const arrows = [...window.document.querySelectorAll('.gallery-controls > .icon-button')].map(
      (control) => control.getBoundingClientRect()
    );
    const dots = window.document.querySelector('.gallery-dots').getBoundingClientRect();
    return {
      left: button.left - row.left,
      right: row.right - button.right,
      arrows: arrows.map((arrow) => ({ width: arrow.width, height: arrow.height })),
      /* How far each arrow sits from the position marks it brackets — the
         proximity half of the same rule, and the number that was 212px. */
      gaps: [dots.left - arrows[0].right, arrows[1].left - dots.right],
    };
  });
  expect(observed.left, 'the frame sits against the start edge of its track').toBeGreaterThanOrEqual(0);
  expect(
    observed.left,
    `the gutters are ${observed.left.toFixed(1)}px and ${observed.right.toFixed(1)}px — the frame is off centre`
  ).toBeCloseTo(observed.right, 0);
  /* Centring must not have been bought by shrinking the controls: both arrows
     still clear the touch floor at every viewport this lane runs. */
  expect(observed.arrows.length, 'the gallery lost one of its two arrows').toBe(2);
  for (const arrow of observed.arrows) {
    expect(arrow.width).toBeGreaterThanOrEqual(touchFloorPx - subPixel);
    expect(arrow.height).toBeGreaterThanOrEqual(touchFloorPx - subPixel);
  }
  /* And they are BESIDE the marks they belong to rather than pushed to the far
     edges of a track. The token that separates them is a quarter-rem; a whole
     rem of allowance is generous and still an order of magnitude under the
     212px this replaced. */
  for (const gap of observed.gaps) {
    expect(gap, `an arrow sits ${gap.toFixed(1)}px from the position marks`).toBeLessThanOrEqual(16);
    expect(gap, 'an arrow overlaps the position marks').toBeGreaterThanOrEqual(-subPixel);
  }
});

/* ZERO SHIFT ACROSS A KIND CHANGE (issue 241).
 *
 * MEASURED on 0.1.54: a still's stage is a square and a film's is 16:9, and
 * each reserved its own box — so pressing next across the boundary resized the
 * document under the reader, -105.9px at a 390px viewport and +105.9px coming
 * back. The reservation now sits on the frame, which knows nothing about kind,
 * and this measures the document itself rather than any box: the whole page's
 * scroll height, and the top of the section BELOW the gallery, which is what a
 * reader actually watches move. */
test('moving between a still and a film shifts the document by nothing (issue 241)', async ({ page }) => {
  await serveGalleryManifest(page);
  await visit(page);
  await page.locator('.gallery-frame').scrollIntoViewIfNeeded();
  await settled(page);

  const shape = () =>
    page.evaluate(() => {
      const frame = window.document.querySelector('.gallery-frame').getBoundingClientRect();
      const stage = window.document.querySelector('.gallery-stage').getBoundingClientRect();
      const below = window.document.querySelector('#trackers');
      return {
        document: window.document.documentElement.scrollHeight,
        frame: Math.round(frame.height * 10) / 10,
        stage: { width: Math.round(stage.width * 10) / 10, height: Math.round(stage.height * 10) / 10 },
        below: below === null ? null : Math.round(below.getBoundingClientRect().top + window.scrollY),
        kind: window.document.querySelector('.gallery-stage').getAttribute('data-gallery-kind'),
      };
    });

  const still = await shape();
  expect(still.kind).toBe('image');
  await page.getByRole('button', { name: 'Next film' }).click();
  await expect(page.locator('.gallery-count')).toHaveText('Film 2 of 2');
  const film = await shape();
  expect(film.kind).toBe('video');
  await page.getByRole('button', { name: 'Previous photograph' }).click();
  await expect(page.locator('.gallery-count')).toHaveText('Photograph 1 of 2');
  const back = await shape();

  /* Non-vacuity, and it is the point rather than a formality: the two stages
     really are different shapes. If they were not, this lane would be
     measuring a page that cannot shift and proving nothing. */
  expect(
    film.stage.height,
    `both kinds render a ${film.stage.width}x${film.stage.height} stage, so there is no kind change to measure`
  ).toBeLessThan(still.stage.height - 1);

  for (const [label, state] of [
    ['the film', film],
    ['the still, coming back', back],
  ]) {
    expect(
      state.frame,
      `${label} changed the reserved frame from ${still.frame}px to ${state.frame}px`
    ).toBeCloseTo(still.frame, 0);
    expect(
      state.document,
      `${label} changed the document height from ${still.document}px to ${state.document}px`
    ).toBe(still.document);
    expect(
      state.below,
      `${label} moved the section under the gallery from ${still.below} to ${state.below}`
    ).toBe(still.below);
  }
});

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
  const frame = page.locator('.gallery-image-button').first();
  await frame.scrollIntoViewIfNeeded();
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
  test.skip(
    !answered,
    `${browserName} does not move the page from a synthetic scroll here, so neither half of this lane could mean anything on it`
  );
  await frame.scrollIntoViewIfNeeded();
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

  await frame.click();
  await expect(dialog).toHaveJSProperty('open', true);

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

/* The gallery frame's box and its two gutters, measured as one shape. Used
 * twice by the reservation lane below — once with every gallery byte
 * refused, once with them served — so the comparison is between two
 * MEASURED states of the same page rather than against any number this file
 * or the stylesheet states. */
async function galleryFrameShape(page) {
  await page.locator('.gallery-image-button').scrollIntoViewIfNeeded();
  return page.evaluate(() => {
    const round = (value) => Math.round(value * 10) / 10;
    const row = window.document.querySelector('.gallery-frame').getBoundingClientRect();
    const frame = window.document.querySelector('.gallery-image-button').getBoundingClientRect();
    return {
      width: round(frame.width),
      height: round(frame.height),
      // The gutters against the frame's own edges (issue 241): the arrows that
      // used to bound this track now live in the control row under the work.
      left: round(frame.left - row.left),
      right: round(row.right - frame.right),
      // And the reservation itself, which is the box the page is laid out
      // from whether or not a byte ever lands.
      reserved: round(row.height),
    };
  });
}

test('the gallery frame reserves the SAME box with the photograph refused as with it served (issue 202)', async ({
  page,
}) => {
  /* The gap the #204 adversarial review found (finding 3): the zero-CLS
     reservation was pinned at source only, and the centring lane above
     survives the naive `justify-self: center` regression because a zero-width
     box still has two equal gutters. This closes it where the evidence was
     actually gathered — an ALIGNED grid item is sized by its CONTENT, so with
     the bytes refused that regression measures 0x0 on Gecko, 194.6x109.4 on
     Blink and 0x0 on WebKit, none of which equals the served box. The
     expectation is the page's own other state, so nothing here can drift with
     a token the way a stylesheet-derived number would. */
  await page.route('**/gallery-*.webp', (route) => route.abort());
  await visit(page);
  const refused = await galleryFrameShape(page);
  expect(
    refused.width,
    'the frame reserved no width at all with the photograph refused'
  ).toBeGreaterThan(0);
  expect(refused.height, 'the frame reserved no height with the photograph refused').toBeGreaterThan(0);

  await page.unroute('**/gallery-*.webp');
  await visit(page);
  const image = page.locator('img.gallery-image');
  await image.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => image.evaluate((img) => img.complete && img.naturalWidth > 0), {
      message: 'the vendored preview never finished decoding',
      timeout: 10_000,
    })
    .toBe(true);
  const served = await galleryFrameShape(page);

  expect(
    refused,
    `the frame is ${refused.width}x${refused.height} without the photograph and ${served.width}x${served.height} with it — the box is not reserved, it is discovered`
  ).toEqual(served);
});

/* ONE ROW OF DOTS, AT EVERY WIDTH THIS SITE SUPPORTS (issue 241).
 *
 * MEASURED on 0.1.54: nine 44px targets are 396px of controls, so the row
 * wrapped to two lines at 320, 360, 390 and 412, and to three at 250px. The
 * floor that may not move is the target; the axis the surplus goes to is what
 * changed, and this page's standing answer for wide content is that it scrolls
 * inside its own container rather than taking the document sideways. Both
 * halves are measured: one row, and no page-level horizontal scroll. */
test('the position marks stay one row at every phone width, at full size (issue 241)', async ({ page }) => {
  await visit(page);
  for (const width of [250, ...phoneWidths]) {
    await page.setViewportSize({ width, height: 800 });
    await settled(page);
    const row = await page.evaluate(() => {
      const dots = [...window.document.querySelectorAll('.gallery-dot')];
      const strip = window.document.querySelector('.gallery-dots');
      return {
        count: dots.length,
        rows: new Set(dots.map((dot) => Math.round(dot.getBoundingClientRect().top))).size,
        smallest: Math.min(...dots.map((dot) => dot.getBoundingClientRect().width)),
        shortest: Math.min(...dots.map((dot) => dot.getBoundingClientRect().height)),
        scrolls: strip.scrollWidth > strip.clientWidth,
        overflow: getComputedStyle(strip).overflowX,
        documentScrolls:
          window.document.documentElement.scrollWidth > window.document.documentElement.clientWidth,
      };
    });
    expect(row.count, 'the gallery drew no position marks to measure').toBeGreaterThan(1);
    expect(row.rows, `the marks wrapped onto ${row.rows} rows at ${width}px`).toBe(1);
    expect(
      row.smallest + subPixel,
      `a mark is ${row.smallest.toFixed(1)}px wide at ${width}px; the row was made to fit by shrinking its targets`
    ).toBeGreaterThanOrEqual(touchFloorPx);
    expect(row.shortest + subPixel).toBeGreaterThanOrEqual(touchFloorPx);
    expect(
      row.documentScrolls,
      `the page itself scrolls sideways at ${width}px; the row took the document with it`
    ).toBe(false);
    // And where the surplus actually went, when there is one.
    if (row.scrolls) {
      expect(row.overflow, `the marks overflow at ${width}px with nowhere to scroll`).toBe('auto');
    }
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
  await page.locator('.gallery-image-button').click();
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
     drawing, on the one element anybody would ever try it on. The value is
     read back off the engine rather than off the stylesheet, because an engine
     that did not understand `pinch-zoom` would DROP the declaration, and the
     base under it is what this proves survived either way. */
  await visit(page);
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
  await page.locator('.gallery-image-button').click();
  const dialog = page.locator('dialog.gallery-lightbox');
  await expect(dialog).toBeVisible();

  const observed = await page.evaluate(() => {
    const rect = (node) => {
      const box = node.getBoundingClientRect();
      return { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height };
    };
    const control = window.document.querySelector('.gallery-lightbox-close');
    const mark = window.document.querySelector('.gallery-close-mark');
    const border = window.document.querySelector('.gallery-lightbox-border');
    const image = window.document.querySelector('.gallery-lightbox-image');
    const dialogNode = window.document.querySelector('dialog.gallery-lightbox');
    return {
      hit: rect(control),
      mark: rect(mark),
      border: rect(border),
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
     painted mark's box does not intersect the framed photograph's box at
     all. */
  const intersects =
    observed.mark.left < observed.border.right &&
    observed.mark.right > observed.border.left &&
    observed.mark.top < observed.border.bottom &&
    observed.mark.bottom > observed.border.top;
  expect(
    intersects,
    `the close mark (${observed.mark.top.toFixed(1)}-${observed.mark.bottom.toFixed(1)}) overlaps the framed photograph (${observed.border.top.toFixed(1)}-${observed.border.bottom.toFixed(1)})`
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
  const frame = page.locator('.gallery-image-button');
  await frame.scrollIntoViewIfNeeded();

  // Absent, on the feed surface: no caption element exists at all — not an
  // empty one, not a hidden one.
  expect(await page.locator('.gallery-caption').count()).toBe(0);

  /* Zero CLS across the whole cycle: the frame and the counter occupy the
     identical box for every one of the eight items, so nothing an item does
     or does not carry moves the picture. */
  const geometry = [];
  for (let step = 0; step < 8; step += 1) {
    geometry.push(
      await page.evaluate(() => {
        /* Measured as RELATIONSHIPS inside the block, never as viewport
           coordinates: a panel painting elsewhere on the page would move
           every absolute y at once and make this test read as a gallery
           shift it is not. What must not move is the frame's own size, its
           two gutters, and how far the counter sits under it. */
        const round = (value) => Math.round(value * 100) / 100;
        const row = window.document.querySelector('.gallery-frame').getBoundingClientRect();
        const frame = window.document.querySelector('.gallery-image-button').getBoundingClientRect();
        const counter = window.document.querySelector('.gallery-count').getBoundingClientRect();
        return {
          width: round(frame.width),
          height: round(frame.height),
          // The gutters against the frame's own edges since issue 241: the two
          // arrows that used to bound this row moved under the work, so the
          // relationship that must not move is the picture inside its frame.
          left: round(frame.left - row.left),
          right: round(row.right - frame.right),
          reserved: round(row.height),
          counterHeight: round(counter.height),
          counterGap: round(counter.top - frame.bottom),
          captions: window.document.querySelectorAll('.gallery-caption').length,
        };
      })
    );
    await page.getByRole('button', { name: 'Next photograph' }).click();
  }
  const [first] = geometry;
  for (const [index, state] of geometry.entries()) {
    expect(state.captions, `item ${index + 1} rendered a caption element with nothing to say`).toBe(0);
    expect(state, `the gallery block reshaped between item 1 and item ${index + 1}`).toEqual(first);
  }

  // Present, on the lightbox surface: the link the manifest gave, and only
  // the link.
  await page.locator('.gallery-image-button').click();
  await expect(page.locator('dialog.gallery-lightbox')).toBeVisible();
  const meta = await page.evaluate(() => {
    const link = window.document.querySelector('.gallery-meta-link');
    const box = link.getBoundingClientRect();
    return {
      blocks: window.document.querySelectorAll('.gallery-lightbox-meta').length,
      titles: window.document.querySelectorAll('.gallery-meta-title').length,
      texts: window.document.querySelectorAll('.gallery-meta-text').length,
      text: link.textContent.trim(),
      href: link.getAttribute('href'),
      target: link.getAttribute('target'),
      rel: link.getAttribute('rel'),
      label: link.getAttribute('aria-label'),
      height: box.height,
      ink: getComputedStyle(link).color,
    };
  });
  expect(meta.blocks, 'the metadata block did not render for an item that has metadata').toBe(1);
  expect(meta.titles, 'a title element rendered for an item with no title').toBe(0);
  expect(meta.texts, 'a description element rendered for an item with no description').toBe(0);
  expect(meta.text).toBe('Lorem Picsum source');
  expect(meta.href).toMatch(/^https:\/\/picsum\.photos\/seed\/naranjo-gallery-\d{2}\/3840\/2160$/);
  expect(meta.target).toBe('_blank');
  expect(meta.rel, 'the outbound link can reach back into this page').toBe('noopener noreferrer');
  expect(meta.label).toBe('Lorem Picsum source (opens in a new tab)');
  expect(meta.height, 'the link is under the touch floor').toBeGreaterThanOrEqual(touchFloorPx - subPixel);
  // It reads against the scrim it sits on, which is near-black in every mode.
  expect(meta.ink).toBe('rgb(255, 255, 255)');
});

test('the lightbox also closes on a backdrop click and its own close button', async ({ page }) => {
  await visit(page);
  const dialog = page.locator('dialog.gallery-lightbox');
  await page.locator('.gallery-image-button').click();
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Close enlarged photograph' }).click();
  await expect(dialog).not.toBeVisible();

  await page.locator('.gallery-image-button').click();
  await expect(dialog).toBeVisible();
  // A click on the dialog element itself, outside its content box, is the
  // backdrop — clicking at the very top-left corner of the viewport lands
  // there whatever size the enlarged photograph happens to render at.
  await page.mouse.click(2, 2);
  await expect(dialog).not.toBeVisible();
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

  const codingProjects = page
    .locator('#projects .page-subsection')
    .filter({ has: page.locator('h3.subsection-title', { hasText: 'Coding Projects' }) });
  await expect(codingProjects, 'the Coding Projects subsection is not on the page at all').toHaveCount(1);

  const text = await codingProjects.innerText();

  /* Sanity: the scope itself must be real content, not an empty shell that
     would make the negative assertions below trivially true. */
  expect(text.length, 'the Coding Projects subsection rendered no text at all').toBeGreaterThan(0);
  expect(text, 'the six project cards are missing from the rendered subsection').toContain(
    'naranjo.online'
  );

  /* Both halves of the removed caption, checked independently exactly like
     the source-text pin does, but against RENDERED text this time. */
  expect(text, 'the rendered DOM still shows the capture-date caption').not.toMatch(
    /Counts captured from/
  );
  expect(text, 'the rendered DOM still shows the no-fetch caption').not.toMatch(/fetches nothing/);

  /* Scoped correctly: this proves the CODING PROJECTS half never shows the
     caption, not merely that the phrase is absent from the whole page (a
     weaker claim that would tell this pin nothing about THIS subsection
     specifically). */
  await expect(codingProjects.locator('h3.subsection-title')).toHaveText('Coding Projects');
});

/* Every repo card's title/counters row, measured (issue 188). The owner's
 * screenshot showed the SAME viewport rendering two cards differently: short
 * titles (naranjo.online, lidersea.com) left room for the commits/stars
 * counters on the title's own line, while long titles
 * (website-infrastructure, the foobar2000-* trio) pushed them below —
 * content deciding the layout instead of the viewport. This lane measures
 * every one of the six cards at once, at both a narrow and a wide viewport,
 * and requires the SAME placement for every card at a given width: no
 * overlap (stacked, two rows) below the breakpoint, real overlap (one row)
 * at or above it — proving the fix by what a real engine painted, not by
 * reading the rule back out of the stylesheet. */
test('every repo card places its counters the same way relative to its title, regardless of title length (issue 188)', async ({
  page,
}) => {
  await visit(page);

  const codingProjects = page
    .locator('#projects .page-subsection')
    .filter({ has: page.locator('h3.subsection-title', { hasText: 'Coding Projects' }) });
  const heads = codingProjects.locator('.entry-head');
  const cardCount = await heads.count();
  expect(cardCount, 'the six repo cards are not all on the page').toBe(6);

  const overlapsVertically = (a, b) => a.y < b.y + b.height && b.y < a.y + a.height;

  const measure = async () => {
    const rows = [];
    for (let index = 0; index < cardCount; index += 1) {
      const head = heads.nth(index);
      const heading = await head.locator('.entry-heading').boundingBox();
      const counts = await head.locator('.entry-counts').boundingBox();
      expect(heading, `card ${index}'s title never rendered a box`).not.toBeNull();
      expect(counts, `card ${index}'s counters never rendered a box`).not.toBeNull();
      rows.push({ heading, counts, inline: overlapsVertically(heading, counts) });
    }
    return rows;
  };

  // Narrow: 320, 375 and 412 are the owner's named widths for this issue —
  // 375 is an iPhone SE/8 report the shared phoneWidths list does not
  // otherwise cover, so it is added here rather than reused from that list.
  for (const width of [320, 375, 412]) {
    await page.setViewportSize({ width, height: 900 });
    const rows = await measure();
    for (const [index, row] of rows.entries()) {
      expect(
        row.inline,
        `at ${width}px, card ${index}'s counters sit beside its title instead of below it`
      ).toBe(false);
      expect(
        row.counts.y,
        `at ${width}px, card ${index}'s counters render above its title`
      ).toBeGreaterThanOrEqual(row.heading.y + row.heading.height - 1);
    }
  }

  // Wide: an ordinary desktop width, comfortably above the breakpoint.
  await page.setViewportSize({ width: 1280, height: 900 });
  const wideRows = await measure();
  for (const [index, row] of wideRows.entries()) {
    expect(
      row.inline,
      `at 1280px, card ${index}'s counters wrapped below its title instead of sitting beside it`
    ).toBe(true);
  }
});

/* The pull-to-refresh settle guard (issue 187). What this lane CAN prove,
 * in every engine: the declaration reached the page and the engine computed
 * it — not a source-text scan, the same "what a real engine did with it"
 * standard every other lane in this file holds to. What it CANNOT prove:
 * that a live rubber-band drag on a physical iPhone visually settles flush
 * instead of leaving the document translated down. Playwright's synthetic
 * touch/wheel events do not drive WebKit's native overscroll/bounce
 * animation the way a real touchscreen gesture does — there is no
 * documented, reliable way to trigger that specific compositor-level effect
 * from automation in any engine this matrix runs, headless or not. That gap
 * is why this is a computed-style pin rather than a gesture simulation, and
 * why the PR body states it needs the owner's own device to close. */
test('the document root refuses the overscroll bounce, in every engine (issue 187)', async ({ page }) => {
  await visit(page);
  const observed = await page.evaluate(() => ({
    html: getComputedStyle(window.document.documentElement).overscrollBehaviorY,
    body: getComputedStyle(window.document.body).overscrollBehaviorY,
  }));
  expect(observed.html, 'html does not refuse the overscroll bounce').toBe('none');
  expect(observed.body, 'body does not refuse the overscroll bounce').toBe('none');
});

/* The weekday gutter sits BESIDE the strip, in its own flex row (issue 189),
 * so a Mon/Wed/Fri label stays put while the cells beside it carry their own
 * horizontal scroll. This is exactly the kind of claim a source-text pin
 * cannot prove — it can show the two are siblings, never that scrolling one
 * leaves the other's box alone — so this lane scrolls the real strip in a
 * real engine and measures the gutter before and after. */
test('the weekday gutter stays visually stationary while the strip scrolls under it (issue 189)', async ({
  page,
}) => {
  // A narrow viewport, so the fixed 53-column calendar reliably overflows its
  // card and the strip actually has somewhere to scroll to.
  await page.setViewportSize({ width: 390, height: 900 });
  await visit(page);

  const block = page.locator('[data-activity-panel] .grid-block');
  await expect(block).toBeVisible();
  const strip = block.locator('.grid-strip');
  const gutter = block.locator('.grid-weekday-axis');
  await expect(gutter).toBeVisible();

  const before = await gutter.boundingBox();
  expect(before, 'the weekday gutter never rendered a box').not.toBeNull();

  await strip.evaluate((node) => {
    node.scrollLeft = 0;
  });
  const atStart = await gutter.boundingBox();
  expect(atStart.x, 'the weekday gutter moved horizontally when the strip scrolled to its start').toBeCloseTo(
    before.x,
    0
  );
  expect(atStart.y, 'the weekday gutter moved vertically when the strip scrolled').toBeCloseTo(before.y, 0);

  const movedTo = await strip.evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
    return node.scrollLeft;
  });
  expect(
    movedTo,
    'the strip never actually scrolled; the calendar must overflow its own box for this lane to prove anything'
  ).toBeGreaterThan(0);

  const atEnd = await gutter.boundingBox();
  expect(atEnd.x, 'the weekday gutter moved horizontally when the strip scrolled to its end').toBeCloseTo(
    before.x,
    0
  );
  expect(atEnd.y, 'the weekday gutter moved vertically when the strip scrolled').toBeCloseTo(before.y, 0);
});

/* The amended DetailTip card (issue 189, amending #178's value-only decision
 * to match the owner's reference designs): a value row, then the SAME
 * view-scoped period phrase cellLabel folds into the cell's accessible text —
 * "on <date>" for daily, "week of <date>" for weekly, "through week of
 * <date>" for cumulative. This is exactly the kind of thing a source-text
 * regex cannot see (the card's actual painted text, after a real lens
 * switch), so this lane drives the panel's own view toggle and reads the
 * live card three times. */
test('the token panel detail card reads a human period phrase for the one lens that is left (issue 189, 233)', async ({
  page,
}) => {
  /* RE-AIMED for the owner's 2026-08-28 deletion of the display menu. This
     lane used to press view after view and prove the card and the sentence
     both followed. There is nothing left to press, so what it proves now is
     the half that survived and still matters: the card and the sentence agree
     with the DAILY graph the panel actually draws, in a real engine, on a
     real cell. The four-way lens arithmetic itself is executed — not
     pattern-matched — in tests/grid.test.mjs and tests/periods.test.mjs,
     which is where it belongs now that no reader can reach it. */
  await stageUsagePayload(page, (envelope) => {
    const sources = envelope?.data?.sources ?? [];
    expect(sources.length, 'the origin serves no usage sources; this lane cannot stage one').toBeGreaterThan(0);
    sources[0].series = syntheticSeries(120);
  });
  await visit(page);

  const panel = page.locator('[data-panel-id="token-usage"]');
  const cell = panel.locator('[data-grid-cell][data-grid-absent="false"]').first();
  await expect(cell).toBeVisible();
  await cell.scrollIntoViewIfNeeded();

  const readDetail = async () => {
    await page.mouse.move(0, 0);
    const box = await cell.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const tip = panel.locator('.cell-tip').first();
    await expect(tip).toHaveAttribute('data-tip-open', 'true');
    const rows = await tip.locator('.cell-tip-row').allTextContents();
    await page.mouse.move(0, 0);
    return rows;
  };

  const dailyRows = await readDetail();
  expect(
    dailyRows,
    'the card must show exactly a value row and a period row — no leftover date-only mode from issue 178'
  ).toHaveLength(2);
  expect(dailyRows[0], 'the first row must be the raw count').toMatch(/^\d[\d,]*$/);
  expect(dailyRows[1], 'the daily card must read "on <month> <day>"').toMatch(/^on [A-Z][a-z]{2} \d{1,2}$/);

  /* The SENTENCE under the strip describes the same graph in the same period,
     read from the live DOM rather than from the source, because that is the
     only place the two can be seen to agree. */
  const summary = (await panel.locator('.usage-activity-total').first().textContent()).trim();
  expect(summary, 'the sentence must count days and name a day peak').toMatch(
    /tokens over \d+ days, peaking at /
  );
  /* And it is the DAILY sentence in particular: the three phrasings the other
     lenses produce are what a stray default would put here instead. */
  for (const retired of [/per week/, /per month/, /accumulated over/]) {
    expect(summary, `the sentence reads a lens no reader can choose: "${summary}"`).not.toMatch(retired);
  }
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/* ===========================================================================
 * The chrome-icon family (owner directive, 2026-08-24)
 *
 * "These icons are not matching the small, sleek, translucid, appearance of
 * the parent icons, they should not look this overwhelming." The complaint is
 * about two things being drawn at different scales in the same corner of the
 * page, which makes it a MEASUREMENT rather than an opinion: the swatches
 * painted 44px of filled disc plus a 2px ring, the header icons above them
 * painted an 18px line glyph inside an identical 44px box that stayed empty.
 *
 * So these lanes measure the two families against each other in a real
 * engine. The source pins in tests/experience.test.mjs bind the tokens and
 * the chrome's SVG attributes together; only an engine can say what the
 * cascade, the viewBox and the scaling actually produced.
 * ======================================================================== */

/* The popover reveals with a 120ms slide, so a box measured the instant it
 * opens is a box measured part-way through that slide — which reads as a
 * layout shift of a fraction of a pixel and is nothing of the kind. Every
 * measurement below waits for the engine's OWN animation set to finish
 * instead of for a duration, so a reader who asked for less motion (no
 * animation at all) waits for nothing. */
const openedAndStill = async (page) => {
  await openReadingModes(page);
  await page
    .locator('#reading-mode-menu')
    .evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished)));
};

/* What the browser painted for each member of the family: the box the finger
 * gets, the box the eye gets, the line weight, and whether anything was drawn
 * around it. The reader runs whole inside page.evaluate rather than being
 * serialised into it — the origin serves a strict Content-Security-Policy and
 * a helper injected as source text would need eval() to come back to life. */
const readFamily = (page) =>
  page.evaluate(() => {
    const painted = (node) => {
      const style = getComputedStyle(node);
      const glyph = node.querySelector('svg');
      const glyphBox = glyph === null ? null : glyph.getBoundingClientRect();
      const stroked = node.querySelector('.chip, .ray, .chip-edge');
      const hit = node.getBoundingClientRect();
      return {
        label: node.getAttribute('aria-label'),
        pressed: node.getAttribute('aria-pressed') === 'true',
        hit: { width: hit.width, height: hit.height },
        glyph: glyphBox === null ? null : { width: glyphBox.width, height: glyphBox.height },
        strokeWidth:
          stroked === null ? null : Number.parseFloat(getComputedStyle(stroked).strokeWidth),
        opacity: Number.parseFloat(style.opacity),
        borderWidth: Number.parseFloat(style.borderTopWidth),
        radius: Number.parseFloat(style.borderTopLeftRadius),
        background: style.backgroundColor,
        ink: style.color,
      };
    };
    return {
      /* The chrome's own line weight used to be readable off a second,
         independently-stroked header icon (the manual refresh, retired by
         issue 179); with one filled chrome icon left, the token it and the
         swatches both derive from is the only source of truth. */
      chromeStroke: Number.parseFloat(
        getComputedStyle(window.document.documentElement).getPropertyValue('--chrome-icon-stroke')
      ),
      // Scoped to the header for the same reason the button-chrome test
      // above is: .icon-button is now also the gallery's prev/next/close
      // shape (issue 176), and "chrome" here means the header family
      // specifically, which is what the swatch-scale comparison is about.
      chrome: [...window.document.querySelectorAll('.page-header .icon-button')].map(painted),
      swatches: [...window.document.querySelectorAll('.swatch')].map(painted),
    };
  });

test('a reading-mode swatch is painted at the same scale as the chrome icon beside it', async ({
  page,
}) => {
  await visit(page);
  await openedAndStill(page);
  const { chrome, swatches, chromeStroke } = await readFamily(page);
  // One chrome icon now (issue 179 retired the manual refresh that used to
  // sit beside the reading-mode trigger).
  expect(chrome.length, 'the page chrome is not one icon').toBe(1);
  expect(swatches.length, 'the popover renders no swatches').toBe(5);
  expect(
    swatches.filter((swatch) => swatch.pressed).length,
    'the popover shows no chosen mode; the rest/active split below would prove nothing'
  ).toBe(1);

  const [reference] = chrome;
  expect(reference.glyph, `"${reference.label}" paints no glyph`).not.toBeNull();
  expect(chromeStroke, 'the shared --chrome-icon-stroke token could not be read').toBeGreaterThan(0);

  for (const swatch of swatches) {
    /* The eye gets the chrome's glyph — this is the whole complaint, and the
       arrangement the owner rejected fails it by 44 against 18. */
    expect(swatch.glyph, `"${swatch.label}" paints no glyph`).not.toBeNull();
    expect(
      swatch.glyph.width,
      `"${swatch.label}" paints ${swatch.glyph.width}px of glyph beside a ${reference.glyph.width}px chrome icon`
    ).toBeCloseTo(reference.glyph.width, 1);
    expect(swatch.glyph.height).toBeCloseTo(reference.glyph.height, 1);
    /* ...at the chrome's line weight. */
    expect(
      swatch.strokeWidth,
      `"${swatch.label}" is drawn at ${swatch.strokeWidth} against the chrome's ${chromeStroke}`
    ).toBeCloseTo(chromeStroke, 2);
    /* ...wearing the chrome's absence of chrome: no disc, no rim, no fill. */
    expect(swatch.borderWidth, `"${swatch.label}" wears a border`).toBe(0);
    expect(swatch.radius, `"${swatch.label}" wears a disc`).toBe(0);
    expect(swatch.background, `"${swatch.label}" wears a fill`).toMatch(
      /rgba\(0, 0, 0, 0\)|transparent/
    );
    /* ...and translucent at rest, which is the "translucid" half of the
       directive: an unchosen swatch sits behind the chrome rather than
       shouting over it, and the chosen one comes forward to exactly the
       chrome's own presence — never past it. */
    if (swatch.pressed) {
      expect(
        swatch.opacity,
        `the chosen "${swatch.label}" is painted at ${swatch.opacity} against chrome at ${reference.opacity}`
      ).toBe(reference.opacity);
    } else {
      expect(
        swatch.opacity,
        `"${swatch.label}" rests at ${swatch.opacity} against chrome at ${reference.opacity}`
      ).toBeLessThan(reference.opacity);
      expect(swatch.opacity).toBeGreaterThan(0);
    }
    /* The finger still gets the full target: only the paint shrank. */
    expect(swatch.hit.width, `"${swatch.label}" is ${swatch.hit.width}px wide`).toBeGreaterThanOrEqual(
      touchFloorPx - subPixel
    );
    expect(swatch.hit.height).toBeGreaterThanOrEqual(touchFloorPx - subPixel);
    expect(
      swatch.hit.width / swatch.glyph.width,
      `"${swatch.label}" paints ${swatch.glyph.width}px inside a ${swatch.hit.width}px target; the disc is back`
    ).toBeGreaterThan(2);
  }
});

test('pointing at a swatch changes its presence and nothing else', async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), 'a touch device has no hover state to measure');
  await visit(page);
  await openedAndStill(page);
  const geometry = () =>
    page.evaluate(() => {
      const box = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return [x, y, width, height].map((value) => Math.round(value * 100) / 100);
      };
      return {
        popover: box(window.document.querySelector('#reading-mode-menu')),
        swatches: [...window.document.querySelectorAll('.swatch')].map(box),
        glyphs: [...window.document.querySelectorAll('.swatch svg')].map(box),
      };
    });
  const before = await geometry();

  /* The reference: the chrome answers a pointer by moving its ink to the
     brand token, and this reads that answer off the chrome ITSELF rather
     than from a variable name. The reading-mode trigger is the only chrome
     icon left (issue 179 retired the manual refresh that used to sit beside
     it), and while its own popover is open it already carries that answer
     permanently — aria-expanded="true" paints it in the same brand ink hover
     does, per the shared .icon-button rule — so its color right now, with no
     further interaction needed, IS the target color a pointed-at swatch has
     to reach. (Hovering it to look for a CHANGE, tried first, is exactly the
     comparison that cannot work here: there is nothing left to change.) */
  const chromeIcon = page.locator('.theme-menu .trigger');
  const chromeHover = await chromeIcon.evaluate((node) => getComputedStyle(node).color);

  /* An UNCHOSEN swatch, deliberately: the chosen one is already at full
     presence, so hovering it would prove nothing about the state change. */
  const swatch = page.locator('.swatch[aria-pressed="false"]').first();
  const rest = await swatch.evaluate((node) => getComputedStyle(node).opacity);
  expect(Number.parseFloat(rest), 'an unchosen swatch already rests at full presence').toBeLessThan(1);

  await swatch.hover();
  /* Presence and ink are what change, and both are repaints. The polls run to
     the SETTLED value rather than to "something different", because the
     transition passes through every value in between and a first sample
     lands part-way along it. Neither poll is vacuous: the swatch measurably
     rests below full presence (asserted above) and the chrome measurably
     moves its ink (asserted above). */
  await expect
    .poll(() => swatch.evaluate((node) => getComputedStyle(node).opacity), {
      message: 'pointing at a swatch does not bring it to the chrome’s own presence',
    })
    .toBe('1');
  await expect
    .poll(() => swatch.evaluate((node) => getComputedStyle(node).color), {
      message: 'a pointed-at swatch never reaches the ink the chrome beside it paints',
    })
    .toBe(chromeHover);

  const moved = await geometry();
  expect(moved, 'pointing at a swatch moved the popover under the pointer').toEqual(before);
});

/* SUPERSEDED premise (owner directive, 2026-08-28): the chosen mode used to
 * be underlined by a ::after bar, and this lane measured that exactly one bar
 * was painted, on the pressed swatch, at a size that did not change. The bar
 * is gone — the chosen swatch is now COLOURED IN with the brand ink while the
 * unchosen ones stay muted — so what the lane measures moved from a
 * pseudo-element's box to the glyphs' own ink. The two halves it exists for
 * did not move: exactly one swatch must be marked, on the pressed one, and
 * marking it must cost no layout. */
test('choosing a reading mode marks it by ink, and moves nothing', async ({ page }) => {
  await visit(page);
  await openedAndStill(page);

  const marks = async () => {
    /* Away from every swatch first: hover paints the SAME brand ink the
       choice does, so a pointer left resting on the swatch that was just
       clicked would report two marked swatches and hide a broken one. */
    await page.mouse.move(0, 0);
    return page.evaluate(() => {
      const box = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return [x, y, width, height].map((value) => Math.round(value * 100) / 100);
      };
      return {
        popover: box(window.document.querySelector('#reading-mode-menu')),
        swatches: [...window.document.querySelectorAll('.swatch')].map(box),
        /* The mark's target colour, read off the CHROME rather than from a
           token name — the same reference the hover lane beside this one
           uses. The reading-mode trigger wears exactly that ink for as long
           as its own popover is open (aria-expanded="true", the shared
           .icon-button rule), so the page states its own expectation and this
           lane never parses a custom property. It is re-read per measurement
           because the brand ink is per reading mode. */
        chosenInk: getComputedStyle(window.document.querySelector('.theme-menu .trigger')).color,
        /* The chosen-mode mark, measured as the ink an engine actually
           resolved rather than read off a class: a rule that named a colour
           nothing resolves to would satisfy every source pin and show the
           reader nothing. */
        marked: [...window.document.querySelectorAll('.swatch')].map((node) => ({
          label: node.getAttribute('aria-label'),
          pressed: node.getAttribute('aria-pressed') === 'true',
          ink: getComputedStyle(node).color,
        })),
      };
    });
  };

  /* Exactly one mode is chosen at a time, the mark is on it, and the mark is
     a DIFFERENCE rather than a claim: every unchosen swatch shares one
     resting ink and it is not the chosen one's. A stylesheet that painted all
     five the brand colour would satisfy "the pressed one is brand" while
     showing the reader nothing. */
  const marked = (state) => {
    const chosen = state.marked.filter((swatch) => swatch.ink === state.chosenInk);
    expect(chosen.length, 'exactly one reading mode must carry the chosen ink').toBe(1);
    expect(chosen[0].pressed, 'the mark is not on the pressed swatch').toBe(true);
    const resting = new Set(
      state.marked.filter((swatch) => !swatch.pressed).map((swatch) => swatch.ink)
    );
    expect([...resting], 'the unchosen swatches do not share one resting ink').toHaveLength(1);
    expect(
      [...resting][0],
      `every swatch is painted ${state.chosenInk}; the choice is not marked at all`
    ).not.toBe(state.chosenInk);
    return chosen[0];
  };

  const before = await marks();
  marked(before);

  await page.getByRole('button', { name: 'Sepia', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia');
  await openedAndStill(page);
  const after = await marks();
  expect(marked(after).label, 'the chosen ink did not follow the choice').toBe('Sepia');
  /* And the mark costs no space — the whole reason it is ink and not a bar:
     the row it sits in is the row it sat in. */
  expect(after.popover, 'choosing a reading mode resized the popover').toEqual(before.popover);
  expect(after.swatches, 'choosing a reading mode moved the swatches').toEqual(before.swatches);
});

test('every swatch paints a distinct silhouette, at a legible ink, in every reading mode', async ({
  page,
}) => {
  /* SUPERSEDED premise (issue #180, 2026-08-25): the swatches used to preview
     each mode's OWN palette token inside the glyph, and this lane measured
     that no two swatches painted the same (fill, ink) pair. The owner's
     complaint was that this was unreadable at 18px — three near-identical
     moons told apart only by a crater color difference nobody could see. The
     glyphs now paint ONE ink (currentColor) and tell the five modes apart by
     SHAPE instead, so what this lane must measure inverted: the swatches
     SHARE their ink (zero theme branching) and instead must paint a distinct
     SILHOUETTE.

     AMENDED (owner directive, 2026-08-28): there are now exactly TWO inks in
     the popover, because the underline that used to mark the chosen mode was
     replaced by colouring that swatch in. So "one ink" became "one RESTING
     ink plus the chosen one", and both are non-text indicators that have to
     clear 3:1 on the surface they are drawn on — the chosen ink most of all,
     since it is the thing carrying the state. Nothing else about the lane
     moved: five distinct silhouettes, in every reading mode. */
  await visit(page);
  const read = async () => {
    await openedAndStill(page);
    /* Away from the swatches before measuring: hover paints the same brand
       ink the choice does, and the loop below clicks a swatch immediately
       before each read, so a resting pointer would report a second marked
       swatch that no reader who moved their hand would see. */
    await page.mouse.move(0, 0);
    return page.evaluate(() => {
      const popover = window.document.querySelector('#reading-mode-menu');
      return {
        surface: getComputedStyle(popover).backgroundColor,
        swatches: [...window.document.querySelectorAll('.swatch')].map((node) => {
          const glyph = node.querySelector('svg.glyph');
          const outlineShape = node.querySelector('.chip, .chip-edge');
          const outline = getComputedStyle(outlineShape);
          const box = glyph.getBoundingClientRect();
          /* The silhouette: every filled or stroked primitive's own
             geometry, concatenated in DOM order. Two swatches sharing this
             string would be the same shape painted twice — the "three
             identical moons" issue #180 reports, now measured as geometry
             rather than as color, because color is no longer what tells them
             apart. */
          const geometry = [...node.querySelectorAll('.chip, .chip-edge, .ray line')]
            .map(
              (part) =>
                part.getAttribute('d') ??
                ['cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2']
                  .map((attribute) => part.getAttribute(attribute))
                  .join(',')
            )
            .join('|');
          return {
            label: node.getAttribute('aria-label'),
            pressed: node.getAttribute('aria-pressed') === 'true',
            ink: outline.stroke !== 'none' ? outline.stroke : outline.fill,
            painted: box.width > 0 && box.height > 0,
            geometry,
          };
        }),
      };
    });
  };

  /* Opened once: every iteration below leaves the popover open, because the
     measurement is the last thing it does. Opening it again would toggle it
     shut. */
  await openedAndStill(page);
  for (const [label, id] of [
    ['Auto', null],
    ['Light', 'light'],
    ['Dark', 'dark'],
    ['Slate', 'slate'],
    ['Sepia', 'sepia'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    if (id === null) {
      await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
    } else {
      await expect(page.locator('html')).toHaveAttribute('data-theme', id);
    }
    const painted = await read();
    const chosen = painted.swatches.filter((swatch) => swatch.pressed);
    expect(chosen, `${label} mode marks no swatch as chosen`).toHaveLength(1);
    const restingInk = painted.swatches.find((swatch) => !swatch.pressed).ink;
    const seen = new Map();
    for (const swatch of painted.swatches) {
      expect(swatch.painted, `"${swatch.label}" paints nothing in ${label} mode`).toBe(true);
      /* Zero theme branching: every glyph resolves to the currentColor its
         swatch was given, and there are exactly two answers on this popover —
         the resting ink, and the chosen swatch's brand ink. A swatch that
         painted its own PALETTE colour again would be the per-mode branching
         issue #180 removed, and it shows up here as a third ink. */
      expect(
        swatch.ink,
        `"${swatch.label}" paints neither the popover's resting ink nor the chosen one`
      ).toBe(swatch.pressed ? chosen[0].ink : restingInk);
      /* No two swatches draw the same shape. */
      expect(
        seen.get(swatch.geometry),
        `in ${label} mode "${swatch.label}" draws the identical shape "${seen.get(swatch.geometry)}" already draws`
      ).toBeUndefined();
      seen.set(swatch.geometry, swatch.label);
    }
    /* The chosen ink is what carries the state now that the underline is
       gone, so it must be legible AS a difference: a brand ink that resolved
       to the resting one would mark nothing at all. */
    expect(
      chosen[0].ink,
      `in ${label} mode the chosen swatch is painted the same ${restingInk} as its neighbours`
    ).not.toBe(restingInk);
    /* WCAG 1.4.11: both inks are non-text indicators, so both clear 3:1
       against the surface they are drawn on, in every reading mode. */
    for (const [role, ink] of [
      ['resting', restingInk],
      ['chosen', chosen[0].ink],
    ]) {
      const ratio = contrastRatio(ink, painted.surface);
      expect(
        ratio,
        `in ${label} mode the ${role} reading-mode ink sits at ${ratio.toFixed(2)}:1 on the popover`
      ).toBeGreaterThanOrEqual(3);
    }
  }
});

test('the reading-mode popover fits the narrowest phone this site supports', async ({ page }) => {
  await visit(page);
  await page.setViewportSize({ width: phoneWidths[0], height: 720 });
  await settled(page);
  await openReadingModes(page);
  const observed = await page.evaluate(() => {
    const popover = window.document.querySelector('#reading-mode-menu');
    const box = popover.getBoundingClientRect();
    const root = window.document.documentElement;
    return {
      width: Math.round(box.width * 100) / 100,
      left: box.left,
      right: box.right,
      viewport: root.clientWidth,
      scrollWidth: root.scrollWidth,
    };
  });
  /* Inside the viewport on both edges, and not by making the page scroll to
     reveal it — an open popover that pushes the document sideways breaks the
     320px floor exactly as any other overflow would. */
  expect(observed.left, `the popover starts at ${observed.left}px`).toBeGreaterThanOrEqual(0);
  expect(
    observed.right,
    `the popover reaches ${observed.right}px in a ${observed.viewport}px viewport`
  ).toBeLessThanOrEqual(observed.viewport + subPixel);
  expect(observed.scrollWidth, 'the open popover made the page scroll sideways').toBeLessThanOrEqual(
    observed.viewport
  );
  /* And it is genuinely narrower than the row it hangs from, with room to
     spare — the measurement the shrink was for. */
  expect(
    observed.width,
    `the popover is ${observed.width}px wide in a ${observed.viewport}px viewport`
  ).toBeLessThan(observed.viewport - gutterPx);
  // The header pins to the VIEWPORT corner now (owner directive, issue 168),
  // so the popover it hangs from is measured against the window's own edge
  // rather than the column's — the two only used to coincide because the
  // header shared the column's rule, which it no longer does.
  expect(observed.viewport - observed.right).toBeLessThanOrEqual(gutterPx / 2 + subPixel);
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
      /* The detail is a child of a stat cell, and a SIBLING of the strip for a

         heatmap (issue 219: one card per grid, not one per 10px cell). Both

         shapes resolve here so this harness measures the same primitive

         wherever it is mounted. */

      const node =

        cell.querySelector('.cell-tip') ??

        cell.closest('.grid-block')?.querySelector('.cell-tip');
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
  await visit(page);
  test.skip(!(await followsPointer(page)), 'no fine pointer here; the anchored branch is measured below');
  const { gap } = await tipTokens(page);

  /* Both grids, because the owner's second complaint was that only one of
     them had a designed readout. Identical measurement, identical result, is
     what "aligned" means once one component renders both. */
  for (const [selector, index] of [
    ['[data-cells="roomy"] .stat-cell', 5],
    ['[data-cells="compact"] .stat-cell', 4],
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
       regression is legible rather than arithmetic: the box cannot be a row
       away from the cursor, whatever the tile's own size is. */
    const away = Math.hypot(shown.left - at.x, shown.top - at.y);
    const row = shown.tile.bottom - shown.tile.top;
    expect(away, `${selector}: the detail opened ${Math.round(away)}px away — more than one tile height`).toBeLessThan(row);
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
    /* The detail is a child of a stat cell, and a SIBLING of the strip for a

       heatmap (issue 219: one card per grid, not one per 10px cell). Both

       shapes resolve here so this harness measures the same primitive

       wherever it is mounted. */

    const node =

      cell.querySelector('.cell-tip') ??

      cell.closest('.grid-block')?.querySelector('.cell-tip');
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
  }, ['[data-cells="roomy"] .stat-cell', 7]);
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
      /* The detail is a child of a stat cell, and a SIBLING of the strip for a

         heatmap (issue 219: one card per grid, not one per 10px cell). Both

         shapes resolve here so this harness measures the same primitive

         wherever it is mounted. */

      const node =

        cell.querySelector('.cell-tip') ??

        cell.closest('.grid-block')?.querySelector('.cell-tip');
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
    ['[data-cells="roomy"] .stat-cell', 5, gap]
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
  const start = await hoverAt(page, '[data-cells="roomy"] .stat-cell', 5, (box) => ({
    x: Math.round(box.x + 4),
    y: Math.round(box.y + box.height / 2),
  }));
  for (const step of [2, 6, 10, 14]) {
    await page.mouse.move(start.x + step, start.y);
    const moved = await detailBox(page, '[data-cells="roomy"] .stat-cell', 5);
    expect(
      moved.left - (start.x + step),
      `the detail lagged ${moved.left - (start.x + step) - gap}px behind step ${step} of the move`
    ).toBeCloseTo(gap, 0);
  }
});

test('a flood of pointer moves costs one placement per frame, using the newest position', async ({
  page,
}) => {
  await visit(page);
  test.skip(!(await followsPointer(page)), 'no fine pointer here; there is nothing to follow');
  const { gap } = await tipTokens(page);
  const at = await hoverAt(page, '[data-cells="roomy"] .stat-cell', 5, (box) => ({
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
      /* The detail is a child of a stat cell, and a SIBLING of the strip for a

         heatmap (issue 219: one card per grid, not one per 10px cell). Both

         shapes resolve here so this harness measures the same primitive

         wherever it is mounted. */

      const node =

        cell.querySelector('.cell-tip') ??

        cell.closest('.grid-block')?.querySelector('.cell-tip');
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
    ['[data-cells="roomy"] .stat-cell', 5, at.x, at.y]
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

test('the detail flips and clamps at every viewport edge and never grows the document', async ({
  page,
}) => {
  await visit(page);
  test.skip(!(await followsPointer(page)), 'no fine pointer here; the anchored branch is measured below');
  const { gap, margin } = await tipTokens(page);

  /* The narrowest viewport this site supports, and the tile that decides:
     one in the LAST column, scrolled so its bottom edge is at the bottom of
     the screen. Pointing at its far corner asks the box to go past two edges
     at once, which is exactly the placement the retired per-column anchoring
     could not express and the reason the document used to grow sideways. */
  await page.setViewportSize({ width: phoneWidths[0], height: 640 });
  await settled(page);
  const lastColumn = await page.evaluate(() => {
    const cells = [...window.document.querySelectorAll('[data-cells="roomy"] .stat-cell')];
    const rightmost = Math.max(...cells.map((cell) => Math.round(cell.getBoundingClientRect().right)));
    return cells.findLastIndex(
      (cell) => Math.round(cell.getBoundingClientRect().right) === rightmost
    );
  });
  expect(lastColumn, 'no tile sits in the last column; this lane proves nothing').toBeGreaterThan(0);

  const corner = page.locator('[data-cells="roomy"] .stat-cell').nth(lastColumn);
  await corner.scrollIntoViewIfNeeded();
  await corner.evaluate((cell) => {
    const box = cell.getBoundingClientRect();
    window.scrollBy(0, box.bottom - window.document.documentElement.clientHeight + 2);
  });
  const box = await settledBox(page, corner);
  /* Two pixels inside the tile's far corner, floored. One pixel is not a
     safety margin: a tile's edges land on fractional pixels in every engine,
     so `right - 1` rounds OUTSIDE the tile often enough to matter, and a
     pointer outside the tile sends no enter — a lane that silently measured
     a detail nobody opened. (MEASURED: WebKit, one pixel low.) */
  const at = {
    x: Math.floor(box.x + box.width) - 2,
    y: Math.floor(box.y + box.height) - 2,
  };
  await page.mouse.move(0, 0);
  await page.mouse.move(at.x, at.y);
  const edge = await detailBox(page, '[data-cells="roomy"] .stat-cell', lastColumn);

  expect(edge.open, 'the corner tile did not open its detail').toBe('true');
  /* Flipped, not merely clamped. A clamped box near the end edge sits ON the
     cursor and covers the tile being pointed at; a flipped one is on the
     other side of it. Both axes, in one placement. */
  expect(
    edge.right,
    `the detail runs to ${Math.round(edge.right)}px on the end side of a cursor at ${at.x}px`
  ).toBeLessThanOrEqual(at.x - gap + subPixel);
  expect(
    edge.bottom,
    `the detail runs to ${Math.round(edge.bottom)}px below a cursor at ${at.y}px`
  ).toBeLessThanOrEqual(at.y - gap + subPixel);
  /* And inside every edge of the viewport, which is the containment the old
     per-column anchoring provided on the inline axis alone. */
  expect(edge.left, 'the detail reaches past the start edge').toBeGreaterThanOrEqual(margin - subPixel);
  expect(edge.top, 'the detail reaches past the top edge').toBeGreaterThanOrEqual(margin - subPixel);
  expect(edge.right, 'the detail reaches past the end edge').toBeLessThanOrEqual(
    edge.viewport.width - margin + subPixel
  );
  expect(edge.bottom, 'the detail reaches past the bottom edge').toBeLessThanOrEqual(
    edge.viewport.height - margin + subPixel
  );
  /* THE floor. A fixed box is outside the document's scrollable overflow, so
     this is structural rather than lucky — and it is measured while the box
     is open at the worst corner of the narrowest screen, which is where the
     arrangement it replaced failed. */
  expect(
    edge.scrollWidth,
    `the detail grew the document to ${edge.scrollWidth}px inside a ${edge.clientWidth}px viewport`
  ).toBe(edge.clientWidth);

  /* And the case where CLAMPING rather than flipping is what decides, which
     the corner above cannot reach: an 86px box beside a cursor near the end
     edge of a 320px screen fits on the other side of it with room to spare,
     so the clamp never runs. It runs when the box is WIDE — the longest boss
     names produce one about 216px wide at this width — because then the flip
     puts its start edge off the screen and only the clamp catches it.
     Removing the clamp and keeping the flip therefore passes every assertion
     above and fails this one. */
  const widest = await page.evaluate(() => {
    const cells = [...window.document.querySelectorAll('[data-cells="roomy"] .stat-cell')];
    let index = 0;
    let width = 0;
    cells.forEach((cell, at) => {
      const box = (
        cell.querySelector('.cell-tip') ??
        cell.closest('.grid-block').querySelector('.cell-tip')
      ).getBoundingClientRect();
      if (box.width > width) {
        width = box.width;
        index = at;
      }
    });
    return { index, width };
  });
  const wide = page.locator('[data-cells="roomy"] .stat-cell').nth(widest.index);
  await wide.scrollIntoViewIfNeeded();
  const wideBox = await settledBox(page, wide);
  const aim = {
    x: Math.floor(wideBox.x + wideBox.width) - 2,
    y: Math.round(wideBox.y + wideBox.height / 2),
  };
  /* Both preconditions, asserted rather than assumed: if the payload's names
     ever shrink past the point where the clamp decides anything, this lane
     says so instead of quietly proving nothing. */
  expect(
    aim.x + gap + widest.width,
    `the widest detail (${Math.round(widest.width)}px) still fits beside a cursor at ${aim.x}px, so nothing flips`
  ).toBeGreaterThan(phoneWidths[0] - margin);
  expect(
    aim.x - gap - widest.width,
    `the widest detail (${Math.round(widest.width)}px) fits on the other side too, so nothing clamps`
  ).toBeLessThan(margin);
  await page.mouse.move(0, 0);
  await page.mouse.move(aim.x, aim.y);
  const clamped = await detailBox(page, '[data-cells="roomy"] .stat-cell', widest.index);
  expect(clamped.open, 'the widest tile did not open its detail').toBe('true');
  expect(
    clamped.left,
    `a flip put the widest detail at ${Math.round(clamped.left)}px and nothing pulled it back to the start edge`
  ).toBeCloseTo(margin, 0);
  expect(clamped.scrollWidth, 'the clamped detail grew the document').toBe(clamped.clientWidth);

  /* The other corner: a tile at the very top of the screen, where the box
     must clamp rather than flip off the top. */
  const first = page.locator('[data-cells="roomy"] .stat-cell').first();
  await first.scrollIntoViewIfNeeded();
  await first.evaluate((cell) => {
    window.scrollBy(0, cell.getBoundingClientRect().top - 1);
  });
  const head = await settledBox(page, first);
  await page.mouse.move(0, 0);
  await page.mouse.move(Math.ceil(head.x) + 2, Math.ceil(head.y) + 2);
  const top = await detailBox(page, '[data-cells="roomy"] .stat-cell', 0);
  expect(top.open, 'the top tile did not open its detail').toBe('true');
  expect(top.top, 'the detail reaches past the top edge').toBeGreaterThanOrEqual(margin - subPixel);
  expect(top.left, 'the detail reaches past the start edge').toBeGreaterThanOrEqual(margin - subPixel);
  expect(top.scrollWidth, 'the detail grew the document at the top edge').toBe(top.clientWidth);

  /* Every column width between the phone floor and a desktop. The page column
     is a token and a later lane makes it adjustable, so a detail that only
     behaved at 320 and 1280 would be a detail that behaves at two of the
     widths a reader can produce. */
  for (const width of [phoneWidths[0], phoneWidths[2], 768, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    await settled(page);
    const spot = await hoverAt(page, '[data-cells="roomy"] .stat-cell', 5, (tile) => ({
      x: Math.round(tile.x + tile.width / 2),
      y: Math.round(tile.y + tile.height / 2),
    }));
    const shown = await detailBox(page, '[data-cells="roomy"] .stat-cell', 5);
    expect(shown.open, `the detail did not open at ${width}px`).toBe('true');
    expect(shown.left, `the detail reaches past the start edge at ${width}px`).toBeGreaterThanOrEqual(margin - subPixel);
    expect(shown.right, `the detail reaches past the end edge at ${width}px`).toBeLessThanOrEqual(
      width - margin + subPixel
    );
    expect(
      Math.abs(shown.left - spot.x),
      `the detail sits ${Math.round(Math.abs(shown.left - spot.x))}px from the pointer at ${width}px`
    ).toBeLessThanOrEqual(gap + shown.width);
    expect(shown.scrollWidth, `the detail grew the document at ${width}px`).toBe(shown.clientWidth);
  }
});

test('a tap opens the detail over its own tile, and a second tap closes it', async ({ page }) => {
  await visit(page);
  test.skip(await followsPointer(page), 'this engine reports a cursor; the following branch is measured above');
  const { gap, margin } = await tipTokens(page);

  /* No cursor, so nothing to follow: the box anchors to the TILE, which is
     the arrangement the pointer branch replaced and the correct one here. A
     finger covers the tile it is on, so the box goes above it. */
  const tile = page.locator('[data-cells="roomy"] .stat-cell').nth(5);
  await tile.scrollIntoViewIfNeeded();
  await tile.tap();
  const shown = await detailBox(page, '[data-cells="roomy"] .stat-cell', 5);
  expect(shown.open, 'a tap opened no detail').toBe('true');
  expect(shown.visibility, 'a tap opened an invisible detail').toBe('visible');
  expect(
    shown.bottom,
    `the detail runs to ${Math.round(shown.bottom)}px over a tile that starts at ${Math.round(shown.tile.top)}px`
  ).toBeLessThanOrEqual(shown.tile.top - gap + subPixel);
  /* Centred on the tile it describes, within the clamping the edges impose. */
  const tileCentre = (shown.tile.left + shown.tile.right) / 2;
  const boxCentre = (shown.left + shown.right) / 2;
  expect(
    Math.abs(boxCentre - tileCentre),
    `the detail is centred ${Math.round(Math.abs(boxCentre - tileCentre))}px away from its tile`
  ).toBeLessThanOrEqual(shown.viewport.width);
  expect(shown.left, 'the detail reaches past the start edge').toBeGreaterThanOrEqual(margin - subPixel);
  expect(shown.right, 'the detail reaches past the end edge').toBeLessThanOrEqual(
    shown.viewport.width - margin + subPixel
  );
  expect(shown.scrollWidth, 'the detail grew the document on a phone').toBe(shown.clientWidth);

  /* A finger has no "away", so the tap is a TOGGLE: the same tile again
     closes it, and there is no state in which a reader is stuck with a box
     they cannot dismiss. */
  await tile.tap();
  const closed = await detailBox(page, '[data-cells="roomy"] .stat-cell', 5);
  expect(closed.open, 'a second tap left the detail open').toBe('false');
  expect(closed.visibility, 'a second tap left the detail visible').toBe('hidden');
});

test('keyboard focus opens the detail on both grids', async ({ page }) => {
  await visit(page);
  const { gap, margin } = await tipTokens(page);

  /* A real Tab, not a programmatic focus: :focus-visible is what separates a
     keyboard reader from a click, and only a genuine keyboard interaction
     sets it. Focusing the PREVIOUS tile and pressing Tab is what makes that
     affordable — the alternative is ninety-odd tab stops from the top of the
     page. */
  for (const [selector, index] of [
    ['[data-cells="roomy"] .stat-cell', 5],
    ['[data-cells="compact"] .stat-cell', 4],
  ]) {
    const tile = page.locator(selector).nth(index);
    await tile.scrollIntoViewIfNeeded();
    await tile.evaluate((cell) => cell.previousElementSibling.focus());
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(
      ([css, at]) => window.document.activeElement === window.document.querySelectorAll(css)[at],
      [selector, index]
    );
    expect(focused, `Tab did not land on ${selector} #${index}`).toBe(true);
    const shown = await detailBox(page, selector, index);
    expect(shown.open, `${selector} does not open its detail for a keyboard`).toBe('true');
    expect(shown.visibility, `${selector} opened an invisible detail for a keyboard`).toBe('visible');
    /* Anchored to the tile, because a keyboard has no cursor to anchor to —
       the same branch a finger takes, from the same primitive. Above it by
       preference, below it when the tile is too near the top of the screen
       for the box to fit above, and never ON it either way: a readout drawn
       over the thing it describes is the arrangement a flip exists to
       prevent, and which side it lands on depends on where the browser's own
       focus scrolling left the tile. */
    const clear =
      shown.bottom <= shown.tile.top - gap + subPixel ||
      shown.top >= shown.tile.bottom + gap - subPixel;
    expect(
      clear,
      `${selector}: the keyboard detail (${Math.round(shown.top)}–${Math.round(shown.bottom)}) overlaps its own tile (${Math.round(shown.tile.top)}–${Math.round(shown.tile.bottom)})`
    ).toBe(true);
    expect(shown.left, `${selector}: the keyboard detail reaches past the start edge`).toBeGreaterThanOrEqual(
      margin - subPixel
    );
    expect(shown.right, `${selector}: the keyboard detail reaches past the end edge`).toBeLessThanOrEqual(
      shown.viewport.width - margin + subPixel
    );
    expect(shown.scrollWidth, `${selector}: the keyboard detail grew the document`).toBe(
      shown.clientWidth
    );
  }
});

/* ===========================================================================
 * The token-activity heatmap (issue 178)
 *
 * Two complaints, one fix each. The graph rendered as a tiny left-aligned
 * block beside a card every other tracker fills, and its popover was the
 * browser's own title= tooltip reading "1,025,755,735 tokens on
 * 2026-08-22" — a log line, not a designed readout. Full width and the
 * OSRS-style card are both opt-in on the shared ContributionGrid, so these
 * lanes measure the token panel specifically; the version-control
 * calendar's own coverage above is untouched by either change.
 * ======================================================================== */

test('the token-activity grid fills its card, not a tiny left-aligned block', async ({ page }) => {
  await visit(page);
  const measured = await page.evaluate(() => {
    const block = window.document.querySelector('[data-panel-id="token-usage"] .grid-block');
    const body = window.document.querySelector('[data-panel-id="token-usage"] .panel-body');
    if (!block || !body) return null;
    const blockBox = block.getBoundingClientRect();
    const bodyBox = body.getBoundingClientRect();
    return {
      fullwidth: block.getAttribute('data-grid-fullwidth'),
      blockWidth: blockBox.width,
      bodyWidth: bodyBox.width,
    };
  });
  expect(measured, 'the token panel rendered no activity grid to measure').not.toBeNull();
  expect(measured.fullwidth, 'the token panel did not opt its grid into full width').toBe('true');
  /* Not a pixel match — the block sits inside the card's own flex column —
     but genuinely filling it rather than the few columns' worth of pixels a
     15-day series would otherwise claim (roughly a third of the card). */
  expect(
    measured.blockWidth,
    `the grid is ${Math.round(measured.blockWidth)}px inside a ${Math.round(measured.bodyWidth)}px card`
  ).toBeGreaterThan(measured.bodyWidth * 0.9);
});

/* NO DISPLAY CONTROLS, AND ONE GRAPH PER SOURCE (owner directive, 2026-08-28,
 * reversing the 0.1.52 decision after seeing it live: "remove this entire
 * menu. it doesnt look good and it doesn't provide any value").
 *
 * The two lanes this replaces pressed a per-source view lens and a per-source
 * trailing range and proved each moved its own graph and left its neighbour
 * alone. Neither control exists, so this lane asks the questions that took
 * their place, and it asks them in both directions like they did: the panel
 * offers NOTHING to press, and the graph every source draws is the fixed one —
 * daily, full depth, the source's own totals — rather than nothing at all.
 *
 * A page that had simply lost its graphs would satisfy the first half
 * perfectly, which is why the second half is here. */
test('the token panel offers no display control, and every source still draws its fixed graph', async ({
  page,
}) => {
  await visit(page);
  const panel = page.locator('[data-panel-id="token-usage"]');
  await expect(panel).toBeVisible();

  /* Half one: nothing to press. Measured as the DOM the reader gets, not as
     the source — a control rendered hidden would still be a control, and this
     is the assertion that would fail if one grew back inside the panel. */
  const controls = await panel.evaluate((node) => ({
    triggers: node.querySelectorAll('.filter-trigger').length,
    popovers: node.querySelectorAll('.filter-popover').length,
    groups: node.querySelectorAll('.filter-group').length,
    radiogroups: node.querySelectorAll('[role="radiogroup"]').length,
    radios: node.querySelectorAll('[role="radio"]').length,
    pills: node.querySelectorAll('.usage-view').length,
    /* Every remaining button in the panel, so a control wearing a new class
       cannot slip past the four above. The panel legitimately holds none:
       its cells are listbox options, not buttons. */
    buttons: [...node.querySelectorAll('button')].map((button) =>
      (button.getAttribute('aria-label') ?? button.textContent ?? '').trim()
    ),
  }));
  expect(controls.triggers, 'the display trigger is back').toBe(0);
  expect(controls.popovers, 'the display popover is back').toBe(0);
  expect(controls.groups, 'a display question is back').toBe(0);
  expect(controls.radiogroups, 'a radio group is back in the token panel').toBe(0);
  expect(controls.radios, 'a radio is back in the token panel').toBe(0);
  expect(controls.pills, 'a display pill is back').toBe(0);
  expect(controls.buttons, `the token panel grew a control: ${controls.buttons.join(', ')}`).toEqual([]);

  /* Half two: every source still draws the fixed graph, and every one draws
     the SAME window, which is what "fixed" means once the choice is gone.
     Both sources are read so a panel that dropped one source's graph fails
     here rather than passing on the survivor. */
  const graphs = await panel.evaluate((node) =>
    [...node.querySelectorAll('.usage-source')]
      .map((source) => {
        const region = source.querySelector('.usage-activity');
        if (region === null) return null;
        const block = region.querySelector('.grid-block');
        const cells = [...region.querySelectorAll('[data-grid-cell]')];
        return {
          label: source.querySelector('.usage-source-label').textContent.trim(),
          claimed: Number(block.getAttribute('data-grid-columns')),
          columns: cells.length / 7,
          strip: region.querySelector('.grid-strip').getAttribute('aria-label'),
          summary: region.querySelector('.usage-activity-total').textContent.trim(),
          coverage: region.querySelector('.usage-activity-coverage').textContent.trim(),
        };
      })
      .filter((graph) => graph !== null)
  );
  expect(graphs.length, 'the token panel renders fewer than two graphs; this lane cannot compare them').toBeGreaterThan(1);
  for (const graph of graphs) {
    expect(graph.columns, `"${graph.label}" drew a width it did not claim`).toBe(graph.claimed);
    /* The graph's accessible name is the region's own label and NOTHING else
       (issue 233): it used to carry the pressed lens and window, which were
       facts about a choice. A name still naming one would mean a choice
       survived somewhere. */
    expect(graph.strip, `"${graph.label}" still announces a lens or a window`).not.toMatch(
      /view|range|only/
    );
    // The daily sentence, and the coverage line that states its denominator.
    expect(graph.summary, `"${graph.label}" renders no daily summary sentence`).toMatch(
      /tokens over \d+ days, peaking at /
    );
    expect(graph.coverage, `"${graph.label}" renders no coverage line`).toMatch(
      /· \d+(,\d{3})* of \d+(,\d{3})* days captured$|· every day in range captured$/
    );
  }
  const [first, ...rest] = graphs;
  for (const graph of rest) {
    expect(
      graph.claimed,
      `"${first.label}" draws ${first.claimed} columns and "${graph.label}" draws ${graph.claimed}; the window is not fixed`
    ).toBe(first.claimed);
  }
  /* The window is at least the reserve, which is what keeps a short capture
     from drawing a tenth of the card the owner's no-dead-space rule says must
     be filled. It may be wider — the capture decides above the reserve — so
     this is a floor, exactly as fullDepthColumns is. */
  expect(
    first.claimed,
    `the fixed window drew ${first.claimed} columns, under the reserve the card is sized for`
  ).toBeGreaterThanOrEqual(53);
});

test('a token-activity cell card is titled "Tokens used" and reads a human period phrase, never a raw ISO date', async ({
  page,
}) => {
  await visit(page);
  // Absent (issue 189: the fixed trailing window front-pads a series
  // younger than itself) rather than data restricts the selector: an absent
  // cell never renders the cardTitle/DetailTip branch at all, so `.nth(0)`
  // on the bare `[data-grid-cell]` selector now frequently lands on a
  // padding cell with no card to open.
  const selector = '[data-panel-id="token-usage"] .grid-cell[data-grid-cell][data-grid-absent="false"]';
  test.skip(
    (await page.locator(selector).count()) === 0,
    'the token panel rendered no activity cells to hover'
  );
  if (await followsPointer(page)) {
    await hoverAt(page, selector, 0, (box) => ({
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    }));
  } else {
    await page.locator(selector).nth(0).tap();
  }
  const shown = await detailBox(page, selector, 0);
  expect(shown.open, 'hovering/tapping a token cell opened no card').toBe('true');
  expect(shown.text, 'the card does not name itself "Tokens used"').toMatch(/^Tokens used/);
  // Issue 189 amends #178's "value only, no date" decision to match the
  // owner's reference designs: the card now carries a human period phrase
  // too ("on Aug 12" in the default daily view, tested across every lens by
  // "the token panel detail card shows the value..." above). What survives
  // from #178 is the FORMAT floor, not the absence: it must never leak the
  // raw machine-formatted ISO date cellLabel's own hostile-string tests
  // guard against elsewhere.
  expect(shown.text, `the card leaked a raw ISO date instead of a formatted phrase: "${shown.text}"`).not.toMatch(
    /\d{4}-\d{2}-\d{2}/
  );
  expect(
    shown.text,
    `the card must read a period phrase (issue 189), not a bare figure: "${shown.text}"`
  ).toMatch(/on [A-Z][a-z]{2} \d{1,2}/);
  /* And the FIGURE reads the way a person reads one (owner directive,
     2026-08-25): this card used to say "627,742,457" under a summary line
     that said "7.7B tokens over 15 days" — one number, two ways, on one
     card. Either an exact figure below the compaction floor, or a
     one-decimal magnitude; nine grouped digits is neither. */
  const figure = /Tokens used\s*([\d.,]+[KMBT]?)/.exec(shown.text);
  expect(figure, `the card shows no figure at all: "${shown.text}"`).not.toBeNull();
  expect(
    figure[1],
    `the card writes its figure as "${figure[1]}" instead of a human-readable magnitude`
  ).toMatch(/^(?:\d{1,3}(?:,\d{3})?|\d{1,4}(?:\.\d)?[KMBT])$/);
  // Not a bare title= log line: the card-enabled cell carries no native
  // tooltip of its own for the browser to show alongside it.
  const nativeTooltip = await page
    .locator(selector)
    .nth(0)
    .evaluate((cell) => cell.hasAttribute('title'));
  expect(nativeTooltip, 'the card-enabled cell still carries a native title= tooltip too').toBe(false);
});

test('a tap opens the token-activity card, and a second tap closes it', async ({ page }) => {
  await visit(page);
  test.skip(await followsPointer(page), 'this engine reports a cursor; hover is measured above');
  // Absent (issue 189: the fixed trailing window front-pads a series
  // younger than itself) rather than data restricts the selector: an absent
  // cell never renders the cardTitle/DetailTip branch at all, so `.nth(0)`
  // on the bare `[data-grid-cell]` selector now frequently lands on a
  // padding cell with no card to open.
  const selector = '[data-panel-id="token-usage"] .grid-cell[data-grid-cell][data-grid-absent="false"]';
  test.skip(
    (await page.locator(selector).count()) === 0,
    'the token panel rendered no activity cells to tap'
  );
  const cell = page.locator(selector).nth(0);
  await cell.scrollIntoViewIfNeeded();
  await cell.tap();
  const shown = await detailBox(page, selector, 0);
  expect(shown.open, 'a tap opened no card on the token-activity grid').toBe('true');
  expect(shown.visibility, 'a tap opened an invisible card').toBe('visible');

  // A finger has no "away", so the tap is a TOGGLE, exactly like the boss
  // grid's own (issue 178: touch must work here, not hover-only).
  await cell.tap();
  const closed = await detailBox(page, selector, 0);
  expect(closed.open, 'a second tap left the card open').toBe('false');
});

test('the skill detail and the boss detail are the same object, measured', async ({ page }) => {
  await visit(page);

  /* The owner's second complaint, measured rather than eyeballed: the skill
     readout must not merely resemble the boss one, it must BE it. Every value
     below is read from the engine's computed style, and every one of them
     also has to resolve from a token — a raw length would pass a parity
     check and still be the drift issue #136 rule 5 forbids. */
  const measure = ([css, at]) => {
    const target = window.document.querySelectorAll(css)[at];
    const node =
      target.querySelector('.cell-tip') ??
      target.closest('.grid-block').querySelector('.cell-tip');
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
  const boss = await page.evaluate(measure, ['[data-cells="roomy"] .stat-cell', 5]);
  const skill = await page.evaluate(measure, ['[data-cells="compact"] .stat-cell', 4]);

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
      skill[property],
      `the skill detail's ${property} is "${skill[property]}" where the boss detail's is "${boss[property]}"`
    ).toBe(boss[property]);
  }
  /* Non-vacuity: a parity check between two empty boxes proves nothing, so
     both must actually carry a heading and labelled rows. */
  expect(boss.rows, 'the boss detail rendered no rows').toBeGreaterThan(2);
  expect(skill.rows, 'the skill detail rendered no rows').toBeGreaterThan(2);
  /* The heading is the panel layer's one chromatic token and the rows are
     not, which is the visual grammar the owner called the reference. */
  expect(boss.titleInk, 'the detail heading is painted in the body ink').not.toBe(boss.ink);
  expect(boss.rowInk, 'a detail row is painted in the heading colour').toBe(boss.ink);

  /* And every one of those numbers resolves from the token layer rather than
     being stated in the component: moving a token moves both details, which
     is what makes the parity above a property instead of a coincidence. */
  const fromTokens = await page.evaluate(() => {
    const style = getComputedStyle(window.document.documentElement);
    const node = window.document.querySelector('.cell-tip');
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
  /* 0.375rem 0.5rem at the 16px root the page ships is 6px 8px; the lane
     resolves the declaration rather than restating the pixels, so retuning
     the token retunes the check. */
  const rem = (value) => `${Number(value.replace('rem', '')) * 16}px`;
  const [blockPad, inlinePad] = fromTokens.declaredPadding.split(/\s+/);
  expect(fromTokens.computedPadding, 'the detail padding is not the token').toBe(
    `${rem(blockPad)} ${rem(inlinePad)}`
  );
  expect(fromTokens.computedRadius, 'the detail radius is not the token').toBe(
    fromTokens.declaredRadius
  );
  expect(fromTokens.computedSize, 'the detail type size is not the token').toBe(
    rem(fromTokens.declaredSize)
  );
});

test('a hostile row name reaches the detail as text and nothing else', async ({ page }) => {
  /* Detail content is PAYLOAD — boss and skill names arrive over the network
     from the origin's hiscore snapshot — so "it renders as text" is a
     security property, not a formatting one. The origin's own data is well
     behaved, which is exactly why it cannot demonstrate this: the response is
     intercepted and one name replaced with markup that would be loud if it
     ever executed. */
  const hostile = '<img src=x onerror="window.__tipEscaped = true">';
  await page.route('**/api/panels/boss-log', async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    envelope.data.bosses[0].name = hostile;
    envelope.data.skills[0].name = hostile;
    await route.fulfill({ response, json: envelope });
  });
  await visit(page);

  const rendered = await page.evaluate(
    (text) => {
      const tips = [...window.document.querySelectorAll('.cell-tip')];
      const carrying = tips.filter((node) => node.textContent.includes(text));
      return {
        carrying: carrying.length,
        elements: carrying.flatMap((node) => [...node.querySelectorAll('*')].map((n) => n.tagName)),
        images: window.document.querySelectorAll('img[src="x"]').length,
        executed: window.__tipEscaped === true,
        labels: [...window.document.querySelectorAll('[aria-label]')].filter((n) =>
          n.getAttribute('aria-label').includes(text)
        ).length,
      };
    },
    hostile
  );

  /* One boss tile and one skill tile carry it, as literal text. */
  expect(rendered.carrying, 'the hostile name never reached a detail; this lane proves nothing').toBe(2);
  /* Nothing it contained became an element, anywhere. */
  expect(rendered.images, 'the payload name became a real <img> in the document').toBe(0);
  expect(rendered.executed, 'markup from the payload executed').toBe(false);
  /* And the only elements inside those details are the primitive's own spans:
     the payload contributed text nodes and no structure at all. */
  expect(
    [...new Set(rendered.elements)],
    'a detail carrying payload text contains an element the primitive did not render'
  ).toEqual(['SPAN']);
  /* The same text also lands in the tile's accessible name, and is inert
     there too — the aria-label path is a second place a payload reaches the
     DOM and it must be no different. */
  expect(rendered.labels, 'the hostile name never reached an accessible name').toBe(2);
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

// The narrowest viewport with room for the column, its gutters and both hit
// lanes: 60 + 2x1 + 2x2.75 rem. Pinned against the tokens in
// tests/column-width.test.mjs; used here as the width at which a handle is
// first expected to exist.
const railsBreakpointPx = 67.5 * 16;

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
    expect(handle.now).toBeLessThan(handle.max);
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
        box: [box.left + window.scrollX, box.top + window.scrollY, box.width, box.height],
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
  /* The header icon, before anything is dragged — the reference for the
     decoupling check below (owner directive, issue 168: "I don't like how
     they move when I drag the feed in and out"). */
  const iconBefore = await page.evaluate(() => window.document.querySelector('.icon-button').getBoundingClientRect());

  await dragHandle(page, 'end', 160);
  const after = await columnBox(page);

  /* The edge tracks the finger one for one, which for a CENTRED column means
     the width grew by twice the travel. Both halves are asserted: the width
     doubling alone would also be satisfied by an edge racing ahead of the
     pointer. */
  expect(after.right - before.right, 'the grabbed edge did not follow the pointer').toBeCloseTo(160, 0);
  expect(after.width - before.width, 'a centred column must grow from both sides').toBeCloseTo(320, 0);
  expect(after.left - before.left).toBeCloseTo(-160, 0);
  expect(after.scrollWidth).toBe(after.clientWidth);
  /* The header pinned to the viewport corner, decoupled from the column
     entirely (issue 168): the exact drag above that just moved the column's
     own edge by 160px must move the icon by nothing at all. */
  const iconAfter = await page.evaluate(() => window.document.querySelector('.icon-button').getBoundingClientRect());
  expect(
    { top: iconAfter.top, right: iconAfter.right },
    'dragging the feed moved the header icon; it must be independent of the column'
  ).toEqual({ top: iconBefore.top, right: iconBefore.right });

  /* The start handle mirrors it, and undoes it. */
  await dragHandle(page, 'start', 160);
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

  const end = page.locator('.column-handle[data-edge="end"]');
  await end.focus();
  await expect(end).toBeFocused();

  /* The arrows move the SPLITTER (WAI-ARIA Window Splitter): right on the end
     handle widens, left narrows, and the reported value follows the box. */
  await page.keyboard.press('ArrowRight');
  const widened = await columnBox(page);
  expect(widened.width, 'ArrowRight on the end handle did not widen the column').toBeGreaterThan(
    shipped.width
  );
  await page.keyboard.press('ArrowLeft');
  expect((await columnBox(page)).width).toBeCloseTo(shipped.width, 0);

  /* The start handle answers the same keys in the opposite direction, because
     "left" is a direction in the window and not in the column. */
  const start = page.locator('.column-handle[data-edge="start"]');
  await start.focus();
  await page.keyboard.press('ArrowLeft');
  expect(
    (await columnBox(page)).width,
    'ArrowLeft on the start handle must widen, not narrow'
  ).toBeGreaterThan(shipped.width);
  await page.keyboard.press('ArrowRight');

  await page.keyboard.press('Home');
  const home = await columnBox(page);
  await page.keyboard.press('End');
  const end2 = await columnBox(page);
  expect(home.width, 'Home did not take the column to its minimum').toBeLessThan(shipped.width);
  expect(end2.width, 'End did not take the column to its maximum').toBeGreaterThan(shipped.width);
  const reported = await page.evaluate(() =>
    Number(window.document.querySelector('.column-handle').getAttribute('aria-valuenow'))
  );
  expect(reported, 'the splitter reports a width it is not at').toBeCloseTo(end2.width, 0);

  /* Double click resets, which is the convention every split view already
     taught this reader. */
  await end.dblclick();
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
  const shipped = await loadAndObserve(context, null);
  const chosen = await loadAndObserve(context, '40');

  expect(chosen.column.width, 'the stored width was not applied at all').toBeCloseTo(
    40 * chosen.column.rem,
    0
  );
  expect(chosen.column.token).toBe('40rem');
  expect(shipped.column.width, 'a page with no preference must ship at its own column').toBeCloseTo(
    60 * shipped.column.rem,
    0
  );

  /* The pre-paint guarantee, measured in every engine: the only thing the
     static document paints is in exactly the same place either way, so there
     is nothing a later width could move. A shell that grew a left-aligned
     element would fail here, which is precisely the regression this measures
     rather than assumes. */
  expect(chosen.firstFrame?.heading, 'no heading was painted to measure').toBeTruthy();
  expect(
    chosen.firstFrame.heading,
    'the page painted something the column width moves; the stored width now costs a layout shift'
  ).toEqual(shipped.firstFrame.heading);

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
      60 * column.rem,
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
       column is the screen less its two gutters and the fixed control's own
       lane (issue 241), and nothing scrolls sideways. Every width in this list
       sits below the handle breakpoint, which is exactly the range that lane
       is reserved in. */
    expect(column.width).toBeCloseTo(Math.min(60 * column.rem, width - gutterPx - controlLanePx), 0);
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
      const grid = window.document.querySelector('.stat-grid[data-cells="roomy"]');
      const cells = [...grid.querySelectorAll('.stat-cell')];
      const distinct = (values) => new Set(values.map((value) => Math.round(value))).size;
      const frames = [...window.document.querySelectorAll('.gallery-stage')].map((stage) => {
        const box = stage.getBoundingClientRect();
        return { width: box.width, height: box.height };
      });
      const root = window.document.documentElement;
      return {
        column: window.document.querySelector('main').getBoundingClientRect().width,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        bossColumns: distinct(cells.map((cell) => cell.getBoundingClientRect().left)),
        bossRows: distinct(cells.map((cell) => cell.getBoundingClientRect().top)),
        bossCells: cells.length,
        tiles: window.document.querySelectorAll('[data-usage-tile]').length,
        strips: window.document.querySelectorAll('.grid-strip').length,
        navLinks: window.document.querySelectorAll('.section-link').length,
        sections: window.document.querySelectorAll('.page-section').length,
        rails: [...window.document.querySelectorAll('.column-handle')].map((handle) => {
          const rail = handle.getBoundingClientRect();
          return { left: rail.left, right: rail.right };
        }),
        frames,
        /* Nothing anywhere escapes its own box: the same containment rule the
           phone lane proves, asked at every width a reader can produce. */
        escaping: [...window.document.querySelectorAll('body *')]
          .filter((node) => {
            if (node.scrollWidth <= root.clientWidth) return false;
            for (let parent = node; parent instanceof HTMLElement; parent = parent.parentElement) {
              const overflow = getComputedStyle(parent).overflowX;
              if (['auto', 'scroll', 'hidden', 'clip'].includes(overflow)) return false;
            }
            return true;
          })
          .map((node) => `${node.tagName.toLowerCase()}.${node.className}`)
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
    /* Three columns going down, whatever the column measures — the owner's
       arrangement, not a shape that survives only at one width. */
    expect(state.bossColumns, `the boss table lays out ${state.bossColumns} columns ${at}`).toBe(3);
    expect(state.bossRows, `the boss table lost rows ${at}`).toBe(Math.ceil(state.bossCells / 3));
    expect(state.tiles, `the usage tiles disappeared ${at}`).toBeGreaterThan(0);
    expect(state.strips, `the heatmap strips disappeared ${at}`).toBeGreaterThan(0);
    expect(state.navLinks, `the nav lost links ${at}`).toBeGreaterThan(2);
    expect(state.sections, `the page lost a section ${at}`).toBeGreaterThan(2);
    /* The pictures still reserve the box they will fill, and since
       2026-08-28 that box is a SQUARE stage rather than the feed card's 16:9
       media frame (owner: the drawings are portrait scans, and a wide frame
       cropped them). Squareness is the property under test at every column
       width: whatever the track does, the stage keeps its ratio and stops
       at its own ceiling, so a narrow column shrinks the work rather than
       distorting it and a wide one stops growing instead of reproducing the
       complaint the cap exists to fix. galleryStageCapPx is the literal cap
       value, never the page's own computed style (see its declaration for
       why) — this is what makes the assertion below independent, rather
       than the self-referential shape Daybreak Blue's review of PR #161
       found: a mutation that widened the token could no longer widen its own
       expectation along with it.
       (This viewport is the narrow "rails" one the handle needs to exist at
       all — MEASURED: even the widest column this sweep can reach keeps the
       stage's track under ~570px, so the cap engages here only at the wider
       end. The unambiguous "the cap is doing real work, not coincidentally
       equal to the track" proof lives in the dedicated single-frame test
       above instead, at a viewport wide enough to make that margin real.) */
    expect(state.frames.length, `the gallery rendered no frame ${at}`).toBe(1);
    for (const frame of state.frames) {
      expect(
        frame.height,
        `the gallery stage is ${frame.width.toFixed(1)}x${frame.height.toFixed(1)} ${at}, not square`
      ).toBeCloseTo(frame.width, 0);
      expect(
        frame.width,
        `the gallery stage grew to ${frame.width.toFixed(1)}px ${at}, past its ${galleryStageCapPx}px ceiling`
      ).toBeLessThanOrEqual(galleryStageCapPx + subPixel);
      expect(frame.width, `the gallery stage reserves nothing ${at}`).toBeGreaterThan(0);
    }
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

// SUPERSEDED (owner directive, issue 168). This lane used to REQUIRE the
// popover to fit inside whatever the reader had dragged the column down to,
// because the header used to take the column's own width and the popover
// hangs off the header. That coupling is exactly what issue 168 removed: the
// header pins to the viewport corner now, independent of the column
// entirely, so the correct claim inverts — narrowing the column to its
// minimum must move the popover NOT AT ALL, never merely "fit" inside it.
test('the reading-mode popover is unaffected by the column, even at its narrowest (issue 168)', async ({
  page
}) => {
  await page.setViewportSize({ width: railsBreakpointPx, height: 900 });

  await visit(page);
  await openedAndStill(page);
  const shipped = await page.evaluate(() => {
    const menu = window.document.querySelector('#reading-mode-menu');
    const box = menu.getBoundingClientRect();
    // Raw floats on purpose, and taken AT REST. Issue #194 recorded this as a
    // ±1 px cross-load flake on three engines and attributed it to
    // font-metric timing; that diagnosis was wrong, and the tolerance it
    // bought was a band-aid over a four-pixel noise source. The popover
    // reveals with a 120ms `translateY(-0.25rem)` slide, and
    // openReadingModes returns the instant the box is VISIBLE — so both
    // readings were samples of a box still travelling, and the "shift"
    // between them was nothing but two different points on that slide.
    // MEASURED in WebKit: top reads 64 at animation time 8ms, 65.65 at 25ms,
    // 67.56 at 87ms and 68 once it finishes (2026-08-27); the CI failure that
    // sent this back read 64.59 against 66.04, both inside that same 4px
    // travel. openedAndStill waits on the engine's own animation set, which
    // is what the two lanes above this one already do, so the reading below
    // is the settled position rather than a race — and `animating` proves it
    // was, because a measurement taken mid-slide is the defect itself.
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      animating: menu.getAnimations().length
    };
  });
  expect(shipped.animating, 'the shipped popover was measured mid-reveal').toBe(0);

  // A fresh visit rather than closing and reopening the first one: the
  // column-width override below must apply before the popover ever opens,
  // and a fresh load is also what keeps this test from depending on how the
  // disclosure happens to dismiss.
  await visit(page);
  await expect(handles(page)).toHaveCount(2);
  await page.evaluate(() => {
    window.document.documentElement.style.setProperty(
      '--page-column-width',
      getComputedStyle(window.document.documentElement).getPropertyValue('--page-column-min').trim()
    );
  });
  await settled(page);
  const column = await columnBox(page);
  expect(column.width, 'the column did not reach its minimum').toBeLessThan(300);

  await openedAndStill(page);
  const observed = await page.evaluate(() => {
    const menu = window.document.querySelector('#reading-mode-menu');
    const box = menu.getBoundingClientRect();
    const root = window.document.documentElement;
    return {
      popover: { left: box.left, right: box.right, top: box.top },
      animating: menu.getAnimations().length,
      swatches: window.document.querySelectorAll('#reading-mode-menu button').length,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth
    };
  });

  expect(observed.animating, 'the narrowed popover was measured mid-reveal').toBe(0);
  expect(observed.swatches, 'the reading modes lost a swatch at the narrowest column').toBe(5);
  for (const edge of ['left', 'right', 'top']) {
    // The allowance stays at one CSS pixel: it is now a genuine sub-pixel
    // rounding margin over two settled readings rather than cover for a
    // moving box, and it is not widened by a hair. A popover actually
    // coupled to the column moves by hundreds.
    expect(
      Math.abs(observed.popover[edge] - shipped[edge]),
      `narrowing the column moved the popover ${edge} from ${shipped[edge]} to ` +
        `${observed.popover[edge]}; it is meant to be independent of the column ` +
        'now (issue 168; one CSS pixel of settled rounding allowed, issue #194)'
    ).toBeLessThanOrEqual(1);
  }
  expect(observed.scrollWidth).toBe(observed.clientWidth);
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

/* The card-body surfaces the ruling covers, by the class the page gives them.
 * A summary paragraph and a bullet list — the blocks that used to read the
 * 42rem measure. */
const filledCardBodies = ['.entry-summary', '.entry-points'];

/* The widths this rule is measured at, and why they are COLUMN values rather
 * than only viewport ones. The page column is a fixed 60rem token, so a 1440px
 * and a 1920px viewport lay out the identical 960px column and the identical
 * 934px card — measuring both proves the fill is viewport-independent and
 * nothing else. The axis that genuinely changes a card's width is the reader's
 * own column drag, so the sweep drives that token directly, exactly as the
 * strip lane above drives it: the shipped default, and the 100rem ceiling,
 * where a re-introduced cap would leave the widest dead band this page can
 * produce (measured: 902px of a 1574px card). */
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
          if (rects.length > 0) runs.push(rects);
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
    for (const card of window.document.querySelectorAll('.feed-card')) {
      const edge = contentEnd(card);
      for (const selector of selectors) {
        for (const block of card.querySelectorAll(selector)) {
          const runs = textRuns(block);
          /* The line boxes that PROVE a width: every line of a wrapped run
             except its last. A last line is as long as the sentence ran out —
             a layout tells you nothing there — but a line the engine chose to
             BREAK was broken because the next word did not fit, so it stands
             within one word of the width actually available. */
          const broken = runs.flatMap((rects) => rects.slice(0, -1));
          rows.push({
            selector,
            card: Math.round(card.getBoundingClientRect().width),
            short: edge - block.getBoundingClientRect().right,
            runs: runs.length,
            broken: broken.length,
            /* The WORST of them: the broken line that stops furthest from the
               card's edge. */
            ink: broken.length === 0 ? 0 : Math.max(...broken.map((rect) => edge - rect.right)),
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
    /* THE RULE. The block's own box ends ON the card's content edge: the
       card's padding is the only thing between its text and its border, and
       nothing narrows it further. Before the ruling this read 262.0px short for
       .entry-points and 270.0px for .entry-summary. */
    expect(
      row.short,
      `${row.selector} stops ${row.short.toFixed(1)}px short of the card's content edge at ${where} (${((row.short / row.card) * 100).toFixed(1)}% of the card left blank)`
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
        `a line inside ${row.selector} was broken ${row.ink.toFixed(1)}px short of a ${row.card}px card at ${where}; the box fills but the text does not`
      ).toBeLessThan(row.card / 3);
    }
  }
}

test('card text fills the card and stops at its padding, never two thirds of the way across (issue 212)', async ({
  page,
}) => {
  await visit(page);
  for (const width of desktopWidths) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    expectCardsFilled(await measureCardFill(page), `a ${width}px viewport`);
  }
  /* The reader's own column, across its range. This is the axis the viewport
     loop above cannot reach: both of those widths resolve to the same 60rem
     column, so without this the rule would only ever have been measured at one
     card width. */
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

/* Scoped to a GRID's readout, never any readout on the page. The stat tracker
 * mounts the same primitive per tile, so an unscoped query would report a
 * stat tile's card as though a heatmap had answered — a dismissal tap landing
 * on one is enough to make the whole assertion vacuous, which is exactly what
 * it did on WebKit before this scope existed. */
async function readoutState(page) {
  return page.evaluate(() => {
    const tip = window.document.querySelector('.grid-block .cell-tip[data-tip-open="true"]');
    const selected = window.document.querySelector('.grid-cell[data-grid-selected="true"]');
    return {
      open: tip !== null,
      text: tip === null ? null : tip.innerText.replace(/\s+/g, ' ').trim(),
      selectedIndex: selected === null ? null : selected.dataset.gridIndex,
      ringWidth: selected === null ? null : window.getComputedStyle(selected).outlineWidth,
    };
  });
}

/* DEFECT 1. The token grid answered a tap with nothing. The cause was not the
 * touch handling — which always worked — but that 96% of its cells carried no
 * detail to open: ContributionGrid gated the shared card behind
 * `cardTitle && !cell.absent`, and the contribution calendar, passing no
 * cardTitle at all, carried one on NONE of its 371 cells. Everything else fell
 * back to the browser's `title=`, which has no touch trigger in any engine.
 *
 * A heatmap encodes magnitude as a colour shade, so a cell nobody can
 * interrogate breaks AGENTS.md's dataviz floor — "a value is never encoded by
 * color alone" — on every touch device. This lane measures the repair on EVERY
 * grid, because the defect was an asymmetry between two consumers of one
 * component and a fix that reached only the reported one would be the same
 * bug with a different victim. */
test('every grid answers a tap with a real readout, on every engine (issue 219)', async ({
  page,
  isMobile,
}) => {
  await visit(page);

  const strips = page.locator('.grid-strip[role="listbox"]');
  const count = await strips.count();
  expect(count, 'the page rendered no interrogable grid at all').toBeGreaterThan(0);

  // No grid cell may carry the browser tooltip any more: it is the attribute
  // that had no touch trigger, and its absence is the fix.
  expect(
    await page.locator('.grid-cell[title]').count(),
    'a grid cell still carries the browser tooltip, which no finger can open',
  ).toBe(0);

  // Every cell is a real option with an accessible name, absent ones included.
  const cells = await page.evaluate(() => {
    const all = [...window.document.querySelectorAll('.grid-strip[role="listbox"] .grid-cell')];
    return {
      total: all.length,
      options: all.filter((cell) => cell.getAttribute('role') === 'option').length,
      named: all.filter((cell) => (cell.getAttribute('aria-label') ?? '').length > 0).length,
      absent: all.filter((cell) => cell.dataset.gridAbsent === 'true').length,
    };
  });
  expect(cells.total).toBeGreaterThan(0);
  expect(cells.options, 'a grid cell is not a selectable option').toBe(cells.total);
  expect(cells.named, 'a grid cell carries no accessible reading').toBe(cells.total);
  // The absent cells are the ones the old gate silenced, so their presence is
  // what makes this measurement about the actual defect.
  expect(cells.absent, 'no absent cells on the page; this lane proves less than it claims').toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const strip = strips.nth(index);
    await strip.scrollIntoViewIfNeeded();
    const box = await strip.boundingBox();
    // Deliberately NOT a cell centre. A cell is 10px and a finger is 44px, so
    // the interaction only works if the strip resolves the nearest cell to
    // wherever the touch actually landed — including on the gap between two.
    await tapAt(page, box.x + box.width / 2 + 3, box.y + box.height / 2 - 7);
    const state = await readoutState(page);
    expect(state.open, `grid ${index} answered a tap with no readout`).toBe(true);
    expect(state.text, `grid ${index} opened an empty readout`).not.toBe('');
    expect(state.selectedIndex, `grid ${index} opened a readout with no cell selected`).not.toBeNull();
    // The ring the owner described seeing on the grid that worked. It is a
    // real computed outline, not a class we hope resolves.
    expect(
      Number.parseFloat(state.ringWidth),
      `grid ${index} selected a cell without marking it`,
    ).toBeGreaterThan(0);
    // Dismiss, and prove the dismissal is real: a ring left behind is a page
    // claiming a selection it no longer has.
    await tapAt(page, 5, Math.max(5, box.y - 60));
    const after = await readoutState(page);
    expect(after.selectedIndex, `grid ${index} left a cell marked after dismissal`).toBeNull();
  }

  // An ABSENT cell reads honestly rather than as a fabricated zero — the
  // panels contract's rule, applied to the cell that used to say nothing.
  const absentReading = await page.evaluate(() => {
    const cell = window.document.querySelector(
      '.grid-strip[role="listbox"] .grid-cell[data-grid-absent="true"]',
    );
    return cell === null ? null : cell.getAttribute('aria-label');
  });
  expect(absentReading).toBe('no data for this day');

  // The keyboard reaches the identical readout. A gesture-only affordance is
  // a defect, so this is the same assertion from the other side.
  await page.evaluate(() => {
    window.document.querySelector('.grid-strip[role="listbox"]').focus();
  });
  /* Home first, so the cursor starts at a KNOWN end with the whole window in
     front of it. Starting from nothing selected puts it at the newest cell,
     where a further step backwards can land on the boundary and legitimately
     refuse to move — which would make the movement assertion below read as a
     failure of the arrows rather than of the test's choice of direction. */
  /* The poll PRESSES the key, rather than pressing once and then waiting for
     the consequence. That is not belt-and-braces: a panel whose data arrives
     while the reader is on the grid changes `columns`, and
     ContributionGrid.svelte deliberately drops the selection when it does —
     keeping the index would silently re-point the readout at a different day.
     So a single press followed by a wait is a measurement racing a reset it
     can never recover from, and it was measured failing exactly that way on
     WebKit under full-matrix worker contention (2026-08-27) while passing
     3/3 when the test ran alone. Re-pressing is also what a reader does.
     `Home` is idempotent — it is always the first dated cell — so repeating it
     asserts the same thing each time rather than drifting.
     Both halves are read together because they land on independent clocks:
     `aria-activedescendant` is a derived attribute Svelte writes on its own
     effect flush, while the card's `data-tip-open` is written by
     lib/tooltip.ts when the binding re-anchors, and waiting for either alone
     just moves which assertion loses the race.
     This does not make the assertion below decorative, because the thing
     asserted is not the thing polled: the poll can only establish that a
     cursor and a card both EXIST, and what is checked afterwards is that the
     cursor names the cell the grid actually marked — agreement no amount of
     waiting can manufacture. Mutating the cursor to name a fixed cell turns
     that assertion red while this poll still passes. */
  const keyboardCursor = async () => {
    await page.keyboard.press('Home');
    return page.evaluate(() => {
      const strip = window.document.querySelector('.grid-strip[role="listbox"]');
      const tip = window.document.querySelector('.grid-block .cell-tip[data-tip-open="true"]');
      const active = strip === null ? null : strip.getAttribute('aria-activedescendant');
      return tip !== null && active !== null && active.length > 0;
    });
  };
  await expect
    .poll(keyboardCursor, {
      message: 'the keyboard opened no readout, or moved a cursor no assistive technology can hear',
      timeout: 10_000,
    })
    .toBe(true);
  const byKeyboard = await readoutState(page);
  const active = await page.evaluate(() =>
    window.document.querySelector('.grid-strip[role="listbox"]').getAttribute('aria-activedescendant'),
  );
  expect(active).toBe(`${await page.evaluate(() => window.document.querySelector('.grid-cell[data-grid-selected="true"]').id)}`);

  /* ...and the arrows MOVE it, rather than opening the same cell forever.
     Written as "landed on a real cell that is not the one Home chose" rather
     than as a bare inequality, because the reset described above turns
     selectedIndex into null and a bare `.not.toBe(firstCell)` is SATISFIED by
     null — the arrow keys could stop working entirely and this would still
     pass. Requiring a genuine index closes that, and pressing inside the poll
     recovers from a reset instead of racing it. */
  const firstCell = byKeyboard.selectedIndex;
  await expect
    .poll(
      async () => {
        await page.keyboard.press('ArrowRight');
        const { selectedIndex } = await readoutState(page);
        return selectedIndex !== null && selectedIndex !== firstCell;
      },
      {
        message: 'the arrow keys do not move the cursor to another cell',
        timeout: 10_000,
      },
    )
    .toBe(true);

  expect(isMobile === undefined || typeof isMobile === 'boolean').toBe(true);
});

/* DEFECT 1, WHAT CI FOUND IN THE FIX ITSELF. Two product defects the lane
 * above reported only as a ten-second timeout — which names neither of them —
 * pinned here directly. Both were measured in WebKit on 2026-08-27 and both
 * are reachable by a reader who never opens a browser console.
 *
 * A: A PAGE SCROLL WIPED THE KEYBOARD CURSOR. The readout closed on any
 * movement of the cell it was anchored to, and closing carried the caller's
 * selection with it — so the ring and the aria-activedescendant a screen
 * reader follows both disappeared because the reader scrolled. It bit the
 * plainest path there is: focusing the strip opens the readout synchronously
 * while the browser's own scroll-into-view for that same focus lands a frame
 * later, so simply TABBING to the grid produced a readout that closed itself.
 *
 * B: HALF THE ARROW KEYS WERE DEAD. With no cursor, ArrowRight and ArrowDown
 * stepped past the end of the cell list, hit the range guard and did nothing —
 * for ever, since nothing they could do would give them the cursor they
 * needed. ArrowLeft and ArrowUp worked, which is what made it invisible.
 * Measured: five ArrowRight presses and two ArrowDown presses moving nothing
 * while ArrowLeft moved normally.
 *
 * Deliberately scrolled into view BEFORE focusing, so A is measured as its own
 * hand-made scroll rather than as the focus race — the race is what made the
 * defect intermittent, and a pin that reproduces it only by racing is a pin
 * that reports nothing on the runs it wins. */
test('the keyboard cursor survives a scroll, and every arrow opens a cold strip (issue 219)', async ({
  page,
}) => {
  await visit(page);
  const strip = page.locator('.grid-strip[role="listbox"]').first();
  await strip.scrollIntoViewIfNeeded();
  await settled(page);
  await strip.evaluate((node) => node.focus());
  await page.keyboard.press('Home');
  const opened = await readoutState(page);
  expect(opened.open, 'the keyboard opened no readout at all').toBe(true);
  expect(opened.selectedIndex, 'the keyboard marked no cell').not.toBeNull();

  /* A: forty pixels by hand, then read. The wait is the engine's, not a
     duration: a scroll event is delivered at a rendering opportunity, so a
     reading taken in the same tick would pass against a page that had not
     yet told anybody it moved. */
  const before = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => window.scrollBy(0, 40));
  await expect
    .poll(async () => page.evaluate(() => window.scrollY), {
      message: 'the page never scrolled, so this lane proves nothing about scrolling',
      timeout: 5_000,
    })
    .toBeGreaterThan(before);
  await page.waitForTimeout(120);
  const scrolled = await readoutState(page);
  expect(scrolled.selectedIndex, 'a page scroll wiped the keyboard cursor').toBe(
    opened.selectedIndex,
  );
  expect(scrolled.open, 'a page scroll closed the keyboard readout').toBe(true);
  expect(scrolled.text, 'the readout survived the scroll but says nothing').not.toBe('');
  const stillNamed = await page.evaluate(() => {
    const region = window.document.querySelector('.grid-strip[role="listbox"]');
    const active = region.getAttribute('aria-activedescendant');
    const marked = window.document.querySelector('.grid-cell[data-grid-selected="true"]');
    return marked !== null && active === marked.id;
  });
  expect(stillNamed, 'the scroll left the cursor and the marked cell disagreeing').toBe(true);

  /* Following a cell is not following it off the screen. A card clamped to a
     viewport edge describing a cell nobody can see is the stale readout the
     whole guard exists to prevent, so the readout still closes once its cell
     has scrolled out of the viewport's block extent — and this measures that
     boundary rather than assuming it, which is what keeps the guard from
     being decorative. */
  await page.evaluate(() => {
    const cell = window.document.querySelector('.grid-cell[data-grid-selected="true"]');
    window.scrollBy(0, cell.getBoundingClientRect().bottom + 20);
  });
  await expect
    .poll(async () => (await readoutState(page)).open, {
      message: 'the readout followed its cell right off the screen',
      timeout: 5_000,
    })
    .toBe(false);
  const gone = await readoutState(page);
  expect(gone.selectedIndex, 'a ring stayed painted on a cell whose readout had closed').toBeNull();

  await strip.scrollIntoViewIfNeeded();
  await settled(page);
  await strip.evaluate((node) => node.focus());

  /* B: Escape puts the strip back to genuinely no cursor — the state the
     dead keys could never leave — and then EVERY arrow must open it. Each
     one is checked from that same cold state, so a fix that only reached the
     axis CI happened to press would still fail here. */
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    await page.keyboard.press('Escape');
    const cleared = await readoutState(page);
    expect(cleared.selectedIndex, 'Escape left a cell marked').toBeNull();
    await page.keyboard.press(key);
    const woken = await readoutState(page);
    expect(woken.selectedIndex, `${key} on a strip with no cursor moved nothing`).not.toBeNull();
    expect(woken.open, `${key} marked a cell without opening its readout`).toBe(true);
  }
});

/* Reads the keyboard cursor AND the scrollport it is supposed to be inside,
 * scoped to one strip so three grids on a page cannot answer for each other. */
async function cursorInPort(page) {
  return page.evaluate(() => {
    const region = window.document.querySelector('.grid-strip[role="listbox"]');
    const marked = region.querySelector('.grid-cell[data-grid-selected="true"]');
    const tip = window.document.querySelector('.grid-block .cell-tip[data-tip-open="true"]');
    const port = region.getBoundingClientRect();
    const cell = marked === null ? null : marked.getBoundingClientRect();
    return {
      active: region.getAttribute('aria-activedescendant'),
      marked: marked === null ? null : marked.id,
      scrollLeft: region.scrollLeft,
      port: { left: port.left, right: port.right },
      cell: cell === null ? null : { left: cell.left, right: cell.right },
      /* Wholly inside, not merely touching: the whole point of the repair is
         that a reader can SEE the cell their cursor names. */
      visible: cell === null ? false : cell.left >= port.left && cell.right <= port.right,
      open: tip !== null,
      text: tip === null ? null : tip.innerText.replace(/\s+/g, ' ').trim(),
    };
  });
}

/* THE PAIR (issue 219, review round 2). Findings 1 and 2 are one lane because
 * they are one repair, and adding either alone is a regression:
 *
 * 1. THE KEYBOARD LOST THE STRIP'S PAN AND GAINED NO CURSOR IT COULD SEE.
 *    The strip is `tabindex="0"` over an overflowing box, so before this
 *    feature the arrows panned it natively. The cursor handler swallows them
 *    — correctly, or a cursor stepping off the end becomes a page scroll —
 *    and nothing scrolled the cursor into view, so the pan was simply taken
 *    away. MEASURED at 390x844 in Chromium and WebKit alike: focusing the
 *    strip marked a cell at x -11 against a strip starting at 51, `Home`
 *    marked one at -323, and twelve ArrowRight presses left `scrollLeft` at
 *    374 every single time. WCAG 2.1.1 and the ARIA listbox pattern both put
 *    scrolling the active descendant into view on the author.
 *
 * 2. A READOUT PANNED OUT OF ITS OWN STRIP STAYED OPEN. The re-anchor repair
 *    asked only the viewport's BLOCK extent, so panning the strip inline
 *    re-anchored a card onto a cell that had left the port: cursor on the
 *    newest cell via `End`, then `scrollLeft = 0`, and the card, the ring and
 *    aria-activedescendant all kept naming a cell 364px past the strip's
 *    right edge.
 *
 * Fixing 2 alone would close the readout on `Home`, because before fix 1 the
 * cursor legitimately sat outside the port; fixing 1 alone leaves the stale
 * card. So both, and one lane that fails if either regresses. */
test('the keyboard cursor is scrolled into its own strip, and a readout panned out of it closes (issue 219)', async ({
  page,
}) => {
  await visit(page);
  /* A phone width deliberately: a year of columns fits a desktop column, so a
     1280px lane would measure a strip with nothing to pan and prove nothing
     at all about the axis this lane is about. */
  await page.setViewportSize({ width: 390, height: 844 });
  await settled(page);

  const strip = page.locator('.grid-strip[role="listbox"]').first();
  await strip.scrollIntoViewIfNeeded();
  await settled(page);

  const overflow = await strip.evaluate((node) => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
    scrollLeft: node.scrollLeft,
  }));
  expect(
    overflow.scrollWidth,
    'the strip has nothing to pan; this lane proves nothing about a cursor leaving it',
  ).toBeGreaterThan(overflow.clientWidth);
  // And it opens on its NEWEST column, which is what puts the other end of
  // the window outside the port and makes the question real.
  expect(
    overflow.scrollLeft,
    'the strip did not open scrolled to its newest column; the far end is already in view',
  ).toBeGreaterThan(0);

  // A tab into the strip must name a cell the reader can see, not whichever
  // one happens to sit at the viewport's origin.
  await strip.evaluate((node) => node.focus());
  const entered = await cursorInPort(page);
  expect(entered.marked, 'focusing the strip marked no cell at all').not.toBeNull();
  expect(
    entered.visible,
    `focus marked a cell at ${Math.round(entered.cell.left)}–${Math.round(entered.cell.right)}, outside the strip's ${Math.round(entered.port.left)}–${Math.round(entered.port.right)}`,
  ).toBe(true);
  expect(entered.active, 'the cursor and the marked cell disagree').toBe(entered.marked);
  expect(entered.open, 'focusing the strip opened no readout').toBe(true);

  /* Home is the measurement that matters, because it names the far end of a
     window the strip opened scrolled away from: the cell is 323px outside the
     port before anything scrolls, so the assertion cannot be satisfied by a
     cursor that happened to be in view already. */
  await page.keyboard.press('Home');
  const home = await cursorInPort(page);
  expect(home.scrollLeft, 'Home did not pan the strip at all').toBeLessThan(entered.scrollLeft);
  expect(
    home.visible,
    `Home marked a cell at ${Math.round(home.cell.left)}–${Math.round(home.cell.right)}, outside the strip's ${Math.round(home.port.left)}–${Math.round(home.port.right)}`,
  ).toBe(true);
  expect(home.open, 'Home closed the readout').toBe(true);

  /* Then walk a whole window's worth of columns with the arrow that used to
     move a cursor and never the strip. Every step is checked, so a repair
     that scrolls only on the jumps is not enough. */
  let previous = home;
  let panned = 0;
  for (let press = 0; press < 30; press += 1) {
    await page.keyboard.press('ArrowRight');
    const step = await cursorInPort(page);
    expect(
      step.visible,
      `ArrowRight #${press + 1} left the cursor at ${Math.round(step.cell?.left)}–${Math.round(step.cell?.right)}, outside the strip's ${Math.round(step.port.left)}–${Math.round(step.port.right)}`,
    ).toBe(true);
    expect(step.active, `ArrowRight #${press + 1} left the cursor and the mark disagreeing`).toBe(
      step.marked,
    );
    if (step.scrollLeft !== previous.scrollLeft) {
      panned += 1;
    }
    previous = step;
  }
  expect(
    panned,
    'thirty arrow presses never moved the strip; the cursor is not driving the pan',
  ).toBeGreaterThan(0);

  // End, the other jump, from the other side of the window.
  await page.keyboard.press('End');
  const end = await cursorInPort(page);
  expect(end.visible, 'End marked a cell outside the strip').toBe(true);
  expect(end.open, 'End closed the readout').toBe(true);

  /* FINDING 2. The cursor is now on the newest cell and the strip is scrolled
     to it. Pan the STRIP — not the page, which is what the lane beside this
     one does and why it could not see this — and the card must go with it.
     A card clamped to an edge naming a cell 364px outside the port is the
     stale readout the whole guard exists to prevent. */
  await strip.evaluate((node) => {
    node.scrollLeft = 0;
  });
  await expect
    .poll(async () => (await cursorInPort(page)).open, {
      message: 'the readout kept naming a cell panned clean out of its own strip',
      timeout: 5_000,
    })
    .toBe(false);
  const stale = await cursorInPort(page);
  expect(stale.marked, 'a ring stayed painted on a cell panned out of the strip').toBeNull();
  expect(stale.active, 'aria-activedescendant still names a cell nobody can see').toBeNull();
});

/* The same repair asked the question a reduced-motion reader asks. A cursor
 * step is not a journey: bringing it into view is instant in EVERY reading
 * mode, so there is no animation for the preference to have to switch off.
 * Measured as behaviour rather than as a declaration — one frame after the
 * press, the cell is already fully inside the port, which a 300px smooth
 * scroll could not be. */
test('bringing the cursor into view is instant, whatever motion the reader asked for (issue 219)', async ({
  page,
}) => {
  for (const reducedMotion of ['reduce', 'no-preference']) {
    await page.emulateMedia({ reducedMotion });
    await visit(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await settled(page);
    const strip = page.locator('.grid-strip[role="listbox"]').first();
    await strip.scrollIntoViewIfNeeded();
    await settled(page);
    await strip.evaluate((node) => node.focus());
    const before = await cursorInPort(page);
    await page.keyboard.press('Home');
    // Exactly one frame, not a settle: an animated scroll is still travelling.
    await page.evaluate(() => new Promise((resolve) => window.requestAnimationFrame(resolve)));
    const after = await cursorInPort(page);
    expect(
      after.scrollLeft,
      `under ${reducedMotion} the strip had not finished panning one frame after the press`,
    ).toBeLessThan(before.scrollLeft);
    expect(
      after.visible,
      `under ${reducedMotion} the cursor was still outside the strip one frame after the press`,
    ).toBe(true);
  }
  await page.emulateMedia({ reducedMotion: null });
});

/* Finding 6. THE REFRESH THIS PR ADDED DESTROYED THE CURSOR. `columns` is
 * rebuilt by every delivery, and the component dropped the selection on any
 * change of that array's identity — so pressing this PR's own refresh control
 * removed the ring, the readout and the aria-activedescendant a screen reader
 * was following. MEASURED at 390x844: cursor on the newest cell with the card
 * open, press the control, and all three were gone.
 *
 * The cursor names a DAY, and a refresh that returns the same window still
 * contains it. */
test('a refresh keeps the keyboard cursor on the day it named (issue 219)', async ({ page }) => {
  await visit(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await settled(page);
  const strip = page.locator('.grid-strip[role="listbox"]').first();
  await strip.scrollIntoViewIfNeeded();
  await settled(page);
  await strip.evaluate((node) => node.focus());
  await page.keyboard.press('End');
  const before = await cursorInPort(page);
  expect(before.marked, 'the keyboard marked no cell to begin with').not.toBeNull();
  expect(before.open, 'the keyboard opened no readout to begin with').toBe(true);

  /* Watched rather than sampled afterwards. The page's travel attribute is
     written and removed inside the refresh, so reading it once at the end
     measures a state that has already gone — an assertion that cannot fail is
     no assertion. A mutation record for that attribute exists ONLY if it was
     added at some point (removing an absent attribute records nothing), which
     makes "the press never displaced the page" a fact about the whole
     interval rather than about one instant in it. */
  await page.evaluate(() => {
    window.__displaced = false;
    window.__watch = new MutationObserver((records) => {
      for (const record of records) {
        if (record.attributeName === 'data-pulling') {
          window.__displaced = true;
        }
      }
    });
    window.__watch.observe(window.document.documentElement, {
      attributes: true,
      attributeFilter: ['data-pulling'],
    });
  });

  /* The refresh is triggered WITHOUT moving focus, and that is the honest
     shape of the defect rather than a convenience. A payload delivery has
     nothing to do with where focus is: the per-panel minute loop, the
     visibility catch-up and this PR's own pull gesture all rebuild `columns`
     while a reader sits on the grid, and every one of them dropped the
     cursor. Focusing the control and pressing Enter would measure something
     else entirely — leaving the strip blurs it, and a blur closing the
     readout is correct and separately asserted below. `.click()` runs the
     shipping handler and moves focus nowhere, which isolates the delivery. */
  await page.evaluate(() => {
    window.document.querySelector('.pull-control').click();
  });
  await expect
    .poll(
      async () =>
        page.evaluate(() => window.document.querySelector('.pull-indicator').dataset.pullPhase),
      { message: 'the refresh never completed', timeout: 10_000 },
    )
    .toBe('idle');

  const after = await cursorInPort(page);
  expect(after.marked, 'the refresh wiped the keyboard cursor').toBe(before.marked);
  expect(after.active, 'the refresh wiped aria-activedescendant').toBe(before.active);
  expect(after.open, 'the refresh closed the readout').toBe(true);
  expect(after.text, 'the refresh left the readout describing something else').toBe(before.text);
  /* And the page was never displaced by a press: a keyboard reader dragged
     nothing, so <main> must not become a containing block for its 101 fixed
     descendants on their behalf — not at the end of the refresh, and not for
     a single frame in the middle of it. */
  const displaced = await page.evaluate(() => {
    window.__watch.disconnect();
    return window.__displaced;
  });
  expect(displaced, 'pressing the refresh control displaced the page column').toBe(false);
  expect(
    await page.evaluate(() => window.getComputedStyle(window.document.querySelector('main')).transform),
    'the page column was left transformed after a refresh',
  ).toBe('none');

  /* And the cursor is still the READOUT'S to close when focus genuinely
     leaves, which is the guarantee this repair must not have traded away: a
     ring painted on a cell whose card has closed is a page claiming a
     selection it does not have. */
  await page.evaluate(() => {
    window.document.querySelector('.grid-strip[role="listbox"]').blur();
  });
  await expect
    .poll(async () => (await cursorInPort(page)).open, {
      message: 'the readout outlived the focus that opened it',
      timeout: 5_000,
    })
    .toBe(false);
  expect(
    (await cursorInPort(page)).marked,
    'a ring stayed painted after the readout closed',
  ).toBeNull();
});

/* Finding 9. A listbox may own only options and groups. Every `role="option"`
 * here is a child of the layout div the cells are placed on, so without a
 * presentational role on that div the listbox owns nothing at all. */
test('the grid listbox owns its options directly (issue 219)', async ({ page }) => {
  await visit(page);
  const owned = await page.evaluate(() => {
    const region = window.document.querySelector('.grid-strip[role="listbox"]');
    const roleOf = (node) => node.getAttribute('role');
    return {
      children: [...region.children].map(roleOf),
      options: region.querySelectorAll('[role="option"]').length,
      orphans: [...region.querySelectorAll('[role="option"]')].filter((option) => {
        for (let node = option.parentElement; node !== null && node !== region; node = node.parentElement) {
          const role = roleOf(node);
          if (role !== 'presentation' && role !== 'none' && role !== 'group') {
            return true;
          }
        }
        return false;
      }).length,
    };
  });
  expect(owned.options, 'the listbox holds no options; this lane proves nothing').toBeGreaterThan(0);
  expect(
    owned.orphans,
    'an option sits inside an element the listbox may not own; ARIA admits only option and group',
  ).toBe(0);
});

/* DEFECT 1, second half: the strip's own horizontal pan is the BROWSER'S, and
 * must stay that way. This is the "never fight native scrolling" rule measured
 * rather than asserted — a touch-action of anything but auto here would mean
 * the gesture layer had taken a scroll that was never its to take. */
test('a wide grid still pans natively, and never takes the page sideways (issue 219)', async ({
  page,
}) => {
  await visit(page);
  /* Narrowed deliberately: a year of columns fits a desktop column, so a
     1280px lane would measure a strip with nothing to pan and pass without
     proving anything. A phone width is where the overflow — and therefore the
     gesture question — actually exists. */
  await page.setViewportSize({ width: 390, height: 844 });
  await settled(page);
  const pan = await page.evaluate(() => {
    const strip = window.document.querySelector('.grid-strip');
    const before = strip.scrollLeft;
    strip.scrollLeft = Math.max(0, before - 120);
    return {
      touchAction: window.getComputedStyle(strip).touchAction,
      overflowX: window.getComputedStyle(strip).overflowX,
      scrollable: strip.scrollWidth > strip.clientWidth,
      moved: strip.scrollLeft !== before,
      docScrollWidth: window.document.documentElement.scrollWidth,
      docClientWidth: window.document.documentElement.clientWidth,
    };
  });
  expect(pan.scrollable, 'the strip has nothing to pan; this lane proves nothing').toBe(true);
  expect(pan.touchAction, 'the grid strip stopped handing its pan to the browser').toBe('auto');
  expect(pan.overflowX).toBe('auto');
  expect(pan.moved).toBe(true);
  expect(pan.docScrollWidth, 'wide grid content took the page sideways').toBeLessThanOrEqual(
    pan.docClientWidth,
  );
});

/* DEFECT 2. Nothing was swipeable. The gallery shows one photograph and had
 * only two arrow buttons to move between them. */
test('the gallery advances on a swipe and settles back on a fidget (issue 219)', async ({
  page,
}) => {
  await visit(page);
  const stage = page.locator('.gallery-stage').first();
  await stage.scrollIntoViewIfNeeded();

  const counter = page.locator('.gallery-count').first();
  const readIndex = async () => (await counter.innerText()).trim();
  const start = await readIndex();

  const box = await stage.boundingBox();
  const midY = box.y + box.height / 2;

  // The vertical axis is the page's, unconditionally. This is the single
  // declaration the whole feature rests on.
  expect(
    await stage.evaluate((node) => window.getComputedStyle(node).touchAction),
    'the gallery stage stopped handing vertical panning to the page',
    /* `contain` rather than an exact match since issue 241: the declaration is
       now `pan-y pinch-zoom`, so a two-finger zoom on the artwork is no longer
       refused. What this half is about is unchanged and still fails on its
       own — losing pan-y would hand the page's vertical scrolling to the
       gesture layer, whatever else the value said. */
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
  await page.waitForTimeout(320);
  const advanced = await readIndex();
  expect(advanced, 'a leftward swipe did not advance the gallery').not.toBe(start);

  // A FIDGET — a few pixels, slowly — must put the surface back and change
  // nothing. This is the half that stops a carousel turning on every touch.
  // Slow AND short: 11px over 180ms clears neither the distance nor the
  // velocity test, which is exactly what a fidget is.
  const held = await readIndex();
  const from = box.x + box.width * 0.6;
  await drag([from, from - 4, from - 8, from - 11], 60);
  await page.waitForTimeout(320);
  expect(await readIndex(), 'a small slow drag turned the page anyway').toBe(held);

  // ...and the surface is back where it started, with no residual offset. A
  // gallery left displaced is the pull-to-refresh defect in another costume.
  const resting = await page.evaluate(() => {
    const button = window.document.querySelector('.gallery-image-button');
    const matrix = new DOMMatrixReadOnly(window.getComputedStyle(button).transform);
    return matrix.m41;
  });
  expect(Math.abs(resting), 'the gallery did not settle back to its resting position').toBeLessThan(1);
});

test('the gallery is reachable without a gesture, and says where it is (issue 219)', async ({
  page,
}) => {
  await visit(page);
  const counter = page.locator('.gallery-count').first();
  const dots = page.locator('.gallery-dot');
  const total = await dots.count();
  expect(total, 'the gallery offers no visible position affordance').toBeGreaterThan(1);

  // The position marks are real controls, at the touch floor on BOTH axes.
  for (let index = 0; index < total; index += 1) {
    const box = await dots.nth(index).boundingBox();
    expect(box.width + subPixel, `position dot ${index} is under the touch floor`).toBeGreaterThanOrEqual(
      touchFloorPx,
    );
    expect(box.height + subPixel, `position dot ${index} is under the touch floor`).toBeGreaterThanOrEqual(
      touchFloorPx,
    );
  }

  // The current position is never colour alone: the selected mark is also
  // LARGER, which is the dataviz floor applied to a control.
  const marks = await page.evaluate(() =>
    [...window.document.querySelectorAll('.gallery-dot')].map((dot) => ({
      selected: dot.getAttribute('aria-checked') === 'true',
      width: dot.querySelector('.gallery-dot-mark').getBoundingClientRect().width,
    })),
  );
  const current = marks.find((mark) => mark.selected);
  const other = marks.find((mark) => !mark.selected);
  expect(current, 'no position mark is marked current').toBeTruthy();
  expect(
    current.width,
    'the current position is distinguished by colour alone',
  ).toBeGreaterThan(other.width);

  // Pressing one navigates — the POINTER equivalent, exercised.
  const before = (await counter.innerText()).trim();
  await dots.nth(total - 1).click();
  await page.waitForTimeout(150);
  expect((await counter.innerText()).trim(), 'a position dot did not navigate').not.toBe(before);

  /* AND THE KEYBOARD ONE, WHICH A CLICK CANNOT PROVE (issue 219 review round
     2, finding 3). The click above bypasses `tabindex="-1"` entirely, so it
     passed against a widget where seven of eight dots were unreachable by
     keyboard and the eighth's handler was `index = at` with `at === index` —
     a no-op. A keyboard affordance is proven with keyboard events or it is
     not proven.
     The shape is a composite widget's: ONE tab stop, the arrows moving the
     choice and the focus together, Home and End at the ends. Each half is
     measured on the counter AND on where focus landed, because moving the
     selection without moving focus strands it on a control that has just
     become untabbable. */
  const roles = await page.evaluate(() => ({
    group: window.document.querySelector('.gallery-dots').getAttribute('role'),
    option: window.document.querySelector('.gallery-dot').getAttribute('role'),
    tabbable: [...window.document.querySelectorAll('.gallery-dot')].filter(
      (dot) => dot.getAttribute('tabindex') === '0',
    ).length,
  }));
  expect(roles.group, 'the dots are not announced as a single choice').toBe('radiogroup');
  expect(roles.option).toBe('radio');
  expect(roles.tabbable, 'a composite widget has exactly one tab stop').toBe(1);

  const dotState = () =>
    page.evaluate(() => {
      const all = [...window.document.querySelectorAll('.gallery-dot')];
      return {
        counter: window.document.querySelector('.gallery-count').innerText.trim(),
        checked: all.findIndex((dot) => dot.getAttribute('aria-checked') === 'true'),
        focused: all.indexOf(window.document.activeElement),
        tabbable: all.findIndex((dot) => dot.getAttribute('tabindex') === '0'),
      };
    });

  // Enter the group at its one tab stop, exactly as a keyboard reader does.
  await page.evaluate(() => {
    window.document.querySelector('.gallery-dot[tabindex="0"]').focus();
  });
  const entered = await dotState();
  expect(entered.focused, 'the one tab stop is not the checked dot').toBe(entered.checked);

  for (const [key, expected] of [
    ['ArrowRight', (at) => (at + 1) % total],
    ['ArrowDown', (at) => (at + 1) % total],
    ['ArrowLeft', (at) => (at - 1 + total) % total],
    ['ArrowUp', (at) => (at - 1 + total) % total],
    ['End', () => total - 1],
    ['Home', () => 0],
  ]) {
    const from = await dotState();
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
    const to = await dotState();
    const want = expected(from.checked);
    expect(to.checked, `${key} did not move the choice`).toBe(want);
    expect(to.focused, `${key} moved the choice but left focus behind`).toBe(want);
    expect(to.tabbable, `${key} left the tab stop on a dot that is no longer current`).toBe(want);
    /* The live region names the KIND as well as the position since issue 241
       — "Photograph 3 of 8" rather than "3 / 8" — because a bare ratio was the
       one announcement a reader got on a move and it said nothing about what
       they had landed on. The vendored set this lane drives is all stills, so
       the noun is stated here rather than derived, which is what keeps the
       assertion able to fail. */
    expect(to.counter, `${key} moved the dot but not the photograph`).toBe(
      `Photograph ${want + 1} of ${total}`
    );
  }

  // And so do the arrow keys on the frame itself.
  const frame = page.locator('.gallery-image-button').first();
  await frame.focus();
  const held = (await counter.innerText()).trim();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  expect((await counter.innerText()).trim(), 'the arrow keys do not drive the gallery').not.toBe(held);
});

/* Finding 4. A SWIPE ATE THE READER'S NEXT ACTIVATION. The frame is a button
 * and a drag across it ends in a click nobody meant, so a claimed drag
 * suppresses exactly one click — but a touch swipe past the platform's slop
 * produces NO click, and the suppression simply waited for whatever came
 * next. MEASURED in both engines at 390x844: swipe (counter 1/8 -> 2/8),
 * focus the frame, press a real Enter, and the lightbox did not open.
 *
 * Both halves are here, because the cheap repair is to stop suppressing at
 * all — which hands back the accidental click the suppression exists to
 * prevent. */
test('a swipe does not eat the next activation, and still eats its own click (issue 219)', async ({
  page,
}) => {
  await visit(page);
  const stage = page.locator('.gallery-stage').first();
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox();
  const midY = box.y + box.height / 2;
  const xs = [0.8, 0.7, 0.55, 0.4, 0.25].map((at) => box.x + box.width * at);
  const counter = page.locator('.gallery-count').first();
  const dialogOpen = () =>
    page.evaluate(() => window.document.querySelector('.gallery-lightbox').open);

  /* A hand. Playwright's touchscreen API offers only tap() and its mouse API
     cannot produce a touch pointer at all, so the HAND is synthesised and
     everything downstream of pointerdown is the shipping code path. */
  const drive = (pointerType, thenClickDetail) =>
    page.evaluate(
      ([offsets, y, kind, detail]) => {
        const node = window.document.querySelector('.gallery-stage');
        const button = window.document.querySelector('.gallery-image-button');
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
           suppression still works. */
        if (detail !== null) {
          button.dispatchEvent(new MouseEvent('click', { detail, bubbles: true, cancelable: true }));
        }
      },
      [xs, midY, pointerType, thenClickDetail],
    );

  const start = (await counter.innerText()).trim();
  await drive('touch', null);
  await page.waitForTimeout(320);
  expect((await counter.innerText()).trim(), 'the swipe did not turn the page').not.toBe(start);

  /* An ordinary press of the frame, after that swipe. A touch swipe produces
     no click, so the suppression the gesture armed was still waiting — and
     this is the press it ate. */
  await page.locator('.gallery-image-button').first().click();
  await page.waitForTimeout(250);
  expect(await dialogOpen(), 'a swipe ate the reader’s next press of the frame').toBe(true);
  await page.evaluate(() => window.document.querySelector('.gallery-lightbox').close());
  await page.waitForTimeout(200);

  // The same question from the keyboard, which is where it was measured: a
  // real Enter, after a real swipe.
  await drive('touch', null);
  await page.waitForTimeout(320);
  await page.locator('.gallery-image-button').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  expect(await dialogOpen(), 'a swipe ate the reader’s next keyboard activation').toBe(true);
  await page.evaluate(() => window.document.querySelector('.gallery-lightbox').close());
  await page.waitForTimeout(200);

  // ...and the suppression is not simply gone: a drag's own click, in the
  // task that ended it, must still be swallowed.
  await drive('mouse', 1);
  await page.waitForTimeout(200);
  expect(
    await dialogOpen(),
    'a drag’s own click reached the control; the accidental open is back',
  ).toBe(false);

  // While an ordinary click, after that gesture is over, still works — or the
  // assertion above would be satisfied by a control that never opens at all.
  await page.locator('.gallery-image-button').first().click();
  await page.waitForTimeout(250);
  expect(await dialogOpen(), 'the frame stopped opening on an ordinary click').toBe(true);
});

/* Finding 5. MODIFIER CHORDS ARE THE BROWSER'S AND THE PLATFORM'S. Both new
 * key handlers branched on `event.key` alone, so `Cmd+ArrowLeft` and
 * `Alt+ArrowLeft` (Back) and `Ctrl+Home` (top of document) were all swallowed:
 * measured `defaultPrevented === true` for every one of them on the grid strip
 * and on the token panel's segmented pills. */
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
       panel's display pills were the third until the owner deleted the menu
       on 2026-08-28; the two that remain are the ones a reader can still
       reach, and the sweep asserts below that each is genuinely present, so
       losing another one fails loudly rather than shrinking in silence. */
    const surfaces = {
      strip: window.document.querySelector('.grid-strip[role="listbox"]'),
      dots: window.document.querySelector('.gallery-dots[role="radiogroup"]'),
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

/* DEFECT 3. Pull-to-refresh. The browser's own was suppressed at issue 187
 * because its rubber-band overshoot left the document translated down and
 * never settled flush; that declaration stays, and this replacement owns its
 * own travel and its own settle.
 *
 * The honest limit of this lane, stated rather than hidden: Playwright's
 * synthetic touch events drive the pointer path, which is what the binding
 * listens to — so the ARMING, the resistance, the refresh and the settle are
 * all really measured. What no engine here can produce is the compositor-level
 * native overscroll animation that issue 187 was about, and the pin for that
 * remains the computed `overscroll-behavior-y` below. */
test('the page is never left displaced by a pull, and the native bounce stays suppressed (issue 219, 187)', async ({
  page,
}) => {
  await visit(page);

  // Issue 187's fix is still in force in this engine — removing it would
  // reintroduce exactly the defect this feature is a replacement for.
  const overscroll = await page.evaluate(() => ({
    html: window.getComputedStyle(window.document.documentElement).overscrollBehaviorY,
    body: window.getComputedStyle(window.document.body).overscrollBehaviorY,
  }));
  expect(overscroll.html).toBe('none');
  expect(overscroll.body).toBe('none');

  // AT REST there must be no transform on the page column. This is not
  // cosmetic: a transform of any value other than `none` makes its element a
  // containing block for every fixed-position descendant, which would silently
  // re-parent the pinned header and every detail card away from the viewport
  // for the life of the page.
  const atRest = await page.evaluate(() => ({
    main: window.getComputedStyle(window.document.querySelector('main')).transform,
    pulling: window.document.documentElement.hasAttribute('data-pulling'),
  }));
  expect(atRest.main, 'the page column carries a transform at rest').toBe('none');
  expect(atRest.pulling).toBe(false);

  // A real downward pull from the top.
  await page.evaluate(() => window.scrollTo(0, 0));
  const pulled = await page.evaluate(async () => {
    const target = window.document.body;
    const send = (type, y) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          pointerType: 'touch',
          clientX: 100,
          clientY: y,
          bubbles: true,
        }),
      );
    send('pointerdown', 100);
    const samples = [];
    for (const y of [120, 140, 190, 260, 340]) {
      send('pointermove', y);
      /* The component writes the travel from a reactive effect, which lands on
         a microtask rather than inside the dispatch. Reading synchronously
         here would measure the frame BEFORE the pull — a harness racing the
         framework, not a product fault. */
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      samples.push({
        raw: y - 100,
        moved: Number.parseFloat(
          window.document.documentElement.style.getPropertyValue('--page-pull'),
        ),
        phase: window.document.querySelector('.pull-indicator').dataset.pullPhase,
      });
    }
    return samples;
  });

  // It RESISTS: the surface always moves less than the finger did.
  for (const sample of pulled) {
    expect(sample.moved, `a ${sample.raw}px pull moved ${sample.moved}px, which is no resistance`).toBeLessThan(
      sample.raw,
    );
    expect(sample.moved).toBeGreaterThan(0);
  }
  // ...and it ARMS, with a phase change the reader can see at the crossing.
  expect(pulled.at(0).phase, 'a short pull already reads as armed').toBe('pulling');
  expect(pulled.at(-1).phase, 'a long pull never armed; the gesture can never fire').toBe('armed');

  // Releasing an armed pull refreshes and then SETTLES BACK TO PLACE — the
  // exact property the removed gesture lacked.
  await page.evaluate(() => {
    window.document.body.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 1,
        pointerType: 'touch',
        clientX: 100,
        clientY: 340,
        bubbles: true,
      }),
    );
  });
  await expect
    .poll(
      async () =>
        page.evaluate(
          () => window.document.documentElement.style.getPropertyValue('--page-pull') === '0px',
        ),
      { message: 'the page never settled back after a pull', timeout: 10_000 },
    )
    .toBe(true);

  const settledState = await page.evaluate(() => ({
    main: window.getComputedStyle(window.document.querySelector('main')).transform,
    pulling: window.document.documentElement.hasAttribute('data-pulling'),
    phase: window.document.querySelector('.pull-indicator').dataset.pullPhase,
    scrollY: window.scrollY,
  }));
  expect(settledState.main, 'the page column was left transformed after a pull').toBe('none');
  expect(settledState.pulling, 'the pulling attribute outlived the pull').toBe(false);
  expect(settledState.phase).toBe('idle');
  expect(settledState.scrollY, 'the page was left scrolled by its own refresh gesture').toBe(0);
});

test('an upward drag from the top is the page’s scroll, never a pull (issue 219)', async ({
  page,
}) => {
  await visit(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const moved = await page.evaluate(() => {
    const target = window.document.body;
    const send = (type, y) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 7,
          pointerType: 'touch',
          clientX: 100,
          clientY: y,
          bubbles: true,
        }),
      );
    send('pointerdown', 300);
    for (const y of [280, 240, 180]) send('pointermove', y);
    const pull = window.document.documentElement.style.getPropertyValue('--page-pull');
    send('pointerup', 180);
    return pull;
  });
  // Either untouched or explicitly zero — never a positive travel.
  expect(['', '0px']).toContain(moved);
});

/* Findings 7 and 8, and they belong together because both are about what a
 * pull CLAIMS.
 *
 * 7. The pull asked only for downward travel, so a mostly-HORIZONTAL drag
 *    with any downward drift claimed it: measured at the top of the document,
 *    a drag of dx 160 / dy 20 set `data-pulling="true"` and moved the page
 *    18.8px, while lib/gesture.ts's own swipe stands down explicitly in the
 *    mirror-image case. It now stands down on the SAME predicate.
 * 8. While a pull is live the transform on <main> is genuinely applied, and
 *    <main> then IS the containing block for every `position: fixed`
 *    descendant inside it — 101 of them here, every one a detail card — so
 *    lib/tooltip.ts's stated guarantee ("a fixed box is outside the scrollable
 *    overflow region by construction") is suspended for the gesture. What
 *    saves it is geometry, and geometry is what this pins: a pull engages only
 *    at the top of the document, and NOTHING fixed inside <main> is visible
 *    there. The day that stops being true — a fixed element added inside
 *    <main> near the top, or the header moved into it — is the day the
 *    gesture needs to close what it re-parents, and this lane is what says
 *    so. */
test('a pull claims only a downward drag, and takes no open readout with it (issue 219)', async ({
  page,
}) => {
  await visit(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await settled(page);

  /* The census that makes finding 8 a measurement rather than a worry, taken
     at the ONLY scroll position a pull can begin from. `visible` is the whole
     question: a hidden box being re-parented costs nothing, because its
     position is written when it opens. */
  const census = await page.evaluate(() => {
    window.scrollTo(0, 0);
    const main = window.document.querySelector('main');
    const fixed = [...main.querySelectorAll('*')].filter(
      (node) => window.getComputedStyle(node).position === 'fixed',
    );
    const onScreen = (node) => {
      const style = window.getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return (
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        box.width > 0 &&
        box.height > 0 &&
        box.bottom > 0 &&
        box.top < window.innerHeight
      );
    };
    const hostTops = [...window.document.querySelectorAll('.cell-tip')].map((tip) =>
      Math.round(tip.parentElement.getBoundingClientRect().top + window.scrollY),
    );
    return {
      fixedInsideMain: fixed.length,
      visibleInsideMain: fixed.filter(onScreen).map((node) => node.className),
      nearestDetailHost: hostTops.length === 0 ? null : Math.min(...hostTops),
      viewportHeight: window.innerHeight,
      headerInsideMain: main.querySelector('.page-header') !== null,
    };
  });
  expect(census.fixedInsideMain, 'nothing fixed lives inside main; this lane proves nothing').toBeGreaterThan(0);
  /* NOTHING FIXED INSIDE MAIN IS ON SCREEN AT THE TOP. This is what makes the
     re-parenting harmless, and it is the assertion that fails the day it stops
     being true. */
  expect(
    census.visibleInsideMain,
    'a fixed element inside main is visible where a pull begins; the gesture now re-parents something a reader can see',
  ).toEqual([]);
  // With margin, rather than by a pixel: the nearest detail host is far below
  // any viewport a touch device brings here.
  expect(
    census.nearestDetailHost,
    `the nearest detail host is ${census.nearestDetailHost}px down a ${census.viewportHeight}px viewport`,
  ).toBeGreaterThan(census.viewportHeight);
  // The pinned header is outside main and therefore never re-parented — the
  // half of this that is already safe, stated so a later move would be loud.
  expect(census.headerInsideMain, 'the fixed header moved inside main, where a pull re-parents it').toBe(false);

  const drag = (path) =>
    page.evaluate(async (points) => {
      const send = (type, x, y) =>
        window.document.body.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 88,
            pointerType: 'touch',
            clientX: x,
            clientY: y,
            bubbles: true,
          }),
        );
      send('pointerdown', points[0][0], points[0][1]);
      for (const [x, y] of points.slice(1)) {
        send('pointermove', x, y);
        /* The travel is written from a reactive effect, which lands on a
           microtask rather than inside the dispatch, so a synchronous read
           would measure the frame BEFORE the pull. */
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
      }
      const root = window.document.documentElement;
      const state = {
        pulling: root.hasAttribute('data-pulling'),
        pull: root.style.getPropertyValue('--page-pull'),
        main: window.getComputedStyle(window.document.querySelector('main')).transform,
        tipOpen: window.document.querySelector('.cell-tip[data-tip-open="true"]') !== null,
      };
      send('pointerup', points.at(-1)[0], points.at(-1)[1]);
      return state;
    }, path);

  const acrossThenDown = [
    [40, 100],
    [60, 102],
    [90, 105],
    [120, 108],
    [150, 112],
    [180, 116],
    [200, 120],
  ];
  const straightDown = [
    [100, 100],
    [100, 120],
    [100, 150],
    [100, 200],
    [100, 260],
  ];

  await page.evaluate(() => window.scrollTo(0, 0));
  const sideways = await drag(acrossThenDown);
  expect(sideways.pulling, 'a mostly-horizontal drag claimed the page pull').toBe(false);
  expect(['', '0px'], 'a mostly-horizontal drag moved the page').toContain(sideways.pull);
  expect(sideways.main, 'a mostly-horizontal drag made main a containing block').toBe('none');

  // ...and the gesture it stands down for still works, or the assertion above
  // is satisfied by a pull that never claims anything at all.
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
  const downward = await drag(straightDown);
  expect(downward.pulling, 'a straight downward drag no longer pulls at all').toBe(true);
  expect(Number.parseFloat(downward.pull), 'a straight downward drag moved nothing').toBeGreaterThan(0);

  /* And no detail is open while the transform is on — which follows from the
     census above rather than from a guard, and is measured here as the
     behaviour rather than assumed from the geometry. */
  expect(downward.tipOpen, 'a detail card was open while main became its containing block').toBe(false);
  await expect
    .poll(async () => page.evaluate(() => window.document.documentElement.hasAttribute('data-pulling')), {
      message: 'the pull never settled',
      timeout: 10_000,
    })
    .toBe(false);
});

test('the refresh gesture has a control a keyboard can reach (issue 219)', async ({ page }) => {
  await visit(page);
  const control = page.locator('.pull-control');
  await expect(control, 'the pull gesture has no non-gesture equivalent').toHaveCount(1);

  // Hidden by CLIPPING, not by shrinking: the box stays at the touch floor, so
  // the control is a real target the instant it is revealed.
  const box = await control.boundingBox();
  expect(box.width + subPixel, 'the refresh control is under the touch floor').toBeGreaterThanOrEqual(
    touchFloorPx,
  );
  expect(box.height + subPixel, 'the refresh control is under the touch floor').toBeGreaterThanOrEqual(
    touchFloorPx,
  );

  /* It is the FIRST thing a keyboard reaches — where the engine tabs to
     buttons at all. WebKit does not by default (its "press Tab to highlight
     each item" setting is off, and Playwright inherits that), which is a
     browser preference rather than anything this page controls, so the
     Tab-order half is asserted only on the engines that HAVE a Tab order over
     buttons. The reachability half below is asserted everywhere, because
     focus() is what assistive technology uses regardless. */
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => window.document.activeElement?.className ?? '');
  if (focused !== '' && !focused.includes('gallery-dot')) {
    expect(focused, 'the refresh control is not the first focus stop').toContain('pull-control');
  }
  await control.evaluate((node) => node.focus());
  expect(
    await page.evaluate(() => window.document.activeElement?.className ?? ''),
    'the refresh control cannot be focused at all',
  ).toContain('pull-control');

  // Focusing it reveals it rather than leaving an invisible focused control.
  expect(await control.evaluate((node) => window.getComputedStyle(node).clipPath)).toBe('none');

  // And pressing it does the work, then returns to idle.
  await page.keyboard.press('Enter');
  await expect
    .poll(
      async () =>
        page.evaluate(() => window.document.querySelector('.pull-indicator').dataset.pullPhase),
      { message: 'the refresh control never returned to idle', timeout: 10_000 },
    )
    .toBe('idle');
});

/* DEFECT 4. At iPhone width the fixed reading-mode control overlapped the
 * token panel's segmented control, rendering "cumulative" underneath the moon
 * icon. The header is fixed to the VIEWPORT while the column scrolls beneath
 * it, and at a phone width the column IS the viewport, so right-aligned panel
 * content passed through the corner the control owns — with nothing painted
 * behind it, the label showed straight through.
 *
 * MEASURED before the fix at 390x844 in WebKit: icon x 330-374 y 16-60,
 * "cumulative" x 283.19-360.0 y 26.98-70.98 — a 30x33px overlap. At 1440px
 * there was none (icon x 1380-1424, column x 240-1200), which is why it only
 * ever appeared on a phone.
 *
 * That "cumulative" segment no longer renders in the open: the display
 * choices moved behind a per-source menu on 2026-08-28. The control that took
 * its place at the end of the same header — the menu's own trigger — is what
 * this lane scrolls under the plate now, because the collision was never
 * about which control it was, only about where the column ends. */
test('the fixed reading-mode control never renders over page text (issue 219)', async ({ page }) => {
  await visit(page);

  const plate = await page.evaluate(() => {
    const header = window.document.querySelector('.page-header');
    const style = window.getComputedStyle(header);
    return {
      background: style.backgroundColor,
      shadow: style.boxShadow,
      radius: style.borderTopLeftRadius,
      blur: style.backdropFilter || style.webkitBackdropFilter,
    };
  });
  /* A transparent plate is the original defect: whatever scrolls beneath shows
     THROUGH the glyph. But the first cut over-corrected — a fully opaque disc
     ringed by a gutter-wide shadow spread, which on a phone reads as a huge
     solid circle stamped on the page (owner defect report, 0.1.52). What the
     control needs is not opacity but a VEIL: enough of the page's own surface
     to separate the glyph from the text, over a blur that softens what passes
     under it, and no halo at all.

     So all three properties are pinned in the direction the redesign chose,
     and each fails on its own: a plate that went transparent again, one that
     went back to opaque, one that lost its blur, and one that brought the
     spread back are four different red builds. */
  const alpha = alphaOf(plate.background);
  expect(alpha, 'the reading-mode control paints no backdrop of its own').toBeGreaterThan(0);
  expect(
    alpha,
    `the plate is painted at ${alpha}: an opaque disc, not the veil the owner asked for`
  ).toBeLessThan(1);
  expect(plate.blur, 'the plate does not soften what scrolls beneath it').toContain('blur');
  expect(plate.shadow, 'the plate rings itself with a halo again').toBe('none');
  // The pill the 44px hit box already describes — the plate is shaped by the
  // control it backs rather than by a number of its own.
  expect(Number.parseFloat(plate.radius), 'the plate is not the control’s own pill').toBeGreaterThan(
    touchFloorPx / 2,
  );

  // Browser-driven scrolling must not park a target under the control either.
  expect(
    await page.evaluate(
      () => window.getComputedStyle(window.document.documentElement).scrollPaddingTop,
    ),
    'a fragment or focus move can still land under the fixed control',
  ).not.toBe('auto');

  /* HALF ONE — browser-driven scrolling no longer parks a target under the
     control at all. This is the layout half of the fix and the stronger of
     the two statements: scrollIntoView (and every focus move, which uses the
     same machinery) now honours the scroll padding, so the segment the owner
     could not read lands BELOW the control instead of beneath it. */
  const landing = await page.evaluate(() => {
    /* The right-aligned panel content the owner's report was actually about.
       It used to be the last "cumulative" segment of an exposed pill row, then
       the display trigger that replaced it; the owner deleted both on
       2026-08-28, so this lane names the insight figures that still sit where
       they sat — the end column of the insights grid, hard against the
       column's own end edge — which is what makes it the same collision. A
       target that no longer exists would make this half of the test silently
       vacuous, which is why it is asserted non-null below. */
    const segments = [...window.document.querySelectorAll('.usage-insight-value')];
    if (segments.length === 0) return null;
    const segment = segments.at(-1);
    segment.scrollIntoView({ block: 'start' });
    const header = window.document.querySelector('.page-header');
    return {
      text: segment.innerText.trim(),
      segmentTop: segment.getBoundingClientRect().top,
      headerBottom: header.getBoundingClientRect().bottom,
    };
  });
  expect(landing, 'the token panel rendered no end-aligned content to measure').not.toBeNull();
  /* A whole pixel of tolerance here rather than the sub-pixel one used for
     box SIZES, and the difference is deliberate. A scroll offset is rounded
     to the device's own pixel grid, so a target the engine placed exactly at
     the padding edge is reported a fraction above or below it — MEASURED at
     59.744 against a 60px edge on a 3x iPhone. One pixel is a rounding
     allowance; it cannot hide a 44px control the content is genuinely
     underneath, which is what this assertion is about. */
  const scrollRoundingPx = 1;
  expect(
    landing.segmentTop + scrollRoundingPx,
    `"${landing.text}" was scrolled to ${landing.segmentTop}, under a control whose bottom edge is ${landing.headerBottom}`,
  ).toBeGreaterThanOrEqual(landing.headerBottom);

  /* HALF TWO — when a reader scrolls BY HAND, content genuinely does pass
     under a fixed control; that is what "fixed" means and no layout can
     prevent it. What must not happen is the owner's actual report: the label
     rendering THROUGH the glyph because nothing was painted between them. So
     the content is put deliberately under the control and the top-most
     element at the centre of the overlap is measured — it must be the
     control, not the text. */
  const occlusion = await page.evaluate(() => {
    const segments = [...window.document.querySelectorAll('.usage-insight-value')];
    const segment = segments.at(-1);
    const header = window.document.querySelector('.page-header');
    const hb = header.getBoundingClientRect();
    // Scroll by hand until this segment's own box is centred on the control.
    const sb = segment.getBoundingClientRect();
    window.scrollBy(0, sb.top + sb.height / 2 - (hb.top + hb.height / 2));
    const nowSegment = segment.getBoundingClientRect();
    const nowHeader = header.getBoundingClientRect();
    const left = Math.max(nowSegment.left, nowHeader.left);
    const right = Math.min(nowSegment.right, nowHeader.right);
    const top = Math.max(nowSegment.top, nowHeader.top);
    const bottom = Math.min(nowSegment.bottom, nowHeader.bottom);
    if (right <= left || bottom <= top) {
      return { overlaps: false };
    }
    // The CENTRE of the intersection, never a corner: a corner plus one pixel
    // lands outside whichever box is thinner there, which is a hit test of
    // the wrong element dressed up as a finding.
    const hit = window.document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return {
      overlaps: true,
      headerOnTop: hit !== null && (header === hit || header.contains(hit)),
      hit: hit === null ? null : hit.className.toString(),
    };
  });
  if (occlusion.overlaps) {
    expect(
      occlusion.headerOnTop,
      `page text renders over the fixed control instead of behind its plate (topmost element was "${occlusion.hit}")`,
    ).toBe(true);
  }

  /* HALF THREE — the column does not reach the control at all (issue 241),
     which is the guarantee the two halves above could not give. Halves one and
     two are about a target scrolled to a place and a plate painted under a
     glyph; neither says anything about the ordinary case the owner was
     actually reading, which is body text passing under a control on its way up
     the screen. MEASURED on 0.1.54, and this half is why it was only ever a
     phone defect: at 320px <main> ended at exactly 304 and the trigger box was
     x 260-304, so a scroll sweep found body text under the control 9 to 11
     times at 320, 360, 390, 412 and 768 — bullets, card bylines and a card
     title — and zero times at 1280 and 1440.

     The lane the page now reserves is what makes the answer geometric: below
     the handle breakpoint the column ends where the control starts, so no
     descendant of it can be under the control at any scroll offset. Every
     width the sweep found the defect at is probed, in the engine this project
     runs, rather than only the one this project's own viewport happens to
     be. */
  for (const width of [...phoneWidths, 768, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await settled(page);
    const lane = await page.evaluate(() => {
      const control = window.document.querySelector('.page-header').getBoundingClientRect();
      const column = window.document.querySelector('#app > main').getBoundingClientRect();
      return {
        controlStart: control.left,
        controlWidth: control.width,
        columnEnd: column.right,
        columnWidth: column.width,
      };
    });
    // Non-vacuity: a column that had collapsed would pass this trivially.
    expect(lane.columnWidth, `the column measures ${lane.columnWidth}px at ${width}px`).toBeGreaterThan(100);
    expect(
      lane.controlWidth + subPixel,
      `the control shrank to ${lane.controlWidth}px to make room; the 44px target is the floor, not the variable`
    ).toBeGreaterThanOrEqual(touchFloorPx);
    expect(
      lane.columnEnd,
      `at ${width}px the column ends at ${lane.columnEnd}px, inside a control that starts at ${lane.controlStart}px`
    ).toBeLessThanOrEqual(lane.controlStart + subPixel);
  }
});
