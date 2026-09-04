# Build only the small, version-controlled Svelte UI in a pinned stage. The
# repository media gate prevents heavy delivery assets from entering this context.
#
# Both build stages run on the BUILD platform: the frontend is bytes that do not
# vary by target, and Go cross-compiles a static binary for any target from any
# host. Emulating arm64 to run the same checks a second time cost the PR gate
# ten minutes per run (issue 287); now the checks run once, natively, and only
# the final stage is per-target.
FROM --platform=$BUILDPLATFORM docker.io/library/node:24.19.0-trixie-slim@sha256:0711b541c1c33a8a530ac4f0d391baa9a15b3d804695b1b24a47daa5fb60e74d AS frontend
WORKDIR /src/frontend
# The build bakes the footer's version in from the repository's VERSION file
# (vite.config.ts), so that file is a build input of the frontend stage.
COPY VERSION /src/VERSION
COPY frontend/package.json frontend/package-lock.json ./
# The tag and digest select Node, while these checks also prove the npm bundled
# by that image matches the separately reviewed package-manager pin.
RUN test "$(node --version)" = "v24.19.0" && \
    test "$(npm --version)" = "11.17.0" && \
    npm ci --ignore-scripts --no-audit --no-fund
COPY frontend/ ./
RUN npm run check && npm test && npm run build

# Test and compile one static binary for CI amd64 and Pi arm64; any future media
# remains a runtime read-only mount and never becomes part of this Go embed.
FROM --platform=$BUILDPLATFORM docker.io/library/golang:1.26.6-trixie@sha256:b75d466dd608587fd66cca705a307ba65b889827d06ad61d6a75f0482b51b7c7 AS backend
ARG TARGETOS
ARG TARGETARCH
ENV CGO_ENABLED=0 \
    GOTOOLCHAIN=local
WORKDIR /src
COPY go.mod ./
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY --from=frontend /src/internal/web/dist/ ./internal/web/dist/
RUN go test ./... && \
    GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" go build -trimpath -ldflags="-s -w -buildid=" -o /out/naranjo-online ./cmd/server

# The final shell-less image contains only the independently promotable origin
# binary, with no package manager, source tree, compiler, Python, or media bytes.
FROM gcr.io/distroless/static-debian13:nonroot@sha256:f7f8f729987ad0fdf6b05eeeae94b26e6a0f613bdf46feea7fc40f7bd72953e6
COPY --from=backend --chown=65532:65532 /out/naranjo-online /naranjo-online
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/naranjo-online"]
