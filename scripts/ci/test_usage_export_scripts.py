"""Behavioral tests for the usage-export workstation scripts (issue #142).

Two 2026-08-24 security-review findings live here, each pinned by a test
that FAILS against the original script:

* M4 — install-launchd.sh anchored the scheduled job to the installer's own
  directory, so an install performed from a disposable worktree broke
  silently at that worktree's routine cleanup. The suite runs the installer
  FROM a simulated worktree copy and requires the rendered
  ProgramArguments to anchor the primary checkout instead, requires the
  default anchor to BE the primary checkout, and requires an explicit
  worktree REPO_DIR to refuse outright.
* M5 — push-usage-series.sh trusted resolved client configuration for
  multiplexing and forwardings. The suite drives the COMPLETE push pipeline
  against stub binaries and asserts MEMBERSHIP of every hardening option in
  the argv the ssh stub actually received — shape ("some -o options were
  passed") is exactly the kind of check that missed the original gap.

The scripts are POSIX sh driven by /bin/sh, and every stub is hermetic: no
network, no launchd, no real ssh.
"""

from __future__ import annotations

import json
import os
import pathlib
import shutil
import stat
import subprocess
import tempfile
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "scripts" / "usage-export"
INSTALL = SCRIPTS / "install-launchd.sh"
PUSH = SCRIPTS / "push-usage-series.sh"
TEMPLATE = SCRIPTS / "com.naranjo-online.usage-export.plist.template"

# The complete client-hardening set the push transport must carry
# (2026-08-24 review finding M5). Reviewed as a SET: removing any one is a
# red test naming it.
REQUIRED_SSH_OPTIONS = (
    "BatchMode=yes",
    "IdentitiesOnly=yes",
    "IdentityAgent=none",
    "ControlPath=none",
    "ClearAllForwardings=yes",
    "ForwardAgent=no",
    "RequestTTY=no",
)


def run_script(script, args=(), env=None, cwd=None):
    merged = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": os.environ.get("HOME", "/tmp"),
    }
    if env:
        merged.update(env)
    return subprocess.run(
        ["/bin/sh", str(script), *args],
        capture_output=True,
        text=True,
        env=merged,
        cwd=cwd,
    )


def transcript_fixture(root: pathlib.Path) -> None:
    """One minimal valid transcript record for the export walk."""
    tree = root / "project"
    tree.mkdir(parents=True)
    record = {
        "type": "assistant",
        "timestamp": "2026-08-10T12:00:00Z",
        "requestId": "req_fixture",
        "message": {
            "id": "msg_fixture",
            "usage": {"input_tokens": 5, "output_tokens": 7},
        },
    }
    (tree / "session.jsonl").write_text(json.dumps(record) + "\n", encoding="utf-8")


