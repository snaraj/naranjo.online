/* THE TORCHES (owner, 2026-10-19: "add torches to the sides of the border and
 * light them up with nice fire animations (that you build from scratch) at
 * nighttime, during the day they can be extinguished").
 *
 * The fire is arithmetic, so its shape is pinned here as arithmetic: it is the
 * same flame for the same seed, it stays inside its field, it narrows to a
 * tip, and it goes out when its cup is no longer fed. The torches are scenery,
 * so the component's promises are the sky's: no room, no pointer, nothing past
 * the sheet's edge, and no motion for a reader who asked for less — and they
 * burn only at night. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  createFire,
  fireBreath,
  fireBurning,
  fireColumns,
  fireCooling,
  fireCup,
  fireEase,
  fireFrameInterval,
  fireGustLow,
  fireGustStep,
  fireHeat,
  fireLight,
  fireLightFloor,
  fireLightHigh,
  fireLightLow,
  firePalette,
  firePixels,
  fireRandom,
  fireRows,
  fireTaper,
  kindledFire,
  moteColumns,
  moteDust,
  moteGlow,
  moteRows,
  moteTip,
  nextFireInterval,
  nextGlow,
  steadyTemper,
  stepFire,
  stepMotes,
  stillGlow,
  torchTemper
} from '../src/lib/fire.ts';

const component = await readFile(new URL('../src/lib/components/Torches.svelte', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

const row = (fire, y) => fire.heat.slice(y * fireColumns, (y + 1) * fireColumns);
const width = (cells) => [...cells].filter((value) => value > 0).length;

test('the same flame for the same seed, and a different one for another', () => {
  const a = kindledFire(5);
  const b = kindledFire(5);
  const c = kindledFire(6);
  for (let frame = 0; frame < 20; frame += 1) {
    stepFire(a, true);
    stepFire(b, true);
    stepFire(c, true);
  }
  assert.deepEqual([...a.heat], [...b.heat]);
  assert.notDeepEqual([...a.heat], [...c.heat], 'two torches would flicker in step');
});

test('a lit torch burns from its cup and its flame stays inside the field', () => {
  const fire = kindledFire(11);
  for (let frame = 0; frame < 600; frame += 1) {
    stepFire(fire, true);
    const bottom = row(fire, fireRows - 1);
    for (let x = 0; x < fireColumns; x += 1) {
      const fed = x >= fireCup[0] && x < fireCup[1];
      assert.ok(fed ? bottom[x] > fireHeat / 2 : bottom[x] === 0, `the cup's row is wrong at column ${x}`);
    }
    assert.equal(width(row(fire, 0)), 0, 'the flame reached the top of its field and would be cut off');
    for (const value of fire.heat) {
      assert.ok(value >= 0 && value <= fireHeat);
    }
  }
});

test('the flame narrows to a tip as it rises', () => {
  const fire = kindledFire(23);
  const widths = new Array(fireRows).fill(0);
  for (let frame = 0; frame < 400; frame += 1) {
    stepFire(fire, true);
    for (let y = 0; y < fireRows; y += 1) {
      widths[y] += width(row(fire, y));
    }
  }
  // Averaged over many frames: the row above the cup is wider than the flame
  // halfway up, which is wider than its upper reaches.
  const base = widths[fireRows - 2];
  const middle = widths[Math.floor(fireRows * 0.55)];
  const upper = widths[Math.floor(fireRows * 0.35)];
  assert.ok(base > middle && middle > upper, `the flame does not taper (${base}, ${middle}, ${upper})`);
});

test('an unlit torch goes out within its field’s height, and stays out', () => {
  const fire = kindledFire(31);
  assert.ok(fireBurning(fire));
  let frames = 0;
  while (fireBurning(fire) && frames < fireRows + 2) {
    stepFire(fire, false);
    frames += 1;
  }
  assert.ok(!fireBurning(fire), 'the flame never went out');
  assert.ok(frames <= fireRows, `the flame took ${frames} frames to go out`);
  for (let frame = 0; frame < 50; frame += 1) {
    stepFire(fire, false);
    assert.ok(!fireBurning(fire), 'an unfed fire relit itself');
  }
  // And a fresh fire is cold until it is fed.
  assert.ok(!fireBurning(createFire(1)));
});

test('the palette runs from nothing through red and orange to a pale core', () => {
  const palette = firePalette();
  assert.equal(palette.length, (fireHeat + 1) * 4);
  assert.equal(palette[3], 0, 'no heat must be no flame at all');
  for (let step = 1; step <= fireHeat; step += 1) {
    assert.ok(palette[step * 4 + 3] >= palette[(step - 1) * 4 + 3], 'a hotter cell is fainter');
    assert.ok(palette[step * 4] >= palette[step * 4 + 1] && palette[step * 4 + 1] >= palette[step * 4 + 2], 'a flame colour is not warm');
  }
  const hottest = fireHeat * 4;
  assert.equal(palette[hottest], 255);
  assert.ok(palette[hottest + 1] > 230 && palette[hottest + 3] === 255, 'the core is not pale and solid');
  // The pixels are the palette's own colours, cell by cell.
  const fire = kindledFire(2);
  const out = new Uint8ClampedArray(fireColumns * fireRows * 4);
  firePixels(fire, palette, out);
  for (let cell = 0; cell < fire.heat.length; cell += 1) {
    assert.deepEqual([...out.slice(cell * 4, cell * 4 + 4)], [...palette.slice(fire.heat[cell] * 4, fire.heat[cell] * 4 + 4)]);
  }
});

/* THE LIGHT IS READ FROM THE FIRE (owner, 2026-10-19: "the light and fire
 * should behave and look like a fire reflection on a real surface. we should
 * see slightly dimming"). A field with heat laid in by hand says what the light
 * must answer: none from a cold torch, more from a hotter flame, and a lean the
 * way the heat leans. */
