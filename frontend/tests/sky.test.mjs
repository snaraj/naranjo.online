/* THE NIGHT SKY (owner direction, 2026-10-16: "a starry night … not super
 * scary, fast, flashy … subtle"). The sky is decorative and it moves, so the
 * two promises it has to keep are the page's own motion floor — a reader who
 * asked for reduced motion gets a still sky — and that a background never
 * costs the reader anything: it is fixed, takes no room, never takes a
 * pointer, and stops working the moment the page is not on screen. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  driftX,
  glintField,
  glintReach,
  nebulaPixels,
  nextSkyInterval,
  noiseField,
  pace,
  seeded,
  skyCostShare,
  skyFrameBudget,
  skyFrameInterval,
  skyMaxPixelRatio,
  skySlowestInterval,
  skyMoves,
  skyPresets,
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
  // Under everything: the sheet's wall and greenery sit at -2 and the torches
  // at -1 (sections.test.mjs pins the order of all four).
  assert.match(rule, /z-index: -3;/, 'the sky sits behind everything, the sheet’s wall included');
  assert.equal((app.match(/<NightSky \{phase\} \/>/g) ?? []).length, 1, 'one sky, mounted once, told the phase');
});

test('a reader who asked for less motion gets one still frame', () => {
  assert.match(component, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  // The loop re-arms only when motion is welcome and the page is visible…
  assert.match(component, /if \(document\.hidden \|\| quiet\.matches \|\| !moving\) \{\s*return;\s*\}\s*frame = requestAnimationFrame\(tick\);/);
  assert.match(component, /if \(!document\.hidden && !quiet\.matches && moving\) \{\s*frame = requestAnimationFrame\(tick\);/);
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
  // The loop's pace starts at the ceiling and never draws sooner than it.
  assert.match(component, /const paced = pace\(skyFrameInterval, nextSkyInterval\);/);
  const paced = pace(skyFrameInterval, nextSkyInterval);
  assert.equal(paced.frame(1000), true);
  paced.drew(1000);
  assert.equal(paced.frame(1016), false, 'the sky drew twice inside its ceiling');
  assert.equal(paced.frame(1001 + skyFrameInterval), true);
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
  // next one, at once, whatever the wait was; repeated ones hold there, at a
  // tenth, rather than creeping towards the floor.
  assert.equal(nextSkyInterval(skyFrameInterval, 60), 60 * skyCostShare);
  assert.equal(nextSkyInterval(400, 60), 60 * skyCostShare);
  assert.equal(nextSkyInterval(skyFrameInterval, 300), 300 * skyCostShare);
  assert.ok(skyCostShare >= 10, 'the sky takes more than a tenth of a slow page');
  let interval = skyFrameInterval;
  for (let frame = 0; frame < 20; frame += 1) {
    interval = nextSkyInterval(interval, 88);
  }
  assert.equal(interval, 88 * skyCostShare, 'a page whose frames run steadily late stills its sky below its share');
  // The share holds however dear a frame gets, up to three seconds of one:
  // the wait is never less than the share asks for until the floor, and the
  // floor still moves the sky twice a minute. (Until 2026-10-20 the floor was
  // a second, and a frame that cost the page 400ms took 40% of it.)
  for (const answeredIn of [60, 120, 400, 1300, 3000]) {
    const wait = nextSkyInterval(skyFrameInterval, answeredIn);
    assert.ok(
      wait >= answeredIn * skyCostShare,
      `a sky frame that cost ${answeredIn}ms waits ${wait}ms, more than a tenth of the page`
    );
  }
  assert.ok(skySlowestInterval / skyCostShare >= 3000, 'the floor gives up the share for frames under three seconds');
  assert.ok(skySlowestInterval <= 30_000, 'a sky the page cannot afford still moves twice a minute');
  assert.equal(nextSkyInterval(skyFrameInterval, 20_000), skySlowestInterval);
  // When the page answers in time again, the sky climbs back to its ceiling.
  for (let frame = 0; frame < 20; frame += 1) {
    interval = nextSkyInterval(interval, 17);
  }
  assert.equal(interval, skyFrameInterval);
  // The loop asks its pace before every drawing, tells it of each, and
  // restarts it when the loop restarts, so a hidden spell is not read as a
  // slow drawing.
  assert.match(component, /const paced = pace\(skyFrameInterval, nextSkyInterval\);/);
  assert.match(component, /if \(!paced\.frame\(now\)\) \{\s*return;\s*\}\s*draw\(\(now - started\) \/ 1000\);\s*paced\.drew\(now\);/);
  assert.match(component, /function start\(\): void \{\s*cancelAnimationFrame\(frame\);\s*frame = 0;\s*paced\.restart\(\);/);
});

/* A page that pays for a drawing over several frames: every drawing is
 * followed by `slow` frames of `cost` ms each, and every other frame takes
 * 16ms. The pace runs the loop over ten minutes of such frames (long enough
 * that a wait of half a minute is not one drawing more or less) and reports
 * the share of the time the page spent paying for it. */
