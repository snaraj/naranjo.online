<!-- EntryLog renders a feed of titled entries, each one a FeedCard (the ONE
  card primitive, issue 136). It is a generic primitive with NO domain
  knowledge — every title, byline, link, counter and summary arrives through
  EntryLogProps (lib/blocks.ts), built by an adapter in the binding layer.
  The work history and the coding-project list are both this component today,
  bound to different data; a reading log is this component tomorrow without
  an edit here.

  An entry comes in two shapes, and the shape is decided by its data:

  UNLINKED — a title, an optional byline, a summary. The card's own title
  region renders them, at the heading depth the log declares, so the entry
  reads as a plain record.

  LINKED — the title is outbound navigation, optionally with a drawn mark
  before it and counters beside it. That is not something a title string can
  express, so this component supplies the card's header region itself, which
  is exactly what the header snippet is for.

  Nothing here is fetched, and nothing here styles a card: every border,
  radius, padding and type step comes from the --card-* tokens in styles.css,
  so the log moves with the rest of the page when one of them changes. An
  href reaches the DOM only as the anchor's value — text is never rendered as
  markup — and no request is made for it from this page.

  The glyphs are drawn here, in the same language as the page's own chrome — a
  24-unit box, currentColor, round caps — rather than vendored from anyone's
  icon set: a third-party mark would need its license reviewed and its
  attribution recorded, and none of that buys a reader anything a plain glyph
  does not. Every glyph is decorative: the figure and the word it counts are
  rendered as text beside it, so nothing on this card is carried by a picture
  alone.

  EVERY COUNTER RENDERS TERSELY — the glyph and the bare figure — and that is
  the one place the words leave the visible surface (issue 252 for two of them,
  issue 268 for all of them: the owner asked for icon and number, with the
  sentence one interaction away). They do not leave the DOM: the complete
  sentence moves into a clipped span that every screen reader still reads, the
  visible figure is marked aria-hidden so it is not announced twice, and the
  FIGURE is still drawn. The dataviz floor is intact — a value here is never
  carried by the glyph alone, only ever by glyph plus number — and so is the
  accessible name. Hiding the number instead of the words would have broken
  both.

  THE SENTENCE IS ONE INTERACTION AWAY, through the page's one detail
  primitive (DetailTip, issue 136 rule 1) and with the stat tiles' exact
  affordance: hover, touch and keyboard focus all reach the same readout, so
  the counter is a focus stop the same way a stat tile is. That is also where a
  figure's PROVENANCE now lives — the inline italic mark the owner removed from
  every visible row ("stale, static and ugly") is a row inside the detail,
  worded by the one constant both panels read (`recordedOutOfBand`,
  lib/blocks.ts).

  A COUNTER CAN BE ALIVE (issue 268). One that declares `since` is an age
  rather than a tally, and this component re-derives its figure, its words and
  its detail from that instant on a MINUTE-ALIGNED tick — msUntilNextMinute in
  lib/age.ts, so every card on the page turns over together on the wall-clock
  minute rather than each drifting by whenever its own timer started. One timer
  serves the whole log, and only when the log actually holds a live counter.
  Nothing moves when it fires: the counter row's tracks are equal fractions, so
  a figure that grows from "9m" to "10m" widens no column and shifts no card.

  A placeholder entry says so in the DOM (`data-placeholder`), because the
  honest-states floor is what stops a page from presenting filler under a
  real heading as though it described a real record. -->
