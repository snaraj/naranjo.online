package panels

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
	"time"
)

// The data-root loop's state machine, driven one event at a time. The
// booleans it replaced could be combined in ways no tick produces, and three
// reviews each found one such combination doing the wrong thing; here every
// phase meets every event, the legal pairs are pinned exactly, and the
// illegal ones are refused rather than given a meaning.

var (
	phaseEmbedded = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	phaseEarlier  = FloorState{Instant: phaseEmbedded.Add(-time.Hour), Digest: "earlier"}
	phaseSame     = FloorState{Instant: phaseEmbedded, Digest: "same"}
	phaseLater    = FloorState{Instant: phaseEmbedded.Add(time.Hour), Digest: "later"}
	phaseAccept   = FloorState{Instant: phaseEmbedded.Add(2 * time.Hour), Digest: "accepted"}
)

var allPhases = []dataRootPhase{phaseFloorPending, phaseFloorAhead, phaseCold, phaseInherited, phaseResumable, phaseAccepted}

var allEventKinds = []dataRootEventKind{eventFloorAbsent, eventFloorRead, eventFloorAhead, eventAccepted, eventUnchanged, eventSourceAbsent, eventRefused}

func (p dataRootPhase) String() string {
	return [...]string{"pending", "ahead", "cold", "inherited", "resumable", "accepted"}[p]
}

func (k dataRootEventKind) String() string {
	return [...]string{"floor-absent", "floor-read", "floor-ahead", "accepted", "unchanged", "source-absent", "refused"}[k]
}

