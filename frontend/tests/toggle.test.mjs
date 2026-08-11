import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createDisclosure,
  dismiss,
  focusLeft,
  swatchKeyTarget,
  triggerClick,
  triggerPointerDown,
} from '../src/lib/disclosure.ts';

// These tests EXECUTE the toggle's interaction state machine — the logic the
// PR-29 review's F1 found untestable as source pins — by replaying the exact
// event orders the engines produce. DOM focus side effects stay outside this
// dependency-free runner and are covered by the source pins in
// experience.test.mjs; every open/close decision is exercised here for real.

// tapTrigger replays one pointer activation of the trigger in a given
// engine's event order. Blink focuses a clicked button, so while the popover
// is open the intervening focusout keeps focus inside the widget; WebKit and
// Firefox-on-macOS do not focus buttons on click, so their focusout reports
// focus leaving (relatedTarget: null) before the click lands.
const engines = {
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

describe('theme toggle disclosure', () => {
  for (const [engine, tapTrigger] of Object.entries(engines)) {
    it(`${engine}: trigger tap closes an open popover and stays closed`, () => {
      const state = createDisclosure();

      assert.equal(tapTrigger(state), 'opened', 'first tap opens');
      assert.equal(state.open, true);

      // Review F1: on WebKit the pre-fix code reopened here. The tap that
      // began on an open popover must close it — and stay closed.
      assert.equal(tapTrigger(state), 'closed', 'second tap closes');
      assert.equal(state.open, false, 'popover must not reopen after the dismissing tap');

      assert.equal(tapTrigger(state), 'opened', 'a fresh tap reopens');
      assert.equal(state.open, true);
    });

    it(`${engine}: full cycle — open, select a swatch, reopen`, () => {
      const state = createDisclosure();
      assert.equal(tapTrigger(state), 'opened');

      // Selecting a swatch dismisses (the component applies the theme and
      // returns focus only because this reports it was open).
      assert.equal(dismiss(state), true, 'selection closes the open popover');
      assert.equal(state.open, false);
      assert.equal(dismiss(state), false, 'a repeat dismissal is a no-op');

      assert.equal(tapTrigger(state), 'opened', 'the toggle reopens after a selection');
    });

    it(`${engine}: outside interaction dismisses without wedging the trigger`, () => {
      const state = createDisclosure();
      assert.equal(tapTrigger(state), 'opened');

      // A click or tab that moves focus out of the widget entirely.
      focusLeft(state, false);
      assert.equal(state.open, false, 'focus leaving the widget dismisses');

      assert.equal(tapTrigger(state), 'opened', 'the next trigger tap opens normally');
    });
  }

  it('focus moving within the widget never dismisses', () => {
    const state = createDisclosure();
    assert.equal(engines.blink(state), 'opened');
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
    assert.equal(engines.webkit(state), 'opened');
    assert.equal(dismiss(state), true, 'escape closes and asks for focus return');
    assert.equal(state.open, false);
  });

  it('an abandoned press (pointerdown, no click) cannot corrupt the next tap', () => {
    const state = createDisclosure();
    assert.equal(engines.webkit(state), 'opened');

    // Pointer goes down on the trigger but the press is dragged away and
    // released elsewhere: focusout dismisses, the click never arrives.
    triggerPointerDown(state);
    focusLeft(state, false);
    assert.equal(state.open, false);

    // The stale latch must be superseded by the next real tap's pointerdown.
    assert.equal(engines.webkit(state), 'opened', 'the next tap opens normally');
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
