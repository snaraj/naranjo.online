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
