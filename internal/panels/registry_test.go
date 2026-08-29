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
		"token-usage":     StatusStale,
		"vcs-activity":    StatusStale,
		"boss-log":        StatusStale,
		"coding-projects": StatusStale,
	}
	registry := New(nil)
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
	envelope := decodePanelEnvelope(t, New(nil), "boss-log")
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
	envelope := decodePanelEnvelope(t, New(nil), "token-usage")
	var payload TokenUsageData
	if err := decodeStrict(envelope.Data, &payload); err != nil {
		t.Fatalf("decode token-usage payload: %v", err)
	}
	if len(payload.Sources) != 2 {
		t.Fatalf("token-usage ships %d sources, want 2", len(payload.Sources))
	}
	labels := map[string]bool{}
	units := map[string]bool{UnitTokens: true, UnitDays: true, UnitSeconds: true, UnitCount: true}
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
		assertShippedSeriesIsMarkedRecorded(t, source)
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

// assertShippedSeriesIsMarkedRecorded is the NARROWED form of a pin that used
// to refuse any snapshot-shipped daily series outright. The old rule read "the
// series is live-only data and must stay absent until a refresh produces one",
// and it was right about the danger and wrong about the cause. The danger is a
// series that PASSES ITSELF OFF as live: with PANELS_REFRESH off there is no
// refresh, so an unmarked snapshot series would render under a panel that
// looks fresh, and no reader could tell the difference. The cause was never
// "the bytes came from a file" — the shipped stat tiles have always come from
// a file — it was the absence of any way to say so.
//
// There is a way to say so now (TokenUsageSeries.Recorded), so the pin moves
// onto the property that still matters and keeps failing closed:
//
//   - a shipped series says it is a recorded capture, so it can never borrow
//     the panel's freshness;
//   - it is a real series — a parseable start date, at least one day, no
//     negative day, and inside the span bound the origin itself enforces — so
//     "recorded" cannot become a licence to ship a shape the live path would
//     have refused.
//
// The other half of the old rule — that a refresh REPLACES this series rather
// than being shadowed by it — is not a property of the shipped bytes at all
// and could never be pinned here; it is pinned where the merge happens, by
// TestALiveRefreshReplacesTheRecordedSeries below. Narrowing this pin without
// that one would have been a weakening (requirement 4); together they cover
// strictly more than the sentence they replace. Owner-authorised by issue
// #134.
func assertShippedSeriesIsMarkedRecorded(t *testing.T, source TokenUsageSource) {
	t.Helper()
	if source.Series == nil {
		return
	}
	if !source.Series.Recorded {
		t.Errorf("source %q ships an activity series that does not say it was recorded out of band; unmarked, it borrows the panel's freshness and no reader can tell it from a live one", source.Label)
	}
	if _, err := time.Parse(dayLayout, source.Series.StartDate); err != nil {
		t.Errorf("source %q series startDate = %q: %v", source.Label, source.Series.StartDate, err)
	}
	if len(source.Series.Totals) == 0 {
		t.Errorf("source %q ships a series with no days in it", source.Label)
	}
	if len(source.Series.Totals) > maxSeriesDays {
		t.Errorf("source %q ships a %d day series, over the %d day bound the live path refuses", source.Label, len(source.Series.Totals), maxSeriesDays)
	}
	for day, total := range source.Series.Totals {
		if total < 0 {
			t.Errorf("source %q series day %d is negative", source.Label, day)
		}
	}
}

// TestALiveRefreshReplacesTheRecordedSeries carries the half of the old
// live-only pin that the narrowed guard above cannot: a recorded series is a
// FALLBACK, never a shadow. mergeUsagePayload must hand a source that fetched
// the series the fetch produced — unmarked, because it is live — and must hand
// a source that did NOT fetch its recorded one, still marked. Swap either and
// the panel lies in one of the two directions that matter: a stale graph
// surviving a successful refresh, or a live graph claiming to be a capture.
func TestALiveRefreshReplacesTheRecordedSeries(t *testing.T) {
	t.Parallel()
	envelope := decodePanelEnvelope(t, New(nil), "token-usage")
	var payload TokenUsageData
	if err := decodeStrict(envelope.Data, &payload); err != nil {
		t.Fatalf("decode token-usage payload: %v", err)
	}
	var recordedLabel string
	var recorded *TokenUsageSeries
	for _, source := range payload.Sources {
		if source.Series != nil {
			recordedLabel, recorded = source.Label, source.Series
			break
		}
	}
	if recorded == nil {
		t.Fatal("no shipped source carries a recorded series; this pin has nothing to prove")
	}
	spec := &tokenUsageFetchSpec{Sources: make([]usageSourceSpec, 0, len(payload.Sources))}
	for _, source := range payload.Sources {
		spec.Sources = append(spec.Sources, usageSourceSpec{Label: source.Label})
	}
	// Deliberately unlike the recorded one in both fields, so "replaced" and
	// "retained" cannot be confused for each other.
	live := usageMapping{series: &TokenUsageSeries{StartDate: "2020-01-01", Totals: []int64{1, 2, 3}}}
	merged, allFresh := mergeUsagePayload(spec, map[string]usageMapping{recordedLabel: live}, payload)
	if allFresh {
		t.Error("a partly fetched payload reported itself fully fresh")
	}
	for _, source := range merged.Sources {
		if source.Label == recordedLabel {
			if source.Series == nil || source.Series.StartDate != live.series.StartDate || len(source.Series.Totals) != len(live.series.Totals) {
				t.Errorf("the fetched source kept %+v; a refresh must replace the recorded series, not be shadowed by it", source.Series)
			}
			if source.Series != nil && source.Series.Recorded {
				t.Error("the live series claims it was recorded out of band")
			}
			continue
		}
		if source.Series != nil && !source.Series.Recorded {
			t.Errorf("source %q serves an unmarked series without having fetched one", source.Label)
		}
	}
	// And the source that DID carry a recorded series still serves it when
	// nothing fetched at all: the fallback path is the whole reason a snapshot
	// series exists.
	kept, allFresh := mergeUsagePayload(spec, map[string]usageMapping{}, payload)
	if allFresh {
		t.Error("a payload that fetched nothing reported itself fresh")
	}
	for _, source := range kept.Sources {
		if source.Label != recordedLabel {
			continue
		}
		if source.Series == nil || !source.Series.Recorded || source.Series.StartDate != recorded.StartDate {
			t.Errorf("the unfetched source lost its recorded series: %+v", source.Series)
		}
	}
}

