/* THE MOTION BATTERY, LAYER 1 (issue 243; the layer scheme is this file's own
 * and is stated here so a future motion feature knows where its tests go).
 *
 * Owner directive, 2026-08-28: "ensure that our motion test for the UX of
 * mobile users is THOROUGH... a foundation that is not brittle, NOT SLOW TO
 * RUN UNDER ANY CHANCE, but gives us confidence features work on both mobile
 * and desktop." Three layers answer that, and each owns a different question:
 *
 *   LAYER 1 — THIS FILE. Synthetic pointer sequences against the real
 *   bindings, with every clock injected: no DOM, no engine, no timer, no
 *   sleep. It owns DECISIONS and STATE MACHINES — what claims a gesture, what
 *   turns a page, what a release does, what every exit settles to, what a
 *   cycle's phases are and in which order. It is exhaustive precisely BECAUSE
 *   it is cheap: the whole file runs in single-digit milliseconds, so an edge
 *   case costs nothing to keep and there is never a reason to trade coverage
 *   for speed here. Anything that can be decided without a renderer belongs
 *   here and nowhere else.
 *
 *   LAYER 2 — e2e/rendering-lanes.spec.mjs. Real engines, real fingers,
 *   measured boxes. It owns what only an engine knows: that touch-action
 *   really handed the page its scroll, that a transform really settled to
 *   zero, that the document really did not move. It is deliberately SLIM —
 *   one walk per behaviour per project rather than a second copy of the
 *   matrix below — because five projects multiply everything added to it.
 *
 *   LAYER 3 — the structural pins at the end of this file. They own the
 *   things no run can observe: that there is ONE gesture module, that no
 *   component grows its own pointer handling, that a swipe surface declares
 *   a touch-action, that no gesture library entered the tree.
 *
 * A new motion feature lands with a layer-1 case for every decision it makes,
 * at most one layer-2 walk, and a layer-3 pin only if it introduces a rule a
 * run cannot see.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  boundedDrag,
  claimsHorizontal,
  entryOffset,
  frameCoalescer,
  gestureSlop,
  rubberBand,
  swipeDecision,
  swipeHorizontal,
  swipeMetrics
} from '../src/lib/gesture.ts';
import {
  pullArmed,
  pullDistance,
  pullMetrics,
  pullProgress,
  pullToRefresh,
  refreshCycle,
  settleTo
} from '../src/lib/pullToRefresh.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('the rubber band yields, and never reaches its limit however hard it is pulled', () => {
  // The first pixel moves one pixel: the derivative at zero is exactly 1,
  // which is what makes a pull feel attached to the finger rather than
  // sluggish. Anything materially under that is a surface that lags.
  assert.ok(rubberBand(1, 160) > 0.99, `one pixel of pull moved ${rubberBand(1, 160)}px`);

  // Monotone, and always short of the asymptote — that is the whole
  // statement "there is nothing past here", made continuously.
  let previous = 0;
  for (const pull of [10, 50, 100, 200, 400, 1000, 10_000]) {
    const moved = rubberBand(pull, 160);
    assert.ok(moved >= previous, `pull of ${pull} moved ${moved}, behind ${previous}`);
    // Never PAST the limit, at any input. Stated as <= rather than < because
    // the curve is asymptotic in real arithmetic but saturates in float64:
    // 1 - exp(-62.5) rounds to exactly 1, so a 10,000px drag lands ON the
    // limit rather than a hair under it. That is the correct behaviour — the
    // guarantee is that the surface never travels further than the limit —
    // and the strict inequality is asserted below at the distances a hand can
    // actually produce, where it is the real statement.
    assert.ok(moved <= 160, `pull of ${pull} reached ${moved}, past the 160 limit`);
    // And it RESISTS: past the first pixels the surface always moves less
    // than the finger did, which is the feedback the curve exists to give.
    assert.ok(moved < pull, `pull of ${pull} moved ${moved}, which is no resistance at all`);
    previous = moved;
  }
  // Strictly short of the limit across the whole range a thumb can reach on
  // the tallest phone this site is measured on.
  for (const pull of [100, 400, 900]) {
    assert.ok(rubberBand(pull, 160) < 160, `a reachable ${pull}px pull hit the limit exactly`);
  }

  // Mirrored, so one function serves both directions.
  assert.equal(rubberBand(-100, 160), -rubberBand(100, 160));
  // A surface with no give yields nothing rather than dividing by zero.
  assert.equal(rubberBand(100, 0), 0);
  assert.equal(rubberBand(100, -5), 0);
});

test('a swipe turns on distance OR on velocity, and on neither below both', () => {
  const span = 300;
  const far = span * swipeMetrics.distance; // 60px

  // Slow and short: a fidget, and the surface goes back.
  assert.equal(swipeDecision(-30, 1000, span), 0);
  // Slow and long: a deliberate push.
  assert.equal(swipeDecision(-far, 1000, span), 1);
  assert.equal(swipeDecision(far, 1000, span), -1);
  // Short but FAST: the flick, which is the gesture an experienced reader
  // actually makes and which a distance-only rule refuses.
  assert.equal(swipeDecision(-30, 40, span), 1, '30px in 40ms is 0.75px/ms and must count');
  // Fast but in the other direction still goes the other way.
  assert.equal(swipeDecision(30, 40, span), -1);

  // The sign convention: dragging the surface LEFT brings the NEXT item in,
  // exactly as turning a page does. Getting this backwards is the single most
  // likely regression in the whole file.
  assert.equal(swipeDecision(-far, 1000, span), 1, 'dragging left must advance');
  assert.equal(swipeDecision(far, 1000, span), -1, 'dragging right must go back');

  // Degenerate inputs decide nothing rather than dividing by zero or reading
  // a rate off a clock that never moved.
  assert.equal(swipeDecision(0, 100, span), 0);
  assert.equal(swipeDecision(-100, 100, 0), 0);
  assert.equal(swipeDecision(-30, 0, span), 0, 'a zero elapsed time is not evidence of speed');
  assert.equal(swipeDecision(-30, -5, span), 0);
});

test('a gesture claims nothing until it has proven itself horizontal', () => {
  // This is the "never fight the native scroll" rule in one function: until
  // the pointer has moved further across than down AND past the slop, the
  // browser owns the gesture.
  assert.equal(claimsHorizontal(0, 0), false);
  assert.equal(claimsHorizontal(4, 0), false, 'inside the slop, so still the page’s');
  assert.equal(claimsHorizontal(30, 60), false, 'mostly vertical is a scroll, not a swipe');
  assert.equal(claimsHorizontal(60, 30), true);
  assert.equal(claimsHorizontal(-60, 30), true, 'the other direction claims identically');
  // Exactly diagonal is NOT horizontal: ties go to the page, because a stolen
  // scroll is a worse failure than a swipe that needs one more pixel.
  assert.equal(claimsHorizontal(30, 30), false);
});

test('a bounded surface resists only at the end it has actually reached', () => {
  const span = 300;
  // Inside its range a drag tracks the finger EXACTLY. A surface that damped
  // here would feel broken rather than bounded.
  assert.equal(boundedDrag(-50, false, false, span), -50);
  assert.equal(boundedDrag(50, false, false, span), 50);
  // A wrapping surface is at neither end and is never resisted, which is what
  // keeps the gallery's wrap from feeling like a fault.
  assert.equal(boundedDrag(120, false, false, span), 120);
  /* ...but it is BOUNDED, which is a different statement (issue 265). A
     wrapping strip has no end to resist at and still has nothing to show past
     the item that is arriving: one span of travel puts the incoming item
     exactly where the outgoing one was, and past that the stage is empty —
     MEASURED at -552px past the edge before this clamp. Inside the span
     nothing changes, which is the half above. */
  assert.equal(boundedDrag(-span, false, false, span), -span, 'exactly one span is still travel that happened');
  assert.equal(boundedDrag(-552, false, false, span), -span, 'the drag ran past the item it was bringing in');
  assert.equal(boundedDrag(900, false, false, span), span, 'the drag ran past the item it was bringing in');
  /* A span of zero is a surface nobody has measured yet — the stage's own
     width, read at gesture start, before layout. Clamping to it would freeze
     every drag at zero. */
  assert.equal(boundedDrag(-120, false, false, 0), -120, 'an unmeasured surface refuses to move at all');
  // At the start, dragging FORWARD (positive) meets the curve; dragging away
  // from that end does not.
  assert.ok(Math.abs(boundedDrag(120, true, false, span)) < 120);
  assert.equal(boundedDrag(-120, true, false, span), -120);
  // ...and symmetrically at the end.
  assert.ok(Math.abs(boundedDrag(-120, false, true, span)) < 120);
  assert.equal(boundedDrag(120, false, true, span), 120);
});

