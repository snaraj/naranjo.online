// dataroot.go runs the panels data-root loop (issue #142): a background
// re-read of ONE sealed usage-series file from a mounted read-only directory,
// pushed out-of-band from the workstation that records the usage. It is the
// runtime continuation of the embedded snapshot — the same recorded data,
// delivered without a release — and it inherits the snapshot path's whole
// posture: strict decoding, closed vocabularies, fail-closed on every fault,
// and provenance that says recorded because it is.
//
// Trust boundary. The mounted root arrives from cluster storage on a host
// this process must treat as potentially hostile, so nothing in the file is
// believed before it survives, in order: a byte cap, AEAD authentication
// (internal/seal — a tampered or truncated file fails decryption loudly),
// strict JSON decoding with unknown fields refused, schema and calendar
// validation, replay/rollback/future-skew checks on the capture instant,
// label admission against the embedded snapshot (a file can never invent a
// source), closed window/derived vocabularies (a file can never put new words
// or tiles on the panel), category partition arithmetic, and finally the
// shared response-budget gate. Any failure keeps the last good payload and
// marks it stale — never a crash, never fabricated data, never a partial
// merge.
//
// Capability injection keeps this file inside the package's reviewed
// zero-egress import surface (doctrine_test): the composition root injects
// BOTH the rooted read-only filesystem (an fs.FS opened via os.OpenRoot in
// internal/server, the media subsystem's exact pattern) and the Unsealer
// that authenticates and decrypts the file (internal/seal, wired in
// internal/server, reading the key from its Secret-fed environment variable
// at decrypt time only). This package therefore gains no filesystem, no
// environment, and no key-holding capability of its own — it can only read
// what it was rooted onto and only believe what the injected AEAD accepts.

package panels

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"time"
)

// Unsealer authenticates and decrypts one sealed series file. The concrete
// implementation lives with the composition root; a failed unseal — wrong
// key, missing key, tampered or truncated bytes — returns an error and never
// partial plaintext.
type Unsealer func(sealed []byte) ([]byte, error)

// FloorMarker persists the replay floor — the capture instant of the last
// PUBLISHED series file — across process restarts (2026-08-24 review finding
// H2: a floor seeded only from the embedded snapshot and advanced in process
// memory re-admits, after any restart, every replayed ciphertext newer than
// the snapshot but older than what was already accepted). The concrete
// implementation lives with the composition root, exactly like the Unsealer:
// this package gains no write capability of its own.
//
// DURABLE MODE FAILS CLOSED (2026-08-24 review finding 2). A non-nil marker
// with both functions set means the deployment asked for a durable floor, and
// a durable floor that cannot be read or written is a broken guarantee, not a
// reason to serve anyway on a weaker one:
//   - Load returns (floor, true, nil) for a marker that authenticates and
//     parses, (zero, false, nil) for the genuinely ABSENT marker of a
//     NEVER-USED state directory — the benign cold state — and a non-nil
//     error for everything else: unreadable, oversized, unauthentic,
//     unparsable, sealed under a superseded key, or missing from a state
//     directory that has already recorded a floor. An error refuses
//     acceptance and reports stale, and the loop retries the load on the next
//     tick so an operator repair recovers without a restart. It never
//     silently reverts to the embedded floor, which is exactly the downgrade
//     the review reproduced — first by corrupting the marker, then by simply
//     DELETING it (2026-08-24 round-3 review, finding 4).
//   - A Load instant beyond dataRootFutureSkew is refused the same way. A
//     floor is only ever written from an instant this loop already bounded
//     against the local clock, so one from the future means the clock moved
//     backwards or the state was tampered with; serving on a silently lowered
//     floor would be the weaker of the two failures.
//   - Store is the COMMIT of an acceptance and runs BEFORE publication. A
//     Store failure means the payload is not published at all: the last good
//     payload keeps serving, the envelope says stale, the in-memory floor
//     does NOT rise, and the next tick retries the same file. Publishing
//     ahead of the persisted floor is what let a restart re-admit an older
//     authentic file after a failed write. Store is also MONOTONIC and
//     exclusive: it refuses to record an instant below the persisted one, so
//     two writers over one state directory cannot lower a shared floor
//     between them (2026-08-24 round-3 review, finding 3).
//
// A nil FloorMarker (or either field nil) runs the loop with the
// process-memory floor only — the documented degraded mode for deployments
// without a writable state root, unchanged by this contract.
type FloorMarker struct {
	// Load reads the persisted floor. (zero, false, nil) is the absent
	// marker of a never-used state directory; a non-nil error is a floor
	// that exists, or existed, and cannot be trusted.
	Load func() (FloorState, bool, error)
	// Store durably records a newly accepted floor. It is the commit point:
	// its success is what permits publication.
	Store func(FloorState) error
}

