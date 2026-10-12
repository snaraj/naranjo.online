"""Publish the PR gate's own coverage numbers to the generated `badges` branch.

WHY THIS IS NOT A JOB IN THE PR GATE (issue #350). The release publisher
authorizes against the gate's EXACT job inventory (`EXPECTED_MAIN_JOBS` in
`release_contract.py`), so a badge job inside the gate made a badge push a
release precondition: a transport failure on a generated branch held back a
release whose tests, chart and scans had all passed. And main pushes
deliberately share no gate concurrency group, so two runs could finish out of
order and the older one force-push its numbers over the newer. This runs
AFTER the gate, from `.github/workflows/coverage-badges.yml`, on the numbers
the gate's `application` job measured and handed over as the `coverage-totals`
artifact of that exact run -- nothing is rebuilt or re-measured -- and no
release input reads its result.

RECENCY. Every badge commit says which main commit it measured: in its
subject, `coverage badges for <sha>`, the form the branch has always carried,
and in `source.json` beside the badges. A publication proceeds only when the
commit the current badges recorded is an ancestor of, or equal to, the commit
being published. When the commit being published is the OLDER of the two, the
newer badges stand and this run publishes nothing, successfully: two merges
finishing out of order is ordinary, not a failure. Anything else -- a badge
head that does not say what it measured, a recorded commit that is not on
this history -- fails, because nobody can then say which numbers are newer.
Deleting the `badges` branch is the recovery: an absent branch is published.

ONE DECISION, ONE PUSH. The push carries a lease on the exact badge commit the
decision read, so a publisher that lost a race is refused by the server and
decides again from what won. A push whose answer was lost is recognised on the
next attempt as already published. Attempts are bounded; running out fails the
run, which is visible and touches no release.

Logging follows the repository's failure-visibility rule: one START line, one
line per refused attempt, one SUMMARY with the decision and duration.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable

BRANCH = "refs/heads/badges"
SEEN_MAIN = "refs/coverage-badges/main"
SEEN_BADGES = "refs/coverage-badges/badges"
SCHEMA = "coverage-totals/v1"
TOTALS_KEYS = {"schema", "sourceSha", "runId", "go", "frontend"}
PERCENT = re.compile(r"\A(?:100(?:\.0+)?|[0-9]{1,2}(?:\.[0-9]+)?)\Z")
SHA = re.compile(r"\A[0-9a-f]{40}\Z")
RECORDED = re.compile(r"\Acoverage badges for ([0-9a-f]{40})\Z")
ATTEMPTS = 5
BACKOFF_SECONDS = 5
BOT_IDENTITY = {
    "GIT_AUTHOR_NAME": "github-actions[bot]",
    "GIT_AUTHOR_EMAIL": "41898282+github-actions[bot]@users.noreply.github.com",
    "GIT_COMMITTER_NAME": "github-actions[bot]",
    "GIT_COMMITTER_EMAIL": "41898282+github-actions[bot]@users.noreply.github.com",
}


class Refused(Exception):
    """Evidence this publisher will not turn into badges; never retried."""


class Transport(Exception):
    """A git transport step that failed; the attempt is retried."""


Git = Callable[..., subprocess.CompletedProcess]


def git(repository: Path, *args: str, stdin: bytes | None = None, env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(repository), *args],
        input=stdin,
        capture_output=True,
        check=False,
        env=None if env is None else {**os.environ, **env},
    )


def _out(result: subprocess.CompletedProcess, failure: type[Exception], what: str) -> str:
    if result.returncode != 0:
        raise failure(f"{what} failed: {result.stderr.decode(errors='replace').strip()}")
    return result.stdout.decode().strip()


def read_totals(path: Path, source_sha: str, run_id: int) -> tuple[str, str]:
    """The gate's own numbers, bound to the exact run and commit, or Refused."""
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise Refused(f"the gate's coverage totals cannot be read: {error}") from error
    if not isinstance(record, dict) or set(record) != TOTALS_KEYS:
        raise Refused(f"the coverage totals must carry exactly {sorted(TOTALS_KEYS)}")
    if record["schema"] != SCHEMA:
        raise Refused(f"the coverage totals schema must be {SCHEMA!r}")
    if record["sourceSha"] != source_sha:
        raise Refused("the coverage totals were measured at another commit than the one this run publishes")
    if type(record["runId"]) is not int or record["runId"] != run_id:
        raise Refused("the coverage totals belong to another gate run")
    for name in ("go", "frontend"):
        if not (isinstance(record[name], str) and PERCENT.match(record[name])):
            raise Refused(f"the {name} coverage total is not a percentage")
    return record["go"], record["frontend"]


def color(percent: str) -> str:
    value = float(percent)
    return "brightgreen" if value >= 90 else "green" if value >= 75 else "yellow" if value >= 60 else "orange"


def badge_files(go: str, frontend: str, source_sha: str, run_id: int) -> dict[str, str]:
    """The branch's whole content: two shields endpoint files and their provenance."""

    def badge(label: str, percent: str) -> str:
        fields = {"schemaVersion": 1, "label": label, "message": f"{percent}%", "color": color(percent)}
        return json.dumps(fields, separators=(",", ":")) + "\n"

    provenance = {"sourceSha": source_sha, "runId": run_id, "go": go, "frontend": frontend}
    return {
        "go-coverage.json": badge("go coverage", go),
        "frontend-coverage.json": badge("frontend coverage", frontend),
        "source.json": json.dumps(provenance, separators=(",", ":")) + "\n",
    }


