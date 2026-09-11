/* Pure presentation logic for the token-usage panel, kept out of the component
 * so every rule here is unit-testable without a browser. The component renders
 * whatever these helpers return; it never computes, so a formatting or
 * admission bug is a one-file fix with a failing test beside it. */

import type {
  LedgerBar,
  LedgerBoardProps,
  LedgerCard,
  LedgerFact,
  LedgerMeter,
  LedgerSpark
} from './blocks.ts';
import { addDays, formatMagnitudeFixed, formatWhole } from './grid.ts';
import { dayNumber, formatDateRange } from './periods.ts';
import { panelStaleAfterMs, panelStaleNote } from './panels.ts';
/* The model vocabulary is DATA and it lives in one file, outside this
   directory on purpose: the origin embeds the same bytes and the capture tool
   reads them, so no consumer keeps a copy that could disagree (issue #302).
   The container's frontend stage copies the file in beside VERSION, which is
   the precedent this follows. */
import modelVocabulary from '../../../internal/panels/config/models.json' with { type: 'json' };
/* The SOURCE vocabulary is data in exactly the same sense and lives beside it
   for exactly the same reason (issue #311): the wire carries a machine key,
   the page prints a written name, and a table kept anywhere else is a table
   that can disagree with the origin about what a source is called. */
import sourceVocabulary from '../../../internal/panels/config/sources.json' with { type: 'json' };
import type {
  PanelEnvelope,
  PanelStatus,
  TokenUsageClassTotals,
  TokenStatUnit,
  TokenUsageCategory,
  TokenUsageInsight,
  TokenUsageModelStat,
  TokenUsageSeries,
  TokenUsageSource,
  TokenUsageStat,
  TokenUsageWindow
} from './panels';

/* The registry identifier the usage block loads; the one place the id is
 * spelled on the frontend. */
export const tokenUsagePanelId = 'token-usage';

/* Meter severity thresholds, in utilization percent. Below warning the fill
 * wears the calm default; at or above each threshold it steps up. The numeric
 * value label always renders beside the meter, so severity is never carried by
 * color alone. */
export const meterWarningPct = 75;
export const meterCriticalPct = 90;

export type MeterSeverity = 'ok' | 'warning' | 'critical';

export function meterSeverity(pct: number): MeterSeverity {
  if (pct >= meterCriticalPct) {
    return 'critical';
  }
  if (pct >= meterWarningPct) {
    return 'warning';
  }
  return 'ok';
}

/* meterFillPct is the drawn fill width. Utilization over 100 is real data —
 * the label shows the true figure — but the bar itself cannot honestly draw
 * past its own track, so the fill saturates at 100. */
export function meterFillPct(pct: number): number {
  if (pct <= 0) {
    return 0;
  }
  if (pct >= 100) {
    return 100;
  }
  return pct;
}

/* formatUtilization renders the true utilization value to at most one decimal
 * place, trimming a trailing .0 so whole numbers read plainly: 36.4 stays
 * "36.4%", 61 stays "61%", 104.02 becomes "104%". */
export function formatUtilization(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  return `${rounded}%`;
}

/* formatTokenCount is the auto-compact figure used across the panel: exact
 * comma-grouped digits below ten thousand, then K, M, B and T steps written
 * to ONE decimal place — 1284 renders "1,284", 12900 renders "12.9K",
 * 129000000 renders "129.0M". Counts are non-negative by admission below.
 *
 * The decimal place is KEPT rather than trimmed (owner directive, 2026-09-11:
 * the approved board prints "129.0M"). The board reads its figures down a
 * column and across a row against each other, and a column that alternates
 * "129M" with "44.9B" is a column whose digits stop lining up — which is a
 * different claim about the same quantity only in the sense that it is harder
 * to compare. The calendar keeps the trimmed spelling, because a tooltip is
 * read alone rather than against its neighbours.
 *
 * The arithmetic lives in lib/grid.ts (owner directive, 2026-08-25), and this
 * is the panel's NAME for it rather than a second implementation. It had one
 * already: the heatmap under this panel's own summary line rendered its cells
 * with exact digits, so the same day's usage read "7.7B tokens over 15 days"
 * in the sentence and "627,742,457" in the tooltip above it. Both spellings
 * pick their unit through one shared step walk, so the two readings can never
 * disagree about whether a figure is millions or billions. */
export function formatTokenCount(count: number): string {
  return formatMagnitudeFixed(count);
}

/* resetsIn renders a window's resetsAt in the same coarse relative language
 * panelAge writes a commit's age in — a glance, not a clock. Absent,
 * malformed, and already-passed instants all render as nothing: the envelope's
 * own status carries provenance for the payload, and inventing "resets in 0m"
 * would be a fake number. */
