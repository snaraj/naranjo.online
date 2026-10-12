package server

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/snaraj/naranjo.online/internal/seal"
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
