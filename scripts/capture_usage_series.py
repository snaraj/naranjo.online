#!/usr/bin/env python3
"""Aggregate a local agent transcript tree into a panel activity series.

WHY THIS EXISTS. The token-usage panel's daily heatmap needs one combined
token total per calendar day. The previous capture was a screenshot of a
vendor dashboard, which shows BUCKETED INTENSITY rather than per-day totals,
so the series could not be reconstructed from it without inventing numbers.
The agent tools that produce the usage, however, already write the raw
figures locally: one JSON object per line, beside an ISO 8601 `timestamp`.
Summing those is a RECORDED measurement, not a reconstruction.

TWO RECORD SHAPES, ONE SERIES. The tools journal the same arithmetic in two
different ways, so the walk is parameterised by shape (`--format`) and
everything downstream — the day index, the streak arithmetic, the emission
guard, the splice — is shared:

  * `messages` — each line is one billed message carrying its own
    `message.usage` object. The tool REPLAYS earlier messages into later
    files on resume or fork, so the same billed message appears many times
    across the tree; identity de-duplication on the message/request id pair
    is what keeps a day from roughly doubling.

  * `running-totals` — each line may carry `payload.info.total_token_usage`,
    a RUNNING CUMULATIVE for the session so far, which repeats on every
    event. Naive summation multiplies the truth. The contribution of one
    record is therefore how far the running total ADVANCED since the
    previous record in the same file, attributed to that record's own UTC
    day — so a session spanning midnight splits across the two days it
    really happened on, exactly like the message shape does.

    Three cases exhaust the record, and all three are measured rather than
    assumed. The total ADVANCES on a real turn (the ordinary case). It
    REPEATS when the tool emits the same accounting twice for one turn —
    those records bill nothing and contribute zero, which is precisely the
    replay trap. And it RESTARTS from a lower figure when a session resets
    its own accounting mid-file; the record shows the restarting value is
    that turn's own usage, so the contribution is the new total itself. A
    reader that instead took one final total per file would silently lose
    everything before each restart.

    A record whose running total is absent or unusable advances nothing, so
    a shape change in the journal degrades to a loud refusal — no records
    found — rather than to a quietly wrong number.

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

WHAT IT COMPUTES, and why it matches the live mapper exactly. Under the
`messages` shape a day's total is `input_tokens + output_tokens +
cache_read_input_tokens + cache_creation_input_tokens`, which is the same
quantity `internal/panels/mapping.go` sums out of the vendor usage API
(uncached input plus both cache classes, plus output) — those four fields are
DISJOINT in that record shape. Under `running-totals` the record's own
`total_tokens` is that same whole: measured across the owner's tree,
`total_tokens` equals `input_tokens + output_tokens` on every well-formed
record, while `cached_input_tokens`, `cache_write_input_tokens` and
`reasoning_output_tokens` are SUBSETS of those two rather than additions to
them — so adding them would count the same tokens two and three times. The
two shapes therefore report the same measurement: every token the tool
processed. Days are UTC, like the mapper's. The
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

WHAT IT CANNOT DO, and what enforces that. When this module runs as the
scheduled runtime producer it runs inside a kernel sandbox
(`scripts/usage-export/producer.sb`, applied by the push script) that denies
`process-fork` and `network*`: no process can be created and no socket can be
opened for the whole walk, whatever this file's source says. That is the
capability boundary.

This module's import surface is separately held to a CLOSED allowlist by its
test suite — a file reader, a date library, a JSON codec, an argument parser,
a pattern matcher, the interpreter's own streams, an errno table, and `os`.
That last one was refused until the 2026-08-25 round-4 review, and this
paragraph said so for a while after it stopped being true; it is admitted now
because the transcript walk is DESCRIPTOR-ROOTED (round-5 finding 1) and
Python exposes `dir_fd`, `O_NOFOLLOW` and `O_DIRECTORY` nowhere else. Refusing
the import would have meant keeping a real filesystem escape in order to
preserve a smaller surface that — since round 3 — carries no capability claim
anyway. The narrower pin that replaced it is an enumerated `os.` ATTRIBUTE
allowlist in the same suite. That pin bounds the REVIEWED SURFACE and makes a
widening a conscious, named edit.
It is not a proof of capability absence, and the 2026-08-24 round-3 review is
why this paragraph now says so: `pathlib` is admitted and re-exports `os`, so
`pathlib.os.system(...)` reaches a launch callable with the import set
unchanged. Reading these journals launches nothing — they are inert files and
this program never executes the tools that wrote them — and the sandbox is
what makes that a guarantee rather than a description.

Dependency-free: Python 3 standard library only, no network, no writes outside
the snapshot path it is given.

    scripts/capture_usage_series.py --transcripts DIR --source LABEL \
        [--format messages|running-totals] \
        [--snapshot internal/panels/snapshots/token-usage.json]

With no `--snapshot` the series and its derived figures print to stdout as
JSON, so the capture can be inspected before it is committed to anything.
"""