export function resetsIn(resetsAt: string | undefined, now: Date = new Date()): string {
  if (!resetsAt) {
    return '';
  }
  const at = Date.parse(resetsAt);
  if (Number.isNaN(at)) {
    return '';
  }
  const seconds = Math.floor((at - now.getTime()) / 1000);
  if (seconds <= 0) {
    return '';
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `resets in ${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `resets in ${hours}h`;
  }
  return `resets in ${Math.floor(hours / 24)}d`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* isCount is the LAST stage of one numeric contract that spans three
 * languages, and all three admit exactly the same set (2026-08-24 round-3
 * review finding 9). The producer bounds every counter at MAX_COUNT
 * (scripts/capture_usage_series.py), the server refuses a category total or
 * sum outside maxCountValue (internal/panels/types.go), and this admits only
 * what both of those can have produced. 2^53 - 1 is the largest integer
 * JavaScript represents exactly, so a value above it has ALREADY lost
 * precision by the time it reaches here — 9007199254740993 parses as
 * ...992, and two different producer totals become one indistinguishable
 * number. Number.isFinite admitted that silently, and admitted 1.5 and -0.5
 * as counts besides. Number.isSafeInteger refuses the lot: non-integers,
 * values past the exact-representation boundary, NaN and both infinities.
 * The countBound export below exists so the shared ceiling has a name to
 * compare: "the count bound is the same number in Go, Python and TypeScript"
 * (frontend/tests/panels-ui.test.mjs) reads this file, internal/panels/types.go
 * and scripts/capture_usage_series.py, and compares all three BY VALUE —
 * evaluating each language's own spelling, since Go writes the shift, Python
 * the power, and TypeScript the built-in constant. */
export const countBound = Number.MAX_SAFE_INTEGER;

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/* isRate admits the two payload fields the server declares *float64 rather
 * than int64 — a window's utilizationPct and an insight's pct. They are
 * NOT counts: a percentage is a rate, and 36.4 is a correct value for one,
 * so the integer contract above would refuse real data. Splitting them out
 * is what lets isCount tighten at all; before this the single predicate had
 * to stay loose enough for the fractional cases, which is exactly how
 * fractional and precision-losing token totals got in. No upper bound is
 * asserted on purpose: utilization above 100 is a real overage reading, and
 * inventing a ceiling here would refuse a truthful number. */
function isRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/* The units a stat tile may declare. A unit the frontend cannot format is a
 * contract break, not a rendering choice, so admission refuses it. */
const statUnits: ReadonlySet<string> = new Set(['tokens', 'days', 'seconds', 'count']);

/* formatDuration renders elapsed seconds the way a task length reads: days,
 * hours and minutes above a day, hours and minutes above an hour, minutes
 * above a minute, seconds below that.
 *
 * The day step is not decoration. A session running past midnight twice is a
 * real recorded figure, and rendering it as "41h 55m" made the reader do the
 * division the source tool had already done for them — it reports "1d 17h
 * 55m", the same quantity, in the units a person thinks in. Every step keeps
 * its remainder rather than rounding, so the rendered figure is exact at the
 * minute and "1d 0h 0m" reads like the "1h 0m" one step below it. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${Math.floor(hours / 24)}d ${hours % 24}h ${minutes % 60}m`;
}

/* formatStatValue renders one tile's figure by unit: compact digits for token
 * counts, whole days for streaks, an hours-and-minutes duration for elapsed
 * seconds, and grouped exact digits for a plain tally. A null value is an unreported figure and renders as an explicit
 * dash — never as a zero, which would be a different claim. */
export function formatStatValue(value: number | null, unit: TokenStatUnit): string {
  if (value === null) {
    return unknownFigure;
  }
  if (unit === 'days') {
    return `${value} ${value === 1 ? 'day' : 'days'}`;
  }
  if (unit === 'seconds') {
    return formatDuration(value);
  }
  if (unit === 'count') {
    /* A plain tally, grouped but never abbreviated: 25 sessions is a number a
       reader wants exactly, and "25" compacted to "25" gains nothing while
       17,069 compacted to "17.1K" loses the figure the tile exists to show.

       formatWhole (lib/grid.ts) is THE hand-rolled thousands grouper — it
       rounds internally, so this is exactly what the local copy did, and it
       carries a negative-sign guard the local copy lacked (which rendered
       -123 as "-,123"). Unreachable today, since isCount admits no negative,
       but a second grouper that formats one case differently is a defect
       waiting for the first signed figure this site serves. */
    return formatWhole(value);
  }
  return formatTokenCount(value);
}

/* tokenUsageSources is the component's admission gate, mirroring the strict
 * decode doctrine the origin applies before serving: only the exact
 * token-usage/v1 payload shape is rendered, and any malformed corner — a
 * non-string label, a negative count, a numberless window, a stat in a unit
 * this file cannot format — refuses the whole payload so the panel shows its
 * honest empty state instead of fake numbers. Source labels pass through as
 * DATA and stay machine keys here; nothing in this admission knows a vendor,
 * and the written name is resolved at render time through sourceName. The
 * stat, series, insight and model-accounting sections are all optional: a
 * payload written before any of them existed is still admitted, and an absent
 * section simply does not render. */
export function tokenUsageSources(data: unknown): TokenUsageSource[] {
  if (!isRecord(data) || !Array.isArray(data.sources)) {
    return [];
  }
  const sources: TokenUsageSource[] = [];
  for (const candidate of data.sources) {
    if (!isRecord(candidate) || typeof candidate.label !== 'string' || candidate.label === '') {
      return [];
    }
    if (!Array.isArray(candidate.windows)) {
      return [];
    }
    if (candidate.account !== undefined && typeof candidate.account !== 'string') {
      return [];
    }
    const stats = admitStats(candidate.stats);
    if (stats === null) {
      return [];
    }
    const insights = admitInsights(candidate.insights);
    if (insights === null) {
      return [];
    }
    const series = admitSeries(candidate.series);
    if (series === null) {
      return [];
    }
    const modelStats = admitModelStats(candidate.modelStats);
    if (modelStats === null) {
      return [];
    }
    const windows: TokenUsageWindow[] = [];
    for (const entry of candidate.windows) {
      if (!isRecord(entry) || typeof entry.period !== 'string' || entry.period === '') {
        return [];
      }
      if (!isCount(entry.inputTokens) || !isCount(entry.outputTokens)) {
        return [];
      }
      if (entry.utilizationPct !== undefined && !isRate(entry.utilizationPct)) {
        return [];
      }
      if (entry.resetsAt !== undefined && typeof entry.resetsAt !== 'string') {
        return [];
      }
      const window: TokenUsageWindow = {
        period: entry.period,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens
      };
      if (entry.utilizationPct !== undefined) {
        window.utilizationPct = entry.utilizationPct;
      }
      if (entry.resetsAt !== undefined) {
        window.resetsAt = entry.resetsAt;
      }
      windows.push(window);
    }
    const source: TokenUsageSource = { label: candidate.label, windows };
    if (typeof candidate.account === 'string' && candidate.account !== '') {
      source.account = candidate.account;
    }
    if (stats.length > 0) {
      source.stats = stats;
    }
    if (insights.length > 0) {
      source.insights = insights;
    }
    if (series !== undefined) {
      source.series = series;
    }
    if (modelStats.length > 0) {
      source.modelStats = modelStats;
    }
    sources.push(source);
  }
  return sources;
}

/* admitStats returns the admitted tiles, or null when the section exists but
 * is malformed — the signal the caller turns into a refused payload. An
 * absent section is an empty list, never a refusal. */
function admitStats(value: unknown): TokenUsageStat[] | null {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const stats: TokenUsageStat[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.key !== 'string' || entry.key === '') {
      return null;
    }
    if (typeof entry.label !== 'string' || entry.label === '') {
      return null;
    }
    if (typeof entry.unit !== 'string' || !statUnits.has(entry.unit)) {
      return null;
    }
    if (entry.value !== null && !isCount(entry.value)) {
      return null;
    }
    if (entry.recorded !== undefined && typeof entry.recorded !== 'boolean') {
      return null;
    }
    stats.push({
      key: entry.key,
      label: entry.label,
      value: entry.value === null ? null : (entry.value as number),
      unit: entry.unit as TokenStatUnit,
      recorded: entry.recorded === true
    });
  }
  return stats;
}

/* admitInsights follows the same three-state contract as admitStats. */
function admitInsights(value: unknown): TokenUsageInsight[] | null {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const insights: TokenUsageInsight[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.label !== 'string' || entry.label === '') {
      return null;
    }
    if (entry.pct !== null && !isRate(entry.pct)) {
      return null;
    }
    if (entry.recorded !== undefined && typeof entry.recorded !== 'boolean') {
      return null;
    }
    insights.push({
      label: entry.label,
      pct: entry.pct === null ? null : (entry.pct as number),
      recorded: entry.recorded === true
    });
  }
  return insights;
}

/* admitModelStats holds the optional LIFETIME model accounting to the same
 * three-state contract every other section takes — absent is an empty list, a
 * malformed section refuses the whole payload — and to the SAME closed
 * membership the daily model partition takes: a key outside the vocabulary
 * refuses, no key twice, and never more rows than the file has members. It is
 * defence in depth exactly as admitBreakdown's membership rule is: the origin
 * blocks such a payload today, and the claim that an unknown key cannot reach
 * rendering has to survive a future boundary regression rather than depend on
 * one.
 *
 * A class the member never spent is ABSENT on the wire, not zero — the
 * origin's contract (internal/panels/types.go), and the producer's, which
 * drops a nought class from the member — so the boundary reads absence as
 * the zero it is, refuses a class outside the closed vocabulary or a class
 * present without a figure, and requires at least one class, exactly as the
 * origin does. One fixture, internal/panels/testdata/model-stats-shapes.json,
 * pins the four stages to one shape (PR #312 review, finding 1): before it,
 * this boundary required all four classes and refused the WHOLE payload over
 * a member the origin had served truthfully. */
