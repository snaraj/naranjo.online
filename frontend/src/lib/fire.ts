/* THE TORCHES' FIRE (owner, 2026-10-19: "add torches to the sides of the
 * border and light them up with nice fire animations (that you build from
 * scratch) at nighttime, during the day they can be extinguished").
 *
 * A pixel flame from a heat field, the way the old demo fires were made: a
 * small grid of heat values, fed at the bottom where the torch's cup burns,
 * where every cell each frame takes the heat of the cell beneath it — from a
 * column to either side, which is the flicker — cooled by a random step. Heat
 * rises, thins and dies a little above the cup, so the flame's shape comes out
 * of the arithmetic rather than being drawn. The grid is a few dozen pixels,
 * painted through a palette onto a canvas the same size and scaled up square
 * (image-rendering: pixelated), so it sits with the page's other pixel art.
 *
 * Pure: the field, one step and the palette live here, with the randomness
 * passed in, so a flame is the same flame for the same seed and the tests can
 * hold its shape. Torches.svelte owns the canvases and the loop. */

import { skyCostShare, skyFrameBudget, skySlowestInterval } from './sky.ts';

/* The field, in pixels: as wide as the torch's flame box is drawn, in its own
   pixel steps, and tall enough for the flame to die inside it. */
export const fireColumns = 10;
export const fireRows = 18;

/* The hottest a cell gets; the palette has one colour for each step down to
   zero, which is no flame at all. */
export const fireHeat = 36;

/* The cup the flame burns from: the fed columns of the bottom row. */
export const fireCup: readonly [number, number] = [3, 7];

/* How much a rising cell cools, at most, per row (on average half this): with
   the averaging, a flame from a full cup dies inside the field. */
export const fireCooling = 2.4;

/* How far below full heat the cup's feed wanders from frame to frame: the
   base breathing. */
export const fireBreath = 10;

/* The taper: a cell cools this much more for every column it stands from the
   centre, so the flame narrows as it rises and ends in a point. */
export const fireTaper = 0.75;

/* The frame rate a fire is drawn at: a pixel flame reads as fire well below
   the screen's rate, and every frame it does not draw is one the page keeps. */
export const fireFrameInterval = 1000 / 14;

/* The fire paces itself as the sky does (lib/sky.ts, the same budget and the
   same share). Where a browser draws without a GPU, each step repaints every
   burning torch's flame and the light it throws on the stone, with whatever
   lies over them: in WebKit on Linux the page took 75ms a frame with the
   torches burning and 16ms with them out (37 frames in 3s against 167), and
   J, drawn in the same frames, missed his. So a step the page answers later
   than the budget pushes the next one back until the fire takes no more than
   a tenth of the page's time, down to a step a second; a step answered in
   time brings it back towards its own rate. A browser with a GPU never leaves
   that rate. */
export function nextFireInterval(interval: number, answeredIn: number): number {
  return answeredIn > skyFrameBudget
    ? Math.min(skySlowestInterval, Math.max(interval * 2, answeredIn * skyCostShare))
    : Math.max(fireFrameInterval, interval / 2);
}

export type Fire = {
  heat: Uint8Array;
  scratch: Uint8Array;
  random: () => number;
  /* The torch's own character (torchTemper below); the steady one is the
     fire every constant above describes. */
  temper: Temper;
  /* The air on this flame now: a lean, -1 to 1, that wanders as the temper
     says, bending the flame and the light it throws. */
  wind: number;
  /* How far into its next step the flame is: a torch whose pace is under one
     steps on some of the loop's frames and not others, so each burns at its
     own tempo. */
  beat: number;
  /* The band its heat wanders in, stretched to the light's 0..1. */
  band: readonly [number, number];
};

/* The same seeded generator the sky uses, so each torch is its own flame and
   the same flame on every load. */
export function fireRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createFire(seed: number, temper: Temper = steadyTemper): Fire {
  return {
    heat: new Uint8Array(fireColumns * fireRows),
    scratch: new Uint8Array(fireColumns * fireRows),
    random: fireRandom(seed),
    temper,
    wind: 0,
    beat: 0,
    band: [fireLightLow, fireLightHigh]
  };
}

