/* The live-age formatter (owner directive, issue 268).
 *
 * Every band is executed against a FIXED clock rather than asserted around a
 * moving one, and every boundary is checked from both sides, because a band
 * table is exactly the kind of code that is right for the case somebody tried
 * and wrong one second either side of it. The four phrases the retired
 * `updatedLabel` produced are ported verbatim below, so the day/month/year
 * half of what the Coding Projects cards said is provably unchanged and only
 * the sub-day half — which used to flatten to "updated today" — is new.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  absoluteInstant,
  ageDetail,
  msUntilNextMinute,
  relativeAge,
  unknownAge,
} from '../src/lib/age.ts';
import { recordedOutOfBand } from '../src/lib/blocks.ts';

const noon = Date.parse('2026-08-27T12:00:00Z');
const at = (iso) => relativeAge(iso, noon);

test('every band renders its own compact figure and its own sentence', () => {
  // Under a minute is the one band with no number to show, and it says so in
  // words rather than rounding to "0 minutes ago" — a phrase that reads as a
  // measurement nobody made.
  assert.deepEqual(at('2026-08-27T12:00:00Z'), {
    compact: '0m',
    phrase: 'updated less than a minute ago',
  });
  assert.deepEqual(at('2026-08-27T11:59:01Z'), {
    compact: '0m',
    phrase: 'updated less than a minute ago',
  });
  assert.deepEqual(at('2026-08-27T11:18:00Z'), {
    compact: '42m',
    phrase: 'updated 42 minutes ago',
  });
  assert.deepEqual(at('2026-08-27T09:00:00Z'), { compact: '3h', phrase: 'updated 3 hours ago' });
  assert.deepEqual(at('2026-08-03T12:00:00Z'), { compact: '24d', phrase: 'updated 24 days ago' });
  assert.deepEqual(at('2026-02-27T12:00:00Z'), { compact: '6mo', phrase: 'updated 6 months ago' });
  assert.deepEqual(at('2023-08-27T12:00:00Z'), { compact: '3y', phrase: 'updated 3 years ago' });
});

test('every boundary is exact, from both sides', () => {
  // A band table is only as good as its edges: each pair below straddles one,
  // so an off-by-one in either direction turns exactly one of them red.
  assert.equal(at('2026-08-27T11:59:00Z').compact, '1m', '60s must be a minute, not "0m"');
  assert.equal(at('2026-08-27T11:59:00.001Z').compact, '0m', 'a shade under 60s is still "0m"');
  assert.equal(at('2026-08-27T11:01:00Z').compact, '59m');
  assert.equal(at('2026-08-27T11:00:00Z').compact, '1h', '60 minutes must be an hour');
  assert.equal(at('2026-08-26T12:00:01Z').compact, '23h');
  assert.equal(at('2026-08-26T12:00:00Z').compact, '1d', '24 hours must be a day');
  assert.equal(at('2026-07-29T12:00:00Z').compact, '29d');
  assert.equal(at('2026-07-28T12:00:00Z').compact, '1mo', '30 days must be a month');
  assert.equal(at('2025-08-28T12:00:00Z').compact, '12mo');
  assert.equal(at('2025-08-27T12:00:00Z').compact, '1y', '365 days must be a year');
  // Coarse ABOVE a day is the point: a two-year-old repository says "2y", and
  // never the 730d a day-only table would have produced.
  assert.equal(at('2024-08-27T12:00:00Z').compact, '2y');
});

test('a count of one is a count of one thing, in every band that counts', () => {
  // "1 minutes ago" is the small lie a page tells when nobody reads its
  // sentences out loud, and this formatter has five chances to tell it.
  assert.equal(at('2026-08-27T11:59:00Z').phrase, 'updated 1 minute ago');
  assert.equal(at('2026-08-27T11:00:00Z').phrase, 'updated 1 hour ago');
  assert.equal(at('2026-08-26T12:00:00Z').phrase, 'updated 1 day ago');
  assert.equal(at('2026-07-28T12:00:00Z').phrase, 'updated 1 month ago');
  assert.equal(at('2025-08-27T12:00:00Z').phrase, 'updated 1 year ago');
});

test('the phrases the retired updatedLabel produced are unchanged', () => {
  /* Ported verbatim from tests/sections.test.mjs's band walk, which went with
     `updatedLabel` (lib/projects.ts). Everything from a day upward reads
     exactly as it did, so the Coding Projects cards say the same thing about
     the same push instants; the only case that MOVED is the one that used to
     flatten every sub-day age to "updated today", which is the flattening the
     owner asked to replace with a real clock. */
  assert.equal(at('2026-08-26T02:00:00Z').phrase, 'updated 1 day ago');
  assert.equal(at('2026-07-30T12:00:00Z').phrase, 'updated 28 days ago');
  assert.equal(at('2026-07-27T12:00:00Z').phrase, 'updated 1 month ago');
  assert.equal(at('2026-02-27T12:00:00Z').phrase, 'updated 6 months ago');
  assert.equal(at('2025-08-20T12:00:00Z').phrase, 'updated 1 year ago');
  assert.equal(at('2023-08-27T12:00:00Z').phrase, 'updated 3 years ago');
  // The one that changed, stated rather than left to be discovered.
  assert.equal(at('2026-08-27T02:00:00Z').phrase, 'updated 10 hours ago');
});

