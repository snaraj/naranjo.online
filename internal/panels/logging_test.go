// logging_test proves the refresh narrative: failed cycles WARN with the
// error chain and the exact next-retry instant, successful cycles log one
// INFO summary, rate-budget idles say so at DEBUG, per-attempt fetch detail
// carries host/status/bytes at DEBUG, and per-source usage/commit failures
// WARN where they degrade. It also pins the privacy floor of every one of
// those records: hosts and labels only — never a URL, path, credential, or
// payload byte — and quiet-by-default sources for every directly driven
// test.
package panels

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"testing/synctest"
	"time"
)

// safeBuffer is a mutex-guarded buffer for records written by refresh-loop
// goroutines while the test reads.
type safeBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (b *safeBuffer) Write(data []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.Write(data)
}

func (b *safeBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.String()
}

// refreshLogRecords decodes one JSON record per non-empty line.
func refreshLogRecords(t *testing.T, output string) []map[string]any {
	t.Helper()
	var records []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		if line == "" {
			continue
		}
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("log line is not one JSON object: %v\nline: %q", err, line)
		}
		records = append(records, record)
	}
	return records
}

// findRecord returns the first record whose msg matches, or nil.
func findRecord(records []map[string]any, msg string) map[string]any {
	for _, record := range records {
		if record["msg"] == msg {
			return record
		}
	}
	return nil
}

// assertNoUpstreamURL is the privacy pin every narrative test runs: a
// refresh record may name a host and a label, never a URL or a request
// path, because usage endpoints carry query parameters and configuration
// may embed account-specific paths. The banned list includes the
// query-secret sentinel the production-shaped *url.Error probes carry, so
// this pin catches the exact disclosure shape Daybreak demonstrated in
// PR #184 round 1 — a transport error whose string embeds the full URL.
func assertNoUpstreamURL(t *testing.T, output string) {
	t.Helper()
	for _, banned := range []string{"https://", "http://", "scores.json", "/usage-a", "/usage-b", "/repos/", "starting_at=", "?account=", urlErrorQuerySecret} {
		if strings.Contains(output, banned) {
			t.Errorf("refresh narrative leaked %q; records carry hosts and labels only:\n%s", banned, output)
		}
	}
}

// urlErrorQuerySecret is the sentinel query value the production-shaped
// transport-error probes embed; its appearance anywhere in log output is
// the disclosure this round's fix exists to prevent.
const urlErrorQuerySecret = "query-secret-must-not-enter-logs"

// urlErrorDoer models the PRODUCTION transport-failure shape, which the
// plain-error scriptedDoer cannot: net/http's client wraps every DNS, TLS,
// dial, timeout, and redirect failure in *url.Error, and that error's
// string embeds the complete request URL — query parameters included.
type urlErrorDoer struct{}

func (urlErrorDoer) Do(r *http.Request) (*http.Response, error) {
	return nil, &url.Error{Op: "Get", URL: r.URL.String(), Err: errors.New("connection reset by peer")}
}

// TestARateLimitCooldownWarnsWithTheSilencedSource pins the narration issue
// 281's defect 3 demanded: a quota refusal silences a role for the full
// backoff ceiling, every wake inside that window is only a DEBUG idle line,
// and before this record the silence was indistinguishable from health in a
// cluster log. The record names the role and the instant the silence ends —
// and nothing else: no URL, no credential, no upstream byte.
func TestARateLimitCooldownWarnsWithTheSilencedSource(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	var out safeBuffer
	source := projectsSource(t)
	source.setLogger(slog.New(slog.NewJSONHandler(&out, &slog.HandlerOptions{Level: slog.LevelDebug})))
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/users/owner/repos": {status: http.StatusForbidden, contentType: "application/json", body: "{}"},
	})
	if _, err := source.refreshProjects(t.Context(), doer, func(string) string { return "" }, now); err == nil {
		t.Fatal("a rate-limited round reported success")
	}
	records := refreshLogRecords(t, out.String())
	cooling := findRecord(records, "source cooling down: the upstream refused for rate reasons")
	if cooling == nil {
		t.Fatalf("no cooldown record in %q", out.String())
	}
	if cooling["level"] != "WARN" || cooling["source"] != roleCodingProjects {
		t.Errorf("cooldown record = %v, want WARN naming the silenced role", cooling)
	}
	if cooling["until"] == nil {
		t.Error("the cooldown record names no until instant; an operator cannot tell silence from health without it")
	}
	assertNoUpstreamURL(t, out.String())
	// The silenced window is real: a wake inside it attempts nothing.
	if _, err := source.refreshProjects(t.Context(), doer, func(string) string { return "" }, now.Add(time.Minute)); !errors.Is(err, errNothingDue) {
		t.Fatalf("a wake inside the cooldown reported %v, want errNothingDue", err)
	}
}

