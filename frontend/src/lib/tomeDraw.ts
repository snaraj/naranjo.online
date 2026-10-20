/* THE CHAINED TOME'S DRAWING (owner, 2026-10-20: T3, the corbel). Paints what
 * lib/tome.ts lays out — the corbel, the desk and its lip, the dagged cloth,
 * the hasp, the staple and the chain — on a canvas, once for each size. The
 * light is laid in once too, at the resting brightness of the torches beside
 * it, so nothing here runs while the page is still: WebKit without a GPU pays
 * for a canvas as one picture, where the same drawing in SVG paint costs it
 * every shape on every repaint, and its textures are seeded noise rather than
 * SVG filters for the same reason.
 *
 * Colours are the stylesheet's tokens, read by name off the canvas (the
 * palette: argument), so this file holds no colour of its own. */

import { fireRandom } from './fire.ts';
import { catenary, chainLinks, cloth, type Corbel } from './tome.ts';

export type TomePalette = Record<string, string>;

/* The tokens the drawing reads, without their --palette-keep- prefix. */
export const tomePaletteTokens: readonly string[] = [
  'oak-1', 'oak-2', 'oak-3', 'oak-4',
  'stone-1', 'stone-2', 'stone-3', 'stone-4',
  'iron-1', 'torch-iron', 'torch-iron-dark', 'iron-4',
  'rubric', 'madder-deep', 'madder-dark',
  'bone', 'bone-mid', 'bone-deep',
  'lapis-mid', 'lapis-deep', 'vellum',
  'umbra', 'lamp', 'lamp-glaze', 'sheen'
];

/* How bright the torches beside the tome rest (lib/fire.ts's steady light),
 * and how much of it reaches the base: each side's light falls on the faces
 * that turn to it. */
const restingLight = 0.8;

type Ctx = CanvasRenderingContext2D;

/* A seeded grain, one canvas per kind, reused for every draw: value noise of
 * a few octaves, grey, stretched along the grain (wood) or round (stone,
 * cloth). Laid over a surface in 'overlay', it roughens without darkening. */
const grains = new Map<string, HTMLCanvasElement>();
function grain(kind: 'stone' | 'oak' | 'nap'): HTMLCanvasElement {
  const known = grains.get(kind);
  if (known !== undefined) return known;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (g !== null) {
    const random = fireRandom(kind === 'stone' ? 12 : kind === 'oak' ? 3 : 9);
    const lattice = (n: number): number[] => Array.from({ length: n * n }, () => random());
    const octaves: [number, number, number][] = kind === 'oak' ? [[4, 32, 0.6], [8, 64, 0.3], [16, 128, 0.1]] : [[8, 8, 0.5], [16, 16, 0.3], [32, 32, 0.2]];
    const tables = octaves.map(([nx, ny]) => ({ nx, ny, values: lattice(Math.max(nx, ny)) }));
    const image = g.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let value = 0;
        tables.forEach(({ nx, ny, values }, index) => {
          const fx = (x / size) * nx;
          const fy = (y / size) * ny;
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const tx = fx - x0;
          const ty = fy - y0;
          const n = Math.max(nx, ny);
          const at = (i: number, j: number): number => values[((j % ny) * n + (i % nx)) % values.length];
          const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
          const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
          value += (top * (1 - ty) + bottom * ty) * octaves[index][2];
        });
        const shade = Math.round(255 * Math.min(1, Math.max(0, value)));
        const at = (y * size + x) * 4;
        image.data[at] = shade;
        image.data[at + 1] = shade;
        image.data[at + 2] = shade;
        image.data[at + 3] = 255;
      }
    }
    g.putImageData(image, 0, 0);
  }
  grains.set(kind, canvas);
  return canvas;
}

/* Fill a path, then roughen it with its grain and light the faces that turn
 * to each torch: 'flat' a side light across the face, 'rim' the edges of a
 * rounded body. */
