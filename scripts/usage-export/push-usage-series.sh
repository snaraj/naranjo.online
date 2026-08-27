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
#   PUSH_HOST       ssh destination as user@host. NOT an ~/.ssh/config alias
#                   any more (2026-08-24 round-3 review, finding 8): the push
#                   runs with -F /dev/null, so no config file is consulted and
#                   an alias would resolve to nothing.
#   SSH_KNOWN_HOSTS pinned known-hosts file for that destination. Required:
#                   StrictHostKeyChecking=yes with no known-hosts file is a
#                   refusal, not a silent trust-on-first-use.
#   SOURCE_LABEL    source key for the walked transcript tree
#   TRANSCRIPTS     transcript tree root (the first tool's local records;
#                   a machine-local fact, so it lives in the config, not here)
# and may define:
#   PUSH_PORT       destination port (default 22)
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
: "${SSH_KNOWN_HOSTS:?SSH_KNOWN_HOSTS missing from configuration}"
: "${SOURCE_LABEL:?SOURCE_LABEL missing from configuration}"
: "${TRANSCRIPTS:?TRANSCRIPTS missing from configuration}"
MERGE_SOURCES="${MERGE_SOURCES:-}"
PUSH_PORT="${PUSH_PORT:-22}"

# The destination must carry its own user, because -F /dev/null means no
# config file supplies one and ssh would otherwise fall back to the LOCAL
# username — a different account, very possibly one without the forced
# command (2026-08-24 round-3 review, finding 8).
case "$PUSH_HOST" in
    *@*) ;;
    *) fail "PUSH_HOST must be user@host; the push reads no ssh config file, so an alias resolves to nothing" ;;
esac
[ -f "$SSH_KNOWN_HOSTS" ] || fail "SSH_KNOWN_HOSTS does not name a file; the host key must be pinned before anything is pushed"
[ -f "$SSH_IDENTITY" ] || fail "SSH_IDENTITY does not name a file; ssh SILENTLY ignores a missing -i path and falls back to the default keys"

EXPORT_SCRIPT="$REPO_DIR/scripts/export_usage_series.py"
[ -f "$EXPORT_SCRIPT" ] || fail "export script not found under REPO_DIR"
[ -x "$USAGESEAL_BIN" ] || fail "usageseal binary not executable"

# The producer's capability boundary, and the reason it lives HERE rather than
# inside the producer (2026-08-24 security review, round 3, finding 1). The
# owner's ruling is that the step walking raw transcripts must be structurally
# unable to start a session or reach a network. An AST lint over the producer's
# IMPORT NAMES cannot carry that claim: `pathlib` is an admitted import whose
# module object re-exports `os`, so `pathlib.os.system(":")` restores the launch
# callable with the import set unchanged and every producer test green. The
# boundary therefore has to come from outside the program, and at the
# invocation layer it does: the kernel sandbox, applied before the interpreter
# starts. scripts/usage-export/producer.sb states exactly what it denies and
# exactly what it does not.
#
# Fail-closed, with no override: a workstation without the sandbox does not
# walk raw records at all. There is no environment variable, flag, or
# configuration key that runs the producer unconfined — a bypass would make the
# boundary a suggestion, which is the property the review refused.
PRODUCER_PROFILE="$REPO_DIR/scripts/usage-export/producer.sb"
[ -f "$PRODUCER_PROFILE" ] || fail "producer sandbox profile not found under REPO_DIR"
command -v sandbox-exec >/dev/null 2>&1 \
    || fail "the producer sandbox is unavailable; raw records are never walked unconfined"

# Private scratch, wiped on every exit path.
umask 077
SCRATCH=$(mktemp -d) || fail "cannot create scratch directory"
trap 'rm -rf "$SCRATCH"' EXIT INT TERM

PLAIN="$SCRATCH/usage.json"
SEALED="$SCRATCH/usage.enc"

# 1. Export, inside the sandbox declared above: no process can be created and
#    no socket can be opened for the whole walk, enforced by the kernel rather
#    than asserted by the walked program's import list. The interpreter is
#    still isolated (-I ignores user site and environment hooks; -B writes no
#    bytecode), and the guard inside the script is still what limits the
#    emission to dates and integers — three independent controls, none of them
#    load-bearing alone.
set -- --transcripts "$TRANSCRIPTS" --source "$SOURCE_LABEL" --out "$PLAIN"
for pair in $MERGE_SOURCES; do
    set -- "$@" --merge-source "$pair"
done
sandbox-exec -f "$PRODUCER_PROFILE" \
    /usr/bin/env python3 -I -B "$EXPORT_SCRIPT" "$@" || fail "export refused"

