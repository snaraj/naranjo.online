package panels

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"testing"
	"testing/fstest"
	"testing/synctest"
	"time"
)

// runRetainingLoop is runMarkeredLoop with an explicit clock, for the
// retained-copy tests (issue #358): a restart's clock is the variable under
// test here.
func runRetainingLoop(t *testing.T, fsys fs.FS, marker *FloorMarker, now func() time.Time) (Envelope, context.CancelFunc) {
	t.Helper()
	reg, state := usageDataRootRegistry(t, synctestSnapshot)
	ctx, cancel := context.WithCancel(context.Background())
	reg.startDataRoot(ctx, fsys, productionUnsealer(dataRootTestKeyHex), marker, now)
	synctest.Wait()
	envelope, _ := decodeServedUsage(t, state)
	return envelope, cancel
}

// TestDataRootRestoresTheRetainedDocumentWhenTheClockIsBehind is the issue
// #358 incident, replayed. A process accepts a push and keeps it; the host
// reboots with its clock weeks behind; the restarted process reads an
// authentic marker that is now "in the future" and refuses every tick. Before
// retention it served the RELEASE snapshot for as long as the clock stayed
// wrong. It must serve the document the marker names, as stale, without
// moving the floor and without admitting the newer file it cannot date.
func TestDataRootRestoresTheRetainedDocumentWhenTheClockIsBehind(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		const weeks = 39 * 24 * time.Hour
		ahead := func() time.Time { return time.Now().Add(weeks) }
		shared := &fakeMarker{retains: true}
		acceptedAt := ahead().UTC().Format(time.RFC3339)
		envelope, cancel := runRetainingLoop(t, seriesFS(sealDocument(t, synctestDocument(acceptedAt))), shared.marker(), ahead)
		if envelope.Status != StatusOK || envelope.GeneratedAt != acceptedAt {
			t.Fatalf("first process: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
		cancel()
		synctest.Wait()
		if shared.retainCalls != 1 || shared.storeCalls != 1 {
			t.Fatalf("the acceptance retained %d and stored %d times, want 1 and 1", shared.retainCalls, shared.storeCalls)
		}

		// The restart: the bubble's own clock, 39 days behind the floor, and a
		// newer push on the volume that this clock cannot date.
		newer := ahead().Add(5 * time.Minute).UTC().Format(time.RFC3339)
		envelope, cancel = runRetainingLoop(t, seriesFS(sealDocument(t, synctestDocument(newer))), shared.marker(), time.Now)
		defer cancel()
		if envelope.GeneratedAt != acceptedAt {
			t.Fatalf("the restart serves generatedAt %q, want the retained %q (not the release snapshot, not the undatable push)", envelope.GeneratedAt, acceptedAt)
		}
		if envelope.Status != StatusStale {
			t.Fatalf("a restored copy is served %q; a clock this wrong proves nothing current", envelope.Status)
		}

		// Ticks keep refusing while the clock is wrong; none of them, and not
		// the restore, may write the floor.
		time.Sleep(3 * dataRootTTL)
		synctest.Wait()
		if shared.storeCalls != 1 {
			t.Fatalf("the restart wrote the floor (%d stores); restoring must never move it", shared.storeCalls)
		}
	})
}

// TestDataRootRestoresTheRetainedDocumentWhenTheSourceIsGone covers the
// ordinary restart that finds no file on the data volume: the kept copy is
// served stale instead of the release snapshot.
func TestDataRootRestoresTheRetainedDocumentWhenTheSourceIsGone(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		shared := &fakeMarker{retains: true}
		acceptedAt := time.Now().UTC().Format(time.RFC3339)
		_, cancel := runRetainingLoop(t, seriesFS(sealDocument(t, synctestDocument(acceptedAt))), shared.marker(), time.Now)
		cancel()
		synctest.Wait()

		time.Sleep(time.Minute)
		envelope, cancel := runRetainingLoop(t, &lockedFS{inner: fstest.MapFS{}}, shared.marker(), time.Now)
		defer cancel()
		if envelope.GeneratedAt != acceptedAt || envelope.Status != StatusStale {
			t.Fatalf("restart without a source: status %q generatedAt %q, want stale %q", envelope.Status, envelope.GeneratedAt, acceptedAt)
		}
	})
}

