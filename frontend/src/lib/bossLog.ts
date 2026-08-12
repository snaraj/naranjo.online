/* Pure presentation logic for the boss log, kept out of the component so the
 * two renderings that carry real meaning — a null tally and an unranked row —
 * are plain functions a node test can execute, rather than string patterns a
 * structural pin can only claim to have found.
 *
 * Both nullable fields mirror the boss-log/v1 contract in
 * internal/panels/types.go: the hiscores legitimately return no figure, and
 * null is data that must survive the round trip. */

import { formatWhole } from './grid.ts';
import type { BossLogEntry } from './panels';

/* The rendering for a figure the hiscores do not report. It is deliberately
 * NOT "0": zero kills and no reported figure are different claims, and a
 * panel that conflates them invents data. */
export const noTally = '--';

/* The rendering for an account below the hiscores' listing threshold. The
 * account genuinely has no rank there — that is information a reader wants,
 * so it is said in words rather than dashed away. */
export const unrankedLabel = 'Unranked';

/* tally renders a nullable hiscore figure: a real number grouped for
 * readability, and null as the explicit no-figure marker. */
export function tally(value: number | null | undefined): string {
  return value === null || value === undefined ? noTally : formatWhole(value);
}

/* rankLabel renders a nullable hiscore rank, saying "unranked" in words. */
export function rankLabel(rank: number | null | undefined): string {
  return rank === null || rank === undefined ? unrankedLabel : formatWhole(rank);
}

/* cellLabel is the accessible text one tile carries, so a tile's meaning
 * never depends on reading its number alone. */
export function cellLabel(boss: BossLogEntry): string {
  const parts = [`${boss.name}: ${tally(boss.kc)} KC`, `rank ${rankLabel(boss.rank)}`];
  if (boss.score !== undefined && boss.score !== null) {
    parts.push(`score ${tally(boss.score)}`);
  }
  return parts.join(', ');
}
