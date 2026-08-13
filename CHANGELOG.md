# Changelog

All notable changes to naranjo.online. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `VERSION`, chart
metadata, these headings, and Helm's strict OCI chart tag use numeric SemVer.
Git, image, and GitHub Release tags use the exact plain `vX.Y.Z` form.

## [Unreleased]

## [0.1.10] - 2026-08-13

### Added

- Every protected-main merge now carries and publishes its own immutable
  semantic patch release. Pull requests (including docs and dependency
  updates) must advance the four committed source locks by exactly one patch
  from their protected base. Successful main CI is bound to its exact source
  SHA, creates the plain version tag, and explicitly dispatches the tag-ref
  publisher without relying on recursive tag-push events. Rapid merges have
  independent release paths; exact complete artifact state is retryable, while
  partial, foreign, or conflicting immutable state fails closed as burned.
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
  tags are immutable, so v0.1.6 is the first complete signed release
  (image + signed OCI chart + GitHub Release).

## [0.1.5] - 2026-08-10

### Fixed
- Release pipeline: removed the invalid GitHub attestation step (buildx
  SLSA provenance + SBOM and the Cosign signature remain the integrity
  evidence). v0.1.4 published a valid signed image but no chart or
  GitHub Release; tags are immutable, so v0.1.5 is the first complete
  release.

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
