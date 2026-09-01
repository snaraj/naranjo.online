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
    previous record in the same file, attributed to that record's own LOCAL
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

WHAT ONE CAPTURE EMITS. One section, in exactly the shape the runtime
exporter's merge loader admits and the origin's data root then merges: the
aggregate daily series, a per-day CATEGORY partition of it, a per-day MODEL
partition of it, the complete aggregate window set, and the complete set of
series-derived tiles. One shape from one function is the point — the second
tool's section used to be assembled by hand, which is how it came to be
missing two required sections and refusing every export until somebody
noticed (2026-08-27).

BREAKDOWNS ARE WINDOWED, AND THEY SAY SO. A breakdown covers a contiguous
TRAILING window of the series and declares where it starts; absent, it is
aligned with the series. Two different reasons produce a shorter window and
both are honest rather than degraded. The category split can only cover days
whose records carry one, so a series extended into days the journals have
lost carries its categories over the days that still have journals. The model
split is bounded by a byte BUDGET — a row costs one integer per day per
member, and at the series-day bound the section alone would outweigh the
whole payload ceiling — so it covers a declared trailing quarter. A window
that is stated is a window a reader can be told about; a window that is
silently truncated is a lie about depth.

DEPTH SURVIVES PRUNING. The journals are deleted on the tool's own schedule,
so a walk alone measures a history that gets SHORTER on its own. `--activity-
cache` reads the tool's own per-day, per-model roll-up for the days the walk
has lost. The union is by date and the WALK wins every day it covers: the two
are different measurements (the walk de-duplicates replayed records, the
roll-up does not, and on the owner's tree they differ by roughly a factor of
two), so mixing them inside one day would produce a figure neither tool ever
measured.

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
processed. Days are the WORKSTATION'S LOCAL calendar days — an explicit
ruling, not a default (issue #276, owner ruling 2026-09-01). The vendors'
own surfaces bucket in the owner's local days, so UTC bucketing put a
visible ±1-day skew on every figure near a day boundary: a streak the
vendor showed as 12 read 13 here because a late evening had already
crossed UTC midnight. `local_day` below is where the decision is enforced,
per instant and DST-correct, and the capture-instant "today" the windows
and streaks read follows the same clock, so the whole emission buckets one
way. The
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
`longest-streak`, `active-days`, `tracked-days`: the five keys a daily series
defines on its own (the last two joined at issue #276, precisely because
tiles outside the derived vocabulary sat frozen beneath a graph that
contradicted them).
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
        [--activity-cache FILE] \
        [--history-store FILE] \
        [--snapshot internal/panels/snapshots/token-usage.json]

With no `--snapshot` the complete section prints to stdout as JSON, so the
capture can be inspected before it is committed to anything — and so that one
invocation is a valid merge source for the runtime exporter with no hand
assembly anywhere between them.
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

# The CLOSED model vocabulary, in the order it is served, and the same list
# the origin's modelServeOrder and the frontend's modelSlots carry — pinned
# across the three by ModelVocabularyParityTest exactly as the category
# vocabulary is. The members are MACHINE KEYS, never display copy: a key is
# what crosses the boundary, and the reader that renders it resolves its own
# label from its own copy of this list. That split is what lets the emission
# guard below stay a closed membership check — a display label carries spaces
# and dots and could never be a field name — and it is why no product name is
# spelled anywhere in this file.
#
# `other` is index 0 BY RULE, not by convention: it is the reserved residual
# member, the class every token that this tool cannot attribute to a
# vocabulary member falls into. It is never a named entity's slot, so a
# reader's colour for a named model never lands on the residual.
#
# The list is APPEND-ONLY. An index is a colour, so reusing or reordering one
# repaints history under a different entity; a retired model keeps its slot
# as a tombstone rather than freeing it.
MODEL_KEYS = ("other", "fable-5", "opus-5", "sonnet-5", "opus-4-8")

# The reserved residual member, spelled once.
MODEL_OTHER = "other"

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
        "models",
        "windows",
        "derived",
        # The series shape.
        "startDate",
        "totals",
        "recorded",
        # Where a windowed breakdown section begins. Both are optional and
        # both mean the same thing: the section covers a TRAILING window of
        # the series rather than all of it, because the section can only
        # measure the days its own record covers. Absent means "aligned with
        # the series", which is what every document written before these
        # existed says by omission.
        "categoriesStartDate",
        "modelsStartDate",
        # The window vocabulary and its two figures.
        "today",
        "week",
        # The derived-tile vocabulary (also declared below as STAT_*).
        "peak-day",
        "current-streak",
        "longest-streak",
        "active-days",
        "tracked-days",
        # The captured-stats section and the two of its keys the category
        # vocabulary does not already carry (also declared below as STATS_*).
        "stats",
        "lifetime",
        "sessions",
    }
).union(CATEGORY_KEYS).union(MODEL_KEYS)

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

# The running-totals record's remaining fields, and the accounting classes
# they resolve to. They are NOT additions to the total: measured across the
# owner's tree, `input_tokens + output_tokens == total_tokens` on every
# well-formed record, while the cached/cache-write fields are SUBSETS of the
# input side and the reasoning field is a SUBSET of the output side. So the
# five-way partition is built by SUBTRACTION — the input class keeps what the
# cache classes do not claim, the output class keeps what reasoning does not —
# and the parts then sum to the record's own total by construction rather
# than by hope. running_parts below checks that construction anyway and
# degrades in two named steps rather than emitting a partition that lies.
RUNNING_INPUT_FIELD = "input_tokens"
RUNNING_OUTPUT_FIELD = "output_tokens"
RUNNING_CACHE_READ_FIELD = "cached_input_tokens"
RUNNING_CACHE_WRITE_FIELD = "cache_write_input_tokens"
RUNNING_REASONING_FIELD = "reasoning_output_tokens"
RUNNING_FIELDS = (
    RUNNING_TOTAL_FIELD,
    RUNNING_INPUT_FIELD,
    RUNNING_OUTPUT_FIELD,
    RUNNING_CACHE_READ_FIELD,
    RUNNING_CACHE_WRITE_FIELD,
    RUNNING_REASONING_FIELD,
)

# The transcript usage fields of the MESSAGE shape mapped to their served
# category keys. The FIELD names are the transcript's own; the KEYS are the
# canonical vocabulary above. These four are DISJOINT, so a message's parts
# partition its own total with no subtraction at all.
CATEGORY_FIELDS = (
    ("input_tokens", "input"),
    ("output_tokens", "output"),
    ("cache_read_input_tokens", "cache-read"),
    ("cache_creation_input_tokens", "cache-write"),
)