from __future__ import annotations

import argparse
import datetime
import errno
import json
import os
import pathlib
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

# The record shapes the walk knows how to read, named for what the record
# CONTAINS rather than for the tool that wrote it: a shape is a journal
# format, and a format that acquires a vendor's name in code is a coupling
# nobody asked for.
FORMAT_MESSAGES = "messages"
FORMAT_RUNNING_TOTALS = "running-totals"
RECORD_FORMATS = (FORMAT_MESSAGES, FORMAT_RUNNING_TOTALS)

# Where a running-totals record keeps its cumulative figure, and the single
# field inside it that is the whole. Measured on the owner's tree: this field
# equals input plus output on every well-formed record, and the cache and
# reasoning fields beside it are subsets of those two — see the module
# docstring. Reading the whole rather than re-summing the parts is also what
# keeps the reader correct for records that report only the aggregate.
RUNNING_USAGE_KEY = "total_token_usage"
RUNNING_TOTAL_FIELD = "total_tokens"

# The one file extension either shape is journalled in.
RECORD_SUFFIX = ".jsonl"

# Mirrors maxSeriesDays in internal/panels/types.go. A span past this is
# refused here rather than shipped and refused at load, because a snapshot the
# origin will not serve is worse than no snapshot at all.
MAX_SERIES_DAYS = 732

# THE upper bound on every count this pipeline emits, and it is ONE number
# three languages agree on (2026-08-24 round-3 review, finding 9). It mirrors
# maxCountValue in internal/panels/types.go and Number.isSafeInteger in
# frontend/src/lib/token-usage.ts; CountBoundParityTest pins all three.
#
# Python integers are arbitrary precision, so nothing here overflows — which
# is precisely the problem the bound solves. An unbounded figure emitted here
# is a figure the Go boundary has to reason about in int64 (where three
# authenticated, non-negative category values summed to zero by wrapping) and
# the browser has to render in a float64 (where it silently rounds). Refusing
# it at the producer means the three stages cannot disagree about what a
# count is.
MAX_COUNT = 2**53 - 1

# RESOURCE BOUNDS ON THE RAW WALK (2026-08-24 round-3 review, finding 10).
# Everything below is checked BEFORE the work it bounds, because the failure
# this prevents is the scheduled producer exhausting the workstation on a tree
# it was pointed at — a single unterminated line, a pathological directory
# depth, or an unbounded de-duplication set will kill the run long before the
# privacy guard at the far end ever gets to look at the emission. The numbers
# are generous against a real transcript tree and finite against a hostile
# one; every refusal names the BOUND and never the path that hit it.
MAX_RECORD_FILES = 20_000
MAX_TREE_DEPTH = 16
MAX_RECORD_LINE_BYTES = 4 << 20
MAX_RECORD_LINES = 5_000_000
MAX_RECORD_BYTES = 2 << 30
MAX_DEDUP_IDENTITIES = 2_000_000

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
    return {
        "files": 0,
        "unreadable": 0,
        "lines": 0,
        "counted": 0,
        "duplicates": 0,
        "restarts": 0,
        # Bytes actually read, against MAX_RECORD_BYTES, and entries skipped
        # for being symbolic links. Both are diagnostics AND bounds: the walk
        # refuses past the byte ceiling, and a skipped link is something an
        # operator should be able to see happened without being told where
        # (2026-08-24 round-3 review, finding 10).
        "bytes": 0,
        "symlinks": 0,
    }


