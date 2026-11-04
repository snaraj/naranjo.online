/* The gallery's mosaic (owner, 2026-11-02, issue 399, mock 06), laid as
 * JUSTIFIED ROWS (owner, 2026-11-04: "prefer only the last row to be uneven,
 * I don't want gaps on every row, ideally it would be all cohesive until the
 * last one"). Three claims are executed here rather than read: a page is cut
 * into full rows and one last row of what is left; a tile's share of its row
 * is its picture's declared proportions, falling back exactly as its thumb's
 * attributes do; and the component's own stylesheet — its tile share and its
 * last-row width, read out of MediaGallery.svelte and evaluated — gives every
 * row one height that fills its width, and the last row the previous row's
 * height wherever that fits the width. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { declaredAspect, rowCounts, shuffled } from '../src/lib/mosaic.ts';

test('a page is cut into full rows and one last row of what is left, three at the reading width and two on a phone', () => {
  for (const perRow of [3, 2]) {
    for (let count = 0; count <= 5; count += 1) {
      const rows = rowCounts(count, perRow);
      const named = `${count} tiles ${perRow} to a row (${rows.join(', ')})`;
      assert.equal(rows.reduce((sum, row) => sum + row, 0), count, `${named} do not lay every tile once`);
      assert.ok(rows.every((row) => row >= 1 && row <= perRow), `${named} hold a row of none or of more than ${perRow}`);
      assert.ok(rows.slice(0, -1).every((row) => row === perRow), `${named} leave a row short before the last`);
    }
  }
  assert.deepEqual(rowCounts(5, 3), [3, 2]);
  assert.deepEqual(rowCounts(4, 3), [3, 1]);
  assert.deepEqual(rowCounts(3, 3), [3]);
  assert.deepEqual(rowCounts(2, 3), [2]);
  assert.deepEqual(rowCounts(1, 3), [1]);
  assert.deepEqual(rowCounts(5, 2), [2, 2, 1]);
  assert.deepEqual(rowCounts(4, 2), [2, 2]);
  assert.deepEqual(rowCounts(3, 2), [2, 1]);
  assert.deepEqual(rowCounts(2, 2), [2]);
  assert.deepEqual(rowCounts(1, 2), [1]);
  assert.deepEqual(rowCounts(0, 3), []);
  assert.deepEqual(rowCounts(0, 2), []);
});

test('a count or a row no rows can lay is refused rather than laid in part', () => {
  for (const [count, perRow] of [[-1, 3], [2.5, 3], [Number.NaN, 3], [5, 0], [5, 1.5], [5, Number.NaN], [5, -2]]) {
    assert.throws(() => rowCounts(count, perRow), RangeError, `${count} tiles ${perRow} to a row were laid`);
  }
});

test('a tile’s share of its row is its picture’s declared proportions, the gallery’s box filling whichever side the item leaves out', () => {
  // The item's own box where it states one: the live set's 1.28:1 drawing.
  assert.equal(declaredAspect({ width: 3840, height: 2996 }, 3840, 2160), 3840 / 2996);
  // The gallery's where it states none: the vendored set's 16:9.
  assert.equal(declaredAspect({}, 3840, 2160), 3840 / 2160);
  // Side by side, as the thumb's `width={tile.width ?? width}` and
  // `height={tile.height ?? height}` fall back, so the share and the box the
  // thumb declares are one ratio whatever the item leaves out.
  assert.equal(declaredAspect({ width: 1000 }, 3840, 2160), 1000 / 2160);
  assert.equal(declaredAspect({ height: 1000 }, 3840, 2160), 3840 / 1000);
});

/* THE STYLESHEET, EXECUTED. The rule bodies are read out of the component
 * and evaluated with its custom properties and percentages put in, so these
 * prove what the engine is handed rather than a restatement of it. Only
 * numbers, arithmetic and min() may remain once those are in, and anything
 * else is refused before it is evaluated. */
