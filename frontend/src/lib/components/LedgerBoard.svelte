<!-- LedgerBoard is the board of cards (owner directive, 2026-09-11, issues 267,
  311 and 316): a three-by-two grid of ruled boxes, each showing one reading
  and the facts behind it.

  NOTHING ON A CARD IS PRESSED ANY MORE. The cards used to be buttons that
  inverted their own ink, and the owner's answer to that was "these shouldn't
  change colour when I click on them" (2026-09-11, issue 316). The turn
  revealed nothing — one face, one token remap — so a control whose whole
  effect was to repaint what the reader was already reading is a control with
  no subject, and it goes. The RHYTHM stays: the adapter still opens every
  second source card inverted, which is the board the owner approved, and it
  is now static paint rather than a state anybody can change.

  What replaced the press is the daily line under the card, which SCRUBS: a
  pointer, a finger or an arrow key along the chart names a day, and while it
  does the card's own figure and its sub area read that day instead of the
  card's lifetime. Nothing is added at rest — the scrub paints only what the
  card already has, plus the date — and the reading is a READ of the current
  payload, never a remembered one, which is why `scrub` is dropped whenever
  the cards change underneath it and why the lookup below refuses an index
  the current series cannot answer.

  It formats nothing and names nothing. A figure, a sub-line, a set of facts,
  a set of model rows, a daily series and every scrubbed day's date and
  figures: every one of them arrives written, from an adapter that knows
  which source it read. A card whose source said nothing renders its own note
  rather than a zero, which is the honest-states floor at the one place a
  reader would never see it being broken. -->
<script lang="ts">
  import { scrubReading, type LedgerBoardProps, type LedgerCard } from '../blocks.ts';
  import FeedCard from './FeedCard.svelte';
  import Icon from './Icon.svelte';
  import PanelShell from './PanelShell.svelte';
  import Sparkline from './Sparkline.svelte';

  let { title, mark, status, generatedAt, cards, emptyNote, staleNote }: LedgerBoardProps = $props();

  /* WHICH CARD IS BEING READ, AND WHICH DAY OF IT. One cursor for the whole
     board rather than one per card: only one line can be under a pointer at a
     time, and a second card holding a stale reading beside the live one would
     be two answers to the same question. */
  let scrub = $state<{ key: string; index: number } | null>(null);

  /* A NEW PAYLOAD IS A NEW SET OF DAYS. The poll rebuilds every card every
     thirty seconds, and a reading taken from the last delivery must not
     survive one it was never measured in — so the cursor is dropped on any
     change of `cards`, and the reader's next pointer move takes a fresh one.
     `void` because the read IS the dependency; nothing here needs its value. */
  $effect(() => {
    void cards;
    scrub = null;
  });

  /* ONE CARD IS BEING READ, NEVER THE BOARD. The cursor names a card by key,
     so the reading lands on the line the pointer is actually over and every
     other card keeps its own figure — six cards all showing one card's day
     would be five wrong numbers.
     What that day SAYS is lib/blocks.ts's scrubReading, which is pure and
     therefore has its hostile cases decided by the unit suite rather than
     reasoned about in markup: an index the current payload cannot answer
     yields no reading at all. That is a second guard on the same fact as the
     effect above, and deliberately so — the effect drops a reading the payload
     replaced, and the lookup refuses one the payload cannot back. */
  function reading(card: LedgerCard): { readonly figure: string; readonly line: string } | null {
    return scrub === null || scrub.key !== card.key ? null : scrubReading(card, scrub.index);
  }
</script>

<PanelShell {title} {mark} {status} {generatedAt} note={staleNote}>
  <FeedCard variant="board">
    {#if cards.length === 0}
      <p class="board-note">{emptyNote}</p>
    {:else}
      <div class="board-grid">
        {#each cards as card (card.key)}
          {@const scrubbed = reading(card)}
          <!-- A GROUP, NOT A CONTROL. There is nothing to press, and the role
            is what keeps the card's own written name — the one the adapter
            composed — attached to the box a reader is inside, now that the
            button that used to carry it is gone. -->
          <div
            class="board-card"
            role="group"
            aria-label={card.ariaLabel}
            data-turned={card.turned ? 'true' : 'false'}>
            <span class="board-head">
              <span class="board-label">{#if card.mark}<Icon name={card.mark} slot="row" />{/if}{card.label}</span>
              {#if card.ctx}<span class="board-ctx">{card.ctx}</span>{/if}
            </span>
            {#if card.figure}
              <span class="board-headline">
                <span class="board-figure">{scrubbed ? scrubbed.figure : card.figure}</span>
                {#if card.sub || card.spark}
                  <!-- THE SUB AREA KEEPS ITS HEIGHT WHATEVER IT PRINTS, and
                    that is the zero-CLS floor rather than tidiness: the card's
                    own two lines become ONE scrubbed line, and without a
                    reserve the headline would shrink by a line the moment a
                    pointer touched the chart — taking the fact ladder below it
                    with it. The reserve is the card's own line count, which is
                    a dynamic length and therefore reaches the sheet as a
                    custom property. -->
                  <span class="board-sub" style:--board-sub-lines={card.sub?.length ?? 1}>
                    {#if scrubbed}
                      <span class="board-sub-line">{scrubbed.line}</span>
                    {:else if card.sub}
                      {#each card.sub as line (line)}<span class="board-sub-line">{line}</span
                        >{/each}
                    {/if}
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
              <Sparkline
                totals={card.spark.totals}
                ariaLabel={card.spark.ariaLabel}
                dayLabels={card.spark.dayLabels}
                dayFigures={card.spark.dayFigures}
                dayExact={card.spark.dayExact}
                onScrub={(index) => (scrub = index === null ? null : { key: card.key, index })} />
            {/if}
            {#if card.note}<span class="board-card-note">{card.note}</span>{/if}
          </div>
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
