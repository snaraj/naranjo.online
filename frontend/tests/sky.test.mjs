/* THE NIGHT SKY (owner direction, 2026-10-16: "a starry night … not super
 * scary, fast, flashy … subtle"). The sky is decorative and it moves, so the
 * two promises it has to keep are the page's own motion floor — a reader who
 * asked for reduced motion gets a still sky — and that a background never
 * costs the reader anything: it is fixed, takes no room, never takes a
 * pointer, and stops working the moment the page is not on screen. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  driftX,
  nebulaPixels,
  nextSkyInterval,
  noiseField,
  seeded,
  skyCostShare,
  skyFrameBudget,
  skyFrameInterval,
  skyMaxPixelRatio,
  skySlowestInterval,
  skyPreset,
  starField,
  twinkle
} from '../src/lib/sky.ts';

const component = await readFile(new URL('../src/lib/components/NightSky.svelte', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8');

test('the sky is decorative, fixed and out of the way', () => {
  assert.match(component, /<canvas class="night-sky" bind:this=\{canvas\} aria-hidden="true"><\/canvas>/);
  const rule = component.match(/\.night-sky \{([^}]*)\}/)?.[1] ?? '';
  assert.match(rule, /position: fixed;/, 'a sky in the flow would push the page');
  assert.match(rule, /pointer-events: none;/, 'the sky must never take a pointer');
  assert.match(rule, /z-index: -1;/, 'the sky sits behind everything');
  assert.equal((app.match(/<NightSky \/>/g) ?? []).length, 1, 'one sky, mounted once');
});

test('a reader who asked for less motion gets one still frame', () => {
  assert.match(component, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  // The loop re-arms only when motion is welcome and the page is visible…
  assert.match(component, /if \(document\.hidden \|\| quiet\.matches\) \{\s*return;\s*\}\s*frame = requestAnimationFrame\(tick\);/);
  assert.match(component, /if \(!document\.hidden && !quiet\.matches\) \{\s*frame = requestAnimationFrame\(tick\);/);
  // …and the preference, the page's visibility and the size are all listened
  // to, and all released when the sky unmounts.
  for (const [add, remove] of [
    ["addEventListener('resize', onResize)", "removeEventListener('resize', onResize)"],
    ["document.addEventListener('visibilitychange', start)", "document.removeEventListener('visibilitychange', start)"],
    ["quiet.addEventListener('change', start)", "quiet.removeEventListener('change', start)"]
  ]) {
    assert.ok(component.includes(add), `missing ${add}`);
    assert.ok(component.includes(remove), `missing ${remove}`);
  }
});

test('the loop is capped, and the canvas never draws past what a soft background needs', () => {
  assert.ok(skyFrameInterval >= 1000 / 30, 'a slow sky needs no more than thirty frames a second');
  assert.ok(skyMaxPixelRatio <= 2);
  assert.match(component, /let interval = skyFrameInterval;/);
  assert.match(component, /if \(now - last < interval\) \{/);
  assert.match(component, /Math\.min\(devicePixelRatio \|\| 1, skyMaxPixelRatio\)/);
});

/* The sky never takes the page's frames: where a sky frame costs the page more
 * than the budget (a browser drawing without a GPU), the sky slows down rather
 * than the page, and where it is cheap the sky keeps its ceiling. */