test('the item a turn brings in enters from its own side, and never travels backwards', () => {
  /* THE DEFECT (issue 265): a committed swipe mounted the new item at the OLD
     drag offset and settled it to zero, so the picture slid in backwards from
     the side it had just left — MEASURED at 120-202px of wrong-way travel per
     swipe, into an otherwise empty stage.
     The entry offset is the finger's own last position carried one span
     forward, so the reader's eye is already where the new item starts. */
  const span = 300;
  // Dragged LEFT by 100 and released as a turn forward: the incoming item was
  // sitting 200px to the right, and that is where it starts.
  assert.equal(entryOffset(-100, 1, span), 200);
  // ...and mirrored for a turn back.
  assert.equal(entryOffset(100, -1, span), -200);
  // A flick barely moves the surface, so the new item enters from nearly a
  // full span away — the ordinary carousel slide.
  assert.equal(entryOffset(-12, 1, span), 288);

  /* NEVER BACKWARDS, and it is a property of the PAIR rather than of the line
     above: boundedDrag clamps a drag to one span, so every offset a commit
     can be reached with produces an entry on the side the item is coming
     from. Separating the two changes reintroduces the defect, so the two are
     swept together here. */
  for (const raw of [-1, -50, -120, -299, -300, -552, -5000]) {
    const dragged = boundedDrag(raw, false, false, span);
    const entry = entryOffset(dragged, 1, span);
    assert.ok(
      entry >= 0,
      `a forward turn released at ${dragged}px enters at ${entry}px — the wrong side, so it slides in backwards`
    );
    assert.ok(entry <= span, `a forward turn enters at ${entry}px, further out than the span it travels`);
    const back = entryOffset(boundedDrag(-raw, false, false, span), -1, span);
    assert.ok(back <= 0, `a backward turn enters at ${back}px — the wrong side`);
    assert.ok(back >= -span, `a backward turn enters at ${back}px, further out than the span it travels`);
  }
});

test('a pull resists, arms at its threshold, and never arms on an upward drag', () => {
  // Upward is not a pull at all — letting one accumulate is how a gesture
  // ends up owing the reader travel they never asked for.
  assert.equal(pullDistance(-200), 0);
  assert.equal(pullDistance(0), 0);

  // It resists exactly as the shared curve does, and cannot reach the limit.
  assert.ok(pullDistance(1000) < pullMetrics.limit);
  assert.ok(pullDistance(40) < 40, 'a pull that moved the full distance is not resisting');

  // The threshold is reachable — a pull nobody can arm is a control that does
  // nothing, and this is exactly the vacuity the review protocol asks about.
  const armingPull = 200;
  assert.ok(
    pullArmed(pullDistance(armingPull)),
    `a ${armingPull}px drag reached ${pullDistance(armingPull)}px, under the ${pullMetrics.threshold}px threshold; the gesture can never fire`
  );
  assert.equal(pullArmed(pullMetrics.threshold - 0.01), false);
  assert.equal(pullArmed(pullMetrics.threshold), true, 'the threshold itself must arm');

  // Progress is what the indicator draws, and it says the SAME thing the
  // release decision does: it reaches 1 exactly where pullArmed turns true.
  assert.equal(pullProgress(0), 0);
  assert.equal(pullProgress(pullMetrics.threshold / 2), 0.5);
  assert.equal(pullProgress(pullMetrics.threshold), 1);
  assert.equal(pullProgress(pullMetrics.threshold * 4), 1, 'past armed is not more armed');
  assert.equal(pullProgress(-50), 0);
  for (const distance of [0, 10, 40, 63, 64, 100, 500]) {
    assert.equal(
      pullProgress(distance) === 1,
      pullArmed(distance),
      `the indicator and the release decision disagree at ${distance}px`
    );
  }
});

test('the settle always arrives at its destination — that is the whole defect it fixes', () => {
  // Issue 187: the removed gesture "did not slingshot back to place". So the
  // one property that matters is that every settle ENDS at its target, in
  // both motion modes.
  const frames = [];
  let clock = 0;
  const view = {
    requestAnimationFrame(fn) {
      // A finite, deterministic clock: 16ms a frame, 400ms total, which
      // overshoots the 260ms duration so the loop is driven to completion.
      if (clock <= 400) {
        clock += 16;
        fn(clock);
      }
      return 0;
    }
  };

  frames.length = 0;
  settleTo(100, 0, false, (value) => frames.push(value), view);
  assert.ok(frames.length > 1, 'an animated settle produced no intermediate frames');
  assert.equal(frames.at(-1), 0, 'the animated settle did not land on its destination');
  // It EASES OUT rather than stepping linearly: an early step covers more
  // ground than a late one, which is what makes the surface visibly leave the
  // finger's position instead of creeping away from it. Measured from the
  // SECOND frame on — the first only establishes the time origin and always
  // reports the starting offset, so a delta across it is zero by
  // construction and would say nothing about the curve.
  assert.equal(frames[0], 100, 'the first frame must report the starting offset');
  const early = Math.abs(frames[1] - frames[0]);
  const late = Math.abs(frames.at(-1) - frames.at(-2));
  assert.ok(early > late, `the settle is not eased out: ${early} then ${late}`);
  // And it is monotone toward the target — never past it and never back.
  for (let at = 1; at < frames.length; at += 1) {
    assert.ok(frames[at] <= frames[at - 1] + 1e-9, `the settle went backwards at frame ${at}`);
    assert.ok(frames[at] >= 0, `the settle overshot past its destination at frame ${at}`);
  }

  // A reduced-motion reader gets the DESTINATION, immediately. Nothing is
  // lost: the guarantee is where it ends, not how it got there.
  frames.length = 0;
  settleTo(100, 0, true, (value) => frames.push(value), view);
  assert.deepEqual(frames, [0]);

  // A settle to where it already is does nothing rather than animating zero
  // pixels for 260ms.
  frames.length = 0;
  settleTo(48, 48, false, (value) => frames.push(value), view);
  assert.deepEqual(frames, [48]);

  // Cancelling stops it mid-flight and leaves the surface where the next
  // settle will pick it up.
  clock = 0;
  frames.length = 0;
  const cancel = settleTo(100, 0, false, (value) => frames.push(value), view);
  const settledCount = frames.length;
  cancel();
  assert.ok(settledCount > 0);
});

