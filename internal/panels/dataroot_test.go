// dataroot_test proves the data-root loop end to end against a hostile
// volume: a valid sealed series replaces the snapshot series with categories,
// windows, and derived tiles, and EVERY fault class — wrong key, tampered or
// truncated ciphertext, oversized file, malformed or unknown-field JSON,
// wrong schema, replayed or future capture instants, invented sources,
// broken category partitions, out-of-vocabulary windows and tiles — keeps
// the last good payload byte-identically and never crashes. The unsealer
// used here is the same internal/seal composition production wires in, so
// what these tests exercise is the real cryptographic boundary, not a fake.
package panels

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"math"
	"net/http"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"testing/synctest"
	"time"

	"github.com/snaraj/naranjo.online/internal/seal"
)

// dataRootTestKeyHex is a fixed, obviously non-secret test key: the byte
// ladder 00,01,02,… hex-encoded to the exact key length. Derived rather than
// spelled so no key-shaped literal exists for a secret scanner to misread.
var dataRootTestKeyHex = func() string {
	raw := make([]byte, seal.KeyBytes)
	for index := range raw {
		raw[index] = byte(index)
	}
	return hex.EncodeToString(raw)
}()

// dataRootSnapshot is the synthetic embedded snapshot the tests merge onto:
// two neutral sources (labels are data — no vendor is spelled anywhere in
// this package, tests included), one with the full tile set including the
// five series-derived tiles and one captured lifetime-class figure a series
// can never define (issue #276: refreshed from the document's stats section,
// never left at its release-time value).
const dataRootSnapshot = `{
  "generatedAt": "2026-08-20T00:00:00Z",
  "data": {"sources": [
    {"label": "alpha", "windows": [], "stats": [
      {"key": "lifetime", "label": "Lifetime", "value": 1000, "unit": "tokens", "recorded": true},
      {"key": "peak-day", "label": "Peak day", "value": 50, "unit": "tokens", "recorded": true},
      {"key": "current-streak", "label": "Current streak", "value": 1, "unit": "days", "recorded": true},
      {"key": "longest-streak", "label": "Longest streak", "value": 2, "unit": "days", "recorded": true},
      {"key": "active-days", "label": "Active days", "value": 1, "unit": "days", "recorded": true},
      {"key": "tracked-days", "label": "Days tracked", "value": 1, "unit": "days", "recorded": true}],
     "series": {"startDate": "2026-08-10", "totals": [10, 20], "recorded": true},
     "insights": [{"label": "Deep mode", "pct": 50, "recorded": true}]},
    {"label": "beta", "windows": []}
  ]}
}`

// usageDataRootRegistry builds a one-panel registry over a synthetic
// snapshot filesystem, so every test controls the merge base completely.
func usageDataRootRegistry(t *testing.T, snapshot string) (*Registry, *panelState) {
	t.Helper()
	fsys := fstest.MapFS{
		"snapshots/token-usage.json": &fstest.MapFile{Data: []byte(snapshot)},
	}
	reg := newRegistry(fsys, []panelDefinition{{
		id:     "token-usage",
		kind:   KindTokenUsageV2,
		title:  "Token usage",
		source: SnapshotSource{Name: "snapshots/token-usage.json"},
	}})
	state, ok := reg.byID["token-usage"]
	if !ok {
		t.Fatal("registry has no token-usage panel")
	}
	return reg, state
}

// productionUnsealer composes the exact seal usage internal/server wires:
// parse the hex key, authenticate, decrypt.
func productionUnsealer(hexKey string) Unsealer {
	return func(sealed []byte) ([]byte, error) {
		key, err := seal.ParseKey(hexKey)
		if err != nil {
			return nil, err
		}
		return seal.Open(key, sealed)
	}
}

// validDocument is the mutation base: one complete, correct series document
// covering EVERY source the synthetic snapshot ships. Tests mutate copies of
// it to build each hostile variant, so every refusal test starts from a
// document that provably passes.
//
// Both labels are present because a document must refresh the whole shipped
// set (2026-08-24 review finding 7): one envelope carries one status and one
// generatedAt for the whole payload, so a document that refreshed alpha and
// left beta at release-time data could not be described honestly by either.
// Every section carries its own capturedAt and the COMPLETE window and
// derived sets (2026-08-24 round-3 review, finding 5). Both used to be
// optional, which left release-age figures rendered beside a runtime series
// under one envelope instant; beta's section is now a whole section like
// alpha's, differing only in carrying no category partition — the one part
// that genuinely is optional, because a source may report totals it cannot
// break down. Alpha carries the captured stats its snapshot's lifetime tile
// demands (issue #276); beta ships no lifetime-class tile and owes no stats
// section — the two sources between them pin both halves of that rule.
func validDocument() map[string]any {
	return map[string]any{
		"schema":      "usage-series/v1",
		"generatedAt": "2026-08-24T12:00:00Z",
		"sources": map[string]any{
			"alpha": map[string]any{
				"capturedAt": "2026-08-24T12:00:00Z",
				"series":     map[string]any{"startDate": "2026-08-15", "totals": []int64{5, 0, 7}, "recorded": true},
				"categories": map[string]any{
					"output": []int64{4, 0, 4},
					"input":  []int64{1, 0, 3},
				},
				"windows": map[string]any{
					"today": map[string]any{"input": 3, "output": 4},
					"week":  map[string]any{"input": 4, "output": 8},
				},
				"derived": map[string]any{"peak-day": 7, "current-streak": 1, "longest-streak": 1, "active-days": 2, "tracked-days": 3},
				"stats":   map[string]any{"lifetime": 4321},
			},
			"beta": map[string]any{
				"capturedAt": "2026-08-24T12:00:00Z",
				"series":     map[string]any{"startDate": "2026-08-18", "totals": []int64{2, 3}, "recorded": true},
				"windows": map[string]any{
					"today": map[string]any{"input": 1, "output": 1},
					"week":  map[string]any{"input": 2, "output": 3},
				},
				"derived": map[string]any{"peak-day": 3, "current-streak": 2, "longest-streak": 2, "active-days": 2, "tracked-days": 2},
			},
		},
	}
}

// betaSection is alphaSection's twin for the second shipped source.
func betaSection(document map[string]any) map[string]any {
	return document["sources"].(map[string]any)["beta"].(map[string]any)
}

// sealDocument marshals and seals a document under the test key.
func sealDocument(t *testing.T, document any) []byte {
	t.Helper()
	plaintext, err := json.Marshal(document)
	if err != nil {
		t.Fatalf("marshal document: %v", err)
	}
	key, err := seal.ParseKey(dataRootTestKeyHex)
	if err != nil {
		t.Fatalf("parse test key: %v", err)
	}
	sealed, err := seal.Seal(key, plaintext)
	if err != nil {
		t.Fatalf("seal document: %v", err)
	}
	return sealed
}

// seriesFS stages the sealed file under the fixed data-root name.
func seriesFS(sealed []byte) fstest.MapFS {
	return fstest.MapFS{dataRootSeriesName: &fstest.MapFile{Data: sealed}}
}

// fixedNow pins the validation clock a few minutes past the valid document's
// capture instant.
func fixedNow() time.Time {
	return time.Date(2026, 8, 24, 12, 5, 0, 0, time.UTC)
}

// refreshDirect drives one refreshFromDataRoot attempt with the standard
// floor (the synthetic snapshot's own instant) in the documented
// process-memory mode, where there is no durable floor to commit.
func refreshDirect(t *testing.T, reg *Registry, state *panelState, fsys fs.FS, unseal Unsealer) (time.Time, error) {
	t.Helper()
	floor := FloorState{Instant: reg.embeddedUsageInstant(state)}
	accepted, err := reg.refreshFromDataRoot(state, fsys, unseal, fixedNow, floor, false, nil)
	return accepted.Instant, err
}

// decodeServedUsage decodes the panel's currently served envelope.
func decodeServedUsage(t *testing.T, state *panelState) (Envelope, TokenUsageData) {
	t.Helper()
	served := state.current.Load()
	var envelope Envelope
	if err := json.Unmarshal(served.response.body, &envelope); err != nil {
		t.Fatalf("decode served envelope: %v", err)
	}
	var data TokenUsageData
	if envelope.Data != nil {
		if err := json.Unmarshal(envelope.Data, &data); err != nil {
			t.Fatalf("decode served payload: %v", err)
		}
	}
	return envelope, data
}

func TestDataRootReplacesTheSeriesAndDerivedTiles(t *testing.T) {
	t.Parallel()
	reg, state := usageDataRootRegistry(t, dataRootSnapshot)
	accepted, err := refreshDirect(t, reg, state, seriesFS(sealDocument(t, validDocument())), productionUnsealer(dataRootTestKeyHex))
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	want := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)
	if !accepted.Equal(want) {
		t.Fatalf("accepted instant %v, want %v", accepted, want)
	}
	envelope, data := decodeServedUsage(t, state)
	if envelope.Status != StatusOK || envelope.GeneratedAt != "2026-08-24T12:00:00Z" {
		t.Fatalf("envelope status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
	}
	if len(data.Sources) != 2 {
		t.Fatalf("served %d sources, want 2", len(data.Sources))
	}
	alpha := data.Sources[0]
	if alpha.Series == nil || alpha.Series.StartDate != "2026-08-15" || len(alpha.Series.Totals) != 3 {
		t.Fatalf("alpha series not replaced: %+v", alpha.Series)
	}
	if !alpha.Series.Recorded {
		t.Fatal("the disk series must keep its recorded provenance")
	}
	// Categories serve in canonical order regardless of document map order.
	if len(alpha.Series.Categories) != 2 || alpha.Series.Categories[0].Key != "input" || alpha.Series.Categories[1].Key != "output" {
		t.Fatalf("categories not in canonical order: %+v", alpha.Series.Categories)
	}
	// Derived tiles refreshed — the issue-#276 pair included — and the
	// lifetime figure, which no series can measure, refreshed from the
	// document's captured stats section rather than left frozen at its
	// release-time value.
	tiles := map[string]int64{}
	for _, stat := range alpha.Stats {
		if stat.Value != nil {
			tiles[stat.Key] = *stat.Value
		}
		if !stat.Recorded {
			t.Fatalf("tile %q lost its recorded provenance", stat.Key)
		}
	}
	if tiles["peak-day"] != 7 || tiles["current-streak"] != 1 || tiles["longest-streak"] != 1 {
		t.Fatalf("tiles wrong after merge: %v", tiles)
	}
	if tiles["active-days"] != 2 || tiles["tracked-days"] != 3 {
		t.Fatalf("issue-#276 derived tiles not refreshed: %v", tiles)
	}
	if tiles["lifetime"] != 4321 {
		t.Fatalf("lifetime tile not refreshed from the captured stats: %v", tiles)
	}
	if len(alpha.Windows) != 2 || alpha.Windows[0].Period != "today" || alpha.Windows[0].InputTokens != 3 || alpha.Windows[1].Period != "week" {
		t.Fatalf("windows wrong after merge: %+v", alpha.Windows)
	}
	if len(alpha.Insights) != 1 {
		t.Fatal("insights must survive the merge untouched")
	}
	// EVERY shipped source is refreshed by the same push, which is what
	// makes one envelope status and one generatedAt honest for the whole
	// payload (2026-08-24 review finding 7), and every section carries its
	// own capture instant so a reader can see which half is older
	// (2026-08-24 round-3 review, finding 5).
	if alpha.CapturedAt != "2026-08-24T12:00:00Z" {
		t.Fatalf("alpha capturedAt %q", alpha.CapturedAt)
	}
	beta := data.Sources[1]
	if beta.CapturedAt != "2026-08-24T12:00:00Z" {
		t.Fatalf("beta capturedAt %q", beta.CapturedAt)
	}
	if beta.Label != "beta" || beta.Series == nil || beta.Series.StartDate != "2026-08-18" || len(beta.Series.Totals) != 2 {
		t.Fatalf("beta series not replaced: %+v", beta.Series)
	}
	if !beta.Series.Recorded || beta.Series.Categories != nil {
		t.Fatalf("beta series provenance or categories wrong: %+v", beta.Series)
	}
	if size := len(state.current.Load().response.body); size > MaxPanelResponseBytes {
		t.Fatalf("served envelope is %d bytes, over the %d budget", size, MaxPanelResponseBytes)
	}
}

