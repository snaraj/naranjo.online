<script lang="ts">
  import ColumnHandles from './lib/components/ColumnHandles.svelte';
  import JMark from './lib/components/JMark.svelte';
  import NightSky from './lib/components/NightSky.svelte';
  import PageSection from './lib/components/PageSection.svelte';
  import ThemeMenu from './lib/ThemeMenu.svelte';
  import { syncThemeColor } from './lib/themes.ts';
  import { sectionOrdinal } from './lib/blocks.ts';
  import { page } from './page.ts';

  /* A REFRESH LOADS AT THE TOP (owner report, issue 171). A browser remembers a
     scroll offset per history entry, independent of the URL, and restores it on
     a reload — so a reader who refreshed mid-page was put back mid-page rather
     than on the name. Turning that memory off once is what makes a refresh load
     the page as a first visit would. It lived in the section nav, beside the
     fragment handling it was found with; the nav is gone (owner direction,
     2026-10-16: "do away with it for now") and the behaviour is the page's, so
     it lives with the page. */
  if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }

  /* THE BROWSER'S TOOLBARS WEAR THE SHEET (owner directive, 2026-09-04, issue
     294). A chosen reading mode is synced by the toggle (lib/themes.ts); under
     auto the sheet's colour follows the device, so a device that changes its
     mind mid-visit is synced here. ONE FRAME LATER, measured: the change event
     fires before the stylesheet's own media query has been re-evaluated, so a
     read inside the handler still returns the colour the sheet is leaving.

     The picture bands that used to share this listener are gone (owner
     direction, 2026-10-16: "remove the stock image from this only leave it with
     my name"), and with them the only other reader of the reading mode here. */
  $effect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      requestAnimationFrame(syncThemeColor);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  });

  /* The first sync: the origin stamped the mode before any script ran, so
     the toolbars are told the sheet's colour once at hydration and then only
     when it changes (owner directive, 2026-09-04, issue 294). */
  $effect(() => {
    syncThemeColor();
  });
</script>

<!-- The description meta moved to index.html's static head with the
  link-preview tags (0.1.52): a scraper reads the document as served, so a
  head contribution made at hydration was invisible to exactly the readers a
  description exists for — and two copies, one static and one hydrated,
  would be the same fact written twice. -->

<!-- No pull-to-refresh surface any more (owner ruling, 2026-09-04, issue
  294). The page used to run its own pull gesture over a suppressed native
  overscroll (issue 219), and on a phone that read as rigid, with the
  indicator bleeding in at the top; the platform's own bounce is the feel the
  owner asked for, and the panels refresh themselves (issue 179), so the
  gesture, its indicator and its keyboard control are gone rather than
  re-tuned. -->
<!-- The night sky behind the page (owner direction, 2026-10-16). It is fixed
  and decorative, so it takes no room and cannot move anything above it. -->
<NightSky />