func TestEveryLegalDataRootTransition(t *testing.T) {
	t.Parallel()
	embedded := FloorState{Instant: phaseEmbedded}
	covered := map[[2]int]bool{}
	type want struct {
		phase   dataRootPhase
		floor   FloorState
		fault   string
		effects dataRootEffects
	}
	for _, testCase := range []struct {
		from  dataRootLoopState
		event dataRootEvent
		want  want
	}{
		// Resolving the floor from a pending marker.
		{dataRootLoopState{phaseFloorPending, embedded, ""}, dataRootEvent{kind: eventFloorAbsent},
			want{phaseCold, embedded, "", dataRootEffects{}}},
		{dataRootLoopState{phaseFloorPending, embedded, ""}, dataRootEvent{kind: eventFloorRead, floor: phaseLater},
			want{phaseResumable, phaseLater, "", dataRootEffects{restore: true}}},
		{dataRootLoopState{phaseFloorPending, embedded, ""}, dataRootEvent{kind: eventFloorRead, floor: phaseSame},
			want{phaseResumable, phaseSame, "", dataRootEffects{}}},
		{dataRootLoopState{phaseFloorPending, embedded, ""}, dataRootEvent{kind: eventFloorRead, floor: phaseEarlier},
			want{phaseInherited, FloorState{Instant: phaseEmbedded, Digest: "earlier"}, "", dataRootEffects{}}},
		{dataRootLoopState{phaseFloorPending, embedded, ""}, dataRootEvent{kind: eventFloorAhead, floor: phaseLater},
			want{phaseFloorAhead, embedded, reasonFloorFuture, dataRootEffects{restore: true, stale: true, warn: reasonFloorFuture}}},
		{dataRootLoopState{phaseFloorPending, embedded, ""}, dataRootEvent{kind: eventFloorAhead, floor: phaseEarlier},
			want{phaseFloorPending, embedded, reasonFloorFuture, dataRootEffects{stale: true, warn: reasonFloorFuture}}},
		{dataRootLoopState{phaseFloorPending, embedded, ""}, dataRootEvent{kind: eventRefused, reason: reasonFloorUnreadable},
			want{phaseFloorPending, embedded, reasonFloorUnreadable, dataRootEffects{stale: true, warn: reasonFloorUnreadable}}},
		// A floor ahead of the clock: the retained copy has had its chance.
		{dataRootLoopState{phaseFloorAhead, embedded, reasonFloorFuture}, dataRootEvent{kind: eventFloorAbsent},
			want{phaseCold, embedded, reasonFloorFuture, dataRootEffects{}}},
		{dataRootLoopState{phaseFloorAhead, embedded, reasonFloorFuture}, dataRootEvent{kind: eventFloorRead, floor: phaseLater},
			want{phaseResumable, phaseLater, reasonFloorFuture, dataRootEffects{}}},
		{dataRootLoopState{phaseFloorAhead, embedded, reasonFloorFuture}, dataRootEvent{kind: eventFloorAhead, floor: phaseLater},
			want{phaseFloorAhead, embedded, reasonFloorFuture, dataRootEffects{stale: true}}},
		{dataRootLoopState{phaseFloorAhead, embedded, reasonFloorFuture}, dataRootEvent{kind: eventRefused, reason: reasonFloorUnreadable},
			want{phaseFloorAhead, embedded, reasonFloorUnreadable, dataRootEffects{stale: true, warn: reasonFloorUnreadable}}},
		// Cold: nothing published from this state yet.
		{dataRootLoopState{phaseCold, embedded, ""}, dataRootEvent{kind: eventAccepted, floor: phaseAccept, fresh: true},
			want{phaseAccepted, phaseAccept, "", dataRootEffects{}}},
		{dataRootLoopState{phaseCold, embedded, reasonDocumentRefused}, dataRootEvent{kind: eventAccepted, floor: phaseAccept, fresh: true},
			want{phaseAccepted, phaseAccept, "", dataRootEffects{cleared: reasonDocumentRefused}}},
		{dataRootLoopState{phaseCold, embedded, ""}, dataRootEvent{kind: eventAccepted, floor: phaseAccept},
			want{phaseAccepted, phaseAccept, reasonSourceExpired, dataRootEffects{stale: true, warn: reasonSourceExpired}}},
		{dataRootLoopState{phaseCold, embedded, ""}, dataRootEvent{kind: eventUnchanged, fresh: true},
			want{phaseCold, embedded, "", dataRootEffects{}}},
		{dataRootLoopState{phaseCold, embedded, ""}, dataRootEvent{kind: eventUnchanged},
			want{phaseCold, embedded, reasonSourceExpired, dataRootEffects{stale: true, warn: reasonSourceExpired}}},
		{dataRootLoopState{phaseCold, embedded, reasonDocumentRefused}, dataRootEvent{kind: eventSourceAbsent},
			want{phaseCold, embedded, "", dataRootEffects{fresh: true, cleared: reasonDocumentRefused}}},
		{dataRootLoopState{phaseCold, embedded, ""}, dataRootEvent{kind: eventSourceAbsent},
			want{phaseCold, embedded, "", dataRootEffects{}}},
		{dataRootLoopState{phaseCold, embedded, ""}, dataRootEvent{kind: eventRefused, reason: reasonSealRefused},
			want{phaseCold, embedded, reasonSealRefused, dataRootEffects{stale: true, warn: reasonSealRefused}}},
		// Inherited: a previous process published below the embedded floor.
		{dataRootLoopState{phaseInherited, embedded, ""}, dataRootEvent{kind: eventAccepted, floor: phaseAccept, fresh: true},
			want{phaseAccepted, phaseAccept, "", dataRootEffects{}}},
		{dataRootLoopState{phaseInherited, embedded, ""}, dataRootEvent{kind: eventUnchanged, fresh: true},
			want{phaseInherited, embedded, "", dataRootEffects{}}},
		{dataRootLoopState{phaseInherited, embedded, ""}, dataRootEvent{kind: eventSourceAbsent},
			want{phaseInherited, embedded, reasonSourceMissing, dataRootEffects{stale: true, warn: reasonSourceMissing}}},
		{dataRootLoopState{phaseInherited, embedded, ""}, dataRootEvent{kind: eventRefused, reason: reasonReplayRefused},
			want{phaseInherited, embedded, reasonReplayRefused, dataRootEffects{stale: true, warn: reasonReplayRefused}}},
		// Resumable: the floor is the marker a previous process recorded.
		{dataRootLoopState{phaseResumable, phaseLater, ""}, dataRootEvent{kind: eventAccepted, floor: phaseLater, fresh: true},
			want{phaseAccepted, phaseLater, "", dataRootEffects{}}},
		{dataRootLoopState{phaseResumable, phaseLater, reasonSourceMissing}, dataRootEvent{kind: eventUnchanged, fresh: true},
			want{phaseResumable, phaseLater, "", dataRootEffects{fresh: true, cleared: reasonSourceMissing}}},
		{dataRootLoopState{phaseResumable, phaseLater, ""}, dataRootEvent{kind: eventSourceAbsent},
			want{phaseResumable, phaseLater, reasonSourceMissing, dataRootEffects{stale: true, warn: reasonSourceMissing}}},
		{dataRootLoopState{phaseResumable, phaseLater, ""}, dataRootEvent{kind: eventRefused, reason: reasonReplayRefused},
			want{phaseResumable, phaseLater, reasonReplayRefused, dataRootEffects{stale: true, warn: reasonReplayRefused}}},
		// Accepted: this process published the floor.
		{dataRootLoopState{phaseAccepted, phaseAccept, ""}, dataRootEvent{kind: eventAccepted, floor: phaseAccept, fresh: true},
			want{phaseAccepted, phaseAccept, "", dataRootEffects{}}},
		{dataRootLoopState{phaseAccepted, phaseAccept, reasonSourceUnreadable}, dataRootEvent{kind: eventUnchanged, fresh: true},
			want{phaseAccepted, phaseAccept, "", dataRootEffects{fresh: true, cleared: reasonSourceUnreadable}}},
		{dataRootLoopState{phaseAccepted, phaseAccept, reasonSourceExpired}, dataRootEvent{kind: eventUnchanged},
			want{phaseAccepted, phaseAccept, reasonSourceExpired, dataRootEffects{stale: true}}},
		{dataRootLoopState{phaseAccepted, phaseAccept, ""}, dataRootEvent{kind: eventSourceAbsent},
			want{phaseAccepted, phaseAccept, reasonSourceMissing, dataRootEffects{stale: true, warn: reasonSourceMissing}}},
		{dataRootLoopState{phaseAccepted, phaseAccept, reasonSourceMissing}, dataRootEvent{kind: eventRefused, reason: reasonSealRefused},
			want{phaseAccepted, phaseAccept, reasonSealRefused, dataRootEffects{stale: true, warn: reasonSealRefused}}},
	} {
		covered[[2]int{int(testCase.from.phase), int(testCase.event.kind)}] = true
		name := fmt.Sprintf("%v+%v(fresh=%v,fault=%q)", testCase.from.phase, testCase.event.kind, testCase.event.fresh, testCase.from.fault)
		next, effects, ok := testCase.from.step(testCase.event)
		if !ok {
			t.Errorf("%s: a legal transition was refused", name)
			continue
		}
		if next.phase != testCase.want.phase || !next.floor.Instant.Equal(testCase.want.floor.Instant) || next.floor.Digest != testCase.want.floor.Digest || next.fault != testCase.want.fault {
			t.Errorf("%s: next = %v %v %q, want %v %v %q", name, next.phase, next.floor, next.fault, testCase.want.phase, testCase.want.floor, testCase.want.fault)
		}
		if effects != testCase.want.effects {
			t.Errorf("%s: effects = %+v, want %+v", name, effects, testCase.want.effects)
		}
	}
	// The table is complete: every pair the step admits appears above.
	for _, phase := range allPhases {
		for _, kind := range allEventKinds {
			if _, _, ok := (dataRootLoopState{phase: phase}).step(dataRootEvent{kind: kind, reason: reasonRefused}); ok && !covered[[2]int{int(phase), int(kind)}] {
				t.Errorf("the legal transition %v + %v has no row", phase, kind)
			}
		}
	}
}