# Where the message shape records which model produced it. The value is a
# vendor-qualified identifier; model_key below reduces it to this file's own
# vocabulary WITHOUT ever spelling one.
MESSAGE_MODEL_FIELD = "model"

# The one file extension either shape is journalled in.
RECORD_SUFFIX = ".jsonl"

# Mirrors maxSeriesDays in internal/panels/types.go. A span past this is
# refused here rather than shipped and refused at load, because a snapshot the
# origin will not serve is worse than no snapshot at all.
MAX_SERIES_DAYS = 732

# THE upper bound on every count this pipeline emits, and it is ONE number
# three languages agree on (2026-08-24 round-3 review, finding 9). It mirrors
# maxCountValue in internal/panels/types.go and Number.isSafeInteger in
# frontend/src/lib/token-usage.ts (countBound). All three are pinned BY VALUE
# — each language's own spelling evaluated, not matched as text — by
# "the count bound is the same number in Go, Python and TypeScript" in
# frontend/tests/panels-ui.test.mjs.
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
# RESIZED 2026-08-27, against a measurement rather than a guess. At 2 GiB this
# bound was smaller than a real transcript tree on the owner's own machine —
# one of them measures over three gigabytes — so the walk refused before it
# reached a single record, and the tool it was meant to read had to be
# hand-transcribed instead. A bound that refuses the ordinary case is not a
# guard, it is an outage with a comment.
#
# It stays a bound, and the two beside it are why it can afford to be a
# generous one: the walk is STREAMING (no file is held whole), the per-LINE
# bound is what keeps memory finite, and the file and line counts below still
# stop a pathological tree. This one bounds the WORK an unattended hourly job
# may do, so it is sized to leave real headroom over a growing record rather
# than to sit just above today's.
MAX_RECORD_BYTES = 16 << 30
MAX_DEDUP_IDENTITIES = 2_000_000

# The CLOSED window vocabulary and the span the week window covers. Closed on
# both ends of the pipe: the origin refuses any other key, so none can be
# produced here.
WINDOW_TODAY = "today"
WINDOW_WEEK = "week"
WEEK_DAYS = 7

# How many trailing days the per-model breakdown may cover. It is a BUDGET,
# not a limit of the record: a per-model row costs one integer per day per
# member, and at the series-day bound the section alone would outweigh the
# entire payload ceiling every stage of this pipeline enforces. A quarter is
# the reserve the shared ceiling can carry with room left for the aggregate
# and its categories, and the covered range is DECLARED (the section carries
# its own start date) so a reader is told what it is looking at rather than
# shown a silent truncation.
MAX_MODEL_DAYS = 92

# The tool's own per-day roll-up, named for what it contains. `activity_days`
# explains why a second, weaker source of the same measurement exists at all;
# these are the three field names it reads and the bound the document is read
# under.
ACTIVITY_CACHE_DAILY_KEY = "dailyModelTokens"
ACTIVITY_CACHE_DATE_KEY = "date"
ACTIVITY_CACHE_MODELS_KEY = "tokensByModel"
MAX_ACTIVITY_CACHE_BYTES = 1 << 20

# The same cache document also carries the tool's own LIFETIME accounting —
# per-model running totals and a session tally — which is the record the
# lifetime-class tiles must track (issue #276: those tiles sat frozen at
# their release-time values while the graph below them kept moving). The
# field names are the tool's own; the emitted keys are this file's closed
# stats vocabulary below.
ACTIVITY_CACHE_USAGE_KEY = "modelUsage"
ACTIVITY_CACHE_SESSIONS_KEY = "totalSessions"
ACTIVITY_CACHE_USAGE_FIELDS = (
    ("inputTokens", "input"),
    ("outputTokens", "output"),
    ("cacheReadInputTokens", "cache-read"),
    ("cacheCreationInputTokens", "cache-write"),
)

# The durable per-source history store (issue #234). Every source this
# pipeline reads is VOLATILE: the transcript trees are retention-pruned on
# their tools' own schedules, and the first tool's roll-up cache has been
# measured discarding a month of days in one recompute. A pipeline that
# re-derives the whole series from those sources every hour therefore serves
# a history that silently gets SHORTER — days that WERE captured, sealed and
# served become zeros the moment their last local evidence is deleted, which
# is exactly the defect the owner reported on 2026-08-28. The store is the
# pipeline's own memory: a machine-local file (never in any repository)
# holding, per calendar day, the best figure a real capture has measured, so
# a day survives its sources. It preserves measurements only — a day no
# capture ever measured is absent from it forever, never zero-filled.
HISTORY_SCHEMA = "usage-history/v1"
HISTORY_SCHEMA_KEY = "schema"
HISTORY_DAYS_KEY = "days"
HISTORY_TOTAL_KEY = "total"
MAX_HISTORY_STORE_BYTES = 1 << 20

# The stat keys a daily series defines on its own — the same set
# internal/panels/types.go's usageSeriesDerivedKeys lists, and pinned against
# it by DerivedVocabularyParityTest exactly as the category vocabulary is.
# The live mapper computes the first three and deliberately NOT the last two:
# its series covers only a fetch window, and "active days" or "days tracked"
# measured over seven fetched days would replace a recorded whole-history
# figure with a window-bounded one.
STAT_PEAK_DAY = "peak-day"
STAT_CURRENT_STREAK = "current-streak"
STAT_LONGEST_STREAK = "longest-streak"
STAT_ACTIVE_DAYS = "active-days"
STAT_TRACKED_DAYS = "tracked-days"

