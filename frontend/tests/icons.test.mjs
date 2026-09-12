/* The Hairline icon family (owner design decision, 2026-09-11, issue 313).
 *
 * The family is ONE contract in ONE place — lib/icons.ts holds every drawing,
 * lib/components/Icon.svelte is the only file on the site that writes an <svg>
 * for a mark — and this suite is what makes that a property of the tree rather
 * than a convention someone has to remember. It answers four questions:
 *
 *   1. Does the module hold exactly what the page draws? Both directions: an
 *      unknown name is a red build, and so is a glyph nothing renders.
 *   2. Is a glyph incapable of carrying behaviour? Every shape is walked
 *      against a closed list of elements and a closed list of GEOMETRY
 *      attributes, so no drawing can smuggle in a handler, a style or a
 *      reference to anything outside itself.
 *   3. Does the shell state the family once? The viewBox, the four stroke
 *      attributes and the assistive-technology posture are read back out of
 *      the component, because a mark that lost aria-hidden is a mark a screen
 *      reader reads aloud as nothing at all.
 *   4. Does every mark that REPLACED a word still reach an accessible name?
 *      A control whose whole content is marks and carries no aria-label is
 *      the defect this change could most easily have shipped.
 *
 * The lookup's own refusals are EXECUTED rather than pattern-matched: a name
 * outside the union can only arrive at runtime, which is exactly where a
 * pattern match cannot see.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { icons, iconParts } from '../src/lib/icons.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const [iconModule, iconComponent, styles] = await Promise.all([
  read('../src/lib/icons.ts'),
  read('../src/lib/components/Icon.svelte'),
  read('../src/styles.css'),
]);

/* Every .svelte file under src/, walked rather than listed, for the reason
 * tooltip.test.mjs walks the same tree: these are claims about the WHOLE
 * component tree, and a component added tomorrow must be covered without
 * anyone remembering to add it here. */
const componentSources = Object.fromEntries(
  await Promise.all(
    (await readdir(new URL('../src', import.meta.url), { recursive: true }))
      .filter((entry) => entry.endsWith('.svelte'))
      .map(async (entry) => [entry, await read(`../src/${entry}`)])
  )
);

const glyphNames = Object.keys(icons);

/* Markup with its comments removed. Comment-blind is load-bearing rather than
 * tidy, for the reason experience.test.mjs records about its own raw-text
 * pins: an absence pin over raw text matches prose no browser ever reads, so
 * a comment EXPLAINING that a component no longer prints a host satisfied
 * "the host is gone" — and a comment could equally have hidden a real one. */
/* Comments come out to a FIXPOINT, not in one pass: a single replace leaves
   a `<!--` behind when one comment's removal joins two halves of another,
   which is the incompleteness CodeQL's multi-character-sanitization rule
   names; the loop runs until a pass changes nothing. */
const stripComments = (source) => {
  let out = source;
  while (out !== (out = out.replace(/<!--[\s\S]*?-->/g, ''))) {
    /* until a pass removes nothing */
  }
  return out;
};
const markup = (source) => stripComments(source);

/* Every `<Icon .../>` in the tree, with the file it sits in. The component's
 * own file is excluded: it declares the prop, it does not call itself. */
const callSites = Object.entries(componentSources)
  .filter(([name]) => name !== 'lib/components/Icon.svelte')
  .flatMap(([file, source]) =>
    [...source.matchAll(/<Icon\b([^>]*?)\/>/g)].map(([, attributes]) => ({ file, attributes }))
  );

/* A name written as a literal at the call site. Everything else arrives as
 * data and is declared below. */
const literalNames = callSites
  .map(({ attributes }) => /\bname="([a-z-]+)"/.exec(attributes)?.[1])
  .filter((name) => name !== undefined);

/* THE NAMES THAT ARRIVE AS DATA, and the file each one is WRITTEN in. A mark
 * chosen by the page manifest or by a binding layer is not spelled at its call
 * site — `<Icon name={section.mark} />` — so the reverse-coverage walk below
 * would call those glyphs unused and the whole family would have to be
 * inlined to satisfy it. Declaring them here instead keeps the walk honest AND
 * documents every path a name can travel: adding one is a conscious edit, and
 * each entry is verified against the file that actually writes it, so a mark
 * renamed in the manifest and not here is a red build rather than a silent
 * hole. The TypeScript union is what stops any of these compiling wrong; this
 * is the inventory. */
