// types.go collects every type, const, and var declaration in package panels
// so a reader can survey the panel data model, the registry, and the source
// contracts in one place. Methods stay beside the logic they serve: registry
// construction in registry.go, HTTP serving in handler.go, snapshot loading
// in snapshot.go, embedded-config loading in config.go, upstream-grammar
// mapping in mapping.go, the live-fetch transport in fetch.go (the package's
// ONLY egress-capable file, pinned by doctrine_test), background refresh in
// refresh.go, and strict-decoding admission in utils.go.

package panels

import (
	"embed"
	"encoding/json"
	"io/fs"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

const (
	// EnvelopeSchema is the one envelope version every panel response carries.
	// The envelope is stable forever by design; evolution happens inside the
	// kind-versioned data payloads, never by breaking this outer shape.
	EnvelopeSchema = "panel/v1"

	// IndexPath is the public route listing every registered panel.
	IndexPath = "/api/panels"
	// PanelPathPrefix is the public route prefix under which each panel's
	// full envelope is served as /api/panels/<id>.
	PanelPathPrefix = "/api/panels/"

	// MaxIndexResponseBytes is the owner's performance budget for the index
	// response body. It is structural: an index build that exceeds it is
	// replaced by an empty listing at construction or refresh time, and a
	// test pins the shipped index far below it.
	MaxIndexResponseBytes = 4 << 10
	// MaxPanelResponseBytes is the owner's performance budget for one panel
	// envelope. Construction refuses larger bodies by degrading the panel to
	// unavailable, and the refresh path refuses oversized live payloads by
	// keeping the last good response, so the budget is structural.
	MaxPanelResponseBytes = 32 << 10
)

// Panel kinds are versioned independently of the envelope. A breaking payload
// change mints a new kind version; it never mutates an existing one.
const (
	// KindTokenUsage reports model token consumption per source. Source labels
	// are data supplied by snapshots and config — never Go identifiers — so a
	// new tool or vendor appears by shipping data, not by editing code.
	KindTokenUsage = "token-usage/v1"
	// KindVCSActivity reports contribution activity: weekly counts, totals,
	// the current streak, and recent commits.
	KindVCSActivity = "vcs-activity/v1"
	// KindBossLog reports one game account's boss tallies.
	KindBossLog = "boss-log/v1"
)

// Status is the envelope serving state. It reflects data provenance, never
// server health — an unavailable panel still answers 200 with its identity.
type Status string

const (
	// StatusOK marks data freshly fetched (or, for snapshot-only panels,
	// loaded from the panel's own snapshot) through strict validation.
	StatusOK Status = "ok"
	// StatusStale marks data that is being served but is not fresh: the
	// embedded snapshot fallback of a fetch-backed panel, a retained
	// last-good payload whose refresh is failing, or a payload only some of
	// whose sources could be fetched.
	StatusStale Status = "stale"
	// StatusUnavailable marks a panel whose data could not be loaded or
	// validated at all. The envelope still serves — identity intact, data
	// null — so a bad data file can never take a route or the process down.
	StatusUnavailable Status = "unavailable"
)

// Envelope is the one response shape every panel serves, forever:
// {schema, id, kind, title, generatedAt, status, data}. Data holds the
// kind-versioned payload and marshals as null when the panel is unavailable.
type Envelope struct {
	// Schema is always EnvelopeSchema.
	Schema string `json:"schema"`
	// ID is the stable registry identifier, the last path element of the URL.
	ID string `json:"id"`
	// Kind names the versioned payload type inside Data.
	Kind string `json:"kind"`
	// Title is the human heading the frontend renders above the panel.
	Title string `json:"title"`
	// GeneratedAt is the RFC 3339 instant the data was produced — snapshot
	// capture time or live fetch time, never request time. Omitted when
	// unavailable.
	GeneratedAt string `json:"generatedAt,omitempty"`
	// Status is ok, stale, or unavailable.
	Status Status `json:"status"`
	// Data is the kind-versioned payload; nil marshals as JSON null.
	Data json.RawMessage `json:"data"`
}

// Index is the /api/panels response body: the registry's public listing.
type Index struct {
	// Panels lists every registered panel in registry order.
	Panels []IndexEntry `json:"panels"`
}

// IndexEntry is one panel's row in the index: identity plus current status,
// enough for a frontend to lay out the dashboard before fetching envelopes.
type IndexEntry struct {
	// ID is the registry identifier used in the panel URL.
	ID string `json:"id"`
	// Kind names the versioned payload the panel serves.
	Kind string `json:"kind"`
	// Title is the human heading.
	Title string `json:"title"`
	// Status mirrors the envelope's serving status.
	Status Status `json:"status"`
}

// TokenUsageData is the token-usage/v1 payload: token consumption windows
// grouped per source. Sources are data labels — a vendor's or tool's name
// arrives in snapshot and config bytes, and adding a source is a data change,
// never a code change (doctrine_test pins vendor names out of Go source).
type TokenUsageData struct {
	// Sources holds one entry per reporting tool or vendor.
	Sources []TokenUsageSource `json:"sources"`
}

// TokenUsageSource is one labeled origin of token-usage windows. Label and
// Windows are the original v1 fields; Account, Stats, Series, and Insights
// were added later and are all optional, so a payload written before they
// existed still decodes and still renders — an additive extension inside the
// same kind version, never a breaking reshape.
type TokenUsageSource struct {
	// Label is the display name of the source, supplied as data.
	Label string `json:"label"`
	// Account is the public account handle the figures belong to, when the
	// source reports one. Data, like every other vendor-specific string.
	Account string `json:"account,omitempty"`
	// Windows holds the source's usage windows, e.g. today and week.
	Windows []TokenUsageWindow `json:"windows"`
	// Stats holds headline figures rendered as tiles above the windows.
	Stats []TokenUsageStat `json:"stats,omitempty"`
	// Series is the daily consumption series the activity grid renders.
	Series *TokenUsageSeries `json:"series,omitempty"`
	// Insights holds the labeled proportions rendered under the grid.
	Insights []TokenUsageInsight `json:"insights,omitempty"`
}

// TokenUsageStat is one headline tile: a stable key, a display label, a
// magnitude, and the unit that magnitude is measured in. Value is a pointer
// because "the source does not report this figure" is real information the
// tile renders as an explicit dash — omitempty would erase the distinction
// between an unreported figure and a genuine zero.
type TokenUsageStat struct {
	// Key is the stable identifier, e.g. "lifetime" or "longest-streak".
	Key string `json:"key"`
	// Label is the human tile caption, supplied as data.
	Label string `json:"label"`
	// Value is the magnitude in Unit; null means the source reports none.
	Value *int64 `json:"value"`
	// Unit names how Value is measured: UnitTokens, UnitDays, or UnitSeconds.
	Unit string `json:"unit"`
	// Recorded marks a figure that came from a dated out-of-band capture
	// rather than the live feed, so the tile can say so instead of implying
	// a freshness it does not have.
	Recorded bool `json:"recorded,omitempty"`
}

// Stat units. The frontend formats by unit — compact digits for token
// counts, whole days for streaks, and an hours-and-minutes duration for
// elapsed seconds — so a new unit is a conscious edit on both sides.
const (
	// UnitTokens measures a token count.
	UnitTokens = "tokens"
	// UnitDays measures a whole number of days.
	UnitDays = "days"
	// UnitSeconds measures an elapsed duration in seconds.
	UnitSeconds = "seconds"
)

// TokenUsageSeries is the daily consumption series behind the activity grid,
// held as a start date plus one total per day so a year of dailies stays a
// few kilobytes. Day n is StartDate plus n days; the series is contiguous by
// construction, with zeros for days the source reported nothing.
type TokenUsageSeries struct {
	// StartDate is the calendar date of Totals[0], as YYYY-MM-DD.
	StartDate string `json:"startDate"`
	// Totals holds one combined input-plus-output token count per day.
	Totals []int64 `json:"totals"`
}

// TokenUsageInsight is one labeled proportion under the activity grid.
type TokenUsageInsight struct {
	// Label names the measured behavior, supplied as data.
	Label string `json:"label"`
	// Pct is the proportion in percent; null means unreported.
	Pct *float64 `json:"pct"`
	// Recorded carries the same provenance meaning as on a stat tile.
	Recorded bool `json:"recorded,omitempty"`
}

// TokenUsageWindow is one accounting window of token consumption.
type TokenUsageWindow struct {
	// Period names the window shape, e.g. "session", "today", or "week".
	Period string `json:"period"`
	// InputTokens counts tokens sent to the model inside the window.
	InputTokens int64 `json:"inputTokens"`
	// OutputTokens counts tokens produced by the model inside the window.
	OutputTokens int64 `json:"outputTokens"`
	// UtilizationPct is the window's limit utilization in percent, when the
	// source reports one.
	UtilizationPct *float64 `json:"utilizationPct,omitempty"`
	// ResetsAt is the RFC 3339 instant the window resets, when known.
	ResetsAt *string `json:"resetsAt,omitempty"`
}

// VCSActivityData is the vcs-activity/v1 payload: contribution-graph weeks,
// totals, the current streak, and the latest commits. EndDate was added
// later and is optional, so a payload written before it existed still
// decodes — an additive extension inside the same kind version.
type VCSActivityData struct {
	// TotalContributions is the count across the covered weeks.
	TotalContributions int `json:"totalContributions"`
	// Weeks holds per-week daily contribution counts, oldest week first,
	// seven days per week.
	Weeks [][]int `json:"weeks"`
	// EndDate is the calendar date (YYYY-MM-DD) of the last day the window
	// actually covers. The final week is padded to seven days like every
	// other, so without this the trailing padding is indistinguishable from
	// genuine zero-contribution days; with it the frontend draws days after
	// EndDate as holes. Empty when the producer cannot date the window.
	EndDate string `json:"endDate,omitempty"`
	// Streak is the current consecutive-day contribution streak.
	Streak int `json:"streak"`
	// RecentCommits lists the latest commits, newest first.
	RecentCommits []VCSCommit `json:"recentCommits"`
}

// VCSCommit is one recent commit reference.
type VCSCommit struct {
	// Repo is the repository's public name.
	Repo string `json:"repo"`
	// Message is the commit subject line.
	Message string `json:"message"`
	// At is the RFC 3339 commit instant.
	At string `json:"at"`
}

// BossLogData is the boss-log/v1 payload: one game account's skill table and
// boss tallies. The kind version stays v1 because Skills is ADDITIVE — a
// payload written before it existed still decodes and still renders, exactly
// like the token-usage tiles and the activity end date before it. A breaking
// reshape would mint a new kind; adding an optional section never does.
type BossLogData struct {
	// Account is the public account name.
	Account string `json:"account"`
	// Skills lists the account's skill rows in upstream order. Optional: it
	// arrived after the kind shipped, and a document that reports no skill
	// rows serves none rather than serving invented ones.
	Skills []BossLogSkill `json:"skills,omitempty"`
	// Bosses lists the tracked bosses in display order.
	Bosses []BossLogEntry `json:"bosses"`
}

// BossLogSkill is one skill row. Level, Rank, and XP are pointers for exactly
// the reason the boss row's fields are: the upstream reports -1 for a figure
// it does not have, null is data the frontend renders as "--", and omitempty
// would silently erase the difference between "unreported" and a real zero.
type BossLogSkill struct {
	// Name is the skill display name. One row is the account's combined
	// total rather than a trainable skill, and it is named by the upstream
	// like every other row — no skill name is a Go constant here.
	Name string `json:"name"`
	// Level is the reported level; null when the upstream reports none.
	Level *int64 `json:"level"`
	// Rank is the hiscore rank; null means unranked.
	Rank *int64 `json:"rank"`
	// XP is the reported experience; null when the upstream reports none.
	XP *int64 `json:"xp"`
}

// BossLogEntry is one boss row. KC and Rank are pointers because the
// hiscores legitimately have no value below the listing threshold: null is
// data — the frontend renders it as "--" — and must survive the round trip,
// which omitempty would silently erase.
type BossLogEntry struct {
	// Name is the boss display name.
	Name string `json:"name"`
	// KC is the kill count; null means unranked, rendered as "--".
	KC *int64 `json:"kc"`
	// Rank is the hiscore rank; null means unranked.
	Rank *int64 `json:"rank"`
	// Score is an optional mode-specific score (e.g. an Inferno best), only
	// present where the boss has one.
	Score *int64 `json:"score,omitempty"`
}

// Source supplies one panel's payload at registry construction time. The
// method is unexported on purpose: which source classes may feed the registry
// is a repository decision, so outside packages cannot smuggle a new one in.
// SnapshotSource loads its embedded file as StatusOK; FetchSource — built
// only through its fail-closed constructor — loads its embedded fallback as
// StatusStale and is then refreshed in the background, never on a request.
type Source interface {
	// load reads and strictly validates the panel payload for kind from fsys.
	// It runs exactly once per panel, at construction — never on a request.
	load(fsys fs.FS, kind string) (loadedPayload, error)
}

// loadedPayload is one successfully validated payload with its provenance
// and the serving status the data deserves.
type loadedPayload struct {
	// generatedAt is the validated RFC 3339 capture or fetch instant.
	generatedAt string
	// data is the canonical re-marshaled kind payload.
	data json.RawMessage
	// status is the provenance-derived serving status.
	status Status
}

// SnapshotSource serves a panel from one embedded JSON file: data captured
// out-of-band, shipped inside the binary, parsed strictly exactly once at
// construction. It is the zero-egress default for every panel and the
// cold-start fallback for fetch-backed panels.
type SnapshotSource struct {
	// Name is the embedded snapshot path, e.g. "snapshots/boss-log.json".
	Name string
}

// snapshotDocument is the on-disk shape of one snapshot file: the capture
// instant plus the raw kind payload, which is strictly decoded against the
// panel's kind before anything is served.
type snapshotDocument struct {
	// GeneratedAt is the RFC 3339 instant the snapshot was captured.
	GeneratedAt string `json:"generatedAt"`
	// Data is the kind payload, validated by decodeKindPayload.
	Data json.RawMessage `json:"data"`
}

// FetchConfig bounds the live-refresh path of a FetchSource. Every field is
// a hard limit; none may default open, and NewFetchSource refuses any
// configuration Validate rejects.
type FetchConfig struct {
	// Hosts is the exact allowlist of bare host names the source may ever
	// contact. An empty list is invalid: there is no "any host" value. The
	// list is enforced twice — at construction and again on every request
	// before it reaches the network.
	Hosts []string
	// TTL is how long a fetched payload stays fresh; the background refresher
	// wakes on this cadence and never faster.
	TTL time.Duration
	// Timeout bounds one fetch attempt end to end and must stay below TTL so
	// attempts can never overlap their own cadence.
	Timeout time.Duration
	// MaxBytes caps a raw fetched body. It can never exceed
	// maxFetchBodyBytes; the mapped panel payload is separately held to
	// MaxPanelResponseBytes.
	MaxBytes int64
	// InitialBackoff is the first retry delay after a failed refresh.
	InitialBackoff time.Duration
	// MaxBackoff caps the exponential retry delay growth.
	MaxBackoff time.Duration
}

// maxFetchBodyBytes is the absolute ceiling any FetchConfig.MaxBytes may
// take: raw upstream documents are pre-mapping working data, never served,
// and one mebibyte is far beyond every configured endpoint's real size.
const maxFetchBodyBytes = 1 << 20

// FetchSource is the live-data source: an embedded snapshot fallback that
// serves from cold start as StatusStale, plus the configuration for a
// background refresh loop that replaces it with freshly fetched, strictly
// validated data.
//
// The refresh contract, enforced by construction and pinned by tests:
//
//   - Refresh happens ONLY in a background goroutine on the TTL cadence.
//     The request path never fetches, never blocks, never touches I/O; it
//     keeps serving prepared bytes exactly as snapshot panels do.
//   - Each attempt contacts only hosts on the allowlist (refused at
//     construction AND again at request time), is bounded by Timeout, and
//     reads at most MaxBytes.
//   - A fetched document is admitted only through the same strict gate as
//     snapshots (decodeStrict / decodeKindPayload); anything else is
//     discarded and the last good payload keeps serving as StatusStale.
//   - Credentials are read from the environment variable NAMED IN CONFIG
//     DATA at fetch time only — never stored, never logged, never served.
//     An unset variable skips that source and its snapshot section serves
//     as StatusStale.
//   - Failed refreshes retry with exponential backoff from InitialBackoff
//     to MaxBackoff; a canceled context stops the loop before any attempt.
//
// A FetchSource can only be built through NewFetchSource, which fails closed
// on any unsafe bound, off-allowlist endpoint, or malformed spec.
type FetchSource struct {
	// fallback is the embedded cold-start snapshot, served as StatusStale.
	fallback SnapshotSource
	// config carries the validated refresh bounds.
	config FetchConfig
	// specs carries the one panel spec this source feeds.
	specs panelFetchSpecs
}

// panelFetchSpecs carries the per-kind fetch descriptions. EXACTLY ONE field
// may be set: a source feeds one panel, and NewFetchSource refuses any other
// arrangement, so "which upstream grammar does this source speak" is never
// ambiguous at refresh time.
type panelFetchSpecs struct {
	// bossLog is set when this source feeds a boss-log/v1 panel.
	bossLog *bossLogFetchSpec
	// usage is set when this source feeds a token-usage/v1 panel.
	usage *tokenUsageFetchSpec
	// vcs is set when this source feeds a vcs-activity/v1 panel.
	vcs *vcsActivityFetchSpec
}

// fetchConfigDocument is the on-disk shape of config/fetch.json: shared
// bounds plus per-panel endpoint specs. Every vendor-specific string —
// endpoint URLs, source labels, credential env-var names — lives here as
// data, never in Go source.
type fetchConfigDocument struct {
	// Hosts is the exact outbound host allowlist.
	Hosts []string `json:"hosts"`
	// TTLMinutes is the refresh cadence in minutes.
	TTLMinutes int `json:"ttlMinutes"`
	// TimeoutSeconds bounds one fetch attempt in seconds.
	TimeoutSeconds int `json:"timeoutSeconds"`
	// MaxBytes caps a raw fetched body in bytes.
	MaxBytes int64 `json:"maxBytes"`
	// InitialBackoffSeconds is the first retry delay in seconds.
	InitialBackoffSeconds int `json:"initialBackoffSeconds"`
	// MaxBackoffMinutes caps retry delay growth in minutes.
	MaxBackoffMinutes int `json:"maxBackoffMinutes"`
	// BossLog configures the boss-log panel's live fetch, if any.
	BossLog *bossLogFetchSpec `json:"bossLog"`
	// TokenUsage configures the token-usage panel's live fetch, if any.
	TokenUsage *tokenUsageFetchSpec `json:"tokenUsage"`
	// VCSActivity configures the version-control panel's live fetch, if any.
	VCSActivity *vcsActivityFetchSpec `json:"vcsActivity"`
}

// bossLogFetchSpec configures the boss-log live fetch: one public endpoint
// returning the hiscores/v1 grammar, mapped onto EVERY boss the upstream
// reports.
//
// The boss list is deliberately NOT enumerated here. The upstream activity
// table mixes bosses with things that are not bosses — clue-scroll tiers,
// minigame ranks, point totals — and it grows whenever new content ships.
// Enumerating bosses would mean silently dropping every boss added after the
// last edit; enumerating the NON-bosses means a new boss appears on its own
// and only a new non-boss activity needs an edit. Preserving an unknown
// entry is the fail-soft direction, and it is the one chosen here.
type bossLogFetchSpec struct {
	// Endpoint is the full request URL, account included as data.
	Endpoint string `json:"endpoint"`
	// Account is the public account name served in the payload.
	Account string `json:"account"`
	// ExcludeActivities lists the upstream activity names that are not
	// bosses. Everything else the upstream reports is served, in upstream
	// order, including entries this list has never heard of.
	ExcludeActivities []string `json:"excludeActivities"`
	// MaxBytes optionally tightens the shared body cap for this endpoint.
	MaxBytes int64 `json:"maxBytes"`
}

// vcsActivityHeaderAllowlist is the COMPLETE set of request headers the
// public activity producer may send. It exists because a header map is
// otherwise a general escape hatch: without this list, config data could
// attach an Authorization header to a producer documented as public and
// unauthenticated. One entry, because one is all the endpoint needs — it
// answers 406 to a JSON Accept header — and adding another is a conscious
// edit with its own security review.
var vcsActivityHeaderAllowlist = []string{"Accept"}

// vcsActivityFetchSpec configures the version-control activity fetch: one
// PUBLIC, UNAUTHENTICATED document carrying a contribution calendar. It
// names no credential because it needs none — the zero-secret producer the
// panel was always meant to have.
type vcsActivityFetchSpec struct {
	// Endpoint is the full request URL, account included as data.
	Endpoint string `json:"endpoint"`
	// Headers holds static request headers. The calendar endpoint answers
	// 406 to a JSON Accept header, so the document type it serves is
	// declared here as data rather than assumed in code.
	Headers map[string]string `json:"headers"`
	// MaxBytes optionally tightens the shared body cap for this endpoint.
	// The calendar document is markup around a small amount of data, so its
	// cap is necessarily larger than the JSON endpoints' — which is exactly
	// why the cap is per endpoint instead of one loose shared number.
	MaxBytes int64 `json:"maxBytes"`
}

// tokenUsageFetchSpec configures the token-usage live fetch: one entry per
// labeled source, each fully described by data.
type tokenUsageFetchSpec struct {
	// Sources lists the per-vendor fetch descriptions.
	Sources []usageSourceSpec `json:"sources"`
}

// usageSourceSpec describes one token-usage source entirely as data: where
// to fetch, which response grammar to expect, and which environment variable
// names the credential. No field of it ever reaches a log or a response.
type usageSourceSpec struct {
	// Label is the display label; it must match the snapshot section that
	// serves as this source's fallback.
	Label string `json:"label"`
	// Endpoint is the request URL without the time-range parameter.
	Endpoint string `json:"endpoint"`
	// Shape names the response grammar: shapeUsageReport or shapeUsagePage.
	Shape string `json:"shape"`
	// KeyEnvName is the environment variable holding the credential; unset
	// at fetch time means this source is skipped, never an error surface.
	KeyEnvName string `json:"keyEnvName"`
	// KeyHeader is the request header that carries the credential.
	KeyHeader string `json:"keyHeader"`
	// KeyPrefix is prepended to the credential in the header, e.g. "Bearer ".
	KeyPrefix string `json:"keyPrefix"`
	// Headers holds static request headers, e.g. an API version pin.
	Headers map[string]string `json:"headers"`
	// Window describes the lookback query parameter.
	Window windowParamSpec `json:"window"`
	// MaxBytes optionally tightens the shared body cap for this endpoint.
	MaxBytes int64 `json:"maxBytes"`
}

// windowParamSpec describes the time-range query parameter a usage endpoint
// requires, since its name and format differ per vendor.
type windowParamSpec struct {
	// Param is the query parameter name.
	Param string `json:"param"`
	// Format is windowFormatRFC3339 or windowFormatUnix.
	Format string `json:"format"`
	// LookbackDays is how far back the window starts.
	LookbackDays int `json:"lookbackDays"`
}

// Stat keys the live mapping can compute from a daily series alone. A
// recorded snapshot tile carrying the same key is replaced by the live one;
// keys the live feed cannot produce — a lifetime total, a longest single
// task — stay recorded, because no usage API reports them.
const (
	// statCurrentStreak is the current run of consecutive active days.
	statCurrentStreak = "current-streak"
	// statLongestStreak is the longest such run inside the series.
	statLongestStreak = "longest-streak"
	// statPeakDay is the busiest single day inside the series.
	statPeakDay = "peak-day"
	// statWindowTotal is every token counted inside the fetched window.
	statWindowTotal = "window-total"
)

// dayLayout is the calendar-date form the activity series indexes by.
const dayLayout = "2006-01-02"

// daysPerWeek is the contribution calendar's column height.
const daysPerWeek = 7

// maxCalendarDays bounds a parsed contribution calendar. The upstream
// document covers one year; anything past a little over that is markup drift
// or a hostile response, refused before it can inflate a payload against the
// owner's panel budget.
const maxCalendarDays = 400

// minCalendarDays is the smallest calendar worth serving. A document that
// yields fewer dated cells than this has not been parsed — its markup
// changed — and refusing keeps the last good payload instead of serving a
// four-cell "calendar" that looks like data.
const minCalendarDays = 28

// maxSeriesDays bounds a mapped activity series. The configured endpoints
// return at most a month of daily buckets, so any span beyond two years is
// upstream nonsense — refused before it can inflate a payload against the
// owner's panel budget.
const maxSeriesDays = 732

// Response grammar and window format names used by config data.
const (
	// shapeUsageReport is the bucketed usage-report grammar: data[] buckets
	// with per-result uncached/cached/output token fields.
	shapeUsageReport = "usage-report/v1"
	// shapeUsagePage is the paged bucket grammar: object/page with bucket
	// results carrying input_tokens/output_tokens aggregates.
	shapeUsagePage = "usage-page/v1"
	// windowFormatRFC3339 renders the lookback instant as RFC 3339.
	windowFormatRFC3339 = "rfc3339"
	// windowFormatUnix renders the lookback instant as Unix seconds.
	windowFormatUnix = "unix"
)

// hiscoresDocument is the strict upstream grammar of the hiscores lite
// endpoint. Upstream drift fails the strict gate and the panel keeps serving
// its last good data as stale — fail-closed, never fail-wrong.
type hiscoresDocument struct {
	// Name is the account name the upstream echoes back. The boss log serves
	// the configured account name, not this one, but the strict decoder must
	// know every field the document carries — and it did not, which is why
	// every live refresh of this panel failed before it could map a row.
	Name string `json:"name"`
	// Skills holds the skill table the panel's skill grid is mapped from.
	Skills []hiscoresSkill `json:"skills"`
	// Activities holds ranked activities including bosses.
	Activities []hiscoresActivity `json:"activities"`
}

// hiscoresSkill is one skill row of the hiscores document. Rank, Level, and
// XP are -1 when the account is unranked for that row, which maps to null in
// the served payload exactly as an unranked activity does.
type hiscoresSkill struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Rank  int64  `json:"rank"`
	Level int64  `json:"level"`
	XP    int64  `json:"xp"`
}