# The CLOSED captured-stats vocabulary (issue #276): the lifetime-class
# figures a push may refresh, each a RECORDED capture of the tool's own
# accounting rather than a function of the series. Mirrors — and is pinned
# by StatsVocabularyParityTest against — usageSeriesStatKeys in
# internal/panels/types.go. The origin refreshes only tiles the shipped
# snapshot already shows, so a key here can never ADD a tile.
STAT_LIFETIME = "lifetime"
STAT_SESSIONS = "sessions"
STATS_KEYS = (
    STAT_LIFETIME,
    "input",
    "output",
    "cache-read",
    "cache-write",
    STAT_SESSIONS,
)

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
        # Lines skipped for exceeding the per-line memory guard, and records
        # whose own fields could not be reduced to a partition of their own
        # total. Both are DIAGNOSTICS rather than refusals: see bounded_lines
        # and running_parts for why each degrades instead of failing the run.
        "oversized": 0,
        "unpartitioned": 0,
        # Records whose model identifier is outside the closed vocabulary, and
        # therefore contributed to the reserved residual member instead of
        # minting a label nobody reviewed.
        "unattributed": 0,
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

    STATED LIMIT, so nothing downstream reads more into a match than is
    there. This refuses a SUBSTITUTED file — a symlink, a hard link to an
    outside file, a directory or fifo put in the leaf's place, or a different
    regular file. It does not, and cannot, refuse rewritten CONTENT: the same
    inode with different bytes is by construction the same file. Nor is an
    inode NUMBER unique across time — a filesystem that recycles numbers may
    give a file created after an unlink the number the unlinked file just
    released, and this comparison would then admit it. Neither gap widens the
    producer's exposure, because both require write access to the transcript
    tree, and an attacker holding that never needed a swap in the first
    place; what bounds the damage is the emission guard, which lets only
    dates and integers leave.
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
        # Annotated because the seed's empty tuple would otherwise narrow the
        # element type to the EMPTY tuple, and every descent below pushes a
        # populated path onto it. The stack holds (open directory descriptor,
        # path components below the root, depth).
        pending: list[tuple[int, tuple[str, ...], int]] = [(anchor, (), 0)]
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

    AN OVERSIZED LINE IS SKIPPED, NOT FATAL (2026-08-27). The bound was
    written as a memory guard and then used as a refusal, so ONE pasted
    payload in ONE journal file refused the whole export — measured on the
    owner's own tree, where a single line past the bound stopped every
    scheduled push, for every source, indefinitely. That is the wrong
    direction on both counts: the guard's job is to stop this process holding
    an unbounded line in memory, which skipping does exactly as well as
    raising, and a producer that goes silent because one record is fat is a
    panel that quietly stops advancing.
    So the bound still bounds — the line is never read whole — and the record
    it belongs to is dropped, counted, and reported. The count is the honest
    part: an operator can see how many records the walk could not read
    without the walk naming, or holding, any of them. The dropped record's
    tokens are simply not counted, which understates a day rather than
    inventing one.
    The remainder of the line is drained in bounded chunks so the next yield
    starts at a real record boundary; without that drain the tail of the
    oversized line would be handed out as a sequence of fragments, each
    failing to parse — silently, since an unparsable line is skipped — which
    is a subtler version of the same bug.
    """
    while True:
        line = handle.readline(MAX_RECORD_LINE_BYTES + 1)
        if not line:
            return
        if len(line) > MAX_RECORD_LINE_BYTES:
            counters["oversized"] += 1
            counters["bytes"] += len(line)
            # The tree-wide byte ceiling holds on THIS accumulation path too
            # (2026-08-27 review of PR #230, INFO-6): the branch above adds
            # the oversized line's bytes, so skipping the check here would
            # make a tree of newline-terminated oversized records the one
            # shape of input the walk-work bound never bounds.
            if counters["bytes"] > MAX_RECORD_BYTES:
                raise CaptureError(
                    "the transcript tree is larger than the %d byte bound"
                    % MAX_RECORD_BYTES
                )
            # Drain ONLY when the oversized line came back truncated. A line
            # whose content is exactly the bound arrives here already
            # newline-terminated, and draining past it would swallow the NEXT
            # record whole — uncounted by any counter, which is the silent
            # version of the bug this branch exists to end (2026-08-27
            # adversarial review of PR #230, finding 1).
            if line.endswith("\n"):
                continue
            while True:
                if counters["bytes"] > MAX_RECORD_BYTES:
                    raise CaptureError(
                        "the transcript tree is larger than the %d byte bound"
                        % MAX_RECORD_BYTES
                    )
                rest = handle.readline(MAX_RECORD_LINE_BYTES + 1)
                if not rest:
                    return
                counters["bytes"] += len(rest)
                if rest.endswith("\n"):
                    break
            continue
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
    """Yield (day, total, parts, model) rows from every message-shaped record.

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
    """Yield (day, advance, parts, model) rows from every running-totals record.

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
        previous = {field: 0 for field in RUNNING_FIELDS}
        with handle:
            for line in bounded_lines(handle, counters):
                reduced = reduce_running_line(line)
                if reduced is None:
                    continue
                day, running = reduced
                if running[RUNNING_TOTAL_FIELD] == previous[RUNNING_TOTAL_FIELD]:
                    counters["duplicates"] += 1
                    previous = running
                    continue
                if running[RUNNING_TOTAL_FIELD] > previous[RUNNING_TOTAL_FIELD]:
                    advances = {
                        field: field_advance(running[field], previous[field])
                        for field in RUNNING_FIELDS
                    }
                else:
                    counters["restarts"] += 1
                    advances = dict(running)
                previous = running
                advance = advances[RUNNING_TOTAL_FIELD]
                if advance <= 0:
                    continue
                counters["counted"] += 1
                # This shape journals no model, so every record it carries is
                # the residual member by construction — never an invented
                # label, and never a silent omission from a partition that has
                # to cover every day.
                yield day, advance, running_parts(advances, advance, counters), MODEL_OTHER


def reduce_line(line, seen, counters):
    """Reduce one transcript line to (day, total, parts, model), or None.

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
    day = local_day(stamp)
    if day is None:
        return None
    parts = usage_parts(usage)
    return day, sum(parts.values()), parts, model_key(message.get(MESSAGE_MODEL_FIELD), counters)


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
    day = local_day(stamp)
    if day is None:
        return None
    return day, running_fields(running)


def running_total(usage):
    """The cumulative figure one running-totals record reports, or 0.

    Booleans are rejected for the same reason `usage_total` rejects them, and
    a missing or malformed field reads as no advance rather than as a guess:
    a walk that found nothing refuses loudly in `daily_series`, which is the
    honest failure for a journal whose shape has changed.
    """
    return count_field(usage, RUNNING_TOTAL_FIELD)


def count_field(usage, field):
    """One usage field as a non-negative count, or 0.

    Booleans are rejected explicitly: `True` is an `int` in Python, and a
    usage field that ever arrived as a flag would otherwise add one token.
    """
    value = usage.get(field)
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return 0


def running_fields(usage):
    """Every cumulative field one running-totals record reports."""
    return {field: count_field(usage, field) for field in RUNNING_FIELDS}


def field_advance(current, previous):
    """How far one cumulative field moved, under the module's three cases.

    The same arithmetic the total obeys, applied per field: an ADVANCE is the
    distance moved, a REPEAT moves nothing, and a RESTART from a lower figure
    contributes the new value itself. Doing it per field rather than scaling
    the total is what keeps the parts a MEASUREMENT — a proportional split of
    the total against some ratio would be an invention with tidy arithmetic.
    """
    if current >= previous:
        return current - previous
    return current


