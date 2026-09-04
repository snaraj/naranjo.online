<!-- ContributionGrid is the site's ONE contribution heatmap: columns of seven
  daily cells, a magnitude ramp of five levels, a month axis for any series
  whose columns carry dates, and a less/more legend. Both the token-activity
  grid and the version-control
  contribution calendar render through it, so the two never drift apart.

  It is deliberately dumb about DATA: callers pass prepared cells (lib/grid.ts
  builds them) and the component lays them out. It is not dumb about
  INTERACTION, and issue 219 is why. A magnitude is never encoded by color
  alone — every cell carries its count and date as an accessible label and as
  the shared detail card — and the grid has a fixed block size with its own
  horizontal scroll, so a wide window scrolls inside the panel and never
  shifts the page.

  READING A CELL IS THE DATAVIZ FLOOR, NOT A CONVENIENCE. AGENTS.md requires
  that "a value is never encoded by color alone: pair color with position,
  text, or shape". A heatmap cell is a colour shade; the readout IS the text
  pairing. So the strip is an interaction surface in its own right: tap, hover
  and keyboard all reach the same readout, one cell is current at a time, and
  the current cell wears a ring. What it is NOT is 371 tooltips — see the
  one-tip-per-strip note in the script below for the measurement behind that.

  Its INLINE size used to be its data, in columns (issue #141, residual risk
  2: a fifteen-day series was three columns pinned to the left edge of
  fifty-three columns of nothing, which read as a graph that had lost its
  data rather than as a short one). Issue 189 SUPERSEDES that rule for any
  series lib/grid.ts's calendarColumns can date: it always hands back exactly
  pendingWeeks columns, front-padded with dated-but-absent cells when the
  series is younger than the window, so `columns.length` is pendingWeeks by
  construction and stripColumns' floor never engages for it — the "lost its
  data" misread that rule protected against cannot recur once the window's
  own faint absent cells and month axis say where the real data starts. The
  cap below is what stays: a MAXIMUM rather than a width, so a narrow screen
  still shrinks the block and the strip still scrolls inside itself, whatever
  produced its column count.

  Sizing to content and reserving space are not in tension here, and the
  reason is arithmetic rather than luck: the empty state's chrome is one year
  wide, the calendar that lands in it is one year wide, and now a short
  series padded up to the window is ALSO one year wide, so no arrival changes
  this dimension. Every side of that equality is pinned — pendingWeeks in
  lib/grid.ts, calendarColumns' own fixed-width construction, and the
  shipped calendar in the origin's own test — and the rendering lanes measure
  the box across a real arrival.

  Two axes (issue 189, matched to owner-supplied reference designs): a
  three-letter month tick above the strip, at the column each month begins
  and inside it — scrolling with the cells, since a month label only means
  anything beside the columns it names — and a Mon/Wed/Fri weekday gutter
  BESIDE the strip, in its own flex row so the labels stay put while the
  cells scroll past them. Both read lib/grid.ts's weekdayAxis, the single
  place the Sunday-start convention (verified against the origin's own
  vcs-activity payload) is written down, so the two grids can never disagree
  about which row a Wednesday is.

  It opens on the NEWEST data (owner directive, issue 127). Cells run oldest
  first, so a strip that opens where its content starts opens on January and
  hides everything the visitor came to see off the right edge; the strip is
  scrolled to its end as soon as its content changes size, and history is one
  swipe to the left. The scroll position is set outright rather than animated:
  this is where the strip STARTS, not a journey the reader takes, so there is
  no motion for a reduced-motion preference to be asked about.

  With no columns it renders the graph's chrome and says so, instead of
  replacing the graph with a sentence. Every placeholder cell is absent —
  valueless, undated and marked decorative — because a fabricated zero would
  look like a quiet day, and the honest rendering of no data is a graph with
  no data in it.

  That state is a RESERVE FOR A PAYLOAD IN FLIGHT and nothing else, and the
  distinction is the whole of the owner's ruling of 2026-08-24. It holds open
  exactly the box the arriving data will fill — measured, in the rendering
  lanes — so a calendar that lands a moment after first paint lands without
  moving the page. It is NOT a rendering for a source that has already
  answered and said it keeps no daily record: nothing is on its way there, and
  a box held open forever is a permanent hole, not layout stability. A caller
  that knows there is no series to wait for renders no grid at all — see the
  token panel, which gates its whole graph region on having columns to draw.

  How that state LOOKS is a separate decision from what it contains, and the
  two were conflated until issue 134. The placeholders used to be drawn as
  holes, identically to a missing day inside a real window, which made an
  empty panel read as a graph that failed to load. They now render as one
  flat, even field inside a framed plate, under a label set as a state rather
  than as an apology, with the magnitude legend hidden because there is no
  magnitude to explain — see the empty treatment in the styles below. Not one
  datapoint moved.

  Issue 189 carries that same finding one step further, into a real series: a
  day INSIDE the window the strip draws — before the series existed, or a
  future day in the calendar week that has not happened yet — is absent for
  exactly the reason issue 134 named, and reads the same way now: a faint,
  filled field, not an outlined hole. The distinction issue 134 drew stays
  exact underneath the paint — absent still means no count, a level-0 cell is
  still a real measured zero, and cellLabel still refuses to read a value off
  an absent one — only the two states' PAINT converged, because both are the
  identical honest "nothing was measured here" this component has always
  meant by absent. -->
