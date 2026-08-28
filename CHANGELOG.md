# Changelog

All notable changes to naranjo.online. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `VERSION`, chart
metadata, these headings, and Helm's strict OCI chart tag use numeric SemVer.
Git, image, and GitHub Release tags use the exact plain `vX.Y.Z` form.

## [Unreleased]

## [0.1.55] - 2026-08-28

Three defects with one shape: in each of them the page showed a visitor
something that was not true about its own state. A film whose poster had not
arrived painted a blank white rectangle, a boot that never completed rendered
a bare heading with no explanation and no way out, and the site declared no
icon at all.

### Added

- `frontend/public/favicon.svg`: the site's own "SN." mark, the one `og.png`
  carries, inverted to white-on-black so it brings its own field at 16 CSS
  pixels. `index.html` declares it, which is what stops the WARN-level
  `/favicon.ico` 404 a browser probes for when a document names no icon. SVG
  rather than ICO is a serving fact: the embedded bundle is typed by Go's
  `mime.TypeByExtension`, whose built-in table has `.svg` and does not have
  `.ico`, and the distroless image carries no `/etc/mime.types` to supply one.
- The honest boot state in `frontend/index.html`: a `data-boot-status` line
  that says the page is loading and carries a plain same-origin retry link,
  plus a `data-boot-noscript` element for the genuinely different
  scripting-off truth. No script and no CSP change — the failure it is for is
  the one where script did not arrive.
- `galleryPosterAsset` in `frontend/src/lib/galleryManifest.ts`: the
  poster-stand-in rule, stated beside the optional `poster` field it reads and
  executed by `tests/gallery-manifest.test.mjs` rather than described by a
  regex.
- `--gallery-stage-ground` in `frontend/src/styles.css`: the letterbox a film
  is projected onto, mode-independent for the same reason `--gallery-scrim`
  is.

### Changed

- A film's default poster is the 1280x720 preview derivative, not the 4K
  full-size still — roughly 86-91 KB against roughly 315 KB for the same
  visible frame in a 768x432 stage. The comment defending the old default
  ("the same picture the lightbox would have shown anyway") expired when
  enlarging became stills-only in 0.1.54.
- `.gallery-stage[data-gallery-kind='video']` paints
  `var(--gallery-stage-ground)`. The stage declared no background at all, so
  a poster still in flight showed the page's near-white surface through the
  reservation. The reservation itself is untouched: CLS stays zero.

### Tests

- `gallery-manifest.test.mjs` executes the poster choice against real admitted
  items, including that the stand-in is measurably the smaller rendition.