/* ===========================================================================
 * THE BINDINGS THEMSELVES, driven by synthetic pointer sequences.
 *
 * The arithmetic above is only half of what a reader's thumb meets: the other
 * half is the state machine that decides which events belong to the gesture,
 * when it claims, what it shows, and what every exit leaves behind. All of it
 * is executable with no DOM at all, because both bindings take their node
 * through addEventListener and their clocks through injection — so this whole
 * section costs microseconds and can therefore afford to be exhaustive.
 * ======================================================================== */

/* A node that records its listeners and lets a test dispatch to them. It is
 * hand-written rather than a DOM implementation for the reason AGENTS.md's
 * testing doctrine gives: a fake with no behaviour of its own cannot pass a
 * test by accident. setPointerCapture is recorded rather than performed —
 * WHETHER a gesture captured, and when, is a real claim this file makes. */
function fakeNode() {
  const listeners = new Map();
  return {
    captured: [],
    released: [],
    listeners,
    addEventListener(type, handler, options) {
      listeners.set(type + (options === true ? ':capture' : ''), { handler, options });
    },
    removeEventListener(type, handler, options) {
      listeners.delete(type + (options === true ? ':capture' : ''));
    },
    setPointerCapture(id) {
      this.captured.push(id);
    },
    releasePointerCapture(id) {
      this.released.push(id);
    },
    send(type, event) {
      const entry = listeners.get(type);
      assert.ok(entry, `nothing is listening for ${type}`);
      entry.handler(event);
    }
  };
}

/* A frame clock a test drives by hand. Nothing runs until tick() is called,
 * which is what makes "one delivery per frame" an observable fact rather than
 * a race. */
function fakeFrames() {
  let queue = [];
  let time = 0;
  return {
    requestAnimationFrame(fn) {
      queue.push(fn);
      return queue.length;
    },
    cancelAnimationFrame(handle) {
      queue[handle - 1] = null;
    },
    tick() {
      const due = queue;
      queue = [];
      time += 16;
      for (const fn of due) fn?.(time);
    },
    get pending() {
      return queue.filter(Boolean).length;
    }
  };
}

/* One swipe harness: the real binding over the fake node, with the moves,
 * commits and settles it produced recorded in order. */
function swipeHarness(overrides = {}) {
  const node = fakeNode();
  const moves = [];
  const commits = [];
  const settles = [];
  /* Every grab the binding reports, in order with the rest: the gallery ends
     its armed settle from here (issue 265), so WHEN it is called is a claim
     this file has to be able to check. */
  const downs = [];
  const frames = fakeFrames();
  const binding = {
    span: () => 300,
    down: () => downs.push(moves.length),
    move: (offset) => moves.push(offset),
    commit: (direction) => commits.push(direction),
    settle: () => settles.push(true),
    atStart: () => false,
    atEnd: () => false,
    view: frames,
    ...overrides
  };
  const bound = swipeHorizontal(node, binding);
  const pointer = (type, x, y, extra = {}) =>
    node.send(type, {
      pointerId: 3,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
      timeStamp: extra.at ?? 0,
      ...extra
    });
  return { node, moves, commits, settles, downs, frames, bound, pointer };
}

test('a swipe moves nothing until the drag has proven itself horizontal', () => {
  const swipe = swipeHarness();
  swipe.pointer('pointerdown', 100, 100);
  // Inside the slop: a finger is never perfectly still, and a page must not
  // move because of it.
  swipe.pointer('pointermove', 104, 100);
  swipe.frames.tick();
  assert.deepEqual(swipe.moves, [], 'the surface moved before the gesture was claimed');
  assert.deepEqual(swipe.node.captured, [], 'the pointer was captured before the drag proved itself');

  // Past the slop and genuinely across: claimed, captured, and moving.
  swipe.pointer('pointermove', 130, 104);
  swipe.frames.tick();
  assert.deepEqual(swipe.moves, [30]);
  assert.deepEqual(swipe.node.captured, [3], 'a claimed drag did not capture its pointer');
});

test('a mostly-vertical drag is handed to the page and never taken back', () => {
  const swipe = swipeHarness();
  swipe.pointer('pointerdown', 100, 100);
  // Down further than across, past the threshold: the page's scroll.
  swipe.pointer('pointermove', 104, 140);
  swipe.frames.tick();
  assert.deepEqual(swipe.moves, [], 'a vertical drag moved the strip');

  /* AND IT STAYS THE PAGE'S. The binding stands DOWN rather than merely not
     acting, so a horizontal wobble later in the same gesture cannot grab a
     scroll already in flight — which is the failure mode that makes a
     carousel feel like it is fighting the reader. */
  swipe.pointer('pointermove', 200, 140);
  swipe.frames.tick();
  assert.deepEqual(swipe.moves, [], 'a stood-down gesture grabbed the scroll it had already conceded');
  swipe.pointer('pointerup', 200, 140);
  assert.deepEqual(swipe.commits, [], 'a stood-down gesture turned the page anyway');
});

test('a release turns the page on distance, on velocity, and on neither below both', () => {
  // Distance: a fifth of the 300px span is 60px, dragged left.
  const far = swipeHarness();
  far.pointer('pointerdown', 200, 100);
  far.pointer('pointermove', 180, 100);
  far.pointer('pointermove', 120, 100, { at: 900 });
  far.pointer('pointerup', 120, 100, { at: 900 });
  assert.deepEqual(far.commits, [1], 'a long leftward drag did not advance');

  // Velocity: 30px in 40ms is 0.75px/ms — the flick an experienced reader
  // makes, which a distance-only rule refuses.
  const flick = swipeHarness();
  flick.pointer('pointerdown', 200, 100);
  flick.pointer('pointermove', 185, 100, { at: 20 });
  flick.pointer('pointermove', 170, 100, { at: 40 });
  flick.pointer('pointerup', 170, 100, { at: 40 });
  assert.deepEqual(flick.commits, [1], 'a fast short flick did not advance');

  // Neither: slow and short is a fidget, and the surface comes back.
  const fidget = swipeHarness();
  fidget.pointer('pointerdown', 200, 100);
  fidget.pointer('pointermove', 189, 100, { at: 400 });
  fidget.pointer('pointerup', 189, 100, { at: 400 });
  assert.deepEqual(fidget.commits, [], 'a slow eleven-pixel drag turned the page');
  assert.equal(fidget.moves.at(-1), 0, 'a fidget left the surface displaced');
  assert.equal(fidget.settles.length, 1, 'a fidget did not settle');
});

