/* The game-stats block (issue 165): the generic StatTracker bound to the
 * boss-log panel through its adapter in lib/bossLog.ts. This module is the
 * binding layer — the ONE place the component, the panel id and the adapter
 * meet — so the domain lives here and in the adapter, never in the component.
 *
 * The icon maps are built HERE because import.meta.glob is the bundler's:
 * the files under assets/icons become content-hashed URLs at build time, and
 * a module that calls the glob cannot run under plain node — which is why
 * the adapter beside the data takes the maps as an argument instead of
 * building them. Keyed by slug: the row lists stay data, adding an icon is a
 * file drop, and no boss or skill name exists in these maps' source. Only
 * icons already vendored under the Jagex Fan Content Policy notice are used;
 * a row without one renders a clean initials tile rather than reaching for
 * new art. */

import { panelBlock, type PageBlock } from '../blocks.ts';
import { bossLogPanelId, osrsStatsProps, type StatIconSet } from '../bossLog.ts';
import StatTracker from '../components/StatTracker.svelte';

function iconMap(files: Record<string, string>): Map<string, string> {
  const icons = new Map<string, string>();
  for (const [path, url] of Object.entries(files)) {
    const file = path.split('/').at(-1) ?? '';
    icons.set(file.replace(/\.png$/, ''), url);
  }
  return icons;
}

const icons: StatIconSet = {
  levels: iconMap(
    import.meta.glob('../../assets/icons/skills/*.png', {
      eager: true,
      query: '?url',
      import: 'default'
    }) as Record<string, string>
  ),
  tallies: iconMap(
    import.meta.glob('../../assets/icons/bosses/*.png', {
      eager: true,
      query: '?url',
      import: 'default'
    }) as Record<string, string>
  )
};

export const osrsStats: PageBlock = panelBlock('osrs-stats', StatTracker, bossLogPanelId, (envelope) =>
  osrsStatsProps(envelope, icons)
);
