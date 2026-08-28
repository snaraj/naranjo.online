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
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// discardLogger is the quiet default behind every registry and source that
// was not handed a logger, so construction, serving, and tests stay silent
// unless the composition root explicitly injects observability.
var discardLogger = slog.New(slog.DiscardHandler)

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
	//
	// RAISED from 32 KiB to 128 KiB by the owner on 2026-08-24: "expand the
	// response gate if thats the case, we can't be blocked over a gate we
	// added before we even started developing the real websites."
	//
	// The measurement behind it: full-depth token-usage history structurally
	// maxes at 104,508 bytes served, MEASURED with the v2 models section by
	// TestTheMaximalDocumentFitsTheRaisedBudget. (The figures that stood here
	// before issue #170 were 98,853 without that section and 115,981 with it;
	// the second was a projection made before the section existed, and the
	// real one is smaller because the models partition is windowed rather
	// than covering the whole series.) The 32 KiB gate would therefore
	// have refused exactly the full-history documents the sealed-data
	// pipeline exists to deliver — a serve-time outage waiting for real depth
	// to arrive, produced by a budget chosen before any real content existed.
	//
	// 128 KiB is not an arbitrary bigger number: it is the SAME value the
	// sealed-payload pipeline already enforces at five stages
	// (seal.MaxSealedBytes), so the last step no longer hides a SMALLER
	// ceiling than the four before it.
	//
	// Read that claim exactly as written, because the 2026-08-25 round-4
	// review found the stronger version of it — "a document that can be
	// transported can now also be served" — stated here and it is FALSE. The
	// two ceilings are equal in value and different in SUBJECT: this one
	// bounds the finished envelope the handler writes, seal.MaxSealedBytes
	// bounds the sealed FILE. The envelope is the payload merged onto the
	// embedded snapshot plus the envelope scaffolding, so it is strictly
	// larger than the file it came from — measured at +875 bytes for the
	// maximal admissible document (103,633 sealed, 104,508 served;
	// TestTheMaximalDocumentFitsTheRaisedBudget logs both), and larger still
	// by however much the snapshot contributes. A file sealed at exactly
	// 131,072 bytes therefore serves OVER this budget and is refused.
	//
	// What is true, and is what the equality buys: both ceilings are real,
	// both refuse rather than truncate, and neither is now the surprising
	// one. What guarantees safety is not the arithmetic — it is the refusal
	// path, which keeps the last good response serving whenever the envelope
	// does not fit (TestDataRootRefusesAnOverBudgetEnvelope).
	//
	// This is a budget revision by the budget's owner, not a weakening of a
	// gate. The bound stays REFUSE-not-truncate at construction and refresh,
	// stays pinned by TestResponsesStayWithinTheOwnerBudgets, and
	// MaxIndexResponseBytes is untouched at 4 KiB.
	MaxPanelResponseBytes = 128 << 10
)

// Panel kinds are versioned independently of the envelope. A breaking payload
// change mints a new kind version; it never mutates an existing one.
const (
	// KindTokenUsage reports model token consumption per source. Source labels
	// are data supplied by snapshots and config — never Go identifiers — so a
	// new tool or vendor appears by shipping data, not by editing code.
	KindTokenUsage = "token-usage/v1"
	// KindTokenUsageV2 is the same payload plus a per-day MODEL partition of
	// each source's series (issue #170), and it is a new KIND rather than
	// another optional v1 section for one reason: the section binds
	// CROSS-FIELD integrity rules — a declared window contained in the
	// aggregate's, and an exact per-day partition of the aggregate's totals.
	// Every other section added to v1 since it shipped (tiles, the series,
	// insights, the category partition, the capture instant) could be ignored
	// by a consumer without the rest becoming untrue. This one cannot: a
	// consumer that admitted v1's shape and skipped these rules would render
	// a v2 payload while silently failing to verify what makes it true.
	// Minting the kind is what forces every consumer through the new
	// admission. The breaking change is not the shape — v2 is a strict
	// superset — it is what a compliant consumer must CHECK.
	//
	// The panel/v1 ENVELOPE is untouched, as it is forever by design; only
	// the kind moves. v1 stays decodable, and its admission stays exactly as
	// strict as it was: tokenUsageDataV1 below is a decode-only mirror with
	// no models field anywhere in it, so a document claiming v1 while
	// carrying a models section is refused rather than quietly upgraded.
	KindTokenUsageV2 = "token-usage/v2"
	// KindVCSActivity reports contribution activity: weekly counts, totals,
	// the current streak, and recent commits.
	KindVCSActivity = "vcs-activity/v1"
	// KindBossLog reports one game account's boss tallies.
	KindBossLog = "boss-log/v1"
	// KindCodingProjects reports the owner's public repositories as their
	// hosting service currently describes them: the description each one
	// carries right now, its star tally, and when it was last pushed to.
	//
	// The kind is named for what it REPORTS, never for where it comes from,
	// exactly as the version-control kind beside it is — the host is a config
	// endpoint, and swapping it stays a data edit.
	KindCodingProjects = "coding-projects/v1"
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

// TokenUsageData is the token-usage/v2 payload: token consumption windows
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
	// CapturedAt is the RFC 3339 instant THIS source's figures were captured,
	// present only on a source refreshed from the sealed runtime document
	// (2026-08-24 round-3 review, finding 5). One envelope carries one
	// `generatedAt` for the whole payload, and the whole payload is only as
	// fresh as its oldest constituent — so the envelope reports that oldest
	// instant and every source says, here, when it was actually measured. A
	// reader can then see which half of a two-source panel is the older one
	// instead of inferring a freshness neither field ever promised.
	//
	// Additive, exactly like Account, Stats, Series, Insights and the
	// series' Recorded flag before it: a payload written before this field
	// existed still decodes and still renders, so this field did not move
	// the kind either.
	CapturedAt string `json:"capturedAt,omitempty"`
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
	// Unit names how Value is measured: UnitTokens, UnitDays,
	// UnitSeconds, or UnitCount.
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
	// UnitCount measures a plain tally of things that are neither tokens nor
	// time — sessions, for instance. It renders with thousands separators and
	// no unit word, because the tile's own label already names what is being
	// counted.
	UnitCount = "count"
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
	// Recorded carries the same provenance meaning it carries on a stat tile:
	// this series came from a dated out-of-band capture rather than the live
	// feed, and says so instead of borrowing a freshness it does not have.
	// The live mapping never sets it, so the flag is also the mechanical
	// difference between a shipped series and a fetched one — which is the
	// property registry_test's narrowed pin now guards.
	//
	// Additive, exactly like Account, Stats, Series and Insights before it: a
	// payload written before this field existed still decodes and still
	// renders, so this field did not move the kind. Minting a new kind
	// version is for a BREAKING reshape, and an optional flag is not one —
	// contrast Models below, whose cross-field integrity rules a consumer
	// cannot skip, which is exactly what did mint token-usage/v2.
	Recorded bool `json:"recorded,omitempty"`
	// Categories optionally breaks every day of Totals down by accounting
	// category (input, output, cache reads, ...), in a canonical served
	// order. Additive exactly like Recorded above: absent for every series
	// produced before it existed, and an absent section renders the plain
	// single-series grid it always did.
	Categories []TokenUsageCategory `json:"categories,omitempty"`
	// Models optionally breaks the same days down by MODEL instead — the
	// same labelled-sub-series shape over a different closed vocabulary, and
	// the section that mints token-usage/v2 (issue #170). Absent is a real
	// producer state, "this source cannot attribute its series per model",
	// and renders the complete v1 story rather than an empty or degraded one.
	//
	// It is a SEPARATE partition of the same totals, not a nesting of the
	// category one: a day's tokens divide by accounting class and by model
	// independently, and each division is checked against the aggregate.
	Models []TokenUsageCategory `json:"models,omitempty"`
}