# 2. Seal on this machine, before anything leaves it.
"$USAGESEAL_BIN" -mode seal -key-file "$KEY_FILE" < "$PLAIN" > "$SEALED" \
    || fail "sealing refused"

# THE payload ceiling, in SEALED bytes — one number every stage enforces
# (2026-08-24 security review, finding 4). Canonical in Go at
# internal/seal/types.go (MaxSealedBytes), restated in
# internal/panels/types.go (maxSealedSeriesBytes — that package's zero-egress
# doctrine pin forbids importing internal/seal), in
# scripts/export_usage_series.py, in the forced command in
# docs/usage-export.md, and here; pinned across all five by CapParityTest in
# scripts/ci/test_capture_usage_series.py. Checking only "not empty" here let
# an over-cap payload reach the host, where the forced command's `head -c`
# TRUNCATED it and installed the truncated bytes over the last good file
# before anything noticed. The connection is not opened at all now.
MAX_SEALED_BYTES=131072

sealed_bytes=$(wc -c < "$SEALED" | tr -d ' ')
[ "$sealed_bytes" -gt 0 ] || fail "sealed payload is empty"
[ "$sealed_bytes" -le "$MAX_SEALED_BYTES" ] \
    || fail "sealed payload is $sealed_bytes bytes, over the $MAX_SEALED_BYTES byte bound; nothing was pushed"

if command -v shasum >/dev/null 2>&1; then
    local_sum=$(shasum -a 256 "$SEALED" | cut -d' ' -f1)
else
    local_sum=$(sha256sum "$SEALED" | cut -d' ' -f1)
fi

# 3. Push. The connection is assembled ENTIRELY on this command line and
#    resolves against NO configuration file (2026-08-24 round-3 review,
#    finding 8). `-F /dev/null` is what makes that true: OpenSSH documents
#    that giving -F also causes /etc/ssh/ssh_config to be ignored, so neither
#    the user's ~/.ssh/config nor a system-wide file can contribute a single
#    option to this session. Before finding 8 the push inherited whatever a
#    host alias resolved to and hardened only the options someone had thought
#    to name — which is the wrong way round: an inherited ProxyCommand, an
#    inherited LocalCommand, an inherited extra IdentityFile or a Match block
#    added later all applied silently, and each of them changes who
#    authenticates or what runs locally.
#
#    Every option therefore appears here, including several that are already
#    the built-in default, because a default is only a default until a config
#    file moves it and this file's whole point is that no config file gets to.
#
#      BatchMode=yes            never prompt; a hung scheduler job is worse
#                               than a failed one
#      IdentitiesOnly=yes       offer ONLY the key named below
#      IdentityAgent=none       a running agent's keys are offered FIRST, so
#                               an admin key in the agent would authenticate
#                               without the forced command (observed, not
#                               hypothetical)
#      AddKeysToAgent=no        the push contributes nothing to an agent
#      ControlMaster=no         never create a multiplexed master...
#      ControlPath=none         ...and never join one, so a live admin session
#                               to the same host cannot be reused to bypass
#                               the restricted key's authentication
#      ControlPersist=no        leave nothing behind for the next process
#      ProxyCommand=none        no local program is spawned to reach the host
#      ProxyJump=none           and no jump host rewrites that into one
#      PermitLocalCommand=no    LocalCommand runs a local shell command on
#                               connect, and this is the switch that governs
#                               it. `-o LocalCommand=` is NOT set beside it:
#                               OpenSSH rejects an empty value outright ("no
#                               argument after keyword localcommand"), which
#                               would make every push fail. With -F /dev/null
#                               nothing declares a LocalCommand in the first
#                               place, and the resolved-configuration check
#                               below refuses the session if one appears
#                               anyway.
#      ClearAllForwardings=yes  drop every port/agent/X11 forwarding
#      ForwardAgent=no          the push never carries the agent socket
#      ForwardX11=no            ...
#      ForwardX11Trusted=no     ...
#      ExitOnForwardFailure=yes a forwarding that somehow survives the above
#                               fails the connection instead of proceeding
#      RequestTTY=no            a pipe, never an interactive terminal
#      StrictHostKeyChecking=yes  an unknown host key is a refusal
#      UserKnownHostsFile=...   pinned to the configured file
#      GlobalKnownHostsFile=/dev/null  the system list plays no part
#      PubkeyAuthentication=yes and every other method off, so a host that
#      PasswordAuthentication=no  stops accepting the key fails loudly rather
#      KbdInteractiveAuthentication=no  than falling back to something the
#      GSSAPIAuthentication=no    scheduler cannot answer anyway
#      NumberOfPasswordPrompts=0
#
#    The receiving account's authorized_keys entry is `restrict` + a forced
#    command, so whatever is requested here, the host runs exactly its own
#    single-file write and answers with the landed file's checksum. Both
#    halves are stated because either side's configuration can drift.
push_ssh() {
    ssh -F /dev/null \
        -o BatchMode=yes \
        -o IdentitiesOnly=yes \
        -o IdentityAgent=none \
        -o AddKeysToAgent=no \
        -o ControlMaster=no \
        -o ControlPath=none \
        -o ControlPersist=no \
        -o ProxyCommand=none \
        -o ProxyJump=none \
        -o PermitLocalCommand=no \
        -o ClearAllForwardings=yes \
        -o ForwardAgent=no \
        -o ForwardX11=no \
        -o ForwardX11Trusted=no \
        -o ExitOnForwardFailure=yes \
        -o RequestTTY=no \
        -o StrictHostKeyChecking=yes \
        -o UserKnownHostsFile="$SSH_KNOWN_HOSTS" \
        -o GlobalKnownHostsFile=/dev/null \
        -o PubkeyAuthentication=yes \
        -o PasswordAuthentication=no \
        -o KbdInteractiveAuthentication=no \
        -o GSSAPIAuthentication=no \
        -o NumberOfPasswordPrompts=0 \
        -o Port="$PUSH_PORT" \
        -i "$SSH_IDENTITY" \
        "$@"
}

