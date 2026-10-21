/* THE CHRONICLE IS ONE TIMELINE (owner direction, 2026-10-16: "mix those two
 * things, the heat map of the commits and the token usage, as well as the
 * graphs"). The token board and the contribution calendar are drawn as one
 * diagram, and the one claim that makes that honest is that every series the
 * diagram draws lies on the same days — so one cursor can read all of them.
 * The adapter derives nothing of its own: it lays the calendar's sets and the
 * board's cards side by side, and this suite pins that it does exactly that. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  accountFactSlots,
  accountModelSlots,
  chroniclePanelIds,
  chronicleProps,
  commitsLabel,
  pullsLabel,
  tokensLabel,
  contributionsKey,
  gridTone,
  noReading,
  totalSeriesKey,
  windowName
} from '../src/lib/chronicle.ts';
import { measuredCell, pendingWeeks } from '../src/lib/grid.ts';
import { parseVCSActivity } from '../src/lib/activity.ts';
import { calendarPanelIds, contributionCalendarProps } from '../src/lib/commits.ts';
import { codingProjectsPanelId } from '../src/lib/projects.ts';
import { panelKinds } from '../src/lib/panels.ts';
import { knownSourceKeys, sourceName, tokenBoardProps, tokenUsagePanelId } from '../src/lib/token-usage.ts';

const sourceVocabulary = JSON.parse(
  await readFile(new URL('../../internal/panels/config/sources.json', import.meta.url), 'utf8')
);
const [first, second] = sourceVocabulary.sources;

const now = new Date('2026-08-10T12:00:00Z');

const usage = (sources) => ({
  schema: 'panel/v1',
  id: tokenUsagePanelId,
  kind: panelKinds.tokenUsage,
  title: 'Token usage',
  status: 'ok',
  generatedAt: '2026-08-10T00:00:00Z',
  data: { sources }
});

const lifetime = (value) => [{ key: 'lifetime', label: 'Lifetime', unit: 'tokens', value }];

const reporting = (label, startDate, totals, total) => ({
  label,
  windows: [],
  stats: lifetime(total),
  series: { startDate, totals }
});

test('nothing answered yet renders nothing, so the block waits like every panel block', () => {
  assert.equal(chronicleProps([null, null], now), null);
  assert.deepEqual(chroniclePanelIds, [...calendarPanelIds, codingProjectsPanelId], 'the calendar’s two panels in its order, then the projects');
  assert.equal(chronicleProps([null, null, null], now), null);
});

test('every series lies on the calendar’s own days, so one cursor reads them all', () => {
  const envelope = usage([
    reporting(first.key, '2026-08-01', [5, 0, 7], 1_000),
    reporting(second.key, '2026-08-02', [1, 2, 3, 4], 2_000)
  ]);
  const props = chronicleProps([null, envelope], now);
  const calendar = contributionCalendarProps([null, envelope], now);
  const reference = calendar.sets.find((set) => set.columns.length > 0);

  assert.ok(props);
  assert.equal(props.weeks, reference.columns.length);
  assert.equal(props.days.length, reference.columns.flat().length);
  for (const layer of props.layers) {
    assert.equal(layer.series.values.length, props.days.length, `${layer.key} is off the shared timeline`);
    assert.equal(layer.series.figures.length, props.days.length, `${layer.key} figures are off the shared timeline`);
    assert.equal(layer.readings.length, props.days.length, `${layer.key} readings are off the shared timeline`);
  }
  // The token layers are the token sets in the calendar's own order (the most
  // active first), each named by the vocabulary rather than by its wire key,
  // each in its own ink slot.
  const tokenSets = calendar.sets.filter((set) => set.key !== contributionsKey && set.columns.length > 0);
  assert.deepEqual(
    props.layers.map((layer) => layer.key),
    tokenSets.map((set) => set.key)
  );
  assert.deepEqual(
    props.layers.map((layer) => layer.label),
    tokenSets.map((set) => sourceName(set.key))
  );
  assert.deepEqual(
    props.layers.map((layer) => layer.tone),
    tokenSets.map((_, index) => String(index))
  );
});

/* WHAT IS PICKED IS WHAT IS PLOTTED (owner, 2026-10-16: "it makes no sense
 * that the graph doesn't change to show contributions when I pick
 * contributions"). Every layer carries its own day-by-day series and its own
 * words for each day; the contributions layer is drawn in the calendar's own
 * green. */