def running_parts(advances, total, counters):
    """The five-way partition of one running-totals record's own advance.

    THREE TIERS, EACH NAMED, because a partition that cannot be measured must
    degrade rather than lie:

      1. The full partition — input less its two cache classes, output less
         reasoning, and the three subsets themselves. Emitted when every part
         is non-negative and the parts sum to the record's own total.
      2. The two-way partition — input and output alone — when the subsets
         disagree with their parents but input plus output still equals the
         total. Coarser, still exactly true, and still a member-only
         partition of the closed vocabulary, so a day mixing tier-1 and
         tier-2 records still partitions.
      3. None, counted as `unpartitioned`. The record's tokens still reach
         the daily total (that measurement stands on its own field), and the
         DAY it lands in can no longer be partitioned, which daily_series
         turns into an omitted categories section rather than a wrong one.
    """
    cache_read = advances[RUNNING_CACHE_READ_FIELD]
    cache_write = advances[RUNNING_CACHE_WRITE_FIELD]
    reasoning = advances[RUNNING_REASONING_FIELD]
    uncached = advances[RUNNING_INPUT_FIELD] - cache_read - cache_write
    visible = advances[RUNNING_OUTPUT_FIELD] - reasoning
    parts = {
        "input": uncached,
        "output": visible,
        "cache-read": cache_read,
        "cache-write": cache_write,
        "reasoning": reasoning,
    }
    if all(value >= 0 for value in parts.values()) and sum(parts.values()) == total:
        return {key: value for key, value in parts.items() if value > 0}
    coarse = {
        "input": advances[RUNNING_INPUT_FIELD],
        "output": advances[RUNNING_OUTPUT_FIELD],
    }
    if sum(coarse.values()) == total:
        return {key: value for key, value in coarse.items() if value > 0}
    counters["unpartitioned"] += 1
    return None


def model_key(value, counters):
    """One record's model identifier reduced to a vocabulary member.

    The identifier a journal writes is VENDOR-QUALIFIED — a vendor segment,
    a hyphen, then the model. This drops the leading segment and asks the
    closed vocabulary whether what remains is a member; nothing here spells a
    vendor or a model, so the reduction stays a mechanical transform rather
    than a table of names in code (the same rule that keeps the record shapes
    named for what they contain).

    AN IDENTIFIER OUTSIDE THE VOCABULARY BECOMES THE RESIDUAL MEMBER, and it
    is counted. That is the deliberate half of the design: model churn is
    constant, and the two failure modes on the other side are both worse —
    minting a label nobody reviewed puts unreviewed copy on a public page,
    and refusing the document leaves the panel frozen until a human edits
    three files. The residual member is already in the vocabulary, already
    has its neutral slot, and already means exactly this. The REFUSAL lives
    where it belongs instead: the origin and the browser refuse any models
    key outside the vocabulary, so an unreviewed label can never be rendered
    even if a producer somehow emitted one.
    """
    if isinstance(value, str):
        _, separator, remainder = value.partition("-")
        if separator and remainder in MODEL_KEYS and remainder != MODEL_OTHER:
            return remainder
    counters["unattributed"] += 1
    return MODEL_OTHER


def local_day(stamp):
    """Return the workstation-local calendar date of an ISO 8601 instant, or None.

    THE bucketing decision, made once and made here (issue #276, owner ruling
    2026-09-01): records bucket into the WORKSTATION'S LOCAL calendar day,
    because that is how the vendors' own surfaces bucket, and matching what
    the owner reads there is what "correct going forward" means. The previous
    UTC rule skewed every day-boundary figure by up to a day — a 12-day
    vendor streak read 13 here the moment one evening crossed UTC midnight.

    The conversion is per instant, so it is DST-correct: `astimezone()` with
    no argument resolves each instant against the platform's own zone rules
    rather than freezing today's offset onto historical records. A naive
    timestamp is taken as UTC, exactly as before — the journals write
    Z-suffixed instants, and a record that omits the zone should not
    silently inherit the local one.
    """
    try:
        moment = datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=datetime.timezone.utc)
    return moment.astimezone().date().isoformat()


def usage_parts(usage):
    """One message's usage fields as its own partition, by category key.

    The four fields are DISJOINT in this record shape, so they partition the
    message's total by construction — no subtraction, and nothing to check.
    Zero-valued classes are dropped rather than carried, so a day's partition
    names only the classes it actually measured.
    """
    parts = {}
    for field, key in CATEGORY_FIELDS:
        value = count_field(usage, field)
        if value > 0:
            parts[key] = value
    return parts


def usage_total(usage):
    """Sum one message's usage fields, ignoring anything that is not a count."""
    return sum(usage_parts(usage).values())


def daily_series(rows):
    """Build the contiguous day-indexed series from reduced record rows.

    A row is (day, total, parts, model): the day's own arithmetic, the
    record's category partition (None when the record could not be
    partitioned) and the vocabulary member its tokens belong to. All three
    day indexes are built in ONE walk over ONE stream, so the aggregate, the
    breakdown, and the attribution are the same records read once — a second
    walk would be a second chance to disagree.

    Returns (series, categories, models, partitioned days), where `categories`
    and `models` map a vocabulary key to a day-indexed list over the same
    contiguous window the series covers. The caller windows them.
    """
    totals_by_day = {}
    parts_by_day = {}
    models_by_day = {}
    uncategorised = set()
    for day, total, parts, model in rows:
        totals_by_day[day] = totals_by_day.get(day, 0) + total
        bucket = models_by_day.setdefault(day, {})
        bucket[model] = bucket.get(model, 0) + total
        if parts is None:
            uncategorised.add(day)
            continue
        carried = parts_by_day.setdefault(day, {})
        for key, value in parts.items():
            carried[key] = carried.get(key, 0) + value
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
    window = [(first + datetime.timedelta(days=offset)).isoformat() for offset in range(span)]
    totals = [totals_by_day.get(day, 0) for day in window]
    # `recorded` is what marks this as the out-of-band capture it is. The live
    # refresh path builds its series without it, so the flag is also how the
    # registry pin tells a shipped series from a fetched one.
    series = {"startDate": days[0], "totals": totals, "recorded": True}
    categories = day_indexed(parts_by_day, window, CATEGORY_KEYS)
    models = day_indexed(models_by_day, window, MODEL_KEYS)
    partitioned = [day for day in window if day not in uncategorised]
    return series, categories, models, partitioned


