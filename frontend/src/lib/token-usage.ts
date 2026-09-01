/* Pure presentation logic for the token-usage panel, kept out of the component
 * so every rule here is unit-testable without a browser. The component renders
 * whatever these helpers return; it never computes, so a formatting or
 * admission bug is a one-file fix with a failing test beside it. */

import type {
  UsageCategory,
  UsageCompositionRow,
  UsageSection,
  UsageTrackerProps,
  UsageWindow
} from './blocks.ts';
import { addDays, formatMagnitude, formatWhole } from './grid.ts';
import { dayNumber, formatDateRange } from './periods.ts';
import type {
  PanelEnvelope,
  TokenStatUnit,
  TokenUsageCategory,
  TokenUsageInsight,
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
 * comma-grouped digits below ten thousand, then one-decimal K, M, B and T
 * steps with a trailing .0 trimmed — 1284 renders "1,284", 12900 renders
 * "12.9K", 9421770 renders "9.4M". Counts are non-negative by admission below.
 *
 * The arithmetic moved to lib/grid.ts's formatMagnitude (owner directive,
 * 2026-08-25), and this is now the panel's name for it rather than a second
 * implementation. It had one already: the heatmap under this panel's own
 * summary line rendered its cells with exact digits, so the same day's usage
 * read "7.7B tokens over 15 days" in the sentence and "627,742,457" in the
 * tooltip above it. One function, called from both places, is what makes
 * those two readings the same reading. */
