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

## Media

Small UI assets live under `frontend/src/assets/` in documented categories
with a per-file size ceiling. Heavy media (source video, FLAC, delivery
derivatives) never enters this repository, the bundle, the image, or the
cluster control plane — it is served from dedicated storage on the platform.

## License

Code is [MIT](LICENSE). Site content — text, images, video, audio, branding
— is **all rights reserved**; the license does not extend to it.