test('each layer plots its own series, in its own ink, and words each day', () => {
  const activity = {
    schema: 'panel/v1',
    id: 'vcs-activity',
    kind: 'vcs-activity/v1',
    title: 'GitHub',
    status: 'ok',
    generatedAt: '2026-08-06T00:00:00Z',
    data: { totalContributions: 3, weeks: [[0, 1, 0, 2, 0, 0, 0]], endDate: '2026-08-06', streak: 1, recentCommits: [] }
  };
  const envelope = usage([reporting(first.key, '2026-08-01', [5, 0, 7], 1_000)]);
  const props = chronicleProps([activity, envelope, null], new Date('2026-08-06T12:00:00Z'));
  assert.ok(props);
  const [contributions, tokens] = props.layers;
  assert.equal(contributions.key, contributionsKey, 'the diagram opens on the contributions');
  assert.equal(contributions.tone, gridTone);
  assert.equal(tokens.key, first.key);
  assert.equal(tokens.tone, '0');
  assert.notDeepEqual(contributions.series.values, tokens.series.values, 'two layers plot the same line');

  const at = (date) => props.days.findIndex((day) => day.date === date);
  // Monday Aug 3 made one contribution, Wednesday Aug 5 two, Tuesday none.
  assert.equal(contributions.series.values[at('2026-08-03')], 1);
  assert.equal(contributions.readings[at('2026-08-03')], '1 contribution');
  assert.equal(contributions.readings[at('2026-08-05')], '2 contributions');
  assert.equal(contributions.readings[at('2026-08-04')], '0 contributions', 'a measured quiet day reads as a zero');
  assert.equal(tokens.readings[at('2026-08-01')], '5 tokens');
  // A day the source never measured reads as the dash, never as a zero.
  const unmeasured = tokens.series.values.findIndex((value, index) => value === null && !props.days[index].absent);
  assert.ok(unmeasured >= 0);
  assert.equal(tokens.readings[unmeasured], noReading);
});

test('the headline total reads each day as the sum of what was measured, and a day nobody measured as a gap', () => {
  const envelope = usage([
    reporting(first.key, '2026-08-01', [5, 0, 7], 1_000),
    reporting(second.key, '2026-08-02', [1, 2, 3, 4], 2_000)
  ]);
  const props = chronicleProps([null, envelope], now);
  assert.ok(props);
  const tracked = props.headlines.find((headline) => headline.key === 'tracked');
  assert.ok(tracked);
  assert.equal(tracked.daily?.key, totalSeriesKey);
  for (let index = 0; index < props.days.length; index += 1) {
    const measured = props.layers.map((layer) => layer.series.values[index]).filter((value) => value !== null);
    const expected = measured.length === 0 ? null : measured.reduce((sum, value) => sum + value, 0);
    assert.equal(tracked.daily.values[index], expected, `day ${props.days[index].date}`);
    if (expected === null) {
      assert.equal(tracked.daily.figures[index], noReading);
    }
  }
  // Aug 1 only the first source measured; Aug 2 both did.
  const august = (date) => props.days.findIndex((day) => day.date === date);
  assert.equal(tracked.daily.values[august('2026-08-01')], 5);
  assert.equal(tracked.daily.values[august('2026-08-02')], 1);
  assert.equal(tracked.daily.values[august('2026-08-03')], 9);
});