/* One frame of the fire. A lit torch feeds its cup at nearly full heat (a
   little less now and then, so the base breathes); an unlit one feeds
   nothing, and whatever flame is left rises and dies within fireRows frames.
   Every other cell is the AVERAGE of the previous frame's three cells below
   it and the one two rows down, less a random cooling — heat rises and
   blurs, so the flame is one body with soft bands rather than scattered
   sparks, and the cooling's randomness is the flicker. Every cell is written
   each frame, so no heat is ever left behind where nothing rose. A cell
   cools faster the farther it stands from the centre, which tapers the flame
   to a tip instead of letting it spread as it rises.

   A torch's temper sets how far its base breathes, how fast it cools (a tall
   flame or a short one) and how sharply it tapers, and a restless one feels
   the air: its wind wanders a little each step, and a cell then draws more
   of its heat from the side the wind comes from, so the whole flame bends
   with it. The steady temper feels no air and draws nothing extra from the
   random stream, so a steady fire is exactly the fire it always was. */
export const fireWindPull = 0.3;

export function stepFire(fire: Fire, lit: boolean): void {
  const { heat, scratch, random, temper } = fire;
  const bottom = (fireRows - 1) * fireColumns;
  const centre = (fireColumns - 1) / 2;
  const at = (x: number, y: number): number =>
    x < 0 || x >= fireColumns || y >= fireRows ? 0 : heat[y * fireColumns + x];
  if (temper.windStep > 0) {
    fire.wind = Math.min(1, Math.max(-1, fire.wind * 0.97 + (random() - 0.5) * 2 * temper.windStep));
  }
  const lean = fire.wind * fireWindPull;
  for (let x = 0; x < fireColumns; x += 1) {
    const fed = lit && x >= fireCup[0] && x < fireCup[1];
    scratch[bottom + x] = fed ? fireHeat - Math.floor(random() * temper.breath) : 0;
  }
  for (let y = 0; y < fireRows - 1; y += 1) {
    for (let x = 0; x < fireColumns; x += 1) {
      const rising =
        (at(x - 1, y + 1) * (1 + lean) + at(x, y + 1) + at(x + 1, y + 1) * (1 - lean) + at(x, y + 2)) / 4;
      const taper = Math.abs(x - centre) * temper.taper;
      const cooled = Math.round(rising - random() * temper.cooling - taper);
      scratch[y * fireColumns + x] = cooled > 0 ? cooled : 0;
    }
  }
  heat.set(scratch);
}

/* Is anything still burning? */
export function fireBurning(fire: Fire): boolean {
  return fire.heat.some((value) => value > 0);
}

/* The fire's colours, one RGBA entry per heat step, from no flame at all
   (transparent) through ember red, orange and yellow to a pale core. Colour
   and alpha rise together, so the flame's edge thins into the dark rather
   than stopping at a hard line. */
const fireStops: readonly (readonly [number, number, number, number, number])[] = [
  [0, 60, 0, 0, 0],
  [0.12, 120, 18, 6, 0.75],
  [0.3, 196, 44, 12, 0.95],
  [0.5, 236, 104, 22, 1],
  [0.7, 252, 168, 44, 1],
  [0.86, 255, 222, 110, 1],
  [1, 255, 248, 214, 1]
];

export function firePalette(): Uint8ClampedArray {
  const palette = new Uint8ClampedArray((fireHeat + 1) * 4);
  for (let step = 0; step <= fireHeat; step += 1) {
    const t = step / fireHeat;
    let index = 0;
    while (index < fireStops.length - 2 && t > fireStops[index + 1][0]) {
      index += 1;
    }
    const [from, r0, g0, b0, a0] = fireStops[index];
    const [to, r1, g1, b1, a1] = fireStops[index + 1];
    const mix = (t - from) / (to - from);
    palette[step * 4] = r0 + (r1 - r0) * mix;
    palette[step * 4 + 1] = g0 + (g1 - g0) * mix;
    palette[step * 4 + 2] = b0 + (b1 - b0) * mix;
    palette[step * 4 + 3] = step === 0 ? 0 : 255 * (a0 + (a1 - a0) * mix);
  }
  return palette;
}

/* The field as RGBA pixels, ready for putImageData. */
export function firePixels(fire: Fire, palette: Uint8ClampedArray, out: Uint8ClampedArray): void {
  for (let cell = 0; cell < fire.heat.length; cell += 1) {
    const from = fire.heat[cell] * 4;
    const to = cell * 4;
    out[to] = palette[from];
    out[to + 1] = palette[from + 1];
    out[to + 2] = palette[from + 2];
    out[to + 3] = palette[from + 3];
  }
}

