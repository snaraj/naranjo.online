// refresh_test proves the background refresh behavior end to end with
// hermetic transports: fresh data flips a panel from stale to ok, every
// failure class — bad schema, oversized body, timeout, missing credential —
// keeps the last good payload serving with an honest stale signal, requests
// never trigger a fetch, and a canceled context stops the loops before any
// attempt. Real sockets appear only as loopback httptest servers.
package panels

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"
)

// scriptedDoer replays canned responses in order; used only for direct,
// single-goroutine refreshPanel calls.
type scriptedDoer struct {
	bodies []string
	next   int
}

func (d *scriptedDoer) Do(r *http.Request) (*http.Response, error) {
	if d.next >= len(d.bodies) {
		return nil, http.ErrHandlerTimeout
	}
	body := d.bodies[d.next]
	d.next++
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body))}, nil
}

// fixtureHiscores is a valid hiscores/v1 document ranking one configured
// boss and leaving the other unranked via the -1 sentinel.
const fixtureHiscores = `{"skills":[{"id":0,"name":"Overall","rank":1,"level":99,"xp":200}],` +
	`"activities":[{"id":1,"name":"Fixture Boss","rank":120,"score":42},{"id":2,"name":"Shy Boss","rank":-1,"score":-1}]}`

// fixtureUsagePage is a valid usage-page/v1 document with two buckets.
const fixtureUsagePage = `{"object":"page","data":[` +
	`{"object":"bucket","start_time":1,"end_time":2,"results":[{"object":"r","input_tokens":100,"output_tokens":10,"num_model_requests":1}]},` +
	`{"object":"bucket","start_time":2,"end_time":3,"results":[{"object":"r","input_tokens":50,"output_tokens":5,"num_model_requests":1}]}` +
	`],"has_more":false,"next_page":null}`

// bossFetchRegistry builds a one-panel registry whose boss-log panel is
// fetch-backed against the given endpoint and allowlisted host.
func bossFetchRegistry(t *testing.T, endpoint string, config FetchConfig) (*Registry, *panelState) {
	t.Helper()
	fsys := fstest.MapFS{"snapshots/boss.json": {Data: validSnapshot(t)}}
	source, err := NewFetchSource(
		SnapshotSource{Name: "snapshots/boss.json"},
		config,
		panelFetchSpecs{bossLog: &bossLogFetchSpec{
			Endpoint: endpoint, Account: "fixture", ExcludeActivities: []string{"Fixture Activity"},
		}},
	)
	if err != nil {
		t.Fatalf("NewFetchSource() error = %v", err)
	}
	registry := newRegistry(fsys, []panelDefinition{{id: "boss-log", kind: KindBossLog, title: "Boss log", source: source}})
	return registry, registry.byID["boss-log"]
}

// TestRefreshPanelServesFreshData walks the owner's core ask: the panel
// cold-starts on its snapshot as stale, one successful refresh serves the
// freshly fetched, strictly validated mapping as ok — nulls preserved for
// unranked bosses — and the index row follows the transition.
func TestRefreshPanelServesFreshData(t *testing.T) {
	t.Parallel()
	registry, state := bossFetchRegistry(t, "https://api.example.test/scores.json", validFetchConfig())

	cold := decodePanelEnvelope(t, registry, "boss-log")
	if cold.Status != StatusStale {
		t.Fatalf("cold-start status = %q, want stale snapshot fallback", cold.Status)
	}
	if err := registry.refreshPanel(t.Context(), state, &scriptedDoer{bodies: []string{fixtureHiscores}}, func(string) string { return "" }); err != nil {
		t.Fatalf("refreshPanel() error = %v", err)
	}
	fresh := decodePanelEnvelope(t, registry, "boss-log")
	if fresh.Status != StatusOK {
		t.Fatalf("refreshed status = %q, want ok", fresh.Status)
	}
	if _, err := time.Parse(time.RFC3339, fresh.GeneratedAt); err != nil {
		t.Errorf("refreshed generatedAt = %q: %v", fresh.GeneratedAt, err)
	}
	var payload BossLogData
	if err := decodeStrict(fresh.Data, &payload); err != nil {
		t.Fatalf("decode refreshed payload: %v", err)
	}
	if payload.Account != "fixture" || len(payload.Bosses) != 2 {
		t.Fatalf("refreshed payload = %+v", payload)
	}
	if payload.Bosses[0].KC == nil || *payload.Bosses[0].KC != 42 || payload.Bosses[0].Rank == nil || *payload.Bosses[0].Rank != 120 {
		t.Errorf("ranked boss lost its values: %+v", payload.Bosses[0])
	}
	if payload.Bosses[1].KC != nil || payload.Bosses[1].Rank != nil {
		t.Errorf("unranked boss must serve null kc and rank: %+v", payload.Bosses[1])
	}
	index := decodeIndex(t, registry)
	if index.Panels[0].Status != StatusOK {
		t.Errorf("index status = %q after refresh, want ok", index.Panels[0].Status)
	}
}

