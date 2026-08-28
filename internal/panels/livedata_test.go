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
		Endpoint:    "https://api.example.test/graphql",
		Query:       "query($from: DateTime!, $to: DateTime!) { calendar }",
		KeyEnvName:  "FIXTURE_CALENDAR_TOKEN",
		KeyHeader:   "Authorization",
		KeyPrefix:   "Bearer ",
		Headers:     map[string]string{"Accept": "application/json", "Content-Type": "application/json"},
		MaxBytes:    1 << 17,
		ContentType: "application/json",
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

// projectsSpec is the repository-metadata fixture spec: two repositories, the
// optional credential named, mirroring the shipped configuration's shape.
func projectsSpec() *codingProjectsFetchSpec {
	return &codingProjectsFetchSpec{
		Sources: []codingProjectSourceSpec{
			{Name: "alpha", Endpoint: "https://api.example.test/repos/owner/alpha"},
			{Name: "beta", Endpoint: "https://api.example.test/repos/owner/beta"},
		},
		Headers:            map[string]string{"Accept": "application/json"},
		KeyEnvName:         "FIXTURE_PROJECTS_TOKEN",
		KeyHeader:          "Authorization",
		KeyPrefix:          "Bearer ",
		MaxBytes:           1 << 17,
		ContentType:        "application/json",
		MinIntervalMinutes: 15,
	}
}

// repositoryAnswer is a realistic upstream document: the three fields the
// panel reads, surrounded by the many it deliberately does not — including the
// owner profile the projection exists to avoid holding.
func repositoryAnswer(description string, stars int, pushedAt string) string {
	return fmt.Sprintf(`{"id":1,"name":"ignored-by-design","full_name":"owner/ignored",`+
		`"owner":{"login":"owner","id":2,"type":"User"},"private":false,`+
		`"description":%s,"fork":false,"created_at":"2020-01-01T00:00:00Z",`+
		`"pushed_at":%q,"stargazers_count":%d,"watchers_count":%d,"forks_count":0,`+
		`"open_issues_count":0,"default_branch":"main"}`,
		description, pushedAt, stars, stars)
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

// TestCodingProjectsServeWhatTheHostSaysNow is the commission: the owner edits
// a description on the host and the site follows on the next refresh, rather
// than serving a capture frozen at build time.
func TestCodingProjectsServeWhatTheHostSaysNow(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/repos/owner/alpha": {contentType: "application/json", body: repositoryAnswer(`"a description the owner just changed"`, 7, "2026-08-27T10:00:00Z")},
		"/repos/owner/beta":  {contentType: "application/json", body: repositoryAnswer(`null`, 0, "2026-08-26T10:00:00Z")},
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
		t.Errorf("status = %q, want ok when every repository answered", loaded.status)
	}
	payload := decodeProjects(t, loaded)
	if len(payload.Repos) != 2 {
		t.Fatalf("served %d rows, want 2", len(payload.Repos))
	}
	if payload.Repos[0].Name != "alpha" || payload.Repos[1].Name != "beta" {
		t.Errorf("rows = %q/%q, want config order alpha then beta", payload.Repos[0].Name, payload.Repos[1].Name)
	}
	if payload.Repos[0].Description != "a description the owner just changed" {
		t.Errorf("description = %q, want the host's current text", payload.Repos[0].Description)
	}
	if payload.Repos[0].Stars == nil || *payload.Repos[0].Stars != 7 {
		t.Errorf("stars = %v, want 7", payload.Repos[0].Stars)
	}
	if payload.Repos[0].Recorded {
		t.Error("a live row is marked recorded")
	}
	// A repository with no description has none; the row serves an empty
	// string rather than borrowed or invented copy.
	if payload.Repos[1].Description != "" {
		t.Errorf("a repository with no description served %q", payload.Repos[1].Description)
	}
	// A genuinely reported zero stays zero — that is what the nullable tally
	// makes expressible in the first place.
	if payload.Repos[1].Stars == nil || *payload.Repos[1].Stars != 0 {
		t.Errorf("a reported zero tally served %v, want 0", payload.Repos[1].Stars)
	}
	for _, request := range doer.at("/repos/owner/alpha") {
		if got := request.header.Get("Authorization"); got != "Bearer fixture-token-value" {
			t.Errorf("Authorization header = %q, want the prefixed credential", got)
		}
		if request.method != http.MethodGet {
			t.Errorf("method = %s, want GET: reading a repository is a read", request.method)
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
		"/repos/owner/alpha": {contentType: "application/json", body: repositoryAnswer(`"alpha"`, 1, "2026-08-27T10:00:00Z")},
		"/repos/owner/beta":  {contentType: "application/json", body: repositoryAnswer(`"beta"`, 2, "2026-08-26T10:00:00Z")},
	})
	loaded, err := projectsSource(t).refreshProjects(t.Context(), doer, func(string) string { return "" }, now)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if loaded.status != StatusOK {
		t.Errorf("status = %q, want ok: the credential is headroom, not access", loaded.status)
	}
	for _, request := range doer.at("/repos/owner/alpha") {
		if got := request.header.Get("Authorization"); got != "" {
			t.Errorf("an unset credential still sent an Authorization header %q", got)
		}
	}
}

