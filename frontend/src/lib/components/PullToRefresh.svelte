<!-- The pull-to-refresh surface (issue 219): the indicator a reader sees, the
  control a keyboard reaches, and the binding that drives both. The gesture's
  arithmetic and its settle live in lib/pullToRefresh.ts, which explains why
  the browser's own pull-to-refresh stays suppressed and why that suppression
  is what makes this implementable rather than what it fights.

  WHY THERE IS A BUTTON HERE AT ALL, given issue 179 removed one. Two separate
  rules meet at this component and both are contract:

  - Issue 179's ruling was that the page must stay current ON ITS OWN and never
    depend on a visitor noticing a control. That still holds and nothing here
    weakens it: the per-panel minute loop is untouched, a reader who never
    pulls sees exactly what they saw before, and a failed read still logs and
    degrades to its honest unavailable envelope.
  - AGENTS.md's rendering floors require that every gesture have a non-gesture
    equivalent — a gesture-only affordance is unreachable by keyboard and by
    assistive technology, which makes it a defect rather than a feature.

  The resolution is a control that EXISTS for everyone but is CHROME for
  nobody: it is the first focusable thing in the document and it is invisible
  until focused, exactly as a skip link is. A keyboard or screen-reader user
  reaches it with one Tab; a sighted mouse reader never sees it and is never
  invited to depend on it. That satisfies both rules instead of trading one
  away, and it is the narrow, stated exception requirement 4 asks for rather
  than a quiet reversal of an owner ruling.

  ZERO CLS BY CONSTRUCTION. The indicator is `position: fixed` and the page is
  moved with a `transform`, so no box on this page changes size or position in
  layout terms at any point in the gesture — a pull costs a composited
  translate and nothing else, and the document's own height never moves. -->
<script lang="ts">
  import { refreshPanels } from '../panels.ts';
  import {
    pullMetrics,
    pullProgress,
    pullToRefresh,
    type PullPhase
  } from '../pullToRefresh.ts';

  let distance = $state(0);
  let phase = $state<PullPhase>('idle');
  /* Whether the PAGE itself is displaced, which is only ever true for the
     GESTURE. The indicator's travel and the page's travel used to be one
     number, and that conflated two different things: a finger dragging the
     document down IS moving the page, while a keyboard reader pressing the
     control below has dragged nothing — sliding the whole column out from
     under them was a side effect of sharing a variable, not a decision.
     Splitting them is what makes the transform rule in styles.css apply to
     the narrowest possible moment (it re-parents every fixed descendant while
     it is on), and it is why the refresh control no longer has to close an
     open readout to be safe. */
  let displacing = $state(false);

  const progress = $derived(pullProgress(distance));

  /* The copy is the SAME rule the release decision uses (pullArmed, through
     the phase the binding reports), so the indicator can never say "release to
     refresh" at a distance that would not refresh. */
  const caption = $derived(
    phase === 'refreshing'
      ? 'Refreshing'
      : phase === 'armed'
        ? 'Release to refresh'
        : 'Pull to refresh'
  );

  const binding = {
    /* The document is the scroller. scrollY rather than a scrollTop read on
       some element, because that is what the page actually scrolls, and the
       tolerance is one pixel: a fractional device ratio can leave a page that
       IS at the top reporting 0.5. */
    atTop: () => globalThis.scrollY <= 1,
    reduced: () =>
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    render: (next: number, nextPhase: PullPhase) => {
      distance = next;
      phase = nextPhase;
      /* Only this path — the gesture's — moves the page. */
      displacing = next > 0;
    },
    refresh: () => refreshPanels()
  };

  /* The keyboard path runs the identical work and shows the identical
     indicator — it is the same refresh, not a second one — so a reader who
     presses it sees the control settle when real data lands, exactly as a
     reader who pulled does.
     It does NOT move the page, and that is the difference between the two
     paths rather than an inconsistency: a gesture displaces the document
     because a finger is holding it displaced, while a press displaces
     nothing. `displacing` is deliberately untouched here, so the transform
     rule never engages, no fixed descendant is re-parented, and an open
     readout — with the cursor and the aria-activedescendant a screen reader
     is following — survives the refresh it asked for. */
  async function refreshFromControl(): Promise<void> {
    if (phase === 'refreshing') {
      return;
    }
    distance = pullMetrics.rest;
    phase = 'refreshing';
    try {
      await refreshPanels();
    } finally {
      distance = 0;
      phase = 'idle';
    }
  }

  /* Applied to <body> rather than to a wrapper: the thing being pulled is the
     page, and wrapping the whole document in a div to hold a listener would
     add a box every other layout rule would then have to reason about. */
  $effect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const bound = pullToRefresh(document.body, binding);
    return () => bound.destroy();
  });

  /* The page's own travel. Written as a custom property on the root rather
     than as a style on <main>, so the rule that consumes it lives in
     styles.css beside every other page-level decision.

     The ATTRIBUTE beside it is not decoration and styles.css says why at
     length: a `transform` of any value other than `none` makes its element a
     containing block for every fixed-position descendant, and `translateY(0)`
     is such a value. A permanently-applied travel rule would therefore
     silently re-parent the pinned header and every detail card away from the
     viewport for the life of the page. So the attribute exists only while the
     surface is genuinely displaced, and the transform rule with it. */
  $effect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    root.style.setProperty('--page-pull', `${distance}px`);
    if (displacing && distance > 0) {
      root.setAttribute('data-pulling', 'true');
      /* THE OTHER HALF OF THAT SAME CONTAINING-BLOCK RULE, and it is answered
         by geometry rather than by code. While this attribute is on, <main>
         genuinely IS the containing block for every `position: fixed`
         descendant inside it — 101 of them here, every one a detail card — so
         lib/tooltip.ts's stated guarantee ("a fixed box is outside the
         scrollable overflow region by construction") is suspended for exactly
         as long as the gesture lasts.
         Nothing is affected, and that is MEASURED rather than assumed: a pull
         engages only with the document at its top, and the nearest detail host
         on this page sits 3055px down it — against a viewport of 1366px on the
         tallest touch device anyone brings to this site. No card can be open
         when the attribute goes on. The page header, the only other chrome
         pinned to the viewport, is outside <main> entirely.
         An earlier revision of this repair closed any open detail here. It was
         cut because it could not fire: a guard no input can trip is decorative,
         and its own mutant survived the lane that was supposed to pin it. The
         property it relied on is pinned instead — the rendering lane asserts
         that nothing fixed inside <main> is VISIBLE at the top of the
         document, which is the day this code would be needed and the day that
         lane goes red. */
    } else {
      root.removeAttribute('data-pulling');
    }
  });