// TestRefreshFailuresKeepLastGoodAsStale stages the failure classes the
// coordinator demanded deny proofs for — invalid schema, oversized body —
// and requires each to keep the previously fetched payload serving, flipped
// to an honest stale.
func TestRefreshFailuresKeepLastGoodAsStale(t *testing.T) {
	t.Parallel()
	config := validFetchConfig()
	config.MaxBytes = int64(len(fixtureHiscores) + 64)
	registry, state := bossFetchRegistry(t, "https://api.example.test/scores.json", config)
	env := func(string) string { return "" }
	if err := registry.refreshPanel(t.Context(), state, &scriptedDoer{bodies: []string{fixtureHiscores}}, env); err != nil {
		t.Fatalf("seed refresh error = %v", err)
	}
	goodData := decodePanelEnvelope(t, registry, "boss-log").Data

	for name, body := range map[string]string{
		"invalid schema": `{"unexpected":"shape"}`,
		"trailing junk":  fixtureHiscores + ` {}`,
		"oversized body": `{"skills":[],"activities":[]}` + strings.Repeat(" ", int(config.MaxBytes)),
	} {
		if err := registry.refreshPanel(t.Context(), state, &scriptedDoer{bodies: []string{body}}, env); err == nil {
			t.Fatalf("%s: refresh accepted a bad document", name)
		}
		envelope := decodePanelEnvelope(t, registry, "boss-log")
		if envelope.Status != StatusStale {
			t.Errorf("%s: status = %q, want stale", name, envelope.Status)
		}
		if !bytes.Equal(envelope.Data, goodData) {
			t.Errorf("%s: last-good payload was not retained", name)
		}
		if decodeIndex(t, registry).Panels[0].Status != StatusStale {
			t.Errorf("%s: index did not follow the stale transition", name)
		}
	}
}

// TestRefreshHonorsTheConfiguredTimeout pins the per-attempt bound over a
// real loopback socket: a server slower than the configured timeout fails
// the attempt and the snapshot fallback keeps serving.
func TestRefreshHonorsTheConfiguredTimeout(t *testing.T) {
	t.Parallel()
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Stall until the abandoned request's context cancels, so the
		// handler returns as soon as the client times out and Close never
		// waits on a stuck handler.
		<-r.Context().Done()
	}))
	t.Cleanup(server.Close)
	host, config := loopbackConfig(t, server.URL)
	config.Timeout = 40 * time.Millisecond
	registry, state := bossFetchRegistry(t, server.URL+"/scores.json", config)
	_ = host
	if err := registry.refreshPanel(t.Context(), state, loopbackDoer(server), func(string) string { return "" }); err == nil {
		t.Fatal("refresh succeeded against a server slower than its timeout")
	}
	if got := decodePanelEnvelope(t, registry, "boss-log").Status; got != StatusStale {
		t.Fatalf("status after timeout = %q, want the stale fallback", got)
	}
}

// loopbackDoer builds a transport that trusts the given loopback servers'
// certificates and installs the PRODUCTION redirect policy — the same
// refuseRedirect function newProductionDoer installs, not a lookalike — so
// these scenarios test the shipped behavior over TLS.
//
// Every server the scenario runs is passed in, INCLUDING one a request must
// never reach: if the redirect refusal ever regressed, the follow-up request
// would succeed and be counted, rather than failing on an untrusted
// certificate and passing the test for the wrong reason.
func loopbackDoer(servers ...*httptest.Server) fetchDoer {
	pool := x509.NewCertPool()
	for _, server := range servers {
		pool.AddCert(server.Certificate())
	}
	return &http.Client{
		Transport:     &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}},
		CheckRedirect: refuseRedirect,
	}
}

