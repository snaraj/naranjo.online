// mapping_test pins the pure upstream-grammar mappings: hiscores rows onto
// the configured boss list with -1 becoming null, both usage grammars onto
// the today/week windows with the documented token arithmetic, the merge
// semantics, and the per-format window rendering.
package panels

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// TestMapHiscoresIsDataDrivenAndNullSafe pins the boss mapping: config
// order wins, ranked values carry over, the -1 sentinel and a missing
// activity both serve null kc and rank, and unknown upstream fields fail
// the strict gate.
func TestMapHiscoresIsDataDrivenAndNullSafe(t *testing.T) {
	t.Parallel()
	spec := &bossLogFetchSpec{Account: "fixture", Bosses: []string{"Beta", "Alpha", "Missing"}}
	raw := []byte(`{"skills":[],"activities":[` +
		`{"id":1,"name":"Alpha","rank":5,"score":10},` +
		`{"id":2,"name":"Beta","rank":-1,"score":-1}]}`)
	data, err := mapHiscores(raw, spec)
	if err != nil {
		t.Fatalf("mapHiscores() error = %v", err)
	}
	var payload BossLogData
	if err := decodeStrict(data, &payload); err != nil {
		t.Fatalf("decode mapped payload: %v", err)
	}
	if payload.Account != "fixture" || len(payload.Bosses) != 3 {
		t.Fatalf("payload = %+v", payload)
	}
	if payload.Bosses[0].Name != "Beta" || payload.Bosses[0].KC != nil || payload.Bosses[0].Rank != nil {
		t.Errorf("unranked boss row = %+v, want nulls in config order", payload.Bosses[0])
	}
	if payload.Bosses[1].KC == nil || *payload.Bosses[1].KC != 10 || payload.Bosses[1].Rank == nil || *payload.Bosses[1].Rank != 5 {
		t.Errorf("ranked boss row = %+v", payload.Bosses[1])
	}
	if payload.Bosses[2].KC != nil || payload.Bosses[2].Rank != nil {
		t.Errorf("missing boss row = %+v, want nulls", payload.Bosses[2])
	}

	if _, err := mapHiscores([]byte(`{"skills":[],"activities":[],"surprise":1}`), spec); err == nil {
		t.Error("mapHiscores accepted an unknown upstream field")
	}
}

// fixtureUsageReport is a valid usage-report/v1 document with two
// consecutive daily buckets, the newest last.
const fixtureUsageReport = `{"data":[` +
	`{"starting_at":"2026-08-09T00:00:00Z","ending_at":"2026-08-10T00:00:00Z","results":[` +
	`{"uncached_input_tokens":100,"cache_read_input_tokens":20,` +
	`"cache_creation":{"ephemeral_1h_input_tokens":3,"ephemeral_5m_input_tokens":7},"output_tokens":40}]},` +
	`{"starting_at":"2026-08-10T00:00:00Z","ending_at":"2026-08-11T00:00:00Z","results":[` +
	`{"uncached_input_tokens":10,"cache_read_input_tokens":0,` +
	`"cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0},"output_tokens":4}]}` +
	`],"has_more":false,"next_page":null}`

