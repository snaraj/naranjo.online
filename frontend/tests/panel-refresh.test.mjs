/* Executes the live-refresh loop. Every timer, every fetch, and the page's
 * visibility state are injected through the PanelWatchHost seam, so these are
 * real behavioral tests of watchPanel — no browser, no wall clock, no
 * sleeping, and no nondeterminism. */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  panelEnvelopeSchema,
  panelRefreshIntervalMs,
  watchPanel
} from '../src/lib/panels.ts';

/* flush drains the microtask queue so an awaited fetch settles before the
 * assertion reads its effect. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function envelopeBody(id, generatedAt) {
  return {
    schema: panelEnvelopeSchema,
    id,
    kind: 'token-usage/v1',
    title: 'Token usage',
    generatedAt,
    status: 'ok',
    data: { sources: [] }
  };
}

/* fakeHost records every interaction and hands the loop a controllable timer,
 * transport, and visibility state. */
function fakeHost() {
  const host = {
    requests: [],
    scheduled: [],
    canceled: [],
    unsubscribes: 0,
    isHidden: false,
    visibleListener: null,
    respond: (url) => ({
      ok: true,
      json: async () => envelopeBody(url.split('/').at(-1), '2026-08-12T00:00:00Z')
    }),
    fetcher: async (url) => {
      host.requests.push(url);
      return host.respond(url);
    },
    schedule(callback, ms) {
      host.scheduled.push({ callback, ms });
      return host.scheduled.length - 1;
    },
    cancel(handle) {
      host.canceled.push(handle);
    },
    hidden: () => host.isHidden,
    onVisible(callback) {
      host.visibleListener = callback;
      return () => {
        host.unsubscribes += 1;
      };
    }
  };
  return host;
}

test('watchPanel reads once immediately and once per interval tick', async () => {
  const host = fakeHost();
  const seen = [];
  const stop = watchPanel('token-usage', (envelope) => seen.push(envelope.status), { host });
  await flush();
  assert.deepEqual(host.requests, ['/api/panels/token-usage'], 'the first read must not wait an interval');
  assert.deepEqual(seen, ['ok']);

  assert.equal(host.scheduled.length, 1, 'exactly one repeating timer per watched panel');
  assert.equal(host.scheduled[0].ms, panelRefreshIntervalMs, 'the default cadence must be the exported constant');

  host.scheduled[0].callback();
  await flush();
  host.scheduled[0].callback();
  await flush();
  assert.equal(host.requests.length, 3, 'each tick must produce one read');
  assert.deepEqual(seen, ['ok', 'ok', 'ok']);
  stop();
});

test('watchPanel leaves a hidden page alone and catches up when it returns', async () => {
  const host = fakeHost();
  const stop = watchPanel('token-usage', () => {}, { host });
  await flush();
  assert.equal(host.requests.length, 1);

  host.isHidden = true;
  host.scheduled[0].callback();
  host.scheduled[0].callback();
  await flush();
  assert.equal(host.requests.length, 1, 'a hidden page must produce no requests at all');

  // The catch-up read is fired with the page STILL reporting hidden, so the
  // only thing that can carry it past the hidden check is the force flag.
  // Letting the host go visible first would make this assertion pass even if
  // the catch-up were an ordinary unforced read — it would be testing the
  // interval's own condition, not the catch-up at all.
  host.visibleListener();
  await flush();
  assert.equal(
    host.requests.length,
    2,
    'the catch-up read must be forced past the hidden check, not merely permitted by it'
  );

  // And once the page is genuinely visible again the ordinary cadence
  // resumes, so the hidden branch releases rather than latching.
  host.isHidden = false;
  host.scheduled[0].callback();
  await flush();
  assert.equal(host.requests.length, 3, 'a visible page must resume its ordinary cadence');
  stop();
});

test('watchPanel starts even on a page that is hidden at mount', async () => {
  const host = fakeHost();
  host.isHidden = true;
  const seen = [];
  const stop = watchPanel('token-usage', (envelope) => seen.push(envelope.status), { host });
  await flush();
  assert.equal(host.requests.length, 1, 'the first read is forced: a hidden tab must still have data when shown');
  assert.deepEqual(seen, ['ok']);
  stop();
});

test('watchPanel never stacks requests behind a slow origin', async () => {
  const host = fakeHost();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  host.respond = () => pending.then(() => ({ ok: true, json: async () => envelopeBody('token-usage') }));
  const stop = watchPanel('token-usage', () => {}, { host });
  await flush();
  host.scheduled[0].callback();
  host.scheduled[0].callback();
  await flush();
  assert.equal(host.requests.length, 1, 'a read in flight must suppress the next tick');
  release();
  await flush();
  await flush();
  host.scheduled[0].callback();
  await flush();
  assert.equal(host.requests.length, 2, 'the loop must resume once the in-flight read settles');
  stop();
});