# The options above say what was ASKED for. `ssh -G` says what ssh actually
# RESOLVED, which is the only thing that governs the connection, and the two
# can differ — a future OpenSSH could rename an option, a typo in a -o value
# is not always fatal, and the identity has a genuinely surprising failure
# mode measured while writing this: `-i` naming a path that does NOT EXIST is
# silently ignored, and ssh falls back to the default ~/.ssh identities. A
# mistyped SSH_IDENTITY would therefore have authenticated with the operator's
# ordinary key — quite possibly an admin key, and without the forced command.
# The file check earlier catches that case; this check catches the whole class
# by refusing unless the resolved configuration is EXACTLY what was asked for,
# before any connection is attempted.
# stdin is /dev/null on purpose: this probe must never consume the sealed
# payload, and it must never inherit a terminal a scheduler does not have.
resolved=$(push_ssh -G "$PUSH_HOST" </dev/null 2>/dev/null) || fail "ssh could not resolve the push configuration"

# FIRST match only, because that is ssh's own rule: "for each parameter, the
# first obtained value will be used". A checker that concatenated every match
# would disagree with the client it is checking.
resolved_value() {
    printf '%s\n' "$resolved" | awk -v key="$1" 'tolower($1) == key { $1 = ""; sub(/^ /, ""); print; exit }'
}
resolved_count() {
    printf '%s\n' "$resolved" | awk -v key="$1" 'tolower($1) == key' | wc -l | tr -d ' '
}

identity_count=$(resolved_count identityfile)
[ "$identity_count" = "1" ] \
    || fail "the resolved ssh configuration offers $identity_count identities; the push must offer exactly the dedicated key"
[ "$(resolved_value identityfile)" = "$SSH_IDENTITY" ] \
    || fail "the resolved ssh identity is not the configured push key"

# A remnant of any of these means a configuration file reached this session
# after all, or an option name stopped meaning what it means here. Each is a
# refusal rather than a warning: a proxy or local command is code running on
# this machine at connect time, and an agent or forwarding is a path back
# toward the workstation, which the whole design exists to prevent.
for remnant in proxycommand proxyjump localcommand; do
    [ "$(resolved_count "$remnant")" = "0" ] \
        || fail "the resolved ssh configuration still carries a $remnant"
done
[ "$(resolved_count controlpath)" = "0" ] \
    || fail "the resolved ssh configuration still carries a controlpath"

check_resolved() {
    [ "$(resolved_value "$1")" = "$2" ] \
        || fail "the resolved ssh configuration has $1 = $(resolved_value "$1"), not $2"
}
check_resolved permitlocalcommand no
check_resolved forwardagent no
check_resolved forwardx11 no
check_resolved clearallforwardings yes
check_resolved identityagent none
check_resolved controlmaster false
check_resolved requesttty false
check_resolved stricthostkeychecking true
check_resolved userknownhostsfile "$SSH_KNOWN_HOSTS"
check_resolved globalknownhostsfile /dev/null
check_resolved passwordauthentication no
check_resolved gssapiauthentication no

remote_line=$(push_ssh "$PUSH_HOST" usage-export-receive < "$SEALED") || fail "push refused"

remote_sum=$(echo "$remote_line" | head -n 1 | cut -d' ' -f1)
[ "$remote_sum" = "$local_sum" ] || fail "checksum mismatch after push"

echo "usage-export: pushed $sealed_bytes sealed bytes; checksum verified"
