/* The night sky behind the page (owner direction, 2026-10-16): "a starry night
 * … not super scary, fast, flashy … subtle. But you can tell that in the
 * background … the background is flashing in and out with the stars".
 *
 * Drawn in code on one canvas rather than shipped as a GIF: a GIF bands a soft
 * nebula into 256 colours, weighs megabytes, and cannot pause or honour Reduce
 * Motion. Here the still part — the gradient and the nebula — is rendered once
 * per size, and only the stars move, at a capped frame rate, while the page is
 * visible. A reader who asked for less motion gets one still frame: the same
 * sky, not moving.
 *
 * Pure geometry and colour live in this module; NightSky.svelte owns the
 * canvas, the size and the loop. */

export type SkyNebula = {
  readonly seed: number;
  /* Rendered at 1/res of the viewport and scaled up soft. */
  readonly res: number;
  readonly scale: number;
  readonly warp: number;
  readonly floor: number;
  readonly gamma: number;
  readonly opacity: number;
  /* Darkest to brightest. */
  readonly colors: readonly string[];
  /* A slow brightening and fading of the whole nebula. */
  readonly breathe?: boolean;
};

export type SkyStars = {
  /* Stars per square CSS pixel. */
  readonly density: number;
  /* "r,g,b" triples. */
  readonly colors: readonly string[];
  /* Twinkle period range, seconds. */
  readonly period: readonly [number, number];
  /* The share of stars that fade fully in and out rather than shimmer. */
  readonly flicker: number;
  /* Twinkle in this many steps (a sprite-like pulse) instead of smoothly. */
  readonly steps?: number;
  /* Fine stars: one even, small size, and a gentler fade for the flickerers. */
  readonly fine?: boolean;
  /* Parallax layers drifting right to left, in CSS pixels a second, far to
     near; each star belongs to one. */
  readonly drift?: readonly number[];
};

export type SkyPreset = {
  readonly id: string;
  /* Top to bottom. */
  readonly sky: readonly string[];
  readonly nebula?: SkyNebula;
  readonly stars: SkyStars;
};

/* The sky the page wears — the owner's pick from the gallery (2026-10-16):
 * "I like midnight blue … fine static looks good, clean and space like, and I
 * like drift's movement … maybe 15% faster", then, of the three takes on that,
 * "midnight drift deeper", made hueless on 2026-10-17 ("not happy with the
 * blue background color"): a black sky, so the stars carry more; a dense
 * field of fine stars flickering gently, in three layers gliding right to left
 * at 1.15 times the gallery's drift. */
export const skyPreset: SkyPreset = {
  id: 'midnight-drift-deeper',
  sky: ['#060606', '#141414', '#242424'],
  nebula: {
    seed: 83,
    res: 7,
    scale: 1.8,
    warp: 1.2,
    floor: 0.5,
    gamma: 1.6,
    opacity: 0.2,
    colors: ['#101010', '#2d2d2d', '#5c5c5c']
  },
  stars: {
    density: 0.0014,
    colors: ['255,255,255', '230,230,230'],
    period: [2, 5],
    flicker: 0.4,
    fine: true,
    drift: [2.3, 5.75, 10.35]
  }
};

/* The loop's ceiling: a slow sky needs no more than this. */
export const skyFrameInterval = 1000 / 30;

/* The sky paces itself. A frame drawn on a canvas the size of the window
 * costs the page a repaint, and where a browser draws without a GPU that
 * repaint is slow: in WebKit on Linux a bare animated canvas took 88ms a
 * frame, and the page took 95ms a frame with the sky moving against 17ms
 * with it still, so a reader there got a page that answered a few times a
 * second. So when the page takes longer than skyFrameBudget to answer a sky
 * frame, the sky waits at least skyCostShare times that long before its next
 * one (and at least twice its last wait), so it takes no more than a tenth of
 * the page's time, down to one frame each skySlowestInterval; when the page
 * answers in time the sky doubles back towards its ceiling. It slows at once,
 * so the page is quick within a frame or two of loading; where frames are
 * cheap, as in any browser with a GPU, the sky never leaves the ceiling. */
export const skyFrameBudget = 50;
export const skyCostShare = 10;
export const skySlowestInterval = 1000;

export function nextSkyInterval(interval: number, answeredIn: number): number {
  return answeredIn > skyFrameBudget
    ? Math.min(skySlowestInterval, Math.max(interval * 2, answeredIn * skyCostShare))
    : Math.max(skyFrameInterval, interval / 2);
}
/* The canvas resolution ceiling: a soft background gains nothing past it. */
export const skyMaxPixelRatio = 1.5;

const TAU = Math.PI * 2;

