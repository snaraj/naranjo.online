<!-- PageSection renders one manifest section (issue 165): the anchored
  section landmark, its title, and its blocks in manifest order. The id the
  section carries is the id the nav links to, and both come from the same
  manifest entry, so a link can never point at a section nobody rendered.

  Two layouts, named in the manifest:

  FLOW — each block renders in the section's own grid with whatever the
  manifest says about it: a heading opens a subsection (the page's h3 line),
  an intro and a note are the established secondary lines. The presentation
  lines render HERE, beside the section chrome they belong to, because they
  are the page introducing a block — not the block describing itself; a
  component that printed its own heading could never be reused under a
  different one.

  STACK — the blocks share the page's tracker stack (`.panel-stack`,
  styles.css), which owns their column width and the gap between cards; a
  stacked block that decided its own page position would fight whatever the
  stack decided.

  It carries no styling of its own: `.page-section`, `.section-title`,
  `.page-subsection`, `.subsection-intro`, `.section-note` and `.panel-stack`
  are all shaped in styles.css beside the page column they sit in, so every
  section moves together when one of them changes. -->
<script lang="ts">
  import type { PageSection } from '../blocks.ts';
  import Block from './Block.svelte';

  let { section }: { section: PageSection } = $props();
</script>

<section class="page-section" id={section.id} aria-labelledby={`${section.id}-title`}>
  <h2 class="section-title" id={`${section.id}-title`}>{section.label}</h2>
  {#if section.layout === 'stack'}
    <!-- The stack states how many blocks it was given (issue 210). A
      panel-bound block renders NOTHING until its first envelope arrives, so
      the difference between this number and the stack's actual child count is
      the page's own answer to "is anything still on its way" — which is a
      question the document could not previously be asked. The rendering lanes
      settle on it instead of on a height that stopped changing for one poll:
      a height is satisfied by a page that has not started arriving as readily
      as by one that has finished, and a lane that snapshotted in that gap
      blamed a reading-mode swap for a panel's own growth. It is inert to
      layout and to the zero-CLS floor, which is the other reason it is an
      attribute rather than a class. -->
    <div class="panel-stack" data-block-count={section.blocks.length}>
      {#each section.blocks as block (block.key)}
        <Block {block} />
      {/each}
    </div>
  {:else}
    {#each section.blocks as block (block.key)}
      {#if block.heading}
        <div class="page-subsection">
          <h3 class="subsection-title">{block.heading}</h3>
          {#if block.intro}<p class="subsection-intro">{block.intro}</p>{/if}
          {#if block.note}<p class="section-note">{block.note}</p>{/if}
          <Block {block} />
        </div>
      {:else}
        {#if block.note}<p class="section-note">{block.note}</p>{/if}
        <Block {block} />
      {/if}
    {/each}
  {/if}
</section>
