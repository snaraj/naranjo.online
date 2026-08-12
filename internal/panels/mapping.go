// mapping.go turns strictly decoded upstream documents into panel payloads.
// Everything here is pure data transformation — no network, no filesystem —
// and every upstream byte passes decodeStrict before a field of it is read,
// so grammar drift degrades to last-good serving instead of wrong data.

package panels

import (
	"encoding/json"
	"fmt"
	"time"
)

// mapHiscores maps a hiscores/v1 document onto the configured boss list,
// data-driven and order-preserving: each configured boss serves its ranked
// values, or null kc and rank when the upstream does not rank it — the same
// "--" semantics the snapshot models.
func mapHiscores(raw []byte, spec *bossLogFetchSpec) (json.RawMessage, error) {
	var document hiscoresDocument
	if err := decodeStrict(raw, &document); err != nil {
		return nil, fmt.Errorf("hiscores document: %w", err)
	}
	ranked := make(map[string]hiscoresActivity, len(document.Activities))
	for _, activity := range document.Activities {
		ranked[activity.Name] = activity
	}
	payload := BossLogData{Account: spec.Account, Bosses: make([]BossLogEntry, 0, len(spec.Bosses))}
	for _, name := range spec.Bosses {
		entry := BossLogEntry{Name: name}
		if activity, ok := ranked[name]; ok {
			if activity.Score >= 0 {
				score := activity.Score
				entry.KC = &score
			}
			if activity.Rank >= 0 {
				rank := activity.Rank
				entry.Rank = &rank
			}
		}
		payload.Bosses = append(payload.Bosses, entry)
	}
	// Marshaling the package-owned payload cannot fail.
	data, _ := json.Marshal(payload)
	return data, nil
}

// mapUsage maps one source's upstream usage document into everything the
// panel renders from live data: the today/week windows, the daily activity
// series behind the grid, and the stat tiles a series can honestly support.
// Figures no usage API reports — a lifetime total, a longest single task,
// behavioral insights — are deliberately absent here; they arrive from the
// recorded snapshot section and keep their own provenance flag.
func mapUsage(shape string, raw []byte) (usageMapping, error) {
	buckets, err := decodeUsageBuckets(shape, raw)
	if err != nil {
		return usageMapping{}, err
	}
	if len(buckets) == 0 {
		return usageMapping{}, fmt.Errorf("usage document for shape %q carries no buckets", shape)
	}
	latest := buckets[len(buckets)-1]
	week := tokenBucket{}
	for _, bucket := range buckets {
		week.input += bucket.input
		week.output += bucket.output
	}
	series, err := dailySeries(buckets)
	if err != nil {
		return usageMapping{}, err
	}
	current, longest := dailyStreaks(series.Totals)
	peak := int64(0)
	for _, total := range series.Totals {
		if total > peak {
			peak = total
		}
	}
	windowTotal := week.input + week.output
	return usageMapping{
		windows: []TokenUsageWindow{
			{Period: "today", InputTokens: latest.input, OutputTokens: latest.output},
			{Period: "week", InputTokens: week.input, OutputTokens: week.output},
		},
		series: series,
		stats: []TokenUsageStat{
			{Key: statCurrentStreak, Label: "Current streak", Value: &current, Unit: UnitDays},
			{Key: statLongestStreak, Label: "Longest streak", Value: &longest, Unit: UnitDays},
			{Key: statPeakDay, Label: "Peak day", Value: &peak, Unit: UnitTokens},
			{Key: statWindowTotal, Label: "Window tokens", Value: &windowTotal, Unit: UnitTokens},
		},
	}, nil
}

// decodeUsageBuckets admits one upstream document through the strict gate and
// flattens it into dated daily buckets, so the two vendor grammars converge
// on one shape before any panel arithmetic touches them.
func decodeUsageBuckets(shape string, raw []byte) ([]tokenBucket, error) {
	var buckets []tokenBucket
	switch shape {
	case shapeUsageReport:
		var document usageReportDocument
		if err := decodeStrict(raw, &document); err != nil {
			return nil, fmt.Errorf("usage-report document: %w", err)
		}
		for _, bucket := range document.Data {
			day, err := time.Parse(time.RFC3339, bucket.StartingAt)
			if err != nil {
				return nil, fmt.Errorf("usage-report bucket start: %w", err)
			}
			totals := tokenBucket{day: day.UTC().Format(dayLayout)}
			for _, result := range bucket.Results {
				totals.input += result.UncachedInputTokens +
					result.CacheReadInputTokens +
					result.CacheCreation.Ephemeral5mInputTokens +
					result.CacheCreation.Ephemeral1hInputTokens
				totals.output += result.OutputTokens
			}
			buckets = append(buckets, totals)
		}
	case shapeUsagePage:
		var document usagePageDocument
		if err := decodeStrict(raw, &document); err != nil {
			return nil, fmt.Errorf("usage-page document: %w", err)
		}
		for _, bucket := range document.Data {
			totals := tokenBucket{day: time.Unix(bucket.StartTime, 0).UTC().Format(dayLayout)}
			for _, result := range bucket.Results {
				totals.input += result.InputTokens
				totals.output += result.OutputTokens
			}
			buckets = append(buckets, totals)
		}
	default:
		return nil, fmt.Errorf("unknown usage response shape %q", shape)
	}
	return buckets, nil
}

