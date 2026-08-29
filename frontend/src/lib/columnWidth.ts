// columnWidth.ts is the reader-controlled page width (owner directive,
// 2026-08-24: "give me very sleek and seamless ability to drag the feed in or
// out on its X axis"), extracted framework-free for the same reason
// disclosure.ts was — so the dependency-free runner can EXECUTE every decision
// the drag makes instead of pinning source text around it. The Svelte
// component owns DOM concerns only: which element was grabbed, where the
// pointer is, when to ask for a frame. Every number lands here.
//
// The other half of the directive is the half that needs the tests: "make sure
// that all objects stay responsive and that there is no way to break the
// website in an ugly way". Three separate things enforce that, and none of
// them is the other's excuse:
//
//   1. the browser clamps, in styles.css, where min-inline-size and
//      max-inline-size bracket the column against its two bound tokens and
//      against 100% of the space actually available;
//   2. this module clamps, below, before a single byte reaches a style
//      declaration;
//   3. nothing but a NUMBER this module produced ever reaches that
//      declaration — the value is constructed from a clamped float, never
//      concatenated from anything a reader, a script or a poisoned storage
//      entry supplied.
//
// The third is what makes stored state safe to trust. localStorage is
// attacker-writable in every threat model worth the name (a shared machine,
// another tab, a console paste), so the stored value is treated as hostile
// input: a strict decimal grammar, a finite check, and a clamp, in that order.
// Anything that fails the grammar lands on the shipped default. Anything that
// passes it is still bounded, because a number in range is not the same claim
// as a number that is safe.

// columnStorageKey names the reader's chosen width. The stored value is a
// BARE DECIMAL in rem — no unit, no JSON, no structure — because the narrowest
// grammar that can express the preference is also the one with the least room
// for anything else to hide in.
export const columnStorageKey = 'page-column-width';

// columnKeyStepRem is one arrow-key nudge, measured on the COLUMN rather than
// on the handle: the column is centred, so both edges move and each travels
// half of this. Two rem is a visible step without being a jump — twenty-five
// presses cross the whole range.
export const columnKeyStepRem = 2;

// ColumnSign says which way a handle's edge points: -1 for the one on the
// column's start side, +1 for the end side. It is DERIVED from where the
// handle actually rendered rather than declared, so the pair keeps working in
// a document laid out right-to-left, where the start edge is on the right and
// a hardcoded assumption would drag the column the wrong way.
export type ColumnSign = -1 | 1;

// ColumnTokens is the token layer as numbers: every value read from the
// stylesheet, in rem, plus the root font size the reader is browsing at.
// Nothing here is a literal in this file — the stylesheet declares each one
// exactly once and this is the reading of it.
export interface ColumnTokens {
  base: number;
  min: number;
  max: number;
  gutter: number;
  rail: number;
  rootFontPx: number;
}

// ColumnBounds is the floor and ceiling in force at one viewport width.
export interface ColumnBounds {
  min: number;
  max: number;
}

// ColumnHost is everything this module needs from a browser, as four
// operations. The seam exists so the whole apply path — token reading,
// clamping, the style write itself — runs under the dependency-free test
// runner against a hand-written fake that records every write. A path that
// could only be exercised in a browser is a path whose safety would rest on a
// screenshot.
export interface ColumnHost {
  // tokenValue returns a custom property's computed value, or '' when the
  // stylesheet has not loaded or the token does not exist.
  tokenValue(name: string): string;
  // rootFontPx is the reader's own base font size in CSS pixels.
  rootFontPx(): number;
  // viewportPx is the layout viewport width, scrollbar already excluded.
  viewportPx(): number;
  // write sets the column knob, or removes it when given null.
  write(value: string | null): void;
}

// ColumnStore is the persistence seam: localStorage's two methods and nothing
// else, so a fake is three lines and a test can hand back any hostile shape.
export interface ColumnStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// A bare decimal, optionally signed, and nothing else. Deliberately stricter
// than Number(): this grammar rejects '0x40' (which Number reads as 64),
// '1e400' (which it reads as Infinity), 'Infinity', whitespace-only strings
// (which it reads as 0) and every injection shape — 'url(...)',
// '60rem; background: ...' — before any of them can reach a clamp that might
// otherwise be persuaded to pass them through.
const storedColumnPattern = /^-?\d+(?:\.\d+)?$/;

