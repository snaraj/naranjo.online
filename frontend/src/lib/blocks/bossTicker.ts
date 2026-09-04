/* The boss-log block (issue 165): the generic Ticker bound to the boss-log
 * panel through its adapter in lib/bossLog.ts. This module is the binding
 * layer — the ONE place the component, the panel id and the adapter meet — so
 * the domain lives here and in the adapter, never in the component.
 *
 * The icon map is built HERE because import.meta.glob is the bundler's: the
 * files under assets/icons become content-hashed URLs at build time, and a
 * module that calls the glob cannot run under plain node — which is why the
 * adapter beside the data takes the map as an argument instead of building it.
 * Keyed by slug: the row lists stay data, adding an icon is a file drop, and
 * no boss name exists in this map's source. Only icons already vendored under
 * the Jagex Fan Content Policy notice are used; a row without one renders a
 * clean initials tile rather than reaching for new art.
 *
 * The skills half is gone (owner directive, 2026-09-03, issue 287: the owner
 * cut the skills grid). The skill icons went with it — ATTRIBUTION.md records
 * why, and re-vendoring them is a glob and an adapter here rather than a
 * component change, the day a skills surface returns. */

import { panelBlock, type PageBlock } from '../blocks.ts';
import { bossLogPanelId, bossTickerProps, type BossIconSet } from '../bossLog.ts';
import Ticker from '../components/Ticker.svelte';

function iconMap(files: Record<string, string>): Map<string, string> {
  const icons = new Map<string, string>();
  for (const [path, url] of Object.entries(files)) {
    const file = path.split('/').at(-1) ?? '';
    icons.set(file.replace(/\.png$/, ''), url);
  }
  return icons;
}

const icons: BossIconSet = iconMap(
  import.meta.glob('../../assets/icons/bosses/*.png', {
    eager: true,
    query: '?url',
    import: 'default'
  }) as Record<string, string>
);

export const bossTicker: PageBlock = panelBlock('boss-ticker', Ticker, bossLogPanelId, (envelope) =>
  bossTickerProps(envelope, icons)
);