// TestDataRootRestoreRefusesACopyTheMarkerDoesNotName is the binding. The
// copy is kept BEFORE the floor commit, so a commit that fails leaves a kept
// document NEWER than the floor — one that was never published, because the
// commit is what permits publication. Restoring it would publish ahead of the
// persisted floor, the exact ordering the 2026-08-24 review refused; the
// replay floor cannot catch it (the document is newer, not older), and the
// marker's digest is the only thing that does.
func TestDataRootRestoreRefusesACopyTheMarkerDoesNotName(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		shared := &fakeMarker{retains: true}
		committedAt := time.Now().UTC().Format(time.RFC3339)
		_, cancel := runRetainingLoop(t, seriesFS(sealDocument(t, synctestDocument(committedAt))), shared.marker(), time.Now)
		cancel()
		synctest.Wait()

		// The next push is kept, then its commit fails: never published.
		time.Sleep(time.Minute)
		shared.failStoring(errors.New("state volume full"))
		uncommittedAt := time.Now().UTC().Format(time.RFC3339)
		envelope, cancel := runRetainingLoop(t, seriesFS(sealDocument(t, synctestDocument(uncommittedAt))), shared.marker(), time.Now)
		cancel()
		synctest.Wait()
		if envelope.GeneratedAt == uncommittedAt {
			t.Fatal("precondition: a document whose commit failed was published")
		}

		shared.failStoring(nil)
		envelope, cancel = runRetainingLoop(t, &lockedFS{inner: fstest.MapFS{}}, shared.marker(), time.Now)
		defer cancel()
		if envelope.GeneratedAt == uncommittedAt {
			t.Fatal("a kept copy the marker does not name — never committed, never published — was restored")
		}
	})
}

// TestRestoreNarratesEveryOutcomeInTheClosedVocabulary drives restoreRetained
// through each outcome and reads the operator's log: a restore says so once,
// and every refusal speaks one closed reason code and never serves the copy.
func TestRestoreNarratesEveryOutcomeInTheClosedVocabulary(t *testing.T) {
	t.Parallel()
	good := sealDocument(t, synctestDocument(fixedNow().UTC().Format(time.RFC3339)))
	garbage := []byte("not a sealed document at all")
	cases := []struct {
		name     string
		kept     func() ([]byte, error)
		digest   string
		reason   string
		restored bool
	}{
		{"restored", func() ([]byte, error) { return good, nil }, sealedDigest(good), "", true},
		{"mismatch", func() ([]byte, error) { return good, nil }, sealedDigest(garbage), reasonRetainedMismatch, false},
		{"unreadable", func() ([]byte, error) { return nil, errors.New("io") }, sealedDigest(good), reasonRetainedUnreadable, false},
		{"refused", func() ([]byte, error) { return garbage, nil }, sealedDigest(garbage), reasonRetainedRefused, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			reg, state := usageDataRootRegistry(t, dataRootSnapshot)
			out := &safeBuffer{}
			reg.logger = slog.New(slog.NewJSONHandler(out, nil))
			floor := FloorState{Instant: fixedNow(), Digest: tc.digest}
			reg.restoreRetained(t.Context(), state, tc.kept, productionUnsealer(dataRootTestKeyHex), fixedNow, floor)
			records := refreshLogRecords(t, out.String())
			envelope, _ := decodeServedUsage(t, state)
			served := envelope.GeneratedAt == fixedNow().UTC().Format(time.RFC3339)
			if served != tc.restored {
				t.Fatalf("served the kept copy = %v, want %v", served, tc.restored)
			}
			refusal := findRecord(records, "token usage retained copy not restored")
			if tc.restored {
				if findRecord(records, "token usage restored from the retained copy") == nil || refusal != nil {
					t.Fatalf("a restore was not narrated as one: %v", records)
				}
				return
			}
			if refusal == nil || refusal["reason"] != tc.reason {
				t.Fatalf("refusal record %v, want reason %q", refusal, tc.reason)
			}
		})
	}
}

