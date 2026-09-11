#!/bin/sh
# Render and install the launchd agent for the scheduled usage export.
#
# Substitutes the committed template's two placeholders with STABLE absolute
# paths at install time — which is exactly why the rendered plist is never
# committed (requirement 12: workstation paths stay out of the repository) —
# then loads the agent for the current user. Safe to re-run: an
# already-loaded agent is booted out first.
#
# THE ANCHOR IS THE PRIMARY CHECKOUT, NEVER THE INSTALLER'S OWN LOCATION
# (2026-08-24 security review, finding M4). The original script anchored
# ProgramArguments to its own directory, so an install performed from a
# disposable review or lane worktree kept working exactly until that
# worktree's routine post-merge cleanup — and then the scheduled job broke
# silently. The installed path now derives from NARANJO_USAGE_EXPORT_REPO_DIR
# (defaulting to the primary checkout), and a path under a disposable
# worktree is refused outright rather than installed on borrowed time.
#
# TWO AGENTS, ONE INSTALLER (issue #267). The export job runs every minute
# inside the producer sandbox; the panel snapshot runs once a night OUTSIDE it,
# because it needs a network the sandbox denies and reads only the site's own
# public panel API. The second agent is installed only when a ledger directory
# is configured — the snapshot writes into that record and has nowhere to put a
# reading without one — and the ledger directory is read from the SAME
# configuration file the push script reads, under the same privacy refusal, so
# a workstation states it once.
#
# Usage: scripts/usage-export/install-launchd.sh [--render-only]
#
#   --render-only   print the rendered plists to stdout and exit without
#                   touching launchd or the filesystem (the preview and
#                   test seam; CI proves the rendered ProgramArguments
#                   anchor with it).
#
# Environment:
#   NARANJO_USAGE_EXPORT_REPO_DIR   checkout to anchor the schedule to;
#                                   defaults to $HOME/code/naranjo.online.
#   NARANJO_USAGE_EXPORT_CONFIG     the push script's configuration file,
#                                   read here only for LEDGER_DIR/HISTORY_DIR.

set -eu

RENDER_ONLY=no
case "${1:-}" in
    --render-only) RENDER_ONLY=yes ;;
    "") ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
esac

REPO_DIR="${NARANJO_USAGE_EXPORT_REPO_DIR:-$HOME/code/naranjo.online}"

# A disposable worktree is scheduled for deletion the moment its lane
# merges; anchoring a persistent schedule to one is the exact failure the
# review flagged. Refuse it even when asked explicitly.
case "$REPO_DIR" in
    */.claude/worktrees/*)
        echo "refusing to anchor the schedule to a disposable worktree: set" \
             "NARANJO_USAGE_EXPORT_REPO_DIR to the primary checkout" >&2
        exit 1
        ;;
esac

TEMPLATE="$REPO_DIR/scripts/usage-export/com.naranjo-online.usage-export.plist.template"
PUSH_SCRIPT="$REPO_DIR/scripts/usage-export/push-usage-series.sh"
LABEL="com.naranjo-online.usage-export"
SNAPSHOT_TEMPLATE="$REPO_DIR/scripts/usage-export/com.naranjo-online.ledger-snapshot.plist.template"
SNAPSHOT_SCRIPT="$REPO_DIR/scripts/ledger_snapshot.py"
SNAPSHOT_LABEL="com.naranjo-online.ledger-snapshot"
LOG_DIR="$HOME/Library/Logs/naranjo-online-usage-export"
AGENT_DIR="$HOME/Library/LaunchAgents"
AGENT="$AGENT_DIR/$LABEL.plist"
SNAPSHOT_AGENT="$AGENT_DIR/$SNAPSHOT_LABEL.plist"

[ -f "$TEMPLATE" ] || { echo "template missing under REPO_DIR" >&2; exit 1; }
[ -x "$PUSH_SCRIPT" ] || { echo "push script missing or not executable under REPO_DIR" >&2; exit 1; }
[ -f "$SNAPSHOT_TEMPLATE" ] || { echo "snapshot template missing under REPO_DIR" >&2; exit 1; }
[ -f "$SNAPSHOT_SCRIPT" ] || { echo "snapshot script missing under REPO_DIR" >&2; exit 1; }

# Where the record lives, read from the push script's own configuration so the
# two jobs cannot be pointed at different directories. Sourced in a SUBSHELL:
# that file also defines REPO_DIR, and letting it reach this script would hand
# the anchor back to configuration — the exact coupling the M4 finding above
# removed. The privacy refusal is the push script's, restated rather than
# relaxed: a configuration naming key material is required private, and this
# script reads the same file.
CONFIG="${NARANJO_USAGE_EXPORT_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/naranjo-usage-export/config}"
LEDGER_DIR=""
if [ -f "$CONFIG" ]; then
    config_mode=$(stat -c '%a' "$CONFIG" 2>/dev/null || stat -f '%Lp' "$CONFIG")
    case "$config_mode" in
        600|400|0600|0400) ;;
        *) echo "configuration must be private (chmod 600)" >&2; exit 1 ;;
    esac
    LEDGER_DIR=$(
        . "$CONFIG"
        if [ -n "${LEDGER_DIR:-}" ]; then
            printf '%s' "$LEDGER_DIR"
        elif [ -n "${HISTORY_DIR:-}" ]; then
            printf '%s' "$HISTORY_DIR/ledger"
        fi
    )
fi

# Render with a delimiter that cannot appear in a path.
render() {
    sed -e "s|__PUSH_SCRIPT__|$PUSH_SCRIPT|g" \
        -e "s|__LOG_DIR__|$LOG_DIR|g" \
        "$TEMPLATE"
}

render_snapshot() {
    sed -e "s|__SNAPSHOT_SCRIPT__|$SNAPSHOT_SCRIPT|g" \
        -e "s|__LEDGER_DIR__|$LEDGER_DIR|g" \
        -e "s|__LOG_DIR__|$LOG_DIR|g" \
        "$SNAPSHOT_TEMPLATE"
}

if [ "$RENDER_ONLY" = yes ]; then
    render
    # An `if` rather than a `&&` list: under `set -e` a false test as the
    # last command of a list exits the script, and a render with no ledger
    # configured is an ordinary state, not a failure.
    if [ -n "$LEDGER_DIR" ]; then
        render_snapshot
    fi
    exit 0
fi

mkdir -p "$LOG_DIR" "$AGENT_DIR"
render > "$AGENT"

plutil -lint "$AGENT" >/dev/null

# Reload cleanly whether or not a previous version is running.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENT"

echo "installed $LABEL (every minute + at load); logs in $LOG_DIR"

if [ -z "$LEDGER_DIR" ]; then
    # Said out loud rather than skipped silently: the snapshot is the only
    # writer for three of the record's five streams, so a workstation without
    # it keeps a record with holes in it and deserves to know.
    echo "no LEDGER_DIR or HISTORY_DIR configured; the panel snapshot agent was not installed"
    exit 0
fi

render_snapshot > "$SNAPSHOT_AGENT"
plutil -lint "$SNAPSHOT_AGENT" >/dev/null
launchctl bootout "gui/$(id -u)/$SNAPSHOT_LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$SNAPSHOT_AGENT"

echo "installed $SNAPSHOT_LABEL (23:45 daily + at load); logs in $LOG_DIR"
