#!/usr/bin/env python3
"""Export the local usage records as one sanitized usage-series document.

WHY THIS EXISTS. `capture_usage_series.py` turns the local agent transcripts
into a per-day total series and splices it into the embedded snapshot — the
release-time path. This program is the RUNTIME path's producer (issue #142):
it emits the standalone `usage-series/v1` document the origin's panels data
root consumes — the same recorded measurement, extended with the per-day
CATEGORY breakdown (input, output, cache reads, cache writes) the transcripts
already carry, plus the aggregate windows and series-derived figures — which
the scheduled export job then seals (cmd/usageseal) and pushes to the
cluster. Nothing here replaces the capture tool; this program IMPORTS it and
reuses its privacy guard, its calendar arithmetic, and its streak rules, so
the two emissions cannot drift apart.

WHAT LEAVES THE MACHINE — the whole security argument, and requirement 12 is
absolute about it. The transcripts contain prompts, file names, project
paths, and session identifiers. The only values this program can emit are
calendar dates and non-negative integers under machine-shaped field names:
`capture_usage_series.assert_only_dates_and_integers` — THE SAME GUARD, not a
copy — re-proves the complete sources payload immediately before anything is
written, exactly as the capture tool proves its own emission. Diagnostics are
counts, never paths. The schema marker and the capture instant are attached
AFTER the guarded payload, mirroring how the capture tool attaches its
generatedAt after its own assertion.

THE PAYLOAD CEILING. The document is emitted COMPACT and refused if it would
not seal within the one ceiling every stage of this pipeline enforces (see
MAX_SEALED_BYTES below). Producing a document the origin can never admit is
not a smaller failure than producing a wrong one — it is a panel that
silently stops advancing — so the refusal happens here, before sealing and
before anything reaches the wire.

THE BREAKDOWN PARTITIONS. A source's series may carry two day-indexed
breakdowns — by accounting CATEGORY and by MODEL — each over its own closed
vocabulary and each summing exactly to the series totals across every day it
covers. Both are windowed: a breakdown declares where it starts and makes no
claim before that, because the days a series reaches back to are not always
days the record can divide. The origin enforces the identical rules, so this
program re-checks the arithmetic before emitting rather than shipping a file
the origin will reject.

OTHER SOURCES. `--merge-source KEY=FILE` merges another tool's captured
section — the capture tool's own stdout, verbatim — under the given source
key. The merged file passes through the SAME guard and the same structural
checks as the walked tree, so a hostile or malformed merge file refuses the
whole run. The scheduled job regenerates every such file at the top of each
run (`MERGE_CAPTURES` in scripts/usage-export/push-usage-series.sh), which is
what keeps a second tool's half of the panel as current as the first tool's
and what retired the hand-written file that used to sit there.

WHERE THE NO-SPAWN, NO-NETWORK GUARANTEE ACTUALLY COMES FROM — stated
precisely, because two earlier revisions of this docstring overstated it.

The guarantee is enforced OUTSIDE this program, by the kernel sandbox the
scheduled job starts it inside: `scripts/usage-export/producer.sb`, applied by
`scripts/usage-export/push-usage-series.sh` before the interpreter runs. It
denies `process-fork` and `network*`, so for the whole walk no process can be
created by any spelling — `os.system`, `os.popen`, `posix_spawn`, and every
stdlib wrapper layered on them all fail with EPERM — and no network endpoint
can be opened, bound, or connected. That is a capability the program does not
have, rather than one it declines to use. (Those module names are spelled
around deliberately: the pin below also refuses them as literal bytes
anywhere in this file, and a docstring is bytes.)

The AST pin in `scripts/ci/test_export_usage_series.py` is a REVIEW BOUND, not
that guarantee, and this is exactly what the 2026-08-24 round-3 review
established. It holds this file's import surface to a closed allowlist pinned
against a refused set, so widening the reviewed surface is a conscious edit
that names the module that got in — genuinely useful, and non-vacuous (adding
`import os` turns it red). What it CANNOT do is prove a capability absent:
`pathlib` is on the allowlist and the module object it binds re-exports `os`,
so `pathlib.os.system(":")` reaches the launch callable with the import set
unchanged; `sys.modules["os"]` is the same hole spelled differently. Any
admitted module that itself imports `os` reopens it, so no allowlist of import
NAMES can ever close it. Read the pin as "the reviewed import surface is this
and only this", never as "this program cannot spawn".

`os` stays refused on that reviewed surface anyway (2026-08-24 review finding
1): it is the obvious module for a directory walk, and keeping it out means an
`os.` call site cannot appear here without an explicit, reviewed widening.
`pathlib` plus the capture tool's own bounded walk do the same job.

    scripts/export_usage_series.py --transcripts DIR --source LABEL \\
        [--activity-cache FILE] [--merge-source LABEL=FILE] [--out FILE]
"""

