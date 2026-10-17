package panels

// calendar_commits_test pins the "Commits Pushed" half of the credentialed
// calendar (owner direction, 2026-10-16): the commits pushed each day, in the
// calendar's own week columns, read in the calendar's own request over four
// sub-windows that split its window at seams derived from the same clock
// reading. Every case is built over the calendar fixture the rest of the
// calendar suite uses, so the window under test is the one the calendar
// admission already proves.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"
)

// commitsNow is the fixed clock every case maps under; the calendar fixture
// starts on the Sunday the producer would ask for at this instant.
var commitsNow = time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)

// commitsWindow returns the fixture calendar's first day and its day count.
func commitsWindow() (time.Time, int) {
	start := firstSunday(commitsNow.AddDate(0, 0, -calendarWindowDays))
	return start, int(commitsNow.Sub(start)/(24*time.Hour)) + 1
}

// The seam days' offsets from the window's first day, written out rather than
// derived from the code under test, so the fixtures describe the split
// independently of what computes it.
const (
	seamOne   = 91
	seamTwo   = 182
	seamThree = 273
)

// localMidnight is how the upstream reports a commit bucket: the account's
// local midnight as a UTC instant — here a zone seven hours west of UTC.
func localMidnight(day time.Time) string {
	return day.Add(7 * time.Hour).UTC().Format(time.RFC3339)
}

// pushed is one repository-day the account actually pushed: the day's offset
// from the window's first day, its commits, and — for an upstream that splits
// a seam day at the seam instant — how many of them fell before it.
type pushed struct {
	offset, count, early int
}

// The commit half as fixtures: plain values a case can bend before encoding.
type (
	commitNodeFixture struct {
		at    string
		count int
	}
	// commitEntryFixture is one repository in one sub-window: its commit
	// count there (the upstream's totalCount), whether the page says more
	// follow, and its buckets.
	commitEntryFixture struct {
		totalCount int
		next       bool
		nodes      []commitNodeFixture
	}
	commitWindowFixture struct {
		total   int
		entries []commitEntryFixture
	}
	commitHalfFixture struct {
		whole   int
		windows [calendarCommitWindows]commitWindowFixture
	}
)

// commitHalf answers the commit half over the fixture window.
func commitHalf(splitting bool, repositories ...[]pushed) commitHalfFixture {
	start, days := commitsWindow()
	return commitHalfOver(start, days, splitting, repositories...)
}

// commitHalfOver answers the commit half the way the upstream would for what
// the account pushed. A whole-day upstream reports a repository's day to every
// sub-window whose days include it — a seam day to both of its neighbours; a
// splitting one reports a seam day's commits before the seam to the earlier
// sub-window and the rest to the later, each part only when it is non-zero.
// Either way a repository's totalCount is its commits in the sub-window, every
// sub-window's total counts everything it reports, and the whole window's
// total counts every day once — the day before the window included, which the
// first sub-window reports and counts too.
func commitHalfOver(start time.Time, days int, splitting bool, repositories ...[]pushed) commitHalfFixture {
	bounds := [calendarCommitWindows + 1]int{-1, seamOne, seamTwo, seamThree, days - 1}
	var half commitHalfFixture
	for _, repository := range repositories {
		var entries [calendarCommitWindows]commitEntryFixture
		for _, day := range repository {
			half.whole += day.count
			for window := range calendarCommitWindows {
				low, high := bounds[window], bounds[window+1]
				if day.offset < low || day.offset > high {
					continue
				}
				count := day.count
				switch {
				case splitting && window+1 < calendarCommitWindows && day.offset == high:
					count = day.early
				case splitting && window > 0 && day.offset == low:
					count = day.count - day.early
				}
				if count == 0 {
					continue
				}
				entries[window].nodes = append(entries[window].nodes, commitNodeFixture{at: localMidnight(start.AddDate(0, 0, day.offset)), count: count})
				entries[window].totalCount += count
				half.windows[window].total += count
			}
		}
		for window, entry := range entries {
			if len(entry.nodes) > 0 {
				half.windows[window].entries = append(half.windows[window].entries, entry)
			}
		}
	}
	return half
}

// on adds the commit half to a calendar answer, under the aliases and field
// names the shipped query asks for.
func (half commitHalfFixture) on(t *testing.T, body string) []byte {
	t.Helper()
	var document map[string]any
	if err := json.Unmarshal([]byte(body), &document); err != nil {
		t.Fatalf("decode calendar fixture: %v", err)
	}
	viewer := document["data"].(map[string]any)["viewer"].(map[string]any)
	viewer["contributionsCollection"].(map[string]any)["totalCommitContributions"] = half.whole
	for window, fixture := range half.windows {
		entries := make([]any, 0, len(fixture.entries))
		for _, entry := range fixture.entries {
			nodes := make([]any, 0, len(entry.nodes))
			for _, node := range entry.nodes {
				nodes = append(nodes, map[string]any{"at": node.at, "count": node.count})
			}
			entries = append(entries, map[string]any{"contributions": map[string]any{
				"totalCount": entry.totalCount,
				"pageInfo":   map[string]any{"hasNextPage": entry.next},
				"nodes":      nodes,
			}})
		}
		viewer[fmt.Sprintf("commits%d", window+1)] = map[string]any{
			"totalCommitContributions":        fixture.total,
			"commitContributionsByRepository": entries,
		}
	}
	encoded, err := json.Marshal(document)
	if err != nil {
		t.Fatalf("encode calendar fixture: %v", err)
	}
	return encoded
}

