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
// production file name. The document covers EVERY label the REAL embedded
// snapshot ships, read off the served payload rather than spelled here — a
// document that refreshed only some of them is refused as partial
// (2026-08-24 review finding 7), so a complete one is what this suite must
// stage to exercise the serving path at all.
func sealSeriesFile(t *testing.T, dir string, labels []string, generatedAt string) {
	t.Helper()
	sources := make(map[string]any, len(labels))
	for _, label := range labels {
		sources[label] = map[string]any{
			"series": map[string]any{"startDate": "2026-08-18", "totals": []int64{3, 4}, "recorded": true},
			"categories": map[string]any{
				"input":  []int64{1, 1},
				"output": []int64{2, 3},
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

// shippedSourceLabels reads EVERY token-usage source label off the served
// payload, so this suite never spells a data label in source and stays
// correct when the shipped snapshot gains or loses a source.
func shippedSourceLabels(t *testing.T, site *Site) []string {
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
	labels := make([]string, 0, len(sources))
	for _, source := range sources {
		label, ok := source.(map[string]any)["label"].(string)
		if !ok || label == "" {
			t.Fatal("a shipped source carries no label")
		}
		labels = append(labels, label)
	}
	return labels
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
	sealSeriesFile(t, dir, shippedSourceLabels(t, site), generatedAt)

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
	if err := site.StartPanelData(ctx, dir, "", lookupEnv); err != nil {
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
	if err := site.StartPanelData(ctx, dir, "", lookupEnv); err == nil || !strings.Contains(err.Error(), "already started") {
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

// TestFloorMarkerRoundTripsAcrossRootInstances proves the durable half of
// the 2026-08-24 review finding H2 fix on a REAL filesystem: a marker stored
// through one rooted capability is read back by a SEPARATE rooted capability
// over the same directory — which is exactly what a process restart is.
//
// It also pins the distinction finding 2 turned on (2026-08-24 review): an
// ABSENT marker is the benign first boot and loads as (zero, false, nil),
// while a marker that EXISTS and cannot be trusted — tampered, junk,
// oversized, wrong key, no key — loads as an ERROR, so the loop refuses to
// serve on a silently lowered floor instead of treating corruption as a cold
// start.
func TestFloorMarkerRoundTripsAcrossRootInstances(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	env := func(string) string { return panelsDataTestKeyHex }
	instant := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)

	first, err := openPanelsDataRoot(dir)
	if err != nil {
		t.Fatalf("open first root: %v", err)
	}
	writer := newFloorMarker(first, env)
	if _, ok, err := writer.Load(); ok || err != nil {
		t.Fatalf("an empty state directory must load as the benign absent marker: %v %v", ok, err)
	}
	if err := writer.Store(instant); err != nil {
		t.Fatalf("store: %v", err)
	}
	first.Close()

	// The restart: a brand-new root over the same directory.
	second, err := openPanelsDataRoot(dir)
	if err != nil {
		t.Fatalf("open second root: %v", err)
	}
	defer second.Close()
	reader := newFloorMarker(second, env)
	loaded, ok, err := reader.Load()
	if !ok || err != nil || !loaded.Equal(instant) {
		t.Fatalf("marker did not survive the root boundary: %v %v %v", loaded, ok, err)
	}

	// A later Store REPLACES the marker; the newest instant wins.
	later := instant.Add(time.Hour)
	if err := reader.Store(later); err != nil {
		t.Fatalf("second store: %v", err)
	}
	if loaded, ok, err = reader.Load(); !ok || err != nil || !loaded.Equal(later) {
		t.Fatalf("marker did not advance: %v %v %v", loaded, ok, err)
	}

	// Corrupt directions all load as an ERROR — a marker that is there and
	// unusable, which durable mode must refuse rather than forget.
	markerPath := filepath.Join(dir, "token-usage.floor.enc")
	sealed, err := os.ReadFile(markerPath)
	if err != nil {
		t.Fatalf("read marker: %v", err)
	}
	tampered := append([]byte(nil), sealed...)
	tampered[len(tampered)/2] ^= 0x01
	for name, bytes := range map[string][]byte{
		"tampered ciphertext": tampered,
		"unsealed junk":       []byte("not a sealed marker"),
		"oversized":           make([]byte, maxFloorMarkerBytes+1),
	} {
		if err := os.WriteFile(markerPath, bytes, 0o600); err != nil {
			t.Fatalf("stage %s: %v", name, err)
		}
		if _, ok, err := reader.Load(); ok || err == nil {
			t.Fatalf("%s did not load as an untrusted marker: %v %v", name, ok, err)
		}
	}
	if err := os.WriteFile(markerPath, sealed, 0o600); err != nil {
		t.Fatalf("restore marker: %v", err)
	}
	wrongKey := newFloorMarker(second, func(string) string {
		return strings.Repeat("ff", 32)
	})
	if _, ok, err := wrongKey.Load(); ok || err == nil {
		t.Fatalf("the wrong key did not load as an untrusted marker: %v %v", ok, err)
	}
	noKey := newFloorMarker(second, func(string) string { return "" })
	if _, ok, err := noKey.Load(); ok || err == nil {
		t.Fatalf("a missing key did not load as an untrusted marker: %v %v", ok, err)
	}
	if err := noKey.Store(instant); err == nil {
		t.Fatal("a missing key still stored a marker")
	}

	// And the absent marker stays benign after the directory has been used:
	// removing it is a cold start, not a corruption.
	if err := os.Remove(markerPath); err != nil {
		t.Fatalf("remove marker: %v", err)
	}
	if _, ok, err := reader.Load(); ok || err != nil {
		t.Fatalf("a removed marker must load as absent, not untrusted: %v %v", ok, err)
	}
}

// TestStartPanelDataFloorSurvivesProcessRestart is the composition-root
// restart simulation for the 2026-08-24 review finding H2: one Site accepts
// a push and persists the floor into the state root; a SECOND Site — a new
// process over the same two directories — must refuse a rolled-back series
// file that a markerless restart would have accepted, and must re-serve the
// unchanged accepted file rather than degrade to the embedded snapshot.
func TestStartPanelDataFloorSurvivesProcessRestart(t *testing.T) {
	t.Parallel()
	dataDir := t.TempDir()
	stateDir := t.TempDir()
	env := func(name string) string {
		if name != "PANELS_DATA_KEY" {
			t.Fatalf("unexpected environment read %q", name)
		}
		return panelsDataTestKeyHex
	}
	now := time.Now().UTC().Truncate(time.Second)
	acceptedAt := now.Format(time.RFC3339)
	rolledBackAt := now.Add(-time.Hour).Format(time.RFC3339)

	serveUntil := func(t *testing.T, site *Site, want func(map[string]any) bool) map[string]any {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for {
			envelope := servedTokenUsage(t, site)
			if want(envelope) {
				return envelope
			}
			if time.Now().After(deadline) {
				t.Fatalf("condition never held; envelope: %v", envelope)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}

	// Process one: accept the push, persist the floor.
	site1, err := New(testsupport.FrontendFS())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	labels := shippedSourceLabels(t, site1)
	sealSeriesFile(t, dataDir, labels, acceptedAt)
	ctx1, cancel1 := context.WithCancel(context.Background())
	if err := site1.StartPanelData(ctx1, dataDir, stateDir, env); err != nil {
		t.Fatalf("first StartPanelData: %v", err)
	}
	serveUntil(t, site1, func(envelope map[string]any) bool {
		return envelope["generatedAt"] == acceptedAt && envelope["status"] == "ok"
	})
	cancel1()
	site1.Close()
	if _, err := os.Stat(filepath.Join(stateDir, "token-usage.floor.enc")); err != nil {
		t.Fatalf("no floor marker was persisted: %v", err)
	}

	// Process two, facing a ROLLED-BACK file: refused, stale said. Without
	// the persisted floor this file (newer than the embedded snapshot) was
	// accepted after every restart.
	sealSeriesFile(t, dataDir, labels, rolledBackAt)
	site2, err := New(testsupport.FrontendFS())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx2, cancel2 := context.WithCancel(context.Background())
	if err := site2.StartPanelData(ctx2, dataDir, stateDir, env); err != nil {
		t.Fatalf("second StartPanelData: %v", err)
	}
	envelope := serveUntil(t, site2, func(envelope map[string]any) bool {
		return envelope["status"] == "stale"
	})
	if envelope["generatedAt"] == rolledBackAt {
		t.Fatal("the rolled-back payload is being served")
	}
	cancel2()
	site2.Close()

	// Process three, facing the UNCHANGED accepted file: recovery, not
	// replay — served ok again at the accepted instant.
	sealSeriesFile(t, dataDir, labels, acceptedAt)
	site3, err := New(testsupport.FrontendFS())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer site3.Close()
	ctx3, cancel3 := context.WithCancel(context.Background())
	defer cancel3()
	if err := site3.StartPanelData(ctx3, dataDir, stateDir, env); err != nil {
		t.Fatalf("third StartPanelData: %v", err)
	}
	serveUntil(t, site3, func(envelope map[string]any) bool {
		return envelope["generatedAt"] == acceptedAt && envelope["status"] == "ok"
	})
}

// TestStartPanelDataRefusesAnUnopenableStateRoot pins the fail-closed
// admission of the state capability: a configured but unopenable state path
// is an operator error that fails the start loudly, exactly like the data
// root, and leaves neither root open behind it.
func TestStartPanelDataRefusesAnUnopenableStateRoot(t *testing.T) {
	t.Parallel()
	site, err := New(testsupport.FrontendFS())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer site.Close()
	dataDir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	env := func(string) string { return panelsDataTestKeyHex }
	for name, state := range map[string]string{
		"relative": "relative/state",
		"missing":  filepath.Join(dataDir, "absent-state"),
	} {
		if err := site.StartPanelData(ctx, dataDir, state, env); err == nil {
			t.Fatalf("%s state path was admitted", name)
		}
	}
	// The refusals must not have half-started the capability.
	if err := site.StartPanelData(ctx, dataDir, "", env); err != nil {
		t.Fatalf("a clean start after refusals failed: %v", err)
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
