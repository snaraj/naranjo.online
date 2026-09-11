"""Contract tests for the two programs that read the outside world (issue #267).

`scripts/ledger_snapshot.py` reads the site's own public panel envelopes once a
night; `scripts/ledger_backfill_github.py` is the owner-run job that reconstructs
the years before the snapshot existed. Both write into the append-only record,
whose own rules are proven in `test_usage_ledger.py`.

Neither test touches a network or a real credential, and that is deliberate
rather than convenient:

* The snapshot is driven through an injected opener — a hand-written fake, no
  mock framework — so every refusal it owes can be STAGED: a response from
  another host, a redirect, a body past the cap, an envelope the origin says
  is not current. The bounds it applies before opening anything (https only,
  the configured host) are checked against the functions that apply them.
* The backfill is driven against a stub `gh` on PATH inside a temporary
  directory, so pagination, idempotence, a non-zero exit and a rate-limited
  response are all real subprocess behaviour rather than a patched function.

Fixture text is sentinel-only: the names here are `repo-one`, `skill-one` and
`sentinel-login`, never a real account, repository, or game name.
"""

from __future__ import annotations

import contextlib
import datetime
import gzip
import importlib.util
import io
import json
import os
import pathlib
import shutil
import stat
import tempfile
import time
import unittest
import urllib.error


def setUpModule():
    os.environ["TZ"] = "UTC"
    time.tzset()


_SCRIPTS = pathlib.Path(__file__).resolve().parents[1]


def _load(name):
    spec = importlib.util.spec_from_file_location(name, _SCRIPTS / ("%s.py" % name))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ledger = _load("usage_ledger")
snapshot = _load("ledger_snapshot")
backfill = _load("ledger_backfill_github")

NOW = datetime.datetime(2026, 9, 11, 23, 45, 0, tzinfo=datetime.timezone.utc)
TODAY = "2026-09-11"
SITE = "https://panels.example"
HOST = "panels.example"


def envelope(panel, kind, data, status="ok"):
    return {
        "schema": "panel/v1",
        "id": panel,
        "kind": kind,
        "title": "sentinel",
        "generatedAt": "2026-09-11T23:44:00Z",
        "status": status,
        "data": data,
    }


def activity(weeks=None, end="2026-09-11", streak=3, commits=None):
    return {
        "totalContributions": 12,
        "weeks": weeks if weeks is not None else [[0, 0, 0, 0, 0, 0, 0]] * 51 + [[1, 2, 0, 0, 0, 0, 0]],
        "endDate": end,
        "streak": streak,
        "recentCommits": commits
        if commits is not None
        else [
            {
                "repo": "repo-one",
                "sha": "a" * 40,
                "message": "sentinel",
                "at": "2026-09-10T12:00:00Z",
            }
        ],
        "commitsAt": "2026-09-11T23:44:00Z",
        "coverage": "sentinel",
    }


PROJECTS = {
    "repos": [
        {
            "name": "repo-one",
            "description": "sentinel",
            "stars": 4,
            "pushedAt": "2026-09-10T12:00:00Z",
            "openIssues": 2,
            "openPulls": 1,
        }
    ]
}

BOSSES = {
    "account": "sentinel-account",
    "skills": [{"name": "skill-one", "level": 70, "rank": 1234, "xp": 999999}],
    "bosses": [{"name": "boss-one", "kc": 12, "rank": 4321}],
}


class FakeResponse:
    """What a bounded read sees: a body, and the URL it came from."""

    def __init__(self, body, url):
        self.body = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        self.url = url

    def read(self, size):
        return self.body[:size]

    def geturl(self):
        return self.url

    def __enter__(self):
        return self

    def __exit__(self, *unused):
        return False


