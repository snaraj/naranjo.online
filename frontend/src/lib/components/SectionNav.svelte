<!-- SectionNav is the row of in-page links under the page's name (owner
  directive, issue 134): one link per section, one line, in the order the page
  stacks them.

  Every link derives from src/page.ts — the same manifest the sections render
  from — so a link can never point at a section nobody rendered: both read the
  same entry. The pairing is executed by tests/sections.test.mjs rather than
  trusted.

  It carries no styling of its own. The row and the links are shaped in
  styles.css beside the page column they sit in, for the same reason the header
  row is: the touch floor these links have to clear is a page-level rule, and a
  second copy in a component is how two rules that must agree drift apart.

  A tap must not leave the fragment sitting in the URL (owner report, issue
  171: refreshing twice in Orion on iPhone snapped the page to #trackers). The
  href stays a REAL fragment link — an unmodified click still reaches a
  section with no script running at all, which is what keeps this accessible
  and keeps a shared .../#trackers URL a real deep link — but an ordinary tap
  scrolls the target into view itself and then replaces the URL with the
  fragment-free path, so a later refresh has nothing left to re-apply.

  Dropping the fragment is only half of it: a live probe against the built
  server showed a plain scroll-then-reload, with NO fragment and NO history
  call anywhere, still lands the reader back where they were — the browser
  remembers a scroll offset per history entry independent of the URL, and
  `history.replaceState` does not clear that memory. `scrollRestoration =
  'manual'`, set once, is the other half: the same probe confirmed it is what
  actually makes a refresh load at the top instead of silently restoring
  whatever the reader happened to be scrolled to. -->
<script lang="ts">
  import { sectionHref } from '../blocks.ts';
  import { page } from '../../page.ts';

  if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }

  function onNavClick(event: MouseEvent, id: string): void {
    // A modified click ("open in a new tab") is the visitor asking for
    // browser-native handling, not this one.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const target = document.getElementById(id);
    if (target === null) {
      return;
    }
    event.preventDefault();
    target.scrollIntoView();
    // The fragment is dropped from the URL, not the scroll: a refresh right
    // after this now loads the page exactly as a first visit would.
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
</script>

<nav class="section-nav" aria-label="Page sections">
  {#each page as section (section.id)}
    <a
      class="section-link"
      href={sectionHref(section)}
      onclick={(event) => onNavClick(event, section.id)}>{section.label}</a
    >
  {/each}
</nav>
