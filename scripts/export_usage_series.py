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

THE CATEGORY PARTITION. A day's total is the sum of the four usage fields,
and the four categories ARE those fields, so the categories partition the
total by construction — and the origin refuses any document where they do
not, so this program re-checks the arithmetic before emitting rather than
shipping a file the origin will reject.

OTHER SOURCES. `--merge-source KEY=FILE` merges another tool's captured
series (the capture tool's own stdout shape: {"series": ..., "derived": ...},
optionally extended with "categories" and "windows" in this document's own
shapes) under the given source key. The merged file passes through the SAME
guard and the same structural checks as the walked tree — a hostile or
malformed merge file refuses the whole run. This is how the second tool's
reader — which lives in the capture tool, not here — feeds this document
without this program ever reading that tool's tree itself.

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
        [--merge-source LABEL=FILE] [--out FILE]
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

# Transcript usage fields mapped to their served category keys. The FIELD
# names are the transcript's own; the KEYS are the canonical vocabulary the
# panel's fixed color slots bind to. Order is the canonical serve order.
CATEGORY_FIELDS = (
    ("input_tokens", "input"),
    ("output_tokens", "output"),
    ("cache_read_input_tokens", "cache-read"),
    ("cache_creation_input_tokens", "cache-write"),
)

# The window vocabulary is CLOSED on both ends of the pipe: the origin
# refuses any other key, so none can be produced here.
WINDOW_TODAY = "today"
WINDOW_WEEK = "week"
WEEK_DAYS = 7

# Source keys must be label-shaped: lowercase, machine-safe, bounded. The
# same shape the emission guard enforces for every field name.
MAX_SOURCE_KEY_LENGTH = 32

# THE payload ceiling, in SEALED bytes — one number every stage of the
# pipeline enforces (2026-08-24 review finding 4). Stated in Go at
# internal/seal/types.go (MaxSealedBytes/Overhead), restated here and in
# scripts/usage-export/push-usage-series.sh and docs/usage-export.md, and
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


def read_category_records(root, counters):
    """Yield (day, {category: count}) per counted transcript record.

    The walk, the de-duplication identity, and the skip rules mirror
    capture_usage_series.read_records EXACTLY — they are now literally the
    capture tool's own `record_paths` and `open_record_file`, so "mirror" is
    shared code rather than a claim two files have to keep true by hand
    (2026-08-24 review finding 1 removed this file's own `os.walk`). The
    parity test in scripts/ci runs both over one fixture tree and requires
    the summed categories to equal the capture tool's totals day for day.
    """
    seen = set()
    for path in capture.record_paths(root, counters):
        counters["files"] += 1
        handle = capture.open_record_file(path, counters)
        if handle is None:
            continue
        with handle:
            for line in capture.bounded_lines(handle, counters):
                reduced = reduce_category_line(line, seen, counters)
                if reduced is not None:
                    counters["counted"] += 1
                    yield reduced


def reduce_category_line(line, seen, counters):
    """Reduce one transcript line to (day, per-category counts), or None."""
    line = line.strip()
    if not line:
        return None
    try:
        record = json.loads(line)
    except ValueError:
        return None
    if not isinstance(record, dict):
        return None
    message = record.get("message")
    if not isinstance(message, dict):
        return None
    usage = message.get("usage")
    if not isinstance(usage, dict):
        return None
    stamp = record.get("timestamp")
    if not isinstance(stamp, str):
        return None
    identity = (message.get("id"), record.get("requestId"))
    if identity != (None, None):
        if identity in seen:
            counters["duplicates"] += 1
            return None
        capture.remember_identity(identity, seen)
    day = capture.utc_day(stamp)
    if day is None:
        return None
    amounts = {}
    for field, key in CATEGORY_FIELDS:
        value = usage.get(field)
        if isinstance(value, int) and not isinstance(value, bool) and value > 0:
            amounts[key] = value
    return day, amounts


def category_series(pairs):
    """Build the contiguous day-indexed category series from reduced pairs."""
    by_day = {}
    for day, amounts in pairs:
        bucket = by_day.setdefault(day, {})
        for key, value in amounts.items():
            bucket[key] = bucket.get(key, 0) + value
    if not by_day:
        raise capture.CaptureError("no usage records found under the transcript root")
    days = sorted(by_day)
    first = datetime.date.fromisoformat(days[0])
    last = datetime.date.fromisoformat(days[-1])
    span = (last - first).days + 1
    if span > capture.MAX_SERIES_DAYS:
        raise capture.CaptureError(
            "the record spans %d days, over the %d day bound the origin enforces"
            % (span, capture.MAX_SERIES_DAYS)
        )
    categories = {key: [0] * span for _, key in CATEGORY_FIELDS}
    for offset in range(span):
        day = (first + datetime.timedelta(days=offset)).isoformat()
        for key, value in by_day.get(day, {}).items():
            categories[key][offset] = value
    totals = [
        sum(categories[key][offset] for key in categories) for offset in range(span)
    ]
    series = {"startDate": days[0], "totals": totals, "recorded": True}
    return series, categories


