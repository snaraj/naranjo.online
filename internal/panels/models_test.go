// models_test drives the embedded model vocabulary (issue #302): the one
// file that spells every model key, written name, palette slot, vendor group
// and raw identifier the pipeline knows.
//
// Two jobs. First, the SHIPPED file is proven to load and to say what the
// origin then relies on — the residual leading the serve order, the order
// being the file's own, and the row bound being the vocabulary's own size.
// Second, every rule the loader enforces is shown to have an input that
// fails it: a validator no input can redden is decoration, and this one
// stands between a data edit and what a public page renders.

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
	if _, err := loadModelVocabulary([]byte(template)); err != nil {
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
			serveOrder, err := loadModelVocabulary([]byte(testCase.document))
			if err == nil {
				t.Fatalf("the vocabulary was admitted, serving %v", serveOrder)
			}
			if !strings.Contains(err.Error(), testCase.wantErr) {
				t.Fatalf("refused with %q, want a refusal naming %q", err, testCase.wantErr)
			}
			if serveOrder != nil {
				t.Fatalf("a refused vocabulary still returned %v; a partial vocabulary is the failure this refuses", serveOrder)
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
