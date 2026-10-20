import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { bossInitials, bossSlug } from '../src/lib/bossIcons.ts';
import {
  bossDetail,
  bossLogFallbackTitle,
  bossLogLoadingNote,
  bossLogPanelId,
  bossLogStripLabel,
  bossLogUnavailableNote,
  bossTickerProps,
  cellLabel,
  noTally,
  rankLabel,
  tally,
  unrankedLabel,
} from '../src/lib/bossLog.ts';
import { contributionCalendarProps } from '../src/lib/commits.ts';
import { gridLevel, gridLevels } from '../src/lib/grid.ts';
import { unavailablePanel } from '../src/lib/panels.ts';
import { projects } from '../src/lib/projects.ts';

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
// frontend tree plus the few repo files the build DECLARES as inputs
// (Dockerfile: COPY frontend/ ./, plus the two vocabulary files), so
// the rest of the repository does not exist there. The cross-tree pins below
// are therefore capability-gated exactly like the provider-neutrality pin: in
// a full checkout — the PR gate's application job, every local run — they are
// mandatory and a missing file fails loudly; in the reduced build context
// they skip by name. The gate condition probes a TREE, never a file under
// pin, so deleting a pinned file can never turn into a silent skip.
//
// It probes the snapshots tree rather than the package directory, and issue
// #302 is why: the frontend stage now carries one data file under
// internal/panels/config/, so the package directory exists in BOTH contexts
// and stopped telling them apart — the pins then ran in the image and failed
// on the Go sources that are genuinely not there. A probe that cannot
// distinguish the two contexts is worse than no probe, because it turns a
// capability boundary into a red build nobody can act on.
const fullCheckout = existsSync(new URL('../../internal/panels/snapshots', import.meta.url));
const reducedContextNote = fullCheckout
  ? false
  : 'reduced build context ships only frontend/; the full-checkout gate enforces this pin';

const [
  app,
  shell,
  fallbackShell,
  ticker,
  panelsSource,
  iconsSource,
  viteConfig,
  gridSource,
  chronicle,
  styles,
  detailTip,
  manifest,
  pageSection,
  blockHost,
  bossBinding,
] = await Promise.all([
  read('../src/App.svelte'),
  read('../src/lib/components/PanelShell.svelte'),
  read('../index.html'),
  read('../src/lib/components/Ticker.svelte'),
  read('../src/lib/panels.ts'),
  read('../src/lib/bossIcons.ts'),
  read('../vite.config.ts'),
  read('../src/lib/grid.ts'),
  read('../src/lib/components/Chronicle.svelte'),
  read('../src/styles.css'),
  read('../src/lib/components/DetailTip.svelte'),
  read('../src/page.ts'),
  read('../src/lib/components/PageSection.svelte'),
  read('../src/lib/components/Block.svelte'),
  read('../src/lib/blocks/bossTicker.ts'),
]);

/* The sheet's paired section (owner design decision, 2026-09-11, issue 318):
 * the component that draws the repositories table beside the commit log. */
const ledgerSpread = await read('../src/lib/components/LedgerSpread.svelte');

/* The multi-panel binding modules, read beside the one above so the
 * stays-current pin can sweep every panel binding. */
const bindingSourceCache = {
  projects: await read('../src/lib/blocks/projectsCommits.ts'),
  chronicle: await read('../src/lib/blocks/trackerChronicle.ts'),
};

/* The adapter module beside the boss-log data, for the account-privacy pin. */
const bossLogHelperSource = await read('../src/lib/bossLog.ts');

/* The composite adapter behind the commits section, for the shared-window pin
 * below: it is the one place the three calendars are laid onto one anchor. */
const commitsAdapter = await read('../src/lib/commits.ts');

