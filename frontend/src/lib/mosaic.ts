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
 * so the node suite executes it. */

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
