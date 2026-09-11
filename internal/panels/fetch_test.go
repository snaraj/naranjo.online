// fetch_test proves the live-fetch contract from the refusal side: the
// configuration bounds fail closed, the constructor is the only gate into a
// registrable FetchSource and rejects every unsafe spec, the production
// host allowlist is pinned to the exact owner-approved set, and a host off
// that list is refused at runtime before a single byte leaves the process.
// Every test is hermetic: hand-written doers, and real sockets only as
// loopback httptest servers where the bound under test is the number of BYTES
// that actually cross a connection (the commit-document cap, issue #185).
package panels

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// validFetchConfig is a baseline every invalidating mutation starts from.
func validFetchConfig() FetchConfig {
	return FetchConfig{
		Hosts:          []string{"api.example.test"},
		TTL:            15 * time.Minute,
		Timeout:        10 * time.Second,
		MaxBytes:       maxFetchBodyBytes,
		InitialBackoff: time.Minute,
		MaxBackoff:     time.Hour,
	}
}

// The two fixture query documents the commit producer's specs are built from.
// They declare exactly the variables the validator requires and nothing else,
// so a test that removes one variable is testing the validator rather than a
// typo. The text is deliberately NOT the shipped query: a fixture that had to
// track production would make every config edit a test edit.
const (
	contributionsFixtureQuery = "query($from: DateTime!, $to: DateTime!) { fixture }"
	historyFixtureQuery       = "query($ids: [ID!]!, $author: ID!) { fixture }"
)

// fixtureQueryDocument wraps one of those into a complete document spec on the
// baseline config's host.
func fixtureQueryDocument(query string) *graphQLDocumentSpec {
	return &graphQLDocumentSpec{
		Endpoint:    "https://api.example.test/graphql",
		Query:       query,
		Headers:     map[string]string{"Accept": "application/json", "Content-Type": "application/json"},
		ContentType: "application/json",
	}
}

// validBossSpec is a baseline boss-log spec on the baseline config's host.
func validBossSpec() *bossLogFetchSpec {
	return &bossLogFetchSpec{
		Endpoint:          "https://api.example.test/scores.json",
		Account:           "fixture",
		ExcludeActivities: []string{"Fixture Activity"},
	}
}

// poisonedDoer fails the test the moment anything reaches for the network.
type poisonedDoer struct{ t *testing.T }

func (d poisonedDoer) Do(r *http.Request) (*http.Response, error) {
	d.t.Errorf("network transport invoked for %s; this path must never egress", r.URL)
	return nil, http.ErrHandlerTimeout
}

// countingDoer counts invocations and always errors, so callers see a
// failed fetch while the test sees exactly how many attempts were made.
type countingDoer struct{ calls atomic.Int64 }

func (d *countingDoer) Do(r *http.Request) (*http.Response, error) {
	d.calls.Add(1)
	return nil, http.ErrHandlerTimeout
}

// TestFetchConfigValidateFailsClosed drives every documented bound: the
// baseline passes, and each single unsafe field is refused.
func TestFetchConfigValidateFailsClosed(t *testing.T) {
	t.Parallel()
	if err := validFetchConfig().Validate(); err != nil {
		t.Fatalf("baseline config refused: %v", err)
	}
	for name, mutate := range map[string]func(*FetchConfig){
		"empty hosts allowlist":    func(c *FetchConfig) { c.Hosts = nil },
		"empty host entry":         func(c *FetchConfig) { c.Hosts = []string{""} },
		"host with scheme or path": func(c *FetchConfig) { c.Hosts = []string{"https://api.example.test/v1"} },
		"host with port":           func(c *FetchConfig) { c.Hosts = []string{"api.example.test:8443"} },
		"zero ttl":                 func(c *FetchConfig) { c.TTL = 0 },
		"zero timeout":             func(c *FetchConfig) { c.Timeout = 0 },
		"timeout at or above ttl":  func(c *FetchConfig) { c.Timeout = c.TTL },
		"zero max bytes":           func(c *FetchConfig) { c.MaxBytes = 0 },
		"max bytes over the cap":   func(c *FetchConfig) { c.MaxBytes = maxFetchBodyBytes + 1 },
		"zero initial backoff":     func(c *FetchConfig) { c.InitialBackoff = 0 },
		"shrinking backoff":        func(c *FetchConfig) { c.MaxBackoff = c.InitialBackoff - 1 },
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			config := validFetchConfig()
			mutate(&config)
			if err := config.Validate(); err == nil {
				t.Fatalf("Validate() accepted %+v", config)
			}
		})
	}
}

