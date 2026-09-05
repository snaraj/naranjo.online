import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const [fallback, component, styles, themeRegistry, themeMenu, blocks] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/themes.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/ThemeMenu.svelte', import.meta.url), 'utf8'),
  // The block layer's own type declarations. The status-ink pin below derives
  // the meter's severity names from the union declared there rather than
  // restating them, so the two cannot drift.
  readFile(new URL('../src/lib/blocks.ts', import.meta.url), 'utf8'),
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
  // The description and the link-preview identity live in the STATIC head
  // (0.1.52): the scrapers that build message previews read the document as
  // served and run no script, so a tag added at hydration does not exist for
  // them — and the component must not add a second copy of the description
  // the static shell already carries.
  assert.match(fallback, /name="description"/);
  assert.match(fallback, /property="og:title"/);
  assert.match(fallback, /property="og:image"/);
  assert.match(fallback, /name="twitter:card"/);
  assert.doesNotMatch(component, /name="description"/);
  assert.match(component, /<main aria-labelledby="page-title">/);
  assert.match(component, /<h1 id="page-title">[^<]+<\/h1>/);
  // The tab mark rides in the same static head and for the same reason
  // (issue 239): a document that declares no icon shows the browser's blank
  // glyph and is probed for /favicon.ico on every visit.
  assert.match(fallback, /<link rel="icon"[^>]*href="\/favicon\.svg"/);
  assert.match(fallback, /<link rel="icon"[^>]*type="image\/svg\+xml"/);
});

/* The failure the static shell is FOR (issue 239). It is not the no-JavaScript
 * case — that one has a <noscript> of its own below — but the case where the
 * entry module was asked for and never arrived: degraded transport, or the
 * brief post-deploy window where a cached shell names assets the answering pod
 * no longer has. The shell used to answer that with a bare heading on an empty
 * page, which reads as a broken site and offers the reader nothing.
 *
 * Structure and markers only, never copy: the words are the owner's to change,
 * the shape is the contract. */