// Like the experience suite, these are structural regex pins over source:
// they hold the shapes the owner specified — chrome values, grid density,
// fail-soft rendering — while leaving copy and styling free to evolve.
test('the manifest mounts exactly the three tracker blocks, in the stacked order', () => {
  /* The fences retired with the table-of-contents App (issue 165): the
     manifest IS the mount list, one ordered entry per block, and the page
     renders it verbatim.

     The section holds THREE blocks again (owner design decision, 2026-09-11,
     issue 318): the calendar left for its own COMMITS section at issue 287 and
     has come back between the board and the ticker, because a year of daily
     counts a reader cycles between three sources is exactly what the two
     around it are — a tracker. The owner named the order: the token cards,
     then the calendar, then the game ticker.

     And TWO blocks now (owner direction, 2026-10-16): the token cards and
     the calendar are drawn as ONE diagram on one timeline — the chronicle —
     and the game ticker stays a scrolling strip under it. */
  assert.match(
    manifest,
    /section\('trackers', 'Trackers', \[trackerChronicle, bossTicker\], \{\s*mark: '[a-z-]+',\s*layout: 'stack'\s*\}\)/,
    'the trackers section must list exactly one entry per panel, in the order the page stacks them'
  );
  // ...and the chronicle is mounted exactly once, here and nowhere else.
  const mounts = manifest.slice(manifest.indexOf('export const page'));
  assert.equal(
    (mounts.match(/trackerChronicle/g) ?? []).length,
    1,
    'the chronicle block is mounted more than once, or not at all'
  );
  assert.doesNotMatch(
    manifest,
    /section\('commits'/,
    'the commits section came back; the sheet pairs it with Projects now (issue 318)'
  );
  // The page renders the manifest rather than spelling its own copy of it. The
  // ordinal it passes is the manifest's own position, so a section moved there
  // renumbers itself (owner directive, 2026-09-03, issue 287) — through the
  // shared rule in lib/blocks.ts, because the nav prints the same number now
  // (owner design decision, 2026-09-11, issue 313) and two copies of a
  // numbering rule is how one sheet ends up numbered two ways.
  assert.match(app, /import \{ page \} from '\.\/page\.ts'/);
  assert.match(
    app,
    /\{#each page as section, position \(section\.id\)\}\s*<PageSection \{section\} ordinal=\{sectionOrdinal\(position\)\} \/>\s*\{\/each\}/
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
  for (const [name, source] of Object.entries({ app, styles, chronicle, ticker, pageSection })) {
    assert.doesNotMatch(source, /data-rail-open|--page-rail-gutter|--panel-rail-|SideRail/, `${name} still references the retired rail`);
  }
  // The stack owns the column width and the gap; panels own neither, so a
  // panel added later cannot pick a width that disagrees with its siblings.
  // The stack renders in PageSection, behind the manifest's one stack layout.
  // The stack also STATES how many blocks it holds (issue 210): a panel-bound
  // block renders nothing until its envelope arrives, so the gap between this
  // number and the child count is the page's own "still arriving" answer, and
  // the rendering lanes settle on it instead of on a height that paused.
  assert.match(pageSection, /\{#if section\.layout === 'stack'\}(?:\s*<!--[\s\S]*?-->)?\s*<div class="panel-stack" data-block-count=\{section\.blocks\.length\}>/);
  assert.match(styles, /\.panel-stack\s*\{[^}]*display:\s*grid/);
  assert.match(styles, /\.panel-stack\s*\{[^}]*gap:\s*var\(--page-stack-gap\)/);
  /* The header shared this rule from issue 287 (owner directive, 2026-09-03)
     until the chrome row was removed (owner direction, 2026-10-16: "do away
     with it for now"); the column is the one box it sizes again. */
  assert.match(
    styles,
    /#app > main \{[^}]*inline-size:\s*min\(var\(--page-column-width\), 100%\)/
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
  assert.equal(bossTickerProps(null, new Map()).emptyNote, bossLogLoadingNote);
  assert.equal(bossLogUnavailableNote, 'Boss data is unavailable right now.');
  // A failed read's fail-soft envelope carries no title (issue 285): the
  // face it produces keeps this panel's heading rather than rendering a
  // headless line — the only face of the boss log that read as "not rendered".
  const failed = bossTickerProps(unavailablePanel(bossLogPanelId), new Map());
  assert.equal(failed.title, bossLogFallbackTitle);
  assert.equal(failed.emptyNote, bossLogUnavailableNote);
  assert.equal(failed.status, 'unavailable');
  assert.match(ticker, /\{#if items\.length === 0\}\s*<p class="ticker-note">\{emptyNote\}<\/p>/);
  /* The log's own honest empty line moved with the log (owner design decision,
     2026-09-11, issue 318): the rows are the sheet's right-hand column now, so
     the note that stands in for them is rendered there, from the same adapter
     word — one note class for both columns since the section became two-line
     entries (owner direction, 2026-10-16). */
  assert.match(ledgerSpread, /<p class="ongoing-note">\{logNote\}<\/p>/);
  assert.match(ledgerSpread, /<p class="ongoing-note">\{emptyNote\}<\/p>/);
  assert.match(chronicle, /<p class="chronicle-note">\{emptyNote\}<\/p>/);
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
    ticker,
    chronicle,
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
// reading mode in the header's corner (issue 127); the reading mode has since
// left with the footer (owner, 2026-10-19), the sky's toggle that followed it
// went the same day ("do away with this all together"), so the page's chrome
// carries no control at all, and nothing the refresh left behind survives as
// reachable code.
test('the refresh control is gone, and nothing it owned survives as dead code', async () => {
  assert.equal(
    existsSync(new URL('../src/lib/components/RefreshAll.svelte', import.meta.url)),
    false,
    'the refresh component must not come back'
  );
  /* What issue 179 decided is that the page's own chrome carries no refresh
     ACTION. That chrome was the header row until the owner removed it (owner
     direction, 2026-10-16: "do away with it for now"), then the footer, which
     the owner removed too (2026-10-19), and with it every control the
     chrome had — so the page shell declares no button of its own at all. */
  assert.equal(
    (app.match(/<button/g) ?? []).length,
    0,
    'the page shell declares a button of its own again; its chrome carries no control'
  );
  assert.doesNotMatch(app, /RefreshAll/, 'the refresh must not head the panel stack again either');
  // THE FAN-OUT EXISTS ONLY WITH A CALLER — that condition is the pin, in
  // both directions. It was deleted at issue 179 because the only thing
  // invoking it was the button that had just been removed, and a fan-out
  // nothing fans out to is dead code; issue 219 brought it back with a
  // caller (the pull-to-refresh gesture), and issue 294 removed that gesture
  // by owner ruling — and the fan-out with it, which is the branch below
  // that now holds. The rule is "this must not exist WITHOUT a caller", which
  // is the property issue 179 actually wanted and is strictly harder to
  // satisfy by accident: a fan-out re-exported with nothing calling it goes
  // red, and a component calling one panels.ts no longer exports goes red.
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
  /* THE EXCEPTION IS GONE (owner directive, 2026-09-03, issue 287). Issue 168
     put one piece of chrome back over the document — the reading-mode control,
     pinned to the viewport corner — and this pin was narrowed to carve its
     rule out before sweeping. The ledger's chrome is a row IN the flow, so
     there is nothing left to carve out and the sweep is over the whole
     stylesheet again: strictly stronger than it was, and the shape the
     original pin had before the exception existed. */
  const stylesWithoutHeader = styles;
  // styles.css is in this sweep deliberately and is the load-bearing entry:
  // most page chrome's rule lives THERE, not in a component, so a scan of
  // components alone would let the exact drift this test is named for return
  // with the suite green.
  for (const [name, source] of Object.entries({
    app,
    chronicle,
    ticker,
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
  /* ONE narrow, named exception, stated here where the owner will read it.

     The page header used to be the other one (issue 168) and is not any more:
     the ledger made it a row in the document's own flow (owner directive,
     2026-09-03, issue 287), and the row itself is gone now (owner direction,
     2026-10-16) — the page shell that replaced it is swept by the loop above
     like everything else and needs no carve-out. That is the stricter
     direction — the exception list shrank rather than grew.

     What survives from the pair: the detail card (DetailTip) is fixed on
     purpose and always has been — it is a readout, not chrome, it takes no
     pointer, and being outside every scrollable ancestor is exactly what
     stops it being clipped. Its own geometry is pinned in
     tests/tooltip.test.mjs beside the arithmetic that places it. */
  assert.match(stripComments(detailTip), /position:\s*fixed/, 'the detail card is no longer viewport-fixed; a clipping ancestor is the defect issue 136 removed');

  // 44px on both axes, still, from the one shared rule.
  assert.match(styles, /\.icon-button\s*\{[^}]*inline-size:\s*2\.75rem/);
  assert.match(styles, /\.icon-button\s*\{[^}]*block-size:\s*2\.75rem/);
});

/* THE GRID BECAME A STRIP (owner directive, 2026-09-03, issue 287): the boss
 * tallies scroll past in one ruled band instead of tiling a three-column
 * table. Every pin the grid carried is ported item for item rather than
 * dropped, because none of them was about the grid — they were about the
 * data: figures go through the tested renderers, the component formats
 * nothing, the vendored art is locked exactly as reviewed, an unmapped row
 * falls back to a designed glyph, and no account name reaches a rendering.
 * ------------------------------------------------------------------------ */

/* One fixture drive of the adapter, shared by the structural tests below: the
 * exact strip the component renders, decided by the same data. */
function bossTickerFixture() {
  return bossTickerProps(
    {
      schema: 'panel/v1',
      id: bossLogPanelId,
      kind: 'boss-log/v1',
      title: 'Old School RuneScape',
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
          { name: 'Hespori', kc: 0, rank: null },
        ],
      },
    },
    new Map([['zulrah', '/assets/zulrah.png']])
  );
}

test('the ticker renders the tallies through the tested renderers, formatting nothing', () => {
  // Figures and details are built by the adapter through the tested
  // renderers — tally, cellLabel, bossDetail — executed below and in
  // tests/tooltip.test.mjs, including the unranked and no-figure cases. The
  // component may format nothing.
  assert.doesNotMatch(
    ticker,
    /toLocaleString|Intl\.NumberFormat/,
    'a figure is being formatted in the component instead of by the tested renderers'
  );
  const { items } = bossTickerFixture();
  const item = (key) => items.find((entry) => entry.key === key);
  assert.equal(item('Zulrah').figure, tally(1192), 'tallies must go through the tested renderer');
  assert.equal(item('Zulrah').label, cellLabel({ name: 'Zulrah', kc: 1192, rank: 111737 }));
  assert.deepEqual(item('Zulrah').detail, bossDetail({ name: 'Zulrah', kc: 1192, rank: 111737 }));
  /* IN THE HISCORES' ORDER (owner, 2026-10-19: "do not arrange the bosses by
     alphabetical order but instead by the order in which they appear in the
     runelite plugin viewer" — RuneLite's Hiscore panel, which lists them as
     the hiscores do). The origin keeps the upstream order, so the strip keeps
     the payload's: no count and no name moves a boss. The fixture's order is
     neither alphabetical nor by count, so either sort coming back fails here,
     and the reversed payload proves the order is the payload's own rather
     than this one fixture's. A redraw of the same payload is byte-identical. */
  const payloadOrder = ['Zulrah', 'Artio', 'Hespori'];
  assert.deepEqual(items.map((entry) => entry.key), payloadOrder, 'the strip reorders the hiscores’ bosses');
  assert.notDeepEqual(payloadOrder, [...payloadOrder].sort(), 'the fixture is already alphabetical, so it cannot tell the orders apart');
  const reversed = bossTickerProps(
    {
      schema: 'panel/v1',
      id: bossLogPanelId,
      kind: 'boss-log/v1',
      title: 'x',
      status: 'ok',
      data: {
        account: 'f',
        bosses: [
          { name: 'Hespori', kc: 0, rank: null },
          { name: 'Artio', kc: null, rank: null },
          { name: 'Zulrah', kc: 1192, rank: 111737 },
        ],
      },
    },
    new Map()
  );
  assert.deepEqual(reversed.items.map((entry) => entry.key), [...payloadOrder].reverse(), 'the strip’s order is not the payload’s own');
  assert.doesNotMatch(
    bossLogStripLabel,
    /most|alphabet|by (?:count|name)|ranked/i,
    'the strip’s accessible name claims a sort the strip no longer does'
  );
  // A row the hiscores list with nothing against it is DIMMED, never dropped,
  // and the two absences stay different claims: a reported zero renders "0"
  // and an unreported figure renders the no-figure marker.
  assert.equal(item('Hespori').figure, tally(0));
  assert.equal(item('Hespori').quiet, true, 'a zero row is dimmed, never hidden');
  assert.equal(item('Artio').figure, tally(null), 'a null tally arrives as the no-figure marker');
  assert.equal(item('Artio').quiet, true);
  // The peak is the page's one highlight, and it is a peak only when
  // something was actually killed — wherever in the order it stands.
  assert.equal(item('Zulrah').peak, true);
  assert.equal(item('Hespori').peak, false);
  assert.deepEqual(
    reversed.items.map((entry) => entry.peak),
    [false, false, true],
    'the peak follows the strip’s first place rather than the largest count'
  );
  assert.equal(bossTickerProps({
    schema: 'panel/v1',
    id: bossLogPanelId,
    kind: 'boss-log/v1',
    title: 'x',
    status: 'ok',
    data: { account: 'f', bosses: [{ name: 'A', kc: null, rank: null }] }
  }, new Map()).items[0].peak, false, 'a strip of unreported rows has no maximum to mark');
  // The dim and the highlight are ATTRIBUTES, not inline styles: this origin's
  // Content-Security-Policy admits no style attribute at all.
  assert.match(ticker, /data-quiet=\{item\.quiet \? 'true' : 'false'\}/);
  assert.match(ticker, /data-peak=\{item\.peak \? 'true' : 'false'\}/);
  assert.doesNotMatch(ticker, /style="/, 'an inline style attribute is unservable under default-src \'self\'');
  assert.match(styles, /\.ticker-item\[data-quiet='true'\] \.ticker-icon \{[^}]*opacity: var\(--ticker-dim\)/);
  assert.match(styles, /\.ticker-item\[data-peak='true'\] \.ticker-figure \{[^}]*color: var\(--ledger-highlight\)/);
  // The fill variant existed only to claim the retired rail's height; a card
  // in the stack grows to its content, so it must not come back.
  assert.doesNotMatch(shell, /panel-shell-fill/, 'the rail-filling variant must stay retired');
  // The detail is the ONE primitive (owner directive, 2026-08-24); this
  // component delegates rather than growing its own again.
  assert.doesNotMatch(
    ticker,
    /role="tooltip"|boss-tip|nth-child\(3n/,
    'the ticker grew a second tooltip implementation; there is one primitive and it is DetailTip'
  );
  // Data flows only through the shared layer and shell; the component knows
  // no panel, no slug and no name — the binding layer holds all three.
  assert.match(ticker, /import PanelShell from '\.\/PanelShell\.svelte'/);
  assert.doesNotMatch(
    ticker,
    /watchPanel|boss|skill|osrs|runelite|hiscore/i,
    'the component names its domain; names live in the adapter and the binding layer (issue 165)'
  );
  assert.match(bossBinding, /bossLogPanelId/);
  assert.equal(bossLogPanelId, 'boss-log');
});

/* THE ATTRIBUTION LIVES IN ATTRIBUTION.md (AGENTS.md, "Attribution for
 * third-party assets"): the icons are Jagex intellectual property used as fan
 * content, and the exact notice is held there word for word by the sourcing
 * test below. The page stopped printing it under the strip (owner directive,
 * 2026-09-04, issue 292), so no rendered copy exists to drift — the component
 * names no vendor and carries no notice at all. */
test('the strip prints no attribution line and names no vendor', () => {
  assert.equal(bossTickerFixture().notice, undefined, 'the strip grew a notice prop again');
  assert.doesNotMatch(ticker, /ticker-notice/, 'the strip renders an attribution line the owner cut');
  assert.ok(!ticker.includes('Jagex'), 'the component names a vendor; names live in data, never here');
});

// The owner reviewed the vendored boss art and locked it exactly as rendered
// (issue 127: "gorgeous… LOCK THOSE IN"). The layout around it changed in the
// same pass, which is precisely when a rendering detail gets adjusted by
// accident, so every part of how an item is SOURCED and DRAWN is pinned here
// in one place: the file the slug selects, the declared box, the loading
// behavior, and the painted size.
test('the boss icons are locked exactly as they render', () => {
  // The item declares its box, its lazy loading and its async decode; the box
  // is a token, stated once beside the strip's own metrics.
  assert.match(
    ticker,
    /<img\s+class="ticker-icon"\s+src=\{item\.icon\}\s+alt=""\s+width=\{22\}\s+height=\{22\}\s+loading="lazy"\s+decoding="async"/,
    'an item icon declares its box, its lazy loading and its async decode'
  );
  assert.match(
    styles,
    /\.ticker-icon \{[^}]*inline-size: var\(--ticker-icon\)[^}]*block-size: var\(--ticker-icon\)[^}]*object-fit: contain/,
    'the painted icon box is square and never distorts the art inside it'
  );
  assert.match(styles, /--ticker-icon: 22px;/);
  /* FIFTEEN PERCENT LARGER ON THE TRACKERS (owner, 2026-10-19: "increase the
     size of this by 15%"): the boss log's strip restates the icon, the item's
     padding on both axes and the figure, each the base measure times 1.15 to
     the nearest step its unit allows, and the painted icon stays square. The
     shorthand padding token is restated whole because a custom property that
     reads others is computed where it is declared: inherited, it would still
     carry the base's padding. */
  const sheetCode = styles.replace(/\/\*[\s\S]*?\*\//g, '');
  const strip = /#trackers \.ticker-strip \{([^}]*)\}/.exec(sheetCode)?.[1] ?? '';
  assert.ok(strip, 'the trackers’ strip states no measures of its own');
  const measure = (source, token) => {
    const found = new RegExp(`${token}: ([\\d.]+)(px|rem);`).exec(source);
    assert.ok(found, `${token} is not a plain length this pin can read`);
    return { value: Number(found[1]), unit: found[2] };
  };
  for (const token of ['--ticker-icon', '--ticker-item-pad-block', '--ticker-item-pad-inline']) {
    const base = measure(sheetCode, token);
    const scaled = measure(strip, token);
    assert.equal(scaled.unit, base.unit, `${token} changes unit on the trackers`);
    const ratio = scaled.value / base.value;
    assert.ok(Math.abs(ratio - 1.15) <= 0.02, `${token} is ${ratio.toFixed(3)} of its base on the trackers, not 15% larger`);
  }
  assert.match(
    strip,
    /--ticker-item-pad: var\(--ticker-item-pad-block\) var\(--ticker-item-pad-inline\);/,
    'the strip’s padding shorthand is inherited, so the items keep the base padding'
  );
  assert.match(
    /#trackers \.ticker-figure \{([^}]*)\}/.exec(sheetCode)?.[1] ?? '',
    /font-size: calc\(var\(--ledger-figure-size\) \* 1\.15\);/,
    'the strip’s figures are not 15% larger'
  );
  // The designed hole for a row that ships upstream before its art does.
  assert.match(ticker, /<span class="ticker-icon ticker-glyph" aria-hidden="true">\{item\.glyph\}<\/span>/);
  // WHICH art a row shows is the adapter's slug lookup, executed: a mapped
  // slug arrives as the icon URL, an unmapped row arrives as its initials.
  const { items } = bossTickerFixture();
  const item = (key) => items.find((entry) => entry.key === key);
  assert.equal(item('Zulrah').icon, '/assets/zulrah.png', 'a vendored icon is selected by slug');
  assert.equal(item('Artio').icon, undefined, 'a row without art carries none');
  assert.equal(item('Artio').glyph, bossInitials('Artio'));
});

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
  /* ONE directory now (owner directive, 2026-09-03, issue 287: the owner cut
     the skills grid). The twenty-five skill icons went with the surface that
     rendered them, because this pin's own rule is what decides that — "third-
     party art must never outlive the data that justifies it" cuts both ways,
     and art nothing renders is art nothing justifies. The boss half is
     untouched and still exact in both directions. */
  const directories = {
    bosses: { rows: snapshot.data.bosses, slug: bossSlug },
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
  const { items } = bossTickerFixture();
  assert.equal(items.find((item) => item.key === 'Artio').glyph, bossInitials('Artio'));
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

/* The Coding Projects roster is DERIVED, never enumerated (issue 281). This
 * is the same pin the boss list carries above, applied to the second producer
 * that earned it the same way: the owner created a repository and the site
 * could not show it, because the roster was a whitelist written down in three
 * places that only a release could move. The structure under the ruling:
 *
 *   - `internal/panels/config/fetch.json` names ONE listing endpoint and the
 *     account it must belong to — never a source list. An enumerated roster
 *     silently misses every repository created after the last edit.
 *   - Curation is an explicit `exclude` array — data a reviewer can see —
 *     never a whitelist that goes stale. Empty is the current ruling.
 *   - The one search document that splits the open-work tallies is still
 *     configured, because losing it quietly costs every row two permanent
 *     dashes.
 *
 * The snapshot ↔ frontend parity HALF survives, because the invariant it
 * guarded survives: the shipped snapshot and the frontend's captured rows
 * are the two halves of the same cold-start/fallback face, and a name only
 * one of them carries is a row that renders differently depending on which
 * fallback path ran. The config leg is gone with the whitelist itself. */
test('the project roster is derived from the account listing, never enumerated in config', {
  skip: reducedContextNote,
}, async () => {
  const fetchConfig = await read('../../internal/panels/config/fetch.json').then(JSON.parse);
  assert.equal(
    fetchConfig.codingProjects.sources,
    undefined,
    'an enumerated repository list silently drops every repository created since the last edit'
  );
  assert.ok(
    typeof fetchConfig.codingProjects.listingEndpoint === 'string' &&
      fetchConfig.codingProjects.listingEndpoint.length > 0,
    'config must name the account listing the roster is derived from'
  );
  assert.ok(
    typeof fetchConfig.codingProjects.account === 'string' &&
      fetchConfig.codingProjects.account.length > 0,
    'config must pin the account every listed row is checked against'
  );
  assert.ok(
    Array.isArray(fetchConfig.codingProjects.exclude),
    'curation must be an explicit exclusion list — data, not a whitelist'
  );
  // The credentialed document is what carries the released version and the
  // all-time closed pull-request tally (issue #317); the open-work search
  // document it replaced left with the two columns it fed.
  assert.equal(
    fetchConfig.codingProjects.pullsEndpoint,
    undefined,
    'the open-work search document left with the columns it fed; a URL nothing reads is egress nobody asked for'
  );
  assert.ok(
    typeof fetchConfig.codingProjects.repositories?.query === 'string' &&
      fetchConfig.codingProjects.repositories.query.includes('latestRelease') &&
      fetchConfig.codingProjects.repositories.query.includes('pullRequests'),
    'config names no repository query, so every row’s version and closed-pull tally would be a permanent dash'
  );
  // The pinned set rides the SAME document (owner directive, 2026-09-11): a
  // second round trip for six names would be a request per refresh for a fact
  // that changes a few times a year.
  assert.ok(
    fetchConfig.codingProjects.repositories.query.includes('pinnedItems'),
    'the repository query does not ask for the pinned set, so no row could ever be marked'
  );
  // The listing endpoint bounds its own answer as data: a page-size
  // parameter is what justifies the byte cap beside it.
  assert.match(
    fetchConfig.codingProjects.listingEndpoint,
    /per_page=\d+/,
    'the listing endpoint declares no page size, so its byte cap is justified against nothing'
  );
});

test('the snapshot and the frontend fallback describe the same captured set', {
  skip: reducedContextNote,
}, async () => {
  const snapshot = await read('../../internal/panels/snapshots/coding-projects.json').then(
    JSON.parse
  );
  const shipped = snapshot.data.repos.map((repo) => repo.name).sort();
  const rendered = projects.map((project) => project.name).toSorted();
  assert.deepEqual(
    shipped,
    rendered,
    'snapshots/coding-projects.json and frontend/src/lib/projects.ts disagree; the cold-boot face and the no-payload face would show different repositories'
  );
  // Non-vacuity: two empty lists would satisfy the assertion above.
  assert.ok(rendered.length > 0, 'the captured fallback set is empty');
  // Every snapshot row says it is a capture: the cold-start payload must
  // never wear live provenance.
  for (const repo of snapshot.data.repos) {
    assert.equal(repo.recorded, true, `${repo.name} in the snapshot claims live provenance`);
  }
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
  // The commits block renders NO panel label (owner directive, 2026-09-04,
  // issue 294): the calendar opens on a token series, so the host's name over
  // it would be false, and the segments name every source. The envelope still
  // carries the owner-chosen title — the API serves it and the rendering lane
  // reads it there — but the adapter hands the shell none, whatever arrives,
  // so no hardcoded heading can creep back in through the fallback path.
  assert.equal(
    contributionCalendarProps([
      {
        schema: 'panel/v1',
        id: 'vcs-activity',
        kind: 'vcs-activity/v1',
        title: 'GitHub',
        status: 'ok',
        data: null
      },
      null
    ]).title,
    undefined,
    'the commit block wears the envelope title again'
  );
  assert.equal(contributionCalendarProps([null, null]).title, undefined);
  /* The boss panel's heading is the same arrangement: the envelope's own
     title is the panel head over the strip, and the strip's lead prints no
     copy of it (owner directive, 2026-09-04, issue 292 — the lead's name and
     totals line were cut as noise). The component is swept for the word and
     the config is what carries it. */
  assert.equal(fetchConfig.titles?.['boss-log'], 'Old School RuneScape');
  /* …and the strip no longer prints it (owner direction, 2026-10-16: "The
     oldschool runescape boss log IS a tracker and should be part of that
     section"). The title is still served and still the adapter's; the strip
     is named by its own label instead of a heading over it. */
  assert.match(ticker, /<PanelShell \{status\} \{generatedAt\}>/);
  assert.doesNotMatch(ticker, /<PanelShell \{title\}/, 'the strip grew its heading back');
  assert.doesNotMatch(ticker, /ticker-name|ticker-lead-line/, 'the lead grew its text back');
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
  for (const [name, source] of Object.entries({ ticker, chronicle, ledgerSpread })) {
    assert.doesNotMatch(
      source,
      /\bloadPanel\b|\bwatchPanel\b|\bfetch\(/,
      `${name} reads the wire itself; the block host owns the subscription`
    );
  }
  // And every tracker block is a panel binding, so all of them ride that host.
  for (const [name, source] of Object.entries({
    bossBinding,
  })) {
    assert.match(source, /panelBlock\(/, `${name} no longer binds through the panel host`);
  }
  /* Two blocks read SEVERAL panels each and ride the same host to do it
     (owner directive, 2026-09-03, issue 287; the sheet's paired section, owner
     design decision 2026-09-11, issue 318): panelsBlock is one subscription
     per id through the identical watchPanel, never a second retrieval path. */
  for (const [name, source] of Object.entries({
    projectsBinding: bindingSourceCache.projects,
    chronicleBinding: bindingSourceCache.chronicle,
  })) {
    assert.match(source, /panelsBlock\(/, `${name} no longer binds through the panel host`);
  }
  assert.match(blockHost, /watchPanel\(id, \(loaded\) => \{/, 'the multi-panel branch no longer watches through the shared host');
});

test('the calendar is drawn once, inside the chronicle, and an unmeasured day is never a quiet one', () => {
  /* ONE calendar on the page (owner directive, 2026-09-03, issue 287 — one
     grid instance the reader cycled), carried to the Chronicle, which draws
     the year's cells under its lines (owner direction, 2026-10-16) and
     repaints them by layer rather than mounting one per set. The retired
     grid's own internals (its scroller, its listbox, its per-cell detail)
     retired with it. */
  assert.equal(
    (chronicle.match(/class="chronicle-calendar"/g) ?? []).length,
    1,
    'the chronicle draws more than one calendar, or none'
  );
  // Its scrub hands the vertical axis back to the page on the calendar's OWN
  // rule; the chart's declaration in the same file cannot stand in for it.
  assert.match(/\.chronicle-calendar \{([^}]*)\}/.exec(chronicle)?.[1] ?? '', /touch-action: pan-y/);
  // Never colour alone at the edge that matters most: a day nobody measured
  // is marked as such in the DOM, so it can never be read as a quiet day.
  assert.match(chronicle, /data-measured=\{cell\.measured \? 'true' : 'false'\}/);
  assert.match(gridSource, /export function measuredCell\(/);
  // The busiest day keeps the ramp's peak green (the mark is never the peak;
  // the busiest tile is, experience.test.mjs "NO RED ANYWHERE"). A day is a
  // wall stone now (owner, 2026-10-19: "castle wall fixtures"), so the peak is
  // the mossiest stone RINGED in that green: the stone says how busy, the ring
  // says busiest, and the green still belongs to the busiest tile alone. The
  // stone is the day's own level, laid on the calendar's canvas (sections),
  // and the busiest day's value is the peak, whose level is the top one at
  // any peak — so its stone is the mossiest without a rule of its own.
  assert.match(chronicle, /data-peak=\{cell\.busiest \? 'true' : 'false'\}/);
  assert.match(chronicle, /busiest: peak > 0 && value === peak,/, 'the busiest day is not the day whose value is the peak');
  for (const peakValue of [1, 7, 12.5, 4096]) {
    assert.equal(gridLevel(peakValue, peakValue), gridLevels - 1, `a busiest day of ${peakValue} is not the top level, the mossiest stone`);
  }
  const peak = /\.chronicle-cell\[data-peak='true'\] \{([^}]*)\}/.exec(chronicle)?.[1] ?? '';
  assert.match(peak, /stroke: var\(--grid-cell-peak\);/, 'the busiest day lost the calendar’s peak green');
  assert.match(peak, /stroke-width: 1;/, 'the busiest day’s ring is not the one-unit ring the unmeasured outline is drawn at');
  // And no cell carries the browser tooltip (issue 219): it has no touch
  // trigger in any engine, so on a phone it said nothing at all.
  assert.doesNotMatch(chronicle, /\stitle=/, 'a calendar cell carries the browser tooltip again');
  /* The line IS the calendar read as a line (owner, 2026-10-16): it plots the
     picked layer — "it makes no sense that the graph doesn't change to show
     contributions when I pick contributions" — and its x is the calendar's own
     week scale over the weeks the calendar shows — "make the graph represent
     the entire heatmap not just a subsection" — so a day stands over its own
     week's column. The browser lanes measure the two boxes agreeing. */
  assert.match(chronicle, /paths\(layer\.series\)/, 'the line plots something other than the picked layer');
  /* No size container inside the diagram: one on each account sent Blink's
     layout into a loop that never returned — the page answered nothing for
     as long as it was open (measured 2026-10-16) — while every other engine
     drew it fine, so only a pin keeps it from coming back unseen. */
  assert.doesNotMatch(chronicle, /container-type\s*:/, 'a size container is back inside the diagram');
  assert.match(
    /function chartX\(index: number\): number \{([^}]*)\}/.exec(chronicle)?.[1] ?? '',
    /\(index - firstDay \+ 0\.5\) \/ Math\.max\(1, shownWeeks \* 7\)\) \* chartW/,
    'the line is scaled to something other than the calendar’s shown weeks'
  );
});

/* THE FIGURES SIT ABOVE A FULL-WIDTH GRAPH, AT EVERY WIDTH (owner,
 * 2026-10-19: "large awkward gap in between here, either expand the heatmap
 * or find a way to present the information in a better way"). Beside the
 * graph the figures were a tall, narrow column that left the calendar a third
 * of the room. So the board's top is ONE column at every width — the figures
 * first, the graph and its calendar under them across the whole board — and
 * no width brings the side-by-side back: no rule anywhere states another
 * track list for the top, and neither half sizes itself as a flex item. */
test('the chronicle sets its figures above a full-width graph and calendar at every width (owner 2026-10-19)', () => {
  const markup = stripComments(chronicle);
  const side = markup.indexOf('<div class="chronicle-side">');
  const plotting = markup.indexOf('<div class="chronicle-plotting">');
  const top = markup.indexOf('<div class="chronicle-top">');
  assert.ok(top >= 0 && side > top && plotting > side, 'the figures no longer come before the graph inside the board’s top');
  const style = (/<style[^>]*>([\s\S]*?)<\/style>/.exec(chronicle)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = (selector) =>
    [...style.matchAll(/(?:^|\n)\s*([^{}\n][^{}]*?)\s*\{([^{}]*)\}/g)]
      .filter(([, selectors]) => selectors.split(',').some((part) => part.trim() === selector))
      .map(([, , body]) => body.replace(/\s+/g, ' '));
  const topRules = rules('.chronicle-top');
  assert.ok(topRules.length > 0, 'nothing lays out the board’s top');
  assert.match(topRules[0], /display: grid;/, 'the board’s top is no longer a grid');
  assert.match(topRules[0], /grid-template-columns: minmax\(0, 1fr\);/, 'the board’s top is no longer one column');
  for (const body of topRules) {
    assert.doesNotMatch(body, /display: flex|flex-direction|grid-template-columns: (?!minmax\(0, 1fr\);)|grid-auto-flow: column/, 'some width lays the figures beside the graph again');
  }
  for (const half of ['.chronicle-side', '.chronicle-plotting']) {
    for (const body of rules(half)) {
      assert.doesNotMatch(body, /(?:^|; |\s)flex(?:-basis|-grow|-shrink)?:|grid-column: (?!1 \/ -1)/, `${half} sizes itself beside its sibling again`);
    }
  }
});

/* ONE WINDOW FOR EVERY SERIES, AND NO WAY TO RE-ASK IT (owner directive,
 * 2026-08-28, reversing the 0.1.52 decision after seeing it live: "remove this
 * entire menu. it doesnt look good and it doesn't provide any value" — carried
 * into the ledger unchanged on 2026-09-03).
 *
 * The tests this replaces pinned a per-source view lens and a per-source
 * trailing range, then their absence inside the token panel. The panel is a
 * board of squares now and the calendars are the commits section's, so the
 * same guarantee is pinned at its new home and is if anything wider: the
 * three calendars share ONE anchor, so the week that ends the contributions
 * window ends every other one, and the reader is offered a choice of SERIES
 * rather than a choice of how to re-read one.
 *
 * The segmented control was buttons with a pressed state, deliberately not a
 * radiogroup — the same grammar the gallery's set switch uses, so the page has
 * one way of saying "pick which of these to show". The Chronicle's layer
 * switch (owner direction, 2026-10-16) keeps that grammar.
 *
 * The lens ENGINE is untouched and still proven, executed rather than
 * pattern-matched, in tests/grid.test.mjs and tests/periods.test.mjs. */
test('every calendar shares one window, and no display control survives', () => {
  // The one anchor, handed to every set: the contributions window's own last
  // day, which is where the segmented control's three pictures line up.
  assert.match(
    commitsAdapter,
    /const anchor = windowAnchor\(activity, now\);/,
    'the sets no longer share one window'
  );
  const calendarCalls = commitsAdapter.match(/calendarColumns\(/g) ?? [];
  const anchoredCalls = commitsAdapter.match(/pendingWeeks, anchor\)/g) ?? [];
  assert.ok(calendarCalls.length >= 2, 'the adapter builds fewer calendars than the section cycles');
  assert.equal(
    anchoredCalls.length,
    calendarCalls.length,
    'a set builds its columns without the shared anchor'
  );
  /* The control is pressed buttons, not a radio group — carried from the
     retired segmented control to the Chronicle's layer switch (owner
     direction, 2026-10-16), which picks what the line plots and the calendar
     paints, in the same grammar the gallery's set switch speaks. */
  assert.match(
    chronicle,
    /<div class="chronicle-layers" role="group" aria-label="Diagram layer">[\s\S]*?<button\s+type="button"\s+aria-pressed=\{option\.key === layer\?\.key\}/
  );

  /* THE ABSENCES, one per retired mechanism, swept over every component that
     could grow one back. Any one of them returning alone is a display control
     growing back through a component the owner asked to have none. */
  for (const [pattern, complaint] of [
    [/UsageFilterMenu/, 'the display menu is back'],
    [/usage-controls/, 'the controls row is back'],
    [/usage-activity-head/, 'the header that only held the controls row is back'],
    [/let views = \$state/, 'the per-source view lens is back'],
    [/let view = \$state/, 'a panel-wide view lens is back'],
    [/let ranges = \$state/, 'the per-source range is back'],
    [/let lenses = \$state/, 'the per-source category lens is back'],
    [/let lens = \$state/, 'a panel-wide category lens is back'],
    [/viewOf|rangeOf|lensOf/, 'a per-source display choice is resolved again'],
    [/activeLensCategory/, 'the category resolver is back'],
    [/totalLens/, 'the "no category" sentinel outlived the lens it belonged to'],
    [/seriesViews|seriesRanges|defaultSeriesRange/, 'a display vocabulary is offered to the reader again'],
    [/viewColumns/, 'the view aggregation is applied to a graph nobody can re-read'],
    [/role="radiogroup"/, 'a radio group is back inside a panel'],
    // The owner, 2026-10-16: "make the graph represent the entire heatmap not
    // just a subsection" — the line covers the calendar's weeks, so a span
    // row and the outline that marked the span have nothing left to choose.
    [/chronicle-ranges|rangeKey|chronicleRangeSpecs/, 'the span row is back over a graph that is the whole calendar'],
    [/chronicle-window/, 'the span outline is back on the calendar'],
  ]) {
    for (const [name, source] of Object.entries({ chronicle, ticker })) {
      assert.doesNotMatch(source, pattern, `${name}: ${complaint}`);
    }
  }
  // And nothing else in the tree imports the deleted component either.
  assert.doesNotMatch(styles, /filter-trigger|filter-popover|filter-group/, 'the menu left styles behind');
  assert.ok(
    !existsSync(new URL('../src/lib/components/UsageFilterMenu.svelte', import.meta.url)),
    'the display menu component is back'
  );
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
/* A SOURCE WITH NO SERIES IS OFFERED NO SEGMENT (owner ruling 2026-08-24,
 * carried into the ledger on 2026-09-03, issue 287).
 *
 * The ruling drew a line the redesign does not move: a reserve is for a
 * payload IN FLIGHT and holds exactly the box the data will fill, while a
 * source that has already answered and said it keeps no daily record gets no
 * held-open box at all — nothing is on its way there, so the box would be a
 * permanent hole. What changed is only where each side lives: a token source
 * with no series contributes no SET, so there is no layer to press and no
 * calendar drawn on its behalf (the Chronicle since 2026-10-16).
 *
 * An earlier draft of this pin accepted a set with no columns and an honest
 * caption. That is the same arrangement wearing better words: a pressable
 * segment over 371 placeholder cells and a note underneath. The stronger
 * claim is the one the ruling actually made.
 */
test('a source with no series is offered no calendar set', () => {
  const { sets } = contributionCalendarProps([
    null,
    {
      schema: 'panel/v1',
      id: 'token-usage',
      kind: 'token-usage/v2',
      title: 'Token usage',
      status: 'ok',
      data: { sources: [{ label: 'anthropic', windows: [] }] }
    }
  ]);
  assert.equal(
    sets.find((set) => set.key === 'anthropic'),
    undefined,
    'a source with no daily record was offered a segment over an empty grid'
  );
  /* The other direction, so this is a guard rather than a way to draw
     nothing: a source that DOES publish days contributes its set. */
  const { sets: drawn } = contributionCalendarProps([
    null,
    {
      schema: 'panel/v1',
      id: 'token-usage',
      kind: 'token-usage/v2',
      title: 'Token usage',
      status: 'ok',
      data: {
        sources: [
          { label: 'anthropic', windows: [], series: { startDate: '2026-08-01', totals: [3, 1, 4] } }
        ]
      }
    }
  ]);
  const plotted = drawn.find((set) => set.key === 'anthropic');
  assert.ok(plotted, 'a source with days to plot lost its segment');
  assert.ok(plotted.columns.length > 0, 'a real series draws no window');
  // The retired sentence must not come back anywhere.
  for (const [name, source] of Object.entries({ chronicle })) {
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
    ticker,
    panelsSource,
    iconsSource,
    gridSource,
    chronicle,
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
  /* There is ONE slug rule and ONE icon directory now (owner directive,
     2026-09-03, issue 287: the skills grid is cut, so the skill icons and the
     second slug helper went with the surface that justified them). The rule
     the pair existed to protect — an icon file is named by exactly the data
     name it serves — is unchanged and is what the directory pin above
     enforces in both directions. */
  assert.equal(bossSlug('Chambers of Xeric: Challenge Mode'), 'chambers-of-xeric-challenge-mode');
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

/* The skill-label pin retired with the grid it described (owner directive,
 * 2026-09-03, issue 287). What it proved — an accessible label carries the
 * WHOLE row, nulls included, so a figure never depends on reading one number
 * out of a dense table — is unchanged and still proven, on the collection that
 * survives: `cellLabel` is executed against a full row, an unranked row and a
 * no-figure row in the tests directly above and below this line, and the
 * ticker renders it as every item's accessible name. */

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
  assert.doesNotMatch(ticker, /account|panelSummary/, 'the account subtitle came back');
  // The grids keep accessible names — losing the account must not cost a
  // screen reader the ability to tell the two tables apart. The names are
  // adapter data on the one grid template.
  /* The collection keeps its accessible name — losing the account must not
     cost a screen reader the ability to say what the strip is. The name is
     adapter data, and the strip IS a focus stop now, deliberately: under
     reduced motion it is a scroller, and a scrollable box is keyboard-
     reachable only when it is focusable (owner directive, 2026-09-03, issue
     287 — the inverse of the ruling that removed the grid's tabindex, for the
     inverse reason: the grid had stopped scrolling, this scrolls). */
  /* The strip's accessible name is the COMPOSED label the adapter built, and
     nothing else is allowed to name it: the attribute is pinned rather than
     its whole opening tag, so a binding added to the element (the strip is
     the detail's host now) cannot break a claim that was never about the
     tag's shape. */
  assert.match(ticker, /<div class="ticker-strip" aria-label=\{label\} tabindex="0" role="group"/);
  assert.equal(bossTickerFixture().label, bossLogStripLabel);
  assert.ok(!bossLogStripLabel.includes('Roll'), 'the strip name must not carry the account');
  // The panel head renders the ENVELOPE's title, so even the collection's own
  // name is origin-served data rather than a string in this tree.
  assert.equal(bossTickerFixture().title, 'Old School RuneScape');
});

/* The two skills-grid pins retired with the grid (owner directive,
 * 2026-09-03, issue 287: the owner cut the skills grid).
 *
 * They proved two things and both survive elsewhere rather than being lost.
 * The FIRST — a total the upstream does not report renders as the same marker
 * every other cell uses, never as a zero and never as an empty tile — is the
 * honest-states floor, and it is executed on the surviving collection by the
 * null-tally and unranked pins above (`tally(null)` is `--`, `rankLabel(null)`
 * is "Unranked", and the strip renders both). The SECOND — that blank tiles
 * are a COUNTING property, so an upstream shipping a twenty-sixth skill fails
 * loudly rather than shipping a hole — has no counting property left to guard:
 * the strip is a single row of exactly the rows the payload carries, so there
 * is no grid for a remainder to fall out of. */

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
