// snapshot_test proves the snapshot admission gate from both sides: every
// snapshot the binary ships parses strictly, every class of broken snapshot
// degrades its panel to unavailable instead of failing construction, and a
// read-counting filesystem pins that construction reads each snapshot exactly
// once while the request path never touches a filesystem again.
package panels

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"
)

// countingFS wraps an in-memory snapshot tree and records every ReadFile so
// tests can assert exactly when data leaves the filesystem.
type countingFS struct {
	files fstest.MapFS

	mu    sync.Mutex
	reads []string
}

func (c *countingFS) Open(name string) (fs.File, error) { return c.files.Open(name) }

func (c *countingFS) ReadFile(name string) ([]byte, error) {
	c.mu.Lock()
	c.reads = append(c.reads, name)
	c.mu.Unlock()
	return c.files.ReadFile(name)
}

// recordedReads returns a sorted copy so assertions are deterministic.
func (c *countingFS) recordedReads() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	reads := append([]string(nil), c.reads...)
	sort.Strings(reads)
	return reads
}

// validSnapshot builds a healthy boss-log snapshot document for fixtures.
func validSnapshot(t *testing.T) []byte {
	t.Helper()
	document := []byte(`{"generatedAt":"2026-08-10T21:15:00Z","data":{"account":"fixture","bosses":[{"name":"Fixture Boss","kc":1,"rank":2}]}}`)
	return document
}

// TestEveryShippedSnapshotParsesStrictly is the contract for shipping data:
// each builtin panel's snapshot must load through the strict gate, and every
// embedded snapshot file must be claimed by exactly one builtin panel so a
// stray file cannot ride in the binary unvalidated.
func TestEveryShippedSnapshotParsesStrictly(t *testing.T) {
	t.Parallel()
	claimed := map[string]bool{}
	for _, definition := range builtinPanels {
		snapshot, ok := definition.source.(SnapshotSource)
		if !ok {
			t.Fatalf("panel %s uses %T; every builtin source must be a SnapshotSource", definition.id, definition.source)
		}
		if claimed[snapshot.Name] {
			t.Fatalf("snapshot %s is claimed by more than one panel", snapshot.Name)
		}
		claimed[snapshot.Name] = true
		loaded, err := snapshot.load(snapshotFiles, definition.kind)
		if err != nil {
			t.Errorf("panel %s: shipped snapshot fails the strict gate: %v", definition.id, err)
			continue
		}
		if _, err := time.Parse(time.RFC3339, loaded.generatedAt); err != nil {
			t.Errorf("panel %s: generatedAt %q is not RFC 3339: %v", definition.id, loaded.generatedAt, err)
		}
		if len(loaded.data) == 0 || string(loaded.data) == "null" {
			t.Errorf("panel %s: shipped snapshot carries no payload", definition.id)
		}
	}
	entries, err := fs.ReadDir(snapshotFiles, "snapshots")
	if err != nil {
		t.Fatalf("list embedded snapshots: %v", err)
	}
	for _, entry := range entries {
		if name := "snapshots/" + entry.Name(); !claimed[name] {
			t.Errorf("embedded snapshot %s is not registered to any panel", name)
		}
	}
}