<script lang="ts">
  import { untrack } from 'svelte';
  import {
    cellLabel,
    cellPeriod,
    formatWhole,
    gridCursorTarget,
    gridLevel,
    gridLevels,
    gridRows,
    monthTicks,
    nounTitle,
    peakValue,
    pendingColumns,
    stripColumns,
    stripIndexAt,
    weekdayAxis,
    type GridCell,
    type StripGeometry,
    type ValueFormat
  } from '../grid';
  import { isChord } from '../keys.ts';
  import type { TipPoint, TipPointerKind } from '../tooltip.ts';
  import DetailTip from './DetailTip.svelte';

  let {
    columns,
    noun = 'contribution',
    label,
    emptyNote = 'no activity data',
    fullWidth = false,
    cardTitle,
    formatValue = formatWhole
  }: {
    columns: GridCell[][];
    noun?: string;
    label: string;
    emptyNote?: string;
    /* How a cell's figure is written out, in the card AND in the accessible
       text, so the two can never disagree (owner directive, 2026-08-25). The
       default is exact digits, which is right for the calendar: a reader
       wants "3 contributions", not "3.0". A series whose days run to nine
       digits passes formatMagnitude instead — "627.7M tokens on Aug 11"
       rather than the log line that was there. */
    formatValue?: ValueFormat;
    /* The strip claims its container's full width instead of just the
       columns it draws (issue 178: the token panel's graph rendered as a
       tiny left-aligned block beside a card the other trackers fill).
       BOTH of this site's grids ask for it now (owner directive,
       2026-08-25: the contribution calendar "stops well short of the card's
       right edge", the same dead gap the token panel was fixed for). It
       stays a prop rather than becoming the component's only behaviour
       because the two questions are genuinely separate — how many columns
       there are is the caller's data, whether the block stretches to its
       container is the caller's layout — and a caller that wants a
       content-sized strip is a prop away rather than a fork of this
       component. */
    fullWidth?: boolean;
    /* The detail card's title. It used to GATE whether a cell had a designed
       detail at all, with the calendar deliberately left on the browser's
       native title= tooltip — and that gate was the defect of issue 219.
       MEASURED on an iPhone at the shipped build: of this page's three
       grids, the token strip carried a real detail on 15 of its 371 cells
       and the contribution calendar on 0 of 371, because `title=` HAS NO
       TOUCH TRIGGER IN ANY ENGINE. A heatmap encodes magnitude as a colour
       shade and nothing else, so a cell that cannot be interrogated fails
       AGENTS.md's dataviz floor — "a value is never encoded by color alone"
       — on every touch device. The detail is the text pairing that floor
       requires, which makes it a conformance surface rather than a nicety,
       and a conformance surface cannot be opt-in.
       It is therefore a TITLE and nothing else now; every cell of every grid
       carries the shared card. DetailTip's own header comment already
       recorded this exact finding once, about the skill tiles: a bare
       `title=` is "no styling, no tokens, a half-second delay, and a shape
       that varies by operating system". The calendar was simply the caller
       that never got the memo. */
    cardTitle?: string;
  } = $props();

  /* ONE TIP FOR THE WHOLE STRIP, not one per cell — and the reason is
     measured rather than tidy. This grid draws 371 cells at 10x10px. A tip
     per cell is 371 components and roughly 4400 extra elements PER GRID,
     three grids to a page, for a readout only one cell shows at a time; the
     zero-CLS theme switch pays for every one of them in style recalc. And it
     would not even fix the defect: 10px is far under the 44px touch floor,
     so a finger that must LAND on one cell still opens nothing.
     So the strip resolves which cell a point names, geometrically, and the
     single tip moves. A finger that lands in a gap, or half a cell off, gets
     the cell it was reaching for instead of nothing at all — which is what
     makes a 10px target usable without pretending it is 44px wide. */
  const cells = $derived(columns.flat());
  let selected = $state(-1);
  /* WHICH DAY the cursor names, deliberately NOT reactive. It is bookkeeping
     for the payload-swap effect at the bottom of this script, and reading
     `selected` there would make that effect re-run on every cursor move —
     which is precisely the reset it exists to prevent. Written through
     setCursor below, the ONE place the cursor is ever assigned, so the index
     and the date it means can never drift apart. */
  let cursorDate: string | undefined;
  let cellsHost = $state<HTMLDivElement>();
  /* Per-INSTANCE, because aria-activedescendant names an id and this page
     mounts three of these grids. Svelte's own $props.id() is the framework's
     answer to exactly this, so nothing here invents a counter. */
  const gridId = $props.id();

  /* The strip's cell geometry, cached. The move handler must read NO layout
     — lib/tooltip.ts holds that line for the tip's own box and this is the
     same discipline on the same path — so the pitch is measured once and
     invalidated by the two things that can change it: the strip scrolling
     under the pointer, and the box resizing. */
  let geometry: StripGeometry | null = null;

  function measureGeometry(): StripGeometry | null {
    const host = cellsHost;
    if (host === undefined || host.children.length === 0) {
      return null;
    }
    const first = host.children[0].getBoundingClientRect();
    /* The pitch is read from real siblings rather than from the tokens,
       because a full-width strip stretches its columns to the container and
       the token is only the floor. Cells are emitted column-major, so the
       next child is one row down and the child gridRows along is one column
       across; a grid too small to have either falls back to the cell's own
       box, which is the correct pitch when there is no gap to add. The cell's
       OWN box comes from the same measurement, so the gap between them is the
       difference between two numbers read in one pass rather than a token this
       file would then have to keep in step with the stylesheet. */
    const down = host.children[1]?.getBoundingClientRect();
    const across = host.children[gridRows]?.getBoundingClientRect();
    return {
      left: first.left,
      top: first.top,
      pitchX: across ? across.left - first.left : first.width,
      pitchY: down ? down.top - first.top : first.height,
      cellWidth: first.width,
      cellHeight: first.height,
      columns: Math.ceil(host.children.length / gridRows),
      count: cells.length
    };
  }

  function forgetGeometry(): void {
    geometry = null;
  }

  /* Which cell a viewport point names — the arithmetic is lib/grid.ts's
     stripIndexAt, which is where the gap rule and its two readers are
     explained and executed. */
  function cellIndexAt(point: TipPoint, pointer: 'fine' | 'coarse'): number {
    geometry ??= measureGeometry();
    return geometry === null ? -1 : stripIndexAt(point, geometry, pointer);
  }

  function elementAt(index: number): HTMLElement | null {
    const child = cellsHost?.children[index];
    return child instanceof HTMLElement ? child : null;
  }

  /* What a point describes, for the shared detail binding. A cell the
     component has no reading for answers null, which CLOSES the readout
     rather than anchoring it to the strip: a box that describes nothing is
     worse than no box. An undated cell is exactly that case — the pending
     chrome carries no count and no date and is hidden from assistive
     technology, so there is nothing to say about it.

     A DIRECT HIT ALWAYS WINS, whoever is asking: the element under the event
     IS the cell, and no arithmetic can improve on that. The coordinate path
     below it is for the points that hit no cell at all — the gaps between
     them — and it is the one that had to learn who was asking, because
     forgiving a gap is a finger's 44px reach and a mouse's wrong answer. */
  function resolveCell(
    target: EventTarget | null,
    point: TipPoint,
    pointer: TipPointerKind
  ): HTMLElement | null {
    if (columns.length === 0) {
      return null;
    }
    const direct = target instanceof Element ? target.closest('[data-grid-cell]') : null;
    const index =
      direct instanceof HTMLElement && cellsHost?.contains(direct)
        ? Number(direct.dataset.gridIndex)
        : cellIndexAt(point, pointer === 'fine' ? 'fine' : 'coarse');
    if (!Number.isInteger(index) || index < 0 || index >= cells.length) {
      return null;
    }
    return cells[index].date ? elementAt(index) : null;
  }

  /* The ONE place `selected` is written. Every caller goes through it so the
     remembered date is always the date of the cell the index names — the
     invariant the payload-swap effect below depends on.
     The cells are read under untrack because this runs from the detail
     binding's own update as well as from an event handler, and a bookkeeping
     read must not quietly become a dependency of whatever effect happens to
     be flushing. */
  function setCursor(index: number): void {
    selected = index;
    cursorDate = index >= 0 ? untrack(() => cells[index]?.date) : undefined;
  }

  function noteSelection(element: HTMLElement | null): void {
    setCursor(element === null ? -1 : Number(element.dataset.gridIndex));
  }

  /* The keyboard's own cursor. The strip is a single focus stop (a scrollable
     region has to be reachable), so arrows move a selection INSIDE it rather
     than tabbing 371 times — the same shape a listbox or a calendar widget
     uses, and the non-gesture equivalent every gesture on this page owes.
     Left/right step a week, up/down step a day, Home/End jump to the ends,
     and the first arrow press on a strip nobody has selected in opens on the
     newest data. All of that is arithmetic and lives in lib/grid.ts's
     gridCursorTarget, where it is executed by the unit suite rather than read;
     what stays here is the wiring, which is the only part that needs an
     event. Which cells are DATED is the only thing that function needs to
     know about them, so the component hands it exactly that. */
  const datedCells = $derived(cells.map((cell) => Boolean(cell.date)));

  /* A CURSOR NOBODY CAN SEE IS NOT A CURSOR. The strip opens scrolled to its
     newest column and is far wider than its box — MEASURED at 390x844:
     scrollWidth 686 against clientWidth 312 — so the cell an arrow lands on is
     routinely outside the scrollport it lives in. Focusing the strip named a
     cell at x -11 against a strip starting at 51; `Home` named one at -323;
     and because the handler swallows the arrows (below, correctly), no key
     could bring the strip to them. That is WCAG 2.1.1 and the ARIA listbox
     pattern both, which put scrolling the active descendant into view on the
     author, and it is what this repairs: the pan the keyboard lost is given
     back as the cursor's own, rather than by handing the arrows to the
     browser — which was measured to break the block-axis guard instead
     (an unswallowed `Home` scrolls the DOCUMENT, and the readout closes).

     `nearest` on both axes is the whole behaviour: a cell already in view
     moves nothing at all, so a pointer selection and an arrow step onto a
     visible neighbour cost no scroll, and only a cursor that has actually
     left the scrollport brings it back.

     INSTANT, and stated rather than defaulted. The default resolves to
     whatever scrolling MODE the stylesheet has given the element, so a smooth
     one declared anywhere above this cell would silently turn every arrow
     press into an animation a reduced-motion reader never asked for — the
     same class of trap as the transform containing block in styles.css.
     Naming it here means that preference cannot be violated by a stylesheet
     edit somewhere else, which is stronger than asking a media query in this
     file and is the structural form this repository prefers. It is also the
     only correct choice for the readout: an animated scroll delivers its
     scroll events over the following frames, with the cell still outside the
     scrollport for the first of them, and the guard in lib/tooltip.ts would
     close the card the press just opened. It is the same reasoning that
     already sets the strip's opening position outright — this is where the
     cursor IS, not a journey the reader takes. */
  function revealCursor(index: number): void {
    if (index < 0) {
      return;
    }
    elementAt(index)?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' });
  }

  /* WHAT A TAB INTO THE STRIP MEANS. A listbox that gains focus must have a
     current option, and WHICH one is the caller's decision rather than the
     detail primitive's: this strip opens scrolled to its newest column, so
     the newest dated cell is both the one on screen and the one the reader
     came for — the same cell a cold arrow press opens on, through the same
     arithmetic, so the two entrances can never disagree.
     lib/tooltip.ts used to answer this by asking which element sat at the
     viewport ORIGIN, which is a sound guess for a caller with one subject and
     a wrong one for a strip with 371: MEASURED at 390x844, tabbing to the
     grid marked cell 168 at x -11 against a strip starting at 51 — a cursor
     outside its own scrollport, with the card clamped to x 4 describing a
     day nobody could see.
     :focus-visible for the reason the primitive uses it: a click or a tap
     focuses this region too, and those readers have already selected the cell
     they pointed at. */
  function onStripFocus(): void {
    if (columns.length === 0 || selected >= 0 || strip?.matches(':focus-visible') !== true) {
      return;
    }
    const opening = gridCursorTarget('End', -1, datedCells, gridRows);
    if (opening === null || opening < 0) {
      return;
    }
    setCursor(opening);
    revealCursor(opening);
  }

  function onStripKeydown(event: KeyboardEvent): void {
    /* A chord is addressed elsewhere — Cmd/Alt+Arrow is the browser's Back,
       Ctrl+Home is top-of-document — so it is neither acted on nor swallowed.
       See lib/keys.ts for why answering `event.key` alone was the defect. */
    if (columns.length === 0 || isChord(event)) {
      return;
    }
    const target = gridCursorTarget(event.key, selected, datedCells, gridRows);
    if (target === null) {
      return;
    }
    /* The key belonged to the grid, so the page must not also act on it —
       including when the move was refused at a boundary, where a cursor that
       cannot go further must not become a page scroll instead. */
    event.preventDefault();
    setCursor(target);
    /* BEFORE the reactive flush, on purpose: the scroll is synchronous, so
       DetailTip's own update() measures the cell where it has just been
       brought rather than where it was, and the scroll event that follows
       finds nothing moved. */
    revealCursor(target);
  }

  /* The element the binding should anchor to, driven by the keyboard cursor
     above. Reading `selected` here is what makes an arrow press move the
     readout: the action's update() runs on every change of this binding. */
  const anchorElement = $derived(selected >= 0 ? (elementAt(selected) ?? null) : null);

  const selectedCell = $derived(selected >= 0 ? cells[selected] : undefined);

  /* The readout itself. An ABSENT cell gets a real card saying so, rather
     than no card at all: "no data" and the day it had none is a truthful
     reading, and cellLabel has always produced exactly that sentence for the
     accessible name — the card simply stopped disagreeing with it. A
     fabricated zero would be the doctrine violation; an honest absence is
     the state the panel is in. */
  const selectedDetail = $derived(
    selectedCell === undefined
      ? { name: '', rows: [] }
      : {
          name: cardTitle ?? nounTitle(noun),
          rows: [
            {
              label: '',
              value: selectedCell.absent ? 'no data' : formatValue(selectedCell.value)
            },
            { label: '', value: cellPeriod(selectedCell) }
          ]
        }
  );

  const legendLevels = Array.from({ length: gridLevels }, (_, level) => level);
  const peak = $derived(peakValue(columns.flat()));
  const ticks = $derived(monthTicks(columns));
  const chrome = pendingColumns();

  /* The block's width, in columns, handed to the stylesheet as a number so
     the geometry is decided once — here, from the columns actually drawn —
     instead of being a constant the CSS guesses at. The empty state sizes
     itself to the chrome it renders for exactly the same reason the series
     state sizes itself to its data: whichever is on screen, the box is the
     box its contents need. And because the chrome is one year wide and the
     calendar that replaces it is one year wide, that arrival changes no
     dimension at all.

     A DATED full-width series claims exactly the columns it draws, with no
     floor. stripColumns' minimum exists for the capped layout's legend and
     for undated positional chunks, where a short strip reads as a graph that
     lost its data (issue #141) — but issue 189 already superseded that
     misread for any series the calendar can date, and under fullWidth the
     floor turned into a lie with a cost: a 30-day window drew five columns
     into a template of ten, so half the tracks were phantom empty space and
     the stylesheet stretched the real cells as if they shared the row with
     five ghosts (owner defect report, 0.1.52 — the mobile heatmap's dead
     right half). The empty chrome is unaffected either way: it is 53 columns,
     far above the floor. */
  const datedSeries = $derived(cells.some((cell) => cell.date));
  const claimedColumns = $derived(
    columns.length > 0 && fullWidth && datedSeries
      ? columns.length
      : stripColumns(columns.length > 0 ? columns.length : chrome.length)
  );

  let strip = $state<HTMLDivElement>();
  /* Bookkeeping, deliberately NOT reactive: these record what has already
     been anchored so the strip is not re-anchored for a change that did not
     move its newest column. -1 is "nothing measured yet", which no real
     count or width can be. */
  let anchoredColumns = -1;
  let anchoredWidth = -1;

  /* Past the maximum on purpose: engines clamp to it, so this asks for "the
     end" without computing it. (This page is LTR; in an RTL document the end
     edge would be the other one.) */
  function anchorToEnd(node: HTMLDivElement): void {
    node.scrollLeft = node.scrollWidth;
  }

  /* Anchoring on the column COUNT rather than on every payload: a
     sixty-second refresh that returns the same window must not yank a reader
     who has scrolled back through their own history, while a window that
     actually grew has a new newest column and belongs on screen. */
  $effect(() => {
    const count = columns.length;
    if (strip === undefined || count === anchoredColumns) {
      return;
    }
    anchoredColumns = count;
    anchoredWidth = strip.clientWidth;
    anchorToEnd(strip);
  });

  /* And again whenever the strip's own box changes width, because the scroll
     position that means "the end" is a function of that box. A card in this
     page's stack genuinely resizes under its content — a viewport change, a
     rotation, a stack that re-tiles — and a strip anchored before the resize
     is left showing the middle of its history afterwards. MEASURED: this is
     what the contribution calendar did at 1920px until the stack stopped
     re-tiling as panels mounted. Height changes are ignored; only the inline
     axis moves the end edge. */
  $effect(() => {
    const node = strip;
    if (node === undefined || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      /* Any resize invalidates the cached pitch, including one that leaves
         the inline axis alone: a full-width strip re-flows its columns
         whenever its box changes at all. The anchor below still asks the
         narrower question, because only the inline axis moves the end. */
      forgetGeometry();
      if (node.clientWidth === anchoredWidth) {
        return;
      }
      anchoredWidth = node.clientWidth;
      anchorToEnd(node);
    });
    observer.observe(node);
    return () => observer.disconnect();
  });

  /* The other half of that invalidation: the strip scrolling under a pointer
     moves every cell without resizing anything. Passive, because this listener
     never cancels a scroll — the strip's horizontal pan is the browser's own
     and stays that way (see the touch-action note in the styles below). */
  $effect(() => {
    const node = strip;
    if (node === undefined) {
      return;
    }
    node.addEventListener('scroll', forgetGeometry, { passive: true });
    return () => node.removeEventListener('scroll', forgetGeometry);
  });

  /* A NEW WINDOW IS A NEW SET OF DAYS — but it is usually the SAME days.
     This used to drop the cursor outright on any change of the `columns`
     identity, and the argument for that was half right: keeping the INDEX
     would silently re-point the readout at a different day, and keeping the
     ELEMENT would leave a ring on a cell whose meaning changed underneath it.
     What it missed is that the cursor names a DAY, and a day survives a
     payload that still contains it.

     Dropping it was the same class of defect the tip's own scroll handler was
     repaired for — "a listbox cursor is not the tip's to discard" — one layer
     up, and this PR handed it a new trigger: the pull gesture and its
     keyboard control both call refreshPanels(), which rebuilds every section
     and therefore every `columns` array. MEASURED at 390x844 before this
     repair: cursor on cell 370 with the readout open, press the refresh
     control, and `aria-activedescendant`, the ring and the card were all
     gone — a screen-reader reader lost their place because the page did its
     minute's work.

     So the cursor is re-pointed at the same DATE, and dropped only when that
     day is genuinely no longer in the window (a range change, a lens that
     redraws fewer days). untrack is what keeps this an effect about
     `columns` alone: reading the reactive cursor here would re-run it on
     every arrow press, which is the reset it exists to avoid. */
  $effect(() => {
    void columns;
    forgetGeometry();
    untrack(() => {
      const date = cursorDate;
      const at = date === undefined ? -1 : cells.findIndex((cell) => cell.date === date);
      selected = at;
      cursorDate = at >= 0 ? date : undefined;
    });
  });
