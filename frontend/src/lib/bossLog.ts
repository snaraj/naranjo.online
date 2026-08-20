/* Pure presentation logic for the boss log, kept out of the component so the
 * two renderings that carry real meaning — a null tally and an unranked row —
 * are plain functions a node test can execute, rather than string patterns a
 * structural pin can only claim to have found.
 *
 * Both nullable fields mirror the boss-log/v1 contract in
 * internal/panels/types.go: the hiscores legitimately return no figure, and
 * null is data that must survive the round trip. */

import { formatWhole } from './grid.ts';
import type { BossLogEntry, BossLogSkill } from './panels';

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

/* skillLabel is the same contract for a skill cell: the level a sighted
 * reader sees is one number in a dense grid, so the accessible text carries
 * the whole row — including the nulls the hiscores legitimately report. */
export function skillLabel(skill: BossLogSkill): string {
  const parts = [`${skill.name}: level ${tally(skill.level)}`, `rank ${rankLabel(skill.rank)}`];
  if (skill.xp !== undefined && skill.xp !== null) {
    parts.push(`${tally(skill.xp)} xp`);
  }
  return parts.join(', ');
}

/* panelSummary is the rail's subtitle: the account name plus what the payload
 * actually contains. It counts the rows served rather than any number this
 * file knows, so an upstream that adds a skill or a boss is reported, and an
 * empty section says zero instead of quietly disappearing. */
export function panelSummary(account: string, skills: number, bosses: number): string {
  return `${account} · ${formatWhole(skills)} skills · ${formatWhole(bosses)} bosses`;
}