// mapCommitsFixture maps one answer and decodes the served payload.
func mapCommitsFixture(t *testing.T, raw []byte) (VCSActivityData, string) {
	t.Helper()
	mapped, omitted, err := mapCalendarDocument(raw, commitsNow)
	if err != nil {
		t.Fatalf("mapCalendarDocument: %v", err)
	}
	var payload VCSActivityData
	if err := decodeStrict(mapped, &payload); err != nil {
		t.Fatalf("decode served payload: %v", err)
	}
	return payload, omitted
}

// commitDay reads one day's served commits by its offset from the first day.
func commitDay(payload VCSActivityData, offset int) int {
	return payload.CommitWeeks[offset/daysPerWeek][offset%daysPerWeek]
}

func intPointer(value int) *int { return &value }

// TestTheCalendarCarriesTheCommitsPushedEachDay is the feature: every bucket,
// public and private alike, in every sub-window, lands on the calendar day it
// belongs to, in the calendar's own week columns, and the total is exactly
// their sum.
func TestTheCalendarCarriesTheCommitsPushedEachDay(t *testing.T) {
	t.Parallel()
	start, days := commitsWindow()
	raw := commitHalf(false,
		[]pushed{{offset: 0, count: 2}, {offset: 10, count: 1}, {offset: 120, count: 1}, {offset: 200, count: 1}, {offset: days - 1, count: 3}},
		// A second repository — private or public, the answer cannot say and
		// the payload does not care: it is counted into its days either way.
		[]pushed{{offset: 10, count: 2}, {offset: 300, count: 1}},
	).on(t, calendarAnswer(start, days, 3, nil))
	payload, omitted := mapCommitsFixture(t, raw)
	if omitted != "" {
		t.Fatalf("the commit days were omitted (%s)", omitted)
	}
	if len(payload.CommitWeeks) != len(payload.Weeks) {
		t.Fatalf("%d commit week columns beside %d calendar columns", len(payload.CommitWeeks), len(payload.Weeks))
	}
	want := map[int]int{0: 2, 10: 3, 120: 1, 200: 1, 300: 1, days - 1: 3}
	sum := 0
	for week, column := range payload.CommitWeeks {
		if len(column) != daysPerWeek {
			t.Fatalf("commit week %d has %d days", week, len(column))
		}
		for day, count := range column {
			offset := week*daysPerWeek + day
			if count != want[offset] {
				t.Errorf("day %d carries %d commits, want %d", offset, count, want[offset])
			}
			if offset >= days && count != 0 {
				t.Errorf("padding day %d after endDate carries %d commits", offset, count)
			}
			sum += count
		}
	}
	if payload.TotalCommits == nil || *payload.TotalCommits != 11 || sum != 11 {
		t.Errorf("totalCommits = %v over weeks summing to %d, want 11 and 11", payload.TotalCommits, sum)
	}
	if payload.TotalContributions != days*3 {
		t.Errorf("the calendar changed under its commit half: %d contributions", payload.TotalContributions)
	}
}

// TestEachSeamDayIsCountedOnce is the seam proof, run against both ways an
// upstream can answer a sub-window that starts or ends inside a day: it either
// reports the whole day to both sub-windows, or the part on each side of the
// seam to each. Every seam day is then served exactly once, at its full count,
// and the totals add up — no day counted twice, none dropped.
func TestEachSeamDayIsCountedOnce(t *testing.T) {
	t.Parallel()
	start, days := commitsWindow()
	for _, testCase := range []struct {
		name      string
		splitting bool
	}{
		{"an upstream that reports whole days to both sub-windows", false},
		{"an upstream that splits each seam day at the seam", true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			raw := commitHalf(testCase.splitting,
				// Splits of every shape: part before, all before, all after —
				// and halves that differ, which is what a split looks like
				// (equal halves are the case the whole-window total settles).
				[]pushed{{offset: seamOne, count: 3, early: 1}, {offset: seamTwo, count: 2, early: 2}, {offset: seamThree, count: 3}},
				[]pushed{{offset: seamOne, count: 1}, {offset: 50, count: 1}},
			).on(t, calendarAnswer(start, days, 5, nil))
			payload, omitted := mapCommitsFixture(t, raw)
			if omitted != "" {
				t.Fatalf("omitted (%s)", omitted)
			}
			for offset, want := range map[int]int{seamOne: 4, seamTwo: 2, seamThree: 3, 50: 1} {
				if got := commitDay(payload, offset); got != want {
					t.Errorf("day %d carries %d commits, want %d", offset, got, want)
				}
			}
			if *payload.TotalCommits != 10 {
				t.Errorf("totalCommits = %d, want 10", *payload.TotalCommits)
			}
		})
	}
}

