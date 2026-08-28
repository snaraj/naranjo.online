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
        ['updated', false]
      ]
    );
  });

  it('falls back per row, and marks every figure of a row that fell back', () => {
    // The origin degrades per row — five repositories read and one refused is
    // five live rows beside one that says it is not — and the page has to
    // render that mixture legibly rather than flattening it.
    const rows = projects.map((project, index) =>
      index === 1
        ? { ...liveRow(project.name), recorded: true }
        : liveRow(project.name)
    );
    const props = codingProjectsProps(projectsEnvelope(rows), noon);
    assert.deepEqual(
      props.entries[1].counts.map((count) => count.marked),
      [true, true, true],
      'a recorded row left a figure unmarked'
    );
    assert.equal(
      props.entries[1].summary,
      projects[1].description,
      'a recorded row served the payload description instead of the captured one'
    );
    assert.deepEqual(
      props.entries[0].counts.map((count) => count.marked),
      [true, false, false],
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
    const capturedSummaries = projects.map((project) => project.description);
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
      { name: 'x', description: 'x', stars: 1, recorded: 'yes' }
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

test('the entry log renders the provenance mark beside a figure, never instead of it', async () => {
  const entryLog = await read('../src/lib/components/EntryLog.svelte');
  // The mark is an addition to the label, so the figure and its word survive.
  // This used to pin the two as ADJACENT source text, which happened to also
  // pin the mark INSIDE the nowrap run — the arrangement the browser lanes
  // measured as a min-content regression on 0.1.56. The adjacency was never
  // the property worth having; that the unbreakable run holds the label and
  // NOTHING ELSE is, and this shape states it directly: the span closes on
  // the label, so no conditional can ever be nested inside it.
  assert.match(entryLog, /<span class="entry-count-text">\{count\.label\}<\/span>/);
  assert.match(entryLog, /\{#if count\.marked\}/);
  assert.match(entryLog, /· recorded/);
  // Worded identically to the usage panel's, so a reader learns one mark for
  // "recorded out of band" across the whole page rather than one per panel.
  const usage = await read('../src/lib/components/UsageTracker.svelte');
  // Whitespace-tolerant between the attribute and the text: the two files
  // are wrapped by the formatter at different columns, and where the closing
  // angle bracket lands is the formatter's business. The WORDING is the pin.
  const wording = /title="recorded out of band, not fetched live"\s*>·\s*recorded/;
  assert.match(entryLog, wording);
  assert.match(usage, wording);
});
