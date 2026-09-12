// livedata_test covers the two producers the owner's live-data directive
// added — the credentialed contribution calendar and the repository-metadata
// panel — plus the admission hardening that stopped a figure nobody measured
// from being published as a zero.
//
// Every test here drives the real refresh path through a hand-written fake
// transport. Nothing leaves the process, and no test names a credential value:
// the variable NAME is config data and the fake environment answers it, which
// is exactly the shape production uses.

package panels

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// fixtureContributions is the shipped public-calendar fragment, the same
// document the existing activity suites drive the anonymous producer with.
func fixtureContributions(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "contributions-fragment.html"))
	if err != nil {
		t.Fatalf("read the contribution fixture: %v", err)
	}
	return string(raw)
}

// recordedRequest is everything a test needs to prove about one outbound
// attempt: what was asked, how, with which headers, and carrying what.
type recordedRequest struct {
	method string
	path   string
	header http.Header
	body   string
}

// capturingDoer answers by URL path like routingDoer and additionally RECORDS
// the whole request, because the credentialed producer's claims are about the
// request rather than about the answer: that it is a POST, that it carries the
// configured query and a Sunday-aligned window, and that the credential rides
// exactly one header and appears nowhere else.
type capturingDoer struct {
	mu       sync.Mutex
	answers  map[string]cannedAnswer
	requests []recordedRequest
}

func newCapturingDoer(answers map[string]cannedAnswer) *capturingDoer {
	return &capturingDoer{answers: answers}
}

func (d *capturingDoer) Do(r *http.Request) (*http.Response, error) {
	body := ""
	if r.Body != nil {
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			return nil, err
		}
		body = string(raw)
	}
	d.mu.Lock()
	answer, known := d.answers[r.URL.Path]
	d.requests = append(d.requests, recordedRequest{
		method: r.Method, path: r.URL.Path, header: r.Header.Clone(), body: body,
	})
	d.mu.Unlock()
	if !known {
		return nil, fmt.Errorf("capturingDoer: no answer scripted for %s", r.URL.Path)
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

// total is every request this doer saw, which is how "an unset credential
// asks nothing at all" is asserted as a count rather than as a path miss.
func (d *capturingDoer) total() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.requests)
}

func (d *capturingDoer) at(path string) []recordedRequest {
	d.mu.Lock()
	defer d.mu.Unlock()
	matched := make([]recordedRequest, 0, len(d.requests))
	for _, request := range d.requests {
		if request.path == path {
			matched = append(matched, request)
		}
	}
	return matched
}

// liveTestConfig is the bounds every source in this file is built with: the
// two fixture hosts allowlisted, and every limit comfortably above what the
// fixtures need so a failure here is never a bound nobody meant to hit.
func liveTestConfig() FetchConfig {
	return FetchConfig{
		Hosts:          []string{"api.example.test", "public.example.test"},
		TTL:            5 * time.Minute,
		Timeout:        10 * time.Second,
		MaxBytes:       1 << 18,
		InitialBackoff: time.Minute,
		MaxBackoff:     15 * time.Minute,
	}
}

// calendarSpec is the credentialed producer's fixture spec, mirroring the
// shipped configuration's shape exactly.
func calendarSpec() *vcsCalendarFetchSpec {
	return &vcsCalendarFetchSpec{
		Endpoint:                        "https://api.example.test/graphql",
		Query:                           "query($from: DateTime!, $to: DateTime!) { calendar }",
		KeyEnvName:                      "FIXTURE_CALENDAR_TOKEN",
		KeyHeader:                       "Authorization",
		KeyPrefix:                       "Bearer ",
		AuthenticatedMinIntervalMinutes: 1,
		Headers:                         map[string]string{"Accept": "application/json", "Content-Type": "application/json"},
		MaxBytes:                        1 << 17,
		ContentType:                     "application/json",
	}
}

// activitySpec is the whole version-control spec: the public document, the
// credentialed producer, and no commit half (a nil Commits spec serves an
// empty list and never makes the panel stale, which keeps these tests about
// the calendar).
func activitySpec(calendar *vcsCalendarFetchSpec) *vcsActivityFetchSpec {
	return &vcsActivityFetchSpec{
		Endpoint:           "https://public.example.test/contributions",
		Headers:            map[string]string{"Accept": "text/html"},
		MaxBytes:           1 << 17,
		ContentType:        "text/html",
		MinIntervalMinutes: 15,
		Calendar:           calendar,
	}
}

// calendarAnswer builds a credentialed-producer answer covering `weeks` whole
// Sunday-started weeks ending on the Saturday before `endExclusive`, with
// `perDay` contributions every day. The document's own total is the honest sum
// unless `total` overrides it, which is how the cross-field integrity check is
// driven both ways.
func calendarAnswer(start time.Time, days, perDay int, total *int) string {
	weeks := make([]map[string]any, 0, (days+6)/7)
	current := make([]map[string]any, 0, 7)
	for offset := range days {
		current = append(current, map[string]any{
			"date":              start.AddDate(0, 0, offset).Format(dayLayout),
			"contributionCount": perDay,
		})
		if len(current) == daysPerWeek {
			weeks = append(weeks, map[string]any{"contributionDays": current})
			current = make([]map[string]any, 0, 7)
		}
	}
	if len(current) > 0 {
		weeks = append(weeks, map[string]any{"contributionDays": current})
	}
	reported := days * perDay
	if total != nil {
		reported = *total
	}
	document := map[string]any{
		"data": map[string]any{
			"viewer": map[string]any{
				"contributionsCollection": map[string]any{
					"contributionCalendar": map[string]any{
						"totalContributions": reported,
						"weeks":              weeks,
					},
				},
			},
		},
	}
	encoded, err := json.Marshal(document)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

// firstSunday is the Sunday on or before d, which is where every fixture
// calendar starts because the served week columns are calendar weeks.
func firstSunday(d time.Time) time.Time {
	return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.UTC).
		AddDate(0, 0, -int(d.Weekday()))
}

// decodeActivityPayload reads a refreshed payload back as the served type.
func decodeActivityPayload(t *testing.T, loaded loadedPayload) VCSActivityData {
	t.Helper()
	var payload VCSActivityData
	if err := json.Unmarshal(loaded.data, &payload); err != nil {
		t.Fatalf("decode activity payload: %v", err)
	}
	return payload
}

// TestCredentialedCalendarReplacesThePublicOne is the whole point of the
// producer: with the credential present the panel reads the account's own
// record instead of what an anonymous reader may see, says so through its
// coverage field, and never touches the public document at all.
func TestCredentialedCalendarReplacesThePublicOne(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	start := firstSunday(now.AddDate(0, 0, -calendarWindowDays))
	days := int(now.Sub(start)/(24*time.Hour)) + 1
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/graphql": {contentType: "application/json", body: calendarAnswer(start, days, 2, nil)},
	})
	source, err := NewFetchSource(SnapshotSource{Name: "snapshots/vcs-activity.json"}, liveTestConfig(),
		panelFetchSpecs{vcs: activitySpec(calendarSpec())})
	if err != nil {
		t.Fatalf("build source: %v", err)
	}
	loaded, err := source.refresh(t.Context(), doer, func(name string) string {
		if name == "FIXTURE_CALENDAR_TOKEN" {
			return "fixture-token-value"
		}
		return ""
	})
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	payload := decodeActivityPayload(t, loaded)
	if payload.Coverage != CoverageComplete {
		t.Errorf("coverage = %q, want %q: a credentialed read must say it covers the whole record", payload.Coverage, CoverageComplete)
	}
	if want := days * 2; payload.TotalContributions != want {
		t.Errorf("totalContributions = %d, want %d", payload.TotalContributions, want)
	}
	if payload.EndDate != now.Format(dayLayout) {
		t.Errorf("endDate = %q, want %q", payload.EndDate, now.Format(dayLayout))
	}
	if len(doer.at("/contributions")) != 0 {
		t.Error("the public document was fetched even though the credential was present")
	}
	requests := doer.at("/graphql")
	if len(requests) != 1 {
		t.Fatalf("credentialed producer was asked %d times, want exactly 1", len(requests))
	}
	if requests[0].method != http.MethodPost {
		t.Errorf("method = %s, want POST: the query travels in the request body", requests[0].method)
	}
	if got := requests[0].header.Get("Authorization"); got != "Bearer fixture-token-value" {
		t.Errorf("Authorization header = %q, want the prefixed credential", got)
	}
}

// TestTheCalendarRequestAsksForASundayAlignedWindow pins the one thing the
// credentialed producer must get right that the public one gets for free: the
// window it asks over. A window starting on any other weekday would shift
// every served cell's date, because the week columns are sliced seven days at
// a time from the first covered day.
func TestTheCalendarRequestAsksForASundayAlignedWindow(t *testing.T) {
	t.Parallel()
	// Every weekday, so the alignment cannot pass by happening to land right.
	for offset := range 7 {
		now := time.Date(2026, 8, 24, 9, 30, 0, 0, time.UTC).AddDate(0, 0, offset)
		body, err := queryRequestBody("query($from: DateTime!, $to: DateTime!) { calendar }", queryVariables{
			From: calendarWindowStart(now),
			To:   now.UTC().Format(time.RFC3339),
		})
		if err != nil {
			t.Fatalf("build request body: %v", err)
		}
		var request queryRequest
		if err := json.Unmarshal(body, &request); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		from, err := time.Parse(time.RFC3339, request.Variables.From)
		if err != nil {
			t.Fatalf("from %q: %v", request.Variables.From, err)
		}
		to, err := time.Parse(time.RFC3339, request.Variables.To)
		if err != nil {
			t.Fatalf("to %q: %v", request.Variables.To, err)
		}
		if from.Weekday() != time.Sunday {
			t.Errorf("window for %s starts on %s, want Sunday", now.Weekday(), from.Weekday())
		}
		span := to.Sub(from)
		if span <= 0 || span > 365*24*time.Hour {
			t.Errorf("window for %s spans %v; the upstream refuses more than a year", now.Weekday(), span)
		}
		if !strings.Contains(request.Query, calendarFromVariable) {
			t.Errorf("the posted query lost %s", calendarFromVariable)
		}
	}
}

// TestAnUnsetCalendarCredentialFallsBackHonestly is the state this repository
// ships in: no token exists yet, so the public document must still answer and
// the payload must record the narrower coverage rather than claim the wider
// one.
func TestAnUnsetCalendarCredentialFallsBackHonestly(t *testing.T) {
	t.Parallel()
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/contributions": {contentType: "text/html", body: fixtureContributions(t)},
	})
	source, err := NewFetchSource(SnapshotSource{Name: "snapshots/vcs-activity.json"}, liveTestConfig(),
		panelFetchSpecs{vcs: activitySpec(calendarSpec())})
	if err != nil {
		t.Fatalf("build source: %v", err)
	}
	loaded, err := source.refresh(t.Context(), doer, func(string) string { return "" })
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if payload := decodeActivityPayload(t, loaded); payload.Coverage != CoveragePublic {
		t.Errorf("coverage = %q, want %q: an anonymous read must not claim the whole record", payload.Coverage, CoveragePublic)
	}
	if len(doer.at("/graphql")) != 0 {
		t.Error("the credentialed endpoint was contacted with no credential to send")
	}
}

// TestAuthenticatedGitHubCadenceFallsBackBeforeReservation proves the fast
// path and its safety valve together. With the configured credential present,
// each GitHub-backed source is due again at one minute and sends the key only
// in its dedicated header. With the same configuration but no value in the
// environment, a one-minute wake spends no anonymous request: the longer
// public reservation was taken before the first request left the process.
func TestAuthenticatedGitHubCadenceFallsBackBeforeReservation(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	credential := func(string) string { return "fixture-token-value" }
	anonymous := func(string) string { return "" }

	t.Run("calendar", func(t *testing.T) {
		t.Parallel()
		start := firstSunday(now.AddDate(0, 0, -calendarWindowDays))
		days := int(now.Sub(start)/(24*time.Hour)) + 1
		answers := map[string]cannedAnswer{
			"/graphql":       {contentType: "application/json", body: calendarAnswer(start, days, 1, nil)},
			"/contributions": {contentType: "text/html", body: fixtureContributions(t)},
		}
		build := func(t *testing.T) *FetchSource {
			t.Helper()
			source, err := NewFetchSource(SnapshotSource{Name: "snapshots/vcs-activity.json"}, liveTestConfig(),
				panelFetchSpecs{vcs: activitySpec(calendarSpec())})
			if err != nil {
				t.Fatalf("build source: %v", err)
			}
			return source
		}

		authDoer := newCapturingDoer(answers)
		authSource := build(t)
		for _, at := range []time.Time{now, now.Add(time.Minute)} {
			if _, err := authSource.refreshActivity(t.Context(), authDoer, credential, at); err != nil {
				t.Fatalf("credentialed refresh at %v: %v", at, err)
			}
		}
		if requests := authDoer.at("/graphql"); len(requests) != 2 {
			t.Fatalf("credentialed one-minute wakes made %d requests, want 2", len(requests))
		} else {
			for _, request := range requests {
				if got := request.header.Get("Authorization"); got != "Bearer fixture-token-value" {
					t.Errorf("credentialed request header = %q", got)
				}
			}
		}

		publicDoer := newCapturingDoer(answers)
		publicSource := build(t)
		if _, err := publicSource.refreshActivity(t.Context(), publicDoer, anonymous, now); err != nil {
			t.Fatalf("public first refresh: %v", err)
		}
		if _, err := publicSource.refreshActivity(t.Context(), publicDoer, anonymous, now.Add(time.Minute)); !errors.Is(err, errNothingDue) {
			t.Fatalf("public one-minute wake = %v, want nothing due", err)
		}
		if got := len(publicDoer.at("/contributions")); got != 1 {
			t.Errorf("public one-minute wakes made %d requests, want 1", got)
		}
	})

	t.Run("projects", func(t *testing.T) {
		t.Parallel()
		answers := map[string]cannedAnswer{
			"/users/owner/repos": {contentType: "application/json", body: listingAnswer(
				listedRepo{name: "alpha", description: `"alpha"`, stars: 1, pushedAt: "2026-08-27T10:00:00Z"},
			)},
		}
		build := func(t *testing.T) *FetchSource {
			t.Helper()
			source, err := NewFetchSource(SnapshotSource{Name: "snapshots/coding-projects.json"}, liveTestConfig(),
				panelFetchSpecs{projects: projectsSpec()})
			if err != nil {
				t.Fatalf("build source: %v", err)
			}
			return source
		}

		authDoer := newCapturingDoer(answers)
		authSource := build(t)
		for _, at := range []time.Time{now, now.Add(time.Minute)} {
			if _, err := authSource.refreshProjects(t.Context(), authDoer, credential, at); err != nil {
				t.Fatalf("credentialed refresh at %v: %v", at, err)
			}
		}
		if requests := authDoer.at("/users/owner/repos"); len(requests) != 2 {
			t.Fatalf("credentialed one-minute wakes made %d requests, want 2", len(requests))
		} else if got := requests[1].header.Get("Authorization"); got != "Bearer fixture-token-value" {
			t.Errorf("credentialed request header = %q", got)
		}

		publicDoer := newCapturingDoer(answers)
		publicSource := build(t)
		if _, err := publicSource.refreshProjects(t.Context(), publicDoer, anonymous, now); err != nil {
			t.Fatalf("public first refresh: %v", err)
		}
		if _, err := publicSource.refreshProjects(t.Context(), publicDoer, anonymous, now.Add(time.Minute)); !errors.Is(err, errNothingDue) {
			t.Fatalf("public one-minute wake = %v, want nothing due", err)
		}
		if got := len(publicDoer.at("/users/owner/repos")); got != 1 {
			t.Errorf("public one-minute wakes made %d requests, want 1", got)
		}
	})

	t.Run("commits", func(t *testing.T) {
		t.Parallel()
		configure := func(t *testing.T) *FetchSource {
			t.Helper()
			_, state := activityFetchRegistry(t, 10)
			state.fetch.specs.vcs.Commits.AuthenticatedMinIntervalMinutes = 1
			return state.fetch
		}

		authDoer := newCapturingDoer(activityAnswers(t))
		authSource := configure(t)
		for _, at := range []time.Time{now, now.Add(time.Minute)} {
			if _, _, _, attempted, fresh := authSource.commitSection(t.Context(), authDoer, credential, authSource.specs.vcs.Commits, at); !attempted || !fresh {
				t.Fatalf("credentialed commit refresh at %v = attempted %t fresh %t", at, attempted, fresh)
			}
		}
		if requests := authDoer.at("/graphql/contributions"); len(requests) != 2 {
			t.Fatalf("credentialed one-minute wakes made %d discovery requests, want 2", len(requests))
		} else if got := requests[1].header.Get("Authorization"); got != "Bearer fixture-token-value" {
			t.Errorf("credentialed request header = %q", got)
		}
		// TWO documents per round and never more (issue #315): the history
		// answer covers every repository the discovery answer named, so the
		// request count is flat in the size of the roster.
		if got := len(authDoer.at("/graphql/history")); got != 2 {
			t.Errorf("credentialed one-minute wakes made %d history requests, want 2", got)
		}

		// An unset credential asks NOTHING. Both documents are about the
		// credential's own account, so there is no anonymous half to read.
		publicDoer := newCapturingDoer(activityAnswers(t))
		publicSource := configure(t)
		rows, days, _, attempted, fresh := publicSource.commitSection(t.Context(), publicDoer, anonymous, publicSource.specs.vcs.Commits, now)
		if attempted {
			t.Fatal("an unset credential still attempted a commit round")
		}
		if !fresh {
			t.Error("an unconfigured producer made the panel stale; no producer, no claim")
		}
		if len(rows) != 0 || len(days) != 0 {
			t.Errorf("an unset credential served %d rows and %d private days; it must invent none", len(rows), len(days))
		}
		if got := publicDoer.total(); got != 0 {
			t.Errorf("an unset credential made %d requests, want none", got)
		}
	})
}