// dailySeries turns dated buckets into the contiguous day-indexed series the
// activity grid renders: one combined total per calendar day from the oldest
// bucket to the newest, zeros for days the upstream skipped, and repeated
// days summed rather than refused — bucket ORDER and bucket GRANULARITY are
// upstream choices, and neither should be able to break a chart. Only a span
// beyond maxSeriesDays is refused, keeping the last good payload instead of
// inflating one against the owner's budget.
func dailySeries(buckets []tokenBucket) (*TokenUsageSeries, error) {
	totalsByDay := make(map[string]int64, len(buckets))
	var first, last time.Time
	for index, bucket := range buckets {
		day, err := time.Parse(dayLayout, bucket.day)
		if err != nil {
			return nil, fmt.Errorf("usage series day: %w", err)
		}
		totalsByDay[bucket.day] += bucket.input + bucket.output
		if index == 0 || day.Before(first) {
			first = day
		}
		if index == 0 || day.After(last) {
			last = day
		}
	}
	span := int(last.Sub(first)/(24*time.Hour)) + 1
	if span > maxSeriesDays {
		return nil, fmt.Errorf("usage series spans %d days, over the %d day bound", span, maxSeriesDays)
	}
	totals := make([]int64, span)
	for offset := range totals {
		totals[offset] = totalsByDay[first.AddDate(0, 0, offset).Format(dayLayout)]
	}
	return &TokenUsageSeries{StartDate: first.Format(dayLayout), Totals: totals}, nil
}

// dailyStreaks reports the current and longest runs of consecutive days with
// any consumption. The current run tolerates ONE trailing empty day, because
// the newest bucket is the day in progress and an hour of quiet is not a
// broken streak; two empty days end it.
func dailyStreaks(totals []int64) (current, longest int64) {
	run := int64(0)
	for _, total := range totals {
		if total > 0 {
			run++
			if run > longest {
				longest = run
			}
			continue
		}
		run = 0
	}
	end := len(totals)
	if end > 0 && totals[end-1] == 0 {
		end--
	}
	for index := end - 1; index >= 0 && totals[index] > 0; index-- {
		current++
	}
	return current, longest
}

// usageMapping is one source's complete live contribution: the windows, the
// daily series, and the stats a series can support on its own.
type usageMapping struct {
	windows []TokenUsageWindow
	series  *TokenUsageSeries
	stats   []TokenUsageStat
}

// tokenBucket is one summed bucket during mapping, tagged with the calendar
// day it covers so both upstream grammars can feed one dated series.
type tokenBucket struct {
	day    string
	input  int64
	output int64
}

// mergeUsagePayload assembles the served token-usage payload in config
// order: the freshly mapped live section where a source succeeded, that
// source's recorded snapshot section otherwise. A source that DID fetch also
// keeps the recorded figures no usage API reports — the lifetime total, the
// longest single task, the behavioral insights — beside its live ones, each
// still carrying the provenance flag that says where it came from. The
// result is fresh only when every configured source fetched.
func mergeUsagePayload(spec *tokenUsageFetchSpec, fetched map[string]usageMapping, fallback TokenUsageData) (TokenUsageData, bool) {
	fallbackByLabel := make(map[string]TokenUsageSource, len(fallback.Sources))
	for _, source := range fallback.Sources {
		fallbackByLabel[source.Label] = source
	}
	merged := TokenUsageData{Sources: make([]TokenUsageSource, 0, len(spec.Sources))}
	allFresh := true
	for _, source := range spec.Sources {
		recorded := fallbackByLabel[source.Label]
		recorded.Label = source.Label
		live, ok := fetched[source.Label]
		if !ok {
			allFresh = false
			merged.Sources = append(merged.Sources, recorded)
			continue
		}
		merged.Sources = append(merged.Sources, TokenUsageSource{
			Label:    source.Label,
			Account:  recorded.Account,
			Windows:  live.windows,
			Stats:    mergeStats(recorded.Stats, live.stats),
			Series:   live.series,
			Insights: recorded.Insights,
		})
	}
	return merged, allFresh
}

// mergeStats overlays live tiles onto the recorded ones by key: a recorded
// figure the live feed can compute is replaced IN PLACE, so the owner's tile
// order survives a refresh, and a live figure with no recorded counterpart is
// appended after them.
func mergeStats(recorded, live []TokenUsageStat) []TokenUsageStat {
	byKey := make(map[string]TokenUsageStat, len(live))
	for _, stat := range live {
		byKey[stat.Key] = stat
	}
	// Capacity is a hint, not a bound: sizing it from one slice keeps the
	// hint useful while keeping the arithmetic obviously non-overflowing
	// (CodeQL go/allocation-size-overflow), and append covers the rest.
	merged := make([]TokenUsageStat, 0, len(recorded))
	replaced := make(map[string]bool, len(live))
	for _, stat := range recorded {
		if fresh, ok := byKey[stat.Key]; ok {
			replaced[stat.Key] = true
			merged = append(merged, fresh)
			continue
		}
		merged = append(merged, stat)
	}
	for _, stat := range live {
		if !replaced[stat.Key] {
			merged = append(merged, stat)
		}
	}
	return merged
}

// windowStart renders the lookback instant in the format the endpoint's
// grammar requires.
func windowStart(spec windowParamSpec, now time.Time) string {
	start := now.AddDate(0, 0, -spec.LookbackDays).UTC()
	if spec.Format == windowFormatUnix {
		return fmt.Sprintf("%d", start.Unix())
	}
	return start.Format(time.RFC3339)
}
