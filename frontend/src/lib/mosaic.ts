/* The gallery's mosaic (owner, 2026-11-02, issue 399, mock 06: "Implement
 * 06, and let's combine videos and drawings"), laid as JUSTIFIED ROWS (owner,
 * 2026-11-04, on the 0.1.104 preview: "prefer only the last row to be uneven,
 * I don't want gaps on every row, ideally it would be all cohesive until the
 * last one").
 *
 * A page of up to five tiles is cut into rows of a fixed count — three at the
 * reading width, two on a phone — and in every row the tiles share one height
 * and fill the width exactly, each as wide as its picture's proportions make
 * it at that height, so nothing is cropped and nothing is padded. The last row
 * of a page of two rows or more keeps the previous row's height and leaves its
 * end open. MediaGallery.svelte does the laying, with flex growth proportional
 * to each picture's declared proportions; what is decided here is how many
 * tiles each row holds and what those proportions are, both pure so the node
 * suite executes them (tests/mosaic.test.mjs, which also evaluates the
 * component's last-row width against the previous row's height).
 *
 * WHICH ITEM TAKES WHICH PLACE is chance, once per visit (owner, 2026-11-04,
 * issue #405: "this is fine, just make it random"): the gallery lays a
 * shuffled copy of its items, kept for the visit when a new list of them
 * arrives (keptOrder), so the manifest's own order means nothing to the
 * mosaic. */

/* How many tiles each row of a page of `count` holds, in a grid of `perRow`
 * a row: every row full but the last, which holds what is left. A count that
 * is not a whole number of tiles, or a row that holds none, is a caller
 * asking for something no row can lay, and it throws rather than laying a
 * partial page. */
export function rowCounts(count: number, perRow: number): readonly number[] {
  if (!Number.isInteger(count) || count < 0 || !Number.isInteger(perRow) || perRow < 1) {
    throw new RangeError(`no rows lay ${count} tiles ${perRow} to a row`);
  }
  const counts: number[] = [];
  for (let left = count; left > 0; left -= perRow) {
    counts.push(Math.min(perRow, left));
  }
  return counts;
}

/* A tile's share of its row: its picture's declared proportions, width over
 * height — the item's own box where it states one and the gallery's where it
 * does not, side by side, exactly as the thumb's width and height attributes
 * fall back. So the share the row gives a tile and the box its thumb declares
 * are one ratio, and the tile is as tall as its row before a byte arrives. */
export function declaredAspect(
  item: { readonly width?: number; readonly height?: number },
  width: number,
  height: number
): number {
  return (item.width ?? width) / (item.height ?? height);
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

/* THE VISIT KEEPS ITS ORDER when a new list of items reaches it. The Media
 * block shows the vendored set at once and replaces it when the published
 * manifest answers (Block.svelte), and a reader can be on the second page, or
 * have the stage open, by then. So the visit's order is not drawn again for
 * each list: an item the visit has already laid keeps its place among the
 * others, found by its key and carried as the NEW list's item; an item the
 * new list drops leaves; and the items the visit has not laid yet are drawn
 * among themselves by the same shuffle and go after the rest. Nothing a
 * reader is looking at moves for a list of the same items, which draws
 * nothing at all.
 * A visit's first list is all new, so it is drawn whole, draw for draw the
 * shuffle above; so is a list that shares no key with the order before it,
 * as the published set shares none with the vendored one, which keeps the
 * published set random rather than in the manifest's own order. Keys are
 * unique within a list: the manifest refuses a repeat and the vendored keys
 * are file names. */
export function keptOrder<T extends { readonly key: string }>(
  visit: readonly T[],
  items: readonly T[],
  random: () => number
): readonly T[] {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const kept = visit.flatMap((laid) => byKey.get(laid.key) ?? []);
  const known = new Set(visit.map((laid) => laid.key));
  return [...kept, ...shuffled(items.filter((item) => !known.has(item.key)), random)];
}
