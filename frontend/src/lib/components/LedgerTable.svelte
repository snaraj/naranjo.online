<!-- LedgerTable is the ruled table (owner directive, 2026-09-03, issue 287): a
  head of column labels, then one row per record — a linked name, a
  single-line description, a cluster of counters, and a coarse age.

  IT IS ROWS, NOT A <table>. Every one of these rows collapses to three
  stacked lines on a phone, and a real table cannot do that without either
  scrolling sideways (which this page does not do) or having its cells
  re-parented by CSS, which takes the table semantics away with it and leaves
  a grid claiming to be a table. Rows of a grid say the same thing honestly at
  both widths.

  THE HEAD ROW IS WORDS AND MARKS TOGETHER (owner directive, 2026-09-11, issue
  317 — written hashless because three digits after a hash read as a color
  literal to the component sweep). It used to be `aria-hidden` wholesale,
  because every label under it was repeated in its own cell's accessible text.
  Four of the six heads are MARKS now, and a mark states nothing, so each head
  carries its word in clipped text instead: a reader who cannot see the drawing
  hears the column the drawing names.

  Every figure arrives written. The component formats nothing, links nothing
  it was not handed, and names no repository, host or vendor: the adapter
  validated each href and composed each label, and this file renders them. -->
<script lang="ts">
  import type { LedgerTableProps } from '../blocks.ts';
  import DetailTip from './DetailTip.svelte';
  import FeedCard from './FeedCard.svelte';
  import Icon from './Icon.svelte';
  import PanelShell from './PanelShell.svelte';

  let { title, status, generatedAt, heads, rows, emptyNote, staleNote }: LedgerTableProps = $props();

  /* The head row's marks, in column order, paired with the words the adapter
     wrote. The MARK is the visible head and the WORD is its accessible name
     (owner directive, 2026-09-11, issue 317) — the two halves of one head,
     never two heads — so the pairing is by index against the same `heads` the
     adapter already orders the columns by, and a column added without a mark
     falls back to printing its word.

     The first two columns keep their words: a repository name and a
     description are not figures, and there is no mark that says either. */
  const headMarks: readonly (string | undefined)[] = [
    undefined,
    undefined,
    'pull',
    'tag',
    'star',
    'clock'
  ];
</script>

<PanelShell {title} {status} {generatedAt} note={staleNote}>
  <FeedCard variant="table">
    {#if rows.length === 0}
      <p class="table-note">{emptyNote}</p>
    {:else}
      <!-- The head row is NOT aria-hidden any more, and that is the whole of
        the mark change (issue 317): a word a reader can see is a head a
        screen reader can skip, because every cell under it repeats it; a MARK
        a reader can see is a head nothing else states, so the word has to live
        here. Each head is therefore a span with the word as its accessible
        text, visually clipped where a mark stands in its place. -->
      <div class="table-head">
        {#each heads as head, index (index)}
          <span class="table-label" data-table-align={index > 1 ? 'end' : 'start'}>
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
          <span class="table-summary">{row.summary}</span>
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
          <!-- The age column is a counter like the three beside it — same mark,
            same figure, same detail — so it is drawn the same way rather than
            as a bare number, which is what keeps the numerals in one column
            across every row. -->
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
  </FeedCard>
</PanelShell>