/* THE LIGHT IT THROWS (owner, 2026-10-19: "the light and fire should behave
   and look like a fire reflection on a real surface. we should see slightly
   dimming"). How bright the flame is this frame, and which way it leans, read
   from the field itself so the light on the wall moves with the fire drawn
   above it. A burning flame's total heat wanders between fireLightLow and
   fireLightHigh (measured over 2000 frames: 337 to 435, the middle 80% 371 to
   411), so that band is stretched to 0..1; the flame's heat-weighted centre
   strays only a twentieth of a column either way, so fireSwayReach of a
   column is a full lean. */
export const fireLightLow = 355;
export const fireLightHigh = 425;
export const fireSwayReach = 0.08;

export type Firelight = { level: number; sway: number };

export function fireLight(fire: Fire): Firelight {
  let sum = 0;
  let weighted = 0;
  for (let y = 0; y < fireRows - 1; y += 1) {
    for (let x = 0; x < fireColumns; x += 1) {
      const value = fire.heat[y * fireColumns + x];
      sum += value;
      weighted += value * x;
    }
  }
  if (sum === 0) {
    return { level: 0, sway: 0 };
  }
  const [low, high] = fire.band;
  const level = Math.min(1, Math.max(0, (sum - low) / (high - low)));
  const lean = (weighted / sum - (fireColumns - 1) / 2) / fireSwayReach;
  return { level, sway: Math.min(1, Math.max(-1, lean)) };
}

/* The light on the wall, frame to frame: it eases toward what the flame
   throws now rather than jumping (a wall's light follows a flame, it does not
   strobe), never falls below fireLightFloor of full while the torch burns,
   and a slow gust — a random walk between fireGustLow and 1 — dims and lifts
   it every few seconds, the way a real torch's light breathes with the air.
   A still torch (reduced motion, or the first frame) shows stillGlow. */
export const fireEase = 0.5;
export const fireLightFloor = 0.45;
export const fireGustLow = 0.72;
export const fireGustStep = 0.06;

export type Glow = { light: number; sway: number; gust: number };

export const stillGlow: Glow = { light: 0.8, sway: 0, gust: 1 };

export function nextGlow(glow: Glow, thrown: Firelight, random: () => number, temper: Temper = steadyTemper): Glow {
  const gust = Math.min(1, Math.max(temper.gustLow, glow.gust + (random() - 0.5) * temper.gustStep));
  const target = (fireLightFloor + (1 - fireLightFloor) * thrown.level) * gust;
  return {
    light: glow.light + (target - glow.light) * temper.ease,
    sway: glow.sway + (thrown.sway - glow.sway) * temper.ease,
    gust
  };
}

/* EVERY TORCH IS ITS OWN FIRE (owner, 2026-10-19: "the lights do not all have
   the same gif feel … in the real world the lights would all move, behave and
   shine lights in different ways"). A torch's temper is drawn once from its
   seed, so it is the same torch on every load: how far its base breathes, how
   fast it cools (tall or short), how sharply it tapers, the share of the
   loop's frames it steps on (its flicker's tempo), how quickly its light
   follows the flame, how deep and how often the air dims it, how restless its
   lean is, how many sparks it throws and how far its light reaches — never
   further than the steady reach, which is what keeps the light off the words.
   The steady temper is every constant above, unchanged. */
export type Temper = {
  readonly breath: number;
  readonly cooling: number;
  readonly taper: number;
  readonly pace: number;
  readonly ease: number;
  readonly gustLow: number;
  readonly gustStep: number;
  readonly windStep: number;
  readonly sparks: number;
  readonly reach: number;
  readonly still: number;
};

export const steadyTemper: Temper = {
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
};

export function torchTemper(seed: number): Temper {
  const random = fireRandom((seed ^ 0x9e3779b9) >>> 0);
  const between = (low: number, high: number): number => low + (high - low) * random();
  return {
    breath: between(6, 14),
    cooling: between(2.0, 2.9),
    taper: between(0.6, 0.9),
    pace: between(0.62, 1),
    ease: between(0.3, 0.65),
    gustLow: between(0.6, 0.82),
    gustStep: between(0.03, 0.1),
    windStep: between(0.02, 0.08),
    sparks: between(0.5, 1.5),
    reach: between(0.85, 1),
    still: between(0.68, 0.9)
  };
}

/* A fire that has been burning a while: what a still frame shows to a reader
   who asked for less motion, and where a lit torch starts. A torch of its own
   temper also learns its own band: it burns fireBandFrames more, and the
   middle of the heat it reached (fireBandWiden of that middle again past
   either end, the same margin the steady band leaves its measured middle)
   becomes the band its light is stretched over, so a tall flame and a short
   one both flicker across the whole of their light. */
