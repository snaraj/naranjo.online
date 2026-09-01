"""Contract tests for the runtime usage-series export step.

The module under test lives one directory up, at
`scripts/export_usage_series.py`, beside the capture tool it imports; its test
lives HERE because the gate discovers tests with `-s scripts/ci`. It is loaded
by path so neither directory has to become a package.

Three contracts carry the weight:

* **The import surface is closed — and that is a review bound, not the
  capability guarantee.** The owner's ruling on issue #142 is that the export
  step must be STRUCTURALLY unable to spawn an agent session or touch a
  network. What enforces that is the kernel sandbox the scheduled job starts
  the producer inside (`scripts/usage-export/producer.sb`, pinned in
  `test_usage_export_scripts.py`) — and the enforced capability is exactly
  its two denials, no fork and no network. Exec-in-place and filesystem
  access remain, as the profile says; the ruling is met because a session
  needs one of the two denied things, not because the step is confined in
  general. What THIS file pins is the reviewed import
  surface: a closed allowlist held against a refused set, so widening it is a
  conscious edit naming the module that got in. The two are not the same
  claim, and the 2026-08-24 round-3 review is why they are now stated
  separately — see `ImportSurfaceTest`.
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
import time
import unittest


def setUpModule():
    # The capture buckets records into the WORKSTATION-LOCAL calendar day
    # (issue #276), so day expectations here depend on the process timezone;
    # TZ=UTC pins the suite deterministic on every machine, exactly as
    # test_capture_usage_series.py pins it. The local-day decision itself is
    # proven there, in LocalDayTest, under explicitly staged zones.
    os.environ["TZ"] = "UTC"
    time.tzset()

_MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "export_usage_series.py"
_SPEC = importlib.util.spec_from_file_location("export_usage_series", _MODULE_PATH)
if _SPEC is None or _SPEC.loader is None:
    # Both are Optional, and both being None means the same thing: the module
    # under test is not where this suite says it is. Saying so by name beats
    # an AttributeError on None two lines later, which reads as a broken test
    # rather than a missing subject. The same repair landed in
    # test_capture_usage_series.py and was claimed for this file too; it had
    # not (2026-08-26 round-5 review, finding 4).
    raise ImportError("the export step is not loadable at %s" % _MODULE_PATH)
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


# The instant every merge fixture claims it was captured at, and the clock
# the tests hand the loader. Both are required now: a merge source without
# its own capture instant is refused, because a second tool's series can be
# arbitrarily older than the export carrying it (2026-08-24 round-3 review,
# finding 5).
MERGE_CAPTURED_AT = "2026-08-11T09:00:00Z"
MERGE_NOW = datetime.datetime(2026, 8, 11, 10, 0, 0, tzinfo=datetime.timezone.utc)


def merge_document(**overrides):
    """A well-formed two-day merge source in the capture tool's stdout shape."""
    document = {
        "generatedAt": MERGE_CAPTURED_AT,
        "series": {"startDate": "2026-08-10", "totals": [30, 10], "recorded": True},
        "derived": {
            "peak-day": 30,
            "current-streak": 2,
            "longest-streak": 2,
            "active-days": 2,
            "tracked-days": 2,
        },
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


def merge_section(days, value):
    """A COMPLETE merge source at a given span and per-category magnitude.

    Complete because a section is now whole or refused: its own capture
    instant, the full category vocabulary partitioning the totals, the full
    window vocabulary, and the full derived vocabulary (2026-08-24 round-3
    review, finding 5).
    """
    return {
        "generatedAt": MERGE_CAPTURED_AT,
        "series": {
            "startDate": "2024-01-01",
            "totals": [value * len(capture.CATEGORY_KEYS)] * days,
            "recorded": True,
        },
        "categories": {key: [value] * days for key in capture.CATEGORY_KEYS},
        "windows": {
            "today": {"input": value, "output": value},
            "week": {"input": value, "output": value},
        },
        "derived": {
            "peak-day": value * len(capture.CATEGORY_KEYS),
            "current-streak": days,
            "longest-streak": days,
            "active-days": days,
            "tracked-days": days,
        },
    }


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


def imported_roots(tree):
    """Every top-level module name a parsed tree imports, under any spelling.

    Roots, not dotted names: `import os.path` and `from os import walk` both
    reduce to `os`, so the closed sets below cannot be evaded by reaching for
    a submodule. A relative import carries no module name, reads as the empty
    root, and is refused by the closed-allowlist comparison.
    """
    roots = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                roots.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            roots.add((node.module or "").split(".")[0])
    return roots


class ImportSurfaceTest(unittest.TestCase):
    """The REVIEWED IMPORT SURFACE, held closed — and honest about its limit.

    What this class proves: the producer imports exactly the allowed set, that
    set is disjoint from a refused set of process/network/loader modules, and
    the capture tool it imports is held to the same refused set — so the
    transitive reviewed surface cannot be widened in either file without an
    edit here that names the module which got in. Adding `import os` turns
    this class red, so it is not decorative.

    What this class does NOT prove, stated because two earlier revisions
    claimed it did: that the producer is incapable of spawning a process. A
    lint over import NAMES cannot establish that. `pathlib` is on the
    allowlist and the module object it binds re-exports `os`, so
    `pathlib.os.system(":")` reaches the launch callable with the import set
    unchanged and every test here green — the exact mutant the 2026-08-24
    round-3 review flew through. `sys.modules["os"]` is the same hole spelled
    differently, and any admitted module that itself imports `os` reopens it.
    `test_the_import_pin_cannot_prove_capability_absence` demonstrates the
    hole so the limit stays legible, and the capability itself is denied by
    the kernel sandbox at the invocation layer
    (`scripts/usage-export/producer.sb`; enforcement pinned, and on Darwin
    EXECUTED, in `test_usage_export_scripts.py`).

    `os` stays REFUSED in THIS module (2026-08-24 round-2 finding 1): an
    earlier pin admitted `os` for the walk and denied the literal
    `os.<spawn>` attribute spellings, which a computed
    `getattr(os, "sys" + "tem")` walked straight past. Keeping the module off
    this file's surface means an `os.` call site cannot appear here without a
    deliberate widening — a review property, which is what a lint can
    honestly be.

    The capture tool it imports is a documented EXCEPTION as of the
    2026-08-25 round-4 review (finding 4), widened by round 5 (finding 1).
    Round 4 admitted `os` for `O_NOFOLLOW` and a descriptor `fstat` on the
    FINAL open; round 5 established that this closed only the last component
    and that the whole traversal has to be descriptor-rooted, which needs
    `dir_fd`, `O_DIRECTORY`, `os.listdir` and `os.lstat` as well. Python
    exposes none of it outside `os`; refusing the import would have meant
    keeping a real filesystem escape to preserve a smaller surface that —
    since round 3 — no longer carries a capability claim anyway, because the
    enforced boundary is the kernel sandbox. That file carries an
    enumerated `os.` ATTRIBUTE allowlist in its own suite, and the assertion
    below pins the exception to exactly one module in exactly one file.
    """

    ALLOWED = frozenset(
        {
            "__future__",
            "argparse",
            "capture_usage_series",
            "datetime",
            "json",
            "pathlib",
            "sys",
        }
    )

    # Not an exhaustive index of the standard library — it does not need to
    # be, because the allowlist above already refuses everything not named in
    # it. This set exists so the ALLOWLIST ITSELF cannot be widened to admit
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
            "os",
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

    def setUp(self):
        self.source = _MODULE_PATH.read_text(encoding="utf-8")
        self.tree = ast.parse(self.source)

    def test_import_surface_is_exactly_the_closed_allowlist(self):
        # Closed EQUALITY, not a subset check: adding any import — however
        # innocent — must be a conscious edit to this exact set.
        self.assertEqual(imported_roots(self.tree), set(self.ALLOWED))

    def test_the_allowlist_admits_nothing_that_can_spawn_or_connect(self):
        # Guards the allowlist against itself. Without this, widening the set
        # above by one line would make every other assertion here pass.
        self.assertEqual(self.ALLOWED & self.REFUSED, frozenset())

    def test_no_refused_module_is_imported_under_any_spelling(self):
        self.assertEqual(imported_roots(self.tree) & self.REFUSED, frozenset())

    def test_the_pin_refuses_an_os_import_itself(self):
        # The exact mutant the 2026-08-24 review survived, now killed at its
        # root: re-admitting `os` — with or without a computed
        # getattr(os, "sys" + "tem") beneath it — must turn this suite red on
        # the IMPORT, before any attribute spelling is even considered.
        mutant = ast.parse(
            'import os\n\n\ndef launch():\n    return getattr(os, "sys" + "tem")\n'
            + self.source
        )
        self.assertEqual(imported_roots(mutant) & self.REFUSED, {"os"})
        self.assertNotEqual(imported_roots(mutant), set(self.ALLOWED))

    def test_the_import_pin_cannot_prove_capability_absence(self):
        # The limit of this whole class, pinned so nobody re-derives the
        # overstatement the 2026-08-24 round-3 review killed. `pathlib` is an
        # ALLOWED import and its module object re-exports `os`, so the launch
        # callable is reachable from the exact import set above. If this ever
        # stops holding, the honest claim in the docstrings changed and both
        # must be revisited together — which is why it is asserted rather
        # than merely written down.
        self.assertIn("pathlib", self.ALLOWED)
        reachable = getattr(pathlib, "os", None)
        self.assertIsNotNone(
            reachable, "pathlib no longer re-exports os; revisit the honest claim")
        self.assertTrue(
            callable(getattr(reachable, "system", None)),
            "the launch callable is reachable through an allowed import; the "
            "no-spawn guarantee is the sandbox's, never this pin's",
        )
        # And the module says so: the producer's own docstring must not claim
        # the guarantee this pin cannot give.
        self.assertIn("producer.sb", self.source)
        self.assertNotIn("Structurally incapable of spawning", self.source)

    def test_the_pin_is_reading_a_real_import_surface(self):
        # Non-vacuity: an assertion about a set that turned out to be empty
        # would pass for the wrong reason forever.
        self.assertIn("json", imported_roots(self.tree))
        self.assertGreater(len(imported_roots(self.tree)), 3)

    def test_no_process_network_or_loader_capability_is_named(self):
        # Belt over the braces: even if the allowlist above were widened,
        # naming any spawn/network/loader module anywhere in the file is a
        # separate refusal. Matched against source bytes so a string-built
        # __import__ argument is caught too. (`os` is absent from this list
        # on purpose — it is a substring of ordinary English words like
        # "most" and "close"; its refusal is the structural import check
        # above, which no spelling can evade.)
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

    def test_the_transitive_producer_surface_stays_reviewed(self):
        # This module imports the capture tool, so the capture tool's import
        # surface IS part of this program's reviewed surface. Pinning it here
        # means a widening THERE cannot silently give the exporter a reach
        # its own allowlist forbids.
        #
        # `os` is the one deliberate divergence between the two allowlists
        # (2026-08-25 round-4 review finding 4, widened by round-5 finding
        # 1): the capture tool's transcript walk is descriptor-rooted, which
        # needs `dir_fd`, `O_NOFOLLOW`, `O_DIRECTORY`, `os.listdir` and
        # `os.lstat`, and Python exposes none of it elsewhere. THIS module
        # still neither imports it nor may name it. The divergence is stated as an
        # explicit exception rather than by widening this file's refused set,
        # so it cannot spread by accident — and the capture tool's own suite
        # holds the enumerated `os.` attribute allowlist that replaced
        # refusing the import outright.
        capture_tree = ast.parse(
            (_MODULE_PATH.parent / "capture_usage_series.py").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(
            imported_roots(capture_tree) & self.REFUSED, frozenset({"os"})
        )
        # And the exception is exactly one module wide, in exactly one file.
        self.assertNotIn("os", imported_roots(self.tree))


class SharedWalkTest(unittest.TestCase):
    """The two programs read the transcripts through ONE reader.

    This module used to carry its own copy of the walk, the reduction, the
    day index, the partition check and the window arithmetic. Every one of
    them was a second statement of something the capture tool already said,
    and the parity test that lived here existed only to keep the two copies
    agreeing. They are the capture tool's now, so the agreement is
    structural; what remains worth asserting is that this module really does
    reach for them rather than quietly growing a copy back.
    """

    def test_this_module_defines_no_second_walk_or_vocabulary(self):
        source = _MODULE_PATH.read_text(encoding="utf-8")
        for redefinition in (
            "def read_category_records",
            "def reduce_category_line",
            "def category_series",
            "def assert_partition",
            "def windows_from",
            "CATEGORY_FIELDS = (",
        ):
            self.assertNotIn(
                redefinition,
                source,
                "%s belongs to the capture tool; a copy here is a second "
                "statement of the same rule" % redefinition,
            )

    def test_the_window_vocabulary_is_the_capture_tools_own(self):
        self.assertIs(export_usage_series.WINDOW_TODAY, capture.WINDOW_TODAY)
        self.assertIs(export_usage_series.WINDOW_WEEK, capture.WINDOW_WEEK)

    def test_one_walk_produces_the_aggregate_and_both_breakdowns(self):
        # The property the deleted parity test was reaching for, asserted
        # where it actually lives: the totals, the categories and the models
        # come out of one pass over one tree and agree with each other by
        # construction.
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
                            message={"id": "msg_b", "usage": {"output_tokens": 40}},
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
            section, counters = capture.capture(
                root, capture.FORMAT_MESSAGES, None, datetime.date(2026, 8, 12)
            )
        totals = section["series"]["totals"]
        self.assertEqual(section["series"]["startDate"], "2026-08-10")
        self.assertEqual(totals, [145, 0, 40])
        self.assertEqual(counters["duplicates"], 1)
        # Categories partition every day of the series, in both directions.
        capture.assert_partition(totals, section["categories"], 0)
        self.assertEqual(
            section["categories"],
            {
                "input": [12, 0, 0],
                "output": [5, 0, 40],
                "cache-read": [100, 0, 0],
                "cache-write": [28, 0, 0],
            },
        )
        # No record here names a model, so the models section is absent
        # rather than a residual row that repeats the aggregate.
        self.assertNotIn("models", section)


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
        windows = capture.windows_from(series, categories, 0, datetime.date(2026, 8, 12))
        self.assertEqual(windows["today"], {"input": 7, "output": 40})
        self.assertEqual(windows["week"], {"input": 137, "output": 45})

    def test_days_outside_the_record_contribute_zero(self):
        series, categories = self.fixture()
        windows = capture.windows_from(series, categories, 0, datetime.date(2026, 8, 20))
        # No recorded usage today or in the last seven days: an honest zero.
        self.assertEqual(windows["today"], {"input": 0, "output": 0})
        self.assertEqual(windows["week"], {"input": 0, "output": 0})

    def test_a_windowed_breakdown_makes_no_claim_before_it_starts(self):
        # The categories cover only the trailing two days here. The first
        # day's total is known and its SPLIT is not, so a window figure that
        # reaches back to it reads zero rather than inventing a division.
        series = {"startDate": "2026-08-10", "totals": [135, 0, 47], "recorded": True}
        categories = {"input": [0, 7], "output": [0, 40]}
        windows = capture.windows_from(series, categories, 1, datetime.date(2026, 8, 12))
        self.assertEqual(windows["today"], {"input": 7, "output": 40})
        self.assertEqual(windows["week"], {"input": 7, "output": 40})

    def test_window_vocabulary_is_closed(self):
        series, categories = self.fixture()
        windows = capture.windows_from(series, categories, 0, datetime.date(2026, 8, 12))
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
            return export_usage_series.load_merge_source(path, MERGE_NOW)

    def test_well_formed_document_is_admitted_in_full(self):
        section, captured = self.load(merge_document())
        self.assertEqual(section["series"]["totals"], [30, 10])
        self.assertEqual(section["categories"]["cache-read"], [15, 3])
        self.assertEqual(section["windows"]["today"], {"input": 7, "output": 3})
        self.assertEqual(section["derived"]["peak-day"], 30)
        # The source's OWN capture instant travels with it, and it is the
        # file's, never the export run's (2026-08-24 round-3 finding 5).
        self.assertEqual(captured.strftime(export_usage_series.INSTANT_FORMAT),
                         MERGE_CAPTURED_AT)

    def test_a_windowed_breakdown_is_admitted_against_its_declared_start(self):
        # The section covers a TRAILING window of the series and says so. Its
        # rows are exactly that long and partition exactly the days it claims.
        document = merge_document(
            categories={"input": [4], "output": [3], "cache-read": [3]},
            categoriesStartDate="2026-08-11",
        )
        section, _captured = self.load(document)
        self.assertEqual(section["categoriesStartDate"], "2026-08-11")
        self.assertEqual(section["categories"]["input"], [4])

    def test_a_models_section_is_admitted_against_the_closed_vocabulary(self):
        member = capture.MODEL_KEYS[1]
        other = capture.MODEL_OTHER
        section, _captured = self.load(
            merge_document(models={member: [30, 4], other: [0, 6]})
        )
        self.assertEqual(section["models"][member], [30, 4])
        self.assertEqual(section["models"][other], [0, 6])

    def test_a_breakdown_key_outside_its_vocabulary_refuses_the_document(self):
        # MEMBERSHIP, never label shape: `private-feature` is perfectly
        # label-shaped and would render publicly if admitted.
        for name, document in (
            ("category", merge_document(categories={"private-feature": [30, 10]})),
            ("model", merge_document(models={"private-feature": [30, 10]})),
            # A category key is not a model key and the reverse holds too:
            # two vocabularies, one admitter, no cross-admission.
            ("crossed", merge_document(models={"input": [30, 10]})),
        ):
            with self.subTest(name):
                with self.assertRaises(CaptureError):
                    self.load(document)

    def test_a_breakdown_that_does_not_partition_refuses_in_both_directions(self):
        for name, rows in (
            ("under", {capture.MODEL_KEYS[1]: [29, 10]}),
            ("over", {capture.MODEL_KEYS[1]: [31, 10]}),
        ):
            with self.subTest(name):
                with self.assertRaises(CaptureError):
                    self.load(merge_document(models=rows))

    def test_a_breakdown_window_outside_the_series_refuses(self):
        for name, document in (
            ("before the series", merge_document(categoriesStartDate="2026-08-09")),
            ("past its end", merge_document(categoriesStartDate="2026-08-20")),
            (
                "aligned but spelled out",
                # There is exactly ONE spelling of "aligned": omit the field.
                merge_document(categoriesStartDate="2026-08-10"),
            ),
            ("not a calendar day", merge_document(categoriesStartDate="2026-99-99")),
            (
                "declared with no section",
                merge_document(modelsStartDate="2026-08-11"),
            ),
        ):
            with self.subTest(name):
                with self.assertRaises(CaptureError):
                    self.load(document)

    def test_the_model_window_is_bounded_where_the_categories_window_is_not(self):
        # The per-model rows cost one integer per day per member, so they
        # carry their own day bound; the aggregate's categories answer only
        # to the series bound.
        days = capture.MAX_MODEL_DAYS + 1
        document = merge_section(days, 1)
        document["models"] = {capture.MODEL_KEYS[1]: [
            sum(1 for _ in capture.CATEGORY_KEYS)] * days}
        with self.assertRaises(CaptureError) as caught:
            self.load(document)
        self.assertIn("day bound", str(caught.exception))

    def test_the_complete_window_and_derived_sets_are_required(self):
        # This test asserts the OPPOSITE of what it asserted before the
        # 2026-08-24 round-3 review. `windows` and `derived` used to be
        # optional per source, and an omitted section left the release-time
        # figure rendered beside a runtime series under one envelope instant
        # — release-age and runtime-age numbers described by one
        # `generatedAt`, which is the mixing finding 5 named. A section is a
        # WHOLE section now, and the origin enforces the same rule.
        for name, mutate in {
            "windows omitted": lambda d: d.pop("windows"),
            "derived omitted": lambda d: d.pop("derived"),
            "a window omitted": lambda d: d["windows"].pop("week"),
            "a derived figure omitted": lambda d: d["derived"].pop("longest-streak"),
        }.items():
            with self.subTest(name):
                document = merge_document()
                mutate(document)
                with self.assertRaises(CaptureError):
                    self.load(document)

    def test_a_source_without_its_own_capture_instant_is_refused(self):
        # The whole point of finding 5: a merged source is captured by a
        # separate run and can be arbitrarily older than the export carrying
        # it. Without its own instant, the combined document stamped
        # everything with the export's `now` and relabelled stale data as
        # current.
        for name, document in {
            "absent": merge_document(),
            "malformed": merge_document(generatedAt="yesterday"),
            "not a string": merge_document(generatedAt=17),
            "in the future": merge_document(generatedAt="2026-08-11T10:00:01Z"),
        }.items():
            if name == "absent":
                del document["generatedAt"]
            with self.subTest(name):
                with self.assertRaises(CaptureError):
                    self.load(document)

    def test_a_merge_source_past_the_byte_bound_is_refused_before_parsing(self):
        # 2026-08-24 round-3 finding 10: the merge input was handed whole to
        # json.load, so an operator-configured path to a large file was an
        # unbounded parse in the scheduled producer. The bound is checked on
        # the READ, before any parse.
        with tempfile.TemporaryDirectory() as scratch:
            path = os.path.join(scratch, "huge.json")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write("[" + "0," * export_usage_series.MAX_MERGE_BYTES + "0]")
            with self.assertRaises(CaptureError) as caught:
                export_usage_series.load_merge_source(path, MERGE_NOW)
            self.assertIn("byte bound", str(caught.exception))
            self.assertNotIn(scratch, str(caught.exception))

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
            # MEMBERSHIP, not shape (2026-08-24 review finding H1): these
            # keys are perfectly label-shaped, the original guard ADMITTED
            # them, and each would then pass Go admission and render publicly
            # as panel copy. The closed category vocabulary must refuse them.
            "label-shaped private category key": merge_document(
                categories={"private-feature": [30, 10]}
            ),
            "label-shaped project category key": merge_document(
                categories={"internal-project-name": [30, 10]}
            ),
            # Real calendar membership (2026-08-24 review finding H1): both
            # satisfy the digit shape, and re.match's `$` tolerated the
            # trailing newline.
            "impossible calendar start date": merge_document(
                series={"startDate": "2026-99-99", "totals": [30, 10], "recorded": True}
            ),
            "newline-suffixed start date": merge_document(
                series={"startDate": "2026-08-10\n", "totals": [30, 10], "recorded": True}
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
            # The captured-stats section (issue #276): optional as a section,
            # closed and count-bounded per key like every other figure.
            "stats not an object": merge_document(stats=[1]),
            "empty stats section": merge_document(stats={}),
            "stats key outside the vocabulary": merge_document(stats={"window-total": 1}),
            "prose in stats": merge_document(stats={"lifetime": LEAK_PROSE}),
            "negative stat": merge_document(stats={"lifetime": -1}),
            "boolean stat": merge_document(stats={"lifetime": True}),
            "stat over the shared count bound": merge_document(
                stats={"lifetime": capture.MAX_COUNT + 1}
            ),
        }
        for name, document in cases.items():
            with self.subTest(name):
                with self.assertRaises(CaptureError):
                    self.load(document)

    def test_a_stats_section_is_admitted_against_the_closed_vocabulary(self):
        # The positive half of the issue-#276 section: vocabulary members
        # ride through verbatim, and an ABSENT section stays absent — which
        # tiles a source owes is the origin's call, measured against its own
        # snapshot inventory, not this loader's.
        section, _captured = self.load(merge_document(stats={"lifetime": 99, "sessions": 4}))
        self.assertEqual(section["stats"], {"lifetime": 99, "sessions": 4})
        section, _captured = self.load(merge_document())
        self.assertNotIn("stats", section)


class LifetimeBaselineTest(unittest.TestCase):
    """The one-time baselines table and its accrual rule (issue #276).

    A vendor whose full accounting never reaches this machine leaves a
    lifetime figure local data cannot reconstruct — retention floors mean
    the local record starts long after the vendor's own count did. The
    owner-sanctioned correction is a committed baseline (the vendor
    surface's own reading, with the local day it was read on) from which the
    figure tracks as baseline plus every day captured STRICTLY after that
    day. The as-of day itself never re-accrues: most of it is already inside
    the reading, and the honest residual is the sliver of that one evening
    after it — permanently excluded rather than double-counted.
    """

    REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

    def write_table(self, scratch, document):
        path = pathlib.Path(scratch) / "baselines.json"
        path.write_text(json.dumps(document), encoding="utf-8")
        return path

    def table(self, baselines):
        return {"schema": export_usage_series.BASELINES_SCHEMA, "baselines": baselines}

    def test_the_shipped_table_is_loadable_and_carries_the_sanctioned_baseline(self):
        # The committed table IS the owner ruling of 2026-09-01: the vendor
        # surface's exact lifetime reading (46,336,700,095, exported
        # 2026-09-01T07:56:32Z, at which instant the vendor's own bucket for
        # 2026-09-01 was still zero — so the reading covers exactly the days
        # through 2026-08-31 and the as-of day carries no residual). This pin
        # makes the sanctioned numbers reproducible by review. The key is
        # asserted label-shaped rather than spelled: source labels are data,
        # and this suite keeps vendor names out of its own text.
        table = export_usage_series.load_lifetime_baselines(
            self.REPO_ROOT / "scripts/usage-export/lifetime-baselines.json"
        )
        self.assertEqual(len(table), 1)
        ((key, entry),) = table.items()
        self.assertTrue(export_usage_series.valid_source_key(key))
        self.assertEqual(entry, (46_336_700_095, "2026-08-31"))

    def test_a_malformed_table_refuses_the_run(self):
        for name, document in {
            "not an object": [1, 2],
            "missing schema": {"baselines": {}},
            "wrong schema": {"schema": "usage-series/v1", "baselines": {}},
            "unknown top-level key": dict(self.table({}), notes="prose"),
            "baselines not an object": self.table([1]),
            "key not label-shaped": self.table({"Not A Key": {"total": 1, "asOf": "2026-08-31"}}),
            "entry not an object": self.table({"beta": 5}),
            "unknown entry field": self.table(
                {"beta": {"total": 1, "asOf": "2026-08-31", "note": "x"}}
            ),
            "zero total": self.table({"beta": {"total": 0, "asOf": "2026-08-31"}}),
            "boolean total": self.table({"beta": {"total": True, "asOf": "2026-08-31"}}),
            "total over the shared count bound": self.table(
                {"beta": {"total": capture.MAX_COUNT + 1, "asOf": "2026-08-31"}}
            ),
            "as-of not a calendar day": self.table({"beta": {"total": 1, "asOf": "2026-99-99"}}),
        }.items():
            with self.subTest(name):
                with tempfile.TemporaryDirectory() as scratch:
                    path = self.write_table(scratch, document)
                    with self.assertRaises(CaptureError):
                        export_usage_series.load_lifetime_baselines(path)

    def section_with_series(self, start, totals, stats=None):
        section = {"series": {"startDate": start, "totals": totals, "recorded": True}}
        if stats is not None:
            section["stats"] = dict(stats)
        return section

    def test_accrues_only_the_days_strictly_after_the_as_of_day(self):
        # The series spans the as-of day and both sides of it: the day
        # before and the day itself sit inside the vendor reading, so only
        # the two later days accrue.
        sources = {"beta": self.section_with_series("2026-08-30", [100, 200, 40, 2])}
        export_usage_series.apply_lifetime_baselines(
            sources, {"beta": (1_000, "2026-08-31")}
        )
        self.assertEqual(sources["beta"]["stats"], {"lifetime": 1_042})

    def test_a_baseline_older_than_the_whole_series_accrues_every_day(self):
        sources = {"beta": self.section_with_series("2026-08-30", [100, 200])}
        export_usage_series.apply_lifetime_baselines(
            sources, {"beta": (1_000, "2026-08-01")}
        )
        self.assertEqual(sources["beta"]["stats"]["lifetime"], 1_300)

    def test_a_table_key_absent_from_this_export_is_skipped(self):
        # The table describes the shipped production source set; the
        # exporter stays generic over whatever an operator configures. The
        # fail-closed net for a drifted table is the origin's tile-inventory
        # completeness check, which turns the panel visibly stale.
        sources = {"beta": self.section_with_series("2026-08-30", [100])}
        export_usage_series.apply_lifetime_baselines(
            sources, {"gamma": (1_000, "2026-08-01")}
        )
        self.assertNotIn("stats", sources["beta"])

    def test_a_baseline_colliding_with_a_captured_lifetime_is_refused(self):
        # Two derivations claiming one tile: neither could be trusted over
        # the other, so the contradiction refuses the run by name.
        sources = {
            "beta": self.section_with_series("2026-08-30", [100], stats={"lifetime": 5})
        }
        with self.assertRaises(CaptureError) as caught:
            export_usage_series.apply_lifetime_baselines(
                sources, {"beta": (1_000, "2026-08-01")}
            )
        self.assertIn("collides", str(caught.exception))

    def test_a_baseline_joins_captured_stats_without_displacing_them(self):
        sources = {
            "beta": self.section_with_series("2026-08-30", [100], stats={"sessions": 9})
        }
        export_usage_series.apply_lifetime_baselines(
            sources, {"beta": (1_000, "2026-08-01")}
        )
        self.assertEqual(sources["beta"]["stats"], {"sessions": 9, "lifetime": 1_100})

    def test_an_accrual_past_the_shared_count_bound_is_refused(self):
        sources = {"beta": self.section_with_series("2026-08-30", [1])}
        with self.assertRaises(CaptureError) as caught:
            export_usage_series.apply_lifetime_baselines(
                sources, {"beta": (capture.MAX_COUNT, "2026-08-01")}
            )
        self.assertIn("count bound", str(caught.exception))


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
                root, "alpha", [], MERGE_NOW
            )
        self.assertEqual(set(sources), {"alpha"})
        section = sources["alpha"]
        self.assertEqual(section["series"]["totals"], [135, 3])
        self.assertEqual(section["categories"]["output"], [5, 3])
        self.assertEqual(section["windows"]["today"], {"input": 0, "output": 3})
        self.assertEqual(section["derived"]["current-streak"], 2)
        self.assertEqual(counters["counted"], 2)
        # capturedAt is attached AFTER the guard, exactly like the document's
        # own generatedAt, because it is an INSTANT and the guard admits only
        # calendar dates and integers. It must be this run's clock — nothing
        # read from a transcript can influence it (2026-08-24 round-3 finding
        # 5) — and it is excluded from the shape sweep below for that reason.
        self.assertEqual(
            section["capturedAt"],
            MERGE_NOW.strftime(export_usage_series.INSTANT_FORMAT),
        )
        strings = []
        collect_strings(sources, strings)
        for value in strings:
            if value == section["capturedAt"]:
                continue
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

        def recording(value, where="emission", extra_keys=frozenset()):
            observed.append((value, where))
            return original(value, where, extra_keys=extra_keys)

        capture.assert_only_dates_and_integers = recording
        try:
            with tempfile.TemporaryDirectory() as root:
                self.tree(root)
                sources, _counters = export_usage_series.export(
                    root, "alpha", [], MERGE_NOW
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
                    root, "alpha", [("beta", merge_path)], MERGE_NOW
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
                    root, "alpha", [("alpha", merge_path)], MERGE_NOW
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
            r"^files=\d+ unreadable=\d+ symlinks=\d+ oversized=\d+ lines=\d+ counted=\d+ "
        r"duplicates=\d+ unpartitioned=\d+ unattributed=\d+ sources=\d+$",
        )

    def test_the_baselines_argument_reaches_the_accrual(self):
        # Issue #276, end to end through the CLI: a committed table naming
        # the walked source sets its lifetime figure, and a malformed table
        # refuses the run with a diagnostic that names the table and never a
        # path.
        with tempfile.TemporaryDirectory() as scratch:
            root = os.path.join(scratch, "transcripts")
            self.tree(root)
            table = os.path.join(scratch, "baselines.json")
            with open(table, "w", encoding="utf-8") as handle:
                json.dump(
                    {
                        "schema": export_usage_series.BASELINES_SCHEMA,
                        "baselines": {"alpha": {"total": 1_000, "asOf": "2026-08-01"}},
                    },
                    handle,
                )
            out = os.path.join(scratch, "usage.json")
            code, _stdout, stderr = self.run_main(
                ["--transcripts", root, "--source", "alpha", "--out", out,
                 "--lifetime-baselines", table]
            )
            self.assertEqual(code, 0, stderr)
            with open(out, "r", encoding="utf-8") as handle:
                document = json.load(handle)
            walked = sum(document["sources"]["alpha"]["series"]["totals"])
            self.assertEqual(
                document["sources"]["alpha"]["stats"]["lifetime"], 1_000 + walked
            )
            with open(table, "w", encoding="utf-8") as handle:
                handle.write("{}")
            code, _stdout, stderr = self.run_main(
                ["--transcripts", root, "--source", "alpha", "--out", out,
                 "--lifetime-baselines", table]
            )
            self.assertEqual(code, 1)
            self.assertIn("baselines table is malformed", stderr)
            self.assertNotIn(scratch, stderr)

    def test_a_history_store_carries_the_walked_source_across_pruning(self):
        # Issue #234, end to end through the CLI: the walked tree is
        # retention-pruned between two exports, and the configured store is
        # what keeps the pruned day in the published series — the same
        # mechanism the capture tool's own suite pins, proven here to be
        # wired through this producer's argument surface.
        with tempfile.TemporaryDirectory() as scratch:
            root = os.path.join(scratch, "transcripts")
            self.tree(root)
            store = os.path.join(scratch, "store", "alpha.json")
            os.makedirs(os.path.dirname(store))
            argv = ["--transcripts", root, "--source", "alpha", "--history-store", store]
            code, stdout, stderr = self.run_main(argv)
            self.assertEqual(code, 0, stderr)
            write_tree(
                root,
                {
                    "p/one.jsonl": [
                        transcript_line(
                            timestamp="2026-08-12T12:00:00Z",
                            requestId="req_later",
                            message={
                                "id": "msg_later",
                                "usage": {"input_tokens": 7},
                            },
                        )
                    ]
                },
            )
            code, stdout, stderr = self.run_main(argv)
            self.assertEqual(code, 0, stderr)
            series = json.loads(stdout)["sources"]["alpha"]["series"]
        self.assertEqual(series["startDate"], "2026-08-10")
        self.assertEqual(series["totals"], [135, 0, 7])

    def test_a_history_store_with_a_missing_directory_is_refused(self):
        # A mistyped store location must refuse rather than silently
        # remember nothing, run after run.
        with tempfile.TemporaryDirectory() as root:
            self.tree(root)
            code, _stdout, stderr = self.run_main(
                [
                    "--transcripts",
                    root,
                    "--source",
                    "alpha",
                    "--history-store",
                    os.path.join(root, "no-such-directory", "alpha.json"),
                ]
            )
        self.assertEqual(code, 2)
        self.assertIn("history store directory", stderr)

    def test_prints_to_stdout_when_no_out_file_is_given(self):
        with tempfile.TemporaryDirectory() as root:
            self.tree(root)
            code, stdout, _stderr = self.run_main(
                ["--transcripts", root, "--source", "alpha"]
            )
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(stdout)["schema"], "usage-series/v1")

    def test_the_emission_is_compact(self):
        # 2026-08-24 review finding 4: the document was pretty-printed with
        # indent=2, which roughly DOUBLED every measurement for whitespace
        # nobody reads — the file is sealed immediately and never seen. Both
        # emission paths must produce the identical compact bytes plus one
        # terminating newline.
        with tempfile.TemporaryDirectory() as scratch:
            root = os.path.join(scratch, "transcripts")
            self.tree(root)
            out = os.path.join(scratch, "usage.json")
            code, stdout, _stderr = self.run_main(
                ["--transcripts", root, "--source", "alpha", "--out", out]
            )
            self.assertEqual(code, 0)
            written = pathlib.Path(out).read_text(encoding="utf-8")
            code, stdout, _stderr = self.run_main(
                ["--transcripts", root, "--source", "alpha"]
            )
        self.assertEqual(code, 0)
        document = json.loads(written)
        expected = json.dumps(document, separators=(",", ":")) + "\n"
        self.assertEqual(written, expected)
        # The stdout path only differs in the capture instant it stamps.
        self.assertNotIn("\n  ", stdout)
        self.assertNotIn(": ", stdout)
        self.assertTrue(stdout.endswith("}\n"))

    def test_a_document_over_the_payload_ceiling_is_refused_before_it_is_written(self):
        # The producer half of the one-ceiling contract (2026-08-24 review
        # finding 4). The origin caps the SEALED file, sealing adds exactly
        # SEAL_OVERHEAD, so a document past the plaintext bound is one
        # nothing downstream could ever admit — and pushing it would leave
        # the panel silently frozen instead of loudly refused. Two merge
        # sources at the 732-day bound with the full category vocabulary and
        # very large daily values build a real over-ceiling document; no
        # constant is patched, so the shipped number is the one under test.
        days = capture.MAX_SERIES_DAYS
        # The largest per-category value whose five-way day total still fits
        # the shared count bound (2026-08-24 round-3 finding 9): sixteen
        # digits, and admissible, so what this test exercises is the BYTE
        # ceiling and not the numeric one.
        value = capture.MAX_COUNT // 5
        section = merge_section(days, value)
        with tempfile.TemporaryDirectory() as scratch:
            root = os.path.join(scratch, "transcripts")
            self.tree(root)
            merges = []
            for key in ("beta", "gamma"):
                path = os.path.join(scratch, key + ".json")
                with open(path, "w", encoding="utf-8") as handle:
                    json.dump(section, handle)
                merges += ["--merge-source", key + "=" + path]
            out = os.path.join(scratch, "usage.json")
            code, stdout, stderr = self.run_main(
                ["--transcripts", root, "--source", "alpha", "--out", out] + merges
            )
            self.assertEqual(code, 1, "an over-ceiling document was not refused")
            self.assertFalse(
                os.path.exists(out),
                "a refused document still wrote its output file",
            )
        self.assertEqual(stdout, "")
        self.assertIn("byte bound", stderr)
        self.assertNotIn(scratch, stderr)

    def test_a_document_inside_the_payload_ceiling_is_emitted(self):
        # Non-vacuity for the bound above: the same shape one source smaller
        # is comfortably inside the ceiling and must still be produced, so
        # the guard is a real edge rather than a blanket refusal.
        days = capture.MAX_SERIES_DAYS
        value = 10**9 - 1
        section = merge_section(days, value)
        with tempfile.TemporaryDirectory() as scratch:
            root = os.path.join(scratch, "transcripts")
            self.tree(root)
            merge = os.path.join(scratch, "beta.json")
            with open(merge, "w", encoding="utf-8") as handle:
                json.dump(section, handle)
            out = os.path.join(scratch, "usage.json")
            code, _stdout, _stderr = self.run_main(
                [
                    "--transcripts", root, "--source", "alpha",
                    "--merge-source", "beta=" + merge, "--out", out,
                ]
            )
            self.assertEqual(code, 0)
            emitted = pathlib.Path(out).read_bytes()
        self.assertLessEqual(
            len(emitted), export_usage_series.MAX_PLAINTEXT_BYTES
        )
        self.assertGreater(len(emitted), 10000, "the fixture is not exercising a large document")

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
