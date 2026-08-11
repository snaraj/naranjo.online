// utils.go holds the small utilities genuinely shared across this package's
// logic files. Only cross-cutting helpers belong here; anything specific to
// frontend serving or media delivery stays in server.go or media.go.

package server

import "net/http"

// allowReadMethod enforces the read-only contract shared by site and probe
// routes. Rejecting mutation methods closes an unnecessary attack surface.
func allowReadMethod(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		return true
	}
	w.Header().Set("Allow", "GET, HEAD")
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	return false
}
