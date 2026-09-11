#!/usr/bin/env python3
"""Take the day's reading of the site's own panels into the ledger (issue #267).

WHY THIS EXISTS. The usage half of the record is written by the export, which
reads local files. The other three subjects — the contribution calendar, the
repositories, the game account — are measured by the ORIGIN, which fetches
them under credentials this workstation deliberately does not hold. Their
figures are already public on the site's panel API, and nothing keeps them:
the origin refreshes in place, so yesterday's contribution count is gone the
moment today's arrives. This job reads the public envelopes once a day and
writes what they said into the append-only record, so the panels gain a
history the panels themselves do not keep.

WHERE IT RUNS. OUTSIDE the producer sandbox, deliberately and unlike every
other job in this pipeline. It needs a network — that is its whole purpose —
and it reads nothing private: one public HTTPS endpoint, no credential, no
transcript, no configuration but the ledger directory and the site.

WHAT IT REFUSES. The request is bounded in every direction a fetch can run
away: https only, the resolved host must equal the configured site's, no
redirect is followed (a redirect is where a public read turns into a request
somewhere else), one bounded read, one timeout. A panel whose envelope reports
anything but `ok` is SKIPPED with no rows — the envelope's status is the
origin's own statement that the payload is stale or unavailable, and a stale
reading recorded as today's is a lie the record would keep forever.

    scripts/ledger_snapshot.py --ledger DIR --site https://<site> [--today DAY]
"""

from __future__ import annotations

import argparse
import datetime
import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import usage_ledger as ledger  # noqa: E402

# The panels this job reads, each with the payload version it knows how to
# read and the stream it lands in. A panel that mints a NEW kind version is a
# conscious edit here, never a silent reinterpretation of a changed payload.
PANEL_VCS = ("vcs-activity", "vcs-activity/v1", ledger.STREAM_GITHUB)
PANEL_PROJECTS = ("coding-projects", "coding-projects/v1", ledger.STREAM_PROJECTS)
PANEL_BOSSES = ("boss-log", "boss-log/v1", ledger.STREAM_OSRS)
PANELS = (PANEL_VCS, PANEL_PROJECTS, PANEL_BOSSES)

# The envelope every panel serves, stable by design.
ENVELOPE_SCHEMA = "panel/v1"
ENVELOPE_OK = "ok"

# The source a whole-site reading is filed under, for the two streams whose
# rows are not per repository.
SOURCE_GITHUB = "github"
SOURCE_OSRS = "osrs"

# The key a figure about a WHOLE subject is filed under. The kind already says
# what the figure is and the source says whose it is, so a reading with no
# member to name still gets one legible key rather than an empty one.
KEY_ALL = "all"

# The exporter field's value when this job took the reading and no revision
# was supplied: the record says which program wrote a row, and "the snapshot"
# is the honest answer when there is no checkout revision to name.
DEFAULT_EXPORTER = "snapshot"

# Transport bounds. The body cap is read as cap+1 so an over-cap body is
# REFUSED rather than truncated into something that parses.
REQUEST_TIMEOUT_SECONDS = 20
MAX_BODY_BYTES = 512 * 1024

# Sunday-first, the shape the contribution calendar is served in.
WEEK_DAYS = 7


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """An opener that never follows a redirect.

    Returning None from `redirect_request` makes urllib raise the 3xx as an
    error instead of chasing it. A redirect is exactly how a bounded read of
    one public endpoint becomes a request to an arbitrary host, and this job
    has one endpoint.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def build_opener():
    return urllib.request.build_opener(NoRedirect)


def admit_site(site):
    """Return the site's host, or refuse. HTTPS only, host required."""
    parsed = urllib.parse.urlsplit(site)
    if parsed.scheme != "https":
        raise ledger.LedgerError("the snapshot reads https only")
    if not parsed.hostname or parsed.path.strip("/") or parsed.query or parsed.fragment:
        raise ledger.LedgerError("the site must be a bare https origin")
    return parsed.hostname