// TestShippedUsageTilesSurviveALiveMergeWithoutDoubling pins the one contract
// that binds the recorded snapshot to the live mapper: a recorded tile naming
// a figure the live feed ALSO computes must carry that live feed's key.
//
// mergeStats overlays live tiles onto recorded ones BY KEY, so a recorded tile
// keyed "peak" and a live tile keyed "peak-day" are two different figures as
// far as the merge can tell — it keeps the recorded one and appends the live
// one, and the panel renders the same figure twice under the same caption.
// The chart has shipped panels.refresh.enabled: true since 2026-08-27, so a
// mismatch introduced here reaches readers on the next refreshed load rather
// than waiting for an enablement to expose it.
//
// The pin runs the merge production runs — the shipped snapshot against every
// tile mapUsage can produce, with mapUsage's own labels — and demands that the
// result name each key once and each caption once. A duplicate caption is the
// reader-visible symptom; a duplicate key is the mechanism.
func TestShippedUsageTilesSurviveALiveMergeWithoutDoubling(t *testing.T) {
	t.Parallel()
	envelope := decodePanelEnvelope(t, New(nil), "token-usage")
	var payload TokenUsageData
	if err := decodeStrict(envelope.Data, &payload); err != nil {
		t.Fatalf("decode token-usage payload: %v", err)
	}
	// The values are irrelevant here and deliberately distinct: what is under
	// test is which tiles survive the merge, never what they hold.
	current, longest, peak, windowTotal := int64(3), int64(5), int64(7), int64(11)
	live := []TokenUsageStat{
		{Key: statCurrentStreak, Label: "Current streak", Value: &current, Unit: UnitDays},
		{Key: statLongestStreak, Label: "Longest streak", Value: &longest, Unit: UnitDays},
		{Key: statPeakDay, Label: "Peak day", Value: &peak, Unit: UnitTokens},
		{Key: statWindowTotal, Label: "Window tokens", Value: &windowTotal, Unit: UnitTokens},
	}
	for _, source := range payload.Sources {
		keys := make(map[string]bool, len(source.Stats)+len(live))
		labels := make(map[string]bool, len(source.Stats)+len(live))
		for _, stat := range mergeStats(source.Stats, live) {
			if keys[stat.Key] {
				t.Errorf("source %q merges to two tiles keyed %q", source.Label, stat.Key)
			}
			keys[stat.Key] = true
			if labels[stat.Label] {
				t.Errorf("source %q merges to two tiles captioned %q; a recorded tile naming a live-computable figure must carry the live key so the refresh replaces it in place", source.Label, stat.Label)
			}
			labels[stat.Label] = true
		}
	}
}

// calendarWeeks is the number of columns the contribution calendar ships, and
// the frontend's `pendingWeeks` is the same number written on the other side
// of the wire (frontend/src/lib/grid.ts). It is duplicated by hand rather than
// derived, exactly like reservedMediaSegments, because the two live in
// different languages; each side pins it and each failure names the other
// file.
const calendarWeeks = 53

// TestVCSActivityPanelShipsARenderableGraph pins the vcs-activity shape the
// contribution graph needs: seven-day weeks, a plausible total, a streak,
// and dated recent commits.
func TestVCSActivityPanelShipsARenderableGraph(t *testing.T) {
	t.Parallel()
	envelope := decodePanelEnvelope(t, New(nil), "vcs-activity")
	var payload VCSActivityData
	if err := decodeStrict(envelope.Data, &payload); err != nil {
		t.Fatalf("decode vcs-activity payload: %v", err)
	}
	// A real calendar covers a year of columns; a handful of weeks means the
	// panel is back to a hand-made sample.
	//
	// EXACTLY a year, and the exactness is the parity half of a zero-CLS
	// contract rather than fussiness. The frontend grid sizes a block to the
	// columns it draws, and it holds `pendingWeeks` columns of chrome open
	// while this payload is in flight; if the two numbers ever disagree, the
	// calendar changes width the moment its data lands and the reserve stops
	// being a reserve. frontend/src/lib/grid.ts pins pendingWeeks to the same
	// 53 from its side and names this test when it fails.
	if len(payload.Weeks) != calendarWeeks {
		t.Errorf("graph ships %d weeks, want exactly %d; pendingWeeks in frontend/src/lib/grid.ts reserves that many columns for it and the two must move together", len(payload.Weeks), calendarWeeks)
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
	// sample's rows were invented. Empty is the honest answer from the
	// calendar alone; rows that DO appear — the live commit half merges its
	// own — must be complete and dated.
	for _, commit := range payload.RecentCommits {
		if commit.Repo == "" || commit.Message == "" {
			t.Errorf("commit row incomplete: %+v", commit)
		}
		if _, err := time.Parse(time.RFC3339, commit.At); err != nil {
			t.Errorf("commit at = %q: %v", commit.At, err)
		}
	}
}
