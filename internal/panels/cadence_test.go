package panels

import (
	"testing"
	"time"
)

// THE SAFE MINIMUM CADENCES ARE EXACT, NOT A BAND (issue #290; 2026-09-04
// security review, finding 2). The suites around these values prove
// behaviour against hand-built specs, which let every one of the old
// latencies come back with the guards still green: the data root at five
// minutes, the shared fetch loop at five, the authenticated GitHub budgets
// at two, the whole token round at fifteen. Each committed value is pinned
// here against the one place it is decided — the constant, or the embedded
// configuration the binary ships — so a reversion is a red test, and a
// deliberate change edits this file with its reason.
func TestSafeMinimumCadencesAreExact(t *testing.T) {
	t.Parallel()
	if dataRootTTL != 30*time.Second {
		t.Errorf("dataRootTTL = %v, want exactly 30s (the owner's freshness floor for a local read)", dataRootTTL)
	}
	document, config, err := loadFetchConfig(fetchConfigBytes)
	if err != nil {
		t.Fatalf("loadFetchConfig: %v", err)
	}
	if document.TTLMinutes != 1 || config.TTL != time.Minute {
		t.Errorf("shared fetch loop ttlMinutes = %d (TTL %v), want exactly 1 minute", document.TTLMinutes, config.TTL)
	}
	if document.VCSActivity == nil || document.VCSActivity.Calendar == nil || document.VCSActivity.Commits == nil || document.CodingProjects == nil || document.TokenUsage == nil {
		t.Fatalf("the embedded configuration ships every producer this pin reads")
	}
	if got := document.VCSActivity.Calendar.AuthenticatedMinIntervalMinutes; got != 1 {
		t.Errorf("vcs calendar authenticatedMinIntervalMinutes = %d, want exactly 1", got)
	}
	if got := document.VCSActivity.Commits.AuthenticatedMinIntervalMinutes; got != 1 {
		t.Errorf("vcs commits authenticatedMinIntervalMinutes = %d, want exactly 1", got)
	}
	if got := document.CodingProjects.AuthenticatedMinIntervalMinutes; got != 1 {
		t.Errorf("coding projects authenticatedMinIntervalMinutes = %d, want exactly 1", got)
	}
	if got := document.TokenUsage.MinIntervalMinutes; got != 5 {
		t.Errorf("token usage whole-round minIntervalMinutes = %d, want exactly 5", got)
	}
}
