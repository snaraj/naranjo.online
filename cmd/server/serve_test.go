// serve_test verifies the process lifecycle orchestration against a
// hand-written httpRunner fake. Every case runs inside a testing/synctest
// bubble, so the 10-second shutdown bound is exercised exactly — including the
// stuck-drain worst case — in microseconds of real time, with no sockets, no
// sleeps, and no flakiness. The real listener behavior is covered separately
// by the end-to-end test in main_e2e_test.go.
package main

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"
	"testing/synctest"
	"time"
)

// fakeServer reproduces the two net/http behaviors serve depends on:
// ListenAndServe blocks until the server fails or Shutdown begins, and
// Shutdown honors its context while connections drain. It records every
// interaction so tests can verify the orchestration itself, not just the
// returned error.
type fakeServer struct {
	// listenErr is what ListenAndServe reports once released. The real server
	// returns http.ErrServerClosed after Shutdown begins.
	listenErr error
	// drainForever simulates a connection that never drains, leaving the
	// caller's shutdown context as the only way Shutdown can return.
	drainForever bool

	// release ends the ListenAndServe block. Shutdown triggers it exactly the
	// way net/http does: the listener closes before draining finishes.
	release sync.Once
	// released must be buffered by construction; see newFakeServer.
	released chan struct{}

	mu            sync.Mutex
	shutdownCalls int
	shutdownCtx   context.Context
}

// newFakeServer builds a fake whose ListenAndServe blocks until failed or
// shut down, mirroring the real server's lifecycle contract.
func newFakeServer(listenErr error) *fakeServer {
	return &fakeServer{listenErr: listenErr, released: make(chan struct{})}
}

// failNow makes ListenAndServe return immediately, modeling a startup
// failure such as an unbindable port.
func (f *fakeServer) failNow() *fakeServer {
	f.release.Do(func() { close(f.released) })
	return f
}

func (f *fakeServer) ListenAndServe() error {
	<-f.released
	return f.listenErr
}

func (f *fakeServer) Shutdown(ctx context.Context) error {
	f.mu.Lock()
	f.shutdownCalls++
	f.shutdownCtx = ctx
	f.mu.Unlock()
	// The listener stops accepting immediately, exactly like net/http, even
	// though established connections may still be draining below.
	f.release.Do(func() { close(f.released) })
	if f.drainForever {
		<-ctx.Done()
		return ctx.Err()
	}
	return nil
}

// calls reports how many times Shutdown ran, for exactly-once verification.
func (f *fakeServer) calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.shutdownCalls
}

// capturedDeadline exposes the shutdown context's deadline so tests can pin
// the documented bound rather than trusting a constant by name.
func (f *fakeServer) capturedDeadline() (time.Time, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.shutdownCtx == nil {
		return time.Time{}, false
	}
	return f.shutdownCtx.Deadline()
}

// TestShutdownBoundStaysInsideTheGracePeriod pins the documented value
// itself, not just its plumbing: the tests below prove Shutdown receives a
// deadline of exactly shutdownTimeout, so without this guard a changed
// constant would move every assertion with it and never fail anything. The
// chart deliberately relies on the Kubernetes default 30-second termination
// grace period; the drain bound must leave real headroom inside it.
func TestShutdownBoundStaysInsideTheGracePeriod(t *testing.T) {
	t.Parallel()
	if shutdownTimeout != 10*time.Second {
		t.Fatalf("shutdownTimeout = %v, want the documented 10s; changing it is a chart-contract decision, not a tuning knob", shutdownTimeout)
	}
}

// TestServePropagatesStartupFailure pins that a server that cannot listen
// reports its error unchanged and is never asked to shut down: the process
// must exit loudly so Kubernetes restarts it, not drain a listener that never
// existed.
func TestServePropagatesStartupFailure(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		listenErr := errors.New("listen tcp :8080: address already in use")
		server := newFakeServer(listenErr).failNow()
		if err := serve(t.Context(), server, quietLogger()); !errors.Is(err, listenErr) {
			t.Fatalf("serve() error = %v, want %v", err, listenErr)
		}
		if got := server.calls(); got != 0 {
			t.Errorf("Shutdown ran %d times for a startup failure, want 0", got)
		}
	})
}

// TestServeTreatsServerClosedAsClean pins the ErrServerClosed translation:
// an orderly close initiated elsewhere is a success, never a restart-worthy
// failure surfaced to the operator.
func TestServeTreatsServerClosedAsClean(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		server := newFakeServer(http.ErrServerClosed).failNow()
		if err := serve(t.Context(), server, quietLogger()); err != nil {
			t.Fatalf("serve() error = %v, want nil for ErrServerClosed", err)
		}
		if got := server.calls(); got != 0 {
			t.Errorf("Shutdown ran %d times, want 0", got)
		}
	})
}

// TestServeShutsDownOnceWithTheDocumentedBound proves the signal path calls
// Shutdown exactly once and hands it a context whose deadline is exactly
// shutdownTimeout from the moment of cancellation — the contract the Helm
// chart's termination grace period is sized against.
func TestServeShutsDownOnceWithTheDocumentedBound(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		server := newFakeServer(http.ErrServerClosed)
		start := time.Now()
		if err := serve(ctx, server, quietLogger()); err != nil {
			t.Fatalf("serve() error = %v, want nil after graceful drain", err)
		}
		if got := server.calls(); got != 1 {
			t.Fatalf("Shutdown ran %d times, want exactly 1", got)
		}
		deadline, ok := server.capturedDeadline()
		if !ok {
			t.Fatal("shutdown context has no deadline; a stuck connection could hold rollouts open forever")
		}
		// The synctest fake clock is deterministic, so the deadline is exact.
		if want := start.Add(shutdownTimeout); !deadline.Equal(want) {
			t.Errorf("shutdown deadline = %v, want %v", deadline, want)
		}
	})
}

// TestServeBoundsAShutdownThatCannotDrain simulates the worst case: a
// connection that never finishes. serve must give up at exactly
// shutdownTimeout and surface the deadline error. Under synctest the fake
// clock makes those 10 seconds elapse instantly and exactly.
func TestServeBoundsAShutdownThatCannotDrain(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		server := newFakeServer(http.ErrServerClosed)
		server.drainForever = true
		start := time.Now()
		err := serve(ctx, server, quietLogger())
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("serve() error = %v, want context.DeadlineExceeded", err)
		}
		if elapsed := time.Since(start); elapsed != shutdownTimeout {
			t.Errorf("shutdown gave up after %v, want exactly %v", elapsed, shutdownTimeout)
		}
	})
}
