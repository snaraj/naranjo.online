// The colour the browser's own chrome is told to wear (owner directive,
// 2026-09-04, issue 294: on a phone the toolbars sat in their own grey above
// the page, and the join read as a second bar). The sheet is the night's on
// every visit (owner, 2026-10-19), so the shell calls syncThemeColor once the
// phase is written at hydration, and again if a phase is ever written anew.

// themeColorToken is the one token the browser's chrome wears: the sheet.
// Named once here so the meta and the stylesheet cannot disagree about which
// surface "the page's colour" means.
export const themeColorToken = '--color-surface';

// syncThemeColor tells the browser's chrome the sheet's colour. The value is
// READ from the live document — the computed sheet token — never written
// here, so every palette hex stays stated exactly once, in the stylesheet.
// The meta is created on first use, because the static shell carries none: a
// hex in index.html would be a second copy of a token.
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