// TestTheStraddlingDayBeforeTheWindowIsSetAside: the upstream reports the
// bucket of the local day straddling the requested start. It is no day the
// grid draws, so it is in neither the weeks nor the total, whichever way the
// first sub-window — and with it the whole window, which starts at the same
// instant — counts it. A later sub-window may likewise leave the seam day it
// starts inside out of its own total.
func TestTheStraddlingDayBeforeTheWindowIsSetAside(t *testing.T) {
	t.Parallel()
	start, days := commitsWindow()
	for name, edit := range map[string]func(*commitHalfFixture){
		"the totals count it": func(*commitHalfFixture) {},
		"the totals do not count it": func(half *commitHalfFixture) {
			half.windows[0].total -= 4
			half.whole -= 4
		},
		"a later sub-window's total leaves out its first day": func(half *commitHalfFixture) {
			half.windows[1].total -= 1
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			half := commitHalf(false, []pushed{{offset: -1, count: 4}, {offset: 3, count: 2}, {offset: seamOne, count: 1}})
			edit(&half)
			payload, omitted := mapCommitsFixture(t, half.on(t, calendarAnswer(start, days, 3, nil)))
			if omitted != "" {
				t.Fatalf("omitted (%s)", omitted)
			}
			if *payload.TotalCommits != 3 || commitDay(payload, 3) != 2 || commitDay(payload, seamOne) != 1 {
				t.Errorf("totalCommits = %d, day 3 = %d, seam day = %d; want only the drawn days' 3, 2 and 1",
					*payload.TotalCommits, commitDay(payload, 3), commitDay(payload, seamOne))
			}
		})
	}
}

// TestZeroCommitsIsAReadingAndIsServed: a window with no commit at all is a
// measured zero, served beside its empty weeks, never confused with absence.
func TestZeroCommitsIsAReadingAndIsServed(t *testing.T) {
	t.Parallel()
	start, days := commitsWindow()
	mapped, omitted, err := mapCalendarDocument(commitHalf(false).on(t, calendarAnswer(start, days, 1, nil)), commitsNow)
	if err != nil || omitted != "" {
		t.Fatalf("a commit-free window was refused or omitted: %v %q", err, omitted)
	}
	if !bytes.Contains(mapped, []byte(`"totalCommits":0`)) || !bytes.Contains(mapped, []byte(`"commitWeeks":[[0,0,0,0,0,0,0]`)) {
		t.Fatalf("a measured zero was not served as one: %s", mapped)
	}
}

// TestACalendarThatWasNotAskedForCommitsCarriesNone: the public document and a
// query that does not ask for the commit half both leave the two fields out,
// together — the page then prints its dash.
func TestACalendarThatWasNotAskedForCommitsCarriesNone(t *testing.T) {
	t.Parallel()
	start, days := commitsWindow()
	mapped, omitted, err := mapCalendarDocument([]byte(calendarAnswer(start, days, 2, nil)), commitsNow)
	if err != nil || omitted != "" {
		t.Fatalf("a commit-free query was refused or reported an omission: %v %q", err, omitted)
	}
	for _, field := range []string{`"commitWeeks"`, `"totalCommits"`} {
		if bytes.Contains(mapped, []byte(field)) {
			t.Errorf("the payload carries %s although the document never had it", field)
		}
	}
}

