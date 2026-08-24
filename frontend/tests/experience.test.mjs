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

/* Every component in the tree, keyed by file name — markup and scoped style
 * together, because the rendering-lane floors below need both halves: which
 * elements are controls is a MARKUP fact, and how big they are is a STYLE
 * one. Discovered by walking the tree rather than listed by hand, so a
 * component added later is covered without anyone remembering to add it
 * here. */
const componentSources = Object.fromEntries(
  await Promise.all(
    (await readdir(new URL('../src', import.meta.url), { recursive: true }))
      .filter((entry) => entry.endsWith('.svelte'))
      .map(async (entry) => [
        entry,
        await readFile(new URL(`../src/${entry}`, import.meta.url), 'utf8'),
      ])
  )
);

/* Every component's scoped <style>, keyed by file name. The global stylesheet
 * is not the only place a width is decided — two of the three overflow
 * defects this page has actually suffered lived in component style blocks —
 * so a source pin that reads styles.css alone would be blind to the majority
 * of its own subject. */
const componentStyles = Object.fromEntries(
  Object.entries(componentSources).map(([entry, source]) => {
    const block = /<style[^>]*>([\s\S]*?)<\/style>/.exec(source);
    return [entry, block ? block[1] : ''];
  })
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
  assert.match(stylesCode, /@media \(prefers-color-scheme: dark\)/);
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
  // Comments are blanked, and braces INSIDE string literals are defused: a
  // `content: "}"` declaration would otherwise close a rule early and hide
  // every repaint after it. Only the braces go — blanking whole strings also
  // empties the quoted value in `[data-theme="dark"]`, which is a selector
  // this walk has to keep reading.
  const source = css
    .replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length))
    .replace(/"[^"\n]*"|'[^'\n]*'/g, (match) => match.replace(/[{}]/g, ' '));
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

