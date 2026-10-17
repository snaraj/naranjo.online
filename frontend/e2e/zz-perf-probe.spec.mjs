/* TEMPORARY MEASUREMENT, removed by the next commit: what each layer of the
 * Keep costs WebKit on the CI runner, where the frame-rate and timing lanes
 * fail and a laptop cannot reproduce the runner's speed. Prints, asserts
 * nothing that can fail. */
import { test } from '@playwright/test';

test.use({ bypassCSP: true });

const off = {
  shadow: 'main, main::before { box-shadow: none !important; }',
  frame: 'main::before { border-image: none !important; }',
  sheet: 'main::before { background-image: none !important; }',
  before: 'main::before { display: none !important; }',
  sky: '.night-sky { display: none !important; }',
  rock: '.j-flight::before { animation-name: j-flight-row, j-flight-sheet !important; }',
  jsprite: '.j-flight::before { animation: none !important; }',
  glow: '.chronicle-cell { animation: none !important; }',
  ticker: '.ticker-run { animation: none !important; }',
};
const variants = [
  ['asBuilt', []],
  ['noShadow', ['shadow']],
  ['noFrame', ['frame']],
  ['noSheet', ['sheet']],
  ['noBefore', ['before']],
  ['noSky', ['sky']],
  ['noRock', ['rock']],
  ['noGlow', ['glow']],
  ['noTicker', ['ticker']],
  ['bare', ['before', 'sky', 'glow']],
];

const sampleJ = (page) =>
  page.locator('.j-flight').evaluate(
    (node) =>
      new Promise((done) => {
        const positions = new Set();
        const times = [];
        const opened = performance.now();
        const sample = (now) => {
          times.push(now);
          positions.add(getComputedStyle(node, '::before').backgroundPosition);
          if (performance.now() - opened < 1200) requestAnimationFrame(sample);
          else {
            const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
            done({ distinct: positions.size, median: Math.round(gaps[Math.floor(gaps.length / 2)] ?? -1) });
          }
        };
        requestAnimationFrame(sample);
      })
  );

const gapsHere = (page) =>
  page.evaluate(
    () =>
      new Promise((done) => {
        const times = [];
        const opened = performance.now();
        const mark = (now) => {
          times.push(now);
          if (performance.now() - opened < 1500) requestAnimationFrame(mark);
          else {
            const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
            done({ median: Math.round(gaps[Math.floor(gaps.length / 2)] ?? -1), p90: Math.round(gaps[Math.floor(gaps.length * 0.9)] ?? -1) });
          }
        };
        requestAnimationFrame(mark);
      })
  );

for (const [name, keys] of variants) {
  test(`zz perf probe: ${name}`, async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit', 'the probe measures WebKit only');
    test.setTimeout(60_000);
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
    const opened = Date.now();
    await page.goto('/');
    await page.waitForSelector('.j-flight');
    const loaded = Date.now() - opened;
    await page.waitForTimeout(2500);
    const top = [await sampleJ(page), await sampleJ(page)];
    await page.locator('.chronicle').scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);
    const trackers = await gapsHere(page);
    console.log(
      `PROBE ${test.info().project.name} ${name} load=${loaded}ms J=${top.map((s) => `${s.distinct}/${s.median}ms`).join(',')} trackers=${trackers.median}/${trackers.p90}ms`
    );
  });
}
