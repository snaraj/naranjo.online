/* THE CHAINED TOME (owner, 2026-10-20: T3, "the corbel", of the tome's five
 * settings). The accounts are leaves of one illuminated tome lying open on a
 * lectern built out from the wall on a stepped stone corbel, a dagged madder
 * cloth hanging from its desk and a heavy chain run from the tome's corner to
 * a staple leaded into the masonry.
 *
 * This module is the pure half: the order of the leaves, and the drawing's
 * geometry in the base's own units — the corbel's courses, the cloth's hem,
 * the chain's hang and its links. Tome.svelte draws them once per size on
 * canvases: WebKit without a GPU pays for a canvas as one picture, where the
 * same drawing in SVG paint costs it every shape on every repaint. Pure, so
 * the node suite executes it. */

import type { ChronicleAccount } from './blocks.ts';
import { fireRandom } from './fire.ts';

export type TomeLeaf = { readonly kind: 'totals' | 'models'; readonly account: ChronicleAccount };

/* THE LEAVES: every account's totals, then every account's models, so the tome
 * opens on the accounts side by side (they read row for row) and its next
 * opening is their models. A narrow screen turns the same leaves one page at
 * a time. */
export function tomeLeaves(accounts: readonly ChronicleAccount[]): TomeLeaf[] {
  return [
    ...accounts.map((account) => ({ kind: 'totals' as const, account })),
    ...accounts.map((account) => ({ kind: 'models' as const, account }))
  ];
}

/* How many openings a reader turns through: two pages at a time, or one. */
export function tomeOpenings(leaves: number, single: boolean): number {
  return Math.max(1, single ? leaves : Math.ceil(leaves / 2));
}

/* The leaves an opening shows: two by two, or one by one. */
export function openingLeaves(opening: number, single: boolean): number[] {
  return single ? [opening] : [opening * 2, opening * 2 + 1];
}

/* The base is drawn in units in which the open tome is this wide, so it
 * scales with the tome and its stone and iron keep their proportions. */
export const baseBook = { spread: 800, single: 520 } as const;

export type Course = { readonly top: number; readonly bottom: number; readonly half: number };

export type ClothSpec = {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly flare: number;
  readonly amp: number;
  readonly fringe: number;
  readonly pitch: number;
  readonly seed: number;
  readonly dags: number;
  readonly dagDepth: number;
};

export type Corbel = {
  readonly width: number;
  readonly height: number;
  readonly centre: number;
  readonly courses: readonly Course[];
  readonly tail: Course;
  readonly desk: { readonly x0: number; readonly x1: number; readonly top: number; readonly height: number };
  readonly lip: { readonly x0: number; readonly x1: number; readonly top: number; readonly height: number };
  readonly cloth: ClothSpec;
  /* Where the staple is driven, right of the corbel in the same units. */
  readonly staple: readonly [number, number];
};

/* THE CORBEL: a lectern's desk on a corbel of five courses, each stepping in
 * from the one above, ending in a rounded tail, all in the base's units for a
 * tome `book` wide, its lip overhanging the tome by 20 on either side. The
 * steps keep their proportions at any width, so a phone's corbel narrows
 * course by course like a wide one. */
export function corbel(book: number): Corbel {
  const width = book + 40;
  const centre = width / 2;
  const widest = Math.max(80, Math.min(300, width / 2 - 70));
  const steps = [1, 0.833, 0.667, 0.507, 0.347];
  const rows: readonly [number, number][] = [
    [56, 98],
    [98, 138],
    [138, 178],
    [178, 218],
    [218, 254]
  ];
  const courses = rows.map(([top, bottom], index) => ({ top, bottom, half: widest * steps[index] }));
  const tail = { top: 254, bottom: 302, half: Math.max(30, courses[4].half * 0.62) };
  const cloth: ClothSpec = {
    x0: 58,
    x1: width - 58,
    y0: 14,
    y1: 128,
    flare: 6,
    amp: 3,
    fringe: 11,
    pitch: 82,
    seed: 63,
    dags: 5,
    dagDepth: 24
  };
  return {
    width,
    height: 304,
    centre,
    courses,
    tail,
    desk: { x0: 34, x1: width - 34, top: 14, height: 46 },
    lip: { x0: 8, x1: width - 8, top: -6, height: 22 },
    cloth,
    staple: [width + 92, 96]
  };
}

export type Cloth = {
  readonly left: number;
  readonly right: number;
  readonly hemAt: (x: number) => number;
  /* The hem from right to left, a point every three units. */
  readonly hem: readonly (readonly [number, number])[];
  readonly bottom: number;
  /* Where a tassel hangs: the middle of each dag. */
  readonly tassels: readonly number[];
  /* The ridges of the folds, left to right, and how far each comes forward. */
  readonly ridges: readonly number[];
  readonly depths: readonly number[];
};

