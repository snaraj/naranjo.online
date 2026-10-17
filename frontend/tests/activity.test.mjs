import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it, test } from 'node:test';

import {
  activityCells,
  activityEntriesNote,
  activityPanelId,
  activityStripEmptyNote,
  commitPullRequestNumber,
  commitReferenceLinkLabel,
  commitReferenceUrl,
  commitRepoUrl,
  commitShaLinkLabel,
  commitShaUrl,
  commitTitleLink,
  isValidCommitSha,
  isValidRepoSlug,
  parseVCSActivity
} from '../src/lib/activity.ts';
import {
  commitLogListId,
  contributionCalendarProps,
  logCollapseWord,
  logExpandWord,
  phoneLogRows,
  projectsCommitsProps
} from '../src/lib/commits.ts';
import { spreadFromRem } from '../src/lib/columnWidth.ts';
import { calendarColumns, pendingWeeks, toColumns } from '../src/lib/grid.ts';
import {
  effectiveDescription,
  projectHost,
  projectTableProps,
  projects,
  shownProjectRows
} from '../src/lib/projects.ts';

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

/* The contribution calendar is drawn inside the Chronicle now (owner
   direction, 2026-10-16): the year's cells under the token lines, one
   timeline. Its own component, its shared grid and its block binding retired
   with that direction; the Chronicle is read here for the pins that were
   always about the panel rather than the grid (no label, no stale line, no
   docking). The log that used to ride under it is the sheet's right-hand
   column, drawn by LedgerSpread — read here too, because the rows and the
   reserve are still this payload's and the pins that describe them belong
   beside the admission they come from. */
const [chronicle, spread, manifest, helpers, sheet] = await Promise.all([
  readFile(new URL('../src/lib/components/Chronicle.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/components/LedgerSpread.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/page.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/activity.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
]);

/* The spread's OWN stylesheet. Its reserve, its pitch and its phone rules
   moved out of styles.css and into the component's <style> with the owner's
   direction of 2026-10-16 (two-line entries, "Ongoing Work"): they are one
   component's geometry, and the pins below read them where they are decided. */
const spreadStyle = /<style[^>]*>([\s\S]*?)<\/style>/.exec(spread)?.[1] ?? '';

// Browser execution is deliberately outside this dependency-free test; these
// assertions pin the component source's structural contracts the same way
// experience.test.mjs pins the shells. What the component used to compute it
// now receives (issue 165): the adapter below is EXECUTED, and the component
// pins hold that the generic tracker renders exactly what it is handed.
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
  const rendered = contributionCalendarProps([envelope, null]);
  /* No panel label (owner directive, 2026-09-04, issue 294): the envelope's
     title names one host and the calendar opens on a token series, so the
     adapter hands the shell no title at all rather than a false one. */
  assert.equal(rendered.title, undefined, 'the commit block grew a panel label back');
  assert.equal(rendered.status, 'ok');
  assert.equal(rendered.generatedAt, '2026-08-11T00:12:00Z');
  /* AND NO READING SENTENCE (owner directive, 2026-09-12, issue 323). The two
     headline figures became the calendar's own caption at issue 287 and left
     the page altogether here: "1,287 contributions · 9-day streak" over a grid
     that draws every one of those days is the same fact twice, and the
     standing ruling already forbids a chart caption. What a reader can still
     read off any day is the day's own count, in the cell's detail card. */
  const contributions = rendered.sets[0];
  assert.equal(contributions.caption, undefined, 'a set composed a reading sentence again');
  assert.equal(contributions.noun, 'contribution');
  assert.equal(contributions.stripLabel, 'contribution calendar: 2 weeks of daily counts, newest last');
  assert.deepEqual(contributions.columns, toColumns(activityCells(parseVCSActivity(goodActivity))));
  // The payload renders only under its pinned kind: a mislabeled envelope is
  // the honest empty state, exactly as the retired component decided it.
  const mislabeled = contributionCalendarProps([{ ...envelope, kind: 'boss-log/v1' }, null]);
  assert.deepEqual(mislabeled.sets[0].columns, []);
  /* And the LOG half of the same payload refuses the same way, from the other
     adapter: one mislabeled envelope, two blocks, one verdict. */
  assert.deepEqual(projectsCommitsProps([null, { ...envelope, kind: 'boss-log/v1' }]).logRows, []);
  assert.equal(mislabeled.sets[0].stripLabel, 'contribution calendar');
  /* The empty FACE is the grid's own note, which is where a reader meets it:
     the caption that used to restate it is gone, and the note is not. */
  assert.equal(mislabeled.sets[0].caption, undefined);
  assert.equal(mislabeled.sets[0].emptyNote, activityStripEmptyNote);
});

/* THE CALENDAR TELLS THE TRUTH WHEN ITS PRODUCER STOPS (issue 285). The live
 * origin was measured serving its cold-start snapshot — endDate 2026-08-20,
 * status stale — fourteen days on, and the panel showed a 499-contribution
 * total under a calendar whose right edge sat on that week, with nothing on
 * the page saying either was two weeks old. Two repairs, both executed here:
 * the window trails the reader's today, so every day past the payload's end
 * is a dated absence the reader can see growing; and the panel carries the
 * usage tracker's data-through line, from the one shared builder. */
