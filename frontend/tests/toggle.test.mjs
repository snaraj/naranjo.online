import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createDisclosure,
  dismiss,
  focusLeft,
  outsidePress,
  pressBegan,
  swatchKeyTarget,
  triggerClick,
  triggerPointerDown,
} from '../src/lib/disclosure.ts';

// These tests EXECUTE the toggle's interaction state machine — the logic the
// PR-29 review's F1/F5 found untestable as source pins — by replaying the
// exact event orders the engines produce. DOM focus side effects stay
// outside this dependency-free runner and are covered by the source pins in
// experience.test.mjs; every open/close decision is exercised here for real.
//
// Engine difference driving every sequence: Blink focuses a clicked
// <button>, so a press inside the widget fires focusout with relatedTarget
// still inside; WebKit (iOS/macOS Safari) and Firefox-on-macOS never focus
// buttons on click, so the same press blurs to the page and focusout
// reports relatedTarget: null ("outside") BEFORE the click lands.

// tapTrigger replays one pointer activation of the trigger in a given
// engine's event order.
const tapTrigger = {
  blink: (state) => {
    triggerPointerDown(state);
    if (state.open) {
      focusLeft(state, true); // focusout: relatedTarget is the trigger, inside
    }
    return triggerClick(state);
  },
  webkit: (state) => {
    triggerPointerDown(state);
    if (state.open) {
      focusLeft(state, false); // focusout: relatedTarget null, "outside"
    }
    return triggerClick(state);
  },
};

// pressSwatch replays the pointerdown-and-focusout half of a pointer press
// on a swatch; whether the click half can land at all depends on the popover
// still being visible afterwards — exactly the F5 question.
const pressSwatch = {
  blink: (state) => {
    pressBegan(state);
    focusLeft(state, true); // focus moves onto the pressed swatch, inside
  },
  webkit: (state) => {
    pressBegan(state);
    focusLeft(state, false); // focus blurs to the page, relatedTarget null
  },
};