/* THE CLOTH: hung straight from y0 between x0 and x1 and falling in folds to
 * a hem near y1, wider by `flare` at the hem. Its ridges hang lower and its
 * valleys draw the hem up, and the hem is cut into `dags`, points between
 * scallops, each with a tassel at its middle. Seeded, so the same cloth hangs
 * on every load. */
export function cloth(spec: ClothSpec): Cloth {
  const random = fireRandom(spec.seed);
  const left = spec.x0 - spec.flare;
  const right = spec.x1 + spec.flare;
  const span = right - left;
  const folds = Math.max(3, Math.round(span / spec.pitch));
  const pitch = span / folds;
  const ridges: number[] = [];
  for (let index = 0; index <= folds; index += 1) {
    ridges.push(left + pitch * index + (index > 0 && index < folds ? (random() - 0.5) * pitch * 0.48 : 0));
  }
  const depths = ridges.map(() => spec.amp * (0.35 + random() * 1.1));
  const hemAt = (x: number): number => {
    let index = 0;
    while (index < folds - 1 && x > ridges[index + 1]) index += 1;
    const a = ridges[index];
    const b = ridges[index + 1];
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    let y = spec.y1 + (depths[index] + (depths[index + 1] - depths[index]) * t) * Math.cos(2 * Math.PI * t);
    const u = ((x - left) / span) * spec.dags;
    const within = u - Math.floor(u);
    y += spec.dagDepth * (1 - Math.abs(2 * within - 1));
    return y;
  };
  const hem: [number, number][] = [];
  for (let x = right; x > left; x -= 3) hem.push([x, hemAt(x)]);
  hem.push([left, hemAt(left)]);
  const tassels = Array.from({ length: spec.dags }, (_, index) => left + (span * (index + 0.5)) / spec.dags);
  return { left, right, hemAt, hem, bottom: Math.max(...hem.map(([, y]) => y)), tassels, ridges, depths };
}

export type Catenary = {
  readonly length: number;
  at(s: number): { readonly x: number; readonly y: number; readonly angle: number };
};

/* A CHAIN HANGS AS A CATENARY. A chain `slack` times as long as the straight
 * line from A to B (screen y down) takes the curve y = a·cosh((x − x0)/a) + c;
 * its parameter is found by bisection from the span and the length, and the
 * curve is walked by arc length so the links fall at an even pitch. */
export function catenary(A: readonly [number, number], B: readonly [number, number], slack: number): Catenary {
  const flip = B[0] < A[0];
  const ax = flip ? -A[0] : A[0];
  const bx = flip ? -B[0] : B[0];
  const h = Math.max(0.5, bx - ax);
  const v = A[1] - B[1];
  const length = Math.hypot(h, v) * slack;
  const need = Math.sqrt(length * length - v * v);
  let lo = 1e-3;
  let hi = 1e7;
  for (let step = 0; step < 120; step += 1) {
    const mid = Math.sqrt(lo * hi);
    if (2 * mid * Math.sinh(h / (2 * mid)) > need) lo = mid;
    else hi = mid;
  }
  const a = Math.sqrt(lo * hi);
  const uA = Math.atanh(Math.min(0.999999, Math.max(-0.999999, v / length))) - h / (2 * a);
  const x0 = ax - a * uA;
  const c = -A[1] - a * Math.cosh(uA);
  const sA = a * Math.sinh(uA);
  return {
    length,
    at(s) {
      const u = Math.asinh((s + sA) / a);
      const x = x0 + a * u;
      const angle = Math.atan2(-Math.sinh(u), 1);
      return { x: flip ? -x : x, y: -(a * Math.cosh(u) + c), angle: flip ? Math.PI - angle : angle };
    }
  };
}

export type ChainLink = { readonly x: number; readonly y: number; readonly angle: number; readonly face: boolean };

/* THE LINKS: alternately face-on (an open ring of round iron) and edge-on (a
 * bar through the next one's eye), laid where the catenary says at a pitch of
 * about three times the iron's thickness `d`, each turned along the curve and
 * then to point rightward, since a link looks the same turned half round. */
export function chainLinks(hang: Catenary, d: number): { links: ChainLink[]; pitch: number } {
  const count = Math.max(3, Math.round(hang.length / (d * 3.1)));
  const pitch = hang.length / count;
  const links: ChainLink[] = [];
  for (let index = 0; index < count; index += 1) {
    const point = hang.at(pitch * (index + 0.5));
    const angle = Math.cos(point.angle) < 0 ? point.angle + Math.PI : point.angle;
    links.push({ x: point.x, y: point.y, angle, face: index % 2 === 0 });
  }
  return { links, pitch };
}
