// types.go collects the command's type declarations and package-level
// constants so the process-lifecycle tuning values and orchestration seams can
// be surveyed in one place. The boot, serve, and configuration logic stays in
// main.go.

package main

import (
	"context"
	"time"
)

const (
	// maxRequestHeaderBytes bounds all request metadata, including conditional
	// Range headers that net/http must evaluate before the media-specific limit.
	maxRequestHeaderBytes = 32 * 1024
	// shutdownTimeout bounds graceful shutdown so a stuck connection cannot
	// hold a rollout open indefinitely. Kubernetes can still terminate the
	// process after this window.
	shutdownTimeout = 10 * time.Second
)

// httpRunner is the narrow serving surface the lifecycle orchestration in
// serve controls. *http.Server satisfies it directly; tests substitute a
// hand-written fake so early serve failures, signal-driven draining, and the
// bounded shutdown window can be verified deterministically under
// testing/synctest without binding sockets or waiting real time.
type httpRunner interface {
	// ListenAndServe blocks while serving, exactly like *http.Server: it
	// returns only on a serving failure or after Shutdown begins.
	ListenAndServe() error
	// Shutdown drains active connections within the context's deadline.
	Shutdown(ctx context.Context) error
}