function solid(
  ctx: Ctx,
  path: Path2D,
  fill: string | CanvasGradient,
  box: { x: number; y: number; w: number; h: number },
  palette: TomePalette,
  options: { grain?: 'stone' | 'oak' | 'nap'; grainScale?: [number, number]; lit?: 'flat' | 'rim'; light?: number } = {}
): void {
  ctx.fillStyle = fill;
  ctx.fill(path);
  if (options.grain !== undefined) {
    const pattern = ctx.createPattern(grain(options.grain), 'repeat');
    if (pattern !== null) {
      const [sx, sy] = options.grainScale ?? [1, 1];
      pattern.setTransform(new DOMMatrix([sx, 0, 0, sy, box.x, box.y]));
      ctx.save();
      ctx.clip(path);
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = pattern;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.restore();
    }
  }
  if (options.lit !== undefined) {
    const k = (options.light ?? 1) * restingLight;
    const stops: [number, number][] =
      options.lit === 'flat'
        ? [[0, 0.45], [0.5, 0.1], [1, 0]]
        : [[0, 0], [0.12, 0.6], [0.34, 0.1], [0.5, 0]];
    for (const side of [0, 1]) {
      const gradient = ctx.createLinearGradient(box.x, 0, box.x + box.w, 0);
      for (const [at, alpha] of stops) {
        gradient.addColorStop(side === 0 ? at : 1 - at, withAlpha(palette['lamp-glaze'], alpha * k));
      }
      ctx.save();
      ctx.clip(path);
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = gradient;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.restore();
    }
  }
}