// TestRefreshLoopWarnsOnFailureWithNextRetry drives the real loop under
// synctest against a transport that always fails: the first cycle must WARN
// with the panel id, the error chain, and the exact next-retry instant one
// initial backoff away — the line an operator needs to know both WHAT broke
// and WHEN the process will try again.
func TestRefreshLoopWarnsOnFailureWithNextRetry(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		out := &safeBuffer{}
		registry, _ := bossFetchRegistry(t, "https://api.example.test/scores.json", validFetchConfig())
		registry.logger = slog.New(slog.NewJSONHandler(out, nil))
		ctx, cancel := context.WithCancel(t.Context())
		start := time.Now()
		// An exhausted scriptedDoer fails every attempt.
		registry.startRefresh(ctx, &scriptedDoer{}, func(string) string { return "" })
		synctest.Wait()
		cancel()
		synctest.Wait()

		record := findRecord(refreshLogRecords(t, out.String()), "panel refresh failed")
		if record == nil {
			t.Fatalf("no failure WARN in %q", out.String())
		}
		if record["level"] != "WARN" || record["panel"] != "boss-log" {
			t.Errorf("failure record level/panel = %v/%v, want WARN/boss-log", record["level"], record["panel"])
		}
		errText, _ := record["error"].(string)
		if !strings.Contains(errText, "fetch api.example.test") {
			t.Errorf("failure record error = %q, want the host-naming error chain", errText)
		}
		nextRetry, err := time.Parse(time.RFC3339Nano, record["next_retry"].(string))
		if err != nil {
			t.Fatalf("next_retry %v is not a timestamp: %v", record["next_retry"], err)
		}
		// The synctest clock is deterministic: the first retry sits exactly
		// one initial backoff after the immediate first attempt.
		if want := start.Add(validFetchConfig().InitialBackoff); !nextRetry.Equal(want) {
			t.Errorf("next_retry = %v, want %v (start + initial backoff)", nextRetry, want)
		}
		assertNoUpstreamURL(t, out.String())
	})
}