// TestDataRootServesDeterministicBytes proves two documents with identical
// content but different map orderings serve byte-identical responses, so
// every replica presents one digest ETag.
func TestDataRootServesDeterministicBytes(t *testing.T) {
	t.Parallel()
	first, firstState := usageDataRootRegistry(t, dataRootSnapshot)
	if _, err := refreshDirect(t, first, firstState, seriesFS(sealDocument(t, validDocument())), productionUnsealer(dataRootTestKeyHex)); err != nil {
		t.Fatalf("first refresh: %v", err)
	}
	reordered := validDocument()
	alpha := reordered["sources"].(map[string]any)["alpha"].(map[string]any)
	alpha["categories"] = map[string]any{
		"input":  []int64{1, 0, 3},
		"output": []int64{4, 0, 4},
	}
	second, secondState := usageDataRootRegistry(t, dataRootSnapshot)
	if _, err := refreshDirect(t, second, secondState, seriesFS(sealDocument(t, reordered)), productionUnsealer(dataRootTestKeyHex)); err != nil {
		t.Fatalf("second refresh: %v", err)
	}
	if !bytes.Equal(firstState.current.Load().response.body, secondState.current.Load().response.body) {
		t.Fatal("identical content served different bytes")
	}
	if firstState.current.Load().response.etag != secondState.current.Load().response.etag {
		t.Fatal("identical content served different ETags")
	}
}

// refuseCase drives one hostile variant and requires the served response to
// stay untouched — pointer-identical, so not even a re-preparation happened.
func refuseCase(t *testing.T, mutate func(document map[string]any), wantErr string) {
	t.Helper()
	reg, state := usageDataRootRegistry(t, dataRootSnapshot)
	document := validDocument()
	mutate(document)
	before := state.current.Load()
	_, err := refreshDirect(t, reg, state, seriesFS(sealDocument(t, document)), productionUnsealer(dataRootTestKeyHex))
	if err == nil {
		t.Fatal("the hostile document was accepted")
	}
	if !strings.Contains(err.Error(), wantErr) {
		t.Fatalf("error %q does not mention %q", err, wantErr)
	}
	if state.current.Load() != before {
		t.Fatal("a refused document still changed the served response")
	}
}

func alphaSection(document map[string]any) map[string]any {
	return document["sources"].(map[string]any)["alpha"].(map[string]any)
}

func TestDataRootRefusesHostileDocuments(t *testing.T) {
	t.Parallel()
	for name, testCase := range map[string]struct {
		mutate  func(document map[string]any)
		wantErr string
	}{
		"wrong schema": {func(d map[string]any) { d["schema"] = "usage-series/v2" }, "schema"},
		"unknown top-level field": {func(d map[string]any) {
			d["comment"] = 1
		}, "unknown field"},
		"unknown source field": {func(d map[string]any) {
			alphaSection(d)["path"] = 1
		}, "unknown field"},
		"malformed generatedAt": {func(d map[string]any) { d["generatedAt"] = "yesterday" }, "generatedAt"},
		"replayed older than the snapshot": {func(d map[string]any) {
			d["generatedAt"] = "2026-08-19T00:00:00Z"
		}, "replay refused"},
		"future capture instant": {func(d map[string]any) {
			d["generatedAt"] = "2026-08-24T12:20:00Z"
		}, "future"},
		"invented source": {func(d map[string]any) {
			sources := d["sources"].(map[string]any)
			sources["gamma"] = sources["alpha"]
			delete(sources, "alpha")
		}, "source the snapshot does not ship"},
		"no sources": {func(d map[string]any) { d["sources"] = map[string]any{} }, "no sources"},
		// 2026-08-24 review finding 7: the checked-in happy path used to
		// PROVE this state — alpha refreshed, beta left at release-time
		// data, and the whole envelope stamped ok at the pushed instant. A
		// document that does not refresh the shipped set cannot be described
		// by one status and one generatedAt, so it is refused entirely.
		"partial document, one shipped source omitted": {func(d map[string]any) {
			delete(d["sources"].(map[string]any), "beta")
		}, "every shipped source"},
		"partial document, the other source omitted": {func(d map[string]any) {
			delete(d["sources"].(map[string]any), "alpha")
		}, "every shipped source"},
		"live-claiming series": {func(d map[string]any) {
			alphaSection(d)["series"].(map[string]any)["recorded"] = false
		}, "recorded provenance"},
		"malformed start date": {func(d map[string]any) {
			alphaSection(d)["series"].(map[string]any)["startDate"] = "August 15th"
		}, "startDate"},
		"empty series": {func(d map[string]any) {
			section := alphaSection(d)
			section["series"].(map[string]any)["totals"] = []int64{}
			delete(section, "categories")
		}, "days"},
		"negative total": {func(d map[string]any) {
			section := alphaSection(d)
			section["series"].(map[string]any)["totals"] = []int64{5, -1, 7}
			delete(section, "categories")
		}, "negative"},
		"category length mismatch": {func(d map[string]any) {
			alphaSection(d)["categories"].(map[string]any)["input"] = []int64{1, 0}
		}, "covers"},
		"category negative": {func(d map[string]any) {
			alphaSection(d)["categories"].(map[string]any)["input"] = []int64{-1, 0, 5}
		}, "negative"},
		"category partition broken": {func(d map[string]any) {
			alphaSection(d)["categories"].(map[string]any)["input"] = []int64{2, 0, 3}
		}, "sum"},
		// 2026-08-24 round-3 review, finding 9. Every value here is
		// non-negative and every value is authenticated; the DAY SUM was a
		// plain int64 addition, so MaxInt64 + MaxInt64 + 2 wrapped to exactly
		// zero and satisfied the partition against a zero total. A partition
		// check that arithmetic can wrap is not a partition check.
		"category values overflow the day partition": {func(d map[string]any) {
			section := alphaSection(d)
			section["series"].(map[string]any)["totals"] = []int64{0}
			section["categories"] = map[string]any{
				"input":      []int64{math.MaxInt64},
				"output":     []int64{math.MaxInt64},
				"cache-read": []int64{2},
			}
			section["windows"] = map[string]any{
				"today": map[string]any{"input": 0, "output": 0},
				"week":  map[string]any{"input": 0, "output": 0},
			}
			section["derived"] = map[string]any{"peak-day": 0, "current-streak": 0, "longest-streak": 0, "active-days": 0, "tracked-days": 1}
		}, "bound every stage of this pipeline shares"},
		"a count above the shared numeric bound": {func(d map[string]any) {
			alphaSection(d)["derived"].(map[string]any)["peak-day"] = int64(maxCountValue) + 1
		}, "bound every stage of this pipeline shares"},
		"a window above the shared numeric bound": {func(d map[string]any) {
			alphaSection(d)["windows"].(map[string]any)["week"] = map[string]any{
				"input": int64(maxCountValue) + 1, "output": 1,
			}
		}, "bound every stage of this pipeline shares"},
		"category key with markup": {func(d map[string]any) {
			categories := alphaSection(d)["categories"].(map[string]any)
			categories["<img src=x>"] = categories["input"]
			delete(categories, "input")
		}, "categories: key is outside the closed vocabulary"},
		// MEMBERSHIP, not shape (2026-08-24 review finding H1): these keys
		// are perfectly label-shaped — lowercase, hyphenated, bounded — and
		// the original shape-only guard ADMITTED them, which would have
		// rendered a private identifier publicly through the frontend's
		// category labels. The closed vocabulary must refuse them.
		"category key label-shaped but private": {func(d map[string]any) {
			categories := alphaSection(d)["categories"].(map[string]any)
			categories["private-feature"] = categories["input"]
			delete(categories, "input")
		}, "categories: key is outside the closed vocabulary"},
		"category key label-shaped project name": {func(d map[string]any) {
			categories := alphaSection(d)["categories"].(map[string]any)
			categories["internal-project-name"] = categories["input"]
			delete(categories, "input")
		}, "categories: key is outside the closed vocabulary"},
		"category key with a path": {func(d map[string]any) {
			categories := alphaSection(d)["categories"].(map[string]any)
			categories["a/b"] = categories["input"]
			delete(categories, "input")
		}, "categories: key is outside the closed vocabulary"},
		"category key uppercase": {func(d map[string]any) {
			categories := alphaSection(d)["categories"].(map[string]any)
			categories["Input"] = categories["input"]
			delete(categories, "input")
		}, "categories: key is outside the closed vocabulary"},
		"too many categories": {func(d map[string]any) {
			section := alphaSection(d)
			series := section["series"].(map[string]any)
			series["totals"] = []int64{9, 0, 9}
			categories := map[string]any{}
			for _, key := range []string{"a", "b", "c", "d", "e", "f", "g", "h", "i"} {
				categories[key] = []int64{1, 0, 1}
			}
			section["categories"] = categories
		}, "categories"},
		"window outside the vocabulary": {func(d map[string]any) {
			// REPLACED, not added: the set must stay complete, so this
			// isolates the vocabulary refusal from the completeness one.
			windows := alphaSection(d)["windows"].(map[string]any)
			windows["month"] = windows["today"]
			delete(windows, "today")
		}, "window key"},
		"a window omitted": {func(d map[string]any) {
			delete(alphaSection(d)["windows"].(map[string]any), "week")
		}, "release-time value beside a runtime series"},
		"windows omitted entirely": {func(d map[string]any) {
			delete(alphaSection(d), "windows")
		}, "release-time value beside a runtime series"},
		"negative window": {func(d map[string]any) {
			alphaSection(d)["windows"].(map[string]any)["today"] = map[string]any{"input": -1, "output": 1}
		}, "negative"},
		"derived outside the vocabulary": {func(d map[string]any) {
			derived := alphaSection(d)["derived"].(map[string]any)
			derived["lifetime"] = derived["peak-day"]
			delete(derived, "peak-day")
		}, "closed vocabulary"},
		"a derived figure omitted": {func(d map[string]any) {
			delete(alphaSection(d)["derived"].(map[string]any), "longest-streak")
		}, "release-time value beside a runtime series"},
		"derived omitted entirely": {func(d map[string]any) {
			delete(alphaSection(d), "derived")
		}, "release-time value beside a runtime series"},
		"capturedAt omitted": {func(d map[string]any) {
			delete(betaSection(d), "capturedAt")
		}, "capturedAt"},
		"capturedAt malformed": {func(d map[string]any) {
			betaSection(d)["capturedAt"] = "yesterday"
		}, "capturedAt"},
		"capturedAt later than the document carrying it": {func(d map[string]any) {
			betaSection(d)["capturedAt"] = "2026-08-24T12:00:01Z"
		}, "later than the document"},
		"negative derived": {func(d map[string]any) {
			alphaSection(d)["derived"].(map[string]any)["peak-day"] = -7
		}, "negative"},
		// The captured-stats rules (issue #276) mirror the derived ones with
		// the inverted completeness: what a source owes is the lifetime-class
		// tiles its snapshot ships, so alpha — whose snapshot shows a
		// lifetime tile — may neither drop the key nor the whole section.
		"a captured stat omitted while its tile ships": {func(d map[string]any) {
			delete(alphaSection(d)["stats"].(map[string]any), "lifetime")
		}, "does not refresh"},
		"captured stats omitted entirely": {func(d map[string]any) {
			delete(alphaSection(d), "stats")
		}, "does not refresh"},
		"captured stat outside the vocabulary": {func(d map[string]any) {
			alphaSection(d)["stats"].(map[string]any)["window-total"] = 1
		}, "captured stat key"},
		"captured stat carrying null": {func(d map[string]any) {
			alphaSection(d)["stats"].(map[string]any)["lifetime"] = nil
		}, "carries no figure"},
		"negative captured stat": {func(d map[string]any) {
			alphaSection(d)["stats"].(map[string]any)["lifetime"] = -7
		}, "negative"},
		"a captured stat above the shared numeric bound": {func(d map[string]any) {
			alphaSection(d)["stats"].(map[string]any)["lifetime"] = int64(maxCountValue) + 1
		}, "bound every stage of this pipeline shares"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			refuseCase(t, testCase.mutate, testCase.wantErr)
		})
	}
}

