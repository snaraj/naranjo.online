// refresh.go runs the background refresh loops for fetch-backed panels. The
// loops own ALL live-data activity: one goroutine per fetch-backed panel,
// woken on the TTL cadence, backing off exponentially on failure, and gone
// the moment the context cancels — before any attempt, deterministically.
// The request path never enters this file; it only ever reads the atomic
// pointers the loops swap.

package panels

import (
	"context"
	"errors"
	"time"
)

// startRefresh launches one refresh loop per fetch-backed panel with the
// injected transport and environment. It is idempotent, returns immediately,
// and starts nothing for a registry without fetch-backed panels.
//
// A panel the sealed data-root path owns gets NO loop (2026-08-24 review
// finding 8). Ownership is per panel, not per process: every other
// fetch-backed panel keeps refreshing exactly as before, so enabling the
// sealed feed for token usage never silently disables the boss log or the
// version-control activity.
func (reg *Registry) startRefresh(ctx context.Context, doer fetchDoer, env func(string) string) {
	if !reg.refreshStarted.CompareAndSwap(false, true) {
		return
	}
	for _, state := range reg.states {
		if state.fetch == nil {
			continue
		}
		if reg.dataRootOwns(state) {
			// No goroutine at all, so the owned panel's credentialed
			// endpoint is not merely unwritten but never reached.
			continue
		}
		go reg.refreshLoop(ctx, state, doer, env)
	}
}

// dataRootOwns reports whether the sealed data-root path owns this panel.
// Checked at start AND at every loop wake: the composition root starts the
// data root first, but a loop that is already running when ownership is
// claimed must also stop, or the rule would depend on start order.
func (reg *Registry) dataRootOwns(state *panelState) bool {
	return state.definition.id == dataRootPanelID && reg.dataRootOwnsPanel.Load()
}

// refreshLoop drives one panel: an immediate first attempt, then the TTL
// cadence, degrading to exponential backoff while attempts fail. The
// explicit ctx.Err check after every wake guarantees a canceled context
// never reaches a fetch, even when cancellation races the timer.
func (reg *Registry) refreshLoop(ctx context.Context, state *panelState, doer fetchDoer, env func(string) string) {
	config := state.fetch.config
	backoff := config.InitialBackoff
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
		if reg.dataRootOwns(state) {
			// The sealed data root claimed this panel after the loop was
			// already running. Stop before the fetch: the owner writes
			// state.current, and two producers writing one panel with no
			// precedence is the race finding 8 reported.
			return
		}
		err := reg.refreshPanel(ctx, state, doer, env)
		// Nothing due is not a failure. The loop wakes on the shared cadence
		// while individual endpoints keep their own, longer, rate budgets, so
		// a wake that finds every endpoint still inside its budget did not
		// attempt anything, did not fail at anything, and must neither climb
		// the retry ladder nor make the panel look stale.
		if err != nil && !errors.Is(err, errNothingDue) {
			timer.Reset(backoff)
			backoff *= 2
			if backoff > config.MaxBackoff {
				backoff = config.MaxBackoff
			}
			continue
		}
		if err == nil {
			backoff = config.InitialBackoff
		}
		timer.Reset(config.TTL)
	}
}

// refreshPanel performs one refresh attempt and applies its outcome: fresh
// data swaps in and the index follows; any failure — fetch, validation, or
// budget — keeps the last good payload serving and marks it stale, so a
// reader always sees either fresh data or an honest staleness signal.
func (reg *Registry) refreshPanel(ctx context.Context, state *panelState, doer fetchDoer, env func(string) string) error {
	loaded, err := state.fetch.refresh(ctx, doer, env)
	if err != nil {
		// An attempt that never happened says nothing about the served data:
		// marking a panel stale because its rate budget held the loop back
		// would turn politeness into a false freshness signal.
		if errors.Is(err, errNothingDue) {
			return err
		}
		reg.markStale(state)
		return err
	}
	served, err := state.definition.prepare(loaded)
	if err != nil {
		// Over-budget or unmarshalable live data is refused exactly like a
		// failed fetch: the last good response keeps serving.
		reg.markStale(state)
		return err
	}
	state.current.Store(served)
	reg.rebuildIndex()
	return nil
}

// markStale re-prepares the panel's current payload as stale when it still
// claims freshness — the "serving last-good past its TTL" transition. The
// re-preparation reuses bytes that already passed the budget, so it cannot
// fail; unavailable and already-stale panels are left untouched.
func (reg *Registry) markStale(state *panelState) {
	current := state.current.Load()
	if current.payload.status != StatusOK {
		return
	}
	stalePayload := current.payload
	stalePayload.status = StatusStale
	if served, err := state.definition.prepare(stalePayload); err == nil {
		state.current.Store(served)
		reg.rebuildIndex()
	}
}
