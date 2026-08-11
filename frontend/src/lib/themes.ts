// themes.ts is the reading-mode registry (issue #22): the named color schemes
// a visitor can choose, wiki-style. Adding a theme = one entry here + one
// [data-theme] block in styles.css + one id in readingThemes
// (internal/server/types.go). The three lists are hand-duplicated on purpose
// — no shared code crosses the Go/TypeScript boundary — and the parity tests
// on both sides pin them against each other.

// ThemeId is a registered reading-mode identifier — exactly the values the
// origin precomputes document variants for and accepts in the theme cookie.
export type ThemeId = 'light' | 'dark' | 'sepia';

// Theme names one reading mode for the toggle menu.
export interface Theme {
  id: ThemeId;
  label: string;
}

// themes lists every reading mode in menu order.
export const themes: readonly Theme[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'sepia', label: 'Sepia' }
];

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

// applyTheme swaps the mode instantly — same stylesheet, different
// custom-property values, so no reload, no layout shift, no asset refetch —
// and persists the choice in the cookie the origin reads to stamp every
// future document (zero flash without any inline script). The attribute
// values are literal so the exact cookie grammar is testable: first-party
// only, whole site, kept for 365 days.
export function applyTheme(id: ThemeId): void {
  document.documentElement.setAttribute('data-theme', id);
  document.cookie = 'theme=' + id + '; path=/; max-age=31536000; samesite=lax';
}