test('the static shell states its own boot failure and offers a way out (issue 239)', () => {
  const shell = /<main[^>]*data-static-fallback[^>]*>([\s\S]*?)<\/main>/.exec(fallback)?.[1];
  assert.ok(shell, 'the static fallback element is not where this pin expects it');
  const status = /<p data-boot-status>([\s\S]*?)<\/p>/.exec(shell)?.[1];
  assert.ok(
    status,
    'the shell carries no boot-status line; a visitor whose module never arrives reads a bare heading and is told nothing'
  );
  assert.match(status, /\S/, 'the boot-status line is empty');
  assert.match(
    status,
    /<a href="\/">[^<]+<\/a>/,
    'the boot status offers no way to try again — the retry must be a plain same-origin link, because the visitor it is for has no working script'
  );
  assert.match(
    shell,
    /<noscript>[\s\S]*?data-boot-noscript[\s\S]*?<\/noscript>/,
    'scripting-off is a different truth from failed-to-load and needs its own element'
  );
  /* And the constraint the whole design is shaped by: the origin's policy is
     default-src 'self', it is not being widened, and neither a script-hosting
     status detector nor an inline handler may creep in here later. Every one
     of these would be silently DEAD under that policy, which is worse than
     absent — it looks like a working affordance in the source. */
  assert.doesNotMatch(
    fallback,
    /<script(?![^>]*\ssrc=)/,
    "an inline <script> is refused by default-src 'self'; it would be dead code wearing a feature's shape"
  );
  assert.doesNotMatch(fallback, /\son[a-z]+=["']/, "an inline event handler is refused by default-src 'self'");
  assert.doesNotMatch(fallback, /\sstyle=["']/, "an inline style attribute is refused by default-src 'self'");
});

test('initial source remains local and viewport-responsive', () => {
  for (const [name, source] of Object.entries({ fallback, component, styles })) {
    // The protocol-relative half is real coverage and stays: `//example.com`
    // is a remote origin exactly like `https://example.com`, and dropping it
    // would be a weakening. What the host lookahead adds is PRECISION. `//`
    // with nothing required after it also matched every JavaScript line
    // comment, so the sweep was a tripwire: the swept files happen to carry
    // no `//` today, and the first `// note` anyone wrote in one turned CI
    // red claiming a remote origin. Requiring a dotted authority separates
    // the two — `//cdn.example.net` still fails the file, `// a note` does
    // not. Honest residual, in the fail-closed direction only: a
    // single-label authority (`//cdn/x`) is not matched, and a comment
    // opening straight onto a dotted word (`//foo.bar`) still is.
    // One authority is admitted by name (0.1.52): the site's own canonical
    // origin, which the static head's link-preview tags must spell in full
    // because the Open Graph spec requires absolute URLs. That is a
    // SELF-reference — the og:image is fetched by external scrapers, never
    // by this page — so the invariant this sweep protects (the page loads
    // nothing remote) is untouched, and any OTHER dotted authority still
    // fails the file.
    assert.doesNotMatch(
      source,
      /(?:https?:)?\/\/(?!naranjo\.online[/"'\s])(?=[\w-]+\.)/,
      `${name} introduces a remote origin`
    );
  }
  /* The masthead's own size is the page's one viewport-responsive type step,
     and since the ledger redesign (owner directive, 2026-09-03, issue 287) it
     is a TOKEN rather than a literal on the h1: --masthead-size is the clamp,
     and the heading reads it. Both halves are pinned, because either alone is
     satisfiable by a page that is not responsive at all — a clamp nothing
     reads, or a heading reading a token that turned into a fixed length. The
     ceiling is the owner's drawing (180px) and the middle term is a viewport
     width, which is what wraps the name to two lines on a phone instead of
     pushing the document sideways. */
  assert.match(styles, /--masthead-size:\s*clamp\([^;]*vw[^;]*\);/);
  assert.match(styles, /h1 \{[^}]*font-size:\s*var\(--masthead-size\)/);
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

/* THE STATUS FAMILY, closed as a CLASS rather than as three names (issues
 * 138, 222, 229).
 *
 * Three separate defects arrived by the same route and are answered together
 * here. --panel-status-stale was READ by UsageTracker and DECLARED nowhere,
 * so its var() chain fell through to --panel-accent and a status borrowed the
 * brand mark's ink. --usage-meter-critical was read with a raw
 * `rgb(208, 59, 59)` behind it, which is a palette value living in the one
 * place the token floor forbids. And --color-border-strong, a non-text UI
 * boundary, sat below 1.4.11's 3:1 in three of the four reading modes.
 *
 * What every one of them has in common is that NOTHING WENT RED. A var()
 * fallback still paints, so a missing token looks exactly like a present one,
 * and a contrast failure looks like a design choice. So this pin asserts two
 * properties that no fallback can satisfy: every ink in the family RESOLVES
 * to a literal in every reading mode (resolveToken fails loudly on a dangling
 * name), and the literal it resolves to clears the floor on BOTH surfaces the
 * ink can land on — the panel card and the usage tile, which are different
 * surfaces and were never both measured before.
 *
 * The family is DERIVED, not listed. --panel-status-* and --color-status-*
 * are matched by pattern; the meter's own inks are derived from the severity
 * union the payload declares in lib/blocks.ts, so adding a fourth severity
 * there makes this pin demand a fourth declared ink on the same day, with
 * nobody remembering to extend an array here. The meter's non-color tokens
 * (thickness, track strength) are deliberately outside the family: they are
 * lengths and percentages, and a contrast floor over a length is nonsense. */
const severityNames = (() => {
  const union = /severity:\s*((?:'[a-z]+'\s*\|\s*)*'[a-z]+')\s*;/.exec(blocks);
  assert.ok(union, 'lib/blocks.ts no longer declares a severity union this pin can read');
  const names = [...union[1].matchAll(/'([a-z]+)'/g)].map(([, name]) => name);
  assert.ok(names.length >= 2, 'the severity union collapsed to one state; the meter ramp is gone');
  return names;
})();

const statusInkPattern = new RegExp(
  // --usage-insight-fill is named rather than derived because there is nothing
  // to derive it from: it is ONE bar, not a member of an enumerable family.
  // It belongs here anyway — it arrived by the identical route, read from the
  // component behind a fallback chain that ended at a raw rgb() literal.
  `^--(?:(?:panel|color)-status-[a-z0-9-]+|usage-meter-(?:${severityNames.join('|')})|usage-insight-fill)$`
);

// Every token in the family that the TOKEN LAYER declares, which is the set
// that must resolve and must be legible.
const statusInkNames = [
  ...new Set([...styles.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(([, name]) => name)),
].filter((name) => statusInkPattern.test(name));

test('every status ink is declared, resolves, and clears 1.4.11 on both surfaces it lands on', () => {
  assert.ok(
    statusInkNames.length >= 2 * severityNames.length + 1,
    `the token layer declares only ${statusInkNames.length} status inks; the family is one --panel-status-* and one --usage-meter-* per severity (${severityNames.join(', ')}), plus the insight bar's own fill`
  );
  // A non-text indicator's floor. Every one of these is redundant with shape
  // or with a printed figure — the meter prints its own percentage beside the
  // bar — so 3:1 is the correct floor and 4.5 would be the wrong one.
  const nonTextFloor = 3;
  for (const mode of ['light', 'auto-light', 'auto-dark', 'dark', 'slate', 'sepia']) {
    const tokens = tokensFor(mode);
    // BOTH surfaces. The panel card is what --panel-status-* paints on; the
    // usage tile is the page surface, and it is what the meter's own fill
    // paints on. They are different colors in every mode, and measuring only
    // the first is how a legible-on-the-card ink can be illegible where it
    // actually renders.
    const surfaces = {
      'the panel card': resolveToken('--panel-surface', tokens),
      'the usage tile': resolveToken('--usage-tile-surface', tokens),
    };
    for (const name of statusInkNames) {
      // Resolution itself is half the pin: a token read but never declared
      // fails HERE rather than silently painting whatever its fallback said.
      const ink = resolveToken(name, tokens);
      for (const [where, background] of Object.entries(surfaces)) {
        const ratio = contrastRatio(ink, background);
        assert.ok(
          ratio >= nonTextFloor,
          `${mode}: ${name} (${ink}) on ${where} (${background}) is ${ratio.toFixed(2)}:1, below ${nonTextFloor}:1`
        );
      }
    }
    // The card seam (issue 138). Same floor, same two surfaces, and the same
    // reason: below 3:1 the boundary is painted but not reliably perceivable,
    // which matters most where a card sits against full-bleed media.
    const border = resolveToken('--color-border-strong', tokens);
    for (const [where, background] of Object.entries(surfaces)) {
      const ratio = contrastRatio(border, background);
      assert.ok(
        ratio >= nonTextFloor,
        `${mode}: --color-border-strong (${border}) on ${where} (${background}) is ${ratio.toFixed(2)}:1, below ${nonTextFloor}:1`
      );
    }
  }
});

/* And the other half of the class: a component may not READ a status ink the
 * token layer does not declare, and may not hide the question behind a
 * fallback. Without this, the pin above is satisfiable by deleting the read —
 * or by adding a new one that resolves to a literal nobody measured. */
test('no component reads a status ink that is undeclared or fallback-shielded', () => {
  const declared = new Set(statusInkNames);
  let reads = 0;
  for (const [name, source] of Object.entries(componentStyles)) {
    for (const [, token, tail] of source.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/g)) {
      if (!statusInkPattern.test(token)) continue;
      reads += 1;
      assert.ok(
        declared.has(token),
        `${name} reads ${token}, which the token layer declares nowhere; its var() chain paints something the contrast guard never measured`
      );
      assert.equal(
        tail,
        ')',
        `${name} reads ${token} with a fallback behind it; the token is declared, so the fallback can only hide the day it stops being`
      );
    }
  }
  assert.ok(reads > 0, 'no component reads a status ink at all; this sweep proves nothing');
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
    '#f1efe7', '#e7e4da', '#d9d5c9', '#87877c', '#3d434f', // light ramp
    // The true dark. Every one of these is a grey — red, green and blue
    // equal — which is the whole claim the mode makes and the one a repaint
    // toward navy would have to break to get past here.
    '#121212', '#1e1e1e', '#2e2e2e', '#383838', '#6c6c6c', '#a0a0a0', '#e0e0e0',
    '#2a2a2a', // its empty heatmap tile, the one hueless step the green ramp keeps
    // The green calendar (owner directive, 2026-09-04, issue 292): four
    // ramps of four steps plus each palette's own peak, every value its own
    // hex so a repaint of one mode cannot quietly restate another's.
    '#aadf9f', '#72cc6c', '#37b043', '#158a31', '#00d95a', // light greens + peak
    '#17492a', '#1f7d3d', '#2eb457', '#5ee97b', '#8dff97', // dark greens + peak
    '#1e4b35', '#237f48', '#34b762', '#6ceb8a', '#9dffb2', // slate greens + peak
    '#3d5330', '#55823f', '#79b455', '#a9e37e', '#ccff8a', // sepia greens + peak
    '#161a23', '#1d222d', '#2a3040', '#5f6a84', '#b9c2d4', // slate ramp
    '#1b1612', '#28221d', '#312a25', '#3e362f', '#7b6d60', '#b79d7e', '#f4eaea', // browntown seeds
    // The token-usage category sets (issue #142): four modes times six
    // slots, every value its own hex — including dark's neutral steps,
    // which the r==g==b sweep above also holds to the mode's no-hue rule.
    '#5f6672', '#2a63b8', '#96550a', '#0b8a6a', '#6d4bb8', '#a3315e', // light categories
    '#565656', '#6f6f6f', '#868686', '#a2a2a2', '#bebebe', '#dadada', // dark category steps
    '#5a657e', '#3f81d9', '#b87e1f', '#1f9e7d', '#8a68d8', '#cf5585', // slate categories
    '#77685a', '#5c88d8', '#bb7d24', '#2f9e7d', '#8f6ad4', '#d15a88', // sepia categories
    // The two status inks added at issues 222 and 229, each with its own
    // darkened twin for the light card. They are enumerated here for the
    // same reason every value above is: a status ink restated at a second
    // consumer is a value that can drift into two.
    '#d9a521', '#8f6100', '#e05a5a', '#c62828',
  ];
  // The neutrality claim, measured rather than asserted: a true dark whose
  // surfaces carry a hue is the exact defect this mode was added to fix, and
  // a hex list alone cannot see one arriving in a later repaint.
  for (const [name, value] of Object.entries(paletteLiterals(styles))) {
    if (!name.startsWith('--palette-dark-')) continue;
    // The ONE exception, named: the commits calendar is green in every mode
    // (owner directive, 2026-09-04, issue 292), the true dark's included. Its
    // surfaces, inks, borders and category steps stay hueless; only the
    // ramp's four levels and its peak carry the hue, and the empty tile
    // (level 0) is still a grey the sweep below checks.
    if (/^--palette-dark-grid-(?:[1-4]|peak)$/.test(name)) continue;
    const [red, green, blue] = [1, 3, 5].map((offset) => value.slice(offset, offset + 2));
    assert.ok(
      red === green && green === blue,
      `${name} is ${value}; the dark mode is the NEUTRAL one, so every channel must agree — a tinted value belongs in slate or sepia`
    );
  }
  for (const value of uniqueValues) {
    assert.equal(occurrences(styles, value), 1, `${value} must be defined exactly once`);
  }
  for (const anchor of ['#faf9f5', '#10131a']) {
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
// popover of one swatch per mode, each swatch an inline-SVG line icon drawn
// in ONE ink (currentColor) with a genuinely different SILHOUETTE per mode
// (issue #180: half-sun/half-moon on auto, sun on light, plain crescent on
// dark, crescent-with-stars on slate, split disc on sepia) — shape tells the
// five apart now, never color. No icon assets, no hex copies. These pins
// cover DOM wiring only; the open/select/close/reopen behavior is EXECUTED
// against src/lib/disclosure.ts in toggle.test.mjs.
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

  // Every glyph paints ONE ink — currentColor — never a palette token, so no
  // mode carries its own color rule and there is zero theme branching to
  // drift out of step (issue #180). .chip is the filled-shape class and it
  // must resolve unconditionally, not per swatch-{id}.
  assert.match(themeMenu, /\.chip \{\s*fill: currentColor;/);
  assert.doesNotMatch(
    themeMenu,
    /\.swatch-(light|dark|slate|sepia|auto)[^{]*\{\s*fill:/,
    'a swatch reads its own color rule again; shape alone must tell the modes apart'
  );
  // Never a hex anywhere in the component.
  assert.doesNotMatch(
    themeMenu,
    /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z])/,
    'the toggle must reference tokens, never hex values'
  );

  // Five distinct silhouettes, one branch per mode id — a shared branch (the
  // old "one moon for all three darks") is exactly the regression issue #180
  // reports, so each id gets its own markup to diverge from. Sepia is the
  // final, unconditional {:else} — the fifth and last mode needs no
  // condition of its own once the other four have theirs.
  for (const id of ['auto', 'light', 'dark', 'slate']) {
    assert.match(
      themeMenu,
      new RegExp(`mode\\.id === '${id}'`),
      `no dedicated branch draws the "${id}" glyph; it would share markup with a neighbour`
    );
  }
  assert.match(themeMenu, /\{:else\}/, 'sepia has no dedicated branch to draw its glyph in');
  // The three dark variants are the owner's literal complaint ("all look
  // exactly the same") — dark stays a bare crescent, slate adds star marks
  // beside it, and sepia is not a crescent at all, so no two of the five
  // <svg> blocks can be byte-identical.
  const glyphBlocks = [...themeMenu.matchAll(/<svg class="glyph"[\s\S]*?<\/svg>/g)].map((m) => m[0]);
  assert.equal(glyphBlocks.length, 5, 'the popover does not render five glyphs');
  assert.equal(new Set(glyphBlocks).size, 5, 'two reading-mode glyphs render identical markup');
  assert.doesNotMatch(themeMenu, /class="crater"/, 'the retired per-mode crater mark is still drawn');

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

/* The units this parser can convert, and their exact ratio to one CSS pixel.
 * The absolute family is FIXED by the spec — 1in = 96px = 72pt = 6pc = 2.54cm
 * = 25.4mm = 101.6Q — so converting it is arithmetic rather than a guess. rem
 * is resolved at the 16px root default the page ships with; a reader who
 * enlarges that only ever makes these boxes bigger.
 *
 * Deliberately ABSENT, and this is a choice rather than an oversight: ch, em,
 * ex, cap, ic and lh are font-relative. Resolving them needs a computed font
 * size for the exact element the declaration lands on — a font a SOURCE pin
 * does not have and must not invent, since a guessed ratio would report a
 * confident wrong number instead of an honest refusal. They take the null
 * path, and every caller fails loudly on null (below). */
const lengthUnitsInPx = {
  px: 1,
  rem: 16,
  in: 96,
  pc: 16,
  pt: 96 / 72,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
};

/* A length literal in CSS pixels, or null when this parser cannot read it.
 * Null is never treated as "fine": every caller fails loudly on it, because a
 * value the parser does not understand is precisely where an undersized one
 * would hide. CSS unit identifiers are ASCII case-insensitive, so `Q` and `q`
 * are the same unit and both are read. */
/* A token's declared default, read out of the :root layer — `--card-link-target`
 * to `2.75rem`. It resolves ONE hop and no fallback: a token whose default is
 * itself a var(), or one declared nowhere, comes back null and the caller
 * reports an unmeasurable value exactly as it always did. Chasing a chain here
 * would mean re-implementing the cascade in a test, and a pin that guesses at
 * a resolved value is worse than one that admits it cannot see. */
function rootTokenValue(token) {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(styles);
  if (!root) return null;
  const declared = new RegExp(`(?:^|;|\\n)\\s*${token}\\s*:\\s*([^;]+);`).exec(root[1]);
  return declared === null ? null : declared[1].trim();
}

/* THE TOKEN LAYER IS NOT A BLIND SPOT (issue 243). This used to return null
 * for `var(--card-link-target)`, which put two of this file's own pins in
 * direct conflict: FeedCard.svelte is swept for hardcoded lengths (a card
 * dimension must be tunable from the token layer), while the touch-floor walk
 * below demands a number it can compare against 44px. A control on the card
 * primitive could satisfy one or the other and never both.
 * Resolving one hop settles it in the direction that measures MORE rather than
 * less: a tokenised size is now checked against the floor instead of being
 * waved through, so the walk gained a control rather than losing an argument. */
function lengthInPx(value) {
  const trimmed = value.trim();
  const token = /^var\(\s*(--[\w-]+)\s*\)$/.exec(trimmed);
  if (token) {
    const declared = rootTokenValue(token[1]);
    return declared === null ? null : lengthInPx(declared);
  }
  const parsed = /^([\d.]+)([a-z]+)$/i.exec(trimmed);
  if (!parsed) return null;
  const perPx = lengthUnitsInPx[parsed[2].toLowerCase()];
  return perPx === undefined ? null : Number(parsed[1]) * perPx;
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
  /* Overflow alignment (owner directive of 2026-09-03, issue 287): `safe`
     centres a row while it fits and falls back to its start when it does not,
     which is what keeps the section nav's first link reachable on a phone.
     Engines inside the support window that lack it drop the whole
     declaration, so it is exactly this class of upgrade and takes the same
     obligation as the other three. */
  {
    name: 'a safe overflow alignment',
    used: /\bsafe\s+(?:center|start|end|flex-start|flex-end)\b/,
    tested: /\bsafe\s+(?:center|start|end|flex-start|flex-end)\b/
  }
];

const supportsQueries = (rule) => rule.enclosing.filter((at) => at.startsWith('@supports'));

test('every progressive feature is guarded, and every guard has a base under it (issue #26)', () => {
  /* CSS offers exactly two ways to state a fallback for a REGULAR property,
     and both are accepted here:
       * a plain earlier declaration of the SAME property in the SAME rule,
         which an engine keeps precisely because it discards the later one it
         cannot parse (the meter track uses this);
       * an @supports block, which is what a fallback spanning several
         properties or living in a different rule needs (the page height, the
         safe-area padding and the sepia glyph use this).
     Neither works for a CUSTOM property (coordinator quality pass on issue
     186): a custom property accepts any value syntax unconditionally, so an
     "earlier declaration of the same custom property" is not kept as a
     fallback the way a regular property's is — the later declaration always
     wins outright, parseable or not, which makes that pattern dead code
     wearing a fallback's shape. A custom property's real fallback lives
     wherever it is CONSUMED: if the feature makes its own declaration
     invalid at computed-value time, the custom property resolves to its
     guaranteed-invalid value, and a var() reference with a second, fallback
     argument (--header-inset-inline's own use site, .page-header below)
     is what actually recovers from that — so a bare feature-bearing custom
     property declaration is accepted here PROVIDED every place that reads
     it supplies that fallback argument, checked separately below. What is
     still refused in every case: a progressive value with nothing underneath
     it, in whichever of the three forms applies to its property. */
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
        if (property.startsWith('--')) {
          // The custom-property case: every var(property, ...) reference
          // anywhere in the swept rules must carry a fallback argument — a
          // bare var(property) would compute to the initial value, not to
          // any base, the moment this declaration goes invalid.
          const references = sweptRules.flatMap((candidate) =>
            [...candidate.body.matchAll(new RegExp(`var\\(\\s*${property}\\s*(,[^)]*)?\\)`, 'g'))]
          );
          assert.ok(
            references.length > 0,
            `${rule.file}: "${property}" sets ${feature.name} but is never read anywhere, so its fallback obligation cannot even apply`
          );
          for (const reference of references) {
            assert.ok(
              reference[1] !== undefined,
              `${rule.file}: a var(${property}) reference has no fallback argument — ${feature.name} going unsupported would resolve this custom property to its initial value instead of a base`
            );
          }
          return;
        }
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
  /* The MINIMUMS are here beside the definite sizes, and their absence was a
     real hole this walk had: a control declared `min-inline-size: 1px` sized
     no axis by this map's old reckoning and passed a floor it plainly broke.
     A minimum is the only lower bound a flexible control has, so it is exactly
     the declaration the floor is about — and the two hidden-but-focusable
     controls on this page (the refresh control, the gallery's position dots)
     are sized this way and nothing else, so without these four rows the walk
     measured neither of them. */
  const axes = {
    'inline-size': 'inline',
    width: 'inline',
    'min-inline-size': 'inline',
    'min-width': 'inline',
    'block-size': 'block',
    height: 'block',
    'min-block-size': 'block',
    'min-height': 'block'
  };
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
  /* The count is pinned because the DANGEROUS failure of a sweep is silence:
     a control that stops matching measures nothing and reports nothing, and a
     `>= 0` walk is green either way. It is a floor rather than an equality so
     that adding a properly-sized control never fails this — but a control
     losing its size declaration does. A control sized only by its padding is a
     legitimate shape this pin still says nothing about; the browser lanes
     measure those, because only a rendered box knows how big padding made it.

     SIXTEEN, down from the eighteen the floor was set at, and the two that
     left are accounted for rather than allowed for: the owner deleted the
     token panel's display menu on 2026-08-28 ("remove this entire menu"), and
     UsageFilterMenu.svelte's `.filter-trigger` was the only control in the
     tree whose inline and block minimums this walk measured and whose class no
     longer exists. Its sibling `.usage-view` pills went with it. Re-deriving
     the count when a control is deliberately REMOVED is what keeps the pin
     honest in the direction it cares about; it is still exactly as strict
     about a surviving control that stops declaring a size, which is the
     regression it was written for. */
  assert.ok(
    measured >= 16,
    `only ${measured} control dimensions were measured; the walk found 16 after the display menu was deleted, so it has lost sight of a control rather than gained one`
  );
});

/* Every class an <a> carries in the markup, dropping the parts built at
 * runtime — the same walk controlClasses does, narrowed to links, because the
 * question below is about link paint rather than control size. */
const anchorClasses = (source) =>
  [...source.matchAll(/<a\b[^>]*?\bclass="([^"]*)"/g)]
    .flatMap(([, list]) => list.split(/\s+/))
    .filter((name) => name.length > 0 && !name.includes('{') && !name.includes('}'));

/* No resting underline anywhere, and no link identified by color alone
 * (owner directive, 2026-08-25: the repo card titles "render underlined",
 * and the owner wants every always-on underline off the site).
 *
 * Both halves ride here because either alone is the other's defect. Removing
 * the underline and stopping there identifies a link by color for readers who
 * can tell the two colors apart and by nothing at all for the rest — which is
 * why this walks EVERY link class the markup declares rather than the one that
 * was reported, and why it insists each one still marks itself the moment
 * intent is shown. What replaces the resting mark is position and role: a nav
 * link sits in one labelled row under the page name, and a card title sits in
 * a card's header at the card's own title step — neither is a link buried in
 * running prose, which is the case the underline convention exists for. */
test('no link wears a resting underline, and every one marks itself on intent', () => {
  const classes = new Set(Object.values(componentSources).flatMap(anchorClasses));
  assert.ok(
    classes.size >= 4,
    `the markup walk found ${classes.size} link classes; the page declares at least four, so the walk is broken`
  );
  for (const name of classes) {
    /* The link's RESTING rules: the selector list contains the bare class, so
       a :hover or :focus-visible rule (a different selector string) is not one
       of them. */
    const resting = sweptRules.filter((rule) => selectorParts(rule.selector).includes(`.${name}`));
    assert.ok(
      resting.length > 0,
      `".${name}" is a link with no rule of its own, so nothing removes the browser's default underline from it`
    );
    const declarations = resting.flatMap((rule) => declarationsOf(rule.body));
    assert.ok(
      declarations.some(({ property, value }) => property === 'text-decoration' && value === 'none'),
      `".${name}" never states text-decoration: none, so it wears the browser's default underline at rest`
    );
    assert.ok(
      !declarations.some(({ property, value }) => property.startsWith('text-decoration') && /underline/.test(value)),
      `".${name}" draws an underline at rest`
    );
    /* And the other direction: hover or keyboard focus must change something
       a reader can see. An underline, or the ink — either is a second channel
       on top of position and role. */
    const marksIntent = sweptRules.some(
      (rule) =>
        selectorParts(rule.selector).some(
          (part) => part.includes(`.${name}`) && /:hover|:focus-visible/.test(part)
        ) &&
        declarationsOf(rule.body).some(
          ({ property, value }) =>
            (property === 'text-decoration' && /underline/.test(value)) || property === 'color'
        )
    );
    assert.ok(
      marksIntent,
      `".${name}" never marks itself on hover or focus, so with the resting underline gone it is a link nothing announces`
    );
  }
});

/* The page's own top rhythm (owner directive, 2026-08-25: "Samuel Naranjo"
 * sat hard against the top of the viewport, "it almost feels like it's about
 * to escape"). The header row is fixed, so it reserves no flow space and
 * #app reserved none either — the h1 began at the document's first pixel.
 *
 * Recomputed here from the two tokens it is derived from rather than compared
 * with a number somebody typed: the reserve is the chrome row's own top inset
 * plus the 44px hit box it is, so the name begins exactly where the chrome
 * ends and a change to either token moves it or turns this red. */
test('the page reserves the space above its name, derived from the chrome that space clears', () => {
  const token = (name) => {
    const found = new RegExp(`--${name}:\\s*([^;]+);`).exec(stylesCode);
    assert.ok(found, `--${name} is gone; the top rhythm is derived from it`);
    return found[1].trim();
  };
  assert.equal(token('page-top-space'), 'calc(var(--page-gutter) + var(--page-rail-size))');
  const gutter = lengthInPx(token('page-gutter'));
  const rail = lengthInPx(token('page-rail-size'));
  assert.ok(gutter !== null && rail !== null, 'the top rhythm is built from a length this pin cannot read');
  assert.equal(gutter + rail, 60, 'the reserved top space is no longer the 60px the chrome row occupies');
  // Used in BOTH branches of #app's padding, and the guarded one still
  // widens for a notch rather than replacing the rhythm with it: max() takes
  // the larger, so an inset shorter than the rhythm changes nothing and a
  // taller one wins.
  assert.match(stylesCode, /#app \{[^}]*padding-block: var\(--page-top-space\) 2rem;/);
  assert.match(
    stylesCode,
    /padding-block: max\(var\(--page-top-space\), env\(safe-area-inset-top\)\) calc\(2rem \+ env\(safe-area-inset-bottom\)\);/
  );
  assert.doesNotMatch(
    stylesCode,
    /padding-block: max\(0px, env\(safe-area-inset-top\)\)/,
    'the zero-height top reserve is back; the page name touches the top of the viewport again'
  );
});

/* THE CORNER IS GONE, AND SO IS THE CLASS OF DEFECT IT KEPT PRODUCING (owner
 * directive, 2026-09-03, issue 287).
 *
 * Issue 241's measurement stands and is worth keeping written down: on 0.1.54,
 * in Chromium and WebKit alike, <main> ended at exactly the reading-mode
 * trigger's own end edge at every phone width (at 320px the trigger box was
 * x 260-304 and main[16,304]), and scrolling put body text — bullets, card
 * bylines, a card title — under a 44px control 9 to 11 times per sweep at 320,
 * 360, 390, 412 and 768. Issue 241 answered it by RESERVING the control's lane
 * on #app's inline end, which charged every row of the page 44px for one
 * corner — the ~60px dead strip the owner then reported (issue 264). Issue 264
 * answered THAT by re-aiming the control at the document below the breakpoint,
 * so it left with the page instead of owning a corner of the viewport. And
 * issue 219 answered a third face of the same thing — content showing THROUGH
 * a control that painted nothing — with a translucent plate behind it.
 *
 * The ledger removes the cause all three were treating. The chrome is a ROW
 * across the sheet now, in the document's own flow, between two rules: it
 * cannot pass over scrolled content, because it scrolls with it; it cannot
 * take a lane from the column, because it spans the same column; and it needs
 * no plate, because nothing passes beneath it. So this pin changed direction
 * rather than value — what it proves now is that the row is in flow and that
 * none of the three retired mechanisms has come back.
 *
 * The one thing that did NOT change is the reason the corner was ever
 * defended: the controls in the row still clear the 44px touch floor, which
 * the floor sweep above measures on every one of them. */
test('the chrome row is in the document, so no control owns a corner of the page (issues 219, 241, 264, 287)', () => {
  // In flow: neither of the two positioning schemes that took it out of the
  // document survives, in either range.
  assert.doesNotMatch(
    stylesCode,
    /\.page-header \{[^}]*position:\s*(?:fixed|absolute)/,
    'the chrome row is out of the document flow again; a row that floats over the page is the corner all three of these issues were about'
  );
  assert.doesNotMatch(
    stylesCode,
    /@media not all and \(min-width: 67\.5rem\) \{\s*\.page-header \{\s*position:/,
    'the narrow-range positioning override is back, so the row is floating again in one range'
  );

  // The lane the column used to pay for is still not being paid for, in any
  // of the three spellings issue 264 retired.
  assert.doesNotMatch(
    stylesCode,
    /padding-inline-end: calc\(var\(--page-gutter\) \+ var\(--page-rail-size\)\)/,
    'the phone column is paying for the control lane again; the owner reported that strip as a defect'
  );
  assert.doesNotMatch(
    stylesCode,
    /padding-inline-end: calc\(max\(var\(--page-gutter\), env\(safe-area-inset-right\)\) \+ var\(--page-rail-size\)\)/,
    'the inset-aware copy of the retired control lane is back'
  );
  assert.doesNotMatch(
    stylesCode,
    /#app \{[^}]*padding-inline-end[^}]*var\(--page-rail-size\)/,
    'the page reserves a rail-sized lane on #app again, by some other spelling'
  );

  // The plate is gone with the float it existed to soften. It answered
  // content showing THROUGH a viewport-glued control; a row in the flow has
  // nothing passing beneath it, so a translucent wash and a backdrop blur
  // would be chrome nothing needs.
  assert.doesNotMatch(
    stylesCode,
    /\.page-header \{[^}]*backdrop-filter/,
    'the plate is back under a control that no longer floats over anything'
  );

  // What the row IS: the site's own hit lane tall, ruled UNDER like every
  // other head on the sheet — and only under (owner directive, 2026-09-04,
  // issue 294): a top rule sat directly beneath a phone browser's toolbar edge
  // and the two read as one band twice as thick.
  /* The reserve is the touch row PLUS the row's own rule (owner directive,
     2026-09-03, issue 287): the box is border-box and the static shell renders
     this header EMPTY, so a reserve stated as the control alone measured short
     of the row that arrives and mounting moved the page. The arithmetic is
     what makes the shell's promise keepable, so it names the ONE rule the row
     draws and nothing else. */
  /* THE NAME IS TWO LINES AT EVERY WIDTH (owner directive, 2026-09-04, issue
     294): the heading's box is its longest word, so the break lands at the
     space on a monitor exactly as it does on a phone, with the DOM text left
     as the name. Pinned where it is decided; the rendering lane for issue 294
     counts the two line boxes in every engine. */
  const masthead = /\nh1 \{([^}]*)\}/.exec(stylesCode);
  assert.ok(masthead, 'the masthead rule is gone');
  assert.match(masthead[1], /inline-size: min-content;/, 'the name is no longer boxed to its longest word');
  assert.match(masthead[1], /text-transform: lowercase;/);

  // The stylesheet states .page-header more than once (its width beside the
  // column's, its ceiling under the rails); the ROW is the block that
  // reserves its height, so that is the one read here.
  const rows = [...stylesCode.matchAll(/\.page-header \{([^}]*)\}/g)].map((found) => found[1]);
  const row = rows.find((body) => body.includes('min-block-size'));
  assert.ok(row, 'the chrome row no longer states its reserve');
  assert.match(row, /min-block-size: calc\(var\(--page-rail-size\) \+ var\(--ledger-heavy\)\)/);
  assert.match(row, /border-block-end: var\(--ledger-heavy\) solid var\(--ledger-rule\)/);
  assert.doesNotMatch(row, /border-block-start|border-top|border:/, 'the row grew a top rule back');

  // And the control inside it still clears the touch floor on both axes.
  assert.match(stylesCode, /\.icon-button\s*\{[^}]*inline-size:\s*2\.75rem/);
  assert.match(stylesCode, /\.icon-button\s*\{[^}]*block-size:\s*2\.75rem/);

  /* The two insets the floating control needed are retired with it: #app's own
     safe-area padding clears a notch for everything in the column, including
     this row, so a second answer to the same question would be a second set of
     numbers free to disagree with the first. */
  assert.doesNotMatch(
    stylesCode,
    /--header-inset-(?:block|inline)/,
    'the retired corner insets are back; #app already clears the safe area for everything inside it'
  );
});

test('an open modal stops the document scrolling behind it, without moving it (issue 241)', () => {
  /* MEASURED with the lightbox open on 0.1.54: +485px at an iPhone 13
     viewport and +1400px at 1280x720. showModal() makes the page inert to
     POINTER interaction only, so a wheel, a two-finger drag and PageDown all
     still scrolled it — and closing then returned the reader to a place they
     never chose, which is the same complaint issue 233 answered for the open
     half. */
  const locked = /html\[data-modal-open\] \{([^}]*)\}/.exec(stylesCode);
  assert.ok(locked, 'nothing stops the document scrolling behind an open modal');
  assert.match(locked[1], /overflow: hidden;/, 'the locked document can still be scrolled');
  /* The zero-CLS half, and it is not decoration: taking `overflow` away takes
     the scrollbar with it, so on a classic-scrollbar platform the reading
     column would widen the instant the lightbox opened and snap back on close
     — a layout shift caused by a control. The width the scrollbar was holding
     is given straight back as root padding.

     It is a MEASURED width, not a reserved gutter. `scrollbar-gutter: stable`
     on the root is the usual recipe and it was this fix's first draft; CI
     measured what it actually costs — a 15px strip reserved at rest on every
     classic-scrollbar platform, off-centring the column, cutting the phone
     column from 244px to 229px and pushing the fixed control 15px inboard —
     so the pin now holds the giveback to the state that needs it. */
  assert.match(
    locked[1],
    /padding-inline-end: var\(--modal-scrollbar-giveback, 0px\);/,
    'locking the scroll takes the scrollbar away and hands nothing back, so the column moves'
  );
  assert.doesNotMatch(
    stylesCode,
    /scrollbar-gutter/,
    'a reserved gutter charges every page view at rest for a strip only an open dialog needs'
  );
  // The state is raised by the component that opens the dialog, and released
  // by an effect teardown rather than by a pair of handlers that a torn-down
  // component would never reach.
  const gallery = componentSources['lib/components/MediaGallery.svelte'];
  assert.ok(gallery, 'the gallery component is not where this pin expects it');
  assert.match(gallery, /root\.setAttribute\('data-modal-open', 'true'\)/);
  /* BOTH halves of the release inside the effect's own teardown, matched as
     one block: a removal written into a close handler instead would leave the
     document locked forever when the component unmounts with the dialog open,
     which is the case no pair of handlers can reach. */
  assert.match(
    gallery,
    /return \(\) => \{\s*root\.removeAttribute\('data-modal-open'\);\s*root\.style\.removeProperty\('--modal-scrollbar-giveback'\);\s*\};/,
    'the lock and its giveback are not both released by the effect teardown'
  );
  /* The measurement reads the viewport against the root's own client box, and
     it must happen BEFORE the attribute goes up — after it, the scrollbar is
     already gone and the difference it measures is zero. */
  const measure = /const giveback = window\.innerWidth - root\.clientWidth;/.exec(gallery);
  assert.ok(measure, 'the giveback is not measured from the scrollbar the platform actually draws');
  assert.ok(
    measure.index < gallery.indexOf("root.setAttribute('data-modal-open'"),
    'the giveback is measured after the lock has already taken the scrollbar away, so it is always zero'
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
 * chosen — ringed a further two pixels, sitting directly under an 18px line
 * glyph that wears no chrome at all. They are one family now, and these pins
 * are what stops the two halves of it drifting apart again.
 *
 * A second chrome icon used to sit beside that glyph — the manual refresh
 * control's stroked arrow — and its own hardcoded stroke-width attribute was
 * this suite's second, independent data point for the swatch stroke pin
 * below. It is gone now (owner directive, issue 179: the site is responsive
 * on its own, and a failed read logs an error rather than waiting on a
 * visitor to press something), so only the reading-mode trigger remains, and
 * the stroke pin rests on the token alone.
 *
 * The drift this still guards is real rather than theoretical: the trigger
 * carries its size as an SVG ATTRIBUTE, which no custom property can reach,
 * while the swatches read a token. So the attribute is read back out of the
 * chrome component here and compared with the token the swatches consume —
 * and the browser lanes measure the same pair in a real engine.
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
  const painted = chromeGlyphAttributes(componentSources[menuFile]);
  assert.equal(
    painted.width,
    glyphPx,
    `${menuFile} paints its chrome glyph at ${painted.width}px while the shared token says ${glyphPx}px`
  );
  assert.equal(painted.height, glyphPx, `${menuFile} paints a chrome glyph that is not square`);

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

  /* Selection is COLORED IN, not underlined (owner directive, 2026-08-28:
     "do not underline the icon, instead color it in and grey out the ones
     not on use"). The chosen swatch joins hover and focus on the brand ink
     at full presence; unchosen swatches keep the muted rest opacity above.
     The bar pseudo-element is gone WITH its tokens — a chosen-mode ::after
     coming back is the retired design returning. aria-pressed still names
     the state for assistive technology, so the choice never rides on the
     visual channel alone. */
  const menuSource = componentSources[menuFile];
  assert.doesNotMatch(
    menuSource,
    /aria-pressed='true'\]::after/,
    'the retired chosen-mode underline bar is back'
  );
  assert.doesNotMatch(menuSource, /--swatch-mark-/, 'the underline mark tokens are read again');
  assert.doesNotMatch(styles, /--swatch-mark-/, 'the underline mark tokens are declared again');
  assert.match(
    menuSource,
    /\.swatch\[aria-pressed='true'\] \{[^}]*opacity: var\(--swatch-active-opacity\)/,
    'the chosen swatch no longer reaches full presence'
  );
  assert.match(
    menuSource,
    /\.swatch\[aria-pressed='true'\] \{[^}]*color: var\(--color-brand\)/,
    'the chosen swatch no longer wears the brand ink'
  );

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

/* ===========================================================================
 * Filled width beats the reading measure (owner directive 2026-08-26,
 * issue 212 — the THIRD report of the same shape)
 *
 * The live Professional Experience section broke every bullet at 672px inside
 * a 934px card, because --card-measure was 42rem and a capped block
 * start-ALIGNS in a full-width parent: the last ~28% of every card was blank.
 * The owner ruled the trade for this site — filled width wins over the
 * typographic measure — and set a standing rule with it: a content block
 * ending noticeably short of its container's inline end, without being a
 * deliberately centred composition, is a defect.
 *
 * This is the SOURCE half of that rule, and it is deliberately not a
 * measurement: the rendering lanes measure the boxes in a real engine, but a
 * lane only ever measures the surfaces the page happens to render today. A
 * width cap is decided in a DECLARATION, so a declaration is where the rule
 * binds the surfaces nobody has written yet. Both halves ship together, per
 * the two-halves convention the rendering-lane floors already follow.
 * ======================================================================== */

/* The ONE cap that survives the ruling, and the reason it does. It is not a
 * prose measure: .activity-entry-source is the first of three tracks in the
 * commit row (source | title | age), and the row's own last track ends exactly
 * on the panel's content edge — measured 0.0px short at 1440 and 1024 — so
 * capping the middle of a filled row bounds a repository slug rather than
 * leaving a right-hand side empty. Removing the cap would let one long slug
 * take the row from the commit message, which is the thing a reader is
 * actually scanning for. */
/* THE EXCEPTION LIST IS EMPTY, and the pin got STRICTER rather than weaker by
 * emptying (owner directive, 2026-09-03, issue 287). Its one entry was
 * `.activity-entry-source`, a track cap inside the activity tracker's entry
 * row; the ledger lays every row of every section on a grid, where a track's
 * width is the track's own definition and no element caps itself. So there is
 * no admitted cap left, which means ANY absolute inline cap anywhere in the
 * page's styles now fails — no selector can reach the exemption, because the
 * exemption has nothing in it.
 *
 * The non-vacuity counter that used to guard this list went with the list, on
 * the instruction the assertion itself carried ("retire it or the exception
 * list with it"). It proved the refusal was REACHED by an existing value; the
 * refusal is still reachable — it fires on the first `max-width: 42rem` anyone
 * writes — and a counter demanding that such a value exist today would be a
 * pin requiring the defect it forbids. */
const admittedInlineCaps = new Map([]);

/* How this pin reads ONE declared max-inline-size/max-width value. Exactly
 * three verdicts, and the third is why this function exists at all:
 *
 *   'fluid'      — the value cannot pin a box to a width its container knows
 *                  nothing about, so the pin says nothing about it. Three
 *                  forms qualify, and the reason differs per form:
 *                    · a FUNCTION — var(), min(), max(), clamp(), calc(),
 *                      env(), fit-content() — is either a token read (the
 *                      token layer is where a measure is allowed to live) or a
 *                      value computed against the space the box is given;
 *                    · a PERCENTAGE or a viewport/container-relative length
 *                      resolves against the container or the screen, so it
 *                      scales with the space instead of ignoring it;
 *                    · a KEYWORD that states no number: none/auto/initial/
 *                      unset/revert/revert-layer remove the cap outright, and
 *                      min-content/max-content/fit-content/stretch size from
 *                      the content or the container.
 *   a NUMBER     — a bare absolute length, in px: the refusable form, and the
 *                  exact shape --card-measure and .subsection-intro carried.
 *   'unreadable' — a bare length in a unit lengthInPx will not resolve, ch and
 *                  em foremost. It is NOT skipped. `max-inline-size: 65ch` is
 *                  the canonical spelling of a reading measure, so treating an
 *                  unreadable value as fine would wave through the precise
 *                  regression this pin exists to stop, wearing a different
 *                  unit — and it would break lengthInPx's own stated contract
 *                  that null is never treated as "fine".
 */
function inlineCapVerdict(value) {
  const trimmed = value.trim();
  if (trimmed.includes('(')) return 'fluid';
  if (/^[\d.]+(?:%|[dsl]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max))$/i.test(trimmed)) return 'fluid';
  if (
    /^(?:none|auto|initial|unset|revert|revert-layer|min-content|max-content|fit-content|stretch)$/i.test(
      trimmed
    )
  ) {
    return 'fluid';
  }
  const px = lengthInPx(trimmed);
  return px === null ? 'unreadable' : px;
}

test('the cap reader resolves every unit a measure can be written in (issue 212)', () => {
  /* 672px is 42rem, the number issue 212 removed — and it has a spelling in
     every absolute unit CSS has. Each of these is the SAME cap wearing a
     different unit, so each must reach the refusal rather than slip past the
     parser: pt, cm and Q were three of the five units that did slip past. */
  for (const [value, expected] of [
    ['672px', 672],
    ['42rem', 672],
    ['504pt', 672],
    ['17.8cm', 672.76],
    ['672Q', 634.96],
    ['672q', 634.96],
    ['7in', 672],
    ['42pc', 672],
    ['177.8mm', 672],
  ]) {
    const verdict = inlineCapVerdict(value);
    assert.equal(
      typeof verdict,
      'number',
      `${value} is a bare absolute cap and must reach the refusal, not be skipped as fluid or unreadable`
    );
    assert.equal(Math.round(verdict * 100) / 100, expected, `${value} resolved to the wrong width`);
  }

  /* The font-relative family, which this pin refuses to guess at. `65ch` and
     `42em` are the other two units that slipped past, and `65ch` in particular
     is how anyone restoring "a comfortable reading measure" would write it.
     They fail loudly at the call site instead of being converted from a font
     size a source pin cannot know. */
  for (const value of ['65ch', '42em', '80ex', '12lh', '30cap', '40ic', '672']) {
    assert.equal(
      inlineCapVerdict(value),
      'unreadable',
      `${value} must be refused as unreadable, never silently skipped — an unreadable cap is where an undersized one hides`
    );
  }

  // And the forms that genuinely cannot produce the defect stay skipped.
  for (const value of [
    'none',
    'auto',
    'fit-content',
    'max-content',
    '100%',
    '90vw',
    '80dvw',
    '50cqi',
    'var(--card-measure)',
    'min(var(--page-column-max), 100%)',
    'calc(100% - 2 * var(--page-rail-size))',
    'clamp(20rem, 50%, 60rem)',
  ]) {
    assert.equal(
      inlineCapVerdict(value),
      'fluid',
      `${value} is tied to the space the box is given; refusing it would fail a page that fills correctly`
    );
  }
});

test('no surface caps its prose short of the container it sits in (issue 212)', () => {
  /* The token itself. `none` is the whole ruling in one value.

     NOTHING READS IT ANY MORE, and that is a deliberate consequence of the
     ledger redesign (owner directive, 2026-09-03, issue 287) rather than a
     surface quietly dropping the channel. The two readers were EntryLog's
     `.entry-points` and `.entry-summary`; the entry log is gone, and the
     surfaces that replaced it — the ledger's drawer points and the table's
     one-line summaries — are laid out on the sheet's own grid, where a prose
     cap would leave exactly the blank inline end issue 212 closed. The token
     stays because it is the card primitive's per-instance channel: a single
     surface that genuinely wants a measure sets `--card-measure` on that one
     card, which is what keeps the day it is needed a call-site override rather
     than a component fork. The list below is what proves nobody has quietly
     reintroduced a cap through it. */
  const declared = /--card-measure:\s*([^;]+);/.exec(stylesCode);
  assert.ok(declared, '--card-measure is gone; the card primitive lost its measure channel');
  assert.equal(
    declared[1].trim(),
    'none',
    'the card measure is a cap again; card text will stop short of the card edge, which is the defect issue 212 closed'
  );
  const readers = sweptRules.filter((rule) =>
    declarationsOf(rule.body).some(
      ({ property, value }) =>
        (property === 'max-inline-size' || property === 'max-width') &&
        value.includes('var(--card-measure)')
    )
  );
  assert.deepEqual(
    readers.map((rule) => `${rule.file}: ${rule.selector}`).sort(),
    [],
    'a surface started reading --card-measure again; the ruling of issue 212 is that card text FILLS its container, so a reader here is a block that will stop short of its own inline end'
  );

  /* And nowhere is the number written down again. Any absolute-length inline
     cap anywhere in the page's styles is refused unless it is named above with
     its reason — which is what stops 42rem coming back as a literal in one
     component, the exact shape .subsection-intro carried for four releases
     while the token layer was believed to be the only copy. */
  assert.ok(
    sweptRules.length > 50,
    'the swept-rule set collapsed; this pin would pass by scanning nothing'
  );
  for (const rule of sweptRules) {
    for (const { property, value } of declarationsOf(rule.body)) {
      if (property !== 'max-inline-size' && property !== 'max-width') continue;
      /* Three verdicts, per inlineCapVerdict above: a fluid form is skipped
         because it is tied to the space the box is given, a bare absolute
         length is refused, and a bare length this parser cannot resolve is
         refused just as loudly rather than skipped — because the unit a
         returning measure is most likely to wear (65ch) is one of those. */
      const verdict = inlineCapVerdict(value);
      if (verdict === 'fluid') continue;
      const admitted = selectorParts(rule.selector).find((part) =>
        [...admittedInlineCaps.keys()].some((key) => part.includes(key))
      );
      if (verdict === 'unreadable') {
        assert.ok(
          admitted,
          `${rule.file}: "${rule.selector}" sets ${property}: ${value} — an unparseable bare cap; tokenise it or admit it in admittedInlineCaps. This pin will not guess a font-relative unit into pixels, so it cannot tell whether this cap leaves the container's inline end blank the way issue 212's 42rem did — and a cap it cannot read is exactly where one hides.`
        );
        continue;
      }
      const length = verdict;
      assert.ok(
        admitted,
        `${rule.file}: "${rule.selector}" caps ${property} at ${value} (${length}px). A capped block start-aligns in a full-width parent, so this leaves the container's inline end blank — the defect of issue 212. Fill the width, or add the selector to admittedInlineCaps with the reason it is not a prose measure.`
      );
    }
  }
});
