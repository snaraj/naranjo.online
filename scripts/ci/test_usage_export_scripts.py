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

import datetime
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
        self.assertIn("checksum verified", result.stdout)

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
        # Every python3 invocation in the file is one of those sandboxed
        # lines' continuations — there is no third interpreter start anywhere.
        starts = [line.strip() for line in lines if "python3" in line]
        self.assertEqual(len(starts), 2, starts)
        for line in starts:
            self.assertIn("-I -B", line)

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

    def test_the_schedule_runs_each_minute_without_a_second_launcher(self):
        result = run_script(INSTALL, ["--render-only"], env=self.env())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(
            "<key>StartInterval</key>\n    <integer>60</integer>",
            result.stdout,
            "the rendered agent must wake the single launchd job each minute",
        )

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


if __name__ == "__main__":
    unittest.main()
