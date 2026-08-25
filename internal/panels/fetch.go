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
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"time"
)

// The declarations below would live in types.go under this package's layout
// convention. They stay here because the egress pin outranks it: net and
// net/netip may not be imported outside this file, so a type or var mentioning
// either cannot be declared anywhere else. The narrower rule wins.

// ipResolver is the name-resolution seam. Production binds it to the standard
// resolver; tests bind it to a fake so the destination guard below can be
// driven against every hostile answer without a network.
type ipResolver func(ctx context.Context, network, host string) ([]netip.Addr, error)

// netDialer is the connect seam, with the signature http.Transport wants.
type netDialer func(ctx context.Context, network, address string) (net.Conn, error)

// httpsPort is the only port a panel fetch may ever connect to. Every
// endpoint is an https URL on an allowlisted host, so any other port means
// configuration grew a port suffix nobody reviewed.
const httpsPort = "443"

// dialTimeout and tlsHandshakeTimeout bound the two phases a per-attempt
// context alone leaves open-ended enough to be worth naming.
const (
	dialTimeout         = 5 * time.Second
	tlsHandshakeTimeout = 5 * time.Second
)

// reservedDestinationPrefixes are the address ranges no public API is ever
// reachable at, and that a hostile or hijacked DNS answer would point at to
// turn this process into a probe of its own network. netip's own predicates
// cover loopback, private, link-local, multicast, and unspecified; these are
// the ranges it has no predicate for.
//
// The cluster shapes the acceptance criteria name — Pod, Service, node, and
// control-plane addresses — are private or carrier-grade ranges in every
// deployment this repository describes, so they are refused by the private
// and CGNAT rules rather than by a list of somebody's subnets.
var reservedDestinationPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),       // "this network"
	netip.MustParsePrefix("100.64.0.0/10"),   // carrier-grade NAT
	netip.MustParsePrefix("192.0.0.0/24"),    // IETF protocol assignments
	netip.MustParsePrefix("192.0.2.0/24"),    // documentation
	netip.MustParsePrefix("198.18.0.0/15"),   // benchmarking
	netip.MustParsePrefix("198.51.100.0/24"), // documentation
	netip.MustParsePrefix("203.0.113.0/24"),  // documentation
	netip.MustParsePrefix("240.0.0.0/4"),     // reserved
	netip.MustParsePrefix("::/96"),           // IPv4-compatible IPv6
	netip.MustParsePrefix("64:ff9b::/96"),    // NAT64
	netip.MustParsePrefix("64:ff9b:1::/48"),  // local-use NAT64
	netip.MustParsePrefix("100::/64"),        // discard-only
	netip.MustParsePrefix("2001:db8::/32"),   // documentation
	netip.MustParsePrefix("2002::/16"),       // 6to4 relay
	netip.MustParsePrefix("2001::/32"),       // Teredo
}

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
func NewFetchSource(fallback SnapshotSource, config FetchConfig, specs panelFetchSpecs) (*FetchSource, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	declared := 0
	for _, present := range []bool{specs.bossLog != nil, specs.usage != nil, specs.vcs != nil} {
		if present {
			declared++
		}
	}
	if declared != 1 {
		return nil, errors.New("fetch source: exactly one panel spec is required")
	}
	if specs.bossLog != nil {
		if err := validateBossLogSpec(specs.bossLog); err != nil {
			return nil, err
		}
		if err := validateEndpoint(specs.bossLog.Endpoint, config.Hosts); err != nil {
			return nil, err
		}
		if err := validateBodyCap(specs.bossLog.MaxBytes, config.MaxBytes); err != nil {
			return nil, err
		}
	}
	if specs.usage != nil {
		if err := validateUsageSpec(specs.usage); err != nil {
			return nil, err
		}
		for _, source := range specs.usage.Sources {
			if err := validateEndpoint(source.Endpoint, config.Hosts); err != nil {
				return nil, err
			}
			if err := validateBodyCap(source.MaxBytes, config.MaxBytes); err != nil {
				return nil, err
			}
		}
	}
	if specs.vcs != nil {
		if err := validateVCSActivitySpec(specs.vcs); err != nil {
			return nil, err
		}
		if err := validateEndpoint(specs.vcs.Endpoint, config.Hosts); err != nil {
			return nil, err
		}
		if err := validateBodyCap(specs.vcs.MaxBytes, config.MaxBytes); err != nil {
			return nil, err
		}
		if commits := specs.vcs.Commits; commits != nil {
			if err := validateBodyCap(commits.MaxBytes, config.MaxBytes); err != nil {
				return nil, err
			}
			for _, source := range commits.Sources {
				if err := validateEndpoint(source.Endpoint, config.Hosts); err != nil {
					return nil, err
				}
			}
		}
	}
	return &FetchSource{
		fallback: fallback,
		config:   config,
		specs:    specs,
		gates:    make(map[string]time.Time, 3),
	}, nil
}

