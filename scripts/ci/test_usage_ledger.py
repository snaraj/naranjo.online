"""Contract tests for the append-only lifelong record (issue #267).

The module under test lives one directory up, at `scripts/usage_ledger.py`;
its test lives HERE because the gate discovers tests with `-s scripts/ci`. It
is loaded by path so neither directory has to become a package.

Three contracts carry the weight, and each has hostile cases rather than a
happy path:

* **Append-only means append-only.** A run appends what is NEW and nothing
  else, writes with `O_APPEND` and one fsync, and never rewrites a line it
  has already written. The tests below prove the dedup in both directions,
  prove the syscalls rather than assuming them, and prove that a run which
  measured nothing leaves the file byte-identical.
* **Malformed refuses rather than forgets.** One fault is tolerated — the
  partial final line an interrupted append leaves — and it is repaired and
  reported. Every other damage refuses the run naming the line, because a
  reader that skips what it cannot parse turns corruption into silent data
  loss. That is the history store's rule, and this record keeps it.
* **The archive deletes only what it wrote.** Retention prunes per-run raw
  captures older than a month, matched against the exact name pattern the
  program generates, so a decoy file and every `.last` archive survive.

`test_ledger_snapshot.py` carries the two network-facing programs that write
into the same record.
"""

from __future__ import annotations

import ast
import datetime
import gzip
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import sqlite3
import stat
import contextlib
import csv
import shutil
import tempfile
import time
import unittest


def setUpModule():
    # Days here are LOCAL calendar days (issue #276), so the expectations
    # below depend on the process timezone; TZ=UTC pins the suite
    # deterministic on every machine, exactly as the sibling suites pin it.
    os.environ["TZ"] = "UTC"
    time.tzset()


_SCRIPTS = pathlib.Path(__file__).resolve().parents[1]


def _load(name):
    spec = importlib.util.spec_from_file_location(name, _SCRIPTS / ("%s.py" % name))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ledger = _load("usage_ledger")
exporter = _load("export_usage_series")

NOW = datetime.datetime(2026, 9, 11, 7, 39, 8, tzinfo=datetime.timezone.utc)
STAMP = "2026-09-11T07:39:08Z"
TODAY = "2026-09-11"
YESTERDAY = "2026-09-10"
SOURCE = "alpha"
EXPORTER = "abc123def456"
# A raw model identity no vocabulary names (issue #371).
UNNAMED = "sentinel-unnamed-9.1"


def row(**overrides):
    """One admissible usage row, with whatever a test wants changed."""
    base = {
        "schema": "ledger/v1",
        "day": YESTERDAY,
        "stream": "usage",
        "source": SOURCE,
        "kind": "total",
        "key": "tokens",
        "value": 10,
        "unit": "tokens",
        "capturedAt": STAMP,
        "method": "store",
        "exporter": EXPORTER,
    }
    base.update(overrides)
    return base


def written_lines(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def imported_roots(tree):
    """Every top-level module name a parsed source imports."""
    roots = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            roots.add(node.module.split(".")[0])
    return roots


class LedgerTestCase(unittest.TestCase):
    def setUp(self):
        self.scratch = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.scratch, ignore_errors=True)
        self.ledger = self.scratch / "ledger"

    def stream_file(self, stream="usage", year="2026"):
        return self.ledger / stream / ("%s.ndjson" % year)

    def append(self, *rows, stream="usage"):
        with contextlib.redirect_stderr(io.StringIO()) as captured:
            result = ledger.append_rows(self.ledger, stream, list(rows))
        self.stderr = captured.getvalue()
        return result


