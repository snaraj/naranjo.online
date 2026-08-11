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

// mapUsageWindows maps one source's upstream usage document into the served
// window shapes: a "today" window from the newest bucket and a "week" window
// summing every returned bucket.
func mapUsageWindows(shape string, raw []byte) ([]TokenUsageWindow, error) {
	var buckets []tokenBucket
	switch shape {
	case shapeUsageReport:
		var document usageReportDocument
		if err := decodeStrict(raw, &document); err != nil {
			return nil, fmt.Errorf("usage-report document: %w", err)
		}
		for _, bucket := range document.Data {
			totals := tokenBucket{}
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
			totals := tokenBucket{}
			for _, result := range bucket.Results {
				totals.input += result.InputTokens
				totals.output += result.OutputTokens
			}
			buckets = append(buckets, totals)
		}
	default:
		return nil, fmt.Errorf("unknown usage response shape %q", shape)
	}
	if len(buckets) == 0 {
		return nil, fmt.Errorf("usage document for shape %q carries no buckets", shape)
	}
	latest := buckets[len(buckets)-1]
	week := tokenBucket{}
	for _, bucket := range buckets {
		week.input += bucket.input
		week.output += bucket.output
	}
	return []TokenUsageWindow{
		{Period: "today", InputTokens: latest.input, OutputTokens: latest.output},
		{Period: "week", InputTokens: week.input, OutputTokens: week.output},
	}, nil
}

// tokenBucket is one summed bucket during mapping.
type tokenBucket struct {
	input  int64
	output int64
}

// mergeUsagePayload assembles the served token-usage payload in config
// order: freshly fetched windows where a source succeeded, that source's
// snapshot fallback section otherwise. The result is fresh only when every
// configured source fetched.
func mergeUsagePayload(spec *tokenUsageFetchSpec, fetched map[string][]TokenUsageWindow, fallback TokenUsageData) (TokenUsageData, bool) {
	fallbackByLabel := make(map[string][]TokenUsageWindow, len(fallback.Sources))
	for _, source := range fallback.Sources {
		fallbackByLabel[source.Label] = source.Windows
	}
	merged := TokenUsageData{Sources: make([]TokenUsageSource, 0, len(spec.Sources))}
	allFresh := true
	for _, source := range spec.Sources {
		windows, ok := fetched[source.Label]
		if !ok {
			allFresh = false
			windows = fallbackByLabel[source.Label]
		}
		merged.Sources = append(merged.Sources, TokenUsageSource{Label: source.Label, Windows: windows})
	}
	return merged, allFresh
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
