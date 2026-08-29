// mapping.go turns strictly decoded upstream documents into panel payloads.
// Everything here is pure data transformation — no network, no filesystem —
// and every upstream byte passes decodeStrict before a field of it is read,
// so grammar drift degrades to last-good serving instead of wrong data.

package panels

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// mapHiscores maps a hiscores/v1 document onto the account's whole public
// record: every skill row the upstream reports, and EVERY boss it reports in
// upstream order minus the activities configuration names as non-bosses. The
// direction matters: the upstream activity table grows whenever new content
// ships, so enumerating bosses would silently drop every boss added since the
// last edit. Enumerating the non-bosses instead means an unrecognized entry is
// PRESERVED — the fail-soft direction — and only genuinely new non-boss
// activities need a data edit. Skills need no exclusion list at all: every row
// of that table is a skill, including ones that do not exist yet.
//
// A rank of -1 is the upstream's "not ranked" sentinel and becomes a null rank
// the frontend renders as "Unranked"; a score, level, or experience of -1
// becomes a null figure rendered as "--". A reported 0 is a real zero and
// stays one.
//
// A document carrying no skill rows serves none: skills are an additive
// section of boss-log/v1, and an empty table renders as the honest empty
// state. An empty BOSS table stays an error, because that is the panel's
// original contract and a boss list that vanished is drift, not data.
func mapHiscores(raw []byte, spec *bossLogFetchSpec) (json.RawMessage, error) {
	var document hiscoresDocument
	if err := decodeStrict(raw, &document); err != nil {
		return nil, fmt.Errorf("hiscores document: %w", err)
	}
	excluded := make(map[string]bool, len(spec.ExcludeActivities))
	for _, name := range spec.ExcludeActivities {
		excluded[name] = true
	}
	payload := BossLogData{
		Account: spec.Account,
		Skills:  make([]BossLogSkill, 0, len(document.Skills)),
		Bosses:  make([]BossLogEntry, 0, len(document.Activities)),
	}
	seenSkill := make(map[string]bool, len(document.Skills))
	for _, skill := range document.Skills {
		if skill.Name == "" || seenSkill[skill.Name] {
			continue
		}
		seenSkill[skill.Name] = true
		payload.Skills = append(payload.Skills, BossLogSkill{
			Name:  skill.Name,
			Level: hiscoreFigure(skill.Level),
			Rank:  hiscoreFigure(skill.Rank),
			XP:    hiscoreFigure(skill.XP),
		})
	}
	seen := make(map[string]bool, len(document.Activities))
	for _, activity := range document.Activities {
		if activity.Name == "" || excluded[activity.Name] || seen[activity.Name] {
			continue
		}
		seen[activity.Name] = true
		payload.Bosses = append(payload.Bosses, BossLogEntry{
			Name: activity.Name,
			KC:   hiscoreFigure(activity.Score),
			Rank: hiscoreFigure(activity.Rank),
		})
	}
	if len(payload.Bosses) == 0 {
		return nil, errors.New("hiscores document names no bosses after exclusions")
	}
	// Marshaling the package-owned payload cannot fail.
	data, _ := json.Marshal(payload)
	return data, nil
}

// hiscoreFigure turns one upstream figure into the served nullable value: the
// upstream writes -1 where it has nothing to report, and every other value —
// zero included — is a real figure. One helper for skills and bosses alike, so
// the two tables can never disagree about what "unreported" means.
func hiscoreFigure(value int64) *int64 {
	if value < 0 {
		return nil
	}
	figure := value
	return &figure
}

