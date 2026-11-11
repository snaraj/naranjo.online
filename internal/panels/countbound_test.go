package panels

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Issue #404: every count a contribution mapper admits, and every sum it
// builds from them, is held to maxCountValue, the bound the whole pipeline
// shares. Each test below drives one guard with a document that every OTHER
// check admits — the per-day sign check, the contiguity floor, the document's
// own total — so removing that guard is what turns the refusal into a served
// payload. Each also carries its at-bound positive control: maxCountValue is
// a count, maxCountValue+1 is not.

// groupedCount writes a count the way the public calendar labels do.
func groupedCount(count int) string {
	digits := strconv.Itoa(count)
	var grouped strings.Builder
	for index, digit := range digits {
		if index > 0 && (len(digits)-index)%3 == 0 {
			grouped.WriteByte(',')
		}
		grouped.WriteRune(digit)
	}
	return grouped.String()
}

func TestACellLabelPastTheSharedBoundIsNotACount(t *testing.T) {
	t.Parallel()
	label := func(count int) string {
		return `<tool-tip for="cell">` + groupedCount(count) + ` contributions on May 1st.</tool-tip>`
	}
	if count, err := labelledCount(label(maxCountValue), "cell"); err != nil || count != maxCountValue {
		t.Errorf("a label at the bound = %d, %v; want %d admitted", count, err, maxCountValue)
	}
	if count, err := labelledCount(label(maxCountValue+1), "cell"); err == nil {
		t.Errorf("a label one past the bound was admitted as %d", count)
	}
}

// The captured public document's days sum to 499, 151 of them on one day. Set
// that day so the whole document sums to exactly the bound, then one past it.
func TestThePublicCalendarHoldsItsSumToTheSharedBound(t *testing.T) {
	t.Parallel()
	document := string(contributionsFixture(t))
	const day, rest = ">151 contributions on August 10th.<", 499 - 151
	if strings.Count(document, day) != 1 {
		t.Fatalf("the fixture no longer carries exactly one %q", day)
	}
	withDay := func(count int) string {
		return strings.Replace(document, day, ">"+groupedCount(count)+" contributions on August 10th.<", 1)
	}
	data, err := mapContributions([]byte(withDay(maxCountValue - rest)))
	if err != nil {
		t.Fatalf("a calendar summing to exactly the bound was refused: %v", err)
	}
	var payload VCSActivityData
	if err := json.Unmarshal(data, &payload); err != nil || payload.TotalContributions != maxCountValue {
		t.Fatalf("total = %d, %v; want %d", payload.TotalContributions, err, maxCountValue)
	}
	if _, err := mapContributions([]byte(withDay(maxCountValue - rest + 1))); err == nil {
		t.Error("a calendar summing to one past the bound was admitted")
	}
	// Every label at the bound: each count passes countFromLabel, and only the
	// bounded sum stands between the document and a total no reader can hold.
	every := regexp.MustCompile(`>[0-9][0-9,]* contributions? on `).ReplaceAllString(document, ">"+groupedCount(maxCountValue)+" contributions on ")
	if _, err := mapContributions([]byte(every)); err == nil {
		t.Error("a calendar with every day at the bound was admitted")
	}
}

// credentialedCalendar builds a full credentialed answer with zero on every
// day but the ones named, and reports the honest sum as the document's total,
// so the cross-field check never refuses first.
func credentialedCalendar(t *testing.T, now time.Time, counts map[int]int) string {
	t.Helper()
	start := firstSunday(now.AddDate(0, 0, -calendarWindowDays))
	days := int(now.Sub(start)/(24*time.Hour)) + 1
	var document map[string]any
	if err := json.Unmarshal([]byte(calendarAnswer(start, days, 0, nil)), &document); err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	calendar := document["data"].(map[string]any)["viewer"].(map[string]any)["contributionsCollection"].(map[string]any)["contributionCalendar"].(map[string]any)
	total, offset := 0, 0
	for _, week := range calendar["weeks"].([]any) {
		for _, cell := range week.(map[string]any)["contributionDays"].([]any) {
			if count, ok := counts[offset]; ok {
				cell.(map[string]any)["contributionCount"] = count
				total += count
			}
			offset++
		}
	}
	calendar["totalContributions"] = total
	encoded, err := json.Marshal(document)
	if err != nil {
		t.Fatalf("encode fixture: %v", err)
	}
	return string(encoded)
}

