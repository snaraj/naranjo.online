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
import datetime
import importlib.util
import json
import os
import re
import shutil
import pathlib
import subprocess
import sys
import tempfile
import time
import unittest


def setUpModule():
    # The capture buckets records into the WORKSTATION-LOCAL calendar day
    # (issue #276), so every day expectation in this suite depends on the
    # process timezone. Pinning TZ=UTC once makes the suite deterministic on
    # every machine — CI runners and developer laptops in any zone alike —
    # and LocalDayTest is the one place a non-UTC zone is staged, explicitly,
    # to prove the local bucketing is real rather than a UTC rule wearing a
    # new name.
    os.environ["TZ"] = "UTC"
    time.tzset()

_MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "capture_usage_series.py"
_SPEC = importlib.util.spec_from_file_location("capture_usage_series", _MODULE_PATH)
if _SPEC is None or _SPEC.loader is None:
    # Both are Optional, and both being None means the same thing: the module
    # under test is not where this suite says it is. Saying so by name beats
    # an AttributeError on None three lines later, which reads as a broken
    # test rather than a missing subject.
    raise ImportError("the capture step is not loadable at %s" % _MODULE_PATH)
capture_usage_series = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(capture_usage_series)


def required_match(pattern, text, message, flags=0):
    """One `re.search` that MUST match, or an AssertionError naming the miss.

    Every parity pin below reads a literal out of another file, and the read
    is evidence only if it found something. `re.search` returns None on a
    miss and `.group` on None raises AttributeError — a crash naming neither
    the pattern nor the file, which reads as a broken test rather than as the
    broken parity it actually is. Raising AssertionError makes the miss the
    FAILURE the pin always meant, carrying the message the pin already wrote,
    and it does so for every capture rather than only the ones that happened
    to be guarded.
    """
    found = re.search(pattern, text, flags)
    if found is None:
        raise AssertionError(message)
    return found


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


def running_totals_line(stamp, **fields):
    """One running-totals record whose cumulative fields are stated outright.

    `running_line` above models the owner's own tree, where the cache fields
    equal the whole and the coarse tier carries the day. This one lets a test
    choose the tier — a day that partitions five ways, a day that partitions
    two ways, or a day that cannot be partitioned at all — which is what the
    categories-window rules need in order to be exercised at all.
    """
    usage = {field: 0 for field in capture_usage_series.RUNNING_FIELDS}
    usage.update(fields)
    return json.dumps(
        {
            "timestamp": stamp,
            "type": "event_msg",
            "payload": {"type": "token_count", "info": {"total_token_usage": usage}},
        }
    )


def turn_model_line(identifier, stamp="2026-08-23T11:59:30.000Z"):
    """The record that DECLARES which model the turn about to run uses.

    The shape journals the model where a turn OPENS and the cumulative counts
    where it ends, which is why the walk carries the model in force rather
    than reading one off the counting record (issue #302). Named for what it
    contains, like every other shape here.
    """
    return json.dumps(
        {
            "timestamp": stamp,
            "type": "turn_context",
            "payload": {
                "turn_id": "01a037b7-7e24-7a63-a78f-3fd55ee77675",
                "model": identifier,
                "approval_policy": "on-request",
            },
        }
    )


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

    def test_reduces_a_record_to_a_day_an_instant_a_total_a_partition_and_a_member(self):
        # Five values, and the last three are what make the breakdown sections
        # a MEASUREMENT of the same records the total is measured from: the
        # partition is the record's own disjoint usage fields, and the member
        # is the closed vocabulary's, resolved from the record's own model.
        # The INSTANT is the ledger's (issue #267) and is UTC where the day
        # beside it is local — a day is a bucket, a span is a duration.
        self.assertEqual(
            self.reduce(transcript_line()),
            (
                "2026-08-10",
                "2026-08-10T12:00:00Z",
                135,
                {"input": 10, "output": 5, "cache-read": 100, "cache-write": 20},
                "other",
            ),
        )
        # The partition IS the total, checked rather than described.
        _day, _instant, total, parts, _member = self.reduce(transcript_line(requestId="req_2"))
        self.assertEqual(sum(parts.values()), total)

    def test_a_record_names_its_model_and_an_unknown_one_becomes_the_residual(self):
        # Membership, not shape. A vendor-qualified identifier whose model
        # half is a vocabulary member resolves to that member; anything else
        # lands on the reserved residual and is COUNTED, so an operator can
        # see model churn without an unreviewed label ever being minted.
        member = capture_usage_series.MODEL_KEYS[1]
        record = json.loads(transcript_line())
        record["message"]["model"] = "avendor-%s" % member
        self.assertEqual(self.reduce(json.dumps(record))[4], member)
        self.assertEqual(self.counters["unattributed"], 0)
        for unknown in ("<synthetic>", "avendor-not-a-member", "", None, 17):
            with self.subTest(unknown=unknown):
                record = json.loads(transcript_line(requestId="req_%s" % unknown))
                record["message"]["model"] = unknown
                self.assertEqual(
                    self.reduce(json.dumps(record))[4], capture_usage_series.MODEL_OTHER
                )
        self.assertEqual(self.counters["unattributed"], 5)

    def test_the_residual_member_can_never_be_named_by_a_record(self):
        # `other` is the vocabulary's own reserved slot. A record claiming it
        # by name must not be admitted AS a named model — it takes the same
        # residual path every unattributable record takes, and is counted.
        record = json.loads(transcript_line())
        record["message"]["model"] = "avendor-%s" % capture_usage_series.MODEL_OTHER
        self.assertEqual(self.reduce(json.dumps(record))[4], capture_usage_series.MODEL_OTHER)
        self.assertEqual(self.counters["unattributed"], 1)

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

    def test_reduces_a_record_to_a_day_an_instant_and_its_cumulative_fields(self):
        day, instant, running = self.reduce(running_line(500))
        self.assertEqual(instant, "2026-08-23T12:00:00Z")
        self.assertEqual(day, "2026-08-23")
        self.assertEqual(set(running), set(capture_usage_series.RUNNING_FIELDS))
        self.assertEqual(running[capture_usage_series.RUNNING_TOTAL_FIELD], 500)

    def test_the_day_comes_from_the_record_and_never_from_the_clock(self):
        # A session started before midnight local time is journalled under
        # the day it STARTED, while its records happen after midnight UTC.
        # Reading the day off anything but the record's own instant would put
        # a whole evening's work on the wrong cell.
        day, instant, running = self.reduce(running_line(500, stamp="2026-08-24T03:51:18.443Z"))
        # Sub-second precision is dropped rather than rounded: the tile the
        # span feeds is measured in whole seconds.
        self.assertEqual(instant, "2026-08-24T03:51:18Z")
        self.assertEqual(day, "2026-08-24")
        self.assertEqual(running[capture_usage_series.RUNNING_TOTAL_FIELD], 500)

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
            rows = list(capture_usage_series.read_running_totals(root, counters))
        return rows, counters

    @staticmethod
    def days(rows):
        return [(day, total) for day, total, _parts, _member in rows]

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
        self.assertEqual(sum(total for _day, total, _p, _m in pairs), 600)
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
        self.assertEqual(sum(total for _day, total, _p, _m in pairs), 420)
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
        self.assertEqual(sum(total for _day, total, _p, _m in pairs), 650)

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
        self.assertEqual(self.days(pairs), [("2026-08-23", 100), ("2026-08-24", 350)])

    def test_a_file_that_reports_nothing_usable_contributes_nothing(self):
        pairs, counters = self.walk(
            {"day/session.jsonl": [session_meta_line(), "not json at all"]}
        )
        self.assertEqual(pairs, [])
        self.assertEqual(counters["files"], 1)
        self.assertEqual(counters["counted"], 0)


class OversizedLineTest(unittest.TestCase):
    """One fat record must not silence the whole pipeline (2026-08-27).

    The per-line bound is a MEMORY guard. It was also, until this suite, a
    refusal: a single line past it raised, so one pasted payload in one
    journal stopped every scheduled export for every source — measured on the
    owner's own tree, where exactly one line over the bound had frozen the
    panel. Skipping bounds memory just as well and loses only the record it
    could not read.
    """

    def walk(self, text, record_format=capture_usage_series.FORMAT_MESSAGES):
        counters = capture_usage_series.new_counters()
        reader = (
            capture_usage_series.read_records
            if record_format == capture_usage_series.FORMAT_MESSAGES
            else capture_usage_series.read_running_totals
        )
        with tempfile.TemporaryDirectory() as root:
            path = pathlib.Path(root) / "session.jsonl"
            path.write_text(text, encoding="utf-8")
            rows = list(reader(root, counters))
        return rows, counters

    def fat_line(self):
        # One record whose own bytes exceed the bound, by exactly the field
        # the bound exists to stop this process holding: a huge string.
        return transcript_line(
            requestId="req_fat",
            message={
                "id": "msg_fat",
                "content": "x" * (capture_usage_series.MAX_RECORD_LINE_BYTES + 64),
                "usage": {"input_tokens": 999_999},
            },
        )

    def test_an_oversized_line_is_skipped_counted_and_not_fatal(self):
        rows, counters = self.walk(
            transcript_line() + "\n" + self.fat_line() + "\n"
            + transcript_line(
                timestamp="2026-08-11T12:00:00Z",
                requestId="req_after",
                message={"id": "msg_after", "usage": {"output_tokens": 7}},
            )
            + "\n"
        )
        self.assertEqual(counters["oversized"], 1)
        # The records on BOTH sides of it are still read: the tail of the
        # oversized line is drained to its own newline, so the next record
        # starts at a real boundary rather than mid-string.
        self.assertEqual([day for day, _t, _p, _m in rows], ["2026-08-10", "2026-08-11"])
        self.assertEqual([total for _d, total, _p, _m in rows], [135, 7])
        # And the skipped record contributes nothing rather than a guess.
        self.assertNotIn(999_999, [total for _d, total, _p, _m in rows])

    def test_the_bound_still_bounds_what_is_held_in_memory(self):
        # Non-vacuity in the direction that matters: the yielded lines are
        # every one of them inside the bound, so nothing past it was ever
        # materialised as a record.
        rows, counters = self.walk(self.fat_line() + "\n" + transcript_line() + "\n")
        self.assertEqual(counters["oversized"], 1)
        self.assertEqual(len(rows), 1)

    def test_an_unterminated_oversized_line_ends_the_file_cleanly(self):
        rows, counters = self.walk(transcript_line() + "\n" + self.fat_line())
        self.assertEqual(counters["oversized"], 1)
        self.assertEqual(len(rows), 1)

    def test_an_exactly_terminated_oversized_line_does_not_swallow_its_neighbour(self):
        # The boundary case the 2026-08-27 adversarial review of PR #230
        # found (finding 1): readline(MAX+1) can return an oversized line
        # that is ALREADY newline-terminated — content of exactly the bound
        # plus its newline. The drain exists for a line that came back
        # truncated; draining past a complete one consumes the NEXT record
        # whole, uncounted by any counter. Both neighbours must survive.
        def with_content(content):
            return transcript_line(
                requestId="req_exact",
                message={
                    "id": "msg_exact",
                    "content": content,
                    "usage": {"input_tokens": 999_999},
                },
            )

        # Each "x" costs exactly one byte inside the JSON string, so padding
        # the empty-content probe out to the bound is exact, and the newline
        # the walk appends is what pushes readline past it.
        padding = capture_usage_series.MAX_RECORD_LINE_BYTES - len(with_content(""))
        exact = with_content("x" * padding)
        self.assertEqual(len(exact), capture_usage_series.MAX_RECORD_LINE_BYTES)
        rows, counters = self.walk(
            exact + "\n"
            + transcript_line(
                timestamp="2026-08-11T12:00:00Z",
                requestId="req_next",
                message={"id": "msg_next", "usage": {"output_tokens": 7}},
            )
            + "\n"
        )
        self.assertEqual(counters["oversized"], 1)
        self.assertEqual([total for _d, total, _p, _m in rows], [7])

    def test_the_other_record_shape_skips_it_the_same_way(self):
        fat = json.loads(running_line(500))
        fat["payload"]["info"]["padding"] = "x" * (
            capture_usage_series.MAX_RECORD_LINE_BYTES + 64
        )
        rows, counters = self.walk(
            json.dumps(fat) + "\n" + running_line(100) + "\n",
            capture_usage_series.FORMAT_RUNNING_TOTALS,
        )
        self.assertEqual(counters["oversized"], 1)
        self.assertEqual([total for _d, total, _p, _m in rows], [100])

    def test_terminated_oversized_lines_still_count_against_the_tree_byte_bound(self):
        # 2026-08-27 review of PR #230, INFO-6: the terminated-oversized
        # branch adds the line's bytes to the tally and then skipped the
        # tree-wide ceiling check every other accumulation path enforces —
        # so a tree made of newline-terminated oversized records was the one
        # input shape MAX_RECORD_BYTES never bounded. The bounds are patched
        # small here because the shipped ceiling is deliberately sized in
        # gibibytes; what is under test is the CHECK, not the number.
        module = capture_usage_series
        original_line = module.MAX_RECORD_LINE_BYTES
        original_bytes = module.MAX_RECORD_BYTES
        module.MAX_RECORD_LINE_BYTES = 4096
        module.MAX_RECORD_BYTES = 2 * 4096
        try:
            def with_content(content):
                return transcript_line(
                    requestId="req_exact",
                    message={
                        "id": "msg_exact",
                        "content": content,
                        "usage": {"input_tokens": 1},
                    },
                )

            padding = module.MAX_RECORD_LINE_BYTES - len(with_content(""))
            exact = with_content("x" * padding)
            self.assertEqual(len(exact), module.MAX_RECORD_LINE_BYTES)
            with self.assertRaises(CaptureError) as refusal:
                self.walk((exact + "\n") * 3)
            self.assertIn("byte bound", str(refusal.exception))
        finally:
            module.MAX_RECORD_LINE_BYTES = original_line
            module.MAX_RECORD_BYTES = original_bytes


class RunningTotalsAttributionTest(unittest.TestCase):
    """The model and the counts arrive in DIFFERENT records (issue #302).

    This shape used to attribute every token it read to the residual, because
    the reader only knew how to read a counting record and the model is named
    somewhere else in the file. Every case below is a real journal shape, and
    each pins one half of the rule: the model in force at an advance is the
    one that advance is billed to.
    """

    MEMBER = capture_usage_series.MODEL_KEYS[6]
    OTHER_MEMBER = capture_usage_series.MODEL_KEYS[7]

    def walk(self, lines):
        counters = capture_usage_series.new_counters()
        with tempfile.TemporaryDirectory() as root:
            path = pathlib.Path(root) / "day" / "session.jsonl"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            rows = list(capture_usage_series.read_running_totals(root, counters))
        return [(total, member) for _day, total, _parts, member in rows], counters

    def identifier(self, key):
        """The raw identifier the vocabulary says folds to one member."""
        document = json.loads(
            (pathlib.Path(__file__).resolve().parents[2] / "internal/panels/config/models.json")
            .read_text(encoding="utf-8")
        )
        for group in document["groups"]:
            for member in group["members"]:
                if member["key"] == key and member["ids"]:
                    return member["ids"][0]
        raise AssertionError("no identifier declared for %s" % key)

    def test_every_advance_is_billed_to_the_declared_model(self):
        rows, counters = self.walk(
            [
                turn_model_line(self.identifier(self.MEMBER)),
                running_line(100),
                running_line(300),
            ]
        )
        self.assertEqual(rows, [(100, self.MEMBER), (200, self.MEMBER)])
        self.assertEqual(counters["unattributed"], 0)

    def test_a_file_that_switches_models_bills_each_advance_to_the_one_in_force(self):
        rows, _counters = self.walk(
            [
                turn_model_line(self.identifier(self.MEMBER)),
                running_line(100),
                turn_model_line(self.identifier(self.OTHER_MEMBER)),
                running_line(300),
                running_line(450),
            ]
        )
        self.assertEqual(
            rows,
            [(100, self.MEMBER), (200, self.OTHER_MEMBER), (150, self.OTHER_MEMBER)],
        )

    def test_advances_before_any_declaration_fold_to_the_residual(self):
        # The honest answer for tokens whose model the file never named: the
        # residual is the fold of what cannot be attributed, and inventing an
        # attribution from the NEXT declaration would bill one model for
        # another's work.
        rows, counters = self.walk(
            [
                running_line(100),
                turn_model_line(self.identifier(self.MEMBER)),
                running_line(300),
            ]
        )
        self.assertEqual(
            rows, [(100, capture_usage_series.MODEL_OTHER), (200, self.MEMBER)]
        )
        self.assertEqual(counters["unattributed"], 0)

    def test_a_restart_after_a_switch_keeps_the_model_in_force(self):
        # The restart arithmetic and the attribution are independent: a
        # session that resets its own accounting is still running the model
        # its last declaration named.
        rows, counters = self.walk(
            [
                turn_model_line(self.identifier(self.MEMBER)),
                running_line(100),
                turn_model_line(self.identifier(self.OTHER_MEMBER)),
                running_line(300),
                running_line(50),
            ]
        )
        self.assertEqual(
            rows,
            [(100, self.MEMBER), (200, self.OTHER_MEMBER), (50, self.OTHER_MEMBER)],
        )
        self.assertEqual(counters["restarts"], 1)

    def test_an_unnamed_identifier_folds_to_the_residual_and_is_counted_once(self):
        # Counted where it is DECLARED rather than once per advance: one
        # unreviewed identifier is one fold, however many turns it billed.
        rows, counters = self.walk(
            [
                turn_model_line("avendor-not-a-member"),
                running_line(100),
                running_line(300),
            ]
        )
        self.assertEqual(
            rows,
            [
                (100, capture_usage_series.MODEL_OTHER),
                (200, capture_usage_series.MODEL_OTHER),
            ],
        )
        self.assertEqual(counters["unattributed"], 1)
        self.assertNotIn("not-a-member", json.dumps(rows))

    def test_each_file_opens_with_no_model_of_its_own(self):
        # The model in force is per FILE, exactly as the running total is: a
        # declaration in one journal says nothing about the next.
        counters = capture_usage_series.new_counters()
        with tempfile.TemporaryDirectory() as root:
            first = pathlib.Path(root) / "day" / "a.jsonl"
            first.parent.mkdir(parents=True, exist_ok=True)
            first.write_text(
                "\n".join([turn_model_line(self.identifier(self.MEMBER)), running_line(100)])
                + "\n",
                encoding="utf-8",
            )
            (pathlib.Path(root) / "day" / "b.jsonl").write_text(
                running_line(400) + "\n", encoding="utf-8"
            )
            rows = list(capture_usage_series.read_running_totals(root, counters))
        self.assertEqual(
            sorted((total, member) for _day, total, _p, member in rows),
            [(100, self.MEMBER), (400, capture_usage_series.MODEL_OTHER)],
        )


