<!-- NightSky is the page's background (owner direction, 2026-10-16): a starry
  night that twinkles slowly behind the sheet, and since 2026-10-19 a bright
  day kept for the scene's day (lib/sky.ts; App.svelte hands the phase down).
  It is decorative — hidden from
  assistive technology, never a target for the pointer — and it is fixed, so it
  takes no room in the layout and cannot shift anything.

  The loop runs only while the page is visible and the sky has stars to move,
  at most at skyFrameInterval and slower where the page cannot afford it
  (nextSkyInterval), and not at all for a reader who asked for reduced motion:
  they get one still frame of the same sky, redrawn only when the window's size
  or the phase changes. The day sky has no stars, so it is one still picture
  for everyone. -->
<script lang="ts">
  import {
    driftX,
    glintField,
    glintReach,
    nebulaPixels,
    nextSkyInterval,
    skyFrameInterval,
    skyMaxPixelRatio,
    skyMoves,
    skyPresets,
    starField,
    twinkle,
    type Glint,
    type SkyPhase,
    type Star
  } from '../sky.ts';

  let { phase }: { phase: SkyPhase } = $props();

  let canvas = $state<HTMLCanvasElement>();

  $effect(() => {
    const node = canvas;
    const context = node?.getContext('2d');
    if (node === undefined || context === null || context === undefined) {
      return;
    }
    const preset = skyPresets[phase];
    const moving = skyMoves(preset);
    const quiet = matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let height = 0;
    let still: HTMLCanvasElement | null = null;
    let stars: Star[] = [];
    let glints: Glint[] = [];
    let ratio = 1;
    let glow: HTMLCanvasElement | null = null;
    let frame = 0;
    let last = 0;
    let interval = skyFrameInterval;
    // When the sky last drew, so the next frame can say what it cost.
    let drawnAt = -1;
    const started = performance.now();

    function glowSprite(): HTMLCanvasElement {
      const sprite = document.createElement('canvas');
      sprite.width = sprite.height = 32;
      const g = sprite.getContext('2d');
      if (g !== null) {
        const gradient = g.createRadialGradient(16, 16, 0, 16, 16, 16);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.2, 'rgba(225,212,255,0.8)');
        gradient.addColorStop(0.5, 'rgba(225,212,255,0.16)');
        gradient.addColorStop(1, 'rgba(225,212,255,0)');
        g.fillStyle = gradient;
        g.fillRect(0, 0, 32, 32);
      }
      return sprite;
    }

    function build(): void {
      width = innerWidth;
      height = innerHeight;
      ratio = Math.min(devicePixelRatio || 1, skyMaxPixelRatio);
      node!.width = Math.round(width * ratio);
      node!.height = Math.round(height * ratio);
      context!.setTransform(ratio, 0, 0, ratio, 0, 0);
      still = document.createElement('canvas');
      still.width = width;
      still.height = height;
      const g = still.getContext('2d');
      if (g !== null) {
        const gradient = g.createLinearGradient(0, 0, width * 0.3, height);
        preset.sky.forEach((color, index) => gradient.addColorStop(index / (preset.sky.length - 1), color));
        g.fillStyle = gradient;
        g.fillRect(0, 0, width, height);
        if (preset.nebula !== undefined) {
          const lowWidth = Math.max(64, Math.round(width / preset.nebula.res));
          const lowHeight = Math.max(40, Math.round(height / preset.nebula.res));
          const low = document.createElement('canvas');
          low.width = lowWidth;
          low.height = lowHeight;
          const lg = low.getContext('2d');
          if (lg !== null) {
            const pixels = lg.createImageData(lowWidth, lowHeight);
            pixels.data.set(nebulaPixels(lowWidth, lowHeight, preset.nebula));
            lg.putImageData(pixels, 0, 0);
            g.drawImage(low, 0, 0, width, height);
          }
        }
      }
      stars = starField(width, height, preset.stars, 17);
      glints = preset.stars.glints === undefined ? [] : glintField(width, height, preset.stars.glints, 29, preset.stars.drift);
      glow ??= glowSprite();
    }

    /* The pixel stars, on whole screen pixels so a square stays a square at
       any density: a plain star is its square; a flaring one is its core and
       the cross its reach spells out, square by square, and under reduced
       motion it holds its first reach, the cross one square out. */
    function drawGlints(t: number): void {
      const sparkle = preset.stars.glints;
      if (sparkle === undefined || glints.length === 0) {
        return;
      }
      context!.setTransform(1, 0, 0, 1, 0, 0);
      const unit = Math.max(1, Math.round(sparkle.unit * ratio));
      const plain = Math.max(1, Math.round(sparkle.plain * ratio));
      for (const glint of glints) {
        const x = Math.round(driftX(glint, t, width, preset.stars.drift) * ratio);
        const y = Math.round(glint.y * ratio);
        context!.fillStyle = `rgb(${sparkle.core})`;
        if (!glint.flares) {
          context!.fillRect(x, y, plain, plain);
          continue;
        }
        context!.fillRect(x, y, unit, unit);
        const reach = quiet.matches ? 1 : glintReach(glint, t);
        context!.fillStyle = `rgb(${sparkle.arm})`;
        for (let step = 1; step <= reach; step += 1) {
          const out = step * unit;
          context!.fillRect(x - out, y, unit, unit);
          context!.fillRect(x + out, y, unit, unit);
          context!.fillRect(x, y - out, unit, unit);
          context!.fillRect(x, y + out, unit, unit);
        }
      }
      context!.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function draw(t: number): void {
      if (still === null) {
        return;
      }
      context!.globalCompositeOperation = 'source-over';
      context!.globalAlpha = 1;
      context!.drawImage(still, 0, 0, width, height);
      context!.globalCompositeOperation = 'lighter';
      for (const star of stars) {
        const alpha = twinkle(star, t, preset.stars.steps);
        if (alpha < 0.02) {
          continue;
        }
        const x = driftX(star, t, width, preset.stars.drift);
        context!.globalAlpha = alpha;
        if (preset.stars.fine !== true && star.size > 0.9 && glow !== null) {
          const d = star.size * 6;
          context!.drawImage(glow, x - d / 2, star.y - d / 2, d, d);
        } else {
          context!.fillStyle = `rgb(${star.color})`;
          context!.fillRect(x - star.size / 2, star.y - star.size / 2, star.size, star.size);
        }
      }
      context!.globalAlpha = 1;
      context!.globalCompositeOperation = 'source-over';
      drawGlints(t);
    }

    function tick(now: number): void {
      frame = 0;
      if (document.hidden || quiet.matches || !moving) {
        return;
      }
      frame = requestAnimationFrame(tick);
      if (drawnAt >= 0) {
        interval = nextSkyInterval(interval, now - drawnAt);
        drawnAt = -1;
      }
      if (now - last < interval) {
        return;
      }
      last = now;
      draw((now - started) / 1000);
      drawnAt = now;
    }

    function start(): void {
      cancelAnimationFrame(frame);
      frame = 0;
      drawnAt = -1;
      draw((performance.now() - started) / 1000);
      if (!document.hidden && !quiet.matches && moving) {
        frame = requestAnimationFrame(tick);
      }
    }

    let resizeTimer = 0;
    function onResize(): void {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        build();
        start();
      }, 150);
    }

    build();
    start();
    addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', start);
    quiet.addEventListener('change', start);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(resizeTimer);
      removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', start);
      quiet.removeEventListener('change', start);
    };
  });
</script>

<canvas class="night-sky" bind:this={canvas} aria-hidden="true"></canvas>

<style>
  /* Under everything: the sheet's wall and greenery sit at -2 and the
     torches at -1, all in the root's context. */
  .night-sky {
    position: fixed;
    inset: 0;
    z-index: -3;
    display: block;
    inline-size: 100%;
    block-size: 100%;
    pointer-events: none;
  }
</style>