// TestACredentialedCalendarFailureNeverSilentlyNarrowsTheFigure pins the
// deliberate NON-fallback: a transient failure of the credentialed producer
// must not answer by quietly switching the panel to a much smaller number with
// nothing on the page to say why. The round fails, the retained payload keeps
// serving, and the public document is not consulted.
func TestACredentialedCalendarFailureNeverSilentlyNarrowsTheFigure(t *testing.T) {
	t.Parallel()
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/graphql":       {status: http.StatusInternalServerError, contentType: "application/json", body: "{}"},
		"/contributions": {contentType: "text/html", body: fixtureContributions(t)},
	})
	source, err := NewFetchSource(SnapshotSource{Name: "snapshots/vcs-activity.json"}, liveTestConfig(),
		panelFetchSpecs{vcs: activitySpec(calendarSpec())})
	if err != nil {
		t.Fatalf("build source: %v", err)
	}
	if _, err := source.refresh(t.Context(), doer, func(string) string { return "present" }); err == nil {
		t.Fatal("a failed credentialed read was reported as a successful refresh")
	}
	if len(doer.at("/contributions")) != 0 {
		t.Error("a credentialed failure fell through to the public document, narrowing the figure without saying so")
	}
}

// TestTheCalendarDocumentIsRefusedWhenItsOwnNumbersDisagree drives the
// cross-field integrity rule the producer's value rests on: the total the
// owner sees and the sum of the days the grid draws are the same measurement,
// so a document where they differ is one this package has half-understood.
func TestTheCalendarDocumentIsRefusedWhenItsOwnNumbersDisagree(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	start := firstSunday(now.AddDate(0, 0, -calendarWindowDays))
	days := int(now.Sub(start)/(24*time.Hour)) + 1
	honest := days * 3
	for _, testCase := range []struct {
		name  string
		total *int
		want  string
	}{
		{"the honest document is admitted", nil, ""},
		{"a total larger than its days", &[]int{honest + 1}[0], "sum to"},
		{"a total smaller than its days", &[]int{honest - 1}[0], "sum to"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			_, err := mapCalendarDocument([]byte(calendarAnswer(start, days, 3, testCase.total)), now)
			if testCase.want == "" {
				if err != nil {
					t.Fatalf("the honest document was refused: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatal("a document whose own numbers disagree was admitted")
			}
			if !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("refusal = %v, want the disagreement named", err)
			}
		})
	}
}

// TestTheCalendarEnvelopeToleratesWhatItNeverReads pins the one boundary the
// calendar decode deliberately draws (issue 246, finding 2): the transport
// ENVELOPE is read leniently and the PAYLOAD under "data" is read strictly.
//
// The envelope is the protocol's own wrapper, and GraphQL reserves the right
// to add top-level siblings to it — "extensions", for tracing or cost
// accounting — that this package never reads a value out of. Under the strict
// gate that used to cover the whole document, the first such sibling would
// have refused EVERY credentialed calendar from the day it appeared: honest
// (the retained payload keeps serving, logged, nothing invented) but for a
// reason that has nothing to do with the data.
//
// Both directions are asserted together, because either alone is satisfiable
// by the wrong implementation. Tolerance alone is satisfiable by dropping the
// strict gate entirely; strictness alone is what the finding reported.
func TestTheCalendarEnvelopeToleratesWhatItNeverReads(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	start := firstSunday(now.AddDate(0, 0, -calendarWindowDays))
	days := int(now.Sub(start)/(24*time.Hour)) + 1
	full := calendarAnswer(start, days, 1, nil)

	// The control: the same document, unaltered, must map. Without it a
	// tolerance assertion could pass against a fixture that was never
	// mappable in the first place.
	baseline, err := mapCalendarDocument([]byte(full), now)
	if err != nil {
		t.Fatalf("the unaltered document does not map: %v", err)
	}

	// Re-encoded through a map so a sibling lands beside the payload at the
	// TOP level, which is the only place this tolerance applies.
	withSiblings := func(t *testing.T, siblings map[string]any) []byte {
		t.Helper()
		var document map[string]any
		if err := json.Unmarshal([]byte(full), &document); err != nil {
			t.Fatalf("reparse fixture: %v", err)
		}
		for name, value := range siblings {
			document[name] = value
		}
		encoded, err := json.Marshal(document)
		if err != nil {
			t.Fatalf("re-encode fixture: %v", err)
		}
		return encoded
	}

	for _, testCase := range []struct {
		name     string
		siblings map[string]any
	}{
		{"the extensions sibling GraphQL servers may add at any time", map[string]any{
			"extensions": map[string]any{"cost": map[string]any{"requestedQueryCost": 1}},
		}},
		{"a sibling nobody has invented yet", map[string]any{"somethingLater": []any{"x"}}},
		{"several at once", map[string]any{
			"extensions": map[string]any{"warnings": []any{}},
			"tracing":    map[string]any{"version": 1},
		}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			mapped, err := mapCalendarDocument(withSiblings(t, testCase.siblings), now)
			if err != nil {
				t.Fatalf("a top-level sibling this package never reads refused the whole document: %v", err)
			}
			// And it changed nothing: the sibling is ignored, not absorbed.
			if !bytes.Equal(mapped, baseline) {
				t.Fatal("a top-level sibling changed the mapped payload; it must be ignored, not read")
			}
		})
	}

	// THE OTHER HALF, and the half that must not have moved. Inside the
	// payload every byte is mapped, so an unknown field there is upstream
	// drift this package has half-understood and the document is refused. The
	// two cases sit at different depths on purpose: the strict gate covers
	// the payload's whole tree, not merely its first level.
	for _, testCase := range []struct {
		name string
		body string
	}{
		{
			"an unknown field at the payload root",
			"{\"data\":{\"viewer\":{\"contributionsCollection\":{\"contributionCalendar\":{\"totalContributions\":0,\"weeks\":[]}}},\"unexpected\":1}}",
		},
		{
			"an unknown field deep inside the payload",
			"{\"data\":{\"viewer\":{\"contributionsCollection\":{\"contributionCalendar\":{\"totalContributions\":0,\"weeks\":[],\"colors\":[]}}}}}",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if _, err := mapCalendarDocument([]byte(testCase.body), now); err == nil {
				t.Fatal("an unknown field inside the mapped payload was admitted")
			} else if !strings.Contains(err.Error(), "unknown field") {
				t.Fatalf("refusal = %v, want it to name the unknown field", err)
			}
		})
	}

	// An answer carrying neither errors nor a payload is not a calendar, and
	// a lenient envelope is what makes the case reachable at all — before,
	// the unknown sibling refused it first. This pins the OUTCOME and not
	// which guard delivers it, and the distinction is honest rather than
	// pedantic: a mutation that skipped the payload decode for a nil payload
	// SURVIVED this assertion, because the minimum-days floor further down
	// refuses an empty calendar anyway. Two guards, one outcome; this is not
	// evidence that the nil branch is load-bearing on its own.
	if _, err := mapCalendarDocument([]byte("{\"extensions\":{}}"), now); err == nil {
		t.Fatal("a document carrying no payload at all was admitted")
	}
}

// TestTheCalendarDocumentFailsClosed walks the rest of the admission gate. Each
// case is a document that is plausible enough to be served if the check it
// targets were removed, which is what makes the checks non-decorative.
func TestTheCalendarDocumentFailsClosed(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	start := firstSunday(now.AddDate(0, 0, -calendarWindowDays))
	days := int(now.Sub(start)/(24*time.Hour)) + 1
	full := calendarAnswer(start, days, 1, nil)
	holed := func() string {
		var document map[string]any
		if err := json.Unmarshal([]byte(full), &document); err != nil {
			t.Fatalf("reparse fixture: %v", err)
		}
		calendar := document["data"].(map[string]any)["viewer"].(map[string]any)["contributionsCollection"].(map[string]any)["contributionCalendar"].(map[string]any)
		weeks := calendar["weeks"].([]any)
		middle := weeks[len(weeks)/2].(map[string]any)
		kept := middle["contributionDays"].([]any)
		middle["contributionDays"] = kept[1:]
		calendar["totalContributions"] = days - 1
		encoded, err := json.Marshal(document)
		if err != nil {
			t.Fatalf("re-encode fixture: %v", err)
		}
		return string(encoded)
	}()
	for _, testCase := range []struct {
		name string
		body string
		want string
	}{
		{"an upstream refusal carried in a 200", `{"data":{"viewer":{"contributionsCollection":{"contributionCalendar":{"totalContributions":0,"weeks":[]}}}},"errors":[{"message":"x"}]}`, "refused the query"},
		{"a field the query never asked for", `{"data":{"viewer":{"contributionsCollection":{"contributionCalendar":{"totalContributions":0,"weeks":[],"colors":[]}}}}}`, "unknown field"},
		{"a calendar too short to be one", `{"data":{"viewer":{"contributionsCollection":{"contributionCalendar":{"totalContributions":0,"weeks":[{"contributionDays":[{"date":"2026-08-23","contributionCount":0}]}]}}}}}`, "at least"},
		{"a day missing from the middle", holed, "missing days"},
		{"a negative count", `{"data":{"viewer":{"contributionsCollection":{"contributionCalendar":{"totalContributions":0,"weeks":[{"contributionDays":[{"date":"2026-08-23","contributionCount":-1}]}]}}}}}`, "negative"},
		{"an undated cell", `{"data":{"viewer":{"contributionsCollection":{"contributionCalendar":{"totalContributions":0,"weeks":[{"contributionDays":[{"date":"","contributionCount":0}]}]}}}}}`, "cell date"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			_, err := mapCalendarDocument([]byte(testCase.body), now)
			if err == nil {
				t.Fatal("a hostile or drifted document was admitted")
			}
			if !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("refusal = %v, want it to name %q", err, testCase.want)
			}
		})
	}
}

// TestTheCredentialedCalendarSpecFailsClosed pins the construction gate. The
// query-variable checks are the interesting ones: a query that ignores the
// window this package computes would be sent happily and answered over the
// upstream's own range, which is a silently wrong calendar rather than a loud
// failure.
func TestTheCredentialedCalendarSpecFailsClosed(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name string
		edit func(*vcsCalendarFetchSpec)
		want string
	}{
		{"a query that ignores the window's start", func(s *vcsCalendarFetchSpec) { s.Query = "query($to: DateTime!) { calendar }" }, calendarFromVariable},
		{"a query that ignores the window's end", func(s *vcsCalendarFetchSpec) { s.Query = "query($from: DateTime!) { calendar }" }, calendarToVariable},
		{"no credential named", func(s *vcsCalendarFetchSpec) { s.KeyEnvName = "" }, "keyEnvName"},
		{"no header for the credential to ride in", func(s *vcsCalendarFetchSpec) { s.KeyHeader = "" }, "keyHeader"},
		{"an authenticated cadence outside the reviewed band", func(s *vcsCalendarFetchSpec) { s.AuthenticatedMinIntervalMinutes = 100000 }, "reviewed"},
		{"no declared answer type", func(s *vcsCalendarFetchSpec) { s.ContentType = "" }, "contentType"},
		{"a credential smuggled into the static headers", func(s *vcsCalendarFetchSpec) {
			s.Headers = map[string]string{"Authorization": "Bearer smuggled"}
		}, "not permitted"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			spec := calendarSpec()
			testCase.edit(spec)
			_, err := NewFetchSource(SnapshotSource{Name: "snapshots/vcs-activity.json"}, liveTestConfig(),
				panelFetchSpecs{vcs: activitySpec(spec)})
			if err == nil {
				t.Fatal("an unsafe calendar spec built a source")
			}
			if !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("refusal = %v, want it to name %q", err, testCase.want)
			}
		})
	}
}

// TestAGetProducerNeverBecomesAPost pins the derivation that keeps the POST
// capability confined: the method follows the presence of a body this package
// built, and config data has no way to name one.
func TestAGetProducerNeverBecomesAPost(t *testing.T) {
	t.Parallel()
	if got := (fetchRequest{}).method(); got != http.MethodGet {
		t.Errorf("a request with no body uses %s, want GET", got)
	}
	if got := (fetchRequest{payload: []byte("{}")}).method(); got != http.MethodPost {
		t.Errorf("a request carrying a body uses %s, want POST", got)
	}
}

/* ---------------------------------------------------------------------------
 * coding-projects/v2
 * ------------------------------------------------------------------------ */

// projectsSpec is the repository-metadata fixture spec: the account's listing
// endpoint, the account pin, the optional credential named, mirroring the
// shipped configuration's shape.
func projectsSpec() *codingProjectsFetchSpec {
	return &codingProjectsFetchSpec{
		ListingEndpoint:                 "https://api.example.test/users/owner/repos?per_page=30&sort=pushed",
		Account:                         "owner",
		Headers:                         map[string]string{"Accept": "application/json"},
		KeyEnvName:                      "FIXTURE_PROJECTS_TOKEN",
		KeyHeader:                       "Authorization",
		KeyPrefix:                       "Bearer ",
		MaxBytes:                        1 << 17,
		ContentType:                     "application/json",
		MinIntervalMinutes:              15,
		AuthenticatedMinIntervalMinutes: 1,
	}
}

// listedRepo is one listing row's variable facts; everything the fixture
// builder does not take is realistic filler the projection must ignore.
type listedRepo struct {
	name        string
	owner       string // "" means the fixture account "owner"
	private     bool
	description string // a raw JSON value: `"text"` or `null`
	stars       int
	pushedAt    string // "" serves JSON null: a repository never pushed
	open        int    // the COMBINED open tally, pull requests included
}