// loopbackConfig builds a validated config whose allowlist is exactly the
// loopback test server's host.
func loopbackConfig(t *testing.T, serverURL string) (string, FetchConfig) {
	t.Helper()
	parsed, err := url.Parse(serverURL)
	if err != nil {
		t.Fatalf("parse test server URL: %v", err)
	}
	config := validFetchConfig()
	config.Hosts = []string{parsed.Hostname()}
	return parsed.Hostname(), config
}

// TestRefreshLoopDrivesThePanel runs the real background loop against a
// loopback server that fails its first two answers: the loop backs off,
// recovers, flips the panel to ok, and keeps waking until the context
// cancels it — exercising the failure, backoff-cap, and success arcs of the
// real scheduler in one bounded scenario.
func TestRefreshLoopDrivesThePanel(t *testing.T) {
	t.Parallel()
	var hits atomic.Int64
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if hits.Add(1) <= 2 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		_, _ = w.Write([]byte(fixtureHiscores))
	}))
	t.Cleanup(server.Close)
	_, config := loopbackConfig(t, server.URL)
	config.TTL = 30 * time.Millisecond
	config.Timeout = 20 * time.Millisecond
	config.InitialBackoff = 5 * time.Millisecond
	config.MaxBackoff = 20 * time.Millisecond
	registry, _ := bossFetchRegistry(t, server.URL+"/scores.json", config)

	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	registry.startRefresh(ctx, loopbackDoer(server), func(string) string { return "" })
	deadline := time.Now().Add(5 * time.Second)
	for {
		if decodePanelEnvelope(t, registry, "boss-log").Status == StatusOK {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("panel never became ok under the refresh loop")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if hits.Load() < 3 {
		t.Fatalf("server saw %d attempts; the backoff retries never arrived", hits.Load())
	}
	cancel()
}

// statusDoer answers every request with a fixed status and body.
type statusDoer struct {
	code int
	body string
}

func (d statusDoer) Do(r *http.Request) (*http.Response, error) {
	return &http.Response{StatusCode: d.code, Body: io.NopCloser(strings.NewReader(d.body))}, nil
}

// TestUpstreamErrorStatusIsRefused pins the 200-status gate INDEPENDENTLY
// of the decode gate (the adversarial review's surviving mutant): every
// non-200 answer carries a grammar-conforming JSON body that the strict
// decoder would happily accept, so only the status check itself can refuse
// it — and the previously fetched payload must keep serving.
func TestUpstreamErrorStatusIsRefused(t *testing.T) {
	t.Parallel()
	registry, state := bossFetchRegistry(t, "https://api.example.test/scores.json", validFetchConfig())
	env := func(string) string { return "" }
	if err := registry.refreshPanel(t.Context(), state, &scriptedDoer{bodies: []string{fixtureHiscores}}, env); err != nil {
		t.Fatalf("seed refresh error = %v", err)
	}
	goodData := decodePanelEnvelope(t, registry, "boss-log").Data

	for _, code := range []int{http.StatusInternalServerError, http.StatusFound} {
		err := registry.refreshPanel(t.Context(), state, statusDoer{code: code, body: fixtureHiscores}, env)
		if err == nil {
			t.Fatalf("status %d with a valid JSON body was accepted; the status gate is gone", code)
		}
		if !strings.Contains(err.Error(), "status") {
			t.Errorf("status %d refusal = %v, want the status gate's error", code, err)
		}
		envelope := decodePanelEnvelope(t, registry, "boss-log")
		if envelope.Status != StatusStale || !bytes.Equal(envelope.Data, goodData) {
			t.Errorf("status %d: got %q with retained=%v, want stale with the last good payload", code, envelope.Status, bytes.Equal(envelope.Data, goodData))
		}
	}
}

// TestRedirectsAreRefusedAndCredentialStaysHome pins the redirect policy
// the re-review demanded, over two loopback servers: an allowlisted host
// answering 302 toward a second server is a FAILED attempt — the follow-up
// request is never issued, so neither a plain probe nor a custom credential
// header ever reaches the redirect target — and the previously fetched
// payload keeps serving as stale.
func TestRedirectsAreRefusedAndCredentialStaysHome(t *testing.T) {
	t.Parallel()
	var targetHits atomic.Int64
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		targetHits.Add(1)
	}))
	t.Cleanup(target.Close)

	var redirecting atomic.Bool
	origin := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if redirecting.Load() {
			http.Redirect(w, r, target.URL+"/exfil", http.StatusFound)
			return
		}
		_, _ = w.Write([]byte(fixtureHiscores))
	}))
	t.Cleanup(origin.Close)

	_, config := loopbackConfig(t, origin.URL)
	registry, state := bossFetchRegistry(t, origin.URL+"/scores.json", config)
	doer := loopbackDoer(origin, target)
	env := func(string) string { return "" }

	if err := registry.refreshPanel(t.Context(), state, doer, env); err != nil {
		t.Fatalf("seed refresh error = %v", err)
	}
	goodData := decodePanelEnvelope(t, registry, "boss-log").Data

	redirecting.Store(true)
	if err := registry.refreshPanel(t.Context(), state, doer, env); err == nil {
		t.Fatal("a redirecting upstream was accepted")
	} else if !strings.Contains(err.Error(), "redirect refused") {
		t.Fatalf("refusal error = %v, want the redirect refusal", err)
	}
	envelope := decodePanelEnvelope(t, registry, "boss-log")
	if envelope.Status != StatusStale || !bytes.Equal(envelope.Data, goodData) {
		t.Fatalf("after refused redirect: status %q, retained=%v; want stale with the last good payload", envelope.Status, bytes.Equal(envelope.Data, goodData))
	}

	// The credential variant: even with a custom key header attached — the
	// class Go's client does NOT strip on cross-domain hops — the refusal
	// happens before the follow-up request exists, so the redirect target
	// must never observe a single request.
	source := state.fetch
	// The header name and sentinel spelling deliberately avoid secret-scanner
	// keywords and entropy so the repository's gitleaks gate stays meaningful.
	if _, err := source.fetchDocument(t.Context(), doer, origin.URL+"/scores.json", "x-test-credential", "fixture-sentinel-aaaa", nil, 0); err == nil {
		t.Fatal("credentialed fetch followed a redirect")
	}
	if got := targetHits.Load(); got != 0 {
		t.Fatalf("redirect target observed %d request(s); neither probe nor credential may ever reach it", got)
	}
}