const simulate = ({ slow, cost, seconds = 600, next = nextSkyInterval, ceiling = skyFrameInterval }) => {
  const paced = pace(ceiling, next);
  let now = 0;
  let owed = 0;
  let paying = 0;
  let drawings = 0;
  let drewWhileOwed = 0;
  while (now < seconds * 1000) {
    const took = owed > 0 ? cost : 16;
    if (owed > 0) {
      paying += cost;
      owed -= 1;
    }
    now += took;
    if (paced.frame(now)) {
      if (owed > 0) drewWhileOwed += 1;
      paced.drew(now);
      drawings += 1;
      owed = slow;
    }
  }
  return { share: paying / now, drawings, drewWhileOwed, interval: paced.interval };
};

/* THE PACE COUNTS THE WHOLE BILL (2026-10-20). Where a browser draws without
 * a GPU, one drawing on the sky cost WebKit on Linux two slow frames before
 * J's frames were quick again, and a pace that read only the first saw half
 * of it. So a drawing is paid for until the page answers in time again, and
 * the loop draws nothing until then. */
test('a loop takes no more than its share however many frames a drawing costs', () => {
  // Cheap frames: the loop keeps its ceiling, a drawing on the first 16ms
  // frame past each wait.
  const cheap = simulate({ slow: 0, cost: 16 });
  assert.equal(cheap.interval, skyFrameInterval);
  assert.equal(cheap.share, 0);
  const atCeiling = 600_000 / (Math.ceil(skyFrameInterval / 16) * 16);
  assert.ok(cheap.drawings >= atCeiling - 1, `a cheap sky drew ${cheap.drawings} times in ten minutes, not ${atCeiling}`);
  // Dear drawings, paid over one frame or several: never more than a tenth
  // of the page (and a whisker for the frame that ends the bill).
  for (const [slow, cost] of [[1, 200], [2, 200], [3, 400], [2, 1300], [6, 120]]) {
    const dear = simulate({ slow, cost });
    assert.ok(
      dear.share <= 1 / skyCostShare + 0.01,
      `a drawing paid over ${slow} frames of ${cost}ms took ${(dear.share * 100).toFixed(1)}% of the page`
    );
    assert.ok(dear.drawings > 0, 'a dear sky stopped drawing altogether');
    assert.equal(dear.drewWhileOwed, 0, 'the loop drew again before the page had paid for its last drawing');
  }
  // The fire paces itself by the same rule (lib/fire.ts).
  const fire = simulate({ slow: 2, cost: 300, next: (interval, answeredIn) => nextSkyInterval(interval, answeredIn) });
  assert.ok(fire.share <= 1 / skyCostShare + 0.01);
});