// Every phase meets every event. A marker event is legal exactly while the
// floor is unresolved and a document outcome exactly once it is; a refusal
// is legal anywhere but only with a reason; an event outside the set is
// refused. A refused step leaves the state and asks for no effect.
func TestEveryIllegalDataRootTransitionIsRefused(t *testing.T) {
	t.Parallel()
	for _, phase := range allPhases {
		for _, kind := range append(allEventKinds, dataRootEventKind(len(allEventKinds))) {
			for _, reason := range []string{"", reasonSealRefused} {
				from := dataRootLoopState{phase: phase, floor: FloorState{Instant: phaseEmbedded}, fault: reasonDocumentRefused}
				event := dataRootEvent{kind: kind, floor: phaseLater, fresh: true, reason: reason}
				var legal bool
				switch kind {
				case eventFloorAbsent, eventFloorRead, eventFloorAhead:
					legal = phase.floorUnresolved()
				case eventAccepted, eventUnchanged, eventSourceAbsent:
					legal = !phase.floorUnresolved()
				case eventRefused:
					legal = reason != ""
				}
				next, effects, ok := from.step(event)
				if ok != legal {
					t.Errorf("%v + %v (reason %q): legal = %v, want %v", phase, kind, reason, ok, legal)
				}
				if !ok && (next != from || effects != (dataRootEffects{})) {
					t.Errorf("%v + %v: a refused step moved the state to %+v with effects %+v", phase, kind, next, effects)
				}
			}
		}
	}
}

