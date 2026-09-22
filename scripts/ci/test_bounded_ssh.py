"""Real subprocess evidence for bounded, private usage-push lifecycle."""

import importlib.util
import pathlib
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock


RUNNER = pathlib.Path(__file__).resolve().parents[1] / "usage-export" / "bounded-ssh.py"
spec = importlib.util.spec_from_file_location("bounded_ssh", RUNNER)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class BoundedSSHTest(unittest.TestCase):
    def run_child(self, code, timeout=2):
        return runner.bounded_command([sys.executable, "-I", "-B", "-c", code], timeout=timeout)

    def test_success_returns_exact_response_and_discards_private_stderr(self):
        code, stdout, reason = self.run_child(
            "import sys; sys.stdout.buffer.write(b'checksum response\\n'); "
            "sys.stderr.write('PRIVATE-DIAGNOSTIC-SENTINEL')"
        )
        self.assertEqual((code, stdout, reason), (0, b"checksum response\n", ""))

    def test_failed_transport_returns_only_closed_reason_and_no_response(self):
        code, stdout, reason = self.run_child(
            "import sys; print('UNTRUSTED-RESPONSE-SENTINEL'); "
            "sys.stderr.write('PRIVATE-DESTINATION: Network is unreachable'); sys.exit(255)"
        )
        self.assertEqual((code, stdout, reason), (255, b"", "network-unreachable"))

    def test_unknown_failure_and_missing_executable_do_not_expose_details(self):
        self.assertEqual(self.run_child("import sys; sys.stderr.write('PRIVATE-PATH-SENTINEL'); sys.exit(7)"),
                         (7, b"", "ssh-refused"))
        self.assertEqual(runner.bounded_command(["/nonexistent/synthetic-sentinel"]),
                         (1, b"", "runner-unavailable"))

    def test_stalled_peer_retires_before_another_scheduler_round(self):
        started = time.monotonic()
        result = self.run_child("import time; time.sleep(30)", timeout=0.15)
        self.assertEqual(result, (124, b"", "deadline-exceeded"))
        self.assertLess(time.monotonic() - started, 5)

    def test_child_closing_output_but_not_exiting_remains_bounded(self):
        result = self.run_child("import os,time; os.close(1); os.close(2); time.sleep(30)", timeout=0.15)
        self.assertEqual(result, (124, b"", "deadline-exceeded"))

    def test_timeout_reaps_its_process_group_and_does_not_kill_unrelated_process(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = pathlib.Path(directory) / "unexpected-descendant-survived"
            unrelated = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
            self.addCleanup(lambda: unrelated.poll() is None and unrelated.kill())
            child_code = "import pathlib,time; time.sleep(.5); pathlib.Path(%r).touch()" % str(marker)
            code = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',%r]); time.sleep(30)" % child_code
            try:
                self.assertEqual(self.run_child(code, timeout=0.15), (124, b"", "deadline-exceeded"))
                time.sleep(0.6)
                self.assertFalse(marker.exists(), "the timed-out SSH descendant outlived its group")
                self.assertIsNone(unrelated.poll(), "timeout escaped the owned process group")
            finally:
                unrelated.kill()
                unrelated.wait()

    def test_response_flood_is_refused_before_returning_any_bytes(self):
        for stream in ("stdout", "stderr"):
            with self.subTest(stream=stream):
                result = self.run_child(f"import sys; sys.{stream}.write('x' * 1000000)")
                self.assertEqual(result, (1, b"", "response-over-budget"))

    def test_stopping_the_runner_reaps_the_separate_ssh_group(self):
        for signum in (signal.SIGTERM, signal.SIGHUP):
            with self.subTest(signal=signum), tempfile.TemporaryDirectory() as directory:
                pidfile = pathlib.Path(directory) / "child-pid"
                ssh = pathlib.Path(directory) / "ssh"
                ssh.write_text("#!" + sys.executable + "\nimport os,pathlib,time\n"
                               + "pathlib.Path(%r).write_text(str(os.getpid()))\n" % str(pidfile)
                               + "time.sleep(30)\n")
                ssh.chmod(0o700)
                child = subprocess.Popen([sys.executable, str(RUNNER), "ssh"],
                                         env={**os.environ, "PATH": directory},
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    deadline = time.monotonic() + 5
                    while not pidfile.exists() and time.monotonic() < deadline:
                        time.sleep(.01)
                    self.assertTrue(pidfile.exists(), "SSH fixture never started")
                    ssh_pid = int(pidfile.read_text())
                    child.send_signal(signum)
                    stdout, stderr = child.communicate(timeout=5)
                    self.assertEqual(child.returncode, 128 + signum)
                    self.assertEqual(stdout, b"")
                    self.assertIn(b"reason=interrupted", stderr)
                    with self.assertRaises(ProcessLookupError):
                        os.kill(ssh_pid, 0)
                finally:
                    if child.poll() is None:
                        child.kill()
                        child.wait()

    def test_forward_wall_clock_jump_expires_a_suspended_attempt(self):
        started = time.monotonic()
        with mock.patch.object(runner.time, "time", side_effect=[100, 1000]):
            self.assertEqual(self.run_child("import time; time.sleep(30)"),
                             (124, b"", "deadline-exceeded"))
        # A monotonic-only runner eventually returns the same reason after
        # its two-second test budget; wake-from-sleep retirement must be prompt.
        self.assertLess(time.monotonic() - started, 1)

    def test_main_has_no_configurable_deadline_or_non_ssh_command(self):
        self.assertEqual(runner.DEADLINE_SECONDS, 45)
        self.assertEqual(runner.MAX_RESPONSE_BYTES, 32768)
        with mock.patch.object(runner, "bounded_command", return_value=(0, b"", "")) as run:
            self.assertEqual(runner.main(["unexpected-command"]), 1)
            run.assert_not_called()
        for args in ([], ["--timeout=0", "ssh"], ["--timeout=999999", "ssh"]):
            result = subprocess.run([sys.executable, str(RUNNER), *args], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("reason=invalid-invocation", result.stderr)


if __name__ == "__main__":
    unittest.main()