// TestNewFetchSourceFailsClosed proves the constructor is a real gate: every
// malformed or off-allowlist spec is refused, and only the complete,
// allowlisted baseline builds a source.
func TestNewFetchSourceFailsClosed(t *testing.T) {
	t.Parallel()
	fallback := SnapshotSource{Name: "snapshots/boss-log.json"}
	if _, err := NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{bossLog: validBossSpec()}); err != nil {
		t.Fatalf("baseline fetch source refused: %v", err)
	}

	usageSpec := func(mutate func(*usageSourceSpec)) *tokenUsageFetchSpec {
		source := usageSourceSpec{
			Label:      "fixture",
			Endpoint:   "https://api.example.test/usage",
			Shape:      shapeUsagePage,
			KeyEnvName: "PANEL_FIXTURE_KEY",
			KeyHeader:  "Authorization",
			KeyPrefix:  "Bearer ",
			Window:     windowParamSpec{Param: "start_time", Format: windowFormatUnix, LookbackDays: 7},
		}
		if mutate != nil {
			mutate(&source)
		}
		return &tokenUsageFetchSpec{Sources: []usageSourceSpec{source}}
	}
	if _, err := NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{usage: usageSpec(nil)}); err != nil {
		t.Fatalf("baseline usage source refused: %v", err)
	}
	if _, err := NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{
		vcs: &vcsActivityFetchSpec{
			Endpoint: "https://api.example.test/contributions",
			Headers:  map[string]string{"accept": "text/html"},
		},
	}); err != nil {
		t.Fatalf("baseline activity source refused: %v", err)
	}

	for name, build := range map[string]func() (*FetchSource, error){
		"invalid config": func() (*FetchSource, error) {
			config := validFetchConfig()
			config.TTL = 0
			return NewFetchSource(fallback, config, panelFetchSpecs{bossLog: validBossSpec()})
		},
		"no spec at all": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{})
		},
		"both specs at once": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{bossLog: validBossSpec(), usage: usageSpec(nil)})
		},
		"boss endpoint off the allowlist": func() (*FetchSource, error) {
			spec := validBossSpec()
			spec.Endpoint = "https://evil.example.test/scores.json"
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{bossLog: spec})
		},
		"boss endpoint with bad scheme": func() (*FetchSource, error) {
			spec := validBossSpec()
			spec.Endpoint = "ftp://api.example.test/scores.json"
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{bossLog: spec})
		},
		// Plain http was previously tolerated. It is not: the same allowlist
		// governs credential-bearing endpoints, so a cleartext hop would put
		// a credential on the wire.
		"boss endpoint over plain http": func() (*FetchSource, error) {
			spec := validBossSpec()
			spec.Endpoint = "http://api.example.test/scores.json"
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{bossLog: spec})
		},
		"usage endpoint over plain http": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{usage: usageSpec(func(s *usageSourceSpec) {
				s.Endpoint = "http://api.example.test/usage"
			})})
		},
		"activity endpoint over plain http": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{
				vcs: &vcsActivityFetchSpec{Endpoint: "http://api.example.test/contributions"},
			})
		},
		// A credential in a URL is a credential on the wire, and config data
		// is not where one belongs — on any of the three producers.
		"boss endpoint carrying userinfo": func() (*FetchSource, error) {
			spec := validBossSpec()
			spec.Endpoint = "https://user:fixture-sentinel-bbbb@api.example.test/scores.json"
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{bossLog: spec})
		},
		"usage endpoint carrying userinfo": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{usage: usageSpec(func(s *usageSourceSpec) {
				s.Endpoint = "https://user:fixture-sentinel-bbbb@api.example.test/usage"
			})})
		},
		"activity endpoint carrying userinfo": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{
				vcs: &vcsActivityFetchSpec{Endpoint: "https://user@api.example.test/contributions"},
			})
		},
		// The public producer's header map is not a general escape hatch: a
		// credential header on it would contradict everything this
		// repository documents about that path.
		"activity spec carrying an authorization header": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{
				vcs: &vcsActivityFetchSpec{
					Endpoint: "https://api.example.test/contributions",
					Headers:  map[string]string{"Authorization": "Bearer fixture-sentinel-cccc"},
				},
			})
		},
		"activity spec carrying a credential header in odd casing": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{
				vcs: &vcsActivityFetchSpec{
					Endpoint: "https://api.example.test/contributions",
					Headers:  map[string]string{"x-API-key": "fixture-sentinel-cccc"},
				},
			})
		},
		"boss endpoint that cannot parse": func() (*FetchSource, error) {
			spec := validBossSpec()
			spec.Endpoint = "https://bad host/scores.json"
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{bossLog: spec})
		},
		"boss spec missing account": func() (*FetchSource, error) {
			spec := validBossSpec()
			spec.Account = ""
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{bossLog: spec})
		},
		"boss spec with an empty excluded activity": func() (*FetchSource, error) {
			spec := validBossSpec()
			spec.ExcludeActivities = []string{""}
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{bossLog: spec})
		},
		"boss spec with no exclusions at all": func() (*FetchSource, error) {
			spec := validBossSpec()
			spec.ExcludeActivities = nil
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{bossLog: spec})
		},
		"boss spec whose body cap widens the shared bound": func() (*FetchSource, error) {
			spec := validBossSpec()
			spec.MaxBytes = validFetchConfig().MaxBytes + 1
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{bossLog: spec})
		},
		"usage source whose body cap widens the shared bound": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{usage: usageSpec(func(s *usageSourceSpec) {
				s.MaxBytes = validFetchConfig().MaxBytes + 1
			})})
		},
		"activity spec without an endpoint": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{vcs: &vcsActivityFetchSpec{}})
		},
		"activity endpoint off the allowlist": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{
				vcs: &vcsActivityFetchSpec{Endpoint: "https://evil.example.test/contributions"},
			})
		},
		"all three specs at once": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{
				bossLog: validBossSpec(),
				usage:   usageSpec(nil),
				vcs:     &vcsActivityFetchSpec{Endpoint: "https://api.example.test/contributions"},
			})
		},
		"usage source off the allowlist": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{usage: usageSpec(func(s *usageSourceSpec) {
				s.Endpoint = "https://evil.example.test/usage"
			})})
		},
		"usage source without key env": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{usage: usageSpec(func(s *usageSourceSpec) {
				s.KeyEnvName = ""
			})})
		},
		"usage source with unknown shape": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{usage: usageSpec(func(s *usageSourceSpec) {
				s.Shape = "mystery/v1"
			})})
		},
		"usage source with unknown window format": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{usage: usageSpec(func(s *usageSourceSpec) {
				s.Window.Format = "sundial"
			})})
		},
		"usage source without lookback": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{usage: usageSpec(func(s *usageSourceSpec) {
				s.Window.LookbackDays = 0
			})})
		},
		"usage round with an unsafe cadence": func() (*FetchSource, error) {
			spec := usageSpec(nil)
			spec.MinIntervalMinutes = -1
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{usage: spec})
		},
		"empty usage sources": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{usage: &tokenUsageFetchSpec{}})
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if source, err := build(); err == nil {
				t.Fatalf("constructor accepted an unsafe spec: %+v", source)
			}
		})
	}
}

