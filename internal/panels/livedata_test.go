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
		body, err := calendarRequestBody("query($from: DateTime!, $to: DateTime!) { calendar }", now)
		if err != nil {
			t.Fatalf("build request body: %v", err)
		}
		var request calendarQueryRequest
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
			spec := state.fetch.specs.vcs.Commits
			spec.KeyEnvName = "FIXTURE_COMMITS_TOKEN"
			spec.KeyHeader = "Authorization"
			spec.KeyPrefix = "Bearer "
			spec.AuthenticatedMinIntervalMinutes = 1
			return state.fetch
		}

		authDoer := newCapturingDoer(activityAnswers(t))
		authSource := configure(t)
		for _, at := range []time.Time{now, now.Add(time.Minute)} {
			if _, _, attempted, fresh := authSource.commitSection(t.Context(), authDoer, credential, authSource.specs.vcs.Commits, at); !attempted || !fresh {
				t.Fatalf("credentialed commit refresh at %v = attempted %t fresh %t", at, attempted, fresh)
			}
		}
		if requests := authDoer.at("/repos/first/commits"); len(requests) != 2 {
			t.Fatalf("credentialed one-minute wakes made %d requests, want 2", len(requests))
		} else if got := requests[1].header.Get("Authorization"); got != "Bearer fixture-token-value" {
			t.Errorf("credentialed request header = %q", got)
		}

		publicDoer := newCapturingDoer(activityAnswers(t))
		publicSource := configure(t)
		if _, _, attempted, _ := publicSource.commitSection(t.Context(), publicDoer, anonymous, publicSource.specs.vcs.Commits, now); !attempted {
			t.Fatal("public first refresh attempted nothing")
		}
		if _, _, attempted, _ := publicSource.commitSection(t.Context(), publicDoer, anonymous, publicSource.specs.vcs.Commits, now.Add(time.Minute)); attempted {
			t.Fatal("public one-minute wake spent an anonymous request")
		}
		if got := len(publicDoer.at("/repos/first/commits")); got != 1 {
			t.Errorf("public one-minute wakes made %d requests, want 1", got)
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
 * coding-projects/v1
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

// searchAnswer is a realistic account-wide open-pull search answer: one item
// per name given (repeat a name for several matches), each carrying the
// account profiles the projection must never hold beside the one address it
// reads. The total is the honest item count unless overridden by a test that
// drives the truncation refusal.
func searchAnswer(account string, names ...string) string {
	items := make([]string, 0, len(names))
	for _, name := range names {
		items = append(items, fmt.Sprintf(`{"id":9,"number":1,"title":"a pull request",`+
			`"user":{"login":"somebody","id":3,"type":"User"},"state":"open",`+
			`"repository_url":"https://api.example.test/repos/%s/%s"}`, account, name))
	}
	return fmt.Sprintf(`{"total_count":%d,"incomplete_results":false,"items":[%s]}`,
		len(names), strings.Join(items, ","))
}

// projectsSpecWithTallies is projectsSpec with the optional search document
// named, which is the shipped configuration's shape.
func projectsSpecWithTallies() *codingProjectsFetchSpec {
	spec := projectsSpec()
	spec.PullsEndpoint = "https://api.example.test/search/issues?q=owner-pulls"
	return spec
}

// tallyingProjectsSource is projectsSource over that spec.
func tallyingProjectsSource(t *testing.T) *FetchSource {
	t.Helper()
	source, err := NewFetchSource(SnapshotSource{Name: "snapshots/coding-projects.json"}, liveTestConfig(),
		panelFetchSpecs{projects: projectsSpecWithTallies()})
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
			if _, err := admitListedRepository(entry, now); err == nil {
				t.Fatal("a hostile or drifted row produced a served row")
			} else if !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("refusal = %v, want it to name %q", err, testCase.want)
			}
		})
	}
}

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

