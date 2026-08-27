<!-- UsageTracker renders per-source usage inside the shared PanelShell: one
  block per source, straight from UsageTrackerProps (lib/blocks.ts). It is a
  generic primitive with NO domain knowledge — every source label, figure,
  heading and noun arrives as data built by an adapter in the binding layer,
  so a new tool appears by shipping data, never by editing code.

  Each source block is, top to bottom: a tile grid of headline figures (a
  final odd tile spans the full width); the usage windows with their
  utilization meters, the numeric reading always rendered beside the fill so
  severity is never color alone; an activity section whose toggles read ONE
  delivered payload three ways — a view lens (daily/weekly/monthly/cumulative),
  a trailing range (30d/90d/12mo/all), and, for a source that reports one, a
  category lens (total plus its own accounting classes) — with no extra bytes
  and no ceiling on how much history the series may grow to hold; and an
  insights list.

  Every section is optional and every absence is honest. A figure the origin
  does not report arrives as an explicit dash, and a payload that fails
  admission arrives as no sections at all, rendering the empty state — never
  invented numbers.

  Provenance is drawn by EXCEPTION rather than on every figure (owner
  directive, issue 134). The suffix used to render on each tile and each
  insight — around a hundred repetitions on one screen, every one of them the
  same word — which is a label that distinguishes nothing. The adapter
  decides per source (provenanceIsMixed beside the data): figures that all
  share one provenance carry no marker, because the envelope's status already
  says where the payload came from; figures that DISAGREE arrive with
  `marked` set on the recorded ones, because those are the ones that would
  otherwise borrow the freshness of the live figures beside them. Nothing
  left the payload, and the mixed case is exactly what a successful refresh
  produces.

  A source with no daily series renders NO graph region at all (owner ruling,
  2026-08-24) — not an empty one, not a dimmed one, not a placeholder one.
  The two designs before it were both wrong in the same direction. First a
  line of text where the graph belongs, which explained the ORIGIN's refresh
  configuration to a visitor who had asked about usage. Then the graph's
  chrome under a note calling the series unarrived, which was honest about its
  cells — every one absent, valueless and undated — and false about its
  premise, because nothing was on its way. A source that reports no daily
  record is not waiting for one, and space held for data that can never arrive
  is a permanent hole rather than layout stability. So the adapter carries an
  activity region only when there is a series, the render below still gates on
  there being columns to draw, and a seriesless source keeps every figure it
  genuinely has — its tiles, its windows, its insights — with no graph on it.
  (The retired wording is quoted in the tests that pin its absence, so this
  file cannot be the place it comes back from.)

  Every color and metric reads a custom property with a dark-native default,
  so themes restyle by overriding variables. -->
