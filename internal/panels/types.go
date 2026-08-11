// types.go collects every type, const, and var declaration in package panels
// so a reader can survey the panel data model, the registry, and the source
// contracts in one place. Methods stay beside the logic they serve: registry
// construction in registry.go, HTTP serving in handler.go, snapshot loading
// in snapshot.go, strict-decoding admission in utils.go, and fetch-contract
// validation in fetch.go.

package panels

import (
	"embed"
	"encoding/json"
	"io/fs"
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
	// response body. It is enforced as a test, keeping the whole panel listing
	// a single small read on the Pi origin.
	MaxIndexResponseBytes = 4 << 10
	// MaxPanelResponseBytes is the owner's performance budget for one panel
	// envelope. Construction refuses larger bodies by degrading the panel to
	// unavailable, so the budget is structural, not aspirational.
	MaxPanelResponseBytes = 32 << 10
)

// Panel kinds are versioned independently of the envelope. A breaking payload
// change mints a new kind version; it never mutates an existing one.
const (
	// KindTokenUsage reports model token consumption per source. Source labels
	// are data supplied by snapshots — never Go identifiers — so a new tool or
	// vendor appears by shipping data, not by editing code.
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
	// StatusOK marks data that passed strict validation from its source.
	StatusOK Status = "ok"
	// StatusStale marks a retained last-good payload whose refresh is failing.
	// Only the future fetch path can produce it; snapshots are never stale.
	StatusStale Status = "stale"
	// StatusUnavailable marks a panel whose data could not be loaded or
	// validated. The envelope still serves — identity intact, data null — so
	// a bad data file can never take a route or the process down.
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
	// capture time, never request time. Omitted when unavailable.
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
// arrives in snapshot bytes, and adding a source is a data change, never a
// code change (doctrine_test pins vendor names out of Go source).
type TokenUsageData struct {
	// Sources holds one entry per reporting tool or vendor.
	Sources []TokenUsageSource `json:"sources"`
}

// TokenUsageSource is one labeled origin of token-usage windows.
type TokenUsageSource struct {
	// Label is the display name of the source, supplied as data.
	Label string `json:"label"`
	// Windows holds the source's usage windows, e.g. session and week.
	Windows []TokenUsageWindow `json:"windows"`
}

// TokenUsageWindow is one accounting window of token consumption.
type TokenUsageWindow struct {
	// Period names the window shape, e.g. "session" or "week".
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
// totals, the current streak, and the latest commits.
type VCSActivityData struct {
	// TotalContributions is the count across the covered weeks.
	TotalContributions int `json:"totalContributions"`
	// Weeks holds per-week daily contribution counts, oldest week first,
	// seven days per week.
	Weeks [][]int `json:"weeks"`
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

// BossLogData is the boss-log/v1 payload: one game account's boss tallies.
type BossLogData struct {
	// Account is the public account name.
	Account string `json:"account"`
	// Bosses lists the tracked bosses in display order.
	Bosses []BossLogEntry `json:"bosses"`
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
// SnapshotSource is the only implementation today; FetchSource deliberately
// does not satisfy this interface until the platform-lane egress decision
// lands (see FetchSource).
type Source interface {
	// load reads and strictly validates the panel payload for kind from fsys.
	// It runs exactly once per panel, at construction — never on a request.
	load(fsys fs.FS, kind string) (loadedPayload, error)
}

// loadedPayload is one successfully validated payload with its provenance.
type loadedPayload struct {
	// generatedAt is the validated RFC 3339 capture instant.
	generatedAt string
	// data is the canonical re-marshaled kind payload.
	data json.RawMessage
}

// SnapshotSource serves a panel from one embedded JSON file: data captured
// out-of-band, shipped inside the binary, parsed strictly exactly once at
// construction. It is the zero-egress default for every panel.
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

// FetchConfig bounds the future live-refresh path of a FetchSource. Every
// field is a hard limit; none may default open.
type FetchConfig struct {
	// Hosts is the exact allowlist of bare host names the source may ever
	// contact. An empty list is invalid: there is no "any host" value.
	Hosts []string
	// TTL is how long a fetched payload stays fresh; the background refresher
	// wakes on this cadence and never faster.
	TTL time.Duration
	// Timeout bounds one fetch attempt end to end and must stay below TTL so
	// attempts can never overlap their own cadence.
	Timeout time.Duration
	// MaxBytes caps a fetched body. It can never exceed MaxPanelResponseBytes
	// — a payload the budget refuses to serve is not worth fetching.
	MaxBytes int64
	// InitialBackoff is the first retry delay after a failed refresh.
	InitialBackoff time.Duration
	// MaxBackoff caps the exponential retry delay growth.
	MaxBackoff time.Duration
}

// FetchSource is the DEFINED BUT DISABLED live-data contract. It exists so
// the shape of live panels is settled now, while the package ships with zero
// egress capability — no HTTP client, no dialing import anywhere, pinned by
// this package's doctrine test.
//
// The contract, for whichever PR enables it after the platform-lane egress
// decision:
//
//   - Refresh happens ONLY in a background goroutine on the TTL cadence.
//     The request path never fetches, never blocks, never touches I/O; it
//     keeps serving the prepared bytes exactly as SnapshotSource panels do.
//   - Each attempt contacts only hosts in Config.Hosts, is bounded by
//     Config.Timeout, and reads at most Config.MaxBytes.
//   - A fetched payload is admitted only through the same strict gate as
//     snapshots (decodeKindPayload); anything else is discarded.
//   - On refresh failure the last-good payload keeps serving with
//     StatusStale, and retries back off exponentially from InitialBackoff
//     to MaxBackoff.
//
// FetchSource intentionally does not implement Source, so it cannot be
// registered; a test pins both facts.
type FetchSource struct {
	// Config bounds the future refresh loop; Validate rejects unsafe values.
	Config FetchConfig
}

// snapshotFiles embeds every shipped panel snapshot. Keeping the pattern
// rooted at snapshots/*.json means stray files cannot ride into the binary.
//
//go:embed snapshots/*.json
var snapshotFiles embed.FS

// builtinPanels is the explicit registry: every panel the site serves, in
// index order. Adding a panel is a conscious edit here plus its snapshot —
// there is no discovery, no reflection, and no way to register from outside.
var builtinPanels = []panelDefinition{
	{
		id:     "token-usage",
		kind:   KindTokenUsage,
		title:  "Token usage",
		source: SnapshotSource{Name: "snapshots/token-usage.json"},
	},
	{
		id:     "vcs-activity",
		kind:   KindVCSActivity,
		title:  "Version-control activity",
		source: SnapshotSource{Name: "snapshots/vcs-activity.json"},
	},
	{
		id:     "boss-log",
		kind:   KindBossLog,
		title:  "Boss log",
		source: SnapshotSource{Name: "snapshots/boss-log.json"},
	},
}

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
// digest ETag computed once at construction, so the request path is a map
// lookup and a memory write with no I/O and no failure mode — the same
// prepared-table discipline internal/server applies to the embedded frontend.
type Registry struct {
	// index is the prepared /api/panels response.
	index preparedResponse
	// panels maps each panel id to its prepared envelope response. Unknown,
	// nested, and empty ids miss the table identically, so every invalid
	// shape collapses into the same opaque 404.
	panels map[string]preparedResponse
}

// preparedResponse is one immutable JSON response, fully prepared during
// construction: body bytes plus the quoted SHA-256 ETag that lets the
// no-cache class revalidate to cheap 304s.
type preparedResponse struct {
	// body is the complete response payload, held in memory for the process
	// lifetime; panel budgets keep it small by construction.
	body []byte
	// etag is the quoted SHA-256 digest of body — the same strong-validator
	// scheme the embedded frontend uses, identical across replicas.
	etag string
}