class ModelFoldTest(unittest.TestCase):
    """The two folds the vocabulary file declares, and the residual behind them."""

    def setUp(self):
        self.counters = capture_usage_series.new_counters()
        self.document = json.loads(
            (pathlib.Path(__file__).resolve().parents[2] / "internal/panels/config/models.json")
            .read_text(encoding="utf-8")
        )

    def members(self):
        for group in self.document["groups"]:
            for member in group["members"]:
                yield member

    def test_every_declared_identifier_folds_to_its_own_member(self):
        declared = 0
        for member in self.members():
            for identifier in member["ids"]:
                declared += 1
                self.assertEqual(
                    capture_usage_series.model_key(identifier, self.counters),
                    member["key"],
                )
        self.assertGreater(declared, 0, "the vocabulary declares no identifiers to fold")
        self.assertEqual(self.counters["unattributed"], 0)

    def test_an_identifier_is_normalised_before_it_is_matched(self):
        # A written version number carries dots; a machine key never does, so
        # the raw identifier is lowercased and its dots read as hyphens before
        # the exact match. Both spellings must reach the same member.
        for member in self.members():
            for identifier in member["ids"]:
                if "-" not in identifier:
                    continue
                spelled = identifier.replace("-", ".", 1).upper()
                self.assertEqual(
                    capture_usage_series.model_key(spelled, self.counters),
                    member["key"],
                    spelled,
                )

    def test_the_prefix_fold_still_reduces_a_vendor_qualified_identifier(self):
        # The rule that existed before the file did, unchanged: an identifier
        # is a vendor segment, a hyphen, then the model. Every member that
        # opted into it in the file must still answer to it.
        for member in self.members():
            if not member.get("prefixStrip"):
                continue
            self.assertEqual(
                capture_usage_series.model_key("avendor-%s" % member["key"], self.counters),
                member["key"],
            )

    def test_a_member_that_did_not_opt_into_the_prefix_fold_is_not_reachable_by_it(self):
        # Membership, not shape: a member declared with exact identifiers is
        # matched by those and by nothing else, so a raw identifier that
        # merely ENDS in a key cannot claim it.
        for member in self.members():
            if member.get("prefixStrip"):
                continue
            self.assertEqual(
                capture_usage_series.model_key("avendor-%s" % member["key"], self.counters),
                capture_usage_series.MODEL_OTHER,
            )

    def test_the_residual_can_never_be_named(self):
        for spelling in (
            capture_usage_series.MODEL_OTHER,
            "avendor-%s" % capture_usage_series.MODEL_OTHER,
        ):
            self.assertEqual(
                capture_usage_series.model_key(spelling, self.counters),
                capture_usage_series.MODEL_OTHER,
            )
        self.assertEqual(self.counters["unattributed"], 2)


class VocabularyRefusalIsAProgramRefusalTest(unittest.TestCase):
    """A refusal at IMPORT must read like every other refusal (PR #303, finding 1).

    The vocabulary is loaded at module import, because the module-level
    emission guard consumes it, so a refusal there can never reach main()'s
    handler. It used to raise `CaptureError` from above the class's own
    definition and die as a `NameError`; even once that was fixed, an
    unhandled exception would have printed a stack trace where every other
    refusal in this program prints one line.

    Driven as a SUBPROCESS rather than through an import, because the fault
    is in what the interpreter does with the module before anything is
    callable — a test that imports the module cannot observe an exit status,
    and a module already imported cannot be made to fail again.
    """

    SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "capture_usage_series.py"

    def run_with_vocabulary(self, raw):
        """Run a COPY of the script whose vocabulary file is `raw`, or absent.

        MODELS_FILE is resolved from the script's own location, so the copy
        reads the temporary file rather than the repository's.
        """
        with tempfile.TemporaryDirectory() as root:
            tree = pathlib.Path(root)
            (tree / "scripts").mkdir()
            (tree / "internal" / "panels" / "config").mkdir(parents=True)
            shutil.copy(self.SCRIPT, tree / "scripts" / self.SCRIPT.name)
            if raw is not None:
                (tree / "internal" / "panels" / "config" / "models.json").write_text(
                    raw, encoding="utf-8"
                )
            return subprocess.run(
                [sys.executable, "-I", "-B", str(tree / "scripts" / self.SCRIPT.name), "--help"],
                capture_output=True,
                text=True,
            )

    def test_a_malformed_vocabulary_refuses_the_way_every_refusal_does(self):
        for name, raw in (
            ("not a document", "not json"),
            ("an unexpected schema", '{"schema": "usage-models/v2"}'),
            ("no groups", '{"schema": "usage-models/v1", "residual": {"key": "other", "label": "Other", "slot": 0}, "groups": []}'),
            ("missing", None),
        ):
            with self.subTest(case=name):
                done = self.run_with_vocabulary(raw)
                self.assertEqual(done.returncode, 1, done.stderr)
                self.assertRegex(done.stderr, r"^the model vocabulary [^\n]+\n$")
                # A refusal, not a crash: no stack trace, and never the
                # NameError this exact shape used to raise.
                self.assertNotIn("Traceback", done.stderr)
                self.assertNotIn("NameError", done.stderr)
                self.assertEqual(done.stdout, "")

    def test_the_shipped_vocabulary_lets_the_program_run(self):
        # The control, without which every assertion above would pass on a
        # script that refused for some other reason entirely.
        raw = (
            pathlib.Path(__file__).resolve().parents[2]
            / "internal/panels/config/models.json"
        ).read_text(encoding="utf-8")
        done = self.run_with_vocabulary(raw)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stderr, "")
        self.assertIn("--transcripts", done.stdout)


class CategoryWindowKeepsAnEmptyClassTest(unittest.TestCase):
    """An accounting class at zero across the window is a READING (finding 3).

    The model partition drops a member that carries nothing across the window
    it covers, because a model either was used or was not. An accounting
    class is a fixed division of the same day, so a class at zero across the
    window is the measurement "no reasoning tokens this week", and dropping
    it would turn that reading into silence. The origin says the same thing
    from the other side in TestDataRootKeepsAnEmptyAccountingClass; this is
    the producer end of the identical rule.
    """

    def capture(self, lines):
        with tempfile.TemporaryDirectory() as root:
            nested = os.path.join(root, "2026", "08")
            os.makedirs(nested)
            with open(os.path.join(nested, "session.jsonl"), "w", encoding="utf-8") as handle:
                handle.write("\n".join(lines) + "\n")
            return capture_usage_series.capture(
                root, capture_usage_series.FORMAT_RUNNING_TOTALS
            )

    def test_a_class_that_measured_nothing_inside_the_window_still_reaches_the_wire(self):
        # Four days. The first partitions into one class; the second cannot be
        # partitioned at all, which is what pushes the categories window past
        # the first; the last two partition into a different class. The class
        # from day one is therefore ZERO across the window the section
        # declares — and it is still emitted, at zero, because that is what it
        # measured there.
        section, _counters = self.capture(
            [
                running_totals_line(
                    "2026-08-20T12:00:00.000Z",
                    total_tokens=10,
                    output_tokens=10,
                    reasoning_output_tokens=10,
                ),
                running_totals_line("2026-08-21T12:00:00.000Z", total_tokens=30),
                running_totals_line(
                    "2026-08-22T12:00:00.000Z", total_tokens=45, input_tokens=15
                ),
                running_totals_line(
                    "2026-08-23T12:00:00.000Z", total_tokens=65, input_tokens=35
                ),
            ]
        )
        self.assertEqual(section["series"]["totals"], [10, 20, 15, 20])
        self.assertEqual(section["categoriesStartDate"], "2026-08-22")
        self.assertEqual(
            section["categories"], {"input": [15, 20], "reasoning": [0, 0]}
        )
        # And the reading is a true one: the rows still partition every day
        # the window covers, zero row included.
        capture_usage_series.assert_partition(
            section["series"]["totals"], section["categories"], 2
        )


