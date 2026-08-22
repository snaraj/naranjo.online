import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const [fallback, component, styles, themeRegistry, themeMenu] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/themes.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/ThemeMenu.svelte', import.meta.url), 'utf8'),
]);

/* Every component's scoped <style>, keyed by file name. The global stylesheet
 * is not the only place a width is decided — two of the three overflow
 * defects this page has actually suffered lived in component style blocks —
 * so a source pin that reads styles.css alone would be blind to the majority
 * of its own subject. Discovered by walking the tree rather than listed by
 * hand, so a component added later is covered without anyone remembering to
 * add it here. */
const componentStyles = Object.fromEntries(
  await Promise.all(
    (await readdir(new URL('../src', import.meta.url), { recursive: true }))
      .filter((entry) => entry.endsWith('.svelte'))
      .map(async (entry) => {
        const source = await readFile(new URL(`../src/${entry}`, import.meta.url), 'utf8');
        const block = /<style[^>]*>([\s\S]*?)<\/style>/.exec(source);
        return [entry, block ? block[1] : ''];
      })
  )
);

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
  // Rendering-lane floor (issue #26, delivered by #78): dynamic viewport
  // units, never 100vh. 100vh is the TALLEST the viewport ever gets, so on a
  // phone showing its toolbars the page is taller than the screen and its
  // bottom sits under the browser chrome. The absence assertion is what makes
  // this a floor rather than a suggestion — a reintroduced 100vh anywhere in
  // the stylesheet fails here.
  assert.match(styles, /min-height:\s*100dvh/);
  assert.doesNotMatch(
    styles,
    /\b100vh\b/,
    'the static viewport unit is banned by the rendering-lane floor; use dvh or svh'
  );
  // The insets only report real values when the document opts into them.
  assert.match(fallback, /viewport-fit=cover/);
  // Deliberate reading-modes change (issue #22): light is now the :root
  // default palette, so the media query maps the DARK tokens in — and only
  // for documents without an explicit stamped choice.
  assert.match(styles, /@media \(prefers-color-scheme: dark\)/);
  assert.match(styles, /:root:not\(\[data-theme\]\)/);
});

// occurrences counts literal appearances of needle in source, for the
// palette-deduplication pins below.
const occurrences = (source, needle) => source.split(needle).length - 1;

// The narrowest viewport this site supports, in CSS pixels (rendering-lane
// floor, issue #26). Nothing may claim a hard inline size wider than this, or
// the body scrolls sideways on a phone.
const narrowestViewportPx = 320;

// WCAG 2.2 relative luminance and contrast ratio, computed here so the
// palettes are VALIDATED rather than asserted to be fine. Six-digit hex only,
// which the palette block is already pinned to by the dedup test above.
function relativeLuminance(hex) {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (a, b) => b - a
  );
  return (lighter + 0.05) / (darker + 0.05);
}

// Every --palette-* literal, keyed by token name.
function paletteLiterals(css) {
  const palette = {};
  for (const [, name, value] of css.matchAll(/(--palette-[a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\s*;/g)) {
    palette[name] = value;
  }
  return palette;
}

// cssRules walks the stylesheet once and returns every rule in DOCUMENT
// ORDER with the at-rules it sits inside. Order is the point: CSS resolves a
// repeated declaration by taking the last one, so a resolver that stops at
// the first match can be defeated by simply APPENDING an override — which is
// exactly the attack that got past the previous version of this helper.
function cssRules(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const enclosing = [];
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf('{', cursor);
    if (open < 0) break;
    const prelude = source.slice(cursor, open).replace(/^[};\s]+/, '').trim();
    if (prelude.startsWith('@')) {
      enclosing.push(prelude);
      cursor = open + 1;
      continue;
    }
    const close = source.indexOf('}', open);
    rules.push({ enclosing: [...enclosing], selector: prelude, body: source.slice(open + 1, close) });
    cursor = close + 1;
    while (enclosing.length > 0 && /^\s*}/.test(source.slice(cursor))) {
      enclosing.pop();
      cursor = source.indexOf('}', cursor) + 1;
    }
  }
  return rules;
}

