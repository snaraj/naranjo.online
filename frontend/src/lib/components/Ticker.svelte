<!-- Ticker is the scrolling strip (owner directive, 2026-09-03, issue 287): a
  ruled band whose items travel from right to left, led by an inverted item
  carrying the collection's figure and nothing else — the name and totals it
  used to print were cut as noise (owner directive, 2026-09-04, issue 292);
  the panel head above already names the collection.

  THE ITEMS ARE WRITTEN TWICE AND THAT IS THE MECHANISM. A strip that
  translates from 0 to -50% of a row containing its content twice is seamless
  by arithmetic: at -50% the second copy sits exactly where the first started,
  so the loop restarts on an identical frame. The duplicate is `aria-hidden`,
  because a reader using assistive technology should hear the collection once.

  UNDER REDUCED MOTION IT IS A SCROLLABLE STRIP, not a stopped one. Removing
  the animation from a band that is wider than its box would leave two thirds
  of the collection permanently unreachable, so the strip's base state — the
  state every engine gets before the motion query is even consulted — is a
  native horizontal scroller, and the animation is what a reader who has not
  asked for less motion gets instead. That is why the base is the honest one:
  the floor is stated in the direction that degrades safely.

  IT NAMES NOTHING. An item is an icon, a figure and its detail; the strip's
  own name and its lead line are the envelope's, served by the origin. No
  domain word of any kind lives in this file — a sweep refuses one — which is
  what keeps the component reusable for the next collection that wants a
  strip, and what keeps the identity of whoever the figures belong to out of
  every rendering, visible and accessible alike. -->
<script lang="ts">
  import type { TickerProps } from '../blocks.ts';
  import type { TipDetail } from '../tooltip.ts';
  import DetailTip from './DetailTip.svelte';
  import FeedCard from './FeedCard.svelte';
  import PanelShell from './PanelShell.svelte';

  let { title, status, generatedAt, items, emptyNote, staleNote, label, mark }: TickerProps =
    $props();

  /* ONE DETAIL FOR THE WHOLE STRIP, and the reason is not economy — it is
     that a detail rendered INSIDE this band cannot be positioned at all.
     `position: fixed` resolves against the viewport only while no ancestor is
     transformed, and the band's marquee is a transform animation on
     `.ticker-run`, which makes that element the containing block for every
     fixed descendant. A tip anchored to a pointer at y=500 was drawn at
     y=952 — MEASURED at 1280x900, entirely below the fold, with
     `elementFromPoint` returning the gallery behind it. Pausing on hover does
     not help: the transform is still applied, so the containing block is
     still the run. Rendering the tip outside the animated element is what
     restores the containment this primitive promises at every edge.

     This is the region form DetailTip already documents, and the same shape
     the heatmap uses for its 371 cells: the strip is the host, a pointer
     resolves to the item under it, and the resolved item names which detail
     to show. */
  let strip = $state<HTMLDivElement>();
  /* The ELEMENT under the pointer, not its index, and the difference matters:
     the strip holds two copies of every item, so an index names two elements
     and the binding's anchor would re-aim the readout at whichever copy the
     document happened to list first — very possibly the one scrolled off the
     screen. */
  let hoveredItem = $state<HTMLElement | null>(null);

  /* An empty reading, for the frames before anything is hovered. The box is
     hidden then — the action reveals it only once it has resolved an item,
     and it resolves before this state is read — so this is a shape, never
     something a reader is shown. */
  const noDetail: TipDetail = { name: '', rows: [] };

  /* The item under the pointer, or nothing. BOTH lanes resolve, because the
     duplicate lane is not decoration to a reader's eye — it is what is on
     screen for half of every loop — and a detail that worked on only one of
     them would be a detail that came and went with the animation's phase. */
  function resolveItem(target: EventTarget | null): HTMLElement | null {
    const item = target instanceof Element ? target.closest('[data-ticker-index]') : null;
    return item instanceof HTMLElement && strip?.contains(item) ? item : null;
  }

  function noteItem(element: HTMLElement | null): void {
    hoveredItem = element;
  }

  const hoveredIndex = $derived(
    hoveredItem === null ? -1 : Number(hoveredItem.dataset.tickerIndex)
  );

  const hoveredDetail = $derived(
    hoveredIndex >= 0 && hoveredIndex < items.length ? items[hoveredIndex].detail : noDetail
  );
</script>

<PanelShell {title} {status} {generatedAt} note={staleNote}>
  <FeedCard variant="strip">
    {#if items.length === 0}
      <p class="ticker-note">{emptyNote}</p>
    {:else}
      <!-- A scrollable region has to be reachable without a pointer, which is
        what the tab stop is for: under reduced motion this strip IS a
        scroller, and a pan nobody can reach by keyboard is a collection two
        thirds of which nobody can read. The group role names it; there is no
        action to perform, so a button would be the wrong semantics. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="ticker-strip" aria-label={label} tabindex="0" role="group" bind:this={strip}>
        <div class="ticker-run">
          {#each [false, true] as duplicate (duplicate)}
            <div class="ticker-lane" aria-hidden={duplicate}>
              <span class="ticker-lead">
                <!-- The mark is the collection's own figure, handed in as data
                  by the binding layer with its file's dimensions, so the lead
                  reserves the box before the picture arrives (owner directive,
                  2026-09-04, issue 292). Decorative: the name beside it is the
                  accessible one. -->
                {#if mark}
                  <img
                    class="ticker-mark"
                    src={mark.url}
                    alt=""
                    width={mark.width}
                    height={mark.height}
                    decoding="async" />
                {/if}
              </span>
              {#each items as item, index (item.key)}
                <span
                  class="ticker-item"
                  data-ticker-index={index}
                  data-quiet={item.quiet ? 'true' : 'false'}
                  data-peak={item.peak ? 'true' : 'false'}
                  aria-label={item.label}>
                  {#if item.icon}
                    <img
                      class="ticker-icon"
                      src={item.icon}
                      alt=""
                      width={22}
                      height={22}
                      loading="lazy"
                      decoding="async" />
                  {:else}
                    <span class="ticker-icon ticker-glyph" aria-hidden="true">{item.glyph}</span>
                  {/if}
                  <span class="ticker-figure">{item.figure}</span>
                </span>
              {/each}
            </div>
          {/each}
        </div>
      </div>
      <!-- OUTSIDE the strip, and outside the animated run inside it. The tip
        is position: fixed, and a transformed ancestor would make that element
        its containing block instead of the viewport — which is exactly what
        the marquee is. Rendered here it resolves against the viewport again,
        and it still binds to the strip through `host` wherever it sits. -->
      <DetailTip
        detail={hoveredDetail}
        host={strip}
        resolve={resolveItem}
        select={noteItem}
        anchor={hoveredItem}
      />
    {/if}
  </FeedCard>
</PanelShell>