function admitModelStats(value: unknown): TokenUsageModelStat[] | null {
  if (value === undefined) {
    return [];
  }
  /* The row bound is checked BEFORE a single row is read, which is what makes
     it a bound on WORK rather than a second spelling of the duplicate rule
     below: closed membership already means an over-long section must repeat a
     key, but only after the walk has run over every entry in it. */
  if (!Array.isArray(value) || value.length > modelSlots.size) {
    return null;
  }
  const seen = new Set<string>();
  const stats: TokenUsageModelStat[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.key !== 'string' || !modelSlots.has(entry.key)) {
      return null;
    }
    /* No key twice: two rows for one model are two answers to one question,
       and the share arithmetic below would count the member's tokens twice in
       the denominator and once in its own bar. */
    if (seen.has(entry.key)) {
      return null;
    }
    seen.add(entry.key);
    const totals = admitClassTotals(entry.totals);
    if (totals === null) {
      return null;
    }
    stats.push({ key: entry.key, totals });
  }
  return stats;
}

/* admitClassTotals admits one model's classes, or refuses.
 *
 * Every key present must be one of the four classes and carry a count; a
 * class absent is the zero the origin's contract says it is; a record naming
 * no class at all is a member that spent nothing, which never reaches the
 * wire and is refused here as the origin refuses it.
 *
 * The sum is CHECKED, the same rule the day partition takes and for the same
 * reason: JavaScript addition does not overflow, it silently stops being
 * exact, so four admissible counts can land on a number that is merely NEAR
 * the truth — and every share on the card would then be a proportion of an
 * approximation. Refusing the moment the running sum leaves the exact range
 * keeps the arithmetic meaningful instead of decorative. */
function admitClassTotals(value: unknown): TokenUsageClassTotals | null {
  if (!isRecord(value)) {
    return null;
  }
  const totals: TokenUsageClassTotals = { input: 0, output: 0, 'cache-read': 0, 'cache-write': 0 };
  let sum = 0;
  let present = 0;
  for (const key of Object.keys(value)) {
    if (!(classKeys as readonly string[]).includes(key)) {
      return null;
    }
    const count = value[key];
    if (!isCount(count)) {
      return null;
    }
    totals[key as (typeof classKeys)[number]] = count;
    sum += count;
    present += 1;
  }
  if (present === 0 || !Number.isSafeInteger(sum)) {
    return null;
  }
  return totals;
}

/* How many rows ONE breakdown of a series may carry. The category bound is
 * the structural guard the Go boundary states as maxSeriesCategories; the
 * model bound is the model vocabulary's own size, exactly as maxSeriesModels
 * is, so a payload naming more model rows than the file has members is
 * refused before a single key is looked up. Neither can inflate the render
 * with hundreds of entries. */
const maxCategoryRows = 8;

/* maxModelDays bounds how many trailing days the model breakdown may cover —
 * the same eight-week budget the Go boundary enforces (maxModelDays in
 * internal/panels/types.go), mirrored here so a regression there still meets
 * a refusal before rendering. It was a quarter until the vocabulary gained
 * its second vendor group (issue #302), and ten weeks until the sealed
 * ceiling needed its further digit (issue #267): the section costs one
 * integer per day per member, and the ceiling is never the lever; the window
 * is. The categories breakdown carries no separate day bound on either side,
 * exactly as in Go. */
const maxModelDays = 56;

/* admitSeries returns the admitted series, undefined when the section is
 * absent, or null when it exists and is malformed. The start date must be a
 * plain calendar date: the grid does day arithmetic on it, and an instant or
 * a locale string would silently shift every cell. The optional categories
 * section is held to the same three-state contract: absent is fine, and any
 * malformed corner — a non-array, a bad key, a length that disagrees with
 * the series, a negative count, a duplicate key — refuses the whole payload
 * rather than rendering a half-true breakdown. */
function admitSeries(value: unknown): TokenUsageSeries | null | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value) || typeof value.startDate !== 'string') {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.startDate)) {
    return null;
  }
  if (!Array.isArray(value.totals) || !value.totals.every(isCount)) {
    return null;
  }
  const totals = value.totals as number[];
  if (value.recorded !== undefined && typeof value.recorded !== 'boolean') {
    return null;
  }
  const series: TokenUsageSeries = { startDate: value.startDate, totals };
  if (value.recorded === true) {
    series.recorded = true;
  }
  if (value.categories !== undefined) {
    const categories = admitBreakdown(
      value.categories,
      totals,
      value.startDate,
      categorySlots,
      maxCategoryRows
    );
    if (categories === null) {
      return null;
    }
    if (categories.length > 0) {
      series.categories = categories;
    }
  }
  if (value.models !== undefined) {
    const models = admitBreakdown(
      value.models,
      totals,
      value.startDate,
      modelSlots,
      modelSlots.size,
      maxModelDays,
      true
    );
    if (models === null) {
      return null;
    }
    if (models.length > 0) {
      series.models = models;
    }
  }
  return series;
}

/* admitBreakdown validates ONE optional per-day breakdown of the series
 * against the SAME rules the Go boundary applies, not a weaker shape check
 * (2026-08-24 security review, finding 6; extended for the model partition by
 * issue #170):
 *
 *   1. CLOSED MEMBERSHIP. A key must be a member of the vocabulary handed in
 *      — the frontend's single statement of that vocabulary, pinned against
 *      the capture tool and the Go serve order by the parity tests in
 *      scripts/ci. The previous check was a label SHAPE
 *      (`/^[a-z][a-z0-9-]{0,31}$/`), and shape admits far more than a
 *      vocabulary does: `private-feature` is perfectly label-shaped, and the
 *      label helper would have humanized it into public copy. The origin
 *      blocks such a payload today, so this is defense in depth — which is
 *      exactly what it must be, because the claim that hostile keys cannot
 *      reach rendering has to survive a future boundary regression rather
 *      than depend on one.
 *   2. COUNT. At most as many entries as the vocabulary has members, and no
 *      key twice.
 *   3. WINDOW. Rows may cover a declared TRAILING window of the series
 *      instead of all of it. Every row must declare the SAME window, and a
 *      declared start must name a day strictly INSIDE the series — so
 *      "aligned" has exactly one spelling (omission) and a window can never
 *      claim days the series does not have.
 *   4. LENGTH. Every row covers exactly the days the window spans.
 *   5. PARTITION. The rows must sum to the day's own total on EVERY day the
 *      window covers, so the stacked reading and the plain reading cannot
 *      disagree. A breakdown that says something different from the graph
 *      above it is not a smaller error than a missing one.
 *
 *   6. NO PLACEHOLDER ROWS, for the model partition only (issue #302). A
 *      member whose window total is zero is a named entity drawn at nought
 *      percent beside entities that were actually used; the producer omits
 *      it and the origin refuses it, so a payload carrying one has been
 *      edited or produced by something that disagrees with both. The
 *      category partition keeps the older rule: its five accounting classes
 *      are a fixed division of the same day, so a class that genuinely
 *      measured nothing is a reading rather than a placeholder.
 *
 * ONE function, TWO vocabularies. Categories and models differ in nothing but
 * which vocabulary admits a key, how many rows and days it allows, and
 * whether an empty row is a reading — so they share this admission rather
 * than growing two implementations of the same rules, the identical shape the
 * Go boundary took for the identical reason.
 *
 * Any failing corner refuses the whole payload rather than rendering a
 * half-true breakdown. */