// TestOneUnreadableRepositoryDegradesOnlyItsOwnRow pins the per-row
// degradation: a bad minute at one endpoint must not blank the five
// repositories that answered, and the row that fell back must say so.
func TestOneUnreadableRepositoryDegradesOnlyItsOwnRow(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/repos/owner/alpha": {contentType: "application/json", body: repositoryAnswer(`"alpha lives"`, 4, "2026-08-27T10:00:00Z")},
		"/repos/owner/beta":  {status: http.StatusInternalServerError, contentType: "application/json", body: "{}"},
	})
	loaded, err := projectsSource(t).refreshProjects(t.Context(), doer, func(string) string { return "" }, now)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if loaded.status != StatusStale {
		t.Errorf("status = %q, want stale while one row is recorded", loaded.status)
	}
	payload := decodeProjects(t, loaded)
	if payload.Repos[0].Recorded {
		t.Error("the row that answered is marked recorded")
	}
	if !payload.Repos[1].Recorded {
		t.Error("the row that fell back to the snapshot does not say so")
	}
	if payload.Repos[0].Description != "alpha lives" {
		t.Errorf("the live row lost its data: %q", payload.Repos[0].Description)
	}
}

// TestARoundThatReadsNothingKeepsTheServedPayload pins the other direction: a
// total outage must not replace live rows with recorded ones, because the
// caller's last-good payload is the better answer.
func TestARoundThatReadsNothingKeepsTheServedPayload(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/repos/owner/alpha": {status: http.StatusBadGateway, contentType: "application/json", body: "{}"},
		"/repos/owner/beta":  {status: http.StatusBadGateway, contentType: "application/json", body: "{}"},
	})
	if _, err := projectsSource(t).refreshProjects(t.Context(), doer, func(string) string { return "" }, now); err == nil {
		t.Fatal("a round that read nothing reported a successful refresh")
	}
}

// TestTheRepositoryDocumentFailsClosed drives the value gate that replaced the
// decoder gate. Every case parses as JSON and would produce a plausible row if
// its check were removed.
func TestTheRepositoryDocumentFailsClosed(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	for _, testCase := range []struct {
		name string
		body string
		want string
	}{
		{"an unrelated JSON object", `{"unrelated":true}`, "push instant"},
		{"an unparseable instant", repositoryAnswer(`"x"`, 1, "yesterday"), "push instant"},
		{"an instant from the future", repositoryAnswer(`"x"`, 1, "2027-01-01T00:00:00Z"), "plausible window"},
		{"a negative tally", repositoryAnswer(`"x"`, -1, "2026-08-27T10:00:00Z"), "star tally"},
		{"a description carrying control characters", `{"description":"a\u0007b","stargazers_count":1,"pushed_at":"2026-08-27T10:00:00Z"}`, "control characters"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if _, err := mapRepository([]byte(testCase.body), "alpha", now); err == nil {
				t.Fatal("a hostile or drifted document produced a row")
			} else if !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("refusal = %v, want it to name %q", err, testCase.want)
			}
		})
	}
}

