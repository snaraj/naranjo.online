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
// require at the cost of forbidding t.Parallel.
func run(ctx context.Context, lookupEnv func(string) string) error {
	port, err := listenPort(lookupEnv("PORT"))
	if err != nil {
		return err
	}

	assets, err := website.FileSystem()
	if err != nil {
		return err
	}
	handler, err := server.New(assets)
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
	if mediaEnabled {
		handler, err = server.NewWithMedia(assets, mediaOptions)
	}
	if err != nil {
		return err
	}
	defer handler.Close()

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
