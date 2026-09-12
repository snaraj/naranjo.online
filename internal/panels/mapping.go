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
	// 2) — both live in graphQLPayload now, which every credentialed producer
	// enters through. The ENVELOPE is read leniently, because it is the
	// protocol's own wrapper and the protocol may add top-level siblings to it
	// — `extensions` above all — that this package never reads a value out of.
	// The PAYLOAD is read strictly, because it is the shape this package maps
	// field by field and an unknown field there is drift it has
	// half-understood. An answer carrying neither errors nor data is not a
	// calendar: Data is nil there and decodeStrict refuses nil, which is the
	// FIRST refusal rather than the only one — the minimum-days floor below
	// catches an empty calendar too.
	var data calendarData
	if err := graphQLPayload(raw, "contribution calendar", &data); err != nil {
		return nil, err
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

// isRepositoryName admits a repository name through the code host's own
// grammar: letters, digits, dots, underscores, and dashes, bounded in length,
// and never a filesystem dot name. It is THE gate that makes a listing-chosen
// name safe to serve and safe for the frontend to build an owner-account link
// from — a name outside it never came from the host and is treated as
// hostility, not data.
func isRepositoryName(name string) bool {
	if name == "" || name == "." || name == ".." || len(name) > maxRepositoryNameRunes {
		return false
	}
	for _, symbol := range name {
		switch {
		case symbol >= 'a' && symbol <= 'z',
			symbol >= 'A' && symbol <= 'Z',
			symbol >= '0' && symbol <= '9',
			symbol == '.', symbol == '_', symbol == '-':
		default:
			return false
		}
	}
	return true
}

// isAccountLogin admits an account login: letters, digits, and dashes, the
// host's own grammar. Stricter than the repository grammar — no dot, no
// underscore — because logins are.
func isAccountLogin(login string) bool {
	if login == "" || len(login) > 39 {
		return false
	}
	for _, symbol := range login {
		switch {
		case symbol >= 'a' && symbol <= 'z',
			symbol >= 'A' && symbol <= 'Z',
			symbol >= '0' && symbol <= '9',
			symbol == '-':
		default:
			return false
		}
	}
	return true
}

// mapRepositoryListing maps the account's public repository listing onto the
// rows one round serves: admitted rows most recently pushed first, capped at
// maxCodingProjectSources, beside the names of rows refused by their value
// checks so the caller can narrate each one.
//
// The document is read through the repositoryListingEntry projection rather
// than decodeStrict — see that type for why the exception is narrow and why
// it is the stronger privacy posture — so the whole gate lives in the checks
// here, in two tiers with different blast radii:
//
//   - IDENTITY violations refuse the WHOLE document: a name outside the
//     host's grammar, a row belonging to any other account, a private row, or
//     a duplicate name is not a bad row in a good listing, it is a document
//     that did not come from the account's public listing at all.
//   - VALUE failures refuse the ROW: an implausible push instant, an absurd
//     tally, or an unprintable description drops that repository from the
//     round, named in the refusal list, and the caller reports the envelope
//     stale — a roster short one repository must not claim to be ok.
//
// Two skips are neither: an EXCLUDED name is the owner's curation doing its
// job, and a row with no push instant is a repository with no activity to
// report — no claim, no row, no staleness.
func mapRepositoryListing(raw []byte, spec *codingProjectsFetchSpec, now time.Time) ([]listedProject, []refusedRow, error) {
	var entries []repositoryListingEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, nil, fmt.Errorf("repository listing: %w", err)
	}
	candidates := make([]listingCandidate, 0, len(entries))
	for _, entry := range entries {
		candidates = append(candidates, listingCandidate{
			name:        entry.Name,
			owner:       entry.Owner.Login,
			private:     entry.Private,
			description: entry.Description,
			stars:       entry.Stars,
			pushedAt:    entry.PushedAt,
		})
	}
	return admitRepositories(candidates, spec, now)
}

