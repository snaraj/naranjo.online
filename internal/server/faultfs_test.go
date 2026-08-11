// faultfs_test proves the two filesystem boundaries fail closed. The embedded
// frontend is prepared through the fs.FS interface, so a hand-written fake
// injects read faults between a successful directory walk and the byte copy —
// the failure fstest.MapFS alone cannot produce — and verifies by recorded
// call counts that construction reads everything exactly once and the request
// path never touches the filesystem again. The media root is a security
// boundary and is deliberately NOT abstracted behind a fake: every media fault
// here is staged on a real filesystem, exactly as production would encounter
// it.
package server

import (
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"testing"
	"testing/fstest"
)

// faultFS wraps a healthy fstest.MapFS but intercepts ReadFile to record every
// call and inject per-path faults. Open delegates untouched so fs.WalkDir sees
// a fully healthy directory tree before the injected read fails — the exact
// shape of a bundle that is listable but unreadable.
type faultFS struct {
	files    fstest.MapFS
	readErrs map[string]error

	mu    sync.Mutex
	reads []string
}

func (f *faultFS) Open(name string) (fs.File, error) { return f.files.Open(name) }

func (f *faultFS) ReadFile(name string) ([]byte, error) {
	f.mu.Lock()
	f.reads = append(f.reads, name)
	f.mu.Unlock()
	if err, ok := f.readErrs[name]; ok {
		return nil, err
	}
	return f.files.ReadFile(name)
}

// recordedReads returns a sorted copy so assertions are deterministic.
func (f *faultFS) recordedReads() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	reads := append([]string(nil), f.reads...)
	sort.Strings(reads)
	return reads
}

// failingDirFS makes the walk itself fail: ReadDir on the poisoned directory
// errors, modeling a bundle whose listing — not a file body — is broken.
type failingDirFS struct {
	fstest.MapFS
	failDir string
	err     error
}

func (f *failingDirFS) ReadDir(name string) ([]fs.DirEntry, error) {
	if name == f.failDir {
		return nil, f.err
	}
	return f.MapFS.ReadDir(name)
}

// healthyFrontend is the minimal realistic bundle: the entrypoint, one hashed
// asset, and one root-level file.
func healthyFrontend() fstest.MapFS {
	return fstest.MapFS{
		"index.html":           &fstest.MapFile{Data: []byte("<!doctype html><h1>naranjo</h1>")},
		"assets/app-abc123.js": &fstest.MapFile{Data: []byte("console.log('app')")},
		"favicon.svg":          &fstest.MapFile{Data: []byte("<svg/>")},
	}
}

// TestConstructionReadsEveryFileExactlyOnce verifies the prepared-table
// contract by observed calls, not implementation trust: New reads each
// embedded file exactly once, and no request — hit, miss, or index — ever
// reaches the filesystem again.
func TestConstructionReadsEveryFileExactlyOnce(t *testing.T) {
	t.Parallel()
	fsys := &faultFS{files: healthyFrontend()}
	site, err := New(fsys)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	t.Cleanup(func() {
		if err := site.Close(); err != nil {
			t.Errorf("Close() error = %v", err)
		}
	})
	want := []string{"assets/app-abc123.js", "favicon.svg", "index.html"}
	constructionReads := assertConstructionReads(t, fsys, want)

	for _, target := range []string{"/", "/assets/app-abc123.js", "/favicon.svg", "/missing", "/index.html/../favicon.svg"} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/", nil)
		request.URL.Path = target
		site.ServeHTTP(response, request)
	}
	if got := fsys.recordedReads(); !equalStrings(got, constructionReads) {
		t.Fatalf("request handling read from the filesystem: reads grew from %v to %v", constructionReads, got)
	}
}

