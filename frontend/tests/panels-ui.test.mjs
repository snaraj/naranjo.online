import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { vcsActivityProps } from '../src/lib/activity.ts';
import { bossInitials, bossSlug, skillSlug } from '../src/lib/bossIcons.ts';
import {
  bossDetail,
  bossLogEmptySkillsNote,
  bossLogFallbackTitle,
  bossLogLoadingNote,
  bossLogPanelId,
  bossLogUnavailableNote,
  cellLabel,
  noTally,
  osrsStatsProps,
  rankLabel,
  skillDetail,
  skillLabel,
  skillSummary,
  summaryDetail,
  summaryLabel,
  tally,
  unrankedLabel,
} from '../src/lib/bossLog.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

// Strip /* */ and <!-- --> comments to a fixed point, not in one pass: deleting
// a match can butt adjacent characters together into a delimiter the same sweep
// already stepped past, so a lone regex replace is incomplete (this is exactly
// what CodeQL's js/incomplete-multi-character-sanitization flags). Looping until
// the text stops changing leaves no reconstituted delimiter behind. Test-only —
// it runs over repository source read off disk and its output feeds assert.
const stripComments = (text) => {
  let prev;
  do {
    prev = text;
    text = text.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, '');
  } while (text !== prev);
  return text;
};

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
  pageHeaderSource,
  fallbackShell,
  statTracker,
  panelsSource,
  iconsSource,
  viteConfig,
  grid,
  gridSource,
  activityTracker,
  usageTracker,
  styles,
  themeMenu,
  detailTip,
  manifest,
  pageSection,
  blockHost,
  osrsBinding,
] = await Promise.all([
  read('../src/App.svelte'),
  read('../src/lib/components/PanelShell.svelte'),
  read('../src/lib/components/PageHeader.svelte'),
  read('../index.html'),
  read('../src/lib/components/StatTracker.svelte'),
  read('../src/lib/panels.ts'),
  read('../src/lib/bossIcons.ts'),
  read('../vite.config.ts'),
  read('../src/lib/components/ContributionGrid.svelte'),
  read('../src/lib/grid.ts'),
  read('../src/lib/components/ActivityTracker.svelte'),
  read('../src/lib/components/UsageTracker.svelte'),
  read('../src/styles.css'),
  read('../src/lib/ThemeMenu.svelte'),
  read('../src/lib/components/DetailTip.svelte'),
  read('../src/page.ts'),
  read('../src/lib/components/PageSection.svelte'),
  read('../src/lib/components/Block.svelte'),
  read('../src/lib/blocks/osrsStats.ts'),
]);

/* The two sibling binding modules, read beside the one above so the
 * stays-current pin can sweep all three panel bindings. */
const bindingSourceCache = {
  vcs: await read('../src/lib/blocks/vcsActivity.ts'),
  usage: await read('../src/lib/blocks/tokenUsage.ts'),
};

/* The adapter module beside the boss-log data, for the account-privacy pin. */
const bossLogHelperSource = await read('../src/lib/bossLog.ts');

