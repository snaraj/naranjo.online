// Package panels serves the versioned read-only panel API: one stable
// envelope per panel under /api/panels, prepared entirely at construction so
// the request path is memory-only. Data arrives through Source
// implementations — embedded snapshots today, a defined-but-disabled fetch
// contract later — and every payload passes one strict validation gate
// before a byte of it can be served.
package panels

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
)

// New prepares the production registry: the explicit builtin panel list
// loaded from the embedded snapshots. Construction cannot fail — a missing
// or invalid snapshot degrades that panel to StatusUnavailable — so a bad
// data file can never keep the site from serving.
func New() *Registry {
	return newRegistry(snapshotFiles, builtinPanels)
}

// newRegistry loads every definition's source exactly once and precomputes
// each complete HTTP response — envelope bytes plus digest ETag — so serving
// never touches a source, a filesystem, or an encoder again.
func newRegistry(fsys fs.FS, definitions []panelDefinition) *Registry {
	index := Index{Panels: make([]IndexEntry, 0, len(definitions))}
	prepared := make(map[string]preparedResponse, len(definitions))
	for _, definition := range definitions {
		envelope := definition.load(fsys)
		body, err := json.Marshal(envelope)
		if err != nil || len(body) > MaxPanelResponseBytes {
			// Marshaling package-owned structs with gate-validated RawMessage
			// data cannot fail today; the branch exists so a future payload
			// mistake — or a body over the owner's budget — degrades to
			// unavailable instead of panicking or serving an oversized
			// response. The unavailable envelope is plain strings and a nil
			// payload, so its own marshal is infallible.
			envelope = definition.unavailable()
			body, _ = json.Marshal(envelope)
		}
		prepared[definition.id] = newPreparedResponse(body)
		index.Panels = append(index.Panels, IndexEntry{
			ID:     definition.id,
			Kind:   definition.kind,
			Title:  definition.title,
			Status: envelope.Status,
		})
	}
	// The index is assembled from the plain rows above; its marshal is
	// infallible for the same reason as the unavailable envelope.
	indexBody, _ := json.Marshal(index)
	return &Registry{index: newPreparedResponse(indexBody), panels: prepared}
}

// load assembles the definition's envelope from its source. Every load
// failure — missing file, loose field, wrong shape, bad timestamp — collapses
// into the same unavailable envelope, keeping identity on the wire while the
// cause stays in the construction log of whoever ships the next snapshot.
func (d panelDefinition) load(fsys fs.FS) Envelope {
	loaded, err := d.source.load(fsys, d.kind)
	if err != nil {
		return d.unavailable()
	}
	return Envelope{
		Schema:      EnvelopeSchema,
		ID:          d.id,
		Kind:        d.kind,
		Title:       d.title,
		GeneratedAt: loaded.generatedAt,
		Status:      StatusOK,
		Data:        loaded.data,
	}
}

// unavailable is the fail-soft envelope: full identity, no timestamp, and a
// nil payload that marshals as JSON null.
func (d panelDefinition) unavailable() Envelope {
	return Envelope{Schema: EnvelopeSchema, ID: d.id, Kind: d.kind, Title: d.title, Status: StatusUnavailable}
}

// newPreparedResponse derives the response identity for one prepared body,
// using the same digest-based strong ETag scheme as the embedded frontend so
// every replica presents the same cache identity for the same bytes.
func newPreparedResponse(body []byte) preparedResponse {
	sum := sha256.Sum256(body)
	return preparedResponse{body: body, etag: `"` + hex.EncodeToString(sum[:]) + `"`}
}