// listingAnswer is a realistic listing document: one entry per row, each
// carrying the fields the panel reads surrounded by the many it deliberately
// does not — including the owner profile the projection reduces to a login.
func listingAnswer(rows ...listedRepo) string {
	entries := make([]string, 0, len(rows))
	for _, row := range rows {
		owner := row.owner
		if owner == "" {
			owner = "owner"
		}
		pushed := "null"
		if row.pushedAt != "" {
			pushed = fmt.Sprintf("%q", row.pushedAt)
		}
		entries = append(entries, fmt.Sprintf(`{"id":1,"name":%q,"full_name":"%s/%s",`+
			`"owner":{"login":%q,"id":2,"type":"User"},"private":%t,`+
			`"description":%s,"fork":false,"created_at":"2020-01-01T00:00:00Z",`+
			`"pushed_at":%s,"stargazers_count":%d,"watchers_count":%d,"forks_count":0,`+
			`"open_issues_count":%d,"default_branch":"main"}`,
			row.name, owner, row.name, owner, row.private, row.description, pushed, row.stars, row.stars, row.open))
	}
	return "[" + strings.Join(entries, ",") + "]"
}

// queriedRepo is one row of a CREDENTIALED repository answer: the same facts
// the listing carries plus the two the owner's columns added (issue #317).
type queriedRepo struct {
	name        string
	private     bool
	description string // a raw JSON value: `"text"` or `null`
	stars       int
	pushedAt    string // "" serves JSON null: a repository never pushed
	release     string // "" serves a null latestRelease: never released
	closedPulls int
}

// repositoriesAnswer is a realistic credentialed repository answer.
func repositoriesAnswer(rows ...queriedRepo) string {
	entries := make([]string, 0, len(rows))
	for _, row := range rows {
		pushed := "null"
		if row.pushedAt != "" {
			pushed = fmt.Sprintf("%q", row.pushedAt)
		}
		release := "null"
		if row.release != "" {
			release = fmt.Sprintf(`{"tagName":%q}`, row.release)
		}
		entries = append(entries, fmt.Sprintf(`{"name":%q,"description":%s,"isPrivate":%t,`+
			`"stargazerCount":%d,"pushedAt":%s,"latestRelease":%s,"pullRequests":{"totalCount":%d}}`,
			row.name, row.description, row.private, row.stars, pushed, release, row.closedPulls))
	}
	return fmt.Sprintf(`{"data":{"viewer":{"login":"owner","repositories":{"nodes":[%s]}}}}`, strings.Join(entries, ","))
}

// projectsSpecWithQuery is projectsSpec with the credentialed document named,
// which is the shipped configuration's shape.
func projectsSpecWithQuery() *codingProjectsFetchSpec {
	spec := projectsSpec()
	spec.Repositories = &graphQLDocumentSpec{
		Endpoint:    "https://api.example.test/graphql/repositories",
		Query:       "query { viewer { login repositories } }",
		Headers:     map[string]string{"Accept": "application/json", "Content-Type": "application/json"},
		MaxBytes:    1 << 17,
		ContentType: "application/json",
	}
	return spec
}

// queryingProjectsSource is projectsSource over that spec.
func queryingProjectsSource(t *testing.T) *FetchSource {
	t.Helper()
	source, err := NewFetchSource(SnapshotSource{Name: "snapshots/coding-projects.json"}, liveTestConfig(),
		panelFetchSpecs{projects: projectsSpecWithQuery()})
	if err != nil {
		t.Fatalf("build source: %v", err)
	}
	return source
}

// projectsSource builds a coding-projects source over the shipped snapshot, so
// the recorded fallback rows the tests assert about are the real ones.
func projectsSource(t *testing.T) *FetchSource {
	t.Helper()
	source, err := NewFetchSource(SnapshotSource{Name: "snapshots/coding-projects.json"}, liveTestConfig(),
		panelFetchSpecs{projects: projectsSpec()})
	if err != nil {
		t.Fatalf("build source: %v", err)
	}
	return source
}

func decodeProjects(t *testing.T, loaded loadedPayload) CodingProjectsData {
	t.Helper()
	var payload CodingProjectsData
	if err := json.Unmarshal(loaded.data, &payload); err != nil {
		t.Fatalf("decode coding-projects payload: %v", err)
	}
	return payload
}

// TestCodingProjectsServeWhatTheHostSaysNow is the commission, extended by
// issue 281: the owner edits a description — or CREATES A REPOSITORY — and
// the site follows on the next refresh, rather than serving a roster frozen
// at the last config edit. The row the shipped snapshot has never heard of is
// the defect-1 regression: under the retired whitelist it could never appear.
func TestCodingProjectsServeWhatTheHostSaysNow(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/users/owner/repos": {contentType: "application/json", body: listingAnswer(
			listedRepo{name: "alpha", description: `"a description the owner just changed"`, stars: 7, pushedAt: "2026-08-27T10:00:00Z"},
			listedRepo{name: "beta", description: `null`, stars: 0, pushedAt: "2026-08-26T10:00:00Z"},
			listedRepo{name: "born-this-morning", description: `"a repository created after the last release"`, stars: 1, pushedAt: "2026-08-28T09:00:00Z"},
		)},
	})
	loaded, err := projectsSource(t).refreshProjects(t.Context(), doer, func(name string) string {
		if name == "FIXTURE_PROJECTS_TOKEN" {
			return "fixture-token-value"
		}
		return ""
	}, now)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if loaded.status != StatusOK {
		t.Errorf("status = %q, want ok when the whole listing was admitted", loaded.status)
	}
	payload := decodeProjects(t, loaded)
	if len(payload.Repos) != 3 {
		t.Fatalf("served %d rows, want 3", len(payload.Repos))
	}
	// Most recently pushed first — the roster is the listing's, ordered by
	// the data, and the new repository leads because it was pushed last.
	if payload.Repos[0].Name != "born-this-morning" || payload.Repos[1].Name != "alpha" || payload.Repos[2].Name != "beta" {
		t.Errorf("rows = %q/%q/%q, want most recently pushed first with the new repository leading",
			payload.Repos[0].Name, payload.Repos[1].Name, payload.Repos[2].Name)
	}
	if payload.Repos[1].Description != "a description the owner just changed" {
		t.Errorf("description = %q, want the host's current text", payload.Repos[1].Description)
	}
	if payload.Repos[1].Stars == nil || *payload.Repos[1].Stars != 7 {
		t.Errorf("stars = %v, want 7", payload.Repos[1].Stars)
	}
	for _, row := range payload.Repos {
		if row.Recorded {
			t.Errorf("live row %q is marked recorded", row.Name)
		}
	}
	// A repository with no description has none; the row serves an empty
	// string rather than borrowed or invented copy.
	if payload.Repos[2].Description != "" {
		t.Errorf("a repository with no description served %q", payload.Repos[2].Description)
	}
	// A genuinely reported zero stays zero — that is what the nullable tally
	// makes expressible in the first place.
	if payload.Repos[2].Stars == nil || *payload.Repos[2].Stars != 0 {
		t.Errorf("a reported zero tally served %v, want 0", payload.Repos[2].Stars)
	}
	listing := doer.at("/users/owner/repos")
	if len(listing) != 1 {
		t.Fatalf("%d listing requests, want exactly one: the whole roster is one document", len(listing))
	}
	for _, request := range listing {
		if got := request.header.Get("Authorization"); got != "Bearer fixture-token-value" {
			t.Errorf("Authorization header = %q, want the prefixed credential", got)
		}
		if request.method != http.MethodGet {
			t.Errorf("method = %s, want GET: reading a listing is a read", request.method)
		}
	}
}

// TestTheRosterIsCuratedByExclusionOnly pins the owner's sanctioned curation
// shape: an excluded name disappears from the roster with the envelope still
// ok — curation is a choice, not degradation — and the exclusion of one name
// hides nothing else.
func TestTheRosterIsCuratedByExclusionOnly(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/users/owner/repos": {contentType: "application/json", body: listingAnswer(
			listedRepo{name: "alpha", description: `"kept"`, stars: 1, pushedAt: "2026-08-27T10:00:00Z"},
			listedRepo{name: "beta", description: `"curated out"`, stars: 1, pushedAt: "2026-08-26T10:00:00Z"},
		)},
	})
	spec := projectsSpec()
	spec.Exclude = []string{"beta"}
	source, err := NewFetchSource(SnapshotSource{Name: "snapshots/coding-projects.json"}, liveTestConfig(),
		panelFetchSpecs{projects: spec})
	if err != nil {
		t.Fatalf("build source: %v", err)
	}
	loaded, err := source.refreshProjects(t.Context(), doer, func(string) string { return "" }, now)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if loaded.status != StatusOK {
		t.Errorf("status = %q, want ok: curation is not degradation", loaded.status)
	}
	payload := decodeProjects(t, loaded)
	if len(payload.Repos) != 1 || payload.Repos[0].Name != "alpha" {
		t.Fatalf("served %v, want exactly the uncurated row", payload.Repos)
	}
}

// TestARosterOverTheRowCapServesTheMostRecent pins the clamp-by-recency
// selection: a thirteenth public repository must not take the panel down, and
// which twelve serve is decided by push instant, never by listing position.
func TestARosterOverTheRowCapServesTheMostRecent(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	rows := make([]listedRepo, 0, maxCodingProjectSources+1)
	// Oldest first, so serving "the first twelve listed" would be wrong.
	for index := range maxCodingProjectSources + 1 {
		rows = append(rows, listedRepo{
			name:        fmt.Sprintf("repo-%02d", index),
			description: `"x"`,
			stars:       1,
			pushedAt:    time.Date(2026, 8, 1+index, 10, 0, 0, 0, time.UTC).Format(time.RFC3339),
		})
	}
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/users/owner/repos": {contentType: "application/json", body: listingAnswer(rows...)},
	})
	loaded, err := projectsSource(t).refreshProjects(t.Context(), doer, func(string) string { return "" }, now)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if loaded.status != StatusOK {
		t.Errorf("status = %q, want ok: selection is a stated bound, not a failure", loaded.status)
	}
	payload := decodeProjects(t, loaded)
	if len(payload.Repos) != maxCodingProjectSources {
		t.Fatalf("served %d rows, want the %d cap", len(payload.Repos), maxCodingProjectSources)
	}
	if payload.Repos[0].Name != "repo-12" {
		t.Errorf("leading row = %q, want the most recently pushed", payload.Repos[0].Name)
	}
	for _, row := range payload.Repos {
		if row.Name == "repo-00" {
			t.Error("the oldest repository survived the recency selection; the cap dropped the wrong row")
		}
	}
}

// TestCodingProjectsReadAnonymouslyWithoutACredential pins the deliberate
// difference from the calendar: this producer's credential buys rate headroom,
// not access, so an unset variable changes nothing about what is served and
// only removes the header.
func TestCodingProjectsReadAnonymouslyWithoutACredential(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/users/owner/repos": {contentType: "application/json", body: listingAnswer(
			listedRepo{name: "alpha", description: `"alpha"`, stars: 1, pushedAt: "2026-08-27T10:00:00Z"},
		)},
	})
	loaded, err := projectsSource(t).refreshProjects(t.Context(), doer, func(string) string { return "" }, now)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if loaded.status != StatusOK {
		t.Errorf("status = %q, want ok: the credential is headroom, not access", loaded.status)
	}
	for _, request := range doer.at("/users/owner/repos") {
		if got := request.header.Get("Authorization"); got != "" {
			t.Errorf("an unset credential still sent an Authorization header %q", got)
		}
	}
}

// TestARefusedRowIsDroppedAndMakesTheRoundStale pins the per-row value tier:
// a row whose facts do not hold up is dropped rather than served wrong, the
// rows beside it stay live, and the envelope says the roster is not whole.
func TestARefusedRowIsDroppedAndMakesTheRoundStale(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/users/owner/repos": {contentType: "application/json", body: listingAnswer(
			listedRepo{name: "alpha", description: `"alpha lives"`, stars: 4, pushedAt: "2026-08-27T10:00:00Z"},
			listedRepo{name: "beta", description: `"from the future"`, stars: 1, pushedAt: "2027-01-01T00:00:00Z"},
		)},
	})
	loaded, err := projectsSource(t).refreshProjects(t.Context(), doer, func(string) string { return "" }, now)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if loaded.status != StatusStale {
		t.Errorf("status = %q, want stale while the roster is short a repository", loaded.status)
	}
	payload := decodeProjects(t, loaded)
	if len(payload.Repos) != 1 || payload.Repos[0].Name != "alpha" {
		t.Fatalf("served %v, want exactly the surviving row", payload.Repos)
	}
	if payload.Repos[0].Description != "alpha lives" {
		t.Errorf("the live row lost its data: %q", payload.Repos[0].Description)
	}
}

// TestARoundThatReadsNothingKeepsTheServedPayload pins the coarse failure
// direction: the listing failing — by status or by admission — fails the
// round, so the caller keeps its last-good LIVE payload serving as stale
// instead of replacing it with anything older or emptier.
func TestARoundThatReadsNothingKeepsTheServedPayload(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	for name, answer := range map[string]cannedAnswer{
		"a listing outage":      {status: http.StatusBadGateway, contentType: "application/json", body: "{}"},
		"an empty listing":      {contentType: "application/json", body: "[]"},
		"an unrelated document": {contentType: "application/json", body: `{"unrelated":true}`},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			doer := newCapturingDoer(map[string]cannedAnswer{"/users/owner/repos": answer})
			if _, err := projectsSource(t).refreshProjects(t.Context(), doer, func(string) string { return "" }, now); err == nil {
				t.Fatal("a round that read nothing reported a successful refresh")
			}
		})
	}
}

// TestTheRepositoryRowValueGateFailsClosed drives the per-row value gate.
// Every case parses as JSON and would produce a plausible row if its check
// were removed; each is projected exactly as the listing mapping projects a
// row, then driven through the same admission production runs.
func TestTheRepositoryRowValueGateFailsClosed(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	for _, testCase := range []struct {
		name string
		body string
		want string
	}{
		{"an unrelated JSON object", `{"unrelated":true}`, "push instant"},
		{"an unparseable instant", `{"description":"x","stargazers_count":1,"pushed_at":"yesterday"}`, "push instant"},
		{"an instant from the future", `{"description":"x","stargazers_count":1,"pushed_at":"2027-01-01T00:00:00Z"}`, "plausible window"},
		{"a negative tally", `{"description":"x","stargazers_count":-1,"pushed_at":"2026-08-27T10:00:00Z"}`, "star tally"},
		{"a description carrying control characters", `{"description":"a\u0007b","stargazers_count":1,"pushed_at":"2026-08-27T10:00:00Z"}`, "control characters"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			var entry repositoryListingEntry
			if err := json.Unmarshal([]byte(testCase.body), &entry); err != nil {
				t.Fatalf("decode listing row: %v", err)
			}
			candidate := listingCandidate{
				name: entry.Name, owner: entry.Owner.Login, private: entry.Private,
				description: entry.Description, stars: entry.Stars, pushedAt: entry.PushedAt,
			}
			if _, err := admitListedRepository(candidate, now); err == nil {
				t.Fatal("a hostile or drifted row produced a served row")
			} else if !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("refusal = %v, want it to name %q", err, testCase.want)
			}
		})
	}
	// The two figures issue #317 added get the same gate. Both fail the ROW,
	// which the page draws as a dash — never a zero and never half a version.
	for _, testCase := range []struct {
		name      string
		candidate listingCandidate
		want      string
	}{
		{"a negative closed-pull tally", listingCandidate{pulls: figureOf(-1)}, "closed pull-request tally"},
		{"a closed-pull tally past the bound", listingCandidate{pulls: figureOf(maxCountValue + 1)}, "closed pull-request tally"},
		{"a release tag carrying a path", listingCandidate{release: "v1/../../etc"}, "tag grammar"},
		{"a release tag carrying whitespace", listingCandidate{release: "v1 0"}, "tag grammar"},
		{"a release tag carrying control characters", listingCandidate{release: "v1\u0007"}, "tag grammar"},
		{"a release tag that is a dot name", listingCandidate{release: ".."}, "tag grammar"},
		{"a release tag past the bound", listingCandidate{release: strings.Repeat("v", maxReleaseTagRunes+1)}, "tag grammar"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			candidate := testCase.candidate
			candidate.name, candidate.stars, candidate.pushedAt = "alpha", 1, "2026-08-27T10:00:00Z"
			if _, err := admitListedRepository(candidate, now); err == nil {
				t.Fatal("a hostile or drifted figure produced a served row")
			} else if !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("refusal = %v, want it to name %q", err, testCase.want)
			}
		})
	}
}

