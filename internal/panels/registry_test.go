// registry_test proves the production registry New() prepares: every builtin
// panel serves a complete ok envelope from its shipped snapshot, and each
// kind's payload carries the semantics the frontend will render — including
// the null kill count that must reach the wire as null, not zero.
package panels

import (
	"testing"
	"time"
)

// TestNewPreparesEveryBuiltinPanel walks the production registry end to end
// at cold start (no refresh started): snapshot-only panels list as ok,
// fetch-backed panels honestly list their snapshot fallback as stale, and
// each envelope carries the stable schema, its registry identity, a valid
// timestamp, and real data.
func TestNewPreparesEveryBuiltinPanel(t *testing.T) {
	t.Parallel()
	coldStatus := map[string]Status{
		"token-usage":  StatusStale,
		"vcs-activity": StatusStale,
		"boss-log":     StatusStale,
	}
	registry := New()
	index := decodeIndex(t, registry)
	if len(index.Panels) != len(builtinPanels) {
		t.Fatalf("index lists %d panels, want %d", len(index.Panels), len(builtinPanels))
	}
	for i, definition := range builtinPanels {
		want := coldStatus[definition.id]
		row := index.Panels[i]
		if row.ID != definition.id || row.Kind != definition.kind || row.Title != definition.title || row.Status != want {
			t.Errorf("index row %d = %+v, want identity of %q with status %q", i, row, definition.id, want)
		}
		envelope := decodePanelEnvelope(t, registry, definition.id)
		if envelope.Schema != EnvelopeSchema {
			t.Errorf("%s schema = %q, want %q", definition.id, envelope.Schema, EnvelopeSchema)
		}
		if envelope.ID != definition.id || envelope.Kind != definition.kind || envelope.Title != definition.title {
			t.Errorf("%s envelope identity = %+v", definition.id, envelope)
		}
		if envelope.Status != want {
			t.Errorf("%s status = %q, want %q", definition.id, envelope.Status, want)
		}
		if _, err := time.Parse(time.RFC3339, envelope.GeneratedAt); err != nil {
			t.Errorf("%s generatedAt = %q: %v", definition.id, envelope.GeneratedAt, err)
		}
		if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
			t.Errorf("%s serves no data", definition.id)
		}
	}
}

// TestBossLogPanelModelsMissingKC pins the boss-log semantics the issue
// demands: the shipped account is present, and at least one boss carries a
// null kill count — the value the frontend renders as "--" — proving null
// survives all the way through the served bytes.
func TestBossLogPanelModelsMissingKC(t *testing.T) {
	t.Parallel()
	envelope := decodePanelEnvelope(t, New(), "boss-log")
	var payload BossLogData
	if err := decodeStrict(envelope.Data, &payload); err != nil {
		t.Fatalf("decode boss-log payload: %v", err)
	}
	if payload.Account == "" {
		t.Error("boss-log account is empty")
	}
	// The panel serves the COMPLETE boss table, not a curated handful: the
	// upstream reports dozens, and a shipped snapshot that dropped back to a
	// short list would be the exact defect this pin exists to catch.
	if len(payload.Bosses) < 50 {
		t.Errorf("boss-log ships %d bosses, want the complete upstream list", len(payload.Bosses))
	}
	seen := make(map[string]bool, len(payload.Bosses))
	var sawUnranked, sawRanked bool
	for _, boss := range payload.Bosses {
		if boss.Name == "" {
			t.Error("a boss row has no name")
		}
		if seen[boss.Name] {
			t.Errorf("boss %q appears twice", boss.Name)
		}
		seen[boss.Name] = true
		if boss.KC != nil && *boss.KC < 0 {
			t.Errorf("%s has a negative kill count", boss.Name)
		}
		// The unranked rendering path: rank is null (the frontend prints
		// "Unranked") while the count may still be a real figure, because the
		// hiscores only rank an account once it clears a threshold.
		if boss.Rank == nil {
			sawUnranked = true
		} else {
			sawRanked = true
			if *boss.Rank < 1 {
				t.Errorf("%s carries rank %d; the -1 sentinel must become null", boss.Name, *boss.Rank)
			}
		}
	}
	if !sawUnranked {
		t.Error("no boss ships a null rank; the \"Unranked\" rendering path would go untested")
	}
	if !sawRanked {
		t.Error("no boss ships a numeric rank")
	}
}