// TestACommitFigureThatCannotBePlacedExactlyIsOmitted is the honesty floor:
// every bound or placement the answer fails costs the commit figure — both
// fields, together — and nothing else. The calendar beside it is served as
// proven, and the reason is the closed code readCalendar logs.
func TestACommitFigureThatCannotBePlacedExactlyIsOmitted(t *testing.T) {
	t.Parallel()
	start, days := commitsWindow()
	// One commit in the middle of every sub-window, and whatever a case adds.
	base := func(extra ...pushed) commitHalfFixture {
		return commitHalf(false, append([]pushed{{offset: 5, count: 1}, {offset: 100, count: 1}, {offset: 200, count: 1}, {offset: 300, count: 1}}, extra...))
	}
	// stray adds one bucket to a sub-window's first entry, counted honestly
	// by that entry and that sub-window.
	stray := func(half *commitHalfFixture, window int, node commitNodeFixture) {
		entry := &half.windows[window].entries[0]
		entry.nodes = append(entry.nodes, node)
		entry.totalCount += node.count
		half.windows[window].total += node.count
	}
	at := func(offset int) string { return localMidnight(start.AddDate(0, 0, offset)) }
	calendar := calendarAnswer(start, days, 3, nil)
	for _, testCase := range []struct {
		name     string
		half     func() commitHalfFixture
		calendar string
		reason   string
	}{
		{"a page the upstream says was cut", func() commitHalfFixture {
			half := base()
			half.windows[0].entries[0].next = true
			return half
		}, calendar, commitOmittedTruncated},
		{"a repository's buckets short of its commit count", func() commitHalfFixture {
			half := base()
			half.windows[1].entries[0].totalCount++
			return half
		}, calendar, commitOmittedRepositoryTotal},
		{"a repository's buckets past its commit count", func() commitHalfFixture {
			half := base()
			half.windows[1].entries[0].totalCount--
			return half
		}, calendar, commitOmittedRepositoryTotal},
		{"a repository's buckets past the shared count bound", func() commitHalfFixture {
			half := base()
			stray(&half, 0, commitNodeFixture{at: at(-1), count: maxCountValue})
			stray(&half, 0, commitNodeFixture{at: at(-1), count: 1})
			return half
		}, calendar, commitOmittedRepositoryTotal},
		{"a sub-window total its buckets do not reach", func() commitHalfFixture {
			half := base()
			half.windows[2].total++
			return half
		}, calendar, commitOmittedTotal},
		{"a sub-window total its buckets overshoot", func() commitHalfFixture {
			half := base()
			half.windows[2].total--
			return half
		}, calendar, commitOmittedTotal},
		{"a window total the days do not reach", func() commitHalfFixture {
			half := base()
			half.whole++
			return half
		}, calendar, commitOmittedWindowTotal},
		{"a window total the days overshoot", func() commitHalfFixture {
			half := base()
			half.whole--
			return half
		}, calendar, commitOmittedWindowTotal},
		// The one split a seam cannot tell from a repeated day: two equal
		// halves read as one day fall a half short of the window total.
		{"a seam day split into two equal halves", func() commitHalfFixture {
			return commitHalf(true, []pushed{{offset: 5, count: 1}, {offset: seamTwo, count: 2, early: 1}})
		}, calendar, commitOmittedWindowTotal},
		{"a window total without the day before, beside a first sub-window counting it", func() commitHalfFixture {
			half := base(pushed{offset: -1, count: 2})
			half.whole -= 2
			return half
		}, calendar, commitOmittedWindowTotal},
		{"a first sub-window without the day before, beside a window total counting it", func() commitHalfFixture {
			half := base(pushed{offset: -1, count: 2})
			half.windows[0].total -= 2
			return half
		}, calendar, commitOmittedWindowTotal},
		{"a bucket two days before the window", func() commitHalfFixture {
			half := base()
			stray(&half, 0, commitNodeFixture{at: at(-2), count: 1})
			return half
		}, calendar, commitOmittedWindow},
		{"a bucket after the window's last day", func() commitHalfFixture {
			half := base()
			stray(&half, 3, commitNodeFixture{at: at(days), count: 1})
			return half
		}, calendar, commitOmittedWindow},
		{"a sub-window reporting a day inside another's", func() commitHalfFixture {
			half := base()
			stray(&half, 2, commitNodeFixture{at: at(100), count: 1})
			return half
		}, calendar, commitOmittedWindow},
		// A calendar that starts anywhere but the window asked for cannot be
		// matched to the sub-windows. Starting EARLIER is the dangerous one:
		// the day before the window would be a drawn day, and setting it
		// aside would serve it as quiet.
		{"a calendar starting before the window asked for", func() commitHalfFixture {
			return base(pushed{offset: -1, count: 2})
		}, calendarAnswer(start.AddDate(0, 0, -daysPerWeek), days+daysPerWeek, 3, nil), commitOmittedWindow},
		{"a calendar starting after the window asked for", func() commitHalfFixture {
			return base()
		}, calendarAnswer(start.AddDate(0, 0, daysPerWeek), days-daysPerWeek, 3, nil), commitOmittedWindow},
		{"a bucket whose date cannot be told", func() commitHalfFixture {
			half := base()
			stray(&half, 0, commitNodeFixture{at: start.AddDate(0, 0, 6).Add(commitBucketDateHorizon).Format(time.RFC3339), count: 1})
			return half
		}, calendar, commitOmittedDay},
		{"a day with more commits than contributions", func() commitHalfFixture {
			return base(pushed{offset: 40, count: 4})
		}, calendar, commitOmittedExceeds},
		{"two repositories overfilling one day together", func() commitHalfFixture {
			return commitHalf(false, []pushed{{offset: 40, count: 2}}, []pushed{{offset: 40, count: 2}})
		}, calendar, commitOmittedExceeds},
		{"one side of a seam overfilling its day", func() commitHalfFixture {
			return base(pushed{offset: seamOne, count: 4})
		}, calendar, commitOmittedExceeds},
		{"two halves of a seam day overfilling it together", func() commitHalfFixture {
			return commitHalf(true, []pushed{{offset: seamThree, count: 5, early: 2}})
		}, calendar, commitOmittedExceeds},
		// Two repositories, each within the bound on its own, whose share of
		// the set-aside day together passes it.
		{"a straddling day past the shared count bound", func() commitHalfFixture {
			return commitHalf(false, []pushed{{offset: -1, count: maxCountValue}}, []pushed{{offset: -1, count: 1}})
		}, calendar, commitOmittedTotal},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			payload, omitted := mapCommitsFixture(t, testCase.half().on(t, testCase.calendar))
			if omitted != testCase.reason {
				t.Errorf("omitted for %q, want %q", omitted, testCase.reason)
			}
			if payload.CommitWeeks != nil || payload.TotalCommits != nil {
				t.Errorf("a figure that could not be placed was served: %v / %v", payload.CommitWeeks, payload.TotalCommits)
			}
			if payload.TotalContributions == 0 || len(payload.Weeks) == 0 {
				t.Errorf("the omission cost the calendar too: %d contributions over %d weeks", payload.TotalContributions, len(payload.Weeks))
			}
		})
	}
}