test('a stalled payload draws its missing days as dated absences up to today, and says so only as data (issue 285, issue 323)', async () => {
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
  const rendered = contributionCalendarProps([envelope, null], now);
  /* THE LINE IS GONE, THE WINDOW IS NOT (owner directive, 2026-09-12, issue
     323). Issue 285's repair was two halves: the window trails the reader's
     today so every day past the payload's end is a dated absence the reader
     can SEE growing, and the head carried a sentence dating the payload. The
     owner removed the sentence after reading it on the live page; the half
     that draws the gap is the half that was doing the work, and it is measured
     in full below. */
  assert.equal(rendered.staleNote, undefined, 'the calendar composed a stale line again');

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
  const live = contributionCalendarProps([fresh, null], new Date('2026-08-20T12:00:00Z'));
  assert.deepEqual(live.sets[0].columns, calendarColumns(activityCells(parseVCSActivity(stalled))));
  // A producer a time zone ahead of the reader keeps its own end.
  const ahead = contributionCalendarProps([fresh, null], new Date('2026-08-19T23:30:00Z'));
  assert.deepEqual(ahead.sets[0].columns, live.sets[0].columns);
  /* WHAT THE PAGE STILL SAYS ABOUT STALENESS, it says as DATA. The envelope's
     own status and instant ride the shell as attributes on every panel — an ok
     envelope whose generatedAt has silently stopped advancing is still
     auditable from the DOM — and what left is the sentence a reader was being
     shown over the figures it qualified. */
  assert.equal(contributionCalendarProps([fresh, null], now).staleNote, undefined);
  assert.equal(contributionCalendarProps([envelope, null], now).status, 'stale');
  assert.equal(
    contributionCalendarProps([envelope, null], now).generatedAt,
    '2026-08-20T09:50:34Z'
  );
  assert.match(chronicle, /<PanelShell \{status\} \{generatedAt\}>/);
  assert.doesNotMatch(chronicle, /\{title\}/, 'the calendar\u2019s panel renders a panel label again (issue 294)');
  assert.ok(!chronicle.includes('staleNote'), 'the calendar\u2019s panel carries a stale-note prop again');
  const shell = await readFile(new URL('../src/lib/components/PanelShell.svelte', import.meta.url), 'utf8');
  assert.ok(!shell.includes('panel-note'), 'the shell draws a freshness line again');
  assert.ok(!shell.includes('note'), 'the shell still takes a note prop');
  assert.match(shell, /data-panel-status=\{status\}/);
  assert.match(shell, /data-panel-generated-at=\{generatedAt\}/);
});

