/* Pure presentation logic for the token-usage panel, kept out of the component
 * so every rule here is unit-testable without a browser. The component renders
 * whatever these helpers return; it never computes, so a formatting or
 * admission bug is a one-file fix with a failing test beside it. */

import type {
  LedgerBar,
  LedgerBoardProps,
  LedgerFact,
  LedgerMeter,
  LedgerSquare
} from './blocks.ts';
import { addDays, formatMagnitude, formatWhole } from './grid.ts';
import { dayNumber, formatDateRange } from './periods.ts';
import { panelStaleAfterMs, panelStaleNote } from './panels.ts';
/* The model vocabulary is DATA and it lives in one file, outside this
   directory on purpose: the origin embeds the same bytes and the capture tool
   reads them, so no consumer keeps a copy that could disagree (issue #302).
   The container's frontend stage copies the file in beside VERSION, which is
   the precedent this follows. */
import modelVocabulary from '../../../internal/panels/config/models.json' with { type: 'json' };
import type {
  PanelEnvelope,
  PanelStatus,
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

/* How many rows ONE breakdown of a series may carry. The category bound is
 * the structural guard the Go boundary states as maxSeriesCategories; the
 * model bound is the model vocabulary's own size, exactly as maxSeriesModels
 * is, so a payload naming more model rows than the file has members is
 * refused before a single key is looked up. Neither can inflate the render
 * with hundreds of entries. */
const maxCategoryRows = 8;

/* maxModelDays bounds how many trailing days the model breakdown may cover —
 * the same ten-week budget the Go boundary enforces (maxModelDays in
 * internal/panels/types.go), mirrored here so a regression there still meets
 * a refusal before rendering. It was a quarter until the vocabulary gained
 * its second vendor group (issue #302): the section costs one integer per day
 * per member, and the shared payload ceiling is not a lever. The categories
 * breakdown carries no separate day bound on either side, exactly as in Go. */
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

/* Which vendor group a member belongs to, and the written heading that group
 * puts on its own block. The residual belongs to NO group — it is the fold
 * every source may carry — so it answers with the empty string and rides the
 * block of whichever group its source's named members sit in. */
const modelGroups: ReadonlyMap<string, string> = new Map(
  modelMembers.map((member): [string, string] => [member.key, member.group])
);

export function modelGroup(key: string): string {
  return modelGroups.get(key) ?? '';
}

const modelGroupLabels: ReadonlyMap<string, string> = new Map(
  modelVocabulary.groups.map((group): [string, string] => [group.key, group.label])
);

export function modelGroupLabel(group: string): string {
  return modelGroupLabels.get(group) ?? '';
}

/* How many rows a group's block RESERVES: its declared members plus the
 * residual, which any source may carry into it. The box a block holds is
 * sized from this rather than from the rows one envelope happens to bring,
 * so a later envelope with fewer members leaves the page exactly where it
 * was — the zero-CLS floor, stated where the count is known. */
export function modelGroupRows(group: string): number {
  const declared = modelVocabulary.groups.find((entry) => entry.key === group);
  return declared === undefined ? 0 : declared.members.length + 1;
}

/* The vendor groups in the file's own order, which is the order their blocks
 * are rendered in. */
const modelGroupKeys: readonly string[] = modelVocabulary.groups.map((group) => group.key);

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

/* modelBlocks answers which proportions this source actually shows, and whose
 * models they are.
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
 * The rows inherit the SERIES' provenance rather than claiming none: the
 * sealed push is an out-of-band capture, so a measured share is a recorded
 * figure exactly as the tiles beside it are, and it says so through the same
 * marking rule instead of borrowing a freshness the envelope did not
 * promise. */
/* One rendered model block: the bars of one vendor group as read from one
 * source, the heading that group puts on them, and the rows its box reserves. */
type ModelBlock = {
  readonly label: string;
  readonly ariaLabel: string;
  readonly bars: LedgerBar[];
  readonly rows: number;
};

function modelBlocks(source: TokenUsageSource): ModelBlock[] {
  const shares = source.series ? modelShares(source.series) : [];
  if (shares.length === 0) {
    /* No model partition — an older document, a source that does not report
       one, or a live fetch that never carried one. The frozen snapshot
       insights are then what this source can say, and they belong to no
       vendor group, so the block is headed by the source that reported them
       rather than by a group it is not a partition of. */
    const insights = source.insights ?? [];
    return insights.length === 0
      ? []
      : [
          {
            label: `Models · ${source.label}`,
            ariaLabel: `Model shares for ${source.label}`,
            bars: insights.map(insightBar),
            rows: insights.length
          }
        ];
  }
  /* One block per vendor GROUP, headed by the group's own written name from
     the vocabulary file — never by the source's operator-typed label, which
     names where the numbers were captured rather than whose models they
     measure (issue #302). A source whose members all sit in one group renders
     one block; a source that ever carries two groups' members renders one
     block each, in the file's order.

     The residual belongs to no group, so it rides the FIRST group present:
     it is the fold of what that source could not attribute, and splitting it
     across blocks would double-count it. A payload whose only member IS the
     residual renders nothing at all — a block saying "all of it was
     something we cannot name" is the aggregate above it with extra steps. */
  const groupOfShare = (share: CategoryShare): string => modelGroup(share.key);
  const present = modelGroupKeys.filter((group) =>
    shares.some((share) => groupOfShare(share) === group)
  );
  const recorded = source.series?.recorded === true;
  return present.map((group, index) => {
    const carried = shares.filter(
      (share) => groupOfShare(share) === group || (index === 0 && groupOfShare(share) === '')
    );
    return {
      label: `Models · ${modelGroupLabel(group)}`,
      ariaLabel: `Model shares for ${modelGroupLabel(group)}`,
      bars: carried.map((share) =>
        insightBar({ label: modelLabel(share.key), pct: share.pct, recorded })
      ),
      rows: modelGroupRows(group)
    };
  });
}

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
 * The board of squares (owner directive, 2026-09-03, issue 287)
 *
 * The tile grid became five turnable squares: a total, one per reported
 * source, the model split, and the session record. Every figure on every face
 * comes from a stat the payload actually carried, through the same formatter
 * the tiles used, and a stat the payload does not carry renders as the dash it
 * has always rendered as — never a zero, and never a hidden square.
 *
 * THE SQUARES ARE DERIVED FROM THE SOURCES, not enumerated. A payload
 * reporting one source produces one source square; a third source appearing
 * tomorrow produces a third, with no edit here and none in the component. What
 * IS enumerated is the stat vocabulary — the keys the origin serves — because
 * that is payload data this adapter is allowed to know and the component is
 * not.
 * ------------------------------------------------------------------------ */

/* The stat keys each square claims, so no figure is shown twice on the board.
 * Written as data rather than as a chain of conditionals: the origin's own
 * key vocabulary (internal/panels), read here and nowhere else. */
const lifetimeKey = 'lifetime';
const peakDayKey = 'peak-day';
const currentStreakKey = 'current-streak';
const sessionKeys: readonly string[] = [
  'sessions',
  'active-days',
  'tracked-days',
  'longest-streak',
  'longest-task'
];

export const boardTurnLabel = 'Turn';
export const boardReturnLabel = 'Turn back';
export const boardEmptyNote = tokenUsageEmptyNote;

/* One stat by key, or undefined. */
function statOf(source: TokenUsageSource, key: string): TokenUsageStat | undefined {
  return source.stats?.find((stat) => stat.key === key);
}

/* A stat's written figure, or the page's own unknown mark. A stat that is
 * absent and a stat whose value is null are the same claim — nobody reported
 * this — and they render identically, which is the honest-states floor at the
 * one place a square would otherwise be tempted to show a zero. */
function statFigure(stat: TokenUsageStat | undefined): string {
  return stat === undefined || stat.value === null ? unknownFigure : formatStatValue(stat.value, stat.unit);
}

/* The facts a square's back lists.
 *
 * A source whose series carries the per-day CATEGORY breakdown shows that: how
 * its tokens divide across input, output and the two cache classes, each with
 * its own count and share and its own fixed palette swatch. It is the retired
 * composition strip in the ledger's grammar — same categoryShares, same fixed
 * slots, same rule that identity rides the printed label rather than the
 * colour — and it is what the owner's drawing asks the source squares to turn
 * over to.
 *
 * A source with no breakdown falls back to whichever stats the front and the
 * other squares did not already claim, so a payload that reports only stat
 * tiles still turns over to something true. */
function backFacts(source: TokenUsageSource): LedgerFact[] {
  const shares = source.series ? categoryShares(source.series) : [];
  if (shares.length > 0) {
    return shares.map((share) => ({
      key: share.key,
      term: categoryLabel(share.key),
      value: `${formatTokenCount(share.total)} · ${formatShare(share.pct)}`,
      slot: categorySlot(share.key)
    }));
  }
  const claimed = new Set<string>([lifetimeKey, peakDayKey, currentStreakKey, ...sessionKeys]);
  return (source.stats ?? [])
    .filter((stat) => !claimed.has(stat.key))
    .map((stat) => ({ key: stat.key, term: stat.label, value: statFigure(stat) }));
}

/* One proportion as a bar. The same row the tiles' insight region drew, at
 * the same saturation, so the board and the retired panel would have said the
 * identical thing. */
function insightBar(insight: TokenUsageInsight): LedgerBar {
  return {
    key: insight.label,
    label: insight.label,
    fillPct: insight.pct === null ? null : meterFillPct(insight.pct),
    reading: formatShare(insight.pct)
  };
}

/* The sub-line under a source's lifetime figure: its current streak and its
 * biggest single day, both from stats it reported. A source reporting neither
 * gets no sub-line rather than a sentence full of dashes. */
function sourceSubline(source: TokenUsageSource): string | undefined {
  const streak = statOf(source, currentStreakKey);
  const peak = statOf(source, peakDayKey);
  const parts: string[] = [];
  if (streak !== undefined && streak.value !== null) {
    parts.push(`${formatWhole(streak.value)}-day streak`);
  }
  if (peak !== undefined && peak.value !== null) {
    parts.push(`peak ${formatStatValue(peak.value, peak.unit)}`);
  }
  return parts.length === 0 ? undefined : parts.join(' · ');
}

/* A source's current usage window, drawn as a meter under its figure. It is
 * the SAME reading the retired tile panel drew, through the same saturation
 * and the same severity thresholds — a window the payload reports has a real
 * utilization and a real reset, and dropping it with the tiles would have been
 * the redesign quietly losing a capability rather than restyling one.
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

/* The lifetime total across every source that reported one. Undefined when no
 * source did — the total square then shows the dash, because a sum of nothing
 * is not zero tokens, it is no measurement. */
function lifetimeTotal(sources: readonly TokenUsageSource[]): number | undefined {
  let total: number | undefined;
  for (const source of sources) {
    const stat = statOf(source, lifetimeKey);
    if (stat === undefined || stat.value === null) {
      continue;
    }
    total = (total ?? 0) + stat.value;
  }
  return total;
}

export function tokenSquares(sources: readonly TokenUsageSource[]): LedgerSquare[] {
  if (sources.length === 0) {
    return [];
  }
  const total = lifetimeTotal(sources);
  const squares: LedgerSquare[] = [
    {
      key: 'tracked',
      label: 'Tokens tracked',
      figure: total === undefined ? unknownFigure : formatTokenCount(total),
      sub: 'all sources · lifetime',
      ariaLabel: `Tokens tracked, all sources, lifetime: ${total === undefined ? unknownFigure : formatTokenCount(total)}`,
      back: {
        label: 'By source',
        facts: sources.map((source) => ({
          key: source.label,
          term: source.label,
          value: statFigure(statOf(source, lifetimeKey))
        }))
      }
    }
  ];
  for (const source of sources) {
    const figure = statFigure(statOf(source, lifetimeKey));
    const sub = sourceSubline(source);
    const facts = backFacts(source);
    squares.push({
      key: `source-${source.label}`,
      label: source.label,
      figure,
      meter: sourceMeter(source),
      sub,
      ariaLabel: `${source.label} lifetime tokens: ${figure}`,
      back: {
        label: `${source.label} breakdown`,
        facts: facts.length > 0 ? facts : undefined,
        note: facts.length > 0 ? undefined : tokenUsageSourceEmptyNote
      }
    });
  }
  /* The model split: every source's blocks in order, two to a square — one on
     the front and one behind it. Two blocks is what the payload carries today
     (one vendor group per source) and the shape survives either way: an odd
     last block turns to its own empty note, and a fifth block would take its
     own square rather than being silently dropped. */
  const blocks = sources.flatMap(modelBlocks);
  for (let index = 0; index < blocks.length; index += 2) {
    const front = blocks[index];
    const back = blocks[index + 1];
    squares.push({
      key: index === 0 ? 'models' : `models-${index / 2 + 1}`,
      label: front.label,
      bars: front.bars,
      barRows: front.rows,
      ariaLabel: front.ariaLabel,
      back:
        back === undefined
          ? { label: 'Models', note: tokenUsageSourceEmptyNote }
          : { label: back.label, bars: back.bars, barRows: back.rows }
    });
  }
  /* The session record, from the first source that keeps one. */
  const keeper = sources.find((source) => statOf(source, 'sessions') !== undefined) ?? sources[0];
  const sessions = statFigure(statOf(keeper, 'sessions'));
  squares.push({
    key: 'sessions',
    label: 'Sessions',
    figure: sessions,
    ariaLabel: `Sessions: ${sessions}`,
    back: {
      label: 'Records',
      facts: [
        {
          key: 'longest-task',
          term: statOf(keeper, 'longest-task')?.label ?? 'Longest session',
          value: statFigure(statOf(keeper, 'longest-task'))
        },
        {
          key: 'longest-streak',
          term: statOf(keeper, 'longest-streak')?.label ?? 'Longest streak',
          value: statFigure(statOf(keeper, 'longest-streak'))
        }
      ]
    }
  });
  return squares;
}

/* tokenSquaresProps renders the board as data, or null before the first
 * envelope arrives — the same loading face every panel-bound block has: the
 * host renders nothing for null rather than reserving a box for a payload it
 * cannot describe yet. */
export function tokenSquaresProps(
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
    squares: tokenSquares(sources),
    emptyNote: boardEmptyNote,
    staleNote: usageStaleNote(envelope.status, envelope.generatedAt, sources, now),
    turnLabel: boardTurnLabel,
    returnLabel: boardReturnLabel
  };
}
