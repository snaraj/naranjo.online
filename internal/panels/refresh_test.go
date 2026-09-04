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
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
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
	if _, err := source.fetchDocument(t.Context(), doer, fetchRequest{
		endpoint:  origin.URL + "/scores.json",
		keyHeader: "x-test-credential",
		keyValue:  "fixture-sentinel-aaaa",
	}); err == nil {
		t.Fatal("credentialed fetch followed a redirect")
	}
	if got := targetHits.Load(); got != 0 {
		t.Fatalf("redirect target observed %d request(s); neither probe nor credential may ever reach it", got)
	}
}

// TestOversizedLivePayloadIsRefused pins the structural panel budget on the
// live path: a mapped payload the budget refuses keeps the last good
// response serving instead of busting the owner's panel-envelope bound.
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
	registry := New(nil)
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

// shippedSeries returns the recorded daily series one source ships in the
// snapshot a registry was built from, or fails the test when that source
// carries none. It exists so a refresh assertion can compare against the
// exact recorded bytes rather than against "not nil", which is a property
// the merge could satisfy with the wrong series entirely.
func shippedSeries(t *testing.T, registry *Registry, label string) *TokenUsageSeries {
	t.Helper()
	var payload TokenUsageData
	if err := decodeStrict(decodePanelEnvelope(t, registry, "token-usage").Data, &payload); err != nil {
		t.Fatalf("decode token-usage payload: %v", err)
	}
	for _, source := range payload.Sources {
		if source.Label != label {
			continue
		}
		if source.Series == nil {
			t.Fatalf("source %q ships no recorded series for this pin to compare against", label)
		}
		return source.Series
	}
	t.Fatalf("the shipped snapshot carries no source labelled %q", label)
	return nil
}

