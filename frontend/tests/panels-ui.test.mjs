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
  rail,
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
  read('../src/lib/components/SideRail.svelte'),
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
    ['<SideRail><BossLog /></SideRail>', '<TokenUsagePanel />', '<ActivityBar />'],
    'the mount fence must hold exactly one line per panel'
  );
});

test('side rail recreates the RuneLite chrome as overridable custom properties', () => {
  // The three published palette values, each expressed as a themable
  // var(--panel-rail-*, dark-native default) pair — never a bare literal.
  assert.match(rail, /--rail-surface:\s*var\(--panel-rail-surface,\s*rgb\(40,\s*40,\s*40\)\)/);
  assert.match(rail, /--rail-border:\s*var\(--panel-rail-border,\s*rgb\(23,\s*23,\s*23\)\)/);
  assert.match(rail, /--rail-accent:\s*var\(--panel-rail-accent,\s*rgb\(220,\s*138,\s*0\)\)/);
  // Collapsible semantics: a real button wired to state, collapsed by
  // default on narrow viewports, fixed-position so the page never reflows.
  assert.match(rail, /aria-expanded=\{!collapsed\}/);
  assert.match(rail, /aria-controls="side-rail-panels"/);
  assert.match(rail, /matchMedia\('\(max-width: 60rem\)'\)\.matches/);
  assert.match(rail, /position:\s*fixed/);
  assert.match(rail, /\[data-collapsed='true'\]\s*\.rail-panels\s*\{\s*display:\s*none/);
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

// The "stale · 8d ago" text badge became a control the reader can act on
// (issue #78). Nothing about the honesty was allowed to leave with it, so
// this pins BOTH halves: the freshness sentence still exists and is still
// reachable, and pressing the control forces a real read.
test('the freshness badge became a control without losing a word of honesty', () => {
  // The sentence itself is built from the same status and age as before.
  assert.match(shell, /const freshness = \$derived\(age \? `\$\{status\}, updated \$\{age\}` : status\)/);
  // And it reaches a pointer user, a screen-reader user, and the tooltip.
  assert.match(shell, /aria-label=\{`Refresh \$\{title\}\. \$\{freshness\}\.`\}/);
  assert.match(shell, /title=\{`\$\{freshness\} — refresh`\}/);
  // Status is never color alone: the dot's SHAPE differs per state.
  assert.match(shell, /\.panel-badge-dot\[data-panel-status='ok'\]\s*\{[^}]*border-radius:\s*50%/);
  assert.match(shell, /\.panel-badge-dot\[data-panel-status='stale'\]\s*\{[^}]*background:\s*none/);
  // In flight: the control is disabled, announces itself busy, and moves —
  // but only for a visitor who has not asked motion to stop.
  assert.match(shell, /aria-busy=\{busy\}/);
  assert.match(shell, /disabled=\{busy\}/);
  assert.match(shell, /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?animation:\s*panel-refresh-spin/);
  assert.match(shell, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?opacity:\s*0\.4/);
  // The busy flag is released in a finally, so a failed read cannot latch the
  // control off forever — the failure itself renders as the honest
  // unavailable envelope loadPanel already produces.
  assert.match(shell, /} finally \{[\s\S]*?busy = false;/);
  // 44px minimum touch target, delivered without inflating a dense header.
  assert.match(shell, /\.panel-refresh::after\s*\{[^}]*inline-size:\s*2\.75rem/);
  assert.match(shell, /\.panel-refresh::after\s*\{[^}]*block-size:\s*2\.75rem/);
  // A panel that supplies no refresher still renders the honest reading.
  assert.match(shell, /\{:else\}\s*<p class="panel-badge"/);
  // Every mounted panel supplies one.
  for (const [name, source] of Object.entries({ bossLog, activityBar, tokenUsage })) {
    assert.match(source, /watcher\?\.refresh\(\)/, `${name} has no force-refresh path`);
  }
});

// Five collisions, all confirmed on real viewports before the fix (issue
// #78): the bar over the token panel, the open rail over the token panel, the
// reading-mode control buried under the rail, the rail and the bar tied at
// the same layer, and 100vh floors. Arbitration is now one ordered scale plus
// two reserved gutters, and every fixed element pads itself by the safe-area
// insets.
test('fixed chrome is arbitrated by one layer scale and reserves its own space', () => {
  // An ORDERED scale, defined once. The order is the assertion: a menu the
  // rail can bury is a control the visitor cannot reach.
  const layers = ['base', 'activity', 'rail', 'menu'].map((name) => {
    const found = styles.match(new RegExp(`--layer-${name}:\\s*(\\d+);`));
    assert.ok(found, `the stacking scale lost --layer-${name}`);
    return Number(found[1]);
  });
  for (let index = 1; index < layers.length; index += 1) {
    assert.ok(
      layers[index] > layers[index - 1],
      `the stacking scale is not ordered: ${layers.join(' < ')} must strictly increase`
    );
  }
  // Every fixed element reads exactly one of them — no bare numbers.
  assert.match(activityBar, /z-index:\s*var\(--layer-activity,/);
  assert.match(rail, /z-index:\s*var\(--layer-rail,/);
  assert.match(themeMenu, /z-index:\s*var\(--layer-menu,/);
  // ...and no fixed element sets a raw one. (A panel's own tooltip may still
  // stack inside its cell: that is a local context, not page chrome.)
  for (const [name, source] of Object.entries({ rail, activityBar, themeMenu })) {
    assert.doesNotMatch(
      source,
      /z-index:\s*\d/,
      `${name} sets a raw z-index; the stacking order is the token scale, not a race`
    );
  }
  // The rail publishes its state so the page can lay itself out beside it.
  assert.match(rail, /dataset\.railOpen = collapsed \? 'false' : 'true'/);
  assert.match(styles, /:root\[data-rail-open='true'\][\s\S]*?--page-rail-gutter:\s*calc\(/);
  assert.match(styles, /#app\s*\{[^}]*padding-inline-end:\s*var\(--page-rail-gutter\)/);
  // ...at exactly the width where the rail stops starting collapsed, so a
  // phone never reserves a rail's width out of its reading area.
  assert.match(rail, /matchMedia\('\(max-width: 60rem\)'\)/);
  assert.match(styles, /@media \(min-width: 60\.0625rem\)/);
  // The bar reserves the strip it covers and bounds itself by the same token,
  // so it can never grow past the space the page set aside.
  assert.match(activityBar, /--page-activity-gutter:\s*var\(--panel-activity-reserve/);
  assert.match(activityBar, /max-block-size:\s*calc\(var\(--panel-activity-reserve/);
  assert.match(styles, /#app\s*\{[^}]*padding-block-end:\s*var\(--page-activity-gutter\)/);
  // ...and the hero gives it back, so a page with nothing below it is still
  // exactly one viewport tall instead of scrolling over reserved emptiness.
  assert.match(styles, /main\s*\{[^}]*min-height:\s*calc\(100dvh - var\(--page-activity-gutter\)\)/);
  // Both switch off together where the bar flows in the document instead.
  assert.match(activityBar, /@media \(max-width: 45rem\), \(max-height: 30rem\)[\s\S]*?position:\s*static/);
  assert.match(activityBar, /@media \(max-width: 45rem\), \(max-height: 30rem\)[\s\S]*?--page-activity-gutter:\s*0px/);
  // Safe-area insets on every fixed element (rendering-lane floor).
  for (const [name, source] of Object.entries({ rail, activityBar, themeMenu })) {
    assert.match(source, /env\(safe-area-inset-/, `${name} does not clear the notch or home indicator`);
  }
});

test('boss log renders the dense fixed-cell grid with tooltips and -- tallies', () => {
  assert.match(bossLog, /grid-template-columns:\s*repeat\(3,/, 'the grid must stay three columns');
  assert.match(bossLog, /block-size:\s*2\.125rem/, 'cells must keep a fixed height (no CLS)');
  assert.match(bossLog, /width="26"\s+height="26"/, 'icons must declare their box (no CLS)');
  assert.match(bossLog, /loading="lazy"/, 'icons must lazy-load');
  assert.match(bossLog, /decoding="async"/);
  assert.match(bossLog, /tally\(boss\.kc\)/, 'tallies must go through the tested renderer');
  assert.match(bossLog, /rankLabel\(boss\.rank\)/, 'ranks must go through the tested renderer');
  // The complete table scrolls inside the panel. This used to be a bare
  // max-block-size, which pinned that SOME bound existed without pinning what
  // it was; the boss region now claims the rail's remaining height instead,
  // so the three declarations that actually produce that behavior are pinned:
  // the shell fills its flex parent, the region grows into it, and it is
  // allowed to shrink below its content so it — not the page — scrolls.
  assert.match(bossLog, /<PanelShell[\s\S]*?\n\s+fill\n/, 'the panel must claim the rail height');
  assert.match(bossLog, /\.boss-grid\s*\{[^}]*flex:\s*1/, 'the boss region must grow into it');
  assert.match(bossLog, /\.boss-grid\s*\{[^}]*min-block-size:\s*0/, 'and be allowed to shrink');
  assert.match(bossLog, /\.boss-grid\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(shell, /\.panel-shell-fill\s*\{[^}]*flex:\s*1/);
  assert.match(shell, /\.panel-shell-fill\s+\.panel-body\s*\{[^}]*min-block-size:\s*0/);
  assert.match(rail, /\.rail-panels\s*\{[^}]*min-block-size:\s*0/, 'the rail must let it shrink too');
  assert.match(bossLog, /role="tooltip"/);
  assert.match(bossLog, /:hover\s+\.boss-tip/);
  assert.match(bossLog, /:focus-visible\s+\.boss-tip/);
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
    rail,
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