test('an empty commit list says so instead of showing invented history', () => {
  /* The rows are the sheet's right-hand column (owner design decision,
     2026-09-11, issue 318), so the empty branch is LedgerSpread's — same
     class, same adapter word, a different file. */
  assert.match(spread, /\{#if logRows\.length === 0\}/);
  assert.match(spread, /\{logNote\}/);
  // The wording is the adapter's, verbatim from the retired component.
  assert.equal(activityEntriesNote, 'no recent commits reported');
  const empty = projectsCommitsProps([null, null]);
  assert.equal(empty.logNote, 'no recent commits reported');
  assert.deepEqual(empty.logRows, []);
  /* The calendar's own empty face is unchanged, and it still hands the shell
     no title (owner directive, 2026-09-04, issue 294). */
  const noCalendar = contributionCalendarProps([null, null]);
  assert.equal(noCalendar.sets[0].emptyNote, 'activity data unavailable');
  assert.equal(noCalendar.title, undefined, 'an empty calendar block grew a panel label');
  assert.equal(noCalendar.status, 'unavailable');
});

test('the log box owns fixed geometry and its own overflow', () => {
  // Fixed block sizes per region: data arriving never shifts layout.
  /* The regions the calendar sits between keep their fixed boxes through the
     ledger redesign (owner directive, 2026-09-03, issue 287); what changed is
     which file states them, because the sheet's row rhythm is a page-level
     decision several sections share (styles.css) rather than one component's.
     The caption that used to close the block — and the two-line reserve the
     phone held open for it, so pressing a segment could not grow it — left
     with the caption itself (issue 323). Nothing under the grid can shift the
     page because there is nothing under the grid. */
  assert.ok(!sheet.includes('commit-caption'), 'the sheet still reserves a caption row');
  /* FIVE ENTRIES, each a two-line pitch (owner direction, 2026-10-16: "show 1
     less entry per but give more information … I am not trying to make this
     larger block in the page"; six one-line rows since 2026-09-12, seven since
     issue 318, ten since issue #315, five since issue 157). The reserve is a
     multiplication of the column's own entry pitch by the constant the
     REPOSITORIES beside it select their entries with — so the two columns of
     the paired section cannot come to hold different numbers of entries, and
     the box and its count cannot drift apart. It reads these where they are
     decided, the component's own <style>. */
  const spreadRule = (selector, source = spreadStyle) =>
    new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(source)?.[1] ?? '';
  const baseLogBox = spreadRule('.log-box');
  assert.ok(baseLogBox !== '', 'the component no longer styles its log box');
  assert.match(
    baseLogBox.replace(/\s+/g, ' '),
    new RegExp(`block-size: calc\\(${shownProjectRows} \\* var\\(--repo-pitch\\)\\);`),
    'the log no longer reserves exactly the repositories’ count of their own pitch'
  );
  /* THE PITCH IS ARITHMETIC: a title line, a supporting line and two
     paddings, and the wide sheet's repository pitch IS that entry pitch — so
     the log's reserve and the repository entries beside it are one length. */
  const pitchTokens = spreadStyle.replace(/\s+/g, ' ');
  assert.match(
    pitchTokens,
    /--ongoing-pitch: calc\(var\(--ongoing-line\) \+ var\(--ongoing-sub\) \+ 2 \* var\(--ongoing-pad\)\);/
  );
  assert.match(pitchTokens, /@media \(min-width: 64rem\) \{ \.ongoing \{ --repo-pitch: var\(--ongoing-pitch\); \}/);
  assert.match(spreadRule('.repo-entry').replace(/\s+/g, ' '), /block-size: var\(--repo-pitch\);/);
  /* AND THAT PITCH CLEARS THE TOUCH FLOOR, recomputed from the four lengths it
     is built from rather than trusted: every entry is one link, and the link
     is the entry's whole box. */
  const length = (name) => Number(new RegExp(`--ongoing-${name}: ([\\d.]+)rem;`).exec(spreadStyle)?.[1]);
  const rowFloorRem = 2.75;
  assert.match(sheet, new RegExp(`--control-target: ${rowFloorRem}rem;`));
  const pitchRem = length('line') + length('sub') + 2 * length('pad');
  assert.ok(pitchRem >= rowFloorRem, `the entry pitch (${pitchRem}rem) dropped under the touch floor`);
  /* AND FIVE OF THEM PLUS THE HEAD ARE NO TALLER THAN THE SIX ONE-LINE ROWS
     THEY REPLACED (2.75rem each, plus the 1px rule a row drew under itself, and
     the 2.125rem head row): the direction was more information in the same
     height, not a larger block. */
  const replacedPx = 6 * (rowFloorRem * 16 + 1) + 2.125 * 16;
  const nowPx = (length('head') + shownProjectRows * pitchRem) * 16;
  assert.ok(nowPx <= replacedPx, `the section grew: ${nowPx}px of head and entries against the ${replacedPx}px it replaced`);
  // The links themselves declare the floor as their minimum, from the token.
  assert.match(spreadRule('.log-link'), /min-block-size: var\(--control-target\);/);
  assert.match(spreadRule('.repo-link'), /min-block-size: var\(--control-target\);/);
  // The entry separator is an INSET SHADOW, never a border (owner directive,
  // 2026-08-25): a border would add its pixel to every entry's box and five of
  // them would push the last entry out of a reserve that is exactly five
  // entries tall — the zero-CLS reserve turned into a clipped entry.
  assert.match(spreadRule('.log-entry'), /box-shadow: inset 0 -1px 0 var\(--color-border\)/);
  assert.match(spreadRule('.log-entry:last-child'), /box-shadow: none/);
  assert.doesNotMatch(
    spreadRule('.log-entry'),
    /border-block-end/,
    'an entry separator drawn as a border grows the entry box the reservation is built on'
  );
  // THE RESERVE IS NOT A CAP (owner directive, 2026-09-11, issue #315). The
  // adapter used to hand the component exactly the rows the box could hold;
  // the box scrolls now, so every row the wire carried renders and the WIRE's
  // own cap is what bounds the list. A cap in the adapter would be the page
  // quietly deciding the record stops at five, which is the defect the owner
  // reported in the first place.
  //
  // FIVE is the owner's direction of 2026-10-16 — one entry fewer than the six
  // of 2026-09-12 — and it is ONE constant: the repositories' own count. A
  // second number here would be the two columns free to disagree about a
  // height they share, which is exactly the drift the reserve exists to
  // prevent.
  assert.equal(shownProjectRows, 5);
  // The DESKTOP rule, read on its own: the box scrolls there and reserves an
  // exact height, so it declares an overflow and no minimum. Scoped to the
  // base rule rather than to the whole style block, because the phone block
  // below deliberately declares the opposite.
  assert.match(baseLogBox, /overflow-y: auto/);
  // And the box's HEIGHT is the thing that never moves on a desktop: a reserve
  // that grew with its entries would push every section under it down the
  // moment a payload landed.
  assert.doesNotMatch(baseLogBox, /min-block-size/);
  const overfull = projectsCommitsProps([
    null,
    {
      schema: 'panel/v1',
      id: activityPanelId,
      kind: 'vcs-activity/v1',
      title: 'Fixture Activity',
      status: 'ok',
      data: {
        ...goodActivity,
        recentCommits: Array.from({ length: 30 }, (_, index) => ({
          repo: 'fixture-repo',
          message: `fixture: subject ${index}`,
          at: '2026-08-11T00:12:00Z'
        }))
      }
    }
  ]);
  assert.equal(overfull.logRows.length, 30, 'every row the wire carried renders; the box scrolls for the rest');
  // The panel is an ordinary block in the page's stack. It used to dock to
  // the viewport's bottom-start corner, which meant the page had to reserve a
  // strip for a bar that overlaid it AND the bar had to bound its own height
  // against that same reserve so the two could not disagree — two facts that
  // only existed because it floated. It takes the column's width now, so it
  // declares neither.
  assert.doesNotMatch(chronicle, /position: fixed/, 'the calendar\u2019s panel must not dock again');
  assert.doesNotMatch(spread, /position: fixed/, 'the sheet must not dock either');
  assert.doesNotMatch(sheet, /--page-activity-gutter/, 'a card reserves no gutter');
});

/* ---------------------------------------------------------------------------
 * The sheet's LEFT column: which repositories it shows (owner ruling,
 * 2026-09-12: "remove latest, this makes no sense"). The owner's pinned set —
 * GitHub's own curation, on the wire since issue 317 — and nothing outside it.
 * A seventh row rode along for being the most recent push until that ruling.
 *
 * The rule is EXECUTED against payloads rather than pinned as source, because
 * every way it can go wrong is a payload shape: a flag that is absent, a
 * pinned set smaller than six, a pinned set larger than the pair reserves, and
 * a tie between two pushes. Each of those is a row a reader would see.
 * ------------------------------------------------------------------------ */

/* Twelve repositories, six pinned, each with its own push instant so the order
 * is the data's rather than a tie-break's. `r00` is the newest and is NOT
 * pinned, so a selection that merely sliced the most recent rows would draw a
 * visibly different set; the pinned six are scattered through the order on
 * purpose for the same reason. */
function repoFixture(pinnedNames = ['r01', 'r03', 'r05', 'r07', 'r09', 'r11'], count = 12) {
  const pinned = new Set(pinnedNames);
  return Array.from({ length: count }, (_, index) => {
    const name = `r${String(index).padStart(2, '0')}`;
    return {
      name,
      description: 'x',
      stars: index,
      // Descending: r00 is the newest push on the wire.
      pushedAt: new Date(Date.UTC(2026, 0, 12 - index)).toISOString(),
      ...(pinned.has(name) ? { pinned: true } : {})
    };
  });
}

function projectsPanel(repos) {
  return {
    schema: 'panel/v1',
    id: 'coding-projects',
    kind: 'coding-projects/v2',
    title: 'Coding Projects',
    generatedAt: '2026-01-12T00:00:00Z',
    status: 'ok',
    data: { repos }
  };
}

const drawn = (repos) => projectTableProps(projectsPanel(repos), Date.parse('2026-01-12T12:00:00Z'));

test('the table draws the pinned set and nothing outside it (owner ruling, 2026-09-12)', () => {
  const rendered = drawn(repoFixture());
  /* The pinned rows, in push order, and `r00` — the newest push on the wire —
     is NOT among them, because it is not pinned. FIVE of the six (owner
     direction, 2026-10-16: one entry fewer per column): the set is cut at the
     column's own count, keeping the most recently pushed, so `r11` — the
     oldest pinned push — is the one that waits. */
  assert.deepEqual(
    rendered.rows.map((row) => row.link.text),
    ['r01', 'r03', 'r05', 'r07', 'r09'],
    'the table is not the pinned set in push order'
  );
  assert.equal(rendered.rows.length, shownProjectRows);
  /* NO ROW WEARS A WORD any more (owner ruling, 2026-09-12). The chip existed
     to explain the seventh row's presence; with every row on the table for the
     same reason there is nothing left to explain, and the field it rode on is
     gone from the props rather than merely unset — a field nothing writes is a
     field the next payload shape can quietly start writing again. What a row
     DOES carry since the owner's direction of 2026-10-16 is its supporting
     line, `about`: the repository's own description. */
  for (const row of rendered.rows) {
    assert.deepEqual(
      Object.keys(row).toSorted(),
      ['about', 'counts', 'key', 'link', 'updated'],
      `the row "${row.key}" carries a field the table stopped drawing`
    );
  }
  /* The control that makes the claim mean something: without the pinned flags
     the SAME twelve rows select the five most recent, which is a different set
     — so the assertion above is about the flags rather than about a slice that
     happened to agree with them. */
  const unflagged = drawn(repoFixture([]));
  assert.deepEqual(
    unflagged.rows.map((row) => row.link.text),
    ['r00', 'r01', 'r02', 'r03', 'r04'],
    'a payload with no pinned flag must fall back to the most recent by push'
  );
});

/* THE SUPPORTING LINE (owner direction, 2026-10-16): each repository entry
 * carries its own description under its name. It is chosen by the same
 * provenance rule as the instant the entry is ordered by — the panel's words
 * when it vouched for them, the captured words otherwise — and a repository
 * with no description reads as the honest dash, never as a blank a reader
 * would take for missing data and never as words the page invented. */
test('each repository entry carries its own description, or the honest dash', () => {
  const now = Date.parse('2026-01-12T12:00:00Z');
  const live = drawn([
    { name: 'said', description: '  A sentence the host serves.  ', stars: 1, pushedAt: '2026-01-11T00:00:00Z' },
    { name: 'silent', description: '', stars: 1, pushedAt: '2026-01-10T00:00:00Z' },
    { name: 'blank', description: '   ', stars: 1, pushedAt: '2026-01-09T00:00:00Z' }
  ]);
  assert.deepEqual(
    live.rows.map((row) => [row.link.text, row.about]),
    [
      ['said', 'A sentence the host serves.'],
      ['silent', '—'],
      ['blank', '—']
    ]
  );
  /* PROVENANCE: a captured repository the panel serves LIVE wears the live
     words; the same row marked `recorded` wears the captured words, because a
     row that fell back must not pair a live name with a stale sentence. */
  const [captured] = projects;
  const servedLive = projectTableProps(
    projectsPanel([{ name: captured.name, description: 'what the host says today', stars: 1, pushedAt: captured.pushedAt }]),
    now
  );
  assert.equal(servedLive.rows[0].about, 'what the host says today');
  const fellBack = projectTableProps(
    projectsPanel([
      { name: captured.name, description: 'what the host says today', stars: 1, pushedAt: captured.pushedAt, recorded: true }
    ]),
    now
  );
  assert.equal(fellBack.rows[0].about, captured.description);
  // The captured face carries every captured description verbatim.
  for (const row of projectTableProps(null, now).rows) {
    const project = projects.find((candidate) => candidate.name === row.link.text);
    assert.equal(row.about, project.description);
  }
  assert.equal(effectiveDescription(undefined, undefined), '—', 'a row nobody describes must read as the dash');
});

test('the pinned rule never pads, never overflows five, and never conjures a row', () => {
  const now = Date.parse('2026-01-12T12:00:00Z');
  /* FEWER THAN FIVE PINNED — which is also what a pinned PRIVATE repository
     looks like from here: the wire carries only public repositories, so a
     pinned private one is simply not in the answer. The table shows what
     exists and pads nothing, and the newest push outside the set stays out of
     it however recent it is. */
  const three = drawn(repoFixture(['r02', 'r04', 'r06']));
  assert.deepEqual(three.rows.map((row) => row.link.text), ['r02', 'r04', 'r06']);
  /* EXACTLY ONE pinned row is a one-row table, not a row plus four of filler. */
  const one = drawn(repoFixture(['r08']));
  assert.deepEqual(one.rows.map((row) => row.link.text), ['r08']);
  /* A NAME NOBODY SERVED cannot become a row. The flag lives ON a row, so the
     only repositories the selection can choose from are the ones the payload
     carried — here, three of them, one of which is flagged. */
  const short = drawn([
    { name: 'kept', description: 'x', stars: 1, pushedAt: '2026-01-10T00:00:00Z', pinned: true },
    { name: 'newest', description: 'x', stars: 1, pushedAt: '2026-01-11T00:00:00Z' },
    { name: 'older', description: 'x', stars: 1, pushedAt: '2026-01-02T00:00:00Z' }
  ]);
  assert.deepEqual(short.rows.map((row) => row.link.text), ['kept']);
  /* MORE PINNED THAN THE PAIR RESERVES: the two columns share one height, so
     the table can never draw more rows than the log holds open — and the five
     it keeps are the five most recently pushed of the set, which is the same
     order the rest of the table is in rather than a second rule. */
  const many = drawn(repoFixture(['r00', 'r01', 'r02', 'r03', 'r04', 'r05', 'r06', 'r07', 'r08']));
  assert.equal(many.rows.length, shownProjectRows);
  assert.deepEqual(many.rows.map((row) => row.link.text), ['r00', 'r01', 'r02', 'r03', 'r04']);
  /* A TIE between two pushes is resolved by the payload's own order rather
     than by chance: both instants are equal, the sort is stable, and the row
     the payload listed first is drawn first. */
  const tied = projectTableProps(
    projectsPanel([
      { name: 'tie-first', description: 'x', stars: 1, pushedAt: '2026-01-09T00:00:00Z', pinned: true },
      { name: 'tie-second', description: 'x', stars: 1, pushedAt: '2026-01-09T00:00:00Z', pinned: true },
      { name: 'loud-but-loose', description: 'x', stars: 1, pushedAt: '2026-01-11T00:00:00Z' }
    ]),
    now
  );
  assert.deepEqual(
    tied.rows.map((row) => row.link.text),
    ['tie-first', 'tie-second'],
    'a tie must keep the order the payload listed, and an unpinned row must stay off the table however recent it is'
  );
  /* A NON-BOOLEAN FLAG is drift and refuses the whole payload — the captured
     face renders instead, which is the fail-closed direction issue 281 chose
     for every other field of this row. */
  const hostile = projectTableProps(
    projectsPanel([{ name: 'kept', description: 'x', stars: 1, pushedAt: '2026-01-10T00:00:00Z', pinned: 'yes' }]),
    now
  );
  assert.deepEqual(
    hostile.rows.map((row) => row.link.text),
    projects
      .toSorted((left, right) => Date.parse(right.pushedAt) - Date.parse(left.pushedAt))
      .slice(0, shownProjectRows)
      .map((project) => project.name),
    'a non-boolean pinned flag was admitted instead of refusing the payload'
  );
  // A flag that is merely ABSENT is not drift: that is the pre-issue-317 wire,
  // and it renders exactly as it always did.
  assert.equal(drawn(repoFixture([])).rows.length, shownProjectRows);
});

/* THE SECTION SPEAKS NO FRESHNESS LINE (owner ruling, 2026-09-12, on the live
 * page: "DATA THROUGH SEP 12, 2026 · LAST CAPTURE JUST NOW" goes). It composed
 * one from whichever of its two envelopes had something to say; the figures in
 * both columns are dated in their own rows, and an unavailable panel still
 * renders its honest empty note where its rows would be.
 *
 * The claim is EXECUTED against the exact envelope shapes that used to produce
 * each of the three lines, because "no note" is only worth pinning against the
 * inputs that once made one. The channel is checked too: no field of the props
 * carries the sentence by another name. */
test('the paired section composes no freshness line from either of its envelopes (owner 2026-09-12)', () => {
  const now = new Date('2026-09-11T12:00:00Z');
  const projectsEnvelope = {
    schema: 'panel/v1',
    id: 'coding-projects',
    kind: 'coding-projects/v2',
    title: 'Coding Projects',
    generatedAt: '2026-09-11T11:59:00Z',
    status: 'ok',
    data: { repos: [{ name: 'kept', description: 'x', stars: 1, pushedAt: '2026-09-11T09:00:00Z', pinned: true }] }
  };
  const stalledActivity = {
    schema: 'panel/v1',
    id: activityPanelId,
    kind: 'vcs-activity/v1',
    title: 'Fixture Activity',
    status: 'stale',
    generatedAt: '2026-08-28T00:12:00Z',
    data: { ...goodActivity, endDate: '2026-08-28' }
  };
  const shapes = [
    ['a fresh table and a stalled log', [projectsEnvelope, stalledActivity]],
    ['a stale table', [{ ...projectsEnvelope, status: 'stale', generatedAt: '2026-09-11T07:00:00Z' }, stalledActivity]],
    ['an unavailable table', [{ ...projectsEnvelope, status: 'unavailable', data: null }, stalledActivity]],
    ['a table whose generatedAt stopped advancing', [{ ...projectsEnvelope, generatedAt: '2026-09-10T00:00:00Z' }, stalledActivity]],
    ['no envelopes at all', [null, null]]
  ];
  for (const [name, envelopes] of shapes) {
    const props = projectsCommitsProps(envelopes, now);
    assert.equal(props.staleNote, undefined, `${name} composed a stale note`);
    assert.ok(!('staleNote' in props), `${name} carries a staleNote field for one to come back on`);
    /* And no other field is carrying the same sentence under a different name:
       the exact words the three retired lines were built from must not reach
       the reader through any channel of these props. The SENTENCES are scanned
       rather than the bare word "stale", because the envelope's own `status`
       legitimately carries that word as DATA and always has — it is what the
       shell reads to draw the panel's state, and a scan that caught it would be
       pinning against provenance rather than against a caption. */
    const rendered = JSON.stringify(props).toLowerCase();
    for (const phrase of ['data through', 'last capture', 'stale · ', 'data as of', 'showing captured figures']) {
      assert.ok(!rendered.includes(phrase), `${name} put "${phrase}" back into the section's props`);
    }
  }
  /* The CONTRIBUTIONS panel composes none either: the line left every head at
     once (issue 323), so no section of the page dates its data in words, and
     the envelope's own status attribute is what an audit reads. */
  const calendar = contributionCalendarProps([stalledActivity, null], now);
  assert.equal(calendar.staleNote, undefined, 'the calendar composed a stale note');
  assert.ok(!('staleNote' in calendar), 'the calendar carries a staleNote field for one to come back on');
});

/* ---------------------------------------------------------------------------
 * THE PHONE LOG IS NOT A SCROLL TRAP (owner ruling, 2026-09-12, on the live
 * page: at that width the commit log is "quite busy ... an endless scroll
 * field that I have to fight out of").
 *
 * Three separate decisions have to agree for that to be true, and each one is
 * pinned where it is made: the component's STYLE stops giving the box a height
 * and an overflow of its own and reserves the collapsed log instead, the
 * ADAPTER decides whether there is anything to reveal, and the component's
 * MARKUP slices against the adapter's own number and draws a real control. The
 * rendered proof at both widths is the browser lane; what is pinned here is
 * that each decision is made at all, and made from one constant.
 * ------------------------------------------------------------------------ */

/* The phone block that holds the log, whitespace-normalised. It is the
 * component's own block since the owner's direction of 2026-10-16 moved the
 * section's geometry into LedgerSpread.svelte, and it states the sheet's ONE
 * phone width (tests/sections.test.mjs pins that width in styles.css, and the
 * last test in this file holds the two equal). Selected by the rule it is
 * being read for rather than by position, and normalised because the
 * declarations below are written across lines for reading, and a pin that
 * matched the line breaks would be a pin on the formatting rather than on the
 * rule. */
const phoneBlock = (() => {
  const blocks = spreadStyle
    .split('@media (max-width: 45rem) {')
    .slice(1)
    .map((block) => block.split(/\n\s*@media /)[0].replace(/\s+/g, ' '));
  const holdingTheLog = blocks.filter((block) => block.includes('.log-box {'));
  assert.equal(
    holdingTheLog.length,
    1,
    `the log's phone rule is declared in ${holdingTheLog.length} phone blocks; it is one rule`
  );
  return holdingTheLog[0];
})();

test('on a phone the log reserves its collapsed self and takes no overflow (owner 2026-09-12)', () => {
  const phoneRule = /\.log-box \{([^}]*)\}/.exec(phoneBlock)?.[1] ?? '';
  assert.ok(phoneRule !== '', 'the phone block no longer overrides the log box at all');
  /* NO HEIGHT OF ITS OWN and NO OVERFLOW OF ITS OWN — the two halves of "this
     is not a scroll region". Both are stated rather than merely absent,
     because the base rule declares each of them and an override that only
     dropped one would leave a box that still traps a thumb. */
  assert.match(phoneRule, /block-size: auto;/, 'the phone box kept a fixed height, so it still clips its rows');
  assert.match(
    phoneRule,
    /overflow-y: visible;/,
    'the phone box still takes an overflow of its own; the inner scroll is the trap the owner reported'
  );
  /* IT STILL RESERVES, and the reserve is the COLLAPSED log: five entries at
     the phone's pitch plus the control under them and the gap above it.
     Recomputed from `phoneLogRows` — the same constant the component slices
     with — and from the two tokens the control is actually laid out with, so a
     box computed from one set of numbers while its contents are drawn from
     another is not expressible here either. */
  assert.match(
    phoneRule,
    new RegExp(
      `min-block-size: calc\\( ?${phoneLogRows} \\* var\\(--ongoing-pitch-tall\\) \\+ var\\(--control-target\\) \\+ var\\(--ongoing-pad\\) ?\\);`
    ),
    'the collapsed reserve is no longer five entries plus the control it is drawn with'
  );
  /* And every phone entry IS that pitch — fixed, not a minimum — so the
     reserve is exact whatever the payload's subjects say: a subject that takes
     its second line and one that does not are the same height. */
  assert.match(phoneBlock, /\.log-entry \{ block-size: var\(--ongoing-pitch-tall\); \}/);
  assert.match(
    spreadStyle.replace(/\s+/g, ' '),
    /--ongoing-pitch-tall: calc\(2 \* var\(--ongoing-line\) \+ var\(--ongoing-sub\) \+ 2 \* var\(--ongoing-pad\)\);/,
    'the phone pitch no longer holds two subject lines and the supporting line'
  );
  assert.match(
    /(?:^|\n)\s*\.log-message \{([^}]*)\}/.exec(spreadStyle)?.[1] ?? '',
    /max-block-size: calc\(2 \* var\(--ongoing-line\)\);/,
    'a subject can grow past the two lines the pitch holds'
  );
  // And the control IS laid out with exactly those two tokens, or the reserve
  // and the thing it reserves for are two different measurements.
  const control = /\.log-more \{([^}]*)\}/.exec(spreadStyle.replace(/\s+/g, ' '))?.[1] ?? '';
  assert.match(control, /min-block-size: var\(--control-target\);/);
  assert.match(control, /margin-block-start: var\(--ongoing-pad\);/);
  /* The control declares no width, which is how every other full-width control
     on this sheet takes its column — and it is what keeps the touch-floor sweep
     in tests/experience.test.mjs able to measure both of its axes. */
  assert.doesNotMatch(control, /inline-size:/);
});

