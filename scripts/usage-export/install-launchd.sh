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
# Usage: scripts/usage-export/install-launchd.sh [--render-only]
#
#   --render-only   print the rendered plist to stdout and exit without
#                   touching launchd or the filesystem (the preview and
#                   test seam; CI proves the rendered ProgramArguments
#                   anchor with it).
#
# Environment:
#   NARANJO_USAGE_EXPORT_REPO_DIR   checkout to anchor the schedule to;
#                                   defaults to $HOME/code/naranjo.online.

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
LOG_DIR="$HOME/Library/Logs/naranjo-online-usage-export"
AGENT_DIR="$HOME/Library/LaunchAgents"
AGENT="$AGENT_DIR/$LABEL.plist"

[ -f "$TEMPLATE" ] || { echo "template missing under REPO_DIR" >&2; exit 1; }
[ -x "$PUSH_SCRIPT" ] || { echo "push script missing or not executable under REPO_DIR" >&2; exit 1; }

# Render with a delimiter that cannot appear in a path.
render() {
    sed -e "s|__PUSH_SCRIPT__|$PUSH_SCRIPT|g" \
        -e "s|__LOG_DIR__|$LOG_DIR|g" \
        "$TEMPLATE"
}

if [ "$RENDER_ONLY" = yes ]; then
    render
    exit 0
fi

mkdir -p "$LOG_DIR" "$AGENT_DIR"
render > "$AGENT"

plutil -lint "$AGENT" >/dev/null

# Reload cleanly whether or not a previous version is running.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENT"

echo "installed $LABEL (every minute + at load); logs in $LOG_DIR"
