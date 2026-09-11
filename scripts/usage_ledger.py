#!/usr/bin/env python3
"""The append-only lifelong record every measured figure lands in (issue #267).

WHY THIS EXISTS. Everything upstream of this file is a WINDOW. The sealed
document carries a bounded series; the history stores carry one best figure
per day and forget how it was measured; the graphing dataset is rebuilt from
scratch on every run. None of them can answer "what did this machine know, and
when did it know it" — and none of them holds a reading the panel never
served. The owner's ruling is that the tracker is lifelong: a figure this
workstation has once measured is written down once, kept forever, and never
rewritten. This module is that record.

THE SHAPE, and why it is this one. One JSON object per line, one file per
stream per calendar year, appended with `O_APPEND` and fsynced. Append-only
text is the format with the fewest ways to lose data: a crash mid-write
damages one line rather than an index, any reader in any language can read it
without this program, and a value that has already been written cannot be
edited by anything this pipeline does. Derived shapes — SQLite, CSV — are
REGENERATED from the lines (`export` below), never the other way round, so a
corrupted derivative costs a rebuild rather than a history.

WHAT A ROW MEANS. `(day, source, kind, key)` names a figure; `value` is that
figure as of `capturedAt`; `method` says where the reading came from. A run
appends a row only when the figure DIFFERS from the last one written for that
identity, so a quiet day appends nothing and rewrites nothing, and the file
grows with information rather than with runs. Resolution (`resolve`) applies
the one rule the pipeline already uses: a verified reading — the owner's own
reading of the vendor surface — wins over every capture, and otherwise the
largest figure wins, because every other method under-measures rather than
over-measures (a retention-pruned tree, a roll-up that discarded a month).

WHAT IS AND IS NOT RECOVERABLE. The ledger starts the day it is switched on.
It cannot reconstruct a day whose evidence is already gone; what it promises
is that no day measured AFTER that point is ever lost again, including the
days the sealed window has since dropped and the days a vendor surface later
disagrees with.

REFUSALS. A partial final line is the one tolerated fault: an interrupted
write leaves a tail with no newline, which is repaired by truncating back to
the previous newline and saying so on stderr. Every OTHER malformed line
refuses the run naming its line number — the history store's
"malformed refuses rather than forgets" rule, for the same reason: a reader
that silently skips a line it cannot parse turns corruption into quiet data
loss.

VOCABULARY IS DATA. No model key, model name, vendor group or source key is
spelled anywhere in this file. Streams, kinds, units and methods are this
pipeline's own accounting terms; everything that names an entity — a model, a
source, a repository, a skill — arrives in a document and is validated for
SHAPE alone.

    scripts/usage_ledger.py export --ledger DIR [--out DIR]
"""

from __future__ import annotations

import argparse
import csv
import datetime
import gzip
import hashlib
import json
import os
import pathlib
import re
import sqlite3
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import capture_usage_series as capture  # noqa: E402

# The record's identity. Every line carries it, so a file that is concatenated,
# split, or moved still says what it is.
SCHEMA = "ledger/v1"

# ONE refusal type across this pipeline. The exporter's main() already returns
# 1 with the message and no traceback on it, so a ledger refusal reports
# exactly as a capture refusal does rather than unwinding through a scheduler.
LedgerError = capture.CaptureError

# ONE calendar rule too, named here so the two programs that write into this
# record reach for it through the record rather than each re-deriving what a
# day is. It is the capture tool's: `fullmatch` plus a real calendar parse, so
# neither a trailing newline nor 2026-99-99 can name a day.
valid_calendar_day = capture.valid_calendar_day

# The streams. A stream is a subject with its own kinds, not a category of
# importance: they are separate files so one subject's growth never rewrites
# another's, and so a reader can take the usage record without the game one.
STREAM_USAGE = "usage"
STREAM_SESSIONS = "sessions"
STREAM_GITHUB = "github"
STREAM_PROJECTS = "projects"
STREAM_OSRS = "osrs"

# Kinds, per stream, CLOSED. A kind is what the figure MEASURES; the key says
# which one. `model-category` and `model-stat` carry a composite key
# (`<member>/<class>`) rather than a second column, because the identity of a
# figure is one tuple everywhere in this file and a special case for one kind
# would be a second identity rule to keep in step.
KIND_TOTAL = "total"
KIND_CATEGORY = "category"
KIND_MODEL = "model"
KIND_MODEL_CATEGORY = "model-category"
KIND_STAT = "stat"
KIND_MODEL_STAT = "model-stat"
KIND_SESSION = "session"
KIND_CONTRIBUTIONS = "contributions"
KIND_STREAK = "streak"
KIND_COMMIT = "commit"
KIND_STARS = "stars"
KIND_OPEN_ISSUES = "open-issues"
KIND_OPEN_PULLS = "open-pulls"
KIND_PUSHED = "pushed"
KIND_SKILL_XP = "skill-xp"
KIND_SKILL_LEVEL = "skill-level"
KIND_SKILL_RANK = "skill-rank"
KIND_BOSS_KC = "boss-kc"
KIND_BOSS_RANK = "boss-rank"

STREAM_KINDS = {
    STREAM_USAGE: (
        KIND_TOTAL,
        KIND_CATEGORY,
        KIND_MODEL,
        KIND_MODEL_CATEGORY,
        KIND_STAT,
        KIND_MODEL_STAT,
    ),
    STREAM_SESSIONS: (KIND_SESSION,),
    STREAM_GITHUB: (KIND_CONTRIBUTIONS, KIND_STREAK, KIND_COMMIT),
    STREAM_PROJECTS: (KIND_STARS, KIND_OPEN_ISSUES, KIND_OPEN_PULLS, KIND_PUSHED),
    STREAM_OSRS: (
        KIND_SKILL_XP,
        KIND_SKILL_LEVEL,
        KIND_SKILL_RANK,
        KIND_BOSS_KC,
        KIND_BOSS_RANK,
    ),
}