export const fireBandFrames = 240;
export const fireBandWiden = 0.4;

export function kindledFire(seed: number, temper: Temper = steadyTemper): Fire {
  const fire = createFire(seed, temper);
  for (let frame = 0; frame < fireRows * 2; frame += 1) {
    stepFire(fire, true);
  }
  if (temper !== steadyTemper) {
    const sums: number[] = [];
    for (let frame = 0; frame < fireBandFrames; frame += 1) {
      stepFire(fire, true);
      sums.push(fire.heat.reduce((total, value, cell) => (cell < (fireRows - 1) * fireColumns ? total + value : total), 0));
    }
    sums.sort((left, right) => left - right);
    const low = sums[Math.floor(sums.length * 0.1)];
    const high = sums[Math.floor(sums.length * 0.9)];
    const spread = Math.max(1, high - low);
    fire.band = [low - spread * fireBandWiden, high + spread * fireBandWiden];
  }
  return fire;
}

/* THE AIR AROUND IT (owner, 2026-10-19: "make the lights seem a bit more real
   by adding light particle diffusion against all the surfaces that it is
   hitting"). Two kinds of mote, in a field moteColumns by moteRows centred on
   the flame, half a torch unit a pixel: sparks, thrown up from the flame's tip
   now and then (more from a brighter fire and a sparkier torch), rising fast,
   bending with its lean and burning out inside a second; and dust, the air's
   own motes, drifting slowly up through the light and lit by it, brighter the
   brighter the fire and the nearer the flame. Pure, with the randomness passed
   in, like the fire. The field stands twenty-four units above the flame box's
   top, so the tip, where a burning flame's visible top sits (row seven of the
   field, measured across every temper), is at (12, 62). */
export const moteColumns = 24;
export const moteRows = 80;
export const moteTip: readonly [number, number] = [12, 62];
export const moteDust = 9;

export type Mote = { x: number; y: number; vx: number; vy: number; age: number; life: number; spark: boolean };

export function stepMotes(motes: Mote[], light: number, sway: number, random: () => number, temper: Temper): void {
  for (let index = motes.length - 1; index >= 0; index -= 1) {
    const mote = motes[index];
    mote.age += 1;
    if (mote.spark) {
      mote.vx += (random() - 0.5) * 0.12 + sway * 0.02;
      mote.vy *= 0.97;
    } else {
      mote.vx = (mote.vx + (random() - 0.5) * 0.02) * 0.96;
    }
    mote.x += mote.vx;
    mote.y += mote.vy;
    if (mote.age >= mote.life || mote.x < 0 || mote.x >= moteColumns || mote.y < 0 || mote.y >= moteRows) {
      motes.splice(index, 1);
    }
  }
  if (random() < (0.05 + light * 0.18) * temper.sparks) {
    motes.push({
      x: moteTip[0] + (random() - 0.5) * 4,
      y: moteTip[1] + (random() - 0.5) * 4,
      vx: sway * 0.25 + (random() - 0.5) * 0.3,
      vy: -(0.7 + random() * 0.8),
      age: 0,
      life: 10 + Math.floor(random() * 16),
      spark: true
    });
  }
  let dust = motes.reduce((count, mote) => (mote.spark ? count : count + 1), 0);
  while (dust < moteDust) {
    const life = 60 + Math.floor(random() * 120);
    motes.push({
      x: 1 + random() * (moteColumns - 2),
      y: 6 + random() * (moteRows - 8),
      vx: (random() - 0.5) * 0.06,
      vy: -(0.02 + random() * 0.06),
      age: Math.floor(random() * life),
      life,
      spark: false
    });
    dust += 1;
  }
}

/* How bright a mote is now: it brightens and fades over its life, and dust
   is lit only by the fire, so it is dimmer away from the flame and with the
   fire's own light. */
export function moteGlow(mote: Mote, light: number): number {
  const fade = Math.sin(Math.PI * Math.min(1, mote.age / mote.life));
  if (mote.spark) {
    return fade;
  }
  const dx = ((mote.x - moteTip[0]) / moteColumns) * 2;
  const dy = ((mote.y - moteTip[1]) / moteRows) * 2;
  const near = Math.max(0, 1 - Math.hypot(dx, dy));
  return fade * near * light * 0.8;
}
