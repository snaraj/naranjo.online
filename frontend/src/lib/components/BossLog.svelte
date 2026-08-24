<!-- BossLog renders the boss-log/v1 panel as the account's whole public record,
  laid out the way the RuneLite hiscore panel lays one out: a dense grid of
  skill cells first — small icon, right-aligned level, and the account's two
  totals filling the last row — then the boss tallies below in the SAME three
  columns, each an icon beside a right-aligned, thousands-separated kill count
  with a hover/focus detail carrying the full name, the rank, and the score.

  The boss table does not scroll (owner directive, issue 134): "it doesn't need
  scrolling if it just goes down in columns of 3". It has now been all three
  arrangements — a tall box that scrolled down inside the card, then a
  two-row strip that scrolled sideways, and now the same three-column table
  the skills already use, wrapping downward and ending where the data ends.
  The scroll region is GONE rather than merely unused: the tracks are
  minmax(0, 1fr), so three columns always fit the card exactly and there is
  never a width at which this box has something to scroll to. A count squeezed
  by a very narrow card truncates with an ellipsis and keeps its full figure in
  the cell's accessible name and its detail, because a silently clipped number
  is a wrong number.

  Removing the scroller is also what puts the detail back on the tile it
  describes. It had to move out to a wrapper while the strip scrolled — an
  absolutely positioned box is clipped by an overflow ancestor in its
  containing-block chain, so a cell-anchored detail on the strip's top row was
  cut in half by the strip's own edge — and with no overflow ancestor left, the
  cell is the correct anchor again. In a table that wraps down the card, one
  fixed readout at the top would be nowhere near the twentieth row.

  The account name is deliberately NOT rendered (owner directive, issue 127):
  the RSN is personal information, and a panel does not need to name whose
  record it is to show the record.

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
  import { cellLabel, rankLabel, skillLabel, skillSummary, summaryLabel, tally } from '../bossLog.ts';

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
  /* The last row's trailing gap, filled with the account's own totals rather
     than left blank. Derived, never constant: a payload without the Overall
     row yields no cells at all instead of two empty ones. */
  const summary = $derived(skillSummary(skills));

  /* tally, rankLabel, cellLabel, skillLabel, skillSummary, and summaryLabel
     live in lib/bossLog.ts: a null tally, an unranked row, and a total the
     hiscores do not report are the renderings that carry real meaning here,
     and they are executed by tests there rather than pattern-matched in this
     file's source. */
</script>

<PanelShell
  title={envelope?.title ?? 'Old School RuneScape Stats'}
  status={envelope?.status ?? 'unavailable'}
  generatedAt={envelope?.generatedAt}

