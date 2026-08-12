// mapping_test pins the pure upstream-grammar mappings: hiscores rows onto
// the configured boss list with -1 becoming null, both usage grammars onto
// the today/week windows with the documented token arithmetic, the merge
// semantics, and the per-format window rendering.
package panels

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestMapHiscoresServesEveryBossTheUpstreamReports pins the mapping's
// direction of travel: the upstream decides which bosses exist, config only
// names what is NOT a boss, upstream order is preserved, the -1 sentinels
// become nulls, and an activity nobody has ever heard of is PRESERVED rather
// than dropped — the whole point of excluding instead of enumerating.
func TestMapHiscoresServesEveryBossTheUpstreamReports(t *testing.T) {
	t.Parallel()
	spec := &bossLogFetchSpec{Account: "fixture", ExcludeActivities: []string{"Clue Scrolls (all)"}}
	raw := []byte(`{"name":"fixture","skills":[],"activities":[` +
		`{"id":1,"name":"Clue Scrolls (all)","rank":9,"score":9},` +
		`{"id":2,"name":"Alpha","rank":5,"score":10},` +
		`{"id":3,"name":"Beta","rank":-1,"score":-1},` +
		`{"id":4,"name":"Gamma","rank":-1,"score":0},` +
		`{"id":5,"name":"Boss Jagex Shipped This Morning","rank":7,"score":3}]}`)
	data, err := mapHiscores(raw, spec)
	if err != nil {
		t.Fatalf("mapHiscores() error = %v", err)
	}
	var payload BossLogData
	if err := decodeStrict(data, &payload); err != nil {
		t.Fatalf("decode mapped payload: %v", err)
	}
	if payload.Account != "fixture" {
		t.Fatalf("payload = %+v", payload)
	}
	names := make([]string, 0, len(payload.Bosses))
	for _, boss := range payload.Bosses {
		names = append(names, boss.Name)
	}
	want := []string{"Alpha", "Beta", "Gamma", "Boss Jagex Shipped This Morning"}
	if len(names) != len(want) {
		t.Fatalf("bosses = %v, want %v — the excluded activity out, everything else in", names, want)
	}
	for index, name := range want {
		if names[index] != name {
			t.Errorf("boss[%d] = %q, want %q in upstream order", index, names[index], name)
		}
	}
	if payload.Bosses[0].KC == nil || *payload.Bosses[0].KC != 10 || payload.Bosses[0].Rank == nil || *payload.Bosses[0].Rank != 5 {
		t.Errorf("ranked boss row = %+v", payload.Bosses[0])
	}
	if payload.Bosses[1].KC != nil || payload.Bosses[1].Rank != nil {
		t.Errorf("fully unranked row = %+v, want both nulls", payload.Bosses[1])
	}
	// A zero score with an unranked rank is a REAL zero, not a null: the
	// account has no kills but the upstream did report a figure.
	if payload.Bosses[2].KC == nil || *payload.Bosses[2].KC != 0 || payload.Bosses[2].Rank != nil {
		t.Errorf("zero-score unranked row = %+v, want kc 0 and a null rank", payload.Bosses[2])
	}

	for name, raw := range map[string]string{
		"unknown upstream field": `{"name":"f","skills":[],"activities":[],"surprise":1}`,
		"nothing left after exclusions": `{"name":"f","skills":[],"activities":[` +
			`{"id":1,"name":"Clue Scrolls (all)","rank":1,"score":1}]}`,
	} {
		if _, err := mapHiscores([]byte(raw), spec); err == nil {
			t.Errorf("%s: mapHiscores accepted a bad document", name)
		}
	}
}

