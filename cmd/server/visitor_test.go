// visitor_test tells the production story over real transport: each test
// boots run() exactly the way main does (via bootServer) and drives it
// through the testsupport.Visitor mock-browser harness, so the suite reads as
// visitor scenarios — first visit, repeat visit, media playback, hostile
// probing — rather than isolated endpoint checks. The harness asserts the
// security-header baseline on every single navigation. These scenarios ADD
// user-story framing on top of the contract-focused e2e suites in
// main_e2e_test.go and media_lifecycle_test.go; they replace nothing.
// Sequential by design, mirroring the existing e2e discipline: every scenario
// owns a live port and ends with process-global SIGTERM delivery.
package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/snaraj/naranjo.online/internal/testsupport"
)

// drainScenario is the shared epilogue of every visitor scenario: deliver the
// same SIGTERM Kubernetes sends and require the clean drain main promises. It
// runs outside any subtest so it executes even after a failed chapter.
func drainScenario(t *testing.T, runResult <-chan error) {
	t.Helper()
	if err := syscall.Kill(os.Getpid(), syscall.SIGTERM); err != nil {
		t.Fatalf("deliver SIGTERM: %v", err)
	}
	select {
	case err := <-runResult:
		if err != nil {
			t.Fatalf("run() = %v after SIGTERM, want nil", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("run() did not drain within 15s of SIGTERM")
	}
}

// TestVisitorBrowsesTheSite is the ordinary reader's story: a first visit
// downloads the shell fresh and caches its hashed assets forever, a repeat
// visit revalidates everything down to cheap 304s, and a mistyped deep link
// stays an opaque 404 — all with the security baseline asserted by the
// harness on every navigation.
func TestVisitorBrowsesTheSite(t *testing.T) {
	requireBuiltFrontend(t)
	base, runResult := bootServer(t, nil)
	session := testsupport.NewVisitor(t, base)
	var assets []string

	t.Run("first visit: shell 200 no-cache and hashed assets immutable", func(t *testing.T) {
		visitor := session.On(t)
		shell := visitor.Navigate("/")
		if shell.StatusCode != http.StatusOK {
			t.Fatalf("GET / = %d", shell.StatusCode)
		}
		if got := shell.Header.Get("Cache-Control"); got != "no-cache" {
			t.Errorf("shell Cache-Control = %q, want no-cache", got)
		}
		if got := shell.Header.Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
			t.Errorf("shell Content-Type = %q", got)
		}
		// Structure, never copy: the static-fallback marker is the document
		// contract; the shell's text will change when the real site ships.
		if !bytes.Contains(shell.Body, []byte("data-static-fallback")) {
			t.Error("served document lacks the static application fallback marker")
		}
		assets = visitor.AssetReferences(shell.Body)
		if len(assets) == 0 {
			t.Fatal("document references no built assets to follow")
		}
		for _, asset := range assets {
			response := visitor.Navigate(asset)
			if response.StatusCode != http.StatusOK || len(response.Body) == 0 {
				t.Fatalf("GET %s = %d, %d bytes", asset, response.StatusCode, len(response.Body))
			}
			if got := response.Header.Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
				t.Errorf("%s Cache-Control = %q, want the immutable policy", asset, got)
			}
		}
	})

	t.Run("repeat visit: shell and assets revalidate to 304", func(t *testing.T) {
		visitor := session.On(t)
		if len(assets) == 0 {
			t.Skip("first visit failed; nothing cached to revalidate")
		}
		for _, path := range append([]string{"/"}, assets...) {
			response := visitor.Navigate(path)
			if response.StatusCode != http.StatusNotModified {
				t.Errorf("revisit %s = %d, want 304 from the replayed validator", path, response.StatusCode)
			}
			if len(response.Body) != 0 {
				t.Errorf("revisit %s carried %d body bytes, want an empty 304", path, len(response.Body))
			}
		}
	})

	t.Run("visitor deep-links a missing page: opaque 404, headers intact", func(t *testing.T) {
		missing := session.On(t).Navigate("/blog/first-post")
		if missing.StatusCode != http.StatusNotFound {
			t.Fatalf("GET /blog/first-post = %d, want 404", missing.StatusCode)
		}
		if got := strings.TrimSpace(string(missing.Body)); got != "404 page not found" {
			t.Errorf("404 body = %q; it must stay the opaque default", got)
		}
	})

	drainScenario(t, runResult)
}

// Panel API shapes are pinned here as independent expected values — never
// imported from internal/panels, or the assertions would become tautologies.
// A schema change must consciously edit both sides.

// visitorColdStatus pins each panel's expected status on an egress-free
// boot: fetch-backed panels serve their snapshot fallback as stale until
// live refresh is explicitly enabled; the snapshot-only panel is ok.
var visitorColdStatus = map[string]string{
	"token-usage":  "stale",
	"vcs-activity": "ok",
	"boss-log":     "stale",
}

type visitorPanelIndex struct {
	Panels []visitorPanelRow `json:"panels"`
}

