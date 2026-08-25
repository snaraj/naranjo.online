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

/* The gallery frame's height ceiling (issue 157): 20rem at this page's
 * unmodified 16px root, the literal value tests/sections.test.mjs pins
 * against the stylesheet's own text. A gallery-cap assertion below compares
 * a MEASURED box against this fixed number, never against
 * getComputedStyle(frame).maxHeight read back from the same page — Daybreak
 * Blue's review of PR #161 proved that self-referential shape lets a
 * 20rem -> 200rem mutation survive undetected, because the expectation and
 * the rendered behavior move together when both derive from the one
 * (mutated) token. */
const galleryFrameCapPx = 320;

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
async function settled(page) {
  let previous = -1;
  await expect
    .poll(
      async () => {
        const height = await page.evaluate(() => window.document.documentElement.scrollHeight);
        const stable = height > 0 && height === previous;
        previous = height;
        return stable;
      },
      { message: 'the page never stopped growing', timeout: 15_000 }
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

const openReadingModes = async (page) => {
  await page.getByRole('button', { name: 'Reading mode' }).click();
  await expect(page.locator('#reading-mode-menu')).toBeVisible();
};

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
     ("there is no action to perform", BossLog.svelte), is not a target you tap
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

/* SUPERSEDED by "every swatch still says which palette it selects, in every
 * reading mode" at the end of this file, and superseded rather than deleted
 * so the reason is on the record.
 *
 * This lane guarded a color-mix() that no longer exists. It measured one
 * thing — that the sepia glyph had not fallen back to the PAGE's ink, which
 * would have been near-black on a near-black disc — and under the restyle of
 * 2026-08-24 that assertion inverts: the swatches are line icons now, the
 * palette moved inside the glyph, and the page's own ink is deliberately what
 * every outline is drawn in, because it is the one ink guaranteed legible on
 * the popover in all four reading modes. Keeping the lane would have pinned
 * the design it replaced.
 *
 * What it was actually FOR — the sepia swatch stays legible — is now measured
 * for all five swatches in all five reading modes, for the outline against
 * the popover and for each dark mode's craters against their own moon. The
 * sepia case is one row of that lane instead of a lane of its own, and the
 * color-mix it was written around is gone: sepia's craters read its accent
 * token directly, unmixed, at 7.09:1 on sepia's own surface. */

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
    expect(observed.stack).toBeCloseTo(observed.viewport - gutterPx, 0);
    for (const card of observed.cards) {
      expect(card, `a card is ${card}px wide on a ${width}px phone`).toBeCloseTo(
        observed.viewport - gutterPx,
        0
      );
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

/* The strip is as wide as its data, and no wider (issue #141, residual risk 2:
 * "the Anthropic grid reads small — fifteen days is three columns in a strip
 * sized for 53, hard against the left edge").
 *
 * Measured rather than asserted, because the whole claim is geometric: the
 * box, the cells inside it, and the key under it are three real rectangles an
 * engine produced, and the rule is a relationship between them. Both
 * directions ride here, and neither is redundant. A block that claimed a year
 * whatever it drew is the defect that was reported. A block that shrank to its
 * data everywhere — the obvious over-correction — would take the version
 * control calendar down with it, and that calendar genuinely has a year of
 * columns to show. So the lane insists a short graph is short AND that the
 * long one is untouched, in the same measurement. */
test('every graph is exactly as wide as the columns it draws', async ({ page }) => {
  await visit(page);
  const observed = await page.evaluate(() => {
    const width = (node) => Math.round(node.getBoundingClientRect().width * 100) / 100;
    return [...window.document.querySelectorAll('.grid-block')].map((block) => {
      const strip = block.querySelector('.grid-strip');
      const cells = block.querySelector('.grid-cells');
      const legend = block.querySelector('.grid-legend');
      const cell = cells.querySelector('.grid-cell');
      const gap = parseFloat(getComputedStyle(cells).columnGap || '0');
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
        claimed: Number(block.getAttribute('data-grid-columns')),
        /* Counted off the DOM, never read back off the same attribute the
           claim came from: a lane that compared an attribute with itself
           would agree with any value at all. */
        drawn: Math.ceil(cells.querySelectorAll('.grid-cell').length / 7),
        cellSize: width(cell),
        gap,
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

  /* Non-vacuity, and the reason the two halves cannot be written as one
     assertion: the page must be showing BOTH a graph short enough to be
     floored and a graph long enough to keep a year, or one of the two
     directions below is being proved against no example. */
  const short = observed.filter((grid) => grid.drawn < grid.claimed);
  const long = observed.filter((grid) => grid.drawn >= 52);
  expect(
    short.length,
    'no graph on the page is short enough to exercise the floor'
  ).toBeGreaterThan(0);
  expect(long.length, 'no year-wide graph is on the page to prove it was not shrunk').toBe(1);

  for (const grid of observed) {
    const expected = grid.claimed * (grid.cellSize + grid.gap) - grid.gap;
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
    /* The claim covers the data: a box narrower than its own cells would
       clip a series the panel says it is showing. */
    expect(
      expected,
      `"${grid.label}" claims ${grid.claimed} columns for ${grid.drawn} columns of cells`
    ).toBeGreaterThanOrEqual(grid.cells - subPixel);
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
    /* And the strip fills the block, so the frame drawn around an empty
       plate is the frame around the box the data will land in. */
    expect(grid.strip, `"${grid.label}" strip and block disagree about their width`).toBeCloseTo(
      grid.block,
      1
    );
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

/* LOOK, at every length a real series can be (owner directive, 2026-08-24).
 * Sizing a box to its data is only an improvement if the box's GRAMMAR
 * survives the short end: the same cell, the same gap, the legend in the same
 * place. A strip that quietly shrank its cells to fill a floor, or that let
 * its key drift off the end at one day and not at fifty-three, would pass
 * every width assertion in this file and still look broken on the page. So
 * the four shapes are rendered on the real page and compared to each other. */
test('the strip keeps its grammar at every series length', async ({ page }) => {
  const shapes = [1, 15, 31, 371];
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
    expect(shape.drawn, `a ${shape.days} day series drew ${shape.drawn} columns`).toBe(
      Math.ceil(shape.days / 7)
    );
    expect(shape.claimed, `a ${shape.days} day series claims fewer columns than it drew`)
      .toBeGreaterThanOrEqual(shape.drawn);
    expect(shape.rows, `a ${shape.days} day series stopped being seven days tall`).toBe(7);
  }
  for (const shape of rest) {
    /* The grammar: identical cell, identical gap, identical row height,
       identical legend placement. A floor may change the BOX; it may not
       change the drawing. */
    expect(shape.cell, `the cell resized between 1 day and ${shape.days} days`).toBe(first.cell);
    expect(shape.cellHeight, `the cell height moved at ${shape.days} days`).toBe(first.cellHeight);
    expect(shape.gap, `the gap moved at ${shape.days} days`).toBe(first.gap);
    expect(shape.strip, `the strip changed height at ${shape.days} days`).toBe(first.strip);
    expect(
      shape.legendOffset,
      `the less/more key sits ${shape.legendOffset}px from the block edge at ${shape.days} days and ${first.legendOffset}px at 1 day`
    ).toBe(first.legendOffset);
    expect(shape.legendTop, `the key changed row at ${shape.days} days`).toBe(first.legendTop);
  }
  /* Non-vacuity: the four shapes must not all have produced the same box, or
     the comparisons above are four measurements of one rendering. */
  expect(
    new Set(measured.map((shape) => shape.block)).size,
    'every series length produced the same box; the sizing is not reading its data'
  ).toBeGreaterThan(1);
  /* And the long one is genuinely long — a year of columns still gets a year
     of columns, which is the direction an over-correction would break. */
  const year = measured.at(-1);
  expect(year.claimed, 'a year-long series no longer claims a year of columns').toBe(53);
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
    const box = window.document.querySelector('.boss-grid');
    const style = getComputedStyle(box);
    const cells = [...box.querySelectorAll('.boss-cell')];
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
      icons: box.querySelectorAll('img.boss-icon').length,
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
    const icons = [...window.document.querySelectorAll('.icon-button')];
    return {
      heading: window.document.querySelector('h1')?.textContent?.trim(),
      titles: [...window.document.querySelectorAll('.panel-title')].map((n) => n.textContent.trim()),
      badges: window.document.querySelectorAll('.panel-badge').length,
      provenance: [...window.document.querySelectorAll('.panel-shell')].every((n) =>
        n.hasAttribute('data-panel-status')
      ),
      viewport: window.document.documentElement.clientWidth,
      /* The content column's end edge. The chrome is aligned with the column
         rather than with the window (issue 134 made the page one centred
         container), so "in the corner" is a statement about the column and
         measuring it against the viewport would measure the centring. */
      columnEnd: window.document.querySelector('main').getBoundingClientRect().right,
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
  /* Both controls, together, in the top-end corner — not one above the title
     and one below it. */
  expect(observed.icons.length, 'the page chrome is not two icons').toBe(2);
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
  /* The pair sits in the corner and reads as a pair: the same row, adjacent
     rather than spread across the header, and the last of them against the
     end edge of the column it belongs to. The arrangement the owner rejected —
     one control above the title and one below it — fails the first of these by
     hundreds of pixels. */
  const [first, second] = observed.icons;
  expect(Math.abs(first.top - second.top), 'the two icons are stacked, not paired').toBeLessThan(4);
  expect(
    second.left - first.right,
    'the two icons are not beside each other'
  ).toBeLessThan(touchFloorPx / 2);
  expect(
    observed.columnEnd - second.right,
    `the pair sits ${observed.columnEnd - second.right}px from the column's end edge`
  ).toBeLessThanOrEqual(gutterPx / 2 + subPixel);
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
    /* Nor the heading and lens toggle the graph came with: a three-way toggle
       over no series is the same hole in different markup. */
    expect(shown.region, `"${source.label}" kept the graph region around an absent graph`).toBe(
      false
    );
    expect(shown.toggles, `"${source.label}" kept a lens toggle with nothing to re-read`).toBe(0);
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
    expect(shown.toggles, `"${source.label}" lost the lens toggle for its series`).toBe(1);
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
    const rows = [...window.document.querySelectorAll('.activity-commit')];
    const repoCell = rows[0]?.querySelector('.activity-commit-repo');
    const messageCell = rows[1]?.querySelector('.activity-commit-message');
    const shaMessageCell = rows[2]?.querySelector('.activity-commit-message');
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

  const rows = page.locator('.activity-commit');
  const rowCount = await rows.count();
  expect(rowCount, 'no commit rows rendered from an old-shape payload — this is the outage Daybreak Blue proved').toBeGreaterThan(0);

  /* Each row's repo cell is still real navigation — the sha's absence must
     degrade only that row's own sha-permalink capability, never the repo
     link, never the row itself, never the rest of the payload. */
  const repoLinks = await page.locator('.activity-commit-repo').count();
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

  const messageLink = page.locator('.activity-commit-message').first();
  await messageLink.scrollIntoViewIfNeeded();

  const attrs = await page.evaluate(() => {
    const row = window.document.querySelector('.activity-commit');
    const repo = row.querySelector('.activity-commit-repo');
    const message = row.querySelector('.activity-commit-message');
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
     checks. Scoped to [data-activity-panel] because TokenUsagePanel renders
     the identical ContributionGrid component for its own heatmap and would
     otherwise make '.grid-strip' ambiguous. */
  await page.locator('[data-activity-panel] .grid-strip').evaluate((node) => node.focus());
  await page.keyboard.press('Tab');
  const repoFocus = await page.evaluate(() => {
    const el = window.document.activeElement;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName,
      isRepoLink: el.classList.contains('activity-commit-repo'),
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
      isMessageLink: el.classList.contains('activity-commit-message'),
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

  const messageLink = page.locator('.activity-commit-message').first();
  await messageLink.scrollIntoViewIfNeeded();

  const attrs = await page.evaluate(() => {
    const row = window.document.querySelector('.activity-commit');
    const message = row.querySelector('.activity-commit-message');
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
      isMessageLink: el.classList.contains('activity-commit-message'),
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
    const message = window.document.querySelector('.activity-commit-message');
    return { tag: message.tagName, href: message.getAttribute('href') };
  });

  expect(attrs.tag).toBe('A');
  expect(
    attrs.href,
    'the row linked to the unverifiable /issues/9999999 reference instead of its own proven commit'
  ).toBe(`https://github.com/snaraj/naranjo.online/commit/${validSha}`);
  expect(attrs.href).not.toContain('/issues/9999999');
});

test('the shortest admitted repo slug still clears the touch floor on both axes (issue 157)', async ({
  page,
}) => {
  /* Daybreak Blue's review of PR #161 measured this exact probe: a
     one-character repo slug — "a" is admitted by isValidRepoSlug, the
     shortest string the pattern accepts — rendered a 6.625px-wide anchor
     even though the row already cleared the 44px touch floor on its BLOCK
     axis. max-inline-size alone bounds the upper end of
     .activity-commit-repo; nothing bounded the lower end until
     min-inline-size was added (ActivityBar.svelte), so a column sized
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

  const repoLink = page.locator('.activity-commit-repo').first();
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
 * The nav and the art feed are the two surfaces whose correctness is a
 * property of the RENDERED page rather than of the source: a link that names
 * a section nobody rendered still looks perfect in the markup, and a gallery
 * whose origin serves no media is the ordinary case that must still look
 * deliberate.
 * ======================================================================== */

test('every section the nav names is on the page, and its link reaches it', async ({ page }) => {
  await visit(page);
  const links = page.locator('.section-link');
  const count = await links.count();
  expect(count, 'the page renders no section links at all').toBeGreaterThan(3);
  for (let index = 0; index < count; index += 1) {
    const link = links.nth(index);
    const href = await link.getAttribute('href');
    expect(href, 'a nav link points nowhere').toMatch(/^#[a-z-]+$/);
    /* The section exists. This is the assertion a source pin cannot make on
       the assembled page: the nav is one component and the sections are
       four others, and only the rendered document knows they agree. */
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
     itself, so this walks PAST every nav link instead — Work and the Art
     gallery both carry zero focusable elements of their own between the nav
     and the Coding Projects feed (a fact this exploits rather than assumes:
     if that ever stops being true, this walk lands somewhere unexpected and
     the assertion below fails loudly rather than skipping quietly) — to
     the feed's first project link: a plain anchor with nothing to do with
     the nav. */
  const navCount = await page.locator('.section-link').count();
  await page.locator('.theme-menu .trigger').evaluate((node) => node.focus());
  for (let step = 0; step < navCount + 1; step += 1) {
    await page.keyboard.press('Tab');
  }
  const probe = await page.evaluate(() => {
    const el = window.document.activeElement;
    return { tag: el.tagName, isProjectLink: el.classList.contains('project-link') };
  });
  const engineTabsLinks = probe.tag === 'A' && probe.isProjectLink;

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

test('the art feed shows its frames when the origin serves no media', async ({ page }) => {
  await visit(page);
  /* The lanes run the binary with media disabled (playwright.config.mjs), so
     this is the ORDINARY state of the gallery rather than a failure being
     simulated: every frame asks for its picture, the origin serves none, and
     what the visitor sees has to be a designed empty frame. The count is
     awaited rather than read once — the frames answer as their requests
     resolve. */
  const frames = page.locator('.art-frame');
  const total = await frames.count();
  expect(total, 'the art feed rendered no frames').toBeGreaterThan(0);
  /* The explanation appears for a reader who has not scrolled anywhere: only
     the first picture is fetched eagerly, so keying the note on all of them
     would hide it behind pictures nobody asked for. */
  await expect(page.locator('[data-art-unserved]')).toHaveCount(1);
  await expect(page.locator('[data-art-pending]')).not.toHaveCount(0);
  /* And the deferred ones answer the same way once they are scrolled toward,
     which is the other half of the lazy path. The scroll walks the feed a
     viewport at a time rather than jumping to the end: a lazy picture is only
     fetched when it comes NEAR the viewport, so a jump past it never requests
     it at all — measured, two of eight had answered after one jump. */
  await page.evaluate(async () => {
    const step = Math.max(1, window.innerHeight);
    for (let top = 0; top <= window.document.documentElement.scrollHeight; top += step) {
      window.scrollTo(0, top);
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  });
  await expect(page.locator('[data-art-pending]')).toHaveCount(total);
  const observed = await page.evaluate(() => {
    const boxes = [...window.document.querySelectorAll('.art-frame')];
    return {
      images: window.document.querySelectorAll('img.art-image').length,
      inCards: boxes.every((frame) => frame.closest('.feed-card') !== null),
      /* No ART card carries a title today (the owner asked for none) and the
         region is ABSENT rather than empty, while the work feed's cards — the
         same primitive — do carry one. Both branches, in one measurement. */
      artTitles: window.document.querySelectorAll('.art-feed .feed-card-title').length,
      workTitles: window.document.querySelectorAll('.work-feed .feed-card-title').length,
      sizes: boxes.map((frame) => {
        const box = frame.getBoundingClientRect();
        return { width: Math.round(box.width), height: Math.round(box.height) };
      }),
      columns: new Set(
        boxes.map((frame) => Math.round(frame.getBoundingClientRect().left))
      ).size,
    };
  });
  /* No broken-image glyph anywhere: an <img> whose source 404s is replaced by
     the frame, not left on the page to render the browser's own failure. */
  expect(observed.images, 'a picture the origin does not serve is still in the document').toBe(0);
  /* Every frame is a feed card — the same primitive the rest of the page is
     built from, so a title, a date or a border is data rather than surgery. */
  expect(observed.inCards, 'a picture is not wrapped in the card primitive').toBe(true);
  expect(
    observed.artTitles,
    'an art card drew a heading band for a title it was never given'
  ).toBe(0);
  expect(
    observed.workTitles,
    'no card anywhere renders a title, so the absent art heading proves nothing'
  ).toBeGreaterThan(0);
  /* One vertical column of cards (the owner asked for a feed), and every
     frame the same reserved box — which is what makes the arrival of six
     megabytes of photography cost no layout shift. */
  expect(observed.columns, 'the art feed is a mosaic rather than a column').toBe(1);
  const [firstBox] = observed.sizes;
  expect(firstBox.height, 'the art frames reserve no height').toBeGreaterThan(0);
  for (const size of observed.sizes) {
    expect(size, 'the art frames are not all the same reserved box').toEqual(firstBox);
  }
  /* And the box is the SMALLER of the pictures' 16:9 ratio and the tokenized
     height cap (issue 157) — at the page's default column width the cap is
     what actually wins (960px wide at 16:9 asks for 540px; the cap holds it
     open at less than that), which is the fix for the owner's exact
     complaint: one frame was filling the screen. galleryFrameCapPx is the
     literal cap value, never read back from this page's own computed style
     (see its declaration for why that self-reference is exactly the defect
     Daybreak Blue's review found). */
  const uncapped169Height = firstBox.width * (9 / 16);
  const expectedHeight = Math.min(uncapped169Height, galleryFrameCapPx);
  expect(
    firstBox.height,
    `the art frame is ${firstBox.height}px, not the capped ${expectedHeight.toFixed(1)}px`
  ).toBeCloseTo(expectedHeight, 0);
  /* The cap must be doing real work somewhere, not coincidentally matching
     the uncapped ratio — but this test runs across every project, including
     the phone emulations, whose own viewport genuinely renders a frame
     under 360px wide (MEASURED: 356-359px), where 16:9 alone never reaches
     320px and the cap is correctly inert. Gating on the frame's own
     MEASURED width — a layout fact independent of whatever the height-cap
     token currently says — rather than on the project name (this file's own
     capability-over-project-name doctrine) restricts the strict-inequality
     proof to viewports wide enough to exercise it, without ever weakening
     what it proves there: on a desktop-width frame this still fails exactly
     as hard against the 20rem -> 200rem mutant. */
  if (firstBox.width * (9 / 16) > galleryFrameCapPx) {
    expect(
      uncapped169Height,
      `the frame is ${firstBox.width}px wide, too narrow at this viewport to prove the cap engages`
    ).toBeGreaterThan(galleryFrameCapPx);
  }
});

test('the Coding Projects subsection renders no capture-date or no-fetch caption, in the actual DOM (issue 167, Daybreak Blue round 3 finding 4)', async ({
  page,
}) => {
  /* The pre-existing pin at tests/sections.test.mjs scans the COMPONENT
     SOURCE TEXT for the removed caption's exact spellings. Daybreak Blue
     proved that pin vacuous against indirection: exporting the identical
     removed sentence as a constant from projects.ts and rendering it via
     `{projectCaption}` left every source-text scan green while the caption
     still reached the page. A source scan can only ever see literal bytes;
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
     weaker claim the Art subsection's own note could accidentally satisfy
     if it happened to avoid these exact words). */
  await expect(codingProjects.locator('h3.subsection-title')).toHaveText('Coding Projects');
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
      const stroked = node.querySelector('.chip, .ray, .chip-edge, .refresh-glyph path');
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
      chrome: [...window.document.querySelectorAll('.icon-button')].map(painted),
      swatches: [...window.document.querySelectorAll('.swatch')].map(painted),
    };
  });

test('a reading-mode swatch is painted at the same scale as the chrome icons beside it', async ({
  page,
}) => {
  await visit(page);
  await openedAndStill(page);
  const { chrome, swatches } = await readFamily(page);
  expect(chrome.length, 'the page chrome is not two icons').toBe(2);
  expect(swatches.length, 'the popover renders no swatches').toBe(5);
  expect(
    swatches.filter((swatch) => swatch.pressed).length,
    'the popover shows no chosen mode; the rest/active split below would prove nothing'
  ).toBe(1);

  /* The reference, measured rather than assumed: both header icons must agree
     with each other, or "the parent grammar" is not one thing. */
  const [reference] = chrome;
  for (const icon of chrome) {
    expect(icon.glyph, `"${icon.label}" paints no glyph`).not.toBeNull();
    expect(icon.glyph.width, `the two chrome icons paint different glyph widths`).toBeCloseTo(
      reference.glyph.width,
      1
    );
    expect(icon.glyph.height).toBeCloseTo(reference.glyph.height, 1);
  }
  /* The chrome's line weight comes from the stroked one; the filled moon has
     none, so it is read from the refresh glyph and it must be a real number. */
  const chromeStroke = chrome.map((icon) => icon.strokeWidth).find((width) => width > 0);
  expect(chromeStroke, 'no chrome icon is drawn as a stroked line icon any more').toBeGreaterThan(0);

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

  /* The reference first: the chrome answers a pointer by moving its ink to
     the brand token, and this reads that answer off the chrome ITSELF rather
     than from a variable name — so the comparison below is between two
     rendered colors and cannot pass by both sides agreeing about a token
     neither of them paints. */
  const refresh = page.getByRole('button', { name: 'Refresh all trackers' });
  const chromeRest = await refresh.evaluate((node) => getComputedStyle(node).color);
  await refresh.hover();
  await expect
    .poll(() => refresh.evaluate((node) => getComputedStyle(node).color), {
      message: 'pointing at a chrome icon no longer moves its ink; there is no family hover left',
    })
    .not.toBe(chromeRest);
  const chromeHover = await refresh.evaluate((node) => getComputedStyle(node).color);

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

test('choosing a reading mode marks it by shape, and moves nothing', async ({ page }) => {
  await visit(page);
  await openedAndStill(page);
  const marks = () =>
    page.evaluate(() => {
      const box = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return [x, y, width, height].map((value) => Math.round(value * 100) / 100);
      };
      return {
        popover: box(window.document.querySelector('#reading-mode-menu')),
        swatches: [...window.document.querySelectorAll('.swatch')].map(box),
        /* The chosen-mode mark, measured as a painted box rather than read
           off a class: a pseudo-element with no content and no size would
           satisfy every source pin and show the reader nothing. */
        marked: [...window.document.querySelectorAll('.swatch')].map((node) => {
          const after = getComputedStyle(node, '::after');
          return {
            label: node.getAttribute('aria-label'),
            pressed: node.getAttribute('aria-pressed') === 'true',
            drawn: after.content !== 'none' && after.content !== 'normal',
            width: Number.parseFloat(after.width) || 0,
            height: Number.parseFloat(after.height) || 0,
          };
        }),
      };
    });

  const before = await marks();
  /* Exactly one mode is chosen at a time, and the mark follows the choice. */
  const chosenBefore = before.marked.filter((swatch) => swatch.drawn);
  expect(chosenBefore.length, 'exactly one reading mode must carry the chosen mark').toBe(1);
  expect(chosenBefore[0].pressed, 'the mark is not on the pressed swatch').toBe(true);
  expect(
    chosenBefore[0].width * chosenBefore[0].height,
    `the chosen mark on "${chosenBefore[0].label}" is painted at ${chosenBefore[0].width}x${chosenBefore[0].height}; selection is carried by color alone`
  ).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Sepia', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia');
  await openedAndStill(page);
  const after = await marks();
  const chosenAfter = after.marked.filter((swatch) => swatch.drawn);
  expect(chosenAfter.length, 'exactly one reading mode must carry the chosen mark').toBe(1);
  expect(chosenAfter[0].label, 'the chosen mark did not follow the choice').toBe('Sepia');
  expect(chosenAfter[0].width).toBeCloseTo(chosenBefore[0].width, 1);
  expect(chosenAfter[0].height).toBeCloseTo(chosenBefore[0].height, 1);
  /* And the mark costs no space: the row it sits in is the row it sat in. */
  expect(after.popover, 'choosing a reading mode resized the popover').toEqual(before.popover);
  expect(after.swatches, 'choosing a reading mode moved the swatches').toEqual(before.swatches);
});

test('every swatch still says which palette it selects, in every reading mode', async ({ page }) => {
  await visit(page);
  const read = async () => {
    await openedAndStill(page);
    return page.evaluate(() => {
      const popover = window.document.querySelector('#reading-mode-menu');
      return {
        surface: getComputedStyle(popover).backgroundColor,
        swatches: [...window.document.querySelectorAll('.swatch')].map((node) => {
          const shape = node.querySelector('.chip, .chip-edge');
          const halves = [...node.querySelectorAll('.auto-half-light, .auto-half-dark')];
          return {
            label: node.getAttribute('aria-label'),
            /* The outline is the PAGE's ink — the one ink guaranteed legible
               on the popover in every mode, and the reason the swatch needs
               no disc behind it to be seen. */
            outline: getComputedStyle(shape).stroke,
            /* The palette: what the shape encloses, and what is drawn inside
               it. */
            fill: [...halves, ...node.querySelectorAll('.chip')].map(
              (part) => getComputedStyle(part).fill
            ),
            ink: [...node.querySelectorAll('.crater')].map((part) => getComputedStyle(part).fill),
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
    const seen = new Map();
    for (const swatch of painted.swatches) {
      /* WCAG 1.4.11: the swatch is a non-text indicator, so the mark that
         carries its silhouette clears 3:1 against what it is drawn on. The
         palette inside it deliberately does not have to — a light swatch on a
         light popover is SUPPOSED to disappear into it, which is exactly what
         the outline is for. */
      const ratio = contrastRatio(swatch.outline, painted.surface);
      expect(
        ratio,
        `in ${label} mode the "${swatch.label}" swatch outlines itself at ${ratio.toFixed(2)}:1 on the popover`
      ).toBeGreaterThanOrEqual(3);
      expect(swatch.fill.length, `"${swatch.label}" encloses no palette at all`).toBeGreaterThan(0);
      /* Every dark mode's ink is its craters, and the craters have to be
         legible on the moon they sit on or the three darks are one swatch
         drawn three times. */
      for (const ink of swatch.ink) {
        const onOwnSurface = contrastRatio(ink, swatch.fill[0]);
        expect(
          onOwnSurface,
          `in ${label} mode the "${swatch.label}" craters sit at ${onOwnSurface.toFixed(2)}:1 on their own moon`
        ).toBeGreaterThanOrEqual(3);
      }
      /* No two swatches paint the same thing. This is the requirement the
         shrink could most easily have broken: three near-black surfaces at
         18px are one shape unless each carries its own ink. */
      const signature = JSON.stringify([swatch.fill, swatch.ink]);
      expect(
        seen.get(signature),
        `in ${label} mode "${swatch.label}" is painted identically to "${seen.get(signature)}"`
      ).toBeUndefined();
      seen.set(signature, swatch.label);
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
      columnEnd: window.document.querySelector('main').getBoundingClientRect().right,
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
  expect(observed.columnEnd - observed.right).toBeLessThanOrEqual(gutterPx / 2 + subPixel);
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
      const node = cell.querySelector('.cell-tip');
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
    ['.boss-cell', 5],
    ['.skill-cell', 4],
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
    const node = cell.querySelector('.cell-tip');
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
  }, ['.boss-cell', 7]);
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
      const node = cell.querySelector('.cell-tip');
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
    ['.boss-cell', 5, gap]
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
  const start = await hoverAt(page, '.boss-cell', 5, (box) => ({
    x: Math.round(box.x + 4),
    y: Math.round(box.y + box.height / 2),
  }));
  for (const step of [2, 6, 10, 14]) {
    await page.mouse.move(start.x + step, start.y);
    const moved = await detailBox(page, '.boss-cell', 5);
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
  const at = await hoverAt(page, '.boss-cell', 5, (box) => ({
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
      const node = cell.querySelector('.cell-tip');
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
    ['.boss-cell', 5, at.x, at.y]
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
    const cells = [...window.document.querySelectorAll('.boss-cell')];
    const rightmost = Math.max(...cells.map((cell) => Math.round(cell.getBoundingClientRect().right)));
    return cells.findLastIndex(
      (cell) => Math.round(cell.getBoundingClientRect().right) === rightmost
    );
  });
  expect(lastColumn, 'no tile sits in the last column; this lane proves nothing').toBeGreaterThan(0);

  const corner = page.locator('.boss-cell').nth(lastColumn);
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
  const edge = await detailBox(page, '.boss-cell', lastColumn);

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
    const cells = [...window.document.querySelectorAll('.boss-cell')];
    let index = 0;
    let width = 0;
    cells.forEach((cell, at) => {
      const box = cell.querySelector('.cell-tip').getBoundingClientRect();
      if (box.width > width) {
        width = box.width;
        index = at;
      }
    });
    return { index, width };
  });
  const wide = page.locator('.boss-cell').nth(widest.index);
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
  const clamped = await detailBox(page, '.boss-cell', widest.index);
  expect(clamped.open, 'the widest tile did not open its detail').toBe('true');
  expect(
    clamped.left,
    `a flip put the widest detail at ${Math.round(clamped.left)}px and nothing pulled it back to the start edge`
  ).toBeCloseTo(margin, 0);
  expect(clamped.scrollWidth, 'the clamped detail grew the document').toBe(clamped.clientWidth);

  /* The other corner: a tile at the very top of the screen, where the box
     must clamp rather than flip off the top. */
  const first = page.locator('.boss-cell').first();
  await first.scrollIntoViewIfNeeded();
  await first.evaluate((cell) => {
    window.scrollBy(0, cell.getBoundingClientRect().top - 1);
  });
  const head = await settledBox(page, first);
  await page.mouse.move(0, 0);
  await page.mouse.move(Math.ceil(head.x) + 2, Math.ceil(head.y) + 2);
  const top = await detailBox(page, '.boss-cell', 0);
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
    const spot = await hoverAt(page, '.boss-cell', 5, (tile) => ({
      x: Math.round(tile.x + tile.width / 2),
      y: Math.round(tile.y + tile.height / 2),
    }));
    const shown = await detailBox(page, '.boss-cell', 5);
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
  const tile = page.locator('.boss-cell').nth(5);
  await tile.scrollIntoViewIfNeeded();
  await tile.tap();
  const shown = await detailBox(page, '.boss-cell', 5);
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
  const closed = await detailBox(page, '.boss-cell', 5);
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
    ['.boss-cell', 5],
    ['.skill-cell', 4],
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

test('the skill detail and the boss detail are the same object, measured', async ({ page }) => {
  await visit(page);

  /* The owner's second complaint, measured rather than eyeballed: the skill
     readout must not merely resemble the boss one, it must BE it. Every value
     below is read from the engine's computed style, and every one of them
     also has to resolve from a token — a raw length would pass a parity
     check and still be the drift issue #136 rule 5 forbids. */
  const measure = ([css, at]) => {
    const node = window.document.querySelectorAll(css)[at].querySelector('.cell-tip');
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
  const boss = await page.evaluate(measure, ['.boss-cell', 5]);
  const skill = await page.evaluate(measure, ['.skill-cell', 4]);

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

test('each column edge carries a handle, flush with the column and quiet until touched', async ({
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
        markWidth: mark.inlineSize === 'auto' ? mark.width : mark.inlineSize,
        markInk: mark.backgroundColor
      });
    }
    const root = getComputedStyle(window.document.documentElement);
    return {
      seen,
      quietInk: root.getPropertyValue('--page-rail-ink').trim(),
      liveInk: root.getPropertyValue('--page-rail-ink-live').trim(),
      quietLine: root.getPropertyValue('--page-rail-line').trim(),
      liveLine: root.getPropertyValue('--page-rail-line-live').trim()
    };
  });

  for (const handle of measured.seen) {
    /* A hit lane, not a hairline: the mark is two pixels and the target is the
       same 44px every other control on this page clears. */
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
    /* Quiet at rest: the idle ink token is transparent by design, so the mark
       paints NOTHING and the hairline that used to sit on the column edge is
       gone — only the 44px hit lane remains. The geometry is unaffected: the
       (invisible) mark still measures the hairline width. */
    expect(handle.markInk, `the ${handle.edge} handle paints at rest`).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(Number.parseFloat(handle.markWidth)).toBeCloseTo(
      Number.parseFloat(measured.quietLine),
      1
    );
  }
  expect(measured.quietInk, 'the idle rail ink token is no longer transparent').toBe('transparent');
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

  /* Hover answers in the brand ink, and it is a DIFFERENT ink from the resting
     one: a mark that painted the same colour in both states would satisfy a
     one-sided assertion while offering the reader no feedback at all. */
  const mark = () =>
    page.evaluate(() => {
      const style = getComputedStyle(
        window.document.querySelector('.column-handle[data-edge="end"]'),
        '::before'
      );
      return {
        width: style.inlineSize === 'auto' ? style.width : style.inlineSize,
        ink: style.backgroundColor
      };
    });
  const resting = measured.seen[0];
  await page.locator('.column-handle[data-edge="end"]').hover();
  /* Polled rather than read once: the mark fades between the two inks where
     the reader has not asked for less motion, so a single read taken on the
     hover would measure the resting colour and call it the hovered one. */
  await expect
    .poll(
      async () => {
        const now = await mark();
        return now.ink !== resting.markInk && Number.parseFloat(now.width) > Number.parseFloat(measured.quietLine);
      },
      { message: 'the handle never answered the pointer' }
    )
    .toBe(true);
  await expect
    .poll(async () => Number.parseFloat((await mark()).width), {
      message: 'the hovered mark never reached its full width'
    })
    .toBeCloseTo(Number.parseFloat(measured.liveLine), 1);
  const hovered = await mark();
  expect(hovered.ink, 'the handle paints the same ink hovered as at rest').not.toBe(resting.markInk);
  expect(
    contrastRatio(hovered.ink, resting.markInk),
    'the hovered mark is indistinguishable from the resting one'
  ).toBeGreaterThan(1.2);

  /* Focus wears the site's own ring — the same width, token and offset as
     every other focusable thing on the page. */
  await page.locator('.column-handle[data-edge="end"]').focus();
  const focused = await page.evaluate(() => {
    const ring = getComputedStyle(window.document.querySelector('.column-handle[data-edge="end"]'));
    const icon = getComputedStyle(window.document.querySelector('.icon-button'));
    return {
      handle: [ring.outlineWidth, ring.outlineStyle, ring.outlineColor, ring.outlineOffset],
      accent: getComputedStyle(window.document.documentElement).getPropertyValue('--color-accent').trim(),
      iconFocusable: icon.outlineColor
    };
  });
  expect(focused.handle[1], 'a focused handle draws no ring').not.toBe('none');
  expect(Number.parseFloat(focused.handle[0])).toBeGreaterThanOrEqual(2);
  expect(Number.parseFloat(focused.handle[3])).toBeGreaterThanOrEqual(2);
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
       column is the screen less its two gutters, and nothing scrolls
       sideways. */
    expect(column.width).toBeCloseTo(Math.min(60 * column.rem, width - gutterPx), 0);
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
      const grid = window.document.querySelector('.boss-grid');
      const cells = [...grid.querySelectorAll('.boss-cell')];
      const distinct = (values) => new Set(values.map((value) => Math.round(value))).size;
      const frames = [...window.document.querySelectorAll('.art-frame')].map((frame) => {
        const box = frame.getBoundingClientRect();
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
    expect(state.navLinks, `the nav lost links ${at}`).toBeGreaterThan(3);
    expect(state.sections, `the page lost a section ${at}`).toBeGreaterThan(3);
    /* The pictures still reserve the box they will fill: 16:9 below the
       tokenized cap (issue 157), the cap itself above it — a narrow column
       still gets the full photograph proportion, and a wide one stops
       growing the frame instead of reproducing the complaint the cap
       exists to fix. galleryFrameCapPx is the literal cap value, never the
       page's own computed style (see its declaration for why) — this is
       what makes the assertion below independent, rather than the
       self-referential shape Daybreak Blue's review of PR #161 found: a
       mutation that widened the token could no longer widen its own
       expectation along with it.
       (This viewport is the narrow "rails" one the handle needs to exist at
       all — MEASURED: even the widest column this sweep can reach keeps the
       art card's own max-inline-size under ~569px, so the uncapped 16:9
       height here never clears 320px by a comfortable margin. The
       unambiguous "the cap is doing real work, not coincidentally equal to
       the uncapped ratio" proof lives in the dedicated single-frame test
       above instead, at a viewport wide enough to make that margin real.) */
    expect(state.frames.length, `the art feed rendered no frames ${at}`).toBeGreaterThan(0);
    for (const frame of state.frames) {
      const expectedHeight = Math.min(frame.width * (9 / 16), galleryFrameCapPx);
      expect(
        frame.height,
        `an art frame is ${frame.height.toFixed(1)}px, not the capped ${expectedHeight.toFixed(1)}px ${at}`
      ).toBeCloseTo(expectedHeight, 0);
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

test('the reading-mode popover still fits the column at its narrowest', async ({ page }) => {
  /* The popover is anchored to the end edge of the header, and the header IS
     the column — so the narrowest column the handle can reach is the width the
     popover has to live in. It was measured against a 320px PHONE before this
     feature existed; a reader can now produce that same 288px column on a
     desktop, with a popover that phone never had to fit beside anything. */
  await page.setViewportSize({ width: railsBreakpointPx, height: 900 });
  await visit(page);
  await expect(handles(page)).toHaveCount(2);
  await page.evaluate(() => {
    window.document.documentElement.style.setProperty(
      '--page-column-width',
      getComputedStyle(window.document.documentElement).getPropertyValue('--page-column-min').trim()
    );
  });
  await settled(page);
  await openReadingModes(page);
  const observed = await page.evaluate(() => {
    const popover = window.document.querySelector('#reading-mode-menu').getBoundingClientRect();
    const column = window.document.querySelector('main').getBoundingClientRect();
    const root = window.document.documentElement;
    return {
      popover: { left: popover.left, right: popover.right, width: popover.width },
      column: { left: column.left, right: column.right, width: column.width },
      swatches: window.document.querySelectorAll('#reading-mode-menu button').length,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth
    };
  });
  /* Every choice still rendered, the whole popover still on the page, and the
     page still not scrolling sideways. (Measured at the shipped minimum: a
     270px popover inside a 288px column, 414px clear of the page edge.) */
  expect(observed.swatches, 'the reading modes lost a swatch in a narrow column').toBe(5);
  expect(observed.column.width, 'the column did not reach its minimum').toBeLessThan(300);
  expect(
    observed.popover.left,
    `the popover starts ${observed.popover.left}px from the page edge`
  ).toBeGreaterThanOrEqual(0);
  expect(observed.popover.right).toBeLessThanOrEqual(observed.clientWidth + subPixel);
  /* And it belongs to its column rather than merely to the window: a popover
     hanging past the card it opens over reads as a control that came loose. */
  expect(
    observed.popover.right,
    'the popover no longer ends on the column edge it is anchored to'
  ).toBeLessThanOrEqual(observed.column.right + subPixel);
  expect(
    observed.popover.width,
    `a ${observed.popover.width}px popover does not fit a ${observed.column.width}px column`
  ).toBeLessThanOrEqual(observed.column.width);
  expect(observed.scrollWidth).toBe(observed.clientWidth);
});
