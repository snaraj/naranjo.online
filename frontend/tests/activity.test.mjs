import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it, test } from 'node:test';

import {
  activityLevel,
  activityLevels,
  activityPanelId,
  cellDate,
  cellLabel,
  maxDailyCount,
  parseVCSActivity
} from '../src/lib/activity.ts';

// A well-formed vcs-activity/v1 payload in the exact shape internal/panels
// serves; tests clone and break one field at a time so every admission rule
// is exercised.
const goodActivity = {
  totalContributions: 1287,
  weeks: [
    [0, 2, 4, 1, 0, 3, 5],
    [2, 6, 3, 0, 1, 4, 2]
  ],
  streak: 9,
  recentCommits: [
    { repo: 'fixture-repo', message: 'fixture: subject line', at: '2026-08-11T00:12:00Z' }
  ]
};

describe('parseVCSActivity', () => {
  it('admits the exact served contract', () => {
    const activity = parseVCSActivity(goodActivity);
    assert.notEqual(activity, null);
    assert.equal(activity.totalContributions, 1287);
    assert.equal(activity.streak, 9);
    assert.equal(activity.weeks.length, 2);
    assert.deepEqual(activity.weeks[0], [0, 2, 4, 1, 0, 3, 5]);
    assert.equal(activity.recentCommits[0].repo, 'fixture-repo');
  });

  it('admits the degenerate empty window', () => {
    const activity = parseVCSActivity({
      totalContributions: 0,
      weeks: [],
      streak: 0,
      recentCommits: []
    });
    assert.notEqual(activity, null);
    assert.deepEqual(activity.weeks, []);
    assert.deepEqual(activity.recentCommits, []);
  });

  it('returns null for every off-contract payload', () => {
    const broken = [
      null,
      [],
      'activity',
      7,
      { ...goodActivity, totalContributions: -1 },
      { ...goodActivity, totalContributions: 'many' },
      { ...goodActivity, streak: Number.NaN },
      { ...goodActivity, weeks: 5 },
      { ...goodActivity, weeks: [[1, 2, 3]] },
      { ...goodActivity, weeks: [[0, 1, 2, 3, 4, 5, 6, 7]] },
      { ...goodActivity, weeks: [[0, 1, 2, 3, 4, 5, -1]] },
      { ...goodActivity, weeks: [[0, 1, 2, 3, 4, 5, 'six']] },
      { ...goodActivity, recentCommits: 'none' },
      { ...goodActivity, recentCommits: [null] },
      { ...goodActivity, recentCommits: [{ repo: '', message: 'm', at: 't' }] },
      { ...goodActivity, recentCommits: [{ repo: 'r', at: 't' }] },
      { ...goodActivity, recentCommits: [{ repo: 'r', message: 7, at: 't' }] },
      { ...goodActivity, recentCommits: [{ repo: 'r', message: 'm', at: 12 }] },
      (() => {
        const { streak: _dropped, ...rest } = goodActivity;
        return rest;
      })()
    ];
    for (const payload of broken) {
      assert.equal(parseVCSActivity(payload), null);
    }
  });
});

describe('activity levels', () => {
  it('keeps zero days at level 0 and buckets the rest against the peak', () => {
    assert.equal(activityLevels, 5);
    assert.equal(activityLevel(0, 8), 0);
    assert.equal(activityLevel(0, 0), 0);
    assert.equal(activityLevel(3, 0), 0);
    assert.equal(activityLevel(1, 100), 1);
    assert.equal(activityLevel(2, 8), 1);
    assert.equal(activityLevel(4, 8), 2);
    assert.equal(activityLevel(5, 8), 3);
    assert.equal(activityLevel(8, 8), 4);
    assert.equal(activityLevel(80, 8), 4);
  });

  it('never decreases as the count grows', () => {
    let previous = 0;
    for (let count = 0; count <= 12; count += 1) {
      const level = activityLevel(count, 12);
      assert.ok(level >= previous, `level regressed at count ${count}`);
      previous = level;
    }
    assert.equal(previous, 4);
  });

  it('finds the window peak', () => {
    assert.equal(maxDailyCount(goodActivity.weeks), 6);
    assert.equal(maxDailyCount([]), 0);
    assert.equal(maxDailyCount([[0, 0, 0, 0, 0, 0, 0]]), 0);
  });
});

