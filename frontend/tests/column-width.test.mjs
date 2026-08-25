import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
  applyStoredColumnWidth,
  clampColumnRem,
  columnBounds,
  columnKeyIntent,
  columnKeyStepRem,
  columnKeyWidth,
  columnSignFor,
  columnStorageKey,
  columnWidthValue,
  dragColumnRem,
  lengthRem,
  parseStoredColumnRem,
  railsBreakpointRem,
  railsFit,
  railsMediaQuery,
  readColumnTokens,
  readStoredColumn,
  storedColumnValue,
  writeStoredColumn
} from '../src/lib/columnWidth.ts';

/* The reader-controlled page width (owner directive, 2026-08-24: "give me
 * very sleek and seamless ability to drag the feed in or out on its X axis",
 * and — equally weighted — "make sure that all objects stay responsive and
 * that there is no way to break the website in an ugly way").
 *
 * These tests EXECUTE the drag rather than pinning source text around it, the
 * same split disclosure.ts established: every number, clamp and keystroke
 * lives in a framework-free module, and the browser lanes in
 * e2e/rendering-lanes.spec.mjs measure what an engine then did with it. The
 * halves answer different questions and neither replaces the other — a clamp
 * proven here holds on engines no runner has, and a lane proves this build's
 * declarations survived a real cascade.
 *
 * The apply path runs against a hand-written fake host that RECORDS every
 * style write, because "no value a reader supplied ever reaches a style
 * declaration" is a claim about the writes, and a claim about writes needs to
 * be checked against the writes.
 */

const [styles, component, entry] = await Promise.all([
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/components/ColumnHandles.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
]);

// The token layer as the stylesheet declares it, so every number below is the
// shipped one rather than a copy that could drift out of agreement with it.
const declaredToken = (name) => {
  const found = new RegExp(`${name}:\\s*([\\d.]+)(rem|px);`).exec(styles);
  assert.ok(found, `styles.css declares no ${name}`);
  return found[2] === 'rem' ? Number(found[1]) : Number(found[1]) / 16;
};

const shipped = {
  base: declaredToken('--page-column-base'),
  min: declaredToken('--page-column-min'),
  max: declaredToken('--page-column-max'),
  gutter: declaredToken('--page-gutter'),
  rail: declaredToken('--page-rail-size')
};

// fakeHost is the browser seam: five token values, a root font size, a
// viewport, and a log of every write the module made.
function fakeHost({ tokens = {}, rootFontPx = 16, viewportPx = 1920 } = {}) {
  const values = {
    '--page-column-base': `${shipped.base}rem`,
    '--page-column-min': `${shipped.min}rem`,
    '--page-column-max': `${shipped.max}rem`,
    '--page-gutter': `${shipped.gutter}rem`,
    '--page-rail-size': `${shipped.rail}rem`,
    ...tokens
  };
  const writes = [];
  return {
    writes,
    tokenValue: (name) => values[name] ?? '',
    rootFontPx: () => rootFontPx,
    viewportPx: () => viewportPx,
    write: (value) => writes.push(value)
  };
}

const fakeStore = (value) => ({ getItem: () => value, setItem: () => {} });

const recordingStore = () => {
  const written = [];
  return { written, getItem: () => null, setItem: (key, value) => written.push([key, value]) };
};

const hostileStore = () => ({
  getItem() {
    throw new DOMException('storage is not available', 'SecurityError');
  },
  setItem() {
    throw new DOMException('storage is not available', 'SecurityError');
  }
});

const readTokens = (host) => {
  const tokens = readColumnTokens(host);
  assert.ok(tokens, 'the fake host was expected to expose a readable token layer');
  return tokens;
};

