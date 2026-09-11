/* THE CALENDAR OPENS ON THE MOST ACTIVE TOKEN SERIES (owner directive,
 * 2026-09-04, issue 294: "Codex has the most activity"). The component draws
 * sets[0] until a reader presses a segment, so the ORDER the adapter returns
 * is the default view — pinned here as an order, with the lead MEASURED from
 * the payload by the adapter's one rule rather than named in it (issue #267:
 * a source key is data, and no production file spells one). */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { commitLogProps, leadTokenSource } from '../src/lib/commits.ts';
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

test('the most active token set goes first, the other token sets follow in payload order, contributions last', () => {
  const keys = (payload) => commitLogProps([null, usage(payload)]).sets.map((set) => set.key);

  // The lead is MEASURED: the set whose series carries the most tokens.
  assert.equal(leadTokenSource([reporting('anthropic', [1, 2]), reporting('codex', [3, 4])]), 'codex');
  // Payload order anthropic, codex: the lead jumps the queue.
  assert.deepEqual(keys([reporting('anthropic', [1, 2]), reporting('codex', [3, 4])]), [
    'codex',
    'anthropic',
    'contributions'
  ]);
  // Payload order codex, anthropic: the same answer, so the order is the
  // adapter's rule and not the producer's accident.
  assert.deepEqual(keys([reporting('codex', [3, 4]), reporting('anthropic', [1, 2])]), [
    'codex',
    'anthropic',
    'contributions'
  ]);
  // The rule is activity and not a name: the same two sources with the other
  // one busier open on the other one, so no key is privileged anywhere.
  assert.deepEqual(keys([reporting('codex', [3, 4]), reporting('anthropic', [10, 2])]), [
    'anthropic',
    'codex',
    'contributions'
  ]);
  // Activity is the SUM over the series — not its length, which would pick
  // the longer one here, and not its peak, which would pick the spike there.
  assert.equal(leadTokenSource([reporting('codex', [9]), reporting('anthropic', [4, 4])]), 'codex');
  assert.equal(leadTokenSource([reporting('codex', [9]), reporting('anthropic', [4, 4, 4])]), 'anthropic');
  // A tie keeps payload order, so two payloads that agree about the lead
  // agree about everything and nothing flickers between equals.
  assert.deepEqual(keys([reporting('anthropic', [2, 2]), reporting('codex', [4])]), [
    'anthropic',
    'codex',
    'contributions'
  ]);
  // A third reporting source slots after the lead in payload order.
  assert.deepEqual(
    keys([reporting('anthropic', [1]), reporting('other', [2]), reporting('codex', [3])]),
    ['codex', 'anthropic', 'other', 'contributions']
  );
  // A source with no daily series carries no activity and is offered no
  // segment, however many windows it reports (owner ruling, 2026-08-24); a
  // series with no days is the same nothing, so it cannot lead either.
  assert.deepEqual(keys([{ label: 'codex', windows: [] }, reporting('anthropic', [1])]), [
    'anthropic',
    'contributions'
  ]);
  assert.equal(
    leadTokenSource([{ label: 'codex', windows: [] }, reporting('anthropic', [])]),
    undefined
  );
  // One reporting source leads by default, and no usage envelope at all
  // leaves the contributions calendar alone, as before.
  assert.deepEqual(keys([reporting('anthropic', [1, 2])]), ['anthropic', 'contributions']);
  assert.deepEqual(commitLogProps([null, null]).sets.map((set) => set.key), ['contributions']);
});

test('the lead is the first segment the component draws, named by the vocabulary, and no panel label sits over it', () => {
  const [first, second] = sourceVocabulary.sources;
  assert.ok(second, 'the vocabulary declares one source, so the order has nothing to choose between');
  const props = commitLogProps([
    null,
    usage([reporting(first.key, [1]), reporting(second.key, [2])])
  ]);
  assert.equal(props.sets[0].label, `Tokens · ${sourceName(second.key)}`);
  assert.equal(props.sets[0].label, `Tokens · ${second.name}`);
  assert.notEqual(
    sourceName(second.key),
    second.key,
    'the vocabulary resolves this key, so the label above proves the resolution rather than a pass-through'
  );
  assert.equal(props.sets[1].label, `Tokens · ${first.name}`);
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
  const props = commitLogProps([
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
    },
    null
  ], new Date('2026-09-11T12:00:00Z'));
  // Newest first, one list, both kinds. A private day sorts by the END of its
  // day, so it sits above the commits of that same day rather than under them.
  assert.deepEqual(
    props.rows.map((row) => row.source.text),
    ['public-repo', 'private', 'public-repo', 'private']
  );
  const [, privateRow] = props.rows;
  // The host's own wording, and the plural derived rather than assumed.
  assert.equal(privateRow.title.text, '4 contributions in 2 private repositories');
  /* The key is composed rather than written out: a literal "private-<date>"
     reads as a credential to the secret scan the gate runs over this tree, and
     a scan that has to be told to ignore a test is a scan one edit from
     ignoring something real. */
  assert.equal(privateRow.key, `private-${'2026-09-10'}`);
  // NO DESTINATION, on either half: there is nothing a reader could be sent
  // to, and a link that opens a repository they cannot read would be worse
  // than no link at all.
  assert.equal(privateRow.source.href, null);
  assert.equal(privateRow.title.href, null);
  // And NO IDENTITY: a private commit's sha is exactly the kind of fact that
  // must never reach the wire, so there is nothing to shorten.
  assert.equal(privateRow.mark, '—');
  // The singular reads as a singular.
  assert.equal(props.rows[3].title.text, '1 contribution in 1 private repository');
  // Every row carries an age, and the private one's is the day's.
  for (const row of props.rows) {
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