class AppendRuleTest(LedgerTestCase):
    """The heart of it: only what is new is written, and nothing is rewritten."""

    def test_an_unchanged_figure_appends_nothing(self):
        self.assertEqual(self.append(row()), (1, 0))
        before = self.stream_file().read_bytes()
        self.assertEqual(self.append(row()), (0, 1))
        self.assertEqual(self.stream_file().read_bytes(), before)

    def test_a_changed_figure_appends_beside_the_old_one(self):
        self.append(row(value=10))
        self.assertEqual(self.append(row(value=11)), (1, 0))
        self.assertEqual([entry["value"] for entry in written_lines(self.stream_file())], [10, 11])

    def test_the_index_takes_the_last_row_for_an_identity(self):
        # Three readings of one figure, and the dedup compares against the
        # LAST. A first-wins index would re-append the middle value forever.
        self.append(row(value=10))
        self.append(row(value=11))
        self.append(row(value=12))
        self.assertEqual(self.append(row(value=12)), (0, 1))
        self.assertEqual(self.append(row(value=10)), (1, 0))
        self.assertEqual(
            [entry["value"] for entry in written_lines(self.stream_file())],
            [10, 11, 12, 10],
        )

    def test_one_identity_is_day_source_kind_and_key(self):
        # Four rows that differ in exactly one field each are four figures,
        # not four readings of one.
        self.append(row())
        self.assertEqual(self.append(row(day=TODAY)), (1, 0))
        self.assertEqual(self.append(row(source="beta")), (1, 0))
        self.assertEqual(self.append(row(kind="category", key="input")), (1, 0))
        self.assertEqual(self.append(row(kind="category", key="output")), (1, 0))

    def test_rows_land_in_the_year_file_their_day_belongs_to(self):
        self.append(row(day="2025-12-31"), row(day="2026-01-01"))
        self.assertEqual(len(written_lines(self.stream_file(year="2025"))), 1)
        self.assertEqual(len(written_lines(self.stream_file(year="2026"))), 1)

    def test_a_run_that_changes_nothing_creates_nothing(self):
        # Not merely "writes no line": an empty run opens no file and creates
        # no directory, so a record nothing has ever written to stays absent.
        self.assertEqual(self.append(), (0, 0))
        self.assertFalse((self.ledger / "usage").exists())

    def test_a_session_re_appends_when_its_total_moves(self):
        session = {
            "schema": "ledger/v1",
            "day": YESTERDAY,
            "stream": "sessions",
            "source": SOURCE,
            "kind": "session",
            "key": "2026-09-10T09:00:00Z",
            "value": 3600,
            "unit": "seconds",
            "capturedAt": STAMP,
            "method": "capture",
            "exporter": EXPORTER,
            "startedAt": "2026-09-10T09:00:00Z",
            "endedAt": "2026-09-10T10:00:00Z",
            "total": 500,
            "categories": {"input": 500},
            "models": ["member-one"],
        }
        self.assertEqual(self.append(session, stream="sessions"), (1, 0))
        self.assertEqual(self.append(dict(session), stream="sessions"), (0, 1))
        # The duration is unchanged and the tokens are not: a session that
        # spent more in the same wall-clock hour IS new information.
        moved = dict(session, total=900)
        self.assertEqual(self.append(moved, stream="sessions"), (1, 0))

    def running_session(self, captured, ended, total):
        return {
            "schema": "ledger/v1",
            "day": YESTERDAY,
            "stream": "sessions",
            "source": SOURCE,
            "kind": "session",
            "key": "2026-09-10T09:00:00Z",
            "value": int(
                (ledger.parse_instant(ended) - ledger.parse_instant("2026-09-10T09:00:00Z")).total_seconds()
            ),
            "unit": "seconds",
            "capturedAt": captured,
            "method": "capture",
            "exporter": EXPORTER,
            "startedAt": "2026-09-10T09:00:00Z",
            "endedAt": ended,
            "total": total,
            "categories": {"input": total},
            "models": ["member-one"],
        }

    def test_a_running_session_is_recorded_at_most_once_per_window(self):
        # Issue #358: a run every few minutes re-read every running session
        # and wrote a superseded row for each, megabytes a day. Inside the
        # window a running session's changed reading waits; once the window
        # since its last RECORDED reading has passed, the next one lands.
        first = self.running_session("2026-09-10T10:00:00Z", "2026-09-10T09:59:30Z", 100)
        self.assertEqual(self.append(first, stream="sessions"), (1, 0))
        for minute, total in ((3, 200), (6, 300), (14, 400)):
            captured = "2026-09-10T10:%02d:00Z" % minute
            reading = self.running_session(captured, "2026-09-10T10:%02d:30Z" % (minute - 1), total)
            self.assertEqual(self.append(reading, stream="sessions"), (0, 1), captured)
        late = self.running_session("2026-09-10T10:15:00Z", "2026-09-10T10:14:30Z", 500)
        self.assertEqual(self.append(late, stream="sessions"), (1, 0))
        written = (self.ledger / "sessions" / "2026.ndjson").read_text(encoding="utf-8").splitlines()
        self.assertEqual([json.loads(line)["total"] for line in written], [100, 500])

    def test_a_settled_session_always_records_the_figure_it_finished_on(self):
        # The guarantee the throttle rests on: once a session has been idle a
        # whole window, its final reading is written at the next run however
        # recently the last one was, so no final figure is ever lost.
        running = self.running_session("2026-09-10T10:00:00Z", "2026-09-10T09:59:30Z", 100)
        self.append(running, stream="sessions")
        stopped = self.running_session("2026-09-10T10:04:00Z", "2026-09-10T10:01:00Z", 150)
        self.assertEqual(self.append(stopped, stream="sessions"), (0, 1))
        settled = self.running_session("2026-09-10T10:16:00Z", "2026-09-10T10:01:00Z", 150)
        self.assertEqual(self.append(settled, stream="sessions"), (1, 0))
        self.assertEqual(ledger.resolve(self.ledger, "sessions")[
            (YESTERDAY, SOURCE, "session", "2026-09-10T09:00:00Z")]["total"], 150)
        # And nothing more once it has been written.
        later = self.running_session("2026-09-10T10:30:00Z", "2026-09-10T10:01:00Z", 150)
        self.assertEqual(self.append(later, stream="sessions"), (0, 1))

    def collided(self):
        # Two record files that began in the same second, as the walk reports
        # them: one identity, two different readings.
        return [
            {"startedAt": "2026-09-10T09:00:00Z", "endedAt": "2026-09-10T09:30:00Z",
             "total": 300, "categories": {"input": 100, "output": 200}, "models": ["member-two"]},
            {"startedAt": "2026-09-10T09:00:00Z", "endedAt": "2026-09-10T10:00:00Z",
             "total": 500, "categories": {"input": 500}, "models": ["member-one", "member-two"]},
        ]

    def session_block_rows(self, entries):
        return ledger.session_rows(SOURCE, entries, STAMP, EXPORTER, None)

    def test_sessions_sharing_a_start_are_one_reading_and_stop_re_appending(self):
        # Issue #358: two files sharing a start instant were two rows under one
        # identity, so EVERY run appended both again (each "changed" the one
        # before it) — 94% of a 117 MiB stream in a month. They are one
        # reading now, and an unchanged walk appends nothing.
        rows = self.session_block_rows(self.collided())
        self.assertEqual(len(rows), 1)
        merged = rows[0]
        self.assertEqual(merged["endedAt"], "2026-09-10T10:00:00Z")
        self.assertEqual(merged["value"], 3600)
        self.assertEqual(merged["total"], 800)
        self.assertEqual(merged["categories"], {"input": 600, "output": 200})
        self.assertEqual(self.append(*rows, stream="sessions"), (1, 0))
        for _ in range(3):
            again = self.session_block_rows(self.collided())
            self.assertEqual(self.append(*again, stream="sessions"), (0, 1))

    def test_the_merged_reading_does_not_depend_on_walk_order(self):
        forward = self.session_block_rows(self.collided())
        backward = self.session_block_rows(list(reversed(self.collided())))
        self.assertEqual(forward, backward)

    def test_a_malformed_session_is_refused_before_anything_is_merged(self):
        for field, bad in (("total", "300"), ("total", True), ("categories", []),
                           ("models", "member-one"), ("endedAt", 7)):
            entries = self.collided()
            entries[0][field] = bad
            with self.subTest(field=field, bad=bad), self.assertRaises(ledger.LedgerError):
                self.session_block_rows(entries)

    def test_a_member_the_merge_would_hide_is_refused_on_its_own(self):
        # Each member alone never reaches the record, so it does not merged
        # either: summing would absorb a negative count into a positive one,
        # and the other member's later end would cover an earlier or
        # malformed one.
        for field, bad in (("total", -100), ("categories", {"input": -100, "output": 200}),
                           ("endedAt", "2026-09-10T08:30:00Z"), ("endedAt", "2026-09-10T09:30:00+00:00")):
            for member in (0, 1):
                entries = self.collided()
                entries[member][field] = bad
                for given in ([entries[member]], entries):
                    with self.subTest(field=field, bad=bad, member=member, merged=len(given) > 1):
                        with self.assertRaises(ledger.LedgerError):
                            self.append(*self.session_block_rows(given), stream="sessions")
        self.assertFalse((self.ledger / "sessions").exists())

    def test_a_session_first_recorded_without_identities_is_recorded_once_with_them(self):
        # Issue #371: a row written before sessions carried their raw
        # identities stays a valid reading; the first run that knows them
        # records the session once more WITH them, and then never again while
        # they hold. A malformed list refuses like any other session field.
        settled = self.running_session("2026-09-10T11:00:00Z", "2026-09-10T10:00:00Z", 100)
        self.assertEqual(self.append(settled, stream="sessions"), (1, 0))
        known = dict(settled, capturedAt="2026-09-10T11:30:00Z", modelIds=[UNNAMED, "~unidentified"])
        self.assertEqual(self.append(known, stream="sessions"), (1, 0))
        again = dict(known, capturedAt="2026-09-10T12:00:00Z")
        self.assertEqual(self.append(again, stream="sessions"), (0, 1))
        for bad in ([UNNAMED, UNNAMED], ["a sentence nobody may read"], UNNAMED, [17]):
            with self.subTest(bad=bad), self.assertRaises(ledger.LedgerError):
                self.append(dict(known, modelIds=bad), stream="sessions")

    def test_sessions_sharing_a_start_merge_their_identities(self):
        entries = self.collided()
        entries[0]["modelIds"] = [UNNAMED]
        entries[1]["modelIds"] = ["avendor-one", UNNAMED]
        (merged,) = self.session_block_rows(entries)
        self.assertEqual(sorted(merged["modelIds"]), sorted(["avendor-one", UNNAMED]))
        self.assertEqual(len(merged["modelIds"]), 2)

    def test_the_window_is_the_sessions_stream_alone(self):
        # A day's running usage figure is not a session and is never deferred.
        first = row(capturedAt="2026-09-10T10:00:00Z", value=10)
        moved = row(capturedAt="2026-09-10T10:01:00Z", value=20)
        self.assertEqual(self.append(first), (1, 0))
        self.assertEqual(self.append(moved), (1, 0))


