// main_e2e_test boots the real production entrypoint — run(), with the
// embedded frontend, a real TCP listener, and the process signal handler —
// and drives it exactly the way Kubernetes and a visitor's browser do: wait
// for readiness, exercise the public route contract over HTTP, then deliver a
// real SIGTERM and require a clean drain. Deterministic lifecycle ordering is
// covered by serve_test.go; this file proves the wiring between environment,
// listener, handler, and signals end to end.
//
// These tests deliberately do not use testing/synctest: a synctest bubble
// requires every goroutine to block on bubble-visible operations, and genuine
// network I/O is not one, so readiness is polled with bounded real-time
// deadlines generous enough for CI.
package main

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	website "github.com/snaraj/naranjo.online/internal/web"
)

// builtAssetReference matches Vite's content-addressed asset URLs in the
// served document, mirroring the embed test so both suites hunt the same way.
var builtAssetReference = regexp.MustCompile(`(?:src|href)="(/assets/[^"]+)"`)

// fakeEnv returns an environment lookup covering only the given variables.
// Injecting the lookup instead of mutating the process environment with
// t.Setenv keeps every value local to its subtest — which is what allows
// t.Parallel here, since t.Setenv and t.Parallel are mutually exclusive —
// and makes each boot hermetic: ambient developer variables cannot change
// what this suite runs.
func fakeEnv(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

// requireBuiltFrontend fails fast — never skips — when the embedded bundle is
// missing, matching the repository doctrine that CI must always test the real
// artifact. The message mirrors internal/web's guidance.
func requireBuiltFrontend(t *testing.T) {
	t.Helper()
	assets, err := website.FileSystem()
	if err == nil {
		_, err = fs.Stat(assets, "index.html")
	}
	if err != nil {
		t.Fatalf("embedded frontend unavailable: %v; run the pinned frontend build before Go tests", err)
	}
}

// reserveLoopbackPort asks the kernel for a currently free port. The tiny
// window before run rebinds it is why bootServer retries.
func reserveLoopbackPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatalf("release reserved port: %v", err)
	}
	return port
}

// bootServer starts run in a goroutine with the exact NotifyContext
// composition main uses — so a later real SIGTERM drives the same drain path
// production takes — and waits until the readiness probe answers, retrying
// with a fresh port if another process wins the bind race. extraEnv joins the
// injected environment so media-enabled scenarios reuse the same boot path.
// It returns the base URL and the channel that will carry run's final error.
func bootServer(t *testing.T, extraEnv map[string]string) (string, <-chan error) {
	t.Helper()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	t.Cleanup(stop)
	client := &http.Client{Timeout: 2 * time.Second}
	for attempt := 1; ; attempt++ {
		port := reserveLoopbackPort(t)
		environment := map[string]string{"PORT": strconv.Itoa(port)}
		for key, value := range extraEnv {
			environment[key] = value
		}
		runResult := make(chan error, 1)
		go func() { runResult <- run(ctx, fakeEnv(environment)) }()

		base := "http://127.0.0.1:" + strconv.Itoa(port)
		deadline := time.Now().Add(15 * time.Second)
		for {
			select {
			case err := <-runResult:
				if attempt < 3 {
					t.Logf("boot attempt %d lost its reserved port (%v); retrying", attempt, err)
					goto retry
				}
				t.Fatalf("run() exited during startup: %v", err)
			default:
			}
			response, err := client.Get(base + "/readyz")
			if err == nil {
				response.Body.Close()
				if response.StatusCode == http.StatusOK {
					return base, runResult
				}
			}
			if time.Now().After(deadline) {
				t.Fatal("server did not become ready within 15s")
			}
			time.Sleep(20 * time.Millisecond)
		}
	retry:
	}
}

// mustGet performs one real HTTP request and returns the fully read response,
// failing the test on transport errors so assertions stay linear.
func mustGet(t *testing.T, client *http.Client, url string) (*http.Response, []byte) {
	t.Helper()
	response, err := client.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	body, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil {
		t.Fatalf("read %s body: %v", url, err)
	}
	return response, body
}

// TestRunFailsClosedOnBadConfiguration proves the entrypoint refuses to start
// — before any socket exists — for each class of broken pod configuration, so
// Kubernetes surfaces a crash loop instead of routing traffic to a miswired
// process. Injected environments keep the rows parallel and hermetic.
func TestRunFailsClosedOnBadConfiguration(t *testing.T) {
	t.Parallel()
	requireBuiltFrontend(t)
	for name, environment := range map[string]map[string]string{
		"invalid PORT":                 {"PORT": "not-a-port"},
		"media root while disabled":    {"MEDIA_ROOT": "/never/used"},
		"unknown media switch":         {"MEDIA_ENABLED": "maybe"},
		"media enabled but incomplete": {"MEDIA_ENABLED": "true", "MEDIA_ROOT": "/reviewed"},
		"unknown panels refresh":       {"PANELS_REFRESH": "maybe"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if err := run(t.Context(), fakeEnv(environment)); err == nil {
				t.Fatal("run() accepted invalid configuration and would have served traffic")
			}
		})
	}
}