test('the headlines and accounts are the board’s own cards, read and never rewritten', () => {
  const envelope = usage([
    reporting(first.key, '2026-08-01', [5, 0, 7], 1_000),
    reporting(second.key, '2026-08-02', [1, 2, 3, 4], 2_000)
  ]);
  const props = chronicleProps([null, envelope], now);
  const board = tokenBoardProps(envelope);
  assert.ok(props && board);
  const card = (key) => board.cards.find((entry) => entry.key === key);
  // THE THREE FIGURES (owner direction, 2026-10-16), in the owner's order.
  assert.deepEqual(
    props.headlines.map((headline) => headline.label),
    [pullsLabel, commitsLabel, tokensLabel]
  );
  const tokens = props.headlines.find((headline) => headline.key === 'tracked');
  assert.equal(tokens.figure, card('tracked').figure, 'the token figure is the board’s own');
  // With no projects and no activity panel, the other two print the dash.
  assert.equal(props.headlines.find((headline) => headline.key === 'pulls').figure, noReading);
  assert.equal(props.headlines.find((headline) => headline.key === 'commits').figure, noReading);
  // No activity panel: the calendar has no contributions to draw, so the
  // diagram offers no contributions layer.
  assert.equal(props.layers.some((layer) => layer.key === contributionsKey), false);
});

/* THE GRAPH IS THE WHOLE CALENDAR (owner, 2026-10-16: "make the graph
 * represent the entire heatmap not just a subsection"). The window runs to
 * today, and the figures' captions speak for that same window: what the token
 * line added across it, and the commits counted in it. */
test('the window ends today and the captions speak for the whole of it', () => {
  const envelope = usage([
    reporting(first.key, '2026-08-01', [5, 0, 7], 1_000),
    reporting(second.key, '2026-08-02', [1, 2, 3, 4], 2_000)
  ]);
  const props = chronicleProps([null, envelope], now);
  assert.ok(props);
  assert.equal(props.days[props.lastDay].date, '2026-08-10', 'the window ends today');
  assert.ok(props.days.slice(props.lastDay + 1).every((day) => day.absent), 'a day after today is in the window');
  // Every measured day across the window: 5+0+7 and 1+2+3+4.
  const tracked = props.headlines.find((headline) => headline.key === 'tracked');
  assert.equal(tracked.caption, `+22 ${windowName}`);
  assert.equal(props.headlines.find((headline) => headline.key === 'commits').caption, windowName);
  assert.equal(props.headlines.find((headline) => headline.key === 'pulls').caption, 'all time');
});

test('a day nobody measured is never drawn as a quiet day', () => {
  assert.deepEqual(measuredCell(null, 10), { measured: false, level: 0 });
  assert.deepEqual(measuredCell(undefined, 10), { measured: false, level: 0 });
  const quiet = measuredCell(0, 10);
  assert.equal(quiet.measured, true, 'a measured zero is a measured day');
  assert.equal(quiet.level, 0);
  assert.equal(measuredCell(10, 10).measured, true);
  assert.ok(measuredCell(10, 10).level > 0);

  // The stale-feed case this rule exists for: contributions measured only
  // until a month before today leave the days after it unmeasured — hollow on
  // the calendar — rather than reading as a quiet month.
  const activity = {
    schema: 'panel/v1',
    id: 'vcs-activity',
    kind: 'vcs-activity/v1',
    title: 'GitHub',
    status: 'stale',
    generatedAt: '2026-07-10T00:00:00Z',
    data: { totalContributions: 3, weeks: [[0, 1, 0, 2, 0, 0, 0]], endDate: '2026-07-10', streak: 1, recentCommits: [], coverage: 'complete' }
  };
  const props = chronicleProps([activity, null], now);
  assert.ok(props);
  const layer = props.layers.find((candidate) => candidate.key === contributionsKey);
  assert.ok(layer, 'the contributions layer is offered');
  const after = props.days
    .map((day, index) => ({ day, value: layer.series.values[index] }))
    .filter(({ day }) => !day.absent && day.date > '2026-07-10');
  assert.ok(after.length > 0, 'the window runs past the feed');
  for (const { day, value } of after) {
    assert.equal(measuredCell(value, 2).measured, false, `${day.date} reads as measured`);
  }
});