// mapRepositoryQuery maps the CREDENTIALED repository answer (issue #317) onto
// the same rows through the same gate. It exists because the public listing
// document carries neither the released version nor the all-time closed
// pull-request tally the owner's columns ask for, and the alternative — one
// request per repository per refresh — is the fan-out this package refuses
// everywhere else.
//
// It adds exactly two value checks to the shared admission: a release tag must
// sit inside the host's own tag grammar, and a pull-request tally must be a
// plausible non-negative figure. Both fail the ROW rather than the document,
// for the same reason every other value check here does.
func mapRepositoryQuery(raw []byte, spec *codingProjectsFetchSpec, now time.Time) ([]listedProject, []refusedRow, error) {
	var data repositoriesData
	if err := graphQLPayload(raw, "repository query", &data); err != nil {
		return nil, nil, err
	}
	// The document asks the credential's OWN account for the repositories it
	// owns, so every row is stamped with the configured account below — which
	// is only honest if the credential belongs to that account. The answer
	// says whose it is, and a credential minted for another account refuses
	// the document rather than listing a stranger's repositories under the
	// owner's link host. The login is not repeated in the refusal.
	if data.Viewer.Login != spec.Account {
		return nil, nil, errors.New("repository query: the credential does not belong to the configured account")
	}
	// The pinned set is matched by NAME against the listing below, and a
	// pinned name the listing does not carry is simply not matched: a pin is a
	// mark on a row that exists, never a row of its own. A PRIVATE pin is
	// dropped before the match for the same reason every private repository is
	// dropped — its name is not this panel's to hold (requirement 12) — and a
	// name outside the host's grammar is dropped rather than refusing the
	// document, because the pinned set is decoration on a roster the identity
	// tier already gates.
	pinned := make(map[string]bool, len(data.Viewer.PinnedItems.Nodes))
	for _, node := range data.Viewer.PinnedItems.Nodes {
		if node.Name == "" || node.Private || !isRepositoryName(node.Name) {
			continue
		}
		pinned[node.Name] = true
	}
	nodes := data.Viewer.Repositories.Nodes
	candidates := make([]listingCandidate, 0, len(nodes))
	for _, node := range nodes {
		candidate := listingCandidate{
			name:        node.Name,
			owner:       spec.Account,
			private:     node.Private,
			description: node.Description,
			stars:       node.Stars,
			pushedAt:    node.PushedAt,
			pulls:       &node.PullRequests.TotalCount,
			pinned:      pinned[node.Name],
		}
		if node.LatestRelease != nil {
			candidate.release = node.LatestRelease.TagName
		}
		candidates = append(candidates, candidate)
	}
	return admitRepositories(candidates, spec, now)
}

// listingCandidate is one repository as either producer read it, before
// admission. It exists so the two documents converge on ONE gate: the owner's
// ruling about which repositories may appear, and every value check behind it,
// is decided in one place rather than once per upstream grammar.
//
// The OWNER is the reading producer's claim about who the row belongs to. The
// public listing reports it per row and it is checked; the credentialed query
// asks the credential's own account for repositories it OWNS, verifies that
// the account answering is the configured one, and the field then carries the
// configured account.
type listingCandidate struct {
	name        string
	owner       string
	private     bool
	description *string
	stars       int64
	pushedAt    string
	// pulls is the all-time merged-or-closed tally, or nil from a producer
	// that reports none — which the row serves as absent and the page as a
	// dash, never as a zero.
	pulls *int64
	// release is the latest release tag, empty for a repository that has
	// never released or a producer that cannot read one.
	release string
	// pinned marks a row the owner pinned on the host; false from a producer
	// that cannot read the pinned set, which is the public listing.
	pinned bool
}

