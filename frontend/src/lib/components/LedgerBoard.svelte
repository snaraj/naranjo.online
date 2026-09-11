<!-- LedgerBoard is the board of cards (owner directive, 2026-09-11, issues 267
  and 311): a three-by-two grid of ruled boxes, each showing one reading and
  the facts behind it, and each turning to ink when it is pressed.

  ONE FACE, NOT TWO. The squares this replaces carried a front and a back,
  rotated between them, and kept both in the DOM at once — which is why they
  needed backface culling, a visibility swap for the engines that flatten a 3D
  context inside a button, an aria-hidden on whichever face was turned away,
  and a fixed box that clipped anything the far face could not fit. A turn is
  now an INVERSION of the same content: one `[data-turned]` remap swaps the
  card's paper and ink tokens and nothing moves. Nothing is hidden, so nothing
  can be hidden by accident; a card's height follows its content, so nothing
  is clipped; and there is no second face to keep a screen reader out of.

  EACH CARD IS A REAL BUTTON with `aria-pressed`, so the turn is operable by
  keyboard, announced as a state, and reachable by a finger at the site's own
  touch floor — a card is far larger than the floor, but the floor is declared
  on the control anyway, because a control sized only by its content is a
  control whose size depends on its content.

  It formats nothing and names nothing. A figure, a sub-line, a set of facts,
  a set of model rows, a daily series: every one of them arrives written, from
  an adapter that knows which source it read. A card whose source said nothing
  renders its own note rather than a zero, which is the honest-states floor at
  the one place a reader would never see it being broken. -->
<script lang="ts">
  import type { LedgerBoardProps } from '../blocks.ts';
  import FeedCard from './FeedCard.svelte';
  import PanelShell from './PanelShell.svelte';
  import Sparkline from './Sparkline.svelte';

  let {
    title,
    status,
    generatedAt,
    cards,
    emptyNote,
    staleNote,
    turnLabel,
    returnLabel
  }: LedgerBoardProps = $props();

  /* THE BOARD'S OPENING STATE IS THE ADAPTER'S, and every turn after it is the
     reader's. Seeded once, from the first payload that mounts this component —
     the block host renders nothing until an envelope arrives, so there is no
     null-props pass to seed from — and never reseeded, because a refresh
     thirty seconds later must not fold a card the reader has just opened. */
  // svelte-ignore state_referenced_locally
  let turned = $state(new Set(cards.filter((card) => card.turned).map((card) => card.key)));

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
    {#if cards.length === 0}
      <p class="board-note">{emptyNote}</p>
    {:else}
      <div class="board-grid">
        {#each cards as card (card.key)}
          {@const open = turned.has(card.key)}
          <button
            class="board-card"
            type="button"
            aria-pressed={open}
            aria-label={`${open ? returnLabel : turnLabel} ${card.ariaLabel}`}
            data-turned={open ? 'true' : 'false'}
            onclick={() => turn(card.key)}>
            <span class="board-head">
              <span class="board-label">{card.label}</span>
              {#if card.ctx}<span class="board-ctx">{card.ctx}</span>{/if}
            </span>
            {#if card.figure}
              <span class="board-headline">
                <span class="board-figure">{card.figure}</span>
                {#if card.sub}
                  <span class="board-sub">
                    {#each card.sub as line (line)}<span class="board-sub-line">{line}</span>{/each}
                  </span>
                {/if}
              </span>
            {/if}
            {#if card.meter}
              <!-- Severity is never the only channel: the reading is printed
                beside the bar, and the period it measures is printed under
                it, so the fill is the redundant one. -->
              <span class="board-meter" data-severity={card.meter.severity}>
                <span class="board-meter-track">
                  <span class="board-meter-fill" style:--board-fill={`${card.meter.fillPct}%`}
                  ></span>
                </span>
                <span class="board-meter-reading">{card.meter.reading}</span>
                <span class="board-meter-label">{card.meter.label}</span>
              </span>
            {/if}
            {#if card.facts}
              <span class="board-facts" data-columns={card.factColumns ?? 1}>
                {#each card.facts as fact (fact.key)}
                  <span class="board-fact" data-peak={fact.peak ? 'true' : 'false'}>
                    <span class="board-term">{fact.term}</span>
                    <span class="board-value">{fact.value}</span>
                  </span>
                {/each}
              </span>
            {/if}
            {#if card.models}
              <span class="board-models">
                {#each card.models as row (row.key)}
                  <span class="board-model">
                    <span class="board-model-name">{row.label}</span>
                    <span class="board-reading">{row.reading}</span>
                    <span class="board-track">
                      <span class="board-fill" style:--board-fill={`${row.fillPct}%`}></span>
                    </span>
                    {#if row.detail}<span class="board-detail">{row.detail}</span>{/if}
                  </span>
                {/each}
              </span>
            {/if}
            {#if card.spark}
              <Sparkline totals={card.spark.totals} ariaLabel={card.spark.ariaLabel} />
            {/if}
            {#if card.note}<span class="board-card-note">{card.note}</span>{/if}
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
    background: var(--board-raised);
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
    color: var(--board-muted);
  }
</style>
