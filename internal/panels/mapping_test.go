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

// TestMapUsageWindowsSumsBothGrammars pins the token arithmetic per
// grammar: the usage-report grammar sums uncached, cache-read, and both
// cache-creation classes into input, while the usage-page grammar uses its
// aggregate input_tokens; both serve a today window from the newest bucket
// and a week window over all buckets.
func TestMapUsageWindowsSumsBothGrammars(t *testing.T) {
	t.Parallel()
	report := `{"data":[` +
		`{"starting_at":"2026-08-09T00:00:00Z","ending_at":"2026-08-10T00:00:00Z","results":[` +
		`{"uncached_input_tokens":100,"cache_read_input_tokens":20,` +
		`"cache_creation":{"ephemeral_1h_input_tokens":3,"ephemeral_5m_input_tokens":7},"output_tokens":40}]},` +
		`{"starting_at":"2026-08-10T00:00:00Z","ending_at":"2026-08-11T00:00:00Z","results":[` +
		`{"uncached_input_tokens":10,"cache_read_input_tokens":0,` +
		`"cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0},"output_tokens":4}]}` +
		`],"has_more":false,"next_page":null}`
	windows, err := mapUsageWindows(shapeUsageReport, []byte(report))
	if err != nil {
		t.Fatalf("usage-report mapping error = %v", err)
	}
	if windows[0].Period != "today" || windows[0].InputTokens != 10 || windows[0].OutputTokens != 4 {
		t.Errorf("usage-report today window = %+v", windows[0])
	}
	if windows[1].Period != "week" || windows[1].InputTokens != 140 || windows[1].OutputTokens != 44 {
		t.Errorf("usage-report week window = %+v", windows[1])
	}

	pageWindows, err := mapUsageWindows(shapeUsagePage, []byte(fixtureUsagePage))
	if err != nil {
		t.Fatalf("usage-page mapping error = %v", err)
	}
	if pageWindows[0].InputTokens != 50 || pageWindows[1].InputTokens != 150 || pageWindows[1].OutputTokens != 15 {
		t.Errorf("usage-page windows = %+v", pageWindows)
	}

	for name, run := range map[string]func() error{
		"unknown shape": func() error { _, err := mapUsageWindows("mystery/v1", []byte(fixtureUsagePage)); return err },
		"empty buckets": func() error {
			_, err := mapUsageWindows(shapeUsagePage, []byte(`{"object":"page","data":[],"has_more":false,"next_page":null}`))
			return err
		},
		"unknown result field": func() error {
			_, err := mapUsageWindows(shapeUsagePage, []byte(strings.Replace(fixtureUsagePage, `"input_tokens"`, `"surprise_tokens"`, 1)))
			return err
		},
	} {
		if err := run(); err == nil {
			t.Errorf("%s: mapping accepted a bad document", name)
		}
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
		{Label: "alpha", Windows: []TokenUsageWindow{{Period: "session", InputTokens: 2}}},
	}}
	fetched := map[string][]TokenUsageWindow{"alpha": {{Period: "week", InputTokens: 9}}}

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

	fetched["beta"] = []TokenUsageWindow{{Period: "week", InputTokens: 8}}
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
