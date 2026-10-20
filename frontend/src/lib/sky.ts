/* The sky behind the page (owner direction, 2026-10-16): "a starry night
 * … not super scary, fast, flashy … subtle. But you can tell that in the
 * background … the background is flashing in and out with the stars" — and,
 * since 2026-10-19, a day sky kept for the scene's day.
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
  /* Pixel stars over the fine field (SkyGlints, below). */
  readonly glints?: SkyGlints;
};

/* PIXEL STARS (owner, 2026-10-19, of a title-card mock: "I really like the
 * animation and style of N9 title card, in particular for how the stars have
 * bigger sizes, bigger trinkles. They look much more realistic yet playful").
 * A sprinkle of crisp square stars over the fine field, drawn on whole screen
 * pixels: most are a plain square, and some flare — a pixel cross one square
 * out from the core, then a second square out, then the core alone — stepping
 * between the three rather than easing, each on its own period and phase, so
 * no two flare together. They drift with the field's layers. */
export type SkyGlints = {
  /* Glints per square CSS pixel. */
  readonly density: number;
  /* The share that flare. */
  readonly flaring: number;
  /* A flaring star's square, and a plain one's, in CSS pixels. */
  readonly unit: number;
  readonly plain: number;
  /* A flare's cycle range, seconds. */
  readonly period: readonly [number, number];
  /* "r,g,b" triples: the core, and the arms of the cross. */
  readonly core: string;
  readonly arm: string;
};

export type SkyPreset = {
  readonly id: string;
  /* Top to bottom. */
  readonly sky: readonly string[];
  readonly nebula?: SkyNebula;
  readonly stars: SkyStars;
};

/* THE NIGHT, WITH THE DAY KEPT (owner, 2026-10-19: "always set it to night
 * by default", then "do away with [the control] all together but keep the
 * logic"). The sky no longer reads the reader's clock, and every visit is the
 * night; the day sky stays drawn for the phase App.svelte would hand down if
 * a control came back. The dawn the clock used to show went with the clock. */
export type SkyPhase = 'day' | 'night';

/* The two skies.
 *
 * NIGHT is the owner's pick from the gallery (2026-10-16): "I like midnight
 * blue … fine static looks good, clean and space like, and I like drift's
 * movement … maybe 15% faster", then, of the three takes on that, "midnight
 * drift deeper", made hueless on 2026-10-17: a black sky, so the stars carry
 * more; a dense field of fine stars flickering gently, in three layers gliding
 * right to left at 1.15 times the gallery's drift.
 *
 * DAY is bright blue, lighter toward the horizon, with soft white cloud in the
 * nebula's place and no stars — so the day sky is one still picture and runs
 * no loop at all. */
export const skyPresets: Readonly<Record<SkyPhase, SkyPreset>> = {
  day: {
    id: 'bright-day',
    sky: ['#1c68d4', '#3f93ea', '#8cc8fb'],
    nebula: {
      seed: 61,
      res: 6,
      scale: 1.3,
      warp: 1.3,
      floor: 0.46,
      gamma: 1.2,
      opacity: 0.5,
      colors: ['#d7ebff', '#f1f8ff', '#ffffff']
    },
    stars: {
      density: 0,
      colors: ['255,255,255'],
      period: [2, 5],
      flicker: 0
    }
  },
  night: {
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
      drift: [2.3, 5.75, 10.35],
      /* The title card's own stars: one in seven thousand square pixels,
         about the spacing its sky showed, since the page shows sky only round
         the sheet; three in ten of them flaring, 4px squares with arms of its
         lilac (greyed a little toward the night's own white), plain ones at
         3px, on a cycle near its 2.8s. */
      glints: {
        density: 1 / 7000,
        flaring: 0.3,
        unit: 4,
        plain: 3,
        period: [2.4, 3.6],
        core: '244,241,255',
        arm: '168,170,218'
      }
    }
  }
};

/* A sky with no stars has nothing that moves: it is drawn once and holds. */
export function skyMoves(preset: SkyPreset): boolean {
  return preset.stars.density > 0;
}

/* The loop's ceiling: a slow sky needs no more than this. */
export const skyFrameInterval = 1000 / 30;

/* The sky paces itself. A frame drawn on a canvas the size of the window
 * costs the page a repaint, and where a browser draws without a GPU that
 * repaint is slow: in WebKit on Linux a bare animated canvas took 88ms a
 * frame, and the page took 95ms a frame with the sky moving against 17ms
 * with it still, so a reader there got a page that answered a few times a
 * second. So when the page takes longer than skyFrameBudget to answer a sky
 * frame, the sky waits skyCostShare times that long before its next one, so
 * it takes no more than a tenth of the page's time, down to one frame each
 * skySlowestInterval; when the page answers in time the sky doubles back
 * towards its ceiling. It slows at once, so the page is quick within a frame
 * or two of loading; where frames are cheap, as in any browser with a GPU,
 * the sky never leaves the ceiling.
 *
 * The floor is half a minute, not a second. Once the sheet carried its wall,
 * its frame, its greenery and the torches (2026-10-19), a sky frame cost
 * WebKit without a GPU some 400ms on the iPhone profile and over a second on
 * the desktop one, and at a frame a second the sky and the fire together took
 * most of the page's time: J and the trackers' lanes missed their frames. A
 * sky that waits ten times its cost keeps its tenth however dear a frame
 * gets, up to three seconds of one. It waits exactly that, no longer: the
 * wait used to double on every late answer as well, which under a floor of
 * half a minute would have stilled the sky on a phone whose frames merely run
 * a little late, far below the tenth it can afford. */
