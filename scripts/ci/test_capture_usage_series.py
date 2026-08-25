"""Contract tests for the local transcript capture step.

The module under test lives one directory up, at `scripts/capture_usage_series.py`,
because it is an operator capture step and not a CI script. Its test lives HERE
because the gate discovers tests with `-s scripts/ci`, and moving that root is
an edit to the workflow the release publisher authorizes against — a change
with a much larger blast radius than a test file's address. It is loaded by
path rather than by import so neither directory has to become a package.

The suite's centre of gravity is requirement 12. Every other assertion here is
about arithmetic; the emission tests are about what the repository is allowed
to learn from a transcript tree full of prompts, paths and identifiers, and
they are written so that a future edit which starts leaking one has to make a
test go red before it can make a commit go public.
"""

from __future__ import annotations

import ast
import importlib.util
import json
import os
import shutil
import pathlib
import tempfile
import unittest

_MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "capture_usage_series.py"
_SPEC = importlib.util.spec_from_file_location("capture_usage_series", _MODULE_PATH)
capture_usage_series = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(capture_usage_series)

CaptureError = capture_usage_series.CaptureError


def transcript_line(**overrides):
    """One realistic assistant record, deliberately full of things to leak."""
    record = {
        "type": "assistant",
        "timestamp": "2026-08-10T12:00:00.000Z",
        "requestId": "req_aaaaaaaaaaaa",
        "sessionId": "11111111-2222-3333-4444-555555555555",
        "cwd": "/home/someone/work/a-private-project",
        "gitBranch": "someone/secret-feature",
        "message": {
            "id": "msg_aaaaaaaaaaaa",
            "role": "assistant",
            "content": [{"type": "text", "text": "a sentence nobody outside this machine may read"}],
            "usage": {
                "input_tokens": 10,
                "output_tokens": 5,
                "cache_read_input_tokens": 100,
                "cache_creation_input_tokens": 20,
            },
        },
    }
    record.update(overrides)
    return json.dumps(record)


def running_line(running, stamp="2026-08-23T12:00:00.000Z", last=None, **overrides):
    """One realistic running-totals record, equally full of things to leak.

    `running` is the session's cumulative figure at this point; `last` is the
    turn's own delta, which the reader must NEVER sum — it is carried here
    precisely so a test can prove that summing it is what the reader refuses
    to do.
    """
    record = {
        "timestamp": stamp,
        "type": "event_msg",
        "payload": {
            "type": "token_count",
            "info": {
                "total_token_usage": {
                    "input_tokens": running,
                    "cached_input_tokens": running,
                    "cache_write_input_tokens": running,
                    "output_tokens": 0,
                    "reasoning_output_tokens": 0,
                    "total_tokens": running,
                },
                "last_token_usage": {
                    "input_tokens": running if last is None else last,
                    "cached_input_tokens": 0,
                    "cache_write_input_tokens": 0,
                    "output_tokens": 0,
                    "reasoning_output_tokens": 0,
                    "total_tokens": running if last is None else last,
                },
                "model_context_window": 258400,
            },
        },
    }
    record.update(overrides)
    return json.dumps(record)


def session_meta_line():
    """The header record a session journal opens with, and its whole leak set."""
    return json.dumps(
        {
            "timestamp": "2026-08-23T11:59:00.000Z",
            "type": "session_meta",
            "payload": {
                "session_id": "99999999-8888-7777-6666-555555555555",
                "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                "cwd": "/home/someone/work/a-private-project",
                "git": {"branch": "someone/secret-feature"},
                "originator": "a-private-tool",
                "base_instructions": {
                    "text": "a sentence nobody outside this machine may read"
                },
            },
        }
    )


class UsageTotalTest(unittest.TestCase):
    def test_sums_the_four_fields_the_live_mapper_sums(self):
        self.assertEqual(
            capture_usage_series.usage_total(
                {
                    "input_tokens": 1,
                    "output_tokens": 2,
                    "cache_read_input_tokens": 4,
                    "cache_creation_input_tokens": 8,
                }
            ),
            15,
        )

    def test_ignores_absent_negative_and_non_integer_fields(self):
        self.assertEqual(
            capture_usage_series.usage_total(
                {"input_tokens": -5, "output_tokens": "many", "cache_read_input_tokens": 1.5}
            ),
            0,
        )

    def test_a_boolean_is_not_a_token(self):
        # True is an int in Python, so a usage field that ever arrived as a
        # flag would otherwise silently add one token to a day.
        self.assertEqual(capture_usage_series.usage_total({"input_tokens": True}), 0)

    def test_ignores_a_field_the_series_does_not_count(self):
        self.assertEqual(capture_usage_series.usage_total({"server_tool_use": 900}), 0)


class ReduceLineTest(unittest.TestCase):
    def setUp(self):
        self.seen = set()
        self.counters = capture_usage_series.new_counters()

    def reduce(self, line):
        return capture_usage_series.reduce_line(line, self.seen, self.counters)

    def test_reduces_a_record_to_a_day_and_an_integer(self):
        self.assertEqual(self.reduce(transcript_line()), ("2026-08-10", 135))

    def test_the_same_billed_message_is_counted_once(self):
        # The tool replays earlier assistant messages into later transcript
        # files on resume or fork; counting each appearance roughly doubles
        # every total, which is the single largest error this step can make.
        self.assertIsNotNone(self.reduce(transcript_line()))
        self.assertIsNone(self.reduce(transcript_line()))
        self.assertEqual(self.counters["duplicates"], 1)

    def test_a_different_request_with_the_same_message_id_still_counts(self):
        self.assertIsNotNone(self.reduce(transcript_line()))
        self.assertIsNotNone(self.reduce(transcript_line(requestId="req_bbbbbbbbbbbb")))

    def test_a_record_with_no_identity_at_all_is_counted(self):
        # A missing identity is not evidence of a repeat, and dropping such a
        # record would understate the day rather than protect it.
        first = json.loads(transcript_line())
        del first["requestId"]
        del first["message"]["id"]
        line = json.dumps(first)
        self.assertIsNotNone(self.reduce(line))
        self.assertIsNotNone(self.reduce(line))

    def test_skips_everything_that_is_not_a_usage_bearing_record(self):
        for line in (
            "",
            "   ",
            "{not json",
            "[1, 2, 3]",
            json.dumps({"type": "user", "timestamp": "2026-08-10T12:00:00Z"}),
            json.dumps({"message": {"usage": {"input_tokens": 1}}}),
            json.dumps({"timestamp": "2026-08-10T12:00:00Z", "message": {"usage": "lots"}}),
            json.dumps({"timestamp": 17, "message": {"usage": {"input_tokens": 1}}}),
            json.dumps({"timestamp": "yesterday", "message": {"id": "m", "usage": {"input_tokens": 1}}}),
        ):
            with self.subTest(line=line[:24]):
                self.assertIsNone(self.reduce(line))