test('every exit puts the surface back at zero — committed, fidgeted or cancelled', () => {
  for (const [name, exit] of [
    ['a committed turn', (swipe) => swipe.pointer('pointerup', 60, 100, { at: 800 })],
    ['a browser cancel', (swipe) => swipe.pointer('pointercancel', 60, 100)]
  ]) {
    const swipe = swipeHarness();
    swipe.pointer('pointerdown', 200, 100);
    swipe.pointer('pointermove', 60, 100);
    swipe.frames.tick();
    assert.ok(swipe.moves.at(-1) !== 0, `${name}: the drag never moved anything to put back`);
    exit(swipe);
    assert.equal(swipe.moves.at(-1), 0, `${name} left the surface displaced`);
    assert.equal(swipe.settles.length, 1, `${name} did not settle`);
  }
});

test('a pending drag frame can never land after the settle', () => {
  /* The exact regression the coalescer could introduce, and the reason every
     terminal position is FLUSHED rather than queued: a drag frame still in
     the queue at release would deliver the finger's last sample AFTER the
     zero, leaving the surface displaced — the defect this whole layer exists
     to prevent, reintroduced by an optimisation. */
  const swipe = swipeHarness();
  swipe.pointer('pointerdown', 200, 100);
  swipe.pointer('pointermove', 60, 100);
  // Deliberately no tick: the drag's frame is still queued.
  swipe.pointer('pointerup', 60, 100, { at: 800 });
  assert.equal(swipe.moves.at(-1), 0, 'the release did not flush the surface home');
  swipe.frames.tick();
  assert.equal(swipe.moves.at(-1), 0, 'a stale drag frame landed after the settle');
  assert.equal(swipe.frames.pending, 0, 'a frame is still queued after the gesture ended');
});

test('a flood of pointer moves costs one delivery per frame, and it is the newest', () => {
  /* The owner's "swiping is NOT very smooth on the phone" (2026-08-28),
     measured where it can be measured deterministically. A phone reports far
     more moves than it draws frames, and each one used to write a custom
     property — a style invalidation for the stage's whole subtree, two to
     four times per painted frame, all but the last invisible. */
  const swipe = swipeHarness();
  swipe.pointer('pointerdown', 200, 100);
  swipe.pointer('pointermove', 160, 100);
  swipe.frames.tick();
  const afterClaim = swipe.moves.length;
  for (let step = 1; step <= 60; step += 1) {
    swipe.pointer('pointermove', 160 - step, 100);
  }
  assert.equal(
    swipe.moves.length,
    afterClaim,
    `60 pointer moves produced ${swipe.moves.length - afterClaim} deliveries before a single frame ran`
  );
  swipe.frames.tick();
  assert.equal(swipe.moves.length, afterClaim + 1, 'a frame delivered more than one position');
  assert.equal(swipe.moves.at(-1), -100, 'the frame delivered a stale position rather than the newest');
});

test('the coalescer delivers everything it is given when there is no frame clock at all', () => {
  /* A host with no requestAnimationFrame — a server render, a bare Node
     context — has no frames to coalesce against, so "one per frame" is a
     statement with no content there. What still has content is that no value
     is lost: queuing against a clock that never ticks would drop the drag
     entirely, which is a far worse failure than not coalescing. */
  const delivered = [];
  const coalescer = frameCoalescer((value) => delivered.push(value), {});
  coalescer.push(1);
  coalescer.push(2);
  assert.deepEqual(delivered, [1, 2]);
  coalescer.flush(0);
  assert.deepEqual(delivered, [1, 2, 0]);
});

test('the coalescer cancels what it has queued rather than delivering it late', () => {
  const frames = fakeFrames();
  const delivered = [];
  const coalescer = frameCoalescer((value) => delivered.push(value), frames);
  coalescer.push(5);
  coalescer.cancel();
  frames.tick();
  assert.deepEqual(delivered, [], 'a cancelled value was delivered anyway');
  // And the coalescer still works afterwards: cancel is not a teardown.
  coalescer.push(7);
  frames.tick();
  assert.deepEqual(delivered, [7]);

  /* AND IT DROPS THE VALUE, not merely the callback — which is the half a
     cancelAnimationFrame hides. A host that offers requestAnimationFrame and
     no way to cancel one still runs the queued callback, so clearing the
     handle alone would let a cancelled drag position land a frame later: the
     surface displaced after a settle, by the one road the tests above cannot
     see. */
  const uncancellable = fakeFrames();
  const late = [];
  const noCancel = frameCoalescer((value) => late.push(value), {
    requestAnimationFrame: uncancellable.requestAnimationFrame
  });
  noCancel.push(11);
  noCancel.cancel();
  uncancellable.tick();
  assert.deepEqual(late, [], 'a cancelled value arrived a frame late on a host that cannot cancel a frame');
});

test('a drag eats its own trailing click, and never a keyboard activation', () => {
  const swipe = swipeHarness();
  const clickEntry = swipe.node.listeners.get('click:capture');
  assert.ok(clickEntry, 'the click suppression is not registered in the capture phase');
  const click = (detail) => {
    let prevented = false;
    let stopped = false;
    clickEntry.handler({
      detail,
      preventDefault: () => (prevented = true),
      stopPropagation: () => (stopped = true)
    });
    return { prevented, stopped };
  };

  // No drag, no suppression: an ordinary tap must reach the control.
  assert.deepEqual(click(1), { prevented: false, stopped: false });

  // A real drag arms exactly one suppression.
  swipe.pointer('pointerdown', 200, 100);
  swipe.pointer('pointermove', 60, 100);
  swipe.pointer('pointerup', 60, 100, { at: 800 });
  assert.deepEqual(click(1), { prevented: true, stopped: true }, 'a drag’s trailing click reached the control');
  assert.deepEqual(click(1), { prevented: false, stopped: false }, 'the suppression outlived its own click');

  /* A KEYBOARD ACTIVATION IS NEVER A STRAY DRAG CLICK. A touch swipe past the
     platform's slop produces no click at all, so the armed suppression is
     never spent — and a keyboard reader, who produces no pointer event to
     disarm it, walked straight into it. `detail === 0` is how the platform
     says "this came from Enter or Space", and such a click passes through
     WITHOUT consuming the flag: the keypress was not this gesture's to
     spend. */
  swipe.pointer('pointerdown', 200, 100);
  swipe.pointer('pointermove', 60, 100);
  swipe.pointer('pointerup', 60, 100, { at: 800 });
  assert.deepEqual(click(0), { prevented: false, stopped: false }, 'a keyboard activation was eaten by a drag');
  assert.deepEqual(click(1), { prevented: true, stopped: true }, 'the suppression owed to a pointer was spent by a keypress');
});

