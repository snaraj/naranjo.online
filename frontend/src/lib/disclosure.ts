// disclosure.ts is the theme toggle's open/close state machine, extracted
// framework-free so the dependency-free test runner can execute the full
// interaction cycle — open, select, dismiss, reopen — instead of pinning
// source text. The Svelte component owns only DOM concerns (rendering, focus
// movement, reading relatedTarget and event targets); every state decision
// lives here.
//
// The shape exists because engines disagree about button focus. Blink
// focuses a clicked <button>; WebKit (iOS and macOS Safari) and Firefox on
// macOS do not, so any press on one of our buttons blurs whatever holds
// focus and the widget's focusout fires with relatedTarget: null BEFORE the
// press's click can land. Treating that focusout as "focus left, hide" broke
// the toggle twice on WebKit:
//   - review F1: a trigger press while open hid the popover at focusout and
//     the click then toggled the closed state straight back open — the
//     trigger could never dismiss;
//   - review F5: a swatch press hid the popover at focusout, so the click
//     never landed on the (now display:none) swatch and pointer users could
//     never select a theme.
// The generalized fix: any pointerdown inside the widget marks a press in
// flight, and one focusout may be suppressed by it — the popover stays
// visible until the press resolves as a click (which selects or toggles) or
// is abandoned. Because a suppressed focusout means focus has genuinely
// left, dismissal-by-focus can no longer be the only closer: an outside
// pointerdown always dismisses, focus or no focus.

import { ringTarget } from './keys.ts';

// Disclosure is the toggle's complete interaction state.
export interface Disclosure {
  // open mirrors whether the popover is rendered visible.
  open: boolean;
  // pointerDownWasOpen latches, at pointerdown on the trigger, whether the
  // popover was open at that instant — the pre-focusout truth the trigger's
  // click handler must act on (F1).
  pointerDownWasOpen: boolean;
  // pressInFlight is true from a pointerdown inside the widget until the
  // press resolves (its click, its focusout suppression, or an outside
  // press). While set, one focusout may not hide the popover, so the
  // pressed button is still there when the click arrives (F5).
  pressInFlight: boolean;
}

// createDisclosure returns the initial closed state.
export function createDisclosure(): Disclosure {
  return { open: false, pointerDownWasOpen: false, pressInFlight: false };
}

// triggerPointerDown records a press beginning on the trigger: it is a press
// in flight like any other, and it additionally latches whether the popover
// was open at that instant. Both run before any engine's focusout.
export function triggerPointerDown(state: Disclosure): void {
  state.pressInFlight = true;
  state.pointerDownWasOpen = state.open;
}

// pressBegan records a press beginning inside the popover (a swatch). The
// suppression it arms is what lets the swatch survive until its click.
export function pressBegan(state: Disclosure): void {
  state.pressInFlight = true;
}

// TriggerClickResult tells the component what a trigger activation did:
// 'opened' means the popover just opened and focus should move into it.
export type TriggerClickResult = 'opened' | 'closed';

// triggerClick resolves a trigger activation. A pointer press that began on
// an open popover closes it regardless of what focusout did in between —
// Blink arrives here still open, WebKit already suppressed — so the trigger
// always dismisses. Keyboard activation never sees a pointerdown, so it
// falls through to a plain toggle. Both latches are consumed: a stale
// pointer latch must never eat a later keyboard activation.
export function triggerClick(state: Disclosure): TriggerClickResult {
  const beganOpen = state.pointerDownWasOpen;
  state.pointerDownWasOpen = false;
  state.pressInFlight = false;
  if (beganOpen) {
    state.open = false;
    return 'closed';
  }
  state.open = !state.open;
  return state.open ? 'opened' : 'closed';
}

// focusLeft handles a focusout. When focus has genuinely left the widget the
// popover dismisses without stealing focus back — UNLESS a press inside the
// widget is in flight, because on WebKit that focusout is the press itself
// (buttons never take focus there) and hiding now would destroy the click
// target. Each focusout consumes at most one suppression, so an armed press
// can never mute a later, genuine tab-out.
export function focusLeft(state: Disclosure, focusStillInside: boolean): void {
  const pressed = state.pressInFlight;
  state.pressInFlight = false;
  if (focusStillInside || pressed) {
    return;
  }
  state.open = false;
}

// outsidePress dismisses on any pointerdown outside the widget. It does not
// depend on focus, which matters after a suppressed focusout or an abandoned
// press has already moved focus to the page: outside interaction must still
// close the popover.
export function outsidePress(state: Disclosure): void {
  state.open = false;
  state.pressInFlight = false;
}

// dismiss closes an open popover (Escape, or a swatch selection) and reports
// whether it was open, so the caller returns focus to the trigger only when
// something actually closed. It resolves any in-flight press: selection IS
// the press's click landing.
export function dismiss(state: Disclosure): boolean {
  state.pressInFlight = false;
  if (!state.open) {
    return false;
  }
  state.open = false;
  return true;
}

// swatchKeyTarget maps a key pressed on swatch index (of count) to the next
// index to focus, 'dismiss' for Escape, or null for keys this widget leaves
// alone (Tab keeps its native order). Arrows wrap in both directions.
//
// The ring itself is lib/keys.ts's, shared with the token panel's segmented
// pills and the gallery's position dots (issue 219 review round 2). This
// widget's ONE difference from those is Escape, which closes a popover and
// means nothing to a control that is always on screen — so that is the one
// case stated here, and the movement arithmetic exists once for all three
// rather than in three hand-written key tables free to disagree.
export function swatchKeyTarget(key: string, index: number, count: number): number | 'dismiss' | null {
  return key === 'Escape' ? 'dismiss' : ringTarget(key, index, count);
}