// TestUsageRefreshSkipsUnkeyedSourcesAndMerges proves the credential
// contract: a source whose env var is unset is skipped — its snapshot
// section keeps serving — a partly fetched panel is honestly stale, a fully
// fetched one is ok, and with no keys at all nothing is fetched and the
// panel keeps its current payload.
func TestUsageRefreshSkipsUnkeyedSourcesAndMerges(t *testing.T) {
	t.Parallel()
	registry := newRegistry(snapshotFiles, []panelDefinition{
		{id: "token-usage", kind: KindTokenUsageV2, title: "Token usage", source: usageFetchSource(t)},
	})
	state := registry.byID["token-usage"]
	// The recorded series the unkeyed source ships, read BEFORE any refresh
	// runs. The assertion below used to be "the unkeyed source has no series
	// at all", which was true only for as long as that source happened to
	// ship none — an accident of the snapshot, not a property of the merge.
	// Now that both sources carry a recorded capture, the property that
	// actually matters is stateable and strictly stronger: the unkeyed
	// source keeps ITS OWN recorded series, byte for byte, and never
	// acquires the one the keyed source just fetched.
	recordedSeries := shippedSeries(t, registry, "codex")

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
		// the account handle, the figures no usage API reports, and its own
		// recorded daily capture — while gaining nothing the keyed source
		// fetched. Both halves are checked, because either alone passes for
		// the wrong reason: a source that lost its capture satisfies "did not
		// acquire the fetched one", and a source that took the fetched series
		// satisfies "still has a series".
		unkeyed := payload.Sources[1]
		if unkeyed.Account == "" || len(unkeyed.Stats) == 0 || len(unkeyed.Insights) == 0 {
			t.Errorf("unkeyed source lost its recorded snapshot section: %+v", unkeyed)
		}
		if unkeyed.Series == nil {
			t.Fatalf("unkeyed source lost the recorded series it ships")
		}
		if !unkeyed.Series.Recorded {
			t.Errorf("the unkeyed source's series stopped saying it was recorded out of band")
		}
		if !reflect.DeepEqual(*unkeyed.Series, *recordedSeries) {
			t.Errorf("unkeyed series = %+v, want the recorded capture %+v", *unkeyed.Series, *recordedSeries)
		}
		if fetchedSeries := payload.Sources[0].Series; fetchedSeries != nil &&
			reflect.DeepEqual(*unkeyed.Series, *fetchedSeries) {
			t.Errorf("unkeyed source acquired the series the keyed source fetched: %+v", *unkeyed.Series)
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

// TestUsageSourcesShareOneRateBudget proves the multi-source envelope cannot
// split into separately timed refreshes. A second credential appearing inside
// the first round's budget makes no partial request and therefore cannot
// replace the already-live first source with its recorded snapshot. Once the
// one group budget expires, both sources advance together.
func TestUsageSourcesShareOneRateBudget(t *testing.T) {
	t.Parallel()
	source := usageFetchSource(t)
	source.specs.usage.MinIntervalMinutes = 5
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	doer := &scriptedDoer{bodies: []string{fixtureUsagePage, fixtureUsagePage, fixtureUsagePage}}
	oneKey := fakeLookup(map[string]string{"PANEL_TEST_KEY_A": "fixture-key"})
	bothKeys := fakeLookup(map[string]string{
		"PANEL_TEST_KEY_A": "fixture-key",
		"PANEL_TEST_KEY_B": "fixture-key",
	})

	first, err := source.refreshUsage(t.Context(), doer, oneKey, now)
	if err != nil || first.status != StatusStale || doer.next != 1 {
		t.Fatalf("first partial round = status %q, attempts %d, error %v; want stale/1/nil", first.status, doer.next, err)
	}
	if _, err := source.refreshUsage(t.Context(), doer, bothKeys, now.Add(time.Minute)); !errors.Is(err, errNothingDue) {
		t.Fatalf("second round inside the group budget = %v, want errNothingDue", err)
	}
	if doer.next != 1 {
		t.Fatalf("a newly available source split the budgeted round: attempts = %d, want 1", doer.next)
	}
	complete, err := source.refreshUsage(t.Context(), doer, bothKeys, now.Add(5*time.Minute))
	if err != nil || complete.status != StatusOK || doer.next != 3 {
		t.Fatalf("complete round after budget = status %q, attempts %d, error %v; want ok/3/nil", complete.status, doer.next, err)
	}
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

// cannedAnswer is one scripted upstream reply: the status, the media type it
// declares, and the bytes it serves. Every field is separately settable
// because each is a separate gate on the fetch path, and a canary that can
// only vary the body cannot prove the other two exist.
type cannedAnswer struct {
	status      int
	contentType string
	body        string
	transport   error
}

// routingDoer answers by URL path and counts what it was asked for, so a
// two-producer panel can be driven with one producer healthy and the other
// hostile — the arrangement every partial-failure claim below rests on.
type routingDoer struct {
	mu      sync.Mutex
	answers map[string]cannedAnswer
	calls   map[string]int
	headers map[string]string
}

func newRoutingDoer(answers map[string]cannedAnswer) *routingDoer {
	return &routingDoer{answers: answers, calls: map[string]int{}, headers: map[string]string{}}
}

func (d *routingDoer) Do(r *http.Request) (*http.Response, error) {
	d.mu.Lock()
	answer, known := d.answers[r.URL.Path]
	d.calls[r.URL.Path]++
	d.headers[r.URL.Path] = r.Header.Get("Accept")
	d.mu.Unlock()
	if !known {
		return nil, fmt.Errorf("routingDoer: no answer scripted for %s", r.URL.Path)
	}
	if answer.transport != nil {
		return nil, answer.transport
	}
	header := http.Header{}
	if answer.contentType != "" {
		header.Set("Content-Type", answer.contentType)
	}
	status := answer.status
	if status == 0 {
		status = http.StatusOK
	}
	return &http.Response{StatusCode: status, Header: header, Body: io.NopCloser(strings.NewReader(answer.body))}, nil
}

func (d *routingDoer) countOf(path string) int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.calls[path]
}

func (d *routingDoer) total() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	sum := 0
	for _, count := range d.calls {
		sum += count
	}
	return sum
}

// activityFixtureSnapshot is the cold-start fallback the activity scenarios
// begin from: a minimal, valid, contribution payload with no commits, which is
// exactly the state the owner reported as the defect — a panel that shows no
// recent commits at all.
const activityFixtureSnapshot = `{"generatedAt":"2026-08-01T00:00:00Z","data":{"totalContributions":1,` +
	`"weeks":[[0,0,0,0,0,0,1]],"streak":1,"endDate":"2026-08-01","recentCommits":[]}}`

// commitDocument builds one repository's public commit document. It carries
// the FULL upstream row — including the authorship name and email address the
// projection deliberately does not model — so these scenarios prove the
// projection tolerates the real document rather than a trimmed one.
func commitDocument(rows ...[2]string) string {
	entries := make([]string, 0, len(rows))
	for index, row := range rows {
		sha := fmt.Sprintf("%040x", index+1)
		entries = append(entries, fmt.Sprintf(
			`{"sha":%q,"node_id":"fixture","commit":{"author":{"name":"Fixture Author","email":"fixture@example.invalid","date":%q},`+
				`"committer":{"name":"Fixture Author","email":"fixture@example.invalid","date":%q},"message":%q,`+
				`"tree":{"sha":%q,"url":"https://api.example.test/tree"},"url":"https://api.example.test/commit",`+
				`"comment_count":0,"verification":{"verified":true,"reason":"valid","signature":null,"payload":null}},`+
				`"url":"https://api.example.test/commit","html_url":"https://api.example.test/c","comments_url":"https://api.example.test/cc",`+
				`"author":null,"committer":null,"parents":[]}`,
			sha, row[1], row[1], row[0], sha,
		))
	}
	return "[" + strings.Join(entries, ",") + "]"
}

// activityFetchRegistry builds a one-panel registry whose version-control
// panel reads BOTH public producers on their own rate budgets.
func activityFetchRegistry(t *testing.T, minutes int) (*Registry, *panelState) {
	t.Helper()
	fsys := fstest.MapFS{"snapshots/activity.json": {Data: []byte(activityFixtureSnapshot)}}
	source, err := NewFetchSource(
		SnapshotSource{Name: "snapshots/activity.json"},
		validFetchConfig(),
		panelFetchSpecs{vcs: &vcsActivityFetchSpec{
			Endpoint:           "https://api.example.test/contributions",
			Headers:            map[string]string{"Accept": "text/html"},
			ContentType:        "text/html",
			MinIntervalMinutes: minutes,
			Commits: &vcsCommitsFetchSpec{
				Headers:            map[string]string{"Accept": "application/json"},
				ContentType:        "application/json",
				MinIntervalMinutes: minutes,
				// A tighter cap than the shared bound, so the oversized-body
				// canary below exercises the per-endpoint limit rather than
				// the shared one.
				MaxBytes: 64 << 10,
				Max:      4,
				Sources: []vcsCommitSourceSpec{
					{Repo: "first-repo", Endpoint: "https://api.example.test/repos/first/commits"},
					{Repo: "second-repo", Endpoint: "https://api.example.test/repos/second/commits"},
				},
			},
		}},
	)
	if err != nil {
		t.Fatalf("NewFetchSource() error = %v", err)
	}
	registry := newRegistry(fsys, []panelDefinition{
		{id: "vcs-activity", kind: KindVCSActivity, title: "Version-control activity", source: source},
	})
	return registry, registry.byID["vcs-activity"]
}

// activityAnswers scripts a healthy round for both producers.
func activityAnswers(t *testing.T) map[string]cannedAnswer {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "contributions-fragment.html"))
	if err != nil {
		t.Fatalf("read the captured contribution calendar: %v", err)
	}
	return map[string]cannedAnswer{
		"/contributions": {contentType: "text/html; charset=utf-8", body: string(raw)},
		"/repos/first/commits": {contentType: "application/json; charset=utf-8", body: commitDocument(
			[2]string{"feat(panels): the newest thing\n\nbody text", "2026-08-23T09:00:00Z"},
			[2]string{"fix(panels): the older thing", "2026-08-21T09:00:00Z"},
		)},
		"/repos/second/commits": {contentType: "application/json; charset=utf-8", body: commitDocument(
			[2]string{"docs: the middle thing", "2026-08-22T09:00:00Z"},
		)},
	}
}

