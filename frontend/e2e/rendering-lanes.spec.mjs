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

test('the page fills a wide viewport and tiles its panels across it', async ({ page }) => {
  await visit(page);
  for (const width of desktopWidths) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    const observed = await page.evaluate(() => {
      const stack = window.document.querySelector('.panel-stack');
      const main = window.document.querySelector('main');
      return {
        viewport: window.document.documentElement.clientWidth,
        main: main.getBoundingClientRect().width,
        stack: stack.getBoundingClientRect().width,
        tracks: getComputedStyle(stack).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
        cards: [...window.document.querySelectorAll('.panel-shell')].map(
          (card) => Math.round(card.getBoundingClientRect().width)
        ),
      };
    });
    /* The gutter is the only thing between the content and the edge. A page
       that still centred a 480px ribbon would fail here by ~900px, which is
       the defect the directive names. */
    expect(
      observed.main,
      `the page holds ${observed.main}px of a ${observed.viewport}px viewport`
    ).toBeCloseTo(observed.viewport - gutterPx, 0);
    expect(observed.stack).toBeCloseTo(observed.viewport - gutterPx, 0);
    /* Filling with CARDS, not with one wide card: the tracks are what turn
       a wider viewport into more panels side by side. */
    expect(
      observed.tracks,
      `${observed.viewport}px lays out ${observed.tracks} column(s) of panels`
    ).toBeGreaterThan(1);
    /* And no card is stretched across the whole page — the arrangement the
       owner rejected would show up here as one card at viewport width. */
    for (const card of observed.cards) {
      expect(card, `a card is ${card}px wide in a ${observed.viewport}px viewport`).toBeLessThan(
        observed.viewport - gutterPx
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

test('the boss log scrolls sideways, and its detail escapes the strip', async ({ page }) => {
  await visit(page);
  const strip = await page.evaluate(() => {
    const box = window.document.querySelector('.boss-grid');
    const style = getComputedStyle(box);
    return {
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      scrollWidth: box.scrollWidth,
      clientWidth: box.clientWidth,
      scrollHeight: box.scrollHeight,
      clientHeight: box.clientHeight,
      /* The two tile rows the strip is bounded to, as the engine actually
         laid them out — measured from the tiles rather than from the CSS,
         because the whole question is whether the box the engine gave the
         scrollbar still holds them. */
      rows: [...box.querySelectorAll('.boss-cell')]
        .map((cell) => Math.round(cell.getBoundingClientRect().top))
        .filter((top, index, tops) => tops.indexOf(top) === index).length,
      tileHeight: box.querySelector('.boss-cell')?.getBoundingClientRect().height ?? 0,
      icons: box.querySelectorAll('img.boss-icon').length,
    };
  });
  /* Sideways, and only sideways: the tallies used to fill a tall box that
     scrolled DOWN inside the card, which on a phone put a scroll region
     under the same thumb as the page's own. */
  expect(strip.overflowX).toBe('auto');
  expect(strip.overflowY).toBe('hidden');
  expect(
    strip.scrollWidth,
    'the boss strip fits its box; there is no sideways scroll left to prove'
  ).toBeGreaterThan(strip.clientWidth);
  expect(strip.scrollHeight, 'the boss strip scrolls downward as well as across').toBe(
    strip.clientHeight
  );
  /* And the box the engine left after taking its scrollbar still holds both
     rows whole. This is the assertion a fixed block-size fails: the scrollbar
     comes OUT of a fixed box, so a strip sized to exactly two rows shows one
     and a half wherever scrollbars are classic rather than overlaid — Linux
     and Windows both, which no macOS run would ever reveal. Sized by its rows
     instead, the box grows by exactly the scrollbar it was given. */
  expect(strip.rows, 'the boss strip is not two rows of tiles').toBe(2);
  expect(
    strip.clientHeight,
    `the strip has ${strip.clientHeight}px for two ${strip.tileHeight}px rows; its bottom row is clipped`
  ).toBeGreaterThanOrEqual(strip.tileHeight * 2 - subPixel);
  /* The owner locked the vendored art exactly as it renders, so the lane
     counts what actually painted rather than trusting the markup. */
  expect(strip.icons, 'the boss strip rendered no icons').toBeGreaterThan(50);

  /* The detail readout is the part a sideways strip breaks: anchored inside
     a scroller it is clipped by the scroller's own edge, and it must not
     widen the strip it floats over either. Both are measured on the FIRST
     tile, which is the one a clipping bug cuts in half. */
  const before = await page.evaluate(() => window.document.querySelector('.boss-grid').scrollWidth);
  await page.locator('.boss-cell').first().hover();
  const tip = await page.evaluate(() => {
    const node = window.document.querySelector('.boss-cell .boss-tip');
    const box = window.document.querySelector('.boss-grid');
    const shown = node.getBoundingClientRect();
    const region = box.getBoundingClientRect();
    return {
      visibility: getComputedStyle(node).visibility,
      top: shown.top,
      bottom: shown.bottom,
      height: shown.height,
      stripTop: region.top,
      scrollWidth: box.scrollWidth,
      pageScrolls:
        window.document.documentElement.scrollWidth >
        window.document.documentElement.clientWidth,
    };
  });
  expect(tip.visibility, 'the boss detail does not appear on hover').toBe('visible');
  expect(tip.height, 'the boss detail rendered with no height').toBeGreaterThan(0);
  expect(
    tip.bottom,
    'the boss detail is drawn inside the strip that clips it'
  ).toBeLessThanOrEqual(tip.stripTop + 1);
  expect(tip.scrollWidth, 'the detail widened the strip it floats over').toBe(before);
  expect(tip.pageScrolls, 'the detail made the page scroll sideways').toBe(false);
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
     page's own gutter. The arrangement the owner rejected — one control above
     the title and one below it — fails the first of these by hundreds of
     pixels. */
  const [first, second] = observed.icons;
  expect(Math.abs(first.top - second.top), 'the two icons are stacked, not paired').toBeLessThan(4);
  expect(
    second.left - first.right,
    'the two icons are not beside each other'
  ).toBeLessThan(touchFloorPx / 2);
  expect(
    observed.viewport - second.right,
    `the pair sits ${observed.viewport - second.right}px from the page's end edge`
  ).toBeLessThanOrEqual(gutterPx / 2 + subPixel);
});

test('a panel with no series renders the graph, not a sentence where it goes', async ({ page }) => {
  await visit(page);
  const observed = await page.evaluate(() => {
    const notes = [...window.document.querySelectorAll('.grid-empty')];
    return {
      notes: notes.map((node) => node.textContent.trim()),
      chrome: notes.map((node) => {
        const block = node.closest('.grid-block');
        return {
          placeholders: block.querySelectorAll('[data-grid-pending]').length,
          datapoints: block.querySelectorAll('[data-grid-cell]').length,
          stripHeight: Math.round(block.querySelector('.grid-strip').getBoundingClientRect().height),
        };
      }),
      /* The strip a panel WITH data renders, to compare the empty one's
         geometry against: an empty panel that is a different height from a
         full one shifts the page the day its series arrives. */
      filled: [...window.document.querySelectorAll('.grid-block')]
        .filter((block) => block.querySelector('[data-grid-cell]'))
        .map((block) => Math.round(block.querySelector('.grid-strip').getBoundingClientRect().height)),
    };
  });
  expect(observed.notes.length, 'no panel is in its pending state; this lane proves nothing').toBeGreaterThan(0);
  for (const note of observed.notes) {
    expect(note).toBe('series pending');
    /* The retired copy explained the origin's refresh configuration to a
       visitor who had asked about tokens. */
    expect(note).not.toContain('refresh');
  }
  for (const block of observed.chrome) {
    /* The graph's chrome is there... */
    expect(block.placeholders, 'the pending panel renders no graph at all').toBeGreaterThan(300);
    /* ...and contains exactly as many datapoints as the source reported. */
    expect(block.datapoints, 'the pending panel rendered datapoints it was never given').toBe(0);
    expect(observed.filled, 'no filled grid to compare against').not.toHaveLength(0);
    expect(
      block.stripHeight,
      'an empty graph is a different height from a full one; the page will shift when data arrives'
    ).toBe(observed.filled[0]);
  }
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
