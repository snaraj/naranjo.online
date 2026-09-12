/* The stacked page's sections and the feed primitive they are built from
 * (owner directive, issue 134), reorganized by the block architecture (owner
 * directive, issue 165): the page is ONE manifest of sections and blocks in
 * src/page.ts, each block a generic component bound to an information source
 * through a small adapter.
 *
 * Two kinds of assertion live here and they answer different questions. The
 * pure logic — the manifest constructors, what a nav link points at, which
 * regions a card draws, how a count is worded, what URL a picture resolves
 * to, what props each adapter builds — is EXECUTED, because those are the
 * places a defect would be invisible to a pattern match: a card that renders
 * an empty header band, a link that points at a section nobody rendered,
 * "1 commits", a media URL the origin refuses. The markup and the styling are
 * pinned as source, the way the rest of this suite pins them, because there
 * is no DOM here by contract and the browser lanes in
 * e2e/rendering-lanes.spec.mjs measure the rendered result instead. The
 * manifest itself is pinned as source too: it imports components, so node
 * cannot execute it — the constructors it is written in are executed instead.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import test from 'node:test';

import { relativeAge } from '../src/lib/age.ts';
import { section, sectionHref, sectionOrdinal, staticBlock } from '../src/lib/blocks.ts';
import { spreadFromRem, spreadMediaQuery } from '../src/lib/columnWidth.ts';
import { commitColumnHead, commitColumnId, projectsCommitsProps } from '../src/lib/commits.ts';
import { feedCardRegions, feedCardVariants, formatIsoDate } from '../src/lib/feed.ts';
import {
  roleLedgerProps,
  siteHost,
  workCollapseLabel,
  workEntries,
  workExpandLabel,
} from '../src/lib/work.ts';
import {
  codingProjectsPanelId,
  projectColumns,
  projectHost,
  projectLinkLabel,
  projects,
  projectsCapturedOn,
  projectsEmptyNote,
  projectTableHeads,
  projectTableProps,
  projectUrl,
  shownProjectRows,
} from '../src/lib/projects.ts';
import {
  galleryHeight,
  galleryLicenseNote,
  galleryPhotos,
  gallerySourceLinkLabel,
  galleryWidth,
} from '../src/lib/gallery.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

/* THE ROLE LEDGER'S PROPS ARE A FUNCTION OF ONE RESOLVER (owner ruling,
   2026-09-12, issue 326). Each role's mark is a vendored tile, and turning its
   FILE NAME into the content-hashed URL the build emitted is the bundler's
   job — done in lib/blocks/workHistory.ts, which is therefore not importable
   by plain Node. Handing the adapter a resolver is what keeps it a pure
   function this suite can execute, and the stub below is deliberately NOT the
   identity function: a props object that carried the file name through
   unresolved would still deep-equal the entries, and this way it cannot. */
const markStub = (file) => `resolved:${file}`;
/* The container build ships only frontend/ into the image (Dockerfile), so a
   pin that reads a repository-root file is declared skipped there with its
   reason, exactly as tests/panels-ui.test.mjs declares its attribution pin;
   the full-checkout gate is where the pin is enforced. */
const fullCheckout = existsSync(new URL('../../internal/panels/snapshots', import.meta.url));
const reducedContextNote = fullCheckout
  ? false
  : 'reduced build context ships only frontend/; the full-checkout gate enforces this pin';

const roleLedger = roleLedgerProps(markStub);

/* HTML comments removed, to a fixed point. A pin that reads markup has to read
   the markup: this component explains at length, in prose, the very anchor the
   employer-named-once pin below forbids. One pass is not enough — removing a
   comment can splice a new opener out of the text either side of it — which is
   the incomplete multi-character sanitization CodeQL flags, and looping to a
   fixed point is what makes "removed" mean removed. */
const withoutHtmlComments = (source) => {
  let stripped = source;
  let previous;
  do {
    previous = stripped;
    stripped = stripped.replace(/<!--[\s\S]*?-->/g, ' ');
  } while (stripped !== previous);
  return stripped;
};

/* The ledger's own components (owner directive of 2026-09-03, issue 287):
   EntryLog drew the work history AND the projects feed as cards, and both
   surfaces became ruled rows — a log whose rows open, and a table. Every pin
   that described the card's markup is re-pointed at whichever of the two
   replaced it. */
const [
  app,
  styles,
  manifest,
  feedCard,
  sectionNav,
  pageSectionSource,
  pageHeader,
  blockHost,
  ledgerLog,
  ledgerSpread,
  mediaGallery,
] = await Promise.all([
  read('../src/App.svelte'),
  read('../src/styles.css'),
  read('../src/page.ts'),
  read('../src/lib/components/FeedCard.svelte'),
  read('../src/lib/components/SectionNav.svelte'),
  read('../src/lib/components/PageSection.svelte'),
  read('../src/lib/components/PageHeader.svelte'),
  read('../src/lib/components/Block.svelte'),
  read('../src/lib/components/LedgerLog.svelte'),
  read('../src/lib/components/LedgerSpread.svelte'),
  read('../src/lib/components/MediaGallery.svelte'),
]);

/* The binding modules that introduce each block to the page; they import
 * components, so they are source-pinned rather than executed. */
const workSource = await read('../src/lib/work.ts');

const [workBinding, mediaBinding, projectsBinding, galleryModule] = await Promise.all([
  read('../src/lib/blocks/workHistory.ts'),
  /* Renamed with its section (owner directive of 2026-09-03, issue 287): the
     gallery is the sheet's own last section rather than half of Projects, so
     the block that mounts it is named for the media it carries. */
  read('../src/lib/blocks/mediaGallery.ts'),
  /* Renamed with ITS section too (owner design decision, 2026-09-11, issue
     318): the repositories and the commit log are one two-column block now. */
  read('../src/lib/blocks/projectsCommits.ts'),
  /* The data module is executed above; its SOURCE is read too, because the
     optionality of a TypeScript field is erased before Node ever sees it —
     "this entry has no title" and "this field may be absent" are different
     claims and only one of them survives to runtime. */
  read('../src/lib/gallery.ts'),
]);

/* The generic components this architecture renders the page through. The
   content half is the ledger's five now (owner directive of 2026-09-03, issue
   287) where it used to be the entry log and the gallery; every sweep below
   that walked the old pair walks all of them, so the redesign added surfaces
   to these guards rather than removing any. */
const [contributionCalendar, ledgerBoard, ticker] = await Promise.all([
  read('../src/lib/components/ContributionCalendar.svelte'),
  read('../src/lib/components/LedgerBoard.svelte'),
  read('../src/lib/components/Ticker.svelte'),
]);

const contentComponents = {
  LedgerLog: ledgerLog,
  LedgerSpread: ledgerSpread,
  ContributionCalendar: contributionCalendar,
  LedgerBoard: ledgerBoard,
  Ticker: ticker,
  MediaGallery: mediaGallery,
};

const introduced = {
  FeedCard: feedCard,
  SectionNav: sectionNav,
  PageSection: pageSectionSource,
  PageHeader: pageHeader,
  Block: blockHost,
  ...contentComponents,
};

/* Every component in the tree, discovered by walking it rather than listed by
 * hand, so a component added later is covered without anyone remembering to
 * add it here. */
const componentSources = Object.fromEntries(
  await Promise.all(
    (await readdir(new URL('../src', import.meta.url), { recursive: true }))
      .filter((entry) => entry.endsWith('.svelte'))
      .map(async (entry) => [entry, await read(`../src/${entry}`)])
  )
);

const styleBlock = (source) => /<style[^>]*>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? '';

/* The manifest's section calls, read from the one module the page is. Each
 * captured id, label and mark is then driven through the EXECUTED constructor
 * the manifest is written in, so the assertions bind to the real page rather
 * than to a copy of it.
 *
 * The mark is REQUIRED in the pattern, not optional (owner design decision,
 * 2026-09-11, issue 313): a section that shipped without one would fall out of
 * this list entirely and take its own pins with it, which is the quiet failure
 * an optional capture invites. */
const manifestSections = [...manifest.matchAll(
  /section\('([a-z-]+)', '([^']+)', \[([^\]]*)\], \{\s*mark: '([a-z-]+)'(,\s*layout: 'stack')?\s*\}\)/g
)].map(([, id, label, blocks, mark, stack]) => ({
  id,
  label,
  mark,
  blocks: blocks.split(',').map((name) => name.trim()).filter(Boolean),
  layout: stack ? 'stack' : 'flow',
}));

// ---------------------------------------------------------------------------
// The manifest, the nav, and the sections it points at
// ---------------------------------------------------------------------------

/* FOUR SECTIONS, updated deliberately for the owner's design decision of
 * 2026-09-11 (issue 318, option B on the design canvas): Projects and Commits
 * become ONE section of two columns, and the contribution calendar goes back
 * into the trackers stack between the board and the ticker. The ledger had
 * five since issue 287.
 *
 * The IDS of the surviving sections do not move — an id is the fragment a nav
 * link jumps to and an address a reader may already have shared — and `commits`
 * does not stop resolving just because it stopped being a section: the commit
 * COLUMN carries it, which is pinned below. */
test('the manifest names the owner’s four sections, in the order the page stacks them', () => {
  assert.deepEqual(
    manifestSections.map((entry) => entry.label),
    ['Professional Experience', 'Projects · Commits', 'Trackers', 'Gallery'],
    'the section labels are the owner’s words and their order is the page’s order'
  );
  assert.deepEqual(
    manifestSections.map((entry) => entry.id),
    ['work', 'projects', 'trackers', 'gallery']
  );
  assert.deepEqual(
    manifestSections.map((entry) => entry.blocks),
    [
      ['workHistory'],
      ['projectsCommits'],
      ['tokenBoard', 'contributionCalendar', 'bossTicker'],
      ['mediaGallery'],
    ],
    'each section holds exactly its blocks; reordering the page is moving one name here'
  );
  assert.deepEqual(
    manifestSections.map((entry) => entry.layout),
    ['flow', 'flow', 'stack', 'flow'],
    'the one panel stack is the section whose blocks share one column'
  );
  /* EVERY SECTION CARRIES ITS MARK (owner design decision, 2026-09-11, issue
     313), here in the manifest beside the label it stands for — so the nav
     link and the section head read one entry and cannot draw two different
     marks for one section. The combined section keeps `folder`: it is the
     owner's projects, with what landed in them beside it. */
  assert.deepEqual(
    manifestSections.map((entry) => entry.mark),
    ['work', 'folder', 'chip', 'photo'],
    'each section names the mark the nav and the section head both draw'
  );
  // The constructors the manifest is written in, executed with its own ids:
  // the id in, the id out, the layout defaulted to flow, and the href built
  // by a function rather than concatenated in markup — a lost '#' is one red
  // test instead of four links to the page root.
  for (const entry of manifestSections) {
    const built = section(
      entry.id,
      entry.label,
      [],
      entry.layout === 'stack' ? { mark: entry.mark, layout: 'stack' } : { mark: entry.mark }
    );
    assert.equal(built.id, entry.id);
    assert.equal(built.label, entry.label);
    assert.equal(built.mark, entry.mark, 'the constructor drops the section mark');
    assert.equal(built.layout, entry.layout);
    assert.equal(sectionHref(built), `#${entry.id}`);
  }
  // And a block constructor holds a block together: key, component, binding
  // and presentation survive construction unchanged.
  const marker = () => {};
  const block = staticBlock('probe', marker, { note: 'x' }, { heading: 'H', note: 'N' });
  assert.equal(block.key, 'probe');
  assert.equal(block.component, marker);
  assert.deepEqual(block.binding, { source: 'static', props: { note: 'x' } });
  assert.equal(block.heading, 'H');
  assert.equal(block.note, 'N');
});

/* The removal itself, pinned where it was DECIDED (owner directive,
 * 2026-08-28: "ensure that the 'about me' section is removed"). The manifest
 * is the page's one statement of what it is, so a section coming back is a
 * line here — and the nav, which derives from this same array, cannot
 * re-acquire a link this array does not carry. The two files below left with
 * it rather than lingering unreferenced: the block adapter, and the EmptyNote
 * primitive that adapter was the only caller of. */
test('the empty About Me section is gone, and nothing renders in its place', async () => {
  assert.equal(
    manifestSections.some((entry) => entry.id === 'about'),
    false,
    'the About Me section is back in the manifest'
  );
  assert.doesNotMatch(
    manifest,
    /blocks\/about/,
    'the manifest still imports the About Me block'
  );
  for (const path of ['../src/lib/blocks/about.ts', '../src/lib/components/EmptyNote.svelte']) {
    await assert.rejects(
      () => stat(new URL(path, import.meta.url)),
      /ENOENT/,
      `${path} survived the section it existed for`
    );
  }
});

/* THE OLD ADDRESS KEEPS RESOLVING (issue 287's rule: never break a URL).
 * `#commits` named a section of its own until the owner's design decision of
 * 2026-09-11 (issue 318) paired it with Projects, and a reader who bookmarked
 * or shared that fragment must still land on the commits. So the COLUMN wears
 * the id: the adapter names it once, hands it through as data, and the
 * component renders it on the log's own wrapper.
 *
 * The nav never links it, and that is the other half of the claim — a nav link
 * to a non-section would be a second address for one place, and the nav is
 * derived from the manifest precisely so it cannot invent one. */
test('the retired commits address still lands on the commits, and the nav never links it', () => {
  assert.equal(commitColumnId, 'commits');
  // The adapter hands it through; no component spells it.
  assert.equal(projectsCommitsProps([null, null]).logAnchor, commitColumnId);
  assert.match(ledgerSpread, /<div class="spread-column" id=\{logAnchor\}>/);
  for (const [name, source] of Object.entries(componentSources)) {
    assert.doesNotMatch(source, /id="commits"/, `${name} spells a page address of its own`);
  }
  // And it is not a section any more: the manifest names four, none of them
  // this one, so the nav has nothing to point at it with.
  assert.ok(
    !manifestSections.some((entry) => entry.id === commitColumnId),
    'the commits section came back; the sheet pairs it with Projects now'
  );
});

