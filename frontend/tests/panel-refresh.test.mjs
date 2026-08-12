/* Executes the live-refresh loop. Every timer, every fetch, and the page's
 * visibility state are injected through the PanelWatchHost seam, so these are
 * real behavioral tests of watchPanel and watchClock — no browser, no wall
 * clock, no sleeping, and no nondeterminism. */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  panelClockIntervalMs,
  panelEnvelopeSchema,
  panelRefreshIntervalMs,
  watchClock,
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

test('watchClock ticks a fresh instant on the exported cadence and stops cleanly', () => {
  const host = fakeHost();
  const ticks = [];
  const stop = watchClock((now) => ticks.push(now), { host });
  assert.equal(host.scheduled[0].ms, panelClockIntervalMs);

  host.scheduled[0].callback();
  host.scheduled[0].callback();
  assert.equal(ticks.length, 2);
  for (const tick of ticks) {
    assert.ok(tick instanceof Date && !Number.isNaN(tick.getTime()), 'each tick must carry a usable instant');
  }

  stop();
  host.scheduled[0].callback();
  assert.equal(ticks.length, 2, 'a stopped clock must deliver nothing further');
  assert.deepEqual(host.canceled, [0]);
});

test('the exported cadences stay inside their documented bands', () => {
  // Fast enough that a visitor sees new data promptly, slow enough that a
  // long-open tab is not a load source. A change here is a conscious edit.
  assert.ok(
    panelRefreshIntervalMs >= 30_000 && panelRefreshIntervalMs <= 300_000,
    'the panel poll must stay between 30s and 5m'
  );
  assert.ok(
    panelClockIntervalMs >= 10_000 && panelClockIntervalMs <= panelRefreshIntervalMs,
    'the freshness clock must tick at least as often as the panel poll'
  );
});