// TestRefreshLoopSummarizesSuccessAndIdle drives one successful cycle and
// then a budget-idle wake: the success logs one INFO summary with the
// served status and next-refresh instant, and the idle wake says so at
// DEBUG instead of pretending anything was refreshed.
func TestRefreshLoopSummarizesSuccessAndIdle(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		out := &safeBuffer{}
		fsys := fstest.MapFS{"snapshots/boss.json": {Data: validSnapshot(t)}}
		// A 60-minute endpoint budget against a 15-minute TTL guarantees the
		// second wake finds the endpoint inside its budget: an idle cycle.
		source, err := NewFetchSource(
			SnapshotSource{Name: "snapshots/boss.json"},
			validFetchConfig(),
			panelFetchSpecs{bossLog: &bossLogFetchSpec{
				Endpoint: "https://api.example.test/scores.json", Account: "fixture",
				ExcludeActivities: []string{"Fixture Activity"}, MinIntervalMinutes: 60,
			}},
		)
		if err != nil {
			t.Fatalf("NewFetchSource() error = %v", err)
		}
		registry := newRegistry(fsys, []panelDefinition{{id: "boss-log", kind: KindBossLog, title: "Boss log", source: source}})
		registry.logger = slog.New(slog.NewJSONHandler(out, &slog.HandlerOptions{Level: slog.LevelDebug}))

		ctx, cancel := context.WithCancel(t.Context())
		start := time.Now()
		registry.startRefresh(ctx, &scriptedDoer{bodies: []string{fixtureHiscores}}, func(string) string { return "" })
		synctest.Wait()
		// Advance past one TTL so the loop wakes again and finds the
		// endpoint still inside its 60-minute budget.
		time.Sleep(validFetchConfig().TTL + time.Second)
		synctest.Wait()
		cancel()
		synctest.Wait()

		records := refreshLogRecords(t, out.String())
		success := findRecord(records, "panel refreshed")
		if success == nil {
			t.Fatalf("no success INFO in %q", out.String())
		}
		if success["level"] != "INFO" || success["panel"] != "boss-log" || success["status"] != string(StatusOK) {
			t.Errorf("success record = level %v panel %v status %v, want INFO/boss-log/ok", success["level"], success["panel"], success["status"])
		}
		nextRefresh, err := time.Parse(time.RFC3339Nano, success["next_refresh"].(string))
		if err != nil {
			t.Fatalf("next_refresh %v is not a timestamp: %v", success["next_refresh"], err)
		}
		if want := start.Add(validFetchConfig().TTL); !nextRefresh.Equal(want) {
			t.Errorf("next_refresh = %v, want %v (start + TTL)", nextRefresh, want)
		}
		idle := findRecord(records, "panel refresh idle: every endpoint inside its rate budget")
		if idle == nil {
			t.Fatalf("no idle DEBUG in %q", out.String())
		}
		if idle["level"] != "DEBUG" || idle["panel"] != "boss-log" {
			t.Errorf("idle record = level %v panel %v, want DEBUG/boss-log", idle["level"], idle["panel"])
		}
		assertNoUpstreamURL(t, out.String())
	})
}

// TestDataRootFailureLogsOnceAndSameDocumentRecovers covers the origin-side
// silence that made a landed but refused usage push indistinguishable from a
// frozen scheduler. One bad ciphertext warns with its cause exactly once no
// matter how many ticks it survives; restoring the exact accepted ciphertext
// writes one recovery transition and returns the envelope to ok without
// waiting for a newer capture.
func TestDataRootFailureLogsOnceAndSameDocumentRecovers(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		out := &safeBuffer{}
		registry, state := usageDataRootRegistry(t, synctestSnapshot)
		registry.logger = slog.New(slog.NewJSONHandler(out, nil))
		accepted := sealDocument(t, synctestDocument("2000-01-01T00:00:00Z"))
		fsys := &lockedFS{inner: seriesFS(accepted)}
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		registry.startDataRoot(ctx, fsys, productionUnsealer(dataRootTestKeyHex), nil, time.Now)
		synctest.Wait()

		tampered := append([]byte(nil), accepted...)
		tampered[len(tampered)-1] ^= 0x01
		fsys.swap(seriesFS(tampered))
		time.Sleep(dataRootTTL)
		synctest.Wait()
		if envelope, _ := decodeServedUsage(t, state); envelope.Status != StatusStale {
			t.Fatalf("tampered source left status %q, want stale", envelope.Status)
		}
		// The identical failure survives more ticks but produces no duplicate
		// WARN records.
		time.Sleep(3 * dataRootTTL)
		synctest.Wait()

		fsys.swap(seriesFS(accepted))
		time.Sleep(dataRootTTL)
		synctest.Wait()
		if envelope, _ := decodeServedUsage(t, state); envelope.Status != StatusOK {
			t.Fatalf("restored accepted source left status %q, want ok", envelope.Status)
		}

		records := refreshLogRecords(t, out.String())
		failures := 0
		recoveries := 0
		for _, record := range records {
			switch record["msg"] {
			case "failed to fetch token usage":
				failures++
				// A tampered ciphertext fails at the seal, and the record says
				// exactly that and nothing about the bytes: no error text, no
				// document field (2026-09-04 security review, finding 1).
				if record["level"] != "WARN" || record["panel"] != dataRootPanelID || record["reason"] != reasonSealRefused || record["next_retry"] == nil {
					t.Errorf("failure record = %v", record)
				}
				if _, leaked := record["error"]; leaked {
					t.Errorf("failure record carries the error text: %v", record)
				}
			case "token usage data root recovered":
				recoveries++
				if record["level"] != "INFO" || record["status"] != string(StatusOK) || record["cleared"] != reasonSealRefused || record["next_refresh"] == nil {
					t.Errorf("recovery record = %v", record)
				}
				if _, leaked := record["generated_at"]; leaked {
					t.Errorf("recovery record carries the document's instant: %v", record)
				}
			}
		}
		if failures != 1 || recoveries != 1 {
			t.Fatalf("records contain %d failures and %d recoveries, want one each: %s", failures, recoveries, out.String())
		}
		assertNoUpstreamURL(t, out.String())
	})
}

