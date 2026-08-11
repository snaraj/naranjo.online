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

  // Each explicit mode is one attribute-scoped block with its color-scheme.
  for (const theme of ['dark', 'sepia']) {
    assert.match(
      styles,
      new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{[^}]*color-scheme:\\s*dark`),
      `theme block for ${theme} must set its color-scheme`
    );
    assert.match(
      styles,
      new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{[^}]*--color-surface:`),
      `theme block for ${theme} must redefine the tokens`
    );
  }

  // Sepia is seeded from the wiki's browntown values (issue #22) until the
  // owner picks final palettes; every seed slot must be present.
  for (const seed of ['#1b1612', '#28221d', '#312a25', '#3e362f', '#736559', '#b79d7e', '#f4eaea']) {
    assert.match(styles, new RegExp(seed), `sepia is missing browntown seed ${seed}`);
  }
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

  // The menu renders every registry entry as a native, accessible control —
  // no custom ARIA widgetry, no inline script handlers in the shell.
  assert.match(themeMenu, /\{#each themes as theme \(theme\.id\)\}/);
  assert.match(themeMenu, /type="radio"/);
  assert.match(themeMenu, /<summary>[^<]+<\/summary>/);
  assert.match(themeMenu, /<legend>[^<]+<\/legend>/);
});