def write_executable(path: pathlib.Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


class PushTransportHardeningTest(unittest.TestCase):
    """M5: the ssh invocation, observed rather than assumed."""

    def setUp(self):
        self.scratch = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.scratch, ignore_errors=True)
        transcripts = self.scratch / "transcripts"
        transcript_fixture(transcripts)

        stub_dir = self.scratch / "stubs"
        stub_dir.mkdir()
        self.args_file = self.scratch / "ssh-args"
        # The ssh stub records its argv one-per-line, drains stdin, and
        # answers with the real checksum of what it received — so the
        # script's own verification passes and the run exercises every
        # stage.
        write_executable(
            stub_dir / "ssh",
            "#!/bin/sh\n"
            'for arg in "$@"; do printf \'%s\\n\' "$arg"; done > "$SSH_ARGS_FILE"\n'
            "payload=$(mktemp)\n"
            'cat > "$payload"\n'
            "if command -v shasum >/dev/null 2>&1; then\n"
            '  sum=$(shasum -a 256 "$payload" | cut -d" " -f1)\n'
            "else\n"
            '  sum=$(sha256sum "$payload" | cut -d" " -f1)\n'
            "fi\n"
            'rm -f "$payload"\n'
            'printf \'%s received\\n\' "$sum"\n',
        )
        seal_stub = self.scratch / "usageseal"
        write_executable(seal_stub, "#!/bin/sh\ncat\n")

        key_file = self.scratch / "data.key"
        key_file.write_text("00" * 32 + "\n", encoding="utf-8")
        identity = self.scratch / "push_ed25519"
        identity.write_text("stub identity\n", encoding="utf-8")

        self.config = self.scratch / "config"
        self.config.write_text(
            "REPO_DIR=%s\n" % REPO_ROOT
            + "USAGESEAL_BIN=%s\n" % seal_stub
            + "KEY_FILE=%s\n" % key_file
            + "SSH_IDENTITY=%s\n" % identity
            + "PUSH_HOST=stub-push-host\n"
            + "SOURCE_LABEL=alpha\n"
            + "TRANSCRIPTS=%s\n" % transcripts,
            encoding="utf-8",
        )
        self.config.chmod(0o600)
        self.env = {
            "PATH": "%s:%s" % (stub_dir, os.environ.get("PATH", "/usr/bin:/bin")),
            "NARANJO_USAGE_EXPORT_CONFIG": str(self.config),
            "SSH_ARGS_FILE": str(self.args_file),
        }

    def test_the_push_carries_every_hardening_option(self):
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("checksum verified", result.stdout)
        argv = self.args_file.read_text(encoding="utf-8").splitlines()
        options = [
            argv[index + 1]
            for index, arg in enumerate(argv[:-1])
            if arg == "-o"
        ]
        for required in REQUIRED_SSH_OPTIONS:
            # MEMBERSHIP per option — the assertion the original gap needed.
            self.assertIn(required, options, "ssh ran without -o %s" % required)
        # The dedicated identity is pinned explicitly, and the transport
        # still addresses the forced command's host.
        self.assertIn("-i", argv)
        self.assertIn("stub-push-host", argv)
        self.assertIn("usage-export-receive", argv)

    def test_a_checksum_mismatch_refuses_the_push(self):
        lying_stub_dir = self.scratch / "lying"
        lying_stub_dir.mkdir()
        write_executable(
            lying_stub_dir / "ssh",
            "#!/bin/sh\ncat >/dev/null\necho 'deadbeef received'\n",
        )
        env = dict(self.env)
        env["PATH"] = "%s:%s" % (lying_stub_dir, os.environ.get("PATH", "/usr/bin:/bin"))
        result = run_script(PUSH, env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checksum mismatch", result.stderr)

    def test_a_lax_configuration_mode_is_refused(self):
        self.config.chmod(0o644)
        result = run_script(PUSH, env=self.env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("private", result.stderr)


class InstallAnchorTest(unittest.TestCase):
    """M4: the schedule anchors the primary checkout, never the installer."""

    def setUp(self):
        self.scratch = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.scratch, ignore_errors=True)
        self.home = self.scratch / "home"
        self.primary = self.home / "code" / "naranjo.online"
        target = self.primary / "scripts" / "usage-export"
        target.mkdir(parents=True)
        shutil.copy(TEMPLATE, target / TEMPLATE.name)
        write_executable(target / "push-usage-series.sh", "#!/bin/sh\nexit 0\n")
        shutil.copy(INSTALL, target / "install-launchd.sh")

    def env(self, **extra):
        merged = {"HOME": str(self.home)}
        merged.update(extra)
        return merged

    def test_the_default_anchor_is_the_primary_checkout(self):
        # Invoked from the REAL repository's copy of the installer — a
        # different directory than the anchor — the render must point at the
        # primary checkout's push script, proving the anchor comes from
        # REPO_DIR and not from the installer's own location.
        result = run_script(INSTALL, ["--render-only"], env=self.env())
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = self.primary / "scripts" / "usage-export" / "push-usage-series.sh"
        self.assertIn("<string>%s</string>" % expected, result.stdout)
        self.assertNotIn(str(SCRIPTS), result.stdout,
                         "the installer anchored its own directory again (review M4)")
        self.assertNotIn("__PUSH_SCRIPT__", result.stdout)
        self.assertNotIn("__LOG_DIR__", result.stdout)

    def test_an_installer_run_from_a_worktree_still_anchors_the_primary_checkout(self):
        # The exact reviewed hazard: the installer itself lives in a
        # disposable worktree. Its render must not mention that worktree.
        worktree = self.scratch / "repo" / ".claude" / "worktrees" / "lane-topic"
        worktree_scripts = worktree / "scripts" / "usage-export"
        worktree_scripts.mkdir(parents=True)
        shutil.copy(INSTALL, worktree_scripts / "install-launchd.sh")
        shutil.copy(TEMPLATE, worktree_scripts / TEMPLATE.name)
        write_executable(worktree_scripts / "push-usage-series.sh", "#!/bin/sh\nexit 0\n")
        result = run_script(
            worktree_scripts / "install-launchd.sh", ["--render-only"], env=self.env())
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = self.primary / "scripts" / "usage-export" / "push-usage-series.sh"
        self.assertIn("<string>%s</string>" % expected, result.stdout)
        self.assertNotIn(str(worktree), result.stdout,
                         "the render anchored the disposable worktree (review M4)")

    def test_a_worktree_repo_dir_is_refused_even_when_explicit(self):
        worktree = self.scratch / "repo" / ".claude" / "worktrees" / "lane-topic"
        (worktree / "scripts" / "usage-export").mkdir(parents=True)
        result = run_script(
            INSTALL, ["--render-only"],
            env=self.env(NARANJO_USAGE_EXPORT_REPO_DIR=str(worktree)))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("disposable worktree", result.stderr)

    def test_a_repo_dir_without_the_push_script_is_refused(self):
        empty = self.scratch / "empty-checkout"
        empty.mkdir()
        result = run_script(
            INSTALL, ["--render-only"],
            env=self.env(NARANJO_USAGE_EXPORT_REPO_DIR=str(empty)))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("REPO_DIR", result.stderr)

    def test_an_unknown_argument_is_refused(self):
        result = run_script(INSTALL, ["--frobnicate"], env=self.env())
        self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