test('watchPanel stops for good: no delivery, no timer, no subscription', async () => {
  const host = fakeHost();
  const seen = [];
  const stop = watchPanel('token-usage', (envelope) => seen.push(envelope), { host });
  await flush();
  assert.equal(seen.length, 1);

  stop();
  assert.deepEqual(host.canceled, [0], 'the repeating timer must be cancelled');
  assert.equal(host.unsubscribes, 1, 'the visibility subscription must be released');

  host.scheduled[0].callback();
  host.visibleListener();
  await flush();
  assert.equal(host.requests.length, 1, 'a stopped watcher must issue no further reads');
  assert.equal(seen.length, 1, 'a stopped watcher must deliver nothing further');
});

test('watchPanel delivers nothing from a read that was in flight when it stopped', async () => {
  // The delivery-side guard, isolated. The scenario above stops the watcher
  // AFTER its read has settled, which a watcher missing the guard survives —
  // there is nothing left in flight to deliver. This one stops the watcher
  // WHILE a read is outstanding and only then lets it finish, which is the
  // real hazard: an unmounted component being written to by a request that
  // outlived it.
  const host = fakeHost();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  host.respond = () => pending.then(() => ({ ok: true, json: async () => envelopeBody('token-usage') }));

  const seen = [];
  const stop = watchPanel('token-usage', (envelope) => seen.push(envelope), { host });
  await flush();
  assert.equal(host.requests.length, 1, 'the read must be in flight before the watcher stops');
  assert.equal(seen.length, 0, 'nothing can have been delivered yet');

  stop();
  release();
  // Twice: once for the transport promise, once for the parse that follows.
  await flush();
  await flush();

  assert.deepEqual(seen, [], 'a stopped watcher must deliver nothing, even from a read it started');
});

test('watchPanel delivers an unavailable envelope when the read itself fails', async () => {
  const host = fakeHost();
  host.fetcher = async () => {
    host.requests.push('boom');
    throw new Error('network down');
  };
  const seen = [];
  const stop = watchPanel('token-usage', (envelope) => seen.push(envelope), { host });
  await flush();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].status, 'unavailable', 'a failed read renders honestly, never as stale success');

  // The in-flight guard must have been released, or the loop would be dead.
  host.scheduled[0].callback();
  await flush();
  assert.equal(host.requests.length, 2, 'a failed read must not wedge the loop');
  stop();
});

test('watchPanel refuses an unrenderable id without wedging the loop', async () => {
  const host = fakeHost();
  const seen = [];
  // panelUrl throws synchronously for a malformed id; the watcher must turn
  // that into the same honest unavailable envelope rather than an unhandled
  // rejection that leaves the panel blank forever.
  const stop = watchPanel('Token Usage', (envelope) => seen.push(envelope), { host });
  await flush();
  assert.equal(host.requests.length, 0, 'a malformed id must never reach the transport');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].status, 'unavailable');
  stop();
});

// watchPanel's forced-read contract (issue #78). No control calls refresh()
// today — the per-card and page-header refresh buttons both left at issue 179
// — but the watcher itself rides the same forced path on a visibility
// catch-up, and refresh() stays exported so a future caller joins the
// single-flight request instead of opening a second one. Every property that
// contract rests on is executed here rather than asserted about in source.
test('refresh() forces a read a hidden page would otherwise skip', async () => {
  const host = fakeHost();
  const seen = [];
  const watcher = watchPanel('token-usage', (envelope) => seen.push(envelope.status), { host });
  await flush();
  assert.equal(host.requests.length, 1);

  // Hidden page: the cadence produces nothing, and the forced read still must.
  host.isHidden = true;
  host.scheduled[0].callback();
  await flush();
  assert.equal(host.requests.length, 1, 'the cadence must stay quiet on a hidden page');

  await watcher.refresh();
  assert.equal(host.requests.length, 2, 'refresh() must be forced past the hidden check');
  assert.deepEqual(seen, ['ok', 'ok'], 'and must deliver what it read');
  watcher();
});

test('refresh() resolves only once the read it rode has settled', async () => {
  const host = fakeHost();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  host.respond = () => pending.then(() => ({ ok: true, json: async () => envelopeBody('token-usage') }));
  const watcher = watchPanel('token-usage', () => {}, { host });
  await flush();

  // The first read is still outstanding. Two more presses must JOIN it — one
  // request total — and none of the three promises may settle early, or the
  // control would stop spinning while the origin is still thinking.
  let settled = 0;
  const rides = [watcher.refresh(), watcher.refresh()].map((ride) => ride.then(() => (settled += 1)));
  await flush();
  assert.equal(host.requests.length, 1, 'a forced read must join the read in flight, never stack behind it');
  assert.equal(settled, 0, 'no ride may settle while its read is outstanding');

  release();
  await Promise.all(rides);
  assert.equal(settled, 2, 'every ride settles when the read it joined lands');

  // And the loop is not wedged: the next press is a fresh request.
  await watcher.refresh();
  assert.equal(host.requests.length, 2);
  watcher();
});

