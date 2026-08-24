<!-- BossLog renders the boss-log/v1 panel as the account's whole public record,
  laid out the way the RuneLite hiscore panel lays one out: a dense grid of
  skill cells first — small icon, right-aligned level, and the account's two
  totals filling the last row — then the boss tallies below as a horizontal
  strip, each an icon beside a right-aligned, thousands-separated kill count
  with a hover/focus detail carrying the full name, the rank, and the score.

  The boss strip scrolls SIDEWAYS (owner directive, issue 127). The origin
  serves every row the hiscores report — dozens of bosses — and they used to
  fill a tall box that scrolled vertically inside the card, which on a phone
  means a scroll region competing with the page's own scroll under the same
  thumb. Sideways is the gesture a phone has spare, and the card gets its
  height back.

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
    <!-- The strip wrapper is positioned and the scroller inside it is not,
      which is what lets a cell's detail escape the scroller's clipping: an
      absolutely positioned box is clipped by an overflow ancestor only when
      that ancestor is in its containing-block chain. Anchored to a cell, as
      it was while the table scrolled vertically, every detail on the strip's
      top row would be cut off by the strip's own edge. -->
    <div class="boss-strip">
      <!-- The complete boss table is dozens of tiles, so the strip is bounded
        and scrolls sideways inside its own box; a scrollable region is
        keyboard-reachable only when focusable, so the tabindex is
        deliberate. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <ul class="boss-grid" tabindex="0" aria-label="Boss tallies">
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
    </div>
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

  /* The strip's positioned wrapper. It exists for the tooltip: a detail
     anchored inside the scroller is clipped by it, and anchored here it is
     not, because this box is not the scroller. It also owns nothing else —
     the strip's height is the scroller's own. */
  .boss-strip {
    position: relative;
  }

  /* Dozens of boss tiles in one vertical table made this card taller than
     everything below it put together, so the table used to be bounded and
     scroll DOWN inside itself. It scrolls SIDEWAYS now: two rows of tiles
     flowing into columns, one gesture wide on a phone, and the card keeps
     the height the vertical box used to spend.

     The bound is the ROW COUNT, not a height, and that distinction is
     measured rather than stylistic. Two explicit rows bound the strip
     whatever the payload holds — seventy bosses or seven hundred flow into
     more columns, never more rows, and the two rows exist before any data
     arrives, so nothing shifts when it does. A fixed block-size on top of
     that looks equivalent and is not: a horizontal scroller's scrollbar is
     taken OUT of a fixed box, and on every platform that reserves space for
     one rather than overlaying it — Linux and Windows, which is also where
     CI runs — the second row is cut off behind it. MEASURED here: 69px of
     tiles in the 70px content box a 4.5rem bound leaves, which survives an
     overlay scrollbar by one pixel and loses fifteen to a classic one. With
     no fixed height the box grows by exactly the scrollbar it was given, so
     the same two rows are whole in both. The columns stay a fixed width so a
     long kill count cannot re-lay-out the strip around it. */
  .boss-grid {
    grid-auto-flow: column;
    grid-template-rows: repeat(2, var(--boss-cell-height, 2.125rem));
    grid-auto-columns: var(--boss-cell-width, 5.25rem);
    overflow-x: auto;
    overflow-y: hidden;
    /* A sideways scroll inside a page that scrolls downward must not chain:
       reaching the end of the strip should stop, never start dragging the
       document with it. */
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

  /* The cell is NOT the tooltip's containing block any more: the strip
     scrolls sideways, and an absolutely positioned box inside a scroller is
     clipped by it, so a cell-anchored detail on the top row was cut in half
     by the strip's own edge. The containing block moved out to .boss-strip,
     which sits outside the scroller — see the tip's own rule. */
  .boss-cell {
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

  /* After .skill-level, deliberately: the totals cell wears both classes, and
     these two rules carry the same specificity, so the one that ships the
     narrower figure has to be the later one. Written the other way round it
     silently rendered at 11px and overflowed the cell on a 320px phone —
     MEASURED, not theorised. */
  .skill-summary-value {
    font-size: 0.625rem;
  }

  /* The detail reads out ABOVE the strip, in one place, for whichever tile
     the pointer or keyboard is on. Its containing block is .boss-strip and
     not the cell, for two reasons that both come from the strip scrolling:
     a tip anchored inside the scroller is clipped by it, and a tip that
     followed its cell would slide off the visible window as the strip moved
     under it. One fixed readout position is legible in both states, and it
     can never widen the strip it floats over — an absolutely positioned box
     whose containing block sits outside a scroller contributes nothing to
     that scroller's scrollable width. */
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