def panel_url(site, panel):
    return "%s/api/panels/%s" % (site.rstrip("/"), panel)


def fetch_panel(opener, url, host):
    """One bounded read of one public envelope, or a refusal.

    The host is checked BEFORE the request is made and again on what the
    response says it came from: the first refuses a misconfigured site, the
    second refuses a resolution that ended somewhere else.
    """
    if urllib.parse.urlsplit(url).hostname != host:
        raise ledger.LedgerError("a panel request names a different host than the site")
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with opener.open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            if urllib.parse.urlsplit(response.geturl()).hostname != host:
                raise ledger.LedgerError("a panel response came from a different host")
            body = response.read(MAX_BODY_BYTES + 1)
    except urllib.error.HTTPError as error:
        if 300 <= error.code < 400:
            raise ledger.LedgerError("a panel request was redirected; the snapshot follows none")
        raise ledger.LedgerError("a panel request failed")
    except (urllib.error.URLError, OSError):
        raise ledger.LedgerError("a panel request failed")
    if len(body) > MAX_BODY_BYTES:
        raise ledger.LedgerError(
            "a panel response is larger than the %d byte bound" % MAX_BODY_BYTES
        )
    try:
        envelope = json.loads(body.decode("utf-8"))
    except (ValueError, RecursionError, UnicodeDecodeError):
        raise ledger.LedgerError("a panel response is not a parsable JSON document")
    if not isinstance(envelope, dict) or envelope.get("schema") != ENVELOPE_SCHEMA:
        raise ledger.LedgerError("a panel response is not the expected envelope")
    return envelope


def admit_payload(envelope, panel, kind):
    """The envelope's data, or None when the origin says it is not current."""
    if envelope.get("id") != panel or envelope.get("kind") != kind:
        raise ledger.LedgerError("a panel response carries a different payload version")
    if envelope.get("status") != ENVELOPE_OK:
        return None
    data = envelope.get("data")
    if not isinstance(data, dict):
        raise ledger.LedgerError("a panel response carries no payload")
    return data


def counted(value):
    """A reading, or None when the panel has no figure to report.

    An unranked skill, an absent count, a null: the record keeps no row for
    it. A zero would claim a measurement nobody made.
    """
    return value if ledger.valid_count(value) else None


def instant_of(value):
    """Parse one panel instant, or None."""
    if not ledger.valid_instant(value):
        return None
    return datetime.datetime.strptime(value, ledger.INSTANT_FORMAT).replace(
        tzinfo=datetime.timezone.utc
    )


def contribution_rows(data, stamp, exporter, digest, skipped):
    """The calendar grid, one row per day it reports, plus today's streak.

    The grid is Sunday-first and its last reported day is `endDate`, which is
    what anchors every cell to a date: the cell holding `endDate` is found by
    that day's own weekday, and every earlier cell counts back from it. Cells
    AFTER it are the current week's unreached days and are not days the panel
    has reported.
    """
    weeks = data.get("weeks")
    end = data.get("endDate")
    if not isinstance(weeks, list) or not ledger.valid_calendar_day(end):
        raise ledger.LedgerError("the activity panel carries no contribution calendar")
    last_day = datetime.date.fromisoformat(end)
    # Sunday-first index of the last reported day.
    last_column = (last_day.weekday() + 1) % WEEK_DAYS
    last_week = len(weeks) - 1
    rows = []
    for week_index, week in enumerate(weeks):
        if not isinstance(week, list) or len(week) != WEEK_DAYS:
            raise ledger.LedgerError("the activity panel carries a malformed week")
        for column, value in enumerate(week):
            behind = (last_week - week_index) * WEEK_DAYS + (last_column - column)
            if behind < 0:
                continue
            count = counted(value)
            if count is None:
                skipped.append(1)
                continue
            if count == 0:
                # A day with no contributions is the calendar's own zero, not
                # a measurement of anything; the record keeps readings.
                continue
            rows.append(
                ledger.make_row(
                    (last_day - datetime.timedelta(days=behind)).isoformat(),
                    ledger.STREAM_GITHUB,
                    SOURCE_GITHUB,
                    ledger.KIND_CONTRIBUTIONS,
                    KEY_ALL,
                    count,
                    ledger.UNIT_COUNT,
                    stamp,
                    ledger.METHOD_PANEL,
                    exporter,
                    digest,
                )
            )
    return rows


