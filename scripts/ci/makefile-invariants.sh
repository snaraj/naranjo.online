#!/usr/bin/env bash
# makefile-invariants — pin the Makefile's two security-sensitive
# invariants, both named in Daybreak Blue's review of PR #173: the
# canonical `npm ci` install flags (AGENTS.md "Quality gates"; MEDIUM
# finding #3), and PORT's fail-closed decimal-only validation, demonstrated
# against actual hostile input rather than only well-formed values (HIGH
# finding #1: PORT interpolated unvalidated into a shell recipe and a URL —
# a metacharacter value could run a second shell command, an "@"-host value
# could move the Vite dev proxy off 127.0.0.1).
#
# Every negative assertion below runs the REAL `validate-port` target with a
# REAL hostile PORT, and (c) proves the injected command never executes via
# an unambiguous side effect (a file that either exists or does not) rather
# than text-matching output, which cannot be confused with the same marker
# appearing inertly inside the target's own diagnostic message.
set -euo pipefail

makefile="${MAKEFILE_PATH:-Makefile}"

fail() {
  printf 'makefile-invariants: %s\n' "$1" >&2
  exit 1
}

[ -f "${makefile}" ] || fail "no ${makefile} in $(pwd)"

# (a) The deps recipe's npm ci invocation matches AGENTS.md's canonical
# command exactly — a static pin, not a behavioral one, because the point is
# the FLAGS present in the committed recipe text: the lockfile carries two
# hasInstallScript dependencies, so a regression here is a real
# supply-chain exposure, not a style nit.
if ! grep -qF 'npm ci --ignore-scripts --no-audit --no-fund' "${makefile}"; then
  fail "the deps recipe must run exactly 'npm ci --ignore-scripts --no-audit --no-fund' (AGENTS.md \"Quality gates\"); found: $(grep -n 'npm ci' "${makefile}" || echo 'no npm ci invocation at all')"
fi
echo "makefile-invariants: (a) deps recipe pins the canonical npm ci flags"

# (b) Positive control: a well-formed PORT passes validate-port cleanly, so
# the refusals below prove REJECTION of hostile input specifically — never
# a guard that simply never passes anything (the vacuity failure mode named
# in AGENTS.md's adversarial review protocol).
if ! ok_output="$(make -f "${makefile}" validate-port PORT=18173 2>&1)"; then
  fail "validate-port PORT=18173 (a normal port) was refused: ${ok_output}"
fi
echo "makefile-invariants: (b) a well-formed PORT passes validate-port (non-vacuous)"

# (c) The exact metacharacter shape from the review: a PORT value that, if
# textually substituted into a shell command line, runs a second command.
# The proof is a side effect a passing run could never produce: a "touch"
# smuggled after a semicolon either creates pwn_file (injection ran) or
# does not (validate-port's shell-level $$PORT indirection kept it inert).
pwn_file="$(mktemp -u "${TMPDIR:-/tmp}/makefile-invariants-pwned.XXXXXX")"
rm -f "${pwn_file}"
trap 'rm -f "${pwn_file}"' EXIT
hostile_shell="18173; touch ${pwn_file}"
if make -f "${makefile}" validate-port PORT="${hostile_shell}" >/dev/null 2>&1; then
  fail "validate-port accepted a shell-metacharacter PORT ('${hostile_shell}') instead of refusing it"
fi
if [ -f "${pwn_file}" ]; then
  fail "the injected 'touch' side effect occurred at ${pwn_file} — validate-port did not close the shell-injection vector"
fi
echo "makefile-invariants: (c) shell-metacharacter PORT is refused, and its injected command never executes"

# (d) The "@"-host shape that, unvalidated and concatenated into a URL,
# would move a proxy target's hostname off 127.0.0.1 (see
# frontend/tests/dev-api-port.test.mjs for the JS-side reproduction of the
# same vector against frontend/src/lib/devApiPort.ts, the actually
# authoritative boundary for that URL). The Makefile's decimal-only gate
# refuses this shape too, as defense in depth.
hostile_host="80@evil.example"
if make -f "${makefile}" validate-port PORT="${hostile_host}" >/dev/null 2>&1; then
  fail "validate-port accepted an @-host PORT ('${hostile_host}') that would misdirect a proxy target"
fi
echo "makefile-invariants: (d) @-host PORT is refused"

# (e) Empty and non-decimal PORT are refused too — the same allowlist, not
# a special case carved out for the two hostile shapes above. (A leading- or
# trailing-whitespace value is deliberately not tested here: GNU Make's own
# command-line assignment parser strips it before the shell ever sees
# PORT — confirmed with `make show-port PORT=' 8080'` printing `[8080]` —
# so it never reaches validate-port as anything but a clean decimal string,
# and is not a hostile shape.)
for value in '' 'not-a-port' '8080x' '-1' '0'; do
  if make -f "${makefile}" validate-port PORT="${value}" >/dev/null 2>&1; then
    fail "validate-port accepted PORT='${value}'"
  fi
done
echo "makefile-invariants: (e) empty, negative, zero, and non-decimal PORT values are refused"

echo "makefile-invariants: PORT validation and the npm ci install boundary both hold"