// figureOf is a pointer to one tally, for the table above.
func figureOf(value int64) *int64 { return &value }

// TestTheRepositoryListingFailsClosed drives the identity tier of the listing
// gate: every case is a well-formed JSON array that would put a wrong or
// unownable row on the page if its check were removed, and every one refuses
// the WHOLE document — a listing carrying one forged row is a hostile
// listing, not a listing with a bad row.
//
// This tier is where the retired "a name is never the document's to choose"
// rule now lives: the name IS the document's — that is the owner's
// dynamic-roster ruling (issue 281) — and what makes it safe is the account
// pin, the name grammar, and the privacy check standing in front of it.
func TestTheRepositoryListingFailsClosed(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	good := listedRepo{name: "alpha", description: `"x"`, stars: 1, pushedAt: "2026-08-27T10:00:00Z"}
	for _, testCase := range []struct {
		name string
		body string
		want string
	}{
		{"a name outside the host's grammar", listingAnswer(good, listedRepo{name: "evil name/../x", description: `"x"`, stars: 1, pushedAt: "2026-08-27T10:00:00Z"}), "grammar"},
		{"a row belonging to another account", listingAnswer(good, listedRepo{name: "stranger", owner: "somebody-else", description: `"x"`, stars: 1, pushedAt: "2026-08-27T10:00:00Z"}), "configured account"},
		{"a private row in the public listing", listingAnswer(good, listedRepo{name: "hidden", private: true, description: `"x"`, stars: 1, pushedAt: "2026-08-27T10:00:00Z"}), "private"},
		{"a repository listed twice", listingAnswer(good, good), "listed twice"},
		{"an empty listing", "[]", "no repository at all"},
		{"an unrelated document", `{"unrelated":true}`, "repository listing"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			_, _, err := mapRepositoryListing([]byte(testCase.body), projectsSpec(), now)
			if err == nil {
				t.Fatal("a hostile or drifted listing was admitted")
			}
			if !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("refusal = %v, want it to name %q", err, testCase.want)
			}
		})
	}
	t.Run("a listing over the entry bound", func(t *testing.T) {
		t.Parallel()
		rows := make([]listedRepo, 0, maxListedRepositories+1)
		for index := range maxListedRepositories + 1 {
			rows = append(rows, listedRepo{name: fmt.Sprintf("repo-%03d", index), description: `"x"`, stars: 1, pushedAt: "2026-08-27T10:00:00Z"})
		}
		if _, _, err := mapRepositoryListing([]byte(listingAnswer(rows...)), projectsSpec(), now); err == nil {
			t.Fatal("a listing over the entry bound was admitted")
		} else if !strings.Contains(err.Error(), "over the") {
			t.Fatalf("refusal = %v, want the bound named", err)
		}
	})
	t.Run("value failures refuse the row and name it for the log", func(t *testing.T) {
		t.Parallel()
		listed, refused, err := mapRepositoryListing([]byte(listingAnswer(
			good,
			listedRepo{name: "gamma", description: `"x"`, stars: -1, pushedAt: "2026-08-27T08:00:00Z"},
			listedRepo{name: "delta", description: `"x"`, stars: 1, pushedAt: "yesterday"},
		)), projectsSpec(), now)
		if err != nil {
			t.Fatalf("map: %v", err)
		}
		if len(listed) != 1 || listed[0].row.Name != "alpha" {
			t.Fatalf("served %v, want exactly the surviving row", listed)
		}
		if len(refused) != 2 {
			t.Fatalf("refused %d rows, want both bad rows named for the log", len(refused))
		}
		for index, want := range []string{"gamma", "delta"} {
			if refused[index].name != want || refused[index].err == nil {
				t.Errorf("refusal %d = %q/%v, want %q with its reason", index, refused[index].name, refused[index].err, want)
			}
		}
	})
	t.Run("a repository never pushed is skipped without staleness", func(t *testing.T) {
		t.Parallel()
		listed, refused, err := mapRepositoryListing([]byte(listingAnswer(
			good,
			listedRepo{name: "unborn", description: `"x"`, stars: 0},
		)), projectsSpec(), now)
		if err != nil {
			t.Fatalf("map: %v", err)
		}
		if len(listed) != 1 || len(refused) != 0 {
			t.Fatalf("served %d rows with %d refusals, want the pushed row alone and no refusal: no pushes is no claim, not a fault", len(listed), len(refused))
		}
	})
}

// TestALongDescriptionIsTruncatedRatherThanLost pins the one place this
// producer clamps instead of refusing, and that it clamps visibly.
func TestALongDescriptionIsTruncatedRatherThanLost(t *testing.T) {
	t.Parallel()
	long := strings.Repeat("a", maxProjectDescriptionRunes+40)
	got, err := projectDescription(long)
	if err != nil {
		t.Fatalf("a long description was refused: %v", err)
	}
	if !strings.HasSuffix(got, "…") {
		t.Error("a truncated description carries no visible marker")
	}
	if length := len([]rune(got)); length != maxProjectDescriptionRunes+1 {
		t.Errorf("truncated to %d runes, want %d plus the marker", length, maxProjectDescriptionRunes)
	}
}

// TestTheServedRowsCarryTheReleaseAndClosedPullTally is issue #317's
// end-to-end claim: ONE credentialed document goes in, every row comes out
// carrying the version its host names and the all-time merged-or-closed
// tally, a repository that has never released carries no version at all
// rather than an invented one, and the credential rides the request.
func TestTheServedRowsCarryTheReleaseAndClosedPullTally(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/graphql/repositories": {contentType: "application/json", body: repositoriesAnswer(
			queriedRepo{name: "alpha", description: `"alpha"`, stars: 1, pushedAt: "2026-08-29T10:00:00Z", release: "v1.2.3", closedPulls: 41},
			queriedRepo{name: "beta", description: `"beta"`, stars: 1, pushedAt: "2026-08-28T10:00:00Z", closedPulls: 0},
		)},
	})
	loaded, err := queryingProjectsSource(t).refreshProjects(t.Context(), doer, func(name string) string {
		if name == "FIXTURE_PROJECTS_TOKEN" {
			return "fixture-token-value"
		}
		return ""
	}, now)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	payload := decodeProjects(t, loaded)
	if payload.Repos[0].Release != "v1.2.3" {
		t.Errorf("release = %q, want the tag its host names", payload.Repos[0].Release)
	}
	if payload.Repos[0].ClosedPulls == nil || *payload.Repos[0].ClosedPulls != 41 {
		t.Errorf("closed pulls = %v, want 41", payload.Repos[0].ClosedPulls)
	}
	// Never released is an absent version, and a reported zero is a figure:
	// the two say different things and the panel makes only the claim it can.
	if payload.Repos[1].Release != "" {
		t.Errorf("a repository with no release served %q", payload.Repos[1].Release)
	}
	if payload.Repos[1].ClosedPulls == nil || *payload.Repos[1].ClosedPulls != 0 {
		t.Errorf("a reported zero served %v, want 0", payload.Repos[1].ClosedPulls)
	}
	requests := doer.at("/graphql/repositories")
	if len(requests) != 1 {
		t.Fatalf("%d repository requests, want exactly one for the whole account", len(requests))
	}
	if got := requests[0].header.Get("Authorization"); got != "Bearer fixture-token-value" {
		t.Errorf("Authorization header = %q, want the prefixed credential", got)
	}
	if requests[0].method != http.MethodPost {
		t.Errorf("method = %s, want POST: the query travels in the request body", requests[0].method)
	}
	// The whole round is ONE request, and the listing is never consulted —
	// the arithmetic behind the rate-budget pin in fetch_test, executed on
	// the wire.
	if total := doer.total(); total != 1 {
		t.Errorf("the round made %d requests, want 1", total)
	}
}

// TestAnAnonymousProjectsRoundKeepsThePublicAnswer pins the honest narrowing:
// with no credential the panel reads the public listing it always did and
// serves rows WITHOUT the two new fields, which the page draws as dashes. A
// zero there would claim a repository has never released and never closed a
// pull request; absence claims nothing.
func TestAnAnonymousProjectsRoundKeepsThePublicAnswer(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/users/owner/repos": {contentType: "application/json", body: listingAnswer(
			listedRepo{name: "alpha", description: `"alpha lives"`, stars: 1, pushedAt: "2026-08-29T10:00:00Z"},
		)},
	})
	loaded, err := queryingProjectsSource(t).refreshProjects(t.Context(), doer, func(string) string { return "" }, now)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if loaded.status != StatusOK {
		t.Errorf("status = %q, want ok: the public answer is live, it just says less", loaded.status)
	}
	payload := decodeProjects(t, loaded)
	if payload.Repos[0].Description != "alpha lives" {
		t.Errorf("description = %q, want the live text", payload.Repos[0].Description)
	}
	if payload.Repos[0].ClosedPulls != nil || payload.Repos[0].Release != "" {
		t.Errorf("the public answer served %v/%q, want both absent", payload.Repos[0].ClosedPulls, payload.Repos[0].Release)
	}
	// The additive rule, proven on the wire rather than asserted: a payload
	// without the two fields must carry no KEYS for them, so a consumer
	// written before they existed sees the document it always saw.
	if bytes.Contains(loaded.data, []byte("closedPulls")) || bytes.Contains(loaded.data, []byte("release")) {
		t.Errorf("an absent field was serialized as a key: %s", loaded.data)
	}
	if got := len(doer.at("/graphql/repositories")); got != 0 {
		t.Errorf("an unset credential still posted %d queries", got)
	}
}

// TestACredentialedProjectsFailureNeverFallsBackToThePublicAnswer is the same
// deliberate NON-fallback the calendar producer carries: answering a transient
// fault by quietly serving an answer two columns narrower, under the same
// heading, is how a panel lies without anyone editing it.
func TestACredentialedProjectsFailureNeverFallsBackToThePublicAnswer(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/graphql/repositories": {status: http.StatusInternalServerError, contentType: "application/json", body: "{}"},
		"/users/owner/repos": {contentType: "application/json", body: listingAnswer(
			listedRepo{name: "alpha", description: `"alpha"`, stars: 1, pushedAt: "2026-08-29T10:00:00Z"},
		)},
	})
	if _, err := queryingProjectsSource(t).refreshProjects(t.Context(), doer, func(string) string { return "present" }, now); err == nil {
		t.Fatal("a failed credentialed read was reported as a successful refresh")
	}
	if len(doer.at("/users/owner/repos")) != 0 {
		t.Error("a credentialed failure fell through to the public listing, narrowing the answer without saying so")
	}
}

// TestTheRepositoryQueryEndpointIsHostCheckedToo pins that "optional"
// describes whether the document is CONFIGURED, never whether its URL is
// admitted. A second reachable URL that skipped the allowlist would be a hole
// in the one rule every outbound request passes.
func TestTheRepositoryQueryEndpointIsHostCheckedToo(t *testing.T) {
	t.Parallel()
	for name, edit := range map[string]func(*codingProjectsFetchSpec){
		"the repository query": func(s *codingProjectsFetchSpec) {
			s.Repositories.Endpoint = "https://elsewhere.example.net/graphql"
		},
		"a plain-http query": func(s *codingProjectsFetchSpec) {
			s.Repositories.Endpoint = "http://api.example.test/graphql"
		},
		"a body cap wider than shared": func(s *codingProjectsFetchSpec) {
			s.Repositories.MaxBytes = liveTestConfig().MaxBytes + 1
		},
		"a query with no credential to ride": func(s *codingProjectsFetchSpec) {
			s.KeyEnvName, s.KeyHeader, s.AuthenticatedMinIntervalMinutes = "", "", 0
		},
		"a query that never asks whose repositories it lists": func(s *codingProjectsFetchSpec) {
			s.Repositories.Query = "query { viewer { repositories } }"
		},
		"the listing itself": func(s *codingProjectsFetchSpec) {
			s.ListingEndpoint = "https://elsewhere.example.net/users/owner/repos"
		},
		"a plain-http listing": func(s *codingProjectsFetchSpec) {
			s.ListingEndpoint = "http://api.example.test/users/owner/repos"
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			spec := projectsSpecWithQuery()
			edit(spec)
			_, err := NewFetchSource(SnapshotSource{Name: "snapshots/coding-projects.json"}, liveTestConfig(),
				panelFetchSpecs{projects: spec})
			if err == nil {
				t.Fatal("an off-allowlist or incomplete document built a source")
			}
		})
	}
}

// TestTheCodingProjectsSpecFailsClosed pins the construction gate.
func TestTheCodingProjectsSpecFailsClosed(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name string
		edit func(*codingProjectsFetchSpec)
		want string
	}{
		{"no listing endpoint", func(s *codingProjectsFetchSpec) { s.ListingEndpoint = "" }, "listingEndpoint"},
		{"no account pin", func(s *codingProjectsFetchSpec) { s.Account = "" }, "account"},
		{"an account outside the login grammar", func(s *codingProjectsFetchSpec) { s.Account = "not a login" }, "account login"},
		{"an ungrammatical exclusion", func(s *codingProjectsFetchSpec) { s.Exclude = []string{"bad name"} }, "grammar"},
		{"the same exclusion twice", func(s *codingProjectsFetchSpec) { s.Exclude = []string{"twice", "twice"} }, "excluded twice"},
		{"a credential with nowhere to ride", func(s *codingProjectsFetchSpec) { s.KeyHeader = "" }, "declared together"},
		{"an authenticated cadence without a credential", func(s *codingProjectsFetchSpec) {
			s.KeyEnvName, s.KeyHeader = "", ""
		}, "requires a configured credential"},
		{"a header outside the public-producer list", func(s *codingProjectsFetchSpec) {
			s.Headers = map[string]string{"Authorization": "Bearer smuggled"}
		}, "not permitted"},
		{"an off-allowlist listing endpoint", func(s *codingProjectsFetchSpec) {
			s.ListingEndpoint = "https://exfiltrate.example.test/users/owner/repos"
		}, "allowlist"},
		{"a cadence outside the reviewed band", func(s *codingProjectsFetchSpec) { s.MinIntervalMinutes = 100000 }, "reviewed"},
		{"an authenticated cadence outside the reviewed band", func(s *codingProjectsFetchSpec) { s.AuthenticatedMinIntervalMinutes = 100000 }, "reviewed"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			spec := projectsSpec()
			testCase.edit(spec)
			_, err := NewFetchSource(SnapshotSource{Name: "snapshots/coding-projects.json"}, liveTestConfig(),
				panelFetchSpecs{projects: spec})
			if err == nil {
				t.Fatal("an unsafe coding-projects spec built a source")
			}
			if !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("refusal = %v, want it to name %q", err, testCase.want)
			}
		})
	}
}

/* ---------------------------------------------------------------------------
 * Unknown is not zero
 * ------------------------------------------------------------------------ */