// TestMapHiscoresAdmitsTheRealUpstreamDocument is the regression that the
// live boss-log path never had. The shipped grammar declared only skills and
// activities while the endpoint also returns a top-level account name, and
// admission runs through a strict decoder, so EVERY live refresh failed on
// an unknown field and the panel could only ever serve its snapshot. The
// fixture is a real captured response, so the grammar is pinned against
// reality rather than against a hand-written guess.
func TestMapHiscoresAdmitsTheRealUpstreamDocument(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile(filepath.Join("testdata", "hiscores-full.json"))
	if err != nil {
		t.Fatalf("read the captured hiscores response: %v", err)
	}
	document, _, err := loadFetchConfig(fetchConfigBytes)
	if err != nil {
		t.Fatalf("embedded fetch config refused: %v", err)
	}
	if document.BossLog == nil {
		t.Fatal("the embedded config configures no boss-log fetch")
	}
	data, err := mapHiscores(raw, document.BossLog)
	if err != nil {
		t.Fatalf("the real upstream document was refused: %v", err)
	}
	var payload BossLogData
	if err := decodeStrict(data, &payload); err != nil {
		t.Fatalf("decode mapped payload: %v", err)
	}
	// The capture carries 91 activities, 20 of them excluded as non-bosses.
	if len(payload.Bosses) != 71 {
		t.Errorf("mapped %d bosses from the real response, want 71", len(payload.Bosses))
	}
	if len(payload.Bosses) < 50 {
		t.Error("the panel is back to serving a handful of bosses; the whole point is the complete list")
	}
	for _, excluded := range document.BossLog.ExcludeActivities {
		for _, boss := range payload.Bosses {
			if boss.Name == excluded {
				t.Errorf("non-boss activity %q reached the boss list", excluded)
			}
		}
	}
	ranked, unranked := 0, 0
	for _, boss := range payload.Bosses {
		if boss.Rank == nil {
			unranked++
			continue
		}
		ranked++
		if *boss.Rank < 1 {
			t.Errorf("boss %q has rank %d; -1 must become null, never a rank", boss.Name, *boss.Rank)
		}
	}
	if ranked == 0 || unranked == 0 {
		t.Errorf("ranked = %d, unranked = %d; the fixture must exercise both renderings", ranked, unranked)
	}
}

// TestShippedBossSnapshotMatchesTheCapturedResponse closes the loop between
// the two data files: the snapshot the binary serves cold must be exactly
// what mapping the captured upstream response produces. Without this pin a
// hand-edited snapshot could drift back into invented numbers — which is the
// defect this work exists to remove — and nothing would notice.
func TestShippedBossSnapshotMatchesTheCapturedResponse(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile(filepath.Join("testdata", "hiscores-full.json"))
	if err != nil {
		t.Fatalf("read the captured hiscores response: %v", err)
	}
	document, _, err := loadFetchConfig(fetchConfigBytes)
	if err != nil || document.BossLog == nil {
		t.Fatalf("embedded fetch config refused: %v", err)
	}
	mapped, err := mapHiscores(raw, document.BossLog)
	if err != nil {
		t.Fatalf("map the captured response: %v", err)
	}
	loaded, err := SnapshotSource{Name: "snapshots/boss-log.json"}.load(snapshotFiles, KindBossLog)
	if err != nil {
		t.Fatalf("load the shipped snapshot: %v", err)
	}
	if !bytes.Equal(mapped, loaded.data) {
		t.Errorf("the shipped boss-log snapshot is not what mapping the captured response produces;\n mapped = %s\nshipped = %s", mapped, loaded.data)
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

// contributionsFixture is a REAL captured contribution-calendar document,
// reduced twice and in exactly two ways, both stated here because a fixture
// nobody can audit is worth nothing:
//
//  1. Sliced to the region the scanner reads — the totals heading through the
//     end of the calendar table. Everything after it is profile chrome the
//     scanner never looks at, and it named other repositories, which no
//     artifact in THIS repository may reference.
//  2. The upstream's click-telemetry attributes are replaced by a marker.
//     They are third-party tracking payloads the scanner never reads, one of
//     them a high-entropy signature, and neither belongs in this history.
//
// Everything the parser touches is untouched: the ramp legend (whose cells
// carry no date and must be skipped), the dated cells, the label elements
// holding the exact counts, and a partial trailing week are all present
// exactly as the upstream served them. A hand-written fixture would only
// prove the parser agrees with its author.
func contributionsFixture(t *testing.T) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "contributions-fragment.html"))
	if err != nil {
		t.Fatalf("read the captured contribution calendar: %v", err)
	}
	return raw
}