// TestACommitSectionThatCannotBeReadRefusesTheDocument: drift in the commit
// half is drift in the document, refused whole like every other — and the
// refusal names an entry by position, never by anything an entry might carry.
func TestACommitSectionThatCannotBeReadRefusesTheDocument(t *testing.T) {
	t.Parallel()
	start, days := commitsWindow()
	good := commitHalf(false, []pushed{{offset: 5, count: 1}}).on(t, calendarAnswer(start, days, 3, nil))
	edit := func(mutate func(viewer map[string]any)) []byte {
		var document map[string]any
		if err := json.Unmarshal(good, &document); err != nil {
			t.Fatalf("decode: %v", err)
		}
		mutate(document["data"].(map[string]any)["viewer"].(map[string]any))
		encoded, err := json.Marshal(document)
		if err != nil {
			t.Fatalf("encode: %v", err)
		}
		return encoded
	}
	window := func(viewer map[string]any, number int) map[string]any {
		return viewer[fmt.Sprintf("commits%d", number)].(map[string]any)
	}
	entry := func(viewer map[string]any) map[string]any {
		return window(viewer, 1)["commitContributionsByRepository"].([]any)[0].(map[string]any)
	}
	node := func(viewer map[string]any) map[string]any {
		return entry(viewer)["contributions"].(map[string]any)["nodes"].([]any)[0].(map[string]any)
	}
	many := make([]any, maxCalendarCommitRepositories+1)
	for index := range many {
		many[index] = map[string]any{"contributions": map[string]any{"totalCount": 0, "pageInfo": map[string]any{"hasNextPage": false}, "nodes": []any{}}}
	}
	full := make([]any, maxCalendarCommitBuckets+1)
	for index := range full {
		full[index] = map[string]any{"at": localMidnight(start.AddDate(0, 0, index%seamOne)), "count": 0}
	}
	const secret = "a-private-repository-name"
	for _, testCase := range []struct {
		name   string
		mutate func(viewer map[string]any)
		reason string
	}{
		{"a window total with no sub-windows", func(v map[string]any) {
			for number := 1; number <= calendarCommitWindows; number++ {
				delete(v, fmt.Sprintf("commits%d", number))
			}
		}, "half of its commit section"},
		{"sub-windows with no window total", func(v map[string]any) {
			delete(v["contributionsCollection"].(map[string]any), "totalCommitContributions")
		}, "half of its commit section"},
		{"a sub-window missing", func(v map[string]any) { delete(v, "commits3") }, "half of its commit section"},
		{"a sub-window with no total", func(v map[string]any) {
			delete(window(v, 2), "totalCommitContributions")
		}, "half of its commit section"},
		{"a sub-window with no buckets", func(v map[string]any) {
			delete(window(v, 4), "commitContributionsByRepository")
		}, "half of its commit section"},
		{"a negative window total", func(v map[string]any) {
			v["contributionsCollection"].(map[string]any)["totalCommitContributions"] = -1
		}, "negative commit total"},
		{"a negative sub-window total", func(v map[string]any) { window(v, 3)["totalCommitContributions"] = -1 }, "negative commit total"},
		{"more repositories than the query asks for", func(v map[string]any) {
			window(v, 4)["commitContributionsByRepository"] = many
		}, "over the 25 bound"},
		{"more buckets than one page holds", func(v map[string]any) {
			entry(v)["contributions"] = map[string]any{"totalCount": 0, "pageInfo": map[string]any{"hasNextPage": false}, "nodes": full}
		}, "over the 100 bound"},
		// Absent, a cut page would read as a complete one.
		{"a page that does not say whether it was cut", func(v map[string]any) {
			delete(entry(v)["contributions"].(map[string]any), "pageInfo")
		}, "no page information"},
		{"a negative repository commit count", func(v map[string]any) {
			entry(v)["contributions"].(map[string]any)["totalCount"] = -1
		}, "negative commit count"},
		{"an instant that does not parse", func(v map[string]any) { node(v)["at"] = "yesterday" }, "does not parse"},
		{"a negative count", func(v map[string]any) { node(v)["count"] = -1 }, "negative count"},
		// The query renames the upstream's fields; a bucket under the original
		// names is an answer to some other query.
		{"a bucket under the upstream's own field names", func(v map[string]any) {
			bucket := node(v)
			bucket["occurredAt"], bucket["commitCount"] = bucket["at"], bucket["count"]
			delete(bucket, "at")
			delete(bucket, "count")
		}, "unknown field"},
		{"a sub-window the query never asked for", func(v map[string]any) { v["commits5"] = window(v, 1) }, "unknown field"},
		// The query asks for no repository identity, so an answer carrying one
		// is a field the decode never admits: the name cannot even be read.
		{"an entry carrying a repository identity", func(v map[string]any) {
			entry(v)["repository"] = map[string]any{"name": secret, "isPrivate": true}
		}, "unknown field"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			mapped, omitted, err := mapCalendarDocument(edit(testCase.mutate), commitsNow)
			if err == nil {
				t.Fatalf("admitted (omitted %q): %s", omitted, mapped)
			}
			if !strings.Contains(err.Error(), testCase.reason) {
				t.Errorf("refused with %q, want %q", err, testCase.reason)
			}
			if strings.Contains(err.Error(), secret) {
				t.Errorf("the refusal names what an entry carried: %v", err)
			}
		})
	}
}