const field = (columns, value) => {
  const fire = createFire(1);
  for (let y = 0; y < fireRows - 1; y += 1) {
    for (const x of columns) {
      fire.heat[y * fireColumns + x] = value;
    }
  }
  return fire;
};

test('the light follows the fire: none from a cold torch, more from a hotter flame, leaning where it leans', () => {
  assert.deepEqual(fireLight(createFire(1)), { level: 0, sway: 0 }, 'a cold torch throws light');
  // Brighter with more heat, from nothing at a low flame to full at a high one.
  const levels = [4, 5, 6, 7, 8].map((value) => fireLight(field([3, 4, 5, 6], value)).level);
  assert.equal(levels[0], 0, 'a guttering flame lights the wall');
  assert.equal(levels.at(-1), 1, 'a roaring flame does not light the wall fully');
  for (let index = 1; index < levels.length; index += 1) {
    assert.ok(levels[index] >= levels[index - 1], `more heat threw less light (${levels})`);
  }
  assert.ok(levels.some((level) => level > 0 && level < 1), `the light only switches, never shades (${levels})`);
  // Leaning: heat right of the centre leans the light right, left leans it
  // left, and a flame standing straight leans it nowhere.
  assert.equal(fireLight(field([6], 30)).sway, 1);
  assert.equal(fireLight(field([3], 30)).sway, -1);
  assert.equal(fireLight(field([3, 4, 5, 6], 30)).sway, 0);
  // A burning flame's light stays in range and moves across most of it.
  const fire = kindledFire(17);
  let low = 1;
  let high = 0;
  for (let frame = 0; frame < 600; frame += 1) {
    stepFire(fire, true);
    const { level, sway } = fireLight(fire);
    assert.ok(level >= 0 && level <= 1 && sway >= -1 && sway <= 1);
    low = Math.min(low, level);
    high = Math.max(high, level);
  }
  assert.ok(high - low >= 0.5, `the light barely moves with the flame (${low} to ${high})`);
});

test('the light on the wall breathes: it eases and dims a little, never strobes, never goes dark while it burns', () => {
  const series = (seed) => {
    const fire = kindledFire(seed);
    const random = fireRandom(seed);
    let glow = stillGlow;
    const out = [];
    for (let frame = 0; frame < 2000; frame += 1) {
      stepFire(fire, true);
      glow = nextGlow(glow, fireLight(fire), random);
      out.push(glow);
    }
    return out;
  };
  const glows = series(29);
  assert.deepEqual(series(29), glows, 'the same torch breathes differently on another load');
  let steps = 0;
  let largest = 0;
  for (let index = 1; index < glows.length; index += 1) {
    const step = Math.abs(glows[index].light - glows[index - 1].light);
    steps += step;
    largest = Math.max(largest, step);
  }
  const lights = glows.map((glow) => glow.light);
  const gusts = glows.map((glow) => glow.gust);
  assert.ok(Math.min(...lights) >= fireLightFloor * fireGustLow - 1e-9, 'the light went dark while the torch burned');
  assert.ok(Math.max(...lights) <= 1, 'the light ran past full');
  assert.ok(largest <= 0.2, `the light strobes (a step of ${largest})`);
  assert.ok(steps / (glows.length - 1) >= 0.01, 'the light is still while the flame moves');
  assert.ok(Math.min(...gusts) >= fireGustLow && Math.max(...gusts) <= 1, 'a gust left its band');
  assert.ok(Math.max(...gusts) - Math.min(...gusts) >= 0.15, 'the light never dims with the air');
  // Easing: a light far from what the flame throws closes fireEase of the gap
  // in one frame, no more — the lean likewise.
  const thrown = { level: 1, sway: 1 };
  const eased = nextGlow({ light: 0.4, sway: -1, gust: 1 }, thrown, () => 0.5);
  assert.ok(Math.abs(eased.light - (0.4 + fireEase * 0.6)) < 1e-9, `the light jumped (${eased.light})`);
  assert.ok(Math.abs(eased.sway - (-1 + fireEase * 2)) < 1e-9, `the lean jumped (${eased.sway})`);
});