// mapContributions maps the PUBLIC contribution-calendar document onto the
// vcs-activity/v1 payload. The upstream is markup, not JSON, so it gets a
// scanner rather than a decoder — but the same fail-closed contract: every
// dated cell must carry a level and a matching label with a readable count,
// the covered span must be plausible, and anything else is an error that
// keeps the last good payload serving as stale. Nothing is inferred, and a
// cell whose count cannot be read is never quietly counted as zero.
//
// The document also contains cells that are NOT calendar days — the ramp
// legend — and those carry no date. Undated cells are skipped rather than
// refused, and minCalendarDays is what catches a markup change that leaves
// the scanner finding nothing real.
func mapContributions(raw []byte) (json.RawMessage, error) {
	document := string(raw)
	counts := make(map[string]int, maxCalendarDays)
	var first, last time.Time
	dated := 0
	for _, tag := range scanTags(document, calendarCellMark) {
		date, ok := attributeValue(tag, "data-date")
		if !ok {
			continue
		}
		day, err := time.Parse(dayLayout, date)
		if err != nil {
			return nil, fmt.Errorf("contribution calendar: cell date %q: %w", date, err)
		}
		id, ok := attributeValue(tag, "id")
		if !ok {
			return nil, errors.New("contribution calendar: a dated cell carries no identity")
		}
		count, err := labelledCount(document, id)
		if err != nil {
			return nil, err
		}
		if _, repeated := counts[date]; repeated {
			return nil, fmt.Errorf("contribution calendar: %s appears twice", date)
		}
		counts[date] = count
		if dated == 0 || day.Before(first) {
			first = day
		}
		if dated == 0 || day.After(last) {
			last = day
		}
		dated++
	}
	if dated < minCalendarDays {
		return nil, fmt.Errorf("contribution calendar: only %d dated cells found, want at least %d", dated, minCalendarDays)
	}
	span := int(last.Sub(first)/(24*time.Hour)) + 1
	if span > maxCalendarDays {
		return nil, fmt.Errorf("contribution calendar spans %d days, over the %d day bound", span, maxCalendarDays)
	}
	// CONTIGUITY. The count floor and the span ceiling together still admit a
	// partially-parsed document: lose one cell to a markup change and the
	// remaining cells still number in the dozens and still span under a year,
	// so the day would be zero-filled and the panel would serve a plausible,
	// FRESH, WRONG total. Every day inside the covered span must therefore be
	// accounted for by a cell of its own — a hole is drift, not a quiet day.
	if dated != span {
		return nil, fmt.Errorf("contribution calendar: %d dated cells cover a %d day span; the document is missing days", dated, span)
	}
	daily := make([]int, span)
	total := 0
	for offset := range daily {
		daily[offset] = counts[first.AddDate(0, 0, offset).Format(dayLayout)]
		total += daily[offset]
	}
	return calendarPayload(daily, total, first, last, CoveragePublic)
}

// calendarPayload assembles the served activity payload from a contiguous run
// of daily counts. Both producers end here, which is what keeps the week
// chunking, the streak rule, the end date and the empty commit list identical
// no matter which document was read — the two mappers differ only in how they
// get from bytes to days.
func calendarPayload(daily []int, total int, first, last time.Time, coverage string) (json.RawMessage, error) {
	if first.Weekday() != time.Sunday {
		// SUNDAY ALIGNMENT. Week columns are sliced seven days at a time from
		// the first covered day, and the frontend derives the trailing padding
		// from the end date's weekday. The two agree only if a column IS a
		// calendar week, so a window starting on another weekday is refused
		// rather than silently shifting every cell's date.
		return nil, fmt.Errorf("contribution calendar starts on %s, not Sunday; week columns would not line up", first.Weekday())
	}
	payload := VCSActivityData{
		TotalContributions: total,
		Weeks:              chunkWeeks(daily),
		EndDate:            last.Format(dayLayout),
		Streak:             int(contributionStreak(daily)),
		// The calendar document carries no commit rows, and inventing them
		// from a snapshot would attach recorded data to a live payload. The
		// commit half is fetched separately, on its own cadence, and merged
		// in; empty is this mapper's honest answer.
		RecentCommits: []VCSCommit{},
		Coverage:      coverage,
	}
	// Marshaling the package-owned payload cannot fail.
	data, _ := json.Marshal(payload)
	return data, nil
}

