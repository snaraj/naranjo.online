// Package server exposes the production HTTP handler for naranjo.online. It
// serves only the embedded frontend and Kubernetes health probes, keeping the
// application stateless and suitable for replicated, pull-based deployments.
package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/snaraj/naranjo.online/internal/panels"
)

// New constructs the complete naranjo.online HTTP handler from built frontend
// assets. Construction validates index.html up front, wires Kubernetes probe
// endpoints, and applies one security-header policy to every response.
// Options inject cross-cutting dependencies (WithLogger); omitted, the site
// serves identically and logs nowhere.
func New(assets fs.FS, options ...Option) (*Site, error) {
	return newSite(assets, nil, siteConfiguration(options).logger)
}

// NewWithMedia constructs the site with a separately managed read-only media
// library. Production charts deliberately cannot call this path until ADR 0012
// discovery supplies a reviewed root and concurrency budget.
func NewWithMedia(assets fs.FS, media MediaOptions, options ...Option) (*Site, error) {
	mediaRoute, err := openMediaHandler(media)
	if err != nil {
		return nil, err
	}
	site, err := newSite(assets, mediaRoute, siteConfiguration(options).logger)
	if err != nil {
		_ = mediaRoute.Close()
		return nil, err
	}
	return site, nil
}

// newSite wires the shared response policy after optional capabilities have
// been validated, keeping the media-disabled and media-enabled paths identical
// for health probes and embedded frontend behavior.
func newSite(assets fs.FS, media *mediaHandler, logger *slog.Logger) (*Site, error) {
	h, err := newHandler(assets)
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/livez", health)
	mux.HandleFunc("/readyz", health)
	// Reserve both media route forms even while storage is disabled. Without an
	// explicit terminal handler, an accidentally embedded media/* file could
	// fall through to the frontend handler and bypass the rooted filesystem,
	// concurrency, MIME, and deadline controls in mediaHandler.
	mediaRoute := http.NotFoundHandler()
	if media != nil {
		mediaRoute = media
	}
	mux.Handle("/media", http.NotFoundHandler())
	mux.Handle("/media/", mediaRoute)
	// The panel API serves prepared JSON envelopes from memory. Both route
	// forms are registered explicitly so /api/panels/<id> can never fall
	// through to the frontend handler's file table, and the shared security
	// wrappers below apply to panel responses unchanged. Construction never
	// performs network activity: fetch-backed panels serve their embedded
	// snapshots as stale until StartPanelRefresh is explicitly invoked by
	// the composition root.
	panelAPI := panels.New(logger)
	mux.Handle(panels.IndexPath, panelAPI)
	mux.Handle(panels.PanelPathPrefix, panelAPI)
	mux.Handle("/", h)
	// requestLog wraps OUTSIDE the policy chain so the completion record
	// carries every final outcome — including the TLS redirect's 308 and the
	// ambiguous-path 404 — with the response's actual status and byte count.
	return &Site{handler: requestLog(logger, securityHeaders(redirectForwardedHTTP(rejectAmbiguousPath(mux)))), media: media, panels: panelAPI}, nil
}

// StartPanelRefresh starts the panel API's background live refresh. It is an
// explicit capability enablement — construction and tests stay egress-free —
// and the loops stop when ctx cancels, before any in-flight attempt begins.
//
// A panel the sealed data root owns starts no loop (2026-08-24 review
// finding 8); every other fetch-backed panel is unaffected.
func (s *Site) StartPanelRefresh(ctx context.Context) {
	s.panels.StartRefresh(ctx)
}

// TokenUsageOwnedByDataRoot reports whether the sealed data-root path owns
// the token-usage panel, so the composition root can log that decision once
// at startup. It is a report, never the enforcement.
func (s *Site) TokenUsageOwnedByDataRoot() bool {
	return s.panels.DataRootOwnsTokenUsage()
}

