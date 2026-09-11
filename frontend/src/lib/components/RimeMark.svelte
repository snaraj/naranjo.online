<!-- Rime, the owner's dragon, flying at the end of the chrome row (owner
  decision, 2026-09-11, issue 314, design canvas rounds 2-6).

  He is a PICTURE and nothing else: no text, no link, no control, and
  aria-hidden. SN. at the start of the row is the page's accessible mark, and
  the keyboard order the rendering lanes pin — the wordmark, the nav, the
  reading mode — must not gain a stop. A decorative image that announced
  itself would be a fourth stop on the way to the reading mode and a name a
  screen reader has to read past on every visit.

  Everything else about him is stated in styles.css beside the rest of the
  chrome row, for the reason the row itself is: the sheet is a bundled asset
  the stylesheet resolves, the flight is declared inside the site's one
  no-preference block, and a component-scoped rule could state neither. This
  file is therefore the element and its name, which is all a mark is. -->
<span class="rime-mark" aria-hidden="true"></span>