// errSeriesUnchanged reports a series file whose capture instant equals the
// last accepted one — the normal state between pushes. Nothing is wrong and
// nothing is replaced; the loop must not mark the panel stale over it.
var errSeriesUnchanged = errors.New("data root: series file unchanged")

// StartDataRoot launches the data-root loop with the production clock. It is
// explicitly invoked by the composition root, never by construction, and a
// canceled context stops the loop before any further read. The marker may be
// nil where no writable state root exists; the loop then runs with the
// process-memory floor only.
func (reg *Registry) StartDataRoot(ctx context.Context, fsys fs.FS, unseal Unsealer, marker *FloorMarker) {
	reg.startDataRoot(ctx, fsys, unseal, marker, time.Now)
}

// startDataRoot launches the data-root loop over the injected filesystem,
// unsealer, marker, and clock. Idempotent, returns immediately, and starts
// nothing when the registry serves no token-usage panel or the required
// capabilities are absent.
func (reg *Registry) startDataRoot(ctx context.Context, fsys fs.FS, unseal Unsealer, marker *FloorMarker, now func() time.Time) {
	if fsys == nil || unseal == nil || now == nil {
		return
	}
	if !reg.dataRootStarted.CompareAndSwap(false, true) {
		return
	}
	state, ok := reg.byID[dataRootPanelID]
	if !ok {
		return
	}
	// Claim ownership BEFORE the loop exists, so the live-refresh path can
	// never observe a started data root without its ownership (2026-08-24
	// review finding 8).
	reg.dataRootOwnsPanel.Store(true)
	go reg.dataRootLoop(ctx, state, fsys, unseal, marker, now)
}

// DataRootOwnsTokenUsage reports whether the sealed data-root path owns the
// token-usage panel. The composition root reads it to log the decision once
// at startup; nothing depends on it for correctness, which is enforced
// inside the refresh path itself.
func (reg *Registry) DataRootOwnsTokenUsage() bool {
	return reg.dataRootOwnsPanel.Load()
}

// dataRootLoop re-reads the sealed series on the TTL cadence: an immediate
// first attempt, then steady dataRootTTL wakes. The published-instant floor
// starts at the HIGHER of the embedded snapshot's own generatedAt and the
// persisted marker's instant, and only ever rises, so a replayed older
// file — one older than the binary's own snapshot OR older than what a
// previous process published — can never roll the panel back (2026-08-24
// review finding H2: without the marker, a restart forgot every acceptance).
//
// In durable mode the floor is resolved from the marker before ANY attempt,
// and an unreadable or future-dated marker refuses the tick outright instead
// of quietly reverting to the embedded floor (2026-08-24 review finding 2).
// Resolution is retried on each tick, so the documented reset ceremony
// recovers the loop without a restart. That ceremony is the only thing that
// does: a fresh push cannot, because the floor is resolved BEFORE any
// document is considered (2026-08-25 round-4 review, finding 6).
//
// One deliberate asymmetry: when the floor came from the marker, the FIRST
// acceptance of this process may equal it exactly — that is the very file
// the previous process published, and re-serving it at boot is recovery, not
// replay. Equality alone was too weak a key for that door (2026-08-24 round-3
// review, finding 2): a DIFFERENT authentic document sharing the instant was
// admitted once per restart. The marker therefore carries the digest of the
// exact ciphertext it recorded, and recovery admits equality only when the
// file on disk is that same ciphertext. After anything has been published
// in-process, equality is again the ordinary unchanged state between pushes.
func (reg *Registry) dataRootLoop(ctx context.Context, state *panelState, fsys fs.FS, unseal Unsealer, marker *FloorMarker, now func() time.Time) {
	floor := FloorState{Instant: reg.embeddedUsageInstant(state)}
	floorFromMarker := false
	// markerPresent records that a floor was ALREADY persisted before this
	// process started — proof that some process published a document from
	// this state directory. It is what makes an absent source file a
	// provenance loss on the FIRST tick after a restart rather than only
	// after this process has published something itself (2026-08-24 round-3
	// review, finding 6).
	markerPresent := false
	// Durable mode needs BOTH halves: a floor that can be read but not
	// written, or written but not read, is not a floor that survives a
	// restart. Either missing leaves the documented process-memory mode.
	durable := marker != nil && marker.Load != nil && marker.Store != nil
	floorResolved := !durable
	var commit func(FloorState) error
	if durable {
		commit = marker.Store
	}
	acceptedInProcess := false
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		if ctx.Err() != nil {
			return
		}
		if !floorResolved {
			persisted, present, err := marker.Load()
			switch {
			case err != nil, present && persisted.Instant.After(now().Add(dataRootFutureSkew)):
				// The deployment asked for a durable floor and the state
				// backing it is unreadable, nonsensical, sealed under a
				// superseded key, or GONE from a directory that had already
				// recorded one. Serving on the embedded floor here would
				// silently re-admit everything a previous process already
				// published past — the exact downgrade findings 2 and 4
				// reproduced — so the tick is refused and the envelope says
				// so. The next tick retries the load.
				reg.markStale(state)
				timer.Reset(dataRootTTL)
				continue
			case present:
				markerPresent = true
				if persisted.Instant.After(floor.Instant) {
					// A marker at or below the embedded floor adds no
					// INSTANT: the embedded one is already the stronger
					// bound. Its digest is still recorded, because recovery
					// asks a different question — "is this the same file?" —
					// and that answer is useful at any instant.
					floor = persisted
					floorFromMarker = true
				} else {
					floor.Digest = persisted.Digest
					floorFromMarker = persisted.Instant.Equal(floor.Instant)
				}
			}
			floorResolved = true
		}
		allowEqual := floorFromMarker && !acceptedInProcess
		accepted, err := reg.refreshFromDataRoot(state, fsys, unseal, now, floor, allowEqual, commit)
		switch {
		case err == nil:
			floor = accepted
			acceptedInProcess = true
		case errors.Is(err, errSeriesUnchanged):
			// The ordinary state between pushes: the same file, already
			// published, still there. Nothing is wrong.
		case errors.Is(err, fs.ErrNotExist):
			// An absent file means two different things, and conflating them
			// let a deleted document keep the envelope `ok` forever
			// (2026-08-24 review finding 5). BEFORE anything was ever
			// published it is the ordinary cold state — no push has happened
			// yet, and the embedded snapshot is exactly what the panel should
			// be serving. AFTER a publication it is provenance loss: the
			// runtime document this panel serves from has DISAPPEARED, the
			// data stands, its freshness does not, and the envelope has to
			// say so.
			//
			// "Ever published" is the persisted marker, not this process's
			// own memory. Binding it to in-process acceptance alone meant a
			// restarted pod with a valid floor marker and no source file
			// served `ok` on its first tick, claiming a freshness whose
			// evidence it had just failed to find (2026-08-24 round-3
			// review, finding 6).
			if acceptedInProcess || markerPresent {
				reg.markStale(state)
			}
		default:
			// File present but unreadable, unauthentic, malformed, replayed,
			// refused — or accepted but not committable to the durable
			// floor: keep serving the last good payload and let the
			// envelope's status say it is no longer fresh.
			reg.markStale(state)
		}
		timer.Reset(dataRootTTL)
	}
}

