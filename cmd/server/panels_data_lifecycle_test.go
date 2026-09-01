// panels_data_lifecycle_test drives the complete production shape of the
// panels data root (issue #142) through the real entrypoint over real TCP:
// a sealed usage-series file staged in a mounted directory is decrypted,
// merged over the embedded snapshot, and served on the public panel route
// with its categories; and the SAME staged file with the capability UNSET
// changes nothing at all — the two directions of the fail-closed contract.
// Sequential by design: it owns live ports and ends each boot with the
// process-global SIGTERM drain production uses.
package main

import (
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/snaraj/naranjo.online/internal/seal"
)

// panelsDataLifecycleKeyHex is a fixed, obviously non-secret test key: the
// byte ladder XORed with a constant, hex-encoded to the exact key length —
// distinct from every other suite's key, and derived rather than spelled so
// no key-shaped literal exists for a secret scanner to misread.
var panelsDataLifecycleKeyHex = func() string {
	raw := make([]byte, seal.KeyBytes)
	for index := range raw {
		raw[index] = byte(index) ^ 0x5a
	}
	return hex.EncodeToString(raw)
}()

// embeddedUsageFacts reads the shipped snapshot the binary embeds — the same
// file, from source — so the test can address the real source labels and know
// the embedded capture instant without spelling either in code. EVERY label
// is returned, because a document must refresh the complete shipped set to
// be admitted at all (2026-08-24 review finding 7).
func embeddedUsageFacts(t *testing.T) (labels []string, generatedAt string) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "internal", "panels", "snapshots", "token-usage.json"))
	if err != nil {
		t.Fatalf("read embedded snapshot: %v", err)
	}
	var document struct {
		GeneratedAt string `json:"generatedAt"`
		Data        struct {
			Sources []struct {
				Label string `json:"label"`
			} `json:"sources"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatalf("decode embedded snapshot: %v", err)
	}
	if len(document.Data.Sources) == 0 {
		t.Fatal("embedded snapshot has no sources")
	}
	for _, source := range document.Data.Sources {
		if source.Label == "" {
			t.Fatal("embedded snapshot carries an unlabeled source")
		}
		labels = append(labels, source.Label)
	}
	return labels, document.GeneratedAt
}

// stageSealedSeries seals one complete document — a two-day series with a
// category partition for every shipped source — into dir under the
// production file name and returns its capture instant.
func stageSealedSeries(t *testing.T, dir string, labels []string) string {
	t.Helper()
	generatedAt := time.Now().UTC().Truncate(time.Second).Format(time.RFC3339)
	sources := make(map[string]any, len(labels))
	for _, label := range labels {
		sources[label] = map[string]any{
			// A WHOLE section: its own capture instant plus the complete
			// window and derived vocabularies, so no release-time figure is
			// inherited into a payload stamped with a runtime instant
			// (2026-08-24 round-3 review, finding 5).
			"capturedAt": generatedAt,
			"series":     map[string]any{"startDate": "2026-08-20", "totals": []int64{11, 31}, "recorded": true},
			"categories": map[string]any{
				"input":      []int64{2, 4},
				"output":     []int64{3, 7},
				"cache-read": []int64{6, 20},
			},
			"windows": map[string]any{
				"today": map[string]any{"input": 24, "output": 7},
				"week":  map[string]any{"input": 24, "output": 7},
			},
			"derived": map[string]any{"peak-day": 31, "current-streak": 2, "longest-streak": 2, "active-days": 2, "tracked-days": 2},
			// The complete captured-stats vocabulary (issue #276): every
			// lifetime-class tile a source's snapshot ships must be
			// refreshed, and a key naming no tile is validated and
			// unrendered, so the full set satisfies every shipped label.
			"stats": map[string]any{
				"lifetime":    77,
				"input":       11,
				"output":      22,
				"cache-read":  33,
				"cache-write": 44,
				"sessions":    55,
			},
		}
	}
	document := map[string]any{
		"schema":      "usage-series/v1",
		"generatedAt": generatedAt,
		"sources":     sources,
	}
	plaintext, err := json.Marshal(document)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	key, err := seal.ParseKey(panelsDataLifecycleKeyHex)
	if err != nil {
		t.Fatalf("parse key: %v", err)
	}
	sealed, err := seal.Seal(key, plaintext)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "token-usage.series.enc"), sealed, 0o644); err != nil {
		t.Fatalf("stage: %v", err)
	}
	return generatedAt
}

// fetchTokenUsage GETs and decodes the public token-usage envelope.
func fetchTokenUsage(t *testing.T, client *http.Client, base string) map[string]any {
	t.Helper()
	response, body := mustGet(t, client, base+"/api/panels/token-usage")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("panel status %d", response.StatusCode)
	}
	var envelope map[string]any
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	return envelope
}

// drainRun delivers SIGTERM and requires the given boot to drain cleanly.
func drainRun(t *testing.T, runResult <-chan error) {
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

func TestRunServesThePanelsDataLifecycleEndToEnd(t *testing.T) {
	requireBuiltFrontend(t)
	labels, embeddedGeneratedAt := embeddedUsageFacts(t)
	dir := t.TempDir()
	stagedGeneratedAt := stageSealedSeries(t, dir, labels)
	client := &http.Client{Timeout: 5 * time.Second}

	// Direction one: capability configured — the sealed file is decrypted,
	// merged, and served with its categories. The file predates the boot, so
	// the loop's immediate first read covers it; the panel may need a beat.
	base, runResult := bootServer(t, map[string]string{
		"PANELS_DATA_ROOT": dir,
		"PANELS_DATA_KEY":  panelsDataLifecycleKeyHex,
	})
	deadline := time.Now().Add(10 * time.Second)
	for {
		envelope := fetchTokenUsage(t, client, base)
		if envelope["generatedAt"] == stagedGeneratedAt {
			if envelope["status"] != "ok" {
				t.Fatalf("disk-backed panel status %v", envelope["status"])
			}
			source := envelope["data"].(map[string]any)["sources"].([]any)[0].(map[string]any)
			series := source["series"].(map[string]any)
			if series["startDate"] != "2026-08-20" {
				t.Fatalf("served series %v", series["startDate"])
			}
			categories := series["categories"].([]any)
			if len(categories) != 3 || categories[0].(map[string]any)["key"] != "input" {
				t.Fatalf("served categories %v", categories)
			}
			// The COMPLETE window set, in canonical order: a section may no
			// longer refresh one window and leave the other at its
			// release-time value (2026-08-24 round-3 review, finding 5).
			windows := source["windows"].([]any)
			if len(windows) != 2 ||
				windows[0].(map[string]any)["period"] != "today" ||
				windows[1].(map[string]any)["period"] != "week" {
				t.Fatalf("served windows %v", windows)
			}
			// And its own capture instant travels with it.
			if source["capturedAt"] != stagedGeneratedAt {
				t.Fatalf("served capturedAt %v, want %v", source["capturedAt"], stagedGeneratedAt)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("staged series never served; still at %v", envelope["generatedAt"])
		}
		time.Sleep(50 * time.Millisecond)
	}
	drainRun(t, runResult)

	// Direction two: the SAME staged directory and key exist on the machine,
	// but the capability is unset — behavior is byte-identical to a build
	// without it: the embedded snapshot serves untouched.
	base, runResult = bootServer(t, map[string]string{
		"PANELS_DATA_KEY": panelsDataLifecycleKeyHex,
	})
	envelope := fetchTokenUsage(t, client, base)
	if envelope["generatedAt"] != embeddedGeneratedAt {
		t.Fatalf("with the capability unset the panel serves %v, want the embedded %v", envelope["generatedAt"], embeddedGeneratedAt)
	}
	drainRun(t, runResult)
}