test('a pace forgets the frames before a restart', () => {
  const paced = pace(skyFrameInterval, nextSkyInterval);
  assert.equal(paced.frame(0), true);
  paced.drew(0);
  // The loop stops (a hidden page) and starts again ten seconds on: the
  // spell is not a slow frame, and the pace stays at its ceiling.
  paced.restart();
  assert.equal(paced.frame(10_000), true);
  assert.equal(paced.interval, skyFrameInterval);
  paced.drew(10_000);
  // A slow frame after a drawing is still being paid for: no drawing yet.
  assert.equal(paced.frame(10_300), false);
  assert.equal(paced.frame(10_316), false, 'the frame that ends the bill is not yet past the new wait');
  assert.ok(paced.interval >= 316 * skyCostShare, `a drawing that cost 316ms left a wait of ${paced.interval}ms`);
});

test('a page that never answers in time still sees the sky move once each slowest wait', () => {
  /* Every frame takes 100ms, twice the budget, for two minutes: the bill of
     the first drawing is never paid in time. The loop still draws, once each
     skySlowestInterval and no more often (WebKit's iPhone lane, 2026-10-20,
     where a bill that waited for a quick frame stopped the fire for good). */
  const paced = pace(skyFrameInterval, nextSkyInterval);
  assert.equal(paced.frame(0), true);
  paced.drew(0);
  const drawn = [];
  for (let now = 100; now <= 120_000; now += 100) {
    if (paced.frame(now)) {
      paced.drew(now);
      drawn.push(now);
    }
  }
  assert.deepEqual(
    drawn,
    [1, 2, 3, 4].map((wait) => wait * skySlowestInterval),
    'a page that is never quick saw the sky stop, or move more often than its slowest wait'
  );
});

test('the same sky on every load: the generator, the noise and the stars are seeded', () => {
  const a = seeded(42);
  const b = seeded(42);
  for (let index = 0; index < 5; index += 1) {
    assert.equal(a(), b());
  }
  const field = noiseField(7);
  assert.equal(field(1.3, 2.7), noiseField(7)(1.3, 2.7));
  assert.deepEqual(starField(400, 300, skyPresets.night.stars, 17), starField(400, 300, skyPresets.night.stars, 17));
  const count = starField(1000, 1000, skyPresets.night.stars, 17).length;
  assert.equal(count, Math.round(1000 * 1000 * skyPresets.night.stars.density));
});

test('stars twinkle slowly and stay within their own brightness', () => {
  const stars = starField(800, 600, skyPresets.night.stars, 17);
  const [shortest, longest] = skyPresets.night.stars.period;
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
  const nebula = skyPresets.night.nebula;
  assert.ok(nebula, 'the preset carries a nebula');
  const pixels = nebulaPixels(32, 20, nebula);
  assert.equal(pixels.length, 32 * 20 * 4);
  assert.ok(pixels.some((value, index) => index % 4 === 3 && value > 0), 'some of the nebula is visible');
  assert.ok(pixels.some((value, index) => index % 4 === 3 && value === 0), 'and some of the sky is clear');
});

/* PIXEL STARS (owner, 2026-10-19, of the N9 title-card mock: "I really like
 * the animation and style of N9 title card, in particular for how the stars
 * have bigger sizes, bigger trinkles. They look much more realistic yet
 * playful"). Over the fine field the night sprinkles the card's own stars:
 * crisp squares, some of them flaring as a pixel cross that reaches one
 * square, then two, then none — the card's keyframes, stepped — each on its
 * own period and phase, drawn on whole screen pixels, still under reduced
 * motion, and the same sky on every load. */