// TestAFigureTheProducerCouldNotMeasureIsNeverPublishedAsZero is the owner's
// 2026-08-28 ruling made structural. A pushed section may present every key the
// closed vocabularies define and still carry nothing behind one of them; before
// this, that decoded to 0, satisfied the completeness rule, and put a
// confident zero on the page. Both directions are pinned: a null is refused,
// and a genuinely measured zero still passes.
func TestAFigureTheProducerCouldNotMeasureIsNeverPublishedAsZero(t *testing.T) {
	t.Parallel()
	t.Run("windows", func(t *testing.T) {
		t.Parallel()
		for _, testCase := range []struct {
			name    string
			body    string
			refused bool
		}{
			{"an explicit null half", `{"today":{"input":null,"output":2},"week":{"input":3,"output":4}}`, true},
			{"a half simply omitted", `{"today":{"output":2},"week":{"input":3,"output":4}}`, true},
			{"an empty window object", `{"today":{},"week":{"input":3,"output":4}}`, true},
			{"a measured zero", `{"today":{"input":0,"output":0},"week":{"input":3,"output":4}}`, false},
		} {
			t.Run(testCase.name, func(t *testing.T) {
				t.Parallel()
				var windows map[string]usageSeriesWindow
				if err := decodeStrict([]byte(testCase.body), &windows); err != nil {
					t.Fatalf("decode windows: %v", err)
				}
				_, err := admitSeriesWindows(windows)
				if testCase.refused && err == nil {
					t.Fatal("an unmeasured window was admitted and would have served as a zero")
				}
				if !testCase.refused && err != nil {
					t.Fatalf("a measured zero was refused: %v", err)
				}
				if testCase.refused && !strings.Contains(err.Error(), "carries no figures") {
					t.Fatalf("refusal = %v, want it to name the missing figures", err)
				}
			})
		}
	})
	t.Run("derived tiles", func(t *testing.T) {
		t.Parallel()
		tiles := []TokenUsageStat{
			{Key: statPeakDay, Label: "Peak day", Unit: UnitTokens},
			{Key: statCurrentStreak, Label: "Current streak", Unit: UnitDays},
			{Key: statLongestStreak, Label: "Longest streak", Unit: UnitDays},
			{Key: statActiveDays, Label: "Active days", Unit: UnitDays},
			{Key: statTrackedDays, Label: "Days tracked", Unit: UnitDays},
		}
		for _, testCase := range []struct {
			name    string
			body    string
			refused bool
		}{
			{"an explicit null figure", `{"peak-day":null,"current-streak":1,"longest-streak":2,"active-days":1,"tracked-days":2}`, true},
			{"a measured zero", `{"peak-day":0,"current-streak":0,"longest-streak":0,"active-days":0,"tracked-days":0}`, false},
		} {
			t.Run(testCase.name, func(t *testing.T) {
				t.Parallel()
				var derived map[string]*int64
				if err := decodeStrict([]byte(testCase.body), &derived); err != nil {
					t.Fatalf("decode derived: %v", err)
				}
				overlaid, err := overlayDerivedStats(tiles, derived)
				if testCase.refused {
					if err == nil {
						t.Fatal("an unmeasured tile was admitted and would have served as a zero")
					}
					if !strings.Contains(err.Error(), "carries no figure") {
						t.Fatalf("refusal = %v, want it to name the missing figure", err)
					}
					return
				}
				if err != nil {
					t.Fatalf("a measured zero was refused: %v", err)
				}
				for _, stat := range overlaid {
					if stat.Value == nil || *stat.Value != 0 {
						t.Errorf("tile %q = %v, want a real zero to survive", stat.Key, stat.Value)
					}
				}
			})
		}
	})
}

// TestTheCalendarSpecIsAdmittedAgainstTheSharedBounds pins that the new
// producer is held to the SAME construction bounds every other endpoint is,
// rather than arriving beside them with rules of its own.
func TestTheCalendarSpecIsAdmittedAgainstTheSharedBounds(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name string
		edit func(*vcsCalendarFetchSpec)
		want string
	}{
		{"an endpoint off the host allowlist", func(s *vcsCalendarFetchSpec) {
			s.Endpoint = "https://exfiltrate.example.test/graphql"
		}, "allowlist"},
		{"a body cap wider than the shared one", func(s *vcsCalendarFetchSpec) {
			s.MaxBytes = 1 << 30
		}, "max bytes"},
		{"a plain-http endpoint", func(s *vcsCalendarFetchSpec) {
			s.Endpoint = "http://api.example.test/graphql"
		}, "https"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			spec := calendarSpec()
			testCase.edit(spec)
			_, err := NewFetchSource(SnapshotSource{Name: "snapshots/vcs-activity.json"}, liveTestConfig(),
				panelFetchSpecs{vcs: activitySpec(spec)})
			if err == nil {
				t.Fatal("an unsafe calendar endpoint built a source")
			}
			if !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("refusal = %v, want it to name %q", err, testCase.want)
			}
		})
	}
}

// TestTheCodingProjectsSpecIsAdmittedAgainstTheSharedBounds does the same for
// the repository producer's own bounds — the declared answer type and the
// body cap, neither of which any other spec's checks would catch. (The row
// ceiling is no longer a spec fact: the listing decides membership, and
// TestARosterOverTheRowCapServesTheMostRecent pins the selection.)
func TestTheCodingProjectsSpecIsAdmittedAgainstTheSharedBounds(t *testing.T) {
	t.Parallel()
	t.Run("no declared answer type", func(t *testing.T) {
		t.Parallel()
		spec := projectsSpec()
		spec.ContentType = ""
		if err := validateCodingProjectsSpec(spec); err == nil {
			t.Fatal("a spec that declares no answer type was admitted")
		} else if !strings.Contains(err.Error(), "contentType") {
			t.Fatalf("refusal = %v, want contentType named", err)
		}
	})
	t.Run("a body cap wider than the shared one", func(t *testing.T) {
		t.Parallel()
		spec := projectsSpec()
		spec.MaxBytes = 1 << 30
		_, err := NewFetchSource(SnapshotSource{Name: "snapshots/coding-projects.json"}, liveTestConfig(),
			panelFetchSpecs{projects: spec})
		if err == nil {
			t.Fatal("a per-endpoint cap wider than the shared one built a source")
		} else if !strings.Contains(err.Error(), "max bytes") {
			t.Fatalf("refusal = %v, want the cap named", err)
		}
	})
}

// TestTheCalendarRefusesDocumentsTheWindowNeverAskedFor covers the three
// bounds that describe the SHAPE of the window rather than its contents: a day
// reported twice, a window running past the one that was requested, and a span
// beyond anything a year-long calendar can be.
func TestTheCalendarRefusesDocumentsTheWindowNeverAskedFor(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	start := firstSunday(now.AddDate(0, 0, -calendarWindowDays))
	days := int(now.Sub(start)/(24*time.Hour)) + 1

	t.Run("a day reported twice", func(t *testing.T) {
		t.Parallel()
		// Two week columns carrying the same dates. Without the repeat check
		// the second silently overwrites the first and the calendar looks
		// contiguous while covering half the days it claims.
		body := calendarAnswer(start, daysPerWeek*5, 1, nil)
		var document map[string]any
		if err := json.Unmarshal([]byte(body), &document); err != nil {
			t.Fatalf("reparse fixture: %v", err)
		}
		calendar := document["data"].(map[string]any)["viewer"].(map[string]any)["contributionsCollection"].(map[string]any)["contributionCalendar"].(map[string]any)
		weeks := calendar["weeks"].([]any)
		weeks[1] = weeks[0]
		calendar["weeks"] = weeks
		encoded, err := json.Marshal(document)
		if err != nil {
			t.Fatalf("re-encode fixture: %v", err)
		}
		if _, err := mapCalendarDocument(encoded, now); err == nil {
			t.Fatal("a calendar reporting one day twice was admitted")
		} else if !strings.Contains(err.Error(), "appears twice") {
			t.Fatalf("refusal = %v, want the repeat named", err)
		}
	})

	t.Run("a window running past the one that was requested", func(t *testing.T) {
		t.Parallel()
		// The same honest document, read against a clock a fortnight earlier:
		// every day is well formed and the totals agree, and it still describes
		// a range nobody asked for. It is refused by the SPECIFIC half of that
		// rule rather than the general one, and the distinction is the point —
		// the trailing days carry contributions, so they are days that have not
		// happened rather than the blank week padding a calendar may honestly
		// close its final column with (see the padding test below, which pins
		// the general overrun refusal and the tolerated case together).
		if _, err := mapCalendarDocument([]byte(calendarAnswer(start, days, 1, nil)), now.AddDate(0, 0, -14)); err == nil {
			t.Fatal("a calendar ending past the requested window was admitted")
		} else if !strings.Contains(err.Error(), "has not happened yet") {
			t.Fatalf("refusal = %v, want the unhappened day named", err)
		}
	})

	t.Run("a span no year-long calendar can have", func(t *testing.T) {
		t.Parallel()
		wide := firstSunday(now.AddDate(0, 0, -(maxCalendarDays + 30)))
		span := int(now.Sub(wide)/(24*time.Hour)) + 1
		if _, err := mapCalendarDocument([]byte(calendarAnswer(wide, span, 1, nil)), now); err == nil {
			t.Fatal("a calendar over the day bound was admitted")
		} else if !strings.Contains(err.Error(), "over the") {
			t.Fatalf("refusal = %v, want the bound named", err)
		}
	})
}

// TestARepositoryDescriptionThatIsNotTextIsRefused pins the UTF-8 half of the
// description gate. Ranging a Go string yields the replacement rune for every
// byte that is not valid UTF-8, so the one check covers both a mis-encoded
// document and the rare literal replacement character — and it REFUSES rather
// than strips, because quietly repairing hostile input is how the repair
// becomes the vulnerability.
func TestARepositoryDescriptionThatIsNotTextIsRefused(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	// Built as bytes rather than as a JSON escape: this is a document whose
	// bytes are not valid UTF-8, which is not the same thing as one that spells
	// the replacement character.
	document := []byte(`{"description":"a` + string([]byte{0xff}) + `b","stargazers_count":1,"pushed_at":"2026-08-27T10:00:00Z"}`)
	var entry repositoryListingEntry
	err := json.Unmarshal(document, &entry)
	if err == nil {
		_, err = admitListedRepository(listingCandidate{
			name: entry.Name, description: entry.Description, stars: entry.Stars, pushedAt: entry.PushedAt,
		}, now)
	}
	if err == nil {
		t.Fatal("a description that is not valid UTF-8 produced a row")
	} else if !strings.Contains(err.Error(), "UTF-8") && !strings.Contains(err.Error(), "invalid character") {
		t.Fatalf("refusal = %v, want the encoding named", err)
	}
	// And the same fault arriving through a well-formed JSON string still
	// refuses the row rather than the byte.
	if _, err := projectDescription("a�b"); err == nil {
		t.Fatal("a description carrying the replacement rune was admitted")
	}
}

// TestCodingProjectsHonorTheirRateBudget pins that the repository round is
// budgeted like every other producer: a second attempt inside the window is
// not a failure and must not climb a retry ladder or mark the panel stale.
func TestCodingProjectsHonorTheirRateBudget(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/users/owner/repos": {contentType: "application/json", body: listingAnswer(
			listedRepo{name: "alpha", description: `"alpha"`, stars: 1, pushedAt: "2026-08-27T10:00:00Z"},
		)},
	})
	source := projectsSource(t)
	if _, err := source.refreshProjects(t.Context(), doer, func(string) string { return "" }, now); err != nil {
		t.Fatalf("first round: %v", err)
	}
	before := len(doer.at("/users/owner/repos"))
	_, err := source.refreshProjects(t.Context(), doer, func(string) string { return "" }, now.Add(time.Minute))
	if !errors.Is(err, errNothingDue) {
		t.Fatalf("a round inside the budget reported %v, want errNothingDue", err)
	}
	if after := len(doer.at("/users/owner/repos")); after != before {
		t.Errorf("a budgeted round still made %d requests", after-before)
	}
}

// TestTheCalendarToleratesTrailingWeekPaddingButNotFutureContributions is the
// one upstream-shape assumption in this producer that could not be verified
// without a live credential, so it is pinned from both sides instead of
// assumed.
//
// A calendar is drawn in whole week columns while the window this package asks
// for ends TODAY, so the final column may legitimately be closed with the rest
// of the current week — days that have not happened. Refusing those outright
// would mean the panel silently stopped updating the day a credential landed,
// which is the exact failure this producer exists to prevent. They are dropped
// and the window's real end is reported through EndDate.
//
// The allowance is narrow, and the narrowness is what the second half pins: a
// future day carrying CONTRIBUTIONS is nonsense rather than padding, and a
// document running a whole week past the window is describing a range nobody
// asked for.
func TestTheCalendarToleratesTrailingWeekPaddingButNotFutureContributions(t *testing.T) {
	t.Parallel()
	// A Wednesday, so the padded column carries three unhappened days.
	now := time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)
	start := firstSunday(now.AddDate(0, 0, -calendarWindowDays))
	real := int(now.Sub(start)/(24*time.Hour)) + 1

	// padded builds the same calendar with `extra` trailing days appended,
	// each carrying `future` contributions.
	padded := func(extra, future int) []byte {
		body := calendarAnswer(start, real+extra, 1, nil)
		var document map[string]any
		if err := json.Unmarshal([]byte(body), &document); err != nil {
			t.Fatalf("reparse fixture: %v", err)
		}
		calendar := document["data"].(map[string]any)["viewer"].(map[string]any)["contributionsCollection"].(map[string]any)["contributionCalendar"].(map[string]any)
		seen := 0
		for _, week := range calendar["weeks"].([]any) {
			for _, day := range week.(map[string]any)["contributionDays"].([]any) {
				seen++
				if seen > real {
					day.(map[string]any)["contributionCount"] = future
				}
			}
		}
		// The reported total counts only the days inside the window, which is
		// what an upstream that pads with unhappened days would report.
		calendar["totalContributions"] = real
		encoded, err := json.Marshal(document)
		if err != nil {
			t.Fatalf("re-encode fixture: %v", err)
		}
		return encoded
	}

	t.Run("padding is dropped and the window's real end is reported", func(t *testing.T) {
		t.Parallel()
		mapped, err := mapCalendarDocument(padded(3, 0), now)
		if err != nil {
			t.Fatalf("a padded calendar was refused: %v", err)
		}
		var payload VCSActivityData
		if err := json.Unmarshal(mapped, &payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if payload.EndDate != now.Format(dayLayout) {
			t.Errorf("endDate = %q, want today (%s): the padding must not extend the window", payload.EndDate, now.Format(dayLayout))
		}
		if payload.TotalContributions != real {
			t.Errorf("totalContributions = %d, want %d", payload.TotalContributions, real)
		}
	})

	t.Run("an unpadded calendar is unaffected", func(t *testing.T) {
		t.Parallel()
		if _, err := mapCalendarDocument(padded(0, 0), now); err != nil {
			t.Fatalf("an exactly-fitting calendar was refused: %v", err)
		}
	})

	t.Run("a future day carrying contributions is refused", func(t *testing.T) {
		t.Parallel()
		if _, err := mapCalendarDocument(padded(3, 4), now); err == nil {
			t.Fatal("a calendar reporting contributions on a day that has not happened was admitted")
		} else if !strings.Contains(err.Error(), "has not happened yet") {
			t.Fatalf("refusal = %v, want the future day named", err)
		}
	})

	t.Run("more than a week past the window is refused", func(t *testing.T) {
		t.Parallel()
		if _, err := mapCalendarDocument(padded(daysPerWeek+1, 0), now); err == nil {
			t.Fatal("a calendar running a week past the window was admitted")
		} else if !strings.Contains(err.Error(), "past the window") {
			t.Fatalf("refusal = %v, want the overrun named", err)
		}
	})
}

