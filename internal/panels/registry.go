// Package panels serves the versioned read-only panel API: one stable
// envelope per panel under /api/panels, prepared entirely off the request
// path so serving is memory-only. Data arrives through Source
// implementations — embedded snapshots, and background-refreshed live
// fetches for the panels the owner wants fresh — and every payload passes
// one strict validation gate before a byte of it can be served.
package panels

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
)

// New prepares the production registry: the explicit builtin panel list
// loaded from the embedded snapshots (fetch-backed panels start on their
// snapshot fallback as stale). Construction cannot fail — a missing or
// invalid data file degrades that panel to StatusUnavailable — so a bad
// data file can never keep the site from serving. No network activity
// exists until StartRefresh is explicitly called.
func New() *Registry {
	return newRegistry(snapshotFiles, builtinPanels)
}

// newRegistry loads every definition's source exactly once and precomputes
// each complete HTTP response — envelope bytes plus digest ETag — so serving
// never touches a source, a filesystem, or an encoder on a request.
func newRegistry(fsys fs.FS, definitions []panelDefinition) *Registry {
	reg := &Registry{byID: make(map[string]*panelState, len(definitions))}
	for _, definition := range definitions {
		state := &panelState{definition: definition}
		if fetch, ok := definition.source.(*FetchSource); ok {
			state.fetch = fetch
		}
		loaded, err := definition.source.load(fsys, definition.kind)
		if err != nil {
			loaded = loadedPayload{status: StatusUnavailable}
		}
		served, err := definition.prepare(loaded)
		if err != nil {
			// The construction-time degrade: an oversized or unmarshalable
			// payload serves as unavailable rather than crashing or busting
			// the owner's budget. The unavailable envelope is plain strings
			// and a nil payload, so its own preparation is infallible.
			served, _ = definition.prepare(loadedPayload{status: StatusUnavailable})
		}
		state.current.Store(served)
		reg.states = append(reg.states, state)
		reg.byID[definition.id] = state
	}
	reg.rebuildIndex()
	return reg
}

// prepare assembles and marshals the definition's envelope for one loaded
// payload, refusing bodies over the owner's panel budget so callers decide
// whether to degrade (construction) or keep last-good (refresh).
func (d panelDefinition) prepare(loaded loadedPayload) (*servedPanel, error) {
	envelope := Envelope{
		Schema:      EnvelopeSchema,
		ID:          d.id,
		Kind:        d.kind,
		Title:       d.title,
		GeneratedAt: loaded.generatedAt,
		Status:      loaded.status,
		Data:        loaded.data,
	}
	body, err := json.Marshal(envelope)
	if err != nil || len(body) > MaxPanelResponseBytes {
		// Marshaling package-owned structs with gate-validated RawMessage
		// data cannot fail today; the branch exists so a future payload
		// mistake — or a body over the owner's budget — is refused here
		// instead of served.
		return nil, errors.New("panel envelope refused: over budget or unmarshalable")
	}
	return &servedPanel{payload: loaded, response: newPreparedResponse(body)}, nil
}

// rebuildIndex re-derives the prepared index from every panel's current
// status. It runs at construction and after every refresh transition,
// serialized so concurrent refreshers cannot interleave partial listings.
// The index budget is structural: a listing that exceeds the owner's 4 KiB
// budget is replaced by an empty one — loudly wrong and instantly caught by
// tests, never an oversized response on the wire. The final marshal is of
// plain rows and cannot fail.
func (reg *Registry) rebuildIndex() {
	reg.mu.Lock()
	defer reg.mu.Unlock()
	index := Index{Panels: make([]IndexEntry, 0, len(reg.states))}
	for _, state := range reg.states {
		current := state.current.Load()
		index.Panels = append(index.Panels, IndexEntry{
			ID:     state.definition.id,
			Kind:   state.definition.kind,
			Title:  state.definition.title,
			Status: current.payload.status,
		})
	}
	body, err := json.Marshal(index)
	if err != nil || len(body) > MaxIndexResponseBytes {
		body, _ = json.Marshal(Index{Panels: []IndexEntry{}})
	}
	prepared := newPreparedResponse(body)
	reg.index.Store(&prepared)
}

// newPreparedResponse derives the response identity for one prepared body,
// using the same digest-based strong ETag scheme as the embedded frontend so
// every replica presents the same cache identity for the same bytes.
func newPreparedResponse(body []byte) preparedResponse {
	sum := sha256.Sum256(body)
	return preparedResponse{body: body, etag: `"` + hex.EncodeToString(sum[:]) + `"`}
}