def day_indexed(by_day, window, vocabulary):
    """Lay per-day, per-key sums onto one contiguous day window.

    Only keys the record actually reported get a row: a vocabulary member no
    day carries is an all-zero list that says nothing and costs bytes on
    every push. Order is the vocabulary's, so two runs over one tree emit
    identical bytes.
    """
    rows = {}
    for key in vocabulary:
        row = [by_day.get(day, {}).get(key, 0) for day in window]
        # An all-zero row is not a measurement of nothing, it is nothing: it
        # adds a member to the rendered vocabulary, costs one integer per day
        # on every push, and contributes exactly zero to the partition. The
        # residual member reaches this by the ordinary route — records with no
        # attributable model that also carry no tokens.
        if any(row):
            rows[key] = row
    return rows


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
    """The figures the series itself defines, keyed by their stat keys.

    `active-days` and `tracked-days` joined at issue #276: both are pure
    series functions — the days the graph paints and the days it covers —
    yet the tiles carrying them sat outside the derived vocabulary, frozen
    at release-time values that contradicted the graph directly above them.
    """
    totals = series["totals"]
    current, longest = daily_streaks(totals)
    return {
        STAT_PEAK_DAY: max(totals),
        STAT_CURRENT_STREAK: current,
        STAT_LONGEST_STREAK: longest,
        STAT_ACTIVE_DAYS: sum(1 for total in totals if total > 0),
        STAT_TRACKED_DAYS: len(totals),
    }


def assert_partition(totals, sections, offset):
    """Refuse a breakdown whose rows do not sum to the series totals.

    Checked over the section's OWN window — `offset` days into the series —
    because a windowed section makes no claim about the days before it
    starts. Inside the window the claim is exact in both directions: over is
    a lie, and under is a hole wearing a partition's label.

    The origin enforces exactly this, so checking here means a broken build
    of this program can never push a file the origin will reject every five
    minutes until the next capture.
    """
    for index in range(len(totals) - offset):
        summed = sum(values[index] for values in sections.values())
        if summed != totals[offset + index]:
            raise CaptureError(
                "a breakdown sums to a different figure than the series total on day %d"
                % (offset + index)
            )


def window_section(sections, offset):
    """Trim every row of a breakdown to a trailing window of the series."""
    return {key: values[offset:] for key, values in sections.items()}


def trailing_offset(window, covered):
    """Where the trailing run of covered days begins, or None if there is none.

    A breakdown covers a CONTIGUOUS TRAILING window and nothing else. Two
    facts force that shape rather than a per-day mask: the wire carries one
    start date and one list per key, and a mask would let a hole in the
    middle of a "partition" pass unnoticed. So the window begins after the
    newest day the breakdown could not measure, and everything older is
    simply not claimed.
    """
    offset = len(window)
    while offset > 0 and window[offset - 1] in covered:
        offset -= 1
    return None if offset == len(window) else offset


def windows_from(series, categories, offset, today):
    """Derive the closed window set from the daily categories.

    `today` is the capture instant's LOCAL date, matching the series' own
    local-day bucketing (issue #276); a day the record does not
    cover contributes zero, which inside the asked window is a measurement —
    "no recorded usage that day" — never an invention. The input figure sums
    the input-class categories (uncached input plus both cache classes),
    matching what the live mapper counts as input; output is the output
    category alone.

    A day inside the SERIES but before the categories window contributes zero
    for the same reason: the total for that day is known, its split is not,
    and a window figure is a split. The categories window is trailing and
    these figures ask about today and the six days before it, so that case
    needs the newest days themselves to be unsplittable — at which point a
    zero is the only honest answer available.
    """
    start = datetime.date.fromisoformat(series["startDate"]) + datetime.timedelta(days=offset)
    span = len(series["totals"]) - offset

    def day_amount(day, keys):
        index = (day - start).days
        if index < 0 or index >= span:
            return 0
        return sum(categories[key][index] for key in keys if key in categories)

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


def read_bounded_json(path, bound):
    """Read one small JSON document under an explicit byte bound.

    One byte PAST the bound is read so the ceiling itself is admitted and
    anything larger refuses. The parse is guarded against a recursion
    blow-up too: depth is a resource, and a document nobody can parse
    without exhausting the stack is refused like any other oversized input
    (2026-08-24 round-3 review, finding 10).

    Neither refusal names the path, exactly like every other refusal here.
    """
    with open(path, "r", encoding="utf-8") as handle:
        text = handle.read(bound + 1)
    if len(text) > bound:
        raise CaptureError("a merge source is larger than the %d byte bound" % bound)
    try:
        return json.loads(text)
    except (ValueError, RecursionError):
        raise CaptureError("a merge source is not a parsable JSON document")


def read_activity_cache(path):
    """Read the tool's own cache document, bounded and shape-checked.

    ONE read for BOTH derivations below — the per-day roll-up and the
    lifetime accounting — so the two cannot come from different generations
    of a file the tool rewrites on its own schedule.
    """
    document = read_bounded_json(path, MAX_ACTIVITY_CACHE_BYTES)
    if not isinstance(document, dict):
        raise CaptureError("the activity cache must be a JSON object")
    return document


def activity_days(document, counters):
    """The cache's per-day, per-model roll-up: {day: {member: count}}.

    WHY THIS EXISTS. The transcript journals are RETENTION-PRUNED — the tool
    deletes them on its own schedule — so a walk of the tree measures only as
    far back as the tree still goes, and the panel's history was silently
    getting SHORTER as older journals aged out. The tool keeps its own
    roll-up of the same usage beside them, which survives that pruning, and
    reading it is what makes the panel's depth a property of the record
    rather than of a cleanup interval.

    It is a WEAKER measurement than the walk and is treated as one. Its
    figures are the tool's own accounting and do not agree with the walk's
    de-duplicated totals — measured on the owner's tree, they run roughly
    twice as high on the days both cover — so a day the walk covers is never
    taken from here (the caller's union rule), and the two are never summed.
    What this supplies is the days the walk has LOST, and the per-model split
    on them.

    Nothing but calendar dates, vocabulary members and integers leaves this
    function; an identifier outside the vocabulary becomes the residual
    member exactly as it does on the walk's own path.
    """
    rows = document.get(ACTIVITY_CACHE_DAILY_KEY)
    if not isinstance(rows, list):
        raise CaptureError("the activity cache carries no daily model roll-up")
    by_day = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        day = row.get(ACTIVITY_CACHE_DATE_KEY)
        amounts = row.get(ACTIVITY_CACHE_MODELS_KEY)
        if not valid_calendar_day(day) or not isinstance(amounts, dict):
            continue
        bucket = by_day.setdefault(day, {})
        for identifier, value in amounts.items():
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                continue
            key = model_key(identifier, counters)
            bucket[key] = bucket.get(key, 0) + value
    return by_day