function admitBreakdown(
  value: unknown,
  totals: number[],
  seriesStart: string,
  vocabulary: ReadonlyMap<string, number>,
  maxRows: number,
  maxDays = 0,
  noEmptyRows = false
): TokenUsageCategory[] | null {
  if (!Array.isArray(value) || value.length > maxRows) {
    return null;
  }
  if (value.length === 0) {
    return [];
  }
  const window = breakdownWindow(value, seriesStart, totals.length);
  if (window === null) {
    return null;
  }
  const { offset, declared } = window;
  const span = totals.length - offset;
  /* The model window's day bound, mirrored from the Go boundary
   * (maxModelDays in internal/panels/types.go) so the frontend admits by
   * the same five rules plus this sixth wherever the boundary states one —
   * zero means the breakdown answers to the series bound alone, which is
   * the categories case (2026-08-27 adversarial review of PR #230,
   * finding 4). */
  if (maxDays > 0 && span > maxDays) {
    return null;
  }
  const seen = new Set<string>();
  const rows: TokenUsageCategory[] = [];
  const sums = new Array<number>(span).fill(0);
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.key !== 'string' || !vocabulary.has(entry.key)) {
      return null;
    }
    if (seen.has(entry.key)) {
      return null;
    }
    seen.add(entry.key);
    if (!Array.isArray(entry.totals) || entry.totals.length !== span || !entry.totals.every(isCount)) {
      return null;
    }
    const dailies = entry.totals as number[];
    for (let day = 0; day < span; day += 1) {
      /* CHECKED summation, the frontend end of finding 9's one numeric
       * contract. Go refuses an int64 category sum that overflows and
       * Python refuses a counter past MAX_COUNT; here the hazard is
       * different in kind but identical in effect. JavaScript addition
       * does not overflow — it silently stops being exact, so eight
       * admissible rows can sum past 2^53-1 and land on a number
       * that is merely NEAR the truth. The equality check below would
       * then be comparing two approximations, and could pass on a
       * document whose parts do not actually add up. Refusing the moment
       * the running sum leaves the exact range keeps the comparison
       * meaningful instead of decorative. */
      const running = sums[day] + dailies[day];
      if (!Number.isSafeInteger(running)) {
        return null;
      }
      sums[day] = running;
    }
    if (noEmptyRows && dailies.every((value) => value === 0)) {
      return null;
    }
    const row: TokenUsageCategory = { key: entry.key, totals: dailies };
    if (declared !== undefined) {
      row.startDate = declared;
    }
    rows.push(row);
  }
  for (let day = 0; day < span; day += 1) {
    if (sums[day] !== totals[offset + day]) {
      return null;
    }
  }
  return rows;
}

/* breakdownWindow resolves the one window a breakdown's rows declare, or
 * refuses. Every row must agree — a breakdown whose rows claimed different
 * ranges would be several breakdowns wearing one section — and an absent
 * declaration on every row is the aligned case, offset zero.
 *
 * A declared start must land strictly INSIDE the series: at zero it would be
 * a second spelling of "aligned", and at or past the end it would claim days
 * the series has no totals for. Both are refusals rather than corrections,
 * because a window is a claim about which days are being described and a
 * silently adjusted claim is worse than a refused one. */
function breakdownWindow(
  rows: readonly unknown[],
  seriesStart: string,
  days: number
): { offset: number; declared?: string } | null {
  let declared: string | undefined;
  for (const entry of rows) {
    if (!isRecord(entry)) {
      return null;
    }
    if (entry.startDate === undefined) {
      if (declared !== undefined) {
        return null;
      }
      continue;
    }
    if (typeof entry.startDate !== 'string') {
      return null;
    }
    if (declared !== undefined && declared !== entry.startDate) {
      return null;
    }
    declared = entry.startDate;
  }
  if (declared === undefined) {
    return { offset: 0 };
  }
  /* A partly-declared breakdown — some rows carrying the window, some not —
   * was already refused above by the first branch, which is why this only
   * has to resolve one date. */
  for (const entry of rows) {
    if (!isRecord(entry) || entry.startDate !== declared) {
      return null;
    }
  }
  const start = dayNumber(seriesStart);
  const from = dayNumber(declared);
  if (start === null || from === null) {
    return null;
  }
  const offset = from - start;
  if (offset <= 0 || offset >= days) {
    return null;
  }
  return { offset, declared };
}

/* categoryLabel renders a machine key as display copy: hyphens become spaces
 * and nothing else changes, so the shown word list is exactly the data's
 * vocabulary in the panel's own lowercase voice. It is the board's key-to-
 * words rule for every key it prints — an accounting class on a source card,
 * a streak on the session card — rather than one rule per section, because
 * "cache-write" and "longest-streak" are the same kind of word list and a
 * second transformation would be a second place for them to disagree. Model
 * keys are the deliberate exception and modelLabel says why. */
export function categoryLabel(key: string): string {
  return key.replace(/-/g, ' ');
}

export interface CategoryShare {
  key: string;
  /* The category's total across the whole series window. */
  total: number;
  /* Its share of the window's grand total, in percent, or NULL when the
   * window recorded nothing at all — because a share of nothing is not zero
   * percent, it is unknown, and the two are different claims (owner
   * directive, 2026-08-28: "if its either 0 or unknown I rather it be
   * Unknown").
   *
   * This used to be 0, and 0 was a lie with a bar drawn under it: an empty
   * model window rendered five rows all reading "0%", each carrying a
   * provenance mark, implying five measured proportions where the
   * denominator had simply never existed. A share the data cannot support
   * now reaches the same dash an unreported tile has always rendered.
   *
   * A share of a window that DID record tokens stays a number, zero
   * included: a category that genuinely contributed nothing to a real
   * window is 0%, and that is a measurement. */
  pct: number | null;
}

/* unknownFigure is the one spelling of "this is not a number the data can
 * vouch for", shared by every figure that can be absent so a reader learns one
 * mark rather than three. An em dash, which is the mark lib/projects.ts has
 * always drawn for the same claim — two hyphens read as a truncated figure
 * beside a column of real ones (owner directive, 2026-09-11). */
export const unknownFigure = '—';

/* formatShare renders a proportion, or the unknown mark when there is none. */
export function formatShare(pct: number | null): string {
  return pct === null ? unknownFigure : formatUtilization(pct);
}

/* categoryShares summarizes the breakdown for the composition strip: one
 * row per category in served (canonical) order. */
export function categoryShares(series: TokenUsageSeries): CategoryShare[] {
  if (!series.categories || series.categories.length === 0) {
    return [];
  }
  const grand = series.totals.reduce((sum, total) => sum + total, 0);
  return series.categories.map((category) => {
    const total = category.totals.reduce((sum, value) => sum + value, 0);
    return {
      key: category.key,
      total,
      pct: grand > 0 ? (total / grand) * 100 : null
    };
  });
}