/* PULL REQUESTS CLOSED is every listed repository's closed pull requests,
 * summed; a repository that reports none adds nothing, and a payload that
 * reports none for any prints the dash. */
test('pull requests closed sums every repository that reports them', () => {
  const projects = (repos) => ({
    schema: 'panel/v1',
    id: codingProjectsPanelId,
    kind: panelKinds.codingProjects,
    title: 'Coding Projects',
    status: 'ok',
    generatedAt: '2026-08-10T00:00:00Z',
    data: { repos }
  });
  const repo = (name, closedPulls) => ({ name, description: '', stars: 0, pushedAt: '2026-08-01T00:00:00Z', ...(closedPulls === undefined ? {} : { closedPulls }) });
  const pulls = (repos) => chronicleProps([null, null, projects(repos)], now).headlines.find((headline) => headline.key === 'pulls');
  assert.equal(pulls([repo('a', 75), repo('b', 211), repo('c', 0)]).figure, '286');
  assert.equal(pulls([repo('a', 3), repo('b')]).figure, '3');
  assert.equal(pulls([repo('a'), repo('b')]).figure, noReading);
  assert.equal(pulls([repo('a', 3)]).daily, undefined, 'no per-day record, so the figure stays whole while scrubbing');
});

/* COMMITS PUSHED reads the activity panel's own daily commit counts — additive
 * inside vcs-activity/v1 — and the payload is refused when they do not add up. */
test('commits pushed reads the daily commit counts, which must add up', () => {
  const base = { totalContributions: 3, weeks: [[0, 1, 0, 2, 0, 0, 0]], endDate: '2026-08-06', streak: 1, recentCommits: [] };
  assert.equal(parseVCSActivity(base)?.totalCommits, undefined, 'a payload without them still parses');
  const good = parseVCSActivity({ ...base, commitWeeks: [[0, 2, 0, 1, 0, 0, 0]], totalCommits: 3 });
  assert.deepEqual(good?.commitWeeks, [[0, 2, 0, 1, 0, 0, 0]]);
  assert.equal(good?.totalCommits, 3);
  assert.equal(parseVCSActivity({ ...base, commitWeeks: [[0, 2, 0, 1, 0, 0, 0]], totalCommits: 4 }), null, 'a total that is not the sum');
  assert.equal(parseVCSActivity({ ...base, commitWeeks: [[0, 2, 0, 1, 0, 0]], totalCommits: 3 }), null, 'a short week');
  assert.equal(parseVCSActivity({ ...base, commitWeeks: [], totalCommits: 0 }), null, 'a different number of weeks');
  assert.equal(parseVCSActivity({ ...base, totalCommits: 3 }), null, 'a total without its days');

  const activity = {
    schema: 'panel/v1',
    id: 'vcs-activity',
    kind: 'vcs-activity/v1',
    title: 'GitHub',
    status: 'ok',
    generatedAt: '2026-08-06T00:00:00Z',
    data: { ...base, commitWeeks: [[0, 2, 0, 1, 0, 0, 0]], totalCommits: 3 }
  };
  const props = chronicleProps([activity, null, null], new Date('2026-08-06T12:00:00Z'));
  const commits = props.headlines.find((headline) => headline.key === 'commits');
  assert.equal(commits.figure, '3');
  const at = (date) => props.days.findIndex((day) => day.date === date);
  // Columns run Sunday to Saturday: Monday Aug 3 pushed 2, Wednesday Aug 5 pushed 1.
  assert.equal(commits.daily.values[at('2026-08-03')], 2);
  assert.equal(commits.daily.values[at('2026-08-05')], 1);
  assert.equal(commits.daily.values[at('2026-08-04')], 0, 'a measured quiet day is a zero, not a gap');
});

/* THE ACCOUNTS ARE ALIGNED (owner, 2026-10-16: "they must be aligned"): every
 * source's account carries the same terms in the same order wherever the
 * payload reports them for both. */