// TestMapUsageSumsBothGrammars pins the token arithmetic per grammar: the
// usage-report grammar sums uncached, cache-read, and both cache-creation
// classes into input, while the usage-page grammar uses its aggregate
// input_tokens; both serve a today window from the newest bucket, a week
// window over all buckets, and the dated daily series the grid renders.
func TestMapUsageSumsBothGrammars(t *testing.T) {
	t.Parallel()
	report, err := mapUsage(shapeUsageReport, []byte(fixtureUsageReport))
	if err != nil {
		t.Fatalf("usage-report mapping error = %v", err)
	}
	if report.windows[0].Period != "today" || report.windows[0].InputTokens != 10 || report.windows[0].OutputTokens != 4 {
		t.Errorf("usage-report today window = %+v", report.windows[0])
	}
	if report.windows[1].Period != "week" || report.windows[1].InputTokens != 140 || report.windows[1].OutputTokens != 44 {
		t.Errorf("usage-report week window = %+v", report.windows[1])
	}
	if report.series == nil || report.series.StartDate != "2026-08-09" {
		t.Fatalf("usage-report series = %+v, want a series starting on the oldest bucket day", report.series)
	}
	if want := []int64{170, 14}; len(report.series.Totals) != 2 ||
		report.series.Totals[0] != want[0] || report.series.Totals[1] != want[1] {
		t.Errorf("usage-report series totals = %v, want %v", report.series.Totals, want)
	}

	page, err := mapUsage(shapeUsagePage, []byte(fixtureUsagePage))
	if err != nil {
		t.Fatalf("usage-page mapping error = %v", err)
	}
	if page.windows[0].InputTokens != 50 || page.windows[1].InputTokens != 150 || page.windows[1].OutputTokens != 15 {
		t.Errorf("usage-page windows = %+v", page.windows)
	}
	// Both fixture buckets sit inside the same Unix day, so the series must
	// SUM them into one dated day rather than refusing the document.
	if page.series == nil || len(page.series.Totals) != 1 || page.series.Totals[0] != 165 {
		t.Errorf("usage-page series = %+v, want one day totalling 165", page.series)
	}

	// Bucket ORDER is an upstream choice, and a chart must not depend on one:
	// a document whose buckets arrive newest-first maps to the same series,
	// with the oldest day still at index 0 and the newest still last.
	descending := `{"data":[` +
		`{"starting_at":"2026-08-10T00:00:00Z","ending_at":"2026-08-11T00:00:00Z","results":[` +
		`{"uncached_input_tokens":10,"cache_read_input_tokens":0,` +
		`"cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0},"output_tokens":4}]},` +
		`{"starting_at":"2026-08-09T00:00:00Z","ending_at":"2026-08-10T00:00:00Z","results":[` +
		`{"uncached_input_tokens":100,"cache_read_input_tokens":20,` +
		`"cache_creation":{"ephemeral_1h_input_tokens":3,"ephemeral_5m_input_tokens":7},"output_tokens":40}]}` +
		`],"has_more":false,"next_page":null}`
	reversed, err := mapUsage(shapeUsageReport, []byte(descending))
	if err != nil {
		t.Fatalf("a newest-first document was refused: %v", err)
	}
	if reversed.series == nil || reversed.series.StartDate != "2026-08-09" {
		t.Fatalf("newest-first series = %+v, want it anchored on the OLDEST day", reversed.series)
	}
	if want := []int64{170, 14}; len(reversed.series.Totals) != 2 ||
		reversed.series.Totals[0] != want[0] || reversed.series.Totals[1] != want[1] {
		t.Errorf("newest-first series totals = %v, want %v — the same series either way", reversed.series.Totals, want)
	}
	// A day the upstream splits across two buckets is summed, not refused and
	// not overwritten, whichever order the two halves arrive in.
	split := `{"data":[` +
		`{"starting_at":"2026-08-09T12:00:00Z","ending_at":"2026-08-09T18:00:00Z","results":[` +
		`{"uncached_input_tokens":5,"cache_read_input_tokens":0,` +
		`"cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0},"output_tokens":1}]},` +
		`{"starting_at":"2026-08-09T00:00:00Z","ending_at":"2026-08-09T12:00:00Z","results":[` +
		`{"uncached_input_tokens":2,"cache_read_input_tokens":0,` +
		`"cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0},"output_tokens":3}]}` +
		`],"has_more":false,"next_page":null}`
	merged, err := mapUsage(shapeUsageReport, []byte(split))
	if err != nil {
		t.Fatalf("a day split across buckets was refused: %v", err)
	}
	if merged.series == nil || len(merged.series.Totals) != 1 || merged.series.Totals[0] != 11 {
		t.Errorf("split-day series = %+v, want one day totalling 11", merged.series)
	}

	for name, run := range map[string]func() error{
		"unknown shape": func() error { _, err := mapUsage("mystery/v1", []byte(fixtureUsagePage)); return err },
		"empty buckets": func() error {
			_, err := mapUsage(shapeUsagePage, []byte(`{"object":"page","data":[],"has_more":false,"next_page":null}`))
			return err
		},
		"unknown result field": func() error {
			_, err := mapUsage(shapeUsagePage, []byte(strings.Replace(fixtureUsagePage, `"input_tokens"`, `"surprise_tokens"`, 1)))
			return err
		},
		"unparsable bucket start": func() error {
			_, err := mapUsage(shapeUsageReport, []byte(strings.Replace(fixtureUsageReport, `"2026-08-09T00:00:00Z"`, `"yesterday"`, 1)))
			return err
		},
		"series beyond the day bound": func() error {
			_, err := mapUsage(shapeUsageReport, []byte(strings.Replace(fixtureUsageReport, `"2026-08-09T00:00:00Z"`, `"2000-01-01T00:00:00Z"`, 1)))
			return err
		},
	} {
		if err := run(); err == nil {
			t.Errorf("%s: mapping accepted a bad document", name)
		}
	}
}

