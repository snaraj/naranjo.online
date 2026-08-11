// media_lifecycle_test boots run() with media enabled — the configuration the
// Pi origin will eventually run — over a real TCP listener and drives the
// complete media lifecycle a visitor and Kubernetes would: readiness, full and
// partial transfers, revalidation, the fail-closed saturation response,
// recovery after the load subsides, and a SIGTERM drain that must also release
// the media root cleanly. The RFC 9110 precondition matrix and the path
// boundary are pinned exhaustively in internal/server; this file proves a
// representative row of each contract over a real connection, where the idle
// write deadline and kernel backpressure actually exist.
package main

import (
	"bytes"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/snaraj/naranjo.online/internal/testsupport"
)

// lifecycleMediaBytes is the canonical tiny immutable fixture; its digest
// names its directory so the fixture never models a URL whose bytes violate
// the content-addressed publication contract.
var lifecycleMediaBytes = []byte(testsupport.MediaFileContent)

// largeMediaSize must exceed every buffer between the server's file copy and
// the paused client — kernel socket buffers on both sides plus the transport's
// read-ahead — so an unread response provably keeps its transfer slot
// occupied. 8 MiB is an order of magnitude beyond loopback defaults on both
// the CI runners and the Pi, while still trivial to create in a fixture.
const largeMediaSize = 8 << 20

// mediaLifecycleRoot builds the on-disk delivery tree run() will serve: the
// canonical shared tree, plus one large mutable file — a saturation-scenario
// concern owned by this suite, not the shared fixture — whose unread body can
// hold the single transfer slot open.
func mediaLifecycleRoot(t *testing.T) (root, immutableURL, largeURL string) {
	t.Helper()
	root = testsupport.MediaRoot(t)
	if err := os.WriteFile(filepath.Join(root, "mutable", "large.webm"), bytes.Repeat([]byte{'v'}, largeMediaSize), 0o640); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	return root, testsupport.ImmutableClipPath(), "/media/mutable/large.webm"
}