class FakeOpener:
    """An opener that answers from a table, or raises what a test staged."""

    def __init__(self, answers):
        self.answers = answers
        self.requests = []
        self.timeouts = []

    def open(self, request, timeout=None):
        self.requests.append(request)
        self.timeouts.append(timeout)
        answer = self.answers[request.full_url]
        if isinstance(answer, Exception):
            raise answer
        return answer


def all_panels(**overrides):
    """The three envelopes, keyed by the URL the snapshot will ask for."""
    table = {
        snapshot.panel_url(SITE, "vcs-activity"): FakeResponse(
            envelope("vcs-activity", "vcs-activity/v1", activity()),
            snapshot.panel_url(SITE, "vcs-activity"),
        ),
        snapshot.panel_url(SITE, "coding-projects"): FakeResponse(
            envelope("coding-projects", "coding-projects/v1", PROJECTS),
            snapshot.panel_url(SITE, "coding-projects"),
        ),
        snapshot.panel_url(SITE, "boss-log"): FakeResponse(
            envelope("boss-log", "boss-log/v1", BOSSES),
            snapshot.panel_url(SITE, "boss-log"),
        ),
    }
    table.update(overrides)
    return table


class SnapshotCase(unittest.TestCase):
    def setUp(self):
        self.scratch = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.scratch, ignore_errors=True)
        self.ledger = self.scratch / "ledger"

    def take(self, answers=None, today=TODAY):
        opener = FakeOpener(answers if answers is not None else all_panels())
        with contextlib.redirect_stderr(io.StringIO()) as captured:
            result = snapshot.snapshot(
                self.ledger, SITE, NOW, today, "snapshot", opener
            )
        self.stderr = captured.getvalue()
        self.opener = opener
        return result

    def rows(self, stream, year="2026"):
        path = self.ledger / stream / ("%s.ndjson" % year)
        if not path.is_file():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