// TestBrokenSnapshotsServeUnavailable stages every failure class the gate
// must catch — absence, syntax, schema drift, wrong shapes, bad timestamps,
// trailing bytes, an unknown kind, and a body over the owner's budget — and
// requires the same outcome for each: construction succeeds and the panel
// serves a full-identity envelope with status unavailable and null data.
func TestBrokenSnapshotsServeUnavailable(t *testing.T) {
	t.Parallel()
	oversized := `{"generatedAt":"2026-08-10T21:15:00Z","data":{"account":"` +
		strings.Repeat("a", MaxPanelResponseBytes) + `","bosses":[]}}`
	for name, file := range map[string]*fstest.MapFile{
		"missing file":           nil,
		"invalid JSON":           {Data: []byte(`{"generatedAt":`)},
		"unknown document field": {Data: []byte(`{"generatedAt":"2026-08-10T21:15:00Z","surprise":1,"data":{"account":"x","bosses":[]}}`)},
		"unknown payload field":  {Data: []byte(`{"generatedAt":"2026-08-10T21:15:00Z","data":{"account":"x","bosses":[{"name":"b","kc":1,"rank":2,"pet":true}]}}`)},
		"wrong payload shape":    {Data: []byte(`{"generatedAt":"2026-08-10T21:15:00Z","data":{"account":"x","bosses":[{"name":"b","kc":"many","rank":2}]}}`)},
		"missing payload":        {Data: []byte(`{"generatedAt":"2026-08-10T21:15:00Z"}`)},
		"bad generatedAt":        {Data: []byte(`{"generatedAt":"yesterday","data":{"account":"x","bosses":[]}}`)},
		"trailing bytes":         {Data: []byte(`{"generatedAt":"2026-08-10T21:15:00Z","data":{"account":"x","bosses":[]}} {}`)},
		"over the panel budget":  {Data: []byte(oversized)},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			fsys := fstest.MapFS{}
			if file != nil {
				fsys["snapshots/broken.json"] = file
			}
			definition := panelDefinition{
				id:     "broken",
				kind:   KindBossLog,
				title:  "Broken",
				source: SnapshotSource{Name: "snapshots/broken.json"},
			}
			assertServesUnavailable(t, newRegistry(fsys, []panelDefinition{definition}), definition)
		})
	}

	t.Run("unknown kind", func(t *testing.T) {
		t.Parallel()
		fsys := fstest.MapFS{"snapshots/broken.json": {Data: validSnapshot(t)}}
		definition := panelDefinition{
			id:     "broken",
			kind:   "mystery/v1",
			title:  "Broken",
			source: SnapshotSource{Name: "snapshots/broken.json"},
		}
		assertServesUnavailable(t, newRegistry(fsys, []panelDefinition{definition}), definition)
	})
}

// assertServesUnavailable requires the definition's panel to answer with the
// unavailable envelope — identity intact, no timestamp, null data — and the
// index row to mirror the status.
func assertServesUnavailable(t *testing.T, registry *Registry, definition panelDefinition) {
	t.Helper()
	envelope := decodePanelEnvelope(t, registry, definition.id)
	if envelope.Status != StatusUnavailable {
		t.Fatalf("status = %q, want %q", envelope.Status, StatusUnavailable)
	}
	if envelope.Schema != EnvelopeSchema || envelope.ID != definition.id || envelope.Kind != definition.kind || envelope.Title != definition.title {
		t.Errorf("unavailable envelope lost its identity: %+v", envelope)
	}
	if envelope.GeneratedAt != "" {
		t.Errorf("unavailable envelope claims generatedAt %q", envelope.GeneratedAt)
	}
	if string(envelope.Data) != "null" {
		t.Errorf("unavailable data = %s, want null", envelope.Data)
	}
	index := decodeIndex(t, registry)
	if len(index.Panels) != 1 || index.Panels[0].Status != StatusUnavailable {
		t.Errorf("index rows = %+v, want one unavailable row", index.Panels)
	}
}

