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

Issue #358 (a page serving release data for days beside a log of verified
pushes) added the classes at the end: the served check, log rotation, the
checkout's fast-forward-only update against throwaway repositories, and the
installer's read-only --check.

The scripts are POSIX sh driven by /bin/sh, and every stub is hermetic: no
network beyond a refused loopback port, no launchd, no real ssh, no real
sandbox except in the one Darwin test that is explicitly about the real
sandbox.
"""

from __future__ import annotations

import contextlib
import datetime
import importlib.util
import io
import json
import os
import pathlib
import re
import shutil
import signal
import stat
import subprocess
import tempfile
import time
import unittest
import urllib.error
from unittest import mock

import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "scripts" / "usage-export"
INSTALL = SCRIPTS / "install-launchd.sh"
PUSH = SCRIPTS / "push-usage-series.sh"
TEMPLATE = SCRIPTS / "com.naranjo-online.usage-export.plist.template"
PROFILE = SCRIPTS / "producer.sb"
SNAPSHOT_TEMPLATE = SCRIPTS / "com.naranjo-online.ledger-snapshot.plist.template"
SNAPSHOT = REPO_ROOT / "scripts" / "ledger_snapshot.py"


def required_match(pattern, text, message, flags=0):
    """One `re.search` that MUST match, or an AssertionError naming the miss.

    The ceiling reads below pull a literal out of the push script, and a read
    is evidence only if it found something. `re.search` returns None on a miss
    and `.group` on None raises AttributeError — a crash naming neither the
    pattern nor the file, which reads as a broken test rather than as the
    missing constant it actually is.
    """
    found = re.search(pattern, text, flags)
    if found is None:
        raise AssertionError(message)
    return found

# The capability denials the producer sandbox exists for. Reviewed as a SET:
# removing either is a red test naming it (2026-08-24 round-3 finding 1).
REQUIRED_SANDBOX_DENIALS = ("(deny process-fork)", "(deny network*)")

# The complete client-hardening set the push transport must carry
# (2026-08-24 review finding M5, extended by round-3 finding 8). Reviewed as
# a SET: removing any one is a red test naming it.
#
# Round-3 finding 8 is why the list grew and why -F /dev/null leads it. The
# old invocation hardened the options someone had thought to name while
# INHERITING everything else from whatever ~/.ssh/config resolved for the
# destination alias — an inherited ProxyCommand, an inherited LocalCommand,
# an extra IdentityFile, or a Match block added later all applied silently,
# and each of them changes who authenticates or what runs locally. -F
# /dev/null makes the resolution start from nothing (OpenSSH documents that
# giving -F also causes the system-wide file to be ignored), which is what
# makes naming every option meaningful.
REQUIRED_SSH_OPTIONS = (
    "BatchMode=yes",
    "ConnectTimeout=15",
    "ConnectionAttempts=1",
    "ServerAliveInterval=15",
    "ServerAliveCountMax=2",
    "IdentitiesOnly=yes",
    "IdentityAgent=none",
    "AddKeysToAgent=no",
    "ControlMaster=no",
    "ControlPath=none",
    "ControlPersist=no",
    "ProxyCommand=none",
    "ProxyJump=none",
    "PermitLocalCommand=no",
    "ClearAllForwardings=yes",
    "ForwardAgent=no",
    "ForwardX11=no",
    "ForwardX11Trusted=no",
    "ExitOnForwardFailure=yes",
    "RequestTTY=no",
    "StrictHostKeyChecking=yes",
    "GlobalKnownHostsFile=/dev/null",
    "PubkeyAuthentication=yes",
    "PasswordAuthentication=no",
    "KbdInteractiveAuthentication=no",
    "GSSAPIAuthentication=no",
    "NumberOfPasswordPrompts=0",
    # Issue #358: the receiving host's pre-auth banner is printed at INFO and
    # above, and it filled the scheduler's error log on every run.
    "LogLevel=ERROR",
)

# The remnants the runtime self-check refuses. Each is a way for a
# configuration file to have reached the session after all, and the first
# three run CODE on the workstation at connect time.
FORBIDDEN_RESOLVED_KEYS = ("proxycommand", "proxyjump", "localcommand", "controlpath")


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
        # No inherited stdin, ever: a stub that reads it would otherwise
        # block the whole suite on the test runner's own terminal.
        stdin=subprocess.DEVNULL,
    )


# The fixture record's calendar day, named once so a test that needs a day
# BEFORE it derives that day instead of restating a literal that can drift.
TRANSCRIPT_FIXTURE_DAY = "2026-08-10"


def transcript_fixture(root: pathlib.Path) -> None:
    """One minimal valid transcript record for the export walk."""
    tree = root / "project"
    tree.mkdir(parents=True)
    record = {
        "type": "assistant",
        "timestamp": TRANSCRIPT_FIXTURE_DAY + "T12:00:00Z",
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


# The honest response tail: the real checksum of the bytes received, which is
# what the push script verifies.
HONEST_RESPONSE = """\
payload=$(mktemp)
cat > "$payload"
if command -v shasum >/dev/null 2>&1; then
  sum=$(shasum -a 256 "$payload" | cut -d" " -f1)
else
  sum=$(sha256sum "$payload" | cut -d" " -f1)
fi
rm -f "$payload"
printf '%s received\n' "$sum"
"""

LYING_RESPONSE = """\
cat >/dev/null
printf 'deadbeef received\n'
"""


def ssh_stub(response: str) -> str:
    """A POSIX-sh ssh stand-in that models `ssh -G` faithfully enough to test
    the push script's resolved-configuration check.

    On -G it derives the resolution from the -o and -i arguments it was
    handed, reproducing the three normalizations real ssh performs on keys
    this script compares (yes and no become true and false) and, like real
    ssh, printing no line at all for a proxy/local/control option whose value
    is `none` or empty.

    Two environment hooks let a test stage a hostile resolution:
      SSH_G_OVERRIDE  lines emitted BEFORE the derived ones. ssh uses the
                      FIRST value obtained for a parameter, so this is how a
                      relaxed value is staged.
      SSH_G_EXTRA     lines emitted after, for the cases where an ADDITIONAL
                      value is the hazard — a second identity, a proxy
                      command that should not exist at all.
      SSH_G_NO_IDENTITY  suppress the identity derived from -i, so a test can
                      stage a resolution that offers exactly ONE identity and
                      it is the wrong one.
    """
    return """#!/bin/sh
for arg in "$@"; do printf '%s\n' "$arg"; done > "$SSH_ARGS_FILE"
resolve=no
for arg in "$@"; do [ "$arg" = "-G" ] && resolve=yes; done
if [ "$resolve" = yes ]; then
  cp "$SSH_ARGS_FILE" "$SSH_G_ARGS_FILE"
  [ -n "${SSH_G_OVERRIDE:-}" ] && printf '%s\n' "$SSH_G_OVERRIDE"
  prev=""
  for arg in "$@"; do
    case "$prev" in
      -o)
        key=$(printf '%s' "${arg%%=*}" | tr 'A-Z' 'a-z')
        value=${arg#*=}
        case "$key" in
          proxycommand|proxyjump|localcommand|controlpath)
            [ -z "$value" ] || [ "$value" = none ] || printf '%s %s\n' "$key" "$value" ;;
          stricthostkeychecking)
            [ "$value" = yes ] && value=true
            printf '%s %s\n' "$key" "$value" ;;
          controlmaster|requesttty)
            [ "$value" = no ] && value=false
            printf '%s %s\n' "$key" "$value" ;;
          *) printf '%s %s\n' "$key" "$value" ;;
        esac ;;
      -i) [ -n "${SSH_G_NO_IDENTITY:-}" ] || printf 'identityfile %s\n' "$arg" ;;
    esac
    prev=$arg
  done
  [ -n "${SSH_G_EXTRA:-}" ] && printf '%s\n' "$SSH_G_EXTRA"
  exit 0