/* EVERY TORCH IS ITS OWN FIRE (owner, 2026-10-19: "the lights do not all have
 * the same gif feel … in the real world the lights would all move, behave and
 * shine lights in different ways"). The steady temper is the fire every
 * constant above describes, so every pin above still holds the fire it was
 * measured on; a torch's temper is drawn once from its number, the number
 * Torches.svelte gives it (pinned at the foot of this file). */
const torchSeed = (index) => index * 7919 + 13;
const torchSeeds = [0, 1, 2, 3, 4, 5].map(torchSeed);
const spread = (values) => Math.max(...values) - Math.min(...values);
const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;

test('the steady temper is the fire every constant describes, and draws nothing extra from the random stream', () => {
  assert.deepEqual(steadyTemper, {
    breath: fireBreath,
    cooling: fireCooling,
    taper: fireTaper,
    pace: 1,
    ease: fireEase,
    gustLow: fireGustLow,
    gustStep: fireGustStep,
    windStep: 0,
    sparks: 1,
    reach: 1,
    still: stillGlow.light
  });
  // A fire made without a temper is the steady fire, in still air, over the
  // band its light was measured on.
  for (const fire of [createFire(5), kindledFire(5)]) {
    assert.equal(fire.temper, steadyTemper, 'a fire made without a temper is not the steady fire');
    assert.deepEqual(fire.band, [fireLightLow, fireLightHigh], 'the steady fire’s light is no longer stretched over its measured band');
    assert.equal(fire.wind, 0);
    assert.equal(fire.beat, 0);
  }
  // A lit step draws one number for each fed cell of the cup and one for each
  // cell that cools, and the steady fire not one more, so it is bit for bit
  // the fire the pins above were measured on; a restless temper draws exactly
  // one more, for its air.
  const draws = (temper) => {
    const fire = kindledFire(5, temper);
    const random = fire.random;
    let count = 0;
    fire.random = () => {
      count += 1;
      return random();
    };
    for (let frame = 0; frame < 50; frame += 1) {
      stepFire(fire, true);
      if (temper === steadyTemper) {
        assert.equal(fire.wind, 0, 'a steady fire feels the air');
      }
    }
    return count;
  };
  const perStep = fireCup[1] - fireCup[0] + (fireRows - 1) * fireColumns;
  assert.equal(draws(steadyTemper), perStep * 50, 'a steady fire draws extra randomness, so it is no longer the fire it was');
  assert.equal(draws(torchTemper(torchSeeds[0])), (perStep + 1) * 50, 'a restless torch’s air is not one draw a step');
});

test('a torch’s temper is its own, the same on every load, inside its ranges, and never reaches further than the steady light', () => {
  assert.deepEqual(torchTemper(torchSeeds[3]), torchTemper(torchSeeds[3]), 'a torch is another torch on another load');
  // Each field inside its range, and the whole range in use, over a thousand
  // torches.
  const ranges = {
    breath: [6, 14],
    cooling: [2.0, 2.9],
    taper: [0.6, 0.9],
    pace: [0.62, 1],
    ease: [0.3, 0.65],
    gustLow: [0.6, 0.82],
    gustStep: [0.03, 0.1],
    windStep: [0.02, 0.08],
    sparks: [0.5, 1.5],
    reach: [0.85, 1],
    still: [0.68, 0.9]
  };
  const tempers = Array.from({ length: 1000 }, (_, seed) => torchTemper(seed));
  assert.deepEqual(Object.keys(tempers[0]).sort(), Object.keys(steadyTemper).sort(), 'a torch’s temper and the steady one are not the same shape');
  for (const [field, [low, high]] of Object.entries(ranges)) {
    const values = tempers.map((temper) => temper[field]);
    const [least, most] = [Math.min(...values), Math.max(...values)];
    assert.ok(least >= low && most <= high, `a torch’s ${field} left ${low}..${high} (${least} to ${most})`);
    assert.ok(least <= low + (high - low) * 0.05 && most >= high - (high - low) * 0.05, `the torches’ ${field} uses only ${least} to ${most} of ${low}..${high}`);
  }
  // The two ceilings that carry a promise: a torch steps at most once a frame
  // (the loop has one beat a frame to give), and its light reaches no further
  // than the steady light, which is what keeps it off the words.
  assert.ok(tempers.every((temper) => temper.pace > 0 && temper.pace <= 1), 'a torch steps more than once a frame');
  assert.ok(tempers.every((temper) => temper.reach > 0 && temper.reach <= steadyTemper.reach), 'a torch’s light reaches further than the steady light, over the words');
  // The torches on a page are each their own: no two alike, with a real
  // spread in tempo and in how deep the air dims them (measured across these
  // six: 0.358 of pace, 0.216 of gust depth).
  const six = torchSeeds.map(torchTemper);
  for (let left = 0; left < six.length; left += 1) {
    for (let right = left + 1; right < six.length; right += 1) {
      assert.notDeepEqual(six[left], six[right], `torches ${left} and ${right} have one temper`);
    }
  }
  assert.ok(spread(six.map((temper) => temper.pace)) >= 0.25, 'the torches flicker at one tempo');
  assert.ok(spread(six.map((temper) => temper.gustLow)) >= 0.15, 'the air dims every torch as deep');
});

