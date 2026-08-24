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

Structurally incapable of spawning anything: standard-library file reading
only. The import surface is pinned by test (scripts/ci) against a closed
allowlist, and that allowlist is itself pinned against a refused set, so no
process-, network-, or loader-capable module can be admitted without a test
naming the module that got in.

`os` is refused, and that is the load-bearing decision here (2026-08-24
review finding 1). It is the obvious module for a directory walk and it was
imported here until that review: it carries `system`, `popen`, `fork`,
`spawn*` and `exec*`, and an attribute denylist around those spellings does
not hold — a computed `getattr(os, "sys" + "tem")` reintroduced the launch
callable with every test still green. Refusing the IMPORT is what makes the
capability structurally absent rather than merely unspelled, and `pathlib`
plus the capture tool's own walk do the same job with none of that reach.

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
    for path in capture.record_paths(root):
        counters["files"] += 1
        handle = capture.open_record_file(path, counters)
        if handle is None:
            continue
        with handle:
            for line in handle:
                counters["lines"] += 1
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
        seen.add(identity)
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


def load_merge_source(path):
    """Load and structurally validate one merged source file.

    The shape is the capture tool's stdout — {"series": ..., "derived": ...}
    — optionally extended with "categories" and "windows". Every section is
    re-checked here exactly as the origin will check it, and the caller runs
    the emission guard over the result, so a hostile file cannot ride
    through under a friendly key.
    """
    with pathlib.Path(path).open("r", encoding="utf-8") as handle:
        document = json.load(handle)
    if not isinstance(document, dict):
        raise capture.CaptureError("a merge source must be a JSON object")
    allowed = {"series", "derived", "categories", "windows"}
    unknown = set(document) - allowed
    if unknown:
        raise capture.CaptureError("a merge source carries an unknown section")
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
    if windows is not None:
        if not isinstance(windows, dict) or set(windows) - {WINDOW_TODAY, WINDOW_WEEK}:
            raise capture.CaptureError("a merge source window is outside the closed vocabulary")
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
    if derived is not None:
        if not isinstance(derived, dict) or set(derived) - {
            capture.STAT_PEAK_DAY,
            capture.STAT_CURRENT_STREAK,
            capture.STAT_LONGEST_STREAK,
        }:
            raise capture.CaptureError("a merge source derived key is outside the closed vocabulary")
        if not all(
            isinstance(value, int) and not isinstance(value, bool) and value >= 0
            for value in derived.values()
        ):
            raise capture.CaptureError("a merge source derived figure is malformed")
        section["derived"] = derived
    return section


def export(root, source_key, merge_files, today):
    """Walk, merge, guard, and return (sources payload, counters)."""
    counters = capture.new_counters()
    series, categories = category_series(read_category_records(root, counters))
    assert_partition(series, categories)
    derived = capture.derived_figures(series)
    sources = {
        source_key: {
            "series": series,
            "categories": categories,
            "windows": windows_from(series, categories, today),
            "derived": derived,
        }
    }
    for key, path in merge_files:
        if key in sources:
            raise capture.CaptureError("two sources claim one key")
        sources[key] = load_merge_source(path)
    # THE guard — the capture tool's own, not a copy — over the complete
    # payload: nothing but calendar dates, non-negative integers, and the
    # declared recorded flags survives to the emission. Every dictionary key
    # must sit in the guard's closed emission vocabulary; the only declared
    # additions are the source keys the OPERATOR typed on the command line
    # (validated label-shaped there, and admitted by the origin only against
    # its embedded snapshot labels) — nothing read from a transcript or a
    # merge file can mint a key.
    capture.assert_only_dates_and_integers(sources, "sources", extra_keys=frozenset(sources))
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
    now = datetime.datetime.now(datetime.timezone.utc)
    try:
        sources, counters = export(root, arguments.source, merge_files, now.date())
    except capture.CaptureError as error:
        print(str(error), file=sys.stderr)
        return 1
    except OSError:
        # Counted, never named: a merge file that cannot be read is reported
        # without its path, exactly as unreadable transcripts are.
        print("a merge source file could not be read", file=sys.stderr)
        return 1
    print(
        "files=%d unreadable=%d lines=%d counted=%d duplicates=%d sources=%d"
        % (
            counters.get("files", 0),
            counters.get("unreadable", 0),
            counters.get("lines", 0),
            counters.get("counted", 0),
            counters.get("duplicates", 0),
            len(sources),
        ),
        file=sys.stderr,
    )
    document = {
        "schema": SCHEMA,
        "generatedAt": now.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ"),
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
