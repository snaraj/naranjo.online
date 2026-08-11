import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [fallback, component, styles, themeRegistry, themeMenu] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/themes.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/ThemeMenu.svelte', import.meta.url), 'utf8'),
]);

// Browser execution is deliberately outside this dependency-free test. These
// assertions keep the accessible, responsive first response intact even when
// JavaScript is slow, unavailable, or rejected by a visitor's policy.
test('static and hydrated shells preserve the same accessible identity', () => {
  assert.match(fallback, /<html lang="en">/);
  assert.match(fallback, /name="viewport"/);
  assert.match(fallback, /data-static-fallback/);
  assert.match(fallback, /<main aria-labelledby="static-page-title"/);
  // Structure, never copy: each shell must render a non-empty labelling
  // heading, but the text itself is temporary placeholder content and will be
  // replaced by the real site — it is deliberately not a contract.
  assert.match(fallback, /<h1 id="static-page-title">[^<]+<\/h1>/);
  assert.match(component, /<svelte:head>/);
  assert.match(component, /name="description"/);
  assert.match(component, /<main aria-labelledby="page-title">/);
  assert.match(component, /<h1 id="page-title">[^<]+<\/h1>/);
});

test('initial source remains local and viewport-responsive', () => {
  for (const [name, source] of Object.entries({ fallback, component, styles })) {
    assert.doesNotMatch(source, /(?:https?:)?\/\//, `${name} introduces a remote origin`);
  }
  assert.match(styles, /font-size:\s*clamp\(/);
  assert.match(styles, /min-height:\s*100vh/);
  // Deliberate reading-modes change (issue #22): light is now the :root
  // default palette, so the media query maps the DARK tokens in — and only
  // for documents without an explicit stamped choice.
  assert.match(styles, /@media \(prefers-color-scheme: dark\)/);
  assert.match(styles, /:root:not\(\[data-theme\]\)/);
});

// occurrences counts literal appearances of needle in source, for the
// palette-deduplication pins below.
const occurrences = (source, needle) => source.split(needle).length - 1;

// Reading modes (issue #22): the stylesheet is a custom-property token layer.
// Light is the default :root palette; each further mode is one override block
// scoped by the data-theme attribute the origin stamps on <html>. The colors
// themselves are placeholder palettes and deliberately not pinned — except
// sepia's browntown seed, which the issue fixes until the owner repaints.
test('reading modes: a token layer with attribute-scoped theme blocks', () => {
  // The default document ships unstamped: stamping data-theme is the
  // origin's job (cookie-selected precomputed variants), never the source's.
  assert.doesNotMatch(fallback, /data-theme/);

  // Light tokens are the :root defaults and declare their color-scheme.
  assert.match(styles, /:root\s*\{[^}]*color-scheme:\s*light/);
  assert.match(styles, /:root\s*\{[^}]*--color-surface:/);
  assert.match(styles, /:root\s*\{[^}]*--color-text:/);

  // Rendered colors come from tokens, never from a second hardcoded copy.
  assert.match(styles, /color:\s*var\(--color-text\)/);
  assert.match(styles, /background:\s*var\(--color-surface\)/);

  // Each explicit mode is one attribute-scoped block with its color-scheme,
  // remapping the active tokens onto its palette by reference only.
  for (const theme of ['dark', 'sepia']) {
    assert.match(
      styles,
      new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{[^}]*color-scheme:\\s*dark`),
      `theme block for ${theme} must set its color-scheme`
    );
    assert.match(
      styles,
      new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{[^}]*--color-surface:\\s*var\\(--palette-${theme}-surface\\)`),
      `theme block for ${theme} must remap tokens onto its palette, never restate values`
    );
  }
  assert.match(
    styles,
    /prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme\]\)\s*\{[^}]*var\(--palette-dark-/,
    'the media query must remap onto the dark palette, never restate values'
  );

  // Palette deduplication (review finding): every palette value is written
  // exactly once, as a --palette-* definition; theme blocks and components
  // only reference. The two anchor hexes appear exactly twice because
  // light's text is dark's surface and vice versa — one occurrence per
  // palette slot, still zero per consumer.
  const uniqueValues = [
    '#efefe8', '#e6e6dd', '#d8d8cd', '#9a9a8e', '#3d434f', // light ramp
    '#161a23', '#1d222d', '#2a3040', '#566078', '#b9c2d4', // dark ramp
    '#1b1612', '#28221d', '#312a25', '#3e362f', '#736559', '#b79d7e', '#f4eaea', // browntown seeds
  ];
  for (const value of uniqueValues) {
    assert.equal(occurrences(styles, value), 1, `${value} must be defined exactly once`);
  }
  for (const anchor of ['#f7f7f2', '#10131a']) {
    assert.equal(occurrences(styles, anchor), 2, `anchor ${anchor} fills exactly two palette slots`);
  }

  // Structural closure of the dedup pin (review F2): the enumerated counts
  // above cannot see a NEW hex duplicated elsewhere, so additionally no hex
  // may exist outside the :root palette block at all.
  const rootBlock = styles.match(/:root\s*\{[^}]*\}/)?.[0];
  assert.ok(rootBlock, 'styles must open with the :root palette block');
  assert.doesNotMatch(
    styles.replace(rootBlock, ''),
    /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z])/,
    'every hex must live inside the :root palette block; elsewhere, reference tokens'
  );
});