describe('the token layer is read, never restated', () => {
  it('resolves rem and px token values against the reader own root size', () => {
    assert.equal(lengthRem('18rem', 16), 18);
    assert.equal(lengthRem('  18rem  ', 16), 18);
    assert.equal(lengthRem('288px', 16), 18);
    // A reader browsing at 20px gets a token layer measured in THEIR rem, so
    // every bound scales with the text rather than fighting it.
    assert.equal(lengthRem('360px', 20), 18);
  });

  it('refuses every value it cannot resolve to a length', () => {
    for (const value of ['', '18', '18em', '18%', 'calc(1rem + 1px)', 'var(--x)', 'auto', 'NaNrem']) {
      assert.equal(lengthRem(value, 16), null, `"${value}" must not resolve to a length`);
    }
    // A zero or absent root font size would turn a px token into Infinity.
    assert.equal(lengthRem('288px', 0), null);
  });

  it('reads the whole layer or none of it', () => {
    const tokens = readTokens(fakeHost());
    assert.deepEqual(tokens, { ...shipped, rootFontPx: 16 });
  });

  it('reports the feature absent when any part of the layer is unreadable', () => {
    // Every token in turn: a partial reading would mean guessing one bound,
    // and a guessed bound is exactly what the token layer exists to prevent.
    for (const name of [
      '--page-column-base',
      '--page-column-min',
      '--page-column-max',
      '--page-gutter',
      '--page-rail-size'
    ]) {
      assert.equal(
        readColumnTokens(fakeHost({ tokens: { [name]: '' } })),
        null,
        `a missing ${name} must switch the whole feature off, not be guessed at`
      );
    }
    assert.equal(readColumnTokens(fakeHost({ rootFontPx: 0 })), null);
    assert.equal(readColumnTokens(fakeHost({ rootFontPx: Number.NaN })), null);
    // A layer claiming a floor above its ceiling is broken, not a puzzle.
    assert.equal(
      readColumnTokens(fakeHost({ tokens: { '--page-column-min': '200rem' } })),
      null,
      'inverted bounds must switch the feature off rather than resolve to something'
    );
  });
});

describe('the rails exist only where there is room for them', () => {
  it('derives the breakpoint from the column, its gutters and its two lanes', () => {
    const tokens = readTokens(fakeHost());
    assert.equal(railsBreakpointRem(tokens), shipped.base + 2 * shipped.gutter + 2 * shipped.rail);
  });

  it('builds the same query the stylesheet asks', () => {
    const tokens = readTokens(fakeHost());
    const query = railsMediaQuery(tokens);
    assert.equal(query, `(min-width: ${railsBreakpointRem(tokens)}rem)`);
    // The script and the stylesheet must ask ONE question. A literal in either
    // place is a second copy free to disagree with the first, and the symptom
    // would be a handle rendered where the stylesheet has already hidden it.
    assert.ok(
      styles.includes(`@media ${query} {`),
      `styles.css has no "@media ${query}" block; the script and the stylesheet disagree about where the handles appear`
    );
  });

  it('answers false on every phone width and true on a desktop', () => {
    const tokens = readTokens(fakeHost());
    for (const width of [320, 360, 390, 412, 768, 1024]) {
      assert.equal(railsFit(tokens, width), false, `${width}px must render no handles`);
    }
    for (const width of [1080, 1280, 1440, 1920]) {
      assert.equal(railsFit(tokens, width), true, `${width}px has room for the handles`);
    }
    // The boundary itself, exactly: the breakpoint is inclusive, which is what
    // makes the stylesheet's min-width and this agree at the one pixel where
    // disagreeing would show.
    assert.equal(railsFit(tokens, railsBreakpointRem(tokens) * 16), true);
    assert.equal(railsFit(tokens, railsBreakpointRem(tokens) * 16 - 1), false);
  });
});

describe('the bounds in force follow the viewport', () => {
  it('caps the ceiling at the space the viewport can actually give', () => {
    const tokens = readTokens(fakeHost());
    // A monitor wide enough for the token maximum gets the token maximum.
    assert.deepEqual(columnBounds(tokens, 2560), { min: shipped.min, max: shipped.max });
    // A laptop does not, and the ceiling is the viewport less its gutters and
    // its two lanes — the identical subtraction the stylesheet makes.
    const laptop = columnBounds(tokens, 1280);
    assert.equal(laptop.max, 1280 / 16 - 2 * shipped.gutter - 2 * shipped.rail);
    assert.ok(laptop.max < shipped.max);
  });

  it('never lets the floor rise above the ceiling', () => {
    const tokens = readTokens(fakeHost());
    // A viewport too narrow for the minimum column. A flat floor here would
    // return a column WIDER than the screen, which is the exact defect the
    // no-horizontal-scroll floor is about.
    const cramped = columnBounds(tokens, 320);
    assert.ok(cramped.min <= cramped.max, `floor ${cramped.min} is above ceiling ${cramped.max}`);
    assert.equal(clampColumnRem(shipped.base, cramped), cramped.max);
  });
});