def activity_rows(data, day, stamp, exporter, digest, skipped):
    """Every row the activity panel yields: the calendar, the streak, commits."""
    rows = contribution_rows(data, stamp, exporter, digest, skipped)
    streak = counted(data.get("streak"))
    if streak is not None:
        rows.append(
            ledger.make_row(
                day,
                ledger.STREAM_GITHUB,
                SOURCE_GITHUB,
                ledger.KIND_STREAK,
                "current",
                streak,
                ledger.UNIT_COUNT,
                stamp,
                ledger.METHOD_PANEL,
                exporter,
                digest,
            )
        )
    commits = data.get("recentCommits")
    if commits is None:
        return rows
    if not isinstance(commits, list):
        raise ledger.LedgerError("the activity panel carries a malformed commit list")
    for commit in commits:
        if not isinstance(commit, dict):
            raise ledger.LedgerError("the activity panel carries a malformed commit")
        repository = commit.get("repo")
        sha = commit.get("sha")
        at = instant_of(commit.get("at"))
        if not ledger.valid_name(repository) or not ledger.valid_name(sha) or at is None:
            skipped.append(1)
            continue
        rows.append(
            ledger.make_row(
                at.astimezone().date().isoformat(),
                ledger.STREAM_GITHUB,
                repository,
                ledger.KIND_COMMIT,
                sha,
                1,
                ledger.UNIT_COUNT,
                stamp,
                ledger.METHOD_PANEL,
                exporter,
                digest,
            )
        )
    return rows


# The repository figures the projects panel reports, each with the unit its
# reading is counted in.
PROJECT_FIGURES = (
    ("stars", ledger.KIND_STARS, ledger.UNIT_STARS),
    ("openIssues", ledger.KIND_OPEN_ISSUES, ledger.UNIT_COUNT),
    ("openPulls", ledger.KIND_OPEN_PULLS, ledger.UNIT_COUNT),
)


def project_rows(data, day, stamp, exporter, digest, skipped):
    """One level reading per repository per figure, on the day it was read."""
    repositories = data.get("repos")
    if not isinstance(repositories, list):
        raise ledger.LedgerError("the projects panel carries no repository list")
    rows = []
    for repository in repositories:
        if not isinstance(repository, dict):
            raise ledger.LedgerError("the projects panel carries a malformed repository")
        name = repository.get("name")
        if not ledger.valid_name(name):
            skipped.append(1)
            continue
        for field, kind, unit in PROJECT_FIGURES:
            value = counted(repository.get(field))
            if value is None:
                skipped.append(1)
                continue
            rows.append(
                ledger.make_row(
                    day,
                    ledger.STREAM_PROJECTS,
                    name,
                    kind,
                    KEY_ALL,
                    value,
                    unit,
                    stamp,
                    ledger.METHOD_PANEL,
                    exporter,
                    digest,
                )
            )
        pushed = instant_of(repository.get("pushedAt"))
        if pushed is None:
            skipped.append(1)
            continue
        rows.append(
            ledger.make_row(
                day,
                ledger.STREAM_PROJECTS,
                name,
                ledger.KIND_PUSHED,
                "last",
                int(pushed.timestamp()),
                ledger.UNIT_EPOCH_SECONDS,
                stamp,
                ledger.METHOD_PANEL,
                exporter,
                digest,
            )
        )
    return rows


# The game figures, each with the panel field it reads and its unit.
SKILL_FIGURES = (
    ("xp", ledger.KIND_SKILL_XP, ledger.UNIT_XP),
    ("level", ledger.KIND_SKILL_LEVEL, ledger.UNIT_LEVEL),
    ("rank", ledger.KIND_SKILL_RANK, ledger.UNIT_RANK),
)
BOSS_FIGURES = (
    ("kc", ledger.KIND_BOSS_KC, ledger.UNIT_COUNT),
    ("rank", ledger.KIND_BOSS_RANK, ledger.UNIT_RANK),
)


