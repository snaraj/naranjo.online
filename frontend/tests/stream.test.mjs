/* Ongoing Work as one stream (owner, 2026-11-02, issue 399, mock 04:
 * "Implement the 04 one stream and combine both entries … Keep it at 5 entries
 * with sleek pagination").
 *
 * Two things are executed here. The stream's three pure functions, which the
 * component pages and filters with, at the edges a page has. And the adapter's
 * one new claim: a commit carries its repository's version EXACTLY when the
 * repository's latest release names that commit — full forty-digit equality,
 * never a prefix and never case-folded, because a version on the wrong entry
 * is a claim the record does not make. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { projectsCommitsProps } from '../src/lib/commits.ts';
import { parseCodingProjects } from '../src/lib/projects.ts';
import { filterRows, pageCount, pageRows } from '../src/lib/stream.ts';

const now = new Date('2026-11-02T20:00:00Z');
const releaseSha = 'b93ba24fd27c26e0edf52f21f903d3a4b9d4817a';
const otherSha = '0123456789abcdef0123456789abcdef01234567';

const projectsEnvelope = (repos) => ({
  schema: 'panel/v1',
  id: 'coding-projects',
  kind: 'coding-projects/v2',
  title: 'Coding Projects',
  status: 'ok',
  generatedAt: '2026-11-02T19:59:00Z',
  data: { repos }
});

const activityEnvelope = (recentCommits, privateActivity) => ({
  schema: 'panel/v1',
  id: 'vcs-activity',
  kind: 'vcs-activity/v1',
  title: 'Fixture Activity',
  status: 'ok',
  generatedAt: '2026-11-02T19:59:00Z',
  data: {
    totalContributions: 3,
    weeks: [[0, 0, 0, 0, 0, 1, 2]],
    streak: 2,
    endDate: '2026-11-02',
    recentCommits,
    ...(privateActivity === undefined ? {} : { privateActivity })
  }
});

const repo = (name, extra = {}) => ({ name, description: '', stars: 0, pushedAt: '2026-11-02T18:00:00Z', ...extra });

/* The fixture the adapter claims are read from: a release cut from the newest
   commit of one repository, an older commit of the same repository, a commit
   of a repository that released from somewhere else, and a private day. */
const stream = (projects) =>
  projectsCommitsProps(
    [
      projects,
      activityEnvelope(
        [
          { repo: 'obsync', sha: releaseSha, message: 'release 1.1.12', at: '2026-11-02T18:57:00Z' },
          { repo: 'obsync', sha: otherSha, message: 'an older commit', at: '2026-11-01T12:00:00Z' },
          { repo: 'theme', sha: 'c'.repeat(40), message: 'a commit with no release of its own', at: '2026-10-30T12:00:00Z' }
        ],
        [{ date: '2026-11-01', contributions: 2, repositories: 1 }]
      )
    ],
    now
  ).rows;

describe('a commit carries its repository’s release exactly when the release names it', () => {
  it('marks the commit the latest release was cut from, and no other', () => {
    const rows = stream(projectsEnvelope([repo('obsync', { release: '1.1.12', releaseSha }), repo('theme', { release: 'v3', releaseSha: 'd'.repeat(40) })]));
    assert.deepEqual(
      rows.map((row) => [row.kind, row.source.text, row.release]),
      [
        ['commit', 'obsync', '1.1.12'],
        ['private', 'private', undefined],
        ['commit', 'obsync', undefined],
        ['commit', 'theme', undefined]
      ]
    );
  });

  it('marks nothing for a repository that names a release but not its commit', () => {
    const rows = stream(projectsEnvelope([repo('obsync', { release: '1.1.12' })]));
    assert.ok(rows.every((row) => row.release === undefined), 'a version was placed on a commit nobody named');
  });

  it('marks nothing for a release cut from a commit that shares every character but the last', () => {
    /* A well-formed identity the parser admits, equal to the commit's in its
       first 39 characters: only a whole-identity comparison tells the two
       apart, so a prefix match of any length short of 40 marks this commit. */
    const twin = `${releaseSha.slice(0, 39)}${releaseSha.at(-1) === 'a' ? 'b' : 'a'}`;
    const rows = stream(projectsEnvelope([repo('obsync', { release: '1.1.12', releaseSha: twin })]));
    assert.ok(rows.every((row) => row.release === undefined), 'a version was placed on a commit whose identity only began like the release’s');
  });

  it('never matches a short or case-folded identity: the parser refuses it, and the stream marks nothing', () => {
    for (const drifted of [releaseSha.slice(0, 7), releaseSha.toUpperCase()]) {
      const repos = [repo('obsync', { release: '1.1.12', releaseSha: drifted })];
      assert.equal(parseCodingProjects({ repos }), null, `the parser admitted ${drifted}`);
      assert.ok(
        stream(projectsEnvelope(repos)).every((row) => row.release === undefined),
        `a ${drifted.length}-character or case-folded identity marked a commit`
      );
    }
  });

  it('marks nothing when the repositories panel is absent, wrong-kinded or refused', () => {
    for (const projects of [null, { ...projectsEnvelope([]), kind: 'boss-log/v1' }, projectsEnvelope([{ name: '..' }])]) {
      assert.ok(stream(projects).every((row) => row.release === undefined));
    }
  });

  it('hands the tag verbatim, however long, for the line to ellipsize', () => {
    const long = 'v0.0.0-release-candidate.1.build.2026110200000000';
    const [first] = stream(projectsEnvelope([repo('obsync', { release: long, releaseSha })]));
    assert.equal(first.release, long);
  });

  it('gives a private day no source, no identity and no release', () => {
    const [, privateRow] = stream(projectsEnvelope([repo('obsync', { release: '1.1.12', releaseSha })]));
    assert.equal(privateRow.kind, 'private');
    assert.equal(privateRow.source.href, null);
    assert.equal(privateRow.title.href, null);
    assert.equal(privateRow.mark, '—');
    assert.equal(privateRow.release, undefined);
  });
});

