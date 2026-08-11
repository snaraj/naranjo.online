# Agent contract — naranjo.online

This is the CANONICAL, vendor-agnostic agent contract for this repository:
any frontier model — or hurried human — must be able to operate here cold
from this document alone. Tool-specific entrypoints (CLAUDE.md) only import
it; nothing is duplicated elsewhere. The platform repository's deeper
doctrine applies when the two meet.

## Purpose and architecture

naranjo.online is the owner's personal corner of the internet: a Svelte
frontend embedded into a single dependency-free Go binary (`cmd/server`,
`internal/server`, `internal/web`), shipped as a distroless multi-arch
container plus a Helm chart, and deployed by digest onto a self-hosted
Kubernetes platform. The origin speaks standard HTTP (RFC 9110/9111) only
and is provider-neutral per the deployment-provider contract below. A
fail-closed media subsystem — rooted filesystem capability, reserved
operator namespaces, bounded transfer concurrency — is fully wired but
disabled, awaiting platform deployment and storage discovery. The current
hello-world shell is temporary: the site is becoming a media-rich visual
experience (music, high-quality video, graphics — a music player and
visual blog hybrid), and the test suite is built so that growth is a
conscious edit, never a fight (see Sanctioned evolution).

## Requirements

Numbered for citation, repo-scoped, none negotiable in code:

1. **Zero spend, no external services.** Everything runs on owner hardware
   and free CI. No paid API, SaaS, tracker, CDN, or third-party runtime
   dependency may be introduced — the frontend stays local-origin-only.
2. **Owner-only merges; protected history.** Work lands through PRs into
   `main`; the owner merges. Never push `main`, never force-push, never
   create tags outside the release flow.
3. **Commit-metadata privacy and attribution.** Commits are authored AND
   committed as the owner's GitHub noreply identity (both fields). No
   co-author trailers. Agent-authored commit messages and PR bodies are
   signed `- Fable5` (owner attribution decision, 2026-08-10).
4. **Fail-closed doctrine — never weaken.** No security behavior may be
   made toggleable: no boolean, env var, build tag, or config field may
   silently disable signing, verification, probes, TLS, header policy, or
   fail-closed sentinels. Never weaken a check, guard, validator, or test;
   if one blocks you, fix the cause or surface the conflict. Narrow,
   justified exceptions only, stated where the owner will read them. Tests
   should make dangerous states unrepresentable.
5. **Site independence.** naranjo.online shares conventions with its
   sibling repository (lidersea.com) but depends on nothing from it: no
   shared code, secrets, infrastructure state, or cross-repo references
   in build or runtime.
6. **Provider neutrality (owner requirement R9).** The origin knows no
   ingress, DNS, edge, or access provider. Provider names live exclusively
   in chart values defaults; `TestProviderNeutrality` enforces zero
   occurrences anywhere else. See the deployment-provider contract below.
7. **Ratchet-only coverage floor.** The PR gate enforces
   `GO_COVERAGE_FLOOR` (currently 91.1%, measured 94.1%). Raise it as
   coverage grows; lowering it weakens an enforced check and is out of
   policy.
8. **Truthful serving contract.** Port 8080; `/livez` and `/readyz` stay
   truthful — readiness reflects real serving ability, never a hardcoded
   yes.
9. **Dependency-free Go.** The Go module stays standard-library only.
   Adding a dependency is an owner decision, not a convenience.
10. **Digest deploys, immutable releases.** Images deploy by digest.
    Version tags are immutable and never reassigned. The release workflow
    has no skip flag, no force path, no manual dispatch — never add one.
11. **Media stays out of the control plane.** Heavy media never enters
    git, the bundle, the embed, the image, or a ConfigMap/Secret. Small
    assets respect the documented category and size ceilings. Frontend
    URLs come from `src/lib/media.ts`; components never know hosts,
    volumes, or origins.
12. **No secrets, no personal data.** No credential, token, private host
    fact, or personal data ever enters this repository — including in
    tests, fixtures, and docs.

### Deployment-provider contract

