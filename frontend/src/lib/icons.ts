/* The Hairline icon family (owner design decision, 2026-09-11, issue 313):
 * the site's ONE source of icon drawings, and the only place a glyph exists.
 *
 * A GLYPH IS SHAPES, NOT MARKUP, and that is a security decision rather than
 * a stylistic one. The obvious shape for an icon module is a string of SVG
 * per glyph, rendered with {@html} — but no component in this tree may
 * contain {@html} at all (tests/tooltip.test.mjs sweeps every .svelte file
 * for it, because raw-HTML rendering is the one construct that could turn
 * payload text into markup), and narrowing a tree-wide guard to admit one
 * file is weakening it. Shapes need no such sink: lib/components/Icon.svelte
 * renders each part as a real element with real attributes, so nothing here
 * is ever parsed as HTML and the guard stays exactly as strict as it was.
 *
 * A <use> sprite was the other candidate and was measured on the design
 * canvas: a referenced <symbol> does NOT inherit stroke, stroke-width,
 * stroke-linecap or stroke-linejoin from the <use> instance, so a sprite
 * makes every drawing repeat the family's weight.
 *
 * The family is a 24 grid, 1.25 line weight, round caps and joins, painted
 * in currentColor only — so a mark follows all four reading modes with no
 * theme branch and the family adds no colour token. The shell writes every
 * one of those, which is why no part below states a stroke or a fill: a
 * `solid` part is the same one ink, filled instead of stroked.
 *
 * The source package draws sixty-one glyphs; only the ones a component
 * actually renders are shipped, and tests/icons.test.mjs walks the module
 * against the components in both directions, so neither an unused glyph nor
 * an unknown name can survive a build. Names are the source package's own. */

export type IconName =
  | 'mode-dark'
  | 'close'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-right'
  | 'chevron-left'
  | 'source'
  | 'star'
  | 'issue'
  | 'pull'
  | 'clock'
  | 'commit'
  | 'tag'
  | 'chip'
  | 'photo'
  | 'film'
  | 'play'
  | 'fullscreen'
  | 'exit-fullscreen'
  | 'location'
  | 'work'
  | 'folder'
  | 'license'
  | 'sword';

/* One shape of one glyph. The three elements below are every element the
 * family draws; admitting a fourth takes an edit here AND a branch in
 * Icon.svelte, which is what stops a drawing smuggling in an element that
 * behaves. `attrs` carries GEOMETRY ONLY — the ten coordinate and size
 * attributes an SVG shape takes — and tests/icons.test.mjs walks every part
 * of every glyph against that list, so no drawing can carry an event
 * handler, a style, or a reference to anything outside itself. */
export type IconPart = {
  readonly tag: 'path' | 'circle' | 'rect';
  readonly attrs: Readonly<Record<string, string>>;
  /* Painted rather than stroked: the same currentColor, filled. */
  readonly solid?: true;
};