// TestTheSubWindowsTileTheCalendarsWindow pins the split the request asks
// for, at every weekday and across the day: the variables are one clock
// reading's (the window ends at it and starts where calendarWindowStart puts
// it), the sub-windows run end to end from the window's start to its end,
// each is non-empty and at most 98 days long, every seam sits at the seam
// hour, and no sub-window can report more days than one page holds. The
// variables posted are exactly the ones the query declares.
func TestTheSubWindowsTileTheCalendarsWindow(t *testing.T) {
	t.Parallel()
	for offset := range 7 {
		for _, hour := range []int{0, 6, 12, 18, 23} {
			now := time.Date(2026, 8, 24, hour, 59, 59, 0, time.UTC).AddDate(0, 0, offset)
			encoded, err := json.Marshal(calendarVariables(now))
			if err != nil {
				t.Fatalf("encode variables: %v", err)
			}
			var posted map[string]string
			if err := json.Unmarshal(encoded, &posted); err != nil {
				t.Fatalf("decode variables: %v", err)
			}
			names := []string{calendarFromVariable, calendarSeam1Variable, calendarSeam2Variable, calendarSeam3Variable, calendarToVariable}
			if len(posted) != len(names) {
				t.Fatalf("%d variables posted, want exactly the %d the query declares: %v", len(posted), len(names), posted)
			}
			points := make([]time.Time, len(names))
			for index, name := range names {
				value, declared := posted[strings.TrimPrefix(name, "$")]
				if !declared {
					t.Fatalf("no value posted for %s", name)
				}
				if points[index], err = time.Parse(time.RFC3339, value); err != nil {
					t.Fatalf("%s = %q: %v", name, value, err)
				}
			}
			if !points[0].Equal(calendarWindowStart(now)) || !points[len(points)-1].Equal(now) {
				t.Errorf("at %s the window is %s to %s; want it computed from that one reading", now, points[0], points[len(points)-1])
			}
			for window := range calendarCommitWindows {
				from, to := points[window], points[window+1]
				if !to.After(from) || to.Sub(from) > 98*24*time.Hour {
					t.Errorf("at %s sub-window %d runs %s to %s", now, window+1, from, to)
				}
				// The days it can report: the one its start falls in (or the
				// day before the window, for the first) through the one its
				// end falls in.
				reportable := int(to.Truncate(24*time.Hour).Sub(from.Truncate(24*time.Hour))/(24*time.Hour)) + 1
				if window == 0 {
					reportable++
				}
				if reportable > maxCalendarCommitBuckets {
					t.Errorf("at %s sub-window %d can report %d days, over the %d page", now, window+1, reportable, maxCalendarCommitBuckets)
				}
				if window > 0 && (from.Hour() != 12 || from.Minute() != 0 || from.Second() != 0) {
					t.Errorf("at %s seam %d sits at %s, not at noon UTC", now, window, from.Format(time.TimeOnly))
				}
			}
		}
	}
}