/* categorySlots is the frontend's single statement of the CLOSED category
 * vocabulary, and the fixed palette slot each member owns. Two jobs, one
 * list, on purpose: admission (admitCategories checks membership here) and
 * color (categorySlot reads the slot here) can then never disagree about
 * what a category is. The list is pinned against the capture tool's
 * CATEGORY_KEYS and the Go categoryServeOrder by
 * CategoryVocabularyParityTest in scripts/ci, so adding an accounting class
 * is one deliberate edit made in three places together.
 *
 * Color follows the ENTITY, never its position in this payload: the
 * canonical vocabulary owns slots 1..5. */
const categorySlots: ReadonlyMap<string, number> = new Map([
  ['input', 1],
  ['output', 2],
  ['cache-read', 3],
  ['cache-write', 4],
  ['reasoning', 5]
]);

export function categorySlot(key: string): number {
  return categorySlots.get(key) ?? 0;
}

/* The four ACCOUNTING CLASSES, in the order every surface prints them. The
 * same four the category breakdown divides a day into, named separately here
 * because the board reads them as lifetime STAT keys and as the fields of a
 * model's own accounting — two payload shapes, one closed list, stated once.
 * Reasoning is not among them: it is a fifth category on the daily partition
 * and no source reports a lifetime figure for it. */
const classKeys = ['input', 'output', 'cache-read', 'cache-write'] as const;

/* The CLOSED MODEL vocabulary, read from the one file that states it
 * (issue #302). Every key, written name, palette slot and vendor group the
 * pipeline knows lives in internal/panels/config/models.json: the origin
 * embeds it, the capture tool reads it, and this module imports it, so the
 * three consumers cannot drift apart the way three hand-kept tables could.
 * A model joins the pipeline as ONE reviewed data edit.
 *
 * Admission here is by MEMBERSHIP — a key outside the file refuses the whole
 * payload — because the fold from a raw identifier happens at capture, where
 * that identifier is, and a document arriving with an unknown key has not
 * been through it.
 *
 * The residual leads the serve order and draws the NEUTRAL slot: it is not an
 * entity but the fold of every identifier the vocabulary does not name, and
 * its swatch says so, which is why a named entity never inherits it. */
const modelResidual = modelVocabulary.residual;

const modelMembers = modelVocabulary.groups.flatMap((group) =>
  group.members.map((member) => ({ ...member, group: group.key }))
);

/* The canonical SERVE order: the residual, then each group's members in the
 * order the file lists them. The origin walks the identical order to emit
 * rows, so every replica's bytes — and therefore its digest ETag — stay the
 * same, and admission below walks it too. */
const modelSlots: ReadonlyMap<string, number> = new Map([
  [modelResidual.key, modelResidual.slot],
  ...modelMembers.map((member): [string, number] => [member.key, member.slot])
]);

export function modelSlot(key: string): number {
  return modelSlots.get(key) ?? modelResidual.slot;
}

/* Display copy, and the reason it is a table rather than a transformation: a
 * model's written name is not derivable from its key. The category labels are
 * (hyphens become spaces, and "cache read" is right), but a key like
 * `opus-4-8` humanizes to "opus 4 8", which is not the product's name. Keys
 * stay machine-shaped on the wire — the producer's emission guard admits only
 * lowercase label shapes, so a written name could never travel as one — and
 * the written form is resolved here, at the one place that renders.
 *
 * A key the map does not know cannot reach this function: admission refuses a
 * model outside the vocabulary, and the two lists are the same list. The
 * fallback exists so a vocabulary edit that forgets a label degrades to the
 * key rather than to `undefined` in the reader's face. */
const modelLabels: ReadonlyMap<string, string> = new Map([
  [modelResidual.key, modelResidual.label],
  ...modelMembers.map((member): [string, string] => [member.key, member.label])
]);

export function modelLabel(key: string): string {
  return modelLabels.get(key) ?? key;
}

/* THE SOURCE VOCABULARY, read from the one file that states it (issue #311).
 * The wire carries a machine key for each source — the producer's own name
 * for where a capture came from — and the page prints a written name. Both
 * live in internal/panels/config/sources.json, which the origin embeds and
 * this module imports, exactly as the model vocabulary works and for exactly
 * the same reason: two tables of names are two tables that can disagree, and
 * the one that disagreed would be the one a reader is looking at.
 *
 * This is the ONLY function that turns a key into words. The board's source
 * cards, the models headings and the commits section's segment labels all ask
 * it, so a source renamed in the file is renamed everywhere at once. */
const sourceNames: ReadonlyMap<string, string> = new Map(
  sourceVocabulary.sources.map((entry): [string, string] => [entry.key, entry.name])
);

/* A key the file does not name renders AS THE KEY. A source the vocabulary
 * has not been taught yet is still a source whose figures are true, and its
 * raw key says exactly what is known about it — where inventing a name would
 * be a fabrication and dropping the card would hide real data. */
export function sourceName(key: string): string {
  return sourceNames.get(key) ?? key;
}

/* The canonical SERVE order as a RANK, so a card lays its rows out in the
 * vocabulary's order whatever order a payload served them in. The residual
 * leads it, exactly as modelSlots does, because the two are the same list
 * read for two different questions.
 *
 * The vendor GROUP is no longer read anywhere (owner directive, 2026-09-11):
 * a models card is headed by the SOURCE whose split it draws, so the group's
 * written name, its declared row count and the "which group is present" walk
 * that fed them all went with the blocks they headed. The groups are still
 * the file's own structure and still what gives each member its slot; nothing
 * on the page asks which one a member belongs to. */
const modelRanks: ReadonlyMap<string, number> = new Map(
  [modelResidual.key, ...modelMembers.map((member) => member.key)].map(
    (key, index): [string, number] => [key, index]
  )
);

/* modelShares summarizes the model partition the way categoryShares does the
 * category one, with ONE deliberate difference in the denominator: a model
 * breakdown normally covers a declared trailing WINDOW of the series, so the
 * shares are taken over the days the window covers, never over the whole
 * series. Dividing a window's totals by the whole series' grand total would
 * produce percentages that sum to well under a hundred and describe nothing
 * — the shares would silently be answering a question nobody asked. */
export function modelShares(series: TokenUsageSeries): CategoryShare[] {
  if (!series.models || series.models.length === 0) {
    return [];
  }
  const totals = series.models.map((model) =>
    model.totals.reduce((sum, value) => sum + value, 0)
  );
  const grand = totals.reduce((sum, total) => sum + total, 0);
  return series.models.map((model, index) => ({
    key: model.key,
    total: totals[index],
    pct: grand > 0 ? (totals[index] / grand) * 100 : null
  }));
}

/* ---------------------------------------------------------------------------
 * The adapter (issue 165): token-usage envelope in, UsageTracker props out.
 * This is where token accounting becomes sections of a generic usage panel —
 * every source label, figure, heading and noun below rides a domain-free
 * field, and the component that renders the result knows none of this file.
 * ------------------------------------------------------------------------ */

/* The shell heading when an envelope arrives with an empty title (the
 * unavailablePanel fallback carries one); otherwise the ORIGIN's title. */
export const tokenUsageFallbackTitle = 'Token usage';