// newHandler reads and prepares every embedded file exactly once. Any
// unreadable file — not only index.html — fails construction, so a corrupt
// bundle is discovered before the pod reports ready instead of surfacing as
// per-visitor 500s, and the serving path afterwards cannot fail.
func newHandler(assets fs.FS) (*handler, error) {
	files := make(map[string]*staticFile)
	err := fs.WalkDir(assets, ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		// dist/.gitkeep exists only so a clean checkout can compile before the
		// frontend build. It is build metadata, not public site content.
		if entry.IsDir() || name == ".gitkeep" {
			return nil
		}
		data, err := fs.ReadFile(assets, name)
		if err != nil {
			return fmt.Errorf("read embedded file %s: %w", name, err)
		}
		files[name] = newStaticFile(name, data)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("prepare embedded frontend: %w", err)
	}
	index, ok := files["index.html"]
	if !ok {
		return nil, fmt.Errorf("read embedded index: %w", fs.ErrNotExist)
	}
	// Reading modes (issue #22, the OSRS-wiki mechanism adapted): one stamped
	// document variant per theme is prepared here, from the bytes already in
	// memory — no second filesystem read — so a theme cookie costs the request
	// path one map lookup and TTFB stays identical to every other embedded
	// response. Each variant is a full staticFile with its own digest ETag,
	// keeping conditional requests correct per representation.
	themed := make(map[string]*staticFile, len(readingThemes))
	for _, theme := range readingThemes {
		stamped, err := stampReadingTheme(index.body, theme)
		if err != nil {
			return nil, fmt.Errorf("prepare %s reading-mode variant: %w", theme, err)
		}
		themed[theme] = newStaticFile("index.html", stamped)
	}
	return &handler{files: files, index: index, themed: themed}, nil
}

// stampReadingTheme returns a copy of the document whose <html> element
// carries the theme's data-theme attribute, so the chosen token block applies
// before any stylesheet or script decision — zero flash without inline JS.
// Only a lowercase <html delimited like real markup is stamped; a bundle
// without one fails construction rather than silently shipping documents that
// can never change theme.
func stampReadingTheme(document []byte, theme string) ([]byte, error) {
	const openTag = "<html"
	start := bytes.Index(document, []byte(openTag))
	if start < 0 {
		return nil, fmt.Errorf("document has no <html> element to stamp")
	}
	insertAt := start + len(openTag)
	if insertAt >= len(document) {
		return nil, fmt.Errorf("document ends inside its <html> element")
	}
	switch document[insertAt] {
	case '>', ' ', '\t', '\r', '\n':
	default:
		return nil, fmt.Errorf("document has no <html> element to stamp")
	}
	stamp := []byte(` data-theme="` + theme + `"`)
	stamped := make([]byte, 0, len(document)+len(stamp))
	stamped = append(stamped, document[:insertAt]...)
	stamped = append(stamped, stamp...)
	return append(stamped, document[insertAt:]...), nil
}

// newStaticFile derives the response identity for one embedded file. The
// digest-based strong ETag remains stable across replicas and restarts, so
// every pod presents the same cache identity for the same bytes.
func newStaticFile(name string, data []byte) *staticFile {
	sum := sha256.Sum256(data)
	cacheControl := "no-cache"
	if strings.HasPrefix(name, "assets/") {
		// Vite filenames contain a content hash, making a year-long immutable
		// cache safe: changed bytes are always published under a new URL.
		cacheControl = immutableCacheControl
	}
	contentType := mime.TypeByExtension(path.Ext(name))
	if path.Ext(name) == ".woff2" {
		// The typeface travels in the bundle (issue 275), and .woff2 is in
		// neither Go's builtin table nor the distroless image, which carries no
		// /etc mime registry to extend it — so in production this would fall
		// through to the octet-stream default below. Fail-inert (font fetches
		// never enforce the served type), but avoidably untyped: one pinned row
		// keeps it host-independent, the same no-host-registry reasoning
		// mediaTypes states for operator files.
		contentType = "font/woff2"
	}
	if contentType == "" {
		// The embedded bundle is build-controlled, so an extension outside the
		// MIME registry is a packaging surprise, not a delivery feature. Pinning
		// application/octet-stream keeps ServeContent from sniffing the body
		// into a browser-active type — the same fail-inert policy the media
		// path applies to unknown operator files.
		contentType = "application/octet-stream"
	}
	return &staticFile{
		body:         data,
		etag:         `"` + hex.EncodeToString(sum[:]) + `"`,
		contentType:  contentType,
		cacheControl: cacheControl,
	}
}