// TestOversizedLivePayloadIsRefused pins the structural panel budget on the
// live path: a mapped payload the budget refuses keeps the last good
// response serving instead of busting the owner's 32 KiB bound.
func TestOversizedLivePayloadIsRefused(t *testing.T) {
	t.Parallel()
	// The boss list now comes from the UPSTREAM, so the over-budget case is
	// an upstream that reports an absurd number of absurdly named bosses —
	// which is exactly the shape a compromised or drifting upstream would
	// take, and exactly what the budget refusal exists to stop.
	rows := make([]string, 0, 40)
	for i := 0; i < 40; i++ {
		rows = append(rows, fmt.Sprintf(`{"id":%d,"name":%q,"rank":1,"score":1}`, i, strings.Repeat("b", 1024)+string(rune('a'+i))))
	}
	giantHiscores := `{"name":"fixture","skills":[],"activities":[` + strings.Join(rows, ",") + `]}`
	fsys := fstest.MapFS{"snapshots/boss.json": {Data: validSnapshot(t)}}
	source, err := NewFetchSource(
		SnapshotSource{Name: "snapshots/boss.json"},
		validFetchConfig(),
		panelFetchSpecs{bossLog: &bossLogFetchSpec{
			Endpoint: "https://api.example.test/scores.json", Account: "fixture",
			ExcludeActivities: []string{"Fixture Activity"},
		}},
	)
	if err != nil {
		t.Fatalf("NewFetchSource() error = %v", err)
	}
	registry := newRegistry(fsys, []panelDefinition{{id: "boss-log", kind: KindBossLog, title: "Boss log", source: source}})
	state := registry.byID["boss-log"]
	if err := registry.refreshPanel(t.Context(), state, &scriptedDoer{bodies: []string{giantHiscores}}, func(string) string { return "" }); err == nil {
		t.Fatal("refresh accepted a payload over the panel budget")
	}
	envelope := decodePanelEnvelope(t, registry, "boss-log")
	if envelope.Status != StatusStale {
		t.Fatalf("status = %q, want the stale fallback", envelope.Status)
	}
	if len(envelope.Data) > MaxPanelResponseBytes {
		t.Fatal("an over-budget body reached the served state")
	}
}

