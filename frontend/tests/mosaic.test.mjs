/* The gallery's mosaic (owner, 2026-11-02, issue 399, mock 06). The claim is
 * that every page of one to five tiles fills its rows to the edge, with no
 * hole, at the reading width and on a phone. It is proved by laying each
 * pattern into a simulated grid exactly as CSS grid's auto-placement does —
 * row-major, every item at the first place it fits — with the spans
 * MediaGallery.svelte gives each shape, and checking every cell of every row
 * the page uses is taken. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mosaicShapes, shuffled } from '../src/lib/mosaic.ts';

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

/* THE ORDER IS CHANCE, ONCE PER VISIT (owner, 2026-11-04, issue #405: "this
 * is fine, just make it random"). The gallery lays a shuffled copy of its
 * items; the shuffle takes its random source as a parameter, so these prove it
 * with fixed ones. A source is a list of draws, read in turn and refused if
 * the shuffle asks for more than it holds. */
const drawing = (draws) => {
  let at = 0;
  return () => {
    assert.ok(at < draws.length, `the shuffle drew ${at + 1} times from a source of ${draws.length}`);
    return draws[at++];
  };
};
const constant = (value) => () => value;
const letters = Object.freeze(['a', 'b', 'c', 'd', 'e']);

test('a fixed source gives a fixed order', () => {
  // Fisher–Yates from the last place down: each draw picks, from the places
  // not yet settled, the item that settles the last of them.
  assert.deepEqual(shuffled(letters, drawing([0.5, 0.25, 0.75, 0.1])), ['d', 'a', 'e', 'b', 'c']);
  // Zero always picks the first unsettled place, so every item moves...
  assert.deepEqual(shuffled(letters, constant(0)), ['b', 'c', 'd', 'e', 'a']);
  // ...and a draw just under one always picks the place being settled, so
  // nothing does — which is also the proof that no draw reaches past the end.
  assert.deepEqual(shuffled(letters, constant(1 - Number.EPSILON)), ['a', 'b', 'c', 'd', 'e']);
  // The same source twice is the same order twice.
  assert.deepEqual(shuffled(letters, drawing([0.9, 0.3, 0.6, 0.2])), shuffled(letters, drawing([0.9, 0.3, 0.6, 0.2])));
});

test('every source gives a permutation: the same members, once each, nothing lost and nothing doubled', () => {
  const items = Object.freeze(Array.from({ length: 9 }, (_, index) => ({ key: `item-${index}` })));
  const sources = [constant(0), constant(1 - Number.EPSILON), constant(0.5)];
  // And a spread of deterministic sources over the whole interval.
  for (let seed = 1; seed <= 200; seed += 1) {
    let state = seed;
    sources.push(() => {
      state = (state * 48271) % 2147483647;
      return (state - 1) / 2147483646;
    });
  }
  for (const [index, source] of sources.entries()) {
    const order = shuffled(items, source);
    assert.equal(order.length, items.length, `source ${index} changed the count`);
    assert.equal(new Set(order).size, items.length, `source ${index} doubled an item`);
    for (const item of items) {
      assert.ok(order.includes(item), `source ${index} lost ${item.key}`);
    }
  }
});

test('every order is reached, each by exactly one sequence of draws', () => {
  /* Four items, and every sequence of picks the shuffle can make: four places
     for the last, three for the next, two for the one after. Twenty-four
     sequences and twenty-four orders, so each order is one sequence's and no
     order is likelier than another — the property a shuffle that picks from
     every place at every step (the familiar bias) does not have. */
  const four = ['a', 'b', 'c', 'd'];
  const seen = new Map();
  for (let first = 0; first < 4; first += 1) {
    for (let second = 0; second < 3; second += 1) {
      for (let third = 0; third < 2; third += 1) {
        const source = drawing([(first + 0.5) / 4, (second + 0.5) / 3, (third + 0.5) / 2]);
        const order = shuffled(four, source).join('');
        seen.set(order, (seen.get(order) ?? 0) + 1);
      }
    }
  }
  assert.equal(seen.size, 24, `the shuffle reaches ${seen.size} of the 24 orders of four`);
  assert.ok([...seen.values()].every((count) => count === 1), 'an order is reached by more than one sequence');
});

test('the shuffle never touches its input', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'];
  const before = items.slice();
  const order = shuffled(items, constant(0));
  assert.deepEqual(items, before, 'the input was reordered');
  assert.notEqual(order, items, 'the shuffle handed back its input rather than a copy');
  // A frozen input is the stricter half: a write to it throws in a module.
  assert.doesNotThrow(() => shuffled(letters, constant(0)));
});

test('an empty list and a list of one come back as they went in, drawing nothing', () => {
  const never = () => assert.fail('the shuffle drew for a list with nothing to reorder');
  assert.deepEqual(shuffled([], never), []);
  assert.deepEqual(shuffled(['only'], never), ['only']);
});

test('a source that draws outside [0, 1) is refused rather than losing an item', () => {
  for (const draw of [1, -0.1, 2, Number.NaN]) {
    assert.throws(() => shuffled(letters, constant(draw)), RangeError, `a draw of ${draw} was used`);
  }
});