// TestMapContributionsReadsTheRealCalendar is the zero-secret producer's
// regression: a real public document in, a renderable calendar out, with the
// exact counts taken from the label elements rather than from the coarse
// level attribute — and the legend's undated cells skipped rather than
// counted as days.
func TestMapContributionsReadsTheRealCalendar(t *testing.T) {
	t.Parallel()
	data, err := mapContributions(contributionsFixture(t))
	if err != nil {
		t.Fatalf("the real calendar document was refused: %v", err)
	}
	var payload VCSActivityData
	if err := decodeStrict(data, &payload); err != nil {
		t.Fatalf("decode mapped payload: %v", err)
	}
	if len(payload.Weeks) != 12 {
		t.Errorf("mapped %d week columns, want the fixture's 12", len(payload.Weeks))
	}
	for index, week := range payload.Weeks {
		if len(week) != daysPerWeek {
			t.Errorf("week %d has %d days, want %d", index, len(week), daysPerWeek)
		}
	}
	if payload.TotalContributions != 303 {
		t.Errorf("total = %d, want the 303 the document's own labels sum to", payload.TotalContributions)
	}
	if payload.EndDate != "2026-08-12" {
		t.Errorf("endDate = %q, want the document's last covered day", payload.EndDate)
	}
	if payload.Streak != 4 {
		t.Errorf("streak = %d, want 4", payload.Streak)
	}
	// The counts must come from the labels: the level attribute is a coarse
	// 0..4 bucket, so a parser reading it would cap every busy day at 4.
	peak := 0
	for _, week := range payload.Weeks {
		for _, count := range week {
			if count > peak {
				peak = count
			}
		}
	}
	if peak != 151 {
		t.Errorf("peak day = %d, want the label's 151 (a level-derived parser would read 4)", peak)
	}
	// The calendar document carries no commit rows; an empty list is the
	// honest answer, and null would fail the frontend's admission.
	if payload.RecentCommits == nil || len(payload.RecentCommits) != 0 {
		t.Errorf("recentCommits = %+v, want an empty list", payload.RecentCommits)
	}
}

// TestMapContributionsFailsClosedOnDrift proves the scanner is a gate, not a
// best effort: each mutation is a way the upstream could change, and every
// one of them must refuse the document so the panel keeps its last good
// payload instead of drawing a wrong or empty calendar.
func TestMapContributionsFailsClosedOnDrift(t *testing.T) {
	t.Parallel()
	document := string(contributionsFixture(t))
	for name, mutate := range map[string]func(string) string{
		"the cell class changes": func(in string) string {
			return strings.ReplaceAll(in, "ContributionCalendar-day", "ContributionCalendar-square")
		},
		"a cell date stops being a date": func(in string) string {
			return strings.Replace(in, `data-date="2026-08-10"`, `data-date="last Monday"`, 1)
		},
		"a cell loses its label": func(in string) string {
			return strings.Replace(in, `for="contribution-day-component-1-51"`, `for="orphan"`, 1)
		},
		"a label stops carrying a count": func(in string) string {
			return strings.Replace(in, "151 contributions", "lots of contributions", 1)
		},
		"a label is emptied entirely": func(in string) string {
			return strings.Replace(in, ">151 contributions on August 10th.<", "><", 1)
		},
		"a day is reported twice": func(in string) string {
			return strings.Replace(in, `data-date="2026-08-09"`, `data-date="2026-08-10"`, 1)
		},
		"the span runs past a year and a half": func(in string) string {
			return strings.Replace(in, `data-date="2026-05-24"`, `data-date="2019-05-24"`, 1)
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if _, err := mapContributions([]byte(mutate(document))); err == nil {
				t.Error("the scanner accepted a drifted document")
			}
		})
	}
}

