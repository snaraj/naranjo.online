<!-- PageHeader is the ledger's chrome row (owner directive, 2026-09-03, issue
  287): the home link at the start, the section nav across the middle, and the
  place plus the reading mode at the end, between two rules.

  It used to be one icon pinned to the viewport's top-end corner (issue 168),
  out of the document flow so dragging the column could not move it. The ledger
  gives it a real row across the top of the sheet instead, which answers the
  same complaint differently: the row spans the page rather than sitting beside
  the column, so the column's width does not reach it either — and a row that
  is IN the flow costs no reserve arithmetic, no plate behind it, and cannot
  pass over content the reader scrolls, which is the whole class of defect
  issue 219 and issue 264 were both about.

  THE ROW IS BOOKENDED BY THE SAME DRAGON (owner ruling, 2026-09-12, issue
  325: "replace this with another dragon facing inwards to match the opposite
  side"). The start of the row was the "SN." wordmark; it is Rime now, mirrored
  on the inline axis so he faces into the row rather than out of it. The LINK
  is unchanged in every way that matters — same class, same 44px box, same
  anchor to the page's own name — and it is still the row's first stop. What
  changed is what it draws and where its name comes from: the mark is
  aria-hidden, and the link is named by the heading it scrolls to
  (aria-labelledby), so the page's name is stated once, in the masthead, and a
  screen reader hears "Samuel Naranjo" rather than a literal this component
  spells a second time.

  The nav is here for the same reason the row is: the ledger's own drawing puts
  the section links in this row, and a nav in the chrome is a nav that stays one
  line at every width instead of wrapping under a masthead that is already the
  tallest thing on the page. It scrolls sideways inside itself on a phone rather
  than wrapping, so the row's height is the same at every width.

  The place is the owner's own portfolio location, the same public fact the
  work entries carry. It reads as a pin and a STATE (owner ruling, 2026-09-12,
  issue 327): the mark says "place" in the channel a glyph is good at, and the
  place itself is California — the city was more precision than a portfolio
  line owes anyone, while the state is the fact a reader actually uses. The pin
  is aria-hidden and the span reads "California" to a screen reader too, so the
  two channels say the same thing. The phone rule that hides this whole span is
  untouched.

  Rime closes the row (owner decision, 2026-09-11, issue 314) and closes it
  LAST on purpose: he is a picture rather than a control, so putting him after
  the reading mode leaves the row's keyboard order exactly as the rendering
  lanes pin it — the home link, the nav, the mode — with nothing new between
  any two stops. -->
<script lang="ts">
  import ThemeMenu from '../ThemeMenu.svelte';
  import Icon from './Icon.svelte';
  import RimeMark from './RimeMark.svelte';
  import SectionNav from './SectionNav.svelte';
</script>

<header class="page-header">
  <a class="page-mark" href="#page-title" aria-labelledby="page-title"><RimeMark mirrored /></a>
  <SectionNav />
  <div class="page-chrome">
    <span class="page-place"><Icon name="location" slot="chrome" />California</span>
    <ThemeMenu />
    <RimeMark />
  </div>
</header>