describe('cell dates and labels', () => {
  it('anchors the last cell of the last week on the capture day', () => {
    assert.equal(cellDate('2026-08-11T01:00:00Z', 5, 4, 6), '2026-08-11');
    assert.equal(cellDate('2026-08-11T01:00:00Z', 5, 4, 5), '2026-08-10');
    assert.equal(cellDate('2026-08-11T01:00:00Z', 5, 3, 6), '2026-08-04');
    assert.equal(cellDate('2026-08-11T01:00:00Z', 5, 0, 0), '2026-07-08');
    // Month and year boundaries roll over through real calendar arithmetic.
    assert.equal(cellDate('2026-01-03T12:00:00Z', 1, 0, 0), '2025-12-28');
  });

  it('yields no date for absent or malformed instants', () => {
    assert.equal(cellDate(undefined, 5, 0, 0), '');
    assert.equal(cellDate('', 5, 0, 0), '');
    assert.equal(cellDate('yesterday-ish', 5, 0, 0), '');
  });

  it('always carries the count in the accessible label', () => {
    assert.equal(cellLabel(1, '2026-08-11'), '1 contribution on 2026-08-11');
    assert.equal(cellLabel(4, '2026-08-10'), '4 contributions on 2026-08-10');
    assert.equal(cellLabel(0, '2026-08-09'), '0 contributions on 2026-08-09');
    assert.equal(cellLabel(3, ''), '3 contributions');
  });

  it('pins the panel id the strip loads', () => {
    assert.equal(activityPanelId, 'vcs-activity');
  });
});

const [component, appShell, helpers] = await Promise.all([
  readFile(new URL('../src/lib/components/ActivityBar.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/activity.ts', import.meta.url), 'utf8')
]);

// Browser execution is deliberately outside this dependency-free test; these
// assertions pin the component source's structural contracts the same way
// experience.test.mjs pins the shells.
test('the strip never encodes a count by color alone', () => {
  // Each day cell carries its date+count as tooltip and accessible label.
  assert.match(component, /data-activity-cell/);
  assert.match(component, /aria-label=\{label\}/);
  assert.match(component, /title=\{label\}/);
  assert.match(component, /role="img"/);
  // Totals and streak ride beside the strip as plain text.
  assert.match(component, /contributions</);
  assert.match(component, /-day streak</);
});

test('the cell ramp is themeable custom properties with the validated dark defaults', () => {
  // One custom property per level; the defaults are the validated sequential
  // ramp (single hue, monotone lightness, dark-surface anchored). A hex
  // change here must re-run the ramp validation — that is the point of the pin.
  for (const [level, hex] of [
    [0, '#383835'],
    [1, '#1c5cab'],
    [2, '#2a78d6'],
    [3, '#5598e7'],
    [4, '#86b6ef']
  ]) {
    assert.match(
      component,
      new RegExp(`var\\(--activity-cell-${level}, ${hex}\\)`),
      `level ${level} must default to the validated ${hex}`
    );
  }
  // No raw color may bypass the variable layer: every color literal in the
  // style block sits inside a var() default. The literal is matched text, so
  // it is escaped COMPLETELY before entering a pattern — every regex
  // metacharacter including backslash, not just the expected few — so a
  // literal this scan has never seen can only fail the assertion honestly,
  // never distort the pattern it is checked with (CodeQL
  // js/incomplete-sanitization).
  const escapeRegExp = (text) => text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  const styles = component.slice(component.indexOf('<style>'));
  for (const literal of styles.match(/(?:#[0-9a-f]{3,8}|rgba?\([^)]*\))/gi) ?? []) {
    assert.match(
      styles,
      new RegExp(`var\\(--[a-z0-9-]+, ${escapeRegExp(literal)}\\)`),
      `color literal ${literal} must be a custom-property default`
    );
  }
});

test('the strip owns fixed geometry and its own overflow', () => {
  // Fixed block sizes per region: data arriving never shifts layout.
  assert.match(component, /\.activity-strip \{[^}]*block-size: 6\.25rem/);
  assert.match(component, /\.activity-totals \{[^}]*block-size: 1\.25rem/);
  assert.match(component, /\.activity-commits \{[^}]*block-size: 5\.625rem/);
  // A wide window scrolls inside the strip, never the page.
  assert.match(component, /\.activity-strip \{[^}]*overflow-x: auto/);
  // The bar is out of the document flow and bounded against the viewport.
  assert.match(component, /position: fixed/);
  assert.match(component, /calc\(100vw - 1\.5rem\)/);
});

test('activity sources stay local-origin and provider-neutral', () => {
  for (const [name, source] of Object.entries({ component, helpers })) {
    assert.doesNotMatch(source, /(?:https?:)?\/\//, `${name} introduces a remote origin`);
    // The panel is provider-neutral: the data's origin never names itself in
    // frontend source (mirrors the vcs-activity naming in internal/panels).
    assert.doesNotMatch(source, /git\s?hub/i, `${name} names the data's origin`);
  }
});

test('the app mounts exactly one activity line per fence', () => {
  const importLines = appShell.match(/^.*import ActivityBar from '\.\/lib\/components\/ActivityBar\.svelte';.*$/gm);
  assert.equal(importLines?.length, 1, 'exactly one ActivityBar import line');
  const mountLines = appShell.match(/^\s*<ActivityBar \/>\s*$/gm);
  assert.equal(mountLines?.length, 1, 'exactly one ActivityBar mount line');
  // Each line sits inside its designated fence pair.
  assert.match(
    appShell,
    /panels:imports:begin[\s\S]*import ActivityBar[\s\S]*panels:imports:end/
  );
  assert.match(appShell, /panels:mount:begin[\s\S]*<ActivityBar \/>[\s\S]*panels:mount:end/);
});