/* A token's colour at an alpha: a hex colour as rgb(... / a). */
export function withAlpha(colour: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (hex === null) return colour;
  const value = Number.parseInt(hex[1], 16);
  return `rgb(${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255} / ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

const rect = (x: number, y: number, w: number, h: number): Path2D => {
  const p = new Path2D();
  p.rect(x, y, w, h);
  return p;
};

const rounded = (x: number, y: number, w: number, h: number, r: number): Path2D => {
  const p = new Path2D();
  p.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  return p;
};

const polygon = (points: readonly (readonly [number, number])[]): Path2D => {
  const p = new Path2D();
  points.forEach(([x, y], index) => (index === 0 ? p.moveTo(x, y) : p.lineTo(x, y)));
  p.closePath();
  return p;
};

function vertical(ctx: Ctx, top: number, bottom: number, stops: readonly [number, string][]): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  for (const [at, colour] of stops) gradient.addColorStop(at, colour);
  return gradient;
}

function horizontal(ctx: Ctx, left: number, right: number, stops: readonly [number, string][]): CanvasGradient {
  const gradient = ctx.createLinearGradient(left, 0, right, 0);
  for (const [at, colour] of stops) gradient.addColorStop(at, colour);
  return gradient;
}

/* The dark a ledge casts on what lies just under it. */
function underShade(ctx: Ctx, palette: TomePalette, x: number, y: number, w: number, h: number, k: number): void {
  ctx.fillStyle = vertical(ctx, y, y + h, [[0, withAlpha(palette.umbra, k)], [1, withAlpha(palette.umbra, 0)]]);
  ctx.fillRect(x, y, w, h);
}

function line(ctx: Ctx, points: readonly (readonly [number, number])[], colour: string, width: number, alpha = 1): void {
  ctx.beginPath();
  points.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/* THE BASE: the corbel's shadow on the wall, its five courses and tail, the
 * desk under its lip, the dagged cloth and its fringe and tassels, and the
 * lip the tome rests against — in the base's units (lib/tome.ts), the
 * context already scaled to them. */
export function drawBase(ctx: Ctx, base: Corbel, palette: TomePalette): void {
  const { width: W, centre: C, courses, tail } = base;
  const hem = cloth(base.cloth);
  const tailPath = new Path2D(
    `M${C - tail.half} ${tail.top}H${C + tail.half}C${C + tail.half} ${tail.top + 26} ${C + tail.half * 0.45} ${tail.bottom} ${C} ${tail.bottom}` +
      `C${C - tail.half * 0.45} ${tail.bottom} ${C - tail.half} ${tail.top + 26} ${C - tail.half} ${tail.top}Z`
  );

  /* Its shadow on the wall: thrown down and a little away by the torches
     overhead, and a tighter dark where stone meets stone. */
  const silhouette = new Path2D();
  for (const course of courses) silhouette.addPath(rect(C - course.half - 4, course.top, course.half * 2 + 8, course.bottom - course.top));
  silhouette.addPath(tailPath);
  silhouette.addPath(rect(34, 14, W - 68, 46));
  silhouette.addPath(polygon([[hem.left, base.cloth.y0], [hem.right, base.cloth.y0], ...hem.hem]));
  for (const [blur, dx, dy, alpha] of [[22, 10, 14, 0.55], [5, 0, 2, 0.6]] as const) {
    ctx.save();
    ctx.shadowColor = withAlpha(palette.umbra, alpha);
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = dx + 4000;
    ctx.shadowOffsetY = dy;
    ctx.translate(-4000, 0);
    ctx.fillStyle = palette.umbra;
    ctx.fill(silhouette);
    ctx.restore();
  }

  /* The corbel: courses stepping in toward a rounded tail, each a ledge and
     a face, a joint in each, the arris catching the light. */
  const random = fireRandom(19);
  courses.forEach((course, index) => {
    const { top, bottom, half } = course;
    const ledge = polygon([[C - half - 4, top], [C + half + 4, top], [C + half, top + 5], [C - half, top + 5]]);
    solid(ctx, ledge, palette['stone-2'], { x: C - half - 4, y: top, w: half * 2 + 8, h: 5 }, palette, { grain: 'stone', lit: 'flat' });
    const face = rect(C - half, top + 5, half * 2, bottom - top - 5);
    const fill = vertical(ctx, top + 5, bottom, [[0, palette['stone-2']], [0.14, palette['stone-3']], [0.8, palette['stone-3']], [1, palette['stone-4']]]);
    solid(ctx, face, fill, { x: C - half, y: top + 5, w: half * 2, h: bottom - top - 5 }, palette, { grain: 'stone', lit: 'flat', light: 0.7 });
    const joint = C + (index % 2 ? -1 : 1) * (20 + random() * half * 0.5);
    line(ctx, [[joint, top + 6], [joint, bottom - 1]], palette['stone-4'], 1.8);
    line(ctx, [[C - half + 1, top + 6], [C + half - 1, top + 6]], palette['stone-1'], 1.1, 0.55);
    if (index > 0) underShade(ctx, palette, C - half, top, half * 2, 9, 0.5);
  });
  const tailFill = horizontal(ctx, C - tail.half, C + tail.half, [[0, palette['stone-4']], [0.3, palette['stone-3']], [0.55, palette['stone-2']], [0.8, palette['stone-3']], [1, palette['stone-4']]]);
  solid(ctx, tailPath, tailFill, { x: C - tail.half, y: tail.top, w: tail.half * 2, h: tail.bottom - tail.top }, palette, { grain: 'stone', lit: 'rim' });
  line(ctx, [[C - tail.half + 1, tail.top + 1], [C + tail.half - 1, tail.top + 1]], palette['stone-1'], 1.1, 0.55);

  /* The desk's box under its lip, deep in the lip's shadow. */
  solid(ctx, rect(34, 14, W - 68, 46), vertical(ctx, 14, 60, [[0, palette['oak-3']], [1, palette['oak-4']]]), { x: 34, y: 14, w: W - 68, h: 46 }, palette, {
    grain: 'oak',
    grainScale: [3, 0.35]
  });
  underShade(ctx, palette, 30, 14, W - 60, 20, 0.8);
  underShade(ctx, palette, C - courses[0].half, 60, courses[0].half * 2, 18, 0.55);

  drawCloth(ctx, base, palette);

  /* The lip the tome rests against: a moulded ledge of oak, lit along its
     top and grooved along its middle. */
  const { x0, x1, top, height } = base.lip;
  const lipFill = vertical(ctx, top, top + height, [[0, palette['oak-1']], [0.1, palette['oak-1']], [0.18, palette['oak-2']], [0.8, palette['oak-2']], [1, palette['oak-3']]]);
  solid(ctx, rounded(x0, top, x1 - x0, height, 4), lipFill, { x: x0, y: top, w: x1 - x0, h: height }, palette, { grain: 'oak', grainScale: [3, 0.35], lit: 'flat' });
  line(ctx, [[x0 + 3, top + 1.2], [x1 - 3, top + 1.2]], palette['oak-1'], 1.2, 0.8);
  line(ctx, [[x0 + 4, top + height * 0.5], [x1 - 4, top + height * 0.5]], palette['oak-4'], 1.2);
  line(ctx, [[x0 + 4, top + height * 0.5 + 1.4], [x1 - 4, top + height * 0.5 + 1.4]], palette['oak-1'], 0.8, 0.8);
}

/* THE CLOTH, in the initial's madder: dotted as the initial's square is,
 * worked in bone along its top, its sides and its hem, shaded in its folds and
 * deep under the ledge it hangs from, each torch lighting the flanks that face
 * it, its hem cut into dags with a tassel at each and a fringe along it. */
function drawCloth(ctx: Ctx, base: Corbel, palette: TomePalette): void {
  const spec = base.cloth;
  const hem = cloth(spec);
  const outline = polygon([[spec.x0, spec.y0], [spec.x1, spec.y0], ...hem.hem]);
  const span = hem.right - hem.left;
  solid(ctx, outline, palette.rubric, { x: hem.left, y: spec.y0, w: span, h: hem.bottom - spec.y0 }, palette, { grain: 'nap', grainScale: [0.5, 0.35] });

  /* The dotted ground. */
  ctx.save();
  ctx.clip(outline);
  ctx.fillStyle = withAlpha(palette.vellum, 0.12);
  for (let y = spec.y0 + 3.5; y < hem.bottom; y += 7) {
    for (let x = hem.left + 3.5; x < hem.right; x += 7) {
      ctx.beginPath();
      ctx.arc(x, y, 0.85, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  /* The work in bone: a band along the top, lines down the sides and two
     along the hem, a row of dots between those, lapis every third. */
  const ex0 = spec.x0 + 9;
  const ex1 = spec.x1 - 9;
  const band = spec.y0 + 11;
  ctx.lineJoin = 'round';
  line(ctx, [[ex0, band], [ex1, band]], palette['bone-mid'], 1.3);
  line(ctx, [[ex0, band + 13], [ex1, band + 13]], palette['bone-mid'], 1.3);
  for (let x = ex0 + 12; x < ex1 - 6; x += 20) {
    ctx.strokeStyle = palette['bone-mid'];
    ctx.lineWidth = 1;
    ctx.stroke(polygon([[x, band + 2.5], [x + 4, band + 6.5], [x, band + 10.5], [x - 4, band + 6.5]]));
    ctx.fillStyle = palette['lapis-mid'];
    ctx.beginPath();
    ctx.arc(x, band + 6.5, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const along = (lift: number): [number, number][] => {
    const points: [number, number][] = [];
    for (let x = hem.left + 9; x <= hem.right - 9; x += 4) points.push([x, hem.hemAt(x) - lift]);
    return points;
  };
  line(ctx, [[ex0, band], [hem.left + 9, hem.hemAt(hem.left + 9) - 9]], palette['bone-mid'], 1.3);
  line(ctx, [[ex1, band], [hem.right - 9, hem.hemAt(hem.right - 9) - 9]], palette['bone-mid'], 1.3);
  line(ctx, along(9), palette['bone-mid'], 1.3);
  line(ctx, along(19), palette['bone-mid'], 1.3);
  for (let x = hem.left + 16, index = 0; x < hem.right - 14; x += 7, index += 1) {
    ctx.fillStyle = index % 3 === 1 ? palette['lapis-mid'] : palette['bone-mid'];
    ctx.beginPath();
    ctx.arc(x, hem.hemAt(x) - 14, index % 3 === 1 ? 1.6 : 1.1, 0, Math.PI * 2);
    ctx.fill();
  }

  /* The folds: sheen on each ridge, shade in each valley, each torch on the
     flanks that face it; then the dark under the ledge and at the foot. */
  ctx.save();
  ctx.clip(outline);
  const folds = ctx.createLinearGradient(hem.left, 0, hem.right, 0);
  const lit = ctx.createLinearGradient(hem.left, 0, hem.right, 0);
  const at = (x: number): number => Math.min(1, Math.max(0, (x - hem.left) / span));
  const random = fireRandom(spec.seed + 1);
  for (let index = 0; index < hem.ridges.length - 1; index += 1) {
    const a = hem.ridges[index];
    const b = hem.ridges[index + 1];
    const valley = (a + b) / 2;
    folds.addColorStop(at(a), withAlpha(palette.sheen, 0.07));
    folds.addColorStop(at(a + (valley - a) * 0.5), withAlpha(palette.umbra, 0.2));
    folds.addColorStop(at(valley), withAlpha(palette.umbra, 0.5 + random() * 0.25));
    folds.addColorStop(at(valley + (b - valley) * 0.5), withAlpha(palette.umbra, 0.18));
    const facing = 0.55 * restingLight;
    lit.addColorStop(at(a), withAlpha(palette['lamp-glaze'], 0));
    lit.addColorStop(at(a + (valley - a) * 0.42), withAlpha(palette['lamp-glaze'], facing));
    lit.addColorStop(at(valley), withAlpha(palette['lamp-glaze'], 0));
    lit.addColorStop(at(valley + (b - valley) * 0.58), withAlpha(palette['lamp-glaze'], facing));
  }
  folds.addColorStop(1, withAlpha(palette.sheen, 0.05));
  ctx.fillStyle = folds;
  ctx.fillRect(hem.left, spec.y0, span, hem.bottom - spec.y0);
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = lit;
  ctx.fillRect(hem.left, spec.y0, span, hem.bottom - spec.y0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = vertical(ctx, spec.y0, hem.bottom, [
    [0, withAlpha(palette.umbra, 0.7)],
    [0.07, withAlpha(palette.umbra, 0.32)],
    [0.22, withAlpha(palette.umbra, 0.04)],
    [0.7, withAlpha(palette.umbra, 0.04)],
    [1, withAlpha(palette.umbra, 0.38)]
  ]);
  ctx.fillRect(hem.left, spec.y0, span, hem.bottom - spec.y0);
  ctx.restore();
  line(ctx, hem.hem, palette['madder-dark'], 1.5);

  /* The fringe: threads of madder and bone from a knotted heading, and a
     tassel at the middle of every dag. */
  const threads = fireRandom(spec.seed + 2);
  for (let x = hem.left + 1.5, index = 0; x <= hem.right - 1; x += 3, index += 1) {
    const y = hem.hemAt(x);
    const length = spec.fringe * (0.86 + threads() * 0.24);
    const dx = (threads() - 0.5) * 1.6;
    line(ctx, [[x, y], [x + dx, y + length]], index % 4 === 3 ? palette['bone-deep'] : palette['madder-deep'], 1.5);
    if (index % 2 === 0) {
      ctx.fillStyle = palette['bone-deep'];
      ctx.beginPath();
      ctx.arc(x, y + 2.4, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const x of hem.tassels) {
    const y = hem.hemAt(x);
    ctx.fillStyle = palette['bone-deep'];
    ctx.fillRect(x - 1, y, 2, 6);
    ctx.fillStyle = palette.bone;
    ctx.beginPath();
    ctx.ellipse(x, y + 8, 4.2, 3.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.rubric;
    ctx.fill(polygon([[x - 3.6, y + 10], [x + 3.6, y + 10], [x + 6, y + 30], [x - 6, y + 30]]));
    for (const [from, to] of [[-4, -5.6], [-1.3, -1.8], [1.3, 1.8], [4, 5.6]] as const) {
      line(ctx, [[x + from, y + 13], [x + to, y + 29]], palette['bone-deep'], 1);
    }
  }
}

/* THE IRON: a hasp riveted to the tome's board with an eye at its end, a
 * forged staple run into a joint of the masonry, and the chain between them
 * hanging as a catenary, its links alternately face-on and edge-on, rimmed in
 * dark, lit from above, with a glint for each torch. In the tome's own pixels:
 * `hasp` and `staple` are where each is fixed, `s` the base's scale. */
export function drawChain(ctx: Ctx, hasp: readonly [number, number], staple: readonly [number, number], s: number, palette: TomePalette): void {
  /* The staple's lead, roughly round, run into the joint. */
  const lead = fireRandom(70);
  const blob: [number, number][] = [];
  for (let k = 0; k < 14; k += 1) {
    const t = (k / 14) * Math.PI * 2;
    const r = 17 * s * (0.82 + lead() * 0.3);
    blob.push([staple[0] + Math.cos(t) * r, staple[1] - 4 * s + Math.sin(t) * r * 0.9]);
  }
  ctx.fillStyle = palette['stone-3'];
  ctx.fill(polygon(blob));
  ctx.strokeStyle = palette['stone-4'];
  ctx.lineWidth = 1.2;
  ctx.stroke(polygon(blob));
  const u = new Path2D(`M${staple[0] - 8 * s} ${staple[1] - 4 * s}v${8 * s}a${8 * s} ${8 * s} 0 0 0 ${16 * s} 0v${-8 * s}`);
  for (const [colour, width] of [[palette['iron-4'], 7.4], [palette['torch-iron'], 5.4]] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width * s;
    ctx.lineCap = 'round';
    ctx.stroke(u);
  }
  line(ctx, [[staple[0] - 8 * s, staple[1] - 2 * s], [staple[0] - 8 * s, staple[1] + 4 * s]], palette['iron-1'], 1.8 * s);

  /* The hasp: a strap riveted to the board, a ring at its end. */
  const plate = rounded(hasp[0] - 5 * s, hasp[1] - 20 * s, 10 * s, 24 * s, 2 * s);
  ctx.fillStyle = withAlpha(palette.umbra, 0.55);
  ctx.save();
  ctx.translate(s, 1.5 * s);
  ctx.fill(plate);
  ctx.restore();
  ctx.fillStyle = vertical(ctx, hasp[1] - 20 * s, hasp[1] + 4 * s, [[0, palette['iron-1']], [0.1, palette['torch-iron']], [0.35, palette['torch-iron-dark']], [1, palette['iron-4']]]);
  ctx.fill(plate);
  for (const dy of [-15, -3]) {
    ctx.fillStyle = palette['torch-iron-dark'];
    ctx.beginPath();
    ctx.arc(hasp[0], hasp[1] + dy * s, 1.9 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette['iron-1'];
    ctx.beginPath();
    ctx.arc(hasp[0] - 0.5 * s, hasp[1] + (dy - 0.6) * s, 0.8 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ring(ctx, hasp[0], hasp[1] + 8 * s, 5 * s, 3 * s, palette);

  /* The chain, from the hasp's ring to the staple's crown. */
  const from: [number, number] = [hasp[0], hasp[1] + 12 * s];
  const to: [number, number] = [staple[0], staple[1] + 12 * s];
  const d = Math.max(2.6, 5.4 * s);
  const { links, pitch } = chainLinks(catenary(from, to, 1.12), d);
  const lc = pitch + d;
  const r = (2.35 * d) / 2;
  const lo = pitch + 2 * d;
  const t = 1.25 * d;
  const stadium = (): Path2D => {
    const p = new Path2D();
    p.moveTo(-lc / 2 + r, -r);
    p.lineTo(lc / 2 - r, -r);
    p.arc(lc / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2);
    p.lineTo(-lc / 2 + r, r);
    p.arc(-lc / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5);
    p.closePath();
    return p;
  };
  const face = stadium();
  const bar = rounded(-lo / 2, -t / 2, lo, t, t / 2);
  const each = (draw: (face: boolean) => void): void => {
    for (const link of links) {
      ctx.save();
      ctx.translate(link.x, link.y);
      ctx.rotate(link.angle);
      draw(link.face);
      ctx.restore();
    }
  };
  /* Its shadow on the wall, soft and a little below. */
  ctx.save();
  ctx.shadowColor = withAlpha(palette.umbra, 0.45);
  ctx.shadowBlur = 3 * s;
  ctx.shadowOffsetY = 7 * s;
  each((isFace) => {
    if (isFace) {
      ctx.strokeStyle = withAlpha(palette.umbra, 0.01);
      ctx.lineWidth = d + 1;
      ctx.stroke(face);
    } else {
      ctx.fillStyle = withAlpha(palette.umbra, 0.01);
      ctx.fill(bar);
    }
  });
  ctx.restore();
  each((isFace) => {
    if (isFace) {
      ctx.strokeStyle = palette['iron-4'];
      ctx.lineWidth = d + 2.2;
      ctx.stroke(face);
      ctx.strokeStyle = palette['torch-iron'];
      ctx.lineWidth = d;
      ctx.stroke(face);
      line(ctx, [[-lc / 2 + r, -(r + d * 0.12)], [lc / 2 - r, -(r + d * 0.12)]], palette['iron-1'], d * 0.34);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(side * (lc / 2 - r), 0, r, side < 0 ? Math.PI : -Math.PI / 2, side < 0 ? Math.PI * 1.5 : 0);
        ctx.strokeStyle = withAlpha(palette.lamp, 0.8 * restingLight);
        ctx.lineWidth = d * 0.3;
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = vertical(ctx, -t / 2, t / 2, [[0, palette['iron-1']], [0.1, palette['torch-iron']], [0.35, palette['torch-iron-dark']], [1, palette['iron-4']]]);
      ctx.fill(bar);
      ctx.strokeStyle = palette['iron-4'];
      ctx.lineWidth = 1.3;
      ctx.stroke(bar);
      line(ctx, [[-lo / 2 + t / 2, -(t / 2 - d * 0.3)], [lo / 2 - t / 2, -(t / 2 - d * 0.3)]], palette['iron-1'], d * 0.3);
    }
  });
  ring(ctx, staple[0], staple[1] + 12 * s - 4 * s, 4 * s, 3 * s, palette);
}

function ring(ctx: Ctx, x: number, y: number, r: number, w: number, palette: TomePalette): void {
  for (const [colour, width] of [[palette['iron-4'], w + 2], [palette['torch-iron'], w]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI * 1.1, Math.PI * 1.6);
  ctx.strokeStyle = palette['iron-1'];
  ctx.lineWidth = w * 0.35;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI * 1.65, Math.PI * 1.95);
  ctx.strokeStyle = withAlpha(palette.lamp, 0.8 * restingLight);
  ctx.lineWidth = w * 0.42;
  ctx.stroke();
}