class TransportBoundsTest(SnapshotCase):
    """Everything the fetch refuses, staged rather than described."""

    def test_a_site_that_is_not_https_is_refused(self):
        for site in ("http://panels.example", "ftp://panels.example", "panels.example"):
            with self.subTest(site=site):
                with self.assertRaises(ledger.LedgerError):
                    snapshot.admit_site(site)

    def test_a_site_carrying_a_path_or_query_is_refused(self):
        for site in ("https://panels.example/somewhere", "https://panels.example?a=1"):
            with self.subTest(site=site):
                with self.assertRaises(ledger.LedgerError):
                    snapshot.admit_site(site)

    def test_a_request_naming_another_host_is_refused(self):
        opener = FakeOpener({})
        with self.assertRaises(ledger.LedgerError) as caught:
            snapshot.fetch_panel(opener, "https://elsewhere.example/api/panels/x", HOST)
        self.assertIn("different host", str(caught.exception))
        self.assertEqual(opener.requests, [], "a refused request was still opened")

    def test_a_response_from_another_host_is_refused(self):
        url = snapshot.panel_url(SITE, "vcs-activity")
        opener = FakeOpener(
            {url: FakeResponse(envelope("vcs-activity", "vcs-activity/v1", activity()),
                               "https://elsewhere.example/api/panels/vcs-activity")}
        )
        with self.assertRaises(ledger.LedgerError) as caught:
            snapshot.fetch_panel(opener, url, HOST)
        self.assertIn("different host", str(caught.exception))

    def test_a_redirect_is_refused_rather_than_followed(self):
        url = snapshot.panel_url(SITE, "vcs-activity")
        opener = FakeOpener(
            {url: urllib.error.HTTPError(url, 302, "Found", {}, None)}
        )
        with self.assertRaises(ledger.LedgerError) as caught:
            snapshot.fetch_panel(opener, url, HOST)
        self.assertIn("redirected", str(caught.exception))

    def test_the_real_opener_carries_no_redirect_handler(self):
        # The refusal above is only real if the opener this program builds
        # actually declines to chase a 3xx.
        handler = snapshot.NoRedirect()
        self.assertIsNone(
            handler.redirect_request(None, None, 302, "Found", {}, "https://elsewhere")
        )
        self.assertTrue(
            any(isinstance(one, snapshot.NoRedirect) for one in snapshot.build_opener().handlers)
        )

    def test_a_body_past_the_cap_is_refused_rather_than_truncated(self):
        url = snapshot.panel_url(SITE, "vcs-activity")
        oversized = b"x" * (snapshot.MAX_BODY_BYTES + 1)
        opener = FakeOpener({url: FakeResponse(oversized, url)})
        with self.assertRaises(ledger.LedgerError) as caught:
            snapshot.fetch_panel(opener, url, HOST)
        self.assertIn("byte bound", str(caught.exception))

    def test_a_body_at_the_cap_is_read(self):
        # Non-vacuity for the bound: the cap admits, and cap+1 refuses.
        url = snapshot.panel_url(SITE, "vcs-activity")
        document = envelope("vcs-activity", "vcs-activity/v1", activity())
        padded = json.dumps(document).encode("utf-8")
        padded = padded + b" " * (snapshot.MAX_BODY_BYTES - len(padded))
        opener = FakeOpener({url: FakeResponse(padded, url)})
        self.assertEqual(snapshot.fetch_panel(opener, url, HOST)["id"], "vcs-activity")

    def test_a_failed_request_refuses_the_run(self):
        url = snapshot.panel_url(SITE, "vcs-activity")
        opener = FakeOpener({url: urllib.error.URLError("no route")})
        with self.assertRaises(ledger.LedgerError):
            snapshot.fetch_panel(opener, url, HOST)

    def test_a_body_that_is_not_the_envelope_is_refused(self):
        url = snapshot.panel_url(SITE, "vcs-activity")
        for body in (b"{nope", json.dumps([1, 2]).encode("utf-8"),
                     json.dumps({"schema": "panel/v2"}).encode("utf-8")):
            with self.subTest(body=body[:12]):
                opener = FakeOpener({url: FakeResponse(body, url)})
                with self.assertRaises(ledger.LedgerError):
                    snapshot.fetch_panel(opener, url, HOST)

    def test_the_request_is_bounded_and_asks_for_json(self):
        self.take()
        self.assertEqual(
            set(self.opener.timeouts), {snapshot.REQUEST_TIMEOUT_SECONDS}
        )
        for request in self.opener.requests:
            self.assertEqual(request.get_header("Accept"), "application/json")

    def test_a_payload_version_the_snapshot_does_not_know_is_refused(self):
        with self.assertRaises(ledger.LedgerError):
            snapshot.admit_payload(
                envelope("vcs-activity", "vcs-activity/v2", activity()),
                "vcs-activity",
                "vcs-activity/v1",
            )


class StaleStatusTest(SnapshotCase):
    """A reading the origin does not vouch for is not a reading."""

    def test_a_panel_that_is_not_ok_is_skipped_with_no_rows(self):
        url = snapshot.panel_url(SITE, "boss-log")
        answers = all_panels(
            **{url: FakeResponse(
                envelope("boss-log", "boss-log/v1", BOSSES, status="stale"), url)}
        )
        self.take(answers)
        self.assertEqual(self.rows("osrs"), [])
        self.assertIn("skipped osrs", self.stderr)
        # And the raw envelope of a skipped panel is not archived either: the
        # archive exists to back a reading, and there is no reading.
        self.assertFalse((self.ledger / "raw" / "osrs").exists())
        # The other two panels still recorded, so one stale panel is not an
        # outage.
        self.assertTrue(self.rows("projects"))
        self.assertTrue(self.rows("github"))


