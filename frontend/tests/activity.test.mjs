import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it, test } from 'node:test';

import {
  activityCells,
  activityEntriesNote,
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
  shownEntryRows
} from '../src/lib/activity.ts';
import { commitLogProps } from '../src/lib/commits.ts';
import { calendarColumns, pendingWeeks, toColumns } from '../src/lib/grid.ts';
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
      'dotfiles',
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

/* The calendar's own component and binding moved with the owner's ledger
   redesign (2026-09-03, issue 287): the contribution calendar is one of three
   the COMMITS section cycles between, so the component is CommitLog and the
   binding is a multi-panel one. The adapter these pins execute moved with it,
   to lib/commits.ts, where the two envelopes meet. */
const [component, manifest, binding, helpers, grid, sheet] = await Promise.all([
  readFile(new URL('../src/lib/components/CommitLog.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/page.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/blocks/commitLog.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/activity.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/components/ContributionGrid.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
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
  assert.match(component, /noun=\{active\.noun\}/);
  // ONE grid, not one per set: the segments swap the props the same instance
  // renders, so the strip's scroll position, its keyboard cursor and its
  // detail card all survive a set change instead of being three of each.
  assert.equal((component.match(/<ContributionGrid/g) ?? []).length, 1);
  // Totals and streak ride UNDER the grid as plain text, so a count is never
  // encoded by color alone. The words arrive as data with the figure — one
  // caption per set, because the set the reader chose is the set the sentence
  // has to be about.
  assert.match(component, /<p class="commit-caption">\{active\.caption\}<\/p>/);
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
  const rendered = commitLogProps([envelope, null]);
  assert.equal(rendered.title, 'Fixture Activity');
  assert.equal(rendered.status, 'ok');
  assert.equal(rendered.generatedAt, '2026-08-11T00:12:00Z');
  /* The two headline figures are the calendar's own CAPTION now (owner
     directive, 2026-09-03, issue 287): the section cycles three calendars and
     each one states its own reading under the grid, so a figures row belonging
     to only one of them would go stale the moment a reader pressed a segment.
     The words are the same words. */
  const contributions = rendered.sets[0];
  assert.equal(contributions.caption, '1,287 contributions · 9-day streak');
  assert.equal(contributions.noun, 'contribution');
  assert.equal(contributions.stripLabel, 'contribution calendar: 2 weeks of daily counts, newest last');
  assert.deepEqual(contributions.columns, toColumns(activityCells(parseVCSActivity(goodActivity))));
  // The payload renders only under its pinned kind: a mislabeled envelope is
  // the honest empty state, exactly as the retired component decided it.
  const mislabeled = commitLogProps([{ ...envelope, kind: 'boss-log/v1' }, null]);
  assert.deepEqual(mislabeled.rows, []);
  assert.deepEqual(mislabeled.sets[0].columns, []);
  assert.equal(mislabeled.sets[0].stripLabel, 'contribution calendar');
  assert.equal(mislabeled.sets[0].caption, 'activity data unavailable');
});

/* THE CALENDAR TELLS THE TRUTH WHEN ITS PRODUCER STOPS (issue 285). The live
 * origin was measured serving its cold-start snapshot — endDate 2026-08-20,
 * status stale — fourteen days on, and the panel showed a 499-contribution
 * total under a calendar whose right edge sat on that week, with nothing on
 * the page saying either was two weeks old. Two repairs, both executed here:
 * the window trails the reader's today, so every day past the payload's end
 * is a dated absence the reader can see growing; and the panel carries the
 * usage tracker's data-through line, from the one shared builder. */
test('a stalled payload draws its missing days as dated absences up to today, under a stale line (issue 285)', async () => {
  // A Sunday-start fortnight ending on Thursday 2026-08-20, exactly the shape
  // the origin serves: seven-day columns, the final one padded past endDate.
  const stalled = {
    ...goodActivity,
    weeks: [
      [0, 2, 4, 1, 0, 3, 5],
      [2, 6, 3, 0, 7, 0, 0]
    ],
    endDate: '2026-08-20'
  };
  const envelope = {
    schema: 'panel/v1',
    id: activityPanelId,
    kind: 'vcs-activity/v1',
    title: 'Fixture Activity',
    status: 'stale',
    generatedAt: '2026-08-20T09:50:34Z',
    data: stalled
  };
  const now = new Date('2026-09-03T10:00:00Z');
  const rendered = commitLogProps([envelope, null], now);
  assert.equal(rendered.staleNote, 'data through Aug 20, 2026 · last capture 14d ago');

  const columns = rendered.sets[0].columns;
  assert.equal(columns.length, pendingWeeks, 'the fixed trailing window lost its width');
  const last = columns.at(-1);
  assert.equal(last[0].date, '2026-08-30', 'the window does not end on the week that holds today');
  assert.equal(last[6].date, '2026-09-05');
  // Every day after the payload's end is a DATED absence, never a quiet zero,
  // so a reader sees where the data stopped rather than a fortnight of calm.
  const after = columns.flat().filter((cell) => cell.date > '2026-08-20');
  assert.equal(after.length, 16, 'the days since the payload ended are not all drawn');
  assert.ok(after.every((cell) => cell.absent === true), 'a day the producer never reached rendered as a measured zero');
  // ...and the real days stay exactly where the calendar puts them.
  const thursday = columns.flat().find((cell) => cell.date === '2026-08-20');
  assert.deepEqual(thursday, { value: 7, date: '2026-08-20' });
  assert.equal(columns.flat().find((cell) => cell.date === '2026-08-10').value, 2);

  // A fresh payload — endDate on the reader's today — renders exactly what it
  // always did: the anchor changes nothing when the producer is live.
  const fresh = { ...envelope, status: 'ok' };
  const live = commitLogProps([fresh, null], new Date('2026-08-20T12:00:00Z'));
  assert.equal(live.staleNote, undefined);
  assert.deepEqual(live.sets[0].columns, calendarColumns(activityCells(parseVCSActivity(stalled))));
  // A producer a time zone ahead of the reader keeps its own end.
  const ahead = commitLogProps([fresh, null], new Date('2026-08-19T23:30:00Z'));
  assert.deepEqual(ahead.sets[0].columns, live.sets[0].columns);
  // An ok envelope whose generatedAt has silently stopped advancing says so too.
  assert.equal(commitLogProps([fresh, null], now).staleNote, 'data through Aug 20, 2026 · last capture 14d ago');
  // The component hands the line to the shell's HEAD — the one row the card
  // already reserves — never to its body, whose every region is a fixed box
  // so the calendar's arrival costs no layout shift (the reserve lane).
  assert.match(component, /<PanelShell \{title\} \{status\} \{generatedAt\} note=\{staleNote\}>/);
  assert.doesNotMatch(component, /staleNote\}<\/p>/, 'the stale line grew the reserved body');
  const shell = await readFile(new URL('../src/lib/components/PanelShell.svelte', import.meta.url), 'utf8');
  assert.match(shell, /\{#if note\}<span class="panel-note" data-panel-note>\{note\}<\/span>\{\/if\}/);
  assert.match(shell, /\.panel-note \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/s);
});

test('an empty commit list says so instead of showing invented history', () => {
  assert.match(component, /\{#if rows\.length === 0\}/);
  assert.match(component, /\{rowsNote\}/);
  // The wording is the adapter's, verbatim from the retired component.
  assert.equal(activityEntriesNote, 'no recent commits reported');
  const empty = commitLogProps([null, null]);
  assert.equal(empty.rowsNote, 'no recent commits reported');
  assert.equal(empty.sets[0].emptyNote, 'activity data unavailable');
  assert.equal(empty.title, 'Version-control activity');
  assert.equal(empty.status, 'unavailable');
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
  //
  // The row term is --grid-day, the DRAWN day, which is the same alias the
  // cells and the weekday gutter read (issue 178 vs 268's ruling let a
  // full-width caller bound that day and draw it square). Reading the base
  // cell token here instead would restore exactly the class of drift this pin
  // exists to forbid: a caller raises its day, the cells and gutter grow, and
  // the box that holds them stays the old height and clips them.
  const stripBox = /\.grid-strip \{[^}]*?block-size: calc\(([\s\S]*?)\);/.exec(grid);
  assert.ok(stripBox, 'the strip no longer derives its own block size from its rows');
  for (const term of [
    '7 * var(--grid-day)',
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
  /* The regions the calendar sits between keep their fixed boxes through the
     ledger redesign (owner directive, 2026-09-03, issue 287); what changed is
     which file states them, because the sheet's row rhythm is a page-level
     decision several sections share (styles.css) rather than one component's.
     The caption under the grid is the figures row's successor and holds the
     same line's height. */
  assert.match(sheet, /\.commit-caption \{[^}]*min-block-size: 1\.25rem/);
  // Five rows at the 44px touch floor (issue 157): every entry row can carry
  // two real links, so the fixed reservation grew from 5.625rem to
  // 13.75rem (5 * 2.75rem) rather than staying a decorative-text height. The
  // reservation is written as that multiplication, and this pin recomputes it
  // from shownEntryRows and the row's own floor — so the box and the number
  // of rows the adapter hands it cannot drift apart.
  const rowFloorRem = 2.75;
  /* The reserve is DERIVED from the row's own pitch rather than restated, and
     the pitch is a token because a phone row is taller — the repository stacks
     over the subject there. A box computed from one width while its rows are
     drawn at another is a box that clips its own last row, which is what this
     recomputation refuses in both directions. */
  assert.match(
    sheet,
    new RegExp(`\\.commit-rows \\{[^}]*block-size: calc\\(${shownEntryRows} \\* var\\(--commit-row-height\\)\\)`)
  );
  assert.match(sheet, /\.commit-row \{[^}]*block-size: var\(--commit-row-height\)/);
  assert.match(sheet, new RegExp(`\\.commit-row \\{[^}]*min-block-size: var\\(--control-target\\)`));
  assert.match(sheet, new RegExp(`--control-target: ${rowFloorRem}rem;`));
  // Both pitches are declared, and the phone one is the taller of the two, or
  // the reserve is a ceiling rather than a reserve.
  const pitches = [...sheet.matchAll(/--commit-row-height: ([\d.]+)rem;/g)].map(([, value]) => Number(value));
  assert.equal(pitches.length, 2, 'the row pitch is declared once; a phone row is taller than a desktop one');
  assert.ok(pitches[1] > pitches[0], 'the phone pitch must be the taller one');
  assert.ok(pitches[0] >= rowFloorRem, 'the row pitch dropped under the touch floor');
  // The row separator is an INSET SHADOW, never a border (owner directive,
  // 2026-08-25): a border would add its pixel to every row's box and five of
  // them would push the last row out of a reservation that is exactly five
  // rows tall — the zero-CLS reserve turned into a clipped row.
  assert.match(sheet, /\.commit-row \{[^}]*box-shadow: inset 0 -1px 0 var\(--ledger-rule/);
  assert.match(sheet, /\.commit-row:last-child \{[^}]*box-shadow: none/);
  assert.doesNotMatch(
    sheet,
    /\.commit-row \{[^}]*border-block-end/,
    'a row separator drawn as a border grows the row box the reservation is built on'
  );
  // The reservation and the row cap agree by construction: the adapter shows
  // at most the rows the fixed box holds.
  assert.equal(shownEntryRows, 5);
  const overfull = commitLogProps([
    {
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
    },
    null
  ]);
  assert.equal(overfull.rows.length, 5, 'the payload may carry more rows; the rest do not render');
  // A wide window scrolls inside the strip, never the page.
  assert.match(grid, /\.grid-strip \{[^}]*overflow-x: auto/);
  // The panel is an ordinary block in the page's stack. It used to dock to
  // the viewport's bottom-start corner, which meant the page had to reserve a
  // strip for a bar that overlaid it AND the bar had to bound its own height
  // against that same reserve so the two could not disagree — two facts that
  // only existed because it floated. It takes the column's width now, so it
  // declares neither.
  assert.doesNotMatch(component, /position: fixed/, 'the panel must not dock again');
  assert.doesNotMatch(sheet, /--page-activity-gutter/, 'a card reserves no gutter');
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
  const hostile = commitLogProps([
    {
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
    },
    null
  ]);
  const [badRepo, noReference, referenced, shaOnly, badSha] = hostile.rows;
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
    ['row.source.href', 'row.title.href'],
    'the component may render exactly the two validated hrefs and construct neither'
  );
  assert.match(component, /\{#if row\.source\.href\}/);
  assert.match(component, /<span class="commit-source-text">\{row\.source\.text\}<\/span>/);
  assert.match(component, /\{#if row\.title\.href\}/);
  assert.match(component, /<span class="commit-title-text">\{row\.title\.text\}<\/span>/);
  /* The short identity is DISPLAY-ONLY and the adapter decides it: a row whose
     identity this module cannot vouch for prints the honest dash rather than a
     truncated guess, and the component prints whatever it is handed. */
  assert.equal(shaOnly.mark, validSha.slice(0, 7));
  assert.equal(badSha.mark, '—');
  assert.match(component, /<span class="commit-mark">\{row\.mark\}<\/span>/);
  // Text, never markup: this component must never reach for {@html} anywhere,
  // now that two of its fields are payload-controlled link targets.
  assert.doesNotMatch(component, /\{@html/, 'entry fields must never render as markup');
  // Both outbound links close the same way: a new tab that says so, and the
  // two attributes the threat model requires on anything leaving the page.
  const targetBlank = component.match(/target="_blank"/g) ?? [];
  const relSafe = component.match(/rel="noopener noreferrer"/g) ?? [];
  assert.equal(targetBlank.length, 2, 'both the source and the title anchor must open a new tab');
  assert.equal(relSafe.length, 2, 'both anchors must carry rel="noopener noreferrer"');
  assert.match(component, /aria-label=\{row\.source\.label\}/);
  assert.match(component, /aria-label=\{row\.title\.label\}/);
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

test('the manifest mounts the calendar block exactly once, bound to both its panels', () => {
  /* The fences retired with the table-of-contents App (issue 165): the
     manifest IS the mount list, so the pin lives on it. What moved (owner
     directive, 2026-09-03, issue 287) is WHICH section the calendar is in and
     how many panels its block reads: the contribution calendar leads its own
     COMMITS section now, and the block binds two panels, because the segmented
     control cycles the same grid between the contributions and each token
     source's daily series. Exactly one block module does that binding, and the
     section lists it exactly once. */
  const importLines = manifest.match(/^import \{ commitLog \} from '\.\/lib\/blocks\/commitLog\.ts';$/gm);
  assert.equal(importLines?.length, 1, 'exactly one import line for the commits block');
  const body = manifest.replace(/^import[^\n]*\n/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(
    (body.match(/\bcommitLog\b/g) ?? []).length,
    1,
    'the manifest lists the commits block exactly once'
  );
  assert.match(
    manifest,
    /section\('commits', 'Commits', \[commitLog\], \{ layout: 'stack' \}\)/,
    'the commits section lists the calendar block on its own'
  );
  assert.match(binding, /panelsBlock\(\s*'commit-log',\s*CommitLog,\s*commitPanelIds,/);
  // The ids the binding declares are the ids the adapter unpacks, in order,
  // named once so the two cannot disagree.
  assert.match(helpers, /export const activityPanelId = 'vcs-activity'/);
});
