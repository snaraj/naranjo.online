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
  second copy in a component is how two rules that must agree drift apart. -->
<script lang="ts">
  import { sectionHref } from '../blocks.ts';
  import { page } from '../../page.ts';
</script>

<nav class="section-nav" aria-label="Page sections">
  {#each page as section (section.id)}
    <a class="section-link" href={sectionHref(section)}>{section.label}</a>
  {/each}
</nav>