/* The two honest empty-state lines, verbatim from the retired component. */
export const tokenUsageEmptyNote = 'No usage data available.';
export const tokenUsageSourceEmptyNote = 'No usage recorded for this source yet.';

/* The stale threshold and the line itself are the page's, not this panel's
 * (lib/panels.ts, issue 285): the contribution calendar renders the same
 * data-through idiom, and two builders would be two ways to word one fact. */
export const usageStaleAfterMs = panelStaleAfterMs;

/* usageDataThrough is the newest calendar day any source's series covers —
 * the day the graphs actually draw through, which is the honest way to date
 * a stale payload: not when the file was pushed, but how far the data it
 * carries reaches. Undefined when no source draws a series at all. */
export function usageDataThrough(sources: readonly TokenUsageSource[]): string | undefined {
  let through: string | undefined;
  for (const source of sources) {
    if (!source.series || source.series.totals.length === 0) {
      continue;
    }
    const end = addDays(source.series.startDate, source.series.totals.length - 1);
    if (through === undefined || (dayNumber(end) ?? -1) > (dayNumber(through) ?? -1)) {
      through = end;
    }
  }
  return through;
}

/* usageStaleNote is the panel's data-through line: the shared builder, dated
 * by the newest day any source's series covers (#267: "would the app catch
 * it?" used to be NO). */
export function usageStaleNote(
  status: PanelStatus,
  generatedAt: string | undefined,
  sources: readonly TokenUsageSource[],
  now: Date = new Date()
): string | undefined {
  return panelStaleNote(status, generatedAt, usageDataThrough(sources), now);
}

/* ---------------------------------------------------------------------------
 * The six-card board (owner directive, 2026-09-11, issues 267 and 311)
 *
 * The five turnable squares became six cards on a three-by-two grid: the
 * lifetime total, one card per reported source, the session record, and one
 * models card per source that has a split to show. Every figure on every card
 * comes from a stat, a window or a series the payload actually carried,
 * through the formatters above, and a figure nobody reported renders as the
 * page's own dash — never a zero, and never a card quietly missing from the
 * board.
 *
 * THE CARDS ARE DERIVED FROM THE SOURCES, not enumerated, and no function
 * below knows WHICH source it is reading. A source card is one shape rendered
 * per source in wire order; a models card is the same. A third source
 * appearing tomorrow produces a third of each with no edit here and none in
 * the component. What IS enumerated is the stat vocabulary — the keys the
 * origin serves — because that is payload data this adapter is allowed to
 * know and the component is not.
 *
 * THE SOURCE'S WRITTEN NAME comes from the vocabulary file, through
 * sourceName above and nowhere else. The wire carries a machine key; the
 * board, the models headings and the commits section's segment labels all
 * print the same written name because all three ask the same function.
 * ------------------------------------------------------------------------ */

/* The stat keys the board reads, written as data rather than as a chain of
 * conditionals: the origin's own key vocabulary (internal/panels), read here
 * and nowhere else. */
const lifetimeKey = 'lifetime';
const sessionsKey = 'sessions';
const currentStreakKey = 'current-streak';
const longestStreakKey = 'longest-streak';
const longestSessionKey = 'longest-session';

/* The page's own wording for the origin's CLOSED window vocabulary
 * (usageSeriesWindowKeys in internal/panels/types.go). Two entries because
 * the origin serves two, and a period outside them prints VERBATIM: an
 * unknown window is still a real reading, and printing the word the payload
 * used says exactly what is known about it. */
const windowTerms: ReadonlyMap<string, string> = new Map([
  ['today', 'today'],
  ['week', 'this week']
]);

export function windowTerm(period: string): string {
  return windowTerms.get(period) ?? period;
}

/* The board's own words. The turn labels prefix each card's accessible name,
 * so a reader is told what pressing does and what state the card is in;
 * nothing is printed on the card itself (owner directive, 2026-09-11: no
 * turn hint). */
export const boardTurnLabel = 'Turn';
export const boardReturnLabel = 'Turn back';
export const boardEmptyNote = tokenUsageEmptyNote;

/* The total card's own copy: what the headline is a total OF, and the subject
 * its daily line names. */
export const totalCardLabel = 'Tokens tracked';
export const lifetimeContext = 'lifetime';
const combinedLineSubject = 'All sources';

/* The session card's own copy. Its figure is a count of sessions and its
 * facts are records, so the label names the subject and the three rows name
 * themselves from their keys. */
export const sessionsCardLabel = 'Sessions';

/* What heads a models card, in front of the source's written name. */
const modelsLabelPrefix = 'Models ·';

/* One stat by key, or undefined. */
function statOf(source: TokenUsageSource, key: string): TokenUsageStat | undefined {
  return source.stats?.find((stat) => stat.key === key);
}

/* A stat's written figure, or the page's own unknown mark. A stat that is
 * absent and a stat whose value is null are the same claim — nobody reported
 * this — and they render identically, which is the honest-states floor at the
 * one place a card would otherwise be tempted to show a zero. */
function statFigure(stat: TokenUsageStat | undefined): string {
  return stat === undefined || stat.value === null
    ? unknownFigure
    : formatStatValue(stat.value, stat.unit);
}

/* A stat's value, or undefined for the same two reasons statFigure renders a
 * dash for. Separate from statFigure because arithmetic needs the number and
 * a card needs the words, and deriving one from the other would mean parsing
 * a rendered figure back into a count. */
function statValue(source: TokenUsageSource, key: string): number | undefined {
  const stat = statOf(source, key);
  return stat === undefined || stat.value === null ? undefined : stat.value;
}

/* ONE ruled line, or nothing at all. A term whose figure the payload does not
 * carry never becomes a row: the dash belongs to a card's HEADLINE, where a
 * reader is being told the card's whole subject went unmeasured, and a ladder
 * of dashes says that four times over while burying the rows that are true. */
function statFact(source: TokenUsageSource, key: string): LedgerFact | undefined {
  const stat = statOf(source, key);
  if (stat === undefined || stat.value === null) {
    return undefined;
  }
  return { key, term: categoryLabel(key), value: formatStatValue(stat.value, stat.unit) };
}

function present<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/* Each window the source reports, as its own ruled line: what went in and what
 * came out, in the page's word for that period. */
function windowFacts(source: TokenUsageSource): LedgerFact[] {
  return source.windows.map((window) => ({
    key: `window-${window.period}`,
    term: windowTerm(window.period),
    value: `${formatTokenCount(window.inputTokens)} in · ${formatTokenCount(window.outputTokens)} out`
  }));
}

/* The lines beside a source's lifetime figure: its current streak and its
 * longest single session, both from stats it reported. A source reporting
 * neither gets no sub-line rather than a column of dashes. */
function sourceSubline(source: TokenUsageSource): string[] {
  const lines: string[] = [];
  const streak = statValue(source, currentStreakKey);
  if (streak !== undefined) {
    lines.push(`${formatWhole(streak)}-day streak`);
  }
  const longest = statOf(source, longestSessionKey);
  if (longest !== undefined && longest.value !== null) {
    lines.push(`longest session ${formatStatValue(longest.value, longest.unit)}`);
  }
  return lines;
}