// TokenUsageCategory is one per-day breakdown component of a daily series:
// the same day indexing as the series' Totals, restricted to one accounting
// category. Categories PARTITION the series — for every day the category
// values sum exactly to that day's total, enforced at admission — so a
// stacked reading of the categories and the plain reading of the series are
// the same measurement, never two claims that can disagree.
type TokenUsageCategory struct {
	// Key is the stable category identifier, e.g. "input" or "cache-read".
	// It is data admitted by MEMBERSHIP of a closed vocabulary, never by
	// shape, so it can double as a rendering key.
	Key string `json:"key"`
	// StartDate is the calendar date of Totals[0] when this breakdown covers
	// only a TRAILING WINDOW of the owning series; absent when it is aligned
	// with the series, which is what every breakdown produced before this
	// field existed says by omission.
	//
	// A window is not a degraded state and is never silent. Two honest
	// reasons produce one. A category split can only cover days whose
	// records carry an accounting split, so a series extended back into days
	// the producer's journals no longer hold carries its categories over the
	// days that still have them. A model split answers to a byte BUDGET —
	// one integer per day per member, which at the series-day bound would
	// outweigh the whole payload ceiling — so it covers a declared trailing
	// window. Both are DECLARED here so a reader can be told the range it is
	// looking at instead of being shown a truncation it cannot see.
	StartDate string `json:"startDate,omitempty"`
	// Totals holds this breakdown row's per-day counts, indexed from
	// StartDate (or from the owning series' StartDate when absent).
	Totals []int64 `json:"totals"`
}

// The token-usage/v1 DECODE MIRROR. It exists so that minting v2 could not
// quietly widen v1: the served types above gained an optional models section
// and an optional breakdown window, and a payload declaring the OLD kind must
// still be refused for carrying either. Sharing one type would have made
// "v1 is untouched" a claim nobody checks — decodeStrict refuses unknown
// FIELDS, and a field the shared struct declares is not unknown.
//
// These types are decode-only and unexported: nothing constructs them, and
// the canonical bytes they re-marshal are byte-identical to what v1 served
// before v2 existed. Adding a field here is the same deliberate act as
// adding one to the kind itself.
type tokenUsageDataV1 struct {
	Sources []tokenUsageSourceV1 `json:"sources"`
}

type tokenUsageSourceV1 struct {
	Label      string              `json:"label"`
	Account    string              `json:"account,omitempty"`
	Windows    []TokenUsageWindow  `json:"windows"`
	Stats      []TokenUsageStat    `json:"stats,omitempty"`
	Series     *tokenUsageSeriesV1 `json:"series,omitempty"`
	Insights   []TokenUsageInsight `json:"insights,omitempty"`
	CapturedAt string              `json:"capturedAt,omitempty"`
}

type tokenUsageSeriesV1 struct {
	StartDate  string                 `json:"startDate"`
	Totals     []int64                `json:"totals"`
	Recorded   bool                   `json:"recorded,omitempty"`
	Categories []tokenUsageCategoryV1 `json:"categories,omitempty"`
}

type tokenUsageCategoryV1 struct {
	Key    string  `json:"key"`
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
	// CommitsAt is the RFC 3339 instant the recent-commit list was actually
	// read from its producer, which is NOT the same instant the calendar was
	// read: the two halves sit on different rate budgets and refresh on
	// different cadences. Empty when no commit list has ever been fetched, so
	// an empty list can never be mistaken for a list fetched a moment ago.
	// The envelope's status still carries the whole payload's provenance;
	// this says which half of it is the older one.
	CommitsAt string `json:"commitsAt,omitempty"`
	// Coverage names WHICH calendar producer answered, and it exists because
	// the two producers count different things while both being live and both
	// being true.
	//
	// The anonymous public document reports only what an anonymous reader may
	// see; the credentialed API reports the account holder's own complete
	// record, private repositories included. Serving either under one
	// unlabelled "totalContributions" would make the panel quietly change its
	// meaning the day a credential is added or expires — a figure that moved
	// by four hundred with nothing on the page to say why. So the payload says
	// which one it is, and the frontend words the figure accordingly.
	//
	// Additive and optional, exactly like EndDate and CommitsAt before it: a
	// payload written before this field existed still decodes and still
	// renders, so this field did not move the kind. Empty means the producer
	// declared no coverage, which is what the embedded snapshot says.
	Coverage string `json:"coverage,omitempty"`
}

// The coverage vocabulary, closed and admitted by MEMBERSHIP. Only this
// package's own mappers ever set one — a value never arrives from an upstream
// document — so the frontend can key rendered copy off it.
const (
	// CoveragePublic marks a calendar assembled from the anonymous public
	// document: real, live, and narrower than the account holder's own view.
	CoveragePublic = "public"
	// CoverageComplete marks a calendar assembled from the credentialed API,
	// which reports the account holder's whole record.
	CoverageComplete = "complete"
)

// CodingProjectsData is the coding-projects/v1 payload: one row per
// repository the owner publishes, carrying what its host currently says about
// it. Rows arrive in CONFIGURATION order, never in an order an upstream
// chooses, so the section's layout is the owner's decision.
type CodingProjectsData struct {
	// Repos holds one row per configured repository.
	Repos []CodingProject `json:"repos"`
}

