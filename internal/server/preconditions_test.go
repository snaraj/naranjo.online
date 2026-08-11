// preconditions_test pins the hand-written RFC 9110 conditional-request logic
// that decides when an abusive Range header may be answered with the
// application's 416 and when a standard precondition outcome (200, 304, 412)
// must win instead. This is the one place the service reimplements protocol
// semantics rather than delegating to net/http, so every branch is locked by
// a request-level matrix plus direct tables for the two pure validators.
package server

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

// abusiveRange exceeds maxRangeParts so rangeHeaderIsAbusive always fires,
// letting each matrix row observe whether preconditions neutralize it.
var abusiveRange = "bytes=" + strings.Repeat("0-0,", maxRangeParts) + "0-0"

// preconditionFixture builds a media-enabled site with one immutable file
// (digest ETag plus a fixed modification time) and one mutable file (no
// validator at all). Concurrency is deliberately generous so parallel matrix
// rows can never exhaust transfer slots and observe a 503 instead of the
// conditional outcome under test.
func preconditionFixture(t *testing.T) *Site {
	t.Helper()
	root := t.TempDir()
	for _, directory := range []string{
		filepath.Join(root, "immutable", testMediaDigest),
		filepath.Join(root, "mutable"),
	} {
		if err := os.MkdirAll(directory, 0o750); err != nil {
			t.Fatalf("MkdirAll() error = %v", err)
		}
	}
	modified := time.Unix(1_700_000_000, 0).UTC()
	for name, content := range map[string]string{
		filepath.Join(root, "immutable", testMediaDigest, "clip.mp4"): "0123456789",
		filepath.Join(root, "mutable", "song.flac"):                   "fLaCdata",
	} {
		if err := os.WriteFile(name, []byte(content), 0o640); err != nil {
			t.Fatalf("WriteFile() error = %v", err)
		}
		if err := os.Chtimes(name, modified, modified); err != nil {
			t.Fatalf("Chtimes() error = %v", err)
		}
	}
	assets := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<!doctype html><h1>Hello World!</h1>")}}
	site, err := NewWithMedia(assets, MediaOptions{Root: root, MaxConcurrent: 64})
	if err != nil {
		t.Fatalf("NewWithMedia() error = %v", err)
	}
	t.Cleanup(func() {
		if err := site.Close(); err != nil {
			t.Errorf("Close() error = %v", err)
		}
	})
	return site
}