class RunningTotalTest(unittest.TestCase):
    def test_reads_the_whole_and_never_re_sums_the_parts(self):
        # The cache and reasoning fields are SUBSETS of input and output in
        # this record shape, so a reader that added them up would count the
        # same tokens two and three times. The fixture makes that visible:
        # every subset field equals the whole.
        self.assertEqual(
            capture_usage_series.running_total(
                {
                    "input_tokens": 90,
                    "cached_input_tokens": 90,
                    "cache_write_input_tokens": 90,
                    "output_tokens": 10,
                    "reasoning_output_tokens": 10,
                    "total_tokens": 100,
                }
            ),
            100,
        )

    def test_a_missing_or_unusable_total_advances_nothing(self):
        for usage in ({}, {"total_tokens": "many"}, {"total_tokens": 1.5}, {"total_tokens": -4}):
            with self.subTest(usage=usage):
                self.assertEqual(capture_usage_series.running_total(usage), 0)

    def test_a_boolean_is_not_a_token(self):
        self.assertEqual(capture_usage_series.running_total({"total_tokens": True}), 0)


class ReduceRunningLineTest(unittest.TestCase):
    def reduce(self, line):
        return capture_usage_series.reduce_running_line(line)

    def test_reduces_a_record_to_a_day_and_its_running_total(self):
        self.assertEqual(self.reduce(running_line(500)), ("2026-08-23", 500))

    def test_the_day_comes_from_the_record_and_never_from_the_clock(self):
        # A session started before midnight local time is journalled under
        # the day it STARTED, while its records happen after midnight UTC.
        # Reading the day off anything but the record's own instant would put
        # a whole evening's work on the wrong cell.
        self.assertEqual(
            self.reduce(running_line(500, stamp="2026-08-24T03:51:18.443Z")),
            ("2026-08-24", 500),
        )

    def test_skips_everything_that_is_not_a_running_total_record(self):
        for line in (
            "",
            "   ",
            "{not json",
            "[1, 2, 3]",
            session_meta_line(),
            json.dumps({"timestamp": "2026-08-23T12:00:00Z"}),
            json.dumps({"timestamp": "2026-08-23T12:00:00Z", "payload": "token_count"}),
            json.dumps({"timestamp": "2026-08-23T12:00:00Z", "payload": {"info": "lots"}}),
            json.dumps({"timestamp": "2026-08-23T12:00:00Z", "payload": {"info": {}}}),
            json.dumps({"payload": {"info": {"total_token_usage": {"total_tokens": 1}}}}),
            json.dumps(
                {
                    "timestamp": 17,
                    "payload": {"info": {"total_token_usage": {"total_tokens": 1}}},
                }
            ),
            json.dumps(
                {
                    "timestamp": "yesterday",
                    "payload": {"info": {"total_token_usage": {"total_tokens": 1}}},
                }
            ),
        ):
            with self.subTest(line=line[:40]):
                self.assertIsNone(self.reduce(line))


class RunningTotalsWalkTest(unittest.TestCase):
    """The replay trap, proven on a fixture that inflates under naive summing."""

    def walk(self, files):
        counters = capture_usage_series.new_counters()
        with tempfile.TemporaryDirectory() as root:
            for name, lines in files.items():
                path = pathlib.Path(root) / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            pairs = list(capture_usage_series.read_running_totals(root, counters))
        return pairs, counters

    def test_a_repeated_accounting_bills_nothing(self):
        # 100, then 300, then THE SAME 300 emitted a second time for one
        # turn, then 600. The truth is 600 tokens. Summing the per-turn
        # deltas beside them gives 100+200+200+300 = 800; summing the running
        # totals themselves gives 1300. Both are the failure this walk is
        # built to refuse, and both are larger than the truth.
        pairs, counters = self.walk(
            {
                "day/session.jsonl": [
                    running_line(100, last=100),
                    running_line(300, last=200),
                    running_line(300, last=200),
                    running_line(600, last=300),
                ]
            }
        )
        self.assertEqual(sum(total for _day, total in pairs), 600)
        self.assertEqual(counters["duplicates"], 1)
        self.assertEqual(counters["restarts"], 0)

    def test_a_restarted_accounting_keeps_everything_before_it(self):
        # A session that resets its own running total mid-file. The record
        # shows the restarting value IS that turn's own usage, so the truth
        # is 300 + 120 = 420. Taking one final total per file would report
        # 120 and lose the whole first half of the session.
        pairs, counters = self.walk(
            {
                "day/session.jsonl": [
                    running_line(100),
                    running_line(300),
                    running_line(50),
                    running_line(120),
                ]
            }
        )
        self.assertEqual(sum(total for _day, total in pairs), 420)
        self.assertEqual(counters["restarts"], 1)

    def test_each_file_opens_its_own_accounting(self):
        # Every journal in the record starts at zero, so a session resumed
        # into a new file must not re-bill the history it inherited.
        pairs, _counters = self.walk(
            {
                "day/first.jsonl": [running_line(100), running_line(400)],
                "day/second.jsonl": [running_line(100), running_line(250)],
            }
        )
        self.assertEqual(sum(total for _day, total in pairs), 650)

    def test_a_session_that_crosses_midnight_splits_across_its_two_days(self):
        # The directory a journal lives in is the LOCAL day it started on, so
        # it is not the day its records happened on and is never read. This
        # fixture puts a UTC-24th record inside a 23rd directory on purpose.
        pairs, _counters = self.walk(
            {
                "2026/08/23/session.jsonl": [
                    running_line(100, stamp="2026-08-23T23:30:00.000Z"),
                    running_line(450, stamp="2026-08-24T00:30:00.000Z"),
                ]
            }
        )
        self.assertEqual(pairs, [("2026-08-23", 100), ("2026-08-24", 350)])

    def test_a_file_that_reports_nothing_usable_contributes_nothing(self):
        pairs, counters = self.walk(
            {"day/session.jsonl": [session_meta_line(), "not json at all"]}
        )
        self.assertEqual(pairs, [])
        self.assertEqual(counters["files"], 1)
        self.assertEqual(counters["counted"], 0)


