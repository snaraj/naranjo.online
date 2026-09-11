// handler_test locks the HTTP contract of both panel routes — headers,
// conditional revalidation, opaque 404s, the read-only method policy — and
// enforces the owner's performance budgets as tests: the index answer stays
// within 4 KiB, every panel envelope within 128 KiB, and the numbers
// themselves are pinned so the budget cannot drift silently.
package panels

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

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
// direction. The reasoning, the measurement, and why equality with
// seal.MaxSealedBytes is NOT equality of meaning are recorded once at the
// constant in types.go. The pin below moved WITH the budget in the same
// commit, which is the point of pinning one rather than documenting it: the
// number cannot change quietly.
func TestResponsesStayWithinTheOwnerBudgets(t *testing.T) {
	t.Parallel()
	if MaxIndexResponseBytes != 4096 {
		t.Errorf("MaxIndexResponseBytes = %d, want the owner's 4 KiB budget", MaxIndexResponseBytes)
	}
	if MaxPanelResponseBytes != 131072 {
		t.Errorf("MaxPanelResponseBytes = %d, want the owner's 128 KiB budget", MaxPanelResponseBytes)
	}
	// The serve gate and the transport ceiling hold the same VALUE, and this
	// pins only the weaker, true property that supports: the LAST step no
	// longer hides a smaller ceiling than the four before it. It does NOT
	// mean a transportable document is a servable one — the two bound
	// different bytes, and types.go records why (2026-08-25 round-4 review,
	// finding 7). The guarantee is the refusal path, not the arithmetic.
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

// TestActivityPayloadFitsTheOwnerBudget is the payload half of issue #315's
// row-cap raise, measured rather than assumed — the same shape CapParityTest
// gives the sealed usage document, and the reason docs/panels-invariants.md
// carries the number.
//
// The MAXIMAL payload is built rather than sampled: a full year of week
// columns at five-digit daily counts, maxServedCommits public rows each
// carrying a forty-hex identity, the longest repository name the grammar
// admits, and a subject at the truncation bound; plus one private aggregate
// per day of the log window, at the widest figures those counts can reach.
// Nothing a live round can produce is larger, because every term here is at
// the bound its own admission enforces.
func TestActivityPayloadFitsTheOwnerBudget(t *testing.T) {
	t.Parallel()
	payload := VCSActivityData{
		TotalContributions: 99999,
		Streak:             999,
		EndDate:            "2026-09-11",
		CommitsAt:          "2026-09-11T23:08:18Z",
		Coverage:           CoverageComplete,
		Weeks:              make([][]int, 0, maxCalendarDays/daysPerWeek+1),
		RecentCommits:      make([]VCSCommit, 0, maxServedCommits),
		PrivateActivity:    make([]VCSPrivateDay, 0, commitLogWindowDays),
	}
	for range maxCalendarDays/daysPerWeek + 1 {
		week := make([]int, daysPerWeek)
		for day := range week {
			// Five digits per cell: the owner's busiest measured day is three,
			// so this is two orders of magnitude of headroom on the term that
			// dominates the payload.
			week[day] = 99999
		}
		payload.Weeks = append(payload.Weeks, week)
	}
	name := strings.Repeat("r", maxRepositoryNameRunes)
	subject := strings.Repeat("s", maxCommitMessageRunes) + "…"
	for index := range maxServedCommits {
		payload.RecentCommits = append(payload.RecentCommits, VCSCommit{
			Repo:    name,
			SHA:     fmt.Sprintf("%040x", index+1),
			Message: subject,
			At:      "2026-09-11T23:08:18Z",
		})
	}
	for index := range commitLogWindowDays {
		payload.PrivateActivity = append(payload.PrivateActivity, VCSPrivateDay{
			Date:          time.Date(2026, 9, 11, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -index).Format(dayLayout),
			Contributions: 9999,
			Repositories:  maxContributionRepositories,
		})
	}
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal the maximal payload: %v", err)
	}
	envelope, err := json.Marshal(Envelope{
		Schema: EnvelopeSchema, ID: "vcs-activity", Kind: KindVCSActivity,
		Title: "A title as long as any this registry configures", GeneratedAt: "2026-09-11T23:08:20Z",
		Status: StatusOK, Data: data,
	})
	if err != nil {
		t.Fatalf("marshal the maximal envelope: %v", err)
	}
	// The measured figure, recorded in docs/panels-invariants.md. It is
	// asserted as a CEILING with its headroom named rather than as an equality,
	// because a payload that shrinks is not a regression — but one that grows
	// past this without somebody re-measuring is.
	const measured = 15000
	if len(envelope) > measured {
		t.Errorf("the maximal activity envelope is %d bytes, over the %d recorded in docs/panels-invariants.md; re-measure before raising it", len(envelope), measured)
	}
	if len(envelope) > MaxPanelResponseBytes {
		t.Errorf("the maximal activity envelope is %d bytes, over the owner's %d budget", len(envelope), MaxPanelResponseBytes)
	}
	t.Logf("maximal vcs-activity envelope: %d bytes, %d under the %d budget", len(envelope), MaxPanelResponseBytes-len(envelope), MaxPanelResponseBytes)
}

// TestProjectsPayloadFitsTheOwnerBudget is the same measurement for the
// repository table's payload after issue #317 added two fields to every row.
func TestProjectsPayloadFitsTheOwnerBudget(t *testing.T) {
	t.Parallel()
	stars := int64(maxCountValue)
	pulls := int64(maxCountValue)
	payload := CodingProjectsData{Repos: make([]CodingProject, 0, maxCodingProjectSources)}
	for range maxCodingProjectSources {
		payload.Repos = append(payload.Repos, CodingProject{
			Name:        strings.Repeat("r", maxRepositoryNameRunes),
			Description: strings.Repeat("d", maxProjectDescriptionRunes) + "…",
			Stars:       &stars,
			PushedAt:    "2026-09-11T22:46:22Z",
			ClosedPulls: &pulls,
			Release:     strings.Repeat("v", maxReleaseTagRunes),
			Pinned:      true,
			Recorded:    true,
		})
	}
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal the maximal payload: %v", err)
	}
	envelope, err := json.Marshal(Envelope{
		Schema: EnvelopeSchema, ID: "coding-projects", Kind: KindCodingProjects,
		Title: "A title as long as any this registry configures", GeneratedAt: "2026-09-11T23:07:45Z",
		Status: StatusOK, Data: data,
	})
	if err != nil {
		t.Fatalf("marshal the maximal envelope: %v", err)
	}
	const measured = 8000
	if len(envelope) > measured {
		t.Errorf("the maximal projects envelope is %d bytes, over the %d recorded in docs/panels-invariants.md; re-measure before raising it", len(envelope), measured)
	}
	if len(envelope) > MaxPanelResponseBytes {
		t.Errorf("the maximal projects envelope is %d bytes, over the owner's %d budget", len(envelope), MaxPanelResponseBytes)
	}
	t.Logf("maximal coding-projects envelope: %d bytes, %d under the %d budget", len(envelope), MaxPanelResponseBytes-len(envelope), MaxPanelResponseBytes)
}
