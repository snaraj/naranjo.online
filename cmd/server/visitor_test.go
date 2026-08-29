// visitor_test tells the production story over real transport: each test
// boots run() exactly the way main does (via bootServer) and drives it
// through the testsupport.Visitor mock-browser harness, so the suite reads as
// visitor scenarios — first visit, repeat visit, media playback, hostile
// probing — rather than isolated endpoint checks. The harness asserts the
// security-header baseline on every single navigation. These scenarios ADD
// user-story framing on top of the contract-focused e2e suites in
// main_e2e_test.go and media_lifecycle_test.go; they replace nothing.
// Sequential by design, mirroring the existing e2e discipline: every scenario
// owns a live port and ends with process-global SIGTERM delivery.
package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/snaraj/naranjo.online/internal/testsupport"
)

// drainScenario is the shared epilogue of every visitor scenario: deliver the
// same SIGTERM Kubernetes sends and require the clean drain main promises. It
// runs outside any subtest so it executes even after a failed chapter.
func drainScenario(t *testing.T, runResult <-chan error) {
	t.Helper()
	if err := syscall.Kill(os.Getpid(), syscall.SIGTERM); err != nil {
		t.Fatalf("deliver SIGTERM: %v", err)
	}
	select {
	case err := <-runResult:
		if err != nil {
			t.Fatalf("run() = %v after SIGTERM, want nil", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("run() did not drain within 15s of SIGTERM")
	}
}

// TestVisitorBrowsesTheSite is the ordinary reader's story: a first visit
// downloads the shell fresh and caches its hashed assets forever, a repeat
// visit revalidates everything down to cheap 304s, and a mistyped deep link
// stays an opaque 404 — all with the security baseline asserted by the
// harness on every navigation.
func TestVisitorBrowsesTheSite(t *testing.T) {
	requireBuiltFrontend(t)
	base, runResult := bootServer(t, nil)
	session := testsupport.NewVisitor(t, base)
	var assets []string

	t.Run("first visit: shell 200 no-cache and hashed assets immutable", func(t *testing.T) {
		visitor := session.On(t)
		shell := visitor.Navigate("/")
		if shell.StatusCode != http.StatusOK {
			t.Fatalf("GET / = %d", shell.StatusCode)
		}
		if got := shell.Header.Get("Cache-Control"); got != "no-cache" {
			t.Errorf("shell Cache-Control = %q, want no-cache", got)
		}
		if got := shell.Header.Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
			t.Errorf("shell Content-Type = %q", got)
		}
		// Structure, never copy: the static-fallback marker is the document
		// contract; the shell's text will change when the real site ships.
		if !bytes.Contains(shell.Body, []byte("data-static-fallback")) {
			t.Error("served document lacks the static application fallback marker")
		}
		assets = visitor.AssetReferences(shell.Body)
		if len(assets) == 0 {
			t.Fatal("document references no built assets to follow")
		}
		for _, asset := range assets {
			response := visitor.Navigate(asset)
			if response.StatusCode != http.StatusOK || len(response.Body) == 0 {
				t.Fatalf("GET %s = %d, %d bytes", asset, response.StatusCode, len(response.Body))
			}
			if got := response.Header.Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
				t.Errorf("%s Cache-Control = %q, want the immutable policy", asset, got)
			}
		}
	})

	t.Run("repeat visit: shell and assets revalidate to 304", func(t *testing.T) {
		visitor := session.On(t)
		if len(assets) == 0 {
			t.Skip("first visit failed; nothing cached to revalidate")
		}
		for _, path := range append([]string{"/"}, assets...) {
			response := visitor.Navigate(path)
			if response.StatusCode != http.StatusNotModified {
				t.Errorf("revisit %s = %d, want 304 from the replayed validator", path, response.StatusCode)
			}
			if len(response.Body) != 0 {
				t.Errorf("revisit %s carried %d body bytes, want an empty 304", path, len(response.Body))
			}
		}
	})

	t.Run("visitor deep-links a missing page: opaque 404, headers intact", func(t *testing.T) {
		missing := session.On(t).Navigate("/blog/first-post")
		if missing.StatusCode != http.StatusNotFound {
			t.Fatalf("GET /blog/first-post = %d, want 404", missing.StatusCode)
		}
		if got := strings.TrimSpace(string(missing.Body)); got != "404 page not found" {
			t.Errorf("404 body = %q; it must stay the opaque default", got)
		}
	})

	drainScenario(t, runResult)
}

// Panel API shapes are pinned here as independent expected values — never
// imported from internal/panels, or the assertions would become tautologies.
// A schema change must consciously edit both sides.

// visitorColdStatus pins each panel's expected status on an egress-free
// boot: every panel is now fetch-backed, so every panel serves its embedded
// snapshot fallback as stale until live refresh is explicitly enabled.
var visitorColdStatus = map[string]string{
	"token-usage":     "stale",
	"vcs-activity":    "stale",
	"boss-log":        "stale",
	"coding-projects": "stale",
}

type visitorPanelIndex struct {
	Panels []visitorPanelRow `json:"panels"`
}

type visitorPanelRow struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

type visitorPanelEnvelope struct {
	Schema      string          `json:"schema"`
	ID          string          `json:"id"`
	Kind        string          `json:"kind"`
	Title       string          `json:"title"`
	GeneratedAt string          `json:"generatedAt"`
	Status      string          `json:"status"`
	Data        json.RawMessage `json:"data"`
}

// decodeVisitorJSON strictly decodes one API body into v, so a served field
// the pinned shape does not know fails the scenario instead of hiding.
func decodeVisitorJSON(t *testing.T, body []byte, v any) {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(v); err != nil {
		t.Fatalf("decode API body %q: %v", body, err)
	}
}