// TestOpenWorkIsSplitOutOfTheCombinedTally is the arithmetic the two figures
// rest on (issue 252): the listing's open tally counts pull requests as
// issues, so the issue figure is that tally MINUS the separately read
// pull-request one. Getting this backwards, or skipping the subtraction,
// publishes a wrong number that looks entirely plausible.
func TestOpenWorkIsSplitOutOfTheCombinedTally(t *testing.T) {
	t.Parallel()
	pulls := int64(2)
	issues, split := splitOpenWork(5, &pulls)
	if issues == nil || *issues != 3 {
		t.Errorf("open issues = %v, want 3: five open things of which two are pull requests", issues)
	}
	if split == nil || *split != 2 {
		t.Errorf("open pull requests = %v, want the tally as read", split)
	}
	// A genuine zero is a figure, not an absence: a repository with nothing
	// open reports nothing open, and the card is entitled to say so.
	none := int64(0)
	quietIssues, quietPulls := splitOpenWork(0, &none)
	if quietIssues == nil || *quietIssues != 0 || quietPulls == nil || *quietPulls != 0 {
		t.Errorf("a quiet repository served %v/%v, want a reported zero on both", quietIssues, quietPulls)
	}
}

// TestAnUnsplittableTallyServesNeitherFigure pins the refusal. Every case here
// would produce a confident, wrong, entirely renderable number if the guard
// were dropped — most dangerously the racing one, where a pull request opened
// between the two reads makes the subtraction go negative.
func TestAnUnsplittableTallyServesNeitherFigure(t *testing.T) {
	t.Parallel()
	overBound := int64(maxCountValue + 1)
	negative := int64(-1)
	two := int64(2)
	for _, testCase := range []struct {
		name     string
		combined int64
		pulls    *int64
	}{
		{"no tally was read at all", 4, nil},
		{"more pull requests than open things, the read-skew race", 1, &two},
		{"a negative tally", 4, &negative},
		{"a tally past the bound", 4, &overBound},
		{"a combined figure past the bound", maxCountValue + 1, &two},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			issues, pulls := splitOpenWork(testCase.combined, testCase.pulls)
			if issues != nil || pulls != nil {
				t.Fatalf("served %v/%v, want a dash on both: half a derived pair is a wrong number, not a smaller truth", issues, pulls)
			}
		})
	}
}

// TestThePullRequestTallyDocumentFailsClosed drives the search projection's
// value gate. The missing-total case is the one that matters most: an
// unrelated JSON object projects to no count at all, and reading that as zero
// would put "nothing open" on a card that knows nothing. The truncation and
// attribution refusals are new with the account-wide document (issue 281):
// a partial map is an undercount wearing a confident number, and an item
// pointing outside the account is a stranger's pull request on the owner's
// card.
func TestThePullRequestTallyDocumentFailsClosed(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name string
		body string
		want string
	}{
		{"an unrelated JSON object", `{"unrelated":true}`, "no total"},
		{"a document that is not JSON at all", `<html>`, "pull-request tally"},
		{"a negative count", `{"total_count":-1}`, "admissible range"},
		{"a count past the bound", fmt.Sprintf(`{"total_count":%d,"incomplete_results":false,"items":[]}`, int64(maxCountValue)+1), "admissible range"},
		{"an admitted-incomplete search", `{"total_count":0,"incomplete_results":true,"items":[]}`, "incomplete"},
		{"a truncated page", `{"total_count":5,"incomplete_results":false,"items":[{"repository_url":"https://api.example.test/repos/owner/alpha"}]}`, "undercount"},
		{"an item outside the account", `{"total_count":1,"incomplete_results":false,"items":[{"repository_url":"https://api.example.test/repos/somebody-else/theirs"}]}`, "outside the configured account"},
		{"an item with no repository address", `{"total_count":1,"incomplete_results":false,"items":[{"repository_url":""}]}`, "no repository address"},
		{"an item with an ungrammatical name", `{"total_count":1,"incomplete_results":false,"items":[{"repository_url":"https://api.example.test/repos/owner/bad name"}]}`, "outside the configured account"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if _, err := mapOpenPullsByRepo([]byte(testCase.body), "owner"); err == nil {
				t.Fatal("a hostile or drifted tally document produced a count")
			} else if !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("refusal = %v, want it to name %q", err, testCase.want)
			}
		})
	}
	// The gate must admit real data too: an account with nothing open is a
	// zero on every row, and two matches on one repository count as two.
	counted, err := mapOpenPullsByRepo([]byte(searchAnswer("owner")), "owner")
	if err != nil || len(counted) != 0 {
		t.Fatalf("a reported zero was refused: %v, %v", counted, err)
	}
	counted, err = mapOpenPullsByRepo([]byte(searchAnswer("owner", "alpha", "alpha", "beta")), "owner")
	if err != nil {
		t.Fatalf("an honest answer was refused: %v", err)
	}
	if counted["alpha"] != 2 || counted["beta"] != 1 {
		t.Fatalf("attribution = %v, want alpha:2 beta:1", counted)
	}
}

