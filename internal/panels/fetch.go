// fetch.go holds the pure validation logic for the FetchSource contract
// defined in types.go. There is deliberately no fetch loop, no client, and
// no dialing import anywhere in this package: live refresh stays disabled
// until the platform-lane egress decision, and this package's doctrine test
// pins the absence of egress capability in every production file.

package panels

import (
	"errors"
	"fmt"
	"strings"
)

// Validate rejects any configuration the future refresh loop must never run
// with. Every bound fails closed: there is no permissive zero value, no
// "any host", and no way to configure a payload the serving budget refuses.
func (c FetchConfig) Validate() error {
	if len(c.Hosts) == 0 {
		return errors.New("fetch config: hosts allowlist is empty")
	}
	for _, host := range c.Hosts {
		if host == "" || strings.ContainsAny(host, "/: \t") {
			return fmt.Errorf("fetch config: %q is not a bare host name", host)
		}
	}
	if c.TTL <= 0 {
		return errors.New("fetch config: ttl must be positive")
	}
	if c.Timeout <= 0 || c.Timeout >= c.TTL {
		return errors.New("fetch config: timeout must be positive and below ttl")
	}
	if c.MaxBytes <= 0 || c.MaxBytes > MaxPanelResponseBytes {
		return fmt.Errorf("fetch config: max bytes must be within (0, %d]", MaxPanelResponseBytes)
	}
	if c.InitialBackoff <= 0 || c.MaxBackoff < c.InitialBackoff {
		return errors.New("fetch config: backoff must grow from a positive initial delay")
	}
	return nil
}