// TestRunServesMediaLifecycleEndToEnd is sequential by design: it owns a live
// port, deliberately saturates a one-slot semaphore, and ends with
// process-global signal delivery.
func TestRunServesMediaLifecycleEndToEnd(t *testing.T) {
	requireBuiltFrontend(t)
	root, immutableURL, largeURL := mediaLifecycleRoot(t)
	base, runResult := bootServer(t, map[string]string{
		"MEDIA_ENABLED":        "true",
		"MEDIA_ROOT":           root,
		"MEDIA_MAX_CONCURRENT": "1",
	})
	client := &http.Client{Timeout: 5 * time.Second}
	var etag string

	t.Run("streams the immutable clip with its digest identity", func(t *testing.T) {
		response, body := mustGet(t, client, base+immutableURL)
		if response.StatusCode != http.StatusOK || !bytes.Equal(body, lifecycleMediaBytes) {
			t.Fatalf("GET %s = %d, %d bytes", immutableURL, response.StatusCode, len(body))
		}
		etag = response.Header.Get("ETag")
		for header, want := range map[string]string{
			"Accept-Ranges":           "bytes",
			"Cache-Control":           "public, max-age=31536000, immutable",
			"Content-Security-Policy": "default-src 'none'; sandbox",
			"Content-Type":            "video/mp4",
			"X-Content-Type-Options":  "nosniff",
		} {
			if got := response.Header.Get(header); got != want {
				t.Errorf("%s = %q, want %q", header, got, want)
			}
		}
		if etag == "" {
			t.Error("immutable media response has no ETag")
		}
	})

	t.Run("resumes with a byte range and revalidates to a 304", func(t *testing.T) {
		request, err := http.NewRequest(http.MethodGet, base+immutableURL, nil)
		if err != nil {
			t.Fatalf("build range request: %v", err)
		}
		request.Header.Set("Range", "bytes=2-5")
		partial, err := client.Do(request)
		if err != nil {
			t.Fatalf("range GET: %v", err)
		}
		partialBody := make([]byte, 8)
		n, _ := partial.Body.Read(partialBody)
		partial.Body.Close()
		if partial.StatusCode != http.StatusPartialContent || string(partialBody[:n]) != "2345" {
			t.Fatalf("range response = %d %q", partial.StatusCode, partialBody[:n])
		}
		if got := partial.Header.Get("Content-Range"); got != "bytes 2-5/10" {
			t.Errorf("Content-Range = %q", got)
		}

		conditional, err := http.NewRequest(http.MethodGet, base+immutableURL, nil)
		if err != nil {
			t.Fatalf("build conditional request: %v", err)
		}
		conditional.Header.Set("If-None-Match", etag)
		revalidation, err := client.Do(conditional)
		if err != nil {
			t.Fatalf("conditional GET: %v", err)
		}
		revalidation.Body.Close()
		if revalidation.StatusCode != http.StatusNotModified {
			t.Errorf("revalidation status = %d, want 304", revalidation.StatusCode)
		}
	})

	t.Run("keeps preconditions above abusive ranges on the wire", func(t *testing.T) {
		abusive := "bytes=" + strings.Repeat("0-0,", 64) + "0-0"
		request, err := http.NewRequest(http.MethodGet, base+immutableURL, nil)
		if err != nil {
			t.Fatalf("build abusive request: %v", err)
		}
		request.Header.Set("Range", abusive)
		response, err := client.Do(request)
		if err != nil {
			t.Fatalf("abusive GET: %v", err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusRequestedRangeNotSatisfiable {
			t.Fatalf("abusive range status = %d, want 416", response.StatusCode)
		}
		if got := response.Header.Get("Content-Range"); !strings.HasPrefix(got, "bytes */") {
			t.Errorf("416 Content-Range = %q", got)
		}

		neutralized, err := http.NewRequest(http.MethodGet, base+immutableURL, nil)
		if err != nil {
			t.Fatalf("build neutralized request: %v", err)
		}
		neutralized.Header.Set("Range", abusive)
		neutralized.Header.Set("If-None-Match", etag)
		cached, err := client.Do(neutralized)
		if err != nil {
			t.Fatalf("neutralized GET: %v", err)
		}
		cached.Body.Close()
		if cached.StatusCode != http.StatusNotModified {
			t.Fatalf("cache hit under abusive range = %d, want 304", cached.StatusCode)
		}
	})

	t.Run("fails closed at capacity and recovers when load subsides", func(t *testing.T) {
		// No client timeout: this response is deliberately held open unread so
		// the server's copy blocks on backpressure and the one slot stays taken.
		holder := &http.Client{}
		held, err := holder.Get(base + largeURL)
		if err != nil {
			t.Fatalf("GET %s: %v", largeURL, err)
		}
		if held.StatusCode != http.StatusOK {
			t.Fatalf("held stream status = %d", held.StatusCode)
		}

		busy, _ := mustGet(t, client, base+immutableURL)
		if busy.StatusCode != http.StatusServiceUnavailable {
			t.Fatalf("saturated status = %d, want 503", busy.StatusCode)
		}
		if busy.Header.Get("Retry-After") == "" {
			t.Error("503 has no Retry-After")
		}
		if got := busy.Header.Get("Cache-Control"); got != "no-store" {
			t.Errorf("503 Cache-Control = %q, want no-store", got)
		}

		// Abandoning the held response aborts the transfer; the server's write
		// fails, ServeHTTP returns, and the slot must come back.
		held.Body.Close()
		deadline := time.Now().Add(10 * time.Second)
		for {
			recovered, _ := mustGet(t, client, base+immutableURL)
			if recovered.StatusCode == http.StatusOK {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("slot never recovered: status = %d", recovered.StatusCode)
			}
			time.Sleep(20 * time.Millisecond)
		}
	})

	t.Run("still hides the operator namespaces over the wire", func(t *testing.T) {
		for _, target := range []string{
			"/media/originals/clip.mp4",
			"/media/mutable/.hidden",
			"/media/mutable/metadata/index.json",
		} {
			response, _ := mustGet(t, client, base+target)
			if response.StatusCode != http.StatusNotFound {
				t.Errorf("GET %s status = %d, want 404", target, response.StatusCode)
			}
		}
	})

	// Drain outside any subtest so it runs even after a failure above: the
	// media-enabled process must exit nil, which also proves run's deferred
	// close released the media root without error.
	if err := syscall.Kill(os.Getpid(), syscall.SIGTERM); err != nil {
		t.Fatalf("deliver SIGTERM: %v", err)
	}
	select {
	case err := <-runResult:
		if err != nil {
			t.Fatalf("run() = %v after SIGTERM with media enabled, want nil", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("media-enabled run() did not drain within 15s of SIGTERM")
	}
}
