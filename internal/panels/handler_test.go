// handler_test locks the HTTP contract of both panel routes — headers,
// conditional revalidation, opaque 404s, the read-only method policy — and
// enforces the owner's performance budgets as tests: the index answer stays
// within 4 KiB, every panel envelope within 128 KiB, and the numbers
// themselves are pinned so the budget cannot drift silently.
package panels

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/snaraj/naranjo.online/internal/seal"
)

// panelsGet performs one recorded GET against the production registry.
func panelsGet(t *testing.T, registry *Registry, target string) *httptest.ResponseRecorder {
	t.Helper()
	response := httptest.NewRecorder()
	registry.ServeHTTP(response, httptest.NewRequest(http.MethodGet, target, nil))
	return response
}

// TestPanelResponsesJoinTheRevalidatedCacheClass pins the response headers of
// both routes: JSON content, the site's no-cache class, and a strong digest
// ETag that answers a replayed validator with an empty 304 — the exact
// browser flow the shell document already uses.
func TestPanelResponsesJoinTheRevalidatedCacheClass(t *testing.T) {
	t.Parallel()
	registry := New(nil)
	for _, target := range []string{IndexPath, PanelPathPrefix + "boss-log"} {
		first := panelsGet(t, registry, target)
		if first.Code != http.StatusOK {
			t.Fatalf("GET %s = %d", target, first.Code)
		}
		if got := first.Header().Get("Content-Type"); got != "application/json" {
			t.Errorf("%s Content-Type = %q", target, got)
		}
		if got := first.Header().Get("Cache-Control"); got != "no-cache" {
			t.Errorf("%s Cache-Control = %q, want the revalidated class", target, got)
		}
		etag := first.Header().Get("ETag")
		if len(etag) < 2 || !strings.HasPrefix(etag, `"`) {
			t.Fatalf("%s ETag = %q, want a quoted strong validator", target, etag)
		}
		revisit := httptest.NewRequest(http.MethodGet, target, nil)
		revisit.Header.Set("If-None-Match", etag)
		second := httptest.NewRecorder()
		registry.ServeHTTP(second, revisit)
		if second.Code != http.StatusNotModified || second.Body.Len() != 0 {
			t.Errorf("revisit %s = %d with %d body bytes, want an empty 304", target, second.Code, second.Body.Len())
		}
	}
}

// TestPanelHeadRequestsCarryNoBody pins HEAD support on both routes: the
// metadata a browser preflight needs — Content-Length included — with zero
// payload bytes.
func TestPanelHeadRequestsCarryNoBody(t *testing.T) {
	t.Parallel()
	registry := New(nil)
	for _, target := range []string{IndexPath, PanelPathPrefix + "token-usage"} {
		response := httptest.NewRecorder()
		registry.ServeHTTP(response, httptest.NewRequest(http.MethodHead, target, nil))
		if response.Code != http.StatusOK || response.Body.Len() != 0 {
			t.Errorf("HEAD %s = %d with %d body bytes", target, response.Code, response.Body.Len())
		}
		if response.Header().Get("Content-Length") == "" {
			t.Errorf("HEAD %s carries no Content-Length", target)
		}
	}
}

// TestRangeRequestsServeTheWholeDocument pins the reviewer-flagged decision
// as behavior: panel JSON does not participate in byte-range serving. A
// Range request is answered like any other GET — 200, the complete body, no
// Accept-Ranges offer, no Content-Range — because these are small whole
// documents and 206 semantics have been deliberately removed from this API.
func TestRangeRequestsServeTheWholeDocument(t *testing.T) {
	t.Parallel()
	registry := New(nil)
	full := panelsGet(t, registry, PanelPathPrefix+"boss-log")
	ranged := httptest.NewRequest(http.MethodGet, PanelPathPrefix+"boss-log", nil)
	ranged.Header.Set("Range", "bytes=0-3")
	response := httptest.NewRecorder()
	registry.ServeHTTP(response, ranged)
	if response.Code != http.StatusOK {
		t.Fatalf("ranged GET = %d, want a plain 200", response.Code)
	}
	if response.Body.Len() != full.Body.Len() {
		t.Errorf("ranged GET served %d bytes, want the full %d-byte document", response.Body.Len(), full.Body.Len())
	}
	for _, header := range []string{"Accept-Ranges", "Content-Range"} {
		if got := response.Header().Get(header); got != "" {
			t.Errorf("%s = %q, want no byte-range participation", header, got)
		}
	}
}