export const icons: Record<IconName, readonly IconPart[]> = {
  /* chrome */
  'mode-dark': [{ tag: 'path', attrs: { d: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z' } }],
  'close': [{ tag: 'path', attrs: { d: 'M6 6l12 12M18 6L6 18' } }],

  /* rows */
  'chevron-down': [{ tag: 'path', attrs: { d: 'M6 9l6 6 6-6' } }],
  'chevron-up': [{ tag: 'path', attrs: { d: 'M6 15l6-6 6 6' } }],
  'chevron-right': [{ tag: 'path', attrs: { d: 'M9 6l6 6-6 6' } }],
  'chevron-left': [{ tag: 'path', attrs: { d: 'M15 5l-7 7 7 7' } }],

  /* links */
  'source': [{ tag: 'path', attrs: { d: 'M8 7l-5 5 5 5M16 7l5 5-5 5' } }],

  /* projects */
  'star': [
    { tag: 'path', attrs: { d: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 17l-5.3 2.7 1.1-5.9-4.3-4.1 5.9-.8z' } }
  ],
  'issue': [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '8.5' } },
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '2.25' }, solid: true }
  ],
  'pull': [
    { tag: 'circle', attrs: { cx: '6', cy: '5', r: '2' } },
    { tag: 'circle', attrs: { cx: '6', cy: '19', r: '2' } },
    { tag: 'circle', attrs: { cx: '18', cy: '19', r: '2' } },
    { tag: 'path', attrs: { d: 'M6 7v10M18 17v-6a3 3 0 0 0-3-3h-3.5M13.5 5l-3 3 3 3' } }
  ],
  'clock': [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '9' } },
    { tag: 'path', attrs: { d: 'M12 7v5l3 2' } }
  ],
  'commit': [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '3.5' } },
    { tag: 'path', attrs: { d: 'M3 12h5.5M15.5 12H21' } }
  ],
  'tag': [
    { tag: 'path', attrs: { d: 'M3 12V4h8l10 10-8 8z' } },
    { tag: 'circle', attrs: { cx: '7', cy: '8', r: '1.25' }, solid: true }
  ],

  /* trackers */
  'chip': [
    { tag: 'rect', attrs: { x: '7', y: '7', width: '10', height: '10', rx: '1.5' } },
    { tag: 'rect', attrs: { x: '10.5', y: '10.5', width: '3', height: '3' } },
    { tag: 'path', attrs: { d: 'M9.5 3v4M14.5 3v4M9.5 17v4M14.5 17v4M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4' } }
  ],

  /* gallery */
  'photo': [
    { tag: 'rect', attrs: { x: '3', y: '4', width: '18', height: '16' } },
    { tag: 'rect', attrs: { x: '7', y: '8', width: '3', height: '3' }, solid: true },
    { tag: 'path', attrs: { d: 'M21 15l-5-5-8 8' } }
  ],
  'film': [
    { tag: 'rect', attrs: { x: '3', y: '4', width: '18', height: '16', rx: '2' } },
    { tag: 'path', attrs: { d: 'M7.5 4v16M16.5 4v16M3 9h4.5M3 15h4.5M16.5 9H21M16.5 15H21' } }
  ],
  'play': [{ tag: 'path', attrs: { d: 'M7.5 5.5v13l11-6.5z' }, solid: true }],
  'fullscreen': [{ tag: 'path', attrs: { d: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5' } }],
  'exit-fullscreen': [{ tag: 'path', attrs: { d: 'M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5' } }],

  /* sections */
  'location': [
    { tag: 'path', attrs: { d: 'M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z' } },
    { tag: 'rect', attrs: { x: '10', y: '8', width: '4', height: '4' }, solid: true }
  ],
  'work': [
    { tag: 'rect', attrs: { x: '3', y: '7', width: '18', height: '13' } },
    { tag: 'path', attrs: { d: 'M9 7V4h6v3M3 12h18' } }
  ],
  'folder': [{ tag: 'path', attrs: { d: 'M3 5h7l2 2h9v13H3z' } }, { tag: 'path', attrs: { d: 'M3 10h18' } }],
  'license': [
    { tag: 'rect', attrs: { x: '3', y: '4', width: '18', height: '16' } },
    { tag: 'path', attrs: { d: 'M7 9h10M7 12h10M7 15h6' } },
    { tag: 'rect', attrs: { x: '15', y: '14', width: '3', height: '3' }, solid: true }
  ],

  /* feed */
  'sword': [
    { tag: 'path', attrs: { d: 'M18 3l3 3-10.5 10.5-3-3z' } },
    { tag: 'path', attrs: { d: 'M6.5 14.5l3 3M4 20l3.5-3.5' } },
    { tag: 'path', attrs: { d: 'M13.5 13l-3 3' } }
  ]
};

/* The three places a mark appears, each one size token in styles.css: the
 * chrome row, a list or control line, and a table figure. The slot is named
 * rather than measured at the call site so a size change is one token. */
export type IconSlot = 'chrome' | 'row' | 'cell';

/* iconParts is the only way a component reaches a drawing, and it is an
 * own-property lookup on purpose. A plain icons[name] answers
 * Object.prototype for a name like 'constructor' or 'toString', and
 * undefined for a name the module does not hold — the first would hand a
 * function to an {#each}, the second would throw mid-render. Both answer an
 * empty drawing here, so a typo at a call site draws nothing at all and
 * tests/icons.test.mjs fails on the name itself rather than on a blank page.
 * Exported so a node test can execute that refusal; the union type is what
 * stops a typo compiling in the first place, and this is the floor under it. */
export function iconParts(name: IconName): readonly IconPart[] {
  return Object.hasOwn(icons, name) ? icons[name] : [];
}