// TestVisitorReadsThePanels is the dashboard reader's story over real
// transport: the index names every panel, each panel answers with the stable
// versioned envelope inside the owner's byte budgets, a later visit
// revalidates everything down to cheap 304s, and a mistyped id stays an
// opaque 404 — with the security-header and CSP baseline asserted by the
// harness on every single navigation.
func TestVisitorReadsThePanels(t *testing.T) {
	requireBuiltFrontend(t)
	base, runResult := bootServer(t, nil)
	session := testsupport.NewVisitor(t, base)
	var panelPaths []string

	t.Run("opens the index: every panel listed honestly, JSON, revalidated class", func(t *testing.T) {
		visitor := session.On(t)
		response := visitor.Navigate("/api/panels")
		if response.StatusCode != http.StatusOK {
			t.Fatalf("GET /api/panels = %d", response.StatusCode)
		}
		if got := response.Header.Get("Content-Type"); got != "application/json" {
			t.Errorf("index Content-Type = %q", got)
		}
		if got := response.Header.Get("Cache-Control"); got != "no-cache" {
			t.Errorf("index Cache-Control = %q, want no-cache", got)
		}
		// The harness already requires one of the two documented CSPs on
		// every navigation; API responses must carry the site policy exactly.
		if got := response.Header.Get("Content-Security-Policy"); got != testsupport.SiteContentSecurityPolicy {
			t.Errorf("index Content-Security-Policy = %q, want the site policy", got)
		}
		if size := len(response.Body); size > 4096 {
			t.Errorf("index response is %d bytes, over the owner's 4 KiB budget", size)
		}
		var index visitorPanelIndex
		decodeVisitorJSON(t, response.Body, &index)
		if len(index.Panels) != len(visitorColdStatus) {
			t.Fatalf("index lists %d panels, want %d", len(index.Panels), len(visitorColdStatus))
		}
		for _, row := range index.Panels {
			if row.ID == "" || row.Title == "" || !versionedKind(row.Kind) {
				t.Errorf("index row incomplete: %+v", row)
			}
			// Live refresh is opt-in and this boot never enables it, so
			// fetch-backed panels honestly report their snapshot fallback as
			// stale while the snapshot-only panel is ok — an independent pin
			// of the expected cold-start statuses.
			if want := visitorColdStatus[row.ID]; row.Status != want {
				t.Errorf("panel %s status = %q, want %q on an egress-free boot", row.ID, row.Status, want)
			}
			panelPaths = append(panelPaths, "/api/panels/"+row.ID)
		}
	})

	t.Run("reads each panel: the versioned envelope within budget", func(t *testing.T) {
		visitor := session.On(t)
		if len(panelPaths) == 0 {
			t.Skip("index chapter failed; no panels to read")
		}
		for _, path := range panelPaths {
			response := visitor.Navigate(path)
			if response.StatusCode != http.StatusOK {
				t.Fatalf("GET %s = %d", path, response.StatusCode)
			}
			// The literal is deliberate, per this file's own rule above:
			// importing the constant would make the assertion agree with
			// whatever internal/panels happens to say. The owner raised the
			// budget from 32 KiB to 128 KiB on 2026-08-24 and this side was
			// edited consciously to match, which is exactly the conscious
			// edit the independence is for.
			if size := len(response.Body); size > 131072 {
				t.Errorf("%s response is %d bytes, over the owner's 128 KiB budget", path, size)
			}
			var envelope visitorPanelEnvelope
			decodeVisitorJSON(t, response.Body, &envelope)
			if envelope.Schema != "panel/v1" {
				t.Errorf("%s schema = %q, want panel/v1", path, envelope.Schema)
			}
			if "/api/panels/"+envelope.ID != path || envelope.Title == "" {
				t.Errorf("%s envelope identity = %+v", path, envelope)
			}
			if want := visitorColdStatus[envelope.ID]; envelope.Status != want {
				t.Errorf("%s status = %q, want %q on an egress-free boot", path, envelope.Status, want)
			}
			if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
				t.Errorf("%s serves no data", path)
			}
			if _, err := time.Parse(time.RFC3339, envelope.GeneratedAt); err != nil {
				t.Errorf("%s generatedAt = %q: %v", path, envelope.GeneratedAt, err)
			}
		}
	})

	t.Run("returns later: remembered validators answer 304", func(t *testing.T) {
		visitor := session.On(t)
		if len(panelPaths) == 0 {
			t.Skip("index chapter failed; nothing cached to revalidate")
		}
		for _, path := range append([]string{"/api/panels"}, panelPaths...) {
			response := visitor.Navigate(path)
			if response.StatusCode != http.StatusNotModified {
				t.Errorf("revisit %s = %d, want 304 from the replayed validator", path, response.StatusCode)
			}
			if len(response.Body) != 0 {
				t.Errorf("revisit %s carried %d body bytes, want an empty 304", path, len(response.Body))
			}
		}
	})

	t.Run("mistypes a panel id: opaque 404, headers intact", func(t *testing.T) {
		missing := session.On(t).Navigate("/api/panels/listening-stats")
		if missing.StatusCode != http.StatusNotFound {
			t.Fatalf("GET /api/panels/listening-stats = %d, want 404", missing.StatusCode)
		}
		if got := strings.TrimSpace(string(missing.Body)); got != "404 page not found" {
			t.Errorf("404 body = %q; it must stay the opaque default", got)
		}
	})

	drainScenario(t, runResult)
}

// visitorBossLog pins the boss-log/v1 payload contract as an independent
// expected shape. KC and Rank are pointers on purpose: the hiscores
// legitimately carry null below the listing threshold, the frontend renders
// null as "--", and this pin fails if an omitempty-style regression ever
// erases a null on the round trip.
type visitorBossLog struct {
	Account string            `json:"account"`
	Skills  []visitorSkillRow `json:"skills"`
	Bosses  []visitorBossRow  `json:"bosses"`
}

type visitorBossRow struct {
	Name  string `json:"name"`
	KC    *int64 `json:"kc"`
	Rank  *int64 `json:"rank"`
	Score *int64 `json:"score,omitempty"`
}

