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
