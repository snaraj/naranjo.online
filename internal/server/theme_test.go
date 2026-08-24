// theme_test pins the reading-mode document mechanism (issue #22): stamped
// index.html variants are precomputed at construction with their own digest
// identities, the theme cookie selects among them with fail-closed grammar,
// and the request path performs no templating and no filesystem access —
// proven by pointer identity and the same read-counting fake the embed
// boundary uses.
package server

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/snaraj/naranjo.online/internal/testsupport"
)

// TestStampReadingTheme locks the stamping grammar: the data-theme attribute
// lands immediately after the <html> tag name with every existing attribute
// and all surrounding bytes preserved, and anything that is not real markup
// with a lowercase <html element is refused so construction fails closed.
func TestStampReadingTheme(t *testing.T) {
	t.Parallel()
	for name, row := range map[string]struct {
		document string
		theme    string
		want     string
		wantErr  bool
	}{
		"attributes preserved": {
			document: `<!doctype html><html lang="en"><body></body></html>`,
			theme:    "dark",
			want:     `<!doctype html><html data-theme="dark" lang="en"><body></body></html>`,
		},
		"bare html tag": {
			document: "<html>\n<body></body></html>",
			theme:    "sepia",
			want:     `<html data-theme="sepia">` + "\n<body></body></html>",
		},
		"newline before attributes": {
			document: "<html\n  lang=\"en\"></html>",
			theme:    "light",
			want:     `<html data-theme="light"` + "\n  lang=\"en\"></html>",
		},
		"no html element":   {document: `<!doctype html><main></main>`, theme: "dark", wantErr: true},
		"lookalike tag":     {document: `<htmlx><body></body></htmlx>`, theme: "dark", wantErr: true},
		"uppercase tag":     {document: `<HTML lang="en"></HTML>`, theme: "dark", wantErr: true},
		"truncated at html": {document: `<!doctype html><html`, theme: "dark", wantErr: true},
		"empty document":    {document: "", theme: "dark", wantErr: true},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			stamped, err := stampReadingTheme([]byte(row.document), row.theme)
			if row.wantErr {
				if err == nil {
					t.Fatalf("stampReadingTheme(%q) = %q, want a refusal", row.document, stamped)
				}
				return
			}
			if err != nil {
				t.Fatalf("stampReadingTheme(%q) error = %v", row.document, err)
			}
			if string(stamped) != row.want {
				t.Fatalf("stampReadingTheme(%q) = %q, want %q", row.document, stamped, row.want)
			}
		})
	}
}

// TestConstructionFailsClosedOnUnstampableIndex extends the broken-bundle
// doctrine to reading modes: an index.html without an <html> element can
// never become a ready pod, because its documents could never change theme
// and the failure would otherwise surface as a silent feature loss instead
// of a construction error.
func TestConstructionFailsClosedOnUnstampableIndex(t *testing.T) {
	t.Parallel()
	bundle := testsupport.FrontendFS()
	bundle["index.html"] = &fstest.MapFile{Data: []byte(`<!doctype html><main data-static-fallback>unstampable</main>`)}
	if site, err := New(bundle); err == nil {
		t.Fatalf("New() = %v, nil; want a refusal for an unstampable index.html", site)
	}
}

// TestReadingThemeVariantsPrecomputed proves the wiki mechanism's performance
// contract by observed identity, not implementation trust: construction
// prepares exactly one variant per registered theme, each with its own digest
// ETag and exactly one data-theme stamp; the default stays unstamped; and
// repeated selection returns the identical prepared *staticFile pointer —
// never a freshly templated response.
func TestReadingThemeVariantsPrecomputed(t *testing.T) {
	t.Parallel()
	h, err := newHandler(testsupport.FrontendFS())
	if err != nil {
		t.Fatalf("newHandler() error = %v", err)
	}

	if len(h.themed) != len(readingThemes) {
		t.Fatalf("prepared %d variants, want one per registered theme (%d)", len(h.themed), len(readingThemes))
	}
	seenETags := map[string]string{h.index.etag: "default"}
	if bytes.Contains(h.index.body, []byte("data-theme")) {
		t.Error("the default document must ship unstamped; its tokens follow prefers-color-scheme")
	}
	for _, theme := range readingThemes {
		variant, ok := h.themed[theme]
		if !ok {
			t.Fatalf("no prepared variant for registered theme %q", theme)
		}
		stamp := []byte(`data-theme="` + theme + `"`)
		if bytes.Count(variant.body, stamp) != 1 {
			t.Errorf("%s variant carries %d %q stamps, want exactly 1", theme, bytes.Count(variant.body, stamp), stamp)
		}
		if !bytes.Contains(variant.body, []byte(testsupport.FrontendShellSentinel)) {
			t.Errorf("%s variant lost the document body", theme)
		}
		if variant.cacheControl != "no-cache" {
			t.Errorf("%s variant Cache-Control = %q, want the revalidated document class", theme, variant.cacheControl)
		}
		if holder, duplicate := seenETags[variant.etag]; duplicate {
			t.Errorf("%s variant shares its ETag with %s; every representation needs its own validator", theme, holder)
		}
		seenETags[variant.etag] = theme

		request := httptest.NewRequest(http.MethodGet, "/", nil)
		request.AddCookie(&http.Cookie{Name: themeCookie, Value: theme})
		if h.documentVariant(request) != variant || h.documentVariant(request) != variant {
			t.Errorf("selection for %q did not return the one prepared variant pointer", theme)
		}
	}
	if h.documentVariant(httptest.NewRequest(http.MethodGet, "/", nil)) != h.index {
		t.Error("a cookieless request must select the prepared default pointer")
	}
}