// ServeHTTP exposes the composed application while keeping the underlying mux
// private so no caller can bypass its security-header and method policy.
func (s *Site) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.handler.ServeHTTP(w, r)
}

// Close releases the optional media and panels-data roots. It is safe for
// sites with neither capability and is called only after the HTTP server has
// stopped accepting requests.
func (s *Site) Close() error {
	var mediaErr, dataErr, stateErr error
	if s.media != nil {
		mediaErr = s.media.Close()
	}
	if s.panelsData != nil {
		dataErr = s.panelsData.Close()
	}
	if s.panelsState != nil {
		stateErr = s.panelsState.Close()
	}
	if mediaErr != nil {
		return mediaErr
	}
	if dataErr != nil {
		return dataErr
	}
	return stateErr
}

// health provides the shared liveness and readiness response. The service has
// no database or other runtime dependency, so both probes intentionally use the
// same cheap, side-effect-free check.
func health(w http.ResponseWriter, r *http.Request) {
	if !allowReadMethod(w, r) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write([]byte("ok\n"))
	}
}

// ServeHTTP maps a clean URL path to a prepared frontend file. Unknown paths
// return 404 instead of falling back to index.html because this site has no
// client-side router and silently rewriting mistakes would hide broken asset
// references.
func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !allowReadMethod(w, r) {
		return
	}

	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		// index.html points at content-addressed assets and must be revalidated on
		// every navigation so a rollout is visible without a stale shell page.
		// "no-cache" keeps that guarantee — a revalidation is still mandatory —
		// while allowing the edge and browser to STORE the shell, so an unchanged
		// site answers a navigation with a small 304 instead of shipping the whole
		// document from the origin again. "no-store" would forbid storage outright
		// and make every navigation a full origin round trip for no safety gain:
		// this document is public, holds no visitor data, and its ETag is a digest.
		//
		// The document is also the one response that varies by the theme cookie.
		// Because no-cache permits storing it, Vary: Cookie is meaningful here —
		// it keys stored copies per variant so a shared cache can never satisfy
		// one visitor's navigation with another visitor's theme. Every other
		// response is cookie-independent and deliberately carries no Vary.
		w.Header().Add("Vary", "Cookie")
		h.documentVariant(r).serveTo(w, r, "index.html")
		return
	}
	// Traversal, directory, placeholder, and unknown names all miss the
	// prepared table, so every invalid shape shares one indistinguishable 404.
	file, ok := h.files[name]
	if !ok {
		http.NotFound(w, r)
		return
	}
	file.serveTo(w, r, name)
}

// documentVariant selects the precomputed index.html for this visitor. A
// theme cookie naming a registered reading mode selects its stamped variant;
// every other state — no cookie, an unregistered value, case drift, hostile
// garbage — fails closed to the unstamped default, whose tokens follow
// prefers-color-scheme. All bytes and validators were prepared at
// construction, so this is one parse and one map lookup on the hot path.
func (h *handler) documentVariant(r *http.Request) *staticFile {
	cookie, err := r.Cookie(themeCookie)
	if err != nil {
		return h.index
	}
	if variant, ok := h.themed[cookie.Value]; ok {
		return variant
	}
	return h.index
}

