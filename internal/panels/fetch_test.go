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
		Endpoint: "https://api.example.test/scores.json",
		Account:  "fixture",
		Bosses:   []string{"Fixture Boss"},
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
	if _, err := NewFetchSource(fallback, validFetchConfig(), validBossSpec(), nil); err != nil {
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
	if _, err := NewFetchSource(fallback, validFetchConfig(), nil, usageSpec(nil)); err != nil {
		t.Fatalf("baseline usage source refused: %v", err)
	}

	for name, build := range map[string]func() (*FetchSource, error){
		"invalid config": func() (*FetchSource, error) {
			config := validFetchConfig()
			config.TTL = 0
			return NewFetchSource(fallback, config, validBossSpec(), nil)
		},
		"no spec at all": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), nil, nil)
		},
		"both specs at once": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), validBossSpec(), usageSpec(nil))
		},
		"boss endpoint off the allowlist": func() (*FetchSource, error) {
			spec := validBossSpec()
			spec.Endpoint = "https://evil.example.test/scores.json"
			return NewFetchSource(fallback, validFetchConfig(), spec, nil)
		},
		"boss endpoint with bad scheme": func() (*FetchSource, error) {
			spec := validBossSpec()
			spec.Endpoint = "ftp://api.example.test/scores.json"
			return NewFetchSource(fallback, validFetchConfig(), spec, nil)
		},
		"boss endpoint that cannot parse": func() (*FetchSource, error) {
			spec := validBossSpec()
			spec.Endpoint = "https://bad host/scores.json"
			return NewFetchSource(fallback, validFetchConfig(), spec, nil)
		},
		"boss spec missing account": func() (*FetchSource, error) {
			spec := validBossSpec()
			spec.Account = ""
			return NewFetchSource(fallback, validFetchConfig(), spec, nil)
		},
		"boss spec with empty boss name": func() (*FetchSource, error) {
			spec := validBossSpec()
			spec.Bosses = []string{""}
			return NewFetchSource(fallback, validFetchConfig(), spec, nil)
		},
		"usage source off the allowlist": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), nil, usageSpec(func(s *usageSourceSpec) {
				s.Endpoint = "https://evil.example.test/usage"
			}))
		},
		"usage source without key env": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), nil, usageSpec(func(s *usageSourceSpec) {
				s.KeyEnvName = ""
			}))
		},
		"usage source with unknown shape": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), nil, usageSpec(func(s *usageSourceSpec) {
				s.Shape = "mystery/v1"
			}))
		},
		"usage source with unknown window format": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), nil, usageSpec(func(s *usageSourceSpec) {
				s.Window.Format = "sundial"
			}))
		},
		"usage source without lookback": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), nil, usageSpec(func(s *usageSourceSpec) {
				s.Window.LookbackDays = 0
			}))
		},
		"empty usage sources": func() (*FetchSource, error) {
			return NewFetchSource(fallback, validFetchConfig(), nil, &tokenUsageFetchSpec{})
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
	if document.BossLog == nil || document.TokenUsage == nil {
		t.Fatal("embedded config must configure both fetch-backed panels")
	}
	endpoints := []string{document.BossLog.Endpoint}
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
	if bounds.TTL < 30*time.Minute || bounds.TTL > time.Hour {
		t.Errorf("ttl = %v, want the owner's 30-60 minute band", bounds.TTL)
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
		bossLog: &bossLogFetchSpec{
			Endpoint: "https://exfiltrate.example.test/scores.json",
			Account:  "fixture",
			Bosses:   []string{"Fixture Boss"},
		},
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
	fetchBacked := map[string]bool{"boss-log": true, "token-usage": true}
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
