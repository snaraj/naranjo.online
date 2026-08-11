// disclosure.ts is the theme toggle's open/close state machine, extracted
// framework-free so the dependency-free test runner can execute the full
// interaction cycle — open, select, dismiss, reopen — instead of pinning
// source text. The Svelte component owns only DOM concerns (rendering, focus
// movement, reading relatedTarget); every state decision lives here.
//
// The shape exists because engines disagree about button focus. Blink
// focuses a clicked <button>, so while the popover is open a trigger click
// arrives as: pointerdown -> focusout(relatedTarget: trigger) -> click.
// WebKit (iOS and macOS Safari) and Firefox on macOS do NOT focus buttons on
// click, so the same tap arrives as: pointerdown -> focusout(relatedTarget:
// null) -> click — the focusout dismissal has already closed the popover,
// and a naive click toggle would REOPEN it, making the trigger unable to
// dismiss (review F1 on the swatch-toggle PR). The fix: pointerdown latches
// whether the popover was open BEFORE any focusout can run, and the click
// consumes that latch, closing-and-staying-closed on every engine.

// Disclosure is the toggle's complete interaction state.
export interface Disclosure {
  // open mirrors whether the popover is rendered visible.
  open: boolean;
  // pointerDownWasOpen latches, at pointerdown on the trigger, whether the
  // popover was open at that instant — the pre-focusout truth the click
  // handler must act on.
  pointerDownWasOpen: boolean;
}

// createDisclosure returns the initial closed state.
export function createDisclosure(): Disclosure {
  return { open: false, pointerDownWasOpen: false };
}

// triggerPointerDown records whether the popover was open when the pointer
// went down on the trigger. It runs before any engine's focusout can close
// the popover, which is the whole point.
export function triggerPointerDown(state: Disclosure): void {
  state.pointerDownWasOpen = state.open;
}

// TriggerClickResult tells the component what a trigger activation did:
// 'opened' means the popover just opened and focus should move into it.
export type TriggerClickResult = 'opened' | 'closed';

// triggerClick resolves a trigger activation. A pointer press that began on
// an open popover closes it regardless of what focusout did in between —
// Blink arrives here still open, WebKit already closed — so the trigger
// always dismisses. Keyboard activation never sees a pointerdown, so it
// falls through to a plain toggle.
export function triggerClick(state: Disclosure): TriggerClickResult {
  const beganOpen = state.pointerDownWasOpen;
  state.pointerDownWasOpen = false;
  if (beganOpen) {
    state.open = false;
    return 'closed';
  }
  state.open = !state.open;
  return state.open ? 'opened' : 'closed';
}

// focusLeft handles a focusout: when focus has genuinely left the widget
// (tab-out, or a click that moved focus elsewhere) the popover dismisses
// without stealing focus back. The pointerdown latch is deliberately NOT
// cleared — on WebKit this dismissal runs mid-trigger-click, and the click
// still needs the latch to know it must not reopen.
export function focusLeft(state: Disclosure, focusStillInside: boolean): void {
  if (!focusStillInside) {
    state.open = false;
  }
}

// dismiss closes an open popover (Escape, or a swatch selection) and reports
// whether it was open, so the caller returns focus to the trigger only when
// something actually closed.
export function dismiss(state: Disclosure): boolean {
  if (!state.open) {
    return false;
  }
  state.open = false;
  return true;
}

// swatchKeyTarget maps a key pressed on swatch index (of count) to the next
// index to focus, 'dismiss' for Escape, or null for keys this widget leaves
// alone (Tab keeps its native order). Arrows wrap in both directions.
export function swatchKeyTarget(key: string, index: number, count: number): number | 'dismiss' | null {
  switch (key) {
    case 'Escape':
      return 'dismiss';
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
