/* THE CHAINED TOME (owner, 2026-10-20: T3, "the corbel"). Its pure half is
 * pinned here as arithmetic: which leaves an opening shows, so every account
 * is read and none twice; the corbel stepping in course by course at every
 * width; the cloth hanging the same on every load and inside its desk; and
 * the chain hanging as a chain does, from its hasp to its staple, below the
 * straight line between them, its links alternating at an even pitch. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseBook, catenary, chainLinks, cloth, corbel, openingLeaves, tomeLeaves, tomeOpenings } from '../src/lib/tome.ts';

const account = (key) => ({ key, label: key, total: '1', facts: [], lines: [], models: [] });

test('the tome opens on every account side by side, and their models after', () => {
  const accounts = ['a', 'b'].map(account);
  const leaves = tomeLeaves(accounts);
  assert.deepEqual(
    leaves.map((leaf) => `${leaf.kind}:${leaf.account.key}`),
    ['totals:a', 'totals:b', 'models:a', 'models:b']
  );
  assert.equal(leaves[0].account, accounts[0], 'a leaf carries a copy of its account rather than the account');
  assert.deepEqual(tomeLeaves([]), []);
});

test('every leaf is shown by exactly one opening, two pages at a time or one', () => {
  for (const count of [1, 2, 3, 4, 6]) {
    for (const single of [false, true]) {
      const openings = tomeOpenings(count, single);
      assert.equal(openings, single ? count : Math.ceil(count / 2), `${count} leaves, single ${single}`);
      const shown = Array.from({ length: openings }, (_, opening) => openingLeaves(opening, single))
        .flat()
        .filter((leaf) => leaf < count);
      assert.deepEqual(shown, Array.from({ length: count }, (_, leaf) => leaf), `${count} leaves, single ${single}`);
    }
  }
  assert.deepEqual(openingLeaves(1, false), [2, 3], 'an opening is not its two facing pages');
  assert.equal(tomeOpenings(0, false), 1, 'a tome with no leaves has no opening to rest on');
});

test('the corbel steps in course by course, at a desk width and a phone width alike', () => {
  for (const book of [baseBook.spread, baseBook.single]) {
    const base = corbel(book);
    assert.equal(base.width, book + 40, 'the lip no longer overhangs the tome by 20 on either side');
    assert.equal(base.centre, base.width / 2);
    for (const [index, course] of base.courses.entries()) {
      assert.ok(course.bottom > course.top, `course ${index} has no height`);
      if (index === 0) continue;
      const above = base.courses[index - 1];
      assert.equal(course.top, above.bottom, `course ${index} does not sit on the one above`);
      assert.ok(course.half < above.half, `course ${index} does not step in from the one above`);
    }
    const last = base.courses.at(-1);
    assert.equal(base.tail.top, last.bottom, 'the tail does not hang from the last course');
    assert.ok(base.tail.half <= last.half && base.tail.bottom <= base.height, 'the tail is wider than its course or leaves the base');
    assert.ok(base.courses[0].half < base.centre, 'the widest course is wider than the base');
    assert.ok(base.lip.x0 < base.desk.x0 && base.lip.x1 > base.desk.x1, 'the lip does not overhang the desk');
    assert.ok(base.cloth.x0 > base.desk.x0 && base.cloth.x1 < base.desk.x1, 'the cloth hangs past its desk');
    assert.ok(base.staple[0] > base.width, 'the staple is not in the wall beside the corbel');
  }
  assert.ok(corbel(baseBook.single).courses[0].half < corbel(baseBook.spread).courses[0].half, 'a phone corbel is as wide as a desk one');
});

test('the cloth hangs the same on every load, in folds, inside its desk', () => {
  const spec = corbel(baseBook.spread).cloth;
  const hung = cloth(spec);
  assert.deepEqual(cloth(spec).hem, hung.hem, 'the same cloth hung differently');
  assert.notDeepEqual(cloth({ ...spec, seed: spec.seed + 1 }).ridges, hung.ridges, 'the seed moves nothing');
  assert.equal(hung.left, spec.x0 - spec.flare);
  assert.equal(hung.right, spec.x1 + spec.flare);
  for (const [x, y] of hung.hem) {
    assert.ok(x >= hung.left && x <= hung.right, `the hem leaves the cloth at ${x}`);
    assert.ok(y > spec.y0 && y <= hung.bottom, `the hem rises above its rod or below its foot at ${x}`);
  }
  assert.ok(hung.bottom >= spec.y1, 'the cloth is shorter than its hem');
  for (let index = 1; index < hung.ridges.length; index += 1) {
    assert.ok(hung.ridges[index] > hung.ridges[index - 1], 'two folds cross');
  }
  assert.equal(hung.tassels.length, spec.dags, 'a dag has no tassel, or a tassel no dag');
  for (const x of hung.tassels) {
    assert.ok(x > hung.left && x < hung.right, `a tassel hangs off the cloth at ${x}`);
  }
});

test('the chain hangs from its hasp to its staple, below the line between them', () => {
  const near = (point, [x, y], message) => assert.ok(Math.hypot(point.x - x, point.y - y) < 0.5, `${message}: ${point.x}, ${point.y}`);
  for (const [hasp, staple] of [
    [[100, 40], [260, 90]],
    [[260, 90], [100, 40]],
    [[0, 0], [120, 0]],
  ]) {
    const hang = catenary(hasp, staple, 1.25);
    assert.ok(Math.abs(hang.length - Math.hypot(staple[0] - hasp[0], staple[1] - hasp[1]) * 1.25) < 1e-9, 'the chain is not its slack times the span');
    near(hang.at(0), hasp, 'the chain does not start at its hasp');
    near(hang.at(hang.length), staple, 'the chain does not end at its staple');
    const middle = hang.at(hang.length / 2);
    const t = (middle.x - hasp[0]) / (staple[0] - hasp[0]);
    const chord = hasp[1] + (staple[1] - hasp[1]) * t;
    assert.ok(middle.y > chord + 5, 'the chain does not sag below the straight line');
    let walked = 0;
    let last = hang.at(0);
    for (let step = 1; step <= 400; step += 1) {
      const point = hang.at((hang.length * step) / 400);
      walked += Math.hypot(point.x - last.x, point.y - last.y);
      last = point;
    }
    assert.ok(Math.abs(walked - hang.length) < hang.length * 0.002, 'the curve is not walked by its own length');
  }
});

test('the links alternate face-on and edge-on at an even pitch, each turned to point onward', () => {
  const hang = catenary([0, 0], [180, 60], 1.3);
  const thickness = 5;
  const { links, pitch } = chainLinks(hang, thickness);
  assert.equal(links.length, Math.round(hang.length / (thickness * 3.1)));
  assert.ok(Math.abs(pitch * links.length - hang.length) < 1e-9, 'the links do not fill the chain');
  for (const [index, link] of links.entries()) {
    assert.equal(link.face, index % 2 === 0, `link ${index} does not alternate`);
    assert.ok(Math.cos(link.angle) >= 0, `link ${index} points back along the chain`);
    if (index > 0) {
      const gap = Math.hypot(link.x - links[index - 1].x, link.y - links[index - 1].y);
      assert.ok(gap <= pitch && gap > pitch * 0.9, `links ${index - 1} and ${index} are not a pitch apart`);
    }
  }
  assert.equal(chainLinks(catenary([0, 0], [4, 0], 1.1), thickness).links.length, 3, 'a short chain has fewer than three links');
});