# The POSIX file-type bits, spelled here rather than imported from `stat`,
# because a handful of constants are not worth another module on a surface
# this narrow. The walk tests st_mode itself rather than asking pathlib,
# because `Path.is_dir()` and `Path.is_file()` answer about the TARGET of a
# link and this walk must answer about the entry.
FILE_TYPE_MASK = 0o170000
REGULAR_FILE = 0o100000
DIRECTORY = 0o040000
SYMBOLIC_LINK = 0o120000


def _identity(info):
    """The (device, inode) pair that names one file to the kernel.

    Compared only between stat results obtained through the SAME rooted
    capability chain (2026-08-25 round-5 review, finding 1): an identity taken
    through an attacker-controlled path names whatever the attacker pointed
    at, so it matches itself and proves nothing.
    """
    return (info.st_dev, info.st_ino)


def _descend(parent, name, counters):
    """Open one child directory THROUGH parent, never by path. None on refusal.

    `dir_fd` is what makes this a capability rather than a lookup: the kernel
    resolves `name` relative to the open descriptor, and `name` is a single
    component from `os.listdir`, which POSIX guarantees contains no separator
    and is never `.` or `..`. With `O_NOFOLLOW` there is therefore nothing
    left for a symbolic link to redirect — the whole remaining lookup is one
    component that must not be a link.

    ELOOP and ENOTDIR are the two errno values a swap produces, so they are
    tallied as symlinks; anything else is an ordinary unreadable directory.
    """
    try:
        return os.open(
            name,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_DIRECTORY | os.O_CLOEXEC,
            dir_fd=parent,
        )
    except OSError as failure:
        if failure.errno in (errno.ELOOP, errno.ENOTDIR):
            counters["symlinks"] += 1
        else:
            counters["unreadable"] += 1
        return None


def admitted_records(root, counters=None):
    """Every journal file under root, in one deterministic order, each paired
    with the IDENTITY it had when it was admitted and the ROOTED path by which
    it may be re-opened.

    DESCRIPTOR-ROOTED TRAVERSAL (2026-08-25 round-5 review, finding 1). The
    previous walk was path-based: it proved containment with `resolve()`, took
    an identity with a LATER path-based `lstat`, and opened with a path-based
    `os.open`. Every one of those three re-resolves the name from the
    filesystem root, and `O_NOFOLLOW` protects only the FINAL component — so
    an INTERMEDIATE directory could be replaced with a symbolic link after
    containment and before the lstat. The reviewer did exactly that: renamed
    the parent, put a link to an outside tree in its place, and the walk
    recorded the OUTSIDE file's identity, opened through the link, matched
    that tainted identity against itself, and read private content. Carrying
    an identity forward proves nothing when the identity itself was taken
    through the attacker's path.

    So no path is ever re-resolved below the root. The root is opened once and
    every component beneath it is reached with `dir_fd` from the component
    before it, `O_NOFOLLOW` on each, so a link anywhere along the chain is
    refused at the kernel rather than followed. Containment stops being a
    check and becomes a property: a descent that only ever opens single
    non-symlink components of an already-opened directory cannot leave the
    tree, which is why the old `resolve().is_relative_to()` test is gone
    rather than kept as reassurance — it was the weaker statement of a thing
    now guaranteed by construction.

    The root itself is opened by path, and that is the honest boundary: it is
    the configured trust anchor, not attacker-controlled tree content. Its
    identity is recorded and re-checked when a record is opened, so even a
    root swapped between the walk and the read is refused.

    Sorted because two runs over the same tree must produce the same series,
    and because the running-totals shape reads each file as a SEQUENCE — an
    order that varied by filesystem would make the walk's arithmetic vary with
    it. The key is the joined relative path, which reproduces the ordering the
    previous `pathlib.Path` sort produced.

    NO-FOLLOW AND BOUNDED (2026-08-24 round-3 review, finding 10), unchanged:

      * a symbolic link is SKIPPED, leaf or directory alike, and tallied;
      * depth and file count are bounded before descending or admitting;
      * an unreadable directory is tallied and skipped, never named.
    """
    counters = new_counters() if counters is None else counters
    try:
        anchor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    except OSError:
        raise CaptureError("the transcript root cannot be opened")
    admitted = []
    try:
        root_identity = _identity(os.fstat(anchor))
        pending = [(anchor, (), 0)]
        try:
            while pending:
                directory, components, depth = pending.pop()
                try:
                    if depth > MAX_TREE_DEPTH:
                        raise CaptureError(
                            "the transcript tree is deeper than the %d level bound"
                            % MAX_TREE_DEPTH
                        )
                    try:
                        names = os.listdir(directory)
                    except OSError:
                        # Counted, never named: see the module docstring.
                        counters["unreadable"] += 1
                        continue
                    for name in names:
                        try:
                            info = os.lstat(name, dir_fd=directory)
                        except OSError:
                            counters["unreadable"] += 1
                            continue
                        kind = info.st_mode & FILE_TYPE_MASK
                        if kind == SYMBOLIC_LINK:
                            counters["symlinks"] += 1
                            continue
                        if kind == DIRECTORY:
                            child = _descend(directory, name, counters)
                            if child is not None:
                                pending.append((child, components + (name,), depth + 1))
                            continue
                        if kind != REGULAR_FILE:
                            continue
                        if name[-len(RECORD_SUFFIX):] != RECORD_SUFFIX:
                            continue
                        admitted.append(
                            (root, root_identity, components + (name,), _identity(info))
                        )
                        if len(admitted) > MAX_RECORD_FILES:
                            raise CaptureError(
                                "the transcript tree holds more than the %d file bound"
                                % MAX_RECORD_FILES
                            )
                finally:
                    if directory != anchor:
                        os.close(directory)
        finally:
            for directory, _, _ in pending:
                if directory != anchor:
                    os.close(directory)
    finally:
        os.close(anchor)
    return sorted(admitted, key=lambda record: "/".join(record[2]))