class ModelVocabularyLoadTest(unittest.TestCase):
    """Every rule the vocabulary loader states, given an input that breaks it.

    The producer refuses to RUN on a malformed vocabulary rather than
    degrading: a capture with half a vocabulary silently reattributes real
    tokens to the residual, and a capture with none emits a document the
    origin refuses on every push until somebody reads a log.
    """

    TEMPLATE = {
        "schema": "usage-models/v1",
        "residual": {"key": "other", "label": "Other", "slot": 0},
        "groups": [
            {
                "key": "alpha",
                "label": "Alpha",
                "members": [
                    {
                        "key": "alpha-one",
                        "label": "Alpha One",
                        "slot": 1,
                        "ids": ["raw-alpha-one"],
                        "prefixStrip": False,
                    },
                    {
                        "key": "alpha-two",
                        "label": "Alpha Two",
                        "slot": 2,
                        "ids": [],
                        "prefixStrip": True,
                    },
                ],
            }
        ],
    }

    def load(self, document, raw=None):
        with tempfile.TemporaryDirectory() as root:
            path = pathlib.Path(root) / "models.json"
            path.write_text(
                raw if raw is not None else json.dumps(document), encoding="utf-8"
            )
            return capture_usage_series.load_model_vocabulary(path)

    def test_the_template_loads_and_says_what_it_declares(self):
        keys, residual, labels, groups, group_labels, ids, prefix_keys = self.load(
            self.TEMPLATE
        )
        self.assertEqual(keys, ("other", "alpha-one", "alpha-two"))
        self.assertEqual(residual, "other")
        self.assertEqual(labels["alpha-one"], "Alpha One")
        self.assertEqual(groups, {"alpha-one": "alpha", "alpha-two": "alpha"})
        self.assertEqual(group_labels, {"alpha": "Alpha"})
        self.assertEqual(ids, {"raw-alpha-one": "alpha-one"})
        self.assertEqual(prefix_keys, frozenset({"alpha-two"}))

    def test_a_missing_file_refuses_the_run(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(capture_usage_series.CaptureError):
                capture_usage_series.load_model_vocabulary(
                    pathlib.Path(root) / "absent.json"
                )

    def test_every_malformed_shape_refuses(self):
        def edited(mutate):
            document = json.loads(json.dumps(self.TEMPLATE))
            mutate(document)
            return document

        cases = {
            "a schema this code does not understand": edited(
                lambda d: d.__setitem__("schema", "usage-models/v2")
            ),
            "a section outside the declared shape": edited(
                lambda d: d.__setitem__("extra", 1)
            ),
            "a residual on a chromatic slot": edited(
                lambda d: d["residual"].__setitem__("slot", 3)
            ),
            "a residual an identifier can name": edited(
                lambda d: d["residual"].__setitem__("ids", ["raw-other"])
            ),
            "a residual that folds by prefix": edited(
                lambda d: d["residual"].__setitem__("prefixStrip", True)
            ),
            "a residual with no written name": edited(
                lambda d: d["residual"].__setitem__("label", "")
            ),
            "a key that is not machine-shaped": edited(
                lambda d: d["groups"][0]["members"][0].__setitem__("key", "Alpha One")
            ),
            "a member with no written name": edited(
                lambda d: d["groups"][0]["members"][0].__setitem__("label", "")
            ),
            "a member on the residual's neutral slot": edited(
                lambda d: d["groups"][0]["members"][0].__setitem__("slot", 0)
            ),
            "two members of one group painted alike": edited(
                lambda d: d["groups"][0]["members"][1].__setitem__("slot", 1)
            ),
            "one key declared twice": edited(
                lambda d: d["groups"][0]["members"][1].__setitem__("key", "alpha-one")
            ),
            "a key colliding with the residual": edited(
                lambda d: d["groups"][0]["members"][1].__setitem__("key", "other")
            ),
            "one identifier folding to two members": edited(
                lambda d: d["groups"][0]["members"][1].__setitem__("ids", ["raw-alpha-one"])
            ),
            "an identifier that is not lowercase": edited(
                lambda d: d["groups"][0]["members"][0].__setitem__("ids", ["Raw-Alpha-One"])
            ),
            "a blank identifier": edited(
                lambda d: d["groups"][0]["members"][0].__setitem__("ids", [""])
            ),
            "a group with no written label": edited(
                lambda d: d["groups"][0].__setitem__("label", "")
            ),
            "a group key that is not machine-shaped": edited(
                lambda d: d["groups"][0].__setitem__("key", "Alpha")
            ),
            "one group declared twice": edited(
                lambda d: d["groups"].append(json.loads(json.dumps(d["groups"][0])))
            ),
            "a group with no members": edited(
                lambda d: d["groups"][0].__setitem__("members", [])
            ),
            "a file with no groups at all": edited(lambda d: d.__setitem__("groups", [])),
        }
        for name, document in cases.items():
            with self.subTest(case=name):
                with self.assertRaises(capture_usage_series.CaptureError):
                    self.load(document)

    def test_bytes_that_are_not_a_document_refuse(self):
        for raw in ("not json", "[]", '{"schema": "usage-models/v1"}'):
            with self.subTest(raw=raw):
                with self.assertRaises(capture_usage_series.CaptureError):
                    self.load(None, raw=raw)

    def test_a_file_over_its_size_bound_refuses(self):
        with self.assertRaises(capture_usage_series.CaptureError):
            self.load(
                None,
                raw=" " * (capture_usage_series.MAX_MODELS_FILE_BYTES + 1),
            )


class RunningPartsTest(unittest.TestCase):
    """The three named tiers of the running-totals partition."""

    def parts(self, **advances):
        counters = capture_usage_series.new_counters()
        full = {field: 0 for field in capture_usage_series.RUNNING_FIELDS}
        full.update(advances)
        return (
            capture_usage_series.running_parts(
                full, full[capture_usage_series.RUNNING_TOTAL_FIELD], counters
            ),
            counters,
        )

    def test_the_full_partition_subtracts_the_subsets_from_their_parents(self):
        parts, counters = self.parts(
            input_tokens=100,
            cached_input_tokens=60,
            cache_write_input_tokens=10,
            output_tokens=40,
            reasoning_output_tokens=25,
            total_tokens=140,
        )
        self.assertEqual(
            parts,
            {
                "input": 30,
                "output": 15,
                "cache-read": 60,
                "cache-write": 10,
                "reasoning": 25,
            },
        )
        self.assertEqual(sum(parts.values()), 140)
        self.assertEqual(counters["unpartitioned"], 0)

    def test_a_fully_cached_input_leaves_no_uncached_class_at_all(self):
        # The boundary of tier 1 rather than a fall through it: every input
        # token was a cache read, so the uncached class is exactly zero and is
        # dropped rather than carried as a row of zeros.
        parts, counters = self.parts(
            input_tokens=100, cached_input_tokens=100, output_tokens=40, total_tokens=140
        )
        self.assertEqual(parts, {"output": 40, "cache-read": 100})
        self.assertEqual(sum(parts.values()), 140)
        self.assertEqual(counters["unpartitioned"], 0)

    def test_a_subset_larger_than_its_parent_falls_back_to_the_coarse_split(self):
        # The tier-2 case: the cache classes claim more than the input side
        # holds, so a five-way split would be NEGATIVE. The two-way split is
        # coarser and still exactly true, so it is what gets emitted rather
        # than nothing.
        parts, counters = self.parts(
            input_tokens=100,
            cached_input_tokens=140,
            output_tokens=40,
            total_tokens=140,
        )
        self.assertEqual(parts, {"input": 100, "output": 40})
        self.assertEqual(sum(parts.values()), 140)
        self.assertEqual(counters["unpartitioned"], 0)

    def test_a_total_its_own_fields_disagree_with_partitions_not_at_all(self):
        parts, counters = self.parts(input_tokens=1, output_tokens=1, total_tokens=99)
        self.assertIsNone(parts)
        self.assertEqual(counters["unpartitioned"], 1)

    def test_every_tier_emits_only_closed_vocabulary_members(self):
        for kwargs in (
            dict(input_tokens=10, cached_input_tokens=4, output_tokens=5, total_tokens=15),
            dict(input_tokens=10, cached_input_tokens=10, output_tokens=5, total_tokens=15),
        ):
            parts, _counters = self.parts(**kwargs)
            self.assertLessEqual(set(parts), set(capture_usage_series.CATEGORY_KEYS))


class NoPlaceholderRowsTest(unittest.TestCase):
    """A row of zeroes is not a measurement of nothing; it is nothing.

    Two places a row can become hollow, and the rules differ by partition.
    `day_indexed` drops a member that measured nothing across the whole
    SERIES, on both partitions, and always has. `carrying` drops one that
    measured nothing across the trailing WINDOW the section claims — a state
    the first cannot see (issue #302) — and it applies to the MODEL partition
    alone: an accounting class at zero inside the window is the reading "no
    reasoning tokens this week", which CategoryWindowKeepsAnEmptyClassTest
    pins from the other direction. Downstream, the origin refuses a model row
    of zeroes outright, so a producer that stopped doing this would push
    documents the panel rejects rather than documents with a decorative row.
    """

    def test_a_member_that_measured_nothing_never_reaches_a_section(self):
        window = ["2026-08-10", "2026-08-11"]
        for vocabulary, present, absent in (
            (capture_usage_series.CATEGORY_KEYS, "input", "reasoning"),
            (capture_usage_series.MODEL_KEYS, capture_usage_series.MODEL_KEYS[1], capture_usage_series.MODEL_OTHER),
        ):
            with self.subTest(present=present):
                by_day = {day: {present: 5, absent: 0} for day in window}
                self.assertEqual(
                    capture_usage_series.day_indexed(by_day, window, vocabulary),
                    {present: [5, 5]},
                )

    def test_a_row_that_is_zero_across_its_own_window_is_dropped(self):
        # The case day_indexed cannot see: a member measured on the first day
        # of the series and never again, under a section whose window starts
        # after it. Before the window is applied the row carries something;
        # after it, the row is a named entity drawn at nought percent.
        rows = {"early": [5, 0, 0], "late": [0, 3, 4]}
        windowed = capture_usage_series.window_section(rows, 1)
        self.assertEqual(windowed, {"early": [0, 0], "late": [3, 4]})
        self.assertEqual(capture_usage_series.carrying(windowed), {"late": [3, 4]})

    def test_dropping_a_row_of_zeroes_changes_no_day_total(self):
        # The claim carrying makes, checked rather than asserted in prose: an
        # all-zero row contributes nothing to any day, so the partition the
        # caller then proves is exactly the partition it was.
        totals = [3, 4]
        rows = {"early": [0, 0], "late": [3, 4]}
        capture_usage_series.assert_partition(totals, rows, 0)
        capture_usage_series.assert_partition(totals, capture_usage_series.carrying(rows), 0)

    def test_a_walk_that_names_its_model_emits_a_section_with_no_hollow_row(self):
        member = capture_usage_series.MODEL_KEYS[6]
        document = json.loads(
            (pathlib.Path(__file__).resolve().parents[2] / "internal/panels/config/models.json")
            .read_text(encoding="utf-8")
        )
        identifier = next(
            entry["ids"][0]
            for group in document["groups"]
            for entry in group["members"]
            if entry["key"] == member
        )
        with tempfile.TemporaryDirectory() as root:
            nested = os.path.join(root, "2026", "08", "23")
            os.makedirs(nested)
            with open(os.path.join(nested, "session.jsonl"), "w", encoding="utf-8") as handle:
                handle.write(turn_model_line(identifier) + "\n")
                handle.write(running_line(60, stamp="2026-08-23T20:00:00.000Z") + "\n")
                handle.write(running_line(200, stamp="2026-08-24T04:00:00.000Z") + "\n")
            section, counters = capture_usage_series.capture(
                root, capture_usage_series.FORMAT_RUNNING_TOTALS
            )
        # Every token this walk read was declared, so the residual measured
        # nothing and is absent rather than present at zero.
        self.assertEqual(section["models"], {member: [60, 140]})
        self.assertNotIn(capture_usage_series.MODEL_OTHER, section["models"])
        self.assertEqual(counters["unattributed"], 0)
        for key, values in section["models"].items():
            self.assertGreater(sum(values), 0, key)


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

            section, counters = capture_usage_series.capture(
                root, capture_usage_series.FORMAT_RUNNING_TOTALS
            )
        series = section["series"]
        derived = section["derived"]

        self.assertEqual(
            series, {"startDate": "2026-08-23", "totals": [60, 0, 140], "recorded": True}
        )
        self.assertEqual(
            derived,
            {"peak-day": 140, "current-streak": 1, "longest-streak": 1, "active-days": 2, "tracked-days": 3},
        )
        # This shape journals no model at all, so the models section is
        # ABSENT rather than a single residual row that repeats the aggregate.
        self.assertNotIn("models", section)
        self.assertNotIn("modelsStartDate", section)
        # The fixture's cache fields equal its whole, which no five-way
        # partition can express, so the coarse two-way tier carries it — and
        # it still partitions exactly.
        self.assertEqual(section["categories"], {"input": [60, 0, 140]})
        self.assertEqual(counters["unpartitioned"], 0)
        self.assertEqual(counters["files"], 1)
        self.assertEqual(counters["duplicates"], 1)
        self.assertEqual(counters["counted"], 2)

        # The whole emission, re-read as text: not one identifier, path,
        # branch name, session id or sentence from the journal may appear.
        emitted = json.dumps({"section": section, "counters": counters})
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


class ActivityCacheTest(unittest.TestCase):
    """Depth that survives retention pruning, and stays honest about itself.

    The journals are pruned on the tool's own schedule, so a walk measures
    only as far back as the tree still goes and the panel's history was
    getting shorter on its own. The tool's roll-up survives that pruning, so
    it supplies the days the walk has lost — and nothing else, because it is
    a weaker measurement than the walk and disagrees with it where both cover
    the same day.
    """

    MEMBER = capture_usage_series.MODEL_KEYS[2]

    def cache(self, rows):
        return json.dumps(
            {
                "version": 5,
                capture_usage_series.ACTIVITY_CACHE_DAILY_KEY: [
                    {
                        capture_usage_series.ACTIVITY_CACHE_DATE_KEY: day,
                        capture_usage_series.ACTIVITY_CACHE_MODELS_KEY: amounts,
                    }
                    for day, amounts in rows
                ],
                # The lifetime accounting a configured cache must carry
                # (issue #276); LifetimeStatsTest owns its own arithmetic and
                # refusal rows, so this fixture only has to be admissible.
                capture_usage_series.ACTIVITY_CACHE_USAGE_KEY: {
                    "avendor-%s" % self.MEMBER: {
                        "inputTokens": 6,
                        "outputTokens": 7,
                        "cacheReadInputTokens": 8,
                        "cacheCreationInputTokens": 9,
                    }
                },
                capture_usage_series.ACTIVITY_CACHE_SESSIONS_KEY: 3,
                # As of the walked fixture day itself, so nothing accrues
                # past the cache here; CacheAccrualTest owns the accrual.
                capture_usage_series.ACTIVITY_CACHE_COMPUTED_KEY: "2026-08-10",
            }
        )

    def capture_with(self, cache_rows, lines=None):
        with tempfile.TemporaryDirectory() as root:
            path = pathlib.Path(root) / "session.jsonl"
            path.write_text(
                "\n".join(lines if lines is not None else [transcript_line()]) + "\n",
                encoding="utf-8",
            )
            cache_path = pathlib.Path(root) / "cache.json"
            cache_path.write_text(self.cache(cache_rows), encoding="utf-8")
            return capture_usage_series.capture(
                root,
                capture_usage_series.FORMAT_MESSAGES,
                cache_path,
                datetime.date(2026, 8, 10),
            )

    def test_the_cache_supplies_only_the_days_the_walk_has_lost(self):
        section, _counters = self.capture_with(
            [
                ("2026-07-30", {"avendor-%s" % self.MEMBER: 4_000}),
                # The same day the walk covers, at a DIFFERENT figure. The
                # walk's 135 wins; 9_999 must appear nowhere.
                ("2026-08-10", {"avendor-%s" % self.MEMBER: 9_999}),
            ]
        )
        series = section["series"]
        self.assertEqual(series["startDate"], "2026-07-30")
        self.assertEqual(len(series["totals"]), 12)
        self.assertEqual(series["totals"][0], 4_000)
        self.assertEqual(series["totals"][-1], 135)
        self.assertNotIn(9_999, series["totals"])

    def test_the_categories_window_starts_where_the_split_is_measurable(self):
        section, _counters = self.capture_with(
            [("2026-07-30", {"avendor-%s" % self.MEMBER: 4_000})]
        )
        # The roll-up carries no accounting split, so the categories cover the
        # trailing walked run and DECLARE where they start — they never claim
        # a day whose division nobody measured.
        self.assertEqual(section["categoriesStartDate"], "2026-08-10")
        self.assertEqual(
            section["categories"],
            {"input": [10], "output": [5], "cache-read": [100], "cache-write": [20]},
        )
        capture_usage_series.assert_partition(
            section["series"]["totals"], section["categories"], 11
        )

    def test_the_models_section_partitions_every_day_of_the_union(self):
        record = json.loads(transcript_line())
        record["message"]["model"] = "avendor-%s" % capture_usage_series.MODEL_KEYS[1]
        section, _counters = self.capture_with(
            [("2026-07-30", {"avendor-%s" % self.MEMBER: 4_000})],
            lines=[json.dumps(record)],
        )
        totals = section["series"]["totals"]
        capture_usage_series.assert_partition(totals, section["models"], 0)
        self.assertEqual(section["models"][self.MEMBER][0], 4_000)
        self.assertEqual(section["models"][capture_usage_series.MODEL_KEYS[1]][-1], 135)
        # Serve order is the vocabulary's, so two runs emit identical bytes.
        self.assertEqual(
            list(section["models"]),
            [key for key in capture_usage_series.MODEL_KEYS if key in section["models"]],
        )

    def test_a_model_outside_the_vocabulary_folds_into_the_residual(self):
        # The walked day names a real member, so the residual is a genuine
        # second row rather than the whole section (which would be omitted).
        record = json.loads(transcript_line())
        record["message"]["model"] = "avendor-%s" % capture_usage_series.MODEL_KEYS[1]
        section, counters = self.capture_with(
            [("2026-07-30", {"avendor-not-a-member": 4_000})],
            lines=[json.dumps(record)],
        )
        self.assertEqual(section["models"][capture_usage_series.MODEL_OTHER][0], 4_000)
        self.assertGreaterEqual(counters["unattributed"], 1)
        # The unreviewed name itself reaches nothing.
        self.assertNotIn("not-a-member", json.dumps(section))

    def test_a_malformed_cache_refuses_rather_than_guessing(self):
        for document in ("[]", "{}", json.dumps({"dailyModelTokens": {}})):
            with self.subTest(document=document[:20]):
                with tempfile.TemporaryDirectory() as root:
                    (pathlib.Path(root) / "session.jsonl").write_text(
                        transcript_line() + "\n", encoding="utf-8"
                    )
                    cache_path = pathlib.Path(root) / "cache.json"
                    cache_path.write_text(document, encoding="utf-8")
                    with self.assertRaises(CaptureError):
                        capture_usage_series.capture(
                            root, capture_usage_series.FORMAT_MESSAGES, cache_path
                        )

    def test_a_cache_row_that_is_not_a_day_is_skipped_not_believed(self):
        section, _counters = self.capture_with(
            [
                ("2026-99-99", {"avendor-%s" % self.MEMBER: 1}),
                ("2026-08-09", {"avendor-%s" % self.MEMBER: 2}),
            ]
        )
        self.assertEqual(section["series"]["startDate"], "2026-08-09")
        self.assertEqual(section["series"]["totals"], [2, 135])

    def test_a_configured_cache_supplies_the_captured_stats_section(self):
        # Issue #276: the same cache document also carries the tool's own
        # lifetime accounting, and a capture that reads the cache emits it as
        # the closed captured-stats section — the figures the frozen
        # lifetime-class tiles stopped tracking.
        section, _counters = self.capture_with(
            [("2026-07-30", {"avendor-%s" % self.MEMBER: 4_000})]
        )
        self.assertEqual(
            section["stats"],
            {
                "input": 6,
                "output": 7,
                "cache-read": 8,
                "cache-write": 9,
                "lifetime": 30,
                "sessions": 3,
                # Measured from the WALK's own session spans, because this
                # cache carries no longestSession record (issue #267). The
                # fixture's one file holds a single record, so its span — and
                # therefore the longest — is zero seconds.
                "longest-session": 0,
            },
        )


class LifetimeStatsTest(unittest.TestCase):
    """The cache's lifetime accounting, summed and fail-closed (issue #276).

    Every refusal here refuses the whole run rather than dropping a figure,
    because the origin refuses a document that leaves a lifetime-class tile
    unrefreshed: a cache that stops carrying this accounting must stop the
    push loudly at the producer, not feed the origin a document it rejects on
    every thirty-second tick.
    """

    def document(self, **overrides):
        base = {
            capture_usage_series.ACTIVITY_CACHE_USAGE_KEY: {
                "avendor-alpha": {
                    "inputTokens": 1,
                    "outputTokens": 2,
                    "cacheReadInputTokens": 3,
                    "cacheCreationInputTokens": 4,
                },
                "avendor-beta": {
                    "inputTokens": 10,
                    "outputTokens": 20,
                    "cacheReadInputTokens": 30,
                    "cacheCreationInputTokens": 40,
                },
            },
            capture_usage_series.ACTIVITY_CACHE_SESSIONS_KEY: 7,
        }
        base.update(overrides)
        return base

    def test_sums_the_four_classes_and_their_whole(self):
        self.assertEqual(
            capture_usage_series.lifetime_stats(self.document()),
            {
                "input": 11,
                "output": 22,
                "cache-read": 33,
                "cache-write": 44,
                "lifetime": 110,
                "sessions": 7,
            },
        )

    def test_every_malformed_corner_refuses_the_run(self):
        member = {
            "inputTokens": 1,
            "outputTokens": 2,
            "cacheReadInputTokens": 3,
            "cacheCreationInputTokens": 4,
        }
        for name, document in {
            "no usage accounting at all": self.document(
                **{capture_usage_series.ACTIVITY_CACHE_USAGE_KEY: None}
            ),
            "empty usage accounting": self.document(
                **{capture_usage_series.ACTIVITY_CACHE_USAGE_KEY: {}}
            ),
            "an entry that is not an object": self.document(
                **{capture_usage_series.ACTIVITY_CACHE_USAGE_KEY: {"m": 5}}
            ),
            "a missing class field": self.document(
                **{
                    capture_usage_series.ACTIVITY_CACHE_USAGE_KEY: {
                        "m": {k: v for k, v in member.items() if k != "outputTokens"}
                    }
                }
            ),
            "a negative count": self.document(
                **{
                    capture_usage_series.ACTIVITY_CACHE_USAGE_KEY: {
                        "m": dict(member, inputTokens=-1)
                    }
                }
            ),
            "a boolean count": self.document(
                **{
                    capture_usage_series.ACTIVITY_CACHE_USAGE_KEY: {
                        "m": dict(member, inputTokens=True)
                    }
                }
            ),
            "a fractional count": self.document(
                **{
                    capture_usage_series.ACTIVITY_CACHE_USAGE_KEY: {
                        "m": dict(member, inputTokens=1.5)
                    }
                }
            ),
            "no session tally": self.document(
                **{capture_usage_series.ACTIVITY_CACHE_SESSIONS_KEY: None}
            ),
            "a boolean session tally": self.document(
                **{capture_usage_series.ACTIVITY_CACHE_SESSIONS_KEY: True}
            ),
            "a sum past the shared count bound": self.document(
                **{
                    capture_usage_series.ACTIVITY_CACHE_USAGE_KEY: {
                        "m": dict(member, inputTokens=capture_usage_series.MAX_COUNT),
                        "n": dict(member, inputTokens=1),
                    }
                }
            ),
        }.items():
            with self.subTest(name=name):
                with self.assertRaises(CaptureError):
                    capture_usage_series.lifetime_stats(document)


class HistoryStoreTest(unittest.TestCase):
    """Evidence, once captured, survives its sources (issue #234).

    Every source the pipeline reads is volatile: transcript trees are
    retention-pruned, and the roll-up cache has been measured discarding a
    month of days in one recompute. Re-deriving the series from those sources
    on every run therefore serves a history that silently gets SHORTER — days
    that were captured, sealed and served become zeros the moment their last
    local evidence is deleted, which is the defect the owner reported on
    2026-08-28. The store is the pipeline's own durable memory, and this
    suite pins the rule that makes it honest: it preserves measurements only,
    never inventing a day and never resurrecting a partial breakdown as a
    whole one.
    """

    def setUp(self):
        self.scratch = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.scratch, ignore_errors=True)
        self.tree = self.scratch / "tree"
        self.tree.mkdir()
        self.store = self.scratch / "store.json"

    def day_line(self, day, ident, tokens):
        return transcript_line(
            timestamp=day + "T12:00:00Z",
            requestId="req_%s" % ident,
            message={
                "id": "msg_%s" % ident,
                "model": "avendor-%s" % capture_usage_series.MODEL_KEYS[1],
                "usage": {"input_tokens": tokens, "output_tokens": tokens},
            },
        )

    def write_tree(self, *lines):
        (self.tree / "session.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")

    def run_capture(self):
        return capture_usage_series.capture(
            self.tree,
            capture_usage_series.FORMAT_MESSAGES,
            today=datetime.date(2026, 8, 12),
            history_store=self.store,
        )

    def stored_days(self):
        document = json.loads(self.store.read_text(encoding="utf-8"))
        self.assertEqual(document["schema"], capture_usage_series.HISTORY_SCHEMA)
        return document["days"]

    def write_store(self, days):
        self.store.write_text(
            json.dumps(
                {
                    capture_usage_series.HISTORY_SCHEMA_KEY: capture_usage_series.HISTORY_SCHEMA,
                    capture_usage_series.HISTORY_DAYS_KEY: days,
                }
            ),
            encoding="utf-8",
        )

    def test_a_retired_model_key_in_the_store_folds_into_the_residual(self):
        # The store was written under a vocabulary that still named the key
        # (issue #322): the day survives, its tokens land on the residual, the
        # day still sums, and the store is written back without the key.
        retired = next(iter(capture_usage_series.RETIRED_MODEL_KEYS))
        named = capture_usage_series.MODEL_KEYS[1]
        other = capture_usage_series.MODEL_OTHER
        self.write_store(
            {
                "2026-08-10": {"total": 30, "models": {retired: 10, named: 20}},
                "2026-08-11": {"total": 30, "models": {other: 5, retired: 10, named: 15}},
            }
        )
        self.write_tree(self.day_line("2026-08-12", "c", 30))
        section, _ = self.run_capture()
        self.assertEqual(section["series"]["totals"], [30, 30, 60])
        self.assertEqual(section["models"][other][:2], [10, 15])
        self.assertEqual(section["models"][named][:2], [20, 15])
        self.assertNotIn(retired, section["models"])
        stored = self.stored_days()
        self.assertEqual(stored["2026-08-10"]["models"], {other: 10, named: 20})
        self.assertEqual(stored["2026-08-11"]["models"], {other: 15, named: 15})
        self.assertNotIn(retired, json.dumps(stored))

    def test_an_unknown_model_key_in_the_store_still_refuses(self):
        # The fold is for keys the vocabulary retired, never for whatever a
        # corrupted store happens to carry.
        self.write_store({"2026-08-10": {"total": 30, "models": {"never-a-key": 30}}})
        self.write_tree(self.day_line("2026-08-12", "c", 30))
        with self.assertRaisesRegex(
            capture_usage_series.CaptureError, "breakdown key outside its vocabulary"
        ):
            self.run_capture()

    def test_a_retired_key_never_folds_a_category_breakdown(self):
        # The retirement table names MODEL keys; a category breakdown carrying
        # one of those names is corruption of a different section.
        retired = next(iter(capture_usage_series.RETIRED_MODEL_KEYS))
        self.write_store({"2026-08-10": {"total": 30, "categories": {retired: 30}}})
        self.write_tree(self.day_line("2026-08-12", "c", 30))
        with self.assertRaisesRegex(
            capture_usage_series.CaptureError, "breakdown key outside its vocabulary"
        ):
            self.run_capture()

    def test_a_pruned_day_survives_from_the_store_with_its_breakdowns(self):
        # Run 1 measures two days; run 2's tree has lost the older one, which
        # is exactly what retention pruning does. The day, its category
        # partition, and its model attribution must all survive.
        self.write_tree(self.day_line("2026-08-10", "a", 10), self.day_line("2026-08-11", "b", 20))
        first, _ = self.run_capture()
        self.assertEqual(first["series"]["totals"], [20, 40])
        self.write_tree(self.day_line("2026-08-11", "b", 20), self.day_line("2026-08-12", "c", 30))
        section, _ = self.run_capture()
        self.assertEqual(section["series"]["startDate"], "2026-08-10")
        self.assertEqual(section["series"]["totals"], [20, 40, 60])
        self.assertNotIn("categoriesStartDate", section)
        self.assertEqual(section["categories"]["input"], [10, 20, 30])
        self.assertEqual(
            section["models"][capture_usage_series.MODEL_KEYS[1]], [20, 40, 60]
        )
        self.assertEqual(section["derived"][capture_usage_series.STAT_LONGEST_STREAK], 3)

    def test_the_fresh_capture_wins_while_it_measures_at_least_the_stored_figure(self):
        # The in-progress day only grows, and the walk is the de-duplicated
        # current measurement — so a stored figure never overrides a fresh
        # one that is at least as large.
        self.write_tree(self.day_line("2026-08-11", "a", 10))
        self.run_capture()
        self.write_tree(
            self.day_line("2026-08-11", "a", 10), self.day_line("2026-08-11", "b", 25)
        )
        section, _ = self.run_capture()
        self.assertEqual(section["series"]["totals"], [70])
        self.assertEqual(self.stored_days()["2026-08-11"]["total"], 70)

    def test_a_shrunken_day_keeps_the_stored_figure(self):
        # A genuinely measured day only shrinks when its records are deleted
        # underneath it — partial pruning inside one day — and pruning is
        # what the store exists to survive.
        self.write_tree(
            self.day_line("2026-08-11", "a", 10), self.day_line("2026-08-11", "b", 25)
        )
        self.run_capture()
        self.write_tree(self.day_line("2026-08-11", "a", 10))
        section, _ = self.run_capture()
        self.assertEqual(section["series"]["totals"], [70])
        self.assertEqual(self.stored_days()["2026-08-11"]["total"], 70)

    def test_no_day_is_invented_and_gaps_are_never_written_back(self):
        # Two real days with a gap between them: the gap renders as the
        # zero-inside-the-window the series contract already defines, and the
        # store never grows an entry for it — absence of evidence is stored
        # as absence.
        self.write_tree(self.day_line("2026-08-09", "a", 10), self.day_line("2026-08-12", "b", 20))
        section, _ = self.run_capture()
        self.assertEqual(section["series"]["totals"], [20, 0, 0, 40])
        self.assertEqual(sorted(self.stored_days()), ["2026-08-09", "2026-08-12"])

    def test_a_stored_day_without_a_partition_never_resurfaces_claiming_one(self):
        # A store entry can carry a total with no category split (the walk
        # could not partition that day before it was pruned). When it
        # overrides a day, the categories window must retreat behind it
        # rather than serve a partition nobody measured.
        self.write_tree(self.day_line("2026-08-11", "a", 10), self.day_line("2026-08-12", "b", 20))
        self.run_capture()
        document = json.loads(self.store.read_text(encoding="utf-8"))
        document["days"]["2026-08-11"] = {"total": 999}
        self.store.write_text(json.dumps(document), encoding="utf-8")
        self.write_tree(self.day_line("2026-08-11", "a", 10), self.day_line("2026-08-12", "b", 20))
        section, _ = self.run_capture()
        self.assertEqual(section["series"]["totals"], [999, 40])
        self.assertEqual(section["categoriesStartDate"], "2026-08-12")
        self.assertEqual(section["categories"]["input"], [20])
        # The model window retreats the same way: the overriding entry kept
        # no attribution, so the section declares it starts after that day.
        self.assertEqual(section["modelsStartDate"], "2026-08-12")
        self.assertEqual(section["models"][capture_usage_series.MODEL_KEYS[1]], [40])

    def test_a_tie_keeps_the_fresh_entry_and_its_richer_breakdowns(self):
        # Equal totals are NOT interchangeable entries: an old store row can
        # carry a bare total where the fresh walk measures the same figure
        # WITH its partition and attribution. Preferring the store on a tie
        # would discard measured breakdowns for remembered ignorance.
        self.write_tree(self.day_line("2026-08-11", "a", 10), self.day_line("2026-08-12", "b", 20))
        self.run_capture()
        document = json.loads(self.store.read_text(encoding="utf-8"))
        document["days"]["2026-08-11"] = {"total": 20}
        self.store.write_text(json.dumps(document), encoding="utf-8")
        section, _ = self.run_capture()
        self.assertEqual(section["series"]["totals"], [20, 40])
        self.assertNotIn("categoriesStartDate", section)
        self.assertEqual(section["categories"]["input"], [10, 20])
        self.assertEqual(self.stored_days()["2026-08-11"]["categories"]["input"], 10)

    def test_the_first_run_bootstraps_a_missing_store_file(self):
        self.write_tree(self.day_line("2026-08-11", "a", 10))
        self.assertFalse(self.store.exists())
        self.run_capture()
        self.assertEqual(sorted(self.stored_days()), ["2026-08-11"])
        # And the write left no temporary residue beside the store. This is
        # the WEAK half of the atomicity claim and is kept only for what it
        # says about cleanup — the mechanism itself is pinned below, because
        # a direct write satisfies "no residue" trivially by never creating a
        # temporary at all.
        self.assertEqual(
            [entry.name for entry in self.scratch.iterdir() if entry.name.startswith("store")],
            ["store.json"],
        )

    def test_the_store_is_only_ever_replaced_by_rename_from_a_sibling(self):
        """The atomicity MECHANISM, not its residue (issue 237).

        The adversarial review of #235 built a kill matrix in which a
        non-atomic direct-write mutant of `write_history_store` survived the
        whole battery: every other assertion here reads the store's CONTENT
        afterwards, and a direct write produces byte-identical content. The
        residue assertion above is satisfied by it too, since a writer that
        never makes a temporary leaves none behind.

        What a direct write actually costs is availability: a run killed
        between truncate and flush leaves a torn document, the next run's
        fail-closed validation refuses it, and the remembered history the
        store exists to preserve is gone until an operator intervenes.
        Integrity holds; the memory does not.

        So this observes the two syscalls that carry the guarantee. The store
        path must never be opened for writing at all, and the bytes must
        arrive by a rename FROM A SIBLING — same directory, because rename is
        only atomic within one filesystem, and a temporary in /tmp beside a
        store on another mount is a copy wearing a rename's name.
        """
        writes = []
        renames = []
        real_open = open
        real_replace = pathlib.Path.replace

        def recording_open(file, mode="r", *args, **kwargs):
            if any(flag in mode for flag in ("w", "a", "x", "+")):
                writes.append(pathlib.Path(file).resolve())
            return real_open(file, mode, *args, **kwargs)

        def recording_replace(source, target):
            renames.append((pathlib.Path(source).resolve(), pathlib.Path(target).resolve()))
            return real_replace(source, target)

        store = self.store.resolve()
        self.write_tree(self.day_line("2026-08-11", "a", 10))
        # `open` is patched as a module global, which shadows the builtin for
        # the module under test and for nothing else in this process.
        capture_usage_series.open = recording_open
        pathlib.Path.replace = recording_replace
        try:
            self.run_capture()
        finally:
            del capture_usage_series.open
            pathlib.Path.replace = real_replace

        self.assertEqual(sorted(self.stored_days()), ["2026-08-11"])
        self.assertNotIn(
            store,
            writes,
            "the store was opened for writing directly; a run killed mid-write would tear it",
        )
        into_store = [pair for pair in renames if pair[1] == store]
        self.assertEqual(
            len(into_store),
            1,
            "the store was not put in place by exactly one rename: %r" % (renames,),
        )
        temporary, _ = into_store[0]
        self.assertEqual(
            temporary.parent,
            store.parent,
            "the store was renamed from %s, which is not its own directory; rename is only atomic within one filesystem"
            % temporary.parent,
        )
        self.assertIn(
            temporary,
            writes,
            "the renamed-in file was never written through this process; the store's bytes came from somewhere unobserved",
        )

    def test_two_identical_merges_write_identical_bytes(self):
        self.write_tree(self.day_line("2026-08-11", "a", 10))
        self.run_capture()
        first = self.store.read_bytes()
        second_section, _ = self.run_capture()
        self.assertEqual(self.store.read_bytes(), first)
        # The ledger block is machine-local material the export strips, so the
        # emission guard refuses it by name; what this asserts is that the
        # REST of the section is clean (issue #267).
        wire = {
            key: value
            for key, value in second_section.items()
            if key != capture_usage_series.LEDGER_KEY
        }
        capture_usage_series.assert_only_dates_and_integers(wire, "section")
        capture_usage_series.assert_ledger_block(
            second_section[capture_usage_series.LEDGER_KEY]
        )

    def test_a_malformed_store_refuses_rather_than_forgetting(self):
        # Ignoring a corrupt store would silently shorten the published
        # history with nothing anywhere saying so — the exact defect the
        # store exists to end. Every malformation refuses the run.
        self.write_tree(self.day_line("2026-08-11", "a", 10))
        schema = capture_usage_series.HISTORY_SCHEMA
        for document in (
            "not json",
            json.dumps([]),
            json.dumps({"days": {}}),
            json.dumps({"schema": "usage-history/v2", "days": {}}),
            json.dumps({"schema": schema, "days": {}, "extra": 1}),
            json.dumps({"schema": schema, "days": []}),
            json.dumps({"schema": schema, "days": {"not-a-day": {"total": 1}}}),
            json.dumps({"schema": schema, "days": {"2026-99-99": {"total": 1}}}),
            json.dumps({"schema": schema, "days": {"2026-08-01": {}}}),
            json.dumps({"schema": schema, "days": {"2026-08-01": {"total": 0}}}),
            json.dumps({"schema": schema, "days": {"2026-08-01": {"total": -5}}}),
            json.dumps({"schema": schema, "days": {"2026-08-01": {"total": True}}}),
            json.dumps({"schema": schema, "days": {"2026-08-01": {"total": 2**53}}}),
            json.dumps({"schema": schema, "days": {"2026-08-01": {"total": 1, "extra": 1}}}),
            json.dumps(
                {"schema": schema, "days": {"2026-08-01": {"total": 5, "categories": {"input": 3}}}}
            ),
            json.dumps(
                {
                    "schema": schema,
                    "days": {"2026-08-01": {"total": 5, "categories": {"private-key": 5}}},
                }
            ),
            json.dumps(
                {"schema": schema, "days": {"2026-08-01": {"total": 5, "models": {"gpt": 5}}}}
            ),
        ):
            with self.subTest(document=document[:60]):
                self.store.write_text(document, encoding="utf-8")
                with self.assertRaises(CaptureError):
                    self.run_capture()

    def test_an_oversized_store_refuses(self):
        self.write_tree(self.day_line("2026-08-11", "a", 10))
        self.store.write_text(
            "[" + " " * capture_usage_series.MAX_HISTORY_STORE_BYTES + "]", encoding="utf-8"
        )
        with self.assertRaises(CaptureError) as refusal:
            self.run_capture()
        self.assertIn("byte bound", str(refusal.exception))

    def test_a_store_reaching_past_the_series_day_bound_refuses(self):
        self.write_tree(self.day_line("2026-08-11", "a", 10))
        self.store.write_text(
            json.dumps(
                {
                    "schema": capture_usage_series.HISTORY_SCHEMA,
                    "days": {"2020-01-01": {"total": 1}},
                }
            ),
            encoding="utf-8",
        )
        with self.assertRaises(CaptureError) as refusal:
            self.run_capture()
        self.assertIn("day bound", str(refusal.exception))

    def test_the_running_totals_shape_remembers_the_same_way(self):
        # The store is shape-agnostic: the second tool's journal is pruned on
        # its own schedule too, and its pruned days must survive identically.
        (self.tree / "one.jsonl").write_text(
            running_line(100, stamp="2026-08-10T12:00:00Z") + "\n", encoding="utf-8"
        )
        section, _ = capture_usage_series.capture(
            self.tree,
            capture_usage_series.FORMAT_RUNNING_TOTALS,
            today=datetime.date(2026, 8, 12),
            history_store=self.store,
        )
        self.assertEqual(section["series"]["totals"], [100])
        (self.tree / "one.jsonl").unlink()
        (self.tree / "two.jsonl").write_text(
            running_line(40, stamp="2026-08-12T12:00:00Z") + "\n", encoding="utf-8"
        )
        section, _ = capture_usage_series.capture(
            self.tree,
            capture_usage_series.FORMAT_RUNNING_TOTALS,
            today=datetime.date(2026, 8, 12),
            history_store=self.store,
        )
        self.assertEqual(section["series"]["startDate"], "2026-08-10")
        self.assertEqual(section["series"]["totals"], [100, 0, 40])


