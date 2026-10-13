#!/usr/bin/env python3
"""Ask the site whether the page serves data as new as the last push (issue #358).

WHY THIS EXISTS. The push verifies the checksum the receiving host returns,
which proves delivery to the host and nothing about what the PAGE serves. The
host once rebooted with its clock weeks behind, the origin fell back to its
embedded release snapshot for days, and every run still logged a verified
push. This helper closes that gap from the workstation's side.

    served-check.py record --state FILE --document PLAIN --sha256 HEX
    served-check.py check  --state FILE --site https://<site> --exporter REV

`record` runs after a verified push and writes a small private state file:
the document's export instant, EVERY source's capture instant by source key,
the oldest of them — which is exactly what the origin serves as the
envelope's `generatedAt` once it has admitted the document — the sealed
checksum, and the push time. `check` runs at the START of the next run, so
no run waits for the origin's next re-read: it reads the public token-usage
envelope once and logs one line, SERVED when the envelope is `ok`, its
`generatedAt` is at least the recorded oldest capture, AND every recorded
source is served with a capture instant at least as new as the pushed one;
NOT-SERVED otherwise. Comparing the oldest capture alone let the document
pushed BEFORE the last one pass whenever one source had moved on and the
other had not (review F2).

What this can prove is bounded by what a visitor's GET shows. The envelope
carries each source's capture instant, but neither the document's export
instant nor its checksum, so SERVED means the page serves data at least as
new as the last push for every source — not that it serves that exact
document. The export instant is bound only where it IS a capture instant:
the walked source is stamped with it. The checksum is recorded beside them
and never compared.

A NOT-SERVED state older than fifteen minutes raises ONE desktop
notification, not repeated until a SERVED run clears it, and that run logs
RECOVERED. Instants, a status word, a count and closed reason codes only: no
payload content and no upstream prose ever reaches the log.

The request is the nightly snapshot's own bounded fetch, imported rather than
restated — https only, the resolved host must equal the site's, no redirect
followed, one 20-second timeout, one bounded read — under one whole-run
deadline on top. It runs OUTSIDE the producer sandbox, like the transport:
it walks no records. Nothing here can fail or delay the push; every fault is
one WARN line and exit status 0.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import ledger_snapshot as snapshot  # noqa: E402

ledger = snapshot.ledger

PANEL = "token-usage"
STATE_SCHEMA = "push-state/v2"
# The state before per-source capture instants were recorded. It is read only
# so a push carries the NOT-SERVED latch across the upgrade; it is never judged.
EARLIER_STATE_SCHEMA = "push-state/v1"
ENVELOPE_OK = snapshot.ENVELOPE_OK
USER_AGENT_PRODUCT = "naranjo-online-usage-export"

# How long the page may go on not serving the last push before the desktop
# is told, and the whole-run bound over the one request (the fetch's own
# timeout is per socket operation, so a dripping answer needs this too).
NOTIFY_AFTER_SECONDS = 15 * 60
DEADLINE_SECONDS = 30

# The plaintext document is read for two kinds of field; it is bounded well
# past the pipeline's own plaintext ceiling.
MAX_DOCUMENT_BYTES = 1 << 20
MAX_STATE_BYTES = 4096

# Fixed, payload-free text. AppleScript string literal: no quotes inside.
NOTIFICATION = (
    'display notification "The token-usage panel has not served the latest push '
    'for over 15 minutes." with title "Usage export"'
)


class Unavailable(Exception):
    """The check could not be evaluated; `reason` is a closed code."""

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def parse_instant(value):
    if not ledger.valid_instant(value):
        return None
    return datetime.datetime.strptime(value, ledger.INSTANT_FORMAT).replace(
        tzinfo=datetime.timezone.utc
    )


def seconds(later, earlier):
    return max(0, int((later - earlier).total_seconds()))


def source_instants(value):
    """A non-empty {source key: capture instant} map, or None."""
    if not isinstance(value, dict) or not value:
        return None
    instants = {key: parse_instant(moment) for key, moment in value.items()}
    if not all(isinstance(key, str) and key for key in instants) or None in instants.values():
        return None
    return instants


def read_state(path):
    """The recorded state, or None when nothing was recorded yet."""
    try:
        with open(path, "rb") as handle:
            raw = handle.read(MAX_STATE_BYTES + 1)
    except FileNotFoundError:
        return None
    except OSError:
        raise Unavailable("state-unreadable")
    try:
        state = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError, RecursionError):
        raise Unavailable("state-unreadable")
    if (
        len(raw) > MAX_STATE_BYTES
        or not isinstance(state, dict)
        or state.get("schema") not in (STATE_SCHEMA, EARLIER_STATE_SCHEMA)
        or state.get("schema") == STATE_SCHEMA and source_instants(state.get("capturedAt")) is None
        or not all(
            parse_instant(state.get(key)) for key in ("generatedAt", "oldestCapturedAt", "pushedAt")
        )
        or state.get("notServedSince") is not None and parse_instant(state["notServedSince"]) is None
        or not isinstance(state.get("notified"), bool)
    ):
        raise Unavailable("state-unreadable")
    return state


def write_state(path, state):
    """Private, and replaced in one rename so a reader never sees half."""
    path = pathlib.Path(path)
    temporary = path.with_name(path.name + ".tmp")
    handle = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(handle, (json.dumps(state, sort_keys=True) + "\n").encode("utf-8"))
    finally:
        os.close(handle)
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def pushed_instants(document_path):
    """The document's export instant and every source's capture instant."""
    try:
        with open(document_path, "rb") as handle:
            raw = handle.read(MAX_DOCUMENT_BYTES + 1)
        document = json.loads(raw.decode("utf-8"))
    except (OSError, ValueError, UnicodeDecodeError, RecursionError):
        raise Unavailable("document-unreadable")
    if len(raw) > MAX_DOCUMENT_BYTES or not isinstance(document, dict):
        raise Unavailable("document-unreadable")
    generated = parse_instant(document.get("generatedAt"))
    sources = document.get("sources")
    if generated is None or not isinstance(sources, dict):
        raise Unavailable("document-unreadable")
    captured = source_instants(
        {key: section.get("capturedAt") if isinstance(section, dict) else None for key, section in sources.items()}
    )
    if captured is None:
        raise Unavailable("document-unreadable")
    return generated, captured


def record(state_path, document_path, sha256, now):
    """Write what this push delivered, keeping the NOT-SERVED clock running:
    a push every minute must not restart the fifteen minutes it measures."""
    if len(sha256) != 64 or any(character not in "0123456789abcdef" for character in sha256):
        raise Unavailable("checksum-malformed")
    generated, captured = pushed_instants(document_path)
    try:
        previous = read_state(state_path) or {}
    except Unavailable:
        previous = {}
    write_state(
        state_path,
        {
            "schema": STATE_SCHEMA,
            "generatedAt": ledger.instant(generated),
            "capturedAt": {key: ledger.instant(moment) for key, moment in captured.items()},
            "oldestCapturedAt": ledger.instant(min(captured.values())),
            "sha256": sha256,
            "pushedAt": ledger.instant(now),
            "notServedSince": previous.get("notServedSince"),
            "notified": previous.get("notified", False),
        },
    )


def fetch_envelope(site, exporter, opener=None):
    """One bounded read of the public envelope, refusals as closed codes."""
    try:
        host = snapshot.admit_site(site)
    except ledger.LedgerError:
        raise Unavailable("bad-site")
    agent = "%s/%s" % (USER_AGENT_PRODUCT, exporter)
    try:
        return snapshot.fetch_panel(
            opener if opener is not None else snapshot.build_opener(),
            snapshot.panel_url(site, PANEL),
            host,
            agent,
        )
    except snapshot.FetchRefused as error:
        raise Unavailable(error.reason)


def status_word(value):
    """The envelope's status as a log token, or `unrecognised`: one lowercase word."""
    if isinstance(value, str) and 0 < len(value) <= 16 and value.isascii() and value.isalpha() and value.islower():
        return value
    return "unrecognised"