// Like the experience suite, these are structural regex pins over source:
// they hold the shapes the owner specified — chrome values, grid density,
// fail-soft rendering — while leaving copy and styling free to evolve.
test('the manifest mounts exactly the three tracker blocks, in the stacked order', () => {
  // The fences retired with the table-of-contents App (issue 165): the
  // manifest IS the mount list, one ordered entry per block, and the page
  // renders it verbatim. Adding a tracker is adding one block to this line.
  // The owner reversed the section's two ends on 2026-08-25 — the token
  // tracker opens it and the game tracker closes it, with the
  // version-control tracker unmoved between them.
  assert.match(
    manifest,
    /section\('trackers', 'Trackers', \[tokenUsage, vcsActivity, osrsStats\], \{ layout: 'stack' \}\)/,
    'the trackers section must list exactly one entry per panel, in the order the page stacks them'
  );
  // The page renders the manifest rather than spelling its own copy of it.
  assert.match(app, /import \{ page \} from '\.\/page\.ts'/);
  assert.match(app, /\{#each page as section \(section\.id\)\}\s*<PageSection \{section\} \/>\s*\{\/each\}/);
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
  for (const [name, source] of Object.entries({ app, styles, themeMenu, activityTracker, statTracker, pageSection })) {
    assert.doesNotMatch(source, /data-rail-open|--page-rail-gutter|--panel-rail-|SideRail/, `${name} still references the retired rail`);
  }
  // The stack owns the column width and the gap; panels own neither, so a
  // panel added later cannot pick a width that disagrees with its siblings.
  // The stack renders in PageSection, behind the manifest's one stack layout.
  assert.match(pageSection, /\{#if section\.layout === 'stack'\}\s*<div class="panel-stack">/);
  assert.match(styles, /\.panel-stack\s*\{[^}]*display:\s*grid/);
  assert.match(styles, /\.panel-stack\s*\{[^}]*gap:\s*var\(--page-stack-gap\)/);
  // The header no longer shares this rule (owner directive, issue 168): it
  // pinned to the viewport corner and decoupled from the column entirely.
  assert.match(styles, /#app > main\s*\{[^}]*inline-size:\s*min\(var\(--page-column-width\), 100%\)/);
  assert.doesNotMatch(
    styles,
    /#app > \.page-header/,
    'the header still shares a rule with the column it was told to decouple from'
  );
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
  // The shipped width moved behind a name when the reader gained a handle on
  // it (owner directive, 2026-08-24): --page-column-width is the knob a drag
  // writes as an inline style, so the width the page SHIPS at needs a token of
  // its own that an override cannot reach — which is also the width a
  // double-click returns to. Both halves are pinned, because a base token that
  // nothing referenced would leave the column free to ship at anything.
  const column = /--page-column-base:\s*([\d.]+)rem;/.exec(styles);
  assert.ok(
    column,
    'the page column must be a fixed maximum width again, not a viewport fill; the owner asked for one centred container'
  );
  assert.match(
    styles,
    /--page-column-width:\s*var\(--page-column-base\);/,
    'the knob the drag writes must default to the shipped column, or the two can disagree'
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
  // Honest states are unaffected — they are DATA now (issue 165), carried by
  // each panel's adapter and rendered by its generic component's note and
  // empty fields; this is what makes the badge removal safe to make: a panel
  // with nothing true to show still says so in words. EXECUTED where the
  // words live, structural where they render.
  assert.equal(osrsStatsProps(null, { levels: new Map(), tallies: new Map() }).note, bossLogLoadingNote);
  assert.equal(bossLogUnavailableNote, 'Boss data is unavailable right now.');
  assert.match(statTracker, /\{#if grids\.length === 0 && note\}\s*<p class="stat-note">\{note\}<\/p>/);
  assert.match(activityTracker, /<span class="activity-empty">\{figuresNote\}<\/span>/);
  assert.match(usageTracker, /<p class="usage-empty">\{emptyNote\}<\/p>/);
  // No per-card control, and no panel hands one up any more.
  assert.doesNotMatch(shell, /panel-refresh|<button/, 'a card grew its own refresh control back');
  // Two spellings, because a bespoke refresher does not have to be CALLED
  // "refresh" to be one. The delta review showed a panel could reintroduce
  // the control under any name so long as it reached a watcher's refresh(),
  // so the call itself is pinned rather than one identifier.
  //
  // A blanket ban on <button> inside a panel was tried here and is wrong:
  // UsageTracker legitimately owns a daily/weekly/cumulative radiogroup,
  // which is a view control, not a refresher.
  //
  // What this comment used to say next — "reaching a watcher is what makes a
  // control a refresher, whatever it is named" — is FALSE and was retracted.
  // A card needs no watcher handle at all: refreshPanels() used to be
  // module-level. It is gone now too (owner directive, issue 179), along with
  // the page-header control that was its only caller — so this loop still
  // guards a panel growing ANY refresher of its own, whether by reaching a
  // watcher directly or by reaching for a page-level helper that no longer
  // exists to reach.
  // PanelShell is swept with the cards, not instead of them: it is the ONE
  // component that renders for all three, so a control added there appears
  // on every card at once — the widest version of the regression these
  // assertions exist to stop, and the one the per-card loop used to miss.
  // Block.svelte joins the sweep for the same reason PanelShell is in it: it
  // is the ONE host every panel block renders through, so a control added
  // there appears on every card at once.
  for (const [name, source] of Object.entries({
    statTracker,
    activityTracker,
    usageTracker,
    panelShell: shell,
    blockHost,
  })) {
    assert.doesNotMatch(
      source,
      /\{\s*refresh\s*\}|(?:const|let|var)\s+refresh\s*=/,
      `${name} still hands a refresher to its shell`
    );
    assert.doesNotMatch(source, /\.refresh\(\)/, `${name} drives a watcher refresh of its own`);
    assert.doesNotMatch(
      source,
      /refreshPanels/,
      `${name} reaches for the retired all-panels refresher; no control refreshes any tracker any more (issue 179)`
    );
  }
});

// The manual "refresh all trackers" control is gone entirely (owner
// directive, issue 179): "the site is expected to be responsive on its own;
// a data-retrieval failure logs an error … it is not an expected state a
// visitor manages with a manual refresh control." It used to sit beside the
// reading mode in the header's corner (issue 127); the reading mode is now
// the header's only control, and nothing it left behind survives as
// reachable code.
test('the refresh control is gone, and nothing it owned survives as dead code', async () => {
  assert.equal(
    existsSync(new URL('../src/lib/components/RefreshAll.svelte', import.meta.url)),
    false,
    'the refresh component must not come back'
  );
  assert.doesNotMatch(pageHeaderSource, /RefreshAll/, 'the header still names the retired control');
  assert.match(
    pageHeaderSource,
    /<header class="page-header">\s*<ThemeMenu \/>\s*<\/header>/,
    'the reading mode is the header’s only control now'
  );
  assert.doesNotMatch(app, /RefreshAll/, 'the refresh must not head the panel stack again either');
  // THE FAN-OUT IS BACK, WITH A CALLER — and that condition is now the pin
  // (issue 219). It was deleted at issue 179 because the only thing invoking
  // it was the button that had just been removed, and a fan-out nothing fans
  // out to is dead code; that reasoning was right and is preserved exactly.
  // What changed is that a pull-to-refresh gesture now asks for it. So the
  // rule is no longer "this must not exist" — which would forbid the caller
  // rather than the dead code — but "this must not exist WITHOUT a caller",
  // which is the property issue 179 actually wanted and is strictly harder to
  // satisfy by accident. A future removal of the gesture makes this red
  // again, exactly as it should.
  // Swept across the whole component tree rather than a named file, so the
  // caller may move without anyone remembering to update this.
  const tree = await readdir(new URL('../src', import.meta.url), { recursive: true });
  const callers = (
    await Promise.all(
      tree
        .filter((entry) => entry.endsWith('.svelte'))
        .map(async (entry) => [entry, await read(`../src/${entry}`)])
    )
  ).filter(([, source]) => /refreshPanels\(\)/.test(source));
  if (/export async function refreshPanels/.test(panelsSource)) {
    assert.ok(
      callers.length > 0,
      'refreshPanels is exported with nothing calling it; that is the dead code issue 179 removed'
    );
  } else {
    assert.equal(
      callers.length,
      0,
      'a component calls refreshPanels but panels.ts no longer exports it'
    );
  }
  assert.doesNotMatch(panelsSource, /liveWatchers/, 'the retired watcher set name is back');
  // Its own forced-read primitive is a different, independently useful thing
  // and stays (proven behaviorally in panel-refresh.test.mjs): watchPanel
  // still exposes refresh() on the watcher it returns, and still rides it
  // itself for the visibility catch-up.
  assert.match(panelsSource, /refresh:\s*\(\)\s*=>\s*read\(true\)/);
  // And a failed read no longer degrades silently: loadPanel now logs the
  // fault it is about to hand back as an honest unavailable envelope, which
  // is the replacement for a visitor pressing a button that no longer
  // exists. panels.test.mjs executes this rather than trusting the shape.
  assert.match(panelsSource, /console\.error\(/);
});

// Five collisions were confirmed on real viewports before the previous fix
// (issue #78) and were arbitrated by a four-level layer scale plus two
// reserved gutters. Every one of them existed because chrome FLOATED over the
// document: the bar over the token panel, the open rail over the token panel,
// the reading-mode control buried under the rail, the rail and bar tied at one
// layer, and 100vh floors. Removing the fixed positioning removed the whole
// class — until issue 168 put ONE piece of chrome back: the header, now
// pinned to the viewport corner on purpose. So the pin below is narrowed to
// name that one exception rather than lifted; every OTHER float is still
// exactly as forbidden as it was.
test('no page chrome floats over the document', () => {
  // The header's own rule is carved out of styles.css before the blanket
  // sweep below, and checked separately underneath — it is the one deliberate
  // exception now, not an absence to prove.
  const headerRule = /\.page-header\s*\{([^}]*)\}/.exec(styles);
  assert.ok(headerRule, 'the page header rule is not where this pin expects it');
  const stylesWithoutHeader = styles.slice(0, headerRule.index) + styles.slice(headerRule.index + headerRule[0].length);
  // styles.css is in this sweep deliberately and is the load-bearing entry:
  // most page chrome's rule lives THERE, not in a component, so a scan of
  // components alone would let the exact drift this test is named for return
  // with the suite green.
  for (const [name, source] of Object.entries({
    pageHeaderSource,
    themeMenu,
    activityTracker,
    statTracker,
    usageTracker,
    pageSection,
    blockHost,
    shell,
    styles: stylesWithoutHeader
  })) {
    assert.doesNotMatch(
      // Comment-blind, for the reason experience.test.mjs records about its
      // own raw-text pins: prose is not a declaration. A comment EXPLAINING
      // that a detail elsewhere is fixed tripped this pin, and a comment
      // could equally have hidden a real one from a stricter reader.
      stripComments(source),
      /position:\s*fixed/,
      `${name} floats over the page again; fixed chrome is what made the controls drift`
    );
  }
  /* TWO narrow, named exceptions, stated here where the owner will read them.

     The page header (owner directive, issue 168): "push the icons all the
     way to the top right, outside of the feed... I don't like how they move
     when I drag the feed in and out." Fixed positioning is the fix rather
     than the defect this time, because it is what decouples the header from
     the column it used to share a rule with — the exact coupling that made
     it drift. It stays safe for a different reason than the detail below:
     it is real interactive chrome, so it keeps the pointer and stays visible,
     but it reserves no layout space (nothing above it needs to hold a gap
     open any more) and clears the same safe-area insets #app does, through
     its own inset tokens. */
  assert.match(headerRule[1], /position:\s*fixed/, 'the header is no longer pinned to the viewport corner; this exception is stale and should go');
  assert.match(headerRule[1], /inset-block-start:\s*var\(--header-inset-block,\s*var\(--page-gutter\)\)/);
  assert.match(headerRule[1], /inset-inline-end:\s*var\(--header-inset-inline,\s*var\(--page-gutter\)\)/);
  // Coordinator quality pass on issue 186: --header-inset-inline/--header-inset-block
  // used to carry a plain-base declaration ahead of the env()-guarded one, on
  // the mistaken claim that a later custom-property declaration degrades the
  // way a later REGULAR-property one can. It cannot: any value parses as a
  // custom property, so the second declaration always wins and the first was
  // dead code. Exactly one declaration of each survives.
  for (const token of ['--header-inset-inline', '--header-inset-block']) {
    const declarations = styles.match(new RegExp(`${token}:\\s*[^;]+;`, 'g')) ?? [];
    assert.equal(declarations.length, 1, `${token} must be declared exactly once, not shadowed by a dead fallback`);
    assert.match(declarations[0], /env\(safe-area-inset-/, `${token}'s one declaration must still clear the safe area`);
  }

  /* The hover-detail primitive (owner directive, 2026-08-24). It is fixed so
     it can follow the cursor, and fixed positioning is what makes its
     containment structural — a fixed box sits outside the document's
     scrollable overflow, so no position it takes can drag the page sideways,
     which is the 320px floor the retired per-column anchoring existed to
     protect.

     It is not chrome and cannot become chrome, and these are the conditions
     that say so rather than a promise that it will not: it reserves no
     gutter, it cannot receive the pointer, and it is invisible until a
     reader asks for it. Its position is measured against every viewport edge
     by the browser lanes, including the no-sideways-scroll floor at 320px. */
  const tipStyles = /<style[^>]*>([\s\S]*?)<\/style>/.exec(detailTip)[1];
  assert.match(tipStyles, /position:\s*fixed/, 'the detail is no longer fixed; this exception is stale and should go');
  assert.match(tipStyles, /pointer-events:\s*none/, 'fixed chrome that can take the pointer is chrome');
  assert.match(tipStyles, /visibility:\s*hidden/, 'a fixed box that is always visible is chrome');
  assert.doesNotMatch(
    stripComments(detailTip),
    /--page-[a-z-]*gutter|reserve/,
    'the detail reserves page space; a transient overlay must cost the layout nothing'
  );
  // With nothing floating but real chrome there is nothing left to reserve
  // space for, so the gutter tokens that existed only to hold space open for
  // the OLD, defective floats must stay gone.
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
  for (const [name, source] of Object.entries({ pageHeaderSource, themeMenu, activityTracker })) {
    assert.doesNotMatch(
      source,
      /z-index:\s*\d/,
      `${name} sets a raw z-index; the stacking order is the token scale, not a race`
    );
  }
});

// The header's one remaining control is pinned to the viewport's top-end
// corner (owner directive, issue 168), OUTSIDE the feed column, and is an
// ICON rather than a button (owner directive, issue 127): no disc, no
// border, no fill. What is NOT negotiable is the box — 44px on both axes
// stays, because a bare glyph is no easier to hit than a framed one. A
// second icon — the manual refresh — used to sit beside it and is gone now
// (issue 179), which is what turns "two plain icons" into one.
test('the page header is one plain icon pinned to the viewport corner', () => {
  assert.match(app, /<PageHeader \/>/);
  assert.match(pageHeaderSource, /<ThemeMenu \/>/);
  assert.doesNotMatch(pageHeaderSource, /<button/, 'the header composes controls, it does not spell them');
  assert.match(themeMenu, /class="icon-button trigger"/);
  // The static shell renders the identical empty header tag, so the exact
  // same fixed-position rule applies to it before a single icon hydrates —
  // there is no in-flow row left to reserve or to have arrive late.
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

test('the stats tracker renders the dense fixed-cell table with tooltips and -- tallies', () => {
  assert.match(statTracker, /block-size:\s*var\(--stat-cell-height/, 'cells must keep a fixed height (no CLS)');
  // Figures and details are built by the adapter through the tested
  // renderers — tally, cellLabel, bossDetail — executed below and in
  // tests/tooltip.test.mjs, including the unranked and no-figure cases. The
  // component may format nothing.
  assert.doesNotMatch(
    statTracker,
    /toLocaleString|Intl\.NumberFormat/,
    'a figure is being formatted in the component instead of by the tested renderers'
  );
  const tallies = osrsStatsTallies();
  assert.equal(tallies.cells[0].figure, tally(1192), 'tallies must go through the tested renderer');
  assert.equal(tallies.cells[0].label, cellLabel({ name: 'Zulrah', kc: 1192, rank: 111737 }));
  assert.deepEqual(tallies.cells[0].detail, bossDetail({ name: 'Zulrah', kc: 1192, rank: 111737 }));
  assert.equal(tallies.cells[1].muted, true, 'a null rank arrives muted, never hidden');
  assert.equal(tallies.cells[1].figure, tally(null), 'a null tally arrives as the no-figure marker');
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
    statTracker,
    /\.stat-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/,
    'both stat tables must be three shrinkable columns'
  );
  assert.doesNotMatch(
    statTracker,
    /grid-auto-flow/,
    'a column flow is the sideways strip the owner replaced'
  );
  // The absence of overflow is the load-bearing pin, and it protects two
  // things at once: the table the owner asked not to scroll, and the tooltip
  // below, which an overflow ancestor would clip the moment one came back.
  assert.doesNotMatch(
    statTracker,
    /\.stat-grid\s*\{[^}]*overflow/,
    'an overflow on the stat table is a scroll region the owner removed and a clipping ancestor for the detail'
  );
  // The fill variant existed only to claim the retired rail's height; a card
  // in the stack grows to its content, so it must not come back.
  assert.doesNotMatch(shell, /panel-shell-fill/, 'the rail-filling variant must stay retired');
  // The detail moved OUT of this component (owner directive, 2026-08-24):
  // there is one hover-detail primitive, DetailTip, and both grids render
  // it. Its own pins — the fixed anchor, the viewport clamping that replaced
  // the per-column anchoring, the absent minimum width, the token layer —
  // live in tests/tooltip.test.mjs beside the arithmetic they guard, and the
  // browser lanes measure all of it at 320px. What stays pinned HERE is that
  // this component still delegates rather than growing its own again.
  assert.doesNotMatch(
    statTracker,
    /role="tooltip"|boss-tip|nth-child\(3n/,
    'the stat tracker grew a second tooltip implementation; there is one primitive and it is DetailTip'
  );
  // That the shared detail, the focusability it needs, and the accessible
  // name are on EVERY tile is pinned in tests/tooltip.test.mjs, which walks
  // the component's tile templates and asserts there are exactly two before
  // checking each one. Three whole-file `assert.match(statTracker, …)` copies
  // stood here and were strictly weaker: a single tile template carrying all
  // three satisfied them while the other carried none.
  // Data flows only through the shared layer and shell; the component knows
  // no panel, no slug and no name — the binding layer holds all three.
  assert.match(statTracker, /import PanelShell from '\.\/PanelShell\.svelte'/);
  assert.doesNotMatch(
    statTracker,
    /watchPanel|boss|skill|osrs|runelite|hiscore/i,
    'the component names its domain; names live in the adapter and the binding layer (issue 165)'
  );
  assert.match(osrsBinding, /bossLogPanelId/);
  assert.equal(bossLogPanelId, 'boss-log');
});

/* One fixture drive of the adapter, shared by the structural tests above and
 * below: the exact grids the retired component rendered, decided by the same
 * data. */
function osrsStatsFixture() {
  return osrsStatsProps(
    {
      schema: 'panel/v1',
      id: bossLogPanelId,
      kind: 'boss-log/v1',
      title: 'Fixture Stats',
      status: 'ok',
      data: {
        account: 'fixture',
        skills: [
          { name: 'Overall', level: 2274, rank: 138220, xp: 453846899 },
          { name: 'Attack', level: 99, rank: 124252, xp: 19794965 },
        ],
        bosses: [
          { name: 'Zulrah', kc: 1192, rank: 111737 },
          { name: 'Artio', kc: null, rank: null },
        ],
      },
    },
    {
      levels: new Map([['attack', '/assets/attack.png']]),
      tallies: new Map([['zulrah', '/assets/zulrah.png']]),
    }
  );
}

function osrsStatsTallies() {
  return osrsStatsFixture().grids[1];
}

// The owner reviewed the vendored boss art and locked it exactly as rendered
// (issue 127: "gorgeous… LOCK THOSE IN"). The layout around it changed in the
// same pass, which is precisely when a rendering detail gets adjusted by
// accident, so every part of how a tile is SOURCED and DRAWN is pinned here
// in one place: the file the slug selects, the declared box, the loading
// behavior, and the painted size.
test('the boss icons are locked exactly as they render', () => {
  // The tile declares its box, its lazy loading and its async decode; the
  // box is the grid scale's, stated once beside the scale decision.
  assert.match(
    statTracker,
    /<img\s+class="stat-icon"\s+src=\{cell\.icon\}\s+alt=""\s+width=\{iconSize\}\s+height=\{iconSize\}\s+loading="lazy"\s+decoding="async"/,
    'a tile icon declares its box, its lazy loading and its async decode'
  );
  assert.match(statTracker, /\{@const iconSize = grid\.size === 'compact' \? 18 : 26\}/);
  assert.match(
    statTracker,
    /\.stat-grid\[data-cells='roomy'\] \.stat-icon\s*\{[^}]*inline-size:\s*26px[^}]*block-size:\s*26px[^}]*object-fit:\s*contain/,
    'the painted tally-icon box is 26px square and never distorts the art inside it'
  );
  // The designed hole for a row that ships upstream before its art does.
  assert.match(statTracker, /<span class="stat-icon stat-glyph" aria-hidden="true">\{cell\.glyph\}<\/span>/);
  // WHICH art a row shows is the adapter's slug lookup, executed: a mapped
  // slug arrives as the icon URL, an unmapped row arrives as its initials.
  const tallies = osrsStatsTallies();
  assert.equal(tallies.cells[0].icon, '/assets/zulrah.png', 'a vendored icon is selected by slug');
  assert.equal(tallies.cells[1].icon, undefined, 'a row without art carries none');
  assert.equal(tallies.cells[1].glyph, bossInitials('Artio'), 'the initials fallback rides every cell');
});

// The skills grid is the half of the panel the payload always carried and
// nothing ever rendered: internal/panels parsed the hiscores skill table and
// then dropped it on the floor (issue #78).
test('the skills grid mirrors the reference panel and renders levels honestly', () => {
  assert.match(
    statTracker,
    /\.stat-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/,
    'the compact table must stay three columns that can shrink'
  );
  assert.match(
    statTracker,
    /\.stat-grid\[data-cells='compact'\] \.stat-cell\s*\{[^}]*block-size:\s*1\.625rem/,
    'compact cells need a fixed height (no CLS)'
  );
  // The levels grid is the adapter's, through the tested renderers, executed.
  const [levels] = osrsStatsFixture().grids;
  assert.equal(levels.size, 'compact');
  assert.equal(levels.label, 'Skill levels');
  assert.equal(levels.cells[1].figure, tally(99), 'levels must go through the tested renderer');
  assert.equal(
    levels.cells[1].label,
    skillLabel({ name: 'Attack', level: 99, rank: 124252, xp: 19794965 })
  );
  assert.deepEqual(
    levels.cells[1].detail,
    skillDetail({ name: 'Attack', level: 99, rank: 124252, xp: 19794965 })
  );
  assert.equal(levels.cells[1].icon, '/assets/attack.png', 'a level icon is selected by the same slug rule');
  // The totals are cells of the same grid, keyed and labelled like the rest,
  // so the last row ends flush instead of trailing two blank tiles.
  assert.match(statTracker, /\{#each grid\.closing \?\? \[\] as cell \(cell\.key\)\}/);
  assert.match(statTracker, /<li class="stat-cell stat-closing" tabindex="0" aria-label=\{cell\.label\}>/);
  const summary = skillSummary([{ name: 'Overall', level: 2274, rank: 138220, xp: 453846899 }]);
  assert.deepEqual(
    levels.closing.map((cell) => [cell.caption, cell.figure, cell.label]),
    summary.map((cell) => [cell.label, cell.value, summaryLabel(cell)]),
    'the closing cells are the payload totals through the tested builders'
  );
  assert.deepEqual(levels.closing.map((cell) => cell.detail), summary.map((cell) => summaryDetail(cell)));
  // One line, whatever the width: a wrapped nine-digit figure in a 1.625rem
  // cell spills over the row below it.
  assert.match(statTracker, /\.stat-closing\s*\{[^}]*white-space:\s*nowrap/);
  // A payload with no skill table says so; it never renders an empty grid
  // that reads as "this account has no levels". The words are the adapter's,
  // the empty-note branch the component's.
  assert.equal(bossLogEmptySkillsNote, 'No skill levels reported.');
  assert.equal(levels.emptyNote, bossLogEmptySkillsNote);
  assert.match(statTracker, /\{:else\}\s*<p class="stat-note">\{grid\.emptyNote\}<\/p>/);
  // The levels are right-aligned digits in tabular figures, like the counts.
  assert.match(statTracker, /\.stat-figure\s*\{[^}]*text-align:\s*right/);
  assert.match(statTracker, /\.stat-figure\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
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
  // ships new content without asking: the adapter hands every row its
  // initials, and the fixture's unmapped rows arrive glyph-first.
  const { grids } = osrsStatsFixture();
  assert.equal(grids[0].cells[0].glyph, bossInitials('Overall'));
  assert.equal(grids[1].cells[1].glyph, bossInitials('Artio'));
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
  // The adapter renders whatever the envelope carries. A hardcoded heading
  // would render the same page today and make the config data a lie —
  // EXECUTED both ways: the origin's title wins, and only its absence (or
  // the unavailable fallback's empty title) reads the neutral name.
  assert.equal(
    vcsActivityProps({
      schema: 'panel/v1',
      id: 'vcs-activity',
      kind: 'vcs-activity/v1',
      title: 'GitHub',
      status: 'ok',
      data: null
    }).title,
    'GitHub'
  );
  assert.equal(vcsActivityProps(null).title, 'Version-control activity');
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
  // The subscription lives in the ONE block host now (issue 165), so a panel
  // cannot even grow a one-shot read of its own: the host watches, re-runs
  // the adapter on every delivery, and the components read no wire at all.
  assert.match(blockHost, /watchPanel\(block\.binding\.panelId/, 'the block host no longer keeps panels current');
  assert.doesNotMatch(
    blockHost,
    /\bloadPanel\b/,
    'the block host reads an envelope directly; the one-shot read is the bug'
  );
  for (const [name, source] of Object.entries({ statTracker, activityTracker, usageTracker })) {
    assert.doesNotMatch(
      source,
      /\bloadPanel\b|\bwatchPanel\b|\bfetch\(/,
      `${name} reads the wire itself; the block host owns the subscription`
    );
  }
  // And every tracker block is a panel binding, so all three ride that host.
  for (const [name, source] of Object.entries({
    osrsBinding,
    vcsBinding: bindingSourceCache.vcs,
    usageBinding: bindingSourceCache.usage,
  })) {
    assert.match(source, /panelBlock\(/, `${name} no longer binds through the panel host`);
  }
});

test('the contribution grid is one component both panels render', () => {
  assert.match(usageTracker, /import ContributionGrid from '\.\/ContributionGrid\.svelte'/);
  // A wide window scrolls inside the strip, so it never takes the page's own
  // scrollbar sideways. The strip's BOX — the term-by-term calc() that keeps
  // an arriving series from moving the page — is pinned in
  // tests/activity.test.mjs, which parses the declaration and checks each
  // term. A `block-size: 7rem` pin lived here until this commit and had been
  // vacuous since issue 130 replaced that literal with the calc(): every
  // `7rem` left in the component is inside a comment, and the one this
  // matched is the comment recording that `block-size: 7rem` was REMOVED.
  assert.match(grid, /overflow-x:\s*auto/);
  // The ramp's five themable levels AND their validated dark defaults are
  // pinned together in tests/activity.test.mjs, which matches
  // `var(--grid-cell-N, #hex)` — strictly stronger than the bare
  // `--grid-cell-N` sweep that stood here, and mutation-tested there.
  // Never color alone, and a day outside the window is a hole, not a zero.
  assert.match(grid, /aria-label=\{cellLabel\(cell, noun, view, formatValue\)\}/);
  // THE BROWSER TOOLTIP IS GONE, AND ITS ABSENCE IS THE PIN (issue 219).
  // `title=` used to carry every calendar cell's reading and 96% of the token
  // strip's. It has NO touch trigger in any engine, so on a phone those cells
  // said nothing at all — a heatmap encodes magnitude as colour alone, which
  // is precisely what AGENTS.md's dataviz floor forbids. This assertion is
  // strictly stronger than the `title={text}` it replaces: that one admitted
  // any accompanying detail, this one makes the browser tooltip
  // unrepresentable on a grid cell. (The month axis keeps its own `title=` —
  // it is a label, not a datapoint — so the sweep is scoped to the cell.)
  const cellMarkup = grid.slice(grid.indexOf('<div class="grid-cells"'));
  assert.doesNotMatch(
    cellMarkup.slice(0, cellMarkup.indexOf('</div>')),
    /\stitle=/,
    'a grid cell carries the browser tooltip again; it has no touch trigger and no reading on a phone'
  );
  assert.match(grid, /data-grid-absent=\{cell\.absent \? 'true' : 'false'\}/);
});

// Full width (issue #178, extended to both grids by the owner on 2026-08-25)
// and the OSRS-style card (issue #178). The daily heatmap used to render as a
// tiny left-aligned block, and its value popover was a bare title= tooltip
// reading "1,025,755,735 tokens on 2026-08-22" — a log line, not a designed
// readout. The calendar was left content-sized then, on the argument that it
// genuinely has a year of columns to show; the owner reports the same dead gap
// on it and wants the same stretch, so BOTH callers opt in now. The hover card
// stays the token panel's alone: a commit count needs no designed readout.
test('both panels opt the shared grid into full width; only the token panel takes the card', () => {
  assert.match(
    usageTracker,
    /<ContributionGrid[\s\S]*?fullWidth[\s\S]*?\/>/,
    'the token panel does not opt the grid into full width'
  );
  assert.match(
    usageTracker,
    /<ContributionGrid[\s\S]*?cardTitle="Tokens used"[\s\S]*?\/>/,
    'the token panel does not name the hover card'
  );
  assert.match(
    activityTracker,
    /<ContributionGrid[\s\S]*?fullWidth[\s\S]*?\/>/,
    'the version-control calendar stopped filling its card'
  );
  // THE CALENDAR TAKES THE CARD NOW, and the reversal is the fix of issue
  // 219. It was left on the browser's native `title=` on the argument that
  // the card was the token panel's own flourish. MEASURED on an iPhone at the
  // build before this one: 0 of the calendar's 371 cells carried a readout a
  // finger could open, because `title=` has no touch trigger — the calendar
  // was not "less decorated", it was mute. What stays optional is the card's
  // TITLE, not the card: a caller that names none falls back to its own noun
  // (nounTitle), so the calendar reads "Contribution" without either panel
  // spelling a word the adapter already owns.
  // The calendar names no card title and does not need to: the fallback reads
  // its own noun. What it must NOT do is go back to being the caller that
  // opts out, so the pin is on the shared component's fallback rather than on
  // this caller's silence — silence is now the default that WORKS.
  assert.match(grid, /name: cardTitle \?\? nounTitle\(noun\)/);

  // The shared component: both remain props rather than becoming its only
  // behaviour, so how many columns there are (the caller's data) and whether
  // the block stretches (the caller's layout) stay separate questions.
  assert.match(grid, /fullWidth\?: boolean/);
  assert.match(grid, /cardTitle\?: string/);
  assert.match(grid, /data-grid-fullwidth=\{fullWidth\}/);
  // THE GATE IS GONE — the one line this test used to pin as correct.
  // `{#if cardTitle && !cell.absent}` was two independent holes, and both
  // consumers of the shared grid fell through at least one: the calendar
  // passed no cardTitle (0 of 371 cells readable), and the token strip's
  // absent cells failed the second condition (15 of 371 readable). Pinning
  // its ABSENCE is what stops the opt-in coming back as a convenience.
  assert.doesNotMatch(
    grid,
    /\{#if cardTitle/,
    'the detail is gated on a prop again; every cell of every grid carries it'
  );
  assert.match(grid, /import DetailTip from '\.\/DetailTip\.svelte'/);
  // One card per STRIP, not per cell, and the strip resolves which cell a
  // point names. 371 cells at 10x10px cannot each own a tip — that is ~4400
  // extra elements per grid for a readout one cell shows at a time, and a
  // 10px target is far under the 44px touch floor either way, so per-cell
  // tips would not even fix the defect.
  assert.match(grid, /host=\{strip\}/);
  assert.match(grid, /resolve=\{resolveCell\}/);
  assert.match(grid, /select=\{noteSelection\}/);
  assert.match(grid, /anchor=\{anchorElement\}/);
  // Every cell is a selectable option with an honest accessible name, absent
  // ones included: "no data for this day" is information a reader can reach,
  // and a grid silent for 96% of its cells was the defect.
  assert.match(grid, /role="option"/);
  assert.match(grid, /aria-selected=\{selected === index\}/);
  assert.match(
    grid,
    /aria-activedescendant=\{selected >= 0 \? `\$\{gridId\}-cell-\$\{selected\}` : undefined\}/
  );
  // The card shows the value AND the view-scoped period phrase (issue 189,
  // amending the earlier value-only decision from #178 to match the owner's
  // reference designs — "2.8B tokens on Aug 13" is a value plus a period,
  // not a value alone). Both rows stay label-less, mirroring BossLog's own
  // DetailTip usage; cellPeriod is the ONE function that phrase comes from,
  // so this card and cellLabel's own accessible text can never drift apart.
  //
  // The value is written by the CALLER's formatter (owner directive,
  // 2026-08-25), which is the whole of the magnitude fix: the same function
  // formats the card and the accessible text below, so a cell can never show
  // "627.7M" while its aria-label reads nine raw digits, and the calendar —
  // which passes none — keeps the exact counts a reader of commits wants.
  // The value row now branches on absence rather than being unreachable for
  // it: an absent cell reads "no data" beside the day it had none, which is
  // the same sentence cellLabel has always produced for the accessible name.
  // A fabricated zero there would be the doctrine violation the panels
  // contract names; refusing to render the cell at all was the defect.
  assert.match(
    grid,
    /value: selectedCell\.absent \? 'no data' : formatValue\(selectedCell\.value\)/
  );
  assert.match(grid, /\{ label: '', value: cellPeriod\(selectedCell, view\) \}/);
  assert.match(grid, /formatValue = formatWhole/, 'the shared grid defaults to anything but exact digits');
  assert.match(
    usageTracker,
    /<ContributionGrid[\s\S]*?formatValue=\{formatMagnitude\}[\s\S]*?\/>/,
    'the token panel renders nine-digit cells with exact digits again'
  );
  assert.doesNotMatch(
    activityTracker,
    /formatValue/,
    'the contribution calendar compacted counts a reader wants exactly'
  );
});

/* One lens PER SOURCE (owner directive, 2026-08-25).
 *
 * The panel held a single `view` for every source in it, on the argument that
 * two series read side by side should not be compared through different
 * lenses. The owner reversed that after using the page: each source renders
 * its own graph with its own toggle over it, and pressing one re-read the
 * other — a control beside one graph that changes a different graph.
 *
 * Source-pinned here, because the state machine is a component's and there is
 * no DOM in this runner; the BEHAVIOUR — press one, watch the other stay put —
 * is measured in a real engine by e2e/rendering-lanes.spec.mjs. */
test('each usage source keeps its own lens, and the shared one cannot come back', () => {
  assert.match(usageTracker, /let views = \$state<Record<string, SeriesView>>\(\{\}\);/);
  assert.match(usageTracker, /return views\[key\] \?\? 'daily';/, 'a source nobody has pressed no longer reads daily');
  assert.match(usageTracker, /\{@const view = viewOf\(source\.key\)\}/);
  assert.match(usageTracker, /onclick=\{\(\) => \(views\[source\.key\] = candidate\)\}/);
  // Keyed by the source rather than parked in a child instance, so a refresh
  // that rebuilds every section does not reset the reader's lens to daily.
  assert.match(usageTracker, /source\.key/);
  // The retired single-panel lens, in both the state and the write.
  assert.doesNotMatch(usageTracker, /let view = \$state/, 'the panel-wide lens is back');
  assert.doesNotMatch(usageTracker, /\(view = candidate\)/, 'a toggle writes the panel-wide lens again');
  // The audible half: each group names its own source, so a screen reader
  // hears which graph it belongs to instead of three identical groups.
  assert.match(
    usageTracker,
    /aria-label=\{`\$\{source\.label\} \$\{source\.activity\.heading\} view`\}/
  );
  // And the grid still reads the SAME lens the toggle above it wrote.
  assert.match(usageTracker, /const columns = viewColumns\(windowed, view\)/);
  assert.match(usageTracker, /<ContributionGrid\s+\{columns\}[\s\S]*?\{view\}/);

  /* The CATEGORY lens (issue #142) is a second toggle over the same graph,
     and it is held to this test's rule rather than exempted from it: the
     owner's ruling is about a control beside one graph changing a different
     graph, which says nothing about WHICH control. So the category lens is
     per-source state keyed the same way, its default reads total for a
     source nobody has pressed, its write is keyed by the source, its
     radiogroup names its own source aloud, and the third argument the WINDOW
     step now takes is resolved from that same per-source key — not from a
     panel-wide choice reintroduced beside the retired one.

     That third argument sits on windowedColumns rather than on the view step
     deliberately (issue 158 composition): the category lens chooses WHICH
     series is read, so it has to apply before the window is cut and before
     the view aggregates, which is also what makes the readings below —
     taken from those same windowed cells — describe the lens the reader
     actually pressed. */
  assert.match(usageTracker, /let lenses = \$state<Record<string, string>>\(\{\}\);/);
  assert.match(
    usageTracker,
    /return lenses\[key\] \?\? totalLens;/,
    'a source nobody has pressed no longer reads the total'
  );
  assert.match(
    usageTracker,
    /\{@const lensCategory = activeLensCategory\(source\.activity, lensOf\(source\.key\)\)\}/
  );
  assert.match(
    usageTracker,
    /\{@const windowed = windowedColumns\(source\.activity, range, lensCategory\)\}/,
    'the window no longer reads the source’s own category lens'
  );

  /* The lookup ITSELF, and the fallback it feeds. These two lines are the
     whole of lens resolution on this page — an adapter-side resolver helper
     was deleted as dead code (coordinator ruling, 2026-08-26) rather than
     wired in beside them, so the behaviour its suite pinned is pinned here,
     where it actually happens.

     Three inputs reach the plain series, and all three are in these lines:
     the total sentinel, a source whose payload carries no breakdown at all,
     and a stale or unknown key that `find` cannot match. None of them is a
     zero and none is a guess — every one of them draws real delivered
     totals. */
  assert.match(
    usageTracker,
    /if \(lens === totalLens \|\| !activity\.categories\) \{\s*return undefined;\s*\}/,
    'the total sentinel and the breakdown-less series no longer fall back to the plain totals'
  );
  assert.match(
    usageTracker,
    /return activity\.categories\.find\(\(category\) => category\.key === lens\);/,
    'an unreported lens key no longer resolves to nothing and falls back'
  );
  assert.match(
    usageTracker,
    /const totals = category \? category\.totals : activity\.series\.totals;/,
    'the window stopped falling back to the plain series'
  );
  assert.match(usageTracker, /onclick=\{\(\) => \(lenses\[source\.key\] = category\.key\)\}/);
  assert.match(usageTracker, /onclick=\{\(\) => \(lenses\[source\.key\] = totalLens\)\}/);
  assert.doesNotMatch(usageTracker, /let lens = \$state/, 'a panel-wide category lens is back');
  assert.match(
    usageTracker,
    /aria-label=\{`\$\{source\.label\} \$\{source\.activity\.noun\} category`\}/
  );

  /* And the sentinel those assertions read is stated ONCE, here, in the only
     file that decides anything with it. The adapter used to export a copy of
     it beside a lens resolver nothing called; both were deleted rather than
     wired in, so there is no second statement of "no category" left to drift
     from this one. */
  assert.match(usageTracker, /const totalLens = 'total';/);
  assert.equal(usageTracker.match(/const totalLens =/g).length, 1, 'the sentinel is stated twice');
});

/* One RANGE per source too (issue 158), held exactly like the lens beside it.
 *
 * The two are separate controls because they answer separate questions — how
 * a day is READ, and how much history is DRAWN — and a single list of seven
 * options would make "monthly" and "90d" alternatives, which they are not.
 *
 * Source-pinned here for the same reason the lens is; the behaviour is
 * measured in a real engine by e2e/rendering-lanes.spec.mjs. */
test('each usage source keeps its own range, defaulting to the window the strip already drew', () => {
  assert.match(usageTracker, /let ranges = \$state<Record<string, SeriesRange>>\(\{\}\);/);
  assert.match(
    usageTracker,
    /return ranges\[key\] \?\? defaultSeriesRange;/,
    'a source nobody has pressed must open on the shipped default range'
  );
  assert.match(usageTracker, /\{@const range = rangeOf\(source\.key\)\}/);
  assert.match(usageTracker, /onclick=\{\(\) => \(ranges\[source\.key\] = candidate\)\}/);
  // Its own group, named for its own source AND its own question, so a reader
  // on a screen reader hears four distinguishable groups on a two-source card
  // rather than four identical ones.
  assert.match(
    usageTracker,
    /aria-label=\{`\$\{source\.label\} \$\{source\.activity\.heading\} range`\}/
  );
  // The graph's own accessible name carries BOTH choices, so an assistive
  // reading of the strip says which lens and which window it is looking at —
  // the same reason the lens was folded into that label to begin with.
  assert.match(usageTracker, /\$\{view\} view, \$\{range\} range/);
  // Both readings under the strip are taken from the WINDOWED cells, never
  // from the lens' output (which repeats one aggregate across every day it
  // covers) and never from the whole payload behind the window.
  //
  // The reading's NOUN is the category lens's when one is pressed and the
  // region's otherwise — the only thing that lens contributes to the sentence,
  // because those windowed cells already carry its dailies. Pinned as one
  // expression so a future edit cannot quietly go back to reading a
  // sentence the adapter built.
  assert.match(
    usageTracker,
    /activityReading\(\s*windowed,\s*lensCategory \? lensCategory\.noun : source\.activity\.noun,\s*formatMagnitude\s*\)/
  );
  assert.match(usageTracker, /coverageReading\(windowed\)/);
  // The retired adapter-built sentences, which described the whole series and
  // could not know which window a reader had chosen — in BOTH their forms, the
  // region's and the per-category one the lens work briefly carried.
  assert.doesNotMatch(usageTracker, /source\.activity\.summary/, 'the window-blind summary is back');
  assert.doesNotMatch(usageTracker, /lensCategory\.summary/, 'the window-blind category summary is back');
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
  /* And the SAME rule for the second scroll this component performs (issue
     219 review round 2): the keyboard cursor is brought into its scrollport
     on every move, which is a scroll on a reader's own key press and is
     therefore exactly the place an unasked-for animation would appear. The
     option is REQUIRED rather than left to the default, because the default
     resolves to whatever scrolling mode the stylesheet gives the element —
     so an omitted option is a reduced-motion promise held by a file that
     cannot see the one that would break it. Every call is checked, not the
     first, so a second one added later inherits the rule. */
  const reveals = [...grid.matchAll(/scrollIntoView\(([^)]*)\)/g)];
  assert.ok(reveals.length > 0, 'nothing scrolls the keyboard cursor into view any more');
  for (const [call, options] of reveals) {
    assert.match(
      options,
      /behavior:\s*'instant'/,
      `${call} leaves its scrolling mode to the stylesheet; a cursor step is never animated`
    );
    // `nearest` on both axes, or a cursor step drags the page and the strip
    // to centre a cell that was already perfectly visible.
    assert.match(options, /block:\s*'nearest'/, `${call} does not leave a visible cell alone`);
    assert.match(options, /inline:\s*'nearest'/, `${call} does not leave a visible cell alone`);
  }
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
    /\{#if columns\.length > 0\}\s*<section class="usage-activity">([\s\S]*?)<\/section>\s*\{\/if\}/.exec(
      usageTracker
    );
  assert.ok(region, 'the graph region is no longer gated on there being columns to draw');
  // The gate reads the SAME columns the grid is handed, so the two can never
  // disagree about whether this source has a graph.
  assert.match(
    region[1],
    /<ContributionGrid\s+\{columns\}/,
    'the gate and the graph read different things'
  );
  // The heading and the lens toggle are inside the gate with it: an activity
  // heading over a toggle with nothing to toggle is the same hole wearing
  // different markup.
  assert.match(region[1], /\{source\.activity\.heading\}/, 'the heading survived its graph');
  assert.match(region[1], /role="radiogroup"/, 'the lens toggle survived its series');
  // And the panel never asks the shared component for its empty treatment.
  assert.doesNotMatch(usageTracker, /emptyNote=/, 'the panel asks for an empty grid again');
  assert.doesNotMatch(usageTracker, /series pending/, 'the retired "pending" claim is back');
  assert.doesNotMatch(usageTracker, /pendingColumns/, 'the panel reaches for placeholder columns');
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
  assert.match(activityTracker, /emptyNote=/, 'the calendar stopped labelling its waiting state');
  // The retired sentence must not come back anywhere.
  for (const [name, source] of Object.entries({ grid, usageTracker, activityTracker })) {
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
    statTracker,
    panelsSource,
    iconsSource,
    grid,
    gridSource,
    activityTracker,
    usageTracker,
    blockHost,
    pageSection,
    manifest,
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
  // The adapter is the only code that touches the payload, and it never
  // reads the account field; the component could not name it if it tried.
  const helpers = bossLogHelperSource;
  assert.doesNotMatch(
    helpers,
    /\.account\b/,
    'the account name reaches a rendering again; a label read aloud is still displayed'
  );
  assert.doesNotMatch(statTracker, /account|panelSummary/, 'the account subtitle came back');
  // The grids keep accessible names — losing the account must not cost a
  // screen reader the ability to tell the two tables apart. The names are
  // adapter data on the one grid template.
  assert.match(statTracker, /<ul class="stat-grid" data-cells=\{grid\.size\} aria-label=\{grid\.label\}>/);
  const { grids } = osrsStatsFixture();
  assert.deepEqual(grids.map((grid) => grid.label), ['Skill levels', 'Boss tallies']);
  // And the tally table is no longer a focus stop. The tabindex it used to
  // carry existed because a scrollable box is keyboard-reachable only when
  // focusable; with the scroll region gone (issue 134) it is a tab stop that
  // does nothing, which costs every keyboard reader a press for no action.
  assert.doesNotMatch(
    statTracker,
    /<ul class="stat-grid"[^>]*tabindex/,
    'the stat tables are not scroll regions, so they must not be focus stops either'
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

// One numeric contract, three languages (2026-08-24 round-3 review finding
// 9). A token count is produced by a Python capture tool, summed and served
// by a Go origin, and admitted by this frontend, and every stage bounds it
// at the SAME number: 2^53 - 1, the largest integer JavaScript represents
// exactly. The bound is not arbitrary and it is not a JavaScript quirk being
// pushed upstream — it is the point past which the three stages stop
// agreeing about what a value IS. Go would keep counting in int64 and
// Python in unbounded ints, and the number that arrives here would be a
// nearby float wearing the same JSON text. Bounding at the narrowest stage
// means every value that survives one stage means the identical thing in
// the next.
//
// The pin compares by VALUE, not by spelling, because the three declare it
// three ways that no textual match could reconcile: Go writes the shift
// expression, Python writes the power, and TypeScript names the built-in
// constant. Each side is evaluated the way its own language would.
test('the count bound is the same number in Go, Python and TypeScript', {
  skip: reducedContextNote,
}, async () => {
  const exact = Number.MAX_SAFE_INTEGER;

  const goSource = await read('../../internal/panels/types.go');
  const goDeclared = /maxCountValue\s*=\s*1<<(\d+)\s*-\s*1/.exec(goSource);
  assert.ok(goDeclared, 'maxCountValue is not declared in internal/panels/types.go where this pin expects it');
  assert.equal(2 ** Number(goDeclared[1]) - 1, exact, 'the Go count bound has drifted from the shared ceiling');

  const pySource = await read('../../scripts/capture_usage_series.py');
  const pyDeclared = /^MAX_COUNT\s*=\s*2\s*\*\*\s*(\d+)\s*-\s*1\s*$/m.exec(pySource);
  assert.ok(pyDeclared, 'MAX_COUNT is not declared in scripts/capture_usage_series.py where this pin expects it');
  assert.equal(2 ** Number(pyDeclared[1]) - 1, exact, 'the Python count bound has drifted from the shared ceiling');

  const tsSource = await read('../src/lib/token-usage.ts');
  assert.match(
    tsSource,
    /export const countBound = Number\.MAX_SAFE_INTEGER;/,
    'the frontend no longer names the shared ceiling; the parity pin has nothing to compare'
  );
  assert.match(
    tsSource,
    /function isCount\(value: unknown\): value is number \{\s*return typeof value === 'number' && Number\.isSafeInteger\(value\) && value >= 0;/,
    'frontend count admission no longer enforces the shared ceiling'
  );
});