// snapshotForState resolves the snapshot source behind one panel: a plain
// snapshot panel's own file, or a fetch-backed panel's embedded fallback.
func snapshotForState(state *panelState) (SnapshotSource, bool) {
	switch source := state.definition.source.(type) {
	case SnapshotSource:
		return source, true
	case *FetchSource:
		return source.fallback, true
	default:
		return SnapshotSource{}, false
	}
}

// embeddedUsageInstant recovers the embedded snapshot's capture instant, the
// initial replay floor. A snapshot that cannot be loaded or dated yields the
// zero instant: the panel is degraded anyway, and a working disk series is
// then better than nothing.
func (reg *Registry) embeddedUsageInstant(state *panelState) time.Time {
	snapshot, ok := snapshotForState(state)
	if !ok {
		return time.Time{}
	}
	loaded, err := snapshot.load(reg.snapshots, state.definition.kind)
	if err != nil {
		return time.Time{}
	}
	instant, err := time.Parse(time.RFC3339, loaded.generatedAt)
	if err != nil {
		return time.Time{}
	}
	return instant
}

// refreshFromDataRoot performs one complete read-validate-merge-commit-swap
// attempt and returns the accepted floor. Every return before the final swap
// leaves the served payload untouched. allowEqual admits a file whose instant
// EQUALS the floor — only the loop's first, marker-floored attempt sets it,
// so a restarted process re-serves exactly what it last published — and only
// when the file's ciphertext digest is the one the marker recorded, so
// "recovery" means the SAME document rather than any document that happens to
// share an instant (2026-08-24 round-3 review, finding 2).
//
// commit is the durable floor's write and is the LAST gate before
// publication (2026-08-24 review finding 2). Ordering is the whole point:
// publishing first and persisting afterwards means a failed write leaves a
// process serving an instant no restart can remember, and the next boot
// re-admits an older authentic file as fresh. A nil commit is the documented
// process-memory mode, where there is no durable floor to get ahead of.
func (reg *Registry) refreshFromDataRoot(state *panelState, fsys fs.FS, unseal Unsealer, now func() time.Time, floor FloorState, allowEqual bool, commit func(FloorState) error) (FloorState, error) {
	sealed, err := readBoundedFile(fsys, dataRootSeriesName, maxSealedSeriesBytes)
	if err != nil {
		return FloorState{}, err
	}
	digest := sealedDigest(sealed)
	plaintext, err := unseal(sealed)
	if err != nil {
		return FloorState{}, err
	}
	var document usageSeriesDocument
	if err := decodeStrict(plaintext, &document); err != nil {
		return FloorState{}, fmt.Errorf("data root: %w", err)
	}
	instant, err := admitSeriesInstant(document, floor, digest, now(), allowEqual)
	if err != nil {
		return FloorState{}, err
	}
	fallback, err := reg.loadSnapshotUsageData(state)
	if err != nil {
		return FloorState{}, err
	}
	merged, provenance, err := mergeSeriesDocument(document, fallback, now())
	if err != nil {
		return FloorState{}, err
	}
	raw, err := json.Marshal(merged)
	if err != nil {
		return FloorState{}, err
	}
	canonical, err := decodeKindPayload(state.definition.kind, raw)
	if err != nil {
		return FloorState{}, err
	}
	served, err := state.definition.prepare(loadedPayload{
		generatedAt: provenance,
		data:        canonical,
		status:      StatusOK,
	})
	if err != nil {
		return FloorState{}, err
	}
	accepted := FloorState{Instant: instant, Digest: digest}
	// Commit the floor, THEN publish. A failed commit publishes nothing: the
	// caller keeps its floor where it is, the last good payload keeps
	// serving, and the same file is retried on the next tick.
	if commit != nil {
		if err := commit(accepted); err != nil {
			return FloorState{}, fmt.Errorf("data root: the replay floor could not be persisted, so the payload is not published: %w", err)
		}
	}
	state.current.Store(served)
	reg.rebuildIndex()
	return accepted, nil
}