// TestShippedActivitySnapshotAgreesWithTheCapture cross-checks the two data
// files the way the boss-log pin does. The snapshot covers the full year and
// the fixture only its final weeks, so the week COUNTS legitimately differ —
// but every contribution in the year falls inside those weeks, so the totals,
// the streak, and the end date must agree exactly. A hand-edited snapshot
// drifting back toward invented numbers fails here.
func TestShippedActivitySnapshotAgreesWithTheCapture(t *testing.T) {
	t.Parallel()
	mapped, err := mapContributions(contributionsFixture(t))
	if err != nil {
		t.Fatalf("map the captured calendar: %v", err)
	}
	var fromCapture VCSActivityData
	if err := decodeStrict(mapped, &fromCapture); err != nil {
		t.Fatalf("decode the captured calendar: %v", err)
	}
	loaded, err := SnapshotSource{Name: "snapshots/vcs-activity.json"}.load(snapshotFiles, KindVCSActivity)
	if err != nil {
		t.Fatalf("load the shipped snapshot: %v", err)
	}
	var shipped VCSActivityData
	if err := decodeStrict(loaded.data, &shipped); err != nil {
		t.Fatalf("decode the shipped snapshot: %v", err)
	}
	if shipped.TotalContributions != fromCapture.TotalContributions {
		t.Errorf("snapshot total = %d, capture total = %d", shipped.TotalContributions, fromCapture.TotalContributions)
	}
	if shipped.Streak != fromCapture.Streak {
		t.Errorf("snapshot streak = %d, capture streak = %d", shipped.Streak, fromCapture.Streak)
	}
	if shipped.EndDate != fromCapture.EndDate {
		t.Errorf("snapshot endDate = %q, capture endDate = %q", shipped.EndDate, fromCapture.EndDate)
	}
	if len(shipped.Weeks) < 50 {
		t.Errorf("snapshot ships %d weeks, want the full year the producer fetches", len(shipped.Weeks))
	}
	if len(shipped.RecentCommits) != 0 {
		t.Errorf("snapshot ships %d commit rows; the calendar producer reports none", len(shipped.RecentCommits))
	}
}

// TestContributionScannerHandlesMalformedMarkup drives the scanner's own
// edges directly: a marker inside an unterminated tag, an attribute whose
// quote never closes, and a label element that never closes. None of them
// may panic, and none may invent a value.
func TestContributionScannerHandlesMalformedMarkup(t *testing.T) {
	t.Parallel()
	if tags := scanTags(`<td `+calendarCellMark, calendarCellMark); len(tags) != 0 {
		t.Errorf("scanTags on an unterminated tag = %v, want none", tags)
	}
	if tags := scanTags(calendarCellMark+`>`, calendarCellMark); len(tags) != 0 {
		t.Errorf("scanTags on a tag with no opening bracket = %v, want none", tags)
	}
	if value, ok := attributeValue(`<td data-date="2026-08-12">`, "data-date"); !ok || value != "2026-08-12" {
		t.Errorf("attributeValue = %q, %v", value, ok)
	}
	for name, tag := range map[string]string{
		"absent attribute":   `<td class="x">`,
		"unterminated quote": `<td data-date="2026-08-12`,
	} {
		if value, ok := attributeValue(tag, "data-date"); ok {
			t.Errorf("%s: attributeValue returned %q", name, value)
		}
	}
	for name, document := range map[string]string{
		"no label at all":      `<tool-tip for="other">3 contributions</tool-tip>`,
		"unterminated tag":     `<tool-tip for="cell"`,
		"unterminated content": `<tool-tip for="cell">3 contributions`,
	} {
		if count, err := labelledCount(document, "cell"); err == nil {
			t.Errorf("%s: labelledCount returned %d with no error", name, count)
		}
	}
	if count, err := labelledCount(`<tool-tip for="cell">1,024 contributions on May 1st.</tool-tip>`, "cell"); err != nil || count != 1024 {
		t.Errorf("labelledCount on a grouped number = %d, %v; want 1024", count, err)
	}
	if count, err := labelledCount(`<tool-tip for="cell">No contributions on May 1st.</tool-tip>`, "cell"); err != nil || count != 0 {
		t.Errorf("labelledCount on the none-word = %d, %v; want 0", count, err)
	}
	if _, err := labelledCount(`<tool-tip for="cell">-3 contributions</tool-tip>`, "cell"); err == nil {
		t.Error("labelledCount accepted a negative count")
	}
}