// decodeActivity reads the panel's current payload.
func decodeActivity(t *testing.T, registry *Registry) (Envelope, VCSActivityData) {
	t.Helper()
	envelope := decodePanelEnvelope(t, registry, "vcs-activity")
	var payload VCSActivityData
	if err := decodeStrict(envelope.Data, &payload); err != nil {
		t.Fatalf("decode activity payload: %v", err)
	}
	return envelope, payload
}

// TestActivityRefreshServesLiveCommits is the owner's reported defect, stated
// as a scenario: a panel that cold-starts reporting no recent commits at all,
// refreshed once, must serve real commits merged newest-first across every
// configured repository — with each row's repo label taken from CONFIGURATION,
// its subject from the document, and the whole payload dated by the calendar
// rather than by the clock.
func TestActivityRefreshServesLiveCommits(t *testing.T) {
	t.Parallel()
	registry, state := activityFetchRegistry(t, 0)
	env := func(key string) string {
		t.Errorf("a public producer read the environment for %q", key)
		return ""
	}

	if _, cold := decodeActivity(t, registry); len(cold.RecentCommits) != 0 || cold.CommitsAt != "" {
		t.Fatalf("cold start already reports commits: %+v", cold)
	}

	doer := newRoutingDoer(activityAnswers(t))
	if err := registry.refreshPanel(t.Context(), state, doer, env); err != nil {
		t.Fatalf("refreshPanel() error = %v", err)
	}
	envelope, payload := decodeActivity(t, registry)
	if envelope.Status != StatusOK {
		t.Fatalf("status = %q, want ok with both producers healthy", envelope.Status)
	}
	// commitDocument assigns each repository's rows sha 0x1, 0x2, … in the
	// order passed to it (see its definition below); first-repo's two rows
	// and second-repo's one row each start that count over at 1, so the
	// SHAs below mirror the fixture rather than assert something the
	// fixture builder does not actually produce.
	want := []VCSCommit{
		{Repo: "first-repo", SHA: fixtureSHA(1), Message: "feat(panels): the newest thing", At: "2026-08-23T09:00:00Z"},
		{Repo: "second-repo", SHA: fixtureSHA(1), Message: "docs: the middle thing", At: "2026-08-22T09:00:00Z"},
		{Repo: "first-repo", SHA: fixtureSHA(2), Message: "fix(panels): the older thing", At: "2026-08-21T09:00:00Z"},
	}
	if len(payload.RecentCommits) != len(want) {
		t.Fatalf("served %d commits, want %d: %+v", len(payload.RecentCommits), len(want), payload.RecentCommits)
	}
	for index, expected := range want {
		if payload.RecentCommits[index] != expected {
			t.Errorf("commit[%d] = %+v, want %+v", index, payload.RecentCommits[index], expected)
		}
	}
	if payload.CommitsAt == "" {
		t.Error("a freshly fetched commit list carries no commitsAt; the payload cannot then say which half is older")
	}
	// The calendar half still maps, and the payload is dated by IT.
	if payload.TotalContributions != 499 || payload.EndDate != "2026-08-20" {
		t.Errorf("calendar half = total %d end %q, want the fixture's 499 / 2026-08-20", payload.TotalContributions, payload.EndDate)
	}
	if envelope.GeneratedAt == "" {
		t.Error("the payload carries no generatedAt")
	}
	// The document-type header each producer declares is what actually went
	// out: the calendar answers 406 to a JSON Accept header, the commit
	// documents want JSON, and neither is assumed in code.
	if got := doer.headers["/contributions"]; got != "text/html" {
		t.Errorf("calendar Accept = %q, want text/html", got)
	}
	if got := doer.headers["/repos/first/commits"]; got != "application/json" {
		t.Errorf("commit Accept = %q, want application/json", got)
	}
	// No authorization of any kind rode along. The producers are public, and
	// the environment lookup above already fails the test if one is read.
	if doer.total() != 3 {
		t.Errorf("the round took %d requests, want one per configured endpoint", doer.total())
	}
}

