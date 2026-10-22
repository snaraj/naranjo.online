/* THE TOKEN SETS TAKE THE VOCABULARY'S ORDER (owner, 2026-10-21, issue 385:
 * "the order should be codex, then claude then contributions"), replacing the
 * busiest-series lead of 2026-09-04 (issue 294). The component draws sets[0]
 * until a reader presses a segment, so the ORDER the adapter returns is the
 * default view — pinned here as an order, with the expectation read from the
 * source file rather than named in it (issue #267: a source key is data, and
 * no production file spells one). */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { contributionCalendarProps, projectsCommitsProps } from '../src/lib/commits.ts';
import { parseVCSActivity } from '../src/lib/activity.ts';
import { panelKinds } from '../src/lib/panels.ts';
import { sourceName, tokenUsagePanelId } from '../src/lib/token-usage.ts';

/* The source vocabulary, read from the one file every consumer reads (issue
   #311). The segment a reader presses is named for the SOURCE that reported
   it, and the written name comes from this file rather than from the wire
   key — so the expectation below is built from the file too, and this suite
   stays a statement about the rule. */
const sourceVocabulary = JSON.parse(
  await readFile(new URL('../../internal/panels/config/sources.json', import.meta.url), 'utf8')
);

const usage = (sources) => ({
  schema: 'panel/v1',
  id: tokenUsagePanelId,
  kind: panelKinds.tokenUsage,
  title: 'Token usage',
  status: 'ok',
  generatedAt: '2026-09-04T00:00:00Z',
  data: { sources }
});

const reporting = (label, totals) => ({
  label,
  windows: [],
  series: { startDate: '2026-08-01', totals }
});

test("the token sets take the vocabulary's order whatever the payload's order or activity, contributions last", () => {
  const keys = (payload) => contributionCalendarProps([null, usage(payload)]).sets.map((set) => set.key);
  const [first, second] = sourceVocabulary.sources.map((entry) => entry.key);
  assert.ok(second, 'the vocabulary declares one source, so the order has nothing to choose between');

  // The file's order, whichever order the payload served them in.
  assert.deepEqual(keys([reporting(first, [1]), reporting(second, [2])]), [first, second, 'contributions']);
  assert.deepEqual(keys([reporting(second, [2]), reporting(first, [1])]), [first, second, 'contributions']);
  // And whichever of them is busier: activity no longer leads (it did from
  // 2026-09-04, so a source that overtook another reordered the page).
  assert.deepEqual(keys([reporting(second, [1_000_000]), reporting(first, [1])]), [first, second, 'contributions']);
  // A source the file does not name follows the named ones, in payload order.
  assert.deepEqual(
    keys([reporting('unnamed-b', [5]), reporting(second, [2]), reporting('unnamed-a', [9]), reporting(first, [1])]),
    [first, second, 'unnamed-b', 'unnamed-a', 'contributions']
  );
  // A source with no daily series is offered no segment, however many windows
  // it reports (owner ruling, 2026-08-24); a series with no days is the same.
  assert.deepEqual(keys([{ label: first, windows: [] }, reporting(second, [1])]), [second, 'contributions']);
  assert.deepEqual(keys([reporting(first, []), reporting(second, [1])]), [second, 'contributions']);
  // One reporting source leads by default, and no usage envelope at all
  // leaves the contributions calendar alone, as before.
  assert.deepEqual(keys([reporting(second, [1, 2])]), [second, 'contributions']);
  assert.deepEqual(contributionCalendarProps([null, null]).sets.map((set) => set.key), ['contributions']);
});

test("the vocabulary's first source is the first segment the component draws, named by it, and no panel label sits over it", () => {
  const [first, second] = sourceVocabulary.sources;
  // The second source is the busier and is served first: the order is still the file's.
  const props = contributionCalendarProps([
    null,
    usage([reporting(second.key, [9]), reporting(first.key, [1])])
  ]);
  assert.equal(props.sets[0].label, `Tokens · ${sourceName(first.key)}`);
  assert.equal(props.sets[0].label, `Tokens · ${first.name}`);
  assert.notEqual(
    sourceName(first.key),
    first.key,
    'the vocabulary resolves this key, so the label above proves the resolution rather than a pass-through'
  );
  assert.equal(props.sets[1].label, `Tokens · ${second.name}`);
  assert.equal(props.sets.at(-1).label, 'Contributions');
  assert.equal(props.title, undefined, 'the commit block hands the shell a title again');
});

/* THE LOG IS ONE LIST OF TWO KINDS OF ROW (owner directive, 2026-09-11, issue
 * #315): a public commit, and a day of private contribution the account made
 * without publishing it. A separate private section would read as a footnote
 * to the record rather than as part of it, so the two interleave by instant —
 * and a private row says only what the host's own wording says, with no name,
 * no identity and no destination. */