// TestMapUsageDerivesOnlyWhatASeriesSupports pins the provenance boundary the
// panel depends on: the live mapping emits the four figures a daily series
// can prove and NOTHING else, so the lifetime total, the longest task, and
// the behavioral insights stay recorded snapshot data instead of quietly
// acquiring a live-looking freshness they never had.
func TestMapUsageDerivesOnlyWhatASeriesSupports(t *testing.T) {
	t.Parallel()
	mapped, err := mapUsage(shapeUsageReport, []byte(fixtureUsageReport))
	if err != nil {
		t.Fatalf("mapUsage() error = %v", err)
	}
	keys := make([]string, 0, len(mapped.stats))
	for _, stat := range mapped.stats {
		keys = append(keys, stat.Key)
		if stat.Value == nil {
			t.Errorf("live stat %q carries no value", stat.Key)
		}
		if stat.Recorded {
			t.Errorf("live stat %q claims recorded provenance", stat.Key)
		}
		if stat.Unit != UnitTokens && stat.Unit != UnitDays {
			t.Errorf("live stat %q has unit %q", stat.Key, stat.Unit)
		}
	}
	want := []string{statCurrentStreak, statLongestStreak, statPeakDay, statWindowTotal}
	if len(keys) != len(want) {
		t.Fatalf("live stat keys = %v, want exactly %v", keys, want)
	}
	for index, key := range want {
		if keys[index] != key {
			t.Errorf("live stat[%d] = %q, want %q", index, keys[index], key)
		}
	}
	if *mapped.stats[2].Value != 170 {
		t.Errorf("peak day = %d, want the busiest day in the series", *mapped.stats[2].Value)
	}
	if *mapped.stats[3].Value != 184 {
		t.Errorf("window total = %d, want every token in the window", *mapped.stats[3].Value)
	}
}

// TestDailyStreaksToleratesExactlyOneQuietTrailingDay pins the streak rule:
// the newest bucket is the day in progress, so one empty trailing day does
// not break the current run and two do; the longest run is measured across
// the whole series regardless of where it sits.
func TestDailyStreaksToleratesExactlyOneQuietTrailingDay(t *testing.T) {
	t.Parallel()
	for name, row := range map[string]struct {
		totals           []int64
		current, longest int64
	}{
		"empty series":            {nil, 0, 0},
		"all quiet":               {[]int64{0, 0, 0}, 0, 0},
		"active through today":    {[]int64{0, 1, 1, 1}, 3, 3},
		"one quiet trailing day":  {[]int64{1, 1, 0}, 2, 2},
		"two quiet trailing days": {[]int64{1, 1, 0, 0}, 0, 2},
		"longest sits earlier":    {[]int64{1, 1, 1, 0, 1}, 1, 3},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			current, longest := dailyStreaks(row.totals)
			if current != row.current || longest != row.longest {
				t.Errorf("dailyStreaks(%v) = (%d, %d), want (%d, %d)", row.totals, current, longest, row.current, row.longest)
			}
		})
	}
}

// TestMergeStatsKeepsRecordedOrderAndProvenance pins the tile merge: a
// recorded figure the live feed can compute is replaced IN PLACE so the
// owner's tile order survives a refresh, a recorded figure the feed cannot
// compute stays recorded, and a live-only figure is appended after them.
func TestMergeStatsKeepsRecordedOrderAndProvenance(t *testing.T) {
	t.Parallel()
	lifetime, recordedStreak, liveStreak, peak := int64(9), int64(2), int64(7), int64(5)
	merged := mergeStats(
		[]TokenUsageStat{
			{Key: "lifetime", Label: "Lifetime", Value: &lifetime, Unit: UnitTokens, Recorded: true},
			{Key: statCurrentStreak, Label: "Current streak", Value: &recordedStreak, Unit: UnitDays, Recorded: true},
		},
		[]TokenUsageStat{
			{Key: statCurrentStreak, Label: "Current streak", Value: &liveStreak, Unit: UnitDays},
			{Key: statPeakDay, Label: "Peak day", Value: &peak, Unit: UnitTokens},
		},
	)
	if len(merged) != 3 {
		t.Fatalf("merged stats = %+v, want three tiles", merged)
	}
	if merged[0].Key != "lifetime" || !merged[0].Recorded {
		t.Errorf("tile 0 = %+v, want the untouched recorded lifetime", merged[0])
	}
	if merged[1].Key != statCurrentStreak || merged[1].Recorded || *merged[1].Value != liveStreak {
		t.Errorf("tile 1 = %+v, want the live streak in the recorded tile's slot", merged[1])
	}
	if merged[2].Key != statPeakDay {
		t.Errorf("tile 2 = %+v, want the live-only tile appended", merged[2])
	}
}

