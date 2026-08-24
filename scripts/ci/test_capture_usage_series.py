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

import importlib.util
import json
import os
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