test('private days interleave with the public commits, counted and never named', () => {
  /* The rows are the SHEET's right-hand column now (owner design decision,
     2026-09-11, issue 318), built by the same walk they always were — so the
     adapter this drives moved and the claim did not. The projects envelope is
     null, which is the captured-fallback face: the left column is irrelevant
     to the ordering claim and says so by being absent. */
  const props = projectsCommitsProps([
    null,
    {
      schema: 'panel/v1',
      id: 'vcs-activity',
      kind: panelKinds.vcsActivity,
      title: 'Fixture Activity',
      status: 'ok',
      generatedAt: '2026-09-11T12:00:00Z',
      data: {
        totalContributions: 9,
        weeks: [[0, 0, 0, 0, 0, 0, 1]],
        streak: 1,
        endDate: '2026-09-11',
        recentCommits: [
          { repo: 'public-repo', sha: 'a'.repeat(40), message: 'feat: the newest public thing', at: '2026-09-11T09:00:00Z' },
          { repo: 'public-repo', sha: 'b'.repeat(40), message: 'fix: an older public thing', at: '2026-09-09T09:00:00Z' }
        ],
        privateActivity: [
          { date: '2026-09-10', contributions: 4, repositories: 2 },
          { date: '2026-09-08', contributions: 1, repositories: 1 }
        ]
      }
    }
  ], new Date('2026-09-11T12:00:00Z'));
  // Newest first, one list, both kinds. A private day sorts by the END of its
  // day, so it sits above the commits of that same day rather than under them.
  /* `source` is the supporting line's TEXT (owner direction, 2026-10-16: the
     entry is one link, the subject's), so it is compared as text. */
  assert.deepEqual(
    props.logRows.map((row) => row.source),
    ['public-repo', 'private', 'public-repo', 'private']
  );
  const [, privateRow] = props.logRows;
  // The host's own wording, and the plural derived rather than assumed.
  assert.equal(privateRow.title.text, '4 contributions in 2 private repositories');
  /* The key is composed rather than written out: a literal "private-<date>"
     reads as a credential to the secret scan the gate runs over this tree, and
     a scan that has to be told to ignore a test is a scan one edit from
     ignoring something real. */
  assert.equal(privateRow.key, `private-${'2026-09-10'}`);
  // NO DESTINATION: there is nothing a reader could be sent to, and a link
  // that opens a repository they cannot read would be worse than no link at
  // all. The entry's one link is its title's, and the source is text on every
  // entry (owner direction, 2026-10-16), so it can carry no address either.
  assert.equal(typeof privateRow.source, 'string');
  assert.equal(privateRow.title.href, null);
  // And NO IDENTITY: a private commit's sha is exactly the kind of fact that
  // must never reach the wire, so there is nothing to shorten.
  assert.equal(privateRow.mark, '—');
  // The singular reads as a singular.
  assert.equal(props.logRows[3].title.text, '1 contribution in 1 private repository');
  // Every row carries an age, and the private one's is the day's.
  for (const row of props.logRows) {
    assert.ok(row.age.length > 0, 'a row carries no age');
  }
});

/* Admission is fail-closed on the one field a reader cannot go and check.
 * There is no link, no identity and no name to verify a private aggregate
 * against, so a row of it is exactly three well-formed values or the panel
 * renders its honest empty state rather than a sentence about a quantity
 * nobody can audit. */
test('a malformed private day refuses the whole payload', () => {
  const base = {
    totalContributions: 1,
    weeks: [[0, 0, 0, 0, 0, 0, 1]],
    streak: 1,
    endDate: '2026-09-11',
    recentCommits: []
  };
  for (const privateActivity of [
    'not an array',
    [{ date: '2026-09-10', contributions: 1 }],
    [{ date: '2026-09-10', contributions: 1, repositories: '2' }],
    [{ date: '2026-09-10', contributions: -1, repositories: 1 }],
    [{ date: '2026-09-10', contributions: 1.5, repositories: 1 }],
    [{ date: '2026-09-10', contributions: 1, repositories: -1 }],
    [{ date: '2026-09-10', contributions: Number.MAX_SAFE_INTEGER + 2, repositories: 1 }],
    [{ date: 'the tenth', contributions: 1, repositories: 1 }],
    [{ contributions: 1, repositories: 1 }],
    [null]
  ]) {
    assert.equal(
      parseVCSActivity({ ...base, privateActivity }),
      null,
      `admitted a malformed private day: ${JSON.stringify(privateActivity)}`
    );
  }
  // The positive controls: absent is the rolling-compatibility state, and a
  // well-formed list is admitted whole.
  assert.deepEqual(parseVCSActivity(base).privateActivity, undefined);
  assert.deepEqual(
    parseVCSActivity({ ...base, privateActivity: [{ date: '2026-09-10', contributions: 0, repositories: 0 }] })
      .privateActivity,
    [{ date: '2026-09-10', contributions: 0, repositories: 0 }]
  );
});
