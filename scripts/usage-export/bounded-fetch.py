#!/usr/bin/env python3
"""Bound the checkout update's one `git fetch` (issue #358).

The push job keeps its checkout current by fetching `main` from `origin` at
most once an hour. A fetch that stalls would hold the single-instance job
exactly as a stalled push would, so it runs under the SSH runner's own
lifecycle — one fixed whole-invocation deadline on both clocks, the owned
process group retired on expiry, diagnostics reduced to a closed reason —
reused from bounded-ssh.py rather than restated. It runs exactly one command,
and no operator setting changes the command or extends the deadline.

    bounded-fetch.py REPO_DIR
"""

from __future__ import annotations

import importlib.util
import pathlib
import signal
import sys

DEADLINE_SECONDS = 30


def load_runner():
    path = pathlib.Path(__file__).resolve().with_name("bounded-ssh.py")
    spec = importlib.util.spec_from_file_location("bounded_ssh", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def interrupted(signum: int, _frame) -> None:
    # Unwinds bounded_command's finally, which retires the fetch's group.
    raise SystemExit(128 + signum)


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage-export: WARN repo-update fetch-failed reason=invalid-invocation", file=sys.stderr)
        return 1
    for signum in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(signum, interrupted)
    code, _, reason = load_runner().bounded_command(
        ["git", "-C", argv[0], "fetch", "--quiet", "origin", "main"], timeout=DEADLINE_SECONDS
    )
    if code != 0:
        # The runner's catch-all names ssh; this command is not one.
        reason = "fetch-refused" if reason == "ssh-refused" else reason
        print("usage-export: WARN repo-update fetch-failed reason=%s" % reason, file=sys.stderr)
    return code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
