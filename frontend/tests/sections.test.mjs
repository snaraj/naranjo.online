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
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { section, sectionHref, staticBlock } from '../src/lib/blocks.ts';
import { feedCardRegions, feedCardVariants, formatIsoDate } from '../src/lib/feed.ts';
import { workEntries, workHistoryProps, workPlaceholderNote } from '../src/lib/work.ts';
import {
  codingProjectsProps,
  projectCounts,
  projectHost,
  projectLinkLabel,
  projects,
  projectsCapturedOn,
  projectUrl,
} from '../src/lib/projects.ts';
import {
  artGalleryProps,
  artLabel,
  artPieces,
  artSource,
  artUnavailableNote,
} from '../src/lib/art.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const [app, styles, manifest, feedCard, sectionNav, pageSectionSource, blockHost, entryLog, mediaGallery, emptyNote] =
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
    read('../src/lib/components/EmptyNote.svelte'),
  ]);

/* The binding modules that introduce each block to the page; they import
 * components, so they are source-pinned rather than executed. */
const [workBinding, artBinding, projectsBinding, aboutBinding] = await Promise.all([
  read('../src/lib/blocks/workHistory.ts'),
  read('../src/lib/blocks/artGallery.ts'),
  read('../src/lib/blocks/codingProjects.ts'),
  read('../src/lib/blocks/about.ts'),
]);