// visitorSkillRow is the additive skill section of boss-log/v1, declared here
// as its own expected shape exactly like the token panel's later sections: a
// reader of this file sees the contract the rail's skill grid depends on
// without leaving the story. Every figure is a pointer because the hiscores
// report none below their listing threshold, and the grid prints that as a
// dash rather than a zero.
type visitorSkillRow struct {
	Name  string `json:"name"`
	Level *int64 `json:"level"`
	Rank  *int64 `json:"rank"`
	XP    *int64 `json:"xp"`
}

// TestVisitorChecksTheBossLog is the boss-log reader's story: open the page
// the side rail lives on like any visitor, then read the panel the rail's
// grid renders and hold its payload to the cell contract — a named account,
// named bosses, tallies that are null or non-negative, and both tally
// branches present in the served data so the "--" rendering path is always
// exercised, not merely possible.
func TestVisitorChecksTheBossLog(t *testing.T) {
	requireBuiltFrontend(t)
	base, runResult := bootServer(t, nil)
	session := testsupport.NewVisitor(t, base)

	t.Run("opens the page the rail lives on", func(t *testing.T) {
		shell := session.On(t).Navigate("/")
		if shell.StatusCode != http.StatusOK {
			t.Fatalf("GET / = %d", shell.StatusCode)
		}
		// Structure, never copy: the document contract is the fallback
		// marker; the rail itself hydrates client-side from the panel API.
		if !bytes.Contains(shell.Body, []byte("data-static-fallback")) {
			t.Error("served document lacks the static application fallback marker")
		}
	})

	t.Run("reads the stats panel: the grid's cell contract holds", func(t *testing.T) {
		response := session.On(t).Navigate("/api/panels/boss-log")
		if response.StatusCode != http.StatusOK {
			t.Fatalf("GET /api/panels/boss-log = %d", response.StatusCode)
		}
		var envelope visitorPanelEnvelope
		decodeVisitorJSON(t, response.Body, &envelope)
		if envelope.Kind != "boss-log/v1" {
			t.Fatalf("boss-log kind = %q, want boss-log/v1", envelope.Kind)
		}
		// The heading the rail puts on the card. The panel's id and kind are
		// its stable public identity and deliberately did NOT follow the
		// owner's rename, so this is the one place the new title is visible.
		if envelope.Title != "Old School RuneScape Stats" {
			t.Errorf("boss-log title = %q, want the panel's current heading", envelope.Title)
		}
		var payload visitorBossLog
		decodeVisitorJSON(t, envelope.Data, &payload)
		if payload.Account == "" {
			t.Error("payload names no account")
		}
		// The upstream hiscores document always carries a skill table, and
		// the panel exists to render it beside the tallies; an empty section
		// here means the mapping dropped it on the floor again, which is the
		// exact defect this section was added to end.
		if len(payload.Skills) == 0 {
			t.Fatal("payload lists no skills; the rail's skill grid would render its empty state")
		}
		for _, skill := range payload.Skills {
			if skill.Name == "" {
				t.Error("a skill row carries no name; cells and labels need one")
			}
			if skill.Level != nil && *skill.Level < 0 {
				t.Errorf("skill %s level = %d, want null or non-negative", skill.Name, *skill.Level)
			}
			if skill.Rank != nil && *skill.Rank < 0 {
				t.Errorf("skill %s rank = %d, want null or non-negative", skill.Name, *skill.Rank)
			}
			if skill.XP != nil && *skill.XP < 0 {
				t.Errorf("skill %s xp = %d, want null or non-negative", skill.Name, *skill.XP)
			}
		}
		if len(payload.Bosses) == 0 {
			t.Fatal("payload lists no bosses; the grid would render empty")
		}
		var ranked, unranked bool
		for _, boss := range payload.Bosses {
			if boss.Name == "" {
				t.Error("a boss row carries no name; cells and tooltips need one")
			}
			if boss.KC != nil && *boss.KC < 0 {
				t.Errorf("boss %s kc = %d, want null or non-negative", boss.Name, *boss.KC)
			}
			if boss.Rank != nil && *boss.Rank < 0 {
				t.Errorf("boss %s rank = %d, want null or non-negative", boss.Name, *boss.Rank)
			}
			// The rendering branches the grid actually has: a numeric rank, and
			// a null rank the tile prints as "Unranked". A null count is a
			// third, rarer branch the upstream may or may not produce for this
			// account, so it is not required here.
			if boss.Rank == nil {
				unranked = true
			} else {
				ranked = true
			}
		}
		if !ranked || !unranked {
			t.Error(`served data must exercise both rank branches: at least one ranked boss and one unranked (rendered as "Unranked")`)
		}
	})

	drainScenario(t, runResult)
}

