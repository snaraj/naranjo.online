"""Behaviour of `coverage_badges.py` against real git: a local bare remote holds
`main` and `badges`, and every publication goes through ls-remote, fetch and a
leased push exactly as it does on a runner.

Every hostile case either leaves the published badges byte-for-byte as they
were, or refuses before any git command runs. The release side of issue #350
-- that no badge outcome can reach a release verdict -- is pinned in
`test_release_contract.py`, where the job inventory lives.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import coverage_badges as badges

IDENTITY = {
    "GIT_AUTHOR_NAME": "Badge Test",
    "GIT_AUTHOR_EMAIL": "badge@example.invalid",
    "GIT_COMMITTER_NAME": "Badge Test",
    "GIT_COMMITTER_EMAIL": "badge@example.invalid",
}


def sh(root: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True, text=True).stdout.strip()


class Recorder:
    """The real git, every invocation recorded, with an optional push stand-in."""

    def __init__(self, on_push=None) -> None:
        self.calls: list[tuple[str, ...]] = []
        self.on_push = on_push

    def __call__(self, repository: Path, *args: str, **kwargs) -> subprocess.CompletedProcess:
        self.calls.append(args)
        if args[0] == "push" and self.on_push is not None:
            return self.on_push(repository, args, kwargs)
        return badges.git(repository, *args, **kwargs)

    def pushes(self) -> int:
        return sum(1 for call in self.calls if call[0] == "push")


def refused(stderr: bytes = b"connection reset") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(["git", "push"], 1, b"", stderr)


class PublisherTests(unittest.TestCase):
    def setUp(self) -> None:
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        root = Path(scratch.name)
        empty_config = root / "gitconfig"
        empty_config.write_text("")
        environment = mock.patch.dict(
            os.environ, {**IDENTITY, "GIT_CONFIG_GLOBAL": str(empty_config), "GIT_CONFIG_NOSYSTEM": "1"}
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.remote = root / "remote.git"
        sh(root, "init", "-q", "--bare", str(self.remote))
        author = root / "author"
        sh(root, "init", "-q", "-b", "main", str(author))
        self.main = []
        for index in range(3):
            sh(author, "commit", "-q", "--allow-empty", "-m", f"main {index}")
            self.main.append(sh(author, "rev-parse", "HEAD"))
        sh(author, "checkout", "-q", "-b", "side", self.main[0])
        sh(author, "commit", "-q", "--allow-empty", "-m", "side")
        self.side = sh(author, "rev-parse", "HEAD")
        sh(author, "push", "-q", str(self.remote), "main", "side")
        # The runner's checkout: full history of the measured commit.
        self.checkout = root / "checkout"
        sh(root, "clone", "-q", str(self.remote), str(self.checkout))
        self.scratch = root
        self.pauses: list[float] = []

    def totals(self, sha: str, run_id: int = 7, **overrides: object) -> Path:
        record = {"schema": "coverage-totals/v1", "sourceSha": sha, "runId": run_id, "go": "96.3", "frontend": "100"}
        record.update(overrides)
        path = self.scratch / f"totals-{len(list(self.scratch.glob('totals-*')))}.json"
        path.write_text(json.dumps(record))
        return path

    def publish(self, sha: str, *, run_id: int = 7, totals: Path | None = None, run=None) -> tuple[int, str]:
        output = io.StringIO()
        argv = [
            "--totals", str(totals or self.totals(sha, run_id)),
            "--source-sha", sha, "--run-id", str(run_id), "--repository", str(self.checkout),
        ]
        with mock.patch.dict(os.environ, {"BADGE_REMOTE": str(self.remote)}), redirect_stdout(output):
            code = badges.main(argv, run=run or badges.git, pause=self.pauses.append)
        return code, output.getvalue()

    def head(self) -> str | None:
        listed = sh(self.remote, "ls-remote", str(self.remote), badges.BRANCH)
        return listed.split()[0] if listed else None

    def published(self, name: str) -> str:
        return sh(self.remote, "show", f"badges:{name}") + "\n"

    def recorded(self) -> str:
        return sh(self.remote, "log", "-1", "--format=%s", "badges")

    def test_the_first_publication_creates_one_commit_with_its_provenance(self) -> None:
        code, output = self.publish(self.main[1])
        self.assertEqual(code, 0, output)
        self.assertIn("SUMMARY decision=published", output)
        self.assertEqual(self.recorded(), f"coverage badges for {self.main[1]}")
        self.assertEqual(sh(self.remote, "rev-list", "--count", "badges"), "1")
        self.assertEqual(sh(self.remote, "ls-tree", "--name-only", "badges").split(),
                         ["frontend-coverage.json", "go-coverage.json", "source.json"])
        self.assertEqual(self.published("go-coverage.json"),
                         '{"schemaVersion":1,"label":"go coverage","message":"96.3%","color":"brightgreen"}\n')
        self.assertEqual(self.published("frontend-coverage.json"),
                         '{"schemaVersion":1,"label":"frontend coverage","message":"100%","color":"brightgreen"}\n')
        self.assertEqual(json.loads(self.published("source.json")),
                         {"sourceSha": self.main[1], "runId": 7, "go": "96.3", "frontend": "100"})

    def test_a_newer_or_the_same_commit_replaces_the_badges(self) -> None:
        self.assertEqual(self.publish(self.main[0])[0], 0)
        self.assertEqual(self.publish(self.main[2], run_id=9)[0], 0)
        self.assertEqual(self.recorded(), f"coverage badges for {self.main[2]}")
        # A re-run of the same commit is descendant-or-equal, so it publishes.
        rerun = self.totals(self.main[2], 10, go="95.0")
        self.assertEqual(self.publish(self.main[2], run_id=10, totals=rerun)[0], 0)
        self.assertIn('"message":"95.0%"', self.published("go-coverage.json"))

    def test_an_older_run_finishing_last_leaves_the_newer_badges_standing(self) -> None:
        self.assertEqual(self.publish(self.main[2])[0], 0)
        newer = self.head()
        code, output = self.publish(self.main[1], run_id=6)
        self.assertEqual(code, 0, output)
        self.assertIn("decision=superseded", output)
        self.assertIn("::notice::newer badges already stand", output)
        self.assertEqual(self.head(), newer)

    def test_a_race_lost_to_a_newer_publisher_is_decided_again_and_publishes_nothing(self) -> None:
        self.assertEqual(self.publish(self.main[0])[0], 0)
        racer_done = []

        def newer_lands_first(repository: Path, args: tuple[str, ...], kwargs: dict) -> subprocess.CompletedProcess:
            if not racer_done:
                racer_done.append(True)
                self.assertEqual(self.publish(self.main[2], run_id=9)[0], 0)
            return badges.git(repository, *args, **kwargs)

        newer_run = Recorder(newer_lands_first)
        code, output = self.publish(self.main[1], run_id=8, run=newer_run)
        self.assertEqual(code, 0, output)
        self.assertIn("decision=superseded", output)
        self.assertEqual(self.recorded(), f"coverage badges for {self.main[2]}")
        self.assertEqual(newer_run.pushes(), 1, "the leased push was refused once, then the run stood down")

    def test_a_push_whose_answer_was_lost_is_recognised_as_published(self) -> None:
        def lands_but_answers_failure(repository: Path, args: tuple[str, ...], kwargs: dict) -> subprocess.CompletedProcess:
            badges.git(repository, *args, **kwargs)
            return refused()

        lost = Recorder(lands_but_answers_failure)
        code, output = self.publish(self.main[1], run=lost)
        self.assertEqual(code, 0, output)
        self.assertEqual(lost.pushes(), 1)
        self.assertEqual(self.recorded(), f"coverage badges for {self.main[1]}")

    def test_a_refused_push_is_retried_and_lands(self) -> None:
        first = []

        def refuse_once(repository: Path, args: tuple[str, ...], kwargs: dict) -> subprocess.CompletedProcess:
            if not first:
                first.append(True)
                return refused()
            return badges.git(repository, *args, **kwargs)

        flaky = Recorder(refuse_once)
        code, output = self.publish(self.main[1], run=flaky)
        self.assertEqual(code, 0, output)
        self.assertEqual(flaky.pushes(), 2)
        self.assertEqual(self.pauses, [badges.BACKOFF_SECONDS])

    def test_a_push_that_never_lands_fails_visibly_and_changes_nothing(self) -> None:
        self.assertEqual(self.publish(self.main[0])[0], 0)
        before = self.head()
        down = Recorder(lambda *_: refused())
        code, output = self.publish(self.main[2], run_id=9, run=down)
        self.assertEqual(code, 1, output)
        self.assertIn(f"did not land in {badges.ATTEMPTS} attempts", output)
        self.assertEqual(down.pushes(), badges.ATTEMPTS)
        self.assertEqual(len(self.pauses), badges.ATTEMPTS)
        self.assertEqual(self.head(), before)

    def test_an_unreachable_remote_is_retried_then_fails(self) -> None:
        output = io.StringIO()
        argv = ["--totals", str(self.totals(self.main[1])), "--source-sha", self.main[1], "--run-id", "7",
                "--repository", str(self.checkout)]
        with mock.patch.dict(os.environ, {"BADGE_REMOTE": str(self.scratch / "missing.git")}), redirect_stdout(output):
            self.assertEqual(badges.main(argv, pause=self.pauses.append), 1)
        self.assertEqual(len(self.pauses), badges.ATTEMPTS)
        self.assertIn("RETRY attempt=1 ls-remote failed", output.getvalue())

    def test_wrong_source_or_malformed_totals_are_refused_before_any_git_command(self) -> None:
        sha = self.main[1]
        cases = {
            "another commit": self.totals(sha, sourceSha=self.main[2]),
            "another run": self.totals(sha, runId=8),
            "boolean run": self.totals(sha, runId=True),
            "text run": self.totals(sha, runId="7"),
            "schema": self.totals(sha, schema="coverage-totals/v2"),
            "go above 100": self.totals(sha, go="101"),
            "go NaN": self.totals(sha, go="NaN"),
            "go empty": self.totals(sha, go=""),
            "go with a line": self.totals(sha, go="96.3\nextra=1"),
            "go as a number": self.totals(sha, go=96.3),
            "frontend negative": self.totals(sha, frontend="-1"),
        }
        extra = json.loads(self.totals(sha).read_text())
        extra["note"] = "x"
        cases["extra key"] = self.scratch / "extra.json"
        cases["extra key"].write_text(json.dumps(extra))
        cases["missing key"] = self.scratch / "missing.json"
        cases["missing key"].write_text(json.dumps({key: value for key, value in extra.items() if key not in {"note", "frontend"}}))
        cases["not JSON"] = self.scratch / "broken.json"
        cases["not JSON"].write_text("{")
        cases["absent"] = self.scratch / "absent.json"
        for name, path in cases.items():
            with self.subTest(case=name):
                recorder = Recorder()
                code, output = self.publish(sha, totals=path, run=recorder)
                self.assertEqual(code, 1, output)
                self.assertIn("REFUSE", output)
                self.assertEqual(recorder.calls, [])
        # JSON true equals 1 in Python, so run 1 is where a boolean would pass.
        recorder = Recorder()
        code, output = self.publish(sha, run_id=1, totals=self.totals(sha, 1, runId=True), run=recorder)
        self.assertEqual(code, 1, output)
        self.assertIn("belong to another gate run", output)
        self.assertEqual(recorder.calls, [])
        self.assertIsNone(self.head())

    def test_a_nonpositive_run_is_refused_even_when_the_totals_agree(self) -> None:
        # The totals only have to agree with the argument, so the run ID's own
        # bound is all that keeps an agreed run 0 or -1 from publishing.
        self.assertEqual(self.publish(self.main[0])[0], 0)
        before = self.head()
        for run_id in (0, -1):
            with self.subTest(run_id=run_id):
                recorder = Recorder()
                code, output = self.publish(self.main[1], run_id=run_id, run=recorder)
                self.assertEqual(code, 1, output)
                self.assertIn("the run a positive ID", output)
                self.assertEqual(recorder.calls, [])
                self.assertEqual(self.head(), before)
        self.assertEqual(self.publish(self.main[1], run_id=1)[0], 0)
        self.assertEqual(self.recorded(), f"coverage badges for {self.main[1]}")

    def test_a_badge_head_that_cannot_be_placed_is_refused_and_kept(self) -> None:
        def foreign_head(subject: str) -> str:
            tree = sh(self.checkout, "mktree")  # empty tree from empty stdin
            commit = sh(self.checkout, "commit-tree", tree, "-m", subject)
            sh(self.checkout, "push", "-q", "-f", str(self.remote), f"{commit}:{badges.BRANCH}")
            return commit

        for subject, fragment in (
            ("hand-edited badges", "does not say which commit it measured"),
            (f"coverage badges for {'b' * 40}", "cannot be placed"),
            (f"coverage badges for {self.side}", "which is not on"),
        ):
            with self.subTest(subject=subject):
                kept = foreign_head(subject)
                code, output = self.publish(self.main[1])
                self.assertEqual(code, 1, output)
                self.assertIn(fragment, output)
                self.assertEqual(self.head(), kept)

    def test_a_commit_that_is_not_on_main_is_refused(self) -> None:
        code, output = self.publish(self.side)
        self.assertEqual(code, 1, output)
        self.assertIn("is not on main", output)
        self.assertIsNone(self.head())

    def test_the_source_and_remote_must_be_stated(self) -> None:
        recorder = Recorder()
        code, output = self.publish("abc", run=recorder)
        self.assertEqual(code, 1, output)
        self.assertEqual(recorder.calls, [])
        output = io.StringIO()
        argv = ["--totals", str(self.totals(self.main[1])), "--source-sha", self.main[1], "--run-id", "7",
                "--repository", str(self.checkout)]
        with mock.patch.dict(os.environ, {"BADGE_REMOTE": ""}), redirect_stdout(output):
            self.assertEqual(badges.main(argv, run=recorder), 1)
        self.assertIn("BADGE_REMOTE names no remote", output.getvalue())
        self.assertEqual(recorder.calls, [])


class ColorTests(unittest.TestCase):
    def test_the_badge_colours_keep_their_thresholds(self) -> None:
        for percent, expected in (("100", "brightgreen"), ("90", "brightgreen"), ("89.9", "green"), ("75", "green"),
                                  ("74.9", "yellow"), ("60", "yellow"), ("59.9", "orange"), ("0", "orange")):
            with self.subTest(percent=percent):
                self.assertEqual(badges.color(percent), expected)


if __name__ == "__main__":
    unittest.main()