// sealedDigest identifies one ciphertext. It is what binds a persisted floor
// to the exact file that set it, so restart recovery can tell "the document
// my predecessor published" from "a document sharing its instant".
func sealedDigest(sealed []byte) string {
	sum := sha256.Sum256(sealed)
	return hex.EncodeToString(sum[:])
}

// readBoundedFile reads one file through the rooted filesystem under a hard
// byte cap, refusing rather than truncating an oversized file.
func readBoundedFile(fsys fs.FS, name string, cap int64) ([]byte, error) {
	file, err := fsys.Open(name)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, cap+1))
	if err != nil {
		return nil, fmt.Errorf("data root: read %s: %w", name, err)
	}
	if int64(len(data)) > cap {
		return nil, fmt.Errorf("data root: %s exceeds the %d byte bound", name, cap)
	}
	return data, nil
}

// admitSeriesInstant validates the document identity and its capture instant
// against the replay floor and the local clock.
//
// EQUALITY WITH THE FLOOR IS DECIDED BY THE DOCUMENT, NOT BY THE CLOCK. The
// instant alone cannot tell three different situations apart, and the digest
// can, so the digest is asked first (2026-08-24 round-3 review finding 2;
// 2026-08-25 round-4 review finding 3):
//
//   - Same digest, not recovering: the ordinary steady state between pushes.
//     The exact file this process already published is still there, nothing
//     is wrong, and errSeriesUnchanged says exactly that.
//   - Same digest, recovering: a restarted process re-reading what its
//     predecessor published. That is recovery, and it is admitted — once, on
//     the first marker-floored attempt.
//   - A DIFFERENT digest at that instant: refused, in BOTH states.
//
// The round-3 repair asked `!recovering` FIRST, which meant the digest was
// never consulted while the loop was simply running. The reviewer replaced an
// accepted document with a different authentic document at the same instant
// and the panel kept serving the old envelope at `status: ok` — the source on
// the volume was no longer the source the panel claimed to be serving from,
// and nothing said so. Restart-only binding is not binding; it is a check
// that happens to run at boot.
//
// The empty-digest case is refused too, and that is deliberate rather than
// incidental. A floor with no recorded digest is the pre-acceptance
// process-memory state, where the floor is the embedded snapshot's own
// instant. A pushed document landing on exactly that instant is not something
// this process published, carries no more freshness than the snapshot it
// equals, and cannot be distinguished from a crafted replay. Refusing states
// the ambiguity instead of resolving it in the pusher's favour.
func admitSeriesInstant(document usageSeriesDocument, floor FloorState, digest string, current time.Time, recovering bool) (time.Time, error) {
	if document.Schema != usageSeriesSchema {
		return time.Time{}, fmt.Errorf("data root: schema %q is not %q", document.Schema, usageSeriesSchema)
	}
	instant, err := time.Parse(time.RFC3339, document.GeneratedAt)
	if err != nil {
		return time.Time{}, fmt.Errorf("data root: generatedAt: %w", err)
	}
	if instant.Equal(floor.Instant) {
		switch {
		case floor.Digest == "":
			return time.Time{}, errors.New("data root: the series file shares the instant of a floor recorded without a document identity; refused")
		case floor.Digest != digest:
			return time.Time{}, errors.New("data root: the series file is a different document at the instant already accepted; refused")
		case !recovering:
			return time.Time{}, errSeriesUnchanged
		}
		// Same digest while recovering: the exact document the previous
		// process published.
	}
	if instant.Before(floor.Instant) {
		return time.Time{}, errors.New("data root: the series file is older than the data already accepted; replay refused")
	}
	if instant.After(current.Add(dataRootFutureSkew)) {
		return time.Time{}, errors.New("data root: the series file claims a future capture instant")
	}
	return instant, nil
}

