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
	"bytes"
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
	for _, present := range []bool{specs.bossLog != nil, specs.usage != nil, specs.vcs != nil, specs.projects != nil} {
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
		if calendar := specs.vcs.Calendar; calendar != nil {
			if err := validateEndpoint(calendar.Endpoint, config.Hosts); err != nil {
				return nil, err
			}
			if err := validateBodyCap(calendar.MaxBytes, config.MaxBytes); err != nil {
				return nil, err
			}
		}
	}
	if specs.projects != nil {
		if err := validateCodingProjectsSpec(specs.projects); err != nil {
			return nil, err
		}
		if err := validateBodyCap(specs.projects.MaxBytes, config.MaxBytes); err != nil {
			return nil, err
		}
		if err := validateEndpoint(specs.projects.ListingEndpoint, config.Hosts); err != nil {
			return nil, err
		}
		// The tally document is a second reachable URL and gets the identical
		// construction-time host check, because "optional" is about whether it
		// is configured, never about whether it is checked.
		if specs.projects.PullsEndpoint != "" {
			if err := validateEndpoint(specs.projects.PullsEndpoint, config.Hosts); err != nil {
				return nil, err
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

// transportErrorCause strips every *url.Error layer from err before it can
// be wrapped into a returned fetch error. net/http's client wraps DNS, TLS,
// dial, timeout, and redirect failures in *url.Error — and url.Parse and
// http.NewRequestWithContext wrap parse failures the same way — whose
// Error() string embeds the COMPLETE request URL, query included. The
// shipped configuration carries account-specific paths and the usage
// endpoints append query parameters, so a raw transport error reaching a
// log would be a disclosure path (Daybreak finding, PR #184 round 1).
// Sanitizing HERE, at the error-construction boundary, means every wrapped
// fetch error's public string carries at most a host, a status, and a
// stable reason — and every downstream log site (per-source WARNs, the
// refresh loop's panel WARN, the per-attempt DEBUG) inherits that
// guarantee instead of each having to re-prove it. The retained cause is
// the transport's own reason (context deadline, refused redirect, egress
// refusal, connection reset), which is exactly the debugging signal; only
// the URL-bearing wrapper is dropped, and errors.Is/As over the cause
// chain keeps working because the cause itself is returned unmodified.
func transportErrorCause(err error) error {
	for {
		wrapped, ok := err.(*url.Error)
		if !ok {
			return err
		}
		if wrapped.Err == nil {
			// A url.Error with no cause has only URL-bearing content; the
			// operation name is the one safe fact it carries.
			return errors.New(wrapped.Op + ": request failed")
		}
		err = wrapped.Err
	}
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
// failure was the upstream saying the client is asking too often. The
// cooldown is NARRATED at warn (issue 281, defect 3): it silences a role for
// the full backoff ceiling, every wake inside it reports only a debug idle
// line, and the morning the owner measured a two-day-stale card that silence
// was exactly what made "why is this panel stale" unanswerable from a
// cluster log. The role name is this package's own constant and the instant
// is arithmetic; no URL, credential, or upstream byte is logged.
func (s *FetchSource) coolOnRateLimit(ctx context.Context, role string, now time.Time, err error) {
	if !errors.Is(err, errUpstreamRateLimited) {
		return
	}
	s.cool(role, now, s.config.MaxBackoff)
	s.log().LogAttrs(ctx, slog.LevelWarn, "source cooling down: the upstream refused for rate reasons",
		slog.String("source", role),
		slog.Time("until", now.Add(s.config.MaxBackoff)),
	)
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

// endpointIntervalForCredential selects a fast budget only when the value
// that buys its authenticated rate headroom is present for THIS attempt. An
// absent or rotated-away key therefore falls back to the public interval
// before a reservation is taken; it can never spend the fast budget on an
// anonymous request.
func (c FetchConfig) endpointIntervalForCredential(publicMinutes, authenticatedMinutes int, credential string) time.Duration {
	if credential != "" && authenticatedMinutes > 0 {
		return c.endpointInterval(authenticatedMinutes)
	}
	return c.endpointInterval(publicMinutes)
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
		return s.refreshActivity(ctx, doer, env, now)
	}
	if s.specs.projects != nil {
		return s.refreshProjects(ctx, doer, env, now)
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
		conditional: true,
	})
	if err != nil {
		s.coolOnRateLimit(ctx, roleBossLog, now, err)
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
func (s *FetchSource) refreshActivity(ctx context.Context, doer fetchDoer, env func(string) string, now time.Time) (loadedPayload, error) {
	spec := s.specs.vcs
	calendar, calendarAt, calendarDue, err := s.calendarSection(ctx, doer, env, spec, now)
	if err != nil {
		return loadedPayload{}, err
	}
	commits, commitsAt, commitsDue, commitsFresh := s.commitSection(ctx, doer, env, spec.Commits, now)
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
func (s *FetchSource) calendarSection(ctx context.Context, doer fetchDoer, env func(string) string, spec *vcsActivityFetchSpec, now time.Time) (json.RawMessage, time.Time, bool, error) {
	credential := ""
	authenticatedMinutes := 0
	if spec.Calendar != nil {
		credential = env(spec.Calendar.KeyEnvName)
		authenticatedMinutes = spec.Calendar.AuthenticatedMinIntervalMinutes
	}
	interval := s.config.endpointIntervalForCredential(spec.MinIntervalMinutes, authenticatedMinutes, credential)
	if !s.reserve(roleVCSCalendar, now, interval) {
		s.mu.Lock()
		retained, at := s.calendar, s.calendarAt
		s.mu.Unlock()
		if retained == nil {
			return nil, time.Time{}, false, errNothingDue
		}
		return retained, at, false, nil
	}
	mapped, err := s.readCalendar(ctx, doer, credential, spec, now)
	if err != nil {
		s.coolOnRateLimit(ctx, roleVCSCalendar, now, err)
		return nil, time.Time{}, false, err
	}
	s.mu.Lock()
	s.calendar, s.calendarAt = mapped, now
	s.mu.Unlock()
	return mapped, now, true, nil
}

// readCalendar picks THE calendar producer for this round and maps its answer.
//
// Exactly one producer runs per round, and which one is a CONFIGURATION fact
// rather than a race: the credentialed producer when its variable is set, the
// public document otherwise. Three consequences are deliberate.
//
//   - An unset credential is not a failure. It is the deployment saying it has
//     no token, which is the state this repository ships in and the state it
//     must stay honest in, so the public document answers and the payload
//     records the narrower coverage rather than pretending to the wider one.
//   - A credentialed FAILURE does not silently fall through to the public
//     document. Falling through would answer a transient fault by quietly
//     switching the panel to a figure four hundred contributions smaller, with
//     nothing on the page to say why — and would double the round's request
//     count exactly when the upstream is already unhappy. The round fails, the
//     retained calendar keeps serving as stale, and the next round tries
//     again: the same treatment every other producer's failure gets.
//   - The credential was read once by calendarSection immediately before its
//     rate reservation, and arrives here only as a local string. That binds
//     the fast cadence to the same value the request actually sends. It is
//     never stored on the source, logged, or part of any served value.
func (s *FetchSource) readCalendar(ctx context.Context, doer fetchDoer, credential string, spec *vcsActivityFetchSpec, now time.Time) (json.RawMessage, error) {
	if credentialed := spec.Calendar; credentialed != nil {
		if credential != "" {
			payload, err := calendarRequestBody(credentialed.Query, now)
			if err != nil {
				return nil, err
			}
			body, err := s.fetchDocument(ctx, doer, fetchRequest{
				source:      roleVCSCalendar,
				endpoint:    credentialed.Endpoint,
				headers:     credentialed.Headers,
				keyHeader:   credentialed.KeyHeader,
				keyValue:    credentialed.KeyPrefix + credential,
				maxBytes:    credentialed.MaxBytes,
				contentType: credentialed.ContentType,
				payload:     payload,
			})
			if err != nil {
				return nil, err
			}
			return mapCalendarDocument(body, now)
		}
		// The variable NAME is config data and the value is absent, so there
		// is nothing here that could leak; what a cluster log needs is the
		// reason this panel reports the narrower figure.
		s.log().LogAttrs(ctx, slog.LevelDebug, "calendar producer skipped: credential unset; serving the public coverage")
	}
	body, err := s.fetchDocument(ctx, doer, fetchRequest{
		source: roleVCSCalendar, endpoint: spec.Endpoint, headers: spec.Headers, maxBytes: spec.MaxBytes, contentType: spec.ContentType,
		conditional: true,
	})
	if err != nil {
		return nil, err
	}
	return mapContributions(body)
}

// calendarQueryRequest is the request body posted to the credentialed
// producer: the configured query document plus the window this package
// computed. It is a package-owned struct so the body's shape is fixed in Go
// and config supplies only the query text.
type calendarQueryRequest struct {
	Query     string                 `json:"query"`
	Variables calendarQueryVariables `json:"variables"`
}

// calendarQueryVariables carries the window the query asks over.
type calendarQueryVariables struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// calendarRequestBody builds that body for one round. The window ends now and
// begins on the Sunday on or before calendarWindowDays ago — see that
// constant for why the alignment is load-bearing rather than tidy.
func calendarRequestBody(query string, now time.Time) ([]byte, error) {
	to := now.UTC()
	start := to.AddDate(0, 0, -calendarWindowDays)
	from := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC).
		AddDate(0, 0, -int(start.Weekday()))
	body, err := json.Marshal(calendarQueryRequest{
		Query:     query,
		Variables: calendarQueryVariables{From: from.Format(time.RFC3339), To: to.Format(time.RFC3339)},
	})
	if err != nil {
		// Marshaling a package-owned struct of two strings cannot fail; the
		// branch exists so a future field mistake is refused, not sent.
		return nil, errors.New("calendar request: the query body could not be built")
	}
	return body, nil
}

// refreshProjects reads the account's public repository LISTING — one
// document — and assembles the coding-projects payload from whatever the
// account publishes right now, most recently pushed first (issue 281). A new
// public repository therefore appears at the next tick with no code change
// and no release, which is the owner's going-forward-correctness ruling; the
// old per-repository whitelist could only ever show what its last edit knew.
//
// Failure semantics, coarser than the retired per-repository round because
// the round IS one document now:
//
//   - The listing failing to fetch or refusing admission fails the round, and
//     the caller keeps serving the last good payload as stale — which is a
//     LIVE payload from minutes ago, not the release-time snapshot, so a bad
//     minute no longer time-travels a card back to the capture date.
//   - A row failing its own value checks is dropped and named at warn, and
//     the envelope reports stale: a roster short one repository must not
//     claim to be ok.
//   - The tally document failing costs the two derived tallies on every row
//     — the frontend dashes them — and nothing else, exactly the granularity
//     the second request was designed around. The rows themselves are live
//     and current, so the envelope stays ok.
func (s *FetchSource) refreshProjects(ctx context.Context, doer fetchDoer, env func(string) string, now time.Time) (loadedPayload, error) {
	spec := s.specs.projects
	credential := ""
	if spec.KeyEnvName != "" {
		credential = env(spec.KeyEnvName)
	}
	interval := s.config.endpointIntervalForCredential(spec.MinIntervalMinutes, spec.AuthenticatedMinIntervalMinutes, credential)
	if !s.reserve(roleCodingProjects, now, interval) {
		return loadedPayload{}, errNothingDue
	}
	logger := s.log()
	request := fetchRequest{
		source: roleCodingProjects, headers: spec.Headers, maxBytes: spec.MaxBytes, contentType: spec.ContentType,
		conditional: true,
	}
	if credential != "" {
		request.keyHeader, request.keyValue = spec.KeyHeader, spec.KeyPrefix+credential
	}
	listingRequest := request
	listingRequest.endpoint = spec.ListingEndpoint
	body, err := s.fetchDocument(ctx, doer, listingRequest)
	if err != nil {
		s.coolOnRateLimit(ctx, roleCodingProjects, now, err)
		return loadedPayload{}, fmt.Errorf("repository listing: %w", err)
	}
	listed, refused, err := mapRepositoryListing(body, spec, now)
	if err != nil {
		return loadedPayload{}, err
	}
	for _, refusal := range refused {
		// A refused row never propagates — the round serves the rest and
		// reports stale — so its failure is narrated HERE or nowhere. The
		// name already passed the grammar and account gates, and the reason
		// names a value fact at most; no URL.
		logger.LogAttrs(ctx, slog.LevelWarn, "repository row refused",
			slog.String("repo", refusal.name), slog.Any("error", refusal.err))
	}
	pulls, talliesLive := s.openPullsByRepo(ctx, doer, request, spec, now)
	payload := CodingProjectsData{Repos: make([]CodingProject, 0, len(listed))}
	for _, entry := range listed {
		row := entry.row
		if talliesLive {
			count := pulls[row.Name]
			row.OpenIssues, row.OpenPulls = splitOpenWork(entry.combinedOpen, &count)
		}
		payload.Repos = append(payload.Repos, row)
	}
	status := StatusOK
	if len(refused) > 0 {
		status = StatusStale
	}
	logger.LogAttrs(ctx, slog.LevelDebug, "coding projects refresh cycle",
		slog.Int("repos_served", len(payload.Repos)),
		slog.Int("rows_refused", len(refused)),
		slog.Bool("tallies_live", talliesLive),
	)
	// Marshaling the package-owned payload cannot fail.
	data, _ := json.Marshal(payload)
	return loadedPayload{generatedAt: now.Format(time.RFC3339), data: data, status: status}, nil
}

// openPullsByRepo reads the account-wide open pull-request search document
// and attributes its matches per repository, or reports the tallies dead for
// this round when the spec names no such document or the read does not hold
// up.
//
// A false second answer is first-class rather than an error, and that is the
// whole design of this second request: it can fail without costing the rows.
// The caller still serves LIVE repository rows — description, stars, push
// instant — and the two derived tallies simply are not there, which the
// frontend draws as a dash. A repository the map has no entry for genuinely
// has zero open pull requests, because the document vouches for the whole
// account: the mapping refused it already if any match went unattributed.
//
// The credential rides on this request exactly as it does on the listing,
// because it is the same host and the same rate budget; it is read from the
// environment by the caller, flows into a header, and is neither stored nor
// logged (requirement 12).
func (s *FetchSource) openPullsByRepo(ctx context.Context, doer fetchDoer, request fetchRequest, spec *codingProjectsFetchSpec, now time.Time) (map[string]int64, bool) {
	if spec.PullsEndpoint == "" {
		return nil, false
	}
	attempt := request
	attempt.endpoint = spec.PullsEndpoint
	body, err := s.fetchDocument(ctx, doer, attempt)
	if err == nil {
		var counted map[string]int64
		if counted, err = mapOpenPullsByRepo(body, spec.Account); err == nil {
			return counted, true
		}
	} else {
		s.coolOnRateLimit(ctx, roleCodingProjects, now, err)
	}
	// Narrated HERE or nowhere: this is the end of the line for the error,
	// and the chain names a host or a value fact at most; no URL.
	s.log().LogAttrs(ctx, slog.LevelWarn, "open pull-request tally failed",
		slog.Any("error", err))
	return nil, false
}

// commitSection returns the recent-commit rows to serve, the instant they
// were read, whether this cycle attempted them at all, and whether the list
// is live. A commit producer that is not configured serves an empty list and
// never makes the panel stale: no producer, no claim.
func (s *FetchSource) commitSection(ctx context.Context, doer fetchDoer, env func(string) string, spec *vcsCommitsFetchSpec, now time.Time) ([]VCSCommit, time.Time, bool, bool) {
	if spec == nil {
		return []VCSCommit{}, time.Time{}, false, true
	}
	credential := ""
	if spec.KeyEnvName != "" {
		credential = env(spec.KeyEnvName)
	}
	interval := s.config.endpointIntervalForCredential(spec.MinIntervalMinutes, spec.AuthenticatedMinIntervalMinutes, credential)
	if !s.reserve(roleVCSCommits, now, interval) {
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
		request := fetchRequest{
			source: roleVCSCommits, endpoint: source.Endpoint, headers: spec.Headers, maxBytes: spec.MaxBytes, contentType: spec.ContentType,
			conditional: true,
		}
		if credential != "" {
			request.keyHeader, request.keyValue = spec.KeyHeader, spec.KeyPrefix+credential
		}
		body, err := s.fetchDocument(ctx, doer, request)
		if err != nil {
			s.coolOnRateLimit(ctx, roleVCSCommits, now, err)
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
	credentials := make([]string, len(s.specs.usage.Sources))
	skipped := 0
	configured := 0
	for i, source := range s.specs.usage.Sources {
		key := env(source.KeyEnvName)
		if key == "" {
			skipped++
			logger.LogAttrs(ctx, slog.LevelDebug, "usage source skipped: credential unset",
				slog.String("source", source.Label))
			continue
		}
		credentials[i] = key
		configured++
	}
	if configured == 0 {
		return loadedPayload{}, errors.New("token usage: no source could be fetched")
	}
	// The envelope has one status and one generatedAt, so its source windows
	// are one rate-budgeted round too. Per-source reservations can drift when
	// a credential appears between wakes, alternately falling one live source
	// back to its snapshot while the other advances.
	if !s.reserve(roleTokenUsage, now, s.config.endpointInterval(s.specs.usage.MinIntervalMinutes)) {
		return loadedPayload{}, errNothingDue
	}
	fetched := make(map[string]usageMapping, len(s.specs.usage.Sources))
	failed := 0
	for i, source := range s.specs.usage.Sources {
		key := credentials[i]
		if key == "" {
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
	fallbackLoaded, err := s.fallback.load(snapshotFiles, KindTokenUsageV2)
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
	// payload is the request body, and its presence is the ONLY thing that
	// makes an attempt a POST rather than a GET. Every other producer leaves
	// it nil and is fetched exactly as it always was.
	//
	// A body is a capability, so where its bytes may come from is stated here
	// rather than left to each caller: a payload is assembled from CONFIG data
	// plus values this package computes from its own clock, never from any
	// part of any upstream answer. That is what keeps the set of things this
	// process can be made to ask unbounded by what it has been told — the same
	// property complete literal endpoint URLs give the request LINE, extended
	// to the request BODY.
	payload []byte
	// conditional opts this GET into validator revalidation: the last 200
	// answer and its entity validator are retained per endpoint, the next
	// attempt carries If-None-Match, and a 304 re-serves the retained bytes.
	// The public API does not charge a 304 against the per-address request
	// budget, which is what makes this the zero-spend answer to the rate
	// exhaustion issue 281 measured. A caller may set it ONLY for an endpoint
	// whose URL is a config literal — the retention map is keyed by endpoint,
	// so a computed URL (the usage windows) would grow the key set without
	// bound and never revalidate anything. Requests carrying a payload never
	// participate, whatever this says.
	conditional bool
}

// method reports the HTTP method one request uses. It is derived rather than
// configured on purpose: a method field in config data would be a way to turn
// a read into a write by editing a JSON file, while a body this package built
// is the only thing that can make an attempt anything other than a GET.
func (r fetchRequest) method() string {
	if r.payload == nil {
		return http.MethodGet
	}
	return http.MethodPost
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
	// OTel semantic-convention names (server.address,
	// http.response.status_code, http.response.body.size) so a collector
	// ingests upstream-fetch records without remapping; source and
	// duration_ms are documented custom attributes.
	if err != nil {
		s.log().LogAttrs(ctx, slog.LevelDebug, "upstream fetch failed",
			slog.String("source", request.source),
			slog.String("server.address", host),
			slog.Int("http.response.status_code", status),
			slog.Float64("duration_ms", elapsed),
			slog.Any("error", err),
		)
		return nil, err
	}
	s.log().LogAttrs(ctx, slog.LevelDebug, "upstream fetch",
		slog.String("source", request.source),
		slog.String("server.address", host),
		slog.Int("http.response.status_code", status),
		slog.Int("http.response.body.size", len(body)),
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
		// url.Parse failures arrive as *url.Error embedding the raw
		// endpoint; only the URL-free cause may enter the returned chain.
		return nil, 0, "", fmt.Errorf("fetch: parse endpoint: %w", transportErrorCause(err))
	}
	host := parsed.Hostname()
	// Re-admitted at request time, defense in depth against any future spec
	// tampering: scheme, userinfo, and host are all checked again here.
	if err := admitURL(parsed, s.config.Hosts); err != nil {
		return nil, 0, host, fmt.Errorf("fetch refused: %w", err)
	}
	attemptCtx, cancel := context.WithTimeout(ctx, s.config.Timeout)
	defer cancel()
	var outgoing io.Reader
	if request.payload != nil {
		outgoing = bytes.NewReader(request.payload)
	}
	outbound, err := http.NewRequestWithContext(attemptCtx, request.method(), request.endpoint, outgoing)
	if err != nil {
		return nil, 0, host, fmt.Errorf("fetch: build request: %w", transportErrorCause(err))
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
	// Conditional revalidation (issue 281): a retained validator rides out as
	// If-None-Match, so an unchanged document answers 304 — no body, and no
	// charge against the public API's per-address request budget. Only ever
	// on a GET: a request carrying a payload asks a question the retained
	// answer did not.
	revalidating := request.conditional && request.payload == nil
	validator := ""
	if revalidating {
		s.mu.Lock()
		if retained, ok := s.documents[request.endpoint]; ok {
			validator = retained.etag
		}
		s.mu.Unlock()
		if validator != "" {
			outbound.Header.Set("If-None-Match", validator)
		}
	}
	response, err := doer.Do(outbound)
	if err != nil {
		// The client's *url.Error embeds the full request URL; the chain
		// keeps the host and the transport's own cause, nothing more.
		return nil, 0, host, fmt.Errorf("fetch %s: %w", parsed.Hostname(), transportErrorCause(err))
	}
	defer func() { _ = response.Body.Close() }()
	// The 304 branch answers only a question this process asked: a validator
	// went out, so the retained bytes it names ARE the current document, and
	// they already passed the byte cap and the media-type check when they
	// were retained. An unsolicited 304 falls through to the status refusal
	// below like any other unexpected answer.
	if response.StatusCode == http.StatusNotModified && validator != "" {
		s.mu.Lock()
		retained, ok := s.documents[request.endpoint]
		s.mu.Unlock()
		if ok {
			return retained.body, response.StatusCode, host, nil
		}
	}
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
	// Retain a validated answer for revalidation. The body is capped and the
	// media type checked above; the validator is the upstream's own. The key
	// set is bounded because conditional is set only for config-literal URLs.
	if revalidating {
		if etag := response.Header.Get("Etag"); etag != "" {
			s.mu.Lock()
			if s.documents == nil {
				s.documents = make(map[string]conditionalDocument, 4)
			}
			s.documents[request.endpoint] = conditionalDocument{etag: etag, body: body}
			s.mu.Unlock()
		}
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