// TestFetchAttemptNarratesHostStatusAndBytes pins the per-attempt DEBUG
// detail: source role, bare host, upstream status, byte count, and duration
// — and, by the shared privacy pin, that the endpoint's path and query
// never ride along.
func TestFetchAttemptNarratesHostStatusAndBytes(t *testing.T) {
	t.Parallel()
	var out bytes.Buffer
	registry, state := bossFetchRegistry(t, "https://api.example.test/scores.json", validFetchConfig())
	state.fetch.setLogger(slog.New(slog.NewJSONHandler(&out, &slog.HandlerOptions{Level: slog.LevelDebug})))
	if err := registry.refreshPanel(t.Context(), state, &scriptedDoer{bodies: []string{fixtureHiscores}}, func(string) string { return "" }); err != nil {
		t.Fatalf("refreshPanel() error = %v", err)
	}
	record := findRecord(refreshLogRecords(t, out.String()), "upstream fetch")
	if record == nil {
		t.Fatalf("no fetch DEBUG in %q", out.String())
	}
	if record["source"] != roleBossLog || record["server.address"] != "api.example.test" || record["http.response.status_code"] != float64(200) {
		t.Errorf("fetch record = source %v host %v status %v, want %s/api.example.test/200", record["source"], record["server.address"], record["http.response.status_code"], roleBossLog)
	}
	if bytesFetched, ok := record["http.response.body.size"].(float64); !ok || bytesFetched <= 0 {
		t.Errorf("fetch record bytes = %v, want a positive count", record["http.response.body.size"])
	}
	if _, ok := record["duration_ms"].(float64); !ok {
		t.Errorf("fetch record duration_ms = %v, want a number", record["duration_ms"])
	}
	assertNoUpstreamURL(t, out.String())
}