class VerifiedReadingsTest(unittest.TestCase):
    """A verified reading is the day's figure in both directions (issue #299).

    The store's evidence-survives rule can only ever RAISE a day, so a walk
    that over-counted a day could never be corrected from the one surface
    that is the reference — the vendor's own dashboard. A readings file
    beside the store names a day and its figure; the capture serves that
    figure, drops a split that no longer partitions it, writes it back, and
    refuses the readings that cannot be honest: a day outside the record, a
    day still in progress, a malformed file.
    """

    def setUp(self):
        self.scratch = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.scratch, ignore_errors=True)
        self.tree = self.scratch / "tree"
        self.tree.mkdir()
        self.store = self.scratch / "store.json"
        self.readings = self.scratch / "store.verified.json"

    def day_line(self, day, ident, tokens):
        return transcript_line(
            timestamp=day + "T12:00:00Z",
            requestId="req_%s" % ident,
            message={
                "id": "msg_%s" % ident,
                "model": "avendor-%s" % capture_usage_series.MODEL_KEYS[1],
                "usage": {"input_tokens": tokens, "output_tokens": tokens},
            },
        )

    def write_tree(self, *lines):
        if not lines:
            lines = (
                self.day_line("2026-08-10", "a", 10),
                self.day_line("2026-08-11", "b", 20),
                self.day_line("2026-08-12", "c", 30),
            )
        (self.tree / "session.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")

    def write_readings(self, days, read_on="2026-08-12"):
        self.readings.write_text(
            json.dumps(
                {
                    capture_usage_series.HISTORY_SCHEMA_KEY: capture_usage_series.VERIFIED_SCHEMA,
                    capture_usage_series.VERIFIED_READINGS_KEY: {
                        day: {
                            capture_usage_series.HISTORY_TOTAL_KEY: total,
                            capture_usage_series.VERIFIED_READ_ON_KEY: read_on,
                        }
                        for day, total in days.items()
                    },
                }
            ),
            encoding="utf-8",
        )

    def run_capture(self, history=True, verified=True):
        return capture_usage_series.capture(
            self.tree,
            capture_usage_series.FORMAT_MESSAGES,
            today=datetime.date(2026, 8, 12),
            history_store=self.store if history else None,
            verified_readings=self.readings if verified else None,
        )

    def stored_days(self):
        return json.loads(self.store.read_text(encoding="utf-8"))["days"]

    def test_a_reading_lowers_a_day_the_walk_over_counted_and_drops_its_split(self):
        # The direction the store's own rule cannot take. The walk says 40,
        # the surface says 30: 30 is served AND written back, and the day's
        # split goes with it — a split summing to a figure nobody serves
        # would be a fabrication — so the windowed breakdowns begin after it.
        self.write_tree()
        self.write_readings({"2026-08-11": 30})
        section, _ = self.run_capture()
        self.assertEqual(section["series"]["totals"], [20, 30, 60])
        self.assertEqual(section["categoriesStartDate"], "2026-08-12")
        self.assertEqual(section["categories"]["input"], [30])
        self.assertEqual(section["modelsStartDate"], "2026-08-12")
        self.assertEqual(self.stored_days()["2026-08-11"], {"total": 30})

    def test_a_reading_raises_a_day_and_survives_the_next_walk(self):
        self.write_tree()
        self.write_readings({"2026-08-11": 90})
        for _ in range(2):
            section, _ = self.run_capture()
            self.assertEqual(section["series"]["totals"], [20, 90, 60])
        self.assertEqual(self.stored_days()["2026-08-11"]["total"], 90)

    def test_a_reading_that_matches_the_walk_keeps_the_split(self):
        self.write_tree()
        self.write_readings({"2026-08-11": 40})
        section, _ = self.run_capture()
        self.assertEqual(section["series"]["totals"], [20, 40, 60])
        self.assertNotIn("categoriesStartDate", section)
        self.assertEqual(
            self.stored_days()["2026-08-11"],
            {
                "total": 40,
                "categories": {"input": 20, "output": 20},
                "models": {capture_usage_series.MODEL_KEYS[1]: 40},
            },
        )

    def test_a_reading_before_the_record_extends_it(self):
        # A day the walk never held but the surface reports joins the record
        # with its total and no split; the days between stay the zeros the
        # series contract defines and are never written back.
        self.write_tree()
        self.write_readings({"2026-08-01": 7})
        section, _ = self.run_capture()
        self.assertEqual(section["series"]["startDate"], "2026-08-01")
        self.assertEqual(section["series"]["totals"], [7] + [0] * 8 + [20, 40, 60])
        self.assertEqual(section["categoriesStartDate"], "2026-08-10")
        self.assertEqual(self.stored_days()["2026-08-01"], {"total": 7})
        self.assertNotIn("2026-08-02", self.stored_days())

    def test_the_most_recent_day_and_the_future_refuse_before_the_store_is_written(self):
        self.write_tree()
        for day, reason in (("2026-08-12", "most recent day"), ("2026-08-13", "outside the record")):
            self.write_readings({day: 5}, read_on="2026-08-13")
            with self.assertRaisesRegex(capture_usage_series.CaptureError, reason):
                self.run_capture()
            self.assertFalse(self.store.exists(), "a refused reading still wrote the store")

    def test_readings_are_applied_through_a_history_store_only(self):
        self.write_tree()
        self.write_readings({"2026-08-11": 30})
        with self.assertRaisesRegex(capture_usage_series.CaptureError, "history store"):
            self.run_capture(history=False)

    def test_a_missing_readings_file_is_no_readings(self):
        self.write_tree()
        section, _ = self.run_capture()
        self.assertEqual(section["series"]["totals"], [20, 40, 60])

    def test_a_malformed_readings_file_refuses_with_its_reason(self):
        # Each validation is pinned by ITS OWN message, so a check that only
        # ever fired because a later one caught the same row cannot pass
        # for present (round-1 review, finding 4).
        self.write_tree()
        schema = capture_usage_series.HISTORY_SCHEMA_KEY
        rows = capture_usage_series.VERIFIED_READINGS_KEY
        valid = capture_usage_series.VERIFIED_SCHEMA
        good = {"total": 30, "readOn": "2026-08-12"}
        for document, reason in (
            ([], "expected schema"),
            ({schema: "usage-verified/v0", rows: {"2026-08-11": good}}, "expected schema"),
            ({schema: valid}, "unknown section"),
            ({schema: valid, rows: {"2026-08-11": good}, "extra": 1}, "unknown section"),
            ({schema: valid, rows: []}, "no day index"),
            # A key that is not a day yet sorts BEFORE its read-on day, so
            # only the calendar check can refuse it.
            ({schema: valid, rows: {"2026-08-1": good}}, "not a calendar day"),
            ({schema: valid, rows: {"2026-13-01": good}}, "not a calendar day"),
            ({schema: valid, rows: {"2026-08-11": {"total": 30}}}, "malformed day entry"),
            ({schema: valid, rows: {"2026-08-11": {"total": 0, "readOn": "2026-08-12"}}}, "positive bounded total"),
            ({schema: valid, rows: {"2026-08-11": {"total": True, "readOn": "2026-08-12"}}}, "positive bounded total"),
            (
                {schema: valid, rows: {"2026-08-11": {"total": capture_usage_series.MAX_COUNT + 1, "readOn": "2026-08-12"}}},
                "positive bounded total",
            ),
            ({schema: valid, rows: {"2026-08-11": {"total": 30, "readOn": "2026-08-10"}}}, "before the day it names"),
            ({schema: valid, rows: {"2026-08-11": {"total": 30, "readOn": "soon"}}}, "before the day it names"),
        ):
            self.readings.write_text(json.dumps(document), encoding="utf-8")
            with self.assertRaisesRegex(capture_usage_series.CaptureError, reason, msg=repr(document)):
                self.run_capture()
        self.readings.write_text("{", encoding="utf-8")
        with self.assertRaisesRegex(capture_usage_series.CaptureError, "parsable"):
            self.run_capture()

    def test_an_oversized_readings_file_refuses(self):
        self.write_tree()
        self.readings.write_text(
            "[" + " " * capture_usage_series.MAX_VERIFIED_READINGS_BYTES + "]", encoding="utf-8"
        )
        with self.assertRaisesRegex(capture_usage_series.CaptureError, "byte bound"):
            self.run_capture()


