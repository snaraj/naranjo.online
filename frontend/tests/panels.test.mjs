import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  loadPanel,
  loadPanelIndex,
  panelAge,
  panelEnvelopeSchema,
  panelKinds,
  panelUrl,
  panelsIndexUrl,
  parsePanelEnvelope,
  parsePanelIndex,
  unavailablePanel
} from '../src/lib/panels.ts';

// A well-formed envelope in the exact shape internal/panels serves; tests
// clone and break one field at a time so every admission rule is exercised.
const goodEnvelope = {
  schema: 'panel/v1',
  id: 'boss-log',
  kind: 'boss-log/v1',
  title: 'Boss Log',
  generatedAt: '2026-08-10T21:15:00Z',
  status: 'stale',
  data: { account: 'fixture', bosses: [] }
};

const jsonResponse = (body, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('panel URLs', () => {
  it('builds only the two same-origin API shapes', () => {
    assert.equal(panelsIndexUrl, '/api/panels');
    assert.equal(panelUrl('boss-log'), '/api/panels/boss-log');
  });

  it('rejects ids the origin could only 404', () => {
    for (const id of ['', 'Boss-Log', 'boss log', 'boss/log', '../etc', '-lead', 'a.b']) {
      assert.throws(() => panelUrl(id), /lowercase hyphenated identifier/);
    }
  });

  it('pins the versioned kind names against the Go registry', () => {
    assert.deepEqual(panelKinds, {
      tokenUsage: 'token-usage/v1',
      vcsActivity: 'vcs-activity/v1',
      bossLog: 'boss-log/v1'
    });
  });
});

describe('parsePanelEnvelope', () => {
  it('admits the exact served contract, generatedAt included', () => {
    const envelope = parsePanelEnvelope(goodEnvelope);
    assert.equal(envelope.schema, panelEnvelopeSchema);
    assert.equal(envelope.id, 'boss-log');
    assert.equal(envelope.kind, 'boss-log/v1');
    assert.equal(envelope.status, 'stale');
    assert.equal(envelope.generatedAt, '2026-08-10T21:15:00Z');
    assert.deepEqual(envelope.data, { account: 'fixture', bosses: [] });
  });

  it('keeps null data as data, the unavailable shape', () => {
    const envelope = parsePanelEnvelope({
      ...goodEnvelope,
      status: 'unavailable',
      data: null
    });
    assert.equal(envelope.status, 'unavailable');
    assert.equal(envelope.data, null);
  });

  it('refuses every off-contract document', () => {
    const broken = [
      null,
      [],
      'panel',
      { ...goodEnvelope, schema: 'panel/v2' },
      { ...goodEnvelope, id: '' },
      { ...goodEnvelope, kind: 7 },
      { ...goodEnvelope, title: undefined },
      { ...goodEnvelope, status: 'fresh' },
      { ...goodEnvelope, generatedAt: 12 },
      (() => {
        const { data: _dropped, ...rest } = goodEnvelope;
        return rest;
      })()
    ];
    for (const document of broken) {
      assert.throws(() => parsePanelEnvelope(document));
    }
  });
});

describe('parsePanelIndex', () => {
  it('admits the registry listing and refuses drift', () => {
    const index = parsePanelIndex({
      panels: [{ id: 'boss-log', kind: 'boss-log/v1', title: 'Boss Log', status: 'ok' }]
    });
    assert.equal(index.panels.length, 1);
    assert.equal(index.panels[0].id, 'boss-log');
    for (const document of [null, {}, { panels: [{}] }, { panels: [{ id: 'x' }] }]) {
      assert.throws(() => parsePanelIndex(document));
    }
  });
});

describe('loadPanel', () => {
  it('performs exactly one request against the panel URL', async () => {
    const requested = [];
    const envelope = await loadPanel('boss-log', (url) => {
      requested.push(url);
      return jsonResponse(goodEnvelope);
    });
    assert.deepEqual(requested, ['/api/panels/boss-log']);
    assert.equal(envelope.status, 'stale');
  });

  it('degrades to an unavailable envelope on transport, status, or shape faults', async () => {
    const faults = [
      () => Promise.reject(new Error('offline')),
      () => jsonResponse({}, 500),
      () => jsonResponse({ wrong: 'shape' }),
      () => Promise.resolve(new Response('not json', { status: 200 }))
    ];
    for (const fetcher of faults) {
      const envelope = await loadPanel('boss-log', fetcher);
      assert.deepEqual(envelope, unavailablePanel('boss-log'));
      assert.equal(envelope.status, 'unavailable');
      assert.equal(envelope.data, null);
    }
  });

  it('never retries a failing fetch', async () => {
    let calls = 0;
    await loadPanel('boss-log', () => {
      calls += 1;
      return Promise.reject(new Error('offline'));
    });
    assert.equal(calls, 1);
  });

  // "A data-retrieval failure logs an error … it is not an expected state a
  // visitor manages with a manual refresh control" (owner directive, issue
  // 179, which retired that control). Executed against a captured
  // console.error rather than trusted from the shape of the catch block.
  it('logs an error for every fault, and stays silent on a real read (issue 179)', async () => {
    const faults = [
      () => Promise.reject(new Error('offline')),
      () => jsonResponse({}, 500),
      () => jsonResponse({ wrong: 'shape' })
    ];
    const originalError = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args);
    try {
      for (const fetcher of faults) {
        await loadPanel('boss-log', fetcher);
      }
      assert.equal(logged.length, faults.length, 'every fault must be logged, not swallowed');
      for (const [message] of logged) {
        assert.match(String(message), /"boss-log"/, 'the logged message must name the panel that failed');
      }

      logged.length = 0;
      await loadPanel('boss-log', () => jsonResponse(goodEnvelope));
      assert.deepEqual(logged, [], 'a successful read must log nothing at all');
    } finally {
      console.error = originalError;
    }
  });
});

describe('loadPanelIndex', () => {
  it('returns the listing on success and an empty listing on any fault', async () => {
    const index = await loadPanelIndex(() =>
      jsonResponse({ panels: [{ id: 'boss-log', kind: 'boss-log/v1', title: 'Boss Log', status: 'ok' }] })
    );
    assert.equal(index.panels.length, 1);
    for (const fetcher of [() => Promise.reject(new Error('offline')), () => jsonResponse({}, 503)]) {
      assert.deepEqual(await loadPanelIndex(fetcher), { panels: [] });
    }
  });
});

describe('panelAge', () => {
  const now = new Date('2026-08-11T12:00:00Z');

  it('renders coarse honest ages for the badge', () => {
    assert.equal(panelAge('2026-08-11T11:59:30Z', now), 'just now');
    assert.equal(panelAge('2026-08-11T11:15:00Z', now), '45m ago');
    assert.equal(panelAge('2026-08-10T21:15:00Z', now), '14h ago');
    assert.equal(panelAge('2026-08-01T12:00:00Z', now), '10d ago');
  });

  it('renders nothing for absent, malformed, or future instants', () => {
    assert.equal(panelAge(undefined, now), '');
    assert.equal(panelAge('', now), '');
    assert.equal(panelAge('yesterday-ish', now), '');
    assert.equal(panelAge('2026-08-12T12:00:00Z', now), '');
  });
});
