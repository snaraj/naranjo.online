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

import { section, sectionHref, staticBlock } from '../src/lib/blocks.ts';
import { feedCardRegions, feedCardVariants, formatIsoDate } from '../src/lib/feed.ts';
import { workByline, workBylineSeparator, workEntries, workHistoryProps } from '../src/lib/work.ts';
import {
  codingProjectsProps,
  projectCounts,
  updatedLabel,
  projectHost,
  projectLinkLabel,
  projects,
  projectsCapturedOn,
  projectUrl,
} from '../src/lib/projects.ts';
import {
  galleryHeight,
  galleryLicenseNote,
  galleryPhotos,
  gallerySourceLinkLabel,
  galleryWidth,
} from '../src/lib/gallery.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const [app, styles, manifest, feedCard, sectionNav, pageSectionSource, blockHost, entryLog, mediaGallery] =
  await Promise.all([
    read('../src/App.svelte'),
    read('../src/styles.css'),
    read('../src/page.ts'),
    read('../src/lib/components/FeedCard.svelte'),
    read('../src/lib/components/SectionNav.svelte'),
    read('../src/lib/components/PageSection.svelte'),
    read('../src/lib/components/Block.svelte'),
    read('../src/lib/components/EntryLog.svelte'),
    read('../src/lib/components/MediaGallery.svelte'),
  ]);

/* The binding modules that introduce each block to the page; they import
 * components, so they are source-pinned rather than executed. */
const workSource = await read('../src/lib/work.ts');

const [workBinding, artBinding, projectsBinding, galleryModule] = await Promise.all([
  read('../src/lib/blocks/workHistory.ts'),
  read('../src/lib/blocks/artGallery.ts'),
  read('../src/lib/blocks/codingProjects.ts'),
  /* The data module is executed above; its SOURCE is read too, because the
     optionality of a TypeScript field is erased before Node ever sees it —
     "this entry has no title" and "this field may be absent" are different
     claims and only one of them survives to runtime. */
  read('../src/lib/gallery.ts'),
]);

