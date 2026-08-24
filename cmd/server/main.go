// Command server runs the single naranjo.online application artifact. It joins
// the embedded Svelte frontend with the Go HTTP handler and shuts down cleanly
// when Kubernetes replaces or terminates a pod.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/snaraj/naranjo.online/internal/server"
	website "github.com/snaraj/naranjo.online/internal/web"
)

// main owns process termination and the process-global signal contract:
// Kubernetes sends SIGTERM before a pod's grace period expires, and handling
// both SIGTERM and local interrupts here gives every shutdown the same orderly
// path. run stays free to report startup and serving failures through one
// structured log statement.
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Getenv); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

// run assembles the immutable site, starts its hardened HTTP server, and blocks
// until the server fails or ctx requests a graceful shutdown. Configuration
// arrives through lookupEnv — main passes os.Getenv — so tests can inject each
// case's environment without mutating process state, which t.Setenv would
// require at the cost of forbidding t.Parallel. Validation keeps its
// documented order — listen port, embedded assets, media configuration — and
// the site is constructed exactly once, only after the media decision is
// known, so a media-enabled boot never pays a throwaway walk and SHA-256 of
// every embedded file for a Site it immediately discards.
func run(ctx context.Context, lookupEnv func(string) string) error {
	port, err := listenPort(lookupEnv("PORT"))
	if err != nil {
		return err
	}

	assets, err := website.FileSystem()
	if err != nil {
		return err
	}
	mediaEnabled, mediaOptions, err := mediaConfiguration(
		lookupEnv("MEDIA_ENABLED"),
		lookupEnv("MEDIA_ROOT"),
		lookupEnv("MEDIA_MAX_CONCURRENT"),
	)
	if err != nil {
		return err
	}
	panelsRefresh, err := panelsRefreshConfiguration(lookupEnv("PANELS_REFRESH"))
	if err != nil {
		return err
	}
	panelsDataRoot, err := panelsDataConfiguration(lookupEnv("PANELS_DATA_ROOT"))
	if err != nil {
		return err
	}
	panelsDataState, err := panelsDataStateConfiguration(lookupEnv("PANELS_DATA_STATE"), panelsDataRoot)
	if err != nil {
		return err
	}
	var handler *server.Site
	if mediaEnabled {
		handler, err = server.NewWithMedia(assets, mediaOptions)
	} else {
		handler, err = server.New(assets)
	}
	if err != nil {
		return err
	}
	defer handler.Close()
	// ORDER IS DELIBERATE: the sealed data root starts FIRST, so it claims
	// the token-usage panel before any live refresh loop exists (2026-08-24
	// review finding 8). Both switches on used to start two independent
	// producers writing the same panel state with no precedence, so a
	// credentialed live fetch could overwrite the sealed series and the next
	// data-root tick could overwrite it back. The enforcement lives inside
	// the panels package and holds whichever order a caller uses; this order
	// simply means no wasted fetch happens before the claim is seen.
	if panelsDataRoot != "" {
		// The panels data root (issue #142): a mounted read-only directory
		// carrying the sealed usage-series file pushed from the recording
		// workstation. Unset leaves behavior byte-identical to a build
		// without the capability; set, an unopenable ROOT fails the boot
		// loudly (operator misconfiguration), while a missing or malformed
		// FILE inside a healthy root degrades softly to the embedded
		// snapshot forever. The environment accessor is passed through so
		// the decryption key is read at decrypt time only.
		if err := handler.StartPanelData(ctx, panelsDataRoot, panelsDataState, lookupEnv); err != nil {
			return err
		}
	}
	if panelsRefresh {
		// Explicit opt-in (the chart supplies it in production) following the
		// media-enablement precedent: capabilities that reach beyond the
		// process are configuration decisions, and every test boot stays
		// egress-free by default. Cancellation of ctx on shutdown stops the
		// refresh loops before any further attempt.
		//
		// The ownership decision is logged ONCE here, where the composition
		// is chosen, because an operator who enabled both switches must be
		// able to see which producer is serving the token-usage panel
		// without reading the code. Every other refresh-backed panel keeps
		// refreshing.
		if handler.TokenUsageOwnedByDataRoot() {
			slog.Info("token-usage panel served from the sealed data root; its live refresh is suppressed",
				"panel", "token-usage", "owner", "data-root")
		}
		handler.StartPanelRefresh(ctx)
	}

	httpServer := &http.Server{
		// Explicit limits protect the small Pi-hosted origin from slow or oversized
		// requests while leaving enough time for normal traffic through the tunnel.
		Addr:              ":" + strconv.Itoa(port),
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		// A total write timeout would terminate valid multi-gigabyte downloads.
		// The media handler instead refreshes a bounded per-write idle deadline.
		WriteTimeout:   0,
		IdleTimeout:    60 * time.Second,
		MaxHeaderBytes: maxRequestHeaderBytes,
	}

	slog.Info("naranjo.online listening", "port", port)
	return serve(ctx, httpServer)
}