// hiscoresActivity is one activity row; rank and score are -1 when the
// account is unranked, which maps to null in the served payload.
type hiscoresActivity struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Rank  int64  `json:"rank"`
	Score int64  `json:"score"`
}

// usageReportDocument is the strict usage-report/v1 upstream grammar.
type usageReportDocument struct {
	Data     []usageReportBucket `json:"data"`
	HasMore  bool                `json:"has_more"`
	NextPage string              `json:"next_page"`
}

// usageReportBucket is one time bucket of the usage-report grammar.
type usageReportBucket struct {
	StartingAt string              `json:"starting_at"`
	EndingAt   string              `json:"ending_at"`
	Results    []usageReportResult `json:"results"`
}

// usageReportResult is one aggregated row inside a usage-report bucket. The
// field set mirrors the published schema exactly; the strict decoder rejects
// anything it does not know.
type usageReportResult struct {
	AccountID            string                 `json:"account_id"`
	APIKeyID             string                 `json:"api_key_id"`
	CacheCreation        usageReportCacheCreate `json:"cache_creation"`
	CacheReadInputTokens int64                  `json:"cache_read_input_tokens"`
	ContextWindow        string                 `json:"context_window"`
	InferenceGeo         string                 `json:"inference_geo"`
	Model                string                 `json:"model"`
	OutputTokens         int64                  `json:"output_tokens"`
	ServerToolUse        usageReportServerTools `json:"server_tool_use"`
	ServiceAccountID     string                 `json:"service_account_id"`
	ServiceTier          string                 `json:"service_tier"`
	UncachedInputTokens  int64                  `json:"uncached_input_tokens"`
	WorkspaceID          string                 `json:"workspace_id"`
}