// mapCalendarDocument maps the CREDENTIALED calendar answer onto the same
// vcs-activity/v1 payload the public document produces. The upstream is JSON
// this package asked for by name, so it gets decodeStrict rather than a
// scanner — but the admission is otherwise the identical contract, and one
// check exists here that the public path has no way to make:
//
// The document reports its own total alongside the days, and the two MUST
// agree. That is the cross-field integrity rule this producer's whole value
// rests on: the figure the owner sees on their profile is the total, the
// figure the grid draws is the sum of the days, and a document where those
// differ is one this package has half-understood. Refusing keeps the last good
// payload; serving either number would be picking which of two disagreeing
// claims to publish.
func mapCalendarDocument(raw []byte, now time.Time) (json.RawMessage, error) {
	// Two decodes, and which one is strict is the point (issue 246, finding
	// 2). The ENVELOPE is read leniently, because it is the protocol's own
	// wrapper and the protocol may add top-level siblings to it — `extensions`
	// above all — that this package never reads a value out of. The PAYLOAD is
	// read strictly, because it is the shape this package maps field by field
	// and an unknown field there is drift it has half-understood. Refusing the
	// whole document for a sibling of `data` would have taken out every
	// credentialed calendar from the day the upstream added one.
	var document calendarDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		return nil, fmt.Errorf("contribution calendar: %w", err)
	}
	if len(document.Errors) > 0 {
		// The upstream answers a refused credential, a missing scope, or a
		// malformed query with a 200 carrying this array. The COUNT is the
		// whole signal; the messages are upstream-authored prose and never
		// enter this process's narrative.
		return nil, fmt.Errorf("contribution calendar: the upstream refused the query with %d error(s)", len(document.Errors))
	}
	// An answer carrying neither errors nor data is not a calendar. Raw is nil
	// there and decodeStrict refuses nil, which is the FIRST refusal that
	// reaches it rather than the only one — the minimum-days floor below
	// catches an empty calendar too, and a mutation that skipped this decode
	// for a nil payload still failed there. Both are kept: this one names the
	// real fault where it happened instead of reporting a calendar that is
	// merely too short.
	var data calendarData
	if err := decodeStrict(document.Data, &data); err != nil {
		return nil, fmt.Errorf("contribution calendar: %w", err)
	}
	calendar := data.Viewer.Contributions.Calendar
	counts := make(map[string]int, maxCalendarDays)
	var first, last time.Time
	dated := 0
	for _, week := range calendar.Weeks {
		for _, day := range week.Days {
			parsed, err := time.Parse(dayLayout, day.Date)
			if err != nil {
				return nil, fmt.Errorf("contribution calendar: cell date %q: %w", day.Date, err)
			}
			if day.Count < 0 {
				return nil, fmt.Errorf("contribution calendar: %s reports a negative count", day.Date)
			}
			if _, repeated := counts[day.Date]; repeated {
				return nil, fmt.Errorf("contribution calendar: %s appears twice", day.Date)
			}
			counts[day.Date] = day.Count
			if dated == 0 || parsed.Before(first) {
				first = parsed
			}
			if dated == 0 || parsed.After(last) {
				last = parsed
			}
			dated++
		}
	}
	if dated < minCalendarDays {
		return nil, fmt.Errorf("contribution calendar: only %d dated cells found, want at least %d", dated, minCalendarDays)
	}
	// TRAILING WEEK PADDING. The window this package asks for ends today, but a
	// calendar is drawn in whole week columns, so an upstream may legitimately
	// close the final column with the rest of the current week — days that have
	// not happened yet. Refusing those outright would mean the panel silently
	// stopped updating the day a credential landed, which is exactly the
	// failure this producer exists to prevent, so they are DROPPED and the
	// window's real end is reported through EndDate — the field the payload
	// already carries so the frontend can draw days past it as holes rather
	// than as quiet ones.
	//
	// It is a narrow allowance, not a repair, and three things keep it narrow:
	// only days strictly after today are dropped, only a ZERO one may be
	// dropped (a contribution dated in the future is nonsense, not padding),
	// and at most a week's worth may be dropped before the document is refused
	// as describing a range nobody asked for.
	today := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	dropped := 0
	for last.After(today) {
		key := last.Format(dayLayout)
		if counts[key] != 0 {
			return nil, fmt.Errorf("contribution calendar reports %d contributions on %s, which has not happened yet", counts[key], key)
		}
		delete(counts, key)
		dated--
		dropped++
		if dropped >= daysPerWeek {
			return nil, fmt.Errorf("contribution calendar runs %d days past the window that was requested", dropped)
		}
		last = last.AddDate(0, 0, -1)
	}
	if dated < minCalendarDays {
		return nil, fmt.Errorf("contribution calendar: only %d dated cells remain inside the requested window, want at least %d", dated, minCalendarDays)
	}
	span := int(last.Sub(first)/(24*time.Hour)) + 1
	if span > maxCalendarDays {
		return nil, fmt.Errorf("contribution calendar spans %d days, over the %d day bound", span, maxCalendarDays)
	}
	// CONTIGUITY, for the identical reason the public path checks it: lose a
	// day to an upstream change and the remaining cells still number in the
	// hundreds and still span under a year, so the day would be zero-filled
	// and the panel would serve a plausible, FRESH, WRONG total.
	if dated != span {
		return nil, fmt.Errorf("contribution calendar: %d dated cells cover a %d day span; the document is missing days", dated, span)
	}
	daily := make([]int, span)
	total := 0
	for offset := range daily {
		daily[offset] = counts[first.AddDate(0, 0, offset).Format(dayLayout)]
		total += daily[offset]
	}
	if total != calendar.Total {
		return nil, fmt.Errorf("contribution calendar: the document reports %d contributions but its days sum to %d", calendar.Total, total)
	}
	return calendarPayload(daily, total, first, last, CoverageComplete)
}