def assert_partition(series, categories):
    """Refuse an emission whose categories do not sum to the series totals.

    The origin enforces exactly this; checking here means a broken build of
    this program can never push a file the origin will reject every five
    minutes until the next capture.
    """
    totals = series["totals"]
    for offset, total in enumerate(totals):
        summed = sum(values[offset] for values in categories.values())
        if summed != total:
            raise capture.CaptureError(
                "categories sum to a different figure than the series total on day %d"
                % offset
            )


def windows_from(series, categories, today):
    """Derive the closed window set from the daily categories.

    `today` is the capture instant's UTC date; a day the record does not
    cover contributes zero, which inside the asked window is a measurement —
    "no recorded usage that day" — never an invention. The input figure sums
    the input-class categories (uncached input plus both cache classes),
    matching what the live mapper counts as input; output is the output
    category alone.
    """
    start = datetime.date.fromisoformat(series["startDate"])
    span = len(series["totals"])

    def day_amount(day, keys):
        offset = (day - start).days
        if offset < 0 or offset >= span:
            return 0
        return sum(categories[key][offset] for key in keys if key in categories)

    input_keys = ("input", "cache-read", "cache-write")
    output_keys = ("output",)
    week_days = [today - datetime.timedelta(days=age) for age in range(WEEK_DAYS)]
    return {
        WINDOW_TODAY: {
            "input": day_amount(today, input_keys),
            "output": day_amount(today, output_keys),
        },
        WINDOW_WEEK: {
            "input": sum(day_amount(day, input_keys) for day in week_days),
            "output": sum(day_amount(day, output_keys) for day in week_days),
        },
    }


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
    """Read one small JSON document under an explicit byte bound.

    One byte PAST the bound is read so the ceiling itself is admitted and
    anything larger refuses — the same edge the sealed-payload cap uses. The
    parse is guarded against a recursion blow-up too: depth is a resource,
    and a document nobody can parse without exhausting the stack is refused
    like any other oversized input (2026-08-24 round-3 review, finding 10).
    """
    with pathlib.Path(path).open("r", encoding="utf-8") as handle:
        text = handle.read(MAX_MERGE_BYTES + 1)
    if len(text) > MAX_MERGE_BYTES:
        raise capture.CaptureError(
            "a merge source is larger than the %d byte bound" % MAX_MERGE_BYTES
        )
    try:
        return json.loads(text)
    except (ValueError, RecursionError):
        raise capture.CaptureError("a merge source is not a parsable JSON document")


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
    allowed = {"generatedAt", "series", "derived", "categories", "windows"}
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
    categories = document.get("categories")
    if categories is not None:
        if not isinstance(categories, dict) or not categories:
            raise capture.CaptureError("a merge source carries malformed categories")
        admitted = {}
        for key, values in categories.items():
            if key not in capture.CATEGORY_KEYS:
                # MEMBERSHIP in the closed category vocabulary, never mere
                # label shape: `private-feature` is label-shaped and renders
                # publicly if admitted (2026-08-24 review finding H1). The
                # origin refuses the same set, so nothing this refuses could
                # have been served anyway — refusing here keeps a hostile
                # merge file from ever reaching the wire.
                raise capture.CaptureError(
                    "a merge source category key is outside the closed category vocabulary"
                )
            if not isinstance(values, list) or len(values) != len(totals):
                raise capture.CaptureError("a merge source category does not cover the series")
            if not all(
                isinstance(value, int) and not isinstance(value, bool) and value >= 0
                for value in values
            ):
                raise capture.CaptureError("a merge source category carries malformed counts")
            admitted[key] = values
        assert_partition(section["series"], admitted)
        section["categories"] = admitted
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


def export(root, source_key, merge_files, now):
    """Walk, merge, guard, and return (sources payload, counters)."""
    counters = capture.new_counters()
    series, categories = category_series(read_category_records(root, counters))
    assert_partition(series, categories)
    derived = capture.derived_figures(series)
    sources = {
        source_key: {
            "series": series,
            "categories": categories,
            "windows": windows_from(series, categories, now.date()),
            "derived": derived,
        }
    }
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
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
    try:
        sources, counters = export(root, arguments.source, merge_files, now)
    except capture.CaptureError as error:
        print(str(error), file=sys.stderr)
        return 1
    except OSError:
        # Counted, never named: a merge file that cannot be read is reported
        # without its path, exactly as unreadable transcripts are.
        print("a merge source file could not be read", file=sys.stderr)
        return 1
    print(
        "files=%d unreadable=%d symlinks=%d lines=%d counted=%d duplicates=%d sources=%d"
        % (
            counters.get("files", 0),
            counters.get("unreadable", 0),
            counters.get("symlinks", 0),
            counters.get("lines", 0),
            counters.get("counted", 0),
            counters.get("duplicates", 0),
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