// usageReportCacheCreate is the cache-creation token breakdown.
type usageReportCacheCreate struct {
	Ephemeral1hInputTokens int64 `json:"ephemeral_1h_input_tokens"`
	Ephemeral5mInputTokens int64 `json:"ephemeral_5m_input_tokens"`
}

// usageReportServerTools is the server-side tool usage breakdown.
type usageReportServerTools struct {
	WebSearchRequests int64 `json:"web_search_requests"`
}

// usagePageDocument is the strict usage-page/v1 upstream grammar.
type usagePageDocument struct {
	Object   string            `json:"object"`
	Data     []usagePageBucket `json:"data"`
	HasMore  bool              `json:"has_more"`
	NextPage string            `json:"next_page"`
}

// usagePageBucket is one time bucket of the usage-page grammar.
type usagePageBucket struct {
	Object    string            `json:"object"`
	StartTime int64             `json:"start_time"`
	EndTime   int64             `json:"end_time"`
	Results   []usagePageResult `json:"results"`
}

// usagePageResult is one aggregated row inside a usage-page bucket. The
// field set mirrors the published schema exactly.
type usagePageResult struct {
	Object                 string `json:"object"`
	InputTokens            int64  `json:"input_tokens"`
	InputCachedTokens      int64  `json:"input_cached_tokens"`
	InputCacheWriteTokens  int64  `json:"input_cache_write_tokens"`
	InputUncachedTokens    int64  `json:"input_uncached_tokens"`
	OutputTokens           int64  `json:"output_tokens"`
	InputTextTokens        int64  `json:"input_text_tokens"`
	OutputTextTokens       int64  `json:"output_text_tokens"`
	InputCachedTextTokens  int64  `json:"input_cached_text_tokens"`
	InputAudioTokens       int64  `json:"input_audio_tokens"`
	InputCachedAudioTokens int64  `json:"input_cached_audio_tokens"`
	OutputAudioTokens      int64  `json:"output_audio_tokens"`
	InputImageTokens       int64  `json:"input_image_tokens"`
	InputCachedImageTokens int64  `json:"input_cached_image_tokens"`
	OutputImageTokens      int64  `json:"output_image_tokens"`
	NumModelRequests       int64  `json:"num_model_requests"`
	ProjectID              string `json:"project_id"`
	UserID                 string `json:"user_id"`
	APIKeyID               string `json:"api_key_id"`
	Model                  string `json:"model"`
	Batch                  bool   `json:"batch"`
	ServiceTier            string `json:"service_tier"`
}