// Every event kind the const block declares belongs to exactly one of step's
// three groups, and a kind past the block to none. The census is read from
// types.go itself rather than from allEventKinds, so a kind added to the block
// and to no group — the case an ordinal comparison filed silently with its
// neighbours — fails here by name, and so does a hand list that drifted from
// the block.
func TestEveryDataRootEventKindBelongsToExactlyOneGroup(t *testing.T) {
	t.Parallel()
	parsed, err := parser.ParseFile(token.NewFileSet(), "types.go", nil, 0)
	if err != nil {
		t.Fatalf("parse types.go: %v", err)
	}
	var declared []string
	for _, decl := range parsed.Decls {
		block, ok := decl.(*ast.GenDecl)
		if !ok || block.Tok != token.CONST || len(block.Specs) == 0 {
			continue
		}
		if first, ok := block.Specs[0].(*ast.ValueSpec); !ok || fmt.Sprint(first.Type) != "dataRootEventKind" {
			continue
		}
		for _, spec := range block.Specs {
			for _, name := range spec.(*ast.ValueSpec).Names {
				declared = append(declared, name.Name)
			}
		}
	}
	if len(declared) == 0 {
		t.Fatal("types.go declares no dataRootEventKind const block")
	}
	if len(allEventKinds) != len(declared) {
		t.Fatalf("allEventKinds lists %d kinds; types.go declares %d: %v", len(allEventKinds), len(declared), declared)
	}
	groups := func(kind dataRootEventKind) (in []string) {
		for name, member := range map[string]bool{"floor": kind.isFloorEvent(), "document": kind.isDocumentEvent(), "refusal": kind.isRefusal()} {
			if member {
				in = append(in, name)
			}
		}
		return in
	}
	for ordinal, name := range declared {
		kind := dataRootEventKind(ordinal)
		if allEventKinds[ordinal] != kind {
			t.Errorf("allEventKinds[%d] is %d, not %s", ordinal, allEventKinds[ordinal], name)
		}
		if in := groups(kind); len(in) != 1 {
			t.Errorf("%s belongs to %d groups %v, want exactly one", name, len(in), in)
		}
	}
	if in := groups(dataRootEventKind(len(declared))); len(in) != 0 {
		t.Errorf("a kind past the block belongs to %v", in)
	}
}

// Every stale cause serves the same wire value, and only the retained one may
// return to ok without new bytes.
func TestOnlyARetainedPayloadReturnsToOK(t *testing.T) {
	t.Parallel()
	for state, want := range map[servedState]struct {
		status           Status
		retains, recover bool
	}{
		servedUnavailable: {StatusUnavailable, false, false},
		servedFresh:       {StatusOK, true, false},
		servedColdStart:   {StatusStale, false, false},
		servedPartial:     {StatusStale, false, false},
		servedAged:        {StatusStale, false, false},
		servedRestored:    {StatusStale, false, false},
		servedRetained:    {StatusStale, false, true},
	} {
		if got := state.status(); got != want.status {
			t.Errorf("state %d serves %q, want %q", state, got, want.status)
		}
		if next, ok := state.retain(); ok != want.retains || (ok && next != servedRetained) {
			t.Errorf("state %d: retain = %d, %v", state, next, ok)
		}
		if next, ok := state.recover(); ok != want.recover || (ok && next != servedFresh) {
			t.Errorf("state %d: recover = %d, %v", state, next, ok)
		}
	}
	var zero loadedPayload
	if zero.state.status() != StatusUnavailable {
		t.Error("a payload whose state was never set claims to be served")
	}
}