// loadSnapshotUsageData loads the panel's own snapshot as the merge base, so
// every merge starts from the shipped floor rather than compounding on
// earlier merges.
func (reg *Registry) loadSnapshotUsageData(state *panelState) (TokenUsageData, error) {
	snapshot, ok := snapshotForState(state)
	if !ok {
		return TokenUsageData{}, errors.New("data root: the panel has no snapshot source to merge onto")
	}
	loaded, err := snapshot.load(reg.snapshots, state.definition.kind)
	if err != nil {
		return TokenUsageData{}, fmt.Errorf("data root: embedded fallback: %w", err)
	}
	var fallback TokenUsageData
	if err := json.Unmarshal(loaded.data, &fallback); err != nil {
		return TokenUsageData{}, fmt.Errorf("data root: embedded fallback: %w", err)
	}
	return fallback, nil
}

// mergeSeriesDocument overlays the document onto the embedded fallback and
// returns both the merged payload and the instant that HONESTLY describes it.
// For every source section — each of which must name an existing snapshot
// label — the series (with categories), the complete set of derived tiles,
// and the complete window set are replaced; every figure the document does
// not claim to measure (lifetime totals, session counts, insights) is left
// exactly as the snapshot shipped it, still carrying its own `recorded`
// provenance. Any invalid section refuses the WHOLE document: a partial merge
// would serve a payload nobody produced.
//
// Three separate rules make one envelope honest about a multi-source payload,
// and all three were review findings.
//
// SET EQUALITY (2026-08-24 review finding 7). The document's source set must
// EQUAL the shipped set. Accepting a subset and backfilling the rest from the
// embedded snapshot produced a payload stamped `ok` at the pushed instant
// while part of it was release-time data of an entirely different age.
//
// COMPLETE SECTIONS (2026-08-24 round-3 review, finding 5). `windows` and
// `derived` used to be optional, and an absent section left the snapshot's
// release-age figures in place beside runtime-age ones under one instant. A
// section is a whole section now: every window key and every series-derived
// tile the vocabulary defines must be present, so nothing series-derived can
// be inherited from the release.
//
// PER-SOURCE CAPTURE INSTANTS (2026-08-24 round-3 review, finding 5). A
// merged source is captured by a separate run and can be arbitrarily older
// than the export that carries it, so stamping the combined document with the
// export's own `now` relabelled stale data as current. Every section now
// carries its own `capturedAt`, validated here, and the envelope's
// `generatedAt` becomes the OLDEST of them — the one instant that is true of
// the whole payload ("nothing here is fresher than this"). The document's own
// `generatedAt` keeps its separate job as the monotonic replay floor, so a
// push still advances the floor even when one source did not move.
func mergeSeriesDocument(document usageSeriesDocument, fallback TokenUsageData, current time.Time) (TokenUsageData, string, error) {
	if len(document.Sources) == 0 {
		return TokenUsageData{}, "", errors.New("data root: the document carries no sources")
	}
	emitted, err := time.Parse(time.RFC3339, document.GeneratedAt)
	if err != nil {
		return TokenUsageData{}, "", fmt.Errorf("data root: generatedAt: %w", err)
	}
	byLabel := make(map[string]int, len(fallback.Sources))
	for index, source := range fallback.Sources {
		byLabel[source.Label] = index
	}
	for label := range document.Sources {
		if _, ok := byLabel[label]; !ok {
			return TokenUsageData{}, "", errors.New("data root: the document names a source the snapshot does not ship")
		}
	}
	for label := range byLabel {
		if _, ok := document.Sources[label]; !ok {
			return TokenUsageData{}, "", errors.New("data root: the document does not refresh every shipped source; a partial document cannot be served as one current payload")
		}
	}
	merged := TokenUsageData{Sources: make([]TokenUsageSource, len(fallback.Sources))}
	copy(merged.Sources, fallback.Sources)
	oldest := emitted
	for label, section := range document.Sources {
		index := byLabel[label]
		captured, err := admitCaptureInstant(section.CapturedAt, emitted, current)
		if err != nil {
			return TokenUsageData{}, "", fmt.Errorf("data root: source %q: %w", label, err)
		}
		source, err := mergeSeriesSource(section, merged.Sources[index], captured)
		if err != nil {
			return TokenUsageData{}, "", fmt.Errorf("data root: source %q: %w", label, err)
		}
		merged.Sources[index] = source
		if captured.Before(oldest) {
			oldest = captured
		}
	}
	return merged, oldest.UTC().Format(time.RFC3339), nil
}