test('the night sprinkles the title card’s pixel stars, each flaring on its own beat', () => {
  const glints = skyPresets.night.stars.glints;
  assert.ok(glints, 'the night has no pixel stars');
  assert.ok(skyPresets.day.stars.glints === undefined, 'the day sky has pixel stars, so it would have to move');
  assert.equal(glints.unit, 4, 'a flaring star is not the card’s 4px square');
  assert.equal(glints.plain, 3, 'a plain star is not the card’s 3px square');
  const [shortest, longest] = glints.period;
  assert.ok(shortest >= 2 && longest <= 4 && shortest < longest, 'a flare is not near the card’s 2.8s, or every star shares one');
  for (const triple of [glints.core, glints.arm]) {
    assert.match(triple, /^\d{1,3},\d{1,3},\d{1,3}$/, `${triple} is not an "r,g,b" triple`);
  }

  // Seeded apart from the fine field, and the same every load.
  const drift = skyPresets.night.stars.drift;
  assert.deepEqual(glintField(1440, 900, glints, 29, drift), glintField(1440, 900, glints, 29, drift));
  const field = glintField(2000, 2000, glints, 29, drift);
  assert.equal(field.length, Math.round(2000 * 2000 * glints.density));
  const share = field.filter((glint) => glint.flares).length / field.length;
  assert.ok(Math.abs(share - glints.flaring) < 0.05, `${(share * 100).toFixed(1)}% flare, not about ${glints.flaring * 100}%`);
  for (const glint of field) {
    assert.ok(glint.x >= 0 && glint.x < 2000 && glint.y >= 0 && glint.y < 2000, 'a pixel star sits off the sky');
    assert.ok(glint.period >= shortest && glint.period <= longest, 'a pixel star flares outside the period range');
    assert.ok(glint.phase >= 0 && glint.phase < glint.period, 'a pixel star’s phase is outside its own cycle');
    assert.ok(Number.isInteger(glint.layer) && glint.layer >= 0 && glint.layer < drift.length, 'a pixel star rides no drift layer');
  }
  assert.ok(new Set(field.map((glint) => glint.period.toFixed(3))).size > field.length / 2, 'the stars share their periods, so they flare in step');

  // The card's keyframes: one square for half the cycle, two for a quarter,
  // none for the last quarter — and a plain star never reaches at all.
  const flaring = field.find((glint) => glint.flares);
  const plain = field.find((glint) => !glint.flares);
  const samples = 4000;
  const counts = { 0: 0, 1: 0, 2: 0 };
  for (let index = 0; index < samples; index += 1) {
    counts[glintReach(flaring, (index / samples) * flaring.period)] += 1;
    assert.equal(glintReach(plain, index * 0.01), 0, 'a plain star flared');
  }
  assert.ok(Math.abs(counts[1] / samples - 0.5) < 0.01, `one square for ${counts[1] / samples} of the cycle, not half`);
  assert.ok(Math.abs(counts[2] / samples - 0.25) < 0.01, `two squares for ${counts[2] / samples} of the cycle, not a quarter`);
  assert.ok(Math.abs(counts[0] / samples - 0.25) < 0.01, `no reach for ${counts[0] / samples} of the cycle, not a quarter`);
  assert.equal(glintReach(flaring, 5), glintReach(flaring, 5 + flaring.period), 'a flare does not repeat on its own period');
  const opening = field.filter((glint) => glint.flares).map((glint) => glintReach(glint, 0));
  assert.ok(new Set(opening).size === 3, 'every flaring star opens on the same step, so they flare together');

  // Drawn on whole screen pixels, its squares the preset's at the canvas's
  // own density; under reduced motion a flaring star holds its first reach.
  for (const [pattern, message] of [
    [/context!\.setTransform\(1, 0, 0, 1, 0, 0\);/, 'the pixel stars are not drawn in screen pixels'],
    [/const unit = Math\.max\(1, Math\.round\(sparkle\.unit \* ratio\)\);/, 'a flaring star’s square is not whole screen pixels'],
    [/const plain = Math\.max\(1, Math\.round\(sparkle\.plain \* ratio\)\);/, 'a plain star’s square is not whole screen pixels'],
    [/const x = Math\.round\(driftX\(glint, t, width, preset\.stars\.drift\) \* ratio\);/, 'a pixel star does not drift with the field, or sits between pixels'],
    [/const y = Math\.round\(glint\.y \* ratio\);/, 'a pixel star sits between pixels'],
    [/const reach = quiet\.matches \? 1 : glintReach\(glint, t\);/, 'under reduced motion a pixel star does not hold still'],
    [/context!\.setTransform\(ratio, 0, 0, ratio, 0, 0\);\s*\}/, 'the sky’s own scale is not restored after the pixel stars'],
    [/drawGlints\(t\);\s*\}/, 'the pixel stars are not drawn with each frame of the sky'],
  ]) {
    assert.match(component, pattern, message);
  }
});