test('the sky slows down where the page cannot afford it, and only there', () => {
  // A page that answers in time keeps the sky at its ceiling, never above it.
  assert.equal(nextSkyInterval(skyFrameInterval, 17), skyFrameInterval);
  assert.equal(nextSkyInterval(skyFrameInterval, skyFrameBudget), skyFrameInterval);
  // A slow answer gives the page ten times the sky frame's cost before the
  // next one, at once, and at least halves the rate; repeated ones stop at
  // the floor.
  assert.equal(nextSkyInterval(skyFrameInterval, 60), 60 * skyCostShare);
  assert.equal(nextSkyInterval(400, 60), 800);
  assert.equal(nextSkyInterval(skyFrameInterval, 300), skySlowestInterval);
  assert.ok(skyCostShare >= 10, 'the sky takes more than a tenth of a slow page');
  let interval = skyFrameInterval;
  for (let frame = 0; frame < 20; frame += 1) {
    interval = nextSkyInterval(interval, 88);
  }
  assert.equal(interval, skySlowestInterval);
  assert.ok(skySlowestInterval <= 1000, 'the slowest sky still moves once a second');
  // When the page answers in time again, the sky climbs back to its ceiling.
  for (let frame = 0; frame < 20; frame += 1) {
    interval = nextSkyInterval(interval, 17);
  }
  assert.equal(interval, skyFrameInterval);
  // The loop measures the frame after each drawing, and forgets it when the
  // loop restarts, so a hidden spell is not read as a slow frame.
  assert.match(
    component,
    /if \(drawnAt >= 0\) \{\s*interval = nextSkyInterval\(interval, now - drawnAt\);\s*drawnAt = -1;\s*\}/
  );
  assert.match(component, /draw\(\(now - started\) \/ 1000\);\s*drawnAt = now;/);
  assert.match(component, /function start\(\): void \{\s*cancelAnimationFrame\(frame\);\s*frame = 0;\s*drawnAt = -1;/);
});

test('the same sky on every load: the generator, the noise and the stars are seeded', () => {
  const a = seeded(42);
  const b = seeded(42);
  for (let index = 0; index < 5; index += 1) {
    assert.equal(a(), b());
  }
  const field = noiseField(7);
  assert.equal(field(1.3, 2.7), noiseField(7)(1.3, 2.7));
  assert.deepEqual(starField(400, 300, skyPreset.stars, 17), starField(400, 300, skyPreset.stars, 17));
  const count = starField(1000, 1000, skyPreset.stars, 17).length;
  assert.equal(count, Math.round(1000 * 1000 * skyPreset.stars.density));
});

test('stars twinkle slowly and stay within their own brightness', () => {
  const stars = starField(800, 600, skyPreset.stars, 17);
  const [shortest, longest] = skyPreset.stars.period;
  assert.ok(shortest >= 2, 'nothing on this sky blinks faster than every two seconds');
  for (const star of stars) {
    for (const t of [0, 1.7, 5.3, 11.1]) {
      const alpha = twinkle(star, t);
      assert.ok(alpha >= 0 && alpha <= star.base + 1e-9, 'a star never outshines itself');
    }
    const period = (2 * Math.PI) / star.speed;
    assert.ok(period >= shortest - 1e-9 && period <= longest + 1e-9);
  }
  // A stepped twinkle lands on its steps.
  const one = stars[0];
  const stepped = twinkle(one, 3.3, 3) / one.base;
  assert.ok([0, 1, 2, 3].some((step) => Math.abs(stepped - step / 3) < 1e-9));
});

test('the nebula is pixels of the preset’s own ramp', () => {
  const nebula = skyPreset.nebula;
  assert.ok(nebula, 'the preset carries a nebula');
  const pixels = nebulaPixels(32, 20, nebula);
  assert.equal(pixels.length, 32 * 20 * 4);
  assert.ok(pixels.some((value, index) => index % 4 === 3 && value > 0), 'some of the nebula is visible');
  assert.ok(pixels.some((value, index) => index % 4 === 3 && value === 0), 'and some of the sky is clear');
});

test('the drift glides right to left and never runs out', () => {
  const drift = skyPreset.stars.drift;
  assert.ok(drift && drift.length > 0, 'the page sky drifts (owner pick, 2026-10-16)');
  // 15% faster than the gallery's 2, 5 and 9 pixels a second.
  assert.deepEqual(drift, [2.3, 5.75, 10.35]);
  const stars = starField(1200, 800, skyPreset.stars, 17);
  for (const star of stars.slice(0, 50)) {
    // Right to left: a moment later the star is further left (or re-entered).
    const now = driftX(star, 10, 1200, drift);
    const later = driftX(star, 10.5, 1200, drift);
    assert.ok(later < now || later > 1200 - 10, 'a star moved the wrong way');
    // Hours in, it is still on the canvas — the field never empties.
    for (const t of [0, 59, 3_600, 86_400]) {
      const x = driftX(star, t, 1200, drift);
      assert.ok(x >= 0 && x < 1200, `a star left the sky at t=${t}`);
    }
  }
});
