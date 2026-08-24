// panelsdata_test proves the composition root's half of the data-root
// pipeline: the rooted capability is admitted exactly like the media root
// (absolute, existing, non-symlink directory — everything else refuses with
// a path-free error), the capability cannot be started twice, the unsealer
// reads its key at decrypt time only, and — end to end over a REAL
// filesystem, because the root is a security boundary this suite never
// mocks — a sealed file staged in the rooted directory is served through
// the site's own public panel route while traversal and swap attempts stay
// impossible by construction.
package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/snaraj/naranjo.online/internal/seal"
	"github.com/snaraj/naranjo.online/internal/testsupport"
)

const panelsDataTestKeyHex = "d0d1d2d3d4d5d6d7d8d9dadbdcdddedfd0d1d2d3d4d5d6d7d8d9dadbdcdddedf"

// sealSeriesFile stages one sealed usage-series document in dir under the
// production file name. The document targets the REAL embedded snapshot's
// first source label, read from the served payload rather than spelled here.
func sealSeriesFile(t *testing.T, dir, label, generatedAt string) {
	t.Helper()
	document := map[string]any{
		"schema":      "usage-series/v1",
		"generatedAt": generatedAt,
		"sources": map[string]any{
			label: map[string]any{
				"series": map[string]any{"startDate": "2026-08-18", "totals": []int64{3, 4}, "recorded": true},
				"categories": map[string]any{
					"input":  []int64{1, 1},
					"output": []int64{2, 3},
				},
			},
		},
	}
	plaintext, err := json.Marshal(document)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	key, err := seal.ParseKey(panelsDataTestKeyHex)
	if err != nil {
		t.Fatalf("parse key: %v", err)
	}
	sealed, err := seal.Seal(key, plaintext)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "token-usage.series.enc"), sealed, 0o644); err != nil {
		t.Fatalf("stage sealed file: %v", err)
	}
}

// servedTokenUsage fetches the site's token-usage envelope through the full
// public handler stack.
func servedTokenUsage(t *testing.T, site *Site) map[string]any {
	t.Helper()
	recorder := httptest.NewRecorder()
	site.ServeHTTP(recorder, httptest.NewRequest("GET", "/api/panels/token-usage", nil))
	if recorder.Code != 200 {
		t.Fatalf("panel status %d", recorder.Code)
	}
	var envelope map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	return envelope
}

// firstSourceLabel reads the first token-usage source label off the served
// payload, so this suite never spells a data label in source.
func firstSourceLabel(t *testing.T, site *Site) string {
	t.Helper()
	envelope := servedTokenUsage(t, site)
	data, ok := envelope["data"].(map[string]any)
	if !ok {
		t.Fatal("token-usage envelope carries no data")
	}
	sources, ok := data["sources"].([]any)
	if !ok || len(sources) == 0 {
		t.Fatal("token-usage payload carries no sources")
	}
	label, ok := sources[0].(map[string]any)["label"].(string)
	if !ok || label == "" {
		t.Fatal("first source carries no label")
	}
	return label
}

