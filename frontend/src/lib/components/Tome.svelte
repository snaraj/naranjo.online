<!-- THE CHAINED TOME (owner, 2026-10-20: T3, "the corbel", of the tome's five
  settings, and of its leaves: "what I like the most here is the font … this
  fixture looks great"; "use swords instead of bars"; "remove these side
  injections"; "the Chain … needs to be more heavy, heafty, and connect to the
  stand somehow or to the sides of the castle"; "do not have a button that says
  turn the new leaf").

  The accounts are the leaves of one illuminated tome lying open on a lectern
  built out from the wall on a stepped stone corbel: every account's totals
  side by side, then every account's models, two pages at a time, or one at a
  time on a phone. A press on the tome turns its leaf, and so do Enter and Space
  on its lifted corner, the one way in for a keyboard; what the new opening
  shows is said aloud. Under reduced motion the leaf simply changes.

  NOTHING MOVES WHEN A PAYLOAD LANDS OR A LEAF TURNS. Every leaf of a column is
  laid in that column's one grid cell, the closed ones hidden and inert, so the
  tome is always as tall as its tallest leaf; each leaf holds the room of every
  row it can carry (lib/chronicle.ts), filled or not.

  THE BASE, THE IRON AND THE CHAIN ARE DRAWN, ONCE PER SIZE, ON TWO CANVASES
  (lib/tomeDraw.ts), at the torches' resting light: nothing here runs while
  the page is still. The book is flat; only a leaf in the air turns in depth. -->
<script lang="ts">
  import type { ChronicleAccount } from '../blocks.ts';
  import { baseBook, corbel, openingLeaves, tomeLeaves, tomeOpenings, type TomeLeaf } from '../tome.ts';
  import { drawBase, drawChain, tomePaletteTokens, type TomePalette } from '../tomeDraw.ts';

  let {
    accounts,
    factSlots,
    modelSlots
  }: { accounts: readonly ChronicleAccount[]; factSlots: number; modelSlots: number } = $props();

  /* One page at a time below the trackers' own phone width, by the screen
     and never by the tome's own box (lib: Chronicle's model rows). */
  const narrow = '(max-width: 47.99rem)';
  const quiet = matchMedia('(prefers-reduced-motion: reduce)');
  let single = $state(matchMedia(narrow).matches);
  let opening = $state(0);
  /* The leaves shown while one is in the air: the ones it uncovers. */
  let showing = $state<number[] | null>(null);
  let said = $state('');
  let busy = $state(false);

  const leaves = $derived(tomeLeaves(accounts));
  const openings = $derived(tomeOpenings(leaves.length, single));
  const shown = $derived(showing ?? openingLeaves(Math.min(opening, openings - 1), single));

  let root = $state<HTMLDivElement>();
  let pages = $state<HTMLDivElement>();
  let leafLayer = $state<HTMLDivElement>();
  let baseCanvas = $state<HTMLCanvasElement>();
  let chainCanvas = $state<HTMLCanvasElement>();

  /* The base, in its units: as wide as the tome lies open plus its overhang. */
  const book = $derived(single ? baseBook.single : baseBook.spread);
  const base = $derived(corbel(book));
  /* The canvas spans the lip's top to the tail's foot. */
  const baseTop = -8;
  const baseSpan = $derived(base.height - baseTop + 6);

  function room(slots: number, filled: number): number[] {
    return Array.from({ length: Math.max(0, slots - filled) }, (_, index) => index);
  }

  function nameOf(leaf: TomeLeaf): string {
    if (leaf.account.label === '') return '';
    return leaf.kind === 'totals' ? leaf.account.label : `Models of ${leaf.account.label}`;
  }

  function sayOf(leaf: TomeLeaf | undefined): string {
    if (leaf === undefined || leaf.account.label === '') return '';
    return leaf.kind === 'totals' ? `${leaf.account.label}, the totals` : `${leaf.account.label}, the models`;
  }

  const nextSaid = $derived(
    openingLeaves((Math.min(opening, openings - 1) + 1) % openings, single)
      .map((index) => sayOf(leaves[index]))
      .filter((words) => words !== '')
      .join('; ')
  );

  /* The width changed the tome's lie: keep the first leaf shown. */
  $effect(() => {
    const query = matchMedia(narrow);
    const change = (): void => {
      settle();
      const first = openingLeaves(Math.min(opening, openings - 1), single)[0];
      single = query.matches;
      opening = single ? first : Math.floor(first / 2);
    };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  });

  /* ===== The leaf in the air =================================================
     A leaf is built over the page it lifts as two strips, each hinged to the
     last, so the outer edge leads and the leaf curls; each strip carries the
     page's front and the next page's back. Each frame the face turned to the
     reader is shaded by the light it faces — the left torch to the left, the
     right to the right, both a little in front of the wall — and darkened
     toward the spine as it lifts, and the leaf casts a shadow from the spine
     across the page beneath. (The tome's mock, 2026-10-20, carried over.) */
  const STRIPS = [0.62, 0.38];
  const TURN_MS = 1500;
  const BEND = 30;
  const LAND = 0.76;
  const BOUNCE = 9;
  const CURL = 0.3;
  const CAST = 0.45;
  const LIGHT = 0.8;
  const KZ = 0.5;
  const NORM = Math.hypot(1, KZ);
  const AMBIENT = 0.3;
  const D2R = Math.PI / 180;
  let frame = 0;
  let finish: (() => void) | null = null;

  const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

  function faceLight(angle: number, back: boolean): number {
    const s = Math.sin(angle * D2R);
    const c = Math.cos(angle * D2R);
    const nx = back ? s : -s;
    const nz = back ? -c : c;
    const left = Math.max(0, (-nx + KZ * nz) / NORM);
    const right = Math.max(0, (nx + KZ * nz) / NORM);
    const lit = AMBIENT + LIGHT * left + LIGHT * right;
    const lift = 2 * LIGHT * KZ;
    const full = AMBIENT + lift / NORM;
    return lit / full;
  }

  function shade(face: HTMLElement, angle: number, back: boolean): void {
    const r = faceLight(angle, back);
    face.style.setProperty('--s', clamp((1 - r) * 0.85, 0, 0.62).toFixed(3));
    face.style.setProperty('--w', clamp((r - 1) * 0.32, 0, 0.24).toFixed(3));
    face.style.setProperty('--g', (Math.abs(Math.sin(angle * D2R)) * CURL).toFixed(3));
  }

  /* A copy of a leaf for a face of the leaf in the air, shown whatever it is. */
  function copyOf(index: number | null, width: number, height: number, offset: number): HTMLElement {
    const holder = document.createElement('div');
    holder.className = 'tome-face-page';
    holder.style.cssText = `inline-size:${width}px;block-size:${height}px;inset-inline-start:${-offset}px`;
    const source = index === null ? null : pages?.querySelector<HTMLElement>(`[data-leaf="${index}"]`);
    if (source !== null && source !== undefined) {
      const copy = source.cloneNode(true) as HTMLElement;
      copy.removeAttribute('inert');
      copy.removeAttribute('aria-label');
      copy.dataset.open = 'true';
      copy.querySelector('.tome-corner')?.remove();
      holder.append(copy);
    } else {
      holder.classList.add('is-verso');
    }
    return holder;
  }

  function lights(): HTMLElement[] {
    return ['tome-dark', 'tome-warm', 'tome-crease'].map((name) => Object.assign(document.createElement('i'), { className: name }));
  }

  type Strip = { el: HTMLElement; width: number; front: HTMLElement; back: HTMLElement };

  /* Build the leaf over the right-hand page (or the one page): its front the
     leaf at `front`, its back the leaf at `back` (null: a blank verso). */
  function build(front: number | null, back: number | null): { el: HTMLElement; strips: Strip[]; width: number } | null {
    const layer = leafLayer;
    const host = pages;
    if (layer === undefined || host === undefined) return null;
    const box = host.getBoundingClientRect();
    const width = single ? box.width : box.width / 2;
    const height = box.height;
    const el = document.createElement('div');
    el.className = 'tome-leaf';
    el.style.cssText = `inset-inline-start:${single ? 0 : width}px;inline-size:${width}px;block-size:${height}px`;
    let parent: HTMLElement = el;
    let x = 0;
    const strips: Strip[] = [];
    STRIPS.forEach((fraction, index) => {
      const w = index === STRIPS.length - 1 ? width - x : Math.round(width * fraction);
      const strip = document.createElement('div');
      strip.className = 'tome-strip';
      strip.style.inlineSize = `${w}px`;
      const frontFace = document.createElement('div');
      frontFace.className = 'tome-face';
      frontFace.append(copyOf(front, width, height, x));
      frontFace.append(...lights());
      const backFace = document.createElement('div');
      backFace.className = 'tome-face is-back';
      backFace.append(copyOf(back, width, height, width - x - w));
      backFace.append(...lights());
      strip.append(frontFace, backFace);
      parent.append(strip);
      parent = strip;
      strips.push({ el: strip, width: w, front: frontFace, back: backFace });
      x += w;
    });
    layer.append(el);
    return { el, strips, width };
  }

  function pose(leaf: { strips: Strip[]; width: number }, alpha: number, bend: number, dir: number): void {
    const count = leaf.strips.length;
    let previous = 0;
    let lifted = 0;
    let highest = 0;
    let reach = 0;
    leaf.strips.forEach((strip, index) => {
      const f = count === 1 ? 0 : Math.pow(index / (count - 1), 1.15);
      const a = clamp(alpha + dir * bend * f, 0, 180);
      strip.el.style.transform = `rotateY(${(-(a - previous)).toFixed(2)}deg)`;
      previous = a;
      reach += strip.width * Math.cos(a * D2R);
      lifted += strip.width * Math.sin(a * D2R);
      highest = Math.max(highest, lifted);
      shade(strip.front, a, false);
      shade(strip.back, a, true);
      if (single) {
        const fade = clamp(1 - (a - 105) / 55, 0, 1).toFixed(3);
        strip.front.style.opacity = fade;
        strip.back.style.opacity = fade;
      }
    });
    const k = Math.min(1, highest / (leaf.width * 0.22));
    const soft = 6 + highest * 0.16;
    for (const side of single ? ['right'] : ['right', 'left']) {
      const cast = root?.querySelector<HTMLElement>(`.tome-cast[data-side="${side}"]`);
      if (cast === null || cast === undefined) continue;
      const extent = side === 'right' ? reach + highest * CAST * LIGHT : -reach + highest * CAST * LIGHT;
      cast.style.setProperty('--ca', clamp(0.7 * LIGHT * k, 0, 0.62).toFixed(3));
      cast.style.setProperty('--cx', `${Math.round(clamp(extent, 0, leaf.width))}px`);
      cast.style.setProperty('--cs', `${Math.round(soft)}px`);
    }
  }

  function clearCast(): void {
    for (const cast of root?.querySelectorAll<HTMLElement>('.tome-cast') ?? []) {
      cast.style.setProperty('--ca', '0');
    }
  }

  /* Land whatever is in the air where it was going. */
  function settle(): void {
    if (finish !== null) {
      const done = finish;
      finish = null;
      done();
    }
  }

  function turn(): void {
    if (busy || openings < 2) return;
    const from = Math.min(opening, openings - 1);
    const to = (from + 1) % openings;
    const arrive = (): void => {
      opening = to;
      showing = null;
      busy = false;
      said = '';
      const words = openingLeaves(to, single)
        .map((index) => sayOf(leaves[index]))
        .filter((text) => text !== '')
        .join('; ');
      queueMicrotask(() => {
        said = words;
      });
    };
    if (quiet.matches) {
      arrive();
      return;
    }
    busy = true;
    const outgoing = openingLeaves(from, single);
    const incoming = openingLeaves(to, single);
    /* Forward, the right-hand page lifts over to the left; back to the first
       opening, the left-hand page comes back over to the right. One page:
       it always lifts away to its blank back. */
    const forward = single || to > from;
    const front = single ? outgoing[0] : forward ? outgoing[1] : incoming[1];
    const back = single ? null : forward ? incoming[0] : outgoing[0];
    showing = single ? incoming : forward ? [outgoing[0], incoming[1]] : [incoming[0], outgoing[1]];
    const leaf = build(front ?? null, back ?? null);
    if (leaf === null) {
      arrive();
      return;
    }
    const dir = forward ? 1 : -1;
    const at = (t: number): [number, number] => {
      const u = Math.min(1, t / LAND);
      const e = ease(u);
      const over = t - LAND;
      const span = 1 - LAND;
      const settleBack = t > LAND ? Math.sin((Math.PI * over) / span) * BOUNCE * (1 - (over / span) * 0.4) : 0;
      const angle = forward ? 180 * e - settleBack : 180 - 180 * e + settleBack;
      const bend = BEND * Math.sin(Math.PI * u) * (u < 0.5 ? 1 : 1 - (u - 0.5) * 0.6);
      return [angle, bend];
    };
    const [a0, b0] = at(0);
    pose(leaf, a0, b0, dir);
    let started = -1;
    finish = () => {
      cancelAnimationFrame(frame);
      leaf.el.remove();
      clearCast();
      arrive();
    };
    const step = (now: number): void => {
      if (started < 0) started = now;
      const t = Math.min(1, (now - started) / TURN_MS);
      const [a, b] = at(t);
      pose(leaf, a, b, dir);
      if (t < 1) {
        frame = requestAnimationFrame(step);
        return;
      }
      settle();
    };
    frame = requestAnimationFrame(step);
    window.setTimeout(swing, 520);
  }

  /* The chain swings, slow and heavy, about the line between its ends, and
     settles: one transform of its finished picture, never a redraw. */
  let swingFrame = 0;
  let chainAngle = 0;
  function swing(): void {
    const el = chainCanvas;
    if (el === undefined || quiet.matches) return;
    cancelAnimationFrame(swingFrame);
    let started = -1;
    const step = (now: number): void => {
      if (started < 0) started = now;
      const t = Math.min(1, (now - started) / 4600);
      const envelope = Math.sin((Math.min(1, t * 5) * Math.PI) / 2) * Math.exp(-2.4 * t);
      const phase = Math.sin(2 * Math.PI * 1.65 * t);
      const k = envelope * phase;
      el.style.transform =
        t >= 1
          ? ''
          : `rotate(${chainAngle.toFixed(2)}deg) skewX(${(k * 5).toFixed(3)}deg) scaleY(${(1 - envelope * Math.abs(phase) * 0.08).toFixed(4)}) rotate(${(-chainAngle).toFixed(2)}deg)`;
      if (t < 1) swingFrame = requestAnimationFrame(step);
    };
    swingFrame = requestAnimationFrame(step);
  }

  function press(event: MouseEvent): void {
    if ((event.target as HTMLElement | null)?.closest('.tome-corner')) return;
    if (String(getSelection() ?? '').length > 0) return;
    turn();
  }

  function key(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      turn();
    }
  }

  /* ===== The drawing =========================================================
     The palette by name off the canvas; the base at its box's size; the iron
     where the tome's corner and the masonry are. Redrawn when the tome's box
     changes size, and never otherwise. */
  function paletteOf(el: Element): TomePalette {
    const style = getComputedStyle(el);
    return Object.fromEntries(tomePaletteTokens.map((name) => [name, style.getPropertyValue(`--palette-keep-${name}`).trim()]));
  }

  function draw(): void {
    const canvas = baseCanvas;
    const irons = chainCanvas;
    const host = root;
    const tome = pages;
    if (canvas === undefined || irons === undefined || host === undefined || tome === undefined) return;
    const palette = paletteOf(canvas);
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const box = canvas.getBoundingClientRect();
    if (box.width === 0) return;
    const s = box.width / base.width;
    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);
    const ctx = canvas.getContext('2d');
    if (ctx !== null) {
      ctx.setTransform(s * ratio, 0, 0, s * ratio, 0, -baseTop * s * ratio);
      ctx.clearRect(-10, baseTop - 10, base.width + 20, baseSpan + 20);
      drawBase(ctx, base, palette);
    }

    /* The iron, in the tome's own box: the hasp at the book's lower right
       corner, the staple in the wall right of the corbel where the wall shows,
       or else in the corbel's own fourth course. */
    const frame = host.getBoundingClientRect();
    const pagesBox = tome.getBoundingClientRect();
    irons.width = Math.round(frame.width * ratio);
    irons.height = Math.round(frame.height * ratio);
    const ictx = irons.getContext('2d');
    if (ictx === null) return;
    ictx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const baseLeft = box.left - frame.left;
    const baseTopPx = box.top - frame.top - baseTop * s;
    const hasp: [number, number] = [pagesBox.right - frame.left - 10 * s, pagesBox.bottom - frame.top + 6 * s];
    const wallX = baseLeft + base.staple[0] * s;
    const course = base.courses[3];
    const staple: [number, number] =
      wallX <= frame.width - 24 * s
        ? [wallX, baseTopPx + base.staple[1] * s]
        : [baseLeft + (base.centre + course.half - 18) * s, baseTopPx + (course.top + 20) * s];
    drawChain(ictx, hasp, staple, s, palette);
    chainAngle = (Math.atan2(staple[1] - hasp[1], staple[0] - hasp[0]) * 180) / Math.PI;
    irons.style.transformOrigin = `${hasp[0]}px ${hasp[1]}px`;
  }

  $effect(() => {
    const host = root;
    if (host === undefined) return;
    void base;
    let pending = 0;
    const later = (): void => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(later);
    observer.observe(host);
    later();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(pending);
    };
  });

  $effect(() => () => {
    cancelAnimationFrame(frame);
    cancelAnimationFrame(swingFrame);
  });
