<!-- LedgerSpread is the sheet's paired section (owner design decision,
  2026-09-11, issue 318, option B on the design canvas): a ruled table in the
  left column, a ruled log in the right, each under its own head row, stacked
  into one column on a phone.

  IT IS ONE COMPONENT, NOT TWO BLOCKS SIDE BY SIDE, and the reason is the
  reserve. The log's box is exactly as tall as the number of rows the table
  shows, so the section's height is decided before either payload lands; two
  blocks would each have to be told the other's row count, which is one fact in
  two places and the way a zero-CLS promise quietly stops being true.

  THE LOG DOES NOT SCROLL ON A PHONE (owner ruling, 2026-09-12: there it is "an
  endless scroll field that I have to fight out of"). At that width the box
  takes no overflow of its own and shows the first rows with a control under
  them that reveals the rest inline, so the page's own scroll is the only
  scroll a thumb can land on. The control is absent on a desktop, where the box
  keeps its reserve and scrolls inside it, and absent when there is nothing to
  reveal.

  IT IS ROWS, NOT A <table>, on both sides — the reason LedgerTable gave before
  this component replaced it: every row here collapses to two stacked lines on
  a phone, and a real table cannot do that without either scrolling sideways
  (which this page does not do) or having its cells re-parented by CSS, which
  takes the table semantics away with it and leaves a grid claiming to be a
  table. Rows of a grid say the same thing honestly at both widths.

  THE HEAD ROWS ARE WORDS AND MARKS TOGETHER (owner directive, 2026-09-11,
  issue 317 — written hashless because three digits after a hash read as a
  color literal to the component sweep). Four of the table's five heads are
  MARKS, and a mark states nothing, so each head carries its word in clipped
  text: a reader who cannot see the drawing hears the column the drawing names.

  THE SHORT IDENTITY IS NOT RENDERED ON A PHONE (owner directive, 2026-09-11:
  "reduce the amount of new lines as much as possible" — a commit row is two
  lines there and a seven-character hash has no room on either). It is absent
  from the DOM rather than hidden by CSS, and that is the whole point: a
  `display: none` cell is still an element a screen reader can be walked into,
  so a phone reader would hear a hash their row does not show. The width is
  therefore a question the SCRIPT asks, through the same media seam the column
  handles use (lib/columnWidth.ts), and the first render already knows the
  answer — a host with no matchMedia answers "wide", which is the arrangement a
  document with no viewport should describe.

  Every figure arrives written. The component formats nothing, links nothing it
  was not handed, and names no repository, host or vendor: the adapter
  validated each href and composed each label, and this file renders them. -->
<script lang="ts">
  import type { LedgerSpreadProps } from '../blocks.ts';
  import { browserMedia, spreadMediaQuery, watchMedia } from '../columnWidth';
  import DetailTip from './DetailTip.svelte';
  import FeedCard from './FeedCard.svelte';
  import Icon from './Icon.svelte';
  import PanelShell from './PanelShell.svelte';

  let {
    status,
    generatedAt,
    heads,
    rows,
    emptyNote,
    logHead,
    logAnchor,
    logListId,
    logRows,
    logNote,
    logDisclosure
  }: LedgerSpreadProps = $props();

  /* The head row's marks, in column order, paired with the words the adapter
     wrote. The MARK is the visible head and the WORD is its accessible name
     (owner directive, 2026-09-11, issue 317) — the two halves of one head,
     never two heads — so the pairing is by index against the same `heads` the
     adapter already orders the columns by, and a column added without a mark
     falls back to printing its word.

     The first column keeps its word: a repository name is not a figure, and
     there is no mark that says one. */
  const headMarks: readonly (string | undefined)[] = [
    undefined,
    'pull',
    'tag',
    'star',
    'clock'
  ];

  /* Whether the sheet is wide enough for two columns — which is also whether a
     commit row has a cell for its short identity. Read once for the first
     paint so nothing arrives and then changes, then kept current for a reader
     who rotates a phone or drags a window across the breakpoint. */
  let wide = $state(browserMedia(spreadMediaQuery).matches);
  $effect(() => watchMedia(browserMedia, spreadMediaQuery, (matches) => (wide = matches)));

  /* Whether the reader has asked for the whole log. Component-local and never
     persisted: it is an answer to "show me the rest of this list", which is
     about this visit to this screen, and a stored one would decide the page's
     height before a reader has looked at it. It is deliberately NOT reset when
     the width changes — a reader who opened the log and rotated the phone
     asked for the rows, not for the orientation. */
  let expanded = $state(false);

  /* The rows this render draws. A phone with more rows than it shows at once
     draws the first few until the reader presses; every other case draws the
     whole list, which is what keeps the desktop column exactly what it was. */
  const shownLogRows = $derived(
    logDisclosure !== undefined && !wide && !expanded
      ? logRows.slice(0, logDisclosure.collapsed)
      : logRows
  );
</script>

<PanelShell {status} {generatedAt}>
  <FeedCard variant="table">
    <div class="ledger-spread">
      <div class="spread-column">
        {#if rows.length === 0}
          <p class="table-note">{emptyNote}</p>
        {:else}
          <!-- The head row is NOT aria-hidden, and that is the whole of the
            mark change (issue 317): a word a reader can see is a head a screen
            reader can skip, because every cell under it repeats it; a MARK a
            reader can see is a head nothing else states, so the word has to
            live here. Each head is therefore a span with the word as its
            accessible text, visually clipped where a mark stands in its
            place. -->
          <div class="table-head">
            {#each heads as head, index (index)}
              <span class="table-label" data-table-align={index > 0 ? 'end' : 'start'}>
                {#if headMarks[index] === undefined}
                  <span aria-hidden="true">{head}</span>
                {:else}
                  <Icon name={headMarks[index] as 'pull' | 'tag' | 'star' | 'clock'} slot="cell" />
                {/if}
                <span class="table-clipped">{head}</span>
              </span>
            {/each}
          </div>
          {#each rows as row (row.key)}
            <div class="table-row">
              <span class="table-name-cell">
                {#if row.link.href}
                  <a
                    class="table-link"
                    href={row.link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={row.link.label}>{row.link.text}</a>
                {:else}
                  <span class="table-name">{row.link.text}</span>
                {/if}
              </span>
              {#each row.counts as count (count.key)}
                <!-- Focusable so the detail's keyboard reveal matches its hover
                  reveal: the counter's words live in the detail, and a detail no
                  keyboard can open is half the feature.
                  There is no action to perform, so a button would be the wrong
                  semantics — the same shape the retired stat tiles used. -->
                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                <span class="table-count" tabindex="0" aria-label={count.label}>
                  <span class="table-glyph">
                    <Icon name={count.glyph} slot="cell" />
                  </span>
                  <span class="table-figure">{count.value}</span>
                  <span class="table-clipped">{count.label}</span>
                  <DetailTip detail={count.detail} />
                </span>
              {/each}
              <!-- The age column is a counter like the three beside it — same
                mark, same figure, same detail — so it is drawn the same way
                rather than as a bare number, which is what keeps the numerals in
                one column across every row. -->
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <span class="table-count table-age" tabindex="0" aria-label={row.updated.label}>
                <span class="table-glyph">
                  <Icon name={row.updated.glyph} slot="cell" />
                </span>
                <span class="table-figure">{row.updated.value}</span>
                <span class="table-clipped">{row.updated.label}</span>
                <DetailTip detail={row.updated.detail} />
              </span>
            </div>
          {/each}
        {/if}
      </div>
      <!-- The log column carries the id its own section used to (issue 287's
        rule: never break a URL). The nav links the section, never this — the
        anchor exists for an address a reader already shared. -->
      <div class="spread-column" id={logAnchor}>
        <div class="table-head spread-log-head">
          <span class="table-label"><Icon name="commit" slot="cell" />{logHead}</span>
        </div>
        <!-- The log's box is RESERVED, not grown into: it is exactly as tall as
          the rows the table beside it shows, so a payload landing a moment after
          first paint lands without moving the page under a reader. The empty
          note sits inside the same box for the same reason, and on a phone the
          reserve holds the collapsed log — its rows AND its control — so the
          arriving payload lands in a box that was already its size. -->
        <div class="commit-rows">
          <div class="commit-list" id={logListId}>
            {#if logRows.length === 0}
              <p class="commit-note">{logNote}</p>
            {:else}
              {#each shownLogRows as row (row.key)}
                <div class="commit-row">
                  <span class="commit-age">{row.age}</span>
                  {#if row.source.href}
                    <a
                      class="commit-source"
                      href={row.source.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={row.source.label}>{row.source.text}</a>
                  {:else}
                    <span class="commit-source-text">{row.source.text}</span>
                  {/if}
                  {#if row.title.href}
                    <a
                      class="commit-title"
                      href={row.title.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={row.title.label}>{row.title.text}</a>
                  {:else}
                    <span class="commit-title-text">{row.title.text}</span>
                  {/if}
                  {#if wide}<span class="commit-mark">{row.mark}</span>{/if}
                </div>
              {/each}
            {/if}
          </div>
          <!-- THE PHONE'S DISCLOSURE (owner ruling, 2026-09-12: the log is "an
            endless scroll field that I have to fight out of" there). At that
            width the box stops scrolling and shows the first rows with this
            control under them, so the only scroll is the page's own. It is a
            real <button> carrying `aria-expanded` and naming the list it grows,
            which is what brings keyboard operation and the disclosure role with
            it — the same answer LedgerLog's openable row gives.

            IT IS ABSENT ON A DESKTOP rather than hidden, for the reason the
            short identity beside it is: a `display: none` control is still
            something a screen reader can be walked into, and there is nothing
            for it to do where the box keeps its reserve and scrolls. And it is
            absent when the adapter built no disclosure, which is its way of
            saying the log holds nothing the collapsed list does not show. -->
          {#if logDisclosure !== undefined && !wide}
            <button
              class="commit-disclosure"
              type="button"
              aria-expanded={expanded}
              aria-controls={logListId}
              onclick={() => (expanded = !expanded)}
              >{expanded ? logDisclosure.fewer : logDisclosure.more}</button>
          {/if}
        </div>
      </div>
    </div>
  </FeedCard>
</PanelShell>
