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
	"path/filepath"
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
// path. It also owns the process logger: built exactly once from the
// environment, installed as the slog default, and injected into run — so the
// whole process shares one handler while tests keep injecting their own quiet
// loggers. Both exit paths are logged, so `kubectl logs` always ends with an
// explicit final line instead of trailing off.
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	log := newProcessLogger(os.Stdout, isTerminal(os.Stdout), os.Getenv)
	slog.SetDefault(log.logger)
	if err := run(ctx, os.Getenv, log); err != nil {
		log.logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
	log.logger.Info("server exited")
}

// run assembles the immutable site, starts its hardened HTTP server, and blocks
// until the server fails or ctx requests a graceful shutdown. Configuration
// arrives through lookupEnv — main passes os.Getenv — so tests can inject each
// case's environment without mutating process state, which t.Setenv would
// require at the cost of forbidding t.Parallel. The logger arrives the same
// way, so every boot is exactly as quiet or as observable as its caller
// chose. Validation keeps its documented order — listen port, embedded
// assets, media configuration — and the site is constructed exactly once,
// only after the media decision is known, so a media-enabled boot never pays
// a throwaway walk and SHA-256 of every embedded file for a Site it
// immediately discards.
func run(ctx context.Context, lookupEnv func(string) string, log processLogger) error {
	port, err := listenPort(lookupEnv("PORT"))
	if err != nil {
		return err
	}
	bindHost, err := listenHostConfiguration(lookupEnv("LISTEN_ADDRESS"))
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
		handler, err = server.NewWithMedia(assets, mediaOptions, server.WithLogger(log.logger))
	} else {
		handler, err = server.New(assets, server.WithLogger(log.logger))
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
		// The durable replay floor's one operator-facing line (2026-08-24
		// round-3 review, findings 4 and 11). The loop itself stays silent
		// and simply refuses ticks it cannot trust, which is correct but
		// indistinguishable from every other reason a panel goes stale. This
		// says WHICH state the state directory is in — recovered, rotated,
		// lost, or untrusted — so the remedy in docs/usage-export.md is
		// reachable without reading the code. It carries no path, no key,
		// and no payload.
		if notice := handler.PanelsFloorNotice(); notice != "" {
			slog.Info(notice, "panel", "token-usage")
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
		Addr:              listenAddress(bindHost, port),
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		// A total write timeout would terminate valid multi-gigabyte downloads.
		// The media handler instead refreshes a bounded per-write idle deadline.
		WriteTimeout:   0,
		IdleTimeout:    60 * time.Second,
		MaxHeaderBytes: maxRequestHeaderBytes,
	}

	// The startup line is the boot's one-stop summary for a debugging reader:
	// where the process listens, how it logs, and which optional capabilities
	// this boot enabled. The media root path is deliberately NOT logged —
	// production logs must not disclose filesystem layout (the media
	// handler's own error policy states the same rule).
	log.logger.Info("naranjo.online listening",
		"addr", httpServer.Addr,
		"port", port,
		"log_format", log.format,
		"log_level", log.level,
		"media_enabled", mediaEnabled,
		"panels_refresh", panelsRefresh,
	)
	return serve(ctx, httpServer, log.logger)
}

// serve blocks until the server fails on its own or ctx requests a graceful
// shutdown, then bounds that shutdown with shutdownTimeout. It is separated
// from run so this orchestration can be exercised against a fake httpRunner
// while run keeps sole ownership of environment, signals, and the real
// listener. The shutdown path narrates itself — signal received, drain
// outcome — because a rollout that stalls inside the grace window is exactly
// the moment an operator is reading this log; the failure paths stay
// unlogged here and are reported once by main from the returned error.
func serve(ctx context.Context, server httpRunner, logger *slog.Logger) error {
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

	logger.Info("shutdown signal received", "drain_timeout", shutdownTimeout.String())
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		return err
	}
	logger.Info("server drained")
	return nil
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

// canonicalRoot turns an operator-supplied root into the one path the kernel
// would actually open, and it is the first half of the separation the
// 2026-08-25 round-4 review found missing at this boundary (finding 2).
//
// WHY LEXICAL CLEANING IS NOT ENOUGH, AND WHY THIS RESOLVES SYMLINKS. The
// chart refuses overlapping data and state roots, but the CHART IS NOT THE
// BOUNDARY — the binary is. The reviewer ran the exact shipped image with
// both roots set to one directory and watched it serve the staged document
// as `ok` while writing its floor marker beside the ciphertext it is
// supposed to only read. Everything this capability claims about a read-only
// projection and a separate writable surface was untrue in that
// configuration, and nothing in the process objected.
//
// String comparison cannot answer the question being asked. `/a` and `/a/`
// and `/a/../a` and `/a//b/..` are one directory spelled four ways, and
// `filepath.Clean` folds exactly those. A symlink is the same problem one
// level deeper: two entirely different-looking paths can be the same
// directory, and no amount of lexical work sees it. EvalSymlinks does, so it
// is what runs here.
//
// Resolution requires the directory to EXIST, which is deliberate rather
// than incidental: an unopenable root already fails this boot loudly as
// operator misconfiguration, so a root that cannot be resolved is refused on
// the same grounds instead of being carried forward as a string that might
// mean anything later. Messages name the variable and never the path.
func canonicalRoot(variable, value string) (string, error) {
	if !strings.HasPrefix(value, "/") {
		return "", errors.New(variable + " must be an absolute path")
	}
	resolved, err := filepath.EvalSymlinks(filepath.Clean(value))
	if err != nil {
		return "", errors.New(variable + " does not resolve to an existing directory")
	}
	info, err := os.Stat(resolved)
	if err != nil || !info.IsDir() {
		return "", errors.New(variable + " must name a directory")
	}
	return resolved, nil
}

