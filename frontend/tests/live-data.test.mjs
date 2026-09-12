/* The owner's live-data directive, frontend half (issue 242).
 *
 * Three claims are pinned here, each in both directions:
 *
 *   - The contribution payload declares which coverage it is, because the two
 *     producers count different things and the number moves by hundreds
 *     between them — admitted as a closed vocabulary, worded nowhere since the
 *     captions left (owner directive, 2026-09-12, issue 323).
 *   - The Coding Projects feed renders what the host says now, falls back to
 *     the captured rows when it cannot, and marks exactly the figures that
 *     came from the capture.
 *   - The block that feeds it is bound to the panel rather than to a frozen
 *     props object.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, it, test } from 'node:test';

import { activityPanelId, parseVCSActivity } from '../src/lib/activity.ts';
import { contributionCalendarProps, spreadPanelIds } from '../src/lib/commits.ts';
import {
  codingProjectsPanelId,
  projectHost,
  projectTableProps,
  parseCodingProjects,
  projectColumns,
  projects,
  shownProjectRows
} from '../src/lib/projects.ts';

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

describe('the Coding Projects feed follows the host', () => {
  it('renders the figures the host carries right now', () => {
    /* The commission, exactly: the owner's repositories change on the host and
       the site follows without a release. The DESCRIPTION is no longer one of
       the figures it follows with — the column left the table when the section
       became half a sheet (owner design decision, 2026-09-11, issue 318) — so
       the claim is read off a counter the table still draws. The origin serves
       the description either way; the page just has nowhere to print it. */
    const props = projectTableProps(
      projectsEnvelope(projects.map((project) => liveRow(project.name))),
      noon
    );
    assert.equal(props.rows.length, Math.min(projects.length, shownProjectRows));
    const starsOf = (row) => row.counts.find((count) => count.key === 'stars').value;
    assert.notEqual(
      String(projects[0].stars),
      '3',
      'the captured row already carries the payload figure, so this fixture proves nothing'
    );
    assert.equal(
      starsOf(props.rows[0]),
      '3',
      'the feed served the captured figure while the panel carried a newer one'
    );
    // Identity stays the captured module's: a payload can never introduce a
    // repository the owner did not list, rename one, or move a link.
    /* Identity stays the roster's: a payload can never introduce a repository
       the owner did not list, rename one, or move a link. Every live row here
       carries the SAME pushedAt, so the order this table renders is the stable
       order the adapter produced from an unbroken tie — which is exactly what
       makes this a pin on identity rather than on ordering (ordering has its
       own pin, against distinct instants). */
    assert.equal(props.rows.length, shownProjectRows);
    for (const row of props.rows) {
      assert.ok(
        projects.some((project) => project.name === row.link.text),
        `${row.link.text} is not a repository the roster lists`
      );
      assert.equal(row.link.href, `${projectHost}/${row.link.text}`);
    }
  });

  it('carries no provenance mark on any counter of a live row', () => {
    // The mark left with the provenance sentence (owner directive, 2026-09-06,
    // issue 299): a counter is its glyph, figure, words and detail, and no
    // field on it claims or denies freshness.
    const props = projectTableProps(
      projectsEnvelope(projects.map((project) => liveRow(project.name))),
      noon
    );
    const counts = [...props.rows[0].counts, props.rows[0].updated];
    // The owner's four columns, in the owner's order (2026-09-11, issue #317).
    assert.deepEqual(
      counts.map((count) => count.key),
      ['pulls', 'release', 'stars', 'updated']
    );
    assert.deepEqual(
      counts.map((count) => count.glyph),
      ['pull', 'tag', 'star', 'clock']
    );
    for (const count of counts) {
      assert.ok(!('marked' in count), `${count.key} carries a provenance mark`);
    }
  });

  it('falls back per row, serving the captured figures for the row that fell back', () => {
    // The origin degrades per row — five repositories read and one refused is
    // five live rows beside one that says it is not — and the page has to
    // render that mixture legibly rather than flattening it.
    // A recorded row is the origin serving its shipped snapshot for that
    // repository, tallies included — so this fixture carries them, exactly as
    // the snapshot does.
    /* The two rows this scenario reads are chosen by PUSH ORDER rather than by
       module index: the payload carries no `pinned` flag, so the table draws
       the most recent rows by push, and the captured list is written in a
       maintenance order on purpose — an index into it is not a row the table
       necessarily renders. */
    const byRecency = projects.toSorted(
      (left, right) => Date.parse(right.pushedAt) - Date.parse(left.pushedAt)
    );
    const [live, fellBack] = byRecency;
    /* The payload carries the rows the table actually draws. Every liveRow
       shares one push instant, so a wider roster would be ordered by the
       name tie-break and the two rows this scenario reads might not be drawn
       at all — a fixture whose own shape decides the assertion. */
    const rows = byRecency
      .slice(0, shownProjectRows)
      .map((project) =>
        project.name === fellBack.name
          ? { ...liveRow(project.name), recorded: true, closedPulls: 3, release: 'v1.0.0' }
          : liveRow(project.name)
      );
    const props = projectTableProps(projectsEnvelope(rows), noon);
    // Entries are looked up BY NAME rather than by position, because the feed
    // is ordered by push instant now (issue 252) and a recorded row is ordered
    // by its captured one — so position is a property of the data here, not an
    // index into the module list.
    const rowFor = (name) => props.rows.find((row) => row.key === name);
    const starsOf = (row) => row.counts.find((count) => count.key === 'stars').value;
    for (const count of [rowFor(fellBack.name).counts, rowFor(fellBack.name).updated].flat()) {
      assert.ok(!('marked' in count), `${count.key} carries a provenance mark`);
    }
    assert.notEqual(
      String(fellBack.stars),
      '3',
      'the captured row already carries the payload figure, so this fixture proves nothing'
    );
    assert.equal(
      starsOf(rowFor(fellBack.name)),
      String(fellBack.stars),
      'a recorded row served the payload figure instead of the captured one'
    );
    // The live row beside it is exactly as unmarked, and serves the host's
    // figures rather than the captured ones.
    for (const count of [rowFor(live.name).counts, rowFor(live.name).updated].flat()) {
      assert.ok(!('marked' in count), `${count.key} carries a provenance mark`);
    }
    assert.equal(starsOf(rowFor(live.name)), '3');
  });

  it('renders a tally the host did not report as unknown, never as zero', () => {
    // The owner's 2026-08-28 ruling, applied to this feed: "if its either 0 or
    // unknown I rather it be Unknown".
    const unknown = projectColumns(
      projects[0],
      { name: projects[0].name, description: 'x', stars: null },
      noon
    ).counts.find((count) => count.key === 'stars');
    assert.equal(unknown.label, 'stars unknown');
    // A REPORTED zero is a measurement and stays a zero.
    const measured = projectColumns(
      projects[0],
      { name: projects[0].name, description: 'x', stars: 0 },
      noon
    ).counts.find((count) => count.key === 'stars');
    assert.equal(measured.label, '0 stars');
    // The same ruling over the two figures issue #317 added: a version nobody
    // released and a tally nobody read are both dashes, never a zero and never
    // an invented version.
    const absent = projectColumns(
      projects[0],
      { name: projects[0].name, description: 'x', stars: 1 },
      noon
    ).counts;
    assert.equal(absent.find((count) => count.key === 'release').value, '—');
    assert.equal(absent.find((count) => count.key === 'pulls').value, '—');
    const reported = projectColumns(
      projects[0],
      { name: projects[0].name, description: 'x', stars: 1, closedPulls: 0, release: 'v1.2.3' },
      noon
    ).counts;
    assert.equal(reported.find((count) => count.key === 'pulls').value, '0');
    assert.equal(reported.find((count) => count.key === 'pulls').label, '0 closed pull requests');
    assert.equal(reported.find((count) => count.key === 'release').value, 'v1.2.3');
  });

  it('renders the captured rows for a null, wrong-kinded, or malformed envelope', () => {
    // The fallback is a TRUE thing to show — these figures were really read,
    // on the date the module records, and the page marks them — rather than a
    // placeholder pretending to be data. It is also why this block has no
    // loading face and reserves nothing.
    const capturedRoster = projects
      .toSorted((left, right) => Date.parse(right.pushedAt) - Date.parse(left.pushedAt))
      .slice(0, shownProjectRows)
      .map((project) => project.name);
    for (const envelope of [
      null,
      projectsEnvelope([], { kind: 'vcs-activity/v1' }),
      projectsEnvelope([], { data: { repos: [{ name: 'x', description: 5, stars: 1 }] } }),
      projectsEnvelope([], { data: null })
    ]) {
      const props = projectTableProps(envelope, noon);
      assert.deepEqual(
        props.rows.map((row) => row.link.text),
        capturedRoster
      );
      /* And NO chip: a captured face carries no `pinned` flag, so there is no
         pinned set for a "latest" row to be latest beside, and saying one row
         is the newest of a set nobody selected would be a claim this face
         cannot support. */
      assert.deepEqual(
        props.rows.filter((row) => row.chip !== undefined),
        []
      );
      for (const entry of props.rows) {
        for (const count of [...entry.counts, entry.updated]) {
          // The two open-work counters have no captured figure at all and
          // render as a dash; no counter carries a provenance mark either way
          // (owner directive, 2026-09-06, issue 299).
          assert.ok(!('marked' in count), `${entry.key}/${count.key} carries a provenance mark`);
        }
      }
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
  });
});

test('the Projects · Commits block is bound to its panels, not to a frozen props object', async () => {
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
  // The table still renders each counter's detail through the one hover-detail
  // primitive; the detail names the phrase and carries no provenance row.
  const table = await read('../src/lib/components/LedgerSpread.svelte');
  assert.match(table, /<DetailTip detail=\{count\.detail\} \/>/);
  const stars = projectColumns({ ...projects[0], stars: 1 }, undefined, noon).counts.find(
    (count) => count.key === 'stars'
  );
  assert.equal(stars.detail.name, '1 star');
  assert.deepEqual(stars.detail.rows, []);
});