<script lang="ts">
  import { ageDetail, msUntilNextMinute, relativeAge } from '../age.ts';
  import DetailTip from './DetailTip.svelte';
  import FeedCard from './FeedCard.svelte';
  import type { EntryCount, EntryLogEntry, EntryLogProps } from '../blocks.ts';

  let { entries, variant, titleLevel = 3 }: EntryLogProps = $props();

  /* The clock the live counters read. State rather than a plain read, because
     the whole point is that it MOVES while the page is open. */
  let now = $state(Date.now());

  /* Whether anything on this log is an age. A log of tallies alone — the work
     history — arms no timer at all, so the cost of this feature is paid only
     where the feature is used. */
  const ticking = $derived(
    entries.some((entry) => (entry.counts ?? []).some((count) => count.since !== undefined))
  );

  /* ONE timer for the log, re-armed to the next wall-clock minute each time.
     `now` is written here and never read here, deliberately: reading it would
     make this effect its own dependency, so every tick would tear the timer
     down and build a new one — a self-restarting loop whose alignment drifts
     by the time it takes to run. The dependency is `ticking` alone. */
  $effect(() => {
    if (!ticking) {
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        now = Date.now();
        schedule();
      }, msUntilNextMinute());
    };
    schedule();
    return () => clearTimeout(timer);
  });

  /* One counter as it should read RIGHT NOW. A counter with no `since` is
     already exactly what its adapter built and passes through untouched; an
     age is re-derived — figure, words and detail together, from the one module
     that formats all three — so the three can never disagree about the same
     instant. */
  function liveCount(count: EntryCount, at: number): EntryCount {
    if (count.since === undefined) {
      return count;
    }
    const age = relativeAge(count.since, at);
    return {
      ...count,
      label: age.phrase,
      value: age.compact,
      detail: ageDetail(count.since, at, count.marked)
    };
  }
</script>

