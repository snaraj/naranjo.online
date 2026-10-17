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
//   * everything the application renders is rendered after this line, inside
//     the same synchronous task, so the page's first paint of the APPLICATION
//     is already at the chosen width — nothing is painted narrow and then
//     widened;
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

target.replaceChildren();
mount(App, { target });