// TestHostileCommitUpstreamsKeepTheLastGoodList is the canary matrix for the
// commit producer. Each case makes the commit half hostile in ONE way while
// the calendar stays healthy, and every one of them must land in the same
// place: the previously fetched commit list keeps serving, the panel says
// stale, and commitsAt still names when that list was really read.
func TestHostileCommitUpstreamsKeepTheLastGoodList(t *testing.T) {
	t.Parallel()
	oversized := commitDocument([2]string{strings.Repeat("a", 300000), "2026-08-23T09:00:00Z"})
	for name, hostile := range map[string]cannedAnswer{
		"an error status":                {status: http.StatusInternalServerError, contentType: "application/json", body: "[]"},
		"a rate-limit refusal":           {status: http.StatusTooManyRequests, contentType: "application/json", body: "[]"},
		"a quota refusal":                {status: http.StatusForbidden, contentType: "application/json", body: "[]"},
		"markup where json was due":      {contentType: "text/html; charset=utf-8", body: commitDocument([2]string{"anything", "2026-08-23T09:00:00Z"})},
		"no declared document type":      {body: commitDocument([2]string{"anything", "2026-08-23T09:00:00Z"})},
		"a body over the byte bound":     {contentType: "application/json", body: oversized},
		"malformed json":                 {contentType: "application/json", body: `[{"sha":`},
		"an unrelated json document":     {contentType: "application/json", body: `[{"unrelated":"shape"}]`},
		"an empty commit list":           {contentType: "application/json", body: `[]`},
		"a transport that never answers": {transport: http.ErrHandlerTimeout},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			registry, state := activityFetchRegistry(t, 0)
			env := func(string) string { return "" }
			healthy := newRoutingDoer(activityAnswers(t))
			if err := registry.refreshPanel(t.Context(), state, healthy, env); err != nil {
				t.Fatalf("seed refresh error = %v", err)
			}
			_, seeded := decodeActivity(t, registry)
			if len(seeded.RecentCommits) == 0 {
				t.Fatal("the seed round served no commits; the scenario has nothing to retain")
			}

			answers := activityAnswers(t)
			answers["/repos/first/commits"] = hostile
			answers["/repos/second/commits"] = hostile
			if err := registry.refreshPanel(t.Context(), state, newRoutingDoer(answers), env); err != nil {
				t.Fatalf("the calendar half still mapped, so the round must succeed: %v", err)
			}
			envelope, payload := decodeActivity(t, registry)
			if envelope.Status != StatusStale {
				t.Errorf("status = %q, want stale: the commit half is not live", envelope.Status)
			}
			if len(payload.RecentCommits) != len(seeded.RecentCommits) {
				t.Fatalf("served %d commits, want the %d retained ones", len(payload.RecentCommits), len(seeded.RecentCommits))
			}
			for index, expected := range seeded.RecentCommits {
				if payload.RecentCommits[index] != expected {
					t.Errorf("commit[%d] = %+v, want the retained %+v", index, payload.RecentCommits[index], expected)
				}
			}
			if payload.CommitsAt != seeded.CommitsAt {
				t.Errorf("commitsAt = %q, want the retained %q: a stale list must not claim a fresh read", payload.CommitsAt, seeded.CommitsAt)
			}
		})
	}
}

// TestHostileCalendarUpstreamsKeepTheLastGoodPanel is the same matrix for the
// calendar half, where the failure is total: without a calendar there is no
// payload to build, so the whole round fails and the previous envelope keeps
// serving as stale.
func TestHostileCalendarUpstreamsKeepTheLastGoodPanel(t *testing.T) {
	t.Parallel()
	for name, hostile := range map[string]cannedAnswer{
		"json where markup was due":  {contentType: "application/json", body: "{}"},
		"no declared document type":  {body: "<html></html>"},
		"an error status":            {status: http.StatusBadGateway, contentType: "text/html", body: "<html></html>"},
		"a rate-limit refusal":       {status: http.StatusTooManyRequests, contentType: "text/html", body: "<html></html>"},
		"a signed-out page":          {contentType: "text/html", body: "<html><body>signed out</body></html>"},
		"a body over the byte bound": {contentType: "text/html", body: strings.Repeat("x", 2*1024*1024)},
		"a dead transport":           {transport: http.ErrHandlerTimeout},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			registry, state := activityFetchRegistry(t, 0)
			env := func(string) string { return "" }
			if err := registry.refreshPanel(t.Context(), state, newRoutingDoer(activityAnswers(t)), env); err != nil {
				t.Fatalf("seed refresh error = %v", err)
			}
			_, seeded := decodeActivity(t, registry)

			answers := activityAnswers(t)
			answers["/contributions"] = hostile
			if err := registry.refreshPanel(t.Context(), state, newRoutingDoer(answers), env); err == nil {
				t.Fatal("a hostile calendar answer was accepted")
			}
			envelope, payload := decodeActivity(t, registry)
			if envelope.Status != StatusStale {
				t.Errorf("status = %q, want stale", envelope.Status)
			}
			if payload.TotalContributions != seeded.TotalContributions || len(payload.RecentCommits) != len(seeded.RecentCommits) {
				t.Errorf("the last good payload was not retained: %+v", payload)
			}
		})
	}
}