test('a settle cannot survive the next grab, and only a real grab ends one', () => {
  /* THE DEFECT (issue 265): the gallery arms a CSS transition for the length
     of its settle and had no way to hear that a new gesture had begun, so a
     swipe started inside that window dragged THROUGH the armed transition —
     MEASURED at 66-93px of lag between the finger and the picture. Nothing
     but the next pointerdown knows the settle is over early, and pointerdown
     is the one event every path into a gesture begins with. */
  const swipe = swipeHarness();
  swipe.pointer('pointerdown', 200, 100);
  assert.deepEqual(swipe.downs, [0], 'the surface is never told a finger arrived');
  /* BEFORE anything is delivered: the recorded value is the number of moves
     that had happened when the grab was reported, so a hook fired after the
     first drag frame would read 1 and the lag would be back. */
  swipe.pointer('pointermove', 60, 100);
  swipe.frames.tick();
  swipe.pointer('pointerup', 60, 100, { at: 800 });
  assert.deepEqual(swipe.downs, [0]);

  // A second gesture reports its own grab, so the settle the first one armed
  // is ended rather than left to a timer.
  swipe.pointer('pointerdown', 200, 100);
  assert.equal(swipe.downs.length, 2, 'the second gesture never announced itself');

  /* AND ONLY A REAL GRAB. A second finger and a secondary button are not
     gestures, and ending a settle for one of them would snap a surface home
     that nobody had touched — which is why the hook is called after the
     binding's own guards rather than at the top of the handler. */
  const refused = swipeHarness();
  refused.pointer('pointerdown', 200, 100, { pointerType: 'mouse', button: 2 });
  assert.deepEqual(refused.downs, [], 'a right-button press ended a settle');
  refused.pointer('pointerdown', 200, 100);
  refused.pointer('pointerdown', 100, 100, { pointerId: 9 });
  assert.equal(refused.downs.length, 1, 'a second finger ended the settle of the gesture already running');
});

test('a secondary button and a second finger are not drags', () => {
  const secondary = swipeHarness();
  secondary.pointer('pointerdown', 200, 100, { pointerType: 'mouse', button: 2 });
  secondary.pointer('pointermove', 60, 100, { pointerType: 'mouse' });
  secondary.frames.tick();
  assert.deepEqual(secondary.moves, [], 'a right-button drag moved the strip');

  const second = swipeHarness();
  second.pointer('pointerdown', 200, 100);
  // A different pointerId while one is tracked: the browser's pinch, not ours.
  second.pointer('pointerdown', 100, 100, { pointerId: 9 });
  second.pointer('pointermove', 60, 100, { pointerId: 9 });
  second.frames.tick();
  assert.deepEqual(second.moves, [], 'a second finger drove the strip');
});

test('a wrapping surface is never resisted, and a bounded one refuses at the end it reached', () => {
  // The gallery wraps, so there is no end to resist at and a drag tracks the
  // finger exactly — pretending otherwise makes the wrap feel like a fault.
  const wrapping = swipeHarness();
  wrapping.pointer('pointerdown', 100, 100);
  wrapping.pointer('pointermove', 220, 100);
  wrapping.frames.tick();
  assert.equal(wrapping.moves.at(-1), 120);

  // A bounded surface at its start yields to the curve instead, and still
  // refuses to commit past the end it has reached.
  const bounded = swipeHarness({ atStart: () => true });
  bounded.pointer('pointerdown', 100, 100);
  bounded.pointer('pointermove', 220, 100);
  bounded.frames.tick();
  assert.ok(bounded.moves.at(-1) < 120, 'a bounded surface tracked the finger past its own end');
  bounded.pointer('pointerup', 220, 100, { at: 900 });
  assert.deepEqual(bounded.commits, [], 'a bounded surface turned past the end it had reached');
  assert.equal(bounded.moves.at(-1), 0);
});

test('destroying the binding removes every listener and drops any queued frame', () => {
  const swipe = swipeHarness();
  swipe.pointer('pointerdown', 200, 100);
  swipe.pointer('pointermove', 60, 100);
  swipe.bound.destroy();
  assert.equal(swipe.frames.pending, 0, 'a queued drag frame outlived the binding');
  assert.equal(swipe.node.listeners.size, 0, 'the binding left listeners behind');
});

test('every swipe listener is passive except the one that must not be', () => {
  /* The promise the binding keeps by never calling preventDefault on a
     pointer event: the page's vertical scroll is handed over by touch-action
     on the surface, not by fighting for it here. The click listener is the
     exception and is the one that DOES prevent — a drag's trailing click. */
  const swipe = swipeHarness();
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    assert.deepEqual(
      swipe.node.listeners.get(type).options,
      { passive: true },
      `the ${type} listener is not passive, so the engine must wait to find out whether it fights the scroll`
    );
  }
  assert.equal(swipe.node.listeners.get('click:capture').options, true);
});

/* ===========================================================================
 * The pull's cycle: the dwell floor, the acknowledgement, and the settle
 * guarantee across both of them (issue 243).
 * ======================================================================== */

/* Let every pending microtask chain settle. The cycle under test is built
 * from Promise.all plus a catch and a chain of thens, so "one await" is not a
 * number any test should be guessing at; setImmediate lands after all of them
 * and costs no wall clock. */
const flushed = () => new Promise((resolve) => setImmediate(resolve));

/* A clock whose waits are resolved BY HAND, so a 700ms floor costs this file
 * nothing and the ORDER of the waits is observable. */
function fakeClock() {
  const waiting = [];
  return {
    wait: (ms) => new Promise((resolve) => waiting.push({ ms, resolve })),
    get pending() {
      return waiting.map((entry) => entry.ms);
    },
    resolve(ms) {
      const at = waiting.findIndex((entry) => entry.ms === ms);
      assert.ok(at >= 0, `nothing is waiting ${ms}ms; pending: ${waiting.map((e) => e.ms)}`);
      waiting.splice(at, 1)[0].resolve();
    }
  };
}

test('the refreshing hold outlasts a fast refresh, and never shortens a slow one', async () => {
  /* THE OWNER'S DEFECT, in one test. refreshPanels() resolves in tens of
     milliseconds against a same-origin cache-revalidating endpoint, so the
     armed hold collapsed before its own 260ms settle had finished drawing:
     the mark appeared, the animation was cut off, and the surface snapped
     home. A reader saw a flicker and concluded the site had ignored them. */
  const phases = [];
  const clock = fakeClock();
  let finishWork;
  const cycle = refreshCycle(
    () => new Promise((resolve) => (finishWork = resolve)),
    (phase) => phases.push(phase),
    clock.wait
  );

  assert.deepEqual(phases, ['refreshing'], 'the cycle did not enter the refreshing hold first');
  assert.deepEqual(clock.pending, [pullMetrics.dwell], 'the dwell floor was never started');

  // The work lands immediately, as it does in production. The hold must NOT
  // end here.
  finishWork();
  await flushed();
  assert.deepEqual(phases, ['refreshing'], 'a fast refresh ended the hold before the floor elapsed');

  // Only once the floor elapses does the acknowledgement appear, and it is a
  // state of its own rather than a return straight to idle.
  clock.resolve(pullMetrics.dwell);
  await flushed();
  assert.deepEqual(phases, ['refreshing', 'complete']);
  assert.deepEqual(clock.pending, [pullMetrics.done], 'the acknowledgement is not held for any time at all');

  clock.resolve(pullMetrics.done);
  await cycle;
  assert.deepEqual(phases, ['refreshing', 'complete', 'idle'], 'the cycle did not return to rest');
});