// mapRepository maps ONE repository metadata document onto a served row. The
// document is read through the repositoryEntry projection rather than
// decodeStrict — see that type for why the exception is narrow and why it is
// the stronger privacy posture — so the whole gate lives in the value checks
// below, and any failure refuses the row rather than repairing it.
//
// The name is the caller's, never the document's: an upstream that could name
// the repository could put a stranger's project on the owner's page.
//
// openPulls is the separately read open pull-request tally, or nil when the
// source named no such document or that read failed. It is what SPLITS the
// upstream's one combined open tally into the two figures the card draws, and
// splitOpenWork below refuses the pair outright rather than serving half of a
// derived number.
func mapRepository(raw []byte, name string, openPulls *int64, now time.Time) (CodingProject, error) {
	var entry repositoryEntry
	if err := json.Unmarshal(raw, &entry); err != nil {
		return CodingProject{}, fmt.Errorf("repository document for %s: %w", name, err)
	}
	// The instant check is what makes the projection fail closed. An unrelated
	// JSON object decodes into a zero-valued entry without error; a parseable
	// instant is the cheapest thing no unrelated document has.
	at, err := time.Parse(time.RFC3339, entry.PushedAt)
	if err != nil {
		return CodingProject{}, fmt.Errorf("repository document for %s: push instant %q: %w", name, entry.PushedAt, err)
	}
	if at.After(now.Add(maxCommitFutureSkew)) || at.Before(now.Add(-maxProjectAge)) {
		return CodingProject{}, fmt.Errorf("repository document for %s: push instant %s is outside the plausible window", name, at.UTC().Format(time.RFC3339))
	}
	if entry.Stars < 0 || entry.Stars > maxCountValue {
		return CodingProject{}, fmt.Errorf("repository document for %s: a star tally of %d is outside the admissible range", name, entry.Stars)
	}
	description := ""
	if entry.Description != nil {
		description, err = projectDescription(*entry.Description)
		if err != nil {
			return CodingProject{}, fmt.Errorf("repository document for %s: %w", name, err)
		}
	}
	stars := entry.Stars
	issues, pulls := splitOpenWork(entry.OpenIssues, openPulls)
	return CodingProject{
		Name:        name,
		Description: description,
		Stars:       &stars,
		PushedAt:    at.UTC().Format(time.RFC3339),
		OpenIssues:  issues,
		OpenPulls:   pulls,
	}, nil
}

// splitOpenWork turns the upstream's ONE combined open tally into the two the
// card draws. The repository document counts open pull requests as open
// issues, so the issue figure is the combined tally minus the separately read
// pull-request tally, and it exists only when that second read succeeded.
//
// Both figures are dropped together on anything that does not add up: no
// pull-request tally, a negative or absurd figure on either side, or a
// pull-request count exceeding the combined one — which is a real outcome, not
// a hypothetical, because the two documents are read a moment apart and a
// pull request opened between them lands in the later count only. Every one of
// those refusals reaches the reader as a dash. That is the whole point: a dash
// says "not known", a zero says "none open", and the second is a claim this
// producer is in no position to make.
//
// Refusing the PAIR rather than the ROW is deliberate and it is the additive
// rule doing its job. These fields arrived after the kind shipped; a payload
// without them is valid, so a bad tally costs exactly the tallies and leaves a
// perfectly good description, star count and push instant serving.
func splitOpenWork(combined int64, openPulls *int64) (*int64, *int64) {
	if openPulls == nil {
		return nil, nil
	}
	pulls := *openPulls
	if pulls < 0 || pulls > maxCountValue || combined < pulls || combined > maxCountValue {
		return nil, nil
	}
	issues := combined - pulls
	return &issues, &pulls
}

// mapOpenPullCount reads the open pull-request tally out of a search answer,
// through the searchCountEntry projection and its bound. A document that
// reports no count at all is refused rather than read as zero.
func mapOpenPullCount(raw []byte, name string) (int64, error) {
	var entry searchCountEntry
	if err := json.Unmarshal(raw, &entry); err != nil {
		return 0, fmt.Errorf("pull-request tally for %s: %w", name, err)
	}
	if entry.Total == nil {
		return 0, fmt.Errorf("pull-request tally for %s: the document reports no total", name)
	}
	if *entry.Total < 0 || *entry.Total > maxCountValue {
		return 0, fmt.Errorf("pull-request tally for %s: %d is outside the admissible range", name, *entry.Total)
	}
	return *entry.Total, nil
}

// projectDescription reduces a repository's description to the single line a
// row renders, under exactly the rules commitSubject applies to a commit
// subject: control characters and invalid UTF-8 are REFUSED rather than
// stripped, because quietly repairing hostile input is how the repair becomes
// the vulnerability, while mere length is TRUNCATED with a visible marker,
// because length alone is not hostility.
//
// An empty description is admitted here and refused there, and the difference
// is real: every commit has a subject, so an empty one means a document was
// mis-parsed, while a repository with no description simply has none.
func projectDescription(description string) (string, error) {
	line, _, _ := strings.Cut(description, "\n")
	line = strings.TrimSpace(line)
	runes := make([]rune, 0, len(line))
	for _, symbol := range line {
		if symbol < 0x20 || symbol == 0x7f {
			return "", errors.New("a description carries control characters")
		}
		if symbol == '�' {
			return "", errors.New("a description is not valid UTF-8")
		}
		runes = append(runes, symbol)
	}
	if len(runes) > maxProjectDescriptionRunes {
		return string(runes[:maxProjectDescriptionRunes]) + "…", nil
	}
	return string(runes), nil
}

