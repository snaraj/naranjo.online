// snapshot.go implements the embedded-snapshot source: panel data captured
// out-of-band, shipped inside the binary, and read plus strictly validated
// exactly once at registry construction. The request path never sees this
// file's code again.

package panels

import (
	"fmt"
	"io/fs"
	"time"
)

// load reads the named snapshot and admits it through the shared strict
// gate: unknown fields, trailing bytes, a malformed timestamp, or a payload
// that does not match the panel's kind all fail here — at construction —
// and the registry serves that panel as unavailable instead.
func (s SnapshotSource) load(fsys fs.FS, kind string) (loadedPayload, error) {
	raw, err := fs.ReadFile(fsys, s.Name)
	if err != nil {
		return loadedPayload{}, fmt.Errorf("read snapshot %s: %w", s.Name, err)
	}
	var document snapshotDocument
	if err := decodeStrict(raw, &document); err != nil {
		return loadedPayload{}, fmt.Errorf("parse snapshot %s: %w", s.Name, err)
	}
	if _, err := time.Parse(time.RFC3339, document.GeneratedAt); err != nil {
		return loadedPayload{}, fmt.Errorf("snapshot %s generatedAt: %w", s.Name, err)
	}
	data, err := decodeKindPayload(kind, document.Data)
	if err != nil {
		return loadedPayload{}, fmt.Errorf("snapshot %s payload: %w", s.Name, err)
	}
	return loadedPayload{generatedAt: document.GeneratedAt, data: data}, nil
}
