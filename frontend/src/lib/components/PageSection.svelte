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
    <div class="panel-stack">
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