// mergeProjectRows assembles the served payload in CONFIG order: the freshly
// read row where a repository answered, that repository's shipped snapshot row
// otherwise, marked recorded so a reader is told which is which. The result is
// fresh only when every configured repository answered.
//
// A repository the snapshot has never heard of degrades to a row carrying its
// name and nothing else — a null tally the frontend dashes, no description,
// no instant — rather than to a row silently borrowing another's figures.
func mergeProjectRows(spec *codingProjectsFetchSpec, fetched map[string]CodingProject, fallback CodingProjectsData) (CodingProjectsData, bool) {
	fallbackByName := make(map[string]CodingProject, len(fallback.Repos))
	for _, repo := range fallback.Repos {
		fallbackByName[repo.Name] = repo
	}
	merged := CodingProjectsData{Repos: make([]CodingProject, 0, len(spec.Sources))}
	allFresh := true
	for _, source := range spec.Sources {
		if live, ok := fetched[source.Name]; ok {
			merged.Repos = append(merged.Repos, live)
			continue
		}
		allFresh = false
		recorded := fallbackByName[source.Name]
		recorded.Name = source.Name
		recorded.Recorded = true
		merged.Repos = append(merged.Repos, recorded)
	}
	return merged, allFresh
}

// calendarCellMark is the class the upstream marks a calendar day cell with.
// It lives here as the one piece of upstream markup vocabulary the scanner
// needs; a change to it is upstream drift, and the minCalendarDays floor
// turns that drift into a refused document rather than an empty calendar.
const calendarCellMark = `class="ContributionCalendar-day"`

// chunkWeeks slices contiguous daily counts into seven-day columns, padding
// the final column with zeros. Padding is indistinguishable from a real
// quiet day on its own, which is exactly why the payload also carries
// EndDate: the frontend draws days past it as holes.
func chunkWeeks(daily []int) [][]int {
	weeks := make([][]int, 0, (len(daily)+daysPerWeek-1)/daysPerWeek)
	for start := 0; start < len(daily); start += daysPerWeek {
		week := make([]int, daysPerWeek)
		copy(week, daily[start:min(start+daysPerWeek, len(daily))])
		weeks = append(weeks, week)
	}
	return weeks
}

// contributionStreak reuses the token panel's streak rule so both surfaces
// answer "how many days in a row" identically: one quiet trailing day is
// tolerated because the newest day is still in progress, two end the run.
func contributionStreak(daily []int) int64 {
	totals := make([]int64, len(daily))
	for index, count := range daily {
		totals[index] = int64(count)
	}
	current, _ := dailyStreaks(totals)
	return current
}

// scanTags returns every complete "<... mark ...>" tag body in document.
// Deliberately minimal: this is not an HTML parser and must never grow into
// one — it locates attribute-bearing tags by an exact marker and hands each
// tag's raw text to attributeValue.
func scanTags(document, mark string) []string {
	tags := make([]string, 0, maxCalendarDays)
	for offset := 0; ; {
		found := strings.Index(document[offset:], mark)
		if found < 0 {
			return tags
		}
		at := offset + found
		start := strings.LastIndex(document[:at], "<")
		end := strings.Index(document[at:], ">")
		offset = at + len(mark)
		if start < 0 || end < 0 {
			continue
		}
		tags = append(tags, document[start:at+end])
	}
}

// attributeValue reads one double-quoted attribute out of a tag body.
func attributeValue(tag, name string) (string, bool) {
	marker := name + `="`
	at := strings.Index(tag, marker)
	if at < 0 {
		return "", false
	}
	rest := tag[at+len(marker):]
	end := strings.Index(rest, `"`)
	if end < 0 {
		return "", false
	}
	return rest[:end], true
}

// labelledCount reads the count out of the label element bound to one cell.
// The label is the ONLY place the exact number appears — the cell itself
// carries a coarse level — so a cell whose label is missing or unreadable is
// an error, never a zero.
func labelledCount(document, id string) (int, error) {
	marker := `for="` + id + `"`
	at := strings.Index(document, marker)
	if at < 0 {
		return 0, fmt.Errorf("contribution calendar: cell %s has no label", id)
	}
	open := strings.Index(document[at:], ">")
	if open < 0 {
		return 0, fmt.Errorf("contribution calendar: cell %s has an unterminated label", id)
	}
	text := document[at+open+1:]
	close := strings.Index(text, "<")
	if close < 0 {
		return 0, fmt.Errorf("contribution calendar: cell %s has an unterminated label", id)
	}
	return countFromLabel(strings.TrimSpace(text[:close]), id)
}

// countFromLabel reads the leading count out of a cell label. The upstream
// writes either a word for "none" or a grouped number, both followed by the
// counted noun; anything else is drift and is refused.
func countFromLabel(label, id string) (int, error) {
	head, _, found := strings.Cut(label, " ")
	if !found || head == "" {
		return 0, fmt.Errorf("contribution calendar: cell %s label %q is not a count", id, label)
	}
	if strings.EqualFold(head, "no") {
		return 0, nil
	}
	digits := strings.ReplaceAll(head, ",", "")
	count, err := strconv.Atoi(digits)
	if err != nil || count < 0 {
		return 0, fmt.Errorf("contribution calendar: cell %s label %q is not a count", id, label)
	}
	return count, nil
}