// TestRunServesTheSiteAndDrainsOnSIGTERM is the complete production lifecycle
// in one scenario: boot the real binary path, verify every public contract
// over a real connection, then deliver the same signal Kubernetes sends and
// require a clean, prompt drain. Sequential — signal delivery is
// process-global, and the subtests run in order against the one live process.
func TestRunServesTheSiteAndDrainsOnSIGTERM(t *testing.T) {
	requireBuiltFrontend(t)
	base, runResult := bootServer(t, nil)
	client := &http.Client{Timeout: 5 * time.Second}
	var document string

	t.Run("serves the document with the security baseline", func(t *testing.T) {
		response, body := mustGet(t, client, base+"/")
		if response.StatusCode != http.StatusOK {
			t.Fatalf("GET / status = %d", response.StatusCode)
		}
		if got := response.Header.Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
			t.Errorf("Content-Type = %q", got)
		}
		if got := response.Header.Get("Cache-Control"); got != "no-cache" {
			t.Errorf("Cache-Control = %q", got)
		}
		for header, want := range map[string]string{
			"Content-Security-Policy":   "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
			"Strict-Transport-Security": "max-age=31536000",
			"X-Content-Type-Options":    "nosniff",
			"X-Frame-Options":           "DENY",
			"Referrer-Policy":           "no-referrer",
		} {
			if got := response.Header.Get(header); got != want {
				t.Errorf("%s = %q, want %q", header, got, want)
			}
		}
		document = string(body)
		if !strings.Contains(document, "data-static-fallback") {
			t.Error("served document lacks the static application fallback")
		}
	})

	t.Run("answers both health probes", func(t *testing.T) {
		for _, endpoint := range []string{"/livez", "/readyz"} {
			response, body := mustGet(t, client, base+endpoint)
			if response.StatusCode != http.StatusOK || string(body) != "ok\n" {
				t.Errorf("GET %s = %d %q", endpoint, response.StatusCode, body)
			}
			if got := response.Header.Get("Cache-Control"); got != "no-store" {
				t.Errorf("%s Cache-Control = %q", endpoint, got)
			}
		}
	})

	t.Run("serves hashed assets immutably with working revalidation", func(t *testing.T) {
		references := builtAssetReference.FindAllStringSubmatch(document, -1)
		if len(references) == 0 {
			t.Fatal("document references no built assets")
		}
		assetURL := base + references[0][1]
		response, body := mustGet(t, client, assetURL)
		if response.StatusCode != http.StatusOK || len(body) == 0 {
			t.Fatalf("GET %s = %d, %d bytes", assetURL, response.StatusCode, len(body))
		}
		if got := response.Header.Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
			t.Errorf("asset Cache-Control = %q", got)
		}
		request, err := http.NewRequest(http.MethodGet, assetURL, nil)
		if err != nil {
			t.Fatalf("build conditional request: %v", err)
		}
		request.Header.Set("If-None-Match", response.Header.Get("ETag"))
		revalidation, err := client.Do(request)
		if err != nil {
			t.Fatalf("conditional GET: %v", err)
		}
		revalidation.Body.Close()
		if revalidation.StatusCode != http.StatusNotModified {
			t.Errorf("conditional GET status = %d, want 304", revalidation.StatusCode)
		}
	})

	t.Run("hides unknown and placeholder paths", func(t *testing.T) {
		for _, path := range []string{"/missing", "/.gitkeep", "/src/main.ts"} {
			response, _ := mustGet(t, client, base+path)
			if response.StatusCode != http.StatusNotFound {
				t.Errorf("GET %s status = %d, want 404", path, response.StatusCode)
			}
		}
	})

	t.Run("refuses every mutating method over the wire", func(t *testing.T) {
		response, err := client.Post(base+"/", "text/plain", strings.NewReader("mutation"))
		if err != nil {
			t.Fatalf("POST /: %v", err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("POST / status = %d, want 405", response.StatusCode)
		}
		if got := response.Header.Get("Allow"); got != "GET, HEAD" {
			t.Errorf("Allow = %q", got)
		}
	})

	// The drain is part of the scenario, not a subtest: it must run even if an
	// assertion above failed, or the goroutine would outlive the test.
	if err := syscall.Kill(os.Getpid(), syscall.SIGTERM); err != nil {
		t.Fatalf("deliver SIGTERM: %v", err)
	}
	select {
	case err := <-runResult:
		if err != nil {
			t.Fatalf("run() = %v after SIGTERM, want nil", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("run() did not drain within 15s of SIGTERM")
	}
	if _, err := client.Get(base + "/readyz"); err == nil {
		t.Fatal("listener still accepting connections after graceful shutdown")
	} else if !errors.Is(err, syscall.ECONNREFUSED) && !strings.Contains(err.Error(), "connection refused") {
		t.Logf("post-shutdown probe failed as expected: %v", err)
	}
}