// TestUsageRefreshNarratesSkipsFailuresAndFallback pins the per-source
// usage narrative, the reason "why is this panel stale" is answerable from
// a cluster log: a credential-less source logs a DEBUG skip, a failing
// source logs a WARN that never propagates anywhere else, and a successful
// cycle ends with the DEBUG summary counting ok/failed/skipped and whether
// the snapshot fallback filled in.
func TestUsageRefreshNarratesSkipsFailuresAndFallback(t *testing.T) {
	t.Parallel()

	t.Run("skip plus success yields counts and fallback flag", func(t *testing.T) {
		t.Parallel()
		var out bytes.Buffer
		registry := newRegistry(snapshotFiles, []panelDefinition{
			{id: "token-usage", kind: KindTokenUsageV2, title: "Token usage", source: usageFetchSource(t)},
		})
		state := registry.byID["token-usage"]
		state.fetch.setLogger(slog.New(slog.NewJSONHandler(&out, &slog.HandlerOptions{Level: slog.LevelDebug})))
		env := fakeLookup(map[string]string{"PANEL_TEST_KEY_A": "fixture-key"})
		if err := registry.refreshPanel(t.Context(), state, &scriptedDoer{bodies: []string{fixtureUsagePage}}, env); err != nil {
			t.Fatalf("refreshPanel() error = %v", err)
		}
		records := refreshLogRecords(t, out.String())
		skip := findRecord(records, "usage source skipped: credential unset")
		if skip == nil || skip["level"] != "DEBUG" || skip["source"] != "codex" {
			t.Fatalf("no DEBUG skip for the unkeyed source in %q", out.String())
		}
		cycle := findRecord(records, "usage refresh cycle")
		if cycle == nil {
			t.Fatalf("no cycle summary in %q", out.String())
		}
		if cycle["sources_ok"] != float64(1) || cycle["sources_skipped"] != float64(1) || cycle["sources_failed"] != float64(0) || cycle["fallback_used"] != true {
			t.Errorf("cycle summary = %v, want 1 ok / 1 skipped / 0 failed / fallback_used", cycle)
		}
		// The credential value must never appear in any record.
		if strings.Contains(out.String(), "fixture-key") {
			t.Error("a credential value reached the refresh narrative")
		}
		assertNoUpstreamURL(t, out.String())
	})

	t.Run("a failing source warns where it degrades", func(t *testing.T) {
		t.Parallel()
		var out bytes.Buffer
		registry := newRegistry(snapshotFiles, []panelDefinition{
			{id: "token-usage", kind: KindTokenUsageV2, title: "Token usage", source: usageFetchSource(t)},
		})
		state := registry.byID["token-usage"]
		state.fetch.setLogger(slog.New(slog.NewJSONHandler(&out, nil)))
		env := fakeLookup(map[string]string{"PANEL_TEST_KEY_A": "fixture-key"})
		// An exhausted transport fails the only keyed source; the cycle
		// error propagates, but the per-source WARN must come from here.
		if err := registry.refreshPanel(t.Context(), state, &scriptedDoer{}, env); err == nil {
			t.Fatal("refreshPanel() succeeded with a failing transport")
		}
		record := findRecord(refreshLogRecords(t, out.String()), "usage source failed")
		if record == nil {
			t.Fatalf("no per-source WARN in %q", out.String())
		}
		if record["level"] != "WARN" || record["source"] != "anthropic" {
			t.Errorf("failure record = level %v source %v, want WARN/anthropic", record["level"], record["source"])
		}
		if errText, _ := record["error"].(string); !strings.Contains(errText, "fetch api.example.test") {
			t.Errorf("failure record error = %v, want the host-naming chain", record["error"])
		}
		assertNoUpstreamURL(t, out.String())
	})
}

// TestCommitSourceFailureWarnsWithRepoLabel pins the commit half: a failed
// commit document degrades the round instead of propagating, so its WARN —
// carrying the configured repo label and the host-naming error — must be
// written where the degrade happens.
func TestCommitSourceFailureWarnsWithRepoLabel(t *testing.T) {
	t.Parallel()
	var out bytes.Buffer
	source, err := NewFetchSource(
		SnapshotSource{Name: "snapshots/vcs-activity.json"},
		validFetchConfig(),
		panelFetchSpecs{vcs: &vcsActivityFetchSpec{
			Endpoint:    "https://api.example.test/contributions",
			Headers:     map[string]string{"Accept": "text/html"},
			ContentType: "text/html",
			Commits: &vcsCommitsFetchSpec{
				Headers:     map[string]string{"Accept": "application/json"},
				ContentType: "application/json",
				Max:         4,
				Sources:     []vcsCommitSourceSpec{{Repo: "fixture-repo", Endpoint: "https://api.example.test/repos/fixture/commits"}},
			},
		}},
	)
	if err != nil {
		t.Fatalf("NewFetchSource() error = %v", err)
	}
	source.setLogger(slog.New(slog.NewJSONHandler(&out, nil)))
	rows, _, attempted, fresh := source.commitSection(t.Context(), &scriptedDoer{}, func(string) string { return "" }, source.specs.vcs.Commits, time.Now().UTC())
	if !attempted || fresh || len(rows) != 0 {
		t.Fatalf("commitSection with a failing transport = %d rows, attempted %t, fresh %t; want an attempted, degraded round", len(rows), attempted, fresh)
	}
	record := findRecord(refreshLogRecords(t, out.String()), "commit source failed")
	if record == nil {
		t.Fatalf("no commit-source WARN in %q", out.String())
	}
	if record["level"] != "WARN" || record["repo"] != "fixture-repo" {
		t.Errorf("commit failure record = level %v repo %v, want WARN/fixture-repo", record["level"], record["repo"])
	}
	assertNoUpstreamURL(t, out.String())
}

