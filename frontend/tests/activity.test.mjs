import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it, test } from 'node:test';

import {
  activityCells,
  activityEntriesNote,
  activityFiguresNote,
  activityPanelId,
  commitPullRequestNumber,
  commitReferenceLinkLabel,
  commitReferenceUrl,
  commitRepoLinkLabel,
  commitRepoUrl,
  commitShaLinkLabel,
  commitShaUrl,
  commitTitleLink,
  isValidCommitSha,
  isValidRepoSlug,
  parseVCSActivity,
  shownEntryRows,
  vcsActivityProps
} from '../src/lib/activity.ts';
import { toColumns } from '../src/lib/grid.ts';
import { projectHost, projectHostLabel } from '../src/lib/projects.ts';
import {
  applyScrollbarGutter,
  measureScrollbarPx,
  scrollbarGutterFallbackPx,
  scrollbarGutterProperty,
  scrollbarGutterPx
} from '../src/lib/scrollbar.ts';

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

  it('admits sha presence/absence independently per row — schema tolerance as defense-in-depth, not a claim about one response\'s shape', () => {
    // One HTTP request reaches exactly one replica, and that replica alone
    // builds its whole recentCommits response — a single response can never
    // itself mix a new-shape row and an old-shape row, because it has only
    // one server-side build behind it. The REAL RollingUpdate case this
    // repository actually serves is a wholly OLD-shape response (every row
    // missing `sha`) reaching a browser holding the NEW frontend during a
    // rollout — covered separately by the browser-lane test below
    // ("an old-shape vcs-activity/v1 payload with no sha key on any row..."),
    // which Daybreak Blue confirmed live with a real intercepted payload.
    // This unit test instead proves a narrower, still-useful property:
    // admission decides EACH row's sha independently of every other row's,
    // rather than deriving one payload-wide "shape" and applying it
    // uniformly — schema tolerance as defense-in-depth against whatever
    // future path might otherwise produce a genuinely mixed response (a
    // hand-built fixture, a future merge strategy, a partial cache), not a
    // claim that today's server ever does. Nothing about totals, streak, or
    // the other served rows may degrade because of an old-shaped row mixed
    // into this fixture.
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
  // commitTitleLink is the ONE place the rule lives (issue 165): the
  // adapter hands its result straight to the generic component, which
  // renders whatever href it is given and computes none of its own. These
  // tests execute that production function directly, so the rule is proven
  // where it is decided — a swapped order (reference consulted before the
  // sha) flips the winning href below and fails here.

  it('prefers the validated SHA permalink over an unverifiable trailing reference on the SAME row', () => {
    // The exact case Daybreak Blue's probe used: a proven commit identity
    // alongside a syntactically-valid but nothing-proves-it-real reference
    // number. Before this fix, the reference always won — an unverifiable
    // "(#9999999)" outlinked a commit this document could actually vouch
    // for.
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const commit = {
      repo: 'naranjo.online',
      sha,
      message: 'handwritten reference to nowhere (#9999999)'
    };
    const title = commitTitleLink(commit);
    assert.equal(title.href, `${projectHost}/naranjo.online/commit/${sha}`);
    assert.doesNotMatch(title.href, /issues\/9999999/, 'a syntactic guess must never outrank the proven identity');
    assert.equal(title.label, commitShaLinkLabel(commit.message, sha));
  });

  it('falls back to the reference destination only when no valid sha is present', () => {
    const title = commitTitleLink({ repo: 'naranjo.online', sha: '', message: 'release (#152)' });
    assert.equal(title.href, `${projectHost}/naranjo.online/issues/152`);
    assert.equal(title.label, commitReferenceLinkLabel('release (#152)'));
  });

  it('renders neither destination when both fail to validate', () => {
    const title = commitTitleLink({ repo: 'naranjo.online', sha: '', message: 'fixture: subject line' });
    assert.equal(title.href, null, 'plain text is the honest state when nothing validates');
    assert.equal(title.text, 'fixture: subject line');
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

const [component, manifest, binding, helpers, grid] = await Promise.all([
  readFile(new URL('../src/lib/components/ActivityTracker.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/page.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/blocks/vcsActivity.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/activity.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/components/ContributionGrid.svelte', import.meta.url), 'utf8')
]);

// Browser execution is deliberately outside this dependency-free test; these
// assertions pin the component source's structural contracts the same way
// experience.test.mjs pins the shells. What the component used to compute it
// now receives (issue 165): the adapter below is EXECUTED, and the component
// pins hold that the generic tracker renders exactly what it is handed.
test('the calendar renders through the one shared grid component', () => {
  // The ramp, the cell labels, the month axis, and the absent-day rendering
  // live in ContributionGrid — the same component the usage tracker's
  // heatmap uses — so the two grids cannot drift apart.
  assert.match(component, /import ContributionGrid from '\.\/ContributionGrid\.svelte'/);
  assert.match(component, /<ContributionGrid/);
  assert.match(component, /noun=\{strip\.noun\}/);
  // Totals and streak ride beside the grid as plain text, so a count is
  // never encoded by color alone. The words arrive as data with the figure.
  assert.match(component, /<span><strong>\{figure\.lead\}<\/strong>\{figure\.rest\}<\/span>/);
});

test('the adapter renders the figures, the strip, and the noun the panel always showed', () => {
  const envelope = {
    schema: 'panel/v1',
    id: activityPanelId,
    kind: 'vcs-activity/v1',
    title: 'Fixture Activity',
    status: 'ok',
    generatedAt: '2026-08-11T00:12:00Z',
    data: goodActivity
  };
  const rendered = vcsActivityProps(envelope);
  assert.equal(rendered.title, 'Fixture Activity');
  assert.equal(rendered.status, 'ok');
  assert.equal(rendered.generatedAt, '2026-08-11T00:12:00Z');
  assert.deepEqual(
    rendered.figures.map((figure) => figure.lead + figure.rest),
    ['1,287 contributions', '9-day streak'],
    'the two headline figures read exactly as the panel always has'
  );
  assert.equal(rendered.strip.noun, 'contribution');
  assert.equal(rendered.strip.label, 'contribution calendar: 2 weeks of daily counts, newest last');
  assert.deepEqual(rendered.strip.columns, toColumns(activityCells(parseVCSActivity(goodActivity))));
  // The payload renders only under its pinned kind: a mislabeled envelope is
  // the honest empty state, exactly as the retired component decided it.
  const mislabeled = vcsActivityProps({ ...envelope, kind: 'boss-log/v1' });
  assert.deepEqual(mislabeled.figures, []);
  assert.deepEqual(mislabeled.strip.columns, []);
  assert.equal(mislabeled.strip.label, 'contribution calendar');
});

test('an empty commit list says so instead of showing invented history', () => {
  assert.match(component, /\{#if entries\.length === 0\}/);
  assert.match(component, /\{entriesNote\}/);
  // The wording is the adapter's, verbatim from the retired component.
  assert.equal(activityEntriesNote, 'no recent commits reported');
  assert.equal(activityFiguresNote, 'no activity data');
  assert.equal(vcsActivityProps(null).entriesNote, 'no recent commits reported');
  assert.equal(vcsActivityProps(null).figuresNote, 'no activity data');
  assert.equal(vcsActivityProps(null).strip.emptyNote, 'activity data unavailable');
  assert.equal(vcsActivityProps(null).title, 'Version-control activity');
  assert.equal(vcsActivityProps(null).status, 'unavailable');
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
  //
  // The strip's own box is DERIVED now (issue 130) rather than stated as one
  // number. It read `block-size: 7rem` under a comment claiming "5.5rem of
  // cells, 0.75rem of month axis, 0.75rem of scrollbar gutter" — arithmetic
  // that only came to 7rem because it had forgotten the month axis's own
  // 0.1875rem top margin, leaving 9px of real reserve for a scrollbar that is
  // 15px on a classic Windows or Linux theme. Every term below is the SAME
  // token the thing it measures is laid out with, so a box computed from one
  // set of numbers while its contents are drawn from another is no longer
  // expressible.
  const stripBox = /\.grid-strip \{[^}]*?block-size: calc\(([\s\S]*?)\);/.exec(grid);
  assert.ok(stripBox, 'the strip no longer derives its own block size from its rows');
  for (const term of [
    '7 * var(--grid-cell-size, 0.625rem)',
    '6 * var(--grid-cell-gap, 0.1875rem)',
    'var(--grid-month-gap, 0.1875rem)',
    'var(--grid-month-size, 0.75rem)',
    `var(${scrollbarGutterProperty}, 0.75rem)`,
  ]) {
    assert.ok(
      stripBox[1].replace(/\s+/g, ' ').includes(term),
      `the strip's box no longer accounts for "${term}"`
    );
  }
  // ...and the two axis terms are what .grid-months is actually laid out
  // with, or the box and its contents are two different measurements again.
  assert.match(grid, /\.grid-months \{[^}]*margin: var\(--grid-month-gap, 0\.1875rem\) 0 0/);
  assert.match(grid, /\.grid-months \{[^}]*block-size: var\(--grid-month-size, 0\.75rem\)/);
  assert.match(component, /\.activity-totals \{[^}]*block-size: 1\.25rem/);
  // Five rows at the 44px touch floor (issue 157): every entry row can carry
  // two real links, so the fixed reservation grew from 5.625rem to
  // 13.75rem (5 * 2.75rem) rather than staying a decorative-text height. The
  // reservation is written as that multiplication, and this pin recomputes it
  // from shownEntryRows and the row's own floor — so the box and the number
  // of rows the adapter hands it cannot drift apart.
  const rowFloorRem = 2.75;
  assert.match(
    component,
    new RegExp(`\\.activity-entries \\{[^}]*block-size: calc\\(${shownEntryRows} \\* ${rowFloorRem}rem\\)`)
  );
  assert.match(component, new RegExp(`\\.activity-entry \\{[^}]*min-block-size: ${rowFloorRem}rem`));
  // The row separator is an INSET SHADOW, never a border (owner directive,
  // 2026-08-25): a border would add its pixel to every row's box and five of
  // them would push the last row out of a reservation that is exactly five
  // rows tall — the zero-CLS reserve turned into a clipped row.
  assert.match(component, /\.activity-entry \{[^}]*box-shadow: inset 0 -1px 0 var\(--panel-border/);
  assert.match(component, /\.activity-entry:last-child \{[^}]*box-shadow: none/);
  assert.doesNotMatch(
    component,
    /\.activity-entry \{[^}]*border-block-end/,
    'a row separator drawn as a border grows the row box the reservation is built on'
  );
  // The reservation and the row cap agree by construction: the adapter shows
  // at most the rows the fixed box holds.
  assert.equal(shownEntryRows, 5);
  const overfull = vcsActivityProps({
    schema: 'panel/v1',
    id: activityPanelId,
    kind: 'vcs-activity/v1',
    title: 'Fixture Activity',
    status: 'ok',
    data: {
      ...goodActivity,
      recentCommits: Array.from({ length: 9 }, (_, index) => ({
        repo: 'fixture-repo',
        message: `fixture: subject ${index}`,
        at: '2026-08-11T00:12:00Z'
      }))
    }
  });
  assert.equal(overfull.entries.length, 5, 'the payload may carry more rows; the rest do not render');
  // A wide window scrolls inside the strip, never the page.
  assert.match(grid, /\.grid-strip \{[^}]*overflow-x: auto/);
  // The panel is an ordinary block in the page's stack. It used to dock to
  // the viewport's bottom-start corner, which meant the page had to reserve a
  // strip for a bar that overlaid it AND the bar had to bound its own height
  // against that same reserve so the two could not disagree — two facts that
  // only existed because it floated. It takes the column's width now, so it
  // declares neither.
  assert.match(component, /\.activity-tracker \{[^}]*display: block/);
  assert.doesNotMatch(component, /position: fixed/, 'the panel must not dock again');
  assert.doesNotMatch(component, /--page-activity-gutter/, 'a card reserves no gutter');
});

test('every entry-row href is built by the validated helpers, and the component builds none', () => {
  // The adapter half, EXECUTED with a hostile payload: a repo that fails the
  // slug pattern, a subject that resolves no reference, and a sha shaped
  // like an injection must all arrive at the component as null hrefs — the
  // plain-text branch — while their text survives verbatim as data. A
  // reversion to raw interpolation inside the adapter flips one of these
  // from null to a string and fails here. The title destinations encode the
  // precedence Daybreak Blue asked for (round 3, finding 3): the validated
  // SHA permalink outranks the trailing "(#N)" reference, and the reference
  // is consulted only when no valid sha exists for the same row.
  const validSha = '0123456789abcdef0123456789abcdef01234567';
  const hostileSha = `${validSha.slice(0, 33)}"onmouseover="x`;
  const hostile = vcsActivityProps({
    schema: 'panel/v1',
    id: activityPanelId,
    kind: 'vcs-activity/v1',
    title: 'Fixture Activity',
    status: 'ok',
    data: {
      ...goodActivity,
      recentCommits: [
        { repo: 'evil.com/x', sha: '', message: 'release (#152)', at: '2026-08-11T00:12:00Z' },
        { repo: 'naranjo.online', sha: '', message: 'fixture: subject line', at: '2026-08-11T00:12:00Z' },
        { repo: 'naranjo.online', sha: '', message: 'release (#152)', at: '2026-08-11T00:12:00Z' },
        { repo: 'naranjo.online', sha: validSha, message: 'a commit with no trailing reference', at: '2026-08-11T00:12:00Z' },
        { repo: 'naranjo.online', sha: hostileSha, message: 'release (#152)', at: '2026-08-11T00:12:00Z' }
      ]
    }
  });
  const [badRepo, noReference, referenced, shaOnly, badSha] = hostile.entries;
  assert.equal(badRepo.source.href, null, 'a hostile repo must never become an href');
  assert.equal(badRepo.source.text, 'evil.com/x', 'the text still renders, as text');
  assert.equal(badRepo.title.href, null, 'a hostile repo poisons the entry link too');
  assert.equal(noReference.source.href, `${projectHost}/naranjo.online`);
  assert.equal(
    noReference.title.href,
    null,
    'a subject with no reference and no sha renders as plain text'
  );
  // /issues/N, never /pull/N, and a neutral "reference" accessible name —
  // the destination and label commitReferenceUrl's own tests justify above.
  assert.equal(referenced.title.href, `${projectHost}/naranjo.online/issues/152`);
  assert.equal(referenced.source.label, commitRepoLinkLabel('naranjo.online'));
  assert.equal(referenced.title.label, commitReferenceLinkLabel('release (#152)'));
  assert.match(referenced.age, /\S/, 'an entry states its age');
  // The sha-permalink branch: a row with a proven identity and no reference
  // still gets real navigation — its own commit.
  assert.equal(shaOnly.title.href, `${projectHost}/naranjo.online/commit/${validSha}`);
  assert.equal(
    shaOnly.title.label,
    commitShaLinkLabel('a commit with no trailing reference', validSha)
  );
  // A PRESENT-but-invalid sha loses only its own permalink capability: the
  // row falls back to its reference exactly as if it carried no sha at all,
  // and the hostile bytes never reach an href.
  assert.equal(badSha.title.href, `${projectHost}/naranjo.online/issues/152`);
  assert.doesNotMatch(badSha.title.href, /onmouseover/);

  // The structural half: the generic component renders the href it is handed
  // or renders text — it never assembles one. Any interpolation beyond the
  // two data fields would fail these pins.
  const hrefs = [...component.matchAll(/href=\{([^}]*)\}/g)].map(([, expression]) => expression);
  assert.deepEqual(
    hrefs.sort(),
    ['entry.source.href', 'entry.title.href'],
    'the component may render exactly the two validated hrefs and construct neither'
  );
  assert.match(component, /\{#if entry\.source\.href\}/);
  assert.match(component, /<span class="activity-entry-source">\{entry\.source\.text\}<\/span>/);
  assert.match(component, /\{#if entry\.title\.href\}/);
  assert.match(
    component,
    /<span class="activity-entry-title" title=\{entry\.title\.text\}>\{entry\.title\.text\}<\/span>/
  );
  // Text, never markup: this component must never reach for {@html} anywhere,
  // now that two of its fields are payload-controlled link targets.
  assert.doesNotMatch(component, /\{@html/, 'entry fields must never render as markup');
  // Both outbound links close the same way: a new tab that says so, and the
  // two attributes the threat model requires on anything leaving the page.
  const targetBlank = component.match(/target="_blank"/g) ?? [];
  const relSafe = component.match(/rel="noopener noreferrer"/g) ?? [];
  assert.equal(targetBlank.length, 2, 'both the source and the title anchor must open a new tab');
  assert.equal(relSafe.length, 2, 'both anchors must carry rel="noopener noreferrer"');
  assert.match(component, /aria-label=\{entry\.source\.label\}/);
  assert.match(component, /aria-label=\{entry\.title\.label\}/);
});

test('activity sources stay local-origin and provider-neutral', () => {
  for (const [name, source] of Object.entries({ component, helpers, grid })) {
    // Protocol-relative origins still fail this; a line comment no longer
    // does. The lookahead and the reasoning behind it are documented once, on
    // the same sweep in tests/experience.test.mjs.
    assert.doesNotMatch(source, /(?:https?:)?\/\/(?=[\w-]+\.)/, `${name} introduces a remote origin`);
    // The panel is provider-neutral: the data's origin never names itself in
    // frontend source (mirrors the vcs-activity naming in internal/panels).
    assert.doesNotMatch(source, /git\s?hub/i, `${name} names the data's origin`);
  }
});

/* The scrollbar gutter (issue 130), executed rather than pattern matched.
 *
 * The strip reserves room for a horizontal scrollbar inside a FIXED box,
 * because the box has to be identical before and after its data arrives. A
 * reserve is a guess about a length only the platform knows, and the guess was
 * short: 9px of real reserve against a 15px classic scrollbar, so the month
 * axis clipped on Linux and Windows. lib/scrollbar.ts measures it instead —
 * and the DECISION it makes from that measurement is a plain function, driven
 * here with the values a real platform produces. */
test('the scrollbar gutter is measured, floors at the shipped reserve, and never shrinks a strip', () => {
  // The stylesheet's fallback and the module's floor are ONE fact in two
  // places (the strip's calc() writes `0.75rem`, this module writes 12), so
  // the pin converts one into the other rather than restating either.
  assert.equal(scrollbarGutterFallbackPx, 12);
  const fallbackRem = /var\(--grid-scrollbar-size, ([\d.]+)rem\)/.exec(grid);
  assert.ok(fallbackRem, 'the strip no longer reads the measured gutter at all');
  assert.equal(
    Number(fallbackRem[1]) * 16,
    scrollbarGutterFallbackPx,
    'the stylesheet reserve and lib/scrollbar.ts’s floor disagree; they are one number'
  );

  // Overlay scrollbars (macOS, phones) measure zero and keep exactly the box
  // the page has always had: this may widen a strip, never narrow one, so no
  // platform loses layout to the fix.
  assert.equal(scrollbarGutterPx(0), scrollbarGutterFallbackPx);
  assert.equal(scrollbarGutterPx(11), scrollbarGutterFallbackPx);
  // A classic scrollbar is honoured, and a fractional one is rounded UP: a
  // gutter half a pixel short is a clipped row.
  assert.equal(scrollbarGutterPx(15), 15);
  assert.equal(scrollbarGutterPx(17), 17);
  assert.equal(scrollbarGutterPx(15.2), 16);
  // Nothing a host can fail to report is read as "no gutter".
  for (const nonsense of [Number.NaN, Number.POSITIVE_INFINITY, -4]) {
    assert.equal(scrollbarGutterPx(nonsense), scrollbarGutterFallbackPx);
  }

  // The probe itself, against a hand-written document: it must force the box
  // to scroll (`overflow: scroll`, not `auto` — the probe has no content, and
  // the question is how thick THIS platform's bar is, not whether one strip
  // happens to overflow), take it out of view, and remove it again.
  const events = [];
  const probe = {
    style: { cssText: '' },
    offsetHeight: 100,
    clientHeight: 85,
    remove: () => events.push('remove'),
  };
  const written = {};
  const doc = {
    createElement: (tag) => {
      events.push(`create:${tag}`);
      return probe;
    },
    body: { appendChild: () => events.push('append') },
    documentElement: { style: { setProperty: (name, value) => (written[name] = value) } },
  };
  assert.equal(measureScrollbarPx(doc), 15);
  assert.deepEqual(events, ['create:div', 'append', 'remove']);
  assert.match(probe.style.cssText, /overflow:scroll/);
  assert.doesNotMatch(probe.style.cssText, /overflow:auto/);
  assert.match(probe.style.cssText, /position:absolute/);

  // And the whole application: measure, decide, publish, under the name the
  // stylesheet reads.
  events.length = 0;
  assert.equal(applyScrollbarGutter(doc), 15);
  assert.deepEqual(written, { [scrollbarGutterProperty]: '15px' });
  // The same host with an overlay scrollbar publishes the floor instead.
  probe.clientHeight = probe.offsetHeight;
  assert.equal(applyScrollbarGutter(doc), scrollbarGutterFallbackPx);
  assert.deepEqual(written, { [scrollbarGutterProperty]: `${scrollbarGutterFallbackPx}px` });
});

test('the gutter is published before the application mounts, so no grid is re-laid', async () => {
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  const applied = main.indexOf('applyScrollbarGutter(document)');
  const mounted = main.indexOf('mount(App');
  assert.ok(applied > 0, 'main.ts never publishes the measured scrollbar gutter');
  assert.ok(
    applied < mounted,
    'the gutter is published after the application mounts, so every strip is laid out twice'
  );
});

test('the manifest mounts the activity block exactly once, bound to its panel', () => {
  // The fences retired with the table-of-contents App (issue 165): the
  // manifest IS the mount list, so the pin moves to it. Exactly one block
  // module binds the tracker to the panel id, and the trackers section lists
  // that block exactly once.
  const importLines = manifest.match(/^import \{ vcsActivity \} from '\.\/lib\/blocks\/vcsActivity\.ts';$/gm);
  assert.equal(importLines?.length, 1, 'exactly one import line for the activity block');
  const body = manifest.replace(/^import[^\n]*\n/gm, '');
  assert.equal(
    (body.match(/\bvcsActivity\b/g) ?? []).length,
    1,
    'the manifest lists the activity block exactly once'
  );
  assert.match(
    manifest,
    /section\('trackers', 'Trackers', \[tokenUsage, vcsActivity, osrsStats\], \{ layout: 'stack' \}\)/,
    'the trackers section lists the activity block in the stacked order the page renders'
  );
  assert.match(binding, /panelBlock\(\s*'vcs-activity',\s*ActivityTracker,\s*activityPanelId,\s*vcsActivityProps\s*\)/);
});