// fetchDoer is the seam between the refresh path and the network: the one
// operation a transport must provide. Production supplies a bounded HTTP
// client (constructed only in fetch.go); tests supply hand-written fakes so
// no test ever leaves the loopback.
type fetchDoer interface {
	Do(r *http.Request) (*http.Response, error)
}

// snapshotFiles embeds every shipped panel snapshot. Keeping the pattern
// rooted at snapshots/*.json means stray files cannot ride into the binary.
//
//go:embed snapshots/*.json
var snapshotFiles embed.FS

// fetchConfigBytes embeds the fetch configuration: hosts allowlist, bounds,
// and every vendor-specific endpoint string, label, and credential env-var
// name — data, never Go source.
//
//go:embed config/fetch.json
var fetchConfigBytes []byte

// builtinPanels is the explicit registry: every panel the site serves, in
// index order. Adding a panel is a conscious edit plus its data files —
// there is no discovery, no reflection, and no way to register from outside.
// Fetch-backed panels are upgraded from their snapshot defaults by
// buildBuiltinPanels, which fails soft to snapshot-only on any config fault.
var builtinPanels = buildBuiltinPanels()

// panelDefinition binds one panel's identity to its data source.
type panelDefinition struct {
	// id is the stable public identifier in the panel URL.
	id string
	// kind names the versioned payload the source must satisfy.
	kind string
	// title is the human heading served in envelope and index.
	title string
	// source supplies the payload at construction time.
	source Source
}