test('every account carries the same rows in the same order', () => {
  const stats = (extra) => [
    { key: 'lifetime', label: 'Lifetime', unit: 'tokens', value: 100 },
    { key: 'input', label: 'Input', unit: 'tokens', value: 10 },
    { key: 'output', label: 'Output', unit: 'tokens', value: 20 },
    { key: 'cache-read', label: 'Cache read', unit: 'tokens', value: 60 },
    { key: 'cache-write', label: 'Cache write', unit: 'tokens', value: 10 },
    { key: 'sessions', label: 'Sessions', unit: 'count', value: extra },
    { key: 'current-streak', label: 'Streak', unit: 'days', value: 2 },
    { key: 'longest-streak', label: 'Longest streak', unit: 'days', value: 9 },
    { key: 'longest-session', label: 'Longest session', unit: 'seconds', value: 3600 }
  ];
  const source = (label, sessions) => ({
    label,
    windows: [{ period: 'today', inputTokens: 1, outputTokens: 1 }],
    stats: stats(sessions),
    series: { startDate: '2026-08-01', totals: [1, 2, 3] }
  });
  const props = chronicleProps([null, usage([source(first.key, 4), source(second.key, 7)]), null], now);
  assert.ok(props);
  assert.equal(props.accounts.length, 2);
  const terms = props.accounts.map((account) => account.facts.map((fact) => fact.term));
  assert.deepEqual(terms[0], terms[1], 'the two accounts print different rows');
  assert.deepEqual(
    terms[0],
    ['cache read', 'cache write', 'today', 'sessions', 'streak', 'longest session'],
    'the account no longer reads its cache, its window and its records in that order'
  );
  /* The tome's leaf (owner, 2026-10-20: "remove 'itemised' insted just put
     cache write and cache read"): the input and output totals and the row
     saying how much of the lifetime they itemised are retired, and the
     longest streak rides the streak's own row. */
  for (const term of ['input', 'output', 'itemised', 'longest streak']) {
    assert.ok(!terms[0].includes(term), `the account still prints a ${term} row`);
  }
  const streak = props.accounts[0].facts.find((fact) => fact.term === 'streak').value;
  assert.match(streak, /, longest 9$/, 'the streak no longer carries the longest one beside it');
  // Each account prints its OWN sessions, not the first source's.
  const sessions = props.accounts.map((account) => account.facts.find((fact) => fact.term === 'sessions').value);
  assert.notEqual(sessions[0], sessions[1]);
});

/* A source that reports its figures but no daily line has nothing to plot,
 * and still keeps its account: the diagram's layers come from the lines, the
 * accounts from every source that reported (browser lanes, 2026-10-16). */
test('a source with no daily line keeps its account, after the ones with lines', () => {
  const stats = [
    { key: 'lifetime', label: 'Lifetime', unit: 'tokens', value: 100 },
    { key: 'input', label: 'Input', unit: 'tokens', value: 40 },
    { key: 'sessions', label: 'Sessions', unit: 'count', value: 3 }
  ];
  const lined = { label: first.key, windows: [], stats, series: { startDate: '2026-08-01', totals: [5, 0, 7] } };
  const lineless = { label: second.key, windows: [], stats };
  const props = chronicleProps([null, usage([lined, lineless]), null], now);
  assert.ok(props);
  assert.deepEqual(props.layers.map((layer) => layer.key), [first.key], 'a source with no line was offered a layer');
  assert.deepEqual(props.accounts.map((account) => account.key), [first.key, second.key]);
  assert.equal(props.accounts[1].label, sourceName(second.key));
});

/* WHAT IS COMING HOLDS ITS ROOM (AGENTS.md "Zero CLS"). With the calendar's
 * two panels still in flight, the diagram holds the year of weeks they will
 * fill and every source the vocabulary names holds its account's room, so the
 * board does not grow under the reader when they land; a panel that ANSWERED
 * with nothing holds nothing (owner ruling, 2026-08-24). */
