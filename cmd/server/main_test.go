package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestMediaConfigurationRejectsPartialEnablement keeps the runtime aligned with
// the chart's fail-closed storage sentinel and prevents silently ignored paths.
func TestMediaConfigurationRejectsPartialEnablement(t *testing.T) {
	for name, values := range map[string][3]string{
		"unknown switch":       {"yes", "", ""},
		"root while disabled":  {"false", "/not/used", ""},
		"limit while disabled": {"", "", "2"},
		"missing root":         {"true", "", "2"},
		"missing concurrency":  {"true", "/reviewed", ""},
		"zero concurrency":     {"true", "/reviewed", "0"},
		"excess concurrency":   {"true", "/reviewed", "4097"},
		"invalid concurrency":  {"true", "/reviewed", "many"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, err := mediaConfiguration(values[0], values[1], values[2]); err == nil {
				t.Fatal("mediaConfiguration() unexpectedly succeeded")
			}
		})
	}
}

// TestListenPort locks the single runtime listener setting: the chart-aligned
// 8080 default, the full valid range, and loud rejection of anything a broken
// pod specification could supply.
// TestPanelsRefreshConfigurationFailsClosed pins the egress opt-in gate:
// live panel refresh stays off by default, enables only on an explicit
// "true", and any other value refuses the boot instead of guessing.
func TestPanelsRefreshConfigurationFailsClosed(t *testing.T) {
	t.Parallel()
	for value, want := range map[string]bool{"": false, "false": false, "true": true} {
		enabled, err := panelsRefreshConfiguration(value)
		if err != nil || enabled != want {
			t.Errorf("panelsRefreshConfiguration(%q) = %v, %v; want %v, nil", value, enabled, err, want)
		}
	}
	for _, value := range []string{"maybe", "TRUE", "1", "yes"} {
		if _, err := panelsRefreshConfiguration(value); err == nil {
			t.Errorf("panelsRefreshConfiguration(%q) accepted an unrecognized value", value)
		}
	}
}

// TestPanelsDataConfigurationFailsClosed pins the data-root gate: unset
// leaves the capability entirely absent, an absolute path passes through
// untouched, and a relative path refuses the boot instead of being resolved
// against a working directory nobody chose.
func TestPanelsDataConfigurationFailsClosed(t *testing.T) {
	t.Parallel()
	if root, err := panelsDataConfiguration(""); err != nil || root != "" {
		t.Errorf("panelsDataConfiguration(\"\") = %q, %v; want empty, nil", root, err)
	}
	real := resolved(t, t.TempDir())
	if root, err := panelsDataConfiguration(real); err != nil || root != real {
		t.Errorf("panelsDataConfiguration(abs) = %q, %v", root, err)
	}
	for _, value := range []string{"relative/dir", "./here", "~", "data"} {
		if _, err := panelsDataConfiguration(value); err == nil {
			t.Errorf("panelsDataConfiguration(%q) accepted a relative path", value)
		}
	}
	// A root that does not resolve to an existing directory fails the boot,
	// on the same grounds an unopenable root already did: the capability
	// projects real bytes, and a path that names nothing cannot be carried
	// forward as a string that might mean something later.
	if _, err := panelsDataConfiguration(filepath.Join(real, "absent")); err == nil {
		t.Error("panelsDataConfiguration accepted a path that does not exist")
	}
	file := filepath.Join(real, "afile")
	if err := os.WriteFile(file, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := panelsDataConfiguration(file); err == nil {
		t.Error("panelsDataConfiguration accepted a regular file as a root")
	}
	// The messages name the VARIABLE and never the path: this text reaches a
	// startup log, and a path is a host fact.
	if _, err := panelsDataConfiguration("relative/dir"); err == nil || strings.Contains(err.Error(), "relative/dir") {
		t.Errorf("the refusal leaked the supplied path: %v", err)
	}
}

// resolved is what the boundary itself computes: the one path the kernel
// would open. Tests compare against it rather than against the string they
// passed in, because on this platform a temporary directory is reached
// through a symlinked prefix and the two spellings are the same directory.
func resolved(t *testing.T, dir string) string {
	t.Helper()
	value, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatalf("resolve %s: %v", dir, err)
	}
	return value
}