// versionedKind reports whether a kind carries an explicit payload version —
// a `/v` followed by at least one digit and nothing else. The visitor used to
// spell this as a literal "/v1" suffix, which pinned the wrong fact: what the
// envelope doctrine promises is that every payload names a VERSION, not that
// every payload is forever on its first one. That literal went stale the day
// token-usage/v2 was minted (issue #170), and it would have gone stale for
// any other panel's second version too.
func versionedKind(kind string) bool {
	marker := strings.LastIndex(kind, "/v")
	if marker < 0 {
		return false
	}
	digits := kind[marker+2:]
	if digits == "" {
		return false
	}
	for _, r := range digits {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// The token-usage payload contract, pinned as independent expected shapes
// exactly like the envelope above: sources are labeled by DATA the origin
// serves, windows carry the /usage-shaped fields, and the two optional fields
// stay pointers because absence is meaningful and must survive decoding.
type visitorTokenUsageData struct {
	Sources []visitorTokenUsageSource `json:"sources"`
}

type visitorTokenUsageSource struct {
	Label    string                     `json:"label"`
	Account  string                     `json:"account"`
	Windows  []visitorTokenUsageWindow  `json:"windows"`
	Stats    []visitorTokenUsageStat    `json:"stats"`
	Series   *visitorTokenUsageSeries   `json:"series"`
	Insights []visitorTokenUsageInsight `json:"insights"`
}

// visitorTokenUsageStat, -Series, and -Insight are the additive token-usage
// sections: headline tiles, the daily activity series behind the grid, and
// the labeled proportions under it. Value and Pct are pointers because "the
// source does not report this figure" is real information the panel renders
// as a dash, and a non-pointer would silently turn it into a zero.
type visitorTokenUsageStat struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Value    *int64 `json:"value"`
	Unit     string `json:"unit"`
	Recorded bool   `json:"recorded"`
}

type visitorTokenUsageSeries struct {
	StartDate string  `json:"startDate"`
	Totals    []int64 `json:"totals"`
	// Recorded is the series' own provenance flag, carrying exactly what it
	// carries on a stat tile: this series was captured out of band rather than
	// fetched, and says so instead of borrowing the panel's freshness. Live
	// mapping never sets it.
	Recorded bool `json:"recorded"`
}

type visitorTokenUsageInsight struct {
	Label    string   `json:"label"`
	Pct      *float64 `json:"pct"`
	Recorded bool     `json:"recorded"`
}

type visitorTokenUsageWindow struct {
	Period         string   `json:"period"`
	InputTokens    int64    `json:"inputTokens"`
	OutputTokens   int64    `json:"outputTokens"`
	UtilizationPct *float64 `json:"utilizationPct"`
	ResetsAt       *string  `json:"resetsAt"`
}

// TestVisitorChecksTokenUsage is the dashboard reader glancing at model spend:
// the served page ships the token-usage panel wired into its bundle, and the
// panel answers with the /usage-shaped contract — both labeled sources, every
// window structurally sound — honestly badged stale, because an egress-free
// boot serves the embedded snapshot fallback and must say so. Labels are
// asserted as distinct non-empty data, never as particular vendor spellings:
// which tools report usage is the data's business, not this suite's.
func TestVisitorChecksTokenUsage(t *testing.T) {
	requireBuiltFrontend(t)
	base, runResult := bootServer(t, nil)
	session := testsupport.NewVisitor(t, base)

	t.Run("opens the site: the page ships the token-usage panel wired in", func(t *testing.T) {
		visitor := session.On(t)
		shell := visitor.Navigate("/")
		if shell.StatusCode != http.StatusOK {
			t.Fatalf("GET / = %d", shell.StatusCode)
		}
		if !bytes.Contains(shell.Body, []byte("data-static-fallback")) {
			t.Error("served document lacks the static application fallback marker")
		}
		// The mock browser does not execute scripts, so "the page renders the
		// panel" is proven the transport way: some shipped asset must carry
		// both the panel API root and this panel's id, or the mounted
		// component never made it into the bundle the visitor downloads.
		wired := false
		for _, asset := range visitor.AssetReferences(shell.Body) {
			response := visitor.Navigate(asset)
			if response.StatusCode != http.StatusOK {
				t.Fatalf("GET %s = %d", asset, response.StatusCode)
			}
			if bytes.Contains(response.Body, []byte("/api/panels")) && bytes.Contains(response.Body, []byte("token-usage")) {
				wired = true
			}
		}
		if !wired {
			t.Error("no shipped asset wires the token-usage panel to the panel API")
		}
	})

	t.Run("reads the usage panel: both sources /usage-shaped, snapshot fallback honestly stale", func(t *testing.T) {
		response := session.On(t).Navigate("/api/panels/token-usage")
		if response.StatusCode != http.StatusOK {
			t.Fatalf("GET /api/panels/token-usage = %d", response.StatusCode)
		}
		var envelope visitorPanelEnvelope
		decodeVisitorJSON(t, response.Body, &envelope)
		if envelope.Schema != "panel/v1" || envelope.ID != "token-usage" || envelope.Kind != "token-usage/v2" {
			t.Fatalf("envelope identity = %+v", envelope)
		}
		// The stale/fallback case: live refresh is never enabled on this
		// boot, so the panel serves its embedded snapshot and the badge
		// contract requires it to say stale — data present AND provenance
		// honest, never fresh-looking numbers.
		if envelope.Status != "stale" {
			t.Errorf("status = %q, want %q for the egress-free snapshot fallback", envelope.Status, "stale")
		}
		if _, err := time.Parse(time.RFC3339, envelope.GeneratedAt); err != nil {
			t.Errorf("generatedAt = %q: %v", envelope.GeneratedAt, err)
		}
		var usage visitorTokenUsageData
		decodeVisitorJSON(t, envelope.Data, &usage)
		if len(usage.Sources) != 2 {
			t.Fatalf("payload carries %d sources, want both", len(usage.Sources))
		}
		seen := make(map[string]bool)
		for _, source := range usage.Sources {
			if source.Label == "" || seen[source.Label] {
				t.Errorf("source labels must be distinct non-empty data, got %q twice or empty", source.Label)
			}
			seen[source.Label] = true
			// Sections are optional and absence is honest: the shipped
			// snapshot carries the figures that were actually recorded and
			// leaves the rest empty rather than inventing numbers. What a
			// present section must satisfy is pinned below.
			// A shipped series is admitted now (issue #134) — the local
			// transcript record is a real measurement — on the one condition
			// that made the old blanket refusal look right: it must SAY it was
			// recorded out of band. Unmarked, a reader could not tell it from
			// a live one on a boot that has no live path at all.
			if source.Series != nil {
				if !source.Series.Recorded {
					t.Errorf("source %q ships an activity series that does not declare itself recorded; on this boot nothing is live and an unmarked series is indistinguishable from one", source.Label)
				}
				if len(source.Series.Totals) == 0 {
					t.Errorf("source %q ships a series with no days in it", source.Label)
				}
				if _, err := time.Parse("2006-01-02", source.Series.StartDate); err != nil {
					t.Errorf("source %q series startDate = %q: %v", source.Label, source.Series.StartDate, err)
				}
				for day, total := range source.Series.Totals {
					if total < 0 {
						t.Errorf("source %q series day %d is negative", source.Label, day)
					}
				}
			}
			for _, stat := range source.Stats {
				if stat.Key == "" || stat.Label == "" || stat.Unit == "" {
					t.Errorf("source %q ships an incomplete stat tile: %+v", source.Label, stat)
				}
				if !stat.Recorded {
					t.Errorf("source %q stat %q is snapshot data yet claims live provenance", source.Label, stat.Key)
				}
			}
			for _, insight := range source.Insights {
				if insight.Label == "" {
					t.Errorf("source %q ships an insight with no label", source.Label)
				}
			}
			for _, window := range source.Windows {
				if window.Period == "" {
					t.Errorf("source %q has a window with no period", source.Label)
				}
				if window.InputTokens < 0 || window.OutputTokens < 0 {
					t.Errorf("source %q window %q counts negative tokens", source.Label, window.Period)
				}
				if window.UtilizationPct != nil && *window.UtilizationPct < 0 {
					t.Errorf("source %q window %q utilization is negative", source.Label, window.Period)
				}
				if window.ResetsAt != nil {
					if _, err := time.Parse(time.RFC3339, *window.ResetsAt); err != nil {
						t.Errorf("source %q window %q resetsAt = %q: %v", source.Label, window.Period, *window.ResetsAt, err)
					}
				}
			}
		}
	})

	drainScenario(t, runResult)
}

// visitorActivityPayload pins the vcs-activity/v1 payload contract the
// activity strip renders, as an independent expected shape — never imported
// from internal/panels, or the assertion would become a tautology.
type visitorActivityPayload struct {
	TotalContributions int     `json:"totalContributions"`
	Weeks              [][]int `json:"weeks"`
	Streak             int     `json:"streak"`
	// EndDate anchors the calendar: the final week is padded to seven days
	// like every other, so without it the padding is indistinguishable from
	// genuine quiet days.
	EndDate       string                  `json:"endDate"`
	RecentCommits []visitorActivityCommit `json:"recentCommits"`
	// CommitsAt is the commit list's OWN instant. The two halves of this
	// payload are read on different budgets, so a list that borrowed the
	// calendar's generatedAt could claim to have been read before the commits
	// in it happened.
	CommitsAt string `json:"commitsAt"`
}

type visitorActivityCommit struct {
	Repo    string `json:"repo"`
	SHA     string `json:"sha"`
	Message string `json:"message"`
	At      string `json:"at"`
}

// TestVisitorSeesTheActivityStrip is the activity reader's story: the served
// page ships the contribution-strip UI (its cell markers and panel id ride in
// the built assets a browser would execute), and the payload behind it honors
// the exact contract the strip renders — week columns of exactly seven
// non-negative daily counts, non-negative totals and streak, dated recent
// commits, and a generatedAt instant the strip can anchor cell dates on.
// TestVisitorReadsTheProjectFeed is the user story behind issue 242's second
// half: a visitor scrolls to Coding Projects and reads what the owner's host
// says about each repository, rather than what it said on the day the release
// was cut.
//
// This boot enables no refresh, so what the scenario proves is the COLD half
// of the contract — which is the half that has to be right for the change to
// be safe to merge before any credential exists. The panel serves its shipped
// snapshot, says stale, and marks every row recorded; the page renders it
// without waiting, because the block's adapter answers a null envelope with
// the captured rows instead of nothing.
func TestVisitorReadsTheProjectFeed(t *testing.T) {
	requireBuiltFrontend(t)
	base, runResult := bootServer(t, nil)
	session := testsupport.NewVisitor(t, base)

	t.Run("loads the page: the built assets carry the project feed", func(t *testing.T) {
		visitor := session.On(t)
		shell := visitor.Navigate("/")
		if shell.StatusCode != http.StatusOK {
			t.Fatalf("GET / = %d", shell.StatusCode)
		}
		assets := visitor.AssetReferences(shell.Body)
		if len(assets) == 0 {
			t.Fatal("document references no built assets to follow")
		}
		var bundled []byte
		for _, asset := range assets {
			response := visitor.Navigate(asset)
			if response.StatusCode != http.StatusOK {
				t.Fatalf("GET %s = %d", asset, response.StatusCode)
			}
			bundled = append(bundled, response.Body...)
		}
		// Structure and markers, never copy: the panel id the block subscribes
		// to, the entry-count class the feed's figures render in, and the
		// provenance mark a captured figure carries.
		for _, marker := range []string{"coding-projects", "entry-count", "recorded"} {
			if !bytes.Contains(bundled, []byte(marker)) {
				t.Errorf("built assets lack the project-feed marker %q", marker)
			}
		}
	})

	t.Run("reads the panel: every row is present, dated, and honest about itself", func(t *testing.T) {
		visitor := session.On(t)
		response := visitor.Navigate("/api/panels/coding-projects")
		if response.StatusCode != http.StatusOK {
			t.Fatalf("GET /api/panels/coding-projects = %d", response.StatusCode)
		}
		var envelope visitorPanelEnvelope
		decodeVisitorJSON(t, response.Body, &envelope)
		if envelope.Kind != "coding-projects/v1" {
			t.Fatalf("kind = %q, want coding-projects/v1", envelope.Kind)
		}
		if want := visitorColdStatus[envelope.ID]; envelope.Status != want {
			t.Errorf("status = %q, want %q on an egress-free boot", envelope.Status, want)
		}
		if _, err := time.Parse(time.RFC3339, envelope.GeneratedAt); err != nil {
			t.Errorf("generatedAt = %q: %v", envelope.GeneratedAt, err)
		}
		var payload struct {
			Repos []struct {
				Name        string `json:"name"`
				Description string `json:"description"`
				Stars       *int64 `json:"stars"`
				PushedAt    string `json:"pushedAt"`
				OpenIssues  *int64 `json:"openIssues"`
				OpenPulls   *int64 `json:"openPulls"`
				Recorded    bool   `json:"recorded"`
			} `json:"repos"`
		}
		decodeVisitorJSON(t, envelope.Data, &payload)
		if len(payload.Repos) == 0 {
			t.Fatal("the project feed serves no repositories at all")
		}
		seen := make(map[string]bool, len(payload.Repos))
		for _, repo := range payload.Repos {
			if repo.Name == "" {
				t.Error("a row carries no repository name")
			}
			if seen[repo.Name] {
				t.Errorf("%s appears twice in one payload", repo.Name)
			}
			seen[repo.Name] = true
			if repo.Description == "" {
				t.Errorf("%s serves no description", repo.Name)
			}
			if _, err := time.Parse(time.RFC3339, repo.PushedAt); err != nil {
				t.Errorf("%s pushedAt = %q: %v", repo.Name, repo.PushedAt, err)
			}
			// The whole point of the cold state: nothing here was read live,
			// and every row says so rather than passing as fresh.
			if !repo.Recorded {
				t.Errorf("%s claims a freshness this boot cannot have", repo.Name)
			}
			// The open-work pair (issue 252) arrives and leaves TOGETHER, so a
			// row carrying one figure and not the other is the state this
			// producer refuses to construct — and one it must never serve.
			if (repo.OpenIssues == nil) != (repo.OpenPulls == nil) {
				t.Errorf("%s serves half of a derived pair: issues=%v pulls=%v", repo.Name, repo.OpenIssues, repo.OpenPulls)
			}
			if repo.OpenIssues == nil {
				t.Errorf("%s serves no open-work tallies where the snapshot records both", repo.Name)
			}
			if repo.Stars == nil {
				t.Errorf("%s serves a null tally where the snapshot records one", repo.Name)
			}
		}
	})

	drainScenario(t, runResult)
}

func TestVisitorSeesTheActivityStrip(t *testing.T) {
	requireBuiltFrontend(t)
	base, runResult := bootServer(t, nil)
	session := testsupport.NewVisitor(t, base)

	t.Run("loads the page: the built assets carry the activity strip", func(t *testing.T) {
		visitor := session.On(t)
		shell := visitor.Navigate("/")
		if shell.StatusCode != http.StatusOK {
			t.Fatalf("GET / = %d", shell.StatusCode)
		}
		assets := visitor.AssetReferences(shell.Body)
		if len(assets) == 0 {
			t.Fatal("document references no built assets to follow")
		}
		var bundled []byte
		for _, asset := range assets {
			response := visitor.Navigate(asset)
			if response.StatusCode != http.StatusOK {
				t.Fatalf("GET %s = %d", asset, response.StatusCode)
			}
			bundled = append(bundled, response.Body...)
		}
		// Structure, never copy: the markers are the component's stable DOM
		// contract (cell marker, level attribute, panel id), not site text.
		for _, marker := range []string{"data-grid-cell", "data-grid-level", "vcs-activity"} {
			if !bytes.Contains(bundled, []byte(marker)) {
				t.Errorf("built assets lack the activity-strip marker %q", marker)
			}
		}
	})

	t.Run("reads the panel: the payload honors the strip's contract", func(t *testing.T) {
		visitor := session.On(t)
		response := visitor.Navigate("/api/panels/vcs-activity")
		if response.StatusCode != http.StatusOK {
			t.Fatalf("GET /api/panels/vcs-activity = %d", response.StatusCode)
		}
		var envelope visitorPanelEnvelope
		decodeVisitorJSON(t, response.Body, &envelope)
		if envelope.Kind != "vcs-activity/v1" {
			t.Fatalf("kind = %q, want vcs-activity/v1", envelope.Kind)
		}
		if want := visitorColdStatus[envelope.ID]; envelope.Status != want {
			t.Errorf("status = %q, want %q on an egress-free boot", envelope.Status, want)
		}
		if _, err := time.Parse(time.RFC3339, envelope.GeneratedAt); err != nil {
			t.Errorf("generatedAt = %q: %v", envelope.GeneratedAt, err)
		}
		var payload visitorActivityPayload
		decodeVisitorJSON(t, envelope.Data, &payload)
		if payload.TotalContributions < 0 || payload.Streak < 0 {
			t.Errorf("negative totals: %d contributions, streak %d", payload.TotalContributions, payload.Streak)
		}
		// A real calendar is a year of columns. A handful of weeks would mean
		// the panel is back to the hand-made sample this work removed.
		if len(payload.Weeks) < 50 {
			t.Errorf("payload carries %d weeks; the calendar covers a year", len(payload.Weeks))
		}
		// The strip dates every cell from this anchor, so without it the
		// calendar could only render dateless, unpadded cells.
		if _, err := time.Parse("2006-01-02", payload.EndDate); err != nil {
			t.Errorf("endDate = %q: %v", payload.EndDate, err)
		}
		for i, week := range payload.Weeks {
			if len(week) != 7 {
				t.Errorf("week %d has %d days, want exactly 7", i, len(week))
			}
			for j, count := range week {
				if count < 0 {
					t.Errorf("week %d day %d count = %d, want >= 0", i, j, count)
				}
			}
		}
		// The contribution calendar carries no commit rows of its own, so the
		// list is either empty or a separately captured one; rows that DO
		// appear must be complete, dated, and dated BY the list's own instant
		// rather than by the calendar's, which is what commitsAt is for.
		// SHA is carried through the wire contract (issue 157 follow-up) so the
		// title link can fall back to a commit URL when no pull-request
		// reference resolves, but the embedded snapshot predates the field and
		// legitimately carries none — every row in it already resolves through
		// its own trailing "(#N)", so an empty SHA here is truthful absence,
		// never a decode fault. A NON-empty value must still be well-formed:
		// the same 40-lowercase-hex identity internal/panels validates before
		// ever building the row.
		shaPattern := regexp.MustCompile(`^[0-9a-f]{40}$`)
		var newest time.Time
		for i, commit := range payload.RecentCommits {
			if commit.Repo == "" || commit.Message == "" {
				t.Errorf("commit %d incomplete: %+v", i, commit)
			}
			if commit.SHA != "" && !shaPattern.MatchString(commit.SHA) {
				t.Errorf("commit %d sha = %q, want empty or 40 lowercase hex digits", i, commit.SHA)
			}
			at, err := time.Parse(time.RFC3339, commit.At)
			if err != nil {
				t.Errorf("commit %d at = %q: %v", i, commit.At, err)
				continue
			}
			if at.After(newest) {
				newest = at
			}
		}
		if len(payload.RecentCommits) > 0 {
			readAt, err := time.Parse(time.RFC3339, payload.CommitsAt)
			if err != nil {
				t.Errorf("commitsAt = %q: %v; a commit list that cannot date itself borrows the calendar's instant", payload.CommitsAt, err)
			} else if readAt.Before(newest) {
				t.Errorf("commitsAt %s predates the newest row it carries, %s", readAt.Format(time.RFC3339), newest.Format(time.RFC3339))
			}
		}
	})

	drainScenario(t, runResult)
}

// TestVisitorArrivesOverPlainHTTP is the not-yet-secure reader's story: they
// typed http://, the edge forwarded the plain request with its http
// declaration, and the origin answers every such navigation — the front
// page, a deep link with a query — with a permanent redirect to the same
// URL over TLS before serving a single byte of content. Landing over TLS,
// the same pages serve normally and carry the exact year-long HSTS promise;
// an operator port-forwarding straight to the pod still sees the site, with
// no promise minted for the edge-less leg. The harness asserts the
// proto-conditional security baseline on every navigation in all three
// sessions.
func TestVisitorArrivesOverPlainHTTP(t *testing.T) {
	requireBuiltFrontend(t)
	base, runResult := bootServer(t, nil)
	host := strings.TrimPrefix(base, "http://")
	insecure := testsupport.NewInsecureVisitor(t, base)
	secure := testsupport.NewVisitor(t, base)

	t.Run("every plain navigation bounces to TLS with the URL intact", func(t *testing.T) {
		visitor := insecure.On(t)
		for _, path := range []string{"/", "/blog/first-post?ref=feed"} {
			response := visitor.Navigate(path)
			if response.StatusCode != http.StatusPermanentRedirect {
				t.Fatalf("GET %s over plain http = %d, want 308", path, response.StatusCode)
			}
			if got, want := response.Header.Get("Location"), "https://"+host+path; got != want {
				t.Errorf("Location = %q, want %q — path and query must survive byte for byte", got, want)
			}
		}
	})

	t.Run("landing over TLS: normal serving plus the exact HSTS promise", func(t *testing.T) {
		shell := secure.On(t).Navigate("/")
		if shell.StatusCode != http.StatusOK {
			t.Fatalf("GET / over declared TLS = %d, want 200", shell.StatusCode)
		}
		if !bytes.Contains(shell.Body, []byte("data-static-fallback")) {
			t.Error("served document lacks the static application fallback marker")
		}
		// The harness already requires the promise on every TLS-declared
		// navigation; pinning it here keeps the story explicit.
		if got := shell.Header.Get("Strict-Transport-Security"); got != testsupport.StrictTransportSecurityPolicy {
			t.Errorf("Strict-Transport-Security = %q, want %q", got, testsupport.StrictTransportSecurityPolicy)
		}
	})

	t.Run("port-forward operator sees the site with no promise", func(t *testing.T) {
		direct := testsupport.NewDirectVisitor(t, base)
		response := direct.On(t).Navigate("/")
		if response.StatusCode != http.StatusOK {
			t.Fatalf("direct GET / = %d, want 200 — the origin must stay reachable without the edge", response.StatusCode)
		}
		// HSTS absence on the edge-less leg is enforced by the harness
		// baseline on the navigation above.
	})

	drainScenario(t, runResult)
}

// TestVisitorPlaysMedia is the future music-and-video story on the
// media-enabled boot: press play for a full 200 stream, scrub with a Range
// request for a 206, and replay from cache as a 304 — the digest ETag doing
// the browser's work.
func TestVisitorPlaysMedia(t *testing.T) {
	requireBuiltFrontend(t)
	base, runResult := bootServer(t, map[string]string{
		"MEDIA_ENABLED":        "true",
		"MEDIA_ROOT":           testsupport.MediaRoot(t),
		"MEDIA_MAX_CONCURRENT": "2",
	})
	session := testsupport.NewVisitor(t, base)
	clip := testsupport.ImmutableClipPath()

	t.Run("plays the clip: full 200 stream with its digest identity", func(t *testing.T) {
		play := session.On(t).Navigate(clip)
		if play.StatusCode != http.StatusOK || !bytes.Equal(play.Body, []byte(testsupport.MediaFileContent)) {
			t.Fatalf("GET %s = %d, %d bytes", clip, play.StatusCode, len(play.Body))
		}
		for header, want := range map[string]string{
			"Accept-Ranges": "bytes",
			"Cache-Control": "public, max-age=31536000, immutable",
			"Content-Type":  "video/mp4",
			"ETag":          `"` + testsupport.MediaDigest + `"`,
		} {
			if got := play.Header.Get(header); got != want {
				t.Errorf("%s = %q, want %q", header, got, want)
			}
		}
	})

	t.Run("seeks like a player: byte range answers 206", func(t *testing.T) {
		seek := session.On(t).Seek(clip, "bytes=2-5")
		if seek.StatusCode != http.StatusPartialContent || string(seek.Body) != "2345" {
			t.Fatalf("seek = %d %q, want 206 %q", seek.StatusCode, seek.Body, "2345")
		}
		if got := seek.Header.Get("Content-Range"); got != "bytes 2-5/10" {
			t.Errorf("Content-Range = %q", got)
		}
	})

	t.Run("replays from cache: remembered validator answers 304", func(t *testing.T) {
		replay := session.On(t).Navigate(clip)
		if replay.StatusCode != http.StatusNotModified || len(replay.Body) != 0 {
			t.Fatalf("replay = %d with %d body bytes, want an empty 304", replay.StatusCode, len(replay.Body))
		}
	})

	drainScenario(t, runResult)
}

// TestHostileVisitorStaysBlind probes the media-enabled boot the way an
// attacker's crawler would — traversal, encoded traversal, duplicate
// separators, dotfiles, and every reserved operator namespace — and requires
// each answer to be the same opaque 404 with the security baseline intact
// (asserted by the harness on every navigation).
func TestHostileVisitorStaysBlind(t *testing.T) {
	requireBuiltFrontend(t)
	base, runResult := bootServer(t, map[string]string{
		"MEDIA_ENABLED":        "true",
		"MEDIA_ROOT":           testsupport.MediaRoot(t),
		"MEDIA_MAX_CONCURRENT": "2",
	})
	session := testsupport.NewVisitor(t, base)

	probes := map[string]string{
		"path traversal":      "/media/../index.html",
		"encoded traversal":   "/media/%2e%2e/index.html",
		"duplicate separator": "//etc/passwd",
		"dotfile":             "/media/mutable/.env",
		"bare media index":    "/media/",
	}
	// Every reserved operator namespace must stay indistinguishable from a
	// missing file over the wire, not just in unit tests.
	for _, reserved := range []string{"checksums", "internal", "lost+found", "manifests", "metadata", "originals", "staging"} {
		probes["reserved namespace "+reserved] = "/media/mutable/" + reserved + "/leak.mp4"
	}

	for name, target := range probes {
		t.Run(name, func(t *testing.T) {
			response := session.On(t).Navigate(target)
			if response.StatusCode != http.StatusNotFound {
				t.Fatalf("GET %s = %d, want an opaque 404", target, response.StatusCode)
			}
			if got := strings.TrimSpace(string(response.Body)); got != "404 page not found" {
				t.Errorf("GET %s body = %q; it must stay the opaque default", target, got)
			}
		})
	}

	drainScenario(t, runResult)
}

// TestVisitorPicksAReadingMode is the reading-modes story (issue #22) over
// real transport: a first visit gets the unstamped default document, choosing
// a mode makes the very next navigation ship that theme inside the HTML —
// stamped by the origin from the cookie the toggle set, so there is nothing
// to flash — each mode carries its own cache identity, returning in a mode
// revalidates to a cheap 304, and a hostile cookie value falls back to the
// default. The harness asserts the security baseline on every navigation.
func TestVisitorPicksAReadingMode(t *testing.T) {
	requireBuiltFrontend(t)
	base, runResult := bootServer(t, nil)
	session := testsupport.NewVisitor(t, base)
	variantETags := map[string]string{}

	t.Run("first visit, no choice: the unstamped document follows the OS scheme", func(t *testing.T) {
		visitor := session.On(t)
		shell := visitor.Navigate("/")
		if shell.StatusCode != http.StatusOK {
			t.Fatalf("GET / = %d", shell.StatusCode)
		}
		if bytes.Contains(shell.Body, []byte("data-theme")) {
			t.Error("the default document must ship unstamped; prefers-color-scheme owns it")
		}
		if got := shell.Header.Get("Vary"); got != "Cookie" {
			t.Errorf("document Vary = %q, want Cookie so shared caches key stored copies per theme", got)
		}
		if got := shell.Header.Get("Cache-Control"); got != "no-cache" {
			t.Errorf("document Cache-Control = %q, want no-cache", got)
		}
		if !bytes.Contains(shell.Body, []byte("data-static-fallback")) {
			t.Error("themed serving lost the static application fallback marker")
		}
		variantETags["default"] = shell.Header.Get("ETag")
	})

	t.Run("chooses each mode: the stamped variant with its own cache identity", func(t *testing.T) {
		visitor := session.On(t)
		for _, theme := range []string{"dark", "sepia", "slate", "light"} {
			// The toggle writes the cookie; the browser replays the previous
			// variant's validator. The switch must answer a full 200 of the
			// new representation, never a 304 into the wrong colors.
			visitor.SetCookie("theme", theme)
			response := visitor.Navigate("/")
			if response.StatusCode != http.StatusOK {
				t.Fatalf("GET / with the %s cookie = %d, want 200", theme, response.StatusCode)
			}
			if stamp := []byte(`<html data-theme="` + theme + `"`); !bytes.Contains(response.Body, stamp) {
				t.Errorf("%s document lacks its stamp %q", theme, stamp)
			}
			if got := response.Header.Get("Vary"); got != "Cookie" {
				t.Errorf("%s document Vary = %q, want Cookie", theme, got)
			}
			variantETags[theme] = response.Header.Get("ETag")
		}
		holders := map[string]string{}
		for theme, etag := range variantETags {
			if etag == "" {
				t.Errorf("%s document carried no ETag", theme)
			}
			if holder, duplicate := holders[etag]; duplicate {
				t.Errorf("%s and %s share one ETag; every variant needs its own validator", theme, holder)
			}
			holders[etag] = theme
		}
	})

	t.Run("returns in the chosen mode: revalidates to an empty 304", func(t *testing.T) {
		revisit := session.On(t).Navigate("/")
		if revisit.StatusCode != http.StatusNotModified || len(revisit.Body) != 0 {
			t.Fatalf("revisit = %d with %d body bytes, want an empty 304 from the replayed validator", revisit.StatusCode, len(revisit.Body))
		}
	})

	t.Run("hostile cookie value: fails closed to the default document", func(t *testing.T) {
		visitor := session.On(t)
		visitor.SetCookie("theme", "browntown")
		response := visitor.Navigate("/")
		if response.StatusCode != http.StatusOK {
			t.Fatalf("GET / with an unregistered cookie = %d, want the full default document", response.StatusCode)
		}
		if bytes.Contains(response.Body, []byte("data-theme")) {
			t.Error("an unregistered theme value must never select a stamped variant")
		}
		if got := response.Header.Get("ETag"); got != variantETags["default"] {
			t.Errorf("fallback ETag = %q, want the default document identity %q", got, variantETags["default"])
		}
	})

	drainScenario(t, runResult)
}
