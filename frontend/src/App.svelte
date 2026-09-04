<script lang="ts">
  import ColumnHandles from './lib/components/ColumnHandles.svelte';
  import PageHeader from './lib/components/PageHeader.svelte';
  import PageSection from './lib/components/PageSection.svelte';
  import PullToRefresh from './lib/components/PullToRefresh.svelte';
  import TextureBand from './lib/components/TextureBand.svelte';
  import { bandTextures } from './lib/textureAssets.ts';
  import { bandMode, documentPrefersDark, prefersDarkQuery, textureFor } from './lib/textures.ts';
  import { page } from './page.ts';

  /* THE BAND'S STATE LIVES HERE, and that is deliberate: the page opens and
     closes on the SAME picture, so the two bands are two views of one value.
     Held by the page's own chrome rather than in a module store, because it is
     chrome — the reading mode's own picture, persisted nowhere, which is why
     it needs no cookie, no storage and no consent question. The cycle box is
     gone (owner directive, 2026-09-04, issue 292): a mode has one picture, and
     the only thing that changes it is the mode. */
  let mode = $state(bandMode());
  let prefersDark = $state(documentPrefersDark());

  const texture = $derived(textureFor(mode, prefersDark));

  /* The reading mode is an ATTRIBUTE on the document, written by the toggle
     (lib/themes.ts) and by the origin's own stamp — never by this component —
     so the band watches the attribute rather than being told. That keeps the
     one mechanism the whole page already agrees on: the mode is what the
     document says it is. */
  $effect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      mode = bandMode();
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  });

  /* And the other half of `auto`: an unstamped document follows the device, so
     a device that changes its mind mid-visit changes the band with it. */
  $effect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia(prefersDarkQuery);
    const onChange = (): void => {
      prefersDark = query.matches;
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  });
</script>

<!-- The description meta moved to index.html's static head with the
  link-preview tags (0.1.52): a scraper reads the document as served, so a
  head contribution made at hydration was invisible to exactly the readers a
  description exists for — and two copies, one static and one hydrated,
  would be the same fact written twice. -->

<!-- First in the document on purpose (issue 219): the refresh control inside
  it is invisible until focused, and being the first focusable thing is what
  makes one Tab reach it — the skip-link arrangement. -->
<PullToRefresh />

<PageHeader />

<!-- THE LEDGER (owner directive, 2026-09-03, issue 287). The page is one
  ruled sheet: a picture band under the chrome row, the name set large across
  the column with a rule drawn under it, five numbered sections, a second band
  closing the sheet, and a footer.

  What the sections ARE lives in src/page.ts, the manifest (owner directive,
  issue 165): this file renders that array and is otherwise inert. Adding a
  block or reordering the page happens there; this file changes when the page's
  CHROME changes, nothing else — and the two bands, the masthead and the footer
  are exactly that. -->
<main aria-labelledby="page-title">
  <TextureBand layers={bandTextures} active={texture.file} />

  <div class="page-intro">
    <h1 id="page-title">Samuel Naranjo</h1>
    <!-- The rule under the name is drawn rather than declared: a border would
      simply be there, and the owner asked for it to arrive. Under reduced
      motion it is already drawn on the first frame — the same rule, without
      the arrival — which is why the dash offset is animated by a class the
      motion query owns rather than by an attribute this file sets. -->
    <svg class="masthead-rule" width="100%" height="3" viewBox="0 0 1440 3" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="1.5" x2="1440" y2="1.5" stroke="currentColor" stroke-width="3" />
    </svg>
  </div>

  {#each page as section, position (section.id)}
    <PageSection {section} ordinal={String(position + 1).padStart(2, '0')} />
  {/each}

  <TextureBand layers={bandTextures} active={texture.file} />

  <footer class="page-footer">
    <span class="footer-mark">naranjo.online v{__SITE_VERSION__}</span>
    <span class="footer-meta">MIT · github.com/snaraj</span>
  </footer>

  <!-- The reader's grip on the column (owner directive, 2026-08-24). It sits
    INSIDE main because main is the column: the two handles are drawn against
    its edges, so the element that resizes is also the box they measure
    themselves against and no width arithmetic is copied anywhere. They are
    out of flow, so nothing above them moves when they arrive, and they are
    rendered only where there is room for them — which is why a phone never
    receives them at all. -->
  <ColumnHandles />
</main>
