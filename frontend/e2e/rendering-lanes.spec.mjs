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
     genuinely is. It is that anything too wide scrolls in ITS OWN box. So
     every element wider than the viewport must sit inside an ancestor that
     scrolls, and the page must not be that ancestor (asserted above). */
  const wide = await page.evaluate(() => {
    const scrolls = (node) => {
      const overflow = getComputedStyle(node).overflowX;
      return overflow === 'auto' || overflow === 'scroll';
    };
    const contained = [];
    const escaping = [];
    for (const node of window.document.querySelectorAll('body *')) {
      if (node.scrollWidth <= window.document.documentElement.clientWidth) continue;
      const name = `${node.tagName.toLowerCase()}.${node.className}`;
      let held = false;
      for (let parent = node; parent instanceof HTMLElement; parent = parent.parentElement) {
        if (scrolls(parent)) held = true;
      }
      (held ? contained : escaping).push(name);
    }
    return { contained, escaping };
  });
  expect(wide.escaping, 'content wider than the phone with no scrolling ancestor').toEqual([]);
  /* And the check is not vacuous: this page really does render content wider
     than a 320px phone — the contribution grids — so a run that finds none has
     stopped rendering the thing the floor is about. */
  expect(
    wide.contained.length,
    'nothing on the page is wider than the narrowest phone any more; this lane no longer proves containment'
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
  await openReadingModes(page);
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const after = await geometry();

  /* Assert the switch actually happened before asserting nothing moved —
     otherwise a toggle that did nothing at all would pass this test
     perfectly. */
  expect(after.surface, 'the reading mode changed nothing on screen').not.toBe(before.surface);
  expect(after.boxes, 'the reading-mode swap moved the page under the reader').toEqual(before.boxes);
  expect(after.scrollHeight).toBe(before.scrollHeight);
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
