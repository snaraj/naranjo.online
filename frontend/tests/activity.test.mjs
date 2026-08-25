import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it, test } from 'node:test';

import {
  activityCells,
  activityPanelId,
  commitPullRequestNumber,
  commitReferenceLinkLabel,
  commitReferenceUrl,
  commitRepoLinkLabel,
  commitRepoUrl,
  commitShaLinkLabel,
  commitShaUrl,
  isValidCommitSha,
  isValidRepoSlug,
  parseVCSActivity
} from '../src/lib/activity.ts';
import { toColumns } from '../src/lib/grid.ts';
import { projectHost, projectHostLabel } from '../src/lib/projects.ts';

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
    {
      repo: 'fixture-repo',
      sha: '0123456789abcdef0123456789abcdef01234567',
      message: 'fixture: subject line',
      at: '2026-08-11T00:12:00Z'
    }
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
    assert.equal(activity.recentCommits[0].sha, '0123456789abcdef0123456789abcdef01234567');
  });

  it('admits an empty sha as truthful absence, unlike an empty repo', () => {
    // The embedded snapshot predates the SHA field and legitimately serves
    // "" for every one of its rows (internal/panels/snapshots/vcs-activity.json).
    // repo requires non-empty because the server never legitimately serves
    // one blank; sha does not, because an old row genuinely has none. The
    // shape check here is TYPE only — value validation for the URL these
    // rows might build lives at use time, in isValidCommitSha.
    const activity = parseVCSActivity({
      ...goodActivity,
      recentCommits: [{ repo: 'fixture-repo', sha: '', message: 'm', at: 't' }]
    });
    assert.notEqual(activity, null);
    assert.equal(activity.recentCommits[0].sha, '');
  });

  it('admits a sha key that is ENTIRELY ABSENT, not just empty, and normalizes it to "" (issue 157, Daybreak Blue round 3 finding 1)', () => {
    // Rolling-compatibility requirement, not a style choice: this chart runs
    // a RollingUpdate across multiple replicas, and this exact repository's
    // OWN preceding release served pre-this-PR vcs-activity/v1 rows with no
    // `sha` key in the JSON at all — not `sha: ""`, the key genuinely absent.
    // A browser holding this build can still reach an old replica mid-
    // rollout. Before this fix, an absent key failed the `typeof !== 'string'`
    // check exactly like a malformed one and rejected the WHOLE payload,
    // turning a routine deploy into a blank activity panel for every visitor
    // caught mid-rollout — Daybreak Blue proved this with a real intercepted
    // old-v1 payload. The row itself must admit, not just the key.
    const { sha: _omitted, ...rowWithoutSha } = {
      repo: 'fixture-repo',
      sha: 'irrelevant',
      message: 'm',
      at: 't'
    };
    assert.equal('sha' in rowWithoutSha, false, 'the fixture must genuinely omit the key, not merely set it falsy');
    const activity = parseVCSActivity({ ...goodActivity, recentCommits: [rowWithoutSha] });
    assert.notEqual(activity, null, 'a row with sha entirely absent must not reject the whole payload');
    assert.equal(activity.recentCommits[0].sha, '', 'an absent sha normalizes to "" exactly like an explicitly empty one');
  });

  it('admits a mixed-version payload — some rows with sha, some without — and preserves every other served fact (rolling-compatibility)', () => {
    // The realistic RollingUpdate shape: two replicas serving two different
    // builds at once produce a payload where SOME rows already carry sha
    // (the new replica) and others do not (the old one) in the SAME response,
    // because recentCommits is merged newest-first across repos server-side.
    // Nothing about totals, streak, or the OTHER served rows may degrade
    // because of the old-shaped rows mixed in.
    const activity = parseVCSActivity({
      totalContributions: 42,
      weeks: [[1, 2, 3, 4, 5, 6, 7]],
      streak: 3,
      recentCommits: [
        { repo: 'new-repo', sha: '0123456789abcdef0123456789abcdef01234567', message: 'from the new replica', at: 't1' },
        { repo: 'old-repo', message: 'from an old replica, no sha key at all', at: 't2' }
      ]
    });
    assert.notEqual(activity, null);
    assert.equal(activity.totalContributions, 42, 'the real total must survive, never fall back to 0');
    assert.equal(activity.streak, 3);
    assert.equal(activity.recentCommits.length, 2);
    assert.equal(activity.recentCommits[0].sha, '0123456789abcdef0123456789abcdef01234567');
    assert.equal(activity.recentCommits[1].sha, '', 'the old-replica row normalizes its absent sha to ""');
    assert.equal(activity.recentCommits[1].repo, 'old-repo', 'the old-replica row itself is not dropped');
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
      { ...goodActivity, recentCommits: [{ repo: 'r', sha: 40, message: 'm', at: 't' }] }, // sha PRESENT but not a string — a genuine decode fault, unlike an absent key (see the admission tests above)
      { ...goodActivity, recentCommits: [{ repo: 'r', sha: null, message: 'm', at: 't' }] }, // sha PRESENT but null
      { ...goodActivity, recentCommits: [{ repo: 'r', sha: true, message: 'm', at: 't' }] }, // sha PRESENT but boolean
      { ...goodActivity, endDate: 7 },
      { ...goodActivity, endDate: '2026-08-11T00:00:00Z' },
      { ...goodActivity, endDate: '11/08/2026' },
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

describe('activityCells', () => {
  // The final week is padded to seven days like every other, so on its own
  // the padding is indistinguishable from genuine quiet days. endDate is what
  // resolves it, and these tests are the reason it exists.
  const window = {
    totalContributions: 10,
    weeks: [
      [1, 2, 3, 4, 5, 6, 7],
      [8, 9, 0, 0, 0, 0, 0]
    ],
    streak: 2,
    // 2026-08-11 is a Tuesday: Sunday and Monday are real, the remaining
    // five days of that column have not happened yet.
    endDate: '2026-08-11',
    recentCommits: []
  };

  it('dates every cell from the end date and marks the uncovered tail absent', () => {
    const cells = activityCells(parseVCSActivity(window));
    assert.equal(cells.length, 14);
    assert.equal(cells[0].date, '2026-08-02', 'the first cell is a whole calendar week back');
    assert.equal(cells[7].date, '2026-08-09');
    assert.equal(cells[8].date, '2026-08-10');
    assert.equal(cells[9].date, '2026-08-11');
    assert.equal(cells[9].value, 0);
    assert.notEqual(cells[9].absent, true, 'the end date itself is covered, however quiet');
    for (const index of [10, 11, 12, 13]) {
      assert.equal(cells[index].absent, true, `cell ${index} is a day the window does not cover`);
      assert.equal(cells[index].value, 0);
    }
    assert.equal(cells[13].date, '2026-08-15', 'absent cells are still dated, so the axis stays honest');
  });

  it('renders undated counts rather than guessing when no end date is served', () => {
    const { endDate: _dropped, ...anchorless } = window;
    const cells = activityCells(parseVCSActivity(anchorless));
    assert.equal(cells.length, 14);
    for (const cell of cells) {
      assert.equal(cell.date, '', 'an unanchored window must not invent dates');
      assert.notEqual(cell.absent, true, 'nothing can be known absent without an anchor');
    }
    assert.equal(cells[8].value, 9, 'the counts themselves are real and still render');
  });

  // The padding derives from the end date's WEEKDAY, so the two extremes of
  // that arithmetic are the cases worth pinning: a Saturday end date covers
  // its whole column and pads nothing, a Sunday end date pads six.
  it('pads nothing when the window ends on a Saturday', () => {
    const saturday = parseVCSActivity({ ...window, endDate: '2026-08-15' });
    const cells = activityCells(saturday);
    assert.equal(cells.length, 14);
    for (const cell of cells) {
      assert.notEqual(cell.absent, true, 'a full final column has no uncovered days');
    }
    assert.equal(cells[13].date, '2026-08-15', 'the last cell IS the end date');
    assert.equal(cells[0].date, '2026-08-02');
  });

  it('pads six when the window ends on a Sunday', () => {
    const sunday = parseVCSActivity({ ...window, endDate: '2026-08-09' });
    const cells = activityCells(sunday);
    assert.equal(cells.length, 14);
    assert.equal(cells[7].date, '2026-08-09');
    assert.notEqual(cells[7].absent, true, 'the end date itself is covered');
    for (const index of [8, 9, 10, 11, 12, 13]) {
      assert.equal(cells[index].absent, true, `cell ${index} follows the end date`);
    }
    assert.equal(cells[8].date, '2026-08-10');
  });

  it('survives a malformed anchor and an empty window', () => {
    const activity = parseVCSActivity(window);
    assert.deepEqual(
      activityCells({ ...activity, endDate: '2026-13-45' }).map((cell) => cell.date),
      new Array(14).fill('')
    );
    assert.deepEqual(activityCells({ ...activity, weeks: [] }), []);
  });

  it('feeds whole columns to the shared grid', () => {
    const columns = toColumns(activityCells(parseVCSActivity(window)));
    assert.equal(columns.length, 2);
    for (const column of columns) {
      assert.equal(column.length, 7);
    }
  });

  it('pins the panel id the strip loads', () => {
    assert.equal(activityPanelId, 'vcs-activity');
  });
});

// ---------------------------------------------------------------------------
// Outbound navigation (issue 157) — every href is CONSTRUCTED from a
// validated field, never interpolated from the raw payload string. Each
// table below is a hostile-input suite: the "reject" rows are exactly the
// shapes a raw `${projectHost}/${repo}` (or an unanchored PR-number regex)
// would have happily turned into a link, so a reversion to unvalidated
// interpolation flips one of these from null to a real string and the
// assertion catches it — this IS the mutation kill matrix for this guard,
// not merely a smoke check.
// ---------------------------------------------------------------------------

describe('isValidRepoSlug / commitRepoUrl', () => {
  it('admits the host repository-name character set', () => {
    for (const repo of [
      'naranjo.online',
      'website-infrastructure',
      'lidersea.com',
      'foobar2000-lyricsbuddy',
      'a',
      '123',
      'A.b-C_d',
      'a'.repeat(100)
    ]) {
      assert.equal(isValidRepoSlug(repo), true, `${JSON.stringify(repo)} should validate`);
      assert.equal(commitRepoUrl(repo), `${projectHost}/${repo}`);
    }
  });

  it('rejects every shape that could break out of the href it would build', () => {
    const hostile = [
      '',
      ' ',
      'a b',
      'a/b',
      '../etc',
      '.git',
      '-repo',
      '_repo',
      'repo"',
      'repo<script>',
      'javascript:alert(1)',
      'a"onmouseover="x',
      'evil.com/x',
      'a\nb',
      'a\tb',
      'répo', // an accented character outside the host's ASCII set
      'a'.repeat(101) // one past the character ceiling
    ];
    for (const repo of hostile) {
      assert.equal(isValidRepoSlug(repo), false, `${JSON.stringify(repo)} must not validate`);
      assert.equal(
        commitRepoUrl(repo),
        null,
        `${JSON.stringify(repo)} must never become a URL — a non-null result here means the ` +
          'validator was bypassed and the raw string reached an href'
      );
    }
  });

  it('carries the same "opens in a new tab" convention the Coding Projects feed already uses', () => {
    assert.equal(
      commitRepoLinkLabel('naranjo.online'),
      `naranjo.online on ${projectHostLabel}, opens in a new tab`
    );
  });
});

describe('commitPullRequestNumber', () => {
  it('reads the trailing "(#N)" a squash-merged subject carries', () => {
    assert.equal(commitPullRequestNumber('release(0.1.34): six-lane bundle (#152)'), 152);
    assert.equal(commitPullRequestNumber('fix bug (#1)'), 1);
    assert.equal(commitPullRequestNumber('docs: x (#9999999)'), 9_999_999);
  });

  it('returns null for every subject that is not a clean trailing reference', () => {
    const nonNumeric = [
      'fixture: subject line', // no parenthetical at all
      'fix bug (#0)', // GitHub PR numbers start at 1
      'fix bug (#007)', // leading zero — not how the host writes one
      'fix bug (#12e3)', // not a pure integer
      'fix bug (#-5)', // not a positive integer
      'fix bug (#12) trailing text', // not anchored at the end
      'fix bug (#123456789)', // past the digit ceiling
      'fix bug (#1' // unterminated
    ];
    for (const message of nonNumeric) {
      assert.equal(
        commitPullRequestNumber(message),
        null,
        `${JSON.stringify(message)} must not resolve a PR number`
      );
    }
  });
});

describe('commitReferenceUrl', () => {
  it('builds an /issues/N destination — never /pull/N — only when BOTH the repo and the number validate', () => {
    // /issues/N rather than /pull/N is deliberate (issue 157, Daybreak
    // Blue's review, finding 1): the subject's trailing "(#N)" proves only
    // that this repository's own squash-merge convention wrote a number
    // there, never that N specifically names a pull request. GitHub's own
    // issue/PR numbering makes /issues/N land on exactly the right page
    // either way (it redirects to /pull/N when N is a pull request), so
    // this destination is correct without asserting more than the payload
    // can prove.
    assert.equal(
      commitReferenceUrl({ repo: 'naranjo.online', message: 'release (#152)' }),
      `${projectHost}/naranjo.online/issues/152`
    );
  });

  it('renders as plain text (returns null) when the repo is hostile, even with a real reference number', () => {
    assert.equal(commitReferenceUrl({ repo: 'evil.com/x', message: 'release (#152)' }), null);
  });

  it('renders as plain text (returns null) when no reference number resolves, even with a valid repo', () => {
    assert.equal(commitReferenceUrl({ repo: 'naranjo.online', message: 'fixture: subject line' }), null);
    assert.equal(commitReferenceUrl({ repo: 'naranjo.online', message: 'release (#12e3)' }), null);
  });

  it('states a NEUTRAL "reference, opens in a new tab" accessible name, never "pull request"', () => {
    // The label must not claim more than commitReferenceUrl itself proves —
    // see its own comment for why "pull request" would be an overstatement.
    assert.equal(
      commitReferenceLinkLabel('release (#152)'),
      'release (#152), reference, opens in a new tab'
    );
    assert.doesNotMatch(commitReferenceLinkLabel('release (#152)'), /pull request/);
  });
});

describe('destination precedence — sha over reference (issue 157, Daybreak Blue round 3 finding 3)', () => {
  // This exercises the SAME precedence rule ActivityBar.svelte's
  // {@const shaHref = commitShaUrl(commit)} / {@const referenceHref =
  // shaHref ? null : commitReferenceUrl(commit)} pair implements, computed
  // here directly from the two pure builders so the rule is proven
  // independent of the component's own markup (the structural test above
  // proves the MARKUP encodes this precedence; this proves the RULE ITSELF
  // is the one Daybreak asked for).
  function chooseDestination(commit) {
    const shaHref = commitShaUrl(commit);
    const referenceHref = shaHref ? null : commitReferenceUrl(commit);
    return { shaHref, referenceHref };
  }

  it('prefers the validated SHA permalink over an unverifiable trailing reference on the SAME row', () => {
    // The exact case Daybreak Blue's probe used: a proven commit identity
    // alongside a syntactically-valid but nothing-proves-it-real reference
    // number. Before this fix, the reference always won — an unverifiable
    // "(#9999999)" outlinked a commit this document could actually vouch
    // for.
    const commit = {
      repo: 'naranjo.online',
      sha: '0123456789abcdef0123456789abcdef01234567',
      message: 'handwritten reference to nowhere (#9999999)'
    };
    const { shaHref, referenceHref } = chooseDestination(commit);
    assert.equal(shaHref, `${projectHost}/naranjo.online/commit/0123456789abcdef0123456789abcdef01234567`);
    assert.equal(referenceHref, null, 'the reference destination must not be computed once a valid sha wins');
  });

  it('falls back to the reference destination only when no valid sha is present', () => {
    const commit = { repo: 'naranjo.online', sha: '', message: 'release (#152)' };
    const { shaHref, referenceHref } = chooseDestination(commit);
    assert.equal(shaHref, null);
    assert.equal(referenceHref, `${projectHost}/naranjo.online/issues/152`);
  });

  it('renders neither destination when both fail to validate', () => {
    const commit = { repo: 'naranjo.online', sha: '', message: 'fixture: subject line' };
    const { shaHref, referenceHref } = chooseDestination(commit);
    assert.equal(shaHref, null);
    assert.equal(referenceHref, null);
  });
});

describe('isValidCommitSha / commitShaUrl', () => {
  const validSha = '0123456789abcdef0123456789abcdef01234567';

  it('admits exactly 40 lowercase hex digits, matching internal/panels/mapping.go\'s isCommitIdentity', () => {
    assert.equal(isValidCommitSha(validSha), true);
    assert.equal(
      commitShaUrl({ repo: 'naranjo.online', sha: validSha }),
      `${projectHost}/naranjo.online/commit/${validSha}`
    );
  });

  it('rejects every shape that is not a real commit identity', () => {
    const hostile = [
      '', // the truthful-absence case every pre-existing snapshot row carries
      ' ',
      validSha.slice(0, 39), // one short
      `${validSha}0`, // one long
      validSha.toUpperCase(), // the server writes lowercase only
      `${validSha.slice(0, 33)}"onmouseover="x`, // injection attempt shaped like a real prefix
      'not-hex-at-all-'.padEnd(40, 'g'),
      `${validSha}\n`,
      `../${validSha}`
    ];
    for (const sha of hostile) {
      assert.equal(isValidCommitSha(sha), false, `${JSON.stringify(sha)} must not validate`);
      assert.equal(
        commitShaUrl({ repo: 'naranjo.online', sha }),
        null,
        `${JSON.stringify(sha)} must never become a URL — a non-null result here means the ` +
          'validator was bypassed and the raw string reached an href'
      );
    }
  });

  it('renders as plain text (returns null) when the repo is hostile, even with a valid sha', () => {
    assert.equal(commitShaUrl({ repo: 'evil.com/x', sha: validSha }), null);
  });

  it('states the "commit <short sha>, opens in a new tab" accessible name, using the 7-digit short form', () => {
    assert.equal(
      commitShaLinkLabel('release notes', validSha),
      `release notes, commit ${validSha.slice(0, 7)}, opens in a new tab`
    );
  });
});

const [component, appShell, helpers, grid] = await Promise.all([
  readFile(new URL('../src/lib/components/ActivityBar.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/activity.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/components/ContributionGrid.svelte', import.meta.url), 'utf8')
]);

// Browser execution is deliberately outside this dependency-free test; these
// assertions pin the component source's structural contracts the same way
// experience.test.mjs pins the shells.
test('the calendar renders through the one shared grid component', () => {
  // The ramp, the cell labels, the month axis, and the absent-day rendering
  // live in ContributionGrid — the same component the token-activity heatmap
  // uses — so the two grids cannot drift apart.
  assert.match(component, /import ContributionGrid from '\.\/ContributionGrid\.svelte'/);
  assert.match(component, /<ContributionGrid/);
  assert.match(component, /noun="contribution"/);
  // Totals and streak ride beside the grid as plain text, so a count is
  // never encoded by color alone.
  assert.match(component, /contributions</);
  assert.match(component, /-day streak</);
  assert.match(component, /formatWhole\(activity\.totalContributions\)/);
});

test('an empty commit list says so instead of showing invented history', () => {
  assert.match(component, /\{#if commits\.length === 0\}/);
  assert.match(component, /no recent commits reported/);
});

test('the cell ramp is themeable custom properties with the validated dark defaults', () => {
  // One custom property per level; the defaults are the validated sequential
  // ramp (single hue, monotone lightness, dark-surface anchored). A hex
  // change here must re-run the ramp validation — that is the point of the
  // pin. The ramp now lives in the shared grid component.
  for (const [level, hex] of [
    [0, '#383835'],
    [1, '#1c5cab'],
    [2, '#2a78d6'],
    [3, '#5598e7'],
    [4, '#86b6ef']
  ]) {
    assert.match(
      grid,
      new RegExp(`var\\(--grid-cell-${level}, ${hex}\\)`),
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
  const styles = grid.slice(grid.indexOf('<style>'));
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
  assert.match(grid, /\.grid-strip \{[^}]*block-size: 7rem/);
  assert.match(component, /\.activity-totals \{[^}]*block-size: 1\.25rem/);
  // Five rows at the 44px touch floor (issue 157): every commit row carries
  // two real links now, so the fixed reservation grew from 5.625rem to
  // 13.75rem (5 * 2.75rem) rather than staying a decorative-text height.
  assert.match(component, /\.activity-commits \{[^}]*block-size: 13\.75rem/);
  assert.match(component, /\.activity-commit \{[^}]*min-block-size: 2\.75rem/);
  // A wide window scrolls inside the strip, never the page.
  assert.match(grid, /\.grid-strip \{[^}]*overflow-x: auto/);
  // The panel is an ordinary block in the page's stack. It used to dock to
  // the viewport's bottom-start corner, which meant the page had to reserve a
  // strip for a bar that overlaid it AND the bar had to bound its own height
  // against that same reserve so the two could not disagree — two facts that
  // only existed because it floated. It takes the column's width now, so it
  // declares neither.
  assert.match(component, /\.activity-bar \{[^}]*display: block/);
  assert.doesNotMatch(component, /position: fixed/, 'the panel must not dock again');
  assert.doesNotMatch(component, /--page-activity-gutter/, 'a card reserves no gutter');
});

test('every commit-row href is built from the validated helpers, never raw interpolation', () => {
  // The structural half of the mutation guard above: even if a hostile
  // payload could somehow slip past the pure-function tests, this pins that
  // the COMPONENT never has a second, unvalidated way to build a link. A
  // mutation that inlined `href={`${projectHost}/${commit.repo}`}` (or any
  // other direct interpolation of a commit field — repo, message, OR the
  // newer sha — into an href) would match this pattern and fail the
  // assertion below.
  assert.doesNotMatch(
    component,
    /href=\{[^}]*commit\.(?:repo|message|sha)[^}]*\}/,
    'a commit field must never be interpolated directly into an href — go through the const below'
  );
  // Every href is bound once, from the imported validators, before the
  // markup ever reads it. The message cell tries its SHA-permalink
  // destination FIRST and its reference destination only once that
  // resolves to null (referenceHref is computed FROM shaHref's own
  // nullness, never independently, so the two branches can never both fire
  // for one row). This precedence — SHA over syntactic reference — is
  // itself the fix for Daybreak Blue's round-3 finding 3: shaHref is the
  // one association this document can actually prove, so an unverifiable
  // trailing "(#N)" must never outrank it. A mutation that swapped this
  // order back (referenceHref computed unconditionally, shaHref gated on
  // referenceHref's nullness) would fail this exact assertion.
  assert.match(component, /\{@const repoHref = commitRepoUrl\(commit\.repo\)\}/);
  assert.match(component, /\{@const shaHref = commitShaUrl\(commit\)\}/);
  assert.match(component, /\{@const referenceHref = shaHref \? null : commitReferenceUrl\(commit\)\}/);
  assert.match(component, /href=\{repoHref\}/);
  assert.match(component, /href=\{referenceHref\}/);
  assert.match(component, /href=\{shaHref\}/);
  // A row the validators reject falls back to a plain <span> carrying the
  // same escaped interpolation — never a link, never markup.
  assert.match(component, /\{#if repoHref\}/);
  assert.match(component, /<span class="activity-commit-repo">\{commit\.repo\}<\/span>/);
  assert.match(component, /\{#if shaHref\}/);
  assert.match(component, /\{:else if referenceHref\}/);
  assert.match(
    component,
    /<span class="activity-commit-message" title=\{commit\.message\}>\{commit\.message\}<\/span>/
  );
  // Text, never markup: this component must never reach for {@html} anywhere,
  // now that three of its fields are payload-controlled link targets.
  assert.doesNotMatch(component, /\{@html/, 'commit fields must never render as markup');
  // All three outbound-link branches close the same way: a new tab that says
  // so, and the two attributes the threat model requires on anything
  // leaving the page. Only one of the message cell's two branches ever
  // renders for a given row, but both exist in the SOURCE, so the static
  // count is three (repo, reference, sha) even though a rendered row shows
  // at most two anchors.
  const targetBlank = component.match(/target="_blank"/g) ?? [];
  const relSafe = component.match(/rel="noopener noreferrer"/g) ?? [];
  assert.equal(targetBlank.length, 3, 'all three anchor branches must open a new tab');
  assert.equal(relSafe.length, 3, 'all three anchor branches must carry rel="noopener noreferrer"');
  assert.match(component, /aria-label=\{commitRepoLinkLabel\(commit\.repo\)\}/);
  assert.match(component, /aria-label=\{commitReferenceLinkLabel\(commit\.message\)\}/);
  assert.match(component, /aria-label=\{commitShaLinkLabel\(commit\.message, commit\.sha\)\}/);
});

test('activity sources stay local-origin and provider-neutral', () => {
  for (const [name, source] of Object.entries({ component, helpers, grid })) {
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
