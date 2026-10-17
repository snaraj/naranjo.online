/* TEMPORARY MEASUREMENT, removed by the next commit: what each moving layer of
 * the Keep costs WebKit on the CI runner at a desktop width, where settled()
 * now finds no two rendered frames within two seconds on the iPhone profile
 * and clicks wait 30s for a stable target. Prints, asserts nothing that can
 * fail. */
import { test } from '@playwright/test';

test.use({ bypassCSP: true });

const off = {
  sky: '.night-sky { display: none !important; }',
  glow: '.chronicle-cell { animation: none !important; }',
  j: '.j-flight::before { animation: none !important; }',
  ticker: '.ticker-run { animation: none !important; }',
  anim: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  sheet: 'main::before { display: none !important; }',
  sheetLayer: 'main::before { will-change: transform; }',
  skyLayer: '.night-sky { will-change: transform; }',
};
const variants = [
  ['asBuilt', []],
  ['noSky', ['sky']],
  ['noGlow', ['glow']],
  ['noJ', ['j']],
  ['noTicker', ['ticker']],
  ['noAnim', ['anim']],
  ['still', ['sky', 'anim']],
  ['noSheet', ['sheet']],
  ['sheetLayer', ['sheetLayer']],
  ['skyLayer', ['skyLayer']],
];

const gaps = (page) =>
  page.evaluate(
    () =>
      new Promise((done) => {
        const times = [];
        const opened = performance.now();
        const mark = (now) => {
          times.push(now);
          if (performance.now() - opened < 2500) requestAnimationFrame(mark);
          else {
            const spans = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
            done(`${spans.length}f/${Math.round(spans[Math.floor(spans.length / 2)] ?? -1)}ms/${Math.round(spans[spans.length - 1] ?? -1)}max`);
          }
        };
        requestAnimationFrame(mark);
      })
  );

for (const [name, keys] of variants) {
  test(`zz perf probe: ${name}`, async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit', 'the probe measures WebKit only');
    test.setTimeout(90_000);
    const rule = keys.map((key) => off[key]).join('\n');
    if (rule) {
      await page.addInitScript((css) => {
        document.addEventListener('DOMContentLoaded', () => {
          const style = document.createElement('style');
          style.textContent = css;
          document.head.append(style);
        });
      }, rule);
    }
    await page.goto('/');
    await page.waitForTimeout(2500);
    const native = await gaps(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(2500);
    const wide = await gaps(page);
    await page.locator('.chronicle').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    const trackers = await gaps(page);
    console.log(`PROBE ${test.info().project.name} ${name} native=${native} wide=${wide} wideTrackers=${trackers}`);
  });
}
