package panels

// capture_snapshot_test.go is the DOCUMENTED producer path for refreshing the
// embedded snapshots: it runs the shipped configuration's real producers once,
// against the real upstream, and writes the answer in the snapshot file's own
// shape. It exists as a test so it runs under the same package, the same
// admission and the same bounds the serving path does — a snapshot captured
// any other way is a document nothing validated.
//
// It is SKIPPED unless PANELS_CAPTURE names a panel, so the ordinary suite
// never egresses. The credential is read from the environment by the producer
// itself, exactly as it is in a cluster; no test here ever sees its value.
//
//	env GITHUB_PANELS_TOKEN="$(gh auth token)" PANELS_CAPTURE=vcs-activity \
//	  go test ./internal/panels -run TestCaptureSnapshot -count=1
//
// The token-usage snapshot has no upstream to read: its producer is the
// workstation export. PANELS_CAPTURE=token-usage with PANELS_CAPTURE_SERIES
// naming a plaintext usage-series/v1 document (the export the sealed push
// carries) runs that document through the data root's own admission, merge
// and budget — publishSealed, with an identity unsealer — and writes what the
// origin would serve (issue #358: the repository's copy of the data).

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestCaptureSnapshot(t *testing.T) {
	want := os.Getenv("PANELS_CAPTURE")
	if want == "" {
		t.Skip("PANELS_CAPTURE is unset; the capture path never runs in the ordinary suite")
	}
	if want == "token-usage" {
		captureTokenUsageSnapshot(t, os.Getenv("PANELS_CAPTURE_SERIES"))
		return
	}
	document, bounds, err := loadFetchConfig(fetchConfigBytes)
	if err != nil {
		t.Fatalf("shipped config refused: %v", err)
	}
	var specs panelFetchSpecs
	var file string
	switch want {
	case "vcs-activity":
		specs, file = panelFetchSpecs{vcs: document.VCSActivity}, "snapshots/vcs-activity.json"
	case "coding-projects":
		specs, file = panelFetchSpecs{projects: document.CodingProjects}, "snapshots/coding-projects.json"
	default:
		t.Fatalf("PANELS_CAPTURE=%q names no capturable panel", want)
	}
	source, err := NewFetchSource(SnapshotSource{Name: file}, bounds, specs)
	if err != nil {
		t.Fatalf("build source: %v", err)
	}
	loaded, err := source.refresh(t.Context(), newProductionDoer(), os.Getenv)
	if err != nil {
		t.Fatalf("live refresh: %v", err)
	}
	if loaded.status != StatusOK {
		t.Fatalf("live refresh reported %q; a snapshot is only captured from a complete round", loaded.status)
	}
	if want == "vcs-activity" {
		// The calendar's commit half can be omitted while the calendar is
		// served, and its closed reason otherwise reaches only the serving
		// log; a capture says which, so a dash in the snapshot has a cause.
		source.mu.Lock()
		omitted := source.commitOmission
		source.mu.Unlock()
		if omitted != "" {
			t.Logf("captured without the commit half: %s", omitted)
		}
	}
	data := loaded.data
	if want == "coding-projects" {
		// A snapshot row is a RECORDED row by definition: it is the shipped
		// cold-start face, read at capture time and not at serve time, and the
		// provenance flag is what keeps the page from presenting it as a live
		// read. The live round does not set it — nothing live is recorded —
		// so the capture does.
		var payload CodingProjectsData
		if err := decodeStrict(data, &payload); err != nil {
			t.Fatalf("re-read captured payload: %v", err)
		}
		for index := range payload.Repos {
			payload.Repos[index].Recorded = true
		}
		if data, err = json.Marshal(payload); err != nil {
			t.Fatalf("re-encode captured payload: %v", err)
		}
	}
	var pretty bytes.Buffer
	if err := json.Indent(&pretty, data, "    ", "  "); err != nil {
		t.Fatalf("indent payload: %v", err)
	}
	captured := "{\n  \"generatedAt\": \"" + time.Now().UTC().Format(time.RFC3339) + "\",\n  \"data\": " + pretty.String() + "\n}\n"
	if err := os.WriteFile(file, []byte(captured), 0o644); err != nil {
		t.Fatalf("write %s: %v", file, err)
	}
	t.Logf("captured %s (%d bytes)", file, len(captured))
}

// captureTokenUsageSnapshot admits one exported series document exactly as
// the data root would over the shipped snapshot, and writes the served
// payload back as that snapshot. The floor is the shipped snapshot's own
// instant, so a document no newer than the release is refused here too.
func captureTokenUsageSnapshot(t *testing.T, series string) {
	if series == "" {
		t.Fatal("PANELS_CAPTURE=token-usage needs PANELS_CAPTURE_SERIES naming the exported usage-series/v1 document")
	}
	document, err := os.ReadFile(series)
	if err != nil {
		t.Fatalf("read the exported document: %v", err)
	}
	const file = "snapshots/token-usage.json"
	reg := newRegistry(snapshotFiles, []panelDefinition{{
		id:     dataRootPanelID,
		kind:   KindTokenUsageV2,
		title:  "Token usage",
		source: SnapshotSource{Name: file},
	}})
	state := reg.byID[dataRootPanelID]
	plain := func(sealed []byte) ([]byte, error) { return sealed, nil }
	floor := FloorState{Instant: reg.embeddedUsageInstant(state)}
	if _, err := reg.publishSealed(state, document, plain, time.Now, floor, false, nil, nil, false); err != nil {
		t.Fatalf("the exported document was refused by the data root's own admission: %v", err)
	}
	served := state.current.Load().payload
	var pretty bytes.Buffer
	if err := json.Indent(&pretty, served.data, "  ", "  "); err != nil {
		t.Fatalf("indent payload: %v", err)
	}
	captured := "{\n  \"generatedAt\": \"" + served.generatedAt + "\",\n  \"data\": " + pretty.String() + "\n}\n"
	if err := os.WriteFile(file, []byte(captured), 0o644); err != nil {
		t.Fatalf("write %s: %v", file, err)
	}
	t.Logf("captured %s (%d bytes, data through the capture at %s)", file, len(captured), served.generatedAt)
}