// TestMediaPreconditionsGovernAbusiveRanges is the request-level matrix: for
// every conditional-header shape, an abusive Range header must produce the
// protocol-correct status — 416 only when the range would truly be evaluated,
// and the standard 200, 304, or 412 whenever a precondition makes the Range
// header semantically inactive. A regression here would let a hostile client
// swap cheap cached 304s for full transfers, or break real resume behavior.
func TestMediaPreconditionsGovernAbusiveRanges(t *testing.T) {
	t.Parallel()
	site := preconditionFixture(t)
	immutableURL := "/media/immutable/" + testMediaDigest + "/clip.mp4"
	mutableURL := "/media/mutable/song.flac"
	etag := `"` + testMediaDigest + `"`
	modified := time.Unix(1_700_000_000, 0).UTC()

	for name, row := range map[string]struct {
		url     string
		headers map[string]string
		want    int
	}{
		// No precondition: the abusive range itself is the terminal outcome.
		"no preconditions":            {url: immutableURL, want: http.StatusRequestedRangeNotSatisfiable},
		"no preconditions on mutable": {url: mutableURL, want: http.StatusRequestedRangeNotSatisfiable},

		// If-Match: a failed match must surface as the standard 412.
		"failed If-Match":               {url: immutableURL, headers: map[string]string{"If-Match": `"stale"`}, want: http.StatusPreconditionFailed},
		"matching If-Match":             {url: immutableURL, headers: map[string]string{"If-Match": etag}, want: http.StatusRequestedRangeNotSatisfiable},
		"matching If-Match in list":     {url: immutableURL, headers: map[string]string{"If-Match": `"stale", ` + etag}, want: http.StatusRequestedRangeNotSatisfiable},
		"wildcard If-Match":             {url: immutableURL, headers: map[string]string{"If-Match": "*"}, want: http.StatusRequestedRangeNotSatisfiable},
		"weak If-Match is never strong": {url: immutableURL, headers: map[string]string{"If-Match": "W/" + etag}, want: http.StatusPreconditionFailed},
		"If-Match without a validator":  {url: mutableURL, headers: map[string]string{"If-Match": `"anything"`}, want: http.StatusPreconditionFailed},

		// If-Unmodified-Since applies only when a modification time exists.
		"violated If-Unmodified-Since":            {url: immutableURL, headers: map[string]string{"If-Unmodified-Since": modified.Add(-time.Hour).Format(http.TimeFormat)}, want: http.StatusPreconditionFailed},
		"satisfied If-Unmodified-Since":           {url: immutableURL, headers: map[string]string{"If-Unmodified-Since": modified.Add(time.Hour).Format(http.TimeFormat)}, want: http.StatusRequestedRangeNotSatisfiable},
		"If-Unmodified-Since without a timestamp": {url: mutableURL, headers: map[string]string{"If-Unmodified-Since": modified.Format(http.TimeFormat)}, want: http.StatusRequestedRangeNotSatisfiable},

		// If-None-Match: a cache hit must stay a cheap 304.
		"matching If-None-Match":          {url: immutableURL, headers: map[string]string{"If-None-Match": etag}, want: http.StatusNotModified},
		"weak If-None-Match":              {url: immutableURL, headers: map[string]string{"If-None-Match": "W/" + etag}, want: http.StatusNotModified},
		"wildcard If-None-Match":          {url: immutableURL, headers: map[string]string{"If-None-Match": "*"}, want: http.StatusNotModified},
		"listed If-None-Match":            {url: immutableURL, headers: map[string]string{"If-None-Match": `"stale", ` + etag}, want: http.StatusNotModified},
		"missing If-None-Match":           {url: immutableURL, headers: map[string]string{"If-None-Match": `"stale"`}, want: http.StatusRequestedRangeNotSatisfiable},
		"If-None-Match without validator": {url: mutableURL, headers: map[string]string{"If-None-Match": `"anything"`}, want: http.StatusRequestedRangeNotSatisfiable},

		// If-Modified-Since mirrors 304 semantics for date validators.
		"unmodified If-Modified-Since": {url: immutableURL, headers: map[string]string{"If-Modified-Since": modified.Format(http.TimeFormat)}, want: http.StatusNotModified},
		"stale If-Modified-Since":      {url: immutableURL, headers: map[string]string{"If-Modified-Since": modified.Add(-time.Hour).Format(http.TimeFormat)}, want: http.StatusRequestedRangeNotSatisfiable},

		// If-Range: only an exact validator match keeps the range active; any
		// mismatch silently downgrades to a full 200 response.
		"matching If-Range etag":      {url: immutableURL, headers: map[string]string{"If-Range": etag}, want: http.StatusRequestedRangeNotSatisfiable},
		"mismatched If-Range etag":    {url: immutableURL, headers: map[string]string{"If-Range": `"stale"`}, want: http.StatusOK},
		"weak If-Range etag":          {url: immutableURL, headers: map[string]string{"If-Range": "W/" + etag}, want: http.StatusOK},
		"If-Range etag without one":   {url: mutableURL, headers: map[string]string{"If-Range": `"anything"`}, want: http.StatusOK},
		"matching If-Range date":      {url: immutableURL, headers: map[string]string{"If-Range": modified.Format(http.TimeFormat)}, want: http.StatusRequestedRangeNotSatisfiable},
		"mismatched If-Range date":    {url: immutableURL, headers: map[string]string{"If-Range": modified.Add(-time.Hour).Format(http.TimeFormat)}, want: http.StatusOK},
		"If-Range date without one":   {url: mutableURL, headers: map[string]string{"If-Range": modified.Format(http.TimeFormat)}, want: http.StatusOK},
		"unparseable If-Range":        {url: immutableURL, headers: map[string]string{"If-Range": "yesterday-ish"}, want: http.StatusOK},
		"failed If-Match beats range": {url: immutableURL, headers: map[string]string{"If-Match": `"stale"`, "If-Range": etag}, want: http.StatusPreconditionFailed},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			request := httptest.NewRequest(http.MethodGet, row.url, nil)
			request.Header.Set("Range", abusiveRange)
			for header, value := range row.headers {
				request.Header.Set(header, value)
			}
			response := httptest.NewRecorder()
			site.ServeHTTP(response, request)
			if response.Code != row.want {
				t.Fatalf("status = %d, want %d (headers %v)", response.Code, row.want, row.headers)
			}
			if row.want == http.StatusRequestedRangeNotSatisfiable {
				if contentRange := response.Header().Get("Content-Range"); !strings.HasPrefix(contentRange, "bytes */") {
					t.Errorf("416 Content-Range = %q, want a bytes */<size> form", contentRange)
				}
			}
		})
	}
}

