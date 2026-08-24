#!/usr/bin/env python3
"""Aggregate a local agent transcript tree into a panel activity series.

WHY THIS EXISTS. The token-usage panel's daily heatmap needs one combined
token total per calendar day. The previous capture was a screenshot of a
vendor dashboard, which shows BUCKETED INTENSITY rather than per-day totals,
so the series could not be reconstructed from it without inventing numbers.
The agent tool that produces the usage, however, already writes the raw
figures locally: one JSON object per line, each assistant message carrying a
`message.usage` object beside an ISO 8601 `timestamp`. Summing those is a
RECORDED measurement, not a reconstruction.

WHAT LEAVES THE WALK — this is the whole security argument, and requirement 12
of AGENTS.md is absolute about it. The transcripts contain prompts, responses,
file names, project directory names, session identifiers and machine-local
paths. NONE of that may reach the repository, and the git index is public.
So the only values this program is capable of emitting are:

  * calendar dates, as YYYY-MM-DD, derived from a timestamp; and
  * non-negative integers.

Nothing else is retained past the line that produced it. Message identifiers
are held only inside an in-memory de-duplication set and are never written or
printed. Diagnostics are COUNTS: a file that cannot be read is tallied, never
named, because an error string carrying a path is a leak with a friendly face.
`assert_only_dates_and_integers` re-proves the whole emission immediately
before anything is written or printed, so a future edit that starts carrying a
project name has to defeat an explicit check rather than slip past review.

WHAT IT COMPUTES, and why it matches the live mapper exactly. A day's total is
`input_tokens + output_tokens + cache_read_input_tokens +
cache_creation_input_tokens`, which is the same quantity
`internal/panels/mapping.go` sums out of the vendor usage API (uncached input
plus both cache classes, plus output). Days are UTC, like the mapper's. The
series runs contiguously from the oldest recorded day to the newest, with
zeros for days inside that window the record has nothing for — again the
mapper's own rule, and the reason the series never extends past the days the
record actually covers: a zero INSIDE the window is a measurement, a zero
outside it would be an invention.

The in-progress day is included, exactly as the live mapper includes the
newest (partial) bucket; `dailyStreaks` in the Go mapper tolerates one trailing
empty day for precisely that reason. The snapshot's `generatedAt` records the
instant of the capture, which is what makes a partial final day legible.

TILES. `--snapshot` splices the series into one named source and updates ONLY
the tiles that are a function of that series — `peak-day`, `current-streak`,
`longest-streak`, the three keys `mapUsage` derives from a daily series alone.
Every other recorded tile is left exactly as its own capture left it: this
program has no opinion about a lifetime total or a session count, and
overwriting a figure it cannot measure would be the invention the panel
doctrine forbids. Keeping the derived three in step with the shipped series is
the other half of the same rule — a tile that contradicts the graph printed
under it is the panel disagreeing with itself.

Dependency-free: Python 3 standard library only, no network, no writes outside
the snapshot path it is given.

    scripts/capture_usage_series.py --transcripts DIR --source LABEL \
        [--snapshot internal/panels/snapshots/token-usage.json]

With no `--snapshot` the series and its derived figures print to stdout as
JSON, so the capture can be inspected before it is committed to anything.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys

# The calendar-date form the series indexes by, mirroring dayLayout in
# internal/panels/types.go. The regex is the SHAPE only; valid_calendar_day
# below is the truth — a string can match this pattern and still name a day
# no calendar has (2026-99-99), so shape alone must never admit anything.
DAY_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# The shape a field NAME in the emission may take. Keys are this file's own
# vocabulary rather than anything read out of a transcript, so this is a
# tripwire and not a proof: what it catches cheaply is the realistic accident,
# a path, a file name, or a session identifier used as a key — each of which
# carries a separator, a dot, or more characters than a field name needs.
# Shape is necessary but NOT sufficient: EMISSION_KEYS below is the closed
# membership check, because `private-feature` is perfectly label-shaped and
# must still never leave this machine (2026-08-24 review finding H1).
KEY_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9-]{0,31}$")

# The CLOSED category vocabulary — the accounting classes a day's total may
# be partitioned into, and nothing else. It mirrors, and must stay equal to,
# categoryServeOrder in internal/panels/types.go and the frontend's fixed
# palette slots: the first four are the transcript usage fields this tool
# derives itself, the fifth is the reasoning class the second tool's capture
# reports. These are accounting terms, not vendor names, so spelling them
# here keeps the vendor-neutrality pin intact.
CATEGORY_KEYS = ("input", "output", "cache-read", "cache-write", "reasoning")

# Every field name the emission may legitimately contain, CLOSED. The guard
# refuses any dictionary key outside this set (plus the caller's explicitly
# declared extra keys — the operator-typed source labels, which the origin
# separately admits only against its embedded snapshot). Membership, not
# shape: a label-shaped private identifier used as a key must refuse.
EMISSION_KEYS = frozenset(
    {
        # Section names of one exported source.
        "series",
        "categories",
        "windows",
        "derived",
        # The series shape.
        "startDate",
        "totals",
        "recorded",
        # The window vocabulary and its two figures.
        "today",
        "week",
        # The derived-tile vocabulary (also declared below as STAT_*).
        "peak-day",
        "current-streak",
        "longest-streak",
    }
).union(CATEGORY_KEYS)

# The usage fields that make up one message's contribution to its day. The
# names are the transcript's; the SUM is what internal/panels/mapping.go
# computes from the vendor usage document, so a snapshot series and a live
# series are the same measurement.
USAGE_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
)

# Mirrors maxSeriesDays in internal/panels/types.go. A span past this is
# refused here rather than shipped and refused at load, because a snapshot the
# origin will not serve is worse than no snapshot at all.
MAX_SERIES_DAYS = 732

# The stat keys a daily series defines on its own — the same four
# internal/panels/types.go lists, minus the window total, which is a property
# of a fetch window rather than of a recorded series.
STAT_PEAK_DAY = "peak-day"
STAT_CURRENT_STREAK = "current-streak"
STAT_LONGEST_STREAK = "longest-streak"

# The key order one source is written back in, matching the field order of
# TokenUsageSource in internal/panels/types.go so the snapshot reads like the
# struct it decodes into.
SOURCE_KEY_ORDER = ("label", "account", "windows", "stats", "series", "insights")


class CaptureError(Exception):
    """A refusal. Its message never carries a path or any transcript content."""


def new_counters():
    """The tally a walk reports instead of naming anything it read."""
    return {"files": 0, "unreadable": 0, "lines": 0, "counted": 0, "duplicates": 0}


def read_records(root, counters):
    """Yield (day, total) pairs from every transcript under root.

    Every value this generator produces is already reduced to a date and an
    integer; the parsed record itself never escapes the loop body. Files that
    cannot be opened or lines that will not parse are skipped and tallied in
    `counters`, never named.
    """
    seen = set()
    for directory, _subdirectories, names in os.walk(root):
        for name in sorted(names):
            if not name.endswith(".jsonl"):
                continue
            counters["files"] += 1
            path = os.path.join(directory, name)
            try:
                handle = open(path, "r", encoding="utf-8", errors="replace")
            except OSError:
                # Counted, never named: see the module docstring.
                counters["unreadable"] += 1
                continue
            with handle:
                for line in handle:
                    counters["lines"] += 1
                    reduced = reduce_line(line, seen, counters)
                    if reduced is not None:
                        counters["counted"] += 1
                        yield reduced


def reduce_line(line, seen, counters):
    """Reduce one transcript line to (day, total), or None if it carries none.

    De-duplication is load-bearing rather than tidy. The tool replays earlier
    assistant messages into later transcript files when a session is resumed
    or forked, so the same billed message appears many times across the tree;
    counting each appearance roughly doubles every total. The identity is the
    message id paired with the request id, which is the pair the tool writes
    once per real inference. A record carrying neither is counted, because a
    missing identity is not evidence of a repeat.
    """
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
    day = utc_day(stamp)
    if day is None:
        return None
    return day, usage_total(usage)


def utc_day(stamp):
    """Return the UTC calendar date of an ISO 8601 instant, or None."""
    try:
        moment = datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=datetime.timezone.utc)
    return moment.astimezone(datetime.timezone.utc).date().isoformat()


def usage_total(usage):
    """Sum one message's usage fields, ignoring anything that is not a count.

    Booleans are rejected explicitly: `True` is an `int` in Python, and a
    usage field that ever arrived as a flag would otherwise add one token.
    """
    total = 0
    for field in USAGE_FIELDS:
        value = usage.get(field)
        if isinstance(value, int) and not isinstance(value, bool) and value > 0:
            total += value
    return total


def daily_series(pairs):
    """Build the contiguous day-indexed series from (day, total) pairs."""
    totals_by_day = {}
    for day, total in pairs:
        totals_by_day[day] = totals_by_day.get(day, 0) + total
    if not totals_by_day:
        raise CaptureError("no usage records found under the transcript root")
    days = sorted(totals_by_day)
    first = datetime.date.fromisoformat(days[0])
    last = datetime.date.fromisoformat(days[-1])
    span = (last - first).days + 1
    if span > MAX_SERIES_DAYS:
        raise CaptureError(
            "the record spans %d days, over the %d day bound the origin enforces"
            % (span, MAX_SERIES_DAYS)
        )
    totals = [
        totals_by_day.get((first + datetime.timedelta(days=offset)).isoformat(), 0)
        for offset in range(span)
    ]
    # `recorded` is what marks this as the out-of-band capture it is. The live
    # refresh path builds its series without it, so the flag is also how the
    # registry pin tells a shipped series from a fetched one.
    return {"startDate": days[0], "totals": totals, "recorded": True}


def daily_streaks(totals):
    """Current and longest runs of consecutive active days.

    A transliteration of dailyStreaks in internal/panels/mapping.go, including
    its one deliberate asymmetry: the CURRENT run tolerates one trailing empty
    day, because the newest day is the day in progress and an hour of quiet is
    not a broken streak. Two empty days end it.
    """
    longest = 0
    run = 0
    for total in totals:
        if total > 0:
            run += 1
            longest = max(longest, run)
        else:
            run = 0
    end = len(totals)
    if end > 0 and totals[end - 1] == 0:
        end -= 1
    current = 0
    index = end - 1
    while index >= 0 and totals[index] > 0:
        current += 1
        index -= 1
    return current, longest


def derived_figures(series):
    """The figures the series itself defines, keyed by their stat keys."""
    totals = series["totals"]
    current, longest = daily_streaks(totals)
    return {
        STAT_PEAK_DAY: max(totals),
        STAT_CURRENT_STREAK: current,
        STAT_LONGEST_STREAK: longest,
    }


def valid_calendar_day(value):
    """True only for a real YYYY-MM-DD calendar date with no extra bytes.

    Two checks, both load-bearing. `fullmatch` pins the exact shape including
    the string's END — `re.match` with `$` quietly tolerates one trailing
    newline, which is how `"2026-08-10\\n"` once passed review. Then the real
    calendar parse refuses impossible dates like 2026-99-99 that satisfy the
    digit shape but name no day (2026-08-24 review finding H1).
    """
    if not isinstance(value, str) or not DAY_PATTERN.fullmatch(value):
        return False
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        return False
    return True


def assert_only_dates_and_integers(value, where="emission", extra_keys=frozenset()):
    """Refuse anything that is not a calendar date, an integer, or a container.

    The last line of defence for requirement 12, deliberately placed between
    computation and output so it covers printing AND splicing. The checks are
    MEMBERSHIP checks, not shape checks (2026-08-24 review finding H1: a
    shape-only guard admitted label-shaped private identifiers, impossible
    calendar dates, newline-suffixed dates, and negative integers):

    * a dictionary key must be field-name shaped AND a member of the closed
      EMISSION_KEYS vocabulary — or of `extra_keys`, the caller's explicitly
      declared additions (the operator-typed source labels, which the origin
      additionally admits only against its embedded snapshot);
    * a string must be a REAL calendar date (exact shape, real calendar, not
      one byte more);
    * an integer must be non-negative — every emitted figure is a count;
    * a boolean is admitted only under the one field that declares one, the
      series' `recorded` flag.

    Any refusal names only the FIELD, never the value.
    """
    _assert_emission(value, where, frozenset(extra_keys), False)


def _assert_emission(value, where, extra_keys, allow_bool):
    if isinstance(value, bool):
        if allow_bool:
            return
        raise CaptureError("%s carries a boolean outside the recorded flag" % where)
    if isinstance(value, int):
        if value < 0:
            raise CaptureError("%s carries a negative integer" % where)
        return
    if isinstance(value, str):
        if valid_calendar_day(value):
            return
        raise CaptureError("%s carries a string that is not a calendar date" % where)
    if isinstance(value, list):
        for index, item in enumerate(value):
            _assert_emission(item, "%s[%d]" % (where, index), extra_keys, False)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str) or not KEY_PATTERN.fullmatch(key):
                raise CaptureError("%s carries a key that is not a field name" % where)
            if key not in EMISSION_KEYS and key not in extra_keys:
                raise CaptureError(
                    "%s carries a key outside the closed emission vocabulary" % where
                )
            _assert_emission(item, "%s.%s" % (where, key), extra_keys, key == "recorded")
        return
    raise CaptureError("%s carries a value that is neither a date nor an integer" % where)


def capture(root):
    """Walk the transcripts and return (series, derived, counters)."""
    counters = new_counters()
    series = daily_series(read_records(root, counters))
    derived = derived_figures(series)
    # Both halves are proven clean before either is printed or written.
    assert_only_dates_and_integers(series, "series")
    assert_only_dates_and_integers(derived, "derived")
    return series, derived, counters


def splice(document, label, series, derived, generated_at):
    """Return the snapshot document with one source's series and tiles updated.

    Only the named source is touched, only its series and the three tiles the
    series defines, and a tile is updated only where it ALREADY exists — this
    program adds no tile the owner did not choose to show.
    """
    data = document.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("sources"), list):
        raise CaptureError("the snapshot carries no token-usage sources")
    matched = False
    rebuilt = []
    for source in data["sources"]:
        if not isinstance(source, dict):
            raise CaptureError("the snapshot carries a source that is not an object")
        if source.get("label") != label:
            rebuilt.append(source)
            continue
        matched = True
        updated = dict(source)
        updated["series"] = series
        updated["stats"] = [update_stat(stat, derived) for stat in source.get("stats", [])]
        ordered = {key: updated[key] for key in SOURCE_KEY_ORDER if key in updated}
        # Anything the key order does not name is kept rather than dropped: a
        # field added to the payload later must survive a capture run.
        ordered.update({key: value for key, value in updated.items() if key not in ordered})
        rebuilt.append(ordered)
    if not matched:
        raise CaptureError("the snapshot has no source with the requested label")
    document["generatedAt"] = generated_at
    data["sources"] = rebuilt
    return document


def update_stat(stat, derived):
    """Replace one tile's value when the series defines that tile's figure."""
    if not isinstance(stat, dict):
        raise CaptureError("the snapshot carries a stat that is not an object")
    key = stat.get("key")
    if key not in derived:
        return stat
    if stat.get("unit") not in ("tokens", "days"):
        raise CaptureError("a series-derived tile carries a unit the series cannot fill")
    updated = dict(stat)
    updated["value"] = derived[key]
    return updated


def parse_arguments(argv):
    parser = argparse.ArgumentParser(
        description="Aggregate local agent transcripts into a panel activity series.",
    )
    parser.add_argument(
        "--transcripts",
        required=True,
        help="directory tree of newline-delimited JSON transcripts to walk",
    )
    parser.add_argument(
        "--source",
        required=True,
        help="the token-usage source label the series belongs to",
    )
    parser.add_argument(
        "--snapshot",
        help="snapshot file to splice the series into; prints to stdout when omitted",
    )
    return parser.parse_args(argv)


def main(argv=None):
    arguments = parse_arguments(sys.argv[1:] if argv is None else argv)
    root = os.path.expanduser(arguments.transcripts)
    if not os.path.isdir(root):
        # The path is the operator's own argument, so echoing it back leaks
        # nothing they did not just type; it still is not written anywhere.
        print("no such transcript directory", file=sys.stderr)
        return 2
    try:
        series, derived, counters = capture(root)
    except CaptureError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(
        "files=%d unreadable=%d lines=%d counted=%d duplicates=%d days=%d"
        % (
            counters.get("files", 0),
            counters.get("unreadable", 0),
            counters.get("lines", 0),
            counters.get("counted", 0),
            counters.get("duplicates", 0),
            len(series["totals"]),
        ),
        file=sys.stderr,
    )
    if arguments.snapshot is None:
        json.dump({"series": series, "derived": derived}, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0
    with open(arguments.snapshot, "r", encoding="utf-8") as handle:
        document = json.load(handle)
    generated_at = (
        datetime.datetime.now(datetime.timezone.utc)
        .replace(microsecond=0)
        .strftime("%Y-%m-%dT%H:%M:%SZ")
    )
    try:
        spliced = splice(document, arguments.source, series, derived, generated_at)
    except CaptureError as error:
        print(str(error), file=sys.stderr)
        return 1
    with open(arguments.snapshot, "w", encoding="utf-8") as handle:
        json.dump(spliced, handle, indent=2)
        handle.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
