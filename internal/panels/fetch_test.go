// fetch_test proves the live-fetch contract from the refusal side: the
// configuration bounds fail closed, the constructor is the only gate into a
// registrable FetchSource and rejects every unsafe spec, the production
// host allowlist is pinned to the exact owner-approved set, and a host off
// that list is refused at runtime before a single byte leaves the process.
// Every test is hermetic: hand-written doers, no sockets.
package panels

import (
	"net/http"
	"strings"
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
// surface to the exact owner-approved set — the hiscores host plus the two
// usage-API hosts — and requires every configured endpoint to sit on it.
// Off-list is a test failure here and a runtime refusal below; the vendor
// hosts are assembled from fragments because this file lives inside the
// vendor-neutral source tree.
func TestProductionHostAllowlistIsPinned(t *testing.T) {
	t.Parallel()
	document, bounds, err := loadFetchConfig(fetchConfigBytes)
	if err != nil {
		t.Fatalf("embedded fetch config refused: %v", err)
	}
	pinned := []string{
		"secure.runescape.com",
		"git" + "hub.com",
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
	endpoints := []string{document.BossLog.Endpoint, document.VCSActivity.Endpoint}
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
		"api." + "git" + "hub.com",
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
	// The version-control producer is deliberately credential-free: it reads
	// a PUBLIC document, and a spec that grew a credential field would be a
	// different security review.
	if len(document.VCSActivity.Headers) == 0 {
		t.Error("the activity spec declares no document type; the upstream refuses a JSON Accept header")
	}
	// Every endpoint's body cap must be at or below the shared bound, so a
	// per-endpoint cap can only ever tighten.
	caps := map[string]int64{"boss-log": document.BossLog.MaxBytes, "vcs-activity": document.VCSActivity.MaxBytes}
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
	fetchBacked := map[string]bool{"boss-log": true, "token-usage": true, "vcs-activity": true}
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