const dataDrivenNames = {
  /* The four section marks, beside the labels they stand for. The `commit`
     mark left this list with the section it named (owner design decision,
     2026-09-11, issue 318) and did not leave the page: the commit column's own
     ruled head draws it, spelled at its call site in LedgerSpread.svelte, so
     it is covered by the literal walk above rather than declared here. */
  '../src/page.ts': ['work', 'folder', 'chip', 'photo'],
  /* The projects table's head marks and its counters' glyphs (issue 317). */
  '../src/lib/components/LedgerSpread.svelte': ['pull', 'tag', 'star', 'clock'],
  '../src/lib/projects.ts': ['star', 'pull', 'tag', 'clock'],
  /* The board's title mark and the Sessions card's, decided by the adapter. */
  '../src/lib/token-usage.ts': ['chip', 'sessions'],
  /* The strip's lead mark, in the binding layer where the domain lives. */
  '../src/lib/blocks/bossTicker.ts': ['sword'],
  /* The gallery segment's mark, derived from what the set holds. */
  '../src/lib/components/MediaGallery.svelte': ['photo', 'film'],
  /* The disclosure chevron, which points at what pressing the row does. */
  '../src/lib/components/LedgerLog.svelte': ['chevron-down', 'chevron-up'],
};

/* GLYPHS THE TRAIN HAS NOT WIRED YET — empty this at compose.
 *
 * `star`, `issue`, `pull`, `clock` and `tag` are the projects table's, rebuilt
 * in the same v0.1.83 train (issue 317) by a parallel lane; they ship in this
 * module so both lanes merge one identical file rather than two versions of
 * one. `fullscreen` and `exit-fullscreen` have no surface at all: the gallery
 * stage has no fullscreen control today, and the design brief made those two
 * conditional on one existing.
 *
 * This list is the ONLY thing standing between an unused glyph and a red
 * build, so it is dated and it is meant to die: when the table lands, delete
 * the five it covers, and either wire a fullscreen control or delete those two
 * glyphs from the module. */
const trainReserved = [];