func admitRepositories(entries []listingCandidate, spec *codingProjectsFetchSpec, now time.Time) ([]listedProject, []refusedRow, error) {
	if len(entries) == 0 {
		return nil, nil, errors.New("repository listing: the document lists no repository at all")
	}
	if len(entries) > maxListedRepositories {
		return nil, nil, fmt.Errorf("repository listing: %d entries is over the %d bound", len(entries), maxListedRepositories)
	}
	excluded := make(map[string]bool, len(spec.Exclude))
	for _, name := range spec.Exclude {
		excluded[name] = true
	}
	seen := make(map[string]bool, len(entries))
	ordered := make([]listedProject, 0, len(entries))
	refused := make([]refusedRow, 0, 2)
	for _, entry := range entries {
		if !isRepositoryName(entry.name) {
			return nil, nil, fmt.Errorf("repository listing: a name is outside the host's grammar")
		}
		if entry.owner != spec.Account {
			return nil, nil, fmt.Errorf("repository listing: a row does not belong to the configured account")
		}
		if entry.private {
			// Unnamed on purpose: the refusal is logged, and a name the
			// document calls private is not this panel's to hold anywhere.
			return nil, nil, errors.New("repository listing: a row claims to be private; the public listing may not carry it")
		}
		if seen[entry.name] {
			return nil, nil, fmt.Errorf("repository listing: %s is listed twice", entry.name)
		}
		seen[entry.name] = true
		if excluded[entry.name] {
			continue
		}
		if entry.pushedAt == "" {
			continue
		}
		project, err := admitListedRepository(entry, now)
		if err != nil {
			refused = append(refused, refusedRow{name: entry.name, err: err})
			continue
		}
		// Insertion by recency, newest first with the name as the
		// deterministic tie-break. The CAP is applied afterwards, because
		// which rows it may drop depends on the whole roster.
		at := len(ordered)
		for at > 0 && earlierListing(ordered[at-1], project) {
			at--
		}
		ordered = append(ordered, listedProject{})
		copy(ordered[at+1:], ordered[at:])
		ordered[at] = project
	}
	if len(ordered) == 0 {
		return nil, nil, errors.New("repository listing: no row survived admission")
	}
	return servedRepositories(ordered), refused, nil
}

// servedRepositories applies the row cap to a recency-ordered roster: every
// PINNED row survives it, the newest unpinned rows fill whatever is left, and
// the result keeps the recency order it arrived in.
//
// Keeping the pins is what makes the owner's curation reachable rather than
// nearly reachable (owner directive, 2026-09-11). The page lists the pinned
// repositories; a pin that fell off a recency cap because a handful of other
// repositories happened to be pushed today would be a card that vanished for a
// reason nobody could see. The cap itself is unchanged, and it is still a
// clamp rather than a refusal: a thirteenth repository must not take the panel
// down, and the payload budget still has to fit.
func servedRepositories(ordered []listedProject) []listedProject {
	if len(ordered) <= maxCodingProjectSources {
		return ordered
	}
	served := make([]listedProject, 0, maxCodingProjectSources)
	room := maxCodingProjectSources
	for _, project := range ordered {
		if project.row.Pinned {
			room--
		}
	}
	for _, project := range ordered {
		if !project.row.Pinned {
			if room <= 0 {
				continue
			}
			room--
		}
		served = append(served, project)
		if len(served) == maxCodingProjectSources {
			break
		}
	}
	return served
}

// earlierListing reports whether have should sit AFTER candidate: it was
// pushed earlier, or at the same instant with the later name.
func earlierListing(have, candidate listedProject) bool {
	if have.at.Equal(candidate.at) {
		return have.row.Name > candidate.row.Name
	}
	return have.at.Before(candidate.at)
}

