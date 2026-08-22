<!-- BossLog renders the boss-log/v1 panel as the account's whole public record,
  laid out the way the RuneLite hiscore panel lays one out: a dense grid of
  skill cells first — small icon, right-aligned level — then the boss tallies
  below, each an icon beside a right-aligned, thousands-separated kill count
  with a hover/focus detail carrying the full name, the rank, and the score.
  The origin serves EVERY row the hiscores report — twenty-five skills and
  dozens of bosses — so the boss region is bounded and scrolls inside itself
  rather than growing its card past everything stacked below it.

  Every row shown arrives as API data through lib/panels.ts; the only
  name-shaped logic here is the slug lookup from a data name into the shipped
  icon files. Only icons already vendored under the Jagex Fan Content Policy
  notice are used, and a row without one renders a clean initials tile rather
  than reaching for new art.

  "Unranked" is real information, not a gap: the hiscores rank an account
  only once it clears a threshold, so a null rank means unranked while the
  figure beside it may still be genuine. Cells have fixed dimensions and icons
  declare their box and load lazily, so nothing shifts as data or images
  arrive. -->
<script lang="ts">
  import PanelShell from './PanelShell.svelte';
  import { watchPanel } from '../panels';
  import type { BossLogData, PanelEnvelope } from '../panels';
  import { bossInitials, bossSlug, skillSlug } from '../bossIcons';
  import { cellLabel, panelSummary, rankLabel, skillLabel, tally } from '../bossLog.ts';

  /* The icon files under assets/icons become content-hashed URLs at build
     time. Keyed by slug: the row lists stay data, adding an icon is a file
     drop, and no boss or skill name exists in these maps' source. */
  function iconMap(files: Record<string, string>): Map<string, string> {
    const icons = new Map<string, string>();
    for (const [path, url] of Object.entries(files)) {
      const file = path.split('/').at(-1) ?? '';
      icons.set(file.replace(/\.png$/, ''), url);
    }
    return icons;
  }

  const icons = iconMap(
    import.meta.glob('../../assets/icons/bosses/*.png', {
      eager: true,
      query: '?url',
      import: 'default'
    }) as Record<string, string>
  );
  const skillIcons = iconMap(
    import.meta.glob('../../assets/icons/skills/*.png', {
      eager: true,
      query: '?url',
      import: 'default'
    }) as Record<string, string>
  );

  let envelope = $state<PanelEnvelope<BossLogData> | undefined>();

  $effect(() => {
    return watchPanel<BossLogData>('boss-log', (loaded) => (envelope = loaded));
  });

  const data = $derived(envelope?.data ?? undefined);
  const skills = $derived(data?.skills ?? []);

  /* tally, rankLabel, cellLabel, skillLabel, and panelSummary live in
     lib/bossLog.ts: a null tally and an unranked row are the two renderings
     that carry real meaning here, and they are executed by tests there rather
     than pattern-matched in this file's source. */
</script>

<PanelShell
  title={envelope?.title ?? 'Old School RuneScape Stats'}
  status={envelope?.status ?? 'unavailable'}
  generatedAt={envelope?.generatedAt}

>
  {#if data}
    <p class="boss-account">{panelSummary(data.account, skills.length, data.bosses.length)}</p>
    {#if skills.length > 0}
      <ul class="skill-grid" aria-label={`${data.account} skill levels`}>
        {#each skills as skill (skill.name)}
          <li class="skill-cell" aria-label={skillLabel(skill)} title={skillLabel(skill)}>
            {#if skillIcons.has(skillSlug(skill.name))}
              <img
                class="skill-icon"
                src={skillIcons.get(skillSlug(skill.name))}
                alt=""
                width="18"
                height="18"
                loading="lazy"
                decoding="async"
              />
            {:else}
              <span class="skill-icon boss-glyph" aria-hidden="true">{bossInitials(skill.name)}</span>
            {/if}
            <span class="skill-level">{tally(skill.level)}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="boss-note">No skill levels reported.</p>
    {/if}
    <!-- The complete boss table is dozens of tiles, so the grid is bounded and
      scrolls inside its own box; a scrollable region is keyboard-reachable
      only when focusable, so the tabindex is deliberate. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <ul class="boss-grid" tabindex="0" aria-label={`${data.account} boss tallies`}>
      {#each data.bosses as boss (boss.name)}
        <!-- Cells take keyboard focus solely so the tooltip's :focus-visible
          reveal matches its :hover reveal; there is no action to perform, so
          a button would be the wrong semantics. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <li
          class="boss-cell"
          tabindex="0"
          data-boss-unranked={boss.rank === null ? 'true' : 'false'}
          aria-label={cellLabel(boss)}
        >
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
            <span>Rank: {rankLabel(boss.rank)}</span>
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
    margin: 0;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  /* Both tables share the RuneLite cell chrome: a hairline gap over the
     border color reads as a grid rule without a border per cell. */
  .skill-grid,
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

  /* The skills table is a fixed nine rows of three and never scrolls: it is
     the top of the panel and its size is known before any data arrives, so
     the card's geometry is identical before and after the payload lands. */
  .skill-grid {
    flex: none;
  }

  /* Dozens of boss rows would make this card taller than everything below it
     put together, so the table is bounded and scrolls inside itself — the
     page scrolls through the STACK, never through one panel's contents. The
     bound is a fixed height rather than a share of the viewport, so the
     card's geometry is identical before and after the payload lands. */
  .boss-grid {
    block-size: var(--boss-grid-height, 18rem);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .boss-grid:focus-visible {
    outline: 1px solid var(--panel-accent, rgb(220, 138, 0));
    outline-offset: 1px;
  }

  .skill-cell,
  .boss-cell {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    /* A cell must be allowed to shrink below the width of its own contents,
       or three of them refuse to fit the column on a phone and the table
       scrolls sideways with the leading digits cut off. */
    min-inline-size: 0;
    padding-inline: 0.25rem;
    background: var(--panel-surface, rgb(40, 40, 40));
  }

  /* Each cell is the positioning context for its OWN tooltip. Without this
     the tip resolved against a distant ancestor, so its 9rem minimum sat
     wherever that ancestor started rather than beside the cell. */
  .boss-cell {
    position: relative;
  }

  .skill-cell {
    block-size: 1.625rem;
  }

  .boss-cell {
    position: relative;
    block-size: 2.125rem;
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

  .skill-icon {
    flex: none;
    inline-size: 18px;
    block-size: 18px;
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

  /* An unranked tile is muted rather than hidden: the figure beside it can
     still be real, and the detail says "Unranked" in words. */
  .boss-cell[data-boss-unranked='true'] .boss-kc {
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .skill-level,
  .boss-kc {
    flex: 1;
    min-inline-size: 0;
    text-align: right;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .skill-level {
    font-size: 0.6875rem;
  }

  .boss-tip {
    position: absolute;
    inset-block-end: calc(100% + 0.25rem);
    inset-inline-start: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    /* The tip is wider than the cell it belongs to, which is fine until the
       cell is in the last column — there it used to extend past the table's
       inline end and give the grid a scroll width wider than the panel,
       which is what cut the leading digits off every visible row. It is
       bounded to the viewport and flips at the end edge (below), so it can
       never widen the table it floats over. */
    inline-size: max-content;
    max-inline-size: min(12rem, calc(100vw - 3rem));
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

  /* Last column: open toward the start edge instead, so the tip stays inside
     the table on the one side where it otherwise could not. */
  .boss-cell:nth-child(3n) .boss-tip {
    inset-inline-start: auto;
    inset-inline-end: 0;
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
