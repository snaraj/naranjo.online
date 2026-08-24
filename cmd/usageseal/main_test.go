package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/snaraj/naranjo.online/internal/seal"
)

const testKeyHex = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

// writeKeyFile stages a key file with the given mode in a per-test directory.
func writeKeyFile(t *testing.T, contents string, mode os.FileMode) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "key.hex")
	if err := os.WriteFile(path, []byte(contents), mode); err != nil {
		t.Fatalf("write key file: %v", err)
	}
	// WriteFile honors umask; pin the exact mode the case asks for.
	if err := os.Chmod(path, mode); err != nil {
		t.Fatalf("chmod key file: %v", err)
	}
	return path
}

func TestSealThenOpenRoundTripsThroughTheCommand(t *testing.T) {
	t.Parallel()
	keyPath := writeKeyFile(t, testKeyHex+"\n", 0o600)
	plaintext := []byte(`{"schema":"usage-series/v1","sources":{}}`)

	var sealedOut, sealErr bytes.Buffer
	if code := run([]string{"-key-file", keyPath}, bytes.NewReader(plaintext), &sealedOut, &sealErr); code != 0 {
		t.Fatalf("seal exit %d, stderr: %s", code, sealErr.String())
	}
	if bytes.Contains(sealedOut.Bytes(), []byte("usage-series")) {
		t.Fatal("sealed output still contains plaintext")
	}

	var openedOut, openErr bytes.Buffer
	if code := run([]string{"-key-file", keyPath, "-mode", "open"}, bytes.NewReader(sealedOut.Bytes()), &openedOut, &openErr); code != 0 {
		t.Fatalf("open exit %d, stderr: %s", code, openErr.String())
	}
	if !bytes.Equal(openedOut.Bytes(), plaintext) {
		t.Fatal("round trip changed the payload")
	}
}

func TestCommandOutputInteroperatesWithTheLibrary(t *testing.T) {
	t.Parallel()
	keyPath := writeKeyFile(t, testKeyHex, 0o600)
	plaintext := []byte("library and command speak one format")

	var sealedOut, stderr bytes.Buffer
	if code := run([]string{"-key-file", keyPath}, bytes.NewReader(plaintext), &sealedOut, &stderr); code != 0 {
		t.Fatalf("seal exit %d, stderr: %s", code, stderr.String())
	}
	key, err := seal.ParseKey(testKeyHex)
	if err != nil {
		t.Fatalf("ParseKey: %v", err)
	}
	opened, err := seal.Open(key, sealedOut.Bytes())
	if err != nil {
		t.Fatalf("library Open of command output: %v", err)
	}
	if !bytes.Equal(opened, plaintext) {
		t.Fatal("library decrypt of command output differs")
	}
}

func TestRunRefusals(t *testing.T) {
	t.Parallel()
	goodKey := writeKeyFile(t, testKeyHex, 0o600)
	for name, testCase := range map[string]struct {
		args     []string
		stdin    []byte
		wantCode int
		wantErr  string
	}{
		"missing key flag":    {args: nil, wantCode: 1, wantErr: "-key-file is required"},
		"unknown mode":        {args: []string{"-key-file", goodKey, "-mode", "sign"}, wantCode: 2, wantErr: "seal or open"},
		"positional argument": {args: []string{"-key-file", goodKey, "series.json"}, wantCode: 2, wantErr: "positional"},
		"missing key file":    {args: []string{"-key-file", filepath.Join(t.TempDir(), "absent")}, wantCode: 1, wantErr: "key file"},
		"open of junk":        {args: []string{"-key-file", goodKey, "-mode", "open"}, stdin: []byte("not sealed"), wantCode: 1, wantErr: "sealed format"},
	} {
		var stdout, stderr bytes.Buffer
		code := run(testCase.args, bytes.NewReader(testCase.stdin), &stdout, &stderr)
		if code != testCase.wantCode {
			t.Fatalf("%s: exit %d, want %d (stderr: %s)", name, code, testCase.wantCode, stderr.String())
		}
		if !strings.Contains(stderr.String(), testCase.wantErr) {
			t.Fatalf("%s: stderr %q does not mention %q", name, stderr.String(), testCase.wantErr)
		}
		if stdout.Len() != 0 {
			t.Fatalf("%s: a refused run still wrote %d bytes of output", name, stdout.Len())
		}
	}
}

func TestRunRefusesAGroupReadableKeyFile(t *testing.T) {
	t.Parallel()
	keyPath := writeKeyFile(t, testKeyHex, 0o640)
	var stdout, stderr bytes.Buffer
	if code := run([]string{"-key-file", keyPath}, strings.NewReader("x"), &stdout, &stderr); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "chmod 600") {
		t.Fatalf("stderr %q does not direct the operator to chmod 600", stderr.String())
	}
}

func TestRunRefusesMalformedKeyContents(t *testing.T) {
	t.Parallel()
	keyPath := writeKeyFile(t, "not a key", 0o600)
	var stdout, stderr bytes.Buffer
	if code := run([]string{"-key-file", keyPath}, strings.NewReader("x"), &stdout, &stderr); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "64 hex characters") {
		t.Fatalf("stderr %q does not explain the key format", stderr.String())
	}
}

func TestRunRefusesOversizedInput(t *testing.T) {
	t.Parallel()
	keyPath := writeKeyFile(t, testKeyHex, 0o600)
	var stdout, stderr bytes.Buffer
	oversized := bytes.NewReader(bytes.Repeat([]byte{'a'}, maxInputBytes+1))
	if code := run([]string{"-key-file", keyPath}, oversized, &stdout, &stderr); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "byte bound") {
		t.Fatalf("stderr %q does not name the byte bound", stderr.String())
	}
}
