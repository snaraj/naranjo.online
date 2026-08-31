/* How long ago an instant was, in the two renderings a counter needs (owner
 * directive, issue 268): the COMPACT form a stat cell draws beside its icon
 * ("0m", "42m", "3h", "24d", "6mo", "3y") and the PHRASE a reader gets in the
 * detail ("updated 42 minutes ago"). One module, so the two can never say
 * different things about the same instant.
 *
 * It replaces projects.ts's `updatedLabel`, and the replacement is not a
 * rename. That function was deliberately COARSE — a repository pushed within
 * the last day read "updated today" — because the figures around it were a
 * frozen capture and hours would have claimed a precision the data did not
 * have. That premise expired when the origin started reading the repository
 * metadata itself: the push instant is now as live as anything else on the
 * card, so the page can say how long ago it was and keep saying it while the
 * reader is looking. `msUntilNextMinute` is what makes that a MINUTE-ALIGNED
 * tick rather than a sixty-second drift — a timer that starts at :17 and
 * repeats every 60s renders "1m" seventeen seconds late forever, and every
 * card on the page would be late by a different amount.
 *
 * FRAMEWORK-FREE by design (owner directive): plain functions over a string
 * and a number, so the whole band table is executed by a node test against a
 * fixed clock rather than asserted around a moving one. `now` is injectable
 * for exactly that reason.
 *
 * COARSE ABOVE A DAY, still. Months are thirty days and years are 365 —
 * calendar-exact arithmetic would change no reader's takeaway on a card whose
 * point is "recently, or not" — but a two-year-old repository says `3y` and
 * never `730d`, because a compact form nobody can read at a glance is not
 * compact.
 *
 * UNPARSEABLE IS A DASH, never a zero and never today. An instant this cannot
 * read is an instant nothing here knows, and the honest-states floor says so
 * in words rather than inventing the freshest possible answer. A FUTURE
 * instant clamps to zero: a clock skew between the origin and the reader is
 * not information, and "updated in 3 minutes" is a sentence no card should
 * ever render. */

import { recordedOutOfBand } from './blocks.ts';
import { formatCalendarDate } from './grid.ts';
import type { TipDetail, TipRow } from './tooltip.ts';

const minuteMs = 60_000;
const hourMs = 3_600_000;
const dayMs = 86_400_000;

/* The two renderings of one age. Both are always present: the compact form is
 * what the cell draws and the phrase is what the detail and the accessible
 * name carry, so a figure is never encoded by the terse form alone. */
export interface RelativeAge {
  readonly compact: string;
  readonly phrase: string;
}

/* The rendering for an instant nothing could read. Exported so a caller can
 * compare against it rather than re-spelling either half. */
export const unknownAge: RelativeAge = {
  compact: '—',
  phrase: 'last update not reported'
};

function counted(count: number, noun: string): string {
  return `updated ${count} ${count === 1 ? noun : `${noun}s`} ago`;
}

/* relativeAge reads one instant against a clock. The bands narrow as they
 * approach now, which is the shape of what a reader actually wants to know:
 * whether a repository moved in the last hour matters at minute resolution,
 * whether it moved in 2023 or 2024 does not. */
export function relativeAge(instant: string, now: number = Date.now()): RelativeAge {
  const at = Date.parse(instant);
  if (Number.isNaN(at)) {
    return unknownAge;
  }
  /* Clamped, not signed: see the future-instant note above. */
  const elapsed = Math.max(0, now - at);
  if (elapsed < minuteMs) {
    return { compact: '0m', phrase: 'updated less than a minute ago' };
  }
  if (elapsed < hourMs) {
    const minutes = Math.floor(elapsed / minuteMs);
    return { compact: `${minutes}m`, phrase: counted(minutes, 'minute') };
  }
  if (elapsed < dayMs) {
    const hours = Math.floor(elapsed / hourMs);
    return { compact: `${hours}h`, phrase: counted(hours, 'hour') };
  }
  const days = Math.floor(elapsed / dayMs);
  if (days < 30) {
    return { compact: `${days}d`, phrase: counted(days, 'day') };
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return { compact: `${months}mo`, phrase: counted(months, 'month') };
  }
  const years = Math.floor(days / 365);
  return { compact: `${years}y`, phrase: counted(years, 'year') };
}

/* absoluteInstant is the exact moment the relative phrase is relative TO, and
 * it is the reason a live age can be trusted rather than merely watched: a
 * reader who wants the fact rather than the feeling gets it one hover away.
 *
 * UTC and LOCALE-FREE, both deliberately. The date half goes through the
 * grid's own calendar formatter so a date is never written two ways on one
 * page, and the time half is sliced straight out of the ISO form — no
 * toLocaleString anywhere, because a rendered figure is part of the tested
 * contract and must never depend on the visitor's environment. Null for an
 * instant this cannot read, so a caller falls back rather than printing a
 * formatted "Invalid Date". */
export function absoluteInstant(instant: string): string | null {
  const at = Date.parse(instant);
  if (Number.isNaN(at)) {
    return null;
  }
  const iso = new Date(at).toISOString();
  const date = formatCalendarDate(iso.slice(0, 10), true);
  return date === null ? null : `${date}, ${iso.slice(11, 16)} UTC`;
}

/* ageDetail is the whole hover/touch readout for an age counter: the phrase
 * as the detail's name — the same grammar every other counter follows, where
 * the name IS the full sentence the terse cell dropped — then the absolute
 * instant, then the provenance row when the figure was recorded out of band.
 *
 * The provenance row rides the SAME condition as the absolute instant rather
 * than a second test of its own, and that is the "a dash gets no provenance
 * row" rule made structural: an instant this module cannot read renders `—`,
 * and a dash is not a figure anything can vouch for. */
export function ageDetail(
  instant: string,
  now: number = Date.now(),
  marked: boolean = false
): TipDetail {
  const absolute = absoluteInstant(instant);
  const rows: TipRow[] = [];
  if (absolute !== null) {
    rows.push({ label: '', value: absolute });
    if (marked) {
      rows.push({ label: '', value: recordedOutOfBand });
    }
  }
  return { name: relativeAge(instant, now).phrase, rows };
}

/* msUntilNextMinute is how long a live age may sleep before it is stale: the
 * remainder to the next wall-clock minute, so every tick lands ON a minute
 * boundary and every card on the page turns over together.
 *
 * At an exact boundary it answers a whole minute rather than zero. Zero would
 * be a timer that fires immediately and re-arms on the same instant — a busy
 * loop, in the one case a naive `now % 60000` produces — and the honest answer
 * at :00 is that the next minute is sixty seconds away.
 *
 * The double modulo is not decoration: a negative clock (a machine set before
 * 1970, a test driving one) makes a bare remainder negative, and a negative
 * delay is a timer that fires at once forever. */
export function msUntilNextMinute(now: number = Date.now()): number {
  return minuteMs - (((now % minuteMs) + minuteMs) % minuteMs);
}