fi
""" + response


class PushFixture:
    """The hermetic pipeline every push test drives: stub ssh, sandbox and
    sealer on PATH, one transcript fixture, one private configuration."""

    def setUp(self):
        self.scratch = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.scratch, ignore_errors=True)
        transcripts = self.scratch / "transcripts"
        transcript_fixture(transcripts)

        stub_dir = self.scratch / "stubs"
        stub_dir.mkdir()
        self.args_file = self.scratch / "ssh-args"
        self.g_args_file = self.scratch / "ssh-g-args"
        # The ssh stub records its argv one-per-line, drains stdin, and
        # answers with the real checksum of what it received — so the
        # script's own verification passes and the run exercises every
        # stage. `ssh -G` is MODELLED rather than shelled out to, so a test
        # can hand the script a hostile resolution and prove it refuses; the
        # real resolver is exercised against the actual ssh binary in
        # SshResolvedConfigurationTest below.
        write_executable(stub_dir / "ssh", ssh_stub(HONEST_RESPONSE))
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
        self.identity = self.scratch / "push_ed25519"
        self.identity.write_text("stub identity\n", encoding="utf-8")
        self.known_hosts = self.scratch / "known_hosts"
        self.known_hosts.write_text("# pinned host key\n", encoding="utf-8")

        self.config = self.scratch / "config"
        self.config_lines = {
            "REPO_DIR": str(REPO_ROOT),
            "USAGESEAL_BIN": str(seal_stub),
            "KEY_FILE": str(key_file),
            "SSH_IDENTITY": str(self.identity),
            "SSH_KNOWN_HOSTS": str(self.known_hosts),
            "PUSH_HOST": "pusher@stub-push-host",
            "SOURCE_LABEL": "alpha",
            "TRANSCRIPTS": str(transcripts),
            # REPO_DIR is the checkout running this suite: it is never fetched
            # or fast-forwarded by a test. RepoUpdateTest drives the update
            # against throwaway repositories instead.
            "REPO_UPDATE": "off",
        }
        self.write_config()
        self.env = {
            "PATH": "%s:%s" % (stub_dir, os.environ.get("PATH", "/usr/bin:/bin")),
            "NARANJO_USAGE_EXPORT_CONFIG": str(self.config),
            "SSH_ARGS_FILE": str(self.args_file),
            "SSH_G_ARGS_FILE": str(self.g_args_file),
            "SANDBOX_ARGS_FILE": str(self.sandbox_args_file),
        }

    def write_config(self, **overrides):
        values = dict(self.config_lines)
        values.update(overrides)
        self.config.write_text(
            "".join("%s=%s\n" % pair for pair in values.items()), encoding="utf-8")
        self.config.chmod(0o600)


class PushTransportHardeningTest(PushFixture, unittest.TestCase):
    """M5: the ssh invocation, observed rather than assumed."""

    def test_push_response_budget_is_enforced_by_the_real_pipeline(self):
        # A matching first checksum used to hide arbitrary trailing output.
        # This also kills removing the runner from push_ssh: isolated runner
        # tests alone could stay green while the actual pipeline bypassed it.
        write_executable(self.stub_dir / "ssh", ssh_stub(
            HONEST_RESPONSE + "python3 -c \"print('x' * 40000)\"\n"))
        result = run_script(PUSH, env=self.env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("reason=response-over-budget", result.stderr)
        self.assertNotIn("SUMMARY", result.stdout)

    def test_failed_push_keeps_private_transport_diagnostics_out_of_scheduler_log(self):
        write_executable(self.stub_dir / "ssh", ssh_stub(
            "cat >/dev/null\n"
            "printf 'PRIVATE-DESTINATION-SENTINEL: Connection reset\\n' >&2\n"
            "exit 255\n"))
        result = run_script(PUSH, env=self.env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("reason=connection-lost", result.stderr)
        self.assertIn("FAILED stage=push", result.stderr)
        self.assertNotIn("PRIVATE-DESTINATION-SENTINEL", result.stdout + result.stderr)

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
        # The committed baselines table reaches the export on every run
        # (issue #276): the argument is pinned, not merely the file, because
        # a table the producer never receives is a lifetime tile that
        # silently stops tracking.
        self.assertIn("--lifetime-baselines", argv)
        self.assertEqual(
            pathlib.Path(argv[argv.index("--lifetime-baselines") + 1]).resolve(),
            (REPO_ROOT / "scripts/usage-export/lifetime-baselines.json").resolve(),
        )

    def test_a_locally_recorded_merge_source_is_recaptured_every_run(self):
        # The fault this replaced: the second source was a file somebody
        # wrote by hand. It aged silently between edits and — as shipped on
        # the owner's machine — was missing the sections the loader requires,
        # so every scheduled export refused until a human looked (2026-08-27).
        second = self.scratch / "second-transcripts"
        transcript_fixture(second)
        self.write_config(MERGE_CAPTURES="beta=messages=%s" % second)
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        argv = self.sandbox_args_file.read_text(encoding="utf-8").splitlines()
        # The LAST sandboxed invocation is the export, and it merges the file
        # the capture before it produced — inside the private scratch, never
        # a configured path that could outlive the run.
        merged = argv[argv.index("--merge-source") + 1]
        key, _, path = merged.partition("=")
        self.assertEqual(key, "beta")
        self.assertTrue(path.endswith("/beta.json"), path)
        self.assertNotIn(str(second), path)
        self.assertIn("usage-export: SUMMARY pushed=", result.stdout)

    def test_the_activity_cache_reaches_the_producer_when_one_is_configured(self):
        # The cache is what carries the series back past the first tool's own
        # transcript retention (issue #170). A configured cache the producer
        # never received would publish a silently shorter history, so what is
        # pinned is the ARGUMENT, not merely the configuration key.
        cache = self.scratch / "activity-cache.json"
        # A roll-up the producer really admits, for the day BEFORE the
        # fixture's own record — which is the shape production has, and the
        # only shape that means anything: the cache exists to supply days the
        # walk has lost to retention, and those are always earlier ones.
        earlier = datetime.date.fromisoformat(TRANSCRIPT_FIXTURE_DAY) - datetime.timedelta(days=1)
        cache.write_text(
            json.dumps(
                {
                    "dailyModelTokens": [
                        {
                            "date": earlier.isoformat(),
                            "tokensByModel": {"claude-opus-5": 4096},
                        }
                    ],
                    # A configured cache must also carry the tool's lifetime
                    # accounting (issue #276): the export refuses one without
                    # it rather than pushing a document whose lifetime-class
                    # tiles the origin would reject as unrefreshed.
                    "modelUsage": {
                        "claude-opus-5": {
                            "inputTokens": 1,
                            "outputTokens": 2,
                            "cacheReadInputTokens": 3,
                            "cacheCreationInputTokens": 4,
                        }
                    },
                    "totalSessions": 5,
                    # ...and the day that accounting is exact as of (issue
                    # #288); a cache without one refuses the run.
                    "lastComputedDate": earlier.isoformat(),
                }
            ),
            encoding="utf-8",
        )
        self.write_config(ACTIVITY_CACHE=str(cache))
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        argv = self.sandbox_args_file.read_text(encoding="utf-8").splitlines()
        self.assertIn("--activity-cache", argv)
        self.assertEqual(argv[argv.index("--activity-cache") + 1], str(cache))

    def test_a_configured_history_directory_reaches_every_producer(self):
        # Issue #234: the stores are what keep pruned days in the published
        # series, so what is pinned is the RESULT on both producer paths — a
        # store file per source, named for its key — plus the export's own
        # argument, exactly as the activity cache is pinned above.
        second = self.scratch / "second-transcripts"
        transcript_fixture(second)
        history = self.scratch / "history"
        self.write_config(
            MERGE_CAPTURES="beta=messages=%s" % second,
            HISTORY_DIR=str(history),
        )
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        argv = self.sandbox_args_file.read_text(encoding="utf-8").splitlines()
        self.assertIn("--history-store", argv)
        self.assertEqual(
            argv[argv.index("--history-store") + 1], str(history / "alpha.json")
        )
        # Both producers really ran with their stores: each wrote one back,
        # and the walked day is remembered in each.
        for key in ("alpha", "beta"):
            store = history / ("%s.json" % key)
            self.assertTrue(store.is_file(), "no store written for %s" % key)
            days = json.loads(store.read_text(encoding="utf-8"))["days"]
            self.assertIn(TRANSCRIPT_FIXTURE_DAY, days)

    def test_no_configured_history_directory_passes_no_store_argument(self):
        # The negative control: without the key, the producers run exactly
        # as they did before the option existed, and nothing is written.
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        argv = self.sandbox_args_file.read_text(encoding="utf-8").splitlines()
        self.assertNotIn("--history-store", argv)

    def test_a_configured_history_directory_writes_the_dataset_and_applies_readings(self):
        # Issue #299: the graphing dataset is rebuilt beside the stores on
        # every run, and a verified readings file beside a store reaches its
        # producer — only when it exists, because absence is the ordinary
        # state and never a refusal.
        history = self.scratch / "history"
        self.write_config(HISTORY_DIR=str(history))
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        argv = self.sandbox_args_file.read_text(encoding="utf-8").splitlines()
        self.assertEqual(argv[argv.index("--dataset") + 1], str(history / "dataset.json"))
        self.assertNotIn("--verified-readings", argv)
        dataset = json.loads((history / "dataset.json").read_text(encoding="utf-8"))
        self.assertEqual(dataset["schema"], "usage-dataset/v1")
        alpha = dataset["sources"]["alpha"]
        self.assertEqual([row["date"] for row in alpha["days"]], [TRANSCRIPT_FIXTURE_DAY])
        self.assertEqual(alpha["coverage"]["verifiedDays"], 0)
        # A reading for the day before the fixture's record: the argument
        # appears, the day joins the record at the surface's figure, and the
        # dataset says which day is verified.
        earlier = (datetime.date.fromisoformat(TRANSCRIPT_FIXTURE_DAY) - datetime.timedelta(days=1)).isoformat()
        (history / "alpha.verified.json").write_text(
            json.dumps(
                {
                    "schema": "usage-verified/v1",
                    "readings": {earlier: {"total": 5, "readOn": TRANSCRIPT_FIXTURE_DAY}},
                }
            ),
            encoding="utf-8",
        )
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        argv = self.sandbox_args_file.read_text(encoding="utf-8").splitlines()
        self.assertEqual(
            argv[argv.index("--verified-readings") + 1], str(history / "alpha.verified.json")
        )
        dataset = json.loads((history / "dataset.json").read_text(encoding="utf-8"))
        alpha = dataset["sources"]["alpha"]
        self.assertEqual(alpha["days"][0], {"date": earlier, "total": 5, "verified": True})
        self.assertEqual(alpha["coverage"]["verifiedDays"], 1)
        self.assertEqual(alpha["coverage"]["start"], earlier)
        # A reading beside a MERGE source's store reaches that producer too
        # (round-1 finding 1c). The argv file records only the last producer,
        # so this is pinned by the RESULT: the day lands in that source's own
        # store at the surface's figure, and the dataset marks it.
        second = self.scratch / "second-transcripts"
        transcript_fixture(second)
        self.write_config(MERGE_CAPTURES="beta=messages=%s" % second, HISTORY_DIR=str(history))
        (history / "beta.verified.json").write_text(
            json.dumps(
                {
                    "schema": "usage-verified/v1",
                    "readings": {earlier: {"total": 7, "readOn": TRANSCRIPT_FIXTURE_DAY}},
                }
            ),
            encoding="utf-8",
        )
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        beta_days = json.loads((history / "beta.json").read_text(encoding="utf-8"))["days"]
        self.assertEqual(beta_days[earlier], {"total": 7})
        dataset = json.loads((history / "dataset.json").read_text(encoding="utf-8"))
        self.assertEqual(dataset["sources"]["beta"]["days"][0], {"date": earlier, "total": 7, "verified": True})

    def test_a_configured_history_directory_records_the_run_in_the_ledger(self):
        # Issue #267: the record defaults to living beside the stores, and it
        # is the EXPORT that writes it, inside the same sandbox. What is
        # pinned is the argument AND the result: a flag the producer never
        # received is a record that silently never grows, which is the exact
        # failure class the activity cache and the stores already taught.
        history = self.scratch / "history"
        self.write_config(HISTORY_DIR=str(history))
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        argv = self.sandbox_args_file.read_text(encoding="utf-8").splitlines()
        self.assertEqual(argv[argv.index("--ledger") + 1], str(history / "ledger"))
        # The revision the SUMMARY reports is the one recorded on every row,
        # read once per run: two reads could name two trees.
        revision = argv[argv.index("--exporter-version") + 1]
        self.assertIn("exporter=%s" % revision, result.stdout)
        rows = [
            json.loads(line)
            for line in (history / "ledger" / "usage" / "2026.ndjson")
            .read_text(encoding="utf-8")
            .splitlines()
        ]
        self.assertTrue(rows, "the ledger recorded nothing")
        recorded = {row["day"] for row in rows}
        self.assertIn(TRANSCRIPT_FIXTURE_DAY, recorded)
        for row in rows:
            self.assertEqual(row["schema"], "ledger/v1")
            self.assertEqual(row["exporter"], revision)
        # The record is private: it holds this workstation's whole measured
        # history of its own work.
        self.assertEqual(
            stat.S_IMODE((history / "ledger" / "usage" / "2026.ndjson").stat().st_mode),
            0o600,
        )
        # A second run measures the same figures and appends nothing.
        before = (history / "ledger" / "usage" / "2026.ndjson").read_bytes()
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            (history / "ledger" / "usage" / "2026.ndjson").read_bytes(), before
        )

    def test_no_configured_history_directory_writes_no_ledger(self):
        # The negative control: without a store directory there is nowhere the
        # record lives by default, and the producer runs exactly as it did
        # before the option existed.
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        argv = self.sandbox_args_file.read_text(encoding="utf-8").splitlines()
        self.assertNotIn("--ledger", argv)
        self.assertNotIn("--exporter-version", argv)

    def test_an_explicit_ledger_directory_overrides_the_store_default(self):
        history = self.scratch / "history"
        elsewhere = self.scratch / "record"
        elsewhere.mkdir()
        self.write_config(HISTORY_DIR=str(history), LEDGER_DIR=str(elsewhere / "ledger"))
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        argv = self.sandbox_args_file.read_text(encoding="utf-8").splitlines()
        self.assertEqual(argv[argv.index("--ledger") + 1], str(elsewhere / "ledger"))
        self.assertTrue((elsewhere / "ledger" / "schema.json").is_file())
        self.assertFalse((history / "ledger").exists())

    def test_the_log_brackets_every_stage_and_ends_with_one_summary_line(self):
        # Issue #299, the failure-logging rule: a START line per stage in
        # order, the export's coverage line, and one SUMMARY line carrying the
        # sealed size, the checksum prefix, the exporter's checkout revision,
        # the elapsed time and every stage's duration. Stage names and counts
        # only — the log must name no path.
        second = self.scratch / "second-transcripts"
        transcript_fixture(second)
        self.write_config(MERGE_CAPTURES="beta=messages=%s" % second)
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = result.stdout.splitlines()
        self.assertEqual(
            [line for line in lines if line.startswith("usage-export: START ")],
            [
                "usage-export: START recapture-beta",
                "usage-export: START export",
                "usage-export: START seal",
                "usage-export: START push",
            ],
        )
        self.assertIn("coverage alpha=%s..%s beta=%s..%s" % ((TRANSCRIPT_FIXTURE_DAY,) * 4), result.stderr)
        revision = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "rev-parse", "--short=12", "HEAD"],
            capture_output=True,
            text=True,
        )
        expected = revision.stdout.strip() if revision.returncode == 0 else "unknown"
        self.assertRegex(
            lines[-1],
            r"^usage-export: SUMMARY pushed=\d+B sha256=[0-9a-f]{12} exporter=%s elapsed=\d+s "
            r"stages: recapture-beta=\d+s export=\d+s seal=\d+s push=\d+s$" % re.escape(expected),
        )
        # The SUMMARY is the one success line (issue #358): the separate
        # "pushed ... checksum verified" line said the same thing again, and
        # the SUMMARY is printed only after the host's checksum matched.
        self.assertEqual(lines[-2], "usage-export: START push")
        self.assertEqual(len(lines), 5, lines)
        self.assertNotIn(str(self.scratch), result.stdout + result.stderr)

    def test_a_failure_names_its_stage_and_the_elapsed_time(self):
        # Before any stage: a configuration refusal is reported at the
        # configure stage. Inside a stage: a recapture that finds no records
        # is reported at that stage's name.
        self.write_config(ACTIVITY_CACHE=str(self.scratch / "missing"))
        result = run_script(PUSH, env=self.env)
        self.assertNotEqual(result.returncode, 0)
        self.assertRegex(result.stderr, r"usage-export: FAILED stage=configure elapsed=\d+s")
        empty = self.scratch / "empty"
        empty.mkdir()
        self.write_config(MERGE_CAPTURES="beta=messages=%s" % empty)
        result = run_script(PUSH, env=self.env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("could not be recaptured", result.stderr)
        self.assertRegex(result.stderr, r"usage-export: FAILED stage=recapture-beta elapsed=\d+s")
        self.assertNotIn("SUMMARY", result.stdout)

    def test_no_configured_cache_passes_no_cache_argument(self):
        # The negative control, and the reason the test above is not vacuous:
        # the cache is optional, and a run without one must invoke the
        # producer exactly as it did before the option existed.
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        argv = self.sandbox_args_file.read_text(encoding="utf-8").splitlines()
        self.assertNotIn("--activity-cache", argv)

    def test_a_configured_cache_that_is_not_a_file_pushes_nothing(self):
        # Fail closed on a MISCONFIGURATION, not on an absent option. Dropping
        # an unreadable cache and carrying on would publish a series two
        # months shorter with nothing anywhere saying why — the exact silent
        # shortening this work package exists to end.
        self.write_config(ACTIVITY_CACHE=str(self.scratch / "not-here.json"))
        result = run_script(PUSH, env=self.env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ACTIVITY_CACHE does not name a file", result.stderr)
        self.assertFalse(
            self.args_file.exists(),
            "a misconfigured cache still reached the transport",
        )

    def test_a_failed_recapture_pushes_nothing_at_all(self):
        # Refusing is the only correct answer here, and it is a property of
        # the RECEIVER rather than a preference: the origin refuses a
        # document whose source set is not equal to the set its snapshot
        # ships, so a partial push would be built, sealed, sent and refused
        # on arrival — the same failure, later and quieter.
        empty = self.scratch / "nothing-here"
        empty.mkdir()
        self.write_config(MERGE_CAPTURES="beta=messages=%s" % empty)
        result = run_script(PUSH, env=self.env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("could not be recaptured", result.stderr)
        self.assertIn("nothing was pushed", result.stderr)
        self.assertFalse(
            self.args_file.exists(),
            "a failed recapture still reached the transport",
        )

    def test_a_merge_capture_key_is_held_to_a_label_shape_before_it_is_a_path(self):
        # The key becomes a file name in the scratch directory, so it is
        # checked BEFORE it is used to build one — a key carrying a separator
        # would otherwise choose where the capture writes.
        second = self.scratch / "second-transcripts"
        transcript_fixture(second)
        for key in ("../escape", "Beta", "9beta", "beta/two", ""):
            with self.subTest(key=key):
                self.write_config(MERGE_CAPTURES="%s=messages=%s" % (key, second))
                result = run_script(PUSH, env=self.env)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.args_file.exists())

    def test_a_malformed_merge_capture_triple_refuses(self):
        for entry in ("beta", "beta=messages", "beta==%s" % self.scratch):
            with self.subTest(entry=entry):
                self.write_config(MERGE_CAPTURES=entry)
                result = run_script(PUSH, env=self.env)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("KEY=FORMAT=DIRECTORY", result.stderr)

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
        # Structural companion to the behavioral tests above: EVERY place a
        # program that walks raw records is started is a sandboxed place. An
        # unwrapped invocation would satisfy every test that only observes the
        # happy path, which is exactly why this is checked as a property of
        # the file rather than of one run.
        #
        # It is written over the SET of walkers rather than over the export
        # script alone (2026-08-27): the push now recaptures every locally
        # recorded merge source at the top of each run, so the capture tool
        # walks raw records here too and inherits the identical boundary. A
        # pin naming only the export would have said nothing about the walker
        # added beside it.
        source = PUSH.read_text(encoding="utf-8")
        lines = [
            line for line in source.splitlines() if not line.lstrip().startswith("#")
        ]
        for walker in ("$EXPORT_SCRIPT", "$CAPTURE_SCRIPT"):
            invocations = [line.strip() for line in lines if walker in line]
            # The guard that the file exists, and the sandboxed run.
            self.assertEqual(len(invocations), 2, invocations)
            self.assertTrue(any(line.startswith("[ -f ") for line in invocations))
            run_line = [line for line in invocations if not line.startswith("[ -f ")][0]
            self.assertIn("python3", run_line)
        sandbox_lines = [
            line for line in lines if line.strip().startswith("sandbox-exec ")
        ]
        # One per walker, and each one carrying the profile: a count alone
        # would pass if both lines started the same program.
        self.assertEqual(len(sandbox_lines), 2, sandbox_lines)
        for line in sandbox_lines:
            self.assertIn('-f "$PRODUCER_PROFILE"', line)
        # Every other interpreter is a fixed helper that never walks raw
        # records: the SSH lifecycle runner (the already-sealed stream), the
        # checkout's bounded fetch, and the served check, which reads one
        # public envelope and records instants (issue #358). Each exact
        # invocation, and the file it runs, is named before it is excluded,
        # so an arbitrary unconfined Python start cannot hide behind them.
        starts = [line.strip() for line in lines if "python3" in line]
        for helper, assignment in (
            ('python3 -I -B "$PUSH_WATCHDOG" ssh -F /dev/null \\',
             'PUSH_WATCHDOG="$REPO_DIR/scripts/usage-export/bounded-ssh.py"'),
            ('GIT_TERMINAL_PROMPT=0 python3 -I -B "$REPO_FETCH" "$REPO_DIR" </dev/null || true',
             'REPO_FETCH="$REPO_DIR/scripts/usage-export/bounded-fetch.py"'),
            ('python3 -I -B "$SERVED_CHECK" check --site "$SITE_URL" --state '
             '"${HISTORY_DIR:+$HISTORY_DIR/push-state.json}" --exporter "$exporter_revision" </dev/null \\',
             'SERVED_CHECK="$REPO_DIR/scripts/usage-export/served-check.py"'),
            ('python3 -I -B "$SERVED_CHECK" record --state "$HISTORY_DIR/push-state.json" '
             '--document "$PLAIN" --sha256 "$local_sum" </dev/null \\',
             'SERVED_CHECK="$REPO_DIR/scripts/usage-export/served-check.py"'),
        ):
            self.assertEqual(starts.count(helper), 1, starts)
            starts.remove(helper)
            self.assertIn(assignment, source)
        self.assertEqual(len(starts), 2, starts)
        for line in starts:
            self.assertIn("-I -B", line)

    def test_the_push_carries_every_hardening_option(self):
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("usage-export: SUMMARY pushed=", result.stdout)
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
        self.assertIn("pusher@stub-push-host", argv)
        self.assertIn("usage-export-receive", argv)
        # -F /dev/null is the option that makes the rest mean anything: it is
        # what stops ~/.ssh/config and /etc/ssh/ssh_config contributing at
        # all (round-3 finding 8).
        self.assertIn("-F", argv)
        self.assertEqual(argv[argv.index("-F") + 1], "/dev/null")
        self.assertIn("UserKnownHostsFile=%s" % self.known_hosts, options)

    def test_the_resolved_configuration_is_checked_before_the_connection(self):
        # The options above say what was ASKED for; ssh -G says what was
        # RESOLVED, and only the second governs the connection. The script
        # asks first and refuses unless the answer matches.
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.g_args_file.exists(), "the push never resolved its own configuration")
        g_argv = self.g_args_file.read_text(encoding="utf-8").splitlines()
        self.assertIn("-G", g_argv)
        self.assertIn("pusher@stub-push-host", g_argv)
        self.assertNotIn("usage-export-receive", g_argv,
                         "the resolution probe must not carry the remote command")
        # And it happened FIRST: the probe argv and the push argv are both
        # recorded, and the push file is the later write.
        self.assertLess(
            self.g_args_file.stat().st_mtime_ns,
            self.args_file.stat().st_mtime_ns + 1,
        )

    def test_a_smuggled_second_identity_refuses_the_push(self):
        # The measured hazard behind this check: ssh SILENTLY IGNORES an -i
        # path that does not exist and falls back to the default ~/.ssh
        # identities, so a mistyped SSH_IDENTITY would authenticate with the
        # operator's ordinary key — quite possibly an admin key, and without
        # the forced command. Any resolution offering more than the one
        # dedicated key is refused before a connection is attempted.
        env = dict(self.env)
        env["SSH_G_EXTRA"] = "identityfile /home/operator/.ssh/id_ed25519"
        self.args_file.unlink(missing_ok=True)
        result = run_script(PUSH, env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("offers 2 identities", result.stderr)
        # The probe itself runs ssh, so the argv file exists; what must NOT
        # have happened is the transfer.
        self.assertNotIn("usage-export-receive",
                         self.args_file.read_text(encoding="utf-8"),
                         "the push connected with an unreviewed identity available")

    def test_a_resolved_identity_that_is_not_the_configured_key_refuses(self):
        # ssh takes the FIRST value it obtains for a parameter, so an earlier
        # identity wins over the one this push asked for — exactly what an
        # inherited Match block would do.
        env = dict(self.env)
        env["SSH_G_OVERRIDE"] = "identityfile /somewhere/else"
        env["SSH_G_NO_IDENTITY"] = "1"
        result = run_script(PUSH, env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not the configured push key", result.stderr)

    def test_every_remnant_of_a_configuration_file_refuses_the_push(self):
        # A proxy or local command is CODE running on this workstation at
        # connect time; a controlpath is a live admin session this push could
        # be multiplexed onto. Each is refused by name so a red run says
        # which one leaked.
        for key in FORBIDDEN_RESOLVED_KEYS:
            with self.subTest(remnant=key):
                env = dict(self.env)
                env["SSH_G_EXTRA"] = "%s /usr/bin/somebodys-helper" % key
                self.args_file.unlink(missing_ok=True)
                result = run_script(PUSH, env=env)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("still carries a %s" % key, result.stderr)
                self.assertNotIn("usage-export-receive",
                                 self.args_file.read_text(encoding="utf-8"))

    def test_a_relaxed_resolved_option_refuses_the_push(self):
        # Every one of these is a value an inherited configuration file could
        # supply, and each defeats a different half of the design: host-key
        # checking off is trust-on-first-use against a machine that holds the
        # forced command; agent forwarding or an agent socket is a path back
        # toward the workstation; PermitLocalCommand is code execution here.
        for line, needle in (
            ("stricthostkeychecking false", "stricthostkeychecking"),
            ("forwardagent yes", "forwardagent"),
            ("identityagent /tmp/agent.sock", "identityagent"),
            ("permitlocalcommand yes", "permitlocalcommand"),
            ("clearallforwardings no", "clearallforwardings"),
            ("controlmaster auto", "controlmaster"),
            ("globalknownhostsfile /etc/ssh/ssh_known_hosts", "globalknownhostsfile"),
            ("passwordauthentication yes", "passwordauthentication"),
            ("connecttimeout none", "connecttimeout"),
            ("connectionattempts 10", "connectionattempts"),
            ("serveraliveinterval 0", "serveraliveinterval"),
            ("serveralivecountmax 99", "serveralivecountmax"),
            ("loglevel INFO", "loglevel"),
            ("loglevel VERBOSE", "loglevel"),
        ):
            with self.subTest(line=line):
                env = dict(self.env)
                env["SSH_G_OVERRIDE"] = line
                self.args_file.unlink(missing_ok=True)
                result = run_script(PUSH, env=env)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(needle, result.stderr)
                self.assertNotIn("usage-export-receive",
                                 self.args_file.read_text(encoding="utf-8"))

    def test_a_pinned_known_hosts_file_the_resolution_ignores_refuses(self):
        env = dict(self.env)
        env["SSH_G_OVERRIDE"] = "userknownhostsfile /home/operator/.ssh/known_hosts"
        result = run_script(PUSH, env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("userknownhostsfile", result.stderr)

    def test_a_destination_without_a_user_is_refused(self):
        # With no configuration file in play, ssh falls back to the LOCAL
        # username for a bare hostname — a different account, very possibly
        # one without the forced command.
        self.write_config(PUSH_HOST="stub-push-host")
        result = run_script(PUSH, env=self.env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must be user@host", result.stderr)

    def test_an_unpinned_host_key_is_refused(self):
        self.write_config(SSH_KNOWN_HOSTS=str(self.scratch / "absent"))
        result = run_script(PUSH, env=self.env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("host key must be pinned", result.stderr)

    def test_a_missing_known_hosts_setting_is_refused(self):
        values = dict(self.config_lines)
        del values["SSH_KNOWN_HOSTS"]
        self.config.write_text(
            "".join("%s=%s\n" % pair for pair in values.items()), encoding="utf-8")
        self.config.chmod(0o600)
        result = run_script(PUSH, env=self.env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SSH_KNOWN_HOSTS", result.stderr)

    def test_an_identity_path_that_does_not_exist_is_refused(self):
        # The whole reason the identity is checked twice. ssh does not fail
        # on a missing -i path; it quietly uses the defaults instead.
        self.write_config(SSH_IDENTITY=str(self.scratch / "absent_key"))
        self.args_file.unlink(missing_ok=True)
        result = run_script(PUSH, env=self.env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SILENTLY ignores", result.stderr)
        self.assertFalse(self.args_file.exists(),
                         "ssh ran at all for a configuration already known bad")

    def test_a_checksum_mismatch_refuses_the_push(self):
        lying_stub_dir = self.scratch / "lying"
        lying_stub_dir.mkdir()
        write_executable(lying_stub_dir / "ssh", ssh_stub(LYING_RESPONSE))
        env = dict(self.env)
        # The lying ssh goes IN FRONT of the fixture PATH, never instead of
        # it: this case swaps one stub, and every other stub the pipeline
        # needs must stay reachable. Rebuilding the value from os.environ
        # dropped the sandbox-exec stub, so the run refused at the sandbox
        # stage — invisible on a host that ships a real sandbox-exec, a
        # guaranteed failure on one that does not, and in both cases the
        # checksum stage under test was never reached.
        env["PATH"] = "%s:%s" % (lying_stub_dir, self.env["PATH"])
        result = run_script(PUSH, env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checksum mismatch", result.stderr)
        # Non-vacuity for the PATH above, and the pin that keeps it honest: a
        # refusal is only evidence about the checksum stage if the run
        # actually REACHED it. The fixture's sandbox stub records its
        # invocation, so this file existing proves the substitution swapped
        # exactly one stub and left the rest of the pipeline intact.
        self.assertTrue(
            self.sandbox_args_file.exists(),
            "the producer never ran through the fixture's sandbox stub, so this "
            "refusal came from an earlier stage than the one under test",
        )

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
            required_match(
                r"^MAX_SEALED_BYTES=(\d+)$",
                PUSH.read_text(encoding="utf-8"),
                "push-usage-series.sh carries no MAX_SEALED_BYTES",
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
            required_match(
                r"^MAX_SEALED_BYTES=(\d+)$",
                PUSH.read_text(encoding="utf-8"),
                "push-usage-series.sh carries no MAX_SEALED_BYTES",
                re.MULTILINE,
            ).group(1)
        )
        write_executable(
            self.scratch / "usageseal",
            "#!/bin/sh\ncat >/dev/null\nhead -c %d /dev/zero\n" % cap,
        )
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("usage-export: SUMMARY pushed=%dB " % cap, result.stdout)


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
        # The second agent's two committed artifacts (issue #267): the
        # snapshot template beside the export one, and the script it runs.
        shutil.copy(SNAPSHOT_TEMPLATE, target / SNAPSHOT_TEMPLATE.name)
        (self.primary / "scripts" / SNAPSHOT.name).write_text(
            "#!/usr/bin/env python3\n", encoding="utf-8"
        )

    def env(self, **extra):
        merged = {"HOME": str(self.home)}
        merged.update(extra)
        return merged

    def config(self, **values):
        """One push-script configuration file, private, naming only what the
        installer reads out of it."""
        path = self.scratch / "config"
        path.write_text(
            "".join("%s=%s\n" % pair for pair in values.items()), encoding="utf-8"
        )
        path.chmod(0o600)
        return path

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

    def test_the_schedule_runs_each_minute_without_a_second_launcher(self):
        result = run_script(INSTALL, ["--render-only"], env=self.env())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(
            "<key>StartInterval</key>\n    <integer>60</integer>",
            result.stdout,
            "the rendered agent must wake the single launchd job each minute",
        )

    def test_the_agent_tells_the_push_where_its_logs_are(self):
        # Issue #358: launchd never rotates its log files, so the push does,
        # and the directory it rotates in is the installer's decision — the
        # same one the agent's StandardOutPath and StandardErrorPath use.
        result = run_script(INSTALL, ["--render-only"], env=self.env())
        self.assertEqual(result.returncode, 0, result.stderr)
        logs = self.home / "Library" / "Logs" / "naranjo-online-usage-export"
        self.assertIn(
            "<key>EnvironmentVariables</key>\n    <dict>\n"
            "        <key>NARANJO_USAGE_EXPORT_LOG_DIR</key>\n"
            "        <string>%s</string>\n    </dict>" % logs,
            result.stdout,
        )
        self.assertIn("<string>%s/usage-export.log</string>" % logs, result.stdout)
        self.assertIn("<string>%s/usage-export.err.log</string>" % logs, result.stdout)

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

    def test_a_repo_dir_without_the_snapshot_artifacts_is_refused(self):
        # Both halves of the second agent are checked before anything is
        # rendered, for the reason the push script checks its own scripts: a
        # plist pointing at a file that is not there installs a job that fails
        # every night into a log nobody reads.
        for missing in (SNAPSHOT_TEMPLATE.name, SNAPSHOT.name):
            with self.subTest(missing=missing):
                target = self.primary / "scripts"
                path = (
                    target / "usage-export" / missing
                    if missing.endswith(".template")
                    else target / missing
                )
                moved = path.with_name(path.name + ".moved")
                path.rename(moved)
                self.addCleanup(lambda a=moved, b=path: a.rename(b) if a.exists() else None)
                result = run_script(INSTALL, ["--render-only"], env=self.env())
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("snapshot", result.stderr)
                moved.rename(path)

    def test_no_configured_ledger_renders_no_snapshot_agent(self):
        # Issue #267, the negative control: the second agent exists to write
        # into the record, so a workstation with no record configured gets
        # exactly the schedule it had before this option existed.
        result = run_script(INSTALL, ["--render-only"], env=self.env())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("com.naranjo-online.ledger-snapshot", result.stdout)
        self.assertIn("com.naranjo-online.usage-export", result.stdout)

    def test_a_configured_history_directory_renders_the_nightly_snapshot(self):
        # The record defaults to living beside the stores, so configuring the
        # stores configures the snapshot with them. What is pinned is the
        # rendered ARGUMENTS — a plist that runs the script without a ledger
        # would install a job that refuses every night.
        history = self.scratch / "history"
        config = self.config(HISTORY_DIR=str(history))
        result = run_script(
            INSTALL, ["--render-only"],
            env=self.env(NARANJO_USAGE_EXPORT_CONFIG=str(config)))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("com.naranjo-online.ledger-snapshot", result.stdout)
        self.assertIn(
            "<string>%s</string>" % (self.primary / "scripts" / SNAPSHOT.name),
            result.stdout,
        )
        self.assertIn("<string>%s</string>" % (history / "ledger"), result.stdout)
        self.assertNotIn("__SNAPSHOT_SCRIPT__", result.stdout)
        self.assertNotIn("__LEDGER_DIR__", result.stdout)
        # Once a night, not every minute: the panels it reads change on the
        # origin's cadence and the record wants one level reading per day.
        self.assertIn("<key>StartCalendarInterval</key>", result.stdout)
        self.assertIn("<key>Hour</key>\n        <integer>23</integer>", result.stdout)
        self.assertIn("<key>Minute</key>\n        <integer>45</integer>", result.stdout)

    def test_an_explicit_ledger_directory_wins_over_the_default(self):
        elsewhere = self.scratch / "elsewhere" / "record"
        config = self.config(
            HISTORY_DIR=str(self.scratch / "history"), LEDGER_DIR=str(elsewhere)
        )
        result = run_script(
            INSTALL, ["--render-only"],
            env=self.env(NARANJO_USAGE_EXPORT_CONFIG=str(config)))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("<string>%s</string>" % elsewhere, result.stdout)
        self.assertNotIn(str(self.scratch / "history" / "ledger"), result.stdout)

    def test_the_snapshot_runs_outside_the_producer_sandbox(self):
        # Stated in the template and pinned here, because it is the one job
        # in this pipeline that is deliberately unconfined: it needs the
        # network producer.sb denies, and it reads nothing private.
        config = self.config(HISTORY_DIR=str(self.scratch / "history"))
        result = run_script(
            INSTALL, ["--render-only"],
            env=self.env(NARANJO_USAGE_EXPORT_CONFIG=str(config)))
        self.assertEqual(result.returncode, 0, result.stderr)
        snapshot = result.stdout.split("com.naranjo-online.ledger-snapshot", 1)[1]
        self.assertNotIn("sandbox-exec", snapshot)
        self.assertNotIn("producer.sb", snapshot)
        # The interpreter is still isolated, exactly as the export's is.
        self.assertIn("<string>-I</string>", snapshot)
        self.assertIn("<string>-B</string>", snapshot)

    def test_a_lax_configuration_mode_refuses_the_install(self):
        # The push script requires its configuration private because it names
        # key material; this script reads the same file, so it applies the
        # same refusal rather than a weaker one.
        config = self.config(HISTORY_DIR=str(self.scratch / "history"))
        config.chmod(0o644)
        result = run_script(
            INSTALL, ["--render-only"],
            env=self.env(NARANJO_USAGE_EXPORT_CONFIG=str(config)))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("configuration must be private", result.stderr)

    def test_the_configuration_cannot_move_what_the_installer_decides(self):
        # The configuration file is read for exactly two values. Sourcing it
        # in the parent shell would let every other name in it — the log
        # directory here, but equally the labels or the agent directory —
        # take over a decision this script owns.
        config = self.config(
            HISTORY_DIR=str(self.scratch / "history"),
            LOG_DIR=str(self.scratch / "hijacked-logs"),
        )
        result = run_script(
            INSTALL, ["--render-only"],
            env=self.env(NARANJO_USAGE_EXPORT_CONFIG=str(config)))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("hijacked-logs", result.stdout)
        self.assertIn(
            "<string>%s/Library/Logs/naranjo-online-usage-export/usage-export.log</string>"
            % self.home,
            result.stdout,
        )

    def test_the_configurations_repo_dir_never_moves_the_anchor(self):
        # The configuration file also defines REPO_DIR. Reading it in a
        # subshell is what keeps the anchor the installer's own decision —
        # the M4 finding above is exactly about the anchor coming from
        # somewhere that can move.
        config = self.config(
            REPO_DIR=str(self.scratch / "somewhere-else"),
            HISTORY_DIR=str(self.scratch / "history"),
        )
        result = run_script(
            INSTALL, ["--render-only"],
            env=self.env(NARANJO_USAGE_EXPORT_CONFIG=str(config)))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(str(self.scratch / "somewhere-else"), result.stdout)
        self.assertIn(
            "<string>%s</string>"
            % (self.primary / "scripts" / "usage-export" / "push-usage-series.sh"),
            result.stdout,
        )


@unittest.skipIf(shutil.which("ssh") is None, "no ssh client on this host")
class SshResolvedConfigurationTest(unittest.TestCase):
    """Round-3 finding 8, against the REAL resolver.

    Everything above models `ssh -G`; this class runs it. The function under
    test is lifted verbatim out of the shipped push script, so what is
    exercised is the exact option list that ships — not a copy that can drift
    away from it — and the assertions are the ones the finding names: exactly
    one IdentityFile, and no proxy or local-command remnant.

    A hostile config file is staged on disk, and the control test points the
    same shipped invocation at it to prove the file is real and would apply.
    That control is also the sharpest statement of WHY the finding is not
    satisfied by naming a few options: a config file can introduce
    parameters the command line never mentions at all — an accumulating
    extra IdentityFile, a RemoteCommand — and no amount of naming the
    options someone thought of prevents that. Only refusing to read a config
    file does.
    """

    HOSTILE_CONFIG = """\
