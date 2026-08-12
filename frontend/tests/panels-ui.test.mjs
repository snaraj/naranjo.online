import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { bossInitials, bossSlug } from '../src/lib/bossIcons.ts';

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

const [app, shell, rail, bossLog, panelsSource, iconsSource, viteConfig, grid, gridSource, activityBar, tokenUsage] =
  await Promise.all([
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

test('boss log renders the dense fixed-cell grid with tooltips and -- tallies', () => {
  assert.match(bossLog, /grid-template-columns:\s*repeat\(3,/, 'the grid must stay three columns');
  assert.match(bossLog, /block-size:\s*2\.125rem/, 'cells must keep a fixed height (no CLS)');
  assert.match(bossLog, /width="26"\s+height="26"/, 'icons must declare their box (no CLS)');
  assert.match(bossLog, /loading="lazy"/, 'icons must lazy-load');
  assert.match(bossLog, /decoding="async"/);
  assert.match(bossLog, /'--'/, 'null tallies must render as --');
  assert.match(bossLog, /'Unranked'/, 'a null rank is unranked, and says so');
  assert.match(bossLog, /formatWhole/, 'counts must be thousands-separated');
  assert.match(bossLog, /max-block-size:/, 'the complete table must scroll inside the panel');
  assert.match(bossLog, /overflow-y:\s*auto/);
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

// The origin now serves EVERY boss the hiscores report — dozens — and only a
// handful have vendored icons, so the old "every boss has an icon" pin would
// demand an icon batch nobody has reviewed. The obligation runs the other way
// now, and it is the one that actually protects the repository: every icon
// that ships must belong to a boss the origin really serves (so no unused
// third-party art accumulates), and the grid must have a real fallback for
// the rest (so a missing icon is a designed state, not a hole).
test(
  'every shipped icon belongs to a boss the origin serves',
  { skip: reducedContextNote },
  async () => {
    const [snapshot, files] = await Promise.all([
      read('../../internal/panels/snapshots/boss-log.json').then(JSON.parse),
      readdir(new URL('../src/assets/icons/bosses', import.meta.url)),
    ]);
    const slugs = new Set(snapshot.data.bosses.map((boss) => bossSlug(boss.name)));
    assert.ok(slugs.size > 0, 'the origin data names no bosses; the pin has nothing to protect');
    const icons = files.filter((file) => file.endsWith('.png'));
    assert.ok(icons.length > 0, 'no icons ship; the pin has nothing to protect');
    for (const icon of icons) {
      assert.ok(
        slugs.has(icon.replace(/\.png$/, '')),
        `icon ${icon} matches no boss the origin serves — third-party art must never outlive the data that justifies it`
      );
    }
  }
);

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
});