// lengthRem converts one token value to rem, or null when it is not a length
// this module can read. Null is never treated as "probably fine": every caller
// turns it into the feature being absent, which leaves the page exactly as it
// renders without any of this.
export function lengthRem(value: string, rootFontPx: number): number | null {
  const trimmed = value.trim();
  const rem = /^(-?[\d.]+)rem$/.exec(trimmed);
  if (rem !== null) {
    const parsed = Number(rem[1]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const px = /^(-?[\d.]+)px$/.exec(trimmed);
  if (px !== null) {
    const parsed = Number(px[1]);
    return Number.isFinite(parsed) && rootFontPx > 0 ? parsed / rootFontPx : null;
  }
  return null;
}

// readColumnTokens reads the whole token layer, or returns null if ANY part of
// it is missing or unreadable. All or nothing on purpose: a partial reading
// would mean guessing one bound, and a guessed bound is exactly the thing the
// token layer exists to make impossible.
export function readColumnTokens(host: ColumnHost): ColumnTokens | null {
  const rootFontPx = host.rootFontPx();
  if (!Number.isFinite(rootFontPx) || rootFontPx <= 0) {
    return null;
  }
  const names = ['--page-column-base', '--page-column-min', '--page-column-max', '--page-gutter', '--page-rail-size'];
  const read = names.map((name) => lengthRem(host.tokenValue(name), rootFontPx));
  if (read.some((value) => value === null)) {
    return null;
  }
  const [base, min, max, gutter, rail] = read as number[];
  // A layer that says the floor is above the ceiling is a broken layer, not a
  // puzzle to solve at runtime.
  if (min > max) {
    return null;
  }
  return { base, min, max, gutter, rail, rootFontPx };
}

// railsBreakpointRem is the viewport width at which the rails first fit: the
// shipped column plus its two gutters plus its two hit lanes. It is COMPUTED
// from the tokens rather than written down, and the frontend suite compares it
// against the one media query in styles.css, so the two cannot drift.
export function railsBreakpointRem(tokens: ColumnTokens): number {
  return round(tokens.base + 2 * tokens.gutter + 2 * tokens.rail);
}

// railsMediaQuery builds the query the component listens to, from the same
// arithmetic, so the script and the stylesheet ask one question rather than
// two questions that agree today.
export function railsMediaQuery(tokens: ColumnTokens): string {
  return `(min-width: ${railsBreakpointRem(tokens)}rem)`;
}

// railsFit answers that question for a given viewport. Below it there are no
// handles and no stored width in force: the column is min(60rem, 100%), which
// is the phone rendering this page has always had.
export function railsFit(tokens: ColumnTokens, viewportPx: number): boolean {
  return viewportPx / tokens.rootFontPx >= railsBreakpointRem(tokens);
}

// columnBounds is the JS mirror of the stylesheet's own bracket. The ceiling
// is the smaller of the token maximum and the space the viewport can actually
// give — the same subtraction the media query makes, so a drag can never ask
// for a column the browser would then have to cap, and the page can never be
// made to scroll sideways.
//
// The floor is min()ed against that ceiling rather than taken flat: on a
// viewport too narrow for the minimum, a flat floor would return a column
// WIDER than the screen, which is the exact defect this function exists to
// prevent. Inverted bounds resolve toward the ceiling, always.
export function columnBounds(tokens: ColumnTokens, viewportPx: number): ColumnBounds {
  const available = viewportPx / tokens.rootFontPx - 2 * tokens.gutter - 2 * tokens.rail;
  const max = Math.min(tokens.max, available);
  return { min: Math.min(tokens.min, max), max };
}

// clampColumnRem brings any number inside the bounds. A value that is not a
// finite number is not clamped, it is refused — NaN survives every comparison
// operator, so Math.min/Math.max alone would hand NaN straight through to a
// style declaration and blank the column.
export function clampColumnRem(value: number, bounds: ColumnBounds): number {
  if (!Number.isFinite(value)) {
    return bounds.max;
  }
  return Math.min(Math.max(value, bounds.min), bounds.max);
}

// parseStoredColumnRem narrows an untrusted storage entry to a number, or null
// for every shape that is not one. Out-of-range but well-formed numbers pass
// here and are CLAMPED by the caller: the grammar's job is to keep foreign
// syntax out, the clamp's job is to keep the geometry sane, and conflating
// them would mean a bound change silently invalidating a reader's preference.
export function parseStoredColumnRem(raw: string | null): number | null {
  if (raw === null || !storedColumnPattern.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// columnWidthValue is the ONLY thing that ever becomes a style declaration,
// and it takes a NUMBER. That is the whole injection argument: there is no
// string path from storage, from a pointer event or from the DOM into the
// value the browser parses — the digits are produced by JavaScript's own
// number formatting from an already-clamped float, so a stored
// '60rem; background: url(...)' cannot survive as anything but a rejected
// parse. Three decimals is finer than a device pixel at any font size.
export function columnWidthValue(rem: number): string {
  return `${round(rem)}rem`;
}

// storedColumnValue is the same argument for the write to storage: a number in,
// a bare decimal out, so nothing this site persists can be read back as syntax.
export function storedColumnValue(rem: number): string {
  return String(round(rem));
}

// ColumnKeyIntent is what one keystroke means, resolved without a DOM.
export type ColumnKeyIntent =
  | { kind: 'delta'; rem: number }
  | { kind: 'jump'; to: 'min' | 'max' }
  | null;

// columnKeyIntent maps a key pressed on a handle to what it should do, per the
// WAI-ARIA Authoring Practices Window Splitter pattern: the arrows MOVE THE
// SPLITTER, and Home and End take the primary pane to its minimum and maximum.
//
// The sign is why this takes one: "left" is a direction in the window, not in
// the column. Moving the start handle left widens the column; moving the end
// handle left narrows it. A splitter that widened from both sides on the same
// key would be a control that lies about which way it is pointing.
export function columnKeyIntent(key: string, sign: ColumnSign): ColumnKeyIntent {
  switch (key) {
    case 'ArrowLeft':
      return { kind: 'delta', rem: -columnKeyStepRem * sign };
    case 'ArrowRight':
      return { kind: 'delta', rem: columnKeyStepRem * sign };
    case 'Home':
      return { kind: 'jump', to: 'min' };
    case 'End':
      return { kind: 'jump', to: 'max' };
    default:
      return null;
  }
}

// columnKeyWidth resolves an intent against the current width and bounds.
export function columnKeyWidth(intent: ColumnKeyIntent, current: number, bounds: ColumnBounds): number | null {
  if (intent === null) {
    return null;
  }
  if (intent.kind === 'jump') {
    return intent.to === 'min' ? bounds.min : bounds.max;
  }
  return clampColumnRem(current + intent.rem, bounds);
}

// columnSignFor derives a handle's sign from where it rendered. Measured, not
// assumed: the two handles are placed with logical properties, so in a
// right-to-left document they swap sides on their own and this follows them.
export function columnSignFor(handleCentrePx: number, viewportPx: number): ColumnSign {
  return handleCentrePx < viewportPx / 2 ? -1 : 1;
}

// ColumnDrag is one grab: which way the grabbed edge points, where the pointer
// was, and how wide the column was at that instant.
export interface ColumnDrag {
  sign: ColumnSign;
  pointerPx: number;
  widthRem: number;
}

// dragColumnRem is the width for a pointer that has travelled to pointerPx.
//
// The doubling is the geometry of a centred column, not a sensitivity setting:
// both edges move when the width changes, so a column that grows by two rem
// puts one rem on each side and the edge under the reader's finger has moved
// exactly one. Multiplying the travel by two is what makes the edge track the
// pointer one-for-one instead of drifting away from it at half speed.
//
// It is measured from the GRAB rather than from the centre, so grabbing
// anywhere in the 44px lane resizes from where the column already was — a
// press that snapped the edge to the finger would move the page before the
// reader had asked for anything.
export function dragColumnRem(drag: ColumnDrag, pointerPx: number, tokens: ColumnTokens, bounds: ColumnBounds): number {
  const travelled = (pointerPx - drag.pointerPx) / tokens.rootFontPx;
  return clampColumnRem(drag.widthRem + 2 * drag.sign * travelled, bounds);
}

// readStoredColumn reads the reader's preference, treating any storage failure
// as no preference. localStorage throws rather than returning null in several
// ordinary situations — a browser with site data disabled, a sandboxed frame,
// Safari's private mode under storage pressure — and none of them is a reason
// for a page not to render.
export function readStoredColumn(store: ColumnStore | null): number | null {
  if (store === null) {
    return null;
  }
  try {
    return parseStoredColumnRem(store.getItem(columnStorageKey));
  } catch {
    return null;
  }
}

// writeStoredColumn persists a width, and silently does nothing when it
// cannot. A preference that fails to save is a smaller problem than a page
// that throws while saving it.
export function writeStoredColumn(store: ColumnStore | null, rem: number): void {
  if (store === null) {
    return;
  }
  try {
    store.setItem(columnStorageKey, storedColumnValue(rem));
  } catch {
    /* Persistence is a convenience; the width already applied. */
  }
}

// applyStoredColumnWidth puts the reader's preference on the document, and is
// the whole of the pre-paint path.
//
// It returns the width now in force, or null when the feature is not in force
// at all — an unreadable token layer, or a viewport too narrow for the rails.
// The narrow case REMOVES any inline value rather than clamping it down,
// because below the breakpoint the correct column is the shipped
// min(60rem, 100%) that every phone has always had: a preference chosen on a
// monitor is not a preference about a phone, and applying a clamped version of
// it there would narrow a screen that was already exactly right.
export function applyStoredColumnWidth(host: ColumnHost, store: ColumnStore | null): number | null {
  const tokens = readColumnTokens(host);
  if (tokens === null) {
    return null;
  }
  const viewportPx = host.viewportPx();
  if (!railsFit(tokens, viewportPx)) {
    host.write(null);
    return null;
  }
  const stored = readStoredColumn(store);
  const bounds = columnBounds(tokens, viewportPx);
  const width = clampColumnRem(stored ?? tokens.base, bounds);
  host.write(columnWidthValue(width));
  return width;
}

// round keeps a value at three decimals — finer than a device pixel at any
// font size, and short of the range where JavaScript formats a number in
// exponential notation, which is not a length any browser would parse.
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// railsWatchFrames is how many frames the mount below will keep asking for
// the token layer before it stops asking. Tokens are unreadable at mount for
// exactly one reason — the stylesheet has not been applied yet — and that
// window is a frame or two on an idle machine and longer only under load, so
// two seconds at 60Hz is a budget with two orders of magnitude of headroom
// over the mechanism it is waiting for. It is a bound rather than an infinity
// because a document that genuinely carries no token layer must stop costing
// a callback per frame for as long as the tab is open; when the budget is
// spent, the component's resize listener remains as the durable recovery, and
// that is a real one because a viewport change is what re-reads everything.
export const railsWatchFrames = 120;

// RailsWatchDeps is the browser this mount needs, as three operations, for
// the same reason ColumnHost exists: a recovery path that could only be
// exercised in a browser is a recovery path whose existence would rest on a
// screenshot. It was exactly that, and issue 153 is what it cost.
export interface RailsWatchDeps {
  // media builds the live media-query object the sync listens to.
  media(query: string): {
    addEventListener(type: 'change', listener: () => void): void;
    removeEventListener(type: 'change', listener: () => void): void;
  };
  // schedule asks for the next animation frame and returns a cancel handle.
  schedule(run: () => void): number;
  // cancel drops a scheduled frame.
  cancel(handle: number): void;
}

/* watchRails is the whole mount sequence for the drag handles, and it is here
 * rather than in the component because of what it got wrong while it was
 * there (issue 153).
 *
 * The component used to read the token layer once at mount and RETURN when
 * the read came back null, registering no media-query listener at all. Null
 * is not a broken document — it is a document whose stylesheet has not been
 * applied to the root element yet, which under a contended machine happens
 * often enough that a full browser matrix caught it once in six runs: the
 * handles were simply absent, permanently, with nothing left running that
 * could ever bring them back. A viewport change would have recovered it, and
 * a reader who never resizes their window never gets one.
 *
 * So an unreadable read is now a RETRY rather than a surrender: ask again on
 * the next frame, up to the budget above, and register the listener the
 * moment the tokens arrive. The returned teardown is total — it cancels a
 * retry still pending as readily as it removes a listener already attached —
 * because a component that unmounts mid-retry must leave nothing behind. */
export function watchRails(
  host: ColumnHost,
  deps: RailsWatchDeps,
  onTokens: (tokens: ColumnTokens) => void,
  sync: () => void
): () => void {
  let frame = 0;
  let attempts = 0;
  let query: ReturnType<RailsWatchDeps['media']> | null = null;
  const attempt = (): void => {
    frame = 0;
    const read = readColumnTokens(host);
    if (read === null) {
      attempts += 1;
      if (attempts < railsWatchFrames) {
        frame = deps.schedule(attempt);
      }
      return;
    }
    onTokens(read);
    // The query is BUILT from the tokens, so the script and the stylesheet
    // ask one question. A literal here would be a second copy free to
    // disagree.
    query = deps.media(railsMediaQuery(read));
    query.addEventListener('change', sync);
    sync();
  };
  attempt();
  return () => {
    if (frame !== 0) {
      deps.cancel(frame);
      frame = 0;
    }
    if (query !== null) {
      query.removeEventListener('change', sync);
      query = null;
    }
  };
}

// frameDeps is the real browser behind the watch seam, beside documentHost
// below for the same reason: the DOM names live in one place.
export function frameDeps(): RailsWatchDeps {
  return {
    media: (query) => window.matchMedia(query),
    schedule: (run) => window.requestAnimationFrame(run),
    cancel: (handle) => window.cancelAnimationFrame(handle)
  };
}

// documentHost is the real browser behind the seam. It is the only place in
// this module that names a DOM API, which is what keeps everything above it
// executable without one.
export function documentHost(): ColumnHost {
  const root = document.documentElement;
  return {
    tokenValue: (name) => getComputedStyle(root).getPropertyValue(name),
    rootFontPx: () => Number.parseFloat(getComputedStyle(root).fontSize),
    viewportPx: () => root.clientWidth,
    write: (value) => {
      if (value === null) {
        root.style.removeProperty('--page-column-width');
        return;
      }
      root.style.setProperty('--page-column-width', value);
    }
  };
}

// browserStore is localStorage where it exists, and null everywhere it does
// not — including the environments where merely touching it throws.
export function browserStore(): ColumnStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