const styleRules = cssRules(styles);
const underColorScheme = (rule) => rule.enclosing.some((at) => at.includes('prefers-color-scheme'));
const rootish = (rule) => rule.selector.split(',').some((part) => part.trim().startsWith(':root'));
const stamped = (rule, mode) => rule.selector.includes(`[data-theme="${mode}"]`);

// The rules that paint one reading mode, base first and override second, each
// in document order. `auto` is modelled because it is a real mode this page
// serves: it is the ABSENCE of a stamp, so it resolves through the
// prefers-color-scheme mapping — the one block nothing used to resolve, and
// the block the auto mode is precisely what makes render.
function modeRules(mode) {
  const base = styleRules.filter((rule) => rootish(rule) && !underColorScheme(rule) && !/\[data-theme=/.test(rule.selector));
  const override =
    mode === 'auto'
      ? styleRules.filter((rule) => underColorScheme(rule) && rootish(rule))
      : mode === 'light'
        ? styleRules.filter((rule) => stamped(rule, 'light'))
        : styleRules.filter((rule) => stamped(rule, mode));
  return [...base, ...override];
}

// Every custom property a mode declares, later declaration winning.
function tokensFor(mode) {
  const tokens = {};
  for (const rule of modeRules(mode)) {
    for (const [, name, value] of rule.body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      tokens[name] = value.trim();
    }
  }
  return tokens;
}

// Follow a token through however many var() hops the layer takes until a
// literal falls out. A dangling or circular reference fails loudly rather
// than resolving to undefined and quietly passing.
function resolveToken(name, tokens, seen = new Set()) {
  const value = tokens[name];
  assert.ok(value !== undefined, `${name} resolves to nothing in this mode`);
  const reference = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  if (!reference) return value;
  assert.ok(!seen.has(name), `${name} is a circular token reference`);
  seen.add(name);
  return resolveToken(reference[1], tokens, seen);
}

// hardInlineSizes returns every declaration that pins a box to an absolute
// inline size, with the value in CSS pixels. Fluid forms are skipped on
// purpose — a percentage, `auto`, a token, or anything inside min()/max()/
// clamp() is by construction able to shrink, which is the property this pin
// is protecting. `max-*` is skipped for the same reason: a maximum never
// forces a box wider than the viewport.
function hardInlineSizes(css) {
  const found = [];
  for (const [declaration, property, value] of css.matchAll(
    /(?:^|[;{])\s*((?:min-)?(?:width|inline-size))\s*:\s*([^;}]+)/g
  )) {
    const trimmed = value.trim();
    if (/^(?:auto|100%|inherit|initial|revert|unset)$/.test(trimmed)) continue;
    if (/(?:min|max|clamp|var|calc)\(/.test(trimmed)) continue;
    const px = /^([\d.]+)px$/.exec(trimmed);
    const rem = /^([\d.]+)rem$/.exec(trimmed);
    if (px) found.push({ declaration: declaration.trim(), property, px: Number(px[1]) });
    if (rem) found.push({ declaration: declaration.trim(), property, px: Number(rem[1]) * 16 });
  }
  return found;
}

// The panels are the page now, so they follow the reading mode instead of
// keeping RuneLite's dark chrome in all three. That makes every panel color a
// per-palette question, and this test answers it by MEASURING: the brand
// orange that reads perfectly on a dark card fails outright on the light one,
// which is exactly the class of mistake a palette swap invites.
test('every reading mode paints panels at a legible contrast', () => {
  // Every panel color travels a CHAIN: a --panel-* hook reads a --color-*
  // slot, and each reading mode wires that slot to a --palette-* literal.
  // Measuring the literals through a hand-written name map would leave the
  // wiring itself unmeasured — light's --color-brand could be rewired back to
  // the raw orange, restoring the 2.37:1 failure this test exists to catch,
  // and the suite would stay green. So the chain is resolved out of the
  // stylesheet and the test measures what the page will actually paint.
  const resolve = (hook, mode) => resolveToken(hook, tokensFor(mode));
  // 4.5:1 is WCAG 1.4.3 for body text; 3:1 is 1.4.11 for a non-text
  // indicator, which is all the status dot is — its state is carried by
  // SHAPE as well, so color is the redundant channel and never the only one.
  const floors = {
    '--panel-text': 4.5,
    '--panel-muted': 4.5,
    '--panel-accent': 4.5,
    '--panel-status-ok': 3,
  };
  for (const mode of ['light', 'auto', 'dark', 'sepia']) {
    const background = resolve('--panel-surface', mode);
    assert.ok(background, `${mode} has no raised surface to measure against`);
    for (const [hook, floor] of Object.entries(floors)) {
      const foreground = resolve(hook, mode);
      assert.ok(foreground, `${mode} palette is missing ${hook}`);
      const ratio = contrastRatio(foreground, background);
      assert.ok(
        ratio >= floor,
        `${mode}: ${hook} on the panel surface is ${ratio.toFixed(2)}:1, below ${floor}:1`
      );
    }
    // The heatmap ramp is one hue with MONOTONE lightness, and its direction
    // is per-palette: against a light card a ramp that steps brighter walks
    // toward its own background, so the busiest days would read as the
    // emptiest. Direction is derived from the palette, never assumed.
    const ramp = [0, 1, 2, 3, 4].map((level) => resolve(`--grid-cell-${level}`, mode));
    ramp.forEach((value, level) => assert.ok(value, `${mode} ramp is missing level ${level}`));
    const luminances = ramp.map(relativeLuminance);
    const descending = luminances[4] < luminances[0];
    for (let level = 1; level < luminances.length; level += 1) {
      assert.ok(
        descending ? luminances[level] < luminances[level - 1] : luminances[level] > luminances[level - 1],
        `${mode} ramp is not monotone at level ${level}: ${luminances.map((l) => l.toFixed(3)).join(' ')}`
      );
    }
    // ...and it must travel AWAY from the card, not toward it.
    assert.equal(
      descending,
      relativeLuminance(background) > 0.5,
      `${mode} ramp steps the wrong way for its own surface`
    );
  }
});

// A 320px phone is the floor, and the page must reach it by SHRINKING rather
// than by scrolling sideways. This is a source pin because the browser
// harness available here cannot open a window narrower than 500px, so the
// property is enforced where it is actually decided — in the declarations —
// instead of being assumed from a wider measurement.
test('nothing claims a hard inline size wider than the narrowest viewport', () => {
  // Every component's scoped style is swept alongside the global sheet. The
  // boss tooltip's own min-inline-size was one of the real defects behind
  // this pin, and it lived in a component — a styles.css-only scan would have
  // watched it come straight back.
  const scanned = { styles, ...componentStyles };
  assert.ok(
    Object.keys(scanned).length > 5,
    'the component sweep found almost nothing; the tree walk is broken'
  );
  for (const [name, source] of Object.entries(scanned)) {
    for (const { declaration, px } of hardInlineSizes(source)) {
      assert.ok(
        px <= narrowestViewportPx,
        `${name}: "${declaration}" pins ${px}px, wider than the ${narrowestViewportPx}px floor — it will scroll the body sideways on a phone`
      );
    }
  }
  // The column is a MAXIMUM, never a fixed width: it must always be able to
  // collapse to the viewport. This is the single most load-bearing use of
  // min() on the page, so it is pinned by shape and not merely by value.
  assert.match(
    styles,
    /inline-size:\s*min\(var\(--page-column-width\), 100%\)/,
    'the page column must be a min() against 100%, never a fixed width'
  );
  // Grid items default to a min-content automatic minimum, so a card holding
  // a dense table refuses to shrink and drags the stack past the column. This
  // is the exact defect that made the body scroll sideways at every width.
  assert.match(styles, /\.panel-stack,\s*\n\.panel-stack > \*\s*\{[^}]*min-inline-size:\s*0/);
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

  // Exactly the three registered modes, each carrying a visible name. These
  // are the STAMPED ids — the ones the origin precomputes a document for —
  // and they are what the Go parity test compares against readingThemes.
  for (const id of ['light', 'dark', 'sepia']) {
    assert.match(themeRegistry, new RegExp(`id: '${id}', label: '[^']+'`), `registry lacks ${id}`);
  }

  // The swap is instant and attribute-based; persistence is the exact cookie
  // the origin parses: whole-site path, 365 days, SameSite=Lax.
  assert.match(themeRegistry, /setAttribute\('data-theme', id\)/);
  assert.match(themeRegistry, /'theme=' \+ id \+ '; path=\/; max-age=31536000; samesite=lax'/);
});

// Auto is the fourth toggle choice and the only one that is NOT a stamped
// theme: it is the absence of a choice. Modelling it as a stamped id would
// need a [data-theme="auto"] block restating the whole media query, and a Go
// variant that cannot be right for two visitors whose devices disagree — so
// the registry keeps three ids and the menu derives four choices from them.
test('auto is the no-choice choice: derived menu, attribute removed, cookie expired', () => {
  // The menu is DERIVED from the registry, so a theme added above cannot fail
  // to appear in the toggle and the two lists can never disagree.
  assert.match(themeRegistry, /export const modes: readonly Mode\[\] = \[\{ id: autoMode, label: '[^']+' \}, \.\.\.themes\]/);
  assert.match(themeRegistry, /export const autoMode = 'auto'/);

  // Auto is deliberately outside ThemeId — the type the origin's stamped
  // variants and the cookie contract are keyed on.
  assert.match(themeRegistry, /export type ThemeId = 'light' \| 'dark' \| 'sepia'/);
  assert.match(themeRegistry, /export type ModeId = ThemeId \| typeof autoMode/);

  // Choosing auto un-stamps the live document AND expires the cookie. Setting
  // the cookie to any value instead would keep the origin answering with a
  // stamped variant forever, which is the regression this pins.
  assert.match(themeRegistry, /removeAttribute\('data-theme'\)/);
  assert.match(themeRegistry, /'theme=; path=\/; max-age=0; samesite=lax'/);

  // An unstamped document reads as auto SELECTED, never as nothing selected —
  // otherwise the state every visitor starts in shows no pressed swatch.
  assert.match(themeRegistry, /return documentTheme\(\) \?\? autoMode/);
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

  // Popover: every menu entry becomes a named swatch button carrying
  // pressed semantics for the current choice.
  assert.match(themeMenu, /\{#each modes as mode \(mode\.id\)\}/);
  assert.match(themeMenu, /aria-label=\{mode\.label\}/);
  assert.match(themeMenu, /aria-pressed=\{selected === mode\.id\}/);

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

  // Auto has no palette of its own, so its swatch previews BOTH — split down
  // the middle — and each half of the glyph is drawn in the ink belonging to
  // its own side, which is what keeps every half of it legible.
  assert.match(
    themeMenu,
    /linear-gradient\(\s*90deg,\s*var\(--palette-light-surface\) 0 50%,\s*var\(--palette-dark-surface\) 50% 100%\s*\)/,
    'the auto swatch must preview both palettes from their own surface tokens'
  );
  assert.match(themeMenu, /\.auto-half-light \{\s*fill: var\(--palette-light-text\)/);
  assert.match(themeMenu, /\.auto-half-dark \{\s*fill: var\(--palette-dark-text\)/);
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
