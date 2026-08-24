#!/bin/sh
# Render and install the launchd agent for the scheduled usage export.
#
# Substitutes the committed template's two placeholders with THIS machine's
# absolute paths at install time — which is exactly why the rendered plist is
# never committed (requirement 12: workstation paths stay out of the
# repository) — then loads the agent for the current user. Safe to re-run:
# an already-loaded agent is booted out first.
#
# Usage: scripts/usage-export/install-launchd.sh

set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
TEMPLATE="$HERE/com.naranjo-online.usage-export.plist.template"
PUSH_SCRIPT="$HERE/push-usage-series.sh"
LABEL="com.naranjo-online.usage-export"
LOG_DIR="$HOME/Library/Logs/naranjo-online-usage-export"
AGENT_DIR="$HOME/Library/LaunchAgents"
AGENT="$AGENT_DIR/$LABEL.plist"

[ -f "$TEMPLATE" ] || { echo "template missing" >&2; exit 1; }
[ -x "$PUSH_SCRIPT" ] || { echo "push script missing or not executable" >&2; exit 1; }

mkdir -p "$LOG_DIR" "$AGENT_DIR"

# Render with a delimiter that cannot appear in a path.
sed -e "s|__PUSH_SCRIPT__|$PUSH_SCRIPT|g" \
    -e "s|__LOG_DIR__|$LOG_DIR|g" \
    "$TEMPLATE" > "$AGENT"

plutil -lint "$AGENT" >/dev/null

# Reload cleanly whether or not a previous version is running.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENT"

echo "installed $LABEL (hourly + at load); logs in $LOG_DIR"
