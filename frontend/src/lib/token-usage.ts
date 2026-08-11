/* Pure presentation logic for the token-usage panel, kept out of the component
 * so every rule here is unit-testable without a browser. The component renders
 * whatever these helpers return; it never computes, so a formatting or
 * admission bug is a one-file fix with a failing test beside it. */

import type { TokenUsageSource, TokenUsageWindow } from './panels';

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

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/* tokenUsageSources is the component's admission gate, mirroring the strict
 * decode doctrine the origin applies before serving: only the exact
 * token-usage/v1 payload shape is rendered, and any malformed corner — a
 * non-string label, a negative count, a numberless window — refuses the whole
 * payload so the panel shows its honest empty state instead of fake numbers.
 * Source labels pass through as data; nothing here knows a vendor. */
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
    const windows: TokenUsageWindow[] = [];
    for (const entry of candidate.windows) {
      if (!isRecord(entry) || typeof entry.period !== 'string' || entry.period === '') {
        return [];
      }
      if (!isCount(entry.inputTokens) || !isCount(entry.outputTokens)) {
        return [];
      }
      if (entry.utilizationPct !== undefined && !isCount(entry.utilizationPct)) {
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
    sources.push({ label: candidate.label, windows });
  }
  return sources;
}
