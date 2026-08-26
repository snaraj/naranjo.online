/* The real width of this platform's scrollbar, measured once (issue 130).
 *
 * ContributionGrid's strip clips a wide window behind its own horizontal
 * scrollbar and reserves a gutter for it inside a FIXED block size, because
 * the box has to be identical before and after its data arrives (the zero-CLS
 * floor). Reserving a gutter means guessing how thick a scrollbar is — and the
 * guess was wrong: the strip held 0.75rem, of which the month axis's own top
 * margin had already taken 0.1875rem, leaving 9px for a scrollbar that is 15px
 * on a classic Windows or Linux theme. The month axis clipped.
 *
 * A guess cannot be made right by picking a bigger number, because there is no
 * number that is right everywhere: overlay scrollbars (macOS, most phones)
 * take zero space, classic ones take 15 to 17 depending on the theme, and a
 * reader can change theirs. So the gutter is MEASURED here, from a probe the
 * engine lays out itself, and handed to the stylesheet as a custom property.
 *
 * Two properties make that safe rather than clever:
 *
 *   * it is a FLOOR, never a shrink. The measured value only ever widens the
 *     gutter past the reserve the stylesheet ships with (scrollbarGutterFallbackPx,
 *     pinned against --grid-scrollbar-size's own fallback by a test that names
 *     both). A platform with overlay scrollbars keeps exactly the box it has
 *     always had instead of losing 12px of it, so this can move a layout in one
 *     direction only — outward, on the platforms that were clipping.
 *   * it is applied BEFORE the application mounts (main.ts), in the same
 *     synchronous task, so no grid is ever painted at one gutter and re-laid at
 *     another. The static shell the document ships with renders no grid at all,
 *     so there is nothing earlier to shift either.
 *
 * The decision — what the gutter should be, given a measurement — is a plain
 * function a node test executes. Only the probe itself needs a browser, and the
 * rendering lanes measure what it produced: a strip whose CLIENT box still
 * holds every one of its own rows once the engine's real scrollbar has taken
 * its share.
 */

/* The gutter the stylesheet reserves before anything has measured one, in CSS
 * pixels. It is the fallback written into --grid-scrollbar-size's own var()
 * usages (ContributionGrid.svelte), and a test compares the two so the reserve
 * cannot drift away from the floor. */
export const scrollbarGutterFallbackPx = 12;

/* The custom property the strip's block size reads. */
export const scrollbarGutterProperty = '--grid-scrollbar-size';

/* scrollbarGutterPx decides the gutter from one measurement.
 *
 * Anything the probe could not measure — zero for an overlay scrollbar, a
 * negative or non-finite number from a host that does not lay out at all —
 * resolves to the shipped reserve rather than to nothing: a strip with no
 * gutter would be a different box from the one the empty state holds open, and
 * the arrival of data would move the page. A real measurement is rounded UP,
 * because a gutter half a pixel short is a clipped row. */
export function scrollbarGutterPx(
  measuredPx: number,
  fallbackPx: number = scrollbarGutterFallbackPx
): number {
  if (!Number.isFinite(measuredPx) || measuredPx <= 0) {
    return fallbackPx;
  }
  return Math.max(fallbackPx, Math.ceil(measuredPx));
}

/* measureScrollbarPx lays out a throwaway box that is forced to scroll and
 * reports how much of it the engine gave to the scrollbar.
 *
 * `overflow: scroll` rather than `auto` on purpose: auto only draws a bar when
 * the content overflows, and this probe has no content — what is being asked
 * is how thick THIS PLATFORM's bar is, not whether one particular strip is
 * currently scrolling. The box is positioned far off-screen and removed in the
 * same task, so nothing is ever visible and no layout the reader can see is
 * touched. A host that reports no geometry (a server render, a fake in a test)
 * returns 0, which the decision above reads as "nothing measured". */
export function measureScrollbarPx(doc: Document): number {
  const probe = doc.createElement('div');
  probe.style.cssText =
    'position:absolute;top:-9999px;left:-9999px;width:100px;height:100px;overflow:scroll;';
  doc.body.appendChild(probe);
  const thickness = probe.offsetHeight - probe.clientHeight;
  probe.remove();
  return Number.isFinite(thickness) ? thickness : 0;
}

/* applyScrollbarGutter measures once and writes the result onto the document
 * root, where every grid on the page reads it. Returns the value it wrote, so
 * a caller — or a lane — can assert on the number rather than on the fact that
 * something was called. */
export function applyScrollbarGutter(doc: Document): number {
  const gutter = scrollbarGutterPx(measureScrollbarPx(doc));
  doc.documentElement.style.setProperty(scrollbarGutterProperty, `${gutter}px`);
  return gutter;
}