test('the drift glides right to left and never runs out', () => {
  const drift = skyPresets.night.stars.drift;
  assert.ok(drift && drift.length > 0, 'the page sky drifts (owner pick, 2026-10-16)');
  // 15% faster than the gallery's 2, 5 and 9 pixels a second.
  assert.deepEqual(drift, [2.3, 5.75, 10.35]);
  const stars = starField(1200, 800, skyPresets.night.stars, 17);
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

/* TWO SKIES (owner, 2026-10-19: "always set it to night by default, but add a
 * toggle to turn it into daytime"): the night the page already wore, and a
 * blue day that holds still (no stars, so no loop at all). The dawn left with
 * the clock that used to choose it. The toggle has gone since ("do away with
 * this all together but keep the logic"), and the day with it from the page —
 * but not from the code: it is kept whole, one constant away, so it is held
 * here exactly as before. */
test('the night is the night it was, and the day is a still blue sky', () => {
  assert.deepEqual(Object.keys(skyPresets).sort(), ['day', 'night'], 'the sky has a phase the scene cannot reach');
  assert.equal(skyPresets.night.id, 'midnight-drift-deeper');
  assert.deepEqual(skyPresets.night.sky, ['#060606', '#141414', '#242424']);
  assert.equal(skyMoves(skyPresets.night), true);
  assert.equal(skyMoves(skyPresets.day), false, 'the day sky has nothing to move, so it runs no loop');
  // Blue: every stop of the day's gradient has more blue than red.
  for (const color of skyPresets.day.sky) {
    const [r, , b] = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
    assert.ok(b > r, `${color} is not a blue sky`);
  }
  // Every sky draws its still part the same way: a gradient and a nebula.
  for (const preset of Object.values(skyPresets)) {
    assert.ok(preset.sky.length >= 2, `${preset.id} has no gradient`);
    assert.ok(preset.nebula, `${preset.id} has no nebula`);
  }
});

/* THE PAGE IS THE NIGHT, ALWAYS (owner, 2026-10-19: "always set it to night
 * by default", then, of the control that turned it to day, "do away with this
 * all together but keep the logic"). No clock is read, no device is asked, no
 * control exists and nothing is remembered: the phase is one constant, the
 * night. It still flows everywhere the day would need it — to the sky, to the
 * torches, and onto the root, where the stylesheet's night block keys on it,
 * with the toolbars told the sheet's colour once it is written — so a control
 * that brings the day back writes a phase in one place and touches nothing
 * else. The day's sky is held by the test above; the day's palette by
 * experience.test.mjs. */
test('the page is the night on every visit, and the day waits one constant away', () => {
  assert.match(app, /const phase: SkyPhase = 'night';/, 'the page is no longer the night');
  assert.match(app, /document\.documentElement\.dataset\.sky = phase;\s*syncThemeColor\(\);/);
  assert.match(app, /<NightSky \{phase\} \/>/);
  assert.match(app, /<Torches lit=\{phase === 'night'\} \/>/, 'the torches no longer burn only at night');
  assert.doesNotMatch(app, /getHours|new Date\(|matchMedia/, 'the scene reads the clock or the device again');
  // No control, and nothing that could become one without a conscious edit
  // here: the toggle's component is gone, the page holds no state a press
  // could change, and no binding hands one to a child.
  assert.ok(
    !existsSync(new URL('../src/lib/components/SkyToggle.svelte', import.meta.url)),
    'the sky’s control is back; the owner did away with it'
  );
  assert.doesNotMatch(app, /SkyToggle|\$state\(|bind:/, 'the page grew a control, or a state a control could turn');
  assert.doesNotMatch(
    app,
    /localStorage|sessionStorage|document\.cookie|indexedDB/,
    'the page remembers a sky; every visit is the night'
  );
  assert.match(component, /let \{ phase \}: \{ phase: SkyPhase \} = \$props\(\);/);
  assert.match(component, /const preset = skyPresets\[phase\];\s*const moving = skyMoves\(preset\);/);
});
