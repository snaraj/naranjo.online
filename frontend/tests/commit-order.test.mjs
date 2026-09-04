/* THE CALENDAR OPENS ON THE LEAD TOKEN SERIES (owner directive, 2026-09-04,
 * issue 294: "Codex has the most activity"). The component draws sets[0]
 * until a reader presses a segment, so the ORDER the adapter returns is the
 * default view — pinned here as an order, with the lead named once in the
 * adapter and read from it rather than retyped. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commitLogProps, leadTokenSource } from '../src/lib/commits.ts';
import { panelKinds } from '../src/lib/panels.ts';
import { tokenUsagePanelId } from '../src/lib/token-usage.ts';

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

test('the lead token set goes first, the other token sets follow in payload order, contributions last', () => {
  assert.equal(leadTokenSource, 'codex');
  const keys = (payload) => commitLogProps([null, usage(payload)]).sets.map((set) => set.key);

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
  // A third reporting source slots after the lead in payload order.
  assert.deepEqual(
    keys([reporting('anthropic', [1]), reporting('other', [2]), reporting('codex', [3])]),
    ['codex', 'anthropic', 'other', 'contributions']
  );
  // A payload that stops reporting the lead opens on whatever set comes
  // first — no empty segment is held open for it (owner ruling, 2026-08-24).
  assert.deepEqual(keys([reporting('anthropic', [1, 2])]), ['anthropic', 'contributions']);
  assert.deepEqual(keys([{ label: 'codex', windows: [] }, reporting('anthropic', [1])]), [
    'anthropic',
    'contributions'
  ]);
  // No usage envelope at all: the contributions calendar alone, as before.
  assert.deepEqual(commitLogProps([null, null]).sets.map((set) => set.key), ['contributions']);
});

test('the lead is the first segment the component draws, and no panel label sits over it', () => {
  const props = commitLogProps([null, usage([reporting('anthropic', [1]), reporting('codex', [2])])]);
  assert.equal(props.sets[0].label, 'Tokens · codex');
  assert.equal(props.sets.at(-1).label, 'Contributions');
  assert.equal(props.title, undefined, 'the commit block hands the shell a title again');
});