// TestFetchPanelWithBrokenFallbackIsUnavailable pins fail-soft construction
// for fetch-backed panels too: a missing fallback snapshot serves the
// unavailable envelope instead of failing the boot.
func TestFetchPanelWithBrokenFallbackIsUnavailable(t *testing.T) {
	t.Parallel()
	source, err := NewFetchSource(SnapshotSource{Name: "snapshots/never-shipped.json"}, validFetchConfig(), panelFetchSpecs{bossLog: validBossSpec()})
	if err != nil {
		t.Fatalf("NewFetchSource() error = %v", err)
	}
	definition := panelDefinition{id: "broken", kind: KindBossLog, title: "Broken", source: source}
	assertServesUnavailable(t, newRegistry(fstest.MapFS{}, []panelDefinition{definition}), definition)
}

// TestProductionStartRefreshUnderCanceledContext covers the production
// wrapper end to end without egress: StartRefresh on the real registry with
// an already-canceled context builds the production transport, spawns the
// loops, and exits every one of them before an attempt — the same
// deterministic guard pinned above, exercised through the public surface.
func TestProductionStartRefreshUnderCanceledContext(t *testing.T) {
	t.Parallel()
	registry := New()
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	registry.StartRefresh(ctx)
	time.Sleep(50 * time.Millisecond)
	for _, id := range []string{"boss-log", "token-usage"} {
		if got := decodePanelEnvelope(t, registry, id).Status; got != StatusStale {
			t.Errorf("%s status = %q, want the untouched stale fallback", id, got)
		}
	}
}

// TestRequestsNeverTriggerFetches is the no-fetch-on-request-path proof:
// with an instrumented transport, serving any number of index, panel, miss,
// and refused-method requests adds zero fetch attempts beyond the ones the
// background path performed on its own.
func TestRequestsNeverTriggerFetches(t *testing.T) {
	t.Parallel()
	registry, state := bossFetchRegistry(t, "https://api.example.test/scores.json", validFetchConfig())
	doer := &countingDoer{}
	_ = registry.refreshPanel(t.Context(), state, doer, func(string) string { return "" })
	attempts := doer.calls.Load()
	if attempts != 1 {
		t.Fatalf("background attempt count = %d, want 1", attempts)
	}
	for range 50 {
		for _, target := range []string{IndexPath, PanelPathPrefix + "boss-log", PanelPathPrefix + "missing"} {
			response := httptest.NewRecorder()
			registry.ServeHTTP(response, httptest.NewRequest(http.MethodGet, target, nil))
		}
		refused := httptest.NewRecorder()
		registry.ServeHTTP(refused, httptest.NewRequest(http.MethodPost, IndexPath, nil))
	}
	if got := doer.calls.Load(); got != attempts {
		t.Fatalf("request handling reached the transport: attempts grew from %d to %d", attempts, got)
	}
}

// TestStartRefreshWithCanceledContextNeverFetches pins the deterministic
// shutdown guard: loops started under an already-canceled context exit
// before any attempt, so a draining process can never emit one last fetch.
func TestStartRefreshWithCanceledContextNeverFetches(t *testing.T) {
	t.Parallel()
	registry, _ := bossFetchRegistry(t, "https://api.example.test/scores.json", validFetchConfig())
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	registry.startRefresh(ctx, poisonedDoer{t: t}, func(string) string { return "" })
	registry.startRefresh(ctx, poisonedDoer{t: t}, func(string) string { return "" }) // idempotent second start
	time.Sleep(50 * time.Millisecond)
	if got := decodePanelEnvelope(t, registry, "boss-log").Status; got != StatusStale {
		t.Fatalf("status = %q, want the untouched stale fallback", got)
	}
}

// usageFetchSource builds a token-usage source over the production snapshot
// fallback with two sources matching the shipped labels.
func usageFetchSource(t *testing.T) *FetchSource {
	t.Helper()
	source, err := NewFetchSource(
		SnapshotSource{Name: "snapshots/token-usage.json"},
		validFetchConfig(),
		panelFetchSpecs{usage: &tokenUsageFetchSpec{Sources: []usageSourceSpec{
			{
				Label: "anthropic", Endpoint: "https://api.example.test/usage-a", Shape: shapeUsagePage,
				KeyEnvName: "PANEL_TEST_KEY_A", KeyHeader: "x-api-key",
				Window: windowParamSpec{Param: "starting_at", Format: windowFormatRFC3339, LookbackDays: 7},
			},
			{
				Label: "codex", Endpoint: "https://api.example.test/usage-b", Shape: shapeUsagePage,
				KeyEnvName: "PANEL_TEST_KEY_B", KeyHeader: "Authorization", KeyPrefix: "Bearer ",
				Window: windowParamSpec{Param: "start_time", Format: windowFormatUnix, LookbackDays: 7},
			},
		}}},
	)
	if err != nil {
		t.Fatalf("NewFetchSource() error = %v", err)
	}
	return source
}

