// Package server exposes the production HTTP handler for naranjo.online. It
// serves only the embedded frontend and Kubernetes health probes, keeping the
// application stateless and suitable for replicated, pull-based deployments.
package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"
)

// New constructs the complete naranjo.online HTTP handler from built frontend
// assets. Construction validates index.html up front, wires Kubernetes probe
// endpoints, and applies one security-header policy to every response.
func New(assets fs.FS) (*Site, error) {
	return newSite(assets, nil)
}

// NewWithMedia constructs the site with a separately managed read-only media
// library. Production charts deliberately cannot call this path until ADR 0012
// discovery supplies a reviewed root and concurrency budget.
func NewWithMedia(assets fs.FS, options MediaOptions) (*Site, error) {
	media, err := openMediaHandler(options)
	if err != nil {
		return nil, err
	}
	site, err := newSite(assets, media)
	if err != nil {
		_ = media.Close()
		return nil, err
	}
	return site, nil
}

// newSite wires the shared response policy after optional capabilities have
// been validated, keeping the disabled and future media-enabled paths identical
// for health probes and embedded frontend behavior.
func newSite(assets fs.FS, media *mediaHandler) (*Site, error) {
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
	mux.Handle("/", h)
	return &Site{handler: securityHeaders(rejectAmbiguousPath(mux)), media: media}, nil
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
	return &handler{files: files, index: index}, nil
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

// Close releases the optional media root. It is safe for media-disabled sites
// and is called only after the HTTP server has stopped accepting requests.
func (s *Site) Close() error {
	if s.media == nil {
		return nil
	}
	return s.media.Close()
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
		h.index.serveTo(w, r, "index.html")
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
// defense in depth if an edge rule is later changed. HSTS is deliberately scoped
// to this hostname rather than making a promise for every subdomain.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		w.Header().Set("Permissions-Policy", "camera=(), geolocation=(), microphone=()")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}