/* The generic components this architecture renders the page through. */
const introduced = {
  FeedCard: feedCard,
  SectionNav: sectionNav,
  PageSection: pageSectionSource,
  Block: blockHost,
  EntryLog: entryLog,
  MediaGallery: mediaGallery,
  EmptyNote: emptyNote,
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

test('the manifest names the owner’s four sections, in the order the page stacks them', () => {
  assert.deepEqual(
    manifestSections.map((entry) => entry.label),
    ['Work', 'Projects', 'Trackers', 'About Me'],
    'the section labels are the owner’s words and their order is the page’s order'
  );
  assert.deepEqual(
    manifestSections.map((entry) => entry.id),
    ['work', 'projects', 'trackers', 'about']
  );
  assert.deepEqual(
    manifestSections.map((entry) => entry.blocks),
    [
      ['workHistory'],
      ['artGallery', 'codingProjects'],
      ['osrsStats', 'vcsActivity', 'tokenUsage'],
      ['about'],
    ],
    'each section holds exactly its blocks; reordering the page is moving one name here'
  );
  assert.deepEqual(
    manifestSections.map((entry) => entry.layout),
    ['flow', 'flow', 'stack', 'flow'],
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
    EmptyNote: emptyNote,
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
// Work
// ---------------------------------------------------------------------------

test('the work section carries two complete placeholder entries', () => {
  assert.equal(workEntries.length, 2, 'the owner asked for exactly two entries');
  for (const entry of workEntries) {
    for (const [field, value] of Object.entries(entry)) {
      assert.ok(value.trim().length > 0, `a work entry has an empty ${field}`);
    }
  }
  // The owner asked for a DIFFERENT paragraph on the second entry; two copies
  // of one paragraph is the shortcut this catches.
  assert.notEqual(
    workEntries[0].summary,
    workEntries[1].summary,
    'both entries carry the same paragraph; the owner asked for a different one'
  );
  assert.notEqual(workEntries[0].location, workEntries[1].location);
  // Placeholder copy says so on the page. Latin under a real name reads as a
  // real job otherwise, which is the honest-states floor applied to content.
  assert.ok(workPlaceholderNote.trim().length > 0);
  assert.match(workBinding, /note: workPlaceholderNote/, 'the section note must be the stated placeholder line');
  // The adapter marks every entry placeholder, and the log says so in the
  // DOM — role as the title, location as the byline: the entry is data, the
  // card is the shape.
  assert.deepEqual(
    workHistoryProps.entries.map((entry) => [entry.title, entry.byline, entry.summary, entry.placeholder]),
    workEntries.map((entry) => [entry.title, entry.location, entry.summary, true])
  );
  assert.equal(workHistoryProps.titleLevel, 3, 'work entries head straight under the section h2');
  assert.equal(workHistoryProps.variant, undefined, 'work entries keep the framed default card');
  assert.match(entryLog, /data-placeholder=\{entry\.placeholder \? 'true' : undefined\}/);
  assert.match(entryLog, /<FeedCard \{variant\} title=\{entry\.title\} byline=\{entry\.byline\} \{titleLevel\}>/);
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
  // executes its labels.
  assert.deepEqual(
    projectCounts({ name: 'x', description: 'x', commits: 1, stars: 1 }).map((count) => count.label),
    ['1 commit', '1 star']
  );
  assert.deepEqual(
    projectCounts({ name: 'x', description: 'x', commits: 0, stars: 20 }).map((count) => count.label),
    ['0 commits', '20 stars']
  );
  // Grouped through the same whole-number renderer every other figure on the
  // page uses, so a four-figure count does not suddenly read differently.
  assert.deepEqual(
    projectCounts({ name: 'x', description: 'x', commits: 1234, stars: 5678 }).map((count) => count.label),
    ['1,234 commits', '5,678 stars']
  );
  // The adapter carries the same labels into the log, with the glyph beside
  // the words rather than instead of them.
  assert.deepEqual(
    codingProjectsProps.entries[0].counts.map((count) => count.label),
    projectCounts(projects[0]).map((count) => count.label)
  );
  assert.deepEqual(
    codingProjectsProps.entries[0].counts.map((count) => count.glyph),
    ['node', 'star'],
    'each count names its generic glyph; the drawing is the component’s'
  );
  // The figure is TEXT beside the glyph, never carried by the glyph alone.
  assert.match(entryLog, /\{count\.label\}/);
  assert.match(entryLog, /aria-hidden="true"/);
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

test('every picture is an immutable publication the origin can serve', () => {
  assert.equal(artPieces.length, 8, 'the owner asked for eight pictures');
  const digests = new Set();
  for (const piece of artPieces) {
    assert.match(
      piece.sha256,
      /^[0-9a-f]{64}$/,
      `${piece.file} is not addressed by a lowercase SHA-256 digest`
    );
    assert.equal(digests.has(piece.sha256), false, `${piece.sha256} addresses two pictures`);
    digests.add(piece.sha256);
    // EXECUTED through media.ts, not assembled here: the URL a picture resolves
    // to is the one shape the origin accepts, and a name the origin would hide
    // throws instead of rendering a broken frame.
    assert.equal(artSource(piece), `/media/immutable/${piece.sha256}/${piece.file}`);
    assert.match(artSource(piece), /^\/media\//, 'a media URL is same-origin and path-only');
  }
  // The gallery receives those exact URLs through the adapter, and the
  // component renders the src it is handed — it could not build one.
  assert.deepEqual(
    artGalleryProps.items.map((item) => [item.key, item.src]),
    artPieces.map((piece) => [piece.sha256, artSource(piece)])
  );
  assert.match(mediaGallery, /src=\{item\.src\}/, 'the gallery renders the adapter’s URL, never its own');
  assert.doesNotMatch(mediaGallery, /mediaUrl|\/media\//, 'the gallery must not know the media route');
});

test('the pictures are described as what they verifiably are', () => {
  // Nobody has reviewed what these placeholders depict, so nothing claims to
  // know. A caption invented to look finished is the same failure as a panel
  // inventing a figure.
  assert.equal(artLabel(0, 8), 'Placeholder photograph 1 of 8');
  assert.equal(artLabel(7, 8), 'Placeholder photograph 8 of 8');
  assert.deepEqual(
    artGalleryProps.items.map((item) => item.alt),
    artPieces.map((_, index) => artLabel(index, artPieces.length))
  );
  assert.match(mediaGallery, /alt=\{item\.alt\}/);
});

test('an origin that serves no media shows frames, not broken pictures', () => {
  // Media delivery is off unless an operator turns it on, so this is the
  // ORDINARY state and it is designed rather than handled.
  assert.ok(artUnavailableNote.trim().length > 0);
  assert.equal(artGalleryProps.unavailableNote, artUnavailableNote);
  assert.doesNotMatch(
    artUnavailableNote,
    /error|failed|broken|missing/i,
    'the unavailable state must not read as a failure; media being off is a configuration, not a fault'
  );
  assert.match(mediaGallery, /onerror=\{\(\) => markMissing\(item\.key\)\}/);
  assert.match(mediaGallery, /data-gallery-pending="true"/);
  assert.match(mediaGallery, /data-gallery-unserved="true"/);
  // The explanation hangs off the FIRST picture, which is the only one always
  // requested: every other is lazy, so a reader at the top of the feed has
  // asked for one of them. Keyed on all eight — the shape this started as —
  // the note never appeared for anyone who did not scroll the whole gallery,
  // measured at two, three and six of eight answered across the engines.
  assert.match(mediaGallery, /missing\.includes\(items\[0\]\?\.key/);
  assert.doesNotMatch(
    mediaGallery,
    /missing\.length === items\.length/,
    'keyed on every picture, the honest note waits for pictures nobody requested'
  );
});

test('the heavy pictures cost the page no layout shift', () => {
  // The box is reserved before a byte arrives, and the ratio the stylesheet
  // holds open is the ratio the markup declares — two statements of one shape
  // that cannot disagree because both read the same token and the same
  // constants.
  assert.match(mediaGallery, /aspect-ratio:\s*var\(--card-media-aspect\)/);
  // The cap (issue 157) is a SECOND, independent ceiling on the same
  // reservation, not a second timing: it still resolves before any byte
  // arrives, through the one global token every frame shares.
  assert.match(mediaGallery, /max-block-size:\s*var\(--card-media-max-block-size\)/);
  assert.match(mediaGallery, /\{width\}/);
  assert.match(mediaGallery, /\{height\}/);
  assert.equal(artGalleryProps.width, 3840);
  assert.equal(artGalleryProps.height, 2160);
  // The first is the one a visitor is looking at; the rest wait until they are
  // scrolled toward.
  assert.match(mediaGallery, /loading=\{index === 0 \? 'eager' : 'lazy'\}/);
  assert.match(mediaGallery, /decoding="async"/);
});

test('the gallery frame cap is pinned at its literal value, independent of computed style', () => {
  // Daybreak Blue's review of PR #161 found the previous e2e coverage
  // self-referential: it read getComputedStyle(...).maxHeight from the very
  // stylesheet under test and derived its OWN expectation from that reading,
  // so a mutation widening the cap (20rem -> 200rem) moved the expectation
  // and the rendered behavior together and the suite never noticed. This
  // test pins the LITERAL value the design actually chose — 20rem, 320px at
  // this page's unmodified 16px root — straight out of the source text, and
  // the e2e assertions in rendering-lanes.spec.mjs now hardcode the same
  // literal 320 rather than reading it back from the DOM, so a widened cap
  // is a diff against a fixed number in two independent places, not against
  // itself in one.
  assert.match(
    styles,
    /--card-media-max-block-size:\s*20rem;/,
    'the gallery cap token must read exactly 20rem — a change here must be a deliberate design edit, verified against the e2e literal too'
  );
});

test('no picture entered the repository', async () => {
  // Requirement 11: heavy media never enters git, the bundle, the embed, the
  // image, or a ConfigMap. Eight 4K photographs are the first real test of
  // that rule, and the media subsystem is the answer to it — so the pin is
  // that the assets tree still holds no image at all.
  const images = await readdir(new URL('../src/assets/images', import.meta.url));
  assert.deepEqual(
    images.filter((entry) => !entry.startsWith('.')),
    [],
    'an image landed in the bundle; heavy media is served by the media subsystem, never carried here'
  );
});

// ---------------------------------------------------------------------------
// The art and about bindings
// ---------------------------------------------------------------------------

test('the art block introduces itself with its heading and both provenance lines', () => {
  assert.match(artBinding, /heading: 'Art'/);
  assert.match(artBinding, /intro: artNote/);
  assert.match(artBinding, /note: artProvenance/);
  // The section chrome renders those lines beside the block, in the
  // established secondary styles.
  assert.match(pageSectionSource, /<h3 class="subsection-title">\{block\.heading\}<\/h3>/);
  assert.match(pageSectionSource, /<p class="subsection-intro">\{block\.intro\}<\/p>/);
  assert.match(pageSectionSource, /<p class="section-note">\{block\.note\}<\/p>/);
});

test('the about section says it is empty rather than inventing a biography', () => {
  assert.match(aboutBinding, /has not been written yet/);
  assert.match(emptyNote, /<FeedCard variant="flat">/);
  // Nothing about the owner is asserted anywhere in it.
  for (const [name, source] of Object.entries({ aboutBinding, EmptyNote: emptyNote })) {
    assert.doesNotMatch(source, /\bI am\b|\byears of\b|\bspecialis|\bspecializ/i, `${name} invents a biography`);
  }
});
