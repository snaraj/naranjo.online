import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { bossInitials, bossSlug, skillSlug } from '../src/lib/bossIcons.ts';
import {
  cellLabel,
  noTally,
  rankLabel,
  skillLabel,
  skillSummary,
  summaryLabel,
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

// The page is ONE CENTRED COLUMN and everything stacks down it (owner
// directive, issue 134), which reverses the tiling half of issue 127 and
// keeps none of it: the owner asked for everything stacked on top of each
// other in a container WIDER than the ribbon that arrangement replaced.
//
// The width is pinned by value here and not merely by shape, because "wider"
// is the directive: a shape-only pin is satisfied by the 30rem ribbon this
// column is required to be bigger than. The specific number stays free — only
// the floor it has to clear is asserted.
test('the page is one centred column, wider than the ribbon it replaced', () => {
  const column = /--page-column-width:\s*([\d.]+)rem;/.exec(styles);
  assert.ok(
    column,
    'the page column must be a fixed maximum width again, not a viewport fill; the owner asked for one centred container'
  );
  // 30rem was the pre-127 ribbon, and the trackers are still designed at that
  // width — a column that did not clear it would be the ribbon under a new
  // name rather than the wider container the owner asked for.
  assert.ok(
    Number(column[1]) > 30,
    `the page column is ${column[1]}rem; the design it replaces was 30rem and the owner asked for a wider one`
  );
  // The collapse-to-viewport guarantee the phone floor depends on lives in the
  // consumer (pinned in the rail test above): min(--page-column-width, 100%)
  // resolves to the viewport on every phone, so a fixed column changes nothing
  // a phone renders.
  assert.doesNotMatch(
    styles,
    /--page-column-width:\s*100%/,
    'a viewport-filling column is the arrangement the owner replaced'
  );
  // One track, at every width. minmax(0, 1fr) rather than a bare 1fr: a grid
  // track's automatic minimum is its min-content, so a card holding a dense
  // table would refuse to shrink and drag the stack past the column — the
  // exact defect that made the body scroll sideways at every width.
  assert.match(
    styles,
    /\.panel-stack\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    'the stack must be one column whose track can shrink to the column it is given'
  );
  // Neither tiling form may come back: both put trackers side by side, which
  // is the arrangement the owner rejected.
  assert.doesNotMatch(
    styles,
    /grid-template-columns:\s*repeat\(\s*auto-fi[lt]/,
    'a tiling stack puts the trackers side by side again'
  );
  // And the token that only existed to tile them is gone rather than left
  // behind for the next reader to wire back up.
  assert.doesNotMatch(
    styles,
    /--page-card-min/,
    'the card-minimum token belonged to the tiling stack and must not linger'
  );
});

test('panel shell surfaces status and provenance over themable tokens', () => {
  assert.match(shell, /data-panel-status=\{status\}/);
  assert.match(shell, /var\(--panel-surface,\s*rgb\(40,\s*40,\s*40\)\)/);
  assert.match(shell, /var\(--panel-border,\s*rgb\(23,\s*23,\s*23\)\)/);
});

// The freshness BADGE is gone (owner directive, issue 127) and the freshness
// MODEL is not. They are separate things and this pins the separation: the
// card no longer interrupts itself to announce its own age, while status and
// provenance still arrive on the envelope and still ride the shell, so the
// removal is a display change that a lane can audit rather than a quiet loss
// of the panel's honesty.
test('no card announces its own age, and none keeps a control', () => {
  // The badge, in every part: the element, its text, and its dot.
  assert.doesNotMatch(shell, /panel-badge/, 'the freshness badge came back');
  assert.doesNotMatch(
    shell,
    /updated \$\{age\}|panelAge|watchClock/,
    'a card is rendering an age again; the reading left with the badge'
  );
  // The model behind it did NOT leave: both facts stay on the element, where
  // nothing displays them and anything can read them.
  assert.match(
    shell,
    /data-panel-status=\{status\}\s+data-panel-generated-at=\{generatedAt\}/,
    'the shell must still carry status and provenance as data'
  );
  assert.match(
    shell,
    /generatedAt\?:\s*string;/,
    'the shell must still accept the envelope timestamp, or its callers stop passing one'
  );
  // Honest states are unaffected — they live in each panel's own body, and
  // this is what makes the badge removal safe to make: a panel with nothing
  // true to show still says so in words.
  for (const [name, source] of Object.entries({ bossLog, activityBar, tokenUsage })) {
    assert.match(
      source,
      /unavailable|No usage data|no activity data/i,
      `${name} lost its explicit unavailable state, which the badge is not there to replace`
    );
  }
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

// One control for the whole page, and it sits with the other one. The
// refresh used to head the panel stack on the argument that it acts on the
// data rather than on the document; the owner overruled that argument on what
// it looked like (issue 127), because it put one control above the centered
// title and one below it. Both now sit together in the header's corner.
test('one refresh serves every tracker, and it sits with the reading mode', () => {
  assert.match(pageHeaderSource, /import RefreshAll from '\.\/RefreshAll\.svelte'/);
  assert.match(
    pageHeaderSource,
    /<header class="page-header">\s*<RefreshAll \/>\s*<ThemeMenu \/>\s*<\/header>/,
    'both chrome icons sit in the header, reading mode last so its popover opens inside the page'
  );
  // The stack is panels and nothing else, so a card added later inherits a
  // column of cards rather than a column with a control stuck on top.
  assert.doesNotMatch(app, /RefreshAll/, 'the refresh must not head the panel stack again');
  assert.match(refreshAll, /aria-label="Refresh all trackers"/);
  // It renders no wrapper: the header owns the row, and a control that also
  // positioned itself would fight it.
  assert.doesNotMatch(refreshAll, /class="refresh-all"/, 'the control must not lay itself out');
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

// Both page-level controls sit in the top-end corner, in flow, and they are
// ICONS rather than buttons (owner directive, issue 127): no disc, no border,
// no fill. What is NOT negotiable is the box — 44px on both axes stays,
// because a bare glyph is no easier to hit than a framed one.
test('the page header is two plain icons in the top-end corner', () => {
  assert.match(app, /<PageHeader \/>/);
  assert.match(pageHeaderSource, /<ThemeMenu \/>/);
  assert.doesNotMatch(pageHeaderSource, /<button/, 'the header composes controls, it does not spell them');
  assert.match(themeMenu, /class="icon-button trigger"/);
  assert.match(refreshAll, /class="icon-button"/);
  assert.match(styles, /\.page-header\s*\{[^}]*justify-content:\s*flex-end/);
  // The static shell reserves the row, so the controls arriving at hydration
  // fill held-open space instead of pushing the page down.
  assert.match(styles, /\.page-header\s*\{[^}]*min-block-size:\s*var\(--page-header-height\)/);
  assert.match(fallbackShell, /<header class="page-header"><\/header>/);
  // The chrome is gone, and its absence is the pin: a circle, a border or a
  // fill on this rule is what the owner rejected, and each would come back
  // as one innocent-looking declaration.
  const iconRule = /\.icon-button\s*\{([^}]*)\}/.exec(styles);
  assert.ok(iconRule, 'the shared icon-control rule is not where this pin expects it');
  assert.match(iconRule[1], /border:\s*0/, 'a page icon must carry no border');
  assert.match(iconRule[1], /background:\s*none/, 'a page icon must carry no fill');
  assert.doesNotMatch(iconRule[1], /border-radius/, 'a page icon must not wear a disc');
  // ...and neither does any state of it: a hover that paints a surface is a
  // button that appears when touched.
  for (const [, body] of styles.matchAll(/\.icon-button[^{]*\{([^}]*)\}/g)) {
    assert.doesNotMatch(
      body,
      /background:\s*var\(|border-radius:\s*50%/,
      'an icon-button state paints button chrome'
    );
  }
  // 44px on both axes, still, from the one shared rule.
  assert.match(styles, /\.icon-button\s*\{[^}]*inline-size:\s*2\.75rem/);
  assert.match(styles, /\.icon-button\s*\{[^}]*block-size:\s*2\.75rem/);
});

test('boss log renders the dense fixed-cell table with tooltips and -- tallies', () => {
  assert.match(bossLog, /block-size:\s*var\(--boss-cell-height/, 'cells must keep a fixed height (no CLS)');
  assert.match(bossLog, /tally\(boss\.kc\)/, 'tallies must go through the tested renderer');
  assert.match(bossLog, /rankLabel\(boss\.rank\)/, 'ranks must go through the tested renderer');
  // Three columns wrapping downward, and NO scroll region (owner directive,
  // issue 134: "it doesn't need scrolling if it just goes down in columns of
  // 3"). The table has now been all three arrangements — a tall vertical
  // scroller, a two-row sideways one, and this — so every declaration that
  // made it a scroller is pinned absent rather than merely replaced.
  //
  // minmax(0, 1fr) is what makes "never scrolls" a property instead of a
  // hope: the tracks are exactly a third of the card at every width, so three
  // columns always fit and the box never has an overflow to reveal. A fixed
  // track width would lay out 252px of columns in the 266px a 320px card
  // leaves, and would scroll on the first narrower device.
  assert.match(
    bossLog,
    /\.boss-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/,
    'the boss table must be three shrinkable columns, exactly like the skills table above it'
  );
  assert.doesNotMatch(
    bossLog,
    /\.boss-grid\s*\{[^}]*grid-auto-flow/,
    'a column flow is the sideways strip the owner replaced'
  );
  // The absence of overflow is now the load-bearing pin, and it protects two
  // things at once: the table the owner asked not to scroll, and the tooltip
  // below, which an overflow ancestor would clip the moment one came back.
  assert.doesNotMatch(
    bossLog,
    /\.boss-grid\s*\{[^}]*overflow/,
    'an overflow on the boss table is a scroll region the owner removed and a clipping ancestor for the detail'
  );
  // The fill variant existed only to claim the retired rail's height; a card
  // in the stack grows to its content, so it must not come back.
  assert.doesNotMatch(shell, /panel-shell-fill/, 'the rail-filling variant must stay retired');
  assert.match(bossLog, /role="tooltip"/);
  assert.match(bossLog, /:hover\s+\.boss-tip/);
  assert.match(bossLog, /:focus-visible\s+\.boss-tip/);
  // The tooltip is what actually cut the leading digits off the old table: a
  // minimum width inside a ~90px cell pushed the grid's scroll width past
  // the card. A viewport-width threshold cannot catch that — the offending
  // value was 9rem, comfortably under the 320px floor — so the MECHANISM is
  // pinned: the tip is bounded by the viewport and claims no minimum.
  //
  // Its containing block is the CELL again. It had to move out to a wrapper
  // while the table scrolled, because an absolutely positioned box is clipped
  // by an overflow ancestor in its containing-block chain; with the scroller
  // gone there is nothing to clip it, and a table that wraps down the card
  // has no single readout position that is near the tile a reader is
  // pointing at.
  assert.match(
    bossLog,
    /\.boss-cell\s*\{[^}]*position:\s*relative/,
    'the cell must be the tip’s containing block, so the detail appears on the tile it describes'
  );
  assert.match(
    bossLog,
    /\.boss-tip\s*\{[^}]*max-inline-size:\s*min\(/,
    'the tip must be bounded by the viewport'
  );
  assert.doesNotMatch(
    bossLog,
    /\.boss-tip\s*\{[^}]*min-inline-size/,
    'a tip wider than its cell claims space the card does not have'
  );
  // Anchoring the tip per COLUMN is the containment rule that replaces the
  // scroller's clipping: a tip is wider than a cell, so a start-anchored one
  // in the last column extends past the card's end edge — and with no
  // clipping ancestor left, that drags the DOCUMENT sideways, which is the
  // floor this repository is pinned against at 320px. First column opens
  // toward the end edge, last column toward the start edge.
  assert.match(
    bossLog,
    /\.boss-cell:nth-child\(3n\)\s+\.boss-tip\s*\{[^}]*inset-inline-end:\s*0/,
    'the last column’s detail must open toward the start edge, or it hangs off the card'
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

// The owner reviewed the vendored boss art and locked it exactly as rendered
// (issue 127: "gorgeous… LOCK THOSE IN"). The layout around it changed in the
// same pass, which is precisely when a rendering detail gets adjusted by
// accident, so every part of how a tile is SOURCED and DRAWN is pinned here
// in one place: the file the slug selects, the declared box, the loading
// behavior, and the painted size.
test('the boss icons are locked exactly as they render', () => {
  assert.match(
    bossLog,
    /<img\s+class="boss-icon"\s+src=\{icons\.get\(bossSlug\(boss\.name\)\)\}\s+alt=""\s+width="26"\s+height="26"\s+loading="lazy"\s+decoding="async"/,
    'a boss tile is sourced by slug and declares its box, its lazy loading and its async decode'
  );
  assert.match(
    bossLog,
    /\.boss-icon\s*\{[^}]*inline-size:\s*26px[^}]*block-size:\s*26px[^}]*object-fit:\s*contain/,
    'the painted icon box is 26px square and never distorts the art inside it'
  );
  // The designed hole for a row that ships upstream before its art does.
  assert.match(bossLog, /<span class="boss-icon boss-glyph" aria-hidden="true">\{bossInitials\(boss\.name\)\}<\/span>/);
});

// The skills grid is the half of the panel the payload always carried and
// nothing ever rendered: internal/panels parsed the hiscores skill table and
// then dropped it on the floor (issue #78).
test('the skills grid mirrors the hiscore panel and renders levels honestly', () => {
  assert.match(
    bossLog,
    /\.skill-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/,
    'the skills table must stay three columns that can shrink'
  );
  assert.match(bossLog, /\.skill-cell\s*\{[^}]*block-size:\s*1\.625rem/, 'skill cells need a fixed height (no CLS)');
  assert.match(bossLog, /width="18"\s+height="18"/, 'skill icons must declare their box (no CLS)');
  assert.match(bossLog, /tally\(skill\.level\)/, 'levels must go through the tested renderer');
  assert.match(bossLog, /aria-label=\{skillLabel\(skill\)\}/);
  assert.match(bossLog, /title=\{skillLabel\(skill\)\}/);
  assert.match(bossLog, /skillSlug/);
  // The totals are cells of the same grid, keyed and labelled like the rest,
  // so the last row ends flush instead of trailing two blank tiles.
  assert.match(bossLog, /\{#each summary as cell \(cell\.key\)\}/);
  assert.match(bossLog, /<li class="skill-cell skill-summary" aria-label=\{summaryLabel\(cell\)\} title=\{summaryLabel\(cell\)\}>/);
  assert.match(bossLog, /const summary = \$derived\(skillSummary\(skills\)\)/, 'the totals must be derived from the payload');
  // One line, whatever the width: a wrapped nine-digit figure in a 1.625rem
  // cell spills over the row below it.
  assert.match(bossLog, /\.skill-summary\s*\{[^}]*white-space:\s*nowrap/);
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
// The stat unit set is hand-duplicated across the tree: a Go const block that
// the origin serves by, and a TypeScript admission set that the frontend
// refuses unknown units with. The contract calls adding a unit "a conscious
// edit on both sides" — this pin is what makes that true rather than hoped
// for. Adding a unit to one side alone fails here, naming the side that is
// behind, instead of shipping a tile the frontend cannot format.
test('the stat unit set is identical on both sides', { skip: reducedContextNote }, async () => {
  const goSource = await read('../../internal/panels/types.go');
  const tsSource = await read('../src/lib/token-usage.ts');

  const goUnits = new Set(
    // [^"]+ and not [a-z]+: a hyphenated unit is this file's own house
    // style (cache-read, active-days, longest-task), so a narrow capture
    // does not merely miss an exotic value — it makes the Go set SHRINK to
    // match a TypeScript set that is equally short, and the pin then agrees
    // with itself while the panel blanks.
    [...goSource.matchAll(/\bUnit[A-Z][A-Za-z]*\s*=\s*"([^"]+)"/g)].map(([, value]) => value)
  );
  const declared = /const statUnits: ReadonlySet<string> = new Set\(\[([^\]]*)\]\)/.exec(tsSource);
  assert.ok(declared, 'the frontend admission set is not where this pin expects it');
  const tsUnits = new Set(
    declared[1]
      .split(',')
      .map((entry) => entry.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
  );

  assert.ok(goUnits.size > 0, 'no Unit* consts found in the Go source; the pin has nothing to protect');
  assert.deepEqual(
    [...tsUnits].sort(),
    [...goUnits].sort(),
    'the Go unit consts and the frontend admission set have drifted apart'
  );
});

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

// The owner renamed the version-control card to the service it reports from
// (issue 127). That name could not land in either source tree: internal/panels
// is pinned against vendor names in Go source, and the frontend is pinned
// against naming this panel's origin (activity.test.mjs). Both pins hold
// BECAUSE the title is data — which is the arrangement the doctrine wanted all
// along, and this is the pin that keeps the string on the data side of it.
test('the panel heading is data the origin serves, not a string in either tree', {
  skip: reducedContextNote,
}, async () => {
  const fetchConfig = await read('../../internal/panels/config/fetch.json').then(JSON.parse);
  assert.equal(
    fetchConfig.titles?.['vcs-activity'],
    'GitHub',
    'the owner-chosen heading must live in config data, where a vendor name is allowed to be'
  );
  // The component renders whatever the envelope carries. A hardcoded heading
  // here would render the same page today and make the config data a lie.
  assert.match(activityBar, /title=\{envelope\?\.title \|\| 'Version-control activity'\}/);
  // And the Go source keeps the neutral name as its fallback, so a config
  // that fails to load degrades to a truthful heading rather than a blank.
  const panelConfig = await read('../../internal/panels/config.go');
  assert.match(panelConfig, /title: "Version-control activity"/);
  // The overlay is applied by panel ID from the decoded config document, and
  // an id the config does not name keeps the neutral literal above.
  assert.match(
    panelConfig,
    /applyTitles\(definitions, document\.Titles\)/,
    'the origin must overlay the configured headings onto its panel list'
  );
  assert.match(
    panelConfig,
    /if title, ok := titles\[definition\.id\]; ok && title != ""/,
    'the origin must apply the configured heading by panel id, and treat a blank one as no choice'
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

// The calendar opens on TODAY at its end edge (owner directive, issue 127).
// Cells run oldest first, so a strip that opens where its content begins
// opens on January and hides every recent day off the right edge — which is
// the defect, not a preference.
test('the grid opens on its newest column and lets history scroll back', () => {
  assert.match(
    grid,
    /node\.scrollLeft = node\.scrollWidth/,
    'the strip must be scrolled to its end edge, where the newest column is'
  );
  // Keyed on the column COUNT, not on every payload: a sixty-second refresh
  // that returns the same window must not yank a reader who scrolled back.
  assert.match(
    grid,
    /count === anchoredColumns/,
    'a refresh returning the same window must not re-anchor a reader who scrolled back'
  );
  // And re-anchored when the BOX changes width, because the scroll position
  // that means "the end" is a function of that box: a card in this stack
  // genuinely resizes (a rotation, a viewport change), and a strip anchored
  // before the resize is left showing the middle of its history afterwards.
  assert.match(grid, /node\.clientWidth === anchoredWidth/);
  assert.match(grid, /new ResizeObserver\(/);
  // Instantly. A smooth scroll here would be motion nobody asked for, on a
  // page whose animations are all inside a no-preference query.
  assert.doesNotMatch(grid, /scroll-behavior|scrollTo\(/, 'the opening position is not a journey');
});

// INVERTED by the owner's ruling of 2026-08-24. This pin used to REQUIRE the
// empty grid: pendingColumns rendered, the placeholder span exact, more than
// three hundred cells of chrome under the note "series pending". Every one of
// those cells was honest about itself — absent, valueless, undated — and the
// arrangement was still false, because "pending" claimed something was on its
// way. For the source this was built for, nothing is: it publishes no daily
// record, so the panel was holding a graph-shaped box open forever.
//
// The opposite guarantee, and it has to be exactly as strong as the one it
// replaces, so BOTH halves are here. A source with nothing to draw renders no
// graph region at all — not the grid, not the heading, not the lens toggle
// that would have no series to re-read. A source WITH something to draw
// renders the whole region, unchanged. Half of this alone is not a guard: a
// panel that dropped every graph would satisfy the first half perfectly.
test('a token source with no series renders no graph, and one with a series still renders it', () => {
  const region =
    /\{#if activityColumns\.length > 0\}\s*<section class="usage-activity">([\s\S]*?)<\/section>\s*\{\/if\}/.exec(
      tokenUsage
    );
  assert.ok(region, 'the graph region is no longer gated on there being columns to draw');
  // The gate reads the SAME columns the grid is handed, so the two can never
  // disagree about whether this source has a graph.
  assert.match(
    region[1],
    /<ContributionGrid\s+columns=\{activityColumns\}/,
    'the gate and the graph read different things'
  );
  // The heading and the lens toggle are inside the gate with it: a "Token
  // activity" heading over a toggle with nothing to toggle is the same hole
  // wearing different markup.
  assert.match(region[1], /Token activity/, 'the heading survived its graph');
  assert.match(region[1], /role="radiogroup"/, 'the lens toggle survived its series');
  // And the panel never asks the shared component for its empty treatment.
  assert.doesNotMatch(tokenUsage, /emptyNote/, 'the panel asks for an empty grid again');
  assert.doesNotMatch(tokenUsage, /series pending/, 'the retired "pending" claim is back');
  assert.doesNotMatch(tokenUsage, /pendingColumns/, 'the panel reaches for placeholder columns');
  // The component KEEPS that treatment, and this is the line between the two
  // cases rather than an exception to the ruling: the version-control
  // calendar's payload is genuinely in flight, and its reserve holds exactly
  // the box the data will fill (measured in the rendering lanes). Deleting it
  // would trade a permanent hole for a shift on every visit.
  assert.match(grid, /pendingColumns/, 'the reserve for a payload in flight lost its chrome');
  assert.match(
    grid,
    /<span class="grid-cell" data-grid-pending data-grid-absent="true"><\/span>/,
    'every placeholder cell is absent — no value, no date, no level'
  );
  assert.match(grid, /<div class="grid-cells" aria-hidden="true">/);
  assert.match(grid, /\.grid-empty\s*\{[^}]*position:\s*absolute/);
  // Exactly one caller may ask for it, and it is the one whose data is coming.
  assert.match(activityBar, /emptyNote=/, 'the calendar stopped labelling its waiting state');
  // The retired sentence must not come back anywhere.
  for (const [name, source] of Object.entries({ grid, tokenUsage, activityBar })) {
    assert.doesNotMatch(
      source,
      /live refresh is off/,
      `${name} explains the origin's configuration to a visitor again`
    );
  }
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

// The panel used to open with a subtitle naming the account. The RSN is
// personal information and the owner does not want it displayed (issue 127),
// so it is gone from the rendering entirely — from the visible line AND from
// the accessible names, which are a display like any other. The payload still
// carries the account, because what the origin serves is a data question and
// this pass is a display one.
test('the boss panel displays no account name anywhere', () => {
  assert.doesNotMatch(
    bossLog,
    /data\.account/,
    'the account name reaches a rendering again; a label read aloud is still displayed'
  );
  assert.doesNotMatch(bossLog, /panelSummary/, 'the account subtitle came back');
  // The grids keep accessible names — losing the account must not cost a
  // screen reader the ability to tell the two tables apart.
  assert.match(bossLog, /<ul class="skill-grid" aria-label="Skill levels">/);
  // And the boss table is no longer a focus stop. The tabindex it used to
  // carry existed because a scrollable box is keyboard-reachable only when
  // focusable; with the scroll region gone (issue 134) it is a tab stop that
  // does nothing, which costs every keyboard reader a press for no action.
  assert.match(bossLog, /<ul class="boss-grid" aria-label="Boss tallies">/);
  assert.doesNotMatch(
    bossLog,
    /<ul class="boss-grid"[^>]*tabindex/,
    'the boss table is not a scroll region any more, so it must not be a focus stop either'
  );
});

// The grid's trailing gap, filled with the account's own totals rather than
// left blank (owner directive, issue 127). These are EXECUTED rather than
// pattern-matched, because the interesting cases are the honest ones: a total
// the hiscores do not report, and a payload with no Overall row at all.
test('the skills grid closes with the account totals, honestly', () => {
  const overall = { name: 'Overall', level: 2274, rank: 138220, xp: 453846899 };
  const cells = skillSummary([overall, { name: 'Attack', level: 99, rank: 1, xp: 2 }]);
  assert.deepEqual(
    cells.map((cell) => [cell.label, cell.value]),
    [
      ['XP', '453,846,899'],
      ['Rank', '138,220'],
    ],
    'the two totals are the Overall row’s xp and rank, grouped like every other figure'
  );
  // The full name rides the accessible text, because "Total XP" does not fit
  // a third of a 320px card and a truncated label is worse than a short one.
  assert.equal(summaryLabel(cells[0]), 'Total XP: 453,846,899');
  assert.equal(summaryLabel(cells[1]), 'Overall rank: 138,220');
  // Nulls render as the same markers every other cell uses — a total the
  // upstream does not report is not a zero and not an empty tile.
  const unreported = skillSummary([{ name: 'Overall', level: null, rank: null, xp: null }]);
  assert.deepEqual(
    unreported.map((cell) => cell.value),
    [noTally, unrankedLabel]
  );
  // No Overall row, no invented cells. The gap coming back is the honest
  // outcome, and the tiling pin below is what makes it loud.
  assert.deepEqual(skillSummary([{ name: 'Attack', level: 99, rank: 1, xp: 2 }]), []);
  assert.deepEqual(skillSummary([]), []);
});

// The blank tiles the owner asked us to remove are a COUNTING property, not a
// styling one: three columns, twenty-five skills and two totals tile exactly,
// and an upstream that ships a twenty-sixth skill breaks that. This fails the
// day it does, naming the arithmetic, instead of shipping a blank tile.
test('the skills grid tiles its columns exactly, with no cell left over', {
  skip: reducedContextNote,
}, async () => {
  const snapshot = await read('../../internal/panels/snapshots/boss-log.json').then(JSON.parse);
  const columns = 3;
  const cells = snapshot.data.skills.length + skillSummary(snapshot.data.skills).length;
  assert.equal(
    cells % columns,
    0,
    `${snapshot.data.skills.length} skills plus ${cells - snapshot.data.skills.length} totals leave ` +
      `${cells % columns} blank tile(s) in a ${columns}-column grid; the grid must end flush`
  );
});