test('every nav link lands on the section the manifest renders', () => {
  // Structural now, not counted: the nav and the sections read the SAME
  // manifest entry, so a link cannot point at a section nobody rendered.
  assert.match(sectionNav, /import \{ page \} from '\.\.\/\.\.\/page\.ts'/);
  assert.match(sectionNav, /\{#each page as section \(section\.id\)\}/);
  assert.match(sectionNav, /href=\{sectionHref\(section\)\}/);
  assert.match(sectionNav, /class="section-link"/);
  /* A LINK IS ITS SECTION'S WORD (owner ruling, 2026-09-12, issue 325: "put
     back words in here instead of the icons"). The word is the link's own
     text, read from the manifest entry the section renders from, so a section
     renamed renames its link and no component spells either.

     The three things issue 313 put here are pinned ABSENT, each by name,
     because each is a separate way the ruling could be half-undone: a mark
     drawn beside the word, the ordinal printed with it, and the word demoted
     back to an aria-label that only a screen-reader user ever receives. A
     positive pin on the word alone would pass with any of the three back. */
  assert.match(sectionNav, />\{section\.label\}</, 'the nav link no longer prints the section word');
  assert.doesNotMatch(sectionNav, /<Icon\b/, 'the nav link draws a mark again; the owner asked for words');
  assert.doesNotMatch(
    sectionNav,
    /sectionOrdinal|section-link-number/,
    'the nav link prints the sheet number again; the word replaced it'
  );
  assert.doesNotMatch(
    sectionNav,
    /aria-label=\{section\.label\}/,
    'the word is back in an aria-label; it is the link\u2019s own text now'
  );
  /* THE ORDINAL RULE, EXECUTED rather than matched. It has ONE caller since
     the owner's ruling of 2026-09-12 — the page, which numbers the section
     heads — and it stays a shared rule rather than being folded into its one
     caller because the numbering is a property of the sheet, not of the head
     that prints it. Two digits, and the position is the caller's. */
  assert.equal(sectionOrdinal(0), '01');
  assert.equal(sectionOrdinal(4), '05');
  assert.equal(sectionOrdinal(9), '10');
  assert.equal(sectionOrdinal(99), '100', 'the rule pads to two digits, it does not truncate to two');
  assert.match(pageSectionSource, /<section class="page-section" id=\{section\.id\}/);
  /* The ordinal the ledger's section head prints is derived from the
     manifest's own position (owner directive of 2026-09-03, issue 287), so a
     section moved in src/page.ts renumbers itself and two sections can never
     claim the same number. */
  assert.match(
    app,
    /\{#each page as section, position \(section\.id\)\}\s*<PageSection \{section\} ordinal=\{sectionOrdinal\(position\)\} \/>/
  );
  // No component may spell a section of its own beside the manifest: one
  // renderer, zero hardcoded ids, or the counting guarantee above is gone.
  for (const [name, source] of Object.entries(componentSources)) {
    assert.doesNotMatch(
      source,
      /<section class="page-section" id="/,
      `${name} hardcodes a page section beside the manifest`
    );
  }
});

// A tap must not leave the fragment sitting in the URL for a later refresh
// to re-apply (owner report, issue 171). There is no DOM here by contract
// (see the file banner), so this pins the SHAPE of the fix — the browser
// lanes in e2e/rendering-lanes.spec.mjs execute the actual reload behavior
// against a real History API and a real scrollIntoView.
test('a nav tap drops the fragment from the URL instead of the href (issue 171)', () => {
  // The href is untouched: a real fragment link, readable by assistive tech
  // and a genuine deep link when shared or typed directly.
  assert.match(sectionNav, /href=\{sectionHref\(section\)\}/);
  // A modified click (opening in a new tab) must reach the browser's own
  // handling rather than this one.
  assert.match(sectionNav, /event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey/);
  // The scroll happens in script now — never a bare anchor jump, which is
  // the mechanism that left the fragment behind in the first place.
  assert.match(sectionNav, /event\.preventDefault\(\)/);
  assert.match(sectionNav, /\.scrollIntoView\(\)/);
  // The URL is corrected AFTER the scroll, and by REPLACING history rather
  // than pushing it — a pushed entry would put "back" one step behind where
  // the reader actually was.
  assert.match(
    sectionNav,
    /history\.replaceState\(null, '', window\.location\.pathname \+ window\.location\.search\)/
  );
});

// A live probe (see the component's own doc comment) showed the fragment is
// only half the bug: the browser remembers a scroll offset per history entry
// independent of the URL, and replaceState does not clear it — so a refresh
// still restored the reader's old position even with no fragment left to
// reapply. This is the other half of the fix.
test('scroll restoration is turned off once, so a refresh cannot silently reposition the reader (issue 171)', () => {
  assert.match(sectionNav, /history\.scrollRestoration = 'manual'/);
});

test('the page stacks the chrome row, the name and the sections in one column', () => {
  /* THE NAV MOVED INTO THE CHROME ROW (owner directive of 2026-09-03, issue
     287): the ledger's drawing puts the five section links between the
     wordmark and the reading mode, and a nav in a row that is the sheet's own
     top rule stays one line at every width instead of wrapping under a
     masthead that is already the tallest thing on the page. It is the SAME
     component reading the SAME manifest — only its mount point moved — so
     every pin below about what a link is and does is untouched. */
  assert.match(pageHeader, /<SectionNav \/>/, 'the nav is no longer in the chrome row');
  assert.doesNotMatch(app, /<SectionNav/, 'the nav is mounted twice');
  // The name keeps its own block, and the rule the owner asked to be DRAWN
  // under it is part of that block rather than a border somewhere else.
  assert.match(app, /<div class="page-intro">\s*<h1 id="page-title">[^<]+<\/h1>/);
  assert.match(app, /<svg class="masthead-rule"/);
  // The trackers are one section of the page rather than the whole of it, and
  // the panel stack renders behind the manifest's one stack layout.
  assert.match(
    pageSectionSource,
    /\{#if section\.layout === 'stack'\}(?:\s*<!--[\s\S]*?-->)?\s*<div class="panel-stack" data-block-count=\{section\.blocks\.length\}>/,
    'the stack layout must hold the panel stack, and it must declare how many blocks it holds (issue 210)'
  );
  assert.match(
    pageSectionSource,
    /<h2 class="section-title" id=\{`\$\{section\.id\}-title`\}>\{section\.label\}<\/h2>/,
    'every section opens with its manifest label'
  );
  /* The ledger's numbered head wraps that heading (owner directive of
     2026-09-03, issue 287) and the number is drawn BESIDE it, hidden from
     assistive technology: the heading's accessible name is what a screen
     reader navigates the page by, and "01 Professional Experience" is a worse
     name than the label for exactly the reader who cannot see that the sheet
     is numbered. The h2, its class and its id — which the section's own
     aria-labelledby points at — are unchanged. */
  assert.match(
    pageSectionSource,
    /<div class="section-head">(?:\s*<!--[\s\S]*?-->)?\s*<span class="section-number" aria-hidden="true"\s*><Icon name=\{section\.mark\} slot="row" \/>\{ordinal\}<\/span\s*>/,
    'the section head must lead with the manifest mark and the ordinal, both hidden from assistive technology (issue 313)'
  );
  /* A section link has to be a real touch target: 44px on both axes, as a
     minimum rather than a fixed box so an enlarged base font grows it. It
     reads the ledger's one control token now (owner directive of 2026-09-03,
     issue 287) instead of restating the length, so BOTH halves are pinned —
     the link reads the token, and the token is the floor. A link that read a
     token which had quietly become 32px would pass a check on either half
     alone. */
  const link = /\.section-link\s*\{([^}]*)\}/.exec(styles);
  assert.ok(link, 'the section links are not styled where this pin expects them');
  assert.match(link[1], /min-block-size:\s*var\(--control-target\)/);
  assert.match(link[1], /min-inline-size:\s*var\(--control-target\)/);
  assert.match(styles, /--control-target:\s*2\.75rem;/);
});

test('the nav link carries no idle underline, but hover and focus still mark it as a link (issue 157)', () => {
  const idle = /\.section-link\s*\{([^}]*)\}/.exec(styles);
  assert.ok(idle, 'the section links are not styled where this pin expects them');
  assert.match(idle[1], /text-decoration:\s*none/, 'the idle nav link must not carry an underline');

  const hover = /\.section-link:hover\s*\{([^}]*)\}/.exec(styles);
  assert.ok(hover, 'the hover state is not styled where this pin expects it');
  assert.match(
    hover[1],
    /text-decoration:\s*underline/,
    'hover must add back the affordance the idle state no longer carries'
  );
  /* The ink hover reaches for is the ledger's one highlight now (owner
     directive of 2026-09-03, issue 287) rather than the brand orange, which
     the redesign spends on nothing: the sheet is monochrome and the highlight
     is its single chromatic mark. Both are defined tokens in every reading
     mode, so this is a change of which token, never of whether one. */
  assert.match(hover[1], /color:\s*var\(--ledger-highlight\)/, 'hover keeps its ink affordance too');

  // The site's own focus ring must survive this change untouched — a nav
  // link is still a link the moment keyboard focus lands on it.
  const focus = /\.section-link:focus-visible\s*\{([^}]*)\}/.exec(styles);
  assert.ok(focus, 'the focus-visible state is not styled where this pin expects it');
  assert.match(focus[1], /outline:\s*2px solid var\(--color-accent\)/);
  assert.match(focus[1], /outline-offset:\s*2px/);
});

// ---------------------------------------------------------------------------
// The feed card primitive
// ---------------------------------------------------------------------------

/* The owner asked for cards that CAN carry a title, a date and a border later
 * while carrying none of them today. That is a statement about data, not about
 * markup, so both branches of every region are executed here: a component that
 * renders an empty header band for content with no title has failed the
 * requirement just as surely as one that cannot gain a title at all. */
test('a feed card draws exactly the regions its content fills', () => {
  const empty = feedCardRegions({});
  assert.deepEqual(empty, { header: false, meta: false, media: false, body: false, footer: false });

  // The art feed's case today: a picture and nothing else.
  assert.deepEqual(feedCardRegions({ media: true }), {
    header: false,
    meta: false,
    media: true,
    body: false,
    footer: false,
  });

  // The future the owner described: the same card gains a title and a date.
  const titled = feedCardRegions({ title: 'A picture', date: '2026-08-23', media: true });
  assert.equal(titled.header, true);
  assert.equal(titled.meta, true);

  // A title alone opens the header; a byline or a date alone opens the header
  // AND the meta line under it.
  assert.deepEqual(feedCardRegions({ title: 'Only a title' }).meta, false);
  assert.equal(feedCardRegions({ title: 'Only a title' }).header, true);
  assert.equal(feedCardRegions({ byline: 'California, USA' }).meta, true);
  assert.equal(feedCardRegions({ date: '2026-08-23' }).meta, true);

  // An empty string is ABSENT. A call site with no title passes '' as readily
  // as it passes nothing, and a feed of empty heading boxes is the result of
  // treating the two differently.
  assert.deepEqual(feedCardRegions({ title: '', byline: '', date: '' }), empty);

  // A header snippet opens the region on its own — the projects feed puts a
  // link and two counters up there, which no title string could express.
  assert.equal(feedCardRegions({ header: true }).header, true);
  assert.equal(feedCardRegions({ header: true }).meta, false);

  // Body and footer are independent of everything above them.
  assert.equal(feedCardRegions({ body: true }).body, true);
  assert.equal(feedCardRegions({ footer: true }).footer, true);
  assert.equal(feedCardRegions({ footer: true }).header, false);
});