/* ---------------------------------------------------------------------------
 * Conditional revalidation (issue 281)
 * ------------------------------------------------------------------------ */

// revalidatingDoer answers by URL path with a validator-stamped 200, answers
// 304 to any request presenting that validator, and records every request so
// the tests can prove which questions were asked.
type revalidatingDoer struct {
	mu          sync.Mutex
	answers     map[string]cannedAnswer
	etag        string
	requests    []recordedRequest
	notModified int
}

func (d *revalidatingDoer) Do(r *http.Request) (*http.Response, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.requests = append(d.requests, recordedRequest{method: r.Method, path: r.URL.Path, header: r.Header.Clone()})
	answer, known := d.answers[r.URL.Path]
	if !known {
		return nil, fmt.Errorf("revalidatingDoer: no answer scripted for %s", r.URL.Path)
	}
	header := http.Header{}
	if d.etag != "" && r.Header.Get("If-None-Match") == d.etag {
		d.notModified++
		return &http.Response{StatusCode: http.StatusNotModified, Header: header, Body: io.NopCloser(strings.NewReader(""))}, nil
	}
	if answer.contentType != "" {
		header.Set("Content-Type", answer.contentType)
	}
	header.Set("Etag", d.etag)
	return &http.Response{StatusCode: http.StatusOK, Header: header, Body: io.NopCloser(strings.NewReader(answer.body))}, nil
}

func (d *revalidatingDoer) at(path string) []recordedRequest {
	d.mu.Lock()
	defer d.mu.Unlock()
	matched := make([]recordedRequest, 0, len(d.requests))
	for _, request := range d.requests {
		if request.path == path {
			matched = append(matched, request)
		}
	}
	return matched
}

// TestConditionalRoundsRevalidateInsteadOfRetransferring is the end-to-end
// zero-spend claim (issue 281): the second round asks "has this changed?"
// with the retained validator, the upstream's 304 re-serves the retained
// bytes — costing nothing against the public API's per-address budget — and
// the payload is exactly what a full transfer would have produced, dated to
// the instant the upstream just vouched for.
func TestConditionalRoundsRevalidateInsteadOfRetransferring(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	doer := &revalidatingDoer{
		etag: `W/"fixture-validator"`,
		answers: map[string]cannedAnswer{
			"/users/owner/repos": {contentType: "application/json", body: listingAnswer(
				listedRepo{name: "alpha", description: `"alpha"`, stars: 3, pushedAt: "2026-08-27T10:00:00Z"},
			)},
		},
	}
	source := projectsSource(t)
	env := func(string) string { return "" }
	first, err := source.refreshProjects(t.Context(), doer, env, now)
	if err != nil {
		t.Fatalf("first round: %v", err)
	}
	requests := doer.at("/users/owner/repos")
	if len(requests) != 1 || requests[0].header.Get("If-None-Match") != "" {
		t.Fatalf("the FIRST request carried a validator nobody had retained yet: %v", requests)
	}
	later := now.Add(16 * time.Minute)
	second, err := source.refreshProjects(t.Context(), doer, env, later)
	if err != nil {
		t.Fatalf("second round: %v", err)
	}
	requests = doer.at("/users/owner/repos")
	if len(requests) != 2 {
		t.Fatalf("%d listing requests, want 2", len(requests))
	}
	if got := requests[1].header.Get("If-None-Match"); got != `W/"fixture-validator"` {
		t.Errorf("second request carried If-None-Match %q, want the retained validator", got)
	}
	if doer.notModified != 1 {
		t.Errorf("the upstream answered %d revalidations, want exactly 1", doer.notModified)
	}
	if !bytes.Equal(first.data, second.data) {
		t.Error("a revalidated round served different bytes than the transfer it stands for")
	}
	if second.status != StatusOK || second.generatedAt != later.Format(time.RFC3339) {
		t.Errorf("revalidated round = %q at %q, want ok dated to the instant the upstream vouched for", second.status, second.generatedAt)
	}
}

// TestRevalidationStaysInsideItsContract pins the two exclusions that keep
// the retention map bounded and the semantics honest: a request not flagged
// conditional never presents a validator even when one is retained for its
// endpoint, and a request carrying a body never participates at all.
func TestRevalidationStaysInsideItsContract(t *testing.T) {
	t.Parallel()
	source := projectsSource(t)
	doer := &revalidatingDoer{
		etag: `"fixture-validator"`,
		answers: map[string]cannedAnswer{
			"/document": {contentType: "application/json", body: `{"fixture":true}`},
		},
	}
	request := fetchRequest{
		source: "fixture", endpoint: "https://api.example.test/document",
		maxBytes: 1024, contentType: "application/json", conditional: true,
	}
	if _, err := source.fetchDocument(t.Context(), doer, request); err != nil {
		t.Fatalf("prime the retained document: %v", err)
	}
	plain := request
	plain.conditional = false
	if _, err := source.fetchDocument(t.Context(), doer, plain); err != nil {
		t.Fatalf("unconditional fetch: %v", err)
	}
	posting := request
	posting.payload = []byte(`{"q":1}`)
	if _, err := source.fetchDocument(t.Context(), doer, posting); err != nil {
		t.Fatalf("posting fetch: %v", err)
	}
	requests := doer.at("/document")
	if len(requests) != 3 {
		t.Fatalf("%d requests, want 3", len(requests))
	}
	if got := requests[1].header.Get("If-None-Match"); got != "" {
		t.Errorf("an unconditional request presented the validator %q", got)
	}
	if got := requests[2].header.Get("If-None-Match"); got != "" {
		t.Errorf("a request carrying a body presented the validator %q", got)
	}
	if doer.notModified != 0 {
		t.Errorf("%d revalidations happened outside the contract", doer.notModified)
	}
}

// TestAnUnsolicited304IsARefusedStatus probes the branch from the hostile
// side: a 304 this process never asked for — no validator went out — is an
// unexpected status like any other, refused rather than read as "serve
// whatever you have lying around".
func TestAnUnsolicited304IsARefusedStatus(t *testing.T) {
	t.Parallel()
	source := projectsSource(t)
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/document": {status: http.StatusNotModified, contentType: "application/json", body: ""},
	})
	_, err := source.fetchDocument(t.Context(), doer, fetchRequest{
		source: "fixture", endpoint: "https://api.example.test/document",
		maxBytes: 1024, contentType: "application/json", conditional: true,
	})
	if err == nil {
		t.Fatal("an unsolicited 304 was admitted with nothing retained to serve")
	}
	if !strings.Contains(err.Error(), "status 304") {
		t.Fatalf("refusal = %v, want the status named", err)
	}
}

// TestCredentialChangesReselectTheReservation crosses the two credential
// modes on ONE source per role, which the steady-state tests above never do
// (2026-09-04 security review round 2, finding 1). The budget is chosen per
// attempt from the credential present for that attempt and counts from the
// last request whoever made it: losing the token one minute after an
// authenticated request must NOT let an anonymous request through inside the
// public budget, and gaining the token one minute after an anonymous request
// must let the one-minute authenticated budget apply at once. All three
// GitHub roles share the mechanism, so all three are crossed.
func TestCredentialChangesReselectTheReservation(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	credential := func(string) string { return "fixture-token-value" }
	anonymous := func(string) string { return "" }
	start := firstSunday(now.AddDate(0, 0, -calendarWindowDays))
	days := int(now.Sub(start)/(24*time.Hour)) + 1

	type role struct {
		name   string
		public time.Duration
		paths  []string
		build  func(t *testing.T) (*FetchSource, *capturingDoer)
		// wake is one refresh attempt; it reports whether a request was made.
		wake func(t *testing.T, source *FetchSource, doer *capturingDoer, env func(string) string, at time.Time) bool
	}
	roles := []role{
		{
			name:   "calendar",
			public: 15 * time.Minute,
			paths:  []string{"/graphql", "/contributions"},
			build: func(t *testing.T) (*FetchSource, *capturingDoer) {
				t.Helper()
				source, err := NewFetchSource(SnapshotSource{Name: "snapshots/vcs-activity.json"}, liveTestConfig(),
					panelFetchSpecs{vcs: activitySpec(calendarSpec())})
				if err != nil {
					t.Fatalf("build source: %v", err)
				}
				return source, newCapturingDoer(map[string]cannedAnswer{
					"/graphql":       {contentType: "application/json", body: calendarAnswer(start, days, 1, nil)},
					"/contributions": {contentType: "text/html", body: fixtureContributions(t)},
				})
			},
			wake: func(t *testing.T, source *FetchSource, doer *capturingDoer, env func(string) string, at time.Time) bool {
				t.Helper()
				_, err := source.refreshActivity(t.Context(), doer, env, at)
				if errors.Is(err, errNothingDue) {
					return false
				}
				if err != nil {
					t.Fatalf("refresh at %v: %v", at, err)
				}
				return true
			},
		},
		{
			name:   "projects",
			public: 15 * time.Minute,
			paths:  []string{"/users/owner/repos"},
			build: func(t *testing.T) (*FetchSource, *capturingDoer) {
				t.Helper()
				source, err := NewFetchSource(SnapshotSource{Name: "snapshots/coding-projects.json"}, liveTestConfig(),
					panelFetchSpecs{projects: projectsSpec()})
				if err != nil {
					t.Fatalf("build source: %v", err)
				}
				return source, newCapturingDoer(map[string]cannedAnswer{
					"/users/owner/repos": {contentType: "application/json", body: listingAnswer(
						listedRepo{name: "alpha", description: `"alpha"`, stars: 1, pushedAt: "2026-08-27T10:00:00Z"},
					)},
				})
			},
			wake: func(t *testing.T, source *FetchSource, doer *capturingDoer, env func(string) string, at time.Time) bool {
				t.Helper()
				_, err := source.refreshProjects(t.Context(), doer, env, at)
				if errors.Is(err, errNothingDue) {
					return false
				}
				if err != nil {
					t.Fatalf("refresh at %v: %v", at, err)
				}
				return true
			},
		},
	}
	// The commit producer is NOT a role here, and its absence is the point:
	// both of its documents ask about the credential's own account, so losing
	// the credential does not move it to a slower budget — it stops the round
	// entirely (issue #315). That transition is proven where it happens, in
	// the "commits" subtest of TestCredentialledProducersUseTheirFastCadence.
	// The calendar's anonymous and credentialed requests go to different
	// paths, so the request one wake made is found by the path that grew.
	count := func(doer *capturingDoer, paths []string) int {
		total := 0
		for _, path := range paths {
			total += len(doer.at(path))
		}
		return total
	}
	newest := func(t *testing.T, doer *capturingDoer, paths []string, before map[string]int) recordedRequest {
		t.Helper()
		for _, path := range paths {
			if made := doer.at(path); len(made) > before[path] {
				return made[len(made)-1]
			}
		}
		t.Fatal("no path grew, so the wake made no request")
		return recordedRequest{}
	}
	seen := func(doer *capturingDoer, paths []string) map[string]int {
		before := make(map[string]int, len(paths))
		for _, path := range paths {
			before[path] = len(doer.at(path))
		}
		return before
	}

	for _, role := range roles {
		t.Run(role.name, func(t *testing.T) {
			t.Parallel()
			t.Run("losing the credential keeps the public budget counting from the last request", func(t *testing.T) {
				t.Parallel()
				source, doer := role.build(t)
				if !role.wake(t, source, doer, credential, now) {
					t.Fatal("the credentialed first wake made no request")
				}
				if role.wake(t, source, doer, anonymous, now.Add(time.Minute)) {
					t.Fatal("an anonymous wake one minute after a credentialed request made a request inside the public budget")
				}
				if got := count(doer, role.paths); got != 1 {
					t.Fatalf("requests after the held wake = %d, want 1", got)
				}
				before := seen(doer, role.paths)
				if !role.wake(t, source, doer, anonymous, now.Add(role.public)) {
					t.Fatalf("the public budget of %v elapsed from the last request and no request was made", role.public)
				}
				if got := count(doer, role.paths); got != 2 {
					t.Fatalf("requests after the public budget elapsed = %d, want 2", got)
				}
				if got := newest(t, doer, role.paths, before).header.Get("Authorization"); got != "" {
					t.Errorf("an anonymous attempt carried a credential header %q", got)
				}
			})
			t.Run("gaining the credential selects the authenticated budget", func(t *testing.T) {
				t.Parallel()
				source, doer := role.build(t)
				if !role.wake(t, source, doer, anonymous, now) {
					t.Fatal("the anonymous first wake made no request")
				}
				before := seen(doer, role.paths)
				if !role.wake(t, source, doer, credential, now.Add(time.Minute)) {
					t.Fatal("a credentialed wake one minute after an anonymous request was held on the public budget")
				}
				if got := count(doer, role.paths); got != 2 {
					t.Fatalf("requests after the credentialed wake = %d, want 2", got)
				}
				if got := newest(t, doer, role.paths, before).header.Get("Authorization"); got != "Bearer fixture-token-value" {
					t.Errorf("credentialed request header = %q", got)
				}
				if role.wake(t, source, doer, credential, now.Add(90*time.Second)) {
					t.Fatal("a credentialed wake thirty seconds later made a request inside the one-minute authenticated budget")
				}
			})
		})
	}
}

/* ---------------------------------------------------------------------------
 * The commit log's two query documents (issue #315)
 * ------------------------------------------------------------------------ */

// commitRoundNow is the fixed instant every commit-round scenario measures
// against, so the window checks are exercised deterministically rather than
// against a clock that moves under the suite.
var commitRoundNow = time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)

// windowDay is a bucket instant `days` days before that instant, written the
// way the upstream writes one: the account's own local midnight in UTC, which
// is why these fixtures never sit exactly on the window's edge.
func windowDay(days int) string {
	return commitRoundNow.AddDate(0, 0, -days).Format("2006-01-02") + "T07:00:00Z"
}