// TestDataRootAdmitsTheWholeClosedCategoryVocabulary proves the membership
// check is a vocabulary, not a hardcoded pair: every canonical category —
// including the fifth, reasoning, which only the merged second tool reports —
// is admitted and served in canonical order when the partition holds.
func TestDataRootAdmitsTheWholeClosedCategoryVocabulary(t *testing.T) {
	t.Parallel()
	reg, state := usageDataRootRegistry(t, dataRootSnapshot)
	document := validDocument()
	section := alphaSection(document)
	section["series"].(map[string]any)["totals"] = []int64{5, 0, 7}
	section["categories"] = map[string]any{
		"reasoning":   []int64{1, 0, 1},
		"cache-write": []int64{1, 0, 1},
		"cache-read":  []int64{1, 0, 1},
		"output":      []int64{1, 0, 2},
		"input":       []int64{1, 0, 2},
	}
	if _, err := refreshDirect(t, reg, state, seriesFS(sealDocument(t, document)), productionUnsealer(dataRootTestKeyHex)); err != nil {
		t.Fatalf("the complete canonical vocabulary was refused: %v", err)
	}
	_, data := decodeServedUsage(t, state)
	categories := data.Sources[0].Series.Categories
	want := []string{"input", "output", "cache-read", "cache-write", "reasoning"}
	if len(categories) != len(want) {
		t.Fatalf("served %d categories, want %d", len(categories), len(want))
	}
	for index, key := range want {
		if categories[index].Key != key {
			t.Fatalf("category %d is %q, want %q (canonical order)", index, categories[index].Key, key)
		}
	}
}

// TestDataRootAdmitsAWindowedModelBreakdown is the positive half of issue
// #170's admission: a per-model partition covering a declared TRAILING window
// of the series is admitted, served in canonical vocabulary order, and every
// row carries the window it covers so a reader is told the range rather than
// shown an invisible truncation. The categories in the same document stay
// aligned, proving the two breakdowns are windowed independently.
func TestDataRootAdmitsAWindowedModelBreakdown(t *testing.T) {
	t.Parallel()
	reg, state := usageDataRootRegistry(t, dataRootSnapshot)
	document := validDocument()
	section := alphaSection(document)
	section["modelsStartDate"] = "2026-08-16"
	section["models"] = map[string]any{
		"opus-4-8": []int64{0, 1},
		"sonnet-5": []int64{0, 2},
		"opus-5":   []int64{0, 2},
		"fable-5":  []int64{0, 1},
		"other":    []int64{0, 1},
	}
	if _, err := refreshDirect(t, reg, state, seriesFS(sealDocument(t, document)), productionUnsealer(dataRootTestKeyHex)); err != nil {
		t.Fatalf("the windowed model breakdown was refused: %v", err)
	}
	_, data := decodeServedUsage(t, state)
	models := data.Sources[0].Series.Models
	if len(models) != len(modelServeOrder) {
		t.Fatalf("served %d models, want %d", len(models), len(modelServeOrder))
	}
	for index, key := range modelServeOrder {
		if models[index].Key != key {
			t.Fatalf("model %d is %q, want %q (canonical order)", index, models[index].Key, key)
		}
		if models[index].StartDate != "2026-08-16" {
			t.Fatalf("model %q carries window %q, want the declared 2026-08-16", key, models[index].StartDate)
		}
		if len(models[index].Totals) != 2 {
			t.Fatalf("model %q covers %d days, want the 2 the window spans", key, len(models[index].Totals))
		}
	}
	for _, category := range data.Sources[0].Series.Categories {
		if category.StartDate != "" {
			t.Fatalf("category %q claims window %q; it is aligned with the series", category.Key, category.StartDate)
		}
	}
}

// TestDataRootRefusesHostileBreakdownWindows drives the window and vocabulary
// rules the models section brought with it. Each case is a document that is
// otherwise perfectly well formed and authenticated — the only thing wrong is
// the claim the breakdown makes about the days it covers or the keys it uses.
func TestDataRootRefusesHostileBreakdownWindows(t *testing.T) {
	t.Parallel()
	for name, testCase := range map[string]struct {
		mutate  func(document map[string]any)
		wantErr string
	}{
		"a model key outside the closed vocabulary": {func(d map[string]any) {
			alphaSection(d)["models"] = map[string]any{"private-model": []int64{5, 0, 7}}
		}, "models: key is outside the closed vocabulary"},
		// The two vocabularies are closed against EACH OTHER, not merely
		// against arbitrary text: a category name is not a model name, and
		// admitting one in the other's section would let a document claim a
		// partition of a thing it never measured.
		"a category key smuggled into the models section": {func(d map[string]any) {
			alphaSection(d)["models"] = map[string]any{"input": []int64{5, 0, 7}}
		}, "models: key is outside the closed vocabulary"},
		"a model key smuggled into the categories section": {func(d map[string]any) {
			alphaSection(d)["categories"] = map[string]any{"opus-5": []int64{5, 0, 7}}
		}, "categories: key is outside the closed vocabulary"},
		"models sum over the series totals": {func(d map[string]any) {
			alphaSection(d)["models"] = map[string]any{"opus-5": []int64{5, 0, 8}}
		}, "models: rows sum to 8 on day 2; the series total is 7"},
		"models sum under the series totals": {func(d map[string]any) {
			alphaSection(d)["models"] = map[string]any{"opus-5": []int64{5, 0, 6}}
		}, "models: rows sum to 6 on day 2; the series total is 7"},
		"a model window starting before the series": {func(d map[string]any) {
			section := alphaSection(d)
			section["modelsStartDate"] = "2026-08-14"
			section["models"] = map[string]any{"opus-5": []int64{0, 5, 0, 7}}
		}, "window starts -1 days into a 3 day series"},
		// "Aligned" has exactly ONE spelling — omission. A window redundantly
		// restating the series start is refused rather than accepted as a
		// synonym, so two documents covering identical days cannot differ in
		// their served bytes.
		"a model window restating the series start": {func(d map[string]any) {
			section := alphaSection(d)
			section["modelsStartDate"] = "2026-08-15"
			section["models"] = map[string]any{"opus-5": []int64{5, 0, 7}}
		}, "window starts 0 days into a 3 day series"},
		"a model window past the last series day": {func(d map[string]any) {
			section := alphaSection(d)
			section["modelsStartDate"] = "2026-08-18"
			section["models"] = map[string]any{"opus-5": []int64{}}
		}, "window starts 3 days into a 3 day series"},
		"a model window declared with no rows to cover it": {func(d map[string]any) {
			alphaSection(d)["modelsStartDate"] = "2026-08-16"
		}, "models: a window is declared with no rows to cover it"},
		"model rows that do not cover the declared window": {func(d map[string]any) {
			section := alphaSection(d)
			section["modelsStartDate"] = "2026-08-16"
			section["models"] = map[string]any{"opus-5": []int64{5, 0, 7}}
		}, `row "opus-5" covers 3 days; the window covers 2`},
		"a category window declared with no rows to cover it": {func(d map[string]any) {
			section := alphaSection(d)
			delete(section, "categories")
			section["categoriesStartDate"] = "2026-08-16"
		}, "categories: a window is declared with no rows to cover it"},
		"a category window that does not partition the days it claims": {func(d map[string]any) {
			section := alphaSection(d)
			section["categoriesStartDate"] = "2026-08-16"
			section["categories"] = map[string]any{"input": []int64{0, 6}}
		}, "categories: rows sum to 6 on day 2; the series total is 7"},
		"more model rows than the bound allows": {func(d map[string]any) {
			rows := map[string]any{}
			for index := range maxSeriesModels + 1 {
				rows[fmt.Sprintf("model-%d", index)] = []int64{0, 0, 0}
			}
			alphaSection(d)["models"] = rows
		}, fmt.Sprintf("models: %d rows, over the %d bound", maxSeriesModels+1, maxSeriesModels)},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			refuseCase(t, testCase.mutate, testCase.wantErr)
		})
	}
}

// TestDataRootRefusesAModelWindowOverTheDayBound pins the bound that keeps the
// models section affordable. The series may run to maxSeriesDays; the model
// partition costs one integer per day per member, so a window claiming more
// than maxModelDays is refused at admission rather than measured at the
// serve budget, where it would already have been decoded.
//
// The negative control is the same document one day shorter: it must be
// ADMITTED, or the bound would be indistinguishable from a refusal of the
// whole shape.
func TestDataRootRefusesAModelWindowOverTheDayBound(t *testing.T) {
	t.Parallel()
	// The window starts one day into the series, so the span is days-1: at
	// days = maxModelDays+2 the window is one day over the bound, and at
	// days = maxModelDays+1 it is exactly at it.
	build := func(days int) map[string]any {
		document := validDocument()
		section := alphaSection(document)
		totals := make([]int64, days)
		values := make([]int64, days-1)
		for index := range totals {
			totals[index] = 5
		}
		for index := range values {
			values[index] = 5
		}
		section["series"] = map[string]any{"startDate": "2026-01-01", "totals": totals, "recorded": true}
		delete(section, "categories")
		section["modelsStartDate"] = "2026-01-02"
		section["models"] = map[string]any{"opus-5": values}
		return document
	}
	refuseCase(t, func(d map[string]any) {
		over := build(maxModelDays + 2)
		d["sources"].(map[string]any)["alpha"] = alphaSection(over)
	}, fmt.Sprintf("models: the window spans %d days, over the %d day bound", maxModelDays+1, maxModelDays))

	reg, state := usageDataRootRegistry(t, dataRootSnapshot)
	if _, err := refreshDirect(t, reg, state, seriesFS(sealDocument(t, build(maxModelDays+1))), productionUnsealer(dataRootTestKeyHex)); err != nil {
		t.Fatalf("a window exactly at the %d day bound was refused: %v", maxModelDays, err)
	}
	_, data := decodeServedUsage(t, state)
	if got := len(data.Sources[0].Series.Models[0].Totals); got != maxModelDays {
		t.Fatalf("served %d model days, want the %d the bound allows", got, maxModelDays)
	}
}

// TestTokenUsageV1AdmissionDidNotWiden is the proof behind the claim that
// minting token-usage/v2 left v1 exactly as strict as it was. The decode-only
// mirror in types.go is only worth its duplication if something fails when it
// stops mirroring, so this drives both directions on the identical bytes: the
// new sections are UNKNOWN fields under the old kind and known ones under the
// new. Deleting the mirror and pointing both kinds at the served types turns
// every refusal here green.
func TestTokenUsageV1AdmissionDidNotWiden(t *testing.T) {
	t.Parallel()
	for name, testCase := range map[string]struct {
		payload string
		refused string
	}{
		"a models section": {
			`{"sources":[{"label":"alpha","windows":[],"series":{"startDate":"2026-08-15","totals":[5],` +
				`"models":[{"key":"opus-5","totals":[5]}]}}]}`,
			"models",
		},
		"a windowed category": {
			`{"sources":[{"label":"alpha","windows":[],"series":{"startDate":"2026-08-15","totals":[5],` +
				`"categories":[{"key":"input","startDate":"2026-08-15","totals":[5]}]}}]}`,
			"startDate",
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := decodeKindPayload(KindTokenUsage, json.RawMessage(testCase.payload))
			if err == nil {
				t.Fatalf("token-usage/v1 admitted %s", name)
			}
			if !strings.Contains(err.Error(), "unknown field") || !strings.Contains(err.Error(), testCase.refused) {
				t.Fatalf("error %q does not refuse %q as an unknown field", err, testCase.refused)
			}
			if _, err := decodeKindPayload(KindTokenUsageV2, json.RawMessage(testCase.payload)); err != nil {
				t.Fatalf("token-usage/v2 refused its own %s: %v", name, err)
			}
		})
	}
}