// TestUsageSourceWarnSurvivesProductionURLError injects the exact
// disclosure shape from Daybreak's round-1 finding — a *url.Error whose
// string embeds the full query-bearing usage endpoint — through the real
// per-source WARN handler at debug level (so the per-attempt DEBUG line is
// swept too), and requires the narrative to carry the host and the
// transport's cause while the URL never appears.
func TestUsageSourceWarnSurvivesProductionURLError(t *testing.T) {
	t.Parallel()
	var out bytes.Buffer
	registry := newRegistry(snapshotFiles, []panelDefinition{
		{id: "token-usage", kind: KindTokenUsageV2, title: "Token usage", source: usageFetchSource(t)},
	})
	state := registry.byID["token-usage"]
	state.fetch.setLogger(slog.New(slog.NewJSONHandler(&out, &slog.HandlerOptions{Level: slog.LevelDebug})))
	env := fakeLookup(map[string]string{"PANEL_TEST_KEY_A": "fixture-key"})
	if err := registry.refreshPanel(t.Context(), state, urlErrorDoer{}, env); err == nil {
		t.Fatal("refreshPanel() succeeded through a failing transport")
	}
	record := findRecord(refreshLogRecords(t, out.String()), "usage source failed")
	if record == nil {
		t.Fatalf("no per-source WARN in %q", out.String())
	}
	errText, _ := record["error"].(string)
	if !strings.Contains(errText, "fetch api.example.test") || !strings.Contains(errText, "connection reset by peer") {
		t.Errorf("sanitized error = %q, want the host and the transport cause", errText)
	}
	assertNoUpstreamURL(t, out.String())
}

// TestCommitSourceWarnSurvivesProductionURLError drives the same
// production-shaped *url.Error through the commit-source WARN handler.
func TestCommitSourceWarnSurvivesProductionURLError(t *testing.T) {
	t.Parallel()
	var out bytes.Buffer
	source, err := NewFetchSource(
		SnapshotSource{Name: "snapshots/vcs-activity.json"},
		validFetchConfig(),
		panelFetchSpecs{vcs: &vcsActivityFetchSpec{
			Endpoint:    "https://api.example.test/contributions",
			Headers:     map[string]string{"Accept": "text/html"},
			ContentType: "text/html",
			Commits: &vcsCommitsFetchSpec{
				Headers:                         map[string]string{"Accept": "application/json"},
				KeyEnvName:                      "FIXTURE_COMMITS_TOKEN",
				KeyHeader:                       "Authorization",
				KeyPrefix:                       "Bearer ",
				AuthenticatedMinIntervalMinutes: 1,
				ContentType:                     "application/json",
				Max:                             4,
				Sources:                         []vcsCommitSourceSpec{{Repo: "fixture-repo", Endpoint: "https://api.example.test/repos/fixture/commits?account=" + urlErrorQuerySecret}},
			},
		}},
	)
	if err != nil {
		t.Fatalf("NewFetchSource() error = %v", err)
	}
	source.setLogger(slog.New(slog.NewJSONHandler(&out, &slog.HandlerOptions{Level: slog.LevelDebug})))
	const credential = "commit-credential-sentinel-eeee"
	_, _, attempted, fresh := source.commitSection(t.Context(), urlErrorDoer{}, func(string) string { return credential }, source.specs.vcs.Commits, time.Now().UTC())
	if !attempted || fresh {
		t.Fatalf("commitSection = attempted %t, fresh %t; want an attempted, degraded round", attempted, fresh)
	}
	record := findRecord(refreshLogRecords(t, out.String()), "commit source failed")
	if record == nil {
		t.Fatalf("no commit-source WARN in %q", out.String())
	}
	errText, _ := record["error"].(string)
	if !strings.Contains(errText, "fetch api.example.test") || !strings.Contains(errText, "connection reset by peer") {
		t.Errorf("sanitized error = %q, want the host and the transport cause", errText)
	}
	if strings.Contains(out.String(), credential) {
		t.Error("the commit credential reached the refresh narrative")
	}
	assertNoUpstreamURL(t, out.String())
}