test('refresh() after stop() is inert, and a failed read still releases it', async () => {
  const stopped = fakeHost();
  const watcher = watchPanel('token-usage', () => {}, { host: stopped });
  await flush();
  watcher();
  await watcher.refresh();
  assert.equal(stopped.requests.length, 1, 'a stopped watcher must issue no forced read either');

  // A read that fails resolves like any other, so a control awaiting it can
  // never latch busy forever; the envelope it delivers is the honest one.
  const failing = fakeHost();
  failing.fetcher = async () => {
    failing.requests.push('boom');
    throw new Error('network down');
  };
  const seen = [];
  const live = watchPanel('token-usage', (envelope) => seen.push(envelope.status), { host: failing });
  await flush();
  await live.refresh();
  assert.equal(failing.requests.length, 2);
  assert.deepEqual(seen, ['unavailable', 'unavailable']);
  live();
});

test('the watcher is still the stop function every caller had before', async () => {
  const host = fakeHost();
  const watcher = watchPanel('token-usage', () => {}, { host });
  await flush();
  assert.equal(typeof watcher, 'function', 'the return value must stay directly callable');
  assert.equal(typeof watcher.refresh, 'function');
  // Svelte binds $effect cleanup to the returned value, so calling it must
  // still tear the loop down completely.
  watcher();
  assert.deepEqual(host.canceled, [0]);
  assert.equal(host.unsubscribes, 1);
});

test('the exported cadence stays inside its documented band', () => {
  // Fast enough that a visitor sees new data promptly, slow enough that a
  // long-open tab is not a load source. A change here is a conscious edit.
  assert.ok(
    panelRefreshIntervalMs >= 30_000 && panelRefreshIntervalMs <= 300_000,
    'the panel poll must stay between 30s and 5m'
  );
});

// refreshPanels and the liveWatchers set that backed it were the page-level
// "refresh all trackers" button's own mechanism and left with it (owner
// directive, issue 179): watchPanel's per-panel refresh() above is what
// survives, and it is already fully exercised on its own. A page-wide fan-out
// has no caller left to test.


/* THE PAGE SAYS WHETHER IT IS STILL WAITING (issue 210).
 *
 * A panel-bound block renders nothing until its envelope arrives, and two of
 * the three render a loading face and then replace it — so between mount and
 * arrival the document is genuinely mid-answer and had no way to say so. The
 * rendering lanes settle on this attribute; a lane that settled on a height
 * instead once snapshotted a page mid-arrival and blamed a reading-mode swap
 * for 1071px of panel growth.
 *
 * Executed against a document stub rather than pinned as source text, and the
 * module is loaded through a distinct specifier so it evaluates fresh — the
 * count is module state, and a second instance is the only way to observe it
 * from zero. */
test('the document states how many panels have not answered yet', async () => {
  const attributes = new Map();
  const priorDocument = globalThis.document;
  globalThis.document = {
    hidden: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    documentElement: {
      setAttribute: (name, value) => attributes.set(name, value)
    }
  };
  try {
    const fresh = await import('../src/lib/panels.ts?panels-pending-probe');
    const read = () => attributes.get(fresh.panelsPendingAttribute);
    // Stamped at module scope: absent and zero mean opposite things, and a
    // reader that saw nothing would call an unstarted page a finished one.
    assert.equal(read(), '0', 'the attribute is not stamped before any panel mounts');

    const host = fakeHost();
    const first = fresh.watchPanel('token-usage', () => {}, { host });
    assert.equal(read(), '1', 'a watched panel does not count as pending');
    const second = fresh.watchPanel('vcs-activity', () => {}, { host });
    assert.equal(read(), '2');
    await flush();
    assert.equal(read(), '0', 'the panels answered and the page still says it is waiting');

    // A refresh an hour later is not the page still loading. Counting it
    // would turn the attribute into "a request is open", which is a
    // different and much weaker claim.
    await first.refresh();
    await flush();
    assert.equal(read(), '0', 'a background refresh re-armed the first-load signal');

    first();
    second();
    assert.equal(read(), '0', 'stopping a settled panel moved the count');

    // A panel torn down before it ever answered is no longer something the
    // page is waiting for — and the exit must not double-count when the stop
    // races the delivery it was already owed.
    const slow = fakeHost();
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    slow.respond = () => held.then(() => ({ ok: true, json: async () => envelopeBody('osrs-stats') }));
    const third = fresh.watchPanel('osrs-stats', () => {}, { host: slow });
    await flush();
    assert.equal(read(), '1', 'a panel with a read still in flight is not pending');
    third();
    assert.equal(read(), '0', 'a panel stopped before answering left the page waiting forever');
    release();
    // Twice: once for the transport promise, once for the parse that follows.
    await flush();
    await flush();
    assert.equal(read(), '0', 'the delivery decremented a count its own stop had already released');
  } finally {
    if (priorDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = priorDocument;
    }
  }
});
