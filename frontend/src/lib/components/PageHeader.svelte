<!-- PageHeader is the ledger's chrome row (owner directive, 2026-09-03, issue
  287): a wordmark at the start, the section nav across the middle, and the
  place plus the reading mode at the end, between two rules.

  It used to be one icon pinned to the viewport's top-end corner (issue 168),
  out of the document flow so dragging the column could not move it. The ledger
  gives it a real row across the top of the sheet instead, which answers the
  same complaint differently: the row spans the page rather than sitting beside
  the column, so the column's width does not reach it either — and a row that
  is IN the flow costs no reserve arithmetic, no plate behind it, and cannot
  pass over content the reader scrolls, which is the whole class of defect
  issue 219 and issue 264 were both about.

  The nav moved here from under the name for the same reason: the ledger's own
  drawing puts the five section links in this row, and a nav in the chrome is a
  nav that stays one line at every width instead of wrapping under a masthead
  that is already the tallest thing on the page. It scrolls sideways inside
  itself on a phone rather than wrapping, so the row's height is the same at
  every width.

  The place is the owner's own portfolio location, the same public fact the
  work entries carry. It reads as a pin and a city now (owner design decision,
  2026-09-11, issue 313): the mark says "place" in the channel a glyph is good
  at, so the two-letter state abbreviation — the one part of the line a reader
  gains nothing from — goes, and the CITY stays as words because a place name
  is a fact, not a label. The pin is aria-hidden and the span still reads
  "Irvine" to a screen reader, so nothing was removed from the accessibility
  tree; a word was removed from the page. The phone rule that hides this whole
  span is untouched. -->
<script lang="ts">
  import ThemeMenu from '../ThemeMenu.svelte';
  import Icon from './Icon.svelte';
  import SectionNav from './SectionNav.svelte';
</script>

<header class="page-header">
  <a class="page-mark" href="#page-title">SN.</a>
  <SectionNav />
  <div class="page-chrome">
    <span class="page-place"><Icon name="location" slot="chrome" />Irvine</span>
    <ThemeMenu />
  </div>
</header>