describe('the filters keep what they name', () => {
  const rows = stream(projectsEnvelope([repo('obsync', { release: '1.1.12', releaseSha })]));

  it('keeps every row for everything, in the order it arrived', () => {
    assert.deepEqual(filterRows(rows, 'all'), rows);
  });

  it('keeps the public commits, and no private day', () => {
    const commits = filterRows(rows, 'commit');
    assert.equal(commits.length, 3);
    assert.ok(commits.every((row) => row.kind === 'commit'));
  });

  it('keeps only the entries that carry a release', () => {
    assert.deepEqual(
      filterRows(rows, 'release').map((row) => row.release),
      ['1.1.12']
    );
  });

  it('says what an empty filter means, each in its own words', () => {
    /* Today's state until a capture names a release: commits arrive, none of
       them is a repository's latest release, and the Releases filter keeps
       nothing. The component prints the chosen filter's own note in the
       reserve; the adapter writes one for every filter. */
    const props = projectsCommitsProps(
      [projectsEnvelope([repo('obsync', { release: '1.1.12' })]), activityEnvelope([{ repo: 'obsync', sha: otherSha, message: 'a commit', at: '2026-11-01T12:00:00Z' }])],
      now
    );
    const empty = Object.fromEntries(props.filters.map((filter) => [filter.key, filter.empty]));
    assert.deepEqual(empty, {
      all: props.emptyNote,
      commit: props.emptyNote,
      release: 'no release among the recent commits'
    });
    assert.equal(filterRows(props.rows, 'release').length, 0, 'the fixture this case is about keeps a release after all');
    assert.ok(filterRows(props.rows, 'all').length > 0);
    for (const filter of props.filters) {
      assert.ok(filter.empty.trim().length > 0, `the ${filter.key} filter has nothing to say when it keeps nothing`);
    }
  });
});

describe('the page math holds at the edges a page has', () => {
  const rowsOf = (count) => Array.from({ length: count }, (_, index) => ({ key: `r${index}` }));
  const keys = (rows) => rows.map((row) => row.key);

  it('counts pages, never fewer than one', () => {
    for (const [total, pages] of [[0, 1], [1, 1], [5, 1], [6, 2], [31, 7]]) {
      assert.equal(pageCount(total, 5), pages, `${total} rows`);
    }
  });

  it('shows each page’s own rows, and nothing past the last', () => {
    assert.deepEqual(pageRows(rowsOf(0), 1, 5), []);
    assert.deepEqual(keys(pageRows(rowsOf(1), 1, 5)), ['r0']);
    assert.deepEqual(keys(pageRows(rowsOf(5), 1, 5)), ['r0', 'r1', 'r2', 'r3', 'r4']);
    assert.deepEqual(keys(pageRows(rowsOf(6), 2, 5)), ['r5']);
    assert.deepEqual(keys(pageRows(rowsOf(31), 7, 5)), ['r30']);
    // Every row is on exactly one page.
    const all = Array.from({ length: pageCount(31, 5) }, (_, index) => keys(pageRows(rowsOf(31), index + 1, 5))).flat();
    assert.deepEqual(all, keys(rowsOf(31)));
  });

  it('clamps a page past either end to the nearest real one', () => {
    assert.deepEqual(keys(pageRows(rowsOf(6), 9, 5)), ['r5'], 'rows that shrank under a reader left them on an empty page');
    assert.deepEqual(keys(pageRows(rowsOf(6), 0, 5)), ['r0', 'r1', 'r2', 'r3', 'r4']);
  });
});
