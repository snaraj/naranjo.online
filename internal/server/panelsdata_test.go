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
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/snaraj/naranjo.online/internal/panels"
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
func sealSeriesFile(t *testing.T, dir string, labels []string, generatedAt string) []byte {
	t.Helper()
	sources := make(map[string]any, len(labels))
	for _, label := range labels {
		sources[label] = map[string]any{
			// Every section is a WHOLE section: its own capture instant plus
			// the complete window and derived sets, so nothing series-derived
			// is inherited from the release-time snapshot (2026-08-24 round-3
			// review, finding 5).
			"capturedAt": generatedAt,
			"series":     map[string]any{"startDate": "2026-08-18", "totals": []int64{3, 4}, "recorded": true},
			"categories": map[string]any{
				"input":  []int64{1, 1},
				"output": []int64{2, 3},
			},
			"windows": map[string]any{
				"today": map[string]any{"input": 1, "output": 3},
				"week":  map[string]any{"input": 2, "output": 5},
			},
			"derived": map[string]any{"peak-day": 4, "current-streak": 2, "longest-streak": 2},
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
	stageSeriesFile(t, dir, sealed)
	return sealed
}

// stageSeriesFile puts EXACT bytes on the data root. Restoring the accepted
// ciphertext — rather than re-sealing the same document — is what makes a
// restart test a restart: the volume does not re-seal itself, and the
// durable floor binds the exact ciphertext it recorded (2026-08-24 round-3
// review, finding 2).
func stageSeriesFile(t *testing.T, dir string, sealed []byte) {
	t.Helper()
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

// TestStartPanelDataClaimsTheTokenUsagePanel proves the composition root's
// half of the 2026-08-24 review finding 8 repair: enabling the sealed data
// root claims the token-usage panel, synchronously and before the loop
// exists, and that claim is what cmd/server logs once at startup so an
// operator with both switches on can see which producer is serving the
// panel.
//
// The enforcement itself — the live path never fetching an owned panel while
// every other refresh-backed panel keeps working — is proven against an
// injected transport in internal/panels. It cannot be proven here: this
// package's StartPanelRefresh wires the PRODUCTION doer, so exercising it
// would mean real egress from the test suite.
func TestStartPanelDataClaimsTheTokenUsagePanel(t *testing.T) {
	t.Parallel()
	site, err := New(testsupport.FrontendFS())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer site.Close()
	if site.TokenUsageOwnedByDataRoot() {
		t.Fatal("the panel reports an owner before any data root started")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := site.StartPanelData(ctx, t.TempDir(), "", func(string) string {
		return panelsDataTestKeyHex
	}); err != nil {
		t.Fatalf("StartPanelData: %v", err)
	}
	if !site.TokenUsageOwnedByDataRoot() {
		t.Fatal("the sealed data root started without claiming the token-usage panel")
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

// floorState builds one complete FloorState: an instant plus a digest of the
// ciphertext that instant was accepted from. Both halves are required, so a
// helper keeps every test honest about supplying them.
func floorState(instant time.Time, seed string) panels.FloorState {
	sum := sha256.Sum256([]byte(seed))
	return panels.FloorState{Instant: instant, Digest: hex.EncodeToString(sum[:])}
}

// TestFloorMarkerRoundTripsAcrossRootInstances proves the durable half of
// the 2026-08-24 review finding H2 fix on a REAL filesystem: a marker stored
// through one rooted capability is read back by a SEPARATE rooted capability
// over the same directory — which is exactly what a process restart is.
//
// It also pins the distinction finding 2 turned on: an ABSENT marker in a
// NEVER-USED state directory is the benign first boot and loads as (zero,
// false, nil), while a marker that EXISTS and cannot be trusted — tampered,
// junk, oversized, wrong key, no key — loads as an ERROR, so the loop refuses
// to serve on a silently lowered floor instead of treating corruption as a
// cold start.
//
// And it pins the FULL-PRECISION round trip (2026-08-24 round-3 review,
// finding 2). The instant used to serialize through a second-resolution
// format: a floor written from 12:00:00.900 loaded back as 12:00:00, so an
// authentic document at 12:00:00.100 — older than what had already been
// published — passed the floor after a restart. Both directions are driven
// here: the sub-second instant must survive, and the loaded value must
// compare EQUAL rather than merely close.
func TestFloorMarkerRoundTripsAcrossRootInstances(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	env := func(string) string { return panelsDataTestKeyHex }
	// Deliberately sub-second, and deliberately a value a second-resolution
	// format would round DOWN — the exact shape of the review's mutant.
	instant := time.Date(2026, 8, 24, 12, 0, 0, 900_000_000, time.UTC)
	floor := floorState(instant, "accepted-ciphertext")

	first, err := openPanelsDataRoot(dir)
	if err != nil {
		t.Fatalf("open first root: %v", err)
	}
	writer := newFloorMarker(first, env)
	if _, ok, err := writer.Load(); ok || err != nil {
		t.Fatalf("an empty state directory must load as the benign absent marker: %v %v", ok, err)
	}
	if err := writer.Store(floor); err != nil {
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
	if !ok || err != nil {
		t.Fatalf("marker did not survive the root boundary: %v %v %v", loaded, ok, err)
	}
	if !loaded.Instant.Equal(instant) {
		t.Fatalf("the marker lost precision: stored %s, loaded %s",
			instant.Format(time.RFC3339Nano), loaded.Instant.Format(time.RFC3339Nano))
	}
	if loaded.Digest != floor.Digest {
		t.Fatalf("the marker lost its document digest: %q", loaded.Digest)
	}

	// A later Store REPLACES the marker; the newest instant wins, and the
	// sub-second component of THAT one survives too.
	later := instant.Add(time.Hour).Add(123 * time.Millisecond)
	laterFloor := floorState(later, "later-ciphertext")
	if err := reader.Store(laterFloor); err != nil {
		t.Fatalf("second store: %v", err)
	}
	if loaded, ok, err = reader.Load(); !ok || err != nil || !loaded.Instant.Equal(later) {
		t.Fatalf("marker did not advance: %v %v %v", loaded, ok, err)
	}

	// MONOTONIC (2026-08-24 round-3 review, finding 3). Two production roots
	// over one state directory stored T3 then T2 and BOTH returned success,
	// leaving the shared floor at T2. A store below the persisted floor is
	// refused, so the losing writer's payload is never published either.
	if err := reader.Store(floorState(instant, "rolled-back")); !errors.Is(err, errFloorNotMonotonic) {
		t.Fatalf("a store below the persisted floor was accepted: %v", err)
	}
	if loaded, _, _ = reader.Load(); !loaded.Instant.Equal(later) {
		t.Fatalf("the refused store still moved the floor to %v", loaded.Instant)
	}
	// Equality is not a lowering: a restart re-recording the same floor must
	// not be refused.
	if err := reader.Store(laterFloor); err != nil {
		t.Fatalf("re-recording the persisted floor was refused: %v", err)
	}

	// A store leaves no staging file behind, and every staging name is
	// unique — the fixed `.tmp` name let concurrent writers publish each
	// other's bytes.
	assertNoStagingFiles(t, dir)

	// Corrupt directions all load as an ERROR — a marker that is there and
	// unusable, which durable mode must refuse rather than forget.
	markerPath := filepath.Join(dir, "token-usage.floor.enc")
	sealed, err := os.ReadFile(markerPath)
	if err != nil {
		t.Fatalf("read marker: %v", err)
	}
	tampered := append([]byte(nil), sealed...)
	tampered[len(tampered)-1] ^= 0x01
	for name, bytes := range map[string][]byte{
		"tampered ciphertext": tampered,
		"unsealed junk":       []byte("not a sealed marker"),
		"oversized":           make([]byte, maxFloorMarkerBytes+1),
		"header only":         []byte(panelsFloorFormat + " " + floorKeyID(panelsDataTestKeyHex) + "\n"),
		"no header":           append([]byte(nil), sealed[10:]...),
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

	// KEY ROTATION IS A NAMED STATE (2026-08-24 round-3 review, finding 11).
	// A marker sealed under a superseded key used to be indistinguishable
	// from a corrupt one, so the documented rotation left the panel stale
	// forever with no way to tell why. The marker's key identity makes it a
	// specific refusal with a specific remedy — and still a REFUSAL: an
	// unauthenticated header may never lower a floor.
	rotated := newFloorMarker(second, func(string) string {
		return strings.Repeat("ff", 32)
	})
	if _, ok, err := rotated.Load(); ok || !errors.Is(err, errFloorKeyRotated) {
		t.Fatalf("a rotated key did not load as the rotation state: %v %v", ok, err)
	}
	noKey := newFloorMarker(second, func(string) string { return "" })
	if _, ok, err := noKey.Load(); ok || err == nil {
		t.Fatalf("a missing key did not load as an untrusted marker: %v %v", ok, err)
	}
	if err := noKey.Store(floor); err == nil {
		t.Fatal("a missing key still stored a marker")
	}

	// THE TOMBSTONE (2026-08-24 round-3 review, finding 4). This block
	// asserts the exact OPPOSITE of what it asserted before the review: a
	// marker removed from a state directory that has already recorded one is
	// provenance LOSS, not a cold start. The old contract made `rm` a
	// supported way to reset replay protection — and the recovery runbook
	// told operators to do exactly that.
	if err := os.Remove(markerPath); err != nil {
		t.Fatalf("remove marker: %v", err)
	}
	if _, ok, err := reader.Load(); ok || !errors.Is(err, errFloorMarkerGone) {
		t.Fatalf("a removed marker in a used directory must be loss, not a cold start: %v %v", ok, err)
	}
	// A store cannot paper over it either: the ceremony is the only way out.
	if err := reader.Store(laterFloor); !errors.Is(err, errFloorMarkerGone) {
		t.Fatalf("a store re-initialized a state directory that had lost its floor: %v", err)
	}

	// THE RESET CEREMONY, exactly as documented: remove the marker AND the
	// init file. It is explicit, it is an operator action, and it truthfully
	// returns the floor to the embedded snapshot's instant.
	if err := os.Remove(filepath.Join(dir, "token-usage.floor.init")); err != nil {
		t.Fatalf("remove tombstone: %v", err)
	}
	if _, ok, err := reader.Load(); ok || err != nil {
		t.Fatalf("the reset ceremony did not return a benign cold start: %v %v", ok, err)
	}
	if err := reader.Store(floor); err != nil {
		t.Fatalf("a reset directory refused a fresh floor: %v", err)
	}
}

// assertNoStagingFiles proves a completed store left no temporary file in
// the state directory. Unique O_EXCL staging names are what stop two writers
// from renaming each other's bytes into place, and a leaked one would be the
// tell that the sequence did not complete.
func assertNoStagingFiles(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read state directory: %v", err)
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".tmp") {
			t.Fatalf("a staging file survived a completed store: %q", entry.Name())
		}
	}
}

// TestFloorMarkerStoresAreExclusiveAndMonotonic is the 2026-08-24 round-3
// finding 3 regression test, driven the way the review drove it: TWO
// independently opened production roots over ONE state directory, storing
// out of order. Both used to return success and the shared floor ended at
// the LOWER instant — a durable floor that two pods could walk backwards
// between them. The lower store is now refused, so the writer that would
// have lowered it never publishes either.
func TestFloorMarkerStoresAreExclusiveAndMonotonic(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	env := func(string) string { return panelsDataTestKeyHex }
	base := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)

	rootA, err := openPanelsDataRoot(dir)
	if err != nil {
		t.Fatalf("open root A: %v", err)
	}
	defer rootA.Close()
	rootB, err := openPanelsDataRoot(dir)
	if err != nil {
		t.Fatalf("open root B: %v", err)
	}
	defer rootB.Close()
	writerA := newFloorMarker(rootA, env)
	writerB := newFloorMarker(rootB, env)

	high := floorState(base.Add(3*time.Minute), "t3")
	low := floorState(base.Add(2*time.Minute), "t2")
	if err := writerA.Store(high); err != nil {
		t.Fatalf("store T3: %v", err)
	}
	if err := writerB.Store(low); !errors.Is(err, errFloorNotMonotonic) {
		t.Fatalf("a second writer lowered the shared floor: %v", err)
	}
	loaded, ok, err := writerA.Load()
	if !ok || err != nil || !loaded.Instant.Equal(high.Instant) {
		t.Fatalf("the shared floor is %v (%v %v), want T3", loaded.Instant, ok, err)
	}

	// The EQUAL instant, which the round-3 monotonic test above walked past
	// and the 2026-08-25 round-4 review walked through (finding 1). Comparing
	// instants alone leaves a competing writer free to replace the durable
	// DIGEST at the instant already held, and that digest is the whole of
	// what lets a restarted process tell "the file my predecessor published"
	// from "a different authentic file wearing its instant". Refused, and the
	// persisted digest must be untouched afterwards.
	diverging := floorState(high.Instant, "a different document at the same instant")
	if diverging.Digest == high.Digest {
		t.Fatal("the fixture does not diverge; this case would pass vacuously")
	}
	if err := writerB.Store(diverging); !errors.Is(err, errFloorDivergedAtInstant) {
		t.Fatalf("a competing document replaced the digest at the accepted instant: %v", err)
	}
	held, ok, err := writerA.Load()
	if !ok || err != nil {
		t.Fatalf("load after the refused divergence: %v %v", ok, err)
	}
	if held.Digest != high.Digest {
		t.Fatalf("the persisted digest became %q, want the accepted %q", held.Digest, high.Digest)
	}

	// The idempotent re-store of the floor already held — same instant, same
	// digest — is what a retry produces and must still succeed, or the
	// refusal above would be a liveness bug rather than a guard.
	if err := writerB.Store(high); err != nil {
		t.Fatalf("the idempotent re-store of the held floor was refused: %v", err)
	}

	// Concurrent stores of the SAME advancing sequence must all either
	// commit or be refused as non-monotonic — never leave a torn or
	// foreign-bytes marker behind, which the shared `.tmp` staging name made
	// possible.
	var wait sync.WaitGroup
	for index := range 8 {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			writer := newFloorMarker(rootA, env)
			if index%2 == 1 {
				writer = newFloorMarker(rootB, env)
			}
			_ = writer.Store(floorState(base.Add(time.Duration(10+index)*time.Minute),
				fmt.Sprintf("concurrent-%d", index)))
		}(index)
	}
	wait.Wait()
	loaded, ok, err = writerA.Load()
	if !ok || err != nil {
		t.Fatalf("concurrent stores left an unreadable floor: %v %v %v", loaded, ok, err)
	}
	if loaded.Instant.Before(base.Add(10 * time.Minute)) {
		t.Fatalf("concurrent stores lowered the floor to %v", loaded.Instant)
	}
	assertNoStagingFiles(t, dir)
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
	accepted := sealSeriesFile(t, dataDir, labels, acceptedAt)
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

	// Process three, facing the UNCHANGED accepted file — the exact bytes,
	// restored — is recovery, not replay: served ok again at the accepted
	// instant.
	stageSeriesFile(t, dataDir, accepted)
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

// TestPanelsFloorNoticeClassifiesTheStateDirectory pins the one
// operator-facing line the durable floor produces (2026-08-24 round-3
// review, findings 4 and 11). Every refusal keeps the panel stale, which is
// correct and completely uninformative on its own; the notice is what tells
// an operator WHICH of the refusals they are looking at, and therefore which
// remedy in docs/usage-export.md applies. It must never carry a path, a key,
// or any payload byte.
func TestPanelsFloorNoticeClassifiesTheStateDirectory(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	env := func(string) string { return panelsDataTestKeyHex }
	root, err := openPanelsDataRoot(dir)
	if err != nil {
		t.Fatalf("open root: %v", err)
	}
	defer root.Close()

	// A never-used state directory says nothing: silence is the correct
	// notice for the ordinary first boot.
	if notice := describeFloorState(newFloorMarker(root, env)); notice != "" {
		t.Fatalf("a cold state directory produced %q", notice)
	}

	floor := floorState(time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC), "accepted")
	if err := newFloorMarker(root, env).Store(floor); err != nil {
		t.Fatalf("store: %v", err)
	}
	if notice := describeFloorState(newFloorMarker(root, env)); !strings.Contains(notice, "recovered at") {
		t.Fatalf("a healthy floor produced %q", notice)
	}

	rotated := describeFloorState(newFloorMarker(root, func(string) string {
		return strings.Repeat("ab", 32)
	}))
	if !strings.Contains(rotated, "sealed under a different key") ||
		!strings.Contains(rotated, "reset ceremony") {
		t.Fatalf("a rotated key produced %q", rotated)
	}

	if err := os.Remove(filepath.Join(dir, "token-usage.floor.enc")); err != nil {
		t.Fatalf("remove marker: %v", err)
	}
	lost := describeFloorState(newFloorMarker(root, env))
	if !strings.Contains(lost, "marker is gone") || !strings.Contains(lost, "reset ceremony") {
		t.Fatalf("a lost marker produced %q", lost)
	}

	// An UNTRUSTED marker must name the same single ceremony as the other two
	// (2026-08-25 round-4 review, finding 6). This line used to offer
	// "repaired or explicitly reset", which is one of the three contradictory
	// recovery stories the review found: a sealed marker cannot be repaired by
	// hand, and a fresh push cannot clear the state because the store loads
	// the persisted floor before it looks at any document. One ceremony, said
	// the same way in every notice, or the operator picks the wrong one.
	if err := os.WriteFile(filepath.Join(dir, "token-usage.floor.enc"),
		[]byte("NJSEAL/1 not actually sealed"), 0o600); err != nil {
		t.Fatalf("write untrusted marker: %v", err)
	}
	untrusted := describeFloorState(newFloorMarker(root, env))
	if !strings.Contains(untrusted, "cannot be trusted") ||
		!strings.Contains(untrusted, "reset ceremony") {
		t.Fatalf("an untrusted marker produced %q", untrusted)
	}
	if strings.Contains(untrusted, "repaired") {
		t.Fatalf("the notice still offers a repair that does not exist: %q", untrusted)
	}

	// Nothing the notice says may name the directory it describes.
	for _, notice := range []string{rotated, lost, untrusted} {
		if strings.Contains(notice, dir) || strings.Contains(notice, panelsDataTestKeyHex) {
			t.Fatalf("the notice leaked a path or key: %q", notice)
		}
	}
}

// TestFloorPayloadRefusesEveryMalformedShape drives the sealed marker's
// plaintext parser directly. Its inputs arrive already AUTHENTICATED — the
// AEAD has accepted them — so the only thing that can put a malformed one
// here is a bug in the writer or a future format change, and refusing is
// what keeps that from being read as a lower floor.
func TestFloorPayloadRefusesEveryMalformedShape(t *testing.T) {
	t.Parallel()
	digest := strings.Repeat("ab", 32)
	for name, payload := range map[string]string{
		"empty":                      "",
		"instant only":               "2026-08-24T12:00:00Z\n",
		"three lines":                "2026-08-24T12:00:00Z\n" + digest + "\nextra\n",
		"unparsable instant":         "yesterday\n" + digest + "\n",
		"digest too short":           "2026-08-24T12:00:00Z\n" + strings.Repeat("ab", 31) + "\n",
		"digest not hex":             "2026-08-24T12:00:00Z\n" + strings.Repeat("zz", 32) + "\n",
		"digest uppercase hex":       "2026-08-24T12:00:00Z\n" + strings.Repeat("AB", 32) + "\n",
		"instant and digest swapped": digest + "\n2026-08-24T12:00:00Z\n",
	} {
		if _, err := parseFloorPayload([]byte(payload)); err == nil {
			t.Errorf("%s payload was accepted as a floor", name)
		}
	}
	// Non-vacuity: the shape the writer actually produces is admitted, with
	// its fractional precision intact.
	instant := "2026-08-24T12:00:00.9Z"
	state, err := parseFloorPayload([]byte(instant + "\n" + digest + "\n"))
	if err != nil {
		t.Fatalf("the writer's own shape was refused: %v", err)
	}
	if state.Instant.Format(time.RFC3339Nano) != instant || state.Digest != digest {
		t.Fatalf("parsed %v / %q", state.Instant, state.Digest)
	}
}

// TestPanelsFloorNoticeReachesTheCompositionRoot pins the accessor the
// server exposes to cmd/server, not just the classifier beneath it: a
// notice computed at start must still be readable afterwards, because the
// composition root logs it once and the loop itself stays silent.
func TestPanelsFloorNoticeReachesTheCompositionRoot(t *testing.T) {
	t.Parallel()
	site, err := New(testsupport.FrontendFS())
	if err != nil {
		t.Fatalf("new site: %v", err)
	}
	defer site.Close()
	// Nothing started yet: no notice to give.
	if notice := site.PanelsFloorNotice(); notice != "" {
		t.Fatalf("an unstarted site reported %q", notice)
	}

	dataDir := t.TempDir()
	stateDir := t.TempDir()
	env := func(name string) string {
		if name == panelsDataKeyEnv {
			return panelsDataTestKeyHex
		}
		return ""
	}
	root, err := openPanelsDataRoot(stateDir)
	if err != nil {
		t.Fatalf("open state root: %v", err)
	}
	floor := floorState(time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC), "accepted")
	if err := newFloorMarker(root, env).Store(floor); err != nil {
		t.Fatalf("store: %v", err)
	}
	root.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := site.StartPanelData(ctx, dataDir, stateDir, env); err != nil {
		t.Fatalf("start: %v", err)
	}
	notice := site.PanelsFloorNotice()
	if !strings.Contains(notice, "recovered at") {
		t.Fatalf("a started site with a healthy floor reported %q", notice)
	}
	if strings.Contains(notice, stateDir) || strings.Contains(notice, panelsDataTestKeyHex) {
		t.Fatalf("the notice leaked a path or key: %q", notice)
	}
}

// TestFloorCommitRefusesWhenADurabilityBarrierFails is the test the round-3
// commit claimed to have and did not (2026-08-25 round-4 review, finding 5).
// Removing `file.Sync()` and no-oping the directory fsync both left this
// package green, so two of the three things that make "the floor is
// persisted" mean anything were unguarded.
//
// What it pins is the CONTRACT around each barrier rather than the barrier's
// physics: a durability barrier that fails must refuse the commit outright,
// because the caller publishes on that success and a floor that may not have
// reached the disk is not a floor. Both mutations are red here — with the
// call removed, the store no longer fails when the barrier does.
func TestFloorCommitRefusesWhenADurabilityBarrierFails(t *testing.T) {
	// Not parallel: it swaps package-level barriers.
	env := func(string) string { return panelsDataTestKeyHex }
	floor := floorState(time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC), "accepted")
	barrier := errors.New("simulated barrier failure")

	// The two barriers sit on opposite sides of the rename, and the on-disk
	// state after each failure differs for a real reason rather than an
	// accidental one:
	//
	//   * The FILE barrier runs before the rename. Nothing may be linked
	//     into place, so the marker must be absent afterwards.
	//   * The DIRECTORY barrier runs after it. The rename has already
	//     happened and cannot be taken back, so the marker IS present — it
	//     just may not survive a crash, which is precisely the thing the
	//     barrier exists to establish. The commit is refused anyway, so
	//     nothing is published on it, and the retry on the next tick stores
	//     the same instant and digest idempotently.
	//
	// Both cases share the assertions that matter: the store reports
	// failure, and no staging file is left behind.
	for name, testCase := range map[string]struct {
		install     func(t *testing.T)
		markerAfter bool
	}{
		"the file barrier": {install: func(t *testing.T) {
			original := syncFile
			syncFile = func(*os.File) error { return barrier }
			t.Cleanup(func() { syncFile = original })
		}},
		"the directory barrier": {install: func(t *testing.T) {
			original := syncDirectory
			syncDirectory = func(*os.File) error { return barrier }
			t.Cleanup(func() { syncDirectory = original })
		}, markerAfter: true},
	} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			root, err := openPanelsDataRoot(dir)
			if err != nil {
				t.Fatalf("open root: %v", err)
			}
			defer root.Close()
			testCase.install(t)
			if err := newFloorMarker(root, env).Store(floor); err == nil {
				t.Fatal("the commit reported success while the durability barrier was failing")
			}
			_, statErr := os.Stat(filepath.Join(dir, panelsFloorMarkerName))
			if testCase.markerAfter {
				if statErr != nil {
					t.Fatalf("the rename had already happened; the marker should still be there: %v", statErr)
				}
			} else if !errors.Is(statErr, fs.ErrNotExist) {
				t.Fatalf("a commit refused BEFORE the rename left a marker in place: %v", statErr)
			}
			assertNoStagingFiles(t, dir)
		})
	}

	// Non-vacuity: with both barriers intact the identical store succeeds,
	// so the refusals above are the barrier failing and not the fixture.
	dir := t.TempDir()
	root, err := openPanelsDataRoot(dir)
	if err != nil {
		t.Fatalf("open root: %v", err)
	}
	defer root.Close()
	if err := newFloorMarker(root, env).Store(floor); err != nil {
		t.Fatalf("the same store failed with the barriers intact: %v", err)
	}
}