class CacheAccrualTest(unittest.TestCase):
    """Lifetime-class stats accrue the partitioned days strictly after the
    activity cache's own as-of day (issue #288).

    The cache is exact as of the day it was last recomputed and frozen after
    it, so between recomputations the lifetime-class tiles sat still while
    the series under them kept moving. The accrual keeps the whole the sum
    of its classes, never re-accrues the as-of day, skips a day the walk
    could not split, and refuses a cache that cannot say when it was
    computed.
    """

    def setUp(self):
        self.scratch = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.scratch, ignore_errors=True)
        self.tree = self.scratch / "tree"
        self.tree.mkdir()
        self.cache = self.scratch / "cache.json"
        self.store = self.scratch / "store.json"

    def day_line(self, day, ident, tokens):
        return transcript_line(
            timestamp=day + "T12:00:00Z",
            requestId="req_%s" % ident,
            message={
                "id": "msg_%s" % ident,
                "model": "avendor-%s" % capture_usage_series.MODEL_KEYS[1],
                "usage": {"input_tokens": tokens, "output_tokens": tokens},
            },
        )

    def write_cache(self, **overrides):
        document = {
            capture_usage_series.ACTIVITY_CACHE_DAILY_KEY: [],
            capture_usage_series.ACTIVITY_CACHE_USAGE_KEY: {
                "avendor-alpha": {
                    "inputTokens": 6,
                    "outputTokens": 7,
                    "cacheReadInputTokens": 8,
                    "cacheCreationInputTokens": 9,
                }
            },
            capture_usage_series.ACTIVITY_CACHE_SESSIONS_KEY: 3,
            capture_usage_series.ACTIVITY_CACHE_COMPUTED_KEY: "2026-08-10",
        }
        document.update(overrides)
        self.cache.write_text(json.dumps(document), encoding="utf-8")

    def stats(self, history=None):
        (self.tree / "session.jsonl").write_text(
            "\n".join(
                (
                    self.day_line("2026-08-10", "a", 10),
                    self.day_line("2026-08-11", "b", 20),
                    self.day_line("2026-08-12", "c", 30),
                )
            )
            + "\n",
            encoding="utf-8",
        )
        section, _ = capture_usage_series.capture(
            self.tree,
            capture_usage_series.FORMAT_MESSAGES,
            self.cache,
            today=datetime.date(2026, 8, 12),
            history_store=history,
        )
        return section["stats"]

    def test_days_after_the_as_of_day_accrue_onto_the_whole_and_its_classes(self):
        self.write_cache()
        self.assertEqual(
            self.stats(),
            {
                "input": 56,
                "output": 57,
                "cache-read": 8,
                "cache-write": 9,
                "lifetime": 130,
                "sessions": 3,
                # The walk's own longest span: this fixture's single file runs
                # from 2026-08-10 to 2026-08-12 at the same hour, two days
                # apart (issue #267).
                "longest-session": 172_800,
            },
        )

    def test_the_as_of_day_itself_never_re_accrues(self):
        self.write_cache(**{capture_usage_series.ACTIVITY_CACHE_COMPUTED_KEY: "2026-08-12"})
        self.assertEqual(self.stats()["lifetime"], 30)

    def test_a_day_the_walk_could_not_split_accrues_nothing(self):
        # A stored day after the as-of day carrying a total and no partition
        # (its records were never walked): the whole must not move by a
        # figure whose classes are unknown, so only the split day accrues.
        self.store.write_text(
            json.dumps(
                {
                    capture_usage_series.HISTORY_SCHEMA_KEY: capture_usage_series.HISTORY_SCHEMA,
                    capture_usage_series.HISTORY_DAYS_KEY: {"2026-08-11": {"total": 1_000}},
                }
            ),
            encoding="utf-8",
        )
        self.write_cache()
        stats = self.stats(history=self.store)
        self.assertEqual(stats["lifetime"], 90)
        self.assertEqual(stats["input"], 36)

    def test_an_accrual_past_the_shared_count_bound_refuses(self):
        # The cache's own figures sit under the bound, so lifetime_stats
        # admits them; the days after the as-of day carry the whole over it,
        # and the accrual is what must refuse (round-1 review, finding 1b).
        near = capture_usage_series.MAX_COUNT - 60
        usage = {
            "avendor-alpha": {
                "inputTokens": near,
                "outputTokens": 0,
                "cacheReadInputTokens": 0,
                "cacheCreationInputTokens": 0,
            }
        }
        self.write_cache(**{capture_usage_series.ACTIVITY_CACHE_USAGE_KEY: usage})
        with self.assertRaisesRegex(
            capture_usage_series.CaptureError, "activity cache lifetime figures exceed"
        ):
            self.stats()
        # The control: the same cache with nothing after its as-of day is
        # admitted at exactly its own figure.
        self.write_cache(
            **{
                capture_usage_series.ACTIVITY_CACHE_USAGE_KEY: usage,
                capture_usage_series.ACTIVITY_CACHE_COMPUTED_KEY: "2026-08-12",
            }
        )
        self.assertEqual(self.stats()["lifetime"], near)

    def test_a_cache_without_a_calendar_as_of_day_refuses(self):
        for as_of in (None, "yesterday", "2026-13-01", 20260810):
            self.write_cache(**{capture_usage_series.ACTIVITY_CACHE_COMPUTED_KEY: as_of})
            with self.assertRaisesRegex(capture_usage_series.CaptureError, "as-of day"):
                self.stats()


class ModelWindowTest(unittest.TestCase):
    """The per-model section is a DECLARED trailing window, never a silent one."""

    def test_a_long_series_windows_the_models_and_says_where_they_start(self):
        member = capture_usage_series.MODEL_KEYS[1]
        span = capture_usage_series.MAX_MODEL_DAYS + 30
        start = datetime.date(2026, 1, 1)
        rows = [
            (
                (start + datetime.timedelta(days=offset)).isoformat(),
                1,
                {"input": 1},
                member,
            )
            for offset in range(span)
        ]
        with tempfile.TemporaryDirectory() as root:
            (pathlib.Path(root) / "session.jsonl").write_text("", encoding="utf-8")
            series, categories, models, partitioned, _joint = capture_usage_series.daily_series(rows)
        self.assertEqual(len(models[member]), span)
        # The window the emission takes, and the partition it must satisfy.
        offset = span - capture_usage_series.MAX_MODEL_DAYS
        windowed = capture_usage_series.window_section(models, offset)
        self.assertEqual(len(windowed[member]), capture_usage_series.MAX_MODEL_DAYS)
        capture_usage_series.assert_partition(series["totals"], windowed, offset)


