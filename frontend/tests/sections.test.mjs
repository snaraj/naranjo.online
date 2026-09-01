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
import { workByline, workBylineSeparator, workEntries, workHistoryProps } from '../src/lib/work.ts';
import {
  codingProjectsPanelId,
  codingProjectsProps,
  projectCounts,
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
    /\{#if section\.layout === 'stack'\}(?:\s*<!--[\s\S]*?-->)?\s*<div class="panel-stack" data-block-count=\{section\.blocks\.length\}>/,
    'the stack layout must hold the panel stack, and it must declare how many blocks it holds (issue 210)'
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
  assert.match(styles, /--font-mono:\s*'JetBrains Mono',/);
  assert.match(styles, /font-family:\s*var\(--font-mono\)/);
  // The face is self-hosted: every @font-face source resolves inside the
  // bundle (requirement 1 — no CDN), and each of the four faces declares the
  // variable weight span so the ramp's 650s render as drawn, not snapped.
  for (const face of styles.match(/@font-face \{[^}]*\}/gs) ?? []) {
    assert.match(face, /src: url\('\.\/assets\/fonts\//, 'a webfont loads from outside the bundle');
    assert.match(face, /font-weight: 100 800/, 'a face lost its variable weight span');
    assert.match(face, /font-display: swap/, 'a face would hold first paint invisible');
  }
  assert.equal(
    (styles.match(/@font-face/g) ?? []).length,
    4,
    'expected the four JetBrains Mono faces (two styles by two character ranges)'
  );
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
    for (const field of ['company', 'role', 'dates', 'location', 'site']) {
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
    workHistoryProps.entries.map((entry) => [
      entry.key,
      entry.title,
      entry.titleHref,
      entry.byline,
      entry.points
    ]),
    workEntries.map((entry) => [
      entry.company,
      entry.company,
      entry.site,
      workByline(entry),
      entry.points
    ])
  );
  for (const entry of workEntries) {
    const parts = workByline(entry).split(workBylineSeparator);
    assert.deepEqual(parts, [entry.role, entry.dates, entry.location]);
  }
  assert.equal(workHistoryProps.titleLevel, 3, 'experience entries head straight under the section h2');
  assert.equal(workHistoryProps.variant, undefined, 'experience entries keep the framed default card');
  /* The unlinked branch, now also forwarding titleHref (issue 243). Every
     prop is named individually rather than as one string so a dropped
     forward is a failure rather than a reformat, and `byline` is the one that
     carries the whole point: the OTHER way to link a title — EntryLog's
     `href` branch — replaces the header region and would take the role, the
     span and the place with it. */
  const unlinkedCard = /<FeedCard\s+\{variant\}\s+title=([\s\S]*?)>/.exec(entryLog)?.[1] ?? '';
  assert.ok(unlinkedCard.length > 0, 'the unlinked card is not where this pin expects it');
  for (const prop of ['{entry.title}', 'titleHref={entry.titleHref}', 'byline={entry.byline}', '{titleLevel}']) {
    assert.ok(unlinkedCard.includes(prop), `the unlinked entry card no longer passes ${prop}`);
  }
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
  for (const [name, props] of Object.entries({
    workHistoryProps,
    codingProjectsProps: codingProjectsProps(null),
  })) {
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
  const captured = codingProjectsProps(null);
  // Compared against the feed's OWN order (issue 252) rather than the module
  // list's, because they are no longer the same thing: the module list is a
  // maintenance order and the feed is sorted by last push. Sorting the
  // expectation the same way keeps this test about identity — every entry's
  // title, address and accessible name derived from the captured row — and
  // leaves the ordering claim to the test that exists for it.
  const byPush = projects.toSorted(
    (left, right) => Date.parse(right.pushedAt) - Date.parse(left.pushedAt)
  );
  assert.deepEqual(
    captured.entries.map((entry) => [entry.title, entry.href, entry.linkLabel, entry.summary]),
    byPush.map((project) => [project.name, projectUrl(project), projectLinkLabel(project), project.description])
  );
  assert.equal(captured.variant, 'compact');
  assert.equal(captured.titleLevel, 4, 'project entries sit under the subsection h3');
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
  assert.deepEqual(
    codingProjectsProps(null, noon).entries[0].counts.map((count) => count.label),
    projectCounts(leading, undefined, noon).map((count) => count.label)
  );
  assert.deepEqual(
    codingProjectsProps(null).entries[0].counts.map((count) => count.glyph),
    ['star', 'clock', 'node', 'issue', 'pull'],
    'each count names its generic glyph; the drawing is the component’s'
  );
  /* EVERY counter is terse now (issue 268): the glyph and a bare figure on the
     visible line, the whole sentence in the clipped span and in the detail.
     Both channels are checked, because dropping either one is the failure —
     the figure alone leaves the glyph carrying the meaning for a screen
     reader, and the words alone are the noise the owner removed. */
  for (const count of codingProjectsProps(null, noon).entries[0].counts) {
    assert.ok(
      typeof count.value === 'string' && count.value.length > 0,
      `${count.key} renders no visible figure`
    );
    assert.ok(count.label.length > 0, `${count.key} carries no sentence`);
    assert.equal(count.detail.name, count.label, `${count.key}'s detail does not name its phrase`);
  }
  // The figure is TEXT beside the glyph, never carried by the glyph alone.
  assert.match(entryLog, /\{count\.value\}/);
  assert.match(entryLog, /\{count\.label\}/);
  assert.match(entryLog, /aria-hidden="true"/);
});

test('a figure the origin recorded says so in its detail, never on the visible line (issue 268)', () => {
  /* The owner, of the inline italic mark repeated on every row: "stale, static
     and ugly ... just remove it". Provenance did NOT go with it — it moved one
     interaction away, into the same detail primitive the stat tiles use — so
     this pin is in two halves and both matter. */
  const noon = Date.parse('2026-08-27T12:00:00Z');
  const captured = codingProjectsProps(null, noon).entries[0].counts;
  const commits = captured.find((count) => count.key === 'commits');
  assert.equal(commits.marked, true, 'the commit total is captured however fresh the row is');
  assert.deepEqual(
    commits.detail.rows,
    [{ label: '', value: recordedOutOfBand }],
    'a recorded figure carries no provenance row in its detail'
  );
  // The wording is the page's ONE constant, not a second copy of the sentence.
  assert.equal(recordedOutOfBand, 'recorded out of band, not fetched live');
  // And nothing on the visible line says it: the mark, its class and its
  // browser tooltip are gone from the component rather than merely unused.
  assert.doesNotMatch(entryLog, /entry-recorded/);
  assert.doesNotMatch(entryLog, /·\s*recorded/);
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
  const captured = codingProjectsProps(null).entries.map((entry) => entry.title);
  const expected = projects
    .toSorted((left, right) => Date.parse(right.pushedAt) - Date.parse(left.pushedAt))
    .map((project) => project.name);
  assert.deepEqual(captured, expected);
  assert.notDeepEqual(
    captured,
    projects.map((project) => project.name),
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
    codingProjectsProps(envelope).entries.map((entry) => entry.title),
    projects.map((project) => project.name),
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
    codingProjectsProps(stale).entries.map((entry) => entry.title),
    expected,
    'a recorded row was ordered by an instant it was not vouching for'
  );
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
  for (const glyph of ["count.glyph === 'issue'", "count.glyph === 'pull'"]) {
    assert.ok(entryLog.includes(glyph), `the entry log draws no ${glyph} branch`);
  }
  assert.equal(
    [...entryLog.matchAll(/(?:fill|stroke)="(?!none)([^"]*)"/g)].every(
      ([, paint]) => paint === 'currentColor'
    ),
    true,
    'a glyph paints an ink that is not currentColor'
  );
  // The words are hidden by CLIPPING, never by display:none or hidden, both of
  // which would take them out of the accessibility tree and leave the glyph
  // carrying the figure alone.
  assert.match(entryLog, /<span class="entry-count-words">\{count\.label\}<\/span>/);
  assert.match(styleBlock(entryLog), /\.entry-count-words \{[^}]*clip-path: inset\(50%\)/s);
  assert.doesNotMatch(styleBlock(entryLog), /\.entry-count-words \{[^}]*display: none/s);
});

test('the counters are one right-anchored cluster at the title’s level, decided by no card’s content (issue 188; owner sketch 2026-08-31)', () => {
  const style = styleBlock(entryLog);
  /* Issue 188's claim survives the owner's 2026-08-31 sketch (issue 275): no
     placement in the card head depends on content. The head is ONE grid at
     every width — the title column shrinkable to nothing, the cluster sized
     by its own floored tracks — so there is still nothing for a title's
     length to decide, and no width switch exists to reintroduce a second
     shape. */
  const entryHeadBlocks = [...style.matchAll(/\.entry-head\s*\{([^}]*)\}/g)].map(([, body]) => body);
  assert.equal(entryHeadBlocks.length, 1, 'the head has grown a second shape again');
  assert.match(entryHeadBlocks[0], /display:\s*grid/);
  assert.match(
    entryHeadBlocks[0],
    /grid-template-columns:\s*minmax\(0, 1fr\) auto/,
    'the title column must shrink under a long name instead of pushing the cluster'
  );
  assert.equal(
    [...style.matchAll(/@(?:media|container)[^{]*\{\s*\.entry-(?:head|counts)\s*\{/g)].length,
    0,
    'the head or cluster is width-switched again; the one-layout rule (2026-08-29, re-drawn 2026-08-31) says it may not be'
  );

  /* THE CLUSTER (owner sketch, issue 275: "icons + number", concise, at the
     card's top-right). Two columns, both floored by the ONE token declared
     in styles.css, so the cluster reads the same geometry on every card and
     the live age counter can tick without moving a pixel — nothing is
     measured from a figure. */
  const counts = /\.entry-counts\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.match(counts, /display:\s*grid/, 'the cluster is content-placed flex');
  assert.match(
    counts,
    /grid-template-columns:\s*repeat\(2, minmax\(var\(--entry-count-min\), auto\)\)/,
    'the two tracks are not floored by the one shared token, so cards can disagree about where a column starts'
  );
  /* The retired full-width table may not creep back: no full-card span, no
     scroll lane, no surplus to distribute. */
  assert.doesNotMatch(counts, /inline-size:\s*100%/);
  assert.doesNotMatch(counts, /justify-content/);
  assert.doesNotMatch(style, /--entry-count-columns|--breakpoint-entry-columns/);
  assert.doesNotMatch(styles, /--entry-count-columns|--breakpoint-entry-columns/);
  /* The floor is declared in styles.css — the token layer, where the owner
     tunes it — and it must FIT: two floored tracks plus their column gap
     inside the narrowest card the phone lanes measure (226px at a 320
     viewport), so the cluster never needs the breakpoint this shape
     retired. The gap read here is --card-meta-gap's column half, resolved
     the way the component resolves it. */
  const [, floorValue] = /--entry-count-min:\s*([0-9.]+)rem;/.exec(styles) ?? [];
  assert.ok(floorValue, 'styles.css must declare --entry-count-min in rem');
  const floorPx = Number.parseFloat(floorValue) * 16;
  const [, , columnGap] = /--card-meta-gap:\s*([0-9.]+)rem\s+([0-9.]+)rem;/.exec(styles) ?? [];
  assert.ok(columnGap, '--card-meta-gap no longer carries a row and a column half');
  assert.ok(
    2 * floorPx + Number.parseFloat(columnGap) * 16 < 226,
    `two floored tracks plus the gap (${2 * floorPx + Number.parseFloat(columnGap) * 16}px) must fit the 226px card a 320px phone renders`
  );
  /* THE CELL IS ITS TRACK (issue 268, unchanged by the move): a block-level
     flex cell fills the track it was given, so the second column's cells end
     together at the card's right edge — where the cluster is anchored — and
     the browser lanes measure them there. */
  const countRule = /\.entry-count\s*\{([^}]*position:\s*relative[^}]*)\}/.exec(style)?.[1] ?? '';
  assert.match(countRule, /display:\s*flex;/, 'the counter shrinks to its content instead of filling its column');
  assert.doesNotMatch(countRule, /display:\s*inline-flex/);
  /* And a digit may not jitter the column it sits in: the counters read
     tabular figures. That is a LIVE requirement now rather than a precaution —
     the freshness counter re-renders every minute, so "9m" becoming "10m"
     would nudge its neighbours once a minute forever without it. */
  assert.match(countRule, /font-variant-numeric:\s*tabular-nums/);
  /* Every counter is a focus stop, so every counter wears the ring — the twin
     of .stat-cell's, because the affordance the owner asked for ("like the
     token count on the other trackers") is that one. */
  assert.match(style, /\.entry-count:focus-visible\s*\{[^}]*outline:/);
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
  const renderedData = JSON.stringify(codingProjectsProps(null));
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
  for (const [loop] of mediaGallery.matchAll(/\{#each (?:items|visible|sets) as[\s\S]*?\{\/each\}/g)) {
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
  /* The frame shows the CLAMPED position of the VISIBLE set (issue 275):
     rendering happens before any effect can repair state, so the read
     itself must survive the strip shrinking underneath it. */
  assert.match(mediaGallery, /const shown = \$derived\(Math\.min\(index, Math\.max\(0, total - 1\)\)\)/);
  assert.match(mediaGallery, /const item = \$derived\(visible\[shown\]\)/);
});

test('prev/next are icon-only, and both wrap around the eight photographs', () => {
  /* RE-AIMED, not relaxed (issue 241). The two labels used to be the literal
     strings "Previous photograph" and "Next photograph", and on the volume's
     own gallery four of nine items are films — so the only channel a reader
     using assistive technology has was stating something false about them.
     The names are now derived from the item each arrow will REACH, which is a
     strictly stronger claim than the literals were: it still produces exactly
     those two strings for a set of stills (the vendored bootstrap set, and
     e2e/rendering-lanes.spec.mjs presses them by that name), and it cannot
     produce them for a film. Both halves are pinned — the derivation, and the
     absence of a hardcoded noun on either control. */
  assert.match(mediaGallery, /aria-label=\{`Previous \$\{itemNoun\(visible\[previousIndex\]\)\}`\}/);
  assert.match(mediaGallery, /aria-label=\{`Next \$\{itemNoun\(visible\[nextIndex\]\)\}`\}/);
  assert.doesNotMatch(
    mediaGallery,
    /aria-label="(?:Previous|Next) \w+"/,
    'an arrow names a kind literally again, so it will lie about half the strip'
  );
  /* The noun itself, and the field it reads: `video` is the same discriminator
     the stage's own kind attribute is built from, so the word and the element
     cannot disagree about what an item is. */
  assert.match(
    mediaGallery,
    /function itemNoun\(candidate: MediaGalleryItem\): string \{\s*return candidate\.video === undefined \? 'photograph' : 'film';/,
    'the label noun is no longer derived from the item’s own kind'
  );
  // The neighbours are derived with wrap-around arithmetic from the CLAMPED
  // position, so a label can never name an item the press will not reach.
  assert.match(mediaGallery, /const previousIndex = \$derived\(\(shown - 1 \+ total\) % total\)/);
  assert.match(mediaGallery, /const nextIndex = \$derived\(\(shown \+ 1\) % total\)/);
  // Text-free navigation affordance (issue 176): the controls carry an
  // accessible name, never visible label prose.
  assert.doesNotMatch(mediaGallery, />Next</);
  assert.doesNotMatch(mediaGallery, />Previous</);
  /* Both moves hand THE DERIVED NEIGHBOUR to goTo (issue 243 review finding
     1 kept the reset; issue 275 unified the arithmetic): the wrap lives in
     the two derivations pinned above, and the moves spend them, so the label
     and the landing place are one computation rather than two that agree. */
  assert.match(mediaGallery, /function next\(\): void \{\s*goTo\(nextIndex\);/, 'next must land on the derived neighbour');
  assert.match(
    mediaGallery,
    /function previous\(\): void \{\s*goTo\(previousIndex\);/,
    'previous must land on the derived neighbour'
  );
});

test('the position speaks its KIND and draws its ordinal (issue 241; owner sketch 2026-08-31)', () => {
  /* The live region is the only thing announced on a move, and it reads the
     item rather than assuming it — issue 241's claim, surviving the dots'
     retirement (issue 275) on the one surface that still speaks. */
  assert.match(
    mediaGallery,
    /function positionLabel\(at: number\): string \{[\s\S]*?const noun = itemNoun\(visible\[at\]\);/,
    'the position label no longer derives its noun from the item'
  );
  assert.match(
    mediaGallery,
    /<p class="gallery-count" aria-live="polite">\{positionLabel\(shown\)\}<\/p>/,
    'the live region announces a bare ratio again, so a move says nothing about what it landed on'
  );
  /* THE VISIBLE MARK IS THE ORDINAL (owner sketch: "1/n"), aria-hidden
     because the live region above already speaks the whole sentence —
     announcing both would say every move twice. It renders only when there
     is a strip to be positioned in. */
  assert.match(
    mediaGallery,
    /<p class="gallery-ordinal" aria-hidden="true">\{shown \+ 1\} \/ \{total\}<\/p>/,
    'the visible 1/n counter is gone or speaks over the live region'
  );
  /* And the dots are RETIRED, not renamed: no dot markup, no radio pattern,
     no dot keyboard — the stage pair is the press equivalent now. */
  assert.doesNotMatch(mediaGallery, /gallery-dot|radiogroup|onDotsKeydown/);
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
const scriptRegionSource = '(<script\\b[^>]*>)([\\s\\S]*?)(<\\/script\\b[^>]*>)';
const scriptRegions = () => new RegExp(scriptRegionSource, 'gi');

function stripLineComments(source) {
  return source.replace(scriptRegions(), (whole, open, body, close) => {
    let out = '';
    let quote = null;
    for (let at = 0; at < body.length; at += 1) {
      const char = body[at];
      if (quote !== null) {
        out += char;
        if (char === '\\') {
          out += body[at + 1] ?? '';
          at += 1;
        } else if (char === quote) {
          quote = null;
        }
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        quote = char;
        out += char;
        continue;
      }
      if (char === '/' && body[at + 1] === '/') {
        // To the end of the line, and the newline itself is KEPT: the walks
        // that read this text measure positions, and swallowing a line
        // terminator would join two statements into one.
        const end = body.indexOf('\n', at);
        if (end < 0) return `${open}${out}${close}`;
        at = end - 1;
        continue;
      }
      out += char;
    }
    return `${open}${out}${close}`;
  });
}

const galleryCode = stripLineComments(
  stripComments(mediaGallery).markup.replace(/\/\*[\s\S]*?\*\//g, ' ')
);

test('the prose-free source strips line comments only where // is a comment (issue 246)', () => {
  /* THE EXACT MUTANT the finding names: a `//` comment carrying `<button`
     above a loose glyph. Against the previous strip the enclosure walk found
     that prose and reported the glyph as enclosed — a surviving mutant. */
  const mutant = stripLineComments(
    ['<script>', '  // <button that is prose, not a control', '</script>', '<svg></svg>'].join('\n')
  );
  assert.doesNotMatch(mutant, /<button/, 'a // comment inside <script> still reaches the walks');

  /* THE SAME COMMENT, IN A TAG SPELLED DIFFERENTLY. HTML tag names are
     case-insensitive, so <SCRIPT> is script — and a strip that only knew the
     lowercase spelling would hand this block straight through with its
     comment intact, reintroducing the defect above through the spelling of
     the tag rather than through the comment. Every casing that a browser
     treats as one, this must treat as one.

     The last four rows are the end tag's own family, which is wider than
     the casing question. A parser ends a script block at `</script >`, at
     `</script\t\n bar>` and at `</script/>` alike — the junk before the `>`
     is ignored, not disqualifying — so a strip that recognises only the
     bare spelling runs PAST the real end of the block and keeps walking
     markup as if it were code. Each row here is one spelling a browser
     already accepts. */
  for (const [open, close] of [
    ['<SCRIPT>', '</SCRIPT>'],
    ['<Script>', '</script>'],
    ['<script>', '</SCRIPT >'],
    ['<script>', '</script >'],
    ['<script>', '</script\t\n bar>'],
    ['<script>', '</script/>'],
    ['<SCRIPT>', '</SCRIPT\tBAR>'],
  ]) {
    assert.doesNotMatch(
      stripLineComments([open, '  // <button that is prose, not a control', close].join('\n')),
      /<button/,
      `a // comment inside ${open}…${close} still reaches the walks; the tag filter knows only one spelling`
    );
  }
  /* …and the boundary that keeps that tolerance from turning into a prefix
     match. `</scriptfoo>` is NOT an end tag — a parser reads a different
     tag name and the script block continues — so the comment below it is
     still inside the block and must still be stripped. Drop the `\b` and
     the region ends at the impostor, the rest of the block is read as
     markup, and the loose `<button` reaches the walks. */
  assert.doesNotMatch(
    stripLineComments(
      ['<script>', '  let x = "</scriptfoo>";', '  // <button that is prose', '</script>'].join('\n')
    ),
    /<button/,
    '</scriptfoo> ended the block; it names a different tag and ends nothing'
  );

  /* And the other direction, so the casing tolerance cannot become a licence
     to strip outside script: markup is still markup whatever its case.
     Deliberately an UNQUOTED URL in an element's BODY, which is the only
     placement that can tell this apart — a URL in an attribute rides in the
     opening tag, which the replacer preserves verbatim, and a quoted one is
     protected by the string tracking, so either would pass against a filter
     that had stopped caring which tag it was in at all. That exact mutant
     survived the first draft of this assertion. */
  for (const [markup, kept] of [
    ['<P>see https://example.invalid/d for more</P>', 'https://example.invalid/d for more'],
    ['<div>https://example.invalid/e</div>', 'https://example.invalid/e'],
  ]) {
    assert.ok(
      stripLineComments(markup).includes(kept),
      `${markup} was scanned as script; only <script> regions may lose a //`
    );
  }

  /* And the property the naive repair would destroy. Both of these are places
     `//` is NOT a comment, so both must survive whole — the line as well as
     the URL, because a truncated line loses whatever followed it. */
  const kept = stripLineComments(
    [
      '<script>',
      '  const href = "https://example.invalid/a";',
      '</script>',
      '<a href="https://example.invalid/b">x</a>',
      '<style>.x { background: url("https://example.invalid/c"); }</style>',
    ].join('\n')
  );
  for (const letter of ['a', 'b', 'c']) {
    assert.match(
      kept,
      new RegExp(`https://example\\.invalid/${letter}`),
      `a // that is not a comment was stripped (case ${letter}); the naive "cut after //" repair is what this must never become`
    );
  }
  assert.match(kept, /<a href="[^"]*">x<\/a>/, 'markup after a URL was truncated');

  // Non-vacuity against the REAL subject: the component's own script does
  // carry line comments, and not one of them survives into what the walks
  // below read. Both halves are needed — the first proves this strip has
  // something to do here at all, the second that it did it.
  const scriptBody = (source) =>
    [...source.matchAll(scriptRegions())].map(([, , body]) => body).join('\n');
  assert.match(
    scriptBody(stripComments(mediaGallery).markup),
    /(?:^|\n)\s*\/\//,
    "MediaGallery's script no longer carries a line comment at all; this strip would be unexercised"
  );
  assert.doesNotMatch(
    scriptBody(galleryCode),
    /(?:^|\n)\s*\/\//,
    'a line comment survived into the source the enclosure and assignment walks read'
  );
});

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
    /\{#if item\.video\}[\s\S]*?data-gallery-kind="video"[\s\S]*?<video/,
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
  assert.doesNotMatch(enlargedBlock, /<video/, 'the lightbox mounts a player again; a film plays in the strip');
  /* The <source> half, RE-AIMED rather than dropped (issue 241). The enlarged
     surface now carries a <picture> so a phone is offered the preview instead
     of the master, and a <picture> is built from <source> elements — so the
     blanket ban would refuse the responsive image along with the player it was
     written about. What it was actually protecting is the shape a VIDEO rung
     has: `src` plus `type`. Every <source> in this branch must instead be an
     image rendition — `srcset`, no `src`, no media type — which a video rung
     can never satisfy, and which the ban's own subject therefore still fails. */
  const enlargedSources = [...enlargedBlock.matchAll(/<source\b[^>]*>/g)].map(([tag]) => tag);
  assert.ok(enlargedSources.length > 0, 'the enlarged surface offers no rendition choice at all');
  for (const tag of enlargedSources) {
    assert.match(tag, /\bsrcset=/, `the lightbox carries a non-image <source>: ${tag}`);
    assert.doesNotMatch(tag, /\bsrc=/, `the lightbox carries a video-shaped <source>: ${tag}`);
    assert.doesNotMatch(tag, /\btype=/, `the lightbox carries a media-typed <source>: ${tag}`);
  }
  assert.match(enlargedBlock, /<picture>/, 'the enlarged renditions are not inside a <picture>');

  /* The element is KEYED on the item, which is what makes "navigating away
     unmounts it" true between two FILMS as well: swapping <source> children
     under a live <video> does not re-run resource selection, so an unkeyed
     branch would keep the previous film's bytes under the new poster. */
  assert.match(galleryMarkup, /\{#key item\.key\}/, 'the player is reused across items');

  /* NO PLAY TRIANGLE IS DECORATION — RE-AIMED, and the re-aim is stated
     because the letter of the old pin would have been satisfiable without
     honouring it (issue 243).
     What the owner objected to in 0.1.53 was a mark that PROMISED a press
     happening somewhere else: "remove the play icon from all videos, its just
     there doing nothing". The old pin expressed that as an absence — no
     class, no triangle path, no token — and issue 243 puts a triangle back,
     because the same owner then asked for a play control that is the ONLY
     sensitive area on a film. Renaming the class and redrawing the path would
     pass the old assertions while restoring exactly the object they were
     written against, so the assertion moves to the property that actually
     distinguishes the two: every play triangle in this file is inside a
     <button> that starts the film, and no drawn mark sits loose on a poster.
     The retired names stay retired below, so the old shape cannot come back
     under its own identity either.

     COMMENT-BLIND, and that is load-bearing rather than tidiness: this walk
     decides enclosure from the NEAREST PRECEDING `<button` in the text, and
     three of this component's own explanatory comments contain the literal
     `<button>` in prose. Against the raw source a loose triangle inserted just
     after `{#if !playing}` found one of those as its "enclosing" control and
     survived green — a real surviving mutant, caught by review rather than by
     this pin, and repaired by reading the same bytes the compiler does. */
  const playGlyphs = [...galleryCode.matchAll(/<svg[\s\S]*?<\/svg>/g)].filter(([svg]) =>
    /<path d="M\d[^"]*"\s+fill="currentColor"/.test(svg)
  );
  assert.ok(playGlyphs.length > 0, 'the film has no play glyph at all; the control has no visible mark');
  for (const [glyph] of playGlyphs) {
    const at = galleryCode.indexOf(glyph);
    const enclosing = galleryCode.slice(0, at);
    const opened = [...enclosing.matchAll(/<button\b|<\/button>/g)].at(-1)?.[0];
    assert.equal(
      opened,
      '<button',
      'a filled glyph is painted outside any control; a mark that promises a press happening elsewhere is the defect issue 233 removed'
    );
  }
  assert.doesNotMatch(mediaGallery, /gallery-play-mark/, 'the decorative play mark is back under its own name');
  assert.doesNotMatch(mediaGallery, /M9 7\.5l8 4\.5-8 4\.5z/, 'the retired decorative triangle is drawn again');
  for (const token of ['--gallery-play-size', '--gallery-play-inset', '--gallery-play-surface', '--gallery-play-ink']) {
    assert.ok(!mediaGallery.includes(token), `${token} outlived the mark it sized`);
    assert.ok(!styles.includes(token), `styles.css still declares ${token}`);
  }
});

test('ONE stage box: no expression anywhere gives a film a different one (issue 243)', () => {
  /* SUPERSEDES 'a film’s stage takes the video token pair' (issue 233), and
     the reversal is the owner's own: "make it one single block that doesn't
     expand, reduce based on the media". The retired pin required a film to be
     sized by --gallery-stage-*-video, a 768x432 stage against a still's
     448x448 — which answered a real complaint (a 16:9 film inside a square
     sits between two bands of ground) by changing the size of the one object
     on the page the owner watches, on every press of the next arrow.
     What replaces it is an ABSENCE pin, because that is the only form that
     makes the owner's sentence structural: if no expression anywhere sizes a
     film differently, the block cannot expand for one. */
  const style = styleBlock(mediaGallery);
  /* The arithmetic is stated ONCE and reads the two custom properties,
     exactly as before — that half is unchanged and still the reason there is
     one piece of stage geometry on this page. Since 2026-08-29 the ONE
     statement is the --gallery-stage-inline property on the frame, because
     the desktop nav pair positions against the same number the stage is
     sized by; both consumers read the property, so a second copy of the
     expression cannot appear on either side without this count going red. */
  assert.equal(
    [...style.matchAll(/--gallery-stage-inline:\s*min\(100%, calc\(var\(--gallery-stage-size, 28rem\) \* var\(--gallery-stage-aspect, 1\)\)\);/g)]
      .length,
    1,
    'the stage-width expression must be declared exactly once, on the frame'
  );
  assert.match(
    style,
    /\.gallery-stage\s*\{[^}]*inline-size:\s*var\(--gallery-stage-inline, 100%\)/,
    'the stage no longer takes its width from the one shared expression'
  );
  assert.match(style, /aspect-ratio: var\(--gallery-stage-aspect, 1\)/);
  assert.match(style, /max-block-size: var\(--gallery-stage-size, 28rem\)/);
  assert.ok(styles.includes('--gallery-stage-size: 28rem;'));
  assert.ok(styles.includes('--gallery-stage-aspect: 1;'));

  /* THE SIZE MAY NOT BE SELECTED BY KIND. The kind rule survives — it picks
     the GROUND a film is letterboxed against — so this is not "no kind rule"
     but the narrower and correct "no kind rule that touches the box". Each of
     the four properties is named, because redeclaring the tokens and setting
     the resulting lengths directly are different mutations with the identical
     visible effect. */
  const kindRule = /\.gallery-stage\[data-gallery-kind='video'\]\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.ok(kindRule.length > 0, 'the film stage rule is not where this pin expects it');
  for (const property of [
    '--gallery-stage-size',
    '--gallery-stage-aspect',
    'aspect-ratio',
    'inline-size',
    'block-size',
    'max-block-size',
    'max-inline-size'
  ]) {
    assert.doesNotMatch(
      kindRule,
      new RegExp(`(?:^|[;\\s])${property}\\s*:`),
      `a film's stage sets ${property} of its own; the block expands for a film again`
    );
  }

  /* And the retired tokens are GONE from the token layer, not merely unread.
     A default left declared in styles.css is one component edit away from
     bringing the second shape back, and this pin would not see that edit. */
  for (const token of ['--gallery-stage-size-video', '--gallery-stage-aspect-video']) {
    assert.ok(!styles.includes(`${token}:`), `styles.css still declares ${token}, so the second stage shape is one edit away`);
    assert.ok(!mediaGallery.includes(token), `the gallery still reads ${token}`);
  }

  /* THE MEDIA REDUCES INSIDE THE BOX, which is the other half of the owner's
     sentence and the reason a constant block is not a crop. `contain` letters
     a film inside the stage; `cover` would fill the same box by cutting the
     film, and a cropped film is a different film. */
  const player = /\.gallery-player\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.ok(player.length > 0, 'the player rule is not where this pin expects it');
  assert.match(player, /object-fit:\s*contain;/, 'the film is cropped to the block instead of reduced inside it');
  assert.match(player, /inline-size:\s*100%;/);
  assert.match(player, /block-size:\s*100%;/);
});

test('a film is swipeable until the reader hands the surface to the player (issue 243)', () => {
  /* SUPERSEDES 'the player owns its own surface: no swipe binding, no button,
     no gallery arrow keys' (issue 233), on the owner's ruling: "you cannot
     swipe out of a video, it instead starts to play immediately... the
     sensitive area should only be the button and not the entire video".
     The retired pin refused a swipe binding on a film's stage outright, and
     its reasoning was sound — a horizontal drag along a seek bar is exactly
     what lib/gesture.ts claims, and the action captures the pointer the moment
     it claims. What it got wrong was SCOPE: it disarmed the whole stage for
     the whole life of the item, including all the time before the reader has
     shown any interest in playing anything.
     So the protection is now expressed as a STATE — an element that exists
     for exactly as long as the swipe should be available — and this pin holds
     both ends of it: the veil swipes, and the veil is gone the moment there
     are native controls to contest. */
  const videoStage = /data-gallery-kind="video"([\s\S]*?)\n          <\/div>/.exec(galleryMarkup)?.[1] ?? '';
  assert.ok(videoStage.length > 0, 'the film’s stage is not where this pin expects it');

  // THE VEIL SWIPES, exactly as the still's stage does.
  assert.match(
    videoStage,
    /<div class="gallery-film-veil" use:swipeHorizontal=\{swipe\}>/,
    'a film’s swipe surface is gone; the owner’s "you cannot swipe out of a video" is back'
  );
  assert.match(
    galleryMarkup,
    /<div\s+class="gallery-stage"\s+data-gallery-kind="image"[\s\S]*?use:swipeHorizontal=\{swipe\}/,
    'the still’s stage lost the swipe it has always had'
  );

  /* THE VEIL AND THE CONTROLS ARE MUTUALLY EXCLUSIVE, which is what keeps the
     retired pin's real concern satisfied. Both halves read the same one piece
     of state, so there is no arrangement of the markup in which a swipe
     surface sits over a live seek bar. */
  assert.match(videoStage, /\{#if !playing\}/, 'the veil is not gated on the play state at all');
  assert.match(
    videoStage,
    /controls=\{playing\}/,
    'the player declares controls unconditionally, so a seek bar exists under the veil'
  );

  /* THE ONLY SENSITIVE AREA IS THE BUTTON — the owner's exact requirement.
     The veil holds precisely one control, and it is the play control.

     The extraction really is the veil now, and the review is why it says so:
     the first cut had no capture group at all, so `?.[1]` was always undefined
     and the whole video stage stood in for it. That was stricter than
     advertised rather than weaker — nothing outside the veil carries a button
     either — but a scope the comment claims and the code does not have is a
     pin nobody can reason about. */
  const veil = /<div class="gallery-film-veil"[^>]*>([\s\S]*?)\n {14}<\/div>/.exec(videoStage)?.[1];
  assert.ok(
    veil !== undefined && veil.trim().length > 0,
    'the veil block is not where this pin expects it; the scope below would silently widen to the whole stage'
  );
  assert.doesNotMatch(veil, /<video/, 'the extracted veil swallowed the player, so its scope is not the veil');
  assert.equal(
    [...veil.matchAll(/<button/g)].length,
    1,
    'a film’s swipe surface carries a number of controls other than exactly the one play button'
  );
  assert.match(veil, /class="gallery-play"/, 'the film’s one control is not the play control');

  /* PLAY IS STARTED FROM ONE PLACE, and only from a press. There is no other
     call to play() in the file, which is what keeps "nothing autoplays" a
     property of the source rather than of a review. */
  assert.equal(
    [...mediaGallery.matchAll(/\.play\(\)/g)].length,
    1,
    'the player is started from more than one place'
  );
  assert.match(
    mediaGallery,
    /function startFilm\(\): void \{\s*playingKey = item\.key;\s*void playerEl\?\.play\(\)/,
    'the handover is not the single press-driven start this pin expects'
  );

  /* ENDED HANDS THE SURFACE BACK; PAUSE DOES NOT. The asymmetry is deliberate
     (see the issue 243 block in the component): restoring the veil on pause
     would put a swipe surface over the controls the reader stopped the film
     to use, and cost them their position on every pause. */
  assert.match(videoStage, /onended=\{onFilmEnded\}/, 'a finished film never gets its swipe surface back');
  assert.doesNotMatch(videoStage, /onpause=/, 'pausing snatches the controls back from a reader who is using them');

  /* AND NO FILM INHERITS ANOTHER'S SURFACE STATE. Two independent halves, and
     the first cut of issue 243 shipped only one of them — which is why the
     second is pinned here rather than trusted.

     Half one, the DERIVATION: `playing` is true only while the key names the
     current item, so no mount/unmount ordering can render a film carrying
     another film's state. */
  assert.match(
    mediaGallery,
    /const playing = \$derived\(playingKey !== undefined && playingKey === item\.key\)/,
    'the play state is not bound to the item it belongs to'
  );
  /* Half two, the RESET, and the review finding it exists for: a derivation
     SUPPRESSES a stale key, it does not clear one, so returning to a film
     played once re-armed it with no press. The key is cleared where the index
     moves — and `index` is assigned in exactly ONE place in the component, so
     a control added later cannot move the strip without handing the surface
     back. That count is the pin: routing every caller through goTo is what
     makes the reset structural rather than five call sites somebody has to
     remember. */
  assert.match(
    mediaGallery,
    /function goTo\(at: number\): void \{\s*index = at;\s*playingKey = undefined;\s*\}/,
    'the one function that moves the strip does not hand the film surface back'
  );
  const indexWrites = [...galleryCode.matchAll(/(?<![\w$.])index\s*=(?!=)/g)];
  assert.equal(
    indexWrites.length,
    2,
    `the component assigns \`index\` ${indexWrites.length} times; it must be exactly twice — its $state declaration and the assignment inside goTo — or a move through the strip can skip the reset`
  );
  assert.match(galleryCode, /let index = \$state\(0\);/, 'the index declaration moved');
  /* And every mover calls it, named individually so a silent revert of any
     one of them is a failure rather than a count that still happens to add
     up: the two arrows, the set choice landing on the new strip's start
     (issue 275), and the shrink guard bringing a stale position home. */
  for (const caller of [
    /function next\(\): void \{\s*goTo\(nextIndex\);/,
    /function previous\(\): void \{\s*goTo\(previousIndex\);/,
    /chosenSet = name;\s*goTo\(0\);/,
    /if \(index >= total && total > 0\) \{\s*goTo\(0\);/
  ]) {
    assert.match(galleryCode, caller, `a control moves the strip without going through goTo: ${caller}`);
  }

  /* The keyboard equivalence, which the retired design left a film without:
     the strip's arrow handler is on the play control as well as on the
     enlarge button, so a film is no worse off by keyboard than a still. Once
     the player has the surface the arrows are the player's, exactly as
     before — the veil, and the handler with it, is gone by then. The desktop
     nav pair carries the same handler (2026-08-29), so all four are the
     strip's keyboard surface and the count pins the roster. */
  assert.match(galleryMarkup, /class="gallery-image-button"[\s\S]*?onkeydown=\{onFrameKeydown\}/);
  assert.match(galleryMarkup, /class="gallery-play"[\s\S]*?onkeydown=\{onFrameKeydown\}/);
  assert.equal([...galleryMarkup.matchAll(/onkeydown=\{onFrameKeydown\}/g)].length, 4);

  /* And the invariant that keeps the retired lightbox branch unreachable
     rather than merely unused: the dialog cannot be left open on a film. */
  assert.match(
    mediaGallery,
    /if \(enlarged \&\& item\.video !== undefined\) \{\s*enlarged = false;/,
    'the lightbox can still be left open on a film it cannot show'
  );
});

test('the strip owns its settle: a new grab ends it, and a turn enters forward (issue 265)', () => {
  /* Three measured defects meet in this one binding, and each of them is a
     line here rather than a behaviour a reader has to catch.

     D6/D7 — `settling` arms the CSS transition, and it was cleared only by a
     free-running setTimeout nobody held. A swipe begun inside that window
     dragged through a still-armed transition (MEASURED at 66-93px of lag
     between finger and picture), and one settle's timer could disarm the
     NEXT settle mid-flight. The timer is owned now: cleared before it is
     re-armed, and ended early by the one event that always comes first. */
  assert.match(galleryCode, /down: \(\) => endSettle\(\)/, 'a new grab no longer ends the settle it interrupted');
  assert.match(
    galleryCode,
    /function endSettle\(\): void \{\s*clearTimeout\(settleTimer\);\s*settleTimer = undefined;\s*settling = false;/,
    'ending the settle leaves its timer running, so it can still disarm the next one'
  );
  assert.match(
    galleryCode,
    /function armSettle\(\): void \{\s*clearTimeout\(settleTimer\);/,
    'a settle is armed without cancelling the timer already running'
  );
  assert.doesNotMatch(
    galleryCode,
    /setTimeout\(\(\) => \(settling = false\)/,
    'the unowned free-running settle timer is back'
  );

  /* D5 — a committed turn used to mount the new item at the OLD drag offset,
     so it slid in BACKWARDS from the side it had just left (120-202px of
     wrong-way travel per swipe). The entry offset is the arithmetic in
     lib/gesture.ts, taken BEFORE the index moves because it is built from the
     offset the finger left behind. */
  assert.match(
    galleryCode,
    /entering = entryOffset\(dragX, direction, swipe\.span\(\)\);/,
    'the incoming item does not enter from its own side'
  );
  assert.match(galleryCode, /import \{ entryOffset, swipeHorizontal \} from '\.\.\/gesture\.ts';/);
  /* And the ORDER, which is the whole repair: the entry position is written
     with the transition off, flushed to the engine by a forced box read, and
     only then does the transition arm and the offset go to zero. Both writes
     inside one style recalc would animate from wherever the element already
     was, which is the defect. */
  assert.match(
    galleryCode,
    /endSettle\(\);\s*dragX = entering;\s*await tick\(\);\s*stageEl\?\.getBoundingClientRect\(\);/,
    'the entry position is never flushed, so the turn animates from the old offset again'
  );
  assert.match(
    galleryCode,
    /entering = 0;\s*armSettle\(\);\s*dragX = 0;/,
    'the settle does not arm the transition before travelling home'
  );
  // A reader who asked for less motion is handed the destination, not a
  // two-step jump: no entry offset at all.
  assert.match(
    galleryCode,
    /if \(entering !== 0 && !reducedMotion\(\)\) \{/,
    'a reduced-motion reader is given the entry jump anyway'
  );
});

test('the prev/next pair lives on the stage, on every device, inside 44px targets (owner sketch 2026-08-31)', () => {
  const style = styleBlock(mediaGallery);
  /* The owner's 2026-08-31 sketch (issue 275) draws the arrows at the
     stage's sides with no device carve-out, and the dot row's retirement is
     what makes that structural: the pair is now the gesture's ONE
     press-and-keyboard equivalent, so a capability gate hiding it from a
     phone would leave the swipe with no equivalent at all. The 2026-08-29
     hidden-by-default rule retired with the dots that justified it. */
  const navRule = /\.gallery-nav\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.match(navRule, /display:\s*grid;/, 'the nav pair no longer renders');
  assert.doesNotMatch(
    navRule,
    /display:\s*none/,
    'the nav pair is hidden again; with the dots retired that leaves the swipe no press equivalent'
  );
  assert.equal(
    [...style.matchAll(/@media[^{]*\{\s*\.gallery-nav\b/g)].length,
    0,
    'the pair is capability-gated again (2026-08-29 rule); the 2026-08-31 sketch shows it on every device'
  );
  assert.match(navRule, /min-inline-size:\s*2\.75rem;/, 'the pair lost its 44px inline target');
  assert.match(navRule, /min-block-size:\s*2\.75rem;/, 'the pair lost its 44px block target');
  /* At the STAGE's edges, from the same one expression the stage is sized
     by — see the ONE-stage-box pin above for the declaration count. */
  assert.match(
    style,
    /inset-inline-start:\s*calc\(\(100% - var\(--gallery-stage-inline\)\) \/ 2 \+ var\(--gallery-nav-inset, 0\.375rem\)\)/,
    'the previous control no longer sits at the stage’s own edge'
  );
  assert.match(
    style,
    /inset-inline-end:\s*calc\(\(100% - var\(--gallery-stage-inline\)\) \/ 2 \+ var\(--gallery-nav-inset, 0\.375rem\)\)/,
    'the next control no longer sits at the stage’s own edge'
  );
  /* The painted disc reads the token family, styles.css declares it, and the
     ink is smaller than the disc, which is smaller than the target — the
     same shrink-the-ink-never-the-target trade every gallery control makes. */
  const discRule = /\.gallery-nav-disc\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.match(discRule, /inline-size: var\(--gallery-nav-size, 2\.25rem\);/);
  assert.match(discRule, /block-size: var\(--gallery-nav-size, 2\.25rem\);/);
  assert.match(discRule, /background: var\(--gallery-nav-surface, rgba\(0, 0, 0, 0\.55\)\);/);
  assert.match(discRule, /opacity: var\(--gallery-nav-rest-opacity, 0\.7\);/);
  for (const token of [
    '--gallery-nav-size: 2.25rem;',
    '--gallery-nav-surface: rgba(0, 0, 0, 0.55);',
    '--gallery-nav-ink: white;',
    '--gallery-nav-rest-opacity: 0.7;',
    '--gallery-nav-inset: 0.375rem;'
  ]) {
    assert.ok(styles.includes(token), `styles.css does not declare ${token}`);
  }
  // Both chevrons declare the same painted box, sized to sit inside the disc.
  assert.equal(
    [...mediaGallery.matchAll(/width="16" height="16"/g)].length,
    2,
    'the two nav chevrons do not both declare the disc-sized glyph'
  );
  /* And the pair NAVIGATES — through the same two functions everything else
     uses, so goTo()'s handover reset covers a press on either button. The
     one-index-write pin above is what makes this sufficient. */
  assert.match(galleryMarkup, /data-gallery-nav="previous"\s+onclick=\{previous\}/);
  assert.match(galleryMarkup, /data-gallery-nav="next"\s+onclick=\{next\}/);
  /* The retired control-row chevrons stay retired, and the dots' own tokens
     went with the dots (issue 275). Declaration-or-read forms only (name
     plus colon, or inside var()), so a history note in prose does not count
     as a token coming back. */
  for (const retired of ['--gallery-arrow-size', '--gallery-dot-size', '--gallery-dot-active-scale']) {
    const pattern = new RegExp(`${retired}\\s*[:,)]`);
    assert.doesNotMatch(style, pattern, `the retired token ${retired} is read again`);
    assert.doesNotMatch(styles, pattern, `styles.css still declares the retired token ${retired}`);
  }
  assert.match(styles, /\.icon-button\s*\{[^}]*inline-size:\s*2\.75rem/);
});

test('nothing in the gallery ever autoplays, and reduced motion is structural (issue 207)', () => {
  // The strongest form this assertion has: the ATTRIBUTE cannot appear
  // anywhere in the file, so there is no conditional, muted, or
  // "just-for-the-poster" branch that could reintroduce it. Reduced motion is
  // then honoured by construction rather than by a media query — there is no
  // motion until a reader presses play, and a reader pressing play asked.
  assert.doesNotMatch(galleryMarkup, /autoplay/i, 'no autoplay attribute may exist anywhere in the gallery markup');
  /* RE-AIMED (issue 243): the attribute is now `controls={playing}`, so the
     native controls are HANDED OVER on a press rather than declared up front.
     The claim this half makes is unchanged — a reader who plays a film gets
     real controls — and it is strictly narrower, because the value must be
     the play state rather than any truthy expression somebody could write. */
  assert.match(galleryMarkup, /<video[\s\S]*?\n\s+controls=\{playing\}\n/, 'the video must hand over native controls');
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

test('the film stage paints a ground of its own, so a poster in flight is not a white hole (issue 239)', () => {
  const style = styleBlock(mediaGallery);
  const filmStage = /\.gallery-stage\[data-gallery-kind='video'\]\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.ok(filmStage.length > 0, 'the film stage rule is not where this pin expects it');
  /* The rule the defect was: the stage declared no background, so the
     reservation was transparent and the page's own near-white surface showed
     through a 768x432 hole while a poster was still in flight. */
  assert.match(
    filmStage,
    /background:\s*var\(--gallery-stage-ground\)/,
    'the film stage paints no ground of its own; a poster still in flight shows the page through the reservation'
  );
  /* The value is a GLOBAL token like every other dimension the stage reads,
     so it is tuned in styles.css and the component states no colour. Since
     the owner's light-mode ruling (2026-08-31, the issue-275 wave: "really
     ugly black lines in light mode") the token BRANCHES by reading mode, so
     both halves are measured rather than asserted. The :root default is the
     exact white anthropic.com opens on — its compiled CSS's ivory-light
     swatch — because the owner named that value; and every dark reading
     mode must remap the token, by reference as the color roles do, onto a
     shared projection ground that is genuinely dark. A form either pin
     cannot measure fails loudly rather than passing by default. */
  const declared = /--gallery-stage-ground:\s*(rgb\([^)]*\));/.exec(styles)?.[1]?.trim();
  assert.equal(
    declared,
    'rgb(250, 249, 245)',
    `the light-mode --gallery-stage-ground is "${declared}"; the owner ruled it the white anthropic.com opens on`
  );
  const projection = /--palette-projection-ground:\s*([^;]+);/.exec(styles)?.[1]?.trim();
  const channels = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(projection ?? '');
  assert.ok(
    channels,
    `--palette-projection-ground is "${projection}", which this pin cannot resolve to channels; state it as rgb(r, g, b) so its darkness can be measured`
  );
  for (const channel of channels.slice(1).map(Number)) {
    assert.ok(
      channel <= 64,
      `--palette-projection-ground is "${projection}"; the dark modes' letterbox must be a dark ground, and a light one is the white hole issue 239 removed`
    );
  }
  /* One remap per dark-family block — the OS auto mapping, dark, slate,
     sepia — counted rather than located: a mode that misses the remap falls
     through to the light ivory, silently, in that mode only, which is the
     exact fault class the reading-mode parity pin exists for. */
  const remaps = styles.match(/--gallery-stage-ground:\s*var\(--palette-projection-ground\)/g) ?? [];
  assert.equal(
    remaps.length,
    4,
    'every dark reading-mode block must remap the stage ground onto the shared projection value'
  );
  /* Zero CLS: the ground paints the box the three declarations above already
     measured, so this rule may not restate a size of its own. */
  assert.doesNotMatch(
    filmStage,
    /(?:^|[;{])\s*(?:inline-size|block-size|width|height|aspect-ratio|padding|margin)\s*:/,
    'the film stage rule states a dimension of its own; the reservation is built from the two stage tokens and nothing else'
  );
});

test('the source ladder renders in the manifest’s own order, never re-ranked (issue 207)', () => {
  // The browser takes the first source it can decode, so ORDER is the
  // preference. A sort, filter or reverse here would silently hand a reader
  // different bytes than the operator published.
  assert.match(mediaGallery, /\{#each item\.video\.sources as source \(source\.src\)\}/);
  /* The rung now also declares WHICH VIEWPORT may ask for it (issue 241), and
     that is an addition to the ladder rather than a re-ranking of it: the
     attribute is bound straight from the source the adapter built, so the
     component still neither computes a breakpoint nor moves a rung. */
  assert.match(mediaGallery, /<source src=\{source\.src\} type=\{source\.type\} media=\{source\.media\} \/>/);
  for (const forbidden of [/item\.video\.sources\.sort/, /item\.video\.sources\.filter/, /item\.video\.sources\.reverse/]) {
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
  assert.match(artBinding, /runtimeBlock\(/);
  assert.match(artBinding, /loadGalleryManifest\(\)/);
  assert.match(artBinding, /if \(items === null\) \{\n\s+return null;/);
  // The adapter still resolves the vendored file names through the bundler,
  // and still never assembles a media URL of its own: the manifest reader
  // built those through lib/media.ts before this module saw them.
  assert.match(artBinding, /import\.meta\.glob\('\.\.\/\.\.\/assets\/images\/gallery\/\*\.webp'/);
  assert.doesNotMatch(artBinding, /\/media\/|mediaUrl\(/, 'the adapter must never build a media URL itself');
  /* The poster choice is DELEGATED (issue 239). The rule now lives beside the
     manifest field it reads, where gallery-manifest.test.mjs EXECUTES it
     against real admitted items; this layer only binds the answer to a prop.
     The branch is extracted rather than swept whole, because `item.full` is a
     legitimate read two lines above it — the still a reader enlarges to — and
     a file-wide ban would forbid the correct use along with the wrong one. */
  const filmBranch = /if \(item\.kind === 'video'[\s\S]*?\n {2}\}/.exec(artBinding)?.[0] ?? '';
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
    artBinding,
    /sources: item\.sources\.map\(\(source, at\) => \{/,
    'the ladder must be mapped straight through, with nothing between the manifest order and the props'
  );
  assert.match(
    artBinding,
    /src: source\.url,\n\s+type: source\.type/,
    'a rung’s url and media type must come straight off the admitted source'
  );
  for (const forbidden of [/\.reverse\(/, /\.sort\(/, /\.toSorted\(/, /\.toReversed\(/]) {
    assert.doesNotMatch(artBinding, forbidden, 'the adapter must not reorder items or renditions');
  }
  /* The size question is DELEGATED, exactly as the poster choice above is: the
     rule that decides which viewport may ask for which rung lives beside the
     ladder it reads (galleryVideoSourceMedia, lib/galleryManifest.ts), where
     gallery-manifest.test.mjs executes it against real admitted items. This
     layer zips the answer positionally and computes nothing. */
  assert.match(filmBranch, /const media = galleryVideoSourceMedia\(item\);/);
  assert.match(filmBranch, /const query = media\[at\];/);
  assert.doesNotMatch(
    artBinding,
    /min-width|source\.height/,
    'the adapter derives a breakpoint of its own instead of reading the one the manifest module states'
  );
  /* And the preview's own width travels with the item, which is the one number
     the enlarged surface needs to stop sending every reader the master. */
  assert.match(artBinding, /previewWidth: item\.preview\.width/);
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
    /* The lane inside it (issue 265): the caption's own gap moved onto the
       per-item lane when the box became a reserved stack, and the token
       obligation moved with the declaration exactly as --gallery-close-surface
       did at issue 202 — the rule that USES a dimension is the rule that owes
       it a token. */
    captionLane: /\.gallery-caption-lane\s*\{([^}]*)\}/.exec(style)?.[1] ?? '',
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
    ['captionLane', '--gallery-caption-gap'],
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
     byte-independent. The expression itself lives on the frame since
     2026-08-29 (the nav pair positions against the same number); what this
     pin still holds is that the stage's width is DEFINITE — the shared
     property, whose declaration the ONE-stage-box pin counts, with a
     definite fallback — never content-sized. */
  assert.match(
    stage,
    /inline-size:\s*var\(--gallery-stage-inline, 100%\)/,
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
  /* The frame the stage is centred in, RE-AIMED (issue 241). It used to be a
     three-column row — arrow, 1fr track, arrow — and the centring mattered
     because the stage was narrower than that track. The arrows have left the
     row, so the track IS the frame; the alignment still matters for exactly
     the same reason (the stage's inline size is capped by its own token) and
     is now stated as `place-items: center` beside the reservation. */
  const frame = /\.gallery-frame\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.match(frame, /place-items:\s*center/, 'the stage is no longer centred in the frame');
  assert.doesNotMatch(
    frame,
    /grid-template-columns/,
    'the frame declares a track arrangement again; the arrows live in the control row now'
  );
});

test('the frame reserves ONE box, so changing kind moves nothing (issue 241)', () => {
  /* The zero-CLS defect this closes, measured: a still's stage is a square and
     a film's is 16:9, so pressing next across the boundary resized the
     document — -105.9px at a 390px viewport going still to film, +105.9px
     coming back. Reserving on the STAGE can never fix that, because the stage
     is the thing whose shape the kind changes. So the reservation moved up to
     the frame, which is item-blind and kind-blind by construction: it names no
     kind attribute, and it is built from the SAME size token the still's own
     stage is, so the taller of the two shapes is what the page is laid out
     from and neither stage can exceed it. */
  const style = styleBlock(mediaGallery);
  const frame = /\.gallery-frame\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.ok(frame.length > 0, 'the frame rule is not where this pin expects it');
  // Anchored for the same reason the dot row's zero is, below: `min-inline-size:
  // 100%` contains this string and reserves nothing.
  assert.match(
    frame,
    /^\s*inline-size:\s*100%/m,
    'the frame no longer fills the card, so its reservation follows content'
  );
  /* The semicolon is load-bearing: `aspect-ratio: 1` also matches "1.7778",
     which is the film's own ratio and exactly the mutation this pin exists to
     refuse — a frame shaped like one of the two kinds is the defect. */
  assert.match(frame, /aspect-ratio:\s*1;/, 'the frame reserves no shape of its own, or reserves one kind’s shape');
  assert.match(
    frame,
    /max-block-size:\s*var\(--gallery-stage-size, 28rem\)/,
    'the frame’s reservation is not built from the same token the still’s stage is, so the two may disagree'
  );
  /* The reservation may not be selected by kind, in either direction: a rule
     that gave a film a different frame would be this defect written twice. */
  assert.doesNotMatch(
    style,
    /\.gallery-frame\[data-gallery-kind/,
    'the frame’s box is chosen by the item’s kind again'
  );
  assert.doesNotMatch(
    galleryMarkup,
    /<div class="gallery-frame"[^>]*data-gallery-kind/,
    'the frame declares a kind, so the box the page is laid out from can change with the item'
  );
  /* And the stage inside it cannot exceed the reservation — which since issue
     243 is a stronger statement than it was, because there is now exactly ONE
     stage box and it is built from the same token the frame is. The old form
     of this compared a film's own block token against the square's; with the
     film's token retired, what is left to prove is that the two boxes are
     built from the SAME source, so they cannot disagree at any value.

     Read from the stylesheet rather than written here, for the reason the
     retired form recorded: the first version of this assertion compared two
     literals — `assert.ok(27 < 28, …)` — which no mutation of any source file
     could turn red. A pin that claims to hold something must be able to
     fail. */
  const stageRule = /\.gallery-stage\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.ok(stageRule.length > 0, 'the stage rule is not where this pin expects it');
  const frameCap = /max-block-size:\s*var\((--[\w-]+),/.exec(frame)?.[1];
  const stageCap = /max-block-size:\s*var\((--[\w-]+),/.exec(stageRule)?.[1];
  assert.ok(frameCap, 'the frame states no block cap this pin can read');
  assert.equal(
    stageCap,
    frameCap,
    `the stage is capped by ${stageCap} inside a frame reserving ${frameCap}; the two can disagree and the stage can overflow the box the page was laid out from`
  );
  const declared = new RegExp(`${frameCap}:\\s*([0-9.]+)rem;`).exec(styles);
  assert.ok(declared, `styles.css declares no ${frameCap}, so the reservation resolves to nothing`);
});

test('the set control is quiet chrome, its menu the page’s one popover grammar, and the artwork accepts a pinch (issue 275; issue 241)', () => {
  const style = styleBlock(mediaGallery);
  /* THE SET CONTROL (owner sketch, 2026-08-31: "sleek, small"): the button
     paints nothing of its own — no border, no fill, meta-step type — and
     still carries the 44px floor by minimums, the same
     shrink-the-ink-never-the-target trade every quiet control on this page
     makes. */
  const setButton = /\.gallery-set-button\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.ok(setButton.length > 0, 'the set button rule is not where this pin expects it');
  assert.match(setButton, /background:\s*transparent;/, 'the set button paints a surface of its own');
  assert.match(setButton, /min-inline-size:\s*2\.75rem;/, 'the set button lost its 44px inline target');
  assert.match(setButton, /min-block-size:\s*2\.75rem;/, 'the set button lost its 44px block target');
  assert.match(setButton, /font-size:\s*var\(--card-meta-size\);/, 'the set button restates a type step');
  /* The open menu moves NOTHING: absolutely positioned out of flow (the
     owner weighed the brief overlap of the stage and took it), on the
     page's shared popover tokens rather than values of its own. */
  const setMenu = /\.gallery-set-menu\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.match(setMenu, /position:\s*absolute;/, 'an open menu reflows the page instead of overlaying it');
  assert.match(setMenu, /border-radius:\s*var\(--theme-menu-radius\);/, 'the menu invents its own curve');
  assert.match(setMenu, /padding:\s*var\(--swatch-popover-padding\);/, 'the menu invents its own padding');
  /* Each option is a real ≥44px control, and the chosen one is marked by
     weight — never by color alone (dataviz floor). */
  const setOption = /\.gallery-set-option\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
  assert.match(setOption, /min-block-size:\s*2\.75rem;/, 'an option is under the touch floor');
  assert.match(style, /\.gallery-set-option\[aria-selected='true'\]\s*\{[^}]*font-weight/);

  /* THE PINCH. `pan-y` alone refuses a two-finger zoom on the one element a
     reader would ever try it on. The base declaration under it is not
     decoration: an engine that does not know `pinch-zoom` drops the whole
     declaration, and without a base that would hand the horizontal axis back
     to the browser and leave the swipe fighting it. */
  const stage = [...style.matchAll(/\.gallery-stage\s*\{([^}]*)\}/g)].map(([, body]) => body).join('\n');
  assert.match(
    stage,
    /touch-action:\s*pan-y;[\s\S]*touch-action:\s*pan-y pinch-zoom;/,
    'the artwork refuses a pinch, or upgrades to one with no base under it'
  );
});

test('the media sets are data: kind-derived by default, named by the manifest, chrome only when there is a choice (issue 275)', () => {
  /* The default is derived from the same field the stage's own kind is, so
     an untagged manifest and the vendored bootstrap set render exactly as
     they always did — one Drawings strip, no dropdown, no new chrome. */
  assert.match(
    galleryCode,
    /return candidate\.set \?\? \(candidate\.video === undefined \? 'Drawings' : 'Videos'\);/,
    'an item without a set no longer falls into the kind-derived default'
  );
  /* First appearance wins, verbatim, and no entry is invented: a set exists
     exactly when something is in it (honest-states floor), and the strip is
     the chosen set's items alone. */
  assert.match(galleryCode, /const sets = \$derived\(\[\.\.\.new Set\(items\.map\(setOf\)\)\]\);/);
  assert.match(
    galleryCode,
    /const visible = \$derived\(items\.filter\(\(candidate\) => setOf\(candidate\) === activeSet\)\);/
  );
  /* A chosen name that no longer names a set resolves to the first set
     rather than to an empty stage. */
  assert.match(
    galleryCode,
    /chosenSet !== undefined && sets\.includes\(chosenSet\) \? chosenSet : sets\[0\]/
  );
  assert.match(
    galleryMarkup,
    /\{#if sets\.length > 1\}\s*<div class="gallery-set"/,
    'a single-set gallery draws set chrome for a choice that does not exist'
  );
  /* The control is the listbox pattern: the button declares the popup and
     its state, each option carries the selection, and the roving stop sits
     on the choice. */
  assert.match(galleryMarkup, /aria-haspopup="listbox"/);
  assert.match(galleryMarkup, /aria-expanded=\{setMenuOpen\}/);
  assert.match(galleryMarkup, /role="listbox"[\s\S]*?aria-label="Choose a media set"/);
  assert.match(galleryMarkup, /role="option"[\s\S]*?aria-selected=\{name === activeSet\}/);
  assert.match(galleryMarkup, /tabindex=\{name === activeSet \? 0 : -1\}/);
  /* Escape and focus leaving the control both close it, and a choice hands
     focus back to the button — the menu can never strand the keyboard. */
  assert.match(galleryCode, /if \(event\.key === 'Escape'\) \{[\s\S]*?setButtonEl\?\.focus\(\);/);
  assert.match(galleryCode, /function onSetFocusout\(event: FocusEvent\): void \{/);
  assert.match(galleryMarkup, /onfocusout=\{onSetFocusout\}/);
  /* And the adapter passes the manifest's word through untouched, the same
     absent-means-absent ride the other optional metadata takes. */
  assert.match(artBinding, /if \(item\.set !== undefined\) \{\s*rendered\.set = item\.set;/);
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
  /* The play control joins the fall-through at issue 243, and it is placed
     BEFORE the player deliberately: while the veil is up the player renders no
     controls, so focusing it would land a keyboard reader on an element they
     cannot operate. The order is the order of what a reader can actually
     press — enlarge button, play control, player. */
  assert.match(
    mediaGallery,
    /async function onDialogClose\(\): Promise<void> \{\s*enlarged = false;\s*await tick\(\);\s*\(frameButtonEl \?\? playButtonEl \?\? playerEl\)\?\.focus\(\);/,
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

test("the caption's BOX is reserved for every item; content absent when the item has none (issue 265)", () => {
  /* RE-AIMED, NOT RELAXED (issue 265). This pin used to enforce the caption's
     CONTAINER being conditional on the current item — issue 202's deliberate
     trade, "reserve space only when the specific item has something to show".
     The owner overruled that from a live review: a captioned item arriving
     pushed the whole document up and down (MEASURED at 50px on 1440 and 69px
     on 390), and the ruling is that the frame must already hold the box.
     Every assertion about CONTENT below is untouched and still exactly as
     strict — nothing is fabricated, nothing is defaulted, an item with no
     title still renders no title. What moved is the one assertion that was
     enforcing the defect.
     The whole contract, pinned where it is decided. Each field is guarded on
     its OWN {#if}: a single combined guard would render an empty <p> for a
     description-less item that happens to carry a title. */
  for (const field of ['shot.title', 'shot.description', 'item.title', 'item.description', 'item.link']) {
    assert.ok(
      mediaGallery.includes(`{#if ${field}}`),
      `${field} is rendered without a guard of its own, so an item lacking it renders an empty row`
    );
  }
  /* THE BOX IS NOT CONDITIONAL, AND THE LANES ARE THE RESERVATION. Every
     item's caption renders into one stacked grid cell — one lane per item,
     all in `grid-area: 1 / 1` — so the row is as tall as the tallest caption
     THIS SET can render and the current item cannot change it. Hiding by
     VISIBILITY rather than by display is the mechanism: a `display: none`
     lane would take no space and the reservation would be nothing at all. */
  assert.doesNotMatch(
    mediaGallery,
    /\{#if hasCaption\}\s*<div class="gallery-caption">/,
    'the caption box is conditional on the current item again, so an item change moves the document'
  );
  assert.match(
    mediaGallery,
    /<div class="gallery-caption">\s*\{#each visible as shot, at \(shot\.key\)\}/,
    'the caption box no longer holds one lane per item, so it is sized by whichever item is showing'
  );
  /* THE ONE QUESTION THE BOX ASKS IS THE VISIBLE SET'S. A set nobody
     captioned has no lane to hold open, and reserving one charged the page a
     constant empty band (+12px on the vendored bootstrap gallery). The guard
     reads `visible`, never `item`, so within a set the answer cannot change
     and an ITEM change still moves nothing — the two moments the box may
     move are a manifest load and the reader's own set choice (issue 275),
     both explicit. A guard on the current item would be the defect itself,
     which is what the assertion above refuses. */
  assert.match(
    mediaGallery,
    /\{#if captionedSet\}\s*<div class="gallery-caption">/,
    'the caption box is reserved for a set with nothing to say, which is an empty band'
  );
  assert.match(
    galleryCode,
    /const captionedSet = \$derived\(visible\.some\(hasCaptionCopy\)\);/,
    'whether a caption box exists is not derived from the visible set'
  );
  /* ONE DEFINITION of what counts as a caption, asked by both questions: two
     copies is how the reserved lane and the rendered content drift apart. */
  assert.match(
    galleryCode,
    /function hasCaptionCopy\(candidate: MediaGalleryItem\): boolean \{\s*return Boolean\(candidate\.title\) \|\| Boolean\(candidate\.description\);/,
    'the caption rule is not stated in one place'
  );
  assert.match(mediaGallery, /data-current=\{at === shown \? 'true' : undefined\}/);
  assert.match(mediaGallery, /aria-hidden=\{at === shown \? undefined : 'true'\}/, 'every item’s caption is announced at once');
  const captionStyle = styleBlock(mediaGallery);
  const lane = /\.gallery-caption-lane\s*\{([^}]*)\}/.exec(captionStyle)?.[1] ?? '';
  assert.match(lane, /grid-area:\s*1 \/ 1/, 'the lanes are not stacked, so the box is the sum of every caption');
  assert.match(lane, /visibility:\s*hidden/, 'a lane that is not current still paints');
  assert.doesNotMatch(lane, /display:\s*none/, 'a display:none lane reserves nothing');
  /* Stretch is the grid default and it would spread ONE item's paragraphs
     down the height of the tallest lane — a one-line caption floating apart
     from its own picture. */
  assert.match(lane, /align-content:\s*start/, 'a short caption is stretched down the reserved lane');
  assert.match(
    captionStyle,
    /\.gallery-caption-lane\[data-current\]\s*\{\s*visibility:\s*visible/,
    'the current item’s caption is never revealed'
  );
  // The lightbox's container stays conditional: it is a modal surface with
  // nothing below it to move, so an item with no metadata renders no band.
  assert.match(mediaGallery, /\{#if hasMeta\}\s*<div class="gallery-lightbox-meta">/);
  assert.match(mediaGallery, /const hasCaption = \$derived\(hasCaptionCopy\(item\)\)/);
  assert.match(mediaGallery, /const hasMeta = \$derived\(hasCaption \|\| item\.link !== undefined\)/);
  /* No default anywhere on the path: a ?? or a literal placeholder is how an
     honest empty state becomes a fabricated one. Both names the component
     reads a row by are swept — `item` for the current one, `shot` for the
     reserved lanes — so the reservation cannot become the place a dash is
     quietly written. */
  for (const field of ['title', 'description', 'link']) {
    assert.doesNotMatch(
      mediaGallery,
      new RegExp(`(item|shot)\\.${field}\\s*(\\?\\?|\\|\\|)\\s*['"\`]`),
      `the component substitutes copy of its own for a missing ${field}`
    );
    assert.doesNotMatch(
      artBinding,
      new RegExp(`${field}:\\s*[^,\\n]*(\\?\\?|\\|\\|)`),
      `the adapter defaults ${field}, so absence never reaches the component`
    );
    assert.match(artBinding, new RegExp(`${field}: photo\\.${field}`), `the adapter drops ${field} on the way through`);
  }
  // The caption is the LAST thing in the block, after the counter, so even
  // the reserved lane sits below everything a reader is looking at.
  assert.ok(
    mediaGallery.indexOf('class="gallery-caption"') > mediaGallery.indexOf('class="gallery-count"'),
    'the caption sits above the counter, so the reserved lane pushes the frame down the page'
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

/* WHERE THE LIGHTBOX IS ANCHORED, which is where the owner's "when I close
 * the media, it returns me to the top of the page" was decided (0.1.52,
 * issue 233). An author `position: relative` beats the UA's `dialog:modal
 * { position: fixed }` on cascade ORIGIN whatever the specificity, so that
 * `position: fixed` never applied. What the engines computed instead was
 * `absolute` (MEASURED, both), which put the box in the document's own
 * coordinate space at the top of the page, and showModal() scrolled the
 * reader there to focus the first control inside it. MEASURED at a 1280x720
 * viewport on the live 0.1.52 origin:
 * scrollY 1943 before the click, 0 while the dialog was open, on Chromium and
 * WebKit alike. The rendered half of this floor is
 * e2e/rendering-lanes.spec.mjs, which measures a real engine's scroll across
 * all three close paths; neither half replaces the other — this one binds
 * every engine, including the ones no runner has. */
test('the enlarged lightbox is anchored to the viewport, never to the document (issue 233)', () => {
  const rule = /\.gallery-lightbox\s*\{([^}]*)\}/.exec(mediaGallery);
  assert.ok(rule, 'the lightbox lost the rule that places it');
  assert.match(
    rule[1],
    /position:\s*fixed;/,
    'a modal dialog is placed against the viewport; anything else scrolls the reader to wherever the box landed in the document'
  );
  assert.doesNotMatch(
    rule[1],
    /position:\s*(?:relative|absolute|static);/,
    'an author position other than fixed overrides the UA modal placement on cascade origin, which is the defect itself'
  );
  // Centred by the same two declarations a UA uses for a modal, stated in the
  // component so the placement is its own claim rather than an inherited one.
  assert.match(rule[1], /inset:\s*0;/, 'the lightbox states no insets, so its centring is whatever the engine defaults to');
  assert.match(rule[1], /margin:\s*auto;/, 'the lightbox states no auto margins, so it cannot centre itself');
});

// ---------------------------------------------------------------------------
// The media binding
// ---------------------------------------------------------------------------

test('the media block introduces itself with its heading, and only its heading', () => {
  assert.match(artBinding, /heading: 'Media'/);
  // The retired intro/note provenance lines do not come back (issue 176):
  // the gallery's whole content is the frame itself now, and the licence
  // lives in gallery.ts's own doc comment and SOURCES.md — a maintainer
  // fact, not something a visitor came here to read (the same ruling issue
  // 167 already made for the Coding Projects capture note).
  assert.doesNotMatch(artBinding, /intro:|note:/);
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