// TestTheShippedCalendarQueryAsksForTheCommitHalfAndNoIdentity pins the
// shipped query to the split and the bounds the admission enforces, and to
// requirement 12: the window's own commit total sits on the calendar's
// collection, the four sub-windows chain from its $from to its $to through
// the seams, each asks the one shape the decode admits — counts, dates and
// page sizes — and none asks for any repository identity, so a private
// repository is counted and there is nothing anywhere to name it by.
func TestTheShippedCalendarQueryAsksForTheCommitHalfAndNoIdentity(t *testing.T) {
	t.Parallel()
	document, _, err := loadFetchConfig(fetchConfigBytes)
	if err != nil {
		t.Fatalf("shipped config refused: %v", err)
	}
	if document.VCSActivity == nil || document.VCSActivity.Calendar == nil {
		t.Fatal("the shipped config carries no credentialed calendar")
	}
	query := document.VCSActivity.Calendar.Query
	calendar := strings.Index(query, "contributionsCollection(from: $from, to: $to) {")
	first := strings.Index(query, "commits1:")
	if calendar < 0 || first < calendar {
		t.Fatalf("the calendar's own collection does not come first: %s", query)
	}
	if section := query[calendar:first]; !strings.Contains(section, "contributionCalendar") ||
		!strings.Contains(section, "totalCommitContributions") || strings.Contains(section, "commitContributionsByRepository") {
		t.Errorf("the calendar's collection must carry the calendar and the window's commit total, and no buckets: %s", section)
	}
	if count := strings.Count(query, "contributionsCollection("); count != 1+calendarCommitWindows {
		t.Errorf("%d collections asked for, want the calendar's and %d sub-windows", count, calendarCommitWindows)
	}
	for _, chained := range []string{
		"commits1: contributionsCollection(from: $from, to: $seam1) { ...commitDays }",
		"commits2: contributionsCollection(from: $seam1, to: $seam2) { ...commitDays }",
		"commits3: contributionsCollection(from: $seam2, to: $seam3) { ...commitDays }",
		"commits4: contributionsCollection(from: $seam3, to: $to) { ...commitDays }",
	} {
		if strings.Count(query, chained) != 1 {
			t.Errorf("the shipped query does not chain %q", chained)
		}
	}
	fragment := strings.Index(query, "fragment commitDays on ContributionsCollection {")
	if fragment < 0 || strings.Count(query, "fragment ") != 1 {
		t.Fatalf("the sub-windows do not share the one commit fragment: %s", query)
	}
	section := query[fragment:]
	for pattern, want := range map[string]int{
		`commitContributionsByRepository\(maxRepositories: (\d+)\)`: maxCalendarCommitRepositories,
		`contributions\(first: (\d+)\)`:                             maxCalendarCommitBuckets,
	} {
		found := regexp.MustCompile(pattern).FindStringSubmatch(section)
		if found == nil || found[1] != fmt.Sprint(want) {
			t.Errorf("the shipped query's %s is %v; the admission bound is %d", pattern, found, want)
		}
	}
	if !strings.Contains(section, "totalCommitContributions") ||
		!strings.Contains(section, "{ totalCount pageInfo { hasNextPage } nodes { at: occurredAt count: commitCount } }") {
		t.Errorf("the commit fragment does not ask for its total, each page's commit count and continuation, and the renamed buckets: %s", section)
	}
	for _, identity := range []string{"repository", "name", "isPrivate", "owner", "url", " id "} {
		if strings.Contains(section, identity) {
			t.Errorf("the commit half asks for %q; it must carry counts and dates only", identity)
		}
	}
}

// TestTheWorstCaseCalendarAnswerFitsItsByteCap measures, rather than assumes,
// that the commit half cannot push a legitimate answer past the calendar
// spec's byte cap — which would refuse the CALENDAR, not just the commit
// figure. Every term is at its bound: the widest calendar this package admits
// at five-digit counts, and in every sub-window every repository's whole page
// at five-digit counts and page sizes.
func TestTheWorstCaseCalendarAnswerFitsItsByteCap(t *testing.T) {
	t.Parallel()
	document, bounds, err := loadFetchConfig(fetchConfigBytes)
	if err != nil {
		t.Fatalf("shipped config refused: %v", err)
	}
	start := firstSunday(commitsNow.AddDate(0, 0, -maxCalendarDays))
	calendar := calendarAnswer(start, maxCalendarDays, 99999, intPointer(99999*maxCalendarDays))
	page := commitEntryFixture{totalCount: 99999 * maxCalendarCommitBuckets, nodes: make([]commitNodeFixture, maxCalendarCommitBuckets)}
	for index := range page.nodes {
		page.nodes[index] = commitNodeFixture{at: localMidnight(start.AddDate(0, 0, 9)), count: 99999}
	}
	worst := commitHalfFixture{whole: 99999999}
	for window := range worst.windows {
		worst.windows[window].total = 99999999
		for range maxCalendarCommitRepositories {
			worst.windows[window].entries = append(worst.windows[window].entries, page)
		}
	}
	answer := worst.on(t, calendar)
	limit := document.VCSActivity.Calendar.MaxBytes
	if int64(len(answer)) > limit {
		t.Fatalf("the worst-case calendar answer is %d bytes, over the spec's %d cap", len(answer), limit)
	}
	if limit > bounds.MaxBytes {
		t.Fatalf("the calendar cap %d escapes the shared bound %d", limit, bounds.MaxBytes)
	}
	t.Logf("worst-case calendar answer: %d bytes, %d under the %d cap", len(answer), limit-int64(len(answer)), limit)
}

