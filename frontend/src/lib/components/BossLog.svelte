<!-- BossLog renders the boss-log/v1 panel the RuneLite way: a dense
  three-column grid, each cell an icon beside a right-aligned kill count,
  "--" wherever the hiscores carry null, and a hover/focus tooltip with the
  full name, rank, and score. Every boss shown arrives as API data through
  lib/panels.ts; the only name-shaped logic here is the slug lookup from a
  data name into the shipped icon files, and an unknown name falls back to
  an initials glyph. Cells have fixed dimensions and icons declare their box
  and load lazily, so nothing shifts as data or images arrive. -->
<script lang="ts">
  import PanelShell from './PanelShell.svelte';
  import { loadPanel } from '../panels';
  import type { BossLogData, BossLogEntry, PanelEnvelope } from '../panels';
  import { bossInitials, bossSlug } from '../bossIcons';

  /* The icon files under assets/icons/bosses become content-hashed URLs at
     build time. Keyed by slug: the boss list stays data, adding an icon is
     a file drop, and no boss name exists in this map's source. */
  const iconFiles = import.meta.glob('../../assets/icons/bosses/*.png', {
    eager: true,
    query: '?url',
    import: 'default'
  }) as Record<string, string>;
  const icons = new Map<string, string>();
  for (const [path, url] of Object.entries(iconFiles)) {
    const file = path.split('/').at(-1) ?? '';
    icons.set(file.replace(/\.png$/, ''), url);
  }

  let envelope = $state<PanelEnvelope<BossLogData> | undefined>();

  $effect(() => {
    let cancelled = false;
    void loadPanel<BossLogData>('boss-log').then((loaded) => {
      if (!cancelled) {
        envelope = loaded;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  const data = $derived(envelope?.data ?? undefined);

  /* tally renders a nullable hiscore number the RuneLite way: null is real
     data meaning unranked, shown as "--". */
  function tally(value: number | null | undefined): string {
    return value === null || value === undefined ? '--' : String(value);
  }

  function cellLabel(boss: BossLogEntry): string {
    const parts = [`${boss.name}: ${tally(boss.kc)} KC`, `rank ${tally(boss.rank)}`];
    if (boss.score !== undefined && boss.score !== null) {
      parts.push(`score ${tally(boss.score)}`);
    }
    return parts.join(', ');
  }
</script>

<PanelShell
  title={envelope?.title ?? 'Boss log'}
  status={envelope?.status ?? 'unavailable'}
  generatedAt={envelope?.generatedAt}
>
  {#if data}
    <p class="boss-account">{data.account}</p>
    <ul class="boss-grid">
      {#each data.bosses as boss (boss.name)}
        <!-- Cells take keyboard focus solely so the tooltip's :focus-visible
          reveal matches its :hover reveal; there is no action to perform, so
          a button would be the wrong semantics. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <li class="boss-cell" tabindex="0" aria-label={cellLabel(boss)}>
          {#if icons.has(bossSlug(boss.name))}
            <img
              class="boss-icon"
              src={icons.get(bossSlug(boss.name))}
              alt=""
              width="26"
              height="26"
              loading="lazy"
              decoding="async"
            />
          {:else}
            <span class="boss-icon boss-glyph" aria-hidden="true">{bossInitials(boss.name)}</span>
          {/if}
          <span class="boss-kc">{tally(boss.kc)}</span>
          <span class="boss-tip" role="tooltip" aria-hidden="true">
            <span class="boss-tip-name">{boss.name}</span>
            <span>KC: {tally(boss.kc)}</span>
            <span>Rank: {tally(boss.rank)}</span>
            {#if boss.score !== undefined && boss.score !== null}
              <span>Score: {tally(boss.score)}</span>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  {:else if envelope}
    <p class="boss-note">Boss data is unavailable right now.</p>
  {:else}
    <p class="boss-note">Loading the boss log.</p>
  {/if}
</PanelShell>

<style>
  .boss-account {
    margin: 0 0 0.375rem;
    font-size: 0.75rem;
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .boss-grid {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    background: var(--panel-border, rgb(23, 23, 23));
    border: 1px solid var(--panel-border, rgb(23, 23, 23));
  }

  .boss-cell {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    block-size: 2.125rem;
    padding-inline: 0.25rem;
    background: var(--panel-surface, rgb(40, 40, 40));
  }

  .boss-cell:focus-visible {
    outline: 1px solid var(--panel-accent, rgb(220, 138, 0));
    outline-offset: -1px;
  }

  .boss-icon {
    flex: none;
    inline-size: 26px;
    block-size: 26px;
    object-fit: contain;
  }

  .boss-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.625rem;
    font-weight: 650;
    color: var(--panel-accent, rgb(220, 138, 0));
    border: 1px solid var(--panel-border, rgb(23, 23, 23));
    border-radius: 3px;
  }

  .boss-kc {
    flex: 1;
    min-inline-size: 0;
    text-align: right;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .boss-tip {
    position: absolute;
    inset-block-end: calc(100% + 0.25rem);
    inset-inline-start: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-inline-size: 9rem;
    padding: 0.375rem 0.5rem;
    background: var(--panel-tip-surface, rgb(23, 23, 23));
    border: 1px solid var(--panel-border, rgb(23, 23, 23));
    border-radius: 3px;
    font-size: 0.6875rem;
    color: var(--panel-text, rgb(230, 230, 230));
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
  }

  .boss-cell:hover .boss-tip,
  .boss-cell:focus-visible .boss-tip {
    visibility: visible;
    opacity: 1;
  }

  .boss-tip-name {
    font-weight: 650;
    color: var(--panel-accent, rgb(220, 138, 0));
  }

  .boss-note {
    margin: 0;
    font-size: 0.75rem;
    color: var(--panel-muted, rgb(158, 158, 158));
  }
</style>
