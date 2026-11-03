<!-- Pager turns a list one page at a time (owner, 2026-11-02, issue 399:
  "sleek pagination"): a step back, where the reader is, a step on. It is
  shared by every paged list on the sheet — the stream and the gallery's
  mosaic — so a page turns the same way wherever it turns.

  IT IS ALWAYS THERE. A list of one page still draws the pager, both steps
  disabled, because its row is part of the height the list reserves: a pager
  that appeared when a second page did would move everything under it.

  The steps are real buttons at the touch floor, named by the words the
  caller hands it; where the reader is, is said politely when it changes.
  Nothing here knows what is being paged. -->
<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    page,
    pages,
    previousLabel,
    nextLabel,
    onturn
  }: {
    page: number;
    pages: number;
    previousLabel: string;
    nextLabel: string;
    onturn: (next: number) => void;
  } = $props();
</script>

<div class="pager">
  <button
    class="pager-step"
    type="button"
    data-step="previous"
    aria-label={previousLabel}
    aria-disabled={page <= 1}
    disabled={page <= 1}
    onclick={() => onturn(page - 1)}><Icon name="chevron-left" slot="row" /></button>
  <span class="pager-count" role="status" aria-live="polite" aria-label={`page ${page} of ${pages}`}
    >{page} / {pages}</span>
  <button
    class="pager-step"
    type="button"
    data-step="next"
    aria-label={nextLabel}
    aria-disabled={page >= pages}
    disabled={page >= pages}
    onclick={() => onturn(page + 1)}><Icon name="chevron-right" slot="row" /></button>
</div>

<style>
  /* Under the list, at its inline end; centred on a phone, where the thumb
     that turns it is. */
  .pager {
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  .pager-step {
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

  .pager-step:not(:disabled):hover {
    color: var(--ledger-ink);
  }

  /* A step with nowhere to go is the same mark, quieter: no colour of its
     own and no border, so the pager does not change shape at either end. */
  .pager-step:disabled {
    opacity: var(--pager-rest-dim);
    cursor: default;
  }

  .pager-step:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }

  .pager-count {
    font-family: var(--font-mono);
    font-size: var(--ledger-figure-size);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--ledger-muted);
  }

  @media (max-width: 45rem) {
    .pager {
      justify-content: center;
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .pager-step {
      transition: color var(--ledger-hover);
    }
  }
</style>