// separateRoots refuses any overlap between the read-only data root and the
// writable state root, in BOTH directions, on already-canonical paths.
//
// The two roots carry opposite trust and the whole design rests on that: the
// data root is the pushed sealed series and is mounted read-only in every
// layer, while the state root is the single place this process may write. If
// the writable root sits inside the read-only one, the origin can write into
// the projection it must only read. If the read-only root sits inside the
// writable one, that is the same breach stated backwards. Equal roots are
// both at once.
//
// The trailing separator on each side is what makes the containment test
// exact: without it `/mnt/panels-data-two` reads as a child of
// `/mnt/panels-data`, and the check would refuse a perfectly good sibling
// while still missing real nesting elsewhere.
func separateRoots(dataRoot, stateRoot string) error {
	if dataRoot == stateRoot {
		return errors.New("PANELS_DATA_STATE and PANELS_DATA_ROOT resolve to the same directory; the writable state may never share the read-only projection")
	}
	if strings.HasPrefix(stateRoot, strings.TrimSuffix(dataRoot, "/")+"/") {
		return errors.New("PANELS_DATA_STATE resolves inside PANELS_DATA_ROOT; the writable state may never live within the read-only projection")
	}
	if strings.HasPrefix(dataRoot, strings.TrimSuffix(stateRoot, "/")+"/") {
		return errors.New("PANELS_DATA_ROOT resolves inside PANELS_DATA_STATE; the read-only projection may never live within the writable state")
	}
	return nil
}

// panelsDataConfiguration validates the optional panels data root path.
// Empty keeps the capability entirely absent — no root is opened and no loop
// starts — and a relative path fails the boot instead of being resolved
// against a working directory nobody chose on purpose. A set path is
// canonicalized, so everything downstream compares the directory rather than
// one of its spellings.
func panelsDataConfiguration(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	return canonicalRoot("PANELS_DATA_ROOT", value)
}

// panelsDataStateConfiguration validates the optional writable state path
// the replay-floor marker persists in (2026-08-24 review finding H2). Empty
// runs the data-root loop with the process-memory floor only — the
// documented degraded mode. Set, it demands the same absolute, resolvable
// shape as the data root, and it is meaningless without one: state describes
// where the data root's floor lives, so state-without-root is a
// misconfiguration that fails the boot loudly rather than dangling.
//
// It additionally refuses any overlap with the data root, in both directions
// (2026-08-25 round-4 review, finding 2). The chart enforces the same
// property at render time; both are kept because they guard different
// boundaries — a chart cannot constrain a hand-run container, and a binary
// cannot stop a bad values file from being applied.
func panelsDataStateConfiguration(value, dataRoot string) (string, error) {
	if value == "" {
		return "", nil
	}
	if dataRoot == "" {
		return "", errors.New("PANELS_DATA_STATE requires PANELS_DATA_ROOT")
	}
	stateRoot, err := canonicalRoot("PANELS_DATA_STATE", value)
	if err != nil {
		return "", err
	}
	if err := separateRoots(dataRoot, stateRoot); err != nil {
		return "", err
	}
	return stateRoot, nil
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

// listenHostConfiguration validates LISTEN_ADDRESS, an override that exists
// solely for the local dev loop (Makefile's `run`/`dev` targets set it to
// "127.0.0.1"; nothing else in this repository sets it). Empty is the ONLY
// other accepted value and is the deployed default: the Helm chart never
// sets this variable, so a production pod's Addr is unchanged by this
// function's existence — it still binds every interface inside the pod
// network, exactly as before. The allowlist is deliberately just these two
// values, not an arbitrary host string, because this is a narrow dev-loop
// safety valve, not a general bind-address feature.
func listenHostConfiguration(value string) (string, error) {
	switch value {
	case "":
		return "", nil
	case "127.0.0.1":
		return "127.0.0.1", nil
	}
	return "", errors.New("LISTEN_ADDRESS must be empty or 127.0.0.1")
}

// listenAddress builds the http.Server.Addr string from a validated host and
// port. An empty bindHost preserves net/http's own wildcard-bind behavior
// (":port"); no caller may pass an unvalidated bindHost — that validation
// lives once, in listenHostConfiguration, before this function ever runs.
func listenAddress(bindHost string, port int) string {
	return bindHost + ":" + strconv.Itoa(port)
}
