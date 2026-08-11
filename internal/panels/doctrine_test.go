// doctrine_test pins two structural promises of this package, in the same
// fail-closed spirit as internal/doctrine's provider-neutrality pin.
//
// First, zero egress: the production panels runtime must be incapable of a
// network call. Every production import must sit on a reviewed stdlib
// allowlist with no dialing package on it, and the net/http surface — needed
// only to answer requests — must never reach for its client side.
//
// Second, vendor neutrality in code: tool and vendor names are snapshot data
// labels, never Go identifiers, comments, or string literals in production
// source, so a provider swap is a data edit and the compiled binary carries
// no vendor coupling.
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

// allowedProductionImports is the reviewed import surface of this package's
// production files. Anything absent — especially net, net/url, os, or any
// syscall-adjacent package — fails the pin; widening the list is a conscious
// reviewed edit here.
var allowedProductionImports = map[string]bool{
	"bytes":         true,
	"crypto/sha256": true,
	"embed":         true,
	"encoding/hex":  true,
	"encoding/json": true,
	"errors":        true,
	"fmt":           true,
	"io":            true,
	"io/fs":         true,
	"net/http":      true,
	"strings":       true,
	"time":          true,
}

// forbiddenHTTPSelectors is the client half of net/http: constructing or
// invoking any of these would give the runtime egress capability even while
// the import list stays clean, so each is banned by name.
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
// inside snapshot files. Each needle is assembled from fragments so this
// file never contains the banned spelling itself; the list mirrors the
// labels the shipped token-usage snapshot carries.
var vendorMarks = []string{
	"anthro" + "pic",
	"co" + "dex",
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

// TestPanelsRuntimeHasNoEgressCapability fails closed on any path to the
// network: an import outside the reviewed stdlib allowlist, or any use of
// net/http's client surface, in any production file of this package.
func TestPanelsRuntimeHasNoEgressCapability(t *testing.T) {
	t.Parallel()
	for name, file := range productionSources(t) {
		for _, spec := range file.Imports {
			path, err := strconv.Unquote(spec.Path.Value)
			if err != nil {
				t.Fatalf("%s: unquote import %s: %v", name, spec.Path.Value, err)
			}
			if !allowedProductionImports[path] {
				t.Errorf("%s imports %q, outside the reviewed zero-egress allowlist; widening the list is a conscious edit in doctrine_test.go", name, path)
			}
		}
		ast.Inspect(file, func(node ast.Node) bool {
			selector, ok := node.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			if base, ok := selector.X.(*ast.Ident); ok && base.Name == "http" && forbiddenHTTPSelectors[selector.Sel.Name] {
				t.Errorf("%s uses http.%s: the panels runtime must have no client-side HTTP capability", name, selector.Sel.Name)
			}
			return true
		})
	}
}

// TestVendorNamesStayOutOfProductionSource scans every production file's
// bytes — identifiers, strings, and comments alike — for the vendor marks.
// The snapshot JSON files are exempt by construction: they are data, and
// data labels are exactly where vendor names belong.
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
				t.Errorf("%s contains the vendor name %q: vendors appear only as data labels inside snapshots, never in Go source", name, mark)
			}
		}
	}
}