// TestFloorStagingNeverReusesAFixedName is the third claim round 4 found
// vacuous: reverting the unique O_EXCL temporary to a fixed truncating name
// left this package green, even though a shared staging name is exactly how
// two writers rename each other's bytes into place.
//
// The probe is a sentinel at the name the old implementation used. A store
// that stages under a fixed truncating name destroys it; a store that stages
// under a fixed EXCLUSIVE name fails outright. Requiring both that the store
// succeeds and that the sentinel survives, byte for byte, is red against
// either variant and green only for a staging name the writer picked fresh.
func TestFloorStagingNeverReusesAFixedName(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	env := func(string) string { return panelsDataTestKeyHex }
	root, err := openPanelsDataRoot(dir)
	if err != nil {
		t.Fatalf("open root: %v", err)
	}
	defer root.Close()

	sentinelName := panelsFloorMarkerName + ".tmp"
	sentinel := []byte("another writer's bytes, mid-flight\n")
	if err := os.WriteFile(filepath.Join(dir, sentinelName), sentinel, 0o600); err != nil {
		t.Fatal(err)
	}

	base := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)
	for index := range 4 {
		floor := floorState(base.Add(time.Duration(index)*time.Minute),
			fmt.Sprintf("staging-%d", index))
		if err := newFloorMarker(root, env).Store(floor); err != nil {
			t.Fatalf("store %d: %v", index, err)
		}
		got, err := os.ReadFile(filepath.Join(dir, sentinelName))
		if err != nil {
			t.Fatalf("store %d removed the occupied fixed staging name: %v", index, err)
		}
		if !bytes.Equal(got, sentinel) {
			t.Fatalf("store %d staged over the occupied fixed name; %d bytes became %d",
				index, len(sentinel), len(got))
		}
	}

	// The marker itself is the newest floor, so the stores really happened.
	loaded, ok, err := newFloorMarker(root, env).Load()
	if !ok || err != nil {
		t.Fatalf("load: %v %v", ok, err)
	}
	if !loaded.Instant.Equal(base.Add(3 * time.Minute)) {
		t.Fatalf("the persisted floor is %v, want the newest store", loaded.Instant)
	}
	// Every OTHER staging file is gone: the sentinel is the only .tmp left,
	// which is what proves the writer cleaned up after itself.
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".tmp") && entry.Name() != sentinelName {
			t.Fatalf("a staging file survived the commit: %s", entry.Name())
		}
	}
}

