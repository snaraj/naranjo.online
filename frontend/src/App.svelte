<script lang="ts">
  import ColumnHandles from './lib/components/ColumnHandles.svelte';
  import JMark from './lib/components/JMark.svelte';
  import NightSky from './lib/components/NightSky.svelte';
  import PageSection from './lib/components/PageSection.svelte';
  import Torches from './lib/components/Torches.svelte';
  import { syncThemeColor } from './lib/themeColor.ts';
  import { sectionOrdinal } from './lib/blocks.ts';
  import type { SkyPhase } from './lib/sky.ts';
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

  /* THE NIGHT (owner, 2026-10-19: "always set it to night by default", then,
     of the control that turned it to day, "do away with this all together but
     keep the logic"). The page is the night on every visit. The day stays
     whole behind this one constant — the stylesheet's day palette keyed on
     data-sky, the day sky, the torches put out — so a control that brings it
     back writes a phase here and touches nothing else. The phase is written on
     the root as data-sky, which is what the stylesheet's night block keys on.

     THE BROWSER'S TOOLBARS WEAR THE SHEET (owner directive, 2026-09-04, issue
     294), so they are told the sheet's colour once the phase is written. The
     read follows the write in the same task, and reading a computed style
     applies the new rules first. */
  const phase: SkyPhase = 'night';
  $effect(() => {
    document.documentElement.dataset.sky = phase;
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
<!-- The sky behind the page (owner direction, 2026-10-16; the night or the day
  since 2026-10-19). It is fixed and decorative, so it takes no room and cannot
  move anything above it. -->
<NightSky {phase} />

<!-- THE SHEET OPENS ON THE NAME (owner direction, 2026-10-16: "remove the stock
  image from this only leave it with my name, also find a better way to work
  the navigation bar away from the top of the screen and just do away with it
  for now, put J elsewhere"). There is no chrome row above the sheet and no
  picture band at either end of it: the name and the sections. No footer
  either (owner, 2026-10-19): the version mark and the reading-mode control
  went, and the page is the night on every visit.

  What the sections ARE lives in src/page.ts, the manifest (owner directive,
  issue 165): this file renders that array and is otherwise inert. Adding a
  block or reordering the page happens there; this file changes when the page's
  CHROME changes, nothing else — and the masthead and J are exactly that. Every section keeps its id, so a shared .../#trackers still lands on
  its section with no nav on the page to have linked it. -->
<main aria-labelledby="page-title">
  <div class="page-intro">
    <!-- J FLIES BESIDE THE NAME (owner, 2026-10-19: "put J on the white space
      flying"), in the room the name keeps at its end (styles.css, the name).
      He is inside the heading so he is placed from the name's own edge, out of
      its flow so the name is exactly where the static shell put it, and a
      picture and nothing else — aria-hidden inside his own component, so the
      heading's accessible name is still exactly the name. -->
    <h1 id="page-title">Samuel Naranjo<span class="page-j"><JMark /></span></h1>
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

  <!-- The reader's grip on the column (owner directive, 2026-08-24). It sits
    INSIDE main because main is the column: the two handles are drawn against
    its edges, so the element that resizes is also the box they measure
    themselves against and no width arithmetic is copied anywhere. They are
    out of flow, so nothing above them moves when they arrive, and they are
    rendered only where there is room for them — which is why a phone never
    receives them at all. -->
  <ColumnHandles />

  <!-- The torches on the frame's sides (owner, 2026-10-19), burning only at
    night. Inside main for the same reason as the handles: main's border is the
    frame they stand on, so they are placed against the box they decorate.
    Scenery, out of flow, clipped to the sheet. -->
  <Torches lit={phase === 'night'} />
</main>

<style>
  /* J'S SEAT is the room the name keeps at its end (styles.css, the name,
     which states his size and the gap as --j-size and --j-gap): just past the
     name's own edge, so in whichever face the name is drawn he never meets its
     letters, and centred on its two lines. He is out of the flow, so his
     arrival moves nothing the static shell (index.html) painted before he
     existed, and his square is the --j-size his component reads as the box it
     reserves. The rendering lane measures his picture against every line box
     of the name in each engine, so a face or a size that moved the letters
     into him is a red build rather than an overlap. */
  .page-j {
    position: absolute;
    inset-inline-start: calc(100% + var(--j-gap));
    inset-block-start: calc(50% - var(--j-size) / 2);
    line-height: 0;
    pointer-events: none;
  }
</style>
