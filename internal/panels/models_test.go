// models_test drives the two embedded vocabularies: the model file (issue
// #302) that spells every model key, written name, palette slot, vendor group
// and raw identifier, and the source file beside it (issue #267) that spells
// every reporting tool's key and written name. Two data files, one rule.
//
// Two jobs per file. First, the SHIPPED file is proven to load and to say
// what the origin then relies on — the residual leading the model serve
// order, the order being the file's own, the row bound being the vocabulary's
// own size, and every source label the pipeline can push being a key the page
// has a name for. Second, every rule each loader enforces is shown to have an
// input that fails it: a validator no input can redden is decoration, and
// these stand between a data edit and what a public page renders.

package panels

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// modelsFilePath is the shipped vocabulary, read from disk rather than from
// the embed so a test failure names the file an editor would open.
const modelsFilePath = "config/models.json"

// sourcesFilePath is the source vocabulary, read the same way and for the
// same reason.
const sourcesFilePath = "config/sources.json"

// TestTheShippedModelVocabularyLoads proves the embedded file is usable and
// that the serve order it produces is exactly the file's own reading order:
// the residual first, then each group's members in the order the file lists
// them. Derived here from the raw JSON rather than transcribed, so the pin
// stays true as the vocabulary grows and can never become two hardcoded
// lists compared against each other.
func TestTheShippedModelVocabularyLoads(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile(modelsFilePath)
	if err != nil {
		t.Fatalf("read %s: %v", modelsFilePath, err)
	}
	var document struct {
		Schema   string `json:"schema"`
		Residual struct {
			Key  string `json:"key"`
			Slot int    `json:"slot"`
		} `json:"residual"`
		Groups []struct {
			Key     string `json:"key"`
			Label   string `json:"label"`
			Members []struct {
				Key   string `json:"key"`
				Label string `json:"label"`
				Slot  int    `json:"slot"`
			} `json:"members"`
		} `json:"groups"`
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatalf("parse %s: %v", modelsFilePath, err)
	}
	want := []string{document.Residual.Key}
	for _, group := range document.Groups {
		for _, member := range group.Members {
			want = append(want, member.Key)
		}
	}
	if len(modelServeOrder) != len(want) {
		t.Fatalf("the vocabulary serves %d keys; %s declares %d", len(modelServeOrder), modelsFilePath, len(want))
	}
	for index, key := range want {
		if modelServeOrder[index] != key {
			t.Errorf("serve position %d is %q; %s declares %q there", index, modelServeOrder[index], modelsFilePath, key)
		}
	}
	if modelServeOrder[0] != document.Residual.Key {
		t.Errorf("the serve order opens with %q, not the residual %q; the fold is keyed on the residual leading", modelServeOrder[0], document.Residual.Key)
	}
	// The row bound is the vocabulary's own size, so a document naming more
	// rows than the file has members is refused before a key is looked up,
	// and widening the bound is a data edit rather than a code edit.
	if maxSeriesModels != len(want) {
		t.Errorf("maxSeriesModels is %d; the vocabulary declares %d members", maxSeriesModels, len(want))
	}
	// More than one group, or the group machinery below is untested by the
	// shipped file and the block-per-group rendering has nothing to render.
	if len(document.Groups) < 2 {
		t.Errorf("the shipped vocabulary declares %d group(s); the grouping rules are only exercised by two or more", len(document.Groups))
	}
	// Every named member carries a written name that is not its key: a key
	// humanizes to something that is not a product's name, which is the whole
	// reason the label is data rather than a transformation.
	for _, group := range document.Groups {
		if group.Label == "" {
			t.Errorf("group %q carries no written label; its block would be headed with nothing", group.Key)
		}
		for _, member := range group.Members {
			if member.Label == "" || member.Label == member.Key {
				t.Errorf("member %q carries %q as its written name; a label is display copy, never the key", member.Key, member.Label)
			}
		}
	}
}

