<!-- LedgerTable is the ruled table (owner directive, 2026-09-03, issue 287): a
  head of column labels, then one row per record — a linked name, a
  single-line description, a cluster of counters, and a coarse age.

  IT IS ROWS, NOT A <table>. Every one of these rows collapses to three
  stacked lines on a phone, and a real table cannot do that without either
  scrolling sideways (which this page does not do) or having its cells
  re-parented by CSS, which takes the table semantics away with it and leaves
  a grid claiming to be a table. Rows of a grid say the same thing honestly at
  both widths, and the head row is `aria-hidden` because its labels are
  already in each cell's own accessible text — a column head a screen reader
  reads twice is worse than one it reads never.

  Every figure arrives written. The component formats nothing, links nothing
  it was not handed, and names no repository, host or vendor: the adapter
  validated each href and composed each label, and this file renders them. -->
<script lang="ts">
  import type { LedgerTableProps } from '../blocks.ts';
  import DetailTip from './DetailTip.svelte';
  import FeedCard from './FeedCard.svelte';
  import PanelShell from './PanelShell.svelte';

  let { title, status, generatedAt, heads, rows, emptyNote, staleNote }: LedgerTableProps = $props();
</script>

<PanelShell {title} {status} {generatedAt} note={staleNote}>
  <FeedCard variant="table">
    {#if rows.length === 0}
      <p class="table-note">{emptyNote}</p>
    {:else}
      <div class="table-head" aria-hidden="true">
        {#each heads as head, index (index)}
          <span class="table-label" data-table-align={index > 1 ? 'end' : 'start'}>{head}</span>
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
              reveal: the counter's words and its provenance live in the
              detail, and a detail no keyboard can open is half the feature.
              There is no action to perform, so a button would be the wrong
              semantics — the same shape the retired stat tiles used. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <span class="table-count" tabindex="0" aria-label={count.label}>
              <span class="table-glyph" aria-hidden="true">
                {#if count.glyph === 'star'}
                  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"
                    ><path
                      d="M8 1.6 10 6l4.7.4-3.6 3.1 1.1 4.6L8 11.6 3.8 14.1l1.1-4.6L1.3 6.4 6 6z"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.4"
                      stroke-linejoin="round" /></svg>
                {:else if count.glyph === 'issue'}
                  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"
                    ><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4" />
                    <circle cx="8" cy="8" r="1.8" fill="currentColor" /></svg>
                {:else}
                  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"
                    ><path
                      d="M4.5 4.2v7.6M11.5 6.6v5.2M4.5 4.2a1.6 1.6 0 1 0 0-.1zM11.5 13.4a1.6 1.6 0 1 0 0-.1zM4.5 4.2h4.4a2.6 2.6 0 0 1 2.6 2.6"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.4"
                      stroke-linecap="round" /></svg>
                {/if}
              </span>
              <span class="table-figure">{count.value}</span>
              <span class="table-clipped">{count.label}</span>
              <DetailTip detail={count.detail} />
            </span>
          {/each}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <span class="table-age" tabindex="0" aria-label={row.updated.label}>
            {row.updated.value}
            <DetailTip detail={row.updated.detail} />
          </span>
        </div>
      {/each}
    {/if}
  </FeedCard>
</PanelShell>