// TestRefreshLoopWarnSurvivesProductionURLError closes the loop-layer half
// of the finding: refresh.go's "panel refresh failed" WARN logs the
// propagated chain, so it must inherit the construction-boundary
// sanitization — proven against a query-bearing configured endpoint under
// the real loop in a synctest bubble.
func TestRefreshLoopWarnSurvivesProductionURLError(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		out := &safeBuffer{}
		registry, _ := bossFetchRegistry(t, "https://api.example.test/scores.json?account="+urlErrorQuerySecret, validFetchConfig())
		registry.logger = slog.New(slog.NewJSONHandler(out, &slog.HandlerOptions{Level: slog.LevelDebug}))
		ctx, cancel := context.WithCancel(t.Context())
		registry.startRefresh(ctx, urlErrorDoer{}, func(string) string { return "" })
		synctest.Wait()
		cancel()
		synctest.Wait()

		record := findRecord(refreshLogRecords(t, out.String()), "panel refresh failed")
		if record == nil {
			t.Fatalf("no failure WARN in %q", out.String())
		}
		errText, _ := record["error"].(string)
		if !strings.Contains(errText, "fetch api.example.test") || !strings.Contains(errText, "connection reset by peer") {
			t.Errorf("sanitized error = %q, want the host and the transport cause", errText)
		}
		assertNoUpstreamURL(t, out.String())
	})
}

// TestDirectlyDrivenSourcesStayQuiet pins the default the whole suite
// depends on: a source no one called setLogger on writes nothing, wherever
// its refresh is driven from.
func TestDirectlyDrivenSourcesStayQuiet(t *testing.T) {
	t.Parallel()
	registry, state := bossFetchRegistry(t, "https://api.example.test/scores.json", validFetchConfig())
	if err := registry.refreshPanel(t.Context(), state, &scriptedDoer{bodies: []string{fixtureHiscores}}, func(string) string { return "" }); err != nil {
		t.Fatalf("refreshPanel() error = %v", err)
	}
	// Nothing to assert on an output stream that does not exist: the proof
	// is that log() fell back to the discard logger without a setLogger
	// call, which the race detector would flag if it raced anything.
	if got := state.fetch.log(); got != discardLogger {
		t.Fatalf("an un-injected source resolved logger %v, want the discard default", got)
	}
}