// TestTheModelVocabularyRefusesEveryMalformedShape is the non-vacuity half:
// each rule the loader states is given an input that breaks it, and the load
// must refuse the WHOLE file rather than dropping the offending member. A
// vocabulary with a hole is three readers that disagree.
func TestTheModelVocabularyRefusesEveryMalformedShape(t *testing.T) {
	t.Parallel()
	// The template is deliberately minimal and vendor-free: this test proves
	// the RULES, and the shipped file is proven separately above.
	const template = `{
		"schema": "usage-models/v1",
		"residual": {"key": "other", "label": "Other", "slot": 0},
		"groups": [
			{"key": "alpha", "label": "Alpha", "members": [
				{"key": "alpha-one", "label": "Alpha One", "slot": 1, "ids": ["raw-alpha-one"], "prefixStrip": false},
				{"key": "alpha-two", "label": "Alpha Two", "slot": 2, "ids": [], "prefixStrip": true}
			]},
			{"key": "beta", "label": "Beta", "members": [
				{"key": "beta-one", "label": "Beta One", "slot": 1, "ids": ["raw-beta-one"], "prefixStrip": false}
			]}
		]
	}`
	if _, _, err := loadModelVocabulary([]byte(template)); err != nil {
		t.Fatalf("the template must load, or every case below refuses for the wrong reason: %v", err)
	}
	for name, testCase := range map[string]struct {
		document string
		wantErr  string
	}{
		"a schema marker this code does not understand": {
			strings.Replace(template, `"usage-models/v1"`, `"usage-models/v2"`, 1),
			"schema",
		},
		"a field outside the declared shape": {
			strings.Replace(template, `"schema":`, `"unexpected": 1, "schema":`, 1),
			"unknown field",
		},
		"a residual on a chromatic slot": {
			strings.Replace(template, `"label": "Other", "slot": 0`, `"label": "Other", "slot": 3`, 1),
			"neutral slot",
		},
		"a residual an identifier can name": {
			strings.Replace(template, `"key": "other", "label": "Other"`, `"key": "other", "ids": ["raw-other"], "label": "Other"`, 1),
			"fold of everything else",
		},
		"a residual that folds by prefix": {
			strings.Replace(template, `"key": "other", "label": "Other"`, `"key": "other", "prefixStrip": true, "label": "Other"`, 1),
			"fold of everything else",
		},
		"a residual with no written name": {
			strings.Replace(template, `"label": "Other"`, `"label": ""`, 1),
			"written label",
		},
		"a key that is not machine-shaped": {
			strings.Replace(template, `"key": "alpha-one"`, `"key": "Alpha One"`, 1),
			"machine key",
		},
		"a member with no written name": {
			strings.Replace(template, `"label": "Alpha One"`, `"label": ""`, 1),
			"written label",
		},
		"a negative palette slot": {
			strings.Replace(template, `"slot": 1, "ids": ["raw-alpha-one"]`, `"slot": -1, "ids": ["raw-alpha-one"]`, 1),
			"negative palette slot",
		},
		"a named member on the residual's neutral slot": {
			strings.Replace(template, `"slot": 1, "ids": ["raw-alpha-one"]`, `"slot": 0, "ids": ["raw-alpha-one"]`, 1),
			"residual's neutral slot",
		},
		"two members of one group painted the same": {
			strings.Replace(template, `"slot": 2, "ids": []`, `"slot": 1, "ids": []`, 1),
			"two members with slot",
		},
		"one key declared twice": {
			strings.Replace(template, `"key": "beta-one"`, `"key": "alpha-one"`, 1),
			"declared twice",
		},
		"one key colliding with the residual": {
			strings.Replace(template, `"key": "beta-one"`, `"key": "other"`, 1),
			"declared twice",
		},
		"one identifier folding to two members": {
			strings.Replace(template, `"ids": ["raw-beta-one"]`, `"ids": ["raw-alpha-one"]`, 1),
			"folds to two members",
		},
		"an identifier that is not lowercase": {
			strings.Replace(template, `"raw-alpha-one"`, `"Raw-Alpha-One"`, 1),
			"not lowercase",
		},
		"an empty identifier": {
			strings.Replace(template, `"raw-alpha-one"`, `""`, 1),
			"not lowercase",
		},
		"a group with no written label": {
			strings.Replace(template, `"label": "Alpha"`, `"label": ""`, 1),
			"written label",
		},
		"a group key that is not machine-shaped": {
			strings.Replace(template, `"key": "alpha",`, `"key": "Alpha",`, 1),
			"written label",
		},
		"one group declared twice": {
			strings.Replace(template, `"key": "beta", "label": "Beta"`, `"key": "alpha", "label": "Beta"`, 1),
			"declared twice",
		},
		"a group with no members": {
			strings.Replace(template, `{"key": "beta-one", "label": "Beta One", "slot": 1, "ids": ["raw-beta-one"], "prefixStrip": false}`, ``, 1),
			"no members",
		},
		"a file with no groups at all": {
			`{"schema": "usage-models/v1", "residual": {"key": "other", "label": "Other", "slot": 0}, "groups": []}`,
			"no groups",
		},
		"bytes that are not a document": {
			`not json`,
			"invalid character",
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			serveOrder, groups, err := loadModelVocabulary([]byte(testCase.document))
			if err == nil {
				t.Fatalf("the vocabulary was admitted, serving %v", serveOrder)
			}
			if !strings.Contains(err.Error(), testCase.wantErr) {
				t.Fatalf("refused with %q, want a refusal naming %q", err, testCase.wantErr)
			}
			if serveOrder != nil || groups != nil {
				t.Fatalf("a refused vocabulary still returned %v/%v; a partial vocabulary is the failure this refuses", serveOrder, groups)
			}
		})
	}
}

