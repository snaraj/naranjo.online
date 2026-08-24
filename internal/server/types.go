// types.go collects every type, const, and var declaration in package server
// so a reader can survey the package's data model and tuning values in one
// place. Methods stay beside the logic they serve: construction and frontend
// serving in server.go, media delivery in media.go.

package server

import (
	"errors"
	"net/http"
	"os"
	"regexp"
	"time"

	"github.com/snaraj/naranjo.online/internal/panels"
)

// immutableCacheControl is the one-year immutable cache policy shared by every
// content-addressed response: hashed frontend assets under assets/ and media
// files under the digest-named immutable namespace. Both URL shapes embed a
// content identity, so changed bytes are always published under a new URL and
// a year-long immutable cache can never serve stale content.
const immutableCacheControl = "public, max-age=31536000, immutable"

// staticFile is one immutable embedded response, fully prepared during
// construction. Precomputing the bytes, digest ETag, content type, and cache
// policy once removes a filesystem read and a SHA-256 of the whole file from
// every request — meaningful on the small Pi origin — and leaves the request
// path with no failure mode at all.
type staticFile struct {
	// body is the complete response payload, held in memory for the process
	// lifetime; the embedded bundle is small by repository doctrine.
	body []byte
	// etag is the quoted SHA-256 digest of body — a strong validator that is
	// identical across replicas and restarts serving the same build.
	etag string
	// contentType is resolved once from the file extension so the request
	// path never consults MIME tables; extensions outside the registry are
	// pinned to application/octet-stream so ServeContent never sniffs.
	contentType string
	// cacheControl is no-cache for the revalidated shell and document files,
	// and the shared immutable policy for content-hashed assets.
	cacheControl string
}

// handler serves the immutable frontend files after New has validated and
// prepared the complete bundle. It remains private so callers cannot bypass
// the mux's health endpoints or the securityHeaders wrapper.
type handler struct {
	// files maps each clean root-relative name to its prepared response.
	// Traversal, directory, and unknown names miss the table identically, so
	// every invalid request shape collapses into the same 404.
	files map[string]*staticFile
	// index is prepared during construction so a broken image fails before the
	// process becomes ready rather than failing on the first visitor request.
	// It is the unstamped default document served when no valid theme cookie
	// accompanies a request; its tokens follow prefers-color-scheme.
	index *staticFile
	// themed maps each reading-mode id to the prepared index.html variant
	// whose <html> element carries that data-theme stamp. Variants are
	// precomputed at construction exactly like every other embedded response
	// — own bytes and digest ETag each — so per-request selection is one
	// cookie parse and one map lookup, never templating.
	themed map[string]*staticFile
}

// Site is the complete naranjo.online HTTP application. It owns an optional
// directory-limited media root so shutdown can close that capability after all
// active requests have drained, and the panel registry so the composition
// root can explicitly enable background live refresh.
type Site struct {
	// handler is the fully wrapped router, never the unprotected internal mux.
	handler http.Handler
	// media owns the optional root capability and is nil in the production
	// scaffold while storage and delivery remain blocked.
	media *mediaHandler
	// panels is the prepared panel registry; its background refresh starts
	// only through StartPanelRefresh, never as a construction side effect.
	panels *panels.Registry
}

