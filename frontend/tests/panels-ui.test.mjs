import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { bossInitials, bossSlug, skillSlug } from '../src/lib/bossIcons.ts';
import {
  cellLabel,
  noTally,
  panelSummary,
  rankLabel,
  skillLabel,
  tally,
  unrankedLabel,
} from '../src/lib/bossLog.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

// The container image builds the frontend from a stage that holds ONLY the
// frontend tree (Dockerfile: COPY frontend/ ./), so repo-level files do not
// exist there. The two cross-tree pins below are therefore capability-gated
// exactly like the provider-neutrality pin: in a full checkout — the PR
// gate's application job, every local run — they are mandatory and a missing
// file fails loudly; in the reduced build context they skip by name. The
// gate condition probes the tree, never the files under pin, so deleting a
// pinned file can never turn into a silent skip.
const fullCheckout = existsSync(new URL('../../internal/panels', import.meta.url));
const reducedContextNote = fullCheckout
  ? false
  : 'reduced build context ships only frontend/; the full-checkout gate enforces this pin';

const [
  app,
  shell,
  refreshAll,
  pageHeaderSource,
  fallbackShell,
  bossLog,
  panelsSource,
  iconsSource,
  viteConfig,
  grid,
  gridSource,
  activityBar,
  tokenUsage,
  styles,
  themeMenu,
] = await Promise.all([
  read('../src/App.svelte'),
  read('../src/lib/components/PanelShell.svelte'),
  read('../src/lib/components/RefreshAll.svelte'),
  read('../src/lib/components/PageHeader.svelte'),
  read('../index.html'),
  read('../src/lib/components/BossLog.svelte'),
  read('../src/lib/panels.ts'),
  read('../src/lib/bossIcons.ts'),
  read('../vite.config.ts'),
  read('../src/lib/components/ContributionGrid.svelte'),
  read('../src/lib/grid.ts'),
  read('../src/lib/components/ActivityBar.svelte'),
  read('../src/lib/components/TokenUsagePanel.svelte'),
  read('../src/styles.css'),
  read('../src/lib/ThemeMenu.svelte'),
]);

// Like the experience suite, these are structural regex pins over source:
// they hold the shapes the owner specified — chrome values, grid density,
// fail-soft rendering — while leaving copy and styling free to evolve.
test('panel mount region keeps its fences and mounts exactly one panel line', () => {
  for (const marker of [
    'panels:imports:begin',
    'panels:imports:end',
    'panels:mount:begin',
    'panels:mount:end',
  ]) {
    assert.match(app, new RegExp(marker), `App.svelte lost the ${marker} fence`);
  }
  const mounted = app
    .split(/<!-- panels:mount:begin[^>]*-->/)[1]
    .split(/<!-- panels:mount:end -->/)[0]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  assert.deepEqual(
    mounted,
    ['<BossLog />', '<ActivityBar />', '<TokenUsagePanel />'],
    'the mount fence must hold exactly one line per panel'
  );
});