// TestTokenUsagePanelKeepsSourceLabelsAsData pins the neutrality mechanism:
// tool and vendor names reach the wire as snapshot data labels with usage
// windows, never as Go identifiers (doctrine_test pins the identifier side).
func TestTokenUsagePanelKeepsSourceLabelsAsData(t *testing.T) {
	t.Parallel()
	envelope := decodePanelEnvelope(t, New(), "token-usage")
	var payload TokenUsageData
	if err := decodeStrict(envelope.Data, &payload); err != nil {
		t.Fatalf("decode token-usage payload: %v", err)
	}
	if len(payload.Sources) != 2 {
		t.Fatalf("token-usage ships %d sources, want 2", len(payload.Sources))
	}
	labels := map[string]bool{}
	units := map[string]bool{UnitTokens: true, UnitDays: true, UnitSeconds: true}
	for _, source := range payload.Sources {
		labels[source.Label] = true
		// Windows, stats, and insights are all optional and all honest: the
		// shipped snapshot carries figures that were actually recorded and
		// leaves the rest empty rather than inventing numbers. What every
		// section that IS present must satisfy is pinned below.
		for _, stat := range source.Stats {
			if stat.Key == "" || stat.Label == "" {
				t.Errorf("source %q ships a stat without a key or label: %+v", source.Label, stat)
			}
			if !units[stat.Unit] {
				t.Errorf("source %q stat %q has unknown unit %q", source.Label, stat.Key, stat.Unit)
			}
			if stat.Value != nil && *stat.Value < 0 {
				t.Errorf("source %q stat %q is negative", source.Label, stat.Key)
			}
			if !stat.Recorded {
				t.Errorf("source %q stat %q is served from a snapshot yet claims live provenance", source.Label, stat.Key)
			}
		}
		for _, insight := range source.Insights {
			if insight.Label == "" {
				t.Errorf("source %q ships an insight without a label", source.Label)
			}
			if insight.Pct != nil && (*insight.Pct < 0 || *insight.Pct > 100) {
				t.Errorf("source %q insight %q is outside 0-100", source.Label, insight.Label)
			}
		}
		if source.Series != nil {
			t.Errorf("source %q ships a snapshot activity series; the series is live-only data and must stay absent until a refresh produces one", source.Label)
		}
		for _, window := range source.Windows {
			if window.Period == "" {
				t.Errorf("source %q has a window without a period", source.Label)
			}
			if window.InputTokens < 0 || window.OutputTokens < 0 {
				t.Errorf("source %q window %q has negative token counts", source.Label, window.Period)
			}
			if window.ResetsAt != nil {
				if _, err := time.Parse(time.RFC3339, *window.ResetsAt); err != nil {
					t.Errorf("source %q window %q resetsAt = %q: %v", source.Label, window.Period, *window.ResetsAt, err)
				}
			}
		}
	}
	for _, label := range []string{"anthropic", "codex"} {
		if !labels[label] {
			t.Errorf("shipped sample lacks the %q data label", label)
		}
	}
}

// TestVCSActivityPanelShipsARenderableGraph pins the vcs-activity shape the
// contribution graph needs: seven-day weeks, a plausible total, a streak,
// and dated recent commits.
func TestVCSActivityPanelShipsARenderableGraph(t *testing.T) {
	t.Parallel()
	envelope := decodePanelEnvelope(t, New(), "vcs-activity")
	var payload VCSActivityData
	if err := decodeStrict(envelope.Data, &payload); err != nil {
		t.Fatalf("decode vcs-activity payload: %v", err)
	}
	// A real calendar covers a year of columns; a handful of weeks means the
	// panel is back to a hand-made sample.
	if len(payload.Weeks) < 50 {
		t.Errorf("graph ships %d weeks, want a full year of columns", len(payload.Weeks))
	}
	if _, err := time.Parse("2006-01-02", payload.EndDate); err != nil {
		t.Errorf("endDate = %q: %v; without it the padded trailing week is indistinguishable from real quiet days", payload.EndDate, err)
	}
	for i, week := range payload.Weeks {
		if len(week) != 7 {
			t.Errorf("week %d has %d days, want 7", i, len(week))
		}
		for day, count := range week {
			if count < 0 {
				t.Errorf("week %d day %d has negative contributions", i, day)
			}
		}
	}
	if payload.TotalContributions <= 0 || payload.Streak <= 0 {
		t.Errorf("totals = %d, streak = %d; both must be positive in the sample", payload.TotalContributions, payload.Streak)
	}
	// The contribution calendar carries no commit rows, and the previous
	// sample's rows were invented. An empty list is the honest answer until a
	// commit producer exists; rows that DO appear must be complete and dated.
	for _, commit := range payload.RecentCommits {
		if commit.Repo == "" || commit.Message == "" {
			t.Errorf("commit row incomplete: %+v", commit)
		}
		if _, err := time.Parse(time.RFC3339, commit.At); err != nil {
			t.Errorf("commit at = %q: %v", commit.At, err)
		}
	}
}
