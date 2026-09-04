/* Pure presentation logic for the boss log, kept out of the component so the
 * two renderings that carry real meaning — a null tally and an unranked row —
 * are plain functions a node test can execute, rather than string patterns a
 * structural pin can only claim to have found.
 *
 * Both nullable fields mirror the boss-log/v1 contract in
 * internal/panels/types.go: the hiscores legitimately return no figure, and
 * null is data that must survive the round trip. */

import type { TickerItem, TickerProps } from './blocks.ts';
import { bossInitials, bossSlug } from './bossIcons.ts';
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

/* The icon URLs the adapter draws from, keyed by the same slug rule the icon
 * files are named by. The map is built by the binding module
 * (lib/blocks/bossTicker.ts), because content-hashed asset URLs come from the
 * bundler and this module stays executable under plain node. */
export type BossIconSet = ReadonlyMap<string, string>;

/* The shell heading before any envelope arrives; afterwards the ORIGIN's own
 * title rides the envelope, exactly as it always has.
 *
 * It lost the word "Stats" with the levels grid the owner cut (2026-09-03,
 * issue 287), which is also what the origin's own served title dropped in the
 * same change (SPEC §8.16, internal/panels/config). The two are still separate
 * strings for a reason — this one is the page's own word for a panel that has
 * not answered, and the origin's is data — but a fallback that named a surface
 * nobody renders any more, and disagreed with the served title while doing it,
 * was neither. */
export const bossLogFallbackTitle = 'Old School RuneScape';

/* The two honest non-data states, verbatim from the retired component. The
 * third — the empty-skills line — left with the skills grid the owner cut
 * (2026-09-03, issue 287): a note about a surface nothing renders is a
 * sentence nobody can reach. */
export const bossLogLoadingNote = 'Loading the boss log.';
export const bossLogUnavailableNote = 'Boss data is unavailable right now.';

/* ---------------------------------------------------------------------------
 * The ticker (owner directive, 2026-09-03, issue 287)
 *
 * The three-column tally grid became one scrolling strip: every boss the
 * hiscores list, most-killed first, each an icon and its count. The grid's
 * whole contract survives the move, item for item — the icon is the same
 * vendored thumbnail keyed by the same slug, an unmapped row still falls back
 * to its initials, every figure still goes through `tally` so an unreported
 * one reads "--" rather than "0", and every item still carries the same
 * `bossDetail` through the same one hover-detail primitive.
 *
 * Two things are new and both are the owner's. The strip's LEAD carries the
 * collection's own name — which is envelope data, the origin's served title,
 * never a string in this tree — with the totals beside it. And the largest
 * count in the strip is marked as the peak, which is the page's one highlight;
 * a count of zero is dimmed rather than dropped, because a boss the hiscores
 * list with nothing against it is information the grid always showed.
 *
 * The account is still never read. It is not in this file, it is not in the
 * lead line, and it is not in any accessible name.
 * ------------------------------------------------------------------------ */

/* The Jagex Fan Content Policy notice, word for word from ATTRIBUTION.md.
 * It travels with the artwork: the icons are Jagex intellectual property used
 * as fan content, so wherever they render this renders under them. It is DATA
 * on the props rather than a string in the component for the same reason every
 * other word on this page is — but it is also the one string here that may
 * never be paraphrased, and a frontend test compares it byte for byte with the
 * document it is quoted from. */
export const bossLogFanContentNotice =
  "Created using intellectual property belonging to Jagex Limited under the terms of Jagex's Fan Content Policy. This content is not endorsed by or affiliated with Jagex.";

export const bossLogEmptyBossesNote = 'No boss kills reported.';

/* The strip's accessible name. */
export const bossLogStripLabel = 'Boss kill counts, most killed first';

/* The lead line: how many of the listed bosses have ever been fought, out of
 * how many the hiscores list, and the total kills across them. Every one of
 * the three is counted from the payload's own rows — an unreported count is
 * neither fought nor added, which is what keeps "fought" a claim the data
 * supports rather than a row count. */
export function bossTotalsLine(bosses: readonly BossLogEntry[]): string {
  let fought = 0;
  let kills = 0;
  for (const boss of bosses) {
    if (boss.kc === null || boss.kc === undefined || boss.kc <= 0) {
      continue;
    }
    fought += 1;
    kills += boss.kc;
  }
  return `${formatWhole(fought)} of ${formatWhole(bosses.length)} bosses fought · ${formatWhole(kills)} kills`;
}

/* The strip's order: most killed first, then by name, so a redraw of the same
 * payload is byte-identical and two bosses on the same count do not swap
 * places between renders. An unreported count sorts as the absence it is —
 * last, with the zeroes. */
function killCount(boss: BossLogEntry): number {
  return boss.kc === null || boss.kc === undefined ? -1 : boss.kc;
}

export function bossTickerItems(
  bosses: readonly BossLogEntry[],
  icons: ReadonlyMap<string, string>
): TickerItem[] {
  const ordered = bosses
    .slice()
    .sort((left, right) => killCount(right) - killCount(left) || left.name.localeCompare(right.name));
  const peak = ordered.reduce((largest, boss) => Math.max(largest, killCount(boss)), 0);
  return ordered.map((boss) => {
    const count = killCount(boss);
    const item: TickerItem = {
      key: boss.name,
      icon: icons.get(bossSlug(boss.name)),
      glyph: bossInitials(boss.name),
      figure: tally(boss.kc),
      label: cellLabel(boss),
      detail: bossDetail(boss),
      /* The peak is only a peak when something was actually killed: a strip
         of unreported rows has no maximum to mark. */
      peak: peak > 0 && count === peak,
      quiet: count <= 0
    };
    return item;
  });
}

/* bossTickerProps renders the strip as data, in the same three faces the grid
 * had: no envelope yet, an envelope with no payload, and a payload. */
export function bossTickerProps(envelope: PanelEnvelope | null, icons: BossIconSet): TickerProps {
  const base = {
    lead: '',
    items: [] as TickerItem[],
    notice: bossLogFanContentNotice,
    label: bossLogStripLabel
  };
  if (envelope === null) {
    return {
      ...base,
      title: bossLogFallbackTitle,
      status: 'unavailable',
      emptyNote: bossLogLoadingNote
    };
  }
  const data = (envelope.data ?? undefined) as BossLogData | undefined;
  if (!data) {
    return {
      ...base,
      title: envelope.title || bossLogFallbackTitle,
      status: envelope.status,
      generatedAt: envelope.generatedAt,
      emptyNote: bossLogUnavailableNote
    };
  }
  return {
    ...base,
    title: envelope.title || bossLogFallbackTitle,
    status: envelope.status,
    generatedAt: envelope.generatedAt,
    lead: bossTotalsLine(data.bosses),
    items: bossTickerItems(data.bosses, icons),
    emptyNote: bossLogEmptyBossesNote
  };
}