// admitListedRepository runs one row's value checks and builds the served row.
// The two figures issue #317 added are admitted here beside the ones that were
// already: a tally outside the plausible range and a tag outside the host's
// own tag grammar each fail the ROW, which the page then draws as a dash —
// "not known", which is true, rather than a zero or a version nobody released.
func admitListedRepository(entry listingCandidate, now time.Time) (listedProject, error) {
	at, err := time.Parse(time.RFC3339, entry.pushedAt)
	if err != nil {
		return listedProject{}, fmt.Errorf("push instant %q: %w", entry.pushedAt, err)
	}
	if at.After(now.Add(maxCommitFutureSkew)) || at.Before(now.Add(-maxProjectAge)) {
		return listedProject{}, fmt.Errorf("push instant %s is outside the plausible window", at.UTC().Format(time.RFC3339))
	}
	if entry.stars < 0 || entry.stars > maxCountValue {
		return listedProject{}, fmt.Errorf("a star tally of %d is outside the admissible range", entry.stars)
	}
	description := ""
	if entry.description != nil {
		description, err = projectDescription(*entry.description)
		if err != nil {
			return listedProject{}, err
		}
	}
	row := CodingProject{
		Name:        entry.name,
		Description: description,
		Stars:       &entry.stars,
		PushedAt:    at.UTC().Format(time.RFC3339),
		Pinned:      entry.pinned,
	}
	if entry.pulls != nil {
		if *entry.pulls < 0 || *entry.pulls > maxCountValue {
			return listedProject{}, fmt.Errorf("a closed pull-request tally of %d is outside the admissible range", *entry.pulls)
		}
		row.ClosedPulls = entry.pulls
	}
	if entry.release != "" {
		if !isReleaseTag(entry.release) {
			return listedProject{}, fmt.Errorf("a release tag is outside the host's tag grammar")
		}
		row.Release = entry.release
	}
	return listedProject{row: row, at: at}, nil
}

// isReleaseTag admits a release tag through the shape a version word actually
// has: letters, digits, dots, underscores and dashes, bounded, never a
// filesystem dot name. The cell prints it verbatim, so this is what stops an
// upstream from printing a sentence, a control character, or a path where a
// version belongs.
func isReleaseTag(tag string) bool {
	if tag == "." || tag == ".." || len(tag) > maxReleaseTagRunes {
		return false
	}
	for _, symbol := range tag {
		switch {
		case symbol >= '0' && symbol <= '9',
			symbol >= 'a' && symbol <= 'z',
			symbol >= 'A' && symbol <= 'Z',
			symbol == '.', symbol == '_', symbol == '-':
		default:
			return false
		}
	}
	return true
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

// graphQLPayload unwraps ONE credentialed query answer: the protocol envelope
// read leniently, the payload read strictly, and the upstream's own refusal
// reported as one. Every credentialed producer in this package enters through
// it, so "the envelope may grow siblings, the data may not" is decided once
// rather than re-argued per document (see graphQLDocument for the full reason).
func graphQLPayload(raw []byte, what string, into any) error {
	var document graphQLDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		return fmt.Errorf("%s: %w", what, err)
	}
	if len(document.Errors) > 0 {
		// The upstream answers a refused credential, a missing scope, or a
		// malformed query with a 200 carrying this array. The COUNT is the
		// whole signal; the messages are upstream-authored prose and never
		// enter this process's narrative.
		return fmt.Errorf("%s: the upstream refused the query with %d error(s)", what, len(document.Errors))
	}
	if err := decodeStrict(document.Data, into); err != nil {
		return fmt.Errorf("%s: %w", what, err)
	}
	return nil
}