// TestConditionalVariantsRevalidate pins the manual validator compare
// against the RFC shapes browsers and caches actually send: exact, list,
// weak-prefixed, and wildcard all answer 304; a stale validator misses.
func TestConditionalVariantsRevalidate(t *testing.T) {
	t.Parallel()
	registry := New(nil)
	etag := panelsGet(t, registry, IndexPath).Header().Get("ETag")
	for name, value := range map[string]string{
		"exact validator":    etag,
		"validator list":     `"stale", ` + etag,
		"weak validator":     "W/" + etag,
		"any representation": "*",
	} {
		request := httptest.NewRequest(http.MethodGet, IndexPath, nil)
		request.Header.Set("If-None-Match", value)
		response := httptest.NewRecorder()
		registry.ServeHTTP(response, request)
		if response.Code != http.StatusNotModified || response.Body.Len() != 0 {
			t.Errorf("%s: got %d with %d body bytes, want an empty 304", name, response.Code, response.Body.Len())
		}
	}
	request := httptest.NewRequest(http.MethodGet, IndexPath, nil)
	request.Header.Set("If-None-Match", `"different"`)
	response := httptest.NewRecorder()
	registry.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Errorf("stale validator answered %d, want a fresh 200", response.Code)
	}
}

// TestOversizedIndexDegradesToEmpty pins the structural index budget the
// adversarial review asked for: a listing that cannot fit the owner's 4 KiB
// budget serves as an empty — loudly wrong, instantly caught — index rather
// than an oversized response.
func TestOversizedIndexDegradesToEmpty(t *testing.T) {
	t.Parallel()
	fsys := fstest.MapFS{"snapshots/broken.json": {Data: validSnapshot(t)}}
	registry := newRegistry(fsys, []panelDefinition{{
		id:     "giant",
		kind:   KindBossLog,
		title:  strings.Repeat("t", MaxIndexResponseBytes),
		source: SnapshotSource{Name: "snapshots/broken.json"},
	}})
	response := panelsGet(t, registry, IndexPath)
	if response.Body.Len() > MaxIndexResponseBytes {
		t.Fatalf("degraded index is %d bytes, still over budget", response.Body.Len())
	}
	if got := strings.TrimSpace(response.Body.String()); got != `{"panels":[]}` {
		t.Errorf("degraded index = %s, want the empty listing", got)
	}
}

// TestUnknownPanelShapesShareOneOpaque404 collapses every invalid request
// shape — unknown id, nested path, bare prefix remainder — into the same
// default 404 a missing frontend file produces.
func TestUnknownPanelShapesShareOneOpaque404(t *testing.T) {
	t.Parallel()
	registry := New(nil)
	for name, target := range map[string]string{
		"unknown id":       PanelPathPrefix + "listening-stats",
		"nested path":      PanelPathPrefix + "boss-log/raids",
		"empty id":         PanelPathPrefix,
		"case mismatch":    PanelPathPrefix + "Boss-Log",
		"unmatched prefix": "/api/panelsextra",
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			response := panelsGet(t, registry, target)
			if response.Code != http.StatusNotFound {
				t.Fatalf("GET %s = %d, want 404", target, response.Code)
			}
			if got := strings.TrimSpace(response.Body.String()); got != "404 page not found" {
				t.Errorf("GET %s body = %q; it must stay the opaque default", target, got)
			}
		})
	}
}