test('the adapter builds a disclosure only when the log hides rows (owner 2026-09-12)', () => {
  const now = new Date('2026-08-11T12:00:00Z');
  const withCommits = (count) =>
    projectsCommitsProps(
      [
        null,
        {
          schema: 'panel/v1',
          id: activityPanelId,
          kind: 'vcs-activity/v1',
          title: 'Fixture Activity',
          status: 'ok',
          data: {
            ...goodActivity,
            recentCommits: Array.from({ length: count }, (_, index) => ({
              repo: 'fixture-repo',
              message: `fixture: subject ${index}`,
              at: '2026-08-11T00:12:00Z'
            }))
          }
        }
      ],
      now
    );
  /* THE THRESHOLD, from both sides and ON it. A log the collapsed list already
     shows whole has nothing to reveal, so there is no control — a button
     reading "show all 5" that changed nothing would be the honest-states floor
     breaking on a control. */
  for (const count of [0, 1, phoneLogRows - 1, phoneLogRows]) {
    const props = withCommits(count);
    assert.equal(props.logRows.length, count);
    assert.equal(
      props.logDisclosure,
      undefined,
      `a ${count}-row log built a control with nothing to reveal`
    );
    assert.ok(!('logDisclosure' in props), `a ${count}-row log carries the field for one to come back on`);
  }
  /* ONE ROW PAST IT is where the control starts, and it says how many rows the
     press would bring — the figure is the adapter's, because a component that
     composed it would be formatting. */
  const justOver = withCommits(phoneLogRows + 1);
  assert.deepEqual(justOver.logDisclosure, {
    collapsed: phoneLogRows,
    more: `show all ${phoneLogRows + 1}`,
    fewer: 'show fewer'
  });
  // The wire's own cap, which is the real payload's shape.
  const full = withCommits(30);
  assert.equal(full.logRows.length, 30, 'every row the wire carried still reaches the component');
  assert.equal(full.logDisclosure.collapsed, phoneLogRows);
  assert.equal(full.logDisclosure.more, 'show all 30');
  assert.equal(full.logDisclosure.fewer, logCollapseWord);
  // The words are the module's, spelled once: the component renders them and
  // composes neither.
  assert.equal(logExpandWord(30), 'show all 30');
  assert.equal(logCollapseWord, 'show fewer');
  // And the list the control names is the adapter's address, not one the
  // component invented, and it is NOT the column's anchor: the anchor addresses
  // the head too, and a control claiming to operate the head describes
  // something it does not touch.
  assert.equal(full.logListId, commitLogListId);
  assert.notEqual(full.logListId, full.logAnchor);
});

