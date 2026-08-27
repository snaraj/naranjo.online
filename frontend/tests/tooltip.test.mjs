/* The hover-detail primitive (issue #136 rule 1; owner directive 2026-08-24).
 *
 * The page had TWO details and one of them was not designed: the boss tiles
 * carried a styled readout, the skill tiles carried a bare `title=` attribute,
 * and the owner asked for the two to be ALIGNED — same look, same behaviour,
 * following the cursor rather than opening over a grid cell a row away from
 * it. This suite is the half of that guarantee that can be proven without a
 * browser: the placement arithmetic (executed, not pattern-matched), the
 * detail builders both grids share, the token layer every dimension resolves
 * through, and the structural pins that make a SECOND implementation a red
 * build rather than a code review someone has to catch.
 *
 * The other half is e2e/rendering-lanes.spec.mjs, which measures what five
 * real engines did with all of it. Neither replaces the other: arithmetic
 * proves the rule the next build inherits, a lane proves this build survived
 * a real cascade.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  bossDetail,
  osrsStatsProps,
  skillDetail,
  summaryDetail,
  skillSummary,
} from '../src/lib/bossLog.ts';
import {
  anchoredPlacement,
  clampAxis,
  drivenBinding,
  finePointerQuery,
  pixelLength,
  pointerPlacement,
  tipMetricsFallback,
} from '../src/lib/tooltip.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const [styles, tooltipSource, tipComponent, statTracker] = await Promise.all([
  read('../src/styles.css'),
  read('../src/lib/tooltip.ts'),
  read('../src/lib/components/DetailTip.svelte'),
  read('../src/lib/components/StatTracker.svelte'),
]);

/* Every .svelte file under src/, discovered by walking the tree rather than
 * listed by hand: the sweeps below are claims about the WHOLE component tree,
 * and a component added tomorrow must be covered without anyone remembering
 * to add it here. */
const componentSources = Object.fromEntries(
  await Promise.all(
    (await readdir(new URL('../src', import.meta.url), { recursive: true }))
      .filter((entry) => entry.endsWith('.svelte'))
      .map(async (entry) => [entry, await read(`../src/${entry}`)])
  )
);

/* A component's scoped <style>, with its comments removed. Comment-blind is
 * load-bearing rather than tidy: an absence pin over raw text matches prose a
 * browser never reads, so "no transition anywhere" was satisfied by a comment
 * SAYING there is no transition. */