// TestTheServedRowsCarryBothOpenTallies is the end-to-end claim: the listing
// and ONE account-wide search document go in, every row comes out carrying
// both figures — including the true zero on a repository the search names no
// match for — and the credential rides the tally request exactly as it rides
// the listing one.
func TestTheServedRowsCarryBothOpenTallies(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/users/owner/repos": {contentType: "application/json", body: listingAnswer(
			listedRepo{name: "alpha", description: `"alpha"`, stars: 1, pushedAt: "2026-08-29T10:00:00Z", open: 9},
			listedRepo{name: "beta", description: `"beta"`, stars: 1, pushedAt: "2026-08-28T10:00:00Z", open: 0},
		)},
		"/search/issues": {contentType: "application/json", body: searchAnswer("owner", "alpha", "alpha", "alpha", "alpha")},
	})
	loaded, err := tallyingProjectsSource(t).refreshProjects(t.Context(), doer, func(name string) string {
		if name == "FIXTURE_PROJECTS_TOKEN" {
			return "fixture-token-value"
		}
		return ""
	}, now)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	payload := decodeProjects(t, loaded)
	if payload.Repos[0].OpenIssues == nil || *payload.Repos[0].OpenIssues != 5 {
		t.Errorf("open issues = %v, want 5: nine open things of which four are pull requests", payload.Repos[0].OpenIssues)
	}
	if payload.Repos[0].OpenPulls == nil || *payload.Repos[0].OpenPulls != 4 {
		t.Errorf("open pull requests = %v, want 4", payload.Repos[0].OpenPulls)
	}
	// The search vouches for the whole account, so a repository it names no
	// match for carries a REPORTED zero, not a dash.
	if payload.Repos[1].OpenIssues == nil || *payload.Repos[1].OpenIssues != 0 || payload.Repos[1].OpenPulls == nil || *payload.Repos[1].OpenPulls != 0 {
		t.Errorf("the quiet repository served %v/%v, want a reported zero on both", payload.Repos[1].OpenIssues, payload.Repos[1].OpenPulls)
	}
	tallies := doer.at("/search/issues")
	if len(tallies) != 1 {
		t.Fatalf("%d tally requests, want exactly one for the whole account", len(tallies))
	}
	for _, request := range tallies {
		if got := request.header.Get("Authorization"); got != "Bearer fixture-token-value" {
			t.Errorf("tally Authorization header = %q, want the same prefixed credential the listing read carries", got)
		}
		if request.method != http.MethodGet {
			t.Errorf("tally method = %s, want GET: counting is a read", request.method)
		}
	}
	// The whole round is TWO requests — the arithmetic behind the rate-budget
	// pin in fetch_test, executed on the wire.
	if total := len(doer.at("/users/owner/repos")) + len(tallies); total != 2 {
		t.Errorf("the round made %d requests, want 2", total)
	}
}