// TestProductionHostAllowlistIsPinned pins the embedded config's outbound
// surface to the exact owner-approved set — the hiscores host, the two
// version-control hosts the zero-secret producers read, and the two usage-API
// hosts — and requires every configured endpoint to sit on it. Off-list is a
// test failure here and a runtime refusal below; the vendor hosts are
// assembled from fragments because this file lives inside the vendor-neutral
// source tree.
func TestProductionHostAllowlistIsPinned(t *testing.T) {
	t.Parallel()
	document, bounds, err := loadFetchConfig(fetchConfigBytes)
	if err != nil {
		t.Fatalf("embedded fetch config refused: %v", err)
	}
	pinned := []string{
		"secure.runescape.com",
		"git" + "hub.com",
		"api." + "git" + "hub.com",
		"api." + "anthro" + "pic" + ".com",
		"api." + "open" + "ai" + ".com",
	}
	if len(bounds.Hosts) != len(pinned) {
		t.Fatalf("allowlist = %v, want exactly the %d pinned hosts", bounds.Hosts, len(pinned))
	}
	for i, host := range pinned {
		if bounds.Hosts[i] != host {
			t.Errorf("allowlist[%d] = %q, want %q", i, bounds.Hosts[i], host)
		}
	}
	if document.BossLog == nil || document.TokenUsage == nil || document.VCSActivity == nil {
		t.Fatal("embedded config must configure every fetch-backed panel")
	}
	if document.VCSActivity.Commits == nil {
		t.Fatal("embedded config configures no commit producer; the version-control panel would report no recent commits forever, which is the defect issue #79 exists to close")
	}
	endpoints := []string{document.BossLog.Endpoint, document.VCSActivity.Endpoint}
	endpoints = append(endpoints, document.VCSActivity.Commits.Contributions.Endpoint, document.VCSActivity.Commits.History.Endpoint)
	if document.CodingProjects == nil {
		t.Fatal("embedded config configures no coding-projects producer")
	}
	endpoints = append(endpoints, document.CodingProjects.ListingEndpoint)
	if document.CodingProjects.Repositories != nil {
		endpoints = append(endpoints, document.CodingProjects.Repositories.Endpoint)
	}
	for _, source := range document.TokenUsage.Sources {
		endpoints = append(endpoints, source.Endpoint)
	}
	for _, endpoint := range endpoints {
		if err := validateEndpoint(endpoint, pinned); err != nil {
			t.Errorf("configured endpoint escapes the pinned allowlist: %v", err)
		}
	}
	if len(document.TokenUsage.Sources) != 2 {
		t.Errorf("token-usage config ships %d sources, want 2", len(document.TokenUsage.Sources))
	}
	// The other direction: a host that is NOT on the list is refused, so the
	// pin proves an allowlist rather than describing one.
	for _, rogue := range []string{
		"evil.example.test",
		"raw." + "git" + "hubusercontent.com",
		"git" + "hub.com.evil.example.test",
		"api." + "git" + "hub.com.evil.example.test",
	} {
		if hostAllowed(bounds.Hosts, rogue) {
			t.Errorf("host %q is allowed; the allowlist must be exact-match only", rogue)
		}
		if err := validateEndpoint("https://"+rogue+"/anything", bounds.Hosts); err == nil {
			t.Errorf("endpoint on %q was admitted", rogue)
		}
	}
	// An ALLOWLISTED host is still refused over plain http or with userinfo:
	// the host check is one of three conditions, not the only one.
	for name, endpoint := range map[string]string{
		"plain http on an allowlisted host": "http://" + bounds.Hosts[0] + "/anything",
		"userinfo on an allowlisted host":   "https://user:fixture-sentinel-bbbb@" + bounds.Hosts[0] + "/anything",
	} {
		if err := validateEndpoint(endpoint, bounds.Hosts); err == nil {
			t.Errorf("%s was admitted", name)
		}
	}
	// The shared read bound is a ratchet in the tightening direction only:
	// every fetched document is working data that never reaches a response,
	// and a looser bound is more memory a hostile upstream can make this
	// process hold. Raising it is a conscious edit HERE, with a reason.
	if bounds.MaxBytes > 524288 {
		t.Errorf("shared body bound = %d, over the reviewed 524288 ceiling", bounds.MaxBytes)
	}
	// The public calendar remains independently usable without a credential;
	// its static headers cannot carry one, and the optional fast path lives on
	// the dedicated credentialed spec beside it.
	if len(document.VCSActivity.Headers) == 0 {
		t.Error("the activity spec declares no document type; the upstream refuses a JSON Accept header")
	}
	// Every endpoint's body cap must be at or below the shared bound, so a
	// per-endpoint cap can only ever tighten.
	caps := map[string]int64{
		"boss-log":        document.BossLog.MaxBytes,
		"vcs-activity":    document.VCSActivity.MaxBytes,
		"vcs-commits":     document.VCSActivity.Commits.Contributions.MaxBytes,
		"vcs-history":     document.VCSActivity.Commits.History.MaxBytes,
		"coding-projects": document.CodingProjects.MaxBytes,
	}
	for _, source := range document.TokenUsage.Sources {
		caps["usage:"+source.Label] = source.MaxBytes
	}
	for name, cap := range caps {
		if cap <= 0 || cap > bounds.MaxBytes {
			t.Errorf("%s body cap = %d, want a positive value at or below the shared %d", name, cap, bounds.MaxBytes)
		}
	}
	// The owner's freshness band (issue #78): a dashboard that claims to be
	// live must refresh inside minutes, not inside an hour. The upper bound is
	// what makes the claim honest; the lower bound keeps a self-hosted origin
	// from hammering a public upstream, and the client poll in
	// frontend/src/lib/panels.ts is pinned to the same 30s-5m band from its
	// side, so the two ends of the freshness path cannot drift apart.
	if bounds.TTL < 30*time.Second || bounds.TTL > 5*time.Minute {
		t.Errorf("ttl = %v, want the owner's 30s-5m freshness band", bounds.TTL)
	}
	// The retry ladder is deliberately NOT inside that band: a failing
	// upstream must be backed off further than the healthy cadence, or a
	// broken endpoint gets retried at full rate forever.
	if bounds.InitialBackoff < bounds.TTL/10 || bounds.MaxBackoff <= bounds.TTL {
		t.Errorf("backoff ladder = %v..%v against a %v ttl; a failing upstream must back off past the healthy cadence",
			bounds.InitialBackoff, bounds.MaxBackoff, bounds.TTL)
	}
}

// ownedEndpoint is one shipped endpoint this issue's zero-secret producers
// own, reduced to the three facts every rate and schema pin below needs.
type ownedEndpoint struct {
	// what names the producer in a failure message.
	what string
	// host is the bare host the endpoint contacts.
	host string
	// contentType is the media type the answer must declare.
	contentType string
	// interval is the endpoint's declared rate budget in minutes.
	interval int
}

// ownedEndpoints reads the shipped configuration into the shape the pins
// below share: every producer that can hit a public host WITHOUT a
// credential. The public fallbacks issue #79 governs were always here;
// issue 281 added the coding-projects pair, because that producer reads
// anonymously whenever its optional credential is unset and its cadence
// therefore has to fit the unauthenticated budget too — the retired
// per-repository round sat outside this accounting at 56 requests/hour,
// which is the arithmetic behind the rate exhaustion the issue measured.
// The credentialed usage sources belong to a different issue and appear in
// the rate arithmetic through their own accounting.
func ownedEndpoints(t *testing.T, document fetchConfigDocument) []ownedEndpoint {
	t.Helper()
	if document.BossLog == nil || document.VCSActivity == nil || document.VCSActivity.Commits == nil || document.CodingProjects == nil {
		t.Fatal("the embedded config lost one of the public-capable producers")
	}
	owned := []ownedEndpoint{
		{"boss-log", hostOf(t, document.BossLog.Endpoint), document.BossLog.ContentType, document.BossLog.MinIntervalMinutes},
		{"vcs-calendar", hostOf(t, document.VCSActivity.Endpoint), document.VCSActivity.ContentType, document.VCSActivity.MinIntervalMinutes},
	}
	// The commit producer is NOT here any more, and its absence is a fact
	// about the shipped configuration rather than an omission (issue #315):
	// both of its documents ask about the credential's own account, so an
	// unset credential runs no request at all and the producer can never
	// spend the anonymous budget this arithmetic bounds. It is exactly the
	// two-request-per-round accounting the credentialed sources get.
	projects := document.CodingProjects
	owned = append(owned, ownedEndpoint{
		"coding-projects:listing", hostOf(t, projects.ListingEndpoint), projects.ContentType, projects.MinIntervalMinutes,
	})
	return owned
}

// hostOf extracts the bare host of a configured endpoint.
func hostOf(t *testing.T, endpoint string) string {
	t.Helper()
	parsed, err := url.Parse(endpoint)
	if err != nil {
		t.Fatalf("parse configured endpoint %q: %v", endpoint, err)
	}
	return parsed.Hostname()
}

