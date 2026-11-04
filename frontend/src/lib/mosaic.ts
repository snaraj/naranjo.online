/* The gallery's mosaic (owner, 2026-11-02, issue #399, mock 06: "Implement
 * 06, and let's combine videos and drawings"). One page of the gallery is up
 * to five tiles in two sizes, a square and a wide one, and which tile takes
 * which size is a fixed pattern for each count rather than a choice about the
 * picture: the pattern is what guarantees every row is filled to its edge,
 * with no hole on either width.
 *
 * In a grid of SIX columns (the reading width) a square spans two columns by
 * two rows, a wide tile three by two, a full tile all six by two. In a grid of
 * TWO (a phone) a square is one cell, and wide and full both span the row.
 * tests/mosaic.test.mjs lays every pattern into that grid and proves it. Pure,
 * so the node suite executes it.
 *
 * WHICH ITEM TAKES WHICH PLACE is chance, once per visit (owner, 2026-11-04,
 * issue #405: "this is fine, just make it random"): the gallery lays a
 * shuffled copy of its items, so the manifest's own order means nothing to
 * the mosaic, and the pattern above stays by position — a film in a
 * drawing's slot takes the same tile.
 *
 * AND A TILE THAT WOULD LOSE ITS PICTURE SHOWS IT ANOTHER WAY (owner,
 * 2026-11-04, on the 0.1.104 preview: "some of the drawings can be put
 * longways and not just all be squares, if the drawing is lost you can
 * represent it in a different way"). A drawing may take a wide tile, but where
 * covering that tile would crop it too far, the tile contains the whole
 * drawing over an ambient fill made from the drawing itself (thumbFit). */

export type MosaicShape = 'sq' | 'wd' | 'full';

/* The patterns, by how many tiles the page holds. */
const reading: readonly (readonly MosaicShape[])[] = [
  [],
  ['full'],
  ['wd', 'wd'],
  ['sq', 'sq', 'sq'],
  ['wd', 'wd', 'wd', 'wd'],
  ['sq', 'sq', 'sq', 'wd', 'wd']
];

const phone: readonly (readonly MosaicShape[])[] = [
  [],
  ['wd'],
  ['sq', 'sq'],
  ['sq', 'sq', 'wd'],
  ['sq', 'sq', 'sq', 'sq'],
  ['sq', 'sq', 'wd', 'sq', 'sq']
];

/* The shapes one page of `count` tiles takes in a grid of `columns`. A page
 * holds at most five; a larger count is a caller asking for something no
 * pattern here fills, and it throws rather than leaving a hole. */
export function mosaicShapes(count: number, columns: 6 | 2): readonly MosaicShape[] {
  const patterns = columns === 6 ? reading : phone;
  const shapes = Number.isInteger(count) ? patterns[count] : undefined;
  if (shapes === undefined) {
    throw new RangeError(`no mosaic pattern for ${count} tiles`);
  }
  return shapes;
}

/* A Fisher–Yates shuffle over a COPY: the input is never touched, and every
 * order of n items is reached by exactly one sequence of n − 1 draws, so no
 * order is likelier than another. The random source is a parameter rather
 * than Math.random read here, because the claim is proved with a FIXED source
 * (tests/mosaic.test.mjs): a fixed order for a fixed source, a permutation for
 * every source, every order reachable. The gallery hands it Math.random. A
 * draw outside [0, 1) is a broken source, and it throws rather than dropping
 * or doubling an item. */
export function shuffled<T>(items: readonly T[], random: () => number): readonly T[] {
  const order = items.slice();
  for (let last = order.length - 1; last > 0; last -= 1) {
    const draw = random();
    if (!(draw >= 0 && draw < 1)) {
      throw new RangeError(`a random source drew ${draw}, outside [0, 1)`);
    }
    const pick = Math.floor(draw * (last + 1));
    [order[last], order[pick]] = [order[pick], order[last]];
  }
  return order;
}

/* THE SHAPE A TILE IS LAID AS, width over height, on the grid
 * MediaGallery.svelte lays: six columns, where a square spans two by two
 * cells, a wide tile three by two and a full tile six by two; two columns,
 * where a square is one cell and wide and full both span the row of one. On
 * SQUARE cells, gaps aside, that is the spans' ratio, and tests/mosaic.test.mjs
 * reads the spans out of the component's sheet, so a span changed there
 * without this table, or this table without the sheet, fails the suite.
 *
 * The cells are square only where a row's token is at least a cell's width.
 * Where the reading column is wider, the cells widen and the rows do not, so a
 * tile is wider than this table says. MEASURED in Chromium: square cells at
 * 320 to 412px and at 721 to 1100px, but at 1280px the square is 1.1:1, at
 * 1440px 1.27:1 with the wide tile 1.91:1, at 1920px 1.58 and 2.38, and at
 * 720px (two columns) 1.83 and 3.7. So the gallery measures each tile and
 * hands thumbFit the shape the engine laid. This table is only the shape a
 * tile is laid as before it has a box to measure. */
const aspects: Readonly<Record<6 | 2, Readonly<Record<MosaicShape, number>>>> = {
  6: { sq: 1, wd: 1.5, full: 3 },
  2: { sq: 1, wd: 2, full: 2 }
};

export function tileAspect(shape: MosaicShape, columns: 6 | 2): number {
  return aspects[columns][shape];
}

/* How much of a picture a tile may crop before the tile shows it whole: a
 * QUARTER on either axis. A cover fit of a picture of aspect p into a tile of
 * aspect t keeps min(p, t) / max(p, t) of it on the cropped axis, so it loses
 * 1 − that. A quarter keeps a 1.28:1 drawing covering a square (22% lost),
 * and it contains a 1:1 drawing in a 3:2 wide tile (33% lost) and in a
 * phone's 2:1 one (half). At 1440px, where the 0.1.104 preview read as cut,
 * the wide tile is 1.91:1, so a 1:1 drawing would lose 48% there and the
 * 1.28:1 one 33%: both are contained. */
export const thumbCropLimit = 0.25;

export type ThumbFit = 'cover' | 'contain';

/* COVER, or CONTAIN over the ambient fill, for a picture of the declared
 * width and height in a tile of aspect `tile`. A still that would lose more
 * than thumbCropLimit to a cover is contained; everything else covers. A FILM
 * ALWAYS COVERS: its tile shows a still of it, a gameplay frame crops well,
 * and the owner did not object to it. A picture or a tile whose size is
 * unknown, zero or not finite covers too, because a fit chosen from a size
 * nobody declared is a guess. */
export function thumbFit(
  kind: 'image' | 'video',
  width: number | undefined,
  height: number | undefined,
  tile: number
): ThumbFit {
  if (kind !== 'image' || width === undefined || height === undefined) return 'cover';
  if (![width, height, tile].every((value) => Number.isFinite(value) && value > 0)) return 'cover';
  const picture = width / height;
  const lost = 1 - Math.min(picture, tile) / Math.max(picture, tile);
  return lost > thumbCropLimit ? 'contain' : 'cover';
}