describe('the clamp holds against every number', () => {
  const bounds = { min: 18, max: 100 };

  it('brings a value inside both bounds', () => {
    assert.equal(clampColumnRem(60, bounds), 60);
    assert.equal(clampColumnRem(17.999, bounds), 18);
    assert.equal(clampColumnRem(-40, bounds), 18);
    assert.equal(clampColumnRem(0, bounds), 18);
    assert.equal(clampColumnRem(100.001, bounds), 100);
    assert.equal(clampColumnRem(99999, bounds), 100);
  });

  it('refuses a value that is not a finite number rather than passing it through', () => {
    // NaN survives every comparison operator, so Math.min/Math.max alone would
    // hand it straight to a style declaration and blank the column.
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const clamped = clampColumnRem(value, bounds);
      assert.ok(Number.isFinite(clamped), `${value} escaped the clamp as ${clamped}`);
      assert.ok(clamped >= bounds.min && clamped <= bounds.max);
    }
  });
});

/* Storage is attacker-writable in every threat model worth the name — a
 * shared machine, another tab, a console paste — so each of these is a value
 * the site may genuinely be handed, and every one of them must land the page
 * on a width it chose itself. */
const hostileStoredValues = [
  ['a CSS length', '99999px'],
  ['a negative CSS length', '-40rem'],
  ['a rem length', '60rem'],
  ['plain garbage', 'garbage'],
  ['an empty string', ''],
  ['whitespace only', '   '],
  ['a JSON object', '{"rem":60}'],
  ['a JSON array', '[60]'],
  ['a CSS injection attempt', '60rem; background: url(https://example.invalid/beacon)'],
  ['a declaration terminator', '60; }'],
  ['a second declaration smuggled behind a newline', '60\n--page-column-max: 9999rem'],
  ['a var() reference', 'var(--page-column-max)'],
  ['a calc() expression', 'calc(100% - 1rem)'],
  ['an expression', '30 + 30'],
  ['hexadecimal', '0x40'],
  ['exponential notation', '6e1'],
  ['an exponential overflow', '1e400'],
  ['the word Infinity', 'Infinity'],
  ['the word NaN', 'NaN'],
  ['a leading plus', '+60'],
  ['a trailing dot', '60.'],
  ['full-width digits', '６０'],
  ['a null byte', '60\u0000'],
  ['a trailing newline', '60\n'],
  ['a leading space', ' 60']
];

describe('a poisoned preference lands on the shipped default', () => {
  it('rejects every shape that is not a bare decimal', () => {
    for (const [name, raw] of hostileStoredValues) {
      assert.equal(parseStoredColumnRem(raw), null, `${name} (${JSON.stringify(raw)}) was accepted`);
    }
    assert.equal(parseStoredColumnRem(null), null);
  });

  it('accepts a bare decimal, in range or out of it', () => {
    // The grammar keeps foreign SYNTAX out; the clamp keeps the geometry sane.
    // Conflating them would mean a bound change silently discarding a reader's
    // preference instead of bringing it inside the new range.
    assert.equal(parseStoredColumnRem('60'), 60);
    assert.equal(parseStoredColumnRem('73.5'), 73.5);
    assert.equal(parseStoredColumnRem('-40'), -40);
    assert.equal(parseStoredColumnRem('99999'), 99999);
    assert.equal(parseStoredColumnRem('0'), 0);
  });

  it('applies the shipped default for every hostile shape, and writes nothing else', () => {
    for (const [name, raw] of hostileStoredValues) {
      const host = fakeHost();
      const applied = applyStoredColumnWidth(host, fakeStore(raw));
      assert.equal(applied, shipped.base, `${name} did not land on the shipped column`);
      assert.deepEqual(host.writes, [`${shipped.base}rem`], `${name} produced ${host.writes}`);
    }
  });

  it('clamps a well-formed number that is out of range instead of discarding it', () => {
    const wide = fakeHost();
    assert.equal(applyStoredColumnWidth(wide, fakeStore('99999')), shipped.max);
    assert.deepEqual(wide.writes, [`${shipped.max}rem`]);
    const narrow = fakeHost();
    assert.equal(applyStoredColumnWidth(narrow, fakeStore('-40')), shipped.min);
    assert.deepEqual(narrow.writes, [`${shipped.min}rem`]);
  });
});