// TestPanelsDataRootsMustBeSeparateDirectories is the executable half of the
// separation the chart already enforces (2026-08-25 round-4 review, finding
// 2). The chart is not the boundary — this binary is, and the reviewer ran
// the exact shipped image with BOTH roots pointed at one directory: it served
// the staged document as `ok` and wrote its floor marker beside the
// ciphertext it is supposed to only read.
//
// The hostile table is the same one the chart's storage pin carries, because
// the property is the same: equal roots, nesting in either direction, and the
// alias spellings a string comparison calls different — `..` traversal and
// duplicated separators. Symlink aliasing is covered too, which no lexical
// check can see.
func TestPanelsDataRootsMustBeSeparateDirectories(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	data := filepath.Join(base, "panels-data")
	state := filepath.Join(base, "panels-state")
	inside := filepath.Join(data, "state")
	for _, dir := range []string{data, state, inside} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	// A sibling that merely SHARES A PREFIX must still be admitted; a check
	// that refuses this one is broken rather than strict.
	sibling := filepath.Join(base, "panels-data-two")
	if err := os.MkdirAll(sibling, 0o700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(base, "alias")
	if err := os.Symlink(data, link); err != nil {
		t.Fatal(err)
	}
	canonicalData, err := panelsDataConfiguration(data)
	if err != nil {
		t.Fatalf("data root: %v", err)
	}

	for name, value := range map[string]string{
		"the same directory":               data,
		"a trailing separator alias":       data + "/",
		"a duplicated separator alias":     filepath.Dir(data) + "//" + filepath.Base(data),
		"a dot-dot alias":                  filepath.Join(data, "..", "panels-data"),
		"a symlink to the data root":       link,
		"a directory inside the data root": inside,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if got, err := panelsDataStateConfiguration(value, canonicalData); err == nil {
				t.Fatalf("the binary accepted a state root that is %s (resolved %q)", name, got)
			}
		})
	}

	t.Run("the data root inside the state root", func(t *testing.T) {
		t.Parallel()
		outerData, err := panelsDataConfiguration(inside)
		if err != nil {
			t.Fatalf("inner data root: %v", err)
		}
		if _, err := panelsDataStateConfiguration(data, outerData); err == nil {
			t.Fatal("the binary accepted a data root nested inside the state root")
		}
	})

	t.Run("a genuine sibling is admitted", func(t *testing.T) {
		t.Parallel()
		got, err := panelsDataStateConfiguration(state, canonicalData)
		if err != nil || got != resolved(t, state) {
			t.Fatalf("panelsDataStateConfiguration(sibling) = %q, %v", got, err)
		}
		if got, err := panelsDataStateConfiguration(sibling, canonicalData); err != nil {
			t.Fatalf("a prefix-sharing sibling was refused: %q %v", got, err)
		}
	})

	t.Run("state without a data root is refused", func(t *testing.T) {
		t.Parallel()
		if _, err := panelsDataStateConfiguration(state, ""); err == nil {
			t.Fatal("PANELS_DATA_STATE was accepted without PANELS_DATA_ROOT")
		}
	})

	t.Run("empty state keeps the documented process-memory mode", func(t *testing.T) {
		t.Parallel()
		if got, err := panelsDataStateConfiguration("", canonicalData); err != nil || got != "" {
			t.Fatalf("panelsDataStateConfiguration(\"\") = %q, %v", got, err)
		}
	})
}

func TestListenPort(t *testing.T) {
	t.Parallel()
	for name, testCase := range map[string]struct {
		value   string
		want    int
		wantErr bool
	}{
		"empty defaults to the chart port": {value: "", want: 8080},
		"explicit port":                    {value: "9090", want: 9090},
		"lowest valid port":                {value: "1", want: 1},
		"highest valid port":               {value: "65535", want: 65535},
		"zero is refused":                  {value: "0", wantErr: true},
		"negative is refused":              {value: "-1", wantErr: true},
		"above range is refused":           {value: "65536", wantErr: true},
		"non-numeric is refused":           {value: "http", wantErr: true},
		"trailing junk is refused":         {value: "8080x", wantErr: true},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			got, err := listenPort(testCase.value)
			if testCase.wantErr {
				if err == nil {
					t.Fatalf("listenPort(%q) = %d, want error", testCase.value, got)
				}
				return
			}
			if err != nil || got != testCase.want {
				t.Fatalf("listenPort(%q) = %d, %v, want %d, nil", testCase.value, got, err, testCase.want)
			}
		})
	}
}

// TestMediaConfigurationHasNoInventedDefaults verifies disabled startup and
// exact operator-supplied enablement without choosing Pi values in code.
func TestMediaConfigurationHasNoInventedDefaults(t *testing.T) {
	enabled, options, err := mediaConfiguration("", "", "")
	if err != nil || enabled || options.Root != "" || options.MaxConcurrent != 0 {
		t.Fatalf("disabled configuration = enabled=%t options=%+v err=%v", enabled, options, err)
	}
	enabled, options, err = mediaConfiguration("true", "/reviewed", "7")
	if err != nil || !enabled || options.Root != "/reviewed" || options.MaxConcurrent != 7 {
		t.Fatalf("enabled configuration = enabled=%t options=%+v err=%v", enabled, options, err)
	}
}