test('a future instant clamps to zero rather than counting down', () => {
  // Clock skew between an origin and a reader is not information, and
  // "updated in 3 minutes" is a sentence no card should ever render.
  const zero = { compact: '0m', phrase: 'updated less than a minute ago' };
  assert.deepEqual(at('2026-08-27T12:00:01Z'), zero, 'a second into the future must not count up');
  assert.deepEqual(at('2030-01-01T00:00:00Z'), zero, 'four years into the future must not count up');
});

test('an instant nothing can read is a dash and says so in words', () => {
  // Not a zero and not today: an unreadable instant is an instant nobody
  // knows, and the freshest possible answer is the one lie available here.
  for (const bad of ['', 'not-an-instant', '2026-13-45T00:00:00Z', 'undefined']) {
    assert.deepEqual(relativeAge(bad, noon), unknownAge, `"${bad}" was read as a real instant`);
  }
  assert.deepEqual(unknownAge, { compact: '—', phrase: 'last update not reported' });
});

test('the absolute instant is UTC, locale-free, and refuses what it cannot read', () => {
  // The exact moment the relative phrase is relative TO. It goes through the
  // grid's own calendar formatter, so a date is never written two ways on one
  // page, and it is sliced out of the ISO form rather than localised, because
  // a rendered figure must not depend on the visitor's environment.
  assert.equal(absoluteInstant('2026-08-29T07:02:14Z'), 'Aug 29, 2026, 07:02 UTC');
  // An offset instant is normalised to UTC rather than printed as written.
  assert.equal(absoluteInstant('2026-08-29T09:02:14+02:00'), 'Aug 29, 2026, 07:02 UTC');
  assert.equal(absoluteInstant('2026-01-01T00:00:00Z'), 'Jan 1, 2026, 00:00 UTC');
  assert.equal(absoluteInstant('not-an-instant'), null);
});

test('the detail names the phrase, dates it, and marks it only when there is a figure to mark', () => {
  const live = ageDetail('2026-08-29T07:02:14Z', Date.parse('2026-08-29T10:02:14Z'), false);
  assert.equal(live.name, 'updated 3 hours ago', 'the detail’s name is the full sentence');
  assert.deepEqual(live.rows, [{ label: '', value: 'Aug 29, 2026, 07:02 UTC' }]);

  // A recorded figure carries the page's one provenance wording, as a row of
  // the detail rather than a mark stamped on the visible line.
  const marked = ageDetail('2026-08-29T07:02:14Z', Date.parse('2026-08-29T10:02:14Z'), true);
  assert.deepEqual(marked.rows, [
    { label: '', value: 'Aug 29, 2026, 07:02 UTC' },
    { label: '', value: recordedOutOfBand },
  ]);
  assert.equal(recordedOutOfBand, 'recorded out of band, not fetched live');

  /* A DASH GETS NO PROVENANCE ROW, and the two halves ride one condition:
     there is no instant to print, so there is no figure that could have been
     recorded, and marking one would claim a capture nobody made. */
  const unreadable = ageDetail('not-an-instant', noon, true);
  assert.equal(unreadable.name, 'last update not reported');
  assert.deepEqual(unreadable.rows, []);
});

test('msUntilNextMinute lands the tick on the wall-clock minute', () => {
  // The whole reason the freshness counter is aligned rather than merely
  // periodic: a timer armed at :17 and repeated every 60s renders "1m"
  // seventeen seconds late forever, and every card would be late by its own
  // amount.
  assert.equal(msUntilNextMinute(Date.parse('2026-08-27T12:00:15Z')), 45_000);
  assert.equal(msUntilNextMinute(Date.parse('2026-08-27T12:00:59Z')), 1_000);
  // AT the boundary it answers a whole minute, never zero: zero is a timer
  // that fires immediately and re-arms on the same instant — a busy loop.
  assert.equal(msUntilNextMinute(Date.parse('2026-08-27T12:00:00Z')), 60_000);
  // Sub-second precision survives, so the tick does not creep forward.
  assert.equal(msUntilNextMinute(Date.parse('2026-08-27T12:00:15Z') + 250), 44_750);
  // A clock before the epoch still gets a positive delay; a bare remainder
  // would go negative there and fire forever.
  const answer = msUntilNextMinute(-90_000);
  assert.ok(answer > 0 && answer <= 60_000, `a pre-epoch clock asked for ${answer}ms`);
});