describe('nothing a reader supplied ever reaches a style declaration', () => {
  it('constructs every written value from a number it produced itself', () => {
    // The whole injection argument in one assertion: columnWidthValue takes a
    // NUMBER, so there is no string path from storage, from a pointer event or
    // from the DOM into the value the browser parses.
    const numeric = /^\d+(?:\.\d+)?rem$/;
    for (const [name, raw] of hostileStoredValues) {
      const host = fakeHost();
      applyStoredColumnWidth(host, fakeStore(raw));
      for (const written of host.writes) {
        assert.match(written, numeric, `${name} produced the style value ${JSON.stringify(written)}`);
      }
    }
    for (const rem of [18, 60, 73.5, 99.999, 100]) {
      assert.match(columnWidthValue(rem), numeric);
      assert.match(storedColumnValue(rem), /^\d+(?:\.\d+)?$/);
    }
  });

  it('keeps a written length short of exponential notation and finer than a pixel', () => {
    assert.equal(columnWidthValue(73.500001), '73.5rem');
    assert.equal(columnWidthValue(60), '60rem');
    assert.equal(storedColumnValue(73.4567), '73.457');
    // Three decimals of a rem is well under a device pixel at any font size,
    // and the clamped range never reaches the magnitudes where JavaScript
    // formats a number as 1e+21 — which is not a length any browser parses.
    assert.equal(columnWidthValue(clampColumnRem(1e30, { min: 18, max: 100 })), '100rem');
    assert.doesNotMatch(columnWidthValue(clampColumnRem(1e30, { min: 18, max: 100 })), /e[+-]/);
  });
});

describe('the persistence round trip', () => {
  it('applies a stored width and writes back the value it applied', () => {
    const host = fakeHost();
    const applied = applyStoredColumnWidth(host, fakeStore('73.5'));
    assert.equal(applied, 73.5);
    assert.deepEqual(host.writes, ['73.5rem']);
    const store = recordingStore();
    writeStoredColumn(store, applied);
    assert.deepEqual(store.written, [[columnStorageKey, '73.5']]);
    assert.equal(parseStoredColumnRem(store.written[0][1]), applied);
  });

  it('treats storage that is unavailable as no preference rather than as a failure', () => {
    // localStorage throws rather than returning null in several ordinary
    // situations — site data disabled, a sandboxed frame, private mode under
    // storage pressure — and none of them is a reason for a page not to render.
    assert.equal(readStoredColumn(hostileStore()), null);
    assert.equal(readStoredColumn(null), null);
    assert.doesNotThrow(() => writeStoredColumn(hostileStore(), 60));
    assert.doesNotThrow(() => writeStoredColumn(null, 60));
    const host = fakeHost();
    assert.equal(applyStoredColumnWidth(host, hostileStore()), shipped.base);
    assert.deepEqual(host.writes, [`${shipped.base}rem`]);
  });

  it('does nothing at all when the token layer is unreadable', () => {
    const host = fakeHost({ tokens: { '--page-column-min': 'nonsense' } });
    assert.equal(applyStoredColumnWidth(host, fakeStore('73.5')), null);
    assert.deepEqual(host.writes, [], 'a page with no readable tokens must be left exactly as it renders');
  });
});

describe('a viewport with no room for handles keeps the page it always had', () => {
  it('removes any inline width below the breakpoint', () => {
    for (const width of [320, 360, 390, 412, 768, 1024]) {
      const host = fakeHost({ viewportPx: width });
      assert.equal(applyStoredColumnWidth(host, fakeStore('30')), null, `${width}px must not be resized`);
      // Removed, not clamped down: a preference chosen on a monitor is not a
      // preference about a phone, and applying a squeezed version of it there
      // would narrow a screen that was already exactly right.
      assert.deepEqual(host.writes, [null], `${width}px wrote ${host.writes}`);
    }
  });
});