class FileMechanicsTest(LedgerTestCase):
    """The syscalls, proven rather than assumed."""

    def test_the_append_opens_with_o_append_and_fsyncs(self):
        flags = []
        synced = []
        real_open = os.open
        real_fsync = os.fsync

        def watched_open(path, mode, *rest):
            flags.append(mode)
            return real_open(path, mode, *rest)

        def watched_fsync(handle):
            synced.append(handle)
            return real_fsync(handle)

        os.open = watched_open
        os.fsync = watched_fsync
        self.addCleanup(setattr, os, "open", real_open)
        self.addCleanup(setattr, os, "fsync", real_fsync)
        self.append(row())
        os.open = real_open
        os.fsync = real_fsync
        appending = [mode for mode in flags if mode & os.O_APPEND]
        self.assertEqual(len(appending), 1, flags)
        self.assertTrue(appending[0] & os.O_CREAT)
        self.assertTrue(appending[0] & os.O_WRONLY)
        self.assertFalse(appending[0] & os.O_TRUNC)
        self.assertTrue(synced, "the append did not fsync")

    def test_the_record_is_private(self):
        self.append(row())
        self.assertEqual(stat.S_IMODE(self.stream_file().stat().st_mode), 0o600)
        self.assertEqual(
            stat.S_IMODE((self.ledger / "usage").stat().st_mode), 0o700
        )
        self.assertEqual(stat.S_IMODE(self.ledger.stat().st_mode), 0o700)

    def test_every_line_is_one_object_terminated_by_a_newline(self):
        self.append(row(), row(day=TODAY))
        text = self.stream_file().read_text(encoding="utf-8")
        self.assertTrue(text.endswith("\n"))
        self.assertEqual(len(text.splitlines()), 2)
        self.assertNotIn("\n}", text)


class PartialLineTest(LedgerTestCase):
    """The ONE tolerated fault, repaired and reported."""

    def test_an_interrupted_write_is_truncated_and_the_run_continues(self):
        self.append(row())
        path = self.stream_file()
        with open(path, "a", encoding="utf-8") as handle:
            handle.write('{"schema":"ledger/v1","day":"2026-09-1')
        self.append(row(value=11))
        lines = written_lines(path)
        self.assertEqual([entry["value"] for entry in lines], [10, 11])
        self.assertIn("repaired a partial line", self.stderr)

    def test_a_partial_first_line_leaves_an_empty_file(self):
        path = self.stream_file()
        path.parent.mkdir(parents=True)
        path.write_text('{"schema":"ledg', encoding="utf-8")
        self.append(row())
        self.assertEqual([entry["value"] for entry in written_lines(path)], [10])

    def test_a_complete_file_is_never_truncated(self):
        # Non-vacuity for the repair: it must not fire on a healthy file.
        self.append(row())
        before = self.stream_file().read_bytes()
        self.append(row())
        self.assertEqual(self.stream_file().read_bytes(), before)
        self.assertNotIn("repaired", self.stderr)


class MalformedLineTest(LedgerTestCase):
    """Everything else refuses the run, naming the line."""

    def stage(self, text):
        path = self.stream_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(row()) + "\n" + text + "\n", encoding="utf-8")
        return path

    def refuses(self, text, fragment):
        self.stage(text)
        with self.assertRaises(ledger.LedgerError) as caught:
            self.append(row(value=99))
        message = str(caught.exception)
        self.assertIn("line 2", message)
        self.assertIn(fragment, message)
        return message

    def test_a_line_that_is_not_json_refuses(self):
        self.refuses("{not json", "not parsable JSON")

    def test_a_line_that_is_not_utf8_refuses_naming_its_line(self):
        # A ValueError, not an OSError, and raised by a whole-file decode
        # BEFORE the per-line loop — so it once escaped as a traceback rather
        # than the line-numbered refusal every other malformed line gets
        # (PR #312 review, finding 3).
        self.append(row())
        with open(self.stream_file(), "ab") as handle:
            handle.write(b'{"schema": "ledger/v1", "note": "\xff"}\n')
        with self.assertRaises(ledger.LedgerError) as caught:
            self.append(row(value=99))
        self.assertIn("line 2", str(caught.exception))
        self.assertIn("not UTF-8", str(caught.exception))

    def test_a_line_with_the_wrong_schema_refuses(self):
        self.refuses(json.dumps(row(schema="ledger/v2")), "expected schema")

    def test_a_line_from_another_stream_refuses(self):
        self.refuses(json.dumps(row(stream="github")), "different stream")

    def test_a_negative_value_refuses(self):
        self.refuses(json.dumps(row(value=-1)), "non-negative integer")

    def test_a_boolean_value_refuses(self):
        # `True` is an int in Python; a record of booleans-as-ones is not a
        # record of figures.
        self.refuses(json.dumps(row(value=True)), "non-negative integer")

    def test_a_day_that_is_not_a_calendar_day_refuses(self):
        self.refuses(json.dumps(row(day="2026-99-99")), "calendar day")

    def test_a_kind_outside_the_stream_refuses(self):
        self.refuses(json.dumps(row(kind="session")), "closed vocabulary")

    def test_a_unit_outside_the_vocabulary_refuses(self):
        self.refuses(json.dumps(row(unit="bytes")), "unit vocabulary")

    def test_a_method_outside_the_vocabulary_refuses(self):
        self.refuses(json.dumps(row(method="guess")), "method vocabulary")

    def test_a_malformed_instant_refuses(self):
        self.refuses(json.dumps(row(capturedAt="2026-09-11 07:39:08")), "RFC 3339")

    def test_an_unknown_field_refuses(self):
        self.refuses(json.dumps(row(note="hello")), "unknown field")

    def test_a_missing_field_refuses(self):
        broken = row()
        del broken["exporter"]
        self.refuses(json.dumps(broken), "carries no exporter")

    def test_a_malformed_digest_refuses(self):
        self.refuses(json.dumps(row(raw="sha256:nothex")), "sha256 digest")

    def test_a_key_with_a_newline_refuses(self):
        self.refuses(json.dumps(row(key="tokens\nmore")), "printable text")

    def test_an_empty_line_refuses(self):
        self.refuses("", "it is empty")

    def test_the_refusal_leaves_the_file_untouched(self):
        path = self.stage(json.dumps(row(value=-1)))
        before = path.read_bytes()
        with self.assertRaises(ledger.LedgerError):
            self.append(row(value=99))
        self.assertEqual(path.read_bytes(), before)

    def test_a_row_this_module_builds_takes_the_same_admission(self):
        # The writer and the reader share one admission, so a rule cannot
        # hold on read and not on write.
        with self.assertRaises(ledger.LedgerError):
            self.append(row(value=-5))

    def test_a_raw_identity_kind_admits_only_an_identity_key(self):
        # Issue #371: the raw-identity kinds carry the tool's own model string,
        # so their key is held to the capture's identity shape rather than to
        # bounded printable text — a sentence or a path is never a model here.
        for kind, key in (
            ("model-id", UNNAMED),
            ("model-id", "~unidentified"),
            ("model-id-category", UNNAMED + "/input"),
            ("model-id-stat", "~unidentified/cache-read"),
        ):
            with self.subTest(kind=kind, key=key):
                ledger.admit_row(row(kind=kind, key=key), "usage")
        for kind, key in (
            ("model-id", "a sentence nobody may read"),
            ("model-id", "Upper-Case"),
            ("model-id", UNNAMED + "/input"),
            ("model-id-category", UNNAMED),
            ("model-id-category", "/home/someone/x/input"),
            ("model-id-category", UNNAMED + "/private-class"),
            ("model-id-stat", "a sentence/input"),
        ):
            with self.subTest(kind=kind, key=key):
                self.refuses(json.dumps(row(kind=kind, key=key)), "not a raw model identity")