</script>

<div class="chronicle-accounts tome" bind:this={root} data-single={single ? 'true' : 'false'}>
  <div class="tome-book">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (the corner below is the keyboard's way in) -->
    <div class="tome-pages" bind:this={pages} onclick={press}>
      {#each leaves as leaf, index (`${leaf.kind}-${leaf.account.key}`)}
        {@const open = shown.includes(index)}
        {@const name = nameOf(leaf)}
        <section
          class={leaf.kind === 'totals' ? 'tome-page chronicle-account' : 'tome-page tome-models'}
          data-leaf={index}
          data-side={single ? 'single' : index % 2 === 0 ? 'left' : 'right'}
          data-open={open ? 'true' : 'false'}
          data-pending={leaf.account.label === '' ? 'true' : 'false'}
          inert={!open}
          aria-label={name === '' ? undefined : name}
          aria-hidden={name === '' ? 'true' : undefined}>
          <h3 class={leaf.kind === 'totals' ? 'tome-title chronicle-account-name' : 'tome-title'} aria-label={name === '' ? undefined : name}>
            {#if name !== ''}<span class="tome-initial">{name.charAt(0)}</span><span class="tome-rest">{name.slice(1)}</span>{/if}
          </h3>
          {#if leaf.kind === 'totals'}
            <p class="tome-total"><b>{leaf.account.total}</b> <span class="tome-words">tokens in all</span></p>
            <dl class="chronicle-facts">
              {#each leaf.account.facts as fact (fact.key)}
                <div class="chronicle-fact"><dt>{fact.term}</dt><dd>{fact.value}</dd></div>
              {/each}
              {#each room(factSlots, leaf.account.facts.length) as slot (slot)}
                <div class="chronicle-fact-room" aria-hidden="true"></div>
              {/each}
            </dl>
            {#each leaf.account.lines as note (note)}<p class="chronicle-line-note">{note}</p>{/each}
            <h4 class="tome-head"><span class="tome-words">Of the models</span></h4>
            <ul class="chronicle-models">
              {#each leaf.account.models as model (model.key)}
                <li class="chronicle-model">
                  <span class="chronicle-model-name">{model.label}</span>
                  <span class="chronicle-track"><span class="chronicle-fill" style:--chronicle-share={model.fillPct / 100}></span></span>
                  <span class="chronicle-model-reading">{model.reading}</span>
                </li>
              {/each}
              {#each room(modelSlots, leaf.account.models.length) as slot (slot)}
                <li class="chronicle-room" aria-hidden="true">
                  <span class="chronicle-model-name"></span>
                  <span class="chronicle-track"></span>
                  <span class="chronicle-model-reading"></span>
                </li>
              {/each}
            </ul>
          {:else}
            <ul class="tome-entries">
              {#each leaf.account.models as model (model.key)}
                <li class="tome-entry">
                  <span class="tome-entry-head"><b>{model.label}</b>, {model.reading} of the lifetime</span>
                  <span class="chronicle-model-detail">{model.detail ?? ''}</span>
                </li>
              {/each}
              {#each room(modelSlots, leaf.account.models.length) as slot (slot)}
                <li class="tome-entry tome-entry-room" aria-hidden="true">
                  <span class="tome-entry-head"></span>
                  <span class="chronicle-model-detail"></span>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/each}
      <i class="tome-cast" data-side="right" aria-hidden="true"></i>
      <i class="tome-cast" data-side="left" aria-hidden="true"></i>
      <div class="tome-leaves" bind:this={leafLayer} aria-hidden="true"></div>
      {#if openings > 1}
        <span
          class="tome-corner"
          role="button"
          tabindex="0"
          aria-label={nextSaid === '' ? 'The next leaf' : `The next leaf: ${nextSaid}`}
          data-away={busy ? 'true' : 'false'}
          onclick={turn}
          onkeydown={key}>
          <i class="tome-under"></i><i class="tome-dog"></i>
        </span>
      {/if}
    </div>
  </div>
  <canvas
    class="tome-base"
    bind:this={baseCanvas}
    style:aspect-ratio={`${base.width} / ${baseSpan}`}
    style:--tome-reach={base.width / book}
    aria-hidden="true"></canvas>
  <canvas class="tome-chain" bind:this={chainCanvas} aria-hidden="true"></canvas>
  <p class="tome-said" aria-live="polite">{said}</p>
</div>

<style>
  /* THE TOME, under the diagram, parted from it by a branch as the accounts
     were (owner, 2026-10-19: "the plain lines should be tree branches"). The
     book is at most 46rem wide and never so wide that the base it rests on,
     which overhangs it, leaves the trackers' box. */
  .tome {
    --tome-book: min(46rem, calc(100% / 1.05));
    position: relative;
    display: grid;
    justify-items: center;
    padding-block: 2rem 0.5rem;
    background: var(--keep-branch-3) left top / var(--keep-branch-tile) repeat-x;
  }

  .tome[data-single='true'] {
    --tome-book: calc(100% / 1.08);
  }

  .tome-book {
    position: relative;
    z-index: 1;
    inline-size: var(--tome-book);
    box-sizing: border-box;
    padding: 0.625rem 0.75rem 0.75rem;
    border-radius: 6px;
    background: linear-gradient(180deg, var(--palette-keep-oxblood), var(--palette-keep-oxblood-deep));
    box-shadow:
      inset 0 0 0 3px var(--palette-keep-oxblood-deep),
      inset 0 0 0 4px var(--palette-keep-tome-crease),
      0 3px 0 var(--palette-keep-leather-dark),
      0 1.5rem 2.25rem -1rem var(--palette-keep-tome-shadow);
  }

  /* THE LEAVES: two columns, or one, each holding every leaf it will ever
     show in its one cell, the closed ones hidden and inert. */
  .tome-pages {
    position: relative;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    cursor: pointer;
    perspective: 2400px;
  }

  .tome[data-single='true'] .tome-pages {
    grid-template-columns: minmax(0, 1fr);
  }

  .tome-page {
    grid-row: 1;
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
    box-sizing: border-box;
    padding: 1.5rem 1.625rem 2.5rem;
    background: linear-gradient(180deg, var(--palette-keep-vellum), var(--palette-keep-vellum-deep));
    color: var(--palette-light-text);
    font-family: var(--font-tome);
    font-size: 1.03rem;
    font-weight: 500;
    line-height: 1.3;
    font-variant-numeric: lining-nums tabular-nums;
    cursor: text;
  }

  .tome-page[data-side='left'],
  .tome-page[data-side='single'] {
    grid-column: 1;
  }

  .tome-page[data-side='right'] {
    grid-column: 2;
  }

  .tome-page[data-side='left'] {
    border-radius: 4px 0 0 4px;
    box-shadow: inset -42px 0 34px -28px var(--palette-keep-gutter);
  }

  .tome-page[data-side='right'] {
    border-radius: 0 4px 4px 0;
    box-shadow: inset 42px 0 34px -28px var(--palette-keep-gutter);
  }

  .tome-page[data-side='single'] {
    border-radius: 4px;
    box-shadow: inset 30px 0 30px -26px var(--palette-keep-gutter);
  }

  .tome-page[data-open='false'] {
    visibility: hidden;
  }

  .tome-page[data-pending='true'] .tome-words {
    visibility: hidden;
  }

  /* THE TITLE, with its initial: a blackletter capital in lapis on a square
     of madder dotted in vellum (owner, 2026-10-20: "this fixture looks
     great"), and the rest of the name in small capitals. */
  .tome-title {
    display: flex;
    align-items: flex-end;
    min-block-size: 3.625rem;
    margin: 0 0 0.2rem;
    font-family: var(--font-tome);
    font-size: 1.7rem;
    font-weight: 600;
    line-height: 1;
    letter-spacing: 0.02em;
    color: var(--palette-light-text);
    white-space: nowrap;
    overflow: hidden;
  }

  .tome-initial {
    display: grid;
    flex: none;
    place-items: center;
    inline-size: 3.625rem;
    block-size: 3.625rem;
    margin-inline-end: 3px;
    border-radius: 2px;
    font-family: var(--font-initial);
    font-size: 3.125rem;
    font-weight: 400;
    line-height: 1;
    color: var(--palette-keep-lapis);
    text-shadow:
      1px 1px 0 var(--palette-keep-lapis-deep),
      -1px 0 0 var(--palette-keep-lapis-deep),
      0 -1px 0 var(--palette-keep-lapis-deep);
    background: radial-gradient(circle, var(--palette-keep-vellum) 0 0.8px, transparent 1.3px) 0 0 / 7px 7px, var(--palette-keep-rubric);
    box-shadow:
      inset 0 0 0 2px var(--palette-keep-rubric),
      inset 0 0 0 3px var(--palette-keep-vellum-edge),
      1px 1px 0 var(--palette-keep-vellum-edge);
  }

  .tome-rest {
    min-inline-size: 0;
    padding-block-end: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant: small-caps;
  }

  .tome-total {
    min-block-size: 2.6rem;
    margin: 0.55rem 0 0.3rem;
    overflow: hidden;
    font-size: 1.05rem;
    line-height: 1.2;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .tome-total b {
    margin-inline-end: 0.3rem;
    font-size: 2.6rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1;
  }

  /* The rows: ruled in lapis, every other washed with it, and every row,
     filled or held for a payload on its way, exactly one line box tall, so
     the leaf's height is its width's alone. Each list is one track no wider
     than its leaf, so a long row cuts its figure rather than widening it. */
  .chronicle-facts {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    margin: 0.6rem 0 1rem;
    border-block: 2px solid var(--palette-keep-lapis-mid);
  }

  .chronicle-fact,
  .chronicle-fact-room {
    display: flex;
    justify-content: space-between;
    gap: 0.7rem;
    box-sizing: content-box;
    block-size: 1.3em;
    padding: 0.24rem 0.2rem 0.17rem;
    line-height: 1.3;
    border-block-end: 1px solid var(--palette-keep-lapis-rule);
    white-space: nowrap;
  }

  .chronicle-fact:nth-child(odd),
  .chronicle-fact-room:nth-child(odd) {
    background: var(--palette-keep-lapis-wash);
  }

  .chronicle-fact:last-child,
  .chronicle-fact-room:last-child {
    border-block-end: 0;
  }

  .chronicle-fact dt::first-letter {
    text-transform: uppercase;
  }

  .chronicle-fact dd {
    min-inline-size: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 600;
    text-align: end;
  }

  .chronicle-line-note {
    margin: 0 0 0.6rem;
    color: var(--palette-keep-ink-brown);
  }

  .tome-head {
    min-block-size: 1em;
    margin: 0 0 0.4rem;
    font-family: var(--font-tome);
    font-size: 1.02rem;
    font-weight: 600;
    line-height: 1;
    font-variant: small-caps;
    letter-spacing: 0.06em;
    color: var(--palette-keep-rubric);
  }

  .chronicle-models {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.26rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .chronicle-model,
  .chronicle-room {
    display: grid;
    grid-template-columns: 7.3em minmax(0, 1fr) 3.4em;
    gap: 0.5rem;
    align-items: center;
    min-block-size: 1.3em;
  }

  .chronicle-model-name,
  .chronicle-model-reading {
    min-block-size: 1.3em;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chronicle-model-reading {
    font-weight: 600;
    text-align: end;
  }

  /* The room a model row holds when the account has fewer models than its
     room: the same boxes, painted nothing, and no row a reader or a lane
     counts as a member. */
  .chronicle-room {
    visibility: hidden;
  }

  /* A model's share is a sword (owner, 2026-10-19: "we should have
     swords"): the hilt and the point are always whole, and the blade between
     them is the share — a model with every token draws a sword the length of
     its track, one with almost none a hilt and its point. The blade is its
     three rows of steel as bands drawn along it (--keep-sword-blade), so it
     lengthens without stretching, and the share is printed beside it, so the
     length is never the only way to read it. */
  .chronicle-track {
    block-size: 7px;
  }

  .chronicle-fill {
    --sword-hilt: 13px;
    --sword-tip: 6px;
    display: block;
    box-sizing: border-box;
    block-size: 100%;
    inline-size: calc(var(--sword-hilt) + var(--sword-tip) + (100% - var(--sword-hilt) - var(--sword-tip)) * var(--chronicle-share, 0));
    padding-inline: var(--sword-hilt) var(--sword-tip);
    background:
      var(--keep-sword-hilt) left center / var(--sword-hilt) 100% no-repeat border-box,
      var(--keep-sword-tip) right center / var(--sword-tip) 100% no-repeat border-box,
      var(--keep-sword-blade) left center / 100% 100% no-repeat content-box;
    image-rendering: pixelated;
  }

  /* THE MODELS' LEAF: each model and its share on one line, and its own
     figures in two more, three on a phone — by the screen's width, never by
     what the figures say, so every entry holds the same room. */
  .tome-entries {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.5rem;
    margin: 0.9rem 0 0;
    padding: 0;
    list-style: none;
  }

  .tome-entry {
    display: grid;
  }

  .tome-entry-head {
    min-block-size: 1.3em;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tome-entry-head b {
    font-weight: 600;
    font-variant: small-caps;
    letter-spacing: 0.03em;
  }

  .chronicle-model-detail {
    block-size: 2.6em;
    overflow: hidden;
    line-height: 1.3;
    color: var(--palette-keep-ink-brown);
  }

  @media (max-width: 47.99rem) {
    .tome-page {
      padding: 1.125rem 0.9375rem 2.5rem 1.125rem;
      font-size: 0.97rem;
    }

    .tome-total b {
      font-size: 2.2rem;
    }

    .chronicle-model,
    .chronicle-room {
      grid-template-columns: minmax(0, 1fr) auto;
      row-gap: 0.1rem;
    }

    .chronicle-track {
      grid-row: 2;
      grid-column: 1 / -1;
    }

    .chronicle-model-detail {
      block-size: 3.9em;
    }
  }

  /* The narrowest phones: a figure goes under its term and the lifetime's
     words under the number, each row two line boxes whatever it says, so no
     figure is cut short and nothing is taller once it lands. */
  @media (max-width: 23.99rem) {
    .tome-total b {
      display: block;
      min-block-size: 1em;
    }

    .tome-total .tome-words {
      display: block;
    }

    .chronicle-fact,
    .chronicle-fact-room {
      flex-direction: column;
      gap: 0;
      block-size: 2.6em;
    }

    .chronicle-fact dd {
      text-align: start;
    }
  }

  /* THE CORNER: a dog-ear lifted off the page, the keyboard's one way to the
     next leaf and the only mark that the leaf turns. */
  .tome-corner {
    position: absolute;
    inset-inline-end: 0;
    inset-block-end: 0;
    z-index: 4;
    inline-size: 2.875rem;
    block-size: 2.875rem;
    border-radius: 0 0 4px;
    outline: none;
    cursor: pointer;
  }

  .tome-corner[data-away='true'] {
    opacity: 0;
    pointer-events: none;
  }

  /* It folds away quickly as its leaf lifts and settles back slowly. */
  @media (prefers-reduced-motion: no-preference) {
    .tome-corner {
      transition: opacity 0.45s ease;
    }

    .tome-corner[data-away='true'] {
      transition-duration: 0.1s;
    }
  }

  .tome-corner:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .tome-corner > i {
    position: absolute;
    inset-inline-end: 0;
    inset-block-end: 0;
    inline-size: 1.875rem;
    block-size: 1.875rem;
  }

  .tome-under {
    clip-path: polygon(100% 0, 100% 100%, 0 100%);
    background:
      linear-gradient(315deg, transparent 40%, var(--palette-keep-tome-crease) 50%),
      linear-gradient(180deg, var(--palette-keep-vellum-deep), var(--palette-keep-vellum-edge));
  }

  .tome-dog {
    clip-path: polygon(0 0, 100% 0, 0 100%);
    background: linear-gradient(135deg, var(--palette-keep-vellum) 20%, var(--palette-keep-vellum-deep) 70%, var(--palette-keep-vellum-edge));
    box-shadow: -2px -1px 2px var(--palette-keep-tome-crease);
  }

  /* THE LEAF IN THE AIR and the shadow it casts on the page beneath it. */
  .tome-leaves {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    transform-style: preserve-3d;
  }

  .tome-leaves :global(.tome-leaf) {
    position: absolute;
    inset-block-start: 0;
    transform-style: preserve-3d;
  }

  .tome-leaves :global(.tome-strip) {
    position: absolute;
    inset-block-start: 0;
    block-size: 100%;
    transform-style: preserve-3d;
    transform-origin: 0 50%;
  }

  .tome-leaves :global(.tome-strip .tome-strip) {
    inset-inline-start: 100%;
  }

  .tome-leaves :global(.tome-face) {
    position: absolute;
    inset: 0;
    overflow: hidden;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
  }

  .tome-leaves :global(.tome-face.is-back) {
    transform: rotateY(180deg);
  }

  .tome-leaves :global(.tome-face-page) {
    position: absolute;
    inset-block-start: 0;
    display: grid;
  }

  .tome-leaves :global(.tome-face-page > .tome-page) {
    grid-column: 1;
    block-size: 100%;
  }

  .tome-leaves :global(.tome-face-page.is-verso) {
    background: linear-gradient(180deg, var(--palette-keep-vellum), var(--palette-keep-vellum-deep));
  }

  /* The light on a face of the leaf in the air, three layers each as strong
     as pose() says: the dark of facing away from both torches, the warmth of
     facing into them, and the crease darkening toward the spine as it lifts. */
  .tome-leaves :global(.tome-dark),
  .tome-leaves :global(.tome-warm),
  .tome-leaves :global(.tome-crease) {
    position: absolute;
    inset: 0;
  }

  .tome-leaves :global(.tome-dark) {
    background: var(--palette-keep-umbra);
    opacity: var(--s, 0);
  }

  .tome-leaves :global(.tome-warm) {
    background: var(--palette-keep-lamp);
    opacity: var(--w, 0);
  }

  .tome-leaves :global(.tome-crease) {
    background: linear-gradient(90deg, var(--palette-keep-umbra), transparent 55%);
    opacity: var(--g, 0);
  }

  .tome-leaves :global(.tome-face.is-back .tome-crease) {
    background: linear-gradient(270deg, var(--palette-keep-umbra), transparent 55%);
  }

  .tome-cast {
    --ca: 0;
    --cx: 0px;
    --cs: 10px;
    position: absolute;
    inset-block: 0;
    z-index: 2;
    inline-size: 50%;
    pointer-events: none;
    opacity: var(--ca);
  }

  .tome-cast[data-side='right'] {
    inset-inline-end: 0;
    background: linear-gradient(90deg, var(--palette-keep-umbra) max(0px, calc(var(--cx) - var(--cs))), transparent calc(var(--cx) + var(--cs)));
  }

  .tome-cast[data-side='left'] {
    inset-inline-start: 0;
    background: linear-gradient(270deg, var(--palette-keep-umbra) max(0px, calc(var(--cx) - var(--cs))), transparent calc(var(--cx) + var(--cs)));
  }

  .tome[data-single='true'] .tome-cast[data-side='right'] {
    inline-size: 100%;
  }

  /* THE BASE under the book, its lip over the book's foot, and the iron over
     everything, taking no pointer. */
  .tome-base {
    position: relative;
    z-index: 2;
    display: block;
    inline-size: calc(var(--tome-book) * var(--tome-reach));
    block-size: auto;
    margin-block-start: calc(var(--tome-book) * -0.01);
    pointer-events: none;
  }

  .tome-chain {
    position: absolute;
    inset: 0;
    z-index: 3;
    inline-size: 100%;
    block-size: 100%;
    pointer-events: none;
  }

  .tome-said {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
