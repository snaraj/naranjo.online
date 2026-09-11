#!/usr/bin/env python3
"""Backfill the ledger's GitHub streams from the account's own history.

WHY THIS EXISTS. The daily snapshot (`ledger_snapshot.py`) records what the
site's panels report, and the panels report one year of contributions and a
handful of recent commits. Everything before the day the snapshot was switched
on is only reachable from GitHub itself. This is the one-off, owner-run job
that reads it: a year at a time, into the same append-only record, marked
`backfill` so a reader can always tell a reconstructed day from a day this
pipeline watched happen.

OWNER-RUN, NEVER SCHEDULED. It authenticates as nobody: it shells out to the
owner's own `gh`, which holds the credential this workstation is allowed to
have, and asks that CLI who it is at run time rather than carrying a login,
an account id, or a token anywhere in this repository (requirement 12). There
is no LaunchAgent for it, because a backfill is a thing you do once and then
audit, not a thing that should run while nobody is looking.

IDEMPOTENT BY CONSTRUCTION. It appends through the same rule every other
writer uses, so a second run over the same years appends nothing: the figures
have not changed, and a row that says nothing new is never written. That is
what makes an interrupted backfill safe to simply run again.

FAIL CLOSED. A `gh` invocation that exits non-zero refuses the whole run — a
partial year silently recorded as complete is worse than no year, because
nothing downstream could tell. The one exception is a rate-limited response,
which is not a failure but a wait: the run sleeps for as long as the response
asks and tries again, a bounded number of times.

    scripts/ledger_backfill_github.py --ledger DIR --from 2016 [--to 2026]
"""

from __future__ import annotations

import argparse
import datetime
import json
import pathlib
import re
import subprocess
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import usage_ledger as ledger  # noqa: E402

# The CLI this job borrows its authentication from. It is the owner's own,
# already installed and already authenticated for this repository's work.
GH = "gh"

# The source a whole-account reading is filed under, matching the snapshot's:
# the two jobs write the same streams and must agree on identity or a reader
# sees two histories of one subject.
SOURCE_GITHUB = "github"
KEY_ALL = "all"

# The exporter field's value when this job wrote a row.
DEFAULT_EXPORTER = "backfill"

# Bounds. A response larger than this is refused rather than parsed: the CLI
# is trusted to be the owner's, the SERVICE behind it is not, and an unbounded
# parse of a remote document is a job that can be stopped by a large one.
MAX_RESPONSE_BYTES = 32 << 20
MAX_PAGES = 200
PAGE_SIZE = 100
SUBPROCESS_TIMEOUT_SECONDS = 120

# Rate limiting is a wait, not a failure. The retry budget is small and the
# sleep is capped: a job that sleeps for an hour on a typo is a job nobody
# runs twice.
MAX_ATTEMPTS = 4
DEFAULT_RETRY_SECONDS = 60
MAX_SLEEP_SECONDS = 900
RATE_LIMITED = re.compile(r"\b(403|429)\b|rate limit", re.IGNORECASE)
RETRY_AFTER = re.compile(r"retry-after:\s*(\d+)", re.IGNORECASE)

# The contribution calendar, a year at a time. `viewer` is whoever the CLI is
# authenticated as, which is how this file names no account.
CONTRIBUTIONS_QUERY = (
    "query($from:DateTime!,$to:DateTime!){"
    "viewer{contributionsCollection(from:$from,to:$to){"
    "contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}"
)


def run_gh(arguments, sleeper=None):
    """One `gh` invocation, with the rate-limit wait and nothing else.

    Returns stdout. Any other non-zero exit refuses the run, and the message
    names the subcommand rather than the account, the URL, or the output.
    """
    sleeper = sleeper if sleeper is not None else time.sleep
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            completed = subprocess.run(
                [GH, *arguments],
                capture_output=True,
                text=True,
                stdin=subprocess.DEVNULL,
                timeout=SUBPROCESS_TIMEOUT_SECONDS,
            )
        except (OSError, subprocess.SubprocessError):
            raise ledger.LedgerError("the GitHub CLI could not be run")
        if completed.returncode == 0:
            if len(completed.stdout) > MAX_RESPONSE_BYTES:
                raise ledger.LedgerError(
                    "a GitHub response is larger than the %d byte bound" % MAX_RESPONSE_BYTES
                )
            return completed.stdout
        if attempt < MAX_ATTEMPTS and RATE_LIMITED.search(completed.stderr or ""):
            found = RETRY_AFTER.search(completed.stderr or "")
            seconds = int(found.group(1)) if found else DEFAULT_RETRY_SECONDS
            seconds = min(max(seconds, 1), MAX_SLEEP_SECONDS)
            print(
                "backfill waiting %ds: the service is rate limiting" % seconds,
                file=sys.stderr,
            )
            sleeper(seconds)
            continue
        raise ledger.LedgerError("the GitHub CLI refused a request")
    raise ledger.LedgerError("the GitHub CLI stayed rate limited")