// assertConstructionReads asserts the construction-time read set and returns
// it for later growth comparison.
func assertConstructionReads(t *testing.T, fsys *faultFS, want []string) []string {
	t.Helper()
	got := fsys.recordedReads()
	if !equalStrings(got, want) {
		t.Fatalf("construction reads = %v, want each of %v exactly once", got, want)
	}
	return got
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestConstructionFailsClosedOnBrokenBundle proves every class of unreadable
// bundle stops the process before readiness: an injected fault on any file —
// not only index.html — a missing entrypoint, and a directory whose listing
// fails must all surface a construction error, never a site that would emit
// per-visitor failures later.
func TestConstructionFailsClosedOnBrokenBundle(t *testing.T) {
	t.Parallel()
	injected := errors.New("injected read fault")

	t.Run("unreadable entrypoint", func(t *testing.T) {
		t.Parallel()
		fsys := &faultFS{files: healthyFrontend(), readErrs: map[string]error{"index.html": injected}}
		if site, err := New(fsys); err == nil || !errors.Is(err, injected) {
			t.Fatalf("New() = %v, %v; want the injected fault", site, err)
		}
	})

	t.Run("unreadable asset fails without retry", func(t *testing.T) {
		t.Parallel()
		fsys := &faultFS{files: healthyFrontend(), readErrs: map[string]error{"assets/app-abc123.js": injected}}
		site, err := New(fsys)
		if err == nil || !errors.Is(err, injected) {
			t.Fatalf("New() = %v, %v; want the injected fault", site, err)
		}
		attempts := 0
		for _, name := range fsys.recordedReads() {
			if name == "assets/app-abc123.js" {
				attempts++
			}
		}
		if attempts != 1 {
			t.Fatalf("failing file was read %d times, want exactly 1", attempts)
		}
	})

	t.Run("missing entrypoint", func(t *testing.T) {
		t.Parallel()
		bundle := healthyFrontend()
		delete(bundle, "index.html")
		if site, err := New(&faultFS{files: bundle}); err == nil || !errors.Is(err, fs.ErrNotExist) {
			t.Fatalf("New() = %v, %v; want fs.ErrNotExist", site, err)
		}
	})

	t.Run("unlistable directory", func(t *testing.T) {
		t.Parallel()
		fsys := &failingDirFS{MapFS: healthyFrontend(), failDir: "assets", err: injected}
		if site, err := New(fsys); err == nil || !errors.Is(err, injected) {
			t.Fatalf("New() = %v, %v; want the injected walk fault", site, err)
		}
	})

	t.Run("valid media root is closed again when the bundle is broken", func(t *testing.T) {
		t.Parallel()
		fsys := &faultFS{files: healthyFrontend(), readErrs: map[string]error{"favicon.svg": injected}}
		site, err := NewWithMedia(fsys, MediaOptions{Root: t.TempDir(), MaxConcurrent: 1})
		if err == nil || !errors.Is(err, injected) {
			t.Fatalf("NewWithMedia() = %v, %v; want the injected fault", site, err)
		}
	})
}

// TestMediaRootValidationFailsClosed pins openMediaHandler's refusal of every
// unusable delivery-root configuration on a real filesystem: nothing here is
// mocked, because the root capability is the security boundary itself.
func TestMediaRootValidationFailsClosed(t *testing.T) {
	t.Parallel()
	regularFile := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(regularFile, []byte("x"), 0o640); err != nil {
		t.Fatal(err)
	}
	linkedRoot := filepath.Join(t.TempDir(), "linked-root")
	if err := os.Symlink(t.TempDir(), linkedRoot); err != nil {
		t.Fatalf("symlink creation is unavailable on this test host: %v", err)
	}
	for name, options := range map[string]MediaOptions{
		"relative root":           {Root: "relative/media", MaxConcurrent: 1},
		"zero concurrency":        {Root: t.TempDir(), MaxConcurrent: 0},
		"excessive concurrency":   {Root: t.TempDir(), MaxConcurrent: MaxMediaConcurrency + 1},
		"missing root":            {Root: filepath.Join(t.TempDir(), "never-created"), MaxConcurrent: 1},
		"root is a regular file":  {Root: regularFile, MaxConcurrent: 1},
		"root is a symbolic link": {Root: linkedRoot, MaxConcurrent: 1},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			handler, err := openMediaHandler(options)
			if err == nil || handler != nil {
				t.Fatalf("openMediaHandler(%+v) = %v, %v; want a refusal", options, handler, err)
			}
		})
	}
}