// mapCommitContributions maps the DISCOVERY answer onto three things the
// second half of the round needs: the account's own node identity, the PUBLIC
// repositories it committed to over the window (newest activity first, capped
// by recency), and the per-day PRIVATE aggregate that is all a private
// repository will ever contribute to this panel.
//
// Everything here refuses the WHOLE document rather than dropping an entry,
// because this document decides both what is asked next and what is counted:
// a half-understood discovery answer produces a log that looks like a quiet
// month rather than a broken read.
//
// Three gates carry the weight:
//
//   - PRIVACY. A repository flagged private is counted into its days and is
//     never named, never identified, and never asked about in the second
//     document. A name that appears both private and public under ONE owner
//     is not a bad row in a good document — it is a document that cannot be
//     trusted about which is which — so it refuses everything. The same name
//     under two owners is a fork beside its upstream, which the host reports
//     routinely, and is two repositories. Every refusal below names the entry
//     by its POSITION in the document and never by its name: a refusal is
//     logged, the entry it refuses may be the private one, and requirement 12
//     holds for log lines exactly as it holds for the wire.
//   - IDENTITY. A name outside the host's own grammar, or an owner login that
//     is not the configured account, never becomes a named row. Foreign
//     repositories are legitimate — the account contributes to other people's
//     work — so they are COUNTED toward the document's own total and simply
//     not listed, which is the difference between curation and a lie.
//   - ARITHMETIC. The document reports its own commit total beside the days,
//     and the days must sum to exactly it. That is the same cross-field
//     integrity rule mapCalendarDocument rests on, and it is what catches a
//     truncated repository list or a silently dropped bucket: serving either
//     of two disagreeing figures would be picking which claim to publish.
func mapCommitContributions(raw []byte, owner string, now time.Time) (string, []contributionRepo, []VCSPrivateDay, error) {
	var data contributionsData
	if err := graphQLPayload(raw, "commit contributions", &data); err != nil {
		return "", nil, nil, err
	}
	viewer := data.Viewer
	if !isNodeIdentifier(viewer.ID) {
		return "", nil, nil, errors.New("commit contributions: the document carries no account identity")
	}
	collection := viewer.Contributions
	if len(collection.Repositories) > maxContributionRepositories {
		return "", nil, nil, fmt.Errorf("commit contributions: %d repositories reported, over the %d bound", len(collection.Repositories), maxContributionRepositories)
	}
	oldest := now.Add(-commitLogWindowDays * 24 * time.Hour).Add(-contributionWindowSlack)
	newest := now.Add(maxCommitFutureSkew)
	privateDays := make(map[string]*VCSPrivateDay, commitLogWindowDays)
	type repositoryKey struct{ owner, name string }
	seen := make(map[repositoryKey]bool, len(collection.Repositories))
	candidates := make([]contributionRepo, 0, len(collection.Repositories))
	total := 0
	for index, entry := range collection.Repositories {
		reference := entry.Repository
		position := index + 1
		if !isRepositoryName(reference.Name) {
			return "", nil, nil, fmt.Errorf("commit contributions: entry %d carries a name outside the host's grammar", position)
		}
		key := repositoryKey{owner: reference.Owner.Login, name: reference.Name}
		if seen[key] {
			return "", nil, nil, fmt.Errorf("commit contributions: entry %d appears twice", position)
		}
		seen[key] = true
		if !isNodeIdentifier(reference.ID) {
			return "", nil, nil, fmt.Errorf("commit contributions: entry %d carries no node identity", position)
		}
		days := entry.Contributions.Nodes
		if len(days) > maxContributionDays {
			return "", nil, nil, fmt.Errorf("commit contributions: entry %d reports %d dated buckets, over the %d bound", position, len(days), maxContributionDays)
		}
		var latest time.Time
		counted := 0
		for _, day := range days {
			at, err := time.Parse(time.RFC3339, day.OccurredAt)
			if err != nil {
				// Not wrapped: the parse error quotes the upstream's own bytes,
				// and this entry may be the private one (requirement 12).
				return "", nil, nil, fmt.Errorf("commit contributions: entry %d carries a bucket instant that does not parse", position)
			}
			if at.Before(oldest) || at.After(newest) {
				return "", nil, nil, fmt.Errorf("commit contributions: entry %d carries a bucket at %s, outside the requested window", position, at.UTC().Format(time.RFC3339))
			}
			if day.CommitCount < 0 {
				return "", nil, nil, fmt.Errorf("commit contributions: entry %d reports a negative count", position)
			}
			total += day.CommitCount
			counted += day.CommitCount
			if at.After(latest) {
				latest = at
			}
			if !reference.Private || day.CommitCount == 0 {
				continue
			}
			key := at.UTC().Format(dayLayout)
			aggregate, known := privateDays[key]
			if !known {
				aggregate = &VCSPrivateDay{Date: key}
				privateDays[key] = aggregate
			}
			aggregate.Contributions += day.CommitCount
			aggregate.Repositories++
		}
		if reference.Private || reference.Owner.Login != owner || counted == 0 {
			continue
		}
		candidates = append(candidates, contributionRepo{id: reference.ID, name: reference.Name, at: latest})
	}
	if total != collection.Total {
		return "", nil, nil, fmt.Errorf("commit contributions: the document reports %d commits but its days sum to %d", collection.Total, total)
	}
	return viewer.ID, recentRepositories(candidates), orderedPrivateDays(privateDays), nil
}