// TestAFailedTallyCostsTheTalliesAndNothingElse pins the failure granularity
// the second request was designed around. Falling the rows back — or marking
// the envelope stale — because a count went missing would tell the reader a
// perfectly current description is not, a worse lie than the dash it
// replaces. Both failure shapes are driven: the transport failing, and a
// document arriving intact that does not survive admission.
func TestAFailedTallyCostsTheTalliesAndNothingElse(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	for name, answer := range map[string]cannedAnswer{
		"a tally outage":              {status: http.StatusInternalServerError, contentType: "application/json", body: "{}"},
		"a tally that fails the gate": {contentType: "application/json", body: `{"total_count":5,"incomplete_results":false,"items":[]}`},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			doer := newCapturingDoer(map[string]cannedAnswer{
				"/users/owner/repos": {contentType: "application/json", body: listingAnswer(
					listedRepo{name: "alpha", description: `"alpha lives"`, stars: 1, pushedAt: "2026-08-29T10:00:00Z", open: 9},
				)},
				"/search/issues": answer,
			})
			loaded, err := tallyingProjectsSource(t).refreshProjects(t.Context(), doer, func(string) string { return "" }, now)
			if err != nil {
				t.Fatalf("refresh: %v", err)
			}
			if loaded.status != StatusOK {
				t.Errorf("status = %q, want ok: every repository answered; only an optional count did not", loaded.status)
			}
			payload := decodeProjects(t, loaded)
			if payload.Repos[0].Recorded {
				t.Error("a lost count fell the whole row back")
			}
			if payload.Repos[0].Description != "alpha lives" {
				t.Errorf("description = %q, want the live text", payload.Repos[0].Description)
			}
			if payload.Repos[0].OpenIssues != nil || payload.Repos[0].OpenPulls != nil {
				t.Errorf("served %v/%v, want a dash on both", payload.Repos[0].OpenIssues, payload.Repos[0].OpenPulls)
			}
			// The additive rule, proven on the wire rather than asserted: a
			// payload with no tallies must carry no tally KEYS, so a consumer
			// written before they existed sees the document it always saw.
			if bytes.Contains(loaded.data, []byte("openIssues")) || bytes.Contains(loaded.data, []byte("openPulls")) {
				t.Errorf("an absent tally was serialized as a key: %s", loaded.data)
			}
		})
	}
}

// TestTheTallyEndpointIsHostCheckedToo pins that "optional" describes whether
// the document is CONFIGURED, never whether its URL is admitted. A second
// reachable URL that skipped the allowlist would be a hole in the one rule
// every outbound request passes — and the listing endpoint passes it too.
func TestTheTallyEndpointIsHostCheckedToo(t *testing.T) {
	t.Parallel()
	for name, edit := range map[string]func(*codingProjectsFetchSpec){
		"the tally document": func(s *codingProjectsFetchSpec) { s.PullsEndpoint = "https://elsewhere.example.net/search/issues" },
		"the listing itself": func(s *codingProjectsFetchSpec) {
			s.ListingEndpoint = "https://elsewhere.example.net/users/owner/repos"
		},
		"a plain-http listing": func(s *codingProjectsFetchSpec) {
			s.ListingEndpoint = "http://api.example.test/users/owner/repos"
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			spec := projectsSpecWithTallies()
			edit(spec)
			_, err := NewFetchSource(SnapshotSource{Name: "snapshots/coding-projects.json"}, liveTestConfig(),
				panelFetchSpecs{projects: spec})
			if err == nil {
				t.Fatal("an off-allowlist endpoint built a source")
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
		_, err = admitListedRepository(entry, now)
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
		{
			name:   "commits",
			public: 10 * time.Minute,
			paths:  []string{"/repos/first/commits"},
			build: func(t *testing.T) (*FetchSource, *capturingDoer) {
				t.Helper()
				_, state := activityFetchRegistry(t, 10)
				spec := state.fetch.specs.vcs.Commits
				spec.KeyEnvName = "FIXTURE_COMMITS_TOKEN"
				spec.KeyHeader = "Authorization"
				spec.KeyPrefix = "Bearer "
				spec.AuthenticatedMinIntervalMinutes = 1
				return state.fetch, newCapturingDoer(activityAnswers(t))
			},
			wake: func(t *testing.T, source *FetchSource, doer *capturingDoer, env func(string) string, at time.Time) bool {
				t.Helper()
				_, _, attempted, _ := source.commitSection(t.Context(), doer, env, source.specs.vcs.Commits, at)
				return attempted
			},
		},
	}
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
