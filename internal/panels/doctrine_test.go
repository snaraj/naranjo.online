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
	"encoding/json"
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
	// log/slog was admitted with the refresh-observability work: it is the
	// stdlib structured logger the injected registry logger is typed as, it
	// has no egress capability of its own, and the refresh narrative it
	// writes is pinned by logging_test to carry hosts and labels only —
	// never a URL, credential, or payload byte.
	"log/slog":    true,
	"net/http":    true,
	"strconv":     true,
	"strings":     true,
	"sync":        true,
	"sync/atomic": true,
	"time":        true,
	"bytes":       true,
}

// allowedEgressImports extends the base surface for the egress file only:
// URL handling for allowlist enforcement, the environment read that injects
// credentials at fetch time, and — added with issue #79's destination guard —
// the two packages needed to decide whether a resolved address may be
// connected to at all.
//
// The widening is deliberately in the narrow direction. net and net/netip
// buy the egress file the ability to resolve a name and refuse the answer;
// they are NOT added to allowedProductionImports, so every other production
// file remains unable to name an address, let alone reach one. A future edit
// that needs them elsewhere is a conscious change to the list ABOVE, and a
// different security review.
var allowedEgressImports = map[string]bool{
	"net":       true,
	"net/netip": true,
	"net/url":   true,
	"os":        true,
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
	// The version-control host the contribution calendar is fetched from.
	// It is a vendor exactly like the others: the panel kind is named for
	// what it reports, not for where it comes from, so the host belongs in
	// config data and the compiled binary carries no coupling to it.
	"git" + "hub",
	// The written SOURCE name the second vocabulary file declares (issue
	// #267). Until config/sources.json existed there was nowhere to declare
	// what a source is CALLED, so the name would have landed in a component
	// or here; it is data now, and this needle is what keeps it there.
	"cla" + "ude",
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
		for _, mark := range spelledVendors(string(data)) {
			t.Errorf("%s contains the vendor name %q: vendors appear only as data labels inside snapshots and config, never in Go source", name, mark)
		}
	}
}

// spelledVendors is the scan itself, lifted out of the sweep so the sweep can
// be shown to FAIL. A guard that cannot redden is decoration, and the sweep
// above reads an always-clean tree — so on its own it proves only that the
// tree is clean today, never that a dirty one would be caught.
func spelledVendors(content string) []string {
	lowered := strings.ToLower(content)
	var found []string
	for _, mark := range vendorMarks {
		if strings.Contains(lowered, mark) {
			found = append(found, mark)
		}
	}
	return found
}

// TestTheVendorSweepCanFail is the non-vacuity half. Every mark gets a source
// line that reintroduces it — case-folded, because a display name is
// capitalised and the sweep must not be defeated by a capital letter — and a
// clean line must stay clean.
//
// The written SOURCE name (issue #267) is the case this earns its keep on:
// `"Claude Code"` is display copy that would look perfectly at home beside a
// panel title, and config/sources.json is the only place it may be spelled.
func TestTheVendorSweepCanFail(t *testing.T) {
	t.Parallel()
	if len(vendorMarks) == 0 {
		t.Fatal("the sweep has nothing to look for")
	}
	for _, mark := range vendorMarks {
		titled := strings.ToUpper(mark[:1]) + mark[1:]
		found := spelledVendors(`const name = "` + titled + ` Code"`)
		if len(found) != 1 || found[0] != mark {
			t.Errorf("a source spelling %q was not caught; the sweep found %v", titled, found)
		}
	}
	if found := spelledVendors("// the vendor group renders its own block"); len(found) != 0 {
		t.Errorf("ordinary prose tripped the sweep: %v", found)
	}
}

// TestTheVendorMarkListCoversTheShippedVocabularies closes the hole the
// mutation audit found in the pair above: TestTheVendorSweepCanFail iterates
// `vendorMarks`, so DELETING a mark removes a subject rather than failing a
// check, and the sweep would then quietly stop looking for a name it used to
// catch. Nothing in a list-driven pin notices its own list getting shorter.
//
// So the list is pinned against the DATA it mirrors, read at test time: every
// written name and every vendor group the two shipped vocabulary files carry
// must be covered by some mark. This file still spells no vendor — the
// subjects come out of config/sources.json and config/models.json, which is
// exactly where they are allowed to live.
//
// One honest limit: the version-control HOST mark is not derived here,
// because a host lives in the fetch config's endpoint URLs rather than in a
// vocabulary field, and parsing one out would be a second, weaker derivation.
// It stays hand-kept, and the list may never shrink below what this covers.
func TestTheVendorMarkListCoversTheShippedVocabularies(t *testing.T) {
	t.Parallel()
	var sources struct {
		Sources []struct {
			Name   string `json:"name"`
			Vendor string `json:"vendor"`
		} `json:"sources"`
	}
	readVocabulary(t, "config/sources.json", &sources)
	var models struct {
		Groups []struct {
			Key   string `json:"key"`
			Label string `json:"label"`
		} `json:"groups"`
	}
	readVocabulary(t, "config/models.json", &models)
	var subjects []string
	for _, source := range sources.Sources {
		subjects = append(subjects, source.Name, source.Vendor)
	}
	for _, group := range models.Groups {
		subjects = append(subjects, group.Key, group.Label)
	}
	if len(subjects) < 4 {
		t.Fatalf("only %d vendor-bearing fields found; the pin has almost nothing to cover", len(subjects))
	}
	for _, subject := range subjects {
		if subject == "" {
			t.Error("a shipped vocabulary carries an empty vendor-bearing field")
			continue
		}
		if len(spelledVendors(subject)) == 0 {
			t.Errorf("no vendorMarks entry covers a shipped vocabulary field (%d bytes); deleting a mark silently stops the sweep looking for it", len(subject))
		}
	}
}

// readVocabulary decodes one shipped vocabulary file into the caller's shape.
// Read from disk rather than from the embed so a failure names the file an
// editor would open.
func readVocabulary(t *testing.T, name string, into any) {
	t.Helper()
	raw, err := os.ReadFile(name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	if err := json.Unmarshal(raw, into); err != nil {
		t.Fatalf("parse %s: %v", name, err)
	}
}
