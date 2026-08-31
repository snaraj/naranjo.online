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

import { contributionsLabel, parseVCSActivity, vcsActivityProps } from '../src/lib/activity.ts';
import { recordedOutOfBand } from '../src/lib/blocks.ts';
import {
  codingProjectsPanelId,
  codingProjectsProps,
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
    const restOf = (coverage) =>
      vcsActivityProps(envelope(coverage)).figures.find((figure) => figure.key === 'total').rest;
    assert.equal(restOf('public'), ' public contributions');
    assert.equal(restOf('complete'), ' contributions');
    assert.equal(restOf(undefined), ' contributions');
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
    const props = codingProjectsProps(
      projectsEnvelope(projects.map((project) => liveRow(project.name))),
      noon
    );
    assert.equal(props.entries.length, projects.length);
    assert.equal(
      props.entries[0].summary,
      `${projects[0].name} as the host describes it now`,
      'the feed served the captured description while the panel carried a newer one'
    );
    // Identity stays the captured module's: a payload can never introduce a
    // repository the owner did not list, rename one, or move a link.
    assert.deepEqual(
      props.entries.map((entry) => entry.title),
      projects.map((project) => project.name)
    );
  });

  it('marks the commit count as recorded however fresh the row is', () => {
    // No repository API reports a commit total, so the count is captured no
    // matter what — and the page says so rather than letting it pass as live.
    const props = codingProjectsProps(
      projectsEnvelope(projects.map((project) => liveRow(project.name))),
      noon
    );
    const counts = props.entries[0].counts;
    assert.deepEqual(
      counts.map((count) => [count.key, count.marked]),
      [
        ['commits', true],
        ['stars', false],
        ['updated', false],
        // These fixture rows carry no tallies, which is the ADDITIVE path: the
        // exact shape a payload written before the two counters existed still
        // has. A figure that is not there renders as a dash, and a dash has no
        // provenance to mark.
        ['issues', undefined],
        ['pulls', undefined]
      ]
    );
  });

  it('falls back per row, and marks every figure of a row that fell back', () => {
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
    const props = codingProjectsProps(projectsEnvelope(rows), noon);
    // Entries are looked up BY NAME rather than by position, because the feed
    // is ordered by push instant now (issue 252) and a recorded row is ordered
    // by its captured one — so position is a property of the data here, not an
    // index into the module list.
    const entryFor = (name) => props.entries.find((entry) => entry.key === name);
    assert.deepEqual(
      entryFor(projects[1].name).counts.map((count) => count.marked),
      [true, true, true, true, true],
      'a recorded row left a figure unmarked'
    );
    assert.equal(
      entryFor(projects[1].name).summary,
      projects[1].description,
      'a recorded row served the payload description instead of the captured one'
    );
    assert.deepEqual(
      entryFor(projects[0].name).counts.map((count) => count.marked),
      [true, false, false, undefined, undefined],
      'a live row inherited the recorded row’s marks'
    );
  });

  it('renders a tally the host did not report as unknown, never as zero', () => {
    // The owner's 2026-08-28 ruling, applied to this feed: "if its either 0 or
    // unknown I rather it be Unknown".
    const unknown = projectCounts(
      { ...projects[0], commits: 1 },
      { name: projects[0].name, description: 'x', stars: null },
      noon
    );
    assert.equal(unknown[1].label, 'stars unknown');
    // A REPORTED zero is a measurement and stays a zero.
    const measured = projectCounts(
      { ...projects[0], commits: 1 },
      { name: projects[0].name, description: 'x', stars: 0 },
      noon
    );
    assert.equal(measured[1].label, '0 stars');
  });

  it('renders the captured rows for a null, wrong-kinded, or malformed envelope', () => {
    // The fallback is a TRUE thing to show — these figures were really read,
    // on the date the module records, and the page marks them — rather than a
    // placeholder pretending to be data. It is also why this block has no
    // loading face and reserves nothing.
    const capturedSummaries = projects
      .toSorted((left, right) => Date.parse(right.pushedAt) - Date.parse(left.pushedAt))
      .map((project) => project.description);
    for (const envelope of [
      null,
      projectsEnvelope([], { kind: 'vcs-activity/v1' }),
      projectsEnvelope([], { data: { repos: [{ name: 'x', description: 5, stars: 1 }] } }),
      projectsEnvelope([], { data: null })
    ]) {
      const props = codingProjectsProps(envelope, noon);
      assert.deepEqual(
        props.entries.map((entry) => entry.summary),
        capturedSummaries
      );
      for (const entry of props.entries) {
        for (const count of entry.counts) {
          // A captured figure is marked; the two open-work counters have no
          // captured figure at all and render as an unmarked dash, which is
          // the same honesty by a different route.
          if (count.value === '—') {
            assert.equal(count.marked, undefined, `${entry.key}/${count.key} marked a figure it does not have`);
            continue;
          }
          assert.equal(count.marked, true, `${entry.key}/${count.key} claimed freshness it does not have`);
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

test('one wording says a figure was recorded out of band, wherever it appears', async () => {
  /* THE CLAIM SURVIVES THE MOVE (issue 268). The entry log's half of it used
     to be an inline italic mark on every counter, and this test pinned the two
     components' source text against each other so the page could not grow two
     vocabularies for one idea. The owner removed the visible mark from the
     repo rows — "stale, static and ugly" — and provenance moved into the
     counter's detail, so the two halves are no longer the same MARKUP and
     pinning them as such would pin the arrangement rather than the property.

     What is worth having is the claim it always was: a reader learns one
     sentence for "this was recorded out of band" across the whole page. It is
     pinned here as one exported CONSTANT plus the surviving literal — the
     usage tiles' visible suffix, verbatim and unchanged — proved to be that
     same string, and the entry log's half proved to reach the reader through
     the constant rather than through a copy of it. */
  const entryLog = await read('../src/lib/components/EntryLog.svelte');
  const usage = await read('../src/lib/components/UsageTracker.svelte');
  // The usage panel's half: unchanged, still the visible suffix beside a tile.
  // Whitespace-tolerant between the attribute and the text — where the closing
  // angle bracket lands is the formatter's business. The WORDING is the pin.
  assert.match(usage, /title="recorded out of band, not fetched live"\s*>·\s*recorded/);
  // And it is the one constant, spelled once, that the literal above matches.
  assert.equal(recordedOutOfBand, 'recorded out of band, not fetched live');
  assert.ok(
    usage.includes(recordedOutOfBand),
    'the usage panel spells a provenance wording the shared constant does not carry'
  );
  // The entry log's half is DATA now: the mark, its class and its browser
  // tooltip are gone from the component, and the wording reaches the reader
  // through the counter's detail instead.
  assert.doesNotMatch(entryLog, /entry-recorded/);
  assert.doesNotMatch(entryLog, /title="recorded out of band/);
  const commits = projectCounts({ ...projects[0], commits: 1, stars: 1 }, undefined, noon).find(
    (count) => count.key === 'commits'
  );
  assert.deepEqual(commits.detail.rows, [{ label: '', value: recordedOutOfBand }]);
});