/* The component's loop, frame by frame, as Torches.svelte runs it (its tick is
 * pinned below): the light and the air move every frame, the flame only on its
 * beat. */
const burn = (index, frames) => {
  const fire = kindledFire(torchSeed(index), torchTemper(torchSeed(index)));
  let glow = { ...stillGlow, light: fire.temper.still };
  const motes = [];
  const levels = [];
  const lights = [];
  const gusts = [];
  let steps = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    fire.beat += fire.temper.pace;
    if (fire.beat >= 1) {
      fire.beat -= 1;
      stepFire(fire, true);
      steps += 1;
    }
    const thrown = fireLight(fire);
    glow = nextGlow(glow, thrown, fire.random, fire.temper);
    stepMotes(motes, glow.light, glow.sway, fire.random, fire.temper);
    levels.push(thrown.level);
    lights.push(glow.light);
    gusts.push(glow.gust);
  }
  return { temper: fire.temper, steps, levels, lights, gusts };
};

test('no two torches burn alike, and each still flickers across the whole of its light', () => {
  const frames = 2000;
  const torches = torchSeeds.map((_, index) => burn(index, frames));
  const quantile = (values, share) => [...values].sort((left, right) => left - right)[Math.floor(values.length * share)];
  for (const [index, { temper, steps, levels, gusts }] of torches.entries()) {
    // Its own tempo: it steps on its pace's share of the frames.
    assert.ok(Math.abs(steps - frames * temper.pace) <= 1, `torch ${index} stepped ${steps} times in ${frames} frames at a pace of ${temper.pace}`);
    // Its own band: a tall flame and a short one both flicker across most of
    // their light, not pinned dark or full (measured: the middle 80% of every
    // torch's light spans at least 0.528, about a mean of 0.40 to 0.57).
    const middle = quantile(levels, 0.9) - quantile(levels, 0.1);
    assert.ok(middle >= 0.4, `torch ${index}’s light barely moves across its band (${middle})`);
    assert.ok(mean(levels) >= 0.3 && mean(levels) <= 0.7, `torch ${index}’s light sits at one end of its band (${mean(levels)})`);
    // Its own air: the draughts dim it as deep as its temper says, no deeper.
    assert.ok(Math.min(...gusts) >= temper.gustLow - 1e-9 && Math.max(...gusts) <= 1, `torch ${index}’s gust left its band`);
  }
  // And they differ on the wall: in how bright they burn on average (measured
  // 0.556 to 0.685), how restlessly their light moves (measured a mean step of
  // 0.016 to 0.037, 2.3 times), and how deep the air can dim one (measured to
  // 0.600, below the steady torch's floor of 0.72).
  const brightness = torches.map(({ lights }) => mean(lights));
  const restlessness = torches.map(({ lights }) => mean(lights.slice(1).map((light, frame) => Math.abs(light - lights[frame]))));
  assert.ok(spread(brightness) >= 0.08, `every torch burns as bright (${brightness})`);
  assert.ok(Math.max(...restlessness) >= Math.min(...restlessness) * 1.6, `every torch’s light moves alike (${restlessness})`);
  assert.ok(Math.min(...torches.flatMap(({ gusts }) => gusts)) <= fireGustLow - 0.05, 'no torch is dimmed deeper by the air than the steady one');
  // nextGlow honours the temper it is handed: its ease, and the steady one
  // when handed none.
  const temper = torchTemper(torchSeeds[1]);
  const eased = nextGlow({ light: 0.4, sway: -1, gust: 1 }, { level: 1, sway: 1 }, () => 0.5, temper);
  assert.ok(Math.abs(eased.light - (0.4 + temper.ease * 0.6)) < 1e-9, `a torch’s light does not follow its flame at its own ease (${eased.light})`);
  assert.deepEqual(nextGlow(stillGlow, { level: 0.5, sway: 0.2 }, () => 0.3), nextGlow(stillGlow, { level: 0.5, sway: 0.2 }, () => 0.3, steadyTemper));
});