// validateBodyCap admits a per-endpoint byte cap. Zero means "use the shared
// cap"; anything else may only TIGHTEN it. A per-endpoint value can never
// widen the shared bound, so adding an endpoint with its own cap cannot
// loosen any other endpoint's limit.
func validateBodyCap(specMax, sharedMax int64) error {
	if specMax < 0 || specMax > sharedMax {
		return fmt.Errorf("fetch spec: max bytes must be within [0, %d]", sharedMax)
	}
	return nil
}

// validateEndpoint admits only absolute https URLs on the host allowlist.
func validateEndpoint(endpoint string, hosts []string) error {
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return fmt.Errorf("fetch endpoint %q: %w", endpoint, err)
	}
	if err := admitURL(parsed, hosts); err != nil {
		return fmt.Errorf("fetch endpoint %q: %w", endpoint, err)
	}
	return nil
}

// admitURL is the ONE admission rule every outbound URL passes, applied both
// at construction and again at request time. Three conditions, each of which
// has to hold for a request to be safe to make at all:
//
//   - https ONLY. Plain http was previously tolerated; it is not, because the
//     same allowlist governs the credential-bearing usage endpoints and a
//     cleartext hop would put a credential on the wire.
//   - NO userinfo. https://user:secret@host/path is a credential in a URL —
//     the same class of exposure — and config data is not where one belongs.
//   - The host is an exact allowlist match.
func admitURL(parsed *url.URL, hosts []string) error {
	if parsed.Scheme != "https" {
		return errors.New("scheme must be https")
	}
	if parsed.User != nil {
		return errors.New("userinfo in a fetch URL would put a credential on the wire")
	}
	if !hostAllowed(hosts, parsed.Hostname()) {
		return fmt.Errorf("host %q is not on the allowlist", parsed.Hostname())
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

// refuseRedirect is the production client's redirect policy, named so tests
// can install the EXACT policy production installs rather than a lookalike.
func refuseRedirect(*http.Request, []*http.Request) error {
	return errors.New("redirect refused: panel fetches never leave their requested host")
}

// newProductionDoer builds the one production HTTP client from the two seams
// newDoer takes: the standard resolver and a bounded standard dialer.
func newProductionDoer() fetchDoer {
	dialer := &net.Dialer{Timeout: dialTimeout, KeepAlive: 30 * time.Second}
	return newDoer(net.DefaultResolver.LookupNetIP, dialer.DialContext)
}

// newDoer builds the shipped transport. Tests call THIS function with fake
// seams rather than a lookalike client, so what they exercise is the exact
// composition production runs.
//
// Two refusals live in it, and they answer different attacks:
//
//   - Redirects are REFUSED outright. CheckRedirect errors before the
//     follow-up request is issued, so a redirecting upstream can never steer
//     the client — or a custom credential header, which Go does not strip on
//     cross-domain hops — off the host allowlist. None of the allowlisted
//     producers legitimately redirects, so refusal is the narrowest correct
//     behavior. A refused redirect is a failed attempt, and the last good
//     payload keeps serving as stale.
//   - The DESTINATION is refused unless every address the name resolves to
//     is public. The host allowlist governs a NAME, and a name is only ever
//     as trustworthy as the answer that resolves it: a hijacked or hostile
//     answer for an allowlisted host would otherwise let this process open a
//     connection to a link-local metadata service, a cluster Service, or a
//     LAN host. guardedDial closes that by checking the resolved addresses
//     and then dialing the literals it admitted.
//
// Each source's per-attempt context carries the configured timeout, so the
// client itself stays a plain transport with no timeout of its own.
func newDoer(resolve ipResolver, dial netDialer) fetchDoer {
	return &http.Client{
		Transport: &http.Transport{
			DialContext:         guardedDial(resolve, dial),
			ForceAttemptHTTP2:   true,
			TLSHandshakeTimeout: tlsHandshakeTimeout,
			DisableCompression:  false,
			MaxIdleConns:        4,
			IdleConnTimeout:     30 * time.Second,
		},
		CheckRedirect: refuseRedirect,
	}
}

// guardedDial resolves the destination once, refuses the whole attempt unless
// EVERY answer is a public address, and then connects to the admitted address
// literals. Both halves are load-bearing:
//
//   - Refusing on ANY private answer, rather than filtering the private ones
//     out, is the fail-closed direction. A rebinding answer that mixes one
//     public and one private address is an attack, not a partially usable
//     destination.
//   - Dialing the literal that was admitted, instead of handing the NAME back
//     to the dialer, removes the window between the check and the connect. A
//     second resolution could return a different answer; there is no second
//     resolution.
func guardedDial(resolve ipResolver, dial netDialer) netDialer {
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, fmt.Errorf("egress refused: %w", err)
		}
		if port != httpsPort {
			return nil, fmt.Errorf("egress refused: port %s is not the https port", port)
		}
		resolved, err := resolve(ctx, resolveNetwork(network), host)
		if err != nil {
			return nil, fmt.Errorf("egress refused: resolve: %w", err)
		}
		if len(resolved) == 0 {
			return nil, errors.New("egress refused: the destination resolved to no address")
		}
		for _, candidate := range resolved {
			if err := admitDestination(candidate); err != nil {
				return nil, err
			}
		}
		var lastErr error
		for _, candidate := range resolved {
			conn, dialErr := dial(ctx, network, net.JoinHostPort(candidate.Unmap().String(), port))
			if dialErr == nil {
				return conn, nil
			}
			lastErr = dialErr
		}
		return nil, lastErr
	}
}