// TestPublicProducerCadencesStayInsideTheRateBudget is the CADENCE pin the
// owner's ruling asked for, expressed as arithmetic over the shipped
// configuration rather than as a constant somebody has to trust.
//
// The property: for every host this origin contacts, the worst-case number of
// requests one process can make in an hour must stay at or under HALF the
// documented budget for that host. Worst case means every endpoint on that
// host firing at its declared minimum interval forever, which is exactly what
// a healthy origin does — and the retry ladder can only ever make it slower,
// because a rate reservation is taken per ATTEMPT rather than per success.
//
// Half, not all, because the budget is per IP and this process is not
// guaranteed to be the only thing behind it: a second replica, a rolling
// deploy overlapping two pods, or the owner's own browser share the same
// address. A pin at 100% would be green right up to the first duplicate.
func TestPublicProducerCadencesStayInsideTheRateBudget(t *testing.T) {
	t.Parallel()
	document, bounds, err := loadFetchConfig(fetchConfigBytes)
	if err != nil {
		t.Fatalf("embedded fetch config refused: %v", err)
	}
	// Documented hourly budgets per host. The version-control API publishes 60
	// requests per hour per IP for unauthenticated callers; the calendar
	// document is ordinary markup with no published figure, so it borrows the
	// same conservative number. The game hiscores publish no automated-polling
	// contract at all, which is exactly why issue #79 asks for SPARSE polling
	// there until one exists — hence the deliberately smaller budget.
	budgets := map[string]int{
		"api." + "git" + "hub.com":      60,
		"git" + "hub.com":               60,
		"secure.runescape.com":          20,
		"api." + "anthro" + "pic.com":   60,
		"api." + "open" + "ai" + ".com": 60,
	}
	perHour := make(map[string]int, len(budgets))
	for _, endpoint := range ownedEndpoints(t, document) {
		perHour[endpoint.host] += requestsPerHour(t, endpoint.what, endpoint.interval, bounds.TTL)
	}
	// The credentialed usage sources used to fire on the loop cadence and now
	// share one complete-round budget. They are counted anyway: the pin is
	// about what this process does to a host, not whose issue owns the endpoint.
	for _, source := range document.TokenUsage.Sources {
		perHour[hostOf(t, source.Endpoint)] += requestsPerHour(t, "usage:"+source.Label, document.TokenUsage.MinIntervalMinutes, bounds.TTL)
	}
	for host, requests := range perHour {
		budget, ok := budgets[host]
		if !ok {
			t.Errorf("host %q has no documented request budget; a cadence nobody has costed is a rate limit waiting to happen", host)
			continue
		}
		if ceiling := budget / 2; requests > ceiling {
			t.Errorf("%s takes %d requests/hour, over the %d ceiling (half of the documented %d)", host, requests, ceiling, budget)
		}
	}
	// And the other direction: a cadence so slow the panel stops being live.
	// The owner's ruling put the calendar at roughly a quarter hour, so a
	// producer that drifted past that has quietly become a snapshot.
	for _, endpoint := range ownedEndpoints(t, document) {
		if interval := time.Duration(endpoint.interval) * time.Minute; interval > 15*time.Minute {
			t.Errorf("%s refreshes every %v; a live panel refreshes inside a quarter hour", endpoint.what, interval)
		}
	}
}

// TestAuthenticatedGitHubCadencesKeepWideRateHeadroom costs the fast path
// independently from the anonymous fallbacks above. GitHub documents separate
// 5,000-unit hourly primary budgets for authenticated REST requests and
// GraphQL queries; one replica stays below ten percent of either, leaving a
// rolling second replica and unrelated owner activity ample room. The actual
// reads are serial and conditional, so this deliberately ignores the further
// savings from authorized 304 responses.
func TestAuthenticatedGitHubCadencesKeepWideRateHeadroom(t *testing.T) {
	t.Parallel()
	document, _, err := loadFetchConfig(fetchConfigBytes)
	if err != nil {
		t.Fatalf("embedded fetch config refused: %v", err)
	}
	calendar := document.VCSActivity.Calendar
	commits := document.VCSActivity.Commits
	projects := document.CodingProjects
	if calendar == nil || commits == nil || projects == nil {
		t.Fatal("the embedded config lost an authenticated GitHub producer")
	}
	for name, minutes := range map[string]int{
		"calendar": calendar.AuthenticatedMinIntervalMinutes,
		"commits":  commits.AuthenticatedMinIntervalMinutes,
		"projects": projects.AuthenticatedMinIntervalMinutes,
	} {
		if minutes <= 0 {
			t.Fatalf("%s declares no authenticated cadence", name)
		}
	}
	// The commit producer moved from REST to TWO query documents per round
	// (issue #315), and the projects producer from one REST listing to ONE
	// query document (issue #317), so both now cost the GraphQL budget rather
	// than the REST one. The arithmetic is what makes "two documents, never
	// one per repository" a pin rather than a promise: a producer that fanned
	// out per repository would multiply this figure by the roster.
	const documentsPerCommitRound = 2
	graphqlPerHour := requestsPerHour(t, "authenticated calendar", calendar.AuthenticatedMinIntervalMinutes, 0) +
		documentsPerCommitRound*requestsPerHour(t, "authenticated commits", commits.AuthenticatedMinIntervalMinutes, 0)
	restPerHour := requestsPerHour(t, "authenticated projects listing", projects.AuthenticatedMinIntervalMinutes, 0)
	if projects.Repositories != nil {
		graphqlPerHour += requestsPerHour(t, "authenticated projects query", projects.AuthenticatedMinIntervalMinutes, 0)
	}
	const tenthOfAuthenticatedBudget = 500
	if graphqlPerHour > tenthOfAuthenticatedBudget {
		t.Errorf("authenticated GraphQL path takes %d points/hour, over the %d headroom ceiling", graphqlPerHour, tenthOfAuthenticatedBudget)
	}
	if restPerHour > tenthOfAuthenticatedBudget {
		t.Errorf("authenticated REST path takes %d requests/hour, over the %d headroom ceiling", restPerHour, tenthOfAuthenticatedBudget)
	}
}

// requestsPerHour converts one endpoint's declared budget into a worst-case
// hourly request count, falling back to the loop cadence for an endpoint that
// declares none.
func requestsPerHour(t *testing.T, what string, minutes int, ttl time.Duration) int {
	t.Helper()
	interval := time.Duration(minutes) * time.Minute
	if minutes <= 0 {
		interval = ttl
	}
	if interval <= 0 {
		t.Fatalf("%s has no cadence at all", what)
	}
	return int(time.Hour / interval)
}

// TestEveryPublicProducerDeclaresItsBoundsAsData is the completeness half of
// the two bounds that are per-endpoint DATA rather than code: the declared
// media type and the rate budget. Both mechanisms skip when a spec leaves them
// unset, which is what lets hand-built test specs stay simple — so the shipped
// configuration is where "unset" has to be impossible.
func TestEveryPublicProducerDeclaresItsBoundsAsData(t *testing.T) {
	t.Parallel()
	document, _, err := loadFetchConfig(fetchConfigBytes)
	if err != nil {
		t.Fatalf("embedded fetch config refused: %v", err)
	}
	for _, endpoint := range ownedEndpoints(t, document) {
		if endpoint.contentType == "" {
			t.Errorf("%s declares no contentType: an answer that is a login page, a captive portal, or an error document would reach the parser and fail there, where the reason is already lost", endpoint.what)
		}
		if endpoint.interval <= 0 {
			t.Errorf("%s declares no minIntervalMinutes: its request rate would then be whatever the loop cadence happens to be, which is not a budget", endpoint.what)
		}
	}
	// The commit producer's row cap is a payload bound as well as a rate one:
	// the merged list has to fit the owner's panel budget beside a full year
	// of calendar weeks.
	if max := document.VCSActivity.Commits.Max; max <= 0 || max > maxServedCommits {
		t.Errorf("commit row cap = %d, want a positive value at or below %d", max, maxServedCommits)
	}
}