test('a restless torch feels the air: its wind wanders, never leans past full, and bends the flame its way', () => {
  const fire = kindledFire(torchSeeds[0], torchTemper(torchSeeds[0]));
  const winds = [];
  for (let frame = 0; frame < 2000; frame += 1) {
    stepFire(fire, true);
    winds.push(fire.wind);
  }
  assert.ok(winds.every((wind) => wind >= -1 && wind <= 1), 'the wind leaned past full');
  // Measured: -0.60 to 0.54 over these frames.
  assert.ok(spread(winds) >= 0.5, `the air on a restless torch hardly moves (${spread(winds)})`);
  // A gale is clamped at a full lean either way.
  const gale = createFire(3, { ...steadyTemper, windStep: 5 });
  const gusts = [];
  for (let frame = 0; frame < 200; frame += 1) {
    stepFire(gale, true);
    gusts.push(gale.wind);
  }
  assert.ok(Math.min(...gusts) === -1 && Math.max(...gusts) === 1, `a gale is not clamped at a full lean (${Math.min(...gusts)} to ${Math.max(...gusts)})`);
  // The flame leans with the wind (measured: a full lean held either way
  // leans the light fully that way).
  for (const wind of [1, -1]) {
    const held = kindledFire(7);
    let sway = 0;
    for (let frame = 0; frame < 300; frame += 1) {
      held.wind = wind;
      stepFire(held, true);
      sway += fireLight(held).sway / 300;
    }
    assert.ok(sway * wind >= 0.5, `a flame in a wind of ${wind} does not lean with it (${sway})`);
  }
});

/* THE AIR AROUND IT (owner, 2026-10-19: "make the lights seem a bit more real
 * by adding light particle diffusion against all the surfaces that it is
 * hitting"). The motes are arithmetic like the fire, so their promises are run
 * here: the dust is always there, sparks rise from the flame's tip and burn
 * out, nothing leaves the field, and the dust is lit by the fire alone. */
test('the air around a flame: sparks rise from its tip and burn out, and dust drifts in the field, lit by the fire', () => {
  const motes = [];
  const random = fireRandom(41);
  const temper = torchTemper(torchSeeds[1]);
  let born = 0;
  let rose = 0;
  for (let frame = 0; frame < 3000; frame += 1) {
    const light = (frame % 300) / 299;
    const before = new Map(motes.map((mote) => [mote, mote.y]));
    stepMotes(motes, light, Math.sin(frame / 37), random, temper);
    assert.equal(motes.filter((mote) => !mote.spark).length, moteDust, `frame ${frame} has the wrong amount of dust`);
    for (const mote of motes) {
      assert.ok(mote.x >= 0 && mote.x < moteColumns && mote.y >= 0 && mote.y < moteRows, `a mote left the field (${mote.x}, ${mote.y})`);
      assert.ok(mote.age < mote.life, `a mote outlived its life (${mote.age} of ${mote.life})`);
      const glow = moteGlow(mote, light);
      assert.ok(glow >= 0 && glow <= 1, `a mote glows out of range (${glow})`);
      if (!mote.spark) {
        assert.equal(moteGlow(mote, 0), 0, 'the dust glows with no fire to light it');
      } else if (before.has(mote)) {
        assert.ok(mote.y < before.get(mote), 'a spark sank');
        rose += 1;
      } else {
        born += 1;
        assert.ok(Math.abs(mote.x - moteTip[0]) <= 2 && Math.abs(mote.y - moteTip[1]) <= 2, `a spark was born away from the flame’s tip (${mote.x}, ${mote.y})`);
        assert.ok(mote.vy < 0, 'a spark was born falling');
      }
    }
  }
  assert.ok(born > 0 && rose > 0, 'no spark flew; this pin has lost its subject');
  // A brighter fire and a sparkier torch throw more sparks (measured over 4000
  // frames: 221 dim and 898 bright; 507 from a half-sparky torch, 1390 from a
  // torch and a half).
  const births = (light, sparks) => {
    const field = [];
    const draw = fireRandom(99);
    let count = 0;
    for (let frame = 0; frame < 4000; frame += 1) {
      stepMotes(field, light, 0, draw, { ...steadyTemper, sparks });
      count += field.filter((mote) => mote.spark && mote.age === 0).length;
    }
    return count;
  };
  assert.ok(births(1, 1) >= births(0, 1) * 2.5, 'a bright fire throws no more sparks than a dim one');
  assert.ok(births(1, 1.5) >= births(1, 0.5) * 2, 'a sparky torch throws no more sparks than a quiet one');
  // The dust is lit by the fire alone: by its light, and less the farther it
  // drifts from the flame, nothing at all at the field's corners. A spark
  // carries its own heat, brightest in the middle of its life.
  const dust = (x, y) => ({ x, y, vx: 0, vy: 0, age: 50, life: 100, spark: false });
  const [atTip, near, far] = [moteTip[1], moteTip[1] - 12, moteTip[1] - 22].map((y) => moteGlow(dust(moteTip[0], y), 1));
  assert.ok(atTip > near && near > far && far > 0, `the dust is not dimmer away from the flame (${atTip}, ${near}, ${far})`);
  assert.ok(moteGlow(dust(...moteTip), 0.5) < atTip, 'a dimmer fire lights its dust as bright');
  for (const [x, y] of [[0, 0], [moteColumns - 1, 0], [0, moteRows - 1], [moteColumns - 1, moteRows - 1]]) {
    assert.equal(moteGlow(dust(x, y), 1), 0, `dust at the field’s corner (${x}, ${y}) is lit`);
  }
  const spark = { x: 3, y: 3, vx: 0, vy: -1, age: 10, life: 20, spark: true };
  assert.equal(moteGlow(spark, 0), moteGlow(spark, 1), 'a spark’s heat is the fire’s light, not its own');
  assert.ok(Math.abs(moteGlow(spark, 1) - 1) < 1e-9, 'a spark is not at its brightest in the middle of its life');
});

