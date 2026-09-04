<!-- LedgerBoard is the board of turnable squares (owner directive, 2026-09-03,
  issue 287): a row of 1:1 boxes, each showing a headline on its front and the
  breakdown behind it, turned by pressing the square.

  EACH SQUARE IS A REAL BUTTON with `aria-pressed`, so the turn is operable by
  keyboard, announced as a state, and reachable by a finger at the site's own
  touch floor — a square is far larger than the floor, but the floor is
  declared on the control anyway, because a control sized only by its content
  is a control whose size depends on its content.

  BOTH FACES ARE ALWAYS IN THE DOM, and only one is ever readable: the back
  face is turned away and `backface-visibility: hidden` keeps it unpainted,
  while `aria-hidden` on the hidden face is what stops a screen reader from
  reading a square's front and back as one run-on sentence. Under reduced
  motion the two faces swap outright — same two states, no rotation.

  It formats nothing and names nothing. A figure, a sub-line, a set of facts,
  a set of bars: every one of them arrives written, from an adapter that knows
  which source it read. A square whose source said nothing renders its dashes
  and its own note rather than a zero, which is the honest-states floor at the
  one place a reader would never see it being broken. -->
<script lang="ts">
  import type { LedgerBoardProps } from '../blocks.ts';
  import FeedCard from './FeedCard.svelte';
  import PanelShell from './PanelShell.svelte';

  let {
    title,
    status,
    generatedAt,
    squares,
    emptyNote,
    staleNote,
    turnLabel,
    returnLabel
  }: LedgerBoardProps = $props();

  let turned = $state(new Set<string>());

  function turn(key: string): void {
    const next = new Set(turned);
    if (!next.delete(key)) {
      next.add(key);
    }
    turned = next;
  }
</script>

<PanelShell {title} {status} {generatedAt} note={staleNote}>
  <FeedCard variant="board">
    {#if squares.length === 0}
      <p class="board-note">{emptyNote}</p>
    {:else}
      <div class="board-grid">
        {#each squares as square (square.key)}
          {@const open = turned.has(square.key)}
          <button
            class="board-square"
            type="button"
            aria-pressed={open}
            aria-label={`${open ? returnLabel : turnLabel} ${square.ariaLabel}`}
            data-turned={open ? 'true' : 'false'}
            onclick={() => turn(square.key)}>
            <span class="board-pivot">
              <span class="board-face" data-face="front" aria-hidden={open}>
                <span class="board-label">{square.label}</span>
                {#if square.bars}
                  <span class="board-bars">
                    {#each square.bars as bar (bar.key)}
                      <span class="board-bar">
                        <span class="board-bar-label">{bar.label}</span>
                        <span class="board-track">
                          {#if bar.fillPct !== null}
                            <span class="board-fill" style:--board-fill={`${bar.fillPct}%`}></span>
                          {/if}
                        </span>
                        <span class="board-reading">{bar.reading}</span>
                      </span>
                    {/each}
                  </span>
                {:else}
                  <span class="board-figure">{square.figure}</span>
                {/if}
                {#if square.meter}
                  <!-- Severity is never the only channel: the reading is
                    printed beside the bar, and the period it measures is
                    printed under it, so the fill is the redundant one. -->
                  <span class="board-meter" data-severity={square.meter.severity}>
                    <span class="board-meter-track">
                      <span class="board-meter-fill" style:--board-fill={`${square.meter.fillPct}%`}
                      ></span>
                    </span>
                    <span class="board-meter-reading">{square.meter.reading}</span>
                    <span class="board-meter-label">{square.meter.label}</span>
                  </span>
                {/if}
                {#if square.sub}<span class="board-sub">{square.sub}</span>{/if}
              </span>
              <span class="board-face" data-face="back" aria-hidden={!open}>
                <span class="board-label">{square.back.label}</span>
                {#if square.back.bars}
                  <span class="board-bars">
                    {#each square.back.bars as bar (bar.key)}
                      <span class="board-bar">
                        <span class="board-bar-label">{bar.label}</span>
                        <span class="board-track">
                          {#if bar.fillPct !== null}
                            <span class="board-fill" style:--board-fill={`${bar.fillPct}%`}></span>
                          {/if}
                        </span>
                        <span class="board-reading">{bar.reading}</span>
                      </span>
                    {/each}
                  </span>
                {:else if square.back.facts}
                  <span class="board-facts">
                    {#each square.back.facts as fact (fact.key)}
                      <span class="board-fact">
                        {#if fact.slot !== undefined}
                          <span class="board-swatch" data-slot={fact.slot} aria-hidden="true"></span>
                        {/if}
                        <span class="board-term">{fact.term}</span>
                        <span class="board-value">{fact.value}</span>
                      </span>
                    {/each}
                  </span>
                {/if}
                {#if square.back.note}<span class="board-sub">{square.back.note}</span>{/if}
              </span>
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </FeedCard>
</PanelShell>

<style>
  /* THE METER LIVES HERE, not in the stylesheet, and the reason is the token
     floor rather than tidiness: the severity ramp is a family of status inks
     the token layer declares and a contrast guard measures, and the guard's
     companion pin insists a COMPONENT reads them without a fallback behind it
     — a fallback would keep painting the day a token stopped being declared,
     which is exactly how --panel-status-stale once went a whole release cycle
     read-but-never-declared. Every value below is a token read; this block
     states which of the three inks applies and nothing else.

     Severity is never the channel: the reading is printed beside the fill and
     the period is printed under it, so the colour is the redundant one. */
  .board-meter {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.1875rem 0.375rem;
    font-family: var(--font-mono);
    font-size: 0.625rem;
  }

  .board-meter-track {
    block-size: var(--usage-meter-thickness, 0.375rem);
    background: var(--ledger-raised);
  }

  .board-meter-fill {
    display: block;
    block-size: 100%;
    inline-size: var(--board-fill, 0%);
    background: var(--usage-meter-ok);
  }

  .board-meter[data-severity='warning'] .board-meter-fill {
    background: var(--usage-meter-warning);
  }

  .board-meter[data-severity='critical'] .board-meter-fill {
    background: var(--usage-meter-critical);
  }

  .board-meter-reading {
    text-align: end;
    font-variant-numeric: tabular-nums;
  }

  .board-meter-label {
    grid-column: 1 / -1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--ledger-muted);
  }
</style>