test('the log draws its collapsed slice and a real disclosure, and neither on a desktop', () => {
  /* THE SLICE IS THE ADAPTER'S NUMBER. A literal here would be the same fact
     in two places, which is how the box and the list come to hold different
     numbers of rows. */
  assert.match(
    spread,
    /logRows\.slice\(0, logDisclosure\.collapsed\)/,
    'the collapsed log no longer slices against the adapter’s own count'
  );
  /* AND ONLY WHERE THERE IS SOMETHING TO REVEAL AND ROOM TO NEED IT: both
     conditions guard the slice, so a desktop draws the whole log and a phone
     with nothing hidden draws it too. */
  assert.match(spread, /logDisclosure !== undefined && !wide && !expanded/);
  /* A REAL BUTTON, with the disclosure's two required attributes and the
     list's own id in `aria-controls`. A div with a click handler would carry
     none of the keyboard operation or the role this brings for free. */
  assert.match(spread, /<button\s+class="log-more"\s+type="button"\s+aria-expanded=\{expanded\}\s+aria-controls=\{logListId\}/);
  assert.match(spread, /onclick=\{\(\) => \(expanded = !expanded\)\}/);
  /* WORDS, NOT A MARK: the control prints the adapter's two words and draws no
     glyph, so a reader who cannot see a drawing still reads what pressing it
     does. */
  assert.match(spread, /\{expanded \? logDisclosure\.fewer : logDisclosure\.more\}<\/button>/);
  assert.ok(
    !/class="log-more"[\s\S]*?<Icon/.test(spread),
    'the disclosure grew a mark; it is a control a reader reads'
  );
  /* ABSENT ON A DESKTOP rather than hidden: a `display: none` control is still
     something a screen reader can be walked into, and there is nothing for it
     to do where the box keeps its reserve and scrolls. */
  assert.match(spread, /\{#if logDisclosure !== undefined && !wide\}/);
  assert.doesNotMatch(spreadStyle, /\.log-more \{[^}]*display: none/);
  /* THE STATE IS COMPONENT-LOCAL AND NEVER PERSISTED (owner ruling: the log
     opens closed). A stored answer would decide the page's height before a
     reader has looked at it. */
  assert.match(spread, /let expanded = \$state\(false\);/);
  assert.doesNotMatch(spread, /localStorage|sessionStorage|document\.cookie/);
  /* The list is a real element with the id the control names, and the rows sit
     inside it — so `aria-controls` points at the thing that grows rather than
     at the box around it. */
  assert.match(spread, /<div class="log-list" id=\{logListId\}>/);
});

/* THE SHORT IDENTITY IS ON EVERY ENTRY NOW (owner direction, 2026-10-16:
 * "give more information"). It was absent from a phone's row since the
 * directive of 2026-09-11 — a commit row was two lines there and a
 * seven-character hash had room on neither. The entry's supporting line is
 * that room: the repository takes the slack and ellipsizes first, and the age
 * and the identity hold the line's end. What did NOT change is how a hidden
 * cell would be hidden: never by CSS, which leaves it in the accessibility
 * tree — so the identity is rendered unconditionally and hidden nowhere. The
 * width seam stays, for the one decision still made against it: the phone's
 * disclosure. */
test('every commit entry renders its short identity, and nothing hides it', () => {
  assert.match(
    spread,
    /<span class="log-mark">\{row\.mark\}<\/span>/,
    'the short identity left the entry'
  );
  assert.doesNotMatch(spread, /\{#if wide\}<span class="log-mark">/, 'the identity is conditional on the width again');
  assert.doesNotMatch(
    spreadStyle,
    /\.log-mark \{[^}]*display: none/,
    'the identity is hidden by CSS, which leaves it in the accessibility tree'
  );
  /* THE LINE ENDS WHERE THE COLUMN DOES: the repository is the one flexible
     track, so a long name ellipsizes before the identity is pushed off. */
  assert.match(
    /\.log-meta \{([^}]*)\}/.exec(spreadStyle)?.[1] ?? '',
    /grid-template-columns: minmax\(0, 1fr\) auto auto;/
  );
  // The disclosure's decision reads the shared seam rather than a literal of its own.
  assert.match(spread, /import \{ browserMedia, spreadMediaQuery, watchMedia \} from '\.\.\/columnWidth'/);
  assert.match(spread, /let wide = \$state\(browserMedia\(spreadMediaQuery\)\.matches\)/);
  assert.match(spread, /\$effect\(\(\) => watchMedia\(browserMedia, spreadMediaQuery, \(matches\) => \(wide = matches\)\)\)/);
  // And the stylesheet and the component ask the same number the script does.
  assert.match(sheet, new RegExp(`@media \\(max-width: ${spreadFromRem - 0.0625}rem\\)`));
  assert.match(spreadStyle, new RegExp(`@media \\(max-width: ${spreadFromRem - 0.0625}rem\\)`));
  const widths = new Set([...spreadStyle.matchAll(/@media \(max-width: ([^)]+)\)/g)].map(([, width]) => width));
  assert.deepEqual([...widths], [`${spreadFromRem - 0.0625}rem`], 'the component disagrees with the sheet about where a phone ends');
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
  const hostile = projectsCommitsProps([
    null,
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
    }
  ]);
  const [badRepo, noReference, referenced, shaOnly, badSha] = hostile.logRows;
  /* The repository is the supporting line's TEXT on every entry (owner
     direction, 2026-10-16: one link per entry, the subject's), so a hostile
     name has no address to become — it is a string, and it renders verbatim
     as text. What it still poisons is the entry's one link. */
  assert.equal(badRepo.source, 'evil.com/x', 'the text still renders, as text');
  assert.equal(typeof badRepo.source, 'string', 'a repository became something other than text');
  assert.equal(badRepo.title.href, null, 'a hostile repo poisons the entry link too');
  assert.equal(noReference.source, 'naranjo.online');
  assert.equal(
    noReference.title.href,
    null,
    'a subject with no reference and no sha renders as plain text'
  );
  // /issues/N, never /pull/N, and a neutral "reference" accessible name —
  // the destination and label commitReferenceUrl's own tests justify above.
  assert.equal(referenced.title.href, `${projectHost}/naranjo.online/issues/152`);
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

  /* The structural half: the generic component renders the href it is handed
     or renders text — it never assembles one. Any interpolation beyond the
     data fields would fail these pins. The component is LedgerSpread since the
     sheet paired the columns (owner design decision, 2026-09-11, issue 318),
     and it renders TWO validated hrefs since the entries became two-line
     entries with one link each (owner direction, 2026-10-16): the repository
     entry's and the commit entry's — both built and labelled by an adapter,
     neither assembled here. */
  const hrefs = [...spread.matchAll(/href=\{([^}]*)\}/g)].map(([, expression]) => expression);
  assert.deepEqual(
    hrefs.sort(),
    ['row.link.href', 'row.title.href'],
    'the component may render exactly the validated hrefs and construct none'
  );
  assert.doesNotMatch(spread, /row\.source\.(?:href|label|text)/, 'the repository became a link again');
  assert.match(spread, /\{#if row\.title\.href\}/);
  assert.match(spread, /<span class="log-source"[^>]*>\{row\.source\}<\/span>/);
  assert.match(spread, /<span class="log-message">\{row\.title\.text\}<\/span>/);
  /* The short identity is DISPLAY-ONLY and the adapter decides it: a row whose
     identity this module cannot vouch for prints the honest dash rather than a
     truncated guess, and the component prints whatever it is handed. */
  assert.equal(shaOnly.mark, validSha.slice(0, 7));
  assert.equal(badSha.mark, '—');
  assert.match(spread, /<span class="log-mark">\{row\.mark\}<\/span>/);
  // Text, never markup: neither component may reach for {@html} anywhere, now
  // that several of their fields are payload-controlled link targets.
  for (const [name, source] of Object.entries({ chronicle, spread })) {
    assert.doesNotMatch(source, /\{@html/, `${name} renders entry fields as markup`);
  }
  // Every outbound link closes the same way: a new tab that says so, and the
  // two attributes the threat model requires on anything leaving the page.
  // TWO of them on this sheet — the repository entry and the commit entry.
  const targetBlank = spread.match(/target="_blank"/g) ?? [];
  const relSafe = spread.match(/rel="noopener noreferrer"/g) ?? [];
  assert.equal(targetBlank.length, 2, 'every outbound anchor on the sheet must open a new tab');
  assert.equal(relSafe.length, 2, 'every outbound anchor must carry rel="noopener noreferrer"');
  assert.match(spread, /aria-label=\{row\.title\.label\}/);
  assert.match(spread, /aria-label=\{row\.link\.label\}/);
  /* AND EACH LINK SAYS WHAT ITS SUPPORTING LINE SAYS. The label is the
     adapter's (where the link goes); the entry's other text reaches a screen
     reader as the link's description, by ids the component ties to that same
     entry — the repository's description, and the commit's repository and
     age. An entry whose words a reader could see and not hear would be the
     entry hiding its new information from exactly one kind of reader. */
  assert.match(spread, /aria-describedby="\{uid\}-about-\{index\}"/);
  assert.match(spread, /<span\s+class="repo-about"\s+id="\{uid\}-about-\{index\}">\{row\.about\}<\/span/);
  assert.match(spread, /aria-describedby="\{uid\}-source-\{index\} \{uid\}-age-\{index\}"/);
  assert.match(spread, /<span class="log-source" id="\{uid\}-source-\{index\}">\{row\.source\}<\/span>/);
  assert.match(spread, /class="log-age"\s+id="\{uid\}-age-\{index\}">\{row\.age\}<\/span/);
  assert.match(spread, /const uid = \$props\.id\(\);/, 'the ids are not unique to the instance');
});

test('activity sources stay local-origin and provider-neutral', () => {
  for (const [name, source] of Object.entries({ chronicle, spread, helpers })) {
    // Protocol-relative origins still fail this; a line comment no longer
    // does. The lookahead and the reasoning behind it are documented once, on
    // the same sweep in tests/experience.test.mjs.
    assert.doesNotMatch(source, /(?:https?:)?\/\/(?=[\w-]+\.)/, `${name} introduces a remote origin`);
    // The panel is provider-neutral: the data's origin never names itself in
    // frontend source (mirrors the vcs-activity naming in internal/panels).
    assert.doesNotMatch(source, /git\s?hub/i, `${name} names the data's origin`);
  }
});

test('the manifest mounts the chronicle exactly once, bound to the calendar’s two panels', async () => {
  /* The fences retired with the table-of-contents App (issue 165): the
     manifest IS the mount list, so the pin lives on it. What moved (owner
     design decision, 2026-09-11, issue 318) is WHICH section the calendar is
     in: it led a COMMITS section of its own since issue 287 and is a TRACKER
     now, between the token board and the game ticker. What did NOT move is how
     many panels its block reads — two, because the segmented control cycles
     the same grid between the contributions and each token source's daily
     series. Exactly one block module does that binding, and the stack lists it
     exactly once.

     The calendar is drawn INSIDE the chronicle now (owner direction,
     2026-10-16): the token lines over the year's cells, one timeline, one
     cursor. The chronicle reads the calendar's two panels in the
     calendar's own order, named once, so the two cannot disagree. */
  const importLines = manifest.match(
    /^import \{ trackerChronicle \} from '\.\/lib\/blocks\/trackerChronicle\.ts';$/gm
  );
  assert.equal(importLines?.length, 1, 'exactly one import line for the chronicle block');
  const body = manifest.replace(/^import[^\n]*\n/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(
    (body.match(/\btrackerChronicle\b/g) ?? []).length,
    1,
    'the manifest lists the chronicle block exactly once'
  );
  assert.match(
    manifest,
    /section\('trackers', 'Trackers', \[trackerChronicle, bossTicker\], \{/,
    'the chronicle leads the trackers stack, with the ticker under it'
  );
  const [chronicleBinding, chronicleAdapter] = await Promise.all([
    readFile(new URL('../src/lib/blocks/trackerChronicle.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/chronicle.ts', import.meta.url), 'utf8')
  ]);
  assert.match(
    chronicleBinding,
    /panelsBlock\(\s*'tracker-chronicle',\s*Chronicle,\s*chroniclePanelIds,/
  );
  // …plus the projects panel, for the pull requests its repositories closed
  // (owner direction, 2026-10-16: "Pull Requests Closed").
  assert.match(
    chronicleAdapter,
    /export const chroniclePanelIds: readonly string\[\] = \[\.\.\.calendarPanelIds, codingProjectsPanelId\];/
  );
  // The ids the binding declares are the ids the adapter unpacks, in order,
  // named once so the two cannot disagree.
  assert.match(helpers, /export const activityPanelId = 'vcs-activity'/);
});