from __future__ import annotations

import argparse
import datetime
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import capture_usage_series as capture  # noqa: E402

# The document identity the origin's strict decoder requires.
SCHEMA = "usage-series/v1"

# The category vocabulary, the window vocabulary, the model vocabulary, the
# walk, and the partition arithmetic are all the CAPTURE TOOL's — named here
# so this file's own readers are legible, never redefined. Two files that each
# know what a category is are two files that can come to disagree, and the
# 2026-08-24 review's finding 1 already removed one such copy (this module's
# own `os.walk`). The rest followed on 2026-08-27, when the running-totals
# shape had to grow the same sections and the alternative was a second
# implementation of every one of them.
WINDOW_TODAY = capture.WINDOW_TODAY
WINDOW_WEEK = capture.WINDOW_WEEK

# Source keys must be label-shaped: lowercase, machine-safe, bounded. The
# same shape the emission guard enforces for every field name.
MAX_SOURCE_KEY_LENGTH = 32

# THE payload ceiling, in SEALED bytes — one number every stage of the
# pipeline enforces (2026-08-24 review finding 4). Canonical in Go at
# internal/seal/types.go (MaxSealedBytes/Overhead), restated in
# internal/panels/types.go (maxSealedSeriesBytes — that package's zero-egress
# doctrine pin forbids importing internal/seal), here, in
# scripts/usage-export/push-usage-series.sh and in docs/usage-export.md, and
# pinned across all five by CapParityTest in
# scripts/ci/test_capture_usage_series.py.
#
# This program produces PLAINTEXT, so it refuses at the plaintext bound: the
# sealer adds exactly SEAL_OVERHEAD bytes, so a document that would not seal
# within the ceiling must fail HERE rather than be sealed and pushed to an
# origin that can never admit it. Emission is compact for the same reason —
# indentation multiplied the same measurement by roughly two for nothing that
# ever reaches a human eye.
MAX_SEALED_BYTES = 128 * 1024
SEAL_OVERHEAD = 36
MAX_PLAINTEXT_BYTES = MAX_SEALED_BYTES - SEAL_OVERHEAD

# One merge source is a small JSON document — the biggest admissible one is
# well under a hundred kilobytes — so it is read under an explicit bound
# rather than handed whole to json.load (2026-08-24 round-3 review, finding
# 10). An unbounded parse of an operator-configured path is a producer that
# can be stopped by pointing it at a large file.
MAX_MERGE_BYTES = 1 << 20

# The instant form both ends of this pipeline speak: RFC 3339, UTC, seconds.
INSTANT_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

# Compact separators: no spaces after the item and key separators.
COMPACT_SEPARATORS = (",", ":")


def valid_source_key(key):
    """The label shape: lowercase letter first, then lowercase/digit/hyphen."""
    if not key or len(key) > MAX_SOURCE_KEY_LENGTH:
        return False
    for index, char in enumerate(key):
        if "a" <= char <= "z":
            continue
        if index > 0 and (char == "-" or "0" <= char <= "9"):
            continue
        return False
    return True


def read_bounded_json(path):
    """Read one small merge source under this module's own byte bound.

    The bounded read itself is the capture tool's (it needs the identical
    one for the activity cache), so the ceiling stated here is the only part
    that belongs to this file.
    """
    return capture.read_bounded_json(path, MAX_MERGE_BYTES)


def admit_capture_instant(value, now):
    """Parse one merged source's own capture instant, or refuse.

    REQUIRED, not optional (2026-08-24 round-3 review, finding 5). A merged
    source is produced by a separate capture run and can be arbitrarily older
    than the export that carries it; without its own instant, the combined
    document stamped everything with the export's `now` and relabelled stale
    data as current under one envelope. It may not be in the future either:
    the origin refuses a section captured after the document naming it.
    """
    if not isinstance(value, str):
        raise capture.CaptureError("a merge source carries no capture instant")
    try:
        captured = datetime.datetime.strptime(value, INSTANT_FORMAT)
    except ValueError:
        raise capture.CaptureError("a merge source capture instant is malformed")
    captured = captured.replace(tzinfo=datetime.timezone.utc)
    if captured > now:
        raise capture.CaptureError("a merge source claims a capture instant in the future")
    return captured


