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
 * drawing's slot takes the same tile. */

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