const gallerySource = readFileSync(new URL('../src/lib/components/MediaGallery.svelte', import.meta.url), 'utf8');
const gallerySheet = (/<style>([\s\S]*?)<\/style>/.exec(gallerySource)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
const declaration = (selector, property) => {
  const body = new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(gallerySheet)?.[1];
  assert.ok(body, `MediaGallery.svelte has no ${selector} rule`);
  const value = new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]*);`).exec(body)?.[1];
  assert.ok(value, `${selector} declares no ${property}`);
  return value.replace(/\s+/g, ' ').trim();
};
function evaluate(expression, { percent, ...properties }) {
  const arithmetic = expression
    .replace(/var\((--[a-z-]+)\)/g, (_, name) => {
      assert.ok(name in properties, `the rule reads ${name}, which this evaluation does not supply`);
      return `(${properties[name]})`;
    })
    .replace(/(\d+(?:\.\d+)?)%/g, (_, value) => {
      assert.ok(percent !== undefined, 'the rule reads a percentage where none is defined');
      return `(${(Number(value) / 100) * percent})`;
    })
    .replace(/\bcalc\(/g, '(')
    .replace(/\bmin\(/g, 'Math.min(');
  assert.match(arithmetic.replace(/Math\.min/g, ''), /^[\d.eE\s+\-*/(),]*$/, `the rule is more than arithmetic and min(): ${expression}`);
  return Function(`"use strict"; return (${arithmetic});`)();
}
const tileGrowth = () => {
  const [, grow, shrink, basis] = /^(.+) (\S+) (\S+)$/.exec(declaration('.gallery-tile', 'flex')) ?? [];
  assert.equal(shrink, '1');
  assert.equal(basis, '0%', 'a tile no longer grows from nothing, so its width is not its share alone');
  return grow;
};
const lastRowWidth = declaration('.gallery-row:last-child:not(:first-child)', 'inline-size');

/* Aspect sets drawn from the live set's shapes (1:1, 1.28:1, 0.86:1, 1:2,
   2:1, 16:9), rows of three over two and of two over one, at grid widths a
   phone and the reading column lay and the mosaic's 6px gap. */
const aspectRows = [
  [[2, 16 / 9, 16 / 9], [0.5, 3288 / 3840]],
  [[1, 3288 / 3840, 0.5], [3840 / 2996, 2]],
  [[16 / 9, 16 / 9, 16 / 9], [16 / 9, 16 / 9]],
  [[1, 1, 1], [1]],
  [[2, 16 / 9], [3288 / 3840]],
  [[0.5, 3840 / 2996], [2]],
  [[0.5, 0.5], [0.5]],
  [[16 / 9, 2], [16 / 9]]
];
const gridWidths = [224, 290.90625, 1128, 1496];
const gap = 6;
const sum = (aspects) => aspects.reduce((total, aspect) => total + aspect, 0);

test('every tile grows by its share of its row, so a row is one height and fills its width exactly', () => {
  const grow = tileGrowth();
  for (const [first, second] of aspectRows) {
    for (const row of [first, second]) {
      const shares = row.map((aspect) => evaluate(grow, { '--tile-aspect': aspect, '--row-aspect': sum(row) }));
      /* The shares hand out the whole row: growth factors summing under one
         hand out only that fraction of the free space, which is how a lone
         portrait came to be narrower than its row. */
      assert.ok(Math.abs(sum(shares) - 1) < 1e-12, `a row of ${row.map((a) => a.toFixed(3)).join(', ')} grows by ${sum(shares)}, not the whole row`);
      for (const width of gridWidths) {
        const free = width - (row.length - 1) * gap;
        const heights = row.map((aspect, index) => (free * shares[index]) / aspect);
        for (const tileHeight of heights) {
          assert.ok(Math.abs(tileHeight - free / sum(row)) < 1e-9, `a row of ${row.length} at ${width}px is not one height: ${heights.join(', ')}`);
        }
      }
    }
  }
});

test('the last row is laid at the previous row’s height wherever that fits the width, and is justified to the width where it would not', () => {
  let fitted = 0;
  let clamped = 0;
  for (const [previous, last] of aspectRows) {
    for (const width of gridWidths) {
      const laid = evaluate(lastRowWidth, {
        percent: width,
        '--gallery-mosaic-gap': gap,
        '--row-prev-count': previous.length,
        '--row-count': last.length,
        '--row-aspect-ratio': sum(last) / sum(previous)
      });
      const previousHeight = (width - (previous.length - 1) * gap) / sum(previous);
      const lastHeight = (laid - (last.length - 1) * gap) / sum(last);
      const named = `a last row of ${last.map((a) => a.toFixed(3)).join(', ')} under ${previous.map((a) => a.toFixed(3)).join(', ')} at ${width}px`;
      assert.ok(laid <= width + 1e-9, `${named} is ${laid}px wide, past the grid`);
      if (laid < width - 1e-9) {
        fitted += 1;
        assert.ok(Math.abs(lastHeight - previousHeight) < 1e-9, `${named} is ${lastHeight}px tall against the previous row's ${previousHeight}px`);
      } else {
        /* Wider than the grid at the previous row's height, so min() lays it
           at the full width — justified, like the rows before it — where it
           is the shorter of the two rather than running past the edge. */
        clamped += 1;
        assert.ok(Math.abs(laid - width) < 1e-9, `${named} is ${laid}px wide, not the grid's ${width}px`);
        assert.ok(lastHeight <= previousHeight + 1e-9, `${named} at the full width is taller than the previous row`);
      }
    }
  }
  // Both branches are reached, so neither is proved by never being taken.
  assert.ok(fitted > 0 && clamped > 0, `the sets reach ${fitted} fitted and ${clamped} clamped last rows`);
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