// The store update is a compare-and-swap: a transition judged against one
// payload never overwrites another stored meanwhile.
func TestAStaleMarkNeverOverwritesANewerPublication(t *testing.T) {
	t.Parallel()
	reg, state := usageDataRootRegistry(t, dataRootSnapshot)
	newer := &servedPanel{payload: loadedPayload{state: servedFresh}}
	reg.transitionServed(state, func(servedState) (servedState, bool) {
		state.current.Store(newer)
		return servedRetained, true
	})
	if state.current.Load() != newer {
		t.Fatal("the stale mark overwrote a publication stored after it was judged")
	}
	reg.markStale(state)
	if state.current.Load().payload.state != servedRetained {
		t.Fatal("an uncontended stale mark did not land")
	}
}

// 2026-08-24 review, finding 5: a deleted document kept the envelope `ok`
// forever, because an absent file was always read as the cold state.
func TestRegressionFinding5AnAbsentFileAfterAPublicationIsALoss(t *testing.T) {
	t.Parallel()
	loop := dataRootLoopState{phase: phaseCold, floor: FloorState{Instant: phaseEmbedded}}
	loop, _, _ = loop.step(dataRootEvent{kind: eventAccepted, floor: phaseAccept, fresh: true})
	_, effects, _ := loop.step(dataRootEvent{kind: eventSourceAbsent})
	if !effects.stale || effects.warn != reasonSourceMissing {
		t.Fatalf("an absent file after a publication gave %+v, want a stale %s", effects, reasonSourceMissing)
	}
}

// 2026-08-24 round-3 review, finding 6: a restarted process with a valid
// marker and no file served `ok` on its first tick, because "published" was
// this process's memory alone.
func TestRegressionRound3Finding6AMarkerAloneMakesAnAbsentFileALoss(t *testing.T) {
	t.Parallel()
	for _, persisted := range []FloorState{phaseEarlier, phaseSame, phaseLater} {
		loop := dataRootLoopState{phase: phaseFloorPending, floor: FloorState{Instant: phaseEmbedded}}
		loop, _, _ = loop.step(dataRootEvent{kind: eventFloorRead, floor: persisted})
		_, effects, _ := loop.step(dataRootEvent{kind: eventSourceAbsent})
		if !effects.stale || effects.warn != reasonSourceMissing {
			t.Errorf("marker %v: an absent file on the first tick gave %+v, want a stale %s", persisted.Instant, effects, reasonSourceMissing)
		}
	}
}

// 2026-08-24 round-3 review, finding 2: a different authentic document at
// the marker's instant was admitted once per restart. Equality is admitted
// only in phaseResumable — reached only from the marker's own floor — and
// that phase ends at the first acceptance, so the same instant afterwards is
// the ordinary unchanged state.
func TestRegressionRound3Finding2OnlyTheMarkersOwnFloorAdmitsEquality(t *testing.T) {
	t.Parallel()
	loop := dataRootLoopState{phase: phaseFloorPending, floor: FloorState{Instant: phaseEmbedded}}
	loop, _, _ = loop.step(dataRootEvent{kind: eventFloorRead, floor: phaseLater})
	if loop.phase != phaseResumable || loop.floor != phaseLater {
		t.Fatalf("a marker above the embedded floor resolved to %v %+v", loop.phase, loop.floor)
	}
	// A refusal leaves the one recovery chance in place.
	loop, _, _ = loop.step(dataRootEvent{kind: eventRefused, reason: reasonReplayRefused})
	if loop.phase != phaseResumable {
		t.Fatalf("a refusal spent the recovery chance: %v", loop.phase)
	}
	loop, _, _ = loop.step(dataRootEvent{kind: eventAccepted, floor: phaseLater, fresh: true})
	if loop.phase != phaseAccepted {
		t.Fatalf("the first acceptance left the loop in %v, still admitting equality", loop.phase)
	}
	inherited := dataRootLoopState{phase: phaseFloorPending, floor: FloorState{Instant: phaseEmbedded}}
	if inherited, _, _ = inherited.step(dataRootEvent{kind: eventFloorRead, floor: phaseEarlier}); inherited.phase == phaseResumable {
		t.Fatal("a marker below the embedded floor admits equality with the embedded instant")
	}
}
