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
//   - Load returns (instant, true, nil) for a marker that authenticates and
//     parses, (zero, false, nil) for the genuinely ABSENT marker of a first
//     boot — the benign cold state — and a non-nil error for a marker that
//     exists but cannot be trusted: unreadable, oversized, unauthentic, or
//     unparsable. An error refuses acceptance and reports stale, and the loop
//     retries the load on the next tick so an operator repair recovers
//     without a restart. It never silently reverts to the embedded floor,
//     which is exactly the downgrade the review reproduced.
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
//     authentic file after a failed write.
//
// A nil FloorMarker (or either field nil) runs the loop with the
// process-memory floor only — the documented degraded mode for deployments
// without a writable state root, unchanged by this contract.
type FloorMarker struct {
	// Load reads the persisted floor. (zero, false, nil) is the absent
	// marker of a first boot; a non-nil error is a marker that exists and
	// cannot be trusted.
	Load func() (time.Time, bool, error)
	// Store durably records a newly accepted capture instant. It is the
	// commit point: its success is what permits publication.
	Store func(time.Time) error
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
	state, ok := reg.byID["token-usage"]
	if !ok {
		return
	}
	go reg.dataRootLoop(ctx, state, fsys, unseal, marker, now)
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
// Resolution is retried on each tick, so repairing the state directory
// recovers the loop without a restart.
//
// One deliberate asymmetry: when the floor came from the marker, the FIRST
// acceptance of this process may equal it exactly — that is the very file
// the previous process published, and re-serving it at boot is recovery, not
// replay. After anything has been published in-process, equality is again the
// ordinary unchanged state between pushes.
func (reg *Registry) dataRootLoop(ctx context.Context, state *panelState, fsys fs.FS, unseal Unsealer, marker *FloorMarker, now func() time.Time) {
	floor := reg.embeddedUsageInstant(state)
	floorFromMarker := false
	// Durable mode needs BOTH halves: a floor that can be read but not
	// written, or written but not read, is not a floor that survives a
	// restart. Either missing leaves the documented process-memory mode.
	durable := marker != nil && marker.Load != nil && marker.Store != nil
	floorResolved := !durable
	var commit func(time.Time) error
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
			case err != nil, present && persisted.After(now().Add(dataRootFutureSkew)):
				// The deployment asked for a durable floor and the state
				// backing it is unreadable or nonsensical. Serving on the
				// embedded floor here would silently re-admit everything a
				// previous process already published past — the exact
				// downgrade finding 2 reproduced — so the tick is refused
				// and the envelope says so. The next tick retries the load.
				reg.markStale(state)
				timer.Reset(dataRootTTL)
				continue
			case present && persisted.After(floor):
				// A marker at or below the embedded floor adds nothing: the
				// embedded instant is already the stronger bound.
				floor = persisted
				floorFromMarker = true
			}
			floorResolved = true
		}
		allowEqual := floorFromMarker && !acceptedInProcess
		accepted, err := reg.refreshFromDataRoot(state, fsys, unseal, now, floor, allowEqual, commit)
		switch {
		case err == nil:
			floor = accepted
			acceptedInProcess = true
		case errors.Is(err, fs.ErrNotExist), errors.Is(err, errSeriesUnchanged):
			// An absent file is the ordinary cold state before the first
			// push, and an unchanged file is the ordinary state between
			// pushes. Neither says anything bad about the data being served.
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
// attempt and returns the accepted capture instant. Every return before the
// final swap leaves the served payload untouched. allowEqual admits a file
// whose instant EQUALS the floor — only the loop's first, marker-floored
// attempt sets it, so a restarted process re-serves exactly what it last
// published.
//
// commit is the durable floor's write and is the LAST gate before
// publication (2026-08-24 review finding 2). Ordering is the whole point:
// publishing first and persisting afterwards means a failed write leaves a
// process serving an instant no restart can remember, and the next boot
// re-admits an older authentic file as fresh. A nil commit is the documented
// process-memory mode, where there is no durable floor to get ahead of.
func (reg *Registry) refreshFromDataRoot(state *panelState, fsys fs.FS, unseal Unsealer, now func() time.Time, floor time.Time, allowEqual bool, commit func(time.Time) error) (time.Time, error) {
	sealed, err := readBoundedFile(fsys, dataRootSeriesName, maxSealedSeriesBytes)
	if err != nil {
		return time.Time{}, err
	}
	plaintext, err := unseal(sealed)
	if err != nil {
		return time.Time{}, err
	}
	var document usageSeriesDocument
	if err := decodeStrict(plaintext, &document); err != nil {
		return time.Time{}, fmt.Errorf("data root: %w", err)
	}
	instant, err := admitSeriesInstant(document, floor, now(), allowEqual)
	if err != nil {
		return time.Time{}, err
	}
	fallback, err := reg.loadSnapshotUsageData(state)
	if err != nil {
		return time.Time{}, err
	}
	merged, err := mergeSeriesDocument(document, fallback)
	if err != nil {
		return time.Time{}, err
	}
	raw, err := json.Marshal(merged)
	if err != nil {
		return time.Time{}, err
	}
	canonical, err := decodeKindPayload(state.definition.kind, raw)
	if err != nil {
		return time.Time{}, err
	}
	served, err := state.definition.prepare(loadedPayload{
		generatedAt: document.GeneratedAt,
		data:        canonical,
		status:      StatusOK,
	})
	if err != nil {
		return time.Time{}, err
	}
	// Commit the floor, THEN publish. A failed commit publishes nothing: the
	// caller keeps its floor where it is, the last good payload keeps
	// serving, and the same file is retried on the next tick.
	if commit != nil {
		if err := commit(instant); err != nil {
			return time.Time{}, fmt.Errorf("data root: the replay floor could not be persisted, so the payload is not published: %w", err)
		}
	}
	state.current.Store(served)
	reg.rebuildIndex()
	return instant, nil
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

// admitSeriesInstant validates the document identity and its capture
// instant against the replay floor and the local clock. Equality with the
// floor is ordinarily the benign unchanged state; allowEqual turns exactly
// that case into an acceptance, for the restarted process re-reading the
// file its predecessor already accepted (see dataRootLoop).
func admitSeriesInstant(document usageSeriesDocument, floor, current time.Time, allowEqual bool) (time.Time, error) {
	if document.Schema != usageSeriesSchema {
		return time.Time{}, fmt.Errorf("data root: schema %q is not %q", document.Schema, usageSeriesSchema)
	}
	instant, err := time.Parse(time.RFC3339, document.GeneratedAt)
	if err != nil {
		return time.Time{}, fmt.Errorf("data root: generatedAt: %w", err)
	}
	if instant.Equal(floor) && !allowEqual {
		return time.Time{}, errSeriesUnchanged
	}
	if instant.Before(floor) {
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

// mergeSeriesDocument overlays the document onto the embedded fallback: for
// every source section — each of which must name an existing snapshot label —
// the series (with categories), the closed set of derived tiles, and the
// windows are replaced; every figure the document cannot measure (lifetime
// totals, session counts, insights) is left exactly as the snapshot shipped
// it, still marked recorded. Any invalid section refuses the WHOLE document:
// a partial merge would serve a payload nobody produced.
func mergeSeriesDocument(document usageSeriesDocument, fallback TokenUsageData) (TokenUsageData, error) {
	if len(document.Sources) == 0 {
		return TokenUsageData{}, errors.New("data root: the document carries no sources")
	}
	byLabel := make(map[string]int, len(fallback.Sources))
	for index, source := range fallback.Sources {
		byLabel[source.Label] = index
	}
	for label := range document.Sources {
		if _, ok := byLabel[label]; !ok {
			return TokenUsageData{}, errors.New("data root: the document names a source the snapshot does not ship")
		}
	}
	merged := TokenUsageData{Sources: make([]TokenUsageSource, len(fallback.Sources))}
	copy(merged.Sources, fallback.Sources)
	for label, section := range document.Sources {
		index := byLabel[label]
		source, err := mergeSeriesSource(section, merged.Sources[index])
		if err != nil {
			return TokenUsageData{}, fmt.Errorf("data root: source %q: %w", label, err)
		}
		merged.Sources[index] = source
	}
	return merged, nil
}

// mergeSeriesSource validates one document section and overlays it onto its
// snapshot source.
func mergeSeriesSource(section usageSeriesSource, base TokenUsageSource) (TokenUsageSource, error) {
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
	if windows != nil {
		base.Windows = windows
	}
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
		if total < 0 {
			return nil, errors.New("series carries a negative total")
		}
	}
	categories, err := admitSeriesCategories(section.Categories, totals)
	if err != nil {
		return nil, err
	}
	return &TokenUsageSeries{
		StartDate:  section.Series.StartDate,
		Totals:     totals,
		Recorded:   true,
		Categories: categories,
	}, nil
}

// admitSeriesCategories validates the optional category partition: bounded
// count, machine-shaped keys, exact series length, non-negative values, and
// the per-day sums equal to the series totals — so the stacked reading and
// the plain reading can never disagree.
func admitSeriesCategories(categories map[string][]int64, totals []int64) ([]TokenUsageCategory, error) {
	if len(categories) == 0 {
		return nil, nil
	}
	if len(categories) > maxSeriesCategories {
		return nil, fmt.Errorf("%d categories, over the %d bound", len(categories), maxSeriesCategories)
	}
	sums := make([]int64, len(totals))
	for key, values := range categories {
		if !validCategoryKey(key) {
			return nil, errors.New("category key is outside the closed category vocabulary")
		}
		if len(values) != len(totals) {
			return nil, fmt.Errorf("category %q covers %d days; the series covers %d", key, len(values), len(totals))
		}
		for day, value := range values {
			if value < 0 {
				return nil, fmt.Errorf("category %q carries a negative count", key)
			}
			sums[day] += value
		}
	}
	for day, sum := range sums {
		if sum != totals[day] {
			return nil, fmt.Errorf("categories sum to %d on day %d; the series total is %d", sum, day, totals[day])
		}
	}
	return orderCategories(categories), nil
}

// validCategoryKey admits exactly the CLOSED category vocabulary — the keys
// categoryServeOrder declares, and nothing else. Membership, not shape: the
// original shape check admitted any lowercase identifier, so a label-shaped
// private identifier (`private-feature`) passed admission and rendered
// publicly through the frontend's category labels (2026-08-24 review finding
// H1). The vocabulary is the panel's accounting classes; a new class is a
// deliberate edit of categoryServeOrder on BOTH ends of the pipe, never
// something a pushed file can mint.
func validCategoryKey(key string) bool {
	for _, allowed := range categoryServeOrder {
		if key == allowed {
			return true
		}
	}
	return false
}

// orderCategories fixes the served order to the canonical vocabulary list.
// Admission has already proven every key a member of categoryServeOrder
// (validCategoryKey is a closed membership check), so walking that list IS
// the complete, deterministic order — every replica's bytes, and therefore
// its digest ETag, stay identical. The earlier alphabetical tail for
// out-of-vocabulary keys is gone with the vocabulary that admitted them
// (2026-08-24 review finding H1).
func orderCategories(categories map[string][]int64) []TokenUsageCategory {
	ordered := make([]TokenUsageCategory, 0, len(categories))
	for _, key := range categoryServeOrder {
		if values, ok := categories[key]; ok {
			ordered = append(ordered, TokenUsageCategory{Key: key, Totals: values})
		}
	}
	return ordered
}

// overlayDerivedStats replaces the value of each existing series-derived
// tile the document refreshes. It can never add a tile, exactly like the
// capture tool's splice: a figure the owner does not show stays unshown. A
// derived key is validated against the closed vocabulary, and a tile whose
// unit disagrees with that vocabulary refuses the document — a unit mismatch
// means somebody is lying about what the number measures.
func overlayDerivedStats(stats []TokenUsageStat, derived map[string]int64) ([]TokenUsageStat, error) {
	if len(derived) == 0 {
		return stats, nil
	}
	for key, value := range derived {
		if _, ok := usageSeriesDerivedKeys[key]; !ok {
			return nil, fmt.Errorf("derived key %q is outside the closed vocabulary", key)
		}
		if value < 0 {
			return nil, fmt.Errorf("derived key %q carries a negative value", key)
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
		fresh := value
		stat.Value = &fresh
		overlaid[index] = stat
	}
	return overlaid, nil
}

// admitSeriesWindows validates the optional windows against the closed key
// vocabulary and returns them in fixed served order (today, then week). A
// nil return means the document carries none and the snapshot's own windows
// stand.
func admitSeriesWindows(windows map[string]usageSeriesWindow) ([]TokenUsageWindow, error) {
	if len(windows) == 0 {
		return nil, nil
	}
	for key, window := range windows {
		if _, ok := usageSeriesWindowKeys[key]; !ok {
			return nil, fmt.Errorf("window key %q is outside the closed vocabulary", key)
		}
		if window.Input < 0 || window.Output < 0 {
			return nil, fmt.Errorf("window %q carries a negative count", key)
		}
	}
	served := make([]TokenUsageWindow, 0, len(windows))
	for _, key := range []string{"today", "week"} {
		window, ok := windows[key]
		if !ok {
			continue
		}
		served = append(served, TokenUsageWindow{
			Period:       usageSeriesWindowKeys[key],
			InputTokens:  window.Input,
			OutputTokens: window.Output,
		})
	}
	return served, nil
}
