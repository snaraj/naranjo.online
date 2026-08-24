"""Contract tests for the runtime usage-series export step.

The module under test lives one directory up, at
`scripts/export_usage_series.py`, beside the capture tool it imports; its test
lives HERE because the gate discovers tests with `-s scripts/ci`. It is loaded
by path so neither directory has to become a package.

Three contracts carry the weight:

* **The import surface is closed.** Owner ruling on issue #142: the export
  step must be STRUCTURALLY incapable of spawning an agent session or
  touching a network — proven here against the module's AST, not its
  behavior, so the capability cannot be reintroduced without turning this
  file red.
* **Requirement 12.** The transcript tree is full of prompts, paths, session
  identifiers and branch names; the emission may contain calendar dates and
  non-negative integers under machine-shaped keys, nothing else. The hostile
  fixtures here are deliberately full of things to leak.
* **Parity with the capture tool.** The export's per-category series must sum
  to exactly the series `capture_usage_series.py` computes over the same
  tree — the runtime document and the embedded snapshot are one measurement
  or they are two claims that can disagree.
"""

from __future__ import annotations

import ast
import contextlib
import datetime
import importlib.util
import io
import json
import os
import pathlib
import re
import tempfile
import unittest

_MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "export_usage_series.py"
_SPEC = importlib.util.spec_from_file_location("export_usage_series", _MODULE_PATH)
export_usage_series = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(export_usage_series)

# The export module imports the capture tool itself; testing against THAT
# instance keeps exception identity and parity honest.
capture = export_usage_series.capture
CaptureError = capture.CaptureError

# Sentinels a leak would carry. Each appears in the fixture tree; none may
# appear in any emission.
LEAK_SESSION = "11111111-2222-3333-4444-555555555555"
LEAK_PATH = "/home/someone/work/a-private-project"
LEAK_BRANCH = "someone/secret-feature"
LEAK_PROSE = "a sentence nobody outside this machine may read"