// CodingProject is one repository row. Every figure is nullable and every
// row carries its own provenance, for the same reason the token panel's tiles
// do: a row whose live read failed serves the shipped snapshot's values and
// says so, rather than borrowing the freshness of the rows beside it.
type CodingProject struct {
	// Name is the repository's public name. It comes from CONFIGURATION, not
	// from the upstream document — the same rule VCSCommit.Repo follows, and
	// for the same reason: a name an upstream can choose is a name a
	// compromised upstream can forge.
	Name string `json:"name"`
	// Description is the repository's own description, truncated with a
	// visible marker past maxProjectDescriptionRunes. Empty is a real state:
	// a repository with no description has none, and inventing one would be
	// exactly the fabrication the honest-states floor forbids.
	Description string `json:"description"`
	// Stars is the star tally; null means the upstream reported none, which
	// the frontend renders as a dash rather than as a confident zero.
	Stars *int64 `json:"stars"`
	// PushedAt is the RFC 3339 instant of the repository's last push,
	// normalized to UTC. Empty when unreported.
	PushedAt string `json:"pushedAt,omitempty"`
	// Recorded marks a row served from the shipped snapshot rather than read
	// live — the same provenance meaning it carries on a token-usage stat
	// tile. A mixed payload is the normal degraded state: five rows read and
	// one refused is five live rows beside one that says it is not.
	Recorded bool `json:"recorded,omitempty"`
}

// VCSCommit is one recent commit reference.
type VCSCommit struct {
	// Repo is the repository's public name. It comes from CONFIGURATION, not
	// from the upstream document: a label an upstream can choose is a label a
	// compromised upstream can forge, and the panel would then attribute a
	// stranger's commit to the owner.
	Repo string `json:"repo"`
	// SHA is the commit's full lowercase-hex identity: the same value
	// mapCommits already validates through isCommitIdentity before this row
	// is ever built, carried through rather than discarded so a subject line
	// that resolves no pull-request reference still has a real destination
	// to link to (issue 157) instead of rendering as inert text.
	SHA string `json:"sha"`
	// Message is the commit subject line, truncated with a visible marker
	// past maxCommitMessageRunes so one absurd subject cannot dominate the
	// panel budget.
	Message string `json:"message"`
	// At is the RFC 3339 commit instant, normalized to UTC.
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
	// mu guards every mutable field below. Production drives one refresh loop
	// per panel, so the lock is uncontended there; it exists because a source
	// is shared with the request path's registry and because tests drive
	// refreshes directly.
	mu sync.Mutex
	// gates maps a rate-budget role to the earliest instant an endpoint in
	// that role may next be CONTACTED. Reservations are taken per attempt,
	// not per success: a failing upstream must not be retried faster than a
	// healthy one, which is precisely how a retry ladder walks into a rate
	// limit.
	gates map[string]time.Time
	// calendar is the last successfully mapped contribution payload, kept so
	// a cycle where only the commit half is due can serve the calendar it
	// already has instead of asking for it again.
	calendar json.RawMessage
	// calendarAt is when that payload was fetched. It becomes the envelope's
	// generatedAt, so a payload never claims to be newer than its calendar.
	calendarAt time.Time
	// commits is the last successfully fetched commit list.
	commits []VCSCommit
	// commitsAt is when that list was fetched; the zero instant means no list
	// has ever been fetched, which the payload reports as an absent commitsAt
	// rather than as a fresh empty list.
	commitsAt time.Time
	// logger narrates this source's fetch attempts: host, status, and byte
	// counts at debug, per-source failures at warn — never a URL, never a
	// credential, never a payload byte. Set once by the registry before its
	// refresh loops launch; the mu-guarded accessor falls back to the
	// discard logger so directly driven test sources stay quiet.
	logger *slog.Logger
}

// Rate-budget roles. A role groups the endpoints that share one budget, so
// the commit producer's several repository documents are one round rather
// than several independent cadences.
const (
	// roleBossLog is the game-hiscores document.
	roleBossLog = "boss-log"
	// roleVCSCalendar is the contribution-calendar document.
	roleVCSCalendar = "vcs-calendar"
	// roleVCSCommits is the whole group of per-repository commit documents.
	roleVCSCommits = "vcs-commits"
	// roleCodingProjects is the whole group of per-repository metadata
	// documents, one budget for the round rather than one per repository.
	roleCodingProjects = "coding-projects"
)

// panelFetchSpecs carries the per-kind fetch descriptions. EXACTLY ONE field
// may be set: a source feeds one panel, and NewFetchSource refuses any other
// arrangement, so "which upstream grammar does this source speak" is never
// ambiguous at refresh time.
type panelFetchSpecs struct {
	// bossLog is set when this source feeds a boss-log/v1 panel.
	bossLog *bossLogFetchSpec
	// usage is set when this source feeds a token-usage panel.
	usage *tokenUsageFetchSpec
	// vcs is set when this source feeds a vcs-activity/v1 panel.
	vcs *vcsActivityFetchSpec
	// projects is set when this source feeds a coding-projects/v1 panel.
	projects *codingProjectsFetchSpec
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
	// Titles overrides a panel's served heading by panel id. It exists
	// because a heading is display copy the owner chooses, and the owner may
	// choose the name of a service — which this package's source may never
	// spell (doctrine_test's vendor pin), so that swapping where a panel's
	// data comes from stays a data edit. An id with no entry keeps the
	// neutral title the panel list declares, and so does every panel if this
	// file fails to load at all.
	Titles map[string]string `json:"titles"`
	// BossLog configures the boss-log panel's live fetch, if any.
	BossLog *bossLogFetchSpec `json:"bossLog"`
	// TokenUsage configures the token-usage panel's live fetch, if any.
	TokenUsage *tokenUsageFetchSpec `json:"tokenUsage"`
	// VCSActivity configures the version-control panel's live fetch, if any.
	VCSActivity *vcsActivityFetchSpec `json:"vcsActivity"`
	// CodingProjects configures the repository-metadata panel's live fetch.
	CodingProjects *codingProjectsFetchSpec `json:"codingProjects"`
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
	// ContentType is the exact media type the answer must declare, checked
	// before a byte of the body is parsed.
	ContentType string `json:"contentType"`
	// MinIntervalMinutes is this endpoint's rate budget: the shortest gap
	// between two ATTEMPTS against it, honored no matter how often the loop
	// wakes or how a retry ladder behaves.
	MinIntervalMinutes int `json:"minIntervalMinutes"`
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
	// ContentType is the exact media type the answer must declare.
	ContentType string `json:"contentType"`
	// MinIntervalMinutes is the calendar's own rate budget.
	MinIntervalMinutes int `json:"minIntervalMinutes"`
	// Commits configures the recent-commit half of this panel, which reads a
	// DIFFERENT set of public documents on a DIFFERENT cadence. Optional: a
	// panel configured without it serves the calendar and an empty commit
	// list, which is what it did before this half existed.
	Commits *vcsCommitsFetchSpec `json:"commits"`
	// Calendar configures the CREDENTIALED calendar producer, preferred over
	// the public Endpoint above whenever its credential is present. Optional:
	// a panel configured without it reads the public document exactly as it
	// always has.
	Calendar *vcsCalendarFetchSpec `json:"calendar"`
}