def gh_json(arguments, sleeper=None):
    """One `gh` invocation whose output must be a JSON document."""
    try:
        return json.loads(run_gh(arguments, sleeper))
    except (ValueError, RecursionError):
        raise ledger.LedgerError("a GitHub response is not a parsable JSON document")


def viewer_login(sleeper=None):
    """Who the CLI is authenticated as, read at run time and never stored."""
    login = run_gh(["api", "user", "--jq", ".login"], sleeper).strip()
    if not ledger.valid_name(login):
        raise ledger.LedgerError("the GitHub CLI reported no usable login")
    return login


def year_bounds(year):
    """The half-open instants one calendar year of contributions spans."""
    return (
        "%d-01-01T00:00:00Z" % year,
        "%d-12-31T23:59:59Z" % year,
    )


def contribution_rows(year, stamp, exporter, sleeper=None):
    """Every day that year's calendar reports a contribution on."""
    start, end = year_bounds(year)
    document = gh_json(
        [
            "api",
            "graphql",
            "-f",
            "query=%s" % CONTRIBUTIONS_QUERY,
            "-f",
            "from=%s" % start,
            "-f",
            "to=%s" % end,
        ],
        sleeper,
    )
    try:
        weeks = document["data"]["viewer"]["contributionsCollection"][
            "contributionCalendar"
        ]["weeks"]
    except (KeyError, TypeError):
        raise ledger.LedgerError("a contribution calendar response carries no calendar")
    if not isinstance(weeks, list):
        raise ledger.LedgerError("a contribution calendar response is malformed")
    rows = []
    for week in weeks:
        if not isinstance(week, dict) or not isinstance(week.get("contributionDays"), list):
            raise ledger.LedgerError("a contribution calendar response carries a malformed week")
        for entry in week["contributionDays"]:
            if not isinstance(entry, dict):
                raise ledger.LedgerError("a contribution calendar response carries a malformed day")
            day = entry.get("date")
            count = entry.get("contributionCount")
            if not ledger.valid_calendar_day(day) or not ledger.valid_count(count):
                raise ledger.LedgerError("a contribution calendar response carries a malformed day")
            if count == 0:
                continue
            rows.append(
                ledger.make_row(
                    day,
                    ledger.STREAM_GITHUB,
                    SOURCE_GITHUB,
                    ledger.KIND_CONTRIBUTIONS,
                    KEY_ALL,
                    count,
                    ledger.UNIT_COUNT,
                    stamp,
                    ledger.METHOD_BACKFILL,
                    exporter,
                )
            )
    return rows


def paged(path, sleeper=None):
    """Walk one paginated REST collection, bounded in pages and in size."""
    entries = []
    for page in range(1, MAX_PAGES + 1):
        separator = "&" if "?" in path else "?"
        document = gh_json(
            ["api", "%s%sper_page=%d&page=%d" % (path, separator, PAGE_SIZE, page)],
            sleeper,
        )
        if not isinstance(document, list):
            raise ledger.LedgerError("a GitHub listing response is not a list")
        entries.extend(document)
        if len(document) < PAGE_SIZE:
            return entries
    raise ledger.LedgerError("a GitHub listing is longer than the %d page bound" % MAX_PAGES)


def repositories(sleeper=None):
    """Every repository the authenticated account owns, as (owner, name)."""
    found = []
    for entry in paged("user/repos?affiliation=owner", sleeper):
        if not isinstance(entry, dict):
            raise ledger.LedgerError("a repository listing entry is malformed")
        full = entry.get("full_name")
        if not isinstance(full, str) or full.count("/") != 1:
            raise ledger.LedgerError("a repository listing entry carries no full name")
        owner, name = full.split("/")
        if not ledger.valid_name(owner) or not ledger.valid_name(name):
            raise ledger.LedgerError("a repository listing entry carries a malformed name")
        found.append((owner, name))
    return found