// mapCommits maps ONE repository's public commit document onto dated panel
// rows. The document is read through the commitListEntry projection rather
// than decodeStrict — see that type for why the exception is narrow and why it
// is the stronger privacy posture — so the whole gate lives in the value
// checks below. Every one of them refuses the WHOLE document rather than
// dropping a row, because a document that half-parses is drift, and a
// half-parsed commit list looks exactly like a quiet week.
//
// The repo label is the caller's, never the document's: an upstream that could
// name the repository could attribute a stranger's commit to the owner.
func mapCommits(raw []byte, repo string, now time.Time) ([]datedCommit, error) {
	var entries []commitListEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, fmt.Errorf("commit document for %s: %w", repo, err)
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("commit document for %s reports no commits at all", repo)
	}
	if len(entries) > maxCommitDocumentItems {
		return nil, fmt.Errorf("commit document for %s carries %d rows, over the %d bound", repo, len(entries), maxCommitDocumentItems)
	}
	rows := make([]datedCommit, 0, len(entries))
	for _, entry := range entries {
		// The identity check is what makes the projection fail closed. An
		// unrelated JSON array decodes into zero-valued entries without error;
		// a 40-hex identity is the cheapest thing no unrelated document has.
		if !isCommitIdentity(entry.SHA) {
			return nil, fmt.Errorf("commit document for %s: a row carries no commit identity", repo)
		}
		subject, err := commitSubject(entry.Commit.Message)
		if err != nil {
			return nil, fmt.Errorf("commit document for %s: %w", repo, err)
		}
		at, err := time.Parse(time.RFC3339, entry.Commit.Author.Date)
		if err != nil {
			return nil, fmt.Errorf("commit document for %s: commit instant %q: %w", repo, entry.Commit.Author.Date, err)
		}
		if at.After(now.Add(maxCommitFutureSkew)) || at.Before(now.Add(-maxCommitAge)) {
			return nil, fmt.Errorf("commit document for %s: commit instant %s is outside the plausible window", repo, at.UTC().Format(time.RFC3339))
		}
		rows = append(rows, datedCommit{
			at:  at,
			row: VCSCommit{Repo: repo, SHA: entry.SHA, Message: subject, At: at.UTC().Format(time.RFC3339)},
		})
	}
	return rows, nil
}

// isCommitIdentity reports whether s is a full lowercase hexadecimal commit
// identity. Case matters: the upstream writes lowercase, and accepting other
// spellings would accept documents that are not the one being modeled.
func isCommitIdentity(s string) bool {
	if len(s) != shaHexDigits {
		return false
	}
	for _, digit := range s {
		switch {
		case digit >= '0' && digit <= '9', digit >= 'a' && digit <= 'f':
		default:
			return false
		}
	}
	return true
}

// commitSubject reduces a commit message to the single line a panel row
// renders. Three refusals and one truncation, each chosen deliberately:
//
//   - An empty subject is refused. Every real commit has one, and a row with
//     no text is exactly what a silently mis-parsed document produces.
//   - Control characters are refused rather than stripped. A subject carrying
//     them is not a subject, and quietly repairing hostile input is how the
//     repair becomes the vulnerability.
//   - The replacement rune is refused. Ranging a Go string yields it for every
//     byte that is not valid UTF-8, so this one check covers both a
//     mis-encoded document and the rare literal U+FFFD — without reaching for
//     an import outside this package's reviewed zero-egress surface.
//   - A long subject is TRUNCATED with a visible marker rather than refused,
//     because length alone is not hostility and refusing would lose a real
//     commit over a verbose one.
func commitSubject(message string) (string, error) {
	subject, _, _ := strings.Cut(message, "\n")
	subject = strings.TrimSpace(subject)
	if subject == "" {
		return "", errors.New("a row carries no commit subject")
	}
	runes := make([]rune, 0, len(subject))
	for _, symbol := range subject {
		if symbol < 0x20 || symbol == 0x7f {
			return "", errors.New("a commit subject carries control characters")
		}
		if symbol == '�' {
			return "", errors.New("a commit subject is not valid UTF-8")
		}
		runes = append(runes, symbol)
	}
	if len(runes) > maxCommitMessageRunes {
		return string(runes[:maxCommitMessageRunes]) + "…", nil
	}
	return string(runes), nil
}