// serve blocks until the server fails on its own or ctx requests a graceful
// shutdown, then bounds that shutdown with shutdownTimeout. It is separated
// from run so this orchestration can be exercised against a fake httpRunner
// while run keeps sole ownership of environment, signals, and the real
// listener.
func serve(ctx context.Context, server httpRunner) error {
	// A one-result buffer lets the serving goroutine report an early failure even
	// when signal cancellation wins the select and shutdown begins first.
	errCh := make(chan error, 1)
	go func() {
		errCh <- server.ListenAndServe()
	}()

	select {
	case serveErr := <-errCh:
		if errors.Is(serveErr, http.ErrServerClosed) {
			return nil
		}
		return serveErr
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	return server.Shutdown(shutdownCtx)
}

// mediaConfiguration keeps production media disabled unless all discovery-
// derived inputs are supplied together. It never chooses a path or concurrency
// value on behalf of the operator.
func mediaConfiguration(enabled, root, maxConcurrent string) (bool, server.MediaOptions, error) {
	if enabled == "" || enabled == "false" {
		if root != "" || maxConcurrent != "" {
			return false, server.MediaOptions{}, errors.New("disabled media configuration must not set root or concurrency")
		}
		return false, server.MediaOptions{}, nil
	}
	if enabled != "true" {
		return false, server.MediaOptions{}, errors.New("MEDIA_ENABLED must be true or false")
	}
	if root == "" || maxConcurrent == "" {
		return false, server.MediaOptions{}, errors.New("enabled media configuration is incomplete")
	}
	concurrency, err := strconv.Atoi(maxConcurrent)
	if err != nil || concurrency < 1 || concurrency > server.MaxMediaConcurrency {
		return false, server.MediaOptions{}, errors.New("MEDIA_MAX_CONCURRENT is outside the safe implementation range")
	}
	return true, server.MediaOptions{Root: root, MaxConcurrent: concurrency}, nil
}

// panelsRefreshConfiguration keeps the panel API's live refresh disabled
// unless the operator explicitly enables it, mirroring mediaConfiguration:
// egress is a deployment decision, never a default, and an unrecognized
// value fails the boot instead of guessing.
func panelsRefreshConfiguration(value string) (bool, error) {
	switch value {
	case "", "false":
		return false, nil
	case "true":
		return true, nil
	}
	return false, errors.New("PANELS_REFRESH must be true or false")
}

// panelsDataConfiguration validates the optional panels data root path.
// Empty keeps the capability entirely absent — no root is opened and no loop
// starts — and a relative path fails the boot instead of being resolved
// against a working directory nobody chose on purpose.
func panelsDataConfiguration(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	if !strings.HasPrefix(value, "/") {
		return "", errors.New("PANELS_DATA_ROOT must be an absolute path")
	}
	return value, nil
}

// panelsDataStateConfiguration validates the optional writable state path
// the replay-floor marker persists in (2026-08-24 review finding H2). Empty
// runs the data-root loop with the process-memory floor only — the
// documented degraded mode. Set, it demands the same absolute-path shape as
// the data root, and it is meaningless without one: state describes where
// the data root's floor lives, so state-without-root is a misconfiguration
// that fails the boot loudly rather than dangling.
func panelsDataStateConfiguration(value, dataRoot string) (string, error) {
	if value == "" {
		return "", nil
	}
	if dataRoot == "" {
		return "", errors.New("PANELS_DATA_STATE requires PANELS_DATA_ROOT")
	}
	if !strings.HasPrefix(value, "/") {
		return "", errors.New("PANELS_DATA_STATE must be an absolute path")
	}
	return value, nil
}

// listenPort validates the only runtime listener setting. The stable 8080
// default matches the Helm chart, while strict bounds fail bad pod configuration
// before Kubernetes can route traffic to the process.
func listenPort(value string) (int, error) {
	if value == "" {
		return 8080, nil
	}
	port, err := strconv.Atoi(value)
	if err != nil || port < 1 || port > 65535 {
		return 0, errors.New("PORT must be an integer between 1 and 65535")
	}
	return port, nil
}