test('every name a component draws exists, and every glyph shipped is drawn', async () => {
  assert.ok(callSites.length > 0, 'no component draws a mark at all; this suite has lost its subject');

  for (const { file, attributes } of callSites) {
    const literal = /\bname="([a-z-]+)"/.exec(attributes)?.[1];
    const expression = /\bname=\{/.test(attributes);
    assert.ok(
      literal !== undefined || expression,
      `${file} renders an Icon with no name at all: ${attributes.trim()}`
    );
    if (literal !== undefined) {
      assert.ok(
        Object.hasOwn(icons, literal),
        `${file} draws "${literal}", which lib/icons.ts does not hold`
      );
    }
  }

  /* The data paths are real: each declared name is written in the file the
     declaration names, and every one of them is a glyph the module holds. */
  const declared = [];
  for (const [path, names] of Object.entries(dataDrivenNames)) {
    const source = await read(path);
    for (const name of names) {
      assert.ok(
        Object.hasOwn(icons, name),
        `${path} is declared to write "${name}", which lib/icons.ts does not hold`
      );
      assert.ok(
        source.includes(`'${name}'`),
        `${path} no longer writes the mark "${name}"; the inventory in this test is stale`
      );
      declared.push(name);
    }
  }

  /* ...and the other direction, which is the one low code volume cares about:
     a glyph nothing draws is dead data, and sixty-one of them were available
     to copy. */
  const drawn = new Set([...literalNames, ...declared, ...trainReserved]);
  const unused = glyphNames.filter((name) => !drawn.has(name));
  assert.deepEqual(unused, [], `lib/icons.ts ships ${unused.join(', ')}, which nothing draws`);

  /* The reserve is a train artifact, not a permanent escape hatch: every name
     in it must still be a real glyph, and none of it may cover a glyph a
     component already draws — otherwise it would start hiding real unused
     ones. */
  for (const name of trainReserved) {
    assert.ok(Object.hasOwn(icons, name), `trainReserved names "${name}", which is not a glyph`);
    assert.ok(
      !literalNames.includes(name) && !declared.includes(name),
      `trainReserved still covers "${name}", which a component now draws; take it out`
    );
  }
});

test('a glyph is geometry and nothing else', () => {
  /* The closed lists. A fourth element or an eleventh attribute is a
     deliberate edit here AND in the component, which is the point: a drawing
     that could carry an event handler, a style, or a URL is a drawing that
     could carry behaviour, and these are copied from a package this
     repository did not write. */
  const elements = ['path', 'circle', 'rect'];
  const geometry = ['d', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'rx', 'ry'];

  for (const [name, parts] of Object.entries(icons)) {
    assert.ok(Array.isArray(parts) && parts.length > 0, `"${name}" draws nothing`);
    for (const part of parts) {
      assert.ok(elements.includes(part.tag), `"${name}" draws a <${part.tag}>`);
      for (const [key, value] of Object.entries(part.attrs)) {
        assert.ok(geometry.includes(key), `"${name}" carries a non-geometry attribute: ${key}`);
        assert.equal(typeof value, 'string', `"${name}" gives ${key} a non-string value`);
        /* A coordinate list is digits, spaces, signs, dots and the path
           command letters. Anything else — a parenthesis, a colon, a quote —
           is not a coordinate, and url(), javascript: and a broken-out
           attribute all need one of them. */
        assert.match(
          value,
          /^[A-Za-z0-9 .,-]+$/,
          `"${name}" gives ${key} the value "${value}", which is not a coordinate list`
        );
      }
      /* Paint is the shell's, always. A part says only WHETHER it is filled;
         it never names an ink, so no glyph can escape currentColor and the
         family stays theme-branch-free in all four reading modes. */
      assert.ok(
        part.solid === undefined || part.solid === true,
        `"${name}" has a solid flag that is neither absent nor true`
      );
      assert.deepEqual(
        Object.keys(part).filter((key) => !['tag', 'attrs', 'solid'].includes(key)),
        [],
        `"${name}" carries a field beyond tag, attrs and solid`
      );
    }
  }

  /* And the module states no paint of its own anywhere — not in a part, not
     in a comment's worth of copied markup. `currentColor` and `none` belong
     to the shell; the data layer names neither. */
  const declarations = iconModule.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(declarations, /currentColor|stroke:|fill:/, 'a glyph names its own paint');
  assert.doesNotMatch(declarations, /<svg/, 'a glyph carries an <svg> of its own');
});

test('the shell states the family exactly once, and hides it from assistive technology', () => {
  const shell = /<svg\b([\s\S]*?)>/.exec(markup(iconComponent))?.[1];
  assert.ok(shell, 'Icon.svelte renders no <svg> at all');
  /* The 24 grid and the four stroke attributes, which is the whole of the
     family's weight. A sprite could not have inherited these from the
     instance — measured on the design canvas — which is why they are written
     here, on the one element every mark on the site is drawn inside. */
  for (const attribute of [
    'viewBox="0 0 24 24"',
    'fill="none"',
    'stroke="currentColor"',
    'stroke-width="1.25"',
    'stroke-linecap="round"',
    'stroke-linejoin="round"',
    'aria-hidden="true"',
    'focusable="false"',
  ]) {
    assert.ok(shell.includes(attribute), `the icon shell no longer carries ${attribute}`);
  }
  /* Size is the slot's token, never a number: the three declared sizes are
     the only ones, and the component names no length of its own. */
  assert.match(iconComponent, /class="icon icon-\{slot\}"/);
  for (const token of ['--icon-chrome', '--icon-row', '--icon-cell']) {
    assert.match(iconComponent, new RegExp(`var\\(${token}\\)`), `the shell no longer reads ${token}`);
    assert.match(styles, new RegExp(`\\s${token}:\\s*[\\d.]+rem;`), `${token} is not declared in styles.css`);
  }
  assert.match(styles, /\s--icon-gap:\s*[\d.]+rem;/, 'the mark-to-word distance is not a token');
  const style = /<style>([\s\S]*)<\/style>/.exec(iconComponent)?.[1].replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(style, /color|background|fill|stroke/, 'the shell paints; its ink is inherited');
  /* Read as declarations rather than as a negative match: a lookahead after
     `\s*` is satisfied by matching zero spaces and looking at the space, so
     the obvious absence pin here passes on every input. Every size the shell
     states must BE a token. */
  const sizes = [...style.matchAll(/(?:inline|block)-size:\s*([^;]+);/g)].map(([, value]) => value);
  assert.ok(sizes.length > 0, 'the shell states no size at all; the marks would render at the default 300x150');
  for (const value of sizes) {
    assert.match(value, /^var\(--icon-[a-z]+\)$/, `the shell sizes a mark with "${value}" rather than a token`);
  }

  /* Every slot named at a call site is one the stylesheet sizes. A fourth
     spelling would render at no size at all — an invisible mark, which is the
     worst failure mode this component has, because nothing goes red. */
  for (const { file, attributes } of callSites) {
    const slot = /\bslot="([a-z]+)"/.exec(attributes)?.[1];
    if (slot === undefined) continue;
    assert.ok(
      ['chrome', 'row', 'cell'].includes(slot),
      `${file} draws a mark in the "${slot}" slot, which styles.css gives no size`
    );
  }
});

test('an unknown name draws nothing rather than something', () => {
  /* The union type stops a typo compiling. This is the floor UNDER that, and
     it is executed because the failure it covers can only happen at runtime:
     a name reaching the component from anywhere the compiler did not check. */
  assert.deepEqual(iconParts('chevron-down'), icons['chevron-down']);
  assert.deepEqual(iconParts('not-a-glyph'), [], 'an unknown name must draw nothing');
  /* The prototype is the hostile case, not a hypothetical one: a plain
     icons[name] answers Object.prototype for every one of these, and the
     component would then iterate a FUNCTION as if it were a list of shapes. */
  for (const inherited of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
    assert.deepEqual(iconParts(inherited), [], `"${inherited}" reaches through to the prototype`);
  }
});

/* ===========================================================================
 * The text-to-marks map: every word a mark replaced still reaches a reader
 * who cannot see the mark (owner ruling, issue 313).
 * ======================================================================== */

/* The inner content of every <button> and <a> in one component, by scanning
 * for the opening tag and its matching close. Neither element may legally
 * nest inside itself, so a depth counter is not needed — and a stray unclosed
 * tag yields nothing rather than a wrong answer, which is why the close is
 * required rather than assumed. */
function controls(source) {
  const found = [];
  for (const opening of source.matchAll(/<(button|a)\b([^>]*)>/g)) {
    const tag = opening[1];
    const close = source.indexOf(`</${tag}>`, opening.index + opening[0].length);
    if (close === -1) continue;
    found.push({
      tag,
      attributes: opening[2],
      inner: source.slice(opening.index + opening[0].length, close),
    });
  }
  return found;
}

/* What a control says to someone who cannot see it: its markup with every
 * comment, every mark, and every wrapper element removed. Whatever is left is
 * text or an interpolation — the thing a screen reader would actually read. */
const speech = (inner) => {
  let out = stripComments(inner).replace(/<Icon\b[^>]*?\/>/g, '');
  /* Tags come out to a fixpoint as well, in their own loop, so the pass that
     removes them is the one the sanitization rule can see repeating. */
  while (out !== (out = out.replace(/<[^>]*>/g, ''))) {
    /* until a pass removes nothing */
  }
  return out.trim();
};

test('no control is a mark with nothing to say', () => {
  for (const [file, source] of Object.entries(componentSources)) {
    for (const control of controls(source)) {
      if (!control.inner.includes('<Icon')) continue;
      if (speech(control.inner).length > 0) continue;
      assert.match(
        control.attributes,
        /aria-label=/,
        `${file} draws a <${control.tag}> whose whole content is marks and which carries no accessible name`
      );
    }
  }
});

test('a link that is already words grows no trailing mark', () => {
  /* The owner's round-6 ruling: no trailing "open/external" glyph where the
     text is already a link. It is pinned two ways, because one of them alone
     would be satisfiable by accident.

     First, the family does not SHIP the glyph. The source package draws
     `external` and `link`; neither is here, so the rule cannot be broken by
     reaching for the obvious name. */
  for (const forbidden of ['external', 'link']) {
    assert.ok(
      !Object.hasOwn(icons, forbidden),
      `lib/icons.ts ships "${forbidden}"; no linked row on this page wears one`
    );
  }

  /* Second — and this is the half that survives someone adding the glyph back
     for a legitimate surface — no anchor anywhere puts a mark AFTER its words.
     A mark that LEADS a link is the nav's arrangement and is fine: it replaces
     the words rather than decorating them. A mark that trails them is the
     ornament the owner cut. */
  for (const [file, source] of Object.entries(componentSources)) {
    for (const control of controls(source)) {
      if (control.tag !== 'a' || !control.inner.includes('<Icon')) continue;
      const before = control.inner.slice(0, control.inner.indexOf('<Icon'));
      assert.equal(
        speech(before),
        '',
        `${file} draws a mark after a link's own words; a linked row wears no trailing glyph`
      );
    }
  }

  /* And the three row kinds the ruling names, by name, so the rule is legible
     where a reader would look for it. None of them draws a mark at all. */
  for (const file of [
    'lib/components/LedgerSpread.svelte',
    'lib/components/ContributionCalendar.svelte',
  ]) {
    for (const control of controls(componentSources[file])) {
      if (control.tag !== 'a') continue;
      assert.ok(
        !control.inner.includes('<Icon'),
        `${file} draws a mark inside a row link; the text is already the link`
      );
    }
  }
  const drawer = controls(componentSources['lib/components/LedgerLog.svelte']).find(
    (control) => control.attributes.includes('ledger-link')
  );
  assert.ok(drawer, 'the employer link is gone from the drawer; this pin has lost its subject');
  assert.ok(!drawer.inner.includes('<Icon'), 'the employer link wears a trailing mark');
});

test('the words the marks replaced are still on the page or in its accessibility tree', () => {
  /* Each row is one line of the canvas board "Text to marks": the surface, the
     word that stopped being printed, and where that word went. A mark is only
     allowed to replace a word when the word survives somewhere a reader can
     still reach it, and this is the walk that proves it for every surface the
     map names. */
  const header = componentSources['lib/components/PageHeader.svelte'];
  assert.match(header, /<Icon name="location" slot="chrome" \/>Irvine</, 'the place lost its city');
  assert.doesNotMatch(markup(header), /Irvine, CA/, 'the state abbreviation is back');

  const footer = componentSources['App.svelte'];
  assert.match(footer, /<Icon name="license" slot="row" \/>MIT ·/, 'the licence lost its word');
  assert.match(footer, /<Icon name="source" slot="row" \/>snaraj/, 'the author lost their name');
  assert.doesNotMatch(markup(footer), /github\.com\/snaraj/, 'the footer prints the host again');

  /* The nav link's word became its accessible name — which is the SAME word
     the heading it points at is called, so the two channels agree. */
  const nav = componentSources['lib/components/SectionNav.svelte'];
  assert.match(nav, /aria-label=\{section\.label\}/);
  const head = componentSources['lib/components/PageSection.svelte'];
  assert.match(head, /<h2 class="section-title" id=\{`\$\{section\.id\}-title`\}>\{section\.label\}<\/h2>/);
  /* The mark on the head is decoration, exactly as the number beside it
     already was: the heading's own accessible name is what a screen-reader
     user navigates a page by. */
  assert.match(head, /<span class="section-number" aria-hidden="true"\s*><Icon name=\{section\.mark\}/);

  /* The gallery segment: the mark and the figure are what the eye gets, the
     set's word and the same figure are what the ear gets. */
  const gallery = componentSources['lib/components/MediaGallery.svelte'];
  assert.match(gallery, /aria-label=\{`\$\{name\} · \$\{countOf\(name\)\}`\}/);

  /* The employer monogram is a mark for the eye only: the row's own accessible
     name already carries the employer in full, so a tile that also announced
     "PA" would say the name twice. */
  const log = componentSources['lib/components/LedgerLog.svelte'];
  assert.match(log, /<span class="ledger-monogram" aria-hidden="true">\{row\.mark\}<\/span>/);
  assert.match(log, /aria-label=\{`\$\{open \? collapseLabel : expandLabel\} \$\{row\.name\}`\}/);

  /* The strip's lead: a second decorative mark beside the picture, with the
     collection's name still on the panel head above it and in the strip's own
     label. The component names neither — the binding layer hands both over. */
  const ticker = componentSources['lib/components/Ticker.svelte'];
  assert.match(ticker, /\{#if mark\.glyph\}\s*<Icon name=\{mark\.glyph\} slot="row" \/>/);
  assert.doesNotMatch(markup(ticker), /<Icon name="/, 'the strip names a glyph of its own');
});