// mergeCommits orders rows newest first across every repository and truncates
// to the smaller of the configured limit and maxServedCommits. The sort is a
// bounded insertion — a handful of rows, no import, and stable for equal
// instants, so two commits sharing a second keep the order their documents
// gave them.
func mergeCommits(dated []datedCommit, limit int) []VCSCommit {
	if limit <= 0 || limit > maxServedCommits {
		limit = maxServedCommits
	}
	ordered := make([]datedCommit, 0, limit)
	for _, candidate := range dated {
		at := len(ordered)
		for at > 0 && ordered[at-1].at.Before(candidate.at) {
			at--
		}
		if at >= limit {
			continue
		}
		if len(ordered) < limit {
			ordered = append(ordered, datedCommit{})
		}
		copy(ordered[at+1:], ordered[at:])
		ordered[at] = candidate
	}
	rows := make([]VCSCommit, 0, len(ordered))
	for _, entry := range ordered {
		rows = append(rows, entry.row)
	}
	return rows
}

// mapUsage maps one source's upstream usage document into everything the
// panel renders from live data: the today/week windows, the daily activity
// series behind the grid, and the stat tiles a series can honestly support.
// Figures no usage API reports — a lifetime total, a longest single task,
// behavioral insights — are deliberately absent here; they arrive from the
// recorded snapshot section and keep their own provenance flag.
func mapUsage(shape string, raw []byte) (usageMapping, error) {
	buckets, err := decodeUsageBuckets(shape, raw)
	if err != nil {
		return usageMapping{}, err
	}
	if len(buckets) == 0 {
		return usageMapping{}, fmt.Errorf("usage document for shape %q carries no buckets", shape)
	}
	latest := buckets[len(buckets)-1]
	week := tokenBucket{}
	for _, bucket := range buckets {
		week.input += bucket.input
		week.output += bucket.output
	}
	series, err := dailySeries(buckets)
	if err != nil {
		return usageMapping{}, err
	}
	current, longest := dailyStreaks(series.Totals)
	peak := int64(0)
	for _, total := range series.Totals {
		if total > peak {
			peak = total
		}
	}
	windowTotal := week.input + week.output
	return usageMapping{
		windows: []TokenUsageWindow{
			{Period: "today", InputTokens: latest.input, OutputTokens: latest.output},
			{Period: "week", InputTokens: week.input, OutputTokens: week.output},
		},
		series: series,
		stats: []TokenUsageStat{
			{Key: statCurrentStreak, Label: "Current streak", Value: &current, Unit: UnitDays},
			{Key: statLongestStreak, Label: "Longest streak", Value: &longest, Unit: UnitDays},
			{Key: statPeakDay, Label: "Peak day", Value: &peak, Unit: UnitTokens},
			{Key: statWindowTotal, Label: "Window tokens", Value: &windowTotal, Unit: UnitTokens},
		},
	}, nil
}

// decodeUsageBuckets admits one upstream document through the strict gate and
// flattens it into dated daily buckets, so the two vendor grammars converge
// on one shape before any panel arithmetic touches them.
func decodeUsageBuckets(shape string, raw []byte) ([]tokenBucket, error) {
	var buckets []tokenBucket
	switch shape {
	case shapeUsageReport:
		var document usageReportDocument
		if err := decodeStrict(raw, &document); err != nil {
			return nil, fmt.Errorf("usage-report document: %w", err)
		}
		for _, bucket := range document.Data {
			day, err := time.Parse(time.RFC3339, bucket.StartingAt)
			if err != nil {
				return nil, fmt.Errorf("usage-report bucket start: %w", err)
			}
			totals := tokenBucket{day: day.UTC().Format(dayLayout)}
			for _, result := range bucket.Results {
				totals.input += result.UncachedInputTokens +
					result.CacheReadInputTokens +
					result.CacheCreation.Ephemeral5mInputTokens +
					result.CacheCreation.Ephemeral1hInputTokens
				totals.output += result.OutputTokens
			}
			buckets = append(buckets, totals)
		}
	case shapeUsagePage:
		var document usagePageDocument
		if err := decodeStrict(raw, &document); err != nil {
			return nil, fmt.Errorf("usage-page document: %w", err)
		}
		for _, bucket := range document.Data {
			totals := tokenBucket{day: time.Unix(bucket.StartTime, 0).UTC().Format(dayLayout)}
			for _, result := range bucket.Results {
				totals.input += result.InputTokens
				totals.output += result.OutputTokens
			}
			buckets = append(buckets, totals)
		}
	default:
		return nil, fmt.Errorf("unknown usage response shape %q", shape)
	}
	return buckets, nil
}

