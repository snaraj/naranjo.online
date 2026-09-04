#!/usr/bin/env bash
# live-refresh-probe.sh — the validated live-update ceremony for the panels
# refresh loop (issue #281, defect 4; owner directive 2026-09-01: "make a
# momentary fake commit or something that gets reverted that VALIDATES the
# live update").
#
# WHAT IT DOES, exactly the procedure validated by hand on 2026-09-01:
#
#   1. Read the live coding-projects envelope and record the target
#      repository's openIssues figure as the baseline.
#   2. Apply one REVERSIBLE mutation: open an ephemeral issue in the target
#      repository. An issue, deliberately not a fake commit, so the probe
#      creates and deletes no git refs and rewrites no history.
#   3. Poll the live panel until the figure reflects the mutation
#      (baseline + 1), recording the forward latency.
#   4. Revert the mutation — close the issue — and poll until the figure
#      returns to the baseline, recording the revert latency.
#   5. Report both latencies. The issue is closed on EVERY exit path,
#      including timeouts and interrupts, so the probe leaves nothing open.
#
# MEASURED REFERENCE RUN (2026-09-01, issue #281 comment; mutation vehicle
# was an ephemeral issue in a sibling repository):
#
#   forward: issue opened 08:30:53Z -> reflected at the 08:43:51Z
#            regeneration = 12m58s
#   revert:  issue closed 08:44:25Z -> reflected at the 08:58:55Z
#            regeneration = 14m30s
#   cadence: regenerations 08:13:35 / 08:28:48 / 08:43:51 / 08:58:55 —
#            a clean ~15-minute tick; both transitions landed at the FIRST
#            possible tick, so a healthy loop's worst case is one interval.
#
# That reference predates the authenticated fast path. The live deployment
# now budgets GitHub-backed panels once a minute when its credential is
# present (while preserving the wider anonymous fallback). The timeout below
# is therefore TWO current ticks plus margin per direction: a healthy loop
# lands in one, a loop that misses two is the defect this probe exists to
# catch.
#
# OPERATOR/AGENT-RUN ONLY — NEVER WIRED INTO CI. CI must not depend on the
# live site and must not create GitHub mutations; this script does both, on
# purpose, under an operator's own credential. The explicit repository
# argument is the consent: there is no default mutation target.
#
# Usage:
#   scripts/ops/live-refresh-probe.sh <owner>/<repository>
#
# Environment:
#   PROBE_SITE          origin to poll        (default https://naranjo.online)
#   PROBE_TICK_SECONDS  one refresh tick      (default 60)
#   PROBE_POLL_SECONDS  poll interval         (default 30)
#
# Requires: gh (authenticated), curl, python3.

set -euo pipefail

site="${PROBE_SITE:-https://naranjo.online}"
tick_seconds="${PROBE_TICK_SECONDS:-60}"
poll_seconds="${PROBE_POLL_SECONDS:-30}"
# Two ticks plus one minute of margin, per transition.
deadline_seconds="$((tick_seconds * 2 + 60))"

if [ "$#" -ne 1 ] || [ -z "${1##*/}" ] || [ "${1%%/*}" = "$1" ]; then
  printf 'usage: %s <owner>/<repository>\n' "$0" >&2
  printf 'The explicit repository argument is the consent to mutate it.\n' >&2
  exit 2
fi
repo="$1"
name="${repo#*/}"

# read_panel prints "<openIssues> <generatedAt>" for the target repository's
# row, or "none" when the row or figure is absent (the panel may honestly
# dash a tally; the probe refuses to start from a dash).
read_panel() {
  curl -fsS --max-time 20 "${site}/api/panels/coding-projects" |
    python3 -c '
import json, sys
target = sys.argv[1]
envelope = json.load(sys.stdin)
data = envelope.get("data") or {}
for row in data.get("repos", []):
    if row.get("name") == target:
        count = row.get("openIssues")
        if isinstance(count, int):
            print(count, envelope.get("generatedAt", ""))
            break
else:
    print("none")
' "$name"
}

# wait_for polls until the row reports the wanted figure, printing each
# observed regeneration, and fails past the two-tick deadline.
wait_for() {
  local wanted="$1" started elapsed reading last_generated=""
  started="$(date +%s)"
  while :; do
    reading="$(read_panel)"
    if [ "${reading%% *}" = "$wanted" ]; then
      elapsed=$(($(date +%s) - started))
      printf 'reached %s open issues after %dm%02ds (panel generatedAt %s)\n' \
        "$wanted" "$((elapsed / 60))" "$((elapsed % 60))" "${reading#* }"
      return 0
    fi
    if [ "${reading#* }" != "$last_generated" ]; then
      last_generated="${reading#* }"
      printf '  observed regeneration %s: still %s\n' "$last_generated" "${reading%% *}"
    fi
    elapsed=$(($(date +%s) - started))
    if [ "$elapsed" -ge "$deadline_seconds" ]; then
      printf 'FAIL: %s not reached within two ticks (%ds); the refresh loop missed both\n' \
        "$wanted" "$deadline_seconds" >&2
      return 1
    fi
    sleep "$poll_seconds"
  done
}

baseline_reading="$(read_panel)"
if [ "$baseline_reading" = "none" ]; then
  printf 'FAIL: the live panel reports no openIssues figure for %s; the probe needs a numeric baseline\n' "$name" >&2
  exit 1
fi
baseline="${baseline_reading%% *}"
printf 'baseline: %s open issues in %s (panel generatedAt %s)\n' \
  "$baseline" "$name" "${baseline_reading#* }"

issue_url=""
cleanup() {
  if [ -n "$issue_url" ]; then
    gh issue close "$issue_url" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

stamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
issue_url="$(gh issue create -R "$repo" \
  --title "live-refresh probe ${stamp}" \
  --body "Ephemeral probe issue opened and closed by scripts/ops/live-refresh-probe.sh (naranjo.online issue #281) to validate panel live refresh. Safe to ignore.")"
printf 'opened %s at %s\n' "$issue_url" "$stamp"

wait_for "$((baseline + 1))"
forward_done="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'forward transition validated at %s\n' "$forward_done"

gh issue close "$issue_url" >/dev/null
printf 'closed %s at %s\n' "$issue_url" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

wait_for "$baseline"
issue_url=""
printf 'revert transition validated at %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'PASS: both transitions observed inside two ticks; the mutation is fully reverted\n'