def admit_breakdown(document, name, start_key, vocabulary, totals, series_start, max_days):
    """Admit one optional windowed breakdown, or refuse the whole document.

    ONE function, TWO vocabularies. A breakdown is a set of day-indexed rows
    over a closed vocabulary, laid on a trailing window of the aggregate
    series, summing exactly to that series' totals across every day it
    covers. Categories and models differ in exactly two data points — which
    vocabulary admits a key and how many days the window may span — so they
    share this admission rather than growing two implementations of the same
    five rules. The origin enforces the identical five.

    MEMBERSHIP, never mere label shape (2026-08-24 review finding H1):
    `private-feature` is label-shaped and would render publicly if admitted.
    The origin refuses the same sets, so nothing refused here could have been
    served anyway — refusing here keeps a hostile merge file from reaching
    the wire at all.

    Returns (rows, declared start date) with the start date None when the
    section is aligned with the series, and (None, None) when the section is
    absent. An absent section is a real producer state — "this record cannot
    break the series down that way" — never an error; a DECLARED start with
    no section, on the other hand, is a document contradicting itself.
    """
    values = document.get(name)
    declared = document.get(start_key)
    if values is None:
        if declared is not None:
            raise capture.CaptureError(
                "a merge source declares a breakdown start date with no breakdown"
            )
        return None, None
    if not isinstance(values, dict) or not values:
        raise capture.CaptureError("a merge source carries a malformed breakdown section")
    offset = 0
    if declared is not None:
        if not capture.valid_calendar_day(declared):
            raise capture.CaptureError(
                "a merge source breakdown carries no calendar start date"
            )
        offset = (
            datetime.date.fromisoformat(declared) - datetime.date.fromisoformat(series_start)
        ).days
        if offset <= 0 or offset >= len(totals):
            # A window that starts before the series is a claim about days the
            # series does not have; one that starts ON it must simply omit the
            # field, so there is exactly one spelling of "aligned".
            raise capture.CaptureError(
                "a merge source breakdown window is not inside the series"
            )
    span = len(totals) - offset
    if max_days is not None and span > max_days:
        raise capture.CaptureError(
            "a merge source breakdown spans %d days, over the %d day bound" % (span, max_days)
        )
    admitted = {}
    for key, row in values.items():
        if key not in vocabulary:
            raise capture.CaptureError(
                "a merge source breakdown key is outside its closed vocabulary"
            )
        if not isinstance(row, list) or len(row) != span:
            raise capture.CaptureError("a merge source breakdown does not cover its window")
        if not all(
            isinstance(value, int) and not isinstance(value, bool) and value >= 0
            for value in row
        ):
            raise capture.CaptureError("a merge source breakdown carries malformed counts")
        admitted[key] = row
    capture.assert_partition(totals, admitted, offset)
    return admitted, declared