// TestPublicStaticHeadersCannotSmuggleACredential is the zero-secret fallback
// pin. Optional credentials travel only through dedicated fields filled from
// the environment at attempt time; the static header map remains unable to
// embed one in repository data, in any casing.
func TestPublicStaticHeadersCannotSmuggleACredential(t *testing.T) {
	t.Parallel()
	document, bounds, err := loadFetchConfig(fetchConfigBytes)
	if err != nil {
		t.Fatalf("embedded fetch config refused: %v", err)
	}
	fallback := SnapshotSource{Name: "snapshots/vcs-activity.json"}
	for name, header := range map[string]string{
		"bearer authorization": "Authorization",
		"api key":              "x-api-key",
		"odd casing":           "AUTHorization",
		"cookie":               "Cookie",
	} {
		t.Run("commit half refuses "+name, func(t *testing.T) {
			t.Parallel()
			spec := *document.VCSActivity
			commits := *spec.Commits
			doc := *commits.Contributions
			doc.Headers = map[string]string{header: "fixture-sentinel-eeee"}
			commits.Contributions = &doc
			spec.Commits = &commits
			if _, err := NewFetchSource(fallback, bounds, panelFetchSpecs{vcs: &spec}); err == nil {
				t.Fatalf("the commit producer accepted a static %s header; credentials only travel through the attempt-time field", name)
			}
		})
		t.Run("history document refuses "+name, func(t *testing.T) {
			t.Parallel()
			spec := *document.VCSActivity
			commits := *spec.Commits
			doc := *commits.History
			doc.Headers = map[string]string{header: "fixture-sentinel-eeee"}
			commits.History = &doc
			spec.Commits = &commits
			if _, err := NewFetchSource(fallback, bounds, panelFetchSpecs{vcs: &spec}); err == nil {
				t.Fatalf("the history document accepted a static %s header; credentials only travel through the attempt-time field", name)
			}
		})
		t.Run("repository query refuses "+name, func(t *testing.T) {
			t.Parallel()
			projects := *document.CodingProjects
			query := *projects.Repositories
			query.Headers = map[string]string{header: "fixture-sentinel-eeee"}
			projects.Repositories = &query
			if _, err := NewFetchSource(SnapshotSource{Name: "snapshots/coding-projects.json"}, bounds, panelFetchSpecs{projects: &projects}); err == nil {
				t.Fatalf("the repository query accepted a static %s header; credentials only travel through the attempt-time field", name)
			}
		})
	}
	// The allowlist itself stays exactly one name. Widening it is the edit
	// this pin exists to make somebody argue for.
	if len(vcsActivityHeaderAllowlist) != 1 || vcsActivityHeaderAllowlist[0] != "Accept" {
		t.Errorf("public-producer header allowlist = %v, want exactly [Accept]", vcsActivityHeaderAllowlist)
	}
}

// TestDestinationGuardRefusesEverythingButPublicUnicast drives the address
// admission rule directly over the ranges an attacker steers a client toward
// when the client trusts a NAME and not the answer behind it. Cloud metadata,
// cluster Services, LAN hosts, the loopback interface, and the whole
// documentation/benchmark/reserved space all have to be refused; ordinary
// public unicast has to be admitted, or the guard is just an outage.
func TestDestinationGuardRefusesEverythingButPublicUnicast(t *testing.T) {
	t.Parallel()
	for name, address := range map[string]string{
		"cloud metadata service":    "169.254.169.254",
		"loopback":                  "127.0.0.1",
		"loopback in another guise": "127.9.9.9",
		"ipv6 loopback":             "::1",
		"private class a":           "10.43.0.1",
		"private class b":           "172.16.5.4",
		"private class c":           "192.168.1.10",
		"unique local ipv6":         "fd00::1",
		"link local ipv6":           "fe80::1",
		"carrier grade nat":         "100.100.0.1",
		"unspecified":               "0.0.0.0",
		"unspecified ipv6":          "::",
		"this network":              "0.1.2.3",
		"multicast":                 "224.0.0.1",
		"ipv6 multicast":            "ff02::1",
		"reserved space":            "240.0.0.1",
		"benchmarking":              "198.18.0.1",
		"documentation":             "192.0.2.1",
		"ipv6 documentation":        "2001:db8::1",
		"ipv4 mapped private ipv6":  "::ffff:10.0.0.1",
		"ipv4 mapped loopback ipv6": "::ffff:127.0.0.1",
		"ipv4 mapped metadata ipv6": "::ffff:169.254.169.254",
		"6to4 relay":                "2002::1",
		"teredo":                    "2001::1",
		"nat64":                     "64:ff9b::1",
		"ietf protocol assignments": "192.0.0.1",
	} {
		t.Run("refuses "+name, func(t *testing.T) {
			t.Parallel()
			if err := admitDestination(netip.MustParseAddr(address)); err == nil {
				t.Fatalf("admitDestination(%s) admitted a non-public destination", address)
			}
		})
	}
	for name, address := range map[string]string{
		"ordinary ipv4":           "93.184.216.34",
		"ordinary ipv6":           "2606:2800:220:1:248:1893:25c8:1946",
		"ipv4 mapped public ipv6": "::ffff:93.184.216.34",
	} {
		t.Run("admits "+name, func(t *testing.T) {
			t.Parallel()
			if err := admitDestination(netip.MustParseAddr(address)); err != nil {
				t.Fatalf("admitDestination(%s) refused a public destination: %v", address, err)
			}
		})
	}
	// The zero Addr is not an address at all, and must not fall through the
	// predicate list into the admitted branch.
	if err := admitDestination(netip.Addr{}); err == nil {
		t.Error("admitDestination admitted the zero address")
	}
}

// recordingDialer records every address it is asked to connect to and always
// refuses, so a scenario can prove BOTH that a refused destination never
// reached the dialer and that an admitted one reached it as the exact literal
// the guard checked.
type recordingDialer struct {
	mu        sync.Mutex
	addresses []string
}

var errFixtureDialRefused = errors.New("fixture dialer: connect refused")

func (d *recordingDialer) dial(_ context.Context, _, address string) (net.Conn, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.addresses = append(d.addresses, address)
	return nil, errFixtureDialRefused
}

func (d *recordingDialer) seen() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]string(nil), d.addresses...)
}

// TestShippedTransportRefusesNonPublicDestinations drives the guard through
// newDoer — the SAME constructor newProductionDoer calls, with only the
// resolver and dialer replaced — so what is proven is the shipped composition
// rather than a lookalike client.
//
// The rebinding case is the one that matters most: a name that resolves to one
// public and one private address is refused OUTRIGHT rather than connected to
// on the public half, because a mixed answer is an attack and not a partially
// usable destination.
func TestShippedTransportRefusesNonPublicDestinations(t *testing.T) {
	t.Parallel()
	for name, answer := range map[string][]string{
		"a single private answer":           {"10.0.0.7"},
		"the metadata address":              {"169.254.169.254"},
		"loopback":                          {"127.0.0.1"},
		"a rebinding answer, public first":  {"93.184.216.34", "10.0.0.7"},
		"a rebinding answer, private first": {"10.0.0.7", "93.184.216.34"},
		"an ipv4-mapped private answer":     {"::ffff:192.168.0.5"},
	} {
		t.Run("refuses "+name, func(t *testing.T) {
			t.Parallel()
			dialer := &recordingDialer{}
			doer := newDoer(fixtureResolver(answer), dialer.dial)
			request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "https://fixture.example.test/document", nil)
			if err != nil {
				t.Fatalf("build request: %v", err)
			}
			if _, err := doer.Do(request); err == nil {
				t.Fatal("the transport connected to a non-public destination")
			} else if !strings.Contains(err.Error(), "egress refused") {
				t.Fatalf("error = %v, want the destination refusal", err)
			}
			if seen := dialer.seen(); len(seen) != 0 {
				t.Fatalf("the dialer was reached with %v; a refused destination must never get that far", seen)
			}
		})
	}

	t.Run("admits a public answer and dials the admitted literal", func(t *testing.T) {
		t.Parallel()
		dialer := &recordingDialer{}
		doer := newDoer(fixtureResolver([]string{"93.184.216.34"}), dialer.dial)
		request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "https://fixture.example.test/document", nil)
		if err != nil {
			t.Fatalf("build request: %v", err)
		}
		if _, err := doer.Do(request); err == nil {
			t.Fatal("the fixture dialer reported success")
		} else if strings.Contains(err.Error(), "egress refused") {
			t.Fatalf("a public destination was refused: %v", err)
		}
		// The dialer must receive the IP LITERAL the guard admitted, never the
		// name: handing the name back would leave room for a second resolution
		// to answer differently.
		want := []string{"93.184.216.34:443"}
		if seen := dialer.seen(); len(seen) != 1 || seen[0] != want[0] {
			t.Fatalf("dialed %v, want %v", seen, want)
		}
	})

	t.Run("refuses a destination that resolves to nothing", func(t *testing.T) {
		t.Parallel()
		dialer := &recordingDialer{}
		doer := newDoer(fixtureResolver(nil), dialer.dial)
		request, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, "https://fixture.example.test/document", nil)
		if _, err := doer.Do(request); err == nil || !strings.Contains(err.Error(), "egress refused") {
			t.Fatalf("error = %v, want the destination refusal", err)
		}
	})

	t.Run("refuses a port that is not the https port", func(t *testing.T) {
		t.Parallel()
		dialer := &recordingDialer{}
		doer := newDoer(fixtureResolver([]string{"93.184.216.34"}), dialer.dial)
		request, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, "https://fixture.example.test:8443/document", nil)
		if _, err := doer.Do(request); err == nil || !strings.Contains(err.Error(), "not the https port") {
			t.Fatalf("error = %v, want the port refusal", err)
		}
		if seen := dialer.seen(); len(seen) != 0 {
			t.Fatalf("the dialer was reached with %v", seen)
		}
	})
}