describe('theme toggle disclosure', () => {
  for (const engine of ['blink', 'webkit']) {
    it(`${engine}: trigger tap closes an open popover and stays closed`, () => {
      const state = createDisclosure();

      assert.equal(tapTrigger[engine](state), 'opened', 'first tap opens');
      assert.equal(state.open, true);

      // Review F1: on WebKit the pre-fix code reopened here. The tap that
      // began on an open popover must close it — and stay closed.
      assert.equal(tapTrigger[engine](state), 'closed', 'second tap closes');
      assert.equal(state.open, false, 'popover must not reopen after the dismissing tap');

      assert.equal(tapTrigger[engine](state), 'opened', 'a fresh tap reopens');
      assert.equal(state.open, true);
    });

    it(`${engine}: pointer selection completes — the popover survives its own swatch press`, () => {
      const state = createDisclosure();
      assert.equal(tapTrigger[engine](state), 'opened');

      // Review F5: the press's own focusout must not hide the popover, or
      // the swatch is display:none before mouseup and the click — the only
      // thing that applies the theme and cookie — never lands.
      pressSwatch[engine](state);
      assert.equal(state.open, true, 'popover hid before the swatch click could land (F5)');

      // The click now lands: the component applies the theme and dismisses.
      assert.equal(dismiss(state), true, 'the landing click closes the popover');
      assert.equal(state.open, false);

      assert.equal(tapTrigger[engine](state), 'opened', 'the toggle reopens after a selection');
    });

    it(`${engine}: keyboard activation right after a pointer dismissal opens`, () => {
      const state = createDisclosure();
      assert.equal(tapTrigger[engine](state), 'opened');
      assert.equal(tapTrigger[engine](state), 'closed');

      // Mutation survivor from the F2 round: if triggerClick did not consume
      // the pointer latch, this keyboard activation (no pointerdown) would
      // read the stale "began open" latch and close instead of opening.
      assert.equal(triggerClick(state), 'opened', 'a stale pointer latch ate the keyboard toggle');
      assert.equal(state.open, true);
    });

    it(`${engine}: outside press dismisses; the following focusout stays a no-op`, () => {
      const state = createDisclosure();
      assert.equal(tapTrigger[engine](state), 'opened');

      // A pointerdown outside the widget closes immediately — before any
      // focus movement — and the focusout it causes changes nothing.
      outsidePress(state);
      assert.equal(state.open, false, 'outside interaction must dismiss');
      focusLeft(state, false);
      assert.equal(state.open, false);

      assert.equal(tapTrigger[engine](state), 'opened', 'the next trigger tap opens normally');
    });
  }

  it('an armed press suppresses exactly one focusout; a later tab-out still dismisses', () => {
    const state = createDisclosure();
    assert.equal(tapTrigger.webkit(state), 'opened');

    pressBegan(state);
    focusLeft(state, false); // the press's own focusout: suppressed
    assert.equal(state.open, true);

    focusLeft(state, false); // a genuine focus departure afterwards
    assert.equal(state.open, false, 'suppression must be one-shot, never sticky');
  });

  it('an abandoned swatch press cannot wedge the popover open', () => {
    const state = createDisclosure();
    assert.equal(tapTrigger.webkit(state), 'opened');

    // Press a swatch, drag off, release outside: the suppressed focusout
    // leaves the popover open (like a native menu, drag-off cancels), and
    // the click never arrives — the next outside press must still dismiss.
    pressSwatch.webkit(state);
    assert.equal(state.open, true);
    outsidePress(state);
    assert.equal(state.open, false, 'outside press must dismiss even with focus already gone');

    assert.equal(tapTrigger.webkit(state), 'opened', 'the next tap opens normally');
  });

  it('an abandoned trigger press resolves on the next interactions', () => {
    const state = createDisclosure();
    assert.equal(tapTrigger.webkit(state), 'opened');

    // Pointer goes down on the trigger but the press is dragged away and
    // released elsewhere: its focusout was suppressed, the click never
    // arrives. Both dismissal paths must still work afterwards.
    triggerPointerDown(state);
    focusLeft(state, false);
    assert.equal(state.open, true, 'the in-flight press keeps the popover visible');

    outsidePress(state);
    assert.equal(state.open, false);
    assert.equal(tapTrigger.webkit(state), 'opened', 'the stale latch is superseded by the next tap');
    assert.equal(tapTrigger.webkit(state), 'closed', 'and the trigger still dismisses');
  });

  it('focus moving within the widget never dismisses', () => {
    const state = createDisclosure();
    assert.equal(tapTrigger.blink(state), 'opened');
    focusLeft(state, true); // trigger -> swatch, swatch -> swatch
    assert.equal(state.open, true);
  });

  it('keyboard activation toggles without a pointerdown latch', () => {
    const state = createDisclosure();
    // Enter/Space produce click without pointerdown: plain disclosure toggle.
    assert.equal(triggerClick(state), 'opened');
    assert.equal(state.open, true);
    assert.equal(triggerClick(state), 'closed');
    assert.equal(state.open, false);
  });

  it('escape dismisses exactly once and reports whether focus should return', () => {
    const state = createDisclosure();
    assert.equal(dismiss(state), false, 'escape on a closed toggle does nothing');
    assert.equal(tapTrigger.webkit(state), 'opened');
    assert.equal(dismiss(state), true, 'escape closes and asks for focus return');
    assert.equal(state.open, false);
    assert.equal(dismiss(state), false, 'a repeat dismissal is a no-op');
  });

  it('arrow keys wrap across the swatches; Home, End, and Escape resolve; Tab passes through', () => {
    const count = 3;
    assert.equal(swatchKeyTarget('ArrowRight', 0, count), 1);
    assert.equal(swatchKeyTarget('ArrowDown', 1, count), 2);
    assert.equal(swatchKeyTarget('ArrowRight', 2, count), 0, 'right wraps forward');
    assert.equal(swatchKeyTarget('ArrowLeft', 0, count), 2, 'left wraps backward');
    assert.equal(swatchKeyTarget('ArrowUp', 2, count), 1);
    assert.equal(swatchKeyTarget('Home', 2, count), 0);
    assert.equal(swatchKeyTarget('End', 0, count), 2);
    assert.equal(swatchKeyTarget('Escape', 1, count), 'dismiss');
    assert.equal(swatchKeyTarget('Tab', 1, count), null, 'Tab keeps its native order');
    assert.equal(swatchKeyTarget('Enter', 1, count), null);
  });
});
