/* Pure presentation logic for the token-usage panel, kept out of the component
 * so every rule here is unit-testable without a browser. The component renders
 * whatever these helpers return; it never computes, so a formatting or
 * admission bug is a one-file fix with a failing test beside it. */

import type {
  TokenStatUnit,
  TokenUsageCategory,
  TokenUsageInsight,
  TokenUsageSeries,
  TokenUsageSource,
  TokenUsageStat,
  TokenUsageWindow
} from './panels';

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
 * comma-grouped digits below ten thousand, then one-decimal K, M, and B steps
 * with a trailing .0 trimmed — 1284 renders "1,284", 12900 renders "12.9K",
 * 9421770 renders "9.4M". Counts are non-negative by admission below. */
export function formatTokenCount(count: number): string {
  if (count < 10_000) {
    return groupThousands(Math.round(count));
  }
  const steps: Array<[number, string]> = [
    [1_000, 'K'],
    [1_000_000, 'M'],
    [1_000_000_000, 'B']
  ];
  let index = 0;
  while (index + 1 < steps.length && count >= steps[index + 1][0]) {
    index += 1;
  }
  let scaled = Math.round((count / steps[index][0]) * 10) / 10;
  /* A figure that rounds to 1000 of its own unit reads better one unit up:
   * 999,950 is "1M", never "1000K". */
  if (scaled >= 1000 && index + 1 < steps.length) {
    index += 1;
    scaled = Math.round((count / steps[index][0]) * 10) / 10;
  }
  return `${scaled}${steps[index][1]}`;
}

/* groupThousands inserts comma separators by hand so the output is identical
 * in every runtime locale — a formatted figure is part of the tested contract
 * and must never depend on the visitor's environment. */
function groupThousands(value: number): string {
  const digits = String(value);
  let grouped = '';
  for (let index = 0; index < digits.length; index += 1) {
    const fromEnd = digits.length - index;
    if (index > 0 && fromEnd % 3 === 0) {
      grouped += ',';
    }
    grouped += digits[index];
  }
  return grouped;
}

/* resetsIn renders a window's resetsAt as the same coarse relative language
 * panelAge uses for freshness — a glance, not a clock. Absent, malformed, and
 * already-passed instants all render as nothing: the status badge already
 * carries staleness, and inventing "resets in 0m" would be a fake number. */
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
 * The countBound export below pins the shared ceiling so the parity test can
 * compare it against the Go and Python constants by value. */
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
    return '--';
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
       17,069 compacted to "17.1K" loses the figure the tile exists to show. */
    return groupThousands(Math.round(value));
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

/* maxCategories bounds how many categories one series may carry — the same
 * bound the Go boundary enforces (maxSeriesCategories in
 * internal/panels/types.go). The closed vocabulary below is already tighter;
 * this is the structural guard that still holds if the vocabulary is ever
 * widened, so a payload can never inflate the render with hundreds of
 * entries. */
const maxCategories = 8;

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
  const series: TokenUsageSeries = { startDate: value.startDate, totals };
  if (value.categories !== undefined) {
    const categories = admitCategories(value.categories, totals);
    if (categories === null) {
      return null;
    }
    if (categories.length > 0) {
      series.categories = categories;
    }
  }
  return series;
}

/* admitCategories validates the optional per-day breakdown against the SAME
 * three rules the Go boundary applies, not a weaker shape check
 * (2026-08-24 security review, finding 6):
 *
 *   1. CLOSED MEMBERSHIP. A key must be one of the canonical accounting
 *      classes — the keys categorySlots declares, which is the frontend's
 *      single statement of the vocabulary and is pinned against the capture
 *      tool and the Go admission list by CategoryVocabularyParityTest. The
 *      previous check was a label SHAPE (`/^[a-z][a-z0-9-]{0,31}$/`), and
 *      shape admits far more than the vocabulary does: `private-feature` is
 *      perfectly label-shaped, and categoryLabel would have humanized it
 *      into public copy. The origin blocks such a payload today, so this is
 *      defense in depth — which is exactly what it must be, because the
 *      claim that hostile keys cannot reach rendering has to survive a
 *      future boundary regression rather than depend on one.
 *   2. COUNT. At most maxCategories entries, and no key twice.
 *   3. PARTITION. The categories must sum to the day's own total on EVERY
 *      day, so the stacked reading and the plain reading cannot disagree.
 *      A breakdown that says something different from the graph above it is
 *      not a smaller error than a missing one.
 *
 * Any failing corner refuses the whole payload rather than rendering a
 * half-true breakdown. */
function admitCategories(value: unknown, totals: number[]): TokenUsageCategory[] | null {
  if (!Array.isArray(value) || value.length > maxCategories) {
    return null;
  }
  const days = totals.length;
  const seen = new Set<string>();
  const categories: TokenUsageCategory[] = [];
  const sums = new Array<number>(days).fill(0);
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.key !== 'string' || !categorySlots.has(entry.key)) {
      return null;
    }
    if (seen.has(entry.key)) {
      return null;
    }
    seen.add(entry.key);
    if (!Array.isArray(entry.totals) || entry.totals.length !== days || !entry.totals.every(isCount)) {
      return null;
    }
    const dailies = entry.totals as number[];
    for (let day = 0; day < days; day += 1) {
      /* CHECKED summation, the frontend end of finding 9's one numeric
       * contract. Go refuses an int64 category sum that overflows and
       * Python refuses a counter past MAX_COUNT; here the hazard is
       * different in kind but identical in effect. JavaScript addition
       * does not overflow — it silently stops being exact, so eight
       * admissible categories can sum past 2^53-1 and land on a number
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
    categories.push({ key: entry.key, totals: dailies });
  }
  if (categories.length > 0) {
    for (let day = 0; day < days; day += 1) {
      if (sums[day] !== totals[day]) {
        return null;
      }
    }
  }
  return categories;
}

/* categoryLabel renders a category key as display copy: hyphens become
 * spaces and nothing else changes, so the shown word list is exactly the
 * data's vocabulary in the panel's own lowercase voice. */
export function categoryLabel(key: string): string {
  return key.replace(/-/g, ' ');
}

/* The category lens: 'total' reads the series as ever; a category key reads
 * that category's own dailies through the same grid. */
export const totalLens = 'total';

/* lensValues resolves the active lens to the dailies the grid should draw.
 * An unknown lens — a category that source does not report — falls back to
 * the plain series, which is always real data, never a guess. */
export function lensValues(series: TokenUsageSeries, lens: string): number[] {
  if (lens !== totalLens && series.categories) {
    for (const category of series.categories) {
      if (category.key === lens) {
        return category.totals;
      }
    }
  }
  return series.totals;
}

export interface CategoryShare {
  key: string;
  /* The category's total across the whole series window. */
  total: number;
  /* Its share of the window's grand total, in percent (0 when the window is
   * empty); shares are computed from the same integers the grid draws, so
   * the bar and the numbers can never disagree. */
  pct: number;
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
      pct: grand > 0 ? (total / grand) * 100 : 0
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
