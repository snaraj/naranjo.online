/* Ongoing Work as one stream (owner, 2026-11-02, issue 399, mock 04:
 * "Implement the 04 one stream and combine both entries … Keep it at 5 entries
 * with sleek pagination").
 *
 * Two things are executed here. The stream's three pure functions, which the
 * component pages and filters with, at the edges a page has — the three feeds
 * of the latest work (owner, 2026-11-03, issue 401), each keeping its own
 * kinds, each cut at the origin's cap, every entry in exactly one. And the
 * adapter's claims: the merge and release entries it builds from the wire, and
 * a commit carrying its repository's version EXACTLY when the
 * repository's latest release names that commit — full forty-digit equality,
 * never a prefix and never case-folded, because a version on the wrong entry
 * is a claim the record does not make. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseVCSActivity } from '../src/lib/activity.ts';
import { projectsCommitsProps, streamFeedRows, streamMergesEmptyNote, streamReleasesEmptyNote } from '../src/lib/commits.ts';
import { parseCodingProjects, projectHost } from '../src/lib/projects.ts';
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

const activityEnvelope = (recentCommits, privateActivity, lists = {}) => ({
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
    ...(privateActivity === undefined ? {} : { privateActivity }),
    ...lists
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

describe('the three feeds keep what they name (owner, 2026-11-03, issue 401)', () => {
  /* One row of every kind a feed has to tell apart: public commits (one of
     them a release commit), a private day, merged pull requests and
     releases. The first case proves each is present, so no case below holds
     vacuously. */
  const merges = [
    { repo: 'obsync', number: 380, title: 'docs: a privacy page', at: '2026-11-02T19:00:00Z', sha: 'e'.repeat(40) },
    { repo: 'theme', number: 92, title: 'Formula: v3', at: '2026-10-31T12:00:00Z', sha: 'f'.repeat(40) }
  ];
  const releases = [
    { repo: 'obsync', tag: '1.1.12', title: 'Release 1.1.12: pairing again', at: '2026-11-02T18:58:00Z', sha: releaseSha },
    { repo: 'theme', tag: 'v3', title: 'Release v3', at: '2026-10-29T12:00:00Z', sha: 'd'.repeat(40) }
  ];
  const props = projectsCommitsProps(
    [
      projectsEnvelope([repo('obsync', { release: '1.1.12', releaseSha })]),
      activityEnvelope(
        [
          { repo: 'obsync', sha: releaseSha, message: 'release 1.1.12', at: '2026-11-02T18:57:00Z' },
          { repo: 'obsync', sha: otherSha, message: 'an older commit', at: '2026-11-01T12:00:00Z' },
          { repo: 'theme', sha: 'c'.repeat(40), message: 'a commit with no release of its own', at: '2026-10-30T12:00:00Z' }
        ],
        [{ date: '2026-11-01', contributions: 2, repositories: 1 }],
        { recentMerges: merges, recentReleases: releases }
      )
    ],
    now
  );
  const rows = props.rows;
  const kinds = (feed) => feed.map((row) => row.kind);

  it('is given every kind of row to tell apart', () => {
    for (const kind of ['commit', 'private', 'merge', 'release']) {
      assert.ok(rows.some((row) => row.kind === kind), `the fixture holds no ${kind} row`);
    }
    assert.ok(rows.some((row) => row.kind === 'commit' && row.release !== undefined), 'the fixture holds no release commit');
  });

  it('keeps the commits and the private days among them in the commit feed, and nothing else', () => {
    assert.deepEqual(kinds(filterRows(rows, 'commit')), ['commit', 'private', 'commit', 'commit']);
  });

  it('keeps only the merged pull requests in the merge feed, and only the releases in the release feed', () => {
    assert.deepEqual(kinds(filterRows(rows, 'merge')), ['merge', 'merge']);
    assert.deepEqual(kinds(filterRows(rows, 'release')), ['release', 'release']);
  });

  it('puts every row in exactly one feed', () => {
    const feeds = props.filters.map((filter) => filterRows(rows, filter.key));
    for (const row of rows) {
      const places = feeds.filter((feed) => feed.includes(row)).length;
      assert.equal(places, 1, `${row.key} is in ${places} feeds`);
    }
    assert.equal(feeds.reduce((total, feed) => total + feed.length, 0), rows.length, 'a feed keeps a row no feed was given');
  });

  it('builds a merge entry from the wire: the pull request’s own page, its number where the identity sits', () => {
    const [newest] = filterRows(rows, 'merge');
    assert.equal(newest.source.text, 'obsync');
    assert.equal(newest.title.text, 'docs: a privacy page');
    assert.equal(newest.title.href, `${projectHost}/obsync/pull/380`);
    assert.match(newest.title.label, /pull request #380/);
    assert.equal(newest.mark, '#380');
    assert.equal(newest.release, undefined, 'a merge wears a version');
  });

  it('builds a release entry from the wire: its tag as the chip, the release’s own page, the commit’s short identity', () => {
    const [newest] = filterRows(rows, 'release');
    assert.equal(newest.source.text, 'obsync');
    assert.equal(newest.release, '1.1.12');
    assert.equal(newest.title.text, 'Release 1.1.12: pairing again');
    assert.equal(newest.title.href, `${projectHost}/obsync/releases/tag/1.1.12`);
    assert.equal(newest.mark, releaseSha.slice(0, 7));
  });

  it('builds no address from a repository or an identity it cannot vouch for', () => {
    const hostile = 'evil.example" onmouseover="x';
    const feed = projectsCommitsProps(
      [null, activityEnvelope([], undefined, { recentMerges: [{ ...merges[0], repo: hostile }], recentReleases: [{ ...releases[0], repo: hostile, sha: 'not-an-identity' }] })],
      now
    ).rows;
    assert.equal(feed.length, 2);
    for (const row of feed) {
      assert.equal(row.source.href, null);
      assert.equal(row.title.href, null);
      assert.equal(row.source.text, hostile, 'the text did not survive as data');
    }
    assert.equal(feed.find((row) => row.kind === 'release').mark, '—');
  });

  it('refuses a payload whose merge or release rows drift, and admits one without them', () => {
    const drifted = [
      { recentMerges: [{ ...merges[0], number: 0 }] },
      { recentMerges: [{ ...merges[0], number: '380' }] },
      { recentMerges: [{ ...merges[0], title: undefined }] },
      { recentMerges: {} },
      { recentReleases: [{ ...releases[0], tag: '' }] },
      { recentReleases: [{ ...releases[0], tag: 'v1/2' }] },
      { recentReleases: [{ ...releases[0], sha: 7 }] }
    ];
    for (const extra of drifted) {
      assert.equal(parseVCSActivity(activityEnvelope([], undefined, extra).data), null, `admitted ${JSON.stringify(extra)}`);
    }
    assert.notEqual(parseVCSActivity(activityEnvelope([], undefined).data), null);
  });

  it('cuts every feed at the origin’s own cap, newest first, so full feeds page alike', () => {
    /* Over the cap in every list, private days included, so the cut is the
       adapter's own and not only the wire's. The cap itself is pinned to the
       origin's in tests/panels-ui.test.mjs, beside the other config pins. */
    assert.equal(streamFeedRows, 30);
    const instant = (hoursAgo) => new Date(now.getTime() - hoursAgo * 3600000).toISOString().replace('.000', '');
    const many = projectsCommitsProps(
      [
        null,
        activityEnvelope(
          Array.from({ length: streamFeedRows + 4 }, (_, index) => ({ repo: 'obsync', sha: index.toString(16).padStart(40, '0'), message: `c${index}`, at: instant(index * 7) })),
          Array.from({ length: 10 }, (_, index) => ({ date: instant(24 * (index + 1)).slice(0, 10), contributions: 1, repositories: 1 })),
          {
            recentMerges: Array.from({ length: streamFeedRows + 4 }, (_, index) => ({ ...merges[0], number: index + 1, at: instant(index) })),
            recentReleases: Array.from({ length: streamFeedRows + 4 }, (_, index) => ({ ...releases[0], tag: `v${index}`, at: instant(index) }))
          }
        )
      ],
      now
    );
    const pages = new Set();
    for (const { key } of many.filters) {
      const feed = filterRows(many.rows, key);
      assert.equal(feed.length, streamFeedRows, `the ${key} feed holds ${feed.length}`);
      pages.add(pageCount(feed.length, many.pageSize));
    }
    assert.deepEqual([...pages], [6], 'full feeds page to different counts');
    /* Newest first: the commit feed interleaves its private days by date
       (the end of the day, as the adapter orders them), and every feed opens
       on its newest entry. */
    const commitFeed = filterRows(many.rows, 'commit');
    const at = (row) => (row.kind === 'private' ? `${row.key.slice('private-'.length)}T23:59:59Z` : instant(Number(row.title.text.slice(1)) * 7));
    for (let index = 1; index < commitFeed.length; index += 1) {
      assert.ok(at(commitFeed[index - 1]) >= at(commitFeed[index]), `commit feed entry ${index} is newer than the one above it`);
    }
    assert.equal(filterRows(many.rows, 'merge')[0].mark, '#1');
    assert.equal(filterRows(many.rows, 'release')[0].release, 'v0');
  });

  it('gives each feed an empty note of its own when the wire carries none of its rows', () => {
    const plain = projectsCommitsProps(
      [null, activityEnvelope([{ repo: 'obsync', sha: otherSha, message: 'a commit', at: '2026-11-01T12:00:00Z' }])],
      now
    );
    const empty = Object.fromEntries(plain.filters.map((filter) => [filter.key, filter.empty]));
    assert.deepEqual(empty, { commit: plain.emptyNote, merge: streamMergesEmptyNote, release: streamReleasesEmptyNote });
    assert.equal(filterRows(plain.rows, 'merge').length, 0);
    assert.equal(filterRows(plain.rows, 'release').length, 0);
    for (const key of ['merge', 'release']) {
      assert.notEqual(empty[key], plain.emptyNote, `the ${key} feed falls back to the commit feed’s note`);
    }
    assert.notEqual(streamMergesEmptyNote, streamReleasesEmptyNote);
  });

  it('shows a private-only record in the commit feed, and the other feeds’ own absence notes (review of 12ca17e)', () => {
    /* The reviewer's case: no public commit, one private day. The commit feed
       holds the private day; the merge and release feeds hold nothing and say
       only that, never a reason the record does not prove. */
    const lone = projectsCommitsProps([null, activityEnvelope([], [{ date: '2026-11-01', contributions: 3, repositories: 2 }])], now);
    assert.deepEqual(kinds(filterRows(lone.rows, 'commit')), ['private']);
    const notes = Object.fromEntries(lone.filters.map((filter) => [filter.key, filter.empty]));
    assert.equal(filterRows(lone.rows, 'merge').length, 0);
    assert.equal(notes.merge, 'no merge among the recent work');
    assert.equal(filterRows(lone.rows, 'release').length, 0);
    assert.equal(notes.release, 'no release among the recent work');
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
