package web_test

import (
	"mime"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/snaraj/naranjo.online/internal/server"
	website "github.com/snaraj/naranjo.online/internal/web"
)

// TestBuiltFrontendServesThePrivacyNoticeAndSecurityTxt pins the two public
// files of issue 355: the privacy notice the page links is served as a page,
// and the RFC 9116 file names a contact and is current. The expiry window is
// the renewal reminder: once Expires is under 30 days away this fails, and the
// fix is a new date in frontend/public/.well-known/security.txt.
func TestBuiltFrontendServesThePrivacyNoticeAndSecurityTxt(t *testing.T) {
	assets, err := website.FileSystem()
	if err != nil {
		t.Fatalf("FileSystem() error = %v", err)
	}
	siteHandler, err := server.New(assets)
	if err != nil {
		t.Fatalf("server.New() error = %v; run the pinned frontend build before Go tests", err)
	}

	for publicPath, want := range map[string]string{
		"/privacy.html":             "text/html",
		"/.well-known/security.txt": "text/plain",
	} {
		answer := httptest.NewRecorder()
		siteHandler.ServeHTTP(answer, edgeRequest(http.MethodGet, publicPath))
		if answer.Code != http.StatusOK {
			t.Fatalf("%s status = %d; the build did not embed it", publicPath, answer.Code)
		}
		got, _, err := mime.ParseMediaType(answer.Header().Get("Content-Type"))
		if err != nil || got != want {
			t.Errorf("%s Content-Type = %q, want %s", publicPath, answer.Header().Get("Content-Type"), want)
		}
		assertServedFile(t, siteHandler, publicPath, "no-cache")
	}

	answer := httptest.NewRecorder()
	siteHandler.ServeHTTP(answer, edgeRequest(http.MethodGet, "/.well-known/security.txt"))
	fields := make(map[string]string)
	for _, line := range strings.Split(answer.Body.String(), "\n") {
		if name, value, ok := strings.Cut(line, ":"); ok {
			fields[strings.ToLower(strings.TrimSpace(name))] = strings.TrimSpace(value)
		}
	}
	if !strings.HasPrefix(fields["contact"], "https://") {
		t.Errorf("security.txt Contact = %q, want an https URL", fields["contact"])
	}
	expires, err := time.Parse(time.RFC3339, fields["expires"])
	if err != nil {
		t.Fatalf("security.txt Expires = %q: %v", fields["expires"], err)
	}
	if left := time.Until(expires); left < 30*24*time.Hour || left > 366*24*time.Hour {
		t.Errorf("security.txt Expires %s is %s away; keep it between 30 days and a year ahead (RFC 9116) by renewing the date", fields["expires"], left.Round(time.Hour))
	}
}
