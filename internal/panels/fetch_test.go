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
	for _, source := range document.VCSActivity.Commits.Sources {
		endpoints = append(endpoints, source.Endpoint)
	}
	if document.CodingProjects == nil {
		t.Fatal("embedded config configures no coding-projects producer")
	}
	endpoints = append(endpoints, document.CodingProjects.ListingEndpoint)
	if document.CodingProjects.PullsEndpoint != "" {
		endpoints = append(endpoints, document.CodingProjects.PullsEndpoint)
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
		"vcs-commits":     document.VCSActivity.Commits.MaxBytes,
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
	commits := document.VCSActivity.Commits
	for _, source := range commits.Sources {
		owned = append(owned, ownedEndpoint{
			"vcs-commits:" + source.Repo, hostOf(t, source.Endpoint), commits.ContentType, commits.MinIntervalMinutes,
		})
	}
	projects := document.CodingProjects
	owned = append(owned, ownedEndpoint{
		"coding-projects:listing", hostOf(t, projects.ListingEndpoint), projects.ContentType, projects.MinIntervalMinutes,
	})
	if projects.PullsEndpoint != "" {
		owned = append(owned, ownedEndpoint{
			"coding-projects:pulls", hostOf(t, projects.PullsEndpoint), projects.ContentType, projects.MinIntervalMinutes,
		})
	}
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
	graphqlPerHour := requestsPerHour(t, "authenticated calendar", calendar.AuthenticatedMinIntervalMinutes, 0)
	restPerHour := len(commits.Sources)*requestsPerHour(t, "authenticated commits", commits.AuthenticatedMinIntervalMinutes, 0) +
		requestsPerHour(t, "authenticated projects listing", projects.AuthenticatedMinIntervalMinutes, 0)
	if projects.PullsEndpoint != "" {
		restPerHour += requestsPerHour(t, "authenticated projects pulls", projects.AuthenticatedMinIntervalMinutes, 0)
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
			commits.Headers = map[string]string{header: "fixture-sentinel-eeee"}
			spec.Commits = &commits
			if _, err := NewFetchSource(fallback, bounds, panelFetchSpecs{vcs: &spec}); err == nil {
				t.Fatalf("the commit producer accepted a static %s header; credentials only travel through the attempt-time field", name)
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
			Headers:            map[string]string{"Accept": "application/json"},
			ContentType:        "application/json",
			MinIntervalMinutes: 10,
			Max:                4,
			Sources:            []vcsCommitSourceSpec{{Repo: "fixture-repo", Endpoint: "https://api.example.test/repos/fixture/commits"}},
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
		"no sources at all":            func(c *vcsCommitsFetchSpec) { c.Sources = nil },
		"a source with no repo label":  func(c *vcsCommitsFetchSpec) { c.Sources[0].Repo = "" },
		"a source with no endpoint":    func(c *vcsCommitsFetchSpec) { c.Sources[0].Endpoint = "" },
		"a source off the allowlist":   func(c *vcsCommitsFetchSpec) { c.Sources[0].Endpoint = "https://evil.example.test/commits" },
		"a source over plain http":     func(c *vcsCommitsFetchSpec) { c.Sources[0].Endpoint = "http://api.example.test/commits" },
		"a source carrying userinfo":   func(c *vcsCommitsFetchSpec) { c.Sources[0].Endpoint = "https://user@api.example.test/commits" },
		"a body cap wider than shared": func(c *vcsCommitsFetchSpec) { c.MaxBytes = validFetchConfig().MaxBytes + 1 },
		"no row cap":                   func(c *vcsCommitsFetchSpec) { c.Max = 0 },
		"a row cap past the ceiling":   func(c *vcsCommitsFetchSpec) { c.Max = maxServedCommits + 1 },
		"a cadence below the floor":    func(c *vcsCommitsFetchSpec) { c.MinIntervalMinutes = 0 - 1 },
		"a cadence past the ceiling":   func(c *vcsCommitsFetchSpec) { c.MinIntervalMinutes = int(maxEndpointInterval/time.Minute) + 1 },
		"an authenticated cadence without a credential": func(c *vcsCommitsFetchSpec) {
			c.AuthenticatedMinIntervalMinutes = 1
		},
		"a credential with no header": func(c *vcsCommitsFetchSpec) {
			c.KeyEnvName = "FIXTURE_KEY"
		},
		"an authenticated cadence below the floor": func(c *vcsCommitsFetchSpec) {
			c.KeyEnvName, c.KeyHeader = "FIXTURE_KEY", "Authorization"
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

// The measured upstream reality behind issue #185. Every figure below was
// captured from the three CONFIGURED repositories' own public commit
// documents on 2026-08-25 — 280 commits of real history, 274 three-commit
// windows — and is wire-accurate: the upstream serves compact JSON, and
// re-serializing the decoded documents reproduced the measured transfer sizes
// to within 0.4%. The bound these numbers justify is data
// (config/fetch.json), so THIS is where raising it stays a conscious edit
// with a reason, exactly as the shared bound's ratchet above is.
//
// What the measurement found, and why the answer is a raised bound rather
// than a narrowed request:
//
//   - The retired 131072 cap is genuinely outgrown, not marginally: 9 of the
//     274 windows exceed it and the worst reaches 209808 bytes, 1.60× the
//     cap. That is the intermittent degrade the issue reported.
//   - The cause is not upstream API growth. It is this platform's own
//     rich-history commit contract (median message 2417 characters, longest
//     56659) doubled by the upstream embedding the entire raw commit object
//     in its verification payload — that duplication plus the detached
//     signature is ~48% of every largest-observed entry.
//   - Narrowing the request cannot fix it. There is no field selector on the
//     list-commits API (five Accept media types were probed; all returned the
//     byte-identical 44078-byte document), the item count is already minimal
//     for what the panel serves (3 sources × per_page 3 = the 9 rows `max`
//     merges), and the arithmetic is decisive anyway: one single commit entry
//     measured 120414 bytes, so even per_page=1 would sit at 92% of the
//     retired cap with no headroom, and per_page=2's worst window (188281)
//     still exceeds it.
//   - 262144 is the smallest reviewed step that clears the measurement: zero
//     of the 274 windows reach it, it stays HALF the 524288 cap the same
//     panel's calendar endpoint already carries, and it changes no memory
//     posture — the process's worst-case transient read was already governed
//     by that larger sibling bound.
//
// Honest residual: three consecutive commits each as large as the largest
// ever observed (3 × 120414 = 361242) would still exceed 262144. That
// refusal is the fail-closed direction — the panel keeps its last good list
// and says stale — and it self-heals as the window moves.
const (
	// measuredWorstCommitWindowBytes is the largest three-commit document
	// observed across all three configured repositories.
	measuredWorstCommitWindowBytes = 209808
	// measuredWorstCommitEntryBytes is the largest SINGLE commit entry
	// observed: the reason no per_page value fits under the retired cap.
	measuredWorstCommitEntryBytes = 120414
	// retiredCommitDocumentCap is the bound issue #185 reported degrading the
	// commit source to stale. It stays named here as the refusal side of the
	// proof below: the measured document must be admitted by the shipped cap
	// and refused by this one, or the raise was cosmetic.
	retiredCommitDocumentCap = 131072
	// shippedCommitDocumentCap is the reviewed replacement config must carry.
	shippedCommitDocumentCap = 262144
	// commitSourcePageSize is the item count every configured commit endpoint
	// requests. The cap above is justified against THIS shape, so the shape is
	// pinned with it: raising per_page without re-measuring would silently
	// invalidate the bound's justification.
	commitSourcePageSize = 3
)

// TestCommitDocumentBoundMatchesTheMeasuredUpstream pins the issue #185
// decision as data: the reviewed cap, the request shape it was measured
// against, and the direction of every relationship around it.
func TestCommitDocumentBoundMatchesTheMeasuredUpstream(t *testing.T) {
	t.Parallel()
	document, bounds, err := loadFetchConfig(fetchConfigBytes)
	if err != nil {
		t.Fatalf("embedded fetch config refused: %v", err)
	}
	commits := document.VCSActivity.Commits
	if commits == nil {
		t.Fatal("embedded config configures no commit producer")
	}
	if commits.MaxBytes != shippedCommitDocumentCap {
		t.Errorf("commit document cap = %d, want the reviewed %d; changing it is a re-measurement, not an edit", commits.MaxBytes, shippedCommitDocumentCap)
	}
	// The raise stays a TIGHTENING of the shared bound, never a widening of
	// it: validateBodyCap admits a per-endpoint cap only at or below shared,
	// and the shared bound itself is untouched by issue #185.
	if commits.MaxBytes > bounds.MaxBytes {
		t.Errorf("commit cap %d exceeds the shared bound %d", commits.MaxBytes, bounds.MaxBytes)
	}
	if commits.MaxBytes > bounds.MaxBytes/2 {
		t.Errorf("commit cap %d is over half the shared bound %d; the endpoint's own limit must stay the tighter of the two", commits.MaxBytes, bounds.MaxBytes)
	}
	// Headroom over what the upstream really produces, stated as the
	// measurement rather than as a feeling.
	if commits.MaxBytes <= measuredWorstCommitWindowBytes {
		t.Errorf("commit cap %d does not clear the measured worst document %d", commits.MaxBytes, measuredWorstCommitWindowBytes)
	}
	// The request shape the cap was measured against. Both halves matter: the
	// per-source item count sets how many entries a document can carry, and
	// `max` is what the merged list serves from them.
	if len(commits.Sources) == 0 {
		t.Fatal("the commit producer configures no source")
	}
	for _, source := range commits.Sources {
		parsed, err := url.Parse(source.Endpoint)
		if err != nil {
			t.Fatalf("parse configured endpoint for %s: %v", source.Repo, err)
		}
		if got := parsed.Query().Get("per_page"); got != strconv.Itoa(commitSourcePageSize) {
			t.Errorf("source %s requests per_page=%q, want %d — the cap above is measured against that shape", source.Repo, got, commitSourcePageSize)
		}
	}
	if want := len(commits.Sources) * commitSourcePageSize; commits.Max != want {
		t.Errorf("merged commit limit = %d, want %d (%d sources × per_page %d): asking for rows the merge discards is wasted egress, and asking for fewer than it serves silently shortens the panel", commits.Max, want, len(commits.Sources), commitSourcePageSize)
	}
	// A document may still carry no more entries than the mapper's own row
	// bound, whatever configuration asks for.
	if commits.Max > maxServedCommits || commitSourcePageSize > maxCommitDocumentItems {
		t.Errorf("configured shape (max %d, per_page %d) escapes the mapper's bounds (%d served, %d per document)", commits.Max, commitSourcePageSize, maxServedCommits, maxCommitDocumentItems)
	}
}

// TestCommitDocumentCapAdmitsTheMeasuredUpstream is issue #185's regression,
// run over a real loopback socket so the bytes under test really cross a
// connection: the shipped cap admits a realistically shaped document at the
// worst size ever measured, the retired cap refuses that same document, and
// every existing refusal — one byte over, truncated, malformed — still
// refuses. Nothing here relaxes a check; the over-cap direction is asserted
// on the SHIPPED cap, so a document too large is still discarded whole and
// the panel keeps its last good list.
func TestCommitDocumentCapAdmitsTheMeasuredUpstream(t *testing.T) {
	t.Parallel()
	document, bounds, err := loadFetchConfig(fetchConfigBytes)
	if err != nil {
		t.Fatalf("embedded fetch config refused: %v", err)
	}
	shipped := document.VCSActivity.Commits.MaxBytes
	now := time.Now().UTC()
	measured := realisticCommitDocument(t, commitSourcePageSize, measuredWorstCommitWindowBytes, now)

	bodies := map[string]string{
		"/measured":  measured,
		"/lone":      realisticCommitDocument(t, 1, measuredWorstCommitEntryBytes, now),
		"/at-bound":  realisticCommitDocument(t, commitSourcePageSize, int(shipped), now),
		"/one-over":  realisticCommitDocument(t, commitSourcePageSize, int(shipped)+1, now),
		"/truncated": measured[:len(measured)/2],
		"/malformed": `[{"sha":`,
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
	// The SHARED bound is the shipped one, so every refusal below is the
	// per-endpoint cap doing the work rather than the wider limit.
	config.MaxBytes = bounds.MaxBytes
	source := &FetchSource{config: config, gates: map[string]time.Time{}}
	doer := loopbackDoer(server)
	fetch := func(path string, cap int64) ([]byte, error) {
		return source.fetchDocument(t.Context(), doer, fetchRequest{
			source:      roleVCSCommits,
			endpoint:    server.URL + path,
			headers:     map[string]string{"Accept": "application/json"},
			maxBytes:    cap,
			contentType: "application/json",
		})
	}

	t.Run("the shipped cap admits the worst document ever measured", func(t *testing.T) {
		body, err := fetch("/measured", shipped)
		if err != nil {
			t.Fatalf("the shipped cap refused a %d byte document: %v", len(measured), err)
		}
		if len(body) != measuredWorstCommitWindowBytes {
			t.Fatalf("read %d bytes, want the measured %d", len(body), measuredWorstCommitWindowBytes)
		}
		// Admission is not enough: the document must still MAP, or a cap that
		// admits bytes nothing can read would pass this test.
		rows, err := mapCommits(body, "fixture-repo", now)
		if err != nil {
			t.Fatalf("the admitted document did not map: %v", err)
		}
		if len(rows) != commitSourcePageSize {
			t.Fatalf("mapped %d rows, want %d", len(rows), commitSourcePageSize)
		}
	})

	t.Run("the retired cap refuses that same document", func(t *testing.T) {
		// The load-bearing half of the regression: restore 131072 in
		// config/fetch.json and the admission case above goes red for
		// exactly the reason issue #185 reported.
		if _, err := fetch("/measured", retiredCommitDocumentCap); err == nil {
			t.Fatal("the retired cap admitted the measured document; the raise would then be cosmetic")
		} else if !strings.Contains(err.Error(), "exceeds the") {
			t.Fatalf("error = %v, want the byte-bound refusal", err)
		}
	})

	t.Run("one measured entry already leaves the retired cap no headroom", func(t *testing.T) {
		// Why narrowing the request is not the alternative fix: a per_page=1
		// document carrying the largest entry ever observed still fits the
		// retired cap, but with so little room left that the next verbose
		// commit takes it — so no page size makes 131072 a working bound.
		body, err := fetch("/lone", retiredCommitDocumentCap)
		if err != nil {
			t.Fatalf("the retired cap refused even ONE measured entry: %v", err)
		}
		if spare := float64(retiredCommitDocumentCap-len(body)) / retiredCommitDocumentCap; spare > 0.10 {
			t.Errorf("one measured entry leaves %.1f%% spare under the retired cap; the 'even per_page=1 has no headroom' claim needs re-measuring", spare*100)
		}
		if _, err := fetch("/lone", shipped); err != nil {
			t.Fatalf("the shipped cap refused a single measured entry: %v", err)
		}
	})

	t.Run("a document exactly at the bound is admitted", func(t *testing.T) {
		if _, err := fetch("/at-bound", shipped); err != nil {
			t.Fatalf("a document at the bound was refused: %v", err)
		}
	})

	t.Run("one byte over the bound is still refused", func(t *testing.T) {
		if _, err := fetch("/one-over", shipped); err == nil {
			t.Fatal("a document over the shipped bound was admitted")
		} else if !strings.Contains(err.Error(), strconv.FormatInt(shipped, 10)) {
			t.Fatalf("error = %v, want the refusal to name the %d byte bound", err, shipped)
		}
		// And it is the ENDPOINT's cap refusing, not the shared one: the body
		// is comfortably inside the shared bound.
		if int64(len(bodies["/one-over"])) >= bounds.MaxBytes {
			t.Fatalf("the over-cap fixture is %d bytes, at or over the shared %d bound; this case would then prove the wrong refusal", len(bodies["/one-over"]), bounds.MaxBytes)
		}
	})

	for name, path := range map[string]string{
		"a truncated document": "/truncated",
		"a malformed document": "/malformed",
	} {
		t.Run(name+" is still refused by the mapper", func(t *testing.T) {
			body, err := fetch(path, shipped)
			if err != nil {
				t.Fatalf("the fetch refused an under-cap body before the mapper saw it: %v", err)
			}
			if _, err := mapCommits(body, "fixture-repo", now); err == nil {
				t.Fatalf("%s mapped; a raised byte cap may never soften what the mapper refuses", name)
			}
		})
	}
}

// realisticCommitDocument builds a commit document of an EXACT byte size with
// the upstream's real proportions. The shape matters as much as the size: the
// verification block carries a payload that repeats the whole commit message
// and a detached signature beside it, which together are about half of every
// large entry measured — a fixture with those fields null (as the mapper's
// other fixtures carry them, since they test the projection rather than the
// bound) is a document a byte cap has never had to admit.
//
// Size is hit in two passes so the padding lands where the real bytes are:
// message padding first, which costs two bytes per character because the
// payload repeats it, then a few signature characters for the remainder.
func realisticCommitDocument(t *testing.T, entries, totalBytes int, now time.Time) string {
	t.Helper()
	build := func(messagePad, signaturePad int) string {
		rows := make([]string, 0, entries)
		for index := range entries {
			sha := fmt.Sprintf("%040x", index+1)
			at := now.Add(-time.Duration(index+1) * time.Hour).Format(time.RFC3339)
			message := fmt.Sprintf("fix(panels): fixture subject %d\n\nevidence body\n%s", index+1, strings.Repeat("A", messagePad))
			// The upstream's payload is the raw commit object, message and
			// all; reproducing that duplication is the point of this fixture.
			payload := fmt.Sprintf("tree %s\nauthor Fixture Author <fixture@example.invalid>\n\n%s", sha, message)
			signature := "-----BEGIN SSH SIGNATURE-----\n" + strings.Repeat("Zm", 256)
			if index == entries-1 {
				signature += strings.Repeat("Z", signaturePad)
			}
			signature += "\n-----END SSH SIGNATURE-----"
			rows = append(rows, fmt.Sprintf(
				`{"sha":%q,"node_id":"fixture","commit":{"author":{"name":"Fixture Author","email":"fixture@example.invalid","date":%q},`+
					`"committer":{"name":"Fixture Author","email":"fixture@example.invalid","date":%q},"message":%q,`+
					`"tree":{"sha":%q,"url":"https://api.example.test/tree"},"url":"https://api.example.test/commit",`+
					`"comment_count":0,"verification":{"verified":true,"reason":"valid","signature":%q,"payload":%q}},`+
					`"url":"https://api.example.test/commit","html_url":"https://api.example.test/c","comments_url":"https://api.example.test/cc",`+
					`"author":null,"committer":null,"parents":[]}`,
				sha, at, at, message, sha, signature, payload,
			))
		}
		return "[" + strings.Join(rows, ",") + "]"
	}
	extra := totalBytes - len(build(0, 0))
	if extra < 0 {
		t.Fatalf("a %d-entry document cannot be built as small as %d bytes", entries, totalBytes)
	}
	messagePad := extra / (2 * entries)
	built := build(messagePad, extra-2*messagePad*entries)
	if len(built) != totalBytes {
		t.Fatalf("fixture is %d bytes, want exactly %d", len(built), totalBytes)
	}
	return built
}
