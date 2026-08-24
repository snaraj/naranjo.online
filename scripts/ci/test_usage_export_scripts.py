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

The 2026-08-24 round-3 review added one more, and it is the reason
`ProducerSandboxTest` exists:

* Round-3 finding 1 — the producer's no-spawn/no-network guarantee rested on
  an AST lint over import NAMES, which cannot carry it (`pathlib` re-exports
  `os`, so `pathlib.os.system(":")` restored the launch callable with the
  import set unchanged). The boundary is now the kernel sandbox the push
  script starts the producer inside. This suite pins the profile's text, pins
  that the push script actually invokes the producer through it, proves the
  push refuses outright when the sandbox is unavailable, and on a Darwin host
  EXECUTES the boundary — a spawn attempt and a connect attempt must fail
  inside it and succeed outside it, so the pin is behavior, not belief.

The scripts are POSIX sh driven by /bin/sh, and every stub is hermetic: no
network, no launchd, no real ssh, no real sandbox except in the one Darwin
test that is explicitly about the real sandbox.
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import shutil
import stat
import subprocess
import tempfile
import unittest

import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "scripts" / "usage-export"
INSTALL = SCRIPTS / "install-launchd.sh"
PUSH = SCRIPTS / "push-usage-series.sh"
TEMPLATE = SCRIPTS / "com.naranjo-online.usage-export.plist.template"
PROFILE = SCRIPTS / "producer.sb"