class RunningTotalsCaptureTest(unittest.TestCase):
    """Requirement 12 again, against the second reader's own hostile tree."""

    def test_a_session_walk_emits_dates_and_integers_and_nothing_else(self):
        with tempfile.TemporaryDirectory() as root:
            nested = os.path.join(root, "2026", "08", "23")
            os.makedirs(nested)
            name = "rollout-2026-08-23T20-51-18-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"
            with open(os.path.join(nested, name), "w", encoding="utf-8") as handle:
                handle.write(session_meta_line() + "\n")
                handle.write(running_line(60, stamp="2026-08-23T20:00:00.000Z") + "\n")
                handle.write(running_line(60, stamp="2026-08-23T20:01:00.000Z") + "\n")
                handle.write(running_line(200, stamp="2026-08-25T04:00:00.000Z") + "\n")
                handle.write("a line that is not JSON at all\n")
            with open(os.path.join(nested, "notes.txt"), "w", encoding="utf-8") as handle:
                handle.write(running_line(9_000_000) + "\n")  # not .jsonl: never read

            series, derived, counters = capture_usage_series.capture(
                root, capture_usage_series.FORMAT_RUNNING_TOTALS
            )

        self.assertEqual(
            series, {"startDate": "2026-08-23", "totals": [60, 0, 140], "recorded": True}
        )
        self.assertEqual(derived, {"peak-day": 140, "current-streak": 1, "longest-streak": 1})
        self.assertEqual(counters["files"], 1)
        self.assertEqual(counters["duplicates"], 1)
        self.assertEqual(counters["counted"], 2)

        # The whole emission, re-read as text: not one identifier, path,
        # branch name, session id or sentence from the journal may appear.
        emitted = json.dumps({"series": series, "derived": derived, "counters": counters})
        for leak in (
            "a-private-project",
            "someone",
            "secret-feature",
            "a-private-tool",
            "rollout",
            "99999999-8888-7777-6666-555555555555",
            "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "nobody outside this machine",
        ):
            with self.subTest(leak=leak):
                self.assertNotIn(leak, emitted)


class CaptureFormatTest(unittest.TestCase):
    def test_the_default_shape_is_the_message_reader(self):
        with tempfile.TemporaryDirectory() as root:
            with open(os.path.join(root, "session.jsonl"), "w", encoding="utf-8") as handle:
                handle.write(transcript_line() + "\n")
            series, _derived, _counters = capture_usage_series.capture(root)
        self.assertEqual(series["totals"], [135])

    def test_each_shape_reads_only_its_own_records(self):
        # The two record shapes share a tree walk and nothing else. A journal
        # of one shape read as the other must find no usage at all rather
        # than a partial number nobody can trace.
        with tempfile.TemporaryDirectory() as root:
            with open(os.path.join(root, "session.jsonl"), "w", encoding="utf-8") as handle:
                handle.write(transcript_line() + "\n")
            with self.assertRaises(CaptureError):
                capture_usage_series.capture(root, capture_usage_series.FORMAT_RUNNING_TOTALS)
        with tempfile.TemporaryDirectory() as root:
            with open(os.path.join(root, "session.jsonl"), "w", encoding="utf-8") as handle:
                handle.write(running_line(100) + "\n")
            with self.assertRaises(CaptureError):
                capture_usage_series.capture(root, capture_usage_series.FORMAT_MESSAGES)

    def test_an_unknown_shape_is_refused_rather_than_guessed(self):
        with self.assertRaises(CaptureError):
            capture_usage_series.capture("/nowhere", "whatever-the-tool-writes")


