//go:build !unix

// filelock_other.go is the fail-closed half of the durable replay floor's
// locking primitive. The origin ships as a distroless Linux container and is
// developed on Unix hosts, so this file exists for one reason: a platform
// without flock(2) must REFUSE to persist a floor rather than persist one
// without the exclusion the contract promises. A store that cannot lock
// cannot commit, and a payload whose floor cannot be committed is never
// published — the panel keeps its last good payload and reports stale, which
// is the same fail-closed direction every other unavailable state takes.

package server

import (
	"errors"
	"os"
)

// lockExclusive refuses: this platform offers no advisory file lock, so the
// monotonic compare-and-swap the durable floor is built on cannot be made
// atomic here.
func lockExclusive(*os.File) (func() error, error) {
	return nil, errors.New("panels state root locking is unavailable on this platform")
}