// TestTheKeyShapeAdmitsMachineKeysOnly pins the grammar every key crosses the
// wire in, in both directions. It is the same shape the producer's emission
// guard admits, which is what makes a display name unable to travel as a key.
func TestTheKeyShapeAdmitsMachineKeysOnly(t *testing.T) {
	t.Parallel()
	for key, want := range map[string]bool{
		"a":                                 true,
		"alpha":                             true,
		"alpha-2":                           true,
		"a2-3-b":                            true,
		"":                                  false,
		"-alpha":                            false,
		"2alpha":                            false,
		"Alpha":                             false,
		"alpha one":                         false,
		"alpha.one":                         false,
		"alpha_one":                         false,
		"alpha/one":                         false,
		"älpha":                             false,
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa":  true,
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": false,
	} {
		if got := isLabelShaped(key); got != want {
			t.Errorf("isLabelShaped(%q) is %v, want %v", key, got, want)
		}
	}
}

// TestTheShippedSourceVocabularyNamesEveryPushableSource is the fail-closed
// half of issue #267's second data file: a source label can reach this origin
// from exactly two places — the embedded snapshot the pushed document must
// name a label of, and the fetch config's own token-usage source list — and
// BOTH must be keys the source vocabulary declares a written name for.
//
// Without this a push could name a source the page can only render by its
// machine key, which is the silent-degradation half of the defect the
// vocabulary file exists to end: the name would then have to live in a
// component, and the one-file rule would be two files and a component.
func TestTheShippedSourceVocabularyNamesEveryPushableSource(t *testing.T) {
	t.Parallel()
	if len(sourceVocabulary) == 0 {
		t.Fatal("the source vocabulary loaded empty; every check below would pass vacuously")
	}
	loaded, err := SnapshotSource{Name: "snapshots/token-usage.json"}.load(snapshotFiles, KindTokenUsageV2)
	if err != nil {
		t.Fatalf("load token snapshot: %v", err)
	}
	var payload TokenUsageData
	if err := decodeStrict(loaded.data, &payload); err != nil {
		t.Fatalf("decode token snapshot: %v", err)
	}
	if len(payload.Sources) == 0 {
		t.Fatal("the shipped snapshot carries no source to check")
	}
	for _, source := range payload.Sources {
		if _, ok := sourceVocabulary[source.Label]; !ok {
			t.Errorf("snapshot source %q is not a key of %s; a pushed document could name a source the page has no written name for", source.Label, sourcesFilePath)
		}
	}
	document, _, err := loadFetchConfig(fetchConfigBytes)
	if err != nil {
		t.Fatalf("shipped fetch config refused: %v", err)
	}
	if document.TokenUsage == nil || len(document.TokenUsage.Sources) == 0 {
		t.Fatal("the shipped fetch config carries no token-usage source to check")
	}
	for _, source := range document.TokenUsage.Sources {
		if _, ok := sourceVocabulary[source.Label]; !ok {
			t.Errorf("fetch config source %q is not a key of %s", source.Label, sourcesFilePath)
		}
	}
	// Every vendor the file names is a group the MODEL vocabulary declares,
	// re-derived from the shipped file rather than transcribed, so the two
	// data files cannot come to disagree about who exists.
	raw, err := os.ReadFile(sourcesFilePath)
	if err != nil {
		t.Fatalf("read %s: %v", sourcesFilePath, err)
	}
	var shipped sourcesDocument
	if err := json.Unmarshal(raw, &shipped); err != nil {
		t.Fatalf("parse %s: %v", sourcesFilePath, err)
	}
	if len(shipped.Sources) != len(sourceVocabulary) {
		t.Fatalf("%s declares %d sources; the loaded vocabulary holds %d", sourcesFilePath, len(shipped.Sources), len(sourceVocabulary))
	}
	for _, source := range shipped.Sources {
		if !modelGroupOrder[source.Vendor] {
			t.Errorf("source %q names vendor %q, which %s does not group", source.Key, source.Vendor, modelsFilePath)
		}
		if source.Name == source.Key {
			t.Errorf("source %q carries its own key as its written name; a name is display copy, never the key", source.Key)
		}
	}
}