<ol class="entry-log" data-variant={variant}>
  {#each entries as entry (entry.key)}
    <li data-placeholder={entry.placeholder ? 'true' : undefined}>
      {#if entry.href}
        <FeedCard {variant}>
          {#snippet header()}
            <div class="entry-head">
              <svelte:element this={`h${titleLevel}`} class="entry-heading">
                <a
                  class="entry-link"
                  href={entry.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={entry.linkLabel}
                >
                  {#if entry.glyph === 'code'}
                    <svg class="entry-glyph" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        d="M9.5 7 4.5 12l5 5"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                      <path
                        d="M14.5 7l5 5-5 5"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  {/if}
                  <span class="entry-name">{entry.title}</span>
                </a>
              </svelte:element>
              {#if entry.counts && entry.counts.length > 0}
                <ul class="entry-counts">
                  {#each entry.counts as raw (raw.key)}
                    {@render counter(liveCount(raw, now))}
                  {/each}
                </ul>
              {/if}
            </div>
          {/snippet}
          {@render body(entry)}
        </FeedCard>
      {:else}
        <!-- titleHref is NOT the linked branch above (issue 243). That branch
          replaces the whole header region — a title, its counters, no byline —
          which is right for a repo card and wrong for a role, whose byline
          carries the span and the place. This one keeps the ordinary card and
          only makes its heading navigable. An entry with neither renders
          exactly what it always did. -->
        <FeedCard
          {variant}
          title={entry.title}
          titleHref={entry.titleHref}
          byline={entry.byline}
          {titleLevel}
        >
          {@render body(entry)}
        </FeedCard>
      {/if}
    </li>
  {/each}
</ol>

<!-- ONE counter: the glyph, the bare figure, the clipped sentence behind it,
  and the shared detail. It is a snippet rather than markup inside the each
  block so the LIVE reading is substituted before anything is drawn — the
  counter this renders is the one liveCount just derived, which is why nothing
  below has to know whether its subject ticks.

  Focusable, with the stat tiles' exact affordance: there is no action to
  perform, so a button would be the wrong semantics, but a detail no keyboard
  can reach is half the feature. -->
{#snippet counter(count: EntryCount)}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <li class="entry-count" tabindex="0">
    {#if count.glyph === 'node'}
      <svg class="entry-glyph" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="2" />
        <path
          d="M3.5 12h5.1M15.4 12h5.1"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
    {:else if count.glyph === 'issue'}
      <!-- An open issue: the ring-and-dot every code host
        draws for one. -->
      <svg class="entry-glyph" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="2" />
        <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      </svg>
    {:else if count.glyph === 'pull'}
      <!-- An open pull request: a branch leaving one line
        and arriving at another, arrowhead at the join. -->
      <svg class="entry-glyph" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <circle cx="6.6" cy="6" r="2.6" fill="none" stroke="currentColor" stroke-width="2" />
        <circle cx="6.6" cy="18" r="2.6" fill="none" stroke="currentColor" stroke-width="2" />
        <circle cx="17.4" cy="18" r="2.6" fill="none" stroke="currentColor" stroke-width="2" />
        <path
          d="M6.6 8.6v6.8M17.4 15.4V6.6"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
        <path
          d="M14.2 9.8l3.2-3.2 3.2 3.2"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    {:else if count.glyph === 'clock'}
      <svg class="entry-glyph" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="2" />
        <path
          d="M12 7.6V12l3.2 2.2"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    {:else}
      <svg class="entry-glyph" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"
          fill="currentColor"
        />
      </svg>
    {/if}
    <span class="entry-count-text" aria-hidden="true">{count.value}</span>
    <span class="entry-count-words">{count.label}</span>
    <DetailTip detail={count.detail} />
  </li>
{/snippet}

<!-- One entry's body, shared by both card shapes above so the linked and the
  unlinked branch cannot grow different bodies. Each region is drawn only when
  the entry has it: a paragraph, a list of points, or both. An entry with
  neither renders an empty body, which is a call site with nothing to say —
  refused for every entry this site ships by tests/sections.test.mjs rather
  than papered over here. Points are TEXT, never markup, exactly like every
  other value on this card. -->
{#snippet body(entry: EntryLogEntry)}
  {#if entry.summary}
    <p class="entry-summary">{entry.summary}</p>
  {/if}
  {#if entry.points && entry.points.length > 0}
    <ul class="entry-points">
      {#each entry.points as point (point)}
        <li>{point}</li>
      {/each}
    </ul>
  {/if}
{/snippet}

<style>
  .entry-log {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: var(--feed-gap);
  }

  /* Deterministic by viewport, never by content (issue 188), and since the
     owner's 2026-08-29 alignment ruling ("even if the information presented
     is different it should not differ in the layout") ONE shape at every
     width: the title on its own line, the counters on the line below. The
     inline title/counters row this rule used to flip to above
     --breakpoint-card-meta is gone, because it is what made cross-card
     alignment impossible — each card's counters started wherever its own
     title ended, so the same five columns landed at seven different x
     positions (MEASURED at 1440px: first cells at 474..509px across the
     seven cards, one card's fifth cell wrapped to a second line). With the
     counters on their own full-width line, the columns below can align
     card to card, and no title's length enters any placement decision. */
  .entry-head {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--card-meta-gap);
    /* The head is the counters' SIZE CONTAINER, and this declaration does
       two load-bearing jobs at once. It lets the table below switch on the
       width the card actually has — the reader can narrow the reading
       column far under any viewport breakpoint (ColumnHandles), and a
       viewport query rendered the 788px table into a 288px card — and its
       inline-size containment is what stops the five fixed tracks
       propagating as min-content into the page column itself: MEASURED
       before it, a 20rem column was forced out to 806px and the document
       scrolled sideways in every engine, WebKit surviving every other
       cure. An engine without container queries never matches the block
       below and keeps the ledger, which is degradation to less, not to
       broken. */
    container-type: inline-size;
  }

  .entry-heading {
    margin: 0;
    font-family: var(--card-title-family);
    font-size: var(--card-meta-size);
    font-weight: var(--card-title-weight);
  }

  /* The link is the whole touch target: 44px of block size from the floor,
     with the padding pulled back on the inline start so the glyph still lines
     up with the description under it. The size is a MINIMUM rather than a
     fixed box — a reader who enlarges their base font gets a taller target,
     never a clipped one.

     The resting underline is gone (owner directive, 2026-08-25: the repo
     card titles "rendered underlined" and the owner wants no always-on
     underline anywhere on the site). This rule used to TINT the browser's
     default underline rather than remove it, which is why three card titles
     shipped ruled off under a heading.

     The a11y position is the one .section-link already rests on, and it is
     about channels rather than taste: identifying a link by color alone
     serves fewer readers, so a resting link here is identified by POSITION
     and ROLE before color enters — a card TITLE, at the card's own title
     type step and weight, in the header region of every entry, where this
     feed puts nothing else. None of these links sits in running prose, which
     is the case the underline convention exists for. And the moment intent
     is shown the mark returns: hover and keyboard focus both add the
     underline back along with the brand ink, and focus-visible keeps the
     site-wide ring below untouched. */
  .entry-link {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-block-size: 2.75rem;
    min-inline-size: 2.75rem;
    padding-inline-end: 0.5rem;
    color: var(--card-ink);
    text-decoration: none;
    text-underline-offset: 0.2em;
  }

  .entry-link:hover .entry-name,
  .entry-link:focus-visible .entry-name {
    color: var(--color-brand);
    text-decoration: underline;
  }

  .entry-link:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .entry-glyph {
    flex: none;
    color: var(--card-meta-ink);
  }

  .entry-name {
    /* A name is one token and must not be broken across lines by a hyphen
       the name does not have; on a 320px card it scrolls nothing because the
       flex row is allowed to shrink under it. */
    overflow-wrap: anywhere;
    font-size: var(--card-title-size);
    letter-spacing: var(--card-title-tracking);
  }

  /* THE COUNTERS ARE A TABLE THAT HAPPENS TO SIT ON SEVEN CARDS (owner,
     2026-08-29: "the columns of information are not aligned... it should not
     differ in the layout, makes it look uneven"). Cards are separate DOM
     containers, so cross-card alignment has to be deliberate: every card's
     row is a grid over the SAME tracks — --entry-count-columns, one token
     declared in styles.css — stretched to the card's full width, so column N
     starts at the identical x on every card whatever figure it holds.

     EQUAL FRACTIONS since issue 268, and that is a simplification the terse
     counters earned. The five tracks used to be five hand-measured widths,
     each sized from the widest realistic content of its own column with every
     provenance mark showing; with the words and the mark gone from the visible
     row there is no content left for a track to be sized FROM, so the honest
     answer is the one that depends on no content at all. `repeat(5, minmax(0,
     1fr))` aligns every card by construction — five equal shares of whatever
     width the card has — and it is also what makes the live age counter
     zero-CLS: a figure that grows from "9m" to "10m" changes no track, because
     no track is measured from a figure. The old `justify-content:
     space-between` went with them: it distributed the surplus of fixed tracks,
     and equal fractions leave no surplus to distribute.

     Below --breakpoint-entry-columns the tracks do not fit, and the fallback
     is the same answer stacked cards already give: a single-column ledger,
     one counter per line, every line starting at the card's edge — aligned
     across cards by construction, no wrap deciding anything. The one row
     that outgrows a narrowed reading column scrolls inside itself (the
     page's standing rule for wide content) rather than bending the card. */
  .entry-counts {
    margin: 0;
    padding: 0;
    list-style: none;
    /* A PERCENTAGE, and it is the load-bearing declaration (MEASURED): a
       grid's min-content contribution is its tracks', so a plain stretch
       forced the whole page column out past its own token whenever the reader
       narrowed it below the table — the document scrolled sideways by the
       difference (1286 against a 1280 viewport at a 20rem column token, when
       the tracks were five fixed widths totalling 788px). A percentage size
       contributes ZERO to intrinsic sizing, so the column keeps whatever width
       its own token says and the row scrolls inside itself instead — the same
       trap the gallery's dot row records in MediaGallery.svelte, met on the
       other axis. It stays load-bearing under the 1fr tracks: `minmax(0, 1fr)`
       floors each track at zero, and a zero-minimum track set is exactly the
       shape a reader can narrow into nothing. */
    inline-size: 100%;
    display: grid;
    gap: var(--card-meta-gap);
  }

  @container (min-width: 28rem) {
    .entry-counts {
      grid-template-columns: var(--entry-count-columns, repeat(5, minmax(0, 1fr)));
      overflow-x: auto;
    }
  }

  /* One counter: the glyph, the figure, and the shared detail hanging off the
     whole cell. `display: flex` rather than `inline-flex` so the cell IS its
     track — the last column then ends at the card's own right edge, which is
     the owner's no-dead-space rule as the browser lanes measure it (a
     shrink-to-fit cell would end wherever its two digits did, most of a track
     short). The visible content still sits at the track's start, so the five
     columns line up card to card exactly as before.

     `flex-wrap: wrap` is the enlarged-base-font safety valve: a glyph and a
     figure fit one line at every shipped size, but a reader who doubles their
     text gets a second line rather than a clipped one. */
  .entry-count {
    /* The containing block for the clipped words below, so a 1px out-of-flow
       box is anchored inside the counter it belongs to rather than to whatever
       positioned ancestor it would otherwise find. It is NOT a containing
       block for the detail beside it: DetailTip is `position: fixed`, which
       `position: relative` does not capture, so the tip is still clamped to
       the viewport by lib/tooltip.ts exactly as it is on a stat tile. */
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3125rem;
    font-size: var(--card-meta-size);
    /* A digit may not jitter the column it sits in — and since the freshness
       counter now ticks in real time, that is a live requirement rather than a
       precaution: "9m" becoming "10m" every minute would nudge everything
       beside it on every card, once a minute, forever. */
    font-variant-numeric: tabular-nums;
    color: var(--card-meta-ink);
  }

  /* Every counter is a focus stop, so every counter wears the same ring —
     the twin of .stat-cell's in StatTracker.svelte, because the affordance the
     owner asked for ("like the token count on the other trackers") is that
     one. Scoped per component because Svelte scopes styles, so the two are
     twins rather than one shared rule. */
  .entry-count:focus-visible {
    outline: 1px solid var(--color-accent);
    outline-offset: 2px;
  }

  .entry-count-text {
    white-space: nowrap;
  }

  /* The words behind a terse counter (issue 252; every counter since issue
     268). HIDDEN BY CLIPPING, never by `display: none` or `hidden`, both of
     which would take the text out of the accessibility tree entirely and leave
     the glyph carrying the meaning alone — which is the failure this span
     exists to prevent. It contributes no box: absolutely positioned out of
     flow, so it adds nothing to the card's min-content width and cannot push
     the panel column past a 320px phone. */
  .entry-count-words {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* The measure token, which now resolves to `none` (owner directive
     2026-08-26, issue 212: a summary fills the card and stops at its padding,
     never two thirds of the way across it). The declaration stays because the
     token is the card primitive's per-instance channel — one card that wants a
     measure back sets --card-measure on itself — and because a component that
     dropped the read would have to grow a fork to get it back. */
  .entry-summary {
    margin: 0;
    max-inline-size: var(--card-measure);
  }

  /* An entry's points, at the card's own body rhythm: the same measure token
     the paragraph reads, the card's body gap between items, and the marker
     pulled just far enough in that a wrapped line still lines up under the
     first word rather than under the bullet. Every length is a token or
     derived from one — nothing here is a value this component chose for
     itself, which is why the 2026-08-26 ruling moved these bullets by editing
     one token and touching no component. */
  .entry-points {
    margin: 0;
    /* Stated rather than inherited: this list sits inside the log's own <ol>,
       so the browser's nesting rule would pick its marker for it — the card
       would change bullet the day the log stopped being an ordered list. */
    list-style-type: disc;
    padding-inline-start: 1.125rem;
    max-inline-size: var(--card-measure);
    display: grid;
    gap: var(--card-body-gap);
  }

  /* The compact log reads its summaries at the meta step — the same line the
     framed log's byline uses — so a dense list stays dense without a second
     copy of the type scale. */
  .entry-log[data-variant='compact'] .entry-summary {
    font-size: var(--card-meta-size);
    line-height: var(--card-body-leading);
  }
</style>