def bounded_lines(handle, counters):
    """Yield one journal file's lines under the line, count, and byte bounds.

    `readline` is given an explicit limit so an unterminated multi-gigabyte
    line is refused BEFORE it is read into memory — iterating the handle
    would have read it first and refused afterwards, which is the failure
    mode, not the fix (2026-08-24 round-3 review, finding 10).
    """
    while True:
        line = handle.readline(MAX_RECORD_LINE_BYTES + 1)
        if not line:
            return
        if len(line) > MAX_RECORD_LINE_BYTES:
            raise CaptureError(
                "a transcript line is longer than the %d byte bound" % MAX_RECORD_LINE_BYTES
            )
        counters["lines"] += 1
        if counters["lines"] > MAX_RECORD_LINES:
            raise CaptureError(
                "the transcript tree holds more than the %d line bound" % MAX_RECORD_LINES
            )
        counters["bytes"] += len(line)
        if counters["bytes"] > MAX_RECORD_BYTES:
            raise CaptureError(
                "the transcript tree is larger than the %d byte bound" % MAX_RECORD_BYTES
            )
        yield line


def remember_identity(identity, seen):
    """Add one de-duplication identity under the set's own size bound."""
    if len(seen) >= MAX_DEDUP_IDENTITIES:
        raise CaptureError(
            "the walk holds more than the %d record identity bound" % MAX_DEDUP_IDENTITIES
        )
    seen.add(identity)