def served_captures(envelope):
    """Each served source's capture instant by source key (None where the
    source carries none). The keys are data: the same labels the pushed
    document names its sources by."""
    data = envelope.get("data")
    sources = data.get("sources") if isinstance(data, dict) else None
    if not isinstance(sources, list):
        raise Unavailable("malformed-envelope")
    captures = {}
    for source in sources:
        label = source.get("label") if isinstance(source, dict) else None
        if not isinstance(label, str) or label in captures:
            raise Unavailable("malformed-envelope")
        captures[label] = parse_instant(source.get("capturedAt"))
    return captures


def evaluate(state, envelope, now, notify):
    """The run's line(s) and the state to keep, from one envelope.

    Returns (stdout lines, stderr lines, new state)."""
    if envelope.get("id") != PANEL:
        raise Unavailable("malformed-envelope")
    served_at = parse_instant(envelope.get("generatedAt"))
    if served_at is None:
        raise Unavailable("malformed-envelope")
    served = served_captures(envelope)
    expected = parse_instant(state["oldestCapturedAt"])
    # Every pushed source, matched by key: one the page does not serve, or
    # serves with an older capture, is behind.
    behind = sum(
        1
        for key, pushed in source_instants(state["capturedAt"]).items()
        if served.get(key) is None or served[key] < pushed
    )
    since_push = seconds(now, parse_instant(state["pushedAt"]))
    state = dict(state)
    if envelope.get("status") == ENVELOPE_OK and served_at >= expected and behind == 0:
        out = ["usage-export: SERVED status=ok lag=%ds" % since_push]
        if state["notServedSince"] is not None:
            out.append(
                "usage-export: RECOVERED served after %ds"
                % seconds(now, parse_instant(state["notServedSince"]))
            )
        state["notServedSince"], state["notified"] = None, False
        return out, [], state
    err = [
        "usage-export: WARN NOT-SERVED status=%s served_at=%s expected_at>=%s sources_behind=%d since_push=%ds"
        % (status_word(envelope.get("status")), ledger.instant(served_at), state["oldestCapturedAt"], behind, since_push)
    ]
    since = parse_instant(state["notServedSince"]) if state["notServedSince"] else None
    # A first NOT-SERVED starts the clock; so does one recorded in the future,
    # because that is a clock that moved back, not fifteen minutes elapsed.
    if since is None or since > now:
        state["notServedSince"], since = ledger.instant(now), now
    if not state["notified"] and seconds(now, since) > NOTIFY_AFTER_SECONDS:
        notify()
        state["notified"] = True
    return [], err, state