// contributionRepo is one PUBLIC repository the discovery answer admitted: the
// opaque identity the next document asks by, the name the row will wear, and
// the newest instant it contributed, which is what the recency cap sorts on.
type contributionRepo struct {
	id   string
	name string
	at   time.Time
}

// recentRepositories keeps the most recently active repositories, newest
// first, and drops the rest past maxHistoryRepositories. Dropping by recency
// rather than refusing is the same clamp mergeCommits applies to its row cap:
// a thirteenth repository must not take the panel down, and a third request
// per round is exactly the per-repository fan-out this producer exists to
// avoid.
func recentRepositories(candidates []contributionRepo) []contributionRepo {
	ordered := make([]contributionRepo, 0, len(candidates))
	for _, candidate := range candidates {
		at := len(ordered)
		for at > 0 && ordered[at-1].at.Before(candidate.at) {
			at--
		}
		ordered = append(ordered, contributionRepo{})
		copy(ordered[at+1:], ordered[at:])
		ordered[at] = candidate
	}
	if len(ordered) > maxHistoryRepositories {
		ordered = ordered[:maxHistoryRepositories]
	}
	return ordered
}

// orderedPrivateDays turns the per-day aggregate into the served list, newest
// day first so it merges into the log's own order without re-sorting. A day
// with no private contribution has no entry at all: no zero facts.
func orderedPrivateDays(days map[string]*VCSPrivateDay) []VCSPrivateDay {
	ordered := make([]VCSPrivateDay, 0, len(days))
	for _, day := range days {
		at := len(ordered)
		for at > 0 && ordered[at-1].Date < day.Date {
			at--
		}
		ordered = append(ordered, VCSPrivateDay{})
		copy(ordered[at+1:], ordered[at:])
		ordered[at] = *day
	}
	return ordered
}

// isNodeIdentifier admits an opaque upstream node identity: printable ASCII
// without whitespace, bounded. It is not a grammar this package invented a
// meaning for — the value is the upstream's own handle and is only ever
// handed straight back as a typed variable — so the check is exactly what
// keeps an unrelated or hostile document from putting arbitrary bytes into
// the next request body.
func isNodeIdentifier(s string) bool {
	if s == "" || len(s) > maxNodeIdentifierRunes {
		return false
	}
	for _, symbol := range s {
		if symbol <= 0x20 || symbol >= 0x7f {
			return false
		}
	}
	return true
}