// vcsCalendarHeaderAllowlist is the COMPLETE set of STATIC request headers the
// credentialed calendar producer may send, and it is a second list rather than
// a widening of the public one on purpose. The public producers must stay
// unable to carry any header but Accept; this producer additionally needs to
// declare the media type of the request BODY it posts. Neither list may name a
// credential header — the credential never travels through a static header map
// at all, it is read from the environment at fetch time and set through the
// spec's own dedicated key fields — so config data still cannot attach a
// secret to a request by editing a map.
var vcsCalendarHeaderAllowlist = []string{"Accept", "Content-Type"}

// vcsCalendarFetchSpec configures the CREDENTIALED contribution-calendar
// producer: a query API that reports the calendar of the account the
// credential belongs to, private repositories included, which is the whole
// reason it exists — the public document beside it can only ever report what
// an anonymous reader may see, and the two differ by every private commit the
// owner has made.
//
// It is the first producer in this package that both carries a credential AND
// posts a body, so two things are stated here rather than assumed:
//
//   - The credential follows the identical rule the usage sources follow. The
//     variable NAME is config data; the value is read from the environment at
//     fetch time, flows straight into one request header, and is never stored,
//     logged, or served. An unset variable does not fail and does not fabricate
//     — the public producer answers instead, and the payload says so through
//     its coverage field.
//   - The request BODY is built from Query below plus a window this package
//     computes from its own clock. No byte of it ever comes from an upstream
//     answer, so no upstream can influence what is asked of the next one.
type vcsCalendarFetchSpec struct {
	// Endpoint is the full request URL.
	Endpoint string `json:"endpoint"`
	// Query is the literal query document posted to it. It declares the two
	// window variables this package supplies and nothing else; a query that
	// does not is refused at construction rather than sent.
	Query string `json:"query"`
	// KeyEnvName is the environment variable holding the credential. Unset at
	// fetch time means this producer is skipped, never an error surface.
	KeyEnvName string `json:"keyEnvName"`
	// KeyHeader is the request header that carries the credential.
	KeyHeader string `json:"keyHeader"`
	// KeyPrefix is prepended to the credential in the header.
	KeyPrefix string `json:"keyPrefix"`
	// Headers holds the static request headers, held to
	// vcsCalendarHeaderAllowlist.
	Headers map[string]string `json:"headers"`
	// MaxBytes optionally tightens the shared body cap for this endpoint.
	MaxBytes int64 `json:"maxBytes"`
	// ContentType is the exact media type the answer must declare.
	ContentType string `json:"contentType"`
}

// The window variable names the calendar query document must declare. They are
// checked at construction against the configured Query, so a query edited to
// drop a variable is refused before a request is ever built — which is the
// difference between a calendar over the window this package computed and a
// calendar over whatever the upstream's own default happens to be.
const (
	// calendarFromVariable names the window's first instant.
	calendarFromVariable = "$from"
	// calendarToVariable names its last.
	calendarToVariable = "$to"
)

// calendarWindowDays is how far back the credentialed calendar window reaches
// before it is rolled back to the preceding Sunday. The upstream refuses a
// span over one year, and the rollback adds up to six days, so 357 is the
// largest value that can never cross it — while still covering fifty-two whole
// weeks, which is what the grid draws.
//
// The Sunday alignment is not cosmetic. The served payload's week columns are
// sliced seven days at a time from the first covered day and the frontend
// derives the trailing padding from the end date's weekday, so a window
// starting on any other weekday would shift every cell's date by up to six
// days. The public producer gets this for free because the document it scrapes
// is already a Sunday-aligned grid; this producer asks for a window and
// therefore has to ask for the right one.
const calendarWindowDays = 357

// codingProjectsFetchSpec configures the repository-metadata producer: one
// document per repository, each named by a complete literal URL in
// configuration for exactly the reason the commit sources are — a set of
// reachable URLs fixed before the first request is a set no upstream answer can
// extend.
//
// The credential here is OPTIONAL in a way the calendar's is not, and the
// difference is worth stating because it is the reason this producer ships
// working rather than waiting. The repository documents are public: an
// anonymous read returns the same description, tally and push instant a
// credentialed one does. What the credential buys is rate headroom — an
// anonymous caller shares a per-address budget with everything else on the
// node, a credentialed one gets its own far larger budget — so the key is used
// when it is there and its absence changes nothing about what is served.
type codingProjectsFetchSpec struct {
	// Sources lists one labeled repository document per row, in serve order.
	Sources []codingProjectSourceSpec `json:"sources"`
	// Headers holds static request headers, held to the same public-producer
	// allowlist the commit sources' are.
	Headers map[string]string `json:"headers"`
	// KeyEnvName optionally names the environment variable holding a
	// credential used only for rate headroom; empty means this producer names
	// none and reads anonymously.
	KeyEnvName string `json:"keyEnvName"`
	// KeyHeader is the request header that carries it.
	KeyHeader string `json:"keyHeader"`
	// KeyPrefix is prepended to it in the header.
	KeyPrefix string `json:"keyPrefix"`
	// MaxBytes optionally tightens the shared body cap for these endpoints.
	MaxBytes int64 `json:"maxBytes"`
	// ContentType is the exact media type each answer must declare.
	ContentType string `json:"contentType"`
	// MinIntervalMinutes is the rate budget applied to the whole group.
	MinIntervalMinutes int `json:"minIntervalMinutes"`
}

// codingProjectSourceSpec is one repository's document: the public name the
// panel SERVES and the literal URL it is read from. The name is configuration
// precisely so a hostile or drifting upstream cannot relabel a row.
type codingProjectSourceSpec struct {
	// Name is the public repository name served on this row.
	Name string `json:"name"`
	// Endpoint is the full request URL.
	Endpoint string `json:"endpoint"`
}