class AdmissionVerdictTest(unittest.TestCase):
    """The admission checks every run repeats over every stored row, made
    cheap without moving a single verdict (issue #358)."""

    def setUp(self):
        ledger.INSTANT_VERDICTS.clear()
        self.addCleanup(ledger.INSTANT_VERDICTS.clear)

    @staticmethod
    def parses(value):
        try:
            datetime.datetime.strptime(value, ledger.INSTANT_FORMAT)
        except ValueError:
            return False
        return True

    def test_a_remembered_instant_verdict_is_the_parse_verdict(self):
        # Asked twice, so the second answer comes from memory: a memory that
        # ever answered differently from the parse would admit or refuse a
        # row the parse decides the other way.
        for value in (
            STAMP,
            "2026-09-11 07:39:08",
            "2026-99-99T99:99:99Z",
            "2026-02-30T00:00:00Z",
            "2026-9-1T7:3:8Z",
            STAMP + " ",
            "",
        ):
            for attempt in ("parsed", "remembered"):
                with self.subTest(value=value, attempt=attempt):
                    self.assertIs(ledger.valid_instant(value), self.parses(value))
        self.assertTrue(ledger.INSTANT_VERDICTS)

    def test_a_value_that_is_not_a_string_is_refused_and_not_remembered(self):
        # Refused BEFORE the memory is asked: a list or a dict is not
        # hashable, and a lookup first would crash the run on a malformed row
        # instead of refusing it by name.
        for value in (None, 17, ["2026-09-11T07:39:08Z"], {"at": STAMP}):
            with self.subTest(value=value):
                self.assertFalse(ledger.valid_instant(value))
        self.assertEqual(ledger.INSTANT_VERDICTS, {})

    def test_the_memory_is_bounded(self):
        bound = ledger.MAX_INSTANT_VERDICTS
        ledger.MAX_INSTANT_VERDICTS = 4
        self.addCleanup(setattr, ledger, "MAX_INSTANT_VERDICTS", bound)
        for second in range(10):
            value = "2026-09-11T07:39:%02dZ" % second
            self.assertTrue(ledger.valid_instant(value))
            self.assertLessEqual(len(ledger.INSTANT_VERDICTS), 4)

    def test_a_name_is_printable_exactly_when_every_character_is(self):
        # The whole-string test against the per-character definition it
        # replaced, over every code point below U+3000: the controls, the
        # separators, and the scripts a name could plausibly carry.
        for code in range(0x3000):
            name = "a%sb" % chr(code)
            with self.subTest(code=code):
                self.assertIs(
                    ledger.valid_name(name),
                    all(character.isprintable() for character in name),
                )


class ResolutionTest(LedgerTestCase):
    """One rule, in one place, for every consumer."""

    def test_a_verified_reading_beats_a_larger_stored_one(self):
        self.append(row(value=900, method="store"))
        self.append(row(value=100, method="verified", capturedAt="2026-09-11T08:00:00Z"))
        current = ledger.resolve(self.ledger, "usage")
        self.assertEqual(current[(YESTERDAY, SOURCE, "total", "tokens")]["value"], 100)

    def test_the_latest_verified_reading_wins(self):
        self.append(row(value=100, method="verified", capturedAt="2026-09-11T08:00:00Z"))
        self.append(row(value=90, method="verified", capturedAt="2026-09-11T09:00:00Z"))
        current = ledger.resolve(self.ledger, "usage")
        self.assertEqual(current[(YESTERDAY, SOURCE, "total", "tokens")]["value"], 90)

    def test_a_verified_reading_equal_in_value_is_still_appended_with_its_method(self):
        # Provenance: the record promises every figure anyone measured, how,
        # and when. A verified reading equal in value to the stored one used
        # to be deduplicated away, so resolve() reported method=store for the
        # very day the owner verified (PR #312 review, finding 4).
        self.assertEqual(self.append(row(value=100, method="store")), (1, 0))
        self.assertEqual(
            self.append(row(value=100, method="verified", capturedAt="2026-09-11T08:00:00Z")),
            (1, 0),
        )
        current = ledger.resolve(self.ledger, "usage")
        self.assertEqual(current[(YESTERDAY, SOURCE, "total", "tokens")]["method"], "verified")
        # The same reading read again is still nothing new.
        self.assertEqual(
            self.append(row(value=100, method="verified", capturedAt="2026-09-11T09:00:00Z")),
            (0, 1),
        )

    def test_two_methods_on_one_day_each_dedup_against_their_own_last_row(self):
        # On a baseline's as-of day the capture's lifetime figure and the
        # owner's baseline carry one value by construction; each is appended
        # once and then nothing new against ITS OWN last row — not appended
        # again every run because the other method's row came between
        # (PR #312 round 2, finding 2).
        self.assertEqual(
            self.append(row(value=1000, method="capture"), row(value=1000, method="baseline")),
            (2, 0),
        )
        self.assertEqual(
            self.append(row(value=1000, method="capture"), row(value=1000, method="baseline")),
            (0, 2),
        )
        self.assertEqual(
            self.append(row(value=1000, method="baseline"), row(value=1000, method="capture")),
            (0, 2),
        )

    def test_a_row_the_module_builds_is_admitted_at_the_append_and_nowhere_else(self):
        # One admission point (PR #312 review, finding 5): make_row builds,
        # append_rows admits. A row built with a kind outside its stream's
        # vocabulary is refused when appended, not when built.
        built = ledger.make_row(
            YESTERDAY, "usage", SOURCE, "no-such-kind", "tokens", 1, "tokens", STAMP, "store", EXPORTER
        )
        self.assertEqual(built["kind"], "no-such-kind")
        with self.assertRaises(ledger.LedgerError):
            self.append(built)

    def test_a_stored_reading_never_lowers_a_verified_one(self):
        self.append(row(value=100, method="verified", capturedAt="2026-09-11T08:00:00Z"))
        self.append(row(value=900, method="store", capturedAt="2026-09-11T09:00:00Z"))
        current = ledger.resolve(self.ledger, "usage")
        self.assertEqual(current[(YESTERDAY, SOURCE, "total", "tokens")]["value"], 100)

    def test_the_largest_reading_wins_among_the_rest(self):
        self.append(row(value=10, method="store"))
        self.append(row(value=40, method="capture", capturedAt="2026-09-11T08:00:00Z"))
        self.append(row(value=20, method="store", capturedAt="2026-09-11T09:00:00Z"))
        current = ledger.resolve(self.ledger, "usage")
        self.assertEqual(current[(YESTERDAY, SOURCE, "total", "tokens")]["value"], 40)

    def test_a_session_resolves_to_its_latest_reading(self):
        session = {
            "schema": "ledger/v1",
            "day": YESTERDAY,
            "stream": "sessions",
            "source": SOURCE,
            "kind": "session",
            "key": "2026-09-10T09:00:00Z",
            "value": 3600,
            "unit": "seconds",
            "capturedAt": STAMP,
            "method": "capture",
            "exporter": EXPORTER,
            "startedAt": "2026-09-10T09:00:00Z",
            "endedAt": "2026-09-10T10:00:00Z",
            "total": 500,
            "categories": {"input": 500},
            "models": ["member-one"],
        }
        self.append(session, stream="sessions")
        # A LOWER duration, read later: a session's figures move while it
        # runs, so the newest reading is simply the current one.
        self.append(
            dict(session, value=60, endedAt="2026-09-10T09:01:00Z",
                 capturedAt="2026-09-11T08:00:00Z"),
            stream="sessions",
        )
        current = ledger.resolve(self.ledger, "sessions")
        self.assertEqual(
            current[(YESTERDAY, SOURCE, "session", "2026-09-10T09:00:00Z")]["value"], 60
        )


