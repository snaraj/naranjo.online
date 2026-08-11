# Changelog

All notable changes to naranjo.online. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
SemVer and match image/chart tags exactly.

## [Unreleased]

### Added
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