// TestDataRootRefusesAUnitMismatchedTile pins the tile-unit cross-check: a
// snapshot whose peak-day tile claims days cannot be refreshed by a series
// document, because the number would silently change meaning.
func TestDataRootRefusesAUnitMismatchedTile(t *testing.T) {
	t.Parallel()
	snapshot := strings.Replace(dataRootSnapshot,
		`{"key": "peak-day", "label": "Peak day", "value": 50, "unit": "tokens", "recorded": true}`,
		`{"key": "peak-day", "label": "Peak day", "value": 50, "unit": "days", "recorded": true}`, 1)
	reg, state := usageDataRootRegistry(t, snapshot)
	before := state.current.Load()
	_, err := refreshDirect(t, reg, state, seriesFS(sealDocument(t, validDocument())), productionUnsealer(dataRootTestKeyHex))
	if err == nil || !strings.Contains(err.Error(), "unit") {
		t.Fatalf("unit mismatch not refused: %v", err)
	}
	if state.current.Load() != before {
		t.Fatal("a refused document still changed the served response")
	}
}

// TestDataRootRefusesAUnitMismatchedCapturedTile is the same cross-check for
// the captured lifetime-class vocabulary (issue #276): a snapshot whose
// lifetime tile claims days cannot be refreshed by the document's stats
// section, because the number would silently change meaning.
func TestDataRootRefusesAUnitMismatchedCapturedTile(t *testing.T) {
	t.Parallel()
	snapshot := strings.Replace(dataRootSnapshot,
		`{"key": "lifetime", "label": "Lifetime", "value": 1000, "unit": "tokens", "recorded": true}`,
		`{"key": "lifetime", "label": "Lifetime", "value": 1000, "unit": "days", "recorded": true}`, 1)
	reg, state := usageDataRootRegistry(t, snapshot)
	before := state.current.Load()
	_, err := refreshDirect(t, reg, state, seriesFS(sealDocument(t, validDocument())), productionUnsealer(dataRootTestKeyHex))
	if err == nil || !strings.Contains(err.Error(), "unit") {
		t.Fatalf("captured unit mismatch not refused: %v", err)
	}
	if state.current.Load() != before {
		t.Fatal("a refused document still changed the served response")
	}
}

// TestDataRootValidatesCapturedStatsWithoutAddingTiles pins both halves of
// the captured-stats overlay's reach (issue #276): a source shipping no
// lifetime-class tile may still push vocabulary figures — they are validated
// and unrendered, exactly as a derived key without a tile is — and the
// overlay can never ADD a tile the owner did not ship.
func TestDataRootValidatesCapturedStatsWithoutAddingTiles(t *testing.T) {
	t.Parallel()
	reg, state := usageDataRootRegistry(t, dataRootSnapshot)
	document := validDocument()
	betaSection(document)["stats"] = map[string]any{"sessions": 9}
	if _, err := refreshDirect(t, reg, state, seriesFS(sealDocument(t, document)), productionUnsealer(dataRootTestKeyHex)); err != nil {
		t.Fatalf("a tile-less captured stat must be admitted: %v", err)
	}
	_, data := decodeServedUsage(t, state)
	if len(data.Sources[1].Stats) != 0 {
		t.Fatalf("beta grew tiles the snapshot never shipped: %+v", data.Sources[1].Stats)
	}
	// The same key malformed still refuses the document whole: validated,
	// not ignored.
	malformed := validDocument()
	betaSection(malformed)["stats"] = map[string]any{"sessions": -1}
	before := state.current.Load()
	if _, err := refreshDirect(t, reg, state, seriesFS(sealDocument(t, malformed)), productionUnsealer(dataRootTestKeyHex)); err == nil {
		t.Fatal("a malformed tile-less captured stat was admitted")
	}
	if state.current.Load() != before {
		t.Fatal("a refused document still changed the served response")
	}
}

func TestDataRootRefusesCryptographicFaults(t *testing.T) {
	t.Parallel()
	valid := sealDocument(t, validDocument())
	for name, testCase := range map[string]struct {
		fsys    fs.FS
		unseal  Unsealer
		wantErr string
	}{
		"wrong key": {
			fsys:    seriesFS(valid),
			unseal:  productionUnsealer(strings.Repeat("ff", 32)),
			wantErr: "authentication failed",
		},
		"tampered ciphertext": {
			fsys: seriesFS(func() []byte {
				mutated := bytes.Clone(valid)
				mutated[len(mutated)/2] ^= 0x01
				return mutated
			}()),
			unseal:  productionUnsealer(dataRootTestKeyHex),
			wantErr: "authentication failed",
		},
		"truncated file": {
			fsys:    seriesFS(valid[:len(valid)-7]),
			unseal:  productionUnsealer(dataRootTestKeyHex),
			wantErr: "authentication failed",
		},
		"unsealed plaintext on disk": {
			fsys:    seriesFS([]byte(`{"schema":"usage-series/v1"}`)),
			unseal:  productionUnsealer(dataRootTestKeyHex),
			wantErr: "sealed format",
		},
		"missing key": {
			fsys:    seriesFS(valid),
			unseal:  productionUnsealer(""),
			wantErr: "64 hex characters",
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			reg, state := usageDataRootRegistry(t, dataRootSnapshot)
			before := state.current.Load()
			if _, err := refreshDirect(t, reg, state, testCase.fsys, testCase.unseal); err == nil || !strings.Contains(err.Error(), testCase.wantErr) {
				t.Fatalf("got %v, want mention of %q", err, testCase.wantErr)
			}
			if state.current.Load() != before {
				t.Fatal("a refused file still changed the served response")
			}
		})
	}
}

// TestDataRootPanelIDNamesAShippedPanel keeps the data-root path from
// failing SILENTLY. Both the loop and the live-refresh ownership rule
// (2026-08-24 review finding 8) resolve one panel by id, and every guard on
// that path treats an unknown id as "this registry serves no such panel and
// there is nothing to do" — correct for a synthetic registry, and invisible
// for the shipped one. Renaming the builtin panel without renaming the
// constant would therefore disable the sealed feed and its ownership rule at
// once, with no error anywhere.
func TestDataRootPanelIDNamesAShippedPanel(t *testing.T) {
	t.Parallel()
	for _, definition := range builtinPanels {
		if definition.id == dataRootPanelID {
			return
		}
	}
	t.Fatalf("no shipped panel carries the id %q, so the sealed data root and its ownership rule would silently do nothing", dataRootPanelID)
}

// TestSealedSeriesCapParity pins this package's copy of the pipeline's
// single payload ceiling against the shared constant the producer half
// enforces. internal/panels cannot import internal/seal — the zero-egress
// doctrine pin holds every production file here to a stdlib-only import
// surface — so the number is hand-duplicated, and this is the repository's
// standard parity pin for exactly that situation: a failure names both
// files, because a producer and a consumer with different ceilings is the
// disagreement the 2026-08-24 review's finding 4 was about.
func TestSealedSeriesCapParity(t *testing.T) {
	t.Parallel()
	if maxSealedSeriesBytes != seal.MaxSealedBytes {
		t.Fatalf("maxSealedSeriesBytes in internal/panels/types.go is %d but MaxSealedBytes in internal/seal/types.go is %d; the pipeline's payload ceiling is ONE number and both files must state it",
			maxSealedSeriesBytes, seal.MaxSealedBytes)
	}
	// Non-vacuity: the constant is a real bound, not a zero that would make
	// every comparison against it pass.
	if maxSealedSeriesBytes <= 0 {
		t.Fatalf("the sealed-series cap is %d", maxSealedSeriesBytes)
	}
}

// TestWindowServeOrderCoversTheClosedVocabulary pins the two window lists
// against each other, because admitSeriesWindows reads one and serves from
// the other and NOTHING previously held them equal.
//
// admitSeriesWindows admits a section only when it carries exactly
// len(usageSeriesWindowKeys) windows, every key inside that closed
// vocabulary. It then serves by ranging over windowServeOrder and skipping
// any key the map lacks. Today those two describe the same set, so the skip
// is unreachable — which is exactly what makes the coupling dangerous: add a
// window to usageSeriesWindowKeys and forget windowServeOrder, and admission
// still REQUIRES the new window while the serve loop silently DROPS it. The
// payload would then be short a window it had just insisted on, with no
// error anywhere and no test going red.
//
// The skip itself stays (requirement 4: it is a fail-closed guard, and this
// package never trusts a map it did not build in the same function). What
// changes is that drift is now caught here, at test time, instead of in a
// served payload.
func TestWindowServeOrderCoversTheClosedVocabulary(t *testing.T) {
	t.Parallel()
	if len(windowServeOrder) != len(usageSeriesWindowKeys) {
		t.Fatalf("windowServeOrder has %d entries and usageSeriesWindowKeys has %d; admitSeriesWindows requires every vocabulary key and serves only the ordered ones, so a key in one and not the other is a window admitted and then dropped",
			len(windowServeOrder), len(usageSeriesWindowKeys))
	}
	seen := make(map[string]bool, len(windowServeOrder))
	for _, key := range windowServeOrder {
		if _, ok := usageSeriesWindowKeys[key]; !ok {
			t.Fatalf("windowServeOrder carries %q, which usageSeriesWindowKeys does not define; the serve order may only name keys admission can admit", key)
		}
		if seen[key] {
			t.Fatalf("windowServeOrder names %q twice; a duplicate would serve one window as two rows", key)
		}
		seen[key] = true
	}
	for key := range usageSeriesWindowKeys {
		if !seen[key] {
			t.Fatalf("usageSeriesWindowKeys defines %q but windowServeOrder never serves it; admission would REQUIRE this window and the serve loop would silently drop it", key)
		}
	}
	// Non-vacuity: an empty pair of lists would satisfy every check above.
	if len(windowServeOrder) == 0 {
		t.Fatal("the window vocabulary is empty, so this pin proves nothing")
	}
}

// TestDataRootRefusesOversizeBeforeDecryption pins the byte cap AND its
// position: an oversized file is refused before a single cryptographic or
// parsing operation touches it.
func TestDataRootRefusesOversizeBeforeDecryption(t *testing.T) {
	t.Parallel()
	reg, state := usageDataRootRegistry(t, dataRootSnapshot)
	unsealerCalls := 0
	counting := func(sealed []byte) ([]byte, error) {
		unsealerCalls++
		return nil, errors.New("must not be reached")
	}
	oversized := seriesFS(bytes.Repeat([]byte{0xAA}, maxSealedSeriesBytes+1))
	before := state.current.Load()
	_, err := refreshDirect(t, reg, state, oversized, counting)
	if err == nil || !strings.Contains(err.Error(), "byte bound") {
		t.Fatalf("oversize not refused: %v", err)
	}
	if unsealerCalls != 0 {
		t.Fatal("an oversized file reached the unsealer")
	}
	if state.current.Load() != before {
		t.Fatal("a refused file still changed the served response")
	}
}

// TestDataRootRefusesAnOverBudgetEnvelope proves a well-formed document
// whose merged envelope would bust the owner's response budget keeps the
// last good payload: the budget is structural on this path exactly as it is
// on construction and refresh.
// maximalDocument is the largest document the ORIGIN'S OWN BOUNDS admit: the
// full 732-day series on both shipped sources, the complete category
// partition on the one that reports one, the complete per-model partition at
// its own day bound on BOTH, and every value at the shared numeric ceiling.
// Nothing structurally valid can be bigger, which is what makes the
// measurements below meaningful rather than arbitrary.
//
// It is BUILT from the shipped vocabularies and bounds rather than
// transcribed, so a vocabulary edit or a bound change moves the measurement
// instead of leaving it stale — the same construction CapParityTest uses on
// the producer side. Adding the models section (issue #170) grew it, which is
// exactly the growth the budget has to be measured against.
func maximalDocument() map[string]any {
	const days = 732
	categories := len(categoryServeOrder)
	totals := make([]int64, days)
	category := make([]int64, days)
	betaTotals := make([]int64, days)
	for index := range totals {
		category[index] = maxCountValue / int64(categories)
		totals[index] = int64(categories) * (maxCountValue / int64(categories))
		betaTotals[index] = maxCountValue
	}
	document := validDocument()
	section := alphaSection(document)
	section["series"] = map[string]any{"startDate": "2024-01-01", "totals": totals, "recorded": true}
	section["categories"] = fullBreakdown(categoryServeOrder, category, nil, days)
	// The models window is the trailing maxModelDays of the same series, on
	// both sources, every row at the numeric ceiling its own total allows.
	section["models"] = fullBreakdown(modelServeOrder, nil, totals[days-maxModelDays:], maxModelDays)
	section["modelsStartDate"] = maximalModelsStart(days)
	beta := betaSection(document)
	beta["series"] = map[string]any{"startDate": "2024-01-01", "totals": betaTotals, "recorded": true}
	beta["models"] = fullBreakdown(modelServeOrder, nil, betaTotals[days-maxModelDays:], maxModelDays)
	beta["modelsStartDate"] = maximalModelsStart(days)
	return document
}