def open_record_file(record, counters):
    """Open one admitted journal file, or tally the refusal and return None.

    DESCRIPTOR-ROOTED, NO-FOLLOW AT EVERY COMPONENT (2026-08-25 round-5
    review, finding 1). Round 4 put `O_NOFOLLOW` on this open and called the
    read no-follow. It was not: `O_NOFOLLOW` constrains the FINAL component
    only, and the path handed to it was rebased from the filesystem root, so
    every directory above the leaf was re-resolved here and a link swapped in
    at any of them was followed. The reviewer proved it by replacing the
    leaf's PARENT.

    This re-walks the same chain the admitting walk walked, the same way:
    the root by path, then every component beneath it through `dir_fd` from
    the component before it, `O_NOFOLLOW` on each, single components only. No
    absolute or rebased path is ever handed to the kernel below the root.

    Four things must hold, and each answers a different substitution:

      * the ROOT still has the identity the walk anchored on, so a root
        swapped between the walk and this read is refused rather than
        silently becoming the new anchor;
      * every intermediate component opens as a real directory that is not a
        link — the escape the round-5 review found;
      * `fstat` on the resulting DESCRIPTOR — not on a path — confirms a
        regular file, so a fifo or device swapped in is refused rather than
        read. `O_NONBLOCK` rides along for that case specifically and is not
        decoration: opening a fifo read-only BLOCKS until a writer appears,
        so without it a swapped-in fifo would hang this hourly unattended job
        forever instead of being refused. It has no effect on the regular
        files this tool actually reads, and the descriptor is closed before
        any read whenever fstat says the leaf is not one;
      * the (device, inode) identity — now obtained through the rooted chain
        on BOTH sides — is compared against what the walk admitted, which
        catches an ordinary regular file swapped for a DIFFERENT ordinary
        regular file, including through a hard link.

    Failures are tallied and never named, exactly as before.
    """
    root, root_identity, components, identity = record
    try:
        parent = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    except OSError:
        counters["unreadable"] += 1
        return None
    leaf = None
    try:
        if _identity(os.fstat(parent)) != root_identity:
            counters["symlinks"] += 1
            return None
        for name in components[:-1]:
            child = _descend(parent, name, counters)
            if child is None:
                return None
            os.close(parent)
            parent = child
        try:
            leaf = os.open(
                components[-1],
                os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK,
                dir_fd=parent,
            )
        except OSError as failure:
            # An O_NOFOLLOW refusal and an ordinary unreadable file are told
            # apart by errno only. Neither is ever named: this tool's contract
            # is that a file it cannot read is a number.
            if failure.errno in (errno.ELOOP, errno.ENOTDIR):
                counters["symlinks"] += 1
            else:
                counters["unreadable"] += 1
            return None
    except OSError:
        counters["unreadable"] += 1
        return None
    finally:
        os.close(parent)
    try:
        info = os.fstat(leaf)
        if (info.st_mode & FILE_TYPE_MASK) != REGULAR_FILE:
            os.close(leaf)
            counters["symlinks"] += 1
            return None
        if _identity(info) != identity:
            os.close(leaf)
            counters["symlinks"] += 1
            return None
        return os.fdopen(leaf, "r", encoding="utf-8", errors="replace")
    except OSError:
        os.close(leaf)
        counters["unreadable"] += 1
        return None


def read_records(root, counters):
    """Yield (day, total) pairs from every message-shaped record under root.

    Every value this generator produces is already reduced to a date and an
    integer; the parsed record itself never escapes the loop body. Files that
    cannot be opened or lines that will not parse are skipped and tallied in
    `counters`, never named.
    """
    seen = set()
    for record in admitted_records(root, counters):
        counters["files"] += 1
        handle = open_record_file(record, counters)
        if handle is None:
            continue
        with handle:
            for line in bounded_lines(handle, counters):
                reduced = reduce_line(line, seen, counters)
                if reduced is not None:
                    counters["counted"] += 1
                    yield reduced


def read_running_totals(root, counters):
    """Yield (day, advance) pairs from every running-totals record under root.

    The running total is per FILE — every journal in the owner's tree opens
    its own accounting at zero — so the high-water mark resets at each file
    and a session's history is never counted twice because a later session
    resumed it.

    The three cases in the module docstring, made operational. `advance`
    is the distance the running total moved, so a record that repeats the
    previous accounting contributes nothing and a record that restarts a
    lower accounting contributes its own new total. Both are tallied so the
    diagnostics say how much of the walk was replay and how much was a
    restart, without naming a single file.
    """
    for record in admitted_records(root, counters):
        counters["files"] += 1
        handle = open_record_file(record, counters)
        if handle is None:
            continue
        previous = 0
        with handle:
            for line in bounded_lines(handle, counters):
                reduced = reduce_running_line(line)
                if reduced is None:
                    continue
                day, running = reduced
                if running == previous:
                    counters["duplicates"] += 1
                    continue
                if running > previous:
                    advance = running - previous
                else:
                    counters["restarts"] += 1
                    advance = running
                previous = running
                if advance <= 0:
                    continue
                counters["counted"] += 1
                yield day, advance


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
        remember_identity(identity, seen)
    day = utc_day(stamp)
    if day is None:
        return None
    return day, usage_total(usage)