The origin speaks standard HTTP (RFC 9110/9111) only. Ingress, DNS, edge,
and access are injected deployment concerns and never appear in application
code, frontend source, or chart templates. Provider names live exclusively
in the chart's values defaults — `ingress.peerNamespace` and
`ingress.peerAppName` in `chart/values.yaml`, the single binding point the
NetworkPolicy consumes — so a provider swap is a values override, never a
template or code edit. The pin test
(`internal/doctrine/provider_neutrality_test.go`) enforces this, failing
closed on any provider name under `cmd/`, `internal/`, `frontend/src/`, or
`chart/templates/`.

## Testing doctrine (v0.1.8+)

- Coverage is enforced per requirement 7. `internal/testsupport` is test
  scaffolding — it runs only inside test binaries — and is excluded from
  the coverage denominator by the gate's profile filter; that exclusion
  may never grow to cover production packages.
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
- Fixture text is sentinel-only: tests assert structure and markers
  (`data-static-fallback`, fixture sentinels), never site copy.
- Repo-doctrine pins live in `internal/doctrine` (currently provider
  neutrality); parity pins guard hand-duplicated lists on both sides
  (Go `TestReservedMediaSegmentsParity` and the frontend media test),
  each failure naming the other file.
- Tests are stdlib-only with hand-written fakes; no assertion libraries,
  no mock frameworks.

## Package layout

- Each Go package keeps its type/struct declarations and package-level
  const/var blocks in `types.go`; methods stay beside the logic they
  serve. A `utils.go` exists only where a genuinely shared cross-file
  utility does — never create an empty or speculative one.
- Shared API-level fixtures and the mock-browser harness live in
  `internal/testsupport`; white-box fakes that need unexported access
  stay in the package they observe (testsupport never imports the
  packages under test). Visitor scenarios live in
  `cmd/server/visitor_test.go`.

## Build, test, and release flows

Build and test, in this order (the same gate CI enforces):

1. `cd frontend && npm ci --ignore-scripts --no-audit --no-fund &&
   npm run check && npm test && npm run build` — the build lands in
   `internal/web/dist`, which the Go embed test needs.
2. `gofmt -l .` must be empty; `go vet ./...`;
   `CGO_ENABLED=0 go test ./...`; `go test -race ./...`. CI additionally
   enforces the coverage floor on the scaffolding-filtered profile.
3. `helm lint chart && helm template smoke chart --kube-version v1.36.0`
   for chart changes (the chart requires the platform's Kubernetes
   target; plain `helm template` defaults to older capabilities).
4. `docker build .` when the Dockerfile or build inputs change.

Releases: `VERSION`, `chart/Chart.yaml` (`version` + `appVersion`), and
the git tag move together (CI enforces the three-way lock). SemVer per the
platform's ADR 0014: releases are strict bumps; history is append-only.
Update `CHANGELOG.md` in the same PR as the change it describes. Pushing
`vX.Y.Z` publishes the signed multi-arch image, the signed OCI chart, and
a GitHub Release; deployment consumes digests, never tags.

## Sanctioned evolution

The following are expected changes, and the suite is built to make them
conscious edits, never fights:

- Adding media MIME types (`mediaTypes` in `internal/server/types.go`)
  together with their rows in `TestMediaMIMETypes`.
- New asset classes under the documented category and size ceilings, and
  real frontend growth: components, routes, and content replacing the
  placeholder shell. Content is not a contract — tests pin structure and
  markers, so shipping real copy must not break a handler test.
- CSP changes happen in lockstep: `securityHeaders` in
  `internal/server/server.go`, `testsupport.SiteContentSecurityPolicy`,
  and every pinned test value move in the same commit.
- Media enablement after the platform deploys: the fail-closed media
  plumbing (reserved namespaces, root validation, concurrency budget) IS
  the future music/video path and stays fail-closed until the reviewed
  root and measured concurrency budget exist. Enabling media is chart
  configuration plus discovery evidence — never code weakening.
- Ingress provider changes: a values override of the `ingress` block per
  the deployment-provider contract.

None of this relaxes the requirements above: security behavior stays
non-toggleable, the reserved-namespace lists stay exact and pinned
against each other on both sides, provider names stay confined to values
defaults, and the coverage floor only rises.