test('the card renders every region behind its own decision', () => {
  assert.match(feedCard, /feedCardRegions\(\{/, 'the card must render from the tested decision');
  for (const region of ['header', 'media', 'body', 'footer']) {
    assert.match(
      feedCard,
      new RegExp(`\\{#if regions\\.${region}\\}`),
      `the ${region} region must be conditional; an always-rendered region costs its padding on every card that does not use it`
    );
  }
  // The header's two halves: a caller-supplied snippet, or the title/meta
  // rendering it replaces.
  assert.match(feedCard, /\{#if header\}\s*\{@render header\(\)\}\s*\{:else\}/);
  assert.match(feedCard, /<time class="feed-card-date" datetime=\{date\}>\{formatIsoDate\(date\)\}<\/time>/);
  // The heading level is a prop: a card is not always at the same depth, and a
  // fixed level breaks the document outline wherever it is not.
  assert.match(feedCard, /this=\{`h\$\{titleLevel\}`\}/);
});

test('a linked card title is an anchor, and the heading around it still names itself', () => {
  /* THE OWNER'S CONSTRAINT FIRST (issue 243): "Do not change the styling...
     instead turn them into links." So the title's TEXT is unchanged — the
     anchor renders `{title}` and nothing else — and the branch is conditional,
     which is what keeps every unlinked card in the repository exactly as it
     was. */
  assert.match(feedCard, /\{#if titleHref\}/, 'the linked title is unconditional; every card grew an anchor');
  const linked = /\{#if titleHref\}([\s\S]*?)\{:else\}/.exec(feedCard)?.[1];
  assert.ok(
    linked !== undefined && linked.includes('<a'),
    'the linked title branch is not where this pin expects it; the scope below would prove nothing'
  );
  assert.match(linked, /href=\{titleHref\}/, 'the card assembles a href instead of rendering the one it was handed');
  assert.match(linked, /target="_blank"/, 'an employer link replaces the page the reader was on');
  assert.match(linked, /rel="noopener noreferrer"/, 'the opened tab can reach back into this page');
  assert.match(linked, /aria-label=\{`\$\{title\} \(opens in a new tab\)`\}/);
  assert.match(linked, />\{title\}<\/a/, 'the anchor renders something other than the plain title');

  /* AND THE HEADING NAMES ITSELF (review finding, 2026-08-28). A heading's
     accessible name is computed from its descendants, and an `aria-label` on a
     descendant REPLACES that descendant's contribution — so without this the
     heading's own name became "<employer> (opens in a new tab)" and the heading
     list a screen-reader user navigates by turned into a list of tab warnings.
     The condition is load-bearing in both directions: an unlinked card must
     name itself from its text exactly as it always has, so the label is
     `undefined` there rather than a second copy of the title. The engine half —
     the name as assistive technology actually computes it — is measured in the
     experience lane of e2e/rendering-lanes.spec.mjs. */
  assert.match(
    feedCard,
    /aria-label=\{titleHref \? title : undefined\}/,
    'the heading no longer names itself, so a linked title renames the heading around it'
  );
});

test('every variant the card admits is a variant it styles', () => {
  const cardStyles = styleBlock(feedCard);
  const [base, ...others] = feedCardVariants;
  assert.equal(base, 'framed', 'the base variant is the one the plain rule paints');
  assert.match(cardStyles, /\.feed-card\s*\{/, 'the base card rule is missing');
  /* A variant may share its rule with a sibling (owner directive of
     2026-09-03, issue 287: the four ledger looks remap the same three tokens
     to nothing and differ only in the one or two they add), so the selector is
     admitted followed by a comma as well as by a brace. What is pinned is
     unchanged: every variant the type admits reaches a rule, and a variant
     that reaches none is a silent no-op. */
  for (const variant of others) {
    assert.match(
      cardStyles,
      new RegExp(`\\.feed-card\\[data-variant='${variant}'\\]\\s*[,{]`),
      `the ${variant} variant maps to no rule; a variant that styles nothing is a silent no-op`
    );
  }
  // A variant may only REMAP tokens. One that restated a value would be a
  // second place to change that value, which is the drift the token layer
  // exists to prevent.
  const variantRules = [
    ...cardStyles.matchAll(/\.feed-card\[data-variant='[a-z]+'\](?:,\s*\.feed-card\[data-variant='[a-z]+'\])*\s*\{([^}]*)\}/g),
  ];
  assert.ok(variantRules.length > 0, 'no variant rule was found; this walk is broken');
  for (const [, body] of variantRules) {
    for (const [, property] of body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)) {
      assert.ok(
        property.startsWith('--'),
        `a variant sets ${property}; a variant remaps the card's tokens and nothing else`
      );
    }
  }
});

test('the card states no value of its own — every dimension is a token', () => {
  const cardStyles = styleBlock(feedCard);
  assert.doesNotMatch(
    cardStyles,
    /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z])|\brgb a?\(/,
    'the card must reference color tokens, never a literal'
  );
  // Lengths and weights too: a hardcoded padding cannot be tuned from the
  // token layer, and the page would drift one component at a time. Custom
  // property DECLARATIONS are exempt — that is what the variants are — and so
  // is the calc that mirrors a token's own sign.
  const declarations = cardStyles
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/[;{}]/)
    .filter((entry) => !/^\s*--/.test(entry));
  for (const declaration of declarations) {
    assert.doesNotMatch(
      declaration,
      /\b\d*\.?\d+(?:px|rem|em|ch|vw|vh)\b/,
      `the card hardcodes a length in "${declaration.trim()}"; add a token instead`
    );
  }
});

test('the card token defaults are global, and resolve through the reading modes', () => {
  const root = /:root\s*\{[^}]*\}/.exec(styles);
  assert.ok(root, 'the token layer is not where this pin expects it');
  // Every dimension the owner named as tweakable has a default here.
  for (const token of [
    '--card-border-width',
    '--card-border-style',
    '--card-border-color',
    '--card-radius',
    '--card-padding',
    '--card-gap',
    '--card-surface',
    '--card-ink',
    '--card-shadow',
    '--card-max-inline-size',
    '--card-media-aspect',
    '--card-media-fit',
    '--card-media-max-block-size',
    '--card-title-family',
    '--card-title-size',
    '--card-title-weight',
    '--card-title-tracking',
    '--card-title-leading',
    '--card-meta-family',
    '--card-meta-size',
    '--card-meta-weight',
    '--card-meta-tracking',
    '--card-meta-leading',
    '--feed-gap',
  ]) {
    assert.match(root[0], new RegExp(`${token}:`), `the token layer is missing ${token}`);
  }
  // Colors resolve THROUGH the reading-mode tokens, never as literals, which
  // is what lets a mode restyle the whole feed without the card knowing a mode
  // exists. (No hex may appear outside this block at all — that is pinned in
  // experience.test.mjs.)
  for (const token of ['--card-surface', '--card-ink', '--card-border-color', '--card-meta-ink']) {
    assert.match(
      root[0],
      new RegExp(`${token}:\\s*var\\(--(?:color|card)-`),
      `${token} must resolve through the reading-mode tokens`
    );
  }
  // The panel layer derives from the same tokens where the two mean the same
  // thing, so the trackers and the feed cannot drift into two different greys.
  assert.match(styles, /--panel-surface:\s*var\(--card-surface\)/);
  assert.match(styles, /--panel-border:\s*var\(--card-border-color\)/);
  // And the font stack is a token, so a card's type ramp references the page's
  // one family rather than restating it.
  assert.match(styles, /--font-mono:\s*'JetBrains Mono',/);
  assert.match(styles, /font-family:\s*var\(--font-mono\)/);
  /* THE PAGE HAS TWO FAMILIES NOW (owner directive of 2026-09-03, issue 287):
     the ledger sets anything MEASURED — a figure, a date, a hash, a label — in
     the mono face, and anything a person READS in Archivo. Six faces, not
     four: the mono family's two styles by two character ranges, plus Archivo's
     one style by the same two ranges.

     Every claim the four-face pin made is made of all six and one more is
     added. Each is self-hosted inside the bundle (requirement 1 — no CDN);
     each declares a variable WEIGHT SPAN, so the ramp's 650s and the
     masthead's 900 render as drawn rather than snapped to a static cut; each
     swaps rather than holding first paint invisible; and Archivo additionally
     declares its variable WIDTH span, because the masthead reads that axis and
     a face that shipped without it would silently synthesize the width. */
  const faces = styles.match(/@font-face \{[^}]*\}/gs) ?? [];
  assert.equal(faces.length, 6, 'expected four JetBrains Mono faces and two Archivo faces');
  let variableWidthFaces = 0;
  for (const face of faces) {
    assert.match(face, /src: url\('\.\/assets\/fonts\//, 'a webfont loads from outside the bundle');
    assert.match(face, /font-weight: 100 (?:800|900)/, 'a face lost its variable weight span');
    assert.match(face, /font-display: swap/, 'a face would hold first paint invisible');
    if (/font-stretch: 62% 125%/.test(face)) {
      variableWidthFaces += 1;
    }
  }
  assert.equal(
    faces.filter((face) => /font-weight: 100 800/.test(face)).length,
    4,
    'the four mono faces must carry the 100-800 weight span the type ramp is drawn against'
  );
  assert.equal(variableWidthFaces, 2, 'both Archivo faces must declare the width axis the masthead reads');
  // And the second family is a token like the first, so a stack is chosen in
  // exactly one place.
  assert.match(styles, /--font-sans:\s*'Archivo',/);
  assert.match(styles, /font-family:\s*var\(--font-sans\)/);
});

/* Six content components now instead of two (owner directive of 2026-09-03,
 * issue 287) — the structural closure got WIDER with the redesign, not
 * narrower: every surface the ledger introduced renders through the same card
 * primitive the entry log and the gallery did, so a look is still a variant
 * plus its tokens rather than a component that builds its own chrome. */
test('every content component renders through the card primitive', () => {
  assert.ok(Object.keys(contentComponents).length >= 6, 'the content-component walk lost a surface');
  for (const [name, source] of Object.entries(contentComponents)) {
    assert.match(
      source,
      /import FeedCard from '\.\/FeedCard\.svelte'/,
      `${name} builds its own card instead of using the primitive`
    );
    assert.match(source, /<FeedCard/, `${name} imports the primitive without using it`);
  }
  // And none of the architecture's components paints a color of its own: the
  // whole point of the token layer is that a reading mode — including one
  // landing later — restyles every one of these without touching a component.
  for (const [name, source] of Object.entries(introduced)) {
    assert.doesNotMatch(
      source,
      /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z])/,
      `${name} states a color literal; components consume tokens`
    );
    for (const [, value] of styleBlock(source).matchAll(/font-family:\s*([^;]+);/g)) {
      assert.match(
        value,
        /var\(--/,
        `${name} states a font stack; the family is a token so it is chosen in one place`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Professional Experience
//
// The section shipped two lorem-ipsum entries under a "placeholder entries"
// note until the owner supplied the real history (2026-08-25). Both the copy
// and its disclaimer are gone, so these pins changed direction rather than
// value: what used to be proven was that the filler ANNOUNCED itself, and what
// is proven now is that no filler and no disclaimer survive anywhere in the
// section — a stale "placeholder entries" line over four real roles would be
// its own false statement, which is exactly what the honest-states floor is
// about.
// ---------------------------------------------------------------------------

test('the experience section carries four complete real entries, newest first', () => {
  assert.equal(workEntries.length, 4, 'the owner supplied exactly four roles');
  for (const entry of workEntries) {
    /* `short` and `years` joined the row for the ledger (owner directive of
       2026-09-03, issue 287): a row gives a name one column and a span
       another, where a card gave both to one sentence. Neither is a new FACT —
       each is a shorter rendering of the long form beside it — and both are
       required rather than optional so a later entry cannot ship without one
       and quietly render an empty column. */
    for (const field of ['company', 'short', 'years', 'markFile', 'role', 'dates', 'location', 'site']) {
      assert.ok(entry[field].trim().length > 0, `an experience entry has an empty ${field}`);
    }
    /* The employer's own home on the web (issue 243), and it is checked rather
       than merely present: an absolute https origin, no credentials, no query,
       no path pretending to be one. A relative or http value would render an
       anchor the reader could press and the site could not honour — and since
       the owner's ruling of 2026-09-12 (issue 326) it would also be the text
       the drawer PRINTS, so a malformed value is now visible as well as
       unfollowable. */
    const site = new URL(entry.site);
    assert.equal(site.protocol, 'https:', `${entry.company} links over ${site.protocol}`);
    assert.equal(site.username, '', `${entry.company}'s link carries credentials`);
    assert.equal(site.search, '', `${entry.company}'s link carries a query string`);
    assert.ok(site.hostname.includes('.'), `${entry.company} links to ${site.hostname}`);
    /* THE MARK IS A FILE NAME, and it is checked as one (owner ruling,
       2026-09-12, issue 326). A bare name, no directory and no traversal: the
       binding layer looks the value up in a map keyed by exactly one
       directory, so a path here resolves to nothing and renders a tile with no
       picture. The inventory test below is the other half — this one says the
       name is well formed, that one says the file is really there. */
    assert.match(
      entry.markFile,
      /^[a-z0-9]+\.png$/,
      `${entry.company} names "${entry.markFile}", which is not a plain tile file name`
    );
    assert.ok(entry.points.length > 0, `${entry.company} lists no accomplishments`);
    for (const point of entry.points) {
      assert.ok(point.trim().length > 0, `${entry.company} carries an empty accomplishment`);
    }
    // Every point is its own sentence, not a duplicate of a sibling: a list
    // that repeats itself is the shortcut this catches.
    assert.equal(
      new Set(entry.points).size,
      entry.points.length,
      `${entry.company} repeats one of its accomplishments`
    );
  }
  // Every employer appears once, so the keyed each below cannot collide.
  assert.equal(new Set(workEntries.map((entry) => entry.company)).size, workEntries.length);
  // And every employer wears its OWN mark: four rows sharing one tile is the
  // copy-paste this catches, and it is invisible until two rows are compared.
  assert.equal(
    new Set(workEntries.map((entry) => entry.markFile)).size,
    workEntries.length,
    'two roles are drawn with the same mark tile'
  );

  // NEWEST FIRST, read off the entries themselves rather than asserted about
  // them: the first entry is the current role, and every later one names an
  // earlier start year than the entry above it.
  assert.match(workEntries[0].dates, /Present$/, 'the current role is not at the top');
  const startYears = workEntries.map((entry) => Number(/(\d{4})/.exec(entry.dates)?.[1]));
  for (const [index, year] of startYears.entries()) {
    assert.ok(Number.isInteger(year), `${workEntries[index].company} carries no readable start year`);
    if (index > 0) {
      assert.ok(
        year < startYears[index - 1],
        `${workEntries[index].company} starts in ${year}, no earlier than the entry above it`
      );
    }
  }

  // No placeholder copy, and no disclaimer for it, survives anywhere in the
  // section — the data, the adapter, and the block that introduces it.
  // Comment-blind, deliberately: both files still EXPLAIN what they used to
  // ship and why it went, which is the record this repository keeps, and a
  // scan that read prose would be a scan nobody could write that record past.
  const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  for (const [name, source] of Object.entries({ workBinding, workSource })) {
    assert.doesNotMatch(
      withoutComments(source),
      /lorem|ipsum|placeholder/i,
      `${name} still carries placeholder copy or its note`
    );
  }
  // The block declares no section note at all now: staticBlock's presentation
  // argument is where one would go, and there is nothing left to disclaim.
  // It binds the ledger log (owner directive of 2026-09-03, issue 287).
  assert.match(
    workBinding,
    /staticBlock\(\s*'work-history',\s*LedgerLog,\s*roleLedgerProps\(markUrl\)\s*\)/,
    'the experience block still declares a section note'
  );

  /* THE ADAPTER, read back FACT BY FACT (owner directive of 2026-09-03, issue
     287). The card composed one byline out of the role, the span and the
     place, and the pin read that line back apart so a composition that
     silently dropped one of the three failed rather than merely looking
     different. The row gives each of them its own column, so the same three
     facts are pinned as the three fields they became — which is the same
     claim with one fewer place to lose something in. */
  assert.deepEqual(
    roleLedger.rows.map((row) => [row.key, row.span, row.name, row.markSrc, row.role, row.place, row.points]),
    workEntries.map((entry) => [
      entry.company,
      entry.years,
      entry.short,
      /* The mark's URL is the resolver's answer for THIS entry's file, which
         is why the stub is not the identity: a row that resolved its
         neighbour's tile would still be four URLs of four real files, and
         only an expectation built per entry can see the swap. */
      markStub(entry.markFile),
      entry.role,
      entry.location,
      entry.points,
    ])
  );
  /* THE EMPLOYER IS NAMED ONCE (owner ruling, 2026-09-12, issue 326): "inside
     Professional Experience there is no need to list the company name 3 times
     in a row, only once is enough." The three were the tile's initials, the
     heading, and the long name again in the drawer's link (issue 243, which
     had put it there because an anchor inside a button is invalid content no
     keyboard can reach).

     The NAME was the objection, not the link. The tile carries a picture, the
     heading keeps the name, and the link prints the host it goes to — so the
     row says WHO once and WHERE once, and this walks every visible cell of
     every row to prove the count is one.

     The comparison is exact and case-sensitive on purpose. A host is lower
     case and is not the name as written: "fathom5.com" contains the letters of
     "Fathom5" and is nobody's second mention of it, while a cell that IS the
     name is the repetition the owner counted. */
  for (const [index, row] of roleLedger.rows.entries()) {
    const entry = workEntries[index];
    const printed = [row.span, row.name, row.role, row.place, ...row.points, row.link.text];
    const named = printed.filter((cell) => cell === entry.company || cell === entry.short);
    assert.deepEqual(
      named,
      [entry.short],
      `"${entry.company}" is printed ${named.length} times in its own row; the owner asked for one`
    );
    /* WHERE IT GOES, DERIVED from the address it goes to (owner decision,
       2026-09-12): the authority, no scheme, no path, no port, no `www.`. A
       fourth spelled string would be a fourth thing to keep in step with the
       other three. */
    assert.equal(row.link.text, siteHost(entry.site));
    assert.doesNotMatch(row.link.text, /[:/\s]/, `the drawer prints "${row.link.text}" rather than a bare host`);
    assert.doesNotMatch(row.link.text, /^www\./, `the drawer prints "${row.link.text}" with the www label still on it`);
    assert.equal(row.link.href, entry.site);
    /* The accessible name may still carry the employer: a screen reader meets
       this link out of the row's context, and assistive technology is not the
       visible repetition the owner counted. It still says a new tab is coming,
       which is this page's convention for every outbound anchor. */
    assert.equal(row.link.label, `${entry.company} website, opens in a new tab`);
  }
  const ledgerMarkup = withoutHtmlComments(ledgerLog);
  assert.match(ledgerMarkup, /<a\s+class="ledger-link"/);
  /* Drawn on HAVING a link and on nothing else. The markup pins above all
     survive a condition that can never be true — an anchor nobody renders is
     still an anchor in the file — so the condition is read back too: the row
     contract makes `link` optional, and "the drawer draws one when the row has
     one" is the claim, not "the file contains an anchor". */
  assert.match(
    ledgerMarkup,
    /\{#if row\.link && row\.link\.href\}/,
    'the drawer draws its link on some condition other than the row having one'
  );
  assert.match(ledgerMarkup, /target="_blank"/);
  assert.match(ledgerMarkup, /rel="noopener noreferrer"/);
  assert.match(ledgerMarkup, /aria-label=\{row\.link\.label\}>\{row\.link\.text\}<\/a>/);
  assert.deepEqual(
    [...ledgerMarkup.matchAll(/href=\{([^}]*)\}/g)].map(([, expression]) => expression),
    ['row.link.href'],
    'the ledger may render exactly the one validated href and construct none'
  );
  assert.deepEqual(
    [...new Set([...ledgerMarkup.matchAll(/\{row\.(\w+)\}/g)].map(([, field]) => field))].toSorted(),
    ['markSrc', 'name', 'place', 'role', 'span'],
    'the row prints a field it did not before, or has stopped printing one'
  );

  /* THE HOST DERIVATION, driven directly with the shapes the four entries do
     not have: a path, a port, credentials, and a host with no `www.` label to
     strip. A derivation only ever exercised on four well-behaved addresses is
     a derivation nobody has tested. */
  assert.equal(siteHost('https://www.example.com/careers/team'), 'example.com');
  assert.equal(siteHost('https://www.example.com:8443/x?y=1'), 'example.com');
  assert.equal(siteHost('https://example.com'), 'example.com');
  assert.equal(siteHost('https://wwwx.example.com'), 'wwwx.example.com', 'the www strip ate a real label');
  assert.equal(siteHost('https://sub.www.example.com'), 'sub.www.example.com', 'the www strip is not anchored');
  assert.throws(() => siteHost('not a url'), TypeError, 'an unparseable address renders as text instead of failing');
  /* The chevron's words are DATA, so the component composes no sentence: a
     component that wrote "Expand Fathom5" would be a component with an opinion
     about English. */
  assert.equal(roleLedger.expandLabel, workExpandLabel);
  assert.equal(roleLedger.collapseLabel, workCollapseLabel);
  assert.match(ledgerLog, /aria-label=\{`\$\{open \? collapseLabel : expandLabel\} \$\{row\.name\}`\}/);
  /* And the row is a REAL disclosure: a button with aria-expanded, so the
     drawer is operable by keyboard and announced as a state rather than being
     a div that happens to listen for clicks. */
  assert.match(ledgerLog, /<button\s+class="ledger-row"\s+type="button"\s+aria-expanded=\{open\}/);
  // Collapsed by default: the section opens as a summary and expands on
  // request, which is what the owner asked for.
  assert.match(ledgerLog, /let opened = \$state\(new Set<string>\(\)\)/);
  // An empty roster says so rather than rendering nothing at all.
  assert.equal(roleLedger.emptyNote.trim().length > 0, true);
  assert.match(ledgerLog, /\{#if rows\.length === 0\}\s*<p class="ledger-note">\{emptyNote\}<\/p>/);
});

test('the role marks are exactly the four vendored tiles the entries name, each a square under its ceiling (owner ruling, 2026-09-12, issue 326)', async () => {
  /* The third dated requirement-11 exception, and the narrowest of the three:
     four organisation marks, ~10KB the whole set, fetched once from each
     organisation's own publication and vendored with their provenance beside
     them. The CSP is `default-src 'self'`, so an external logo could never
     load at all — a mark on this page is a vendored file or it is nothing.

     The allowlist half is what makes a missing tile a red build rather than an
     empty box: a build that dropped a file, or a fifth file nobody reviewed,
     fails here before a reader ever meets a row with no mark in it. */
  const dir = new URL('../src/assets/images/marks/', import.meta.url);
  const entries = (await readdir(dir)).filter((entry) => !entry.startsWith('.'));
  const named = workEntries.map((entry) => entry.markFile);
  assert.deepEqual(
    [...entries].sort(),
    [...named, 'SOURCES.md'].sort(),
    'the vendored marks directory holds a file the work entries and the manifest do not both name'
  );

  /* THE SQUARE IS READ OUT OF THE BYTES, not asserted about them. The owner
     asked for uniform squares — "LinkedIn style … they all have to be uniform
     so square may be the best way" — and a tile that was not square would be
     drawn into a square box and distort the mark it exists to show. The
     component's width and height attributes are checked against the SAME
     measurement, so the two numbers that reserve the box cannot drift from the
     file they describe.

     The ceiling is 16KB per tile against a measured largest of 3,557 bytes:
     headroom for a re-cut mark, nowhere near enough for somebody to drop a
     photograph in here. */
  const declared = /<img\s+class="ledger-mark"[\s\S]*?width=\{(\d+)\}\s*\n\s*height=\{(\d+)\}/.exec(ledgerLog);
  assert.ok(declared, 'the row no longer draws its mark as an <img> with its own pixel size');
  let total = 0;
  for (const file of named) {
    const bytes = await readFile(new URL(file, dir));
    total += bytes.length;
    assert.ok(bytes.length <= 16 * 1024, `${file} is ${bytes.length} bytes, over the 16KB per-mark ceiling`);
    assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', `${file} is not a PNG`);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assert.equal(height, width, `${file} is ${width}x${height}; the marks are square`);
    assert.equal(
      Number(declared[1]),
      width,
      `${file} is ${width}px wide and the row reserves ${declared[1]}px for it`
    );
    assert.equal(
      Number(declared[2]),
      height,
      `${file} is ${height}px tall and the row reserves ${declared[2]}px for it`
    );
  }
  assert.ok(total <= 64 * 1024, `the vendored marks are ${total} bytes, over the 64KB total ceiling`);

  /* PROVENANCE TRAVELS WITH THE ASSET (AGENTS.md, third-party attribution):
     every tile is named in the note beside it, with where it came from and on
     what terms. A mark added without its origin is the failure this catches. */
  const sources = await read('../src/assets/images/marks/SOURCES.md');
  for (const file of named) {
    assert.ok(sources.includes(file), `SOURCES.md does not record where ${file} came from`);
    assert.match(sources, /https:\/\//, 'SOURCES.md records no origin at all');
  }
  assert.match(sources, /licence|license/i, 'SOURCES.md states no terms for the vendored marks');
  assert.match(sources, /trademark/i, 'SOURCES.md drops the trademark statement');
});

test(
  'the attribution index sends a reviewer to the marks\u2019 own provenance note (issue 326)',
  { skip: reducedContextNote },
  async () => {
    /* The repository's one attribution index points at the note beside the
       tiles, the way it already points at the textures' (AGENTS.md,
       "Attribution for third-party assets"). These four are somebody else's
       TRADEMARKS, which is the fact a reviewer opens ATTRIBUTION.md to find — a
       provenance note only the directory knows about is a note nobody reads.
       The index lives at the repository root, outside the image build's
       context, so this is the one pin here the reduced context skips by name. */
    const attribution = await readFile(new URL('../../ATTRIBUTION.md', import.meta.url), 'utf8');
    assert.match(
      attribution,
      /frontend\/src\/assets\/images\/marks\/SOURCES\.md/,
      'ATTRIBUTION.md does not send a reviewer to the marks\u2019 own provenance note'
    );
    assert.match(
      attribution,
      /remains its owner['\u2019]s trademark/,
      'ATTRIBUTION.md drops the trademark boundary for the organisation marks'
    );
  }
);

test('the mark is named as a file, resolved by the bundler, and drawn by a component that knows no file (issue 326)', () => {
  /* The same three-layer rule the gallery follows, for the same reason: a
     component that spelled a file name would be a component the build could
     silently break, and a data module that held a URL would be a data module
     the bundler had to run. So work.ts names files, the binding resolves them
     through import.meta.glob, and the row draws what it is handed. */
  assert.match(workBinding, /import\.meta\.glob\('\.\.\/\.\.\/assets\/images\/marks\/\*\.png'/);
  assert.match(workBinding, /markFiles\[`\.\.\/\.\.\/assets\/images\/marks\/\$\{file\}`\]/);
  const markup = withoutHtmlComments(ledgerLog);
  assert.doesNotMatch(
    markup,
    /\.png|import\.meta\.glob/,
    'the row names a file of its own; the bundler owns that name'
  );
  /* DECORATIVE, AND SAYING SO. An empty alt is what keeps the row announced
     once: the button's own accessible name already carries the organisation,
     and a tile with a name of its own would say it twice to the one reader who
     cannot see that it is printed once. */
  assert.match(
    markup,
    /<img\s+class="ledger-mark"\s+src=\{row\.markSrc\}\s+alt=""/,
    'the mark tile lost its empty alt, or stopped drawing the URL it is handed'
  );
  assert.match(markup, /decoding="async"/);
  assert.doesNotMatch(
    markup,
    /loading="lazy"/,
    'the marks are the first section of the sheet and the first row is above the fold at 390px; a lazy tile on some rows and not others is the inconsistency this forbids'
  );
  // Every row draws one, and the button around it keeps the accessible name
  // that carries the employer.
  assert.equal(
    (markup.match(/<img\s+class="ledger-mark"/g) ?? []).length,
    1,
    'the row draws its mark somewhere other than the one place'
  );
  assert.match(markup, /aria-label=\{`\$\{open \? collapseLabel : expandLabel\} \$\{row\.name\}`\}/);

  /* THE TILE'S BOX IS ONE TOKEN IN BOTH AXES, and the row's track reads the
     same one — which is what makes the column square by construction rather
     than by agreement. The hairline around it is the thing that survived issue
     313's monogram: it is what makes a black wordmark, a navy badge, a pale
     ring and a coloured shield read as one set of four. */
  const rule = /\.ledger-mark \{([^}]*)\}/.exec(styles)?.[1] ?? '';
  assert.match(rule, /inline-size: var\(--ledger-mark\)/);
  assert.match(rule, /block-size: var\(--ledger-mark\)/);
  assert.match(rule, /border: var\(--ledger-hairline\) solid var\(--ledger-rule\)/);
  assert.match(
    styles,
    /grid-template-columns: 8\.75rem var\(--ledger-mark\)/,
    'the row track stopped reading the tile\u2019s own token; the column can drift from the tile'
  );
  /* And the token is the SITE'S control target rather than a fifth length
     (owner decision, 2026-09-12): the tile is something a reader is meant to
     resolve, and this sheet already has one size for that. A literal here
     would be a number nothing else moves with. */
  assert.match(
    styles,
    /--ledger-mark: var\(--control-target\)/,
    'the mark box restated a length of its own instead of borrowing the site\u2019s control target'
  );
});

/* THE SAME DOCTRINE, ONE SHAPE FEWER (owner directive of 2026-09-03, issue
 * 287). The card carried two body regions — a paragraph and a points list —
 * and drew each only when it held something, because a card that reserved an
 * empty <p> for content it did not have was the defect.
 *
 * The table's half of that claim moved TWICE and lapsed neither time. The
 * description cell it used to be about went with the owner's 2026-09-11
 * directive — the section holds half a sheet now — and the `latest` chip that
 * replaced it went with the ruling of 2026-09-12 that retired the row it
 * labelled. The table has no optional cell left at all, which is the strongest
 * form of the claim rather than its absence, and the SHEET's one remaining
 * conditional region is in the log beside it: the phone's disclosure control,
 * drawn only when there are rows it would reveal. So the claim is the same
 * claim, against the shape that still carries it. */
test('a row draws only the body it has, and every shipped row has one', () => {
  // The drawer is a region drawn from data, and the row's own points are what
  // fill it; an entry with none would open onto an empty box.
  assert.match(ledgerLog, /\{#each row\.points as point, index \(index\)\}/);
  for (const row of roleLedger.rows) {
    assert.ok(row.points.length > 0, `the ledger ships "${row.key}" with an empty drawer`);
  }
  /* THE RETIRED CELL STAYS RETIRED, in both places it could come back: the
     markup draws no chip, and no row the adapter builds carries a field for one
     — a live payload with an unpinned newest repository is exactly the shape
     that used to produce one. */
  assert.doesNotMatch(ledgerSpread, /table-chip/);
  const live = projectTableProps(
    projectsEnvelope([
      { name: 'kept', description: 'x', stars: 1, pushedAt: '2026-09-01T09:00:00Z', pinned: true },
      { name: 'newest', description: 'x', stars: 1, pushedAt: '2026-09-01T11:00:00Z' }
    ])
  );
  assert.deepEqual(live.rows.map((row) => row.link.text), ['kept']);
  for (const row of [...live.rows, ...projectTableProps(null).rows]) {
    assert.ok(!('chip' in row), `the row "${row.key}" carries a chip field again`);
  }
  /* And the log's disclosure is conditional in BOTH directions: the markup
     draws it only when the adapter built one, and the adapter builds one only
     when there are rows the collapsed list does not show — never an empty
     control held open for a list that has nothing behind it. */
  assert.match(ledgerSpread, /\{#if logDisclosure !== undefined && !wide\}/);
  assert.equal(
    projectsCommitsProps([null, null]).logDisclosure,
    undefined,
    'an empty log built a control with nothing to reveal'
  );
});

// ---------------------------------------------------------------------------
// Projects: the coding half
// ---------------------------------------------------------------------------

test('the captured fallback is the snapshot\'s roster, at the addresses the owner gave', () => {
  /* SEVEN, exactly, was the pin while this list was a curated set. It is not
     one any more (issue 281, and the owner\'s dynamic-roster ruling behind it):
     these rows are the cold-start FALLBACK face, a mirror of the embedded
     snapshot, and the snapshot is whatever the account published when it was
     last captured. The equality that replaced the count is the one that still
     catches the failure the old pin was about — a repository appearing here
     that the account does not publish — and it lives in
     tests/panels-ui.test.mjs, where both files can be read at once.

     What stays HERE is the derivation: every address is the one host constant
     plus a name, so a row can never point at another host or an unparseable
     path. */
  assert.ok(projects.length > 0, 'the captured fallback set is empty');
  for (const project of projects) {
    assert.equal(projectUrl(project), `${projectHost}/${project.name}`);
    assert.match(project.name, /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
    assert.ok(project.description.trim().length > 0, `${project.name} has no description`);
    assert.ok(
      Number.isInteger(project.stars) && project.stars >= 0,
      `${project.name} carries a star count that is not a whole number of things`
    );
    assert.match(project.pushedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  }
});

test('the feed leads with the repository pushed most recently (issue 252)', () => {
  // The owner's report, reproduced: a push landed and the section still led
  // with something else, because the order was the order this module's rows
  // are WRITTEN in. Sorting must come from the data.
  //
  // The captured list's own order and its push order DISAGREE, which is what
  // makes this fail when the sort is removed rather than pass by luck; the
  // second assertion below refuses to let that stop being true silently.
  const captured = projectTableProps(null).rows.map((row) => row.link.text);
  const expected = projects
    .toSorted((left, right) => Date.parse(right.pushedAt) - Date.parse(left.pushedAt))
    .map((project) => project.name);
  // The table shows the four most recent of that order (owner directive of
  // 2026-09-03, issue 287); the ORDER it selects from is the whole roster's,
  // which is what makes "leads with" a claim about the data rather than about
  // the four rows that happen to be drawn.
  assert.deepEqual(captured, expected.slice(0, shownProjectRows));
  assert.notDeepEqual(
    captured,
    projects.slice(0, shownProjectRows).map((project) => project.name),
    'the captured list happens to be in push order, so this test proves nothing; reorder the fixture'
  );

  // And with a panel: the LIVE instants win, so a repository the module list
  // records as quiet leads the moment the host says it was pushed.
  const envelope = {
    schema: 'panel/v1',
    id: codingProjectsPanelId,
    kind: 'coding-projects/v2',
    title: 'Coding Projects',
    generatedAt: '2026-08-29T12:00:00Z',
    status: 'ok',
    data: {
      repos: projects.map((project, index) => ({
        name: project.name,
        description: project.description,
        stars: 1,
        // Exactly reversed against the captured order.
        pushedAt: new Date(Date.UTC(2026, 0, 1 + (projects.length - index))).toISOString()
      }))
    }
  };
  assert.deepEqual(
    projectTableProps(envelope).rows.map((row) => row.link.text),
    projects.slice(0, shownProjectRows).map((project) => project.name),
    'the feed ordered by the captured instants while the panel carried newer ones'
  );

  // A row the origin fell back on serves its CAPTURED instant, and is ordered
  // by that — a recorded row must not claim a live position any more than it
  // claims a live description.
  const stale = {
    ...envelope,
    data: {
      repos: envelope.data.repos.map((row) => ({ ...row, recorded: true }))
    }
  };
  assert.deepEqual(
    projectTableProps(stale).rows.map((row) => row.link.text),
    expected.slice(0, shownProjectRows),
    'a recorded row was ordered by an instant it was not vouching for'
  );
});

/* One admissible envelope, shared by the dynamic-roster tests below. */
function projectsEnvelope(repos, overrides = {}) {
  return {
    schema: 'panel/v1',
    id: codingProjectsPanelId,
    kind: 'coding-projects/v2',
    title: 'Coding Projects',
    generatedAt: '2026-09-01T12:00:00Z',
    status: 'ok',
    data: { repos },
    ...overrides,
  };
}

test('the roster is the payload’s: a repository the module list has never heard of renders (issue 281)', () => {
  // The defect, reproduced: the owner published a new repository and the site
  // could not show it, because the module list fixed the roster. Now the
  // payload does — the new row renders with its live figures, its identity
  // derived from the one host constant plus its admitted name, and the one
  // figure nobody captured for it is an honest dash, not a borrowed number.
  const now = Date.parse('2026-09-01T12:30:00Z');
  const fresh = {
    name: 'born-this-morning',
    description: 'a repository created after the last release',
    stars: 1,
    pushedAt: '2026-09-01T11:00:00Z',
    closedPulls: 2,
    release: 'v0.1.0',
  };
  const rendered = projectTableProps(projectsEnvelope([fresh]), now);
  assert.equal(rendered.rows.length, 1, 'the payload decides the roster, not the module list');
  const [entry] = rendered.rows;
  assert.equal(entry.link.text, 'born-this-morning');
  assert.equal(entry.link.href, `${projectHost}/born-this-morning`);
  assert.equal(entry.link.label, 'born-this-morning on GitHub, opens in a new tab');
  const byKey = new Map(entry.counts.map((count) => [count.key, count]));
  assert.equal(byKey.get('stars').value, '1');
  assert.equal(byKey.get('pulls').value, '2');
  assert.equal(byKey.get('release').value, 'v0.1.0');
  /* A repository the capture never saw still renders its live figures, and the
     honest-dash rule is read on the two figures that CAN be absent from a live
     row: a tally and a version the payload does not carry. */
  const noTallies = projectTableProps(
    projectsEnvelope([{ ...fresh, closedPulls: undefined, release: undefined }]),
    now
  );
  const absent = noTallies.rows[0].counts.find((count) => count.key === 'pulls');
  assert.equal(absent.value, '—');
  assert.equal(absent.label, 'closed pull requests not reported');
  assert.deepEqual(absent.detail.rows, [], 'a dash carries no provenance row');
});

test('a payload name outside the repository grammar refuses the whole payload', () => {
  // The identity gate that lets the roster be dynamic: the href is the host
  // constant plus the name, so the name must be a plain path segment. A
  // payload carrying one hostile name is drift or hostility, and the refusal
  // is wholesale — the captured face renders, never a half-parsed roster.
  const good = { name: 'fine', description: 'x', stars: 1, pushedAt: '2026-09-01T11:00:00Z' };
  for (const name of ['evil name', 'a/../b', '..', '.', '', 'x'.repeat(101), 'sla/sh']) {
    const rendered = projectTableProps(projectsEnvelope([good, { ...good, name }]));
    assert.deepEqual(
      rendered.rows.map((row) => row.link.text).toSorted(),
      projects
        .toSorted((left, right) => Date.parse(right.pushedAt) - Date.parse(left.pushedAt))
        .slice(0, shownProjectRows)
        .map((project) => project.name)
        .toSorted(),
      `a payload carrying the name ${JSON.stringify(name)} was not refused wholesale`
    );
  }
});

/* THE FRESHNESS LINE IS GONE FROM THIS SECTION (owner ruling, 2026-09-12, on
 * the live page: "DATA THROUGH SEP 12, 2026 · LAST CAPTURE JUST NOW" goes).
 *
 * Issue 281's defect 2 was the opposite failure — the envelope said stale while
 * the card LOOKED fresh — and the answer then was a line in the shell's head.
 * The owner has now read that line on the shipped page and struck it: the
 * figures in both columns are dated in their own rows, an unavailable panel
 * renders its honest empty note where its rows would be, and a caption dating
 * the whole sheet was a fourth statement of facts that already state
 * themselves. What REPLACES the old pin is this one — the three envelope
 * shapes that each used to produce a line, proved to produce none, and the
 * builder that composed them proved absent from the module rather than merely
 * unused, because an unused exported builder is one import away from coming
 * back. */
test('the repositories table composes no freshness line, in any envelope state (owner 2026-09-12)', async () => {
  const now = Date.parse('2026-09-01T12:30:00Z');
  const repos = [
    { name: 'fine', description: 'x', stars: 1, pushedAt: '2026-09-01T11:00:00Z', pinned: true }
  ];
  const states = [
    ['a fresh ok panel', projectsEnvelope(repos)],
    ['the pre-envelope captured face', null],
    ['the origin saying stale', projectsEnvelope(repos, { status: 'stale', generatedAt: '2026-09-01T07:30:00Z' })],
    /* The status half ALONE, unmasked by age: a refused-row round marks the
       envelope stale while stamping a CURRENT generatedAt (defect 1's refusal
       path), which is the input that used to prove the note came from the
       status rather than from the clock. */
    ['a freshly-stamped stale panel', projectsEnvelope(repos, { status: 'stale', generatedAt: '2026-09-01T12:25:00Z' })],
    ['an unavailable panel', projectsEnvelope([], { status: 'unavailable', generatedAt: undefined, data: null })],
    /* An ok envelope whose generatedAt stopped advancing — the wedged-loop
       state a status alone cannot see, which is what the two-hour threshold was
       for. Four hours past it here. */
    ['a wedged refresh loop', projectsEnvelope(repos, { generatedAt: '2026-09-01T06:30:00Z' })]
  ];
  for (const [name, envelope] of states) {
    const props = projectTableProps(envelope, now);
    assert.equal(props.staleNote, undefined, `${name} composed a stale note`);
    assert.ok(!('staleNote' in props), `${name} carries a staleNote field for one to come back on`);
  }
  // The captured face still renders, which is what makes "no note" a statement
  // about the caption rather than about an empty table.
  assert.equal(projectTableProps(projectsEnvelope([], { status: 'unavailable', data: null }), now).rows.length, shownProjectRows);
  /* THE BUILDER IS GONE, not merely unread. It had one caller, and a module
     that still exported it would be one import away from the line returning. */
  const module = await read('../src/lib/projects.ts');
  assert.doesNotMatch(module, /projectsStaleNote|projectsStaleAfterMs/);
  for (const phrase of ['data as of', 'showing captured figures', 'is not current']) {
    assert.ok(!module.includes(phrase), `the retired line's words are still spelled in the module: "${phrase}"`);
  }
});

/* THE STALE LINE LEFT THE HEAD ALTOGETHER (owner directive, 2026-09-12, issue
 * 323). It moved there at issue 287 — the head is the one row every panel
 * already reserves, so a line arriving late cost no layout shift — and the
 * owner removed it after reading the result on the live page: "DATA THROUGH
 * SEP 11, 2026 · LAST CAPTURE 11H AGO" set over the figures it qualified.
 *
 * The row itself STAYS RESERVED, and that is the half this test now carries.
 * A head whose height came from its title alone would be nothing at all on the
 * panels that render no label, and the geometry a card reserves must not
 * depend on what happens to be in the row today. Review finding 1 on PR #293
 * showed the declaration could be deleted with every suite green; this pin and
 * the rendering lane are the two halves that close it. */
test('the panel head reserves its row and draws no freshness line', async () => {
  const shell = await read('../src/lib/components/PanelShell.svelte');
  /* NOTHING BUT AN OPTIONAL TITLE IS DRAWN IN IT. Swept over the whole file,
     because the note lived in three places at once — a prop, an element and a
     token family — and any one of them coming back is the same regression. */
  assert.ok(!shell.includes('note'), 'the shell takes a note prop again');
  assert.ok(!shell.includes('panel-note'), 'the shell draws a freshness line again');
  assert.ok(!shell.includes('data-panel-note'), 'the shell still marks a freshness line');
  /* The repositories sheet hands the shell status and provenance and nothing
     else (owner ruling, 2026-09-12), so the reserved head row is what keeps
     its geometry with nothing in it. */
  assert.match(ledgerSpread, /<PanelShell \{status\} \{generatedAt\}>/);
  assert.doesNotMatch(ledgerSpread, /note=/, 'the sheet hands the shell a note again');
  assert.ok(
    !(await read('../src/styles.css')).includes('--panel-note'),
    'the note token family outlived the note'
  );
  /* THE READING STAYS MACHINE-READABLE. Status and provenance arrive on every
     envelope and still ride this element as data attributes: a reading nobody
     displays is still a reading the page can be audited for. */
  assert.match(shell, /data-panel-status=\{status\}/);
  assert.match(shell, /data-panel-generated-at=\{generatedAt\}/);
  // The static work history has no envelope and no channel for a line at all.
  assert.equal(roleLedger.staleNote, undefined, 'the static work history grew a stale note');
  /* THE ROW IS THE RESERVE WITHOUT A TITLE (owner directive, 2026-09-04,
     issue 292): the Projects table renders no panel label, so the head's
     height can no longer come from its h2. Pinned where it is decided — the
     row wears the title's face and size and declares one line of it as its
     minimum, the `lh` line box with an em fallback under it — and the
     rendering lane "a panel head with no title keeps the reserved row"
     measures it in every engine. */
  const head = /\.panel-head \{([^}]*)\}/s.exec(styleBlock(shell));
  assert.ok(head, 'PanelShell no longer styles .panel-head');
  assert.match(head[1], /font-family: var\(--panel-title-family, inherit\);/, 'the head must wear the title face its lh is measured in');
  assert.match(head[1], /font-size: var\(--panel-title-size, 0\.8125rem\);/, 'the head must wear the title size its lh is measured in');
  assert.match(
    head[1],
    /min-block-size: 1\.3em;\s*min-block-size: 1lh;/,
    'the head must reserve one title line — em fallback first, the lh line box under it'
  );
  assert.match(
    shell,
    /\{#if title\}<h2 class="panel-title">\{title\}<\/h2>\{\/if\}/,
    'the title is optional, and it is the only thing the head draws'
  );
  /* THE MARK THAT LED IT IS GONE TOO (issue 323). The board was the one panel
     that passed one, and it passes no title now, so the positioned cell and
     the padding that made room for it are dead weight rather than a reserve. */
  assert.ok(!shell.includes('panel-mark'), 'the shell still draws a title mark');
  assert.ok(!shell.includes('Icon'), 'the shell still imports the icon it stopped drawing');
  assert.equal(projectTableProps(null).title, undefined, 'the Projects table grew a panel label back');
  assert.doesNotMatch(ledgerSpread, /\{title\}/, 'the sheet passes a panel label again');
});

test('the closed-pull tally and the released version are told with a mark and a figure (issue #317)', () => {
  const noon = Date.parse('2026-08-29T12:00:00Z');
  const project = { name: 'x', description: 'x', stars: 1, pushedAt: '2026-08-29T09:00:00Z' };
  const live = {
    name: 'x',
    description: 'x',
    stars: 1,
    pushedAt: '2026-08-29T09:00:00Z',
    closedPulls: 4,
    release: 'v0.1.82'
  };
  const [pulls, release] = projectColumns(project, live, noon).counts;
  // The owner's instruction: the cell does not read "prs closed". The visible
  // channel is the mark and the figure...
  assert.equal(pulls.value, '4');
  assert.equal(release.value, 'v0.1.82');
  // ...and the words are in the accessible name, complete and plural-correct,
  // so the mark is never the only thing carrying the meaning.
  assert.equal(pulls.label, '4 closed pull requests');
  assert.equal(release.label, 'version v0.1.82');
  assert.equal(
    projectColumns(project, { ...live, closedPulls: 1 }, noon).counts[0].label,
    '1 closed pull request'
  );

  // A figure the payload does not carry is a DASH, never a zero: those are
  // different claims and only one of them is supported.
  const [unknownPulls, unknownRelease] = projectColumns(
    project,
    { ...live, closedPulls: undefined, release: undefined },
    noon
  ).counts;
  assert.equal(unknownPulls.value, '—');
  assert.equal(unknownPulls.label, 'closed pull requests not reported');
  assert.equal(unknownRelease.value, '—');
  assert.equal(unknownRelease.label, 'no released version');
  // A REPORTED zero is a measurement and renders as one.
  assert.equal(projectColumns(project, { ...live, closedPulls: 0 }, noon).counts[0].value, '0');
  assert.equal(
    projectColumns(project, { ...live, closedPulls: 0 }, noon).counts[0].label,
    '0 closed pull requests'
  );

  /* THE MARKS COME FROM THE ONE FAMILY (issue 313), so the component draws no
     <svg> of its own any more: there is exactly one place on the site that
     writes the viewBox, the stroke attributes and the assistive posture, and a
     second drawing of a star here would be a second weight to keep in step. */
  assert.match(ledgerSpread, /import Icon from '\.\/Icon\.svelte';/);
  assert.match(ledgerSpread, /<Icon name=\{count\.glyph\} slot="cell" \/>/);
  assert.doesNotMatch(ledgerSpread, /<svg/, 'the table draws a glyph of its own again');
  assert.doesNotMatch(ledgerSpread, /stroke-width=/, 'the family’s weight is restated in the table');
  /* The words are hidden by CLIPPING, never by display:none or hidden, both of
     which would take them out of the accessibility tree and leave the mark
     carrying the figure alone. */
  assert.match(ledgerSpread, /<span class="table-clipped">\{count\.label\}<\/span>/);
  assert.match(styles, /\.table-clipped \{[^}]*clip-path: inset\(50%\)/s);
  assert.doesNotMatch(styles, /\.table-clipped \{[^}]*display: none/s);
  /* THE HEAD ROW IS WORDS TOO (owner directive, 2026-09-11, issue #317): the
     visible head is a mark, so the word it replaced has to reach a screen
     reader from the head itself — which is why the row is no longer hidden
     wholesale. */
  assert.doesNotMatch(ledgerSpread, /<div class="table-head" aria-hidden="true">/);
  assert.match(ledgerSpread, /<span class="table-clipped">\{head\}<\/span>/);
  /* EACH COLUMN HAS ITS OWN RULED HEAD (owner design decision, 2026-09-11,
     issue 318). The table's names its five columns; the log's names the whole
     stream, in the adapter's words, under the same class so the two heads are
     drawn at one height by one rule rather than by two that must agree. */
  assert.equal(commitColumnHead, 'Commits · every repository');
  assert.equal(projectsCommitsProps([null, null]).logHead, commitColumnHead);
  assert.match(
    ledgerSpread,
    /<div class="table-head spread-log-head">\s*<span class="table-label"><Icon name="commit" slot="cell" \/>\{logHead\}<\/span>/
  );
  assert.match(styles, /\.spread-log-head \{[^}]*grid-template-columns: minmax\(0, 1fr\);/s);
  /* A VERSION LONGER THAN ITS CELL ELLIPSIZES rather than wrapping the row: a
     wrapped figure is a row taller than the reserve the column beside it was
     built from, which is the zero-CLS pairing breaking on a tag nobody chose
     the length of. The cell is one unbreakable line that clips. */
  const figure = /\.table-figure \{([^}]*)\}/.exec(styles)?.[1] ?? '';
  assert.match(figure, /overflow: hidden/);
  assert.match(figure, /white-space: nowrap/);
  assert.match(figure, /text-overflow: ellipsis/);
  /* And the tag reaches the cell VERBATIM however long it is — the adapter
     prints what the host released and the cell decides how much of it is
     drawn, so nothing truncates a version into a different version. */
  // Long, and inside the release-tag grammar issue 317 admits: a `+` would be
  // refused by the payload gate, which would prove the gate rather than this.
  const longTag = 'v0.0.0-release-candidate.1.build.2026091100000000';
  const tagged = projectTableProps(
    projectsEnvelope([
      { name: 'x', description: 'x', stars: 1, pushedAt: '2026-09-01T11:00:00Z', release: longTag }
    ])
  );
  assert.equal(tagged.rows[0].counts.find((count) => count.key === 'release').value, longTag);
});

/* THE CLUSTER BECAME COLUMNS (owner directive of 2026-09-03, issue 287), and
 * issue 188's claim survives the move in the form the new shape can carry it.
 *
 * What issue 188 was about: nothing in the card's head could be placed by its
 * CONTENT — a long repository name must not push the counters, and the head
 * must not switch to a second layout at some width. A grid whose tracks are
 * declared once answered both.
 *
 * The table answers both the same way and more strictly: every counter sits in
 * a track the TABLE declares, identical on every row, so a figure cannot move
 * anything and there is nothing for a name's length to decide. The one thing
 * that did change is deliberate and is the owner's first requirement: the row
 * DOES restack on a phone. That is a width decision, not a content one — every
 * row takes the same shape at the same width — and it is what keeps a
 * six-column table off a 320px screen without scrolling the page sideways,
 * which is the floor a second layout was banned to protect in the first place.
 *
 * The accessibility half got stronger rather than weaker. The card put each
 * counter's whole sentence one interaction away, in a detail a reader had to
 * focus the tile to reach; the table keeps that detail AND carries the same
 * sentence unconditionally in the accessibility tree, clipped beside the
 * figure, so the words are there whether or not anyone reaches for them. */
test('the table places every counter in a declared track, and no figure moves anything (issue 188; issue 287)', () => {
  const noonPlacement = Date.parse('2026-08-27T12:00:00Z');
  const rowRules = [...styles.matchAll(/\.table-head,\s*\n\.table-row \{([^}]*)\}/g)].map(
    ([, body]) => body
  );
  assert.equal(rowRules.length, 1, 'the row has grown a second base shape again');
  assert.match(rowRules[0], /display:\s*grid/);
  /* EVERY TRACK IS A minmax (owner design decision, 2026-09-11, issue 318):
     the name track flexes, and each figure track takes its stated width
     wherever there is room and shrinks below it rather than pushing the page
     sideways when the table lives in half a sheet or a reader drags the
     reading column in. A bare fixed track is what used to overflow. */
  assert.match(
    rowRules[0],
    /grid-template-columns:\s*\n?\s*minmax\(0, 1fr\)(?:\s+minmax\(0, [0-9.]+rem\)){4};/,
    'the name column must flex and every figure track must be able to shrink'
  );
  /* And the LOG column beside it is declared the same way, for the same
     reason: a subject that flexes between an age, a repository and an
     identity, each of which can shrink. */
  const logRule = /\.commit-row \{([^}]*)\}/.exec(styles)?.[1] ?? '';
  assert.match(
    logRule,
    /grid-template-columns:\s*\n?\s*minmax\(0, [0-9.]+rem\) minmax\(0, [0-9.]+rem\) minmax\(0, 1fr\) minmax\(0, [0-9.]+rem\);/,
    'the commit row must flex on its subject and shrink on the rest'
  );
  /* THE TWO COLUMNS ARE EQUAL HALVES that fill the sheet (the no-dead-space
     ruling) and can be narrowed (the no-sideways-scroll floor). Both claims
     are one declaration. */
  const spreadRule = /\.ledger-spread \{([^}]*)\}/.exec(styles)?.[1] ?? '';
  assert.match(spreadRule, /display:\s*grid/);
  assert.match(spreadRule, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\);/);
  assert.match(spreadRule, /gap:\s*0 var\(--ledger-spread-gap\);/);
  /* The head and the rows are laid on the SAME track list — one declaration
     for both — so a column head can never sit over a different column than the
     figures it names. */
  assert.ok(
    styles.includes('.table-head,\n.table-row {'),
    'the head and the rows no longer share one track declaration'
  );
  /* ONE PHONE WIDTH, however many blocks express it: a sheet with two
     max-width breakpoints is a sheet whose parts disagree about where a phone
     ends, which is the drift a single-layout rule was protecting against. The
     WIDTHS are compared, not the block count — the chrome row drops its
     location label at the same width the rows restack at, and those are two
     decisions about one boundary. */
  /* The BOUNDARY MOVED from 40rem to 45rem (owner directive of 2026-09-03,
     issue 287), and it moved because it was measured rather than chosen: the
     wide row's own tracks — 15rem for the name, four counter columns, five
     1.5rem gaps — came to 680px, so a page column narrower than that overflowed
     the document sideways, which happened between 641px and 711px. The
     restack happens at 720px, where the wide layout genuinely stopped fitting,
     and it is the SAME boundary the two columns stack at (owner design
     decision, 2026-09-11, issue 318). */
  const phoneWidths = new Set(
    [...styles.matchAll(/@media \(max-width: ([^)]+)\)/g)].map(([, width]) => width.trim())
  );
  assert.equal(phoneWidths.size, 1, `the sheet disagrees about where a phone ends: ${[...phoneWidths].join(', ')}`);
  /* THE TABLE's head goes and the LOG's stays (owner design decision,
     2026-09-11, issue 318): every cell under the table's head repeats its own
     word, so five marks over a restacked row are five heads over nothing —
     while the log's head is the only thing telling a reader where the
     repositories stop and the commits start once the columns stack. */
  assert.match(
    styles,
    /@media \(max-width: 45rem\)[\s\S]*?\.table-head:not\(\.spread-log-head\) \{\s*display: none;/
  );
  assert.match(styles, /@media \(max-width: 45rem\)[\s\S]*?\.ledger-spread \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  /* THE SCRIPT ASKS THE SAME QUESTION THE STYLESHEET DOES, and a media query
     cannot read a token — so the number is stated in lib/columnWidth.ts and
     this holds the two equal. The commit row's short identity is rendered
     against it, so a drift here is a phone row that grows a third line. */
  assert.equal(spreadFromRem, 45.0625);
  assert.equal(spreadMediaQuery, '(min-width: 45.0625rem)');
  assert.match(ledgerSpread, /\{#if wide\}<span class="commit-mark">\{row\.mark\}<\/span>\{\/if\}/);
  assert.match(ledgerSpread, /browserMedia\(spreadMediaQuery\)\.matches/);
  /* And the phone's restack keeps every counter in a track of its own. Three
     counters sharing ONE grid area are three counters drawn on top of each
     other — measured at 390px before this pin existed — so the count of them
     is held at both ends: the desktop track list reserves exactly three
     counters plus the age, and the phone declares exactly four equal tracks
     with the name spanning the line above them. */
  assert.equal(projectTableProps(null, noonPlacement).rows[0].counts.length, 3);
  assert.match(
    styles,
    /@media \(max-width: 45rem\)[\s\S]*?\.table-row \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/
  );
  assert.match(
    styles,
    /@media \(max-width: 45rem\)[\s\S]*?\.table-name-cell \{\s*grid-column: 1 \/ -1;/,
    'the name no longer spans the row, so the four counters share its line'
  );
  /* THE MARK SLOT IS A DECLARED TRACK TOO (issue #317). A counter that packed
     its mark and its figure inline put the mark wherever the figure's own
     length left it, so a column of four-digit tallies drew its marks at a
     different x than a column of one-digit ones — issue 188's own defect, one
     level down. Two tracks fix both edges at once. */
  const countRule = /\.table-count \{([^}]*)\}/.exec(styles)?.[1] ?? '';
  assert.match(countRule, /display:\s*grid/);
  assert.match(countRule, /grid-template-columns:\s*var\(--icon-cell\) minmax\(0, 1fr\)/);

  /* A digit may not jitter the column it sits in: the counters read tabular
     figures. That is a LIVE requirement rather than a precaution — the
     freshness figure is re-derived on every panel delivery, so "9m" becoming
     "10m" would nudge its neighbours once a minute forever without it. */
  const counts = /\.table-count \{([^}]*)\}/.exec(styles)?.[1] ?? '';
  assert.match(counts, /font-variant-numeric:\s*tabular-nums/);

  /* And every counter's whole sentence is in the accessibility tree without
     anyone reaching for it, CLIPPED rather than hidden: display:none or
     [hidden] would take the words out of the tree and leave the glyph carrying
     the figure alone, which is the dataviz floor breaking. */
  const noon = Date.parse('2026-08-27T12:00:00Z');
  const row = projectTableProps(null, noon).rows[0];
  for (const count of [...row.counts, row.updated]) {
    assert.ok(count.label.trim().length > 0, `${count.key} carries no sentence for the tree`);
  }
  assert.match(ledgerSpread, /<span class="table-clipped">\{count\.label\}<\/span>/);
  /* Both are focus stops (owner directive, 2026-09-03, issue 287): each
     carries a detail, and a detail only a pointer can open is half the
     feature — the same reason the retired stat tiles carried a tabindex. */
  assert.match(ledgerSpread, /<span class="table-count table-age" tabindex="0" aria-label=\{row\.updated\.label\}>/);
  assert.match(ledgerSpread, /<span class="table-count" tabindex="0" aria-label=\{count\.label\}>/);
  assert.match(styles, /\.table-count:focus-visible,\s*\.table-age:focus-visible \{[^}]*outline: 2px solid var\(--color-accent\)/);
  const clipped = /\.table-clipped \{([^}]*)\}/.exec(styles)?.[1] ?? '';
  assert.match(clipped, /clip-path:\s*inset\(50%\)/);
  assert.doesNotMatch(clipped, /display:\s*none/);
});

/* The four columns as one flat list, in render order: the cluster then the
 * age, which is the order the table draws them in. */
function columnLabels(columns) {
  return [...columns.counts, columns.updated].map((count) => count.label);
}

test('projectsCapturedOn is a well-formed date, and formatIsoDate renders every stated date honestly', () => {
  // A pure test of the constant and the function (issue 167): the owner
  // removed the visitor-facing caption that used to render both together
  // ("Counts captured from … on …; this page fetches nothing" — capture
  // provenance is a maintainer/reviewer fact, not something a visitor came
  // here to read), but projectsCapturedOn remains the maintenance record for
  // when the captured counts were read, and formatIsoDate is the same
  // general date renderer the work/art feed cards use (feed.ts), so both
  // still deserve direct coverage independent of any one caller.
  assert.match(projectsCapturedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(formatIsoDate('2026-08-23'), '23 August 2026');
  assert.equal(formatIsoDate('2026-01-01'), '1 January 2026');
  // An unparseable date returns unchanged rather than inventing a day.
  assert.equal(formatIsoDate('not-a-date'), 'not-a-date');
  assert.equal(formatIsoDate('2026-13-01'), '2026-13-01');
});

test('the Coding Projects feed renders no capture-date or no-fetch caption (issue 167)', () => {
  // The owner: "why would a user care to know that this fetches nothing?
  // remove this." Both halves are gone — a regression back to either is what
  // this pins against, not merely an absence of a check that used to require
  // them. In this architecture the caption has exactly two channels back onto
  // the page, and both are checked: the EXECUTED props the adapter hands the
  // log (data no source scan can be blinded to by indirection), and the
  // binding's presentation, which must declare no note line at all. The
  // rendered-DOM guard lives in e2e/rendering-lanes.spec.mjs, against what a
  // visitor's browser actually painted.
  const renderedData = JSON.stringify(projectTableProps(null));
  assert.doesNotMatch(
    renderedData,
    /Counts captured from/,
    'the maintainer-facing capture-date caption returned to the rendered props'
  );
  assert.doesNotMatch(
    renderedData,
    /fetches nothing/,
    'the maintainer-facing no-fetch caption returned to the rendered props'
  );
  assert.doesNotMatch(
    renderedData,
    /2026-08-23|23 August 2026/,
    'the capture date reached the rendered props in some form'
  );
  assert.doesNotMatch(
    projectsBinding,
    /\bnote:/,
    'the coding-projects binding declares a section note again — the removed caption’s channel'
  );
  assert.doesNotMatch(projectsBinding, /projectsCapturedOn|Counts captured from|fetches nothing/);
});

test('nothing in the work, projects, art, or trackers surfaces reaches the network', async () => {
  // What this pins is the LOCAL-ORIGIN-ONLY invariant of requirement 1, and
  // it is worth restating precisely because half of the sentence that used to
  // stand here expired (issue 242). The Coding Projects rows are no longer a
  // frozen capture: the origin reads the repository metadata itself and serves
  // it as a panel, and the page reads that panel from THIS origin exactly as
  // it reads every other one. What has never changed, and is what these scans
  // enforce, is that none of these modules constructs a request of its own and
  // none of them spells a remote origin — the addresses live in the data
  // module and reach the DOM only as href values a human may click.
  for (const [name, source] of Object.entries(introduced)) {
    assert.doesNotMatch(
      source,
      /\bfetch\(|XMLHttpRequest|EventSource|WebSocket/,
      `${name} reaches the network; these sections are data, not requests`
    );
    assert.doesNotMatch(
      source,
      /https?:\/\//,
      `${name} spells a remote origin; addresses live in the data module and reach the DOM only as href values`
    );
  }
  // ...and the one module that does hold addresses holds exactly one host.
  const hosts = new Set(
    [...(await read('../src/lib/projects.ts')).matchAll(/https?:\/\/[^/'"]+/g)].map(([host]) => host)
  );
  assert.deepEqual([...hosts], [projectHost.slice(0, projectHost.lastIndexOf('/'))]);
});

// ---------------------------------------------------------------------------
// Projects: the art half
// ---------------------------------------------------------------------------

test('the gallery data pins eight distinct, honestly described photographs', () => {
  assert.equal(galleryPhotos.length, 8, 'the owner asked for eight pictures');
  const files = new Set();
  for (const [i, entry] of galleryPhotos.entries()) {
    assert.equal(entry.alt, `Placeholder photograph ${i + 1} of 8`);
    // Nobody has reviewed what these placeholders depict, so nothing claims
    // to know more than that — a caption invented to look finished is the
    // same failure as a panel inventing a figure.
    assert.doesNotMatch(entry.alt, /error|failed|broken|missing/i);
    assert.match(entry.src, /^gallery-\d{2}-full\.webp$/);
    assert.match(entry.previewSrc, /^gallery-\d{2}-preview\.webp$/);
    assert.equal(
      entry.sourceUrl,
      `https://picsum.photos/seed/naranjo-gallery-${String(i + 1).padStart(2, '0')}/3840/2160`,
      'the fixed seed in sourceUrl must match the vendored file it names'
    );
    for (const file of [entry.src, entry.previewSrc]) {
      assert.equal(files.has(file), false, `${file} names two rows`);
      files.add(file);
    }
  }
  assert.equal(files.size, 16, 'eight photos at two derivatives each is sixteen distinct files');
  assert.ok(galleryLicenseNote.includes('Unsplash Licence'), 'the vendored licence must be stated');
  assert.equal(galleryWidth, 3840);
  assert.equal(galleryHeight, 2160);
});

test('the gallery receives resolved URLs through the adapter, and never builds its own', () => {
  // The binding module resolves gallery.ts's FILE NAMES to content-hashed
  // URLs through import.meta.glob — the same pattern osrsStats.ts's icon
  // maps use, because the bundler owns that resolution — so the component
  // never sees a file name or a path of its own.
  assert.match(mediaBinding, /import\.meta\.glob\('\.\.\/\.\.\/assets\/images\/gallery\/\*\.webp'/);
  assert.match(mediaBinding, /previewSrc: resolve\(photo\.previewSrc\)/);
  assert.match(mediaBinding, /fullSrc: resolve\(photo\.src\)/);
  assert.match(mediaGallery, /src=\{tile\.previewSrc\}/, 'the tile renders the adapter’s URL, never its own');
  assert.doesNotMatch(mediaGallery, /\.webp|import\.meta\.glob/, 'the component must not know a file name of its own');
  assert.match(mediaGallery, /alt=\{item\.alt\}/);
});

test('exactly the reviewed sixteen WebP files (plus the sources manifest) are vendored — issue 176’s narrow, dated requirement-11 exception', async () => {
  // Requirement 11 says heavy media never enters git; issue 176 is the
  // owner's own dated exception for this temporary placeholder set alone
  // (stated in gallery.ts, MediaGallery.svelte and SOURCES.md, where the
  // owner will read it). The pin is an exact allowlist: precisely the
  // reviewed set may exist here, nothing unreviewed can be added silently,
  // and every file respects the size ceiling that keeps a "narrow,
  // justified exception" narrow.
  const dir = new URL('../src/assets/images/gallery/', import.meta.url);
  const entries = (await readdir(dir)).filter((entry) => !entry.startsWith('.'));
  const expected = galleryPhotos.flatMap((photo) => [photo.src, photo.previewSrc]);
  assert.deepEqual(
    [...entries].sort(),
    [...expected, 'SOURCES.md'].sort(),
    'the vendored gallery directory holds a file the data module and the manifest do not both name'
  );
  let total = 0;
  for (const file of expected) {
    const { size } = await stat(new URL(file, dir));
    total += size;
    assert.ok(size <= 2 * 1024 * 1024, `${file} is ${size} bytes, over the 2MB per-image ceiling`);
  }
  assert.ok(total <= 16 * 1024 * 1024, `the vendored set is ${total} bytes, over the 16MB total ceiling`);
});

test('Rime’s flight sheet is exactly one vendored file under its own ceiling (owner 2026-09-11, issue 314)', async () => {
  /* The second dated requirement-11 exception, and a narrower one than the
     gallery's: ONE file, the owner's own render of his own dragon, carried as
     a hashed bundle asset because the alternative — a 3D runtime, a model and
     an iframe from the media origin — is a new publish path and a new
     content type for a mark in the corner of a row.
     The ceiling is 1,000,000 bytes rather than the gallery's 2MB because this
     one is fetched on EVERY first paint, not when a reader opens a picture,
     and it is what the sheet is encoded against: 80px cells at quality 80.
     The allowlist half is what makes a missing sheet a red build rather than
     an empty box — a build that dropped the file fails here, before a reader
     ever meets a mark with nothing in it. */
  const dir = new URL('../src/assets/images/rime/', import.meta.url);
  const entries = (await readdir(dir)).filter((entry) => !entry.startsWith('.'));
  assert.deepEqual(entries.sort(), ['rime-flight.webp'], 'the vendored flight directory is not exactly the one sheet');
  const styles = await read('../src/styles.css');
  assert.match(
    styles,
    /url\('\.\/assets\/images\/rime\/rime-flight\.webp'\)/,
    'the stylesheet no longer names the sheet, so the bundler emits a file nothing draws'
  );
  const { size } = await stat(new URL('rime-flight.webp', dir));
  assert.ok(size <= 1_000_000, `the flight sheet is ${size} bytes, over its 1,000,000-byte ceiling`);
});

/* The enlarged branch, extracted whole. Issue 202 nested a further {#if}
 * inside it (the optional metadata block), and the non-greedy extraction
 * this replaces stopped at that inner {/if} — it would still have found
 * item.fullSrc, so it would still have PASSED while measuring a fraction of
 * the branch it names. Anchoring on the dialog's closing tag and taking the
 * greedy span keeps the pin honest as the branch grows. */

/* The component's own markup, with every HTML comment removed. Prose about
 * an attribute is not that attribute, and the gallery's header comment
 * describes the very things the two tests below forbid — so they read the
 * markup rather than the file, which is what makes "nowhere" mean nowhere.
 *
 * The strip repeats until it converges rather than running once. Removing a
 * comment can SPLICE a new opener into existence out of the text either
 * side of it — `<!` before, `--` after — so one pass cannot promise its
 * result is comment-free. That is the incomplete multi-character
 * sanitization CodeQL flags (js/incomplete-multi-character-sanitization),
 * and it is not decorative here: a surviving comment is prose these pins
 * would read as markup, which is how a pin demanding an element be PRESENT
 * gets satisfied by a commented-out one. Looping to a fixed point is what
 * makes "removed" total, and it is what makes the pins below sound.
 *
 * It returns its pass COUNT alongside the markup so the test below can prove
 * the loop is load-bearing without performing a lone unguarded pass of its
 * own — a demonstration written that way is a second incomplete sanitizer,
 * correctly flagged as one, and counting is the better evidence anyway: it
 * measures the real implementation rather than a hand-rolled imitation. */

/* PROSE-FREE SOURCE, for the walks that decide something from a POSITION in
 * the text rather than from a pattern anywhere in it. stripComments above only
 * removes HTML comments, which is right for the markup pins — but this
 * component explains itself at length in `/* *​/` blocks inside <script> and
 * <style> too, and three of those blocks contain the literal `<button>` while
 * one contains `index = at`. A walk that asks "what is the nearest enclosing
 * element" or "how many times is this assigned" reads those as code and is
 * wrong in the direction that lets a real regression through.
 *
 * ALL THREE comment forms go now (issue 246, finding 3). The previous version
 * removed HTML and block comments and claimed the result was "only what the
 * compiler sees", which was not exact: a `//` line comment containing
 * `<button` above a loose glyph made the enclosure walk find prose again and
 * a real mutant survived green. The naive repair — delete everything after
 * `//` — is worse than the defect, because it eats the `//` inside every
 * `https://` this component's markup carries and truncates the lines that
 * hold them.
 *
 * The narrower claim, and the one stripLineComments below actually delivers:
 * a `//` line comment is removed WHERE `//` IS A COMMENT, which in a Svelte
 * file is inside <script> and nowhere else. HTML has no line comments and
 * neither does CSS, so a `//` in markup or in a <style> block is content and
 * survives untouched — which is exactly what keeps `https://` intact, since
 * every URL in this component lives in one of those two places. Inside the
 * script the strip is delimiter-aware: it tracks quoted and template strings
 * so a `//` inside a string literal is content there too. */
/* The <script> region, written ONCE and matched case-insensitively.
 *
 * HTML tag names are case-insensitive, so a filter that knows only the
 * lowercase spelling is a filter with a hole in it: an upper-case <SCRIPT>
 * block would not be recognised as script at all, and every line comment
 * inside it would survive into text these walks read as code — the exact
 * failure the strip exists to prevent, reintroduced through the spelling of
 * the tag rather than through the comment. CodeQL flags it as
 * js/bad-tag-filter, and the alert is right even though this file's only
 * real subject is one lowercase Svelte component: a pin whose correctness
 * depends on nobody ever typing a tag differently is a pin resting on a
 * habit.
 *
 * The closing tag is loose for the same reason, and looser than a first
 * reading suggests. HTML end tags may carry whitespace AND ignored junk
 * before the `>`: `</script >`, `</script\t\n bar>` and `</script/>` are
 * all the same end tag to a parser, which stops the script block at every
 * one of them. `\s*` covers only the first of the three, so the strip would
 * have run past the real end of a block spelled either of the other two
 * ways and kept walking markup as if it were code. `\b[^>]*` accepts the
 * whole family while still refusing `</scriptfoo>`, which is not an end tag
 * at all — the word boundary is what keeps the tolerance from becoming a
 * prefix match. CodeQL raised this as a SECOND js/bad-tag-filter alert
 * after the casing repair closed the first two; it is the same class of
 * defect one field over.
 *
 * It is a SOURCE STRING rather than a shared RegExp because a /g regex
 * carries lastIndex: handing one instance to both a replace and a matchAll
 * is a state bug waiting for a third caller, and building a fresh one per
 * site costs nothing in a test. */

test('the source ladder renders in the manifest’s own order, never re-ranked (issue 207)', () => {
  // The browser takes the first source it can decode, so ORDER is the
  // preference. A sort, filter or reverse here would silently hand a reader
  // different bytes than the operator published.
  assert.match(mediaGallery, /\{#each tile\.video\.sources as source \(source\.src\)\}/);
  /* The rung now also declares WHICH VIEWPORT may ask for it (issue 241), and
     that is an addition to the ladder rather than a re-ranking of it: the
     attribute is bound straight from the source the adapter built, so the
     component still neither computes a breakpoint nor moves a rung. */
  assert.match(mediaGallery, /<source src=\{source\.src\} type=\{source\.type\} media=\{source\.media\} \/>/);
  for (const forbidden of [/video\.sources\.sort/, /video\.sources\.filter/, /video\.sources\.reverse/]) {
    assert.doesNotMatch(mediaGallery, forbidden, 'the component must not re-rank the manifest’s source ladder');
  }
  assert.doesNotMatch(
    mediaGallery,
    /min-width:/,
    'the component states a breakpoint of its own; the rung ladder’s breakpoints are the manifest’s own numbers'
  );
});

test('the Media block renders the vendored set first and lets a runtime manifest replace it (issue 182/207)', () => {
  // The cutover's whole shape, pinned where it is decided: the build's own
  // props are the block's FALLBACK — they render before any request exists —
  // and the volume's manifest is a one-shot read that may replace them. A
  // read that answers null changes nothing, which is why an absent media
  // volume looks like a gallery instead of a fault.
  assert.match(mediaBinding, /runtimeBlock\(/);
  assert.match(mediaBinding, /loadGalleryManifest\(\)/);
  assert.match(mediaBinding, /if \(items === null\) \{\n\s+return null;/);
  // The adapter still resolves the vendored file names through the bundler,
  // and still never assembles a media URL of its own: the manifest reader
  // built those through lib/media.ts before this module saw them.
  assert.match(mediaBinding, /import\.meta\.glob\('\.\.\/\.\.\/assets\/images\/gallery\/\*\.webp'/);
  assert.doesNotMatch(mediaBinding, /\/media\/|mediaUrl\(/, 'the adapter must never build a media URL itself');
  /* The poster choice is DELEGATED (issue 239). The rule now lives beside the
     manifest field it reads, where gallery-manifest.test.mjs EXECUTES it
     against real admitted items; this layer only binds the answer to a prop.
     The branch is extracted rather than swept whole, because `item.full` is a
     legitimate read two lines above it — the still a reader enlarges to — and
     a file-wide ban would forbid the correct use along with the wrong one. */
  const filmBranch = /if \(item\.kind === 'video'[\s\S]*?\n {2}\}/.exec(mediaBinding)?.[0] ?? '';
  assert.ok(filmBranch.length > 0, 'the adapter’s film branch is not where this pin expects it');
  assert.match(
    filmBranch,
    /posterSrc: galleryPosterAsset\(item\)\.url/,
    'the adapter chooses a film’s poster itself again instead of delegating the rule to the module that documents it'
  );
  assert.doesNotMatch(
    filmBranch,
    /item\.full/,
    'the strip reaches for the 4K master as a poster again; the full-size still is the rendition the lightbox stopped showing'
  );
  // Manifest order is the operator's order here too, and this is the assertion
  // that has to survive somebody being clever: the adapter may not reorder the
  // items OR a film's source ladder, by any means — a spread and a reverse, a
  // sort, a toSorted. The mapping expression is pinned exactly, so a rewrite
  // that inserts anything between `item.sources` and `.map` is a diff.
  assert.match(
    mediaBinding,
    /sources: item\.sources\.map\(\(source, at\) => \{/,
    'the ladder must be mapped straight through, with nothing between the manifest order and the props'
  );
  assert.match(
    mediaBinding,
    /src: source\.url,\n\s+type: source\.type/,
    'a rung’s url and media type must come straight off the admitted source'
  );
  for (const forbidden of [/\.reverse\(/, /\.sort\(/, /\.toSorted\(/, /\.toReversed\(/]) {
    assert.doesNotMatch(mediaBinding, forbidden, 'the adapter must not reorder items or renditions');
  }
  /* The size question is DELEGATED, exactly as the poster choice above is: the
     rule that decides which viewport may ask for which rung lives beside the
     ladder it reads (galleryVideoSourceMedia, lib/galleryManifest.ts), where
     gallery-manifest.test.mjs executes it against real admitted items. This
     layer zips the answer positionally and computes nothing. */
  assert.match(filmBranch, /const media = galleryVideoSourceMedia\(item\);/);
  assert.match(filmBranch, /const query = media\[at\];/);
  assert.doesNotMatch(
    mediaBinding,
    /min-width|source\.height/,
    'the adapter derives a breakpoint of its own instead of reading the one the manifest module states'
  );
  /* And the preview's own width travels with the item, which is the one number
     the enlarged surface needs to stop sending every reader the master. */
  assert.match(mediaBinding, /previewWidth: item\.preview\.width/);
});

test('the runtime binding renders its fallback until a non-null replacement arrives', () => {
  // Block.svelte is the only place the three binding kinds meet, and the two
  // lines below are the whole honest-states contract for the runtime one: a
  // null result is never rendered, and the fallback is what shows until a
  // complete replacement exists. There is no loading state because nothing
  // is ever waiting — the first paint is already true.
  assert.match(blockHost, /runtime \?\? block\.binding\.fallback/);
  assert.match(blockHost, /if \(mounted && loaded !== null\)/);
  assert.match(blockHost, /mounted = false/, 'a block torn down mid-flight must not write into a gone component');
});

// ---------------------------------------------------------------------------
// Projects, the art half: the gallery EXPERIENCE (owner directives
// 2026-08-25, issue 202) — a centred frame, a close mark that is not stamped
// on the artwork, and metadata that is absent when it is absent.
// ---------------------------------------------------------------------------

test('gallery metadata is optional in the data, and every row states only what SOURCES.md verifies', () => {
  for (const [i, entry] of galleryPhotos.entries()) {
    /* Honest states: nobody has reviewed what these placeholders depict, so
       no row claims a title or a description. The one fact SOURCES.md does
       verify is where each file came from, and that — and only that — is
       what the row publishes as a link. */
    assert.equal(entry.title, undefined, `row ${i + 1} invents a title nobody reviewed`);
    assert.equal(entry.description, undefined, `row ${i + 1} invents a description nobody reviewed`);
    assert.equal(
      entry.link?.href,
      entry.sourceUrl,
      `row ${i + 1}'s link points somewhere other than the fixed-seed source the manifest records`
    );
    assert.equal(entry.link?.label, gallerySourceLinkLabel);
  }
  assert.equal(gallerySourceLinkLabel, 'Lorem Picsum source');
  // Optionality is real in the TYPE, not merely unused: all three fields are
  // declared optional, which is what lets a media-volume row (issue 182)
  // carry a title while a bootstrap row carries none.
  const gallerySource = galleryModule;
  for (const field of ['title', 'description', 'link']) {
    assert.match(
      gallerySource,
      new RegExp(`readonly ${field}\\?:`),
      `gallery.ts declares ${field} as required, so an entry without one cannot exist`
    );
  }
});

test('a metadata link is real outbound navigation, isolated and named (issue 202)', () => {
  const meta = /<div class="gallery-lightbox-meta">([\s\S]*?)<\/div>/.exec(mediaGallery)?.[1] ?? '';
  assert.ok(meta.length > 0, 'the lightbox metadata block is not where this pin expects it');
  assert.match(meta, /href=\{item\.link\.href\}/);
  assert.match(meta, /target="_blank"/);
  assert.match(meta, /rel="noopener noreferrer"/, 'the outbound link can reach back into this page');
  assert.match(meta, /aria-label=\{`\$\{item\.link\.label\} \(opens in a new tab\)`\}/);
  // The label is the manifest's, never the component's: nothing here writes
  // link copy of its own.
  assert.match(meta, />\{item\.link\.label\}</);
});

// ---------------------------------------------------------------------------
// The media binding
// ---------------------------------------------------------------------------

/* THE GALLERY IS ITS OWN SECTION NOW (owner directive of 2026-09-03, issue
 * 287), so the block declares no heading at all — and that is the same ruling
 * the owner already made for the coding projects on 2026-08-31 ("remove coding
 * projects and just make it a clean Projects"), applied for the same reason:
 * a block heading reading "Media" one line under the section's own "Gallery"
 * title says the word twice.
 *
 * The presentation CHANNEL survives untouched — PageSection still renders a
 * subsection head for any block that declares one — so the day a section
 * carries two named blocks again it is a manifest edit, not a component one.
 * What is pinned is that this block declares none of the three. */
test('the media block declares no heading, intro or note of its own', () => {
  assert.doesNotMatch(mediaBinding, /heading:/);
  // The retired intro/note provenance lines do not come back (issue 176):
  // the gallery's whole content is the frame itself now, and the licence
  // lives in gallery.ts's own doc comment and SOURCES.md — a maintainer
  // fact, not something a visitor came here to read (the same ruling issue
  // 167 already made for the Coding Projects capture note).
  assert.doesNotMatch(mediaBinding, /intro:|note:/);
  // The channel itself stays, so a named block can still introduce itself.
  assert.match(pageSectionSource, /<h3 class="subsection-title">\{block\.heading\}<\/h3>/);
});

test('the coding-projects block declares no heading of its own (owner ruling, 2026-08-31)', () => {
  /* "Remove coding projects and just make it a clean Projects": the cards sit
     directly under the section's own title, so the binding must not present a
     subheading — the conditional in PageSection.svelte (pinned above) renders
     the block bare when no heading is declared. The fixture envelopes' `title:
     'Coding Projects'` fields elsewhere in this suite are the panel's own
     server-side metadata and are NOT what this pin is about. */
  assert.doesNotMatch(projectsBinding, /heading:/);
});

/* THE GALLERY IS A ROW OF TILES (owner directive, 2026-09-03, issue 287). The
 * single visible frame of issues 176/202/219/243/265 is superseded by a grid of
 * reserved square tiles beside one control tile, with the native dialog as the
 * stage. These pins keep what those rulings were FOR — one full-size picture at
 * a time, bytes only on demand, films inline and never autoplaying, reserved
 * boxes, 44px controls, sets as data, tokens for every dimension — and pin the
 * behaviour rather than the markup wherever the source lets them. */
const galleryStyle = styleBlock(mediaGallery);

test('the gallery is a row of reserved square tiles beside one control tile, and the row is the column (owner directive, 2026-09-03, issue 287)', () => {
  assert.match(mediaGallery, /tiles = 4 \}: MediaGalleryProps = \$props\(\)/, 'the mock draws four tiles; the count is a prop with that default');
  assert.match(mediaGallery, /visible\.slice\(0, Math\.max\(1, tiles\)\)/);
  assert.match(mediaGallery, /<div class="gallery-grid" data-gallery-tiles=\{shownTiles\.length\}>/);
  assert.match(mediaGallery, /<button\s+type="button"\s+class="gallery-tile"\s+data-gallery-kind="image"/);
  assert.match(mediaGallery, /class="gallery-thumb"\s+src=\{tile\.previewSrc\}\s+alt=""[\s\S]*?loading="lazy"\s+decoding="async"/, 'a thumbnail is decoration inside a labelled button, lazy and async');
  assert.match(mediaGallery, /aria-label=\{`Open \$\{itemNoun\(tile\)\}: \$\{tile\.alt\}`\}/);
  assert.match(galleryStyle, /\.gallery-grid \{[^}]*grid-template-columns: repeat\(var\(--gallery-columns\), minmax\(0, 1fr\)\)/, 'the row fills the column; no gutter is dead');
  assert.match(galleryStyle, /\.gallery-tile \{[^}]*aspect-ratio: var\(--gallery-tile-aspect\)/, 'every tile reserves its square before a byte arrives');
  assert.match(styles, /--gallery-columns: 5;/);
  const phoneColumns = styles.indexOf('--gallery-columns: 2;');
  assert.ok(phoneColumns > styles.indexOf('--gallery-columns: 5;'), 'a phone folds the same tiles to two across — declared AFTER the token block, or the cascade hands the phone five columns');
  assert.match(styles.slice(styles.lastIndexOf('@media (max-width: 45rem)', phoneColumns), phoneColumns), /^@media \(max-width: 45rem\) \{[\s\S]*:root \{\s*$/m, 'and inside the phone block, on :root');
  assert.equal((mediaGallery.match(/class="gallery-control"/g) ?? []).length, 1);
  assert.match(mediaGallery, /`\$\{shownTiles\.length\} of \$\{visible\.length\} shown · open one to page through all`/, 'the control tile says how much of the set the row shows');
});

test('opening a tile is the only way onto the stage, a native <dialog> that loads the full derivative only then', () => {
  assert.match(mediaGallery, /onclick=\{\(event\) => open\(tile, event\.currentTarget\)\}/);
  assert.match(mediaGallery, /<dialog\s+bind:this=\{dialogEl\}\s+class="gallery-lightbox"[\s\S]*?onclose=\{onDialogClose\}\s+onkeydown=\{onDialogKeydown\}\s+onclick=\{onBackdropClick\}/);
  assert.match(mediaGallery, /if \(enlarged && !dialogEl\.open\) dialogEl\.showModal\(\);/);
  const stage = /\{#if enlarged && item !== undefined\}([\s\S]*)\{\/if\}\s*<\/dialog>/.exec(mediaGallery)?.[1] ?? '';
  assert.ok(stage.length > 0, 'the stage branch is not where this pin expects it');
  assert.match(stage, /src=\{item\.fullSrc\}/, 'the full derivative loads inside the stage branch');
  assert.doesNotMatch(mediaGallery.replace(stage, ''), /fullSrc/, 'and nowhere else');
  assert.match(stage, /<source media=\{`\(max-width: \$\{item\.previewWidth\}px\)`\} srcset=\{item\.previewSrc\} \/>/, 'a phone gets the preview rung the manifest measured (issue 241)');
  assert.match(mediaGallery, /aria-label="Close enlarged photograph"/);
  assert.match(mediaGallery, /async function onDialogClose\(\): Promise<void> \{\s*enlarged = false;\s*await tick\(\);\s*openerEl\?\.focus\(\);/, 'closing hands focus back to the tile that opened the stage');
  assert.match(mediaGallery, /if \(event\.key === 'ArrowRight'\) next\(\);\s*else if \(event\.key === 'ArrowLeft'\) previous\(\);/);
  assert.match(mediaGallery, /if \(event\.target === dialogEl\) dialogEl\?\.close\(\);/, 'the backdrop closes it');
});

test('the stage pages the stills with prev/next, the arrow keys and a swipe — all inside 44px targets — and wraps at both ends', () => {
  assert.match(mediaGallery, /const stills = \$derived\(visible\.filter\(\(candidate\) => candidate\.video === undefined\)\);/, 'a film is played where it sits, never paged onto the stage');
  assert.match(mediaGallery, /index = \(shown \+ 1\) % total;/);
  assert.match(mediaGallery, /index = \(shown - 1 \+ total\) % total;/);
  assert.match(mediaGallery, /data-gallery-nav="previous"/);
  assert.match(mediaGallery, /data-gallery-nav="next"/);
  assert.match(galleryStyle, /\.gallery-nav \{[^}]*inline-size: var\(--control-target\);\s*block-size: var\(--control-target\);/);
  assert.match(mediaGallery, /<div class="gallery-stage" use:swipeHorizontal=\{swipe\}>/);
  assert.match(galleryStyle, /\.gallery-stage \{[^}]*touch-action: pan-y;/, 'the swipe never contests the page’s vertical scroll');
  assert.match(mediaGallery, /commit: \(direction: -1 \| 1\) => \(direction === 1 \? next\(\) : previous\(\)\),/);
  assert.doesNotMatch(mediaGallery, /dragX|armSettle|entryOffset|settleMs/, 'the drag-follow strip and its settle went with the strip');
  assert.match(mediaGallery, /aria-live="polite"/, 'every move is announced as a sentence');
});

test('a film plays inline in its own tile behind one play control — one at a time, never in the dialog, and nothing autoplays (issues 233, 243, 207)', () => {
  const filmTile = /<div class="gallery-tile" data-gallery-kind="video">([\s\S]*?)<\/div>\s*\{:else\}/.exec(mediaGallery)?.[1] ?? '';
  assert.ok(filmTile.length > 0, 'the film tile is not where this pin expects it');
  assert.match(filmTile, /<video\s+class="gallery-player"\s+controls=\{playingKey === tile\.key\}\s+playsinline\s+preload="metadata"\s+poster=\{tile\.video\.posterSrc\}/);
  assert.doesNotMatch(mediaGallery, /\bautoplay\b/, 'no element ever carries the attribute');
  assert.equal((mediaGallery.match(/\.play\(/g) ?? []).length, 1, 'exactly one call ever starts a film');
  assert.match(mediaGallery, /function startFilm\(key: string\): void \{\s*playingKey = key;\s*void players\[key\]\?\.play\(\)\.catch\(\(\) => \{\}\);/);
  assert.match(filmTile, /onclick=\{\(\) => startFilm\(tile\.key\)\}/, 'and it is the press on the control');
  assert.match(filmTile, /onended=\{\(\) => \(playingKey = undefined\)\}/, 'a finished film hands its tile back');
  const stage = /\{#if enlarged && item !== undefined\}([\s\S]*)\{\/if\}\s*<\/dialog>/.exec(mediaGallery)?.[1] ?? '';
  assert.doesNotMatch(stage, /<video/, 'the dialog never holds a player');
  assert.match(galleryStyle, /\.gallery-tile \{[^}]*background: var\(--gallery-stage-ground\);/, 'a poster in flight sits on a ground, not a hole (issue 239)');
  assert.match(galleryStyle, /\.gallery-player \{[^}]*object-fit: contain;/, 'the film reduces inside the square rather than the square growing (issue 243)');
});

test('the media sets are data: kind-derived by default, named by the manifest, chrome only when there is a choice (issue 275)', () => {
  assert.match(mediaGallery, /return candidate\.set \?\? \(candidate\.video === undefined \? 'Photographs' : 'Videos'\);/);
  assert.match(mediaGallery, /const sets = \$derived\(\[\.\.\.new Set\(items\.map\(setOf\)\)\]\);/, 'a set exists exactly when something is in it');
  assert.match(mediaGallery, /\{#if sets\.length > 1\}\s*<div class="gallery-sets" role="group" aria-label="Media set">/, 'one set draws no switch');
  assert.match(mediaGallery, /aria-pressed=\{name === activeSet\}/);
  /* THE SET'S WORD MOVED TO THE ACCESSIBLE NAME (owner design decision,
     2026-09-11, issue 313) and the figure stayed visible, because a count is a
     fact and "Photographs" was a label. The mark is decided by what the set
     HOLDS, the same rule the default name already follows, so a manifest that
     names its own set still gets the right drawing. */
  assert.match(mediaGallery, /<Icon name=\{setGlyph\(name\)\} slot="row" \/> · \{countOf\(name\)\}/, 'each set states its own count');
  assert.match(mediaGallery, /aria-label=\{`\$\{name\} · \$\{countOf\(name\)\}`\}/, 'a mark-only segment with no accessible name');
  assert.match(
    mediaGallery,
    /return members\.every\(\(candidate\) => candidate\.video !== undefined\) \? 'film' : 'photo';/,
    'a set reads as film only when every member is one; a mixed set is pictures'
  );
  assert.match(mediaGallery, /chosenSet = name;\s*playingKey = undefined;\s*index = 0;/, 'a set change hands every film back and returns the stage to the start');
  assert.match(galleryStyle, /\.gallery-set \{[^}]*min-inline-size: var\(--control-target\);\s*min-block-size: var\(--control-target\);/);
});

test('the gallery states no colour or length of its own — every dimension is a token', () => {
  const rules = galleryStyle.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, 'no colour literal');
  for (const line of rules.split('\n').filter((candidate) => /^\s*color:|^\s*background(-color)?:|border-color:/.test(candidate))) {
    assert.match(line, /var\(--|inherit|transparent|none/, `a colour must come from a token: ${line.trim()}`);
  }
  assert.doesNotMatch(rules, /\d(\.\d+)?(rem|em|vw|vh)\b(?![^{]*svh)/, 'no rem/em/viewport literal');
  for (const px of rules.match(/-?\d+px/g) ?? []) {
    assert.ok(['2px', '-2px', '-4px', '999px'].includes(px), `the only px literals are the focus ring and the pill radius, not ${px}`);
  }
  const svh = rules.match(/80svh/g) ?? [];
  assert.equal(svh.length, 1);
  assert.match(rules, /@supports \(max-block-size: 1svh\) \{\s*\.gallery-lightbox-image \{\s*max-block-size: 80svh;/, 'the dynamic unit is guarded, over a token base');
});

test('the close mark is small, off the artwork and a 44px target; the scrim and the stage caps are tokens (issue 202)', () => {
  assert.match(mediaGallery, /class="icon-button gallery-lightbox-close"/, 'the page’s own icon control, 44px by its class');
  assert.match(galleryStyle, /\.gallery-lightbox-close \{[^}]*inset-block-start: 0;\s*inset-inline-end: 0;/);
  assert.match(galleryStyle, /\.gallery-close-mark \{[^}]*inline-size: var\(--gallery-close-size\);\s*block-size: var\(--gallery-close-size\);/);
  assert.match(galleryStyle, /\.gallery-lightbox \{[^}]*padding: var\(--gallery-close-lane\) 0 0;/, 'the mark sits in its own lane above the picture');
  assert.match(galleryStyle, /\.gallery-lightbox::backdrop \{\s*background: var\(--gallery-scrim\);/);
  assert.match(galleryStyle, /max-inline-size: var\(--gallery-lightbox-max-inline\);[\s\S]*max-block-size: var\(--gallery-image-max-block\);/);
});

/* TWO LAYERS, NOT THE SET (owner directive, 2026-09-03, issue 287). The band
 * is handed EVERY vendored texture so a mode switch can crossfade across sets,
 * and it mounts only the texture showing and the one it left — eight files on
 * first paint was the cost of mounting them all. Pinned where it is decided;
 * the rendering lane "the picture band mounts the texture showing and the one
 * it left" counts the mounted layers in the browser. */
test('the texture band is handed the whole set and mounts only the picture showing and the one it left', async () => {
  const band = await readFile(new URL('../src/lib/components/TextureBand.svelte', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8');
  assert.match(app, /layers=\{bandTextures\}/, 'the band is handed every vendored texture, which is what makes the mount rule matter');
  assert.match(band, /let recent = \$state<string\[\]>\(\[\]\);/, 'the band remembers which files it has shown');
  assert.match(
    band,
    /recent = \[active, \.\.\.recent\.filter\(\(file\) => file !== active\)\]\.slice\(0, 2\);/,
    'the memory is the active file and the one before it, never longer'
  );
  assert.match(
    band,
    /const mounted = \$derived\(layers\.filter\(\(layer\) => recent\.includes\(layer\.file\)\)\);/,
    'what mounts is the remembered pair, filtered from the set'
  );
  assert.match(band, /\{#each mounted as layer \(layer\.file\)\}/, 'the template iterates the mounted pair');
  assert.doesNotMatch(band, /\{#each layers as layer/, 'iterating the whole set is the first-paint cost this rule removes');
});
