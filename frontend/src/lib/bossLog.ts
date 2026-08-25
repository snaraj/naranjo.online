/* Pure presentation logic for the boss log, kept out of the component so the
 * two renderings that carry real meaning — a null tally and an unranked row —
 * are plain functions a node test can execute, rather than string patterns a
 * structural pin can only claim to have found.
 *
 * Both nullable fields mirror the boss-log/v1 contract in
 * internal/panels/types.go: the hiscores legitimately return no figure, and
 * null is data that must survive the round trip. */

import type { StatGrid, StatTrackerProps } from './blocks.ts';
import { bossInitials, bossSlug, skillSlug } from './bossIcons.ts';
import { formatWhole } from './grid.ts';
import type { BossLogData, BossLogEntry, BossLogSkill, PanelEnvelope } from './panels';
import type { TipDetail } from './tooltip.ts';

/* The registry identifier the stats block loads; the one place the id is
 * spelled on the frontend. */
export const bossLogPanelId = 'boss-log';

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

/* The hiscores' first row is the account total, and it is named like a skill
 * without being one: its "level" is the sum of every level, its xp the sum of
 * every xp, its rank the overall rank. It is identified by the same slug rule
 * the icon files are named by (an overall.png already ships), so this file
 * spells the name once and matches it the way every other row is matched. */
const overallRowSlug = 'overall';

/* One cell of the skills grid that is a total rather than a skill. */
export interface SkillSummaryCell {
  /* Stable key for the keyed each block; never rendered. */
  key: string;
  /* The short label the cell shows, sized to fit the narrowest column. */
  label: string;
  /* The full name the accessible label and tooltip carry. */
  name: string;
  /* The rendered figure, through the same nullable renderers as every
   * other cell — a total the hiscores do not report says so. */
  value: string;
}

/* skillSummary is the answer to the grid's trailing gap. Twenty-five skills
 * in three columns leave the last row two cells short, and two blank tiles at
 * the end of a dense table read as missing data rather than as the end of the
 * table. The account's own totals fill them: Total XP and overall Rank, both
 * already in the payload's Overall row and neither shown anywhere else — the
 * grid renders that row's LEVEL and drops its other two figures.
 *
 * Nothing is invented to fill a hole: a payload with no Overall row returns
 * no cells and the gap simply comes back, which is the honest outcome and a
 * loud one — a paired test fails the moment the row count and the cell count
 * stop tiling the grid, so an upstream that adds a skill is a conscious edit
 * here rather than a blank tile in production. */
export function skillSummary(skills: BossLogSkill[]): SkillSummaryCell[] {
  const overall = skills.find((skill) => skillSlug(skill.name) === overallRowSlug);
  if (!overall) {
    return [];
  }
  return [
    { key: 'total-xp', label: 'XP', name: 'Total XP', value: tally(overall.xp) },
    { key: 'overall-rank', label: 'Rank', name: 'Overall rank', value: rankLabel(overall.rank) }
  ];
}

/* summaryLabel is the accessible text one total carries: the short visible
 * label is what fits a 320px column, and the full name is what a reader who
 * cannot see the grid it sits in needs. */
export function summaryLabel(cell: SkillSummaryCell): string {
  return `${cell.name}: ${cell.value}`;
}

/* The three detail builders. They exist so the two grids cannot drift into
 * two presentations of the same idea: each returns the SAME shape — a name
 * and a list of labelled rows — which lib/components/DetailTip.svelte renders
 * identically, so "the skill detail looks like the boss detail" is a property
 * of the data rather than of two style blocks somebody kept in step.
 *
 * They are also where the nullable hiscore fields are decided ONE more time
 * rather than one more way: every figure goes through tally and rankLabel
 * above, so an unreported number reads "--" in the detail exactly as it does
 * in the tile and in the accessible name.
 *
 * Row names and values are DATA all the way to the DOM — the primitive
 * interpolates them as text — so nothing here escapes anything, and nothing
 * needs to. */
export function bossDetail(boss: BossLogEntry): TipDetail {
  const rows = [
    { label: 'KC', value: tally(boss.kc) },
    { label: 'Rank', value: rankLabel(boss.rank) }
  ];
  if (boss.score !== undefined && boss.score !== null) {
    rows.push({ label: 'Score', value: tally(boss.score) });
  }
  return { name: boss.name, rows };
}

export function skillDetail(skill: BossLogSkill): TipDetail {
  const rows = [
    { label: 'Level', value: tally(skill.level) },
    { label: 'Rank', value: rankLabel(skill.rank) }
  ];
  /* xp is optional on the payload rather than nullable, so a row the
     hiscores never sent gets no line at all — the same rule the boss score
     follows, and the reason both are the last row rather than the middle. */
  if (skill.xp !== undefined && skill.xp !== null) {
    rows.push({ label: 'XP', value: tally(skill.xp) });
  }
  return { name: skill.name, rows };
}

