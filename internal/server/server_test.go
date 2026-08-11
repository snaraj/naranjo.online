// Package server tests the origin HTTP contract independently from the frontend
// toolchain by supplying a small in-memory filesystem.
package server

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

// testHandler builds the production handler around deterministic in-memory
// files, isolating HTTP policy tests from frontend compilation details.
func testHandler(t *testing.T) http.Handler {
	t.Helper()
	assets := fstest.MapFS{
		"index.html":        &fstest.MapFile{Data: []byte("<!doctype html><h1>Hello World!</h1>")},
		"assets/app-abc.js": &fstest.MapFile{Data: []byte("console.log('hello')")},
		".gitkeep":          &fstest.MapFile{Data: []byte("build placeholder")},
		// An extensionless name resolves to no registered MIME type on every
		// platform, and its deliberately sniffable HTML body proves the pinned
		// octet-stream policy — not content sniffing — decides the type.
		"downloads/blob": &fstest.MapFile{Data: []byte("<!doctype html><script>sniffable</script>")},
	}
	var filesystem fs.FS = assets
	siteHandler, err := New(filesystem)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	return siteHandler
}

// TestRootAndSecurityHeaders protects the uncached document response and the
// browser-security baseline that must remain present behind Cloudflare.
func TestRootAndSecurityHeaders(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "https://example.invalid/", nil)
	response := httptest.NewRecorder()
	testHandler(t).ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), "Hello World!") {
		t.Fatalf("body does not contain Hello World!: %q", response.Body.String())
	}
	for _, header := range []string{"Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options"} {
		if response.Header().Get(header) == "" {
			t.Errorf("missing header %s", header)
		}
	}
	if got := response.Header().Get("Strict-Transport-Security"); got != "max-age=31536000" {
		t.Errorf("Strict-Transport-Security = %q", got)
	}
	if got := response.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("Cache-Control = %q", got)
	}
}

// TestNoRequestMethodCanEverMutate is the executable safety contract that
// permits TLS 1.3 0-RTT (early data) at the edge. 0-RTT carries a replay risk,
// so it is only admissible where no request can change server state. Every
// route here answers reads and refuses every mutating method, and this test
// exists so that property can never silently regress into a replayable one.
func TestNoRequestMethodCanEverMutate(t *testing.T) {
	siteHandler := testHandler(t)
	mutating := []string{
		http.MethodPost,
		http.MethodPut,
		http.MethodPatch,
		http.MethodDelete,
	}
	routes := []string{"/", "/livez", "/readyz", "/assets/app-abc.js", "/missing"}
	for _, route := range routes {
		for _, method := range mutating {
			response := httptest.NewRecorder()
			siteHandler.ServeHTTP(response, httptest.NewRequest(method, route, nil))
			if response.Code == http.StatusOK {
				t.Errorf("%s %s was accepted; 0-RTT requires every route to be read-only", method, route)
			}
		}
	}
}

// TestAssetCachingAndConditionalRequest verifies that hashed assets are durable
// cache entries while still participating in standard conditional requests.
func TestAssetCachingAndConditionalRequest(t *testing.T) {
	siteHandler := testHandler(t)
	first := httptest.NewRecorder()
	siteHandler.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/assets/app-abc.js", nil))
	if first.Code != http.StatusOK {
		t.Fatalf("first status = %d", first.Code)
	}
	if got := first.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q", got)
	}
	secondRequest := httptest.NewRequest(http.MethodGet, "/assets/app-abc.js", nil)
	secondRequest.Header.Set("If-None-Match", first.Header().Get("ETag"))
	second := httptest.NewRecorder()
	siteHandler.ServeHTTP(second, secondRequest)
	if second.Code != http.StatusNotModified {
		t.Fatalf("conditional status = %d", second.Code)
	}
}