func TestTheCredentialedCalendarHoldsEveryCountToTheSharedBound(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	everyDay := map[int]int{}
	for offset := range calendarWindowDays {
		everyDay[offset] = maxCountValue
	}
	for _, testCase := range []struct {
		name   string
		counts map[int]int
		admit  bool
	}{
		{"one day at the bound", map[int]int{10: maxCountValue}, true},
		{"two days summing to the bound", map[int]int{10: maxCountValue - 1, 11: 1}, true},
		{"one day past the bound", map[int]int{10: maxCountValue + 1}, false},
		{"two days at the bound", map[int]int{10: maxCountValue, 11: maxCountValue}, false},
		{"every day at the bound", everyDay, false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			data, _, err := mapCalendarDocument([]byte(credentialedCalendar(t, now, testCase.counts)), now)
			if !testCase.admit {
				if err == nil {
					t.Fatal("a calendar whose count or sum leaves the shared bound was admitted")
				}
				if !strings.Contains(err.Error(), "shared count bound") {
					t.Fatalf("refusal = %v, want the shared count bound named", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("a calendar inside the bound was refused: %v", err)
			}
			var payload VCSActivityData
			if err := json.Unmarshal(data, &payload); err != nil || payload.TotalContributions != maxCountValue {
				t.Fatalf("total = %d, %v; want %d", payload.TotalContributions, err, maxCountValue)
			}
		})
	}
}

func TestTheDiscoveryAnswerHoldsEveryCountToTheSharedBound(t *testing.T) {
	t.Parallel()
	public := func(id string, count int) fixtureContributionRepo {
		return fixtureContributionRepo{id: "R_" + id, name: "repo-" + id, days: []fixtureContributionDay{{at: windowDay(1), count: count}}}
	}
	private := func(id string, count int) fixtureContributionRepo {
		repo := public(id, count)
		repo.private = true
		return repo
	}
	for _, testCase := range []struct {
		name  string
		repos []fixtureContributionRepo
		admit bool
	}{
		{"one public bucket at the bound", []fixtureContributionRepo{public("a", maxCountValue)}, true},
		{"one private bucket at the bound", []fixtureContributionRepo{private("a", maxCountValue)}, true},
		{"buckets summing to the bound", []fixtureContributionRepo{public("a", maxCountValue-1), private("b", 1)}, true},
		{"one public bucket past the bound", []fixtureContributionRepo{public("a", maxCountValue+1)}, false},
		{"one private bucket past the bound", []fixtureContributionRepo{private("a", maxCountValue+1)}, false},
		{"two private buckets summing past the bound", []fixtureContributionRepo{private("a", maxCountValue), private("b", 1)}, false},
		{"a public and a private bucket summing past the bound", []fixtureContributionRepo{public("a", maxCountValue), private("b", 1)}, false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			_, _, days, err := mapCommitContributions([]byte(contributionsAnswer(testCase.repos, nil)), "fixture-owner", commitRoundNow)
			if !testCase.admit {
				if err == nil {
					t.Fatalf("a discovery answer leaving the shared bound was admitted with private days %+v", days)
				}
				if want := fmt.Sprintf("[0,%d]", maxCountValue); !strings.Contains(err.Error(), want) {
					t.Fatalf("refusal = %v, want it to name %s", err, want)
				}
				return
			}
			if err != nil {
				t.Fatalf("a discovery answer inside the bound was refused: %v", err)
			}
			for _, day := range days {
				if day.Contributions > maxCountValue {
					t.Errorf("a private day carries %d, past the bound", day.Contributions)
				}
			}
		})
	}
}