// fixtureResolver answers every lookup with the same fixed address list.
func fixtureResolver(addresses []string) ipResolver {
	return func(context.Context, string, string) ([]netip.Addr, error) {
		resolved := make([]netip.Addr, 0, len(addresses))
		for _, address := range addresses {
			resolved = append(resolved, netip.MustParseAddr(address))
		}
		return resolved, nil
	}
}

// TestContentTypeBoundRefusesAWrongDocumentType pins the media-type gate on
// its own. Every case carries a body the parser downstream would ACCEPT, so
// only the content-type check itself can refuse them — and an unset
// expectation still skips, which is the behavior hand-built test specs rely on.
func TestContentTypeBoundRefusesAWrongDocumentType(t *testing.T) {
	t.Parallel()
	for name, declared := range map[string]string{
		"markup where json was promised": "text/html; charset=utf-8",
		"plain text":                     "text/plain",
		"a form post answer":             "application/x-www-form-urlencoded",
		"nothing declared at all":        "",
		"a near miss":                    "application/json5",
	} {
		t.Run("refuses "+name, func(t *testing.T) {
			t.Parallel()
			if err := admitContentType(declared, "application/json"); err == nil {
				t.Fatalf("admitContentType(%q) admitted the wrong document type", declared)
			}
		})
	}
	for name, declared := range map[string]string{
		"the exact type":           "application/json",
		"with a charset parameter": "application/json; charset=utf-8",
		"in another casing":        "Application/JSON",
		"with surrounding space":   " application/json ",
	} {
		t.Run("admits "+name, func(t *testing.T) {
			t.Parallel()
			if err := admitContentType(declared, "application/json"); err != nil {
				t.Fatalf("admitContentType(%q) refused a correct document type: %v", declared, err)
			}
		})
	}
	if err := admitContentType("anything/at-all", ""); err != nil {
		t.Errorf("an unset expectation must skip the check, got %v", err)
	}
}

// TestRateBudgetAdmitsOneAttemptPerWindow proves the reservation is real and
// that it counts ATTEMPTS rather than successes: the second call inside the
// window is refused whether the first succeeded or failed, and the window has
// to elapse before another attempt is admitted.
func TestRateBudgetAdmitsOneAttemptPerWindow(t *testing.T) {
	t.Parallel()
	source := &FetchSource{config: validFetchConfig(), gates: map[string]time.Time{}}
	start := time.Date(2026, 8, 23, 12, 0, 0, 0, time.UTC)
	if !source.reserve(roleBossLog, start, 10*time.Minute) {
		t.Fatal("the first attempt was refused")
	}
	for _, elapsed := range []time.Duration{0, time.Minute, 9*time.Minute + 59*time.Second} {
		if source.reserve(roleBossLog, start.Add(elapsed), 10*time.Minute) {
			t.Errorf("an attempt %v into a 10m budget was admitted", elapsed)
		}
	}
	if !source.reserve(roleBossLog, start.Add(10*time.Minute), 10*time.Minute) {
		t.Error("the attempt after the window was refused")
	}
	// A role with no declared cadence takes no reservation of its own — the
	// behavior every endpoint had before budgets existed, and the reason
	// hand-built test specs need no cadence.
	for range 3 {
		if !source.reserve(roleVCSCommits, start, 0) {
			t.Fatal("a role with no declared cadence was refused")
		}
	}
	// But "no declared cadence" must NOT mean "ungated". The rate-limit
	// cooldown writes a reservation too, and a cooldown that an unset config
	// field could switch off would be a silent security toggle: the origin
	// would keep knocking on an upstream that has just said stop.
	source.cool(roleVCSCommits, start, time.Hour)
	if source.reserve(roleVCSCommits, start.Add(30*time.Minute), 0) {
		t.Error("a rate-limit cooldown was ignored because the role declares no cadence of its own")
	}
	if !source.reserve(roleVCSCommits, start.Add(90*time.Minute), 0) {
		t.Error("the cooldown never expired")
	}
	// A rate-limit answer buys more quiet than the ordinary cadence, and never
	// less: cooling is one-directional.
	source.cool(roleBossLog, start.Add(10*time.Minute), time.Hour)
	if source.reserve(roleBossLog, start.Add(30*time.Minute), 10*time.Minute) {
		t.Error("an attempt inside the rate-limit cooldown was admitted")
	}
	source.cool(roleBossLog, start.Add(10*time.Minute), time.Second)
	if source.reserve(roleBossLog, start.Add(30*time.Minute), 10*time.Minute) {
		t.Error("a shorter cooldown pulled the gate back in; cooling must never shorten a wait")
	}
}