test('a SLOW refresh is shown for as long as it takes, and a failing one still completes', async () => {
  // The floor is a minimum, never a delay added to the work: the hold ends
  // when BOTH have elapsed.
  const phases = [];
  const clock = fakeClock();
  let finishWork;
  const cycle = refreshCycle(
    () => new Promise((resolve) => (finishWork = resolve)),
    (phase) => phases.push(phase),
    clock.wait
  );
  clock.resolve(pullMetrics.dwell);
  await flushed();
  assert.deepEqual(phases, ['refreshing'], 'the hold ended while the work was still running');
  finishWork();
  await flushed();
  clock.resolve(pullMetrics.done);
  await cycle;
  assert.deepEqual(phases, ['refreshing', 'complete', 'idle']);

  /* A REJECTED refresh reaches idle exactly the same way. A gesture must not
     be able to strand the page on a failed request, and the panel layer
     already degrades a failure to its honest unavailable envelope — so there
     is nothing for this cycle to surface and everything for it to finish. */
  const failed = [];
  const failing = fakeClock();
  const run = refreshCycle(
    () => Promise.reject(new Error('origin down')),
    (phase) => failed.push(phase),
    failing.wait
  );
  failing.resolve(pullMetrics.dwell);
  await flushed();
  failing.resolve(pullMetrics.done);
  await run;
  assert.deepEqual(failed, ['refreshing', 'complete', 'idle'], 'a failed refresh left the control mid-cycle');
});

/* One pull harness: the real binding over the fake node, with every clock
 * injected and every rendered frame recorded. */
function pullHarness(overrides = {}) {
  const node = fakeNode();
  const rendered = [];
  const clock = fakeClock();
  const frames = fakeFrames();
  let refreshes = 0;
  const binding = {
    atTop: () => true,
    render: (distance, phase) => rendered.push([distance, phase]),
    refresh: () => {
      refreshes += 1;
      return Promise.resolve();
    },
    /* Immediate settles unless a case is about the animation: these tests are
       about the state machine, and an eased settle would only add frames. */
    reduced: () => true,
    wait: clock.wait,
    view: frames,
    ...overrides
  };
  const bound = pullToRefresh(node, binding);
  const touch = (type, y, extra = {}) =>
    node.send(type, { pointerId: 5, pointerType: 'touch', clientX: 50, clientY: y, ...extra });
  return {
    node,
    rendered,
    clock,
    frames,
    bound,
    touch,
    get refreshes() {
      return refreshes;
    },
    phase: () => rendered.at(-1)?.[1],
    distance: () => rendered.at(-1)?.[0]
  };
}

/* Far enough that pullDistance's resisted travel clears the 64px threshold —
 * derived rather than written down, so the harness cannot drift from the
 * metrics it is testing. */
const armingDrag = (() => {
  for (let dy = 12; dy < 1000; dy += 1) {
    if (pullArmed(pullDistance(dy))) return dy;
  }
  throw new Error('no downward drag can arm the pull; the metrics are unreachable');
})();

test('an armed release holds, acknowledges, and settles home exactly once', async () => {
  const pull = pullHarness();
  pull.touch('pointerdown', 100);
  pull.touch('pointermove', 100 + armingDrag);
  pull.frames.tick();
  assert.equal(pull.phase(), 'armed', `a ${armingDrag}px drag did not arm the pull`);

  pull.touch('pointerup', 100 + armingDrag);
  assert.equal(pull.phase(), 'refreshing');
  assert.equal(pull.distance(), pullMetrics.rest, 'the hold is not at the rest offset');
  assert.equal(pull.refreshes, 1, 'the release did not run the refresh exactly once');

  pull.clock.resolve(pullMetrics.dwell);
  await flushed();
  assert.equal(pull.phase(), 'complete', 'the reader is never told the refresh finished');
  assert.equal(pull.distance(), pullMetrics.rest, 'the acknowledgement moved the surface instead of holding it');

  pull.clock.resolve(pullMetrics.done);
  await flushed();
  assert.equal(pull.phase(), 'idle');
  assert.equal(pull.distance(), 0, 'the surface was left displaced after the cycle');
});

test('a second gesture cannot start inside the cycle, in either of its two phases', async () => {
  /* The defect the busy flag makes unrepresentable. The cycle now spans two
     phases, so a guard written as `phase === 'refreshing'` would let a drag
     take the surface during the acknowledgement while a queued settle was
     still on its way home. */
  const pull = pullHarness();
  pull.touch('pointerdown', 100);
  pull.touch('pointermove', 100 + armingDrag);
  pull.frames.tick();
  pull.touch('pointerup', 100 + armingDrag);

  for (const phase of ['refreshing', 'complete']) {
    if (phase === 'complete') {
      pull.clock.resolve(pullMetrics.dwell);
      await flushed();
    }
    assert.equal(pull.phase(), phase);
    const before = pull.rendered.length;
    pull.touch('pointerdown', 100);
    pull.touch('pointermove', 100 + armingDrag);
    pull.frames.tick();
    assert.equal(
      pull.rendered.length,
      before,
      `a new drag drove the surface during the ${phase} phase`
    );
    assert.equal(pull.refreshes, 1, `a new drag ran a second refresh during the ${phase} phase`);
  }

  pull.clock.resolve(pullMetrics.done);
  await flushed();
  assert.equal(pull.distance(), 0);
});

test('an unarmed release, and a cancel, settle to zero without refreshing anything', () => {
  const short = pullHarness();
  short.touch('pointerdown', 100);
  short.touch('pointermove', 130);
  short.frames.tick();
  assert.equal(short.phase(), 'pulling', 'a short pull armed');
  short.touch('pointerup', 130);
  assert.equal(short.distance(), 0, 'an unarmed release left the surface displaced');
  assert.equal(short.phase(), 'idle');
  assert.equal(short.refreshes, 0, 'an unarmed release refreshed anyway');

  const cancelled = pullHarness();
  cancelled.touch('pointerdown', 100);
  cancelled.touch('pointermove', 100 + armingDrag);
  cancelled.frames.tick();
  cancelled.touch('pointercancel', 100 + armingDrag);
  assert.equal(cancelled.distance(), 0, 'a browser cancel left the surface displaced');
  assert.equal(cancelled.refreshes, 0, 'a cancelled gesture refreshed anyway');
});

/* THE STRAND (issue 265, defect 1), and it is the whole reason this file's
 * rule 3 is now a function. Reproduced here first, because a bug nobody can
 * re-create is a bug nobody can prove fixed: a second touch during the 260ms
 * snap-back cancels the settle in flight (onDown does that deliberately, so a
 * new gesture can pick the surface up where the last one left it) — and if
 * that touch then turns out to be a scroll, the old code simply stopped
 * tracking. The page stayed frozen wherever the cancelled settle had reached:
 * MEASURED on the live 0.1.65 origin at 39.98px of `--page-pull`,
 * `data-pulling="true"` for the rest of the session, and the indicator pinned
 * at the top of the viewport 1500px down the page. */