def lifetime_stats(document):
    """The cache's lifetime accounting as the closed captured-stats set.

    The four per-model running totals sum into the four token classes plus
    their whole, and the session tally rides beside them — the exact figures
    the frozen lifetime-class tiles stopped tracking (issue #276). The tool's
    own accounting is the record here, matching its terminal report within
    its own recompute lag; nothing is derived from the walk, so these figures
    never inherit the walk's de-duplication rule.

    Every refusal is a refusal of the WHOLE run, not a silently absent
    figure: the origin refuses a document that leaves a lifetime-class tile
    unrefreshed, so a cache that stops carrying this accounting must stop
    the push loudly here rather than push a document the origin rejects on
    every tick. A missing field, a non-integer, a negative, a bool, or a sum
    past the shared count bound all name the defect and push nothing.
    """
    usage = document.get(ACTIVITY_CACHE_USAGE_KEY)
    if not isinstance(usage, dict) or not usage:
        raise CaptureError("the activity cache carries no lifetime usage accounting")
    stats = {key: 0 for _, key in ACTIVITY_CACHE_USAGE_FIELDS}
    for entry in usage.values():
        if not isinstance(entry, dict):
            raise CaptureError("the activity cache carries a malformed lifetime entry")
        for field, key in ACTIVITY_CACHE_USAGE_FIELDS:
            value = entry.get(field)
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise CaptureError("the activity cache carries a malformed lifetime count")
            stats[key] += value
    stats[STAT_LIFETIME] = sum(stats.values())
    sessions = document.get(ACTIVITY_CACHE_SESSIONS_KEY)
    if not isinstance(sessions, int) or isinstance(sessions, bool) or sessions < 0:
        raise CaptureError("the activity cache carries no session tally")
    stats[STAT_SESSIONS] = sessions
    if any(value > MAX_COUNT for value in stats.values()):
        raise CaptureError("the activity cache lifetime figures exceed the shared count bound")
    return stats


def extend_with_cache(series, categories, models, partitioned, cached):
    """Union the walked series with the cache's days; the WALK wins a conflict.

    The union is by DATE, and the rule is one sentence: a day the walk covers
    is the walk's, and only the days the walk has lost come from the cache.
    That direction is not arbitrary — the walk de-duplicates replayed
    records and the cache does not, so mixing the two inside one day would
    produce a figure neither tool measured, and preferring the cache on a
    covered day would silently double it.

    Everything the union adds is honest about what it is: the added days
    carry a total and a per-model split, and they carry NO category split,
    because the roll-up has none to give. `partitioned` is what carries that
    fact forward — the categories section is windowed to the trailing run of
    days that really do have one, so the breakdown never claims a day it
    cannot measure.
    """
    if not cached:
        return series, categories, models, partitioned
    start = datetime.date.fromisoformat(series["startDate"])
    walked = {
        (start + datetime.timedelta(days=offset)).isoformat(): offset
        for offset in range(len(series["totals"]))
    }
    first = min([start] + [datetime.date.fromisoformat(day) for day in cached])
    last = max(
        [start + datetime.timedelta(days=len(series["totals"]) - 1)]
        + [datetime.date.fromisoformat(day) for day in cached]
    )
    span = (last - first).days + 1
    if span > MAX_SERIES_DAYS:
        raise CaptureError(
            "the record spans %d days, over the %d day bound the origin enforces"
            % (span, MAX_SERIES_DAYS)
        )
    window = [(first + datetime.timedelta(days=offset)).isoformat() for offset in range(span)]
    totals = []
    merged_categories = {key: [] for key in categories}
    merged_models = {key: [] for key in models}
    for day in window:
        offset = walked.get(day)
        if offset is not None:
            totals.append(series["totals"][offset])
            for key, values in merged_categories.items():
                values.append(categories[key][offset])
            for key, values in merged_models.items():
                values.append(models[key][offset])
            continue
        amounts = cached.get(day, {})
        totals.append(sum(amounts.values()))
        for values in merged_categories.values():
            values.append(0)
        for key, values in merged_models.items():
            values.append(amounts.get(key, 0))
    # A member the walk never saw but the cache did needs its own row, laid
    # onto the same window with zeros wherever the walk was the source.
    for key in MODEL_KEYS:
        if key in merged_models:
            continue
        if not any(key in cached.get(day, {}) for day in window):
            continue
        merged_models[key] = [
            0 if day in walked else cached.get(day, {}).get(key, 0) for day in window
        ]
    ordered_models = {key: merged_models[key] for key in MODEL_KEYS if key in merged_models}
    extended = {"startDate": window[0], "totals": totals, "recorded": True}
    return extended, merged_categories, ordered_models, partitioned


def read_history_store(path):
    """Read the durable per-source history store: {day: best measured entry}.

    A MISSING file is an empty store, because the first run of a newly
    configured store has nothing to remember yet and must bootstrap rather
    than refuse. Every other failure refuses the run: the store is this
    pipeline's own artifact, so a malformed or unreadable one is evidence of
    corruption or tampering, and serving a series while silently ignoring
    the pipeline's own memory would shorten the published history with
    nothing to say so — the exact defect the store exists to end.

    Validation is MEMBERSHIP, exactly as the emission guard's: real calendar
    days, positive integers under the shared count bound, breakdown keys
    inside their closed vocabularies, and each breakdown summing exactly to
    its day's total. Refusals name the store, never a path.
    """
    try:
        with open(path, "r", encoding="utf-8") as handle:
            text = handle.read(MAX_HISTORY_STORE_BYTES + 1)
    except FileNotFoundError:
        return {}
    except OSError:
        raise CaptureError("the history store could not be read")
    if len(text) > MAX_HISTORY_STORE_BYTES:
        raise CaptureError(
            "the history store is larger than the %d byte bound" % MAX_HISTORY_STORE_BYTES
        )
    try:
        document = json.loads(text)
    except (ValueError, RecursionError):
        raise CaptureError("the history store is not a parsable JSON document")
    if not isinstance(document, dict):
        raise CaptureError("the history store must be a JSON object")
    if document.get(HISTORY_SCHEMA_KEY) != HISTORY_SCHEMA:
        raise CaptureError("the history store does not declare the expected schema")
    if set(document) != {HISTORY_SCHEMA_KEY, HISTORY_DAYS_KEY}:
        raise CaptureError("the history store carries an unknown section")
    rows = document[HISTORY_DAYS_KEY]
    if not isinstance(rows, dict):
        raise CaptureError("the history store carries no day index")
    vocabularies = {"categories": CATEGORY_KEYS, "models": MODEL_KEYS}
    stored = {}
    for day, entry in rows.items():
        if not valid_calendar_day(day):
            raise CaptureError("the history store carries a key that is not a calendar day")
        if not isinstance(entry, dict) or HISTORY_TOTAL_KEY not in entry:
            raise CaptureError("the history store carries a malformed day entry")
        if set(entry) - ({HISTORY_TOTAL_KEY} | set(vocabularies)):
            raise CaptureError("the history store carries an unknown day field")
        total = entry[HISTORY_TOTAL_KEY]
        if not isinstance(total, int) or isinstance(total, bool) or total <= 0:
            # A zero or negative day is never stored: the store preserves
            # positive evidence only, so a zero entry is corruption.
            raise CaptureError("the history store carries a day without a positive total")
        if total > MAX_COUNT:
            raise CaptureError("the history store carries a total above the shared count bound")
        admitted = {HISTORY_TOTAL_KEY: total, "categories": None, "models": None}
        for name, vocabulary in vocabularies.items():
            values = entry.get(name)
            if values is None:
                continue
            if not isinstance(values, dict) or not values:
                raise CaptureError("the history store carries a malformed breakdown")
            for key, value in values.items():
                if key not in vocabulary:
                    raise CaptureError(
                        "the history store carries a breakdown key outside its vocabulary"
                    )
                if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                    raise CaptureError("the history store carries a malformed breakdown count")
            if sum(values.values()) != total:
                raise CaptureError(
                    "a history store breakdown sums to a different figure than its day"
                )
            admitted[name] = dict(values)
        stored[day] = admitted
    return stored