class ImportSurfaceTest(unittest.TestCase):
    """Owner ruling 2 (issue #142), made structural rather than promised.

    The capture must be INCAPABLE of spawning an agent session or reaching
    the network, and the enforcement is the same kind the panels' zero-egress
    doctrine test applies to Go: the module's import surface is a closed
    allowlist, read out of the parsed source rather than out of prose.

    `os` WAS on the refused list, and it moved (2026-08-25 round-4 review,
    finding 4). That is a widening of the reviewed surface and it is recorded
    here rather than absorbed quietly.

    Why it was refused: `os` carries `system`, `popen`, `fork`, `spawn*` and
    `exec*`, and while this lint was believed to BE the capability boundary,
    admitting it would have dissolved the boundary outright.

    Why that reasoning no longer holds: round 3 established the lint cannot
    carry a capability claim at all — `pathlib` is admitted and re-exports
    `os`, so `pathlib.os.system` was always reachable and every test here
    stayed green. The enforced boundary is the kernel sandbox the scheduled
    push runs the producer inside (`scripts/usage-export/producer.sb`, which
    denies `process-fork` and `network*`). Against that boundary, importing
    `os` changes nothing about what this program CAN do.

    Why it had to move: the final open of a transcript file needs
    `O_NOFOLLOW` and an `fstat` on the descriptor, and Python exposes neither
    outside `os`. `pathlib.Path.open()` follows whatever the leaf has become,
    which is the TOCTOU the round-4 review demonstrated. Refusing the import
    would have meant keeping a real symlink escape to preserve a smaller
    reviewed surface that no longer carries a security claim — trading a
    property for an appearance.

    What replaces it: an enumerated ATTRIBUTE allowlist below. Every `os.`
    attribute this module may name is listed, so a spawn or exec call site
    cannot appear without a deliberate widening a reader sees. Like the
    import pin, it is a REVIEW BOUND and not a capability proof — a computed
    `getattr` walks past it exactly as round 2 showed — and it is written
    down as one.
    """

    ALLOWED = frozenset(
        {"__future__", "argparse", "datetime", "json", "os", "pathlib", "re", "sys"}
    )

    # Every `os.` attribute the module is allowed to name. Descriptor-rooted
    # reading and nothing else: no process, no network, no filesystem
    # mutation.
    ALLOWED_OS_ATTRIBUTES = frozenset(
        {
            "O_CLOEXEC",
            "O_NOFOLLOW",
            "O_NONBLOCK",
            "O_RDONLY",
            "close",
            "fdopen",
            "fstat",
            "open",
        }
    )

    # Not an exhaustive index of the standard library — it does not need to
    # be, because the allowlist above already refuses everything not named in
    # it. This list exists so the ALLOWLIST ITSELF cannot be widened to admit
    # one of these without a test naming the module that got in.
    REFUSED = frozenset(
        {
            "asyncio",
            "concurrent",
            "ctypes",
            "ftplib",
            "http",
            "importlib",
            "multiprocessing",
            "pickle",
            "platform",
            "posix",
            "pty",
            "runpy",
            "select",
            "shutil",
            "signal",
            "smtplib",
            "socket",
            "socketserver",
            "ssl",
            "subprocess",
            "threading",
            "urllib",
            "webbrowser",
            "xmlrpc",
        }
    )

    # Builtins that turn data into code. None needs an import, so the import
    # allowlist alone would not see them coming.
    REFUSED_BUILTINS = frozenset({"__import__", "breakpoint", "compile", "eval", "exec"})

    def setUp(self):
        self.tree = ast.parse(_MODULE_PATH.read_text(encoding="utf-8"))

    def imported_roots(self):
        roots = set()
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    roots.add(alias.name.split(".")[0])
            elif isinstance(node, ast.ImportFrom):
                # A relative import has no module name and would pull in a
                # sibling file this allowlist has never seen; it reads as the
                # empty root and is refused by the comparison below.
                roots.add((node.module or "").split(".")[0])
        return roots

    def test_the_import_surface_is_exactly_the_allowlist(self):
        # Equality, not containment: the allowlist is CLOSED, so an import
        # arriving and an import leaving are both changes a reader must see.
        self.assertEqual(self.imported_roots(), set(self.ALLOWED))

    def test_the_allowlist_admits_nothing_that_can_spawn_or_connect(self):
        # Guards the allowlist against itself. Without this, widening the set
        # above by one line would make every other assertion here pass.
        self.assertEqual(self.ALLOWED & self.REFUSED, set())

    def test_no_refused_module_is_imported_under_any_spelling(self):
        self.assertEqual(self.imported_roots() & self.REFUSED, set())

    def test_the_capture_never_turns_data_into_code(self):
        called = {
            node.func.id
            for node in ast.walk(self.tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
        }
        self.assertEqual(called & self.REFUSED_BUILTINS, set())

    def test_the_os_surface_is_exactly_the_enumerated_attributes(self):
        # The narrower pin that replaced refusing `os` outright. Equality,
        # not containment: an attribute arriving and an attribute leaving are
        # both changes a reader must see.
        named = {
            node.attr
            for node in ast.walk(self.tree)
            if isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id == "os"
        }
        self.assertEqual(named, set(self.ALLOWED_OS_ATTRIBUTES))

    def test_the_enumerated_os_attributes_cannot_spawn_or_connect(self):
        # Guards the attribute allowlist against itself, the way the module
        # allowlist above is guarded: widening it to admit one of these would
        # otherwise make every other assertion here pass unchanged.
        forbidden = {
            "abort", "execl", "execle", "execlp", "execv", "execve", "execvp",
            "fork", "forkpty", "kill", "popen", "posix_spawn", "posix_spawnp",
            "putenv", "remove", "rename", "rmdir", "setuid", "spawnl", "spawnv",
            "startfile", "system", "unlink", "write",
        }
        self.assertEqual(set(self.ALLOWED_OS_ATTRIBUTES) & forbidden, set())

    def test_the_os_pin_is_honest_about_what_it_cannot_prove(self):
        # The round-2 lesson, kept where it applies: an attribute allowlist
        # is defeated by a computed getattr exactly as an attribute denylist
        # was. The docstring must say so, because a pin whose limits are
        # undocumented gets read as a guarantee.
        self.assertIn("REVIEW BOUND", ImportSurfaceTest.__doc__)
        self.assertIn("getattr", ImportSurfaceTest.__doc__)

    def test_the_pin_is_reading_a_real_import_surface(self):
        # Non-vacuity: an assertion about a set that turned out to be empty
        # would pass for the wrong reason forever.
        self.assertIn("json", self.imported_roots())
        self.assertGreater(len(self.imported_roots()), 3)


class UTCDayTest(unittest.TestCase):
    def test_an_offset_instant_lands_on_its_utc_day(self):
        # The live mapper indexes days in UTC, so a capture that used local
        # time would shift every cell for anyone west of Greenwich.
        self.assertEqual(capture_usage_series.utc_day("2026-08-10T20:00:00-07:00"), "2026-08-11")

    def test_a_naive_instant_is_read_as_utc(self):
        self.assertEqual(capture_usage_series.utc_day("2026-08-10T00:30:00"), "2026-08-10")

    def test_an_unparseable_instant_is_no_day_at_all(self):
        self.assertIsNone(capture_usage_series.utc_day("the tenth"))


class DailySeriesTest(unittest.TestCase):
    def test_fills_the_span_contiguously_and_sums_repeated_days(self):
        series = capture_usage_series.daily_series(
            [("2026-08-10", 5), ("2026-08-12", 7), ("2026-08-10", 5)]
        )
        self.assertEqual(series["startDate"], "2026-08-10")
        self.assertEqual(series["totals"], [10, 0, 7])
        self.assertTrue(series["recorded"])

    def test_a_zero_inside_the_window_is_a_measurement_not_an_invention(self):
        # The window never extends past the days the record covers, which is
        # what keeps the interior zeros honest: they say the record has
        # nothing for that day, not that the day did not exist.
        series = capture_usage_series.daily_series([("2026-08-10", 1), ("2026-08-11", 2)])
        self.assertEqual(len(series["totals"]), 2)

    def test_an_empty_walk_refuses_rather_than_emitting_an_empty_series(self):
        with self.assertRaises(CaptureError):
            capture_usage_series.daily_series([])

    def test_a_span_past_the_origins_bound_is_refused_here(self):
        # Shipping a series the origin will refuse at load is worse than
        # shipping none: the panel would degrade to unavailable on boot.
        with self.assertRaises(CaptureError):
            capture_usage_series.daily_series([("2020-01-01", 1), ("2026-01-01", 1)])


class DailyStreaksTest(unittest.TestCase):
    def test_matches_the_go_mappers_semantics(self):
        for totals, expected in (
            ([], (0, 0)),
            ([0, 0, 0], (0, 0)),
            ([1, 1, 1], (3, 3)),
            ([1, 1, 0, 1], (1, 2)),
            ([1, 1, 1, 0], (3, 3)),
            ([1, 1, 0, 0], (0, 2)),
        ):
            with self.subTest(totals=totals):
                self.assertEqual(capture_usage_series.daily_streaks(totals), expected)

    def test_one_trailing_empty_day_does_not_break_the_current_run(self):
        # The newest day is the day in progress; an hour of quiet is not a
        # broken streak, and two empty days are.
        self.assertEqual(capture_usage_series.daily_streaks([1, 1, 1, 0])[0], 3)
        self.assertEqual(capture_usage_series.daily_streaks([1, 1, 1, 0, 0])[0], 0)


class EmissionGuardTest(unittest.TestCase):
    """Requirement 12, asserted directly on the guard that enforces it."""

    def test_admits_the_shape_the_capture_actually_emits(self):
        capture_usage_series.assert_only_dates_and_integers(
            {"startDate": "2026-08-10", "totals": [0, 1, 2], "recorded": True}
        )

    def test_refuses_every_string_that_is_not_a_calendar_date(self):
        for leak in (
            "/home/someone/work/a-private-project",
            "a-private-project",
            "11111111-2222-3333-4444-555555555555",
            "2026-08-10T12:00:00Z",
            "",
        ):
            with self.subTest(leak=leak):
                with self.assertRaises(CaptureError):
                    capture_usage_series.assert_only_dates_and_integers({"totals": [leak]})

    def test_refuses_a_key_that_is_not_a_field_name(self):
        for leak in ("/home/someone/notes.jsonl", "notes.jsonl", "a private project", "x" * 40):
            with self.subTest(leak=leak):
                with self.assertRaises(CaptureError):
                    capture_usage_series.assert_only_dates_and_integers({leak: 1})

    def test_refuses_a_label_shaped_key_outside_the_closed_vocabulary(self):
        # MEMBERSHIP, not shape (2026-08-24 review finding H1). Every key
        # here satisfies KEY_PATTERN — the original guard admitted all of
        # them, and each would have rendered publicly as panel copy.
        for leak in ("private-feature", "internal-project-name", "clientname", "acme-migration"):
            with self.subTest(leak=leak):
                with self.assertRaises(CaptureError):
                    capture_usage_series.assert_only_dates_and_integers({leak: 1})
                with self.assertRaises(CaptureError):
                    # Nested exactly where a hostile merge file would put it.
                    capture_usage_series.assert_only_dates_and_integers(
                        {"categories": {leak: [1, 2]}}
                    )

    def test_admits_extra_keys_only_when_the_caller_declares_them(self):
        payload = {"my-source": {"series": {"startDate": "2026-08-10", "totals": [1], "recorded": True}}}
        with self.assertRaises(CaptureError):
            capture_usage_series.assert_only_dates_and_integers(payload)
        capture_usage_series.assert_only_dates_and_integers(
            payload, extra_keys=frozenset({"my-source"})
        )

    def test_refuses_an_impossible_calendar_date(self):
        # Shape says yes, the calendar says no (2026-08-24 review finding
        # H1: 2026-99-99 passed the digit pattern).
        for leak in ("2026-99-99", "2026-02-30", "2026-13-01", "2026-00-10", "0000-00-00"):
            with self.subTest(leak=leak):
                with self.assertRaises(CaptureError):
                    capture_usage_series.assert_only_dates_and_integers({"totals": [leak]})

    def test_refuses_a_newline_suffixed_date(self):
        # re.match with `$` tolerates exactly one trailing newline; the
        # guard must not (2026-08-24 review finding H1).
        for leak in ("2026-08-10\n", "2026-08-10 ", " 2026-08-10", "2026-08-10\t"):
            with self.subTest(leak=repr(leak)):
                with self.assertRaises(CaptureError):
                    capture_usage_series.assert_only_dates_and_integers({"totals": [leak]})

    def test_refuses_negative_integers(self):
        # Every emitted figure is a count (2026-08-24 review finding H1:
        # isinstance(int) admitted any sign).
        for leak in (-1, -1000):
            with self.subTest(leak=leak):
                with self.assertRaises(CaptureError):
                    capture_usage_series.assert_only_dates_and_integers({"totals": [leak]})

    def test_admits_booleans_only_under_the_recorded_flag(self):
        capture_usage_series.assert_only_dates_and_integers({"recorded": True})
        for payload in ({"totals": [True]}, {"peak-day": False}):
            with self.subTest(payload=payload):
                with self.assertRaises(CaptureError):
                    capture_usage_series.assert_only_dates_and_integers(payload)

    def test_valid_calendar_day_is_membership_in_the_real_calendar(self):
        for good in ("2026-08-10", "2024-02-29", "1999-12-31"):
            self.assertTrue(capture_usage_series.valid_calendar_day(good), good)
        for bad in ("2026-99-99", "2023-02-29", "2026-08-10\n", "2026-8-10", "20260810", 5, None):
            self.assertFalse(capture_usage_series.valid_calendar_day(bad), repr(bad))

    def test_refuses_a_value_that_is_neither_a_date_nor_an_integer(self):
        for leak in (1.5, None, object()):
            with self.subTest(leak=repr(leak)):
                with self.assertRaises(CaptureError):
                    capture_usage_series.assert_only_dates_and_integers({"totals": [leak]})

    def test_names_the_field_and_never_the_value(self):
        # An error message is as public as the file it would be pasted into.
        try:
            capture_usage_series.assert_only_dates_and_integers({"totals": ["/home/someone/secret"]})
        except CaptureError as error:
            self.assertNotIn("secret", str(error))
            self.assertIn("totals", str(error))
        else:
            self.fail("the guard admitted a path")


class CategoryVocabularyParityTest(unittest.TestCase):
    """The closed category vocabulary is ONE fact spelled in three places.

    scripts/capture_usage_series.py CATEGORY_KEYS (the capture-side guard),
    internal/panels/types.go categoryServeOrder (origin admission and serve
    order), and frontend/src/lib/token-usage.ts categorySlots (the fixed
    palette slots). A key admitted by one side and refused by another is a
    pipeline that disagrees with itself, so each pin failure names the other
    files (2026-08-24 review finding H1 closed the vocabulary; this keeps it
    closed IN STEP).
    """

    REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

    def test_matches_the_go_admission_vocabulary(self):
        source = (self.REPO_ROOT / "internal/panels/types.go").read_text(encoding="utf-8")
        import re

        match = re.search(r"categoryServeOrder = \[\]string\{([^}]*)\}", source)
        self.assertIsNotNone(match, "internal/panels/types.go carries no categoryServeOrder")
        go_keys = tuple(re.findall(r'"([^"]+)"', match.group(1)))
        self.assertEqual(
            go_keys,
            capture_usage_series.CATEGORY_KEYS,
            "categoryServeOrder in internal/panels/types.go and CATEGORY_KEYS in "
            "scripts/capture_usage_series.py must stay identical, in order",
        )

    def test_matches_the_frontend_palette_slots(self):
        source = (self.REPO_ROOT / "frontend/src/lib/token-usage.ts").read_text(encoding="utf-8")
        import re

        match = re.search(r"categorySlots[^(]*\(\[([^\]]*(?:\][^\]]*)*?)\]\);", source, re.DOTALL)
        self.assertIsNotNone(match, "frontend/src/lib/token-usage.ts carries no categorySlots")
        ts_keys = tuple(re.findall(r"\['([^']+)',\s*\d+\]", match.group(1)))
        self.assertEqual(
            ts_keys,
            capture_usage_series.CATEGORY_KEYS,
            "categorySlots in frontend/src/lib/token-usage.ts and CATEGORY_KEYS in "
            "scripts/capture_usage_series.py must stay identical, in order",
        )


class CapParityTest(unittest.TestCase):
    """The payload ceiling is ONE fact spelled in five places.

    Producer, sealer, transport, receiver and origin each enforce it, and
    before the 2026-08-24 security review (finding 4) they enforced five
    DIFFERENT numbers: a valid export could be sealed and pushed and never
    admitted, and an oversized one was truncated by the receiver, installed
    over the last good file, and only then reported as a checksum mismatch.
    Each pin failure names the other files, exactly as the category
    vocabulary's parity pin does.

    The canonical statement is `MaxSealedBytes` in internal/seal/types.go;
    internal/panels restates it because its zero-egress doctrine pin forbids
    importing that package, and the shell script and the operator manual
    restate it because neither can read a Go constant.
    """

    REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

    def go_cap(self):
        import re

        source = (self.REPO_ROOT / "internal/seal/types.go").read_text(encoding="utf-8")
        match = re.search(r"MaxSealedBytes = (\d+) << (\d+)", source)
        self.assertIsNotNone(match, "internal/seal/types.go carries no MaxSealedBytes")
        return int(match.group(1)) << int(match.group(2))

    def structural_maximum(self, digits):
        """Seal-sized bytes of the largest document the origin can admit.

        MEASURED here rather than quoted from a comment (2026-08-24 round-3
        review, which found the quoted figure off by the mandatory trailing
        newline). The maximum is one document covering every label the
        SHIPPED snapshot carries — a document can never name another — each
        at the series-day bound with the complete category vocabulary and the
        complete window and derived sets, emitted in the producer's own
        compact form with its terminating newline, plus the AEAD overhead.
        Re-deriving it from the shipped constants means the number cannot go
        stale behind a document-shape change again.
        """
        snapshot = json.loads(
            (self.REPO_ROOT / "internal/panels/snapshots/token-usage.json").read_text(
                encoding="utf-8"
            )
        )
        labels = [source["label"] for source in snapshot["data"]["sources"]]
        self.assertGreater(len(labels), 0, "the shipped snapshot carries no sources")
        instant = "2026-08-24T12:00:00Z"
        value = 10**digits - 1
        total = value * len(capture_usage_series.CATEGORY_KEYS)
        days = capture_usage_series.MAX_SERIES_DAYS
        document = {
            "schema": "usage-series/v1",
            "generatedAt": instant,
            "sources": {
                label: {
                    "capturedAt": instant,
                    "series": {
                        "startDate": "2024-01-01",
                        "totals": [total] * days,
                        "recorded": True,
                    },
                    "categories": {
                        key: [value] * days for key in capture_usage_series.CATEGORY_KEYS
                    },
                    "windows": {
                        "today": {"input": value, "output": value},
                        "week": {"input": value, "output": value},
                    },
                    "derived": {
                        "peak-day": total,
                        "current-streak": days,
                        "longest-streak": days,
                    },
                }
                for label in labels
            },
        }
        plaintext = json.dumps(document, separators=(",", ":")) + "\n"
        return len(plaintext.encode("utf-8")) + 36

    def test_the_canonical_cap_exceeds_the_measured_structural_maximum(self):
        # Non-vacuity, and the one place the measurement is asserted rather
        # than described: the ceiling must exceed the largest document the
        # origin can admit, with real headroom, while staying a bound rather
        # than an open door.
        cap = self.go_cap()
        self.assertEqual(cap, 131072)
        maximum = self.structural_maximum(10)
        self.assertGreater(cap, maximum)
        # The headroom is three further decimal digits on every value: the
        # same maximum still fits at thirteen digits and only crosses at
        # fourteen. That is the claim docs/usage-export.md makes, measured.
        self.assertLess(self.structural_maximum(13), cap)
        self.assertGreater(self.structural_maximum(14), cap)

    def test_matches_the_origin_admission_cap(self):
        import re

        source = (self.REPO_ROOT / "internal/panels/types.go").read_text(encoding="utf-8")
        match = re.search(r"maxSealedSeriesBytes = (\d+) << (\d+)", source)
        self.assertIsNotNone(match, "internal/panels/types.go carries no maxSealedSeriesBytes")
        self.assertEqual(
            int(match.group(1)) << int(match.group(2)),
            self.go_cap(),
            "maxSealedSeriesBytes in internal/panels/types.go and MaxSealedBytes in "
            "internal/seal/types.go must state the identical ceiling",
        )

    def test_matches_the_exporter(self):
        import re

        source = (self.REPO_ROOT / "scripts/export_usage_series.py").read_text(encoding="utf-8")
        cap = re.search(r"MAX_SEALED_BYTES = (\d+) \* 1024", source)
        overhead = re.search(r"SEAL_OVERHEAD = (\d+)", source)
        self.assertIsNotNone(cap, "scripts/export_usage_series.py carries no MAX_SEALED_BYTES")
        self.assertIsNotNone(overhead, "scripts/export_usage_series.py carries no SEAL_OVERHEAD")
        self.assertEqual(
            int(cap.group(1)) * 1024,
            self.go_cap(),
            "MAX_SEALED_BYTES in scripts/export_usage_series.py and MaxSealedBytes in "
            "internal/seal/types.go must state the identical ceiling",
        )
        # The overhead is what turns the sealed ceiling into the producer's
        # plaintext bound, so it is pinned against the Go format too.
        seal_source = (self.REPO_ROOT / "internal/seal/types.go").read_text(encoding="utf-8")
        magic = re.search(r'magic = "([^"]+)"', seal_source)
        nonce = re.search(r"nonceBytes = (\d+)", seal_source)
        tag = re.search(r"tagBytes = (\d+)", seal_source)
        self.assertIsNotNone(magic, "internal/seal/types.go carries no magic")
        self.assertEqual(
            int(overhead.group(1)),
            len(magic.group(1)) + int(nonce.group(1)) + int(tag.group(1)),
            "SEAL_OVERHEAD in scripts/export_usage_series.py must equal Overhead in "
            "internal/seal/types.go (magic + nonce + tag)",
        )

    def test_matches_the_push_script(self):
        import re

        source = (
            self.REPO_ROOT / "scripts/usage-export/push-usage-series.sh"
        ).read_text(encoding="utf-8")
        match = re.search(r"^MAX_SEALED_BYTES=(\d+)$", source, re.MULTILINE)
        self.assertIsNotNone(
            match, "scripts/usage-export/push-usage-series.sh carries no MAX_SEALED_BYTES"
        )
        self.assertEqual(
            int(match.group(1)),
            self.go_cap(),
            "MAX_SEALED_BYTES in scripts/usage-export/push-usage-series.sh and "
            "MaxSealedBytes in internal/seal/types.go must state the identical ceiling",
        )

    def test_matches_the_documented_forced_command_and_manual(self):
        import re

        cap = self.go_cap()
        source = (self.REPO_ROOT / "docs/usage-export.md").read_text(encoding="utf-8")

        # The receiver reads cap+1 so an over-cap payload is a DECISION about
        # the real size, never a truncation, and refuses before any rename.
        self.assertIn("head -c %d " % (cap + 1), source,
                      "the documented forced command must read one byte past the ceiling")
        self.assertIn('-gt %d ' % cap, source,
                      "the documented forced command must refuse past the ceiling")
        refusal = source.index("echo over-cap")
        rename = source.index("&& mv ")
        self.assertLess(refusal, rename,
                        "the documented forced command must refuse BEFORE it renames over the last good file")

        # And the operator manual states the same number in prose, so the
        # ceiling an operator reads cannot drift from the one enforced.
        self.assertIn(
            "%s sealed bytes" % format(cap, ","),
            source,
            "docs/usage-export.md must state the ceiling in prose",
        )


class CaptureTest(unittest.TestCase):
    def test_a_walk_emits_dates_and_integers_and_nothing_else(self):
        with tempfile.TemporaryDirectory() as root:
            nested = os.path.join(root, "-home-someone-a-private-project")
            os.makedirs(nested)
            with open(os.path.join(nested, "session.jsonl"), "w", encoding="utf-8") as handle:
                handle.write(transcript_line() + "\n")
                handle.write(transcript_line() + "\n")  # the duplicate
                handle.write(
                    transcript_line(
                        timestamp="2026-08-12T01:00:00Z",
                        requestId="req_cccccccccccc",
                        message={
                            "id": "msg_cccccccccccc",
                            "usage": {"input_tokens": 3, "output_tokens": 4},
                        },
                    )
                    + "\n"
                )
                handle.write("a line that is not JSON at all\n")
            with open(os.path.join(nested, "notes.txt"), "w", encoding="utf-8") as handle:
                handle.write(transcript_line() + "\n")  # not .jsonl: never read

            series, derived, counters = capture_usage_series.capture(root)

        self.assertEqual(series, {"startDate": "2026-08-10", "totals": [135, 0, 7], "recorded": True})
        self.assertEqual(derived, {"peak-day": 135, "current-streak": 1, "longest-streak": 1})
        self.assertEqual(counters["files"], 1)
        self.assertEqual(counters["duplicates"], 1)
        self.assertEqual(counters["counted"], 2)

        # The whole emission, re-read as text: not one identifier, path,
        # branch name or sentence from the transcripts may appear in it.
        emitted = json.dumps({"series": series, "derived": derived, "counters": counters})
        for leak in (
            "a-private-project",
            "someone",
            "secret-feature",
            "session.jsonl",
            "msg_aaaaaaaaaaaa",
            "req_aaaaaaaaaaaa",
            "11111111-2222-3333-4444-555555555555",
            "nobody outside this machine",
        ):
            with self.subTest(leak=leak):
                self.assertNotIn(leak, emitted)


class SpliceTest(unittest.TestCase):
    def document(self):
        return {
            "generatedAt": "2026-08-01T00:00:00Z",
            "data": {
                "sources": [
                    {
                        "label": "first",
                        "windows": [],
                        "stats": [
                            {"key": "lifetime", "label": "Lifetime", "value": 99, "unit": "tokens"},
                            {"key": "peak-day", "label": "Peak day", "value": None, "unit": "tokens"},
                            {"key": "current-streak", "label": "Current", "value": 9, "unit": "days"},
                            {"key": "longest-streak", "label": "Longest", "value": 9, "unit": "days"},
                        ],
                        "insights": [{"label": "one", "pct": 5}],
                    },
                    {"label": "second", "windows": [], "stats": [{"key": "peak-day", "label": "Peak day", "value": 1, "unit": "tokens"}]},
                ]
            },
        }

    def splice(self, document, label="first"):
        return capture_usage_series.splice(
            document,
            label,
            {"startDate": "2026-08-10", "totals": [4, 6], "recorded": True},
            {"peak-day": 6, "current-streak": 2, "longest-streak": 2},
            "2026-08-24T00:00:00Z",
        )

    def test_updates_only_the_named_source(self):
        spliced = self.splice(self.document())
        first, second = spliced["data"]["sources"]
        self.assertEqual(first["series"]["totals"], [4, 6])
        self.assertNotIn("series", second)
        self.assertEqual(second["stats"][0]["value"], 1, "an unnamed source keeps its own figures")

    def test_updates_only_the_tiles_the_series_defines(self):
        spliced = self.splice(self.document())
        values = {stat["key"]: stat["value"] for stat in spliced["data"]["sources"][0]["stats"]}
        self.assertEqual(values, {"lifetime": 99, "peak-day": 6, "current-streak": 2, "longest-streak": 2})

    def test_adds_no_tile_the_owner_did_not_choose_to_show(self):
        document = self.document()
        document["data"]["sources"][0]["stats"] = [
            {"key": "lifetime", "label": "Lifetime", "value": 99, "unit": "tokens"}
        ]
        spliced = self.splice(document)
        self.assertEqual([stat["key"] for stat in spliced["data"]["sources"][0]["stats"]], ["lifetime"])

    def test_writes_the_series_where_the_struct_declares_it(self):
        spliced = self.splice(self.document())
        self.assertEqual(
            list(spliced["data"]["sources"][0]),
            ["label", "windows", "stats", "series", "insights"],
        )

    def test_keeps_a_field_the_key_order_does_not_name(self):
        document = self.document()
        document["data"]["sources"][0]["somethingNew"] = 1
        spliced = self.splice(document)
        self.assertEqual(spliced["data"]["sources"][0]["somethingNew"], 1)

    def test_dates_the_capture(self):
        self.assertEqual(self.splice(self.document())["generatedAt"], "2026-08-24T00:00:00Z")

    def test_refuses_a_label_the_snapshot_does_not_carry(self):
        # Silently writing nothing would leave the panel exactly as wrong as
        # it was, with a successful exit code saying otherwise.
        with self.assertRaises(CaptureError):
            self.splice(self.document(), label="nobody")

    def test_refuses_a_document_that_is_not_a_token_usage_snapshot(self):
        for document in ({}, {"data": {}}, {"data": {"sources": "all of them"}}):
            with self.subTest(document=document):
                with self.assertRaises(CaptureError):
                    self.splice(document)

    def test_refuses_a_series_derived_tile_in_a_unit_the_series_cannot_fill(self):
        document = self.document()
        document["data"]["sources"][0]["stats"][1]["unit"] = "seconds"
        with self.assertRaises(CaptureError):
            self.splice(document)


if __name__ == "__main__":
    unittest.main()


class FinalOpenIsDescriptorRootedTest(unittest.TestCase):
    """2026-08-25 round-4 review, finding 4: the check/open TOCTOU.

    Every symlink, type, and containment check the walk performs happens on a
    PATH, and the file was opened later with `Path.open()`, which follows
    whatever the leaf has become. The reviewer admitted a regular record,
    replaced it with a symlink pointing outside the configured root, and the
    production open read the outside target. These tests reproduce that swap
    and require it refused.
    """

    def setUp(self):
        self.scratch = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.scratch, ignore_errors=True)
        self.root = os.path.join(self.scratch, "transcripts")
        os.makedirs(self.root)
        self.record = os.path.join(self.root, "session.jsonl")
        with open(self.record, "w", encoding="utf-8") as handle:
            handle.write(transcript_line() + "\n")
        self.outside = os.path.join(self.scratch, "outside.jsonl")
        with open(self.outside, "w", encoding="utf-8") as handle:
            handle.write("a private file the producer must never read\n")

    def admit(self):
        counters = capture_usage_series.new_counters()
        admitted = capture_usage_series.admitted_records(self.root, counters)
        self.assertEqual(len(admitted), 1, "the fixture must admit exactly one record")
        return admitted[0], counters

    def test_the_admitted_record_carries_the_identity_it_was_checked_with(self):
        (path, identity), _ = self.admit()
        info = os.lstat(path)
        self.assertEqual(identity, (info.st_dev, info.st_ino))

    def test_the_happy_path_still_reads_the_admitted_file(self):
        # Non-vacuity for every refusal below: with nothing swapped, the same
        # call opens the record and returns its contents.
        record, counters = self.admit()
        handle = capture_usage_series.open_record_file(record, counters)
        self.assertIsNotNone(handle, "an untouched admitted record was refused")
        with handle:
            self.assertIn("2026-08-10", handle.read())
        self.assertEqual(counters["unreadable"], 0)
        self.assertEqual(counters["symlinks"], 0)

    def test_a_post_check_symlink_swap_is_refused(self):
        # The reviewer's exact probe: admit a regular file, then replace it
        # with a symlink out of the tree before the open.
        record, counters = self.admit()
        os.unlink(self.record)
        os.symlink(self.outside, self.record)
        handle = capture_usage_series.open_record_file(record, counters)
        if handle is not None:
            with handle:
                content = handle.read()
            self.fail("the final open followed a post-check symlink swap and read %r" % content[:40])
        self.assertEqual(counters["unreadable"], 1)

    def test_a_post_check_swap_for_a_different_regular_file_is_refused(self):
        # O_NOFOLLOW alone cannot see this one: the leaf is a perfectly
        # ordinary regular file, just not the file that was admitted. The
        # identity check is what catches it.
        record, counters = self.admit()
        os.unlink(self.record)
        with open(self.record, "w", encoding="utf-8") as handle:
            handle.write("substituted content\n")
        self.assertIsNone(capture_usage_series.open_record_file(record, counters))
        self.assertEqual(counters["symlinks"], 1)

    def test_a_post_check_hard_link_swap_is_refused(self):
        # A hard link to the outside file is a regular file AND is not a
        # symlink, so only the identity comparison refuses it.
        record, counters = self.admit()
        os.unlink(self.record)
        os.link(self.outside, self.record)
        self.assertIsNone(capture_usage_series.open_record_file(record, counters))
        self.assertEqual(counters["symlinks"], 1)

    def test_a_post_check_fifo_swap_is_refused(self):
        # Not merely a privacy question: opening a fifo read-only BLOCKS
        # until a writer appears, so a swapped-in fifo would hang this hourly
        # unattended job forever. O_NONBLOCK is what makes the open return,
        # and the descriptor fstat is what refuses the leaf as not a regular
        # file — before any read. This test hangs against a build without
        # O_NONBLOCK, which is how it earns its place.
        record, counters = self.admit()
        os.unlink(self.record)
        os.mkfifo(self.record)
        handle = None
        try:
            handle = capture_usage_series.open_record_file(record, counters)
        except OSError:
            self.fail("the open raised instead of refusing a non-regular leaf")
        self.assertIsNone(handle)
        self.assertEqual(counters["symlinks"], 1)

    def test_a_swapped_record_contributes_nothing_to_the_emission(self):
        # The end-to-end statement, covering the OTHER half of the window: a
        # leaf swapped before the walk is refused by the walk's own symlink
        # check, exactly as a leaf swapped after it is refused by the open
        # above. Either way the run emits nothing derived from outside the
        # root — here by refusing outright, because a tree whose only record
        # is unreadable has no series to report and inventing one would be
        # the failure this tool exists to avoid.
        os.unlink(self.record)
        os.symlink(self.outside, self.record)
        with self.assertRaises(CaptureError):
            capture_usage_series.capture(
                self.root, capture_usage_series.FORMAT_MESSAGES
            )
