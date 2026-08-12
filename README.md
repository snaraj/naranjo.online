# naranjo.online

[![PR gate](https://github.com/snaraj/naranjo.online/actions/workflows/pr-gate.yml/badge.svg?branch=main)](https://github.com/snaraj/naranjo.online/actions/workflows/pr-gate.yml)
[![CodeQL](https://github.com/snaraj/naranjo.online/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/snaraj/naranjo.online/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/snaraj/naranjo.online?sort=semver)](https://github.com/snaraj/naranjo.online/releases)
[![Go coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fsnaraj%2Fnaranjo.online%2Fbadges%2Fgo-coverage.json&label=go%20coverage)](https://github.com/snaraj/naranjo.online/actions/workflows/pr-gate.yml)
[![Frontend coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fsnaraj%2Fnaranjo.online%2Fbadges%2Ffrontend-coverage.json&label=frontend%20coverage)](https://github.com/snaraj/naranjo.online/actions/workflows/pr-gate.yml)
[![Go version](https://img.shields.io/github/go-mod/go-version/snaraj/naranjo.online)](go.mod)
[![License: MIT](https://img.shields.io/github/license/snaraj/naranjo.online)](LICENSE)

Samuel's personal corner of the internet — portfolio, professional home, and
whatever deserves a permanent URL. A Svelte frontend embedded into a single
dependency-free Go binary, shipped as a distroless multi-arch container and a
Helm chart, deployed by digest onto a self-hosted Kubernetes platform behind
Cloudflare.

## How it works

```mermaid
flowchart LR
    dev[Svelte source] -->|vite build| dist[Hashed static bundle]
    dist -->|go:embed| bin[Go binary]
    bin -->|3-stage build| img["Distroless image (amd64+arm64)"]
    chart[Helm chart] --> rel
    img -->|cosign signed, digest pinned| rel[Release vX.Y.Z]
    rel -->|GitOps pulls by digest| k8s[Kubernetes on the home platform]
    k8s --> cf[Cloudflare Tunnel] --> visitors((Visitors))
```

The Go service serves the embedded bundle with strict caching, conditional
requests, security headers, and `/livez` + `/readyz` probes on port 8080.
There is no runtime dependency beyond the Go standard library.

## Development

```sh
# Frontend: build first — the Go embed test expects the bundle to exist.
cd frontend
npm ci --ignore-scripts
npm run check && npm test && npm run build

# Backend — the same gate CI enforces
cd ..
test -z "$(gofmt -l .)"
go vet ./...
CGO_ENABLED=0 go test ./...
go test -race ./...

# Container (both production architectures)
docker build .
```

Toolchain pins live in CI (`node 24.19.0`, `npm 11.17.0`, `go 1.26.5`);
newer local versions generally work, CI is authoritative.

## Releases

One tag does everything: pushing `vX.Y.Z` (matching `VERSION` and the chart
version — CI enforces the three-way lock) builds and publishes:

- `ghcr.io/snaraj/naranjo-online:vX.Y.Z` — multi-arch image, keyless-signed
  (Cosign), with SBOM and SLSA provenance; deployment consumes the digest,
  never the tag.
- `ghcr.io/snaraj/charts/naranjo-online` — the Helm chart as an OCI
  artifact, same version, also signed.
- A GitHub Release with the immutable digests and human notes.

Version tags are immutable: the publisher refuses to reuse one, on purpose,
with no override. See [CHANGELOG.md](CHANGELOG.md) for history and
[SECURITY.md](SECURITY.md) for the security posture.

## Panels

`/api/panels` serves small, versioned, read-only display panels — token
usage, version-control activity, a boss log. Every response is the same
`panel/v1` envelope, prepared in memory at construction so a request is a map
lookup and one write, and every payload carries a `status` of `ok`, `stale`,
or `unavailable` that describes where the data actually came from. A panel
that cannot load its data still answers, with its identity intact and its
data `null`; it never fabricates numbers.

Panels have two data sources. The default everywhere is an **embedded
snapshot**: JSON captured out of band, compiled into the binary, validated
once at startup. The second is a **background live fetch**, which is opt-in,
disabled by default, and the only reason this process would ever make an
outbound request.

Mounted panels re-read their envelope roughly once a minute and stop entirely
while the tab is hidden. Because each response carries a digest ETag, an
unchanged panel costs a conditional request and a bodyless `304`.

### Enabling live refresh (not enabled anywhere today)

Live refresh is off in every deployment this repository describes, and
turning it on is a reviewed operational change, not a code change. It
requires all of the following, together:

1. `PANELS_REFRESH=true` in the pod environment. Any other value than
   `true`/`false` fails the boot rather than guessing.
2. The credential environment variables named by the `keyEnvName` fields in
   `internal/panels/config/fetch.json`, supplied as cluster Secrets. They are
   read at fetch time only, flow straight into a request header, and are
   never stored, logged, or served. **No key, and no reference to a key,
   belongs in this repository** (requirement 12). A source whose variable is
   unset is simply skipped; it is never an error and never a fabricated
   number.
3. An egress allowance for the hosts in that file's `hosts` allowlist. The
   chart's NetworkPolicy is ingress-only today, so with policy unchanged the
   refresh attempts fail and the panels keep serving their snapshots as
   `stale` — the fail-soft outcome, not an outage.

**Cluster enablement is a separate owner-reviewed step** (standing audit item
S2) covering the Secret material, the egress policy, and the review of what
the origin is then permitted to talk to. Nothing in this repository performs
it, and no artifact here should be read as approval for it.

## Media

Small UI assets live under `frontend/src/assets/` in documented categories
with a per-file size ceiling. Heavy media (source video, FLAC, delivery
derivatives) never enters this repository, the bundle, the image, or the
cluster control plane — it is served from dedicated storage on the platform.

## License

Code is [MIT](LICENSE). Site content — text, images, video, audio, branding
— is **all rights reserved**; the license does not extend to it.