/* The generic components this architecture renders the page through. */
const introduced = {
  FeedCard: feedCard,
  SectionNav: sectionNav,
  PageSection: pageSectionSource,
  Block: blockHost,
  EntryLog: entryLog,
  MediaGallery: mediaGallery,
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

test('the manifest names the owner’s three sections, in the order the page stacks them', () => {
  assert.deepEqual(
    manifestSections.map((entry) => entry.label),
    ['Professional Experience', 'Projects', 'Trackers'],
    'the section labels are the owner’s words and their order is the page’s order'
  );
  assert.deepEqual(
    manifestSections.map((entry) => entry.id),
    ['work', 'projects', 'trackers']
  );
  assert.deepEqual(
    manifestSections.map((entry) => entry.blocks),
    [
      ['workHistory'],
      ['codingProjects', 'artGallery'],
      ['tokenUsage', 'vcsActivity', 'osrsStats'],
    ],
    'each section holds exactly its blocks; reordering the page is moving one name here'
  );
  assert.deepEqual(
    manifestSections.map((entry) => entry.layout),
    ['flow', 'flow', 'stack'],
    'the trackers section is the one panel stack'
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
  assert.match(app, /\{#each page as section \(section\.id\)\}\s*<PageSection \{section\} \/>/);
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

test('the page stacks the name, the nav and the sections in one column', () => {
  // The nav sits WITH the name (owner sketch: the links are under it), not one
  // page gap away from it.
  assert.match(app, /<div class="page-intro">\s*<h1 id="page-title">[^<]+<\/h1>\s*<SectionNav \/>/);
  // The trackers are one section of the page rather than the whole of it, and
  // the panel stack renders behind the manifest's one stack layout.
  assert.match(
    pageSectionSource,
    /\{#if section\.layout === 'stack'\}\s*<div class="panel-stack">/,
    'the stack layout must hold the panel stack'
  );
  assert.match(
    pageSectionSource,
    /<h2 class="section-title" id=\{`\$\{section\.id\}-title`\}>\{section\.label\}<\/h2>/,
    'every section opens with its manifest label'
  );
  // A section link has to be a real touch target: 44px on both axes, as a
  // minimum rather than a fixed box so an enlarged base font grows it.
  const link = /\.section-link\s*\{([^}]*)\}/.exec(styles);
  assert.ok(link, 'the section links are not styled where this pin expects them');
  assert.match(link[1], /min-block-size:\s*2\.75rem/);
  assert.match(link[1], /min-inline-size:\s*2\.75rem/);
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
  assert.match(hover[1], /color:\s*var\(--color-brand\)/, 'hover keeps its brand-ink affordance too');

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

test('every variant the card admits is a variant it styles', () => {
  const cardStyles = styleBlock(feedCard);
  const [base, ...others] = feedCardVariants;
  assert.equal(base, 'framed', 'the base variant is the one the plain rule paints');
  assert.match(cardStyles, /\.feed-card\s*\{/, 'the base card rule is missing');
  for (const variant of others) {
    assert.match(
      cardStyles,
      new RegExp(`\\.feed-card\\[data-variant='${variant}'\\]\\s*\\{`),
      `the ${variant} variant maps to no rule; a variant that styles nothing is a silent no-op`
    );
  }
  // A variant may only REMAP tokens. One that restated a value would be a
  // second place to change that value, which is the drift the token layer
  // exists to prevent.
  for (const [, body] of cardStyles.matchAll(/\.feed-card\[data-variant='[a-z]+'\]\s*\{([^}]*)\}/g)) {
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
  assert.match(styles, /--font-sans:/);
  assert.match(styles, /font-family:\s*var\(--font-sans\)/);
});

test('every content component renders through the card primitive', () => {
  for (const [name, source] of Object.entries({
    EntryLog: entryLog,
    MediaGallery: mediaGallery,
  })) {
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
    for (const field of ['company', 'role', 'dates', 'location']) {
      assert.ok(entry[field].trim().length > 0, `an experience entry has an empty ${field}`);
    }
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
  for (const entry of workHistoryProps.entries) {
    assert.equal(entry.placeholder, undefined, 'a real role is still marked placeholder');
  }
  // The block declares no section note at all now: staticBlock's presentation
  // argument is where one would go, and there is nothing left to disclaim.
  assert.match(
    workBinding,
    /staticBlock\('work-history', EntryLog, workHistoryProps\)/,
    'the experience block still declares a section note'
  );
  // The MARKER stays in the component, because it is the generic primitive's
  // honest-state channel and a future placeholder entry must still be able to
  // say so; what changed is that nothing ships one.
  assert.match(entryLog, /data-placeholder=\{entry\.placeholder \? 'true' : undefined\}/);

  // The adapter: the employer is the card's title, the composed byline is its
  // meta line, and the accomplishments are its points. The byline is read
  // BACK APART here — each of the three facts must be findable in the line the
  // card renders, so a composition that silently dropped the location or the
  // dates fails rather than merely looking different.
  assert.deepEqual(
    workHistoryProps.entries.map((entry) => [entry.key, entry.title, entry.byline, entry.points]),
    workEntries.map((entry) => [entry.company, entry.company, workByline(entry), entry.points])
  );
  for (const entry of workEntries) {
    const parts = workByline(entry).split(workBylineSeparator);
    assert.deepEqual(parts, [entry.role, entry.dates, entry.location]);
  }
  assert.equal(workHistoryProps.titleLevel, 3, 'experience entries head straight under the section h2');
  assert.equal(workHistoryProps.variant, undefined, 'experience entries keep the framed default card');
  assert.match(entryLog, /<FeedCard \{variant\} title=\{entry\.title\} byline=\{entry\.byline\} \{titleLevel\}>/);
});

test('an entry draws only the body regions it has, and every shipped entry has one', () => {
  // The card's own doctrine, one level in: a region is drawn only when it
  // holds something, so an entry with points and no paragraph must not render
  // an empty <p>, and an entry with a paragraph and no points must not render
  // an empty <ul>. Both branches are in the one shared body snippet, so the
  // linked and the unlinked card cannot grow different bodies.
  assert.match(entryLog, /\{#snippet body\(entry: EntryLogEntry\)\}/);
  assert.match(entryLog, /\{#if entry\.summary\}\s*<p class="entry-summary">\{entry\.summary\}<\/p>/);
  assert.match(entryLog, /\{#if entry\.points && entry\.points\.length > 0\}/);
  assert.equal(
    (entryLog.match(/\{@render body\(entry\)\}/g) ?? []).length,
    2,
    'the two card shapes no longer share one body'
  );
  // And nothing this site ships is an entry with neither: an empty body is a
  // call site with nothing to say, and the type cannot refuse it, so this
  // does — over every adapter that feeds the log.
  for (const [name, props] of Object.entries({ workHistoryProps, codingProjectsProps })) {
    assert.ok(props.entries.length > 0, `${name} feeds the log no entries at all`);
    for (const entry of props.entries) {
      assert.ok(
        (entry.summary ?? '').trim().length > 0 || (entry.points ?? []).length > 0,
        `${name} ships "${entry.key}" with neither a paragraph nor points`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Projects: the coding half
// ---------------------------------------------------------------------------

test('the six repositories are the owner’s, at the addresses the owner gave', () => {
  assert.equal(projects.length, 6);
  // The exact URLs, verbatim from the owner's list. The host is written once
  // and the row supplies its name, so this pin proves the derivation as well
  // as the addresses.
  assert.deepEqual(projects.map(projectUrl), [
    'https://github.com/snaraj/naranjo.online',
    'https://github.com/snaraj/website-infrastructure',
    'https://github.com/snaraj/lidersea.com',
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
  assert.deepEqual(
    codingProjectsProps.entries.map((entry) => [entry.title, entry.href, entry.linkLabel, entry.summary]),
    projects.map((project) => [project.name, projectUrl(project), projectLinkLabel(project), project.description])
  );
  assert.equal(codingProjectsProps.variant, 'compact');
  assert.equal(codingProjectsProps.titleLevel, 4, 'project entries sit under the subsection h3');
  assert.match(entryLog, /target="_blank"/);
  assert.match(entryLog, /rel="noopener noreferrer"/);
  assert.match(entryLog, /aria-label=\{entry\.linkLabel\}/);
  // The log renders the href it is handed and never assembles one.
  assert.deepEqual(
    [...entryLog.matchAll(/href=\{([^}]*)\}/g)].map(([, expression]) => expression),
    ['entry.href'],
    'the entry log may render exactly the one validated href and construct none'
  );
});

test('a count of one is a count of one thing', () => {
  // Two of the six repositories genuinely carry a single commit, and several a
  // single star. "1 commits" is the small lie a page tells when nobody
  // executes its labels. The clock is FIXED here so the third count — how
  // long since the last push (0.1.52) — is executed as arithmetic rather
  // than asserted around a moving now.
  const noon = Date.parse('2026-08-27T12:00:00Z');
  const row = { name: 'x', description: 'x', pushedAt: '2026-08-24T12:00:00Z' };
  assert.deepEqual(
    projectCounts({ ...row, commits: 1, stars: 1 }, noon).map((count) => count.label),
    ['1 commit', '1 star', 'updated 3 days ago']
  );
  assert.deepEqual(
    projectCounts({ ...row, commits: 0, stars: 20 }, noon).map((count) => count.label),
    ['0 commits', '20 stars', 'updated 3 days ago']
  );
  // Grouped through the same whole-number renderer every other figure on the
  // page uses, so a four-figure count does not suddenly read differently.
  assert.deepEqual(
    projectCounts({ ...row, commits: 1234, stars: 5678 }, noon).map((count) => count.label),
    ['1,234 commits', '5,678 stars', 'updated 3 days ago']
  );
  // Every band of the since-sentence, against the same fixed clock — and the
  // singular derived exactly as the other counts derive theirs.
  assert.equal(updatedLabel('2026-08-27T02:00:00Z', noon), 'updated today');
  assert.equal(updatedLabel('2026-08-26T02:00:00Z', noon), 'updated 1 day ago');
  assert.equal(updatedLabel('2026-07-30T12:00:00Z', noon), 'updated 28 days ago');
  assert.equal(updatedLabel('2026-07-27T12:00:00Z', noon), 'updated 1 month ago');
  assert.equal(updatedLabel('2026-02-27T12:00:00Z', noon), 'updated 6 months ago');
  assert.equal(updatedLabel('2025-08-20T12:00:00Z', noon), 'updated 1 year ago');
  assert.equal(updatedLabel('2023-08-27T12:00:00Z', noon), 'updated 3 years ago');
  // The adapter carries the same labels into the log, with the glyph beside
  // the words rather than instead of them.
  assert.deepEqual(
    codingProjectsProps.entries[0].counts.map((count) => count.label),
    projectCounts(projects[0]).map((count) => count.label)
  );
  assert.deepEqual(
    codingProjectsProps.entries[0].counts.map((count) => count.glyph),
    ['node', 'star', 'clock'],
    'each count names its generic glyph; the drawing is the component’s'
  );
  // The figure is TEXT beside the glyph, never carried by the glyph alone.
  assert.match(entryLog, /\{count\.label\}/);
  assert.match(entryLog, /aria-hidden="true"/);
});

test('the entry-head row stacks or inlines by viewport alone, never by title length (issue 188)', () => {
  const style = styleBlock(entryLog);
  // No flex-wrap on .entry-head anywhere in this file: that property is
  // exactly the old, content-dependent mechanism (a short title happened to
  // leave room on the line; a long one did not) the fix replaces.
  const entryHeadBlocks = [...style.matchAll(/\.entry-head\s*\{([^}]*)\}/g)].map(([, body]) => body);
  assert.ok(entryHeadBlocks.length >= 2, 'expected a base rule and a min-width override for .entry-head');
  for (const body of entryHeadBlocks) {
    // "nowrap" is fine (and required below); the ambiguous value this test
    // bans is a bare "wrap", which is what let content length decide.
    assert.doesNotMatch(
      body,
      /flex-wrap:\s*wrap\b/,
      'a wrap-based rule reintroduces content-dependent placement'
    );
  }
  // The base (mobile-first) rule stacks the row in a column.
  const [baseBody] = entryHeadBlocks;
  assert.match(baseBody, /flex-direction:\s*column/);
  // Exactly one min-width override flips it to an inline, non-wrapping row.
  const overrides = [...style.matchAll(/@media \(min-width:\s*([^)]+)\)\s*\{\s*\.entry-head\s*\{([^}]*)\}/g)];
  assert.equal(overrides.length, 1, 'expected exactly one viewport override for .entry-head');
  const [, breakpoint, overrideBody] = overrides[0];
  assert.match(overrideBody, /flex-direction:\s*row/);
  assert.match(overrideBody, /flex-wrap:\s*nowrap/);
  // The breakpoint used here is the same literal styles.css documents and
  // justifies as --breakpoint-card-meta — a parity pin against silent drift
  // between the two files, the same shape as the column breakpoint's own
  // recomputation test.
  const [, documentedValue] = /--breakpoint-card-meta:\s*([^;]+);/.exec(styles) ?? [];
  assert.ok(documentedValue, 'styles.css must document --breakpoint-card-meta');
  assert.equal(
    breakpoint.trim(),
    documentedValue.trim(),
    'EntryLog.svelte’s media query must match styles.css’s documented --breakpoint-card-meta'
  );
  // Every phone width the rendering-lane suite tests sits below the
  // breakpoint (480px), with headroom, so no real phone in that matrix can
  // land on the wide side by accident.
  const breakpointPx = Number.parseFloat(documentedValue) * 16;
  for (const phoneWidth of [320, 360, 390, 412]) {
    assert.ok(
      phoneWidth < breakpointPx,
      `phone width ${phoneWidth}px must sit below --breakpoint-card-meta (${breakpointPx}px)`
    );
  }
});

test('projectsCapturedOn is a well-formed date, and formatIsoDate renders every stated date honestly', () => {
  // A pure test of the constant and the function (issue 167): the owner
  // removed the visitor-facing caption that used to render both together
  // ("Counts captured from … on …; this page fetches nothing" — capture
  // provenance is a maintainer/reviewer fact, not something a visitor came
  // here to read), but projectsCapturedOn remains the maintenance record for
  // when the six counts below were captured, and formatIsoDate is the same
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
  const renderedData = JSON.stringify(codingProjectsProps);
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
  // The no-fetch INVARIANT the removed caption used to state in prose stays
  // real and stays ENFORCED here regardless of whether any caption says so
  // (issue 167): the origin is local-origin-only and live refresh is off by
  // default, so a live count would be a promise the deployment cannot keep.
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
  assert.match(artBinding, /import\.meta\.glob\('\.\.\/\.\.\/assets\/images\/gallery\/\*\.webp'/);
  assert.match(artBinding, /previewSrc: resolve\(photo\.previewSrc\)/);
  assert.match(artBinding, /fullSrc: resolve\(photo\.src\)/);
  assert.match(mediaGallery, /src=\{item\.previewSrc\}/, 'the feed frame renders the adapter’s URL, never its own');
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

test('exactly one frame is ever visible — never eight stacked', () => {
  // A photograph rendered through an {#each} is the regression this guards
  // against; the component renders exactly one <img> for the feed frame,
  // keyed to whichever index state currently holds, and none of the seven
  // others.
  // The guard is that no MEDIA element is ever mounted inside a loop over the
  // items — that is the weight regression, and it is what "eight stacked"
  // meant. It used to be spelled as "no {#each items as" at all, which was a
  // proxy: issue 219's position dots iterate the items to draw one 6px mark
  // each, mount no bytes, and are exactly the visible position affordance a
  // swipeable surface owes.
  //
  // THE TRADE, STATED HONESTLY rather than sold as a strengthening (issue 219
  // review round 2, finding 10). This is BROADER for content — any loop over
  // the items may now carry non-media markup, and an <img>, <video> or
  // <source> inside one is caught where the old spelling only knew that a
  // loop existed — and NARROWER for naming, because it still matches on the
  // literal `{#each items as`. A loop written over a differently-named
  // binding is not checked by either version, and calling that "harder to
  // slip past whatever the loop is called" was simply untrue. The lightbox's
  // own `{#each item.video.sources}` is why the sweep cannot be widened to
  // every loop: that one legitimately contains <source> elements, one item at
  // a time, which is the opposite of the regression. The load-bearing pin for
  // the real rule is the count assertion below — exactly one `.gallery-image`
  // in the file — and it is name-blind.
  for (const [loop] of mediaGallery.matchAll(/\{#each items as[\s\S]*?\{\/each\}/g)) {
    assert.doesNotMatch(
      loop,
      /<img|<video|<source/,
      'the feed frame must not mount a media element for every item at once'
    );
  }
  assert.equal(
    [...mediaGallery.matchAll(/class="gallery-image"/g)].length,
    1,
    'exactly one visible-frame <img> may exist in the markup'
  );
  assert.match(mediaGallery, /let index = \$state\(0\)/);
  assert.match(mediaGallery, /const item = \$derived\(items\[index\]\)/);
});

test('prev/next are icon-only, and both wrap around the eight photographs', () => {
  assert.match(mediaGallery, /aria-label="Previous photograph"/);
  assert.match(mediaGallery, /aria-label="Next photograph"/);
  // Text-free navigation affordance (issue 176): the controls carry an
  // accessible name, never visible label prose.
  assert.doesNotMatch(mediaGallery, />Next</);
  assert.doesNotMatch(mediaGallery, />Previous</);
  assert.match(mediaGallery, /index = \(index \+ 1\) % total/, 'next must wrap forward');
  assert.match(mediaGallery, /index = \(index - 1 \+ total\) % total/, 'previous must wrap backward');
});

/* The enlarged branch, extracted whole. Issue 202 nested a further {#if}
 * inside it (the optional metadata block), and the non-greedy extraction
 * this replaces stopped at that inner {/if} — it would still have found
 * item.fullSrc, so it would still have PASSED while measuring a fraction of
 * the branch it names. Anchoring on the dialog's closing tag and taking the
 * greedy span keeps the pin honest as the branch grows. */
const enlargedBranch = (source) =>
  /\{#if enlarged\}([\s\S]*)\{\/if\}\s*<\/dialog>/.exec(source)?.[1] ?? '';

test('clicking the photograph enlarges it; only the full derivative loads on demand', () => {
  assert.match(mediaGallery, /onclick=\{\(\) => \(enlarged = true\)\}/);
  // The full derivative mounts only inside the enlarged branch — never
  // alongside the small preview the feed frame always shows.
  const enlargedBlock = enlargedBranch(mediaGallery);
  assert.ok(enlargedBlock.length > 0, 'the enlarged branch is not where this pin expects it');
  assert.match(enlargedBlock, /src=\{item\.fullSrc\}/, 'the full derivative must load inside the enlarged branch');
  assert.doesNotMatch(
    mediaGallery.replace(enlargedBlock, ''),
    /item\.fullSrc/,
    'the full derivative must not load anywhere outside the enlarged branch'
  );
  assert.match(mediaGallery, /src=\{item\.previewSrc\}/, 'the feed frame must show the small preview');
});

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
function stripComments(markup) {
  let stripped = markup;
  let previous;
  let passes = 0;
  do {
    previous = stripped;
    stripped = previous.replace(/<!--[\s\S]*?-->/g, '');
    passes += 1;
  } while (stripped !== previous);
  return { markup: stripped, passes };
}

const galleryMarkup = stripComments(mediaGallery).markup;

test('the comment strip these pins depend on runs to a fixed point (issue 207)', () => {
  // Non-vacuity for the loop above, stated as the regression it prevents.
  // This input needs TWO effective passes: the first removes the inner
  // comment and splices `<!--` out of the `<!` before it and the `--` after
  // it, leaving a whole live comment that hides a `<video`; the second
  // removes that. A single-pass strip would hand the "must be present" pins
  // commented-out markup and they would be satisfied by prose.
  const spliced = stripComments('<div><!<!-- x -->-- <video --></div>');
  // Three, because the count includes the terminating pass that changes
  // nothing — which is the pass that proves convergence was reached.
  assert.equal(spliced.passes, 3, 'the strip must iterate, not run once');
  assert.equal(spliced.markup, '<div></div>');
  assert.doesNotMatch(spliced.markup, /<video/);
  // And the subject the pins actually read: no comment survives in it.
  assert.doesNotMatch(galleryMarkup, /<!--/, 'the gallery markup these pins read must be comment-free');
});

test('a moving item PLAYS in the strip — exactly one video, the current item’s, never in the dialog (issue 233)', () => {
  /* RE-AIMED, not relaxed (issue 233, owner directive 2026-08-28). The pin
     this replaces required a film to be a poster in the strip and a <video>
     only inside the enlarged branch. The owner asked for the opposite — play
     it where it sits — so the rule this file enforces moved with it, and what
     the old rule was actually protecting is what the new one still says: the
     strip may never carry a video PER ITEM. Both halves are here, because
     either alone is the other's regression.

     Half one: exactly ONE <video> exists in the whole markup, and it is
     inside the current item's own stage. `item` is the single item `index`
     names, so one element in that branch is one element on the page however
     many items the manifest publishes — and navigating unmounts it. */
  assert.equal(
    [...galleryMarkup.matchAll(/<video\b/g)].length,
    1,
    'the gallery mounts a number of <video> elements other than exactly one'
  );
  assert.match(
    galleryMarkup,
    /\{#if item\.video\}[\s\S]*?<div class="gallery-stage" data-gallery-kind="video">[\s\S]*?<video/,
    'the player is not inside the current item’s own video stage'
  );
  // Name-blind about the LOOP for the same reason the .gallery-image count
  // is: no media element may be mounted once per item.
  for (const [loop] of galleryMarkup.matchAll(/\{#each items as[\s\S]*?\{\/each\}/g)) {
    assert.doesNotMatch(loop, /<img|<video|<source/, 'a media element is mounted for every item at once');
  }

  /* Half two: the DIALOG is stills only. The branch that used to mount a
     <video> there is gone rather than left unreachable, so the enlarged
     surface can carry neither element. */
  const enlargedBlock = enlargedBranch(galleryMarkup);
  assert.ok(enlargedBlock.length > 0, 'the enlarged branch is not where this pin expects it');
  assert.doesNotMatch(
    enlargedBlock,
    /<video|<source/,
    'the lightbox mounts a player again; a film plays in the strip'
  );

  /* The element is KEYED on the item, which is what makes "navigating away
     unmounts it" true between two FILMS as well: swapping <source> children
     under a live <video> does not re-run resource selection, so an unkeyed
     branch would keep the previous film's bytes under the new poster. */
  assert.match(galleryMarkup, /\{#key item\.key\}/, 'the player is reused across items');

  /* THE PLAY MARK IS GONE (owner: "remove the play icon from all videos, its
     just there doing nothing"). An ABSENCE pin at the strength the presence
     pin had: neither the class, nor the drawn triangle, nor a token only it
     ever read may come back. */
  assert.doesNotMatch(mediaGallery, /gallery-play-mark/, 'the decorative play mark is back');
  assert.doesNotMatch(mediaGallery, /M9 7\.5l8 4\.5-8 4\.5z/, 'the play triangle is drawn again');
  for (const token of ['--gallery-play-size', '--gallery-play-inset', '--gallery-play-surface', '--gallery-play-ink']) {
    assert.ok(!mediaGallery.includes(token), `${token} outlived the mark it sized`);
    assert.ok(!styles.includes(token), `styles.css still declares ${token}`);
  }
});

test('a film’s stage takes the video token pair; a still keeps the square (issue 233)', () => {
  const style = styleBlock(mediaGallery);
  /* The stage's arithmetic is stated ONCE and reads two custom properties;
     the kind rule redeclares those same two rather than restating the
     arithmetic, so a film and a still cannot end up sized by two different
     pieces of code. */
  assert.match(
    style,
    /inline-size: min\(100%, calc\(var\(--gallery-stage-size, 28rem\) \* \(var\(--gallery-stage-aspect, 1\)\)\)\)/
  );
  assert.match(style, /aspect-ratio: var\(--gallery-stage-aspect, 1\)/);
  assert.match(style, /max-block-size: var\(--gallery-stage-size, 28rem\)/);
  const kindRule = /\.gallery-stage\[data-gallery-kind='video'\]\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.ok(kindRule.length > 0, 'a film’s stage is not switched by its kind at all');
  assert.match(kindRule, /--gallery-stage-size: var\(--gallery-stage-size-video, 27rem\);/);
  assert.match(kindRule, /--gallery-stage-aspect: var\(--gallery-stage-aspect-video, 1\.7778\);/);
  /* Both halves of the pair are GLOBAL tokens, declared in styles.css beside
     the square's own pair rather than left as component fallbacks — the
     frontend floor every other dimension of this card already holds to. A
     component-only default would make the widescreen stage the one dimension
     of this gallery the token layer could not tune. */
  for (const token of ['--gallery-stage-size-video: 27rem;', '--gallery-stage-aspect-video: 1.7778;']) {
    assert.ok(styles.includes(token), `styles.css does not declare ${token}`);
  }
  // The still's own pair is untouched; a film changing the square would be
  // this change escaping its own scope.
  assert.ok(styles.includes('--gallery-stage-size: 28rem;'));
  assert.ok(styles.includes('--gallery-stage-aspect: 1;'));
  // And a film's stage is genuinely the LARGER of the two: 27rem x 1.7778 is
  // 768x432 against the square's 448x448 — wider, and more area.
  const videoInline = 27 * 1.7778;
  assert.ok(videoInline > 28, `a film’s stage is ${videoInline}rem wide against the square’s 28rem`);
  assert.ok(videoInline * 27 > 28 * 28, 'a film’s stage covers no more area than the square it replaces');
});

test('the player owns its own surface: no swipe binding, no button, no gallery arrow keys (issue 233)', () => {
  /* The delicate half of playing in place. lib/gesture.ts claims a horizontal
     drag and CAPTURES the pointer the moment it does, which is exactly the
     gesture a reader makes scrubbing a seek bar — so the film's stage carries
     no binding at all, and the still's carries the one it always had. */
  const videoStage = /<div class="gallery-stage" data-gallery-kind="video">([\s\S]*?)\n          <\/div>/.exec(
    galleryMarkup
  )?.[1] ?? '';
  assert.ok(videoStage.length > 0, 'the film’s stage is not where this pin expects it');
  assert.doesNotMatch(videoStage, /use:swipeHorizontal/, 'the swipe binding sits over the player’s own controls');
  assert.doesNotMatch(videoStage, /<button/, 'a film’s stage carries a control that would eat the player’s presses');
  assert.match(
    galleryMarkup,
    /<div\s+class="gallery-stage"\s+data-gallery-kind="image"[\s\S]*?use:swipeHorizontal=\{swipe\}/,
    'the still’s stage lost the swipe it has always had'
  );
  // Exactly one binding on the page, so this is a MOVE rather than an
  // addition that left a second gesture surface behind.
  assert.equal([...galleryMarkup.matchAll(/use:swipeHorizontal/g)].length, 1);
  /* The keyboard half is structural rather than a guard: the gallery's arrow
     handler lives on the enlarge button, and a film has none — so there is no
     ancestor between the player and the document that would answer a left or
     right press the player wants for itself. */
  assert.match(galleryMarkup, /class="gallery-image-button"[\s\S]*?onkeydown=\{onFrameKeydown\}/);
  assert.equal([...galleryMarkup.matchAll(/onkeydown=\{onFrameKeydown\}/g)].length, 1);
  assert.doesNotMatch(videoStage, /onkeydown/, 'the film’s stage answers keys the player should get');
  /* And the invariant that keeps the retired lightbox branch unreachable
     rather than merely unused: the dialog cannot be left open on a film. */
  assert.match(
    mediaGallery,
    /if \(enlarged \&\& item\.video !== undefined\) \{\s*enlarged = false;/,
    'the lightbox can still be left open on a film it cannot show'
  );
});

test('the gallery’s painted controls shrank while every target kept its 44px (issue 233)', () => {
  const style = styleBlock(mediaGallery);
  /* Owner directive, 2026-08-28: the arrows and the position marks should be
     smaller. This repository's established answer is a small mark inside a
     44px hit box, so the pin holds BOTH ends — a shrink that took the target
     with it would be the touch floor broken. */
  const arrowRule = /\.gallery-frame > \.icon-button \.gallery-glyph\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.ok(arrowRule.length > 0, 'the frame’s arrow glyph is not sized by a rule of its own');
  assert.match(arrowRule, /inline-size: var\(--gallery-arrow-size, 0\.75rem\);/);
  assert.match(arrowRule, /block-size: var\(--gallery-arrow-size, 0\.75rem\);/);
  assert.ok(styles.includes('--gallery-arrow-size: 0.75rem;'), 'styles.css does not declare --gallery-arrow-size');
  // The SVG's own attributes agree with the token, so an engine that never
  // resolved the custom property still paints the smaller glyph rather than
  // the retired 18px one.
  assert.equal(
    [...mediaGallery.matchAll(/width="12" height="12"/g)].length,
    2,
    'the two arrows do not both declare the shrunk box'
  );
  assert.doesNotMatch(mediaGallery, /width="18" height="18"/, 'an arrow still declares the old 18px glyph');
  // The dots, the same way, plus the scale that keeps the current one
  // distinguishable after the shrink — a value is never carried by opacity
  // alone.
  const dotRule = /\.gallery-dot-mark\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.match(dotRule, /inline-size: var\(--gallery-dot-size, 0\.25rem\);/);
  assert.match(dotRule, /block-size: var\(--gallery-dot-size, 0\.25rem\);/);
  assert.match(style, /transform: scale\(var\(--gallery-dot-active-scale, 1\.5\)\);/);
  for (const token of ['--gallery-dot-size: 0.25rem;', '--gallery-dot-active-scale: 1.5;']) {
    assert.ok(styles.includes(token), `styles.css does not declare ${token}`);
  }
  // Both painted marks are genuinely smaller than what they replace.
  assert.ok(0.75 * 16 < 18, 'the arrow glyph did not shrink');
  assert.ok(0.25 < 0.375, 'the position mark did not shrink');
  // The targets did NOT move: the marks sit inside their old 44px boxes.
  const dotButton = /\.gallery-dot\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.match(dotButton, /min-inline-size: 2\.75rem;/);
  assert.match(dotButton, /min-block-size: 2\.75rem;/);
  assert.match(styles, /\.icon-button\s*\{[^}]*inline-size:\s*2\.75rem/);
});

test('nothing in the gallery ever autoplays, and reduced motion is structural (issue 207)', () => {
  // The strongest form this assertion has: the ATTRIBUTE cannot appear
  // anywhere in the file, so there is no conditional, muted, or
  // "just-for-the-poster" branch that could reintroduce it. Reduced motion is
  // then honoured by construction rather than by a media query — there is no
  // motion until a reader presses play, and a reader pressing play asked.
  assert.doesNotMatch(galleryMarkup, /autoplay/i, 'no autoplay attribute may exist anywhere in the gallery markup');
  assert.match(galleryMarkup, /<video[\s\S]*?\n\s+controls\n/, 'the video must carry native controls');
  assert.match(
    galleryMarkup,
    /<video[\s\S]*?\n\s+playsinline\n/,
    'the video must play inline (rendering lanes stage 1)'
  );
  assert.match(
    galleryMarkup,
    /<video[\s\S]*?preload="metadata"/,
    'the video preloads only metadata: the enlarge click asked for a working player, not yet the film'
  );
  assert.match(galleryMarkup, /poster=\{item\.video\.posterSrc\}/);
});

test('the source ladder renders in the manifest’s own order, never re-ranked (issue 207)', () => {
  // The browser takes the first source it can decode, so ORDER is the
  // preference. A sort, filter or reverse here would silently hand a reader
  // different bytes than the operator published.
  assert.match(mediaGallery, /\{#each item\.video\.sources as source \(source\.src\)\}/);
  assert.match(mediaGallery, /<source src=\{source\.src\} type=\{source\.type\} \/>/);
  for (const forbidden of [/item\.video\.sources\.sort/, /item\.video\.sources\.filter/, /item\.video\.sources\.reverse/]) {
    assert.doesNotMatch(mediaGallery, forbidden, 'the component must not re-rank the manifest’s source ladder');
  }
});

test('the Art block renders the vendored set first and lets a runtime manifest replace it (issue 182/207)', () => {
  // The cutover's whole shape, pinned where it is decided: the build's own
  // props are the block's FALLBACK — they render before any request exists —
  // and the volume's manifest is a one-shot read that may replace them. A
  // read that answers null changes nothing, which is why an absent media
  // volume looks like a gallery instead of a fault.
  assert.match(artBinding, /runtimeBlock\(/);
  assert.match(artBinding, /loadGalleryManifest\(\)/);
  assert.match(artBinding, /if \(items === null\) \{\n\s+return null;/);
  // The adapter still resolves the vendored file names through the bundler,
  // and still never assembles a media URL of its own: the manifest reader
  // built those through lib/media.ts before this module saw them.
  assert.match(artBinding, /import\.meta\.glob\('\.\.\/\.\.\/assets\/images\/gallery\/\*\.webp'/);
  assert.doesNotMatch(artBinding, /\/media\/|mediaUrl\(/, 'the adapter must never build a media URL itself');
  // Manifest order is the operator's order here too, and this is the assertion
  // that has to survive somebody being clever: the adapter may not reorder the
  // items OR a film's source ladder, by any means — a spread and a reverse, a
  // sort, a toSorted. The mapping expression is pinned exactly, so a rewrite
  // that inserts anything between `item.sources` and `.map` is a diff.
  assert.match(
    artBinding,
    /sources: item\.sources\.map\(\(source\) => \(\{ src: source\.url, type: source\.type \}\)\)/,
    'the ladder must be mapped straight through, with nothing between the manifest order and the props'
  );
  for (const forbidden of [/\.reverse\(/, /\.sort\(/, /\.toSorted\(/, /\.toReversed\(/]) {
    assert.doesNotMatch(artBinding, forbidden, 'the adapter must not reorder items or renditions');
  }
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

test('the lightbox is a native <dialog>: Escape/backdrop/close all close it, arrow keys navigate', () => {
  assert.match(mediaGallery, /<dialog[\s\S]*?bind:this=\{dialogEl\}/);
  assert.match(mediaGallery, /dialogEl\.showModal\(\)/);
  assert.match(mediaGallery, /dialogEl\.close\(\)/);
  // The dialog's own 'close' event — which fires for Escape as much as for
  // an explicit close() — is the single place `enlarged` resets, so no
  // closing path can desync it from the dialog's real open state.
  assert.match(mediaGallery, /onclose=\{onDialogClose\}/);
  assert.match(mediaGallery, /async function onDialogClose\(\): Promise<void> \{\s*enlarged = false;/);
  assert.match(mediaGallery, /event\.key === 'ArrowRight'/);
  assert.match(mediaGallery, /event\.key === 'ArrowLeft'/);
  assert.match(mediaGallery, /event\.target === dialogEl/, 'a genuine backdrop click must close the dialog');
  assert.match(mediaGallery, /aria-label=\{item\.alt\}/, 'the dialog needs an accessible name naming which photograph');
});

test('the frame border is tokens only — the component states no width, color, radius, padding or image of its own', () => {
  const style = styleBlock(mediaGallery);
  const border = /\.gallery-lightbox-border\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.ok(border.length > 0, 'the border rule is not where this pin expects it');
  for (const token of [
    '--gallery-frame-width',
    '--gallery-frame-color',
    '--gallery-frame-radius',
    '--gallery-frame-padding',
    '--gallery-frame-image',
  ]) {
    assert.match(border, new RegExp(`var\\(${token}\\)`), `the border rule does not read ${token}`);
    assert.match(styles, new RegExp(`${token}:`), `styles.css is missing a default for ${token}`);
  }
  // border-image's initial value is 'none': the token IS the extension
  // point, so the default asks for nothing extra rather than a component
  // change being required to add a future pattern.
  assert.match(styles, /--gallery-frame-image:\s*none;/);
});

test('the lightbox scrim, close control and size caps are tokens too (coordinator quality pass on #186)', () => {
  // The frame border was tokens-only from the start; these three siblings in
  // the same component were literals until this pass caught up to it — same
  // doctrine (issue 136: every style dimension is a token), same file.
  const style = styleBlock(mediaGallery);
  const rules = {
    lightbox: /\.gallery-lightbox\s*\{([^}]*)\}/.exec(style)?.[1] ?? '',
    backdrop: /\.gallery-lightbox::backdrop\s*\{([^}]*)\}/.exec(style)?.[1] ?? '',
    image: /\.gallery-lightbox-image\s*\{([^}]*)\}/.exec(style)?.[1] ?? '',
    close: /\.gallery-lightbox-close\s*\{([^}]*)\}/.exec(style)?.[1] ?? '',
    /* Issue 202 moved the painted surface off the 44px hit box and onto the
       small mark inside it; the token obligation moved with it rather than
       being dropped, which is why this rule joined the list instead of
       --gallery-close-surface leaving it. */
    closeMark: /\.gallery-close-mark\s*\{([^}]*)\}/.exec(style)?.[1] ?? '',
    /* Issue 202's own new surfaces. They shipped for one revision reading
       tokens that had no home in the layer — the #204 review's finding 1 —
       so they join the list here rather than the obligation staying prose. */
    caption: /\.gallery-caption\s*\{([^}]*)\}/.exec(style)?.[1] ?? '',
    meta: /\.gallery-lightbox-meta\s*\{([^}]*)\}/.exec(style)?.[1] ?? '',
    metaLink: /\.gallery-meta-link\s*\{([^}]*)\}/.exec(style)?.[1] ?? '',
  };
  for (const [rule, body] of Object.entries(rules)) {
    assert.ok(body.length > 0, `the ${rule} rule is not where this pin expects it`);
  }
  const expectations = [
    ['lightbox', '--gallery-lightbox-max-inline'],
    ['backdrop', '--gallery-scrim'],
    ['image', '--gallery-image-max-block'],
    ['closeMark', '--gallery-close-surface'],
    ['close', '--gallery-close-ink'],
    /* The nine promoted by issue 202. Each is asserted the same way as its
       elders — read by the rule that uses it AND declared in the layer — so
       a future dimension cannot quietly live as a component literal again. */
    ['lightbox', '--gallery-close-lane'],
    ['closeMark', '--gallery-close-size'],
    ['closeMark', '--gallery-close-rest-opacity'],
    ['caption', '--gallery-caption-gap'],
    ['caption', '--gallery-caption-space'],
    ['meta', '--gallery-meta-gap'],
    ['meta', '--gallery-meta-space'],
    ['meta', '--gallery-meta-ink'],
    ['metaLink', '--gallery-meta-link-padding'],
  ];
  for (const [rule, token] of expectations) {
    assert.match(rules[rule], new RegExp(`var\\(${token}`), `the ${rule} rule does not read ${token}`);
    assert.match(styles, new RegExp(`${token}:`), `styles.css is missing a default for ${token}`);
  }
  // The dynamic-unit upgrade stays a literal inside its own @supports guard
  // (not tokenized — see the note beside --gallery-image-max-block in
  // styles.css), so this pin checks the guard directly rather than a token.
  const dynamicImage = /@supports[^{]*\{\s*\.gallery-lightbox-image\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.match(dynamicImage, /max-block-size:\s*80svh/, 'the dynamic-unit upgrade lost its guarded literal');
  // Deliberately not reading-mode-branched: a scrim behind an enlarged
  // photograph and its close control read the same near-black regardless of
  // theme, exactly like the photograph itself is not re-tinted per mode.
  assert.match(styles, /--gallery-scrim:\s*rgba\(0, 0, 0, 0\.7\);/);
  assert.match(styles, /--gallery-close-surface:\s*rgba\(0, 0, 0, 0\.5\);/);
  assert.match(styles, /--gallery-close-ink:\s*white;/);
  /* The metadata ink is the colour the #204 review singled out: its only
     definition anywhere used to be a literal inside a component. It reads
     against the same near-black scrim its sibling above does, so it states
     one value here rather than branching per reading mode. */
  assert.match(styles, /--gallery-meta-ink:\s*white;/);
  /* A promotion must be a token MOVE, never a look change: each new default
     is the exact fallback the component still carries for it. */
  for (const [token, value] of [
    ['--gallery-close-size', '1.125rem'],
    ['--gallery-close-lane', '1.5rem'],
    ['--gallery-close-rest-opacity', '0.55'],
    ['--gallery-caption-gap', '0.125rem'],
    ['--gallery-caption-space', '0.25rem'],
    ['--gallery-meta-gap', '0.125rem'],
    ['--gallery-meta-space', '0.5rem'],
    ['--gallery-meta-link-padding', '0.5rem'],
  ]) {
    const declared = new RegExp(`${token}:\\s*${value.replace('.', '\\.')};`).test(styles);
    assert.ok(declared, `styles.css declares no ${token}: ${value}`);
    const fallback = new RegExp(`var\\(${token},\\s*${value.replace('.', '\\.')}\\)`).test(style);
    assert.ok(fallback, `the component's var(${token}) fallback is no longer ${value}, so the layer and the component disagree`);
  }
});

// ---------------------------------------------------------------------------
// Projects, the art half: the gallery EXPERIENCE (owner directives
// 2026-08-25, issue 202) — a centred frame, a close mark that is not stamped
// on the artwork, and metadata that is absent when it is absent.
// ---------------------------------------------------------------------------

test('the visible frame is centred in its track, so no gutter is dead space (issue 202)', () => {
  /* The defect the owner saw: aspect-ratio TRANSFERS the frame's block cap
     into an inline cap, so on a wide column the button is narrower than its
     own 1fr track and stretch degenerates to start alignment — MEASURED at
     1280px before this landed: a 568.9px frame at the left of an 842px
     track. Nothing but an explicit centring keeps the two gutters equal, so
     that declaration is what this pins; e2e/rendering-lanes.spec.mjs
     measures the resulting boxes on three engines. */
  const style = styleBlock(mediaGallery);
  const stage = /\.gallery-stage\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.ok(stage.length > 0, 'the stage rule is not where this pin expects it');
  assert.match(
    stage,
    /margin-inline:\s*auto/,
    'the frame does not centre itself in its track, so a column wider than the frame leaves the whole surplus on one side'
  );
  /* The centring must not have cost the reservation. An ALIGNED grid item is
     sized by its content, so centring the button directly would have made
     the reserved box depend on the lazy image — measured as 0x0 on Gecko.
     The stage's width is definite instead, and it is derived from the same
     two tokens the reserved box is, so the width and the ratio cannot drift
     apart. */
  /* The gallery's box is its OWN token pair since 2026-08-28 (owner: the art
     stage is near-square, not the feed's 16:9) — same construction, so the
     width and the ratio still cannot drift apart, and the reservation stays
     byte-independent. */
  assert.match(
    stage,
    /inline-size:\s*min\(100%, calc\(var\(--gallery-stage-size, 28rem\) \* \(var\(--gallery-stage-aspect, 1\)\)\)\)/,
    'the stage states no definite width, so the frame reserves nothing until the photograph loads'
  );
  for (const property of ['aspect-ratio: var(--gallery-stage-aspect, 1)', 'max-block-size: var(--gallery-stage-size, 28rem)']) {
    assert.ok(stage.includes(property), `the reserved box lost "${property}" when it moved onto the stage`);
  }
  /* And the control inside states no size of ITS own — a <button> is a form
     control whose auto inline size is fit-content, so a size here would put
     the reservation back under the image's control. */
  const frameButton = /\.gallery-image-button\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.ok(frameButton.length > 0, 'the frame-button rule is not where this pin expects it');
  assert.match(frameButton, /inset:\s*0/, 'the frame button no longer fills the box that was reserved for it');
  assert.doesNotMatch(
    frameButton,
    /(^|[\s;])(inline-size|block-size|width|height|aspect-ratio):/,
    'the frame button sizes itself, so the reserved box is whatever fits inside the button instead'
  );
  /* `inset: 0` only fills anything while the button is absolutely positioned,
     and this pin exists because composing issue 207 with this rule declared
     `position` TWICE — `absolute` from the reservation, then `relative` for
     the moving-item mark's containing block, which wins by order. The button
     fell back into flow at fit-content and the frame measured 569px off
     centre in Firefox and WebKit at 1440px: the exact dead gutter this test
     was written to prevent, reintroduced through a property nobody re-read.
     Absolutely positioned boxes are already containing blocks for absolutely
     positioned descendants, so one declaration serves both purposes. */
  assert.match(
    frameButton,
    /(^|[\s;])position:\s*absolute/,
    'the frame button is not absolutely positioned, so `inset: 0` fills nothing and the reserved box collapses to the button’s content'
  );
  assert.equal(
    (frameButton.match(/(^|[\s;])position:/g) ?? []).length,
    1,
    'the frame button declares `position` more than once; the last one wins and the reservation is decided by declaration order'
  );
  // The track arrangement the centring depends on: a middle column that can
  // be wider than the frame is exactly what makes the alignment matter.
  const frame = /\.gallery-frame\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.match(frame, /grid-template-columns:\s*auto 1fr auto/);
});

test('the lightbox close control paints a small mark, never a disc over the photograph (issue 202)', () => {
  const style = styleBlock(mediaGallery);
  const close = /\.gallery-lightbox-close\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  const mark = /\.gallery-close-mark\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.ok(close.length > 0 && mark.length > 0, 'the close rules are not where this pin expects it');

  /* The hit box paints nothing of its own. It used to BE the visible chrome —
     a 2.75rem filled disc — which is precisely what the owner called ugly. */
  assert.match(close, /background:\s*none/, 'the close control paints a surface of its own again');
  assert.doesNotMatch(close, /border-radius/, 'the close control wears a disc of its own again');

  /* Half or smaller, stated as a resolvable length rather than a promise:
     1.125rem against the 2.75rem hit box the .icon-button shape still
     supplies, which is what keeps the touch floor while shrinking the paint. */
  const size = /--gallery-close-size,\s*([\d.]+)rem/.exec(mark)?.[1];
  assert.ok(size !== undefined, 'the close mark states no size this pin can measure');
  assert.ok(
    Number.parseFloat(size) <= 2.75 / 2,
    `the close mark is ${size}rem against a 2.75rem control — the owner asked for at least half off`
  );
  for (const axis of ['inline-size', 'block-size']) {
    assert.match(mark, new RegExp(`${axis}:\\s*var\\(--gallery-close-size`), `the mark does not size its ${axis}`);
  }

  /* The mark tucks into the reserved lane above the frame — that lane, and
     the start-end alignment that puts the mark in it, are together why the
     mark never overlaps the picture. */
  const lightbox = /\.gallery-lightbox\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.match(lightbox, /padding:\s*var\(--gallery-close-lane/, 'the lightbox reserves no lane for the close mark');
  assert.match(close, /place-items:\s*start end/, 'the mark is not aligned into the lane it was given');

  // Still a control, still named, still the shared 44px shape.
  assert.match(mediaGallery, /class="icon-button gallery-lightbox-close"/);
  assert.match(mediaGallery, /aria-label="Close enlarged photograph"/);
  assert.match(styles, /\.icon-button\s*\{[^}]*inline-size:\s*2\.75rem/);
});

test('Escape closes the lightbox and hands focus back to the frame it came from (issue 202)', () => {
  /* The dialog's native focus restoration is not enough on its own: a mouse
     click does not focus a <button> on macOS WebKit, so "the previously
     focused element" is the body there and a reader who presses Escape lands
     nowhere. The component keeps the invoking button and focuses it on the
     dialog's own close event — the one path Escape, the close control and a
     backdrop click all pass through. */
  assert.match(mediaGallery, /bind:this=\{frameButtonEl\}/, 'the invoking frame button is not captured');
  /* The restore waits a tick and falls through to the player, and both halves
     are load-bearing since issue 233. A lightbox can now close BECAUSE the
     stage is about to stop being a still — arrowing the open dialog onto a
     film closes it — so the element focus is owed to may not exist yet at the
     moment the close event fires, and the element that will exist is the
     player rather than the button. Focusing the outgoing button would land
     the reader on the body, which is the exact defect this pin was written
     for, arriving by a new route. */
  assert.match(
    mediaGallery,
    /async function onDialogClose\(\): Promise<void> \{\s*enlarged = false;\s*await tick\(\);\s*\(frameButtonEl \?\? playerEl\)\?\.focus\(\);/,
    'closing the lightbox does not return focus to the surface it came from'
  );
  assert.match(mediaGallery, /import \{ tick \} from 'svelte';/, 'the restore cannot wait for the DOM it restores into');
});

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

test('absent metadata renders NOTHING — no empty row, no default, no reserved band (issue 202)', () => {
  /* The whole contract, pinned where it is decided. Each field is guarded on
     its OWN {#if}: a single combined guard would render an empty <p> for a
     description-less item that happens to carry a title. */
  for (const field of ['item.title', 'item.description', 'item.link']) {
    assert.ok(
      mediaGallery.includes(`{#if ${field}}`),
      `${field} is rendered without a guard of its own, so an item lacking it renders an empty row`
    );
  }
  // Both containers are conditional too, so an item with no metadata at all
  // contributes no element — the absent state is the absence of the box.
  assert.match(mediaGallery, /\{#if hasCaption\}\s*<div class="gallery-caption">/);
  assert.match(mediaGallery, /\{#if hasMeta\}\s*<div class="gallery-lightbox-meta">/);
  assert.match(mediaGallery, /const hasCaption = \$derived\(Boolean\(item\.title\) \|\| Boolean\(item\.description\)\)/);
  assert.match(mediaGallery, /const hasMeta = \$derived\(hasCaption \|\| item\.link !== undefined\)/);
  /* No default anywhere on the path: a ?? or a literal placeholder is how an
     honest empty state becomes a fabricated one. */
  for (const field of ['title', 'description', 'link']) {
    assert.doesNotMatch(
      mediaGallery,
      new RegExp(`item\\.${field}\\s*(\\?\\?|\\|\\|)\\s*['"\`]`),
      `the component substitutes copy of its own for a missing ${field}`
    );
    assert.doesNotMatch(
      artBinding,
      new RegExp(`${field}:\\s*[^,\\n]*(\\?\\?|\\|\\|)`),
      `the adapter defaults ${field}, so absence never reaches the component`
    );
    assert.match(artBinding, new RegExp(`${field}: photo\\.${field}`), `the adapter drops ${field} on the way through`);
  }
  // The caption is the LAST thing in the block, after the counter: an item
  // that carries one therefore moves neither the photograph nor the arrows
  // nor the counter (zero-CLS floor).
  assert.ok(
    mediaGallery.indexOf('class="gallery-caption"') > mediaGallery.indexOf('class="gallery-count"'),
    'the caption sits above the counter, so metadata arriving would move the frame'
  );
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

test('the visible frame reserves its box before any byte arrives, and lazy-loads', () => {
  // The box is reserved before a byte arrives, and the ratio the stylesheet
  // holds open is the ratio the markup declares — two statements of one
  // shape that cannot disagree because both read the same token every media
  // card on the page shares.
  const style = styleBlock(mediaGallery);
  assert.match(style, /aspect-ratio:\s*var\(--gallery-stage-aspect, 1\)/);
  // The cap (issue 157) is a SECOND, independent ceiling on the same
  // reservation, not a second timing: it still resolves before any byte
  // arrives, through the gallery's own stage token (near-square since
  // 2026-08-28; the 16:9 feed tokens stay with the feed cards).
  assert.match(style, /max-block-size:\s*var\(--gallery-stage-size, 28rem\)/);
  // The intrinsic box the markup DECLARES moved to a per-item value with
  // issue 207, because a runtime manifest's items each carry their own
  // dimensions. It is a size hint, not the reservation: the reservation is
  // the token pair above, identical for every item, which is why swapping the
  // vendored set for a volume-served one shifts nothing.
  assert.match(mediaGallery, /const itemWidth = \$derived\(item\.width \?\? width\)/);
  assert.match(mediaGallery, /const itemHeight = \$derived\(item\.height \?\? height\)/);
  assert.match(mediaGallery, /width=\{itemWidth\}/);
  assert.match(mediaGallery, /height=\{itemHeight\}/);
  assert.match(mediaGallery, /loading="lazy"/);
  assert.match(mediaGallery, /decoding="async"/);
});

test('the gallery frame cap is pinned at its literal value, independent of computed style', () => {
  // Daybreak Blue's review of PR #161 found e2e coverage that read
  // getComputedStyle(...).maxHeight from the very stylesheet under test and
  // derived its OWN expectation from that reading, so a mutation widening
  // the cap (20rem -> 200rem) moved the expectation and the rendered
  // behavior together and the suite never noticed. This test pins the
  // LITERAL value the design chose — 20rem, 320px at this page's
  // unmodified 16px root — straight out of the source text; the e2e
  // assertions in rendering-lanes.spec.mjs hardcode the same literal 320
  // rather than reading it back from the DOM, so a widened cap is a diff
  // against a fixed number in two independent places, not against itself
  // in one.
  assert.match(
    styles,
    /--card-media-max-block-size:\s*20rem;/,
    'the gallery cap token must read exactly 20rem — a change here must be a deliberate design edit, verified against the e2e literal too'
  );
});

// ---------------------------------------------------------------------------
// The art binding
// ---------------------------------------------------------------------------

test('the art block introduces itself with its heading, and only its heading', () => {
  assert.match(artBinding, /heading: 'Art'/);
  // The retired intro/note provenance lines do not come back (issue 176):
  // the gallery's whole content is the frame itself now, and the licence
  // lives in gallery.ts's own doc comment and SOURCES.md — a maintainer
  // fact, not something a visitor came here to read (the same ruling issue
  // 167 already made for the Coding Projects capture note).
  assert.doesNotMatch(artBinding, /intro:|note:/);
  assert.match(pageSectionSource, /<h3 class="subsection-title">\{block\.heading\}<\/h3>/);
});