def commit_rows(owner, name, login, year, stamp, exporter, sleeper=None):
    """One row per commit the account authored in that repository that year.

    The value is 1: the row records that a commit exists on that day, and the
    count of commits for a day is what a reader gets by counting rows. A
    commit's own sha is public and is the only identity here.
    """
    start, end = year_bounds(year)
    path = "repos/%s/%s/commits?author=%s&since=%s&until=%s" % (
        owner,
        name,
        login,
        start,
        end,
    )
    rows = []
    for entry in paged(path, sleeper):
        if not isinstance(entry, dict):
            raise ledger.LedgerError("a commit listing entry is malformed")
        sha = entry.get("sha")
        commit = entry.get("commit")
        if not isinstance(commit, dict) or not isinstance(commit.get("author"), dict):
            raise ledger.LedgerError("a commit listing entry carries no author")
        when = commit["author"].get("date")
        if not ledger.valid_name(sha) or not ledger.valid_instant(when):
            raise ledger.LedgerError("a commit listing entry carries no usable identity")
        moment = datetime.datetime.strptime(when, ledger.INSTANT_FORMAT).replace(
            tzinfo=datetime.timezone.utc
        )
        rows.append(
            ledger.make_row(
                moment.astimezone().date().isoformat(),
                ledger.STREAM_GITHUB,
                name,
                ledger.KIND_COMMIT,
                sha,
                1,
                ledger.UNIT_COUNT,
                stamp,
                ledger.METHOD_BACKFILL,
                exporter,
            )
        )
    return rows


def backfill(
    ledger_dir,
    first_year,
    last_year,
    now,
    exporter=DEFAULT_EXPORTER,
    sleeper=None,
):
    """Read every year in the range and append what it reports."""
    ledger_dir = pathlib.Path(ledger_dir)
    ledger.ledger_directories(ledger_dir)
    ledger.write_schema_file(ledger_dir)
    stamp = ledger.instant(now)
    login = viewer_login(sleeper)
    owned = repositories(sleeper)
    appended = kept = 0
    for year in range(first_year, last_year + 1):
        rows = contribution_rows(year, stamp, exporter, sleeper)
        for owner, name in owned:
            rows.extend(commit_rows(owner, name, login, year, stamp, exporter, sleeper))
        added, unchanged = ledger.append_rows(ledger_dir, ledger.STREAM_GITHUB, rows)
        appended += added
        kept += unchanged
        print(
            "backfill %d appended=%d unchanged=%d" % (year, added, unchanged),
            file=sys.stderr,
        )
    print("backfill appended=%d unchanged=%d" % (appended, kept), file=sys.stderr)
    return appended, kept


def parse_arguments(argv):
    parser = argparse.ArgumentParser(
        description="Backfill the ledger's GitHub streams from the account's history.",
    )
    parser.add_argument("--ledger", required=True, help="the ledger directory")
    parser.add_argument("--from", dest="first", required=True, type=int, help="first year")
    parser.add_argument("--to", dest="last", type=int, help="last year, defaulting to this one")
    parser.add_argument(
        "--exporter-version",
        default=DEFAULT_EXPORTER,
        help="the revision recorded beside every row this run writes",
    )
    return parser.parse_args(argv)


def main(argv=None):
    arguments = parse_arguments(sys.argv[1:] if argv is None else argv)
    ledger_dir = pathlib.Path(arguments.ledger).expanduser()
    if not ledger_dir.parent.is_dir():
        print("no such ledger directory", file=sys.stderr)
        return 2
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
    last = arguments.last if arguments.last is not None else now.astimezone().year
    if arguments.first < 2008 or last < arguments.first or last > now.astimezone().year:
        # 2008 is the year the service itself started; a range outside it or
        # running into the future is a typo, and a typo here costs an hour of
        # requests before it fails on something else.
        print("the year range must run from 2008 forward and end no later than today", file=sys.stderr)
        return 2
    try:
        backfill(ledger_dir, arguments.first, last, now, arguments.exporter_version)
    except ledger.LedgerError as error:
        print(str(error), file=sys.stderr)
        return 1
    except OSError:
        print("the backfill could not be written", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
