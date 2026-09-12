<!-- Icon draws one glyph of the Hairline family (owner design decision,
  2026-09-11, issue 313). It is the ONLY place on the site that writes an
  <svg> for a mark, which is what makes the family one contract: the viewBox,
  the four stroke attributes and the assistive-technology posture are written
  once here, and lib/icons.ts holds nothing but the drawings.

  NOTHING HERE RENDERS MARKUP. The obvious shape for an icon component is a
  string of SVG per glyph handed to Svelte's raw-HTML directive — and no
  component in this tree may contain that directive at all:
  tests/tooltip.test.mjs sweeps every .svelte file under src/ for it, because
  rendering a string as markup is the one construct that could turn payload
  text into live elements. Admitting one file would weaken a tree-wide guard
  to buy nothing, so a glyph is a list of SHAPES and each shape is a real
  element with real attributes. The guard stays exactly as strict as it was,
  and lib/icons.ts records the same decision from the data's side. (That
  sweep reads raw text, so this paragraph names the directive in prose rather
  than spelling it — a comment is not a declaration, and the sweep is right
  to refuse to tell them apart.)

  A <use> sprite was the other candidate and it was measured on the design
  canvas: a referenced <symbol> does NOT inherit stroke, stroke-width,
  stroke-linecap or stroke-linejoin from the <use> instance, so a sprite makes
  every drawing repeat the weight and a weight change becomes sixty-one edits.
  Drawing the shapes under one shell keeps it at one.

  The mark is aria-hidden and focusable="false" WITHOUT exception. A mark that
  replaces a word never carries the word: the control it sits in does, through
  an aria-label or the visually-hidden text beside it (issue 313's ruling), so
  a reader who cannot see the drawing hears the same sentence a reader who can
  sees. focusable="false" is not redundant with aria-hidden — it is what keeps
  the <svg> out of the tab order in Internet-Explorer-derived engines, and it
  costs one attribute in one file.

  The ink is currentColor and nothing else, so a mark follows all four reading
  modes with no theme branch and the family adds no colour token.

  Size comes from the slot the mark sits in, never from the call site: chrome
  (the header row), row (a list or control line) and cell (a table figure) are
  the three the site has, each one token in styles.css. A fourth size would be
  a fourth token, not a number written at a call site. -->
<script lang="ts">
  import { iconParts, type IconName, type IconSlot } from '../icons.ts';

  let { name, slot = 'row' }: { name: IconName; slot?: IconSlot } = $props();
</script>

<svg
  class="icon icon-{slot}"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.25"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false">
  <!-- A solid part is the same one ink, filled instead of stroked, and it
    says so by OVERRIDING the shell's two attributes rather than by carrying
    its own paint: the data states geometry and a flag, never a colour. A
    stroked part passes null for both, which Svelte renders as no attribute at
    all, so the shell's fill="none" and stroke="currentColor" are what paint
    it — one statement of the family's ink, in one place. -->
  {#each iconParts(name) as part, index (index)}
    <svelte:element
      this={part.tag}
      {...part.attrs}
      fill={part.solid ? 'currentColor' : null}
      stroke={part.solid ? 'none' : null} />
  {/each}
</svg>

<style>
  /* The box is exactly the token, in both axes, and it never grows or shrinks
     with its neighbours — a mark that flexed would move the text beside it
     and put a layout shift in a row that has none. Painting is entirely
     inherited: the ink is the text's own colour, so no rule here names one.

     The optical baseline nudge is on the mark rather than on the text: a
     24-grid drawing centred on its own box sits a touch high against a
     lowercase line, and every surface that uses the family would otherwise
     have to correct it itself. */
  .icon {
    display: inline-block;
    flex: none;
    vertical-align: -0.15em;
  }

  .icon-chrome {
    inline-size: var(--icon-chrome);
    block-size: var(--icon-chrome);
  }

  .icon-row {
    inline-size: var(--icon-row);
    block-size: var(--icon-row);
  }

  .icon-cell {
    inline-size: var(--icon-cell);
    block-size: var(--icon-cell);
  }
</style>
