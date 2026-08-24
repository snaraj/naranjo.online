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
	"io"
	"io/fs"
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
// three series-derived tiles and one figure a series can never define.
const dataRootSnapshot = `{
  "generatedAt": "2026-08-20T00:00:00Z",
  "data": {"sources": [
    {"label": "alpha", "windows": [], "stats": [
      {"key": "lifetime", "label": "Lifetime", "value": 1000, "unit": "tokens", "recorded": true},
      {"key": "peak-day", "label": "Peak day", "value": 50, "unit": "tokens", "recorded": true},
      {"key": "current-streak", "label": "Current streak", "value": 1, "unit": "days", "recorded": true},
      {"key": "longest-streak", "label": "Longest streak", "value": 2, "unit": "days", "recorded": true}],
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
		kind:   KindTokenUsage,
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
// beta's section is deliberately minimal — a series and nothing else — since
// categories, windows and derived tiles are all optional per source.
func validDocument() map[string]any {
	return map[string]any{
		"schema":      "usage-series/v1",
		"generatedAt": "2026-08-24T12:00:00Z",
		"sources": map[string]any{
			"alpha": map[string]any{
				"series": map[string]any{"startDate": "2026-08-15", "totals": []int64{5, 0, 7}, "recorded": true},
				"categories": map[string]any{
					"output": []int64{4, 0, 4},
					"input":  []int64{1, 0, 3},
				},
				"windows": map[string]any{
					"today": map[string]any{"input": 3, "output": 4},
					"week":  map[string]any{"input": 4, "output": 8},
				},
				"derived": map[string]any{"peak-day": 7, "current-streak": 1, "longest-streak": 1},
			},
			"beta": map[string]any{
				"series": map[string]any{"startDate": "2026-08-18", "totals": []int64{2, 3}, "recorded": true},
			},
		},
	}
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
	return reg.refreshFromDataRoot(state, fsys, unseal, fixedNow, reg.embeddedUsageInstant(state), false, nil)
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
	// Derived tiles refreshed; the lifetime figure — which no series can
	// measure — kept exactly as the snapshot shipped it.
	tiles := map[string]int64{}
	for _, stat := range alpha.Stats {
		if stat.Value != nil {
			tiles[stat.Key] = *stat.Value
		}
		if !stat.Recorded {
			t.Fatalf("tile %q lost its recorded provenance", stat.Key)
		}
	}
	if tiles["peak-day"] != 7 || tiles["current-streak"] != 1 || tiles["longest-streak"] != 1 || tiles["lifetime"] != 1000 {
		t.Fatalf("tiles wrong after merge: %v", tiles)
	}
	if len(alpha.Windows) != 2 || alpha.Windows[0].Period != "today" || alpha.Windows[0].InputTokens != 3 || alpha.Windows[1].Period != "week" {
		t.Fatalf("windows wrong after merge: %+v", alpha.Windows)
	}
	if len(alpha.Insights) != 1 {
		t.Fatal("insights must survive the merge untouched")
	}
	// EVERY shipped source is refreshed by the same push, which is what
	// makes one envelope status and one generatedAt honest for the whole
	// payload (2026-08-24 review finding 7). beta's minimal section proves
	// categories, windows and derived stay optional per source.
	beta := data.Sources[1]
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
			delete(section, "windows")
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
		"category key with markup": {func(d map[string]any) {
			categories := alphaSection(d)["categories"].(map[string]any)
			categories["<img src=x>"] = categories["input"]
			delete(categories, "input")
		}, "category key"},
		// MEMBERSHIP, not shape (2026-08-24 review finding H1): these keys
		// are perfectly label-shaped — lowercase, hyphenated, bounded — and
		// the original shape-only guard ADMITTED them, which would have
		// rendered a private identifier publicly through the frontend's
		// category labels. The closed vocabulary must refuse them.
		"category key label-shaped but private": {func(d map[string]any) {
			categories := alphaSection(d)["categories"].(map[string]any)
			categories["private-feature"] = categories["input"]
			delete(categories, "input")
		}, "closed category vocabulary"},
		"category key label-shaped project name": {func(d map[string]any) {
			categories := alphaSection(d)["categories"].(map[string]any)
			categories["internal-project-name"] = categories["input"]
			delete(categories, "input")
		}, "closed category vocabulary"},
		"category key with a path": {func(d map[string]any) {
			categories := alphaSection(d)["categories"].(map[string]any)
			categories["a/b"] = categories["input"]
			delete(categories, "input")
		}, "category key"},
		"category key uppercase": {func(d map[string]any) {
			categories := alphaSection(d)["categories"].(map[string]any)
			categories["Input"] = categories["input"]
			delete(categories, "input")
		}, "category key"},
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
			alphaSection(d)["windows"].(map[string]any)["month"] = map[string]any{"input": 1, "output": 1}
		}, "window key"},
		"negative window": {func(d map[string]any) {
			alphaSection(d)["windows"].(map[string]any)["today"] = map[string]any{"input": -1, "output": 1}
		}, "negative"},
		"derived outside the vocabulary": {func(d map[string]any) {
			alphaSection(d)["derived"].(map[string]any)["lifetime"] = 9999
		}, "closed vocabulary"},
		"negative derived": {func(d map[string]any) {
			alphaSection(d)["derived"].(map[string]any)["peak-day"] = -7
		}, "negative"},
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
func TestDataRootRefusesAnOverBudgetEnvelope(t *testing.T) {
	t.Parallel()
	reg, state := usageDataRootRegistry(t, dataRootSnapshot)
	days := 700
	totals := make([]int64, days)
	category := make([]int64, days)
	for index := range totals {
		totals[index] = 5 * 888888888
		category[index] = 888888888
	}
	document := validDocument()
	section := alphaSection(document)
	section["series"] = map[string]any{"startDate": "2024-01-01", "totals": totals, "recorded": true}
	section["categories"] = map[string]any{
		"input": category, "output": category, "cache-read": category,
		"cache-write": category, "reasoning": category,
	}
	delete(section, "windows")
	delete(section, "derived")
	before := state.current.Load()
	_, err := refreshDirect(t, reg, state, seriesFS(sealDocument(t, document)), productionUnsealer(dataRootTestKeyHex))
	if err == nil || !strings.Contains(err.Error(), "over budget") {
		t.Fatalf("over-budget envelope not refused: %v", err)
	}
	if state.current.Load() != before {
		t.Fatal("a refused document still changed the served response")
	}
}

func TestDataRootTreatsAbsentFileAndUnchangedFileAsBenign(t *testing.T) {
	t.Parallel()
	reg, state := usageDataRootRegistry(t, dataRootSnapshot)
	if _, err := refreshDirect(t, reg, state, fstest.MapFS{}, productionUnsealer(dataRootTestKeyHex)); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("absent file: got %v, want fs.ErrNotExist", err)
	}
	// Accept once, then re-read the identical file with the accepted instant
	// as the floor: the loop reports unchanged, not a fault.
	fsys := seriesFS(sealDocument(t, validDocument()))
	unseal := productionUnsealer(dataRootTestKeyHex)
	accepted, err := refreshDirect(t, reg, state, fsys, unseal)
	if err != nil {
		t.Fatalf("first refresh: %v", err)
	}
	if _, err := reg.refreshFromDataRoot(state, fsys, unseal, fixedNow, accepted, false, nil); !errors.Is(err, errSeriesUnchanged) {
		t.Fatalf("unchanged file: got %v, want errSeriesUnchanged", err)
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

// synctestDocument builds a valid document dated inside the bubble's clock.
func synctestDocument(generatedAt string) map[string]any {
	document := validDocument()
	document["generatedAt"] = generatedAt
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
		fsys.swap(seriesFS(sealDocument(t, synctestDocument("2000-01-01T00:04:00Z"))))
		time.Sleep(dataRootTTL)
		synctest.Wait()
		envelope, data := decodeServedUsage(t, state)
		if envelope.Status != StatusOK || envelope.GeneratedAt != "2000-01-01T00:04:00Z" {
			t.Fatalf("after push: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
		if data.Sources[0].Series.StartDate != "2026-08-15" {
			t.Fatal("the pushed series is not being served")
		}

		// The file is replaced by tampered bytes: stale, last good retained.
		tampered := sealDocument(t, synctestDocument("2000-01-01T00:09:00Z"))
		tampered[len(tampered)-1] ^= 0x01
		fsys.swap(seriesFS(tampered))
		time.Sleep(dataRootTTL)
		synctest.Wait()
		envelope, data = decodeServedUsage(t, state)
		if envelope.Status != StatusStale {
			t.Fatalf("after tamper: status %q, want stale", envelope.Status)
		}
		if data.Sources[0].Series.StartDate != "2026-08-15" || envelope.GeneratedAt != "2000-01-01T00:04:00Z" {
			t.Fatal("tampered push displaced the last good payload")
		}

		// A newer valid push recovers to ok.
		fsys.swap(seriesFS(sealDocument(t, synctestDocument("2000-01-01T00:14:00Z"))))
		time.Sleep(dataRootTTL)
		synctest.Wait()
		if envelope, _ = decodeServedUsage(t, state); envelope.Status != StatusOK || envelope.GeneratedAt != "2000-01-01T00:14:00Z" {
			t.Fatalf("after recovery: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}

		// A rollback to the previously served file is a replay: refused,
		// last good kept, stale said.
		fsys.swap(seriesFS(sealDocument(t, synctestDocument("2000-01-01T00:04:00Z"))))
		time.Sleep(dataRootTTL)
		synctest.Wait()
		envelope, _ = decodeServedUsage(t, state)
		if envelope.Status != StatusStale || envelope.GeneratedAt != "2000-01-01T00:14:00Z" {
			t.Fatalf("after replay: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}

		// Cancellation stops the loop: a later valid push is never read.
		cancel()
		synctest.Wait()
		fsys.swap(seriesFS(sealDocument(t, synctestDocument("2000-01-01T00:19:00Z"))))
		time.Sleep(4 * dataRootTTL)
		synctest.Wait()
		if envelope, _ = decodeServedUsage(t, state); envelope.GeneratedAt != "2000-01-01T00:14:00Z" {
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
	ok         bool
	loadErr    error
	storeErr   error
	storeCalls int
}

func (m *fakeMarker) marker() *FloorMarker {
	return &FloorMarker{
		Load: func() (time.Time, bool, error) {
			m.mu.Lock()
			defer m.mu.Unlock()
			if m.loadErr != nil {
				return time.Time{}, false, m.loadErr
			}
			return m.instant, m.ok, nil
		},
		Store: func(instant time.Time) error {
			m.mu.Lock()
			defer m.mu.Unlock()
			m.storeCalls++
			if m.storeErr != nil {
				return m.storeErr
			}
			m.instant = instant
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

		// Process one accepts the 00:04 push and persists the floor.
		envelope, _, cancel := runMarkeredLoop(t, synctestSnapshot,
			seriesFS(sealDocument(t, synctestDocument("2000-01-01T00:04:00Z"))), shared.marker())
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

		// The restart facing the UNCHANGED file: the exact file the first
		// process accepted is recovery, not replay — served ok again, so a
		// restart never trades freshness for the floor.
		envelope, _, cancel = runMarkeredLoop(t, synctestSnapshot,
			seriesFS(sealDocument(t, synctestDocument("2000-01-01T00:04:00Z"))), shared.marker())
		if envelope.Status != StatusOK || envelope.GeneratedAt != "2000-01-01T00:04:00Z" {
			t.Fatalf("restart did not re-serve the accepted file: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
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
		fsys.swap(seriesFS(sealDocument(t, synctestDocument("2000-01-01T00:20:00Z"))))
		time.Sleep(dataRootTTL)
		synctest.Wait()
		envelope, data := decodeServedUsage(t, state)
		if envelope.Status != StatusOK || envelope.GeneratedAt != "2000-01-01T00:20:00Z" {
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
		if envelope.GeneratedAt != "2000-01-01T00:20:00Z" || data.Sources[0].Series.StartDate != "2026-08-15" {
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
		fsys.swap(seriesFS(sealDocument(t, synctestDocument("2000-01-01T00:40:00Z"))))
		time.Sleep(dataRootTTL)
		synctest.Wait()
		if envelope, _ = decodeServedUsage(t, state); envelope.Status != StatusOK || envelope.GeneratedAt != "2000-01-01T00:40:00Z" {
			t.Fatalf("after recovery: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
	})
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
		fsys := &lockedFS{inner: seriesFS(sealDocument(t, synctestDocument("2000-01-01T00:02:00Z")))}
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
			seriesFS(sealDocument(t, synctestDocument("2000-01-01T00:02:00Z"))), shared.marker())
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
		{id: "token-usage", kind: KindTokenUsage, title: "Token usage", source: usage},
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