// admitCaptureInstant validates one source's own capture instant. It may not
// be absent, may not be later than the export that carries it (a source
// cannot be measured after the document naming it was written), and may not
// be ahead of the local clock — the same skew bound the document's own
// instant answers to.
func admitCaptureInstant(value string, emitted, current time.Time) (time.Time, error) {
	if value == "" {
		return time.Time{}, errors.New("the section carries no capturedAt; a source without its own capture instant cannot be described by one envelope")
	}
	captured, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("capturedAt: %w", err)
	}
	if captured.After(emitted) {
		return time.Time{}, errors.New("capturedAt is later than the document that carries it")
	}
	if captured.After(current.Add(dataRootFutureSkew)) {
		return time.Time{}, errors.New("capturedAt claims a future instant")
	}
	return captured, nil
}

// mergeSeriesSource validates one document section and overlays it onto its
// snapshot source, carrying that source's own capture instant into the served
// payload so a reader can see which half of a multi-source panel is older.
func mergeSeriesSource(section usageSeriesSource, base TokenUsageSource, captured time.Time) (TokenUsageSource, error) {
	series, err := admitSeriesSection(section)
	if err != nil {
		return TokenUsageSource{}, err
	}
	stats, err := overlayDerivedStats(base.Stats, section.Derived)
	if err != nil {
		return TokenUsageSource{}, err
	}
	windows, err := admitSeriesWindows(section.Windows)
	if err != nil {
		return TokenUsageSource{}, err
	}
	base.Series = series
	base.Stats = stats
	base.Windows = windows
	base.CapturedAt = captured.UTC().Format(time.RFC3339)
	return base, nil
}

// admitSeriesSection validates the daily series and its category partition
// and returns the served form.
func admitSeriesSection(section usageSeriesSource) (*TokenUsageSeries, error) {
	if !section.Series.Recorded {
		return nil, errors.New("a pushed series must declare recorded provenance")
	}
	if _, err := time.Parse(dayLayout, section.Series.StartDate); err != nil {
		return nil, fmt.Errorf("startDate: %w", err)
	}
	totals := section.Series.Totals
	if len(totals) == 0 || len(totals) > maxSeriesDays {
		return nil, fmt.Errorf("series spans %d days, outside (0, %d]", len(totals), maxSeriesDays)
	}
	for _, total := range totals {
		if err := admitCount(total); err != nil {
			return nil, fmt.Errorf("series total: %w", err)
		}
	}
	categories, err := admitBreakdown(
		section.Categories,
		section.CategoriesStartDate,
		section.Series.StartDate,
		totals,
		categoryServeOrder,
		maxSeriesCategories,
		0,
	)
	if err != nil {
		return nil, fmt.Errorf("categories: %w", err)
	}
	models, err := admitBreakdown(
		section.Models,
		section.ModelsStartDate,
		section.Series.StartDate,
		totals,
		modelServeOrder,
		maxSeriesModels,
		maxModelDays,
	)
	if err != nil {
		return nil, fmt.Errorf("models: %w", err)
	}
	return &TokenUsageSeries{
		StartDate:  section.Series.StartDate,
		Totals:     totals,
		Recorded:   true,
		Categories: categories,
		Models:     models,
	}, nil
}

// breakdownOffset resolves a declared breakdown window to its offset into the
// series, or refuses. Absent is offset zero — the aligned case every document
// written before windows existed states by omission — and a declared date
// must name a day strictly INSIDE the series, so "aligned" has exactly one
// spelling and a window can never claim days the series does not have.
func breakdownOffset(declared, seriesStart string, days int) (int, error) {
	if declared == "" {
		return 0, nil
	}
	start, err := time.Parse(dayLayout, seriesStart)
	if err != nil {
		return 0, fmt.Errorf("startDate: %w", err)
	}
	from, err := time.Parse(dayLayout, declared)
	if err != nil {
		return 0, fmt.Errorf("window startDate: %w", err)
	}
	offset := int(from.Sub(start) / (24 * time.Hour))
	if offset <= 0 || offset >= days {
		return 0, fmt.Errorf("window starts %d days into a %d day series", offset, days)
	}
	return offset, nil
}

