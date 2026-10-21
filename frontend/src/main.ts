import { mount } from 'svelte';
import App from './App.svelte';
import './styles.css';
import { applyStoredColumnWidth, browserStore, documentHost } from './lib/columnWidth';

const target = document.getElementById('app');

if (!target) {
  throw new Error('application mount point is missing');
}

// The reader's chosen column width goes on before a single node of the
// application exists. Two things together are why that costs no layout shift,
// and the ORDER of these statements is the load-bearing one:
//
//   * everything the application renders is rendered after this line, so the
//     page's first paint of the APPLICATION is already at the chosen width —
//     nothing is painted narrow and then widened;
//   * the static shell the document ships with paints one centred heading in
//     a centred column, whose position does not depend on the column's width
//     at all, so the earlier paint the browser genuinely does make (measured
//     in Chromium: first paint at 28ms, this line at 44ms) moves nothing when
//     this line lands.
//
// Nothing earlier can do it. A width the reader drags is continuous, so the
// origin cannot prepare a document per width the way it once prepared one per
// reading mode (that stamp went with the control, owner 2026-10-19), and the
// site's Content-Security-Policy (default-src 'self') forbids the inline
// script the usual pre-paint trick would need. So the width is applied here,
// and the browser lanes MEASURE the resulting layout shift rather than
// asserting it.
applyStoredColumnWidth(documentHost(), browserStore());

// The application paints in its own faces rather than swapping to them. Their
// bytes come with the page (the preloads in index.html), but a face is only
// applied once the main thread is free to take it up, and that was after the
// application's first paint. So each swap moved whatever wraps differently in
// the face than in its fallback: the name, the plaques and a ledger role in
// Archivo (measured on Linux Chromium: layout shifts of 0.03 at 1440px
// and 0.06 at 390px). So the mount waits for the faces, never longer than
// faceWait, and the static shell stays painted meanwhile.
//
// A face that has not loaded by then is not used on this visit: its stack is
// marked, and styles.css sets a marked stack in its fallbacks alone, so the
// face has no text to swap into when it lands. Swapping it in late moved the
// painted page (the review of eaa62d1, bytes held 1.8s: 0.013 at 1440px).
const faceWait = 1000;
const faces = {
  sans: "1em 'Archivo'",
  mono: "1em 'JetBrains Mono'",
  display: "1em 'Instrument Serif'",
  tome: "1em 'Cormorant Garamond'",
  initial: "1em 'UnifrakturMaguntia'",
};
// What a stack must be able to draw before it counts as loaded. A face is split
// into files by unicode-range, and fonts.load() with no text loads only the
// file a space falls in, the latin one. The name's dotless j (U+0237, drawn by
// .page-name-j in styles.css) is in Instrument Serif's latin-ext file, so the
// display stack asks for a latin letter and that j together, and loads only
// once both files are in. Waited for with no text, the latin-ext file could
// miss the bound unmarked and swap its j into the painted name: the review of
// fc87a89 held that one file and the heading narrowed from 288.9px to 273.1px
// at 1440px when it landed.
const drawn: Record<string, string> = { display: `A${String.fromCodePoint(0x237)}` };
const loaded = new Set<string>();
const start = () => {
  for (const stack of Object.keys(faces)) {
    if (!loaded.has(stack)) document.documentElement.setAttribute(`data-face-${stack}`, 'fallback');
  }
  target.replaceChildren();
  mount(App, { target });
};
Promise.race([
  Promise.all(
    Object.entries(faces).map(([stack, face]) =>
      document.fonts.load(face, drawn[stack]).then((found) => {
        if (found.length > 0) loaded.add(stack);
      })
    )
  ),
  new Promise((resolve) => setTimeout(resolve, faceWait)),
]).then(start, start);