// TestARepositoryNameIsNeverTheDocumentsToChoose pins the rule VCSCommit.Repo
// already follows: an upstream that could name the repository could put a
// stranger's project on the owner's page.
func TestARepositoryNameIsNeverTheDocumentsToChoose(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	row, err := mapRepository([]byte(repositoryAnswer(`"x"`, 1, "2026-08-27T10:00:00Z")), "the-configured-name", now)
	if err != nil {
		t.Fatalf("map: %v", err)
	}
	if row.Name != "the-configured-name" {
		t.Errorf("name = %q, want the configured one; the document said something else", row.Name)
	}
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

// TestTheCodingProjectsSpecFailsClosed pins the construction gate.
func TestTheCodingProjectsSpecFailsClosed(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name string
		edit func(*codingProjectsFetchSpec)
		want string
	}{
		{"no sources", func(s *codingProjectsFetchSpec) { s.Sources = nil }, "no sources"},
		{"a source with no name", func(s *codingProjectsFetchSpec) { s.Sources[0].Name = "" }, "needs a name"},
		{"the same repository twice", func(s *codingProjectsFetchSpec) { s.Sources[1].Name = s.Sources[0].Name }, "listed twice"},
		{"a credential with nowhere to ride", func(s *codingProjectsFetchSpec) { s.KeyHeader = "" }, "declared together"},
		{"a header outside the public-producer list", func(s *codingProjectsFetchSpec) {
			s.Headers = map[string]string{"Authorization": "Bearer smuggled"}
		}, "not permitted"},
		{"an off-allowlist endpoint", func(s *codingProjectsFetchSpec) {
			s.Sources[0].Endpoint = "https://exfiltrate.example.test/repos/owner/alpha"
		}, "allowlist"},
		{"a cadence outside the reviewed band", func(s *codingProjectsFetchSpec) { s.MinIntervalMinutes = 100000 }, "reviewed"},
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
		}
		for _, testCase := range []struct {
			name    string
			body    string
			refused bool
		}{
			{"an explicit null figure", `{"peak-day":null,"current-streak":1,"longest-streak":2}`, true},
			{"a measured zero", `{"peak-day":0,"current-streak":0,"longest-streak":0}`, false},
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
// the repository producer's own bounds — the source ceiling and the declared
// answer type, neither of which any other spec's checks would catch.
func TestTheCodingProjectsSpecIsAdmittedAgainstTheSharedBounds(t *testing.T) {
	t.Parallel()
	t.Run("more repositories than the round may cost", func(t *testing.T) {
		t.Parallel()
		spec := projectsSpec()
		spec.Sources = make([]codingProjectSourceSpec, 0, maxCodingProjectSources+1)
		for index := range maxCodingProjectSources + 1 {
			spec.Sources = append(spec.Sources, codingProjectSourceSpec{
				Name:     fmt.Sprintf("repo-%d", index),
				Endpoint: fmt.Sprintf("https://api.example.test/repos/owner/repo-%d", index),
			})
		}
		if err := validateCodingProjectsSpec(spec); err == nil {
			t.Fatal("a source list over the bound was admitted")
		} else if !strings.Contains(err.Error(), "over the") {
			t.Fatalf("refusal = %v, want the bound named", err)
		}
	})
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
	if _, err := mapRepository(document, "alpha", now); err == nil {
		t.Fatal("a description that is not valid UTF-8 produced a row")
	} else if !strings.Contains(err.Error(), "UTF-8") && !strings.Contains(err.Error(), "invalid character") {
		t.Fatalf("refusal = %v, want the encoding named", err)
	}
	// And the same fault reaching mapRepository through a well-formed JSON
	// string still refuses the row rather than the byte.
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
		"/repos/owner/alpha": {contentType: "application/json", body: repositoryAnswer(`"alpha"`, 1, "2026-08-27T10:00:00Z")},
		"/repos/owner/beta":  {contentType: "application/json", body: repositoryAnswer(`"beta"`, 2, "2026-08-26T10:00:00Z")},
	})
	source := projectsSource(t)
	if _, err := source.refreshProjects(t.Context(), doer, func(string) string { return "" }, now); err != nil {
		t.Fatalf("first round: %v", err)
	}
	before := len(doer.at("/repos/owner/alpha"))
	_, err := source.refreshProjects(t.Context(), doer, func(string) string { return "" }, now.Add(time.Minute))
	if !errors.Is(err, errNothingDue) {
		t.Fatalf("a round inside the budget reported %v, want errNothingDue", err)
	}
	if after := len(doer.at("/repos/owner/alpha")); after != before {
		t.Errorf("a budgeted round still made %d requests", after-before)
	}
}

// TestARepositoryDocumentThatDoesNotMapDegradesItsOwnRow separates the two
// per-row failure modes: a transport or status failure, and a document that
// arrived intact and did not survive admission. Both must degrade one row
// rather than the round, and the second is the one a status-only test misses.
func TestARepositoryDocumentThatDoesNotMapDegradesItsOwnRow(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	doer := newCapturingDoer(map[string]cannedAnswer{
		"/repos/owner/alpha": {contentType: "application/json", body: repositoryAnswer(`"alpha lives"`, 4, "2026-08-27T10:00:00Z")},
		// A 200 carrying a perfectly valid JSON document that is not a
		// repository: the projection reads zero values and the value gate
		// refuses them.
		"/repos/owner/beta": {contentType: "application/json", body: `{"unrelated":true}`},
	})
	loaded, err := projectsSource(t).refreshProjects(t.Context(), doer, func(string) string { return "" }, now)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if loaded.status != StatusStale {
		t.Errorf("status = %q, want stale while one row is recorded", loaded.status)
	}
	payload := decodeProjects(t, loaded)
	if !payload.Repos[1].Recorded {
		t.Error("a row whose document failed admission does not say it fell back")
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