// TestPanelRoutesRefuseEveryMutatingMethod extends the site's read-only
// 0-RTT safety contract to the panel API: reads only, one refusal shape.
func TestPanelRoutesRefuseEveryMutatingMethod(t *testing.T) {
	t.Parallel()
	registry := New(nil)
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions} {
		for _, target := range []string{IndexPath, PanelPathPrefix + "boss-log"} {
			response := httptest.NewRecorder()
			registry.ServeHTTP(response, httptest.NewRequest(method, target, nil))
			if response.Code != http.StatusMethodNotAllowed {
				t.Errorf("%s %s = %d, want 405", method, target, response.Code)
			}
			if got := response.Header().Get("Allow"); got != "GET, HEAD" {
				t.Errorf("%s %s Allow = %q", method, target, got)
			}
		}
	}
}

// TestResponsesStayWithinTheOwnerBudgets enforces the performance budgets as
// tests, per the owner's standing priority: the index body at or under
// 4 KiB, every panel envelope at or under 128 KiB — measured on the exact
// bytes the handler serves — and the budget constants pinned to the numbers
// the owner set, so neither can drift without a conscious edit here.
//
// The panel budget moved from 32 KiB to 128 KiB on 2026-08-24 by owner
// direction; the reasoning and the measurement are recorded at the constant
// in types.go. Equal to seal.MaxSealedBytes is NOT equal in meaning: see the
// comment on that comparison below, and the 2026-08-25 round-4 review's
// finding 7. The pin below moved WITH it in the same commit, which is the
// point of pinning a budget rather than merely documenting one: the number
// cannot change quietly, and changing it is a conscious edit that lands in
// the diff a reviewer reads.
func TestResponsesStayWithinTheOwnerBudgets(t *testing.T) {
	t.Parallel()
	if MaxIndexResponseBytes != 4096 {
		t.Errorf("MaxIndexResponseBytes = %d, want the owner's 4 KiB budget", MaxIndexResponseBytes)
	}
	if MaxPanelResponseBytes != 131072 {
		t.Errorf("MaxPanelResponseBytes = %d, want the owner's 128 KiB budget", MaxPanelResponseBytes)
	}
	// The serve gate and the transport ceiling hold the same VALUE, and this
	// pins that — but only the weaker, true property it supports.
	//
	// The 2026-08-25 round-4 review found the stronger claim here and in
	// types.go: that equal values mean "a document the pipeline can carry is
	// a document the origin can serve". They do not, because the two bounds
	// measure different bytes. This one bounds the finished ENVELOPE — the
	// payload merged onto the embedded snapshot, plus the envelope
	// scaffolding — and seal.MaxSealedBytes bounds the sealed FILE, so the
	// served bytes are strictly more than the transported ones. The maximal
	// admissible document measures the gap at +875 bytes (103,633 sealed,
	// 104,508 served; TestTheMaximalDocumentFitsTheRaisedBudget in
	// dataroot_test.go logs both), and a snapshot with more rows widens it
	// without bound. A file sealed at exactly the ceiling is refused at
	// serve time, and TestDataRootRefusesAnOverBudgetEnvelope drives exactly
	// that case.
	//
	// So what equality buys is narrower and still worth pinning: the LAST
	// step no longer hides a smaller ceiling than the four before it, which
	// is the regression this catches. The guarantee is the refusal path, not
	// the arithmetic.
	if MaxPanelResponseBytes != seal.MaxSealedBytes {
		t.Errorf("the panel budget (%d) and the sealed-payload ceiling (%d) have diverged; the serve step would again be the surprising one",
			MaxPanelResponseBytes, seal.MaxSealedBytes)
	}
	registry := New(nil)
	index := panelsGet(t, registry, IndexPath)
	if index.Code != http.StatusOK {
		t.Fatalf("GET %s = %d", IndexPath, index.Code)
	}
	if size := index.Body.Len(); size > MaxIndexResponseBytes {
		t.Errorf("index response is %d bytes, over the %d budget", size, MaxIndexResponseBytes)
	}
	for _, definition := range builtinPanels {
		response := panelsGet(t, registry, PanelPathPrefix+definition.id)
		if response.Code != http.StatusOK {
			t.Fatalf("GET %s = %d", PanelPathPrefix+definition.id, response.Code)
		}
		if size := response.Body.Len(); size > MaxPanelResponseBytes {
			t.Errorf("panel %s response is %d bytes, over the %d budget", definition.id, size, MaxPanelResponseBytes)
		}
	}
}
