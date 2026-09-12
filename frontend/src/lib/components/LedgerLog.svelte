<!-- LedgerLog is the openable ruled row (owner directive, 2026-09-03, issue
  287): a line of facts across four columns, a chevron at its end, and a drawer
  of points that grows open underneath it.

  IT IS THE ROW THAT OPENS, not a control tucked into the row. The owner asked
  for the whole line to be the target, which is also the accessible answer — a
  32px chevron beside a 17px name is two things to aim at where there is one
  thing to do. So the row is a real `<button>` with `aria-expanded`, which
  brings keyboard operation, the disclosure role and the focus ring with it and
  needs no ARIA of this component's own.

  THE ENTRY'S OWN LINK LIVES INSIDE THE DRAWER, and that is a consequence of
  the sentence above rather than a preference. The employers became links at
  the owner's direction (2026-08-28, issue 243) and they stay links — but an
  anchor inside a button is invalid content, unreachable by a keyboard, and
  ambiguous to every assistive technology, so the two cannot share the row.
  Inside the drawer the link is a link, at the site's own touch floor, beside
  the points it belongs to.

  THE DRAWER GROWS RATHER THAN SNAPS. `grid-template-rows: 0fr → 1fr` over an
  `overflow: hidden` wrapper is the one arrangement that animates to a content
  height nobody measured, which is why it is that and not a max-height guess: a
  max-height large enough for the longest entry runs the transition at the
  wrong speed for every shorter one. Under reduced motion the same two states
  apply instantly — the row still opens, it simply does not travel.

  No domain anywhere: a span, a name, a role, a place, and points. The work
  history renders it today. -->
<script lang="ts">
  import type { LedgerLogProps } from '../blocks.ts';
  import FeedCard from './FeedCard.svelte';
  import Icon from './Icon.svelte';

  let { rows, emptyNote, expandLabel, collapseLabel }: LedgerLogProps = $props();

  /* Which rows are open, by key. Collapsed by default (owner directive,
     2026-09-03: the section opens as a summary and expands on request), and
     held as a set rather than a single index because the owner opens more than
     one at a time when comparing two roles. */
  let opened = $state(new Set<string>());

  function toggle(key: string): void {
    const next = new Set(opened);
    if (!next.delete(key)) {
      next.add(key);
    }
    opened = next;
  }
</script>

<FeedCard variant="ledger">
  {#if rows.length === 0}
    <p class="ledger-note">{emptyNote}</p>
  {:else}
    {#each rows as row (row.key)}
      {@const open = opened.has(row.key)}
      <div class="ledger-entry">
        <button
          class="ledger-row"
          type="button"
          aria-expanded={open}
          aria-label={`${open ? collapseLabel : expandLabel} ${row.name}`}
          data-open={open ? 'true' : 'false'}
          onclick={() => toggle(row.key)}>
          <span class="ledger-span">{row.span}</span>
          <!-- THE MONOGRAM IS NOT A LOGO (owner design decision, 2026-09-11,
            issue 313). An employer's logo is its trademark and this page draws
            none; two letters in the site's own ink, inside the same hairline
            square the rest of the sheet is ruled with, identify the row at a
            glance without borrowing anyone's art. The letters are DATA, from
            the entry — deriving them would have to guess at "University of
            Maryland, Baltimore County — LIDAR Research Group" — and the tile
            is aria-hidden because the row's accessible name already carries
            the employer in full. -->
          <span class="ledger-monogram" aria-hidden="true">{row.mark}</span>
          <span class="ledger-name">{row.name}</span>
          <span class="ledger-role">{row.role}</span>
          <span class="ledger-place">{row.place}</span>
          <!-- The chevron POINTS at what it does: down to open, up to close.
            It is a glyph swap rather than a rotation (owner design decision,
            2026-09-11, issue 313) because the disc it sits in already answers
            the open state by inverting, and inverting AND spinning is two
            announcements of one fact — and a swap adds no transform, so a
            reader who asked for less motion sees the same thing everyone
            else does. -->
          <span class="ledger-chevron" aria-hidden="true">
            <Icon name={open ? 'chevron-up' : 'chevron-down'} slot="row" />
          </span>
        </button>
        <div class="ledger-drawer" data-open={open ? 'true' : 'false'}>
          <div class="ledger-drawer-clip">
            <ul class="ledger-points">
              {#each row.points as point, index (index)}
                <li class="ledger-point">{point}</li>
              {/each}
            </ul>
            {#if row.link && row.link.href}
              <a
                class="ledger-link"
                href={row.link.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={row.link.label}>{row.link.text}</a>
            {/if}
          </div>
        </div>
      </div>
    {/each}
  {/if}
</FeedCard>