// TestMergeUsagePayloadHonorsConfigOrderAndFreshness pins the merge rules:
// config order, fetched windows win, missing sources fall back to their
// snapshot section, and freshness holds only when every source fetched.
func TestMergeUsagePayloadHonorsConfigOrderAndFreshness(t *testing.T) {
	t.Parallel()
	spec := &tokenUsageFetchSpec{Sources: []usageSourceSpec{{Label: "alpha"}, {Label: "beta"}}}
	fallback := TokenUsageData{Sources: []TokenUsageSource{
		{Label: "beta", Windows: []TokenUsageWindow{{Period: "session", InputTokens: 1}}},
		{Label: "alpha", Account: "handle", Windows: []TokenUsageWindow{{Period: "session", InputTokens: 2}},
			Insights: []TokenUsageInsight{{Label: "recorded only"}}},
	}}
	fetched := map[string]usageMapping{"alpha": {windows: []TokenUsageWindow{{Period: "week", InputTokens: 9}}}}

	merged, allFresh := mergeUsagePayload(spec, fetched, fallback)
	if allFresh {
		t.Error("merge claimed freshness with an unfetched source")
	}
	if merged.Sources[0].Label != "alpha" || merged.Sources[0].Windows[0].Period != "week" {
		t.Errorf("fetched source row = %+v", merged.Sources[0])
	}
	if merged.Sources[1].Label != "beta" || merged.Sources[1].Windows[0].InputTokens != 1 {
		t.Errorf("fallback source row = %+v", merged.Sources[1])
	}
	// A fetched source keeps the recorded figures no usage API reports.
	if merged.Sources[0].Account != "handle" || len(merged.Sources[0].Insights) != 1 {
		t.Errorf("fetched source lost its recorded account or insights: %+v", merged.Sources[0])
	}

	fetched["beta"] = usageMapping{windows: []TokenUsageWindow{{Period: "week", InputTokens: 8}}}
	if _, allFresh := mergeUsagePayload(spec, fetched, fallback); !allFresh {
		t.Error("merge denied freshness with every source fetched")
	}
}

// TestWindowStartRendersBothFormats pins the per-vendor time parameter
// rendering the endpoints require.
func TestWindowStartRendersBothFormats(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 11, 12, 0, 0, 0, time.UTC)
	rfc := windowStart(windowParamSpec{Format: windowFormatRFC3339, LookbackDays: 7}, now)
	if rfc != "2026-08-04T12:00:00Z" {
		t.Errorf("rfc3339 window start = %q", rfc)
	}
	unix := windowStart(windowParamSpec{Format: windowFormatUnix, LookbackDays: 1}, now)
	if unix != "1786363200" { // 2026-08-10T12:00:00Z in Unix seconds
		t.Errorf("unix window start = %q", unix)
	}
}

// TestLoadFetchConfigFailsClosed pins config admission: the shipped bytes
// parse, and unknown fields or invalid bounds are refused so a bad config
// degrades panels to snapshot-only instead of running with loose bounds.
func TestLoadFetchConfigFailsClosed(t *testing.T) {
	t.Parallel()
	if _, _, err := loadFetchConfig(fetchConfigBytes); err != nil {
		t.Fatalf("shipped config refused: %v", err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(fetchConfigBytes, &document); err != nil {
		t.Fatalf("re-read shipped config: %v", err)
	}
	document["surprise"] = json.RawMessage(`true`)
	withUnknown, err := json.Marshal(document)
	if err != nil {
		t.Fatalf("marshal mutated config: %v", err)
	}
	if _, _, err := loadFetchConfig(withUnknown); err == nil {
		t.Error("config with an unknown field was accepted")
	}
	if _, _, err := loadFetchConfig([]byte(`{"hosts":[],"ttlMinutes":45,"timeoutSeconds":10,"maxBytes":1,"initialBackoffSeconds":1,"maxBackoffMinutes":1}`)); err == nil {
		t.Error("config with an empty allowlist was accepted")
	}
}