# The unit a value is counted in. Declared because a column of integers with
# no unit is the classic way a derived chart ends up adding seconds to tokens.
UNIT_TOKENS = "tokens"
UNIT_COUNT = "count"
UNIT_SECONDS = "seconds"
UNIT_XP = "xp"
UNIT_LEVEL = "level"
UNIT_RANK = "rank"
UNIT_STARS = "stars"
UNIT_EPOCH_SECONDS = "epoch-seconds"

# The key a whole-day total is filed under. A `total` row has no member to
# name, and an empty key would make the identity tuple ambiguous, so the
# subject itself is the key.
KEY_TOKENS = "tokens"
UNITS = (
    UNIT_TOKENS,
    UNIT_COUNT,
    UNIT_SECONDS,
    UNIT_XP,
    UNIT_LEVEL,
    UNIT_RANK,
    UNIT_STARS,
    UNIT_EPOCH_SECONDS,
)

# Where a reading came from. This is provenance, and it is what `resolve`
# arbitrates on: the panels' own doctrine is that a figure says where it came
# from, and a record that forgot would make every later disagreement
# unresolvable.
METHOD_CAPTURE = "capture"
METHOD_STORE = "store"
METHOD_VERIFIED = "verified"
METHOD_BASELINE = "baseline"
METHOD_PANEL = "panel"
METHOD_BACKFILL = "backfill"
METHODS = (
    METHOD_CAPTURE,
    METHOD_STORE,
    METHOD_VERIFIED,
    METHOD_BASELINE,
    METHOD_PANEL,
    METHOD_BACKFILL,
)

# The row's own field names. Required on every line; `raw` is present only
# when a raw artifact was kept, because an absent digest is the honest way to
# say "nothing was archived for this reading" and a fabricated one would be
# indistinguishable from a real archive.
ROW_REQUIRED = (
    "schema",
    "day",
    "stream",
    "source",
    "kind",
    "key",
    "value",
    "unit",
    "capturedAt",
    "method",
    "exporter",
)
ROW_OPTIONAL = ("raw",)

# A session row carries the interval it measures beside the duration, because
# a duration with no endpoints cannot be placed on a clock. `startedAt` is the
# session's IDENTITY — there is no identifier anywhere in this record, and
# there must not be: a session id is a machine fact about a private
# conversation (requirement 12), while the instant it began is a time.
SESSION_EXTRA = ("startedAt", "endedAt", "total", "categories", "models")

# The instant form the whole pipeline speaks: RFC 3339, UTC, seconds.
INSTANT_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

# Compact separators: the file is machine-local and read by programs.
COMPACT_SEPARATORS = (",", ":")

# How long a name in this record may be, and what it may contain. Keys carry
# entity names the panels spell (a skill, a boss, a repository), so the rule
# is bounded printable text rather than the label shape the wire enforces —
# and it refuses exactly the bytes that would break the format or hide in it:
# control characters, newlines, and leading or trailing whitespace.
MAX_NAME_LENGTH = 120

# The exporter revision is a short commit id or the word a caller passes when
# it has none. Bounded so a line cannot carry a paragraph.
MAX_EXPORTER_LENGTH = 64

# Directory and file modes. The record is machine-local and private: it holds
# the whole measured history of this workstation's work.
DIR_MODE = 0o700
FILE_MODE = 0o600

# A year file is read WHOLE on every run that touches its year, to build the
# last-value index. That is a deliberate trade: a year of this pipeline's rows
# measures a few megabytes, and reading it costs milliseconds, while any index
# beside the file would be a second source of truth that can disagree with the
# lines it indexes.
MAX_STREAM_FILE_BYTES = 256 << 20

# The raw capture archive. A fresh capture document per source per run is kept
# so a figure can be re-derived from the bytes it came from; the day's LATEST
# is kept forever under `.last`, and the per-run copies age out after a month.
RAW_RETENTION_DAYS = 30

# The exact per-run raw name, and the reason it is a full-match pattern: the
# pruner deletes ONLY names it can generate itself. Anything else in that
# directory — an operator's note, a `.last` archive, a file from a future
# version of this program — is never a pruning candidate.
RAW_RUN_NAME = re.compile(r"^[a-z][a-z0-9-]{0,31}\.T\d{6}Z\.json\.gz$")

# The digest form a row carries. The digest is taken over the UNCOMPRESSED
# JSON bytes, so it stays stable if the archive is ever recompressed.
DIGEST_PREFIX = "sha256:"
DIGEST_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")


def valid_name(value, bound=MAX_NAME_LENGTH):
    """Bounded printable text with no control characters or edge whitespace."""
    if not isinstance(value, str) or not value or len(value) > bound:
        return False
    if value != value.strip():
        return False
    return all(character.isprintable() for character in value)


def valid_instant(value):
    """True for the one instant form this record writes: RFC 3339, UTC."""
    if not isinstance(value, str):
        return False
    try:
        datetime.datetime.strptime(value, INSTANT_FORMAT)
    except ValueError:
        return False
    return True


def valid_count(value):
    """A non-negative integer under the pipeline's shared count bound."""
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 0 <= value <= capture.MAX_COUNT
    )


def instant(moment):
    """Format one aware datetime as this record's instant."""
    return moment.astimezone(datetime.timezone.utc).strftime(INSTANT_FORMAT)


def make_row(
    day,
    stream,
    source,
    kind,
    key,
    value,
    unit,
    captured_at,
    method,
    exporter,
    raw=None,
    extra=None,
):
    """Build one row in the record's field order.

    Admission happens ONCE, in append_rows, which every row this module
    builds is handed to: the same admission the reader applies to a line it
    did not write, so a rule can never hold on read and not on write. A second
    admission here was decorative — no input told it apart from the one
    downstream (PR #312 review, finding 5).
    """
    row = {
        "schema": SCHEMA,
        "day": day,
        "stream": stream,
        "source": source,
        "kind": kind,
        "key": key,
        "value": value,
        "unit": unit,
        "capturedAt": captured_at,
        "method": method,
        "exporter": exporter,
    }
    if raw is not None:
        row["raw"] = raw
    if extra:
        row.update(extra)
    return row


