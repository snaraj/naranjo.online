package server

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/snaraj/naranjo.online/internal/seal"
	"github.com/snaraj/naranjo.online/internal/testsupport"
)

// TestRetainedDocumentRoundTripsAcrossRootInstances pins the kept copy the
// data root restores at boot (issue #358): absent reads as (nil, nil), a kept
// document survives a fresh root over the same directory byte for byte, and
// anything past the sealed-file ceiling is refused rather than truncated.
func TestRetainedDocumentRoundTripsAcrossRootInstances(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	env := func(string) string { return panelsDataTestKeyHex }

	first, err := openPanelsDataRoot(dir)
	if err != nil {
		t.Fatalf("open first root: %v", err)
	}
	marker := newFloorMarker(first, env)
	if marker.Retain == nil || marker.Retained == nil {
		t.Fatal("the production marker does not carry the retained-copy capability")
	}
	if kept, err := marker.Retained(); kept != nil || err != nil {
		t.Fatalf("an empty state directory must read as nothing kept: %q %v", kept, err)
	}
	document := bytes.Repeat([]byte{0x5a}, 4096)
	if err := marker.Retain(document); err != nil {
		t.Fatalf("retain: %v", err)
	}
	first.Close()

	second, err := openPanelsDataRoot(dir)
	if err != nil {
		t.Fatalf("open second root: %v", err)
	}
	defer second.Close()
	kept, err := newFloorMarker(second, env).Retained()
	if err != nil || !bytes.Equal(kept, document) {
		t.Fatalf("the kept copy did not survive the restart: %d bytes, %v", len(kept), err)
	}
	info, err := os.Stat(filepath.Join(dir, panelsRetainedName))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("the kept copy is not a private file: %v %v", info, err)
	}

	oversized := bytes.Repeat([]byte{0x5a}, seal.MaxSealedBytes+1)
	if err := os.WriteFile(filepath.Join(dir, panelsRetainedName), oversized, 0o600); err != nil {
		t.Fatal(err)
	}
	if kept, err := newFloorMarker(second, env).Retained(); err == nil || kept != nil {
		t.Fatalf("a kept copy past the sealed-file ceiling was read: %d bytes", len(kept))
	}

	// A symlink planted in the state directory resolves outside the root and
	// is refused by the rooted filesystem, never followed.
	outside := filepath.Join(t.TempDir(), "elsewhere")
	if err := os.WriteFile(outside, document, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dir, panelsRetainedName)); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, panelsRetainedName)); err != nil {
		t.Fatal(err)
	}
	if kept, err := newFloorMarker(second, env).Retained(); err == nil || kept != nil {
		t.Fatalf("a kept copy outside the state root was read through a symlink: %d bytes", len(kept))
	}
}

// plantFIFO replaces name in dir with a FIFO no one writes to, and returns a
// release that opens its write end: on the unfixed code the reader is parked
// in open() until a writer appears, and the release is what lets a failing
// test end instead of hanging the package.
func plantFIFO(t *testing.T, dir, name string) (release func()) {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(path, 0o600); err != nil {
		t.Fatalf("mkfifo: %v", err)
	}
	release = func() {
		if writer, err := os.OpenFile(path, os.O_WRONLY|syscall.O_NONBLOCK, 0); err == nil {
			writer.Close()
		}
	}
	t.Cleanup(release)
	return release
}

// TestStateFilesNeverBlockOnASpecialFile pins review finding F3 of #359 at the
// reader: a FIFO where the kept copy or the floor marker belongs is refused
// at once, never waited on, and the two readers keep their own verdicts — the
// optional kept copy is an error the loop logs and goes past, the required
// marker is "unreadable" and the loop serves nothing on it.
func TestStateFilesNeverBlockOnASpecialFile(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	env := func(string) string { return panelsDataTestKeyHex }
	root, err := openPanelsDataRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	marker := newFloorMarker(root, env)

	for _, step := range []struct {
		name string
		read func() error
	}{
		{panelsRetainedName, func() error { _, err := marker.Retained(); return err }},
		{panelsFloorMarkerName, func() error { _, _, err := marker.Load(); return err }},
	} {
		release := plantFIFO(t, dir, step.name)
		done := make(chan error, 1)
		go func() { done <- step.read() }()
		select {
		case err := <-done:
			if err == nil {
				t.Fatalf("%s: a FIFO was read as a state file", step.name)
			}
		case <-time.After(2 * time.Second):
			release()
			<-done
			t.Fatalf("%s: the read waited on a FIFO instead of refusing it", step.name)
		}
	}
}

// TestFreshAdmissionProceedsPastAFIFORetainedCopy is the finding's own probe on
// a real Site: an authenticated floor newer than the embedded snapshot, a
// FIFO where the kept copy belongs, and a valid newer sealed source. The
// newer source is admitted and served ok; the kept copy's refusal costs the
// restore and nothing else.
func TestFreshAdmissionProceedsPastAFIFORetainedCopy(t *testing.T) {
	t.Parallel()
	dataDir, stateDir := t.TempDir(), t.TempDir()
	env := func(string) string { return panelsDataTestKeyHex }
	now := time.Now().UTC().Truncate(time.Second)
	// Both inside the freshness grace, so each is served ok on its own merits.
	first, newer := now.Add(-2*time.Minute).Format(time.RFC3339), now.Format(time.RFC3339)

	site1, err := New(testsupport.FrontendFS())
	if err != nil {
		t.Fatal(err)
	}
	labels, modelKeys := shippedSourceLabels(t, site1), shippedModelKeys(t, site1)
	sealSeriesFile(t, dataDir, labels, modelKeys, first)
	ctx1, cancel1 := context.WithCancel(context.Background())
	if err := site1.StartPanelData(ctx1, dataDir, stateDir, env); err != nil {
		t.Fatal(err)
	}
	waitServed(t, site1, first, "ok")
	cancel1()
	site1.Close()

	release := plantFIFO(t, stateDir, panelsRetainedName)
	sealSeriesFile(t, dataDir, labels, modelKeys, newer)
	site2, err := New(testsupport.FrontendFS())
	if err != nil {
		t.Fatal(err)
	}
	ctx2, cancel2 := context.WithCancel(context.Background())
	defer func() { cancel2(); release(); site2.Close() }()
	if err := site2.StartPanelData(ctx2, dataDir, stateDir, env); err != nil {
		t.Fatal(err)
	}
	waitServed(t, site2, newer, "ok")
}

func waitServed(t *testing.T, site *Site, generatedAt, status string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		envelope := servedTokenUsage(t, site)
		if envelope["generatedAt"] == generatedAt && envelope["status"] == status {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("never served %s/%s; envelope: %v", generatedAt, status, envelope)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
