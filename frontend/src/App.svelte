<script lang="ts">
  import ColumnHandles from './lib/components/ColumnHandles.svelte';
  import PageHeader from './lib/components/PageHeader.svelte';
  import PageSection from './lib/components/PageSection.svelte';
  import PullToRefresh from './lib/components/PullToRefresh.svelte';
  import SectionNav from './lib/components/SectionNav.svelte';
  import { page } from './page.ts';
</script>

<svelte:head>
  <meta
    name="description"
    content="naranjo.online, served from a Raspberry Pi Kubernetes cluster."
  />
</svelte:head>

<!-- First in the document on purpose (issue 219): the refresh control inside
  it is invisible until focused, and being the first focusable thing is what
  makes one Tab reach it — the skip-link arrangement. -->
<PullToRefresh />

<PageHeader />

<!-- The page is ONE stacked column (owner directive, issue 134): the name, the
  section nav under it, then every section top to bottom in the order the nav
  lists them. It used to tile its panels across the whole viewport, which the
  owner rejected in favour of a single centred container — a wider one than the
  30rem ribbon that arrangement replaced, which is why the column token grew
  rather than reverting.

  What the sections ARE lives in src/page.ts, the manifest (owner directive,
  issue 165): this file renders that array and is otherwise inert. It used to
  be the table of contents itself — one import and one mount line per section
  and per panel, held in step by fence comments — and the manifest replaced
  the fences, because an ordered array whose entries are the page needs no
  markers to keep its halves aligned: there is only one half. Adding a block
  or reordering the page happens there; this file changes when the page's
  CHROME changes, nothing else. -->
<main aria-labelledby="page-title">
  <div class="page-intro">
    <h1 id="page-title">Samuel Naranjo</h1>
    <SectionNav />
  </div>

  {#each page as section (section.id)}
    <PageSection {section} />
  {/each}

  <!-- The reader's grip on the column (owner directive, 2026-08-24). It sits
    INSIDE main because main is the column: the two handles are drawn against
    its edges, so the element that resizes is also the box they measure
    themselves against and no width arithmetic is copied anywhere. They are
    out of flow, so nothing above them moves when they arrive, and they are
    rendered only where there is room for them — which is why a phone never
    receives them at all. -->
  <ColumnHandles />
</main>
