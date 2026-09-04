// themes.ts is the reading-mode registry (issue #22): the named color schemes
// a visitor can choose, wiki-style. Adding a theme = one entry here + one
// [data-theme] block in styles.css + one id in readingThemes
// (internal/server/types.go). The three lists are hand-duplicated on purpose
// — no shared code crosses the Go/TypeScript boundary — and the parity tests
// on both sides pin them against each other.

// ThemeId is a registered reading-mode identifier — exactly the values the
// origin precomputes document variants for and accepts in the theme cookie.
//
// Four modes, one light and three dark, and the three darks are told apart by
// temperature rather than by depth: dark is neutral, slate is cool, sepia is
// warm. `dark` is the neutral near-black one — the mode a visitor whose
// device asks for dark also receives, since prefers-color-scheme maps this
// palette — and `slate` holds the desaturated navy that used to answer to
// that name, kept as a mode of its own so nobody who liked it loses it.
export type ThemeId = 'light' | 'dark' | 'slate' | 'sepia';

// Theme names one reading mode for the toggle menu.
export interface Theme {
  id: ThemeId;
  label: string;
}

// themes lists every reading mode in menu order.
export const themes: readonly Theme[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'slate', label: 'Slate' },
  { id: 'sepia', label: 'Sepia' }
];

// autoMode is the choice of NOT choosing: the visitor hands the decision back
// to the operating system. It is deliberately not a ThemeId, because the
// origin precomputes no document for it — "auto" is the unstamped default
// document, whose tokens follow prefers-color-scheme. Modelling it as a
// fourth stamped theme would mean a [data-theme="auto"] block that had to
// restate the whole media query, and a Go variant that could never be
// correct for two visitors with different OS settings.
export const autoMode = 'auto';

// ModeId is what the toggle offers: every reading mode plus auto.
export type ModeId = ThemeId | typeof autoMode;

// Mode names one toggle choice.
export interface Mode {
  id: ModeId;
  label: string;
}

// modes is the toggle's menu, derived from the registry so a theme added
// above appears here automatically and the two can never disagree. Auto
// leads: it is where every visitor starts, so it is the way back.
export const modes: readonly Mode[] = [{ id: autoMode, label: 'Auto' }, ...themes];

// isThemeId narrows an untrusted string (the data-theme attribute) to a
// registered reading mode; anything else is treated as no explicit choice.
export function isThemeId(value: string | null): value is ThemeId {
  return themes.some((theme) => theme.id === value);
}

// documentTheme reads the explicit choice the origin stamped on <html>, or
// null when the visitor has never chosen (the default document is unstamped
// and follows prefers-color-scheme).
export function documentTheme(): ThemeId | null {
  const stamped = document.documentElement.getAttribute('data-theme');
  return isThemeId(stamped) ? stamped : null;
}

// documentMode reads the same stamp as a toggle choice: an unstamped
// document is not "nothing selected", it is auto selected. Without this the
// menu would open with no swatch pressed for the state every visitor starts
// in, and auto would look like an option nobody was ever on.
export function documentMode(): ModeId {
  return documentTheme() ?? autoMode;
}

// applyMode swaps the mode instantly — same stylesheet, different
// custom-property values, so no reload, no layout shift, no asset refetch —
// and persists the choice in the cookie the origin reads to stamp every
// future document (zero flash without any inline script). The attribute
// values are literal so the exact cookie grammar is testable: first-party
// only, whole site, kept for 365 days.
//
// Auto is the inverse of a choice and is applied as one: the attribute is
// removed so the live document falls back to the prefers-color-scheme
// mapping, and the cookie is EXPIRED rather than set to a value, so the
// origin serves the unstamped default document from the next navigation on.
// Any leftover value would keep answering with a stamped variant forever.
export function applyMode(id: ModeId): void {
  if (id === autoMode) {
    document.documentElement.removeAttribute('data-theme');
    document.cookie = 'theme=; path=/; max-age=0; samesite=lax';
  } else {
    document.documentElement.setAttribute('data-theme', id);
    document.cookie = 'theme=' + id + '; path=/; max-age=31536000; samesite=lax';
  }
  syncThemeColor();
}

// themeColorToken is the one token the browser's own chrome is told to wear:
// the sheet. Named once here so the meta and the stylesheet cannot disagree
// about which surface "the page's colour" means.
export const themeColorToken = '--color-surface';

// syncThemeColor tells the browser's chrome the sheet's colour (owner
// directive, 2026-09-04, issue 294: on a phone the toolbars sat in their own
// grey above a paper or ink page, and the join read as a second bar). The
// value is READ from the live document — the computed sheet token — never
// written here, so every palette hex stays stated exactly once, in the
// stylesheet, and a mode added there reaches the toolbars with no edit here.
// The meta is created on first use, because the static shell carries none: a
// hex in index.html would be a second copy of a token.
// Called after every mode change, and by the shell whenever the OS scheme
// flips under auto, which is the other way the sheet's colour changes.
export function syncThemeColor(): void {
  const surface = getComputedStyle(document.documentElement).getPropertyValue(themeColorToken).trim();
  if (surface === '') {
    return;
  }
  let meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta === null) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
  }
  meta.content = surface;
}