// TestRestoredCopyIsAlwaysServedStale pins restoreRetained's own contract,
// below the loop: a kept copy proves what was last published and nothing
// about what has been captured since, so it is `stale` even when its capture
// instant is well inside the freshness grace. (Inside the loop the next stage
// re-decides the status anyway, which is why this is pinned here.)
func TestRestoredCopyIsAlwaysServedStale(t *testing.T) {
	t.Parallel()
	reg, state := usageDataRootRegistry(t, dataRootSnapshot)
	sealed := sealDocument(t, synctestDocument(fixedNow().UTC().Format(time.RFC3339)))
	floor := FloorState{Instant: fixedNow(), Digest: sealedDigest(sealed)}
	kept := func() ([]byte, error) { return sealed, nil }
	reg.restoreRetained(t.Context(), state, kept, productionUnsealer(dataRootTestKeyHex), fixedNow, floor)
	envelope, _ := decodeServedUsage(t, state)
	if envelope.GeneratedAt != fixedNow().UTC().Format(time.RFC3339) {
		t.Fatalf("the kept copy was not restored: generatedAt %q", envelope.GeneratedAt)
	}
	if envelope.Status != StatusStale {
		t.Fatalf("a restored copy inside the freshness grace was served %q", envelope.Status)
	}
}

// TestDataRootRestoreNeverDowngradesTheEmbeddedSnapshot: a marker at or below
// the release snapshot's own instant restores nothing, because the snapshot
// the binary ships is then the newer of the two.
func TestDataRootRestoreNeverDowngradesTheEmbeddedSnapshot(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		// The synctest snapshot is dated 1999-12-31; the bubble starts on
		// 2000-01-01. A copy kept at an instant BEFORE the snapshot's is
		// authentic and named by the marker, and still must not be served.
		olderThanSnapshot := "1999-12-30T00:00:00Z"
		sealed := sealDocument(t, synctestDocument(olderThanSnapshot))
		instant, _ := time.Parse(time.RFC3339, olderThanSnapshot)
		shared := &fakeMarker{retains: true, ok: true, instant: instant, digest: sealedDigest(sealed), retained: sealed}
		envelope, cancel := runRetainingLoop(t, &lockedFS{inner: fstest.MapFS{}}, shared.marker(), time.Now)
		defer cancel()
		if envelope.GeneratedAt == olderThanSnapshot {
			t.Fatal("a kept copy older than the release snapshot replaced it")
		}
	})
}

// TestDataRootRetainFailureNeverBlocksPublication pins the asymmetry the
// FloorMarker doc states: the floor commit refuses publication, the kept
// copy does not.
func TestDataRootRetainFailureNeverBlocksPublication(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		shared := &fakeMarker{retains: true, retainErr: errors.New("state volume full")}
		acceptedAt := time.Now().UTC().Format(time.RFC3339)
		envelope, cancel := runRetainingLoop(t, seriesFS(sealDocument(t, synctestDocument(acceptedAt))), shared.marker(), time.Now)
		defer cancel()
		if envelope.Status != StatusOK || envelope.GeneratedAt != acceptedAt {
			t.Fatalf("a failed retain blocked publication: status %q generatedAt %q", envelope.Status, envelope.GeneratedAt)
		}
		if shared.retainCalls != 1 || shared.storeCalls != 1 {
			t.Fatalf("retained %d and stored %d times, want 1 and 1", shared.retainCalls, shared.storeCalls)
		}
	})
}