// resolveNetwork maps the transport's connect network onto the resolver's
// address family names. An unrecognized network resolves both families, which
// is the conservative choice: every answer is admitted or refused anyway.
func resolveNetwork(network string) string {
	switch network {
	case "tcp4":
		return "ip4"
	case "tcp6":
		return "ip6"
	default:
		return "ip"
	}
}

// admitDestination is the ONE rule every resolved address passes. It is
// written as a refusal list over netip's own predicates plus the ranges those
// predicates do not cover, so an address is admitted only by being an ordinary
// public unicast address that no reserved prefix claims.
func admitDestination(addr netip.Addr) error {
	candidate := addr.Unmap()
	if !candidate.IsValid() {
		return errors.New("egress refused: the destination resolved to an invalid address")
	}
	switch {
	case candidate.IsUnspecified(),
		candidate.IsLoopback(),
		candidate.IsPrivate(),
		candidate.IsLinkLocalUnicast(),
		candidate.IsLinkLocalMulticast(),
		candidate.IsInterfaceLocalMulticast(),
		candidate.IsMulticast(),
		!candidate.IsGlobalUnicast():
		return fmt.Errorf("egress refused: %s is not a public destination", candidate)
	}
	for _, reserved := range reservedDestinationPrefixes {
		if reserved.Contains(candidate) {
			return fmt.Errorf("egress refused: %s sits in the reserved range %s", candidate, reserved)
		}
	}
	return nil
}

