#!/usr/bin/env python3
"""Bound one existing SSH invocation without exposing its private diagnostics.

The exporter still owns the complete SSH option set and verifies the returned
checksum. This runner adds a fixed whole-invocation deadline, including a peer
that answers keepalives but never finishes its forced command. No operator
setting disables or extends the deadline. Both clocks are checked: a suspended
workstation must retire an expired attempt when it wakes, even on a platform
whose monotonic clock pauses during sleep.
"""

from __future__ import annotations

import os
import selectors
import signal
import subprocess
import sys
import time

DEADLINE_SECONDS = 45
MAX_RESPONSE_BYTES = 32768  # Also accommodates the local `ssh -G` self-check.


def failure_reason(stderr: bytes) -> str:
    """Closed diagnostic vocabulary; private host, key and path text stays local."""
    lowered = stderr.lower()
    for needles, reason in (
        ((b"network is unreachable", b"no route to host"), "network-unreachable"),
        ((b"connection timed out", b"operation timed out"), "connection-timeout"),
        ((b"connection refused",), "connection-refused"),
        ((b"connection reset", b"connection closed", b"broken pipe"), "connection-lost"),
        ((b"could not resolve", b"name or service not known"), "name-resolution"),
        ((b"host key verification failed", b"remote host identification has changed"), "host-verification"),
        ((b"permission denied", b"authentication failed"), "authentication-refused"),
    ):
        if any(needle in lowered for needle in needles):
            return reason
    return "ssh-refused"


def bounded_command(argv: list[str], *, timeout: float = DEADLINE_SECONDS) -> tuple[int, bytes, str]:
    """Reap the leader on every exit; terminate its owned group on interruption.

    A normal completed invocation has closed both streams and its leader has
    been reaped. The exporter's pinned SSH options forbid backgrounding,
    multiplexing and local/proxy commands; this is not a general sandbox for
    arbitrary commands that intentionally leave detached descendants.
    """
    child = None
    stdout = bytearray()
    stderr = bytearray()
    reason = ""
    completed = False
    started = time.monotonic()
    wall_started = time.time()
    try:
        child = subprocess.Popen(
            argv, stdin=sys.stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=True,
        )
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ, stdout)
            selector.register(child.stderr, selectors.EVENT_READ, stderr)
            while selector.get_map():
                remaining = min(timeout - (time.monotonic() - started),
                                timeout - (time.time() - wall_started))
                if remaining <= 0:
                    reason = "deadline-exceeded"
                    break
                for key, _ in selector.select(min(remaining, 0.25)):
                    chunk = os.read(key.fileobj.fileno(), 4096)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    if len(stdout) + len(stderr) + len(chunk) > MAX_RESPONSE_BYTES:
                        reason = "response-over-budget"
                        break
                    key.data.extend(chunk)
                if reason:
                    break
            if not reason:
                remaining = min(timeout - (time.monotonic() - started),
                                timeout - (time.time() - wall_started))
                try:
                    code = child.wait(timeout=max(0, remaining))
                except subprocess.TimeoutExpired:
                    reason = "deadline-exceeded"
                else:
                    completed = True
                    if code == 0:
                        return 0, bytes(stdout), ""
                    return code if code > 0 else 1, b"", failure_reason(bytes(stderr))
        return 124 if reason == "deadline-exceeded" else 1, b"", reason
    except OSError:
        return 1, b"", "runner-unavailable"
    finally:
        if child is not None:
            # The group was created for this invocation only. On interruption
            # kill it even if a descendant retained an exited leader's pipe.
            if not completed:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            child.wait()
            child.stdout.close()
            child.stderr.close()


def interrupted(signum: int, _frame) -> None:
    # SystemExit unwinds bounded_command's finally before the runner exits;
    # the default signal disposition would abandon its separate SSH group.
    print("usage-export: ssh refused reason=interrupted", file=sys.stderr)
    raise SystemExit(128 + signum)


def main(argv: list[str]) -> int:
    if not argv or argv[0] != "ssh":
        print("usage-export: ssh refused reason=invalid-invocation", file=sys.stderr)
        return 1
    for signum in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(signum, interrupted)
    code, output, reason = bounded_command(argv)
    if code == 0:
        sys.stdout.buffer.write(output)
    else:
        print(f"usage-export: ssh refused reason={reason} deadline={DEADLINE_SECONDS}s", file=sys.stderr)
    return code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
