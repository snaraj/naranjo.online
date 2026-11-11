/* Forced colors (Windows High Contrast and its kin): the reader's palette
 * replaces the site's, and the page must stay legible under it. Only the
 * `forced-colors` project runs this file, on Chromium, the one engine that
 * emulates the mode.
 *
 * The assertion is the basic one: every element that paints text of its own
 * paints it at the 4.5:1 text floor against the first opaque background
 * behind it, or the forced Canvas where there is none. A component that opts
 * out of the reader's palette (`forced-color-adjust: none`) is held to the
 * same floor with its own colors. */
import { readFileSync } from 'node:fs';

import { expect, test } from './csp-watch.mjs';

const manifest = JSON.parse(readFileSync(new URL('../../compliance.json', import.meta.url), 'utf8'));
const pages = ['/', ...manifest.legalPages.filter((entry) => entry.status === 'published').map((entry) => entry.path)];

for (const path of pages) {
  test(`${path} keeps every line of text legible in forced colors`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), 'forced colors are not active').toBe(true);
    const illegible = await page.evaluate(() => {
      const channels = (value) => (value.match(/[\d.]+/g) ?? []).map(Number);
      const luminance = ([r, g, b]) =>
        [r, g, b]
          .map((channel) => channel / 255)
          .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
          .reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
      const canvas = (() => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = 'Canvas';
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      })();
      const behind = (element) => {
        for (let node = element; node; node = node.parentElement) {
          const color = channels(getComputedStyle(node).backgroundColor);
          if (color.length === 3 || (color.length === 4 && color[3] === 1)) return color.slice(0, 3);
        }
        return channels(canvas).slice(0, 3);
      };
      const found = [];
      for (const element of document.body.querySelectorAll('*')) {
        const own = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        const style = getComputedStyle(element);
        if (!own || style.visibility !== 'visible' || element.getClientRects().length === 0) continue;
        const ink = channels(style.color);
        if (ink.length === 4 && ink[3] === 0) continue;
        const [light, dark] = [luminance(ink.slice(0, 3)), luminance(behind(element))].sort((a, b) => b - a);
        const ratio = (light + 0.05) / (dark + 0.05);
        if (ratio < 4.5) found.push(`${element.tagName.toLowerCase()} "${element.textContent.trim().slice(0, 40)}" at ${ratio.toFixed(2)}:1`);
      }
      return found;
    });
    expect(illegible, 'text below the 4.5:1 floor in forced colors').toEqual([]);
  });
}