Host *
    IdentityFile SMUGGLED_KEY
    RemoteCommand /bin/sh
    ProxyCommand /usr/bin/false %h %p
    PermitLocalCommand yes
    LocalCommand /usr/bin/false
    ForwardAgent yes
    StrictHostKeyChecking no
    ControlMaster auto
    ControlPath CONTROL_PATH
    UserKnownHostsFile OTHER_KNOWN_HOSTS
"""

    def setUp(self):
        self.scratch = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.scratch, ignore_errors=True)
        self.smuggled = self.scratch / "smuggled_ed25519"
        self.smuggled.write_text("smuggled\n", encoding="utf-8")
        self.smuggled.chmod(0o600)
        self.hostile_config = self.scratch / "hostile_ssh_config"
        self.hostile_config.write_text(
            self.HOSTILE_CONFIG
            .replace("SMUGGLED_KEY", str(self.smuggled))
            .replace("CONTROL_PATH", str(self.scratch / "cm-%r@%h:%p"))
            .replace("OTHER_KNOWN_HOSTS", str(self.scratch / "other_known_hosts")),
            encoding="utf-8",
        )
        self.hostile_config.chmod(0o600)
        self.identity = self.scratch / "push_ed25519"
        self.identity.write_text("push identity\n", encoding="utf-8")
        self.identity.chmod(0o600)
        self.known_hosts = self.scratch / "known_hosts"
        self.known_hosts.write_text("# pinned\n", encoding="utf-8")

    def push_ssh_source(self) -> str:
        """The shipped push_ssh function, verbatim."""
        source = PUSH.read_text(encoding="utf-8")
        start = source.index("push_ssh() {")
        end = source.index("\n}\n", start) + len("\n}\n")
        body = source[start:end]
        self.assertIn("-F", body)
        self.assertIn("/dev/null", body)
        return body

    def resolve(self, function_source: str) -> dict[str, list[str]]:
        harness = self.scratch / "resolve.sh"
        harness.write_text(
            "#!/bin/sh\n"
            "set -eu\n"
            'SSH_KNOWN_HOSTS="%s"\n' % self.known_hosts
            + 'SSH_IDENTITY="%s"\n' % self.identity
            + "PUSH_PORT=22\n"
            + 'PUSH_WATCHDOG="%s"\n' % (SCRIPTS / "bounded-ssh.py")
            + function_source
            + '\npush_ssh -G pusher@resolver.invalid </dev/null\n',
            encoding="utf-8",
        )
        result = subprocess.run(
            ["/bin/sh", str(harness)],
            capture_output=True,
            text=True,
            env={"PATH": os.environ.get("PATH", "/usr/bin:/bin")},
            stdin=subprocess.DEVNULL,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        resolved: dict[str, list[str]] = {}
        for line in result.stdout.splitlines():
            if not line.strip():
                continue
            key, _, value = line.partition(" ")
            resolved.setdefault(key.lower(), []).append(value.strip())
        self.assertIn("identityfile", resolved, "ssh -G returned nothing usable")
        return resolved

    def test_the_shipped_invocation_resolves_to_exactly_one_identity(self):
        resolved = self.resolve(self.push_ssh_source())
        self.assertEqual(
            resolved["identityfile"], [str(self.identity)],
            "the resolved configuration must offer exactly the dedicated push key",
        )

    def test_the_shipped_invocation_carries_no_proxy_or_local_command(self):
        resolved = self.resolve(self.push_ssh_source())
        for remnant in FORBIDDEN_RESOLVED_KEYS:
            self.assertNotIn(
                remnant, resolved,
                "the resolved configuration still carries a %s" % remnant,
            )

    def test_the_shipped_invocation_resolves_every_hardening_value(self):
        resolved = self.resolve(self.push_ssh_source())
        for key, expected in (
            ("permitlocalcommand", "no"),
            ("forwardagent", "no"),
            ("forwardx11", "no"),
            ("clearallforwardings", "yes"),
            ("identityagent", "none"),
            ("controlmaster", "false"),
            ("requesttty", "false"),
            ("stricthostkeychecking", "true"),
            ("userknownhostsfile", str(self.known_hosts)),
            ("globalknownhostsfile", "/dev/null"),
            ("passwordauthentication", "no"),
            ("gssapiauthentication", "no"),
            ("loglevel", "ERROR"),
        ):
            with self.subTest(option=key):
                self.assertEqual(resolved.get(key), [expected])

    def test_a_consulted_config_file_would_otherwise_contribute(self):
        # The non-vacuity control, and the argument for the whole approach.
        # Point the SAME shipped invocation — every hardening option intact —
        # at a config file, and the resolution changes anyway:
        #
        #   * a second IdentityFile joins the list, because IdentityFile
        #     ACCUMULATES rather than being overridden. That is the smuggled
        #     key authenticating alongside the dedicated one, without the
        #     forced command;
        #   * a RemoteCommand appears, which the command line never mentions
        #     at all — the plainest demonstration that naming options is not
        #     the same as controlling the configuration.
        #
        # Neither is prevented by any -o in the list; only /dev/null is.
        with_config = self.push_ssh_source().replace(
            "ssh -F /dev/null \\", "ssh -F %s \\" % self.hostile_config, 1)
        self.assertNotIn("-F /dev/null", with_config)
        resolved = self.resolve(with_config)
        self.assertIn(
            str(self.smuggled), resolved["identityfile"],
            "the staged config contributed no extra identity; the control proves nothing",
        )
        self.assertGreater(len(resolved["identityfile"]), 1)
        self.assertIn(
            "remotecommand", resolved,
            "the staged config contributed no unnamed parameter; the control proves nothing",
        )


# ---------------------------------------------------------------------------
# Issue #358: the installed job made reliable, observable, self-maintaining.
# ---------------------------------------------------------------------------


def load_helper(name, filename):
    """A hyphen-named helper under scripts/usage-export, loaded as a module."""
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


served = load_helper("served_check", "served-check.py")
fetcher = load_helper("bounded_fetch", "bounded-fetch.py")

MAX_LOG_BYTES = 5 * 1024 * 1024


class LogRotationTest(PushFixture, unittest.TestCase):
    """launchd appends to its two log files forever; the run rotates them."""

    def launchd_run(self, logs):
        """Run the push as the agent does: the log directory named in the
        environment, and stdout/stderr opened, appending, on the files."""
        env = {"HOME": os.environ.get("HOME", "/tmp")}
        env.update(self.env)
        env["NARANJO_USAGE_EXPORT_LOG_DIR"] = str(logs)
        with open(logs / "usage-export.log", "ab") as out, open(logs / "usage-export.err.log", "ab") as err:
            return subprocess.run(
                ["/bin/sh", str(PUSH)], stdout=out, stderr=err, env=env, stdin=subprocess.DEVNULL
            ).returncode

    def logs(self, out, err):
        logs = self.scratch / "logs"
        logs.mkdir()
        (logs / "usage-export.log").write_bytes(out)
        (logs / "usage-export.err.log").write_bytes(err)
        return logs

    def test_a_log_past_the_bound_is_renamed_and_the_run_writes_a_fresh_one(self):
        old_out = b"o" * (MAX_LOG_BYTES + 1)
        old_err = b"e" * MAX_LOG_BYTES
        logs = self.logs(old_out, old_err)
        (logs / "usage-export.log.1").write_bytes(b"the generation before\n")
        inode = (logs / "usage-export.log").stat().st_ino
        self.assertEqual(self.launchd_run(logs), 0)
        # Renamed, never truncated: the kept generation IS the old file (the
        # inode a held descriptor points at), whole, in place of the previous
        # one, and none of this run's lines landed in it — the run reopened
        # its stream on the fresh path.
        self.assertEqual((logs / "usage-export.log.1").stat().st_ino, inode)
        self.assertEqual((logs / "usage-export.log.1").read_bytes(), old_out)
        fresh = (logs / "usage-export.log").read_text(encoding="utf-8")
        self.assertTrue(fresh.startswith("usage-export: START export\n"), fresh[:80])
        self.assertIn("usage-export: SUMMARY pushed=", fresh)
        # Exactly at the bound is not past it.
        self.assertFalse((logs / "usage-export.err.log.1").exists())
        self.assertTrue((logs / "usage-export.err.log").read_bytes().startswith(old_err))

    def test_the_error_log_rotates_on_its_own(self):
        old_err = b"e" * (MAX_LOG_BYTES + 1)
        logs = self.logs(b"small\n", old_err)
        self.assertEqual(self.launchd_run(logs), 0)
        self.assertEqual((logs / "usage-export.err.log.1").read_bytes(), old_err)
        self.assertIn("coverage alpha=", (logs / "usage-export.err.log").read_text(encoding="utf-8"))
        self.assertFalse((logs / "usage-export.log.1").exists())
        self.assertTrue((logs / "usage-export.log").read_text(encoding="utf-8").startswith("small\n"))

    def test_a_run_without_the_agents_environment_rotates_nothing(self):
        big = b"o" * (MAX_LOG_BYTES + 1)
        logs = self.logs(big, big)
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sorted(path.name for path in logs.iterdir()),
                         ["usage-export.err.log", "usage-export.log"])
        self.assertEqual((logs / "usage-export.log").read_bytes(), big)


SITE = "https://panels.example"
PANEL_URL = SITE + "/api/panels/token-usage"
CHECK_NOW = datetime.datetime(2026, 10, 12, 12, 0, 0, tzinfo=datetime.timezone.utc)
PUSHED_CAPTURE = "2026-10-12T11:58:00Z"
RELEASE_INSTANT = "2026-09-11T17:20:26Z"


def at(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


class EnvelopeResponse:
    """What the bounded read sees: a body, and the URL it came from."""

    def __init__(self, document, url=PANEL_URL):
        self.body = json.dumps(document).encode("utf-8")
        self.url = url

    def read(self, size):
        return self.body[:size]

    def geturl(self):
        return self.url

    def __enter__(self):
        return self

    def __exit__(self, *unused):
        return False


class EnvelopeOpener:
    """An opener that answers once with what a test staged."""

    def __init__(self, answer, delay=0):
        self.answer = answer
        self.delay = delay
        self.requests = []
        self.timeouts = []

    def open(self, request, timeout=None):
        self.requests.append(request)
        self.timeouts.append(timeout)
        if self.delay:
            time.sleep(self.delay)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


class ServedCheckTest(unittest.TestCase):
    """SERVED or NOT-SERVED, from one public envelope and the recorded push."""

    def setUp(self):
        self.scratch = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.scratch, ignore_errors=True)
        self.state = self.scratch / "push-state.json"
        self.notified = []
        self.write_state()

    def write_state(self, **overrides):
        state = {
            "schema": "push-state/v2",
            "generatedAt": "2026-10-12T11:58:30Z",
            "capturedAt": {"alpha": PUSHED_CAPTURE},
            "oldestCapturedAt": PUSHED_CAPTURE,
            "sha256": "a" * 64,
            "pushedAt": "2026-10-12T11:59:00Z",
            "notServedSince": None,
            "notified": False,
        }
        state.update(overrides)
        self.state.write_text(json.dumps(state), encoding="utf-8")

    def read_state(self):
        return json.loads(self.state.read_text(encoding="utf-8"))

    def answer(self, status="ok", generated=PUSHED_CAPTURE, panel="token-usage", url=PANEL_URL):
        return EnvelopeResponse(
            {
                "schema": "panel/v1",
                "id": panel,
                "kind": "token-usage/v1",
                "title": "sentinel",
                "generatedAt": generated,
                "status": status,
                "data": {"sources": [{"label": "alpha", "capturedAt": generated}]},
            },
            url,
        )

    def check(self, answer, now=CHECK_NOW, site=SITE):
        self.opener = EnvelopeOpener(answer)
        return served.check(
            str(self.state), site, "abc123def456", now, self.opener, lambda: self.notified.append(now)
        )

    def http_error(self, code):
        error = urllib.error.HTTPError(PANEL_URL, code, "upstream prose", {}, io.BytesIO(b""))
        self.addCleanup(error.close)
        return error

    def test_an_ok_envelope_at_least_as_new_as_the_push_is_served(self):
        before = self.state.read_bytes()
        for generated in (PUSHED_CAPTURE, "2026-10-12T11:59:30Z"):
            with self.subTest(generated=generated):
                out, err = self.check(self.answer(generated=generated))
                self.assertEqual(out, ["usage-export: SERVED status=ok lag=60s"])
                self.assertEqual(err, [])
        # A quiet SERVED rewrites nothing.
        self.assertEqual(self.state.read_bytes(), before)
        # One request, the snapshot's own bounds, named as this job.
        self.assertEqual(len(self.opener.requests), 1)
        self.assertEqual(self.opener.requests[0].full_url, PANEL_URL)
        self.assertEqual(self.opener.timeouts, [served.snapshot.REQUEST_TIMEOUT_SECONDS])
        self.assertEqual(
            self.opener.requests[0].get_header("User-agent"), "naranjo-online-usage-export/abc123def456"
        )

    def test_a_stale_envelope_is_not_served(self):
        out, err = self.check(self.answer(status="stale"))
        self.assertEqual(out, [])
        self.assertEqual(
            err,
            [
                "usage-export: WARN NOT-SERVED status=stale served_at=%s expected_at>=%s sources_behind=0"
                " since_push=60s" % (PUSHED_CAPTURE, PUSHED_CAPTURE)
            ],
        )
        self.assertEqual(self.read_state()["notServedSince"], at(CHECK_NOW))
        self.assertEqual(self.notified, [])

    def test_an_ok_envelope_older_than_the_push_is_not_served(self):
        # The incident: the origin served its release snapshot, `ok`, while
        # every push was delivered and verified.
        out, err = self.check(self.answer(generated=RELEASE_INSTANT))
        self.assertEqual(out, [])
        self.assertEqual(
            err,
            [
                "usage-export: WARN NOT-SERVED status=ok served_at=%s expected_at>=%s sources_behind=1"
                " since_push=60s" % (RELEASE_INSTANT, PUSHED_CAPTURE)
            ],
        )
        # One second older than the recorded capture is already not served.
        out, err = self.check(self.answer(generated="2026-10-12T11:57:59Z"))
        self.assertEqual(out, [])
        self.assertEqual(len(err), 1)
        # Both bounds hold on their own: current sources under an envelope
        # instant older than the push are not served either.
        envelope = json.loads(self.answer().body)
        out, err = self.check(EnvelopeResponse(dict(envelope, generatedAt=RELEASE_INSTANT)))
        self.assertEqual(out, [])
        self.assertIn(" sources_behind=0 ", err[0])

    def pushed_document(self, generated, captures):
        path = self.scratch / "usage.json"
        path.write_text(
            json.dumps(
                {
                    "schema": "usage-series/v1",
                    "generatedAt": generated,
                    "sources": {key: {"capturedAt": instant} for key, instant in captures.items()},
                }
            ),
            encoding="utf-8",
        )
        return path

    def served_envelope(self, captures, status="ok"):
        """The envelope as a visitor's GET returns it: the oldest capture as
        its generatedAt, and each source's own capture instant beside it."""
        return EnvelopeResponse(
            {
                "schema": "panel/v1",
                "id": "token-usage",
                "kind": "token-usage/v2",
                "title": "sentinel",
                "generatedAt": min(captures.values()),
                "status": status,
                "data": {"sources": [{"label": key, "capturedAt": at} for key, at in captures.items()]},
            }
        )

    def test_an_older_document_sharing_the_oldest_capture_is_not_served(self):
        # Review F2: only the OLDEST capture was compared, so the document
        # pushed before the last one passed whenever its oldest source equalled
        # the last one's — the ordinary case of one source moving on.
        old = {"alpha": "2026-10-12T11:58:00Z", "beta": "2026-10-12T11:58:00Z"}
        new = {"alpha": "2026-10-12T11:58:00Z", "beta": "2026-10-12T11:59:00Z"}
        outage = at(CHECK_NOW - datetime.timedelta(minutes=20))
        self.write_state(notServedSince=outage, notified=True)
        served.record(
            str(self.state), str(self.pushed_document("2026-10-12T11:59:30Z", new)), "b" * 64,
            CHECK_NOW - datetime.timedelta(minutes=1),
        )
        for answer in (
            self.served_envelope(old),
            # A source the page does not serve at all is not served either.
            self.served_envelope({"alpha": new["alpha"]}),
        ):
            with self.subTest(body=answer.body):
                out, err = self.check(answer)
                self.assertEqual(out, [])
                self.assertEqual(
                    err,
                    [
                        "usage-export: WARN NOT-SERVED status=ok served_at=2026-10-12T11:58:00Z"
                        " expected_at>=2026-10-12T11:58:00Z sources_behind=1 since_push=60s"
                    ],
                )
                # The outage latch holds: only a SERVED clears it.
                state = self.read_state()
                self.assertEqual((state["notServedSince"], state["notified"]), (outage, True))
        # The pushed document itself is served, and only that ends the outage.
        out, err = self.check(self.served_envelope(new))
        self.assertEqual(
            out, ["usage-export: SERVED status=ok lag=60s", "usage-export: RECOVERED served after 1200s"]
        )
        self.assertEqual(err, [])

    def test_a_served_source_without_its_capture_is_behind(self):
        # Review F2 r2: a source that keeps its label but carries no capture
        # instant is not served, however fresh the envelope's own instant;
        # nothing stands in for the instant it does not carry.
        outage = at(CHECK_NOW - datetime.timedelta(minutes=20))
        self.write_state(notServedSince=outage, notified=True)
        envelope = json.loads(self.answer().body)
        del envelope["data"]["sources"][0]["capturedAt"]
        self.assertEqual(envelope["generatedAt"], PUSHED_CAPTURE)
        out, err = self.check(EnvelopeResponse(envelope))
        self.assertEqual(out, [])
        self.assertEqual(
            err,
            [
                "usage-export: WARN NOT-SERVED status=ok served_at=%s expected_at>=%s sources_behind=1"
                " since_push=60s" % (PUSHED_CAPTURE, PUSHED_CAPTURE)
            ],
        )
        state = self.read_state()
        self.assertEqual((state["notServedSince"], state["notified"]), (outage, True))

    def test_one_notification_after_fifteen_minutes_and_never_again(self):
        stale = lambda: self.answer(generated=RELEASE_INSTANT)  # noqa: E731
        minute = datetime.timedelta(minutes=1)
        self.check(stale())
        self.check(stale(), CHECK_NOW + 15 * minute)
        self.assertEqual(self.notified, [], "fifteen minutes is not longer than fifteen minutes")
        later = CHECK_NOW + 15 * minute + datetime.timedelta(seconds=1)
        self.check(stale(), later)
        self.assertEqual(self.notified, [later])
        self.assertTrue(self.read_state()["notified"])
        for step in (16, 30, 600):
            self.check(stale(), CHECK_NOW + step * minute)
        self.assertEqual(self.notified, [later], "a notification repeated without a SERVED between")
        self.assertEqual(self.read_state()["notServedSince"], at(CHECK_NOW))

    def test_a_push_does_not_restart_the_not_served_clock(self):
        # A push lands every minute; if recording it reset the clock, fifteen
        # minutes of NOT-SERVED could never accumulate and nothing would ever
        # be raised — the incident exactly.
        self.write_state(notServedSince=at(CHECK_NOW), notified=True)
        document = self.scratch / "usage.json"
        document.write_text(
            json.dumps(
                {
                    "schema": "usage-series/v1",
                    "generatedAt": "2026-10-12T12:05:00Z",
                    "sources": {
                        "alpha": {"capturedAt": "2026-10-12T12:05:00Z"},
                        "beta": {"capturedAt": "2026-10-12T12:03:10Z"},
                    },
                }
            ),
            encoding="utf-8",
        )
        pushed = CHECK_NOW + datetime.timedelta(minutes=6)
        served.record(str(self.state), str(document), "b" * 64, pushed)
        state = self.read_state()
        self.assertEqual(
            state,
            {
                "schema": "push-state/v2",
                "generatedAt": "2026-10-12T12:05:00Z",
                "capturedAt": {"alpha": "2026-10-12T12:05:00Z", "beta": "2026-10-12T12:03:10Z"},
                "oldestCapturedAt": "2026-10-12T12:03:10Z",
                "sha256": "b" * 64,
                "pushedAt": at(pushed),
                "notServedSince": at(CHECK_NOW),
                "notified": True,
            },
        )
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o600)

    def test_served_again_logs_recovered_and_rearms_the_notification(self):
        self.write_state(notServedSince=at(CHECK_NOW - datetime.timedelta(minutes=20)), notified=True)
        out, err = self.check(self.answer())
        self.assertEqual(
            out,
            ["usage-export: SERVED status=ok lag=60s", "usage-export: RECOVERED served after 1200s"],
        )
        self.assertEqual(err, [])
        state = self.read_state()
        self.assertIsNone(state["notServedSince"])
        self.assertFalse(state["notified"])
        # A later outage is a new transition, and it is announced again.
        self.check(self.answer(status="stale"), CHECK_NOW + datetime.timedelta(minutes=1))
        self.check(self.answer(status="stale"), CHECK_NOW + datetime.timedelta(minutes=17))
        self.assertEqual(len(self.notified), 1)
        # And a SERVED with nothing outstanding recovers nothing.
        self.write_state()
        out, _ = self.check(self.answer())
        self.assertEqual(out, ["usage-export: SERVED status=ok lag=60s"])

    def test_a_failed_fetch_is_one_warning_and_one_attempt(self):
        before = self.state.read_bytes()
        for answer, reason in (
            (urllib.error.URLError(ConnectionRefusedError("private-looking detail")), "unreachable"),
            (urllib.error.URLError(TimeoutError("private-looking detail")), "timeout"),
            (self.http_error(503), "http-503"),
            (self.http_error(530), "http-530"),
            (self.http_error(404), "http-404"),
        ):
            with self.subTest(reason=reason):
                out, err = self.check(answer)
                self.assertEqual(out, [])
                self.assertEqual(err, ["usage-export: WARN served-check unavailable reason=%s" % reason])
                # No retry: the check runs at the start of a run every minute.
                self.assertEqual(len(self.opener.requests), 1)
        self.assertEqual(self.state.read_bytes(), before)

    def test_a_redirect_another_host_or_a_bad_site_is_refused(self):
        for answer, site, reason, requests in (
            (self.http_error(302), SITE, "redirected", 1),
            (self.answer(url="https://elsewhere.example/api/panels/token-usage"), SITE, "host-mismatch", 1),
            (self.answer(), "http://panels.example", "bad-site", 0),
            (self.answer(), "https://panels.example/somewhere", "bad-site", 0),
        ):
            with self.subTest(reason=reason, site=site):
                out, err = self.check(answer, site=site)
                self.assertEqual((out, err), ([], ["usage-export: WARN served-check unavailable reason=%s" % reason]))
                self.assertEqual(len(self.opener.requests), requests)

    def test_nothing_recorded_is_reported_and_nothing_is_fetched(self):
        self.state.unlink()
        out, err = self.check(self.answer())
        self.assertEqual(err, ["usage-export: WARN served-check unavailable reason=no-push-state"])
        self.assertEqual(self.opener.requests, [])
        out, err = served.check("", SITE, "x", CHECK_NOW, self.opener, self.notified.append)
        self.assertEqual(err, ["usage-export: WARN served-check unavailable reason=no-push-state"])
        self.assertEqual(self.opener.requests, [])

    def test_a_malformed_state_or_envelope_is_reported_not_judged(self):
        self.state.write_text("{not json", encoding="utf-8")
        _, err = self.check(self.answer())
        self.assertEqual(err, ["usage-export: WARN served-check unavailable reason=state-unreadable"])
        for broken in (
            {"oldestCapturedAt": "yesterday"},
            {"capturedAt": None},
            {"capturedAt": {}},
            {"capturedAt": {"alpha": "yesterday"}},
        ):
            with self.subTest(state=broken):
                self.write_state(**broken)
                with self.assertRaises(served.Unavailable):
                    served.read_state(str(self.state))
                _, err = self.check(self.answer())
                self.assertEqual(err, ["usage-export: WARN served-check unavailable reason=state-unreadable"])
        self.write_state()
        envelope = json.loads(self.answer().body)
        for answer in (
            self.answer(panel="vcs-activity"),
            self.answer(generated="not an instant"),
            EnvelopeResponse({"schema": "panel/v2"}),
            EnvelopeResponse([1, 2]),
            EnvelopeResponse(dict(envelope, data={})),
            EnvelopeResponse(dict(envelope, data={"sources": [None]})),
            EnvelopeResponse(dict(envelope, data={"sources": [{"label": 7, "capturedAt": PUSHED_CAPTURE}]})),
            # One source served twice cannot say which capture the page shows.
            EnvelopeResponse(dict(envelope, data={"sources": envelope["data"]["sources"] * 2})),
        ):
            with self.subTest(body=answer.body[:40]):
                out, err = self.check(answer)
                self.assertEqual((out, err), ([], ["usage-export: WARN served-check unavailable reason=malformed-envelope"]))

    def test_a_state_from_before_per_source_instants_is_never_judged(self):
        # Without the per-source instants there is nothing the stronger check
        # can compare, so the check declines; the next push records them and
        # carries the outage latch across, rather than clearing it unserved.
        outage = at(CHECK_NOW - datetime.timedelta(minutes=20))
        earlier = json.loads(json.dumps(self.read_state()))
        earlier.update(schema="push-state/v1", notServedSince=outage, notified=True)
        del earlier["capturedAt"]
        self.state.write_text(json.dumps(earlier), encoding="utf-8")
        # An unreachable site: were the state judged, the request would be
        # made and fail first.
        out, err = self.check(urllib.error.URLError(ConnectionRefusedError("refused")))
        self.assertEqual((out, err), ([], ["usage-export: WARN served-check unavailable reason=state-outdated"]))
        self.assertEqual(self.opener.requests, [])
        served.record(
            str(self.state), str(self.pushed_document(PUSHED_CAPTURE, {"alpha": PUSHED_CAPTURE})), "c" * 64, CHECK_NOW
        )
        state = self.read_state()
        self.assertEqual(state["schema"], "push-state/v2")
        self.assertEqual(state["capturedAt"], {"alpha": PUSHED_CAPTURE})
        self.assertEqual((state["notServedSince"], state["notified"]), (outage, True))

    def test_the_status_word_never_carries_upstream_text(self):
        _, err = self.check(self.answer(status="stale\nusage-export: SUMMARY pushed=1B"))
        self.assertEqual(len(err), 1)
        self.assertIn(" status=unrecognised ", err[0])
        self.assertNotIn("SUMMARY", err[0])

    def test_a_clock_behind_the_recorded_outage_restarts_it_rather_than_notifying(self):
        self.write_state(notServedSince=at(CHECK_NOW + datetime.timedelta(days=30)))
        self.check(self.answer(status="stale"))
        self.assertEqual(self.read_state()["notServedSince"], at(CHECK_NOW))
        self.assertEqual(self.notified, [])

    def test_main_never_fails_and_bounds_the_whole_check(self):
        # A dripping answer is bounded only per socket read by the fetch's own
        # timeout; the check holds one whole-run deadline over it.
        slow = EnvelopeOpener(self.answer(), delay=5)
        started = time.monotonic()
        with (
            mock.patch.object(served, "DEADLINE_SECONDS", 1),
            mock.patch.object(served.snapshot, "build_opener", lambda: slow),
            contextlib.redirect_stdout(io.StringIO()) as out,
            contextlib.redirect_stderr(io.StringIO()) as err,
        ):
            status = served.main(
                ["check", "--state", str(self.state), "--site", SITE, "--exporter", "abc1234"]
            )
        self.assertEqual(status, 0)
        self.assertLess(time.monotonic() - started, 4)
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue(), "usage-export: WARN served-check unavailable reason=deadline-exceeded\n")
        # record's faults are warnings with exit status 0 as well.
        with contextlib.redirect_stderr(io.StringIO()) as err:
            status = served.main(
                ["record", "--state", str(self.state), "--document", str(self.scratch / "absent"),
                 "--sha256", "c" * 64]
            )
        self.assertEqual(status, 0)
        self.assertEqual(err.getvalue(), "usage-export: WARN push-state unrecorded reason=document-unreadable\n")
        with contextlib.redirect_stderr(io.StringIO()) as err:
            served.main(["record", "--state", str(self.state), "--document", str(self.state),
                         "--sha256", "NOT-A-DIGEST"])
        self.assertIn("reason=checksum-malformed", err.getvalue())

    def test_the_notification_is_fixed_text_and_an_absent_facility_is_silent(self):
        empty = self.scratch / "empty-path"
        empty.mkdir()
        with mock.patch.dict(os.environ, {"PATH": str(empty)}):
            self.assertIsNone(served.notify_desktop())
        stubs = self.scratch / "stubs"
        stubs.mkdir()
        calls = self.scratch / "osascript-calls"
        write_executable(
            stubs / "osascript",
            "#!/bin/sh\nfor arg in \"$@\"; do printf '%%s\\n' \"$arg\"; done > %s\n" % calls,
        )
        with mock.patch.dict(os.environ, {"PATH": str(stubs)}):
            served.notify_desktop()
        self.assertEqual(calls.read_text(encoding="utf-8"), "-e\n%s\n" % served.NOTIFICATION)
        # Payload-free: no instant, no digest, no status from the wire.
        self.assertNotRegex(served.NOTIFICATION, r"\d{4}-\d{2}-\d{2}|[0-9a-f]{12}")