/* THE FIRE PACES ITSELF where the page cannot afford it, by the sky's rule:
 * WebKit without a GPU drew 37 frames in 3s with the torches burning against
 * 167 with them out, and J missed his frames. */
test('the fire slows down rather than the page, and keeps its own rate where frames are cheap', () => {
  // A step answered in time keeps (or returns to) the fire's own rate.
  assert.equal(nextFireInterval(fireFrameInterval, 16), fireFrameInterval);
  assert.equal(nextFireInterval(800, 16), 400);
  assert.equal(nextFireInterval(fireFrameInterval * 2, 16), fireFrameInterval);
  // A late answer backs off at once, to a tenth of the page's time…
  assert.equal(nextFireInterval(fireFrameInterval, 75), 750);
  // …at least doubling, and never slower than a step a second.
  assert.equal(nextFireInterval(600, 60), 1000);
  assert.equal(nextFireInterval(1000, 400), 1000);
  // The loop measures each step's answer and waits the paced interval.
  assert.match(
    component,
    /if \(drawnAt >= 0\) \{\s*interval = nextFireInterval\(interval, now - drawnAt\);\s*drawnAt = -1;\s*\}\s*if \(now - last < interval\) \{\s*return;\s*\}/
  );
  // Once every torch on screen has been drawn, the frame is marked to be
  // measured.
  assert.match(component, /scatter\(index, field, glow\.light\);\s*\}\s*drawnAt = now;\s*\};/, 'a step is never measured');
});