// TestThemedDocumentNeverTouchesTheFilesystem extends the construction
// counting contract to reading modes: preparing every variant costs zero
// additional filesystem reads (stamping reuses the bytes already in memory),
// and no themed, default, hostile-cookie, or HEAD navigation reaches the
// filesystem afterwards.
func TestThemedDocumentNeverTouchesTheFilesystem(t *testing.T) {
	t.Parallel()
	fsys := &faultFS{files: testsupport.FrontendFS()}
	site, err := New(fsys)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	t.Cleanup(func() {
		if err := site.Close(); err != nil {
			t.Errorf("Close() error = %v", err)
		}
	})
	constructionReads := assertConstructionReads(t, fsys, constructionReadSet)

	cookies := append([]string{"", "browntown", "DARK"}, readingThemes...)
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		for _, value := range cookies {
			request := httptest.NewRequest(method, "/", nil)
			if value != "" {
				request.AddCookie(&http.Cookie{Name: themeCookie, Value: value})
			}
			site.ServeHTTP(httptest.NewRecorder(), request)
		}
	}
	if got := fsys.recordedReads(); !equalStrings(got, constructionReads) {
		t.Fatalf("themed document serving read from the filesystem: reads grew from %v to %v", constructionReads, got)
	}
}

// TestThemeCookieSelectsDocumentVariant is the fail-closed selection grammar
// over the full Site: exactly the registered ids select their stamped
// variant, and absence, case drift, unregistered names, and hostile values
// all collapse into the unstamped default document.
func TestThemeCookieSelectsDocumentVariant(t *testing.T) {
	t.Parallel()
	site := testHandler(t)
	for name, row := range map[string]struct {
		cookieHeader string
		wantTheme    string
	}{
		"no cookie":            {cookieHeader: "", wantTheme: ""},
		"light":                {cookieHeader: "theme=light", wantTheme: "light"},
		"dark":                 {cookieHeader: "theme=dark", wantTheme: "dark"},
		"sepia":                {cookieHeader: "theme=sepia", wantTheme: "sepia"},
		"among other cookies":  {cookieHeader: "a=1; theme=sepia; b=2", wantTheme: "sepia"},
		"first duplicate wins": {cookieHeader: "theme=dark; theme=sepia", wantTheme: "dark"},
		"case drift":           {cookieHeader: "theme=DARK", wantTheme: ""},
		"unregistered name":    {cookieHeader: "theme=browntown", wantTheme: ""},
		"empty value":          {cookieHeader: "theme=", wantTheme: ""},
		"valueless pair":       {cookieHeader: "theme", wantTheme: ""},
		"traversal garbage":    {cookieHeader: "theme=../../etc/passwd", wantTheme: ""},
		"markup garbage":       {cookieHeader: "theme=<script>alert(1)</script>", wantTheme: ""},
		"other cookies only":   {cookieHeader: "session=abc123", wantTheme: ""},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			if row.cookieHeader != "" {
				request.Header.Set("Cookie", row.cookieHeader)
			}
			response := httptest.NewRecorder()
			site.ServeHTTP(response, request)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d", response.Code)
			}
			if got := response.Header().Get("Vary"); got != "Cookie" {
				t.Errorf("Vary = %q, want Cookie on every document response", got)
			}
			body := response.Body.String()
			if row.wantTheme == "" {
				if strings.Contains(body, "data-theme") {
					t.Fatalf("wanted the unstamped default, got %q", body)
				}
				return
			}
			if want := fmt.Sprintf("<html data-theme=%q", row.wantTheme); !strings.Contains(body, want) {
				t.Fatalf("body = %q, want the %s stamp %q", body, row.wantTheme, want)
			}
		})
	}
}