// admitBreakdown validates ONE optional labelled partition of a daily series:
// bounded row count, closed-vocabulary keys, a window contained in the
// series, rows exactly covering that window, values inside the one numeric
// contract, and the per-day sums equal to the series totals across it — so a
// stacked reading and the plain reading can never disagree.
//
// ONE function, TWO vocabularies (issue #170). Categories and models differ
// in exactly three data points — which vocabulary admits a key, how many rows
// are allowed, and how many days the window may span — so they share this
// admission instead of growing two implementations of the same five rules.
// The producer's own emission checks the identical five before it writes.
//
// The window makes the partition a claim about the days it covers and NOTHING
// else. Days before it carry no row and are not summed against; the series
// total for them stands on its own, which is the honest shape for a day whose
// magnitude is known and whose division is not.
//
// The arithmetic is CHECKED, and the review earned that (2026-08-24 round-3,
// finding 9). Every value was individually authenticated and non-negative,
// and the day sum was still a plain int64 addition: three rows at MaxInt64,
// MaxInt64 and 2 wrapped to exactly zero and were admitted against a total of
// zero — a "partition" that proves nothing at all. Two independent controls
// close it. admitCount bounds every count to maxCountValue, which alone makes
// maxRows values unable to overflow; and addCounts refuses an overflow
// anyway, so a future edit to either bound cannot quietly reopen the wrap.
func admitBreakdown(rows map[string][]int64, declared, seriesStart string, totals []int64, vocabulary []string, maxRows, maxDays int) ([]TokenUsageCategory, error) {
	if len(rows) == 0 {
		if declared != "" {
			return nil, errors.New("a window is declared with no rows to cover it")
		}
		return nil, nil
	}
	if len(rows) > maxRows {
		return nil, fmt.Errorf("%d rows, over the %d bound", len(rows), maxRows)
	}
	offset, err := breakdownOffset(declared, seriesStart, len(totals))
	if err != nil {
		return nil, err
	}
	span := len(totals) - offset
	if maxDays > 0 && span > maxDays {
		return nil, fmt.Errorf("the window spans %d days, over the %d day bound", span, maxDays)
	}
	sums := make([]int64, span)
	for key, values := range rows {
		if !inVocabulary(key, vocabulary) {
			return nil, errors.New("key is outside the closed vocabulary")
		}
		if len(values) != span {
			return nil, fmt.Errorf("row %q covers %d days; the window covers %d", key, len(values), span)
		}
		for day, value := range values {
			if err := admitCount(value); err != nil {
				return nil, fmt.Errorf("row %q: %w", key, err)
			}
			sum, ok := addCounts(sums[day], value)
			if !ok {
				return nil, fmt.Errorf("row %q overflows the day %d partition", key, day)
			}
			sums[day] = sum
		}
	}
	for day, sum := range sums {
		if sum != totals[offset+day] {
			return nil, fmt.Errorf("rows sum to %d on day %d; the series total is %d", sum, offset+day, totals[offset+day])
		}
	}
	return orderBreakdown(rows, declared, vocabulary), nil
}

// admitCount is THE numeric contract for every figure a pushed document
// carries: a non-negative integer no larger than maxCountValue. One rule,
// stated once, applied at every count in the document — series totals,
// category values, window figures and derived tiles alike — so the producer,
// this boundary and the browser cannot disagree about what a count is
// (2026-08-24 round-3 review, finding 9).
func admitCount(value int64) error {
	if value < 0 {
		return errors.New("carries a negative count")
	}
	if value > maxCountValue {
		return fmt.Errorf("carries a count above the %d bound every stage of this pipeline shares", maxCountValue)
	}
	return nil
}

// addCounts adds two counts and reports whether the result is representable.
// Both are non-negative here, so the only failure is a positive overflow.
func addCounts(left, right int64) (int64, bool) {
	sum := left + right
	if sum < left {
		return 0, false
	}
	return sum, true
}

// inVocabulary admits exactly the CLOSED vocabulary it is handed and nothing
// else. Membership, not shape: the original check was a lowercase-identifier
// SHAPE test, so a label-shaped private identifier (`private-feature`) passed
// admission and rendered publicly through the frontend's labels (2026-08-24
// review finding H1). A vocabulary is the panel's own list of accounting
// classes or models; extending one is a deliberate edit in three places
// together, never something a pushed file can mint.
func inVocabulary(key string, vocabulary []string) bool {
	for _, allowed := range vocabulary {
		if key == allowed {
			return true
		}
	}
	return false
}

// orderBreakdown fixes the served order to the canonical vocabulary list and
// stamps each row with the window it covers. Admission has already proven
// every key a member (inVocabulary is a closed membership check), so walking
// that list IS the complete, deterministic order — every replica's bytes, and
// therefore its digest ETag, stay identical. The earlier alphabetical tail
// for out-of-vocabulary keys is gone with the vocabulary that admitted them
// (2026-08-24 review finding H1).
//
// The window is repeated per row rather than stated once beside them so each
// row is self-describing to a consumer that admits rows one at a time; it is
// the declared value or empty, never re-derived, so the served claim is the
// admitted one.
func orderBreakdown(rows map[string][]int64, declared string, vocabulary []string) []TokenUsageCategory {
	ordered := make([]TokenUsageCategory, 0, len(rows))
	for _, key := range vocabulary {
		if values, ok := rows[key]; ok {
			ordered = append(ordered, TokenUsageCategory{Key: key, StartDate: declared, Totals: values})
		}
	}
	return ordered
}