// TestTheCommitOmissionIsLoggedOnTransitionOnly: a fast cadence must not
// repeat the same reason every minute, a changed reason and a recovery are
// each one line, and a line carries the closed code and nothing else.
func TestTheCommitOmissionIsLoggedOnTransitionOnly(t *testing.T) {
	t.Parallel()
	source, err := NewFetchSource(SnapshotSource{Name: "snapshots/vcs-activity.json"}, liveTestConfig(),
		panelFetchSpecs{vcs: activitySpec(calendarSpec())})
	if err != nil {
		t.Fatalf("build source: %v", err)
	}
	var out bytes.Buffer
	source.setLogger(slog.New(slog.NewJSONHandler(&out, &slog.HandlerOptions{Level: slog.LevelDebug})))
	for _, reason := range []string{"", commitOmittedTotal, commitOmittedTotal, commitOmittedWindow, "", ""} {
		source.noteCommitOmission(t.Context(), reason)
	}
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 3 {
		t.Fatalf("%d lines for two omissions and one recovery: %s", len(lines), out.String())
	}
	for index, want := range []string{commitOmittedTotal, commitOmittedWindow, "restored"} {
		if !strings.Contains(lines[index], want) {
			t.Errorf("line %d = %s, want %q", index, lines[index], want)
		}
	}
}

// answeringDoer is an upstream that answers from the request it was sent.
type answeringDoer func(*http.Request) (*http.Response, error)

func (answer answeringDoer) Do(r *http.Request) (*http.Response, error) { return answer(r) }

// TestTheServedActivityKeepsTheCommitHalf runs the whole credentialed round
// against an upstream that answers over exactly the window it was ASKED for:
// the seams it receives must be the ones its own $from implies, and the
// payload the panel serves — merged with the commit log and re-encoded —
// carries the commits it reported, seam day included, strictly decodable
// under the served kind.
func TestTheServedActivityKeepsTheCommitHalf(t *testing.T) {
	t.Parallel()
	doer := answeringDoer(func(r *http.Request) (*http.Response, error) {
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			return nil, err
		}
		var request queryRequest
		if err := json.Unmarshal(raw, &request); err != nil {
			return nil, err
		}
		posted := request.Variables
		from, fromErr := time.Parse(time.RFC3339, posted.From)
		to, toErr := time.Parse(time.RFC3339, posted.To)
		if fromErr != nil || toErr != nil {
			return nil, fmt.Errorf("unreadable window %q to %q", posted.From, posted.To)
		}
		for index, seam := range []string{posted.Seam1, posted.Seam2, posted.Seam3} {
			if want := from.AddDate(0, 0, (index+1)*seamOne).Add(12 * time.Hour).Format(time.RFC3339); seam != want {
				t.Errorf("seam %d posted as %q; the posted window's start implies %q", index+1, seam, want)
			}
		}
		days := int(to.Truncate(24*time.Hour).Sub(from)/(24*time.Hour)) + 1
		body := commitHalfOver(from, days, false,
			[]pushed{{offset: 7, count: 2}, {offset: seamOne, count: 1}, {offset: days - 1, count: 1}},
		).on(t, calendarAnswer(from, days, 2, nil))
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"application/json"}},
			Body: io.NopCloser(bytes.NewReader(body))}, nil
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
	if _, err := decodeKindPayload(KindVCSActivity, loaded.data); err != nil {
		t.Fatalf("the served payload does not decode under its kind: %v", err)
	}
	payload := decodeActivityPayload(t, loaded)
	if payload.TotalCommits == nil || *payload.TotalCommits != 4 || commitDay(payload, 7) != 2 || commitDay(payload, seamOne) != 1 {
		t.Fatalf("the served payload lost its commit half: %v %v", payload.TotalCommits, payload.CommitWeeks)
	}
	if len(payload.CommitWeeks) != len(payload.Weeks) {
		t.Errorf("%d commit columns beside %d calendar columns", len(payload.CommitWeeks), len(payload.Weeks))
	}
}