def notify_desktop():
    """One user notification, or nothing where the facility does not exist."""
    osascript = shutil.which("osascript")
    if osascript is None:
        return
    try:
        subprocess.run(
            [osascript, "-e", NOTIFICATION],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        pass


def check(state_path, site, exporter, now, opener=None, notify=notify_desktop):
    """Returns (stdout lines, stderr lines); writes the state when it moved."""
    try:
        state = read_state(state_path) if state_path else None
        if state is None:
            raise Unavailable("no-push-state")
        if state["schema"] != STATE_SCHEMA:
            raise Unavailable("state-outdated")
        envelope = fetch_envelope(site, exporter, opener)
        out, err, updated = evaluate(state, envelope, now, notify)
    except Unavailable as error:
        return [], ["usage-export: WARN served-check unavailable reason=%s" % error.reason]
    if updated != state:
        try:
            write_state(state_path, updated)
        except OSError:
            err.append("usage-export: WARN served-check unavailable reason=state-unwritable")
    return out, err


class Deadline(Exception):
    pass


def expire(_signum, _frame):
    raise Deadline()


def parse_arguments(argv):
    parser = argparse.ArgumentParser(description="Record a push; check the page serves it.")
    commands = parser.add_subparsers(dest="command", required=True)
    recorded = commands.add_parser("record")
    recorded.add_argument("--state", required=True)
    recorded.add_argument("--document", required=True)
    recorded.add_argument("--sha256", required=True)
    checked = commands.add_parser("check")
    checked.add_argument("--state", default="")
    checked.add_argument("--site", required=True)
    checked.add_argument("--exporter", required=True)
    return parser.parse_args(argv)


def main(argv=None):
    arguments = parse_arguments(sys.argv[1:] if argv is None else argv)
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
    if arguments.command == "record":
        try:
            record(arguments.state, arguments.document, arguments.sha256, now)
        except Unavailable as error:
            print("usage-export: WARN push-state unrecorded reason=%s" % error.reason, file=sys.stderr)
        except OSError:
            print("usage-export: WARN push-state unrecorded reason=state-unwritable", file=sys.stderr)
        return 0
    signal.signal(signal.SIGALRM, expire)
    signal.alarm(DEADLINE_SECONDS)
    try:
        out, err = check(arguments.state, arguments.site, arguments.exporter, now)
    except Deadline:
        out, err = [], ["usage-export: WARN served-check unavailable reason=deadline-exceeded"]
    finally:
        signal.alarm(0)
    for line in out:
        print(line)
    for line in err:
        print(line, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