// maximalModelsStart is the calendar date maxModelDays before the end of the
// maximal document's series, derived from the same start date the series
// declares so the two cannot drift.
func maximalModelsStart(days int) string {
	start, err := time.Parse(dayLayout, "2024-01-01")
	if err != nil {
		panic(err)
	}
	return start.AddDate(0, 0, days-maxModelDays).Format(dayLayout)
}

// fullBreakdown builds one complete breakdown over a vocabulary. Given a
// uniform per-row value it repeats it; given the day TOTALS instead it
// divides each day across the vocabulary and gives the remainder to the last
// row, so the partition is exact for any total rather than only for ones that
// happen to divide.
func fullBreakdown(vocabulary []string, uniform, totals []int64, days int) map[string]any {
	rows := make(map[string]any, len(vocabulary))
	for position, key := range vocabulary {
		values := make([]int64, days)
		for day := range values {
			if uniform != nil {
				values[day] = uniform[day]
				continue
			}
			share := totals[day] / int64(len(vocabulary))
			values[day] = share
			if position == len(vocabulary)-1 {
				values[day] = totals[day] - share*int64(len(vocabulary)-1)
			}
		}
		rows[key] = values
	}
	return rows
}

// paddedSnapshot builds a snapshot whose SERVED bytes are large while the
// pushed document's bytes are untouched, by giving the embedded source many
// insight rows. That separation is the point: the transport ceiling bounds
// the sealed FILE, and the serve budget bounds the finished ENVELOPE —
// payload plus everything the snapshot contributes — so a perfectly
// admissible file can still produce an envelope that must be refused.
func paddedSnapshot(t *testing.T, target int) string {
	t.Helper()
	const row = `{"label": "%s%04d", "pct": 50, "recorded": true}`
	insights := make([]string, 0, target/64+1)
	for len(insights)*64 < target {
		insights = append(insights, fmt.Sprintf(row, strings.Repeat("p", 56), len(insights)))
	}
	return `{
  "generatedAt": "2026-08-20T00:00:00Z",
  "data": {"sources": [
    {"label": "alpha", "windows": [], "stats": [
      {"key": "lifetime", "label": "Lifetime", "value": 1000, "unit": "tokens", "recorded": true}],
     "series": {"startDate": "2026-08-10", "totals": [10, 20], "recorded": true},
     "insights": [` + strings.Join(insights, ",") + `]},
    {"label": "beta", "windows": []}
  ]}
}`
}

// TestDataRootRefusesAnOverBudgetEnvelope proves the serve budget is still a
// live gate after the owner raised it from 32 KiB to 128 KiB on 2026-08-24,
// and proves it at the only place it can now bite.
//
// The raise made the naive version of this test VACUOUS, and that is worth
// stating rather than quietly rewriting: with the serve budget at 128 KiB,
// no structurally valid pushed document can exceed it on its own, because
// the 732-day series bound and the shared numeric ceiling cap the maximal
// document at 87,791 sealed bytes (measured below). A guard no input can
// trip is not a guard.
//
// It can still be tripped, because the two ceilings measure DIFFERENT bytes.
// The transport ceiling bounds the sealed file; the serve budget bounds the
// finished envelope, which also carries everything the embedded snapshot
// contributes. So a file comfortably under the transport ceiling, merged
// onto a large snapshot, produces an envelope that must be refused — and it
// is refused, not truncated, with the previous response left serving.
func TestDataRootRefusesAnOverBudgetEnvelope(t *testing.T) {
	t.Parallel()
	reg, state := usageDataRootRegistry(t, paddedSnapshot(t, 30000))
	before := state.current.Load()
	// The snapshot itself is admissible: construction did not already
	// degrade the panel, so what follows is genuinely the MERGE being
	// refused.
	if size := len(before.response.body); size == 0 || size > MaxPanelResponseBytes {
		t.Fatalf("the padded snapshot is %d bytes; the test needs an admissible base", size)
	}
	sealed := sealDocument(t, maximalDocument())
	if len(sealed) > maxSealedSeriesBytes {
		t.Fatalf("the maximal document seals to %d bytes, over the transport ceiling; this case would be refused before the budget is reached", len(sealed))
	}
	_, err := refreshDirect(t, reg, state, seriesFS(sealed), productionUnsealer(dataRootTestKeyHex))
	if err == nil || !strings.Contains(err.Error(), "over budget") {
		t.Fatalf("over-budget envelope not refused: %v", err)
	}
	if state.current.Load() != before {
		t.Fatal("a refused document still changed the served response")
	}
}

// TestTheMaximalDocumentFitsTheRaisedBudget is the measurement that
// JUSTIFIES the raise, kept as a test so it cannot rot into a claim.
//
// The owner's direction (2026-08-24) was "expand the response gate if thats
// the case, we can't be blocked over a gate we added before we even started
// developing the real websites", against the finding that full-depth
// token-usage history would be refused at serve time by the old 32 KiB
// budget. This asserts both halves of that: the maximal admissible document
// does NOT fit 32 KiB — so the old gate really would have refused the
// documents this pipeline exists to deliver — and it does fit the raised
// one, with the served envelope measured on the exact bytes served.
func TestTheMaximalDocumentFitsTheRaisedBudget(t *testing.T) {
	t.Parallel()
	reg, state := usageDataRootRegistry(t, dataRootSnapshot)
	sealed := sealDocument(t, maximalDocument())
	if _, err := refreshDirect(t, reg, state, seriesFS(sealed), productionUnsealer(dataRootTestKeyHex)); err != nil {
		t.Fatalf("the maximal admissible document was refused: %v", err)
	}
	served := len(state.current.Load().response.body)
	if served <= 32<<10 {
		t.Fatalf("the maximal document serves in %d bytes, which the OLD 32 KiB budget would have admitted; the premise of the raise is not reproduced here", served)
	}
	if served > MaxPanelResponseBytes {
		t.Fatalf("the maximal document serves in %d bytes, over the %d budget", served, MaxPanelResponseBytes)
	}
	if len(sealed) > maxSealedSeriesBytes {
		t.Fatalf("the maximal document seals to %d bytes, over the %d transport ceiling", len(sealed), maxSealedSeriesBytes)
	}
	t.Logf("maximal admissible document: %d sealed bytes, %d served bytes, budget %d",
		len(sealed), served, MaxPanelResponseBytes)
}

// TestTheServedEnvelopeExceedsTheFileItCameFrom pins the fact that killed the
// old framing of the two ceilings (2026-08-25 round-4 review, finding 7).
//
// MaxPanelResponseBytes and seal.MaxSealedBytes hold the same value, and the
// comments here and in types.go used to read that as "a document the pipeline
// can transport is a document the origin can serve". That implication is
// false, and this test is the proof rather than the assertion: the two bounds
// measure different bytes, so the SERVED envelope is strictly larger than the
// sealed file it came from — payload merged onto the embedded snapshot, plus
// the envelope scaffolding around it.
//
// The test is deliberately directional rather than pinned to an exact delta:
// the overhead is not a constant (it grows with whatever the snapshot
// contributes), and pinning today's number would turn an honest structural
// fact into a brittle assertion about one fixture. What must never become
// true is the reverse — a served envelope no larger than its file, which
// would mean the equality really did carry the implication, and this comment
// would then be the stale claim.
func TestTheServedEnvelopeExceedsTheFileItCameFrom(t *testing.T) {
	t.Parallel()
	reg, state := usageDataRootRegistry(t, dataRootSnapshot)
	sealed := sealDocument(t, maximalDocument())
	if _, err := refreshDirect(t, reg, state, seriesFS(sealed), productionUnsealer(dataRootTestKeyHex)); err != nil {
		t.Fatalf("the maximal admissible document was refused: %v", err)
	}
	served := len(state.current.Load().response.body)
	if served <= len(sealed) {
		t.Fatalf("the envelope served in %d bytes from a %d-byte file; transport size would then bound serve size and the equality of the two ceilings WOULD carry the implication the comments now deny",
			served, len(sealed))
	}
	t.Logf("envelope overhead over the transported file: %d bytes (%d sealed, %d served)",
		served-len(sealed), len(sealed), served)

	// The consequence, stated as arithmetic rather than as prose: a file
	// sealed at exactly the transport ceiling cannot serve within a serve
	// budget of the same value. This is why the refusal path — not the
	// equality — is the guarantee.
	if seal.MaxSealedBytes+(served-len(sealed)) <= MaxPanelResponseBytes {
		t.Fatal("a file at the transport ceiling would still fit the serve budget; the finding-7 correction assumes an overhead this fixture no longer shows")
	}
}

func TestDataRootTreatsAbsentFileAndUnchangedFileAsBenign(t *testing.T) {
	t.Parallel()
	reg, state := usageDataRootRegistry(t, dataRootSnapshot)
	if _, err := refreshDirect(t, reg, state, fstest.MapFS{}, productionUnsealer(dataRootTestKeyHex)); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("absent file: got %v, want fs.ErrNotExist", err)
	}
	// Accept once, then re-read the identical file with the accepted floor —
	// instant AND digest, exactly as the loop carries it forward. The loop
	// reports unchanged, not a fault.
	unseal := productionUnsealer(dataRootTestKeyHex)
	sealed := sealDocument(t, validDocument())
	fsys := seriesFS(sealed)
	floor := FloorState{Instant: reg.embeddedUsageInstant(state)}
	accepted, err := reg.refreshFromDataRoot(state, fsys, unseal, fixedNow, floor, false, nil)
	if err != nil {
		t.Fatalf("first refresh: %v", err)
	}
	if accepted.Digest == "" {
		t.Fatal("acceptance recorded no document digest; the unchanged check would be comparing instants alone")
	}
	if _, err := reg.refreshFromDataRoot(state, fsys, unseal, fixedNow, accepted, false, nil); !errors.Is(err, errSeriesUnchanged) {
		t.Fatalf("unchanged file: got %v, want errSeriesUnchanged", err)
	}

	// 2026-08-25 round-4 review, finding 3: the SAME instant carrying a
	// DIFFERENT document is not the unchanged state, and reporting it as
	// unchanged is how a running panel kept serving `ok` while the file
	// underneath it had been replaced. Re-sealing the identical document is
	// enough to produce it — AES-GCM draws a fresh nonce per seal, so the
	// ciphertext differs even though the plaintext does not, which is
	// exactly the "authentic but not the file we accepted" case.
	replaced := seriesFS(sealDocument(t, validDocument()))
	_, err = reg.refreshFromDataRoot(state, replaced, unseal, fixedNow, accepted, false, nil)
	if err == nil || errors.Is(err, errSeriesUnchanged) {
		t.Fatalf("a different ciphertext at the accepted instant returned %v; want a refusal that reaches the envelope as stale", err)
	}
	if !strings.Contains(err.Error(), "different document at the instant already accepted") {
		t.Fatalf("refused for the wrong reason: %v", err)
	}
}

// lockedFS lets the loop tests swap the visible file between wakes without
// racing the loop goroutine.
type lockedFS struct {
	mu    sync.Mutex
	inner fs.FS
}