// TestRateBudgetHoldsTheOriginBackFromItsUpstreams is the cadence contract
// observed as behavior rather than read off a constant: with a budget
// configured, the loop's second pass inside the window contacts NOTHING, does
// not disturb the served payload, and reports the "nothing due" outcome the
// scheduler must not mistake for a failure.
func TestRateBudgetHoldsTheOriginBackFromItsUpstreams(t *testing.T) {
	t.Parallel()
	registry, state := activityFetchRegistry(t, 15)
	env := func(string) string { return "" }
	doer := newRoutingDoer(activityAnswers(t))
	if err := registry.refreshPanel(t.Context(), state, doer, env); err != nil {
		t.Fatalf("first pass error = %v", err)
	}
	firstRound := doer.total()
	envelope, payload := decodeActivity(t, registry)

	for pass := range 5 {
		err := registry.refreshPanel(t.Context(), state, poisonedDoer{t: t}, env)
		if !errors.Is(err, errNothingDue) {
			t.Fatalf("pass %d error = %v, want the nothing-due outcome", pass+2, err)
		}
	}
	if got := doer.total(); got != firstRound {
		t.Errorf("the transport was reached %d times, want the %d of the first pass only", got, firstRound)
	}
	// Nothing due must leave the served state exactly as it was — in
	// particular it must NOT mark the panel stale, which would turn
	// politeness into a false freshness signal.
	after, afterPayload := decodeActivity(t, registry)
	if after.Status != envelope.Status || after.GeneratedAt != envelope.GeneratedAt {
		t.Errorf("a skipped pass changed the envelope: %q/%q became %q/%q", envelope.Status, envelope.GeneratedAt, after.Status, after.GeneratedAt)
	}
	if afterPayload.CommitsAt != payload.CommitsAt {
		t.Errorf("a skipped pass changed commitsAt: %q became %q", payload.CommitsAt, afterPayload.CommitsAt)
	}
	if decodeIndex(t, registry).Panels[0].Status != envelope.Status {
		t.Error("a skipped pass moved the index row")
	}
}

// TestTheCalendarDatesThePayloadEvenWhenOnlyCommitsRefresh is the honesty
// invariant at the seam between two producers on different budgets. With the
// calendar's budget still unspent and the commit budget already free, a round
// refreshes ONLY the commit half — and the payload must then keep the
// calendar's original instant as generatedAt while commitsAt moves. Dating the
// payload with the clock instead would advertise a calendar that is minutes
// old as if it had just been read.
func TestTheCalendarDatesThePayloadEvenWhenOnlyCommitsRefresh(t *testing.T) {
	t.Parallel()
	fsys := fstest.MapFS{"snapshots/activity.json": {Data: []byte(activityFixtureSnapshot)}}
	source, err := NewFetchSource(
		SnapshotSource{Name: "snapshots/activity.json"},
		validFetchConfig(),
		panelFetchSpecs{vcs: &vcsActivityFetchSpec{
			Endpoint:    "https://api.example.test/contributions",
			Headers:     map[string]string{"Accept": "text/html"},
			ContentType: "text/html",
			// The calendar carries a budget; the commit half deliberately
			// carries none, so a second immediate round has exactly one of
			// the two producers due.
			MinIntervalMinutes: 30,
			Commits: &vcsCommitsFetchSpec{
				Headers:     map[string]string{"Accept": "application/json"},
				ContentType: "application/json",
				Max:         4,
				Sources:     []vcsCommitSourceSpec{{Repo: "first-repo", Endpoint: "https://api.example.test/repos/first/commits"}},
			},
		}},
	)
	if err != nil {
		t.Fatalf("NewFetchSource() error = %v", err)
	}
	registry := newRegistry(fsys, []panelDefinition{
		{id: "vcs-activity", kind: KindVCSActivity, title: "Version-control activity", source: source},
	})
	state := registry.byID["vcs-activity"]
	env := func(string) string { return "" }

	doer := newRoutingDoer(activityAnswers(t))
	if err := registry.refreshPanel(t.Context(), state, doer, env); err != nil {
		t.Fatalf("first round error = %v", err)
	}
	first, firstPayload := decodeActivity(t, registry)

	// The second round advances the commit list. A different newest commit
	// makes the advance observable rather than inferred.
	answers := activityAnswers(t)
	answers["/repos/first/commits"] = cannedAnswer{contentType: "application/json", body: commitDocument(
		[2]string{"feat(panels): a commit that landed since", "2026-08-23T11:00:00Z"},
	)}
	if err := registry.refreshPanel(t.Context(), state, newRoutingDoer(answers), env); err != nil {
		t.Fatalf("second round error = %v", err)
	}
	second, secondPayload := decodeActivity(t, registry)

	if doer.countOf("/contributions") != 1 {
		t.Errorf("the calendar was fetched %d times; its budget was still unspent", doer.countOf("/contributions"))
	}
	if second.GeneratedAt != first.GeneratedAt {
		t.Errorf("generatedAt moved from %q to %q without the calendar being re-read; the payload would claim a freshness the calendar does not have",
			first.GeneratedAt, second.GeneratedAt)
	}
	// commitsAt tracks the read that actually happened. Both rounds land
	// inside the same wall-clock second here, so the assertion that carries
	// weight is that it never goes BACKWARDS while the rows move forward —
	// the advance itself is proven by the changed row below.
	if secondPayload.CommitsAt < firstPayload.CommitsAt {
		t.Errorf("commitsAt went backwards, %q then %q", firstPayload.CommitsAt, secondPayload.CommitsAt)
	}
	if secondPayload.CommitsAt == "" {
		t.Error("a freshly refreshed commit list reports no commitsAt")
	}
	// The retained calendar is the real one, not a re-fetch and not the
	// cold-start snapshot.
	if secondPayload.TotalContributions != firstPayload.TotalContributions || secondPayload.EndDate != firstPayload.EndDate {
		t.Errorf("the retained calendar changed: %+v then %+v", firstPayload, secondPayload)
	}
	if len(secondPayload.RecentCommits) != 1 || secondPayload.RecentCommits[0].Message != "feat(panels): a commit that landed since" {
		t.Errorf("the commit half did not advance: %+v", secondPayload.RecentCommits)
	}
	if second.Status != StatusOK {
		t.Errorf("status = %q; a calendar inside its own budget is current, not stale", second.Status)
	}
}

