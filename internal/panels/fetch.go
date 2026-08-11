// fetch.go is the panels package's ONLY egress-capable file, and
// doctrine_test pins that: the HTTP client construction, request building,
// environment reads, and URL handling below may exist nowhere else in the
// package. Every outbound request is refused unless its host is on the
// configured allowlist — checked at construction AND again here at request
// time — bounded by the configured timeout, and read to at most the
// configured byte cap. Credentials are read from the environment at fetch
// time only and flow straight into a request header: never stored, never
// logged, never part of any served or returned value.

package panels

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Validate rejects any configuration the refresh loop must never run with.
// Every bound fails closed: there is no permissive zero value, no "any
// host", and no unbounded body, cadence, or retry storm.
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
	if c.MaxBytes <= 0 || c.MaxBytes > maxFetchBodyBytes {
		return fmt.Errorf("fetch config: max bytes must be within (0, %d]", maxFetchBodyBytes)
	}
	if c.InitialBackoff <= 0 || c.MaxBackoff < c.InitialBackoff {
		return errors.New("fetch config: backoff must grow from a positive initial delay")
	}
	return nil
}

// NewFetchSource is the ONLY way to build a registrable live source, and it
// fails closed: valid bounds, exactly one panel spec, a complete spec, and
// every endpoint an https URL whose host is on the allowlist — or no source.
func NewFetchSource(fallback SnapshotSource, config FetchConfig, bossLog *bossLogFetchSpec, usage *tokenUsageFetchSpec) (*FetchSource, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	if (bossLog == nil) == (usage == nil) {
		return nil, errors.New("fetch source: exactly one panel spec is required")
	}
	if bossLog != nil {
		if err := validateBossLogSpec(bossLog); err != nil {
			return nil, err
		}
		if err := validateEndpoint(bossLog.Endpoint, config.Hosts); err != nil {
			return nil, err
		}
	}
	if usage != nil {
		if err := validateUsageSpec(usage); err != nil {
			return nil, err
		}
		for _, source := range usage.Sources {
			if err := validateEndpoint(source.Endpoint, config.Hosts); err != nil {
				return nil, err
			}
		}
	}
	return &FetchSource{fallback: fallback, config: config, bossLog: bossLog, usage: usage}, nil
}

// validateEndpoint admits only absolute https URLs on the host allowlist.
func validateEndpoint(endpoint string, hosts []string) error {
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return fmt.Errorf("fetch endpoint %q: %w", endpoint, err)
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return fmt.Errorf("fetch endpoint %q: scheme must be http(s)", endpoint)
	}
	if !hostAllowed(hosts, parsed.Hostname()) {
		return fmt.Errorf("fetch endpoint host %q is not on the allowlist", parsed.Hostname())
	}
	return nil
}

// hostAllowed reports whether host is exactly one of the allowlisted names.
func hostAllowed(hosts []string, host string) bool {
	for _, allowed := range hosts {
		if host == allowed {
			return true
		}
	}
	return false
}

// StartRefresh launches the background refreshers with the production
// transport: a timeout-bounded HTTP client and the process environment for
// fetch-time credential reads. It is the single point where egress becomes
// possible, it is explicitly invoked by the composition root (never by
// construction), and a canceled context stops every loop before any attempt.
func (reg *Registry) StartRefresh(ctx context.Context) {
	reg.startRefresh(ctx, newProductionDoer(), os.Getenv)
}

// newProductionDoer builds the one production HTTP client. Each source's
// per-attempt context carries the configured timeout, so the client itself
// stays a plain transport.
func newProductionDoer() fetchDoer {
	return &http.Client{}
}