def merge_history(series, categories, models, partitioned, stored):
    """Union the derived series with the store; evidence, once seen, survives.

    THE RULE, one sentence per direction. A day the fresh capture measures at
    least as large as the store keeps the fresh figure (the fresh walk is the
    de-duplicated, current measurement — including the in-progress day, which
    only grows); a day the fresh capture measures SMALLER than the store —
    including not at all — keeps the stored figure, because the only way a
    genuinely measured day shrinks is its sources being deleted underneath
    it, and pruning is precisely what the store exists to survive.

    No fabrication: the store holds only what a real capture measured, so a
    day absent from both sides stays absent, rendered as the zero-inside-the-
    window the series contract already defines. Nothing here invents a day.

    Returns (series, categories, models, partitioned, remembered) where
    `remembered` is the merged per-day index for the caller to write back —
    the same union the emission serves, so the store and the served series
    cannot disagree.
    """
    start = datetime.date.fromisoformat(series["startDate"])
    window = [
        (start + datetime.timedelta(days=offset)).isoformat()
        for offset in range(len(series["totals"]))
    ]
    partitioned_in = set(partitioned)
    merged = {}
    for offset, day in enumerate(window):
        total = series["totals"][offset]
        if total <= 0:
            continue
        parts = {key: categories[key][offset] for key in categories if categories[key][offset] > 0}
        amounts = {key: models[key][offset] for key in models if models[key][offset] > 0}
        merged[day] = {
            HISTORY_TOTAL_KEY: total,
            # A breakdown is remembered only when it is a PARTITION of the
            # day: a day the walk could not fully categorise carries partial
            # figures that must never resurface later claiming to be whole.
            "categories": parts if day in partitioned_in and sum(parts.values()) == total else None,
            "models": amounts if amounts and sum(amounts.values()) == total else None,
        }
    for day, entry in stored.items():
        current = merged.get(day)
        if current is None or current[HISTORY_TOTAL_KEY] < entry[HISTORY_TOTAL_KEY]:
            merged[day] = entry
    if not merged:
        return series, categories, models, partitioned, merged
    days = sorted(merged)
    first = min(datetime.date.fromisoformat(days[0]), start)
    last = max(
        datetime.date.fromisoformat(days[-1]),
        start + datetime.timedelta(days=len(series["totals"]) - 1),
    )
    span = (last - first).days + 1
    if span > MAX_SERIES_DAYS:
        raise CaptureError(
            "the record spans %d days, over the %d day bound the origin enforces"
            % (span, MAX_SERIES_DAYS)
        )
    union = [(first + datetime.timedelta(days=offset)).isoformat() for offset in range(span)]
    totals = [merged.get(day, {HISTORY_TOTAL_KEY: 0})[HISTORY_TOTAL_KEY] for day in union]
    parts_by_day = {
        day: entry["categories"] for day, entry in merged.items() if entry["categories"]
    }
    models_by_day = {day: entry["models"] for day, entry in merged.items() if entry["models"]}
    # A day stays partitioned when its merged entry still carries a category
    # partition, or when it is a zero day the incoming walk already treated
    # as trivially partitioned. A day the store overrode WITHOUT a stored
    # partition leaves the partitioned set — its old partial figures are
    # gone, and claiming a partition it cannot show would be the lie the
    # trailing window exists to prevent.
    kept = set(parts_by_day)
    for day in partitioned_in:
        if day not in merged:
            kept.add(day)
    extended = {"startDate": union[0], "totals": totals, "recorded": True}
    return (
        extended,
        day_indexed(parts_by_day, union, CATEGORY_KEYS),
        day_indexed(models_by_day, union, MODEL_KEYS),
        [day for day in union if day in kept],
        merged,
    )


def write_history_store(path, remembered):
    """Persist the merged day index atomically, dates and integers only.

    Written to a sibling temporary file and renamed over the store, so a run
    killed mid-write leaves the previous store intact rather than a truncated
    document the next run would refuse. The emission is deterministic (sorted
    days, sorted keys) so two identical merges write identical bytes.
    """
    document = {HISTORY_SCHEMA_KEY: HISTORY_SCHEMA, HISTORY_DAYS_KEY: {}}
    for day in sorted(remembered):
        entry = remembered[day]
        row = {HISTORY_TOTAL_KEY: entry[HISTORY_TOTAL_KEY]}
        for name in ("categories", "models"):
            if entry.get(name):
                row[name] = entry[name]
        document[HISTORY_DAYS_KEY][day] = row
    temporary = path.with_name(path.name + ".tmp")
    try:
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(document, handle, sort_keys=True)
            handle.write("\n")
        temporary.replace(path)
    except OSError:
        raise CaptureError("the history store could not be written")


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
    * a boolean is admitted only under a key spelled exactly `recorded` — the
      series' provenance flag is the only field that declares one. The guard
      keys off the NAME, not the position: it threads `allow_bool` down as
      `key == "recorded"` from every mapping, so a `recorded` key nested
      anywhere inside an admitted document would also be admitted. That is
      wider than the sentence above reads, and is written down rather than
      trusted, because the two refusals under it are what actually bound the
      hole: a bare top-level boolean is refused, and a list re-seeds
      `allow_bool` false, so even `recorded: [true]` is refused.

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


