// config.go loads the embedded fetch configuration and assembles the builtin
// panel list from it. Everything vendor-specific — endpoint URLs, source
// labels, panel headings, credential env-var names, the outbound host
// allowlist — arrives here as strictly decoded DATA from config/fetch.json;
// the Go source stays vendor-neutral, and any config fault degrades a panel
// to its snapshot default and its neutral title instead of failing
// construction.

package panels

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// buildBuiltinPanels assembles the explicit panel list. Every panel starts
// from its snapshot; boss-log and token-usage are upgraded to fetch-backed
// sources when the embedded config and the fail-closed constructor both
// accept them. Any fault leaves the affected panel snapshot-only (serving
// stale is impossible to confuse with fresh), never a missing panel.
func buildBuiltinPanels() []panelDefinition {
	tokenUsageSnapshot := SnapshotSource{Name: "snapshots/token-usage.json"}
	vcsActivitySnapshot := SnapshotSource{Name: "snapshots/vcs-activity.json"}
	bossLogSnapshot := SnapshotSource{Name: "snapshots/boss-log.json"}
	definitions := []panelDefinition{
		{id: "token-usage", kind: KindTokenUsageV2, title: "Token usage", source: tokenUsageSnapshot},
		{id: "vcs-activity", kind: KindVCSActivity, title: "Version-control activity", source: vcsActivitySnapshot},
		// The id and kind are the panel's stable public identity and stay put;
		// the TITLE is display copy the owner chose, and the panel now serves
		// the account's skills beside its boss tallies rather than a boss log
		// alone. Renaming identity to follow copy would break every stored
		// URL and mint a kind version for a heading change.
		{id: "boss-log", kind: KindBossLog, title: "Old School RuneScape Stats", source: bossLogSnapshot},
	}
	document, bounds, err := loadFetchConfig(fetchConfigBytes)
	if err != nil {
		return definitions
	}
	applyTitles(definitions, document.Titles)
	for index, upgrade := range []struct {
		fallback SnapshotSource
		specs    panelFetchSpecs
	}{
		{tokenUsageSnapshot, panelFetchSpecs{usage: document.TokenUsage}},
		{vcsActivitySnapshot, panelFetchSpecs{vcs: document.VCSActivity}},
		{bossLogSnapshot, panelFetchSpecs{bossLog: document.BossLog}},
	} {
		if upgrade.specs.usage == nil && upgrade.specs.vcs == nil && upgrade.specs.bossLog == nil {
			continue
		}
		if source, err := NewFetchSource(upgrade.fallback, bounds, upgrade.specs); err == nil {
			definitions[index].source = source
		}
	}
	return definitions
}

