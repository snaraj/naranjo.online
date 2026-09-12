<!-- Rime, the owner's dragon. He flies at the end of the chrome row (owner
  decision, 2026-09-11, issue 314, design canvas rounds 2-6) and, since the
  owner's ruling of 2026-09-12, at the START of it as well — the home link's
  own drawing, facing inwards so the two bookend the row (issue 325: "replace
  this with another dragon facing inwards to match the opposite side").

  ONE COMPONENT FOR BOTH SEATS, and `mirrored` is the whole difference. The
  sheet, the reserved box, the still at frame 0 and both steps() animations are
  stated once in styles.css and shared, so the second dragon costs no second
  URL: two elements naming one background-image are one resource the browser
  fetches once. The flip is a class rather than a style attribute because this
  origin serves no `unsafe-inline` (and it is a static transform, not motion —
  a reader who asked for less of it gets the same pose, facing the same way).

  He is a PICTURE and nothing else: no text, no link, no control, and
  aria-hidden, in both seats. The home link around the mirrored one carries the
  accessible name — it is named by the page's own heading, the thing it scrolls
  to — and the keyboard order the rendering lanes pin (the home link, the nav,
  the reading mode) gains no stop, because a span is not one. A decorative
  image that announced itself would be a name a screen reader reads past on
  every visit, beside a link that already says where it goes.

  Everything else about him is stated in styles.css beside the rest of the
  chrome row, for the reason the row itself is: the sheet is a bundled asset
  the stylesheet resolves, the flight is declared inside the site's one
  no-preference block, and a component-scoped rule could state neither. This
  file is therefore the element, its name, and which way it faces. -->
<script lang="ts">
  let { mirrored = false }: { mirrored?: boolean } = $props();
</script>

<span class="rime-mark" class:rime-mark-mirrored={mirrored} aria-hidden="true"></span>