</script>

<!-- The state is on the block rather than inferred by a selector, so the
  empty treatment below is one attribute a reader can see in the DOM instead
  of a rule that fires on the absence of something. -->
<div
  class="grid-block"
  data-grid-state={columns.length > 0 ? 'series' : 'empty'}
  data-grid-columns={claimedColumns}
  data-grid-fullwidth={fullWidth}
  style:--grid-columns={claimedColumns}
>
  <!-- The weekday gutter (issue 189) sits OUTSIDE the scrolling strip, in its
    own row of this flex pair, so a Mon/Wed/Fri label stays put while the
    cells beside it scroll past — a label that scrolled with the strip would
    read a different weekday every time the reader dragged it. It renders in
    both states: this is calendar structure (weekdayAxis, lib/grid.ts), never
    data, so the pending/empty chrome carries it exactly like a real series
    does, and only the undated month axis below is series-only. aria-hidden
    because every cell already carries its own weekday inside its date. -->
  <div class="grid-body">
    <div class="grid-weekday-axis" aria-hidden="true">
      {#each weekdayAxis as weekday (weekday.row)}
        <span class="grid-weekday" style:grid-row={weekday.row + 1}>{weekday.label}</span>
      {/each}
    </div>
    <!-- The strip clips wide windows behind its own horizontal scrollbar, and a
      scrollable region is keyboard-reachable only when focusable, so the
      tabindex is deliberate. -->
    <!-- The strip is the interaction surface, not the cell: one focus stop, one
      key handler, one detail card, and a geometric answer to "which cell is
      that". aria-activedescendant is what makes the keyboard cursor audible
      — assistive technology follows the named cell while focus itself stays
      on the region that can actually be scrolled. -->
    <!-- The role is what the strip actually IS in each state, not one label
      stretched over both. With a series it is a composite widget: many days,
      one of them current, an internal cursor the arrows move — which is a
      listbox, and is the only role family that admits aria-activedescendant.
      With no series there is nothing to select and nothing to point at, so it
      falls back to the plain scrollable region it has always been. Stating
      `listbox` over an empty chrome would be a control promising an
      interaction it cannot perform. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="grid-strip"
      role={columns.length > 0 ? 'listbox' : 'region'}
      aria-label={label}
      tabindex="0"
      bind:this={strip}
      onfocusin={onStripFocus}
      onkeydown={onStripKeydown}
      aria-activedescendant={selected >= 0 ? `${gridId}-cell-${selected}` : undefined}
    >
      {#if columns.length > 0}
        <!-- role="presentation" because a listbox may own only options and
          groups, and this div is neither — it is the layout grid the cells are
          placed on. Without it every `role="option"` is the child of a generic
          element and the listbox owns nothing, which is the exact shape ARIA
          forbids. It removes only the div's own implicit semantics: the cells
          inside keep theirs, and `display: grid` is untouched. -->
        <div class="grid-cells" role="presentation" bind:this={cellsHost}>
          {#each cells as cell, index (index)}
            <!-- Every cell is a real, interrogable datapoint now — no
              `title=` anywhere, which is the attribute that had no touch
              trigger and therefore no reading on a phone. aria-label carries
              the full value-and-date sentence for assistive tech, exactly as
              it always did; the card carries the sighted reader's copy of the
              same two facts. An ABSENT cell is labelled and selectable like
              any other: "no data for this day" is information, and a grid
              that answers nothing at all for 96% of its cells is the defect
              this replaced. -->
            <span
              class="grid-cell"
              id={`${gridId}-cell-${index}`}
              data-grid-cell
              data-grid-index={index}
              data-grid-absent={cell.absent ? 'true' : 'false'}
              data-grid-selected={selected === index ? 'true' : undefined}
              data-grid-level={cell.absent ? '' : gridLevel(cell.value, peak)}
              data-grid-peak={!cell.absent && peak > 0 && cell.value === peak ? 'true' : undefined}
              role="option"
              aria-selected={selected === index}
              aria-label={cellLabel(cell, noun, formatValue)}
            ></span>
          {/each}
        </div>
        {#if ticks.length > 0}
          <p class="grid-months" aria-hidden="true">
            {#each ticks as tick}
              <span class="grid-month" style:grid-column={tick.column + 1} title={tick.name}>
                {tick.abbrev}
              </span>
            {/each}
          </p>
        {/if}
      {:else}
        <!-- Chrome, and nothing but: no cell here carries a count, a date, or a
          label, and the whole block is hidden from assistive technology so the
          empty note below is the only thing it reads out. There is no month
          axis either — an undated column cannot be labelled with a month it
          was never told. -->
        <div class="grid-cells" aria-hidden="true">
          {#each chrome as column}
            {#each column as _cell}
              <span class="grid-cell" data-grid-pending data-grid-absent="true"></span>
            {/each}
          {/each}
        </div>
      {/if}
    </div>
  </div>
  <!-- OUTSIDE the strip on purpose. The tip is position: fixed, so no
    ancestor's overflow can clip it wherever it sits — but the strip is a
    scroll container, and keeping a box that is not part of the content out
    of the box whose scrollWidth decides the pan range removes the question
    entirely rather than answering it from the spec. It binds to the strip
    through `host` regardless of where it is rendered. -->
  {#if columns.length > 0}
    <DetailTip
      detail={selectedDetail}
      host={strip}
      resolve={resolveCell}
      select={noteSelection}
      anchor={anchorElement}
    />
  {/if}
  {#if columns.length === 0}
    <p class="grid-empty">{emptyNote}</p>
  {/if}
  <p class="grid-legend" aria-hidden="true">
    <span>less</span>
    {#each legendLevels as level}
      <span class="grid-cell" data-grid-level={level}></span>
    {/each}
    <span>more</span>
  </p>
</div>

<style>
  /* Positioned for the empty note alone, which is laid OVER the chrome rather
     than in the column: a note in the flow would make an empty panel a
     different height from a full one, and the day a series arrives the page
     would shift under whoever was reading it. */
  .grid-block {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--grid-gap, 0.25rem);
    /* THE DRAWN DAY, named once. Every box in the strip — the cell, the seven
       rows, the weekday gutter beside them and .grid-strip's own height — is
       derived from this one value, so the day and the box that holds it cannot
       disagree the moment either moves. It is an ALIAS, not a token: the theme
       layer still owns --grid-cell-size (styles.css), this only says which
       value this subtree draws a day at, and the full-width rule below is the
       only thing that ever changes it. Declared here rather than on :root
       because it is scoped by construction — the legend is a child of this
       box and a sibling of the strip, which is exactly why its swatches keep
       the base size while the strip's days may grow. */
    --grid-day: var(--grid-cell-size, 0.625rem);
    /* The block is exactly as wide as its two horizontal neighbors need,
       side by side: the weekday gutter, the row-gap beside it, and n cells
       plus their n-1 gaps. A CAP rather than a width, so the box still
       shrinks on a narrow screen and the strip scrolls inside it — a fixed
       width here would push a year of columns past a 320px viewport and take
       the page's own scrollbar sideways with it.

       Issue 189 added the gutter as a THIRD sibling sharing this box's
       horizontal budget with the strip (.grid-body, below): leaving the cap
       at cells-only arithmetic would squeeze the strip narrower than its own
       cells need it to be, and every grid would carry a permanent, pointless
       few pixels of horizontal scroll it never had before. --grid-axis-width
       is what makes that budget exact rather than approximate: the gutter
       below is sized to the SAME token, so the two can never disagree about
       how much of this box belongs to the gutter and how much to the cells.

       --grid-columns is written by the component from the columns it
       actually rendered (see claimedColumns), so the box cannot claim a
       series that is not there. The cell-size and cell-gap custom properties
       are the same ones the cells and the month axis are laid out with, and
       the fallbacks repeat theirs, so the box and its contents can never be
       computed from two different cell sizes. Nothing here reads a
       reading-mode token: the four modes restyle a grid and none of them
       resizes one. */
    max-inline-size: calc(
      var(--grid-axis-width, 1.25rem) + var(--grid-gap, 0.25rem) + var(--grid-columns, 53) *
        (var(--grid-day) + var(--grid-cell-gap, 0.1875rem)) -
        var(--grid-cell-gap, 0.1875rem)
    );
  }

  /* Full-width call sites (issue 178) stretch the cells to the container's own
     width instead of sizing them: each column becomes a flexible track floored
     at the token cell size, so a short series fills the card the way every
     other tracker does and a long one still overflows into the strip's own
     scroll exactly as it always has.

     THE RULING THAT CLOSED THE ISSUE-178 vs ISSUE-268 CONFLICT (the owner
     delegated the call to the coordinator, 2026-08-31; coverage-window truth
     wins). The block still takes its container whatever its data — that is
     issue 178's own owner report, "a tiny left-aligned block beside a card
     every other tracker fills", and it is unchanged. What changed under it is
     that the token panel's window is its own COVERAGE now rather than a fixed
     year, so a fortnight of history draws ten columns, and ten columns were
     230px of cells inside a 914px block (MEASURED at 1440px in all three
     engines). The two owner directives genuinely conflict at that size and
     neither of them is wrong: a strip cannot both cover only what was captured
     AND fill a card nine times wider, unless a day is drawn nine times wider
     than it is tall — which is the bar chart issue 158 measured and refused.

     The ruling is that the honest window outranks the full card. A day stays
     SQUARE and may scale up only as far as the caller's own bound; the strip
     stops there and left-aligns with the rest of the panel; and the width it
     does not reach is an ACCEPTED gap that closes itself, one real column per
     week of new capture. Nothing here is a cap on the BLOCK — the block still
     spans the card, so issue 178's report stays answered — only on how wide a
     single day may be drawn.

     The square is made by moving --grid-day (above) rather than by writing the
     row arithmetic out a second time: every box in the strip already derives
     from that alias, so re-pointing it on .grid-body squares the cell, the
     seven rows, the gutter and the strip's own height together, and none of
     them can be left behind. Its default is the alias's own base, so a
     full-width caller that names no bound renders byte for byte as it did —
     the version-control calendar does exactly that.

     .grid-body, NOT .grid-block, and the scope is the whole point: .grid-legend
     is .grid-body's sibling, so the legend's swatches keep the base size in
     every mode. That is the same scoping decision the stretch rule below
     already makes, for the same reason. */
  .grid-block[data-grid-fullwidth='true'] {
    max-inline-size: none;
    inline-size: 100%;
  }

  .grid-block[data-grid-fullwidth='true'] .grid-body {
    --grid-day: var(--grid-day-size, var(--grid-cell-size, 0.625rem));
  }

  .grid-block[data-grid-fullwidth='true'] .grid-cells,
  .grid-block[data-grid-fullwidth='true'] .grid-months {
    /* The track FLOOR is the drawn day, so a window too long for its card
       overflows into the strip's own scroll at the size the day is actually
       drawn rather than shrinking below it — which is what keeps a bounded
       day square at 53 columns as well as at ten.

       --grid-day carries no fallback here and needs none, which is a change
       worth stating because the hazard it replaces is real: --grid-cell-size
       has no :root definition anywhere, only fallback usages, so a bare
       var() on IT is invalid at computed-value time — that does not degrade,
       it drops the whole declaration to its initial value (none) and falls
       silently through to the capped layout's fixed-size columns. MEASURED:
       exactly that shipped here once already. --grid-day is declared outright
       on .grid-block, so every descendant resolves it and the fallback that
       used to be load-bearing has nothing left to carry. */
    grid-template-columns: repeat(var(--grid-columns), minmax(var(--grid-day), 1fr));
    inline-size: 100%;
    /* An upper bound on how far a FEW columns may stretch (issue 158). A
       full-width strip divides its container between however many columns it
       drew, which is right at a year's width and wrong at a month's: five
       columns of a thirty-day window drew 88px-wide cells in a 914px card,
       and a heatmap cell nine times wider than it is tall has stopped being
       a heatmap cell. MEASURED at 1440px before this bound existed.

       The bound is per-cell and the caller's to set, because how wide a cell
       may honestly be is a question about the series, not about this
       component. Its default is deliberately unreachable — 100vw per cell
       means the cap can never bind — so a call site that says nothing keeps
       the stretching behaviour it has today, byte for byte. --grid-columns is
       written by the component just above, so this arithmetic is over the
       columns actually drawn rather than an assumption about them; the month
       axis shares the rule so the two can never disagree about their width.

       n columns carry n-1 gaps, and the trailing one is subtracted for the
       same reason .grid-block's own cap subtracts it: without that term the
       box is one gap wider than the columns need, and a bound that binds
       hands the surplus straight back to the tracks. MEASURED, which is how
       it was found: a 20px bound over ten columns drew 20.30px days inside a
       230px box — square to the eye, and not the number the caller asked
       for. At 227px the same ten columns draw exactly 20px. It mattered only
       once a caller both bound the day AND drew it square, which is why it
       survived the bound's own introduction. */
    max-inline-size: calc(
      var(--grid-columns) * (var(--grid-day-max, 100vw) + var(--grid-cell-gap, 0.1875rem)) -
        var(--grid-cell-gap, 0.1875rem)
    );
  }

  /* The track above stretches; the cell inside it does not, by default — a
     grid item with its OWN declared width is sized to that width and merely
     placed inside a wider track, not stretched to fill it (the CSS Grid
     `stretch` default only governs items whose used width is auto). Scoped
     to `.grid-cells` alone, not `.grid-legend`: the legend's own swatches
     stay the fixed token size in every mode, full width or not. MEASURED:
     without this rule every shape drew an identical 10px cell regardless of
     how many columns shared the row. */
  .grid-block[data-grid-fullwidth='true'] .grid-cells .grid-cell {
    inline-size: auto;
  }

  /* The weekday gutter sits BESIDE .grid-strip (issue 189), not above or
     below it, so it changes this row's INLINE size and never its block
     size — the 7rem arithmetic right below is unaffected by the gutter's
     own width and stays exactly what it already was. align-items: flex-start
     keeps the gutter from being stretched to the strip's full 7rem (cells
     plus month axis plus scrollbar gutter): it only has seven rows of labels
     to draw, sized to match .grid-cells below, and stretching it taller would
     only leave empty grid tracks under real content. */
  .grid-body {
    display: flex;
    align-items: flex-start;
    gap: var(--grid-gap, 0.25rem);
  }

  /* The SAME row template .grid-cells uses (7 rows of --grid-cell-size, the
     same --grid-cell-gap between them) so a label sits exactly on the row it
     names rather than drifting against it — two independent grids computing
     the same seven positions from the same two tokens, not one grid copying
     the other's arithmetic by hand. Sized to the cells alone (5.5rem: 7 *
     --grid-cell-size + 6 * --grid-cell-gap), not the full 7rem strip, so it
     ends exactly where the last cell row does and never reaches into the
     month-axis strip beside it. */
  .grid-weekday-axis {
    display: grid;
    grid-template-rows: repeat(7, var(--grid-day));
    row-gap: var(--grid-cell-gap, 0.1875rem);
    block-size: calc(7 * var(--grid-day) + 6 * var(--grid-cell-gap, 0.1875rem));
    /* Fixed rather than intrinsic (issue 189): an un-sized flex child would
       shrink to whatever its widest label's glyphs happen to measure, which
       .grid-block's own cap (above) has no way to read back — the two would
       silently disagree about how wide "the gutter" is the moment a theme's
       font metrics shifted by a pixel. Reading the SAME token both places
       makes the two provably agree instead. 1.25rem clears "Wed"/"Fri" at
       the axis font size in every shipped theme, right-aligned inside it.

       flex: none is what makes "fixed" true rather than nearly true, and it
       is load-bearing under a full-width strip (owner directive, 2026-08-25).
       A declared inline-size is still a flex BASIS: the item may shrink below
       it when the row's items ask for more than the row has. MEASURED, the
       moment the calendar started stretching: the strip's own basis grows
       with its month labels, so this gutter was squeezed to 19.45px in a
       series state and stayed 20px in the empty one — the reserve and the
       arrival disagreeing about the box by half a pixel, which is the
       zero-CLS floor failing quietly. */
    flex: none;
    inline-size: var(--grid-axis-width, 1.25rem);
    font-size: var(--grid-axis-size, 0.5625rem);
    line-height: 1;
    color: var(--grid-axis-color, var(--panel-muted, rgb(158, 158, 158)));
  }

  .grid-weekday {
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  /* The strip's box, DERIVED from the rows it holds rather than stated as one
     number (issue 130). It used to read `block-size: 7rem` under a comment
     claiming "5.5rem of cells, 0.75rem of month axis, 0.75rem of scrollbar
     gutter" — arithmetic that came to 7rem only because it forgot the month
     axis's own 0.1875rem top margin. The real reserve was 0.5625rem: 9px for a
     scrollbar that is 15px on a classic Windows or Linux theme, so the month
     row clipped there (issue 130 reported ~3px against a 12px reserve; the
     margin is why it was worse than that).

     Every term below is now the SAME token the thing it measures is laid out
     with — the cell rows and their gaps from .grid-cells, the axis margin and
     height from .grid-months — so the box cannot be computed from one set of
     numbers while its contents are drawn from another.

     The last term is measured rather than guessed. lib/scrollbar.ts probes the
     platform's real scrollbar thickness before the application mounts and
     writes it here; the fallback is the 12px reserve the stylesheet ships
     with, and the measurement only ever widens past it, never under. A wide
     window scrolling inside the strip still never changes its outer height,
     and data arriving still shifts nothing. Unaffected by the weekday gutter
     beside it (.grid-body, above): that gutter changes this row's INLINE size
     only. */
  .grid-strip {
    block-size: calc(
      7 * var(--grid-day) + 6 * var(--grid-cell-gap, 0.1875rem) +
        var(--grid-month-gap, 0.1875rem) + var(--grid-month-size, 0.75rem) +
        var(--grid-scrollbar-size, 0.75rem)
    );
    overflow-x: auto;
    overflow-y: hidden;
    flex: 1 1 auto;
    min-inline-size: 0;
  }

  .grid-strip:focus-visible {
    outline: 1px solid var(--panel-accent, rgb(220, 138, 0));
    outline-offset: 1px;
  }

  .grid-cells {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(7, var(--grid-day));
    grid-auto-columns: var(--grid-day);
    gap: var(--grid-cell-gap, 0.1875rem);
    inline-size: max-content;
  }

  /* The sequential ramp: one hue, monotone lightness — level 0 is a
     near-surface neutral and levels 1..4 step brighter. The theme layer
     restyles or re-anchors the ramp by overriding these five properties. */
  .grid-cell {
    inline-size: var(--grid-day);
    block-size: var(--grid-day);
    border-radius: var(--grid-cell-radius, 2px);
    background: var(--grid-cell-0, #383835);
  }

  .grid-cell[data-grid-level='1'] {
    background: var(--grid-cell-1, #1c5cab);
  }

  .grid-cell[data-grid-level='2'] {
    background: var(--grid-cell-2, #2a78d6);
  }

  .grid-cell[data-grid-level='3'] {
    background: var(--grid-cell-3, #5598e7);
  }

  .grid-cell[data-grid-level='4'] {
    background: var(--grid-cell-4, #86b6ef);
  }

  /* THE PEAK IS ITS OWN CHANNEL (owner directive, 2026-09-03, issue 287): the
     busiest day of the window wears the page's one highlight, through an
     attribute of its own rather than through a sixth ramp bucket. Two facts,
     two attributes — the level says how busy the day was, the peak says it was
     the busiest — which is what keeps the ramp monotone in lightness while
     still marking the extreme the owner wanted marked. It is never colour
     alone: the peak cell carries the identical count-and-date reading every
     other cell does, in its accessible label and in the shared detail card. */
  .grid-cell[data-grid-peak='true'] {
    background: var(--grid-cell-peak, #ff3b1f);
  }

  /* A day the window does not cover is absent, not a zero, and is still
     labelled as carrying no data (cellLabel refuses to read a value off it
     either way) — but it PAINTS as a faint, filled field now (issue 189),
     not the outlined hole this rule drew before. That is the same finding
     issue 134 made about the panel's OWN empty state — a field of outlines
     reads as a graph that failed to load — extended to a real series' own
     in-window absences (a day before the series existed, or a future day
     in its current week): both classes of absence read identically to a
     reader now, which is honest, because both ARE identical honest
     "nothing was measured here" statements, only on opposite ends of the
     window. This rule is what a pending/empty-state cell would ALSO paint
     as, except that state's own more specific selector
     (.grid-block[data-grid-state='empty'] .grid-cell[data-grid-pending],
     below) overrides it with its own framed-plate treatment — the two
     empty looks stayed deliberately distinct: a whole panel with nothing to
     plot is still a different state from a few missing days inside a real
     one. */
  .grid-cell[data-grid-absent='true'] {
    background: var(--grid-cell-absent, rgba(120, 120, 120, 0.18));
    box-shadow: none;
  }

  /* The SELECTION ring, and the reason it is not a hover rule (issue 219).
     `:hover` answers a mouse and nothing else: a finger produces no hover at
     all on a real touchscreen, and where an engine emulates one it is STICKY
     — the ring stays painted on the last cell tapped long after its readout
     closed, which is a page claiming a selection it does not have. The ring
     now follows the same state the readout does, written by the shared
     binding through `select`, so the mark and the box can never disagree
     about which cell is current. It is deliberately the same weight and
     token the hover ring was, so nothing about the LOOK changed — only what
     decides it. Hover still paints it, because a hovering pointer IS the
     selection under the same rule. */
  .grid-strip .grid-cell[data-grid-selected='true'] {
    outline: 1px solid var(--grid-cell-ring, rgba(255, 255, 255, 0.6));
    outline-offset: 1px;
  }

  /* The keyboard cursor reads as a focus ring rather than a selection one:
     focus is on the STRIP, so the accent has to say which cell inside it the
     arrows are pointing at, exactly as .grid-strip:focus-visible says which
     strip the tab stop reached. */
  .grid-strip:focus-visible .grid-cell[data-grid-selected='true'] {
    outline-color: var(--panel-accent, rgb(220, 138, 0));
  }

  /* Its margin and its height are tokens because .grid-strip's own box is
     computed from them (issue 130): two literals here and two more up there
     would be two copies of one fact, free to disagree the day either moved. */
  .grid-months {
    margin: var(--grid-month-gap, 0.1875rem) 0 0;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: var(--grid-day);
    gap: var(--grid-cell-gap, 0.1875rem);
    inline-size: max-content;
    block-size: var(--grid-month-size, 0.75rem);
    /* The SAME two axis tokens the weekday gutter reads (.grid-weekday-axis,
       above), so the month row and the weekday column always render at one
       shared size and ink rather than two that happen to agree today. */
    font-size: var(--grid-axis-size, 0.5625rem);
    line-height: 1;
    color: var(--grid-axis-color, var(--panel-muted, rgb(158, 158, 158)));
  }

  .grid-month {
    grid-row: 1;
  }

  .grid-legend {
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--grid-cell-gap, 0.1875rem);
    block-size: 0.875rem;
    font-size: 0.6875rem;
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .grid-legend span:first-child {
    margin-inline-end: 0.25rem;
  }

  .grid-legend span:last-child {
    margin-inline-start: 0.25rem;
  }

  /* Centred over the chrome it describes, out of flow, so the panel's height
     is identical empty and full. It covers the whole block rather than
     claiming the strip's height for itself: a second copy of that number
     would be a second thing to keep in step with the first.

     Set as a label rather than as an apology. The italic it used to wear is
     the typography of a caveat, and a source that has no daily record is not
     a fault the reader needs apologising to about — it is a state the panel
     is deliberately in. Small caps with letter spacing read as a state; a
     line of italics reads as something that went wrong. */
  .grid-empty {
    position: absolute;
    inset: 0;
    margin: 0;
    display: grid;
    place-items: center;
    font-size: var(--panel-badge-size, 0.6875rem);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  /* The empty treatment, and the reason it is a treatment at all: with no
     series the strip used to be three hundred and seventy-one outlined
     squares — every one of them the rendering a MISSING DAY inside a real
     window gets — which reads as a graph that failed to load rather than as a
     panel with nothing to plot (owner directive, issue 134).

     Nothing about the information changes: the cells stay absent, valueless,
     undated and hidden from assistive technology, so the block still contains
     exactly as many datapoints as the source has reported, which is none. What
     changes is that they stop impersonating holes. A flat, even, near-invisible
     field inside a framed plate is a reserved space; a field of outlines is a
     grid missing its data. Neutral greys on purpose, so the treatment holds in
     every reading mode without the token layer having to know about it.

     The legend goes with them. A less-to-more ramp explains a magnitude
     encoding, and there is no magnitude here to encode — but it keeps its box
     rather than being removed, because the panel's height must not depend on
     whether its series has arrived. */
  .grid-block[data-grid-state='empty'] .grid-cell[data-grid-pending] {
    background: var(--grid-cell-empty, rgba(128, 128, 128, 0.1));
    box-shadow: none;
  }

  /* An inset shadow, never a border: a border would grow the strip's box by
     two pixels and the empty panel would stop being exactly as tall as the
     full one. */
  .grid-block[data-grid-state='empty'] .grid-strip {
    box-shadow: inset 0 0 0 1px var(--grid-empty-frame, rgba(128, 128, 128, 0.2));
    border-radius: var(--grid-empty-radius, 6px);
  }

  .grid-block[data-grid-state='empty'] .grid-legend {
    visibility: hidden;
  }
</style>