describe('the drag tracks the pointer one for one', () => {
  const tokens = readTokens(fakeHost());
  const bounds = columnBounds(tokens, 2560);

  it('doubles the travel, so the edge lands exactly under the finger', () => {
    // The doubling is the geometry of a centred column, not a sensitivity
    // setting: a column that grows by four rem puts two on each side, so the
    // edge the reader is holding has moved two rem — which is the 32 pixels
    // their pointer moved. The assertion is that identity, not the number.
    const drag = { sign: 1, pointerPx: 1000, widthRem: 60 };
    for (const travelledPx of [32, -32, 160, -240]) {
      const width = dragColumnRem(drag, 1000 + travelledPx, tokens, bounds);
      const edgeMovedPx = ((width - drag.widthRem) / 2) * tokens.rootFontPx;
      assert.equal(edgeMovedPx, travelledPx, `${travelledPx}px of pointer moved the edge ${edgeMovedPx}px`);
    }
  });

  it('mirrors on the start handle', () => {
    const drag = { sign: -1, pointerPx: 1000, widthRem: 60 };
    for (const travelledPx of [32, -32, 160, -240]) {
      const width = dragColumnRem(drag, 1000 + travelledPx, tokens, bounds);
      const edgeMovedPx = ((width - drag.widthRem) / 2) * tokens.rootFontPx;
      assert.equal(edgeMovedPx, -travelledPx, 'the start edge must track its own pointer, in its own direction');
    }
    assert.ok(
      dragColumnRem(drag, 968, tokens, bounds) > 60,
      'dragging the start edge outward must widen the column'
    );
  });

  it('measures from the grab rather than from the centre', () => {
    // A press that snapped the edge to the finger would move the page before
    // the reader had asked for anything.
    const drag = { sign: 1, pointerPx: 1200, widthRem: 40 };
    assert.equal(dragColumnRem(drag, 1200, tokens, bounds), 40);
  });

  it('clamps at both extremes however hard the pointer is thrown', () => {
    const drag = { sign: 1, pointerPx: 1000, widthRem: 60 };
    assert.equal(dragColumnRem(drag, 1e6, tokens, bounds), bounds.max);
    assert.equal(dragColumnRem(drag, -1e6, tokens, bounds), bounds.min);
    // And against the viewport, not merely against the token ceiling: on a
    // laptop the reachable maximum is smaller, and it is the one that binds.
    const laptop = columnBounds(tokens, 1280);
    assert.equal(dragColumnRem(drag, 1e6, tokens, laptop), laptop.max);
    assert.ok(laptop.max < bounds.max);
  });

  it('derives each handle direction from where it actually rendered', () => {
    // Measured, not assumed: the pair is placed with logical properties, so in
    // a right-to-left document the two swap sides and this follows them.
    assert.equal(columnSignFor(100, 1920), -1);
    assert.equal(columnSignFor(1820, 1920), 1);
    assert.equal(columnSignFor(960, 1920), 1);
  });
});

describe('the keyboard drives the same width the pointer does', () => {
  const tokens = readTokens(fakeHost());
  const bounds = columnBounds(tokens, 2560);

  it('moves the splitter, not the column, so the arrows mean what they say', () => {
    // WAI-ARIA Authoring Practices, Window Splitter: the arrows move the
    // SPLITTER. Moving the start handle left widens the column; moving the end
    // handle left narrows it. A splitter that widened from both sides on the
    // same key would be lying about which way it points.
    assert.deepEqual(columnKeyIntent('ArrowLeft', -1), { kind: 'delta', rem: columnKeyStepRem });
    assert.deepEqual(columnKeyIntent('ArrowRight', -1), { kind: 'delta', rem: -columnKeyStepRem });
    assert.deepEqual(columnKeyIntent('ArrowLeft', 1), { kind: 'delta', rem: -columnKeyStepRem });
    assert.deepEqual(columnKeyIntent('ArrowRight', 1), { kind: 'delta', rem: columnKeyStepRem });
  });

  it('sends Home and End to the two ends', () => {
    assert.deepEqual(columnKeyIntent('Home', 1), { kind: 'jump', to: 'min' });
    assert.deepEqual(columnKeyIntent('End', 1), { kind: 'jump', to: 'max' });
    assert.equal(columnKeyWidth(columnKeyIntent('Home', 1), 60, bounds), bounds.min);
    assert.equal(columnKeyWidth(columnKeyIntent('End', 1), 60, bounds), bounds.max);
  });

  it('leaves every other key alone', () => {
    // Tab still tabs, an unclaimed arrow still scrolls, Enter still does
    // nothing here — a widget that swallowed keys it does not answer would
    // trap a keyboard reader on a page they were only passing through.
    for (const key of ['ArrowUp', 'ArrowDown', 'Tab', 'Enter', ' ', 'Escape', 'PageUp', 'a']) {
      assert.equal(columnKeyIntent(key, 1), null, `${key} must not be claimed`);
      assert.equal(columnKeyWidth(columnKeyIntent(key, 1), 60, bounds), null);
    }
  });

  it('nudges within the bounds and stops at them', () => {
    assert.equal(columnKeyWidth(columnKeyIntent('ArrowRight', 1), 60, bounds), 60 + columnKeyStepRem);
    assert.equal(columnKeyWidth(columnKeyIntent('ArrowLeft', 1), bounds.min, bounds), bounds.min);
    assert.equal(columnKeyWidth(columnKeyIntent('ArrowRight', 1), bounds.max, bounds), bounds.max);
  });
});

