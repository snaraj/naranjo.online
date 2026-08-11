# Agent contract — naranjo.online

Rules for any AI agent (or hurried human) working in this repository. The
platform repository's deeper doctrine applies when the two meet.

## Build and test, in this order

1. `cd frontend && npm ci --ignore-scripts && npm run check && npm test && npm run build`
   — the build lands in `internal/web/dist`, which the Go embed test needs.
2. `gofmt -l .` must be empty; `go vet ./...`; `CGO_ENABLED=0 go test ./...`;
   `go test -race ./...`.
3. `helm lint chart && helm template smoke chart` for chart changes.
4. `docker build .` when the Dockerfile or build inputs change.

## Invariants (do not negotiate these in code)

- Port 8080; `/livez` and `/readyz` stay truthful — readiness reflects real
  serving ability, never a hardcoded yes.
- The Go module stays dependency-free (standard library only). Adding a
  dependency is an owner decision, not a convenience.
- Images deploy by digest. Version tags are immutable and never reassigned.
  The release workflow has no skip flag, no force path, no manual dispatch —
  never add one.
- **No security behavior may be made toggleable.** No boolean, env var,
  build tag, or config field may silently disable signing, verification,
  probes, TLS, header policy, or fail-closed sentinels. If a security check
  blocks you, fix the cause or surface the conflict — never weaken or flag
  off the check. Tests should make dangerous states unrepresentable.
- Heavy media never enters git, the bundle, the embed, the image, or a
  ConfigMap/Secret. Small assets respect the documented category and size
  ceilings.
- Frontend URLs come from `src/lib/media.ts`; components never know hosts,
  volumes, or origins.

## Testing doctrine (v0.1.8+)

- The PR gate enforces a ratchet-only Go statement-coverage floor
  (`GO_COVERAGE_FLOOR`, currently 91.1%, measured 94.1%). Raise it as
  coverage grows; lowering it weakens an enforced check and is out of
  policy. `internal/testsupport` is test scaffolding — it runs only inside
  test binaries — and is excluded from the coverage denominator by the
  gate's profile filter; that exclusion may never grow to cover
  production packages.
- Lifecycle bounds are proven under `testing/synctest` against
  hand-written fakes (the `httpRunner` seam), so the exact shutdown
  window is exercised in microseconds with no sockets and no sleeps.
- Filesystem boundaries are proven with deep fakes: a read-counting,
  fault-injecting `fs.FS` pins that construction reads everything exactly
  once and the request path never touches the filesystem. The media root
  is deliberately never mocked — it is a security boundary, and its
  faults are staged on a real filesystem.
- End-to-end suites boot `run()` over real TCP and drain on a real
  SIGTERM. Visitor-scenario suites (`cmd/server/visitor_test.go`) drive
  the same boots through the `testsupport.Visitor` mock browser — ETag
  replay, asset following, Range seeking, security baseline on every
  navigation — and must read as user stories.
- Shared API-level fixtures live in `internal/testsupport`; white-box
  fakes that need unexported access stay in the package they observe.
  Fixture text is sentinel-only: tests assert structure and markers,
  never site copy.
- Tests are stdlib-only with hand-written fakes; no assertion libraries,
  no mock frameworks.

## Package layout

- Each Go package keeps its type/struct declarations and package-level
  const/var blocks in `types.go`; methods stay beside the logic they
  serve. A `utils.go` exists only where a genuinely shared cross-file
  utility does — never create an empty or speculative one.

## Sanctioned evolution

naranjo.online is becoming a media-rich visual site — music, high-quality
video, graphics; a music player and visual blog hybrid. The current
hello-world shell is temporary until the platform deploys. The following
are expected changes, and the suite is built to make them conscious
edits, never fights:

- Adding MIME types to the media table (`mediaTypes` in
  `internal/server/types.go`) together with their rows in
  `TestMediaMIMETypes`.
- New asset classes under the documented category and size ceilings, and
  real frontend growth: components, routes, and content replacing the
  placeholder shell. Content is not a contract — tests pin structure and
  markers (`data-static-fallback`, fixture sentinels), so shipping real
  copy must not break a handler test.
- CSP changes happen in lockstep: `securityHeaders` in
  `internal/server/server.go`, `testsupport.SiteContentSecurityPolicy`,
  and every pinned test value move in the same commit.
- Media enablement after the platform deploys: the fail-closed media
  plumbing (reserved namespaces, root validation, concurrency budget) IS
  the future music/video path and stays fail-closed until the reviewed
  root and measured concurrency budget exist. Enabling media is chart
  configuration plus discovery evidence — never code weakening.

None of this relaxes the invariants above: security behavior stays
non-toggleable, the reserved-namespace lists stay exact and pinned
against each other on both sides (Go and TS), and the coverage floor
only rises.

## Versioning and releases

`VERSION`, `chart/Chart.yaml` (`version` + `appVersion`), and the git tag
move together (CI enforces). SemVer per the platform's ADR 0014: releases
are strict bumps; history is append-only. Update `CHANGELOG.md` in the same
PR as the change it describes.

## Conduct

- Work through PRs into `main`; the owner merges. Never push `main`, never
  force-push, never create tags outside the release flow.
- Commit messages and PR bodies are signed `- Fable5` when authored by the
  agent; no co-author trailers (owner attribution decision, 2026-08-10).
- No credential, token, private host fact, or personal data ever enters
  this repository — including in tests, fixtures, and docs.