<script lang="ts">
  import type { UsageActivity, UsageCategory, UsageTrackerProps } from '../blocks.ts';
  import { formatMagnitude, seriesCells, seriesViews, viewColumns, type SeriesView } from '../grid';
  import { isChord, ringTarget } from '../keys.ts';
  import {
    activityReading,
    coverageReading,
    defaultSeriesRange,
    rangeColumns,
    seriesRanges,
    type SeriesRange
  } from '../periods.ts';
  import ContributionGrid from './ContributionGrid.svelte';
  import PanelShell from './PanelShell.svelte';

  let { id, title, status, generatedAt, sections, emptyNote }: UsageTrackerProps = $props();

  /* One view choice PER SOURCE (owner directive, 2026-08-25).

     This used to be a single `view` for the whole panel, on the argument that
     sources read side by side should not be compared through different
     lenses. The owner reversed it after using the page: the panel renders a
     graph per source, each with its own toggle sitting over its own strip,
     and pressing one toggle re-read the OTHER source's graph too — which
     reads as a bug whatever the rationale, because a control beside one graph
     that changes a different graph is not a control that says what it does.

     Keyed by the source's own key rather than held in a child component, so
     the state survives a payload refresh: the adapter rebuilds its sections
     every delivery, and a lens parked in a component instance would reset to
     daily every sixty seconds. A source whose key has never been pressed
     reads `daily`, the shipped default, so a source appearing mid-session
     needs no initialisation.

     It is still the ONE piece of state that lives here rather than in the
     adapter, because it is presentation — the same series read three ways —
     and the lens math (lib/grid.ts) knows no source either. */
  let views = $state<Record<string, SeriesView>>({});

  function viewOf(key: string): SeriesView {
    return views[key] ?? 'daily';
  }

  /* The CATEGORY lens is a second piece of per-source presentation state,
     held here for exactly the reasons `views` is: the adapter rebuilds its
     sections every delivery, and a lens parked anywhere else would reset
     every sixty seconds. Per source because category vocabularies genuinely
     differ between sources — one tool reports reasoning tokens, another does
     not — and forcing one choice across sources would render a lens a source
     cannot answer. A source without categories simply has no lens row and
     always reads as total. The component knows no category by name: every
     key, label, palette slot, and per-lens noun arrives as data built by the
     adapter.

     `totalLens` is the key meaning "no category", and it is stated HERE, once
     in the whole tree. The adapter used to export a copy of it beside a lens
     RESOLVER that nothing called; both were deleted rather than wired in, so
     the sentinel now lives in the one file that decides anything with it —
     this component, which resolves the lens and falls back to the plain
     series. */
  let lenses = $state<Record<string, string>>({});

  const totalLens = 'total';

  function lensOf(key: string): string {
    return lenses[key] ?? totalLens;
  }

  /* activeLensCategory resolves a source's lens to the adapter-built
     category it names, or undefined for the total reading — including an
     unknown or stale lens, which falls back to the plain totals because
     those are always real data, never a guess. */
  function activeLensCategory(activity: UsageActivity, lens: string): UsageCategory | undefined {
    if (lens === totalLens || !activity.categories) {
      return undefined;
    }
    return activity.categories.find((category) => category.key === lens);
  }

  /* And one RANGE choice per source, held the same way and for the same
     reason (issue 158). The lens says how a day is read; the range says how
     much history is drawn — two genuinely separate questions, which is why
     they are two controls rather than one list of six things.

     The default is the range the strip has always drawn (defaultSeriesRange
     is 12mo, which resolves to the grid's own reserve width), so a reader who
     never touches this control sees exactly what this panel rendered before
     it existed, and history accrues into the same box until they ask for
     more. */
  let ranges = $state<Record<string, SeriesRange>>({});

  /* THE SEGMENTED PILLS' KEYBOARD (issue 219). Every pill on this panel is a
     real `radiogroup` of real `radio`s — the semantics were right — but a
     radio group is a COMPOSITE widget, and WAI-ARIA gives composites one tab
     stop with the arrows moving inside it. What shipped had neither half:
     all sixteen segments were tab stops, and no arrow key did anything, so a
     keyboard reader tabbed through every segment of every group while a
     screen reader announced controls whose documented interaction was
     missing.
     Both halves land here. `tabindex` is roving — only the checked segment
     is tabbable — and the arrows move the choice and the focus together,
     which is exactly how a radio group behaves everywhere else and is also
     the non-gesture equivalent this panel's gestures owe (AGENTS.md's
     rendering floors, and the standing rule that a gesture-only affordance
     is a defect). Home and End jump to the ends; the wrap is deliberate,
     because a segmented control is a ring in every platform toolkit.
     One helper drives all three groups, so a fourth group inherits the
     behaviour by rendering the same markup rather than by remembering to.
     The RING itself is lib/keys.ts's, shared with the gallery's position dots
     and the reading-mode swatches: this file writing its own key table is how
     one page ended up with three of them and had to be told about the same
     defect three times. */
  function onRadioKeydown(
    event: KeyboardEvent,
    options: readonly string[],
    current: string,
    choose: (next: string) => void
  ): void {
    /* A chord is the browser's or the platform's — Cmd/Alt+Arrow is Back,
       Ctrl+Home is top-of-document — so it is neither acted on nor swallowed
       (lib/keys.ts). Branching on `event.key` alone swallowed all of them. */
    if (isChord(event)) {
      return;
    }
    const next = ringTarget(event.key, options.indexOf(current), options.length);
    if (next === null) {
      return;
    }
    /* The arrows belong to the group once focus is inside it, so the page
       must not scroll underneath the reader as well. */
    event.preventDefault();
    choose(options[next]);
    /* Focus follows selection: in a radio group the checked control IS the
       tab stop, so leaving focus behind would strand it on a segment that
       just became untabbable. */
    const group = event.currentTarget;
    if (group instanceof HTMLElement) {
      group.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
    }
  }

  function rangeOf(key: string): SeriesRange {
    return ranges[key] ?? defaultSeriesRange;
  }

  /* windowedColumns is the region's daily series laid onto true calendar
     weeks across the chosen trailing window (issue 189's calendarColumns,
     reached through issue 158's rangeColumns): every day the window covers
     and the capture does not comes back as a dated absent cell — a hole with
     a real date on it, never a zero.

     The dailies are the CATEGORY lens's when one is active, which is what
     makes the two lenses one engine rather than two: the category lens picks
     which series is read, the range picks how much of it is drawn, and the
     view lens picks how a drawn day is aggregated. All three re-read ONE
     delivered payload with no extra bytes, and every reading below is taken
     from the same cells the graph draws.

     Deliberately kept SEPARATE from the view step below, because the two
     readings under the graph have to be taken from these cells rather than
     from the lens' output: a weekly or monthly lens repeats one aggregate
     across every day it covers, and a total summed from that would count each
     period once per day in it. */
  function windowedColumns(
    activity: UsageActivity,
    range: SeriesRange,
    category: UsageCategory | undefined
  ) {
    const totals = category ? category.totals : activity.series.totals;
    return rangeColumns(seriesCells(activity.series.startDate, totals), range);
  }