export function formatTokenCount(count: number): string {
  return formatMagnitude(count);
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

/* provenanceIsMixed decides whether a source needs per-figure provenance
 * marks at all, and it is the whole of the answer to a real reading problem:
 * every tile and every insight carried a "recorded" suffix, which came to
 * about a hundred repetitions on one screen, all of them saying the same
 * thing. The owner's instruction was blunt — obviously it is, remove it.
 *
 * What the marker is FOR is distinguishing figures, and a label that appears
 * on every figure distinguishes none of them. So the rule becomes: mark by
 * exception. A source whose figures all share one provenance says nothing per
 * figure, because there is nothing to tell apart — the panel's own status
 * already carries where the payload came from. A source whose figures DISAGREE
 * marks the recorded ones, because those are the figures that would otherwise
 * borrow the freshness of the live ones beside them, which is exactly the
 * borrowing the panel doctrine forbids.
 *
 * That mixed state is not hypothetical: it is what mergeUsagePayload produces
 * the moment a refresh succeeds, overlaying live tiles onto the recorded ones
 * a usage API cannot report. The marker appears precisely when it earns its
 * space, and the provenance data itself is untouched in the payload. */
export function provenanceIsMixed(source: TokenUsageSource): boolean {
  const figures: Array<{ recorded?: boolean }> = [...(source.stats ?? []), ...(source.insights ?? [])];
  return (
    figures.some((figure) => figure.recorded === true) &&
    figures.some((figure) => figure.recorded !== true)
  );
}

/* tokenUsageSources is the component's admission gate, mirroring the strict
 * decode doctrine the origin applies before serving: only the exact
 * token-usage/v1 payload shape is rendered, and any malformed corner — a
 * non-string label, a negative count, a numberless window, a stat in a unit
 * this file cannot format — refuses the whole payload so the panel shows its
 * honest empty state instead of fake numbers. Source labels pass through as
 * data; nothing here knows a vendor. The stat, series, and insight sections
 * are optional: a payload written before they existed is still admitted, an
 * absent section simply does not render. */
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

/* maxBreakdownRows bounds how many rows ONE breakdown of a series may carry —
 * the same bound the Go boundary enforces for both of them
 * (maxSeriesCategories and maxSeriesModels in internal/panels/types.go, equal
 * by design). The closed vocabularies below are already tighter; this is the
 * structural guard that still holds if one is ever widened, so a payload can
 * never inflate the render with hundreds of entries. */
const maxBreakdownRows = 8;

/* maxModelDays bounds how many trailing days the model breakdown may cover —
 * the same 92-day budget the Go boundary enforces (maxModelDays in
 * internal/panels/types.go), mirrored here so a regression there still meets
 * a refusal before rendering. The categories breakdown carries no separate
 * day bound on either side, exactly as in Go. */
const maxModelDays = 92;

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
    const categories = admitBreakdown(value.categories, totals, value.startDate, categorySlots);
    if (categories === null) {
      return null;
    }
    if (categories.length > 0) {
      series.categories = categories;
    }
  }
  if (value.models !== undefined) {
    const models = admitBreakdown(value.models, totals, value.startDate, modelSlots, maxModelDays);
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
 *   2. COUNT. At most maxBreakdownRows entries, and no key twice.
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
 * ONE function, TWO vocabularies. Categories and models differ in nothing but
 * which vocabulary admits a key, so they share this admission rather than
 * growing two implementations of the same five rules — the identical shape
 * the Go boundary took for the identical reason.
 *
 * Any failing corner refuses the whole payload rather than rendering a
 * half-true breakdown. */
function admitBreakdown(
  value: unknown,
  totals: number[],
  seriesStart: string,
  vocabulary: ReadonlyMap<string, number>,
  maxDays = 0
): TokenUsageCategory[] | null {
  if (!Array.isArray(value) || value.length > maxBreakdownRows) {
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

/* categoryLabel renders a category key as display copy: hyphens become
 * spaces and nothing else changes, so the shown word list is exactly the
 * data's vocabulary in the panel's own lowercase voice. */
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
 * mark rather than three. */
export const unknownFigure = '--';

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

/* modelSlots is the frontend's single statement of the CLOSED MODEL
 * vocabulary, and the fixed palette slot each member owns — the same two jobs
 * categorySlots does, for the second partition of the same series (issue
 * #170). It is pinned against the capture tool's MODEL_KEYS and the Go
 * modelServeOrder by ModelVocabularyParityTest in scripts/ci, so adding a
 * model is one deliberate edit made in three places together.
 *
 * The order is the canonical serve order, and `other` leads it because it is
 * the RESIDUAL: the producer folds an identifier it does not recognize into
 * it and counts the fold, so a vendor renaming a model mid-flight loses the
 * split for those tokens rather than losing the tokens. Admission here is
 * still by MEMBERSHIP — a key outside this map refuses the whole payload —
 * because the fold happens at capture, where the raw identifier is, and a
 * document arriving with an unknown key has not been through it. */
const modelSlots: ReadonlyMap<string, number> = new Map([
  ['other', 1],
  ['fable-5', 2],
  ['opus-5', 3],
  ['sonnet-5', 4],
  ['opus-4-8', 5]
]);

export function modelSlot(key: string): number {
  return modelSlots.get(key) ?? 0;
}

/* modelLabels is display copy, and the reason it is a table rather than a
 * transformation: a model's written name is not derivable from its key. The
 * category labels are (hyphens become spaces, and "cache read" is right), but
 * `opus-4-8` humanizes to "opus 4 8", which is not the product's name. The
 * keys stay machine-shaped on the wire — the producer's emission guard admits
 * only lowercase label shapes, so "Opus 4.8" could never travel as a key —
 * and the written form is resolved here, at the one place that renders.
 *
 * A key the map does not know cannot reach this function: admission refuses
 * a model outside the vocabulary, and the two lists are the same list. The
 * fallback exists so a future vocabulary edit that forgets a label degrades
 * to the key rather than to `undefined` in the reader's face. */
const modelLabels: ReadonlyMap<string, string> = new Map([
  ['other', 'Other'],
  ['fable-5', 'Fable 5'],
  ['opus-5', 'Opus 5'],
  ['sonnet-5', 'Sonnet 5'],
  ['opus-4-8', 'Opus 4.8']
]);

export function modelLabel(key: string): string {
  return modelLabels.get(key) ?? key;
}

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

/* usageSection shapes one admitted source. Provenance marks are decided here
 * by EXCEPTION (provenanceIsMixed above): a source whose figures all share
 * one provenance marks none of them, and a mixed source marks exactly the
 * recorded ones. The activity region exists only when there is a series with
 * days in it — a heading and a lens toggle over nothing is the hole the
 * owner's 2026-08-24 ruling removed — and the summary sentence is built here,
 * lens-independent, because it describes the one daily series every lens
 * re-reads. */
function usageWindowProps(entry: TokenUsageWindow): UsageWindow {
  const meter =
    entry.utilizationPct === undefined
      ? undefined
      : {
          fillPct: meterFillPct(entry.utilizationPct),
          severity: meterSeverity(entry.utilizationPct),
          reading: formatUtilization(entry.utilizationPct)
        };
  return {
    period: entry.period,
    reset: resetsIn(entry.resetsAt),
    meter,
    /* The words became glyphs on the visible row (owner directive,
       2026-08-31) — the label survives as each pair's clipped accessible
       word, so a reader hears "input 5.4B" where the eye reads the arrow. */
    pairs: [
      { key: 'in', glyph: 'flow-in', label: 'input', figure: formatTokenCount(entry.inputTokens) },
      { key: 'out', glyph: 'flow-out', label: 'output', figure: formatTokenCount(entry.outputTokens) }
    ],
    /* The one place an EXACT figure survives (owner directive, 2026-08-25):
       the pair row above is compacted, and this is the tooltip a reader opens
       when the compaction is not enough. Grouped rather than raw — it used to
       render nine undelimited digits, which is a log line, not a figure. */
    pairsLabel: `${formatWhole(entry.inputTokens)} input tokens, ${formatWhole(entry.outputTokens)} output tokens`
  };
}

function usageSection(source: TokenUsageSource): UsageSection {
  /* The rendered insight set is resolved BEFORE provenance is, because the
     two are the same question asked in the right order: what figures does
     this section show, and do they come from one place? Deriving the rows
     first means a live-derived set is weighed by provenanceIsMixed exactly
     as a served one is, instead of the marks being decided against figures
     that were then replaced. */
  const insights = renderedInsights(source);
  const mixed = provenanceIsMixed({ ...source, insights });
  const activity =
    source.series && source.series.totals.length > 0
      ? {
          heading: 'Token activity',
          label: `${source.label} token activity`,
          noun: tokenActivityNoun,
          series: { startDate: source.series.startDate, totals: source.series.totals },
          categories: usageCategories(source.series),
          composition: usageComposition(source.series)
        }
      : undefined;
  return {
    key: source.label,
    label: source.label,
    sublabel: source.account || undefined,
    tiles:
      source.stats && source.stats.length > 0
        ? source.stats.map((stat) => ({
            key: stat.key,
            figure: formatStatValue(stat.value, stat.unit),
            label: stat.label,
            marked: mixed && stat.recorded === true
          }))
        : undefined,
    note:
      source.windows.length === 0 && (!source.stats || source.stats.length === 0)
        ? tokenUsageSourceEmptyNote
        : undefined,
    windows: source.windows.length > 0 ? source.windows.map(usageWindowProps) : undefined,
    activity,
    insights:
      insights.length > 0
        ? {
            heading: insightsHeading,
            note: insightsNote(source.series),
            rows: insights.map((insight) => ({
              key: insight.label,
              label: insight.label,
              marked: mixed && insight.recorded === true,
              /* A null draws NO bar rather than a zero-width one: a
                 zero-width fill is visually identical to a measured zero,
                 which is the exact confusion this change exists to remove. */
              fillPct: insight.pct === null ? null : meterFillPct(insight.pct),
              reading: formatShare(insight.pct)
            }))
          }
        : undefined
  };
}

const insightsHeading = 'Activity insights';

/* renderedInsights answers which proportions this section actually shows.
 *
 * The panel has always had an insights row, and until the series carried a
 * MODEL partition those proportions could only be release-time figures frozen
 * into the shipped snapshot: true when the snapshot was cut, and quietly
 * ageing from then on. The v2 models section measures the same division from
 * the same days the graph above draws, so when it is present it is what the
 * rows report, and the frozen set becomes the documented fallback for a
 * payload that has no model partition — an older document, a source that does
 * not report one, or a live fetch that never carried one.
 *
 * The derived rows inherit the SERIES' provenance rather than claiming none:
 * the sealed push is an out-of-band capture, so a derived share is a recorded
 * figure exactly as the tiles beside it are, and it says so through the same
 * marking rule instead of borrowing a freshness the envelope did not
 * promise. */
function renderedInsights(source: TokenUsageSource): TokenUsageInsight[] {
  const shares = source.series ? modelShares(source.series) : [];
  if (shares.length > 0) {
    return shares.map((share) => ({
      label: modelLabel(share.key),
      pct: share.pct,
      recorded: source.series?.recorded === true
    }));
  }
  return source.insights ?? [];
}

/* insightsNote states the DAYS the derived proportions were measured over,
 * and exists because they are measured over a window rather than over the
 * whole series: the model partition costs one integer per day per model, so
 * the origin serves a declared trailing window of it. A percentage whose
 * range is unstated invites the reader to assume the widest one, which is the
 * assumption most likely to be wrong here.
 *
 * Absent for the frozen fallback set, which is not measured over any window
 * this panel can name — a range invented for it would be exactly the
 * borrowed freshness the doctrine forbids. */
function insightsNote(series: TokenUsageSeries | undefined): string | undefined {
  if (!series || !series.models || series.models.length === 0) {
    return undefined;
  }
  const first = series.models[0].startDate ?? series.startDate;
  const last = addDays(series.startDate, series.totals.length - 1);
  const range = formatDateRange(first, last);
  return range === '' ? undefined : `share of tokens · ${range}`;
}

/* The sentence under the activity strip used to be built HERE, over the whole
 * series, and it moved to lib/periods.ts (issue 158) rather than growing a
 * second copy. The reason is the window control the strip now carries: an
 * adapter cannot see which trailing window a reader has chosen, so a sentence
 * written here would go on describing the whole capture while the graph above
 * it drew ninety days — the panel's own doctrine ("a figure says where it
 * came from") failing at the sentence level. periods.ts' activityReading
 * builds it from the cells actually drawn, in this adapter's own noun and
 * figure format, and the component renders that.
 *
 * That applies to the CATEGORY lens (issue #142) identically, and composing
 * the two is what settled it: a per-category sentence built here would have
 * been wrong in exactly the same way, one lens later. So a category carries
 * its own NOUN rather than its own sentence, activityReading pluralizes and
 * measures it from the same drawn cells, and the panel has one reading
 * implementation rather than one per lens.
 *
 * tokenActivityNoun is stated once for the same reason: the region's noun and
 * every category's noun phrase are built from it, so they cannot drift.
 */
const tokenActivityNoun = 'token';

/* usageCategories shapes the admitted per-day breakdown into the component's
 * category lens options: key, display label, the fixed palette slot the
 * entity owns, the dailies the lens draws, and the singular noun its reading
 * uses — all data, so the component names no category and formats no figure.
 * Undefined when the series carries no breakdown, so a source without
 * categories renders no lens row at all.
 *
 * The dailies are the served category's own, read directly. There is no
 * resolver step between the two: the served order IS the lens vocabulary the
 * component offers, and the component's own `activeLensCategory` does the one
 * lookup anybody performs — by key, over exactly this list, falling back to
 * the plain series for the total sentinel, for a series with no breakdown, and
 * for a stale key naming a category this source does not report. */
function usageCategories(series: TokenUsageSeries): UsageCategory[] | undefined {
  if (!series.categories || series.categories.length === 0) {
    return undefined;
  }
  return series.categories.map((category) => ({
    key: category.key,
    label: categoryLabel(category.key),
    slot: categorySlot(category.key),
    totals: category.totals,
    noun: `${categoryLabel(category.key)} ${tokenActivityNoun}`
  }));
}

/* usageComposition shapes the composition strip's rows from categoryShares:
 * the bar weight is the category's own series total — the same integers the
 * grid draws — and the written figure and tooltip carry the count and share,
 * so identity is never color alone. */
function usageComposition(series: TokenUsageSeries): UsageCompositionRow[] | undefined {
  const shares = categoryShares(series);
  if (shares.length === 0) {
    return undefined;
  }
  return shares.map((share) => ({
    key: share.key,
    label: categoryLabel(share.key),
    slot: categorySlot(share.key),
    weight: share.total,
    figure: `${formatTokenCount(share.total)} · ${formatShare(share.pct)}`,
    tooltip: `${categoryLabel(share.key)}: ${formatTokenCount(share.total)} tokens (${formatShare(share.pct)})`
  }));
}

/* tokenUsageProps renders the whole panel as data, or null before the first
 * envelope arrives — the retired component rendered nothing until then, and
 * the block host renders nothing for null, so the page's honest loading face
 * is unchanged. */
export function tokenUsageProps(envelope: PanelEnvelope | null): UsageTrackerProps | null {
  if (envelope === null) {
    return null;
  }
  return {
    id: tokenUsagePanelId,
    title: envelope.title || tokenUsageFallbackTitle,
    status: envelope.status,
    generatedAt: envelope.generatedAt,
    sections: tokenUsageSources(envelope.data).map(usageSection),
    emptyNote: tokenUsageEmptyNote
  };
}