def admit_row(row, stream, line=None):
    """Validate one row, or refuse the run naming the line it came from.

    MEMBERSHIP, never mere shape, exactly as the history store's reader:
    every vocabulary is closed, every figure is a bounded non-negative
    integer, every instant parses, and every name is bounded printable text.
    """

    def refuse(reason):
        if line is None:
            raise LedgerError("the ledger refuses a row: %s" % reason)
        raise LedgerError("the ledger line %d is malformed: %s" % (line, reason))

    if not isinstance(row, dict):
        refuse("it is not a JSON object")
    allowed = set(ROW_REQUIRED) | set(ROW_OPTIONAL)
    if row.get("stream") == STREAM_SESSIONS:
        allowed |= set(SESSION_EXTRA)
    missing = set(ROW_REQUIRED) - set(row)
    if missing:
        refuse("it carries no %s" % sorted(missing)[0])
    unknown = set(row) - allowed
    if unknown:
        refuse("it carries an unknown field")
    if row["schema"] != SCHEMA:
        refuse("it does not declare the expected schema")
    if row["stream"] != stream:
        refuse("it belongs to a different stream")
    if not capture.valid_calendar_day(row["day"]):
        refuse("its day is not a calendar day")
    if row["kind"] not in STREAM_KINDS[stream]:
        refuse("its kind is outside the stream's closed vocabulary")
    if not valid_name(row["source"]):
        refuse("its source is not bounded printable text")
    if not valid_name(row["key"]):
        refuse("its key is not bounded printable text")
    if not valid_count(row["value"]):
        refuse("its value is not a bounded non-negative integer")
    if row["unit"] not in UNITS:
        refuse("its unit is outside the closed unit vocabulary")
    if row["method"] not in METHODS:
        refuse("its method is outside the closed method vocabulary")
    if not valid_instant(row["capturedAt"]):
        refuse("its capture instant is not an RFC 3339 UTC instant")
    if not valid_name(row["exporter"], MAX_EXPORTER_LENGTH):
        refuse("its exporter revision is not bounded printable text")
    if "raw" in row and not (
        isinstance(row["raw"], str) and DIGEST_PATTERN.fullmatch(row["raw"])
    ):
        refuse("its raw digest is not a sha256 digest")
    if stream == STREAM_SESSIONS:
        admit_session_fields(row, refuse)
    return row


def admit_session_fields(row, refuse):
    """The session row's own five fields, admitted on the same terms."""
    missing = set(SESSION_EXTRA) - set(row)
    if missing:
        refuse("a session row carries no %s" % sorted(missing)[0])
    if not valid_instant(row["startedAt"]) or not valid_instant(row["endedAt"]):
        refuse("a session row carries an instant that is not RFC 3339 UTC")
    if row["endedAt"] < row["startedAt"]:
        refuse("a session row ends before it starts")
    if row["key"] != row["startedAt"]:
        # The identity IS the start instant; a row whose key says otherwise
        # would resolve under one name and read under another.
        refuse("a session row's key is not its start instant")
    if not valid_count(row["total"]):
        refuse("a session row carries a malformed total")
    categories = row["categories"]
    if not isinstance(categories, dict):
        refuse("a session row carries a malformed category split")
    for key, value in categories.items():
        if not valid_name(key) or not valid_count(value):
            refuse("a session row carries a malformed category entry")
    models = row["models"]
    if not isinstance(models, list) or not all(valid_name(name) for name in models):
        refuse("a session row carries a malformed model list")


def identity(row):
    """The tuple that names a figure: one day, one source, one kind, one key."""
    return (row["day"], row["source"], row["kind"], row["key"])


def ledger_directories(ledger_dir):
    """Create the record's root privately, or refuse."""
    private_directory(ledger_dir, "the ledger directory could not be created")


def private_directory(path, reason="a ledger directory could not be created"):
    """Create one directory 0700 whatever the umask is, parents included.

    EVERY directory this call creates is made private, not only the last one:
    `mkdir(parents=True)` applies the umask to the ancestors it creates, so a
    record rooted under a fresh path would otherwise sit inside a
    world-readable directory nobody chose. A directory that already exists is
    left exactly as its owner made it — the record is a guest inside whatever
    the operator configured.
    """
    created = []
    probe = path
    while not probe.exists():
        created.append(probe)
        if probe.parent == probe:
            break
        probe = probe.parent
    try:
        path.mkdir(parents=True, exist_ok=True)
        for directory in created:
            os.chmod(directory, DIR_MODE)
    except OSError:
        raise LedgerError(reason)


def stream_path(ledger_dir, stream, year):
    """`<ledger>/<stream>/<YYYY>.ndjson` — one file per stream per year."""
    return ledger_dir / stream / ("%s.ndjson" % year)


def repair_partial_tail(path):
    """Truncate an interrupted final line, and say so. Returns True if repaired.

    This is the ONE tolerated fault, and it is tolerated because it is the one
    an append can actually cause: a process killed between `os.write` and its
    completion leaves bytes with no terminating newline. Every other damage is
    a refusal, because nothing this program does can produce it.
    """
    try:
        with open(path, "rb") as handle:
            data = handle.read()
    except FileNotFoundError:
        return False
    except OSError:
        raise LedgerError("a ledger stream could not be read")
    if not data or data.endswith(b"\n"):
        return False
    cut = data.rfind(b"\n")
    try:
        os.truncate(path, cut + 1)
    except OSError:
        raise LedgerError("a ledger stream's partial line could not be repaired")
    print(
        "ledger repaired a partial line in %s/%s" % (path.parent.name, path.name),
        file=sys.stderr,
    )
    return True


