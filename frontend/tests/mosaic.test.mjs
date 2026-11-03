/* The gallery's mosaic (owner, 2026-11-02, issue 399, mock 06). The claim is
 * that every page of one to five tiles fills its rows to the edge, with no
 * hole, at the reading width and on a phone. It is proved by laying each
 * pattern into a simulated grid exactly as CSS grid's auto-placement does —
 * row-major, every item at the first place it fits — with the spans
 * MediaGallery.svelte gives each shape, and checking every cell of every row
 * the page uses is taken. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mosaicShapes } from '../src/lib/mosaic.ts';

/* The spans the component gives each shape, by the grid's column count. */
const spans = {
  6: { sq: [2, 2], wd: [3, 2], full: [6, 2] },
  2: { sq: [1, 1], wd: [2, 1], full: [2, 1] }
};

/* Auto-placement, sparse: a cursor walks the grid row by row, and an item goes
 * at the first position at or after the cursor where its whole span is free. */
function layOut(shapes, columns) {
  const taken = [];
  const free = (row, column, width, height) => {
    for (let r = row; r < row + height; r += 1) {
      for (let c = column; c < column + width; c += 1) {
        if (c >= columns || taken[r]?.[c]) return false;
      }
    }
    return true;
  };
  let cursor = 0;
  for (const shape of shapes) {
    const [width, height] = spans[columns][shape];
    let at = cursor;
    while (!free(Math.floor(at / columns), at % columns, width, height)) at += 1;
    const row = Math.floor(at / columns);
    for (let r = row; r < row + height; r += 1) {
      taken[r] ??= Array(columns).fill(false);
      for (let c = at % columns; c < (at % columns) + width; c += 1) taken[r][c] = true;
    }
    cursor = at + width;
  }
  return taken;
}

test('every page of one to five tiles fills its rows with no hole, on both grids', () => {
  for (const columns of [6, 2]) {
    for (let count = 1; count <= 5; count += 1) {
      const shapes = mosaicShapes(count, columns);
      assert.equal(shapes.length, count, `${count} tiles on ${columns} columns take ${shapes.length} shapes`);
      const grid = layOut(shapes, columns);
      for (const [row, cells] of grid.entries()) {
        assert.ok(cells.every(Boolean), `${count} tiles on ${columns} columns leave a hole in row ${row}: ${shapes.join(', ')}`);
      }
    }
  }
});

test('a full page is four rows at the reading width and three on a phone — the reserve the grid holds', () => {
  assert.equal(layOut(mosaicShapes(5, 6), 6).length, 4);
  assert.equal(layOut(mosaicShapes(5, 2), 2).length, 3);
  // No page is taller than the full one, so the reserve holds every page.
  for (let count = 1; count <= 5; count += 1) {
    assert.ok(layOut(mosaicShapes(count, 6), 6).length <= 4);
    assert.ok(layOut(mosaicShapes(count, 2), 2).length <= 3);
  }
});

test('the patterns are the ones the mock drew', () => {
  assert.deepEqual(mosaicShapes(5, 6), ['sq', 'sq', 'sq', 'wd', 'wd']);
  assert.deepEqual(mosaicShapes(4, 6), ['wd', 'wd', 'wd', 'wd']);
  assert.deepEqual(mosaicShapes(3, 6), ['sq', 'sq', 'sq']);
  assert.deepEqual(mosaicShapes(2, 6), ['wd', 'wd']);
  assert.deepEqual(mosaicShapes(1, 6), ['full']);
  assert.deepEqual(mosaicShapes(5, 2), ['sq', 'sq', 'wd', 'sq', 'sq']);
  assert.deepEqual(mosaicShapes(4, 2), ['sq', 'sq', 'sq', 'sq']);
  assert.deepEqual(mosaicShapes(3, 2), ['sq', 'sq', 'wd']);
  assert.deepEqual(mosaicShapes(2, 2), ['sq', 'sq']);
  assert.deepEqual(mosaicShapes(1, 2), ['wd']);
});

test('no tiles take no shapes, and a count no pattern fills is refused rather than holed', () => {
  assert.deepEqual(mosaicShapes(0, 6), []);
  assert.deepEqual(mosaicShapes(0, 2), []);
  for (const count of [6, 7, -1, 2.5, Number.NaN]) {
    assert.throws(() => mosaicShapes(count, 6), RangeError, `${count} tiles were given a pattern`);
  }
});