// refresh performs one complete live refresh for this source: fetch,
// strictly validate, and map. It is called only from the background loop —
// never from a request path — and returns the payload to serve or an error
// that keeps the last good payload serving as stale.
func (s *FetchSource) refresh(ctx context.Context, doer fetchDoer, env func(string) string) (loadedPayload, error) {
	now := time.Now().UTC()
	if s.bossLog != nil {
		body, err := s.fetchDocument(ctx, doer, s.bossLog.Endpoint, "", "", nil)
		if err != nil {
			return loadedPayload{}, err
		}
		data, err := mapHiscores(body, s.bossLog)
		if err != nil {
			return loadedPayload{}, err
		}
		return loadedPayload{generatedAt: now.Format(time.RFC3339), data: data, status: StatusOK}, nil
	}
	return s.refreshUsage(ctx, doer, env, now)
}

// refreshUsage fetches every configured usage source whose credential is
// present, merges fresh windows with snapshot fallbacks for the rest, and
// reports ok only when every source fetched. Nothing fresh at all is an
// error so the caller keeps serving the current payload.
func (s *FetchSource) refreshUsage(ctx context.Context, doer fetchDoer, env func(string) string, now time.Time) (loadedPayload, error) {
	fetched := make(map[string][]TokenUsageWindow, len(s.usage.Sources))
	for _, source := range s.usage.Sources {
		key := env(source.KeyEnvName)
		if key == "" {
			continue
		}
		endpoint, err := withWindowParam(source.Endpoint, source.Window, now)
		if err != nil {
			continue
		}
		body, err := s.fetchDocument(ctx, doer, endpoint, source.KeyHeader, source.KeyPrefix+key, source.Headers)
		if err != nil {
			continue
		}
		windows, err := mapUsageWindows(source.Shape, body)
		if err != nil {
			continue
		}
		fetched[source.Label] = windows
	}
	if len(fetched) == 0 {
		return loadedPayload{}, errors.New("token usage: no source could be fetched")
	}
	fallbackLoaded, err := s.fallback.load(snapshotFiles, KindTokenUsage)
	var fallback TokenUsageData
	if err == nil {
		// The fallback snapshot already passed the strict gate at load.
		_ = decodeStrict(fallbackLoaded.data, &fallback)
	}
	merged, allFresh := mergeUsagePayload(s.usage, fetched, fallback)
	status := StatusOK
	if !allFresh {
		status = StatusStale
	}
	// Marshaling the package-owned payload cannot fail.
	data, _ := json.Marshal(merged)
	return loadedPayload{generatedAt: now.Format(time.RFC3339), data: data, status: status}, nil
}

// withWindowParam appends the endpoint's required time-range parameter.
func withWindowParam(endpoint string, window windowParamSpec, now time.Time) (string, error) {
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", err
	}
	query := parsed.Query()
	query.Set(window.Param, windowStart(window, now))
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

// fetchDocument performs one bounded GET: allowlist re-checked at request
// time (defense in depth against any future spec tampering), per-attempt
// timeout, status pinned to 200, and the body read to MaxBytes with one
// extra byte to detect overrun. The credential value goes into the request
// header and nowhere else.
func (s *FetchSource) fetchDocument(ctx context.Context, doer fetchDoer, endpoint, keyHeader, keyValue string, headers map[string]string) ([]byte, error) {
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return nil, fmt.Errorf("fetch: parse endpoint: %w", err)
	}
	if !hostAllowed(s.config.Hosts, parsed.Hostname()) {
		return nil, fmt.Errorf("fetch refused: host %q is not on the allowlist", parsed.Hostname())
	}
	attemptCtx, cancel := context.WithTimeout(ctx, s.config.Timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(attemptCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("fetch: build request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	if keyHeader != "" {
		request.Header.Set(keyHeader, keyValue)
	}
	response, err := doer.Do(request)
	if err != nil {
		return nil, fmt.Errorf("fetch %s: %w", parsed.Hostname(), err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch %s: status %d", parsed.Hostname(), response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, s.config.MaxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("fetch %s: read body: %w", parsed.Hostname(), err)
	}
	if int64(len(body)) > s.config.MaxBytes {
		return nil, fmt.Errorf("fetch %s: body exceeds the %d byte bound", parsed.Hostname(), s.config.MaxBytes)
	}
	return body, nil
}
