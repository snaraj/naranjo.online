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
  commitColumnId,
  commitLogListId,
  contributionCalendarProps,
  projectsCommitsProps,
  streamPageRows
} from '../src/lib/commits.ts';
import { spreadFromRem } from '../src/lib/columnWidth.ts';
import { calendarColumns, pendingWeeks, toColumns } from '../src/lib/grid.ts';
import { projectHost, projectLinkLabel } from '../src/lib/projects.ts';

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
   docking). The log that used to ride under it is Ongoing Work's stream (owner,
   2026-11-02, issue #399), drawn by Stream — read here too, because the rows
   and the reserve are still this payload's and the pins that describe them
   belong beside the admission they come from. */
const [chronicle, stream, manifest, helpers, sheet] = await Promise.all([
  readFile(new URL('../src/lib/components/Chronicle.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/components/Stream.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/page.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/activity.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
]);

/* The stream's OWN stylesheet. Its reserve and its subject's phone clamp are
   decided there; the pitch they are built from is a styles.css token, because
   the phone restates it in the sheet's phone block. */
const streamStyle = /<style[^>]*>([\s\S]*?)<\/style>/.exec(stream)?.[1] ?? '';

/* One rule's body, comments out, whitespace normalised. */
const ruleIn = (source, selector) =>
  new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`)
    .exec(source.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1]
    ?.replace(/\s+/g, ' ')
    .trim() ?? '';

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
  assert.deepEqual(projectsCommitsProps([null, { ...envelope, kind: 'boss-log/v1' }]).rows, []);
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

/* An activity envelope carrying `count` commits, all public, for the stream's
   adapter. */
const activityWith = (count) => ({
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
});

test('an empty stream says so instead of showing invented history', () => {
  /* The rows are Ongoing Work's stream (owner, 2026-11-02, issue #399), so the
     empty branch is Stream's: the shown feed's own words (issue #401), in the
     same reserve the list would fill, and the stream opens on the commits. */
  assert.match(stream, /\{#if filtered\.length === 0\}\s*<p class="stream-note">\{filteredEmpty\}<\/p>/);
  // The wording is the adapter's, verbatim from the retired component.
  assert.equal(activityEntriesNote, 'no recent commits reported');
  const empty = projectsCommitsProps([null, null]);
  assert.equal(empty.emptyNote, 'no recent commits reported');
  assert.equal(empty.filters[0].key, 'commit');
  assert.equal(empty.filters[0].empty, 'no recent commits reported');
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.status, 'unavailable');
  /* The calendar's own empty face is unchanged, and it still hands the shell
     no title (owner directive, 2026-09-04, issue 294). */
  const noCalendar = contributionCalendarProps([null, null]);
  assert.equal(noCalendar.sets[0].emptyNote, 'activity data unavailable');
  assert.equal(noCalendar.title, undefined, 'an empty calendar block grew a panel label');
  assert.equal(noCalendar.status, 'unavailable');
});

test('the stream reserves one page of entries at a fixed pitch, and the pitch is arithmetic (issue #399)', () => {
  /* FIVE A PAGE (owner, 2026-11-02: "Keep it at 5 entries with sleek
     pagination"), and the list reserves exactly that page before a payload
     lands — the count is the adapter's, handed to the component as data and
     set on the stream as the one custom property the reserve multiplies. */
  assert.equal(streamPageRows, 5);
  assert.equal(projectsCommitsProps([null, null]).pageSize, streamPageRows);
  assert.match(stream, /<div class="stream" id=\{anchor\} style:--stream-page-rows=\{pageSize\}>/);
  /* The empty note sits in the SAME reserve as the list, so the rows arriving
     a moment after first paint land in a box that was already their size. */
  assert.equal(
    ruleIn(streamStyle, '.stream-list,\n  .stream-note'),
    'min-block-size: calc(var(--stream-page-rows) * var(--stream-pitch));',
    'the list and its empty note no longer reserve one page of entries'
  );
  /* EVERY ENTRY IS EXACTLY THE PITCH — a height, not a minimum — so five of
     them are exactly the reserve whatever their subjects say. */
  assert.match(ruleIn(streamStyle, '.stream-entry'), /block-size: var\(--stream-pitch\);/);
  assert.doesNotMatch(ruleIn(streamStyle, '.stream-entry'), /min-block-size/);
  /* THE PITCH IS ARITHMETIC: a byline, a subject line and two paddings, in the
     sheet's token layer so the phone can restate it. */
  assert.match(sheet, /--stream-pitch: calc\(var\(--stream-line\) \+ var\(--stream-sub\) \+ 2 \* var\(--stream-pad\)\);/);
  /* AND IT CLEARS THE TOUCH FLOOR, recomputed from the lengths it is made of
     rather than trusted: the subject's link is the entry's whole box. */
  const length = (name) => Number(new RegExp(`--stream-${name}: ([\\d.]+)rem;`).exec(sheet)?.[1]);
  const floorRem = Number(/--control-target: ([\d.]+)rem;/.exec(sheet)?.[1]);
  const pitchRem = length('line') + length('sub') + 2 * length('pad');
  assert.ok(pitchRem >= floorRem, `the entry pitch (${pitchRem}rem) dropped under the touch floor`);
  assert.match(ruleIn(streamStyle, '.stream-title'), /min-block-size: var\(--control-target\);/);
  /* The separator is PAINTED, never a border (owner directive, 2026-08-25; a
     twig since 2026-10-19): a border adds its pixel to every entry and five of
     them overflow a reserve exactly five entries tall. The last entry of a
     page draws none. */
  assert.match(
    ruleIn(streamStyle, '.stream-entry'),
    /background: var\(--keep-twig-\d+\) left bottom \/ var\(--keep-twig-tile\) repeat-x;/,
    'an entry is no longer parted from the next by a twig along its bottom edge'
  );
  assert.doesNotMatch(ruleIn(streamStyle, '.stream-entry'), /border/);
  assert.equal(ruleIn(streamStyle, '.stream-entry:last-child'), 'background: none;');
  /* No scroll box and no disclosure: the pager is the only way past a page. */
  assert.doesNotMatch(stream, /overflow-y|scrollbar|log-more|aria-expanded/);
  // The panel is an ordinary block in the page's stack, never docked.
  assert.doesNotMatch(chronicle, /position: fixed/, 'the calendar’s panel must not dock again');
  assert.doesNotMatch(stream, /position: fixed/, 'the stream must not dock either');
  assert.doesNotMatch(sheet, /--page-activity-gutter/, 'a card reserves no gutter');
});

test('on a phone the subject takes two lines inside the taller pitch, at the sheet’s one phone width', () => {
  /* The phone restates the pitch in the sheet's phone block, AFTER the token
     block so it wins the cascade, and the component clamps the subject to the
     two lines that pitch holds, inside its own phone block at the SAME width. */
  const phoneSheet = sheet.slice(sheet.indexOf('@media (max-width: 45rem) {'));
  const restated = phoneSheet.indexOf(
    '--stream-pitch: calc(2 * var(--stream-line) + var(--stream-sub) + 2 * var(--stream-pad));'
  );
  assert.ok(restated > 0, 'the phone no longer gives a subject its second line');
  assert.ok(
    sheet.indexOf('@media (max-width: 45rem) {') > sheet.indexOf('--stream-pitch: calc(var(--stream-line)'),
    'the phone pitch is declared before the token block, which then wins'
  );
  const phoneStream = streamStyle.slice(streamStyle.indexOf('@media (max-width: 45rem) {'));
  const clamp = ruleIn(phoneStream, '.stream-title');
  /* The box ends at its second line, with no foot of padding a third line
     could paint into: a box clips at its padding edge, and WebKit lays out
     the lines past the clamp (preview, 2026-11-02). */
  assert.match(clamp, /max-block-size: calc\(var\(--stream-pitch\) - var\(--stream-pad\)\);/, 'a subject can grow past the two lines the pitch holds');
  assert.match(clamp, /padding-block-end: 0;/, 'the subject keeps a foot of padding a clamped line can paint into');
  assert.match(clamp, /-webkit-line-clamp: 2;/);
  assert.match(clamp, /line-clamp: 2;/);
  // The desktop subject is one line, ellipsized, so the one-line pitch is exact.
  assert.match(ruleIn(streamStyle, '.stream-title'), /white-space: nowrap;/);
  // The stylesheet and the component ask the same width the script's seam does.
  const phoneWidth = `${spreadFromRem - 0.0625}rem`;
  const widths = new Set([...streamStyle.matchAll(/@media \(max-width: ([^)]+)\)/g)].map(([, width]) => width));
  assert.deepEqual([...widths], [phoneWidth], 'the component disagrees with the sheet about where a phone ends');
  assert.match(sheet, new RegExp(`@media \\(max-width: ${phoneWidth}\\)`));
});

test('the adapter hands every row, a page size and the stream’s own addresses (issue #399)', () => {
  const now = new Date('2026-08-11T12:00:00Z');
  /* NOTHING IS SLICED SHORT OF THE WIRE'S CAP: every row the wire carried
     reaches the component, which pages them, so the origin's own cap bounds
     each feed (issue #401) and never a page. */
  for (const count of [0, 1, streamPageRows, streamPageRows + 1, 30]) {
    const props = projectsCommitsProps([null, activityWith(count)], now);
    assert.equal(props.rows.length, count, `a ${count}-row payload reached the component short`);
    assert.equal(props.pageSize, streamPageRows);
    assert.ok(!('logDisclosure' in props), 'the stream carries a disclosure field for one to come back on');
  }
  /* The addresses are the adapter's. The stream answers to the old commits
     section's id, so an address a reader shared keeps landing (issue 287's
     rule); the list has its own, which is not the anchor. */
  const full = projectsCommitsProps([null, activityWith(30)], now);
  assert.equal(full.anchor, commitColumnId);
  assert.equal(full.anchor, 'commits');
  assert.equal(full.listId, commitLogListId);
  assert.notEqual(full.listId, full.anchor);
  assert.match(stream, /<ol class="stream-list" id=\{listId\}>/);
  // A public commit is a 'commit' entry, and only a release map marks it.
  assert.ok(full.rows.every((row) => row.kind === 'commit' && row.release === undefined));
});

test('the stream pages and filters with the shared pure functions, and persists nothing', () => {
  const script = /<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/i.exec(stream)?.[1] ?? '';
  /* The paging is lib/stream.ts's, executed by tests/stream.test.mjs; the
     component composes those functions and states no number of its own. */
  assert.match(script, /import \{ filterRows, pageCount, pageRows \} from '\.\.\/stream\.ts';/);
  assert.match(script, /const filtered = \$derived\(filterRows\(rows, active\)\);/);
  assert.match(script, /const pages = \$derived\(pageCount\(filtered\.length, pageSize\)\);/);
  assert.match(script, /const shown = \$derived\(pageRows\(filtered, at, pageSize\)\);/);
  /* A filter starts its list at its first page. */
  const choose = /function choose\(key: StreamFilter\['key'\]\): void \{([\s\S]*?)\n {2}\}/.exec(script)?.[1] ?? '';
  assert.match(choose, /active = key;/);
  assert.match(choose, /page = 1;/, 'a filter leaves the reader on a page of the list they left');
  /* THE STATE IS COMPONENT-LOCAL AND NEVER PERSISTED: a stored page or filter
     would decide what the page shows before a reader has looked at it. */
  assert.match(script, /let active = \$state<StreamFilter\['key'\]>\('commit'\);/);
  assert.match(script, /let page = \$state\(1\);/);
  assert.doesNotMatch(stream, /localStorage|sessionStorage|document\.cookie/);
  // The pager is the shared one, mounted once, under the list.
  assert.equal((stream.match(/<Pager\b/g) ?? []).length, 1);
  assert.match(stream, /<Pager page=\{at\} \{pages\} previousLabel="Newer entries" nextLabel="Older entries"/);
});

/* THE SHORT IDENTITY IS ON EVERY ENTRY (owner direction, 2026-10-16: "give
 * more information"), at the entry's end. Never hidden by CSS, which would
 * leave it in the accessibility tree — it is rendered unconditionally and
 * hidden nowhere. */
test('every entry renders its short identity, and nothing hides it', () => {
  assert.match(stream, /<span class="stream-mark">\{row\.mark\}<\/span>/, 'the short identity left the entry');
  assert.doesNotMatch(streamStyle, /\.stream-mark \{[^}]*display: none/);
  /* THE ENTRY ENDS WHERE THE COLUMN DOES: the body is the one flexible track,
     so a long subject ellipsizes before the identity is pushed off. */
  assert.match(
    ruleIn(streamStyle, '.stream-entry'),
    /grid-template-columns: var\(--icon-row\) minmax\(0, 1fr\) auto;/
  );
});

test('every entry href is built by the validated helpers, and the component builds none', () => {
  // The adapter half, EXECUTED with a hostile payload: a repo that fails the
  // slug pattern, a subject that resolves no reference, and a sha shaped like
  // an injection must all arrive at the component as null hrefs — the plain
  // text branch — while their text survives verbatim as data. The title
  // destinations encode the precedence Daybreak Blue asked for (round 3,
  // finding 3): the validated SHA permalink outranks the trailing "(#N)"
  // reference, which is consulted only when no valid sha exists for the row.
  const validSha = '0123456789abcdef0123456789abcdef01234567';
  const hostileSha = `${validSha.slice(0, 33)}"onmouseover="x`;
  const hostile = projectsCommitsProps([
    null,
    {
      ...activityWith(0),
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
  const [badRepo, noReference, referenced, shaOnly, badSha] = hostile.rows;
  /* THE REPOSITORY IS A LINK AGAIN (owner, 2026-11-02, issue #399: the entry's
     byline), built by the validated slug helper and nothing else, so a hostile
     name is text with no address and poisons the entry's subject link too. */
  assert.equal(badRepo.source.text, 'evil.com/x', 'the text still renders, as text');
  assert.equal(badRepo.source.href, null, 'a hostile repository name became an address');
  assert.equal(badRepo.title.href, null, 'a hostile repo poisons the entry link too');
  assert.equal(noReference.source.href, `${projectHost}/naranjo.online`);
  assert.equal(noReference.source.label, projectLinkLabel({ name: 'naranjo.online' }));
  assert.equal(noReference.title.href, null, 'a subject with no reference and no sha renders as plain text');
  // /issues/N, never /pull/N, and a neutral "reference" accessible name.
  assert.equal(referenced.title.href, `${projectHost}/naranjo.online/issues/152`);
  assert.equal(referenced.title.label, commitReferenceLinkLabel('release (#152)'));
  assert.match(referenced.age, /\S/, 'an entry states its age');
  // The sha-permalink branch: a proven identity gets its own commit.
  assert.equal(shaOnly.title.href, `${projectHost}/naranjo.online/commit/${validSha}`);
  assert.equal(shaOnly.title.label, commitShaLinkLabel('a commit with no trailing reference', validSha));
  // A PRESENT-but-invalid sha loses only its own permalink capability.
  assert.equal(badSha.title.href, `${projectHost}/naranjo.online/issues/152`);
  assert.doesNotMatch(badSha.title.href, /onmouseover/);

  /* The structural half: the generic component renders the hrefs it is handed
     or renders text — it never assembles one. */
  const hrefs = [...stream.matchAll(/href=\{([^}]*)\}/g)].map(([, expression]) => expression);
  assert.deepEqual(hrefs.sort(), ['row.source.href', 'row.title.href'], 'the component may render exactly the validated hrefs and construct none');
  assert.match(stream, /\{#if row\.source\.href\}/);
  assert.match(stream, /\{#if row\.title\.href\}/);
  assert.match(stream, /<span class="stream-source">\{row\.source\.text\}<\/span>/);
  assert.match(stream, /<span class="stream-title">\{row\.title\.text\}<\/span>/);
  /* The short identity is DISPLAY-ONLY and the adapter decides it. */
  assert.equal(shaOnly.mark, validSha.slice(0, 7));
  assert.equal(badSha.mark, '—');
  for (const [name, source] of Object.entries({ chronicle, stream })) {
    assert.doesNotMatch(source, /\{@html/, `${name} renders entry fields as markup`);
  }
  // Every outbound link opens a new tab that says so, and closes the opener.
  assert.equal((stream.match(/target="_blank"/g) ?? []).length, 2, 'every outbound anchor must open a new tab');
  assert.equal((stream.match(/rel="noopener noreferrer"/g) ?? []).length, 2, 'every outbound anchor must carry rel="noopener noreferrer"');
  assert.match(stream, /aria-label=\{row\.title\.label\}/);
  assert.match(stream, /aria-label=\{row\.source\.label\}/);
  /* AND THE SUBJECT SAYS WHAT ITS BYLINE SAYS: the byline is the subject
     link's description, by an id the component ties to that same entry, so a
     reader who tabs straight to the subject still hears where and when. */
  assert.match(stream, /<span class="stream-by" id="\{uid\}-by-\{index\}">/);
  assert.match(stream, /aria-describedby="\{uid\}-by-\{index\}"/);
  assert.match(stream, /const uid = \$props\.id\(\);/, 'the ids are not unique to the instance');
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
test('the stream composes no freshness line from either of its envelopes (owner 2026-09-12)', () => {
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

test('activity sources stay local-origin and provider-neutral', () => {
  for (const [name, source] of Object.entries({ chronicle, stream, helpers })) {
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