def badge_commit(repository: Path, files: dict[str, str], source_sha: str, run: Git) -> str:
    """One parentless commit holding exactly `files`, its subject naming the source."""
    entries = []
    for name, text in sorted(files.items()):
        blob = _out(run(repository, "hash-object", "-w", "--stdin", stdin=text.encode()), Refused, "hash-object")
        entries.append(f"100644 blob {blob}\t{name}\n")
    tree = _out(run(repository, "mktree", stdin="".join(entries).encode()), Refused, "mktree")
    return _out(
        run(repository, "commit-tree", tree, "-m", f"coverage badges for {source_sha}", env=BOT_IDENTITY),
        Refused,
        "commit-tree",
    )


def is_ancestor(repository: Path, older: str, newer: str, run: Git) -> bool:
    result = run(repository, "merge-base", "--is-ancestor", older, newer)
    if result.returncode not in (0, 1):
        raise Refused(f"{older} cannot be placed against {newer} on this history: {result.stderr.decode(errors='replace').strip()}")
    return result.returncode == 0


def observe(repository: Path, remote: str, run: Git) -> str | None:
    """Fetch main and the current badge head; return that head, or None when absent."""
    listed = _out(run(repository, "ls-remote", remote, BRANCH), Transport, "ls-remote")
    refspecs = [f"+refs/heads/main:{SEEN_MAIN}"] + ([f"+{BRANCH}:{SEEN_BADGES}"] if listed else [])
    _out(run(repository, "fetch", "--no-tags", "--quiet", remote, *refspecs), Transport, "fetch")
    if not listed:
        return None
    return _out(run(repository, "rev-parse", "--verify", f"{SEEN_BADGES}^{{commit}}"), Refused, "rev-parse")


def publish(
    repository: Path,
    remote: str,
    source_sha: str,
    files: dict[str, str],
    *,
    run: Git = git,
    attempts: int = ATTEMPTS,
    pause: Callable[[float], None] = time.sleep,
) -> str:
    """Publish `files` as the badge branch unless newer badges already stand.

    Returns "published", or "superseded" when the badges record a newer commit.
    """
    commit = badge_commit(repository, files, source_sha, run)
    for attempt in range(1, attempts + 1):
        try:
            observed = observe(repository, remote, run)
        except Transport as error:
            _log(f"RETRY attempt={attempt} {error}")
            pause(BACKOFF_SECONDS * attempt)
            continue
        if not is_ancestor(repository, source_sha, SEEN_MAIN, run):
            raise Refused(f"{source_sha} is not on main")
        if observed == commit:
            return "published"  # an earlier attempt's push landed; its answer was lost
        if observed is not None:
            subject = _out(run(repository, "log", "-1", "--format=%s", observed), Refused, "log")
            recorded = RECORDED.match(subject)
            if recorded is None:
                raise Refused(f"the badges head {observed} does not say which commit it measured")
            if not is_ancestor(repository, recorded.group(1), source_sha, run):
                if is_ancestor(repository, source_sha, recorded.group(1), run):
                    return "superseded"
                raise Refused(f"the badges record {recorded.group(1)}, which is not on {source_sha}'s history")
        pushed = run(
            repository, "push", "--quiet", f"--force-with-lease={BRANCH}:{observed or ''}", remote, f"{commit}:{BRANCH}"
        )
        if pushed.returncode == 0:
            return "published"
        _log(f"RETRY attempt={attempt} push refused or lost: {pushed.stderr.decode(errors='replace').strip()}")
        pause(BACKOFF_SECONDS * attempt)
    raise Refused(f"the badges did not land in {attempts} attempts")


def _log(line: str) -> None:
    print(f"coverage-badges: {line}", flush=True)


def main(argv: list[str] | None = None, *, run: Git = git, pause: Callable[[float], None] = time.sleep) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--totals", type=Path, required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--repository", type=Path, required=True)
    args = parser.parse_args(argv)
    started = time.monotonic()
    _log(f"START source={args.source_sha} run={args.run_id} attempts={ATTEMPTS}")
    try:
        if not SHA.match(args.source_sha) or args.run_id <= 0:
            raise Refused("the source must be a full commit SHA and the run a positive ID")
        remote = os.environ.get("BADGE_REMOTE", "")
        if not remote:
            raise Refused("BADGE_REMOTE names no remote")
        go, frontend = read_totals(args.totals, args.source_sha, args.run_id)
        outcome = publish(
            args.repository, remote, args.source_sha, badge_files(go, frontend, args.source_sha, args.run_id),
            run=run, pause=pause,
        )
    except Refused as error:
        _log(f"REFUSE {error}")
        _log(f"SUMMARY decision=fail duration_ms={int((time.monotonic() - started) * 1000)}")
        return 1
    if outcome == "superseded":
        print("::notice::newer badges already stand; this run's numbers were not published", flush=True)
    _log(f"SUMMARY decision={outcome} duration_ms={int((time.monotonic() - started) * 1000)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
