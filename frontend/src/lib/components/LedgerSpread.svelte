<!-- LedgerSpread is the sheet's paired section — "Ongoing Work" (owner
  direction, 2026-10-16) — the repositories in the left column and every
  commit on every repository in the right, stacked into one column on a phone
  (owner design decision, 2026-09-11, issue 318, option B on the design
  canvas).

  TWO-LINE ENTRIES, NOT A SPREADSHEET (owner direction, 2026-10-16: "show 1
  less entry per but give more information and make it more readable … I am
  not trying to make this larger block in the page"). Each column shows one
  entry fewer than it did, and the height that sixth row took pays for every
  remaining entry's second line:

    * a repository is its NAME, in the sheet's display face, with its figures
      beside it — each mark directly beside the value it labels — and its own
      DESCRIPTION under it, in the reading face;
    * a commit is its SUBJECT, in the reading face, given two lines before it
      ellipsizes rather than the ~45 characters a column of its own allowed,
      and under it WHERE, WHEN and WHICH: the repository, the age and the
      short identity.

  The five-cell head row of marks is gone with the spreadsheet: every figure
  carries its own mark and its own words, so the column wears ONE word, like
  the log beside it.

  ONE LINK PER ENTRY, AND THE ENTRY IS ITS TARGET. A two-line entry cannot hold
  two links that are each a finger's width tall without growing a line, which
  is the height the direction asked the section not to spend — so a repository
  entry is one link (its name and description both), a commit entry is one
  link (its subject and supporting line both), and the commit's repository is
  text. The figures beside a repository's name are not inside its link: they
  are focus stops of their own, laid over the link's box, because a detail a
  keyboard cannot open is half the feature and nothing interactive may sit
  inside an anchor.

  IT IS ONE COMPONENT, NOT TWO BLOCKS SIDE BY SIDE, and the reason is the
  reserve. The log's box is exactly as tall as the entries the column beside
  it shows, so the section's height is decided before either payload lands;
  two blocks would each have to be told the other's count, which is one fact
  in two places and the way a zero-CLS promise quietly stops being true. Every
  entry is a FIXED pitch for the same reason: a description or a subject of
  any length lands in a box that was already its size.

  THE LOG DOES NOT SCROLL ON A PHONE (owner ruling, 2026-09-12: there it is "an
  endless scroll field that I have to fight out of"). At that width the box
  takes no overflow of its own and shows the first entries with a control under
  them that reveals the rest inline, so the page's own scroll is the only
  scroll a thumb can land on. The control is absent on a desktop, where the box
  keeps its reserve and scrolls inside it, and absent when there is nothing to
  reveal — absent from the DOM rather than hidden by CSS, because a `display:
  none` control is still something a screen reader can be walked into. The
  width is therefore a question the SCRIPT asks, through the same media seam
  the column handles use (lib/columnWidth.ts), and the first render already
  knows the answer.

  IT IS ROWS, NOT A <table>, on both sides: every entry restacks at a phone
  width, and a real table cannot do that without either scrolling sideways
  (which this page does not do) or having its cells re-parented by CSS, which
  takes the table semantics away with it.

  Every figure and every sentence arrives written. The component formats
  nothing, links nothing it was not handed, and names no repository, host or
  vendor: the adapter validated each href and composed each label, and this
  file renders them. The one thing it composes is the ids that tie an entry's
  link to the supporting text it describes itself with — an id is not a word
  a reader sees. -->
<script lang="ts">
  import type { LedgerSpreadProps } from '../blocks.ts';
  import { browserMedia, spreadMediaQuery, watchMedia } from '../columnWidth';
  import DetailTip from './DetailTip.svelte';
  import FeedCard from './FeedCard.svelte';
  import Icon from './Icon.svelte';
  import PanelShell from './PanelShell.svelte';

  let {
    status,
    generatedAt,
    head,
    rows,
    emptyNote,
    logHead,
    logAnchor,
    logListId,
    logRows,
    logNote,
    logDisclosure
  }: LedgerSpreadProps = $props();

  /* The prefix of the ids an entry's link points its description at. Unique
     per instance, so two of these on one page could never describe each
     other's entries. */
  const uid = $props.id();

  /* Whether the sheet is wide enough for two columns — which is also whether
     the log keeps its scrolling reserve or collapses behind a control. Read
     once for the first paint so nothing arrives and then changes, then kept
     current for a reader who rotates a phone or drags a window across the
     breakpoint. */
  let wide = $state(browserMedia(spreadMediaQuery).matches);
  $effect(() => watchMedia(browserMedia, spreadMediaQuery, (matches) => (wide = matches)));

  /* Whether the reader has asked for the whole log. Component-local and never
     persisted: it is an answer to "show me the rest of this list", which is
     about this visit to this screen, and a stored one would decide the page's
     height before a reader has looked at it. It is deliberately NOT reset when
     the width changes — a reader who opened the log and rotated the phone
     asked for the entries, not for the orientation. */
  let expanded = $state(false);

  /* The entries this render draws. A phone with more entries than it shows at
     once draws the first few until the reader presses; every other case draws
     the whole list, which is what keeps the desktop column exactly what it
     was. */
  const shownLogRows = $derived(
    logDisclosure !== undefined && !wide && !expanded
      ? logRows.slice(0, logDisclosure.collapsed)
      : logRows
  );
</script>

<PanelShell {status} {generatedAt}>
  <FeedCard variant="table">
    <div class="ongoing">
      <div class="ongoing-column">
        <div class="ongoing-head"><Icon name="folder" slot="cell" />{head}</div>
        {#if rows.length === 0}
          <p class="ongoing-note">{emptyNote}</p>
        {:else}
          {#each rows as row, index (row.key)}
            <div class="repo-entry">
              {#if row.link.href}
                <a
                  class="repo-link"
                  href={row.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={row.link.label}
                  aria-describedby="{uid}-about-{index}"
                  ><span class="repo-name">{row.link.text}</span><span
                    class="repo-about"
                    id="{uid}-about-{index}">{row.about}</span
                  ></a>
              {:else}
                <div class="repo-plain">
                  <span class="repo-name">{row.link.text}</span><span class="repo-about">{row.about}</span>
                </div>
              {/if}
              <!-- The figures, in the adapter's order and then the age — each
                one a mark with its value right beside it (owner ruling,
                2026-10-15: a figure reads from its own mark), its words
                clipped beside them for the accessibility tree, and its detail
                one focus or hover away. Focusable so the detail's keyboard
                reveal matches its hover reveal; there is no action to perform,
                so a button would be the wrong semantics. -->
              <span class="repo-figures">
                {#each row.counts as count (count.key)}
                  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                  <span class="repo-figure" tabindex="0" aria-label={count.label}>
                    <span class="repo-glyph"><Icon name={count.glyph} slot="cell" /></span>
                    <span class="repo-value">{count.value}</span>
                    <span class="ongoing-clipped">{count.label}</span>
                    <DetailTip detail={count.detail} />
                  </span>
                {/each}
                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                <span class="repo-figure" tabindex="0" aria-label={row.updated.label}>
                  <span class="repo-glyph"><Icon name={row.updated.glyph} slot="cell" /></span>
                  <span class="repo-value">{row.updated.value}</span>
                  <span class="ongoing-clipped">{row.updated.label}</span>
                  <DetailTip detail={row.updated.detail} />
                </span>
              </span>
            </div>
          {/each}
        {/if}
      </div>
      <!-- The log column carries the id its own section used to (issue 287's
        rule: never break a URL). The nav links the section, never this — the
        anchor exists for an address a reader already shared. -->
      <div class="ongoing-column" id={logAnchor}>
        <div class="ongoing-head"><Icon name="commit" slot="cell" />{logHead}</div>
        <!-- The log's box is RESERVED, not grown into: exactly as tall as the
          entries the column beside it shows, so a payload landing a moment
          after first paint lands without moving the page under a reader. The
          empty note sits inside the same box for the same reason, and on a
          phone the reserve holds the collapsed log — its entries AND its
          control — so the arriving payload lands in a box that was already its
          size. -->
        <div class="log-box">
          <div class="log-list" id={logListId}>
            {#if logRows.length === 0}
              <p class="ongoing-note">{logNote}</p>
            {:else}
              {#each shownLogRows as row, index (row.key)}
                <div class="log-entry">
                  {#if row.title.href}
                    <a
                      class="log-link"
                      href={row.title.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={row.title.label}
                      aria-describedby="{uid}-source-{index} {uid}-age-{index}"
                      ><span class="log-message">{row.title.text}</span><span class="log-meta"
                        ><span class="log-source" id="{uid}-source-{index}">{row.source}</span><span
                          class="log-age"
                          id="{uid}-age-{index}">{row.age}</span
                        ><span class="log-mark">{row.mark}</span></span
                      ></a>
                  {:else}
                    <div class="log-plain">
                      <span class="log-message">{row.title.text}</span><span class="log-meta"
                        ><span class="log-source">{row.source}</span><span class="log-age">{row.age}</span><span
                          class="log-mark">{row.mark}</span
                        ></span>
                    </div>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
          <!-- THE PHONE'S DISCLOSURE (owner ruling, 2026-09-12). A real
            <button> carrying `aria-expanded` and naming the list it grows,
            which is what brings keyboard operation and the disclosure role
            with it. Absent on a desktop, and absent when the adapter built no
            disclosure — its way of saying the log holds nothing the collapsed
            list does not show. -->
          {#if logDisclosure !== undefined && !wide}
            <button
              class="log-more"
              type="button"
              aria-expanded={expanded}
              aria-controls={logListId}
              onclick={() => (expanded = !expanded)}
              >{expanded ? logDisclosure.fewer : logDisclosure.more}</button>
          {/if}
        </div>
      </div>
    </div>
  </FeedCard>
</PanelShell>

<style>
  /* THE PITCH IS ARITHMETIC (owner direction, 2026-10-16). Every entry is a
     title line and a supporting line between two paddings, and those four
     lengths are the only numbers its height is made of — so the section's
     height is decided before any payload lands, and five two-line entries fit
     in the height six one-line rows took (each 2.75rem plus its rule). A
     phone holds every log entry at the height of a two-line subject, and
     gives each repository a second line of description and its figures a
     line of their own; those pitches are built from the same four lengths. */
  .ongoing {
    --ongoing-line: 1.25rem;
    --ongoing-sub: 1.125rem;
    --ongoing-pad: 0.5rem;
    --ongoing-gap: 0.25rem;
    --ongoing-head: 2.125rem;
    --ongoing-columns-gap: 2.5rem;
    --ongoing-pitch: calc(var(--ongoing-line) + var(--ongoing-sub) + 2 * var(--ongoing-pad));
    --ongoing-pitch-tall: calc(2 * var(--ongoing-line) + var(--ongoing-sub) + 2 * var(--ongoing-pad));
    /* A REPOSITORY's pitch, which is also what the log beside it reserves
       five of — so the two columns of the sheet are one height at every width
       that lays them side by side. Below the wide sheet it is three lines (the
       name, the description, the figures); the wide sheet and the phone
       restate it below, from the same four lengths. */
    --repo-pitch: calc(
      var(--ongoing-line) + 2 * var(--ongoing-sub) + 2 * var(--ongoing-gap) + 2 * var(--ongoing-pad)
    );
    /* The figure tracks, sized to the longest value each can print at the
       figure size beside its mark: a four-digit tally, a release tag, a
       three-digit tally, a compact age like "12mo". A track narrower than its
       value ellipsizes the value, which is a wrong figure rather than a tight
       one (issue 317). */
    --repo-pull: 3.25rem;
    --repo-tag: 4.75rem;
    --repo-star: 2.5rem;
    --repo-age: 3rem;
    --repo-figures-gap: 0.625rem;

    /* BOTH TRACKS ARE minmax(0, 1fr): equal halves fill the sheet to its
       right edge at every width (the no-dead-space rule), and a zero minimum
       lets each half be exactly the track it was given rather than the width
       of its widest unbreakable line (the no-sideways-scroll floor). */
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0 var(--ongoing-columns-gap);
  }

  /* A column of flex items, each as wide as the column. Not a one-track grid:
     WebKit keeps a grid item's height from an earlier, narrower layout, so a
     head that wrapped at 320px stayed two lines tall at 360px. */
  .ongoing-column {
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
  }

  /* ONE WORD OVER EACH LIST, in the sheet's display face. The rule under it
     is an inset shadow, so it costs the head no height of its own. A MINIMUM,
     because at the narrowest phone the log's words take a second line, and a
     head that clipped them would be a head that says less than it is. */
  .ongoing-head {
    display: flex;
    align-items: center;
    gap: var(--icon-gap);
    min-block-size: var(--ongoing-head);
    padding-block: var(--ongoing-gap);
    box-shadow: inset 0 -1px 0 var(--ledger-rule);
    font-family: var(--font-display);
    font-size: var(--ledger-label-size);
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ledger-muted);
  }

  .ongoing-note {
    margin: 0;
    padding-block: var(--ongoing-pad);
    font-family: var(--font-mono);
    font-size: var(--ledger-figure-size);
    color: var(--ledger-muted);
  }

  /* The words a mark stands for. Clipped rather than removed, so a screen
     reader still hears "1 star" where the eye reads a mark and a number
     (issue 268's terse-counter rule). */
  .ongoing-clipped {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* --- The repositories ---------------------------------------------------- */

  /* BELOW THE WIDE SHEET an entry is three lines: the name, its description,
     and its figures on a line of their own — a column narrower than a name
     plus four figures cannot hold both on one line without ellipsizing the
     name to nothing. Every track is a fixed length, so the entry is the same
     height whatever its description says. */
  .repo-entry {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto var(--ongoing-sub);
    align-content: start;
    row-gap: var(--ongoing-gap);
    block-size: var(--repo-pitch);
    padding-block-end: var(--ongoing-pad);
    box-shadow: inset 0 -1px 0 var(--color-border);
  }

  .repo-entry:hover {
    background-color: var(--ledger-raised);
  }

  /* A grid item's automatic minimum is its MIN-CONTENT, so an entry holding a
     long name or description would refuse to shrink and drag the column past
     the page. Zero as the minimum lets every part be exactly the track it was
     given and ellipsize inside it. Declared on the entries' CHILDREN rather
     than on the link's own class, because the touch-floor sweep reads a
     control class's own size declarations, and a zero there is a control
     declaring itself smaller than the floor — true of the layout box, false
     of the target. */
  .repo-entry > *,
  .log-entry > * {
    min-inline-size: 0;
  }

  .repo-link,
  .repo-plain {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: var(--ongoing-line) var(--ongoing-sub);
    row-gap: var(--ongoing-gap);
    padding-block-start: var(--ongoing-pad);
    color: var(--ledger-ink);
  }

  .repo-link {
    min-block-size: var(--control-target);
    text-decoration: none;
    text-underline-offset: 0.2em;
  }

  .repo-link:hover .repo-name,
  .repo-link:focus-visible .repo-name {
    color: var(--ledger-highlight);
    text-decoration: underline;
  }

  /* The ring is INSET: an outset one on an entry that already reaches its
     column's edge would be drawn outside the column, and on a phone that is
     the document scrolling sideways. */
  .repo-link:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }

  .repo-name {
    min-inline-size: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-family: var(--font-display);
    font-size: 1.0625rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    line-height: var(--ongoing-line);
    color: var(--ledger-ink);
  }

  .repo-about {
    display: block;
    min-inline-size: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-family: var(--font-sans);
    font-size: 0.875rem;
    line-height: var(--ongoing-sub);
    color: var(--ledger-muted);
  }

  /* FOUR DECLARED TRACKS on their own line, so a mark sits at the same x in
     every entry whatever the figure beside it reads (issue 317). Shares of
     the line in the PROPORTION of the wide tracks below, rather than four
     equal quarters: a release tag is the longest value a figure prints, and
     an equal quarter of a phone's line ellipsized "v0.1.95" by a pixel. */
  .repo-figures {
    display: grid;
    grid-template-columns:
      minmax(0, 3.25fr) minmax(0, 4.75fr) minmax(0, 2.5fr) minmax(0, 3fr);
    align-items: center;
    column-gap: var(--repo-figures-gap);
    min-inline-size: 0;
  }

  /* THE MARK, THEN ITS VALUE, hard against it (owner ruling, 2026-10-15:
     "211 [tag]" read as 211 tags). The slack falls after the value, where it
     separates one figure from the next instead of a figure from its own mark. */
  .repo-figure {
    display: grid;
    grid-template-columns: var(--icon-cell) minmax(0, 1fr);
    align-items: center;
    gap: var(--icon-gap);
    min-inline-size: 0;
    font-family: var(--font-mono);
    font-size: var(--ledger-figure-size);
    font-variant-numeric: tabular-nums;
    line-height: var(--ongoing-sub);
    color: var(--ledger-ink);
  }

  .repo-figure:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .repo-glyph {
    display: inline-flex;
    color: var(--ledger-muted);
  }

  .repo-value {
    min-inline-size: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* --- The log ------------------------------------------------------------- */

  /* THE LOG'S BOX IS RESERVED (issue 285's reserve, kept through every
     redesign): exactly as tall as the entries the column beside it shows —
     five repository pitches, `shownProjectRows` in lib/projects.ts,
     recomputed from that constant by tests/activity.test.mjs — so a payload
     that lands a moment after first paint lands without moving the page, and
     the two columns end on one line at every width that sets them side by
     side. IT SCROLLS FOR THE REST ON A DESKTOP
     (owner directive, 2026-09-11, issue 315): the log lists every
     contribution, and a box that grew to fit them would move every section
     under it the moment a payload landed. There is no hint text under the box
     (the no-reading-hints ruling): the scrollbar and the clipped entry are the
     affordance. */
  .log-box {
    block-size: calc(5 * var(--repo-pitch));
    overflow-y: auto;
  }

  /* An entry is at least the pitch, and a subject that needs its second line
     takes it: inside a box whose height is fixed either way, so the page below
     does not move. The rule under an entry is an INSET SHADOW, never a border
     (owner directive, 2026-08-25): a border adds its pixel to every entry's
     box, and five of them push the last entry out of a reserve that is exactly
     five entries tall. */
  .log-entry {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-block-size: var(--ongoing-pitch);
    box-shadow: inset 0 -1px 0 var(--color-border);
  }

  .log-entry:last-child {
    box-shadow: none;
  }

  .log-link,
  .log-plain {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto var(--ongoing-sub);
    align-content: center;
    padding-block: var(--ongoing-pad);
    color: var(--ledger-ink);
  }

  .log-link {
    min-block-size: var(--control-target);
    text-decoration: none;
    text-underline-offset: 0.2em;
  }

  .log-link:hover {
    background-color: var(--ledger-raised);
  }

  .log-link:hover .log-message,
  .log-link:focus-visible .log-message {
    color: var(--ledger-highlight);
    text-decoration: underline;
  }

  .log-link:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }

  /* THE SUBJECT GETS TWO LINES before it ellipsizes (owner direction,
     2026-10-16), and it is set in the reading face because it is prose. The
     plain block and its two-line ceiling come first, so an engine without the
     line clamp still stops at two lines — it only loses the ellipsis. */
  .log-message {
    display: block;
    max-block-size: calc(2 * var(--ongoing-line));
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow-wrap: anywhere;
    font-family: var(--font-sans);
    font-size: 0.9375rem;
    font-weight: 500;
    line-height: var(--ongoing-line);
  }

  /* WHERE, WHEN, WHICH: the repository takes the slack and ellipsizes first,
     and the age and the short identity hold the column's right edge, so the
     line ends where the column does at every width. */
  .log-meta {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    column-gap: 0.75rem;
    min-inline-size: 0;
    line-height: var(--ongoing-sub);
  }

  .log-source {
    min-inline-size: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-family: var(--font-display);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--ledger-ink);
  }

  .log-age,
  .log-mark {
    font-family: var(--font-mono);
    font-size: var(--ledger-figure-size);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--ledger-muted);
  }

  /* THE PHONE LOG'S DISCLOSURE (owner ruling, 2026-09-12). FULL WIDTH AND AT
     THE TOUCH FLOOR, because it is the one thing under the log a finger aims
     at. The width is its grid column's, taken by stretching rather than
     declared here, so the touch-floor sweep can still measure both of its
     axes in pixels. */
  .log-more {
    display: flex;
    align-items: center;
    justify-content: center;
    min-block-size: var(--control-target);
    margin-block-start: var(--ongoing-pad);
    padding: 0;
    border: 1px solid var(--ledger-rule);
    background: none;
    font-family: var(--font-display);
    font-size: var(--ledger-label-size);
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ledger-muted);
    cursor: pointer;
  }

  .log-more:hover {
    background-color: var(--ledger-raised);
    color: var(--ledger-ink);
  }

  .log-more:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }

  /* --- The wide sheet: a repository on two lines ----------------------------- */

  /* FROM 64rem the column holds a name and four figures on ONE line, so a
     repository is two lines like a commit: the name with its figures beside
     it, and the description under both, across the whole column. The link is
     laid over the entry's whole box — name, description and the space under
     the figures — and the figures sit on top of it, so the entry is one
     target and every figure is still a focus stop of its own. */
  @media (min-width: 64rem) {
    .ongoing {
      --repo-pitch: var(--ongoing-pitch);
    }

    .repo-entry {
      grid-template-rows: var(--repo-pitch);
      padding-block-end: 0;
    }

    .repo-link,
    .repo-plain {
      grid-area: 1 / 1;
      grid-template-columns:
        minmax(0, 1fr)
        calc(var(--repo-pull) + var(--repo-tag) + var(--repo-star) + var(--repo-age) + 3 * var(--repo-figures-gap));
      grid-template-rows: var(--ongoing-line) var(--ongoing-sub);
      column-gap: 0.75rem;
      row-gap: 0;
      padding-block: var(--ongoing-pad);
    }

    .repo-about {
      grid-column: 1 / -1;
    }

    .repo-figures {
      position: relative;
      z-index: 1;
      grid-area: 1 / 1;
      justify-self: end;
      align-self: start;
      grid-template-columns: var(--repo-pull) var(--repo-tag) var(--repo-star) var(--repo-age);
      block-size: var(--ongoing-line);
      margin-block-start: var(--ongoing-pad);
    }

    .repo-figure {
      line-height: var(--ongoing-line);
    }
  }

  /* --- The phone ------------------------------------------------------------- */

  @media (max-width: 45rem) {
    /* THE COLUMNS STACK, repositories first (issue 318): one track, and the
       gap that separated them side by side separates them top to bottom. */
    .ongoing {
      --repo-pitch: calc(
        var(--ongoing-line) + 3 * var(--ongoing-sub) + 2 * var(--ongoing-gap) + 2 * var(--ongoing-pad)
      );
      grid-template-columns: minmax(0, 1fr);
      gap: var(--ongoing-columns-gap) 0;
    }

    /* A phone has room for a description's second line, and it is the line
       that says what the repository is. Reserved whether or not the words
       need it, so every entry is one height (the pitch above). The plain
       block and its ceiling come first, for an engine without the line
       clamp. */
    .repo-link,
    .repo-plain {
      grid-template-rows: var(--ongoing-line) calc(2 * var(--ongoing-sub));
    }

    .repo-about {
      max-block-size: calc(2 * var(--ongoing-sub));
      white-space: normal;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
    }

    /* THE LOG IS NOT A SCROLL REGION HERE (owner ruling, 2026-09-12): a box
       that scrolls inside a page that scrolls is two scrolls under one thumb.
       So the box keeps no fixed height and takes no overflow of its own: it
       shows the first entries, a control under them reveals the rest inline,
       and the page's own scroll is the only scroll.

       IT STILL RESERVES, and the reserve is the COLLAPSED log: five entries at
       the phone's pitch plus the control and the gap above it — exactly what
       the box holds the moment a payload lands. A MINIMUM rather than a
       height, because the reader's own press is allowed to grow it; nothing
       else is. The five is `phoneLogRows` in lib/commits.ts, the number the
       component slices with, and tests/activity.test.mjs recomputes this calc
       from it. ONE COLUMN, so the list and the control under it both take the
       log's full width without either declaring a width. */
    .log-box {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      align-content: start;
      block-size: auto;
      min-block-size: calc(5 * var(--ongoing-pitch-tall) + var(--control-target) + var(--ongoing-pad));
      overflow-y: visible;
    }

    /* EVERY ENTRY IS THE TALL PITCH here, whether its subject needs the second
       line or not, so the collapsed reserve above is exact rather than a
       guess about the payload's sentences. */
    .log-entry {
      block-size: var(--ongoing-pitch-tall);
    }

    .log-link,
    .log-plain {
      align-content: start;
    }
  }

  /* Motion exists only where the reader has not asked for less of it: the
     hover paint eases in, and nothing moves. */
  @media (prefers-reduced-motion: no-preference) {
    .repo-entry,
    .repo-link,
    .log-link,
    .log-more {
      transition:
        background-color var(--ledger-hover),
        color var(--ledger-hover);
    }
  }
</style>