// decodePanelEnvelope fetches and strictly decodes one panel response over
// the handler, so assertions exercise the same bytes a visitor receives.
func decodePanelEnvelope(t *testing.T, registry *Registry, id string) Envelope {
	t.Helper()
	response := httptest.NewRecorder()
	registry.ServeHTTP(response, httptest.NewRequest(http.MethodGet, PanelPathPrefix+id, nil))
	if response.Code != http.StatusOK {
		t.Fatalf("GET %s = %d", PanelPathPrefix+id, response.Code)
	}
	var envelope Envelope
	if err := decodeStrict(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	return envelope
}

// decodeIndex fetches and strictly decodes the index response.
func decodeIndex(t *testing.T, registry *Registry) Index {
	t.Helper()
	response := httptest.NewRecorder()
	registry.ServeHTTP(response, httptest.NewRequest(http.MethodGet, IndexPath, nil))
	if response.Code != http.StatusOK {
		t.Fatalf("GET %s = %d", IndexPath, response.Code)
	}
	var index Index
	if err := decodeStrict(response.Body.Bytes(), &index); err != nil {
		t.Fatalf("decode index: %v", err)
	}
	return index
}

// TestConstructionReadsEachSnapshotExactlyOnce verifies the prepared-table
// contract by observed calls, not implementation trust: construction reads
// every snapshot exactly once, and no request — index, panel, miss, or
// refused method — ever reaches the filesystem again.
func TestConstructionReadsEachSnapshotExactlyOnce(t *testing.T) {
	t.Parallel()
	fsys := &countingFS{files: fstest.MapFS{
		"snapshots/one.json": {Data: validSnapshot(t)},
		"snapshots/two.json": {Data: validSnapshot(t)},
	}}
	registry := newRegistry(fsys, []panelDefinition{
		{id: "one", kind: KindBossLog, title: "One", source: SnapshotSource{Name: "snapshots/one.json"}},
		{id: "two", kind: KindBossLog, title: "Two", source: SnapshotSource{Name: "snapshots/two.json"}},
	})
	want := []string{"snapshots/one.json", "snapshots/two.json"}
	constructionReads := fsys.recordedReads()
	if len(constructionReads) != len(want) {
		t.Fatalf("construction reads = %v, want each of %v exactly once", constructionReads, want)
	}
	for i := range want {
		if constructionReads[i] != want[i] {
			t.Fatalf("construction reads = %v, want each of %v exactly once", constructionReads, want)
		}
	}

	for _, target := range []string{IndexPath, PanelPathPrefix + "one", PanelPathPrefix + "two", PanelPathPrefix + "missing"} {
		response := httptest.NewRecorder()
		registry.ServeHTTP(response, httptest.NewRequest(http.MethodGet, target, nil))
	}
	refused := httptest.NewRecorder()
	registry.ServeHTTP(refused, httptest.NewRequest(http.MethodPost, IndexPath, nil))
	if got := fsys.recordedReads(); len(got) != len(constructionReads) {
		t.Fatalf("request handling read from the filesystem: reads grew from %v to %v", constructionReads, got)
	}
}

// TestSnapshotDataSurvivesCanonicalization pins that a snapshot's semantics
// — including an explicit null kill count — survive the strict decode and
// canonical re-marshal that produce the served bytes.
func TestSnapshotDataSurvivesCanonicalization(t *testing.T) {
	t.Parallel()
	raw := json.RawMessage(`{"account":"x","bosses":[{"name":"a","kc":null,"rank":null},{"name":"b","kc":5,"rank":9,"score":2}]}`)
	canonical, err := decodeKindPayload(KindBossLog, raw)
	if err != nil {
		t.Fatalf("decodeKindPayload() error = %v", err)
	}
	var payload BossLogData
	if err := decodeStrict(canonical, &payload); err != nil {
		t.Fatalf("re-decode canonical payload: %v", err)
	}
	if payload.Bosses[0].KC != nil || payload.Bosses[0].Rank != nil {
		t.Errorf("null kc/rank did not survive canonicalization: %+v", payload.Bosses[0])
	}
	if payload.Bosses[0].Score != nil {
		t.Errorf("absent score materialized: %+v", payload.Bosses[0])
	}
	if payload.Bosses[1].KC == nil || *payload.Bosses[1].KC != 5 || payload.Bosses[1].Score == nil || *payload.Bosses[1].Score != 2 {
		t.Errorf("present values did not survive canonicalization: %+v", payload.Bosses[1])
	}
}