// Registry is the complete prepared panel API: every response body and its
// digest ETag computed at construction — and, for fetch-backed panels,
// re-prepared by the background refresher — so the request path is a map
// lookup and a memory write with no I/O and no failure mode.
type Registry struct {
	// mu serializes index rebuilds when refreshers report concurrently.
	mu sync.Mutex
	// index is the prepared /api/panels response, swapped atomically.
	index atomic.Pointer[preparedResponse]
	// states holds every panel in index order.
	states []*panelState
	// byID maps each panel id to its state. Unknown, nested, and empty ids
	// miss the table identically, so every invalid shape collapses into the
	// same opaque 404.
	byID map[string]*panelState
	// refreshStarted guards StartRefresh against double starts.
	refreshStarted atomic.Bool
}

// panelState is one panel's identity plus its atomically swapped current
// response. fetch is non-nil only for fetch-backed panels.
type panelState struct {
	// definition is the panel's immutable identity.
	definition panelDefinition
	// fetch is the live source driving background refresh, when enabled.
	fetch *FetchSource
	// current is the served payload and prepared response.
	current atomic.Pointer[servedPanel]
}

// servedPanel is one immutable served state: the validated payload it was
// built from (retained so a failing refresh can re-serve it as stale) and
// the fully prepared HTTP response.
type servedPanel struct {
	// payload is the validated data with its provenance and status.
	payload loadedPayload
	// response is the prepared body and digest ETag.
	response preparedResponse
}

// preparedResponse is one immutable JSON response, fully prepared off the
// request path: body bytes plus the quoted SHA-256 ETag that lets the
// no-cache class revalidate to cheap 304s.
type preparedResponse struct {
	// body is the complete response payload, held in memory; panel budgets
	// keep it small by construction.
	body []byte
	// etag is the quoted SHA-256 digest of body — the same strong-validator
	// scheme the embedded frontend uses, identical across replicas.
	etag string
}