</script>

<aside class="usage-tracker" data-panel-id={id} aria-label={title}>
  <PanelShell {title} {status} {generatedAt}>
    {#if sections.length === 0}
      <p class="usage-empty">{emptyNote}</p>
    {:else}
      {#each sections as source (source.key)}
        <section class="usage-source">
          <header class="usage-source-head">
            <h3 class="usage-source-label">{source.label}</h3>
            {#if source.sublabel}<span class="usage-account">{source.sublabel}</span>{/if}
          </header>

          {#if source.tiles && source.tiles.length > 0}
            <ul class="usage-tiles">
              {#each source.tiles as tile (tile.key)}
                <li class="usage-tile" data-usage-tile>
                  <span class="usage-tile-value">{tile.figure}</span>
                  <span class="usage-tile-label">
                    {tile.label}{#if tile.marked}<span
                        class="usage-recorded"
                        title="recorded out of band, not fetched live">· recorded</span
                      >{/if}
                  </span>
                </li>
              {/each}
            </ul>
          {/if}

          {#if source.note}
            <p class="usage-empty">{source.note}</p>
          {/if}

          {#if source.windows && source.windows.length > 0}
            <ul class="usage-windows">
              {#each source.windows as usageWindow}
                <li class="usage-window">
                  <div class="usage-window-head">
                    <span class="usage-period">{usageWindow.period}</span>
                    {#if usageWindow.reset}<span class="usage-reset">{usageWindow.reset}</span>{/if}
                  </div>
                  {#if usageWindow.meter}
                    <div class="usage-meter" data-severity={usageWindow.meter.severity}>
                      <div class="usage-meter-track" aria-hidden="true">
                        <div
                          class="usage-meter-fill"
                          style:inline-size={`${usageWindow.meter.fillPct}%`}
                        ></div>
                      </div>
                      <span class="usage-meter-value">
                        {usageWindow.meter.reading}
                      </span>
                    </div>
                  {/if}
                  <p class="usage-pairs" title={usageWindow.pairsLabel}>
                    {#each usageWindow.pairs as pair (pair.key)}
                      <span class="usage-pair">
                        <span class="usage-pair-label">{pair.label}</span>
                        <span class="usage-pair-value">{pair.figure}</span>
                      </span>
                    {/each}
                  </p>
                </li>
              {/each}
            </ul>
          {/if}

          <!-- The whole region, heading and lens toggle included, and not
            merely the graph inside it: a heading over a three-way toggle with
            nothing to toggle is the hole by another name. A source with no
            columns to draw renders none of this and reads as what it is — a
            source that reports figures and no daily record. See the ruling in
            this file's opening comment. -->
          {#if source.activity}
            {@const view = viewOf(source.key)}
            {@const range = rangeOf(source.key)}
            {@const lensCategory = activeLensCategory(source.activity, lensOf(source.key))}
            {@const windowed = windowedColumns(source.activity, range, lensCategory)}
            {@const columns = viewColumns(windowed, view)}
            {#if columns.length > 0}
              <section class="usage-activity">
                <header class="usage-activity-head">
                  <h4 class="usage-section-title">{source.activity.heading}</h4>
                  <!-- Two radio groups, each styled as a segmented pill: the
                    choice inside each is exclusive, so radios carry the right
                    semantics for free, and the two questions stay separate —
                    how a day is READ (the lens) and how much history is DRAWN
                    (the range). One combined list would make "monthly" and
                    "90d" alternatives, which they are not. -->
                  <!-- Each group is named for its own source AND its own
                    question, so a screen reader hears which graph it belongs
                    to and what it changes, rather than four identically named
                    groups on one panel — the audible half of the same
                    decoupling. -->
                  <div class="usage-controls">
                    <div
                      class="usage-views"
                      role="radiogroup"
                      tabindex="-1"
                      aria-label={`${source.label} ${source.activity.heading} view`}
                      onkeydown={(event) =>
                        onRadioKeydown(
                          event,
                          seriesViews,
                          view,
                          (next) => (views[source.key] = next as SeriesView)
                        )}
                    >
                      {#each seriesViews as candidate}
                        <button
                          type="button"
                          class="usage-view"
                          role="radio"
                          aria-checked={view === candidate}
                          tabindex={view === candidate ? 0 : -1}
                          onclick={() => (views[source.key] = candidate)}
                        >
                          {candidate}
                        </button>
                      {/each}
                    </div>
                    <div
                      class="usage-views"
                      data-usage-ranges
                      role="radiogroup"
                      tabindex="-1"
                      aria-label={`${source.label} ${source.activity.heading} range`}
                      onkeydown={(event) =>
                        onRadioKeydown(
                          event,
                          seriesRanges,
                          range,
                          (next) => (ranges[source.key] = next as SeriesRange)
                        )}
                    >
                      {#each seriesRanges as candidate}
                        <button
                          type="button"
                          class="usage-view"
                          role="radio"
                          aria-checked={range === candidate}
                          tabindex={range === candidate ? 0 : -1}
                          onclick={() => (ranges[source.key] = candidate)}
                        >
                          {candidate}
                        </button>
                      {/each}
                    </div>
                  </div>
                </header>
                {#if source.activity.categories && source.activity.categories.length > 0}
                  <!-- The category lens: the same grid re-read through one
                    accounting category. A second, per-source radio group —
                    vocabularies differ per source, so a panel-global choice
                    would name a lens some source cannot answer. Every key,
                    label, and slot arrives as adapter data; only the
                    always-available total reading is the component's own. -->
                  <!-- Bound here rather than inside the handler: the {#if}
                    above narrows `categories` for the template, but a closure
                    written in an attribute is checked outside that narrowing
                    and would read as possibly-undefined. -->
                  {@const lensKeys = [
                    totalLens,
                    ...source.activity.categories.map((one) => one.key)
                  ]}
                  <div
                    class="usage-views usage-category-views"
                    role="radiogroup"
                    tabindex="-1"
                    aria-label={`${source.label} ${source.activity.noun} category`}
                    onkeydown={(event) =>
                      onRadioKeydown(event, lensKeys, lensOf(source.key), (next) => (lenses[source.key] = next))}
                  >
                    <button
                      type="button"
                      class="usage-view"
                      role="radio"
                      aria-checked={lensOf(source.key) === totalLens}
                      tabindex={lensOf(source.key) === totalLens ? 0 : -1}
                      onclick={() => (lenses[source.key] = totalLens)}
                    >
                      total
                    </button>
                    {#each source.activity.categories as category (category.key)}
                      <button
                        type="button"
                        class="usage-view"
                        role="radio"
                        aria-checked={lensOf(source.key) === category.key}
                        tabindex={lensOf(source.key) === category.key ? 0 : -1}
                        onclick={() => (lenses[source.key] = category.key)}
                      >
                        {category.label}
                      </button>
                    {/each}
                  </div>
                {/if}
                <ContributionGrid
                  {columns}
                  noun={source.activity.noun}
                  {view}
                  label={`${source.activity.label}, ${view} view, ${range} range${
                    lensCategory ? `, ${lensCategory.label} only` : ''
                  }`}
                  fullWidth
                  cardTitle="Tokens used"
                  formatValue={formatMagnitude}
                />
                <!-- Both readings are taken from the WINDOWED cells, never
                  from the lens' output and never from the payload behind it,
                  so the sentence and the graph are the same statement twice.
                  That is also why the category lens needs no sentence of its
                  own: those cells ALREADY carry the category's dailies when
                  one is pressed, so the only thing the lens contributes here
                  is its noun — adapter-built, like every other word this
                  component renders. A category summary built in the adapter
                  would describe the whole capture while the graph drew ninety
                  days of it, which is the exact defect issue 158 moved this
                  sentence out of the adapter to fix.
                  The second line carries the denominator the first
                  structurally cannot: "15 days" is the same phrase whether
                  the reader asked for thirty days or a year, and the two are
                  very different graphs. -->
                <p class="usage-activity-total">
                  {activityReading(
                    windowed,
                    lensCategory ? lensCategory.noun : source.activity.noun,
                    formatMagnitude
                  )}
                </p>
                <p class="usage-activity-coverage">
                  {coverageReading(windowed)}
                </p>
                {#if source.activity.composition && source.activity.composition.length > 0}
                  <!-- The composition strip: how the window's total divides
                    across categories. Identity is never color alone — every
                    segment's category is named in its tooltip, and the rows
                    beneath repeat hue as a chip BESIDE the written label,
                    count, and share. The same integers feed the bar, the
                    rows, and the grid above, so no two readings of this
                    panel can disagree. -->
                  <figure class="usage-composition">
                    <div class="usage-composition-bar" aria-hidden="true">
                      {#each source.activity.composition as share (share.key)}
                        {#if share.weight > 0}
                          <span
                            class="usage-composition-segment"
                            data-category-slot={share.slot}
                            style:flex-grow={share.weight}
                            title={share.tooltip}
                          ></span>
                        {/if}
                      {/each}
                    </div>
                    <figcaption class="usage-composition-rows">
                      {#each source.activity.composition as share (share.key)}
                        <span class="usage-composition-row">
                          <span
                            class="usage-composition-chip"
                            data-category-slot={share.slot}
                            aria-hidden="true"
                          ></span>
                          <span class="usage-composition-label">{share.label}</span>
                          <span class="usage-composition-value">{share.figure}</span>
                        </span>
                      {/each}
                    </figcaption>
                  </figure>
                {/if}
              </section>
            {/if}
          {/if}

          {#if source.insights && source.insights.rows.length > 0}
            <section class="usage-insights">
              <h4 class="usage-section-title">{source.insights.heading}</h4>
              <ul class="usage-insight-rows">
                {#each source.insights.rows as insight (insight.key)}
                  <li class="usage-insight">
                    <span class="usage-insight-label">
                      {insight.label}{#if insight.marked}<span
                          class="usage-recorded"
                          title="recorded out of band, not fetched live">· recorded</span
                        >{/if}
                    </span>
                    <span class="usage-insight-track" aria-hidden="true">
                      <span
                        class="usage-insight-fill"
                        style:inline-size={`${insight.fillPct}%`}
                      ></span>
                    </span>
                    <span class="usage-insight-value">
                      {insight.reading}
                    </span>
                  </li>
                {/each}
              </ul>
            </section>
          {/if}
        </section>
      {/each}
    {/if}
  </PanelShell>
</aside>

<style>
  /* An ordinary block in the page's panel stack. This panel used to be the
     only one laid out in the document, so it centred itself and reserved its
     own page padding; the stack owns both now, and a panel that decided its
     own page position would fight whatever the stack decided. */
  .usage-tracker {
    display: block;
  }

  .usage-source {
    display: flex;
    flex-direction: column;
    gap: var(--usage-row-gap, 0.375rem);
  }

  .usage-source + .usage-source {
    margin-block-start: var(--usage-source-gap, 0.75rem);
    padding-block-start: var(--usage-source-gap, 0.75rem);
    border-block-start: 1px solid var(--panel-border, rgb(23, 23, 23));
  }

  .usage-source-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .usage-source-label {
    margin: 0;
    font-size: var(--panel-font-size, 0.8125rem);
    font-weight: 650;
    letter-spacing: 0.02em;
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .usage-account {
    font-size: var(--panel-badge-size, 0.6875rem);
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  /* Two columns of tiles; a final odd tile spans the row, which is exactly
     the 2x2-plus-one-wide arrangement the owner's reference shows, with no
     per-tile layout data and no count-dependent branching. */
  .usage-tiles {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--usage-tile-gap, 0.375rem);
  }

  .usage-tile {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-block-size: 3.25rem;
    padding: var(--usage-tile-padding, 0.5rem 0.625rem);
    background: var(--usage-tile-surface, var(--panel-tip-surface, rgb(23, 23, 23)));
    border: 1px solid var(--panel-border, rgb(23, 23, 23));
    border-radius: var(--usage-tile-radius, 8px);
  }

  .usage-tile:last-child:nth-child(odd) {
    grid-column: 1 / -1;
  }

  .usage-tile-value {
    font-size: var(--usage-tile-value-size, 1.125rem);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1.15;
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .usage-tile-label {
    font-size: var(--panel-badge-size, 0.6875rem);
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .usage-recorded {
    font-style: italic;
  }

  .usage-windows {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--usage-window-gap, 0.5rem);
  }

  .usage-window {
    display: flex;
    flex-direction: column;
    gap: var(--usage-row-gap, 0.375rem);
  }

  .usage-window-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .usage-period {
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .usage-reset {
    font-size: var(--panel-badge-size, 0.6875rem);
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .usage-meter {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    --usage-meter-fill-color: var(--usage-meter-ok, var(--panel-status-ok, rgb(94, 171, 94)));
  }

  .usage-meter[data-severity='warning'] {
    --usage-meter-fill-color: var(
      --usage-meter-warning,
      var(--panel-status-stale, var(--panel-accent, rgb(220, 138, 0)))
    );
  }

  .usage-meter[data-severity='critical'] {
    --usage-meter-fill-color: var(--usage-meter-critical, rgb(208, 59, 59));
  }

  /* The unfilled track is a faint step of the fill's own color — same-ramp,
     so the meter's state reads across the whole bar, not just the filled
     part. The plain declaration above the color-mix is the fallback for
     engines without color-mix support; the value label carries the reading
     either way. */
  .usage-meter-track {
    flex: 1;
    block-size: var(--usage-meter-thickness, 0.375rem);
    border-radius: 999px;
    overflow: hidden;
    background: var(--panel-border, rgb(23, 23, 23));
    background: color-mix(
      in srgb,
      var(--usage-meter-fill-color) var(--usage-meter-track-strength, 24%),
      var(--usage-meter-track-base, transparent)
    );
  }

  .usage-meter-fill {
    block-size: 100%;
    border-radius: inherit;
    background: var(--usage-meter-fill-color);
  }

  /* The utilization figure is always visible and wears the text token, never
     the fill color; tabular figures keep the small column of percentages
     aligned across a source's windows. */
  .usage-meter-value {
    min-inline-size: 2.75rem;
    text-align: end;
    font-variant-numeric: tabular-nums;
    font-size: var(--panel-badge-size, 0.6875rem);
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .usage-pairs {
    margin: 0;
    display: flex;
    gap: var(--usage-pair-gap, 0.75rem);
  }

  .usage-pair-label {
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .usage-pair-value {
    font-weight: 650;
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .usage-activity,
  .usage-insights {
    display: flex;
    flex-direction: column;
    gap: var(--usage-row-gap, 0.375rem);
  }

  /* How wide one day may be drawn once a reader picks a short range (issue
     158). The strip stretches to the card, which is right for a year and
     wrong for a month — five columns divided a 914px card into 88px cells,
     and a day nine times wider than it is tall reads as a bar chart nobody
     asked for. Twice the cell's own height is the bound: wide enough that a
     thirty-day window still fills a legible block rather than a stamp in the
     corner, narrow enough that a cell stays a cell. The token is read by
     ContributionGrid's full-width rule, whose own default never binds, so
     this is the token panel's decision and no other grid's. */
  .usage-activity {
    --grid-day-max: 1.25rem;
  }

  .usage-activity-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .usage-section-title {
    margin: 0;
    font-size: var(--panel-font-size, 0.8125rem);
    font-weight: 650;
    color: var(--panel-text, rgb(230, 230, 230));
  }

  /* The two segmented pills share one wrapping row (issue 158). They wrap as
     a pair rather than as eight loose buttons, so a narrow card breaks
     BETWEEN the lens and the range instead of splitting either group across
     two lines — a segmented control with three segments on one row and one on
     the next stops reading as one control. */
  .usage-controls {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--usage-row-gap, 0.375rem);
  }

  .usage-views {
    display: inline-flex;
    padding: 2px;
    border-radius: 999px;
    background: var(--usage-tile-surface, var(--panel-tip-surface, rgb(23, 23, 23)));
    border: 1px solid var(--panel-border, rgb(23, 23, 23));
  }

  /* Segments are 44px on BOTH axes so the pill clears the repository's
     touch-target floor; the visual pill stays compact through the
     transparent padding.

     The inline floor is not belt-and-braces, and it is not what shipped:
     the lens words ("daily", "cumulative") carried their own width, so a
     block-size floor alone read as sufficient until the range pills arrived
     beside them. MEASURED in all five rendering lanes: "30d" drew 40.78px
     wide — three characters plus 0.625rem of padding either side — which is
     the touch floor failing on the axis nobody had a short enough label to
     test. A floor that depends on the length of a word is not a floor. */
  .usage-view {
    min-block-size: 2.75rem;
    min-inline-size: 2.75rem;
    padding-inline: 0.625rem;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--panel-muted, rgb(158, 158, 158));
    font: inherit;
    font-size: var(--panel-badge-size, 0.6875rem);
    text-transform: lowercase;
    cursor: pointer;
  }

  .usage-view[aria-checked='true'] {
    background: var(--usage-view-active, var(--panel-surface, rgb(40, 40, 40)));
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .usage-view:focus-visible {
    outline: 1px solid var(--panel-accent, rgb(220, 138, 0));
    outline-offset: -1px;
  }

  .usage-activity-total {
    margin: 0;
    font-size: var(--panel-badge-size, 0.6875rem);
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  /* The category lens row reuses the segmented-pill pattern above and may
     carry more segments than fit one line on a narrow viewport, so it wraps
     instead of forcing horizontal body scroll. */
  .usage-category-views {
    align-self: flex-start;
    flex-wrap: wrap;
  }

  /* The composition strip. Category hues resolve from the global tokens
     (--usage-cat-1..5, one fixed slot per category key; slot 0 is the
     neutral for keys outside the canonical vocabulary), with dark-native
     fallbacks like every other color in this file. Values are never encoded
     by color alone: each segment is named in its tooltip and each row pairs
     the chip with the written label, count, and share. */
  .usage-composition {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--usage-row-gap, 0.375rem);
  }

  .usage-composition-bar {
    display: flex;
    gap: 2px;
    block-size: var(--usage-composition-thickness, 0.5rem);
    border-radius: 999px;
    overflow: hidden;
  }

  .usage-composition-segment {
    flex-basis: 0;
    min-inline-size: 2px;
    border-radius: 2px;
  }

  .usage-composition-chip {
    inline-size: 0.625rem;
    block-size: 0.625rem;
    border-radius: 2px;
    flex: none;
  }

  .usage-composition-segment[data-category-slot='0'],
  .usage-composition-chip[data-category-slot='0'] {
    background: var(--usage-cat-0, rgb(110, 110, 110));
  }

  .usage-composition-segment[data-category-slot='1'],
  .usage-composition-chip[data-category-slot='1'] {
    background: var(--usage-cat-1, rgb(63, 129, 217));
  }

  .usage-composition-segment[data-category-slot='2'],
  .usage-composition-chip[data-category-slot='2'] {
    background: var(--usage-cat-2, rgb(184, 126, 31));
  }

  .usage-composition-segment[data-category-slot='3'],
  .usage-composition-chip[data-category-slot='3'] {
    background: var(--usage-cat-3, rgb(31, 158, 125));
  }

  .usage-composition-segment[data-category-slot='4'],
  .usage-composition-chip[data-category-slot='4'] {
    background: var(--usage-cat-4, rgb(138, 104, 216));
  }

  .usage-composition-segment[data-category-slot='5'],
  .usage-composition-chip[data-category-slot='5'] {
    background: var(--usage-cat-5, rgb(207, 85, 133));
  }

  .usage-composition-rows {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    font-size: var(--panel-badge-size, 0.6875rem);
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .usage-composition-row {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
  }

  /* Figures wear the text token, never the series color (dataviz floor). */
  .usage-composition-value {
    font-variant-numeric: tabular-nums;
    color: var(--panel-text, rgb(230, 230, 230));
  }

  /* The coverage line sits one step quieter than the summary above it: it
     answers a question the reader has only after reading that sentence, and
     giving the two identical ink would make the pair read as one paragraph
     of equal claims. Same tabular figures as every other count on this card,
     so the ratio's digits do not dance as the window changes. */
  .usage-activity-coverage {
    margin: 0;
    font-size: var(--panel-badge-size, 0.6875rem);
    font-variant-numeric: tabular-nums;
    color: var(--usage-coverage-ink, var(--panel-muted, rgb(158, 158, 158)));
    opacity: var(--usage-coverage-strength, 0.8);
  }

  .usage-insight-rows {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--usage-row-gap, 0.375rem);
  }

  .usage-insight {
    display: grid;
    grid-template-columns: minmax(6rem, auto) 1fr auto;
    align-items: center;
    gap: 0.5rem;
    block-size: 1.25rem;
    font-size: var(--panel-badge-size, 0.6875rem);
    color: var(--panel-muted, rgb(158, 158, 158));
  }

  .usage-insight-track {
    block-size: var(--usage-meter-thickness, 0.375rem);
    border-radius: 999px;
    overflow: hidden;
    background: var(--panel-border, rgb(23, 23, 23));
  }

  .usage-insight-fill {
    display: block;
    block-size: 100%;
    border-radius: inherit;
    background: var(--usage-insight-fill, var(--panel-accent, rgb(220, 138, 0)));
  }

  .usage-insight-value {
    font-variant-numeric: tabular-nums;
    color: var(--panel-text, rgb(230, 230, 230));
  }

  .usage-empty {
    margin: 0;
    font-style: italic;
    color: var(--panel-muted, rgb(158, 158, 158));
  }
</style>