class SnapshotRowsTest(SnapshotCase):
    """What each panel yields, and what it deliberately does not."""

    def test_the_contribution_calendar_lands_on_real_days(self):
        # The grid's last reported day is endDate, and every cell counts back
        # from the cell that holds it. 2026-09-11 is a Friday, so the last
        # week's Sunday is 2026-09-06 and its Monday 2026-09-07.
        self.take()
        rows = {
            (entry["day"], entry["value"])
            for entry in self.rows("github")
            if entry["kind"] == "contributions"
        }
        self.assertEqual(rows, {("2026-09-06", 1), ("2026-09-07", 2)})

    def test_days_after_the_end_date_are_not_reported_days(self):
        # The current week's unreached cells carry zeros the panel has not
        # measured; recording them would claim a reading for tomorrow.
        # 2026-09-11 is a Friday, so it sits at Sunday-first index 5 and
        # index 6 is the day after the panel's last reported one.
        weeks = [[0, 0, 0, 0, 0, 0, 0]] * 51 + [[0, 0, 0, 0, 0, 0, 9]]
        answers = all_panels(
            **{snapshot.panel_url(SITE, "vcs-activity"): FakeResponse(
                envelope("vcs-activity", "vcs-activity/v1", activity(weeks=weeks)),
                snapshot.panel_url(SITE, "vcs-activity"))}
        )
        self.take(answers)
        self.assertEqual(
            [entry for entry in self.rows("github") if entry["kind"] == "contributions"], []
        )

    def test_the_streak_is_a_level_reading_on_the_capture_day(self):
        self.take()
        streak = [entry for entry in self.rows("github") if entry["kind"] == "streak"]
        self.assertEqual(len(streak), 1)
        self.assertEqual((streak[0]["day"], streak[0]["value"]), (TODAY, 3))

    def test_a_commit_is_recorded_under_its_repository_on_its_own_day(self):
        self.take()
        commits = [entry for entry in self.rows("github") if entry["kind"] == "commit"]
        self.assertEqual(len(commits), 1)
        self.assertEqual(commits[0]["source"], "repo-one")
        self.assertEqual(commits[0]["key"], "a" * 40)
        self.assertEqual(commits[0]["day"], "2026-09-10")
        self.assertEqual(commits[0]["value"], 1)

    def test_no_commit_message_reaches_the_record(self):
        self.take()
        self.assertNotIn("sentinel", "\n".join(
            json.dumps(entry) for entry in self.rows("github") if entry["kind"] == "commit"
        ))

    def test_each_repository_figure_is_a_level_reading_on_the_capture_day(self):
        self.take()
        rows = {
            (entry["kind"], entry["unit"], entry["value"]) for entry in self.rows("projects")
        }
        pushed = int(
            datetime.datetime(2026, 9, 10, 12, 0, tzinfo=datetime.timezone.utc).timestamp()
        )
        self.assertEqual(
            rows,
            {
                ("stars", "stars", 4),
                ("open-issues", "count", 2),
                ("open-pulls", "count", 1),
                ("pushed", "epoch-seconds", pushed),
            },
        )
        self.assertEqual({entry["day"] for entry in self.rows("projects")}, {TODAY})
        self.assertEqual({entry["source"] for entry in self.rows("projects")}, {"repo-one"})

    def test_every_skill_and_boss_figure_is_recorded_under_its_name(self):
        self.take()
        rows = {
            (entry["kind"], entry["key"], entry["value"]) for entry in self.rows("osrs")
        }
        self.assertEqual(
            rows,
            {
                ("skill-xp", "skill-one", 999999),
                ("skill-level", "skill-one", 70),
                ("skill-rank", "skill-one", 1234),
                ("boss-kc", "boss-one", 12),
                ("boss-rank", "boss-one", 4321),
            },
        )

    def test_the_account_name_is_never_recorded(self):
        self.take()
        self.assertNotIn(
            "sentinel-account", "\n".join(json.dumps(entry) for entry in self.rows("osrs"))
        )

    def test_an_unreported_figure_is_absent_rather_than_zero(self):
        bosses = {
            "account": "sentinel-account",
            "skills": [{"name": "skill-one", "level": 70, "rank": None, "xp": 999999}],
            "bosses": [{"name": "boss-one", "kc": 12, "rank": -1}],
        }
        answers = all_panels(
            **{snapshot.panel_url(SITE, "boss-log"): FakeResponse(
                envelope("boss-log", "boss-log/v1", bosses),
                snapshot.panel_url(SITE, "boss-log"))}
        )
        self.take(answers)
        kinds = {entry["kind"] for entry in self.rows("osrs")}
        self.assertNotIn("skill-rank", kinds)
        self.assertNotIn("boss-rank", kinds)
        self.assertIn("skill-level", kinds)
        self.assertIn("unreported=2", self.stderr)

    def test_a_structurally_malformed_payload_refuses_the_run(self):
        for data in ({"repos": "not a list"}, {"repos": [{"name": 5}]}):
            with self.subTest(data=data):
                answers = all_panels(
                    **{snapshot.panel_url(SITE, "coding-projects"): FakeResponse(
                        envelope("coding-projects", "coding-projects/v1", data),
                        snapshot.panel_url(SITE, "coding-projects"))}
                )
                if data["repos"] == "not a list":
                    with self.assertRaises(ledger.LedgerError):
                        self.take(answers)
                else:
                    # A row with an unusable name is skipped and counted; the
                    # panel is not malformed, that repository is unnamed.
                    self.take(answers)
                    self.assertEqual(self.rows("projects"), [])