def transcript_line(**overrides):
    """One realistic assistant record, deliberately full of things to leak."""
    record = {
        "type": "assistant",
        "timestamp": "2026-08-10T12:00:00.000Z",
        "requestId": "req_aaaaaaaaaaaa",
        "sessionId": LEAK_SESSION,
        "cwd": LEAK_PATH,
        "gitBranch": LEAK_BRANCH,
        "message": {
            "id": "msg_aaaaaaaaaaaa",
            "role": "assistant",
            "content": [{"type": "text", "text": LEAK_PROSE}],
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


def write_tree(root, files):
    """Lay out {relative path: [lines]} under root."""
    for relative, lines in files.items():
        path = os.path.join(root, relative)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")


def merge_document(**overrides):
    """A well-formed two-day merge source in the capture tool's stdout shape."""
    document = {
        "series": {"startDate": "2026-08-10", "totals": [30, 10], "recorded": True},
        "derived": {"peak-day": 30, "current-streak": 2, "longest-streak": 2},
        "categories": {
            "input": [10, 4],
            "output": [5, 3],
            "cache-read": [15, 3],
        },
        "windows": {
            "today": {"input": 7, "output": 3},
            "week": {"input": 25, "output": 8},
        },
    }
    document.update(overrides)
    return document


def collect_strings(value, into):
    """Every string reachable in a JSON value — keys and values alike."""
    if isinstance(value, str):
        into.append(value)
    elif isinstance(value, list):
        for item in value:
            collect_strings(item, into)
    elif isinstance(value, dict):
        for key, item in value.items():
            into.append(key)
            collect_strings(item, into)


class ImportSurfaceTest(unittest.TestCase):
    """Owner ruling: structurally incapable of spawning or networking."""

    def setUp(self):
        self.source = _MODULE_PATH.read_text(encoding="utf-8")
        self.tree = ast.parse(self.source)

    def imported_names(self):
        names = set()
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    names.add(alias.name)
            elif isinstance(node, ast.ImportFrom):
                names.add(node.module or "")
        return names

    def test_import_surface_is_exactly_the_closed_allowlist(self):
        # Closed EQUALITY, not a subset check: adding any import — however
        # innocent — must be a conscious edit to this exact set.
        self.assertEqual(
            self.imported_names(),
            {
                "__future__",
                "argparse",
                "datetime",
                "json",
                "os",
                "sys",
                "capture_usage_series",
            },
        )

    def test_no_process_network_or_loader_capability_is_named(self):
        # Belt over the braces: even if the allowlist above were widened,
        # naming any spawn/network/loader module anywhere in the file is a
        # separate refusal. Matched against source bytes so a string-built
        # __import__ argument is caught too.
        for forbidden in (
            "subprocess",
            "socket",
            "urllib",
            "http",
            "ctypes",
            "importlib",
            "multiprocessing",
            "pty",
            "signal",
            "webbrowser",
        ):
            self.assertNotIn(forbidden, self.source)

    def test_no_dynamic_code_or_import_calls(self):
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                self.assertNotIn(
                    node.func.id, {"eval", "exec", "compile", "__import__"}
                )

    def test_no_process_capable_os_attribute_is_touched(self):
        # os is imported for walk/path/expanduser; the process-capable corner
        # of the module is individually refused.
        forbidden = {
            "system",
            "popen",
            "fork",
            "forkpty",
            "kill",
            "execv",
            "execve",
            "execvp",
            "execvpe",
            "execl",
            "execle",
            "execlp",
            "execlpe",
            "spawnl",
            "spawnle",
            "spawnlp",
            "spawnlpe",
            "spawnv",
            "spawnve",
            "spawnvp",
            "spawnvpe",
            "posix_spawn",
            "posix_spawnp",
            "startfile",
        }
        for node in ast.walk(self.tree):
            if (
                isinstance(node, ast.Attribute)
                and isinstance(node.value, ast.Name)
                and node.value.id == "os"
            ):
                self.assertNotIn(node.attr, forbidden)


class ReduceCategoryLineTest(unittest.TestCase):
    def reduce(self, line, seen=None, counters=None):
        return export_usage_series.reduce_category_line(
            line, set() if seen is None else seen, counters or capture.new_counters()
        )

    def test_reduces_to_day_and_per_category_amounts(self):
        day, amounts = self.reduce(transcript_line())
        self.assertEqual(day, "2026-08-10")
        self.assertEqual(
            amounts,
            {"input": 10, "output": 5, "cache-read": 100, "cache-write": 20},
        )

    def test_absent_zero_negative_and_boolean_fields_contribute_nothing(self):
        line = transcript_line(
            message={
                "id": "msg_b",
                "usage": {
                    "input_tokens": 0,
                    "output_tokens": -5,
                    "cache_read_input_tokens": True,
                },
            }
        )
        day, amounts = self.reduce(line)
        self.assertEqual(day, "2026-08-10")
        self.assertEqual(amounts, {})

    def test_duplicate_identity_is_dropped_and_tallied(self):
        seen = set()
        counters = capture.new_counters()
        first = self.reduce(transcript_line(), seen, counters)
        second = self.reduce(transcript_line(), seen, counters)
        self.assertIsNotNone(first)
        self.assertIsNone(second)
        self.assertEqual(counters["duplicates"], 1)

    def test_missing_identity_is_counted_not_deduplicated(self):
        seen = set()
        line = transcript_line(
            requestId=None,
            message={"usage": {"input_tokens": 3}},
        )
        self.assertIsNotNone(self.reduce(line, seen))
        self.assertIsNotNone(self.reduce(line, seen))

    def test_malformed_lines_reduce_to_none(self):
        for line in (
            "",
            "not json",
            json.dumps(["a", "list"]),
            json.dumps({"timestamp": "2026-08-10T12:00:00Z"}),
            json.dumps({"message": {"usage": {}}}),
            transcript_line(timestamp=12345),
            transcript_line(timestamp="not a timestamp"),
        ):
            self.assertIsNone(self.reduce(line))


class CategorySeriesTest(unittest.TestCase):
    def test_builds_contiguous_partitioned_series(self):
        pairs = [
            ("2026-08-10", {"input": 10, "output": 5}),
            ("2026-08-12", {"cache-read": 7}),
            ("2026-08-10", {"input": 1}),
        ]
        series, categories = export_usage_series.category_series(pairs)
        self.assertEqual(series["startDate"], "2026-08-10")
        self.assertEqual(series["totals"], [16, 0, 7])
        self.assertTrue(series["recorded"])
        self.assertEqual(categories["input"], [11, 0, 0])
        self.assertEqual(categories["output"], [5, 0, 0])
        self.assertEqual(categories["cache-read"], [0, 0, 7])
        self.assertEqual(categories["cache-write"], [0, 0, 0])
        export_usage_series.assert_partition(series, categories)

    def test_empty_walk_is_a_refusal(self):
        with self.assertRaises(CaptureError):
            export_usage_series.category_series([])

    def test_over_long_span_is_refused_like_the_capture_tool(self):
        pairs = [("2020-01-01", {"input": 1}), ("2026-01-01", {"input": 1})]
        with self.assertRaises(CaptureError):
            export_usage_series.category_series(pairs)

    def test_partition_violation_is_a_refusal(self):
        series = {"startDate": "2026-08-10", "totals": [10], "recorded": True}
        categories = {"input": [9]}
        with self.assertRaises(CaptureError):
            export_usage_series.assert_partition(series, categories)


class CaptureParityTest(unittest.TestCase):
    """The runtime document and the embedded snapshot are ONE measurement."""

    def test_category_series_sums_to_the_capture_tools_series(self):
        with tempfile.TemporaryDirectory() as root:
            write_tree(
                root,
                {
                    "a-project/one.jsonl": [
                        transcript_line(),
                        transcript_line(),  # replayed duplicate
                        transcript_line(
                            timestamp="2026-08-12T03:00:00Z",
                            requestId="req_b",
                            message={
                                "id": "msg_b",
                                "usage": {"output_tokens": 40},
                            },
                        ),
                        "not json at all",
                    ],
                    "b-project/nested/two.jsonl": [
                        transcript_line(
                            timestamp="2026-08-10T23:59:59Z",
                            requestId="req_c",
                            message={
                                "id": "msg_c",
                                "usage": {
                                    "input_tokens": 2,
                                    "cache_creation_input_tokens": 8,
                                },
                            },
                        ),
                    ],
                    "ignored.txt": ["never read"],
                },
            )
            capture_counters = capture.new_counters()
            capture_series = capture.daily_series(
                capture.read_records(root, capture_counters)
            )
            export_counters = capture.new_counters()
            series, categories = export_usage_series.category_series(
                export_usage_series.read_category_records(root, export_counters)
            )
        self.assertEqual(series, capture_series)
        self.assertEqual(export_counters, capture_counters)
        export_usage_series.assert_partition(series, categories)


class WindowsTest(unittest.TestCase):
    def fixture(self):
        series = {"startDate": "2026-08-10", "totals": [135, 0, 47], "recorded": True}
        categories = {
            "input": [10, 0, 0],
            "output": [5, 0, 40],
            "cache-read": [100, 0, 0],
            "cache-write": [20, 0, 7],
        }
        return series, categories

    def test_today_counts_the_capture_days_own_bucket(self):
        series, categories = self.fixture()
        windows = export_usage_series.windows_from(
            series, categories, datetime.date(2026, 8, 12)
        )
        self.assertEqual(windows["today"], {"input": 7, "output": 40})
        self.assertEqual(windows["week"], {"input": 137, "output": 45})

    def test_days_outside_the_record_contribute_zero(self):
        series, categories = self.fixture()
        windows = export_usage_series.windows_from(
            series, categories, datetime.date(2026, 8, 20)
        )
        # No recorded usage today or in the last seven days: an honest zero.
        self.assertEqual(windows["today"], {"input": 0, "output": 0})
        self.assertEqual(windows["week"], {"input": 0, "output": 0})

    def test_window_vocabulary_is_closed(self):
        series, categories = self.fixture()
        windows = export_usage_series.windows_from(
            series, categories, datetime.date(2026, 8, 12)
        )
        self.assertEqual(set(windows), {"today", "week"})


class SourceKeyTest(unittest.TestCase):
    def test_label_shaped_keys_are_admitted(self):
        for key in ("a", "codex", "tool-two", "a1-b2", "x" * 32):
            self.assertTrue(export_usage_series.valid_source_key(key), key)

    def test_everything_else_is_refused(self):
        for key in (
            "",
            "Upper",
            "1leading",
            "-leading",
            "has space",
            "has/slash",
            "has.dot",
            "x" * 33,
            "img src=x",
        ):
            self.assertFalse(export_usage_series.valid_source_key(key), key)


class MergeSourceTest(unittest.TestCase):
    def load(self, document):
        with tempfile.TemporaryDirectory() as scratch:
            path = os.path.join(scratch, "merge.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(document, handle)
            return export_usage_series.load_merge_source(path)

    def test_well_formed_document_is_admitted_in_full(self):
        section = self.load(merge_document())
        self.assertEqual(section["series"]["totals"], [30, 10])
        self.assertEqual(section["categories"]["cache-read"], [15, 3])
        self.assertEqual(section["windows"]["today"], {"input": 7, "output": 3})
        self.assertEqual(section["derived"]["peak-day"], 30)

    def test_series_and_derived_alone_are_enough(self):
        document = merge_document()
        del document["categories"]
        del document["windows"]
        section = self.load(document)
        self.assertNotIn("categories", section)
        self.assertNotIn("windows", section)

    def test_hostile_documents_are_refused(self):
        cases = {
            "not an object": ["a", "list"],
            "unknown section": merge_document(notes="prose"),
            "missing series": {"derived": {"peak-day": 1}},
            "unrecorded series": merge_document(
                series={"startDate": "2026-08-10", "totals": [1], "recorded": False}
            ),
            "path-shaped start date": merge_document(
                series={"startDate": LEAK_PATH, "totals": [1], "recorded": True}
            ),
            "empty totals": merge_document(
                series={"startDate": "2026-08-10", "totals": [], "recorded": True}
            ),
            "negative total": merge_document(
                series={"startDate": "2026-08-10", "totals": [-1, 2], "recorded": True}
            ),
            "boolean total": merge_document(
                series={"startDate": "2026-08-10", "totals": [True, 2], "recorded": True}
            ),
            "over-long series": merge_document(
                series={
                    "startDate": "2020-01-01",
                    "totals": [0] * (capture.MAX_SERIES_DAYS + 1),
                    "recorded": True,
                }
            ),
            "path-shaped category key": merge_document(
                categories={LEAK_PATH: [30, 10]}
            ),
            "hostile markup category key": merge_document(
                categories={"<img src=x onerror=alert(1)>": [30, 10]}
            ),
            "short category": merge_document(categories={"input": [30]}),
            "negative category": merge_document(categories={"input": [30, -10]}),
            "non-partitioning categories": merge_document(
                categories={"input": [1, 1]}
            ),
            "unknown window": merge_document(
                windows={"lifetime": {"input": 1, "output": 1}}
            ),
            "malformed window": merge_document(windows={"today": {"input": 1}}),
            "prose in window": merge_document(
                windows={"today": {"input": LEAK_PROSE, "output": 1}}
            ),
            "unknown derived key": merge_document(derived={"sessions": 4}),
            "prose in derived": merge_document(derived={"peak-day": LEAK_PROSE}),
        }
        for name, document in cases.items():
            with self.subTest(name):
                with self.assertRaises(CaptureError):
                    self.load(document)


class ExportTest(unittest.TestCase):
    def tree(self, root):
        write_tree(
            root,
            {
                "a-private-project/session.jsonl": [
                    transcript_line(),
                    transcript_line(
                        timestamp="2026-08-11T09:00:00Z",
                        requestId="req_b",
                        message={"id": "msg_b", "usage": {"output_tokens": 3}},
                    ),
                ]
            },
        )

    def test_export_emits_only_dates_and_integers(self):
        with tempfile.TemporaryDirectory() as root:
            self.tree(root)
            sources, counters = export_usage_series.export(
                root, "alpha", [], datetime.date(2026, 8, 11)
            )
        self.assertEqual(set(sources), {"alpha"})
        section = sources["alpha"]
        self.assertEqual(section["series"]["totals"], [135, 3])
        self.assertEqual(section["categories"]["output"], [5, 3])
        self.assertEqual(section["windows"]["today"], {"input": 0, "output": 3})
        self.assertEqual(section["derived"]["current-streak"], 2)
        self.assertEqual(counters["counted"], 2)
        strings = []
        collect_strings(sources, strings)
        for value in strings:
            self.assertTrue(
                capture.DAY_PATTERN.match(value) or capture.KEY_PATTERN.match(value),
                value,
            )
        emitted = json.dumps(sources)
        for leak in (LEAK_SESSION, LEAK_PATH, LEAK_BRANCH, LEAK_PROSE):
            self.assertNotIn(leak, emitted)

    def test_export_runs_the_capture_tools_guard_over_the_full_payload(self):
        # The wiring proof: the SHIPPED guard sees the complete sources
        # payload before export returns. Without this, every structural
        # check above could pass while the last line of defence went dead.
        observed = []
        original = capture.assert_only_dates_and_integers

        def recording(value, where="emission"):
            observed.append((value, where))
            return original(value, where)

        capture.assert_only_dates_and_integers = recording
        try:
            with tempfile.TemporaryDirectory() as root:
                self.tree(root)
                sources, _counters = export_usage_series.export(
                    root, "alpha", [], datetime.date(2026, 8, 11)
                )
        finally:
            capture.assert_only_dates_and_integers = original
        self.assertIn((sources, "sources"), observed)

    def test_merge_source_joins_under_its_own_key(self):
        with tempfile.TemporaryDirectory() as root:
            self.tree(root)
            merge_path = os.path.join(root, "..", "merge.json")
            merge_path = os.path.abspath(merge_path)
            with open(merge_path, "w", encoding="utf-8") as handle:
                json.dump(merge_document(), handle)
            try:
                sources, _counters = export_usage_series.export(
                    root, "alpha", [("beta", merge_path)], datetime.date(2026, 8, 11)
                )
            finally:
                os.remove(merge_path)
        self.assertEqual(set(sources), {"alpha", "beta"})
        self.assertEqual(sources["beta"]["series"]["totals"], [30, 10])

    def test_colliding_source_keys_are_refused(self):
        with tempfile.TemporaryDirectory() as root:
            self.tree(root)
            merge_path = os.path.join(root, "merge.json")
            with open(merge_path, "w", encoding="utf-8") as handle:
                json.dump(merge_document(), handle)
            with self.assertRaises(CaptureError):
                export_usage_series.export(
                    root, "alpha", [("alpha", merge_path)], datetime.date(2026, 8, 11)
                )


class MainTest(unittest.TestCase):
    def run_main(self, argv):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = export_usage_series.main(argv)
        return code, stdout.getvalue(), stderr.getvalue()

    def tree(self, root):
        write_tree(root, {"p/one.jsonl": [transcript_line()]})

    def test_writes_the_document_with_schema_and_instant(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = os.path.join(scratch, "transcripts")
            self.tree(root)
            out = os.path.join(scratch, "usage.json")
            code, stdout, stderr = self.run_main(
                ["--transcripts", root, "--source", "alpha", "--out", out]
            )
            self.assertEqual(code, 0)
            self.assertEqual(stdout, "")
            with open(out, "r", encoding="utf-8") as handle:
                document = json.load(handle)
        self.assertEqual(document["schema"], "usage-series/v1")
        self.assertRegex(
            document["generatedAt"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$"
        )
        self.assertEqual(set(document["sources"]), {"alpha"})
        # Diagnostics are counts, never paths.
        self.assertRegex(
            stderr.strip(),
            r"^files=\d+ unreadable=\d+ lines=\d+ counted=\d+ duplicates=\d+ sources=\d+$",
        )

    def test_prints_to_stdout_when_no_out_file_is_given(self):
        with tempfile.TemporaryDirectory() as root:
            self.tree(root)
            code, stdout, _stderr = self.run_main(
                ["--transcripts", root, "--source", "alpha"]
            )
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(stdout)["schema"], "usage-series/v1")

    def test_missing_tree_and_malformed_arguments_fail_closed(self):
        with tempfile.TemporaryDirectory() as root:
            self.tree(root)
            missing = os.path.join(root, "absent")
            cases = [
                (["--transcripts", missing, "--source", "alpha"], 2),
                (["--transcripts", root, "--source", "Not A Label"], 2),
                (["--transcripts", root, "--source", "alpha", "--merge-source", "nofile"], 2),
                (
                    ["--transcripts", root, "--source", "alpha", "--merge-source", "BAD=f"],
                    2,
                ),
                (["--transcripts", root, "--source", "alpha", "--merge-source", "b="], 2),
                (
                    [
                        "--transcripts",
                        root,
                        "--source",
                        "alpha",
                        "--merge-source",
                        "beta=" + os.path.join(root, "no-such-merge.json"),
                    ],
                    1,
                ),
            ]
            for argv, expected in cases:
                with self.subTest(" ".join(argv)):
                    code, _stdout, stderr = self.run_main(argv)
                    self.assertEqual(code, expected)
                    # No refusal message names a path.
                    self.assertNotIn(root, stderr)

    def test_hostile_merge_source_refuses_the_whole_run(self):
        with tempfile.TemporaryDirectory() as root:
            self.tree(root)
            merge_path = os.path.join(root, "merge.json")
            with open(merge_path, "w", encoding="utf-8") as handle:
                json.dump(merge_document(derived={"peak-day": LEAK_PROSE}), handle)
            out = os.path.join(root, "usage.json")
            code, _stdout, stderr = self.run_main(
                [
                    "--transcripts",
                    root,
                    "--source",
                    "alpha",
                    "--merge-source",
                    "beta=" + merge_path,
                    "--out",
                    out,
                ]
            )
            self.assertEqual(code, 1)
            self.assertFalse(os.path.exists(out))
            self.assertNotIn(LEAK_PROSE, stderr)


if __name__ == "__main__":
    unittest.main()