<!-- THE SHEET OPENS ON THE NAME (owner direction, 2026-10-16: "remove the stock
  image from this only leave it with my name, also find a better way to work
  the navigation bar away from the top of the screen and just do away with it
  for now, put J elsewhere"). There is no chrome row above the sheet and no
  picture band at either end of it: the name, the numbered sections, and a
  footer that carries the reading mode.

  What the sections ARE lives in src/page.ts, the manifest (owner directive,
  issue 165): this file renders that array and is otherwise inert. Adding a
  block or reordering the page happens there; this file changes when the page's
  CHROME changes, nothing else — and the masthead, J and the footer are exactly
  that. Every section keeps its id, so a shared .../#trackers still lands on
  its section with no nav on the page to have linked it. -->
<main aria-labelledby="page-title">
  <div class="page-intro">
    <h1 id="page-title">Samuel Naranjo</h1>
    <!-- J FLIES OFF THE NAME'S UPPER RIGHT (owner direction, 2026-10-16: "put J
      elsewhere"). One of him now, where the bar used to hold two: a picture
      and nothing else, aria-hidden inside his own component, out of the flow
      here so the name sits exactly where the static shell put it, and placed
      by the name's own size so he scales with it. See the style below. -->
    <span class="page-j"><JMark /></span>
    <!-- The rule under the name is drawn rather than declared: a border would
      simply be there, and the owner asked for it to arrive. Under reduced
      motion it is already drawn on the first frame — the same rule, without
      the arrival — which is why the dash offset is animated by a class the
      motion query owns rather than by an attribute this file sets. -->
    <svg class="masthead-rule" width="100%" height="3" viewBox="0 0 1440 3" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="1.5" x2="1440" y2="1.5" stroke="currentColor" stroke-width="3" />
    </svg>
  </div>

  {#each page as section, position (section.id)}
    <PageSection {section} ordinal={sectionOrdinal(position)} />
  {/each}

  <!-- THE READING MODE MOVED TO THE FOOTER with the bar it lived in (owner
    direction, 2026-10-16). Same control, same 44px target, same keyboard and
    popover; it sits beside the version mark, and its menu opens upward from
    there because the footer is the last thing on the sheet. -->
  <footer class="page-footer">
    <span class="footer-mark">naranjo.online v{__SITE_VERSION__}</span>
    <ThemeMenu />
  </footer>

  <!-- The reader's grip on the column (owner directive, 2026-08-24). It sits
    INSIDE main because main is the column: the two handles are drawn against
    its edges, so the element that resizes is also the box they measure
    themselves against and no width arithmetic is copied anywhere. They are
    out of flow, so nothing above them moves when they arrive, and they are
    rendered only where there is room for them — which is why a phone never
    receives them at all. -->
  <ColumnHandles />
</main>

<style>
  /* J'S SEAT. The intro is his containing block and he is out of its flow, so
     the name, the rule and everything under them are exactly where the static
     shell (index.html) holds them before he exists — he arrives over the sheet
     rather than into it, and there is nothing for him to push.

     HE IS MEASURED IN THE NAME'S OWN SIZE. The seat's font-size is the token
     the name is set in, so an em here is one name-size and every length below
     scales with the masthead: a 165px name at 1440px gets a 132px dragon, the
     52px phone name a 42px one. His square is handed to the mark as --j-size,
     which his component reads as the box it reserves.

     BESIDE THE NAME, CLEAR OF IT. He is placed in the name's own grid area,
     so 50% is the name's centre and his top is the name's top. The name is
     centred, and in the display face its first line's box ends 1.99
     name-sizes right of that centre and its second line's box begins 0.75
     name-sizes down — measured in Chromium, WebKit and Gecko from 1440px to
     721px. He starts at 2.08 and ends 0.65 down, so he flies right of the
     first line and above the second, and covers no letter of either even at
     the far end of his rock (a 4° turn grows his box by 0.03 of his size each
     side). The rendering lane measures his picture against every line box of
     the name in each engine, so a face or a size that moved the letters under
     him is a red build rather than an overlap. */
  .page-intro {
    position: relative;
  }

  .page-j {
    --j-size: 0.85em;
    position: absolute;
    grid-area: 1 / 1;
    inset-block-start: -0.2em;
    inset-inline-start: calc(50% + 2.08em);
    font-size: var(--keep-name-size);
    line-height: 0;
    pointer-events: none;
  }

  /* ON A PHONE HE TUCKS INTO THE SHEET'S CORNER. The name fills a phone's
     column (its first line alone is ~200px of a ~290px column), so there is no
     room beside it; he sits instead on the frame's top-end corner, half over the
     sky above the sheet, still the name's size so he is smaller there. His box
     stays inside the frame's own outer edge and his picture inside the page's
     gutter, so the page never scrolls sideways (measured at 320px), and the top
     space the page keeps above the sheet holds the half that rises above it.
     45rem is the page's phone breakpoint, the same one every collapsed row
     answers to. */
  @media (max-width: 45rem) {
    .page-j {
      --j-size: min(1.1em, 3.5rem);
      grid-area: auto;
      inset-block-start: calc(-1 * (var(--keep-sheet-pad) + var(--keep-frame-page)) - var(--j-size) / 2);
      inset-inline-start: auto;
      inset-inline-end: calc(-1 * (var(--keep-sheet-pad) + var(--keep-frame-page)));
    }
  }

  /* THE FOOTER STACKS: the version mark, then the reading mode under it, both
     on the column's centre line. Side by side, the control sat right of
     centre wherever the line fitted — at 390 and 412px it did — and its menu,
     which is centred on the control and wider than the gap to the screen's
     edge there, ran 8px off the screen and widened the page. Stacked, the
     control is on the column's centre at every width, so its 230px menu is
     inside any column the page can be dragged or squeezed to. */
  .page-footer {
    flex-direction: column;
    align-items: center;
  }
</style>