def capture_document(**overrides):
    """A capture document shaped as the exporter's own source section."""
    document = {
        "series": {"startDate": YESTERDAY, "totals": [10], "recorded": True},
        "categories": {"input": [4], "output": [6]},
        "windows": {"today": {"input": 0, "output": 0}, "week": {"input": 4, "output": 6}},
        "derived": {
            "peak-day": 10,
            "current-streak": 0,
            "longest-streak": 1,
            "active-days": 1,
            "tracked-days": 1,
        },
        "stats": {"lifetime": 1000, "sessions": 4},
        "capturedAt": STAMP,
    }
    document.update(overrides)
    return document


LEDGER_BLOCK = {
    "schema": "usage-capture-ledger/v1",
    "modelCategories": {
        "startDate": YESTERDAY,
        "members": [
            {"model": "member-one", "category": "input", "totals": [4]},
            {"model": "member-one", "category": "output", "totals": [6]},
        ],
    },
    "sessions": [
        {
            "startedAt": "2026-09-10T09:00:00Z",
            "endedAt": "2026-09-10T10:00:00Z",
            "total": 10,
            "categories": {"input": 4, "output": 6},
            "models": ["member-one"],
        }
    ],
}


class RecordRunCase(LedgerTestCase):
    """The shared staging for one export run: a store, a material, a record."""

    def setUp(self):
        super().setUp()
        self.history = self.scratch / "history"
        self.history.mkdir()

    def store(self, **days):
        (self.history / ("%s.json" % SOURCE)).write_text(
            json.dumps({"schema": "usage-history/v1", "days": days}), encoding="utf-8"
        )

    def record(self, material=None, baselines=None, today=TODAY, now=NOW):
        with contextlib.redirect_stderr(io.StringIO()) as captured:
            result = ledger.record_run(
                self.ledger,
                material if material is not None else {SOURCE: {"capture": capture_document()}},
                self.history,
                now,
                EXPORTER,
                today,
                baselines,
            )
        self.stderr = captured.getvalue()
        return result

    def rows(self, stream="usage", year="2026"):
        return written_lines(self.stream_file(stream, year))