// mapCommitHistories maps the SECOND answer onto dated panel rows. The request
// asked about one node identifier per admitted repository, in order, so the
// answer's entries are matched to those repositories POSITIONALLY and the row
// label is the name discovery admitted — never a label this document chose.
//
// Two upstream states are data rather than errors, and both are narrow: an
// entry with no default branch is an empty repository and contributes no rows,
// and a commit tip that is not a commit yields no history. Everything else —
// a null entry, a count over the bound, a name that disagrees with the one
// asked about, a malformed identity, subject, or instant — refuses the WHOLE
// document, because a half-parsed history looks exactly like a quiet week.
func mapCommitHistories(raw []byte, repos []contributionRepo, now time.Time) ([]datedCommit, error) {
	var data historyData
	if err := graphQLPayload(raw, "commit history", &data); err != nil {
		return nil, err
	}
	if len(data.Nodes) != len(repos) {
		return nil, fmt.Errorf("commit history: %d entries answered %d repositories", len(data.Nodes), len(repos))
	}
	rows := make([]datedCommit, 0, len(repos)*maxCommitDocumentItems)
	for index, node := range data.Nodes {
		repo := repos[index]
		if node == nil {
			return nil, fmt.Errorf("commit history: the entry for %s is empty", repo.name)
		}
		if node.Name != repo.name {
			return nil, fmt.Errorf("commit history: the entry asked about %s answered under another name", repo.name)
		}
		if node.DefaultBranchRef == nil {
			continue
		}
		commits := node.DefaultBranchRef.Target.History.Nodes
		if len(commits) > maxCommitDocumentItems {
			return nil, fmt.Errorf("commit history for %s carries %d rows, over the %d bound", repo.name, len(commits), maxCommitDocumentItems)
		}
		for _, commit := range commits {
			if !isCommitIdentity(commit.OID) {
				return nil, fmt.Errorf("commit history for %s: a row carries no commit identity", repo.name)
			}
			subject, err := commitSubject(commit.MessageHeadline)
			if err != nil {
				return nil, fmt.Errorf("commit history for %s: %w", repo.name, err)
			}
			at, err := time.Parse(time.RFC3339, commit.CommittedDate)
			if err != nil {
				return nil, fmt.Errorf("commit history for %s: commit instant %q: %w", repo.name, commit.CommittedDate, err)
			}
			if at.After(now.Add(maxCommitFutureSkew)) || at.Before(now.Add(-maxCommitAge)) {
				return nil, fmt.Errorf("commit history for %s: commit instant %s is outside the plausible window", repo.name, at.UTC().Format(time.RFC3339))
			}
			rows = append(rows, datedCommit{
				at:  at,
				row: VCSCommit{Repo: repo.name, SHA: commit.OID, Message: subject, At: at.UTC().Format(time.RFC3339)},
			})
		}
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
	// Upstream ordering is not part of either grammar. Derive both named
	// windows from calendar days so newest-first pages cannot turn the oldest
	// bucket into "today", and a 31-day fetch cannot masquerade as one week.
	latestDay := buckets[0].day
	for _, bucket := range buckets[1:] {
		if bucket.day > latestDay {
			latestDay = bucket.day
		}
	}
	latestDate, _ := time.Parse(dayLayout, latestDay)
	weekStart := latestDate.AddDate(0, 0, -(daysPerWeek - 1)).Format(dayLayout)
	latest := tokenBucket{}
	week := tokenBucket{}
	for _, bucket := range buckets {
		if bucket.day == latestDay {
			if err := addUsageCount(&latest.input, bucket.input); err != nil {
				return usageMapping{}, fmt.Errorf("today input: %w", err)
			}
			if err := addUsageCount(&latest.output, bucket.output); err != nil {
				return usageMapping{}, fmt.Errorf("today output: %w", err)
			}
		}
		if bucket.day >= weekStart && bucket.day <= latestDay {
			if err := addUsageCount(&week.input, bucket.input); err != nil {
				return usageMapping{}, fmt.Errorf("week input: %w", err)
			}
			if err := addUsageCount(&week.output, bucket.output); err != nil {
				return usageMapping{}, fmt.Errorf("week output: %w", err)
			}
		}
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
	windowTotal := week.input
	if err := addUsageCount(&windowTotal, week.output); err != nil {
		return usageMapping{}, fmt.Errorf("week total: %w", err)
	}
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
		if document.HasMore || document.NextPage != "" {
			return nil, errors.New("usage-report document is paginated; one page is not a complete window")
		}
		for _, bucket := range document.Data {
			start, err := time.Parse(time.RFC3339, bucket.StartingAt)
			if err != nil {
				return nil, fmt.Errorf("usage-report bucket start: %w", err)
			}
			end, err := time.Parse(time.RFC3339, bucket.EndingAt)
			if err != nil || !validUsageInterval(start, end) {
				return nil, errors.New("usage-report bucket carries an invalid interval")
			}
			totals := tokenBucket{day: start.UTC().Format(dayLayout), start: start, end: end}
			for _, result := range bucket.Results {
				for _, value := range []int64{
					result.UncachedInputTokens,
					result.CacheReadInputTokens,
					result.CacheCreation.Ephemeral5mInputTokens,
					result.CacheCreation.Ephemeral1hInputTokens,
				} {
					if err := addUsageCount(&totals.input, value); err != nil {
						return nil, fmt.Errorf("usage-report input: %w", err)
					}
				}
				if err := addUsageCount(&totals.output, result.OutputTokens); err != nil {
					return nil, fmt.Errorf("usage-report output: %w", err)
				}
			}
			buckets = append(buckets, totals)
		}
	case shapeUsagePage:
		var document usagePageDocument
		if err := decodeStrict(raw, &document); err != nil {
			return nil, fmt.Errorf("usage-page document: %w", err)
		}
		if document.HasMore || document.NextPage != "" {
			return nil, errors.New("usage-page document is paginated; one page is not a complete window")
		}
		for _, bucket := range document.Data {
			start, end := time.Unix(bucket.StartTime, 0).UTC(), time.Unix(bucket.EndTime, 0).UTC()
			if bucket.StartTime < 0 || bucket.EndTime < 0 || !validUsageInterval(start, end) {
				return nil, errors.New("usage-page bucket carries an invalid interval")
			}
			totals := tokenBucket{day: start.Format(dayLayout), start: start, end: end}
			for _, result := range bucket.Results {
				if err := addUsageCount(&totals.input, result.InputTokens); err != nil {
					return nil, fmt.Errorf("usage-page input: %w", err)
				}
				if err := addUsageCount(&totals.output, result.OutputTokens); err != nil {
					return nil, fmt.Errorf("usage-page output: %w", err)
				}
			}
			buckets = append(buckets, totals)
		}
	default:
		return nil, fmt.Errorf("unknown usage response shape %q", shape)
	}
	// The request asks for 31 rows, while the response itself is bounded by the
	// fetch body limit. An in-place insertion sort keeps this dependency-free
	// mapping file inside its reviewed import surface.
	for index := 1; index < len(buckets); index++ {
		candidate := buckets[index]
		at := index
		for at > 0 && candidate.start.Before(buckets[at-1].start) {
			buckets[at] = buckets[at-1]
			at--
		}
		buckets[at] = candidate
	}
	for index := 1; index < len(buckets); index++ {
		if buckets[index].start.Before(buckets[index-1].end) {
			return nil, errors.New("usage document carries overlapping buckets")
		}
	}
	return buckets, nil
}

// validUsageInterval ensures a bucket can be assigned to its start date
// without moving usage across a UTC calendar boundary. A daily bucket may
// end exactly at the next midnight; a sub-day bucket must end before it.
func validUsageInterval(start, end time.Time) bool {
	start = start.UTC()
	end = end.UTC()
	nextDay := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, 1)
	return end.After(start) && !end.After(nextDay)
}

// addUsageCount applies the same integer contract the sealed producer and
// browser enforce. Authenticated upstream data is still untrusted input: a
// negative count, a single value above JavaScript's exact-integer ceiling,
// or a bucket sum crossing it refuses the refresh instead of producing a
// plausible-looking wrapped or rounded total.
func addUsageCount(total *int64, value int64) error {
	if value < 0 || value > maxCountValue || *total > maxCountValue-value {
		return fmt.Errorf("count lies outside [0,%d]", maxCountValue)
	}
	*total += value
	return nil
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
		combined := totalsByDay[bucket.day]
		if err := addUsageCount(&combined, bucket.input); err != nil {
			return nil, fmt.Errorf("usage series input: %w", err)
		}
		if err := addUsageCount(&combined, bucket.output); err != nil {
			return nil, fmt.Errorf("usage series output: %w", err)
		}
		totalsByDay[bucket.day] = combined
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
	start  time.Time
	end    time.Time
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