class SnapshotArchiveTest(SnapshotCase):
    """The envelope behind a reading is kept, one file per stream per day."""

    def test_the_envelope_is_archived_and_the_digest_names_it(self):
        self.take()
        archived = self.ledger / "raw" / "github" / ("%s.json.gz" % TODAY)
        self.assertTrue(archived.is_file())
        stored = json.loads(gzip.decompress(archived.read_bytes()).decode("utf-8"))
        self.assertEqual(stored["id"], "vcs-activity")
        digests = {entry["raw"] for entry in self.rows("github")}
        self.assertEqual(len(digests), 1)
        self.assertTrue(next(iter(digests)).startswith("sha256:"))

    def test_a_second_reading_the_same_day_replaces_the_archive(self):
        self.take()
        answers = all_panels(
            **{snapshot.panel_url(SITE, "vcs-activity"): FakeResponse(
                envelope("vcs-activity", "vcs-activity/v1", activity(streak=9)),
                snapshot.panel_url(SITE, "vcs-activity"))}
        )
        self.take(answers)
        self.assertEqual(len(list((self.ledger / "raw" / "github").iterdir())), 1)
        stored = json.loads(
            gzip.decompress(
                (self.ledger / "raw" / "github" / ("%s.json.gz" % TODAY)).read_bytes()
            ).decode("utf-8")
        )
        self.assertEqual(stored["data"]["streak"], 9)

    def test_a_second_identical_reading_appends_nothing(self):
        appended, _, _ = self.take()
        self.assertGreater(appended, 0)
        self.assertEqual(self.take()[0], 0)

    def test_the_record_is_private(self):
        self.take()
        self.assertEqual(stat.S_IMODE(self.ledger.stat().st_mode), 0o700)
        self.assertEqual(
            stat.S_IMODE((self.ledger / "github" / "2026.ndjson").stat().st_mode), 0o600
        )


class SnapshotCommandTest(SnapshotCase):
    """The command-line surface's own refusals."""

    def test_a_day_that_is_not_a_calendar_day_is_refused(self):
        with contextlib.redirect_stderr(io.StringIO()) as captured:
            status = snapshot.main(
                ["--ledger", str(self.ledger), "--site", SITE, "--today", "2026-99-99"]
            )
        self.assertEqual(status, 2)
        self.assertIn("calendar day", captured.getvalue())

    def test_a_ledger_whose_parent_is_missing_is_refused(self):
        with contextlib.redirect_stderr(io.StringIO()) as captured:
            status = snapshot.main(
                ["--ledger", str(self.scratch / "nowhere" / "ledger"), "--site", SITE]
            )
        self.assertEqual(status, 2)
        self.assertIn("no such ledger directory", captured.getvalue())

    def test_a_refusal_is_reported_without_a_traceback(self):
        with contextlib.redirect_stderr(io.StringIO()) as captured:
            status = snapshot.main(["--ledger", str(self.ledger), "--site", "http://x"])
        self.assertEqual(status, 1)
        self.assertIn("https only", captured.getvalue())


