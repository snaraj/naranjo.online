import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const [fallback, component, styles, blocks] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
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

/* What assistive technology reads from a stretch of markup: its text, with
 * every aria-hidden subtree taken out and every component it draws expanded
 * to the markup that component renders. A heading may carry decoration (J
 * flies inside the page's own, since 2026-10-19), so its name is read the way
 * a screen reader reads it, never off raw markup. Anything this reader cannot
 * compute — a template expression, an image, an SVG, an explicit label — fails
 * loudly rather than being guessed at. */
function accessibleText(markup, depth = 0) {
  assert.ok(depth < 5, 'components nest deeper than this reader follows');
  let out = stripComments(markup).replace(/<([A-Z]\w*)\b[^>]*\/>/g, (tag, name) => {
    const file = Object.keys(componentSources).find((entry) => entry === `${name}.svelte` || entry.endsWith(`/${name}.svelte`));
    assert.ok(file, `${tag} draws a component this reader cannot find`);
    const rendered = cutBlock(cutBlock(stripComments(componentSources[file]), 'script').rest, 'style').rest;
    return accessibleText(rendered, depth + 1);
  });
  // An aria-hidden element and everything inside it: found by its opening
  // tag, closed at the matching end tag of the same name.
  for (let open = out.search(/<\w+\b[^>]*\baria-hidden="true"[^>]*>/); open >= 0; open = out.search(/<\w+\b[^>]*\baria-hidden="true"[^>]*>/)) {
    const tag = /^<(\w+)/.exec(out.slice(open))[1];
    const head = out.indexOf('>', open) + 1;
    if (out[head - 2] === '/') {
      out = out.slice(0, open) + out.slice(head);
      continue;
    }
    let depthOf = 1;
    let cursor = head;
    const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
    pattern.lastIndex = head;
    for (let match = pattern.exec(out); match; match = pattern.exec(out)) {
      depthOf += match[1] === '/' ? -1 : 1;
      cursor = pattern.lastIndex;
      if (depthOf === 0) break;
    }
    assert.equal(depthOf, 0, `an aria-hidden <${tag}> is never closed`);
    out = out.slice(0, open) + out.slice(cursor);
  }
  assert.doesNotMatch(out, /[{}]|<img\b|<svg\b|\baria-label(?:ledby)?=|\balt=/, 'this markup computes its name in a way this reader does not model');
  // Until a pass removes nothing, so no tag is left behind that a removal
  // spliced together (js/incomplete-multi-character-sanitization).
  let text = out;
  while (text !== (text = text.replace(/<[^>]*>/g, ''))) {
    /* until a pass removes nothing */
  }
  return text.replace(/\s+/g, ' ').trim();
}

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
  // replaced by the real site — it is deliberately not a contract. What IS
  // the contract is that both shells name the page the same: the hydrated
  // heading carries J inside it (2026-10-19), so its name is what a screen
  // reader computes, and it must be exactly the static shell's.
  const staticHeading = /<h1 id="static-page-title">([\s\S]*?)<\/h1>/.exec(fallback)?.[1];
  const hydratedHeading = /<h1 id="page-title">([\s\S]*?)<\/h1>/.exec(stripComments(component))?.[1];
  assert.ok(staticHeading !== undefined && hydratedHeading !== undefined, 'a shell no longer opens on its labelling heading');
  const staticName = accessibleText(staticHeading);
  assert.ok(staticName.length > 0, 'the static shell’s heading names nothing');
  assert.equal(accessibleText(hydratedHeading), staticName, 'the hydrated heading names the page differently from the static shell');
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
  // THE PAGE IS THE NIGHT (owner, 2026-10-19: "always set it to night by
  // default", and then no toggle at all). The day is the :root default
  // palette, and the night is mapped over it by a block that holds unless
  // data-sky="day" is stamped on the root — which nothing does — on every
  // visit, whatever the reader's device prefers.
  assert.match(
    stylesCode,
    /:root:not\(\[data-sky='day'\]\)\s*\{[^}]*color-scheme:\s*dark/,
    'the night block is gone, or no longer tells the browser its controls are dark'
  );
  assert.match(
    stylesCode,
    /:root:not\(\[data-sky='day'\]\)\s*\{[^}]*--color-surface:\s*var\(--palette-dark-surface\)/,
    'the night block no longer remaps the sheet onto the dark palette'
  );
  // And the device has no say: a prefers-color-scheme block coming back would
  // let a light-preferring device skip the night the owner made the default.
  assert.doesNotMatch(
    stylesCode,
    /prefers-color-scheme/,
    'the stylesheet follows the device again; every visit is to open on the night'
  );
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
  // empties the quoted value in `:root[data-face-sans='fallback']`, which is a
  // selector this walk has to keep reading.
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
// never reads. The delta review commented the whole dark-mapping block OUT
// and stayed 137/137 green: the raw-text pins matched the commented copy
// while cssRules stripped it, so the dark mode silently degenerated to light
// — the very rendering the block existed to make.
const stylesCode = styles.replace(/\/\*[\s\S]*?\*\//g, '');

const styleRules = cssRules(styles).map((rule, order) => ({ ...rule, order }));
// The page's two reading modes (owner, 2026-10-19), named for what they are:
// the NIGHT every visit is, and the DAY kept whole behind the data-sky
// attribute ("keep the logic") for whatever stamps it next.
const readingModes = ['night', 'day'];
// The palette each mode paints from: the night is the dark palette and the
// day is the light one, and the palette names in the stylesheet keep those
// words.
const modePalette = { night: 'dark', day: 'light' };
// --palette-* belongs here as much as --color-*. The token layer resolves
// --color-* THROUGH --palette-*, so a rule that redeclares only a palette
// literal repaints exactly the same pixels while declaring nothing this
// pattern used to recognise — invisible to the resolver, to the loud
// selector assert, and to the token-layer pin at once. The var() spelling
// this file's own doctrine mandates was the spelling that got through.
const themeTokenPattern = /^--(?:color|panel|grid-cell|palette)-/;
const declaresThemeToken = (body) =>
  [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].some(([, name]) => themeTokenPattern.test(name));

// THE TOKEN LAYER HAS EXACTLY TWO FORMS (owner, 2026-10-19: "always set it to
// night by default"). Plain :root holds the day, and
// `:root:not([data-sky='day'])` maps the night over it unless the root is
// stamped with the day.
//
// Document order is NOT the cascade. The :not() carries (0,2,0) against plain
// :root's (0,1,0), so the night wins from EARLIER in the file as surely as from
// later — a repaint an order-only resolver could not see. So each form carries
// its real weight, and the rules a mode applies are sorted by weight before
// order, exactly as a browser resolves them.
//
// Only those two forms are recognised. Anything else — a stamped block in
// another spelling, an `html` rule, a doubled `:root:root` that would outweigh
// the day from anywhere — returns null and fails the caller LOUDLY, because a
// selector the matcher does not understand is precisely where the next repaint
// would hide, and silently skipping it is how an order-only model got here.
const nightSelector = ":root:not([data-sky='day'])";
function tokenLayerSelector(selector) {
  const forms = selector.split(',').map((part) => {
    const trimmed = part.trim();
    if (trimmed === ':root') return { weight: 10, modes: ['night', 'day'] };
    if (trimmed === nightSelector) return { weight: 20, modes: ['night'] };
    return null;
  });
  if (forms.some((form) => form === null)) return null;
  // No Math.max: hoisting the highest weight onto every part of a list makes
  // the weak parts punch above their specificity, and a browser paints the
  // difference. A list whose parts genuinely disagree is a form this resolver
  // cannot weigh as one rule, so it says so.
  if (new Set(forms.map((form) => form.weight)).size > 1) return null;
  return {
    weight: forms[0].weight,
    applies: (mode) => forms.some((form) => form.modes.includes(mode)),
  };
}
// The day's own rules and the night's: what each half of the layer declares.
const isDayLayer = (rule) => tokenLayerSelector(rule.selector)?.weight === 10;
const isNightLayer = (rule) => tokenLayerSelector(rule.selector)?.weight === 20;

// The rules that paint one reading mode, base first and night second, each in
// document order. Both modes are renderings this page really serves: the night
// every visit opens on, and the day one press away. Validating the day alone
// would leave the rendering every reader sees first entirely unmeasured.
function modeRules(mode) {
  assert.ok(readingModes.includes(mode), `${mode} is not one of the page's reading modes`);
  const applied = [];
  for (const rule of styleRules) {
    if (!declaresThemeToken(rule.body)) continue;
    const form = tokenLayerSelector(rule.selector);
    assert.ok(
      form,
      `"${rule.selector}" declares theme tokens through a selector this resolver cannot weigh; ` +
        `the token layer is :root and ${nightSelector}`,
    );
    // The device no longer has a say (owner, 2026-10-19): a theme token under
    // prefers-color-scheme is a rendering this resolver cannot place in the
    // night or the day, so it is refused rather than guessed at.
    assert.ok(
      !rule.enclosing.some((at) => at.includes('prefers-color-scheme')),
      `"${rule.selector}" declares theme tokens under prefers-color-scheme; the page opens on the night whatever the device prefers`,
    );
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
  // The night renders through its own block and nothing else. If that block
  // is deleted — or merely COMMENTED OUT, which the delta review did to the
  // old dark mapping while staying 137/137 green — the night silently
  // degenerates into the day and this whole loop then validates the day twice
  // under two names. Fail on the block's absence, not on its contrast.
  assert.ok(
    styleRules.some((rule) => isNightLayer(rule) && declaresThemeToken(rule.body)),
    `no ${nightSelector} block declares theme tokens; every visit would open on the day while the page claims to open on the night`,
  );
  for (const mode of readingModes) {
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
 * boundary, sat below 1.4.11's 3:1 in three of the four reading modes the
 * page then had.
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
  for (const mode of readingModes) {
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
  const statusReads = (source) =>
    [...source.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/g)].filter(([, token]) => statusInkPattern.test(token));
  for (const [name, source] of Object.entries(componentStyles)) {
    for (const [, token, tail] of statusReads(source)) {
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
  /* NON-VACUITY, PROVEN ON A PROBE. The board's utilization meter was the one
     component that read a status ink, and it retired with the board (the
     Chronicle that replaced it draws no meter), so today no component reads
     one and the walk above has nothing to refuse. What keeps
     the sweep honest is that its reader still FINDS a read and still sees
     both of its tails — one bare, one behind a fallback — so the next
     component that reads a status ink is checked rather than missed. */
  const probe = statusReads(
    '.a { color: var(--usage-meter-ok); } .b { color: var( --panel-status-stale , red); } .c { color: var(--color-text); }'
  );
  assert.deepEqual(
    probe.map(([, token, tail]) => [token, tail]),
    [
      ['--usage-meter-ok', ')'],
      ['--panel-status-stale', ','],
    ],
    'the status-ink reader no longer finds a read; this sweep proves nothing'
  );
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
// layer lives in styles.css, and that components "consume tokens, never raw
// palette literals". This makes that a red build instead of a convention,
// which is the strictly stronger half of the pair: the resolver proves the
// layer's VALUES are legible, and this proves there is nowhere else for a
// value to come from.
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
  // The layer is the day's :root plus the night mapped over it, so both
  // halves must be present; a count alone would pass with two day rules.
  assert.ok(
    declaring.some(isDayLayer),
    'no plain :root rule declares theme tokens; the day kept behind the night is gone'
  );
  assert.ok(
    declaring.some(isNightLayer),
    `no ${nightSelector} rule declares theme tokens; the night every visit opens on is gone`
  );
  for (const rule of declaring) {
    assert.ok(
      tokenLayerSelector(rule.selector),
      `"${rule.selector}" declares theme tokens outside the token layer, which is :root and ${nightSelector}`
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

// Reading modes (issue #22; owner, 2026-10-19: "always set it to night by
// default", then, of the toggle that turned it to day, "do away with this all
// together but keep the logic"): the stylesheet is a custom-property token
// layer with two modes. The day is the default :root palette; the night is the
// one `:root:not([data-sky='day'])` block mapped over it. The page is the
// night on every visit — nothing stamps the day any more — but the day is
// kept whole behind the attribute, so bringing it back is one write. Whether
// the colors are legible is the contrast guards' question; this pins the
// layer's shape, the wiring, and that every value in it is written once.
test('reading modes: a token layer that is always the night, with the day kept behind it', async () => {
  // The default document ships unstamped, so the static shell paints the
  // night too: a stamp in it would open every first paint on the day.
  assert.doesNotMatch(fallback, /data-sky/, 'the static shell stamps a sky, so it no longer opens on the night');

  // The page writes the attribute the night block keys on, and the one value
  // it ever writes is the night: a constant, with no state a press or a
  // binding could change.
  const script = cutBlock(component, 'script').inner.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(script, /const phase: SkyPhase = 'night';/, 'the page is no longer the night');
  assert.match(script, /document\.documentElement\.dataset\.sky = phase;/, 'the page no longer writes its phase on the root');
  assert.doesNotMatch(script, /\$state\(|'day'/, 'the page holds a state, or a day, that could turn the sky');
  assert.doesNotMatch(stripComments(component), /bind:/, 'the page hands a child a binding that could turn the sky');

  // NOTHING WRITES THE DAY, anywhere in the source: App's one write of its
  // constant is the only write of the attribute, by any spelling, in any
  // file. And no control exists to make one — the toggle is gone, with its
  // glyphs (icons.test.mjs holds the family to what is drawn).
  const sources = await Promise.all(
    (await readdir(new URL('../src', import.meta.url), { recursive: true }))
      .filter((entry) => /\.(?:svelte|ts)$/.test(entry))
      .map(async (entry) => [entry, await readFile(new URL(`../src/${entry}`, import.meta.url), 'utf8')])
  );
  const writes = sources.flatMap(([entry, source]) =>
    [...source.matchAll(/dataset\.sky\s*=[^=]|dataset\[['"]sky['"]\]\s*=|setAttribute\(\s*['"]data-sky['"]|toggleAttribute\(\s*['"]data-sky['"]/g)].map(() => entry)
  );
  assert.deepEqual(writes, ['App.svelte'], 'something other than the page’s one constant writes the sky');
  assert.ok(
    !existsSync(new URL('../src/lib/components/SkyToggle.svelte', import.meta.url)),
    'the sky’s control is back; the owner did away with it'
  );
  // And nothing remembers a sky: the next visit is the night again.
  for (const [entry, source] of sources) {
    if (!/(?:^|\/)(?:App\.svelte|NightSky\.svelte|Torches\.svelte|sky\.ts|themeColor\.ts)$/.test(entry)) continue;
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/, `${entry} remembers the sky`);
  }

  // THE DAY IS KEPT WHOLE ("keep the logic"): its tokens are the :root
  // defaults and declare their color-scheme, and the contrast guards above
  // still measure every one of them, so the day is a palette that works the
  // moment something stamps it, not a remnant. (Its sky: sky.test.mjs.)
  assert.match(styles, /:root\s*\{[^}]*color-scheme:\s*light/);
  assert.match(styles, /:root\s*\{[^}]*--color-surface:/);
  assert.match(styles, /:root\s*\{[^}]*--color-text:/);

  // Rendered colors come from tokens, never from a second hardcoded copy.
  assert.match(styles, /color:\s*var\(--color-text\)/);
  assert.match(styles, /background:\s*var\(--color-surface\)/);

  // The night is its own block, with its own color-scheme, remapping the
  // active tokens onto the dark palette by reference only.
  assert.match(
    stylesCode,
    /:root:not\(\[data-sky='day'\]\)\s*\{[^}]*color-scheme:\s*dark/,
    'the night block must set its color-scheme'
  );
  assert.match(
    stylesCode,
    /:root:not\(\[data-sky='day'\]\)\s*\{[^}]*--color-surface:\s*var\(--palette-dark-surface\)/,
    'the night block must remap onto the dark palette, never restate values'
  );

  // Palette deduplication (review finding): every palette value is written
  // exactly once, as a --palette-* definition; theme blocks and components
  // only reference.
  const uniqueValues = [
    // The parchment light ramp (owner direction, 2026-10-16: the Keep).
    '#efe2c2', '#e6d5ac', '#dcc795', '#c4ab7a', '#8a6a3c', '#6b4e2a', '#2b1b0c', // light ramp
    // The true dark. Every one of these is a grey — red, green and blue
    // equal — which is the whole claim the mode makes and the one a repaint
    // toward navy would have to break to get past here.
    '#121212', '#1e1e1e', '#2e2e2e', '#383838', '#6c6c6c', '#a0a0a0', '#e0e0e0',
    '#2a2a2a', // its empty heatmap tile, the one hueless step the green ramp keeps
    // The green calendar (owner directive, 2026-09-04, issue 292): two
    // ramps of four steps plus each palette's own peak, every value its own
    // hex so a repaint of one mode cannot quietly restate the other's.
    '#aadf9f', '#72cc6c', '#37b043', '#158a31', '#00d95a', // light greens + peak
    '#0b6223', // light's mark: a deeper step of the same hue, 4.5:1 on every parchment surface where grid-4 is not
    '#2c4a22', '#3f6a2b', '#5e8f3a', '#8fbf55', '#b8e07a', // dark greens + peak
    // The token-usage entity sets (issue #142, widened at #302, #369 and
    // #373): both modes, every value its own hex — including dark's neutral
    // steps, which the r==g==b sweep below also holds to the no-hue rule.
    '#5f6672', '#2a63b8', '#96550a', '#0b8a6a', '#6d4bb8', '#a3315e', // light categories
    '#565656', '#6f6f6f', '#868686', '#a2a2a2', '#bebebe', '#dadada', // dark category steps
    // Slots 6 and 7, added at issue #302 because the model vocabulary's larger
    // vendor group declares seven named members and no two members of one
    // group may share a slot. Chosen by the same measurement the five above
    // were: >= 3:1 on the mode's raised surface, and adjacent-pair separation
    // of at least 19.8 (normal) and 13.8 (deuteranopia and protanopia) in
    // every chromatic mode. Dark keeps its no-hue rule, checked by the sweep.
    '#cc5145', '#698240', // light
    '#949494', '#f2f2f2', // dark steps
    // Slots 8 and 9, added at issue #369 when the Anthropic group grew to nine
    // named members: an orchid and a cyan, 3.17:1 at the lowest on each mode's
    // raised surface, and the 7-8 and 8-9 pairs at worst 20.8 (normal) and
    // 9.7 (deuteranopia and protanopia) in every chromatic mode. Dark's two
    // are greys at 3.88:1 and 10.38:1, held to the no-hue rule by the sweep.
    '#86318a', '#048aad', // light
    '#7a7a7a', '#cccccc', // dark steps
    // Slot 10, added at issue #373 when the Anthropic group grew to ten named
    // members: a gold, 3.34:1 at the lowest on each mode's raised surface, and
    // the 9-10 pair at worst 21.6 (normal) and 18.9 (deuteranopia and
    // protanopia). Dark's is a grey at 3.52:1, held to the no-hue rule.
    '#9f7604', // light
    '#737373', // dark step
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
      `${name} is ${value}; the night's dark palette is the NEUTRAL one, so every channel must agree — a tinted value has no place in it`
    );
  }
  for (const value of uniqueValues) {
    assert.equal(occurrences(styles, value), 1, `${value} must be defined exactly once`);
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

/* NO RED ANYWHERE (owner directive, 2026-09-11).
 *
 * The sheet's one chromatic mark — a hovered control, the boss the owner has
 * killed most, a streak that has reached its own record — used to be ONE red
 * across every reading mode, a printer's spot colour belonging to no palette.
 * It is now a green of each mode's OWN calendar ramp: the fourth step where
 * that step is legible as text (the night's dark palette, above 10:1), and
 * for the day's light palette a deeper step of the same hue, because light's
 * fourth step measures
 * 4.23:1 on the page and its peak 1.80:1, while every surface that spends the
 * mark paints TEXT — the ticker's figure at 0.75rem among them. The calendar's
 * busiest day keeps the peak (--grid-cell-peak), so the mark and the busiest
 * tile are two greens of one hue rather than one value twice.
 *
 * Three properties, none satisfiable by another: every mode maps the mark
 * onto a token of its OWN palette that is not its peak; the mode-independent
 * red literal is GONE; and the value each mode resolves to is a green that
 * clears 4.5:1 — WCAG 1.4.3, the floor this sheet's text inks are held to
 * above — on every surface it is printed on. Measured, so a repaint that put
 * the peak back, or light's fourth step back, fails here on contrast and not
 * only on a name. The rendering lane measures what an engine resolved; this
 * measures what the token layer declares, and neither replaces the other. */
test('the sheet spends its one mark on each mode’s own green, legible as text everywhere it prints', () => {
  const palette = paletteLiterals(styles);
  for (const mode of readingModes) {
    const own = modePalette[mode];
    /* The fourth step, or the mode's own deeper mark where the fourth step
       is short of the floor — never the peak, and never a shallower step that
       happens to clear the floor on a dark ground: the mark is the ramp's
       darkest full step or deeper, in every mode, so it reads as the same
       weight of green across the two. Read from the mapping that WINS in the
       mode, through the resolver, rather than from wherever the text first
       appears in the file. */
    const mapping = new RegExp(`^var\\((--palette-${own}-(?:grid-4|mark))\\)$`).exec(
      tokensFor(mode)['--color-highlight'] ?? ''
    );
    assert.ok(
      mapping,
      `${mode} does not map the page's one mark onto its own palette's fourth step or its own deeper mark`
    );
    const [, token] = mapping;
    const mark = palette[token];
    assert.ok(mark, `${mode}'s mark ${token} resolves to no palette value`);
    const [red, green] = [1, 3].map((offset) => parseInt(mark.slice(offset, offset + 2), 16));
    assert.ok(green > red, `${mode}'s mark ${mark} is not a green at all`);
    for (const surface of ['surface', 'surface-raised', 'surface-overlay']) {
      const ground = palette[`--palette-${own}-${surface}`];
      assert.ok(ground, `${mode} declares no ${surface} to measure the mark against`);
      const ratio = contrastRatio(mark, ground);
      assert.ok(
        ratio >= 4.5,
        `${mode}'s mark ${mark} on its ${surface} ${ground} is ${ratio.toFixed(2)}:1, below the 4.5:1 text floor`
      );
    }
  }
  /* And in the block that actually paints the night: every visit opens on it
     and it reaches the dark palette only through its own block, so the mapping
     has to live THERE, in code a browser reads, or every first visit gets the
     day's mark on the night's sheet. */
  assert.match(
    stylesCode,
    /:root:not\(\[data-sky='day'\]\)\s*\{[^}]*--color-highlight: var\(--palette-dark-grid-4\);/,
    'the night keeps a mark of its own'
  );
  assert.doesNotMatch(
    styles,
    /--palette-highlight/,
    'the mode-independent highlight literal is back; the mark is per palette now'
  );
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
         properties or living in a different rule needs (the page height and
         the safe-area padding use this).
     Neither works for a CUSTOM property (coordinator quality pass on issue
     186): a custom property accepts any value syntax unconditionally, so an
     "earlier declaration of the same custom property" is not kept as a
     fallback the way a regular property's is — the later declaration always
     wins outright, parseable or not, which makes that pattern dead code
     wearing a fallback's shape. A custom property's real fallback lives
     wherever it is CONSUMED: if the feature makes its own declaration
     invalid at computed-value time, the custom property resolves to its
     guaranteed-invalid value, and a var() reference with a second, fallback
     argument (the retired --header-inset-inline's own use site, on the
     header row the page no longer has)
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
 * to escape"). The reserve was derived from the chrome row it cleared — the
 * row's own top inset plus the 44px hit box it was — so the name began exactly
 * where the chrome ended.
 *
 * THE ROW IS GONE (owner direction, 2026-10-16: "do away with it for now, put
 * J elsewhere"), and the sky above the sheet keeps exactly that measure: the
 * owner's 2026-08-25 directive still holds, so the name still does not touch
 * the top of the viewport.
 *
 * THE OVERHANG IS RETIRED, BECAUSE ITS SUBJECT IS GONE. From 2026-10-16 this
 * pin also held that J's phone overhang — half of him rising off the sheet's
 * top-end corner into this space — fit inside it. J no longer perches on that
 * corner (owner, 2026-10-19: "put J on the white space flying"): he flies in
 * the room the name keeps at its end, centred on the name's own lines, at
 * every width, a phone's included, so there is no overhang left to fit. The J
 * pin below holds him there — one seat, placed from the name's own box,
 * smaller than the name's two lines — which is what keeps an overhang from
 * coming back unmeasured. */
test('the page keeps its sky above the sheet (owner 2026-08-25, 2026-10-16)', () => {
  const token = (name) => {
    const found = new RegExp(`--${name}:\\s*([^;]+);`).exec(stylesCode);
    assert.ok(found, `--${name} is gone; the top rhythm is derived from it`);
    return found[1].trim();
  };
  assert.equal(token('page-top-space'), 'calc(var(--page-gutter) + var(--page-rail-size))');
  const gutter = lengthInPx(token('page-gutter'));
  const rail = lengthInPx(token('page-rail-size'));
  assert.ok(gutter !== null && rail !== null, 'the top rhythm is built from a length this pin cannot read');
  const topSpace = gutter + rail;
  assert.equal(topSpace, 60, 'the sky above the sheet is no longer the 60px it has always been');
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
 * The ledger removed the cause all three were treating by making the chrome a
 * ROW in the document's flow (issue 287). The row itself is gone now (owner
 * direction, 2026-10-16: "do away with it for now"), and its pins — in flow,
 * one rule under it, its reserve — went with their subject. So did the
 * reading-mode control the row handed to the page's footer, which left with
 * the footer itself (owner, 2026-10-19), and so did the sky's toggle that sat
 * beside the name for an afternoon ("do away with this all together but keep
 * the logic"): the page's own chrome carries no control at all. What the pins
 * were FOR stays: none of the three retired mechanisms is back, the page shell
 * draws no control of its own, and the shared icon-control shape — the
 * lightbox close wears it — neither floats nor drops under the 44px touch
 * floor, which the floor sweep above measures on every control. */
test('no control owns a corner of the page, and the name keeps its own block (issues 219, 241, 264, 287; owner 2026-10-16)', () => {
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

  /* THE NAME IS TWO LINES AT EVERY WIDTH (owner directive, 2026-09-04, issue
     294): the heading's box is its longest word, so the break lands at the
     space on a monitor exactly as it does on a phone, with the DOM text left
     as the name. Pinned where it is decided; the rendering lane for issue 294
     counts the two line boxes in every engine. */
  const masthead = /\nh1 \{([^}]*)\}/.exec(stylesCode);
  assert.ok(masthead, 'the masthead rule is gone');
  assert.match(masthead[1], /inline-size: min-content;/, 'the name is no longer boxed to its longest word');
  assert.match(masthead[1], /text-transform: lowercase;/);

  // The page shell draws no control of its own: no button, no link-as-button,
  // no component that is one. A control that comes back is a conscious edit
  // of this pin, and then the floor and no-float rules below are its rules.
  const shellMarkup = cutBlock(cutBlock(stripComments(component), 'script').rest, 'style').rest;
  assert.doesNotMatch(
    shellMarkup,
    /<button\b|role="button"|<SkyToggle\b|onclick=/,
    'the page shell draws a control of its own again'
  );
  assert.ok(!sweptRules.some((rule) => rule.file === 'App.svelte' && /\.page-sky\b/.test(rule.selector)), 'the retired toggle’s seat is still styled');
  // And the page-level icon-control shape (the lightbox close wears it)
  // still clears the touch floor on both axes and positions nothing: a
  // control that floats is a control that can own a corner again.
  assert.match(stylesCode, /\.icon-button\s*\{[^}]*inline-size:\s*2\.75rem/);
  assert.match(stylesCode, /\.icon-button\s*\{[^}]*block-size:\s*2\.75rem/);
  assert.ok(
    sweptRules.some((rule) => selectorParts(rule.selector).includes('.icon-button')),
    'no rule styles .icon-button; this pin has lost its subject'
  );
  assert.ok(
    !sweptRules.some(
      (rule) =>
        selectorParts(rule.selector).includes('.icon-button') &&
        declarationsOf(rule.body).some(({ property, value }) => property === 'position' && /fixed|absolute|sticky/.test(value))
    ),
    '.icon-button floats over the page'
  );

  /* The two insets the floating control needed stay retired: #app's own
     safe-area padding clears a notch for everything in the column, so a
     second answer to the same question would be a second set of numbers free
     to disagree with the first. */
  assert.doesNotMatch(
    stylesCode,
    /--header-inset-(?:block|inline)/,
    'the retired corner insets are back; #app already clears the safe area for everything inside it'
  );
});

/* J FLIES OFF THE NAME (owner direction, 2026-10-16: "put J elsewhere"; the
 * flight itself is the direction of the same day, "swap him for the flying J
 * again and give him a bit of a back-forth rotation, subtle"). He bookended
 * the chrome row from two seats (issue 314, and issue 325's mirrored one); the
 * row is gone, and he has ONE seat beside the name. Everything that makes that
 * safe is a source fact this pin holds; the rendering lane of the same name
 * measures his box against every line of the name, the requests, the moving
 * frames and the rock in a real engine. Neither half replaces the other. */
/* Comments come out to a FIXPOINT, not in one pass: a single replace leaves
   a `<!--` behind when one comment's removal joins two halves of another,
   which is the incompleteness CodeQL's multi-character-sanitization rule
   names; the loop runs until a pass changes nothing. */
const stripComments = (source) => {
  let out = source;
  while (out !== (out = out.replace(/<!--[\s\S]*?-->/g, ''))) {
    /* until a pass removes nothing */
  }
  return out;
};

const jMarkFile = 'lib/components/JMark.svelte';
/* One rule of J's own <style>, found by selector and by whether it sits in
   the no-preference block — the two places every one of his rules can live. */
const jRule = (selector, moving) =>
  sweptRules.find(
    (rule) =>
      rule.file === jMarkFile &&
      rule.selector === selector &&
      rule.enclosing.some((at) => /prefers-reduced-motion\s*:\s*no-preference/.test(at)) === moving &&
      (moving || !rule.enclosing.some((at) => at.startsWith('@media')))
  );
const declared = (rule) =>
  Object.fromEntries(declarationsOf(rule.body).map(({ property, value }) => [property, value]));
/* One block of a component's own source, cut at the tags the component
   writes: what sits between `<tag …>` and `</tag>`, and the source without
   the block. Cut by position rather than by pattern — this reads our own
   file's structure, and it is not a sanitiser of anyone's markup. */
const cutBlock = (source, tag) => {
  const open = source.indexOf(`<${tag}`);
  if (open < 0) return { inner: '', rest: source };
  const start = source.indexOf('>', open) + 1;
  const close = source.indexOf(`</${tag}>`, start);
  if (start === 0 || close < 0) return { inner: '', rest: source };
  return { inner: source.slice(start, close), rest: source.slice(0, open) + source.slice(close + tag.length + 3) };
};

test('J flies off the name from one seat, reserved, silent, still at rest, and flying with a gentle rock only where motion is welcome (owner 2026-09-11 issue 314, 2026-10-16)', () => {
  const mark = componentSources[jMarkFile];
  assert.ok(mark, 'the mark component is not where this pin expects it');
  /* The ELEMENT, without its script and its style: what a reader's tree gets. */
  const markup = cutBlock(cutBlock(stripComments(mark), 'script').rest, 'style').rest.trim();
  const script = cutBlock(mark, 'script').inner;
  const style = (componentStyles[jMarkFile] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(style.trim(), 'J’s look is no longer stated in his own component');

  /* SILENT AND UNREACHABLE. A decorative dragon that announced itself would be
     a name every screen reader reads past on every visit, and a focusable one
     would be a new stop on the page's keyboard order. */
  assert.match(markup, /^<span class="j-flight" aria-hidden="true"><\/span>$/, 'the mark is no longer one empty, aria-hidden span');
  assert.doesNotMatch(markup, />[^<\s][\s\S]*</, 'the mark carries text');
  assert.doesNotMatch(
    markup,
    /\b(?:href|tabindex|role|onclick|onkeydown|aria-label|title)\b/,
    'the mark has grown a name, a role, or a way to reach it'
  );
  /* SELF-HOSTED, and never named by the markup or imported by a script: the
     component's own style names the sheet and the still by relative path, so
     the bundler resolves each to a content-hashed same-origin URL (the build
     inlines nothing — assetsInlineLimit 0, pinned by vite-config.test.mjs —
     because the origin's default-src 'self' refuses a data: URI). */
  assert.doesNotMatch(markup, /\.webp|src=|style=/, 'the element names a file or writes an inline style');
  assert.doesNotMatch(script, /\.webp|import\.meta|assets\//, 'the script resolves J’s picture itself');
  const urls = [...style.matchAll(/url\(([^)]*)\)/g)].map(([, inner]) => inner.trim());
  assert.deepEqual(
    urls.sort(),
    ["'../../assets/images/j/j-flight-still.webp'", "'../../assets/images/j/j-flight.webp'"],
    'J’s style names something other than exactly the vendored sheet and still, by relative path'
  );

  /* ONE SEAT, AS THE DOT OF THE J (owner, 2026-10-20). The page shell draws
     him once, inside the name's own heading, in a seat at the end of its
     second word, after its dotless j — and no other component draws him, so there is no
     second request and no second dragon. The mirrored seat left with the row
     it faced into: no prop, no flip rule, anywhere. The static shell's
     heading has no J at all: it is the mounted heading's very markup with
     his flight taken out, inside the same intro, so the same runs of text are
     set by the same rules and the page mounts without moving a letter on any
     platform. (Its words alone were not enough: "Naranjo" as one run against
     three moved the heading a pixel in Linux Chromium, which rounds each
     run's width on its own — CI, 2026-10-20.) */
  const seats = Object.entries(componentSources).flatMap(([file, source]) =>
    (stripComments(source).match(/<JMark\b[^>]*\/>/g) ?? []).map((tag) => [file, tag])
  );
  assert.deepEqual(seats, [['App.svelte', '<JMark />']], 'J is drawn somewhere other than exactly once, as rendered, by the page shell');
  /* The heading is cut where J's flight sits, so the shell is compared with
     the rest of it as markup, nothing stripped. */
  const heading = /<div class="page-intro">\s*<h1 id="page-title">(<span class="page-name-line">[^<]+<\/span> <span class="page-name-line">[^<]+<span class="page-name-j">j<\/span>[^<]*<span class="page-j-seat">)<span class="page-j"><JMark \/><\/span>(<\/span><\/span>)<\/h1>/.exec(
    stripComments(component)
  );
  assert.ok(heading, 'J is not seated inside the name’s own heading, at the end of its second word, after its j, each word a line of its own');
  const shell = /<div class="page-intro">\s*<h1 id="static-page-title">([\s\S]*?)<\/h1>/.exec(fallback);
  assert.ok(shell, 'the static shell’s heading is not in the same intro the page draws');
  assert.equal(
    shell[1],
    `${heading[1]}${heading[2]}`,
    'the static shell’s heading is not the mounted heading’s markup with J’s flight taken out, so its text is set in other runs and the name moves when the page mounts'
  );
  assert.doesNotMatch(
    stripComments(mark).replace(/\/\*[\s\S]*?\*\//g, ''),
    /mirrored|\$props/,
    'the retired mirrored seat is back as a prop'
  );
  assert.ok(
    !sweptRules.some((rule) => /j-flight-mirrored/.test(rule.selector)),
    'a rule still flips a J nobody mirrors'
  );

  /* SHARED, and this proves it rather than asserting it: the sheet and the
     still are each named exactly once across the whole stylesheet AND every
     component style, so no second seat can become a second URL. */
  const everyStyle = [stylesCode, ...Object.values(componentStyles)]
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const file of ['j-flight.webp', 'j-flight-still.webp']) {
    assert.equal(
      (everyStyle.match(new RegExp(`/${file.replaceAll('.', '\\.')}`, 'g')) ?? []).length,
      1,
      `${file} is named more than once (or not at all); a second J is a second request`
    );
  }

  /* THE BOX IS RESERVED, not measured from the picture: the square his seat
     hands him (the site's control square when no seat says), so his box is
     the same before either file arrives as after (the zero-CLS floor). */
  const box = jRule('.j-flight', false);
  assert.ok(box, 'J has no box outside a media block, so he renders nothing for a reader who asked for less motion');
  const boxed = declared(box);
  assert.equal(boxed['--j-box'], 'var(--j-size, var(--control-target))', 'J’s box is no longer the square his seat hands him');
  assert.equal(boxed['inline-size'], 'var(--j-box)');
  assert.equal(boxed['block-size'], 'var(--j-box)');
  assert.equal(boxed.flex, 'none', 'a flex parent may squeeze him');
  assert.equal(boxed.position, 'relative', 'the picture is no longer placed against J’s own box');
  assert.ok(!('animation' in boxed) && !('transform' in boxed), 'the reserved box itself moves');
  assert.ok(
    !sweptRules.some((rule) => rule.file === jMarkFile && rule.selector === '.j-flight' && rule.enclosing.length > 0),
    'J’s box is restated inside a media block; his size is his seat’s to decide'
  );

  /* THE PICTURE IS THE BOX: the ::before, out of flow so it sizes nothing,
     drawn into exactly his square — there is no bar left to fly past — and it
     takes no pointer, so nothing under him is ever unpressable. At rest it is
     the still, drawn whole. */
  const picture = jRule('.j-flight::before', false);
  assert.ok(picture, 'J’s picture has no rule outside a media block');
  const resting = declared(picture);
  assert.equal(resting.content, "''");
  assert.equal(resting.position, 'absolute', 'the picture is in the flow, so its size moves the page');
  assert.equal(resting.inset, '0', 'the picture is not drawn into his box');
  assert.equal(resting['pointer-events'], 'none', 'the picture catches presses meant for what is under it');
  assert.equal(resting['background-image'], "url('../../assets/images/j/j-flight-still.webp')");
  assert.equal(resting['background-position'], '0 0');
  assert.equal(resting['background-size'], '100% 100%', 'the still is not drawn whole into the picture');
  assert.ok(!('animation' in resting) && !('transform' in resting), 'the resting picture moves');
  /* The sheet's drawn size is DERIVED from his square, 20 cells across and
     24 down, so one cell is always exactly the picture and the keyframes walk
     whole cells at any size his seat asks for. */
  assert.equal(boxed['--j-sheet-inline'], 'calc(var(--j-box) * 20)');
  assert.equal(boxed['--j-sheet-block'], 'calc(var(--j-box) * 24)');

  /* THE SEAT, AS THE DOT OF THE J (owner, 2026-10-20, picking "the dot of the
     j, stacked", and of its size: "make the title not be GIGANTIC"). The name
     is its two words centred on two lines, its j drawn dotless, and J hovers
     where the dot would be. Each fact the seat rests on is pinned where it is
     decided:
       · the seat is a box with no font at the second word's END: a box of
         no height on the baseline in every engine, so J is placed from the
         letters and not from a line box each engine derives differently, and
         at the end because a placed box INSIDE a word splits it in the
         heading's accessible name (measured in all three engines: "Samuel
         Naran jo", then "Samuel Naranj o");
       · he is carried back over the stem and his feet are lifted to the
         hover, by the face's facts stated once on the name, in its own size —
         the stem as its derivation from the j's and the o's advances and the
         name's tracking after each;
       · he is out of the flow and takes no pointer, by ONE rule at every
         width, and nothing about the seat moves;
       · his size is a share of the name's own size, capped where his 80px
         flight frames would blur, and never so large that his body, from the
         hover up, reaches the line above;
       · and the j is still a j: the dotless letter is only DRAWN over it,
         in the face's own glyph, spoken as nothing. */
  /* The name's parts are global rules, so the static shell's heading — the
     same markup, which the page shell's scoped style never reaches — is set
     by them too. */
  const seatRules = sweptRules.filter((rule) => rule.file === 'styles' && selectorParts(rule.selector).includes('.page-j-seat'));
  assert.equal(seatRules.length, 1, 'J’s seat is shaped by more than one rule, or none');
  const seat = declared(seatRules[0]);
  assert.ok(!seatRules[0].enclosing.some((at) => /^@(?:media|supports|container)/.test(at)), 'J’s seat sits inside a condition, so some reader gets no seat');
  assert.ok(!('display' in seat), 'J’s seat is not an ordinary inline box, so it splits the name for a screen reader or leaves the baseline');
  assert.equal(seat['font-size'], '0', 'J’s seat has a font, so it is not a box of no height on the baseline');
  assert.equal(seat.position, 'relative', 'J is not placed from his seat');
  const lines = sweptRules.filter((rule) => rule.file === 'styles' && selectorParts(rule.selector).includes('.page-name-line'));
  assert.equal(lines.length, 1, 'the name’s lines are shaped by more than one rule, or none');
  assert.deepEqual(
    [declared(lines[0]).display, declared(lines[0])['white-space']],
    ['block', 'nowrap'],
    'a word of the name is not a whole line of its own, so the seat — a place a line may break — can split it'
  );
  const pageJRules = sweptRules.filter((rule) => rule.file === 'App.svelte' && selectorParts(rule.selector).includes('.page-j'));
  assert.equal(pageJRules.length, 1, 'J is seated by more than one rule, so the seat and the flight can part at some width');
  const [wideSeat] = pageJRules;
  assert.ok(!wideSeat.enclosing.some((at) => at.startsWith('@')), 'J’s one seat sits inside a condition, so some reader gets no seat');
  const seated = declared(wideSeat);
  assert.deepEqual(
    Object.keys(seated).filter((property) => /^(?:position|inset(?:-.+)?|top|right|bottom|left)$/.test(property)).sort(),
    ['inset-block-end', 'inset-inline-start', 'position'],
    'J is placed by something other than one offset on each axis'
  );
  assert.equal(seated.position, 'absolute', 'J is in the flow, so his arrival moves the name');
  assert.equal(seated['inset-inline-start'], 'calc(var(--j-stem) - var(--j-size) / 2)', 'J is not centred over the j’s stem');
  assert.equal(
    seated['inset-block-end'],
    'calc(var(--j-hover) - 0.1125 * var(--j-size))',
    'J’s feet (0.1125 of his square above its foot) are not lifted to the hover'
  );
  assert.equal(seated['pointer-events'], 'none');
  assert.equal(seated['line-height'], '0', 'J’s seat sets a line box of its own inside the name');
  assert.equal(seated['font-size'], 'var(--keep-name-size)', 'J does not take the name’s size back from a seat of none, so his size is no longer a share of the name’s');
  assert.ok(
    !sweptRules.some((rule) => rule.file === jMarkFile && declarationsOf(rule.body).some(({ property }) => property === 'font-size' || property === 'font')),
    'J’s own component re-sizes his em, so his size is no longer a share of the name’s'
  );
  for (const rule of [...seatRules, wideSeat]) {
    assert.ok(
      !declarationsOf(rule.body).some(({ property }) => /^(?:animation|transition|transform)/.test(property)),
      'the seat moves; motion is J’s own, inside the no-preference block'
    );
  }

  // The name, with J's measures: the keep layer's one masthead rule that sizes J.
  const names = sweptRules.filter(
    (rule) =>
      rule.file === 'styles' &&
      selectorParts(rule.selector).includes('h1') &&
      declarationsOf(rule.body).some(({ property }) => /^--j-/.test(property))
  );
  assert.equal(names.length, 1, 'J’s measures are not stated once, on the name');
  const [nameRule] = names;
  assert.ok(!nameRule.enclosing.some((at) => at.startsWith('@media')), 'the name seats J only at some widths');
  const name = declared(nameRule);
  const size = /^min\(([\d.]+)em, clamp\(([\d.]+)rem, ([\d.]+)em, ([\d.]+)rem\)\)$/.exec(name['--j-size'] ?? '');
  assert.ok(size, `J is ${name['--j-size']}, not a share of the name held between two sizes and under a share it may never pass`);
  const [, most, , share, cap] = size.map(Number);
  assert.ok(cap <= 7.5, 'J is allowed past 7.5rem, where his 80px flight frames blur');
  assert.ok(share <= most, 'J’s share of the name is past the most he may ever be');
  const stem = /^calc\(([\d.]+)em - ([\d.]+)em - ([\d.]+)em - 2 \* var\(--masthead-tracking\)\)$/.exec(name['--j-stem'] ?? '');
  const hover = /^([\d.]+)em$/.exec(name['--j-hover'] ?? '');
  assert.ok(
    stem && hover,
    'the face’s facts that seat J are not stated in the name’s own size, the stem as its way back from the word’s end over two tracked letters'
  );
  assert.equal(name['font-size'], 'var(--keep-name-size)', 'the name is no longer set in --keep-name-size');
  assert.equal(name['text-align'], 'center', 'the name’s two lines are not centred on each other');
  assert.ok(!('margin-inline-end' in name), 'the name keeps a room at its end again, so it is no longer centred by itself');
  for (const rule of sweptRules.filter((entry) => entry.file === 'styles' && selectorParts(entry.selector).includes('h1'))) {
    for (const property of ['grid-area', 'grid-column', 'justify-self']) {
      assert.ok(!(property in declared(rule)), `the name sets ${property}, so it leaves the intro’s centre`);
    }
  }
  // The intro centres the name: the last word on its items.
  const introAlign = sweptRules
    .filter(
      (rule) =>
        rule.file === 'styles' &&
        selectorParts(rule.selector).includes('.page-intro') &&
        !rule.enclosing.some((at) => at.startsWith('@media')) &&
        'justify-items' in declared(rule)
    )
    .map((rule) => declared(rule)['justify-items']);
  assert.equal(introAlign.at(-1), 'center', 'the intro no longer centres the name');
  /* ...and J never reaches the line above. His drawn body is 0.7375 of his
     square (measured off the still and every flight frame: from 0.15 to
     0.8875 of it), standing on the hover, so at the most he may ever be his
     head is at hover + 0.7375 × most, which must sit inside the name's own
     leading — the last leading the name is set at, read rather than
     restated. */
  const leading = sweptRules
    .filter((rule) => rule.file === 'styles' && selectorParts(rule.selector).includes('h1'))
    .map((rule) => declared(rule)['line-height'])
    .filter((value) => value !== undefined)
    .at(-1);
  assert.match(leading ?? '', /^[\d.]+$/, `the name is set at ${leading ?? 'no leading'}, not a plain number this pin can read`);
  const head = Number(hover[1]) + 0.7375 * most;
  assert.ok(
    head <= Number(leading),
    `J’s head reaches ${head.toFixed(3)} of a name-size, past the ${leading} between the name’s lines: he meets the line above`
  );
  /* The x-height the hover stands over, and the stem, are the face's: the
     hover is a breath over 0.51, the stem sits inside the dotless j's own
     advance, and the way back is that advance (0.215, as the dotless j's)
     and the o's (0.408) — the browser lanes measure where it lands. */
  assert.ok(Number(hover[1]) > 0.51 && Number(hover[1]) < 0.6, `J hovers at ${hover[1]}, not a breath over the face’s 0.51 x-height`);
  assert.deepEqual(
    stem.slice(2, 4).map(Number),
    [0.215, 0.408],
    'J’s way back from the word’s end is not the face’s j and o advances'
  );
  assert.ok(Number(stem[1]) > 0 && Number(stem[1]) < 0.215, `J’s stem at ${stem[1]} is outside the dotless j’s 0.215 advance`);

  /* THE J IS STILL A J. Its letter stays in the text at no size, carrying no
     tracking of its own, and the dotless j is drawn in its place from the
     face itself (a vendored face whose range covers it), at the name's size
     and with the name's tracking, spoken as nothing. */
  const letter = sweptRules.find((rule) => rule.file === 'styles' && rule.selector === '.page-name-j');
  assert.ok(letter, 'the j has no rule of its own');
  assert.deepEqual([declared(letter)['font-size'], declared(letter)['letter-spacing']], ['0', '0'], 'the j’s own letter still takes room or tracking');
  const drawn = sweptRules.find((rule) => rule.file === 'styles' && rule.selector === '.page-name-j::before');
  assert.ok(drawn, 'no dotless j is drawn over the j');
  const drawnContents = declarationsOf(drawn.body).filter(({ property }) => property === 'content').map(({ value }) => value);
  assert.deepEqual(drawnContents, ["'\\0237'", "'\\0237' / ''"], 'the drawn letter is not the dotless j, spoken as nothing where an engine reads generated text');
  assert.equal(declared(drawn)['font-size'], 'var(--keep-name-size)', 'the dotless j is not drawn at the name’s size');
  assert.equal(declared(drawn)['letter-spacing'], 'var(--masthead-tracking)', 'the dotless j does not carry the name’s tracking');
  const covered = [...stylesCode.matchAll(/@font-face\s*\{([^}]*)\}/g)]
    .map(([, body]) => body)
    .filter((body) => /font-family:\s*'Instrument Serif'/.test(body))
    .some((body) =>
      [...(/unicode-range:\s*([^;]+);/.exec(body)?.[1] ?? '').matchAll(/U\+([0-9A-F]+)(?:-([0-9A-F]+))?/gi)].some(
        ([, from, to]) => parseInt(from, 16) <= 0x237 && 0x237 <= parseInt(to ?? from, 16)
      )
    );
  assert.ok(covered, 'no vendored Instrument Serif face covers the dotless j, so it is drawn in some other face');

  /* THE FLIGHT AND THE ROCK, and only inside no-preference. The sweep below
     proves no rule animates outside that block; this proves the sheet
     arrives THERE, sized to its grid, that the two steps() that walk it are
     DECLARED and are steps rather than a tween (a tween paints two
     half-frames at once), and that the rock is the gentle one the owner
     asked for: smooth, alternating, a few degrees, slow. */
  const moving = jRule('.j-flight::before', true);
  assert.ok(moving, 'J never flies; the picture declares no motion where motion is welcome');
  const flying = declared(moving);
  assert.equal(flying['background-image'], "url('../../assets/images/j/j-flight.webp')");
  assert.equal(flying['background-size'], 'var(--j-sheet-inline) var(--j-sheet-block)');
  assert.ok(flying.animation, 'the picture’s motion rule declares no animation');
  assert.match(flying.animation, /j-flight-row var\(--j-flight-row\) steps\(20\) infinite/);
  assert.match(flying.animation, /j-flight-sheet var\(--j-flight\) steps\(24\) infinite/);
  assert.match(
    flying.animation,
    /j-rock var\(--j-rock-swing\) ease-in-out infinite alternate/,
    'the rock is not a smooth, alternating swing'
  );
  /* The loop is the study's 8s, and the row is the loop DIVIDED by the
     sheet's 24 rows, never a written duration of its own that could drift
     from it. */
  assert.equal(boxed['--j-flight'], '8s', 'the loop is no longer the study’s 8s (480 frames at 60Hz)');
  assert.equal(
    boxed['--j-flight-row'],
    'calc(var(--j-flight) / 24)',
    'the row duration is no longer the loop divided by its 24 rows, so the two animations drift apart'
  );
  /* SUBTLE: a few degrees each way, never a spin, over a swing slow enough
     to read as a glide. */
  const angle = /^([\d.]+)deg$/.exec(boxed['--j-rock-angle'] ?? '');
  assert.ok(angle, 'the rock’s angle is not a plain number of degrees');
  assert.ok(Number(angle[1]) > 0 && Number(angle[1]) <= 6, `the rock leans ${angle[1]}deg each way; subtle is a few degrees`);
  const swing = /^([\d.]+)s$/.exec(boxed['--j-rock-swing'] ?? '');
  assert.ok(swing, 'the rock’s swing is not a plain number of seconds');
  assert.ok(Number(swing[1]) >= 2, `the rock swings in ${swing[1]}s; slow is two seconds or more each way`);
  for (const [name, pattern] of [
    ['j-flight-row', /^\s*to\s*$/],
    ['j-flight-sheet', /^\s*to\s*$/],
  ]) {
    const frames = sweptRules.filter(
      (rule) => rule.file === jMarkFile && rule.enclosing.some((at) => at === `@keyframes ${name}`)
    );
    assert.equal(frames.length, 1, `@keyframes ${name} is missing or has grown, so the animation walks something else`);
    assert.match(frames[0].selector, pattern);
  }
  for (const [name, token] of [
    ['j-flight-row', '--j-sheet-inline'],
    ['j-flight-sheet', '--j-sheet-block'],
  ]) {
    const frames = sweptRules.find(
      (rule) => rule.file === jMarkFile && rule.enclosing.some((at) => at === `@keyframes ${name}`)
    );
    assert.match(
      frames.body,
      new RegExp(`background-position-[xy]: calc\\(-1 \\* var\\(${token}\\)\\)`),
      `@keyframes ${name} travels a distance the sheet’s own size does not decide`
    );
  }
  /* The rock is symmetrical about level: the same angle each way, so at rest
     between swings he is the still's own pose rather than a lean. */
  const rock = Object.fromEntries(
    sweptRules
      .filter((rule) => rule.file === jMarkFile && rule.enclosing.some((at) => at === '@keyframes j-rock'))
      .map((rule) => [rule.selector, declared(rule)])
  );
  assert.deepEqual(
    rock,
    {
      from: { transform: 'rotate(calc(-1 * var(--j-rock-angle)))' },
      to: { transform: 'rotate(var(--j-rock-angle))' },
    },
    'the rock is not one rotation swung evenly either side of level'
  );
});

test('the stylesheet no longer dresses the J it retired (owner direction, 2026-10-16)', () => {
  /* J's whole look lives in his own component now. The global sheet's old
     typing rules match no element any more, and a dead rule that still names
     a picture is a picture the build still emits and the next reader has to
     disprove — so they are gone, tokens and keyframes with them, rather than
     kept warm for a render the owner swapped away. */
  assert.doesNotMatch(stylesCode, /j-typing/, 'styles.css still names the typing render');
  assert.doesNotMatch(stylesCode, /\.j-mark\b/, 'styles.css still styles the retired .j-mark');
  /* The sheet states only his SEAT's measures, on the name he is the dot of
     (2026-10-20): his size, and the face's stem and hover that seat him. Every
     token his own component declares — his box, his sheet, his flight, his
     rock — stays his component's alone. */
  const ownTokens = new Set(
    [...(componentStyles[jMarkFile] ?? '').matchAll(/(--j-[a-z-]+)\s*:/g)].map(([, token]) => token)
  );
  assert.ok(ownTokens.size > 0, 'J’s component declares no tokens of its own; this pin has lost its subject');
  const sheetJ = styleRules.flatMap((rule) =>
    declarationsOf(rule.body)
      .filter(({ property }) => property.startsWith('--j-'))
      .map(({ property }) => ({ property, selector: rule.selector }))
  );
  for (const { property, selector } of sheetJ) {
    assert.ok(!ownTokens.has(property), `styles.css declares ${property}, which J’s own component owns`);
    assert.ok(
      ['--j-size', '--j-stem', '--j-hover'].includes(property) && selectorParts(selector).includes('h1'),
      `styles.css declares ${property} on "${selector}"; the sheet states only J’s seat, on the name`
    );
  }
});

test('the document declares both marks a browser looks for, and nothing inlines them (owner 2026-09-11, issue 314)', () => {
  /* The tab mark keeps its name and its type (issue 239): the runtime image
     carries no MIME registry beyond Go's built-in table, so the extension is
     what decides whether a browser is handed an icon or a download. */
  assert.match(fallback, /<link rel="icon"[^>]*href="\/favicon\.svg"/);
  assert.match(fallback, /<link rel="icon"[^>]*type="image\/svg\+xml"/);
  /* And the home-screen mark, which iOS looks for INSTEAD of the icon above
     when a visitor adds the site to a home screen; without it the tile is a
     screenshot of the page. It rides the static head for the reason every
     other head tag here does: nothing that reads it runs script. */
  assert.match(fallback, /<link rel="apple-touch-icon"[^>]*href="\/apple-touch-icon\.png"/);
  assert.doesNotMatch(component, /rel="(?:icon|apple-touch-icon)"/, 'the mounted page adds a second copy of a mark the static head already carries');
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
  /* Zero CLS on the sky switch, made structural. The day is kept behind one
     attribute on <html> (owner, 2026-10-19: "keep the logic"), and whatever
     stamps it next swaps that attribute on a page the visitor is already
     reading, so everything a [data-sky] rule declares takes effect
     INSTANTLY there — a padding, a
     font-size, a border width in one of these rules would move the text
     under their eyes. Custom properties and color-scheme cannot: they change
     what is painted, never how much room it takes. A prefers-color-scheme
     block anywhere is held to the same rule, should one come back: a device
     switches while a page is open too. */
  const swapped = sweptRules.filter(
    (rule) =>
      rule.selector.includes('[data-sky') ||
      rule.enclosing.some((at) => at.includes('prefers-color-scheme'))
  );
  assert.ok(
    swapped.some((rule) => rule.file === 'styles' && isNightLayer(rule) && declaresThemeToken(rule.body)),
    `no ${nightSelector} block declares the night's tokens; the swappable rendering this pin holds is gone`
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
 * inherits :root, which is the LIGHT palette, so a night missing
 * --color-border paints one light seam and everything else stays dark. The
 * contrast guard above cannot see it either: that guard resolves the hooks it
 * measures, and a token nothing measures resolves happily to the day's value.
 *
 * It matters more the more the page grows. Components read these roles by
 * name and must never ask which mode is active — a card, a panel or a feed
 * item that had to branch per theme would need editing every time a mode is
 * added, which is exactly the coupling the token layer exists to prevent. So
 * the roles are compared as SETS: adding a role to one mode is fine, adding
 * it to only one mode is a red build, and the message names both sides.
 *
 * The two sides are the page's two modes (owner, 2026-10-19). The day's roles
 * are the ones its unconditional :root declares; the night's are the ones its
 * `:root:not([data-sky='day'])` block remaps. The day's :root also holds every
 * palette literal and every layout dial, which are the same in both modes by
 * design, so the comparison is drawn on the day's MODE roles — the active
 * --color-* layer components consume, and color-scheme — in one direction,
 * and on everything the night declares in the other. */
test('every reading mode declares the identical token set', () => {
  const declared = (rules) =>
    new Set(rules.flatMap((rule) => declarationsOf(rule.body).map(({ property }) => property)));
  // Unconditional :root only — a rule inside a media or supports query is a
  // rendering some readers never get.
  const dayRules = styleRules.filter(
    (rule) => isDayLayer(rule) && !rule.enclosing.some((at) => /^@(?:media|supports|container)\b/.test(at))
  );
  const nightRules = styleRules.filter((rule) => declaresThemeToken(rule.body) && isNightLayer(rule));
  assert.ok(
    nightRules.length > 0,
    `no ${nightSelector} block declares theme tokens; the parity comparison has nothing left to compare`
  );
  const day = declared(dayRules);
  const night = declared(nightRules);
  const dayRoles = [...day].filter((name) => name === 'color-scheme' || name.startsWith('--color-')).sort();
  assert.ok(
    dayRoles.some((name) => name.startsWith('--color-')),
    'the day’s :root declares no --color-* role; the parity comparison has nothing left to compare'
  );

  // A role the day declares and the night omits falls through to the light
  // palette at night; a token only the night declares is undefined by day.
  // Either is the silent failure this pin exists for, so both directions are
  // one assertion.
  const missing = dayRoles.filter((name) => !night.has(name));
  const extra = [...night].filter((name) => !day.has(name)).sort();
  assert.deepEqual(
    { missing, extra },
    { missing: [], extra: [] },
    `the night does not declare the same tokens as the day — missing ${missing.length > 0 ? missing.join(', ') : 'nothing'}; extra ${extra.length > 0 ? extra.join(', ') : 'nothing'}. A token the night omits falls through to the light palette, silently, on every first visit`
  );
});

/* ===========================================================================
 * THE SHEET DRAWS NO PLAIN LINE (owner, 2026-10-19: "the plain lines should
 * be tree branches, or vines, we should have swords and skulls or castle wall
 * fixtures").
 *
 * Every rule that used to part one thing from the next on the sheet is a prop
 * now — a vine after a section's title, a branch under a role, a twig under a
 * repository and a commit — or nothing at all: the boss log's bosses, and the
 * band the strip ran in, are parted by space alone (the same day: "the skulls
 * here do not look good"). The ledger's own rules still declare the hairlines
 * underneath — the keep layer is written over them — so "no rule draws a
 * line" is a question of the CASCADE, and it is answered as one: for each
 * surface, every declaration that would draw a line (a border on any side, a
 * shadow, a solid ground) must be beaten by a declaration that draws nothing,
 * by specificity and then by order; and the picture that wins is the
 * surface's own prop, or — where space parts it — no picture at all.
 *
 * Conservative wherever the source cannot say: a rule inside a media or
 * supports query may apply, so it can draw a line but never clear one; a
 * component's rule carries Svelte's scoping class; and two rules from
 * different files that tie are read as the line winning, because which one a
 * bundle emits last is not something a source pin can know.
 * ======================================================================== */

// A selector's specificity as [ids, classes, elements]. Only the forms this
// sheet uses are weighed; a functional pseudo-class fails loudly rather than
// being guessed at.
function specificityOf(part) {
  assert.ok(!/:(?:not|is|where|has)\(/.test(part), `"${part}" uses a selector form this pin does not weigh`);
  const ids = (part.match(/#[\w-]+/g) ?? []).length;
  const classes = (part.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+/g) ?? []).length;
  const elements = (part.match(/(?:^|[\s>+~])[a-z][\w-]*|::[\w-]+/gi) ?? []).length;
  return [ids, classes, elements];
}
const compoundsOf = (part) => part.trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean);
const conditional = (rule) => rule.enclosing.some((at) => /^@(?:media|supports|container)\b/.test(at));
// Every rule that can style one surface, each part weighed on its own.
function surfaceRules(target) {
  const found = [];
  sweptRules.forEach((rule, index) => {
    for (const part of selectorParts(rule.selector)) {
      const last = compoundsOf(part).at(-1) ?? '';
      if (last !== target && !(last.startsWith(target) && /^[:[]/.test(last.slice(target.length)) && !last.slice(target.length).startsWith('::'))) {
        continue;
      }
      const [ids, classes, elements] = specificityOf(part);
      const scoped = rule.file === 'styles' ? 0 : compoundsOf(part).length;
      found.push({ rule, index, part, state: last !== target, specificity: [ids, classes + scoped, elements] });
    }
  });
  return found;
}
// Whether `a` wins over `b` for certain: higher specificity, or the same
// specificity later in the same file. Across files a tie is never certain.
function beats(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a.specificity[i] !== b.specificity[i]) return a.specificity[i] > b.specificity[i];
  }
  return a.rule.file === b.rule.file && a.index > b.index;
}
// The channels a line can be drawn in, and whether one declaration draws in
// them: each side's border, the shadow, and a solid ground.
const sideNames = { top: ['bs'], bottom: ['be'], left: ['is'], right: ['ie'], block: ['bs', 'be'], inline: ['is', 'ie'] };
function lineChannels(property, value) {
  const tokens = value.toLowerCase().split(/\s+/);
  const border = /^border(?:-(top|bottom|left|right|block|inline)(?:-(start|end))?)?(?:-(width|style))?$/.exec(property);
  if (border) {
    const [, axis, end, facet] = border;
    let sides = ['bs', 'be', 'is', 'ie'];
    if (axis) sides = sideNames[axis];
    if (end) sides = sides.filter((side) => side.endsWith(end === 'start' ? 's' : 'e'));
    let draws;
    if (facet === 'width') draws = tokens.some((token) => !/^0(?:px|rem|em)?$/.test(token));
    else if (facet === 'style') draws = tokens.some((token) => token !== 'none' && token !== 'hidden');
    else draws = !tokens.some((token) => /^(?:0(?:px|rem|em)?|none|hidden|transparent)$/.test(token));
    return sides.map((side) => ({ channel: `border-${side}`, draws }));
  }
  if (property === 'box-shadow') return [{ channel: 'shadow', draws: value.trim() !== 'none' }];
  if (property === 'background-color') return [{ channel: 'ground', draws: !/^(?:transparent|none)$/i.test(value.trim()) }];
  if (property === 'background') {
    const colour = /var\(--(?:color|ledger|palette|panel|card|grid|usage|tip)-[\w-]*\)|#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|color-mix|oklch|oklab|lab|lch)\(|\bcurrentcolor\b|-gradient\(/i;
    return [{ channel: 'ground', draws: colour.test(value) }];
  }
  if (property === 'background-image') return [{ channel: 'ground', draws: /-gradient\(/i.test(value) }];
  return [];
}

test('the sheet draws no plain line: every separator is the keep’s own prop (owner 2026-10-19)', () => {
  // A surface's prop, or null where it is parted by space alone. (The list
  // heads that wore a branch are gone from the page, 2026-10-19; the column
  // words that replaced them are pinned in tests/sections.test.mjs. The
  // strip's lead went the same day, so the strip is its band and its items.)
  const surfaces = {
    '.section-head::after': 'vine',
    '.ledger-entry': 'branch',
    '.repo-entry': 'twig',
    '.log-entry': 'twig',
    '.ticker-strip': null,
    '.ticker-item': null,
  };
  for (const [target, prop] of Object.entries(surfaces)) {
    const found = surfaceRules(target);
    assert.ok(found.some((entry) => !entry.state), `no rule styles ${target}; this pin has lost its subject`);
    const declarations = found.flatMap((entry) =>
      declarationsOf(entry.rule.body).flatMap(({ property, value }) =>
        lineChannels(property, value).map((channel) => ({ ...entry, ...channel, property, value }))
      )
    );
    for (const line of declarations.filter((entry) => entry.draws)) {
      const cleared = declarations.some(
        (entry) => entry.channel === line.channel && !entry.draws && !conditional(entry.rule) && !entry.state && beats(entry, line)
      );
      assert.ok(
        cleared,
        `${line.rule.file}: "${line.part}" draws ${line.property}: ${line.value} on ${target}, and nothing that draws nothing beats it — the sheet's lines are props now`
      );
    }
    /* And the picture that wins is the surface's own prop, read through its
       token — by specificity, then order, among the rules that always apply,
       with no conditional rule beating it to a different picture. Where space
       parts the surface, every picture that could win is no picture: no prop,
       no file, no gradient drawn where the line used to be. */
    const pictures = found
      .filter((entry) => !entry.state)
      .flatMap((entry) =>
        declarationsOf(entry.rule.body)
          .filter(({ property }) => property === 'background' || property === 'background-image')
          .map(({ value }) => ({ ...entry, value }))
      );
    const always = pictures.filter((entry) => !conditional(entry.rule));
    const winners = always.filter((entry) => !always.some((other) => other !== entry && beats(other, entry)));
    /* A row picked by its place in the list — a role's own bough, a list
       row's own twig (2026-10-19: "make the branches more unique") — wins on
       that row, so its picture is held to the same answer as the surface's. */
    const placed = found
      .filter((entry) => entry.state && /^:nth-(?:child|of-type)\([^()]*\)$/.test(compoundsOf(entry.part).at(-1).slice(target.length)))
      .flatMap((entry) =>
        declarationsOf(entry.rule.body)
          .filter(({ property }) => property === 'background' || property === 'background-image')
          .map(({ value }) => ({ ...entry, value }))
      );
    const contenders = [
      ...winners,
      ...pictures.filter((entry) => conditional(entry.rule) && winners.every((w) => !beats(w, entry))),
      ...placed,
    ];
    if (prop === null) {
      for (const contender of contenders) {
        assert.doesNotMatch(
          contender.value,
          /url\(|var\(--keep-|-gradient\(/,
          `${contender.rule.file}: "${contender.part}" draws ${contender.value} on ${target}, which is parted by space alone`
        );
      }
      continue;
    }
    assert.ok(winners.length > 0, `${target} draws no picture at all; its ${prop} is gone`);
    for (const winner of contenders) {
      assert.match(
        winner.value,
        new RegExp(`var\\(--keep-${prop}(?:-\\d+)?\\)`),
        `${winner.rule.file}: "${winner.part}" paints ${target} with ${winner.value}, not its ${prop}`
      );
    }
    /* EACH ROW ITS OWN (owner, 2026-10-19: "make the branches more unique.
       they all seem to be the same sprite"). Where the prop is a family of
       drawings, the surface's rows take turns with every one of them: a
       member no row is given is a sprite the rows lost, and a surface that
       names only one is every row the same bough again. */
    const members = [...new Set([...styles.matchAll(new RegExp(`--keep-(${prop}-\\d+):`, 'g'))].map((match) => match[1]))].sort();
    if (members.length > 0) {
      const given = new Set(contenders.flatMap((entry) => [...entry.value.matchAll(new RegExp(`var\\(--keep-(${prop}-\\d+)\\)`, 'g'))].map((match) => match[1])));
      assert.deepEqual(
        members.filter((member) => !given.has(member)),
        [],
        `${target}'s rows never take turns with every ${prop}; the ones they skip are listed`
      );
    }
  }
  /* NON-VACUITY, PROVEN ON THE REAL SHEET: the ledger's own hairline under a
     role is still declared underneath the keep layer, so the walk above has a
     real line to clear — and the reader still sees it as one. */
  const hairline = surfaceRules('.ledger-entry').find((entry) =>
    declarationsOf(entry.rule.body).some(({ property, value }) =>
      lineChannels(property, value).some((channel) => channel.draws)
    )
  );
  assert.ok(hairline, 'the reader finds no line under .ledger-entry to clear; this pin proves nothing');
});

/* THE RING NEVER TURNS (owner, 2026-10-19). A role's opener hangs in an iron
 * ring, the knocker of a castle door, and the open state is the chevron's own
 * glyph — down to open, up to close — so nothing rotates: a ring turned over
 * hangs from nothing. No rule may transform, animate or transition a
 * transform on the ring or anything inside it. */
test('the ring never turns: a role opens by its chevron’s swap, never by a rotation (owner 2026-10-19)', () => {
  const ringRules = sweptRules.filter((rule) =>
    selectorParts(rule.selector).some((part) => compoundsOf(part).some((compound) => compound.startsWith('.ledger-chevron')))
  );
  assert.ok(ringRules.length > 0, 'no rule styles the ring; this pin has lost its subject');
  for (const rule of ringRules) {
    for (const { property, value } of declarationsOf(rule.body)) {
      assert.ok(
        !/^(?:transform|rotate|translate|scale|animation(?:-name)?)$/.test(property),
        `${rule.file}: "${rule.selector}" sets ${property}: ${value}; the ring turns`
      );
      if (/^transition(?:-property)?$/.test(property)) {
        assert.doesNotMatch(value, /\b(?:transform|rotate|translate|scale|all)\b/, `${rule.file}: "${rule.selector}" eases a turn of the ring`);
      }
    }
  }
  const log = componentSources['lib/components/LedgerLog.svelte'];
  assert.ok(log, 'the ledger log is not where this pin expects it');
  assert.match(
    stripComments(log),
    /<span class="ledger-chevron" aria-hidden="true">\s*<Icon name=\{open \? 'chevron-up' : 'chevron-down'\} slot="row" \/>/,
    'the open state is no longer the chevron’s own swap, so something else must be turning'
  );
});

/* A ROLE OPENS AS A SCROLL (owner, 2026-10-19: "have it open up like a scroll
 * instead of just re-using the plain background"). The parchment and its upper
 * roller sit inside the drawer's clip, so they are revealed from the top as
 * the drawer opens; the lower roller is the drawer's own last child, outside
 * the clip, so it rides the clip's growing edge down and the scroll unrolls —
 * and it is not drawn at all while the drawer is shut, so a closed role draws
 * no roller under it. The words on the parchment are set in the DAY's inks,
 * at night as by day: the scroll re-points the sheet's ink roles at the
 * parchment tokens, everything drawn on it reads those roles and nothing
 * else, and every ink clears the 4.5:1 text floor on the paper it sits on. */
const scrollGrounds = (tokens) => {
  const scroll = styleRules.filter((rule) => rule.selector === '.ledger-scroll');
  assert.equal(scroll.length, 1, 'the parchment is not drawn by one rule');
  const background = declared(scroll[0]).background ?? '';
  // The grain is a length in the gradient's stops, not a colour.
  const grounds = [...new Set([...background.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(([, token]) => token))].filter(
    (token) => token !== '--keep-prop'
  );
  assert.ok(grounds.length > 0, 'the parchment draws no ground this pin can measure');
  for (const ground of grounds) {
    assert.match(ground, /^--keep-parchment(?:-edge)?$/, `the parchment is drawn in ${ground}, which is not one of its own two papers`);
  }
  return Object.fromEntries(grounds.map((ground) => [ground, resolveToken(ground, tokens)]));
};

test('a role opens as a parchment scroll, its words in the day’s inks on its own paper (owner 2026-10-19)', () => {
  const log = stripComments(componentSources['lib/components/LedgerLog.svelte'] ?? '');
  assert.match(
    log,
    /<div class="ledger-drawer" data-open=\{open \? 'true' : 'false'\} inert=\{!open\}>\s*<div class="ledger-drawer-clip">\s*<div class="ledger-scroll">\s*<ul class="ledger-points">[\s\S]*?<\/ul>[\s\S]*?<\/div>\s*<\/div>\s*<span class="ledger-scroll-end" aria-hidden="true"><\/span>\s*<\/div>/,
    'the parchment is not inside the drawer’s clip with its lower roller after the clip, or that roller is announced'
  );
  const shown = (selector) => styleRules.filter((rule) => rule.selector === selector).map((rule) => declared(rule).display);
  assert.deepEqual(shown('.ledger-scroll-end'), ['none'], 'a shut drawer draws a roller under its role');
  assert.deepEqual(shown(".ledger-drawer[data-open='true'] > .ledger-scroll-end"), ['block'], 'an open drawer draws no lower roller');

  const scroll = declared(styleRules.find((rule) => rule.selector === '.ledger-scroll'));
  assert.equal(scroll['--ledger-ink'], 'var(--keep-parchment-ink)', 'the parchment’s words are not in its own ink');
  assert.equal(scroll['--ledger-muted'], 'var(--keep-parchment-muted)', 'the parchment’s quiet words are not in its own muted ink');
  assert.equal(scroll['--ledger-highlight'], 'var(--keep-parchment-mark)', 'the parchment’s link is not marked in its own ink');
  assert.equal(scroll.color, 'var(--keep-parchment-ink)', 'the parchment’s own text colour is not its ink');
  // Everything drawn on the paper reads the re-pointed roles, never a sheet
  // colour a role cannot re-point.
  const onTheScroll = sweptRules.filter((rule) =>
    selectorParts(rule.selector).some((part) =>
      compoundsOf(part).some((compound) => /^\.ledger-(?:scroll|points?|link)\b/.test(compound) && !compound.startsWith('.ledger-scroll-end'))
    )
  );
  assert.ok(onTheScroll.length > 0, 'nothing is drawn on the parchment; this pin has lost its subject');
  for (const rule of onTheScroll) {
    for (const { property, value } of declarationsOf(rule.body)) {
      if (!/^(?:color|background(?:-color)?|border(?:-[a-z-]+)?-color|outline(?:-color)?|text-decoration(?:-color)?|fill|stroke)$/.test(property)) continue;
      for (const [, token] of value.matchAll(/var\((--[a-z0-9-]+)/g)) {
        assert.match(
          token,
          // The roles, the parchment's own colours, and the rollers' drawings
          // and grain (images and a length, which paint no colour of their own).
          /^--(?:ledger-(?:ink|muted|highlight)|keep-parchment(?:-[a-z]+)?|keep-scroll-[a-z-]+|keep-prop)$/,
          `${rule.file}: "${rule.selector}" paints ${property} in ${token}, a colour the scroll does not re-point to its paper`
        );
      }
      assert.doesNotMatch(value, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, `${rule.file}: "${rule.selector}" paints a raw colour on the parchment`);
    }
  }

  // And every ink clears the text floor on the paper. The link's mark is
  // measured on the parchment itself, the only paper a word sits on: the next
  // pin keeps every word off the darkened edge.
  for (const mode of readingModes) {
    const tokens = tokensFor(mode);
    const grounds = scrollGrounds(tokens);
    for (const ink of ['--keep-parchment-ink', '--keep-parchment-muted']) {
      for (const [ground, paper] of Object.entries(grounds)) {
        const ratio = contrastRatio(resolveToken(ink, tokens), paper);
        assert.ok(ratio >= 4.5, `${mode}: ${ink} on ${ground} is ${ratio.toFixed(2)}:1, below the 4.5:1 text floor`);
      }
    }
    const mark = contrastRatio(resolveToken('--keep-parchment-mark', tokens), resolveToken('--keep-parchment', tokens));
    assert.ok(mark >= 4.5, `${mode}: the link’s mark on the parchment is ${mark.toFixed(2)}:1, below the 4.5:1 text floor`);
  }
});

/* NO WORD ON THE DARKENED EDGE (2026-10-19). The parchment shades to
 * --keep-parchment-edge at each side, where the link's mark — the brand
 * orange on light — measures 3.71:1, under the 4.5:1 text floor; on a phone
 * the drawer's list and link start at the scroll's own edge (the link's
 * 10.25rem inset is dropped at 45rem). That gap was recorded as a ratchet
 * pair and closed by geometry rather than by colour: the darkened band is a
 * fixed width in the props' grain, the same at both sides, and the scroll's
 * words begin inside its padding, which is wider than the band. So every word
 * sits on --keep-parchment, where the floor above holds, at any width. */
test('no word on a role’s scroll sits on the parchment’s darkened edge', () => {
  const rule = styleRules.find((candidate) => candidate.selector === '.ledger-scroll');
  const { background = '', 'padding-inline': padding = '' } = declared(rule);
  const paper = 'var\\(--keep-parchment\\)';
  const edge = 'var\\(--keep-parchment-edge\\)';
  const bands = new RegExp(
    `^linear-gradient\\(\\s*to right,\\s*${edge},\\s*${paper} calc\\((\\d+) \\* var\\(--keep-prop\\)\\),\\s*${paper} calc\\(100% - (\\d+) \\* var\\(--keep-prop\\)\\),\\s*${edge}\\s*\\)$`
  ).exec(background.trim());
  assert.ok(bands, `the parchment's darkened edge is not a fixed band in the props' grain at each side: ${background}`);
  const [, start, end] = bands.map(Number);
  assert.equal(start, end, 'the parchment darkens further at one side than the other');
  const inset = /^calc\((\d+) \* var\(--keep-prop\)\)$/.exec(padding.trim());
  assert.ok(inset, `the scroll's words are not inset from its edges in the props' grain: "${padding}"`);
  assert.ok(Number(inset[1]) > start, `the scroll's words begin ${inset[1]} props in, on or before its ${start}-prop darkened band`);
  // The scroll's own mark is the one ink whose floor fails on the edge paper;
  // it stays out of reach of every rule that could pull a word back onto it.
  const pulled = sweptRules.filter(
    (candidate) =>
      selectorParts(candidate.selector).some((part) => compoundsOf(part).some((compound) => /^\.ledger-(?:points?|link)\b/.test(compound))) &&
      Object.entries(declared(candidate)).some(
        ([property, value]) =>
          /^margin(?:-inline(?:-start|-end)?)?$/.test(property) &&
          /(?:^|[\s(,*])-\s*(?:[\d.]|calc|var|min|max)/.test(value.replace(/var\(--[a-z0-9-]+\)/g, 'var'))
      )
  );
  assert.deepEqual(pulled.map((candidate) => `${candidate.file}: ${candidate.selector}`), [], 'a rule pulls the scroll’s words out over its padding');
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