// The side rail is GONE (owner directive): the OSRS panel was a collapsible
// fixed rail on the inline end, and the reading-mode control was fixed chrome
// whose offset included that rail's gutter — so the control slid sideways
// every time the rail opened. Both are now ordinary blocks in one centered
// column, which is what removes the drift at its cause rather than picking a
// different fixed position for the control to be wrong in.
test('the panels are one centered column, not a rail', () => {
  assert.ok(
    !existsSync(new URL('../src/lib/components/SideRail.svelte', import.meta.url)),
    'the side rail component must not come back'
  );
  // Nothing anywhere still reaches for the rail's geometry or its published
  // open-state attribute; a leftover reference is a gutter nobody reserves.
  for (const [name, source] of Object.entries({ app, styles, themeMenu, activityBar, bossLog })) {
    assert.doesNotMatch(source, /data-rail-open|--page-rail-gutter|--panel-rail-|SideRail/, `${name} still references the retired rail`);
  }
  // The stack owns the column width and the gap; panels own neither, so a
  // panel added later cannot pick a width that disagrees with its siblings.
  assert.match(app, /<div class="panel-stack">/);
  assert.match(styles, /\.panel-stack\s*\{[^}]*display:\s*grid/);
  assert.match(styles, /\.panel-stack\s*\{[^}]*gap:\s*var\(--page-stack-gap\)/);
  assert.match(styles, /#app > \.page-header,\s*\n#app > main\s*\{[^}]*inline-size:\s*min\(var\(--page-column-width\), 100%\)/);
});

test('panel shell surfaces status and generatedAt age over themable tokens', () => {
  assert.match(shell, /data-panel-status=\{status\}/);
  assert.match(shell, /panelAge/);
  assert.match(shell, /var\(--panel-surface,\s*rgb\(40,\s*40,\s*40\)\)/);
  assert.match(shell, /var\(--panel-border,\s*rgb\(23,\s*23,\s*23\)\)/);
  for (const status of ['ok', 'stale', 'unavailable']) {
    assert.match(shell, new RegExp(`--panel-status-${status}`), `badge lost its ${status} token`);
  }
});

// The freshness READING is per-card and stayed; the freshness ACTION is not
// per-card and left. Every panel used to carry its own refresh button beside
// its title, which made refreshing look like a per-tracker decision when it is
// one gesture. This pins both halves: no card grows a control back, and not a
// word of the honesty left with it.
test('each card keeps its own freshness reading and none keeps a control', () => {
  // The sentence is still built from the same status and age as before.
  assert.match(shell, /const freshness = \$derived\(age \? `\$\{status\}, updated \$\{age\}` : status\)/);
  // It reaches a pointer user and a screen-reader user through the badge.
  assert.match(shell, /<p class="panel-badge" data-panel-status=\{status\} title=\{freshness\}>/);
  assert.match(shell, /<span class="panel-badge-age">\{freshness\}<\/span>/);
  // Status is never color alone: the dot's SHAPE differs per state.
  assert.match(shell, /\.panel-badge-dot\s*\{[^}]*inline-size:\s*0\.5em/, 'the dot lost its size');
  assert.match(shell, /\.panel-badge-dot\[data-panel-status='ok'\]\s*\{[^}]*border-radius:\s*50%/);
  assert.match(shell, /\.panel-badge-dot\[data-panel-status='stale'\]\s*\{[^}]*background:\s*none/);
  // No per-card control, and no panel hands one up any more.
  assert.doesNotMatch(shell, /panel-refresh|<button/, 'a card grew its own refresh control back');
  // Two spellings, because a bespoke refresher does not have to be CALLED
  // "refresh" to be one. The delta review showed a panel could reintroduce
  // the control under any name so long as it reached a watcher's refresh(),
  // so the call itself is pinned rather than one identifier.
  //
  // A blanket ban on <button> inside a panel was tried here and is wrong:
  // TokenUsagePanel legitimately owns a daily/weekly/cumulative radiogroup,
  // which is a view control, not a refresher.
  //
  // What this comment used to say next — "reaching a watcher is what makes a
  // control a refresher, whatever it is named" — is FALSE and was retracted.
  // A card needs no watcher handle at all: refreshPanels() is module-level.
  // The refreshPanels assertion below exists precisely because that sentence
  // was wrong, so the sentence is not left standing above it.
  // PanelShell is swept with the cards, not instead of them: it is the ONE
  // component that renders for all three, so a control added there appears
  // on every card at once — the widest version of the regression these
  // assertions exist to stop, and the one the per-card loop used to miss.
  for (const [name, source] of Object.entries({ bossLog, activityBar, tokenUsage, panelShell: shell })) {
    assert.doesNotMatch(
      source,
      /\{\s*refresh\s*\}|(?:const|let|var)\s+refresh\s*=/,
      `${name} still hands a refresher to its shell`
    );
    assert.doesNotMatch(source, /\.refresh\(\)/, `${name} drives a watcher refresh of its own`);
    // The module-level refresher is the third door, and the one the delta
    // review actually walked through: a card that imports refreshPanels()
    // needs no watcher handle at all, so pinning "reaches a watcher" missed
    // it completely. Zero panel component references it today, and the
    // refresh control belongs to the page header for all of them at once.
    assert.doesNotMatch(
      source,
      /refreshPanels/,
      `${name} reaches the all-panels refresher; one control refreshes every tracker, and it lives in the page header`
    );
  }
});

// One control for the whole stack, attached to the trackers it acts on —
// never in the page header, which is for controls that act on the document.
test('one refresh serves every tracker, and it belongs to the stack', () => {
  assert.match(app, /<RefreshAll \/>/);
  // It sits inside the stack, above the mount fence, so it is visually part
  // of the cards rather than part of the page chrome.
  assert.match(app, /<div class="panel-stack">[\s\S]*<RefreshAll \/>[\s\S]*panels:mount:begin/);
  assert.doesNotMatch(
    pageHeaderSource,
    /import RefreshAll|refreshPanels\(/,
    'the refresh must not sit in the page header'
  );
  assert.match(refreshAll, /aria-label="Refresh all trackers"/);
  assert.match(refreshAll, /refreshPanels\(\)/);
  // One source pin survives here, and deliberately: a watcher LEAVING the
  // live set is unobservable through the public API, because stop() also sets
  // the stopped flag and read() short-circuits on it — so a watcher that
  // stayed in the set would behave identically while the set grew without
  // bound. The delta review caught exactly this: deleting the delete was red
  // before and green after, a real net loss. Behavior proves the rest; only
  // the leak needs the pin.
  assert.match(
    panelsSource,
    /liveWatchers\.delete\(watcher\)/,
    'a stopped watcher must leave the live set, or the set grows without bound'
  );
  // What refreshPanels actually DOES is proven behaviorally in
  // panel-refresh.test.mjs — that it reads every mounted panel, that a
  // stopped panel leaves the set, that an empty page is a no-op, and that a
  // second press joins the read in flight. Source pins were tried here first
  // and were wrong for the job: every one of them matches an empty function
  // body, which is exactly the regression that would matter, because the
  // button would still render, still go busy, and still settle while
  // refreshing nothing.
  // In flight it is disabled, announces itself busy, and releases in a
  // finally so a failed read cannot latch it off forever.
  assert.match(refreshAll, /aria-busy=\{busy\}/);
  assert.match(refreshAll, /disabled=\{busy\}/);
  assert.match(refreshAll, /\} finally \{[\s\S]*?busy = false;/);
  assert.match(refreshAll, /@media \(prefers-reduced-motion: reduce\)/);
  // 44px minimum touch target, from the one shared icon-control rule. BOTH
  // axes are pinned: a rule that bounded only the width would let the shared
  // control shrink to an unhittable strip and take every icon button on the
  // page with it.
  assert.match(refreshAll, /class="icon-button"/);
  assert.match(styles, /\.icon-button\s*\{[^}]*inline-size:\s*2\.75rem/);
  assert.match(styles, /\.icon-button\s*\{[^}]*block-size:\s*2\.75rem/);
});

// Five collisions were confirmed on real viewports before the previous fix
// (issue #78) and were arbitrated by a four-level layer scale plus two
// reserved gutters. Every one of them existed because chrome FLOATED over the
// document: the bar over the token panel, the open rail over the token panel,
// the reading-mode control buried under the rail, the rail and bar tied at one
// layer, and 100vh floors. Removing the fixed positioning removes the whole
// class — so the pin is now the absence of fixed chrome, which is a stronger
// guarantee than any arbitration between overlapping things.
test('no page chrome floats over the document', () => {
  // styles.css is in this sweep deliberately and is the load-bearing entry:
  // the page header's own rule lives THERE, not in a component, so a scan of
  // components alone would let the exact drift this PR is named for return
  // with the suite green.
  for (const [name, source] of Object.entries({
    refreshAll,
    pageHeaderSource,
    themeMenu,
    activityBar,
    bossLog,
    tokenUsage,
    shell,
    styles
  })) {
    assert.doesNotMatch(
      source,
      /position:\s*fixed/,
      `${name} floats over the page again; fixed chrome is what made the controls drift`
    );
  }
  // With nothing floating there is nothing to reserve space for, so the
  // gutter tokens that existed only to hold space open must stay gone.
  assert.doesNotMatch(styles, /--page-activity-gutter|--panel-activity-reserve/);
  // The page pads itself by the safe-area insets ONCE, for everything inside
  // it — each fixed element used to have to do this for itself.
  for (const side of ['top', 'bottom', 'left', 'right']) {
    assert.match(
      styles,
      new RegExp(`env\\(safe-area-inset-${side}\\)`),
      `the page does not clear the ${side} inset`
    );
  }
  // The layer scale survives for the one real overlap left — the popover over
  // the stack — and is still an ORDERED list of names, never a bare number.
  const layers = ['base', 'menu'].map((name) => {
    const found = styles.match(new RegExp(`--layer-${name}:\\s*(\\d+);`));
    assert.ok(found, `the stacking scale lost --layer-${name}`);
    return Number(found[1]);
  });
  assert.ok(layers[1] > layers[0], `the stacking scale is not ordered: ${layers.join(' < ')}`);
  assert.match(themeMenu, /z-index:\s*var\(--layer-menu,/);
  for (const [name, source] of Object.entries({ refreshAll, pageHeaderSource, themeMenu, activityBar })) {
    assert.doesNotMatch(
      source,
      /z-index:\s*\d/,
      `${name} sets a raw z-index; the stacking order is the token scale, not a race`
    );
  }
});

// The reading-mode control sits alone in the top-end corner. It acts on the
// document, so it is the only thing in the page header — pairing it with the
// refresh implied the two had the same scope, and they do not.
test('the reading mode is the page header, alone and in flow', () => {
  assert.match(app, /<PageHeader \/>/);
  assert.match(pageHeaderSource, /<ThemeMenu \/>/);
  assert.doesNotMatch(pageHeaderSource, /<button/, 'the header carries the reading mode and nothing else');
  assert.match(themeMenu, /class="icon-button trigger"/);
  assert.match(styles, /\.page-header\s*\{[^}]*justify-content:\s*flex-end/);
  // The static shell reserves the row, so the control arriving at hydration
  // fills held-open space instead of pushing the page down.
  assert.match(styles, /\.page-header\s*\{[^}]*min-block-size:\s*var\(--page-header-height\)/);
  assert.match(fallbackShell, /<header class="page-header"><\/header>/);
});

test('boss log renders the dense fixed-cell grid with tooltips and -- tallies', () => {
  assert.match(bossLog, /grid-template-columns:\s*repeat\(3,/, 'the grid must stay three columns');
  assert.match(bossLog, /block-size:\s*2\.125rem/, 'cells must keep a fixed height (no CLS)');
  assert.match(bossLog, /width="26"\s+height="26"/, 'icons must declare their box (no CLS)');
  assert.match(bossLog, /loading="lazy"/, 'icons must lazy-load');
  assert.match(bossLog, /decoding="async"/);
  assert.match(bossLog, /tally\(boss\.kc\)/, 'tallies must go through the tested renderer');
  assert.match(bossLog, /rankLabel\(boss\.rank\)/, 'ranks must go through the tested renderer');
  // The complete table scrolls inside the panel. Dozens of boss rows would
  // otherwise make this card taller than everything stacked below it put
  // together, so the region is bounded to a fixed height and scrolls itself:
  // the page scrolls through the STACK, never through one panel's contents,
  // and the card's geometry is the same before and after the payload lands.
  assert.match(bossLog, /\.boss-grid\s*\{[^}]*block-size:\s*var\(--boss-grid-height/, 'the boss region must be bounded');
  assert.match(bossLog, /\.boss-grid\s*\{[^}]*overflow-y:\s*auto/, 'and scroll inside itself');
  // The fill variant existed only to claim the retired rail's height; a card
  // in the stack grows to its content, so it must not come back.
  assert.doesNotMatch(shell, /panel-shell-fill/, 'the rail-filling variant must stay retired');
  assert.match(bossLog, /role="tooltip"/);
  assert.match(bossLog, /:hover\s+\.boss-tip/);
  assert.match(bossLog, /:focus-visible\s+\.boss-tip/);
  // The tooltip is what actually cut the leading digits off the table: a
  // minimum width inside a ~90px cell, positioned against a distant
  // ancestor, pushed the grid's scroll width past the card. A viewport-width
  // threshold cannot catch that — the offending value was 9rem, comfortably
  // under the 320px floor — so the MECHANISM is pinned instead. The cell is
  // the containing block, the tip is bounded by the viewport, and it claims
  // no minimum of its own.
  assert.match(
    bossLog,
    /\.boss-cell\s*\{[^}]*position:\s*relative/,
    'the cell must be the tip’s containing block, or the tip anchors to the grid'
  );
  assert.match(
    bossLog,
    /\.boss-tip\s*\{[^}]*max-inline-size:\s*min\(/,
    'the tip must be bounded by the viewport'
  );
  assert.doesNotMatch(
    bossLog,
    /\.boss-tip\s*\{[^}]*min-inline-size/,
    'a tip wider than its cell widens the grid it floats over'
  );
  assert.match(bossLog, /tabindex="0"/, 'cells must be focusable for the tooltip');
  assert.match(bossLog, /aria-label=\{cellLabel\(boss\)\}/);
  // Data flows only through the shared layer and shell; the sole
  // name-shaped logic is the slug lookup with the initials fallback.
  assert.match(bossLog, /watchPanel<BossLogData>\('boss-log'/);
  assert.match(bossLog, /import PanelShell from '\.\/PanelShell\.svelte'/);
  assert.match(bossLog, /bossSlug/);
  assert.match(bossLog, /bossInitials/);
});

// The skills grid is the half of the panel the payload always carried and
// nothing ever rendered: internal/panels parsed the hiscores skill table and
// then dropped it on the floor (issue #78).
test('the skills grid mirrors the hiscore panel and renders levels honestly', () => {
  assert.match(bossLog, /\.skill-grid,\s*\n\s*\.boss-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/);
  assert.match(bossLog, /\.skill-cell\s*\{[^}]*block-size:\s*1\.625rem/, 'skill cells need a fixed height (no CLS)');
  assert.match(bossLog, /width="18"\s+height="18"/, 'skill icons must declare their box (no CLS)');
  assert.match(bossLog, /tally\(skill\.level\)/, 'levels must go through the tested renderer');
  assert.match(bossLog, /aria-label=\{skillLabel\(skill\)\}/);
  assert.match(bossLog, /title=\{skillLabel\(skill\)\}/);
  assert.match(bossLog, /skillSlug/);
  // A payload with no skill table says so; it never renders an empty grid
  // that reads as "this account has no levels".
  assert.match(bossLog, /\{:else\}\s*<p class="boss-note">No skill levels reported\.<\/p>/);
  // The levels are right-aligned digits in tabular figures, like the counts.
  assert.match(bossLog, /\.skill-level,\s*\n\s*\.boss-kc\s*\{[^}]*text-align:\s*right/);
  assert.match(bossLog, /\.skill-level,\s*\n\s*\.boss-kc\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
});

// The icon set is now COMPLETE (issue #78: the owner reviewed and approved
// one batch covering every served row), so the pin runs in BOTH directions
// again and is strictly stronger than either half alone:
//
//   forward  — every row the origin serves has a vendored icon, so the grid
//              never falls back to a letter chip in practice. This direction
//              was deliberately removed when only six of seventy-one bosses
//              had art; restoring it is what makes the batch a contract
//              rather than a one-off.
//   backward — every icon that ships belongs to a row the origin really
//              serves, so third-party art can never outlive the data that
//              justified vendoring it.
//
// The initials fallback stays in the component regardless: a boss shipped
// upstream tomorrow must render as a designed state, not a hole.
test('the icon set covers exactly the rows the origin serves', { skip: reducedContextNote }, async () => {
  const snapshot = await read('../../internal/panels/snapshots/boss-log.json').then(JSON.parse);
  const directories = {
    bosses: { rows: snapshot.data.bosses, slug: bossSlug },
    skills: { rows: snapshot.data.skills, slug: skillSlug },
  };
  for (const [directory, { rows, slug }] of Object.entries(directories)) {
    assert.ok(
      Array.isArray(rows) && rows.length > 0,
      `the origin data names no ${directory}; the pin has nothing to protect`
    );
    const files = await readdir(new URL(`../src/assets/icons/${directory}`, import.meta.url));
    const icons = new Set(files.filter((file) => file.endsWith('.png')).map((file) => file.replace(/\.png$/, '')));
    assert.ok(icons.size > 0, `no ${directory} icons ship; the pin has nothing to protect`);
    const wanted = new Set(rows.map((row) => slug(row.name)));
    for (const want of wanted) {
      assert.ok(icons.has(want), `${directory}/${want}.png is missing for a row the origin serves`);
    }
    for (const icon of icons) {
      assert.ok(
        wanted.has(icon),
        `${directory}/${icon}.png matches no row the origin serves — third-party art must never outlive the data that justifies it`
      );
    }
  }
  // The fallback is still reachable code, and still tested, because upstream
  // ships new content without asking.
  assert.match(bossLog, /bossInitials\(boss\.name\)/);
  assert.match(bossLog, /bossInitials\(skill\.name\)/);
});

test('the boss list is derived from the upstream, never enumerated in config', {
  skip: reducedContextNote,
}, async () => {
  const fetchConfig = await read('../../internal/panels/config/fetch.json').then(JSON.parse);
  assert.equal(
    fetchConfig.bossLog.bosses,
    undefined,
    'an enumerated boss list silently drops every boss added upstream since the last edit'
  );
  assert.ok(
    Array.isArray(fetchConfig.bossLog.excludeActivities) &&
      fetchConfig.bossLog.excludeActivities.length > 0,
    'config must name the NON-bosses, so an unrecognized upstream entry is preserved'
  );
});

test('the origin serves the complete boss table', { skip: reducedContextNote }, async () => {
  const snapshot = await read('../../internal/panels/snapshots/boss-log.json').then(JSON.parse);
  assert.ok(
    snapshot.data.bosses.length >= 50,
    `the snapshot ships ${snapshot.data.bosses.length} bosses; the panel exists to show them all`
  );
});

test('vendored icons stay CSP-servable, never inlined', () => {
  assert.match(
    viteConfig,
    /assetsInlineLimit:\s*0/,
    "CSP default-src 'self' forbids data: URIs — assets must never inline"
  );
});

test(
  'icon sourcing carries the exact fan-content notice and credits',
  { skip: reducedContextNote },
  async () => {
    // The exact Jagex Fan Content Policy notice, word for word, plus the
    // wiki credit and the trademark boundary.
    const attribution = await read('../../ATTRIBUTION.md');
    assert.match(
      attribution,
      /Created using intellectual property belonging to Jagex Limited under the[\s>]+terms of Jagex's Fan Content Policy\. This content is not endorsed by or[\s>]+affiliated with Jagex\./
    );
    assert.match(attribution, /Old School RuneScape Wiki/);
    assert.match(attribution, /no RuneLite artwork,[\s]+sprites, or logo/);
  }
);

test('every mounted panel stays current instead of painting once', () => {
  // The defect this pins: each panel used to read its envelope exactly once,
  // so a backend refresh was invisible until the visitor reloaded the page.
  for (const [name, source] of Object.entries({ bossLog, activityBar, tokenUsage })) {
    assert.match(source, /watchPanel/, `${name} no longer keeps itself current`);
    assert.doesNotMatch(
      source,
      /\bloadPanel\b/,
      `${name} reads its envelope directly again; the one-shot read is the bug`
    );
  }
  // And the freshness badge reads a ticking clock, not the mount instant.
  assert.match(shell, /watchClock/);
  assert.match(shell, /panelAge\(generatedAt, now\)/);
});

test('the contribution grid is one component both panels render', () => {
  assert.match(tokenUsage, /import ContributionGrid from '\.\/ContributionGrid\.svelte'/);
  // Fixed geometry: data arriving must never move the page.
  assert.match(grid, /block-size:\s*7rem/);
  assert.match(grid, /overflow-x:\s*auto/);
  // The full ramp is themable, one custom property per level.
  for (const level of [0, 1, 2, 3, 4]) {
    assert.match(grid, new RegExp(`--grid-cell-${level}`), `the ramp lost level ${level}`);
  }
  // Never color alone, and a day outside the window is a hole, not a zero.
  assert.match(grid, /aria-label=\{text\}/);
  assert.match(grid, /title=\{text\}/);
  assert.match(grid, /data-grid-absent=\{cell\.absent \? 'true' : 'false'\}/);
});

test('panel sources stay local-origin', () => {
  for (const [name, source] of Object.entries({
    shell,
    refreshAll,
    bossLog,
    panelsSource,
    iconsSource,
    grid,
    gridSource,
    activityBar,
    tokenUsage,
  })) {
    assert.doesNotMatch(source, /https?:\/\//, `${name} introduces a remote origin`);
  }
});

test('boss identity helpers bridge data names to asset slugs', () => {
  assert.equal(bossSlug('Chambers of Xeric'), 'chambers-of-xeric');
  assert.equal(bossSlug('TzKal-Zuk'), 'tzkal-zuk');
  assert.equal(bossSlug("Kree'arra"), 'kree-arra');
  assert.equal(bossSlug('The Whisperer'), 'the-whisperer');
  assert.equal(bossInitials('Zulrah'), 'Z');
  assert.equal(bossInitials('The Whisperer'), 'TW');
  assert.equal(bossInitials('Chambers of Xeric'), 'CX');
  assert.equal(bossInitials(''), '?');
  // Skills canonicalize by the identical rule, so one icon directory can
  // never drift into a second naming convention.
  assert.equal(skillSlug('Attack'), 'attack');
  assert.equal(skillSlug('Runecraft'), 'runecraft');
  for (const name of ['Overall', "Kree'arra", 'Chambers of Xeric: Challenge Mode']) {
    assert.equal(skillSlug(name), bossSlug(name), `the two slug rules disagree on ${name}`);
  }
});

// The two renderings that carry real meaning in this panel, EXECUTED rather
// than pattern-matched: a hiscore figure the upstream does not report, and an
// account below the listing threshold. Both are served as null by the origin
// (boss-log/v1 keeps kc and rank nullable precisely so they survive the round
// trip), and both have a rendering the reader is meant to understand.
test('a null tally renders as the no-figure marker, never as a zero', () => {
  assert.equal(noTally, '--');
  assert.equal(tally(null), '--');
  assert.equal(tally(undefined), '--');
  // Zero kills and no reported figure are different claims.
  assert.equal(tally(0), '0');
  assert.equal(tally(1192), '1,192');
});

test('a null rank says unranked in words', () => {
  assert.equal(unrankedLabel, 'Unranked');
  assert.equal(rankLabel(null), 'Unranked');
  assert.equal(rankLabel(undefined), 'Unranked');
  assert.equal(rankLabel(111737), '111,737');
});

test('a tile label carries the whole row, including its nulls', () => {
  // The exact served shape for an unranked boss with no reported figure.
  assert.equal(cellLabel({ name: 'Artio', kc: null, rank: null }), 'Artio: -- KC, rank Unranked');
  // And for a boss ranked and counted.
  assert.equal(cellLabel({ name: 'Zulrah', kc: 1192, rank: 111737 }), 'Zulrah: 1,192 KC, rank 111,737');
  // A score only renders when the row carries one.
  assert.equal(
    cellLabel({ name: 'TzKal-Zuk', kc: 2, rank: 32622, score: 2 }),
    'TzKal-Zuk: 2 KC, rank 32,622, score 2'
  );
  assert.equal(cellLabel({ name: 'Sol Heredit', kc: 2, rank: null, score: null }), 'Sol Heredit: 2 KC, rank Unranked');
});

// A skill cell shows one number in a grid of twenty-five, so its accessible
// label has to carry the whole row — nulls included, since the hiscores
// legitimately report none for a skill below the listing threshold.
test('a skill label carries the whole row, including its nulls', () => {
  assert.equal(
    skillLabel({ name: 'Attack', level: 99, rank: 124252, xp: 19794965 }),
    'Attack: level 99, rank 124,252, 19,794,965 xp'
  );
  assert.equal(skillLabel({ name: 'Sailing', level: 72, rank: null }), 'Sailing: level 72, rank Unranked');
  assert.equal(
    skillLabel({ name: 'Hunter', level: null, rank: null, xp: null }),
    'Hunter: level --, rank Unranked'
  );
});

// The subtitle counts the rows the payload actually carries, so an upstream
// that ships a new skill or boss is reported rather than rounded off, and an
// empty section says zero instead of quietly disappearing.
test('the panel subtitle reports the account and what it actually serves', () => {
  assert.equal(panelSummary('Roll The J', 25, 71), 'Roll The J · 25 skills · 71 bosses');
  assert.equal(panelSummary('Roll The J', 0, 1200), 'Roll The J · 0 skills · 1,200 bosses');
});