def boss_log_rows(data, day, stamp, exporter, digest, skipped):
    """One level reading per skill and per boss, on the day it was read.

    The panel's account name is deliberately NOT recorded: the record needs to
    know what was measured, never whose account it was, and the account is
    already the only thing in this payload that names a person.
    """
    rows = []
    for section, figures in (("skills", SKILL_FIGURES), ("bosses", BOSS_FIGURES)):
        entries = data.get(section)
        if not isinstance(entries, list):
            raise ledger.LedgerError("the boss log panel carries a malformed section")
        for entry in entries:
            if not isinstance(entry, dict):
                raise ledger.LedgerError("the boss log panel carries a malformed entry")
            name = entry.get("name")
            if not ledger.valid_name(name):
                skipped.append(1)
                continue
            for field, kind, unit in figures:
                value = counted(entry.get(field))
                if value is None:
                    skipped.append(1)
                    continue
                rows.append(
                    ledger.make_row(
                        day,
                        ledger.STREAM_OSRS,
                        SOURCE_OSRS,
                        kind,
                        name,
                        value,
                        unit,
                        stamp,
                        ledger.METHOD_PANEL,
                        exporter,
                        digest,
                    )
                )
    return rows


PANEL_ROWS = {
    ledger.STREAM_GITHUB: activity_rows,
    ledger.STREAM_PROJECTS: project_rows,
    ledger.STREAM_OSRS: boss_log_rows,
}


def snapshot(ledger_dir, site, now, today=None, exporter=DEFAULT_EXPORTER, opener=None):
    """Read every panel once and append what it said. Returns the counters."""
    ledger_dir = pathlib.Path(ledger_dir)
    host = admit_site(site)
    opener = opener if opener is not None else build_opener()
    ledger.ledger_directories(ledger_dir)
    ledger.write_schema_file(ledger_dir)
    stamp = ledger.instant(now)
    day = today or now.astimezone().date().isoformat()
    if not ledger.valid_calendar_day(day):
        raise ledger.LedgerError("the snapshot was given a day that is not a calendar day")
    appended = kept = skipped_total = 0
    for panel, kind, stream in PANELS:
        envelope = fetch_panel(opener, panel_url(site, panel), host)
        data = admit_payload(envelope, panel, kind)
        if data is None:
            print(
                "ledger snapshot skipped %s: the origin does not report it current" % stream,
                file=sys.stderr,
            )
            continue
        digest, _ = ledger.archive_panel(ledger_dir, stream, day, envelope)
        skipped = []
        rows = PANEL_ROWS[stream](data, day, stamp, exporter, digest, skipped)
        added, unchanged = ledger.append_rows(ledger_dir, stream, rows)
        appended += added
        kept += unchanged
        skipped_total += len(skipped)
    print(
        "ledger snapshot appended=%d unchanged=%d unreported=%d"
        % (appended, kept, skipped_total),
        file=sys.stderr,
    )
    return appended, kept, skipped_total


def parse_arguments(argv):
    parser = argparse.ArgumentParser(
        description="Record the site's public panel readings in the usage ledger.",
    )
    parser.add_argument("--ledger", required=True, help="the ledger directory")
    parser.add_argument("--site", required=True, help="the site's https origin")
    parser.add_argument("--today", help="the calendar day the reading is filed under")
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
    if arguments.today is not None and not ledger.valid_calendar_day(arguments.today):
        print("the day must be a calendar day", file=sys.stderr)
        return 2
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
    try:
        snapshot(
            ledger_dir,
            arguments.site,
            now,
            arguments.today,
            arguments.exporter_version,
        )
    except ledger.LedgerError as error:
        print(str(error), file=sys.stderr)
        return 1
    except OSError:
        print("the snapshot could not be written", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