def load_merge_source(path, now):
    """Load and structurally validate one merged source file.

    The shape is the capture tool's stdout — {"generatedAt": ..., "series":
    ..., "derived": ...} — extended with "categories" and "windows". Every
    section is re-checked here exactly as the origin will check it, and the
    caller runs the emission guard over the result, so a hostile file cannot
    ride through under a friendly key.

    `windows` and `derived` are REQUIRED and COMPLETE, matching the origin
    (2026-08-24 round-3 review, finding 5): an omitted section used to leave
    the release-time figure rendered beside a runtime series under one
    envelope instant, which no single `generatedAt` can describe honestly.

    Returns (section, capture instant).
    """
    document = read_bounded_json(path)
    if not isinstance(document, dict):
        raise capture.CaptureError("a merge source must be a JSON object")
    allowed = {
        "generatedAt",
        "series",
        "derived",
        "categories",
        "categoriesStartDate",
        "models",
        "modelsStartDate",
        "windows",
    }
    unknown = set(document) - allowed
    if unknown:
        raise capture.CaptureError("a merge source carries an unknown section")
    captured = admit_capture_instant(document.get("generatedAt"), now)
    series = document.get("series")
    if not isinstance(series, dict) or series.get("recorded") is not True:
        raise capture.CaptureError("a merge source series must declare recorded provenance")
    if not capture.valid_calendar_day(series.get("startDate")):
        # Membership in the real calendar, not shape: 2026-99-99 and a
        # newline-suffixed date both match the digit pattern and must both
        # refuse (2026-08-24 review finding H1).
        raise capture.CaptureError("a merge source series carries no calendar start date")
    totals = series.get("totals")
    if (
        not isinstance(totals, list)
        or not totals
        or len(totals) > capture.MAX_SERIES_DAYS
        or not all(
            isinstance(value, int) and not isinstance(value, bool) and value >= 0
            for value in totals
        )
    ):
        raise capture.CaptureError("a merge source series carries malformed totals")
    section = {"series": {"startDate": series["startDate"], "totals": totals, "recorded": True}}
    for name, start_key, vocabulary, max_days in (
        ("categories", "categoriesStartDate", capture.CATEGORY_KEYS, None),
        ("models", "modelsStartDate", capture.MODEL_KEYS, capture.MAX_MODEL_DAYS),
    ):
        admitted, declared = admit_breakdown(
            document, name, start_key, vocabulary, totals, series["startDate"], max_days
        )
        if admitted is None:
            continue
        section[name] = admitted
        if declared is not None:
            section[start_key] = declared
    windows = document.get("windows")
    if not isinstance(windows, dict) or set(windows) != {WINDOW_TODAY, WINDOW_WEEK}:
        raise capture.CaptureError(
            "a merge source must carry the complete window vocabulary"
        )
    for window in windows.values():
        if not isinstance(window, dict) or set(window) != {"input", "output"}:
            raise capture.CaptureError("a merge source window is malformed")
        if not all(
            isinstance(value, int) and not isinstance(value, bool) and value >= 0
            for value in window.values()
        ):
            raise capture.CaptureError("a merge source window carries malformed counts")
    section["windows"] = windows
    derived = document.get("derived")
    derived_keys = {
        capture.STAT_PEAK_DAY,
        capture.STAT_CURRENT_STREAK,
        capture.STAT_LONGEST_STREAK,
    }
    if not isinstance(derived, dict) or set(derived) != derived_keys:
        raise capture.CaptureError(
            "a merge source must carry the complete derived vocabulary"
        )
    if not all(
        isinstance(value, int) and not isinstance(value, bool) and value >= 0
        for value in derived.values()
    ):
        raise capture.CaptureError("a merge source derived figure is malformed")
    section["derived"] = derived
    return section, captured


def export(root, source_key, merge_files, now, activity_cache=None, history_store=None):
    """Walk, merge, guard, and return (sources payload, counters)."""
    section, counters = capture.capture(
        root, capture.FORMAT_MESSAGES, activity_cache, now.date(), history_store
    )
    sources = {source_key: section}
    # The walked tree is captured by THIS run, so its instant is this run's.
    captured = {source_key: now}
    for key, path in merge_files:
        if key in sources:
            raise capture.CaptureError("two sources claim one key")
        sources[key], captured[key] = load_merge_source(path, now)
    # THE guard — the capture tool's own, not a copy — over the complete
    # payload: nothing but calendar dates, non-negative integers, and the
    # declared recorded flags survives to the emission. Every dictionary key
    # must sit in the guard's closed emission vocabulary; the only declared
    # additions are the source keys the OPERATOR typed on the command line
    # (validated label-shaped there, and admitted by the origin only against
    # its embedded snapshot labels) — nothing read from a transcript or a
    # merge file can mint a key.
    capture.assert_only_dates_and_integers(sources, "sources", extra_keys=frozenset(sources))
    # capturedAt is attached AFTER the guard, exactly as the document's own
    # generatedAt is: the guard admits calendar dates and integers, and these
    # are INSTANTS. Attaching them here also means nothing read from a
    # transcript or a merge file can influence them — the walked source's is
    # this run's clock, and a merged source's is the value its own capture
    # stamped and this program already validated.
    for key, instant in captured.items():
        sources[key]["capturedAt"] = instant.strftime(INSTANT_FORMAT)
    return sources, counters