def read_stream_file(path, stream):
    """Read and admit every line of one stream file, in order."""
    try:
        with open(path, "rb") as handle:
            raw = handle.read(MAX_STREAM_FILE_BYTES + 1)
    except FileNotFoundError:
        return []
    except OSError:
        raise LedgerError("a ledger stream could not be read")
    if len(raw) > MAX_STREAM_FILE_BYTES:
        raise LedgerError(
            "a ledger stream is larger than the %d byte bound" % MAX_STREAM_FILE_BYTES
        )
    rows = []
    # Decoded LINE BY LINE so a byte that is not UTF-8 refuses the run naming
    # its line, exactly as every other malformed line does, rather than
    # escaping the per-line loop as a decoding traceback (PR #312 review,
    # finding 3).
    for number, chunk in enumerate(raw.splitlines(), start=1):
        try:
            line = chunk.decode("utf-8")
        except UnicodeDecodeError:
            raise LedgerError("the ledger line %d is malformed: it is not UTF-8" % number)
        if not line.strip():
            raise LedgerError("the ledger line %d is malformed: it is empty" % number)
        try:
            row = json.loads(line)
        except (ValueError, RecursionError):
            raise LedgerError(
                "the ledger line %d is malformed: it is not parsable JSON" % number
            )
        rows.append(admit_row(row, stream, number))
    return rows


def stream_years(ledger_dir, stream):
    """Every year this stream has a file for, oldest first."""
    directory = ledger_dir / stream
    if not directory.is_dir():
        return []
    years = []
    for entry in sorted(directory.iterdir()):
        if entry.suffix == ".ndjson" and entry.stem.isdigit():
            years.append(entry.stem)
    return years


def read_stream(ledger_dir, stream, years=None):
    """Read the whole stream, or only the named years, in file order."""
    if stream not in STREAM_KINDS:
        raise LedgerError("the ledger has no such stream")
    rows = []
    for year in sorted(years) if years is not None else stream_years(ledger_dir, stream):
        rows.extend(read_stream_file(stream_path(ledger_dir, stream, year), stream))
    return rows


def reading(row):
    """The tuple the append rule compares within: one identity, one method.

    Two methods can measure one identity on one day — the capture's lifetime
    figure and the owner's baseline share a value on the baseline's as-of day
    by construction — and each is nothing new only against ITS OWN last row.
    Indexing by identity alone made a verified reading vanish behind a stored
    one (round 1) and then, with method in the comparison, made the capture
    and the baseline re-append each other every run (round 2, finding 2).
    """
    return identity(row) + (row["method"],)


def last_values(rows):
    """The LAST row appended per reading — what the append rule compares to."""
    index = {}
    for row in rows:
        index[reading(row)] = row
    return index


def unchanged(previous, row):
    """True when this row says nothing the last one for its identity did not.

    Compared against the last row of the SAME identity and method (see
    reading): the value is the figure, so an equal value re-measured the same
    way is nothing new, while the method is provenance — a verified reading
    equal in value to a stored one has no verified row before it and is
    appended, which is what lets resolve() privilege it (PR #312 review,
    finding 4). A SESSION also carries its end and its running total, and
    either can move while the duration does not — a session that ended at the
    same second it was last seen but spent more tokens is new information —
    so those are part of the comparison for that stream and nothing else.
    """
    if previous["value"] != row["value"]:
        return False
    if row["stream"] == STREAM_SESSIONS:
        for field in ("endedAt", "total", "categories", "models"):
            if previous.get(field) != row.get(field):
                return False
    return True


def append_rows(ledger_dir, stream, rows):
    """Append only what is new. Returns (appended, unchanged).

    A run that changes nothing writes nothing: no file is opened for writing,
    no directory is created, no line is rewritten.
    """
    if stream not in STREAM_KINDS:
        raise LedgerError("the ledger has no such stream")
    by_year = {}
    for row in rows:
        admit_row(row, stream)
        by_year.setdefault(row["day"][:4], []).append(row)
    appended = kept = 0
    for year in sorted(by_year):
        path = stream_path(ledger_dir, stream, year)
        repair_partial_tail(path)
        index = last_values(read_stream_file(path, stream))
        lines = []
        for row in by_year[year]:
            previous = index.get(reading(row))
            if previous is not None and unchanged(previous, row):
                kept += 1
                continue
            index[reading(row)] = row
            lines.append(json.dumps(row, separators=COMPACT_SEPARATORS))
            appended += 1
        if lines:
            write_lines(path, lines)
    return appended, kept


def write_lines(path, lines):
    """One append: O_APPEND, one write of every line, one fsync.

    `O_APPEND` is what makes the write atomic against another writer — the
    offset is taken by the kernel at write time, so two processes cannot
    interleave — and the single `os.write` is what keeps a line whole. The
    fsync is what makes a written row survive the machine losing power, which
    is the promise "append-only lifelong record" actually makes.
    """
    private_directory(path.parent)
    created = not path.exists()
    payload = ("\n".join(lines) + "\n").encode("utf-8")
    try:
        handle = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, FILE_MODE)
    except OSError:
        raise LedgerError("a ledger stream could not be opened for appending")
    try:
        written = os.write(handle, payload)
        if written != len(payload):
            raise LedgerError("a ledger append wrote a partial record")
        os.fsync(handle)
    except OSError:
        raise LedgerError("a ledger append could not be completed")
    finally:
        os.close(handle)
    if created:
        # The mode above is masked by the process umask, so a file this
        # program creates is pinned explicitly rather than left to inherit.
        os.chmod(path, FILE_MODE)