// setLogger installs the registry's logger on this source. It is called
// exactly once, by startRefresh, before any refresh loop launches; the
// mutex makes even a misuse race-safe.
func (s *FetchSource) setLogger(logger *slog.Logger) {
	if logger == nil {
		return
	}
	s.mu.Lock()
	s.logger = logger
	s.mu.Unlock()
}

// log returns this source's logger, failing closed to the discard logger so
// a source driven directly by tests — which never call setLogger — stays
// quiet without any caller having to think about it.
func (s *FetchSource) log() *slog.Logger {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.logger == nil {
		return discardLogger
	}
	return s.logger
}

// reserve admits ONE attempt against a rate-budget role and returns false
// when the role is still inside its budget. The reservation is taken up front,
// before the request is made, so an attempt costs its interval whether it
// succeeds, fails, or times out. That is deliberate: budgeting successes would
// let a failing upstream be retried at full rate, which is exactly how a
// polite client turns into a rate-limited one.
//
// A zero or negative interval means the role declares no cadence of its own
// and is governed by the refresh loop alone — the behavior every endpoint had
// before per-endpoint budgets existed. It does NOT mean the role is ungated:
// an existing reservation is still honored, because the other thing that
// writes one is the rate-limit cooldown, and a cooldown an unset config field
// could switch off would be exactly the silent security toggle this repository
// bans. Only the WRITING of a new reservation is conditional.
func (s *FetchSource) reserve(role string, now time.Time, interval time.Duration) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if next, ok := s.gates[role]; ok && now.Before(next) {
		return false
	}
	if interval <= 0 {
		return true
	}
	if s.gates == nil {
		s.gates = make(map[string]time.Time, 3)
	}
	s.gates[role] = now.Add(interval)
	return true
}

// cool pushes a role's next admissible attempt out to at least now+delay,
// never pulling it in. It is how an explicit "too many requests" answer buys
// more quiet than the ordinary cadence would.
func (s *FetchSource) cool(role string, now time.Time, delay time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.gates == nil {
		s.gates = make(map[string]time.Time, 3)
	}
	if until := now.Add(delay); s.gates[role].Before(until) {
		s.gates[role] = until
	}
}

// coolOnRateLimit applies the rate-limit cooldown when — and only when — the
// failure was the upstream saying the client is asking too often.
func (s *FetchSource) coolOnRateLimit(role string, now time.Time, err error) {
	if errors.Is(err, errUpstreamRateLimited) {
		s.cool(role, now, s.config.MaxBackoff)
	}
}

// endpointInterval resolves one spec's configured rate budget. Zero means the
// spec declares none; validation guarantees any declared value sits inside
// [minEndpointInterval, maxEndpointInterval].
func (c FetchConfig) endpointInterval(minutes int) time.Duration {
	if minutes <= 0 {
		return 0
	}
	return time.Duration(minutes) * time.Minute
}

// refresh performs one complete live refresh for this source: fetch,
// strictly validate, and map. It is called only from the background loop —
// never from a request path — and returns the payload to serve, errNothingDue
// when every endpoint is still inside its rate budget, or an error that keeps
// the last good payload serving as stale.
func (s *FetchSource) refresh(ctx context.Context, doer fetchDoer, env func(string) string) (loadedPayload, error) {
	now := time.Now().UTC()
	if s.specs.bossLog != nil {
		return s.refreshBossLog(ctx, doer, now)
	}
	if s.specs.vcs != nil {
		return s.refreshActivity(ctx, doer, now)
	}
	return s.refreshUsage(ctx, doer, env, now)
}

// refreshBossLog reads the game account's public record on its own budget.
func (s *FetchSource) refreshBossLog(ctx context.Context, doer fetchDoer, now time.Time) (loadedPayload, error) {
	spec := s.specs.bossLog
	if !s.reserve(roleBossLog, now, s.config.endpointInterval(spec.MinIntervalMinutes)) {
		return loadedPayload{}, errNothingDue
	}
	body, err := s.fetchDocument(ctx, doer, fetchRequest{
		source: roleBossLog, endpoint: spec.Endpoint, maxBytes: spec.MaxBytes, contentType: spec.ContentType,
	})
	if err != nil {
		s.coolOnRateLimit(roleBossLog, now, err)
		return loadedPayload{}, err
	}
	data, err := mapHiscores(body, spec)
	if err != nil {
		return loadedPayload{}, err
	}
	return loadedPayload{generatedAt: now.Format(time.RFC3339), data: data, status: StatusOK}, nil
}