// overlayDerivedStats replaces the value of each existing series-derived
// tile. It can never add a tile, exactly like the capture tool's splice: a
// figure the owner does not show stays unshown. A derived key is validated
// against the closed vocabulary, and a tile whose unit disagrees with that
// vocabulary refuses the document — a unit mismatch means somebody is lying
// about what the number measures.
//
// The set must be COMPLETE (2026-08-24 round-3 review, finding 5). An absent
// or partial `derived` section used to be admitted, leaving the release-time
// value on a tile that sits directly above a runtime series — release-age and
// runtime-age figures under one instant, which is precisely the mixing the
// envelope's single provenance cannot describe. Every key the vocabulary
// defines must be present; a producer that cannot compute one of them is a
// producer whose document is refused.
func overlayDerivedStats(stats []TokenUsageStat, derived map[string]*int64) ([]TokenUsageStat, error) {
	if len(derived) != len(usageSeriesDerivedKeys) {
		return nil, fmt.Errorf("the section refreshes %d derived figures; the closed vocabulary defines %d, and a series-derived tile may never keep a release-time value beside a runtime series", len(derived), len(usageSeriesDerivedKeys))
	}
	for key, value := range derived {
		if _, ok := usageSeriesDerivedKeys[key]; !ok {
			return nil, fmt.Errorf("derived key %q is outside the closed vocabulary", key)
		}
		if value == nil {
			// A key present carrying nothing is a figure the producer could
			// not measure. Publishing it as 0 would put a number the data
			// cannot vouch for on a tile whose whole vocabulary already has a
			// way to say "unreported"; refusing keeps the truthful tile.
			return nil, fmt.Errorf("derived key %q carries no figure; a tile the producer cannot measure may not be published as a zero", key)
		}
		if err := admitCount(*value); err != nil {
			return nil, fmt.Errorf("derived key %q: %w", key, err)
		}
	}
	overlaid := make([]TokenUsageStat, len(stats))
	copy(overlaid, stats)
	for index, stat := range overlaid {
		value, ok := derived[stat.Key]
		if !ok {
			continue
		}
		if stat.Unit != usageSeriesDerivedKeys[stat.Key] {
			return nil, fmt.Errorf("tile %q carries unit %q; the series defines %q", stat.Key, stat.Unit, usageSeriesDerivedKeys[stat.Key])
		}
		fresh := *value
		stat.Value = &fresh
		overlaid[index] = stat
	}
	return overlaid, nil
}

// admitSeriesWindows validates the windows against the closed key vocabulary
// and returns them in fixed served order (today, then week).
//
// The set must be COMPLETE, for the same reason overlayDerivedStats' is
// (2026-08-24 round-3 review, finding 5): an omitted window used to leave the
// snapshot's release-time window rendered beside a runtime series under one
// envelope instant. Every key the vocabulary defines must be present.
func admitSeriesWindows(windows map[string]usageSeriesWindow) ([]TokenUsageWindow, error) {
	if len(windows) != len(usageSeriesWindowKeys) {
		return nil, fmt.Errorf("the section refreshes %d windows; the closed vocabulary defines %d, and a window may never keep a release-time value beside a runtime series", len(windows), len(usageSeriesWindowKeys))
	}
	for key, window := range windows {
		if _, ok := usageSeriesWindowKeys[key]; !ok {
			return nil, fmt.Errorf("window key %q is outside the closed vocabulary", key)
		}
		if window.Input == nil || window.Output == nil {
			// The same rule the derived tiles follow: a window whose halves
			// the producer could not measure is refused rather than served as
			// "in 0 · out 0", which reads as a measurement and is not one.
			return nil, fmt.Errorf("window %q carries no figures; a window the producer cannot measure may not be published as a zero", key)
		}
		if err := admitCount(*window.Input); err != nil {
			return nil, fmt.Errorf("window %q input: %w", key, err)
		}
		if err := admitCount(*window.Output); err != nil {
			return nil, fmt.Errorf("window %q output: %w", key, err)
		}
	}
	served := make([]TokenUsageWindow, 0, len(windows))
	for _, key := range windowServeOrder {
		window, ok := windows[key]
		if !ok {
			continue
		}
		served = append(served, TokenUsageWindow{
			Period:       usageSeriesWindowKeys[key],
			InputTokens:  *window.Input,
			OutputTokens: *window.Output,
		})
	}
	return served, nil
}