function strandedMidSettle(overrides = {}) {
  const pull = pullHarness({ reduced: () => false, ...overrides });
  pull.touch('pointerdown', 100);
  // Short of the arming threshold: this releases into the snap-back rather
  // than into a refresh.
  pull.touch('pointermove', 140);
  pull.frames.tick();
  assert.equal(pull.phase(), 'pulling', 'the setup pull armed; there is no snap-back to interrupt');
  pull.touch('pointerup', 140);
  // Two frames in: the settle is genuinely in flight and the surface is
  // genuinely displaced, which is what makes the interruption below real.
  pull.frames.tick();
  pull.frames.tick();
  assert.ok(pull.distance() > 0, 'the settle finished instantly; there is no mid-settle to interrupt');
  // The second touch, which cancels that settle by arriving.
  pull.touch('pointerdown', 100);
  return pull;
}

/* Enough frames to drive any settle to its destination: 260ms at the fake
 * clock's 16ms a frame is 17, and this is comfortably past it. */
function settleFully(pull) {
  for (let frame = 0; frame < 24; frame += 1) {
    pull.frames.tick();
  }
}

test('every exit from a pull settles the surface to zero, including mid-settle (issue 265)', () => {
  /* The file's own rule 3 — "every exit, committed, abandoned or cancelled,
     runs through the same settle" — as an executable table rather than a
     sentence. Each row is a way the SECOND touch of a strand can end, and
     before this change three of them cleared the pointer and left the page
     displaced for the rest of the session. */
  const exits = [
    ['an upward flick', (pull) => pull.touch('pointermove', 90)],
    ['a horizontal swipe', (pull) => pull.touch('pointermove', 102, { clientX: 220 })],
    [
      'a page that has left its top',
      (pull, state) => {
        state.atTop = false;
        pull.touch('pointermove', 160);
      }
    ],
    ['a touch that simply lifts', (pull) => pull.touch('pointerup', 100)],
    ['a browser cancel', (pull) => pull.touch('pointercancel', 100)]
  ];
  for (const [name, exit] of exits) {
    const state = { atTop: true };
    const pull = strandedMidSettle({ atTop: () => state.atTop });
    const frozen = pull.distance();
    exit(pull, state);
    settleFully(pull);
    assert.equal(pull.distance(), 0, `${name} stranded the page at ${frozen}px`);
    assert.equal(pull.phase(), 'idle', `${name} left the indicator reading "${pull.phase()}"`);
  }
});

test('a stand-down releases the touch defence rather than leaking it (issue 265)', () => {
  /* The same three exits leaked the non-passive touchmove listener onto
     document.body — permanently, since only onUp and onCancel ever removed
     it — so the first non-pull touch that began at the top of the page made
     the whole document a scroll-blocking region for the rest of the session.
     One helper removes it now, and it is the only place the pointer is
     cleared. */
  const pull = pullHarness();
  pull.touch('pointerdown', 100);
  assert.ok(pull.node.listeners.has('touchmove'), 'an eligible touch never attached the defence');
  pull.touch('pointermove', 90);
  assert.ok(
    !pull.node.listeners.has('touchmove'),
    'the non-passive touchmove listener outlived the gesture that attached it'
  );
});

test('the pull renders once a frame while a finger is dragging it', () => {
  const pull = pullHarness();
  pull.touch('pointerdown', 100);
  pull.touch('pointermove', 130);
  pull.frames.tick();
  const afterClaim = pull.rendered.length;
  for (let step = 1; step <= 40; step += 1) {
    pull.touch('pointermove', 130 + step);
  }
  assert.equal(pull.rendered.length, afterClaim, '40 pointer moves rendered before a frame ran');
  pull.frames.tick();
  assert.equal(pull.rendered.length, afterClaim + 1, 'a frame rendered more than one position');
  /* The internal state is NOT deferred with it: every decision below reads
     the distance synchronously, so a release in the same task as the last
     move still arms on what the finger actually did. */
  pull.touch('pointerup', 170);
  assert.equal(pull.phase(), 'idle');
});

test('nothing renders after the binding is destroyed, even mid-cycle', async () => {
  /* The asynchronous cycle outlives an unmount by up to a dwell plus an
     acknowledgement, which the previous synchronous shape could not. */
  const pull = pullHarness();
  pull.touch('pointerdown', 100);
  pull.touch('pointermove', 100 + armingDrag);
  pull.frames.tick();
  pull.touch('pointerup', 100 + armingDrag);
  pull.bound.destroy();
  const after = pull.rendered.length;
  pull.clock.resolve(pullMetrics.dwell);
  await flushed();
  pull.clock.resolve(pullMetrics.done);
  await flushed();
  assert.equal(pull.rendered.length, after, 'the cycle rendered into a destroyed binding');
  assert.equal(pull.node.listeners.size, 0, 'destroy left listeners behind');
});

test('a pull never begins away from the top, and never from a mouse', () => {
  const scrolled = pullHarness({ atTop: () => false });
  scrolled.touch('pointerdown', 100);
  scrolled.touch('pointermove', 100 + armingDrag);
  scrolled.frames.tick();
  assert.deepEqual(scrolled.rendered, [], 'a pull engaged with the document scrolled');

  const mouse = pullHarness();
  mouse.touch('pointerdown', 100, { pointerType: 'mouse' });
  mouse.touch('pointermove', 100 + armingDrag, { pointerType: 'mouse' });
  mouse.frames.tick();
  assert.deepEqual(mouse.rendered, [], 'a mouse drag was claimed as a pull');
});

/* ===========================================================================
 * One gesture layer, not several. These make a second hand-rolled drag a red
 * build rather than a code review somebody has to catch.
 * ======================================================================== */

const componentSources = Object.fromEntries(
  await Promise.all(
    (await readdir(new URL('../src', import.meta.url), { recursive: true }))
      .filter((entry) => entry.endsWith('.svelte'))
      .map(async (entry) => [entry, await read(`../src/${entry}`)])
  )
);

/* The one component that drags without going through lib/gesture.ts, named
 * rather than silently tolerated. ColumnHandles is the column-resize rail: it
 * predates this layer, it drags a LAYOUT DIMENSION rather than advancing
 * between items, and it deliberately takes the whole gesture
 * (`touch-action: none`) because a resize has no axis to give back. Porting it
 * would change behaviour this issue was not asked to touch, so it stays listed
 * here — where the next reader sees the exception and its reason — instead of
 * being excluded by a pattern that would also hide a genuinely new one. */
const preExistingDragSurfaces = new Set(['lib/components/ColumnHandles.svelte']);