// Bounds on the repository-metadata producer. Every one of them refuses rather
// than clamps, except the description truncation, which is called out below.
const (
	// maxCodingProjectSources bounds how many repositories configuration may
	// list. Each one is a request per round, so the list is also the round's
	// cost against the upstream's rate budget.
	maxCodingProjectSources = 12
	// maxProjectDescriptionRunes bounds one served description. Longer text is
	// TRUNCATED with a visible marker rather than refused, for the same reason
	// a long commit subject is: length alone is not hostility, and refusing
	// would lose a real repository over a verbose sentence.
	maxProjectDescriptionRunes = 320
	// maxProjectAge is how far back a repository's last push may sit before the
	// instant is nonsense rather than history. Repositories are legitimately
	// old, so this is deliberately generous — it exists to catch a zero-valued
	// or wildly misparsed instant, not to judge a quiet project.
	maxProjectAge = 40 * 365 * 24 * time.Hour
)

// vcsCommitsFetchSpec configures the recent-commit producer: one PUBLIC,
// UNAUTHENTICATED commit-list document per repository, each named by a
// complete literal URL in configuration.
//
// Complete literal URLs are the load-bearing detail. The obvious alternative —
// discovering repositories from an upstream activity document and building
// request URLs out of the names it returns — would let an upstream choose
// where this process connects next. Every endpoint here is instead a config
// constant validated against the host allowlist at construction, so the set of
// reachable URLs is fixed before the first request and no upstream answer can
// extend it.
type vcsCommitsFetchSpec struct {
	// Sources lists one labeled commit document per repository.
	Sources []vcsCommitSourceSpec `json:"sources"`
	// Headers holds static request headers, held to the same public-producer
	// allowlist the calendar's are.
	Headers map[string]string `json:"headers"`
	// MaxBytes optionally tightens the shared body cap for these endpoints.
	MaxBytes int64 `json:"maxBytes"`
	// ContentType is the exact media type each answer must declare.
	ContentType string `json:"contentType"`
	// MinIntervalMinutes is the rate budget applied to the whole group: the
	// shortest gap between two rounds of attempts across every source.
	MinIntervalMinutes int `json:"minIntervalMinutes"`
	// Max caps how many commit rows the merged list serves. It can only ever
	// tighten maxServedCommits.
	Max int `json:"max"`
}