type visitorPanelRow struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

type visitorPanelEnvelope struct {
	Schema      string          `json:"schema"`
	ID          string          `json:"id"`
	Kind        string          `json:"kind"`
	Title       string          `json:"title"`
	GeneratedAt string          `json:"generatedAt"`
	Status      string          `json:"status"`
	Data        json.RawMessage `json:"data"`
}

// decodeVisitorJSON strictly decodes one API body into v, so a served field
// the pinned shape does not know fails the scenario instead of hiding.
func decodeVisitorJSON(t *testing.T, body []byte, v any) {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(v); err != nil {
		t.Fatalf("decode API body %q: %v", body, err)
	}
}

// TestVisitorReadsThePanels is the dashboard reader's story over real
// transport: the index names every panel, each panel answers with the stable
// versioned envelope inside the owner's byte budgets, a later visit
// revalidates everything down to cheap 304s, and a mistyped id stays an
// opaque 404 — with the security-header and CSP baseline asserted by the
// harness on every single navigation.
func TestVisitorReadsThePanels(t *testing.T) {
	requireBuiltFrontend(t)
	base, runResult := bootServer(t, nil)
	session := testsupport.NewVisitor(t, base)
	var panelPaths []string

	t.Run("opens the index: every panel listed honestly, JSON, revalidated class", func(t *testing.T) {
		visitor := session.On(t)
		response := visitor.Navigate("/api/panels")
		if response.StatusCode != http.StatusOK {
			t.Fatalf("GET /api/panels = %d", response.StatusCode)
		}
		if got := response.Header.Get("Content-Type"); got != "application/json" {
			t.Errorf("index Content-Type = %q", got)
		}
		if got := response.Header.Get("Cache-Control"); got != "no-cache" {
			t.Errorf("index Cache-Control = %q, want no-cache", got)
		}
		// The harness already requires one of the two documented CSPs on
		// every navigation; API responses must carry the site policy exactly.
		if got := response.Header.Get("Content-Security-Policy"); got != testsupport.SiteContentSecurityPolicy {
			t.Errorf("index Content-Security-Policy = %q, want the site policy", got)
		}
		if size := len(response.Body); size > 4096 {
			t.Errorf("index response is %d bytes, over the owner's 4 KiB budget", size)
		}
		var index visitorPanelIndex
		decodeVisitorJSON(t, response.Body, &index)
		if len(index.Panels) != 3 {
			t.Fatalf("index lists %d panels, want 3", len(index.Panels))
		}
		for _, row := range index.Panels {
			if row.ID == "" || row.Title == "" || !strings.HasSuffix(row.Kind, "/v1") {
				t.Errorf("index row incomplete: %+v", row)
			}
			// Live refresh is opt-in and this boot never enables it, so
			// fetch-backed panels honestly report their snapshot fallback as
			// stale while the snapshot-only panel is ok — an independent pin
			// of the expected cold-start statuses.
			if want := visitorColdStatus[row.ID]; row.Status != want {
				t.Errorf("panel %s status = %q, want %q on an egress-free boot", row.ID, row.Status, want)
			}
			panelPaths = append(panelPaths, "/api/panels/"+row.ID)
		}
	})

	t.Run("reads each panel: the versioned envelope within budget", func(t *testing.T) {
		visitor := session.On(t)
		if len(panelPaths) == 0 {
			t.Skip("index chapter failed; no panels to read")
		}
		for _, path := range panelPaths {
			response := visitor.Navigate(path)
			if response.StatusCode != http.StatusOK {
				t.Fatalf("GET %s = %d", path, response.StatusCode)
			}
			if size := len(response.Body); size > 32768 {
				t.Errorf("%s response is %d bytes, over the owner's 32 KiB budget", path, size)
			}
			var envelope visitorPanelEnvelope
			decodeVisitorJSON(t, response.Body, &envelope)
			if envelope.Schema != "panel/v1" {
				t.Errorf("%s schema = %q, want panel/v1", path, envelope.Schema)
			}
			if "/api/panels/"+envelope.ID != path || envelope.Title == "" {
				t.Errorf("%s envelope identity = %+v", path, envelope)
			}
			if want := visitorColdStatus[envelope.ID]; envelope.Status != want {
				t.Errorf("%s status = %q, want %q on an egress-free boot", path, envelope.Status, want)
			}
			if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
				t.Errorf("%s serves no data", path)
			}
			if _, err := time.Parse(time.RFC3339, envelope.GeneratedAt); err != nil {
				t.Errorf("%s generatedAt = %q: %v", path, envelope.GeneratedAt, err)
			}
		}
	})

	t.Run("returns later: remembered validators answer 304", func(t *testing.T) {
		visitor := session.On(t)
		if len(panelPaths) == 0 {
			t.Skip("index chapter failed; nothing cached to revalidate")
		}
		for _, path := range append([]string{"/api/panels"}, panelPaths...) {
			response := visitor.Navigate(path)
			if response.StatusCode != http.StatusNotModified {
				t.Errorf("revisit %s = %d, want 304 from the replayed validator", path, response.StatusCode)
			}
			if len(response.Body) != 0 {
				t.Errorf("revisit %s carried %d body bytes, want an empty 304", path, len(response.Body))
			}
		}
	})

	t.Run("mistypes a panel id: opaque 404, headers intact", func(t *testing.T) {
		missing := session.On(t).Navigate("/api/panels/listening-stats")
		if missing.StatusCode != http.StatusNotFound {
			t.Fatalf("GET /api/panels/listening-stats = %d, want 404", missing.StatusCode)
		}
		if got := strings.TrimSpace(string(missing.Body)); got != "404 page not found" {
			t.Errorf("404 body = %q; it must stay the opaque default", got)
		}
	})

	drainScenario(t, runResult)
}