// TestAssetRFCPreconditions delegates nuanced validator semantics to net/http
// and locks in the weak, list, wildcard, and failed-precondition cases we rely on.
func TestAssetRFCPreconditions(t *testing.T) {
	siteHandler := testHandler(t)
	initial := httptest.NewRecorder()
	siteHandler.ServeHTTP(initial, httptest.NewRequest(http.MethodGet, "/assets/app-abc.js", nil))
	etag := initial.Header().Get("ETag")
	if etag == "" {
		t.Fatal("initial response has no ETag")
	}

	for name, value := range map[string]string{
		"weak validator":     "W/" + etag,
		"validator list":     `"stale", ` + etag,
		"any representation": "*",
	} {
		t.Run(name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/assets/app-abc.js", nil)
			request.Header.Set("If-None-Match", value)
			response := httptest.NewRecorder()
			siteHandler.ServeHTTP(response, request)
			if response.Code != http.StatusNotModified {
				t.Fatalf("status = %d for If-None-Match %q", response.Code, value)
			}
		})
	}

	request := httptest.NewRequest(http.MethodGet, "/assets/app-abc.js", nil)
	request.Header.Set("If-Match", `"stale"`)
	response := httptest.NewRecorder()
	siteHandler.ServeHTTP(response, request)
	if response.Code != http.StatusPreconditionFailed {
		t.Fatalf("status = %d for a failed If-Match", response.Code)
	}
}

// TestEmbeddedContentTypePolicy locks the construction-time Content-Type
// decision: registered extensions resolve through the MIME registry, and an
// unknown embedded extension is pinned to application/octet-stream instead of
// being left empty for ServeContent to sniff. The embedded bundle is
// build-controlled, so an unknown extension is a packaging surprise and
// sniffing it into a browser-active type is the only risk being closed; unlike
// the operator-managed media tree, no attachment Content-Disposition is
// needed for build artifacts.
func TestEmbeddedContentTypePolicy(t *testing.T) {
	siteHandler := testHandler(t)
	for name, row := range map[string]struct {
		target      string
		contentType string
	}{
		// text/html is identical across the Go builtin table and every host
		// registry, so the exact pin is portable; other registered extensions
		// legitimately vary by host table and are covered by the non-sniffing
		// guarantee rather than exact values.
		"registered extension": {target: "/", contentType: "text/html; charset=utf-8"},
		"unknown extension":    {target: "/downloads/blob", contentType: "application/octet-stream"},
	} {
		t.Run(name, func(t *testing.T) {
			response := httptest.NewRecorder()
			siteHandler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, row.target, nil))
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d", response.Code)
			}
			if got := response.Header().Get("Content-Type"); got != row.contentType {
				t.Errorf("Content-Type = %q, want %q", got, row.contentType)
			}
			if got := response.Header().Get("X-Content-Type-Options"); got != "nosniff" {
				t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
			}
			// Embedded files are never download-forced: the bundle is reviewed at
			// build time, so no Content-Disposition accompanies the pinned type.
			if got := response.Header().Get("Content-Disposition"); got != "" {
				t.Errorf("Content-Disposition = %q, want none for embedded files", got)
			}
		})
	}
}

// TestHealthMethodsAndMissingPath keeps probes read-only and confirms that
// unknown, traversal, and repository-placeholder paths are never served.
func TestHealthMethodsAndMissingPath(t *testing.T) {
	siteHandler := testHandler(t)
	for _, endpoint := range []string{"/livez", "/readyz"} {
		response := httptest.NewRecorder()
		siteHandler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, endpoint, nil))
		if response.Code != http.StatusOK || response.Body.String() != "ok\n" {
			t.Errorf("%s = %d %q", endpoint, response.Code, response.Body.String())
		}
	}
	post := httptest.NewRecorder()
	siteHandler.ServeHTTP(post, httptest.NewRequest(http.MethodPost, "/", nil))
	if post.Code != http.StatusMethodNotAllowed || post.Header().Get("Allow") != "GET, HEAD" {
		t.Errorf("POST = %d Allow=%q", post.Code, post.Header().Get("Allow"))
	}
	missing := httptest.NewRecorder()
	siteHandler.ServeHTTP(missing, httptest.NewRequest(http.MethodGet, "/missing", nil))
	if missing.Code != http.StatusNotFound {
		t.Errorf("missing status = %d", missing.Code)
	}
	placeholder := httptest.NewRecorder()
	siteHandler.ServeHTTP(placeholder, httptest.NewRequest(http.MethodGet, "/.gitkeep", nil))
	if placeholder.Code != http.StatusNotFound {
		t.Errorf(".gitkeep status = %d", placeholder.Code)
	}
	traversal := httptest.NewRecorder()
	direct := &handler{files: map[string]*staticFile{}, index: newStaticFile("index.html", []byte("index"))}
	direct.ServeHTTP(traversal, httptest.NewRequest(http.MethodGet, "/../index.html", nil))
	if traversal.Code != http.StatusNotFound {
		t.Errorf("traversal status = %d", traversal.Code)
	}
}