def capture(root, record_format=FORMAT_MESSAGES, activity_cache=None, today=None, history_store=None):
    """Walk the transcripts and return (section, counters).

    The shape decides only HOW a record becomes a (day, integer, parts,
    member) row. Every step after that — the contiguous day index, the
    windowing, the partition arithmetic, the streak rules, and the emission
    guard below — is the same code for both, so a second reader can never
    acquire a second privacy contract.

    The returned section is EXACTLY the shape export_usage_series.py's
    merge-source loader admits and the origin's data root then merges: the
    aggregate series, the two windowed breakdowns with their own start dates,
    the complete window set, the complete derived-tile set, and — when an
    activity cache supplies the tool's own lifetime accounting — the
    captured-stats section (issue #276). It is one
    shape, produced by one function, so "capture a second tool's series and
    merge it" needs no hand assembly and no second definition of what a valid
    section is — which is exactly how a hand-written merge file came to be
    missing the sections the loader requires, refusing every export until a
    human noticed (2026-08-27).
    """
    if record_format not in RECORD_FORMATS:
        raise CaptureError("unknown record format")
    counters = new_counters()
    reader = read_records if record_format == FORMAT_MESSAGES else read_running_totals
    series, categories, models, partitioned = daily_series(reader(root, counters))
    stats = None
    if activity_cache is not None:
        cache_document = read_activity_cache(activity_cache)
        series, categories, models, partitioned = extend_with_cache(
            series, categories, models, partitioned, activity_days(cache_document, counters)
        )
        stats = lifetime_stats(cache_document)
    if history_store is not None:
        # AFTER the cache union, so the store remembers the deepest series
        # this run could derive; the walk must still find records (the
        # refusal in daily_series stands), because a source that suddenly
        # reads completely empty is a misconfiguration to surface, never a
        # gap for remembered history to paper over.
        series, categories, models, partitioned, remembered = merge_history(
            series, categories, models, partitioned, read_history_store(history_store)
        )
        write_history_store(history_store, remembered)
    section = {"series": series}
    totals = series["totals"]
    start = datetime.date.fromisoformat(series["startDate"])
    window = [(start + datetime.timedelta(days=offset)).isoformat() for offset in range(len(totals))]

    offset = trailing_offset(window, set(partitioned)) if categories else None
    if offset is None:
        # A capture with no partition at all cannot state a window figure
        # either: a window is an input/output SPLIT, and inventing one would
        # be the fabrication this whole pipeline exists to make impossible.
        raise CaptureError(
            "no day of the record carries a category partition, so the window "
            "figures cannot be measured"
        )
    categories = window_section(categories, offset)
    assert_partition(totals, categories, offset)
    section["categories"] = categories
    if offset > 0:
        section["categoriesStartDate"] = window[offset]

    # A breakdown whose only member is the residual one says nothing the
    # aggregate does not already say, and costs a row per day on every push to
    # say it. The record shapes that journal no model at all land here, and
    # the honest emission for them is no section — which the origin, the
    # merge loader and the browser all already read as "this source cannot
    # break its series down that way".
    #
    # The model window retreats behind any day its rows cannot partition,
    # exactly as the categories window does (issue #234): a history-store
    # entry can carry a total whose attribution was never stored, and a
    # window claiming that day would fail the partition it declares. Every
    # walked and cache-supplied day attributes fully, so on those the byte
    # BUDGET below remains the only cut, exactly as before.
    model_covered = {
        day
        for index, day in enumerate(window)
        if sum(values[index] for values in models.values()) == totals[index]
    }
    model_start = trailing_offset(window, model_covered)
    if models and set(models) != {MODEL_OTHER} and model_start is not None:
        model_offset = max(model_start, len(totals) - MAX_MODEL_DAYS, 0)
        windowed = window_section(models, model_offset)
        assert_partition(totals, windowed, model_offset)
        section["models"] = windowed
        if model_offset > 0:
            section["modelsStartDate"] = window[model_offset]

    section["windows"] = windows_from(
        series,
        categories,
        offset,
        # The LOCAL date, matching the series' own bucketing (issue #276): a
        # window keyed to the UTC date would ask about a day the series does
        # not bucket by, and every evening past UTC midnight would read as
        # tomorrow's usage.
        today if today is not None else datetime.datetime.now().astimezone().date(),
    )
    section["derived"] = derived_figures(series)
    if stats is not None:
        section["stats"] = stats
    # Proven clean before anything is printed, written, or spliced.
    assert_only_dates_and_integers(section, "section")
    return section, counters


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
        "--activity-cache",
        help="the tool's own per-day model roll-up, read for the days retention has pruned",
    )
    parser.add_argument(
        "--history-store",
        help="durable per-source day store, read and rewritten so pruned days survive",
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
        # The refusal names no path — not even the operator's own argument.
        # This branch prints a CONSTANT, so it already follows the same
        # no-path rule every CaptureError message follows ("a file that cannot
        # be read is tallied, never named, because an error string carrying a
        # path is a leak with a friendly face"). The comment here used to
        # defend echoing the path back, which this code has never done;
        # reading it as licence would have made the leak it excused.
        print("no such transcript directory", file=sys.stderr)
        return 2
    cache = None
    if arguments.activity_cache is not None:
        cache = pathlib.Path(arguments.activity_cache).expanduser()
        if not cache.is_file():
            print("no such activity cache", file=sys.stderr)
            return 2
    history = None
    if arguments.history_store is not None:
        history = pathlib.Path(arguments.history_store).expanduser()
        if not history.parent.is_dir():
            # The FILE may not exist yet — the first run bootstraps it — but
            # its directory must, because a mistyped location would otherwise
            # silently remember nothing, run after run.
            print("no such history store directory", file=sys.stderr)
            return 2
    try:
        section, counters = capture(root, arguments.record_format, cache, history_store=history)
    except CaptureError as error:
        print(str(error), file=sys.stderr)
        return 1
    except OSError:
        # Counted, never named, exactly as unreadable transcripts are.
        print("the activity cache could not be read", file=sys.stderr)
        return 1
    print(
        "files=%d unreadable=%d symlinks=%d oversized=%d lines=%d counted=%d "
        "duplicates=%d restarts=%d unpartitioned=%d unattributed=%d days=%d"
        % (
            counters.get("files", 0),
            counters.get("unreadable", 0),
            counters.get("symlinks", 0),
            counters.get("oversized", 0),
            counters.get("lines", 0),
            counters.get("counted", 0),
            counters.get("duplicates", 0),
            counters.get("restarts", 0),
            counters.get("unpartitioned", 0),
            counters.get("unattributed", 0),
            len(section["series"]["totals"]),
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
        document = {"generatedAt": generated_at, **section}
        json.dump(document, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0
    with open(arguments.snapshot, "r", encoding="utf-8") as handle:
        document = json.load(handle)
    try:
        spliced = splice(
            document, arguments.source, section["series"], section["derived"], generated_at
        )
    except CaptureError as error:
        print(str(error), file=sys.stderr)
        return 1
    with open(arguments.snapshot, "w", encoding="utf-8") as handle:
        json.dump(spliced, handle, indent=2)
        handle.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
