// doctrine_test pins the structural promises of this package after the
// owner's fetch-first revision, in the same fail-closed spirit as
// internal/doctrine's provider-neutrality pin.
//
// First, CONFINED egress: live fetching is a sanctioned capability now, but
// its machinery — HTTP client construction, request building, URL handling,
// environment reads — may exist ONLY in fetch.go. Every other production
// file keeps a reviewed zero-egress import surface and is banned from the
// net/http client selectors, so a stray fetch can never appear on a serving
// or construction path.
//
// Second, vendor neutrality in code: tool and vendor names are data labels
// inside snapshots and the embedded fetch config, never Go identifiers,
// comments, or string literals in production source, so a provider swap is a
// data edit and the compiled binary carries no vendor coupling.
package panels

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strconv"
	"strings"
	"testing"
)

// egressFile is the single production file allowed to hold egress machinery.
var egressFile = "fetch.go"

// allowedProductionImports is the reviewed import surface for every
// production file EXCEPT the egress file. Anything absent — especially net,
// net/url, os, or any syscall-adjacent package — fails the pin; widening the
// list is a conscious reviewed edit here.
var allowedProductionImports = map[string]bool{
	"context":       true,
	"crypto/sha256": true,
	"embed":         true,
	"encoding/hex":  true,
	"encoding/json": true,
	"errors":        true,
	"fmt":           true,
	"io":            true,
	"io/fs":         true,
	"net/http":      true,
	"strconv":       true,
	"strings":       true,
	"sync":          true,
	"sync/atomic":   true,
	"time":          true,
	"bytes":         true,
}

// allowedEgressImports extends the base surface for the egress file only:
// URL handling for allowlist enforcement and the environment read that
// injects credentials at fetch time.
var allowedEgressImports = map[string]bool{
	"net/url": true,
	"os":      true,
}

// forbiddenHTTPSelectors is the client half of net/http: constructing or
// invoking any of these gives a file egress capability even while its import
// list stays clean, so each is banned by name outside the egress file.
var forbiddenHTTPSelectors = map[string]bool{
	"Client":                true,
	"DefaultClient":         true,
	"DefaultTransport":      true,
	"Get":                   true,
	"Head":                  true,
	"NewRequest":            true,
	"NewRequestWithContext": true,
	"Post":                  true,
	"PostForm":              true,
	"Transport":             true,
}

// vendorMarks are the vendor and tool names that may appear ONLY as data
// inside snapshot and config files. Each needle is assembled from fragments
// so this file never contains the banned spelling itself; the list mirrors
// the labels and hosts the shipped data files carry.
var vendorMarks = []string{
	"anthro" + "pic",
	"co" + "dex",
	"open" + "ai",
}

// productionSources parses every non-test Go file of this package.
func productionSources(t *testing.T) map[string]*ast.File {
	t.Helper()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read package directory: %v", err)
	}
	fset := token.NewFileSet()
	sources := make(map[string]*ast.File)
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		parsed, err := parser.ParseFile(fset, name, nil, parser.ParseComments)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		sources[name] = parsed
	}
	if len(sources) == 0 {
		t.Fatal("no production sources found; the pin has nothing to protect")
	}
	return sources
}

// TestEgressStaysConfinedToTheFetchFile fails closed on egress capability
// anywhere else: an import outside the reviewed allowlist, an egress-only
// import outside fetch.go, or any use of net/http's client surface in any
// other production file.
func TestEgressStaysConfinedToTheFetchFile(t *testing.T) {
	t.Parallel()
	sources := productionSources(t)
	if _, ok := sources[egressFile]; !ok {
		t.Fatalf("%s is missing; the egress confinement pin has lost its anchor", egressFile)
	}
	for name, file := range sources {
		isEgressFile := name == egressFile
		for _, spec := range file.Imports {
			path, err := strconv.Unquote(spec.Path.Value)
			if err != nil {
				t.Fatalf("%s: unquote import %s: %v", name, spec.Path.Value, err)
			}
			if allowedProductionImports[path] {
				continue
			}
			if isEgressFile && allowedEgressImports[path] {
				continue
			}
			t.Errorf("%s imports %q, outside its reviewed allowlist; egress machinery lives only in %s, and widening a list is a conscious edit in doctrine_test.go", name, path, egressFile)
		}
		if isEgressFile {
			continue
		}
		ast.Inspect(file, func(node ast.Node) bool {
			selector, ok := node.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			if base, ok := selector.X.(*ast.Ident); ok && base.Name == "http" && forbiddenHTTPSelectors[selector.Sel.Name] {
				t.Errorf("%s uses http.%s: the net/http client surface is confined to %s", name, selector.Sel.Name, egressFile)
			}
			return true
		})
	}
}

// TestVendorNamesStayOutOfProductionSource scans every production file's
// bytes — identifiers, strings, and comments alike — for the vendor marks.
// The snapshot and config JSON files are exempt by construction: they are
// data, and data is exactly where vendor names belong.
func TestVendorNamesStayOutOfProductionSource(t *testing.T) {
	t.Parallel()
	for name := range productionSources(t) {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		content := strings.ToLower(string(data))
		for _, mark := range vendorMarks {
			if strings.Contains(content, mark) {
				t.Errorf("%s contains the vendor name %q: vendors appear only as data labels inside snapshots and config, never in Go source", name, mark)
			}
		}
	}
}
