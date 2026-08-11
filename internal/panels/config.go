// config.go loads the embedded fetch configuration and assembles the builtin
// panel list from it. Everything vendor-specific — endpoint URLs, source
// labels, credential env-var names, the outbound host allowlist — arrives
// here as strictly decoded DATA from config/fetch.json; the Go source stays
// vendor-neutral, and any config fault degrades a panel to its snapshot
// default instead of failing construction.

package panels

import (
	"errors"
	"time"
)

// buildBuiltinPanels assembles the explicit panel list. Every panel starts
// from its snapshot; boss-log and token-usage are upgraded to fetch-backed
// sources when the embedded config and the fail-closed constructor both
// accept them. Any fault leaves the affected panel snapshot-only (serving
// stale is impossible to confuse with fresh), never a missing panel.
func buildBuiltinPanels() []panelDefinition {
	tokenUsageSnapshot := SnapshotSource{Name: "snapshots/token-usage.json"}
	bossLogSnapshot := SnapshotSource{Name: "snapshots/boss-log.json"}
	definitions := []panelDefinition{
		{id: "token-usage", kind: KindTokenUsage, title: "Token usage", source: tokenUsageSnapshot},
		{id: "vcs-activity", kind: KindVCSActivity, title: "Version-control activity", source: SnapshotSource{Name: "snapshots/vcs-activity.json"}},
		{id: "boss-log", kind: KindBossLog, title: "Boss log", source: bossLogSnapshot},
	}
	document, bounds, err := loadFetchConfig(fetchConfigBytes)
	if err != nil {
		return definitions
	}
	if document.TokenUsage != nil {
		if source, err := NewFetchSource(tokenUsageSnapshot, bounds, nil, document.TokenUsage); err == nil {
			definitions[0].source = source
		}
	}
	if document.BossLog != nil {
		if source, err := NewFetchSource(bossLogSnapshot, bounds, document.BossLog, nil); err == nil {
			definitions[2].source = source
		}
	}
	return definitions
}

// loadFetchConfig strictly decodes the embedded fetch configuration and
// converts its unit-explicit fields into validated duration bounds.
func loadFetchConfig(raw []byte) (fetchConfigDocument, FetchConfig, error) {
	var document fetchConfigDocument
	if err := decodeStrict(raw, &document); err != nil {
		return fetchConfigDocument{}, FetchConfig{}, err
	}
	bounds := FetchConfig{
		Hosts:          document.Hosts,
		TTL:            time.Duration(document.TTLMinutes) * time.Minute,
		Timeout:        time.Duration(document.TimeoutSeconds) * time.Second,
		MaxBytes:       document.MaxBytes,
		InitialBackoff: time.Duration(document.InitialBackoffSeconds) * time.Second,
		MaxBackoff:     time.Duration(document.MaxBackoffMinutes) * time.Minute,
	}
	if err := bounds.Validate(); err != nil {
		return fetchConfigDocument{}, FetchConfig{}, err
	}
	return document, bounds, nil
}

// validateBossLogSpec rejects a boss-log fetch spec missing any load-bearing
// field; endpoint and host admissibility are checked by NewFetchSource.
func validateBossLogSpec(spec *bossLogFetchSpec) error {
	if spec.Endpoint == "" || spec.Account == "" || len(spec.Bosses) == 0 {
		return errors.New("boss-log fetch spec: endpoint, account, and bosses are all required")
	}
	for _, boss := range spec.Bosses {
		if boss == "" {
			return errors.New("boss-log fetch spec: empty boss name")
		}
	}
	return nil
}

// validateUsageSpec rejects a token-usage fetch spec whose sources are not
// fully described; endpoints and hosts are checked by NewFetchSource.
func validateUsageSpec(spec *tokenUsageFetchSpec) error {
	if len(spec.Sources) == 0 {
		return errors.New("token-usage fetch spec: no sources")
	}
	for _, source := range spec.Sources {
		if source.Label == "" || source.Endpoint == "" || source.KeyEnvName == "" || source.KeyHeader == "" {
			return errors.New("token-usage fetch spec: label, endpoint, keyEnvName, and keyHeader are all required")
		}
		if source.Shape != shapeUsageReport && source.Shape != shapeUsagePage {
			return errors.New("token-usage fetch spec: unknown response shape")
		}
		if source.Window.Param == "" || source.Window.LookbackDays <= 0 {
			return errors.New("token-usage fetch spec: window param and positive lookback are required")
		}
		if source.Window.Format != windowFormatRFC3339 && source.Window.Format != windowFormatUnix {
			return errors.New("token-usage fetch spec: unknown window format")
		}
	}
	return nil
}