test('payloads still in flight hold the room they will fill, and an empty answer holds none', () => {
  const projects = {
    schema: 'panel/v1',
    id: codingProjectsPanelId,
    kind: panelKinds.codingProjects,
    title: 'Coding Projects',
    status: 'ok',
    generatedAt: '2026-08-10T00:00:00Z',
    data: { repos: [] }
  };
  const waiting = chronicleProps([null, null, projects], now);
  assert.ok(waiting);
  assert.equal(waiting.days.length, 0, 'the waiting face drew days it was never given');
  assert.equal(waiting.weeks, pendingWeeks, 'the waiting face holds no year of weeks');
  assert.deepEqual(waiting.accounts.map((account) => account.key), knownSourceKeys);
  for (const account of waiting.accounts) {
    assert.equal(account.label, '', 'a pending account names a source before its payload said it reported');
    assert.equal(account.facts.length + account.models.length, 0);
    assert.equal(account.total, '', 'a pending account claims a lifetime before its payload said one');
  }
  assert.equal(waiting.factSlots, accountFactSlots);
  assert.equal(waiting.modelSlots, accountModelSlots);
  assert.equal(accountFactSlots, 7, 'two cache classes, two windows and three records');
  assert.equal(accountModelSlots, 5);

  // Arrived: real accounts only, and the same room around them.
  const arrived = chronicleProps([null, usage([reporting(first.key, '2026-08-01', [5, 0, 7], 1_000)]), projects], now);
  assert.ok(arrived.accounts.every((account) => account.label !== ''), 'a pending account outlived its payload');

  // Answered with nothing: no reserve.
  const unavailable = (id, kind) => ({ schema: 'panel/v1', id, kind, title: '', status: 'unavailable', generatedAt: '2026-08-10T00:00:00Z', data: null });
  const empty = chronicleProps([unavailable('vcs-activity', panelKinds.vcsActivity), unavailable(tokenUsagePanelId, panelKinds.tokenUsage), projects], now);
  assert.equal(empty.weeks, 0, 'panels that answered with nothing still hold a year open');
  assert.equal(empty.accounts.length, 0);
});

/* AN ACCOUNT OPENS ON ITS LIFETIME, IN ALL, and itemises only its cache
 * (owner, 2026-10-20). Two cache rows beside a lifetime claim no split of it,
 * so neither account implies a split of a lifetime it does not cover; a
 * source that reported no lifetime says so with the figure for no reading
 * rather than with a zero. */
test('each account opens on its lifetime and itemises only its cache', () => {
  const source = (label, lifetime, classes) => ({
    label,
    windows: [],
    stats: [
      ...(lifetime === null ? [] : [{ key: 'lifetime', label: 'Lifetime', unit: 'tokens', value: lifetime }]),
      ...Object.entries(classes).map(([key, value]) => ({ key, label: key, unit: 'tokens', value }))
    ],
    series: { startDate: '2026-08-01', totals: [1, 2, 3] }
  });
  const props = chronicleProps(
    [null, usage([
      source(first.key, 100_000_000, { input: 10_000_000, output: 20_000_000, 'cache-read': 60_000_000, 'cache-write': 10_000_000 }),
      source(second.key, null, { input: 5_000_000, output: 5_000_000, 'cache-read': 20_000_000, 'cache-write': 0 })
    ]), null],
    now
  );
  const [whole, partial] = props.accounts;
  assert.equal(whole.total, '100.0M', 'the lifetime is not the leaf\u2019s figure');
  assert.equal(partial.total, noReading, 'a lifetime nobody reported reads as a figure');
  const facts = (account) => Object.fromEntries(account.facts.map((fact) => [fact.term, fact.value]));
  assert.deepEqual(facts(whole), { 'cache read': '60.0M', 'cache write': '10.0M' });
  assert.deepEqual(facts(partial), { 'cache read': '20.0M', 'cache write': '0' });
});