GH_STUB = """#!/bin/sh
printf '%s\\n' "$*" >> "$GH_CALLS"
if [ -f "$GH_FAIL_ONCE" ]; then
  rm -f "$GH_FAIL_ONCE"
  printf 'HTTP 403: rate limit exceeded\\nRetry-After: 7\\n' >&2
  exit 1
fi
if [ -f "$GH_FAIL_ALWAYS" ]; then
  printf 'HTTP 404: not found\\n' >&2
  exit 1
fi
case "$*" in
  *"api user --jq .login"*) printf 'sentinel-login\\n' ;;
  *graphql*) cat "$GH_FIXTURES/graphql.json" ;;
  *"user/repos"*) cat "$GH_FIXTURES/repos.json" ;;
  *page=1) cat "$GH_FIXTURES/commits-1.json" ;;
  *) cat "$GH_FIXTURES/commits-2.json" ;;
esac
"""


def calendar_document(days):
    return {
        "data": {
            "viewer": {
                "contributionsCollection": {
                    "contributionCalendar": {
                        "weeks": [
                            {
                                "contributionDays": [
                                    {"date": day, "contributionCount": count}
                                    for day, count in days
                                ]
                            }
                        ]
                    }
                }
            }
        }
    }


class BackfillTest(unittest.TestCase):
    """The owner-run job, against a stub CLI on PATH."""

    def setUp(self):
        self.scratch = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.scratch, ignore_errors=True)
        self.ledger = self.scratch / "ledger"
        self.fixtures = self.scratch / "fixtures"
        self.fixtures.mkdir()
        stubs = self.scratch / "stubs"
        stubs.mkdir()
        stub = stubs / "gh"
        stub.write_text(GH_STUB, encoding="utf-8")
        stub.chmod(stub.stat().st_mode | stat.S_IXUSR)
        self.calls = self.scratch / "gh-calls"
        previous = dict(os.environ)
        self.addCleanup(lambda: (os.environ.clear(), os.environ.update(previous)))
        os.environ["PATH"] = "%s%s%s" % (stubs, os.pathsep, os.environ.get("PATH", ""))
        os.environ["GH_CALLS"] = str(self.calls)
        os.environ["GH_FIXTURES"] = str(self.fixtures)
        os.environ["GH_FAIL_ONCE"] = str(self.scratch / "fail-once")
        os.environ["GH_FAIL_ALWAYS"] = str(self.scratch / "fail-always")
        self.write_fixture(
            "graphql.json",
            calendar_document([("2026-01-01", 3), ("2026-01-02", 0), ("2026-01-03", 5)]),
        )
        self.write_fixture("repos.json", [{"full_name": "sentinel-login/repo-one"}])
        self.write_fixture(
            "commits-1.json",
            [
                {"sha": "%040x" % index, "commit": {"author": {"date": "2026-01-01T10:00:00Z"}}}
                for index in range(backfill.PAGE_SIZE)
            ],
        )
        self.write_fixture(
            "commits-2.json",
            [{"sha": "b" * 40, "commit": {"author": {"date": "2026-01-02T10:00:00Z"}}}],
        )

    def write_fixture(self, name, document):
        (self.fixtures / name).write_text(json.dumps(document), encoding="utf-8")

    def run_backfill(self, first=2026, last=2026, sleeper=None):
        with contextlib.redirect_stderr(io.StringIO()) as captured:
            result = backfill.backfill(
                self.ledger, first, last, NOW, "backfill", sleeper or (lambda seconds: None)
            )
        self.stderr = captured.getvalue()
        return result

    def rows(self, year="2026"):
        path = self.ledger / "github" / ("%s.ndjson" % year)
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]

    def test_the_login_is_read_at_run_time_rather_than_carried(self):
        self.run_backfill()
        calls = self.calls.read_text(encoding="utf-8")
        self.assertIn("api user --jq .login", calls)
        self.assertNotIn("sentinel-login", (_SCRIPTS / "ledger_backfill_github.py").read_text(
            encoding="utf-8"
        ))
        # The login it read is what the commit query filtered on.
        self.assertIn("author=sentinel-login", calls)

    def test_a_years_contributions_are_recorded_as_backfill(self):
        self.run_backfill()
        contributions = {
            (entry["day"], entry["value"])
            for entry in self.rows()
            if entry["kind"] == "contributions"
        }
        self.assertEqual(contributions, {("2026-01-01", 3), ("2026-01-03", 5)})
        self.assertEqual(
            {entry["method"] for entry in self.rows() if entry["kind"] == "contributions"},
            {"backfill"},
        )

    def test_commits_are_paginated_until_a_short_page(self):
        self.run_backfill()
        commits = [entry for entry in self.rows() if entry["kind"] == "commit"]
        self.assertEqual(len(commits), backfill.PAGE_SIZE + 1)
        calls = self.calls.read_text(encoding="utf-8")
        self.assertIn("page=1", calls)
        self.assertIn("page=2", calls)
        self.assertNotIn("page=3", calls)
        self.assertEqual({entry["source"] for entry in commits}, {"repo-one"})

    def test_a_second_run_appends_nothing(self):
        appended, _ = self.run_backfill()
        self.assertGreater(appended, 0)
        self.assertEqual(self.run_backfill(), (0, appended))

    def test_a_non_zero_exit_refuses_the_whole_run(self):
        (self.scratch / "fail-always").write_text("", encoding="utf-8")
        with self.assertRaises(ledger.LedgerError) as caught:
            self.run_backfill()
        self.assertIn("refused a request", str(caught.exception))
        self.assertFalse((self.ledger / "github").exists())

    def test_a_rate_limited_response_waits_and_retries(self):
        (self.scratch / "fail-once").write_text("", encoding="utf-8")
        waited = []
        self.run_backfill(sleeper=waited.append)
        self.assertEqual(waited, [7])
        self.assertTrue(self.rows())
        self.assertIn("rate limiting", self.stderr)

    def test_a_malformed_calendar_refuses_the_run(self):
        self.write_fixture("graphql.json", {"data": {"viewer": {}}})
        with self.assertRaises(ledger.LedgerError):
            self.run_backfill()

    def test_a_malformed_day_refuses_the_run(self):
        self.write_fixture("graphql.json", calendar_document([("2026-99-99", 3)]))
        with self.assertRaises(ledger.LedgerError):
            self.run_backfill()

    def test_a_repository_listing_without_a_full_name_refuses(self):
        self.write_fixture("repos.json", [{"name": "repo-one"}])
        with self.assertRaises(ledger.LedgerError):
            self.run_backfill()

    def test_the_year_range_is_bounded(self):
        with contextlib.redirect_stderr(io.StringIO()) as captured:
            status = backfill.main(
                ["--ledger", str(self.ledger), "--from", "1999", "--to", "2026"]
            )
        self.assertEqual(status, 2)
        self.assertIn("2008", captured.getvalue())

    def test_a_range_running_into_the_future_is_refused(self):
        with contextlib.redirect_stderr(io.StringIO()):
            status = backfill.main(
                ["--ledger", str(self.ledger), "--from", "2026", "--to", "3000"]
            )
        self.assertEqual(status, 2)


if __name__ == "__main__":
    unittest.main()