// applyTitles overlays the configured display headings onto the panel list,
// in place, keyed by panel id.
//
// Headings are data because a heading is display copy the OWNER chooses, and
// what they choose may be the name of a service — which this package's source
// may never spell, so that swapping where a panel's data comes from stays a
// data edit and the compiled binary carries no coupling to any vendor
// (doctrine_test's vendor pin). Identity is untouched: the id and kind are the
// panel's stable public contract and no config entry can move them.
//
// Two non-choices are treated as no override, both deliberately: an id with no
// entry, and an entry that is empty. A blank heading is a rendering defect
// rather than a decision, so the neutral title the panel list declares stands
// in every case config does not clearly replace it — including the case where
// config never loaded at all, since the caller returns before reaching here.
func applyTitles(definitions []panelDefinition, titles map[string]string) {
	for index, definition := range definitions {
		if title, ok := titles[definition.id]; ok && title != "" {
			definitions[index].title = title
		}
	}
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
// field; endpoint and host admissibility are checked by NewFetchSource. The
// exclusion list may not be empty: the upstream activity table always mixes
// non-bosses in, so an empty list means the list was lost, and serving clue
// tiers as bosses is a silent wrong answer rather than a loud one.
func validateBossLogSpec(spec *bossLogFetchSpec) error {
	if spec.Endpoint == "" || spec.Account == "" || len(spec.ExcludeActivities) == 0 {
		return errors.New("boss-log fetch spec: endpoint, account, and excluded activities are all required")
	}
	for _, activity := range spec.ExcludeActivities {
		if activity == "" {
			return errors.New("boss-log fetch spec: empty excluded activity name")
		}
	}
	return validateRefreshInterval("boss-log fetch spec", spec.MinIntervalMinutes)
}

// validateRefreshInterval bounds one declared rate budget. Zero means the spec
// declares none and the loop's cadence governs; any declared value has to sit
// inside the reviewed band, so neither a typo of 0.5 rounded to nothing nor a
// stray 100000 can reach the scheduler.
func validateRefreshInterval(what string, minutes int) error {
	if minutes == 0 {
		return nil
	}
	interval := time.Duration(minutes) * time.Minute
	if minutes < 0 || interval < minEndpointInterval || interval > maxEndpointInterval {
		return fmt.Errorf("%s: minIntervalMinutes %d is outside the reviewed %v..%v band", what, minutes, minEndpointInterval, maxEndpointInterval)
	}
	return nil
}

// validateVCSActivitySpec rejects a version-control fetch spec missing its
// endpoint, carrying a header outside the public-producer allowlist, naming a
// cadence outside the reviewed band, or describing a malformed commit half.
// Both halves of this panel are public and unauthenticated, so both go through
// the same rules — a new producer must not arrive with looser ones.
func validateVCSActivitySpec(spec *vcsActivityFetchSpec) error {
	if spec.Endpoint == "" {
		return errors.New("vcs-activity fetch spec: endpoint is required")
	}
	if err := validateVCSHeaders("vcs-activity fetch spec", spec.Headers); err != nil {
		return err
	}
	if err := validateRefreshInterval("vcs-activity fetch spec", spec.MinIntervalMinutes); err != nil {
		return err
	}
	return validateVCSCommitsSpec(spec.Commits)
}

// validateVCSCommitsSpec applies the SAME public-producer rules to the commit
// half: no credential-bearing header, a bounded cadence, a bounded row count,
// and a labeled endpoint for every source. An absent spec is valid — the
// panel simply serves no commit list.
func validateVCSCommitsSpec(spec *vcsCommitsFetchSpec) error {
	if spec == nil {
		return nil
	}
	if len(spec.Sources) == 0 {
		return errors.New("vcs-commits fetch spec: no sources")
	}
	for _, source := range spec.Sources {
		if source.Repo == "" || source.Endpoint == "" {
			return errors.New("vcs-commits fetch spec: every source needs a repo label and an endpoint")
		}
	}
	if err := validateVCSHeaders("vcs-commits fetch spec", spec.Headers); err != nil {
		return err
	}
	if spec.Max <= 0 || spec.Max > maxServedCommits {
		return fmt.Errorf("vcs-commits fetch spec: max %d is outside (0, %d]", spec.Max, maxServedCommits)
	}
	return validateRefreshInterval("vcs-commits fetch spec", spec.MinIntervalMinutes)
}

// validateVCSHeaders refuses any request header outside
// vcsActivityHeaderAllowlist. The spec carries no credential FIELD, but that
// alone proved nothing: a header map is a general escape hatch, and an
// "Authorization: Bearer ..." entry in config data would have sent a
// credential from producers this repository documents as public and
// unauthenticated. Restricting the header NAMES to the one these producers
// actually need makes that unrepresentable instead of merely undocumented;
// widening the list is a conscious edit and a different security review.
func validateVCSHeaders(what string, headers map[string]string) error {
	for name := range headers {
		if !vcsActivityHeaderAllowed(name) {
			return fmt.Errorf("%s: header %q is not permitted; this producer is public and sends no credential", what, name)
		}
	}
	return nil
}

// vcsActivityHeaderAllowed reports whether a configured header name is on the
// producer's allowlist, matched case-insensitively because header names are.
func vcsActivityHeaderAllowed(name string) bool {
	for _, allowed := range vcsActivityHeaderAllowlist {
		if strings.EqualFold(name, allowed) {
			return true
		}
	}
	return false
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