// vcsCommitSourceSpec is one repository's commit document: the public name the
// panel SERVES and the literal URL it is read from. The name is configuration
// precisely so a hostile or drifting upstream cannot relabel a row.
type vcsCommitSourceSpec struct {
	// Repo is the public repository name served on every row from this source.
	Repo string `json:"repo"`
	// Endpoint is the full request URL.
	Endpoint string `json:"endpoint"`
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

// Bounds on the recent-commit producer. Every one of them is a refusal, not a
// clamp: a commit document that breaks any of them is discarded whole and the
// panel keeps serving its last good list.
const (
	// maxCommitDocumentItems bounds how many rows one commit document may
	// carry. The configured endpoints ask for a handful; a document with more
	// is either drift or an upstream trying to make this process hold memory.
	maxCommitDocumentItems = 30
	// maxServedCommits is the absolute ceiling on the merged list, which the
	// per-panel budget then has to fit as well. Configuration may tighten it
	// and can never widen it.
	maxServedCommits = 12
	// maxCommitMessageRunes bounds one served subject line. Longer subjects
	// are truncated with a visible marker rather than refused: a long subject
	// is legal, and refusing the document over it would lose real commits.
	maxCommitMessageRunes = 120
	// maxCommitFutureSkew is how far ahead of now a commit instant may sit
	// before it is nonsense. Clock skew is real; a week is not skew.
	maxCommitFutureSkew = 2 * time.Hour
	// maxCommitAge is how far back a served commit may sit. A "recent
	// commits" list showing something years old is a broken list, not history.
	maxCommitAge = 400 * 24 * time.Hour
	// shaHexDigits is the length of the commit identity every row must carry.
	// It is the cheapest proof that a document was really parsed rather than
	// zero-valued into the projection below.
	shaHexDigits = 40
)

// Bounds on any endpoint's configured rate budget. A budget below the floor is
// a configuration accident that would hammer a public upstream; one above the
// ceiling is a panel that has quietly stopped being live.
const (
	// minEndpointInterval is the shortest gap configuration may ask for
	// between two attempts against one endpoint.
	minEndpointInterval = time.Minute
	// maxEndpointInterval is the longest.
	maxEndpointInterval = 6 * time.Hour
)

// errNothingDue reports that every endpoint a source would have contacted is
// still inside its own rate budget, so the attempt was skipped entirely. It is
// NOT a failure: nothing was fetched, nothing was refused, and the panel keeps
// serving exactly what it was serving — which is why the loop must not mark a
// panel stale or climb its retry ladder on it.
var errNothingDue = errors.New("fetch: every endpoint is still inside its rate budget")

// errUpstreamRateLimited marks an answer that says, in the only way HTTP
// has, "you are asking too often". It pushes that endpoint's next admissible
// attempt out to the full backoff ceiling instead of letting the ordinary
// cadence keep knocking.
var errUpstreamRateLimited = errors.New("fetch: the upstream refused for rate reasons")

// commitListEntry is the PROJECTION this package reads a public commit
// document through, and the one place its admission gate is a projection
// rather than decodeStrict. That is a narrow, deliberate exception, and both
// halves of the reason matter:
//
//   - Closing the document is not possible without holding the author's name
//     and EMAIL ADDRESS in this process. The upstream carries them on every
//     row; DisallowUnknownFields would force this package to declare fields
//     for personal contact details it must never hold, log, or serve
//     (requirement 12). Reading only the three values the panel renders is
//     the stronger privacy posture, not the looser one.
//   - A projection decodes silently: feed it an unrelated JSON object and it
//     yields zero values rather than an error. That is exactly why every
//     field below is then value-checked — a 40-hex identity, a non-empty
//     printable subject, a parseable instant inside a plausible window — and
//     any row failing any check discards the WHOLE document. The gate moved
//     from the decoder to the values; it did not go away.
type commitListEntry struct {
	// SHA is the commit identity.
	SHA string `json:"sha"`
	// Commit holds the authored content.
	Commit commitDetail `json:"commit"`
}

// commitDetail is the authored half of one commit row.
type commitDetail struct {
	// Message is the full commit message; only its subject line is served.
	Message string `json:"message"`
	// Author carries the authoring instant, and deliberately nothing else.
	Author commitAuthorship `json:"author"`
}

// commitAuthorship models the authoring INSTANT and no other authorship
// field. The upstream also reports a name and an email address on this
// object; neither is declared here, so neither is ever decoded into this
// process's memory.
type commitAuthorship struct {
	// Date is the RFC 3339 authoring instant.
	Date string `json:"date"`
}

// datedCommit pairs a served row with its parsed instant so the merge across
// repositories can order rows without re-parsing or trusting string order.
type datedCommit struct {
	// at is the parsed authoring instant.
	at time.Time
	// row is the served commit row.
	row VCSCommit
}

// calendarDocument is the strict upstream grammar of the credentialed
// calendar answer. Unlike the commit and repository documents below it is
// closed with decodeStrict rather than read through a projection, and it can
// be: the query asks for exactly these fields, so the answer carries exactly
// these fields, and there is no personal-data field to have to decline.
//
// Errors is held as raw messages on purpose. The upstream reports a refusal —
// a bad credential, a revoked scope, a malformed query — as a 200 answer
// carrying an errors array, so a decoder that did not know the field would
// refuse the document for the RIGHT outcome with the wrong reason. Declaring
// it makes the refusal explicit; keeping its contents raw means this package
// never decodes upstream-authored prose into typed fields it would then have
// to reason about.
type calendarDocument struct {
	Data   calendarData      `json:"data"`
	Errors []json.RawMessage `json:"errors"`
}

// calendarData is the query's result root.
type calendarData struct {
	Viewer calendarViewer `json:"viewer"`
}

// calendarViewer is the account the credential belongs to. The query asks
// about the CREDENTIAL'S OWN account rather than a named one, which is what
// makes the answer include private contributions at all — and also means no
// account name travels in the request.
type calendarViewer struct {
	Contributions calendarContributions `json:"contributionsCollection"`
}

// calendarContributions is the collection the calendar hangs off.
type calendarContributions struct {
	Calendar calendarSection `json:"contributionCalendar"`
}

// calendarSection is the calendar itself: the account's own total for the
// window, and the window's days grouped into the upstream's week columns.
type calendarSection struct {
	Total int            `json:"totalContributions"`
	Weeks []calendarWeek `json:"weeks"`
}

// calendarWeek is one week column.
type calendarWeek struct {
	Days []calendarDay `json:"contributionDays"`
}

// calendarDay is one dated cell.
type calendarDay struct {
	Date  string `json:"date"`
	Count int    `json:"contributionCount"`
}

// repositoryEntry is the PROJECTION this package reads a repository metadata
// document through, and the second place its admission gate is a projection
// rather than decodeStrict — for the identical reason commitListEntry is one,
// which is worth restating rather than cross-referencing:
//
//   - Closing the document is not possible without holding the repository
//     OWNER object in this process. The upstream carries a complete account
//     profile on every repository document; DisallowUnknownFields would force
//     this package to declare fields for personal identifiers it must never
//     hold, log, or serve (requirement 12). Reading only the three values the
//     panel renders is the stronger privacy posture, not the looser one.
//   - A projection decodes silently, so every field below is then value-checked
//     — a parseable push instant inside a plausible window, a bounded
//     non-negative tally, a printable description — and any failure discards
//     the whole document for that repository. The gate moved from the decoder
//     to the values; it did not go away.
//
// Description is a POINTER because the upstream writes JSON null for a
// repository that has none, and that is a real state the row serves as an
// empty description rather than as invented copy.
type repositoryEntry struct {
	// Description is the repository's own description, or null when it has
	// none.
	Description *string `json:"description"`
	// Stars is the star tally.
	Stars int64 `json:"stargazers_count"`
	// PushedAt is the RFC 3339 instant of the last push. It is also the proof
	// the document was really parsed: an unrelated JSON object projects to an
	// empty string here, and an empty string does not parse.
	PushedAt string `json:"pushed_at"`
}

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
	// snapshots is the filesystem the registry's snapshot sources were
	// loaded from at construction — the embedded files in production. The
	// data-root loop re-reads its merge base from here, so a merge always
	// starts from the shipped floor rather than compounding on earlier
	// merges.
	snapshots fs.FS
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
	// logger narrates the background refresh loops — per-cycle outcomes at
	// info, failures at warn, per-attempt fetch detail at debug. Never nil:
	// construction defaults it to discardLogger, and it never logs a URL, a
	// credential, or a payload byte.
	logger *slog.Logger
	// dataRootStarted guards StartDataRoot against double starts, exactly as
	// refreshStarted guards the fetch loops.
	dataRootStarted atomic.Bool
	// dataRootOwnsPanel records that the sealed data-root loop OWNS the
	// token-usage panel, so the credentialed live-refresh path must never
	// write it (2026-08-24 review finding 8: both producers wrote the same
	// state.current with no precedence, so a live fetch could overwrite the
	// sealed series and the next data-root tick could overwrite it back).
	//
	// Claimed synchronously by startDataRoot before its goroutine exists and
	// read by BOTH startRefresh and every refresh loop wake, so the rule
	// holds whichever capability starts first: a loop already running exits
	// at its next wake rather than racing the claim.
	dataRootOwnsPanel atomic.Bool
}

// dataRootPanelID is the one panel the sealed data-root path serves. It is a
// constant rather than a parameter because the file name, the document
// schema, and the merge rules are all specific to this panel.
const dataRootPanelID = "token-usage"

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