// TestTheDiscoveryAnswerDecidesWhatIsAskedAndWhatIsCounted is the commit
// producer's whole gate over its FIRST document: which repositories become
// named rows, which become an aggregate, and which are counted and never
// listed at all.
func TestTheDiscoveryAnswerDecidesWhatIsAskedAndWhatIsCounted(t *testing.T) {
	t.Parallel()
	answer := contributionsAnswer([]fixtureContributionRepo{
		{id: "R_public", name: "public-repo", days: []fixtureContributionDay{
			{at: windowDay(1), count: 3}, {at: windowDay(4), count: 1},
		}},
		{id: "R_older", name: "older-repo", days: []fixtureContributionDay{{at: windowDay(9), count: 2}}},
		// Someone else's repository. The account really did commit there, so
		// the commits COUNT — dropping them would break the document's own
		// arithmetic — and the repository is not the owner's to list.
		{id: "R_foreign", name: "somebody-elses", owner: "another-account", days: []fixtureContributionDay{{at: windowDay(2), count: 5}}},
		// Two private repositories on the SAME day, which is the only way the
		// per-day repository count is ever more than one.
		{id: "R_secret", name: "a-private-name", private: true, days: []fixtureContributionDay{
			{at: windowDay(1), count: 4}, {at: windowDay(3), count: 1},
		}},
		{id: "R_secret2", name: "another-private-name", private: true, days: []fixtureContributionDay{{at: windowDay(1), count: 2}}},
	}, nil)
	author, repos, days, err := mapCommitContributions([]byte(answer), "fixture-owner", commitRoundNow)
	if err != nil {
		t.Fatalf("a realistic discovery answer was refused: %v", err)
	}
	if author != "U_fixture-viewer" {
		t.Errorf("author identity = %q", author)
	}
	// The account's OWN public repositories, newest activity first. The
	// foreign one and both private ones are absent.
	names := make([]string, 0, len(repos))
	for _, repo := range repos {
		names = append(names, repo.name)
	}
	if len(names) != 2 || names[0] != "public-repo" || names[1] != "older-repo" {
		t.Fatalf("asked about %v, want the account's own public repositories newest first", names)
	}
	// THE PRIVATE AGGREGATE IS THE WHOLE ROW, newest day first.
	if len(days) != 2 {
		t.Fatalf("private days = %+v, want two", days)
	}
	if days[0].Date != commitRoundNow.AddDate(0, 0, -1).Format(dayLayout) {
		t.Errorf("private days are not newest first: %+v", days)
	}
	if days[0].Contributions != 6 || days[0].Repositories != 2 {
		t.Errorf("the busy private day = %+v, want 6 contributions across 2 repositories", days[0])
	}
	if days[1].Contributions != 1 || days[1].Repositories != 1 {
		t.Errorf("the quiet private day = %+v", days[1])
	}
	// NOTHING ABOUT A PRIVATE REPOSITORY SURVIVES (requirement 12). The
	// serialized aggregate is searched for every fact the document carried
	// about one — its name and its opaque identity — because "we never copy
	// it" is a claim a test can actually check.
	encoded, err := json.Marshal(days)
	if err != nil {
		t.Fatalf("marshal the aggregate: %v", err)
	}
	for _, leak := range []string{"a-private-name", "another-private-name", "R_secret"} {
		if bytes.Contains(encoded, []byte(leak)) {
			t.Errorf("the private aggregate carries %q: %s", leak, encoded)
		}
	}
	// And the identities that DO travel are only the ones asked about.
	for _, repo := range repos {
		if repo.id == "R_secret" || repo.id == "R_secret2" || repo.id == "R_foreign" {
			t.Errorf("the second document would ask about %q", repo.id)
		}
	}
	// A day with no private contribution has no row: no zero facts.
	quiet := contributionsAnswer([]fixtureContributionRepo{
		{id: "R_public", name: "public-repo", days: []fixtureContributionDay{{at: windowDay(1), count: 3}}},
		{id: "R_secret", name: "a-private-name", private: true, days: []fixtureContributionDay{{at: windowDay(2), count: 0}}},
	}, nil)
	if _, _, days, err := mapCommitContributions([]byte(quiet), "fixture-owner", commitRoundNow); err != nil || len(days) != 0 {
		t.Errorf("a private day of zero produced %+v (%v); a zero is the absence of a fact, not one", days, err)
	}
}

// TestTheDiscoveryAnswerFailsClosedOnEveryDrift drives every refusal. Each case
// would produce a plausible, renderable log if its check were removed — which
// is the whole danger: a half-understood discovery answer looks exactly like a
// quiet month.
func TestTheDiscoveryAnswerFailsClosedOnEveryDrift(t *testing.T) {
	t.Parallel()
	good := fixtureContributionRepo{id: "R_public", name: "public-repo", days: []fixtureContributionDay{{at: windowDay(1), count: 3}}}
	oversized := make([]fixtureContributionRepo, 0, maxContributionRepositories+1)
	for index := range maxContributionRepositories + 1 {
		oversized = append(oversized, fixtureContributionRepo{
			id:   fmt.Sprintf("R_%d", index),
			name: fmt.Sprintf("repo-%d", index),
			days: []fixtureContributionDay{{at: windowDay(1), count: 1}},
		})
	}
	manyDays := make([]fixtureContributionDay, 0, maxContributionDays+1)
	for index := range maxContributionDays + 1 {
		manyDays = append(manyDays, fixtureContributionDay{at: windowDay(index), count: 1})
	}
	wrongTotal := 99
	for name, body := range map[string]string{
		"not an object at all":    `[]`,
		"malformed json":          `{"data":`,
		"an unrelated payload":    `{"data":{"unrelated":"shape"}}`,
		"an upstream error array": `{"errors":[{"message":"bad credentials"}]}`,
		"no data at all":          `{}`,
		"no account identity": contributionsAnswer([]fixtureContributionRepo{good}, nil)[:len(`{"data":{"viewer":{"id":"`)] +
			`","contributionsCollection":{"totalCommitContributions":0,"commitContributionsByRepository":[]}}}}`,
		"a name outside the host's grammar": contributionsAnswer([]fixtureContributionRepo{
			good, {id: "R_bad", name: "evil name/../x", days: []fixtureContributionDay{{at: windowDay(1), count: 1}}},
		}, nil),
		"a name that is a filesystem dot name": contributionsAnswer([]fixtureContributionRepo{
			good, {id: "R_dot", name: "..", days: []fixtureContributionDay{{at: windowDay(1), count: 1}}},
		}, nil),
		// The hostile case the brief names by hand: a repository that is
		// private AND appears again in a public-looking entry. A document that
		// cannot keep one name on one side of that line is a document nothing
		// here can trust about which is which.
		"one name listed both private and public": contributionsAnswer([]fixtureContributionRepo{
			{id: "R_secret", name: "two-faced", private: true, days: []fixtureContributionDay{{at: windowDay(1), count: 1}}},
			{id: "R_public2", name: "two-faced", days: []fixtureContributionDay{{at: windowDay(1), count: 1}}},
		}, nil),
		"a repository with no node identity": contributionsAnswer([]fixtureContributionRepo{
			{id: "", name: "public-repo", days: []fixtureContributionDay{{at: windowDay(1), count: 1}}},
		}, nil),
		"a node identity carrying whitespace": contributionsAnswer([]fixtureContributionRepo{
			{id: "R_ bad", name: "public-repo", days: []fixtureContributionDay{{at: windowDay(1), count: 1}}},
		}, nil),
		"a node identity past the bound": contributionsAnswer([]fixtureContributionRepo{
			{id: strings.Repeat("R", maxNodeIdentifierRunes+1), name: "public-repo", days: []fixtureContributionDay{{at: windowDay(1), count: 1}}},
		}, nil),
		"more repositories than the bound": contributionsAnswer(oversized, nil),
		"more dated buckets than the window has days": contributionsAnswer([]fixtureContributionRepo{
			{id: "R_public", name: "public-repo", days: manyDays},
		}, nil),
		"a negative count": contributionsAnswer([]fixtureContributionRepo{
			{id: "R_public", name: "public-repo", days: []fixtureContributionDay{{at: windowDay(1), count: -1}}},
		}, nil),
		"an unparseable bucket instant": contributionsAnswer([]fixtureContributionRepo{
			{id: "R_public", name: "public-repo", days: []fixtureContributionDay{{at: "yesterday", count: 1}}},
		}, nil),
		"a bucket older than the window": contributionsAnswer([]fixtureContributionRepo{
			{id: "R_public", name: "public-repo", days: []fixtureContributionDay{{at: windowDay(commitLogWindowDays + 3), count: 1}}},
		}, nil),
		"a bucket from the future": contributionsAnswer([]fixtureContributionRepo{
			{id: "R_public", name: "public-repo", days: []fixtureContributionDay{{at: commitRoundNow.AddDate(0, 0, 2).Format(time.RFC3339), count: 1}}},
		}, nil),
		// The cross-field integrity rule: the document reports its own total
		// beside the days, and the two must agree or this package has
		// half-understood it.
		"days that do not sum to the document's own total": contributionsAnswer([]fixtureContributionRepo{good}, &wrongTotal),
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if _, repos, days, err := mapCommitContributions([]byte(body), "fixture-owner", commitRoundNow); err == nil {
				t.Fatalf("a drifted discovery answer produced %+v / %+v", repos, days)
			}
		})
	}
	// The positive controls: the bound's own worth of repositories and days is
	// fine, so every refusal above is about the drift and not the builder.
	atBound := contributionsAnswer(oversized[:maxContributionRepositories], nil)
	if _, _, _, err := mapCommitContributions([]byte(atBound), "fixture-owner", commitRoundNow); err != nil {
		t.Errorf("a document exactly at the repository bound was refused: %v", err)
	}
	edge := contributionsAnswer([]fixtureContributionRepo{
		{id: "R_public", name: "public-repo", days: []fixtureContributionDay{{at: windowDay(commitLogWindowDays), count: 1}}},
	}, nil)
	if _, _, _, err := mapCommitContributions([]byte(edge), "fixture-owner", commitRoundNow); err != nil {
		t.Errorf("a bucket on the window's own oldest day was refused: %v; the upstream buckets by the account's local day and a day of slack is what admits it", err)
	}
}

// TestTheHistoryRequestIsBoundedByRecency pins the drop rule the second
// document depends on: a busy month is more repositories than one answer
// should carry, and the round drops the quietest rather than opening a third
// document — which is the per-repository fan-out this producer exists to
// avoid.
func TestTheHistoryRequestIsBoundedByRecency(t *testing.T) {
	t.Parallel()
	repos := make([]fixtureContributionRepo, 0, maxHistoryRepositories+3)
	for index := range maxHistoryRepositories + 3 {
		repos = append(repos, fixtureContributionRepo{
			id:   fmt.Sprintf("R_%d", index),
			name: fmt.Sprintf("repo-%02d", index),
			// Newest first: repo-00 is the most recently active.
			days: []fixtureContributionDay{{at: windowDay(index + 1), count: 1}},
		})
	}
	_, admitted, _, err := mapCommitContributions([]byte(contributionsAnswer(repos, nil)), "fixture-owner", commitRoundNow)
	if err != nil {
		t.Fatalf("map: %v", err)
	}
	if len(admitted) != maxHistoryRepositories {
		t.Fatalf("asked about %d repositories, want the %d bound", len(admitted), maxHistoryRepositories)
	}
	if admitted[0].name != "repo-00" || admitted[len(admitted)-1].name != fmt.Sprintf("repo-%02d", maxHistoryRepositories-1) {
		t.Errorf("the roster is not the most recently active ones: %s … %s", admitted[0].name, admitted[len(admitted)-1].name)
	}
}

// TestTheCommitRoundIsTwoDocumentsAndNeverMore drives the whole round over the
// wire: discovery, then history, then the merged list — with the request count
// pinned, because "never one call per repository per refresh" is the rate
// property the owner's ruling rests on.
func TestTheCommitRoundIsTwoDocumentsAndNeverMore(t *testing.T) {
	t.Parallel()
	repos := make([]fixtureContributionRepo, 0, maxHistoryRepositories)
	histories := make([]fixtureHistoryRepo, 0, maxHistoryRepositories)
	for index := range maxHistoryRepositories {
		name := fmt.Sprintf("repo-%02d", index)
		repos = append(repos, fixtureContributionRepo{
			id:   fmt.Sprintf("R_%d", index),
			name: name,
			days: []fixtureContributionDay{{at: windowDay(index + 1), count: 1}},
		})
		histories = append(histories, fixtureHistoryRepo{
			name: name, shaOffset: index * 10,
			commits: [][2]string{{fmt.Sprintf("feat: %s", name), commitRoundNow.Add(-time.Duration(index+1) * time.Hour).Format(time.RFC3339)}},
		})
	}
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/graphql/contributions": {contentType: "application/json", body: contributionsAnswer(repos, nil)},
		"/graphql/history":       {contentType: "application/json", body: historyAnswer(histories...)},
	})
	source, err := NewFetchSource(SnapshotSource{Name: "snapshots/vcs-activity.json"}, liveTestConfig(),
		panelFetchSpecs{vcs: &vcsActivityFetchSpec{
			Endpoint:           "https://public.example.test/contributions",
			Headers:            map[string]string{"Accept": "text/html"},
			MaxBytes:           1 << 17,
			ContentType:        "text/html",
			MinIntervalMinutes: 15,
			Commits:            commitQuerySpec(10),
		}},
	)
	if err != nil {
		t.Fatalf("build source: %v", err)
	}
	rows, days, at, attempted, fresh := source.commitSection(t.Context(), doer,
		func(string) string { return "fixture-token-value" }, source.specs.vcs.Commits, commitRoundNow)
	if !attempted || !fresh {
		t.Fatalf("commitSection = attempted %t fresh %t", attempted, fresh)
	}
	if at.IsZero() {
		t.Error("a freshly read list carries no instant")
	}
	if len(days) != 0 {
		t.Errorf("a window with no private contribution produced %+v", days)
	}
	// TWO requests for twelve repositories. A producer that fanned out would
	// make this thirteen.
	if got := doer.total(); got != 2 {
		t.Errorf("the round made %d requests for %d repositories, want 2", got, maxHistoryRepositories)
	}
	// Newest first across every repository, capped by the configured limit.
	if len(rows) != source.specs.vcs.Commits.Max {
		t.Fatalf("served %d rows, want the configured %d", len(rows), source.specs.vcs.Commits.Max)
	}
	for index := 1; index < len(rows); index++ {
		if rows[index-1].At < rows[index].At {
			t.Errorf("row %d is older than the row above it: %+v", index, rows)
		}
	}
	// The SECOND request asked by identity, and by the identities the first
	// answer carried — never by name, and never in the request line.
	history := doer.at("/graphql/history")
	if len(history) != 1 {
		t.Fatalf("%d history requests, want one", len(history))
	}
	var posted queryRequest
	if err := json.Unmarshal([]byte(history[0].body), &posted); err != nil {
		t.Fatalf("decode the posted body: %v", err)
	}
	if len(posted.Variables.IDs) != maxHistoryRepositories {
		t.Errorf("asked about %d identities, want %d", len(posted.Variables.IDs), maxHistoryRepositories)
	}
	if posted.Variables.Author != "U_fixture-viewer" {
		t.Errorf("the history document did not filter to the account: %q", posted.Variables.Author)
	}
	for _, repo := range repos {
		if strings.Contains(posted.Query, repo.name) {
			t.Errorf("a repository name was interpolated into the query document: %q", repo.name)
		}
	}
}

// TestAPrivateRepositoryNeverReachesTheWire is the requirement-12 pin driven
// end to end, over the whole round: a private repository's name is in the
// discovery answer, and no byte of it may reach the served payload — not as a
// row, not as a label, not in a log line.
func TestAPrivateRepositoryNeverReachesTheWire(t *testing.T) {
	t.Parallel()
	const secret = "a-name-that-must-not-travel"
	var out bytes.Buffer
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/graphql": {contentType: "application/json", body: calendarAnswer(
			firstSunday(commitRoundNow.AddDate(0, 0, -calendarWindowDays)),
			int(commitRoundNow.Sub(firstSunday(commitRoundNow.AddDate(0, 0, -calendarWindowDays)))/(24*time.Hour))+1, 1, nil)},
		"/graphql/contributions": {contentType: "application/json", body: contributionsAnswer([]fixtureContributionRepo{
			{id: "R_public", name: "public-repo", days: []fixtureContributionDay{{at: windowDay(1), count: 1}}},
			{id: "R_secret", name: secret, private: true, days: []fixtureContributionDay{{at: windowDay(1), count: 7}}},
		}, nil)},
		"/graphql/history": {contentType: "application/json", body: historyAnswer(
			fixtureHistoryRepo{name: "public-repo", commits: [][2]string{
				{"feat: a public subject", commitRoundNow.Add(-time.Hour).Format(time.RFC3339)},
			}},
		)},
	})
	source, err := NewFetchSource(SnapshotSource{Name: "snapshots/vcs-activity.json"}, liveTestConfig(),
		panelFetchSpecs{vcs: activitySpecWithCommits()})
	if err != nil {
		t.Fatalf("build source: %v", err)
	}
	source.setLogger(slog.New(slog.NewJSONHandler(&out, &slog.HandlerOptions{Level: slog.LevelDebug})))
	loaded, err := source.refreshActivity(t.Context(), doer, func(string) string { return "fixture-token-value" }, commitRoundNow)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if bytes.Contains(loaded.data, []byte(secret)) {
		t.Fatalf("the served payload names a private repository: %s", loaded.data)
	}
	if strings.Contains(out.String(), secret) {
		t.Errorf("a log line names a private repository: %s", out.String())
	}
	payload := decodeActivityPayload(t, loaded)
	if len(payload.PrivateActivity) != 1 || payload.PrivateActivity[0].Contributions != 7 {
		t.Fatalf("the private day was lost: %+v", payload.PrivateActivity)
	}
	if payload.PrivateActivity[0].Repositories != 1 {
		t.Errorf("private repositories that day = %d, want 1", payload.PrivateActivity[0].Repositories)
	}
	// And the public half is untouched beside it.
	if len(payload.RecentCommits) != 1 || payload.RecentCommits[0].Repo != "public-repo" {
		t.Errorf("the public rows are wrong: %+v", payload.RecentCommits)
	}
}