func (l *lockedFS) Open(name string) (fs.File, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.inner.Open(name)
}

func (l *lockedFS) swap(inner fs.FS) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.inner = inner
}

// synctestSnapshot re-dates the synthetic snapshot into the synctest epoch,
// whose virtual clock starts at midnight 2000-01-01 UTC.
var synctestSnapshot = strings.Replace(dataRootSnapshot, "2026-08-20T00:00:00Z", "1999-12-31T00:00:00Z", 1)

// synctestDocument builds a valid document dated inside the bubble's clock:
// the export instant AND every source's own capture instant, which must not
// be later than the document carrying them (2026-08-24 round-3 finding 5).
func synctestDocument(generatedAt string) map[string]any {
	document := validDocument()
	document["generatedAt"] = generatedAt
	for _, section := range document["sources"].(map[string]any) {
		section.(map[string]any)["capturedAt"] = generatedAt
	}
	return document
}

// TestDataRootLoopServesRefreshesAndDegrades drives the real loop under the
// virtual clock: cold start with no file serves the snapshot untouched, a
// pushed file is picked up on the next wake, a tampered replacement degrades
// to stale while keeping the last good bytes, a newer valid push recovers,
// and cancellation stops the loop.
func TestDataRootLoopServesRefreshesAndDegrades(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		reg, state := usageDataRootRegistry(t, synctestSnapshot)
		fsys := &lockedFS{inner: fstest.MapFS{}}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		reg.startDataRoot(ctx, fsys, productionUnsealer(dataRootTestKeyHex), nil, time.Now)

		// Cold: no file. The snapshot keeps serving as ok.
		synctest.Wait()
		if envelope, _ := decodeServedUsage(t, state); envelope.Status != StatusOK {
			t.Fatalf("cold status %q, want ok", envelope.Status)
		}

		// A push lands; the next wake serves it.
		firstAt := time.Now().UTC().Format(time.RFC3339)
		fsys.swap(seriesFS(sealDocument(t, synctestDocument(firstAt))))
		time.Sleep(dataRootTTL)
		synctest.Wait()
		envelope, data := decodeServedUsage(t, state)
		if envelope.Status != StatusOK || envelope.GeneratedAt != firstAt {
			t.Fatalf("after push: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
		if data.Sources[0].Series.StartDate != "2026-08-15" {
			t.Fatal("the pushed series is not being served")
		}

		// The file is replaced by tampered bytes: stale, last good retained.
		tamperedAt := time.Now().UTC().Format(time.RFC3339)
		tampered := sealDocument(t, synctestDocument(tamperedAt))
		tampered[len(tampered)-1] ^= 0x01
		fsys.swap(seriesFS(tampered))
		time.Sleep(dataRootTTL)
		synctest.Wait()
		envelope, data = decodeServedUsage(t, state)
		if envelope.Status != StatusStale {
			t.Fatalf("after tamper: status %q, want stale", envelope.Status)
		}
		if data.Sources[0].Series.StartDate != "2026-08-15" || envelope.GeneratedAt != firstAt {
			t.Fatal("tampered push displaced the last good payload")
		}

		// A newer valid push recovers to ok.
		recoveredAt := time.Now().UTC().Format(time.RFC3339)
		fsys.swap(seriesFS(sealDocument(t, synctestDocument(recoveredAt))))
		time.Sleep(dataRootTTL)
		synctest.Wait()
		if envelope, _ = decodeServedUsage(t, state); envelope.Status != StatusOK || envelope.GeneratedAt != recoveredAt {
			t.Fatalf("after recovery: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}

		// A rollback to the previously served file is a replay: refused,
		// last good kept, stale said.
		fsys.swap(seriesFS(sealDocument(t, synctestDocument(firstAt))))
		time.Sleep(dataRootTTL)
		synctest.Wait()
		envelope, _ = decodeServedUsage(t, state)
		if envelope.Status != StatusStale || envelope.GeneratedAt != recoveredAt {
			t.Fatalf("after replay: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}

		// Cancellation stops the loop: a later valid push is never read.
		cancel()
		synctest.Wait()
		fsys.swap(seriesFS(sealDocument(t, synctestDocument(time.Now().UTC().Format(time.RFC3339)))))
		time.Sleep(4 * dataRootTTL)
		synctest.Wait()
		if envelope, _ = decodeServedUsage(t, state); envelope.GeneratedAt != recoveredAt {
			t.Fatal("a canceled loop kept reading")
		}
	})
}

// fakeMarker is a FloorMarker over one shared in-memory cell, standing in
// for the durable medium so restart tests can hand "the same persisted
// state" to a second registry — the second registry IS the restarted
// process, because a Registry owns all the state a process does here.
//
// loadErr models the marker that EXISTS and cannot be trusted, which the
// absent marker (ok=false, loadErr=nil) must not be confused with.
type fakeMarker struct {
	mu         sync.Mutex
	instant    time.Time
	digest     string
	ok         bool
	loadErr    error
	storeErr   error
	storeCalls int
}

func (m *fakeMarker) marker() *FloorMarker {
	return &FloorMarker{
		Load: func() (FloorState, bool, error) {
			m.mu.Lock()
			defer m.mu.Unlock()
			if m.loadErr != nil {
				return FloorState{}, false, m.loadErr
			}
			return FloorState{Instant: m.instant, Digest: m.digest}, m.ok, nil
		},
		Store: func(floor FloorState) error {
			m.mu.Lock()
			defer m.mu.Unlock()
			m.storeCalls++
			if m.storeErr != nil {
				return m.storeErr
			}
			m.instant = floor.Instant
			m.digest = floor.Digest
			m.ok = true
			return nil
		},
	}
}

// failStoring flips the shared cell into "the durable write fails from now
// on", modelling the disk that fills after some acceptances have persisted.
func (m *fakeMarker) failStoring(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.storeErr = err
}

// persisted reports the currently recorded floor.
func (m *fakeMarker) persisted() (time.Time, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.instant, m.ok
}

// runMarkeredLoop starts one registry's loop over the given file and marker
// inside the current synctest bubble and returns the served envelope after
// the first wake settles.
func runMarkeredLoop(t *testing.T, snapshot string, fsys fs.FS, marker *FloorMarker) (Envelope, TokenUsageData, context.CancelFunc) {
	t.Helper()
	reg, state := usageDataRootRegistry(t, snapshot)
	ctx, cancel := context.WithCancel(context.Background())
	reg.startDataRoot(ctx, fsys, productionUnsealer(dataRootTestKeyHex), marker, time.Now)
	synctest.Wait()
	envelope, data := decodeServedUsage(t, state)
	return envelope, data, cancel
}

// TestDataRootFloorSurvivesRestart is the 2026-08-24 review finding H2
// regression test: the replay floor must outlive the process. A first
// process accepts a push and persists the floor; a SECOND process (a fresh
// registry over the same marker — the restart) must refuse a rolled-back
// file that is newer than the embedded snapshot but older than what the
// first process accepted. Before the fix, the second process's floor reset
// to the snapshot's instant and the replay was accepted.
func TestDataRootFloorSurvivesRestart(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		shared := &fakeMarker{}
		// Sealed ONCE and reused, because that is what a restart actually
		// faces: the same bytes still sitting on the mounted volume. Sealing
		// twice would produce a different ciphertext under a fresh nonce,
		// which is a different file — see the same-instant case below.
		pushed := sealDocument(t, synctestDocument("2000-01-01T00:04:00Z"))

		// Process one accepts the 00:04 push and persists the floor.
		envelope, _, cancel := runMarkeredLoop(t, synctestSnapshot,
			seriesFS(pushed), shared.marker())
		if envelope.Status != StatusOK || envelope.GeneratedAt != "2000-01-01T00:04:00Z" {
			t.Fatalf("first process: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
		cancel()
		synctest.Wait()
		if !shared.ok || !shared.instant.Equal(time.Date(2000, 1, 1, 0, 4, 0, 0, time.UTC)) {
			t.Fatalf("the accepted floor was not persisted: %v %v", shared.instant, shared.ok)
		}

		// The restart, facing a ROLLED-BACK file: newer than the embedded
		// snapshot (1999-12-31), older than the persisted floor. Refused,
		// embedded payload kept, stale said.
		envelope, _, cancel = runMarkeredLoop(t, synctestSnapshot,
			seriesFS(sealDocument(t, synctestDocument("2000-01-01T00:02:00Z"))), shared.marker())
		if envelope.Status != StatusStale {
			t.Fatalf("restart accepted a replayed file: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
		if envelope.GeneratedAt == "2000-01-01T00:02:00Z" {
			t.Fatal("the replayed payload is being served")
		}
		cancel()
		synctest.Wait()

		// The restart facing the UNCHANGED file — the exact bytes the first
		// process accepted — is recovery, not replay: served ok again, so a
		// restart never trades freshness for the floor.
		envelope, _, cancel = runMarkeredLoop(t, synctestSnapshot,
			seriesFS(pushed), shared.marker())
		if envelope.Status != StatusOK || envelope.GeneratedAt != "2000-01-01T00:04:00Z" {
			t.Fatalf("restart did not re-serve the accepted file: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
		cancel()
		synctest.Wait()

		// 2026-08-24 round-3 finding 2. Recovery admits equality with the
		// floor exactly once per restart, and bound to the INSTANT alone
		// that door opened for any authentic document sharing it. A
		// DIFFERENT ciphertext at the same instant — here a fresh seal of a
		// different payload, which is exactly what an attacker replaying a
		// captured file under the same key produces — must be refused, and
		// the marker's recorded digest is what refuses it.
		different := synctestDocument("2000-01-01T00:04:00Z")
		alphaSection(different)["derived"].(map[string]any)["peak-day"] = 5
		envelope, _, cancel = runMarkeredLoop(t, synctestSnapshot,
			seriesFS(sealDocument(t, different)), shared.marker())
		if envelope.Status != StatusStale {
			t.Fatalf("restart admitted a different document at the accepted instant: status %q", envelope.Status)
		}
		cancel()
		synctest.Wait()
	})
}

// TestDataRootMarksStaleWhenAnAcceptedFileDisappears is the 2026-08-24
// review finding 5 regression test. `fs.ErrNotExist` was treated as the
// benign cold-start case unconditionally, so a runtime document that had
// been accepted and served could be DELETED from the mounted volume and the
// envelope would keep reporting `ok` at the vanished instant forever — the
// panel claiming a provenance that no longer existed. The reviewer removed
// an accepted file, advanced one TTL, and still observed status="ok".
//
// The two directions are pinned together, because the fix must not make a
// cold boot noisy: before the first publication an absent file is the
// ordinary pre-push state and stays `ok`; after one, the data is retained
// and the status turns `stale`; and a later push recovers to `ok`.
func TestDataRootMarksStaleWhenAnAcceptedFileDisappears(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		reg, state := usageDataRootRegistry(t, synctestSnapshot)
		fsys := &lockedFS{inner: fstest.MapFS{}}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		reg.startDataRoot(ctx, fsys, productionUnsealer(dataRootTestKeyHex), nil, time.Now)

		// Cold boot, no file yet: benign, and it must STAY benign across
		// several wakes or the fix has simply moved the dishonesty.
		synctest.Wait()
		time.Sleep(3 * dataRootTTL)
		synctest.Wait()
		envelope, _ := decodeServedUsage(t, state)
		if envelope.Status != StatusOK || envelope.GeneratedAt != "1999-12-31T00:00:00Z" {
			t.Fatalf("cold boot: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}

		// A push lands and is published.
		firstAt := time.Now().UTC().Format(time.RFC3339)
		fsys.swap(seriesFS(sealDocument(t, synctestDocument(firstAt))))
		time.Sleep(dataRootTTL)
		synctest.Wait()
		envelope, data := decodeServedUsage(t, state)
		if envelope.Status != StatusOK || envelope.GeneratedAt != firstAt {
			t.Fatalf("after push: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
		if data.Sources[0].Series.StartDate != "2026-08-15" {
			t.Fatal("the pushed series is not being served")
		}

		// The file is REMOVED from the mounted root. Last good data stands;
		// its freshness claim does not.
		fsys.swap(fstest.MapFS{})
		time.Sleep(dataRootTTL)
		synctest.Wait()
		envelope, data = decodeServedUsage(t, state)
		if envelope.Status != StatusStale {
			t.Fatalf("a deleted runtime document left status %q, want stale", envelope.Status)
		}
		if envelope.GeneratedAt != firstAt || data.Sources[0].Series.StartDate != "2026-08-15" {
			t.Fatalf("the last good payload was not retained: generatedAt %q series %+v", envelope.GeneratedAt, data.Sources[0].Series)
		}

		// It stays stale while the file stays gone.
		time.Sleep(3 * dataRootTTL)
		synctest.Wait()
		if envelope, _ = decodeServedUsage(t, state); envelope.Status != StatusStale {
			t.Fatalf("status drifted back to %q while the file was still gone", envelope.Status)
		}

		// A later push recovers to ok, so staleness is a state and not a
		// one-way trap.
		recoveredAt := time.Now().UTC().Format(time.RFC3339)
		fsys.swap(seriesFS(sealDocument(t, synctestDocument(recoveredAt))))
		time.Sleep(dataRootTTL)
		synctest.Wait()
		if envelope, _ = decodeServedUsage(t, state); envelope.Status != StatusOK || envelope.GeneratedAt != recoveredAt {
			t.Fatalf("after recovery: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
	})
}

// TestDataRootReportsProvenanceLossOnTheFirstTickAfterRestart is the
// 2026-08-24 round-3 finding 6 regression test.
//
// The delete-after-serve repair above bound its truthfulness to
// acceptedInProcess — this process published something, then lost the file.
// A RESTART resets that flag while the evidence of publication survives in
// the durable marker, so a pod that booted with a valid persisted floor and
// no source file served `ok` on its first tick: it claimed a freshness whose
// document it had just failed to find, and the reviewer observed exactly
// that. A persisted marker IS proof that a document was published, so an
// absent source beside one is provenance loss from the first tick.
//
// The cold direction is pinned in the same test, because the fix must not
// make a genuinely first boot noisy: no marker and no file stays `ok`.
func TestDataRootReportsProvenanceLossOnTheFirstTickAfterRestart(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		// The restart: a floor persisted by a previous process, and a
		// mounted root with nothing in it.
		// Inside the future-skew bound on purpose: a marker AHEAD of the
		// clock is refused for its own reason, and this test is about the
		// absent SOURCE, not about a nonsensical floor.
		published := &fakeMarker{
			instant: time.Date(2000, 1, 1, 0, 5, 0, 0, time.UTC),
			digest:  "0000000000000000000000000000000000000000000000000000000000000000",
			ok:      true,
		}
		envelope, data, cancel := runMarkeredLoop(t, synctestSnapshot, fstest.MapFS{}, published.marker())
		if envelope.Status != StatusStale {
			t.Fatalf("a restart with a persisted floor and no source served %q on its first tick, want stale", envelope.Status)
		}
		// The DATA still stands — only the freshness claim is withdrawn.
		if data.Sources[0].Series == nil {
			t.Fatal("the payload was dropped rather than marked stale")
		}
		cancel()
		synctest.Wait()

		// Non-vacuity, and the cold direction: no marker at all, same empty
		// root, and the panel is legitimately serving its embedded snapshot
		// before any push has ever happened.
		cold := &fakeMarker{}
		envelope, _, cancel = runMarkeredLoop(t, synctestSnapshot, fstest.MapFS{}, cold.marker())
		if envelope.Status != StatusOK {
			t.Fatalf("a genuine cold boot served %q, want ok", envelope.Status)
		}
		cancel()
		synctest.Wait()
	})
}

// TestCheckedCountArithmeticIsNonVacuous drives the two halves of the
// numeric contract directly (2026-08-24 round-3 review, finding 9): the
// shared bound, and the overflow-checked addition that holds even if that
// bound were ever widened.
func TestCheckedCountArithmeticIsNonVacuous(t *testing.T) {
	t.Parallel()
	for name, value := range map[string]int64{
		"negative":  -1,
		"above cap": maxCountValue + 1,
		"max int64": math.MaxInt64,
	} {
		if err := admitCount(value); err == nil {
			t.Fatalf("%s count was admitted", name)
		}
	}
	for name, value := range map[string]int64{
		"zero":       0,
		"one":        1,
		"exactly at": maxCountValue,
	} {
		if err := admitCount(value); err != nil {
			t.Fatalf("%s count was refused: %v", name, err)
		}
	}
	if sum, ok := addCounts(maxCountValue, maxCountValue); !ok || sum != 2*maxCountValue {
		t.Fatalf("addCounts(cap, cap) = %d %v", sum, ok)
	}
	if _, ok := addCounts(math.MaxInt64, 1); ok {
		t.Fatal("addCounts wrapped instead of refusing")
	}
}

// TestDataRootFloorMarkerFailsClosed pins every marker direction under the
// 2026-08-24 finding-2 contract. Durable mode is a promise about what
// survives a restart, so when its own state cannot be read or written the
// loop refuses the tick and says stale — it never quietly reverts to the
// embedded floor, which would re-admit everything a previous process had
// already published past. Only the genuinely ABSENT marker is benign, and
// only because a first boot has nothing to forget.
func TestDataRootFloorMarkerFailsClosed(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		fsys := seriesFS(sealDocument(t, synctestDocument("2000-01-01T00:02:00Z")))
		embedded := "1999-12-31T00:00:00Z"

		// ABSENT marker: the first boot of a durable deployment. The floor
		// is the embedded snapshot's, the push lands, and the floor persists.
		absent := &fakeMarker{}
		envelope, _, cancel := runMarkeredLoop(t, synctestSnapshot, fsys, absent.marker())
		if envelope.Status != StatusOK || envelope.GeneratedAt != "2000-01-01T00:02:00Z" {
			t.Fatalf("absent marker: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
		if instant, ok := absent.persisted(); !ok || !instant.Equal(time.Date(2000, 1, 1, 0, 2, 0, 0, time.UTC)) {
			t.Fatalf("absent marker: floor persisted as %v %v", instant, ok)
		}
		cancel()
		synctest.Wait()

		// UNREADABLE marker: it exists and cannot be trusted. Refused, the
		// embedded payload kept, stale said, and nothing written.
		unreadable := &fakeMarker{loadErr: errors.New("marker unreadable")}
		envelope, _, cancel = runMarkeredLoop(t, synctestSnapshot, fsys, unreadable.marker())
		if envelope.Status != StatusStale || envelope.GeneratedAt != embedded {
			t.Fatalf("unreadable marker: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
		if unreadable.storeCalls != 0 {
			t.Fatal("a tick ran on an unresolved durable floor")
		}
		cancel()
		synctest.Wait()

		// FUTURE marker: a floor is only ever written from an instant this
		// loop already bounded against the clock, so one from the future is
		// tampering or a clock that moved backwards. Same refusal.
		future := &fakeMarker{instant: time.Date(2000, 1, 2, 0, 0, 0, 0, time.UTC), ok: true}
		envelope, _, cancel = runMarkeredLoop(t, synctestSnapshot, fsys, future.marker())
		if envelope.Status != StatusStale || envelope.GeneratedAt != embedded {
			t.Fatalf("future marker: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
		if future.storeCalls != 0 {
			t.Fatal("a tick ran on a future durable floor")
		}
		cancel()
		synctest.Wait()

		// Failing STORE: the commit is the last gate before publication, so
		// a payload whose floor cannot be persisted is not published at all.
		broken := &fakeMarker{storeErr: errors.New("disk full")}
		envelope, _, cancel = runMarkeredLoop(t, synctestSnapshot, fsys, broken.marker())
		if envelope.Status != StatusStale || envelope.GeneratedAt != embedded {
			t.Fatalf("failing store: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
		if broken.storeCalls == 0 {
			t.Fatal("the store was never attempted")
		}
		if _, ok := broken.persisted(); ok {
			t.Fatal("a failed store still recorded a floor")
		}
		cancel()
		synctest.Wait()

		// A marker at or below the embedded floor adds nothing and is not a
		// fault: the embedded instant is already the stronger bound.
		stale := &fakeMarker{instant: time.Date(1999, 12, 30, 0, 0, 0, 0, time.UTC), ok: true}
		envelope, _, cancel = runMarkeredLoop(t, synctestSnapshot, fsys, stale.marker())
		if envelope.Status != StatusOK || envelope.GeneratedAt != "2000-01-01T00:02:00Z" {
			t.Fatalf("below-embedded marker: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
		cancel()
		synctest.Wait()
	})
}

// TestDataRootNeverPublishesAheadOfThePersistedFloor is the 2026-08-24
// review finding 2 regression test, staged as the reviewer staged it.
//
// Before the fix, refreshFromDataRoot published the candidate and only then
// tried to persist the new floor, discarding the error. The reviewer's
// reproduction: floor persisted at 00:02, the loop accepts and SERVES 00:04
// while Store returns "disk full", the process restarts, and the older but
// perfectly authentic 00:02 file is re-admitted as status ok — a rollback of
// data a visitor had already been served.
//
// After the fix the middle state is unrepresentable. The commit runs BEFORE
// publication, so a payload whose floor cannot be persisted never becomes
// the served payload: the panel holds 00:02 and says stale, and the restart
// re-serving 00:02 is recovery of the newest instant that was ever actually
// published, not a rollback from a newer one.
func TestDataRootNeverPublishesAheadOfThePersistedFloor(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		shared := &fakeMarker{}
		reg, state := usageDataRootRegistry(t, synctestSnapshot)
		// Sealed once and reused across the restart below: the file on the
		// volume does not re-seal itself, and the marker binds the exact
		// ciphertext it recorded (2026-08-24 round-3 finding 2).
		published := sealDocument(t, synctestDocument("2000-01-01T00:02:00Z"))
		fsys := &lockedFS{inner: seriesFS(published)}
		ctx, cancel := context.WithCancel(context.Background())
		reg.startDataRoot(ctx, fsys, productionUnsealer(dataRootTestKeyHex), shared.marker(), time.Now)

		// 1. The healthy push: served, and its floor durably recorded.
		synctest.Wait()
		envelope, _ := decodeServedUsage(t, state)
		if envelope.Status != StatusOK || envelope.GeneratedAt != "2000-01-01T00:02:00Z" {
			t.Fatalf("first push: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
		if instant, ok := shared.persisted(); !ok || !instant.Equal(time.Date(2000, 1, 1, 0, 2, 0, 0, time.UTC)) {
			t.Fatalf("first push floor: %v %v", instant, ok)
		}

		// 2. The disk fills, and a newer authentic push arrives. The floor
		//    cannot advance, so the payload must NOT be published.
		shared.failStoring(errors.New("disk full"))
		fsys.swap(seriesFS(sealDocument(t, synctestDocument("2000-01-01T00:04:00Z"))))
		time.Sleep(dataRootTTL)
		synctest.Wait()
		envelope, _ = decodeServedUsage(t, state)
		if envelope.GeneratedAt == "2000-01-01T00:04:00Z" {
			t.Fatal("a payload was published ahead of its persisted floor")
		}
		if envelope.Status != StatusStale || envelope.GeneratedAt != "2000-01-01T00:02:00Z" {
			t.Fatalf("uncommittable push: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
		if instant, _ := shared.persisted(); !instant.Equal(time.Date(2000, 1, 1, 0, 2, 0, 0, time.UTC)) {
			t.Fatalf("the failed store moved the floor to %v", instant)
		}
		cancel()
		synctest.Wait()

		// 3. The disk is repaired and the process restarts, facing the older
		//    authentic 00:02 file. It is the newest instant ever published,
		//    so re-serving it is recovery — and the 00:04 the old code would
		//    have served before this restart never was.
		shared.failStoring(nil)
		envelope, _, cancel = runMarkeredLoop(t, synctestSnapshot,
			seriesFS(published), shared.marker())
		if envelope.Status != StatusOK || envelope.GeneratedAt != "2000-01-01T00:02:00Z" {
			t.Fatalf("restart: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
		cancel()
		synctest.Wait()

		// 4. And the rollback proper is still refused after the restart: a
		//    file older than the persisted floor never serves.
		envelope, _, cancel = runMarkeredLoop(t, synctestSnapshot,
			seriesFS(sealDocument(t, synctestDocument("2000-01-01T00:01:00Z"))), shared.marker())
		if envelope.Status != StatusStale || envelope.GeneratedAt == "2000-01-01T00:01:00Z" {
			t.Fatalf("restart accepted a replay: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
		cancel()
		synctest.Wait()
	})
}

// compositionDoer answers both fetch shapes and counts which endpoint class
// was reached, so a test can assert what the live path did rather than what
// it was configured to do.
type compositionDoer struct {
	mu    sync.Mutex
	usage int
	boss  int
}

func (d *compositionDoer) Do(request *http.Request) (*http.Response, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	body := fixtureHiscores
	if strings.Contains(request.URL.Path, "usage") {
		d.usage++
		body = fixtureUsagePage
	} else {
		d.boss++
	}
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body))}, nil
}

func (d *compositionDoer) counts() (usage, boss int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.usage, d.boss
}

// compositionRegistry builds a registry whose token-usage panel is
// FETCH-BACKED over the synthetic snapshot (so the live path is genuinely
// able to write it) alongside a fetch-backed boss-log panel that must keep
// working either way.
func compositionRegistry(t *testing.T) *Registry {
	t.Helper()
	fsys := fstest.MapFS{
		"snapshots/token-usage.json": &fstest.MapFile{Data: []byte(synctestSnapshot)},
		"snapshots/boss.json":        &fstest.MapFile{Data: validSnapshot(t)},
	}
	usage, err := NewFetchSource(
		SnapshotSource{Name: "snapshots/token-usage.json"},
		validFetchConfig(),
		panelFetchSpecs{usage: &tokenUsageFetchSpec{Sources: []usageSourceSpec{
			{
				Label: "alpha", Endpoint: "https://api.example.test/usage-a", Shape: shapeUsagePage,
				KeyEnvName: "PANEL_TEST_KEY_A", KeyHeader: "x-api-key",
				Window: windowParamSpec{Param: "starting_at", Format: windowFormatRFC3339, LookbackDays: 7},
			},
			{
				Label: "beta", Endpoint: "https://api.example.test/usage-b", Shape: shapeUsagePage,
				KeyEnvName: "PANEL_TEST_KEY_B", KeyHeader: "Authorization", KeyPrefix: "Bearer ",
				Window: windowParamSpec{Param: "start_time", Format: windowFormatUnix, LookbackDays: 7},
			},
		}}},
	)
	if err != nil {
		t.Fatalf("token-usage fetch source: %v", err)
	}
	boss, err := NewFetchSource(
		SnapshotSource{Name: "snapshots/boss.json"},
		validFetchConfig(),
		panelFetchSpecs{bossLog: validBossSpec()},
	)
	if err != nil {
		t.Fatalf("boss-log fetch source: %v", err)
	}
	return newRegistry(fsys, []panelDefinition{
		{id: "token-usage", kind: KindTokenUsageV2, title: "Token usage", source: usage},
		{id: "boss-log", kind: KindBossLog, title: "Boss log", source: boss},
	})
}

// compositionEnv supplies both credentials, so the live token-usage fetch is
// fully able to run. Suppression must be the reason it does not — not a
// missing key, which would make the whole assertion vacuous.
func compositionEnv(name string) string {
	switch name {
	case "PANEL_TEST_KEY_A", "PANEL_TEST_KEY_B":
		return "fixture-key"
	}
	return ""
}

// TestDataRootOwnsTheTokenUsagePanel is the 2026-08-24 review finding 8
// regression test. cmd/server started BOTH producers when both switches were
// on, and both wrote the same state.current with no ownership, precedence,
// or merge rule — so a credentialed live refresh could overwrite the sealed
// series and the next data-root tick could overwrite it back, with the panel
// alternating between two provenances at two cadences.
//
// The repair is per-panel ownership, not refusal of the configuration: when
// the sealed data root is enabled it OWNS the token-usage panel and the live
// path never fetches it, while every other refresh-backed panel keeps
// working. Both halves are asserted, and the control below proves the
// suppressed fetch would otherwise have happened.
func TestDataRootOwnsTheTokenUsagePanel(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		reg := compositionRegistry(t)
		doer := &compositionDoer{}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		// The composition root's order: the data root claims the panel, then
		// live refresh starts for everything else.
		reg.startDataRoot(ctx, seriesFS(sealDocument(t, synctestDocument("2000-01-01T00:02:00Z"))),
			productionUnsealer(dataRootTestKeyHex), nil, time.Now)
		reg.startRefresh(ctx, doer, compositionEnv)
		synctest.Wait()

		if !reg.DataRootOwnsTokenUsage() {
			t.Fatal("the data root did not claim the token-usage panel")
		}
		usage, boss := doer.counts()
		if usage != 0 {
			t.Fatalf("the live path fetched the owned panel %d times", usage)
		}
		if boss == 0 {
			t.Fatal("suppressing one panel stopped the others refreshing")
		}

		// The sealed document is what the panel serves, and it stays that
		// way across several live-refresh TTLs — the interval over which the
		// racing producer would have overwritten it.
		envelope, data := decodeServedUsage(t, reg.byID["token-usage"])
		if envelope.Status != StatusOK || envelope.GeneratedAt != "2000-01-01T00:02:00Z" {
			t.Fatalf("sealed series not served: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
		if data.Sources[0].Series.StartDate != "2026-08-15" {
			t.Fatalf("served series is not the sealed one: %+v", data.Sources[0].Series)
		}
		time.Sleep(4 * validFetchConfig().TTL)
		synctest.Wait()
		if usage, _ = doer.counts(); usage != 0 {
			t.Fatalf("the live path fetched the owned panel %d times after several TTLs", usage)
		}
		envelope, data = decodeServedUsage(t, reg.byID["token-usage"])
		if envelope.GeneratedAt != "2000-01-01T00:02:00Z" || data.Sources[0].Series.StartDate != "2026-08-15" {
			t.Fatalf("the sealed series was overwritten: generatedAt %q series %+v", envelope.GeneratedAt, data.Sources[0].Series)
		}
		if _, laterBoss := doer.counts(); laterBoss <= boss {
			// Not merely "still alive": the other panel must have refreshed
			// AGAIN across those TTLs, so suppression is per panel rather
			// than a process-wide stop that happened to leave one stale
			// success behind.
			t.Fatalf("the other panel stopped refreshing: %d fetches, then %d across four TTLs", boss, laterBoss)
		}
		cancel()
		synctest.Wait()
	})
}

// TestLiveRefreshOwnsTheTokenUsagePanelWithoutTheDataRoot is the control for
// the test above: the identical registry, doer and environment, with the
// sealed data root NOT enabled. The live path must fetch and publish the
// token-usage panel — otherwise the suppression assertion would pass for a
// missing credential, an unreachable endpoint, or any other reason having
// nothing to do with ownership.
func TestLiveRefreshOwnsTheTokenUsagePanelWithoutTheDataRoot(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		reg := compositionRegistry(t)
		doer := &compositionDoer{}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		reg.startRefresh(ctx, doer, compositionEnv)
		synctest.Wait()

		if reg.DataRootOwnsTokenUsage() {
			t.Fatal("nothing claimed the panel, yet ownership reports true")
		}
		if usage, _ := doer.counts(); usage == 0 {
			t.Fatal("the live path never fetched the token-usage panel; the suppression assertion would be vacuous")
		}
		envelope, _ := decodeServedUsage(t, reg.byID["token-usage"])
		if envelope.Status != StatusOK {
			t.Fatalf("live-refreshed status %q, want ok", envelope.Status)
		}
		if envelope.GeneratedAt == "2000-01-01T00:02:00Z" {
			t.Fatal("the control served the sealed instant it was never given")
		}
		cancel()
		synctest.Wait()
	})
}

// TestDataRootStartGuards pins the capability guards: nil capabilities start
// nothing, a registry without the panel starts nothing, and a second start
// is a no-op.
func TestDataRootStartGuards(t *testing.T) {
	t.Parallel()
	reg, _ := usageDataRootRegistry(t, dataRootSnapshot)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reg.startDataRoot(ctx, nil, productionUnsealer(dataRootTestKeyHex), nil, time.Now)
	reg.startDataRoot(ctx, fstest.MapFS{}, nil, nil, time.Now)
	if reg.dataRootStarted.Load() {
		t.Fatal("a nil capability still marked the loop started")
	}
	reg.startDataRoot(ctx, fstest.MapFS{}, productionUnsealer(dataRootTestKeyHex), nil, time.Now)
	if !reg.dataRootStarted.Load() {
		t.Fatal("the loop did not start")
	}
	// A registry without the token-usage panel never starts.
	other := newRegistry(fstest.MapFS{}, nil)
	other.startDataRoot(ctx, fstest.MapFS{}, productionUnsealer(dataRootTestKeyHex), nil, time.Now)
	if len(other.states) != 0 {
		t.Fatal("unexpected states")
	}
}

// TestEnvelopeInstantIsTheOldestSourcesCapture is the fourth claim the
// 2026-08-25 round-4 review found vacuous: disabling `captured.Before(oldest)`
// left this package green, so nothing pinned the rule that decides what the
// envelope's `generatedAt` MEANS.
//
// The rule exists because one envelope carries one instant for a payload
// assembled from several sources. Taking the export's own instant, or the
// newest source's, would let a document dressed as current carry a section
// captured days earlier — the exact relabelling round-3 finding 5 was about,
// moved from the producer to the merge. The oldest capture is the only choice
// that cannot overstate: whatever the envelope claims, every source is at
// least that fresh.
func TestEnvelopeInstantIsTheOldestSourcesCapture(t *testing.T) {
	t.Parallel()
	reg, state := usageDataRootRegistry(t, dataRootSnapshot)
	fallback, err := reg.loadSnapshotUsageData(state)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}

	const emitted = "2026-08-24T12:00:00Z"
	for name, testCase := range map[string]struct {
		alpha, beta string
		want        string
	}{
		"beta lags behind alpha":       {alpha: emitted, beta: "2026-08-24T09:30:00Z", want: "2026-08-24T09:30:00Z"},
		"alpha lags behind beta":       {alpha: "2026-08-22T04:00:00Z", beta: emitted, want: "2026-08-22T04:00:00Z"},
		"both lag, the older one wins": {alpha: "2026-08-23T01:00:00Z", beta: "2026-08-22T23:59:59Z", want: "2026-08-22T23:59:59Z"},
		"both current":                 {alpha: emitted, beta: emitted, want: emitted},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			document := validDocument()
			document["generatedAt"] = emitted
			alphaSection(document)["capturedAt"] = testCase.alpha
			betaSection(document)["capturedAt"] = testCase.beta

			var decoded usageSeriesDocument
			raw, err := json.Marshal(document)
			if err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(raw, &decoded); err != nil {
				t.Fatal(err)
			}
			_, instant, err := mergeSeriesDocument(decoded, fallback, fixedNow())
			if err != nil {
				t.Fatalf("merge: %v", err)
			}
			if instant != testCase.want {
				t.Fatalf("the envelope claims %s; the oldest source was captured at %s", instant, testCase.want)
			}
			// Stated as the property rather than the value, so a future
			// change that picks the newest or the export instant fails here
			// with the reason rather than with a mismatched string.
			for label, section := range decoded.Sources {
				captured, err := time.Parse(time.RFC3339, section.CapturedAt)
				if err != nil {
					t.Fatal(err)
				}
				claimed, err := time.Parse(time.RFC3339, instant)
				if err != nil {
					t.Fatal(err)
				}
				if captured.Before(claimed) {
					t.Fatalf("source %q was captured at %s, BEFORE the %s the envelope claims for the whole payload",
						label, section.CapturedAt, instant)
				}
			}
		})
	}
}