// TestTheLoopRespectsARateBudgetAcrossItsWakes is the scheduler half of the
// cadence contract, driven through the REAL background loop rather than
// through direct refresh calls: the loop wakes many times inside one budget
// window and the upstream is contacted exactly once. A loop that treated
// "nothing due" as a failure would instead climb its retry ladder and mark a
// perfectly current panel stale.
func TestTheLoopRespectsARateBudgetAcrossItsWakes(t *testing.T) {
	t.Parallel()
	registry, _ := activityFetchRegistry(t, int(maxEndpointInterval/time.Minute))
	doer := newRoutingDoer(activityAnswers(t))
	state := registry.byID["vcs-activity"]
	state.fetch.config.TTL = 5 * time.Millisecond
	state.fetch.config.Timeout = time.Millisecond
	state.fetch.config.InitialBackoff = time.Millisecond
	state.fetch.config.MaxBackoff = 2 * time.Millisecond

	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	registry.startRefresh(ctx, doer, func(string) string { return "" })
	deadline := time.Now().Add(3 * time.Second)
	for decodePanelEnvelope(t, registry, "vcs-activity").Status != StatusOK {
		if time.Now().After(deadline) {
			t.Fatal("the panel never became ok under the refresh loop")
		}
		time.Sleep(2 * time.Millisecond)
	}
	afterFirst := doer.total()
	// Many more wakes than the first one, all inside the budget window.
	time.Sleep(200 * time.Millisecond)
	cancel()
	if got := doer.total(); got != afterFirst {
		t.Errorf("the loop made %d requests across ~40 wakes, want the %d of its first pass", got, afterFirst)
	}
	if got := decodePanelEnvelope(t, registry, "vcs-activity").Status; got != StatusOK {
		t.Errorf("status = %q after wakes that fetched nothing; a spent budget is not a failure", got)
	}
}

// TestTheLoopKeepsItsCadenceWhileABudgetIsSpent is the scheduler's other
// half, and it is about TIMING rather than about served bytes. A wake that
// finds nothing due must leave the retry ladder alone: a loop that treated it
// as a failure would reset its timer to the backoff delay instead of the
// cadence, and the panel's first real refresh would arrive a backoff late
// rather than the moment its budget frees.
//
// The margins are deliberately enormous — a budget measured in tens of
// milliseconds against a backoff measured in seconds — so a machine under
// load fails this only if the behavior really regressed.
func TestTheLoopKeepsItsCadenceWhileABudgetIsSpent(t *testing.T) {
	t.Parallel()
	registry, state := activityFetchRegistry(t, 0)
	source := state.fetch
	source.config.TTL = 5 * time.Millisecond
	source.config.Timeout = time.Millisecond
	// A retry ladder far longer than the budget: if the loop mistakes a
	// spent budget for a failure, the next attempt lands seconds away.
	source.config.InitialBackoff = 3 * time.Second
	source.config.MaxBackoff = 6 * time.Second
	// Both producers are held back for a moment, so the loop's first several
	// wakes have nothing to do.
	held := 60 * time.Millisecond
	now := time.Now()
	if !source.reserve(roleVCSCalendar, now, held) || !source.reserve(roleVCSCommits, now, held) {
		t.Fatal("the budgets were already spent")
	}
	doer := newRoutingDoer(activityAnswers(t))
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	registry.startRefresh(ctx, doer, func(string) string { return "" })
	deadline := time.Now().Add(time.Second)
	for decodePanelEnvelope(t, registry, "vcs-activity").Status != StatusOK {
		if time.Now().After(deadline) {
			cancel()
			t.Fatalf("the panel was still %q a second after its budget freed; the loop backed off instead of keeping its cadence",
				decodePanelEnvelope(t, registry, "vcs-activity").Status)
		}
		time.Sleep(2 * time.Millisecond)
	}
	cancel()
}

// TestRateBudgetCountsAttemptsNotSuccesses closes the retry-storm hole: an
// endpoint that FAILED still spends its budget, so a broken upstream is
// retried on the same cadence a healthy one is polled — which is precisely
// what stops a backoff ladder from walking into a rate limit.
func TestRateBudgetCountsAttemptsNotSuccesses(t *testing.T) {
	t.Parallel()
	registry, state := activityFetchRegistry(t, 15)
	env := func(string) string { return "" }
	answers := activityAnswers(t)
	answers["/contributions"] = cannedAnswer{status: http.StatusBadGateway, contentType: "text/html", body: "<html></html>"}
	doer := newRoutingDoer(answers)
	if err := registry.refreshPanel(t.Context(), state, doer, env); err == nil {
		t.Fatal("the failing calendar answer was accepted")
	}
	if got := doer.countOf("/contributions"); got != 1 {
		t.Fatalf("calendar attempts = %d, want 1", got)
	}
	if err := registry.refreshPanel(t.Context(), state, doer, env); !errors.Is(err, errNothingDue) {
		t.Fatalf("second pass error = %v, want the nothing-due outcome", err)
	}
	if got := doer.countOf("/contributions"); got != 1 {
		t.Errorf("calendar attempts = %d after a failure; a failed attempt must still spend its budget", got)
	}
}