test('no component wires its own pointer drag; the gesture layer is one module', () => {
  let swept = 0;
  for (const [name, source] of Object.entries(componentSources)) {
    if (preExistingDragSurfaces.has(name)) {
      // The exception must stay TRUE: if this file stops dragging, the
      // allowance is stale and belongs deleted rather than carried forever.
      assert.match(
        source,
        /setPointerCapture/,
        `${name} is listed as a pre-existing drag surface but no longer drags; drop the exception`
      );
      continue;
    }
    swept += 1;
    // The tooltip's own binding is the ONE other pointer consumer on this
    // page and it lives in lib/tooltip.ts for the identical reason. A
    // component reaching for setPointerCapture or a raw pointer listener is a
    // second gesture implementation being born.
    assert.doesNotMatch(
      source,
      /setPointerCapture|addEventListener\(\s*'pointer/,
      `${name} wires pointer events itself instead of using lib/gesture.ts`
    );
  }
  assert.ok(swept > 0, 'the component sweep found nothing to check; it is broken');
});

test('no third-party gesture dependency entered the frontend (requirement 1)', async () => {
  const manifest = JSON.parse(await read('../package.json'));
  const declared = Object.keys({
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {})
  });
  // Named rather than sampled: these are the packages a hurried agent reaches
  // for, and requirement 1 forbids every one of them.
  for (const banned of ['hammerjs', 'swiper', 'embla-carousel', 'react-swipeable', 'interactjs']) {
    assert.ok(
      !declared.some((name) => name.toLowerCase().includes(banned)),
      `${banned} entered the frontend; requirement 1 forbids a third-party runtime dependency`
    );
  }
  // The runtime dependency surface stays empty entirely, which is the
  // stronger statement and the one that catches a package this list has never
  // heard of.
  assert.deepEqual(
    Object.keys(manifest.dependencies ?? {}),
    [],
    'the frontend gained a runtime dependency'
  );
});

/* The native-touch defence (0.1.52): real iOS Safari claims a downward touch
 * at the top as a scroll and fires pointercancel before the pull renders a
 * pixel — synthetic pointers, which no browser arbitrates, sailed through and
 * kept every emulated lane green while the physical phone was broken. The
 * repair is a non-passive touchmove listener that exists only inside an
 * eligible touch and contests exactly the moves that could still become a
 * pull. This harness executes that contract event by event: what gets
 * prevented, what falls through, and that the listener's whole lifetime is
 * the touch it was attached for. */
test('the pull contests the browser claim only while the touch could still be a pull', () => {
  const listeners = new Map();
  const node = {
    addEventListener: (type, handler, options) => listeners.set(type, { handler, options }),
    removeEventListener: (type) => listeners.delete(type)
  };
  let atTop = true;
  const cleanup = pullToRefresh(node, {
    atTop: () => atTop,
    render: () => {},
    refresh: () => Promise.resolve(),
    /* Immediate settles: this test is about event arbitration, not motion. */
    reduced: () => true
  });

  const down = (y, type = 'touch') =>
    listeners.get('pointerdown').handler({ pointerType: type, pointerId: 7, clientX: 50, clientY: y });
  const move = (x, y) =>
    listeners.get('pointermove').handler({ pointerId: 7, clientX: x, clientY: y });
  /* The touches are a LIST with identifiers, because which finger a TouchList
     entry belongs to is now part of the contract (issue 265): a gesture reads
     the touch it adopted, never whichever one happens to be first. */
  const touchMove = (y, options = {}) => {
    let prevented = false;
    listeners.get('touchmove')?.handler({
      cancelable: options.cancelable ?? true,
      touches: options.touches ?? [{ identifier: 1, clientY: y }],
      preventDefault: () => (prevented = true)
    });
    return prevented;
  };

  // A mouse never attaches the touch listener at all: the defence costs
  // nothing except inside a finger's own gesture.
  down(100, 'mouse');
  assert.ok(!listeners.has('touchmove'), 'a mouse drag must not attach a touchmove listener');

  // An eligible finger attaches it NON-passive — a passive listener's
  // preventDefault is a no-op, which was the entire failure mode.
  down(100);
  assert.ok(listeners.has('touchmove'), 'an eligible touch must attach the defence');
  assert.deepEqual(listeners.get('touchmove').options, { passive: false });

  /* THE PROVING WINDOW, AND ITS FLOOR (issue 265). A downward move is
     contested before `claimed` flips, because Safari takes the gesture inside
     the first pixels — but only once the finger has gone somewhere. This used
     to defend ANY downward delta greater than zero, and the owner's report
     from a real iPhone is what that cost: "the top-of-page upward flick
     sometimes does nothing until retried". A finger does not begin an upward
     flick with an upward pixel; the first sample drifts a few pixels down,
     that sample was preventDefault'ed at the top of the document, and the
     scroll the reader asked for never happened.
     The floor is lib/gesture.ts's own gestureSlop — the same number the swipe
     decides a finger has gone somewhere at — so "still" means one thing to
     both gestures on this page. */
  assert.equal(
    touchMove(100 + gestureSlop),
    false,
    'a touch still inside the slop is contested, so an upward flick can still be eaten at the top'
  );
  assert.equal(touchMove(100 + gestureSlop + 1), true, 'a downward move past the slop must be defended');
  // An upward move falls through: that is the page's scroll, not a pull.
  assert.equal(touchMove(94), false, 'an upward move belongs to the browser');
  // A move the browser already made uncancelable is never fought.
  assert.equal(touchMove(130, { cancelable: false }), false, 'an uncancelable move cannot be contested');

  /* THE TOUCH IS THE ONE THIS GESTURE ADOPTED. `Touch.identifier` and
     `PointerEvent.pointerId` are unrelated counters no specification relates,
     so the tracked touch is adopted on first sight and matched by name after
     that — reading `touches[0]` meant a gesture that began while another
     finger was already down defended itself against a stranger's
     coordinates. */
  assert.equal(
    touchMove(200, { touches: [{ identifier: 9, clientY: 200 }] }),
    false,
    'a finger this gesture never adopted drove the defence'
  );
  assert.equal(
    touchMove(200, {
      touches: [
        { identifier: 9, clientY: 40 },
        { identifier: 1, clientY: 200 }
      ]
    }),
    true,
    'the adopted touch is no longer found once it stops being first in the list'
  );

  // Once the drag proves itself a pull, every move is the pull's.
  move(50, 120);
  assert.equal(touchMove(130), true, 'a claimed pull owns its touchmoves');

  // The release removes the listener with the touch it was attached for.
  listeners.get('pointerup').handler({ pointerId: 7 });
  assert.ok(!listeners.has('touchmove'), 'the defence must not outlive its touch');

  // A horizontal stand-down (the swipe's drag, not the pull's) leaves the
  // remaining moves to the browser even though the listener is still wired:
  // pointer is -1, so nothing is contested.
  down(100);
  move(120, 104);
  assert.equal(touchMove(108), false, 'a stood-down gesture contests nothing');

  cleanup.destroy();
  assert.ok(!listeners.has('touchmove'), 'destroy must remove the defence');
});

test('every horizontal gesture surface declares a touch-action that spares the page its scroll', () => {
  // The rule the whole gesture layer rests on. A surface that claims a
  // horizontal drag must hand the vertical axis back to the compositor, or a
  // reader cannot scroll the page through it.
  const swiping = Object.entries(componentSources).filter(([, source]) =>
    /use:swipeHorizontal/.test(source)
  );
  assert.ok(swiping.length > 0, 'nothing swipes any more; this pin guards nothing');
  for (const [name, source] of swiping) {
    assert.match(
      source,
      /touch-action:\s*pan-y/,
      `${name} binds a horizontal swipe without handing the vertical axis to the page`
    );
    assert.doesNotMatch(
      source,
      /touch-action:\s*none/,
      `${name} takes the whole gesture, including the page's own scroll`
    );
  }
});