def parse_arguments(argv):
    parser = argparse.ArgumentParser(
        description="Export local usage records as one sanitized usage-series document.",
    )
    parser.add_argument(
        "--transcripts",
        required=True,
        help="directory tree of newline-delimited JSON transcripts to walk",
    )
    parser.add_argument(
        "--source",
        required=True,
        help="the source key the walked tree's series is emitted under",
    )
    parser.add_argument(
        "--merge-source",
        action="append",
        default=[],
        metavar="KEY=FILE",
        help="merge another tool's captured series document under KEY",
    )
    parser.add_argument(
        "--activity-cache",
        help="the walked tool's own per-day model roll-up, read for pruned days",
    )
    parser.add_argument(
        "--history-store",
        help="durable per-source day store for the walked tree, read and rewritten",
    )
    parser.add_argument(
        "--out",
        help="file to write the document to; prints to stdout when omitted",
    )
    return parser.parse_args(argv)


def main(argv=None):
    arguments = parse_arguments(sys.argv[1:] if argv is None else argv)
    root = pathlib.Path(arguments.transcripts).expanduser()
    if not root.is_dir():
        print("no such transcript directory", file=sys.stderr)
        return 2
    if not valid_source_key(arguments.source):
        print("the source key must be label-shaped", file=sys.stderr)
        return 2
    merge_files = []
    for entry in arguments.merge_source:
        key, separator, path = entry.partition("=")
        if not separator or not valid_source_key(key) or not path:
            print("merge sources take the form KEY=FILE with a label-shaped key", file=sys.stderr)
            return 2
        merge_files.append((key, pathlib.Path(path).expanduser()))
    activity_cache = None
    if arguments.activity_cache is not None:
        activity_cache = pathlib.Path(arguments.activity_cache).expanduser()
        if not activity_cache.is_file():
            print("no such activity cache", file=sys.stderr)
            return 2
    history_store = None
    if arguments.history_store is not None:
        history_store = pathlib.Path(arguments.history_store).expanduser()
        if not history_store.parent.is_dir():
            # The file bootstraps on first use; its directory must exist, or
            # the store would silently remember nothing, run after run.
            print("no such history store directory", file=sys.stderr)
            return 2
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
    try:
        sources, counters = export(
            root, arguments.source, merge_files, now, activity_cache, history_store
        )
    except capture.CaptureError as error:
        print(str(error), file=sys.stderr)
        return 1
    except OSError:
        # Counted, never named: a merge file that cannot be read is reported
        # without its path, exactly as unreadable transcripts are.
        print("a merge source file could not be read", file=sys.stderr)
        return 1
    print(
        "files=%d unreadable=%d symlinks=%d oversized=%d lines=%d counted=%d "
        "duplicates=%d unpartitioned=%d unattributed=%d sources=%d"
        % (
            counters.get("files", 0),
            counters.get("unreadable", 0),
            counters.get("symlinks", 0),
            counters.get("oversized", 0),
            counters.get("lines", 0),
            counters.get("counted", 0),
            counters.get("duplicates", 0),
            counters.get("unpartitioned", 0),
            counters.get("unattributed", 0),
            len(sources),
        ),
        file=sys.stderr,
    )
    document = {
        "schema": SCHEMA,
        "generatedAt": now.strftime(INSTANT_FORMAT),
        "sources": sources,
    }
    # The emitted text INCLUDING its terminating newline is what the sealer
    # reads, so that is exactly what the bound measures.
    emitted = json.dumps(document, separators=COMPACT_SEPARATORS) + "\n"
    payload = emitted.encode("utf-8")
    if len(payload) > MAX_PLAINTEXT_BYTES:
        # Refused HERE, before sealing and before the wire: the origin caps
        # the SEALED file at MAX_SEALED_BYTES, and sealing adds exactly
        # SEAL_OVERHEAD, so a document past this bound is one nothing
        # downstream could ever admit (2026-08-24 review finding 4).
        print(
            "the document is %d bytes, over the %d byte bound the pipeline enforces"
            % (len(payload), MAX_PLAINTEXT_BYTES),
            file=sys.stderr,
        )
        return 1
    if arguments.out is None:
        sys.stdout.write(emitted)
        return 0
    with pathlib.Path(arguments.out).open("w", encoding="utf-8") as handle:
        handle.write(emitted)
    return 0


if __name__ == "__main__":
    sys.exit(main())