// rejectAmbiguousPath runs before ServeMux so it returns a terminal 404 instead
// of redirecting traversal or duplicate-separator input to a different route.
// Canonical paths make the edge, Go router, and rooted filesystem agree on the
// exact resource a visitor requested.
func rejectAmbiguousPath(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.ContainsAny(r.URL.Path, "\\\x00") || path.Clean(r.URL.Path) != r.URL.Path {
			http.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// serveTo applies the prepared cache metadata and delegates byte-range,
// conditional, and HEAD behavior to net/http. Every part of the response
// identity was derived at construction time, keeping this hot path free of
// hashing, filesystem access, and error branches. contentType is non-empty by
// construction, so ServeContent never falls back to sniffing the body.
func (f *staticFile) serveTo(w http.ResponseWriter, r *http.Request, name string) {
	w.Header().Set("Cache-Control", f.cacheControl)
	w.Header().Set("ETag", f.etag)
	w.Header().Set("Content-Type", f.contentType)
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(f.body))
}

// securityHeaders enforces the browser-security baseline at the origin as
// defense in depth if an edge rule is later changed. HSTS is the one header
// of that set with two layers in play, so what follows records observed
// outcomes rather than a mechanism this origin is in no position to see.
//
// Since 2026-08-22 a public request over the proxied path is answered with
// exactly one Strict-Transport-Security header, and its value is
// max-age=31536000; includeSubDomains. The edge is therefore the
// visitor-facing HSTS owner: the promise browsers are actually told, and its
// scope, are settled there and not here (the observed value carries no
// preload directive). The value this function mints — max-age=31536000, no
// includeSubDomains — was NOT observed on that path in the measurements
// recorded on issue #115. Why is not decidable from outside, and this comment
// deliberately asserts neither answer: a public response cannot distinguish a
// promise the origin never minted, because that leg was not declared TLS,
// from one that did not arrive intact, and both would produce exactly what
// was measured.
//
// The origin's own header stays on purpose. It is the promise an
// origin-direct client receives if the edge is ever bypassed — defense in
// depth is the whole reason it exists — and with both lifetimes now at
// 31536000 seconds, includeSubDomains is the only remaining difference
// between the two layers. Neither layer closes the first-contact gap: HSTS
// binds a browser only once it has been told (RFC 6797 §14.6), never the
// request that tells it, which is why the plain-HTTP redirect below is a
// separate control and not a restatement of this one.
//
// The header accompanies only requests the edge declares as TLS: an HSTS pin
// teaches a browser to refuse plain HTTP for a year, so it must never ride a
// response whose public leg was not demonstrably secure — and probe or
// port-forward traffic that never crossed the edge states no proto and
// correctly earns no promise.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		w.Header().Set("Permissions-Policy", "camera=(), geolocation=(), microphone=()")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if r.Header.Get(forwardedProtoHeader) == forwardedProtoHTTPS {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

// redirectForwardedHTTP answers every request the edge declares as plain HTTP
// with a permanent redirect to the identical URL over TLS — origin-side
// defense in depth behind the edge's own HTTPS enforcement, closing the
// window where a plain http:// navigation would otherwise receive 200
// content. The host comes from the request's Host header (the edge binds it
// to the site hostname), and RequestURI preserves the escaped path and query
// byte for byte. Only the exact lowercase declaration redirects (see
// forwardedProtoHTTP); http.Redirect keeps HEAD and POST bodiless and gives
// GET the standard hyperlink stub. The redirect runs inside securityHeaders —
// so even the bounce carries the baseline policy, minus the HSTS promise the
// plain leg has not earned — and ahead of routing, so every path, including
// probes and 404s, is bounced before any content decision is made.
func redirectForwardedHTTP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(forwardedProtoHeader) == forwardedProtoHTTP {
			// 308, not 301: a permanent redirect that preserves the method and
			// body. This origin is GET/HEAD-only today, so the choice is inert
			// here — but it keeps the two site repositories' backstop
			// byte-identical with the sibling's gated write routes, where a 301
			// would silently rewrite a POST to GET and drop its body. The edge's
			// own Always-Use-HTTPS stays the primary redirect; this is the
			// origin backstop.
			http.Redirect(w, r, "https://"+r.Host+r.URL.RequestURI(), http.StatusPermanentRedirect)
			return
		}
		next.ServeHTTP(w, r)
	})
}