// TestUsageRefreshSkipsUnkeyedSourcesAndMerges proves the credential
// contract: a source whose env var is unset is skipped — its snapshot
// section keeps serving — a partly fetched panel is honestly stale, a fully
// fetched one is ok, and with no keys at all nothing is fetched and the
// panel keeps its current payload.
func TestUsageRefreshSkipsUnkeyedSourcesAndMerges(t *testing.T) {
	t.Parallel()
	registry := newRegistry(snapshotFiles, []panelDefinition{
		{id: "token-usage", kind: KindTokenUsage, title: "Token usage", source: usageFetchSource(t)},
	})
	state := registry.byID["token-usage"]

	t.Run("no keys: nothing fetched, snapshot keeps serving", func(t *testing.T) {
		if err := registry.refreshPanel(t.Context(), state, poisonedDoer{t: t}, func(string) string { return "" }); err == nil {
			t.Fatal("refresh claimed success with no fetchable source")
		}
		if got := decodePanelEnvelope(t, registry, "token-usage").Status; got != StatusStale {
			t.Fatalf("status = %q, want the stale snapshot fallback", got)
		}
	})

	t.Run("one key: fetched windows merge with snapshot fallback as stale", func(t *testing.T) {
		env := fakeLookup(map[string]string{"PANEL_TEST_KEY_A": "fixture-key"})
		if err := registry.refreshPanel(t.Context(), state, &scriptedDoer{bodies: []string{fixtureUsagePage}}, env); err != nil {
			t.Fatalf("refreshPanel() error = %v", err)
		}
		envelope := decodePanelEnvelope(t, registry, "token-usage")
		if envelope.Status != StatusStale {
			t.Fatalf("partially fetched status = %q, want stale", envelope.Status)
		}
		var payload TokenUsageData
		if err := decodeStrict(envelope.Data, &payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if len(payload.Sources) != 2 || payload.Sources[0].Label != "anthropic" || payload.Sources[1].Label != "codex" {
			t.Fatalf("merged sources = %+v", payload.Sources)
		}
		fetched := payload.Sources[0].Windows
		if len(fetched) != 2 || fetched[0].Period != "today" || fetched[1].Period != "week" || fetched[1].InputTokens != 150 {
			t.Errorf("fetched windows = %+v, want today plus a summed week", fetched)
		}
		if payload.Sources[0].Series == nil || len(payload.Sources[0].Series.Totals) == 0 {
			t.Errorf("fetched source carries no activity series: %+v", payload.Sources[0].Series)
		}
		// The unkeyed source keeps its recorded snapshot section verbatim —
		// the account handle and the figures no usage API reports — and gains
		// no live series it never fetched.
		unkeyed := payload.Sources[1]
		if unkeyed.Account == "" || len(unkeyed.Stats) == 0 || len(unkeyed.Insights) == 0 {
			t.Errorf("unkeyed source lost its recorded snapshot section: %+v", unkeyed)
		}
		if unkeyed.Series != nil {
			t.Errorf("unkeyed source acquired a series it never fetched: %+v", unkeyed.Series)
		}
	})

	t.Run("both keys: fully fetched serves ok and never leaks a credential", func(t *testing.T) {
		// The fixture credential is a sentinel value scanned for below; its
		// name and spelling deliberately avoid secret-scanner keywords so the
		// repository's gitleaks gate stays meaningful.
		const sentinel = "fixture-sentinel-24680"
		env := fakeLookup(map[string]string{"PANEL_TEST_KEY_A": sentinel, "PANEL_TEST_KEY_B": sentinel})
		if err := registry.refreshPanel(t.Context(), state, &scriptedDoer{bodies: []string{fixtureUsagePage, fixtureUsagePage}}, env); err != nil {
			t.Fatalf("refreshPanel() error = %v", err)
		}
		response := httptest.NewRecorder()
		registry.ServeHTTP(response, httptest.NewRequest(http.MethodGet, PanelPathPrefix+"token-usage", nil))
		if !bytes.Contains(response.Body.Bytes(), []byte(`"status":"ok"`)) {
			t.Fatalf("fully fetched panel is not ok: %s", response.Body.String())
		}
		index := httptest.NewRecorder()
		registry.ServeHTTP(index, httptest.NewRequest(http.MethodGet, IndexPath, nil))
		for name, body := range map[string][]byte{"panel": response.Body.Bytes(), "index": index.Body.Bytes()} {
			if bytes.Contains(body, []byte(sentinel)) {
				t.Errorf("credential leaked into the served %s bytes", name)
			}
		}
	})
}

// fakeLookup returns an environment lookup over the given map only.
func fakeLookup(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

// TestActivityRefreshServesTheLiveCalendar drives the version-control panel's
// whole live path with a scripted transport: the request goes out with the
// document type the upstream demands, the captured response maps, and the
// panel flips from its stale snapshot to fresh data. No credential is read
// anywhere on this path — the producer is public by design — and a refusal
// keeps the snapshot serving.
func TestActivityRefreshServesTheLiveCalendar(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile(filepath.Join("testdata", "contributions-fragment.html"))
	if err != nil {
		t.Fatalf("read the captured contribution calendar: %v", err)
	}
	snapshot := []byte(`{"generatedAt":"2026-08-01T00:00:00Z","data":{"totalContributions":1,` +
		`"weeks":[[0,0,0,0,0,0,1]],"streak":1,"endDate":"2026-08-01","recentCommits":[]}}`)
	fsys := fstest.MapFS{"snapshots/activity.json": {Data: snapshot}}
	source, err := NewFetchSource(
		SnapshotSource{Name: "snapshots/activity.json"},
		validFetchConfig(),
		panelFetchSpecs{vcs: &vcsActivityFetchSpec{
			Endpoint: "https://api.example.test/contributions",
			Headers:  map[string]string{"Accept": "text/html"},
		}},
	)
	if err != nil {
		t.Fatalf("NewFetchSource() error = %v", err)
	}
	registry := newRegistry(fsys, []panelDefinition{
		{id: "vcs-activity", kind: KindVCSActivity, title: "Version-control activity", source: source},
	})
	state := registry.byID["vcs-activity"]
	if got := decodePanelEnvelope(t, registry, "vcs-activity").Status; got != StatusStale {
		t.Fatalf("cold status = %q, want the stale snapshot fallback", got)
	}

	doer := &recordingDoer{body: string(raw)}
	// The environment lookup is poisoned: this producer must never read one.
	env := func(key string) string {
		t.Errorf("the public activity producer read the environment for %q", key)
		return ""
	}
	if err := registry.refreshPanel(t.Context(), state, doer, env); err != nil {
		t.Fatalf("refreshPanel() error = %v", err)
	}
	if doer.accept != "text/html" {
		t.Errorf("request Accept = %q, want the document type the spec declares", doer.accept)
	}
	envelope := decodePanelEnvelope(t, registry, "vcs-activity")
	if envelope.Status != StatusOK {
		t.Fatalf("refreshed status = %q, want ok", envelope.Status)
	}
	var payload VCSActivityData
	if err := decodeStrict(envelope.Data, &payload); err != nil {
		t.Fatalf("decode refreshed payload: %v", err)
	}
	if len(payload.Weeks) != 12 || payload.TotalContributions != 499 || payload.EndDate != "2026-08-20" {
		t.Errorf("refreshed payload = %d weeks, total %d, end %q", len(payload.Weeks), payload.TotalContributions, payload.EndDate)
	}

	// A drifted document is refused and the last good payload keeps serving,
	// now honestly marked stale.
	broken := &recordingDoer{body: "<html><body>signed out</body></html>"}
	if err := registry.refreshPanel(t.Context(), state, broken, env); err == nil {
		t.Fatal("refresh accepted a document with no calendar in it")
	}
	if got := decodePanelEnvelope(t, registry, "vcs-activity").Status; got != StatusStale {
		t.Errorf("status after a failed refresh = %q, want stale", got)
	}
}

// recordingDoer answers every request with one body and remembers the Accept
// header the request carried.
type recordingDoer struct {
	body   string
	accept string
}

func (d *recordingDoer) Do(r *http.Request) (*http.Response, error) {
	d.accept = r.Header.Get("Accept")
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(d.body))}, nil
}