# The capability denials the producer sandbox exists for. Reviewed as a SET:
# removing either is a red test naming it (2026-08-24 round-3 finding 1).
REQUIRED_SANDBOX_DENIALS = ("(deny process-fork)", "(deny network*)")

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
        # The producer sandbox, stubbed so the pipeline runs hermetically on
        # any host: it records the invocation it was handed and then runs the
        # wrapped command. What it proves is that the push script routes the
        # producer THROUGH the sandbox with the shipped profile; the real
        # boundary's behavior is proven separately, on Darwin, in
        # ProducerSandboxTest.
        self.sandbox_args_file = self.scratch / "sandbox-args"
        write_executable(
            stub_dir / "sandbox-exec",
            "#!/bin/sh\n"
            'for arg in "$@"; do printf \'%s\\n\' "$arg"; done > "$SANDBOX_ARGS_FILE"\n'
            '[ "$1" = "-f" ] || exit 64\n'
            "shift 2\n"
            'exec "$@"\n',
        )
        self.stub_dir = stub_dir

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
            "SANDBOX_ARGS_FILE": str(self.sandbox_args_file),
        }

    def test_the_producer_runs_inside_the_shipped_sandbox_profile(self):
        # Round-3 finding 1: the boundary is at the INVOCATION layer, so what
        # has to be proven is the invocation. The producer must be reached
        # only through sandbox-exec, carrying the profile that ships in this
        # repository — not a profile assembled at run time, and not a bare
        # interpreter.
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        argv = self.sandbox_args_file.read_text(encoding="utf-8").splitlines()
        self.assertEqual(argv[0], "-f")
        self.assertEqual(pathlib.Path(argv[1]).resolve(), PROFILE.resolve())
        self.assertIn("export_usage_series.py", "\n".join(argv))
        # The isolated-interpreter flags survive the wrapping rather than
        # being traded for it.
        self.assertIn("-I", argv)
        self.assertIn("-B", argv)

    def test_a_host_without_the_sandbox_never_walks_raw_records(self):
        # Fail-closed, proven by absence of work rather than by a message: on
        # a PATH that resolves everything the pipeline needs EXCEPT the
        # sandbox, the push refuses before the producer runs — no sealed
        # payload, no ssh.
        #
        # The PATH is curated rather than trimmed because the host running
        # this suite may itself be a Darwin machine, where the real
        # sandbox-exec sits in the same system directory as `mktemp` and
        # `wc`. Every tool is resolved explicitly, so a missing one fails the
        # test loudly instead of passing it for the wrong reason.
        bare_dir = self.scratch / "no-sandbox"
        bare_dir.mkdir()
        for tool in ("stat", "mktemp", "rm", "wc", "tr", "head", "cut", "env",
                     "python3", "shasum", "sha256sum"):
            resolved = shutil.which(tool)
            if resolved is not None:
                (bare_dir / tool).symlink_to(resolved)
        for required in ("stat", "mktemp", "wc", "env", "python3"):
            self.assertTrue((bare_dir / required).exists(),
                            "the curated PATH is missing %s" % required)
        self.assertIsNone(
            shutil.which("sandbox-exec", path=str(bare_dir)),
            "the curated PATH still resolves a sandbox",
        )
        shutil.copy(self.stub_dir / "ssh", bare_dir / "ssh")
        (bare_dir / "ssh").chmod(0o755)

        env = dict(self.env)
        env["PATH"] = str(bare_dir)
        self.args_file.unlink(missing_ok=True)
        result = run_script(PUSH, env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("sandbox is unavailable", result.stderr)
        self.assertIn("never walked unconfined", result.stderr)
        self.assertFalse(
            self.args_file.exists(),
            "the push reached the transport without the producer sandbox",
        )

    def test_the_push_script_has_no_unconfined_producer_invocation(self):
        # Structural companion to the behavioral tests above: there is exactly
        # ONE place the export script is started, and it is the sandboxed one.
        # A second, unwrapped invocation would satisfy every test that only
        # observes the happy path.
        source = PUSH.read_text(encoding="utf-8")
        invocations = [
            line.strip()
            for line in source.splitlines()
            if "$EXPORT_SCRIPT" in line and not line.lstrip().startswith("#")
        ]
        # The guard that the file exists, and the sandboxed run.
        self.assertEqual(len(invocations), 2, invocations)
        self.assertTrue(any(line.startswith("[ -f ") for line in invocations))
        run_line = [line for line in invocations if not line.startswith("[ -f ")][0]
        self.assertIn("python3", run_line)
        sandbox_lines = [
            line for line in source.splitlines()
            if line.strip().startswith("sandbox-exec ")
        ]
        self.assertEqual(len(sandbox_lines), 1, sandbox_lines)
        self.assertIn('-f "$PRODUCER_PROFILE"', sandbox_lines[0])

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

    def test_an_over_ceiling_payload_never_opens_the_connection(self):
        # Finding 4 (2026-08-24 security review): the push checked only that
        # the sealed payload was non-empty, so an over-ceiling payload
        # reached the host, where the forced command TRUNCATED it and
        # installed the truncated bytes over the last good file before
        # anything noticed. The transport stage now refuses first, and the
        # proof is that the ssh stub is never invoked at all.
        cap = int(
            re.search(
                r"^MAX_SEALED_BYTES=(\d+)$",
                PUSH.read_text(encoding="utf-8"),
                re.MULTILINE,
            ).group(1)
        )
        # A sealer stub that emits one byte past the ceiling, whatever it is
        # handed: the bound under test is the transport's, not the sealer's.
        write_executable(
            self.scratch / "usageseal",
            "#!/bin/sh\ncat >/dev/null\nhead -c %d /dev/zero\n" % (cap + 1),
        )
        self.args_file.unlink(missing_ok=True)
        result = run_script(PUSH, env=self.env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("over the %d byte bound" % cap, result.stderr)
        self.assertIn("nothing was pushed", result.stderr)
        self.assertFalse(
            self.args_file.exists(),
            "ssh was invoked for a payload the pipeline had already refused",
        )

    def test_a_payload_exactly_at_the_ceiling_is_pushed(self):
        # Non-vacuity for the bound above: the boundary itself is admitted,
        # so the refusal is an edge rather than a blanket denial.
        cap = int(
            re.search(
                r"^MAX_SEALED_BYTES=(\d+)$",
                PUSH.read_text(encoding="utf-8"),
                re.MULTILINE,
            ).group(1)
        )
        write_executable(
            self.scratch / "usageseal",
            "#!/bin/sh\ncat >/dev/null\nhead -c %d /dev/zero\n" % cap,
        )
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("pushed %d sealed bytes" % cap, result.stdout)


class ProducerSandboxTest(unittest.TestCase):
    """Round-3 finding 1: the capability boundary, pinned and then executed."""

    def setUp(self):
        self.profile = PROFILE.read_text(encoding="utf-8")

    def test_the_profile_denies_exactly_the_two_claimed_capabilities(self):
        lines = [
            line.strip()
            for line in self.profile.splitlines()
            if line.strip() and not line.strip().startswith(";;")
        ]
        self.assertEqual(lines[0], "(version 1)")
        for denial in REQUIRED_SANDBOX_DENIALS:
            self.assertIn(denial, lines, "the profile no longer carries %s" % denial)
        # Nothing may grant back what the two denials take. Seatbelt takes the
        # LAST matching rule, so a later allow would silently reopen the hole
        # the whole boundary exists to close.
        for index, line in enumerate(lines):
            if line in REQUIRED_SANDBOX_DENIALS:
                continue
            self.assertNotIn("process-fork", line, "line %d re-grants fork" % index)
            self.assertNotIn("network", line, "line %d re-grants network" % index)

    def test_the_profile_states_its_own_residual(self):
        # The honest half of the claim. `(allow default)` and the unavoidable
        # exec allowance are both deliberate, and the file has to say so —
        # this is the assertion that keeps the round-3 downgrade from being
        # quietly re-inflated into "structurally incapable of everything".
        self.assertIn("(allow default)", self.profile)
        self.assertIn("exec(2) IN PLACE", self.profile)
        self.assertIn("inherited across exec", self.profile)

    @unittest.skipUnless(sys.platform == "darwin", "the sandbox is a Darwin facility")
    @unittest.skipUnless(shutil.which("sandbox-exec"), "sandbox-exec is unavailable")
    def test_the_boundary_actually_refuses_a_spawn_and_a_connect(self):
        # The probe is the review's own surviving mutant, reduced to its
        # essence: reach the launch callable through an ALLOWED import, and
        # reach the network through the standard library. Both must fail
        # inside the boundary.
        probe = (
            "import pathlib, socket\n"
            "marker = pathlib.Path(__import__('sys').argv[1])\n"
            "rc = pathlib.os.system('/usr/bin/touch ' + str(marker))\n"
            "print('spawned' if marker.exists() else 'no-spawn')\n"
            "try:\n"
            "    socket.create_connection(('127.0.0.1', 9), timeout=1).close()\n"
            "    print('connected')\n"
            "except PermissionError:\n"
            "    print('no-network')\n"
            "except OSError:\n"
            "    print('network-attempted')\n"
        )
        scratch = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, scratch, ignore_errors=True)

        confined = subprocess.run(
            [
                "sandbox-exec", "-f", str(PROFILE),
                sys.executable, "-I", "-B", "-c", probe, str(scratch / "confined"),
            ],
            capture_output=True, text=True,
        )
        self.assertEqual(confined.returncode, 0, confined.stderr)
        self.assertIn("no-spawn", confined.stdout)
        self.assertIn("no-network", confined.stdout)
        self.assertFalse((scratch / "confined").exists())

        # Non-vacuity: the identical probe OUTSIDE the boundary spawns. An
        # assertion no input can fail is decorative, and this is the input.
        free = subprocess.run(
            [sys.executable, "-I", "-B", "-c", probe, str(scratch / "free")],
            capture_output=True, text=True,
        )
        self.assertEqual(free.returncode, 0, free.stderr)
        self.assertIn("spawned", free.stdout)
        self.assertTrue((scratch / "free").exists())
        self.assertNotIn("no-network", free.stdout)


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