/* The source pins. Everything above executes; these three properties are
 * decided in declarations, which is where they have to be held. */

describe('the page cannot be broken by a width, whichever half is looking', () => {
  it('clamps in the browser as well as in the script', () => {
    // Belt AND braces, and the point of pinning both is that losing ONE is
    // silent: a page with only the script clamp still renders correctly today
    // and fails open the moment a value reaches the token by any other route.
    // main alone carries the column now — the header decoupled from it
    // (owner directive, issue 168) and no longer shares this rule.
    const rule = /#app > main\s*\{([^}]*)\}/.exec(styles);
    assert.ok(rule, 'the page column rule has moved; the clamp pins below no longer measure it');
    assert.match(rule[1], /inline-size:\s*min\(var\(--page-column-width\), 100%\);/);
    assert.match(
      rule[1],
      /min-inline-size:\s*min\(var\(--page-column-min\), 100%\);/,
      'the browser must hold the floor itself, not trust whatever wrote the token'
    );
    assert.match(
      rule[1],
      /max-inline-size:\s*min\(var\(--page-column-max\), 100%\);/,
      'the browser must hold the ceiling itself, and against 100% so the column can never exceed the space it is given'
    );
  });

  it('reserves the two hit lanes out of the column ceiling', () => {
    // Without this subtraction the widest column a reader can reach pushes its
    // own handles off the edge of the page, which is the horizontal scroll
    // this site does not have.
    assert.match(
      styles,
      /max-inline-size:\s*min\(var\(--page-column-max\), calc\(100% - 2 \* var\(--page-rail-size\)\)\);/
    );
  });

  it('hides the handles below the breakpoint in the stylesheet too', () => {
    // The second answer to the same question the component asks matchMedia.
    // Either alone keeps a phone exactly as it has always been; the pair is
    // what makes losing one of them a red build rather than a silent regress.
    assert.match(styles, /\.column-handle\s*\{[^}]*display:\s*none;/);
    assert.match(styles, /@media \(min-width: [\d.]+rem\) \{[\s\S]*?\.column-handle \{\s*display: block;/);
    assert.match(component, /railsMediaQuery\(read\)/);
    assert.match(component, /\{#if fits\}/, 'the component must not render a handle it has no room for');
  });

  it('applies the reader width before the application renders anything', () => {
    // Order is the whole guarantee: everything the application paints is
    // painted after this call, in the same synchronous task, so the first
    // paint is already at the chosen width. The browser lane MEASURES the
    // resulting layout shift; this holds the ordering the measurement depends
    // on.
    const applied = entry.indexOf('applyStoredColumnWidth(');
    const mounted = entry.indexOf('mount(App');
    assert.ok(applied > 0, 'main.ts no longer applies the stored width');
    assert.ok(mounted > 0, 'main.ts no longer mounts the application');
    assert.ok(
      applied < mounted,
      'the stored width is applied after the application mounts, which paints the page narrow and then widens it'
    );
  });

  it('reads no layout inside the drag frame', () => {
    // The bounds are measured once, at the grab. Reading the viewport again
    // inside the frame would force the browser to finish layout in the middle
    // of a frame it is still building, which is the read-after-write stall
    // that makes a drag feel heavy.
    // The WHOLE function, not the prefix before its first closing brace: the
    // guard clause at the top of commit() ends in a brace, so a lazier
    // extraction stopped there and a layout read on the line below it survived
    // this pin entirely (found by mutating it in).
    const commit = /function commit\(\): void \{[\s\S]*?\n  \}/.exec(component);
    assert.ok(commit, 'the drag frame callback has moved; this pin no longer measures it');
    assert.doesNotMatch(
      commit[0],
      /viewportPx\(\)|getBoundingClientRect/,
      'the drag frame reads layout; the bounds are measured at the grab precisely so it does not have to'
    );
    assert.match(component, /frame = requestAnimationFrame\(commit\)/);
    assert.match(component, /if \(frame !== 0\) \{\s*return;/, 'a second frame must not be requested while one is owed');
  });
});

describe('the handle looks like the rest of the page', () => {
  const styleBlock = /<style>([\s\S]*?)<\/style>/.exec(component);
  assert.ok(styleBlock, 'the handle has no scoped style block');
  // Comments are blanked before anything is measured. A raw-text scan that
  // counted prose would report the "44px" in a sentence explaining the hit
  // lane as a hardcoded length, which is how a pin comes to fail for reasons
  // that have nothing to do with what it guards.
  const block = styleBlock[1].replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Declarations, whitespace-normalised, so two rules can be compared for
  // what they SAY rather than for how they happen to be indented.
  const declarations = (body) =>
    body
      .split(';')
      .map((entry) => entry.trim().replace(/\s+/g, ' '))
      .filter((entry) => entry.length > 0);

  it('states every colour and length through a token', () => {
    assert.doesNotMatch(
      block,
      /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z])/,
      'the handle must reference tokens, never hex values'
    );
    // Every length in the block is a token, with exactly one exception: the
    // focus ring, which is pinned BYTE-FOR-BYTE against the site ring below
    // rather than merely resembling it.
    const lengths = [...block.matchAll(/[\d.]+(?:px|rem)/g)].map(([value]) => value);
    assert.deepEqual(
      lengths,
      ['2px', '2px'],
      `the handle states lengths the token layer already covers: ${lengths.join(', ')}`
    );
  });

  it('wears the site focus ring, to the letter', () => {
    // A control that invented its own focus indicator is a control a keyboard
    // reader has to learn separately.
    const site = /\.icon-button:focus-visible \{([^}]*)\}/.exec(styles);
    assert.ok(site, 'the shared focus ring has moved');
    const handle = /\.column-handle:focus-visible \{([^}]*)\}/.exec(block);
    assert.ok(handle, 'the handle declares no focus ring');
    assert.deepEqual(declarations(handle[1]), declarations(site[1]));
    assert.deepEqual(declarations(site[1]), ['outline: 2px solid var(--color-accent)', 'outline-offset: 2px']);
  });

  it('paints nothing at all, at rest or during the drag (issue 177)', () => {
    // "no bar, no animation... the edge is simply draggable and the width
    // follows the pointer" (issue 177); "no rendered bars at rest AND none
    // during drag" (issue 168). The pointer affordance is the cursor
    // (col-resize, styles.css) over the hot zone; this element draws
    // nothing of its own any more — not a quiet mark, not a live one.
    assert.doesNotMatch(block, /::before/, 'the handle still paints a pseudo-element bar');
    assert.doesNotMatch(
      block,
      /--page-rail-ink|--page-rail-line/,
      'the handle still reaches for the retired bar tokens'
    );
    assert.doesNotMatch(
      component,
      /data-live/,
      'the handle still carries a drag-lit attribute for a bar that no longer exists'
    );
  });

  it('carries no transition or animation of its own', () => {
    // There was exactly one thing here to animate — the bar's color and
    // width on hover, focus and drag — and it left with the bar. What
    // remains (the site's own focus-visible outline) is not this
    // component's transition to add.
    assert.doesNotMatch(
      block,
      /transition|animation|prefers-reduced-motion/,
      'the handle states a transition; issue 177 asked for none at all'
    );
  });
});