def resolve(ledger_dir, stream):
    """The current figure per identity, with the reading that won.

    THE RULE, in one place, for every consumer: a verified reading wins
    outright — it is the owner's reading of the reference surface, and it is
    the only reading that may LOWER a figure — and among verified readings the
    latest capture wins. Otherwise the largest figure wins, because every
    other method under-measures rather than over-measures: a pruned tree, a
    recomputed roll-up, a panel that had not refreshed. Sessions resolve by
    latest capture instead, because a session's figures move while it runs and
    the newest reading is simply the current one.
    """
    current = {}
    for row in read_stream(ledger_dir, stream):
        name = identity(row)
        standing = current.get(name)
        if standing is None:
            current[name] = row
            continue
        current[name] = preferred(standing, row)
    return current


def preferred(standing, row):
    """Which of two readings for one identity is the current one."""
    if row["stream"] == STREAM_SESSIONS:
        return row if row["capturedAt"] >= standing["capturedAt"] else standing
    standing_verified = standing["method"] == METHOD_VERIFIED
    row_verified = row["method"] == METHOD_VERIFIED
    if standing_verified != row_verified:
        return row if row_verified else standing
    if standing_verified and row_verified:
        return row if row["capturedAt"] >= standing["capturedAt"] else standing
    if row["value"] != standing["value"]:
        return row if row["value"] > standing["value"] else standing
    return row if row["capturedAt"] >= standing["capturedAt"] else standing


def write_schema_file(ledger_dir):
    """Declare the record's vocabularies beside it, for a reader with no code.

    Rewritten only when its content would change, so the ordinary run leaves
    it untouched — and a vocabulary that grows is described rather than left
    to a stale file nobody notices.
    """
    document = {
        "schema": SCHEMA,
        "streams": {stream: list(kinds) for stream, kinds in sorted(STREAM_KINDS.items())},
        "units": list(UNITS),
        "methods": list(METHODS),
    }
    text = json.dumps(document, indent=2, sort_keys=True) + "\n"
    path = ledger_dir / "schema.json"
    try:
        if path.is_file() and path.read_text(encoding="utf-8") == text:
            return
        replace_atomically(path, text.encode("utf-8"))
    except OSError:
        raise LedgerError("the ledger schema file could not be written")


def replace_atomically(path, payload):
    """Write bytes to a temporary sibling, fsync, then rename into place."""
    private_directory(path.parent)
    temporary = path.with_name(path.name + ".tmp")
    handle = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, FILE_MODE)
    try:
        os.write(handle, payload)
        os.fsync(handle)
    finally:
        os.close(handle)
    os.chmod(temporary, FILE_MODE)
    os.replace(temporary, path)


# ---------------------------------------------------------------------------
# Recording one export run.
# ---------------------------------------------------------------------------

# The stat keys whose reading is not a token count. Every other captured stat
# is tokens; these two are a tally and a duration, and a chart that summed
# them with the token stats would be adding sessions to bytes.
STAT_UNITS = {
    capture.STAT_SESSIONS: UNIT_COUNT,
    "longest-session": UNIT_SECONDS,
}

# The capture-document sections this module reads. Named once: the ledger
# consumes what the capture already produces and derives nothing of its own,
# so a section that moves is one constant here.
CAPTURE_STATS = "stats"
CAPTURE_MODEL_STATS = "modelStats"
LEDGER_BLOCK_SCHEMA = "usage-capture-ledger/v1"


def record_run(
    ledger_dir,
    material,
    history_dir,
    captured_at,
    exporter_version=None,
    today=None,
    baselines=None,
):
    """Write everything one export run measured into the record.

    `material` maps a source key to the run's material for that source:
    `{"capture": <the capture document>, "ledgerBlock": <the block or None>}`.
    A source with no ledger block produces no rows that need one — the block
    is where the per-model-per-category split and the session intervals live —
    and a block that is present but malformed REFUSES the run, exactly as a
    malformed history store does: half a record is worse than none, because
    nothing downstream can tell which half.
    """
    ledger_dir = pathlib.Path(ledger_dir)
    ledger_directories(ledger_dir)
    write_schema_file(ledger_dir)
    stamp = instant(captured_at)
    day = today or captured_at.astimezone().date().isoformat()
    if not capture.valid_calendar_day(day):
        raise LedgerError("the ledger was given a day that is not a calendar day")
    exporter = exporter_version if valid_name(exporter_version or "", MAX_EXPORTER_LENGTH) else "unknown"
    rows = {stream: [] for stream in STREAM_KINDS}
    raw_bytes = 0
    for key in sorted(material):
        entry = material[key] or {}
        if not isinstance(entry, dict):
            raise LedgerError("the ledger was given malformed export material")
        document = entry.get("capture")
        digest = None
        if isinstance(document, dict):
            digest, written = archive_capture(ledger_dir, key, document, day, stamp)
            raw_bytes += written
        elif document is not None:
            raise LedgerError("the ledger was given a malformed capture document")
        rows[STREAM_USAGE].extend(
            stat_rows(key, document, day, stamp, exporter, digest)
        )
        block = entry.get("ledgerBlock")
        if block is None and isinstance(document, dict):
            block = document.get("ledger")
        if block is not None:
            usage, sessions = block_rows(key, block, stamp, exporter, digest)
            rows[STREAM_USAGE].extend(usage)
            rows[STREAM_SESSIONS].extend(sessions)
        if history_dir is not None:
            rows[STREAM_USAGE].extend(
                store_rows(key, pathlib.Path(history_dir), stamp, exporter)
            )
    rows[STREAM_USAGE].extend(baseline_rows(baselines, material, stamp, exporter))
    appended = kept = 0
    for stream in sorted(rows):
        if not rows[stream]:
            continue
        added, unchanged_rows = append_rows(ledger_dir, stream, rows[stream])
        appended += added
        kept += unchanged_rows
    pruned = prune_raw(ledger_dir, day)
    print(
        "ledger appended=%d unchanged=%d raw=%d pruned=%d"
        % (appended, kept, raw_bytes, pruned),
        file=sys.stderr,
    )
    return appended, kept