// TestFloorStagingNamesAreExclusiveAndDistinct pins the same property as the
// test above WITHOUT knowing the old fixed name, which is the weakness of any
// sentinel probe: it kills the one spelling it guessed.
//
// This drives createFloorTemp directly and holds every staging file open at
// once, which is the situation a shared staging name is defined by. A fixed
// name is red twice over — exclusively opened it cannot be created a second
// time and the call errors, truncatingly opened it produces a duplicate name
// this checks for — and no name the writer picks fresh can fail either way.
func TestFloorStagingNamesAreExclusiveAndDistinct(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	root, err := openPanelsDataRoot(dir)
	if err != nil {
		t.Fatalf("open root: %v", err)
	}
	defer root.Close()

	seen := make(map[string]bool, 16)
	for index := range 16 {
		temp, file, err := createFloorTemp(root, panelsFloorMarkerName)
		if err != nil {
			t.Fatalf("staging %d refused while %d earlier files are still open; a shared staging name cannot be created twice: %v",
				index, index, err)
		}
		defer file.Close()
		if seen[temp] {
			t.Fatalf("staging %d reused the name %s; two writers would rename each other's bytes into place",
				index, temp)
		}
		seen[temp] = true
	}
	if len(seen) != 16 {
		t.Fatalf("16 stagings produced %d distinct names", len(seen))
	}
}
