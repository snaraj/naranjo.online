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
	codingProjectsSnapshot := SnapshotSource{Name: "snapshots/coding-projects.json"}
	definitions := []panelDefinition{
		{id: "token-usage", kind: KindTokenUsageV2, title: "Token usage", source: tokenUsageSnapshot},
		{id: "vcs-activity", kind: KindVCSActivity, title: "Version-control activity", source: vcsActivitySnapshot},
		// The id and kind are the panel's stable public identity and stay put;
		// the TITLE is display copy the owner chose, and the panel now serves
		// the account's skills beside its boss tallies rather than a boss log
		// alone. Renaming identity to follow copy would break every stored
		// URL and mint a kind version for a heading change.
		{id: "boss-log", kind: KindBossLog, title: "Old School RuneScape", source: bossLogSnapshot},
		{id: "coding-projects", kind: KindCodingProjects, title: "Coding projects", source: codingProjectsSnapshot},
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
		{codingProjectsSnapshot, panelFetchSpecs{projects: document.CodingProjects}},
	} {
		if upgrade.specs.usage == nil && upgrade.specs.vcs == nil &&
			upgrade.specs.bossLog == nil && upgrade.specs.projects == nil {
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

// mustLoadModelVocabulary loads the embedded model vocabulary or stops the
// program. The bytes are compiled in, so a fault here is a BUILD defect that
// no runtime input can reach or repair; the alternatives are both worse. An
// empty vocabulary would refuse every model section for the life of the
// process while looking healthy, and a partially loaded one would admit a
// subset nobody reviewed. Refusing to start is the loud, fail-closed answer,
// and loadModelVocabulary below is a pure function so every refusal it can
// reach is exercised by tests rather than by a broken binary.
func mustLoadModelVocabulary(raw []byte) ([]string, map[string]bool) {
	serveOrder, groups, err := loadModelVocabulary(raw)
	if err != nil {
		panic("panels: the embedded model vocabulary is unusable: " + err.Error())
	}
	return serveOrder, groups
}

// mustLoadSourceVocabulary loads the embedded SOURCE vocabulary or stops the
// program, for mustLoadModelVocabulary's reason exactly: the bytes are
// compiled in, so a fault is a build defect no runtime input can reach, and
// a half-loaded vocabulary would leave a source the page cannot name.
func mustLoadSourceVocabulary(raw []byte, groups map[string]bool) map[string]string {
	names, err := loadSourceVocabulary(raw, groups)
	if err != nil {
		panic("panels: the embedded source vocabulary is unusable: " + err.Error())
	}
	return names
}

// loadSourceVocabulary strictly decodes the embedded source vocabulary — the
// second data file of the one rule the model vocabulary states (issue #267).
// A source KEY is what the wire carries: the pushed document's source labels,
// the snapshot's own labels and the fetch config's are all that key, and a
// key is not display copy. What a reader prints beside a graph is the NAME,
// and until this file existed there was nowhere to declare one, so the page
// printed the key or spelled the name in a component — a fourth table of
// exactly the kind issue #302 retired for models.
//
// The rules are the model vocabulary's, narrowed to what a source is:
//
//   - the schema marker is the one this code understands;
//   - every key is label-shaped and declared once, so one key cannot name two
//     sources and a display name can never travel as a key;
//   - every name is present, bounded and declared once, so a blank heading
//     cannot ship and two sources cannot render identically;
//   - every vendor is a GROUP KEY of the model vocabulary, so the two data
//     files cannot come to disagree about who a source belongs to.
//
// The origin reads nothing but those rules: it never prints a name. The page
// imports the same bytes, which is what keeps the name out of every compiled
// artifact that is not this file.
func loadSourceVocabulary(raw []byte, groups map[string]bool) (map[string]string, error) {
	var document sourcesDocument
	if err := decodeStrict(raw, &document); err != nil {
		return nil, err
	}
	if document.Schema != sourcesSchema {
		return nil, fmt.Errorf("source vocabulary: schema %q is not %q", document.Schema, sourcesSchema)
	}
	if len(document.Sources) == 0 {
		return nil, errors.New("source vocabulary: no sources")
	}
	names := make(map[string]string, len(document.Sources))
	written := make(map[string]bool, len(document.Sources))
	for _, source := range document.Sources {
		if !isLabelShaped(source.Key) {
			return nil, fmt.Errorf("source vocabulary: %q is not a machine key", source.Key)
		}
		if _, ok := names[source.Key]; ok {
			return nil, fmt.Errorf("source vocabulary: %q is declared twice", source.Key)
		}
		if source.Name == "" || len(source.Name) > maxSourceNameBytes {
			return nil, fmt.Errorf("source vocabulary: %q carries no written name inside the %d byte bound", source.Key, maxSourceNameBytes)
		}
		if written[source.Name] {
			return nil, fmt.Errorf("source vocabulary: %q repeats a written name; two sources would render identically", source.Key)
		}
		if !groups[source.Vendor] {
			return nil, fmt.Errorf("source vocabulary: %q names a vendor the model vocabulary does not group", source.Key)
		}
		written[source.Name] = true
		names[source.Key] = source.Name
	}
	return names, nil
}

// loadModelVocabulary strictly decodes the embedded model vocabulary and
// proves every rule the rest of the pipeline then relies on:
//
//   - the schema marker is the one this code understands;
//   - the residual holds the neutral slot and leads the serve order, so the
//     fold never lands on a named entity's swatch;
//   - every key is unique across every group, so one key cannot mean two
//     entities and the serve order cannot repeat a row;
//   - every slot is unique WITHIN its group, because a slot is an identity
//     inside the block that renders it — reuse ACROSS groups is deliberate
//     and fine, since colour is never the only channel;
//   - every raw identifier is lowercase and unique across the whole file, so
//     the producer's fold is deterministic whichever member it checks first;
//   - every key, label and group label is present and label-shaped, so a
//     blank heading or an unrenderable key cannot ship.
//
// A fault in any of them refuses the whole file rather than dropping the
// offending member: a vocabulary with a hole is a pipeline whose three
// readers disagree, which is the failure this file exists to make impossible.
// It returns the serve order AND the set of group keys, because the source
// vocabulary beside it declares which group each source belongs to and the
// two files may never disagree about who exists (issue #267). Deriving the
// set here rather than re-decoding the file for it means there is one
// reading of these bytes, not two.
func loadModelVocabulary(raw []byte) ([]string, map[string]bool, error) {
	var document modelsDocument
	if err := decodeStrict(raw, &document); err != nil {
		return nil, nil, err
	}
	if document.Schema != modelsSchema {
		return nil, nil, fmt.Errorf("model vocabulary: schema %q is not %q", document.Schema, modelsSchema)
	}
	if err := validateModelMember(document.Residual); err != nil {
		return nil, nil, fmt.Errorf("model vocabulary residual: %w", err)
	}
	if document.Residual.Slot != 0 {
		return nil, nil, errors.New("model vocabulary: the residual must hold the neutral slot 0")
	}
	if len(document.Residual.IDs) != 0 || document.Residual.PrefixStrip {
		return nil, nil, errors.New("model vocabulary: the residual is the fold of everything else and can never be named by an identifier")
	}
	if len(document.Groups) == 0 {
		return nil, nil, errors.New("model vocabulary: no groups")
	}
	serveOrder := []string{document.Residual.Key}
	keys := map[string]bool{document.Residual.Key: true}
	identifiers := map[string]bool{}
	groups := map[string]bool{}
	for _, group := range document.Groups {
		if !isLabelShaped(group.Key) || group.Label == "" {
			return nil, nil, errors.New("model vocabulary: every group needs a label-shaped key and a written label")
		}
		if groups[group.Key] {
			return nil, nil, fmt.Errorf("model vocabulary: group %q is declared twice", group.Key)
		}
		groups[group.Key] = true
		if len(group.Members) == 0 {
			return nil, nil, fmt.Errorf("model vocabulary: group %q has no members", group.Key)
		}
		slots := map[int]bool{}
		for _, member := range group.Members {
			if err := validateModelMember(member); err != nil {
				return nil, nil, fmt.Errorf("model vocabulary: group %q: %w", group.Key, err)
			}
			if member.Slot == document.Residual.Slot {
				return nil, nil, fmt.Errorf("model vocabulary: %q takes the residual's neutral slot", member.Key)
			}
			if slots[member.Slot] {
				return nil, nil, fmt.Errorf("model vocabulary: group %q paints two members with slot %d", group.Key, member.Slot)
			}
			slots[member.Slot] = true
			if keys[member.Key] {
				return nil, nil, fmt.Errorf("model vocabulary: %q is declared twice", member.Key)
			}
			keys[member.Key] = true
			for _, identifier := range member.IDs {
				if identifier == "" || identifier != strings.ToLower(identifier) {
					return nil, nil, fmt.Errorf("model vocabulary: %q carries an identifier that is not lowercase", member.Key)
				}
				if identifiers[identifier] {
					return nil, nil, fmt.Errorf("model vocabulary: an identifier folds to two members, including %q", member.Key)
				}
				identifiers[identifier] = true
			}
			serveOrder = append(serveOrder, member.Key)
		}
	}
	return serveOrder, groups, nil
}

// validateModelMember holds one member to the shape every stage assumes: a
// machine key the wire can carry and both readers can admit, and a written
// label neither of them has to invent.
func validateModelMember(member modelsMember) error {
	if !isLabelShaped(member.Key) {
		return fmt.Errorf("%q is not a machine key", member.Key)
	}
	if member.Label == "" {
		return fmt.Errorf("%q carries no written label", member.Key)
	}
	if member.Slot < 0 {
		return fmt.Errorf("%q carries a negative palette slot", member.Key)
	}
	return nil
}

// isLabelShaped reports whether a key is the machine shape every stage of
// this pipeline agrees on: a lowercase letter, then lowercase letters,
// digits and hyphens, bounded. It is the same grammar the producer's
// emission guard admits, which is why a display name can never travel as a
// key.
func isLabelShaped(key string) bool {
	if len(key) == 0 || len(key) > 32 {
		return false
	}
	for index, letter := range key {
		switch {
		case letter >= 'a' && letter <= 'z':
		case index > 0 && (letter >= '0' && letter <= '9' || letter == '-'):
		default:
			return false
		}
	}
	return true
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
// Its public fallbacks retain the narrow static-header rules; optional
// authenticated paths carry credentials only through their dedicated fields.
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
	if err := validateVCSCommitsSpec(spec.Commits); err != nil {
		return err
	}
	return validateVCSCalendarSpec(spec.Calendar)
}

// validateVCSCalendarSpec rejects a credentialed calendar spec that is not
// fully described. An absent spec is valid — the panel then reads only the
// public document, which is what it did before this producer existed.
//
// Two of these checks exist for reasons the field names do not carry:
//
//   - The QUERY must declare both window variables. This package computes the
//     window and posts it; a query that ignores the variables would be sent
//     happily and answered with the upstream's own default range, which is not
//     Sunday-aligned and would shift every cell's date. A missing variable is
//     a silently wrong calendar, so it is refused at construction instead.
//   - The header map is held to the CREDENTIALED producer's own allowlist, not
//     the public one, and neither list may name a credential header. The
//     credential travels through KeyHeader, which is filled from the
//     environment at fetch time; a static map that could name it would be the
//     escape hatch validateVCSHeaders exists to close.
func validateVCSCalendarSpec(spec *vcsCalendarFetchSpec) error {
	if spec == nil {
		return nil
	}
	if spec.Endpoint == "" || spec.Query == "" || spec.KeyEnvName == "" || spec.KeyHeader == "" {
		return errors.New("vcs-calendar fetch spec: endpoint, query, keyEnvName, and keyHeader are all required")
	}
	for _, variable := range []string{calendarFromVariable, calendarToVariable} {
		if !strings.Contains(spec.Query, variable) {
			return fmt.Errorf("vcs-calendar fetch spec: the query does not declare %s, so it would be answered over the upstream's own window", variable)
		}
	}
	if spec.ContentType == "" {
		return errors.New("vcs-calendar fetch spec: contentType is required")
	}
	if err := validateHeaderAllowlist("vcs-calendar fetch spec", spec.Headers, graphQLHeaderAllowlist); err != nil {
		return err
	}
	return validateAuthenticatedRefreshInterval("vcs-calendar fetch spec", spec.AuthenticatedMinIntervalMinutes, true)
}

// validateCodingProjectsSpec rejects a repository-metadata spec that is not
// fully described: a listing endpoint, the account pin every listed row is
// checked against, an exclusion list of well-formed names, a cadence inside
// the reviewed band, and a header map held to the public-producer allowlist.
// The credential fields are optional together — a spec naming an environment
// variable must also name the header it rides in, because a credential with
// nowhere to go is a configuration accident rather than a choice to read
// anonymously.
//
// The exclusion list may be EMPTY: "curate nothing out" is the owner's
// current ruling, and the field existing as data is what makes future
// curation an edit here rather than a code change. Its entries are held to
// the repository name grammar so a typo cannot sit in the list matching
// nothing forever.
func validateCodingProjectsSpec(spec *codingProjectsFetchSpec) error {
	if spec.ListingEndpoint == "" || spec.Account == "" {
		return errors.New("coding-projects fetch spec: listingEndpoint and account are both required")
	}
	if !isAccountLogin(spec.Account) {
		return fmt.Errorf("coding-projects fetch spec: %q is not an account login", spec.Account)
	}
	seen := make(map[string]bool, len(spec.Exclude))
	for _, name := range spec.Exclude {
		if !isRepositoryName(name) {
			return fmt.Errorf("coding-projects fetch spec: excluded name %q is outside the repository name grammar", name)
		}
		if seen[name] {
			return fmt.Errorf("coding-projects fetch spec: %q is excluded twice", name)
		}
		seen[name] = true
	}
	if (spec.KeyEnvName == "") != (spec.KeyHeader == "") {
		return errors.New("coding-projects fetch spec: keyEnvName and keyHeader are declared together or not at all")
	}
	if spec.ContentType == "" {
		return errors.New("coding-projects fetch spec: contentType is required")
	}
	if err := validateHeaderAllowlist("coding-projects fetch spec", spec.Headers, vcsActivityHeaderAllowlist); err != nil {
		return err
	}
	if spec.Repositories != nil {
		// The credentialed document declares no variables: it asks the
		// credential's own account for the repositories it owns, so the whole
		// question is in the literal text and nothing varies per round.
		if err := validateQueryDocument("coding-projects repositories document", spec.Repositories); err != nil {
			return err
		}
		// The mapper refuses an answer whose viewer login is not the
		// configured account; a document that never selects the login would
		// make every credentialed round refuse at runtime. That is fail-closed,
		// but it is the wrong place to learn it: the selection is required
		// here, at construction, the way the variables above are.
		if !selectsViewerLogin(spec.Repositories.Query) {
			return errors.New("coding-projects fetch spec: the repositories document does not select the viewer's login, so its answer could not be checked against the configured account")
		}
		if spec.KeyEnvName == "" {
			return errors.New("coding-projects fetch spec: the repositories document requires a configured credential")
		}
	}
	if err := validateRefreshInterval("coding-projects fetch spec", spec.MinIntervalMinutes); err != nil {
		return err
	}
	return validateAuthenticatedRefreshInterval("coding-projects fetch spec", spec.AuthenticatedMinIntervalMinutes, spec.KeyEnvName != "")
}

// validateVCSCommitsSpec holds the commit half to its two credentialed query
// documents, the account every named row must belong to, the credential both
// documents ride on, bounded cadences, and a bounded row count. An absent spec
// is valid — the panel simply serves no commit list.
//
// The variable checks are the load-bearing ones, exactly as the calendar's
// are. A discovery document that does not declare the window would be answered
// over the upstream's own default range, and a history document that does not
// declare BOTH the author and the identity list would be answered with
// everybody's commits or nobody's — each a silently wrong log rather than a
// failed read, so each is refused at construction instead of sent.
func validateVCSCommitsSpec(spec *vcsCommitsFetchSpec) error {
	if spec == nil {
		return nil
	}
	if err := validateQueryDocument("vcs-commits contributions document", spec.Contributions, calendarFromVariable, calendarToVariable); err != nil {
		return err
	}
	if err := validateQueryDocument("vcs-commits history document", spec.History, historyAuthorVariable, historyIDsVariable); err != nil {
		return err
	}
	if !isAccountLogin(spec.Owner) {
		return fmt.Errorf("vcs-commits fetch spec: %q is not an account login", spec.Owner)
	}
	if spec.KeyEnvName == "" || spec.KeyHeader == "" {
		return errors.New("vcs-commits fetch spec: keyEnvName and keyHeader are both required")
	}
	if spec.Max <= 0 || spec.Max > maxServedCommits {
		return fmt.Errorf("vcs-commits fetch spec: max %d is outside (0, %d]", spec.Max, maxServedCommits)
	}
	if err := validateRefreshInterval("vcs-commits fetch spec", spec.MinIntervalMinutes); err != nil {
		return err
	}
	return validateAuthenticatedRefreshInterval("vcs-commits fetch spec", spec.AuthenticatedMinIntervalMinutes, true)
}

// validateQueryDocument is the shared gate over one credentialed query
// document: it must be fully described, may carry only the query producers'
// own two static headers, and must DECLARE every variable this package
// supplies for it. A document that silently ignores a variable is answered
// over the upstream's own defaults — a wrong answer rather than a failed one —
// which is why this is a construction-time refusal rather than a runtime
// check.
// selectsViewerLogin reports whether a document opens its viewer block with
// the viewer's own login — the selection the credentialed repository document
// must carry so its answer can be checked against the configured account.
// Braces are spaced out and whitespace collapsed first, so the check reads the
// selection rather than the author's layout of it.
func selectsViewerLogin(query string) bool {
	spaced := strings.NewReplacer("{", " { ", "}", " } ").Replace(query)
	normalized := strings.Join(strings.Fields(spaced), " ") + " "
	return strings.Contains(normalized, "viewer { login ")
}

func validateQueryDocument(what string, spec *graphQLDocumentSpec, variables ...string) error {
	if spec == nil {
		return fmt.Errorf("%s: is required", what)
	}
	if spec.Endpoint == "" || spec.Query == "" || spec.ContentType == "" {
		return fmt.Errorf("%s: endpoint, query, and contentType are all required", what)
	}
	for _, variable := range variables {
		if !strings.Contains(spec.Query, variable) {
			return fmt.Errorf("%s: the query does not declare %s, so it would be answered over the upstream's own defaults", what, variable)
		}
	}
	return validateHeaderAllowlist(what, spec.Headers, graphQLHeaderAllowlist)
}

// validateAuthenticatedRefreshInterval keeps a fast path inseparable from
// the credential that makes its larger upstream budget true. Zero is the
// backwards-compatible choice to use the public interval even when a key is
// present; a positive interval without any key field would silently hammer
// the anonymous allowance and is refused.
func validateAuthenticatedRefreshInterval(what string, minutes int, credentialConfigured bool) error {
	if minutes == 0 {
		return nil
	}
	if !credentialConfigured {
		return fmt.Errorf("%s: authenticatedMinIntervalMinutes requires a configured credential", what)
	}
	return validateRefreshInterval(what+" authenticated cadence", minutes)
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
	return validateHeaderAllowlist(what, headers, vcsActivityHeaderAllowlist)
}

// validateHeaderAllowlist is the shared rule: a configured static header name
// must be on the allowlist its own producer was reviewed against. Producers do
// not share one list — the credentialed calendar needs to declare the media
// type of the body it posts and the public ones must never be able to — so the
// list is a parameter, and widening any of them stays a conscious edit beside
// the list itself.
func validateHeaderAllowlist(what string, headers map[string]string, allowlist []string) error {
	for name := range headers {
		if !headerAllowed(name, allowlist) {
			return fmt.Errorf("%s: header %q is not permitted; this producer's static headers are held to a reviewed list and a credential never travels in one", what, name)
		}
	}
	return nil
}

// headerAllowed reports whether a configured header name is on the given
// allowlist, matched case-insensitively because header names are.
func headerAllowed(name string, allowlist []string) bool {
	for _, allowed := range allowlist {
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
	if err := validateRefreshInterval("token-usage fetch spec", spec.MinIntervalMinutes); err != nil {
		return err
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