// refreshActivity assembles the version-control panel from its TWO public
// producers, each on its own rate budget: the contribution calendar and the
// per-repository commit lists. Neither reads a credential, and neither is
// allowed to make the other lie about its freshness:
//
//   - The payload's generatedAt is the CALENDAR's fetch instant, never the
//     current clock, so a cycle that only refreshed commits cannot make the
//     calendar look newer than it is.
//   - commitsAt carries the commit list's own instant, so the older half of
//     the payload names itself instead of borrowing the other half's
//     freshness.
//   - The envelope is ok only when both halves are live. A commit list served
//     from cache past its budget, or never fetched at all, makes the payload
//     stale — which is what a reader needs to know.
//
// The calendar is read first and a failure there ends the round, because
// without a calendar there is no payload to attach commits to. That costs the
// commit half at most one loop tick rather than an outage: the failed calendar
// attempt still spent its own budget, so the next tick takes the retained
// calendar and the commits refresh normally underneath it.
func (s *FetchSource) refreshActivity(ctx context.Context, doer fetchDoer, now time.Time) (loadedPayload, error) {
	spec := s.specs.vcs
	calendar, calendarAt, calendarDue, err := s.calendarSection(ctx, doer, spec, now)
	if err != nil {
		return loadedPayload{}, err
	}
	commits, commitsAt, commitsDue, commitsFresh := s.commitSection(ctx, doer, spec.Commits, now)
	if !calendarDue && !commitsDue {
		return loadedPayload{}, errNothingDue
	}
	var payload VCSActivityData
	if err := decodeStrict(calendar, &payload); err != nil {
		return loadedPayload{}, fmt.Errorf("contribution calendar: retained payload: %w", err)
	}
	payload.RecentCommits = commits
	payload.CommitsAt = ""
	if !commitsAt.IsZero() {
		payload.CommitsAt = commitsAt.UTC().Format(time.RFC3339)
	}
	// Marshaling the package-owned payload cannot fail.
	data, _ := json.Marshal(payload)
	status := StatusOK
	if !commitsFresh {
		status = StatusStale
	}
	return loadedPayload{generatedAt: calendarAt.Format(time.RFC3339), data: data, status: status}, nil
}

// calendarSection returns the calendar payload to build from: a freshly
// fetched one when the calendar's budget admits an attempt, the retained one
// otherwise. A cycle where the calendar is not due and nothing has ever been
// fetched has nothing to build from, and says so.
func (s *FetchSource) calendarSection(ctx context.Context, doer fetchDoer, spec *vcsActivityFetchSpec, now time.Time) (json.RawMessage, time.Time, bool, error) {
	if !s.reserve(roleVCSCalendar, now, s.config.endpointInterval(spec.MinIntervalMinutes)) {
		s.mu.Lock()
		retained, at := s.calendar, s.calendarAt
		s.mu.Unlock()
		if retained == nil {
			return nil, time.Time{}, false, errNothingDue
		}
		return retained, at, false, nil
	}
	body, err := s.fetchDocument(ctx, doer, fetchRequest{
		source: roleVCSCalendar, endpoint: spec.Endpoint, headers: spec.Headers, maxBytes: spec.MaxBytes, contentType: spec.ContentType,
	})
	if err != nil {
		s.coolOnRateLimit(roleVCSCalendar, now, err)
		return nil, time.Time{}, false, err
	}
	mapped, err := mapContributions(body)
	if err != nil {
		return nil, time.Time{}, false, err
	}
	s.mu.Lock()
	s.calendar, s.calendarAt = mapped, now
	s.mu.Unlock()
	return mapped, now, true, nil
}