// TestMediaRootCloseLifecycle locks the capability lifecycle: the first Close
// releases the rooted descriptor, a repeat Close stays safe for deferred
// cleanup ordering, a straggler request after release fails opaque instead of
// panicking or serving, and a media-disabled site closes as a no-op forever.
func TestMediaRootCloseLifecycle(t *testing.T) {
	t.Parallel()
	media, err := openMediaHandler(MediaOptions{Root: t.TempDir(), MaxConcurrent: 1})
	if err != nil {
		t.Fatalf("openMediaHandler() error = %v", err)
	}
	if err := media.Close(); err != nil {
		t.Fatalf("first Close() error = %v", err)
	}
	// The result of a repeat Close is os-internal and deliberately unpinned;
	// it must only remain safe to call.
	_ = media.Close()
	// Shutdown ordering guarantees no requests arrive after Close, but if one
	// ever did, the closed capability must fail opaque — never panic, never
	// serve, never explain itself.
	straggler := httptest.NewRecorder()
	media.ServeHTTP(straggler, httptest.NewRequest(http.MethodGet, "/media/mutable/late.mp4", nil))
	if straggler.Code != http.StatusInternalServerError {
		t.Fatalf("request after Close = %d, want an opaque 500", straggler.Code)
	}
	if body := strings.TrimSpace(straggler.Body.String()); body != "internal server error" {
		t.Fatalf("post-Close body = %q; it must stay opaque", body)
	}

	site, err := New(&faultFS{files: healthyFrontend()})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if err := site.Close(); err != nil {
		t.Fatalf("media-disabled Close() error = %v", err)
	}
	if err := site.Close(); err != nil {
		t.Fatalf("repeated media-disabled Close() error = %v", err)
	}
}

// TestMediaBoundaryFaultsOnRealFilesystem stages each openRegular fault class
// with real files, permissions, and special nodes — never a mock — and proves
// the public response stays opaque: 404 for everything the origin refuses to
// acknowledge, and an opaque 500 only when the filesystem itself fails in a
// way that is neither absence nor refusal.
func TestMediaBoundaryFaultsOnRealFilesystem(t *testing.T) {
	t.Parallel()
	site, root := mediaFixture(t)

	t.Run("unreadable leaf is indistinguishable from missing", func(t *testing.T) {
		// Requires a non-root test user: euid 0 would bypass the permission bit
		// and legitimately serve the file. CI runners and developer machines run
		// tests unprivileged, matching the production container.
		if os.Geteuid() == 0 {
			t.Fatal("media permission faults cannot be exercised as root")
		}
		sealed := filepath.Join(root, "mutable", "sealed.mp4")
		if err := os.WriteFile(sealed, []byte("sealed bytes"), 0o640); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(sealed, 0o000); err != nil {
			t.Fatal(err)
		}
		response := mediaRequest(t, site, http.MethodGet, "/media/mutable/sealed.mp4", nil)
		if response.Code != http.StatusNotFound || strings.Contains(response.Body.String(), "sealed bytes") {
			t.Fatalf("unreadable leaf = %d %q, want an opaque 404", response.Code, response.Body.String())
		}
	})

	t.Run("file as intermediate segment is opaque", func(t *testing.T) {
		response := mediaRequest(t, site, http.MethodGet, "/media/mutable/song.flac/nested.mp4", nil)
		if response.Code != http.StatusNotFound {
			t.Fatalf("file-as-directory = %d, want 404", response.Code)
		}
	})

	t.Run("named pipe is never opened for streaming", func(t *testing.T) {
		// A fifo passes every path rule yet must be refused as non-regular:
		// opening it for read would block the transfer slot on a writer that
		// never comes.
		fifo := filepath.Join(root, "mutable", "trap.mp4")
		if err := syscall.Mkfifo(fifo, 0o640); err != nil {
			t.Fatalf("mkfifo: %v", err)
		}
		response := mediaRequest(t, site, http.MethodGet, "/media/mutable/trap.mp4", nil)
		if response.Code != http.StatusNotFound {
			t.Fatalf("fifo = %d, want 404", response.Code)
		}
	})

	t.Run("filesystem limits surface as an opaque 500", func(t *testing.T) {
		// A 300-byte segment passes the publication grammar but exceeds every
		// real filesystem's name limit, so Lstat fails with ENAMETOOLONG — a
		// fault that is neither absence nor permission and must become the
		// generic internal error with no path or errno detail in the body.
		oversized := strings.Repeat("a", 300) + ".mp4"
		response := mediaRequest(t, site, http.MethodGet, "/media/mutable/"+oversized, nil)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("oversized name = %d, want 500", response.Code)
		}
		if body := strings.TrimSpace(response.Body.String()); body != "internal server error" {
			t.Fatalf("500 body = %q; it must stay opaque", body)
		}
	})
}