// TestVisitorPlaysMedia is the future music-and-video story on the
// media-enabled boot: press play for a full 200 stream, scrub with a Range
// request for a 206, and replay from cache as a 304 — the digest ETag doing
// the browser's work.
func TestVisitorPlaysMedia(t *testing.T) {
	requireBuiltFrontend(t)
	base, runResult := bootServer(t, map[string]string{
		"MEDIA_ENABLED":        "true",
		"MEDIA_ROOT":           testsupport.MediaRoot(t),
		"MEDIA_MAX_CONCURRENT": "2",
	})
	session := testsupport.NewVisitor(t, base)
	clip := testsupport.ImmutableClipPath()

	t.Run("plays the clip: full 200 stream with its digest identity", func(t *testing.T) {
		play := session.On(t).Navigate(clip)
		if play.StatusCode != http.StatusOK || !bytes.Equal(play.Body, []byte(testsupport.MediaFileContent)) {
			t.Fatalf("GET %s = %d, %d bytes", clip, play.StatusCode, len(play.Body))
		}
		for header, want := range map[string]string{
			"Accept-Ranges": "bytes",
			"Cache-Control": "public, max-age=31536000, immutable",
			"Content-Type":  "video/mp4",
			"ETag":          `"` + testsupport.MediaDigest + `"`,
		} {
			if got := play.Header.Get(header); got != want {
				t.Errorf("%s = %q, want %q", header, got, want)
			}
		}
	})

	t.Run("seeks like a player: byte range answers 206", func(t *testing.T) {
		seek := session.On(t).Seek(clip, "bytes=2-5")
		if seek.StatusCode != http.StatusPartialContent || string(seek.Body) != "2345" {
			t.Fatalf("seek = %d %q, want 206 %q", seek.StatusCode, seek.Body, "2345")
		}
		if got := seek.Header.Get("Content-Range"); got != "bytes 2-5/10" {
			t.Errorf("Content-Range = %q", got)
		}
	})

	t.Run("replays from cache: remembered validator answers 304", func(t *testing.T) {
		replay := session.On(t).Navigate(clip)
		if replay.StatusCode != http.StatusNotModified || len(replay.Body) != 0 {
			t.Fatalf("replay = %d with %d body bytes, want an empty 304", replay.StatusCode, len(replay.Body))
		}
	})

	drainScenario(t, runResult)
}

// TestHostileVisitorStaysBlind probes the media-enabled boot the way an
// attacker's crawler would — traversal, encoded traversal, duplicate
// separators, dotfiles, and every reserved operator namespace — and requires
// each answer to be the same opaque 404 with the security baseline intact
// (asserted by the harness on every navigation).
func TestHostileVisitorStaysBlind(t *testing.T) {
	requireBuiltFrontend(t)
	base, runResult := bootServer(t, map[string]string{
		"MEDIA_ENABLED":        "true",
		"MEDIA_ROOT":           testsupport.MediaRoot(t),
		"MEDIA_MAX_CONCURRENT": "2",
	})
	session := testsupport.NewVisitor(t, base)

	probes := map[string]string{
		"path traversal":      "/media/../index.html",
		"encoded traversal":   "/media/%2e%2e/index.html",
		"duplicate separator": "//etc/passwd",
		"dotfile":             "/media/mutable/.env",
		"bare media index":    "/media/",
	}
	// Every reserved operator namespace must stay indistinguishable from a
	// missing file over the wire, not just in unit tests.
	for _, reserved := range []string{"checksums", "internal", "lost+found", "manifests", "metadata", "originals", "staging"} {
		probes["reserved namespace "+reserved] = "/media/mutable/" + reserved + "/leak.mp4"
	}

	for name, target := range probes {
		t.Run(name, func(t *testing.T) {
			response := session.On(t).Navigate(target)
			if response.StatusCode != http.StatusNotFound {
				t.Fatalf("GET %s = %d, want an opaque 404", target, response.StatusCode)
			}
			if got := strings.TrimSpace(string(response.Body)); got != "404 page not found" {
				t.Errorf("GET %s body = %q; it must stay the opaque default", target, got)
			}
		})
	}

	drainScenario(t, runResult)
}
