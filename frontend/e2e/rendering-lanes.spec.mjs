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

test('the sepia swatch stays legible whatever the engine can mix', async ({ page }) => {
  await visit(page);
  await openReadingModes(page);
  const swatch = page.getByRole('button', { name: 'Sepia', exact: true });
  const painted = await swatch.evaluate((node) => ({
    mixes: CSS.supports('color: color-mix(in srgb, currentColor 50%, transparent)'),
    ink: getComputedStyle(node).color,
    surface: getComputedStyle(node).backgroundColor,
    pageInk: getComputedStyle(window.document.documentElement).color,
  }));
  /* The failure this guards is invisible rather than ugly: without a base
     declaration under the color-mix, an engine that cannot mix drops the whole
     thing and the glyph inherits the PAGE's ink — near-black on a near-black
     swatch. So the ink must be the swatch's own, and it must clear WCAG
     1.4.11's 3:1 for a non-text indicator either way. */
  expect(painted.ink, 'the sepia glyph fell back to the page ink').not.toBe(painted.pageInk);
  const ratio = contrastRatio(painted.ink, painted.surface);
  expect(
    ratio,
    `the sepia glyph sits at ${ratio.toFixed(2)}:1 on its own swatch (color mixing ${painted.mixes ? 'supported' : 'unsupported'} here)`
  ).toBeGreaterThanOrEqual(3);
});

test('switching the reading mode repaints without moving anything', async ({ page }) => {
  await visit(page);
  const geometry = () =>
    page.evaluate(() => {
      const boxes = {};
      for (const selector of ['#app', '.page-header', 'main', 'h1', '.panel-stack']) {
        const node = window.document.querySelector(selector);
        if (node === null) continue;
        const { x, y, width, height } = node.getBoundingClientRect();
        boxes[selector] = [x, y, width, height].map((value) => Math.round(value * 100) / 100);
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

test('the boss log is three columns that never scroll, and its detail sits on its tile', async ({
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

  /* The detail belongs to the tile it describes now that no scroller clips
     it: it is drawn directly above its OWN cell rather than at one fixed
     readout position that would be twenty rows away from most of them. */
  await page.locator('.boss-cell').first().hover();
  const tip = await page.evaluate(() => {
    const cell = window.document.querySelector('.boss-cell');
    const node = cell.querySelector('.boss-tip');
    const shown = node.getBoundingClientRect();
    return {
      visibility: getComputedStyle(node).visibility,
      bottom: shown.bottom,
      height: shown.height,
      cellTop: cell.getBoundingClientRect().top,
      pageScrolls:
        window.document.documentElement.scrollWidth >
        window.document.documentElement.clientWidth,
    };
  });
  expect(tip.visibility, 'the boss detail does not appear on hover').toBe('visible');
  expect(tip.height, 'the boss detail rendered with no height').toBeGreaterThan(0);
  expect(tip.bottom, 'the boss detail is not drawn above its own tile').toBeLessThanOrEqual(
    tip.cellTop + 1
  );
  expect(tip.pageScrolls, 'the detail made the page scroll sideways').toBe(false);

  /* And the containment rule that replaced the scroller's clipping, measured
     where it decides: the LAST column at the NARROWEST viewport. A detail is
     wider than a tile, so a start-anchored one in the third column hangs past
     the card — and with no clipping ancestor left, that drags the document
     sideways, which is the floor this page is pinned against. */
  await page.setViewportSize({ width: phoneWidths[0], height: 720 });
  await settled(page);
  await page.locator('.boss-cell').nth(2).hover();
  const edge = await page.evaluate(() => {
    const cell = window.document.querySelectorAll('.boss-cell')[2];
    const node = cell.querySelector('.boss-tip');
    const card = window.document.querySelector('.boss-grid').closest('.panel-shell');
    const shown = node.getBoundingClientRect();
    const frame = card.getBoundingClientRect();
    return {
      visibility: getComputedStyle(node).visibility,
      left: shown.left,
      right: shown.right,
      cardLeft: frame.left,
      cardRight: frame.right,
      pageScrolls:
        window.document.documentElement.scrollWidth >
        window.document.documentElement.clientWidth,
    };
  });
  expect(edge.visibility, 'the last column detail does not appear on hover').toBe('visible');
  expect(
    edge.right,
    `the last column detail reaches ${edge.right}px past a card ending at ${edge.cardRight}px`
  ).toBeLessThanOrEqual(edge.cardRight + subPixel);
  expect(edge.left).toBeGreaterThanOrEqual(edge.cardLeft - subPixel);
  expect(edge.pageScrolls, 'the last column detail made the page scroll sideways').toBe(false);
});

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
 * agree with every regression it was written to catch. */
test('a source with no series renders no graph, and one with a series still renders all of it', async ({
  page,
}) => {
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
    'the origin reports a series for every source, so nothing here proves an absent one renders nothing'
  ).toBeGreaterThan(0);
  expect(
    drawn.length,
    'the origin reports no series at all; a page with no heatmaps would pass the other half for free'
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
  await page.goto('/');
  const measure = () =>
    page.evaluate(() => {
      const card = window.document.querySelector('[data-activity-panel]');
      const block = card === null ? null : card.querySelector('.grid-block');
      if (block === null) return null;
      const box = (node) => Math.round(node.getBoundingClientRect().height);
      return {
        state: block.getAttribute('data-grid-state'),
        datapoints: block.querySelectorAll('[data-grid-cell]').length,
        strip: box(block.querySelector('.grid-strip')),
        block: box(block),
        card: box(card),
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
  /* And the box is the ratio the pictures are: 16:9, held open before a byte
     of them arrives. */
  expect(firstBox.width / firstBox.height).toBeCloseTo(16 / 9, 1);
});