// The registry and toggle are the client half of the wiki mechanism: named
// modes, an instant data-theme swap, and the cookie the origin stamps future
// documents from. The id list mirrors readingThemes in
// internal/server/types.go — update both in the same change (the Go parity
// test names this file from its side).
test('theme registry and toggle: named modes, exact cookie grammar, local only', () => {
  for (const source of [themeRegistry, themeMenu]) {
    assert.doesNotMatch(source, /https?:\/\//, 'theme sources must stay local-origin');
  }

  // Exactly the three registered modes, each carrying a visible name.
  for (const id of ['light', 'dark', 'sepia']) {
    assert.match(themeRegistry, new RegExp(`id: '${id}', label: '[^']+'`), `registry lacks ${id}`);
  }

  // The swap is instant and attribute-based; persistence is the exact cookie
  // the origin parses: whole-site path, 365 days, SameSite=Lax.
  assert.match(themeRegistry, /setAttribute\('data-theme', id\)/);
  assert.match(themeRegistry, /'theme=' \+ id \+ '; path=\/; max-age=31536000; samesite=lax'/);
});

// The toggle is the wiki's, minimally: a labeled moon button opening a
// popover of one swatch per mode, each swatch's background being that
// theme's OWN page-surface token, with an inline-SVG glyph — sun on light,
// cratered moon on dark, plain moon on sepia. No icon assets, no hex copies.
// These pins cover DOM wiring only; the open/select/close/reopen behavior is
// EXECUTED against src/lib/disclosure.ts in toggle.test.mjs.
test('theme toggle: swatch popover, token-pure colors, machine-wired', () => {
  // Trigger: a labeled plain-disclosure button with an inline moon glyph.
  // Deliberately NO aria-haspopup: it would announce a menu, but the popover
  // is a group of pressed-state buttons (review F4).
  assert.match(themeMenu, /aria-label="Reading mode"/);
  assert.doesNotMatch(themeMenu, /aria-haspopup=/, 'plain disclosure only: no haspopup attribute');
  assert.match(themeMenu, /aria-expanded=\{disclosure\.open\}/);
  assert.match(themeMenu, /aria-controls="reading-mode-menu"/);
  assert.match(themeMenu, /<svg[^>]*aria-hidden="true"/);

  // Popover: every registry entry becomes a named swatch button carrying
  // pressed semantics for the current choice.
  assert.match(themeMenu, /\{#each themes as theme \(theme\.id\)\}/);
  assert.match(themeMenu, /aria-label=\{theme\.label\}/);
  assert.match(themeMenu, /aria-pressed=\{selected === theme\.id\}/);

  // Swatch colors are references into each theme's own palette tokens —
  // never a third copy of the values (see the dedup pins above) and never a
  // hex anywhere in the component.
  for (const id of ['light', 'dark', 'sepia']) {
    assert.match(
      themeMenu,
      new RegExp(`background:\\s*var\\(--palette-${id}-surface\\)`),
      `the ${id} swatch background must be that theme's own surface token`
    );
  }
  // The sepia glyph clears WCAG 1.4.11 with margin by mixing two sepia
  // tokens — still no restated value (review F4).
  assert.match(themeMenu, /color-mix\(in srgb, var\(--palette-sepia-border-strong\) 60%, var\(--palette-sepia-accent\)\)/);
  // ({#each …} starts with three hex-class letters, hence the full-token form.)
  assert.doesNotMatch(
    themeMenu,
    /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z])/,
    'the toggle must reference tokens, never hex values'
  );

  // The component must delegate every open/close decision to the tested
  // state machine — the trigger latch (F1 fix) and the swatch press-in-
  // flight guard plus outside-press dismissal (F5 fix) included — and
  // return focus to the trigger only when a dismissal reports it was open.
  assert.match(themeMenu, /from '\.\/disclosure'/);
  assert.match(themeMenu, /onpointerdown=\{onTriggerPointerdown\}/);
  assert.match(themeMenu, /triggerPointerDown\(disclosure\)/);
  assert.match(themeMenu, /triggerClick\(disclosure\)/);
  assert.match(themeMenu, /onpointerdown=\{onSwatchPointerdown\}/);
  assert.match(themeMenu, /pressBegan\(disclosure\)/);
  assert.match(themeMenu, /<svelte:window onpointerdown=\{onWindowPointerdown\} \/>/);
  assert.match(themeMenu, /outsidePress\(disclosure\)/);
  assert.match(themeMenu, /if \(dismiss\(disclosure\)\) \{\n\s*trigger\?\.focus\(\)/);
  assert.match(themeMenu, /hidden=\{!disclosure\.open\}/);

  // Touch and motion: targets meet the 44px minimum, animation respects the
  // OS setting.
  assert.match(themeMenu, /2\.75rem/);
  assert.match(themeMenu, /prefers-reduced-motion/);
});
