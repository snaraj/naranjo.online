<!-- THE TORCHES (owner, 2026-10-19: "add torches to the sides of the border and
  light them up with nice fire animations (that you build from scratch) at
  nighttime, during the day they can be extinguished"; then "flip them to be
  facing outwards into the page … the light and fire should behave and look
  like a fire reflection on a real surface. we should see slightly dimming",
  and "a little bit more light").

  Iron-cupped wooden torches hang from plates on the frame's two side bands,
  leaning out over the sheet, a pair beside the name and then a pair every
  --torch-spacing down the sheet. They are scenery: aria-hidden, no pointer,
  out of the flow, under the sheet's content and over its wall, and the layer
  is clipped to the sheet's own outer edge, so a torch or its light can never
  widen the page or sit over a word.

  SEATS NEVER MOVE. Each seat is a fixed distance from the sheet's top, and a
  taller sheet only adds seats below the last, so a torch already on screen is
  never shifted when the page grows.

  THE FIRE IS lib/fire.ts, one small field per torch, painted square onto a
  canvas the field's own size, and THE LIGHT IS READ FROM IT: each frame the
  flame's heat and lean (fireLight) move the light it throws on the stone — a
  hot spot behind the flame and a wide pool around it, which brighten, dim
  and lean with the fire — and swing the shadow its handle casts the other
  way. It burns only at night (lit), only while the page is visible, and only
  on a torch that is on screen; one loop serves every torch, at
  fireFrameInterval at most and slower where the page cannot afford it
  (nextFireInterval, the sky's own pacing). A reader who asked for reduced motion sees a lit torch still: a fire
  that has been burning a while, in a steady light. By day the torches are
  out: no flame, no light, no shadow, and no loop.

  NO TWO TORCHES BURN ALIKE (owner, 2026-10-19: "the lights do not all have
  the same gif feel … in the real world the lights would all move, behave and
  shine lights in different ways"). Each torch has its own temper, drawn once
  from its number (torchTemper): its flame burns taller or shorter, breathes
  more or less, steps on its own share of the loop's frames so it flickers at
  its own tempo, leans as its own air wanders, and its light follows the
  flame faster or slower, dims deeper or shallower in the draughts, reaches
  its own way across the stone (never further than the steady reach) and,
  held still, rests at its own brightness.

  THE LIGHT BREAKS ON THE STONE, AND THE AIR CATCHES IT (owner, 2026-10-19:
  "make the lights seem a bit more real by adding light particle diffusion
  against all the surfaces that it is hitting"). The light falls through the
  stone's grain, a mask fixed to the wall, so as it flickers and leans it
  moves across the roughness rather than carrying it along; and around each
  flame a small field of motes (stepMotes) throws sparks up from its tip and
  lights the dust drifting through its glow. The motes stay on the frame and
  the sheet's margin like the light, and move only where motion is welcome. -->
<script lang="ts">
  import { untrack } from 'svelte';
  import {
    fireColumns,
    fireFrameInterval,
    fireHeat,
    fireLight,
    firePalette,
    firePixels,
    fireRows,
    kindledFire,
    moteColumns,
    moteGlow,
    moteRows,
    nextFireInterval,
    nextGlow,
    stepFire,
    stepMotes,
    stillGlow,
    torchTemper,
    type Fire,
    type Glow,
    type Mote,
    type Temper
  } from '../fire.ts';
  import { pace } from '../sky.ts';

  let { lit }: { lit: boolean } = $props();

  let layer = $state<HTMLDivElement>();
  let seats = $state<number[]>([]);

  const sides = ['start', 'end'] as const;

  /* Where the torches stand: the first beside the name, then one pair every
     spacing, while a torch still fits above the sheet's foot. Both lengths
     are the layer's own tokens, read in pixels. */
  $effect(() => {
    const node = layer;
    const sheet = node?.parentElement;
    if (node === undefined || sheet === null || sheet === undefined) {
      return;
    }
    const place = (): void => {
      const style = getComputedStyle(node);
      const first = parseFloat(style.getPropertyValue('--torch-first-px')) || 0;
      const spacing = parseFloat(style.getPropertyValue('--torch-spacing-px')) || 0;
      const foot = parseFloat(style.getPropertyValue('--torch-foot-px')) || 0;
      if (spacing <= 0) {
        return;
      }
      const height = sheet.clientHeight;
      const next: number[] = [];
      for (let top = first; top + foot <= height; top += spacing) {
        next.push(Math.round(top));
      }
      /* Read untracked: this effect writes the seats, so it must not also
         depend on them. */
      const current = untrack(() => seats);
      if (next.length !== current.length || next.some((top, index) => top !== current[index])) {
        seats = next;
      }
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(sheet);
    return () => observer.disconnect();
  });

  /* Each torch's temper, by its number: drawn once, so a torch is the same
     torch on every load. */
  const tempers = new Map<number, Temper>();

  function temperOf(index: number): Temper {
    let temper = tempers.get(index);
    if (temper === undefined) {
      temper = torchTemper(index * 7919 + 13);
      tempers.set(index, temper);
    }
    return temper;
  }

  /* A torch's light held still: its own resting brightness. */
  function stillOf(index: number): Glow {
    return { ...stillGlow, light: temperOf(index).still };
  }

  /* Every flame canvas and its air's, by its torch's number, and which are
     on screen. */
  const canvases = new Map<number, HTMLCanvasElement>();
  const airs = new Map<number, HTMLCanvasElement>();
  const onScreen = new Set<number>();
  const fires = new Map<number, Fire>();
  const glows = new Map<number, Glow>();
  const motes = new Map<number, Mote[]>();
  let wake = $state(0);

  /* Each flame canvas registers itself, and the air drawn before it in its
     torch, and wakes the fire's effect below. The count is bumped untracked:
     an attachment is an effect, and one that read the counter it writes would
     re-run itself without end. */
  function flame(index: number) {
    return (canvas: HTMLCanvasElement) => {
      canvases.set(index, canvas);
      const air = canvas.parentElement?.querySelector<HTMLCanvasElement>('.torch-motes');
      if (air !== null && air !== undefined) {
        airs.set(index, air);
      }
      untrack(() => {
        wake += 1;
      });
      return () => {
        canvases.delete(index);
        airs.delete(index);
        onScreen.delete(index);
        fires.delete(index);
        glows.delete(index);
        motes.delete(index);
      };
    };
  }

  $effect(() => {
    void wake;
    const quiet = matchMedia('(prefers-reduced-motion: reduce)');
    const palette = firePalette();
    const pixels = new ImageData(fireColumns, fireRows);
    const airPixels = new ImageData(moteColumns, moteRows);
    /* Dust glows in the fire's own colour at three quarters of its heat. */
    const dustHeat = Math.round(fireHeat * 0.75);
    let frame = 0;
    /* When to step, by what the page has paid for the last step. */
    const paced = pace(fireFrameInterval, nextFireInterval);

    const paint = (index: number, fire: Fire | null): void => {
      const context = canvases.get(index)?.getContext('2d');
      if (context === null || context === undefined) {
        return;
      }
      if (fire === null) {
        context.clearRect(0, 0, fireColumns, fireRows);
        return;
      }
      firePixels(fire, palette, pixels.data);
      context.putImageData(pixels, 0, 0);
    };

    /* The air's motes, each a pixel in the fire's palette at its own
       strength: a spark at the heat it still has, with a fainter pixel of
       trail below it, and dust at the dust's heat, as bright as the fire
       lights it. A brighter mote wins a pixel two share. */
    const scatter = (index: number, field: readonly Mote[], light: number): void => {
      const context = airs.get(index)?.getContext('2d');
      if (context === null || context === undefined) {
        return;
      }
      const data = airPixels.data;
      data.fill(0);
      const put = (x: number, y: number, heat: number, strength: number): void => {
        if (x < 0 || x >= moteColumns || y < 0 || y >= moteRows) {
          return;
        }
        const at = (y * moteColumns + x) * 4;
        const alpha = palette[heat * 4 + 3] * strength;
        if (alpha > data[at + 3]) {
          data[at] = palette[heat * 4];
          data[at + 1] = palette[heat * 4 + 1];
          data[at + 2] = palette[heat * 4 + 2];
          data[at + 3] = alpha;
        }
      };
      for (const mote of field) {
        const strength = moteGlow(mote, light);
        const x = Math.floor(mote.x);
        const y = Math.floor(mote.y);
        if (mote.spark) {
          const heat = Math.round(fireHeat * (0.5 + 0.5 * strength));
          put(x, y, heat, strength);
          put(x, y + 1, heat, strength * 0.4);
        } else {
          put(x, y, dustHeat, strength);
        }
      }
      context.putImageData(airPixels, 0, 0);
    };

    /* The light a torch throws, as two numbers on the torch itself: its
       stylesheet turns them into the light's strength and lean and the
       shadow's swing. */
    const shine = (index: number, glow: Glow): void => {
      const torch = canvases.get(index)?.parentElement;
      torch?.style.setProperty('--torch-light', glow.light.toFixed(3));
      torch?.style.setProperty('--torch-sway', glow.sway.toFixed(3));
    };

    const fireOf = (index: number): Fire => {
      let fire = fires.get(index);
      if (fire === undefined) {
        fire = kindledFire(index * 7919 + 13, temperOf(index));
        fires.set(index, fire);
      }
      return fire;
    };

    const motesOf = (index: number): Mote[] => {
      let field = motes.get(index);
      if (field === undefined) {
        field = [];
        motes.set(index, field);
      }
      return field;
    };

    const tick = (now: number): void => {
      frame = 0;
      if (!lit || document.hidden || quiet.matches || onScreen.size === 0) {
        return;
      }
      frame = requestAnimationFrame(tick);
      if (!paced.frame(now)) {
        return;
      }
      /* Every torch's light and air move each frame; its flame steps only on
         its own beat, so each burns at its temper's tempo. */
      for (const index of onScreen) {
        const fire = fireOf(index);
        fire.beat += fire.temper.pace;
        if (fire.beat >= 1) {
          fire.beat -= 1;
          stepFire(fire, true);
          paint(index, fire);
        }
        const glow = nextGlow(glows.get(index) ?? stillOf(index), fireLight(fire), fire.random, fire.temper);
        glows.set(index, glow);
        shine(index, glow);
        const field = motesOf(index);
        stepMotes(field, glow.light, glow.sway, fire.random, fire.temper);
        scatter(index, field, glow.light);
      }
      paced.drew(now);
    };

    const start = (): void => {
      cancelAnimationFrame(frame);
      frame = 0;
      paced.restart();
      if (!lit) {
        fires.clear();
      }
      if (!lit || quiet.matches) {
        glows.clear();
        motes.clear();
      }
      for (const index of canvases.keys()) {
        paint(index, lit ? fireOf(index) : null);
        const glow = glows.get(index) ?? stillOf(index);
        shine(index, glow);
        scatter(index, motes.get(index) ?? [], glow.light);
      }
      if (lit && !document.hidden && !quiet.matches && onScreen.size > 0) {
        frame = requestAnimationFrame(tick);
      }
    };

    const watcher = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.torch);
        if (entry.isIntersecting) {
          onScreen.add(index);
        } else {
          onScreen.delete(index);
        }
      }
      start();
    });
    for (const canvas of canvases.values()) {
      watcher.observe(canvas);
    }

    start();
    document.addEventListener('visibilitychange', start);
    quiet.addEventListener('change', start);
    return () => {
      cancelAnimationFrame(frame);
      watcher.disconnect();
      document.removeEventListener('visibilitychange', start);
      quiet.removeEventListener('change', start);
    };
  });

