/* The owner's live-data directive, frontend half (issue 242).
 *
 * Three claims are pinned here, each in both directions:
 *
 *   - The contribution payload declares which coverage it is, because the two
 *     producers count different things and the number moves by hundreds
 *     between them — admitted as a closed vocabulary, worded nowhere since the
 *     captions left (owner directive, 2026-09-12, issue 323).
 *   - The repositories panel's releases reach the stream as the host reports
 *     them now, and a panel the page cannot read marks no release at all
 *     rather than an old one (owner, 2026-11-02, issue #399).
 *   - The block that feeds it is bound to the panel rather than to a frozen
 *     props object.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, it, test } from 'node:test';

import { activityPanelId, parseVCSActivity } from '../src/lib/activity.ts';
import { contributionCalendarProps, projectsCommitsProps, spreadPanelIds } from '../src/lib/commits.ts';
import { codingProjectsPanelId, parseCodingProjects } from '../src/lib/projects.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const noon = Date.parse('2026-08-28T12:00:00Z');

/* One well-formed envelope around a coding-projects payload, shaped exactly as
 * the block host delivers it. */
const projectsEnvelope = (repos, overrides = {}) => ({
  schema: 'panel/v1',
  id: codingProjectsPanelId,
  kind: 'coding-projects/v2',
  title: 'Coding Projects',
  generatedAt: '2026-08-28T11:59:00Z',
  status: 'ok',
  data: { repos },
  ...overrides
});

const liveRow = (name, extra = {}) => ({
  name,
  description: `${name} as the host describes it now`,
  stars: 3,
  pushedAt: '2026-08-28T09:00:00Z',
  ...extra
});

describe('the contribution payload declares its coverage', () => {
  /* THE WORD IT USED TO PUT ON THE PAGE IS GONE (owner directive, 2026-09-12,
     issue 323). The field exists because the two producers count different
     things: an anonymous read of the public document reports only what an
     anonymous reader may see, a credentialed read reports the account holder's
     whole record. The page WORDED that in the calendar's caption — "1,287
     public contributions · 9-day streak" — and the caption left with every
     other chart caption, so nothing on the page states a total for the
     coverage to qualify.
     What must not leave is the ADMISSION: coverage is still a closed
     vocabulary the parser refuses free text in, because the day a figure is
     worded from it again it must be one of exactly two values. */
  it('carries the declared coverage through the parser, and words it nowhere', () => {
    const weeks = Array.from({ length: 5 }, () => [1, 0, 0, 0, 0, 0, 0]);
    const envelope = (coverage) => ({
      schema: 'panel/v1',
      id: 'vcs-activity',
      kind: 'vcs-activity/v1',
      title: 'GitHub',
      status: 'ok',
      data: {
        totalContributions: 5,
        weeks,
        streak: 0,
        recentCommits: [],
        endDate: '2026-08-22',
        ...(coverage === undefined ? {} : { coverage })
      }
    });
    assert.equal(parseVCSActivity(envelope('public').data).coverage, 'public');
    assert.equal(parseVCSActivity(envelope('complete').data).coverage, 'complete');
    assert.equal(parseVCSActivity(envelope(undefined).data).coverage, undefined);
    /* And no set the calendar composes says anything about it: there is no
       caption for the word to be printed in, whatever the payload declared. */
    for (const coverage of ['public', 'complete', undefined]) {
      const [set] = contributionCalendarProps([envelope(coverage), null]).sets;
      assert.equal(set.caption, undefined, String(coverage));
    }
    /* The builder that worded the two cases is gone with the caption, so a
       later edit cannot quietly re-point a line at one that still exists. */
    const activity = readFileSync(new URL('../src/lib/activity.ts', import.meta.url), 'utf8');
    assert.ok(!activity.includes('contributionsLabel'), 'the coverage wording outlived the caption');
  });

  it('refuses a coverage outside the closed vocabulary', () => {
    // Coverage decides what a figure worded from it would SAY, so it is
    // admitted by MEMBERSHIP: free text here would let a payload put arbitrary
    // words beside the owner's contribution total the day one is printed again.
    const payload = (coverage) => ({
      totalContributions: 1,
      weeks: [[1, 0, 0, 0, 0, 0, 0]],
      streak: 1,
      recentCommits: [],
      coverage
    });
    assert.equal(parseVCSActivity(payload('private-and-then-some')), null);
    assert.equal(parseVCSActivity(payload(7)), null);
    assert.notEqual(parseVCSActivity(payload('public')), null);
    assert.notEqual(parseVCSActivity(payload('complete')), null);
  });
});