/* A small seeded generator, so a sky is the same sky on every load. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Value noise with fractal octaves — the nebula's raw material. */
export function noiseField(seed: number): (x: number, y: number, octaves?: number) => number {
  const random = seeded(seed);
  const perm = new Uint8Array(512);
  const values = new Float32Array(256);
  for (let index = 0; index < 256; index += 1) {
    perm[index] = index;
    values[index] = random();
  }
  for (let index = 255; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [perm[index], perm[swap]] = [perm[swap], perm[index]];
  }
  for (let index = 0; index < 256; index += 1) {
    perm[index + 256] = perm[index];
  }
  const fade = (t: number): number => t * t * (3 - 2 * t);
  const lattice = (x: number, y: number): number => values[perm[(perm[x & 255] + y) & 511] & 255];
  const noise = (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = fade(x - xi);
    const v = fade(y - yi);
    const a = lattice(xi, yi);
    const b = lattice(xi + 1, yi);
    const c = lattice(xi, yi + 1);
    const d = lattice(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y, octaves = 5) => {
    let sum = 0;
    let amplitude = 0.5;
    let frequency = 1;
    for (let octave = 0; octave < octaves; octave += 1) {
      sum += amplitude * noise(x * frequency, y * frequency);
      frequency *= 2.03;
      amplitude *= 0.5;
    }
    return sum;
  };
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/* The nebula as RGBA pixels at low resolution: domain-warped fractal noise
 * mapped onto the preset's ramp, its alpha rising with its brightness. */
export function nebulaPixels(width: number, height: number, nebula: SkyNebula): Uint8ClampedArray {
  const field = noiseField(nebula.seed);
  const ramp = nebula.colors.map(rgb);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = (x / width) * nebula.scale * (width / height);
      const ny = (y / height) * nebula.scale;
      const wx = field(nx + 3.1, ny + 1.7, 4);
      const wy = field(nx - 2.3, ny + 4.9, 4);
      let t = clamp((field(nx + nebula.warp * wx, ny + nebula.warp * wy, 6) - nebula.floor) / (1 - nebula.floor));
      t = Math.pow(t, nebula.gamma);
      const position = t * (ramp.length - 1);
      const low = Math.min(ramp.length - 2, Math.floor(position));
      const mix = position - low;
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        out[offset + channel] = ramp[low][channel] + (ramp[low + 1][channel] - ramp[low][channel]) * mix;
      }
      out[offset + 3] = Math.round(255 * clamp(t * nebula.opacity * 1.6));
    }
  }
  return out;
}

export type Star = {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly base: number;
  readonly speed: number;
  readonly phase: number;
  /* How sharply a flickering star fades: 0 for a star that only shimmers. */
  readonly fade: number;
  readonly color: string;
  /* Its drift layer, an index into the preset's drift speeds. */
  readonly layer: number;
};

/* The stars for a viewport, the same ones for the same size every load. */
export function starField(width: number, height: number, stars: SkyStars, seed: number): Star[] {
  const random = seeded(seed);
  const count = Math.round(width * height * stars.density);
  const field: Star[] = [];
  const [shortest, longest] = stars.period;
  for (let index = 0; index < count; index += 1) {
    field.push({
      x: random() * width,
      y: random() * height,
      size: stars.fine === true ? 1 + random() * 0.8 : 0.7 + Math.pow(random(), 4.5) * 2.3,
      base: 0.45 + random() * 0.55,
      speed: TAU / (shortest + random() * (longest - shortest)),
      phase: random() * TAU,
      fade: random() < stars.flicker ? (stars.fine === true ? 1.6 : 3) : 0,
      color: stars.colors[Math.floor(random() * stars.colors.length)],
      layer: stars.drift === undefined ? 0 : Math.floor(random() * stars.drift.length)
    });
  }
  return field;
}

/* How bright one star is at time t (seconds): a slow shimmer for most, a full
 * fade in and out for the few that flicker. */
export function twinkle(star: Star, t: number, steps?: number): number {
  let wave = 0.5 + 0.5 * Math.sin(t * star.speed + star.phase);
  wave = star.fade > 0 ? Math.pow(wave, star.fade) : 0.55 + 0.45 * wave;
  if (steps !== undefined && steps > 0) {
    wave = Math.round(wave * steps) / steps;
  }
  return star.base * wave;
}

/* Where a drifting star is at time t: it glides right to left at its layer's
 * speed and re-enters on the right, for as long as the page is open. */
export function driftX(star: Star, t: number, width: number, drift: readonly number[] | undefined): number {
  if (drift === undefined || width <= 0) {
    return star.x;
  }
  const travelled = star.x - t * (drift[star.layer] ?? 0);
  return ((travelled % width) + width) % width;
}
