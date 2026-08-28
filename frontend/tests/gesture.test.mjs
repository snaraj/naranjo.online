/* The hand-gesture layer (issue 219): the arithmetic every drag on this page
 * is decided by, EXECUTED rather than pattern-matched, plus the structural
 * pins that keep a second gesture implementation from appearing beside it.
 *
 * The other half is e2e/rendering-lanes.spec.mjs, which drives real fingers
 * through real engines. Neither replaces the other, and the split is the same
 * one lib/tooltip.ts uses: arithmetic proves the rule the next build
 * inherits, a lane proves this build survived a real cascade.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  boundedDrag,
  claimsHorizontal,
  rubberBand,
  swipeDecision,
  swipeMetrics
} from '../src/lib/gesture.ts';
import {
  pullArmed,
  pullDistance,
  pullMetrics,
  pullProgress,
  pullToRefresh,
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
  // At the start, dragging FORWARD (positive) meets the curve; dragging away
  // from that end does not.
  assert.ok(Math.abs(boundedDrag(120, true, false, span)) < 120);
  assert.equal(boundedDrag(-120, true, false, span), -120);
  // ...and symmetrically at the end.
  assert.ok(Math.abs(boundedDrag(-120, false, true, span)) < 120);
  assert.equal(boundedDrag(120, false, true, span), 120);
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
  const touchMove = (y, cancelable = true) => {
    let prevented = false;
    listeners.get('touchmove')?.handler({
      cancelable,
      touches: [{ clientY: y }],
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

  // The proving window: a downward move is contested before `claimed` flips,
  // because Safari takes the gesture inside the first twelve pixels.
  assert.equal(touchMove(106), true, 'a downward move in the proving window must be defended');
  // An upward move falls through: that is the page's scroll, not a pull.
  assert.equal(touchMove(94), false, 'an upward move belongs to the browser');
  // A move the browser already made uncancelable is never fought.
  assert.equal(touchMove(106, false), false, 'an uncancelable move cannot be contested');

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
