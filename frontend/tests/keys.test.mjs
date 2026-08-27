/* The shared keyboard grammar (lib/keys.ts), EXECUTED rather than read, plus
 * the structural pin that stops a fourth composite widget shipping without
 * one.
 *
 * The pin exists because the defect it catches has now happened twice on this
 * page in the same change: the token panel's segmented pills declared
 * `role="radio"` and handled no keys, and the fix for that shipped alongside a
 * new row of gallery position dots declaring `role="tab"` and handling no
 * keys. A role is a promise about interaction; a widget that makes it and
 * implements none of it has removed tab stops in exchange for nothing.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { isChord, ringTarget } from '../src/lib/keys.ts';
import { swatchKeyTarget } from '../src/lib/disclosure.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const plain = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

test('a chord belongs to the browser, and a bare key does not', () => {
  // The three that are addressed elsewhere. Cmd/Alt+Arrow is Back; Ctrl+Home
  // is top-of-document; every platform binds further ones.
  assert.equal(isChord({ ...plain, metaKey: true }), true);
  assert.equal(isChord({ ...plain, altKey: true }), true);
  assert.equal(isChord({ ...plain, ctrlKey: true }), true);
  assert.equal(isChord({ ...plain, ctrlKey: true, shiftKey: true }), true);
  // And the ones that are the widget's own.
  assert.equal(isChord(plain), false, 'a bare key was refused as a chord');
  // Shift is deliberately NOT a chord: it modifies the widget's own key
  // (range extension, reverse traversal) rather than addressing the browser.
  assert.equal(
    isChord({ ...plain, shiftKey: true }),
    false,
    'Shift was treated as a chord; it is a modifier OF this widget’s key'
  );
});

test('the ring wraps both ways, ends at its ends, and leaves every other key alone', () => {
  const count = 4;
  assert.equal(ringTarget('ArrowRight', 0, count), 1);
  assert.equal(ringTarget('ArrowDown', 1, count), 2);
  assert.equal(ringTarget('ArrowRight', 3, count), 0, 'forward did not wrap');
  assert.equal(ringTarget('ArrowLeft', 0, count), 3, 'backward did not wrap');
  assert.equal(ringTarget('ArrowUp', 2, count), 1);
  assert.equal(ringTarget('Home', 2, count), 0);
  assert.equal(ringTarget('End', 0, count), count - 1);

  // Not this widget's keys. Answering null rather than an index is what lets
  // the caller return WITHOUT preventing the default, so Tab still leaves and
  // PageDown still scrolls.
  for (const key of ['Tab', 'Enter', ' ', 'Escape', 'PageDown', 'a']) {
    assert.equal(ringTarget(key, 1, count), null, `${key} was claimed by the ring`);
  }

  // A cursor not on the ring yet — which is what indexOf answers for an
  // unknown current value — steps to the first going forward and the last
  // going back, rather than to the negative index plain arithmetic produces.
  assert.equal(ringTarget('ArrowRight', -1, count), 0);
  assert.equal(ringTarget('ArrowLeft', -1, count), count - 1);

  // A ring with nothing on it has no index to answer with.
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
    assert.equal(ringTarget(key, 0, 0), null, `${key} named an index on an empty ring`);
  }
});

test('the theme swatches move on the SAME ring, differing only by Escape', () => {
  /* Executed rather than pinned in source: the popover's own key map used to
     be a second copy of this arithmetic, and two copies of one decision are
     free to disagree the day either moves. Escape is the one genuine
     difference — a popover can be dismissed and an always-visible control
     cannot — so it is asserted as the difference rather than assumed. */
  const count = 5;
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Tab']) {
    for (let index = 0; index < count; index += 1) {
      assert.equal(
        swatchKeyTarget(key, index, count),
        ringTarget(key, index, count),
        `the swatches and the shared ring disagree about ${key} at ${index}`
      );
    }
  }
  assert.equal(swatchKeyTarget('Escape', 1, count), 'dismiss');
  assert.equal(ringTarget('Escape', 1, count), null, 'the shared ring claimed Escape');
});

/* ===========================================================================
 * A DECLARED COMPOSITE ROLE IS A PROMISE ABOUT KEYS.
 * ======================================================================== */

const componentSources = Object.fromEntries(
  await Promise.all(
    (await readdir(new URL('../src', import.meta.url), { recursive: true }))
      .filter((entry) => entry.endsWith('.svelte'))
      .map(async (entry) => [entry, await read(`../src/${entry}`)])
  )
);

/* The opening tag an attribute belongs to: back to its `<`, then forward to
 * the `>` that closes it, stepping over the braces and quotes a Svelte
 * attribute value can contain. Written by hand because the question is about
 * ONE element rather than about the file — a file-level sweep passes the
 * moment any other element in it happens to handle a key, which is exactly
 * how the gallery's dots slipped through beside two handlers that were not
 * theirs. */
function openingTag(source, at) {
  const start = source.lastIndexOf('<', at);
  let depth = 0;
  let quote = '';
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== '') {
      if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
    } else if (character === '>' && depth === 0) {
      return source.slice(start, index + 1);
    }
  }
  return source.slice(start);
}

test('every composite widget on this page handles its own keys', () => {
  /* WAI-ARIA gives a composite ONE tab stop with the arrows moving inside it.
     Both halves or neither: a roving tabindex without a key handler takes
     every option but one out of the tab order and offers nothing in return,
     which is strictly worse than the plain list of buttons it replaced. */
  const composite = /role=(?:"(listbox|radiogroup|tablist|menu|tree)"|\{[^}]*'(listbox|radiogroup|tablist|menu|tree)'[^}]*\})/g;
  let found = 0;
  for (const [name, source] of Object.entries(componentSources)) {
    for (const match of source.matchAll(composite)) {
      found += 1;
      const tag = openingTag(source, match.index);
      const role = match[1] ?? match[2];
      assert.match(
        tag,
        /onkeydown=/,
        `${name} declares role ${role} and handles no keys on that element`
      );
    }
  }
  assert.ok(found > 0, 'the composite-role sweep found nothing to check; it is broken');
});

test('a composite option is never a tab stop of its own unless it is the current one', () => {
  /* The other half, stated as the shape rather than as a file: every option
     inside a composite carries a CONDITIONAL tabindex — the roving one — so
     the group is one stop rather than sixteen. Measured against the option
     roles that actually appear here. */
  const options = /role="(radio|option|tab)"/g;
  let swept = 0;
  for (const [name, source] of Object.entries(componentSources)) {
    for (const match of source.matchAll(options)) {
      const tag = openingTag(source, match.index);
      /* A grid cell is an option inside a listbox whose single tab stop is
         the STRIP itself, so its cells carry no tabindex at all — which is
         the same guarantee reached the other way and is why this asks for
         "not a fixed tab stop" rather than for a roving attribute. */
      assert.doesNotMatch(
        tag,
        /tabindex="0"/,
        `${name}: a ${match[1]} is a permanent tab stop; a composite has exactly one`
      );
      swept += 1;
    }
  }
  assert.ok(swept > 0, 'the composite-option sweep found nothing to check; it is broken');
});