test('the torches are scenery: no room, no pointer, nothing past the sheet’s edge', () => {
  assert.match(component, /<div class="keep-torches" bind:this=\{layer\} aria-hidden="true"/);
  const layer = component.match(/\.keep-torches \{([^}]*)\}/)?.[1] ?? '';
  assert.match(layer, /position: absolute;/, 'a torch layer in the flow would push the page');
  assert.match(layer, /inset: calc\(-1 \* var\(--keep-frame-page\)\);/, 'the layer must cover exactly the sheet and its frame');
  assert.match(layer, /overflow: clip;/, 'a torch or its glow could widen the page');
  assert.match(layer, /pointer-events: none;/, 'a torch must never take a pointer');
  assert.match(layer, /z-index: -1;/, 'the torches and their light must lie under the sheet’s words');
  assert.match(component, /\.torch-flame \{[^}]*image-rendering: pixelated;/, 'the flame must stay square pixels when scaled');
  // The light and the shadow show only while the torch burns, as bright as
  // the fire throws them.
  assert.match(component, /\.torch-light,\s*\.torch-halo,\s*\.torch-shadow \{\s*opacity: 0;\s*\}/, 'an unlit torch throws light or shadow');
  assert.match(
    component,
    /\.keep-torches\[data-lit='true'\] \.torch-light,\s*\.keep-torches\[data-lit='true'\] \.torch-halo \{\s*opacity: var\(--torch-light\);/,
    'a burning torch’s light does not follow its fire'
  );
  assert.match(component, /\.keep-torches\[data-lit='true'\] \.torch-shadow \{\s*opacity: calc\(var\(--torch-light\) \* [\d.]+\);/);
  // One layer, inside the sheet, burning only at night.
  assert.equal((app.match(/<Torches lit=\{phase === 'night'\} \/>/g) ?? []).length, 1);
  assert.ok(app.indexOf('<Torches') > app.indexOf('<main') && app.indexOf('<Torches') < app.indexOf('</main>'), 'the torches stand on the sheet');
  // Their colours are the token layer's, like every other colour on the page.
  for (const token of ['iron', 'iron-dark', 'wood', 'wood-dark', 'char', 'light-hot', 'light', 'light-far', 'shadow']) {
    assert.match(styles, new RegExp(`--palette-keep-torch-${token}: `), `--palette-keep-torch-${token} is not in the token layer`);
  }
  assert.doesNotMatch(component.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? '', /#[0-9a-f]{3,8}\b|rgba?\(/i, 'a torch colour is a literal');
});

test('the fire burns only lit, visible and on screen, and holds still for a reader who asked for less motion', () => {
  assert.ok(fireFrameInterval >= 1000 / 20, 'a pixel flame needs no more than twenty frames a second');
  assert.match(component, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  // The loop re-arms only while there is a lit torch on screen in a visible
  // page that welcomes motion…
  assert.match(component, /if \(!lit \|\| document\.hidden \|\| quiet\.matches \|\| onScreen\.size === 0\) \{\s*return;\s*\}\s*frame = requestAnimationFrame\(tick\);/);
  assert.match(component, /if \(lit && !document\.hidden && !quiet\.matches && onScreen\.size > 0\) \{\s*frame = requestAnimationFrame\(tick\);/);
  // …paints a still, burning flame otherwise when lit, and nothing at all when
  // out…
  assert.match(component, /paint\(index, lit \? fireOf\(index\) : null\);/);
  assert.match(component, /fire = kindledFire\(index \* 7919 \+ 13, temperOf\(index\)\);/, 'a torch is kindled without its own temper');
  // One loop serves every torch on screen. Each frame, a torch's flame steps
  // and is painted only on its own beat, at its temper's pace…
  const tick = component.match(/const tick = \(now: number\): void => \{([\s\S]*?)\n    \};/)?.[1] ?? '';
  assert.match(tick, /for \(const index of onScreen\) \{\s*const fire = fireOf\(index\);/, 'the loop no longer serves every torch on screen');
  assert.match(
    tick,
    /fire\.beat \+= fire\.temper\.pace;\s*if \(fire\.beat >= 1\) \{\s*fire\.beat -= 1;\s*stepFire\(fire, true\);\s*paint\(index, fire\);\s*\}/,
    'a torch’s flame no longer burns at its own tempo'
  );
  // …while its light moves with the flame it was read from, by its own
  // temper, from its own still light, and its air moves with that light —
  // every frame, after the beat, not only on it.
  assert.match(
    tick,
    /paint\(index, fire\);\s*\}\s*const glow = nextGlow\(glows\.get\(index\) \?\? stillOf\(index\), fireLight\(fire\), fire\.random, fire\.temper\);\s*glows\.set\(index, glow\);\s*shine\(index, glow\);\s*const field = motesOf\(index\);\s*stepMotes\(field, glow\.light, glow\.sway, fire\.random, fire\.temper\);\s*scatter\(index, field, glow\.light\);\s*\}/,
    'a torch’s light or air no longer moves every frame by its own temper'
  );
  // Nowhere else does anything step, ease or blow: a still torch stays still.
  for (const call of ['stepFire(', 'nextGlow(', 'stepMotes(']) {
    assert.equal(component.split(call).length - 1, 1, `${call} is called outside the loop`);
  }
  // A still or unlit torch shows its own still light and an empty air, not
  // the last frame's: the motes are let go with the light.
  assert.match(component, /if \(!lit \|\| quiet\.matches\) \{\s*glows\.clear\(\);\s*motes\.clear\(\);\s*\}/, 'a still or unlit torch keeps its last light or motes');
  assert.match(
    component,
    /const glow = glows\.get\(index\) \?\? stillOf\(index\);\s*shine\(index, glow\);\s*scatter\(index, motes\.get\(index\) \?\? \[\], glow\.light\);/,
    'a still torch does not show its own still light and air'
  );
  assert.match(component, /function stillOf\(index: number\): Glow \{\s*return \{ \.\.\.stillGlow, light: temperOf\(index\)\.still \};\s*\}/);
  // …and lets go of everything it listens to, and every torch's state when
  // its canvas goes.
  assert.match(component, /fires\.delete\(index\);\s*glows\.delete\(index\);\s*motes\.delete\(index\);/);
  for (const [add, remove] of [
    ["document.addEventListener('visibilitychange', start)", "document.removeEventListener('visibilitychange', start)"],
    ["quiet.addEventListener('change', start)", "quiet.removeEventListener('change', start)"]
  ]) {
    assert.ok(component.includes(add), `missing ${add}`);
    assert.ok(component.includes(remove), `missing ${remove}`);
  }
  assert.match(component, /watcher\.disconnect\(\);/);
  assert.match(component, /observer\.disconnect\(\)/);
});

/* The component's own rules, read as rules: comments dropped, each selector
 * list with its declarations (an @media block's rules included). */
const rules = [...(component.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
  ([, selectors, body]) => ({ selectors: selectors.split(',').map((selector) => selector.trim()), body })
);
const rule = (selector) => rules.filter(({ selectors }) => selectors.includes(selector)).map(({ body }) => body).join('\n');

test('each torch burns by its own temper, and its light never reaches further than the steady light', () => {
  // The temper is drawn from the torch's number, once, and the flame is
  // kindled from the same number (pinned in the loop's test above), so a
  // torch is the same torch on every load.
  assert.match(
    component,
    /let temper = tempers\.get\(index\);\s*if \(temper === undefined\) \{\s*temper = torchTemper\(index \* 7919 \+ 13\);\s*tempers\.set\(index, temper\);\s*\}/,
    'a torch’s temper is not drawn once from its number'
  );
  // Its reach is its temper's (never over one: the temper's test above), and
  // it scales both the pool's reach and the hot spot's, which are otherwise
  // the steady reach the words were kept clear of.
  assert.match(
    component,
    /<span\s+class="torch"[^>]*\sstyle:--torch-reach-scale=\{temperOf\(index\)\.reach\.toFixed\(3\)\}\s*>/,
    'a torch’s reach is not its temper’s'
  );
  const torch = rule('.torch');
  assert.match(torch, /--torch-reach-scale: 1;/, 'a torch with no temper does not reach as the steady light does');
  assert.match(torch, /--torch-reach: calc\(var\(--torch-room\) \* 1\.25 \* var\(--torch-reach-scale\)\);/, 'the pool’s reach is not the steady reach scaled by the torch’s');
  assert.match(
    torch,
    /--torch-halo-reach: calc\(min\(var\(--torch-unit\) \* 5, var\(--torch-room\)\) \* var\(--torch-reach-scale\)\);/,
    'the hot spot’s reach is not the steady reach scaled by the torch’s'
  );
});

test('the light breaks on the stone’s grain, fixed to the wall, and the air stays on the frame and the margin', () => {
  // The grain box holds exactly the two parts of the light; the shadow the
  // handle casts is outside it, ungrained.
  assert.match(
    component,
    /<span class="torch-glow">\s*<span class="torch-light"><\/span>\s*<span class="torch-halo"><\/span>\s*<\/span>\s*<span class="torch-shadow"><\/span>/,
    'the grain box does not hold exactly the light and its hot spot'
  );
  const glow = rule('.torch-glow');
  assert.match(glow, /mask-image: var\(--keep-grain\);/, 'the light does not fall through the stone’s grain');
  assert.match(glow, /mask-size: var\(--keep-grain-tile\);/, 'the grain is not drawn at the props’ grain');
  assert.match(glow, /mask-repeat: repeat;/);
  // Only that box is masked, and nothing moves it: the light leans and
  // breathes inside it, across the grain, which stays fixed to the wall.
  assert.deepEqual(
    rules.filter(({ body }) => /(^|[;\s])(-webkit-)?mask(-[a-z-]+)?\s*:/.test(body)).map(({ selectors }) => selectors.join(', ')),
    ['.torch-glow'],
    'the grain is carried by something other than the still box the light moves in'
  );
  for (const { selectors, body } of rules.filter(({ selectors }) => selectors.some((selector) => /\.torch-glow$/.test(selector)))) {
    assert.doesNotMatch(body, /\b(transform|translate|rotate|scale|animation|transition|offset-path)\s*:/, `${selectors.join(', ')} moves the grain with the light`);
  }
  // Any spelling of the tag, and an end tag with whatever a parser ignores
  // before its `>` (js/bad-tag-filter).
  const script = component.match(/<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/i)?.[1] ?? '';
  assert.doesNotMatch(script, /torch-glow/, 'the loop reaches for the grain box');
  // The air: a canvas of the motes' own field, a half unit a mote so every
  // mote is square, pixelated like the flame, inside a box clipped where the
  // light's room ends — seven units in from the sheet's outer edge plus the
  // room is the frame and the sheet's margin, where the words begin.
  assert.match(
    component,
    /<span class="torch-air">\s*<canvas class="torch-motes" width=\{moteColumns\} height=\{moteRows\}><\/canvas>\s*<\/span>/,
    'the air is not one canvas of the motes’ own field'
  );
  const motes = rule('.torch-motes');
  assert.match(motes, /image-rendering: pixelated;/, 'the motes must stay square pixels when scaled');
  assert.match(motes, new RegExp(`inline-size: calc\\(var\\(--torch-unit\\) \\* ${moteColumns / 2}\\);`), 'a mote is not half a unit wide');
  assert.match(motes, new RegExp(`block-size: calc\\(var\\(--torch-unit\\) \\* ${moteRows / 2}\\);`), 'a mote is not half a unit tall');
  const air = rule('.torch-air');
  assert.match(air, /overflow: clip;/, 'a spark or a lit mote can drift over the words');
  assert.match(air, /inset-inline-start: 0;/);
  assert.match(air, /inline-size: calc\(var\(--torch-unit\) \* 7 \+ var\(--torch-room\)\);/, 'the air reaches past where the words begin');
  assert.match(
    rule('.keep-torches'),
    /--torch-room: max\(0px, var\(--keep-frame-page\) \+ var\(--keep-sheet-pad\) - var\(--torch-unit\) \* 7\);/,
    'the light’s room is no longer the frame and the sheet’s margin past the flame'
  );
});