</script>

<div class="keep-torches" bind:this={layer} aria-hidden="true" data-lit={lit ? 'true' : 'false'}>
  {#each seats as top, seat (top)}
    {#each sides as side, column (side)}
      {@const index = seat * 2 + column}
      <span
        class="torch"
        data-side={side}
        style:inset-block-start="{top}px"
        style:--torch-reach-scale={temperOf(index).reach.toFixed(3)}
      >
        <span class="torch-glow">
          <span class="torch-light"></span>
          <span class="torch-halo"></span>
        </span>
        <span class="torch-shadow"></span>
        <!-- The start side's torch, drawn in the flame's own pixels: a plate
          on the frame, an arm to an iron collar, and an oak handle leaning
          out a pixel every three rows to the cup the flame burns in. The end
          side's is its mirror image. -->
        <svg class="torch-body" viewBox="0 0 12 18" shape-rendering="crispEdges" focusable="false">
          <rect class="torch-iron" x="3" y="0" width="8" height="1" />
          <rect class="torch-char" x="5" y="0" width="4" height="1" />
          <rect class="torch-iron" x="4" y="1" width="6" height="2" />
          <rect class="torch-iron-dark" x="5" y="3" width="4" height="1" />
          <rect class="torch-wood" x="6" y="4" width="1" height="3" />
          <rect class="torch-wood-dark" x="7" y="4" width="1" height="3" />
          <rect class="torch-wood" x="5" y="7" width="1" height="3" />
          <rect class="torch-wood-dark" x="6" y="7" width="1" height="3" />
          <rect class="torch-wood" x="4" y="10" width="1" height="3" />
          <rect class="torch-wood-dark" x="5" y="10" width="1" height="3" />
          <rect class="torch-wood" x="3" y="13" width="1" height="3" />
          <rect class="torch-wood-dark" x="4" y="13" width="1" height="3" />
          <rect class="torch-wood" x="2" y="16" width="1" height="2" />
          <rect class="torch-wood-dark" x="3" y="16" width="1" height="2" />
          <rect class="torch-iron-dark" x="1" y="8" width="2" height="5" />
          <rect class="torch-iron" x="1" y="8" width="1" height="5" />
          <rect class="torch-char" x="2" y="9" width="1" height="1" />
          <rect class="torch-char" x="2" y="11" width="1" height="1" />
          <rect class="torch-iron" x="4" y="9" width="4" height="1" />
          <rect class="torch-iron-dark" x="3" y="10" width="4" height="1" />
        </svg>
        <span class="torch-air">
          <canvas class="torch-motes" width={moteColumns} height={moteRows}></canvas>
        </span>
        <canvas class="torch-flame" width={fireColumns} height={fireRows} data-torch={index} {@attach flame(index)}></canvas>
      </span>
    {/each}
  {/each}
</div>

<style>
  /* THE LAYER covers the sheet's whole border box — the frame included, since
     the torches hang on it — and clips to it. main is its containing block;
     main's border is the frame, so the layer reaches out by the frame's width
     on every side. It sits at z-index -1 in the root's stacking context, one
     above the wall and the frame's greenery (-2), so the torches and their
     light land on the stone and the leaves alike, and under every word on
     the sheet. */
  .keep-torches {
    --torch-unit: calc(var(--keep-frame-page) / 5);
    /* The room the light has across: from the flame, seven units in from the
       sheet's outer edge, to where the sheet's words begin — the frame and
       the sheet's margin. */
    --torch-room: max(0px, var(--keep-frame-page) + var(--keep-sheet-pad) - var(--torch-unit) * 7);
    --torch-first-px: 160;
    --torch-spacing-px: 576;
    --torch-foot-px: 160;
    position: absolute;
    inset: calc(-1 * var(--keep-frame-page));
    z-index: -1;
    overflow: clip;
    pointer-events: none;
  }

  /* A phone's frame is narrower and so is its sheet's margin, so its torches
     are drawn finer: a sixth of the frame per unit rather than a fifth. */
  @media (max-width: 45rem) {
    .keep-torches {
      --torch-unit: calc(var(--keep-frame-page) / 6);
    }
  }

  /* A TORCH is twelve units wide, hung from the sheet's outer edge: the body,
     eighteen units, at the foot, and the flame box, ten by eighteen units of
     field, above it and over the cup, overlapping its rim by two so the hot
     core sits in the cup — the flame drawn over the body. The flame stands
     upright however the handle leans, because fire rises. The end side is the
     start side's mirror image, light and shadow included. */
  .torch {
    --torch-light: 0.8;
    --torch-sway: 0;
    /* The torch's own reach, from its temper: never more than one, so its
       light stops where the steady light stops, short of the words. */
    --torch-reach-scale: 1;
    --torch-reach: calc(var(--torch-room) * 1.25 * var(--torch-reach-scale));
    --torch-halo-reach: calc(min(var(--torch-unit) * 5, var(--torch-room)) * var(--torch-reach-scale));
    position: absolute;
    inset-inline-start: 0;
    inline-size: calc(var(--torch-unit) * 12);
    block-size: calc(var(--torch-unit) * 34);
  }

  .torch[data-side='end'] {
    inset-inline-start: auto;
    inset-inline-end: 0;
    transform: scaleX(-1);
  }

  .torch > * {
    position: absolute;
  }

  .torch-flame {
    inset-inline-start: calc(var(--torch-unit) * 2);
    inset-block-start: 0;
    inline-size: calc(var(--torch-unit) * 10);
    block-size: calc(var(--torch-unit) * 18);
    image-rendering: pixelated;
  }

  .torch-body {
    inset-inline-start: 0;
    inset-block-end: 0;
    inline-size: 100%;
    block-size: calc(var(--torch-unit) * 18);
  }

  /* THE LIGHT on the stone, in two parts centred on the flame (seven units
     in, at the cup): a hot spot right behind it, and a pool that reaches far
     up and down the wall but across only as far as --torch-room allows. The
     hot spot stops where the words begin, and the pool reaches a quarter
     further, so the words begin at four-fifths of its reach, where it has
     thinned to under a twentieth: it lights the frame and the sheet's margin
     and never sits bright under a word, at any width of window or column.
     Both follow --torch-light, brightening and dimming with the fire; the
     pool also breathes in size with it and leans the way the flame leans.
     Nothing at all while the torch is out. */
  .torch-light,
  .torch-halo,
  .torch-shadow {
    opacity: 0;
  }

  /* Both parts of the light fall through the stone's grain. The grain is
     fixed to the wall: this box holds still, three units wider than the
     light on every side so its lean and breath never reach the box's edge,
     and the light moves inside it, across the roughness. */
  .torch-glow {
    inset-inline-start: calc(var(--torch-unit) * 4 - var(--torch-reach));
    inset-block-start: calc(var(--torch-unit) * -27);
    inline-size: calc(var(--torch-reach) * 2 + var(--torch-unit) * 6);
    block-size: calc(var(--torch-unit) * 78);
    mask-image: var(--keep-grain);
    mask-size: var(--keep-grain-tile);
    mask-repeat: repeat;
  }

  .torch-glow > * {
    position: absolute;
  }

  .torch-halo {
    inset-inline-start: calc(var(--torch-unit) * 3 + var(--torch-reach) - var(--torch-halo-reach));
    inset-block-start: calc(var(--torch-unit) * 32);
    inline-size: calc(var(--torch-halo-reach) * 2);
    block-size: calc(var(--torch-unit) * 16);
    background: radial-gradient(closest-side, var(--palette-keep-torch-light-hot), transparent);
  }

  .torch-light {
    inset-inline-start: calc(var(--torch-unit) * 3);
    inset-block-start: calc(var(--torch-unit) * 3);
    inline-size: calc(var(--torch-reach) * 2);
    block-size: calc(var(--torch-unit) * 72);
    background: radial-gradient(
      closest-side,
      var(--palette-keep-torch-light-hot),
      var(--palette-keep-torch-light) 22%,
      var(--palette-keep-torch-light-far) 55%,
      transparent
    );
    transform: translateX(calc(var(--torch-sway) * var(--torch-unit) * 1.5))
      scale(calc(0.88 + var(--torch-light) * 0.15));
  }

  /* THE SHADOW the handle casts on the wall: the flame is above the handle
     and in front of the stone, so the shadow falls from the collar more
     steeply than the handle leans and runs on below its foot, darker the
     brighter the fire, and swings against the flame's lean — when the fire
     leans in, the shadow leans out. */
  .torch-shadow {
    inset-inline-start: calc(var(--torch-unit) * 3);
    inset-block-start: calc(var(--torch-unit) * 26);
    inline-size: calc(var(--torch-unit) * 4);
    block-size: calc(var(--torch-unit) * 20);
    background: radial-gradient(50% 100% at 50% 0%, var(--palette-keep-torch-shadow), transparent);
    transform-origin: 50% 0;
    transform: rotate(calc(8deg + var(--torch-sway) * 10deg));
  }

  /* THE AIR around the flame, twelve units across and forty tall from
     twenty-four units above the flame box, a mote a half unit: clipped, like
     the light, to the frame and the sheet's margin, so a spark or a lit mote
     of dust never drifts over a word. */
  .torch-air {
    inset-inline-start: 0;
    inset-block-start: calc(var(--torch-unit) * -24);
    inline-size: calc(var(--torch-unit) * 7 + var(--torch-room));
    block-size: calc(var(--torch-unit) * 40);
    overflow: clip;
  }

  .torch-motes {
    position: absolute;
    inset-inline-start: var(--torch-unit);
    inset-block-start: 0;
    inline-size: calc(var(--torch-unit) * 12);
    block-size: calc(var(--torch-unit) * 40);
    image-rendering: pixelated;
  }

  .keep-torches[data-lit='true'] .torch-light,
  .keep-torches[data-lit='true'] .torch-halo {
    opacity: var(--torch-light);
  }

  .keep-torches[data-lit='true'] .torch-shadow {
    opacity: calc(var(--torch-light) * 0.9);
  }

  .torch-iron {
    fill: var(--palette-keep-torch-iron);
  }

  .torch-iron-dark {
    fill: var(--palette-keep-torch-iron-dark);
  }

  .torch-wood {
    fill: var(--palette-keep-torch-wood);
  }

  .torch-wood-dark {
    fill: var(--palette-keep-torch-wood-dark);
  }

  .torch-char {
    fill: var(--palette-keep-torch-char);
  }
</style>
