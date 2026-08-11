// handler.go serves the prepared registry over HTTP. Both public routes —
// the index and each panel envelope — answer from memory: a map lookup and a
// prepared byte slice, with conditional-request and HEAD semantics delegated
// to net/http exactly as the embedded frontend does.

package panels

import (
	"bytes"
	"net/http"
	"strings"
	"time"
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
		reg.index.serveTo(w, r)
		return
	}
	prepared, ok := reg.panels[strings.TrimPrefix(r.URL.Path, PanelPathPrefix)]
	if !ok {
		http.NotFound(w, r)
		return
	}
	prepared.serveTo(w, r)
}

// serveTo applies the prepared cache metadata and delegates conditional and
// HEAD behavior to net/http. Panel data changes with each shipped snapshot,
// so it joins the site's revalidated no-cache class: storable, but every use
// must revalidate — an unchanged panel answers with a small 304.
func (p preparedResponse) serveTo(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", p.etag)
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(p.body))
}
