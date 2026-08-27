//go:build unix

// filelock_unix.go carries the one platform-specific primitive the durable
// replay floor needs: an exclusive advisory lock over the state directory's
// lock file, so a store's load-compare-write-rename is one critical section
// (2026-08-24 round-3 review, finding 3 — two processes over one state
// directory stored T3 then T2 and both reported success).
//
// flock(2) is the right primitive here and its limits are worth stating: it
// is advisory, per open-file-description, and released automatically when the
// descriptor closes or the process dies, so a crash mid-store cannot leave a
// stale lock wedged. It coordinates writers on ONE host, which is exactly the
// scope of the claim — cross-host exclusion is the storage layer's job. The
// chart's part of that is a single-replica render; it does NOT include a
// ReadWriteOncePod claim, which round 3 believed and the 2026-08-25 round-4
// review corrected: that mode is CSI-only and the target has no CSI driver.
// So this lock plus the monotonic compare-and-swap above it is not a
// belt-and-braces echo of a storage guarantee — on this target it IS the
// enforcement, which is why an equal instant with a different ciphertext
// digest is refused rather than accepted as a harmless replay.

package server

import (
	"errors"
	"os"
	"syscall"
)

// lockExclusive takes an exclusive advisory lock on file and returns the
// release. It blocks until the lock is available: the caller is committing an
// acceptance, and waiting for the other writer to finish is exactly right —
// the alternative, refusing on contention, would turn a normal overlap into a
// refusal to publish.
func lockExclusive(file *os.File) (func() error, error) {
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX); err != nil {
		return nil, errors.New("panels state root could not be locked")
	}
	return func() error {
		return syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
	}, nil
}