const styleBlock = (source) =>
  (/<style[^>]*>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');

/* The token layer's value for one custom property, read from the :root block
 * the components resolve through. */
function token(name) {
  const found = new RegExp(`\\n\\s*${name}:\\s*([^;]+);`).exec(styles);
  assert.ok(found, `styles.css declares no ${name}; the tip has no token to resolve`);
  return found[1].trim();
}

const metrics = { gap: 12, margin: 4 };

test('clampAxis keeps a box inside its frame, and the near edge wins', () => {
  // Comfortably inside: nothing to do.
  assert.equal(clampAxis(100, 50, 400, 4), 100);
  // Past the far edge: pulled back to sit exactly on the margin.
  assert.equal(clampAxis(390, 50, 400, 4), 346);
  // Past the near edge: pushed to the margin.
  assert.equal(clampAxis(-20, 50, 400, 4), 4);
  // A box WIDER than the space it has. The two clamps disagree here, and the
  // near-edge one has to win: pinned to the start edge it is squeezed, and
  // pushed off the opposite one it is invisible.
  assert.equal(clampAxis(10, 500, 400, 4), 4);
  assert.equal(clampAxis(-100, 500, 400, 4), 4);
});

test('a followed detail sits beside the cursor and flips before it leaves the viewport', () => {
  const size = { width: 100, height: 60 };
  const frame = { width: 800, height: 600 };
  // The ordinary case: one gap down and to the end side of the cursor. This
  // is the number the owner's complaint was about — the box is 12px from the
  // pointer, not a row away from it.
  assert.deepEqual(pointerPlacement({ x: 300, y: 200 }, size, frame, metrics), { x: 312, y: 212 });
  // Near the end edge it flips to the other side of the cursor rather than
  // being clamped ONTO it: a clamped box would cover the tile being pointed
  // at, which is the failure mode a flip exists to prevent.
  const flipped = pointerPlacement({ x: 780, y: 200 }, size, frame, metrics);
  assert.equal(flipped.x, 780 - 12 - 100);
  assert.equal(flipped.y, 212);
  // The same rule on the block axis, and both at once in a corner.
  assert.deepEqual(pointerPlacement({ x: 300, y: 580 }, size, frame, metrics), {
    x: 312,
    y: 580 - 12 - 60,
  });
  assert.deepEqual(pointerPlacement({ x: 795, y: 595 }, size, frame, metrics), {
    x: 795 - 12 - 100,
    y: 595 - 12 - 60,
  });
  // On the narrowest viewport this site supports, a flip is often enough on
  // its own: a 300px box beside a cursor 2px from the end edge lands at 6px
  // and needs no clamping at all.
  const phone = pointerPlacement({ x: 318, y: 300 }, { width: 300, height: 60 }, { width: 320, height: 640 }, metrics);
  assert.deepEqual(phone, { x: 6, y: 312 });
  // But a wider box on the same screen flips PAST the start edge, and the
  // clamp is what catches it. Neither mechanism is sufficient alone, which is
  // why both run on every placement.
  const squeezed = pointerPlacement({ x: 310, y: 300 }, { width: 314, height: 60 }, { width: 320, height: 640 }, metrics);
  assert.equal(squeezed.x, 4);
  // And a box wider than the whole viewport still starts at the margin
  // rather than off the start edge.
  const overflowing = pointerPlacement({ x: 10, y: 10 }, { width: 900, height: 60 }, { width: 320, height: 640 }, metrics);
  assert.equal(overflowing.x, 4);
});

test('an anchored detail centres over its tile and flips below it near the top', () => {
  const size = { width: 100, height: 60 };
  const frame = { width: 800, height: 600 };
  const cell = { left: 300, top: 200, right: 380, bottom: 234 };
  // Above the tile, centred on it: the reading a finger or a keyboard gets,
  // where there is no cursor to anchor to.
  assert.deepEqual(anchoredPlacement(cell, size, frame, metrics), { x: 290, y: 128 });
  // A tile near the top of the viewport has no room above it, so the box
  // goes below instead of being clamped over the tile it describes.
  const high = { left: 300, top: 20, right: 380, bottom: 54 };
  assert.deepEqual(anchoredPlacement(high, size, frame, metrics), { x: 290, y: 66 });
  // A tile in the last column of a 320px card: centring would hang the box
  // past the end edge, and the clamp is what stops it — the job the retired
  // per-column anchoring used to do, now done at every edge.
  const edge = { left: 240, top: 300, right: 316, bottom: 334 };
  const clamped = anchoredPlacement(edge, size, { width: 320, height: 640 }, metrics);
  assert.equal(clamped.x, 320 - 4 - 100);
  assert.ok(clamped.x >= 4);
});

test('pixelLength reads the tokens the placement runs on, and refuses everything else', () => {
  assert.equal(pixelLength('12px'), 12);
  assert.equal(pixelLength(' 4px '), 4);
  assert.equal(pixelLength('0.5px'), 0.5);
  // Anything this parser cannot resolve to pixels returns null, and the
  // caller falls back to the pinned constant rather than placing a box at
  // NaN — which is a tip in the top-left corner of the screen, silently.
  for (const value of ['1rem', '2em', '', 'auto', '12', '12 px', 'calc(1px + 2px)']) {
    assert.equal(pixelLength(value), null, `"${value}" must not read as a pixel length`);
  }
});

/* A parity pin in the repository's documented shape: one fact, two files,
 * each failure naming the other. The tokens are what the browser actually
 * places by; the constants are the fallback for a document whose stylesheet
 * has not resolved, and a fallback that disagrees with the token is a tip
 * that jumps the first time the CSS is slow. */
test('the placement tokens and their code fallback are the same two numbers', () => {
  assert.equal(
    token('--tip-pointer-gap'),
    `${tipMetricsFallback.gap}px`,
    'styles.css --tip-pointer-gap and tipMetricsFallback.gap in src/lib/tooltip.ts disagree'
  );
  assert.equal(
    token('--tip-edge-margin'),
    `${tipMetricsFallback.margin}px`,
    'styles.css --tip-edge-margin and tipMetricsFallback.margin in src/lib/tooltip.ts disagree'
  );
});

test('both grids build the same detail shape from the same nullable renderers', () => {
  // A boss with every figure, including the optional score.
  assert.deepEqual(bossDetail({ name: 'Zulrah', kc: 1234, rank: 5678, score: 90 }), {
    name: 'Zulrah',
    rows: [
      { label: 'KC', value: '1,234' },
      { label: 'Rank', value: '5,678' },
      { label: 'Score', value: '90' },
    ],
  });
  // An unranked row with no figure at all says both in words rather than
  // rendering a zero, exactly as the tile and the accessible name do.
  assert.deepEqual(bossDetail({ name: 'Sol Heredit', kc: null, rank: null }), {
    name: 'Sol Heredit',
    rows: [
      { label: 'KC', value: '--' },
      { label: 'Rank', value: 'Unranked' },
    ],
  });
  // A skill: the same three-part grammar — a name, then labelled figures —
  // which is the whole of what "the skill detail looks like the boss detail"
  // means once one component renders both.
  assert.deepEqual(skillDetail({ name: 'Attack', level: 99, rank: 124252, xp: 19794965 }), {
    name: 'Attack',
    rows: [
      { label: 'Level', value: '99' },
      { label: 'Rank', value: '124,252' },
      { label: 'XP', value: '19,794,965' },
    ],
  });
  // xp is optional on the payload rather than nullable, so a row the
  // hiscores never sent gets no line — never a fabricated zero.
  assert.deepEqual(skillDetail({ name: 'Sailing', level: 72, rank: null }), {
    name: 'Sailing',
    rows: [
      { label: 'Level', value: '72' },
      { label: 'Rank', value: 'Unranked' },
    ],
  });
  // A null xp is a REPORTED absence and still renders its row, as a dash.
  assert.deepEqual(skillDetail({ name: 'Hunter', level: null, rank: null, xp: null }).rows, [
    { label: 'Level', value: '--' },
    { label: 'Rank', value: 'Unranked' },
  ]);
  // The totals cells: the short label the 320px column shows becomes the row
  // label, and the full name becomes the heading the tile had no room for.
  const [totalXp, overallRank] = skillSummary([
    { name: 'Overall', level: 2277, rank: 138220, xp: 453846899 },
  ]);
  assert.deepEqual(summaryDetail(totalXp), {
    name: 'Total XP',
    rows: [{ label: 'XP', value: '453,846,899' }],
  });
  assert.deepEqual(summaryDetail(overallRank), {
    name: 'Overall rank',
    rows: [{ label: 'Rank', value: '138,220' }],
  });
});

/* The tiles are data now (issue 165): the adapter builds every cell's detail
 * with the builders above, and the generic tracker renders whatever detail
 * its cell carries. EXECUTED rather than pattern-matched, because this is the
 * link the source pins on the component can no longer see — a component that
 * renders {cell.detail} faithfully proves nothing about WHICH detail the
 * adapter put there. */
test('the adapter feeds every tile the same tested detail builders', () => {
  const icons = { levels: new Map(), tallies: new Map() };
  const envelope = {
    schema: 'panel/v1',
    id: 'boss-log',
    kind: 'boss-log/v1',
    title: 'Fixture Stats',
    status: 'ok',
    data: {
      account: 'fixture',
      skills: [
        { name: 'Overall', level: 2277, rank: 138220, xp: 453846899 },
        { name: 'Attack', level: 99, rank: 124252, xp: 19794965 },
      ],
      bosses: [{ name: 'Zulrah', kc: 1234, rank: 5678, score: 90 }],
    },
  };
  const [levels, tallies] = osrsStatsProps(envelope, icons).grids;
  assert.deepEqual(levels.cells[1].detail, skillDetail(envelope.data.skills[1]));
  assert.deepEqual(tallies.cells[0].detail, bossDetail(envelope.data.bosses[0]));
  const summary = skillSummary(envelope.data.skills);
  assert.deepEqual(levels.closing.map((cell) => cell.detail), summary.map(summaryDetail));
});

/* Tooltip content is PAYLOAD: boss and skill names arrive over the network
 * from the origin's hiscore snapshot. The primitive must therefore render
 * them as text and never as markup, and this is the pin that says so in both
 * directions — the data survives verbatim through the builders, and the
 * component has no markup-rendering construct anywhere in the tree for it to
 * land in. Svelte's {expression} is a text node, so inertness here is
 * structural rather than a matter of escaping something correctly. */
test('a hostile row name is data all the way to the DOM', () => {
  const hostile = '<img src=x onerror="fetch(`/steal`)">';
  const detail = bossDetail({ name: hostile, kc: 1, rank: 2 });
  assert.equal(detail.name, hostile, 'the builder must not mangle a name, only carry it');
  assert.equal(skillDetail({ name: hostile, level: 1, rank: 2 }).name, hostile);
  // A value can be hostile too, in principle: the same rule covers both.
  assert.equal(summaryDetail({ key: 'k', label: '</span><script>', name: hostile, value: hostile }).rows[0].value, hostile);
  // The component interpolates every field, and nothing in the tree renders
  // a string as markup. {@html} is the ONLY Svelte construct that could,
  // which is why its absence is the whole assertion.
  assert.match(tipComponent, /\{detail\.name\}/, 'the name must be interpolated as text');
  // A labelled row still interpolates its label as text (issue 178 added the
  // label-less branch for a value-only row; both branches stay expressions,
  // never markup).
  assert.match(
    tipComponent,
    /\{row\.label \? `\$\{row\.label\}: ` : ''\}/,
    'a labelled row must interpolate its label as text'
  );
  assert.match(tipComponent, /\{row\.value\}/, 'rows must be interpolated as text');
  for (const [name, source] of Object.entries(componentSources)) {
    assert.doesNotMatch(
      source,
      /\{@html/,
      `${name} renders a string as markup; payload text reaches the tooltip layer and must never be able to`
    );
  }
});

/* ===========================================================================
 * One primitive, not two. These are the pins that make the owner's "align
 * them" a property of the tree rather than a state somebody restores by hand
 * after the next change.
 * ======================================================================== */

test('exactly one component in the tree implements a hover detail', () => {
  const implementing = Object.entries(componentSources).filter(([, source]) =>
    /role="tooltip"/.test(source)
  );
  assert.deepEqual(
    implementing.map(([name]) => name),
    ['lib/components/DetailTip.svelte'],
    'a second component declares a tooltip; the page has one detail primitive and every caller renders it'
  );
  // Same claim from the other side: the behaviour lives in one module, and
  // one component imports it.
  const wiring = Object.entries(componentSources).filter(([, source]) =>
    /hoverDetail/.test(source)
  );
  assert.deepEqual(
    wiring.map(([name]) => name),
    ['lib/components/DetailTip.svelte'],
    'a component wires the hover behaviour itself instead of rendering the primitive'
  );
  // And the tip's own chrome is declared once: no other component may style
  // a .cell-tip, which is how a "small tweak" becomes a second look.
  for (const [name, source] of Object.entries(componentSources)) {
    if (name === 'lib/components/DetailTip.svelte') continue;
    assert.doesNotMatch(
      styleBlock(source),
      /\.cell-tip/,
      `${name} styles the shared detail; per-instance tweaks are token overrides, never a second rule`
    );
  }
});

test('every tile in the stat tracker carries the shared detail and no browser tooltip', () => {
  const tiles = [...statTracker.matchAll(/<li\b[\s\S]*?<\/li>/g)].map(([tile]) => tile);
  // Two tile TEMPLATES render every tile of both grids now: a stat cell and
  // the captioned closing cell. The walk used to find three, because each
  // grid spelled its own; the merge is the strengthening — a detail added or
  // dropped on one template moves every grid at once, so a grid can no
  // longer drift away from the rule. Fewer than two means this walk stopped
  // seeing one of them.
  assert.equal(tiles.length, 2, `the stat tracker renders ${tiles.length} kinds of tile, not 2`);
  for (const tile of tiles) {
    assert.match(
      tile,
      /<DetailTip detail=\{cell\.detail\} \/>/,
      `a tile renders no shared detail: ${tile.slice(0, 80)}…`
    );
    // The browser's own tooltip is what the skills used to have. Beside a
    // real detail it double-tooltips — two boxes, one of them unstyled and
    // half a second late — so its absence is pinned, not merely intended.
    assert.doesNotMatch(
      tile,
      /\stitle=/,
      `a tile still carries a title attribute, which double-tooltips beside the real detail: ${tile.slice(0, 80)}…`
    );
    // Both grids' tiles are keyboard-reachable, because the detail is.
    assert.match(tile, /tabindex="0"/, 'a tile with a detail no keyboard can reach is half the feature');
    assert.match(tile, /aria-label=\{cell\.label\}/, 'a tile must carry its whole row in its accessible name');
  }
  // The old implementation is GONE from this component rather than
  // overridden: no markup, no styling, no reveal rule, no per-column anchor.
  assert.doesNotMatch(statTracker, /boss-tip|stat-tip/, 'the retired per-cell tooltip is back in the stat grids');
  assert.doesNotMatch(
    statTracker,
    /nth-child\(3n/,
    'the retired per-column anchoring is back in the stat grids; containment is viewport clamping now'
  );
  assert.match(statTracker, /import DetailTip from '\.\/DetailTip\.svelte'/);
});

test('the detail follows a fine pointer and is anchored for everyone else', () => {
  // The split is a CAPABILITY question. A user-agent string is not a
  // capability, and a page that asks one is a page that is wrong about every
  // device it has not heard of.
  assert.equal(finePointerQuery, '(hover: hover) and (pointer: fine)');
  assert.match(tooltipSource, /matchMedia\(finePointerQuery\)/);
  assert.doesNotMatch(
    tooltipSource,
    /userAgent|navigator\.platform|maxTouchPoints/,
    'the primitive sniffs the user agent; the split is a media query and the event’s own pointerType'
  );
  /* The guard is pinned in the handler that DECIDES, not merely somewhere in
     the file: `pointerType === 'touch'` appears in three handlers, so a
     file-wide match is satisfied by the two that are not the one under test —
     and removing it from the enter handler is exactly the regression that
     makes a finger on a hybrid laptop open a box that then follows a cursor
     it does not have. No lane can emulate a device that reports a fine
     pointer AND a touchscreen, which is why the pin has to be exact here. */
  const enter = /function onEnter\([\s\S]*?\n  \}/.exec(tooltipSource);
  assert.ok(enter, 'the pointer-enter handler is not where this pin expects it');
  assert.match(
    enter[0],
    /if \(event\.pointerType === 'touch'\) \{\s*return;/,
    'a finger on a hybrid device must take the anchored branch whatever the media query says'
  );
  // The throttle, and the guard that makes it one placement per FRAME rather
  // than one requestAnimationFrame per event.
  assert.match(tooltipSource, /requestAnimationFrame/);
  assert.match(
    tooltipSource,
    /if \(frame !== 0\) \{\s*return;\s*\}\s*frame = view\.requestAnimationFrame/,
    'the move handler schedules a frame per event instead of coalescing into one'
  );
  // The move path reads no layout: everything it needs was measured when the
  // tip opened. A getBoundingClientRect in the frame callback is a forced
  // reflow on every frame of every hover.
  const mover = /function onMove\([\s\S]*?\n  \}/.exec(tooltipSource);
  assert.ok(mover, 'the move handler is not where this pin expects it');
  assert.doesNotMatch(
    mover[0],
    /getBoundingClientRect|getComputedStyle|clientWidth|clientHeight/,
    'the follow path reads layout every frame; the tip’s box and the viewport are measured once when it opens'
  );
});

test('a caller that resolves many subjects must also say which one a focus landed on', () => {
  /* The contract behind the driven path, executed rather than described.
     Without a refusal this is a comment, and the failure it prevents is a
     SILENT one: a region caller that supplies `resolve` and forgets `anchor`
     type-checks, renders, and quietly falls back to the focus guess — the
     element at the viewport origin, which for a scrolled strip is a cell off
     the left edge of its own scrollport rather than the one the reader is on.
     Nothing goes red; the readout simply describes the wrong cell.

     The pin is on the binding's SHAPE, not on who happens to call it today.
     There is no list of callers here to fall out of date, and a region
     component written next year is covered by having been written. */
  const subject = {};
  const resolve = () => null;
  const report = () => {};

  // The tile shape: one subject, so the guess this module makes is the only
  // answer there is. Not driven, and never refused.
  assert.equal(drivenBinding({ report }), false);
  assert.equal(drivenBinding({ report, host: subject }), false);

  // The region shape, both halves of it. `null` is a driving caller saying
  // "nothing is selected" — it is a SELECTION state, not an absence of the
  // contract, so it drives exactly as an element does.
  assert.equal(drivenBinding({ report, resolve, anchor: null }), true);
  assert.equal(drivenBinding({ report, resolve, anchor: subject }), true);

  // And the shape that must not be representable. Omitted and explicitly
  // `undefined` are the same value and are refused identically, which is what
  // makes "pass null, never undefined" enforceable rather than advisory.
  assert.throws(() => drivenBinding({ report, resolve }), TypeError);
  assert.throws(() => drivenBinding({ report, resolve, anchor: undefined }), TypeError);

  // The refusal has to sit ON the production path, not beside it: a binder
  // that kept its own inline comparison would leave every assertion above
  // true and the defect intact.
  assert.match(
    tooltipSource,
    /const driven = drivenBinding\(binding\)/,
    'the binder decides `driven` without going through the refusal'
  );
});

test('the detail is fixed, clamped, and can never take the pointer that opened it', () => {
  const block = styleBlock(tipComponent);
  // Fixed positioning is what makes the containment structural: a fixed box
  // is outside the document's scrollable overflow, so no position it takes
  // can make the page scroll sideways — the floor the retired per-column
  // anchoring existed to protect, now held at every edge.
  assert.match(block, /\.cell-tip\s*\{[^}]*position:\s*fixed/);
  assert.match(block, /\.cell-tip\s*\{[^}]*left:\s*var\(--tip-x\)/);
  assert.match(block, /\.cell-tip\s*\{[^}]*top:\s*var\(--tip-y\)/);
  // A box that follows the cursor is the one element that must never be able
  // to receive it: hovering it would take the pointer off the tile that
  // opened it, close the tip, and hand the pointer back — a flicker loop.
  assert.match(block, /\.cell-tip\s*\{[^}]*pointer-events:\s*none/);
  // Bounded by the viewport, claiming no minimum, exactly as the box it
  // replaced was — a minimum inside a 90px cell is what cut the leading
  // digits off every row the last time this went wrong.
  assert.match(block, /max-inline-size:\s*var\(--tip-max-inline-size\)/);
  assert.doesNotMatch(block, /min-inline-size/);
  assert.match(token('--tip-max-inline-size'), /^min\(/, 'the tip’s width must be bounded by the viewport');
  // Nothing animates, so nothing has to be switched off for a reader who
  // asked for less motion — and the reveal costs no frame of easing, which
  // is the responsiveness the owner asked to keep.
  assert.doesNotMatch(block, /transition|animation/);
});

test('every dimension the detail has resolves from a token', () => {
  const block = styleBlock(tipComponent);
  const declarations = [
    ...block.matchAll(/(?:^|;|\{)\s*(-{0,2}[a-z][a-z0-9-]*)\s*:\s*([^;}]+)/gi),
  ].map(([, property, value]) => ({ property, value: value.trim() }));
  assert.ok(declarations.length > 10, 'the declaration walk found almost nothing; it is broken');
  for (const { property, value } of declarations) {
    // A length or a color stated here is a value that cannot be tuned from
    // the token layer, which is the drift issue #136 rule 5 forbids. Keywords
    // and unitless numbers (opacity, z-index through its token) are shapes,
    // not styling, and stay readable in place.
    assert.doesNotMatch(
      value,
      /(?<![\w-])\d+(?:\.\d+)?(?:px|rem|em|ch|vw|vh|svh|dvh|%)/,
      `.cell-tip sets ${property} to the raw length "${value}"; add a token instead (issue #136 rule 5)`
    );
    assert.doesNotMatch(
      value,
      /#[0-9a-f]{3,8}\b|\brgb\(|\bhsl\(|\boklch\(/i,
      `.cell-tip sets ${property} to the literal color "${value}"; colors resolve through the reading-mode tokens`
    );
  }
  // And the tokens themselves exist, each with a global default, so a
  // per-instance tweak is an override rather than an edit here.
  for (const name of [
    '--tip-surface',
    '--tip-ink',
    '--tip-title-ink',
    '--tip-title-weight',
    '--tip-border-color',
    '--tip-border-width',
    '--tip-border-style',
    '--tip-radius',
    '--tip-padding',
    '--tip-gap',
    '--tip-size',
    '--tip-leading',
    '--tip-max-inline-size',
    '--tip-pointer-gap',
    '--tip-edge-margin',
    '--tip-layer',
    '--tip-x',
    '--tip-y',
  ]) {
    assert.ok(token(name).length > 0, `${name} has no global default`);
  }
  // The look is the panel layer's, derived rather than restated: the owner
  // called the boss detail's presentation the reference, so the surface, the
  // rule, the ink and the orange heading all still come from --panel-*.
  assert.equal(token('--tip-surface'), 'var(--panel-tip-surface)');
  assert.equal(token('--tip-ink'), 'var(--panel-text)');
  assert.equal(token('--tip-title-ink'), 'var(--panel-accent)');
  assert.equal(token('--tip-border-color'), 'var(--panel-border)');
});