// A comment-blind copy, because a raw-text pin matches text that a browser
// never reads. The delta review commented the whole prefers-color-scheme
// block OUT and stayed 137/137 green: the raw-text pins matched the
// commented copy while cssRules stripped it, so `auto` silently degenerated
// to light — the mode with no stamp rendering as though a stamp existed.
const stylesCode = styles.replace(/\/\*[\s\S]*?\*\//g, '');

const styleRules = cssRules(styles).map((rule, order) => ({ ...rule, order }));
// WHICH preference, not merely that there is one. Matching the bare
// substring routed a `prefers-color-scheme: light` block to auto-DARK and
// skipped it for auto-light — exactly inverted, and inverted precisely in
// the mode the auto split was added to model. An unrecognised preference
// fails loudly rather than landing in whichever mode the substring reached.
function colorSchemeOf(rule) {
  const at = rule.enclosing.find((entry) => entry.includes('prefers-color-scheme'));
  if (!at) return null;
  const value = /prefers-color-scheme\s*:\s*([a-z]+)/.exec(at);
  assert.ok(value, `"${at}" queries prefers-color-scheme without a value this resolver can read`);
  assert.ok(
    value[1] === 'dark' || value[1] === 'light',
    `"${at}" asks for prefers-color-scheme: ${value[1]}, which this resolver cannot place in a mode`
  );
  return value[1];
}
const underColorScheme = (rule) => colorSchemeOf(rule) !== null;
// --palette-* belongs here as much as --color-*. The token layer resolves
// --color-* THROUGH --palette-*, so a rule that redeclares only a palette
// literal repaints exactly the same pixels while declaring nothing this
// pattern used to recognise — invisible to the resolver, to the loud
// selector assert, and to the token-layer pin at once. The var() spelling
// this file's own doctrine mandates was the spelling that got through.
const themeTokenPattern = /^--(?:color|panel|grid-cell|palette)-/;
const declaresThemeToken = (body) =>
  [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].some(([, name]) => themeTokenPattern.test(name));

// Document order is NOT the cascade. `:root:not([data-theme])` carries
// (0,2,0) against plain `:root`'s (0,1,0), so it wins from EARLIER in the
// file — a repaint the previous order-only resolver could not see, and one
// this stylesheet is already primed for because that selector is load-bearing
// inside the prefers-color-scheme block.
//
// Only the forms this token layer actually uses are recognised. Anything
// else returns null and fails the caller LOUDLY, because a selector the
// matcher does not understand is precisely where the next repaint would
// hide, and silently skipping it is how an order-only model got here.
function tokenLayerSelector(selector) {
  const parts = selector.split(',').map((part) => part.trim());
  const forms = parts.map((part) => {
    if (part === ':root') return { weight: 10, applies: () => true };
    if (part === ':root:not([data-theme])')
      return { weight: 20, applies: (mode) => mode.startsWith('auto') };
    const stamp = /^(?::root)?\[data-theme="([a-z]+)"\]$/.exec(part);
    if (stamp) return { weight: part.startsWith(':root') ? 20 : 10, applies: (mode) => mode === stamp[1] };
    return null;
  });
  if (forms.some((form) => form === null)) return null;
  // No Math.max: hoisting the highest weight onto every part of a list
  // makes the weak parts punch above their specificity, and a browser
  // paints the difference. A list whose parts genuinely disagree is a form
  // this resolver cannot weigh as one rule, so it says so.
  const weights = new Set(forms.map((form) => form.weight));
  if (weights.size > 1) return null;
  return {
    weight: forms[0].weight,
    applies: (mode) => forms.some((form) => form.applies(mode)),
  };
}

// The rules that paint one reading mode, base first and override second, each
// in document order. `auto` is modelled because it is a real mode this page
// serves: it is the ABSENCE of a stamp, so it resolves through the
// prefers-color-scheme mapping — the one block nothing used to resolve, and
// the block the auto mode is precisely what makes render.
function modeRules(mode) {
  const applied = [];
  for (const rule of styleRules) {
    if (!declaresThemeToken(rule.body)) continue;
    const form = tokenLayerSelector(rule.selector);
    assert.ok(
      form,
      `"${rule.selector}" declares theme tokens through a selector this resolver cannot weigh; ` +
        'the token layer is :root, :root:not([data-theme]), and [data-theme="…"]',
    );
    // A media-query block is a further condition on top of the selector, and
    // it is the condition that splits auto in two. An unstamped document
    // renders one way when the device asks for dark and another when it asks
    // for light, so "auto" is not one rendering to validate but two — and the
    // OS-LIGHT one was entirely unmodelled until the delta review, because
    // this resolver applied the dark media block to auto unconditionally.
    // That is the rendering `:root:not([data-theme])` repaints, since it
    // outweighs :root at (0,2,0) while the media block is not in force.
    const scheme = colorSchemeOf(rule);
    if (scheme !== null && mode !== `auto-${scheme}`) continue;
    if (!form.applies(mode)) continue;
    applied.push({ ...rule, weight: form.weight });
  }
  return applied.sort((a, b) => a.weight - b.weight || a.order - b.order);
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
  // Auto is the absence of a stamp, so it renders through the OS mapping and
  // nothing else. If that block is deleted — or merely COMMENTED OUT, which
  // the delta review did while staying 137/137 green — auto silently
  // degenerates into light and this whole loop then validates light twice
  // under two names. Fail on the block's absence, not on its contrast.
  assert.ok(
    styleRules.some((rule) => underColorScheme(rule) && declaresThemeToken(rule.body)),
    'no prefers-color-scheme block declares theme tokens; auto-dark would render as light while claiming to follow the device',
  );
  for (const mode of ['light', 'auto-light', 'auto-dark', 'dark', 'slate', 'sepia']) {
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

// The contrast guard above resolves the TOKEN LAYER, not the DOM. That is a
// deliberate limit — modelling which element a declaration reaches needs a
// tree, and this suite is dependency-free by contract — but it leaves an
// opening the delta review walked straight through: custom properties
// INHERIT, so `#app { --color-brand: red }` or a component <style> repaints
// every descendant while the resolver, which only weighs :root-ish rules,
// sees nothing at all.
//
// Forbidding the declaration needs no tree. AGENTS.md already says the token
// layer lives in styles.css — "the light palette on :root, every further
// reading mode one [data-theme] override block" — and that components
// "consume tokens, never raw palette literals". This makes that a red build
// instead of a convention, which is the strictly stronger half of the pair:
// the resolver proves the layer's VALUES are legible, and this proves there
// is nowhere else for a value to come from.
test('theme tokens are declared in the token layer and nowhere else', () => {
  for (const [name, source] of Object.entries(componentStyles)) {
    for (const [, property] of source.matchAll(/(--[a-z0-9-]+)\s*:/g)) {
      assert.ok(
        !themeTokenPattern.test(property),
        `${name} declares ${property}; a component that declares a theme token repaints every element inside it, and no contrast guard resolving :root can see it`
      );
    }
  }
  const declaring = styleRules.filter((rule) => declaresThemeToken(rule.body));
  assert.ok(declaring.length >= 5, `only ${declaring.length} rules declare theme tokens; the layer is :root plus one block per stamped mode plus the OS mapping, so it cannot have shrunk this far`);
  for (const rule of declaring) {
    assert.ok(
      tokenLayerSelector(rule.selector),
      `"${rule.selector}" declares theme tokens outside the token layer, which is :root, :root:not([data-theme]), and [data-theme="…"]`
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
  for (const theme of ['dark', 'slate', 'sepia']) {
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
    stylesCode,
    /prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme\]\)\s*\{[^}]*var\(--palette-dark-/,
    'the media query must remap onto the dark palette, never restate values'
  );

  // Palette deduplication (review finding): every palette value is written
  // exactly once, as a --palette-* definition; theme blocks and components
  // only reference. The two anchor hexes appear exactly twice because
  // light's text is SLATE's surface and vice versa — one occurrence per
  // palette slot, still zero per consumer.
  const uniqueValues = [
    '#efefe8', '#e6e6dd', '#d8d8cd', '#9a9a8e', '#3d434f', // light ramp
    // The true dark. Every one of these is a grey — red, green and blue
    // equal — which is the whole claim the mode makes and the one a repaint
    // toward navy would have to break to get past here.
    '#121212', '#1e1e1e', '#2e2e2e', '#383838', '#6c6c6c', '#a0a0a0', '#e0e0e0',
    '#2a2a2a', '#545454', '#7f7f7f', '#aaaaaa', '#d9d9d9', // its hueless heatmap
    '#161a23', '#1d222d', '#2a3040', '#566078', '#b9c2d4', // slate ramp
    '#1b1612', '#28221d', '#312a25', '#3e362f', '#736559', '#b79d7e', '#f4eaea', // browntown seeds
  ];
  // The neutrality claim, measured rather than asserted: a true dark whose
  // surfaces carry a hue is the exact defect this mode was added to fix, and
  // a hex list alone cannot see one arriving in a later repaint.
  for (const [name, value] of Object.entries(paletteLiterals(styles))) {
    if (!name.startsWith('--palette-dark-')) continue;
    const [red, green, blue] = [1, 3, 5].map((offset) => value.slice(offset, offset + 2));
    assert.ok(
      red === green && green === blue,
      `${name} is ${value}; the dark mode is the NEUTRAL one, so every channel must agree — a tinted value belongs in slate or sepia`
    );
  }
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

  // Exactly the four registered modes, each carrying a visible name. These
  // are the STAMPED ids — the ones the origin precomputes a document for —
  // and they are what the Go parity test compares against readingThemes.
  for (const id of ['light', 'dark', 'slate', 'sepia']) {
    assert.match(themeRegistry, new RegExp(`id: '${id}', label: '[^']+'`), `registry lacks ${id}`);
  }

  // The swap is instant and attribute-based; persistence is the exact cookie
  // the origin parses: whole-site path, 365 days, SameSite=Lax.
  assert.match(themeRegistry, /setAttribute\('data-theme', id\)/);
  assert.match(themeRegistry, /'theme=' \+ id \+ '; path=\/; max-age=31536000; samesite=lax'/);
});

// Auto is the one toggle choice that is NOT a stamped theme: it is the
// absence of a choice. Modelling it as a stamped id would need a
// [data-theme="auto"] block restating the whole media query, and a Go variant
// that cannot be right for two visitors whose devices disagree — so the
// registry keeps four ids and the menu derives five choices from them.
test('auto is the no-choice choice: derived menu, attribute removed, cookie expired', () => {
  // The menu is DERIVED from the registry, so a theme added above cannot fail
  // to appear in the toggle and the two lists can never disagree.
  assert.match(themeRegistry, /export const modes: readonly Mode\[\] = \[\{ id: autoMode, label: '[^']+' \}, \.\.\.themes\]/);
  assert.match(themeRegistry, /export const autoMode = 'auto'/);

  // Auto is deliberately outside ThemeId — the type the origin's stamped
  // variants and the cookie contract are keyed on.
  assert.match(themeRegistry, /export type ThemeId = 'light' \| 'dark' \| 'slate' \| 'sepia'/);
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
// popover of one swatch per mode, each swatch an inline-SVG line icon whose
// enclosed area is that theme's OWN page-surface token — split circle on
// auto, sun on light, cratered moon on the three darks. No icon assets, no
// hex copies. These pins cover DOM wiring only; the open/select/close/reopen
// behavior is EXECUTED against src/lib/disclosure.ts in toggle.test.mjs.
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
  // hex anywhere in the component. The palette lives INSIDE the glyph now
  // (owner directive, 2026-08-24: the swatches are line icons like the
  // header chrome, not filled discs), so the mode's surface is the shape's
  // fill rather than the button's background — and the button must carry no
  // background at all, which is the half of this that the owner rejected.
  for (const id of ['light', 'dark', 'slate', 'sepia']) {
    assert.match(
      themeMenu,
      new RegExp(`\\.swatch-${id} \\.chip \\{\\s*fill: var\\(--palette-${id}-surface\\)`),
      `the ${id} swatch glyph must be filled with that theme's own surface token`
    );
  }
  // ...and each dark mode's INK is its craters, which is what tells the three
  // apart — neutral, cool, warm. A mode whose craters lost their own accent
  // becomes indistinguishable from its neighbour at this size.
  for (const id of ['dark', 'slate', 'sepia']) {
    assert.match(
      themeMenu,
      new RegExp(`\\.swatch-${id} \\.crater \\{\\s*fill: var\\(--palette-${id}-accent\\)`),
      `the ${id} swatch craters must be that theme's own accent token`
    );
  }

  // Auto has no palette of its own, so its glyph previews BOTH — one circle
  // split down the middle between the two page surfaces it chooses between.
  assert.match(themeMenu, /\.swatch-auto \.auto-half-light \{\s*fill: var\(--palette-light-surface\)/);
  assert.match(themeMenu, /\.swatch-auto \.auto-half-dark \{\s*fill: var\(--palette-dark-surface\)/);
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

/* ===========================================================================
 * Rendering lanes, stage 1 (issue #26)
 *
 * The floors below are what "renders correctly on a phone and in every
 * engine" decomposes into, each pinned where it is actually decided — in the
 * declarations — rather than measured once and assumed. They are deliberately
 * SOURCE pins: the browser lanes in e2e/rendering-lanes.spec.mjs observe the
 * same floors for real in Chromium, Firefox and WebKit at phone viewports,
 * and the two halves answer different questions. A measurement proves what
 * one build did on one engine; these prove the rule the next build inherits,
 * including on the engines and devices no lane can run.
 * ======================================================================== */

/* Every rule in the stylesheet AND in every component <style>, tagged with
 * the file it came from. cssRules is reused rather than re-derived: the
 * question here is CONTAINMENT — which at-rules a declaration sits inside —
 * and that is exactly what its `enclosing` list records. (The mode resolver
 * above asks a different question, cascade order, which is why it weighs
 * selectors and this does not.) */
const sweptRules = Object.entries({ styles, ...componentStyles }).flatMap(([file, source]) =>
  cssRules(source).map((rule) => ({ ...rule, file }))
);

// One rule's declarations, property and value, in source order.
const declarationsOf = (body) =>
  [...body.matchAll(/(?:^|;)\s*(--[a-z0-9-]+|-{0,2}[a-z][a-z0-9-]*)\s*:\s*([^;]+)/gi)].map(
    ([, property, value]) => ({ property: property.toLowerCase(), value: value.trim() })
  );

// A selector list, split into the individual selectors it stands for.
const selectorParts = (selector) => selector.split(',').map((part) => part.trim());

/* A length literal in CSS pixels, or null when this parser cannot read it.
 * Null is never treated as "fine": every caller fails loudly on it, because a
 * value the parser does not understand is precisely where an undersized one
 * would hide. rem is resolved at the 16px root default the page ships with —
 * a reader who enlarges that only ever makes these boxes bigger. */
function lengthInPx(value) {
  const trimmed = value.trim();
  const px = /^([\d.]+)px$/.exec(trimmed);
  if (px) return Number(px[1]);
  const rem = /^([\d.]+)rem$/.exec(trimmed);
  if (rem) return Number(rem[1]) * 16;
  return null;
}

/* The SMALLEST size a value can resolve to. max() is the form the 16px floor
 * is written in — it takes whichever of its arguments is larger, so the
 * guarantee is the largest of the parts, and a max() whose parts are all
 * under the floor is caught rather than excused by the function name. */
function smallestLengthPx(value) {
  const direct = lengthInPx(value);
  if (direct !== null) return direct;
  const max = /^max\(([^()]+)\)$/.exec(value.trim());
  if (!max) return null;
  const parts = max[1].split(',').map((part) => lengthInPx(part));
  return parts.some((part) => part === null) ? null : Math.max(...parts);
}

// The static viewport unit, in any spelling; the dynamic family it must be
// replaced by. `100dvh` deliberately does NOT match the static pattern.
const staticViewportHeight = /\b\d+(?:\.\d+)?vh\b/;
const dynamicViewportHeight = /\b\d+(?:\.\d+)?[dsl]vh\b/;

test('full-viewport height is a dynamic unit, in every file that decides one (issue #26)', () => {
  const scanned = { styles, ...componentStyles };
  assert.ok(
    Object.keys(scanned).length > 5,
    'the component sweep found almost nothing; the tree walk is broken'
  );
  let dynamic = 0;
  for (const [name, source] of Object.entries(scanned)) {
    assert.doesNotMatch(
      source,
      staticViewportHeight,
      `${name}: the static viewport unit is the tallest the viewport ever gets, so a box sized in it sits under a phone's browser chrome; use dvh or svh`
    );
    dynamic += [...source.matchAll(new RegExp(dynamicViewportHeight, 'g'))].length;
  }
  /* The absence assertion alone is satisfied by a page that never expresses a
     full-viewport height at all, which is not the floor — the floor is that
     when the page DOES want the viewport, it asks for the one that tracks the
     visible area. So the positive form is pinned too, and pinned on the
     element that carries it. */
  assert.ok(
    dynamic > 0,
    'no box asks for a dynamic viewport height; the floor has no positive expression left, only a ban'
  );
  assert.match(
    styles,
    /body\s*\{\s*min-height:\s*100dvh/,
    'the page body must claim the dynamic viewport height'
  );
});

/* The features this page uses that a browser inside its support window may
 * not have. Every one of them fails the same silent way — an unsupported
 * value invalidates its whole declaration, so the page does not degrade, it
 * simply loses the padding, the height, or the ink it asked for — which is
 * why each must be an upgrade over a base that stands on its own. */
const progressiveFeatures = [
  { name: 'a dynamic viewport unit', used: dynamicViewportHeight, tested: /[dsl]vh/ },
  { name: 'a safe-area inset', used: /env\(\s*safe-area-inset/, tested: /env\(\s*safe-area-inset/ },
  { name: 'a color mix', used: /color-mix\(/, tested: /color-mix\(/ },
];

const supportsQueries = (rule) => rule.enclosing.filter((at) => at.startsWith('@supports'));

test('every progressive feature is guarded, and every guard has a base under it (issue #26)', () => {
  /* CSS offers exactly two ways to state a fallback, and both are correct, so
     both are accepted here:
       * a plain earlier declaration of the SAME property in the SAME rule,
         which an engine keeps precisely because it discards the later one it
         cannot parse (the meter track uses this);
       * an @supports block, which is what a fallback spanning several
         properties or living in a different rule needs (the page height, the
         safe-area padding and the sepia glyph use this).
     What is refused is the third case: a progressive value with nothing
     underneath it. */
  const guarded = sweptRules.filter((rule) => supportsQueries(rule).length > 0);
  assert.ok(
    guarded.length > 0,
    'no rule sits inside an @supports block; the graceful-degradation floor has nothing left to enforce'
  );
  for (const feature of progressiveFeatures) {
    for (const rule of sweptRules) {
      const declarations = declarationsOf(rule.body);
      declarations.forEach(({ property, value }, index) => {
        if (!feature.used.test(value)) return;
        const query = supportsQueries(rule).some((at) => feature.tested.test(at));
        const earlierBase = declarations
          .slice(0, index)
          .some((earlier) => earlier.property === property && !feature.used.test(earlier.value));
        assert.ok(
          query || earlierBase,
          `${rule.file}: "${rule.selector}" sets ${property} with ${feature.name} and nothing to fall back to — a browser without it drops the declaration and the element keeps neither value`
        );
      });
    }
  }
  /* And the other half, which is the half that actually degrades: a guarded
     declaration is only an upgrade if the property is ALSO declared outside
     the guard. Without that, the @supports block is just an unsupported
     declaration with extra ceremony. */
  for (const rule of guarded) {
    for (const { property } of declarationsOf(rule.body)) {
      const base = sweptRules.find(
        (candidate) =>
          candidate.file === rule.file &&
          supportsQueries(candidate).length === 0 &&
          selectorParts(candidate.selector).includes(rule.selector) &&
          declarationsOf(candidate.body).some((declaration) => declaration.property === property)
      );
      assert.ok(
        base,
        `${rule.file}: "${rule.selector}" upgrades ${property} inside @supports with no base declaration outside it; a browser that fails the query is left with nothing`
      );
    }
  }
});

test('text entry never renders below the 16px iOS zoom threshold (issue #26)', () => {
  // The threshold is iOS Safari's: focus a field whose text is smaller than
  // this and it zooms the whole page in, which moves everything the visitor
  // was reading and does not zoom back out.
  const entryFloorPx = 16;
  const textEntry = /(?:^|[\s,>+~])(?:input|select|textarea)\b/;
  const sizing = sweptRules.filter(
    (rule) =>
      textEntry.test(rule.selector) &&
      declarationsOf(rule.body).some(({ property }) => property === 'font-size')
  );
  assert.ok(
    sizing.length > 0,
    'nothing sizes a text-entry control any more; the floor has no expression left'
  );
  for (const rule of sizing) {
    for (const { property, value } of declarationsOf(rule.body)) {
      if (property !== 'font-size') continue;
      const px = smallestLengthPx(value);
      assert.ok(
        px !== null,
        `${rule.file}: "${rule.selector}" sizes text entry as "${value}", which this pin cannot resolve to a floor — including inherit, which lands wherever the surrounding card happens to be`
      );
      assert.ok(
        px >= entryFloorPx,
        `${rule.file}: "${rule.selector}" renders text entry at ${px}px, under the ${entryFloorPx}px threshold that stops iOS from zooming the page`
      );
    }
  }
  // All three controls, not merely the one somebody remembered: iOS zooms for
  // a small <select> and <textarea> exactly as it does for <input>.
  const covered = selectorParts(sizing.map((rule) => rule.selector).join(','));
  for (const control of ['input', 'select', 'textarea']) {
    assert.ok(covered.includes(control), `<${control}> inherits no 16px floor of its own`);
  }
});

/* Every class a <button> or link carries in the markup, dropping the parts
 * built at runtime ({mode.id}) — a class this walk cannot read is a class it
 * makes no claim about. The controls that matter here are all static. */
const controlClasses = (source) =>
  [...source.matchAll(/<(?:button|a)\b[^>]*\bclass="([^"]*)"/g)]
    .flatMap(([, list]) => list.split(/\s+/))
    .filter((name) => name.length > 0 && !name.includes('{') && !name.includes('}'));

test('every control the markup declares clears the 44px touch floor (issue #26)', () => {
  // 44px is the comfortable minimum for a finger; a control sized under it is
  // reliably missable on a phone however good it looks on a desktop.
  const touchFloorPx = 44;
  const axes = { 'inline-size': 'inline', width: 'inline', 'block-size': 'block', height: 'block' };
  const classes = new Set(Object.values(componentSources).flatMap(controlClasses));
  assert.ok(classes.size > 0, 'the markup walk found no control classes at all; it is broken');
  let measured = 0;
  for (const name of classes) {
    for (const rule of sweptRules) {
      if (!selectorParts(rule.selector).includes(`.${name}`)) continue;
      for (const { property, value } of declarationsOf(rule.body)) {
        const axis = axes[property];
        if (axis === undefined) continue;
        const px = lengthInPx(value);
        assert.ok(
          px !== null,
          `${rule.file}: ".${name}" sizes its ${axis} axis as "${value}", which this pin cannot measure against the touch floor`
        );
        assert.ok(
          px >= touchFloorPx,
          `${rule.file}: ".${name}" is ${px}px on the ${axis} axis, under the ${touchFloorPx}px touch floor`
        );
        measured += 1;
      }
    }
  }
  /* Both page-level controls size both of their axes, so four is the number
     this walk must keep finding. A control sized only by its padding is a
     legitimate shape this pin says nothing about — the browser lanes measure
     those, because only a rendered box knows how big padding made it. */
  assert.ok(
    measured >= 4,
    `only ${measured} control dimensions were measured; the shared control rules size both axes each, so the walk has lost sight of one`
  );
});

test('motion exists only where the reader has not asked for less of it (issue #26)', () => {
  const motion = /^(?:animation|transition)(?:-.+)?$/;
  const moving = sweptRules.filter(
    (rule) =>
      !rule.enclosing.some((at) => at.startsWith('@keyframes')) &&
      declarationsOf(rule.body).some(({ property }) => motion.test(property))
  );
  assert.ok(
    moving.length > 0,
    'nothing on the page animates any more; this pin now proves nothing and should move with the motion it guarded'
  );
  for (const rule of moving) {
    /* The page states motion inside `no-preference` rather than cancelling it
       inside `reduce`, and this pin holds it to that: the reduce override is
       reachable only by a browser that HAS the media feature, so a cancelling
       block leaves the animation running everywhere the feature is unknown,
       while a no-preference block never starts it there. */
    assert.ok(
      rule.enclosing.some((at) => /prefers-reduced-motion\s*:\s*no-preference/.test(at)),
      `${rule.file}: "${rule.selector}" animates outside a (prefers-reduced-motion: no-preference) block, so it plays for a reader who asked for less motion`
    );
  }
});

test('a reading-mode swap can only repaint, never re-lay-out (issue #26)', () => {
  /* Zero CLS on the theme switch, made structural. The toggle swaps one
     attribute on <html>, so everything a reading-mode block declares takes
     effect INSTANTLY on a page the visitor is already reading — a padding, a
     font-size, a border width in one of these blocks would move the text
     under their eyes. Custom properties and color-scheme cannot: they change
     what is painted, never how much room it takes. */
  const swapped = sweptRules.filter(
    (rule) =>
      rule.selector.includes('[data-theme') ||
      rule.enclosing.some((at) => at.includes('prefers-color-scheme'))
  );
  assert.ok(
    swapped.length >= 4,
    `only ${swapped.length} reading-mode blocks were found; the stylesheet ships four swappable renderings — one per stamped mode above light, plus the OS mapping`
  );
  for (const rule of swapped) {
    for (const { property } of declarationsOf(rule.body)) {
      assert.ok(
        property.startsWith('--') || property === 'color-scheme',
        `${rule.file}: "${rule.selector}" declares ${property}; a reading mode may only move custom properties and color-scheme, or switching it shifts the layout under the reader`
      );
    }
  }
});

/* Every reading mode declares the SAME token set — the guard that turns the
 * token layer into a contract other code can rely on.
 *
 * The failure it forbids is silent rather than loud, which is why it needs a
 * test at all. A mode that omits one token does not render unstyled; it
 * inherits :root, which is the LIGHT palette, so a dark mode missing
 * --color-border paints one light seam and everything else stays dark. The
 * contrast guard above cannot see it either: that guard resolves the hooks it
 * measures, and a token nothing measures resolves happily to light's value.
 *
 * It matters more the more the page grows. Components read these roles by
 * name and must never ask which mode is active — a card, a panel or a feed
 * item that had to branch per theme would need editing every time a mode is
 * added, which is exactly the coupling the token layer exists to prevent. So
 * the roles are compared as SETS: adding a role to one mode is fine, adding
 * it to only one mode is a red build, and the message names both sides. */
test('every reading mode declares the identical token set', () => {
  const overrides = styleRules.filter(
    (rule) =>
      declaresThemeToken(rule.body) &&
      (rule.selector.includes('[data-theme') ||
        rule.enclosing.some((at) => at.includes('prefers-color-scheme')))
  );
  const named = overrides.map((rule) => ({
    name: /\[data-theme="([a-z]+)"\]/.exec(rule.selector)?.[1] ?? 'auto (the OS dark mapping)',
    properties: [...new Set(declarationsOf(rule.body).map(({ property }) => property))].sort(),
  }));
  assert.ok(
    named.length >= 4,
    `only ${named.length} token-declaring reading-mode blocks were found; the parity comparison has nothing left to compare`
  );

  // Every stamped id in the registry owns a block, and no block answers to an
  // id the registry never registered. Either half alone ships a mode the
  // other side cannot reach: a cookie the stylesheet ignores, or a palette no
  // toggle can select.
  const stamped = named.filter((mode) => !mode.name.startsWith('auto')).map((mode) => mode.name);
  const registered = [...themeRegistry.matchAll(/id: '([a-z]+)', label: '[^']+'/g)].map(
    ([, id]) => id
  );
  assert.deepEqual(
    stamped.slice().sort(),
    registered.filter((id) => id !== 'light').sort(),
    'the stylesheet and the registry disagree about which reading modes exist; light is the :root default and has no block of its own'
  );

  const [reference, ...rest] = named;
  for (const mode of rest) {
    const missing = reference.properties.filter((name) => !mode.properties.includes(name));
    const extra = mode.properties.filter((name) => !reference.properties.includes(name));
    assert.deepEqual(
      mode.properties,
      reference.properties,
      `${mode.name} does not declare the same tokens as ${reference.name} — missing ${missing.length > 0 ? missing.join(', ') : 'nothing'}; extra ${extra.length > 0 ? extra.join(', ') : 'nothing'}. A token a mode omits falls through to the light palette, silently, in that mode only`
    );
  }
});

/* ===========================================================================
 * The chrome-icon family (owner directive, 2026-08-24)
 *
 * "These icons are not matching the small, sleek, translucid, appearance of
 * the parent icons, they should not look this overwhelming." The reading-mode
 * popover's five swatches were 2.75rem filled discs, each rimmed and — when
 * chosen — ringed a further two pixels, sitting directly under two 18px line
 * glyphs that wear no chrome at all. They are one family now, and these pins
 * are what stops the two halves of it drifting apart again.
 *
 * The drift they guard is a real one rather than a theoretical one, because
 * the family is expressed in two different places: the header icons carry
 * their size and line weight as SVG ATTRIBUTES, which no custom property can
 * reach, while the swatches read tokens. So the attributes are read back out
 * of the chrome components here and compared with the tokens the swatches
 * consume — and the browser lanes measure the same pair in a real engine.
 * ======================================================================== */

// The chrome's own glyph, as the markup states it: the size attribute both
// header icons carry, and the line weight the stroked one is drawn at.
const chromeGlyphAttributes = (source) => {
  const svg = /<svg[^>]*>/.exec(source);
  assert.ok(svg, 'a chrome control renders no inline SVG at all');
  return {
    width: Number(/\bwidth="([\d.]+)"/.exec(svg[0])?.[1]),
    height: Number(/\bheight="([\d.]+)"/.exec(svg[0])?.[1]),
  };
};

// One rule from one file, by exact selector. Fails loudly rather than
// returning undefined: a rule this pin cannot find is a rule it cannot
// measure, which is precisely where an undersized or re-chromed swatch hides.
const ruleNamed = (file, selector) => {
  const found = sweptRules.find((rule) => rule.file === file && rule.selector === selector);
  assert.ok(found, `${file} no longer declares "${selector}"; this pin has lost its subject`);
  return found;
};

const declaredValue = (rule, property) =>
  declarationsOf(rule.body).find((declaration) => declaration.property === property)?.value;

test('the reading-mode swatches are drawn in the header chrome grammar', () => {
  const menuFile = 'lib/ThemeMenu.svelte';
  const tokens = tokensFor('light');

  /* The shared grammar, resolved through however many var() hops the token
     layer takes. A token that stopped resolving would fail inside
     resolveToken rather than quietly comparing undefined to undefined. */
  const glyphSize = resolveToken('--swatch-glyph-size', tokens);
  const strokeWidth = resolveToken('--swatch-stroke', tokens);
  assert.equal(
    glyphSize,
    resolveToken('--chrome-icon-glyph-size', tokens),
    'the swatch glyph no longer derives from the chrome glyph token; the two families can now drift'
  );
  assert.equal(
    strokeWidth,
    resolveToken('--chrome-icon-stroke', tokens),
    'the swatch line weight no longer derives from the chrome stroke token'
  );

  /* ...and the tokens are the truth about the chrome, not a hopeful copy of
     it. Both header icons state their painted size as an attribute, so the
     attribute is what this compares against: a chrome glyph resized in the
     markup and nowhere else is exactly the drift the owner's complaint was
     made of, in the opposite direction. */
  const glyphPx = lengthInPx(glyphSize);
  assert.ok(glyphPx !== null, `--chrome-icon-glyph-size is "${glyphSize}", which this pin cannot measure`);
  for (const file of ['lib/components/RefreshAll.svelte', menuFile]) {
    const painted = chromeGlyphAttributes(componentSources[file]);
    assert.equal(
      painted.width,
      glyphPx,
      `${file} paints its chrome glyph at ${painted.width}px while the shared token says ${glyphPx}px`
    );
    assert.equal(painted.height, glyphPx, `${file} paints a chrome glyph that is not square`);
  }
  const chromeStroke = /stroke-width="([\d.]+)"/.exec(componentSources['lib/components/RefreshAll.svelte']);
  assert.ok(chromeStroke, 'the refresh glyph is no longer a stroked line icon; the family has no line weight left to share');
  assert.equal(
    Number(chromeStroke[1]),
    Number(strokeWidth),
    `the refresh glyph is drawn at ${chromeStroke[1]} while the shared token says ${strokeWidth}`
  );

  /* The swatch wears the chrome's absence of chrome. Each of these is one
     innocent-looking declaration away from returning, and together they are
     what the owner actually rejected: a disc, a rim, a fill, and a ring. */
  const swatch = ruleNamed(menuFile, '.swatch');
  assert.equal(declaredValue(swatch, 'border'), '0', 'a swatch wears a border again');
  assert.equal(declaredValue(swatch, 'background'), 'none', 'a swatch wears a fill again');
  for (const rule of sweptRules.filter((entry) => entry.file === menuFile)) {
    if (!selectorParts(rule.selector).some((part) => part.startsWith('.swatch'))) continue;
    for (const { property, value } of declarationsOf(rule.body)) {
      assert.ok(
        !/^(border-radius|box-shadow)$/.test(property) || rule.selector.includes('::after'),
        `${rule.selector} paints ${property}: ${value}; the swatches are line icons, not discs`
      );
      assert.ok(
        !(property === 'background' && value.startsWith('var(')) || rule.selector.includes('::after'),
        `${rule.selector} paints a surface behind a swatch again`
      );
    }
  }

  /* The 44px hit area survives the shrink — that is the whole point of
     shrinking only what is PAINTED — and it stays a literal so the
     touch-floor walk above can keep measuring it. */
  assert.equal(declaredValue(swatch, 'inline-size'), '2.75rem');
  assert.equal(declaredValue(swatch, 'block-size'), '2.75rem');
  assert.equal(
    lengthInPx(declaredValue(swatch, 'inline-size')) / glyphPx > 2,
    true,
    'the painted glyph has grown to most of its own hit area again'
  );

  // Translucent at rest, fully present when pointed at or chosen: the
  // swatch's answer to the chrome's ink change, and the reason the popover
  // reads as quiet rather than as five objects demanding attention.
  const rest = Number(resolveToken('--swatch-rest-opacity', tokens));
  const active = Number(resolveToken('--swatch-active-opacity', tokens));
  assert.ok(rest > 0 && rest < active, `a swatch rests at ${rest} against an active ${active}`);
  assert.equal(declaredValue(swatch, 'opacity'), 'var(--swatch-rest-opacity)');

  /* Selection is never color alone (the dataviz floor). The chosen mode
     carries a bar under its glyph, drawn by a pseudo-element so that
     choosing a mode repaints without moving the swatch beside it. */
  const chosen = ruleNamed(menuFile, ".swatch[aria-pressed='true']::after");
  assert.equal(declaredValue(chosen, 'content'), "''");
  assert.equal(declaredValue(chosen, 'position'), 'absolute');
  for (const property of ['inline-size', 'block-size']) {
    const value = declaredValue(chosen, property);
    assert.match(
      value ?? '',
      /^var\(--swatch-mark-/,
      `the chosen-mode mark sizes its ${property} as "${value}"; every dimension here is a token`
    );
    assert.ok(
      Number.parseFloat(resolveToken(/var\((--[a-z-]+)\)/.exec(value)[1], tokens)) > 0,
      `the chosen-mode mark resolves to no ${property}, so selection is carried by color alone`
    );
  }

  /* Every dimension the component states is a token — no raw px, no raw
     line weight, no second copy of a size that styles.css already owns. The
     44px hit box is the one deliberate literal, for the reason above. */
  for (const rule of sweptRules.filter((entry) => entry.file === menuFile)) {
    for (const { property, value } of declarationsOf(rule.body)) {
      if (!/^(inline-size|block-size|stroke-width|opacity|gap|padding)$/.test(property)) continue;
      assert.ok(
        value.startsWith('var(') || value === '2.75rem' || value === '0',
        `${rule.selector} sets ${property}: ${value}; a dimension here is a token with a global default`
      );
    }
  }
});
