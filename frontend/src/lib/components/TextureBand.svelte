<!-- TextureBand is the picture strip the ledger opens and closes on (owner
  directive, 2026-09-03, issue 287): a fixed-height box, ruled top and bottom,
  with one image layer per vendored texture and exactly one of them opaque.

  EVERY LAYER IS MOUNTED, ALWAYS, and that is the whole reason this is a stack
  of images rather than one image whose src changes. A src swap paints the box
  empty while the new file decodes, which on a band this size is a black flash
  in the middle of a page somebody is reading; a stack cross-fades between two
  pictures that have both already decoded. It costs nothing at rest — the
  layers are the same eight small files in every mode, and a hidden layer
  paints no pixels — and it is what makes the reading-mode switch move no
  geometry at all, which is the floor the lanes measure.

  The HEIGHT is fixed at both widths rather than fluid. This is the one box on
  the page whose content arrives as an image, and a height that depended on
  the picture would move everything under it the moment a texture decoded.

  It knows no reading mode and no file name: which pictures it holds and which
  one is showing are the caller's, so this component is a crossfading band and
  nothing else. The mapping lives in lib/textures.ts, where a node test drives
  it. -->
<script lang="ts">
  import type { BandTexture } from '../textureAssets.ts';

  let {
    layers,
    active,
    label,
    controls = false,
    onStep
  }: {
    /* Every texture the band can show, mounted at once (see above). */
    layers: readonly BandTexture[];
    /* The file currently at full opacity. A value naming no layer paints the
       band's own ground, which is the honest state for a set that has not
       resolved rather than an arbitrary picture. */
    active: string;
    /* The cycle box's own words, already composed by lib/textures.ts. */
    label: string;
    /* Whether this band carries the cycle box. Only the top one does: the two
       bands show the same texture, and a second copy of the same pair of
       buttons would be two controls with one accessible name each. */
    controls?: boolean;
    /* Which way an arrow steps. The caller owns the index; this only reports
       the direction, so nothing about the wrap lives in a component. */
    onStep?: (step: number) => void;
  } = $props();
</script>

<div class="band" data-band-controls={controls ? 'true' : 'false'}>
  <div class="band-layers" aria-hidden="true">
    {#each layers as layer (layer.file)}
      <img
        class="band-layer"
        src={layer.url}
        alt=""
        data-band-active={layer.file === active ? 'true' : 'false'}
        loading="lazy"
        decoding="async" />
    {/each}
  </div>
  {#if controls}
    <div class="band-cycle">
      <button class="band-step" type="button" aria-label="Previous texture" onclick={() => onStep?.(-1)}>
        <svg
          class="band-arrow"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
      </button>
      <span class="band-label">{label}</span>
      <button class="band-step" type="button" aria-label="Next texture" onclick={() => onStep?.(1)}>
        <svg
          class="band-arrow"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
      </button>
    </div>
  {/if}
</div>