// TestThemedDocumentConditionalRequests locks cache correctness per
// representation: each variant revalidates against its own validator, a
// validator from a different variant forces a full 200 (a theme switch must
// never 304 into the wrong colors), and the 304 keeps both the Vary key and
// the security-header baseline.
func TestThemedDocumentConditionalRequests(t *testing.T) {
	t.Parallel()
	site := testHandler(t)
	document := func(cookie, validator string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodGet, "/", nil)
		if cookie != "" {
			request.AddCookie(&http.Cookie{Name: themeCookie, Value: cookie})
		}
		if validator != "" {
			request.Header.Set("If-None-Match", validator)
		}
		response := httptest.NewRecorder()
		site.ServeHTTP(response, request)
		return response
	}

	defaultETag := document("", "").Header().Get("ETag")
	sepiaETag := document("sepia", "").Header().Get("ETag")
	if defaultETag == "" || sepiaETag == "" || defaultETag == sepiaETag {
		t.Fatalf("distinct validators required: default %q, sepia %q", defaultETag, sepiaETag)
	}

	if revisit := document("sepia", sepiaETag); revisit.Code != http.StatusNotModified {
		t.Errorf("replaying the sepia validator in sepia = %d, want 304", revisit.Code)
	} else {
		if got := revisit.Header().Get("Vary"); got != "Cookie" {
			t.Errorf("304 Vary = %q, want Cookie", got)
		}
		if got := revisit.Header().Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("304 lost the security baseline: X-Content-Type-Options = %q", got)
		}
	}
	if switched := document("sepia", defaultETag); switched.Code != http.StatusOK {
		t.Errorf("default validator with a sepia cookie = %d, want a full 200 of the new representation", switched.Code)
	}
	if reverted := document("", sepiaETag); reverted.Code != http.StatusOK {
		t.Errorf("sepia validator without a cookie = %d, want a full 200 of the default", reverted.Code)
	}
	if unchanged := document("", defaultETag); unchanged.Code != http.StatusNotModified {
		t.Errorf("default validator without a cookie = %d, want 304", unchanged.Code)
	}
}

// TestOnlyTheDocumentVariesByCookie confines the Vary surface: hashed assets
// and direct file-table paths are cookie-independent byte-identical
// responses, so a Vary: Cookie there would only shred edge cache hit rates.
// The direct /index.html table entry stays the unstamped default.
func TestOnlyTheDocumentVariesByCookie(t *testing.T) {
	t.Parallel()
	site := testHandler(t)
	for name, target := range map[string]string{
		"hashed asset":      "/assets/app-abc123.js",
		"root-level file":   "/favicon.svg",
		"direct index.html": "/index.html",
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			request := httptest.NewRequest(http.MethodGet, target, nil)
			request.AddCookie(&http.Cookie{Name: themeCookie, Value: "sepia"})
			response := httptest.NewRecorder()
			site.ServeHTTP(response, request)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d", response.Code)
			}
			if got := response.Header().Get("Vary"); got != "" {
				t.Errorf("Vary = %q; cookie-independent responses must not vary", got)
			}
			if target == "/index.html" && strings.Contains(response.Body.String(), "data-theme") {
				t.Error("/index.html must serve the unstamped table entry")
			}
		})
	}
}

// TestReadingThemesParity pins the reading-mode id list to exactly the four
// registered modes, because the same list is hand-duplicated in the frontend
// registry (frontend/src/lib/themes.ts) and its [data-theme] blocks in
// frontend/src/styles.css, and the sides must never drift silently: an id on
// only one side would ship a cookie the origin ignores or a variant no
// toggle can reach. The frontend experience test pins the identical list
// from its side.
func TestReadingThemesParity(t *testing.T) {
	t.Parallel()
	want := []string{"dark", "light", "sepia", "slate"}
	if !equalStrings(readingThemes, want) {
		t.Fatalf("readingThemes = %v, want exactly %v; update the registry in frontend/src/lib/themes.ts in the same change", readingThemes, want)
	}
}