>
  {#if data}
    {#if skills.length > 0}
      <ul class="skill-grid" aria-label="Skill levels">
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
        <!-- The account's totals, filling the last row's gap. They are cells
          of the same grid, not a caption under it, because the gap is what
          they exist to close. -->
        {#each summary as cell (cell.key)}
          <li class="skill-cell skill-summary" aria-label={summaryLabel(cell)} title={summaryLabel(cell)}>
            <span class="skill-summary-label" aria-hidden="true">{cell.label}</span>
            <span class="skill-level skill-summary-value">{cell.value}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="boss-note">No skill levels reported.</p>
    {/if}
    <!-- The complete boss table, three columns wrapping downward (owner
      directive, issue 134). It is no longer a scroll region, so it is no
      longer a focus stop either: the tabindex it used to carry existed only
      because a scrollable box is keyboard-reachable when focusable, and a
      tab stop that scrolls nothing is a stop that does nothing. -->
    <ul class="boss-grid" aria-label="Boss tallies">
      {#each data.bosses as boss (boss.name)}
        <!-- Cells take keyboard focus solely so the tooltip's
          :focus-visible reveal matches its :hover reveal; there is no
          action to perform, so a button would be the wrong semantics. -->
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
  /* Both tables share the RuneLite cell chrome: a hairline gap over the
     border color reads as a grid rule without a border per cell. */
  .skill-grid,
  .boss-grid {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 1px;
    background: var(--panel-border, rgb(23, 23, 23));
    border: 1px solid var(--panel-border, rgb(23, 23, 23));
  }

  /* The skills table is a fixed nine rows of three and never scrolls: it is
     the top of the panel and its size is known before any data arrives, so
     the card's geometry is identical before and after the payload lands.
     Twenty-five skills plus the two total cells tile it exactly, which is
     what leaves no blank tile at the end. */
  .skill-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    flex: none;
  }

  /* The boss table is the skills table's own shape now (owner directive,
     issue 134): three columns, wrapping downward, ending where the data ends.
     It has been a tall vertical scroller and a two-row sideways one; it is
     neither any more, and the declarations that made it one are gone rather
     than overridden — no auto-flow, no bounded row count, no overflow, no
     overscroll rule, because there is nothing left to scroll or to chain.

     minmax(0, 1fr) is what makes "never scrolls" true rather than usually
     true: identical to the skills grid above, the tracks are exactly a third
     of the card at every width, so three columns always fit and the box never
     has a scrollable overflow to reveal. The tracks cannot be given a fixed
     width instead — a bare 5.25rem minimum would lay out 252px of columns in
     a 266px card at 320px and, one narrower device later, scroll. */
  .boss-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
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

  .skill-cell {
    block-size: 1.625rem;
  }

  /* The totals that close the grid's last row. Same cell, different contents:
     a short label where a skill shows its icon, so the pair reads as part of
     the table rather than as a caption stuck to the end of it. Both figures
     are held on one line at every width — a wrapped number in a 1.625rem cell
     would spill over the row below it — and the label carries the full name
     in its accessible text, which is where "Total XP" fits and a 320px
     column does not. */
  .skill-summary {
    /* Tighter than a skill cell's gap on purpose: a nine-digit total plus its
       label is the widest thing this table ever has to fit, and the narrowest
       column it has to fit into is a third of a 320px card. MEASURED there at
       72px of content in 79px of cell. */
    gap: 0.125rem;
    white-space: nowrap;
    overflow: hidden;
  }

  .skill-summary-label {
    flex: none;
    font-size: 0.5625rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  /* The cell is the tooltip's containing block again. It could not be while
     the table scrolled — an absolutely positioned box is clipped by an
     overflow ancestor in its containing-block chain, so a cell-anchored
     detail on the scroller's top row was cut in half by the scroller's own
     edge — and with the overflow gone there is nothing left to clip it. In a
     table that wraps down the card, this is also the only anchor that works:
     one readout fixed to the table's top edge would be twenty rows away from
     the tile a reader is pointing at. */
  .boss-cell {
    position: relative;
    block-size: var(--boss-cell-height, 2.125rem);
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

  /* A figure squeezed by a very narrow card truncates VISIBLY. The cells
     shrink with the column now instead of scrolling, so the last defence
     against a card too narrow for its own digits is the ellipsis: a silently
     clipped number reads as a smaller number, and the whole figure is still
     in the cell's accessible name and its detail. */
  .skill-level,
  .boss-kc {
    flex: 1;
    min-inline-size: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    text-align: right;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .skill-level {
    font-size: 0.6875rem;
  }

  /* After .skill-level, deliberately: the totals cell wears both classes, and
     these two rules carry the same specificity, so the one that ships the
     narrower figure has to be the later one. Written the other way round it
     silently rendered at 11px and overflowed the cell on a 320px phone —
     MEASURED, not theorised. */
  .skill-summary-value {
    font-size: 0.625rem;
  }

  /* The detail reads out directly above the tile it describes.

     It is anchored per COLUMN, and that is a containment rule rather than a
     stylistic one: the tip is wider than a cell, so a start-anchored one in
     the last column would extend past the card's end edge — and an absolutely
     positioned box with no clipping ancestor drags the DOCUMENT sideways when
     it does, which is the floor this page is pinned against at 320px. The
     first column opens toward the end edge, the last opens toward the start
     edge, and the middle one opens from its own centre; the three-column grid
     is fixed, so nth-child names the column exactly. */
  .boss-tip {
    position: absolute;
    inset-block-end: calc(100% + 0.25rem);
    inset-inline-start: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    /* The tip is wider than the tile it describes, which used to push the
       table's scroll width past the card and cut the leading digits off
       every visible row. It is bounded to the viewport and claims no
       minimum, so it fits the narrowest phone this site supports. */
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

  /* The middle column opens from its own centre, the last from its end edge;
     both keep a 12rem detail inside a 320px card. */
  .boss-cell:nth-child(3n + 2) .boss-tip {
    inset-inline-start: 50%;
    transform: translateX(-50%);
  }

  .boss-cell:nth-child(3n) .boss-tip {
    inset-inline-start: auto;
    inset-inline-end: 0;
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