// TestCommitProducerSpecFailsClosed drives the commit half's constructor gate
// the way TestNewFetchSourceFailsClosed drives the others: the complete spec
// builds, and every incomplete or out-of-band one is refused before a source
// exists to run it.
func TestCommitProducerSpecFailsClosed(t *testing.T) {
	t.Parallel()
	fallback := SnapshotSource{Name: "snapshots/vcs-activity.json"}
	base := func(mutate func(*vcsCommitsFetchSpec)) *vcsActivityFetchSpec {
		commits := vcsCommitsFetchSpec{
			Owner:              "fixture-owner",
			KeyEnvName:         "FIXTURE_KEY",
			KeyHeader:          "Authorization",
			MinIntervalMinutes: 10,
			Max:                4,
			Contributions:      fixtureQueryDocument(contributionsFixtureQuery),
			History:            fixtureQueryDocument(historyFixtureQuery),
		}
		if mutate != nil {
			mutate(&commits)
		}
		return &vcsActivityFetchSpec{
			Endpoint:           "https://api.example.test/contributions",
			Headers:            map[string]string{"Accept": "text/html"},
			ContentType:        "text/html",
			MinIntervalMinutes: 15,
			Commits:            &commits,
		}
	}
	if _, err := NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{vcs: base(nil)}); err != nil {
		t.Fatalf("the complete two-producer spec was refused: %v", err)
	}
	for name, mutate := range map[string]func(*vcsCommitsFetchSpec){
		"no discovery document at all": func(c *vcsCommitsFetchSpec) { c.Contributions = nil },
		"no history document at all":   func(c *vcsCommitsFetchSpec) { c.History = nil },
		"a document with no endpoint":  func(c *vcsCommitsFetchSpec) { c.Contributions.Endpoint = "" },
		"a document with no query":     func(c *vcsCommitsFetchSpec) { c.History.Query = "" },
		"a document with no media type": func(c *vcsCommitsFetchSpec) {
			c.Contributions.ContentType = ""
		},
		"a discovery query that drops the window start": func(c *vcsCommitsFetchSpec) {
			c.Contributions.Query = strings.ReplaceAll(contributionsFixtureQuery, calendarFromVariable, "$other")
		},
		"a discovery query that drops the window end": func(c *vcsCommitsFetchSpec) {
			c.Contributions.Query = strings.ReplaceAll(contributionsFixtureQuery, calendarToVariable, "$other")
		},
		"a history query that drops the author filter": func(c *vcsCommitsFetchSpec) {
			c.History.Query = strings.ReplaceAll(historyFixtureQuery, historyAuthorVariable, "$other")
		},
		"a history query that drops the identity list": func(c *vcsCommitsFetchSpec) {
			c.History.Query = strings.ReplaceAll(historyFixtureQuery, historyIDsVariable, "$other")
		},
		"a document off the allowlist": func(c *vcsCommitsFetchSpec) {
			c.History.Endpoint = "https://evil.example.test/graphql"
		},
		"a document over plain http": func(c *vcsCommitsFetchSpec) {
			c.Contributions.Endpoint = "http://api.example.test/graphql"
		},
		"a document carrying userinfo": func(c *vcsCommitsFetchSpec) {
			c.Contributions.Endpoint = "https://user@api.example.test/graphql"
		},
		"a body cap wider than shared": func(c *vcsCommitsFetchSpec) {
			c.History.MaxBytes = validFetchConfig().MaxBytes + 1
		},
		"no account pin":              func(c *vcsCommitsFetchSpec) { c.Owner = "" },
		"an account pin off grammar":  func(c *vcsCommitsFetchSpec) { c.Owner = "not a login" },
		"no credential at all":        func(c *vcsCommitsFetchSpec) { c.KeyEnvName = "" },
		"a credential with no header": func(c *vcsCommitsFetchSpec) { c.KeyHeader = "" },
		"no row cap":                  func(c *vcsCommitsFetchSpec) { c.Max = 0 },
		"a row cap past the ceiling":  func(c *vcsCommitsFetchSpec) { c.Max = maxServedCommits + 1 },
		"a cadence below the floor":   func(c *vcsCommitsFetchSpec) { c.MinIntervalMinutes = 0 - 1 },
		"a cadence past the ceiling":  func(c *vcsCommitsFetchSpec) { c.MinIntervalMinutes = int(maxEndpointInterval/time.Minute) + 1 },
		"an authenticated cadence below the floor": func(c *vcsCommitsFetchSpec) {
			c.AuthenticatedMinIntervalMinutes = -1
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if source, err := NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{vcs: base(mutate)}); err == nil {
				t.Fatalf("the constructor accepted an unsafe commit spec: %+v", source)
			}
		})
	}
	// The calendar half's own cadence is bounded by the same rule, so neither
	// producer can be the one that slipped through.
	for name, minutes := range map[string]int{
		"a negative calendar cadence":         -5,
		"a calendar cadence past the ceiling": int(maxEndpointInterval/time.Minute) + 1,
		"a boss cadence past the ceiling":     int(maxEndpointInterval/time.Minute) + 1,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			spec := base(nil)
			spec.MinIntervalMinutes = minutes
			if _, err := NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{vcs: spec}); err == nil {
				t.Fatal("an out-of-band cadence was accepted")
			}
			boss := validBossSpec()
			boss.MinIntervalMinutes = minutes
			if _, err := NewFetchSource(fallback, validFetchConfig(), panelFetchSpecs{bossLog: boss}); err == nil {
				t.Fatal("an out-of-band cadence was accepted on the hiscores producer")
			}
		})
	}
}

// TestResolveNetworkKeepsTheAddressFamily pins the mapping between the
// transport's connect network and the resolver's family. It matters: an ip4
// dial that resolved ip6 answers would hand the dialer addresses it cannot
// use, and the fallback for anything unrecognized has to be the WIDER family
// so every candidate is put through admission rather than skipped.
func TestResolveNetworkKeepsTheAddressFamily(t *testing.T) {
	t.Parallel()
	for network, want := range map[string]string{
		"tcp4":    "ip4",
		"tcp6":    "ip6",
		"tcp":     "ip",
		"":        "ip",
		"unknown": "ip",
	} {
		if got := resolveNetwork(network); got != want {
			t.Errorf("resolveNetwork(%q) = %q, want %q", network, got, want)
		}
	}
}

// TestRuntimeRefusesOffAllowlistHosts pins the second enforcement layer:
// even a source whose spec was tampered with after construction (built here
// by struct literal, bypassing the constructor) is refused at request time,
// before the transport is ever invoked.
func TestRuntimeRefusesOffAllowlistHosts(t *testing.T) {
	t.Parallel()
	tampered := &FetchSource{
		fallback: SnapshotSource{Name: "snapshots/boss-log.json"},
		config:   validFetchConfig(),
		specs: panelFetchSpecs{bossLog: &bossLogFetchSpec{
			Endpoint:          "https://exfiltrate.example.test/scores.json",
			Account:           "fixture",
			ExcludeActivities: []string{"Fixture Activity"},
		}},
	}
	if _, err := tampered.refresh(t.Context(), poisonedDoer{t: t}, func(string) string { return "" }); err == nil {
		t.Fatal("refresh accepted an off-allowlist host")
	} else if !strings.Contains(err.Error(), "allowlist") {
		t.Fatalf("refusal error = %v, want the allowlist refusal", err)
	}
}

// TestBuiltinFetchPanelsComeFromTheConstructor proves the production wiring
// went through the fail-closed gate: the fetch-backed builtin panels carry a
// *FetchSource (built only by NewFetchSource), the snapshot-only panel does
// not, and every fetch-backed panel still has its embedded fallback.
func TestBuiltinFetchPanelsComeFromTheConstructor(t *testing.T) {
	t.Parallel()
	fetchBacked := map[string]bool{"boss-log": true, "token-usage": true, "vcs-activity": true, "coding-projects": true}
	for _, definition := range builtinPanels {
		switch source := definition.source.(type) {
		case *FetchSource:
			if !fetchBacked[definition.id] {
				t.Errorf("panel %s is unexpectedly fetch-backed", definition.id)
			}
			if source.fallback.Name == "" {
				t.Errorf("panel %s has no snapshot fallback", definition.id)
			}
		case SnapshotSource:
			if fetchBacked[definition.id] {
				t.Errorf("panel %s lost its live source; the owner asked for fetched values with the snapshot as default only", definition.id)
			}
		default:
			t.Errorf("panel %s uses %T; only SnapshotSource and *FetchSource may serve production panels", definition.id, definition.source)
		}
	}
}