class ServedCheckPipelineTest(PushFixture, unittest.TestCase):
    """The push records what it delivered, and the next run checks it."""

    def test_a_push_records_its_state_and_the_next_run_checks_without_failing(self):
        history = self.scratch / "history"
        # Loopback port 1 refuses at once: the check fails exactly as an
        # unreachable site does, with no host beyond this machine involved.
        self.write_config(HISTORY_DIR=str(history), SITE_URL="https://127.0.0.1:1")
        first = run_script(PUSH, env=self.env)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertIn("usage-export: WARN served-check unavailable reason=no-push-state", first.stderr)
        state_file = history / "push-state.json"
        self.assertEqual(stat.S_IMODE(state_file.stat().st_mode), 0o600)
        state = json.loads(state_file.read_text(encoding="utf-8"))
        summary = first.stdout.splitlines()[-1]
        self.assertTrue(summary.startswith("usage-export: SUMMARY pushed="), summary)
        self.assertEqual(state["sha256"][:12], summary.split("sha256=")[1].split()[0])
        self.assertLessEqual(state["oldestCapturedAt"], state["generatedAt"])
        # The walked source is stamped with the export instant, which is how
        # the per-source check binds that instant at all: the envelope serves
        # capture instants, never the document's own.
        self.assertEqual(state["capturedAt"], {"alpha": state["generatedAt"]})
        self.assertEqual((state["notServedSince"], state["notified"]), (None, False))
        second = run_script(PUSH, env=self.env)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertIn("usage-export: WARN served-check unavailable reason=unreachable", second.stderr)
        # The check happens first, and the push still happens after it.
        self.assertTrue(second.stdout.splitlines()[-1].startswith("usage-export: SUMMARY pushed="))

    def test_no_configured_site_runs_no_check_but_still_records(self):
        history = self.scratch / "history"
        self.write_config(HISTORY_DIR=str(history))
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("served-check", result.stdout + result.stderr)
        self.assertNotIn("SERVED", result.stdout + result.stderr)
        self.assertTrue((history / "push-state.json").is_file())

    def test_no_history_directory_records_nothing(self):
        self.write_config(SITE_URL="https://127.0.0.1:1")
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("reason=no-push-state", result.stderr)

    def test_a_broken_helper_is_a_warning_and_never_the_push(self):
        # The helper never exits non-zero by design; the push script does not
        # rely on that. A checkout whose helper cannot even start still pushes.
        checkout = self.scratch / "checkout"
        shutil.copytree(
            REPO_ROOT / "scripts", checkout / "scripts",
            ignore=shutil.ignore_patterns("ci", "__pycache__"),
        )
        shutil.copytree(REPO_ROOT / "internal/panels/config", checkout / "internal/panels/config")
        (checkout / "scripts/usage-export/served-check.py").write_text(
            "raise SystemExit(3)\n", encoding="utf-8"
        )
        history = self.scratch / "history"
        self.write_config(REPO_DIR=str(checkout), HISTORY_DIR=str(history), SITE_URL="https://127.0.0.1:1")
        result = run_script(PUSH, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("usage-export: WARN served-check unavailable reason=helper-failed", result.stderr)
        self.assertIn("usage-export: WARN push-state unrecorded reason=helper-failed", result.stderr)
        self.assertTrue(result.stdout.splitlines()[-1].startswith("usage-export: SUMMARY pushed="))


# A pinned, private git for the throwaway repositories: no user or system
# configuration (signing, hooks, aliases) reaches them.
FIXTURE_GIT_ENV = {
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_AUTHOR_NAME": "Fixture",
    "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
    "GIT_COMMITTER_NAME": "Fixture",
    "GIT_COMMITTER_EMAIL": "fixture@example.invalid",
}


@unittest.skipIf(shutil.which("git") is None, "no git on this host")
class RepoUpdateTest(PushFixture, unittest.TestCase):
    """Checkout drift, detected and repaired by fast-forward only."""

    def setUp(self):
        super().setUp()
        self.env.update(FIXTURE_GIT_ENV)
        self.origin = self.scratch / "origin.git"
        seed = self.scratch / "seed"
        self.checkout = self.scratch / "checkout"
        self.git(self.scratch, "init", "--quiet", "--bare", "--initial-branch=main", str(self.origin))
        # A checkout that can run the whole pipeline: the scripts and the
        # vocabulary files the producers read.
        shutil.copytree(
            REPO_ROOT / "scripts", seed / "scripts",
            ignore=shutil.ignore_patterns("ci", "__pycache__"),
        )
        shutil.copytree(REPO_ROOT / "internal/panels/config", seed / "internal/panels/config")
        (seed / "NOTE").write_text("one\n", encoding="utf-8")
        self.git(seed, "init", "--quiet", "--initial-branch=main")
        self.git(seed, "add", "-A")
        self.git(seed, "commit", "--quiet", "-m", "first")
        self.git(seed, "remote", "add", "origin", str(self.origin))
        self.git(seed, "push", "--quiet", "origin", "main")
        self.git(self.scratch, "clone", "--quiet", str(self.origin), str(self.checkout))
        self.first = self.head()
        # The commit the checkout falls behind: a changed NOTE, and a push
        # script that announces itself, so the re-executed run is visible.
        script = seed / "scripts/usage-export/push-usage-series.sh"
        script.write_text(
            script.read_text(encoding="utf-8").replace(
                "set -eu\n", "set -eu\necho 'usage-export: FIXTURE second-generation'\n", 1
            ),
            encoding="utf-8",
        )
        (seed / "NOTE").write_text("two\n", encoding="utf-8")
        self.git(seed, "commit", "--quiet", "-am", "second")
        self.git(seed, "push", "--quiet", "origin", "main")
        self.second = self.git(seed, "rev-parse", "HEAD")
        self.history = self.scratch / "history"
        self.write_config(REPO_DIR=str(self.checkout), HISTORY_DIR=str(self.history), REPO_UPDATE=None)

    def write_config(self, **overrides):
        values = dict(self.config_lines)
        values.update(overrides)
        self.config.write_text(
            "".join("%s=%s\n" % pair for pair in values.items() if pair[1] is not None),
            encoding="utf-8",
        )
        self.config.chmod(0o600)

    def git(self, cwd, *args, index=None):
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), **FIXTURE_GIT_ENV}
        if index is not None:
            env["GIT_INDEX_FILE"] = str(index)
        result = subprocess.run(
            ["git", "-c", "commit.gpgsign=false", *args],
            cwd=cwd, capture_output=True, text=True, env=env,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def head(self):
        return self.git(self.checkout, "rev-parse", "HEAD")

    def push(self, **extra):
        env = dict(self.env)
        env.update(extra)
        return run_script(self.checkout / "scripts/usage-export/push-usage-series.sh", env=env)

    def summary_revision(self, result):
        return result.stdout.splitlines()[-1].split("exporter=")[1].split()[0]

    def stand_in_fetch(self, *commands):
        """The checkout's bounded fetch, replaced by one that fetches and then
        runs `commands` in the checkout: another actor at work there while the
        job waits on the network."""
        (self.checkout / "scripts/usage-export/bounded-fetch.py").write_text(
            "import subprocess, sys\n"
            "subprocess.run(['git', '-C', sys.argv[1], 'fetch', '--quiet', 'origin', 'main'], check=True)\n"
            "for command in %r:\n"
            "    subprocess.run(['git', '-C', sys.argv[1], *command], check=True)\n" % (commands,),
            encoding="utf-8",
        )

    def git_shim(self, mode, target=""):
        """A `git` ahead of the real one on the job's PATH. Its one act is on
        `update-ref`: `too-old` answers as a git without the transaction
        protocol; `refuse` and `refuse-and-edit` fail the job's transaction
        without moving a ref (the second also editing NOTE first);
        `lose-commit` prepares and then dies on the commit without making it;
        the others
        act as another actor would, just before the job takes the index lock
        (`diverge`, `catch-up`) or while it holds that lock and is about to
        move the ref (`retarget-head`, `move-main`)."""
        write_executable(
            self.stub_dir / "git",
            "#!/bin/sh\n"
            # `barrier`: the first read-tree really runs, then holds until the
            # test releases it, so a signal can land after it has written.
            'if [ "$SHIM_MODE" = barrier ] && [ "$3" = read-tree ] && [ ! -e "$SHIM_TARGET.reached" ]; then\n'
            '  "$REAL_GIT" "$@"; status=$?\n'
            '  : > "$SHIM_TARGET.reached"\n'
            "  i=0\n"
            '  while [ ! -e "$SHIM_TARGET.release" ] && [ "$i" -lt 1200 ]; do sleep 0.05; i=$((i + 1)); done\n'
            '  exit "$status"\n'
            "fi\n"
            'if [ "$3" = update-ref ]; then\n'
            '  locked=no; [ -f "$2/.git/index.lock" ] && locked=yes\n'
            '  case "$SHIM_MODE-$locked" in\n'
            "    too-old-*) echo 'fatal: unknown command: start' >&2; exit 128 ;;\n"
            '    diverge-no) "$REAL_GIT" -C "$2" update-ref refs/heads/main'
            ' "$("$REAL_GIT" -C "$2" commit-tree -p HEAD -m local "HEAD^{tree}")" ;;\n'
            '    catch-up-no) "$REAL_GIT" -C "$2" merge --ff-only --quiet refs/remotes/origin/main ;;\n'
            '    retarget-head-yes) "$REAL_GIT" -C "$2" symbolic-ref HEAD refs/heads/concurrent-owner-branch ;;\n'
            '    move-main-yes) "$REAL_GIT" -C "$2" update-ref refs/heads/main "$SHIM_TARGET" ;;\n'
            '    move-main-elsewhere-yes) "$REAL_GIT" -C "$2" update-ref refs/heads/main'
            ' "$("$REAL_GIT" -C "$2" commit-tree -p HEAD -m elsewhere "HEAD^{tree}")" ;;\n'
            "    refuse-yes) exit 128 ;;\n"
            # A git that prepares, then dies on the commit without making it.
            "    lose-commit-yes)\n"
            '      while read -r line; do\n'
            '        case "$line" in start) echo "start: ok" ;; prepare) echo "prepare: ok" ;; commit) exit 1 ;; esac\n'
            "      done\n"
            "      exit 1 ;;\n"
            '    refuse-and-edit-yes) echo edited > "$2/NOTE"; exit 128 ;;\n'
            "  esac\n"
            "fi\n"
            'exec "$REAL_GIT" "$@"\n',
        )
        self.env.update(REAL_GIT=shutil.which("git"), SHIM_MODE=mode, SHIM_TARGET=target)

    def assert_no_residue(self):
        gitdir = self.checkout / ".git"
        self.assertEqual(sorted(path.name for path in gitdir.glob("*.lock")), [])
        self.assertEqual(sorted(path.name for path in gitdir.glob("index.*")), [])

    def assert_agreement(self, commit):
        """main, the index and the worktree all name `commit`, with no lock."""
        self.assertEqual(self.git(self.checkout, "rev-parse", "main"), commit)
        self.assertEqual(self.git(self.checkout, "rev-parse", ":NOTE"), self.git(self.checkout, "rev-parse", commit + ":NOTE"))
        self.assertEqual(self.git(self.checkout, "status", "--porcelain", "--untracked-files=no"), "")
        self.assert_no_residue()

    def assert_stopped_before_export(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertRegex(result.stderr, r"usage-export: FAILED stage=repo-update elapsed=\d+s")
        self.assertNotIn("SUMMARY", result.stdout)
        self.assertNotIn("START export", result.stdout)
        self.assertFalse(self.args_file.exists())

    def test_a_checkout_strictly_behind_is_fast_forwarded_and_re_executed_once(self):
        # A file touched but not changed leaves the index's stat data stale;
        # like a merge, the fast-forward refreshes it rather than refusing.
        an_hour_ago = time.time() - 3600
        os.utime(self.checkout / "NOTE", (an_hour_ago, an_hour_ago))
        result = self.push()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.head(), self.second)
        self.assertEqual(
            [line for line in result.stdout.splitlines() if "UPDATED" in line],
            ["usage-export: UPDATED exporter %s->%s" % (self.first[:12], self.second[:12])],
        )
        # The NEW script ran, exactly once, and the run it finished reports
        # the new tree.
        self.assertEqual(result.stdout.count("usage-export: FIXTURE second-generation"), 1)
        self.assertEqual(self.summary_revision(result), self.second[:12])
        self.assertEqual((self.checkout / "NOTE").read_text(encoding="utf-8"), "two\n")
        # The checkout is shared: what the merge rewrites keeps the ordinary
        # mode rather than the run's private umask.
        self.assertEqual((self.checkout / "NOTE").stat().st_mode & 0o777, 0o644)
        self.assertEqual((self.checkout / ".git/index").stat().st_mode & 0o777, 0o644)
        self.assertRegex((self.history / "repo-update.stamp").read_text(encoding="utf-8"), r"^\d+\n$")
        self.assertNotIn("DRIFT", result.stderr)
        # The index the job installed is the one git reads: nothing staged,
        # nothing modified, and no lock or private copy left behind.
        self.assertEqual(self.git(self.checkout, "status", "--porcelain", "--untracked-files=no"), "")
        self.assert_no_residue()

    def test_the_re_executed_run_never_updates_again(self):
        # The guard the re-exec sets: with it present the whole step is
        # skipped, so a second fast-forward — and so a loop — is impossible.
        result = self.push(NARANJO_USAGE_EXPORT_REEXEC="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.head(), self.first)
        self.assertNotIn("UPDATED", result.stdout)
        self.assertNotIn("DRIFT", result.stderr)
        self.assertFalse((self.history / "repo-update.stamp").exists())

    def test_a_local_edit_the_merge_would_touch_is_left_exactly_as_it_is(self):
        (self.checkout / "NOTE").write_text("a local edit\n", encoding="utf-8")
        (self.checkout / "untracked-notes").write_text("mine\n", encoding="utf-8")
        result = self.push()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(
            "usage-export: WARN DRIFT behind=1 ahead=0 action=none reason=merge-refused", result.stderr
        )
        self.assertEqual(self.head(), self.first)
        self.assertEqual((self.checkout / "NOTE").read_text(encoding="utf-8"), "a local edit\n")
        self.assertEqual((self.checkout / "untracked-notes").read_text(encoding="utf-8"), "mine\n")
        self.assertEqual(self.git(self.checkout, "stash", "list"), "")
        self.assertNotIn("UPDATED", result.stdout)
        # The run went on, on the tree it had.
        self.assertEqual(self.summary_revision(result), self.first[:12])

    def test_off_reports_drift_and_neither_fetches_nor_moves(self):
        self.write_config(REPO_DIR=str(self.checkout), HISTORY_DIR=str(self.history), REPO_UPDATE="off")
        result = self.push()
        self.assertEqual(result.returncode, 0, result.stderr)
        # No fetch under off: origin/main is still the tree it was cloned at.
        self.assertFalse((self.history / "repo-update.stamp").exists())
        self.assertNotIn("DRIFT", result.stderr)
        self.git(self.checkout, "fetch", "--quiet", "origin")
        result = self.push()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("usage-export: WARN DRIFT behind=1 ahead=0 action=none reason=off", result.stderr)
        self.assertEqual(self.head(), self.first)
        self.assertNotIn("UPDATED", result.stdout)

    def test_an_unknown_update_mode_refuses_the_run(self):
        for value in ("rebase", "on", "ff_only", "FF-ONLY"):
            with self.subTest(value=value):
                self.write_config(REPO_DIR=str(self.checkout), HISTORY_DIR=str(self.history), REPO_UPDATE=value)
                self.args_file.unlink(missing_ok=True)
                result = self.push()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("REPO_UPDATE must be ff-only or off", result.stderr)
                self.assertRegex(result.stderr, r"usage-export: FAILED stage=configure elapsed=\d+s")
                self.assertFalse(self.args_file.exists())
                self.assertEqual(self.head(), self.first)

    def test_a_diverged_detached_or_other_branch_checkout_is_reported_and_kept(self):
        self.git(self.checkout, "fetch", "--quiet", "origin")
        (self.checkout / "LOCAL").write_text("local\n", encoding="utf-8")
        self.git(self.checkout, "add", "LOCAL")
        self.git(self.checkout, "commit", "--quiet", "-m", "local")
        local = self.head()
        result = self.push()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("usage-export: WARN DRIFT behind=1 ahead=1 action=none reason=diverged", result.stderr)
        self.assertEqual(self.head(), local)
        self.git(self.checkout, "checkout", "--quiet", "--detach", self.first)
        result = self.push()
        self.assertIn("usage-export: WARN DRIFT behind=1 ahead=0 action=none reason=detached", result.stderr)
        self.assertEqual(self.head(), self.first)
        self.git(self.checkout, "checkout", "--quiet", "-b", "other")
        result = self.push()
        self.assertIn("usage-export: WARN DRIFT behind=1 ahead=0 action=none reason=not-main", result.stderr)
        self.assertEqual(self.head(), self.first)
        self.assertEqual(self.git(self.checkout, "rev-parse", "--abbrev-ref", "HEAD"), "other")

    def test_a_branch_switched_during_the_fetch_is_never_advanced(self):
        # Review F1: the branch was read before the fetch, and the merge then
        # advanced whatever HEAD named once the fetch returned.
        self.stand_in_fetch(["checkout", "--quiet", "-b", "concurrent-owner-branch"])
        result = self.push()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("UPDATED", result.stdout)
        self.assertIn("usage-export: WARN DRIFT behind=1 ahead=0 action=none reason=not-main", result.stderr)
        self.assertEqual(self.git(self.checkout, "rev-parse", "concurrent-owner-branch"), self.first)
        self.assertEqual(self.git(self.checkout, "rev-parse", "main"), self.first)
        self.assertEqual(self.git(self.checkout, "symbolic-ref", "HEAD"), "refs/heads/concurrent-owner-branch")
        self.assertEqual((self.checkout / "NOTE").read_text(encoding="utf-8"), "one\n")
        self.assertEqual(self.summary_revision(result), self.first[:12])
        self.assert_no_residue()

    def test_another_git_operation_in_progress_is_left_alone(self):
        lock = self.checkout / ".git/index.lock"
        lock.write_bytes(b"another operation\n")
        result = self.push()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("usage-export: WARN DRIFT behind=1 ahead=0 action=none reason=busy", result.stderr)
        self.assertNotIn("UPDATED", result.stdout)
        # Never deleted or rewritten: it is another operation's, not the job's.
        self.assertTrue(lock.is_file())
        self.assertEqual(lock.read_bytes(), b"another operation\n")
        self.assertEqual(self.head(), self.first)
        self.assertEqual((self.checkout / "NOTE").read_text(encoding="utf-8"), "one\n")
        self.assertFalse((self.checkout / ".git/index.job").exists())

    def assert_kept_lock_holds(self, commit):
        """The kept lock is a whole index of `commit`: recovery material."""
        lock = self.checkout / ".git/index.lock"
        self.assertTrue(lock.is_file())
        self.git(self.checkout, "diff-index", "--cached", "--quiet", commit, index=lock)

    def assert_rolled_back_and_stopped(self, result):
        """The job undid what it wrote and stopped: a ref moved under it, so
        HEAD may name a commit whose files the worktree does not hold."""
        self.assertIn(
            "usage-export: WARN DRIFT behind=1 ahead=0 action=rolled-back reason=ref-moved", result.stderr
        )
        self.assertIn("a ref moved under the update", result.stderr)
        self.assertNotIn("UPDATED", result.stdout)
        self.assert_stopped_before_export(result)
        self.assertEqual((self.checkout / "NOTE").read_text(encoding="utf-8"), "one\n")
        self.assertEqual(self.git(self.checkout, "rev-parse", ":NOTE"), self.git(self.checkout, "rev-parse", self.first + ":NOTE"))
        self.assert_no_residue()

    def test_a_refused_ref_update_rolls_the_worktree_back_and_stops(self):
        # The transaction never prepares: nothing is installed, the worktree the
        # job had advanced goes back, and the run stops without exporting.
        self.git_shim("refuse")
        result = self.push()
        self.assert_rolled_back_and_stopped(result)
        self.assert_agreement(self.first)

    def test_head_retargeted_before_the_transaction_is_rolled_back_and_stops(self):
        # Plumbing takes no index lock, so it can retarget HEAD before the
        # transaction prepares. Prepare then holds HEAD's lock, the verify finds
        # HEAD naming another branch, the transaction is aborted and the
        # worktree goes back: that branch is never advanced, and nothing is
        # exported under its name.
        self.git(self.checkout, "branch", "concurrent-owner-branch")
        self.git_shim("retarget-head")
        result = self.push()
        self.assert_rolled_back_and_stopped(result)
        self.assertEqual(self.git(self.checkout, "symbolic-ref", "HEAD"), "refs/heads/concurrent-owner-branch")
        self.assertEqual(self.git(self.checkout, "rev-parse", "concurrent-owner-branch"), self.first)
        self.assertEqual(self.git(self.checkout, "rev-parse", "main"), self.first)

    def test_main_moved_before_the_transaction_is_rolled_back_and_stops(self):
        # Another actor moved main by plumbing before the transaction
        # prepared: the old value refuses it, nothing is installed, and the
        # worktree goes back to the tree it had. main stays where they put it,
        # so its commit and the worktree's files differ, and nothing is
        # exported.
        for mode in ("move-main", "move-main-elsewhere"):
            with self.subTest(mode=mode):
                self.git(self.checkout, "update-ref", "refs/heads/main", self.first)
                (self.history / "repo-update.stamp").unlink(missing_ok=True)
                self.args_file.unlink(missing_ok=True)
                self.git_shim(mode, self.second)
                result = self.push()
                self.assert_rolled_back_and_stopped(result)
                self.assertEqual(self.git(self.checkout, "symbolic-ref", "HEAD"), "refs/heads/main")
                self.assertEqual(self.git(self.checkout, "rev-parse", "main^"), self.first)
                if mode == "move-main":
                    self.assertEqual(self.git(self.checkout, "rev-parse", "main"), self.second)
                else:
                    self.assertNotIn(self.git(self.checkout, "rev-parse", "main"), (self.first, self.second))

    def test_a_rollback_that_cannot_run_keeps_its_recovery_index_and_stops(self):
        # An edit made in that window cannot be rolled back over. It is kept,
        # the lock keeps the NEW index it guards (git reports the stale lock
        # until someone decides), and nothing is exported.
        self.git_shim("refuse-and-edit")
        result = self.push()
        self.assertIn(
            "usage-export: WARN DRIFT behind=1 ahead=0 action=incomplete reason=rollback-failed", result.stderr
        )
        self.assert_stopped_before_export(result)
        self.assertEqual(self.git(self.checkout, "rev-parse", "main"), self.first)
        self.assertEqual((self.checkout / "NOTE").read_text(encoding="utf-8"), "edited\n")
        self.assertEqual(self.git(self.checkout, "rev-parse", ":NOTE"), self.git(self.checkout, "rev-parse", self.first + ":NOTE"))
        self.assert_kept_lock_holds(self.second)

    def transaction_barrier(self, *phases):
        """A reference-transaction hook (the review's probe) that holds the
        job's update of main at each of `phases` until released, once per
        phase, and names the git process it runs under."""
        write_executable(
            self.checkout / ".git/hooks/reference-transaction",
            "#!/bin/sh\n"
            'ready="%s/hook-$1.ready" release="%s/hook-$1.release"\n'
            'case " %s " in *" $1 "*) ;; *) exit 0 ;; esac\n'
            '[ -e "$ready" ] && exit 0\n'
            "grep -q ' refs/heads/main$' || exit 0\n"
            'echo "$PPID" > "$ready.part" && mv "$ready.part" "$ready"\n'
            "n=0\n"
            'while [ ! -f "$release" ] && [ "$n" -lt 1500 ]; do sleep 0.02; n=$((n + 1)); done\n'
            "exit 0\n" % (self.scratch, self.scratch, " ".join(phases)),
        )
        return {
            phase: (self.scratch / ("hook-%s.ready" % phase), self.scratch / ("hook-%s.release" % phase))
            for phase in phases
        }

    def run_to(self, marker):
        run = self.start_push()
        self.addCleanup(self.end_group, run)
        return self.wait_for(run, marker)

    def wait_for(self, run, marker):
        deadline = time.monotonic() + 60
        while not marker.exists():
            self.assertLess(time.monotonic(), deadline, "the barrier was never reached")
            self.assertIsNone(run.poll(), "the run ended before the barrier")
            time.sleep(0.02)
        return run

    def end_group(self, run):
        if run.poll() is None:
            os.killpg(run.pid, signal.SIGKILL)
            run.communicate()

    def git_outcome(self, *args):
        return subprocess.run(
            ["git", *args], cwd=self.checkout, capture_output=True, text=True,
            env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), **FIXTURE_GIT_ENV},
        )

    def plumbing_inside_the_prepared_window(self, *plumbing):
        # Review F1 r4: settlement read main and HEAD after the transaction had
        # released its locks, so plumbing in that gap left UPDATED over a
        # mismatched ref, and the run exported. The index is now installed
        # while the prepared transaction holds HEAD's and main's locks, and
        # the commit follows: plumbing in that window is refused by git
        # itself, and at the commit the index already agrees with main.
        self.git(self.checkout, "branch", "other")
        barriers = self.transaction_barrier("prepared", "committed")
        ready, release = barriers["prepared"]
        run = self.run_to(ready)
        refused = self.git_outcome(*plumbing)
        self.assertNotEqual(refused.returncode, 0, refused.stdout)
        self.assertIn(".lock", refused.stderr)
        self.assertIn("exists", refused.stderr)
        release.touch()
        ready, release = barriers["committed"]
        self.wait_for(run, ready)
        self.assertEqual(self.git(self.checkout, "rev-parse", "main"), self.second)
        self.assertFalse((self.checkout / ".git/index.lock").exists())
        self.assertEqual(self.git(self.checkout, "rev-parse", ":NOTE"), self.git(self.checkout, "rev-parse", self.second + ":NOTE"))
        release.touch()
        out, err = run.communicate(timeout=120)
        self.assertEqual(run.returncode, 0, err)
        self.assertIn("usage-export: UPDATED exporter %s->%s" % (self.first[:12], self.second[:12]), out)
        self.assertTrue(out.splitlines()[-1].startswith("usage-export: SUMMARY pushed="), out)
        self.assertNotIn("DRIFT", err)
        self.assertEqual(self.git(self.checkout, "symbolic-ref", "HEAD"), "refs/heads/main")
        self.assertEqual(self.git(self.checkout, "rev-parse", "other"), self.first)
        self.assert_agreement(self.second)

    def test_main_moved_inside_the_prepared_window_is_refused(self):
        third = self.git(self.checkout, "commit-tree", "-p", self.first, "-m", "third", self.first + "^{tree}")
        self.plumbing_inside_the_prepared_window("update-ref", "refs/heads/main", third)

    def test_head_retargeted_inside_the_prepared_window_is_refused(self):
        self.plumbing_inside_the_prepared_window("symbolic-ref", "HEAD", "refs/heads/other")

    def test_a_ref_update_stopped_before_it_commits_rolls_back(self):
        # The review's negative control: the whole group is stopped while the
        # transaction is prepared. Nothing was installed, so it rolls back.
        ready, release = self.transaction_barrier("prepared")["prepared"]
        run = self.run_to(ready)
        self.assertEqual(self.git(self.checkout, "rev-parse", "main"), self.first)
        os.killpg(run.pid, signal.SIGTERM)
        release.touch()
        out, err = run.communicate(timeout=120)
        self.assertEqual(run.returncode, 1, err)
        self.assertIn("usage-export: WARN repo-update interrupted signal=TERM", err)
        self.assert_rolled_back_and_stopped(subprocess.CompletedProcess(run.args, run.returncode, out, err))
        self.assert_agreement(self.first)

    def stop_after_the_commit(self, target):
        # Review F1 r3: once the transaction has committed, a lost
        # acknowledgement is no proof that main did not move. The index was
        # installed before the commit; the re-read finds main at NEW, and the
        # run, whose commit git never acknowledged, exports nothing.
        ready, release = self.transaction_barrier("committed")["committed"]
        run = self.run_to(ready)
        child = int(ready.read_text(encoding="utf-8"))
        self.assertEqual(os.getpgid(child), run.pid)
        self.assertEqual(self.git(self.checkout, "rev-parse", "main"), self.second)
        if target == "group":
            os.killpg(run.pid, signal.SIGTERM)
        else:
            os.kill(child, signal.SIGTERM)
        release.touch()
        out, err = run.communicate(timeout=120)
        self.assertNotEqual(run.returncode, 0, err)
        self.assertIn("usage-export: UPDATED exporter %s->%s" % (self.first[:12], self.second[:12]), out)
        self.assertIn("without git acknowledging", err)
        self.assertNotIn("SUMMARY", out)
        self.assertNotIn("FIXTURE second-generation", out)
        self.assertFalse(self.args_file.exists())
        self.assertEqual((self.checkout / "NOTE").read_text(encoding="utf-8"), "two\n")
        self.assert_agreement(self.second)
        return err

    def test_a_ref_update_whose_group_is_stopped_after_it_commits_installs_its_index(self):
        err = self.stop_after_the_commit("group")
        self.assertIn("usage-export: WARN repo-update interrupted signal=TERM", err)

    def test_a_ref_update_whose_git_is_stopped_after_it_commits_installs_its_index(self):
        err = self.stop_after_the_commit("child")
        self.assertNotIn("interrupted", err)

    def test_a_commit_never_acknowledged_with_main_still_old_logs_its_repair(self):
        # The index was installed inside the prepared window, then the commit
        # was never answered and main is still OLD: no state is proven, the
        # run stops, and the one-line repair is logged in commit ids only.
        self.git_shim("lose-commit")
        result = self.push()
        self.assertIn(
            "usage-export: WARN DRIFT behind=1 ahead=0 action=incomplete reason=ref-uncertain", result.stderr
        )
        self.assertIn(
            "usage-export: WARN repo-update repair: git update-ref refs/heads/main %s %s\n" % (self.second, self.first),
            result.stderr,
        )
        self.assert_stopped_before_export(result)
        self.assertEqual(self.git(self.checkout, "rev-parse", "main"), self.first)
        self.assertEqual(self.git(self.checkout, "rev-parse", ":NOTE"), self.git(self.checkout, "rev-parse", self.second + ":NOTE"))
        self.assertEqual((self.checkout / "NOTE").read_text(encoding="utf-8"), "two\n")
        self.assertFalse((self.checkout / ".git/index.lock").exists())
        # The logged repair, run as logged, restores agreement.
        self.git(self.checkout, "update-ref", "refs/heads/main", self.second, self.first)
        self.assert_agreement(self.second)

    def test_a_failed_index_install_aborts_and_keeps_the_new_index_as_the_lock(self):
        # Review F1 r4: the install happens inside the prepared window, so its
        # failure aborts the transaction: main stays OLD, the lock keeps the
        # NEW index, and nothing is exported.
        write_executable(
            self.stub_dir / "mv",
            '#!/bin/sh\n[ "${2##*/}" = index.lock ] && [ "${3##*/}" = index ] && exit 73\nexec /bin/mv "$@"\n',
        )
        result = self.push()
        self.assertIn(
            "usage-export: WARN DRIFT behind=1 ahead=0 action=incomplete reason=index-install-failed", result.stderr
        )
        self.assert_stopped_before_export(result)
        self.assertEqual(self.git(self.checkout, "rev-parse", "main"), self.first)
        self.assertEqual(self.git(self.checkout, "rev-parse", ":NOTE"), self.git(self.checkout, "rev-parse", self.first + ":NOTE"))
        self.assertEqual((self.checkout / "NOTE").read_text(encoding="utf-8"), "two\n")
        self.assertEqual(sorted(path.name for path in (self.checkout / ".git").rglob("*.lock")), ["index.lock"])
        self.assert_kept_lock_holds(self.second)

    def start_push(self):
        """The run in a process group of its own, so a test can stop it whole."""
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": os.environ.get("HOME", "/tmp")}
        env.update(self.env)
        return subprocess.Popen(
            ["/bin/sh", str(self.checkout / "scripts/usage-export/push-usage-series.sh")],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
            start_new_session=True,
        )

    def test_a_signal_after_the_checkout_waits_for_agreement(self):
        # Review F1 r2: SIGTERM after a real read-tree wrote the worktree left
        # main and the index at OLD under a NEW worktree. The signal is now
        # held until ref, index and worktree agree, then ends the run.
        barrier = self.scratch / "barrier"
        self.git_shim("barrier", str(barrier))
        run = self.run_to(barrier.with_suffix(".reached"))
        run.send_signal(signal.SIGTERM)
        barrier.with_suffix(".release").touch()
        out, err = run.communicate(timeout=120)
        self.assertEqual(run.returncode, 1, err)
        self.assertIn("usage-export: WARN repo-update interrupted signal=TERM", err)
        self.assertIn("usage-export: UPDATED exporter", out)
        self.assertNotIn("FIXTURE second-generation", out)
        self.assertNotIn("SUMMARY", out)
        self.assertEqual((self.checkout / "NOTE").read_text(encoding="utf-8"), "two\n")
        self.assert_agreement(self.second)

    def test_a_checkout_whose_group_is_stopped_after_it_wrote_keeps_its_index(self):
        # Review F1 r3: the whole group stopped after a real read-tree had
        # finished. A failed exit status does not say the lock still holds
        # OLD; the job reads the lock's tree, finds it moved, keeps the lock
        # (the NEW index) and stops.
        barrier = self.scratch / "barrier"
        self.git_shim("barrier", str(barrier))
        run = self.run_to(barrier.with_suffix(".reached"))
        os.killpg(run.pid, signal.SIGTERM)
        barrier.with_suffix(".release").touch()
        out, err = run.communicate(timeout=120)
        result = subprocess.CompletedProcess(run.args, run.returncode, out, err)
        self.assertIn(
            "usage-export: WARN DRIFT behind=1 ahead=0 action=incomplete reason=checkout-uncertain", err
        )
        self.assertIn("usage-export: WARN repo-update interrupted signal=TERM", err)
        self.assert_stopped_before_export(result)
        self.assertEqual(self.git(self.checkout, "rev-parse", "main"), self.first)
        self.assertEqual(self.git(self.checkout, "rev-parse", ":NOTE"), self.git(self.checkout, "rev-parse", self.first + ":NOTE"))
        self.assertEqual((self.checkout / "NOTE").read_text(encoding="utf-8"), "two\n")
        self.assert_kept_lock_holds(self.second)

    @unittest.skipIf(os.geteuid() == 0, "root writes through a read-only directory")
    def test_a_checkout_refused_part_way_stops_the_run(self):
        # Review F1 r2: a filesystem refusal mid-checkout left some files new
        # and some old, logged merge-refused and exported anyway. NOTE sorts
        # before the script, so it is written before the read-only directory
        # refuses the script.
        directory = self.checkout / "scripts/usage-export"
        directory.chmod(0o555)
        self.addCleanup(directory.chmod, 0o755)
        result = self.push()
        self.assertIn(
            "usage-export: WARN DRIFT behind=1 ahead=0 action=incomplete reason=checkout-partial", result.stderr
        )
        self.assert_stopped_before_export(result)
        self.assertEqual(self.git(self.checkout, "rev-parse", "main"), self.first)
        self.assertEqual(self.git(self.checkout, "rev-parse", ":NOTE"), self.git(self.checkout, "rev-parse", self.first + ":NOTE"))
        # The partial file is left for git status to show, and the lock is released.
        self.assertEqual((self.checkout / "NOTE").read_text(encoding="utf-8"), "two\n")
        self.assertEqual(self.git(self.checkout, "status", "--porcelain", "--untracked-files=no"), "M NOTE")
        self.assert_no_residue()

    @unittest.skipIf(os.geteuid() == 0, "root writes through a read-only directory")
    def test_a_partial_checkout_that_only_added_a_file_is_caught(self):
        # A file the new commit adds is untracked to the old index, so only
        # its presence shows that the checkout wrote it.
        clone = self.scratch / "another-clone"
        self.git(self.scratch, "clone", "--quiet", str(self.origin), str(clone))
        (clone / "NOTE").write_text("one\n", encoding="utf-8")
        (clone / "ADDED").write_text("added\n", encoding="utf-8")
        self.git(clone, "add", "-A")
        self.git(clone, "commit", "--quiet", "-m", "third")
        self.git(clone, "push", "--quiet", "origin", "main")
        directory = self.checkout / "scripts/usage-export"
        directory.chmod(0o555)
        self.addCleanup(directory.chmod, 0o755)
        result = self.push()
        self.assertIn(
            "usage-export: WARN DRIFT behind=2 ahead=0 action=incomplete reason=checkout-partial", result.stderr
        )
        self.assert_stopped_before_export(result)
        self.assertEqual(self.git(self.checkout, "rev-parse", "main"), self.first)
        self.assertEqual((self.checkout / "ADDED").read_text(encoding="utf-8"), "added\n")
        self.assertEqual(self.git(self.checkout, "status", "--porcelain", "--untracked-files=no"), "")
        self.assert_no_residue()

    @unittest.skipIf(os.geteuid() == 0, "root writes through a read-only directory")
    def test_a_path_spelled_like_pathspec_magic_is_matched_literally(self):
        # Review F1 r3: a tracked file named `:(exclude)*` read as a pathspec
        # excludes every path, so its partial update went unseen and the run
        # exported. It sorts before the read-only `zzdir`, so it is written.
        clone = self.scratch / "literal-clone"
        self.git(self.scratch, "clone", "--quiet", str(self.origin), str(clone))
        magic = ":(exclude)*"
        (clone / magic).write_text("one\n", encoding="utf-8")
        (clone / "zzdir").mkdir()
        (clone / "zzdir/data").write_text("one\n", encoding="utf-8")
        self.git(clone, "add", "-A")
        self.git(clone, "commit", "--quiet", "-m", "literal")
        self.git(clone, "push", "--quiet", "origin", "main")
        self.git(self.checkout, "fetch", "--quiet", "origin")
        self.git(self.checkout, "merge", "--ff-only", "--quiet", "origin/main")
        base = self.head()
        (clone / magic).write_text("two\n", encoding="utf-8")
        (clone / "zzdir/data").write_text("two\n", encoding="utf-8")
        self.git(clone, "commit", "--quiet", "-am", "literal two")
        self.git(clone, "push", "--quiet", "origin", "main")
        directory = self.checkout / "zzdir"
        directory.chmod(0o555)
        self.addCleanup(directory.chmod, 0o755)
        result = self.push()
        self.assertIn(
            "usage-export: WARN DRIFT behind=1 ahead=0 action=incomplete reason=checkout-partial", result.stderr
        )
        self.assert_stopped_before_export(result)
        self.assertEqual(self.git(self.checkout, "rev-parse", "main"), base)
        self.assertEqual((self.checkout / magic).read_text(encoding="utf-8"), "two\n")
        self.assertEqual((self.checkout / "zzdir/data").read_text(encoding="utf-8"), "one\n")
        self.assert_no_residue()

    def test_main_moved_before_the_lock_is_judged_inside_it(self):
        # The counts above are read before the lock, so main is read again
        # inside it: a commit made meanwhile is never thrown away, and a
        # checkout another actor already brought current is left as it is.
        self.git_shim("diverge")
        result = self.push()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("usage-export: WARN DRIFT behind=1 ahead=0 action=none reason=diverged", result.stderr)
        self.assertNotIn("UPDATED", result.stdout)
        self.assertEqual(self.git(self.checkout, "rev-parse", "main^"), self.first)
        self.assertNotEqual(self.git(self.checkout, "rev-parse", "main"), self.second)
        self.assertEqual((self.checkout / "NOTE").read_text(encoding="utf-8"), "one\n")
        self.assert_no_residue()
        self.git(self.checkout, "update-ref", "refs/heads/main", self.first)
        self.git_shim("catch-up")
        result = self.push()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("usage-export: WARN DRIFT behind=1 ahead=0 action=none reason=none", result.stderr)
        self.assertNotIn("UPDATED", result.stdout)
        self.assertEqual(self.head(), self.second)
        self.assertEqual((self.checkout / "NOTE").read_text(encoding="utf-8"), "two\n")
        self.assert_no_residue()

    def test_a_git_without_ref_transactions_changes_nothing(self):
        self.git_shim("too-old")
        result = self.push()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("usage-export: WARN DRIFT behind=1 ahead=0 action=none reason=git-too-old", result.stderr)
        self.assertNotIn("UPDATED", result.stdout)
        self.assertEqual(self.head(), self.first)
        self.assertEqual((self.checkout / "NOTE").read_text(encoding="utf-8"), "one\n")
        self.assert_no_residue()

    def test_the_fetch_runs_at_most_hourly_and_a_stamp_ahead_of_the_clock_is_due(self):
        self.history.mkdir()
        stamp = self.history / "repo-update.stamp"
        recent = "%d\n" % (int(time.time()) - 60)
        stamp.write_text(recent, encoding="utf-8")
        result = self.push()
        self.assertEqual(result.returncode, 0, result.stderr)
        # Fetched a minute ago: no fetch now, so nothing is known to be behind.
        self.assertEqual(self.head(), self.first)
        self.assertNotIn("UPDATED", result.stdout)
        self.assertEqual(stamp.read_text(encoding="utf-8"), recent)
        # A stamp a month AHEAD of the clock is a clock that moved back.
        stamp.write_text("%d\n" % (int(time.time()) + 30 * 86400), encoding="utf-8")
        result = self.push()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.head(), self.second)
        self.assertIn("UPDATED", result.stdout)

    def test_a_failed_fetch_is_a_warning_and_the_run_goes_on(self):
        shutil.rmtree(self.origin)
        result = self.push()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertRegex(result.stderr, r"usage-export: WARN repo-update fetch-failed reason=[a-z-]+\n")
        self.assertEqual(self.head(), self.first)
        self.assertNotIn(str(self.origin), result.stdout + result.stderr)
        self.assertTrue(result.stdout.splitlines()[-1].startswith("usage-export: SUMMARY pushed="))