// TestTheSourceVocabularyRefusesEveryMalformedShape is the non-vacuity half:
// each rule the loader states is given an input that breaks it, and the load
// must refuse the WHOLE file rather than dropping the offending source.
func TestTheSourceVocabularyRefusesEveryMalformedShape(t *testing.T) {
	t.Parallel()
	// Deliberately vendor-free: this proves the RULES, and the shipped file
	// is proven separately above.
	const template = `{
		"schema": "usage-sources/v1",
		"sources": [
			{"key": "alpha-tool", "name": "Alpha Tool", "vendor": "alpha"},
			{"key": "beta-tool", "name": "Beta Tool", "vendor": "beta"}
		]
	}`
	groups := map[string]bool{"alpha": true, "beta": true}
	if _, err := loadSourceVocabulary([]byte(template), groups); err != nil {
		t.Fatalf("the template must load, or every case below refuses for the wrong reason: %v", err)
	}
	for name, testCase := range map[string]struct {
		document string
		wantErr  string
	}{
		"a schema marker this code does not understand": {
			strings.Replace(template, `"usage-sources/v1"`, `"usage-sources/v2"`, 1),
			"schema",
		},
		"a field outside the declared shape": {
			strings.Replace(template, `"schema":`, `"unexpected": 1, "schema":`, 1),
			"unknown field",
		},
		"a key that is not machine-shaped": {
			strings.Replace(template, `"key": "alpha-tool"`, `"key": "Alpha Tool"`, 1),
			"machine key",
		},
		"one key declared twice": {
			strings.Replace(template, `"key": "beta-tool"`, `"key": "alpha-tool"`, 1),
			"declared twice",
		},
		"a source with no written name": {
			strings.Replace(template, `"name": "Alpha Tool"`, `"name": ""`, 1),
			"written name",
		},
		"a written name past the rendering bound": {
			strings.Replace(template, `"name": "Alpha Tool"`, `"name": "`+strings.Repeat("A", maxSourceNameBytes+1)+`"`, 1),
			"written name",
		},
		"two sources that would render identically": {
			strings.Replace(template, `"name": "Beta Tool"`, `"name": "Alpha Tool"`, 1),
			"repeats a written name",
		},
		"a vendor the model vocabulary does not group": {
			strings.Replace(template, `"vendor": "beta"`, `"vendor": "gamma"`, 1),
			"does not group",
		},
		"a file with no sources at all": {
			`{"schema": "usage-sources/v1", "sources": []}`,
			"no sources",
		},
		"bytes that are not a document": {
			`not json`,
			"invalid character",
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			names, err := loadSourceVocabulary([]byte(testCase.document), groups)
			if err == nil {
				t.Fatalf("the vocabulary was admitted, naming %v", names)
			}
			if !strings.Contains(err.Error(), testCase.wantErr) {
				t.Fatalf("refused with %q, want a refusal naming %q", err, testCase.wantErr)
			}
			if names != nil {
				t.Fatalf("a refused vocabulary still returned %v; a partial vocabulary is the failure this refuses", names)
			}
		})
	}
}