def archive_capture(ledger_dir, key, document, day, stamp):
    """Keep the run's capture document, and the day's latest, compressed.

    Returns (digest, compressed bytes written). The digest is over the
    UNCOMPRESSED bytes: it names the document, not one compression of it.

    TWO archives, with different lifetimes and different jobs. The day's
    `.last` is REPLACED every run and kept forever, so the archive's size is
    bounded by days rather than by runs. The per-run copy is kept for a month
    so a figure can be traced back to the exact document it came from — and it
    is written only when the run MEASURED something, because the schedule
    wakes every minute and a document that differs from the last one solely in
    the instants it was taken — the capture's and the run's — is the same
    measurement read again. Archiving those would cost a gigabyte a month to
    record that nothing happened.
    """
    payload = json.dumps(document, separators=COMPACT_SEPARATORS).encode("utf-8")
    digest = DIGEST_PREFIX + hashlib.sha256(payload).hexdigest()
    directory = ledger_dir / "raw" / STREAM_USAGE / day
    private_directory(directory)
    compressed = gzip.compress(payload, mtime=0)
    latest = directory / ("%s.last.json.gz" % key)
    written = 0
    if not same_measurement(latest, document):
        run_name = "%s.T%sZ.json.gz" % (key, stamp[11:19].replace(":", ""))
        replace_atomically(directory / run_name, compressed)
        written = len(compressed)
    replace_atomically(latest, compressed)
    return digest, written


# The fields that move on every run whether or not a figure did: the instant
# the capture was taken, and the instant the exporter stamped the walked
# source's document with (`generatedAt` — the capture tool's stdout carries
# it too, fresh on every recapture). Excluding only the first wrote a per-run
# archive on EVERY run (PR #312 review, finding 2).
RUN_INSTANT_FIELDS = frozenset(("capturedAt", "generatedAt"))


def same_measurement(path, document):
    """True when the archived document says the same thing as this one.

    The run instants are excluded from the comparison and nothing else is.
    An archive that is absent, unreadable, or unparsable compares as
    DIFFERENT — the point of the comparison is to avoid writing a redundant
    copy, so the safe answer is always to write one.
    """
    try:
        stored = json.loads(gzip.decompress(path.read_bytes()).decode("utf-8"))
    except (OSError, ValueError, RecursionError, UnicodeDecodeError):
        return False
    if not isinstance(stored, dict):
        return False
    return {
        key: value for key, value in stored.items() if key not in RUN_INSTANT_FIELDS
    } == {key: value for key, value in document.items() if key not in RUN_INSTANT_FIELDS}


def stat_rows(key, document, day, stamp, exporter, digest):
    """The captured lifetime-class stats, as level readings on the capture day.

    These are the figures the vendor's own accounting reports — a lifetime
    total, its class split, a session tally. They have no day of their own, so
    the day they are recorded under is the day they were READ, which is what
    turns a frozen lifetime figure into a series.
    """
    if not isinstance(document, dict):
        return []
    rows = []
    stats = document.get(CAPTURE_STATS)
    if stats is not None:
        if not isinstance(stats, dict):
            raise LedgerError("a capture document carries a malformed stats section")
        for stat, value in sorted(stats.items()):
            if not valid_name(stat) or not valid_count(value):
                raise LedgerError("a capture document carries a malformed stat")
            rows.append(
                make_row(
                    day,
                    STREAM_USAGE,
                    key,
                    KIND_STAT,
                    stat,
                    value,
                    STAT_UNITS.get(stat, UNIT_TOKENS),
                    stamp,
                    METHOD_CAPTURE,
                    exporter,
                    digest,
                )
            )
    model_stats = document.get(CAPTURE_MODEL_STATS)
    if model_stats is not None:
        if not isinstance(model_stats, list):
            raise LedgerError("a capture document carries a malformed model stats section")
        for member in model_stats:
            if not isinstance(member, dict) or set(member) != {"key", "totals"}:
                raise LedgerError("a capture document carries a malformed model stat")
            name = member["key"]
            totals = member["totals"]
            if not valid_name(name) or not isinstance(totals, dict):
                raise LedgerError("a capture document carries a malformed model stat")
            for category, value in sorted(totals.items()):
                if not valid_name(category) or not valid_count(value):
                    raise LedgerError("a capture document carries a malformed model stat")
                rows.append(
                    make_row(
                        day,
                        STREAM_USAGE,
                        key,
                        KIND_MODEL_STAT,
                        "%s/%s" % (name, category),
                        value,
                        UNIT_TOKENS,
                        stamp,
                        METHOD_CAPTURE,
                        exporter,
                        digest,
                    )
                )
    return rows


def block_rows(key, block, stamp, exporter, digest):
    """The capture's ledger block: the per-model-per-category days and sessions.

    The block is the one part of a capture the sealed document cannot carry —
    the wire's emission guard admits dates and integers only, and a session
    interval is neither — so it reaches this record directly from the capture
    rather than through the document that travels.
    """
    if not isinstance(block, dict) or block.get("schema") != LEDGER_BLOCK_SCHEMA:
        raise LedgerError("a capture ledger block does not declare the expected schema")
    if set(block) - {"schema", "modelCategories", "sessions"}:
        raise LedgerError("a capture ledger block carries an unknown section")
    usage = []
    members = block.get("modelCategories")
    if members is not None:
        usage.extend(model_category_rows(key, members, stamp, exporter, digest))
    sessions = []
    entries = block.get("sessions")
    if entries is not None:
        sessions.extend(session_rows(key, entries, stamp, exporter, digest))
    return usage, sessions