// TestDataRootNarrativeCarriesNoPayloadData is the privacy matrix the
// 2026-09-04 security review asked for (finding 1): validly sealed documents
// that each smuggle a sentinel into a different field the old narrative
// quoted — the schema, the capture instant, a source label, a derived key, a
// captured stat key — plus a replay and a broken seal. Every one runs through
// the REAL loop with a real unsealer, and the whole log is then searched for
// the sentinel: it must not appear, the WARN must carry a reason from the
// closed vocabulary, and no record may carry error text at all.
func TestDataRootNarrativeCarriesNoPayloadData(t *testing.T) {
	const sentinel = "sealed-payload-sentinel-291"
	cases := []struct {
		name   string
		mutate func(document map[string]any)
		seal   func(t *testing.T, document map[string]any) []byte
		reason string
	}{
		{name: "schema", reason: reasonDocumentRefused, mutate: func(document map[string]any) { document["schema"] = sentinel }},
		{name: "generatedAt", reason: reasonDocumentRefused, mutate: func(document map[string]any) { document["generatedAt"] = sentinel }},
		{name: "source label", reason: reasonDocumentRefused, mutate: func(document map[string]any) {
			sources := document["sources"].(map[string]any)
			sources[sentinel] = sources["alpha"]
			delete(sources, "alpha")
		}},
		{name: "derived key", reason: reasonDocumentRefused, mutate: func(document map[string]any) {
			alphaSection(document)["derived"].(map[string]any)[sentinel] = 1
		}},
		{name: "captured stat key", reason: reasonDocumentRefused, mutate: func(document map[string]any) {
			alphaSection(document)["stats"].(map[string]any)[sentinel] = 1
		}},
		{name: "replay of an older instant", reason: reasonReplayRefused, mutate: func(document map[string]any) {
			for _, section := range document["sources"].(map[string]any) {
				section.(map[string]any)["capturedAt"] = "1990-01-01T00:00:00Z"
			}
			document["generatedAt"] = "1990-01-01T00:00:00Z"
		}},
		{name: "broken seal", reason: reasonSealRefused, mutate: func(document map[string]any) { document["schema"] = sentinel }, seal: func(t *testing.T, document map[string]any) []byte {
			sealed := sealDocument(t, document)
			sealed[len(sealed)-1] ^= 0x01
			return sealed
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				out := &safeBuffer{}
				registry, state := usageDataRootRegistry(t, synctestSnapshot)
				registry.logger = slog.New(slog.NewJSONHandler(out, nil))
				document := synctestDocument("2000-01-01T00:00:00Z")
				tc.mutate(document)
				sealed := sealDocument(t, document)
				if tc.seal != nil {
					sealed = tc.seal(t, document)
				}
				ctx, cancel := context.WithCancel(t.Context())
				defer cancel()
				registry.startDataRoot(ctx, seriesFS(sealed), productionUnsealer(dataRootTestKeyHex), nil, time.Now)
				synctest.Wait()
				time.Sleep(dataRootTTL)
				synctest.Wait()
				if envelope, _ := decodeServedUsage(t, state); envelope.Status != StatusStale {
					t.Fatalf("refused document left status %q, want stale", envelope.Status)
				}
				logged := out.String()
				if strings.Contains(logged, sentinel) {
					t.Fatalf("the narrative quotes the document: %s", logged)
				}
				records := refreshLogRecords(t, logged)
				failure := findRecord(records, "failed to fetch token usage")
				if failure == nil {
					t.Fatalf("no WARN in %q", logged)
				}
				if failure["reason"] != tc.reason {
					t.Errorf("reason = %v, want %q", failure["reason"], tc.reason)
				}
				for _, record := range records {
					if _, leaked := record["error"]; leaked {
						t.Errorf("record carries error text: %v", record)
					}
					if _, leaked := record["generated_at"]; leaked {
						t.Errorf("record carries a document instant: %v", record)
					}
				}
			})
		})
	}
}

// TestDataRootReasonsAreBareLabels pins the vocabulary itself: every reason
// is a short lowercase label with no format verb, quote or space, so no
// member can ever carry a document value, and an untagged error maps to the
// generic code rather than to its message.
func TestDataRootReasonsAreBareLabels(t *testing.T) {
	t.Parallel()
	seen := map[string]bool{}
	for _, reason := range dataRootReasons {
		for _, r := range reason {
			if !(r >= 'a' && r <= 'z') && r != '-' {
				t.Errorf("reason %q is not a bare label", reason)
			}
		}
		if seen[reason] {
			t.Errorf("reason %q is listed twice", reason)
		}
		seen[reason] = true
	}
	if got := dataRootReason(errors.New("data root: schema \"" + "not-in-the-log" + "\" is not usage-series/v1")); got != reasonRefused {
		t.Errorf("an untagged error maps to %q, want %q", got, reasonRefused)
	}
	if got := dataRootReason(fmt.Errorf("wrapped: %w", refuse(reasonReplayRefused, errors.New("x")))); got != reasonReplayRefused {
		t.Errorf("a wrapped tag maps to %q, want %q", got, reasonReplayRefused)
	}
}