// TestNeverFetchedCommitsAreNeverPresentedAsFresh is the honesty invariant at
// its sharpest corner: a panel whose calendar is live but whose commit
// producer has never answered must serve an empty list, no commitsAt, and a
// stale envelope. Serving an empty list as OK would tell a reader "there are
// no recent commits" when the truth is "nobody managed to look".
func TestNeverFetchedCommitsAreNeverPresentedAsFresh(t *testing.T) {
	t.Parallel()
	registry, state := activityFetchRegistry(t, 0)
	answers := activityAnswers(t)
	dead := cannedAnswer{transport: http.ErrHandlerTimeout}
	answers["/repos/first/commits"] = dead
	answers["/repos/second/commits"] = dead
	if err := registry.refreshPanel(t.Context(), state, newRoutingDoer(answers), func(string) string { return "" }); err != nil {
		t.Fatalf("refreshPanel() error = %v", err)
	}
	envelope, payload := decodeActivity(t, registry)
	if envelope.Status != StatusStale {
		t.Errorf("status = %q, want stale", envelope.Status)
	}
	if len(payload.RecentCommits) != 0 {
		t.Errorf("recentCommits = %+v, want an empty list", payload.RecentCommits)
	}
	if payload.CommitsAt != "" {
		t.Errorf("commitsAt = %q, want it absent: no list has ever been read", payload.CommitsAt)
	}
	// And the empty list is an ARRAY, not a null: a payload the frontend has
	// to special-case is a payload that renders wrong once.
	if !bytes.Contains(envelope.Data, []byte(`"recentCommits":[]`)) {
		t.Errorf("payload = %s, want an explicit empty array", envelope.Data)
	}
}

// TestAGatedCommitProducerThatNeverAnsweredIsStillStale closes the corner
// where the two honesty rules meet: a commit budget already spent, and no
// successful fetch behind it. The gated branch has a retained list to hand
// back — an EMPTY one — and reporting that as current would tell a reader
// "there are no recent commits" on the strength of a request nobody has ever
// completed. The budget being spent is not evidence about the data.
func TestAGatedCommitProducerThatNeverAnsweredIsStillStale(t *testing.T) {
	t.Parallel()
	registry, state := activityFetchRegistry(t, 0)
	// Spend the commit budget without ever fetching: the next round finds the
	// gate closed and has to fall back to the retained (empty) list.
	if !state.fetch.reserve(roleVCSCommits, time.Now(), time.Hour) {
		t.Fatal("the commit budget was already spent")
	}
	if err := registry.refreshPanel(t.Context(), state, newRoutingDoer(activityAnswers(t)), func(string) string { return "" }); err != nil {
		t.Fatalf("refreshPanel() error = %v", err)
	}
	envelope, payload := decodeActivity(t, registry)
	if envelope.Status != StatusStale {
		t.Errorf("status = %q, want stale: no commit list has ever been read", envelope.Status)
	}
	if len(payload.RecentCommits) != 0 || payload.CommitsAt != "" {
		t.Errorf("a never-fetched commit list reported itself as data: %+v", payload)
	}
	// The calendar half still refreshed, so the stale verdict is about the
	// commit half specifically and not about a round that did nothing.
	if payload.TotalContributions != 499 {
		t.Errorf("the calendar half did not refresh: total = %d", payload.TotalContributions)
	}
}

// TestARateLimitRefusalBuysMoreQuietThanTheOrdinaryCadence pins the one thing
// that makes a 429 different from any other bad status. Both keep the last
// good data — the canary matrix already proves that — so the distinguishing
// behavior is what happens NEXT: an ordinary failure is retried on the
// ordinary cadence, while a refusal that says "too often" pushes the endpoint
// out to the backoff ceiling. Without the contrast the special case would be
// decorative.
func TestARateLimitRefusalBuysMoreQuietThanTheOrdinaryCadence(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		first         cannedAnswer
		wantSecondTry bool
	}{
		"an ordinary failure is retried on the ordinary cadence": {
			first:         cannedAnswer{status: http.StatusInternalServerError, contentType: "application/json", body: "[]"},
			wantSecondTry: true,
		},
		"a rate-limit refusal is not": {
			first:         cannedAnswer{status: http.StatusTooManyRequests, contentType: "application/json", body: "[]"},
			wantSecondTry: false,
		},
		"a quota refusal is not either": {
			first:         cannedAnswer{status: http.StatusForbidden, contentType: "application/json", body: "[]"},
			wantSecondTry: false,
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			// No cadence of its own: without the cooldown, EVERY round would
			// attempt the commit endpoints again, so a skipped second round
			// can only be the rate-limit backoff.
			registry, state := activityFetchRegistry(t, 0)
			env := func(string) string { return "" }
			answers := activityAnswers(t)
			answers["/repos/first/commits"] = tc.first
			answers["/repos/second/commits"] = tc.first
			first := newRoutingDoer(answers)
			if err := registry.refreshPanel(t.Context(), state, first, env); err != nil {
				t.Fatalf("first round error = %v", err)
			}
			if got := first.countOf("/repos/first/commits"); got != 1 {
				t.Fatalf("first round made %d commit attempts, want 1", got)
			}
			second := newRoutingDoer(activityAnswers(t))
			if err := registry.refreshPanel(t.Context(), state, second, env); err != nil {
				t.Fatalf("second round error = %v", err)
			}
			tried := second.countOf("/repos/first/commits") > 0
			if tried != tc.wantSecondTry {
				t.Errorf("second round attempted the commit endpoint = %v, want %v", tried, tc.wantSecondTry)
			}
			// The calendar is untouched by the commit half's cooldown: one
			// producer's backoff must never silence the other.
			if got := second.countOf("/contributions"); got != 1 {
				t.Errorf("the calendar was attempted %d times in the second round, want 1", got)
			}
		})
	}
}

