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
// It is deliberately NOT the mechanism the reading mode uses. That one is a
// server-side stamp: the origin precomputes one index.html per registered
// theme and picks between them on a cookie (internal/server/server.go,
// stampReadingTheme), which works precisely because there are four themes and
// a document can be prepared for each. A width the reader drags is continuous
// — there is no finite set of documents to precompute — and the site's
// Content-Security-Policy (default-src 'self') forbids the inline script the
// usual pre-paint trick would need. So the width is applied here, and the
// browser lanes MEASURE the resulting layout shift rather than asserting it.
applyStoredColumnWidth(documentHost(), browserStore());

// The application paints in its own faces rather than swapping to them. Their
// bytes come with the page (the preloads in index.html), but a face is only
// applied once the main thread is free to take it up, and that was after the
// application's first paint. So each swap moved whatever wraps differently in
// the face than in its fallback: the name, the plaques and a ledger role in
// Archivo (measured on Linux Chromium: layout shifts of 0.03 at 1440px
// and 0.06 at 390px). So the mount waits for the faces, never longer than
// faceWait: the static shell stays painted meanwhile, and a face that has not
// come by then swaps in later, as it always did.
const faceWait = 1000;
const faces = ["1em 'Archivo'", "1em 'JetBrains Mono'"];
const start = () => {
  target.replaceChildren();
  mount(App, { target });
};
Promise.race([
  Promise.all(faces.map((face) => document.fonts.load(face))),
  new Promise((resolve) => setTimeout(resolve, faceWait)),
]).then(start, start);
