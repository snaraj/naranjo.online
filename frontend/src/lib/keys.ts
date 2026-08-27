/* The keyboard grammar every COMPOSITE widget on this page shares: which
 * presses belong to a widget at all, and where a ring of options moves when
 * one of them lands. Kept out of the components for the reason lib/tooltip.ts
 * and lib/gesture.ts keep their arithmetic out — it is then executable by the
 * unit suite rather than pattern-matched out of markup — and kept in ONE
 * module because the alternative is what shipped: three widgets, three
 * hand-written key tables, and a defect that had to be found three times.
 *
 * WHY A CHORD IS NEVER OURS. A key table that branches on `event.key` alone
 * cannot tell `ArrowLeft` from `Cmd+ArrowLeft`, and the second one is the
 * browser's Back. So is `Alt+ArrowLeft`; `Ctrl+Home` is top-of-document, and
 * on every platform some further chord is the window manager's. A widget that
 * swallows those has not added a shortcut, it has removed the reader's. This
 * was measured on this page's own controls: `defaultPrevented === true` for
 * `Cmd+ArrowLeft`, `Alt+ArrowLeft` and `Ctrl+Home` on both the grid strip and
 * the token panel's segmented pills (2026-08-27).
 *
 * Shift is deliberately NOT in that list. It is a MODIFIER OF the widget's own
 * key rather than a chord addressed elsewhere — range extension in a listbox,
 * reverse traversal in a toolbar — so a widget that handles it handles its own
 * key, and one that does not simply moves the cursor. Neither steals anything
 * from the reader.
 *
 * Both helpers take plain data rather than DOM types, so the suite executes
 * them with object literals and this module imports nothing. */

/* A press addressed to the browser or the operating system rather than to the
 * widget under it. The caller returns without acting AND without preventing
 * the default, which is the whole point: swallowing it silently is exactly
 * how a widget breaks Back. */
export function isChord(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return event.altKey || event.ctrlKey || event.metaKey;
}

/* Where a key press moves a cursor around a ring of `count` options, or null
 * for a key this widget leaves alone (Tab keeps its native order, and every
 * unhandled key must reach the page).
 *
 * The ring WRAPS in both directions, because a segmented control, a radio
 * group and a row of position dots are rings in every platform toolkit;
 * Home and End are the ends rather than steps.
 *
 * A cursor that is not ON the ring — `at` of -1, which is what indexOf
 * answers for a current value the options do not contain, and what a stale
 * lens produces — enters at the end the reader is heading for: the first
 * option going forward, the last going back. That is stated rather than left
 * to the modular arithmetic, which quietly answers count-2 for a backward
 * step from -1 and would drop such a reader one short of the end.
 *
 * A ring with nothing on it answers null rather than an index no element
 * has. */
export function ringTarget(key: string, at: number, count: number): number | null {
  if (count <= 0) {
    return null;
  }
  const off = at < 0 || at >= count;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return off ? 0 : (at + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return off ? count - 1 : (at - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