// commitSection returns the recent-commit rows to serve, the instant they
// were read, whether this cycle attempted them at all, and whether the list
// is live. A commit producer that is not configured serves an empty list and
// never makes the panel stale: no producer, no claim.
func (s *FetchSource) commitSection(ctx context.Context, doer fetchDoer, spec *vcsCommitsFetchSpec, now time.Time) ([]VCSCommit, time.Time, bool, bool) {
	if spec == nil {
		return []VCSCommit{}, time.Time{}, false, true
	}
	if !s.reserve(roleVCSCommits, now, s.config.endpointInterval(spec.MinIntervalMinutes)) {
		s.mu.Lock()
		retained, at := s.commits, s.commitsAt
		s.mu.Unlock()
		// Inside its budget a retained list IS the current answer, so the
		// panel stays honest and ok. A list that was never fetched is not.
		return retainedCommits(retained), at, false, !at.IsZero()
	}
	dated := make([]datedCommit, 0, len(spec.Sources)*maxCommitDocumentItems)
	complete := true
	for _, source := range spec.Sources {
		body, err := s.fetchDocument(ctx, doer, fetchRequest{
			source: roleVCSCommits, endpoint: source.Endpoint, headers: spec.Headers, maxBytes: spec.MaxBytes, contentType: spec.ContentType,
		})
		if err != nil {
			s.coolOnRateLimit(roleVCSCommits, now, err)
			complete = false
			// A failed commit document never propagates — the round degrades
			// to stale instead — so its failure is narrated HERE or nowhere.
			// The repo label is configuration data, and the error chain names
			// the host at most; no URL.
			s.log().LogAttrs(ctx, slog.LevelWarn, "commit source failed",
				slog.String("repo", source.Repo), slog.Any("error", err))
			continue
		}
		rows, err := mapCommits(body, source.Repo, now)
		if err != nil {
			complete = false
			s.log().LogAttrs(ctx, slog.LevelWarn, "commit source failed",
				slog.String("repo", source.Repo), slog.Any("error", err))
			continue
		}
		dated = append(dated, rows...)
	}
	if len(dated) == 0 {
		s.mu.Lock()
		retained, at := s.commits, s.commitsAt
		s.mu.Unlock()
		return retainedCommits(retained), at, true, false
	}
	merged := mergeCommits(dated, spec.Max)
	s.mu.Lock()
	s.commits, s.commitsAt = merged, now
	s.mu.Unlock()
	return merged, now, true, complete
}

// retainedCommits hands back a non-nil list so the payload always carries a
// JSON array rather than a null the frontend would have to special-case.
func retainedCommits(rows []VCSCommit) []VCSCommit {
	if rows == nil {
		return []VCSCommit{}
	}
	return rows
}