class BoundedFetchTest(unittest.TestCase):
    """The hourly fetch is bounded the way the push's ssh is."""

    def setUp(self):
        self.scratch = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.scratch, ignore_errors=True)
        for signum in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            self.addCleanup(signal.signal, signum, signal.getsignal(signum))
        self.calls = self.scratch / "git-calls"

    def fake_git(self, body):
        stubs = self.scratch / "stubs"
        stubs.mkdir(exist_ok=True)
        write_executable(
            stubs / "git",
            "#!/bin/sh\nfor arg in \"$@\"; do printf '%%s\\n' \"$arg\"; done > %s\n%s" % (self.calls, body),
        )
        return mock.patch.dict(os.environ, {"PATH": str(stubs)})

    def run_main(self, argv):
        with contextlib.redirect_stderr(io.StringIO()) as err:
            code = fetcher.main(argv)
        return code, err.getvalue()

    def test_exactly_one_command_with_a_fixed_deadline(self):
        self.assertEqual(fetcher.DEADLINE_SECONDS, 30)
        with self.fake_git("exit 0\n"):
            self.assertEqual(self.run_main(["/some/checkout"]), (0, ""))
        self.assertEqual(
            self.calls.read_text(encoding="utf-8").splitlines(),
            ["-C", "/some/checkout", "fetch", "--quiet", "origin", "main"],
        )
        for argv in ([], ["a", "b"]):
            self.assertEqual(
                self.run_main(argv),
                (1, "usage-export: WARN repo-update fetch-failed reason=invalid-invocation\n"),
            )

    def test_a_stalled_fetch_retires_at_the_deadline(self):
        started = time.monotonic()
        with self.fake_git("exec /bin/sleep 30\n"), mock.patch.object(fetcher, "DEADLINE_SECONDS", 0.3):
            code, err = self.run_main([str(self.scratch)])
        self.assertEqual(code, 124)
        self.assertEqual(err, "usage-export: WARN repo-update fetch-failed reason=deadline-exceeded\n")
        self.assertLess(time.monotonic() - started, 5)

    def test_a_refused_fetch_names_a_closed_reason_and_no_text(self):
        with self.fake_git("echo 'fatal: PRIVATE-REMOTE-SENTINEL went wrong' >&2\nexit 128\n"):
            code, err = self.run_main([str(self.scratch)])
        self.assertEqual(code, 128)
        self.assertEqual(err, "usage-export: WARN repo-update fetch-failed reason=fetch-refused\n")
        with self.fake_git("echo 'fatal: Could not resolve host: PRIVATE' >&2\nexit 128\n"):
            code, err = self.run_main([str(self.scratch)])
        self.assertEqual(err, "usage-export: WARN repo-update fetch-failed reason=name-resolution\n")


