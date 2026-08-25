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
	"log/slog"
	"time"
)

// startRefresh launches one refresh loop per fetch-backed panel with the
// injected transport and environment. It is idempotent, returns immediately,
// and starts nothing for a registry without fetch-backed panels. Each
// fetch-backed source receives the registry's logger BEFORE its loop
// launches, so every attempt the loop ever makes is narrated through the
// composition root's injected handler.
func (reg *Registry) startRefresh(ctx context.Context, doer fetchDoer, env func(string) string) {
	if !reg.refreshStarted.CompareAndSwap(false, true) {
		return
	}
	for _, state := range reg.states {
		if state.fetch == nil {
			continue
		}
		state.fetch.setLogger(reg.logger)
		go reg.refreshLoop(ctx, state, doer, env)
	}
}

// refreshLoop drives one panel: an immediate first attempt, then the TTL
// cadence, degrading to exponential backoff while attempts fail. The
// explicit ctx.Err check after every wake guarantees a canceled context
// never reaches a fetch, even when cancellation races the timer.
//
// The loop is also where the refresh narrative is written, because only the
// loop knows the retry ladder: every failed cycle logs WARN with the error
// chain and the exact next-retry instant, every successful cycle logs one
// INFO summary with the served status and the next-refresh instant, and a
// wake that attempted nothing (every endpoint inside its rate budget) says
// so at DEBUG instead of pretending it refreshed anything.
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
		attemptStart := time.Now()
		err := reg.refreshPanel(ctx, state, doer, env)
		elapsed := time.Since(attemptStart)
		// Nothing due is not a failure. The loop wakes on the shared cadence
		// while individual endpoints keep their own, longer, rate budgets, so
		// a wake that finds every endpoint still inside its budget did not
		// attempt anything, did not fail at anything, and must neither climb
		// the retry ladder nor make the panel look stale.
		if err != nil && !errors.Is(err, errNothingDue) {
			reg.logger.LogAttrs(ctx, slog.LevelWarn, "panel refresh failed",
				slog.String("panel", state.definition.id),
				slog.Any("error", err),
				slog.Float64("duration_ms", float64(elapsed)/float64(time.Millisecond)),
				slog.Time("next_retry", time.Now().Add(backoff)),
			)
			timer.Reset(backoff)
			backoff *= 2
			if backoff > config.MaxBackoff {
				backoff = config.MaxBackoff
			}
			continue
		}
		if err == nil {
			backoff = config.InitialBackoff
			reg.logger.LogAttrs(ctx, slog.LevelInfo, "panel refreshed",
				slog.String("panel", state.definition.id),
				slog.String("status", string(state.current.Load().payload.status)),
				slog.Float64("duration_ms", float64(elapsed)/float64(time.Millisecond)),
				slog.Time("next_refresh", time.Now().Add(config.TTL)),
			)
		} else {
			reg.logger.LogAttrs(ctx, slog.LevelDebug, "panel refresh idle: every endpoint inside its rate budget",
				slog.String("panel", state.definition.id),
				slog.Time("next_refresh", time.Now().Add(config.TTL)),
			)
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