// TestClassifyMediaPath locks the complete publication-class grammar: exactly
// two cache classes exist, and every other shape — traversal, hidden or
// reserved segments, malformed digests, operator namespaces — is
// indistinguishable from a missing file.
func TestClassifyMediaPath(t *testing.T) {
	t.Parallel()
	digest := testMediaDigest
	for name, row := range map[string]struct {
		path      string
		wantOK    bool
		wantCache string
		wantETag  string
	}{
		"immutable file":        {path: "/media/immutable/" + digest + "/clip.mp4", wantOK: true, wantCache: "public, max-age=31536000, immutable", wantETag: `"` + digest + `"`},
		"immutable nested file": {path: "/media/immutable/" + digest + "/gallery/one.webp", wantOK: true, wantCache: "public, max-age=31536000, immutable", wantETag: `"` + digest + `"`},
		"mutable file":          {path: "/media/mutable/album/track.flac", wantOK: true, wantCache: "no-store"},

		"outside the media prefix": {path: "/other/mutable/x.mp4"},
		"bare prefix":              {path: "/media/"},
		"single segment":           {path: "/media/mutable"},
		"backslash":                {path: `/media/mutable\evil.mp4`},
		"NUL byte":                 {path: "/media/mutable/\x00.mp4"},
		"dot traversal":            {path: "/media/mutable/../escape.mp4"},
		"trailing slash":           {path: "/media/mutable/album/"},
		"hidden segment":           {path: "/media/mutable/.hidden/x.mp4"},
		"underscore segment":       {path: "/media/mutable/_private/x.mp4"},
		"reserved inner segment":   {path: "/media/mutable/ORIGINALS/x.mp4"},
		"unknown class":            {path: "/media/originals/x/y.mp4"},
		"immutable without a file": {path: "/media/immutable/" + digest},
		"immutable malformed hash": {path: "/media/immutable/DEADBEEF/x.mp4"},
		"immutable truncated hash": {path: "/media/immutable/" + digest[:63] + "/x.mp4"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			gotName, gotCache, gotETag, ok := classifyMediaPath(row.path)
			if ok != row.wantOK {
				t.Fatalf("classifyMediaPath(%q) ok = %t, want %t", row.path, ok, row.wantOK)
			}
			if !row.wantOK {
				if gotName != "" || gotCache != "" || gotETag != "" {
					t.Fatalf("rejected path leaked (%q, %q, %q)", gotName, gotCache, gotETag)
				}
				return
			}
			if want := strings.TrimPrefix(row.path, mediaPrefix); gotName != want {
				t.Errorf("name = %q, want %q", gotName, want)
			}
			if gotCache != row.wantCache {
				t.Errorf("cacheControl = %q, want %q", gotCache, row.wantCache)
			}
			if gotETag != row.wantETag {
				t.Errorf("etag = %q, want %q", gotETag, row.wantETag)
			}
		})
	}
}

// TestETagListMatches pins the validator-list comparison in isolation: strong
// comparison must refuse weak validators, weak comparison must accept them,
// the wildcard matches any current representation, and an absent validator
// matches nothing but the wildcard.
func TestETagListMatches(t *testing.T) {
	t.Parallel()
	current := `"` + testMediaDigest + `"`
	for name, row := range map[string]struct {
		value   string
		current string
		weak    bool
		want    bool
	}{
		"wildcard":                     {value: "*", current: current, want: true},
		"wildcard without a validator": {value: "*", current: "", weak: true, want: true},
		"exact strong match":           {value: current, current: current, want: true},
		"strong refuses weak":          {value: "W/" + current, current: current, want: false},
		"weak accepts weak":            {value: "W/" + current, current: current, weak: true, want: true},
		"weak accepts strong":          {value: current, current: current, weak: true, want: true},
		"weak mismatch":                {value: `W/"other"`, current: current, weak: true, want: false},
		"list hit":                     {value: `"stale", "older", ` + current, current: current, want: true},
		"weak list hit":                {value: `"stale", W/` + current, current: current, weak: true, want: true},
		"list miss":                    {value: `"stale", "older"`, current: current, want: false},
		"no current validator":         {value: `"anything"`, current: "", want: false},
		"no current weak":              {value: `"anything"`, current: "", weak: true, want: false},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if got := etagListMatches(row.value, row.current, row.weak); got != row.want {
				t.Fatalf("etagListMatches(%q, %q, %t) = %t, want %t", row.value, row.current, row.weak, got, row.want)
			}
		})
	}
}

// TestAbusiveRangeConstant guards the fixture itself: if maxRangeParts moves,
// the matrix must keep exceeding it or every row above would silently test
// nothing.
func TestAbusiveRangeConstant(t *testing.T) {
	t.Parallel()
	if !rangeHeaderIsAbusive(abusiveRange) {
		t.Fatalf("fixture range %q is not classified abusive", abusiveRange)
	}
	if rangeHeaderIsAbusive(fmt.Sprintf("bytes=0-%d", maxRangeHeaderBytes)) {
		t.Fatal("an ordinary single range must never be classified abusive")
	}
}