// The panels data root (issue #142): a mounted read-only directory the
// composition root MAY hand this package, carrying one sealed usage-series
// file pushed out-of-band from the workstation that records the usage. The
// constants below bound that path end to end; the loop, validation, and the
// injected-capability seams (fs.FS and Unsealer — this package holds no
// filesystem, key, or environment capability of its own) live in
// dataroot.go.
const (
	// dataRootSeriesName is the one file name the data-root loop ever opens,
	// relative to the mounted root. There is no discovery and no walk: a
	// hostile root can present exactly one candidate, this one.
	dataRootSeriesName = "token-usage.series.enc"

	// dataRootTTL is the re-read cadence. The workstation pushes on the
	// order of hourly and the volume projection updates within about a
	// minute of the cluster object, so five minutes keeps the panel at most
	// minutes behind a push at negligible read cost.
	dataRootTTL = 5 * time.Minute

	// maxSealedSeriesBytes caps one sealed series file read, and it is THE
	// pipeline's single payload ceiling rather than this stage's private
	// one. Before the 2026-08-24 review five stages disagreed — the exporter
	// pretty-printed with no cap at all, the sealer accepted 1 MiB, the push
	// script checked only "not empty", the documented forced command
	// TRUNCATED to 128 KiB with `head -c`, and this read refused past
	// 64 KiB — so a valid 732-day export could be sealed, pushed, and never
	// admitted, while an oversized one was truncated, atomically installed
	// over the last good file, and only then reported as a checksum mismatch
	// (finding 4).
	//
	// The value is stated once in internal/seal.MaxSealedBytes, where the
	// producer half reads it, together with the measurement behind it. This
	// package cannot import that one — its zero-egress doctrine pin holds
	// every production file to a stdlib-only import surface — so the number
	// is restated here and TestSealedSeriesCapParity fails naming both
	// files if they ever diverge.
	//
	// Raising this from 64 KiB is a unification, not a relaxation: the
	// merged payload is still separately held to MaxPanelResponseBytes by
	// the shared preparation path, and every stage refuses the same byte
	// count before doing anything destructive.
	//
	// That second gate is no longer the FAR TIGHTER one, and saying so would
	// now be false: the owner raised MaxPanelResponseBytes to this same
	// 128 KiB on 2026-08-24, precisely so a document the pipeline can carry
	// is a document the origin can serve. The two checks measure different
	// bytes, though, and the difference runs the safe way: this one bounds
	// the SEALED file, while the serve gate bounds the finished panel/v1
	// ENVELOPE — payload plus framing, minus the AEAD overhead. At the very
	// top of the range a file at exactly this ceiling can therefore still be
	// refused at serve time by the envelope's own bytes. That is refusal,
	// not truncation, and the measured maxima sit below it: the maximal
	// admissible document seals to 103,633 bytes and serves at 104,508, and
	// the structural maximum CapParityTest builds from the shipped
	// vocabularies seals to 109,280.
	maxSealedSeriesBytes = 128 << 10

	// dataRootFutureSkew is how far ahead of the local clock a series
	// file's generatedAt may sit before it is refused as nonsense. Clock
	// skew between the workstation and this host is real; more than this is
	// a file trying to pin itself artificially fresh. The same bound guards
	// the persisted floor marker at load: a marker from the future is
	// ignored as corrupt rather than allowed to refuse every honest push.
	dataRootFutureSkew = 10 * time.Minute

	// usageSeriesSchema is the exact schema marker the sealed document must
	// declare. A breaking document reshape mints a new marker; it never
	// bends this one.
	usageSeriesSchema = "usage-series/v1"

	// maxSeriesCategories bounds how many categories one source may break
	// its series into. The realistic vocabularies hold four or five; the
	// bound stops a hostile file from inflating the payload with hundreds.
	maxSeriesCategories = 8

	// maxSeriesModels bounds the per-model breakdown the same way and at the
	// same number, for the same reason: a structural guard that still holds
	// if the closed vocabulary is ever widened.
	maxSeriesModels = 8

	// maxModelDays bounds how many trailing days the per-model breakdown may
	// cover, and it is a BUDGET rather than a limit of the record. A row
	// costs one integer per day per member, so at maxSeriesDays the section
	// alone would outweigh the entire sealed ceiling before the aggregate is
	// counted at all — full-depth per-model dailies are not a cap edit away,
	// they are a different encoding. A quarter is the reserve this ceiling
	// can carry with room left over, and the covered range is DECLARED by the
	// section's own start date, so a reader is told what they are looking at
	// rather than shown a silent truncation.
	//
	// The categories breakdown has no separate day bound: it answers to
	// maxSeriesDays like the series it partitions, because it costs the same
	// per day as the totals beside it rather than a multiple of them.
	maxModelDays = 92

	// maxCountValue is THE upper bound on every count a pushed document
	// carries, and it is one number three languages agree on (2026-08-24
	// round-3 review, finding 9). 2^53-1 is the largest integer JavaScript
	// represents exactly, so a figure this boundary admits is a figure the
	// browser renders without silently rounding — Number.isSafeInteger on
	// the frontend and the same bound in the producer's emission guard are
	// the other two statements of it.
	//
	// It is a security bound as well as a rendering one. Category values were
	// individually authenticated, individually non-negative, and summed with
	// a plain int64 addition: MaxInt64 + MaxInt64 + 2 wrapped to zero and
	// passed the partition check against a zero total. Bounding the values
	// makes maxSeriesCategories of them unable to overflow at all (8 * 2^53
	// is far below 2^63), and addCounts refuses an overflow independently, so
	// neither bound is load-bearing alone.
	maxCountValue = 1<<53 - 1
)

// windowServeOrder is the canonical order windows are SERVED in, and the
// complete set a pushed section must carry. Same reasoning as
// categoryServeOrder: a fixed order keeps every replica's bytes — and so its
// digest ETag — identical.
var windowServeOrder = []string{"today", "week"}

// FloorState is what the durable replay floor records: the capture instant of
// the last PUBLISHED series document, and the SHA-256 of the exact ciphertext
// that carried it. Both halves are load-bearing (2026-08-24 round-3 review,
// finding 2).
//
// The INSTANT is the monotonic bound: nothing older than it is ever admitted
// again. It is kept at full precision — an earlier revision serialized it
// through a second-resolution format, so a floor written from 12:00:00.900
// came back as 12:00:00 and an authentic document at 12:00:00.100 walked back
// under it after a restart.
//
// The DIGEST is what makes restart recovery a recovery rather than a window.
// A restarted process must re-admit the one document its predecessor
// published, which means admitting equality with the floor exactly once; bound
// to the instant alone, that admitted any other authentic document sharing
// the instant. Bound to the digest, "the same instant" has to also be "the
// same bytes".
//
// The concrete persistence lives with the composition root, exactly like the
// Unsealer: this package gains no write capability of its own. See
// FloorMarker in dataroot.go.
type FloorState struct {
	// Instant is the accepted capture instant, at full precision.
	Instant time.Time
	// Digest is the lowercase hex SHA-256 of the sealed bytes that set this
	// floor. Empty on a floor that came from the embedded snapshot, which is
	// an instant with no ciphertext behind it.
	Digest string
}

// usageSeriesWindowKeys is the CLOSED set of window keys a series document
// may carry, mapped to the periods the panel serves. A closed set because a
// window name is rendered copy: free text here would let a pushed file put
// arbitrary words on the panel. Widening it is a conscious reviewed edit.
var usageSeriesWindowKeys = map[string]string{
	"today": "today",
	"week":  "week",
}

// usageSeriesDerivedKeys is the CLOSED set of stat keys a series document may
// update, and the unit each must already carry — exactly the three figures a
// daily series defines on its own. The document can never add a tile, only
// refresh one of these where the shipped snapshot already shows it; every
// other recorded figure (a lifetime total, a session count) is out of its
// reach by construction.
var usageSeriesDerivedKeys = map[string]string{
	statPeakDay:       UnitTokens,
	statCurrentStreak: UnitDays,
	statLongestStreak: UnitDays,
}