class RecordRunTest(RecordRunCase):
    """What one export run puts in the record."""

    def test_the_stores_remembered_days_are_recorded_with_their_method(self):
        self.store(**{YESTERDAY: {"total": 10, "categories": {"input": 4, "output": 6}}})
        self.record()
        stored = [entry for entry in self.rows() if entry["method"] == "store"]
        self.assertEqual(
            sorted((entry["kind"], entry["key"], entry["value"]) for entry in stored),
            [("category", "input", 4), ("category", "output", 6), ("total", "tokens", 10)],
        )

    def test_a_verified_day_is_recorded_as_verified(self):
        self.store(**{YESTERDAY: {"total": 10}})
        (self.history / ("%s.verified.json" % SOURCE)).write_text(
            json.dumps(
                {
                    "schema": "usage-verified/v1",
                    "readings": {YESTERDAY: {"total": 10, "readOn": TODAY}},
                }
            ),
            encoding="utf-8",
        )
        self.record()
        methods = {entry["method"] for entry in self.rows() if entry["kind"] == "total"}
        self.assertEqual(methods, {"verified"})

    def test_a_malformed_store_refuses_the_run(self):
        (self.history / ("%s.json" % SOURCE)).write_text("{]", encoding="utf-8")
        with self.assertRaises(ledger.LedgerError):
            self.record()

    def test_the_captured_stats_are_recorded_on_the_capture_day(self):
        self.record()
        stats = {
            (entry["key"], entry["unit"], entry["value"])
            for entry in self.rows()
            if entry["kind"] == "stat"
        }
        self.assertEqual(stats, {("lifetime", "tokens", 1000), ("sessions", "count", 4)})
        self.assertEqual({entry["day"] for entry in self.rows() if entry["kind"] == "stat"}, {TODAY})

    def test_model_stats_are_recorded_per_member_and_class(self):
        document = capture_document(
            modelStats=[{"key": "member-one", "totals": {"input": 4, "output": 6}}]
        )
        self.record({SOURCE: {"capture": document}})
        rows = {
            (entry["key"], entry["value"])
            for entry in self.rows()
            if entry["kind"] == "model-stat"
        }
        self.assertEqual(rows, {("member-one/input", 4), ("member-one/output", 6)})

    def test_a_ledger_block_records_its_split_and_its_sessions(self):
        self.record({SOURCE: {"capture": capture_document(), "ledgerBlock": LEDGER_BLOCK}})
        split = {
            (entry["day"], entry["key"], entry["value"])
            for entry in self.rows()
            if entry["kind"] == "model-category"
        }
        self.assertEqual(
            split, {(YESTERDAY, "member-one/input", 4), (YESTERDAY, "member-one/output", 6)}
        )
        sessions = self.rows("sessions")
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]["key"], "2026-09-10T09:00:00Z")
        self.assertEqual(sessions[0]["value"], 3600)
        self.assertEqual(sessions[0]["unit"], "seconds")
        self.assertEqual(sessions[0]["day"], YESTERDAY)

    def test_the_raw_identity_kinds_are_recorded_beside_the_folded_ones(self):
        # Issue #371: every model ever used is recorded by the identity the
        # tool reported — from the store, from the block's joint and lifetime
        # split, and on the session — and the folded kinds keep being written
        # beside them, untouched.
        (self.history / ("%s.json" % SOURCE)).write_text(
            json.dumps(
                {
                    "schema": "usage-history/v2",
                    "days": {
                        "2026-09-09": {"total": 10, "models": {"other": 10}},
                        YESTERDAY: {"total": 10, "modelIds": {UNNAMED: 6, "~unidentified": 4}},
                    },
                }
            ),
            encoding="utf-8",
        )
        block = dict(
            LEDGER_BLOCK,
            modelIdCategories={
                "startDate": YESTERDAY,
                "members": [
                    {"id": UNNAMED, "category": "input", "totals": [4]},
                    {"id": UNNAMED, "category": "output", "totals": [6]},
                ],
            },
            modelIdStats=[{"id": UNNAMED, "totals": {"input": 40, "output": 2}}],
            sessions=[dict(LEDGER_BLOCK["sessions"][0], modelIds=[UNNAMED])],
        )
        self.record({SOURCE: {"capture": capture_document(), "ledgerBlock": block}})
        readings = {
            (entry["day"], entry["kind"], entry["key"], entry["value"]) for entry in self.rows()
        }
        for expected in (
            # The store: the legacy day keeps its folded split; the day kept
            # by identity is recorded by identity AND projected, here onto a
            # source no vocabulary group declares, whose only member is the
            # residual.
            ("2026-09-09", "model", "other", 10),
            (YESTERDAY, "model", "other", 10),
            (YESTERDAY, "model-id", UNNAMED, 6),
            (YESTERDAY, "model-id", "~unidentified", 4),
            # The block: the joint per identity and class on the days it
            # covers, beside the folded joint, and the lifetime split by
            # identity on the capture day.
            (YESTERDAY, "model-category", "member-one/input", 4),
            (YESTERDAY, "model-id-category", UNNAMED + "/input", 4),
            (YESTERDAY, "model-id-category", UNNAMED + "/output", 6),
            (TODAY, "model-id-stat", UNNAMED + "/input", 40),
            (TODAY, "model-id-stat", UNNAMED + "/output", 2),
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, readings)
        self.assertNotIn("2026-09-09", {day for day, kind, _, _ in readings if kind == "model-id"})
        (session,) = self.rows("sessions")
        self.assertEqual(session["modelIds"], [UNNAMED])
        declared = json.loads((self.ledger / "schema.json").read_text(encoding="utf-8"))
        for kind in ("model-id", "model-id-category", "model-id-stat"):
            self.assertIn(kind, declared["streams"]["usage"])

    def test_no_ledger_block_produces_no_rows_that_need_one(self):
        # The absent case is a real producer state, never an error: a capture
        # that cannot split its days that way simply says nothing about them.
        self.record()
        self.assertEqual(
            [entry for entry in self.rows() if entry["kind"] == "model-category"], []
        )
        self.assertFalse((self.ledger / "sessions").exists())

    def test_a_malformed_ledger_block_refuses_the_run(self):
        for broken in (
            {"schema": "usage-capture-ledger/v2"},
            dict(LEDGER_BLOCK, modelCategories={"startDate": "2026-99-99", "members": []}),
            dict(LEDGER_BLOCK, sessions=[{"startedAt": "2026-09-10T09:00:00Z"}]),
            dict(LEDGER_BLOCK, extra=1),
        ):
            with self.subTest(broken=sorted(broken)):
                with self.assertRaises(ledger.LedgerError):
                    self.record({SOURCE: {"capture": capture_document(), "ledgerBlock": broken}})

    def test_a_zero_day_in_the_block_records_nothing(self):
        block = dict(
            LEDGER_BLOCK,
            modelCategories={
                "startDate": YESTERDAY,
                "members": [{"model": "member-one", "category": "input", "totals": [0]}],
            },
        )
        self.record({SOURCE: {"capture": capture_document(), "ledgerBlock": block}})
        self.assertEqual(
            [entry for entry in self.rows() if entry["kind"] == "model-category"], []
        )

    def test_the_lifetime_baseline_is_recorded_on_the_day_it_covers(self):
        self.record(baselines={SOURCE: (5000, "2026-09-01")})
        baseline = [entry for entry in self.rows() if entry["method"] == "baseline"]
        self.assertEqual(len(baseline), 1)
        self.assertEqual(baseline[0]["day"], "2026-09-01")
        self.assertEqual(baseline[0]["key"], "lifetime")
        self.assertEqual(baseline[0]["value"], 5000)

    def test_a_baseline_for_a_source_this_run_never_saw_is_skipped(self):
        self.record(baselines={"gamma": (5000, "2026-09-01")})
        self.assertEqual([entry for entry in self.rows() if entry["method"] == "baseline"], [])

    def test_the_run_reports_one_counted_line(self):
        self.record()
        self.assertRegex(
            self.stderr.strip().splitlines()[-1],
            r"^ledger appended=\d+ unchanged=0 raw=\d+ pruned=0$",
        )

    def test_the_schema_file_declares_the_records_vocabularies(self):
        self.record()
        declared = json.loads((self.ledger / "schema.json").read_text(encoding="utf-8"))
        self.assertEqual(declared["schema"], "ledger/v1")
        self.assertEqual(set(declared["streams"]), set(ledger.STREAM_KINDS))
        self.assertEqual(declared["units"], list(ledger.UNITS))
        before = (self.ledger / "schema.json").stat().st_mtime_ns
        self.record()
        self.assertEqual((self.ledger / "schema.json").stat().st_mtime_ns, before)