describe('the stream’s releases follow the host (issue #399)', () => {
  const sha = 'b93ba24fd27c26e0edf52f21f903d3a4b9d4817a';
  const activity = {
    schema: 'panel/v1',
    id: activityPanelId,
    kind: 'vcs-activity/v1',
    title: 'Fixture Activity',
    status: 'ok',
    generatedAt: '2026-08-28T11:59:00Z',
    data: {
      totalContributions: 2,
      weeks: [[0, 0, 0, 0, 0, 1, 1]],
      streak: 2,
      recentCommits: [
        { repo: 'released', sha, message: 'the release commit', at: '2026-08-28T09:00:00Z' },
        { repo: 'released', sha: 'c'.repeat(40), message: 'an older commit', at: '2026-08-27T09:00:00Z' }
      ]
    }
  };
  const releaseOf = (envelope) =>
    projectsCommitsProps([envelope, activity], new Date(noon)).rows.map((row) => row.release);

  it('marks the commit the host says its latest release was cut from, right now', () => {
    /* The commission, exactly: a release cut on the host reaches the page on
       the next refresh with no release of this site, on the commit it names. */
    assert.deepEqual(
      releaseOf(projectsEnvelope([liveRow('released', { release: '1.1.12', releasedAt: '2026-08-28T09:30:00Z', releaseSha: sha })])),
      ['1.1.12', undefined]
    );
    // The host cut the next one from the older commit: the mark moves with it.
    assert.deepEqual(
      releaseOf(projectsEnvelope([liveRow('released', { release: '1.1.13', releaseSha: 'c'.repeat(40) })])),
      [undefined, '1.1.13']
    );
  });

  it('marks no release for a null, wrong-kinded, or malformed envelope', () => {
    /* There is no captured face any more: a panel the page cannot read is an
       empty release map, so every commit still renders and none of them claims
       a version the page could not vouch for. */
    for (const envelope of [
      null,
      projectsEnvelope([], { kind: 'vcs-activity/v1' }),
      projectsEnvelope([], { data: { repos: [{ name: 'x', description: 5, stars: 1 }] } }),
      projectsEnvelope([liveRow('released', { release: '1.1.12', releaseSha: sha.toUpperCase() })]),
      projectsEnvelope([], { data: null })
    ]) {
      assert.deepEqual(releaseOf(envelope), [undefined, undefined], `${JSON.stringify(envelope)?.slice(0, 80)} marked a release`);
    }
  });

  it('admits only the exact payload shape, and refuses wholesale', () => {
    // A payload that half-parses is drift, and a half-parsed repository list
    // looks exactly like an owner who deleted a project.
    assert.equal(parseCodingProjects(null), null);
    assert.equal(parseCodingProjects({}), null);
    assert.equal(parseCodingProjects({ repos: {} }), null);
    for (const bad of [
      { name: '', description: 'x', stars: 1 },
      { name: 'x', description: 5, stars: 1 },
      { name: 'x', description: 'x', stars: -1 },
      { name: 'x', description: 'x', stars: 1.5 },
      { name: 'x', description: 'x', stars: Number.MAX_SAFE_INTEGER + 2 },
      { name: 'x', description: 'x', stars: 1, pushedAt: 7 },
      { name: 'x', description: 'x', stars: 1, recorded: 'yes' },
      // The open-work tallies (issue 252) are admitted only as absent or as a
      // non-negative whole number. NULL is refused rather than read as
      // "unknown": the producer signals unknown by omitting the key, so a null
      // is drift, and reading it as unknown would make a drifted payload
      // indistinguishable from an honest one.
      { name: 'x', description: 'x', stars: 1, closedPulls: null },
      { name: 'x', description: 'x', stars: 1, closedPulls: -1 },
      { name: 'x', description: 'x', stars: 1, closedPulls: 1.5 },
      { name: 'x', description: 'x', stars: 1, closedPulls: '3' },
      { name: 'x', description: 'x', stars: 1, closedPulls: Number.MAX_SAFE_INTEGER + 2 },
      // A release tag is printed verbatim in a cell, so it is admitted
      // through a grammar rather than by type alone (issue #317).
      { name: 'x', description: 'x', stars: 1, release: null },
      { name: 'x', description: 'x', stars: 1, release: 3 },
      { name: 'x', description: 'x', stars: 1, release: 'v1 0' },
      { name: 'x', description: 'x', stars: 1, release: 'v1/../../etc' },
      { name: 'x', description: 'x', stars: 1, release: '..' },
      { name: 'x', description: 'x', stars: 1, release: 'v'.repeat(65) },
      // The release's commit is compared for EQUALITY with a commit's own
      // identity (issue #399), so anything but the full forty lowercase hex
      // digits is drift, refused with the rest rather than matched loosely.
      { name: 'x', description: 'x', stars: 1, release: 'v2', releaseSha: null },
      { name: 'x', description: 'x', stars: 1, release: 'v2', releaseSha: 7 },
      { name: 'x', description: 'x', stars: 1, release: 'v2', releaseSha: 'b93ba24' },
      { name: 'x', description: 'x', stars: 1, release: 'v2', releaseSha: 'B'.repeat(40) },
      { name: 'x', description: 'x', stars: 1, release: 'v2', releaseSha: `${'b'.repeat(40)} ` },
      { name: 'x', description: 'x', stars: 1, release: 'v2', releaseSha: 'b'.repeat(41) },
      { name: 'x', description: 'x', stars: 1, release: 'v2', releasedAt: null },
      { name: 'x', description: 'x', stars: 1, release: 'v2', releasedAt: 1730000000 },
      { name: 'x', description: 'x', stars: 1, pinned: 'yes' },
      { name: 'x', description: 'x', stars: 1, pinned: 1 }
    ]) {
      assert.equal(
        parseCodingProjects({ repos: [{ name: 'ok', description: 'ok', stars: 0 }, bad] }),
        null,
        `admitted a malformed row: ${JSON.stringify(bad)}`
      );
    }
    // ...and the well-formed one survives, including the legitimate absences.
    assert.deepEqual(
      parseCodingProjects({ repos: [{ name: 'x', description: '', stars: null }] }),
      { repos: [{ name: 'x', description: '', stars: null }] }
    );
    // A reported zero on either tally is data and is carried through, which is
    // what keeps the refusals above from being a blanket "no tallies".
    assert.deepEqual(
      parseCodingProjects({
        repos: [{ name: 'x', description: '', stars: null, closedPulls: 0, release: 'v2', pinned: true }]
      }),
      { repos: [{ name: 'x', description: '', stars: null, closedPulls: 0, release: 'v2', pinned: true }] }
    );
    // And a release's instant and commit, well formed, are carried through.
    const sha = 'b93ba24fd27c26e0edf52f21f903d3a4b9d4817a';
    assert.deepEqual(
      parseCodingProjects({
        repos: [{ name: 'x', description: '', stars: 1, release: 'v2', releasedAt: '2026-11-02T18:57:51Z', releaseSha: sha }]
      }),
      { repos: [{ name: 'x', description: '', stars: 1, release: 'v2', releasedAt: '2026-11-02T18:57:51Z', releaseSha: sha }] }
    );
  });
});