def model_category_rows(key, members, stamp, exporter, digest):
    """One row per member per day the block covers, zero days excluded.

    A zero is not a reading here: the block lays every member over the same
    window, so a member that spent nothing on a day carries a zero for
    arithmetic rather than as evidence. Recording it would write one line per
    member per day forever to say nothing happened.
    """
    if not isinstance(members, dict) or set(members) != {"startDate", "members"}:
        raise LedgerError("a capture ledger block carries a malformed model split")
    start = members["startDate"]
    if not capture.valid_calendar_day(start):
        raise LedgerError("a capture ledger block carries no calendar start date")
    entries = members["members"]
    if not isinstance(entries, list):
        raise LedgerError("a capture ledger block carries a malformed model split")
    first = datetime.date.fromisoformat(start)
    rows = []
    for member in entries:
        if not isinstance(member, dict) or set(member) != {"model", "category", "totals"}:
            raise LedgerError("a capture ledger block carries a malformed model member")
        name = member["model"]
        category = member["category"]
        totals = member["totals"]
        if not valid_name(name) or not valid_name(category) or not isinstance(totals, list):
            raise LedgerError("a capture ledger block carries a malformed model member")
        if len(totals) > capture.MAX_SERIES_DAYS:
            raise LedgerError("a capture ledger block covers more days than the series bound")
        for offset, value in enumerate(totals):
            if not valid_count(value):
                raise LedgerError("a capture ledger block carries a malformed count")
            if value == 0:
                continue
            rows.append(
                make_row(
                    (first + datetime.timedelta(days=offset)).isoformat(),
                    STREAM_USAGE,
                    key,
                    KIND_MODEL_CATEGORY,
                    "%s/%s" % (name, category),
                    value,
                    UNIT_TOKENS,
                    stamp,
                    METHOD_CAPTURE,
                    exporter,
                    digest,
                )
            )
    return rows


def session_rows(key, entries, stamp, exporter, digest):
    """One row per session, identified by the instant it began."""
    if not isinstance(entries, list):
        raise LedgerError("a capture ledger block carries a malformed session list")
    rows = []
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {
            "startedAt",
            "endedAt",
            "total",
            "categories",
            "models",
        }:
            raise LedgerError("a capture ledger block carries a malformed session")
        started = entry["startedAt"]
        ended = entry["endedAt"]
        if not valid_instant(started) or not valid_instant(ended):
            raise LedgerError("a capture ledger block carries a malformed session instant")
        began = datetime.datetime.strptime(started, INSTANT_FORMAT).replace(
            tzinfo=datetime.timezone.utc
        )
        finished = datetime.datetime.strptime(ended, INSTANT_FORMAT).replace(
            tzinfo=datetime.timezone.utc
        )
        seconds = int((finished - began).total_seconds())
        if seconds < 0:
            raise LedgerError("a capture ledger block carries a session that ends before it starts")
        rows.append(
            make_row(
                # The day a session belongs to is the LOCAL day it began, the
                # same clock every other day in this pipeline is bucketed by.
                began.astimezone().date().isoformat(),
                STREAM_SESSIONS,
                key,
                KIND_SESSION,
                started,
                seconds,
                UNIT_SECONDS,
                stamp,
                METHOD_CAPTURE,
                exporter,
                digest,
                extra={
                    "startedAt": started,
                    "endedAt": ended,
                    "total": entry["total"],
                    "categories": entry["categories"],
                    "models": entry["models"],
                },
            )
        )
    return rows


def store_rows(key, history_dir, stamp, exporter):
    """Every remembered day from the durable store, verified days marked.

    Read exactly the way the graphing dataset reads them — the store beside
    its verified readings, by the source's own key — so the record and the
    dataset cannot disagree about what a day measured.
    """
    stored = capture.read_history_store(history_dir / ("%s.json" % key))
    verified = capture.read_verified_readings(history_dir / ("%s.verified.json" % key))
    rows = []
    for day, entry in sorted(stored.items()):
        method = METHOD_VERIFIED if day in verified else METHOD_STORE
        rows.append(
            make_row(
                day,
                STREAM_USAGE,
                key,
                KIND_TOTAL,
                KEY_TOKENS,
                entry[capture.HISTORY_TOTAL_KEY],
                UNIT_TOKENS,
                stamp,
                method,
                exporter,
            )
        )
        for name, kind in (("categories", KIND_CATEGORY), ("models", KIND_MODEL)):
            split = entry.get(name)
            if not split:
                continue
            for member, value in sorted(split.items()):
                rows.append(
                    make_row(
                        day,
                        STREAM_USAGE,
                        key,
                        kind,
                        member,
                        value,
                        UNIT_TOKENS,
                        stamp,
                        method,
                        exporter,
                    )
                )
    return rows


def baseline_rows(baselines, material, stamp, exporter):
    """The one-time vendor reading, recorded on the day it covers.

    A baseline is a reading like any other and belongs in the record for the
    same reason the rest does: without it the lifetime figure this pipeline
    serves has no visible origin, and the day it was taken is the only day it
    describes.
    """
    if not baselines:
        return []
    rows = []
    for key in sorted(baselines):
        if key not in material:
            continue
        total, as_of = baselines[key]
        if not capture.valid_calendar_day(as_of) or not valid_count(total):
            raise LedgerError("a lifetime baseline is malformed")
        rows.append(
            make_row(
                as_of,
                STREAM_USAGE,
                key,
                KIND_STAT,
                capture.STAT_LIFETIME,
                total,
                UNIT_TOKENS,
                stamp,
                METHOD_BASELINE,
                exporter,
            )
        )
    return rows


