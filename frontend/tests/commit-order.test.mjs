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