export const skyFrameBudget = 50;
export const skyCostShare = 10;
export const skySlowestInterval = 30_000;

export function nextSkyInterval(interval: number, answeredIn: number): number {
  return answeredIn > skyFrameBudget
    ? Math.min(skySlowestInterval, answeredIn * skyCostShare)
    : Math.max(skyFrameInterval, interval / 2);
}

/* A LOOP'S PACE, kept between its frames: the sky's and the fire's alike.
 *
 * A drawing is paid for until the page answers in time again. Where a browser
 * draws without a GPU, one drawing on a canvas under the sheet is paid for
 * over the frames after it, not in the first: one pixel drawn on the sky cost
 * WebKit on Linux two slow frames and some 400ms before J's frames were quick
 * again. A pace that read only the first frame saw half of that, and the sky
 * and the fire each took twice their share. So the cost of a drawing runs from
 * the drawing to the end of the first frame after it that took no more than
 * skyFrameBudget, and the loop draws nothing while it is still being paid
 * for. Where frames are cheap that is the next frame, as before. */
export type Pace = {
  /* Called once a frame: whether the loop draws in this one. */
  frame(now: number): boolean;
  /* The loop drew in this frame. */
  drew(now: number): void;
  /* The loop started again: the frames before are forgotten, so a hidden
     spell or a resize is not read as a slow drawing. */
  restart(): void;
  /* The wait before the next drawing, as it stands. */
  readonly interval: number;
};

export function pace(ceiling: number, next: (interval: number, answeredIn: number) => number): Pace {
  let interval = ceiling;
  let last = -Infinity;
  let drawnAt = -1;
  let previous = -1;
  return {
    frame(now) {
      const took = previous >= 0 ? now - previous : 0;
      previous = now;
      if (drawnAt >= 0) {
        if (took > skyFrameBudget) {
          return false;
        }
        interval = next(interval, now - drawnAt);
        drawnAt = -1;
      }
      return now - last >= interval;
    },
    drew(now) {
      last = now;
      drawnAt = now;
    },
    restart() {
      drawnAt = -1;
      previous = -1;
    },
    get interval() {
      return interval;
    }
  };
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

export type Glint = {
  readonly x: number;
  readonly y: number;
  readonly flares: boolean;
  /* Its flare's cycle, seconds, and where in it the page opens. */
  readonly period: number;
  readonly phase: number;
  readonly layer: number;
};

/* The pixel stars for a viewport, the same ones for the same size every
 * load, from their own seed so the fine field is the field it always was. */
export function glintField(
  width: number,
  height: number,
  glints: SkyGlints,
  seed: number,
  drift: readonly number[] | undefined
): Glint[] {
  const random = seeded(seed);
  const count = Math.round(width * height * glints.density);
  const [shortest, longest] = glints.period;
  const field: Glint[] = [];
  for (let index = 0; index < count; index += 1) {
    const period = shortest + random() * (longest - shortest);
    field.push({
      x: random() * width,
      y: random() * height,
      flares: random() < glints.flaring,
      period,
      phase: random() * period,
      layer: drift === undefined ? 0 : Math.floor(random() * drift.length)
    });
  }
  return field;
}

/* How far a flaring star's cross reaches at time t, in squares: one for the
 * first half of its cycle, two for the next quarter, none for the last —
 * the title card's own keyframes (0%, 50%, 75%), stepped. A plain star's
 * reach is always none. */
export function glintReach(glint: Glint, t: number): 0 | 1 | 2 {
  if (!glint.flares) {
    return 0;
  }
  const at = (((t + glint.phase) % glint.period) + glint.period) % glint.period / glint.period;
  return at < 0.5 ? 1 : at < 0.75 ? 2 : 0;
}

/* Where a drifting star is at time t: it glides right to left at its layer's
 * speed and re-enters on the right, for as long as the page is open. */
export function driftX(
  star: Pick<Star, 'x' | 'layer'>,
  t: number,
  width: number,
  drift: readonly number[] | undefined
): number {
  if (drift === undefined || width <= 0) {
    return star.x;
  }
  const travelled = star.x - t * (drift[star.layer] ?? 0);
  return ((travelled % width) + width) % width;
}