// The measured upstream reality behind the commit producer's byte caps. The
// retired figures belonged to issue #185's REST commit documents, which issue
// #315 deleted along with the per-repository endpoints that served them; these
// are the two QUERY documents that replaced them, measured against the owner's
// own account on 2026-09-11.
//
// What the measurement found:
//
//   - The discovery document answered 5,707 bytes for eight repositories over
//     the thirty-day window, and its size is bounded by structure rather than
//     by content: at most maxContributionRepositories entries, each carrying a
//     name, a flag, two identities and at most maxContributionDays small dated
//     buckets. There is no free-text field in it at all.
//   - The history document answered 12,833 bytes for seven repositories at ten
//     commits each. It DOES carry free text — one subject line per commit — so
//     its bound is what stops a pathological subject from costing memory: the
//     shipped 262144 leaves roughly two kilobytes per subject at the full
//     maxHistoryRepositories × ten shape, against a 71-character longest
//     subject measured.
//
// Both caps stay at 262144: exactly HALF the shared bound, unchanged from the
// bound the retired REST documents carried, so this producer's worst-case
// transient read did not grow when its shape changed.
const shippedQueryDocumentCap = 262144

// TestCommitQueryCapsMatchTheMeasuredUpstream pins those caps as data, with
// the direction of every relationship around them.
func TestCommitQueryCapsMatchTheMeasuredUpstream(t *testing.T) {
	t.Parallel()
	document, bounds, err := loadFetchConfig(fetchConfigBytes)
	if err != nil {
		t.Fatalf("embedded fetch config refused: %v", err)
	}
	commits := document.VCSActivity.Commits
	if commits == nil {
		t.Fatal("embedded config configures no commit producer")
	}
	if document.CodingProjects == nil || document.CodingProjects.Repositories == nil {
		t.Fatal("embedded config configures no credentialed repository document")
	}
	for what, spec := range map[string]*graphQLDocumentSpec{
		"contributions": commits.Contributions,
		"history":       commits.History,
		"repositories":  document.CodingProjects.Repositories,
	} {
		if spec.MaxBytes != shippedQueryDocumentCap {
			t.Errorf("%s document cap = %d, want the reviewed %d; changing it is a re-measurement, not an edit", what, spec.MaxBytes, shippedQueryDocumentCap)
		}
		// The cap stays a TIGHTENING of the shared bound, never a widening:
		// validateBodyCap admits a per-endpoint cap only at or below shared.
		if spec.MaxBytes > bounds.MaxBytes/2 {
			t.Errorf("%s cap %d is over half the shared bound %d; the endpoint's own limit must stay the tighter of the two", what, spec.MaxBytes, bounds.MaxBytes)
		}
	}
	// The shape the history cap is measured against: at most this many
	// repositories, at most this many commits each. Both are code bounds, and
	// the merged row cap has to fit inside their product or the producer would
	// be asking for rows the merge discards.
	if commits.Max > maxHistoryRepositories*maxCommitDocumentItems {
		t.Errorf("merged commit limit %d exceeds what %d repositories × %d rows can produce", commits.Max, maxHistoryRepositories, maxCommitDocumentItems)
	}
	if commits.Max > maxServedCommits {
		t.Errorf("configured row cap %d escapes the mapper's %d bound", commits.Max, maxServedCommits)
	}
}

// TestQueryDocumentCapRefusesAnOversizeAnswer is the byte-bound regression run
// over a real loopback socket, so the bytes under test really cross a
// connection: an answer at the cap is admitted and maps, one byte over is
// refused whole, and a truncated answer still fails the mapper rather than
// half-parsing into a quiet week.
func TestQueryDocumentCapRefusesAnOversizeAnswer(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	const bound = 8192
	atBound := historyAnswerOfSize(t, bound, now)
	bodies := map[string]string{
		"/at-bound":  atBound,
		"/one-over":  historyAnswerOfSize(t, bound+1, now),
		"/truncated": atBound[:len(atBound)/2],
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, ok := bodies[r.URL.Path]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	_, config := loopbackConfig(t, server.URL)
	source := &FetchSource{config: config, gates: map[string]time.Time{}}
	doer := loopbackDoer(server)
	fetch := func(path string) ([]byte, error) {
		return source.fetchDocument(t.Context(), doer, fetchRequest{
			source:      roleVCSCommits,
			endpoint:    server.URL + path,
			headers:     map[string]string{"Accept": "application/json"},
			maxBytes:    bound,
			contentType: "application/json",
			payload:     []byte(`{"query":"fixture"}`),
		})
	}
	repos := []contributionRepo{{id: "R_fixture", name: "fixture-repo", at: now}}

	t.Run("an answer exactly at the bound is admitted and maps", func(t *testing.T) {
		body, err := fetch("/at-bound")
		if err != nil {
			t.Fatalf("an answer at the bound was refused: %v", err)
		}
		rows, err := mapCommitHistories(body, repos, now)
		if err != nil {
			t.Fatalf("the admitted answer did not map: %v", err)
		}
		if len(rows) == 0 {
			t.Fatal("the admitted answer mapped no rows; a cap that admits bytes nothing can read would pass this test")
		}
	})

	t.Run("one byte over the bound is refused", func(t *testing.T) {
		if _, err := fetch("/one-over"); err == nil {
			t.Fatal("an answer over the bound was admitted")
		} else if !strings.Contains(err.Error(), strconv.Itoa(bound)) {
			t.Fatalf("error = %v, want the refusal to name the %d byte bound", err, bound)
		}
	})

	t.Run("a truncated answer is still refused by the mapper", func(t *testing.T) {
		body, err := fetch("/truncated")
		if err != nil {
			t.Fatalf("the fetch refused an under-cap body before the mapper saw it: %v", err)
		}
		if _, err := mapCommitHistories(body, repos, now); err == nil {
			t.Fatal("a truncated answer mapped; a byte cap may never soften what the mapper refuses")
		}
	})
}

// historyAnswerOfSize builds a history answer of an EXACT byte size with the
// upstream's real proportions: one repository, commits of forty-hex identities
// with dated subjects, the last subject padded to land on the requested total.
func historyAnswerOfSize(t *testing.T, totalBytes int, now time.Time) string {
	t.Helper()
	build := func(pad int) string {
		rows := make([]string, 0, maxCommitDocumentItems)
		for index := range maxCommitDocumentItems {
			subject := fmt.Sprintf("fix(panels): fixture subject %d", index+1)
			if index == maxCommitDocumentItems-1 {
				subject += strings.Repeat("A", pad)
			}
			rows = append(rows, fmt.Sprintf(`{"oid":%q,"messageHeadline":%q,"committedDate":%q}`,
				fmt.Sprintf("%040x", index+1), subject,
				now.Add(-time.Duration(index+1)*time.Hour).Format(time.RFC3339)))
		}
		return `{"data":{"nodes":[{"name":"fixture-repo","defaultBranchRef":{"target":{"history":{"nodes":[` +
			strings.Join(rows, ",") + `]}}}}]}}`
	}
	pad := totalBytes - len(build(0))
	if pad < 0 {
		t.Fatalf("a %d byte target is smaller than the fixture's own structure", totalBytes)
	}
	answer := build(pad)
	if len(answer) != totalBytes {
		t.Fatalf("fixture is %d bytes, want exactly %d", len(answer), totalBytes)
	}
	return answer
}
