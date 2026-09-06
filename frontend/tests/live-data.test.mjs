/* The owner's live-data directive, frontend half (issue 242).
 *
 * Three claims are pinned here, each in both directions:
 *
 *   - The contribution figure says which coverage it is, because the two
 *     producers count different things and the number moves by hundreds
 *     between them.
 *   - The Coding Projects feed renders what the host says now, falls back to
 *     the captured rows when it cannot, and marks exactly the figures that
 *     came from the capture.
 *   - The block that feeds it is bound to the panel rather than to a frozen
 *     props object.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it, test } from 'node:test';

import { contributionsLabel, parseVCSActivity } from '../src/lib/activity.ts';
import { commitLogProps } from '../src/lib/commits.ts';
import {
  codingProjectsPanelId,
  projectHost,
  projectTableProps,
  parseCodingProjects,
  projectCounts,
  projects
} from '../src/lib/projects.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const noon = Date.parse('2026-08-28T12:00:00Z');

/* One well-formed envelope around a coding-projects payload, shaped exactly as
 * the block host delivers it. */
const projectsEnvelope = (repos, overrides = {}) => ({
  schema: 'panel/v1',
  id: codingProjectsPanelId,
  kind: 'coding-projects/v1',
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

describe('the contribution figure names its coverage', () => {
  it('words the narrower producer narrowly and the complete one plainly', () => {
    // The whole reason the field exists: an anonymous read reports only what
    // an anonymous reader may see, and serving that under one unlabelled
    // "contributions" would make the figure change meaning by hundreds the day
    // a credential is added or expires, with nothing on the page to say why.
    assert.equal(contributionsLabel('public'), ' public contributions');
    assert.equal(contributionsLabel('complete'), ' contributions');
    // Absent is the pre-field payload state — a replica mid-rollout — and
    // words the figure exactly as it always was.
    assert.equal(contributionsLabel(undefined), ' contributions');
  });

  it('carries the coverage from the payload into the rendered figure', () => {
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
    /* The wording rides the calendar's own caption now (owner directive,
       2026-09-03, issue 287): the commits section cycles three calendars and
       each states its own reading, so the coverage word is measured where the
       reader meets it rather than on a figures row one of the three owned. */
    const captionOf = (coverage) => commitLogProps([envelope(coverage), null]).sets[0].caption;
    assert.equal(captionOf('public'), '5 public contributions · 0-day streak');
    assert.equal(captionOf('complete'), '5 contributions · 0-day streak');
    assert.equal(captionOf(undefined), '5 contributions · 0-day streak');
    // ...and the builder itself is still the one place the two words differ.
    assert.equal(contributionsLabel('public'), ' public contributions');
    assert.equal(contributionsLabel('complete'), ' contributions');
  });

  it('refuses a coverage outside the closed vocabulary', () => {
    // Coverage decides rendered COPY, so it is admitted by MEMBERSHIP: free
    // text here would let a payload put arbitrary words beside the owner's
    // contribution total.
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
  it('renders the description the host carries right now', () => {
    // The commission, exactly: the owner edits a description on the host and
    // the site follows without a release.
    const props = projectTableProps(
      projectsEnvelope(projects.map((project) => liveRow(project.name))),
      noon
    );
    assert.equal(props.rows.length, Math.min(projects.length, 4));
    assert.equal(
      props.rows[0].summary,
      `${projects[0].name} as the host describes it now`,
      'the feed served the captured description while the panel carried a newer one'
    );
    // Identity stays the captured module's: a payload can never introduce a
    // repository the owner did not list, rename one, or move a link.
    /* Identity stays the roster's: a payload can never introduce a repository
       the owner did not list, rename one, or move a link. Every live row here
       carries the SAME pushedAt, so the order this table renders is the stable
       order the adapter produced from an unbroken tie — which is exactly what
       makes this a pin on identity rather than on ordering (ordering has its
       own pin, against distinct instants). */
    assert.equal(props.rows.length, 4);
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
    const counts = [props.rows[0].counts[0], props.rows[0].updated, ...props.rows[0].counts.slice(1)];
    assert.deepEqual(
      counts.map((count) => count.key),
      ['stars', 'updated', 'issues', 'pulls']
    );
    for (const count of counts) {
      assert.ok(!('marked' in count), `${count.key} carries a provenance mark`);
    }
  });

  it('falls back per row, serving the captured description for the row that fell back', () => {
    // The origin degrades per row — five repositories read and one refused is
    // five live rows beside one that says it is not — and the page has to
    // render that mixture legibly rather than flattening it.
    // A recorded row is the origin serving its shipped snapshot for that
    // repository, tallies included — so this fixture carries them, exactly as
    // the snapshot does.
    const rows = projects.map((project, index) =>
      index === 1
        ? { ...liveRow(project.name), recorded: true, openIssues: 3, openPulls: 1 }
        : liveRow(project.name)
    );
    const props = projectTableProps(projectsEnvelope(rows), noon);
    // Entries are looked up BY NAME rather than by position, because the feed
    // is ordered by push instant now (issue 252) and a recorded row is ordered
    // by its captured one — so position is a property of the data here, not an
    // index into the module list.
    const rowFor = (name) => props.rows.find((row) => row.key === name);
    for (const count of [rowFor(projects[1].name).counts, rowFor(projects[1].name).updated].flat()) {
      assert.ok(!('marked' in count), `${count.key} carries a provenance mark`);
    }
    assert.equal(
      rowFor(projects[1].name).summary,
      projects[1].description,
      'a recorded row served the payload description instead of the captured one'
    );
    // The live row beside it is exactly as unmarked, and serves the host's
    // description rather than the captured one.
    for (const count of [rowFor(projects[0].name).counts, rowFor(projects[0].name).updated].flat()) {
      assert.ok(!('marked' in count), `${count.key} carries a provenance mark`);
    }
    assert.notEqual(rowFor(projects[0].name).summary, projects[0].description);
  });

  it('renders a tally the host did not report as unknown, never as zero', () => {
    // The owner's 2026-08-28 ruling, applied to this feed: "if its either 0 or
    // unknown I rather it be Unknown".
    const unknown = projectCounts(
      { ...projects[0], commits: 1 },
      { name: projects[0].name, description: 'x', stars: null },
      noon
    );
    assert.equal(unknown[0].label, 'stars unknown');
    // A REPORTED zero is a measurement and stays a zero.
    const measured = projectCounts(
      { ...projects[0], commits: 1 },
      { name: projects[0].name, description: 'x', stars: 0 },
      noon
    );
    assert.equal(measured[0].label, '0 stars');
  });

  it('renders the captured rows for a null, wrong-kinded, or malformed envelope', () => {
    // The fallback is a TRUE thing to show — these figures were really read,
    // on the date the module records, and the page marks them — rather than a
    // placeholder pretending to be data. It is also why this block has no
    // loading face and reserves nothing.
    const capturedSummaries = projects
      .toSorted((left, right) => Date.parse(right.pushedAt) - Date.parse(left.pushedAt))
      .slice(0, 4)
      .map((project) => project.description);
    for (const envelope of [
      null,
      projectsEnvelope([], { kind: 'vcs-activity/v1' }),
      projectsEnvelope([], { data: { repos: [{ name: 'x', description: 5, stars: 1 }] } }),
      projectsEnvelope([], { data: null })
    ]) {
      const props = projectTableProps(envelope, noon);
      assert.deepEqual(
        props.rows.map((row) => row.summary),
        capturedSummaries
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
      { name: 'x', description: 'x', stars: 1, openIssues: null },
      { name: 'x', description: 'x', stars: 1, openPulls: null },
      { name: 'x', description: 'x', stars: 1, openIssues: -1 },
      { name: 'x', description: 'x', stars: 1, openPulls: -1 },
      { name: 'x', description: 'x', stars: 1, openIssues: 1.5 },
      { name: 'x', description: 'x', stars: 1, openPulls: '3' },
      { name: 'x', description: 'x', stars: 1, openIssues: Number.MAX_SAFE_INTEGER + 2 }
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
        repos: [{ name: 'x', description: '', stars: null, openIssues: 0, openPulls: 2 }]
      }),
      { repos: [{ name: 'x', description: '', stars: null, openIssues: 0, openPulls: 2 }] }
    );
  });
});

test('the Coding Projects block is bound to the panel, not to a frozen props object', async () => {
  // The structural half of the commission: a static binding cannot follow the
  // host however good the adapter is, so the binding itself is pinned.
  const binding = await read('../src/lib/blocks/codingProjects.ts');
  assert.match(binding, /panelBlock\(/);
  assert.doesNotMatch(binding, /staticBlock\(/);
  assert.match(binding, /codingProjectsPanelId/);
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
  const table = await read('../src/lib/components/LedgerTable.svelte');
  assert.match(table, /<DetailTip detail=\{count\.detail\} \/>/);
  const commits = projectCounts({ ...projects[0], commits: 1, stars: 1 }, undefined, noon).find(
    (count) => count.key === 'commits'
  );
  assert.equal(commits.detail.name, '1 commit');
  assert.deepEqual(commits.detail.rows, []);
});
