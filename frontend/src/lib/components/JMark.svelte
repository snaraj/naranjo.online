<!-- J, the owner's dragon, typing at a laptop (owner request, 2026-10-12:
  "replace the dragon to use J's latest iteration and use him typing on the
  computer now instead of just flying"). He bookends the chrome row in the two
  seats the flying dragon held (issue 314 at the end of the row; issue 325 at
  the start, "another dragon facing inwards to match the opposite side").

  ONE COMPONENT FOR BOTH SEATS, and `mirrored` is the whole difference. The
  render faces screen-right, toward his laptop, so the start of the row draws
  him as rendered and the END is the mirrored seat: both face into the row.
  The sheet, the still, the reserved box and both steps() animations are
  stated once in styles.css and shared, so the second J costs no second URL:
  two elements naming one background-image are one resource the browser
  fetches once. The flip is a class rather than a style attribute because this
  origin serves no `unsafe-inline` (and it is a static transform, not motion —
  a reader who asked for less of it gets the same pose, facing the same way).

  He is a PICTURE and nothing else: no text, no link, no control, and
  aria-hidden, in both seats. The home link around the first one carries the
  accessible name — it is named by the page's own heading, the thing it scrolls
  to — and the keyboard order the rendering lanes pin (the home link, the nav,
  the reading mode) gains no stop, because a span is not one. A decorative
  image that announced itself would be a name a screen reader reads past on
  every visit, beside a link that already says where it goes.

  Everything else about him is stated in styles.css beside the rest of the
  chrome row, for the reason the row itself is: the sheet and the still are
  bundled assets the stylesheet resolves, the typing loop is declared inside
  the site's one no-preference block, and a component-scoped rule could state
  neither. This file is therefore the element, its name, and which way it
  faces. -->
<script lang="ts">
  let { mirrored = false }: { mirrored?: boolean } = $props();
</script>

<span class="j-mark" class:j-mark-mirrored={mirrored} aria-hidden="true"></span>