// refreshUsage fetches every configured usage source whose credential is
// present, merges fresh windows with snapshot fallbacks for the rest, and
// reports ok only when every source fetched. Nothing fresh at all is an
// error so the caller keeps serving the current payload.
//
// Per-source failures never propagate — the cycle degrades to stale instead
// — so each is narrated HERE at WARN, and a skipped source (credential
// unset) says so at DEBUG: without those lines, "why is this panel stale"
// is undebuggable from a cluster log. The labels are configuration data;
// error chains name a host at most, and neither a URL, a credential, nor
// the variable NAME holding one is ever logged.
func (s *FetchSource) refreshUsage(ctx context.Context, doer fetchDoer, env func(string) string, now time.Time) (loadedPayload, error) {
	logger := s.log()
	fetched := make(map[string]usageMapping, len(s.specs.usage.Sources))
	skipped, failed := 0, 0
	for _, source := range s.specs.usage.Sources {
		key := env(source.KeyEnvName)
		if key == "" {
			skipped++
			logger.LogAttrs(ctx, slog.LevelDebug, "usage source skipped: credential unset",
				slog.String("source", source.Label))
			continue
		}
		endpoint, err := withWindowParam(source.Endpoint, source.Window, now)
		if err != nil {
			failed++
			// The parse error would embed the full endpoint URL, so the
			// reason is logged as a static fact instead of the error value.
			logger.LogAttrs(ctx, slog.LevelWarn, "usage source failed: window parameter construction",
				slog.String("source", source.Label))
			continue
		}
		body, err := s.fetchDocument(ctx, doer, fetchRequest{
			source:    source.Label,
			endpoint:  endpoint,
			headers:   source.Headers,
			keyHeader: source.KeyHeader,
			keyValue:  source.KeyPrefix + key,
			maxBytes:  source.MaxBytes,
		})
		if err != nil {
			failed++
			logger.LogAttrs(ctx, slog.LevelWarn, "usage source failed",
				slog.String("source", source.Label), slog.Any("error", err))
			continue
		}
		mapped, err := mapUsage(source.Shape, body)
		if err != nil {
			failed++
			logger.LogAttrs(ctx, slog.LevelWarn, "usage source failed",
				slog.String("source", source.Label), slog.Any("error", err))
			continue
		}
		fetched[source.Label] = mapped
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
	merged, allFresh := mergeUsagePayload(s.specs.usage, fetched, fallback)
	status := StatusOK
	if !allFresh {
		status = StatusStale
	}
	logger.LogAttrs(ctx, slog.LevelDebug, "usage refresh cycle",
		slog.Int("sources_ok", len(fetched)),
		slog.Int("sources_failed", failed),
		slog.Int("sources_skipped", skipped),
		slog.Bool("fallback_used", !allFresh),
	)
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

// fetchRequest describes one bounded outbound GET. It is a struct rather than
// a parameter list because every field is a BOUND, and a bound that is easy to
// pass in the wrong position is a bound waiting to be lost.
type fetchRequest struct {
	// source names the rate-budget role or config label this attempt serves,
	// used ONLY as a log attribute — data for the narrative, never for
	// routing. It exists because the fetch layer knows the host while only
	// the caller knows which panel section asked, and a debug line is worth
	// little without both.
	source string
	// endpoint is the full request URL, re-admitted before it is used.
	endpoint string
	// headers holds the static request headers the spec declares.
	headers map[string]string
	// keyHeader names the header a credential rides in; empty means this
	// producer carries none, which is the case for every public one.
	keyHeader string
	// keyValue is that credential, read from the environment moments earlier
	// and never held anywhere else.
	keyValue string
	// maxBytes is the endpoint's own body cap; zero falls back to the shared
	// one, and a validated spec can only ever tighten it.
	maxBytes int64
	// contentType is the exact media type the answer must declare; empty
	// skips the check.
	contentType string
}

// fetchDocument performs one bounded GET through exchangeDocument and
// narrates the attempt at DEBUG — source, host, upstream status, byte count,
// duration, and the error when it failed. The host is the ONLY address fact
// a record may carry: full URLs never enter a log because the usage
// endpoints carry query parameters and configuration may embed
// account-specific paths.
func (s *FetchSource) fetchDocument(ctx context.Context, doer fetchDoer, request fetchRequest) ([]byte, error) {
	start := time.Now()
	body, status, host, err := s.exchangeDocument(ctx, doer, request)
	elapsed := float64(time.Since(start)) / float64(time.Millisecond)
	if err != nil {
		s.log().LogAttrs(ctx, slog.LevelDebug, "upstream fetch failed",
			slog.String("source", request.source),
			slog.String("host", host),
			slog.Int("status", status),
			slog.Float64("duration_ms", elapsed),
			slog.Any("error", err),
		)
		return nil, err
	}
	s.log().LogAttrs(ctx, slog.LevelDebug, "upstream fetch",
		slog.String("source", request.source),
		slog.String("host", host),
		slog.Int("status", status),
		slog.Int("bytes", len(body)),
		slog.Float64("duration_ms", elapsed),
	)
	return body, nil
}

// exchangeDocument is the uninstrumented exchange: allowlist re-checked at
// request time (defense in depth against any future spec tampering),
// per-attempt timeout, status pinned to 200, declared media type pinned to
// what the spec expects, and the body read to the endpoint's byte cap with
// one extra byte to detect overrun. The credential value goes into the
// request header and nowhere else. It reports the upstream status (0 when no
// response arrived) and the host so the caller can narrate the attempt.
func (s *FetchSource) exchangeDocument(ctx context.Context, doer fetchDoer, request fetchRequest) ([]byte, int, string, error) {
	parsed, err := url.Parse(request.endpoint)
	if err != nil {
		return nil, 0, "", fmt.Errorf("fetch: parse endpoint: %w", err)
	}
	host := parsed.Hostname()
	// Re-admitted at request time, defense in depth against any future spec
	// tampering: scheme, userinfo, and host are all checked again here.
	if err := admitURL(parsed, s.config.Hosts); err != nil {
		return nil, 0, host, fmt.Errorf("fetch refused: %w", err)
	}
	attemptCtx, cancel := context.WithTimeout(ctx, s.config.Timeout)
	defer cancel()
	outbound, err := http.NewRequestWithContext(attemptCtx, http.MethodGet, request.endpoint, nil)
	if err != nil {
		return nil, 0, host, fmt.Errorf("fetch: build request: %w", err)
	}
	limit := s.config.MaxBytes
	if request.maxBytes > 0 && request.maxBytes < limit {
		limit = request.maxBytes
	}
	outbound.Header.Set("Accept", "application/json")
	for name, value := range request.headers {
		outbound.Header.Set(name, value)
	}
	if request.keyHeader != "" {
		outbound.Header.Set(request.keyHeader, request.keyValue)
	}
	response, err := doer.Do(outbound)
	if err != nil {
		return nil, 0, host, fmt.Errorf("fetch %s: %w", parsed.Hostname(), err)
	}
	defer func() { _ = response.Body.Close() }()
	// A rate-limit refusal is separated from every other bad status because
	// the right response to it is different: back the endpoint off past the
	// ordinary cadence instead of knocking again on the next tick. HTTP says
	// it with 429, and an unauthenticated public API commonly says it with
	// 403 once a quota is spent.
	if response.StatusCode == http.StatusTooManyRequests || response.StatusCode == http.StatusForbidden {
		return nil, response.StatusCode, host, fmt.Errorf("fetch %s: status %d: %w", parsed.Hostname(), response.StatusCode, errUpstreamRateLimited)
	}
	if response.StatusCode != http.StatusOK {
		return nil, response.StatusCode, host, fmt.Errorf("fetch %s: status %d", parsed.Hostname(), response.StatusCode)
	}
	// The declared media type is checked BEFORE the body is read. An answer
	// that says it is one thing and is another is drift at best; at worst it
	// is a captive portal, an error page, or an interception proxy, and every
	// one of those parses as "no calendar in this document" further down —
	// where the reason would already be lost.
	if err := admitContentType(response.Header.Get("Content-Type"), request.contentType); err != nil {
		return nil, response.StatusCode, host, fmt.Errorf("fetch %s: %w", parsed.Hostname(), err)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, response.StatusCode, host, fmt.Errorf("fetch %s: read body: %w", parsed.Hostname(), err)
	}
	if int64(len(body)) > limit {
		return nil, response.StatusCode, host, fmt.Errorf("fetch %s: body exceeds the %d byte bound", parsed.Hostname(), limit)
	}
	return body, response.StatusCode, host, nil
}

// admitContentType compares the answer's declared media type against the one
// the spec expects, ignoring parameters (a charset is not a document type) and
// case (media types are case-insensitive). An expectation of "" skips the
// check; the shipped configuration is pinned to declare one for every endpoint
// this issue's producers own.
func admitContentType(declared, want string) error {
	if want == "" {
		return nil
	}
	media, _, _ := strings.Cut(declared, ";")
	if !strings.EqualFold(strings.TrimSpace(media), want) {
		return fmt.Errorf("content type %q, want %q", declared, want)
	}
	return nil
}