class CaptureFormatTest(unittest.TestCase):
    def test_the_default_shape_is_the_message_reader(self):
        with tempfile.TemporaryDirectory() as root:
            with open(os.path.join(root, "session.jsonl"), "w", encoding="utf-8") as handle:
                handle.write(transcript_line() + "\n")
            section, _counters = capture_usage_series.capture(root)
        self.assertEqual(section["series"]["totals"], [135])

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
        {
            "__future__",
            "argparse",
            "datetime",
            # `errno` joined in round 5: the descriptor-rooted descent tells a
            # symlink swap (ELOOP/ENOTDIR) apart from an ordinary unreadable
            # entry, and a bare `except OSError` cannot. It is a table of
            # integers with no callables at all.
            "errno",
            "json",
            "os",
            "pathlib",
            "re",
            "sys",
        }
    )

    # Every `os.` attribute the module is allowed to name. Descriptor-rooted
    # reading and nothing else: no process, no network, no filesystem
    # mutation.
    ALLOWED_OS_ATTRIBUTES = frozenset(
        {
            "O_CLOEXEC",
            # O_DIRECTORY joined in round 5: each intermediate component must
            # open as a real directory, or the descent is not a descent.
            "O_DIRECTORY",
            "O_NOFOLLOW",
            "O_NONBLOCK",
            "O_RDONLY",
            "close",
            "fdopen",
            "fstat",
            # listdir and lstat joined in round 5 for the same reason: the
            # walk reads entries and their types THROUGH a directory
            # descriptor now, where it previously asked pathlib to re-resolve
            # each name from the filesystem root.
            "listdir",
            "lstat",
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
        # `__doc__` is Optional, and a class stripped of its docstring is the
        # very regression this pin exists to catch — so it fails HERE, by
        # name, rather than inside assertIn's container argument.
        doc = ImportSurfaceTest.__doc__
        if doc is None:
            self.fail("ImportSurfaceTest lost the docstring that states its limits")
        self.assertIn("REVIEW BOUND", doc)
        self.assertIn("getattr", doc)

    def test_the_pin_is_reading_a_real_import_surface(self):
        # Non-vacuity: an assertion about a set that turned out to be empty
        # would pass for the wrong reason forever.
        self.assertIn("json", self.imported_roots())
        self.assertGreater(len(self.imported_roots()), 3)


class LocalDayTest(unittest.TestCase):
    """local_day is THE bucketing decision (issue #276, owner ruling
    2026-09-01): a record lands on the workstation's local calendar day,
    because that is how the vendors' own surfaces bucket and matching them is
    what going-forward correctness means. The suite runs pinned to TZ=UTC for
    determinism, so these tests stage non-UTC zones explicitly — POSIX
    fixed-offset strings, portable across macOS and the CI runners — and
    restore the pin afterwards. Under UTC these cases are indistinguishable
    from the retired UTC rule, which is exactly why the staged zones are what
    makes this suite able to fail."""

    def pinned(self, zone):
        os.environ["TZ"] = zone
        time.tzset()
        self.addCleanup(self._restore)

    def _restore(self):
        os.environ["TZ"] = "UTC"
        time.tzset()

    def test_an_instant_lands_on_the_local_day_west_of_greenwich(self):
        # 03:51Z on the 24th is still the evening of the 23rd at UTC-5. The
        # retired UTC rule filed that evening under the 24th — the exact
        # ±1-day skew the owner measured against the vendor surfaces (a
        # 12-day vendor streak reading 13 here).
        self.pinned("EST5")
        self.assertEqual(capture_usage_series.local_day("2026-08-24T03:51:18Z"), "2026-08-23")

    def test_an_instant_lands_on_the_local_day_east_of_greenwich(self):
        self.pinned("JST-9")
        self.assertEqual(capture_usage_series.local_day("2026-08-23T20:00:00Z"), "2026-08-24")

    def test_an_offset_instant_is_normalized_before_bucketing(self):
        # Under the suite's TZ=UTC pin the local day IS the UTC day, so an
        # instant carrying its own offset lands where the arithmetic says.
        self.assertEqual(capture_usage_series.local_day("2026-08-10T20:00:00-07:00"), "2026-08-11")

    def test_a_naive_instant_is_read_as_utc(self):
        # A journal record that omits its zone is a UTC instant, never
        # silently a local one: at UTC-5 the naive 00:30 is 19:30 the
        # previous local evening.
        self.pinned("EST5")
        self.assertEqual(capture_usage_series.local_day("2026-08-10T00:30:00"), "2026-08-09")

    def test_an_unparseable_instant_is_no_day_at_all(self):
        self.assertIsNone(capture_usage_series.local_day("the tenth"))


class DailySeriesTest(unittest.TestCase):
    @staticmethod
    def rows(*entries):
        """Reduced rows for the day/total pairs given, each fully attributed.

        The parts and the member are what the aggregate is built beside, so a
        fixture that omitted them would be testing a shape the readers never
        produce.
        """
        return [
            (day, total, {"input": total}, capture_usage_series.MODEL_KEYS[1])
            for day, total in entries
        ]

    def test_fills_the_span_contiguously_and_sums_repeated_days(self):
        series, categories, models, partitioned, _joint = capture_usage_series.daily_series(
            self.rows(("2026-08-10", 5), ("2026-08-12", 7), ("2026-08-10", 5))
        )
        self.assertEqual(series["startDate"], "2026-08-10")
        self.assertEqual(series["totals"], [10, 0, 7])
        self.assertTrue(series["recorded"])
        # Both breakdowns are laid on the SAME contiguous window and partition
        # it exactly — the interior zero day included.
        self.assertEqual(categories, {"input": [10, 0, 7]})
        self.assertEqual(models, {capture_usage_series.MODEL_KEYS[1]: [10, 0, 7]})
        self.assertEqual(partitioned, ["2026-08-10", "2026-08-11", "2026-08-12"])

    def test_a_record_that_cannot_be_partitioned_still_counts_toward_its_day(self):
        # The total is measured on its own field, so it stands. What is lost
        # is the DAY's claim to a breakdown, and losing it loudly is the whole
        # point: a partition that silently omits a record is a hole wearing a
        # partition's label.
        series, categories, _models, partitioned, _joint = capture_usage_series.daily_series(
            [("2026-08-10", 5, None, "other"), ("2026-08-11", 7, {"input": 7}, "other")]
        )
        self.assertEqual(series["totals"], [5, 7])
        self.assertEqual(categories, {"input": [0, 7]})
        self.assertEqual(partitioned, ["2026-08-11"])

    def test_a_breakdown_row_that_is_zero_every_day_is_not_emitted(self):
        _series, categories, _models, _partitioned, _joint = capture_usage_series.daily_series(
            [("2026-08-10", 5, {"input": 5, "output": 0}, "other")]
        )
        self.assertEqual(categories, {"input": [5]})

    def test_a_zero_inside_the_window_is_a_measurement_not_an_invention(self):
        # The window never extends past the days the record covers, which is
        # what keeps the interior zeros honest: they say the record has
        # nothing for that day, not that the day did not exist.
        series, _c, _m, _p, _joint = capture_usage_series.daily_series(
            self.rows(("2026-08-10", 1), ("2026-08-11", 2))
        )
        self.assertEqual(len(series["totals"]), 2)

    def test_an_empty_walk_refuses_rather_than_emitting_an_empty_series(self):
        with self.assertRaises(CaptureError):
            capture_usage_series.daily_series([])

    def test_a_span_past_the_origins_bound_is_refused_here(self):
        # Shipping a series the origin will refuse at load is worse than
        # shipping none: the panel would degrade to unavailable on boot.
        with self.assertRaises(CaptureError):
            capture_usage_series.daily_series(
                self.rows(("2020-01-01", 1), ("2026-01-01", 1))
            )


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

        match = required_match(
            r"categoryServeOrder = \[\]string\{([^}]*)\}",
            source,
            "internal/panels/types.go carries no categoryServeOrder",
        )
        go_keys = tuple(re.findall(r'"([^"]+)"', match.group(1)))
        self.assertEqual(
            go_keys,
            capture_usage_series.CATEGORY_KEYS,
            "categoryServeOrder in internal/panels/types.go and CATEGORY_KEYS in "
            "scripts/capture_usage_series.py must stay identical, in order",
        )

    def test_matches_the_frontend_palette_slots(self):
        source = (self.REPO_ROOT / "frontend/src/lib/token-usage.ts").read_text(encoding="utf-8")

        match = required_match(
            r"categorySlots[^(]*\(\[([^\]]*(?:\][^\]]*)*?)\]\);",
            source,
            "frontend/src/lib/token-usage.ts carries no categorySlots",
            re.DOTALL,
        )
        ts_keys = tuple(re.findall(r"\['([^']+)',\s*\d+\]", match.group(1)))
        self.assertEqual(
            ts_keys,
            capture_usage_series.CATEGORY_KEYS,
            "categorySlots in frontend/src/lib/token-usage.ts and CATEGORY_KEYS in "
            "scripts/capture_usage_series.py must stay identical, in order",
        )


# Where the swept sources live: every production file that could grow a
# second copy of the vocabulary. The data file itself is deliberately absent
# — data is exactly where a model name belongs.
SWEPT_SOURCES = (
    ("internal/panels", (".go",)),
    ("frontend/src", (".ts", ".svelte", ".css")),
    ("scripts", (".py",)),
)


def quoted_needles(*values):
    """Both quotings of each value, which is the shape a table would take.

    Quoted rather than bare, and that is the difference between a guard and a
    nuisance: `other` is an English word that appears in prose all over this
    repository, while `'other'` is a key in a lookup table. The needles are
    built from the DATA FILE at run time, so this test file never spells a
    model name either.
    """
    return tuple(
        quoting % value for value in values for quoting in ("'%s'", '"%s"')
    )


def spelled_models(text, needles):
    """Every vocabulary needle the given source text spells."""
    return sorted({needle for needle in needles if needle in text})


class ModelVocabularyTest(unittest.TestCase):
    """The model vocabulary is ONE file, and only that file spells a model.

    It used to be three hand-kept tables — MODEL_KEYS here,
    modelServeOrder in internal/panels/types.go, and modelSlots in
    frontend/src/lib/token-usage.ts — held together by a regex comparison
    between them. Issue #302 replaced the three with
    internal/panels/config/models.json, which every consumer READS, so the
    seats cannot drift apart at all. What is left to prove is different in
    kind, and this class proves exactly it:

      1. this producer's vocabulary IS the file's own reading order;
      2. the other two consumers read that same file rather than a copy;
      3. no production source anywhere spells a model key or a written name,
         so a fourth table cannot quietly appear;
      4. the sweep in (3) can actually fail.

    ORDER still matters as much as membership. The serve order is what the
    origin walks to emit rows deterministically, so every replica's bytes and
    therefore its digest ETag stay identical, and the browser admits by
    walking the same list. The residual leads it by RULE: the producer folds
    an unrecognized identifier into the residual and counts the fold, so a
    vendor renaming a model mid-flight loses the split for those tokens
    rather than losing the tokens, and a vocabulary edit that moved the
    residual would silently reassign every fold to a real model.
    """

    REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

    def vocabulary(self):
        return json.loads(
            (self.REPO_ROOT / "internal/panels/config/models.json").read_text(encoding="utf-8")
        )

    def declared_order(self):
        document = self.vocabulary()
        order = [document["residual"]["key"]]
        for group in document["groups"]:
            order.extend(member["key"] for member in group["members"])
        return order

    def sources(self):
        return json.loads(
            (self.REPO_ROOT / "internal/panels/config/sources.json").read_text(encoding="utf-8")
        )

    def needles(self):
        document = self.vocabulary()
        spellings = [document["residual"]["key"], document["residual"]["label"]]
        for group in document["groups"]:
            spellings.extend([group["key"], group["label"]])
            for member in group["members"]:
                spellings.extend([member["key"], member["label"]])
                spellings.extend(member.get("ids") or ())
        # The SECOND data file of the one rule (issue #267). A source key is
        # what the wire carries and a source NAME is what a reader prints, and
        # before sources.json existed the name had nowhere to live but a
        # component — the fourth table this sweep is here to prevent.
        for source in self.sources()["sources"]:
            spellings.extend([source["key"], source["name"]])
        return quoted_needles(*spellings)

    def test_the_producer_serves_the_files_own_order(self):
        self.assertEqual(
            list(capture_usage_series.MODEL_KEYS),
            self.declared_order(),
            "MODEL_KEYS must be internal/panels/config/models.json's own reading order: "
            "the residual, then every group's members in the order the file lists them",
        )

    def test_the_residual_member_leads_the_vocabulary(self):
        self.assertEqual(
            capture_usage_series.MODEL_KEYS[0],
            capture_usage_series.MODEL_OTHER,
            "the residual member must lead MODEL_KEYS; the fold is keyed on it",
        )
        self.assertEqual(
            capture_usage_series.MODEL_OTHER,
            self.vocabulary()["residual"]["key"],
            "the residual the producer folds into must be the one the file reserves",
        )

    def test_the_model_window_budget_is_one_number_in_three_places(self):
        """The days a model section may cover is one budget three stages enforce.

        It was hand-kept in all three until issue #302 moved it: the producer
        windows its emission to it, the origin refuses a wider one, and the
        browser refuses a wider one again. A change in one seat alone is a
        producer emitting documents the origin rejects on every push, or an
        origin admitting a section the page then refuses to draw — so the
        number is pinned across the three the way the payload ceiling is.
        """
        origin = required_match(
            r"maxModelDays = (\d+)",
            (self.REPO_ROOT / "internal/panels/types.go").read_text(encoding="utf-8"),
            "internal/panels/types.go carries no maxModelDays",
        )
        browser = required_match(
            r"const maxModelDays = (\d+);",
            (self.REPO_ROOT / "frontend/src/lib/token-usage.ts").read_text(encoding="utf-8"),
            "frontend/src/lib/token-usage.ts carries no maxModelDays",
        )
        self.assertEqual(
            int(origin.group(1)),
            capture_usage_series.MAX_MODEL_DAYS,
            "maxModelDays in internal/panels/types.go and MAX_MODEL_DAYS in "
            "scripts/capture_usage_series.py must state the identical budget",
        )
        self.assertEqual(
            int(browser.group(1)),
            capture_usage_series.MAX_MODEL_DAYS,
            "maxModelDays in frontend/src/lib/token-usage.ts and MAX_MODEL_DAYS in "
            "scripts/capture_usage_series.py must state the identical budget",
        )

    def test_the_origin_and_the_browser_read_the_same_file(self):
        origin = (self.REPO_ROOT / "internal/panels/types.go").read_text(encoding="utf-8")
        self.assertIn(
            "//go:embed config/models.json",
            origin,
            "internal/panels must embed the vocabulary file rather than transcribe it",
        )
        browser = (self.REPO_ROOT / "frontend/src/lib/token-usage.ts").read_text(encoding="utf-8")
        self.assertIn(
            "config/models.json",
            browser,
            "frontend/src/lib/token-usage.ts must import the vocabulary file rather than "
            "transcribe it",
        )

    def test_the_origin_and_the_browser_read_the_same_source_file(self):
        """The source vocabulary is one file with the same three readers.

        The origin embeds it, this suite reads it for the sweep above, and the
        page imports it for the written name it prints. A reader that
        transcribes instead of importing is the fourth table again, one file
        later (issue #267).

        The browser side is asserted as an IMPORT of the path rather than as a
        mention: the page reads these bytes at build time, exactly as it reads
        the model vocabulary's.
        """
        origin = (self.REPO_ROOT / "internal/panels/types.go").read_text(encoding="utf-8")
        self.assertIn(
            "//go:embed config/sources.json",
            origin,
            "internal/panels must embed the source vocabulary rather than transcribe it",
        )
        browser = (self.REPO_ROOT / "frontend/src/lib/token-usage.ts").read_text(encoding="utf-8")
        self.assertIn(
            "../../../internal/panels/config/sources.json",
            browser,
            "frontend/src/lib/token-usage.ts must import "
            "internal/panels/config/sources.json rather than transcribe the written "
            "source names",
        )

    def test_no_production_source_spells_a_model(self):
        needles = self.needles()
        self.assertGreater(len(needles), 20, "the sweep has almost nothing to look for")
        for tree, suffixes in SWEPT_SOURCES:
            for source in sorted((self.REPO_ROOT / tree).rglob("*")):
                if source.suffix not in suffixes:
                    continue
                # Test sources are exempt by construction: a fixture that
                # exercises a key has to spell one, and this file is itself
                # the proof of that.
                if source.name.endswith("_test.go") or source.name.startswith("test_"):
                    continue
                found = spelled_models(source.read_text(encoding="utf-8"), needles)
                self.assertEqual(
                    found,
                    [],
                    "%s spells %s; a model key, a written name and a vendor group live "
                    "only in internal/panels/config/models.json, which every consumer reads"
                    % (source.relative_to(self.REPO_ROOT), ", ".join(found)),
                )

    def test_the_sweep_can_fail(self):
        # Non-vacuity: a guard that cannot redden is decoration. A source
        # that reintroduces the residual as a literal must be caught, and one
        # that merely mentions the word in prose must not.
        needles = self.needles()
        residual = capture_usage_series.MODEL_OTHER
        self.assertEqual(
            spelled_models("const table = ['%s', 0];" % residual, needles),
            ["'%s'" % residual],
        )
        self.assertEqual(
            spelled_models("# every other member keeps its slot", needles),
            [],
        )

    def test_the_sweep_can_fail_on_a_written_source_name(self):
        """The needles issue #267 added, proven non-vacuous on their own.

        The written SOURCE name is the case that earns this: it is display
        copy that would look entirely at home beside a panel heading, and
        sources.json is the only place it may be spelled. Every key and every
        name in the file gets its own hostile line, so a needle that stopped
        being built would redden here rather than silently stop sweeping.
        """
        needles = self.needles()
        for source in self.sources()["sources"]:
            for spelling in (source["key"], source["name"]):
                with self.subTest(spelling=spelling):
                    self.assertEqual(
                        spelled_models('const heading = "%s";' % spelling, needles),
                        ['"%s"' % spelling],
                    )


class DerivedVocabularyParityTest(unittest.TestCase):
    """The closed derived vocabulary is ONE fact on both ends of the pipe.

    The producer's derived_figures defines what a series emission carries;
    internal/panels/types.go usageSeriesDerivedKeys is what the origin
    requires COMPLETE and refuses beyond. A key added on one side alone is
    either a document the origin rejects on every push (producer wider) or a
    tile no push can ever refresh again (origin wider) — issue #276 grew the
    set to five precisely because the second failure mode is what froze the
    active-days and tracked-days tiles. The Go map's keys are identifiers, so
    the pin resolves them through the stat-key const block first.
    """

    REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

    def test_matches_the_go_derived_vocabulary(self):
        source = (self.REPO_ROOT / "internal/panels/types.go").read_text(encoding="utf-8")
        constants = dict(re.findall(r'\b(stat\w+)\s+=\s+"([^"]+)"', source))
        self.assertTrue(constants, "internal/panels/types.go carries no stat-key constants")
        match = required_match(
            r"usageSeriesDerivedKeys = map\[string\]string\{([^}]*)\}",
            source,
            "internal/panels/types.go carries no usageSeriesDerivedKeys",
        )
        identifiers = re.findall(r"(stat\w+):", match.group(1))
        go_keys = {constants[name] for name in identifiers}
        self.assertEqual(len(go_keys), len(identifiers), "an unresolved or repeated stat key")
        produced = set(capture_usage_series.derived_figures({"totals": [1]}))
        self.assertEqual(
            go_keys,
            produced,
            "usageSeriesDerivedKeys in internal/panels/types.go and derived_figures in "
            "scripts/capture_usage_series.py must define the identical closed set",
        )


class StatsVocabularyParityTest(unittest.TestCase):
    """The closed captured-stats vocabulary is ONE fact on both ends too.

    scripts/capture_usage_series.py STATS_KEYS bounds what a producer may
    emit; internal/panels/types.go usageSeriesStatKeys bounds what the origin
    admits and which snapshot tiles it requires refreshed (issue #276). The
    same two failure modes as the derived pin, so the same discipline.
    """

    REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

    def test_matches_the_go_captured_vocabulary(self):
        source = (self.REPO_ROOT / "internal/panels/types.go").read_text(encoding="utf-8")
        match = required_match(
            r"usageSeriesStatKeys = map\[string\]string\{([^}]*)\}",
            source,
            "internal/panels/types.go carries no usageSeriesStatKeys",
        )
        go_keys = set(re.findall(r'"([^"]+)":', match.group(1)))
        self.assertEqual(
            go_keys,
            set(capture_usage_series.STATS_KEYS),
            "usageSeriesStatKeys in internal/panels/types.go and STATS_KEYS in "
            "scripts/capture_usage_series.py must define the identical closed set",
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
        source = (self.REPO_ROOT / "internal/seal/types.go").read_text(encoding="utf-8")
        match = required_match(
            r"MaxSealedBytes = (\d+) << (\d+)",
            source,
            "internal/seal/types.go carries no MaxSealedBytes",
        )
        return int(match.group(1)) << int(match.group(2))

    def structural_maximum(self, digits):
        """Seal-sized bytes of the largest document the origin can admit.

        MEASURED here rather than quoted from a comment (2026-08-24 round-3
        review, which found the quoted figure off by the mandatory trailing
        newline). The maximum is one document covering every label the
        SHIPPED snapshot carries — a document can never name another — each
        at the series-day bound with the complete category vocabulary, the
        complete model vocabulary over its own MAX_MODEL_DAYS window, and the
        complete window and derived sets, emitted in the producer's own
        compact form with its terminating newline, plus the AEAD overhead.
        Re-deriving it from the shipped constants means the number cannot go
        stale behind a document-shape change again.

        The models section is why MAX_MODEL_DAYS exists rather than the
        section simply covering the series (issue #170): one integer per day
        per member across MAX_SERIES_DAYS would outweigh the entire ceiling
        on its own, so the section is a declared trailing WINDOW and this
        measurement is what keeps that claim honest.
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
        model_days = capture_usage_series.MAX_MODEL_DAYS
        # The model rows partition the SAME totals over the trailing window,
        # divided as evenly as integers allow across a vocabulary that need
        # not be the categories' size (issue #299 added a member): every row
        # keeps the ladder's digit count, so the measurement stays the widest
        # document the origin would admit rather than one it would refuse.
        share, remainder = divmod(total, len(capture_usage_series.MODEL_KEYS))
        model_values = [share + remainder] + [share] * (len(capture_usage_series.MODEL_KEYS) - 1)
        self.assertEqual(sum(model_values), total)
        self.assertTrue(all(len(str(amount)) == digits for amount in model_values), model_values)
        models_start = datetime.date(2024, 1, 1) + datetime.timedelta(days=days - model_days)
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
                    "models": {
                        key: [amount] * model_days
                        for key, amount in zip(capture_usage_series.MODEL_KEYS, model_values)
                    },
                    "modelsStartDate": models_start.isoformat(),
                    "windows": {
                        "today": {"input": value, "output": value},
                        "week": {"input": value, "output": value},
                    },
                    "derived": {
                        "peak-day": total,
                        "current-streak": days,
                        "longest-streak": days,
                        "active-days": days,
                        "tracked-days": days,
                    },
                    # The captured-stats section at its widest (issue #276):
                    # every vocabulary member, each at the ladder value, on
                    # every source — wider than any real document, which is
                    # the right direction for a structural maximum. Issue #267
                    # joined `longest-session` to that vocabulary, so it costs
                    # one more figure here without a further edit.
                    "stats": {
                        key: value for key in capture_usage_series.STATS_KEYS
                    },
                    # The per-model lifetime split at ITS widest (issue #267):
                    # every vocabulary member carrying every accounting class
                    # at the ladder value, on every source. It is the only new
                    # section whose cost grows with the vocabulary the way the
                    # models breakdown's does — but it costs one figure per
                    # member per class rather than per member per DAY, so it
                    # is a constant beside the windowed section rather than
                    # another multiple of it.
                    "modelStats": [
                        {
                            "key": key,
                            "totals": {
                                name: value
                                for name in capture_usage_series.CATEGORY_KEYS
                            },
                        }
                        for key in capture_usage_series.MODEL_KEYS
                    ],
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
        # than an open door. THIS is the binding claim, and it holds.
        cap = self.go_cap()
        self.assertEqual(cap, 131072)
        maximum = self.structural_maximum(10)
        self.assertGreater(cap, maximum)
        # The headroom is one further decimal digit on every value: the same
        # maximum still fits at eleven digits and crosses only at twelve.
        # Measured after issue #267 at a fifty-six-day model window: 119,664
        # sealed bytes at ten digits, 130,058 at eleven, 140,452 at twelve.
        #
        # The history of the trade: three digits before the models section
        # (issue #170), two after the sixth model member (issue #299), one
        # after issue #302 cut the window to ten weeks to buy it back, and
        # still one after issue #267 added the per-model lifetime split and
        # the longest-session tile — which together cost 3,904 bytes at
        # eleven digits against the 610 the ceiling then had left — and cut
        # the window again, to eight weeks, for the same reason. The ceiling
        # is never the lever; the window is.
        self.assertLess(self.structural_maximum(11), cap)
        self.assertGreater(self.structural_maximum(12), cap)

    def test_matches_the_origin_admission_cap(self):
        source = (self.REPO_ROOT / "internal/panels/types.go").read_text(encoding="utf-8")
        match = required_match(
            r"maxSealedSeriesBytes = (\d+) << (\d+)",
            source,
            "internal/panels/types.go carries no maxSealedSeriesBytes",
        )
        self.assertEqual(
            int(match.group(1)) << int(match.group(2)),
            self.go_cap(),
            "maxSealedSeriesBytes in internal/panels/types.go and MaxSealedBytes in "
            "internal/seal/types.go must state the identical ceiling",
        )

    def test_matches_the_exporter(self):
        source = (self.REPO_ROOT / "scripts/export_usage_series.py").read_text(encoding="utf-8")
        cap = required_match(
            r"MAX_SEALED_BYTES = (\d+) \* 1024",
            source,
            "scripts/export_usage_series.py carries no MAX_SEALED_BYTES",
        )
        overhead = required_match(
            r"SEAL_OVERHEAD = (\d+)",
            source,
            "scripts/export_usage_series.py carries no SEAL_OVERHEAD",
        )
        self.assertEqual(
            int(cap.group(1)) * 1024,
            self.go_cap(),
            "MAX_SEALED_BYTES in scripts/export_usage_series.py and MaxSealedBytes in "
            "internal/seal/types.go must state the identical ceiling",
        )
        # The overhead is what turns the sealed ceiling into the producer's
        # plaintext bound, so it is pinned against the Go format too.
        seal_source = (self.REPO_ROOT / "internal/seal/types.go").read_text(encoding="utf-8")
        # All three, not only the magic: the sum below reads every one of
        # them, so a missing nonce or tag constant is exactly as much a
        # parity failure as a missing magic, and used to be an AttributeError
        # instead of one.
        magic = required_match(
            r'magic = "([^"]+)"', seal_source, "internal/seal/types.go carries no magic"
        )
        nonce = required_match(
            r"nonceBytes = (\d+)", seal_source, "internal/seal/types.go carries no nonceBytes"
        )
        tag = required_match(
            r"tagBytes = (\d+)", seal_source, "internal/seal/types.go carries no tagBytes"
        )
        self.assertEqual(
            int(overhead.group(1)),
            len(magic.group(1)) + int(nonce.group(1)) + int(tag.group(1)),
            "SEAL_OVERHEAD in scripts/export_usage_series.py must equal Overhead in "
            "internal/seal/types.go (magic + nonce + tag)",
        )

    def test_matches_the_push_script(self):
        source = (
            self.REPO_ROOT / "scripts/usage-export/push-usage-series.sh"
        ).read_text(encoding="utf-8")
        match = required_match(
            r"^MAX_SEALED_BYTES=(\d+)$",
            source,
            "scripts/usage-export/push-usage-series.sh carries no MAX_SEALED_BYTES",
            re.MULTILINE,
        )
        self.assertEqual(
            int(match.group(1)),
            self.go_cap(),
            "MAX_SEALED_BYTES in scripts/usage-export/push-usage-series.sh and "
            "MaxSealedBytes in internal/seal/types.go must state the identical ceiling",
        )

    def test_matches_the_documented_forced_command_and_manual(self):
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

            section, counters = capture_usage_series.capture(root)
        series = section["series"]
        derived = section["derived"]

        self.assertEqual(series, {"startDate": "2026-08-10", "totals": [135, 0, 7], "recorded": True})
        self.assertEqual(
            derived,
            {"peak-day": 135, "current-streak": 1, "longest-streak": 1, "active-days": 2, "tracked-days": 3},
        )
        # No activity cache means no lifetime accounting to carry, so the
        # captured-stats section holds exactly the one figure a WALK can
        # measure on its own (issue #267): the longest session span. Every
        # other lifetime-class figure is the tool's accounting and stays
        # absent rather than zero-filled.
        self.assertEqual(set(section["stats"]), {"longest-session"})
        self.assertNotIn("modelStats", section)
        self.assertEqual(counters["files"], 1)
        self.assertEqual(counters["duplicates"], 1)
        self.assertEqual(counters["counted"], 2)

        # The whole emission, re-read as text: not one identifier, path,
        # branch name or sentence from the transcripts may appear in it.
        emitted = json.dumps({"section": section, "counters": counters})
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


class FinalOpenIsDescriptorRootedTest(unittest.TestCase):
    """The check/open TOCTOU, in the two forms two review rounds found.

    ROUND 4, FINDING 4 — THE LEAF. Every symlink, type, and containment check
    the walk performed happened on a PATH, and the file was opened later with
    `Path.open()`, which follows whatever the leaf has become. The reviewer
    admitted a regular record, replaced it with a symlink pointing outside the
    configured root, and the production open read the outside target.

    ROUND 5, FINDING 1 — THE PARENT, and this is the one that mattered. The
    round-4 repair added `O_NOFOLLOW` to a PATH-BASED open, which constrains
    the FINAL component only. Everything above the leaf was still re-resolved
    from the filesystem root on every call, so the reviewer moved one level up:
    keep the leaf through the containment check, then rename its PARENT and put
    a symlink to an outside tree in its place. The later path-based `lstat`
    recorded the OUTSIDE file's identity, the open followed the intermediate
    link, and the identity "matched" — because both sides of the comparison had
    been taken through the attacker's path. An identity is only evidence when
    it is obtained through a capability the attacker cannot redirect.

    The fixture therefore nests the record one directory deep, so the parent
    swap has somewhere to happen. Every refusal below is paired with a
    non-vacuity case: the same call on an untouched tree must succeed.
    """

    def setUp(self):
        self.scratch = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.scratch, ignore_errors=True)
        self.root = os.path.join(self.scratch, "transcripts")
        # One directory deep on purpose: a flat fixture cannot express the
        # round-5 parent swap, and a test that cannot express the finding
        # cannot regress on it.
        self.inside = os.path.join(self.root, "inside")
        os.makedirs(self.inside)
        self.record = os.path.join(self.inside, "session.jsonl")
        with open(self.record, "w", encoding="utf-8") as handle:
            handle.write(transcript_line() + "\n")
        # The outside tree the reviewer redirected to: same shape, same file
        # name, different content, reachable only by escaping the root.
        self.elsewhere = os.path.join(self.scratch, "elsewhere")
        os.makedirs(self.elsewhere)
        self.outside = os.path.join(self.elsewhere, "session.jsonl")
        with open(self.outside, "w", encoding="utf-8") as handle:
            handle.write("a private file the producer must never read\n")

    def admit(self):
        counters = capture_usage_series.new_counters()
        admitted = capture_usage_series.admitted_records(self.root, counters)
        self.assertEqual(len(admitted), 1, "the fixture must admit exactly one record")
        return admitted[0], counters

    def test_the_admitted_record_is_rooted_and_carries_its_identity(self):
        (root, root_identity, components, identity), _ = self.admit()
        # The record names the ROOT plus single components, never a rebased
        # absolute path: that is what lets the open re-walk the chain instead
        # of re-resolving a name the attacker controls.
        self.assertEqual(root, self.root)
        self.assertEqual(components, ("inside", "session.jsonl"))
        for name in components:
            self.assertNotIn("/", name)
            self.assertNotIn(name, (".", ".."))
        anchor = os.lstat(self.root)
        self.assertEqual(root_identity, (anchor.st_dev, anchor.st_ino))
        info = os.lstat(self.record)
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
        # Round 4's probe: admit a regular file, then replace THE LEAF with a
        # symlink out of the tree before the open.
        record, counters = self.admit()
        os.unlink(self.record)
        os.symlink(self.outside, self.record)
        handle = capture_usage_series.open_record_file(record, counters)
        if handle is not None:
            with handle:
                content = handle.read()
            self.fail("the final open followed a post-check symlink swap and read %r" % content[:40])
        self.assertEqual(counters["symlinks"], 1)

    def test_a_post_check_parent_directory_swap_is_refused(self):
        # ROUND 5's probe, reproduced exactly as the reviewer described it:
        # keep the leaf through admission, then rename the parent and replace
        # it with a symlink to an outside tree holding a file of the same
        # name. Against the round-4 build this read the outside content and
        # the suite stayed green, because O_NOFOLLOW never looked above the
        # leaf and the identity had been taken through the swapped parent.
        record, counters = self.admit()
        os.rename(self.inside, os.path.join(self.root, "moved-away"))
        os.symlink(self.elsewhere, self.inside)
        handle = capture_usage_series.open_record_file(record, counters)
        if handle is not None:
            with handle:
                content = handle.read()
            self.fail(
                "the final open followed a swapped parent directory outside the root "
                "and read %r" % content[:40]
            )
        self.assertEqual(counters["symlinks"], 1)

    def test_a_post_check_root_swap_is_refused(self):
        # The same escape one level higher again. The root is opened by path
        # because it is the configured trust anchor, so the only thing that
        # can refuse a root swapped between the walk and the read is the
        # recorded root identity — which is why the record carries it.
        record, counters = self.admit()
        os.rename(self.root, os.path.join(self.scratch, "root-moved-away"))
        os.symlink(self.elsewhere, self.root)
        self.assertIsNone(capture_usage_series.open_record_file(record, counters))
        self.assertEqual(counters["symlinks"], 1)

    def test_an_intermediate_symlink_is_refused_even_when_it_resolves_to_the_same_file(self):
        # THE DECISIVE ROUND-5 TEST, and the reason the two swap tests above
        # are not enough on their own. Both of those are ALSO refused by a
        # path-based build, because the identity comparison happens to catch
        # them in this deterministic ordering — the reviewer's escape needed
        # the swap to land while the walk was between its containment check
        # and its stat, so that BOTH sides of the comparison were taken
        # through the attacker's path. A test cannot schedule that window.
        #
        # So this pins the property that closes it instead of the race that
        # exploits it: NO INTERMEDIATE COMPONENT IS EVER FOLLOWED. The link
        # here resolves back to the very directory that was admitted, so the
        # leaf is the same inode and every identity check in the world says
        # yes. Only a descent that refuses a link at each component says no,
        # which is why this is red against a path-based open and green only
        # for a descriptor-rooted one.
        record, counters = self.admit()
        moved = os.path.join(self.root, "moved-away")
        os.rename(self.inside, moved)
        os.symlink(moved, self.inside)
        handle = capture_usage_series.open_record_file(record, counters)
        if handle is not None:
            handle.close()
            self.fail(
                "the open followed an intermediate symlink; it was admitted only "
                "because the link happened to resolve inside the root, which is "
                "the attacker's choice rather than the producer's"
            )
        self.assertEqual(counters["symlinks"], 1)

    def test_an_intermediate_swap_for_a_real_directory_is_refused(self):
        # Not every substitution is a symlink. A genuine directory holding a
        # genuine file of the same name defeats O_NOFOLLOW at every component,
        # so the leaf identity is what refuses this one.
        record, counters = self.admit()
        os.rename(self.inside, os.path.join(self.root, "moved-away"))
        os.makedirs(self.inside)
        with open(self.record, "w", encoding="utf-8") as handle:
            handle.write("substituted content in a substituted directory\n")
        self.assertIsNone(capture_usage_series.open_record_file(record, counters))
        self.assertEqual(counters["symlinks"], 1)

    def test_a_symlinked_directory_is_never_walked_into(self):
        # The walk's own half of the same property: a link that is a
        # DIRECTORY is skipped rather than descended, so an outside tree
        # linked into the root contributes no records at all.
        os.symlink(self.elsewhere, os.path.join(self.root, "linked"))
        admitted = capture_usage_series.admitted_records(
            self.root, capture_usage_series.new_counters()
        )
        self.assertEqual(
            [record[2] for record in admitted], [("inside", "session.jsonl")]
        )

    def test_a_post_check_swap_for_a_different_regular_file_is_refused(self):
        # O_NOFOLLOW alone cannot see this one: the leaf is a perfectly
        # ordinary regular file, just not the file that was admitted. The
        # identity check is what catches it.
        #
        # The substitute is allocated BESIDE the record and renamed over it,
        # rather than the record being unlinked and rewritten in place, and
        # the ordering is the point. The identity is a (device, inode) PAIR,
        # and a filesystem is free to hand a file created after an unlink the
        # very inode number the unlinked file just released — ext4 does that
        # routinely, APFS does not. Under an in-place rewrite the outcome
        # therefore depends on the allocator rather than on the guard: this
        # test passed on macOS and failed on Linux CI for exactly that
        # reason. Allocating the substitute while the original is still alive
        # makes the two numbers necessarily distinct, so the property under
        # test is proven on every filesystem instead of on the ones whose
        # allocator happens to agree, and an atomic replace is the stronger
        # attack anyway — there is no window in which the path is missing.
        # The limit this leaves is real, is inherent to a (device, inode)
        # identity, and is stated at `_identity` in the producer.
        record, counters = self.admit()
        substitute = os.path.join(self.inside, "substitute")
        with open(substitute, "w", encoding="utf-8") as handle:
            handle.write("substituted content\n")
        os.replace(substitute, self.record)
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
        # until a writer appears, so a swapped-in fifo would hang this
        # scheduled unattended job forever. O_NONBLOCK makes the open return,
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


class LedgerBlockTest(unittest.TestCase):
    """The machine-local material block (issue #267).

    Two measurements the panel does not carry and the wire must never see: the
    day-indexed JOINT of model against accounting class at the full depth the
    walk partitions, and one entry per record FILE the walk billed a token to.
    Every test here answers one of three questions — is the joint a genuine
    refinement of the two partitions beside it, does a session entry carry the
    span and nothing else, and does the block stay off the wire.
    """

    MEMBER = None

    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.root = pathlib.Path(self.scratch.name) / "tree"
        self.root.mkdir()
        # Two named members and the residual, taken from the vocabulary file
        # rather than spelled, so this suite never becomes a fourth table.
        self.first = capture_usage_series.MODEL_KEYS[1]
        self.second = capture_usage_series.MODEL_KEYS[2]

    def write(self, name, *lines):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def record(self, stamp, identity, member=None, **usage):
        fields = {"input_tokens": 0, "output_tokens": 0,
                  "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
        fields.update(usage)
        message = {
            "id": "msg_%s" % identity,
            "usage": fields,
        }
        if member is not None:
            message["model"] = "avendor-%s" % member
        return transcript_line(timestamp=stamp, requestId="req_%s" % identity, message=message)

    def capture(self, today=datetime.date(2026, 8, 12)):
        section, counters = capture_usage_series.capture(
            self.root, capture_usage_series.FORMAT_MESSAGES, today=today
        )
        return section, counters

    def joint(self, section):
        block = section[capture_usage_series.LEDGER_KEY]
        return block[capture_usage_series.LEDGER_MODEL_CATEGORIES_KEY]

    def members(self, section):
        return {
            (row["model"], row["category"]): row["totals"]
            for row in self.joint(section)["members"]
        }

    def test_the_joint_refines_both_partitions_on_every_day_it_covers(self):
        # The whole claim of a joint: summing it over classes reproduces the
        # day's MODEL split, and summing it over models reproduces the day's
        # CLASS split. A cross-tabulation that merely summed to the day total
        # would satisfy an arithmetic identity while attributing one model's
        # cache reads to another.
        self.write(
            "one.jsonl",
            self.record("2026-08-10T10:00:00Z", "a", self.first, input_tokens=10, output_tokens=1),
            self.record("2026-08-10T11:00:00Z", "b", self.second, cache_read_input_tokens=100),
            self.record("2026-08-11T10:00:00Z", "c", self.first, cache_read_input_tokens=7),
        )
        section, _ = self.capture()
        cells = self.members(section)
        self.assertEqual(cells[(self.first, "input")], [10, 0])
        self.assertEqual(cells[(self.first, "output")], [1, 0])
        self.assertEqual(cells[(self.first, "cache-read")], [0, 7])
        self.assertEqual(cells[(self.second, "cache-read")], [100, 0])
        self.assertEqual(self.joint(section)["startDate"], "2026-08-10")
        # Re-derived here rather than described: both marginals, both days.
        models = {self.first: [11, 7], self.second: [100, 0]}
        categories = {"input": [10, 0], "output": [1, 0], "cache-read": [100, 7]}
        for index in range(2):
            by_model = {}
            by_category = {}
            for (member, key), totals in cells.items():
                by_model[member] = by_model.get(member, 0) + totals[index]
                by_category[key] = by_category.get(key, 0) + totals[index]
            self.assertEqual(by_model, {key: row[index] for key, row in models.items()})
            self.assertEqual(by_category, {key: row[index] for key, row in categories.items()})

    def test_a_pair_that_measured_nothing_is_not_a_member(self):
        # A member row of zeroes adds a pair to the tracker's vocabulary and
        # contributes exactly nothing; `day_indexed` drops the same shape on
        # the wire for the same reason.
        self.write(
            "one.jsonl",
            self.record("2026-08-10T10:00:00Z", "a", self.first, input_tokens=10),
        )
        section, _ = self.capture(today=datetime.date(2026, 8, 10))
        self.assertEqual(list(self.members(section)), [(self.first, "input")])

    def test_the_residual_is_a_legitimate_member_of_the_joint(self):
        # Tokens whose model the record never named are a real reading, not a
        # gap: the residual carries them here exactly as it does on the wire.
        self.write(
            "one.jsonl",
            self.record("2026-08-10T10:00:00Z", "a", input_tokens=5),
        )
        section, _ = self.capture(today=datetime.date(2026, 8, 10))
        self.assertEqual(
            list(self.members(section)), [(capture_usage_series.MODEL_OTHER, "input")]
        )

    def test_one_session_entry_per_file_that_billed_a_token(self):
        # One file is one session in both record shapes. A file that admitted
        # nothing gets no entry: it is a file the walk read and billed nothing
        # for, and a zero-token row says nothing at the cost of a row.
        self.write(
            "worked.jsonl",
            self.record("2026-08-10T09:00:00Z", "a", self.first, input_tokens=4),
            self.record("2026-08-10T17:30:45Z", "b", self.first, output_tokens=6),
        )
        self.write(
            "idle.jsonl",
            self.record("2026-08-10T12:00:00Z", "c", self.first),
        )
        section, _ = self.capture(today=datetime.date(2026, 8, 10))
        sessions = section[capture_usage_series.LEDGER_KEY]["sessions"]
        self.assertEqual(len(sessions), 1)
        self.assertEqual(
            sessions[0],
            {
                "startedAt": "2026-08-10T09:00:00Z",
                "endedAt": "2026-08-10T17:30:45Z",
                "total": 10,
                "categories": {"input": 4, "output": 6},
                "models": [self.first],
            },
        )

    def test_a_replayed_record_counts_in_the_file_it_was_first_seen_in(self):
        # The message shape's de-duplication is GLOBAL across the walk, so a
        # record replayed into a second file is already spent by the time the
        # second file is read. The docstring says so; this proves it.
        self.write(
            "first.jsonl",
            self.record("2026-08-10T09:00:00Z", "a", self.first, input_tokens=4),
        )
        self.write(
            "second.jsonl",
            self.record("2026-08-10T09:00:00Z", "a", self.first, input_tokens=4),
            self.record("2026-08-10T10:00:00Z", "b", self.first, input_tokens=6),
        )
        section, counters = self.capture(today=datetime.date(2026, 8, 10))
        sessions = section[capture_usage_series.LEDGER_KEY]["sessions"]
        self.assertEqual([entry["total"] for entry in sessions], [4, 6])
        self.assertEqual(counters["duplicates"], 1)

    def test_a_session_carries_a_span_and_never_an_identifier(self):
        # The whole leak set of the record shape, re-read as text out of the
        # block: not one identifier, path, branch name or sentence survives.
        self.write(
            "one.jsonl",
            self.record("2026-08-10T09:00:00Z", "a", self.first, input_tokens=4),
        )
        section, _ = self.capture(today=datetime.date(2026, 8, 10))
        emitted = json.dumps(section[capture_usage_series.LEDGER_KEY])
        for leak in (
            "a-private-project",
            "someone",
            "secret-feature",
            "11111111-2222-3333-4444-555555555555",
            "sessionId",
            "cwd",
            "gitBranch",
            "nobody outside this machine",
            "one.jsonl",
        ):
            with self.subTest(leak=leak):
                self.assertNotIn(leak, emitted)

    def test_the_span_is_utc_to_the_second_whatever_the_record_spells(self):
        # Sub-second precision is dropped rather than rounded, and an offset
        # instant is converted rather than trusted: the span is a duration and
        # is measured on the one clock that never steps.
        self.write(
            "one.jsonl",
            self.record("2026-08-10T02:30:00.987654+02:00", "a", self.first, input_tokens=4),
            self.record("2026-08-10T23:59:59.500Z", "b", self.first, output_tokens=1),
        )
        section, _ = self.capture(today=datetime.date(2026, 8, 10))
        session = section[capture_usage_series.LEDGER_KEY]["sessions"][0]
        self.assertEqual(session["startedAt"], "2026-08-10T00:30:00Z")
        self.assertEqual(session["endedAt"], "2026-08-10T23:59:59Z")

    def test_a_span_is_taken_from_the_extremes_not_from_the_file_order(self):
        # A journal is appended to, but an out-of-order record would otherwise
        # invert a span and produce a negative duration downstream.
        self.write(
            "one.jsonl",
            self.record("2026-08-10T18:00:00Z", "a", self.first, input_tokens=4),
            self.record("2026-08-10T06:00:00Z", "b", self.first, output_tokens=1),
        )
        section, _ = self.capture(today=datetime.date(2026, 8, 10))
        session = section[capture_usage_series.LEDGER_KEY]["sessions"][0]
        self.assertEqual(session["startedAt"], "2026-08-10T06:00:00Z")
        self.assertEqual(session["endedAt"], "2026-08-10T18:00:00Z")

    def test_the_running_totals_shape_produces_the_same_session_shape(self):
        # One file is one session in BOTH shapes, and the entry is the same
        # object either way — the ledger has one definition, not two.
        self.write(
            "one.jsonl",
            session_meta_line(),
            turn_model_line("avendor-%s" % self.first, stamp="2026-08-23T11:00:00Z"),
            running_totals_line("2026-08-23T11:30:00Z", total_tokens=10, input_tokens=10),
            running_totals_line("2026-08-23T12:45:30Z", total_tokens=30, input_tokens=30),
        )
        section, _ = capture_usage_series.capture(
            self.root,
            capture_usage_series.FORMAT_RUNNING_TOTALS,
            today=datetime.date(2026, 8, 23),
        )
        self.assertEqual(
            section[capture_usage_series.LEDGER_KEY]["sessions"],
            [
                {
                    "startedAt": "2026-08-23T11:30:00Z",
                    "endedAt": "2026-08-23T12:45:30Z",
                    "total": 30,
                    "categories": {"input": 30},
                    "models": [self.first],
                }
            ],
        )

    def test_a_joint_that_refines_neither_split_is_refused(self):
        """The marginal guard, exercised directly.

        By construction the walk cannot produce a joint that disagrees with
        the splits it was accumulated beside — which is exactly why the guard
        is checked here rather than only implied by the walk: a construction
        check nobody can redden is `assert_partition` without the test that
        makes it a check.
        """
        member = capture_usage_series.MODEL_KEYS[1]
        members = [{"model": member, "category": "input", "totals": [5]}]
        # Truthful on both marginals: admitted.
        capture_usage_series.assert_joint_marginals(
            members, [0], {"input": [5]}, {member: [5]}
        )
        for name, categories, models, needle in (
            ("a model split it does not reproduce", {"input": [5]}, {member: [6]}, "model split"),
            ("a class split it does not reproduce", {"input": [6]}, {member: [5]}, "category split"),
            (
                "a model the day's split does not carry",
                {"input": [5]},
                {capture_usage_series.MODEL_KEYS[2]: [5]},
                "names a model",
            ),
            (
                "a class the day's split does not carry",
                {"output": [5]},
                {member: [5]},
                "names a category",
            ),
        ):
            with self.subTest(name=name):
                with self.assertRaises(CaptureError) as raised:
                    capture_usage_series.assert_joint_marginals(
                        members, [0], categories, models
                    )
                self.assertIn(needle, str(raised.exception))

    def test_the_ledger_never_reaches_the_wire(self):
        # The guard refuses the key BY NAME wherever it appears, because a
        # capture legitimately produces it and an export must legitimately
        # strip it before anything is sealed.
        self.write(
            "one.jsonl",
            self.record("2026-08-10T09:00:00Z", "a", self.first, input_tokens=4),
        )
        section, _ = self.capture(today=datetime.date(2026, 8, 10))
        with self.assertRaises(CaptureError) as raised:
            capture_usage_series.assert_only_dates_and_integers(section, "section")
        self.assertIn("never reaches the wire", str(raised.exception))
        # Nested just as firmly: the refusal is the KEY, not its position.
        with self.assertRaises(CaptureError):
            capture_usage_series.assert_only_dates_and_integers(
                {"series": {capture_usage_series.LEDGER_KEY: {}}}, "section"
            )

    def test_the_joint_is_absent_rather_than_empty_when_it_owns_no_day(self):
        # An ordinary pruning run reaches this: the history store overrides
        # every day the fresh walk partitioned, so the joint would refine
        # splits this document no longer serves. Absent is the honest state,
        # and the sessions beside it are still a measurement worth keeping.
        store = pathlib.Path(self.scratch.name) / "store.json"
        self.write(
            "one.jsonl",
            self.record("2026-08-10T09:00:00Z", "a", self.first, input_tokens=4),
            self.record("2026-08-10T10:00:00Z", "b", self.first, input_tokens=6),
        )
        capture_usage_series.capture(
            self.root,
            capture_usage_series.FORMAT_MESSAGES,
            today=datetime.date(2026, 8, 10),
            history_store=store,
        )
        # The second walk measures less than the store remembers, so the
        # store wins the only day there is.
        self.write(
            "one.jsonl",
            self.record("2026-08-10T09:00:00Z", "a", self.first, input_tokens=4),
        )
        section, _ = capture_usage_series.capture(
            self.root,
            capture_usage_series.FORMAT_MESSAGES,
            today=datetime.date(2026, 8, 10),
            history_store=store,
        )
        block = section[capture_usage_series.LEDGER_KEY]
        self.assertNotIn(capture_usage_series.LEDGER_MODEL_CATEGORIES_KEY, block)
        self.assertEqual(len(block["sessions"]), 1)
        capture_usage_series.assert_ledger_block(block)


class LedgerGuardTest(unittest.TestCase):
    """Every rule assert_ledger_block states has an input that breaks it.

    The block is the ONE section that emits an instant and a vocabulary key as
    values, so it answers to its own guard rather than widening the wire's. A
    guard no input can redden is decoration, and this one stands between a
    transcript tree and a file on the owner's disk.
    """

    def block(self, **overrides):
        member = capture_usage_series.MODEL_KEYS[1]
        document = {
            "schema": capture_usage_series.LEDGER_SCHEMA,
            "modelCategories": {
                "startDate": "2026-08-10",
                "members": [{"model": member, "category": "input", "totals": [1, 2]}],
            },
            "sessions": [
                {
                    "startedAt": "2026-08-10T09:00:00Z",
                    "endedAt": "2026-08-11T10:00:00Z",
                    "total": 3,
                    "categories": {"input": 3},
                    "models": [member],
                }
            ],
        }
        document.update(overrides)
        return document

    def test_the_template_is_admitted(self):
        # Or every case below refuses for the wrong reason.
        capture_usage_series.assert_ledger_block(self.block())

    def refuses(self, block, needle):
        with self.assertRaises(CaptureError) as raised:
            capture_usage_series.assert_ledger_block(block)
        self.assertIn(needle, str(raised.exception))

    def test_a_section_outside_the_declared_shape(self):
        self.refuses(self.block(cwd="/home/someone"), "outside its declared shape")
        self.refuses(self.block(sessions=None) | {"sessions": {}}, "no session list")

    def test_a_schema_marker_this_code_does_not_understand(self):
        self.refuses(self.block(schema="usage-capture-ledger/v2"), "expected schema")

    def test_a_joint_field_outside_the_declared_shape(self):
        block = self.block()
        block["modelCategories"]["sessionId"] = "11111111"
        self.refuses(block, "outside its declared shape")

    def test_a_joint_without_a_calendar_start(self):
        block = self.block()
        block["modelCategories"]["startDate"] = "2026-99-99"
        self.refuses(block, "calendar start date")

    def test_a_joint_member_outside_either_vocabulary(self):
        block = self.block()
        block["modelCategories"]["members"][0]["model"] = "private-feature"
        self.refuses(block, "model outside the vocabulary")
        block = self.block()
        block["modelCategories"]["members"][0]["category"] = "private-class"
        self.refuses(block, "class outside the vocabulary")

    def test_one_joint_pair_declared_twice(self):
        block = self.block()
        block["modelCategories"]["members"].append(
            dict(block["modelCategories"]["members"][0])
        )
        self.refuses(block, "declared twice")

    def test_a_joint_figure_that_is_not_a_bounded_count(self):
        for value in (-1, True, "3", 1.5, capture_usage_series.MAX_COUNT + 1):
            with self.subTest(value=value):
                block = self.block()
                block["modelCategories"]["members"][0]["totals"] = [value]
                self.refuses(block, "a ledger joint member carries")

    def test_a_session_field_outside_the_declared_shape(self):
        block = self.block()
        block["sessions"][0]["sessionId"] = "11111111-2222-3333-4444-555555555555"
        self.refuses(block, "outside its declared shape")

    def test_a_session_span_that_is_not_an_rfc_3339_utc_second(self):
        for spelling in (
            "2026-08-10T09:00:00+02:00",
            "2026-08-10T09:00:00.500Z",
            "2026-08-10",
            "2026-99-99T09:00:00Z",
            "2026-08-10T09:00:00Z\n",
            17,
        ):
            with self.subTest(spelling=spelling):
                block = self.block()
                block["sessions"][0]["startedAt"] = spelling
                self.refuses(block, "RFC 3339 instant")

    def test_a_session_that_ends_before_it_starts(self):
        block = self.block()
        block["sessions"][0]["endedAt"] = "2026-08-09T09:00:00Z"
        self.refuses(block, "ends before it starts")

    def test_a_session_partition_past_its_own_total(self):
        block = self.block()
        block["sessions"][0]["categories"] = {"input": 4}
        self.refuses(block, "sums past the session's own total")

    def test_a_session_naming_a_model_twice_or_outside_the_vocabulary(self):
        block = self.block()
        block["sessions"][0]["models"] = ["private-feature"]
        self.refuses(block, "model outside the vocabulary")
        block = self.block()
        member = capture_usage_series.MODEL_KEYS[1]
        block["sessions"][0]["models"] = [member, member]
        self.refuses(block, "names a model twice")

    def test_a_session_class_outside_the_vocabulary(self):
        block = self.block()
        block["sessions"][0]["categories"] = {"private-class": 1}
        self.refuses(block, "class outside the vocabulary")


class LongestSessionTest(unittest.TestCase):
    """One definition, two ways of measuring it (issue #267).

    The span from a session's first admitted record to its last. The tool's
    own roll-up reports exactly that in milliseconds where it reports it at
    all; the walk measures the identical quantity where it does not.
    """

    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.root = pathlib.Path(self.scratch.name) / "tree"
        self.root.mkdir()
        self.cache = pathlib.Path(self.scratch.name) / "cache.json"
        self.member = capture_usage_series.MODEL_KEYS[1]

    def write_tree(self, *stamps):
        lines = []
        for index, stamp in enumerate(stamps):
            lines.append(
                transcript_line(
                    timestamp=stamp,
                    requestId="req_%d" % index,
                    message={
                        "id": "msg_%d" % index,
                        "model": "avendor-%s" % self.member,
                        "usage": {"input_tokens": 10},
                    },
                )
            )
        (self.root / "one.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")

    def write_cache(self, **overrides):
        document = {
            capture_usage_series.ACTIVITY_CACHE_DAILY_KEY: [],
            capture_usage_series.ACTIVITY_CACHE_USAGE_KEY: {
                "avendor-%s" % self.member: {
                    "inputTokens": 1,
                    "outputTokens": 2,
                    "cacheReadInputTokens": 3,
                    "cacheCreationInputTokens": 4,
                }
            },
            capture_usage_series.ACTIVITY_CACHE_SESSIONS_KEY: 5,
            capture_usage_series.ACTIVITY_CACHE_COMPUTED_KEY: "2026-08-12",
        }
        document.update(overrides)
        self.cache.write_text(json.dumps(document), encoding="utf-8")
        return self.cache

    def capture(self, cache=None):
        section, _ = capture_usage_series.capture(
            self.root,
            capture_usage_series.FORMAT_MESSAGES,
            cache,
            today=datetime.date(2026, 8, 12),
        )
        return section["stats"][capture_usage_series.STAT_LONGEST_SESSION]

    def test_the_cache_figure_floors_milliseconds_to_seconds(self):
        # A tile is a magnitude; rounding a duration up reports a second the
        # record does not show.
        self.write_tree("2026-08-10T09:00:00Z", "2026-08-10T09:00:10Z")
        cache = self.write_cache(
            **{capture_usage_series.ACTIVITY_CACHE_LONGEST_KEY: {"duration": 150_946_999}}
        )
        self.assertEqual(self.capture(cache), 150_946)

    def test_a_cache_with_no_such_record_falls_back_to_the_walk(self):
        # Absent is a state: the walk measures the identical quantity, so the
        # tile fills rather than freezing.
        self.write_tree("2026-08-10T09:00:00Z", "2026-08-10T11:00:00Z")
        self.assertEqual(self.capture(self.write_cache()), 7_200)

    def test_a_corrupt_cache_duration_refuses_the_run(self):
        # Broken is not absent. Quietly preferring the weaker measurement
        # would publish a figure while hiding the fault that produced it.
        self.write_tree("2026-08-10T09:00:00Z", "2026-08-10T11:00:00Z")
        for duration in (-1, True, "many", 1.5):
            with self.subTest(duration=duration):
                cache = self.write_cache(
                    **{capture_usage_series.ACTIVITY_CACHE_LONGEST_KEY: {"duration": duration}}
                )
                with self.assertRaises(CaptureError) as raised:
                    self.capture(cache)
                self.assertIn("longest-session duration", str(raised.exception))

    def test_the_walk_takes_the_maximum_span_over_every_session(self):
        # The LONGEST, not the newest and not the first.
        (self.root / "short.jsonl").write_text(
            transcript_line(
                timestamp="2026-08-10T09:00:00Z",
                requestId="req_s1",
                message={"id": "msg_s1", "usage": {"input_tokens": 1}},
            )
            + "\n"
            + transcript_line(
                timestamp="2026-08-10T09:30:00Z",
                requestId="req_s2",
                message={"id": "msg_s2", "usage": {"input_tokens": 1}},
            )
            + "\n",
            encoding="utf-8",
        )
        self.write_tree("2026-08-11T00:00:00Z", "2026-08-11T05:00:00Z")
        self.assertEqual(self.capture(), 18_000)

    def test_both_paths_measure_the_same_definition(self):
        # The equality is the point of the tile: a source with a roll-up and
        # a source without one report the same quantity, so the two tiles are
        # comparable rather than merely adjacent.
        self.write_tree("2026-08-10T09:00:00Z", "2026-08-10T11:00:00Z")
        walked = self.capture()
        cache = self.write_cache(
            **{capture_usage_series.ACTIVITY_CACHE_LONGEST_KEY: {"duration": walked * 1000}}
        )
        self.assertEqual(self.capture(cache), walked)


class ModelStatsTest(unittest.TestCase):
    """The per-model lifetime classes (issue #267).

    The four class tiles say what the account spent on cache reads; this says
    which MODEL spent them. Raw identifiers fold through the vocabulary
    exactly as every other model identifier does, and the invariant the origin
    enforces is `Σ members ≤ the class tile`.
    """

    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.root = pathlib.Path(self.scratch.name) / "tree"
        self.root.mkdir()
        self.cache = pathlib.Path(self.scratch.name) / "cache.json"
        self.member = capture_usage_series.MODEL_KEYS[1]
        (self.root / "one.jsonl").write_text(
            transcript_line(
                timestamp="2026-08-12T09:00:00Z",
                requestId="req_a",
                message={
                    "id": "msg_a",
                    "model": "avendor-%s" % self.member,
                    "usage": {"input_tokens": 10, "output_tokens": 5},
                },
            )
            + "\n",
            encoding="utf-8",
        )

    def capture(self, usage, as_of="2026-08-12"):
        self.cache.write_text(
            json.dumps(
                {
                    capture_usage_series.ACTIVITY_CACHE_DAILY_KEY: [],
                    capture_usage_series.ACTIVITY_CACHE_USAGE_KEY: usage,
                    capture_usage_series.ACTIVITY_CACHE_SESSIONS_KEY: 5,
                    capture_usage_series.ACTIVITY_CACHE_COMPUTED_KEY: as_of,
                }
            ),
            encoding="utf-8",
        )
        section, _ = capture_usage_series.capture(
            self.root,
            capture_usage_series.FORMAT_MESSAGES,
            self.cache,
            today=datetime.date(2026, 8, 12),
        )
        return section

    def rows(self, section):
        return {row["key"]: row["totals"] for row in section["modelStats"]}

    def test_two_identifiers_folding_to_one_member_are_summed(self):
        section = self.capture(
            {
                "avendor-%s" % self.member: {"inputTokens": 3, "outputTokens": 0,
                                             "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0},
                "bvendor-%s" % self.member: {"inputTokens": 4, "outputTokens": 0,
                                             "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0},
            }
        )
        self.assertEqual(self.rows(section)[self.member]["input"], 7)

    def test_a_member_that_measured_nothing_is_dropped(self):
        section = self.capture(
            {
                "avendor-%s" % self.member: {"inputTokens": 3, "outputTokens": 0,
                                             "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0},
                "an-unnamed-identifier": {"inputTokens": 0, "outputTokens": 0,
                                          "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0},
            }
        )
        rows = self.rows(section)
        self.assertEqual(list(rows), [self.member])
        # A class that measured nothing is dropped inside the member too.
        self.assertEqual(set(rows[self.member]), {"input"})

    def test_the_emitted_shape_is_one_the_whole_pipeline_admits(self):
        """ONE SHAPE IN FOUR PLACES (PR #312 review, finding 1).

        A class the member never spent is ABSENT on the wire, never a zero —
        the origin's stated contract. The producer drops a nought class, the
        exporter's merge admission and the origin admit the subset, and the
        page reads the absence as the zero it is. Each of the four reads this
        one fixture in its own tests; the page once required all four
        classes and refused the WHOLE payload over a member the origin had
        served truthfully, and no suite could see the two disagree.
        """
        fixture = pathlib.Path(__file__).resolve().parents[2] / "internal" / "panels" / "testdata" / "model-stats-shapes.json"
        shapes = json.loads(fixture.read_text(encoding="utf-8"))
        self.assertEqual(shapes["schema"], "model-stats-shapes/v1")
        section = self.capture(
            {
                "avendor-%s" % self.member: {"inputTokens": 10, "outputTokens": 5,
                                             "cacheReadInputTokens": 100, "cacheCreationInputTokens": 0},
            }
        )
        emitted = self.rows(section)[self.member]
        self.assertEqual(emitted, {"input": 10, "output": 5, "cache-read": 100})
        self.assertIn(emitted, [shape["totals"] for shape in shapes["admitted"]])
        # The producer's own emission rules, applied to every shape in the
        # file — this is what makes its suite a fourth voice on shapes it never
        # emits itself (round 2 found the fixture pinning shapes and not the
        # vocabulary; a producer test that checked only its own emission was
        # green for a reasoning shape or a nought shape listed on the wrong
        # side). It emits a class only from the closed vocabulary, only as a
        # positive integer, and never a member with no class: every admitted
        # shape is one it COULD emit and no refused shape is, and every class
        # the vocabulary names is exercised by some admitted shape.
        def emittable(totals):
            return bool(totals) and all(
                name in capture_usage_series.CATEGORY_KEYS and type(value) is int and value > 0
                for name, value in totals.items()
            )
        for shape in shapes["admitted"]:
            self.assertTrue(emittable(shape["totals"]), "%s: admitted but never emittable" % shape["name"])
        for shape in shapes["refused"]:
            self.assertFalse(emittable(shape["totals"]), "%s: refused but emittable" % shape["name"])
        self.assertEqual(
            {name for shape in shapes["admitted"] for name in shape["totals"]},
            set(capture_usage_series.CATEGORY_KEYS),
            "some class of the vocabulary is exercised by no admitted shape",
        )

    def test_an_unnamed_identifier_lands_on_the_residual(self):
        # A legitimate member here, not a defect: model churn is constant and
        # the residual already means exactly this.
        section = self.capture(
            {
                "a-vendor-nobody-declared": {"inputTokens": 9, "outputTokens": 0,
                                             "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0},
            }
        )
        self.assertEqual(
            self.rows(section)[capture_usage_series.MODEL_OTHER]["input"], 9
        )

    def test_the_rows_are_served_in_vocabulary_order(self):
        section = self.capture(
            {
                "avendor-%s" % capture_usage_series.MODEL_KEYS[2]: {
                    "inputTokens": 1, "outputTokens": 0,
                    "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0},
                "avendor-%s" % capture_usage_series.MODEL_KEYS[1]: {
                    "inputTokens": 1, "outputTokens": 0,
                    "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0},
            }
        )
        self.assertEqual(
            [row["key"] for row in section["modelStats"]],
            [capture_usage_series.MODEL_KEYS[1], capture_usage_series.MODEL_KEYS[2]],
        )

    def test_days_after_the_as_of_day_accrue_per_model_through_the_joint(self):
        # The SAME accrual the class tiles get (issue #288), split the way the
        # records split them — which is exactly why the joint had to exist.
        section = self.capture(
            {
                "avendor-%s" % self.member: {"inputTokens": 3, "outputTokens": 1,
                                             "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0},
            },
            as_of="2026-08-11",
        )
        rows = self.rows(section)
        self.assertEqual(rows[self.member], {"input": 13, "output": 6})
        self.assertEqual(section["stats"]["input"], 13)
        self.assertEqual(section["stats"]["output"], 6)

    def test_the_split_never_attributes_more_than_the_class_tile(self):
        # The invariant the origin enforces, checked on the producer's own
        # output across both accrual states.
        for as_of in ("2026-08-11", "2026-08-12"):
            with self.subTest(as_of=as_of):
                section = self.capture(
                    {
                        "avendor-%s" % self.member: {"inputTokens": 3, "outputTokens": 1,
                                                     "cacheReadInputTokens": 0,
                                                     "cacheCreationInputTokens": 0},
                        "a-vendor-nobody-declared": {"inputTokens": 2, "outputTokens": 0,
                                                     "cacheReadInputTokens": 0,
                                                     "cacheCreationInputTokens": 0},
                    },
                    as_of=as_of,
                )
                summed = {}
                for row in section["modelStats"]:
                    for key, value in row["totals"].items():
                        summed[key] = summed.get(key, 0) + value
                for key, value in summed.items():
                    self.assertLessEqual(value, section["stats"][key])

    def test_the_wire_guard_admits_the_section(self):
        # `modelStats` is the one place the wire carries an identifier as a
        # VALUE, admitted by membership of the closed vocabulary rather than
        # by shape — so a label-shaped private identifier still refuses.
        section = self.capture(
            {
                "avendor-%s" % self.member: {"inputTokens": 3, "outputTokens": 0,
                                             "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0},
            }
        )
        wire = {key: value for key, value in section.items()
                if key != capture_usage_series.LEDGER_KEY}
        capture_usage_series.assert_only_dates_and_integers(wire, "section")
        with self.assertRaises(CaptureError) as raised:
            capture_usage_series.assert_only_dates_and_integers(
                {"modelStats": [{"key": "private-feature", "totals": {"input": 1}}]},
                "section",
            )
        self.assertIn("not a calendar date", str(raised.exception))
        # And the permission is re-seeded false inside a list, exactly as the
        # recorded flag's is.
        with self.assertRaises(CaptureError):
            capture_usage_series.assert_only_dates_and_integers(
                {"modelStats": [{"key": [self.member], "totals": {"input": 1}}]},
                "section",
            )


if __name__ == "__main__":
    unittest.main()
