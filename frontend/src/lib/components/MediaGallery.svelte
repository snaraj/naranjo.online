<!-- MediaGallery renders one photograph at a time from a vendored set (owner
  UX directive, issue 176): a single visible frame, icon-only prev/next
  controls, and a click-to-enlarge native <dialog> lightbox showing the
  full-resolution derivative. It is a generic primitive with NO domain
  knowledge — every item's preview/full URL and alt text arrive through
  MediaGalleryProps (lib/blocks.ts), built by an adapter in the binding
  layer; this component knows no digest, no file name and no vendoring
  decision of its own.

  It used to render a FEED of every picture stacked full-resolution (issue
  134) — eight frames a reader had to scroll past to see any one of them.
  Issue 176 replaced that with exactly one visible frame at a time: the
  shared FeedCard primitive in its media-led variant still supplies the
  chrome (issue 136's one-card doctrine), but only the current item's small
  preview mounts inside it. Clicking the photograph opens a native <dialog>
  — free focus trap, Escape-to-close and backdrop, per lib/disclosure.ts's
  choice for the theme popover — showing the full-resolution derivative,
  which loads for the first time only then. Arrow keys navigate the
  lightbox; its own close button and a genuine backdrop click also close
  it.

  The stage is reserved before any byte arrives — same box, same ratio,
  same place — through the --gallery-stage-* tokens in styles.css, so nothing
  here computes a shape of its own. There is ONE pair of those tokens and
  every item takes it, whatever kind it is: see ISSUE 243 below, which
  retired the second pair. The card around it is variant="flat": the framed
  --card-media-* treatment retired with the container box.

  The enlarged frame's border is TOKENS ONLY — see the --gallery-frame-*
  block in styles.css; border-image's initial value is 'none', so a future
  patterned border is a token edit there, never code here.

  ISSUE 202 — three owner findings from a live review, all answered here:

  1. CENTRED FRAME. The visible frame is narrower than the 1fr track it sits
     in on any column wider than 35.5rem, and `justify-self: normal` behaves
     as START rather than stretch for a box with an aspect ratio, so the
     whole surplus used to land on one side — MEASURED at 1280px: a 568.9px
     frame at the left of an 842px track, 273px of dead space on the right
     alone. A .gallery-stage wrapper now carries a DEFINITE width built from
     the same two tokens the reserved box is, and centres itself with auto
     margins. It is a wrapper rather than an alignment property on the button
     because an aligned grid item is sized by its CONTENT — with the lazy
     image blocked, `justify-self: center` alone reserved 0x0 on Gecko,
     194.6x109.4 on Blink and 163x91.7 on WebKit, which would have traded the
     owner's dead gutter for a broken zero-CLS floor.
  2. A CLOSE MARK THAT DOES NOT SIT ON THE ARTWORK. The close control used
     to be a 44px filled disc stamped over the photograph's top-right
     corner. It is now a small mark in a reserved lane ABOVE the frame: the
     44px touch target survives as an INVISIBLE hit box (rendering lanes
     stage 1), aligned so the painted mark tucks into the lane and never
     overlaps the picture. Placing it outside the dialog was measured and
     rejected: a native <dialog> is width:fit-content with UA overflow:auto,
     and pushing the control past its box turned the dialog scrollable
     (scrollWidth 1194 against clientWidth 1154 at a 1280px viewport).
  3. OPTIONAL PER-ITEM METADATA. title, description and link are each
     independently optional, and ABSENT RENDERS NOTHING — no empty row, no
     dash, no fabricated copy. Nothing here supplies a default, because a
     default is how an honest empty state becomes a fabricated one. The
     caption sits AFTER the counter, the last thing in the block, so an item
     that carries one moves neither the photograph, the arrows nor the
     counter.
     The deliberate trade this originally carried — the owner's own "reserve
     space only when the specific item has something to show", which let
     content BELOW the gallery reflow when a captioned item came round — was
     REVERSED at issue 265 after the owner watched it happen; see that block
     below. What the absent state means is unchanged: an item with nothing to
     say still renders nothing. What changed is that the BOX is no longer the
     item's to move.

  MOVING ITEMS (issue 207, rebuilt for issue 233). An item carrying a `video`
  bag is a film; every other item is exactly the still it was before that
  field existed. Four rules make it safe as well as legible:

  1. THE STRIP MOUNTS EXACTLY ONE VIDEO, AND ONLY THE CURRENT ITEM'S. A film
     plays where it sits, the way an embedded player does (owner directive,
     2026-08-28: "just play it in this small minimal version"). What the
     older "never mounts a video" rule was actually protecting is untouched,
     and it is what makes this safe: the stage renders `item`, the ONE item
     the index names, so moving to another item UNMOUNTS the element. Eight
     mounted <video> elements was the weight problem the one-frame redesign
     removed; one is the same count as the one <img> a still mounts.
     The drawn play triangle that used to sit on a film's poster went with
     the change (owner: "remove the play icon from all videos, its just there
     doing nothing") — it promised a press that happened somewhere else. A
     triangle is back at issue 243, and the distinction is the whole reason
     the owner objected to the first one: that mark was DECORATION over a
     player that answered presses anywhere, this one IS the press, and it is
     the only thing on a film's stage that answers one.
  2. NOTHING EVER AUTOPLAYS. The element carries `playsinline`,
     `preload="metadata"` and — since issue 243 — its native controls only
     once the reader has pressed play, and it carries no `autoplay` attribute
     anywhere in this file: not conditionally, not muted, not "just for the
     poster". The one call to play() is in startFilm(), reached from a press.
     That is also how prefers-reduced-motion is honoured STRUCTURALLY rather
     than by a media query: there is no motion to suppress until a reader
     presses play, and a reader pressing play has asked for it. `preload` is
     metadata rather than none because the element is now ON SCREEN and has to
     answer the first press: `none` left it unable to even choose a source
     until play was pressed, which on a phone rendered as a dead black
     rectangle that answered no taps (owner defect report, 0.1.52). Metadata
     costs a few KB of headers, buys working controls and a duration, and
     still defers the film itself until play.
  3. SOURCE ORDER IS THE MANIFEST'S. The <source> children render in the
     order they arrive and this component neither sorts nor filters them,
     because the browser takes the first it can decode — a typical ladder is
     a high-efficiency rung ahead of a universal one, and reordering it would
     silently hand a reader different bytes. The ladder is wrapped in {#key
     item.key} so moving between two films REMOUNTS the element: swapping
     <source> children under a live <video> does not re-run resource
     selection, so a reused element would keep playing the previous film's
     bytes under the new item's poster.
  4. THE SURFACE IS THE READER'S UNTIL THEY HAND IT OVER — see ISSUE 243,
     which reversed what this rule used to say.
  5. THE LIGHTBOX IS FOR STILLS. There is nothing left to enlarge to for a
     film — the player IS the surface — so the dialog's video branch went
     with the change rather than being left unreachable. Navigating the
     lightbox onto a film therefore closes it, which is the one route that
     could still have landed there.

  ISSUE 241 — five measured defects from a responsiveness sweep of the live
  0.1.54 origin, answered here and in styles.css:

  1. THE FRAME RESERVES; THE STAGE DOES NOT. A still's stage and a film's are
     different SHAPES, so moving between kinds resized the document under the
     reader (-105.9px at 390px, and back again). The reservation moved up one
     level to .gallery-frame, which holds the square both stages fit inside;
     each stage is centred in it and a kind change now costs zero pixels.
  2. ONE CONTROL ROW, UNDER THE WORK. The arrows left the frame. Beside the
     stage they cost a phone 116px of a 288px card — which left a film
     172x97, smaller than the control bar drawn inside it — and on a desktop
     they sat 212px from the artwork at the far edges of their track. Below
     it they are adjacent at every width and the stage keeps the whole frame.
  3. THE DOTS ARE ONE ROW THAT SCROLLS, never two or three that wrap.
  4. LABELS KNOW WHAT AN ITEM IS. "Photograph 7 of 9" on a film is a false
     statement to the one reader who depends on it, so every accessible name
     and the live region derive their noun from the item's own kind.
  5. THE PAGE DOES NOT SCROLL BEHIND THE LIGHTBOX, and the enlarged surface
     offers a phone the preview rather than the master.

  ISSUE 243 — two owner rulings from a live review of 0.1.55, and the second
  of them REVERSES a design this file argued for two releases running. The
  old rationale is not deleted, because a reader who finds only the new rule
  cannot tell whether the old problem was solved or forgotten.

  1. ONE BLOCK, AND THE MEDIA REDUCES INSIDE IT. "The art box changes heights
     depending on it being a video or art, I don't like the entire website
     moving around because of that, make it one single block that doesn't
     expand, reduce based on the media."
     Issue 241 had already stopped the DOCUMENT moving: the reservation went
     up to .gallery-frame, which holds the square both stages fitted inside,
     so nothing below the gallery shifted on a kind change. What it did not
     stop was the thing the owner is actually looking at. The two stages were
     still different boxes — MEASURED at 1280px, a 448x448 still against a
     768x432 film — so the visible object grew 320px wider and shrank 16px
     shorter on every press of the next arrow, inside a frame the reader
     cannot see. A reservation nobody can see is not an answer to "the box
     changes size".
     So the second pair of stage tokens is gone and there is ONE stage box.
     A film is letterboxed inside it by the `object-fit: contain` its player
     already carried, against the stage's own ground. That is the owner's
     sentence made structural: the block cannot expand for a film, because
     there is no longer any expression anywhere that says a film's box is
     different.
     What this gives up is real and was the whole of issue 233's case: a 16:9
     film in a square stage is smaller than it was, with ground above and
     below it. The owner has weighed that against the page moving and chosen;
     restoring a per-kind size means reintroducing a token pair here, not
     editing a number.
  2. A FILM IS SWIPEABLE, AND ONLY ITS PLAY CONTROL IS NOT. "You cannot swipe
     out of a video, it instead starts to play immediately... the sensitive
     area should only be the button and not the entire video."
     Rule 4 above used to say the opposite, and its reasoning was sound as far
     as it went: a horizontal drag along a seek bar is exactly the shape
     lib/gesture.ts claims, so a gesture bound over live native controls turns
     a scrub into a page turn. What it got wrong was the SCOPE — it protected
     the controls by disarming the whole stage for the whole life of the item,
     including the entire time before the reader has shown any interest in
     playing anything. Four films in nine items became four dead ends in the
     strip's only direct gesture.
     The repair is to make the surface's ownership a STATE rather than a
     property of the item's kind, and to express that state as an element
     rather than as a condition inside the gesture. Before play, a veil covers
     the player: it carries the identical swipe binding a still's stage does,
     it holds the one play control, and the player beneath it renders its
     poster with no `controls` attribute at all — so there is no seek bar to
     scrub and nothing for the drag to contest. The reader presses play, the
     veil unmounts and `controls` appears, and from that moment the player
     owns its surface exactly as rule 4 wanted. No branch in lib/gesture.ts
     knows any of this: the binding is simply on an element that exists for
     precisely as long as the swipe should be available.
     PAUSE DOES NOT BRING THE VEIL BACK; ENDED DOES. The asymmetry is the
     point. Pause is how a reader REACHES the scrubber — restoring the veil
     there would put a swipe surface over the controls the reader just
     stopped the film to use, and every pause would cost them their position.
     Ended is different: there is nothing left to control, the player has
     returned to its poster, and handing the surface back is what lets the
     reader keep moving through the strip without going to the arrows.
     NAVIGATING AWAY HANDS IT BACK AS WELL, and the first cut of this change
     got that wrong in a way worth recording, because the error is an easy one
     to repeat. It derived `playing` from the playing key matching the current
     item and called the derivation a reset. A derivation is not a reset: it
     SUPPRESSED the handover while the reader was away and the key survived, so
     returning to a film played once re-armed it with no press — REPRODUCED in
     chromium as {"veils":0,"controls":true,"paused":true}, a veil-less paused
     poster with native controls and no swipe binding, which is exactly the
     owner's complaint restored for every film played once. The key is now
     CLEARED by the one function that moves the index (goTo), so the handover
     lasts one visit; the derivation stays because it is still what keeps a
     render from ever showing two films' state at once.
     Arrow keys reach the strip from the play control (the same handler the
     still's enlarge button carries), so a film is no worse off by keyboard
     than a still. Once the player has the surface the arrows are the
     player's, which is the same structural answer rule 4 gave.

  OWNER 2026-08-29 — "on the web browser, I lost the ability to move through
  the images/videos, only on full screen I can do it. bring back the buttons
  but chose to hide them by default in mobile."

  The diagnosis first, because the obvious reading — broken handlers — is
  wrong, MEASURED against the live 0.1.63 origin and the local binary alike:
  the control row's two chevrons still fired on every click, including from a
  film and while one was playing. What a desktop reader actually has is an
  affordance hole with three measured sides. A mouse drag across a still is
  taken by the browser's native image drag before the gesture can prove
  itself horizontal (pointerdown, one move, dragstart, pointercancel — and
  lib/gesture.ts is RIGHT to treat that cancel as authoritative), so the
  strip's one direct gesture does not exist on a mouse. The arrow keys work
  only once focus is inside the gallery, and the click that puts it there
  opens the lightbox — which has its own arrow keys, hence "only on full
  screen I can do it". And the one control that remained was a 12px chevron
  (owner directive 2026-08-28, aimed at a phone's control row) tucked between
  the dots, which the owner's own report demonstrates no longer reads as a
  button at all.

  So the buttons come back where they were before issue 241 moved them — ON
  the work, flanking the stage — and the phone half of that issue's case is
  answered by capability rather than relocation: the pair is hidden by
  default and shown only where hover and a fine pointer are both reported
  (lib/tooltip.ts's finePointerQuery, the site's one capability split), so a
  phone keeps swipe plus dots and never pays the 116px the old flanking
  arrows cost it. The control row's own chevrons leave with the change —
  two pairs of the same control on a desktop is chrome about chrome, and on
  a phone the owner already ruled "I only like the dots". Navigation is the
  same one path everything else uses: the pair calls previous()/next(),
  which run through goTo(), so paging away from a playing film still takes
  the surface back exactly as the issue-243 block above requires.

  ISSUE 265 — the gesture defects a five-engine sweep measured on 0.1.65, and
  the two that live in this file.

  1. A COMMITTED SWIPE MOVED THE ART BACKWARDS. The new item mounted at the
     OLD drag offset and settled to zero, so it slid in from the side it had
     just left — 120-202px of wrong-way travel per swipe. The strip now places
     the incoming item at its own entry offset (lib/gesture.ts's entryOffset,
     one span beyond where the finger let go), flushes that position, and only
     then animates forward to zero. The drag is bounded to one span in the
     same change, which is what makes "forward" a property rather than a hope.
     A reduced-motion reader is handed the destination with no entry at all.
  2. THE CAPTION IS A RESERVED LANE, NOT A CONDITIONAL SIBLING. Moving through
     the strip pushed the whole document up and down — MEASURED at 50px on a
     1440 viewport and 69px on a 390 one — and the mover was never the stage:
     the frame and the stage are invariant to 0.0px, and the caption was a
     sibling that existed only for the items that carried one. The owner's
     ruling is that the frame must already hold the box. Every item's caption
     now renders into one stacked grid cell, all but the current one hidden,
     so the lane is the tallest caption the CURRENT SET can render at the
     CURRENT width and an item change costs zero pixels. See the lane's own
     block in the markup and the stylesheet below.

  Each is stated again beside the declaration that carries it. -->
<script lang="ts">
  import { tick } from 'svelte';
  import FeedCard from './FeedCard.svelte';
  import { entryOffset, swipeHorizontal } from '../gesture.ts';
  import { isChord, ringTarget } from '../keys.ts';
  import type { MediaGalleryItem, MediaGalleryProps } from '../blocks.ts';

  let { items, width, height }: MediaGalleryProps = $props();

  const total = $derived(items.length);

  let index = $state(0);
  let enlarged = $state(false);

  const item = $derived(items[index]);

  /* WHICH FILM THE READER HANDED THE SURFACE TO (issue 243). It is the item's
     KEY rather than a boolean, and the key buys ONE thing precisely: no render
     can ever show a film carrying another film's surface state, whatever order
     the elements mount and unmount in.
     It does NOT reset anything, and reading it as a reset was the defect the
     review caught — a suppressed key is still a set key, and it comes back the
     moment the reader does. goTo() clears it; see the note there. Both halves
     are needed and neither substitutes for the other. */
  let playingKey = $state<string | undefined>(undefined);
  const playing = $derived(playingKey !== undefined && playingKey === item.key);

  /* WHAT AN ITEM IS CALLED (issue 241). Every accessible name this component
     writes used to say "photograph", including on the four films the volume
     publishes — a label that is simply false, and the one channel a reader
     using assistive technology has for knowing what they are on. The word is
     derived from the same field the stage's own kind is (`video`), so the
     label and the rendered element can never disagree about what an item is. */
  function itemNoun(candidate: MediaGalleryItem): string {
    return candidate.video === undefined ? 'photograph' : 'film';
  }

  /* One item's position, spoken. It is the dots' accessible name AND the live
     region's whole text, so the announcement a reader gets on every move is
     the same sentence the control they pressed already carried. */
  function positionLabel(at: number): string {
    const noun = itemNoun(items[at]);
    return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${at + 1} of ${total}`;
  }

  /* The arrows name the item they will REACH rather than the one on screen:
     "Next film" is the true thing to say about a press that lands on a film,
     and a reader hearing "next photograph" and getting a video player has been
     told something wrong by the only label they had. */
  const previousIndex = $derived((index - 1 + total) % total);
  const nextIndex = $derived((index + 1) % total);

  /* The group's own name, over the SET rather than the current item: a strip
     of eight drawings is still a choice of photographs, and one carrying films
     says so once instead of changing its name underneath a reader. */
  const chooseLabel = $derived(
    items.some((candidate) => candidate.video !== undefined) ? 'Choose a photograph or film' : 'Choose a photograph'
  );

  /* Truthiness, not `!== undefined`: an empty string is as absent as a
     missing field for a reader, and rendering an empty row for one is the
     "no blank fields" failure this exists to prevent. */
  const hasCaption = $derived(Boolean(item.title) || Boolean(item.description));
  const hasMeta = $derived(hasCaption || item.link !== undefined);

  /* An item's own intrinsic box when it declared one, the gallery's otherwise.
     This is the element's size HINT; the reserved frame comes from the
     --card-media-* tokens and is the same box for every item, which is why
     swapping one set of items for another shifts no layout. */
  const itemWidth = $derived(item.width ?? width);
  const itemHeight = $derived(item.height ?? height);

  /* EVERY MOVE THROUGH THE STRIP GOES THROUGH HERE, and the reason is a defect
     the first cut of issue 243 shipped: `playing` was DERIVED from the key
     matching the current item, and the derivation alone was mistaken for a
     reset. It is not one. Moving away only SUPPRESSED the handover — the key
     survived — so coming back to a film the reader had played once re-armed it
     with no press: REPRODUCED in chromium as {"veils":0,"controls":true,
     "paused":true}, which is a veil-less paused poster carrying native
     controls and no swipe binding. That is the owner's "you cannot swipe out
     of a video" restored for every film played once, and it is the exact state
     this design calls mutually exclusive.
     So the handover is per VISIT rather than per item, and clearing it is an
     assignment beside the one that moves the index rather than a rule spread
     across five call sites. `index` is assigned in exactly one place in this
     file — pinned in tests/sections.test.mjs — so a future control that moves
     the strip cannot forget to hand the surface back. */
  function goTo(at: number): void {
    index = at;
    playingKey = undefined;
  }

  function next(): void {
    goTo((index + 1) % total);
  }

  function previous(): void {
    goTo((index - 1 + total) % total);
  }

  /* THE SWIPE (issue 219). The owner's report was "I can't swipe/motion
     through the image", and it was exactly right: this gallery shows one
     photograph and offered only two arrow buttons to move between them, which
     on a phone is the least reachable control on the card.

     Three constraints shape what is below, and all three are contract rather
     than taste. Requirement 1 forbids a gesture library, so the arithmetic is
     lib/gesture.ts and hand-rolled on Pointer Events. Vertical scrolling is
     never stolen: the stage declares `touch-action: pan-y`, the binding claims
     nothing until a drag has proven itself horizontal, and a `pointercancel`
     from the browser ends the gesture rather than contesting it. And every
     gesture owes a non-gesture equivalent: the dots below are real buttons
     on every device, arrow keys drive the frame, and a fine-pointer device —
     where this drag structurally does not exist, see the 2026-08-29 header
     block — gets the stage pair as well. The swipe is an ADDITION to the
     ways through this gallery, never the only one. */
  let dragX = $state(0);
  let settling = $state(false);
  let stageEl: HTMLDivElement | undefined = $state();

  /* THE SETTLE IS OWNED (issue 265). `settling` is what arms the CSS
     transition, and it used to be cleared by a free-running timeout nobody
     held: a swipe started inside that window dragged through a still-armed
     transition (MEASURED at 66-93px of lag between finger and picture), and
     the timer from one settle could disarm the NEXT settle mid-flight. So
     there is one handle, it is cancelled before it is re-armed, and the next
     pointerdown ends it early through the binding's `down` hook. */
  const settleMs = 240;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  function endSettle(): void {
    clearTimeout(settleTimer);
    settleTimer = undefined;
    settling = false;
  }

  function armSettle(): void {
    clearTimeout(settleTimer);
    settling = true;
    /* Long enough to cover the token duration below; re-armed rather than
       stacked, so the flag belongs to the settle that is actually running. */
    settleTimer = setTimeout(() => {
      settling = false;
      settleTimer = undefined;
    }, settleMs);
  }

  /* Read at the moment it matters rather than stored: a reader can change
     this preference while the page is open, and the pull's own binding reads
     it the same way. */
  const reducedMotion = (): boolean =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Where the item that is arriving starts from, in pixels, or 0 when nothing
     is arriving. Set by the commit and spent by the settle that follows it in
     the same gesture — see lib/gesture.ts's entryOffset for the arithmetic and
     why it can never point backwards. */
  let entering = 0;

  const swipe = {
    span: () => stageEl?.getBoundingClientRect().width ?? 0,
    move: (offset: number) => (dragX = offset),
    /* A finger is down: whatever the last settle still had armed is over. The
       trade this accepts is deliberate and small — a grab landing mid-settle
       snaps the surface to its resting position first rather than easing the
       rest of the way — because the alternative is the drag itself easing,
       which is the lag the reader actually feels. */
    down: () => endSettle(),
    commit: (direction: -1 | 1) => {
      /* THE INCOMING ITEM ENTERS FROM ITS OWN SIDE (issue 265). Recorded
         BEFORE the index moves, because it is built from the offset the
         finger left behind; the settle below is what spends it. */
      entering = entryOffset(dragX, direction, swipe.span());
      if (direction === 1) {
        next();
      } else {
        previous();
      }
    },
    /* The transition is switched ON only for the settle, so the DRAG itself
       tracks the finger with no easing between it and the pixels — a
       transition during a drag is the lag that makes a carousel feel broken.
       It is switched off again after the settle so the next drag is direct.
       A reduced-motion reader gets no transition at all (the stylesheet
       decides that, not this file), and because the offset still lands on
       zero either way the surface is never left displaced.
       AFTER A TURN IT IS TWO WRITES, NOT ONE, and the order is the whole
       repair: the new item is placed at its entry offset with the transition
       OFF, that position is flushed to the engine, and only then does the
       transition arm and the offset go to zero. Both writes in one style
       recalc would animate from wherever the element already was — which is
       the backwards slide this fixes — so the forced box read below is
       load-bearing rather than defensive. */
    settle: async (): Promise<void> => {
      /* A reduced-motion reader is handed the destination and never the
         journey: no entry offset, so no two-step jump to flicker through. */
      if (entering !== 0 && !reducedMotion()) {
        endSettle();
        dragX = entering;
        await tick();
        stageEl?.getBoundingClientRect();
      }
      entering = 0;
      armSettle();
      dragX = 0;
    },
    /* The gallery WRAPS — the counter reads "1 / 8" and pressing previous at
       the first photograph goes to the last — so there is no end to resist
       at, and pretending otherwise would make the wrap feel like a fault.
       The drag is still bounded at one span by lib/gesture.ts, because a
       wrapping strip has no end to resist at and still has nothing to show
       past the item that is arriving. */
    atStart: () => false,
    atEnd: () => false
  };

  /* THE HANDOVER (issue 243), and the one place it happens. `playing` is not
     assigned anywhere else, and the element is never told to play anywhere
     else, so rule 2's absence claim above stays a property of the file rather
     than of a review — and it is swept for by name over everything below the
     opening comment, which is why that claim is worded there and not here.
     A rejected play() is left alone deliberately: the reader is by then
     looking at the real controls, which is strictly more than the veil gave
     them, and reverting would snatch those controls back at exactly the
     moment an interrupted play resolves — a reader who pressed play and then
     immediately pressed the native pause would have the surface pulled out
     from under them by their own second press. */
  function startFilm(): void {
    playingKey = item.key;
    void playerEl?.play().catch(() => {});
  }

  /* Ended, never paused — see rule 2 of the issue 243 block above. */
  function onFilmEnded(): void {
    playingKey = undefined;
  }

  /* Arrow keys on the frame itself, so the gesture's keyboard equivalent is
     on the same control rather than only inside the lightbox. */
  function onFrameKeydown(event: KeyboardEvent): void {
    if (isChord(event)) {
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      next();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      previous();
    }
  }

  /* THE POSITION DOTS' KEYBOARD, and why it is a radiogroup (issue 219 review
     round 2). What shipped was a `tablist` of `tab`s with a roving tabindex
     and no keydown handler at all — the exact shape this same PR fixed in the
     token panel's segmented pills, reintroduced eight files away. MEASURED:
     tabindex ["0","-1","-1","-1","-1","-1","-1","-1"], and ArrowRight,
     ArrowDown, End and Home on the one tabbable dot all left the counter at
     `1 / 8`, whose own click handler is `index = at` where `at === index` — a
     no-op. Seven of eight dots were unreachable by keyboard and the eighth
     did nothing. A roving tabindex is HALF a composite widget; the arrows are
     the other half, and shipping one without the other is worse than shipping
     neither, because it removes seven tab stops in exchange for nothing.

     The role changed with it. `tablist`/`tab` promises tab panels, and these
     dots control none — there is no `aria-controls`, no `tabpanel`, and no
     second region to swap. What they actually are is a single choice from a
     set, announced as such: a `radiogroup`, exactly the pattern the token
     panel's pills already use, so the two composite widgets on this page are
     one pattern rather than two. The movement itself is lib/keys.ts's ring,
     shared with those pills and with the reading-mode swatches. */
  let dotsEl: HTMLDivElement | undefined = $state();

  function onDotsKeydown(event: KeyboardEvent): void {
    if (isChord(event)) {
      return;
    }
    const target = ringTarget(event.key, index, total);
    if (target === null) {
      return;
    }
    /* The arrows belong to the group once focus is inside it, so the page
       must not scroll underneath the reader as well. */
    event.preventDefault();
    goTo(target);
    /* Focus follows selection: in a radio group the checked control IS the
       tab stop, so leaving focus behind would strand it on a dot that just
       became untabbable. */
    dotsEl?.querySelectorAll<HTMLElement>('[role="radio"]')[target]?.focus();
  }

  /* THE ROW IS ONE ROW, AND IT SCROLLS (issue 241). Nine 44px targets are
     396px of controls, so the row wrapped to two lines at every phone width
     this site supports and to three at 250px — MEASURED — which turned a
     position affordance into a block of chrome taller than some of the art it
     indexes. Wrapping was the wrong axis to give: the floor that may not move
     is the 44px target, the row is WIDE CONTENT, and this page's own rule for
     wide content is that it scrolls inside its own container rather than
     taking the page sideways with it (AGENTS.md, rendering lanes stage 1).

     The scroller owes the reader one thing in return, and this is it: the
     current dot is always brought into view, so "which one am I on" is never
     a question answered off-screen. Written against the two boxes the engine
     reports rather than offsetLeft — offsetLeft is measured from the nearest
     positioned ancestor, which is not promised to be this row — and it moves
     the ROW's own scrollLeft, never scrollIntoView, because scrollIntoView
     walks every scrollable ancestor and would take the page with it. */
  $effect(() => {
    const row = dotsEl;
    if (row === undefined) {
      return;
    }
    const dot = row.querySelectorAll<HTMLElement>('[role="radio"]')[index];
    if (dot === undefined) {
      return;
    }
    const dotBox = dot.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    row.scrollLeft += dotBox.left - rowBox.left - (row.clientWidth - dotBox.width) / 2;
  });

  let dialogEl: HTMLDialogElement | undefined = $state();

  /* The control that opens the lightbox, kept so closing can put focus back
     on it. A native <dialog> does restore focus to whatever was focused
     before showModal(), but a mouse click does not focus a <button> on
     macOS WebKit at all — so on the engine every iOS browser runs, the
     "previously focused element" is the document body and a reader who
     closes the lightbox lands nowhere. Restoring explicitly is the same
     element in every engine. */
  let frameButtonEl: HTMLButtonElement | undefined = $state();

  /* The film's player, and the OTHER thing focus can be returned to. Exactly
     one of these two exists at a time — a still's stage holds the enlarge
     button, a film's stage holds the player — which is the same fact the
     markup below is built from, stated once here so the focus restore does
     not have to ask which kind of item it is looking at. */
  let playerEl: HTMLVideoElement | undefined = $state();

  /* A film's own control (issue 243), and the focus target that should be
     preferred over the player while the veil is up: it is the thing a reader
     on a film can actually press, and landing focus on a player whose
     controls are not rendered yet would be landing it nowhere. */
  let playButtonEl: HTMLButtonElement | undefined = $state();

  /* THE LIGHTBOX IS FOR STILLS, enforced rather than promised. A film has no
     enlarge button, so `enlarged` cannot be set from a film's stage at all;
     the route that survives is the dialog's own arrow keys, which move the
     index while the dialog is open and can land on a film. Written as an
     invariant on the state rather than as a branch inside that handler,
     because the question "is the enlarged surface showing an item it can
     honestly enlarge?" belongs to the state and not to one of the ways of
     reaching it. It sits ABOVE the sync effect so a single flush closes the
     dialog rather than opening it onto a film first. */
  $effect(() => {
    if (enlarged && item.video !== undefined) {
      enlarged = false;
    }
  });

  /* THE PAGE STAYS WHERE THE READER LEFT IT (issue 241). A modal <dialog>
     makes the document inert to POINTER interaction, and nothing else: a
     wheel, a two-finger drag, PageDown and the space bar all still scroll the
     page underneath the scrim. MEASURED on 0.1.54 with the lightbox open —
     +485px on an iPhone 13 viewport, +1400px at 1280x720 — after which
     closing returned the reader to a place they never chose, which is the
     same complaint issue 233 answered for the OPEN half and this is the other
     half of.

     The lock is one attribute on the document element, read by one rule in
     styles.css (`overflow: hidden`). It is written by an effect rather than by
     the open/close handlers so it cannot be left behind: an effect's teardown
     runs when `enlarged` goes false AND when this component unmounts with the
     dialog still open, which no pair of handlers can promise.

     The giveback beside it is the zero-CLS half. Removing the document's
     overflow removes its scrollbar, so on a classic-scrollbar platform the
     reading column would widen by the scrollbar's thickness as the lightbox
     opened and snap back on close. That thickness is a platform fact no
     stylesheet can name — 0 wherever scrollbars overlay — so it is measured
     HERE, before the attribute goes up and while the scrollbar is still
     taking its space, and handed to the rule as root padding. */
  $effect(() => {
    if (!enlarged) {
      return;
    }
    const root = document.documentElement;
    const giveback = window.innerWidth - root.clientWidth;
    if (giveback > 0) {
      root.style.setProperty('--modal-scrollbar-giveback', `${giveback}px`);
    }
    root.setAttribute('data-modal-open', 'true');
    return () => {
      root.removeAttribute('data-modal-open');
      root.style.removeProperty('--modal-scrollbar-giveback');
    };
  });

  // showModal()/close() are imperative; this is the one place the dialog's
  // own open state is kept in step with `enlarged`.
  $effect(() => {
    if (dialogEl === undefined) return;
    if (enlarged && !dialogEl.open) dialogEl.showModal();
    else if (!enlarged && dialogEl.open) dialogEl.close();
  });

  /* The dialog's native 'close' event covers Escape, the close button and a
     backdrop click alike, so this is the single place `enlarged` resets.

     The focus restore waits for tick() because the element it restores to may
     not exist yet: a lightbox closed by arrowing onto a film is closing
     precisely BECAUSE the stage is about to swap its button for a player, and
     focusing the button on its way out would land the reader on the body. */
  async function onDialogClose(): Promise<void> {
    enlarged = false;
    await tick();
    (frameButtonEl ?? playButtonEl ?? playerEl)?.focus();
  }

  function onDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight') next();
    else if (event.key === 'ArrowLeft') previous();
  }

  // A click landing on the <dialog> element itself (never on its content)
  // is a backdrop click.
  function onBackdropClick(event: MouseEvent): void {
    if (event.target === dialogEl) dialogEl?.close();
  }
</script>

{#if total > 0}
  <!-- flat, not media (owner directive, 2026-08-28): the art carries its own
    white ground, so a card box around it read as an ugly outline. The stage
    below centers the work; the page's column is the only frame. -->
  <FeedCard variant="flat">
    {#snippet media()}
      <div class="gallery-frame">
        {#if item.video}
          <!-- A FILM'S STAGE. The SAME box arithmetic and the SAME tokens as
            the still's (issue 243): data-gallery-kind now selects the ground a
            film is letterboxed against and nothing about its size. The
            element is keyed on the item so moving between two films remounts
            it; a reused <video> keeps the resource it already selected. -->
          <div
            class="gallery-stage"
            data-gallery-kind="video"
            bind:this={stageEl}
            data-gallery-settling={settling ? 'true' : undefined}
            style:--gallery-drag={`${dragX}px`}
          >
            {#key item.key}
              <!-- CONTROLS ARE HANDED OVER, NOT DECLARED (issue 243). Before
                the reader presses play there is no control bar to contest, so
                the veil's swipe cannot turn a scrub into a page turn; after
                it, the native controls are the surface. Nothing here ever
                starts itself — see startFilm() and rule 2 of the MOVING ITEMS
                block above, whose absence pin sweeps this markup for the
                attribute by name and would fail on this comment mentioning
                it. -->
              <!-- svelte-ignore a11y_media_has_caption -->
              <video
                class="gallery-player"
                controls={playing}
                playsinline
                preload="metadata"
                poster={item.video.posterSrc}
                aria-label={item.alt}
                width={itemWidth}
                height={itemHeight}
                onended={onFilmEnded}
                bind:this={playerEl}
              >
                {#each item.video.sources as source (source.src)}
                  <source src={source.src} type={source.type} media={source.media} />
                {/each}
              </video>
            {/key}
            {#if !playing}
              <!-- THE VEIL: the swipe surface a film has until the reader asks
                for the player instead. It carries the identical binding the
                still's stage carries, and it exists for exactly as long as the
                swipe should — so nothing in lib/gesture.ts has to know what a
                video is. The play control is its only child, which is the
                whole of the owner's "the sensitive area should only be the
                button and not the entire video": a press anywhere else on the
                film is a press on a swipe surface that does nothing, and a
                drag anywhere on it turns the strip. -->
              <div class="gallery-film-veil" use:swipeHorizontal={swipe}>
                <button
                  type="button"
                  class="gallery-play"
                  bind:this={playButtonEl}
                  onkeydown={onFrameKeydown}
                  onclick={startFilm}
                  aria-label={`Play ${item.alt}`}
                >
                  <!-- Named apart from the decorative mark issue 233 deleted,
                    and deliberately: that one was DECORATION drawn on a
                    poster, promising a press that happened somewhere else, and
                    the pin on its absence still holds by its own name. This is
                    the press. -->
                  <span class="gallery-play-disc">
                    <svg class="gallery-glyph" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                      <path d="M9 6.5l9 5.5-9 5.5z" fill="currentColor" />
                    </svg>
                  </span>
                </button>
              </div>
            {/if}
          </div>
        {:else}
          <!-- The gesture surface is the STAGE, not the button inside it: the
            drag has to be available across the whole photograph, and the button
            is the thing the drag must not accidentally press (lib/gesture.ts
            suppresses exactly one click after a real drag). aria-hidden is
            wrong here and deliberately absent — the stage carries no semantics
            of its own, and everything a reader needs is already on the button,
            the arrows and the dots. -->
          <div
            class="gallery-stage"
            data-gallery-kind="image"
            bind:this={stageEl}
            use:swipeHorizontal={swipe}
            data-gallery-settling={settling ? 'true' : undefined}
            style:--gallery-drag={`${dragX}px`}
          >
            <button
              type="button"
              class="gallery-image-button"
              bind:this={frameButtonEl}
              onkeydown={onFrameKeydown}
              onclick={() => (enlarged = true)}
            >
              <img
                class="gallery-image"
                src={item.previewSrc}
                alt={item.alt}
                width={itemWidth}
                height={itemHeight}
                loading="lazy"
                decoding="async"
              />
            </button>
          </div>
        {/if}
        {#if total > 1}
          <!-- THE DESKTOP PAIR (owner, 2026-08-29): real prev/next controls on
            the work itself, for the reader whose device has no working drag.
            Hidden by default and shown only where hover and a fine pointer are
            both reported — the same capability split lib/tooltip.ts draws — so
            a phone keeps swipe and dots. They sit at the STAGE's own edges,
            not the frame's: the offset is the same one expression the stage's
            width is built from, so the pair cannot drift away from the work
            the way the pre-241 arrows drifted 212px from it. Rendered after
            both stages so they paint above whichever surface the item mounts —
            including a playing film's, because navigating away from one must
            never require the lightbox or the player's own chrome. Both go
            through previous()/next(), so a press pages away from a playing
            film AND hands its surface back (goTo clears the key). -->
          <button
            type="button"
            class="gallery-nav"
            data-gallery-nav="previous"
            onclick={previous}
            onkeydown={onFrameKeydown}
            aria-label={`Previous ${itemNoun(items[previousIndex])}`}
          >
            <span class="gallery-nav-disc">
              <svg class="gallery-glyph" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  d="M14.5 6l-6 6 6 6"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
          </button>
          <button
            type="button"
            class="gallery-nav"
            data-gallery-nav="next"
            onclick={next}
            onkeydown={onFrameKeydown}
            aria-label={`Next ${itemNoun(items[nextIndex])}`}
          >
            <span class="gallery-nav-disc">
              <svg class="gallery-glyph" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  d="M9.5 6l6 6-6 6"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
          </button>
        {/if}
      </div>
    {/snippet}
  </FeedCard>
  <!-- The position affordance the swipe owes (issue 219). A counter alone
    tells a reader WHERE they are; it does not tell them the surface can be
    moved, and it cannot be pressed. The dots say both — how many, which one,
    and that the set is navigable — and each is a real button, so the gesture's
    keyboard-and-tap equivalent is the same control that shows the position
    rather than a second one somewhere else. The dots are the ONLY visible
    position mark (owner directive, 2026-08-28: "I only like the dots") —
    the counter below is clipped out of view but kept in the tree, because
    it is the live region: a number is what assistive technology can
    usefully announce on a change, and nine identical dots are not.
    "Reachable by keyboard" is a claim with a shape: one tab stop for the
    group, the arrows moving inside it, Home and End at the ends, and focus
    following the choice — see onDotsKeydown. A roving tabindex without that
    is not a keyboard affordance, it is seven controls taken away. -->
  <div class="gallery-position">
    <p class="gallery-count" aria-live="polite">{positionLabel(index)}</p>
    <!-- THE ROW IS THE DOTS' ALONE (owner, 2026-08-29). Issue 241 put two
      chevrons here, beside the dots, after they left the frame — and shrunk
      to 12px by the 2026-08-28 directive they stopped reading as buttons at
      all, which is the "bring back the buttons" report in the header. The
      pair is back on the stage as .gallery-nav, desktop-only by capability;
      what this row keeps is the position affordance the swipe owes (issue
      219) — the dots, each a real button, the gesture's tap-and-keyboard
      equivalent on every device — inside the same scrolling container issue
      241 built, so nine 44px targets still never wrap or take the page
      sideways. -->
    <div class="gallery-controls">
      {#if total > 1}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          class="gallery-dots"
          role="radiogroup"
          tabindex="-1"
          aria-label={chooseLabel}
          bind:this={dotsEl}
          onkeydown={onDotsKeydown}
        >
          {#each items as dot, at (dot.previewSrc)}
            <button
              type="button"
              class="gallery-dot"
              role="radio"
              aria-checked={at === index}
              tabindex={at === index ? 0 : -1}
              aria-label={positionLabel(at)}
              onclick={() => goTo(at)}
            ><span class="gallery-dot-mark" aria-hidden="true"></span></button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <!-- THE CAPTION LANE, RESERVED FOR EVERY ITEM (issue 265, owner ruling:
    "the frame must NOT move to accommodate the item — it must already reserve
    the box that holds every kind"). Every item's caption is rendered into the
    SAME grid cell and all but the current one is `visibility: hidden`, so the
    lane's height is the tallest caption THIS SET can render and the current
    item cannot change it. Nothing is fabricated and nothing is defaulted: an
    item with no title renders no title, exactly as before — what changed is
    that its lane is still there, empty, holding the box open.
    The engine sizes the lane rather than a number this file computes, which
    is the reason for the stack: a caption's height is a function of the LIVE
    width (a description wraps differently at 320px and at 1440px), so any
    length written down here would be right at one viewport and wrong at the
    next. Nothing is recomputed on an item change, because nothing about the
    lane depends on which item is showing. -->
  <div class="gallery-caption">
    {#each items as shot, at (shot.key)}
      <div
        class="gallery-caption-lane"
        data-current={at === index ? 'true' : undefined}
        aria-hidden={at === index ? undefined : 'true'}
      >
        {#if shot.title}<p class="gallery-caption-title">{shot.title}</p>{/if}
        {#if shot.description}<p class="gallery-caption-text">{shot.description}</p>{/if}
      </div>
    {/each}
  </div>

  <dialog
    bind:this={dialogEl}
    class="gallery-lightbox"
    aria-label={item.alt}
    onclose={onDialogClose}
    onkeydown={onDialogKeydown}
    onclick={onBackdropClick}
  >
    <button
      type="button"
      class="icon-button gallery-lightbox-close"
      onclick={() => dialogEl?.close()}
      aria-label="Close enlarged photograph"
    >
      <span class="gallery-close-mark">
        <svg class="gallery-glyph" viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        </svg>
      </span>
    </button>
    {#if enlarged}
      <div class="gallery-lightbox-border">
        <!-- STILLS ONLY (issue 233). The branch that mounted a <video> here
             is gone rather than left unreachable: a film plays in the strip,
             so there is nothing an enlarged copy of it would add, and the one
             route that could still have arrived here — arrowing the open
             dialog onto a film — closes the dialog instead (see the invariant
             effect above).
             The full derivative can be megabytes; until it decodes, the small
             preview — already in cache, it IS the strip's visible frame —
             paints as this element's background so the enlargement opens onto
             the picture instead of a grey void (owner defect report, 0.1.52).
             The decoded full image then covers it.

             WHICH DERIVATIVE, AND WHY IT IS A <picture> (issue 241). The
             enlarged element used to load the master unconditionally: MEASURED
             on the volume's own work, a 3840px 1.8 MiB still decoded into a
             351px box on an iPhone 13 viewport, 5.2 megabytes of pixels for
             one a reader can see. The rung that fits is already published —
             every admitted item carries a preview — so the only missing thing
             was permission to use it.

             A MEDIA query rather than srcset/sizes, and the difference is the
             whole point. `sizes` is multiplied by the device pixel ratio, so
             on the 3x phones this defect was reported from the enlarged box
             asks for ~1100px and would take the 3840px master anyway — the exact
             behaviour being fixed, wearing a responsive-images costume. A
             media query is a statement about the VIEWPORT, and the breakpoint
             is the preview's own declared width: at or below it the preview
             covers the box at better than 2x on a phone, above it the preview
             would be upscaled and the master is the honest answer. An item
             whose source declares no preview width (the vendored bootstrap
             set) renders exactly the img below and nothing else, because a
             breakpoint guessed from a file nobody measured is how a reader
             gets a blurry enlargement. -->
        <picture>
          {#if item.previewWidth !== undefined}
            <source media={`(max-width: ${item.previewWidth}px)`} srcset={item.previewSrc} />
          {/if}
          <img
            class="gallery-lightbox-image"
            src={item.fullSrc}
            alt={item.alt}
            style={`background-image: url("${item.previewSrc}")`}
          />
        </picture>
      </div>
      {#if hasMeta}
        <div class="gallery-lightbox-meta">
          {#if item.title}<p class="gallery-meta-title">{item.title}</p>{/if}
          {#if item.description}<p class="gallery-meta-text">{item.description}</p>{/if}
          {#if item.link}
            <a
              class="gallery-meta-link"
              href={item.link.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${item.link.label} (opens in a new tab)`}>{item.link.label}</a
            >
          {/if}
        </div>
      {/if}
    {/if}
  </dialog>
{/if}

<style>
  /* THE RESERVATION, AND IT IS NOW THE FRAME'S (issue 241). Both stages used
     to reserve their own box, and the two boxes are different SHAPES — a
     square for a still, 16:9 for a film — so moving between the two kinds
     resized the document under the reader: MEASURED at 390px, -105.9px going
     still to film and +105.9px coming back, which is a zero-CLS floor broken
     by an ordinary press of the next arrow.

     The fix is that the box a kind can change is no longer the box the page
     is laid out from. This element reserves the TALLER of the two — the
     square, built from the same --gallery-stage-size token the still's own
     stage is, so the two cannot disagree — and each stage is centred inside
     it. A still fills it exactly (same token, same aspect). A film is the
     shorter box it always was, now with page ground above and below it rather
     than a document that shrank. The reservation is byte-independent exactly
     as the stage's own was, and item-independent as well, which is the part
     that makes a kind change cost nothing. */
  .gallery-frame {
    display: grid;
    place-items: center;
    inline-size: 100%;
    aspect-ratio: 1;
    max-block-size: var(--gallery-stage-size, 28rem);
    /* The containing block for the desktop pair below (owner, 2026-08-29),
       and the ONE expression of the stage's inline size. It is a custom
       property here rather than a length in .gallery-stage because two
       elements now need the identical number — the stage to BE that wide,
       and each nav button to sit at the edge of that width — and two copies
       of the expression is how the pair would drift off the work the way the
       pre-241 arrows did. `100%` resolves against this element for every
       consumer, since stage and buttons are all its children. */
    position: relative;
    --gallery-stage-inline: min(100%, calc(var(--gallery-stage-size, 28rem) * var(--gallery-stage-aspect, 1)));
  }

  .gallery-glyph {
    color: inherit;
  }

  /* THE DESKTOP PAIR (owner, 2026-08-29): hidden by DEFAULT — that is the
     owner's "hide them by default in mobile" made structural, since a device
     that matches no media query gets no buttons and loses nothing it had —
     and shown only where hover and a fine pointer are both reported, the
     same split lib/tooltip.ts's finePointerQuery draws. On such a device the
     strip's drag does not exist (the native image drag takes a mouse's
     before it can prove itself horizontal — MEASURED, see the header), so
     this pair is the primary navigation there, not decoration: vertically
     centred on the stage, at its edges, above whichever surface the item
     mounts, playing film included. */
  .gallery-nav {
    display: none;
  }

  @media (hover: hover) and (pointer: fine) {
    .gallery-nav {
      display: grid;
      place-items: center;
      position: absolute;
      inset-block-start: 50%;
      transform: translateY(-50%);
      /* The stage and the frame share a vertical centre — the stage is the
         centred grid item — so half the frame is half the stage, and the
         pair rides the work, not the track. */
      min-inline-size: 2.75rem;
      min-block-size: 2.75rem;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: pointer;
      color: var(--gallery-nav-ink, white);
    }

    /* At the STAGE's edge, not the frame's: the frame's surplus is split
       evenly by the auto margins that centre the stage, so half of
       (100% − stage) IS the stage's start edge, from the same expression
       the stage is sized by. The inset token nudges the disc inward so it
       overlaps the work the way every inline-player control does. */
    .gallery-nav[data-gallery-nav='previous'] {
      inset-inline-start: calc((100% - var(--gallery-stage-inline)) / 2 + var(--gallery-nav-inset, 0.375rem));
    }

    .gallery-nav[data-gallery-nav='next'] {
      inset-inline-end: calc((100% - var(--gallery-stage-inline)) / 2 + var(--gallery-nav-inset, 0.375rem));
    }
  }

  /* The painted disc inside the 44px target — the same trade the play
     control makes, in the same token grammar, and for the same reason it is
     not branched by reading mode: it sits on the artwork's own ground in
     every mode. Translucent at rest so it never becomes the picture; full
     strength under the pointer or keyboard focus. */
  .gallery-nav-disc {
    display: grid;
    place-items: center;
    inline-size: var(--gallery-nav-size, 2.25rem);
    block-size: var(--gallery-nav-size, 2.25rem);
    border-radius: 999px;
    background: var(--gallery-nav-surface, rgba(0, 0, 0, 0.55));
    opacity: var(--gallery-nav-rest-opacity, 0.7);
  }

  .gallery-nav:hover .gallery-nav-disc,
  .gallery-nav:focus-visible .gallery-nav-disc {
    opacity: 1;
  }

  .gallery-nav:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -4px;
    border-radius: 999px;
  }

  /* Issue 202, the owner's "large dead gap on the right". The frame is
     narrower than its 1fr track on any wide column, because the block cap
     below transfers through aspect-ratio into an inline cap; `justify-self:
     normal` behaves as START (not stretch) for a box with an aspect ratio,
     so the whole surplus used to land on one side — MEASURED at 1280px: a
     568.9px frame at the left of an 842px track.

     The stage is what fixes it, and it is a wrapper rather than an alignment
     property on the button for a reason MEASURED on all three engines: an
     aligned (non-stretched) grid item is sized by its CONTENT, and the
     content here is a lazy image, so `justify-self: center` alone reserved
     nothing until the byte landed — 0x0 on Gecko, 194.6x109.4 on Blink,
     163x91.7 on WebKit with the image blocked. Giving the stage a DEFINITE
     width instead keeps the reservation byte-independent and centres it with
     auto margins, and the width is built from the same two tokens the
     reserved box itself is built from, so the two cannot disagree. */
  .gallery-stage {
    position: relative;
    /* NEAR-SQUARE, not the feed's 16:9 (owner directive, 2026-08-28): the
       drawings are portrait scans, and a wide stage either cropped them
       (the old cover fit cut the signature off) or drowned them in dead
       side space. A square-ish stage sized by its own token holds portrait
       and landscape work alike; the reservation stays byte-independent
       exactly as before. The expression itself moved up to the frame
       (2026-08-29) because the desktop pair positions against the same
       number — one source, two consumers, no drift. */
    inline-size: var(--gallery-stage-inline, 100%);
    margin-inline: auto;
    /* The reserved box, and the reason nothing on this page moves when the
       photograph lands: the ratio and ceiling are the gallery's own two
       stage tokens, declared in styles.css with every other dimension. It
       sits on the STAGE and not on the button because a <button> is a form
       control — its `auto` inline size is fit-content in every engine, so a
       button carrying the ratio is sized by whatever has loaded inside it,
       which is the opposite of a reservation. The stage's width is definite;
       the button stretches into it as an ordinary grid item. */
    aspect-ratio: var(--gallery-stage-aspect, 1);
    max-block-size: var(--gallery-stage-size, 28rem);
    overflow: hidden;
  }

  /* THE SECOND SHAPE IS GONE (issue 243). This block used to redeclare the
     two stage tokens for a film — a wider, larger box than a drawing's — and
     the owner's ruling retired it: "make it one single block that doesn't
     expand, reduce based on the media". What is left here is the GROUND,
     which is about paint and not about size, so a film now takes the identical
     box a still does and letterboxes inside it against this colour. There is
     no expression anywhere in this component or in styles.css that gives a
     film a different box, which is what makes the owner's sentence structural
     rather than a value somebody could nudge back. */
  .gallery-stage[data-gallery-kind='video'] {
    /* The reserved box is a VISIBLE box (issue 239). Without this the
       stage was transparent, so a player whose poster had not landed showed
       the page's near-white ground through the reservation and read as a
       broken rectangle rather than as a film that has not arrived. The value
       is the global token like every other dimension here, so the ground is
       tuned in styles.css and nowhere else. Nothing about the reservation
       moves: this paints the box the three declarations above already
       measured, so CLS stays zero. (Prose here is read by the strip pins in
       tests/sections.test.mjs, which strip HTML comments and not CSS ones —
       naming the element in angle brackets would count as a second one.) */
    background: var(--gallery-stage-ground);
  }

  /* The player fills the reserved stage the same way the enlarge button
     does — absolutely, by insets plus an explicit 100% on both axes, because
     a replaced element with `inset: 0` and auto sizing keeps its INTRINSIC
     box rather than stretching. `contain` is what now carries the owner's
     "reduce based on the media" (issue 243): the element is the whole block,
     and the film reduces inside it against the ground above rather than the
     block growing to the film's shape. It applies to the poster as well as to
     the decoded frames, so the letterbox is the same before and after a
     single byte of film arrives. */
  .gallery-player {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
    object-fit: contain;
  }

  /* THE VEIL (issue 243): the film's swipe surface before the reader hands the
     stage to the player. It covers the block exactly, so a drag anywhere on
     the film turns the strip, and it holds the ONE control that is sensitive
     to a press. It paints nothing — the poster underneath is the picture —
     which is why it needs no ground and no border of its own.
     `place-items: center` puts the control in the middle of the block rather
     than over any particular part of the film, and the control is the only
     thing in here: an empty veil would be a swipe surface with no visible
     affordance, and a veil with chrome would be a box drawn over the art. */
  .gallery-film-veil {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    /* STATED HERE TOO, though the engine would reach the same answer without
       it: touch-action is not inherited, but the effective value for a touch
       is the INTERSECTION of the hit element's and its ancestors', so the
       stage's pan-y already constrains a touch that lands here. It is
       declared anyway because this is the element the gesture is BOUND to,
       and the rule the whole layer rests on should be readable beside the
       binding rather than one element up. Same base-then-upgrade shape as the
       stage's: an unsupported touch-action value drops the whole declaration,
       so the plain value goes first. */
    touch-action: pan-y;
    touch-action: pan-y pinch-zoom;
  }

  /* The press itself, at the touch floor on both axes (rendering lanes stage
     1) with a small painted disc inside it — the same trade every other
     control in this component makes: the hit box is about a finger, the ink
     is about the artwork it sits on. */
  .gallery-play {
    display: grid;
    place-items: center;
    min-inline-size: 2.75rem;
    min-block-size: 2.75rem;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    color: var(--gallery-play-button-ink, white);
  }

  .gallery-play-disc {
    display: grid;
    place-items: center;
    inline-size: var(--gallery-play-button-size, 3rem);
    block-size: var(--gallery-play-button-size, 3rem);
    border-radius: 999px;
    background: var(--gallery-play-button-surface, rgba(0, 0, 0, 0.55));
    opacity: var(--gallery-play-button-rest-opacity, 0.9);
    /* The triangle is optically centred rather than geometrically: a
       right-pointing glyph in a circle reads left-heavy at its true centre. */
    padding-inline-start: var(--gallery-play-button-nudge, 0.1875rem);
  }

  .gallery-play:hover .gallery-play-disc,
  .gallery-play:focus-visible .gallery-play-disc {
    opacity: 1;
  }

  .gallery-play:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -4px;
    border-radius: 999px;
  }

  /* Filling the stage by INSETS, not by a size: a size on a control is a
     number the touch-floor sweep must be able to read, and "100%" is not one.
     The insets say the same thing without stating a length at all, and they
     mean the button is exactly the reserved box in every engine (WebKit
     stretched a grid item here to a square, MEASURED, so grid stretch was
     not enough). */
  .gallery-image-button {
    /* Absolute, filling the stage. The history is worth keeping because the
       trap is easy to walk back into: issue 207 wanted a containing block
       here for the play mark it drew inside the frame and added `position:
       relative`; composing that with issue 202's centred stage left the
       property declared TWICE with `relative` last, which took the button out
       of its absolute fill and let a <button>'s fit-content sizing decide the
       frame's width again — measured off centre by 569px in Firefox and
       WebKit at 1440px, the exact dead gutter issue 202 removed. The mark
       itself is gone (issue 233); one declaration remains, and it is
       `absolute`. */
    position: absolute;
    inset: 0;
    display: grid;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
  }

  .gallery-image {
    inline-size: 100%;
    block-size: 100%;
    /* contain, never the feed's cover: the work renders WHOLE, centered in
       the stage, whatever its aspect — a cropped drawing is a different
       drawing (owner, 2026-08-28: "the art is cut off significantly"). */
    object-fit: contain;
  }

  .gallery-position {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.125rem;
  }

  /* Visually clipped, never removed: this is the dots' aria-live voice.
     Clipping (not display:none) keeps it announceable; 1px, not 0, because
     some engines skip announcing zero-sized live regions. */
  .gallery-count {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    margin: 0;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* The control row, now the dots' scrolling container alone (owner,
     2026-08-29): still a full-width centred flex row, because the dot row's
     own shrink arithmetic below is written against exactly this shape. The
     gap token left with the arrows it separated. */
  .gallery-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    inline-size: 100%;
  }

  /* ONE ROW, SCROLLED RATHER THAN WRAPPED (issue 241). nine 44px targets are
     396px wide, so `flex-wrap: wrap` put them on two rows at every phone
     width and three at 250px — MEASURED — which is a bigger object than the
     caption it sits under. Nothing about the target moves: the floor is
     44x44 and the dots below still declare it. What changes is the axis the
     surplus goes to, which is this page's standing answer for wide content —
     it scrolls inside its own container and never takes the document
     sideways with it.

     `safe center` is stated over a plain `center` base: a centred flex line
     that overflows is unreachable at its START edge, and `safe` degrades that
     to flex-start. An engine without it keeps the base, which is exactly
     today's centring — the same base-then-upgrade shape every progressive
     value on this page is written in.

     The scrollbar is hidden because the dots ARE the affordance — nine marks,
     one of them lit, kept in view by the effect above — and a 15px classic
     scrollbar under a 4px dot is chrome about chrome. */
  .gallery-dots {
    display: flex;
    flex-wrap: nowrap;
    justify-content: center;
    justify-content: safe center;
    /* THE THREE DECLARATIONS THAT MAKE IT SHRINKABLE, and none of them is
       ceremony — MEASURED across all three engines while fixing this. A
       scroll container's min-content size is still its CONTENT's, so a row
       of nine 44px marks contributed 352px of minimum width all the way up
       to the page column, which then overflowed the viewport by 144px at
       320px. `min-inline-size: 0` does not touch that (it changes the
       automatic minimum, not the contribution) and neither does a zero
       flex-basis (engines read the WIDTH property for the contribution); a
       definite zero inline size does, in every engine.
       It is then grown back: flex-grow takes the row's whole space now that
       the chevrons have left it (2026-08-29), and the max-content ceiling
       stops it there — so a row that fits is exactly as wide as its marks,
       while a row that does not fit takes what there is and scrolls the
       rest. */
    inline-size: 0;
    flex-grow: 1;
    max-inline-size: max-content;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x proximity;
    scrollbar-width: none;
  }

  .gallery-dots::-webkit-scrollbar {
    display: none;
  }

  /* A 44px hit box around a small painted mark, exactly as the lightbox's
     close control is built (issue 202): the touch floor is about what a
     finger can hit, never about how big the ink is, and a row of 44px discs
     would be a bigger object than the photograph's own caption. The mark is
     drawn by the child span so the button can be transparent chrome. */
  .gallery-dot {
    display: grid;
    place-items: center;
    /* 44px on BOTH axes, not just the block one. The inline floor is not
       belt-and-braces here and the token panel learned it the hard way
       (UsageTracker.svelte): a floor that depends on how wide the content
       happens to be is not a floor, and a dot's content is 6px. The row
       wraps, so eight of them still fit a 320px viewport without taking the
       page's scrollbar sideways. */
    min-inline-size: 2.75rem;
    min-block-size: 2.75rem;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    /* In a scrolling row a dot must not be squeezed under its own floor by
       flex, and it is the snap point the row settles on. */
    flex: 0 0 auto;
    scroll-snap-align: center;
  }

  /* The painted mark, at its own token (owner directive, 2026-08-28: the
     current-media indicator should be smaller too). The 44px button above is
     untouched — a smaller mark is a smaller MARK, never a smaller target. */
  .gallery-dot-mark {
    inline-size: var(--gallery-dot-size, 0.25rem);
    block-size: var(--gallery-dot-size, 0.25rem);
    border-radius: 999px;
    background: var(--card-meta-ink);
    opacity: 0.35;
  }

  /* Position is never carried by the fill alone: the current dot is both
     brighter AND larger, so the state survives a reading mode that flattens
     contrast and a reader who cannot separate the two tones. The scale is a
     token beside the size, because shrinking one without the other is how the
     marked state quietly stops being distinguishable. */
  .gallery-dot[aria-checked='true'] .gallery-dot-mark {
    opacity: 1;
    transform: scale(var(--gallery-dot-active-scale, 1.5));
  }

  .gallery-dot:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -6px;
    border-radius: 999px;
  }

  /* THE DRAG SURFACE. `pan-y` is the load-bearing declaration on this whole
     feature: it hands the vertical axis to the compositor unconditionally, so
     a reader scrolling the page through the photograph scrolls the page — the
     gesture layer never even sees that gesture. Only the horizontal axis is
     ours to claim, and lib/gesture.ts still refuses to claim it until a drag
     has proven itself horizontal.

     `pinch-zoom` joins it (issue 241): `pan-y` alone hands the compositor the
     vertical axis and REFUSES everything else, including a two-finger zoom —
     so a reader who put both fingers on the artwork to look closer at it was
     told no by the one element they would ever try that on. The base
     declaration is stated first for an engine that does not know the value:
     an unsupported touch-action value drops the whole declaration, which
     would hand the horizontal axis back to the browser and leave the swipe
     fighting a scroll that has nothing to scroll. */
  .gallery-stage {
    touch-action: pan-y;
    touch-action: pan-y pinch-zoom;
  }

  /* The drag itself: a plain translate, so it is composited rather than
     re-laid-out, and it changes no box — the reserved frame is exactly where
     it was, which is what keeps a drag from costing layout stability. The
     fallback is the un-transformed frame, which is the correct degradation:
     no movement rather than a broken one.
     A film moves its PLAYER and its veil by the same offset (issue 243), so
     the picture and the control the reader's finger is on travel together
     rather than the poster sliding out from under the press. */
  .gallery-stage :global(.gallery-image-button),
  .gallery-stage .gallery-player,
  .gallery-stage .gallery-film-veil {
    transform: translateX(var(--gallery-drag, 0px));
  }

  /* THE SNAP-BACK, and it is only ever on for the settle. A transition during
     the drag would put easing between the finger and the pixels; a settle
     with no transition would teleport. The attribute is written by the
     component for the length of the settle alone.

     Stated inside `no-preference` rather than cancelled inside `reduce`, per
     this page's rule: a cancelling block is reachable only by a browser that
     HAS the media feature, so it leaves the animation running everywhere the
     feature is unknown, while stating it here never starts it there. Nothing
     is lost for a reader who gets no transition — the offset lands on zero
     either way, so the surface is never left displaced; only the journey to
     zero is skipped. */
  @media (prefers-reduced-motion: no-preference) {
    .gallery-stage[data-gallery-settling='true'] :global(.gallery-image-button),
    .gallery-stage[data-gallery-settling='true'] .gallery-player,
    .gallery-stage[data-gallery-settling='true'] .gallery-film-veil {
      transition: transform var(--gallery-settle-duration, 200ms) cubic-bezier(0.22, 1, 0.36, 1);
    }
  }

  /* VIEWPORT-ANCHORED, and this one declaration is the whole of the owner's
     "when I close the media, it returns me to the top of the page" (0.1.52).

     A modal <dialog> is placed by the UA as `position: fixed`, centred by
     `inset: 0` and `margin: auto`. This rule used to say `position: relative`,
     and an author declaration beats the UA sheet on cascade ORIGIN whatever
     the specificity, so the UA's `position: fixed` never applied. What the
     engines computed instead was `absolute` (MEASURED, both), which put the
     box in the DOCUMENT's coordinate space at the top of the page rather than
     against the viewport. showModal() then moves focus to the first control
     inside the dialog (the close mark below), the engine scrolls that control
     into view, and the reader's place is gone before the lightbox has even
     painted.

     MEASURED at a 1280x720 viewport, all three close paths, against the live
     0.1.52 origin and the binary built from that tree alike: scrollY 1943
     before the click and 0 while the dialog was open, on Chromium AND WebKit.
     The two engines then differed only in the clean-up — WebKit restored 1943
     on close, Chromium left it at 0 — so one defect read as a broken page on
     Chrome and as nothing at all on Safari.

     The close handler was never the cause, so this fix changes nothing about
     WHY the restore below exists. (Its shape did move, in this same PR and
     for an unrelated reason: the restore now waits a tick and falls through
     to the player, because a lightbox can close BECAUSE the stage is about to
     stop being a still. What it does for a still is what it always did.) It
     stays because it is load-bearing on WEBKIT specifically: MEASURED,
     removing it leaves the close lane green on Chromium, whose native dialog
     restores focus by itself, and red on WebKit, where a mouse click never
     focused the button and the reader lands on the document body instead.

     `fixed` rather than deleting the declaration: the close control is
     absolutely positioned against this box and needs a containing block,
     which `fixed` is exactly as `relative` was. The insets and auto margins
     are stated here rather than inherited from the UA sheet, so the centring
     is this file's own claim on every engine instead of a default it happens
     to agree with. */
  .gallery-lightbox {
    position: fixed;
    inset: 0;
    margin: auto;
    inline-size: fit-content;
    block-size: fit-content;
    max-inline-size: var(--gallery-lightbox-max-inline, min(94vw, 90rem));
    /* The close mark's lane, reserved above the frame so the mark has
       somewhere to live that is NOT the photograph (issue 202). Only the
       block-start side is padded; the dialog is otherwise flush. */
    padding: var(--gallery-close-lane, 1.5rem) 0 0;
    border: none;
    background: none;
  }

  .gallery-lightbox::backdrop {
    background: var(--gallery-scrim, rgba(0, 0, 0, 0.7));
  }

  /* The frame border, entirely token-driven (issue 176): nothing here
     states a width, color or image of its own -- see styles.css. */
  .gallery-lightbox-border {
    display: grid;
    padding: var(--gallery-frame-padding);
    background: var(--gallery-frame-color);
    border: var(--gallery-frame-width) solid var(--gallery-frame-color);
    border-image: var(--gallery-frame-image);
    border-radius: var(--gallery-frame-radius);
  }

  .gallery-lightbox-image {
    display: block;
    /* THE SAME CAP THE DIALOG ITSELF CARRIES, and it has to be (issue 264).
       A cap is needed here at all because the picture is a grid item sized
       `auto` from its intrinsic attributes, so without one it overflows the
       box it sits in. It used to be a 90vw literal of its own, tuned when a
       phone's feed column was the viewport less its two gutters AND the
       44px lane reserved for the reading-mode control. That lane is retired
       (styles.css, "BELOW THE HANDLE BREAKPOINT..."), so the feed stage grew
       to the full column and a 90vw enlargement MEASURED smaller than the
       frame it enlarged from: 353.7px against a 361px stage on a Pixel 5,
       351.0 against 358 on an iPhone 13 — an "enlarge" that shrank the
       photograph. Reading the dialog's own token instead of a second number
       is what stops the two disagreeing again: whatever the enlarged surface
       is allowed to be, the picture inside it is allowed to be exactly
       that. */
    max-inline-size: var(--gallery-lightbox-max-inline, min(94vw, 90rem));
    /* The loading affordance's canvas: the enlarged <img> inlines the strip's
       cached preview as its background-image, and these three make that
       stand-in sit exactly where the full picture will land. A video sets no
       background-image, so on a film these are inert. */
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
    /* The static viewport unit is never used here (issue #26): the base is a
       fixed cap, generous enough that a browser without svh still shows a
       whole photograph, and the dynamic unit is a pure upgrade on top of it. */
    max-block-size: var(--gallery-image-max-block, 40rem);
    border-radius: calc(var(--gallery-frame-radius) - var(--gallery-frame-width));
  }

  /* The enlarged element carries its intrinsic box as attributes so the
     frame has a shape before a poster or a frame decodes. Auto sizing is what
     lets the caps above take over from those attributes instead of fighting
     them, and it keeps the aspect ratio intact on the way down. */
  .gallery-lightbox-image {
    inline-size: auto;
    block-size: auto;
  }

  @supports (max-block-size: 1svh) {
    .gallery-lightbox-image {
      /* Not tokenized, unlike the fixed cap above: a custom property accepts
         any value unconditionally, so an svh DEFAULT would sit outside this
         guard while looking textually identical to an unguarded progressive
         value — see the note beside --gallery-image-max-block in
         styles.css. */
      max-block-size: 80svh;
    }
  }

  /* The close control is a 44px touch target that paints NOTHING of its own
     (issue 202): the hit box keeps the rendering-lanes stage-1 floor while
     the only visible thing is the small mark below, aligned to the lane's
     top-right so it sits above the photograph rather than on it. */
  .gallery-lightbox-close {
    position: absolute;
    inset-block-start: 0;
    inset-inline-end: 0;
    place-items: start end;
    background: none;
    color: var(--gallery-close-ink, white);
  }

  /* What the reader actually sees: 1.125rem against the 2.75rem disc this
     replaced — 59% narrower, and past the owner's "at least 50% smaller".
     It rests translucent and comes to full strength on hover or keyboard
     focus, so it is unobtrusive without ever being invisible. */
  .gallery-close-mark {
    display: grid;
    place-items: center;
    inline-size: var(--gallery-close-size, 1.125rem);
    block-size: var(--gallery-close-size, 1.125rem);
    border-radius: 999px;
    background: var(--gallery-close-surface, rgba(0, 0, 0, 0.5));
    opacity: var(--gallery-close-rest-opacity, 0.55);
  }

  .gallery-lightbox-close:hover .gallery-close-mark,
  .gallery-lightbox-close:focus-visible .gallery-close-mark {
    opacity: 1;
  }

  /* THE RESERVED CAPTION LANE (issue 265). Issue 202 made this container
     conditional on the CURRENT item having something to say, and said so on
     purpose: "reserve space only when the specific item has something to
     show". The owner has now overruled that trade from a live review — a
     captioned item arriving pushed the whole document up and down (MEASURED:
     50px at 1440, 69px at 390, in both directions), and the frame must hold
     the box before the item needs it.
     The container is a one-cell grid; every lane below is placed in that one
     cell, so the row is as tall as the TALLEST lane and the visible one
     cannot move it. Nothing here states a height: the engine measures the set
     at the live width, which is the only place the answer is correct at every
     viewport. */
  .gallery-caption {
    display: grid;
    margin-block-start: var(--gallery-caption-space, 0.25rem);
    text-align: center;
    font-size: var(--card-meta-size);
    line-height: var(--card-meta-leading);
    color: var(--card-meta-ink);
  }

  /* One item's caption, stacked with every other item's. `visibility: hidden`
     rather than `display: none` is the whole mechanism — a hidden lane still
     takes its space in the grid, which is what holds the box open, while
     taking no part in what a reader sees, reads out or searches for.
     `align-content: start` is load-bearing: the default stretch would spread
     one item's paragraphs down the height of the tallest lane, so a
     one-line caption in a two-line box would sit apart from its own picture. */
  .gallery-caption-lane {
    grid-area: 1 / 1;
    display: grid;
    align-content: start;
    gap: var(--gallery-caption-gap, 0.125rem);
    visibility: hidden;
  }

  .gallery-caption-lane[data-current] {
    visibility: visible;
  }

  .gallery-caption-title,
  .gallery-caption-text,
  .gallery-meta-title,
  .gallery-meta-text {
    margin: 0;
  }

  .gallery-caption-title,
  .gallery-meta-title {
    font-weight: var(--card-title-weight);
  }

  .gallery-caption-title {
    color: var(--card-title-ink);
  }

  /* The lightbox metadata sits on the scrim, which is the same near-black in
     every reading mode (see the --gallery-scrim note in styles.css), so its
     ink does not branch by mode either. */
  .gallery-lightbox-meta {
    display: grid;
    justify-items: center;
    gap: var(--gallery-meta-gap, 0.125rem);
    margin-block-start: var(--gallery-meta-space, 0.5rem);
    text-align: center;
    font-size: var(--card-meta-size);
    line-height: var(--card-meta-leading);
    color: var(--gallery-meta-ink, white);
  }

  /* A link is a control, so it carries the same 44px target every other
     control on the page does — and it obeys the page's link doctrine
     (issue 203): no resting underline, and a visible mark on hover or
     keyboard focus so a link with no underline is still announced. */
  .gallery-meta-link {
    display: inline-flex;
    align-items: center;
    min-block-size: 2.75rem;
    padding-inline: var(--gallery-meta-link-padding, 0.5rem);
    color: inherit;
    text-decoration: none;
  }

  .gallery-meta-link:hover,
  .gallery-meta-link:focus-visible {
    text-decoration: underline;
  }
</style>
