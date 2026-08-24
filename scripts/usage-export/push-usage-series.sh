#!/bin/sh
# Export, seal, and push the usage series to the cluster host (issue #142).
#
# The one-way pipeline, run on the workstation by a scheduler:
#
#   export_usage_series.py  ->  usageseal -mode seal  ->  ssh (forced command)
#      (dates+ints only)         (AES-256-GCM)             (single-file write)
#
# Owner rulings this file implements:
#   * The workstation INITIATES; nothing on the cluster can reach back. The
#     push identity is a dedicated keypair whose authorized_keys entry on the
#     receiving host carries `restrict` and a forced command that writes
#     exactly one file — see docs/usage-export.md. The only bytes that return
#     are the exit status and a checksum line, which this script verifies.
#   * No file-transfer protocol parser runs on the workstation: the sealed
#     bytes travel over ssh stdin, not rsync/scp/sftp.
#   * The payload is sealed BEFORE it leaves the machine, with a key that
#     lives outside every repository; the plaintext never touches the wire
#     and never leaves the private scratch directory this script wipes.
#   * Nothing private is committed: every host- or account-specific fact
#     lives in a local configuration file OUTSIDE the repository, read at
#     run time. This script contains no hostname, username, or key.
#
# Configuration (POSIX shell assignments, sourced) is read from
#   $NARANJO_USAGE_EXPORT_CONFIG, or
#   ${XDG_CONFIG_HOME:-$HOME/.config}/naranjo-usage-export/config
# and must define:
#   REPO_DIR        checkout containing scripts/export_usage_series.py
#   USAGESEAL_BIN   the built cmd/usageseal binary
#   KEY_FILE        0600 hex key file (outside any repository)
#   SSH_IDENTITY    dedicated push private key (outside any repository)
#   PUSH_HOST       ssh destination (an ~/.ssh/config alias keeps it short)
#   SOURCE_LABEL    source key for the walked transcript tree
#   TRANSCRIPTS     transcript tree root (the first tool's local records;
#                   a machine-local fact, so it lives in the config, not here)
# and may define:
#   MERGE_SOURCES   space-separated KEY=FILE pairs for further tools'
#                   captured series (e.g. the second tool's capture output).
#                   REQUIRED whenever the origin's embedded snapshot ships
#                   more than one source: a document whose source set does
#                   not EQUAL the shipped set is refused whole, because one
#                   envelope status cannot describe two ages of data
#                   (2026-08-24 security review, finding 7).
#
# Exit status is nonzero on any failure; diagnostics never include payload
# content. Stage names and byte counts only.

set -eu

fail() {
    echo "usage-export: $1" >&2
    exit 1
}

CONFIG="${NARANJO_USAGE_EXPORT_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/naranjo-usage-export/config}"
[ -f "$CONFIG" ] || fail "no configuration at the expected location"
# The configuration names key-material paths and the push destination;
# require it private outright rather than reasoning about partial modes.
# GNU stat is probed FIRST: BSD-first probing is unsound because GNU stat
# also accepts -f (filesystem status), where a foreign format code still
# exits 0 with junk output, so the GNU fallback never ran on Linux and
# every mode was refused. BSD stat rejects -c outright, which makes this
# order unambiguous on both platforms.
config_mode=$(stat -c '%a' "$CONFIG" 2>/dev/null || stat -f '%Lp' "$CONFIG")
case "$config_mode" in
    600|400|0600|0400) ;;
    *) fail "configuration must be private (chmod 600)" ;;
esac
. "$CONFIG"

: "${REPO_DIR:?REPO_DIR missing from configuration}"
: "${USAGESEAL_BIN:?USAGESEAL_BIN missing from configuration}"
: "${KEY_FILE:?KEY_FILE missing from configuration}"
: "${SSH_IDENTITY:?SSH_IDENTITY missing from configuration}"
: "${PUSH_HOST:?PUSH_HOST missing from configuration}"
: "${SOURCE_LABEL:?SOURCE_LABEL missing from configuration}"
: "${TRANSCRIPTS:?TRANSCRIPTS missing from configuration}"
MERGE_SOURCES="${MERGE_SOURCES:-}"

