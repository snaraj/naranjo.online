<!-- SectionNav is the row of in-page links under the page's name (owner
  directive, issue 134): Work, Projects, Trackers, About Me, one line, in the
  order the page stacks them.

  Every link is derived from lib/sections.ts, which is also what the sections
  take their ids from, so a link can never point at a section nobody rendered —
  the pairing is executed by tests/sections.test.mjs rather than trusted.

  It carries no styling of its own. The row and the links are shaped in
  styles.css beside the page column they sit in, for the same reason the header
  row is: the touch floor these links have to clear is a page-level rule, and a
  second copy in a component is how two rules that must agree drift apart. -->
<script lang="ts">
  import { pageSections, sectionHref } from '../sections.ts';
</script>

<nav class="section-nav" aria-label="Page sections">
  {#each pageSections as section (section.id)}
    <a class="section-link" href={sectionHref(section)}>{section.label}</a>
  {/each}
</nav>