// dailySeries turns dated buckets into the contiguous day-indexed series the
// activity grid renders: one combined total per calendar day from the oldest
// bucket to the newest, zeros for days the upstream skipped, and repeated
// days summed rather than refused — bucket ORDER and bucket GRANULARITY are
// upstream choices, and neither should be able to break a chart. Only a span
// beyond maxSeriesDays is refused, keeping the last good payload instead of
// inflating one against the owner's budget.
func dailySeries(buckets []tokenBucket) (*TokenUsageSeries, error) {
	totalsByDay := make(map[string]int64, len(buckets))
	var first, last time.Time
	for index, bucket := range buckets {
		day, err := time.Parse(dayLayout, bucket.day)
		if err != nil {
			return nil, fmt.Errorf("usage series day: %w", err)
		}
		totalsByDay[bucket.day] += bucket.input + bucket.output
		if index == 0 || day.Before(first) {
			first = day
		}
		if index == 0 || day.After(last) {
			last = day
		}
	}
	span := int(last.Sub(first)/(24*time.Hour)) + 1
	if span > maxSeriesDays {
		return nil, fmt.Errorf("usage series spans %d days, over the %d day bound", span, maxSeriesDays)
	}
	totals := make([]int64, span)
	for offset := range totals {
		totals[offset] = totalsByDay[first.AddDate(0, 0, offset).Format(dayLayout)]
	}
	return &TokenUsageSeries{StartDate: first.Format(dayLayout), Totals: totals}, nil
}

// dailyStreaks reports the current and longest runs of consecutive days with
// any consumption. The current run tolerates ONE trailing empty day, because
// the newest bucket is the day in progress and an hour of quiet is not a
// broken streak; two empty days end it.
func dailyStreaks(totals []int64) (current, longest int64) {
	run := int64(0)
	for _, total := range totals {
		if total > 0 {
			run++
			if run > longest {
				longest = run
			}
			continue
		}
		run = 0
	}
	end := len(totals)
	if end > 0 && totals[end-1] == 0 {
		end--
	}
	for index := end - 1; index >= 0 && totals[index] > 0; index-- {
		current++
	}
	return current, longest
}

// usageMapping is one source's complete live contribution: the windows, the
// daily series, and the stats a series can support on its own.
type usageMapping struct {
	windows []TokenUsageWindow
	series  *TokenUsageSeries
	stats   []TokenUsageStat
}

// tokenBucket is one summed bucket during mapping, tagged with the calendar
// day it covers so both upstream grammars can feed one dated series.
type tokenBucket struct {
	day    string
	input  int64
	output int64
}

// mergeUsagePayload assembles the served token-usage payload in config
// order: the freshly mapped live section where a source succeeded, that
// source's recorded snapshot section otherwise. A source that DID fetch also
// keeps the recorded figures no usage API reports — the lifetime total, the
// longest single task, the behavioral insights — beside its live ones, each
// still carrying the provenance flag that says where it came from. The
// result is fresh only when every configured source fetched.
func mergeUsagePayload(spec *tokenUsageFetchSpec, fetched map[string]usageMapping, fallback TokenUsageData) (TokenUsageData, bool) {
	fallbackByLabel := make(map[string]TokenUsageSource, len(fallback.Sources))
	for _, source := range fallback.Sources {
		fallbackByLabel[source.Label] = source
	}
	merged := TokenUsageData{Sources: make([]TokenUsageSource, 0, len(spec.Sources))}
	allFresh := true
	for _, source := range spec.Sources {
		recorded := fallbackByLabel[source.Label]
		recorded.Label = source.Label
		live, ok := fetched[source.Label]
		if !ok {
			allFresh = false
			merged.Sources = append(merged.Sources, recorded)
			continue
		}
		merged.Sources = append(merged.Sources, TokenUsageSource{
			Label:    source.Label,
			Account:  recorded.Account,
			Windows:  live.windows,
			Stats:    mergeStats(recorded.Stats, live.stats),
			Series:   live.series,
			Insights: recorded.Insights,
		})
	}
	return merged, allFresh
}

// mergeStats overlays live tiles onto the recorded ones by key: a recorded
// figure the live feed can compute is replaced IN PLACE, so the owner's tile
// order survives a refresh, and a live figure with no recorded counterpart is
// appended after them.
func mergeStats(recorded, live []TokenUsageStat) []TokenUsageStat {
	byKey := make(map[string]TokenUsageStat, len(live))
	for _, stat := range live {
		byKey[stat.Key] = stat
	}
	// Capacity is a hint, not a bound: sizing it from one slice keeps the
	// hint useful while keeping the arithmetic obviously non-overflowing
	// (CodeQL go/allocation-size-overflow), and append covers the rest.
	merged := make([]TokenUsageStat, 0, len(recorded))
	replaced := make(map[string]bool, len(live))
	for _, stat := range recorded {
		if fresh, ok := byKey[stat.Key]; ok {
			replaced[stat.Key] = true
			merged = append(merged, fresh)
			continue
		}
		merged = append(merged, stat)
	}
	for _, stat := range live {
		if !replaced[stat.Key] {
			merged = append(merged, stat)
		}
	}
	return merged
}

// windowStart renders the lookback instant in the format the endpoint's
// grammar requires.
func windowStart(spec windowParamSpec, now time.Time) string {
	start := now.AddDate(0, 0, -spec.LookbackDays).UTC()
	if spec.Format == windowFormatUnix {
		return fmt.Sprintf("%d", start.Unix())
	}
	return start.Format(time.RFC3339)
}