func TestStartPanelDataServesASealedSeriesEndToEnd(t *testing.T) {
	t.Parallel()
	site, err := New(testsupport.FrontendFS())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer site.Close()
	dir := t.TempDir()
	generatedAt := time.Now().UTC().Truncate(time.Second).Format(time.RFC3339)
	sealSeriesFile(t, dir, firstSourceLabel(t, site), generatedAt)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	lookups := 0
	lookupEnv := func(name string) string {
		if name != "PANELS_DATA_KEY" {
			t.Fatalf("unexpected environment read %q", name)
		}
		lookups++
		return panelsDataTestKeyHex
	}
	if err := site.StartPanelData(ctx, dir, lookupEnv); err != nil {
		t.Fatalf("StartPanelData: %v", err)
	}
	// The key is read at decrypt time, not at start time... but the loop's
	// first read races this assertion, so poll the served payload instead.
	deadline := time.Now().Add(5 * time.Second)
	for {
		envelope := servedTokenUsage(t, site)
		if envelope["generatedAt"] == generatedAt && envelope["status"] == "ok" {
			data := envelope["data"].(map[string]any)
			series := data["sources"].([]any)[0].(map[string]any)["series"].(map[string]any)
			if series["startDate"] != "2026-08-18" {
				t.Fatalf("served series start %v", series["startDate"])
			}
			categories, ok := series["categories"].([]any)
			if !ok || len(categories) != 2 {
				t.Fatalf("served categories: %v", series["categories"])
			}
			if categories[0].(map[string]any)["key"] != "input" {
				t.Fatalf("category order: %v", categories)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the sealed series was never served; envelope: %v", envelope)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if lookups == 0 {
		t.Fatal("the key environment was never consulted")
	}
	if err := site.StartPanelData(ctx, dir, lookupEnv); err == nil || !strings.Contains(err.Error(), "already started") {
		t.Fatalf("second start: %v", err)
	}
}

func TestOpenPanelsDataRootRefusesUnsafeRoots(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	filePath := filepath.Join(base, "file")
	if err := os.WriteFile(filePath, []byte("x"), 0o600); err != nil {
		t.Fatalf("stage file: %v", err)
	}
	linkPath := filepath.Join(base, "link")
	if err := os.Symlink(base, linkPath); err != nil {
		t.Fatalf("stage symlink: %v", err)
	}
	for name, path := range map[string]string{
		"relative path":  "relative/dir",
		"missing":        filepath.Join(base, "absent"),
		"regular file":   filePath,
		"symlinked root": linkPath,
	} {
		if _, err := openPanelsDataRoot(path); err == nil {
			t.Fatalf("%s was admitted as a data root", name)
		} else if strings.Contains(err.Error(), base) {
			t.Fatalf("%s: the refusal leaks the path: %v", name, err)
		}
	}
	if root, err := openPanelsDataRoot(base); err != nil {
		t.Fatalf("a plain directory was refused: %v", err)
	} else {
		root.Close()
	}
}

// TestPanelsDataRootConfinesReads proves the rooted capability holds against
// an escape attempt staged on a real filesystem: a symlink inside the root
// pointing outside it cannot be followed to the outside file.
func TestPanelsDataRootConfinesReads(t *testing.T) {
	t.Parallel()
	outside := t.TempDir()
	secretPath := filepath.Join(outside, "outside-secret")
	if err := os.WriteFile(secretPath, []byte("must stay unreachable"), 0o600); err != nil {
		t.Fatalf("stage outside file: %v", err)
	}
	rootDir := t.TempDir()
	if err := os.Symlink(secretPath, filepath.Join(rootDir, "token-usage.series.enc")); err != nil {
		t.Fatalf("stage escape symlink: %v", err)
	}
	root, err := openPanelsDataRoot(rootDir)
	if err != nil {
		t.Fatalf("open root: %v", err)
	}
	defer root.Close()
	if _, err := root.FS().Open("token-usage.series.enc"); err == nil {
		t.Fatal("a symlink escaping the root was followed")
	}
}

func TestNewUnsealerReadsTheKeyPerCall(t *testing.T) {
	t.Parallel()
	key, err := seal.ParseKey(panelsDataTestKeyHex)
	if err != nil {
		t.Fatalf("parse key: %v", err)
	}
	sealed, err := seal.Seal(key, []byte("payload"))
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	supplied := ""
	unseal := newUnsealer(func(string) string { return supplied })
	if _, err := unseal(sealed); err == nil || !strings.Contains(err.Error(), "not configured") {
		t.Fatalf("missing key: %v", err)
	}
	supplied = "short"
	if _, err := unseal(sealed); err == nil {
		t.Fatal("malformed key was accepted")
	}
	// The key arriving AFTER start is picked up on the next call — the
	// at-decrypt-time discipline, observable.
	supplied = panelsDataTestKeyHex
	if plaintext, err := unseal(sealed); err != nil || string(plaintext) != "payload" {
		t.Fatalf("late-arriving key: %v %q", err, plaintext)
	}
	// The documented Secret ceremony feeds the newline-terminated file
	// `openssl rand -hex 32` writes, byte for byte — the unsealer must trim
	// it exactly as usageseal trims the same file on the workstation, or the
	// documented setup never decrypts in the cluster.
	supplied = panelsDataTestKeyHex + "\n"
	if plaintext, err := unseal(sealed); err != nil || string(plaintext) != "payload" {
		t.Fatalf("newline-terminated key from the Secret ceremony: %v %q", err, plaintext)
	}
}