test('the Ongoing Work block is bound to its panels, not to a frozen props object', async () => {
  // The structural half of the commission: a static binding cannot follow the
  // host however good the adapter is, so the binding itself is pinned. It is a
  // MULTI-panel binding since the sheet paired the two columns (owner design
  // decision, 2026-09-11, issue 318) — the repositories and the contributions
  // record, in that order.
  const binding = await read('../src/lib/blocks/projectsCommits.ts');
  assert.match(binding, /panelsBlock\(/);
  assert.doesNotMatch(binding, /staticBlock\(/);
  assert.match(binding, /spreadPanelIds/);
  assert.deepEqual(spreadPanelIds, [codingProjectsPanelId, activityPanelId]);
  assert.equal(codingProjectsPanelId, 'coding-projects');
});

test('no source file prints a provenance sentence, and no detail carries one (issue 299)', async () => {
  /* The owner removed every instance of "recorded out of band, not fetched
     live" (2026-09-06, issue 299). The sentence used to be ONE exported
     constant; now it is nothing — no constant, no literal, no detail row —
     and this pin reads every frontend source file so a copy cannot come back
     under another name. The `recorded` flags stay in the payload types, which
     is why the sweep keys on the sentence and not on the word. */
  const { readdir } = await import('node:fs/promises');
  const root = new URL('../src/', import.meta.url);
  const files = (await readdir(root, { recursive: true })).filter((name) => /\.(ts|svelte|css)$/.test(name));
  assert.ok(files.length > 20, 'the sweep found too few source files to be a sweep');
  for (const name of files) {
    const source = await read(new URL(name, root));
    assert.doesNotMatch(source, /out of band|not fetched live/i, `${name} still prints the provenance sentence`);
  }
});