// categoryServeOrder is the CLOSED category vocabulary AND the canonical
// order categories are SERVED in. Closed first (2026-08-24 review finding
// H1): validCategoryKey admits exactly these keys, so a pushed file can
// never mint a category label — a new accounting class is a deliberate edit
// here, in the capture tool's CATEGORY_KEYS, and in the frontend's fixed
// palette slots together. Ordered second: every replica emits identical
// bytes (the digest ETag depends on it) and the frontend's fixed categorical
// hue assignment is stable.
var categoryServeOrder = []string{"input", "output", "cache-read", "cache-write", "reasoning"}

// modelServeOrder is the CLOSED model vocabulary AND the canonical order its
// rows are SERVED in — the same two jobs categoryServeOrder does, for the
// second breakdown (issue #170). Its members are MACHINE KEYS, never display
// copy: a key is what crosses this boundary, and the reader that renders it
// resolves its own label from its own copy of this list. That split is what
// keeps this file free of a model name (doctrine_test's vendor pin) while
// still admitting by MEMBERSHIP rather than by shape — the H1 lesson, which
// a label-shaped `private-feature` would otherwise walk straight through and
// onto a public page.
//
// Index is the palette slot the frontend paints from, so the list is
// APPEND-ONLY: reusing or reordering an index repaints history under a
// different entity, and a retired member keeps its slot as a tombstone. The
// first member is the reserved residual — the class every token the producer
// cannot attribute falls into — and it holds index 0 by RULE, so a named
// entity never inherits the neutral slot.
//
// Pinned by value against the producer's MODEL_KEYS and the frontend's
// modelSlots by ModelVocabularyParityTest in scripts/ci, exactly as the
// category vocabulary is: adding a model is one reviewed data edit landing
// in three places together, never a document's choice.
var modelServeOrder = []string{"other", "fable-5", "opus-5", "sonnet-5", "opus-4-8"}

// usageSeriesDocument is the strict on-disk shape of the sealed series file
// (schema usage-series/v1). Sources are keyed by the SAME label the embedded
// snapshot uses for that source — a key with no matching snapshot label
// refuses the whole document, so a pushed file can never invent a source the
// owner did not ship.
type usageSeriesDocument struct {
	// Schema must equal usageSeriesSchema.
	Schema string `json:"schema"`
	// GeneratedAt is the RFC 3339 capture instant. It must be newer than the
	// embedded snapshot's and newer than the last accepted file's, and not
	// meaningfully in the future — the replay and rollback guards.
	GeneratedAt string `json:"generatedAt"`
	// Sources maps snapshot source labels to their captured sections.
	Sources map[string]usageSeriesSource `json:"sources"`
}

// usageSeriesSource is one source's captured section.
type usageSeriesSource struct {
	// CapturedAt is THIS source's own RFC 3339 capture instant, and it is
	// required (2026-08-24 round-3 review, finding 5). A merged source is
	// produced by a separate capture run and can be arbitrarily older than
	// the export carrying it, so without a per-source instant the combined
	// document relabelled stale data as current under one `generatedAt`. It
	// may not be later than the document that carries it, and the envelope's
	// served instant is the OLDEST of them.
	CapturedAt string `json:"capturedAt"`
	// Series is the daily total series; Recorded must be true — this file IS
	// an out-of-band capture, and a file claiming live provenance is refused.
	Series usageSeriesSection `json:"series"`
	// Categories optionally partitions the series per day, keyed by category
	// key. Every row must cover exactly the section's own window and the
	// per-day row sum must equal the series total across it.
	Categories map[string][]int64 `json:"categories,omitempty"`
	// CategoriesStartDate optionally declares that the category rows cover a
	// TRAILING WINDOW of the series rather than all of it. Absent means
	// aligned, which is what every document written before this field
	// existed says by omission; present, it must name a day strictly inside
	// the series, so there is exactly one spelling of "aligned".
	CategoriesStartDate string `json:"categoriesStartDate,omitempty"`
	// Models optionally partitions the same series per day by MODEL, over a
	// different closed vocabulary and under its own day bound. Optional
	// because "this source cannot attribute per model" is a real producer
	// state that renders the complete v1 story — unlike Windows and Derived
	// below, whose absence would leave a release-time figure standing beside
	// a runtime series under one instant (2026-08-24 round-3 finding 5).
	Models map[string][]int64 `json:"models,omitempty"`
	// ModelsStartDate declares the models window, exactly as
	// CategoriesStartDate declares the categories one.
	ModelsStartDate string `json:"modelsStartDate,omitempty"`
	// Windows carries the COMPLETE aggregate window set, keyed by the closed
	// usageSeriesWindowKeys vocabulary. Required and complete: an omitted
	// window used to leave the release-time one rendered beside a runtime
	// series under one instant (2026-08-24 round-3 review, finding 5).
	Windows map[string]usageSeriesWindow `json:"windows"`
	// Derived carries the COMPLETE series-derived stat set, keyed by the
	// closed usageSeriesDerivedKeys vocabulary. Required and complete, for
	// the same reason Windows is.
	//
	// The values are POINTERS so that "the key is present carrying nothing"
	// is a state this package can SEE. It could not before: decodeStrict
	// refuses unknown fields but never requires known ones, so `"peak-day":
	// null` — or a producer that emitted the key and forgot the number —
	// decoded to a plain 0, satisfied the completeness rule, and overwrote a
	// truthfully null tile with a figure nobody measured. A null is now
	// refused by name rather than published as a zero (owner directive,
	// 2026-08-28: "if its either 0 or unknown I rather it be Unknown").
	Derived map[string]*int64 `json:"derived"`
}

// usageSeriesSection mirrors TokenUsageSeries' on-disk form.
type usageSeriesSection struct {
	StartDate string  `json:"startDate"`
	Totals    []int64 `json:"totals"`
	Recorded  bool    `json:"recorded"`
}

// usageSeriesWindow is one aggregate window: the same input/output split the
// panel's window rows render.
//
// Both halves are POINTERS for the reason usageSeriesSource.Derived's values
// are: an object that simply omits them — `"today": {}` — decoded to 0/0,
// passed every count bound, and was served as a measured zero on the page. The
// completeness rule above proves the KEYS are all there and said nothing about
// the VALUES, which is exactly the gap a defaulted zero walks through. Absent
// is now refused by name.
type usageSeriesWindow struct {
	Input  *int64 `json:"input"`
	Output *int64 `json:"output"`
}