/* A source's current usage window, drawn as a meter under its figure. It is
 * the SAME reading the retired tile panel drew, through the same saturation
 * and the same severity thresholds — a window the payload reports has a real
 * utilization and a real reset, and dropping it with the squares would have
 * been the redesign quietly losing a capability rather than restyling one.
 *
 * A source reporting no window, or a window with no utilization, draws no
 * meter: a bar at zero and a bar for a figure nobody reported are the same
 * picture, and only one of them is true. */
function sourceMeter(source: TokenUsageSource): LedgerMeter | undefined {
  const window = source.windows.find((entry) => entry.utilizationPct !== undefined);
  if (window === undefined || window.utilizationPct === undefined) {
    return undefined;
  }
  const reset = resetsIn(window.resetsAt);
  return {
    fillPct: meterFillPct(window.utilizationPct),
    severity: meterSeverity(window.utilizationPct),
    reading: formatUtilization(window.utilizationPct),
    label: reset === '' ? window.period : `${window.period} · ${reset}`
  };
}

/* The accessible name of a daily line. The figures printed above it carry the
 * reading itself — that is the non-colour channel the dataviz floor asks for
 * — so the label says what the line IS and how much of it there is, rather
 * than re-reading values a screen reader would have to hold in its head. */
function dailyLineLabel(subject: string, days: number): string {
  return `${subject} daily tokens, ${days} ${days === 1 ? 'day' : 'days'}`;
}

/* One source's own daily line, or nothing when it reported no series. */
function sourceSpark(source: TokenUsageSource, subject: string): LedgerSpark | undefined {
  const series = source.series;
  if (series === undefined || series.totals.length === 0) {
    return undefined;
  }
  return { totals: series.totals, ariaLabel: dailyLineLabel(subject, series.totals.length) };
}

/* The lifetime total across every source that reported one. Undefined when no
 * source did — the total card then shows the dash, because a sum of nothing is
 * not zero tokens, it is no measurement. */
function lifetimeTotal(sources: readonly TokenUsageSource[]): number | undefined {
  let total: number | undefined;
  for (const source of sources) {
    const lifetime = statValue(source, lifetimeKey);
    if (lifetime === undefined) {
      continue;
    }
    total = (total ?? 0) + lifetime;
  }
  return total;
}

/* combinedSeries is the ONE line the total card draws, and the rule it
 * follows is the only honest one available: it covers the days EVERY
 * series-reporting source carries — the intersection of their windows — and
 * each day is the sum of their readings on it.
 *
 * A DAY ONE SOURCE LACKS CONTRIBUTES THAT SOURCE'S ABSENCE, NOT ZERO. Two
 * sources whose captures began a fortnight apart have a fortnight in which
 * only one of them can speak; adding the other in at zero would draw a
 * measured trough where the truth is that nobody was looking, and the drop
 * would land exactly where the older series starts. So the line stops at the
 * first day all of them carry and ends at the last — outside that span at
 * least one source is silent, and a sum with a silence in it is not a sum.
 *
 * A source with NO series at all is not part of the intersection: it never
 * narrows the window, because it has no window to narrow it with. That is the
 * same rule read from the other side — a source that says nothing about any
 * day cannot make a day unmeasurable — and it is what keeps the card drawing
 * a line at all when one source reports figures but no history. */
function combinedSeries(sources: readonly TokenUsageSource[]): number[] | undefined {
  const drawn: { start: number; totals: readonly number[] }[] = [];
  for (const source of sources) {
    const series = source.series;
    if (series === undefined || series.totals.length === 0) {
      continue;
    }
    const start = dayNumber(series.startDate);
    if (start === null) {
      return undefined;
    }
    drawn.push({ start, totals: series.totals });
  }
  if (drawn.length === 0) {
    return undefined;
  }
  const from = Math.max(...drawn.map((series) => series.start));
  const to = Math.min(...drawn.map((series) => series.start + series.totals.length - 1));
  if (to < from) {
    return undefined;
  }
  const totals: number[] = [];
  for (let day = from; day <= to; day += 1) {
    let sum = 0;
    for (const series of drawn) {
      sum += series.totals[day - series.start];
    }
    totals.push(sum);
  }
  return totals;
}

/* The lifetime split, as ONE ruled line: the sources that reported a lifetime,
 * named in wire order, against their shares of the sum.
 *
 * Built only when at least TWO sources reported one and the sum is positive.
 * One source's "100%" is the figure above it restated, and a share of a sum
 * of nothing is not zero percent — it is unknown, which is a different claim
 * and the one the dash is for. */
function splitFact(
  sources: readonly TokenUsageSource[],
  total: number | undefined
): LedgerFact | undefined {
  if (total === undefined || total <= 0) {
    return undefined;
  }
  const reported = sources
    .map((source) => ({ name: sourceName(source.label), lifetime: statValue(source, lifetimeKey) }))
    .filter((entry): entry is { name: string; lifetime: number } => entry.lifetime !== undefined);
  if (reported.length < 2) {
    return undefined;
  }
  return {
    key: 'split',
    term: reported.map((entry) => entry.name).join(' · '),
    value: reported.map((entry) => formatShare((entry.lifetime / total) * 100)).join(' · ')
  };
}

/* Card one: everything this page has ever counted, with the split under it and
 * the combined daily line along the bottom. */
function totalCard(sources: readonly TokenUsageSource[]): LedgerCard {
  const total = lifetimeTotal(sources);
  const figure = total === undefined ? unknownFigure : formatTokenCount(total);
  const split = splitFact(sources, total);
  const totals = combinedSeries(sources);
  return {
    key: 'tracked',
    label: totalCardLabel,
    ctx: lifetimeContext,
    figure,
    sub: total === undefined ? undefined : [formatWhole(total)],
    facts: split === undefined ? undefined : [split],
    factColumns: 1,
    spark:
      totals === undefined
        ? undefined
        : { totals, ariaLabel: dailyLineLabel(combinedLineSubject, totals.length) },
    note:
      total === undefined && split === undefined && totals === undefined
        ? boardEmptyNote
        : undefined,
    ariaLabel: `${totalCardLabel}, ${lifetimeContext}: ${figure}`
  };
}

/* Cards two and three, and any card a later source brings with it: ONE shape
 * rendered per source in wire order. Nothing here asks which source it is
 * reading — the name comes from the vocabulary, the classes and the windows
 * from whatever that source reported — so the card that draws a tool with
 * four accounting classes and the card that draws one with none are the same
 * function reading different data.
 *
 * EVERY SECOND SOURCE CARD OPENS INVERTED. It is the board's rhythm rather
 * than a fact about any source: the owner's board alternates ink and paper
 * across the top row, and stating it as "every other one" is what makes a
 * third source join that rhythm instead of needing a rule of its own. */
function sourceCard(source: TokenUsageSource, index: number): LedgerCard {
  const name = sourceName(source.label);
  const figure = statFigure(statOf(source, lifetimeKey));
  const facts = [
    ...classKeys.map((key) => statFact(source, key)).filter(present),
    ...windowFacts(source)
  ];
  const sub = sourceSubline(source);
  const spark = sourceSpark(source, name);
  const empty = figure === unknownFigure && facts.length === 0 && spark === undefined;
  return {
    key: `source-${source.label}`,
    label: name,
    figure,
    sub: sub.length === 0 ? undefined : sub,
    facts: facts.length === 0 ? undefined : facts,
    factColumns: 2,
    meter: sourceMeter(source),
    spark,
    note: empty ? tokenUsageSourceEmptyNote : undefined,
    turned: index % 2 === 1,
    ariaLabel: `${name} lifetime tokens: ${figure}`
  };
}