const (
	// forwardedProtoHeader names the TLS-terminating edge's declaration of
	// the scheme the visitor used on the public leg of the connection. The
	// origin reads it for exactly one decision — the scheme policy in
	// securityHeaders and redirectForwardedHTTP — and must never trust it
	// for anything else: it is client-controlled bytes on any connection
	// that did not come through the edge.
	forwardedProtoHeader = "X-Forwarded-Proto"
	// forwardedProtoHTTP is the only declaration that triggers the permanent
	// redirect to TLS. Matching is exact and case-sensitive on purpose: the
	// edge sends lowercase tokens, so a case variant or unknown value is not
	// our edge speaking and fails closed to normal serving. Absence — probe
	// and port-forward traffic that never crossed the edge — serves normally
	// for the same reason.
	forwardedProtoHTTP = "http"
	// forwardedProtoHTTPS is the only declaration that earns the HSTS
	// policy. Exact matching keeps the promise fail-closed: no spoofed or
	// malformed proto value can mint a transport-security pin for a
	// connection the edge never declared as TLS.
	forwardedProtoHTTPS = "https"
	// themeCookie names the visitor's reading-mode choice (issue #22). Only
	// the frontend toggle ever writes it — the origin never issues Set-Cookie
	// — and the document handler reads it to select the matching precomputed
	// index.html variant, so the chosen theme ships inside the HTML with zero
	// flash and no inline script.
	themeCookie = "theme"
	// mediaPrefix is the stable public contract consumed by the frontend helper;
	// it never reveals the independently managed filesystem location.
	mediaPrefix = "/media/"
	// maxRangeHeaderBytes bounds parsing work before net/http applies the full
	// RFC range semantics. Normal single and multi-range requests are far smaller.
	maxRangeHeaderBytes = 4096
	// maxRangeParts prevents a client from turning one static transfer into an
	// unbounded multipart response while preserving practical seeking behavior.
	maxRangeParts = 16
	// MaxMediaConcurrency is an implementation safety bound that prevents a bad
	// environment value from creating an effectively unbounded semaphore. Live
	// discovery still chooses a much smaller measured value; this is not a default.
	MaxMediaConcurrency = 4096
	// mediaWriteIdleTimeout limits a stalled downstream write, not total transfer
	// duration, so multi-gigabyte responses can continue as long as bytes flow.
	mediaWriteIdleTimeout = 30 * time.Second
)

var (
	// readingThemes lists every reading mode the document is precomputed for.
	// The identical id set is hand-duplicated in the frontend registry
	// (frontend/src/lib/themes.ts) plus its [data-theme] blocks in styles.css
	// — no shared code crosses the Go/TypeScript boundary — and the parity
	// tests on both sides pin the lists against each other. Any cookie value
	// outside this set fails closed to the unstamped default document.
	readingThemes = []string{"dark", "light", "sepia", "slate"}
	// errUnsafeMediaPath intentionally collapses traversal, hidden files,
	// symlinks, directories, and reserved internals into the same public 404.
	errUnsafeMediaPath = errors.New("unsafe media path")
	// immutableDigest binds a cache-immutable URL to one canonical SHA-256
	// namespace without hashing a multi-gigabyte file during every request.
	immutableDigest = regexp.MustCompile(`^[0-9a-f]{64}$`)
	// mediaTypes avoids host registry differences and never lets content sniffing
	// turn an unknown operator file into active browser content.
	mediaTypes = map[string]string{
		".avif": "image/avif",
		".flac": "audio/flac",
		".gif":  "image/gif",
		".jpeg": "image/jpeg",
		".jpg":  "image/jpeg",
		".mp4":  "video/mp4",
		".png":  "image/png",
		".webm": "video/webm",
		".webp": "image/webp",
	}
	// reservedMediaSegments prevents a future mount-layout mistake from exposing
	// operator-only roles even if they appear below the delivery root.
	reservedMediaSegments = map[string]struct{}{
		"checksums":  {},
		"internal":   {},
		"lost+found": {},
		"manifests":  {},
		"metadata":   {},
		"originals":  {},
		"staging":    {},
	}
)

// MediaOptions names the future read-only delivery root and its measured
// concurrency budget. There are no production defaults because both values
// depend on Pi discovery and administration-path saturation tests.
type MediaOptions struct {
	// Root is the absolute container-visible derivative boundary; the chart does
	// not supply it until the storage profile is reviewed.
	Root string
	// MaxConcurrent comes from measured saturation acceptance and bounds open
	// files plus active response goroutines without an invented default.
	MaxConcurrent int
}

// mediaHandler owns the traversal-resistant filesystem capability and a fixed
// transfer semaphore so large public responses cannot create unbounded open
// files, buffers, or goroutines inside the application.
type mediaHandler struct {
	// root is the delivery-tree capability; every lookup and open resolves
	// inside it, so no request path can escape the reviewed directory.
	root *os.Root
	// slots is the fixed transfer semaphore: one buffered token per permitted
	// concurrent response bounds open files and streaming goroutines.
	slots chan struct{}
}

// idleDeadlineWriter refreshes a network write deadline for each streamed
// chunk. Unwrap lets net/http reach the original connection through this narrow
// wrapper, while test recorders may safely report the operation unsupported.
type idleDeadlineWriter struct {
	// ResponseWriter is the wrapped connection-backed writer; Unwrap keeps it
	// reachable for http.ResponseController.
	http.ResponseWriter
	// timeout is the per-write idle bound, refreshed before every chunk.
	timeout time.Duration
}
