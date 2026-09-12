#!/usr/bin/env bash
# live-refresh-probe.sh — the validated live-update ceremony for the panels
# refresh loop (issue #281, defect 4; owner directive 2026-09-01: "make a
# momentary fake commit or something that gets reverted that VALIDATES the
# live update").
#
# WHAT IT DOES, the procedure validated by hand on 2026-09-01 with the figure
# re-vehicled for coding-projects/v2 (2026-09-12), whose rows carry stars,
# closed pull requests, a release tag and a push instant — and no longer the
# open-issue tally the first vehicle moved:
#
#   1. Read the live coding-projects envelope and record the target
#      repository's `stars` figure as the baseline, and read whether the
#      operator's own account already stars the repository.
#   2. Apply one REVERSIBLE mutation: the operator's own star. An unstarred
#      repository is starred (baseline + 1); one the operator already stars
#      is unstarred (baseline - 1). A star, deliberately not a fake commit
#      and not a pull request, so the probe creates and deletes no git refs,
#      rewrites no history and leaves no closed item behind. It IS visible
#      on the operator's profile for the minutes it lasts.
#   3. Poll the live panel until the figure reflects the mutation, recording
#      the forward latency.
#   4. Revert the mutation and poll until the figure returns to the
#      baseline, recording the revert latency.
#   5. Report both latencies. The original star state is restored on EVERY
#      exit path, including timeouts and interrupts, so the probe leaves the
#      profile as it found it.
#
# MEASURED REFERENCE RUN (2026-09-01, issue #281 comment; mutation vehicle
# was an ephemeral issue in a sibling repository, the v1 figure):
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

# read_panel prints "<stars> <generatedAt>" for the target repository's row,
# or "none" when the row or figure is absent (the probe refuses to start from
# a row it cannot read).
read_panel() {
  curl -fsS --max-time 20 "${site}/api/panels/coding-projects" |
    python3 -c '
import json, sys
target = sys.argv[1]
envelope = json.load(sys.stdin)
data = envelope.get("data") or {}
for row in data.get("repos", []):
    if row.get("name") == target:
        count = row.get("stars")
        if isinstance(count, int):
            print(count, envelope.get("generatedAt", ""))
            break
else:
    print("none")
' "$name"
}

# star_state prints "starred" or "unstarred" for the operator's own account,
# from the status line the host answers with (204 or 404); anything else is
# a transport or credential failure and the probe stops before mutating.
star_state() {
  local status
  status="$(gh api -i "/user/starred/${repo}" 2>/dev/null | head -1 | awk '{print $2}')"
  case "$status" in
    204) printf 'starred\n' ;;
    404) printf 'unstarred\n' ;;
    *)
      printf 'FAIL: could not read whether the operator stars %s (status %s)\n' "$repo" "${status:-none}" >&2
      return 1
      ;;
  esac
}

star() { gh api -X PUT "/user/starred/${repo}" --silent; }
unstar() { gh api -X DELETE "/user/starred/${repo}" --silent; }

# wait_for polls until the row reports the wanted figure, printing each
# observed regeneration, and fails past the two-tick deadline.
wait_for() {
  local wanted="$1" started elapsed reading last_generated=""
  started="$(date +%s)"
  while :; do
    reading="$(read_panel)"
    if [ "${reading%% *}" = "$wanted" ]; then
      elapsed=$(($(date +%s) - started))
      printf 'reached %s stars after %dm%02ds (panel generatedAt %s)\n' \
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
  printf 'FAIL: the live panel reports no stars figure for %s; the probe needs a numeric baseline\n' "$name" >&2
  exit 1
fi
baseline="${baseline_reading%% *}"
original="$(star_state)"
printf 'baseline: %s stars on %s, operator %s (panel generatedAt %s)\n' \
  "$baseline" "$name" "$original" "${baseline_reading#* }"

mutated=""
cleanup() {
  if [ -n "$mutated" ]; then
    if [ "$original" = starred ]; then star || true; else unstar || true; fi
  fi
}
trap cleanup EXIT

stamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$original" = starred ]; then
  unstar; mutated=yes; expected="$((baseline - 1))"
  printf 'unstarred %s at %s\n' "$repo" "$stamp"
else
  star; mutated=yes; expected="$((baseline + 1))"
  printf 'starred %s at %s\n' "$repo" "$stamp"
fi

wait_for "$expected"
forward_done="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'forward transition validated at %s\n' "$forward_done"

if [ "$original" = starred ]; then star; else unstar; fi
mutated=""
printf 'restored the operator'"'"'s %s state at %s\n' "$original" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

wait_for "$baseline"
printf 'revert transition validated at %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'PASS: both transitions observed inside two ticks; the mutation is fully reverted\n'