// TestPartialCommitRoundIsHonestlyStale covers the middle case the canary
// matrix does not: one repository answers and another does not. The rows that
// arrived are served — losing them would be worse — but the panel says stale,
// because the list a reader sees is not the complete one.
func TestPartialCommitRoundIsHonestlyStale(t *testing.T) {
	t.Parallel()
	registry, state := activityFetchRegistry(t, 0)
	answers := activityAnswers(t)
	answers["/repos/second/commits"] = cannedAnswer{status: http.StatusInternalServerError, contentType: "application/json", body: "[]"}
	if err := registry.refreshPanel(t.Context(), state, newRoutingDoer(answers), func(string) string { return "" }); err != nil {
		t.Fatalf("refreshPanel() error = %v", err)
	}
	envelope, payload := decodeActivity(t, registry)
	if envelope.Status != StatusStale {
		t.Errorf("status = %q, want stale for an incomplete round", envelope.Status)
	}
	if len(payload.RecentCommits) != 2 {
		t.Fatalf("served %d commits, want the 2 that did arrive: %+v", len(payload.RecentCommits), payload.RecentCommits)
	}
	for _, commit := range payload.RecentCommits {
		if commit.Repo != "first-repo" {
			t.Errorf("commit from %q survived a failed source: %+v", commit.Repo, commit)
		}
	}
}

// TestSlowCommitUpstreamIsBoundedByTheAttemptTimeout is the slow-upstream
// canary over a REAL socket, because a fake transport cannot stall: a
// commit producer that never answers costs one attempt timeout and leaves the
// panel serving its calendar with the retained commit list.
func TestSlowCommitUpstreamIsBoundedByTheAttemptTimeout(t *testing.T) {
	t.Parallel()
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	t.Cleanup(server.Close)
	_, config := loopbackConfig(t, server.URL)
	// Two seconds, not tens of milliseconds: this suite also runs inside
	// the container build's emulated arm64 leg, where a loopback TLS
	// handshake alone can blow a 40ms budget (CI failed exactly there,
	// 2026-08-24). The property under test is unchanged - the stalled
	// producer costs at most ONE attempt timeout, pinned by the elapsed
	// ceiling below - and the healthy calendar leg needs headroom that
	// emulation cannot steal.
	config.Timeout = 2 * time.Second
	fsys := fstest.MapFS{"snapshots/activity.json": {Data: []byte(activityFixtureSnapshot)}}
	raw, err := os.ReadFile(filepath.Join("testdata", "contributions-fragment.html"))
	if err != nil {
		t.Fatalf("read the captured contribution calendar: %v", err)
	}
	calendar := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(raw)
	}))
	t.Cleanup(calendar.Close)
	calendarHost, _ := loopbackConfig(t, calendar.URL)
	config.Hosts = append(config.Hosts, calendarHost)
	source, err := NewFetchSource(
		SnapshotSource{Name: "snapshots/activity.json"},
		config,
		panelFetchSpecs{vcs: &vcsActivityFetchSpec{
			Endpoint:    calendar.URL + "/contributions",
			Headers:     map[string]string{"Accept": "text/html"},
			ContentType: "text/html",
			Commits: &vcsCommitsFetchSpec{
				Headers:     map[string]string{"Accept": "application/json"},
				ContentType: "application/json",
				Max:         4,
				Sources:     []vcsCommitSourceSpec{{Repo: "stalled-repo", Endpoint: server.URL + "/commits"}},
			},
		}},
	)
	if err != nil {
		t.Fatalf("NewFetchSource() error = %v", err)
	}
	registry := newRegistry(fsys, []panelDefinition{
		{id: "vcs-activity", kind: KindVCSActivity, title: "Version-control activity", source: source},
	})
	state := registry.byID["vcs-activity"]
	started := time.Now()
	if err := registry.refreshPanel(t.Context(), state, loopbackDoer(server, calendar), func(string) string { return "" }); err != nil {
		t.Fatalf("the calendar mapped, so the round must succeed: %v", err)
	}
	if elapsed := time.Since(started); elapsed > 4*config.Timeout {
		t.Errorf("the round took %v; a stalled upstream must be bounded by the attempt timeout", elapsed)
	}
	envelope, payload := decodeActivity(t, registry)
	if envelope.Status != StatusStale {
		t.Errorf("status = %q, want stale with a stalled commit producer", envelope.Status)
	}
	if payload.TotalContributions != 499 {
		t.Errorf("the calendar half did not map through: total = %d", payload.TotalContributions)
	}
	if len(payload.RecentCommits) != 0 || payload.CommitsAt != "" {
		t.Errorf("a stalled producer produced commits: %+v", payload)
	}
}