- `sections.test.mjs` pins the adapter's delegation inside its film branch
  only (the still's `item.full` read two lines up stays legal) and MEASURES
  the stage ground's channels, so declaring the token and setting it light
  fails.
- `experience.test.mjs` pins the icon declaration and the boot-state
  structure, and refuses an inline script, handler, or style attribute in the
  shell — all three are dead under `default-src 'self'`.
- `internal/web/assets_test.go` follows the document's OWN icon declaration to
  the wire and requires a media type Go's built-in table supplies, so a
  development machine's richer MIME registry cannot vouch for an extension
  production would fail on.

## [0.1.54] - 2026-08-28

Four owner UX dispatches, all of them reversing or repairing decisions 0.1.52
shipped the day before: a gallery film now plays where it sits instead of
wearing a decorative play mark, the token panel's display menu is gone
entirely, the empty "About Me" section is gone with the two files it existed
for, and the enlarged lightbox no longer throws the reader to the top of the
page.

### Added

- **Gallery films play inline, on their own enlarged widescreen stage.** The
  current item's stage mounts a real `<video controls playsinline
  preload="metadata">` carrying the manifest's source ladder in the manifest's
  own order, so a film is playable in place the way an embedded player is
  (owner: "develop the ability to treat them like youtube videos where I can
  just play it in this small minimal version"). Only the CURRENT item ever
  mounts a player and the element is keyed on the item, so navigating away
  unmounts it and the strip still never carries more than one — the weight
  rule the previous design protected, kept exactly. Nothing autoplays: no
  `autoplay` attribute exists anywhere in the component, playback starts only
  from the reader's press on the native controls, and that is how reduced
  motion is honoured structurally rather than by a media query.
- **A second stage shape, chosen by the item's kind.** `--gallery-stage-size-video`
  (27rem) and `--gallery-stage-aspect-video` (1.7778) join the square's pair in
  `styles.css`; a film's stage redeclares the same two custom properties the
  stage arithmetic already reads, so there is one piece of sizing code and the
  reservation stays byte-independent. A film renders 768x432 against a still's
  448x448 — 71% wider, 65% more area — because a 16:9 film inside a square is a
  small picture between two bands of dead ground.
- `fullDepthColumns` in `src/lib/periods.ts`: the one window the token panel
  draws now that its range control is gone — every captured day, floored at the
  grid's 53-column reserve. It is the wider of the two on purpose, because
  either alone is a defect this repository has already measured (the reserve
  alone is issue 158's year-long ceiling; the bare capture alone draws a
  two-month history as a tenth of a full-width card).

### Changed

- **The token panel's display menu is deleted, and with it every display
  choice** (owner: "remove this entire menu. it doesnt look good and it doesn't
  provide any value"). `UsageFilterMenu.svelte` is gone, along with
  `UsageTracker`'s per-source view, range and category state, the lens
  resolver, the `total` sentinel and the controls row that held them. Each
  source renders ONE graph: daily, the full captured depth, the source's own
  totals. The lens arithmetic itself is untouched and still executed by
  `tests/grid.test.mjs` and `tests/periods.test.mjs`; what this component
  stopped doing is offering a reader four ways to re-ask one question.
- **The per-source headings are bigger** (owner: "a bit bigger so they're
  easier to see") through a new `--usage-source-label-size` token, declared in
  `styles.css` rather than left as a component fallback.
- **The gallery's painted controls shrank while every touch target kept its
  44px** (owner: reduce "left, right, current media"). The prev/next glyph
  paints at `--gallery-arrow-size` (0.75rem, from 18px) inside the same
  `.icon-button` box, and the position dots at `--gallery-dot-size` (0.25rem,
  from 0.375rem) with `--gallery-dot-active-scale` keeping the current one
  distinguishable — the small-mark-in-a-44px-hit-box pattern the lightbox close
  control already followed.
- The lightbox is stills only. Its video branch is removed rather than left
  unreachable, and arrowing the open dialog onto a film closes it — the one
  route that could still have landed there — with focus restored to whichever
  surface the stage then holds.

### Removed

- **The decorative play mark on every film** (owner: "remove the play icon from
  all videos, its just there doing nothing"). It promised a press that happened
  somewhere else; the real control is now under the reader's finger. Its four
  component-local tokens went with it.
- **The empty "About Me" section** (owner: "ensure that the 'about me' section
  is removed"). It was the page's last section and held nothing but an honest
  note saying it had not been written — a heading, a nav link and a card spent
  on the absence of content. The removal is one line in `src/page.ts` plus the
  block that line named; the nav follows without being told, because the nav IS
  that array. The two files it existed for left with it rather than lingering
  unreferenced: `lib/blocks/about.ts` and the `EmptyNote` primitive it was the
  only caller of, together with `EmptyNoteProps`.

### Fixed

- **The enlarged lightbox no longer throws the reader to the top of the page**
  (owner: "when I close the media, it returns me to the top of the page, that
  is not right at all"). The position was lost at OPEN rather than at close:
  `.gallery-lightbox` declared `position: relative`, and an author declaration
  beats the UA sheet's `dialog:modal { position: fixed }` on cascade ORIGIN
  whatever the specificity, so the box was placed in the DOCUMENT's coordinate
  space at the top of the page and `showModal()`'s focus move scrolled the
  reader there. MEASURED at a 1280x720 viewport against the live 0.1.52 origin:
  scrollY 1943 before the click and 0 while the dialog was open, on Chromium
  AND WebKit. The two engines differed only in the clean-up — WebKit restored
  1943 on close, Chromium left it at 0 — so one defect read as a broken page on
  Chrome and as nothing at all on Safari. The dialog is now `position: fixed`
  with the insets and auto margins stated in the component, so its centring is
  this repository's own claim on every engine rather than a UA default it
  happens to agree with.

### Tests

- The gallery pins are re-aimed at the new contract at equal strength: the
  play-mark presence pin became an absence pin over the class, the drawn
  triangle and every token only it read; "no video outside the enlarged branch"
  became "exactly one video, the current item's, in the stage and never in the
  dialog"; and new pins cover the kind-switched stage tokens, the player owning
  its own surface (no swipe binding, no button, no gallery arrow keys) and the
  shrunk marks inside unchanged targets.
- A new rendering lane drives a routed `gallery/v1` manifest carrying a still
  and a film through all five browser projects, measuring the real inline
  player — element, controls, `playsinline`, `preload`, poster, source ladder
  order, paused-and-at-zero — its widescreen enlarged stage against the still's
  square on the same page, and the painted arrow and dot marks inside their
  44px boxes.
- The usage pins are re-aimed the same way: the per-source lens and range tests
  became one pin that the panel offers nothing to press AND still draws its
  fixed graph, in both the unit suite and the rendering lanes. The retired
  view/range/category state is pinned as fourteen named absences so it cannot
  drift back one piece at a time.
- `fullDepthColumns` is executed at six capture depths on both sides of the
  reserve, including the comparison that proves it is not the ceiling the 12mo
  default was.
- The touch-floor sweep's measured-dimension count is re-derived from 18 to 16,
  the two lost being `.filter-trigger` and `.usage-view` from the deleted menu.
- The About Me removal is pinned where it was DECIDED: the section absent from
  the manifest, the import absent from it, and BOTH deleted files absent from
  disk, so neither can survive the section it existed for. The nav and section
  counts drop by one in both rendering sweeps that carry them.
- The lightbox placement is pinned in both halves that can hold it. The source
  pin binds every engine, including the ones no runner has: the rule computes
  `position: fixed` and carries its own `inset` and `margin`, and any author
  `relative`/`absolute`/`static` — the defect itself — fails it. The rendering
  lane measures a real engine's `window.scrollY` across all three close paths
  (Escape, the close control, a backdrop click) on all five browser projects,
  with a vacuity guard refusing to pass on a page that never scrolled, and
  asserts the focus restore that WebKit specifically needs.

## [0.1.53] - 2026-08-28

The usage export gains a memory (issue #234). Every source the exporter
reads is volatile — transcript trees are retention-pruned and the roll-up
cache has been measured discarding a month of days in one recompute — so the
served token series silently got shorter as evidence was deleted, which the
owner reported as days reading 0 or "no data". Each source can now keep a
durable machine-local history store that every run merges and rewrites, so a
day a capture has measured survives its sources forever after.

### Added

- `scripts/capture_usage_series.py`: `--history-store FILE` — a durable
  per-source day store (`usage-history/v1`; dates and non-negative integers
  under the closed emission vocabulary, nothing else). Each run unions the
  freshly derived series with the store and writes the union back
  atomically: a day the fresh capture measures at least as large keeps the
  fresh figure, a day the sources have since lost keeps the stored one, and
  a day with no evidence on either side stays absent — never zero-filled. A
  malformed, oversized, or unreadable store refuses the run; a missing file
  bootstraps.
- `scripts/export_usage_series.py`: the same `--history-store` flag for the
  walked source, passed through to the shared capture.
- `scripts/usage-export/push-usage-series.sh`: optional `HISTORY_DIR`
  configuration key wiring one store per source — the walked
  `$SOURCE_LABEL.json` plus one `<key>.json` per `MERGE_CAPTURES` entry —
  created under the script's private umask before any producer runs.
- `docs/usage-export.md`: the `HISTORY_DIR` operator section.

### Fixed

- `bounded_lines`: the terminated-oversized-record path accumulated
  `counters["bytes"]` but skipped the `MAX_RECORD_BYTES` ceiling check, so a
  tree of newline-terminated oversized records was the one input shape the
  walk-work bound never bounded (PR #230 review, INFO-6).
- `capture`: the per-model window now retreats behind any day its rows
  cannot partition — exactly as the categories window always has — so a
  history-store entry carrying a total without a stored attribution can
  never make the emitted models section fail the partition it declares.

## [0.1.52] - 2026-08-27

An owner UX dispatch across the whole frontend: the gallery decluttered to a
flat square stage, the usage filters folded into a disclosure menu, four
mobile defects fixed, and the site given a real link preview.

### Added

- `UsageFilterMenu.svelte`: a disclosure popover (sliders icon + "display")
  holding the view/range/category pill groups, so the usage tracker header
  carries one control instead of three rows of pills; `.usage-windows`
  collapses to one flex row.
- Link preview: Open Graph and Twitter card meta in the static
  `index.html` (the description moved there from `App.svelte`) and a new
  `frontend/public/og.png` (1200×630, black "SN." on white). The
  remote-origin test sweep admits the site's own canonical origin — and
  only it.
- Projects cards: a third count, "updated X ago", with a clock glyph
  (`EntryLog` + `blocks.ts` `EntryCount` `'clock'`); a fresh out-of-band
  capture dated 2026-08-27 in `src/lib/projects.ts` (commits
  118/95/89/1/20/1, `pushedAt` instants from the public API); an
  `updatedLabel()` helper with an injectable clock, every band tested
  against a fixed date.

### Changed

- Gallery declutter: `FeedCard` renders `variant="flat"` (the container box
  removed), the stage is square via new `:root` tokens
  `--gallery-stage-size: 28rem` / `--gallery-stage-aspect: 1` with
  `object-fit: contain` so art is never cropped, navigation is dots-only
  (the counter is visually clipped but keeps its `aria-live` announcement),
  and the frame tokens zero out including `--gallery-frame-radius: 0px`.
- Theme switcher: the selected swatch is marked by ink
  (`color: var(--color-brand)`) instead of an underline, a monitor glyph
  replaces the old auto glyph, and the `--swatch-mark-*` tokens are gone.
- Mobile theme plate: the opaque disc with a 16px shadow spread becomes a
  translucent `color-mix` veil under `backdrop-filter: blur(8px)` with
  `box-shadow: none`, in `.page-header` (`src/styles.css`).
- Lightbox: the enlarged `<img>` paints `item.previewSrc` as its background
  while the full file decodes, and video `preload` moves from `"none"` to
  `"metadata"`.
- `e2e/rendering-lanes.spec.mjs`: nine tests re-aimed at the new design
  (two retitled: "framed"→"unframed", "marks it by shape"→"marks it by
  ink"), a shared `chooseDisplay` helper, and the plate test pinning the
  veil (0 < alpha < 1, blur, `box-shadow: none`).

### Fixed

- Pull-to-refresh on iOS: a dynamic non-passive `touchmove` defence in
  `src/lib/pullToRefresh.ts`, with a new unit harness in
  `tests/gesture.test.mjs`.
- Heatmap on mobile: `ContributionGrid` claims exactly its drawn columns
  for a dated full-width series (the phantom-track fix, guarded by
  `datedSeries`), and `UsageTracker` unbinds `--grid-day-max` below 30rem
  so every range fills the strip; pins updated in `tests/grid.test.mjs`.

## [0.1.51] - 2026-08-27

The production-enablement release: real media and live panel data, on by
default, on the owner's 2026-08-27 directives.

### Added

- Production chart defaults for the media subsystem: `media.enabled: true`,
  the pre-provisioned read-only claim `naranjo-online-media` mounted at
  `/naranjo-online-media`, `profile: pi-local-static`, and
  `maxConcurrent: 32` — measured on the production host (saturation knee at
  16 workers ≈ 489 MB/s over 4 MiB ranged reads, flat to 128, zero errors),
  set at 2× the knee.
- Production chart defaults for the panels data root: the sealed-series
  claim and its state volume mounted read-only/read-write respectively, the
  `PANELS_DATA_KEY` Secret wired, and `panels.refresh.enabled: true` so the
  key-free fetch tier (GitHub contributions and commits, OSRS hiscores)
  refreshes live instead of serving the release-time snapshot.
- An exact two-rule egress allowance replacing the total outbound deny the
  chart carried while nothing fetched: TCP/443 to public address space, and
  DNS to the cluster DNS Pods selected by namespace AND pod label in one
  ANDed peer. Rule 1 carries an `ipBlock.except` list of exactly the
  routable ranges the in-process dialer refuses (10.0.0.0/8, 172.16.0.0/12,
  192.168.0.0/16, 169.254.0.0/16), so the fabric states the same refusal
  the process enforces: HTTPS to the internet, never to the cluster or LAN.
  `chart-egress-pin.sh` pins the new shape whole — 31 policy mutations and
  63 whole-render mutations all refused, floors raised to match.
- `token-usage/v2`: a per-day, per-model partition of each source's series
  over a closed, append-only model vocabulary (`other` reserved at index 0
  for tokens the producer cannot attribute), windowed to at most 92 trailing
  days as a byte-budget decision, declared by the section's own start date,
  and admitted by the same five rules on every boundary — closed membership,
  bounded rows, window contained in the series, exact span coverage, and
  per-day sums equal to the aggregate under an overflow-checked add. v1
  keeps a decode-only mirror so a document claiming the old kind while
  carrying a models section refuses rather than quietly upgrading.
- Per-view readings under the token-usage grids: the sentence now answers in
  the reader's own period (daily, weekly, monthly, cumulative), computed
  from the windowed daily cells rather than the lens output, so a weekly
  total is never a day's figure and never a 7×-counted aggregate.

### Fixed

- One oversized transcript line (> 4 MiB) no longer refuses the entire
  usage export: the line is skipped without being read whole, counted, and
  drained to a record boundary, while the tree-size work bound still holds
  (raised 2 GiB → 16 GiB after the real tree measured past the old bound).
  The drain runs only for a line that arrived truncated: a line of exactly
  the bound arrives newline-terminated, and draining past it swallowed the
  next record whole, uncounted (found by this release's adversarial review,
  fixed with a regression test proven against the pre-fix producer).
- The frontend's breakdown admission now mirrors the origin's 92-day
  model-window budget, so both sides of the boundary state the same rules
  (adversarial review, defense-in-depth finding).
- The hand-assembled second-tool merge source is gone: `MERGE_CAPTURES`
  recaptures every local tool's series fresh at the top of each push run,
  inside the same kernel sandbox, and a failed recapture refuses the whole
  push rather than shipping two ages of data under one envelope instant.
- The exporter's series depth now extends back to the earliest retained
  evidence (2026-07-02 for the first tool via its activity cache,
  2026-08-09 for the second) instead of the 15 days the walk alone held.

### Security

- Egress opens by exact allow-list, never by erosion: the two rules above
  are the complete outbound surface, the five-host bound stays enforced
  in-process at construction and per-request, and the resolved-address
  guard refuses private, loopback and link-local answers before dialling.
  The network-layer except list is defense in depth over that dialer, not
  a replacement for it.

## [0.1.50] - 2026-08-27

### Added

- A hand-rolled gesture layer (`src/lib/gesture.ts`, `src/lib/pullToRefresh.ts`)
  built on Pointer Events with no third-party dependency: a shared exponential
  rubber-band curve, a distance-or-velocity swipe decision, a horizontal claim
  test that never takes a gesture the page's vertical scroll wanted, and a
  settle that always returns the surface to rest.
- Pull-to-refresh, reinstated as a custom gesture rather than the browser's.
  It engages only at the top of the document, resists past its limit, arms at a
  threshold the indicator announces with rotation and fill as well as colour,
  refreshes the panels' own data in place, and settles home on every exit
  including a failed request. `overscroll-behavior-y: none` — the defended fix
  from issue #187 — stays exactly as it was; suppressing the native bounce is
  what makes a settle guaranteeable instead of a race.
- Swipe navigation on the media gallery, with a position readout and dot
  controls that are reachable by pointer, keyboard and assistive technology:
  a `radiogroup` with one tab stop, arrow/Home/End movement, and focus
  following the choice.
- Keyboard operation for the three token-usage segmented controls, which
  declared `role="radio"` and handled no keys at all: arrow/Home/End movement
  with a roving tabindex.
- `src/lib/keys.ts`, the one keyboard grammar every composite widget on the
  page shares — which presses are the browser's chords rather than a widget's,
  and where a ring of options moves. The grid strip, the segmented pills, the
  gallery dots and the reading-mode swatches all read it, so one page stopped
  carrying three hand-written key tables free to disagree.

### Fixed

- Every contribution grid now answers a tap, a hover and a keyboard focus with
  a real readout. The shared primitive rendered its detail card behind
  `{#if cardTitle && !cell.absent}`, so the calendar grid carried one on none
  of its cells and the token grid on 15 of 371; everything else fell back to a
  native `title=`, which no engine triggers on touch. The gate is gone, cells
  are `role="option"` in a `listbox` strip with arrow-key movement, and absent
  cells report "no data" rather than being unreachable. Under the dataviz floor
  a heatmap cell whose magnitude is legible only as a colour shade needs that
  colour paired with text — so a grid that could not be interrogated on touch
  was in breach of the floor on that device, not merely unpolished.
- The fixed reading-mode control no longer renders over page content at phone
  widths. It had a transparent background and reserved no flow space, so
  right-aligned panel content passed underneath it; measured 30×33px of overlap
  at 390×844.
- A page scroll no longer destroys a grid's keyboard cursor. The detail closed
  whenever the cell it was anchored to moved, and closing reported the
  selection away with it, so the ring and the `aria-activedescendant` a screen
  reader follows both disappeared because the reader scrolled. A cell-anchored
  readout now follows its cell and closes only once that cell has left the
  viewport; a pointer-following one still closes, because its anchor is the
  cursor rather than the cell. This bit the plainest keyboard path there is:
  focusing the strip opens the readout synchronously while the browser's own
  scroll-into-view for that same focus arrives a frame later, so tabbing to a
  grid produced a readout that closed itself.
- The grid's keyboard cursor is scrolled into the strip it lives in, on every
  move. The strip is far wider than its box and opens on its newest column, so
  a cursor routinely landed outside the scrollport — measured at 390×844, a
  tab into the grid marked a cell at x −11 against a strip starting at 51, and
  `Home` marked one at −323 — while the new key handler swallowed the arrows
  that used to pan the strip natively. Adding a cursor at the cost of the pan
  moved the defect to a different reader rather than fixing it. The move is
  instant in every reading mode: a cursor step is where the cursor IS, not a
  journey, so there is no motion for a reduced-motion preference to switch off.
- Tabbing into a grid names the newest dated cell rather than whichever one
  sits at the viewport's origin. The shared detail primitive answered a focus
  by resolving the element at point 0,0 — sound for a caller with one subject,
  wrong for a strip with 371 of them — so a caller that drives its own anchor
  now owns its focus reveal too.
- A readout is closed by a pan of the strip that carries its cell out of view,
  not only by a scroll of the page. The re-anchor repair asked the viewport's
  block extent alone, so panning the strip left the card, the ring and
  `aria-activedescendant` naming a cell 364px past the strip's right edge. The
  guard now clips against the subject's own scrollport on both axes, which is
  safe to ask precisely because the cursor is brought into that port first.
- A refresh no longer discards the keyboard cursor. Every delivery rebuilds
  the column arrays, and the grid dropped its selection on any change of their
  identity — so the ring, the readout and the `aria-activedescendant` a screen
  reader follows all vanished when the page did its minute's work, or when the
  new pull gesture asked for it. The cursor names a day, and a window that
  still contains that day keeps it.
- The gallery's position dots are operable by keyboard. They shipped as a
  `tablist` with a roving `tabindex` and no key handler at all — the same
  shape ("declared a role, handled no keys") this release fixes in the token
  panel's segmented pills — which left seven of eight dots unreachable and the
  eighth's press a no-op. They are now a `radiogroup` moving on the shared
  key ring, with focus following the choice; the movement arithmetic
  (`src/lib/keys.ts`) is one module for all three composite widgets on the
  page, and a source pin fails any composite role declared without a key
  handler on the same element.
- A swipe no longer swallows the reader's next activation. A drag suppresses
  the one click it produces, but a touch swipe produces none, so the
  suppression sat armed — and a keyboard reader, who raises no pointerdown to
  disarm it, walked straight into it. Measured before: swipe the gallery,
  focus the frame, press Enter, and the lightbox did not open. A click
  reporting a count of zero is a keyboard activation and is never suppressed.
- Modifier chords reach the browser. Both new key handlers branched on the key
  alone, so `Cmd`/`Alt+Arrow` (Back) and `Ctrl+Home` (top of document) were
  swallowed by the grid strip and by every segmented control.
- The page pull stands down on a mostly-horizontal drag, on the same predicate
  the swipe already used; a diagonal of dx 160 / dy 20 moved the page 18.8px
  before. The refresh CONTROL no longer displaces the page at all, since a
  press drags nothing, which keeps the travel transform — and the containing
  block it creates for `<main>`'s 101 fixed descendants — to the gesture
  alone. That re-parenting is harmless for a measured reason rather than an
  assumed one: a pull engages only at the top of the document, and nothing
  fixed inside `<main>` is visible there. The nearest detail host is 4375px
  down the page at 390×844, 3241px at 820×1180 and 3055px at 1024×1366 and
  wider — so the worst case is the tallest touch viewport, 3055px against
  1366px, a margin of 1689px. The rendering lane pins the RELATION rather than
  any of those numbers, so the day it stops holding is a red build rather than
  a silent re-parenting.
- The detail primitive refuses a caller that resolves many subjects without
  saying which one a focus landed on. That pairing was documented and nothing
  enforced it, so the next region caller could reacquire the viewport-origin
  guess this release removed — silently, since an omitted optional prop
  type-checks and renders. `drivenBinding` in `src/lib/tooltip.ts` throws at
  bind time instead, keyed on the binding's shape rather than on a list of
  callers, and `null` is how a driving caller says "nothing selected".
- The grid `listbox` owns its options: the layout div they sit in is
  `role="presentation"`, which is the only way ARIA admits them.
- Half the grid's arrow keys were dead. With no cursor yet, `ArrowRight` and
  `ArrowDown` stepped past the end of the cell list, hit the range guard and
  did nothing at all — permanently, since nothing they could do would give
  them the cursor they needed — while `ArrowLeft` and `ArrowUp` worked and hid
  it. Every arrow now opens a cold strip on its newest dated cell, which is
  what the handler always claimed to do. The arithmetic moved to
  `lib/grid.ts`'s `gridCursorTarget`, where the unit suite executes it.

### Changed

- The 44px touch-floor sweep now measures `min-inline-size`, `min-width`,
  `min-block-size` and `min-height` as well as definite sizes. A control whose
  only lower bound is a minimum previously sized no axis by the walk's
  reckoning and passed a floor it could plainly break; the walk went from 4
  measured dimensions to 18.
- The reading-mode popover's position lane measures the box AT REST. Issue
  #194 recorded a ±1 px cross-load flake on three engines and attributed it to
  font-metric timing; that was wrong. The popover reveals with a 120ms
  `translateY(-0.25rem)` slide and the lane read the box the instant it became
  visible, so both of its readings were samples of a box still travelling and
  the "shift" between them was two points on that slide (measured in WebKit:
  top 64 at 8ms, 65.65 at 25ms, 67.56 at 87ms, 68 settled). It now waits on
  the engine's own animation set, as the two lanes beside it already did, and
  asserts that nothing was animating when it measured. The one-pixel
  allowance is unchanged — not widened by a hair — and is now a genuine
  rounding margin over two settled readings.

## [0.1.49] - 2026-08-26

### Added

- Two CI gates over string-typed interfaces nothing was checking. Both pin
  BEHAVIOUR rather than inventory, and each refusal prints the exact one-line
  allowlist entry that lifts it.
  `scripts/ci/test_subcommand_callers.py` (12 tests) proves every subcommand
  `release_contract.py` registers is reachable from the repository that ships
  it. It reads the 27 names off the live `argparse` parser — never a
  hand-maintained list — and sweeps 40 comment-stripped files (6 workflow, 16
  script, 9 doc, 9 test at this head) for each as a BARE TOKEN, ignoring line
  structure entirely. That last part is the whole point: the near-miss this gate
  was built for was an audit reporting `release-record` dead because its
  invocation in `release-publisher.yml` is wrapped with a trailing backslash, so
  any pattern matching the name together with its first argument found nothing.
  Removing it was proven to break the publisher at runtime. The gate fails on
  zero callers of any tier and, separately, on test-only reachability; one
  subcommand trips the second refusal today (`immutable-settings`) and is
  allowlisted with its reason.
  `scripts/ci/test_workflow_integrity.py` (25 tests) refuses three constructs in
  `.github/workflows/` that silently change what a gate MEANS rather than what
  it does: `continue-on-error: true` on the required-checks set, an `env:` key
  that shadows an outer declaration or redeclares one of the six tool pins
  `install-tools.sh` owns, and a custom shell on a required check.
  Each rule reads EVERY scope its own construct can be written at, which is the
  single defect three of the four review rounds on this entry found in a
  different rule each time — the rule's own construct spelled where the rule was
  not looking, at `actionlint` rc=0 on a real workflow. `continue-on-error` has
  two such positions (a job and a step) and both are read. A custom shell has
  three: a step's `shell:`, and a `defaults.run.shell` at job or workflow level,
  which carries no step name and reshells every `run:` step beneath it. An
  `env:` declaration has four, because four scopes supply a step's environment:
  a job container's `env:` (outermost — every `run:` step in the job inherits
  it), the workflow-level `env:`, a job's, and a step's own. A service
  container's `env:` is deliberately NOT one: it sets the environment of a
  different container from the one steps run in, so no step ever reads it. The
  scope set of each rule is written down in the module docstring, audited
  against GitHub's workflow syntax rather than against what this repository
  happens to write.
  It resolves all 6 workflow files into 13 jobs and 90 steps through its own
  fail-closed structural reader — a workflow it cannot read fails the suite
  rather than passing quietly — and derives the 7-job required-checks set from
  `EXPECTED_MAIN_JOBS` and `EXPECTED_CODEQL_JOBS`, never re-listing it, so it
  cannot drift from what the publisher authorizes against.
  Neither gate carries a closed inventory, deliberately: there is no "exactly
  these N subcommands", no step or job census, and no env-key list, so adding a
  step, a job, an env key or a subcommand needs no edit to either file. Both
  allowlists ratchet shut in both directions — an entry naming a subject that
  does not exist, or whose subject no longer carries the construct it exempts,
  is a hard error — and both ship with a reason column the parser refuses to
  accept blank. `scripts/ci/workflow-integrity-allowlist.txt` ships empty
  because nothing needed waiving to reach green, so both ratchets are driven by
  fixtures rather than left vacuous. Both suites run under `pr-gate.yml`'s
  existing wildcard discovery (`-p 'test_*.py'`) with no workflow edit.
  Every rule, reader branch, allowlist refusal and lift path in the three
  suites is mutation-killed, under a harness that reports a selection matching
  zero tests as a fault rather than counting it as a kill. An earlier revision
  of this entry claimed zero survivors for the workflow reader's sweep; an
  independent sweep found two, and three more turned up in the sweep of the
  repair that closed them. All five are fixed here rather than reported: two
  fixture tables (the resolvable and unresolvable step shapes) could be emptied
  outright with the suite staying green, which would have left the reader's
  boundary — the part of that file that matters most — pinned by nothing; and
  the ordered scope list rule 2 reports a shadow from could be reordered, or
  have the container scope dropped from the step comparison, with nothing going
  red. Each now has the same floor the other tables carry. One honest limit on
  that class of assertion: a floor whose only job is to make ANOTHER mutation
  detectable cannot itself be killed while the table is populated, and the only
  assertion that would kill it is a minimum count — an inventory pin this gate
  refuses to become.
  Three classes of defect were found by successive adversarial reviews of this
  entry's own earlier heads and repaired here, all of the same shape — a check
  that looks strict, reads as strict, and refuses nothing.
  First, the structural reader accepted a step only when the item line was
  `- <key>: …`, so seven other VALID shapes — a bare `-` with the keys below it,
  a sequence indented level with its own `steps:` key, a wider gap after the
  dash, a comment between the dash and the first key, quoted keys, and the
  flow/anchor forms — were skipped whole. A skipped step is invisible to all
  three rules, so `continue-on-error: true`, `shell: sh`, and a shadowed pin
  each stayed GREEN while `actionlint` returned rc=0 and the runner would have
  executed them. The reader now derives the sequence indent from its first item
  and each step's property column from where its first key lands.
  Second, six of the rules could be DELETED OUTRIGHT with the suite staying
  green: every workflow and subcommand here is clean, so no shipped input ever
  reached a refusal. The rules were correct — mutating the real files fires each
  one — but their removal was undetectable, which makes a rule a comment.
  Fixtures now drive all three workflow rules, both subcommand rules, and both
  allowlist ratchets to a real refusal and back through their printed lift line,
  with a positive control on each so none can pass by refusing everything.
  Third — and this is what the other two were symptoms of — the reader
  recognised the spellings somebody had thought of and treated everything else
  as "not a match", which leaks BY CONSTRUCTION. Ten further evasions were
  measured against the real `pr-gate.yml`, every one valid YAML that GitHub
  Actions would honour: six ways of writing a true `continue-on-error` the
  reader compared as not-true (the scalar on the following line, an explicit
  `!!bool` tag, and a `${{ }}` expression, each at job and at step level); the
  two `defaults.run.shell` positions; and two step-level `env:` entries whose
  key the reader could not name and therefore dropped, one of them an explicit
  key (`? GO_COVERAGE_FLOOR` / `: '0'`). Eight of the ten are `actionlint` rc=0
  as spelled; an earlier revision said all ten were, and that is corrected here
  rather than restated. The two `defaults.run.shell` rows were measured with
  `shell: sh`, which `actionlint` rejects at rc=1 for an incidental reason — a
  shellcheck warning that POSIX `sh` has no `pipefail`, raised by this
  repository's own `set -euo pipefail` convention rather than by the construct.
  The CLASS is genuinely rc=0-reachable and was re-measured both ways:
  `defaults.run.shell: bash` and `: pwsh` are rc=0 at job and at workflow level,
  green before the repair and red after it. The explicit-key row is corrected
  the same way: it reddens because the READER refuses a key it cannot name, not
  because rule 2 sees a shadowed floor. `pr-gate.yml` declares
  `GO_COVERAGE_FLOOR` at STEP level only, so a plain step-level `env:
  GO_COVERAGE_FLOOR` elsewhere in that file has no outer declaration to shadow
  and stays green — the construct is the finding, the live floor is not
  currently shadowable, and saying otherwise overstated it.
  The repair is not another list of forms. The reader now RESOLVES a small,
  explicit set of scalar spellings — a plain token, a quoted string without
  escapes, or nothing at all with nothing nested under it — and REFUSES
  everything else in every position a rule reads, structure and value alike:
  tags, aliases, anchors, flow nodes, expressions, merge keys, explicit keys,
  an `env:` entry it cannot name, a job that declares `steps:` and resolves
  none, and multi-document files. `continue-on-error` narrows further to `true`
  or `false` in any casing, so that rule is TOTAL: every input either raises or
  resolves to one of two booleans, and there is no third outcome for a spelling
  to hide in. The boundary is written down in the module docstring, and a
  fixture table of twelve exotic-but-valid ways of writing `true` — none of
  which has a branch anywhere in the module — proves the property that matters:
  a spelling nobody anticipated turns the gate RED with no code change.
  Fourth, the same audit was owed to rule 2 and had not been given: it read a
  step's `env:` and nothing else, so its own construct one and two scopes out
  was invisible. Measured on the real `release-publisher.yml` — the one workflow
  here with both an outer and a job `env:` populated — a job-level `env: IMAGE`
  shadowing the workflow-level declaration, a job-level `env: GITLEAKS_VERSION`
  and a workflow-level `env: TRIVY_SHA256` were all GREEN at `actionlint` rc=0,
  while the identical key one scope deeper went red. So was a job container's
  `env: GITLEAKS_VERSION`, the fourth scope, found by auditing GitHub's syntax
  rather than by being shown it. All four are refused now, each with its own
  allowlist subject (`<workflow.env>/KEY`, `<job>/<job.env>/KEY`,
  `<job>/<container.env>/KEY`) that ratchets shut when the declaration it
  exempts disappears. The honest scale of it: no live exploit existed at any
  scope, because `release_contract.py` pins `EXPECTED_IMAGE` and
  `install-tools.sh` assigns every pin unconditionally rather than
  `${VAR:-…}` — this rule is preventative at every scope, so what was closed is
  a coverage hole, not an open door.
  And one PROMISE was wrong while the code was right. Both the module docstring
  and the allowlist header said every refusal lifts through one allowlist line,
  and offered two examples that do not: a reader refusal is raised while the
  file is being resolved, before any rule consults the allowlist, so pasting the
  exact entry changes nothing and no lift line is printed. That behaviour is
  kept, because an allowlist entry waives a verdict about a value the reader
  RESOLVED and there is no verdict to waive when nothing resolved — silencing an
  unresolvable construct is the silent pass the whole inversion exists to
  remove, and the entry would have to name its subject by line or raw text,
  which is the brittle inventory pin this gate refuses to become. The
  documentation is corrected instead, in all three places, with the real
  remedies (block style; a resolvable spelling — `shell: "bash -e {0}"` quoted
  resolves and lifts where the same value unquoted does not; or one reviewed
  widening of `resolve_scalar`). A test now pins both directions, so the
  paragraph cannot drift from the code again.
- A third gate closing a structural hole in the enforced secret scans:
  `scripts/ci/commit_identity_contract.py`, wired into `pr-gate.yml`'s
  `security` job and covered by `scripts/ci/test_commit_identity_contract.py`
  (19 tests). `gitleaks git` and `gitleaks dir` both read BLOB content, so a
  commit's AUTHOR and COMMITTER identity and its message body have zero coverage
  from either scan — yet those are exactly what requirement 3 constrains, and an
  address that lands there is permanently public and unfixable without the
  history rewrite requirement 2 forbids. The gate walks the range the event
  actually contributes and refuses a non-sanctioned author or committer
  (`identity`) and a `Co-authored-by:` trailer (`co-author`), matching the
  trailer the way `git interpret-trailers` does so it is not evaded by case or
  padding. Two design points are load-bearing. It is RANGE-scoped, never a
  history census, so it never re-litigates the root commit and needs no edit as
  commits accumulate. And a refusal names the SHA and the rule but never echoes
  the offending address: CI logs on a public repository are public, so a gate
  that exists to keep an address out of the permanent record must not publish it
  while refusing it — a rule the suite pins, and which the allowlist follows by
  keying entries on SHA and rule alone.
  `scripts/ci/commit-identity-allowlist.txt` records the nine pre-existing
  refusals measured across the 113 commits reachable from `main` — four commits
  whose author or committer predates the pinned-identity convention, the root
  commit, and four squash-merge trailers GitHub's UI added automatically. They
  are named, not rewritten, and the file says why. The remaining 104 pass, and
  72 of those carry GitHub's own `noreply@github.com` committer from an
  owner-performed squash or rebase merge: the rule admits that value for the
  committer field only, because it names no person and no owner-merge can avoid
  it, while still refusing it as an author. Refusing it instead would have made
  every main push red forever and turned the lift path into an ever-growing
  census of merge commits — the brittle shape this wave's gates exist to avoid.
  Every rule, allowlist refusal and lift path in it is mutation-killed, and
  both CI event directions plus the unsupported-event refusal were simulated
  locally. (An earlier revision of this entry put a count on that sweep. It is
  removed rather than restated: the number was measured at an earlier head and
  not re-derived at this one, and an unreproducible figure in a release
  artifact is the same defect as a wrong one.)

### Removed

- Dead frontend code with no caller left, verified against every file under
  `frontend/src` with a COMMENT-STRIPPED sweep so a mention inside a comment
  could not be mistaken for a use: the orphaned panel-index READ path
  (`PanelIndexEntry`, `PanelIndex`, `parsePanelIndex`, `loadPanelIndex`),
  which nothing has called since panels became blocks mounted by hardcoded id;
  the freshness clock (`watchClock`, `panelClockIntervalMs`), orphaned when the
  badge left at issue 179; `isSeriesView`; the `.icon-button[disabled]` rule,
  which styled a control that no longer exists; the unconsumed
  `--palette-status-unavailable` / `--panel-status-unavailable` token chain;
  and `ContributionGrid`'s `showMonths` prop, which neither call site passes.
  `panelsIndexUrl`, `panelAge`, `seriesViews`, `--panel-status-ok`,
  `data-panel-status`, `fullWidth` and `cardTitle` were each checked and KEPT:
  every one is either live or defended in a comment as a structural backstop.
- Duplicated and vacuous test coverage, keeping the stronger copy each time and
  MIGRATING the values only the weaker copy carried. The flagship was a
  `block-size: 7rem` assertion against `ContributionGrid.svelte` in which every
  `7rem` in that component sits inside a comment — the one it matched being the
  comment recording that `block-size: 7rem` was REMOVED at issue 130 — so it had
  been green and meaningless ever since, while pinning the literal that issue
  replaced.
- Four re-implementations of one workflow-step extractor and three
  near-identical synthetic-git-repo builders in `scripts/ci/test_release_contract.py`,
  plus one strictly subsumed test. Zero assertions were lost that the file did
  not already make elsewhere, and every workflow-step extraction was proven
  SHA-256 identical before and after — the byte equality is the load-bearing
  claim, and no count of extraction shapes is asserted, because none of the
  three methods tried (call sites, distinct constants, an instrumented run)
  agrees with the others on what a "shape" is.

### Fixed

- The CodeQL concurrency guard. The group falls back to `github.sha` off a pull
  request, so the weekly SCHEDULE run shares a group with a main PUSH run still
  analysing that commit and could cancel it. The publisher requires a
  successful `event=push` CodeQL run at that exact SHA, and CodeQL fires on push
  once per push, so that single cancellation made a version permanently
  unreleasable. Adopts the sibling repository's
  `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`, and the
  release-contract pin is TIGHTENED to that stricter string rather than removed.
- `TestNoSelectorEverSelectsOnTheVersionLabel` asserted only inside a regex
  match loop, so a reader that stopped matching passed green while checking
  nothing. Each chart template must now yield at least one selector block.
- Ten pre-existing Pyright errors, at the root and with no `# type: ignore`, no
  widening to `Any`, and no weakened assertion: `chart_render_census.py` (4, via
  a `NoReturn` diagnostic signature, a `Callable` mutation-table type, and a
  `PolicyFacts` protocol that finally CHECKS the duck-typed stand-in),
  `dependabot_contract.py` (4, by naming the four-node union its refusal path
  already depended on), and `test_chart_render_census.py` (2).
- The remote-origin sweep in three frontend suites matched a bare `//`, so any
  JavaScript line comment in the eight swept files turned CI red claiming a
  remote origin. Now requires a dotted authority, keeping protocol-relative
  origins flagged rather than dropping that half.
- Comments that stated a wrong number, a wrong scope, or a wrong mechanism: the
  census's round-six kill count (78, where the arithmetic closes at 69), a
  header counting eight constructs where nine follow, two suites miscounting
  their own tests, a claim that the census "replaces" a raw-line scan that is
  still live and gating every pull request, a comment defending an echoed path
  the code never echoes, and five in the dependabot contract.
- `AGENTS.md` claimed successful main CI creates the plain git tag. It does not
  and cannot: `release-after-main.yml`'s only job holds `actions: write` plus
  `contents: read`, so it can create no ref at all, while
  `release-publisher.yml`'s `publish` job holds `contents: write` and POSTs the
  tag object and `refs/tags/` from inside the privileged job — so no tag exists
  before authorization. The split is enforced by permissions, not convention,
  and the contract now names the permission doing the enforcing.
- `AGENTS.md`'s commit-signing one-liner was broken, and an earlier revision of
  the contract taught the break:
  `-c user.signingkey="key::$(ssh-add -L | grep ssh-ed25519)"` matches EVERY
  loaded ed25519 line, so `key::` receives a multi-line value and signing fails
  on a malformed key — which any agent that also loads a deploy or push key
  hits. It is replaced by a `signing_key()` function that intersects the keys
  GitHub has registered for SIGNING against the keys the agent actually holds
  and requires exactly one match, naming no key comment, hostname, or ordering.
  The section also documents the local-verification trap that selection exposes:
  the allowed-signers principal must be the BARE email, because a principal
  containing a space makes ssh read the space as a field break and report
  `No principal matched.` — the identical verdict a genuine wrong-key negative
  control gives, so a malformed file false-passes the negative control while
  proving nothing at all. Both controls must be run and must DIFFER (`G` against
  `U`).
- `.gitignore` now carries the `__pycache__/` rule the sibling repository
  already has. Every documented invocation of the `scripts/ci` suites passes
  `-B`, but `-B` is a flag a person can forget and importlib still caches on the
  run that omits it, leaving `.pyc` files for a later lane to clean by hand.

## [0.1.48] - 2026-08-26

### Added

- The token-usage panel now consumes SEALED RUNTIME DATA (issue #142): the
  workstation exports both tools' local usage records as one
  `usage-series/v1` document — per-day totals plus a per-day CATEGORY
  breakdown (input, output, cache reads, cache writes) that must partition
  each day's total — seals it with AES-256-GCM (`cmd/usageseal`, versioned
  `NJSEAL/1` format bound as AEAD associated data, fresh random nonce per
  seal, 64-hex-char key refused unless its file is private), and pushes the
  ciphertext over ssh stdin to a forced-command, `restrict`-ed dedicated key
  that can write exactly one file. The origin re-reads that file every five
  minutes through a rooted read-only mount (`PANELS_DATA_ROOT`), unseals
  with `PANELS_DATA_KEY` read at decrypt time only, strict-decodes under the
  pipeline's single 128 KiB sealed-payload cap with closed window/derived
  vocabularies and a monotonic `generatedAt` replay floor, and merges into
  the served panel — so the
  panel refreshes without a release, and every failure (tamper, replay,
  wrong key, over-cap, malformed, non-partitioning categories) keeps the
  last good payload and says so in the envelope status instead of crashing
  or fabricating. The export step cannot fork and cannot open a network
  endpoint because the kernel refuses: the scheduled push runs it inside
  `scripts/usage-export/producer.sb`, a seatbelt profile denying
  `process-fork` and `network*`, and a workstation without the sandbox
  refuses to walk raw records at all. Those two denials are the whole
  enforced capability — the profile is otherwise `(allow default)`, so
  exec-in-place and filesystem access remain, and the claim is stated that
  narrowly rather than as a general confinement. Its import surface is additionally
  pinned by an AST test against a closed allowlist — a REVIEW BOUND, not a
  capability proof — and every emission passes through the capture tool's
  own dates-and-integers guard with counts-only diagnostics.
- The chart carries the storage as first-class templates under GitOps
  (owner amendment on #142): TWO statically bound `local` PersistentVolume/
  PersistentVolumeClaim pairs on the platform's enumerated `local-pie-ssd`
  StorageClass, each with `Retain`, bounded required nodeAffinity, and
  volumeName/claimRef double-pinning — the DATA pair read-only at BOTH the
  claim reference and the mount, and the replay-floor STATE pair (the
  security review's H2 remedy below) explicitly writable at both and
  `ReadWriteOnce`, on a sibling node directory the push pipeline never
  touches. `ReadWriteOnce` is the honest mode for this target rather than
  the stronger-looking `ReadWriteOncePod`, which Kubernetes supports for CSI
  volumes only while the target runs none: single writing is enforced by the
  origin's locked monotonic compare-and-swap and by the single-replica
  render, and the chart says so instead of naming a mode nothing performs.
  The capability
  defaults OFF (`panels.data.enabled=false`, the review's M6 remedy
  below): its claims bind statically to admin-provisioned volumes, so a
  default render carries none of it and a fresh install schedules; the
  cluster-scoped PV documents default off within the enabled direction and
  are applied by an operator from the chart's own render, because the
  namespaced app reconciler holds no PV rights and granting them would
  bypass the namespace's restricted Pod Security posture. A storage pin
  script (`scripts/ci/chart-storage-pin.sh`, wired into the chart CI job)
  renders all four directions (enabled, with-pv, untouched default,
  explicit disabled) and kills 44 hostile mutations — writable data
  mounts, read-only state mounts, dropped or emptied storageClassName pins,
  smuggled PVs, moved node paths, a reverted hostPath source, reclaim
  weakenings, dropped or widened nodeAffinity, a second replica, a state
  access mode widened to `ReadWriteMany` OR re-claiming the CSI-only
  `ReadWriteOncePod`, and every
  overlap of the two roots and the two mount paths in both directions
  including dot-dot, duplicated-separator and trailing-separator aliases.
- The panel's per-source category lens: a second radiogroup slices the
  heatmap by category, and a composition figure renders each source's
  share bar with fixed per-category color slots, 2px segment gaps, and
  written labels beside every chip so identity never rides on color alone.
  Category palettes are defined per reading mode and hold the dataviz
  floors (lightness band, chroma floor, CVD and normal-vision separation,
  ≥3:1 contrast) in light, slate, and sepia; dark stays deliberately
  achromatic as documented lightness steps. Hostile category labels render
  inert — the component interpolates text and never markup.
- Operator tooling and doctrine: `scripts/usage-export/` carries the push
  pipeline (private scratch, checksum verification of the landed file, a
  0600-only local configuration OUTSIDE the repository so no host fact
  enters git), a launchd template plus installer for the hourly schedule,
  and `docs/usage-export.md` documents the end-to-end design, setup,
  verification, and deliberate failure modes.
- The gallery reads its items from a runtime `gallery/v1` manifest on the
  operator's media volume (issues #182, #207). Publishing a photograph or a
  film becomes an operator file copy: no commit, no CI run, no release. The
  document is fetched once from the mutable media class; every file it names
  is addressed through the immutable class by its own SHA-256, built solely
  by `lib/media.ts`, so one URL can only ever mean one set of bytes. Admission
  is by membership rather than shape-guessing — closed object shapes, a closed
  set of kinds, a closed set of media types, a 65536-byte cap whose transfer
  is cancelled the moment it is exceeded — and an unknown `kind` refuses that
  ITEM, never the document. `docs/media-manifest.md` is the contract.
- Film in the gallery (issue #207). A `video` item shows its poster in the
  strip through the same `<img>` every photograph uses, marked so a reader
  can tell the two apart, and plays in the lightbox behind
  `controls playsinline preload="none"` with the manifest's own source ladder
  in the manifest's own order. There is no `autoplay` attribute anywhere in
  the component, which is how `prefers-reduced-motion` is honoured
  structurally: nothing moves until a reader presses play.
- A third block binding, `runtime` (`lib/blocks.ts`, `Block.svelte`): the
  build's own props render first and immediately, and a one-shot read may
  replace them. A read that answers null changes nothing, so media disabled,
  no manifest, a 404, a malformed document and an empty one all leave the
  vendored bootstrap set on screen — issue #182's sanctioned explicit offline
  fallback, with no error state, no spinner and no invented row.
- `scripts/ci/chart-media-pin.sh`, a new required step of the `chart` gate
  job: the default render carries no media volume, no mount and no media
  environment beyond `MEDIA_ENABLED="false"`; an unnamed claim, the
  unresolved-storage sentinel profile, an unmeasured transfer budget and a
  non-absolute mount path are each refused by name; and the enabled render
  adds exactly one volume, read-only on both the claim and the mount, with
  `MEDIA_ROOT` at the same declared path.
- CLI-grade period and range controls over an unbounded token history
  (issue #158). The activity strip's three toggles now read ONE delivered
  payload three ways, in one pipeline: a CATEGORY lens picks which dailies are
  read, a trailing RANGE (30d/90d/12mo/all) cuts the window drawn, and a VIEW
  lens (daily/weekly/monthly/cumulative) aggregates the cut. `monthlyColumns`
  folds real cells by their own YYYY-MM rather than by column, because a
  calendar week straddling the first belongs to two months and a column-wide
  figure would report September's total on days that are still August; a
  partial edge month says so ("in Feb 2026 (12 of 28 days)") rather than
  reading as a whole one. The range vocabulary is closed and admitted by
  membership, a fixed range rounds up to whole weeks, and `all` is MEASURED
  from the data with no ceiling and one floor — the width below which the
  graph's own less/more key stops fitting. Every day a window covers and the
  capture does not comes back as a dated absent HOLE, never a zero, because a
  zero is a measured quiet day.
- Two honest sentences under the strip, both measured from the cells actually
  drawn (issue #158). The reading was built in the adapter over the whole
  series, which was true only while the strip drew the whole series; an adapter
  cannot see which window a reader chose, so it now lives in `lib/periods.ts`
  and is computed under checked safe-integer summation that refuses whole
  rather than reporting a rounded figure. The second line carries the
  denominator the first structurally cannot: "15 days" is the same phrase
  whether the reader asked for thirty days or a year. The category lens
  contributes only its NOUN to that sentence — those cells already carry its
  dailies — so there is one reading implementation rather than one per lens.
- `TestWindowServeOrderCoversTheClosedVocabulary` (`internal/panels`): the
  sealed-series admission reads one window list and serves from another, and
  nothing held the two equal. Adding a window to the vocabulary and forgetting
  the serve order would have left admission REQUIRING it while the serve loop
  silently dropped it — a payload short a window it had just insisted on, with
  no error and no red test. Both directions and duplicates are now pinned.

### Changed

- `chart/values.schema.json` describes an enabled media deployment instead of
  forbidding one from being written down. `media.enabled` and `media.profile`
  lose their `const` pins, and `claimName`, `mountPath` and `maxConcurrent`
  join them; a conditional makes `enabled: true` representable ONLY together
  with a reviewed profile, a non-empty claim, an absolute mount path and a
  measured budget. The shipped defaults are unchanged and remain the refusal:
  media is off, the profile is the sentinel, no claim is named, and no budget
  has been measured. Enabling media still needs ADR 0012's storage evidence
  and the platform lane's provisioning receipt; nothing here asserts either
  exists.
- `chart/templates/deployment.yaml` renders the media volume, a read-only
  mount at the declared path, and `MEDIA_ROOT`/`MEDIA_MAX_CONCURRENT` only
  when media is enabled — the origin refuses to boot when they are set while
  it is disabled, so an unconditional render would fail closed at start-up.
  `readOnly` is declared on the volume as well as the mount, so a container
  added to this Pod later cannot quietly be given a writable one.
- `.json` joins the origin's reviewed media types (`mediaTypes`,
  `internal/server/types.go`) with its own row in `TestMediaMIMETypes`. The
  runtime gallery manifest is a JSON DOCUMENT and was served as
  `application/octet-stream` with an attachment disposition — the deliberate
  fail-closed treatment for an extension nobody has reviewed, and the wrong
  answer for one that has been. It widens no capability: `application/json` is
  not active browser content, every media response still carries
  `X-Content-Type-Options: nosniff` (now asserted beside the type in the same
  test), every unreviewed extension is still refused inline, and the frontend
  loader still reads bytes and parses the text itself. What changes is that a
  human opening the manifest URL reads it instead of being offered a download.
- An upper bound on how far a FEW columns may stretch under a full-width
  contribution grid, read from a caller-set token whose default can never bind.
  Measured before it existed: five columns of a thirty-day window drew 88px
  cells in a 914px card, nine times their own height.
- Dead code and stale pointers cut rather than carried: a private thousands
  grouper that was a second copy of the shared one, missing its negative-sign
  guard (it rendered -123 as "-,123"); an interface with no remaining referent;
  and a category-lens resolver with no production caller, whose four
  still-shipping behaviours were migrated onto the component and adapter
  assertions that now decide them. Comments naming parity tests in directories
  they do not live in, and a sealed-ceiling note that said four places when it
  is five, were corrected in place.

### Security

Findings of the 2026-08-24 adversarial security review of this release's
head (REQUEST-CHANGES), each fixed with tests that fail against the
original code:

- H1 — the capture-side sanitizer checked SHAPE where the privacy argument
  requires MEMBERSHIP: label-shaped private identifiers passed as category
  keys (and would have rendered publicly), the impossible date 2026-99-99
  and newline-suffixed dates passed the digit pattern, and negative
  integers passed the type check. The emission guard now enforces a closed
  field-name vocabulary, a closed five-key category vocabulary held
  identical across the capture tool, Go admission
  (`internal/panels`' `categoryServeOrder` membership), and the frontend's
  palette slots by a three-way parity pin, real calendar-date parsing with
  no tolerance for a trailing byte, and non-negative integers, with
  booleans confined to the `recorded` flag.
- H2 — the replay floor lived in process memory only, so any restart
  re-admitted replayed ciphertext newer than the embedded snapshot but
  older than what had already been accepted. The accepted high-water mark
  now persists as a sealed marker (same Secret-fed key as the series;
  storage cannot forge it) in the writable state pair above, loaded
  fail-safe (absent/corrupt/future markers degrade to the embedded floor,
  never below; a failed write degrades durability, never serving), with
  restart simulations at the loop, composition-root, and full-site levels.
- M4 — the launchd installer anchored the scheduled job to its own
  directory, so an install from a disposable worktree broke silently at
  that worktree's cleanup. It now anchors the primary checkout
  (`NARANJO_USAGE_EXPORT_REPO_DIR` to override), refuses worktree paths
  outright, and gained a `--render-only` preview.
- M5 — the push transport trusted resolved ssh client configuration; a
  multiplexed admin connection could have been joined without
  re-authenticating the restricted key. The invocation now forces
  `ControlPath=none`, `ClearAllForwardings=yes`, `ForwardAgent=no`, and
  `RequestTTY=no` alongside the existing
  `BatchMode`/`IdentitiesOnly`/`IdentityAgent=none`, proven by a hermetic
  stub-ssh test asserting per-option membership of the received argv.
- M6 — `panels.data.enabled=false` silently fell back to the embedded
  snapshot while the PVC-on/PV-off default left a fresh cluster's pod
  Pending on an unbindable claim. The lifecycle is now explicit and the
  defaults schedule everywhere: the capability defaults off, disabling it
  is a documented as-of-release-snapshot decision stated where the value
  is set, and enabling it is a deliberate last step after the documented
  storage ceremony.

Findings of the ROUND-3 adversarial security review of the same work
(2026-08-24, REQUEST-CHANGES at `b5cf836`), each fixed with tests that fail
against the reviewed code and one claim downgraded because the mechanism
could not carry it:

- 1 — the producer's "structurally incapable of spawning" claim rested on an
  AST lint over IMPORT NAMES, and `pathlib.os.system(":")` restored the
  launch callable with the import set unchanged. The boundary moved to the
  invocation layer: the scheduled push starts the producer inside
  `scripts/usage-export/producer.sb`, a seatbelt profile denying
  `process-fork` and `network*`, with no flag or configuration key that runs
  it unconfined and an outright refusal on a host without the sandbox. The
  lint stays as a review bound and now SAYS so; the claim is stated as what
  the kernel enforces, and the profile states its own residual
  (exec-in-place, which buys nothing because the sandbox is inherited).
- 2 — the replay-floor marker serialized to whole seconds, so a fractional
  instant round-tripped LOWER than it was and re-admitted the document it
  had just accepted. The marker is RFC3339Nano both ways, and restart
  recovery binds the accepted CIPHERTEXT DIGEST rather than the instant
  alone, so a different document at the same instant is refused.
- 3 — the floor was not single-writer. `replicaCount` defaults to 1 while
  the capability is on, the render refuses more than one replica, and the
  marker is written through a unique temp file under an exclusive `flock`
  with a monotonic compare-and-swap — rejecting an equal instant unless the
  ciphertext digest is identical — and an fsync of both the file and its
  parent directory before success is reported. The availability tradeoff is
  stated where the value is set. This first shipped with a state claim of
  `ReadWriteOncePod`; the mode is CSI-only and the target has no CSI driver,
  so the claim named an enforcement that did not exist and the state pair is
  `ReadWriteOnce` with the mechanism stated plainly instead.
- 4 — deleting the marker silently reset the floor, and the runbook told
  operators to do exactly that. An initialization tombstone makes
  absent-after-initialized distinguishable from a first boot: the origin
  refuses the tick and reports `stale`. Declaring a cold start is now an
  explicit ceremony that removes both files and states, in the manual, that
  it lowers replay protection.
- 5 — a merge source could carry arbitrarily stale data under one current
  `generatedAt` and `status: ok`. `--merge-source` requires and validates a
  per-source capture instant, the combined document exposes per-source
  freshness, its envelope instant is the OLDEST source's, and sections a
  source-set-complete document omits are recomputed rather than mixed.
- 6 — a present accepted marker with an absent source served fresh on the
  first tick after a restart, because the acceptance fact lived only in
  process memory. It is persisted, so provenance loss is `stale` from the
  first tick.
- 7 — the storage shape was a hostPath pair the platform storage acceptance
  DENIES (originating issue website-infrastructure #211, now carried by
  website-infrastructure PR #212), and the sibling check compared raw
  strings in one direction. The chart adopts the platform design — `local`
  volumes under the enumerated root, the enumerated StorageClass on both
  objects, bounded required nodeAffinity, node name supplied at ceremony
  time and never stored here — and both root pairs must be disjoint in BOTH
  directions over normalized paths. The platform dependency is unlanded and
  this work stays Draft until website-infrastructure #212 merges and
  releases AND the #141/#189 live convergence receipt posts on this PR.
- 8 — the push inherited whatever `~/.ssh/config` resolved for a host alias
  and hardened only the options someone had named. It now runs with
  `-F /dev/null` (which also excludes the system-wide file), states every
  option explicitly, requires `user@host` and a pinned known-hosts file, and
  asks `ssh -G` what actually resolved — refusing before connecting unless
  the answer carries exactly the one dedicated identity and no
  `proxycommand`, `proxyjump`, `localcommand` or `controlpath`. That
  identity check catches a measured hazard: `ssh` silently ignores an `-i`
  path that does not exist and falls back to the default keys.
- 9 — one numeric contract now spans all three stages at 2^53-1: checked
  int64 addition in Go, `MAX_COUNT` in the producer, and
  `Number.isSafeInteger` in frontend admission, with a running-sum check on
  the category partition and a three-way parity pin comparing the constants
  by value.
- 10 — the producer walked without bounds. Reads are rooted and no-follow
  with containment re-checked after resolution, and file, entry, line,
  depth and aggregate-byte ceilings are enforced BEFORE work; failure
  messages stay path-free.
- 11 — rotating the key left an unopenable marker. The marker carries a
  versioned key identifier and refuses rather than migrating, because the
  header is outside the AEAD and honouring it would let anyone who can write
  the state directory lower the floor. Rotation is a documented ceremony
  whose rollback consequence is stated truthfully.
- Evidence correction: the sealed-payload ceiling figures in
  `internal/seal/types.go` and `docs/usage-export.md` had gone stale against
  the document the producer now emits. Re-measured at 98,958 sealed bytes
  for the structural maximum, 32,114 bytes of headroom, 125,340 at thirteen
  digits and 134,134 at fourteen; the suite now BUILDS and measures that
  document instead of asserting a transcribed number.

One further fail-open gate closed while composing this release:

- `--node` was the only one of thirteen facts `scripts/ci/chart-storage-pin.sh`
  states to its checker that was not required, and the node-binding assertion
  sat behind `if facts.node and ...`. Omitting the fact did not relax the check
  loudly — it SKIPPED it silently, so a PersistentVolume bound to the wrong
  node passed the pin clean. The fact is now required and the comparison
  unconditional. The same checker also reads its render through the census's
  own `flatten` rather than the raw document list, so an object smuggled inside
  a `List` wrapper is counted by the checks instead of hidden from them, and a
  document that is not a mapping is refused by name.

Findings of the 2026-08-26 adversarial review of this release's head
(REQUEST-CHANGES). Five of the eight were CLAIMS that outran their evidence
rather than defects in behaviour, and they are corrected as claims; the two
that were behaviour are closed with tests that fail against the original code:

- The two durability barriers guarding the replay-floor commit could be
  shipped as `return nil` with the entire Go suite green. The fault test
  injects a FAILING stub into each, so it pins the call sites and structurally
  cannot tell a real `Sync()` from a no-op — while a comment claimed it was
  red against exactly that mutation. The bodies are now pinned by calling each
  default against a closed descriptor, where a real sync fails and a no-op
  cannot, in both directions so neither a no-op nor a constant-error stub
  passes; and the comment now states which test pins which half and admits the
  limit no portable test can cross — that the kernel reached stable storage.
- `PANELS_DATA_STATE` versus `PANELS_DATA_ROOT` separation compared SPELLINGS
  only, so two different paths naming one directory — a host directory
  bind-mounted at both, in a hand-run container the chart cannot constrain —
  were admitted, and the origin would write its floor marker into the
  projection it must only read. Separation is now decided by device and inode
  (`os.SameFile`), a root that cannot be inspected fails closed instead of
  being assumed separate, and the one shape still invisible from inside the
  container — a state root bind-mounted from a directory inside the data
  root — is named in the code rather than left implied.
- Claim corrections, made because an untrue comment or figure is itself a
  defect here: the storage pin's `List`-unwrapping narrowing was real but
  unguarded (its removal left every test green and the shell pin exit 0
  reporting "all caught"), and now has both a unit kill and a 45th shell
  mutant; the frontend gallery-manifest loader described the manifest as
  served `application/octet-stream` when the same range made `.json` a
  reviewed media type; and the rendering-lane harness settled on document
  HEIGHT, which the static shell satisfies before the app mounts — it now
  additionally requires hydration to have finished, a stricter precondition
  on the same budget rather than a longer tolerance.

## [0.1.47] - 2026-08-26

### Changed

- Card text fills the card it sits in (owner directive 2026-08-26, issue
  #212 — the third report of the same shape). `--card-measure` was a 42rem
  reading cap on every summary, bullet list and empty note, and a capped
  block start-ALIGNS in a full-width parent: measured on the live page at a
  1440px viewport, `.entry-points` ran 672px inside a 934px card and left
  262.0px blank (28.1%), `.entry-summary` left 270.0px (28.7%), and About
  Me's `.empty-note` left 288.0px (30.0%) of a 960px card. Every one now
  measures 0.0px short at 1440px and 1024px alike. The owner ruled the
  trade for this site — filled width beats the typographic measure — and
  set a standing rule with it: a content block ending noticeably short of
  its container's inline end, without being a deliberately centred
  composition, is a defect. The token survives at `none` and the three
  declarations that read it survive with it, because together they are the
  card primitive's per-instance override channel; `.subsection-intro`'s
  hand-written `max-inline-size: 42rem` — a second, untokenised copy of the
  same number — is gone outright. The lines that result are longer: at the
  shipped 60rem column a bullet reaches ~133 characters where the cap held
  it to ~96, and a reader who drags the column to its 100rem ceiling
  reaches ~225.

### Added

- Both halves of the standing rule are pinned. A source pin
  (`tests/experience.test.mjs`) reads every `max-inline-size`/`max-width`
  in `styles.css` and in every component style, and refuses a bare length
  unless the selector is named with its reason — the one named exception
  being `.activity-entry-source`'s 9rem track cap, which bounds a
  repository slug inside a commit row whose last column is already flush
  to the panel edge. The pin converts the absolute family exactly (px,
  rem, pt, pc, in, cm, mm, Q — the spec fixes 1in = 96px = 72pt = 6pc =
  2.54cm = 25.4mm = 101.6Q) and names the width it found. It will NOT
  convert a font-relative unit, because resolving `65ch` or `42em` needs a
  computed font this pin does not have; such a cap is refused as
  unreadable rather than skipped, since `65ch` is the canonical spelling
  of a reading measure and a cap the pin cannot read is exactly where one
  hides. Only genuinely fluid forms are passed over, and the list is
  closed: any function value (`var()`, `min()`, `max()`, `clamp()`,
  `calc()`, `env()`, `fit-content()`), a percentage, a viewport- or
  container-relative unit, and the keywords that state no number at all
  (`none`, `auto`, `initial`, `unset`, `revert`, `revert-layer`,
  `min-content`, `max-content`, `fit-content`, `stretch`). So the number
  cannot return as a literal in a component the way it did in
  `.subsection-intro`, in any unit it could be written in. A
  rendering lane (`e2e/rendering-lanes.spec.mjs`) measures the rendered
  boxes in all five projects at 1440px and 1920px: every card-body block
  ends on the card's content edge, and every block that WRAPPED has at
  least one line reaching within a third of the card, so a box that fills
  while its text stays in a narrow column still fails.

## [0.1.46] - 2026-08-26

### Fixed

- The version-control panel's commit source no longer degrades to stale
  when a repository's recent history is verbose (issue #185). The
  embedded fetch configuration's commit-document cap moves from 131072
  to 262144 bytes, measured rather than guessed: across the three
  configured repositories' 274 three-commit windows of real history, 9
  exceed the retired bound and the worst reaches 209808 bytes, while
  none reaches the new one. Narrowing the request was measured first and
  rejected — the list-commits API exposes no field selector, the item
  count is already the minimum the merged list serves, and one single
  commit entry measured 120414 bytes, so no page size fits under the old
  bound with headroom. The bound stays a bound: it is still half the cap
  the same panel's calendar endpoint carries, still under the shared
  ceiling, and an over-cap document is still refused whole.

### Added

- A regression pinning that decision as data and as behavior
  (`internal/panels/fetch_test.go`): the reviewed cap, the `per_page`
  request shape it was measured against, and a loopback-socket matrix
  proving the shipped cap admits a realistically shaped document at the
  worst measured size while the retired cap refuses it — and that one
  byte over, truncated, and malformed documents are all still refused.

## [0.1.45] - 2026-08-26

### Changed

- The Art gallery answers three owner findings from a live review (issue
  #202). The visible frame is CENTRED in its track: its inline size is
  transferred from the 20rem block cap through the shared 16/9 ratio, and
  `justify-self: normal` behaves as start rather than stretch for a box with
  an aspect ratio, so the whole surplus used to land on one side — measured
  at a 1280px viewport, a 568.9px frame against the start edge of an 842px
  track, 273px of dead gutter on the right alone. A `.gallery-stage` wrapper
  now carries a definite width built from the same two tokens the reserved
  box is and centres itself with auto margins; the wrapper exists because an
  ALIGNED grid item is sized by its content, which with the lazy image
  blocked reserved 0x0 on Gecko, 194.6x109.4 on Blink and 0x0 on WebKit.
  Measured after: 150.6px of gutter on each side at 1280px and 14px on each
  side at 390px, on all three engines, with the images blocked.
- The lightbox close control stops sitting on the photograph. The 44px filled
  disc stamped over the picture's top-right corner becomes a 1.125rem mark —
  59% narrower — in a reserved lane above the frame, translucent at rest and
  full-strength on hover or keyboard focus; the 44px touch target survives as
  an invisible hit box, which still overlaps the artwork's top-right corner
  and is disclosed rather than claimed away. Measured: the mark's box ends
  14px above the framed photograph's, on three engines at two viewports.
  Placing the control outside the dialog was measured and rejected — a native
  `<dialog>` is `width: fit-content` with UA `overflow: auto`, and the outside
  placement turned it scrollable (scrollWidth 1194 against clientWidth 1154).
- Nine gallery style dimensions move from component-local `var(--token,
  fallback)` reads into the `styles.css` token layer, and the token pin
  covers all of them. `--gallery-meta-ink` gains a real definition beside its
  `--gallery-close-ink` sibling instead of existing only as a literal in a
  component. Defaults are the exact fallbacks the component still carries, so
  this is a token move and not a look change — pinned in both directions.

### Added

- Gallery items may carry optional `title`, `description` and `link`
  metadata, rendered in the lightbox and (title/description) as a caption
  after the counter, with absence rendering NOTHING: no empty row, no
  placeholder, no reserved band, and no default anywhere on the path from
  manifest to DOM. The fields live in the per-entry manifest shape so issue
  #182's media-volume cutover carries them unchanged. The eight bootstrap
  rows publish exactly the one fact `SOURCES.md` verifies — the fixed-seed
  source each vendored file came from, as an outbound link carrying
  `rel="noopener noreferrer"` — and no row claims a title or a description,
  because nobody has reviewed what a placeholder depicts.
- Escape now returns focus to the frame that opened the lightbox. The native
  dialog's own restoration is not enough: a mouse click does not focus a
  `<button>` on macOS WebKit, so on the engine every iOS browser runs the
  reader was landing on the document body.
- A rendering lane refuses every gallery byte and asserts the frame reserves
  the identical box it does with the photograph served, so the zero-CLS
  reservation is pinned in a real engine and not only at source.

## [0.1.44] - 2026-08-25

### Added

- Professional Experience replaces the Work section's placeholder copy
  (issue #203): four real roles, newest first, each with its employer,
  role, span, place and its own list of accomplishments. The
  "placeholder entries" note and the `data-placeholder` marker go with
  the filler they described; the marker stays available in the shared
  entry-log primitive for the next call site that genuinely needs it.
  `EntryLogEntry` grows an optional `points` list beside its optional
  paragraph, and a card still draws only the regions it has.
- The platform's real scrollbar thickness is measured before the
  application mounts and published as `--grid-scrollbar-size`
  (`lib/scrollbar.ts`, issue #130). The contribution strip's block size
  is derived from the rows it holds — cells, gaps, month axis and that
  measured gutter — instead of a 7rem literal whose arithmetic had
  forgotten the month axis's own margin, leaving 9px of reserve for a
  15px classic scrollbar. The measurement only ever widens the reserve
  the stylesheet ships with, so no platform loses layout and nothing
  shifts at hydration.

### Changed

- No link on the site wears a resting underline (issue #203): the repo
  card titles rendered ruled off under their heading. Hover and keyboard
  focus still mark every link, and position and role carry it at rest —
  the same a11y position the nav row already rested on.
- The page reserves the space above its own name, derived from the fixed
  chrome row it clears (`--page-top-space`, issue #203). The header is
  fixed and reserved no flow space, so the h1 began at the document's
  first pixel.
- The contribution calendar fills its card, like the token heatmap
  already did (issue #203). Both grids opt into the shared component's
  full-width treatment; the weekday gutter is `flex: none`, so the
  fixed token width it and the block's own arithmetic both read can no
  longer be shrunk out from under either.
- The recent-commits log reads as ruled rows at the 44px touch pitch
  rather than text floating in it (issue #203): the panel's own type
  step, and an inset-shadow rule per row so the five-row reservation is
  unchanged.
- The trackers stack opens with token usage and closes with the game
  tracker (issue #203); About Me is still the page's last section.
- Each usage source keeps its own daily/weekly/cumulative lens (issue
  #203). One lens for the whole panel meant a toggle beside one graph
  re-read the graph next to it, and each lens group now names its own
  source for assistive technology.
- Token magnitudes read the same way everywhere (issue #203):
  `formatMagnitude` in `lib/grid.ts` is the one implementation, gains a
  T step, and formats heatmap cells and their accessible text through a
  caller-supplied formatter — so a card no longer reads "627,742,457"
  under a summary line reading "7.7B". The contribution calendar keeps
  exact counts, which is the right reading for commits, and the exact
  figures survive on the usage pair row's own tooltip, now grouped.

## [0.1.43] - 2026-08-25

### Security

- The Ready-flip governance validator closes the window pin the round-2
  adversarial review and post-merge audit proved displaceable (issue
  #198; Daybreak review 5023834495, audit receipt 5417622565): every
  block of AGENTS.md, the PR template, and the release runbook that
  speaks of Ready — `\bready\b`, case-insensitive — must now hash-match
  an enumerated SHA-256 pin, in both directions (an unenumerated block
  and a vanished pin both fail red), so a competing Ready authority
  cannot ride outside the pinned canonical section. Six closure mutants
  pin the fix: displacement before the rule, displacement after the
  closing delimiter, a rewritten Merge-readiness bullet, a second
  runbook paragraph, a template addition, and the lost-pin direction.
  Documented honest limit: a contradiction phrased without the word
  survives the scan; canonical-rule equality and adversarial review
  remain the outer layers.

## [0.1.42] - 2026-08-25

### Fixed

- The issue-168 popover column-independence probe in the rendering-lane
  smoke matrix measures the claim instead of half-pixel luck: raw float
  positions compared per edge within one CSS pixel across the two page
  loads, replacing round-then-require-equality, which flipped at
  half-pixel font-metric boundaries and failed on unchanged trees
  (issue #194; re-cut of the approved PR #195 onto the post-0.1.41
  base). The invariant is unweakened: a column-coupled popover moves by
  hundreds of pixels at the column minimum, far outside the one-pixel
  cross-load tolerance.

## [0.1.41] - 2026-08-25

### Changed

- Risk-based review ceremony (issue #190, owner directive 2026-08-22
  re-affirmed 2026-08-25): the Main Worker receipt is retired — after the
  independent adversarial review approves the exact final head and all
  required checks are green, the coordinator flips Ready and the owner
  merges, with no third distinct-context pass. Review depth is now stated
  as risk-based (security-surface / normal code / docs classes) instead of
  identical for every PR; the author runs the complete local gate once on
  the final head and the reviewer re-runs the full suite only with
  specific cause; labels and PR metadata are named as coordination
  signals rather than security invariants, while the App-posted
  exact-head review verdict — actor and head binding — remains control
  evidence. The enforcement is repointed: `require_ready_flip_governance`
  pins the replacement rule CLOSED — the `AGENTS.md` section and the
  runbook's retirement paragraph must equal the canonical text exactly,
  so a contradictory permission inserted beside the rule is as red as a
  deletion (review round 1 proved the substring pin let one survive) —
  with deletion, inversion, and Ready-before-controls contradiction
  mutants, and it fails closed if the retired ceremony's canonical shapes
  (`ROLE: MAIN-WORKER`, the bounded five-line receipt) resurface in any
  governance document. Removed control, stated plainly: no second
  independent context re-checks architecture, merge order, authority,
  settings, base freshness, or required checks before Ready — base
  freshness and required checks stay coordinator-verified at the flip,
  and the owner merge gate remains terminal. Commit identity and SSH
  signing, owner-only merge, the release transition gate, the four-way
  version lock, and the independent adversarial review itself are all
  untouched.

## [0.1.40] - 2026-08-25

### Changed

- UX polish bundle (issues #168, #169, #171, #176, #177, #178, #179,
  #180): three independently developed UX lanes assembled onto the
  block-architecture refactor (#165).
  - Header chrome (#179, #168, #177): the manual refresh control is
    removed entirely — every panel keeps itself current through its own
    live surface instead of a shared button — and the page header is now
    pinned (`position: fixed`) to the corner of the viewport rather than
    scrolling with the page; the resizable column's drag handle lost its
    painted rail, leaving a bare 44px hit lane with a focus-visible
    outline only.
  - Navigation (#171): tapping a section nav link no longer leaves a
    `#fragment` in the URL for a later page refresh to re-apply —
    `history.scrollRestoration` is set to `'manual'` and the fragment is
    dropped once the scroll completes — while a direct visit to a shared
    fragment URL still deep-links correctly.
  - Reading-mode menu and token chart (#169, #180, #178): the five
    reading modes (auto/light/dark/slate/sepia) now paint genuinely
    distinct `currentColor` silhouettes instead of palette-fill swatches,
    inside a flatter popover; the token-usage contribution grid can opt
    into a full-width, tap-friendly layout with an OSRS-style
    value-only hover/tap card, and the shared detail card's rows may now
    render a bare value without a label.
  - Gallery (#176): the art gallery renders exactly one photograph at a
    time — never eight stacked — with prev/next controls and a native
    `<dialog>` lightbox for the full-resolution view. Eight placeholder
    photographs are vendored locally as WebP pairs, a narrow and dated
    exception to requirement 11 tracked by issue #182, with full
    provenance recorded in `frontend/src/assets/images/gallery/SOURCES.md`
    and an exact-file allowlist plus size ceiling pinned by test.

## [0.1.39] - 2026-08-25

### Added

- Observability (issue #183): the origin now emits OpenTelemetry-conformant
  structured logs to stdout with the standard library only — one JSON
  object per line via `log/slog` (text on an interactive terminal),
  attribute names following OTel semantic conventions, tuned by
  `LOG_FORMAT`/`LOG_LEVEL` whose unrecognized values fail closed to the
  default with one WARN naming the value. Every record carries the
  resource identity (`service.name`, plus `service.version` and
  `vcs.ref.head.revision` when the build embeds them — never invented).
  Each request produces exactly one completion record
  (`http.request.method`, `url.path`, `http.response.status_code`,
  `http.response.body.size`, `network.protocol.version`, `request_id`,
  `duration_ms`) at INFO/WARN/ERROR by status class, with an
  injection-safe `X-Request-Id` contract (strict inbound shape or a
  generated identity; always set on the response) and spec-exact W3C
  `traceparent` handling — passed through untouched, never minted, its
  trace-id logged as `trace_id` and its parent-id only as the custom
  `parent_span_id` (no OTel SpanId is emitted: the origin produces no
  spans, and the parent-id is the caller's span). The
  panel-refresh loops narrate themselves: per-cycle INFO summaries,
  failure WARNs with the error chain and exact next-retry instant,
  per-source degrade WARNs, and DEBUG upstream detail naming bare hosts
  only. Privacy is pinned by tests: URL paths only (never query
  strings), no client IPs at any level, `user_agent.original` at debug
  only, no upstream URLs, credentials, or payload bytes, and no media
  root path. The full lifecycle logs — startup summary, shutdown signal,
  drain outcome, final exit — and README's new "Observability contract"
  section documents the Logs Data Model mapping, the correlation rules,
  and the collector/SDK roadmap.

## [0.1.38] - 2026-08-25

### Changed

- The frontend becomes the block architecture the owner specified in
  issue #165: three strictly separated layers. INFORMATION keeps the
  domain payloads — every `/api/panels/*` wire contract is untouched —
  and gains one pure, node-executed adapter per block beside its data.
  COMPONENTS are generic presentation primitives with zero domain
  knowledge: a stat tracker, an activity tracker, a usage tracker, an
  entry log, a media gallery, an empty note — each renders a typed props
  bag and nothing else, so the tracker that shows game stats today shows
  fitness stats tomorrow without an edit. THE FEED is one ordered
  manifest, `frontend/src/page.ts`: each block a component bound to an
  information source through its adapter, reordering the page one moved
  line, and the section nav derived from the same array so a link can
  never point at a section nobody rendered. Every behavior released in
  0.1.36 (PR #172) is preserved inside the new names: sha admission
  tolerance and the SHA-permalink-over-reference precedence now live in
  the executed activity adapter (`commitTitleLink`), the caption-free
  Coding Projects feed keeps its guards — the static rows are not
  fetched from GitHub, no code automatically requests `projectHost`,
  and the validated GitHub URLs are used only for visitor-activated
  navigation — and the touch floors hold on both axes. Rendered output
  is unchanged: full-page 1280px screenshots in all four reading modes
  are byte-identical between a clean previous-release build and this
  tree, and the browser-lane matrix passes with only mechanical
  selector renames — no measured assertion changed.
  `docs/design-iteration.md` documents the three iteration loops
  (referencing the `Makefile` and README "Local development" section
  that #175/0.1.37 added), and `styles.css` opens by naming itself the
  hand-tuning surface.

## [0.1.37] - 2026-08-25

### Added

- Local development: a root `Makefile` (`make help`, `deps`, `build`, `run`,
  `dev`) and an additive, dev-server-only Vite `server` block bound to
  `127.0.0.1` with a `/api` proxy to the locally built backend, so the owner
  can run the full app on localhost and give live feedback against real
  panel data while a UI lane is in flight, instead of judging from
  screenshots. `make dev` launches a real built backend binary by captured
  PID (never a backgrounded `go run`, which orphans its listening port) and
  traps `EXIT`/`INT`/`TERM` to kill exactly that PID, so Ctrl-C always frees
  the port. `vite build` never reads the new `server` block, so production
  build output is unaffected.

## [0.1.36] - 2026-08-24

### Changed

- Recent-commits feed rows are real navigation. The repo name always links
  to the repository. The title's destination PREFERS the commit's own
  permalink whenever the row carries a validated 40-lowercase-hex SHA —
  the one association this document can actually prove — and falls back to
  the trailing `(#N)` a squash merge writes at the end of the subject only
  when no valid SHA is present; that fallback destination is deliberately
  `/issues/N`, and the accessible name calls it a neutral "reference," never
  a "pull request," because a trailing number alone proves only that this
  repository's own convention wrote a number there, not what it names.
  `sha` is an OPTIONAL field on the wire: a row may omit it entirely (an old
  replica served during a rolling update legitimately still can), and an
  absent or empty SHA is truthful absence, not a decode fault — normalized
  to `''` and falling through to the reference link or, with neither
  available, plain text. Every href is CONSTRUCTED from a validated field,
  never interpolated from the payload's raw string. Two cells in every row
  are controls now, not decoration, so the row grew from 1.125rem to the
  44px touch floor every other control on the page clears, on BOTH axes —
  a valid one-character repo slug gets an inline-size floor alongside the
  existing block-size one, so the shortest admitted repository name still
  clears 44px in both dimensions (#157).
- The header nav row drops its idle underline. Hover adds the underline back
  plus the brand ink, and keyboard focus keeps the exact site-wide ring
  untouched; a nav link is told apart by POSITION (the one row directly
  under the page's name) and ROLE (`<nav aria-label="Page sections">`)
  before color enters into it at all (#157).
- The Coding Projects feed no longer renders its capture-date and
  network-posture caption ("Counts captured from GitHub on \<date\>; this
  page fetches nothing."). Both halves were maintainer/reviewer facts, not
  visitor information; the capture date remains recorded as a maintenance
  constant (`projectsCapturedOn` in `lib/projects.ts`), simply no longer
  printed. The static Coding Projects rows are not fetched from GitHub; no
  code automatically requests `projectHost`; the validated GitHub URLs are
  used only for visitor-activated navigation — rather than by a sentence on
  the page (#167).

### Fixed

- The project gallery's placeholder frame rendered nearly viewport-tall at
  the page's default column width — a 16:9 ratio alone has no ceiling on a
  wide column, so 60rem of column asked for a 33.75rem frame. A second,
  independent token, `--card-media-max-block-size` (20rem, 320px), caps the
  reserved block-size; a narrow column still gets the full photograph
  proportion below that cap, and `object-fit: cover` crops the picture to
  fill the frame above it (#157).

## [0.1.35] - 2026-08-24

### Fixed

- The `ColumnHandles` resize rails no longer paint a visible hairline at
  rest. `--page-rail-ink` (the idle mark) resolves to `transparent` instead
  of `var(--color-border)`, so the 44px hit lane stays exactly where it was
  but nothing draws inside it until a pointer or a focus ring arrives;
  `--page-rail-ink-live` (the brand-ink hover/focus/drag mark) and every
  rail geometry token are unchanged. One token, all four reading modes
  uniformly, no theme branching (#155).

## [0.1.34] - 2026-08-24

### Added

- A second record shape for the local usage capture, and with it a real daily
  series for the second token-usage source — the first honest answer to the
  hurdle recorded in #139. `scripts/capture_usage_series.py` gains
  `--format running-totals`: a shape whose records carry a session's RUNNING
  cumulative total rather than one message's own usage. The running figure
  repeats on every event, so a record's contribution is how far that total
  advanced since the record before it, attributed to the record's own UTC day.
  Measured over a frozen copy of the owner's tree — the same read that
  produced the shipped bytes, because the live journal grows while it is being
  measured: 313 journals, 26,663 accounting records, of which 900 are repeats
  that bill nothing and 11 are mid-file restarts. Summing the per-turn deltas
  beside the running total overstates the 2,957,327,402 token truth by
  97,637,009 (+3.3%); taking one final total per journal understates it by
  251,254,408 (-8.5%), because every restart discards the session's first
  half. The advance walk is exact.
- An import-surface pin on the capture module (owner ruling 2 of #142), in the
  style of the panels' zero-egress doctrine test: the parsed module's imports
  must equal a closed allowlist, and `os` is refused alongside `subprocess`,
  `socket` and `urllib` — `os.system`, `os.popen` and `os.exec*` would reach
  straight past a promise — so the capture is structurally incapable of
  spawning a session or opening a socket. The walk moved from `os.walk` to
  `pathlib` to make that possible.
- Rendering lanes for the strip's look, its responsiveness across the whole
  range of the page-column token, and the escaping of payload strings, plus a
  layout-shift ledger attributed to the panel that owns it.
- One hover-detail primitive for the OSRS panel, and both grids render it.
  A fine pointer gets a detail anchored to the CURSOR — rAF-throttled to one
  placement per frame, viewport-clamped and edge-flipped so no position can
  drag the document sideways — while a finger or the keyboard, which have no
  cursor, get it centred over the tile with a tap to toggle; the split is a
  capability question (`matchMedia` plus the event's own `pointerType`),
  never a user-agent string. The skill tiles' bare `title=` tooltips are
  gone, replaced by the same primitive the boss tiles use, and every visual
  dimension of the detail reads a `--tip-*` token derived from the panel's
  own, so a reading mode restyles it for free.
- The reader drags the feed column to the width that reads best. Two mirrored
  44px grab lanes sit just outside the column's edges; Pointer Events with
  capture survive the pointer leaving the lane, moves are rAF-throttled with
  bounds measured once at the grab, and the keyboard drives the WAI-ARIA
  Window Splitter pattern (focusable `role="separator"`, arrows, Home/End,
  double-click reset). No width can break the page: the browser clamps the
  column against its bound tokens AND the available space, the script clamps
  against the same tokens before a byte reaches a declaration, and the stored
  preference is hostile input by doctrine — a strict bare-decimal grammar,
  a finite check, then the clamp, so no string from storage ever becomes CSS.
  Bounds are 18rem (exactly the 320px phone's column) to 100rem; the handles
  render only where there is room for them, and no stored width is in force
  on a phone at all.

### Changed

- The contribution strip is sized to the columns it draws instead of to a
  fixed year. At 1280px the two token graphs go from a 938px box holding 36px
  of cells to a 127px box; the version-control calendar keeps every one of its
  53 columns and its 686px. The floor is ten columns, which is the first count
  whose box carries the less/more key printed under it (123.38px, identical in
  all three engines). The box is a maximum rather than a width, so a narrow
  screen still shrinks it and the strip still scrolls inside itself.
- Both shipped series refreshed from today's capture. The three tiles a daily
  series defines are recomputed from it and every other recorded figure is
  left as its own capture left it.
- The reading-mode swatches are redrawn in the chrome-icon grammar. The
  filled 44px disc, its rim and the chosen ring are gone: a swatch is a bare
  44px hit area around an 18px line glyph at the header icons' own stroke,
  translucent at rest and at full presence when pointed at, focused or
  chosen, with the palette moved INSIDE the glyph and selection marked by an
  underline bar as well as presence. Two new tokens
  (`--chrome-icon-glyph-size`, `--chrome-icon-stroke`) state what the two
  families share and the swatch tokens derive from them, so they cannot
  drift apart; the sepia `color-mix()` is retired with the disc it existed
  to dim.
- Five Dependabot updates land as one superseding batch (#143–#147): svelte
  5.56.9→5.56.10, vite 8.2.1→8.2.2, the github/codeql-action init+analyze
  group 4.37.7→4.37.8, actions/upload-artifact 4.6.2→7.0.1 (major; the one
  call site keeps its zipped-artifact behavior — `archive` defaults to true
  and is untouched), and docker/setup-buildx-action 4.2.0→4.3.0. Every
  target SHA was verified against its upstream tag or commit, and the
  remaining singletons were confirmed genuine singletons rather than a
  version-locked pair Dependabot split. The release-contract suite's
  hardcoded audit binding for setup-buildx-action follows the bump — its
  v4.2.0 expectation predates this branch and fails the Python battery
  against the bumped workflows on its own.
- AGENTS.md's "Shared machines contend" bullet now records the port rule the
  wave measured: browser-lane runs on a shared machine set `SITE_PORT` to a
  private port, because `frontend/playwright.config.mjs` defaults to 8080
  with `reuseExistingServer` outside CI, and cross-lane servers twice
  answered another lane's probes.

### Fixed

- The reserve held for the version-control calendar and the calendar that
  lands in it are now pinned to each other from both sides — `pendingWeeks` in
  `frontend/src/lib/grid.ts` and the shipped payload in
  `internal/panels/registry_test.go`, each naming the other. A sized box makes
  that equality load-bearing: were the two to drift, the calendar would change
  width on arrival. Measured across a real arrival: 0 layout shift attributed
  to the panel.
- The lane proving a seriesless source renders no graph no longer depends on
  the owner's records happening to be missing one. It stages the absence from
  the origin's own envelope, so it went on proving the rule the day a real
  series arrived for the second source instead of failing its own non-vacuity
  check.
- The boss detail no longer opens a full row away from the cursor that asked
  for it: the per-cell anchoring is deleted with its containment job kept —
  the detail is `position: fixed`, so it sits outside the document's
  scrollable overflow by construction and viewport clamping contains it at
  every edge instead of only the inline ones.

### Security

- The release contract's SLSA builder-identity check is anchored to the
  authoritative run instead of a prefix every run of every workflow satisfies.
  `build_attestation_statement` takes a required `builder_run_id`, itself
  validated as a positive decimal Actions run ID so no composite can be
  escaped into the expected string; the prefix test becomes an anchored
  `re.fullmatch` against `<source>/actions/runs/<run id>` with an optional
  `/attempts/<n>`; the CLI gains a required `--builder-run-id`;
  `release-publisher.yml` binds a freshly built image to `GITHUB_RUN_ID`
  while the reused-image path and `release-audit.yml` re-derive the run
  identity from the first platform's predicate and require it of every
  platform. Probed in both directions against the published v0.1.32
  provenance: the true run ID passes, a different run, the PR-gate run, a
  composite, and an empty ID all deny.

## [0.1.33] - 2026-08-24

### Added

- A true dark mode, and four reading modes total. `dark` is repainted as a
  neutral near-black ladder — every value white composited over #121212 at a
  fixed opacity, so no hue is representable, elevation is pure lightness, and
  text stops short of white — while the desaturated navy that used to answer
  to the name survives as `slate`. Repainting `dark` in place is what fixes
  the default: `prefers-color-scheme` maps the dark palette by name, so
  auto-mode visitors get the true dark rather than navy forever. The heatmap
  ramp in that mode is hueless, leaving the RuneLite orange the mode's only
  chromatic token. A parity test requires every mode to declare the identical
  token set, and the origin precomputes the fourth stamped shell variant.
- The token-usage heatmap gets a real daily series, derived from the owner's
  own local transcript records by a stdlib-only capture step that
  de-duplicates replayed records (42,445 raw vs 35,752 messages), sums per
  UTC day, and emits nothing but calendar dates and non-negative integers —
  15 days, 7,333,913,801 tokens, peak 1,911,380,289. Three tiles the mapper
  derives from a series (peak day, both streaks) are recomputed from it; the
  streak tiles move to 7/7 because a tile may not contradict the graph
  printed under it. Nine real commits replace the false "no recent commits"
  state, and the per-figure "recorded" marker appears only when provenances
  within a source actually disagree — 100 markers on the served page before,
  0 after.
- The page becomes one wide stacked column with named sections — Work,
  Projects, Trackers, About Me — navigable from under the owner's name, and
  a reusable feed-card primitive (issue #136): optional header regions that
  exist and are tested while today's data leaves them empty, four variants,
  and a 30-token style layer derived from the global palette so every mode
  restyles the feed for free. The Art section is a single-column feed of
  eight 4K photographs served by content digest through the media subsystem
  (nothing enters git); the boss log wraps into three columns and no longer
  scrolls at any width.

### Removed

- The empty contribution grid for a source with no obtainable daily record
  (issue #139, owner ruling). A source the payload reports without a series
  renders no graph region at all — no grid, no toggle, no "series pending"
  plate — while keeping its tiles and insights; the check is data-driven, so
  a series arriving via live refresh restores the grid with no code change.
  The version-control calendar keeps its loading reserve: that payload is
  genuinely in flight, and the reserve is what holds the page still while it
  lands.

## [0.1.32] - 2026-08-23

### Changed

- The duplicated post-merge container build is gone (issue #133). The PR
  gate's `container` job now carries `if: github.event_name == 'pull_request'`,
  the same condition `dependency-review` has always carried. It remains a
  REQUIRED pull-request check, so nothing merges without it; what is removed
  is only its second, cache-less execution on the main push - 598 seconds of
  a 601-second run that gated nothing. Merges are squash-or-rebase with merge
  commits disabled under a strict required-check ruleset, so the tree that
  lands is necessarily the tree the required check just built, and the
  Dockerfile takes no build argument and no git metadata and digest-pins every
  base, making the image a pure function of that tree. The bytes that actually
  ship are still built, scanned, signed, and attested inside the publisher's
  privileged job. `EXPECTED_MAIN_JOBS` records the resulting `skipped`
  conclusion and now refuses a `success` there as well, so silently dropping
  the condition denies the release rather than quietly rebuilding after merge
  authority was already exercised.
- The browser-lane smoke matrix runs on pull requests and manual dispatch
  only, for the same reason: it reads nothing outside the tree, gates no
  release, and is not a required check, so a repeat run on the merge measured
  identical bytes and delayed the release path behind it. `workflow_dispatch`
  keeps `main` re-measurable on demand.

### Removed

- The README's `Browser lanes` main-branch badge. With the push trigger gone
  the badge would freeze on its last historical main run and keep asserting a
  status for trees it never measured; the adjacent prose now states where the
  lane actually runs.

## [0.1.31] - 2026-08-23

### Added

- Browser-emulated rendering lanes in CI (issue #26, stage 2): a separate
  SHA-pinned workflow drives the shipped binary through Chromium, WebKit, and
  Gecko at phone viewports - viewport contract, touch and text floors measured
  after layout, no sideways scroll from 320px with the menu open, reduced
  motion in both directions, zero layout shift across theme switches, and an
  origin lane that watches every request the page makes. `@playwright/test` is
  pinned exactly (1.62.1), declares no install scripts, and the browser
  binaries enter neither git nor the image.
- App-side zero-secret panel refresh (issue #79): the egress-guarded fetcher
  resolves each destination once, admits it against a refusal list, speaks
  port 443 only, refuses redirects, and spends a per-attempt budget - while
  `PANELS_REFRESH` stays default-off, so shipping the code changes no runtime
  behavior until the owner's separate enablement decision (the cluster-side
  egress allowance remains deferred to the platform lane).
- Release-contract hardening (issues #93, #106, #110, #128): settings pins
  now refuse the bool/int lookalike in both directions; requirement 10's
  twice-corrected two-denial-mode wording is sliced between once-only anchors
  and pinned positively, with relocation unable to rescue a mutated original;
  the first fixture whose advance walk separates anchor from boundary proves
  the cumulative proof classifies from the advanced anchor; and the PR
  template's reviewer signature line now matches the contract's, with the
  blank-receipt denial pinned to the guard that actually issues it.
- Experience pass one (issue #127): the "Samuel Naranjo" header, icon-only
  top-right chrome, full-width desktop layout with mobile untouched, OSRS
  Total XP and Rank in the grid, the boss log as a horizontal side-scroller
  with the icons locked in, the panel renamed GitHub with the calendar
  anchored to today and scrolling left, and the token panels rendering the
  GitHub-style contribution grid instead of a refresh-state message.

### Changed

- Reviewer independence in the receipt validator is actor-based (issue #64):
  the posting actor must be byte-exactly `snaraj-agent-reviews[bot]`, the
  signature line remains content, and the textual same-lane rule is retired.
- Both token-usage sources are refreshed from the owner's own 2026-08-23
  usage screens, and the recorded peak-day tiles take the live mapper's key
  so a refresh replaces them in place instead of doubling them. The anthropic
  peak-day total serves null - the capture reports a date, not a figure - and
  both activity graphs stay empty, because a bucketed intensity ramp is not a
  per-day series and inventing one is not an option.
- The HSTS ownership comment in `server.go` reflects the measured two-layer
  reality (issue #115), and the no-artifact documentation is corrected in two
  places where prose had drifted from the shipped classifier (issue #109).
- The RSN line and the staleness badge no longer render (issue #127): the
  displayed name was personal information the owner chose to withdraw, and
  the badge restated a provenance the panel envelope already carries.

### Fixed

- `formatDuration` gains its day step, so a session past twenty-four hours
  reads `1d 17h 55m` instead of making the reader divide `41h 55m`.
- The contribution grid no longer clips at fixed block sizes (issue #127's
  delivered defect fix).

## [0.1.30] - 2026-08-22

### Changed

- The token-usage panel's anthropic source now carries real figures instead of
  an empty shell, and the codex source is refreshed from a stale 2026-08-12
  capture: lifetime tokens, peak day, current and longest streak, and longest
  session, plus the model mix as insights. Both are captured from the tools'
  own usage panels on the owner's workstation - no credential of any kind is
  involved, and none reaches the cluster - so every figure keeps
  `recorded: true` and says it came from an out-of-band capture rather than
  borrowing the panel's freshness.
- A `count` unit joins the closed stat unit set, so a tally that is neither
  tokens nor time can be published: sessions, for one. It renders grouped and
  exact rather than abbreviated, because a tile showing "17.1K" has lost the
  figure it exists to show. The set is now hand-duplicated in a Go const block
  and a frontend admission set, so a parity pin holds the two together and
  fails naming whichever side is behind - the contract calls a new unit "a
  conscious edit on both sides" and this is what makes that mechanical.
- The anthropic source goes from an empty shell to twelve tiles, matching the
  detail the source tool itself reports: lifetime tokens, the
  input/output/cache-read/cache-write breakdown, peak day, sessions, active
  days, days tracked, both streaks, and the longest session. It carried no
  tiles at all before this release; the codex source is the one that had
  five, and it still does.
- Two capture bases, stated rather than blended: everything except the
  anthropic peak comes from the 2026-08-22 usage panels; the anthropic peak
  day comes from the workstation's local daily aggregate, whose last computed
  date is 2026-08-21, because the usage panel reports no peak-day token total
  and inventing one is not an option.

## [0.1.29] - 2026-08-22

### Changed

- The page is one centered column instead of a document with chrome floating
  over it. The reading-mode control was fixed to the viewport with an inline
  offset that included the side rail's gutter, so it slid sideways every time
  the rail opened or closed — a control that moves when the visitor touches
  something else. It now sits alone in a page header, in the document flow.
- Refreshing became one gesture instead of three. Every card used to carry its
  own refresh button beside its title, which implied that bringing data up to
  date was a per-tracker decision; one control at the head of the stack now
  re-reads every mounted tracker at once. It is attached to the trackers
  rather than to the page header, because it acts on the data and the header
  is for controls that act on the document. What is genuinely per-card — how
  old THIS tracker's data is — stayed exactly where it was, as each card's own
  freshness badge, dot shape and all.
- The side rail is retired and its panel mounts directly. The OSRS stats,
  version-control activity, and token-usage panels are ordinary blocks stacked
  in one centered column, so adding a tracker is one mount line and the page
  grows to fit it. The two reserved gutters, the four-level layer scale, the
  rail's published open-state attribute, and `PanelShell`'s rail-filling
  variant all existed only to arbitrate floating chrome and left with it; the
  layer scale keeps the two entries the reading-mode popover still needs.
- Panels follow the reading mode. Every panel already read `--panel-*` custom
  properties with dark-native fallbacks precisely so a theme layer could
  restyle them without editing a component; that layer now exists, written
  once against the active tokens rather than per mode. RuneLite's orange
  survives as the brand mark in all three modes, carried by its own token so
  it stays orange instead of dissolving into each palette's neutral.

### Added

- A fourth reading-mode choice, `auto`, which hands the decision back to the
  operating system. It is deliberately not a stamped theme: choosing it
  removes the `data-theme` attribute and EXPIRES the theme cookie, so the
  origin serves the unstamped default document — whose tokens follow
  `prefers-color-scheme` — from the next navigation on. Modelling it as a
  fourth stamped id would need a `[data-theme="auto"]` block restating the
  whole media query and a precomputed variant that cannot be correct for two
  visitors whose devices disagree. The menu derives its four choices from the
  three-id registry, so the two can never drift.
- `refreshPanels()` and a live-watcher registry in `lib/panels.ts`. A watcher
  joins the set when it starts and leaves when it stops, so the stack's one
  control refreshes exactly what is mounted with no registration code in any
  panel — and each panel dropped the watcher handle and refresher it only held
  in order to hand one back up. It rides each panel's existing single-flight
  read rather than opening a second request path, so pressing it costs at most
  one request per mounted tracker however hard it is pressed.

### Fixed

- The body scrolled sideways at every viewport width. A grid item's automatic
  minimum size is its min-content, so the card holding the boss table refused
  to shrink and dragged the stack to 708px inside a 480px column. Measured
  with a browser harness, not inferred.
- The boss table cut the leading digits off every visible row. Its hover
  tooltip carried a 9rem minimum inside a cell roughly a third that wide and
  was anchored to a distant ancestor, so in the last column it extended past
  the table's inline end and gave the grid a scroll width wider than the
  panel. The tooltip is now anchored to its own cell, bounded against the
  viewport, and flips at the end edge.
- A control nobody can see scrolled the page sideways by 22px on a narrow
  viewport: the panel refresh button expands its hit area to the 44px touch
  target with a transparent overlay, and that overlay was centred on the
  button, so half of it overhung the panel's inline edge. Harmless while the
  panel sat inside a fixed rail; real overflow once panels became page-wide.
  The overlay now grows inward from the control's end edge and keeps its full
  44px.

### Testing

- The palette is validated rather than asserted: a new test computes WCAG 2.2
  contrast for every panel foreground on every reading mode's own card and
  fails below 4.5:1 for text and 3:1 for the status indicator. It caught a
  real defect — RuneLite's orange measures 2.37:1 on the light card — which is
  why the light palette carries a darkened amber at 5.33:1. The test also
  derives each heatmap ramp's DIRECTION from its own surface, so a ramp that
  steps toward its background instead of away from it is a red build.
- A source pin refuses any hard inline size wider than the 320px floor,
  because the browser harness available locally cannot open a window narrower
  than 500px; the property is enforced where it is decided rather than assumed
  from a wider measurement. Both new pins were mutation-tested.

## [0.1.28] - 2026-08-22

### Fixed

- The published Helm chart is deployable as published. `release-publisher.yml`
  now substitutes the resolved image digest into `chart/values.yaml` on the
  runner before packaging, so the chart in the registry no longer ships the
  all-zeros fail-closed sentinel that no registry can resolve (issue #111,
  ADR 0016 step 1). The substitution reads only
  `steps.image.outputs.digest` — the value the HIGH/CRITICAL scan, the cosign
  signature, and the provenance attestation already accepted — and never
  re-derives a digest from a tag lookup.

### Security

- The substitution is fail closed in both directions. The workflow refuses a
  digest that is not `^sha256:[0-9a-f]{64}$` or that is the all-zeros
  sentinel; the source values file must still carry the sentinel before it is
  rewritten, so committed drift or a second substitution denies instead of
  overwriting; and every packaging step re-reads the archive it actually
  produced, so a substitution that silently became a no-op fails the run
  rather than publishing an unpullable chart.
- One substitution runs ahead of BOTH `helm package` invocations, so the
  chart-state classifier's reproducibility re-package and the publish step's
  archive are the same bytes and an idempotent re-run of an already published
  version still classifies `complete` instead of a false `burned`.
- `release-audit.yml` reproduces that substitution with the image digest the
  audited Release's own manifest binds, which strengthens the weekly
  chart-source comparison: it now also proves the published chart deploys the
  exact image that Release, signature, and provenance are about.
- The committed `chart/values.yaml` keeps the sentinel, so the four-way
  VERSION lock, `values.schema.json`, and the gate's rendered-digest
  assertion stay exactly as strict as before.

## [0.1.27] - 2026-08-21

### Changed

- Classify a merged range whose every commit is individually confined to the
  closed documentation allowlist (root `AGENTS.md`, `README.md`, `.gitignore`,
  Markdown under `docs/`) as no-artifact: it advances no version, creates no
  tag, and dispatches no publisher. Every other range keeps the unchanged
  one-exact-patch release contract, so an image-affecting merge still produces
  the identical signed, scanned, attested release. Removing the release from a
  documentation-only merge weakens nothing — the artifact is unchanged, so
  there is nothing to version, sign, scan, or attest (issue #102).
- Gate both release-effect steps of `release-after-main.yml` on a class the
  orchestrator re-derives from git itself. The PR gate publishes its verdict
  for the exact pushed range as a run artifact; the orchestrator requires it
  from the run it already binds, re-derives the class independently, and for a
  no-artifact range additionally re-proves as documentation the gap an
  anchor-advance walk leaves behind — from the advanced anchor to the merged
  head, not from the boundary commit, since the prefix the walk consumed is
  genuine artifact history that already released. An absent verdict, a foreign
  class, or any mismatch fails the job red. There is no third path and no
  toggle.

## [0.1.26] - 2026-08-21

### Added

- Publish the parallel-agent worktree contract in `AGENTS.md` so any clone
  carries the isolation, lane-ownership, shared-git-state, and cleanup rules
  that previously lived only in a machine-local skills folder.
- Ignore `.claude/worktrees/` so the layout the contract mandates stays clean
  in a fresh clone instead of relying on a local `.git/info/exclude`.

## [0.1.25] - 2026-08-20

### Security

- Refuse the complete 2,050-code-point class that YAML 1.2.2 and PyYAML
  6.0.3 exclude from printable streams: U+D800-U+DFFF and U+FFFE-U+FFFF
  (issue #98). The v0.1.24 census reader accepted those raw characters even
  though the oracle rejected the stream; its production stdin path also
  accepted malformed UTF-8 preserved by Python's `surrogateescape`. The new
  pre-parse guard covers every placement before YAML scanning while retaining
  the exact allowed boundaries, including U+1FFFE/U+1FFFF. Exhaustive class,
  endpoint-placement, allowed-boundary and raw-byte stdin tests pin the
  behavior, and a 48th hostile render mutation carries raw U+FFFE in a YAML
  comment so the real chart gate exercises the guard.

## [0.1.24] - 2026-08-20

### Security

- The chart gates now census the COMPLETE installable Helm render for
  NetworkPolicy documents, through a reader that resolves every key to its
  canonical spelling before matching (issue #86). The independent security
  review of PR #80 proved the previous census could be walked past: it
  recognised a document only by a raw line whose prefix was exactly `kind`
  (`chart-egress-pin.sh:146-149` at that head) and the spec only by a raw
  line exactly equal to `spec:` (`:94-103`), so a SECOND `NetworkPolicy` in
  the same rendered file spelled `kind :` / `spec :` was invisible to the
  assertion and to all 19 self-mutations — while parsing, under a real YAML
  implementation, as an empty-`podSelector`, `policyTypes: [Egress]` policy
  carrying one empty egress rule. NetworkPolicy allowances are additive, so
  that document grants every Pod unrestricted outbound access while the
  first policy still reads "default deny". Helm lint reported 0 failed
  charts, `helm template` exited 0, and the pinned gate exited 0.
- `scripts/ci/chart_render_census.py` is the answer: a stdlib-only
  (no PyYAML, no yq), fail-closed reader for the YAML subset a Helm render
  actually uses — comments, flow collections, quoted keys and scalars,
  block scalars — followed by a semantic census. It parses the whole render
  (`helm template` with no `--show-only`, `--include-crds`), flattens
  generic and typed list wrappers so nothing hides inside one, requires the
  render's `(apiVersion, kind)` inventory to equal a pinned multiset,
  requires EXACTLY ONE `NetworkPolicy`, and asserts that policy's selector,
  `policyTypes`, ingress rule and `egress: []` semantics against an
  expectation the gate states itself — never read back out of the template
  under test. Its structural design goal is to refuse rather than misread,
  so anything it cannot read unambiguously is refused with the offending
  line named: tabs, carriage returns, C0 and C1 control characters
  (U+0080–U+009F), the Unicode line breaks NEL/LS/PS (U+0085, U+2028,
  U+2029), byte-order marks, `%` directives, anchors, aliases, tags, merge
  keys, duplicate keys in block or flow style, non-string keys, plain keys
  carrying a comment (`k #: v`), flow-mapping keys whose colon is glued to
  what follows (`{a:1}`), plain scalars opening with an indicator in KEY and
  VALUE position alike (`@foo:`, `` `foo: ``, `|foo:`, `>foo:`, `,foo:`),
  unterminated flow collections or quoted scalars, multi-line plain scalars
  at any indentation including the top level,
  a second document the stream never spelled `---` in front of,
  plain scalars opening with a sequence indicator, a document-end marker
  (`...`) with no document to end or with content after it and no
  intervening `---`, YAML 1.1's value key
  (`=`) and merge key (`<<`) in both positions, and plain scalars whose
  meaning differs between YAML 1.1 and 1.2 (`yes`/`no`/`on`/`off`, `1:30`,
  `1_:0`, `0x1F90`, `0755`, `1e3`, `1_000`, `2026-08-20`, `.inf`). Floats
  are the one number form it RESOLVES rather than refuses, so its pattern is
  PyYAML's own float-resolver decimal branches transcribed character for
  character: `.5` is 0.5 to both readers and `-.5` is the string "-.5" to
  both. Block scalars are the one MULTI-LINE construct it resolves rather
  than refuses, for the same reason and by the same method: `|` and `>`
  bodies follow PyYAML's `scan_block_scalar` and its three helpers step for
  step, so the block's indentation is the widest run of leading whitespace
  crossed on the way to its first content line, a line of spaces is blank
  only while it fits inside that indentation and is content past it, and the
  folding and chomping tails are the oracle's own — including the fact that a
  stream not ending in a newline has no final break to chomp.
  It reads YAML's whitespace as YAML defines it — space and tab only —
  rather than through Python's Unicode-aware `str.strip()`/`.split()`, decides
  what a `---`/`...` document marker is from ONE shared predicate rather than
  five, and spells every regex class as a literal ASCII range rather than
  `\d`, which is PyYAML's own choice too, so `int()`/`float()` never see a
  fullwidth or Arabic-Indic digit. The reader is differentially checked
  against an out-of-tree
  PyYAML 6.0.3 over a corpus of real-render and hostile shapes — 182,170
  inputs at this head, measuring ZERO divergence — and six
  rounds of independent review extended that corpus; every divergence any
  round measured — `1_000`, a leading byte-order mark, YAML 1.1 timestamps,
  plain `=`, signed leading-dot floats, colon-glued flow keys, NEL/LS/PS,
  the C1 controls, indicator-leading keys, plain `<<`, underscored
  sexagesimals, commented keys, flow scalars run past `?`/`[`/`{`,
  Unicode whitespace silently stripped out of a scalar (`a: \xa0` was the
  value `None` here and the string `"\xa0"` there; a whole-document `\xa0`
  was zero documents here and one there; `a: |\xa0` parsed here and raised
  there), the document-end marker `...` (zero documents here and a
  ParserError there; two documents here and a ParserError there),
  implicit document boundaries (`a`/`b` was two documents here and the one
  folded scalar `"a b"` there; `-`/`a` and `x`/`kind: v` were two documents
  here and ScannerErrors there), and block-scalar line semantics (`a: >`//`  x`
  was `"x\n"` here and `"\nx\n"` there; `a: |`/`  x`/`   ` was `"x\n"` here and
  `"x\n \n"` there; `a: >`/`   `/`  x` was accepted here and a ParserError
  there; and a stream not ending in a newline gained a final `\n` here that
  the oracle does not add) — is
  closed here. Over that corpus there is now no input this reader accepts
  and reads differently than PyYAML, and none it accepts that PyYAML
  refuses; the divergences that remain all run the other way, this reader
  refusing what PyYAML resolves. Nothing in this repository depends on
  PyYAML; it is the oracle, not a dependency.
- The round-five findings also FALSIFIED a claim this module and this entry
  both carried: that multi-line plain scalars were refused. They were not —
  the reader was silently splitting them into separate documents, and only an
  indented continuation ever reached the refusal. The claim is true now,
  because the repair makes it true: a document boundary is `---`, `...` or
  end-of-stream, and a top-level node that simply stops is refused with the
  offending line named rather than closed and reopened.
- `scripts/ci/chart-egress-pin.sh` grows from four assertions to seven. The
  original text pin and its 19 mutations are untouched; (c) is the
  whole-render census, (d) rewrites the real render into 47 hostile ones —
  same-file and new-file shadow policies with spaced, double-quoted,
  single-quoted and `\x`-escaped keys, flow-style documents, block-scalar
  kinds, generic/typed/nested/uninspectable list wrappers, a policy under a
  CNI's own kind, anchors, merge keys, explicit tags, tab indentation, a
  byte-order mark, an underscored number, a YAML 1.1 timestamp, a value-key
  scalar, a Unicode line break, a C1 control character, a colon-glued flow
  key, a flow scalar run past a nested indicator, an indicator-leading key,
  a commented key, a merge-key scalar, an underscored sexagesimal, a render
  whose last document is separated by `...` instead of `---` (which the
  census read as the same four documents and passed while PyYAML refuses the
  whole stream), a render carrying a document nobody spelled — a top-level
  `null` followed by an empty `List` wrapper, which the pre-repair census
  counted as the same four objects and passed while PyYAML refuses the stream
  outright — a block scalar that swallows the line after it — a
  whitespace-only line wider than its body, which sets the block's
  indentation past that body so the oracle raises and the pre-repair census
  read on and passed — four renders a real API server will not install whole
  (a multi-line label value, a label key carrying a second `/`, an object
  name with an underscore, an annotation key carrying a second `/`), each of
  which the pre-repair census reported GREEN on and Kubernetes v1.36.3
  partially refuses — and ten
  widenings of the pinned policy itself — and requires
  every one to be refused; (e) now runs the census under each values override too; (f) and
  (g) pin both batteries against being quietly shrunk.
- `scripts/ci/test_chart_render_census.py` (140 tests) pins the reader
  itself in the `security` job, without helm: that `kind :`, `"kind"`,
  `'kind'` and `"\x6bind"` are all the same key, that list wrappers are
  flattened into their items rather than merely rejected, that a legal
  respelling of the real policy still PASSES (normalisation must not turn
  into a false alarm), one refusal per fail-closed rule, and one acceptance
  companion per refusal so no rule over-reaches — `.5` and `8080` still
  resolve, `©`/`é`/CJK/emoji still read, a mid-token or sole U+00A0 stays
  part of the scalar, `\N`/`\L`/`\P` still produce their
  characters, `{a: 1}` still parses, a `...` inside a quoted or block scalar
  is still ordinary text, `a: 1` / `...` / `---` / `b: 2` still reads as
  two documents, a spelled `---` boundary still separates documents, and a
  render carrying a real multi-line block-scalar value — blank line,
  more-indented line and whitespace-only line inside it — still reads byte
  for byte as PyYAML reads it, still censuses green, and now also APPLIES
  cleanly to a real API server. It also pins
  the shell script's mutation floor against the battery's real size, so the
  two cannot disagree.
- The census now refuses objects Kubernetes will not install, because its own
  claim is "N INSTALLABLE objects" and PR #96's round-five review measured
  that claim false in the fatal direction. A render carrying a multi-line
  value in a LABEL censused GREEN — four objects, exactly one NetworkPolicy,
  equal to the pinned expectation — while `kubectl apply` against Kubernetes
  v1.36.3 creates the ServiceAccount, Service and Deployment and REJECTS the
  NetworkPolicy alone: the workload installed without its deny, the gate
  reporting everything fine. The suite's acceptance companion had blessed
  exactly that render. It carries the multi-line value in an ANNOTATION now,
  which is where Kubernetes permits arbitrary strings (verified: rc=0, all
  four objects created, the stored annotation byte-identical), and keeps
  block-scalar coverage on the label side with a strip-chomped one-line
  scalar. The census additionally validates the fields Kubernetes rejects on,
  every boundary probed from both sides against that same server: label and
  annotation KEYS (optional lowercase-DNS-subdomain prefix ≤253, name part
  ≤63), label VALUES (≤63 bytes, empty allowed, alphanumeric with `-`/`_`/`.`,
  starting and ending alphanumeric), annotation values as arbitrary strings
  under a 262144-byte total, `metadata.name` as an RFC 1123 subdomain — and
  as an RFC 1123 LABEL for a Service, which may start with a digit but may
  not contain a dot — `metadata.namespace`, and every `matchLabels`,
  `nodeSelector` and Service `spec.selector` at any depth. It deliberately
  does NOT validate per-kind spec schemas: that is the OpenAPI schema of
  every kind rather than a small stable rule, a stdlib-only gate cannot carry
  it, and it is not the fatal direction — the one object whose absence IS
  fatal has its whole spec pinned against a literal. One deliberate
  over-refusal is stated rather than hidden: a null label value, which the
  server accepts and coerces to the empty string, is refused here rather than
  guessed at.
- Three shipped claims about what an installer does with a refused stream
  were FALSE against the real API server, and are now measured rather than
  reasoned about. `render-with-an-unspelled-document-boundary` does not
  "install nothing": it is a PARTIAL APPLY — all four objects created, THEN
  rc=1. `render-separated-by-a-document-end-marker` is worse still: rc=0,
  three objects installed, the Deployment after the `...` silently discarded,
  and with the policy rendered last behind that marker the workload installs
  with NO POLICY AT ALL and a green exit code. The same correction lands on
  the C1-control and value-key comments, which claimed whole-stream refusals
  where the server does a partial apply. The truth is a stronger reason for
  these refusals, not a weaker one: a silent partial install is more
  dangerous than a rejection, because nothing anywhere reports it.
- A kill battery over every guard clause rounds four and five introduced —
  each `_ascii_*` call site, `_document_marker`, `_read_document`, and every
  clause inside `_bs_indentation`, `_bs_breaks`, `_bs_skip_indent`,
  `_bs_has_more`, `_block_scalar_body` and `_line_break_after` — mutated one
  at a time, 84 mutants, each run against the whole unit suite AND the census
  gate. It found the surviving mutant PR #96's round-five review reported:
  dropping `_line_break_after(k)` from `_bs_breaks`'s loop survived both
  while diverging from PyYAML on 1,100 corpus members, because a final
  whitespace-only line with no trailing newline is the end of the stream and
  not a blank line, so keep chomping put back a break that was never there.
  78 mutants die to the existing suite and gate; nine more die to the tests
  added here; the remaining six are equivalent mutants proven so by
  measurement — identical values AND identical refusal messages over all
  182,170 corpus inputs and 29 targeted probes — and each is documented at
  its own clause with the reason it cannot differ, rather than pinned by a
  test no input could fail.

### Changed

- `chart-egress-pin.sh` renders with an explicit `--namespace` so the
  census can assert the namespace the policy landed in rather than inherit
  helm's default. `chart-ingress-pin.sh` is untouched by this change; its
  own blind spot is recorded below.

### Known gaps

- `scripts/ci/chart-ingress-pin.sh` still recognises the spec by a raw line
  exactly equal to `spec:` (`:103-105`), so the same-file shadow policy is
  invisible to it in isolation; it exits 0 on all four hostile charts the
  egress gate now refuses. Nothing ships weaker for it — both gates run in
  the same `chart` job, and the census refuses those renders — but the
  ingress gate's own census is a follow-up, tracked separately rather than
  quietly bundled here.

## [0.1.23] - 2026-08-20

### Fixed

- Releases publish again. GitHub added
  `require_extra_approval_for_unattributed_changes` to the live `Protect-Main`
  `pull_request` rule on 2026-08-20; the publisher's fail-closed settings
  preflight compares that rule's parameters for exact equality against
  `EXPECTED_PULL_REQUEST_PARAMETERS`, so the unknown field denied with
  `DENY: pull-request rule parameters are not exact` and 0.1.20, 0.1.21 and
  0.1.22 merged without ever being published (issue #91). The gate was right —
  the settings surface had drifted from the anchor — so the remedy is a
  deliberate re-anchor, not a weaker compare: the pin gains the field at its
  live value `True`, the stricter direction, under which a change not
  attributed to the pushing actor needs an extra approval. Every agent commit
  here is authored and committed as the owner's noreply identity and
  SSH-signed, so it is attributed and no flow changes.
- The closed-set discipline is unchanged in both halves, and that is the
  point: the compare still rejects a missing field, a wrong value, and the
  NEXT unknown field GitHub invents. `scripts/ci/test_release_contract.py`
  pins the exact live parameter object field for field and drives the real
  `observe_live_settings` path over the pre-fix shape (absent), the inverted
  shape (`False`), and a further-foreign-field shape — all three deny with
  that same message — while the corrected shape builds a receipt.
- The value-only readiness receipt carries the new field too
  (`build_settings_receipt` derives it; `validate_settings_receipt`'s closed
  schema requires it exact), so the owner-run `settings-receipt` check proves
  the setting offline rather than trusting the ruleset read alone.
  `docs/release-governance.md` moves in lockstep: the canonical receipt JSON
  gains the field, and the CI-proven column records both the pin and why a
  field GitHub adds is as fatal as one it drops.

## [0.1.22] - 2026-08-20

### Added

- CI now schema-validates `.github/dependabot.yml` and fails the PR on
  malformation (issue #59). `scripts/ci/dependabot_contract.py` is a
  stdlib-only (no PyYAML), fail-closed, indentation-based recursive-descent
  reader for the block-style YAML subset Dependabot configs need, followed
  by a semantic pass against this repository's contract: `version: 2`
  exactly; a non-empty `updates:` list of mappings; per-entry required
  `package-ecosystem` (checked against the documented ecosystem allowlist),
  `directory` (must start with `/`), and `schedule` (`interval` restricted
  to `daily`/`weekly`/`monthly`, with optional `day`/`time`/`timezone`);
  optional `groups:` (each group limited to `patterns`, `exclude-patterns`,
  `dependency-type`, `update-types`, `applies-to`, with `patterns`/
  `exclude-patterns` validated as non-empty string lists). Every level
  rejects unknown keys, duplicate keys, tabs, comments, and flow-style
  collections outright (fail-closed: unparseable is invalid), and every
  rejection names the offending line.
  `scripts/ci/test_dependabot_contract.py` (31 tests) proves it: the real
  `.github/dependabot.yml` passes; a hostile battery covers `version: 1`,
  a missing `schedule`, an unknown ecosystem, unknown keys at the
  top-level/entry/schedule/group levels, empty `updates`, tab indentation,
  a flow-style list, a non-mapping entry, and a duplicate key; and one test
  reproduces the exact `groups.svelte` `patterns:` -> `patternz:` mutation
  the PR #58 adversarial review proved SURVIVED every gate that existed at
  the time (mutants f/f2/g in that review's matrix) against a temp copy of
  the real on-disk file, showing the new gate goes red where the old one
  stayed green.
  `.github/workflows/pr-gate.yml`'s `security` job now discovers
  `test_*.py` (was `test_release_contract.py` alone, so the new suite runs
  in the same step) and separately invokes the validator against the
  repository's own config.

## [0.1.21] - 2026-08-20

### Added

- The boss-log panel becomes **Old School RuneScape Stats**: a skills grid of
  every level the hiscores report sits above the boss tallies, and the tally
  region claims the rest of the rail and scrolls inside itself. `boss-log/v1`
  gains an optional `skills` section (name, level, rank, xp, every figure
  nullable) — additive inside the same kind version, so a payload written
  before it existed still decodes. The panel id, kind, and URL are unchanged:
  they are public identity, and a heading is not.
- The complete icon set the panel always needed: **71 boss icons and 25 skill
  icons, 410,125 bytes**, all downscaled Old School RuneScape Wiki thumbnails
  shipped as files (`assetsInlineLimit: 0`). Sixty-five of the boss icons and
  the whole skills directory are new; the frontend pin that had to run
  one-directionally while sixty-five bosses rendered letter chips now runs in
  BOTH directions again — every served row has an icon, and every icon
  belongs to a served row. `ATTRIBUTION.md` records the batch, its byte
  count, the exact wiki file behind each row that does not name its own, and
  keeps the Jagex Fan Content Policy notice byte for byte.
- A force-refresh control replaces the `stale · 8d ago` badge in every panel
  header. `watchPanel` now returns a callable that also carries `refresh()`:
  a forced read is single-flight against the periodic one — a second press
  joins the request in flight instead of stacking behind it — and resolves
  only when that read lands, so the control is busy for exactly as long as
  the origin is. No honesty left with the badge: the status still drives a
  dot whose shape differs per state, and the full reading rides the button's
  accessible name and its tooltip.

### Changed

- Live refresh is reachable from a deployment for the first time.
  `chart/templates/deployment.yaml` renders `PANELS_REFRESH` from a new
  `panels.refresh.enabled` value — **unconditionally**, so the deployed state
  is readable off the manifest — defaulting to `false` and required by
  `chart/values.schema.json`, so a values file that omits the decision fails
  validation instead of letting the origin guess. Nothing is enabled
  anywhere: the egress allowance the switch also needs is issue #79.
- The upstream refresh TTL drops from 45 minutes to 5 (`ttlMinutes`), putting
  the origin inside the same 30s–5m freshness band the client poll already
  sat in; the backoff ladder is unchanged and is now pinned to stay outside
  that band, so a failing upstream still backs off past the healthy cadence.
- All three panel snapshots that can be regenerated without secrets were
  regenerated from fresh captures taken at cut time: `boss-log.json` (25
  skills, 71 bosses) and `vcs-activity.json` (53 weeks, 499 contributions),
  with their `testdata` captures replaced in the same commit so the
  snapshot-equals-capture pins still close the loop. `token-usage.json` needs
  admin credentials and is unchanged.

### Fixed

- The five confirmed layout collisions between fixed chrome and page content.
  Arbitration is now one ordered `--layer-*` scale in `styles.css` (base <
  activity < rail < menu) instead of three components that had each picked
  `10` or nothing, so the reading-mode control can no longer be buried under
  the side rail. The rail publishes its open state on the document root and
  the page reserves an inline gutter for it above 60rem; the activity bar
  publishes the strip it covers, bounds itself by that same token so it can
  never outgrow the reserve, and flows in the document below 45rem where a
  fixed bar has nowhere to go.
- Rendering-lane floors (issue #26): `100vh` is gone from `styles.css` in
  favour of `100dvh`, with a frontend pin that refuses the static spelling
  anywhere in the file; the viewport meta opts into `viewport-fit=cover` and
  every fixed element pads itself by the `env(safe-area-inset-*)` values, so
  the rail, the bar, and the reading-mode control all clear a notch and a
  home indicator. The hero gives the activity bar's reserve back, so a page
  with nothing below it is still exactly one viewport tall.

## [0.1.20] - 2026-08-20

### Security

- The release publisher gates before it signs. The HIGH/CRITICAL final-image
  scan now runs immediately after digest resolution and BEFORE `cosign sign`
  and the SLSA attestation step, matching the sibling repository's
  arrangement. Previously the publisher signed the digest, attached
  attestations, and only then scanned, so run 32195803008 (v0.1.15) put a
  vulnerable image — 8 HIGH Go 1.26.5 standard-library CVEs — into GHCR
  carrying this repository's release identity. The gate did not refuse that
  digest; it was never reached. The Actions record for that run shows step
  14 sign success, step 15 attest failure, step 16 gate SKIPPED, so under
  the pre-fix order the gate protected no signature under any observed
  outcome.
  A gated-out digest is now never signed: it stays an unsigned pushed alias,
  which the artifact classifier reads as `burned` and the digest resolver
  refuses as unpublishable.

### Fixed

- The publisher's step-order contract had no opinion on signing at all. Its
  ordering chain pinned `registry < scan < alias < manifest < Release <
  terminal`, and the literals `Sign the immutable image digest` and
  `Attach the BuildKit SLSA provenance` appeared nowhere in the contract
  suite, so the sign-then-gate publisher satisfied every assertion. The
  chain now pins `registry < digest < scan < sign < attest < alias <
  manifest < Release < terminal`, requires exactly one step of each of
  those three names, and refuses any conditional on the gate so a
  reused `complete` digest is still rescanned against the current
  vulnerability database. Step headings are not the property, so the
  contract binds signing side effects instead: it parses the `publish` job
  into normalized, execution-ordered step objects and requires that no
  signing-capable command (`cosign sign`, `cosign sign-blob`,
  `cosign attest`) runs at or before the gate, that the resolved image
  digest is signed exactly once across every run block, and that the one
  image-signing command belongs to the pinned post-gate step. Mapping keys
  are normalized before any key-based check, because `if :` and `"if":` are
  live conditionals the Actions runner honors and a raw `^        if:`
  regex does not see. Nine hostile mutants prove it: the gate restored
  below signing (the exact pre-fix workflow), the gate deleted, the gate
  made conditional on a fresh build, a duplicated second gate copy, a
  renamed step signing the resolved digest before the gate, the gate made
  conditional in the `if :` and in the quoted `"if":` spelling, an
  attestation hoisted above the gate under another name, and a second image
  signature placed outside the pinned step.
- The same fail-open spelling class is closed everywhere it appeared rather
  than only on the gate. An absence assertion matched against raw indented
  text passes whenever the spelling shifts, so the pr-gate `security` job's
  "may not be conditionally skipped" pin and the publisher
  `immutable_settings` job's "must not export its App token" pin now read
  normalized keys too, each proven by `if :`/`"if":` and
  `outputs :`/`"outputs":` mutants. The three presence assertions nearby
  (`tags:`, `sbom:`, `timeout-minutes:`) already failed closed under the
  same attack and are unchanged.
- The artifact classifier pins the residue a denied gate now leaves —
  present, provenance- and SBOM-matched, unsigned, zero attestations —
  as `burned`, so a consumed tag needs an operator instead of a silent
  republish over a vulnerable digest.

## [0.1.19] - 2026-08-20

### Security

- The application NetworkPolicy now denies every outbound connection. It
  declares both `Ingress` and `Egress` policy types over an exactly empty
  `egress: []` rule list, so a Pod rendered from this chart has no outbound
  network access at all. Previously the policy declared `Ingress` only:
  Kubernetes applies egress rules exclusively to policies that name `Egress`
  in `policyTypes`, so the workload retained unrestricted outbound
  connectivity no matter what the manifest looked like. The ingress
  peer/namespace/port contract is byte-for-byte unchanged.
- New structural gate `scripts/ci/chart-egress-pin.sh`, wired into the
  `chart` job of the PR gate beside the ingress pin. It extracts
  `spec.podSelector`, `spec.policyTypes`, and `spec.egress` from the real
  render by indentation and compares each whole sub-tree against a pinned
  literal, so an added rule, peer, port, DNS exception, duplicate key, or
  flow-style rewrite fails in block or flow style. Its expectations are
  constants rather than values read back out of the template under test —
  "no outbound connection, ever" is not configuration, and an oracle derived
  from the implementation passes for any implementation.
- The gate proves its own refusals: 19 hostile mutations are applied to the
  real render and fed back through the same checker, which must reject every
  one — omitted `Egress` policy type (the inert-policy trap: `egress: []`
  that Kubernetes never applies), omitted `policyTypes`, omitted egress key,
  `{}`, `- {}`, `0.0.0.0/0`, `::/0`, ports-only, a port 53/UDP DNS
  exception, `namespaceSelector` and `podSelector` peers, inline `[{}]`,
  non-canonical `[ ]`, a duplicate `egress` key, inline `policyTypes`, a
  wrong-app selector, a dropped instance label, an empty `podSelector`, and
  a second shadow document. A pinned floor fails the build if the battery is
  ever shrunk. The gate additionally renders under every value override the
  schema admits and requires the egress answer to be identical, so the deny
  is unconditional rather than a default (requirement 4).
- README's live-refresh enablement step 3 now states what the chart actually
  does. It claimed the NetworkPolicy was "ingress-only today" while
  concluding that refresh attempts fail with policy unchanged; the first
  half is no longer true and the second half is now true because of it.

## [0.1.18] - 2026-08-19

### Fixed

- Raw SBOM statement binding pins the in-toto type BuildKit actually
  emits: `SBOM_STATEMENT_TYPE` moves from
  `https://in-toto.io/Statement/v0.1` to `https://in-toto.io/Statement/v1`.
  Proven live by the first v0.1.17 publish attempt (run 32208827873): every
  earlier release attempt died before the SBOM re-bind step, so this pin
  had never met a real BuildKit statement — the fixture built its
  statement FROM the module constant, a self-referential oracle that
  passes under any value. The raw statement fetched from the registry for
  the v0.1.17 image carries `_type: https://in-toto.io/Statement/v1`
  (predicateType, subject purl, platform query, and digest binding all
  already exact). This is the opposite polarity from the cosign-generated
  attestation statement, which correctly remains pinned at v0.1
  (`INTOTO_STATEMENT_TYPE`, the value cosign emits, proven live in the
  same run): two generators, two separate constants, opposite correct
  values. A new literal-pin test
  (`test_sbom_statement_type_literal_is_the_pinned_in_toto_v1_uri`)
  guards the constant against silent reversion — the vacuity the
  self-referential fixture allowed — and the statement-mutant matrix now
  rejects the old `v0.1` value, proving exactness in both directions.
  The weekly release audit shares the same `sbom-statement` subcommand,
  so both the publisher and the audit converge on the real emission.

## [0.1.17] - 2026-08-19

### Fixed

- The release publisher's draft-observe loop could never see its own draft
  (#71): `classify_release`'s by-tag GET (`GET .../releases/tags/${tag}`) is
  documented to return a PUBLISHED release only, so the retry loop after
  `gh release create ... --draft` read a permanent 404 ("absent") and denied
  when `test "${race_verified}" = true` failed — the resumable-draft design
  was unreachable as written. lidersea.com proved this live (run
  32201373323, v0.1.16): the draft's manifest, image, and chart were all
  complete and correctly signed, but the Release object itself was
  stranded `draft: true`. Fixed by keeping the by-tag GET as the first
  probe and, only on its 404, adding a list probe
  (`GET .../releases?per_page=100`) that selects `tag_name == TAG`: exactly
  one match writes that object into the same `existing-release.json` file
  `classify_release` and `verify_asset_bytes` already consume and
  reclassifies through the unchanged `release-state` CLI; zero matches keep
  the original absent classification; more than one is refused (`DENY: ...
  a stranded draft needs operator resolution`, exit 1) rather than guessed
  at, since GitHub only lets multiple Releases share a `tag_name` when none
  of them is the published owner of that ref. `release_contract.py`'s
  `classify_release_state` needed no change: it already classifies
  correctly from either a by-tag or a list-selected object, since GitHub
  returns the same Release shape either way. This repo's own v0.1.16
  publish attempts never reached this step live — they died earlier, first
  on the cosign predicate defect this changelog's 0.1.16 entry fixed, then
  on the trivy defect below — so the fix lands from the shared code shape
  and lidersea's live proof rather than a local reproduction.
- Closes the mutant-proven gap in `WorkflowStructureTests` (#70):
  `require_vulnerability_and_alias_audit`'s `audit_requirements` pinned
  `attestation-statement` for `release-audit.yml` but not the
  `--predicate-output` flag that makes it write the exact object cosign
  signs, so deleting that flag from the audit workflow survived the full
  suite while the identical deletion on the publisher side was already
  caught. The flag is now a pinned literal for both surfaces, with a
  hostile mutant proving the audit-side deletion goes red.
- The release publisher's and recurring audit's final-image vulnerability
  gate had never executed (#73): both `trivy image --scanners vuln
  --include-dev-deps ...` invocations FATAL on the installed trivy
  (`unknown flag: --include-dev-deps` — a source/lockfile concept `trivy
  fs` understands, not one `trivy image` accepts), proven directly by this
  repo's own v0.1.16 publish attempt (run 32203707053, step "Reject high or
  critical vulnerabilities in the final image digest"). Because the step
  ordering signs before scanning (#69), this left ghcr.io holding
  signed-but-never-scanned images at v0.1.15 and v0.1.16. Fixed by dropping
  the flag from both `trivy image` call sites (`release-publisher.yml`,
  `release-audit.yml`); `pr-gate.yml`'s `trivy fs --include-dev-deps` source
  scan is unaffected — the flag is valid there and unimplicated by the
  failure. `WorkflowStructureTests` now pins the flag-free invocation on
  both surfaces and explicitly forbids `--include-dev-deps` from
  reappearing on either `trivy image` line; the two hostile mutants that
  previously asserted the opposite (that removing the flag was the
  regression) are replaced with mutants proving reintroducing it is
  caught.
- Chart rollout strategy swaps pods in place instead of surging (#72): the
  namespace quota (`pods: 2`, `limits.memory: 256Mi`) leaves no room for a
  third pod once `replicaCount` is at its default/maximum of 2, so
  `maxSurge: 1` could never schedule its new pod — cluster-proven during
  the lidersea.com v0.1.16 deploy, where the controller filled the quota by
  scaling the OLD ReplicaSet to 2 first (holding the `maxUnavailable: 0`
  floor) and wedged the rollout permanently. `maxSurge: 0` /
  `maxUnavailable: 1` is now the only rolling path at 2 replicas, and works
  cleanly at 1 too. No existing test or pin in this repository asserted
  the old strategy values (verified by a full-repository grep for
  `maxSurge`/`maxUnavailable`/`rollingUpdate`); `helm lint` and a rendered
  `helm template` grep are this change's evidence.
- `replicaCount` accepts 1..2 instead of a fixed `const: 2` (owner
  directive 2026-08-19, mirroring lidersea.com commit `bab253b`):
  workloads should not be scale-rigid, and the cluster doubles as the dev
  environment, so the schema now expresses the namespace quota's real
  budget (`minimum: 1`, `maximum: 2`) rather than a single fixed shape.
  Default stays 2 for availability; `chart/values.yaml` carries the same
  head comment as lidersea.com explaining the range. `maxSurge: 0` /
  `maxUnavailable: 1` above roll cleanly at either value. Verified:
  `helm template` renders at `replicaCount=1` and the unset default
  (`2`); `replicaCount=3` is rejected by schema validation.

## [0.1.16] - 2026-08-18

### Fixed

- The release publisher's "Attach the BuildKit SLSA provenance as cosign
  attestations" step could not pass either: run 32195803008 advanced past
  0.1.15's settings fix, signed the image
  (`sha256:2fe2171286418d0be4f0ad36ac792e9f0edc2dce5922442a8afdc5605fbc94f8`),
  and then denied with `predicate cannot be empty`, burning tag v0.1.15.
  The pinned cosign v3.1.3's `attest` (`cmd/cosign/cli/attest/attest.go`)
  unconditionally requires `PredicatePath` before it looks at anything
  else; `--statement` parses as a flag but is never read anywhere in
  `attest`'s execution path, so `cosign attest --yes --statement
  "${statement}" ...` could never have signed anything.
- The fix signs the release-bound MODIFIED PREDICATE through the flag
  cosign actually consumes, with the predicate-type URI passed literally
  rather than through the `slsaprovenance1` alias: `cosign attest --yes
  --predicate "${modified_predicate}" --type
  "https://slsa.dev/provenance/v1" "${IMAGE}@${DIGEST}"`. The alias
  resolves, via `cmd/cosign/cli/options/predicate.go`'s
  `PredicateTypeMap`, to cosign's typed SLSA decoder
  (`protojson.UnmarshalOptions{DiscardUnknown: true}`), which would have
  silently dropped BuildKit's `runDetails.metadata.buildkit_metadata` and
  `buildkit_completeness` before signing. Our injected
  `buildDefinition.internalParameters.release` binding survives either
  path — `internalParameters` is typed as a `google.protobuf.Struct`,
  which protojson's unknown-field discarding never reaches — but the
  literal URI is still the correct choice: losing the two BuildKit fields
  alone already breaks this step's later exact-statement comparison, and
  the literal URI instead takes cosign's generic/custom path, which embeds
  the predicate verbatim rather than dropping anything. Both paths set the
  signed statement's envelope `_type` to `https://in-toto.io/Statement/v0.1`
  (`in_toto.StatementInTotoV01` upstream), never the `.../Statement/v1`
  this repo previously expected and cosign never actually emitted, so
  `INTOTO_STATEMENT_TYPE` in `scripts/ci/release_contract.py` now matches
  reality. The existing `cosign verify-attestation --type slsaprovenance1`
  calls are unchanged: that alias resolves through the identical
  `PredicateTypeMap` to the same `https://slsa.dev/provenance/v1` URI used
  for signing, and verification filters on `predicateType`, never the
  envelope `_type` — confirmed directly against cosign's
  `pkg/policy/attestation.go`.
- `attestation-statement` now also writes the modified predicate to a
  required `--predicate-output` path — the exact object cosign embeds —
  threaded through both the existing-image classification loop and the
  signing loop, so a previously-published and a freshly-signed image are
  verified identically. Reproduced locally end-to-end against the burned
  v0.1.15 digest with the pinned cosign v3.1.3: the old `--statement`
  invocation still dies with `predicate cannot be empty`; the new form,
  driven by this fix's own `attestation-statement` output, clears predicate
  loading, statement generation, and digest resolution, and fails only at
  a deliberately-invalid `--identity-token deadbeef` with `open deadbeef:
  no such file or directory` — the first failure a real GitHub Actions
  OIDC token clears.

### Security

- Go toolchain bumped 1.26.5 -> 1.26.6, remediating 8 HIGH-severity (zero
  CRITICAL) Go standard-library CVEs that lidersea.com's v0.1.15
  release-publisher run surfaced via its Trivy vulnerability gate:
  CVE-2026-33818 (`encoding/asn1` DoS), CVE-2026-39821 (`net/http` IDNA
  punycode), CVE-2026-46600 (`dns/dnsmessage` DoS), CVE-2026-56853
  (`net/http` h2c DoS), CVE-2026-56858 (`html/template` XSS), CVE-2026-56859
  (`encoding/xml` DoS), CVE-2026-56860 (`net/url` DoS), and CVE-2026-56862
  (`crypto/tls` KeyUpdate DoS). naranjo.online builds with the identical
  pinned Go 1.26.5 toolchain as lidersea.com, so its own just-triggered
  v0.1.15 publisher run was expected to fail the same gate; this bump is
  the remediation either way.
- The pin moves everywhere it is asserted, with no application code
  changes: `go.mod`'s `toolchain` directive (`go 1.26.0`'s language-version
  floor is unchanged), the Dockerfile's `golang:1.26.6-trixie` builder stage
  (digest re-pinned to the new image), the `go-version` inputs in
  `.github/workflows/codeql.yml` and `.github/workflows/pr-gate.yml`, and
  `pr-gate.yml`'s `go env GOVERSION` verification step. `AGENTS.md` and
  `README.md`'s toolchain callouts move with it so the documented pin never
  lags the enforced one.

## [0.1.15] - 2026-08-18

### Fixed

- The release publisher's `immutable_settings` job still could not pass after
  0.1.14 re-anchored the merge-method proof: run 32188959219, dispatched at the
  0.1.14 merge commit, advanced past every previously failing layer and then
  denied with `DENY: Protect-Main bypass actors must be a JSON array`. The
  sibling repository's identical code family denied the same way in run
  32188071417. `build_settings_receipt` in `scripts/ci/release_contract.py`
  read `bypass_actors` off the `Protect-Main` ruleset detail, but GitHub's REST
  reference for "Get a repository ruleset" states that "to prevent leaking
  sensitive information, the bypass_actors property is only returned if the user
  making the API request has write access to the ruleset". The job's App token
  holds `permission-administration: read` and no ruleset write access, so the
  property is absent from its response and the read denied unconditionally —
  and it denied before `rules[]` was parsed, so 0.1.14's re-anchored
  merge-method derivation had never once executed under the CI credential.
- The receipt no longer reads or carries `bypass_actors`, matching 0.1.14's
  philosophy: CI asserts exactly what the enforcing surface exposes to the CI
  credential, with no conditional assertion and no credential-dependent branch.
  `validate_settings_receipt`'s closed field set drops the key with it, so a
  dangling bypass field is foreign and fails closed.

### Changed

- `docs/release-governance.md` now records which release-control invariants are
  CI-proven and which are owner-verified, quoting GitHub's field visibility
  rule verbatim. Bypass-actor emptiness moves to the owner-verified column and
  that column carries the standalone GET-only `gh api` command that discharges
  it, star-witnessed like the rest of the runbook. The deleted read is
  credential-independent, so the preflight itself reads the property for
  nobody and re-running it proves nothing about bypass actors; the requirement
  remains a Ready gate at step 8 of "Working a change end to end" and is now
  performed by a command that can actually fail. `AGENTS.md` (requirement 10,
  merge readiness, step 8) and `README.md` stop saying the receipt proves it.
  The runbook's 2026-08-14 ruleset-inexactness note is corrected against
  owner-observed 2026-08-18 state. CI cannot see the field and no longer
  pretends to.

## [0.1.14] - 2026-08-18

### Fixed

- The release publisher's `immutable_settings` job could never pass, so no
  release has been published since v0.1.9 even though `main` advanced to
  0.1.13. `build_settings_receipt` in `scripts/ci/release_contract.py`
  derived the receipt's `merge_methods` from the repository record's
  `allow_merge_commit` / `allow_rebase_merge` / `allow_squash_merge`
  booleans, but the job mints a GitHub App token holding only
  `permission-administration: read`, and GitHub returns those booleans
  only to credentials that also carry Contents write ("To view
  merge-related settings, you must have the contents:read and
  contents:write permissions"). Every run therefore denied with
  `DENY: repository setting allow_merge_commit is not boolean` before any
  publication side effect. The receipt now derives `merge_methods` from
  the active `Protect-Main` ruleset's `allowed_merge_methods` — the
  control that actually enforces merge behaviour on `refs/heads/main` and
  one the least-privilege token can read. The receipt's external shape is
  unchanged, the pull-request rule's parameters remain pinned exactly, and
  the downstream receipt validator still requires exactly rebase and
  squash, so the fix restores publication without relaxing any control or
  widening the publisher's credential.

## [0.1.13] - 2026-08-18

### Changed

- `AGENTS.md` catches up to owner directives its prose predated:
  - Requirement 3 and the commit-identity-mechanics section no longer
    hardcode a single fixed signature (`- Fable5`); the acting agent
    signs its own commits, PR bodies, and issue bodies, exactly matching
    its agent label in the roster (`- Fable5` ↔ `fable5`, `- Sonnet5` ↔
    `sonnet5`, `- Opus5` ↔ `opus5`, `- 5.6 Sol` ↔ `5.6-sol`). This
    supersedes the single-signature owner attribution decision of
    2026-08-10, corrected by the re-tiering directive of 2026-08-18
    (routes simple/dependabot work to lighter models) and evidenced by
    merged precedent #56, the first PR signed under the corrected rule.
  - The agent-labels roster gains `sonnet5` (Claude Sonnet 5, color
    `0EA5E9`) — the label already existed server-side; the roster text
    lagged it.
  - Commit identity mechanics gains a new bullet documenting per-command
    SSH commit signing with the owner-registered Mac key (`git -c
    gpg.format=ssh -c user.signingkey="key::$(ssh-add -L | grep
    ssh-ed25519)" commit -S`), never via `git config`; the owner
    registered the key as a GitHub signing key on 2026-08-18, and
    signature enforcement on `main` is a protected-branch setting so
    non-Mac owner merges stay unblocked.
  - The Dependabot bullet documents the lockstep-pair practice already
    twice-proven in this repository: when Dependabot splits a
    version-locked pair into separate PRs (precedents:
    `github/codeql-action` `init`+`analyze`, #53/#54; `svelte`+
    `svelte-check`, #51/#52), one agent PR supersedes both and fixes the
    root cause in the same commit via a `dependabot.yml` `groups:`
    stanza (merged precedents #56, #58).
  - The branch-prefix example generalizes from the single hardcoded
    `fable5/<topic>` to `<lane>/<topic>`, with live examples.
  - No behavioral, requirement-numbering, or gate change; the prose now
    matches what the roster, the label API, and two merged PRs already
    do.

## [0.1.12] - 2026-08-18

### Changed

- `svelte` and `svelte-check` move together from 5.56.8 to 5.56.9 and from
  4.7.5 to 4.7.6 respectively in `frontend/package.json` (and their lockfile
  entries, including the transitive `@sveltejs/load-config` bump to 0.2.3
  that `svelte-check` 4.7.6 requires). Dependabot had opened the two bumps
  as separate PRs (#51, #52); `svelte` and `svelte-check` are a compatibility
  pair released in lockstep, and this repository's practice is to bundle
  such pairs into one PR rather than merge them independently. This release
  lands both bumps in one commit. `.github/dependabot.yml` gains a `groups`
  stanza on the `npm` ecosystem scoped to `svelte` and `svelte-check`, so
  future coordinated releases of this pair arrive as one grouped PR instead
  of two.

## [0.1.11] - 2026-08-18

### Changed

- `github/codeql-action/init` and `github/codeql-action/analyze` move
  together from 4.37.6 to 4.37.7 (full-SHA pinned, version comments
  updated) in `.github/workflows/codeql.yml`. Dependabot had opened the two
  bumps as separate PRs (#53, #54); because both actions are pinned in the
  same workflow and CodeQL requires `init` and `analyze` to run the same
  released version, merging either alone fails CI with a configuration/
  runtime version mismatch. This release lands both bumps in one commit.
  `.github/dependabot.yml` gains a `groups` stanza on the `github-actions`
  ecosystem scoped to `github/codeql-action*`, so future coordinated
  `codeql-action` releases arrive as one grouped PR instead of two
  mutually-blocking ones.

## [0.1.10] - 2026-08-13

### Added

- Every protected-main merge now carries and publishes its own immutable
  semantic patch release. Pull requests (including docs and dependency
  updates) must advance the four committed source locks by exactly one patch
  from their protected base. Successful main CI is bound to its exact source
  SHA, creates the plain version tag, and explicitly dispatches the publisher
  definition from protected `main` without relying on recursive tag-push
  events. The dispatch carries the authoritative completed-run ID; a separate
  read-only job validates the exact successful PR-gate push, its closed job
  inventory, and the separate exact-SHA CodeQL main run/job inventory before
  the write/packages/OIDC job can start, so manual unmerged source, aggregate
  success with a skipped job, and stale CodeQL evidence are denied. Rapid merges have
  independent release paths; exact complete artifact state is retryable, while
  partial, foreign, or conflicting immutable state fails closed as burned.
  Both enabled owner merge modes are executable release paths: one-commit
  squashes and multi-commit linear rebases validate the exact base-to-final-tree
  patch transition without dropping the final source SHA.
  The change must remain Draft until a GET-only owner preflight proves GitHub
  immutable releases enabled plus exact GitHub-Actions-bound, strict
  current-base required checks with no ruleset bypass or update restriction.
  Source dependencies including frontend development dependencies and the final
  image digest are scanned for high/critical vulnerabilities with a
  checksum-pinned Trivy binary. Immediately before manifest construction, the
  publisher re-resolves the actual image/chart aliases to the produced digests
  and validates the strict raw two-platform SBOM schemas and subjects. Created and reused
  Releases must bind exact metadata and one deterministic evidence manifest.
  New publication stages a draft, verifies the manifest REST digest and bytes,
  then publishes; a terminal REST/asset re-read binds the immutable Release,
  manifest, and now-locked annotated tag to the exact signed source. A weekly
  read-only audit rechecks aliases, signatures, provenance/SBOM, chart source,
  and vulnerabilities as later detection rather than publication proof. A move between the initial tag check and Release
  publication fails closed. Ready additionally requires the canonical
  exact-head Main Worker bounded receipt,
  independently of the adversarial implementation approval.
  Git/image/Release tags use one plain `vX.Y.Z`. Helm's documented exception
  stays numeric `X.Y.Z` because its OCI tag must equal valid chart SemVer.
  `tag@sha256:digest` is a deploy reference, never a tag.

- The chart now says which release is running. Every rendered object carries
  `app.kubernetes.io/version`, derived from the chart's own `appVersion` so no
  override can make the label disagree with the chart that emitted it, and the
  workload reference renders as
  `ghcr.io/snaraj/naranjo-online:vMAJOR.MINOR.PATCH@sha256:<hex>`. Before this,
  `kubectl describe pod` answered "what is running" with a bare digest and the
  Pod carried no version at all.

  The digest did not move and is not optional: Kubernetes still resolves it,
  cosign and the platform's admission policies still verify it, and the values
  schema requires it alongside the tag (requirement 10). The tag is legibility
  only. The gate's version lock gains a fourth leg — VERSION, chart `version`,
  `appVersion`, and the image tag now move together — plus a render assertion
  that the emitted reference still carries a full digest. New doctrine pins in
  `internal/doctrine/release_identity_test.go` hold all of it, including that
  no selector ever matches on the version label, because selectors are
  immutable and a version-scoped selector stops matching one release later.

- A zero-secret GitHub contribution producer for the version-control panel
  (#41): the public, unauthenticated contributions document is fetched and
  scanned into the calendar the panel already rendered. Exact daily counts
  come from the document's own label elements, not from its coarse level
  attribute, and the scanner fails closed on markup drift — a refused
  document keeps the last good payload serving as stale.
- `vcs-activity/v1` gains `endDate` additively: the final week is padded to
  seven days like every other, so without an anchor the padding is
  indistinguishable from genuine quiet days. The frontend now draws days past
  it as labelled holes.
- Per-endpoint request byte caps. Each spec may declare a `maxBytes`, which is
  validated to be at or below the shared bound, so a per-endpoint value can
  only ever tighten and never widen.
- The version-control calendar renders through `ContributionGrid`, the same
  component the token panel's activity heatmap uses.
- Panels refresh themselves while a visitor watches (#40). `watchPanel` in
  `frontend/src/lib/panels.ts` re-reads each panel envelope on a 60s cadence
  and every panel now mounts through it; `watchClock` ticks the freshness
  badge so a rendered age keeps telling the truth instead of freezing at the
  mount instant. A hidden tab is not polled at all and catches up the moment
  it is shown, at most one read per panel is ever in flight, and stopping a
  watcher ends delivery even from a read already in flight. Every timer,
  transport, and visibility read is injected through one host seam, so the
  loop is executed by tests rather than described by them.
- Token-usage panel rebuilt to the owner's referenced surface (#40): a
  headline tile grid (a final odd tile spans the row), the usage windows with
  their meters, a "Token activity" section whose Daily / Weekly / Cumulative
  segmented toggle re-reads ONE daily series through three lenses with no
  extra payload, and an "Activity insights" list.
- `token-usage/v1` gains `account`, `stats`, `series`, and `insights` —
  additively, inside the same kind version: every field is optional, and a
  payload written before they existed still decodes and still renders. Stats
  and insights carry a `recorded` flag, so a figure captured out of band
  says so instead of borrowing the panel's live freshness.
- `ContributionGrid.svelte` plus `lib/grid.ts`: one contribution-heatmap
  implementation, a month axis, a five-level ramp shipped as themeable custom
  properties, and days outside the window rendered as labelled holes rather
  than as zeros. The token-activity grid renders through it today and the
  version-control calendar follows, so the two can never drift.
- README and AGENTS.md document the reviewed prerequisites for enabling live
  panel refresh in a cluster, and state that the enablement itself is a
  separate owner-reviewed step.
- Release publisher attaches the BuildKit SLSA v1 provenance as keyless
  cosign attestations (`slsaprovenance1`) on the immutable image digest,
  immediately after image signing — one per architecture, each read back
  from the just-pushed index and re-asserted about the index digest the
  deployment references, over a platform set derived from the index and
  asserted to equal the build's exactly. Each predicate is bound to this
  release before it is attached (this repository's source, this tag's
  commit, an Actions run of this repository) and the two are required to
  differ; the step then verifies its own attestations under this
  workflow's identity, so a release whose attestations are not
  discoverable or verifiable fails in the publisher rather than later at
  promotion. Cosign normalizes the predicate on attach, dropping
  BuildKit's `buildkit_metadata` and `buildkit_completeness` — the
  attestation is a lossy copy, and the index-embedded provenance remains
  the authoritative content evidence. No new permissions, actions, or
  skip paths, and the job's unused `attestations: write` grant is
  dropped; effective from the next tagged release. Completes this site's
  precondition for the platform promotion ratchet
  (website-infrastructure#58).
- Version-control activity status bar (#19): a fixed strip rendering
  the `vcs-activity/v1` panel inside the shared PanelShell — a per-day
  contribution heatmap (five-level single-hue cell ramp shipped as
  themeable custom properties with validated dark-native defaults),
  contribution total and current streak, and the latest commits — fed
  exclusively through the same-origin panel data layer. Geometry is
  fixed per region so data arriving never shifts layout, a wide window
  scrolls inside the strip rather than the page, an admission-refused
  or absent payload renders an explicit empty state, and the data's
  origin is never named in frontend source (pinned by test alongside
  the strip's local-origin scan).

### Changed

- **The shared per-request read bound is RAISED, 262144 -> 524288 bytes.** The
  contribution document is markup around a small amount of data and does not
  fit under the old bound. Stated plainly because an earlier draft of these
  notes described this change as tightening, which was wrong: the shared
  ceiling went up. What each endpoint may actually read is now
  hiscores 65536 (down from 262144), version-control 524288 (new), and each
  usage endpoint 262144 (unchanged) — so the aggregate a hostile set of
  upstreams could make this process hold at once moves
  **768 KiB -> 1088 KiB**. The bound is now pinned by a ratchet-style test at
  or below 524288, so raising it again is a conscious edit with a reason.
- **Host allowlist: `github.com` added** (now four hosts). Security-sensitive
  by definition, so: exact host match, https only, checked at construction
  AND again at request time, bounded by its own byte cap and the shared
  timeout, redirects refused outright, and no credential is read on this path
  at all. Tests pin the list in both directions, including that
  `api.github.com`, `raw.githubusercontent.com`, and
  `github.com.evil.example.test` are all refused.
- The boss grid renders the complete table: thousands-separated counts,
  `Unranked` where the hiscores return rank `-1`, muted unranked tiles, and
  its own internal scroll so a rail stays a rail.
- The vendor-name doctrine pin now also covers the version-control host, so
  the compiled binary stays uncoupled from where the calendar comes from.
- `frontend/tsconfig.json` enables `allowImportingTsExtensions`: Node's
  type-stripping test runner resolves specifiers literally, so a value import
  between two `src` modules must carry its extension to be testable at all.
- The live usage window widens from 7 to 30 daily buckets (`limit=31`,
  `lookbackDays=30` in `internal/panels/config/fetch.json`) so the activity
  grid has a month to draw. Pagination is still not implemented, so a month
  is the ceiling one request can deliver.
- `GO_COVERAGE_FLOOR` ratchets 91.1 -> 93.2 (measured 96.2 on this branch).

### Fixed

- The boss log serves EVERY boss the hiscores report — 71 for the configured
  account — instead of the six that were enumerated in config (#41). The
  direction is inverted on purpose: config now names the NON-boss activities
  (clue tiers, minigame ranks, point totals) and everything else the upstream
  reports is served in upstream order, so a boss Jagex ships tomorrow appears
  on its own instead of being silently dropped until somebody edits a list.
- The boss log's live refresh could never have worked. The upstream document
  is `{name, skills, activities}` and the shipped grammar declared only two
  of those three, so the strict decoder rejected every response on the
  unknown `name` field and the panel could only ever serve its snapshot. The
  grammar is completed and pinned against a REAL captured response.
- The shipped boss figures were invented and wrong (Zulrah 1408 against a
  real 1192, Chambers of Xeric 118 against a real 10, and so on). The
  snapshot is now generated from the captured upstream response, and a test
  fails if the two ever disagree.

### Removed

- The fabricated version-control payload — five weeks of invented counts, an
  invented streak, and three invented commit rows. The calendar is now real;
  the commit rows are an empty list, because the contributions document
  carries none and inventing them is exactly the defect being removed. A
  commit producer is a separate piece of work with its own allowlist
  question.
- The invented figures in `snapshots/token-usage.json`. Nothing in the
  repository could support them, and the "honest states" floor forbids
  fabricated data outright. The snapshot now carries only recorded, dated
  values for the source that has them, and the other source renders its
  explicit empty state until live refresh is enabled or the owner records an
  export. This is a deliberate, visible loss of fake content.

### Security

- The chart's ingress NetworkPolicy can finally express the **whole peer
  identity**. It admitted a peer by namespace and `app.kubernetes.io/name`,
  which are the only peer facts the values exposed — but the peer namespace is
  shared by several per-site connectors that carry the same app name and
  differ only by `app.kubernetes.io/instance`. A name-only selector therefore
  admitted every connector in that namespace, not just this site's. The
  deployed policy was hand-tightened with the instance pin (dated observation,
  2026-08-11; revalidate read-only before relying on it), so applying the
  chart as it stood would have WIDENED what is running — a security regression
  delivered by a routine release rather than by a bad edit. `ingress` now
  carries `peerInstance`, defaulting to this site's own connector so the safe
  policy is the out-of-the-box render, and `values.schema.json` requires it
  non-empty: a blank or absent instance fails validation instead of rendering
  an unpinned policy. `scripts/ci/chart-ingress-pin.sh` renders the chart in
  the PR gate and proves all three properties — the default pins
  namespace + app name + instance byte for byte against the values, blank and
  absent are both refused, and moving the instance moves the pin while the app
  name stays put, which is exactly why the app name alone cannot tell two
  connectors apart.
- Outbound endpoints are **https only**. Plain `http` was previously tolerated
  by endpoint validation; the same allowlist governs the credential-bearing
  usage endpoints, so a cleartext hop would have put a credential on the wire.
- Outbound endpoints may carry **no userinfo**. `https://user:secret@host/x`
  is a credential in a URL — the same class of exposure — and config data is
  not where one belongs. Scheme, userinfo, and host are now one admission
  rule, applied at construction AND again at request time.
- The public version-control producer may send **only an `Accept` header**. It
  carries no credential field, but a free-form header map was a general escape
  hatch: config data could have attached an `Authorization` header to a
  producer this repository documents as unauthenticated. That is now
  unrepresentable rather than merely undocumented.
- The contribution scanner refuses a **partially parsed** document. The count
  floor and the span ceiling together still admitted one dropped cell, whose
  day would have been zero-filled — a plausible, fresh, WRONG total. Every day
  inside the covered span must now be accounted for by its own cell.
- The scanner also requires the calendar to **start on a Sunday**, because week
  columns and the frontend's trailing padding line up only if a column is a
  calendar week. A grid starting on any other weekday is refused rather than
  shifting every rendered date.

- The panel refresh loop's stop contract is pinned on the delivery side, not
  only the dispatch side: a watcher stopped WHILE a read is outstanding
  delivers nothing when that read finally settles. The previous test stopped
  the watcher after its read had already settled, which a watcher missing the
  guard survives — there was nothing left in flight to deliver.

- Origin-side HTTPS enforcement (#33): every request the edge declares
  as plain HTTP (`X-Forwarded-Proto: http`) is answered with a `308`
  permanent redirect to the identical URL over TLS — host from the
  request's Host header, escaped path and query preserved byte for
  byte, on every route, HEAD and POST bodiless like GET — as defense
  in depth behind the edge's own HTTPS enforcement. `308` (not `301`)
  preserves the request method and body, so the origin backstop keeps
  this repository byte-identical to the sibling's, whose gated write
  routes a `301` would silently rewrite to `GET`; the edge's own
  Always-Use-HTTPS remains the primary redirect. Matching is a
  byte-exact equality (pinned against any future trim/prefix/contains
  regression): trailing/leading whitespace and comma-list proto values
  are "not our edge" and neither redirect nor mint the promise. The
  HSTS header keeps its
  exact value (`max-age=31536000`: the application is the sole HSTS
  owner, edge-managed HSTS stays off, and includeSubDomains/preload
  remain deferred owner decisions pending a subdomain inventory and a
  rollback path) but now rides only responses the edge declares as TLS
  (`X-Forwarded-Proto: https`). Behavior change for undeclared
  traffic: probe, port-forward, and local-dev responses — which
  previously carried HSTS on connections that never demonstrated TLS —
  now serve without it; nothing else about undeclared serving changes.
  Matching is exact and fail-closed: case variants and unknown proto
  values neither redirect nor mint the promise, and the forwarded
  header is trusted for this scheme decision only.

## [0.1.9] - 2026-08-11

### Added
- Boss-log side rail (#20): the first visible panel — a collapsible
  fixed right rail recreating RuneLite's chrome purely in CSS from its
  published palette values as component-scoped, theme-overridable
  custom properties, collapsed by default on narrow viewports and
  overlaid so it can never shift layout. Inside, the boss log renders a
  dense three-column grid of fixed-height cells: a lazy-loaded boss
  icon beside a right-aligned KC, null KC rendered as `--`, and a
  hover/focus tooltip with full boss name, rank, and KC. The shared
  panel-UI foundation lands with it: `src/lib/panels.ts`, a same-origin
  typed data layer over `/api/panels` pinning the `panel/v1` envelope
  against the Go types (strict admission, exactly one request with no
  retries, every transport/status/shape fault degraded to an honest
  `unavailable` envelope); `PanelShell.svelte`, the one shared chrome —
  title plus status badge (ok/stale/unavailable dot and coarse
  `generatedAt` age) — reading `--panel-*` custom properties so the
  theme layer overrides variables, never components; and a
  comment-fenced one-line-per-panel mount region in `App.svelte` so
  parallel panel PRs merge cleanly. Six OSRS Wiki boss thumbnails ship
  as content-hashed same-origin assets (`assetsInlineLimit: 0` keeps
  the CSP free of `data:` URIs) with the Jagex Fan Content Policy
  notice and wiki credit in `ATTRIBUTION.md`; boss names stay API data
  — the only name-shaped code is the icon slug lookup with an
  initials-glyph fallback. A `TestVisitorChecksTheBossLog` visitor
  chapter pins the page render and boss-log payload contract over real
  transport, including both branches of the null-KC `--` path.
- Reading modes (#22): named color schemes like the OSRS wiki — light,
  dark, and a sepia placeholder seeded from the wiki's browntown values
  — instead of a binary toggle. `styles.css` becomes a custom-property
  token layer: light is the default `:root` palette, each further mode
  is one `[data-theme]` override block with its own `color-scheme`, and
  with no explicit choice `prefers-color-scheme: dark` maps the dark
  tokens in. Zero flash with no inline script and no CSP change: the
  origin precomputes one `data-theme`-stamped `index.html` variant per
  mode at construction — own bytes and digest ETag each, from memory,
  no request-path templating — and selects by the `theme` cookie,
  failing closed to the unstamped default on anything unregistered; the
  document response now carries `Vary: Cookie` so storing caches key
  copies per variant. The toggle is the wiki's, dependency-free: a
  compact moon button opening a popover of three round swatches — each
  swatch's background is its theme's own page surface with a sun,
  cratered-moon, or plain dark-moon glyph (inline SVG) — that sets the
  cookie (`path=/`, 365 days, `SameSite=Lax`) and swaps `data-theme`
  instantly, same stylesheet, no reload, no asset refetch; fully
  keyboard-driven (arrows/Home/End, Escape with focus return, focus-out
  dismissal) with 44px targets and reduced-motion-aware animation, its
  open/close logic an extracted, behavior-tested state machine whose
  press-in-flight guard keeps dismissal and pointer selection correct
  across engine focus differences. `styles.css`
  holds every palette value exactly once as `--palette-*` definitions
  that theme blocks and swatches only reference. A bundle whose
  index.html cannot be stamped now fails construction; parity pins hold
  the Go theme list, the frontend registry, and the CSS blocks together.
- Panel framework (#21): a versioned read-only JSON API under
  `/api/panels` (index) and `/api/panels/<id>` (full panel), served
  through the existing security wrappers in the site's revalidated
  no-cache class with digest ETags. One stable `panel/v1` envelope —
  `{schema, id, kind, title, generatedAt, status: ok|stale|unavailable,
  data}` — over kind-versioned payloads: `token-usage/v1` (per-source
  windows; source labels are data, never Go identifiers),
  `vcs-activity/v1` (contribution weeks, totals, streak, recent
  commits), and `boss-log/v1` (account plus bosses with nullable
  kc/rank rendered as "--"). Panels are FETCH-FIRST per owner review:
  boss-log refreshes from the official hiscores JSON endpoint (mapped
  data-driven onto a configured boss list) and token-usage from the
  two vendors' official usage-report APIs, with every vendor string —
  endpoints, labels, credential env-var names, the outbound host
  allowlist — living in embedded config DATA, never Go source.
  Refresh runs ONLY in background loops (TTL cadence with exponential
  backoff), enabled by an explicit `PANELS_REFRESH=true` opt-in at the
  composition root following the media-enablement precedent; fetched
  documents pass the same strict decoders as snapshots, bodies are
  size- and time-bounded, credentials are read from named env vars at
  fetch time only (unset means that source serves its snapshot section
  as `stale`), HTTP redirects are refused outright so neither the
  client nor a credential header can ever be steered off the
  allowlist, and every failure keeps the last good payload serving
  with an honest `stale` signal. Embedded snapshots remain the
  cold-start/failure default: fresh = `ok`, fallback or last-good =
  `stale`, nothing = `unavailable`. The zero-egress pin evolved into a
  confinement pin (a conscious narrowing, documented in the PR): all
  egress machinery lives in one file, the production host allowlist is
  test-pinned to exactly the three approved hosts with off-list hosts
  refused at construction AND at request time, and an instrumented
  transport proves requests never trigger fetches. Owner performance
  budgets are structural: index responses at or under 4 KiB and panel
  envelopes at or under 32 KiB are enforced at build/refresh time and
  as tests, panel JSON deliberately serves whole documents (no byte
  ranges), and a read-counting filesystem proves the request path
  never leaves memory. Visitor scenarios cover the index, every panel
  with honest cold-start statuses, revalidation to 304s, and the
  opaque 404 over real transport.
- Visitor-scenario end-to-end suites: a hand-written stdlib mock-browser
  harness (`internal/testsupport.Visitor`) remembers and replays ETags
  like a browser cache, follows the document's asset references, seeks
  media by Range like a player, and asserts the security-header baseline
  on every navigation; scenarios cover first visit, repeat visit,
  missing deep links, media playback, and hostile probing (including
  all seven reserved namespaces) over real transport.
- Reserved-namespace parity pins: exact-seven-list tests on both the Go
  side (`TestReservedMediaSegmentsParity`) and the frontend side
  (`media.test.mjs`), each naming the other file, so the hand-duplicated
  Go and TypeScript lists cannot drift silently.
- `internal/testsupport`: shared API-level fixtures — the canonical
  frontend bundle and on-disk media tree — excluded from the coverage
  denominator as test scaffolding; white-box fakes stay in the packages
  whose internals they observe.

### Changed
- Provider neutrality (owner requirement R9): the NetworkPolicy's ingress
  peer is now values-driven (`ingress.peerNamespace`,
  `ingress.peerAppName`, defaulting to the current Cloudflare Tunnel
  connector) and the policy resource is renamed
  `cloudflared-to-naranjo-online` to `ingress-to-naranjo-online`; a
  provider swap is a values override, never a template or code edit.
  A fail-closed pin test asserts zero provider names in application
  code, frontend source, and chart templates — chart values defaults
  are the only sanctioned location.
- Package layout convention: each Go package keeps its types and
  package-level const/var declarations in `types.go` (genuine shared
  utilities in `utils.go`); the one-year immutable cache policy is one
  named constant shared by hashed assets and immutable media.
- A media-enabled boot constructs the site exactly once; previously it
  built and discarded a throwaway media-less `Site` first — a full walk
  plus SHA-256 of every embedded file.
- Embedded files with unregistered extensions now serve pinned
  `application/octet-stream` instead of leaving `http.ServeContent` to
  sniff the body; the media path already pinned unknown types.
- Tests assert structure and sentinel fixtures, never placeholder copy,
  so the temporary hello-world shell can become the real media-rich site
  without breaking behavior tests; AGENTS.md documents this and the
  other sanctioned-evolution paths.
- Go coverage floor raised 90.0% to 91.1% (ratchet-only; measured 94.1%
  on the scaffolding-excluded production denominator).

## [0.1.8] - 2026-08-11

### Added
- Production-readiness test sweep. A 28-row RFC 9110 precondition matrix
  locks when an abusive `Range` header may be answered with the
  application's `416` and when a standard `200`, `304`, or `412` must win;
  `testing/synctest` lifecycle tests prove the exact 10-second shutdown
  bound against a hand-written `httpRunner` fake; real-socket end-to-end
  suites boot `run()` — media-disabled and media-enabled — wait for
  readiness, exercise the public contracts over the wire (including
  fail-closed saturation with recovery), and drain on a real SIGTERM;
  deep-mock filesystem fault injection proves a broken embedded bundle can
  never become a ready pod and that the request path never touches the
  filesystem; and real-filesystem media-boundary faults (unreadable leaf,
  named pipe, file-as-directory, post-Close straggler, name-limit
  overflow) are pinned to opaque responses. Go statement coverage rises
  from 71.4% to 93.7%.
- The PR gate enforces a ratchet-only Go coverage floor (90.0%). Raising
  it as coverage grows is expected; lowering it is out of policy.

### Changed
- Every embedded frontend response — body, digest ETag, content type,
  cache policy — is prepared once at construction. Any unreadable embedded
  file now fails startup before the pod reports ready instead of surfacing
  as per-visitor errors, and the serving hot path performs no hashing and
  no filesystem access.
- `main()` now owns the process signal contract and passes `run()` its
  lifecycle context plus an environment-lookup function, the same
  entrypoint seam the lidersea.com sibling uses, so both repos test
  configuration, bind, serve, and drain identically and hermetically.

## [0.1.7] - 2026-08-11

### Changed
- Serve the application shell as `no-cache` instead of `no-store`, so the
  edge and browser may store it while still revalidating every navigation.
  An unchanged site now answers with a small `304` instead of shipping the
  whole document from the origin through the tunnel each time; the shell
  was the one uncacheable resource on an otherwise fully cached site. The
  document is public and its `ETag` is a content digest, so nothing is
  traded for the gain. Content-hashed assets keep their immutable caching.

### Added
- `TestNoRequestMethodCanEverMutate` pins that every route refuses every
  mutating method — the executable safety contract that makes TLS 1.3
  0-RTT (early data, which can be replayed) admissible at the edge.

## [0.1.6] - 2026-08-10

### Fixed
- Release pipeline: capture helm push's stderr so the chart digest is
  read for signing and the Release notes. v0.1.5 published a signed
  image and an unsigned chart artifact before the digest parse refused;
  the release process did not reuse or move that published tag, so v0.1.6 is
  the first complete signed release
  (image + signed OCI chart + GitHub Release).

## [0.1.5] - 2026-08-10

### Fixed
- Release pipeline: removed the invalid GitHub attestation step (buildx
  SLSA provenance + SBOM and the Cosign signature remain the integrity
  evidence). v0.1.4 published a valid signed image but no chart or
  GitHub Release; the release process did not reuse or move that published
  tag, so v0.1.5 is the first complete release.

## [0.1.4] - 2026-08-10

### Added
- Go module renamed to the standalone identity github.com/snaraj/naranjo.online.
- Standalone repository: complete history imported from the
  `website-infrastructure` monorepo with authorship preserved.
- Production CI: PR gate (frontend + Go tests with coverage, chart lint,
  dual-arch container build, secret/history scanning, actionlint,
  dependency review) and CodeQL.
- Tag-triggered release publisher: multi-arch image + OCI Helm chart to
  GHCR, Cosign keyless signing, SBOM, SLSA provenance, GitHub Releases.
- Documentation: README, agent contract (AGENTS.md), security policy,
  MIT license with all-rights-reserved site content.

## [0.1.3] and earlier

Released from the monorepo publishers (`ghcr.io/snaraj/naranjo-online`
`v0.1.2`, `v0.1.3`): hello-world frontend contract, health/readiness
endpoints, embedded-serving hardening, fail-closed media subsystem. See
the monorepo history (imported here) for details.
