# Changelog

All notable changes to naranjo.online. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `VERSION`, chart
metadata, these headings, and Helm's strict OCI chart tag use numeric SemVer.
Git, image, and GitHub Release tags use the exact plain `vX.Y.Z` form.

## [Unreleased]

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