def archive_panel(ledger_dir, stream, day, document):
    """Keep one panel envelope for the day, replacing the day's earlier copy.

    Returns (digest, compressed bytes). One file per stream per day: the
    snapshot runs once a day, and a panel that is fetched twice on one day is
    the same day's reading taken again rather than a second day.
    """
    payload = json.dumps(document, separators=COMPACT_SEPARATORS).encode("utf-8")
    digest = DIGEST_PREFIX + hashlib.sha256(payload).hexdigest()
    directory = ledger_dir / "raw" / stream
    private_directory(directory)
    compressed = gzip.compress(payload, mtime=0)
    replace_atomically(directory / ("%s.json.gz" % day), compressed)
    return digest, len(compressed)


def prune_raw(ledger_dir, today):
    """Delete per-run raw captures older than the retention, and nothing else.

    TWO conditions, both required: the directory names a day past the
    retention, AND the file name is one this program generates. The day's
    `.last` archive is kept forever, and anything an operator or a future
    version of this program put there is never a candidate — a pruner that
    deletes by directory would eventually delete something nobody could get
    back.
    """
    root = ledger_dir / "raw" / STREAM_USAGE
    if not root.is_dir():
        return 0
    boundary = datetime.date.fromisoformat(today) - datetime.timedelta(
        days=RAW_RETENTION_DAYS
    )
    pruned = 0
    for directory in sorted(root.iterdir()):
        if not directory.is_dir() or not capture.valid_calendar_day(directory.name):
            continue
        if datetime.date.fromisoformat(directory.name) >= boundary:
            continue
        for entry in sorted(directory.iterdir()):
            if not entry.is_file() or not RAW_RUN_NAME.fullmatch(entry.name):
                continue
            try:
                entry.unlink()
            except OSError:
                raise LedgerError("a raw capture could not be pruned")
            pruned += 1
    return pruned


# ---------------------------------------------------------------------------
# Derived exports: regenerated from the lines, never edited beside them.
# ---------------------------------------------------------------------------

SQLITE_NAME = "ledger.sqlite"

# The row columns every stream table carries, in the record's own field order.
TABLE_COLUMNS = (
    "day",
    "source",
    "kind",
    "key",
    "value",
    "unit",
    "capturedAt",
    "method",
    "exporter",
    "raw",
)
SESSION_COLUMNS = ("startedAt", "endedAt", "total", "categories", "models")


def table_row(row, columns):
    """One row's values in column order; JSON for the two nested columns."""
    values = []
    for column in columns:
        value = row.get(column)
        if column in ("categories", "models") and value is not None:
            value = json.dumps(value, separators=COMPACT_SEPARATORS, sort_keys=True)
        values.append(value)
    return values


def export_ledger(ledger_dir, out_dir):
    """Rebuild every derived view from the lines, atomically.

    Rebuilt from scratch rather than updated: the lines are the record, so a
    derived view that drifted from them is repaired by deleting it. The
    database lands through a temporary file and one rename, so a reader never
    sees a half-built one.
    """
    ledger_dir = pathlib.Path(ledger_dir)
    out_dir = pathlib.Path(out_dir)
    private_directory(out_dir)
    database = out_dir / SQLITE_NAME
    temporary = out_dir / (SQLITE_NAME + ".tmp")
    if temporary.exists():
        temporary.unlink()
    connection = sqlite3.connect(temporary)
    try:
        written = {}
        for stream in sorted(STREAM_KINDS):
            columns = TABLE_COLUMNS + (
                SESSION_COLUMNS if stream == STREAM_SESSIONS else ()
            )
            rows = read_stream(ledger_dir, stream)
            create_table(connection, stream, columns)
            insert_rows(connection, stream, columns, rows)
            current = sorted(resolve(ledger_dir, stream).items())
            create_table(connection, "%s_current" % stream, columns)
            insert_rows(connection, "%s_current" % stream, columns, [row for _, row in current])
            written[stream] = write_csv(
                out_dir / ("%s.csv" % stream), columns, [row for _, row in current]
            )
        connection.commit()
    finally:
        connection.close()
    os.chmod(temporary, FILE_MODE)
    os.replace(temporary, database)
    return written


def create_table(connection, name, columns):
    connection.execute(
        "CREATE TABLE %s (%s)" % (name, ", ".join('"%s"' % column for column in columns))
    )


def insert_rows(connection, name, columns, rows):
    connection.executemany(
        "INSERT INTO %s (%s) VALUES (%s)"
        % (
            name,
            ", ".join('"%s"' % column for column in columns),
            ", ".join("?" for _ in columns),
        ),
        [table_row(row, columns) for row in rows],
    )


def write_csv(path, columns, rows):
    """One long-format CSV per stream, header first. Returns the row count."""
    temporary = path.with_name(path.name + ".tmp")
    with open(temporary, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(columns)
        for row in rows:
            writer.writerow(["" if value is None else value for value in table_row(row, columns)])
    os.chmod(temporary, FILE_MODE)
    os.replace(temporary, path)
    return len(rows)


def parse_arguments(argv):
    parser = argparse.ArgumentParser(
        description="Read and export the append-only usage ledger.",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export", help="rebuild the derived SQLite and CSV views")
    export.add_argument("--ledger", required=True, help="the ledger directory")
    export.add_argument(
        "--out",
        help="where the derived views are written; defaults to <ledger>/exports",
    )
    return parser.parse_args(argv)


def main(argv=None):
    arguments = parse_arguments(sys.argv[1:] if argv is None else argv)
    ledger_dir = pathlib.Path(arguments.ledger).expanduser()
    if not ledger_dir.is_dir():
        print("no such ledger directory", file=sys.stderr)
        return 2
    out_dir = (
        pathlib.Path(arguments.out).expanduser()
        if arguments.out is not None
        else ledger_dir / "exports"
    )
    try:
        written = export_ledger(ledger_dir, out_dir)
    except LedgerError as error:
        print(str(error), file=sys.stderr)
        return 1
    except OSError:
        print("the ledger exports could not be written", file=sys.stderr)
        return 1
    print(
        "ledger export " + " ".join("%s=%d" % pair for pair in sorted(written.items())),
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
