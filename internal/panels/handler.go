// handler.go serves the prepared registry over HTTP. Both public routes —
// the index and each panel envelope — answer from memory: an atomic load and
// a prepared byte slice. Conditional requests are answered with a manual
// validator compare and a PLAIN WRITE: panel JSON deliberately does not
// participate in byte-range serving (a pinned decision — these are small
// whole documents, and dropping ServeContent removes 206 semantics from the
// API surface and keeps the hot path a single memory copy).

package panels

import (
	"net/http"
	"strconv"
	"strings"
)

// ServeHTTP answers GET /api/panels with the prepared index and
// GET /api/panels/<id> with that panel's prepared envelope. Unknown, nested,
// and empty ids all miss the prepared table, so every invalid shape shares
// one indistinguishable 404; ambiguous paths never arrive because the site
// rejects them before routing.
func (reg *Registry) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		// The same read-only refusal every other route gives: panels are
		// display data, and no request may ever mutate them (the 0-RTT
		// safety contract in internal/server extends here unchanged).
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if r.URL.Path == IndexPath {
		reg.index.Load().serveTo(w, r)
		return
	}
	state, ok := reg.byID[strings.TrimPrefix(r.URL.Path, PanelPathPrefix)]
	if !ok {
		http.NotFound(w, r)
		return
	}
	state.current.Load().response.serveTo(w, r)
}

// serveTo writes the prepared response in the site's revalidated no-cache
// class. A replayed validator answers an empty 304; everything else gets the
// complete body in one write. Range headers are deliberately ignored — the
// response is always the whole document, and no Accept-Ranges is offered.
func (p *preparedResponse) serveTo(w http.ResponseWriter, r *http.Request) {
	header := w.Header()
	header.Set("Cache-Control", "no-cache")
	header.Set("Content-Type", "application/json")
	header.Set("ETag", p.etag)
	if etagMatches(r.Header.Get("If-None-Match"), p.etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	header.Set("Content-Length", strconv.Itoa(len(p.body)))
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(p.body)
	}
}

// etagMatches implements the If-None-Match compare for the strong digest
// validators this package serves: any listed entry — weak-prefixed or not —
// whose opaque value equals the current ETag matches, as does "*".
func etagMatches(headerValue, etag string) bool {
	if headerValue == "" {
		return false
	}
	for _, candidate := range strings.Split(headerValue, ",") {
		candidate = strings.TrimSpace(candidate)
		candidate = strings.TrimPrefix(candidate, "W/")
		if candidate == etag || candidate == "*" {
			return true
		}
	}
	return false
}
