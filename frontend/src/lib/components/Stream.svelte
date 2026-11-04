<!-- Stream is one dated column of entries, newest first, a page at a time
  (owner, 2026-11-02, issue 399, mock 04: "Implement the 04 one stream and
  combine both entries … Keep it at 5 entries with sleek pagination"). It
  replaced the sheet's two columns side by side, and the scroll box and the
  phone's "show all" disclosure with them.

  THREE FEEDS OF THE RECENT WORK (owner, 2026-11-03, issue 401): the marks
  choose the commits, the merges or the releases, and the stream opens on the
  first. ONE SHAPE FOR EVERY ENTRY whatever its feed: a mark for its kind, a
  byline — where, when, and the version when there is one — the subject under
  it, and its identity at the end. An entry is two links laid on one box: the
  subject's covers the whole entry, so the entry is its target, and the
  byline's source sits over it with a finger's-width box of its own. Neither
  link grows the entry, so every entry is the same pitch whatever it says.

  THE FILTERS ARE MARKS, not words: the active one is the brand's ink, with no
  underline and no ground (owner: "don't underline it"), and pressing one makes
  its mark shine and throws three sparks — only where the reader has not asked
  for less motion. Each mark is drawn here rather than through Icon because the
  shine has to be masked by the mark's own strokes; the strokes are the same
  family's shapes, written with the same weight Icon writes.

  ZERO CLS. The list reserves a whole page of entries before a payload lands,
  a feed that holds nothing says so in its own words in the same reserve, and
  the pager is always drawn, so a page turn, a feed or an arriving payload
  lands in a box that was already its size.

  Every word, figure and address arrives written. The component formats
  nothing and names no repository, host or vendor; the ids it composes tie
  each filter's drawing to its own shine, and each subject to the byline that
  describes it, and are not words a reader sees. -->
<script lang="ts">
  import type { StreamFilter, StreamProps } from '../blocks.ts';
  import { iconParts } from '../icons.ts';
  import { filterRows, pageCount, pageRows } from '../stream.ts';
  import FeedCard from './FeedCard.svelte';
  import Icon from './Icon.svelte';
  import Pager from './Pager.svelte';
  import PanelShell from './PanelShell.svelte';

  let { status, generatedAt, anchor, listId, rows, pageSize, emptyNote, filters }: StreamProps = $props();

  const uid = $props.id();

  /* Which filter is chosen, which page is shown, and which filter was pressed
     last — the one whose mark shines. Component-local and never persisted: a
     page and a filter are answers about this visit to this list. */
  let active = $state<StreamFilter['key']>('commit');
  let page = $state(1);
  let lit = $state<StreamFilter['key'] | undefined>(undefined);
  /* Every press counts, so pressing the lit filter again redraws its mark and
     the shine runs again: a drawing that arrives anew starts its animation
     from the beginning, which no attribute change can promise. */
  let presses = $state(0);

  const filtered = $derived(filterRows(rows, active));
  const pages = $derived(pageCount(filtered.length, pageSize));
  /* Rows that shrink under a reader (a payload landing) leave them on the last
     real page rather than past it. */
  const at = $derived(Math.min(page, pages));
  const shown = $derived(pageRows(filtered, at, pageSize));
  /* What a feed that holds nothing says, in the reserve its entries would
     have filled; the adapter writes one for every feed. */
  const filteredEmpty = $derived(filters.find((filter) => filter.key === active)?.empty ?? emptyNote);

  function choose(key: StreamFilter['key']): void {
    active = key;
    page = 1;
    lit = key;
    presses += 1;
  }
</script>

<PanelShell {status} {generatedAt}>
  <FeedCard variant="table">
    <!-- The stream carries the id the commits' own section used to (issue
      287's rule: never break a URL). The nav never links it; it exists for an
      address a reader already shared. -->
    <div class="stream" id={anchor} style:--stream-page-rows={pageSize}>
      <div class="stream-head">
        <div class="stream-filters" role="group" aria-label="Show">
          {#each filters as filter (filter.key)}
            <button
              class="stream-filter"
              type="button"
              aria-pressed={filter.key === active}
              aria-label={filter.label}
              data-lit={lit === filter.key ? 'true' : undefined}
              onclick={() => choose(filter.key)}>
              {#key lit === filter.key ? presses : 0}
                <svg class="stream-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <defs>
                    <linearGradient id="{uid}-shine-{filter.key}" x1="0" x2="1" y1="0" y2="1">
                      <stop class="stream-shine-edge" offset="0" />
                      <stop class="stream-shine-core" offset="0.5" />
                      <stop class="stream-shine-edge" offset="1" />
                    </linearGradient>
                    <!-- The mask is the mark's own strokes: white is the mask's
                      "show", a luminance and not a colour of the page. -->
                    <mask id="{uid}-mask-{filter.key}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
                      <g fill="none" stroke="white" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
                        {#each iconParts(filter.glyph) as part, index (index)}
                          <svelte:element
                            this={part.tag}
                            {...part.attrs}
                            fill={part.solid ? 'white' : null}
                            stroke={part.solid ? 'none' : null} />
                        {/each}
                      </g>
                    </mask>
                  </defs>
                  <g
                    class="stream-ink"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.25"
                    stroke-linecap="round"
                    stroke-linejoin="round">
                    {#each iconParts(filter.glyph) as part, index (index)}
                      <svelte:element
                        this={part.tag}
                        {...part.attrs}
                        fill={part.solid ? 'currentColor' : null}
                        stroke={part.solid ? 'none' : null} />
                    {/each}
                  </g>
                  <!-- The band moves inside the masked group, so the mask holds
                    still over the strokes while the light crosses them. -->
                  <g mask="url(#{uid}-mask-{filter.key})">
                    <rect class="stream-shine" x="-24" y="-4" width="24" height="32" fill="url(#{uid}-shine-{filter.key})" />
                  </g>
                  <!-- Each spark is placed by its group, so the spark's own
                    transform is free to grow and turn it about its centre. -->
                  <g class="stream-sparks">
                    <g transform="translate(20 4)"><path class="stream-spark" d="M0-3L.8-.8L3 0L.8.8L0 3L-.8.8L-3 0L-.8-.8Z" /></g>
                    <g transform="translate(4 19)"><path class="stream-spark" d="M0-3L.8-.8L3 0L.8.8L0 3L-.8.8L-3 0L-.8-.8Z" /></g>
                    <g transform="translate(21 17)"><path class="stream-spark" d="M0-3L.8-.8L3 0L.8.8L0 3L-.8.8L-3 0L-.8-.8Z" /></g>
                  </g>
                </svg>
              {/key}
            </button>
          {/each}
        </div>
      </div>
      {#if filtered.length === 0}
        <p class="stream-note">{filteredEmpty}</p>
      {:else}
        <ol class="stream-list" id={listId}>
          {#each shown as row, index (row.key)}
            <li class="stream-entry" data-kind={row.kind}>
              <span class="stream-kind"><Icon name={row.kind === 'private' ? 'folder' : 'pull'} slot="row" /></span>
              <div class="stream-body">
                <!-- The byline is the subject link's description too, so a
                  reader who tabs straight to the subject still hears where and
                  when it happened. -->
                <span class="stream-by" id="{uid}-by-{index}">
                  {#if row.source.href}
                    <a class="stream-source" href={row.source.href} target="_blank" rel="noopener noreferrer" aria-label={row.source.label}
                      >{row.source.text}</a>
                  {:else}
                    <span class="stream-source">{row.source.text}</span>
                  {/if}
                  <span class="stream-age">{row.age}</span>
                  {#if row.release}
                    <span class="stream-release"><Icon name="tag" slot="cell" /><span class="stream-release-tag">{row.release}</span></span>
                  {/if}
                </span>
                {#if row.title.href}
                  <a
                    class="stream-title"
                    href={row.title.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={row.title.label}
                    aria-describedby="{uid}-by-{index}">{row.title.text}</a>
                {:else}
                  <span class="stream-title">{row.title.text}</span>
                {/if}
              </div>
              <span class="stream-mark">{row.mark}</span>
            </li>
          {/each}
        </ol>
      {/if}
      <Pager page={at} {pages} previousLabel="Newer entries" nextLabel="Older entries" onturn={(next) => (page = next)} />
    </div>
  </FeedCard>
</PanelShell>

<style>
  /* The stream's own measures. The pitch every entry is drawn at, and the
     three lengths it is made of, are styles.css tokens (--stream-*), because
     the phone restates the pitch there; these are the type the entry sets in. */
  .stream {
    --stream-subject-size: 0.9375rem;
    --stream-subject-weight: 500;
    --stream-source-weight: 650;

    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  /* --- The filters ----------------------------------------------------------- */

  /* The filters sit at the stream's inline end, under the vine's end, as the
     approved mock drew them, over the pager at the same end on a desk. */
  .stream-head {
    display: flex;
    justify-content: flex-end;
  }

  .stream-filters {
    display: flex;
  }

  /* A mark in a finger's-width square, and nothing else: no ground, no border,
     no underline. The chosen one is the brand's ink. */
  .stream-filter {
    display: grid;
    place-items: center;
    inline-size: var(--control-target);
    block-size: var(--control-target);
    padding: 0;
    border: 0;
    background: none;
    color: var(--ledger-muted);
    cursor: pointer;
  }

  .stream-filter[aria-pressed='true'] {
    color: var(--color-brand);
  }

  .stream-filter:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }

  .stream-glyph {
    inline-size: var(--icon-row);
    block-size: var(--icon-row);
  }

  /* At rest the band waits off the mark's left edge and the sparks are
     nothing at all, so under reduced motion the mark is simply its ink. */
  .stream-shine {
    transform-box: fill-box;
  }

  .stream-shine-edge {
    stop-color: var(--ledger-highlight);
    stop-opacity: 0;
  }

  .stream-shine-core {
    stop-color: var(--ledger-highlight);
  }

  .stream-spark {
    fill: var(--color-brand);
    opacity: 0;
    transform: scale(0);
    transform-box: fill-box;
    transform-origin: center;
  }

  /* --- The entries ----------------------------------------------------------- */

  /* THE RESERVE: a whole page of entries at the pitch, filled or not, and the
     empty note holds the same room, so a payload landing a moment after first
     paint moves nothing under the reader and the pager below stays put. */
  .stream-list,
  .stream-note {
    min-block-size: calc(var(--stream-page-rows) * var(--stream-pitch));
  }

  .stream-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .stream-note {
    margin: 0;
    padding-block: var(--stream-pad);
    font-family: var(--font-mono);
    font-size: var(--ledger-figure-size);
    color: var(--ledger-muted);
  }

  /* An entry is EXACTLY the pitch, so five of them are exactly the reserve.
     The twig under it is a background, never a border, as the log's was: a
     border adds its pixel to every entry and five of them overflow a reserve
     that is exactly five entries tall. */
  .stream-entry {
    display: grid;
    grid-template-columns: var(--icon-row) minmax(0, 1fr) auto;
    column-gap: var(--stream-gap);
    block-size: var(--stream-pitch);
    background: var(--keep-twig-2) left bottom / var(--keep-twig-tile) repeat-x;
  }
  .stream-entry:nth-child(3n-1) {
    background-image: var(--keep-twig-3);
    background-position-x: calc(-240 * var(--keep-prop));
  }
  .stream-entry:nth-child(3n) {
    background-image: var(--keep-twig-1);
    background-position-x: calc(-400 * var(--keep-prop));
  }
  .stream-entry:last-child {
    background: none;
  }

  /* A grid item's automatic minimum is its min-content, so a long subject
     would refuse to shrink and drag the list past the page; zero lets every
     part be exactly its track and ellipsize inside it. */
  .stream-entry > * {
    min-inline-size: 0;
  }

  .stream-kind,
  .stream-mark {
    align-self: start;
    margin-block-start: var(--stream-pad);
    block-size: var(--stream-sub);
  }

  .stream-kind {
    display: flex;
    align-items: center;
    color: var(--ledger-muted);
  }

  /* The subject and the byline share one cell: the subject's box is the whole
     entry and the byline lies over its top line, so a press anywhere on the
     entry but the source opens the subject. */
  .stream-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .stream-body > * {
    grid-area: 1 / 1;
  }

  .stream-title {
    display: block;
    min-block-size: var(--control-target);
    padding-block: calc(var(--stream-pad) + var(--stream-sub)) var(--stream-pad);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-family: var(--font-sans);
    font-size: var(--stream-subject-size);
    font-weight: var(--stream-subject-weight);
    line-height: var(--stream-line);
    color: var(--ledger-ink);
    text-decoration: none;
    text-underline-offset: 0.2em;
  }

  /* The byline lets presses through to the subject under it, except on the
     source, which is a link of its own. */
  .stream-by {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    align-self: start;
    gap: var(--stream-gap);
    margin-block-start: var(--stream-pad);
    block-size: var(--stream-sub);
    min-inline-size: 0;
    pointer-events: none;
    font-family: var(--font-mono);
    font-size: var(--ledger-figure-size);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--ledger-muted);
  }

  /* THE SOURCE IS A FINGER'S WIDTH TALL without the byline growing: its box is
     the touch floor, centred on the byline's line and spilling equally above
     and below it, over the subject's own box. The name ellipsizes before the
     age and the version do. */
  .stream-source {
    flex: 0 1 auto;
    min-inline-size: var(--control-target);
    block-size: var(--control-target);
    margin-block: calc((var(--stream-sub) - var(--control-target)) / 2);
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: var(--control-target);
    font-weight: var(--stream-source-weight);
    color: var(--ledger-ink);
    text-decoration: none;
    text-underline-offset: 0.2em;
    pointer-events: auto;
  }

  .stream-age {
    flex: none;
  }

  /* The version, its mark tight against it. A tag longer than the line has
     room for ellipsizes rather than pushing the entry past the page: the
     adapter hands it verbatim, and the line decides how much of it is drawn. */
  .stream-release {
    display: inline-flex;
    flex: 0 1 auto;
    align-items: center;
    gap: var(--icon-gap);
    min-inline-size: 0;
    color: var(--ledger-ink);
  }

  .stream-release-tag {
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  a.stream-title:hover,
  a.stream-title:focus-visible,
  a.stream-source:hover,
  a.stream-source:focus-visible {
    color: var(--ledger-highlight);
    text-decoration: underline;
  }

  /* Inset rings: an outset one on a box that reaches the column's edge would
     be drawn outside it, and on a phone that is the page scrolling sideways. */
  a.stream-title:focus-visible,
  a.stream-source:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }

  .stream-mark {
    font-family: var(--font-mono);
    font-size: var(--ledger-figure-size);
    font-variant-numeric: tabular-nums;
    line-height: var(--stream-sub);
    white-space: nowrap;
    color: var(--ledger-muted);
  }

  /* A PHONE'S SUBJECT TAKES TWO LINES before it ellipsizes, inside the taller
     pitch the phone block of styles.css restates. The plain block and its
     ceiling come first, so an engine without the line clamp still stops at
     two lines and only loses the ellipsis. The box ends where its second line
     does, with no padding under it: a box clips at its padding edge, and
     WebKit still lays out the lines past the clamp, so a third line painted
     into a foot of padding showed half of itself (preview, 2026-11-02). The
     entry keeps its pitch; the foot is the entry's, not the link's. */
  @media (max-width: 45rem) {
    .stream-title {
      max-block-size: calc(var(--stream-pitch) - var(--stream-pad));
      padding-block-end: 0;
      white-space: normal;
      overflow-wrap: anywhere;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
    }
  }

  /* MOTION, only where the reader has not asked for less of it: the chosen
     ink eases in, and the pressed mark shines once and throws its sparks.
     Transforms and opacity only, so nothing re-lays out. */
  @media (prefers-reduced-motion: no-preference) {
    .stream-filter {
      transition: color var(--stream-press);
    }

    a.stream-title,
    a.stream-source {
      transition: color var(--ledger-hover);
    }

    .stream-filter[data-lit] .stream-shine {
      animation: stream-shine var(--stream-shine-duration) var(--ledger-ease) 1 both;
    }

    .stream-filter[data-lit] .stream-spark {
      animation: stream-spark var(--stream-spark-duration) ease-out 1 both;
    }

    .stream-filter[data-lit] .stream-sparks > :nth-child(2) .stream-spark {
      animation-delay: var(--stream-spark-stagger);
    }

    .stream-filter[data-lit] .stream-sparks > :nth-child(3) .stream-spark {
      animation-delay: calc(2 * var(--stream-spark-stagger));
    }

    /* The band crosses twice its own width: from waiting off the left edge to
       clear of the right one. */
    @keyframes stream-shine {
      from {
        transform: translateX(0);
      }
      to {
        transform: translateX(200%);
      }
    }

    @keyframes stream-spark {
      0% {
        opacity: 0;
        transform: scale(0) rotate(0deg);
      }
      35% {
        opacity: 1;
        transform: scale(1) rotate(45deg);
      }
      100% {
        opacity: 0;
        transform: scale(0.2) rotate(90deg);
      }
    }
  }
</style>