class RawArchiveTest(RecordRunCase):
    """What the archive keeps, and what the pruner is allowed to delete."""

    def raw_day(self, day=TODAY):
        return self.ledger / "raw" / "usage" / day

    def test_the_digest_names_the_uncompressed_document(self):
        document = capture_document()
        self.record({SOURCE: {"capture": document}})
        digests = {entry.get("raw") for entry in self.rows() if entry["method"] == "capture"}
        expected = "sha256:" + hashlib.sha256(
            json.dumps(document, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        self.assertEqual(digests, {expected})
        archived = gzip.decompress((self.raw_day() / ("%s.last.json.gz" % SOURCE)).read_bytes())
        self.assertEqual(hashlib.sha256(archived).hexdigest(), expected.split(":", 1)[1])

    def test_the_days_latest_archive_is_replaced_rather_than_multiplied(self):
        self.record({SOURCE: {"capture": capture_document(stats={"lifetime": 1})}})
        self.record({SOURCE: {"capture": capture_document(stats={"lifetime": 2})}})
        latest = json.loads(
            gzip.decompress((self.raw_day() / ("%s.last.json.gz" % SOURCE)).read_bytes())
        )
        self.assertEqual(latest["stats"], {"lifetime": 2})
        self.assertEqual(
            len(list(self.raw_day().glob("%s.last*" % SOURCE))), 1
        )

    def test_a_run_that_measured_nothing_new_archives_no_second_copy(self):
        # The schedule wakes every minute. A document that differs only in
        # the instants it was taken is the same measurement read again, and
        # archiving those would cost a gigabyte a month to say so. BOTH
        # instants: the exporter stamps the walked source's document with a
        # fresh `generatedAt` on every run, and a recaptured merge source
        # carries the capture tool's own fresh one — the document this models
        # is the one the exporter actually hands over (PR #312 review,
        # finding 2: excluding `capturedAt` alone archived every run).
        minute_later = NOW + datetime.timedelta(minutes=1)
        two_minutes = NOW + datetime.timedelta(minutes=2)
        self.record({SOURCE: {"capture": capture_document(generatedAt="2026-09-11T07:39:08Z")}})
        self.record(
            {SOURCE: {"capture": capture_document(
                generatedAt="2026-09-11T07:40:08Z", capturedAt="2026-09-11T07:40:08Z"
            )}},
            now=minute_later,
        )
        self.assertEqual(len(list(self.raw_day().glob("%s.T*.json.gz" % SOURCE))), 1)
        self.assertEqual(ledger.RUN_INSTANT_FIELDS, frozenset({"capturedAt", "generatedAt"}))
        self.record(
            {SOURCE: {"capture": capture_document(stats={"lifetime": 7})}},
            now=two_minutes,
        )
        self.assertEqual(len(list(self.raw_day().glob("%s.T*.json.gz" % SOURCE))), 2)

    def test_retention_prunes_only_its_own_names_and_only_past_the_bound(self):
        old = (datetime.date.fromisoformat(TODAY) - datetime.timedelta(days=40)).isoformat()
        recent = (datetime.date.fromisoformat(TODAY) - datetime.timedelta(days=3)).isoformat()
        for day in (old, recent):
            directory = self.raw_day(day)
            directory.mkdir(parents=True)
            (directory / ("%s.T010203Z.json.gz" % SOURCE)).write_bytes(b"x")
            (directory / ("%s.last.json.gz" % SOURCE)).write_bytes(b"x")
            # A decoy: something an operator or a future version put there.
            (directory / "operator-note.json.gz").write_bytes(b"x")
            (directory / ("%s.T010203Z.json" % SOURCE)).write_bytes(b"x")
        self.record()
        self.assertFalse((self.raw_day(old) / ("%s.T010203Z.json.gz" % SOURCE)).exists())
        for survivor in (
            self.raw_day(old) / ("%s.last.json.gz" % SOURCE),
            self.raw_day(old) / "operator-note.json.gz",
            self.raw_day(old) / ("%s.T010203Z.json" % SOURCE),
            self.raw_day(recent) / ("%s.T010203Z.json.gz" % SOURCE),
            self.raw_day(recent) / ("%s.last.json.gz" % SOURCE),
        ):
            self.assertTrue(survivor.exists(), survivor.name)
        self.assertIn("pruned=1", self.stderr)


class ExportTest(LedgerTestCase):
    """The derived views are rebuilt from the lines and agree with them."""

    def setUp(self):
        super().setUp()
        # Deliberately staged so the LAST row for an identity is never the
        # resolved one: a derived view built by overwriting as it reads would
        # publish the newest figure rather than the right one, and these
        # tables are what every consumer reads instead of the lines.
        self.append(row(value=40, method="capture"))
        self.append(row(value=10, method="store", capturedAt="2026-09-11T08:00:00Z"))
        self.append(row(day=TODAY, value=900, method="store"))
        self.append(
            row(day=TODAY, value=7, method="verified", capturedAt="2026-09-11T08:00:00Z")
        )
        self.append(
            row(day=TODAY, kind="category", key="input", value=7, method="store")
        )

    def test_the_staging_discriminates_the_resolution_from_the_last_row(self):
        # Non-vacuity for the round trip below: if the last row happened to be
        # the resolved one for every identity, the comparison would pass for
        # a view that never resolved anything.
        current = ledger.resolve(self.ledger, "usage")
        latest = {}
        for entry in written_lines(self.stream_file()):
            latest[(entry["day"], entry["source"], entry["kind"], entry["key"])] = entry
        self.assertNotEqual(
            {name: entry["value"] for name, entry in current.items()},
            {name: entry["value"] for name, entry in latest.items()},
        )

    def test_the_round_trip_equals_the_resolution(self):
        out = self.ledger / "exports"
        ledger.export_ledger(self.ledger, out)
        current = ledger.resolve(self.ledger, "usage")
        connection = sqlite3.connect(out / "ledger.sqlite")
        try:
            rows = connection.execute(
                "SELECT day, source, kind, key, value FROM usage_current"
            ).fetchall()
            everything = connection.execute("SELECT COUNT(*) FROM usage").fetchone()[0]
        finally:
            connection.close()
        self.assertEqual(
            sorted(rows),
            sorted((day, source, kind, key, entry["value"])
                   for (day, source, kind, key), entry in current.items()),
        )
        self.assertEqual(everything, 5)
        with open(out / "usage.csv", encoding="utf-8", newline="") as handle:
            table = list(csv.DictReader(handle))
        self.assertEqual(
            sorted((line["day"], line["key"], int(line["value"])) for line in table),
            sorted((day, key, entry["value"])
                   for (day, _, _, key), entry in current.items()),
        )

    def test_every_stream_gets_a_table_and_a_file(self):
        out = self.ledger / "exports"
        ledger.export_ledger(self.ledger, out)
        connection = sqlite3.connect(out / "ledger.sqlite")
        try:
            names = {
                name for (name,) in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
        finally:
            connection.close()
        for stream in ledger.STREAM_KINDS:
            self.assertIn(stream, names)
            self.assertIn("%s_current" % stream, names)
            self.assertTrue((out / ("%s.csv" % stream)).is_file())

    def test_the_database_is_rebuilt_rather_than_updated(self):
        out = self.ledger / "exports"
        ledger.export_ledger(self.ledger, out)
        self.append(row(day="2026-09-09", value=3, method="store"))
        ledger.export_ledger(self.ledger, out)
        connection = sqlite3.connect(out / "ledger.sqlite")
        try:
            self.assertEqual(
                connection.execute("SELECT COUNT(*) FROM usage").fetchone()[0], 6
            )
        finally:
            connection.close()
        self.assertFalse((out / "ledger.sqlite.tmp").exists())

    def test_a_session_carries_its_own_columns(self):
        self.append(
            {
                "schema": "ledger/v1",
                "day": YESTERDAY,
                "stream": "sessions",
                "source": SOURCE,
                "kind": "session",
                "key": "2026-09-10T09:00:00Z",
                "value": 3600,
                "unit": "seconds",
                "capturedAt": STAMP,
                "method": "capture",
                "exporter": EXPORTER,
                "startedAt": "2026-09-10T09:00:00Z",
                "endedAt": "2026-09-10T10:00:00Z",
                "total": 500,
                "categories": {"input": 500},
                "models": ["member-one"],
            },
            stream="sessions",
        )
        out = self.ledger / "exports"
        ledger.export_ledger(self.ledger, out)
        connection = sqlite3.connect(out / "ledger.sqlite")
        try:
            total, categories, models, identities = connection.execute(
                "SELECT total, categories, models, modelIds FROM sessions_current"
            ).fetchone()
        finally:
            connection.close()
        self.assertEqual(total, 500)
        self.assertEqual(json.loads(categories), {"input": 500})
        self.assertEqual(json.loads(models), ["member-one"])
        # A row written before sessions carried raw identities (issue #371)
        # has none, and says so with a NULL rather than an invented list.
        self.assertIsNone(identities)

    @unittest.skipIf(os.geteuid() == 0, "a superuser writes through any directory mode")
    def test_a_database_fault_is_the_records_own_refusal(self):
        # The nightly snapshot now rebuilds these views unattended (issue
        # #358): a database that cannot be built is reported as a refusal it
        # can log, never as a traceback out of a scheduled job.
        out = self.ledger / "exports"
        out.mkdir()
        out.chmod(0o500)
        self.addCleanup(out.chmod, 0o700)
        with self.assertRaises(ledger.LedgerError) as caught:
            ledger.export_ledger(self.ledger, out)
        self.assertIn("could not be built", str(caught.exception))


class ExporterHookTest(LedgerTestCase):
    """The exporter writes the record beside the dataset, or not at all."""

    def setUp(self):
        super().setUp()
        self.transcripts = self.scratch / "transcripts"
        (self.transcripts / "project").mkdir(parents=True)
        (self.transcripts / "project" / "session.jsonl").write_text(
            json.dumps(
                {
                    "type": "assistant",
                    "timestamp": "2026-09-10T12:00:00Z",
                    "requestId": "req_fixture",
                    "message": {
                        "id": "msg_fixture",
                        "usage": {"input_tokens": 5, "output_tokens": 7},
                    },
                }
            )
            + "\n",
            encoding="utf-8",
        )
        self.history = self.scratch / "history"
        self.history.mkdir()
        self.out = self.scratch / "usage.json"

    def run_export(self, *extra):
        arguments = [
            "--transcripts", str(self.transcripts),
            "--source", SOURCE,
            "--history-store", str(self.history / ("%s.json" % SOURCE)),
            "--out", str(self.out),
            *extra,
        ]
        with contextlib.redirect_stderr(io.StringIO()) as captured:
            status = exporter.main(arguments)
        self.stderr = captured.getvalue()
        return status

    def test_the_ledger_argument_records_the_run(self):
        self.assertEqual(self.run_export("--ledger", str(self.ledger),
                                         "--exporter-version", EXPORTER), 0)
        rows = written_lines(self.stream_file())
        self.assertTrue(rows)
        self.assertEqual({entry["exporter"] for entry in rows}, {EXPORTER})
        self.assertEqual({entry["source"] for entry in rows}, {SOURCE})
        self.assertIn("ledger appended=", self.stderr)
        # The archive holds the document the run emitted.
        archived = sorted((self.ledger / "raw" / "usage").rglob("*.last.json.gz"))
        self.assertEqual(len(archived), 1)

    def test_no_ledger_argument_writes_no_record(self):
        self.assertEqual(self.run_export(), 0)
        self.assertFalse(self.ledger.exists())
        self.assertNotIn("ledger appended=", self.stderr)

    def test_a_ledger_whose_parent_is_missing_is_refused(self):
        status = self.run_export("--ledger", str(self.scratch / "nowhere" / "ledger"))
        self.assertEqual(status, 2)
        self.assertIn("no such ledger directory", self.stderr)

    def test_an_unwritable_record_refuses_the_run_rather_than_the_document(self):
        # A refusal here is reported as every other capture refusal is: the
        # message, status 1, no traceback for a scheduler to swallow.
        self.ledger.mkdir()
        (self.ledger / "usage").write_text("not a directory", encoding="utf-8")
        status = self.run_export("--ledger", str(self.ledger))
        self.assertEqual(status, 1)
        self.assertIn("ledger", self.stderr)


class ImportSurfaceTest(unittest.TestCase):
    """Each new module's reviewed import surface, held closed.

    The exporter's own suite pins `usage_ledger` because it imports it. These
    two are separate programs with separate reaches — the snapshot is the one
    piece of this pipeline that may open a socket, and the backfill the one
    that may create a process — so each is pinned where it can be read beside
    what it is allowed to do.
    """

    SURFACES = {
        "ledger_snapshot": {
            # `http` is the standard-library status table (`http.HTTPStatus`),
            # so a refused panel is named by the standard phrase and never by
            # the upstream's own reason text (issue #320); it opens nothing.
            # `time` is the fixed pause before a transient refusal is retried
            # (issue #358); it opens nothing and starts nothing.
            "__future__", "argparse", "datetime", "http", "json", "pathlib",
            "sys", "time", "urllib", "usage_ledger",
        },
        "ledger_backfill_github": {
            "__future__", "argparse", "datetime", "json", "pathlib", "re",
            "subprocess", "sys", "time", "usage_ledger",
        },
    }

    def test_each_module_imports_exactly_its_reviewed_surface(self):
        for name, allowed in self.SURFACES.items():
            with self.subTest(module=name):
                tree = ast.parse((_SCRIPTS / ("%s.py" % name)).read_text(encoding="utf-8"))
                self.assertEqual(imported_roots(tree), allowed)

    def test_only_the_snapshot_reaches_a_network(self):
        # The two capabilities are kept apart on purpose: the program that
        # fetches cannot spawn, and the program that spawns cannot fetch.
        snapshot = ast.parse((_SCRIPTS / "ledger_snapshot.py").read_text(encoding="utf-8"))
        backfill = ast.parse(
            (_SCRIPTS / "ledger_backfill_github.py").read_text(encoding="utf-8")
        )
        self.assertNotIn("subprocess", imported_roots(snapshot))
        self.assertNotIn("urllib", imported_roots(backfill))

    def test_the_record_itself_neither_fetches_nor_spawns(self):
        tree = ast.parse((_SCRIPTS / "usage_ledger.py").read_text(encoding="utf-8"))
        roots = imported_roots(tree)
        for refused in ("subprocess", "socket", "urllib", "http", "importlib", "ctypes"):
            self.assertNotIn(refused, roots)


if __name__ == "__main__":
    unittest.main()
