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
import { readdir, readFile, stat } from 'node:fs/promises';
import test from 'node:test';

import { relativeAge } from '../src/lib/age.ts';
import { recordedOutOfBand, section, sectionHref, staticBlock } from '../src/lib/blocks.ts';
import { feedCardRegions, feedCardVariants, formatIsoDate } from '../src/lib/feed.ts';
import {
  roleLedgerProps,
  workCollapseLabel,
  workEntries,
  workExpandLabel,
} from '../src/lib/work.ts';
import {
  codingProjectsPanelId,
  projectCounts,
  projectHost,
  projectLinkLabel,
  projects,
  projectsCapturedOn,
  projectsEmptyNote,
  projectsStaleAfterMs,
  projectsStaleNote,
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
  ledgerTable,
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
  read('../src/lib/components/LedgerTable.svelte'),
  read('../src/lib/components/MediaGallery.svelte'),
]);

/* The binding modules that introduce each block to the page; they import
 * components, so they are source-pinned rather than executed. */
const workSource = await read('../src/lib/work.ts');

const [workBinding, mediaBinding, projectsBinding, galleryModule] = await Promise.all([
  read('../src/lib/blocks/workHistory.ts'),
  /* Renamed with its section (owner directive of 2026-09-03, issue 287): the
     gallery is the sheet's own fifth section rather than half of Projects, so
     the block that mounts it is named for the media it carries. */
  read('../src/lib/blocks/mediaGallery.ts'),
  read('../src/lib/blocks/codingProjects.ts'),
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
const [commitLog, ledgerBoard, ticker] = await Promise.all([
  read('../src/lib/components/CommitLog.svelte'),
  read('../src/lib/components/LedgerBoard.svelte'),
  read('../src/lib/components/Ticker.svelte'),
]);

const contentComponents = {
  LedgerLog: ledgerLog,
  LedgerTable: ledgerTable,
  CommitLog: commitLog,
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
 * captured id and label is then driven through the EXECUTED constructor the
 * manifest is written in, so the assertions bind to the real page rather
 * than to a copy of it. */
const manifestSections = [...manifest.matchAll(
  /section\('([a-z-]+)', '([^']+)', \[([^\]]*)\](?:, (\{ layout: 'stack' \}))?\)/g
)].map(([, id, label, blocks, stack]) => ({
  id,
  label,
  blocks: blocks.split(',').map((name) => name.trim()).filter(Boolean),
  layout: stack ? 'stack' : 'flow',
}));

// ---------------------------------------------------------------------------
// The manifest, the nav, and the sections it points at
// ---------------------------------------------------------------------------

/* FIVE SECTIONS, updated deliberately for the owner directive of 2026-09-03
 * (issue 287): the ledger gives each of the owner's five headings a numbered
 * section of its own. Commits leaves the trackers stack to lead a section that
 * cycles one calendar between three daily series, and the gallery leaves
 * Projects, where it had been a subheading, for the sheet's last section. The
 * IDS of the three surviving sections do not move — an id is the fragment a
 * nav link jumps to and an address a reader may already have shared. */
test('the manifest names the owner’s five sections, in the order the page stacks them', () => {
  assert.deepEqual(
    manifestSections.map((entry) => entry.label),
    ['Professional Experience', 'Projects', 'Commits', 'Trackers', 'Gallery'],
    'the section labels are the owner’s words and their order is the page’s order'
  );
  assert.deepEqual(
    manifestSections.map((entry) => entry.id),
    ['work', 'projects', 'commits', 'trackers', 'gallery']
  );
  assert.deepEqual(
    manifestSections.map((entry) => entry.blocks),
    [
      ['workHistory'],
      ['codingProjects'],
      ['commitLog'],
      ['tokenSquares', 'bossTicker'],
      ['mediaGallery'],
    ],
    'each section holds exactly its blocks; reordering the page is moving one name here'
  );
  assert.deepEqual(
    manifestSections.map((entry) => entry.layout),
    ['flow', 'flow', 'stack', 'stack', 'flow'],
    'the two panel stacks are the sections whose blocks share one column'
  );
  // The constructors the manifest is written in, executed with its own ids:
  // the id in, the id out, the layout defaulted to flow, and the href built
  // by a function rather than concatenated in markup — a lost '#' is one red
  // test instead of four links to the page root.
  for (const entry of manifestSections) {
    const built = section(entry.id, entry.label, [], entry.layout === 'stack' ? { layout: 'stack' } : {});
    assert.equal(built.id, entry.id);
    assert.equal(built.label, entry.label);
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

test('every nav link lands on the section the manifest renders', () => {
  // Structural now, not counted: the nav and the sections read the SAME
  // manifest entry, so a link cannot point at a section nobody rendered.
  assert.match(sectionNav, /import \{ page \} from '\.\.\/\.\.\/page\.ts'/);
  assert.match(sectionNav, /\{#each page as section \(section\.id\)\}/);
  assert.match(sectionNav, /href=\{sectionHref\(section\)\}/);
  assert.match(sectionNav, /class="section-link"/);
  assert.match(pageSectionSource, /<section class="page-section" id=\{section\.id\}/);
  /* The ordinal the ledger's section head prints is derived from the
     manifest's own position (owner directive of 2026-09-03, issue 287), so a
     section moved in src/page.ts renumbers itself and two sections can never
     claim the same number. */
  assert.match(
    app,
    /\{#each page as section, position \(section\.id\)\}\s*<PageSection \{section\} ordinal=\{String\(position \+ 1\)\.padStart\(2, '0'\)\} \/>/
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
    /<div class="section-head">\s*<span class="section-number" aria-hidden="true">\{ordinal\}<\/span>/
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
    for (const field of ['company', 'short', 'years', 'role', 'dates', 'location', 'site']) {
      assert.ok(entry[field].trim().length > 0, `an experience entry has an empty ${field}`);
    }
    /* The employer's own home on the web (issue 243), and it is checked rather
       than merely present: an absolute https origin, no credentials, no query,
       no path pretending to be one. A relative or http value would render an
       anchor the reader could press and the site could not honour. */
    const site = new URL(entry.site);
    assert.equal(site.protocol, 'https:', `${entry.company} links over ${site.protocol}`);
    assert.equal(site.username, '', `${entry.company}'s link carries credentials`);
    assert.equal(site.search, '', `${entry.company}'s link carries a query string`);
    assert.ok(site.hostname.includes('.'), `${entry.company} links to ${site.hostname}`);
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
    /staticBlock\('work-history', LedgerLog, roleLedgerProps\)/,
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
    roleLedgerProps.rows.map((row) => [row.key, row.span, row.name, row.role, row.place, row.points]),
    workEntries.map((entry) => [
      entry.company,
      entry.years,
      entry.short,
      entry.role,
      entry.location,
      entry.points,
    ])
  );
  /* THE EMPLOYER LINK SURVIVES AND MOVES (issue 243, carried into the ledger):
     the row itself is the disclosure control now, and an anchor inside a
     button is invalid content no keyboard can reach — so the link renders
     inside the drawer, still the employer's own public home, still opened in a
     new tab, still saying so in its accessible name. */
  assert.deepEqual(
    roleLedgerProps.rows.map((row) => [row.link.text, row.link.href, row.link.label]),
    workEntries.map((entry) => [
      entry.company,
      entry.site,
      `${entry.company}, opens in a new tab`,
    ])
  );
  assert.match(ledgerLog, /<a\s+class="ledger-link"/);
  assert.match(ledgerLog, /target="_blank"/);
  assert.match(ledgerLog, /rel="noopener noreferrer"/);
  assert.match(ledgerLog, /aria-label=\{row\.link\.label\}/);
  assert.deepEqual(
    [...ledgerLog.matchAll(/href=\{([^}]*)\}/g)].map(([, expression]) => expression),
    ['row.link.href'],
    'the ledger may render exactly the one validated href and construct none'
  );
  /* The chevron's words are DATA, so the component composes no sentence: a
     component that wrote "Expand Fathom5" would be a component with an opinion
     about English. */
  assert.equal(roleLedgerProps.expandLabel, workExpandLabel);
  assert.equal(roleLedgerProps.collapseLabel, workCollapseLabel);
  assert.match(ledgerLog, /aria-label=\{`\$\{open \? collapseLabel : expandLabel\} \$\{row\.name\}`\}/);
  /* And the row is a REAL disclosure: a button with aria-expanded, so the
     drawer is operable by keyboard and announced as a state rather than being
     a div that happens to listen for clicks. */
  assert.match(ledgerLog, /<button\s+class="ledger-row"\s+type="button"\s+aria-expanded=\{open\}/);
  // Collapsed by default: the section opens as a summary and expands on
  // request, which is what the owner asked for.
  assert.match(ledgerLog, /let opened = \$state\(new Set<string>\(\)\)/);
  // An empty roster says so rather than rendering nothing at all.
  assert.equal(roleLedgerProps.emptyNote.trim().length > 0, true);
  assert.match(ledgerLog, /\{#if rows\.length === 0\}\s*<p class="ledger-note">\{emptyNote\}<\/p>/);
});

/* THE SAME DOCTRINE, ONE SHAPE FEWER (owner directive of 2026-09-03, issue
 * 287). The card carried two body regions — a paragraph and a points list —
 * and drew each only when it held something, because a card that reserved an
 * empty <p> for content it did not have was the defect. The ledger splits
 * those two across two surfaces: the log's drawer holds the points, the
 * table's row holds the one-line summary. So the claim below is the same claim
 * against each of them — nothing this site ships is a row with nothing to say
 * — checked over every adapter that feeds either. */
test('a row draws only the body it has, and every shipped row has one', () => {
  // The drawer is a region drawn from data, and the row's own points are what
  // fill it; an entry with none would open onto an empty box.
  assert.match(ledgerLog, /\{#each row\.points as point, index \(index\)\}/);
  for (const row of roleLedgerProps.rows) {
    assert.ok(row.points.length > 0, `the ledger ships "${row.key}" with an empty drawer`);
  }
  // The table's summary is the other half, and a repository the host carries
  // no description for renders the honest dash rather than an empty cell.
  for (const row of projectTableProps(null).rows) {
    assert.ok(
      row.summary.trim().length > 0,
      `the projects table ships "${row.key}" with neither a description nor a dash`
    );
  }
  assert.match(ledgerTable, /<span class="table-summary">\{row\.summary\}<\/span>/);
});

// ---------------------------------------------------------------------------
// Projects: the coding half
// ---------------------------------------------------------------------------

test('the seven repositories are the owner’s, at the addresses the owner gave', () => {
  // SEVEN, exactly, and the equality is the pin (owner ruling, corrected in
  // issue 256: the foobar2000-* trio stays): this section is a curated set
  // rather than a sweep of an account, so a repository appearing here that
  // the owner did not put here is the failure this test exists to catch.
  // Relaxing it to a floor would let exactly that through.
  assert.equal(projects.length, 7);
  // The exact URLs, verbatim from the owner's list. The host is written once
  // and the row supplies its name, so this pin proves the derivation as well
  // as the addresses.
  assert.deepEqual(projects.map(projectUrl), [
    'https://github.com/snaraj/naranjo.online',
    'https://github.com/snaraj/website-infrastructure',
    'https://github.com/snaraj/lidersea.com',
    'https://github.com/snaraj/dotfiles',
    'https://github.com/snaraj/foobar2000-lyricsbuddy',
    'https://github.com/snaraj/foobar2000-library-visualizer',
    'https://github.com/snaraj/foobar2000-album-visualizer',
  ]);
  for (const project of projects) {
    assert.ok(project.description.trim().length > 0, `${project.name} has no description`);
    for (const count of [project.commits, project.stars]) {
      assert.ok(
        Number.isInteger(count) && count >= 0,
        `${project.name} carries a count that is not a whole number of things`
      );
    }
  }
  // The adapter hands the log exactly those addresses and labels, and an
  // outbound link says where it goes and that it leaves the page.
  assert.equal(
    projectLinkLabel(projects[0]),
    'naranjo.online on GitHub, opens in a new tab'
  );
  const captured = projectTableProps(null);
  /* Compared against the feed's OWN order (issue 252) rather than the module
     list's, because they are no longer the same thing: the module list is a
     maintenance order and the table is sorted by last push. Sorting the
     expectation the same way keeps this test about identity — every row's
     name, address and accessible name derived from the captured row — and
     leaves the ordering claim to the test that exists for it.

     The table shows the four most recently pushed (owner directive of
     2026-09-03, issue 287). The roster count it used to print above them is
     gone (owner directive, 2026-09-04, issue 292). */
  const byPush = projects.toSorted(
    (left, right) => Date.parse(right.pushedAt) - Date.parse(left.pushedAt)
  );
  assert.equal(shownProjectRows, 4);
  assert.deepEqual(
    captured.rows.map((row) => [row.link.text, row.link.href, row.link.label, row.summary]),
    byPush
      .slice(0, shownProjectRows)
      .map((project) => [
        project.name,
        projectUrl(project),
        projectLinkLabel(project),
        project.description,
      ])
  );
  assert.equal(captured.caption, undefined, 'the roster caption came back (owner cut it, issue 292)');
  assert.deepEqual([...projectTableHeads], ['Repository', 'Description', 'Stars', 'Open', 'PRs', 'Pushed']);
  assert.match(ledgerTable, /target="_blank"/);
  assert.match(ledgerTable, /rel="noopener noreferrer"/);
  assert.match(ledgerTable, /aria-label=\{row\.link\.label\}/);
  // The table renders the href it is handed and never assembles one.
  assert.deepEqual(
    [...ledgerTable.matchAll(/href=\{([^}]*)\}/g)].map(([, expression]) => expression),
    ['row.link.href'],
    'the table may render exactly the one validated href and construct none'
  );
});

test('a count of one is a count of one thing', () => {
  // "1 commits" is the small lie a page tells when nobody executes its
  // labels. Three of the seven tracked repositories genuinely carry a single
  // star and two a single commit, yet every case below is driven from a
  // SYNTHETIC row — the derivation has to be proven against the figures it
  // must handle, not against whichever figures the tracked repositories
  // happen to hold this week. The clock is FIXED so the third count — how
  // long since the last push (0.1.52) — is executed as arithmetic rather
  // than asserted around a moving now.
  const noon = Date.parse('2026-08-27T12:00:00Z');
  const row = { name: 'x', description: 'x', pushedAt: '2026-08-24T12:00:00Z' };
  // The open-work pair reports nothing without a panel row, so the trailing
  // two labels here are the honest not-reported sentence throughout; the
  // singular/plural of THOSE is executed by the icon test below.
  const unreported = ['open issues not reported', 'open pull requests not reported'];
  // Cluster order per the owner's sketch (issue 275): stars, freshness,
  // commits, then the open-work pair.
  assert.deepEqual(
    projectCounts({ ...row, commits: 1, stars: 1 }, undefined, noon).map((count) => count.label),
    ['1 star', 'updated 3 days ago', '1 commit', ...unreported]
  );
  assert.deepEqual(
    projectCounts({ ...row, commits: 0, stars: 20 }, undefined, noon).map((count) => count.label),
    ['20 stars', 'updated 3 days ago', '0 commits', ...unreported]
  );
  // Grouped through the same whole-number renderer every other figure on the
  // page uses, so a four-figure count does not suddenly read differently.
  assert.deepEqual(
    projectCounts({ ...row, commits: 1234, stars: 5678 }, undefined, noon).map((count) => count.label),
    ['5,678 stars', 'updated 3 days ago', '1,234 commits', ...unreported]
  );
  /* The freshness counter's own bands moved to lib/age.ts with the live clock
     (issue 268) and tests/age.test.mjs executes every one of them from both
     sides. What stays HERE is the seam: this adapter's second counter is that
     module's sentence about this row's push instant, and nothing in between.
     Pinned by reproduction rather than by restating a string, so the two
     cannot drift into two answers about one instant. */
  assert.equal(
    projectCounts({ ...row, commits: 1, stars: 1 }, undefined, noon)[1].label,
    relativeAge(row.pushedAt, noon).phrase
  );
  assert.equal(
    projectCounts({ ...row, commits: 1, stars: 1 }, undefined, noon)[1].value,
    relativeAge(row.pushedAt, noon).compact
  );
  /* And `since` is what keeps it alive: the component re-derives the figure
     from THIS instant on every minute-aligned tick, so an adapter that stopped
     carrying it would ship a counter frozen at whichever render caught it. */
  assert.equal(projectCounts({ ...row, commits: 1, stars: 1 }, undefined, noon)[1].since, row.pushedAt);
  // The adapter carries the same labels into the log, with the glyph beside
  // the words rather than instead of them. Against the feed's LEADING entry,
  // which is the most recently pushed repository rather than the module list's
  // first row (issue 252).
  const leading = projects.toSorted(
    (left, right) => Date.parse(right.pushedAt) - Date.parse(left.pushedAt)
  )[0];
  /* THE TABLE DRAWS FOUR OF THE FIVE COUNTERS (owner directive of 2026-09-03,
     issue 287: the columns are the owner's own list — Stars, Open, PRs,
     Pushed). The age has a column of its own rather than a place in the
     cluster, and the captured commit total left with the card that had room
     for it. What did NOT change is where each figure comes from: every one of
     them is still projectCounts' own counter, carried across whole — the same
     figure, the same sentence, the same detail, the same provenance mark. */
  const leadingRow = projectTableProps(null, noon).rows[0];
  const tableCounters = [leadingRow.counts[0], leadingRow.updated, ...leadingRow.counts.slice(1)];
  const cardCounters = projectCounts(leading, undefined, noon).filter(
    (count) => count.glyph !== 'node'
  );
  assert.deepEqual(
    tableCounters.map((count) => count.label),
    cardCounters.map((count) => count.label)
  );
  assert.deepEqual(
    tableCounters.map((count) => count.glyph),
    ['star', 'clock', 'issue', 'pull'],
    'each count names its generic glyph; the drawing is the component’s'
  );
  /* EVERY counter is terse now (issue 268): the glyph and a bare figure on the
     visible line, the whole sentence in the clipped span and in the detail.
     Both channels are checked, because dropping either one is the failure —
     the figure alone leaves the glyph carrying the meaning for a screen
     reader, and the words alone are the noise the owner removed. */
  for (const count of tableCounters) {
    assert.ok(
      typeof count.value === 'string' && count.value.length > 0,
      `${count.key} renders no visible figure`
    );
    assert.ok(count.label.length > 0, `${count.key} carries no sentence`);
    assert.equal(count.detail.name, count.label, `${count.key}'s detail does not name its phrase`);
  }
  // The figure is TEXT beside the glyph, never carried by the glyph alone.
  assert.match(ledgerTable, /\{count\.value\}/);
  assert.match(ledgerTable, /\{count\.label\}/);
  assert.match(ledgerTable, /aria-hidden="true"/);
});

test('a figure the origin recorded says so in its detail, never on the visible line (issue 268)', () => {
  /* The owner, of the inline italic mark repeated on every row: "stale, static
     and ugly ... just remove it". Provenance did NOT go with it — it moved one
     interaction away, into the same detail primitive the stat tiles use — so
     this pin is in two halves and both matter. */
  const noon = Date.parse('2026-08-27T12:00:00Z');
  /* The captured face marks EVERY figure it carries, because none of them was
     fetched live. The commit total the card used to show left with the card
     (owner directive of 2026-09-03, issue 287), so the star tally is what this
     pin reads now — the same claim about the same channel, on a figure the
     table still draws. */
  const captured = projectTableProps(null, noon).rows[0].counts;
  const stars = captured.find((count) => count.key === 'stars');
  assert.equal(stars.marked, true, 'the captured face is captured however the row is drawn');
  assert.deepEqual(
    stars.detail.rows,
    [{ label: '', value: recordedOutOfBand }],
    'a recorded figure carries no provenance row in its detail'
  );
  // The wording is the page's ONE constant, not a second copy of the sentence.
  assert.equal(recordedOutOfBand, 'recorded out of band, not fetched live');
  // And nothing on the visible line says it: the mark, its class and its
  // browser tooltip are gone from the component rather than merely unused.
  assert.doesNotMatch(ledgerTable, /entry-recorded|table-recorded/);
  assert.doesNotMatch(ledgerTable, /·\s*recorded/);
  // The reader still reaches it, through the page's one hover-detail
  // primitive rather than through a browser tooltip no phone can open.
  assert.match(ledgerTable, /<DetailTip detail=\{count\.detail\} \/>/);
  /* A DASH gets no provenance row. "not reported" and "recorded out of band"
     are different claims, and only one of them can be true of a figure that
     does not exist. */
  const unreported = captured.find((count) => count.key === 'issues');
  assert.equal(unreported.value, '—');
  assert.deepEqual(unreported.detail.rows, []);
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
    kind: 'coding-projects/v1',
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
    kind: 'coding-projects/v1',
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
    openIssues: 2,
    openPulls: 1,
  };
  const rendered = projectTableProps(projectsEnvelope([fresh]), now);
  assert.equal(rendered.rows.length, 1, 'the payload decides the roster, not the module list');
  const [entry] = rendered.rows;
  assert.equal(entry.link.text, 'born-this-morning');
  assert.equal(entry.link.href, `${projectHost}/born-this-morning`);
  assert.equal(entry.link.label, 'born-this-morning on GitHub, opens in a new tab');
  assert.equal(entry.summary, fresh.description);
  const byKey = new Map(entry.counts.map((count) => [count.key, count]));
  assert.equal(byKey.get('stars').value, '1');
  assert.equal(byKey.get('issues').value, '2');
  assert.equal(byKey.get('pulls').value, '1');
  /* A repository the capture never saw still renders its live figures. The
     card carried a captured commit total the table has no column for, so what
     the honest-dash rule is read on here is the figure that CAN be absent from
     a live row: an open-work tally the payload does not carry. */
  const noTallies = projectTableProps(
    projectsEnvelope([{ ...fresh, openIssues: undefined, openPulls: undefined }]),
    now
  );
  const absent = noTallies.rows[0].counts.find((count) => count.key === 'issues');
  assert.equal(absent.value, '—');
  assert.equal(absent.label, 'open issues not reported');
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

test('a card looks stale when its envelope says so (issue 281, defect 2)', () => {
  const now = Date.parse('2026-09-01T12:30:00Z');
  const repos = [{ name: 'fine', description: 'x', stars: 1, pushedAt: '2026-09-01T11:00:00Z' }];
  // A fresh ok panel carries no note, and neither does the pre-envelope face.
  assert.equal(projectTableProps(projectsEnvelope(repos), now).staleNote, undefined);
  assert.equal(projectTableProps(null, now).staleNote, undefined);
  // The non-ok fixture: the origin says stale, and the card SAYS SO, dated by
  // the envelope's own generatedAt — status plus timestamp, nothing invented.
  const stale = projectTableProps(
    projectsEnvelope(repos, { status: 'stale', generatedAt: '2026-09-01T07:30:00Z' }),
    now
  );
  assert.equal(stale.staleNote, 'stale · data as of 5h ago');
  // The status half ALONE, unmasked by age: a refused-row round marks the
  // envelope stale while stamping a CURRENT generatedAt (defect 1's refusal
  // path), so the timestamp above — 5h old, past the 2h threshold — cannot
  // distinguish the origin's verdict from mere aging. This fixture can: five
  // minutes old, well inside the threshold, the note must come from the
  // status. Review receipt 5497788881 caught this input missing.
  const freshStale = projectTableProps(
    projectsEnvelope(repos, { status: 'stale', generatedAt: '2026-09-01T12:25:00Z' }),
    now
  );
  assert.equal(freshStale.staleNote, 'stale · data as of 5m ago');
  // Unavailable renders the captured face and says which face it is.
  const unavailable = projectTableProps(
    projectsEnvelope([], { status: 'unavailable', generatedAt: undefined, data: null }),
    now
  );
  assert.equal(unavailable.staleNote, 'live repository data unavailable · showing captured figures');
  assert.equal(unavailable.rows.length, shownProjectRows);
  // An ok envelope whose generatedAt stopped advancing is the wedged-loop
  // state a status alone cannot see: past the threshold the card says so.
  const wedged = projectsEnvelope(repos, {
    generatedAt: new Date(now - projectsStaleAfterMs - 60_000).toISOString(),
  });
  assert.match(projectTableProps(wedged, now).staleNote, /^stale · data as of /);
  // Executed at the seam too: the note builder itself, from both sides of
  // the threshold, so the boundary is arithmetic rather than luck.
  assert.equal(
    projectsStaleNote(projectsEnvelope(repos, { generatedAt: new Date(now - projectsStaleAfterMs + 60_000).toISOString() }), now),
    undefined
  );
  assert.notEqual(
    projectsStaleNote(projectsEnvelope(repos, { generatedAt: new Date(now - projectsStaleAfterMs - 60_000).toISOString() }), now),
    undefined
  );
});

/* THE STALE LINE MOVED TO THE ONE ROW EVERY PANEL ALREADY RESERVES (owner
 * directive of 2026-09-03, issue 287). The entry log rendered it above its own
 * list; the ledger's blocks render through PanelShell, whose head is the row
 * the card holds open for exactly "a later addition beside the title" — which
 * is where the calendar's own data-through line already went at issue 285. One
 * idiom, one place, one geometry, and it costs no layout shift because the row
 * is reserved whether or not there is a line for it.
 *
 * The claim is unchanged: the note renders only when the adapter proved there
 * is one, it reaches the reader BEFORE the figures it qualifies, and a static
 * surface passes none. */
test('the table renders its stale line in the reserved head, and only when it has one', async () => {
  const shell = await read('../src/lib/components/PanelShell.svelte');
  assert.match(ledgerTable, /<PanelShell \{title\} \{status\} \{generatedAt\} note=\{staleNote\}>/);
  assert.match(shell, /\{#if note\}<span class="panel-note" data-panel-note>\{note\}<\/span>\{\/if\}/);
  assert.ok(
    shell.indexOf('data-panel-note') < shell.indexOf('<div class="panel-body">'),
    'the stale line renders after the figures it qualifies'
  );
  // The static work history has no envelope and therefore no line to render;
  // its props carry no channel for one at all.
  assert.equal(roleLedgerProps.staleNote, undefined, 'the static work history grew a stale note');
  // The line is a token-inked reading, not an italic apology.
  assert.match(styleBlock(shell), /\.panel-note \{[^}]*color: var\(--panel-muted/s);
});

test('open issues and open pull requests are told with icons and a number (issue 252)', () => {
  const noon = Date.parse('2026-08-29T12:00:00Z');
  const project = { name: 'x', description: 'x', commits: 1, stars: 1, pushedAt: '2026-08-29T09:00:00Z' };
  const live = {
    name: 'x',
    description: 'x',
    stars: 1,
    pushedAt: '2026-08-29T09:00:00Z',
    openIssues: 1,
    openPulls: 4
  };
  const [, , , issues, pulls] = projectCounts(project, live, noon);
  // The owner's instruction: the CARD does not read "open prs". The visible
  // channel is the glyph and the figure...
  assert.equal(issues.value, '1');
  assert.equal(pulls.value, '4');
  // ...and the words are in the accessible name, complete and plural-correct,
  // so the icon is never the only thing carrying the meaning.
  assert.equal(issues.label, '1 open issue');
  assert.equal(pulls.label, '4 open pull requests');
  assert.equal(
    projectCounts(project, { ...live, openIssues: 2, openPulls: 1 }, noon)[4].label,
    '1 open pull request'
  );

  // A tally the payload does not carry is a DASH, never a zero: those are
  // different claims and only one of them is supported.
  const [, , , unknownIssues, unknownPulls] = projectCounts(project, { ...live, openIssues: undefined, openPulls: undefined }, noon);
  assert.equal(unknownIssues.value, '—');
  assert.equal(unknownIssues.label, 'open issues not reported');
  assert.equal(unknownPulls.value, '—');
  // A REPORTED zero is a measurement and renders as one.
  assert.equal(projectCounts(project, { ...live, openIssues: 0 }, noon)[3].value, '0');
  assert.equal(projectCounts(project, { ...live, openIssues: 0 }, noon)[3].label, '0 open issues');

  // The component draws both glyphs in the page's own language — one ink,
  // bound to currentColor — so a forced-colours or monochrome render keeps
  // them, and marks them decorative because the accessible name is the text.
  for (const glyph of ["count.glyph === 'star'", "count.glyph === 'issue'"]) {
    assert.ok(ledgerTable.includes(glyph), `the table draws no ${glyph} branch`);
  }
  assert.equal(
    [...ledgerTable.matchAll(/(?:fill|stroke)="(?!none)([^"]*)"/g)].every(
      ([, paint]) => paint === 'currentColor'
    ),
    true,
    'a glyph paints an ink that is not currentColor'
  );
  /* The words are hidden by CLIPPING, never by display:none or hidden, both of
     which would take them out of the accessibility tree and leave the glyph
     carrying the figure alone. The class moved with the surface (owner
     directive of 2026-09-03, issue 287) and its rule moved to styles.css with
     every other page-level row decision; the technique is byte-identical. */
  assert.match(ledgerTable, /<span class="table-clipped">\{count\.label\}<\/span>/);
  assert.match(styles, /\.table-clipped \{[^}]*clip-path: inset\(50%\)/s);
  assert.doesNotMatch(styles, /\.table-clipped \{[^}]*display: none/s);
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
  assert.match(
    rowRules[0],
    /grid-template-columns:\s*[0-9.]+rem minmax\(0, 1fr\)/,
    'the description column must shrink under a long line instead of pushing the counters'
  );
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
     1.5rem gaps — come to 680px, so a page column narrower than that overflows
     the document sideways, which happened between 641px and 711px. The
     restack now happens at 720px, where the wide layout genuinely stops
     fitting. */
  const phoneWidths = new Set(
    [...styles.matchAll(/@media \(max-width: ([^)]+)\)/g)].map(([, width]) => width.trim())
  );
  assert.equal(phoneWidths.size, 1, `the sheet disagrees about where a phone ends: ${[...phoneWidths].join(', ')}`);
  assert.match(styles, /@media \(max-width: 45rem\)[\s\S]*?\.table-head \{\s*display: none;/);
  assert.match(styles, /@media \(max-width: 45rem\)[\s\S]*?\.table-row \{[^}]*grid-template-areas:/);
  /* And the phone's restack places each counter in a track of its own. Three
     counters sharing ONE grid area are three counters drawn on top of each
     other — measured at 390px before this pin existed — so the count of them
     is held at both ends: the desktop track list reserves exactly three, and
     the phone names exactly three placements. */
  assert.equal(projectTableProps(null, noonPlacement).rows[0].counts.length, 3);
  for (const nth of [3, 4, 5]) {
    assert.match(
      styles,
      new RegExp(`@media \\(max-width: 45rem\\)[\\s\\S]*?\\.table-count:nth-child\\(${nth}\\) \\{\\s*grid-area:`),
      `the phone gives the row's child ${nth} no track of its own`
    );
  }

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
  assert.match(ledgerTable, /<span class="table-clipped">\{count\.label\}<\/span>/);
  /* Both are focus stops (owner directive, 2026-09-03, issue 287): each
     carries a detail, and a detail only a pointer can open is half the
     feature — the same reason the retired stat tiles carried a tabindex. */
  assert.match(ledgerTable, /<span class="table-age" tabindex="0" aria-label=\{row\.updated\.label\}>/);
  assert.match(ledgerTable, /<span class="table-count" tabindex="0" aria-label=\{count\.label\}>/);
  assert.match(styles, /\.table-count:focus-visible,\s*\.table-age:focus-visible \{[^}]*outline: 2px solid var\(--color-accent\)/);
  const clipped = /\.table-clipped \{([^}]*)\}/.exec(styles)?.[1] ?? '';
  assert.match(clipped, /clip-path:\s*inset\(50%\)/);
  assert.doesNotMatch(clipped, /display:\s*none/);
});

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
  assert.match(mediaGallery, /\{name\} · \{countOf\(name\)\}/, 'each set states its own count');
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