def reduce_running_line(line):
    """Reduce one running-totals line to (day, running total), or None.

    No de-duplication set here, and that is the point of the shape: identity
    is not what protects this walk from a replay, ARITHMETIC is. A repeated
    accounting reports the same cumulative figure, so it advances the total
    by nothing wherever it appears and however often — which is a stronger
    guarantee than an identity check, because it needs no identifier to be
    present, unique, or stable.
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
    payload = record.get("payload")
    if not isinstance(payload, dict):
        return None
    info = payload.get("info")
    if not isinstance(info, dict):
        return None
    running = info.get(RUNNING_USAGE_KEY)
    if not isinstance(running, dict):
        return None
    stamp = record.get("timestamp")
    if not isinstance(stamp, str):
        return None
    day = utc_day(stamp)
    if day is None:
        return None
    return day, running_total(running)


def running_total(usage):
    """The cumulative figure one running-totals record reports, or 0.

    Booleans are rejected for the same reason `usage_total` rejects them, and
    a missing or malformed field reads as no advance rather than as a guess:
    a walk that found nothing refuses loudly in `daily_series`, which is the
    honest failure for a journal whose shape has changed.
    """
    value = usage.get(RUNNING_TOTAL_FIELD)
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return 0


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
    * an integer must be non-negative AND within MAX_COUNT — every emitted
      figure is a count, and one the Go boundary and the browser can both
      represent exactly (2026-08-24 round-3 review, finding 9);
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
        if value > MAX_COUNT:
            raise CaptureError("%s carries an integer above the shared count bound" % where)
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


def capture(root, record_format=FORMAT_MESSAGES):
    """Walk the transcripts and return (series, derived, counters).

    The shape decides only HOW a record becomes a (day, integer) pair. Every
    step after that — the contiguous day index, the streak arithmetic, and
    the emission guard below — is the same code for both, so a second reader
    can never acquire a second privacy contract.
    """
    if record_format not in RECORD_FORMATS:
        raise CaptureError("unknown record format")
    counters = new_counters()
    reader = read_records if record_format == FORMAT_MESSAGES else read_running_totals
    series = daily_series(reader(root, counters))
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
        "--format",
        dest="record_format",
        choices=RECORD_FORMATS,
        default=FORMAT_MESSAGES,
        help="the record shape the tree is journalled in",
    )
    parser.add_argument(
        "--snapshot",
        help="snapshot file to splice the series into; prints to stdout when omitted",
    )
    return parser.parse_args(argv)


def main(argv=None):
    arguments = parse_arguments(sys.argv[1:] if argv is None else argv)
    root = pathlib.Path(arguments.transcripts).expanduser()
    if not root.is_dir():
        # The path is the operator's own argument, so echoing it back leaks
        # nothing they did not just type; it still is not written anywhere.
        print("no such transcript directory", file=sys.stderr)
        return 2
    try:
        series, derived, counters = capture(root, arguments.record_format)
    except CaptureError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(
        "files=%d unreadable=%d symlinks=%d lines=%d counted=%d duplicates=%d "
        "restarts=%d days=%d"
        % (
            counters.get("files", 0),
            counters.get("unreadable", 0),
            counters.get("symlinks", 0),
            counters.get("lines", 0),
            counters.get("counted", 0),
            counters.get("duplicates", 0),
            counters.get("restarts", 0),
            len(series["totals"]),
        ),
        file=sys.stderr,
    )
    generated_at = (
        datetime.datetime.now(datetime.timezone.utc)
        .replace(microsecond=0)
        .strftime("%Y-%m-%dT%H:%M:%SZ")
    )
    if arguments.snapshot is None:
        # generatedAt is attached AFTER the guard, exactly as the snapshot
        # path attaches it below: the guard admits calendar dates and
        # integers, and this is an INSTANT. It is required rather than
        # decorative — export_usage_series.py reads this document as a merge
        # source and refuses one that cannot say when it was captured, because
        # a second tool's series can be arbitrarily older than the export
        # carrying it (2026-08-24 round-3 review, finding 5).
        json.dump(
            {"generatedAt": generated_at, "series": series, "derived": derived},
            sys.stdout,
            indent=2,
        )
        sys.stdout.write("\n")
        return 0
    with open(arguments.snapshot, "r", encoding="utf-8") as handle:
        document = json.load(handle)
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