// activitySpecWithCommits is the whole version-control spec used by the
// end-to-end scenarios above: the public document, the credentialed calendar,
// and the commit producer's two query documents.
func activitySpecWithCommits() *vcsActivityFetchSpec {
	spec := activitySpec(calendarSpec())
	spec.Commits = commitQuerySpec(10)
	return spec
}

// TestTheCredentialNeverReachesAServedByteOrALogLine is the other half of the
// credential contract: it rides one request header and nothing else. The
// sentinel is searched for in the payload, in every log line, and in every
// request body the round posted.
func TestTheCredentialNeverReachesAServedByteOrALogLine(t *testing.T) {
	t.Parallel()
	const credential = "commit-credential-sentinel-eeee"
	var out bytes.Buffer
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/graphql/contributions": {contentType: "application/json", body: contributionsAnswer([]fixtureContributionRepo{
			{id: "R_public", name: "public-repo", days: []fixtureContributionDay{{at: windowDay(1), count: 1}}},
		}, nil)},
		"/graphql/history": {contentType: "application/json", body: historyAnswer(
			fixtureHistoryRepo{name: "public-repo", commits: [][2]string{
				{"feat: a public subject", commitRoundNow.Add(-time.Hour).Format(time.RFC3339)},
			}},
		)},
	})
	source, err := NewFetchSource(SnapshotSource{Name: "snapshots/vcs-activity.json"}, liveTestConfig(),
		panelFetchSpecs{vcs: activitySpecWithCommits()})
	if err != nil {
		t.Fatalf("build source: %v", err)
	}
	source.setLogger(slog.New(slog.NewJSONHandler(&out, &slog.HandlerOptions{Level: slog.LevelDebug})))
	rows, _, _, _, _ := source.commitSection(t.Context(), doer, func(string) string { return credential },
		source.specs.vcs.Commits, commitRoundNow)
	if len(rows) == 0 {
		t.Fatal("the round served nothing; the scenario would then prove nothing")
	}
	encoded, err := json.Marshal(rows)
	if err != nil {
		t.Fatalf("marshal rows: %v", err)
	}
	if bytes.Contains(encoded, []byte(credential)) {
		t.Error("the served rows carry the credential")
	}
	if strings.Contains(out.String(), credential) {
		t.Errorf("a log line carries the credential: %s", out.String())
	}
	carried := 0
	for _, request := range doer.requests {
		if strings.Contains(request.body, credential) {
			t.Error("a request BODY carries the credential; it rides one header and nothing else")
		}
		if request.header.Get("Authorization") == "Bearer "+credential {
			carried++
		}
	}
	if carried != 2 {
		t.Errorf("%d of the round's requests carried the credential header, want both", carried)
	}
}

// TestThePinnedSetMarksRowsAndNeverInventsOne pins the owner's curation
// (2026-09-11): pinning a repository on the host marks its row, with no edit
// here and no release. The mark is a FLAG rather than a selection — which rows
// the page lists is the page's decision — and the three hostile shapes are the
// ones a pinned set can really take.
func TestThePinnedSetMarksRowsAndNeverInventsOne(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	answer := fmt.Sprintf(`{"data":{"viewer":{"login":"fixture-owner","pinnedItems":{"nodes":[%s]},"repositories":{"nodes":[%s]}}}}`,
		strings.Join([]string{
			`{"name":"alpha","isPrivate":false}`,
			// A pinned PRIVATE repository whose name is ALSO the name of a
			// listed public row — a document contradicting itself, which is
			// the only shape in which a private pin could ever reach a row.
			// The mark is refused: a repository this document calls private is
			// one it cannot be trusted about, and the row stays unmarked.
			`{"name":"beta","isPrivate":true}`,
			// A pinned name the listing does not carry: a pin marks a row that
			// exists, it is never a row of its own.
			`{"name":"not-in-the-listing","isPrivate":false}`,
			// The pinned set may hold gists too, and the query's inline
			// fragment selects only the repository case — so a non-repository
			// entry decodes to an empty name and is skipped, not refused.
			`{}`,
		}, ","),
		strings.Join([]string{
			`{"name":"alpha","description":"a","isPrivate":false,"stargazerCount":1,"pushedAt":"2026-09-11T10:00:00Z","latestRelease":null,"pullRequests":{"totalCount":2}}`,
			`{"name":"beta","description":"b","isPrivate":false,"stargazerCount":0,"pushedAt":"2026-09-10T10:00:00Z","latestRelease":null,"pullRequests":{"totalCount":0}}`,
		}, ","))
	listed, refused, err := mapRepositoryQuery([]byte(answer), pinnedFixtureSpec(), now)
	if err != nil || len(refused) != 0 {
		t.Fatalf("a realistic answer was refused: %v / %+v", err, refused)
	}
	if len(listed) != 2 {
		t.Fatalf("served %d rows, want 2", len(listed))
	}
	if !listed[0].row.Pinned || listed[0].row.Name != "alpha" {
		t.Errorf("the pinned row is unmarked: %+v", listed[0].row)
	}
	if listed[1].row.Pinned {
		t.Errorf("an unpinned row is marked: %+v", listed[1].row)
	}
	// Nothing about the private pin, and no phantom row for the pinned name
	// the listing never carried.
	encoded, err := json.Marshal(listed[0].row)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	for _, leak := range []string{"not-in-the-listing"} {
		if bytes.Contains(encoded, []byte(leak)) {
			t.Errorf("a served row carries %q", leak)
		}
	}
	for _, project := range listed {
		if project.row.Name == "not-in-the-listing" {
			t.Errorf("a pinned name became a row of its own: %+v", project.row)
		}
	}
	// A FALSE flag is omitted from the wire, which is what keeps the field
	// additive: a reader written before it existed sees the document it
	// always saw.
	unpinned, err := json.Marshal(listed[1].row)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if bytes.Contains(unpinned, []byte("pinned")) {
		t.Errorf("an unpinned row serialized the flag: %s", unpinned)
	}
}

// TestAPinnedRowSurvivesTheRecencyCap is the reason the cap is pin-aware at
// all. The page lists the owner's pinned repositories; a pin that fell off a
// recency cap because a handful of other repositories happened to be pushed
// today would be a card that vanished for a reason nobody could see.
func TestAPinnedRowSurvivesTheRecencyCap(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	rows := make([]string, 0, maxCodingProjectSources+3)
	for index := range maxCodingProjectSources + 3 {
		rows = append(rows, fmt.Sprintf(
			`{"name":"repo-%02d","description":"d","isPrivate":false,"stargazerCount":0,"pushedAt":%q,"latestRelease":null,"pullRequests":{"totalCount":0}}`,
			index, now.AddDate(0, 0, -index).Format(time.RFC3339)))
	}
	// The OLDEST repository is the pinned one, so a cap that only kept the
	// newest would drop it.
	oldest := fmt.Sprintf("repo-%02d", maxCodingProjectSources+2)
	answer := fmt.Sprintf(`{"data":{"viewer":{"login":"fixture-owner","pinnedItems":{"nodes":[{"name":%q,"isPrivate":false}]},"repositories":{"nodes":[%s]}}}}`,
		oldest, strings.Join(rows, ","))
	listed, _, err := mapRepositoryQuery([]byte(answer), pinnedFixtureSpec(), now)
	if err != nil {
		t.Fatalf("map: %v", err)
	}
	// The cap still bounds the payload.
	if len(listed) != maxCodingProjectSources {
		t.Fatalf("served %d rows, want the %d cap", len(listed), maxCodingProjectSources)
	}
	names := make([]string, 0, len(listed))
	for _, project := range listed {
		names = append(names, project.row.Name)
	}
	if names[len(names)-1] != oldest {
		t.Errorf("the pinned row was dropped by the recency cap: %v", names)
	}
	// And it displaced the oldest UNPINNED row rather than a newer one: the
	// order is still recency, with the pin only deciding membership.
	for index := 1; index < len(listed)-1; index++ {
		if listed[index-1].at.Before(listed[index].at) {
			t.Errorf("the served rows are not newest first: %v", names)
		}
	}
}

// pinnedFixtureSpec is the repository-metadata spec these scenarios map
// against: the account pin and nothing the mapping does not read.
func pinnedFixtureSpec() *codingProjectsFetchSpec {
	return &codingProjectsFetchSpec{Account: "fixture-owner"}
}

// TestARefusedPrivateEntryIsNeverNamedInALogLine is the other half of
// requirement 12 for the discovery document: the happy path above proves a
// private repository never reaches the wire, and this proves a private entry
// that makes the document REFUSE never reaches a log line either. Every
// drift a single entry can carry is applied to the private one, the round is
// run through the real producer with its logger captured, and the refusal is
// asserted to have been logged — so the search for the name is a search of a
// line that exists.
func TestARefusedPrivateEntryIsNeverNamedInALogLine(t *testing.T) {
	t.Parallel()
	const secret = "a-private-name-that-must-not-travel"
	one := []fixtureContributionDay{{at: windowDay(1), count: 1}}
	for name, entries := range map[string][]fixtureContributionRepo{
		"a negative count": {
			{id: "R_secret", name: secret, private: true, days: []fixtureContributionDay{{at: windowDay(1), count: -1}}},
		},
		// The instant IS the name: a parse error quotes its input, so a
		// wrapped one would carry the upstream's bytes into the log line.
		"an unparseable bucket instant": {
			{id: "R_secret", name: secret, private: true, days: []fixtureContributionDay{{at: secret, count: 1}}},
		},
		"a bucket outside the window": {
			{id: "R_secret", name: secret, private: true, days: []fixtureContributionDay{{at: windowDay(commitLogWindowDays + 3), count: 1}}},
		},
		"no node identity": {
			{id: "", name: secret, private: true, days: one},
		},
		"more dated buckets than the bound": {
			{id: "R_secret", name: secret, private: true, days: func() []fixtureContributionDay {
				days := make([]fixtureContributionDay, 0, maxContributionDays+1)
				for index := range maxContributionDays + 1 {
					days = append(days, fixtureContributionDay{at: windowDay(index % commitLogWindowDays), count: 1})
				}
				return days
			}()},
		},
		"the same name again under the same owner": {
			{id: "R_secret", name: secret, private: true, days: one},
			{id: "R_secret2", name: secret, private: true, days: one},
		},
		"a name outside the host's grammar": {
			{id: "R_secret", name: secret + " with a space", private: true, days: one},
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			var out bytes.Buffer
			doer := newCapturingDoer(map[string]cannedAnswer{
				"/graphql/contributions": {contentType: "application/json", body: contributionsAnswer(entries, nil)},
			})
			source, err := NewFetchSource(SnapshotSource{Name: "snapshots/vcs-activity.json"}, liveTestConfig(),
				panelFetchSpecs{vcs: activitySpecWithCommits()})
			if err != nil {
				t.Fatalf("build source: %v", err)
			}
			source.setLogger(slog.New(slog.NewJSONHandler(&out, &slog.HandlerOptions{Level: slog.LevelDebug})))
			rows, _, _, _, ok := source.commitSection(t.Context(), doer, func(string) string { return "fixture-token-value" },
				source.specs.vcs.Commits, commitRoundNow)
			if ok || len(rows) != 0 {
				t.Fatalf("a drifted discovery answer served %d rows, ok=%t; the refusal is the case", len(rows), ok)
			}
			if !strings.Contains(out.String(), "commit round failed") {
				t.Fatalf("the refusal was not logged, so nothing here was searched: %s", out.String())
			}
			if strings.Contains(out.String(), secret) {
				t.Errorf("a log line names the private repository: %s", out.String())
			}
		})
	}
}

// TestAForkBesideItsUpstreamIsTwoRepositories pins the repeat rule's key: a
// name is repeated only when it is repeated under ONE owner. The ordinary
// fork-and-pull workflow puts the same name under two owners in one window,
// and the host reports both; refusing that would serve the last good list for
// a month for no reason a reader could see. The owner's copy becomes a named
// row and the foreign one is counted and not listed, exactly as any foreign
// repository is.
func TestAForkBesideItsUpstreamIsTwoRepositories(t *testing.T) {
	t.Parallel()
	answer := contributionsAnswer([]fixtureContributionRepo{
		{id: "R_upstream", name: "shared-name", owner: "somebody-else", days: []fixtureContributionDay{{at: windowDay(1), count: 3}}},
		{id: "R_fork", name: "shared-name", owner: "fixture-owner", days: []fixtureContributionDay{{at: windowDay(2), count: 1}}},
	}, nil)
	_, repos, days, err := mapCommitContributions([]byte(answer), "fixture-owner", commitRoundNow)
	if err != nil {
		t.Fatalf("a fork beside its upstream was refused: %v", err)
	}
	if len(repos) != 1 || repos[0].id != "R_fork" || repos[0].name != "shared-name" {
		t.Fatalf("named rows = %+v, want the owner's copy alone", repos)
	}
	if len(days) != 0 {
		t.Errorf("public repositories produced private days: %+v", days)
	}
}

// TestTheRepositoryQueryRefusesAnotherAccountsAnswer covers the two refusals
// the credentialed repository document can raise about identity, and pins
// that neither names what it refuses: the credential's account is checked
// against the configured one before any row is stamped with it, and a row
// the answer calls private refuses the document without carrying the name
// into the error the refresh loop will log.
func TestTheRepositoryQueryRefusesAnotherAccountsAnswer(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	const stranger = "somebody-else"
	foreign := strings.Replace(repositoriesAnswer(queriedRepo{name: "alpha", description: `"x"`, stars: 1, pushedAt: "2026-09-10T10:00:00Z"}),
		`"login":"owner"`, `"login":"`+stranger+`"`, 1)
	if _, _, err := mapRepositoryQuery([]byte(foreign), projectsSpec(), now); err == nil {
		t.Fatal("another account's repositories were admitted under the configured account")
	} else if !strings.Contains(err.Error(), "configured account") {
		t.Fatalf("refusal = %v, want the account check named", err)
	} else if strings.Contains(err.Error(), stranger) {
		t.Errorf("the refusal repeats the stranger's login: %v", err)
	}
	const secret = "a-private-name-that-must-not-travel"
	hidden := repositoriesAnswer(
		queriedRepo{name: "alpha", description: `"x"`, stars: 1, pushedAt: "2026-09-10T10:00:00Z"},
		queriedRepo{name: secret, private: true, description: `"x"`, stars: 1, pushedAt: "2026-09-10T10:00:00Z"},
	)
	if _, _, err := mapRepositoryQuery([]byte(hidden), projectsSpec(), now); err == nil {
		t.Fatal("a private row in the credentialed answer was admitted")
	} else if !strings.Contains(err.Error(), "private") {
		t.Fatalf("refusal = %v, want the privacy claim named", err)
	} else if strings.Contains(err.Error(), secret) {
		t.Errorf("the refusal names the private repository: %v", err)
	}
}