</script>

<!-- aria-live on the caption, not on the whole control: a reader needs to hear
  "Refreshing" when the state changes, and does not need the button's own name
  re-announced every frame of a drag. -->
<div class="pull-indicator" data-pull-phase={phase} aria-hidden={distance === 0}>
  <span class="pull-mark" style:--pull-progress={progress}>
    <svg class="pull-glyph" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M12 5v10m0 0l-4-4m4 4l4-4"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </span>
  <span class="pull-caption" aria-live="polite">{caption}</span>
</div>

<button
  type="button"
  class="pull-control"
  onclick={refreshFromControl}
  disabled={phase === 'refreshing'}
>
  Refresh panel data
</button>

<style>
  /* Fixed, so it takes no flow space and the page's height never changes; it
     rides just above the top edge and is drawn down by the same distance the
     page is. */
  .pull-indicator {
    position: fixed;
    inset-block-start: 0;
    inset-inline: 0;
    z-index: var(--layer-menu);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    pointer-events: none;
    /* Parked entirely above the viewport at rest, so nothing of it shows until
       a pull begins. The travel is the pull's own distance. */
    transform: translateY(calc(var(--page-pull, 0px) - 100%));
    font-size: var(--panel-badge-size, 0.6875rem);
    color: var(--panel-muted);
  }

  .pull-mark {
    display: grid;
    place-items: center;
    inline-size: 2rem;
    block-size: 2rem;
    border-radius: 999px;
    background: var(--color-surface-raised);
    color: var(--panel-accent);
    /* The arming state is never colour alone: the glyph ROTATES toward the
       threshold as well, so the crossing is legible without relying on a
       reader separating two tones. */
    transform: rotate(calc(var(--pull-progress, 0) * 180deg));
  }

  /* Past the threshold the mark is filled as well as turned — two channels
     for one state, which is the dataviz floor applied to a control. */
  .pull-indicator[data-pull-phase='armed'] .pull-mark,
  .pull-indicator[data-pull-phase='refreshing'] .pull-mark {
    background: var(--panel-accent);
    color: var(--color-surface);
  }

  @keyframes pull-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* The only LOOPING motion here, and it is stated inside `no-preference`
     rather than cancelled inside `reduce`, per this page's rule: a cancelling
     block is reachable only by a browser that HAS the media feature, so it
     leaves the spin running everywhere the feature is unknown, while stating
     it here never starts it there. The refreshing state stays legible without
     it — the mark is filled and the caption reads "Refreshing".

     The pull's own travel is deliberately NOT in here: it is the surface
     following a finger, not an animation, and suppressing it would break the
     gesture rather than calm it. The settle is likewise handled in
     lib/pullToRefresh.ts, which jumps to the destination instead of easing to
     it when the reader has asked for less motion. */
  @media (prefers-reduced-motion: no-preference) {
    .pull-indicator[data-pull-phase='refreshing'] .pull-glyph {
      animation: pull-spin 900ms linear infinite;
    }
  }

  /* The non-gesture equivalent: reachable by Tab, invisible until it is. Not
     `display: none` and not `hidden` — both would take it out of the focus
     order, which is the entire point of it. */
  /* HIDDEN BY CLIPPING, NEVER BY SHRINKING. The usual visually-hidden recipe
     collapses a control to 1px and clips it, which would put this one under
     the 44px touch floor every other control on the page clears — and the
     floor is not a rendering detail to be waived for a control that happens
     to be invisible at rest, because the moment it is focused it is a real
     target a real finger may go for. So the BOX stays at the floor and the
     PAINT is what is removed: `clip-path: inset(50%)` hides it completely,
     `position: absolute` keeps it out of flow, and revealing it on focus
     changes no dimension at all. */
  .pull-control {
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;
    min-inline-size: 2.75rem;
    min-block-size: 2.75rem;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
    padding: 0;
  }

  .pull-control:focus-visible {
    z-index: var(--layer-menu);
    padding: 0.5rem 0.75rem;
    overflow: visible;
    clip-path: none;
    background: var(--color-surface-raised);
    color: var(--color-text);
    border-radius: var(--card-radius);
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