EXPORT_SCRIPT="$REPO_DIR/scripts/export_usage_series.py"
[ -f "$EXPORT_SCRIPT" ] || fail "export script not found under REPO_DIR"
[ -x "$USAGESEAL_BIN" ] || fail "usageseal binary not executable"

# Private scratch, wiped on every exit path.
umask 077
SCRATCH=$(mktemp -d) || fail "cannot create scratch directory"
trap 'rm -rf "$SCRATCH"' EXIT INT TERM

PLAIN="$SCRATCH/usage.json"
SEALED="$SCRATCH/usage.enc"

# 1. Export: stdlib-only, isolated interpreter (-I ignores user site and
#    environment hooks; -B writes no bytecode). The guard inside the script
#    is what limits the emission to dates and integers.
set -- --transcripts "$TRANSCRIPTS" --source "$SOURCE_LABEL" --out "$PLAIN"
for pair in $MERGE_SOURCES; do
    set -- "$@" --merge-source "$pair"
done
/usr/bin/env python3 -I -B "$EXPORT_SCRIPT" "$@" || fail "export refused"

# 2. Seal on this machine, before anything leaves it.
"$USAGESEAL_BIN" -mode seal -key-file "$KEY_FILE" < "$PLAIN" > "$SEALED" \
    || fail "sealing refused"

sealed_bytes=$(wc -c < "$SEALED" | tr -d ' ')
[ "$sealed_bytes" -gt 0 ] || fail "sealed payload is empty"

if command -v shasum >/dev/null 2>&1; then
    local_sum=$(shasum -a 256 "$SEALED" | cut -d' ' -f1)
else
    local_sum=$(sha256sum "$SEALED" | cut -d' ' -f1)
fi

# 3. Push. BatchMode forbids prompts; IdentitiesOnly pins the dedicated key,
#    and IdentityAgent=none keeps a running ssh-agent from outranking it —
#    agent-held keys are offered first, so an admin alias whose key sits in
#    the agent would otherwise authenticate WITHOUT the forced command and
#    the push would land as an interactive-rights session instead (observed,
#    not hypothetical: the remote then tries to run the literal command and
#    the push fails loudly). The receiving account's authorized_keys entry is
#    `restrict` + a forced command, so whatever is requested here, the host
#    runs exactly its own single-file write and answers with the landed
#    file's checksum.
#
#    The connection itself is hardened AT THE CLIENT rather than trusted to
#    whatever ~/.ssh/config or a future admin alias resolves to (2026-08-24
#    security review, finding M5 — the server-side `restrict` is the other
#    half, and both halves are stated because either side's configuration
#    can drift):
#      ControlPath=none        never join (or create) a multiplexed master
#                              connection, so a live admin session to the
#                              same host can never be reused to bypass the
#                              restricted key's authentication;
#      ClearAllForwardings=yes drop every port/agent/X11 forwarding any
#                              config file might request for this host;
#      ForwardAgent=no         the push never carries the agent socket;
#      RequestTTY=no           a pipe, never an interactive terminal.
remote_line=$(ssh -o BatchMode=yes -o IdentitiesOnly=yes \
    -o IdentityAgent=none -o ControlPath=none \
    -o ClearAllForwardings=yes -o ForwardAgent=no -o RequestTTY=no \
    -i "$SSH_IDENTITY" \
    "$PUSH_HOST" usage-export-receive < "$SEALED") || fail "push refused"

remote_sum=$(echo "$remote_line" | head -n 1 | cut -d' ' -f1)
[ "$remote_sum" = "$local_sum" ] || fail "checksum mismatch after push"

echo "usage-export: pushed $sealed_bytes sealed bytes; checksum verified"