/* Card four: the session record, from the first source that keeps one.
 *
 * The current streak is marked when it HAS reached the longest — and the
 * longest is printed on the line directly above it, so the mark is the
 * redundant channel and a reader who sees no colour reads the same fact off
 * two equal numbers. */
function sessionsCard(sources: readonly TokenUsageSource[]): LedgerCard {
  const keeper =
    sources.find((source) => statOf(source, sessionsKey) !== undefined) ?? sources[0];
  const figure = statFigure(statOf(keeper, sessionsKey));
  const longest = statValue(keeper, longestStreakKey);
  const current = statOf(keeper, currentStreakKey);
  const facts = [
    statFact(keeper, longestSessionKey),
    statFact(keeper, longestStreakKey),
    current === undefined || current.value === null
      ? undefined
      : {
          key: currentStreakKey,
          term: categoryLabel(currentStreakKey),
          value: formatStatValue(current.value, current.unit),
          peak: longest !== undefined && current.value >= longest
        }
  ].filter(present);
  return {
    key: 'sessions',
    label: sessionsCardLabel,
    figure,
    facts: facts.length === 0 ? undefined : facts,
    factColumns: 1,
    note: figure === unknownFigure && facts.length === 0 ? tokenUsageSourceEmptyNote : undefined,
    ariaLabel: `${sessionsCardLabel}: ${figure}`
  };
}

/* One member's reading on a models card: how much it carried, and the
 * accounting behind that where the source reports it. */
type ModelReading = {
  readonly key: string;
  readonly total: number;
  readonly detail?: string;
};

/* A model's own total across the four accounting classes. */
function classTotal(totals: TokenUsageClassTotals): number {
  return classKeys.reduce((sum, key) => sum + totals[key], 0);
}

/* The row's accounting line: what went in, what came out, and the two cache
 * figures as a PAIR, because a reader compares cache read against cache write
 * rather than against either of the other two. */
function classDetail(totals: TokenUsageClassTotals): string {
  return [
    `in ${formatTokenCount(totals.input)}`,
    `out ${formatTokenCount(totals.output)}`,
    `cache ${formatTokenCount(totals['cache-read'])} / ${formatTokenCount(totals['cache-write'])}`
  ].join(' · ');
}

/* REAL MEMBERS ONLY, IN THE VOCABULARY'S ORDER.
 *
 * The residual is dropped because it is not an entity: it is the fold of every
 * identifier the vocabulary does not name, and a bar beside named models
 * would read as one more model. A member that carried NOTHING is dropped for
 * the opposite reason — it is a named entity that would be drawn at nought
 * beside entities that were actually used, which is a row saying something
 * the data never said.
 *
 * Dropping the empty rows is also what makes the bar arithmetic total: every
 * remaining member has a positive total, so the largest is positive, so no
 * row can be handed a share it would have to decline to draw. That is the
 * honest-states rule this used to carry as a nullable fill in the component,
 * decided once here instead. */
function realMembers(readings: readonly ModelReading[]): ModelReading[] {
  return readings
    .filter((reading) => reading.key !== modelResidual.key && reading.total > 0)
    .sort((first, second) => rankOf(first.key) - rankOf(second.key));
}

function rankOf(key: string): number {
  /* Admission refuses a key outside the vocabulary, so the fallback is
     unreachable; it exists so a vocabulary edit that forgets a member sorts it
     last rather than sorting it by NaN. */
  return modelRanks.get(key) ?? modelRanks.size;
}

/* Which readings one source can show, and how its rows are read.
 *
 * A source that reports its own LIFETIME accounting per model shows that: the
 * rows are shares of what it has ever spent, with the classes printed under
 * each. A source that reports only the daily model partition shows the window
 * that partition covers, summed per member, read as compact totals — because
 * a share of a window is a different quantity from a share of a lifetime, and
 * printing them in the same units on two neighbouring cards would invite
 * exactly the comparison that is false. */
function modelReadings(source: TokenUsageSource): ModelReading[] {
  const stats = source.modelStats;
  if (stats !== undefined && stats.length > 0) {
    return realMembers(
      stats.map((entry) => ({
        key: entry.key,
        total: classTotal(entry.totals),
        detail: classDetail(entry.totals)
      }))
    );
  }
  const shares = source.series === undefined ? [] : modelShares(source.series);
  return realMembers(shares.map((share) => ({ key: share.key, total: share.total })));
}

/* Cards five and six, and one per later source that carries a split: the SAME
 * shape as each other, headed by the source whose numbers they are. A source
 * with nothing to split renders no card at all rather than an empty one — the
 * board is the cards the payload can fill. */
function modelCard(source: TokenUsageSource): LedgerCard | undefined {
  const readings = modelReadings(source);
  if (readings.length === 0) {
    return undefined;
  }
  const name = sourceName(source.label);
  const measured = source.modelStats !== undefined && source.modelStats.length > 0;
  const largest = Math.max(...readings.map((reading) => reading.total));
  const grand = readings.reduce((sum, reading) => sum + reading.total, 0);
  const models: LedgerBar[] = readings.map((reading) => ({
    key: reading.key,
    label: modelLabel(reading.key),
    /* Against the LARGEST member, not against the sum: the rule is the same
       on both kinds of card, so the longest bar always runs the card's full
       width and the rest are read against it. The number beside each row is
       what says how much of the whole it was. */
    fillPct: (reading.total / largest) * 100,
    reading: measured
      ? formatShare((reading.total / grand) * 100)
      : formatTokenCount(reading.total),
    detail: reading.detail
  }));
  const label = `${modelsLabelPrefix} ${name}`;
  return {
    key: `models-${source.label}`,
    label,
    models,
    ariaLabel: `Model split for ${name}`
  };
}

/* tokenCards composes the board: the total, every source, the session record,
 * then every source's split. Row one of the owner's board is the first three
 * and row two the next three, which is the grid's own doing rather than a
 * layout this adapter states. */
export function tokenCards(sources: readonly TokenUsageSource[]): LedgerCard[] {
  if (sources.length === 0) {
    return [];
  }
  return [
    totalCard(sources),
    ...sources.map(sourceCard),
    sessionsCard(sources),
    ...sources.map(modelCard).filter(present)
  ];
}

/* tokenBoardProps renders the board as data, or null before the first
 * envelope arrives — the same loading face every panel-bound block has: the
 * host renders nothing for null rather than reserving a box for a payload it
 * cannot describe yet. */
export function tokenBoardProps(
  envelope: PanelEnvelope | null,
  now: Date = new Date()
): LedgerBoardProps | null {
  if (envelope === null) {
    return null;
  }
  const sources = tokenUsageSources(envelope.data);
  return {
    title: envelope.title || tokenUsageFallbackTitle,
    status: envelope.status,
    generatedAt: envelope.generatedAt,
    cards: tokenCards(sources),
    emptyNote: boardEmptyNote,
    staleNote: usageStaleNote(envelope.status, envelope.generatedAt, sources, now),
    turnLabel: boardTurnLabel,
    returnLabel: boardReturnLabel
  };
}