/* The totals cell carries one figure, and the SHORT label it shows in a
 * 320px column is the one that names it here — the full name is the detail's
 * heading, which is exactly the room the tile did not have. */
export function summaryDetail(cell: SkillSummaryCell): TipDetail {
  return { name: cell.name, rows: [{ label: cell.label, value: cell.value }] };
}

/* ---------------------------------------------------------------------------
 * The adapter (issue 165): boss-log envelope in, StatTracker props out. This
 * is where the game becomes rows in a generic grid — every name, figure and
 * detail below rides a domain-free field, and the component that renders the
 * result knows none of this file.
 * ------------------------------------------------------------------------ */

/* The icon URLs the adapter draws from, keyed by the same slug rule the icon
 * files are named by. The maps are built by the binding module
 * (lib/blocks/osrsStats.ts), because content-hashed asset URLs come from the
 * bundler and this module stays executable under plain node. */
export interface StatIconSet {
  /* Icons for the compact levels grid (assets/icons/skills). */
  readonly levels: ReadonlyMap<string, string>;
  /* Icons for the roomy tallies grid (assets/icons/bosses). */
  readonly tallies: ReadonlyMap<string, string>;
}

/* The shell heading before any envelope arrives; afterwards the ORIGIN's own
 * title rides the envelope, exactly as it always has. */
export const bossLogFallbackTitle = 'Old School RuneScape Stats';

/* The three honest non-data states, verbatim from the retired component. */
export const bossLogLoadingNote = 'Loading the boss log.';
export const bossLogUnavailableNote = 'Boss data is unavailable right now.';
export const bossLogEmptySkillsNote = 'No skill levels reported.';

/* osrsStatsProps renders the whole panel as data:
 *
 *   no envelope yet   -> the fallback title over the loading note;
 *   envelope, no data -> the envelope's own title over the unavailable note;
 *   data              -> the compact levels grid (icon, level, the two totals
 *                        closing the last row) and the roomy tallies grid, in
 *                        the RuneLite arrangement the owner asked for.
 *
 * The levels grid carries an emptyNote and the tallies grid deliberately does
 * NOT: a payload without skills says so in words, while a payload without
 * bosses renders the empty table it always rendered — same two shapes the
 * retired component drew, decided by the same data. Unranked rows arrive
 * muted (true or false, so the tallies grid always states the distinction);
 * the levels grid never sets the flag, because the hiscores rank skills too
 * and the retired grid never drew that state — an attribute would claim a
 * distinction the rendering does not make. */
export function osrsStatsProps(envelope: PanelEnvelope | null, icons: StatIconSet): StatTrackerProps {
  if (envelope === null) {
    return { title: bossLogFallbackTitle, status: 'unavailable', grids: [], note: bossLogLoadingNote };
  }
  /* The registry id names the kind, the same trust the retired mount
   * expressed through watchPanel's type parameter. */
  const data = (envelope.data ?? undefined) as BossLogData | undefined;
  if (!data) {
    return {
      title: envelope.title,
      status: envelope.status,
      generatedAt: envelope.generatedAt,
      grids: [],
      note: bossLogUnavailableNote
    };
  }
  const skills = data.skills ?? [];
  const levels: StatGrid = {
    key: 'levels',
    label: 'Skill levels',
    size: 'compact',
    emptyNote: bossLogEmptySkillsNote,
    cells: skills.map((skill) => ({
      key: skill.name,
      icon: icons.levels.get(skillSlug(skill.name)),
      glyph: bossInitials(skill.name),
      figure: tally(skill.level),
      label: skillLabel(skill),
      detail: skillDetail(skill)
    })),
    closing: skillSummary(skills).map((cell) => ({
      key: cell.key,
      caption: cell.label,
      figure: cell.value,
      label: summaryLabel(cell),
      detail: summaryDetail(cell)
    }))
  };
  const tallies: StatGrid = {
    key: 'tallies',
    label: 'Boss tallies',
    size: 'roomy',
    cells: data.bosses.map((boss) => ({
      key: boss.name,
      icon: icons.tallies.get(bossSlug(boss.name)),
      glyph: bossInitials(boss.name),
      figure: tally(boss.kc),
      label: cellLabel(boss),
      detail: bossDetail(boss),
      muted: boss.rank === null
    }))
  };
  return {
    title: envelope.title,
    status: envelope.status,
    generatedAt: envelope.generatedAt,
    grids: [levels, tallies]
  };
}
