// fetch_test proves the fetch contract stays exactly as designed: the
// configuration bounds fail closed on every unsafe value, and FetchSource is
// structurally unregistrable — it does not satisfy Source, and no builtin
// panel uses anything but a SnapshotSource.
package panels

import (
	"testing"
	"time"
)

// validFetchConfig is a baseline every invalidating mutation starts from.
func validFetchConfig() FetchConfig {
	return FetchConfig{
		Hosts:          []string{"api.example.test"},
		TTL:            15 * time.Minute,
		Timeout:        10 * time.Second,
		MaxBytes:       MaxPanelResponseBytes,
		InitialBackoff: time.Minute,
		MaxBackoff:     time.Hour,
	}
}

// TestFetchConfigValidateFailsClosed drives every documented bound: the
// baseline passes, and each single unsafe field is refused.
func TestFetchConfigValidateFailsClosed(t *testing.T) {
	t.Parallel()
	if err := validFetchConfig().Validate(); err != nil {
		t.Fatalf("baseline config refused: %v", err)
	}
	for name, mutate := range map[string]func(*FetchConfig){
		"empty hosts allowlist":     func(c *FetchConfig) { c.Hosts = nil },
		"empty host entry":          func(c *FetchConfig) { c.Hosts = []string{""} },
		"host with scheme or path":  func(c *FetchConfig) { c.Hosts = []string{"https://api.example.test/v1"} },
		"host with port":            func(c *FetchConfig) { c.Hosts = []string{"api.example.test:8443"} },
		"zero ttl":                  func(c *FetchConfig) { c.TTL = 0 },
		"zero timeout":              func(c *FetchConfig) { c.Timeout = 0 },
		"timeout at or above ttl":   func(c *FetchConfig) { c.Timeout = c.TTL },
		"zero max bytes":            func(c *FetchConfig) { c.MaxBytes = 0 },
		"max bytes over the budget": func(c *FetchConfig) { c.MaxBytes = MaxPanelResponseBytes + 1 },
		"zero initial backoff":      func(c *FetchConfig) { c.InitialBackoff = 0 },
		"shrinking backoff":         func(c *FetchConfig) { c.MaxBackoff = c.InitialBackoff - 1 },
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

// TestFetchSourceCannotBeRegistered pins the disabled state structurally:
// neither FetchSource nor its pointer satisfies Source, so the registry has
// no way to accept one until the egress decision consciously changes this —
// and every builtin panel is snapshot-fed today.
func TestFetchSourceCannotBeRegistered(t *testing.T) {
	t.Parallel()
	if _, ok := any(FetchSource{}).(Source); ok {
		t.Fatal("FetchSource satisfies Source; live fetch must stay unregistrable until the egress decision")
	}
	if _, ok := any(&FetchSource{}).(Source); ok {
		t.Fatal("*FetchSource satisfies Source; live fetch must stay unregistrable until the egress decision")
	}
	for _, definition := range builtinPanels {
		if _, ok := definition.source.(SnapshotSource); !ok {
			t.Errorf("panel %s is fed by %T; only SnapshotSource may serve production panels", definition.id, definition.source)
		}
	}
}