LAUNCHCTL_STUB = """#!/bin/sh
printf '%s\\n' "$*" >> "$LAUNCHCTL_CALLS"
[ "$1" = print ] || exit 64
label=${2##*/}
[ -f "$LAUNCHCTL_STATE/$label" ] || exit 113
printf '%s = {\\n\\tstate = not running\\n\\tlast exit code = %s\\n}\\n' "$2" "$(cat "$LAUNCHCTL_STATE/$label")"
"""

EXPORT_LABEL = "com.naranjo-online.usage-export"
SNAPSHOT_LABEL = "com.naranjo-online.ledger-snapshot"


class InstallCheckTest(unittest.TestCase):
    """--check reports drift and failure, and changes nothing."""

    def setUp(self):
        self.scratch = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.scratch, ignore_errors=True)
        self.home = self.scratch / "home"
        self.agents = self.home / "Library" / "LaunchAgents"
        self.agents.mkdir(parents=True)
        self.checkout = self.scratch / "checkout"
        stubs = self.scratch / "stubs"
        stubs.mkdir()
        write_executable(stubs / "launchctl", LAUNCHCTL_STUB)
        self.state = self.scratch / "launchd"
        self.state.mkdir()
        self.calls = self.scratch / "launchctl-calls"
        self.env = {
            "HOME": str(self.home),
            "PATH": "%s:%s" % (stubs, os.environ.get("PATH", "/usr/bin:/bin")),
            "NARANJO_USAGE_EXPORT_CONFIG": str(self.scratch / "config"),
            "LAUNCHCTL_CALLS": str(self.calls),
            "LAUNCHCTL_STATE": str(self.state),
        }
        self.configure(HISTORY_DIR=str(self.scratch / "history"))
        self.install(EXPORT_LABEL, self.checkout / "scripts/usage-export/push-usage-series.sh", "0")
        self.install(SNAPSHOT_LABEL, self.checkout / "scripts/ledger_snapshot.py", "0")

    def configure(self, **values):
        config = self.scratch / "config"
        values = dict({"REPO_DIR": str(self.checkout)}, **values)
        config.write_text("".join("%s=%s\n" % pair for pair in values.items()), encoding="utf-8")
        config.chmod(0o600)

    def install(self, label, program, last_exit, extra=""):
        """The agent as the installer renders it from the committed template,
        with `program` as its script and `extra` keys added to its dict."""
        text = (TEMPLATE if label == EXPORT_LABEL else SNAPSHOT_TEMPLATE).read_text(encoding="utf-8")
        for placeholder, value in (
            ("__PUSH_SCRIPT__", program),
            ("__SNAPSHOT_SCRIPT__", program),
            ("__LEDGER_DIR__", self.scratch / "history/ledger"),
            ("__LOG_DIR__", self.home / "Library/Logs/naranjo-online-usage-export"),
        ):
            text = text.replace(placeholder, str(value))
        text = text.replace("<dict>", "<dict>" + extra, 1)
        (self.agents / ("%s.plist" % label)).write_text(text, encoding="utf-8")
        if last_exit is not None:
            (self.state / label).write_text(last_exit, encoding="utf-8")

    def check(self):
        before = {path.name: path.read_bytes() for path in self.agents.iterdir()}
        result = run_script(INSTALL, ["--check"], env=self.env)
        # Nothing changed: the same agents byte for byte, no log directory,
        # and launchd was only ever asked to print.
        self.assertEqual({path.name: path.read_bytes() for path in self.agents.iterdir()}, before)
        self.assertFalse((self.home / "Library" / "Logs").exists())
        if self.calls.exists():
            for call in self.calls.read_text(encoding="utf-8").splitlines():
                self.assertTrue(call.startswith("print gui/"), call)
        self.assertNotIn(str(self.scratch), result.stdout + result.stderr)
        return result

    def test_a_current_install_passes(self):
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(
            result.stdout.splitlines(),
            [
                "check %s installed=yes repo=match last-exit=0" % EXPORT_LABEL,
                "check %s installed=yes repo=match last-exit=0" % SNAPSHOT_LABEL,
            ],
        )

    def test_an_agent_running_another_checkout_fails(self):
        self.install(EXPORT_LABEL, self.scratch / "elsewhere/scripts/usage-export/push-usage-series.sh", "0")
        result = self.check()
        self.assertEqual(result.returncode, 1)
        self.assertIn("check %s installed=yes repo=MISMATCH last-exit=0" % EXPORT_LABEL, result.stdout)

    def test_only_the_program_arguments_can_match(self):
        # Review F9: the expected path anywhere in the plist's XML matched, so
        # an agent running another program passed whenever a comment, an
        # environment value or any other key happened to spell the path.
        expected = {
            EXPORT_LABEL: self.checkout / "scripts/usage-export/push-usage-series.sh",
            SNAPSHOT_LABEL: self.checkout / "scripts/ledger_snapshot.py",
        }
        for label, path in expected.items():
            with self.subTest(label=label):
                elsewhere = self.scratch / "elsewhere" / path.relative_to(self.checkout)
                self.install(label, elsewhere, "0", "<key>Comment</key><string>%s</string>" % path)
                result = self.check()
                self.assertEqual(result.returncode, 1)
                self.assertIn("check %s installed=yes repo=MISMATCH last-exit=0" % label, result.stdout)
                self.install(label, path, "0")
        # The interpreter and its flags are part of what the snapshot runs.
        plist = self.agents / ("%s.plist" % SNAPSHOT_LABEL)
        plist.write_text(plist.read_text(encoding="utf-8").replace("<string>-I</string>", "", 1), encoding="utf-8")
        result = self.check()
        self.assertEqual(result.returncode, 1)
        self.assertIn("check %s installed=yes repo=MISMATCH last-exit=0" % SNAPSHOT_LABEL, result.stdout)
        # launchd runs `Program`, when present, in place of argv[0]: an agent
        # naming another program there runs it, whatever its arguments say
        # (review F9 r2). The same path in both places still matches.
        for label, path in expected.items():
            with self.subTest(label=label, program="/usr/bin/false"):
                self.install(label, path, "0", "<key>Program</key><string>/usr/bin/false</string>")
                result = self.check()
                self.assertEqual(result.returncode, 1)
                self.assertIn("check %s installed=yes repo=MISMATCH last-exit=0" % label, result.stdout)
        first = {EXPORT_LABEL: expected[EXPORT_LABEL], SNAPSHOT_LABEL: "/usr/bin/env"}
        for label, path in expected.items():
            self.install(label, path, "0", "<key>Program</key><string>%s</string>" % first[label])
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(result.stdout.count("repo=match"), 2)
        # And a plist that does not parse matches nothing.
        plist.write_text("<plist><dict><key>ProgramArguments</key><array><string>%s"
                         % expected[SNAPSHOT_LABEL], encoding="utf-8")
        result = self.check()
        self.assertIn("check %s installed=yes repo=MISMATCH last-exit=0" % SNAPSHOT_LABEL, result.stdout)

    def test_a_failed_last_run_fails(self):
        for code, shown in (("1", "1"), ("78: EX_CONFIG", "78")):
            with self.subTest(code=code):
                self.install(SNAPSHOT_LABEL, self.checkout / "scripts/ledger_snapshot.py", code)
                result = self.check()
                self.assertEqual(result.returncode, 1)
                self.assertIn("check %s installed=yes repo=match last-exit=%s" % (SNAPSHOT_LABEL, shown), result.stdout)

    def test_a_job_that_never_exited_passes_and_one_launchd_lacks_fails(self):
        self.install(EXPORT_LABEL, self.checkout / "scripts/usage-export/push-usage-series.sh", "(never exited)")
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("last-exit=never", result.stdout)
        (self.state / EXPORT_LABEL).unlink()
        result = self.check()
        self.assertEqual(result.returncode, 1)
        self.assertIn("check %s installed=yes repo=match last-exit=not-loaded" % EXPORT_LABEL, result.stdout)

    def test_the_snapshot_agent_is_required_only_with_a_record(self):
        (self.agents / ("%s.plist" % SNAPSHOT_LABEL)).unlink()
        result = self.check()
        self.assertEqual(result.returncode, 1)
        self.assertIn("check %s installed=no" % SNAPSHOT_LABEL, result.stdout)
        self.configure()
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("check %s installed=no" % SNAPSHOT_LABEL, result.stdout)
        (self.agents / ("%s.plist" % EXPORT_LABEL)).unlink()
        result = self.check()
        self.assertEqual(result.returncode, 1)

    def test_a_configuration_without_a_checkout_cannot_pass(self):
        config = self.scratch / "config"
        config.write_text("HISTORY_DIR=%s\n" % (self.scratch / "history"), encoding="utf-8")
        config.chmod(0o600)
        result = self.check()
        self.assertEqual(result.returncode, 1)
        self.assertIn("repo=unknown", result.stdout)


if __name__ == "__main__":
    unittest.main()
