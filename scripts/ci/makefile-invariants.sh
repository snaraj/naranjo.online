#!/usr/bin/env bash
# makefile-invariants — pin the Makefile's two security-sensitive
# invariants, both raised in Daybreak Blue's review of PR #173/#174: the
# canonical `npm ci` install flags (AGENTS.md "Quality gates"; round-1
# MEDIUM finding #3), and PORT's fail-closed decimal-only validation,
# demonstrated against actual hostile input — including, since round 2's
# review, a GNU Make function-call shape, not only shell metacharacters and
# an "@"-host.
#
# Every invocation below uses the SUPPORTED interface only:
# `PORT=<value> make <target>` (a process-environment variable). A
# `make <target> PORT=<value>` COMMAND-LINE override is deliberately never
# exercised here as a "must be safe" case, because it cannot be made safe
# from within any Makefile: GNU Make reconstructs MAKEOVERRIDES/MFLAGS from
# every command-line `VAR=value` argument, for every target, to propagate
# overrides to a recursive $(MAKE) sub-invocation this Makefile does not
# even have — and building that reconstruction fully expands each
# override's raw text, including any embedded $(shell ...) call, before a
# single recipe line runs. This was verified against scratch Makefiles
# during round 2's fix, and none of three different userspace mitigations
# defended against it (see the Makefile's own PORT section for the detail).
# The environment-variable interface this Makefile documents is not
# subject to that reconstruction — proven by every assertion below — so it
# is the only interface this repository supports, and the only one this
# script tests as "must be safe".
#
# Every negative assertion proves its claim via an unambiguous side effect
# (a scratch file that either exists or does not) rather than text-matching
# output, which cannot be confused with the same marker appearing inertly
# inside a diagnostic message.
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

# (b) Positive control: a well-formed PORT, set the SUPPORTED way, passes
# validate-port cleanly, so the refusals below prove REJECTION of hostile
# input specifically — never a guard that simply never passes anything (the
# vacuity failure mode named in AGENTS.md's adversarial review protocol).
if ! ok_output="$(PORT=18173 make -f "${makefile}" validate-port 2>&1)"; then
  fail "PORT=18173 (a normal port) was refused: ${ok_output}"
fi
echo "makefile-invariants: (b) a well-formed PORT (env var) passes validate-port (non-vacuous)"

# (c) The exact shell-metacharacter shape from round 1's review: a PORT
# value that, if textually substituted into a shell command line, runs a
# second command. The proof is a side effect a passing run could never
# produce: a "touch" smuggled after a semicolon either creates pwn_file
# (injection ran) or does not (validate-port's shell-level $${PORT:-8080}
# indirection kept it inert).
pwn_file="$(mktemp -u "${TMPDIR:-/tmp}/makefile-invariants-pwned.XXXXXX")"
rm -f "${pwn_file}"
trap 'rm -f "${pwn_file}"' EXIT
hostile_shell="18173; touch ${pwn_file}"
if PORT="${hostile_shell}" make -f "${makefile}" validate-port >/dev/null 2>&1; then
  fail "validate-port accepted a shell-metacharacter PORT ('${hostile_shell}') instead of refusing it"
fi
if [ -f "${pwn_file}" ]; then
  fail "the injected 'touch' side effect occurred at ${pwn_file} — validate-port did not close the shell-injection vector"
fi
echo "makefile-invariants: (c) shell-metacharacter PORT (env var) is refused, and its injected command never executes"

# (d) The "@"-host shape that, unvalidated and concatenated into a URL,
# would move a proxy target's hostname off 127.0.0.1 (see
# frontend/tests/dev-api-port.test.mjs for the JS-side reproduction of the
# same vector against frontend/src/lib/devApiPort.ts, the actually
# authoritative boundary for that URL). The Makefile's decimal-only gate
# refuses this shape too, as defense in depth.
hostile_host="80@evil.example"
if PORT="${hostile_host}" make -f "${makefile}" validate-port >/dev/null 2>&1; then
  fail "validate-port accepted an @-host PORT ('${hostile_host}') that would misdirect a proxy target"
fi
echo "makefile-invariants: (d) @-host PORT (env var) is refused"

# (e) Non-decimal, negative, and zero PORT are refused too — the same
# allowlist, not a special case carved out for the hostile shapes above.
# (An EMPTY PORT is deliberately not in this list: "${PORT:-8080}" treats
# an empty value the same as unset by design, defaulting to 8080 exactly
# like cmd/server's own listenPort(""), so PORT='' is a valid, intentional
# default -- not a hostile shape.)
for value in 'not-a-port' '8080x' '-1' '0'; do
  if PORT="${value}" make -f "${makefile}" validate-port >/dev/null 2>&1; then
    fail "validate-port accepted PORT='${value}'"
  fi
done
echo "makefile-invariants: (e) negative, zero, and non-decimal PORT values (env var) are refused"

# (f) Round 2's finding: a GNU Make function-call shape. Proven three ways —
# against validate-port, against run's own prerequisite chain (via a dry
# run, so this assertion doesn't also require a full frontend build), and
# against an UNRELATED target (help) that never references PORT at all,
# because the round-1 fix's `export PORT` exported (and, it turned out,
# still left exploitable via MAKEOVERRIDES) the raw value into every
# recipe's environment regardless of whether that recipe used it.
fn_marker="$(mktemp -u "${TMPDIR:-/tmp}/makefile-invariants-fn-marker.XXXXXX")"
rm -f "${fn_marker}"
trap 'rm -f "${pwn_file}" "${fn_marker}"' EXIT
hostile_fn='$(shell touch '"${fn_marker}"')'

if PORT="${hostile_fn}" make -f "${makefile}" validate-port >/dev/null 2>&1; then
  fail "validate-port accepted a Make-function PORT ('${hostile_fn}') instead of refusing it"
fi
if [ -f "${fn_marker}" ]; then
  fail "the Make-function PORT executed on validate-port at ${fn_marker} — the env-var interface did not close this vector"
fi

if PORT="${hostile_fn}" make -f "${makefile}" help >/dev/null 2>&1; then :; fi
if [ -f "${fn_marker}" ]; then
  fail "the Make-function PORT executed on the UNRELATED 'help' target at ${fn_marker} — a supported interface must never expand PORT for a target that never references it"
fi
echo "makefile-invariants: (f) a GNU Make function-call PORT (env var) never executes, on validate-port or an unrelated target"

echo "makefile-invariants: PORT validation and the npm ci install boundary both hold"
