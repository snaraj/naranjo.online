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
#   ACTIVITY_CACHE  a rollup file the first tool maintains beside its
#                   transcripts, naming per-day totals per model. It EXTENDS
#                   the walked series backwards over days whose transcripts
#                   the tool's own retention has already deleted, and it is
#                   where the walked source's LIFETIME-CLASS stats come from
#                   (issue #276: modelUsage/totalSessions). On the depth job
#                   a day the walk still holds keeps the walked figure,
#                   because that one is derived from the records themselves.
#                   Still optional in the script, but no longer free to omit
#                   when the origin's snapshot ships lifetime-class tiles for
#                   the walked source: a document without their refreshed
#                   figures is refused whole there, so omitting the cache
#                   costs the push, not merely depth — and the panel says so
#                   by going stale instead of serving frozen tiles.
#   MERGE_SOURCES   space-separated KEY=FILE pairs for further tools'
#                   captured series, each file produced by an earlier capture
#                   run. REQUIRED, together with MERGE_CAPTURES below,
#                   whenever the origin's embedded snapshot ships more than
#                   one source: a document whose source set does not EQUAL the
#                   shipped set is refused whole, because one envelope status
#                   cannot describe two ages of data (2026-08-24 security
#                   review, finding 7).
#   MERGE_CAPTURES  space-separated KEY=FORMAT=DIRECTORY triples for further
#                   tools whose records are on THIS machine. Each is walked
#                   fresh at the top of every run — inside the same sandbox
#                   the export runs in — and merged from the private scratch,
#                   so a second tool's half of the panel is exactly as current
#                   as the first tool's. It replaces a hand-maintained merge
#                   file, which ages silently between edits and can be wrong
#                   in a way no schedule repairs: the one on this machine was
#                   missing sections the loader requires, so every scheduled
#                   export refused until a human looked (2026-08-27).
#   HISTORY_DIR     directory for the durable per-source history stores
#                   (issue #234). Every source here is volatile — transcript
#                   trees are retention-pruned and the roll-up cache has been
#                   measured discarding a month in one recompute — so without
#                   a store the served series silently gets SHORTER as evidence
#                   is deleted. When set, the walked source and every
#                   MERGE_CAPTURES source read and rewrite
#                   "$HISTORY_DIR/<key>.json", so a measured day survives its
#                   sources. Optional so an unconfigured workstation still
#                   exports; the depth guarantee rests on configuring it.
#   LEDGER_DIR      directory for the append-only lifelong record (issue
#                   #267). Defaults to "$HISTORY_DIR/ledger" whenever
#                   HISTORY_DIR is set, so configuring the stores configures
#                   the record with them; unset and with no HISTORY_DIR, the
#                   export writes no record at all. The stores keep one best
#                   figure per day and forget how it was measured; the record
#                   keeps every reading, with its method and the instant it
#                   was taken, and never rewrites one.
#   SITE_URL        the site's bare https origin (issue #358). A verified
#                   checksum proves delivery to the host, never what the PAGE
#                   serves; when this is set, each run first asks the site's
#                   public token-usage envelope whether it serves, for every
#                   source, data at least as new as the last push
#                   (served-check.py) and logs SERVED or NOT-SERVED. It
#                   compares against "$HISTORY_DIR/push-state.json", so it
#                   needs HISTORY_DIR. It never fails or delays the push.
#   REPO_UPDATE     ff-only (the default) or off; anything else refuses the
#                   run (issue #358). The job runs whatever REPO_DIR has
#                   checked out, so with ff-only a checkout on main that is
#                   strictly behind origin/main is fast-forwarded (fetching at
#                   most hourly, which needs HISTORY_DIR) and this script
#                   re-executes once. off only reports the drift. Nothing
#                   here stashes, resets, rebases, or switches a branch.
#
# The launchd agent also names its log directory in the environment as
# NARANJO_USAGE_EXPORT_LOG_DIR (install-launchd.sh decides it, never this
# configuration); a run started any other way rotates no log.
#
# Exit status is nonzero on any failure; diagnostics never include payload
# content. Stage names and byte counts only.
#
# What the scheduler's log says per run (issue #299, the failure-logging
# rule): one START line as each stage begins, so a stage that never ends is
# visible as a START with no SUMMARY; on failure the stage and the elapsed
# seconds; on success one SUMMARY line with every stage's duration, the
# sealed size and checksum prefix, and the revision of the checkout the
# exporter ran from — the fault class where a scheduled job silently ran a
# tree nine commits behind what the origin admits (issue #288).
#
# Every line the run writes to its logs opens with the UTC instant it was
# written (issue #371): the push failures of 2026-10-13 could not be dated
# from the log. That covers this script's own lines (`log`) and every line a
# program it runs writes to the logs (`stamped`, `stamped_out`); the tokens
# after the instant are unchanged, so every existing grep still matches.

set -eu

run_started=$(/bin/date +%s)
stage=configure
elapsed() {
    echo $(( $(/bin/date +%s) - run_started ))
}

# The instant a log line opens with: RFC 3339, UTC, to the second.
utc_now() {
    /bin/date -u +%Y-%m-%dT%H:%M:%SZ
}

# Copy stdin to stdout, each line opened with the instant it was read. A
# final line with no newline is still a line.
stamp() {
    while IFS= read -r line || [ -n "$line" ]; do
        printf '%s %s\n' "$(utc_now)" "$line"
    done
}

# One line of this script's own, stamped, on stdout (`>&2` for stderr).
log() {
    printf '%s usage-export: %s\n' "$(utc_now)" "$*"
}

# Run "$@" with every line it writes to stderr stamped on the way to this
# run's stderr; its stdout goes wherever the caller sent it, untouched,
# because for some programs that is DATA (the capture's document, the sealed
# bytes, the host's checksum line). The command's own exit status is
# returned, so `stamped cmd || fail ...` reads exactly as `cmd || fail ...`.
stamped() {
    { stamped_status=$( { { "$@" 2>&1 1>&3 3>&- 4>&- && echo 0 >&4 || echo $? >&4; } | stamp >&2; } 4>&1 ); } 3>&1
    return "${stamped_status:-1}"
}

# The same for a program whose stdout is LOG lines rather than data.
stamped_out() {
    { stamped_status=$( { { "$@" 3>&- 4>&- && echo 0 >&4 || echo $? >&4; } | stamp >&3; } 4>&1 ); } 3>&1
    return "${stamped_status:-1}"
}

fail() {
    log "$1" >&2
    log "FAILED stage=$stage elapsed=$(elapsed)s" >&2
    exit 1
}

# begin/finish bracket one stage: begin names it (so a failure inside names
# it too) and prints its START; finish appends its duration to the SUMMARY.
timings=""
stage_started=0
begin() {
    stage=$1
    stage_started=$(/bin/date +%s)
    log "START $stage"
}
finish() {
    timings="$timings $stage=$(( $(/bin/date +%s) - stage_started ))s"
}

# Log rotation, before this run writes a line (issue #358): launchd appends to
# its two log files forever. Each is RENAMED to one kept generation, never
# truncated, and this run's stream is reopened on the fresh path, so a reader
# that counts lines sees a shorter file rather than a hole.
MAX_LOG_BYTES=5242880
if [ -n "${NARANJO_USAGE_EXPORT_LOG_DIR:-}" ]; then
    for log in usage-export.log usage-export.err.log; do
        log="$NARANJO_USAGE_EXPORT_LOG_DIR/$log"
        if [ -f "$log" ] && [ "$(wc -c < "$log" | tr -d ' ')" -gt "$MAX_LOG_BYTES" ]; then
            mv -f "$log" "$log.1" || { log "WARN log-rotation failed" >&2; continue; }
            case "$log" in
                *.err.log) exec 2>>"$log" ;;
                *) exec >>"$log" ;;
            esac
        fi
    done
fi

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
MERGE_CAPTURES="${MERGE_CAPTURES:-}"
ACTIVITY_CACHE="${ACTIVITY_CACHE:-}"
HISTORY_DIR="${HISTORY_DIR:-}"
# The record lives beside the stores unless it is told otherwise: the two are
# the same pipeline's memory, and a workstation that configured durable days
# should not have to configure durability twice (issue #267).
LEDGER_DIR="${LEDGER_DIR:-}"
if [ -z "$LEDGER_DIR" ] && [ -n "$HISTORY_DIR" ]; then
    LEDGER_DIR="$HISTORY_DIR/ledger"
fi
PUSH_PORT="${PUSH_PORT:-22}"
SITE_URL="${SITE_URL:-}"
REPO_UPDATE="${REPO_UPDATE:-ff-only}"
case "$REPO_UPDATE" in
    ff-only|off) ;;
    *) fail "REPO_UPDATE must be ff-only or off" ;;
esac

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

# Everything this run writes is private from here on.
umask 077

# The history stores must have somewhere to live BEFORE any producer runs —
# a store whose directory is missing would make every capture refuse — and
# creating the directory here, under the umask above, keeps the stores as
# private as the configuration that names them. Unlike the scratch, it is
# never wiped: surviving runs is its entire purpose.
if [ -n "$HISTORY_DIR" ]; then
    mkdir -p "$HISTORY_DIR" || fail "the history directory cannot be created"
fi

# Checkout drift (issue #358). The job runs whatever commit REPO_DIR has
# checked out, and three times it has run a tree behind what the origin
# admits. A checkout on main tracking origin/main is moved by fast-forward
# ONLY; a local edit the fast-forward would touch, a diverged history, a
# detached head or another branch is reported and left exactly as it is. An
# update that stops part-way (action=incomplete), or one rolled back because a
# ref moved under it (action=rolled-back), ends the run before anything is
# exported (see fast_forward_main). A run that moved the tree re-executes the
# (possibly new) script ONCE: the guard variable skips this whole step in the
# re-executed run, so it cannot loop. Runs before the scratch exists, because
# exec does not run the EXIT trap.
REPO_FETCH="$REPO_DIR/scripts/usage-export/bounded-fetch.py"
FETCH_INTERVAL_SECONDS=3600
update_checkout() {
    action=none
    interrupted=
    acknowledged=yes
    repair=
    facts=
    git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
    branch=$(git -C "$REPO_DIR" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
    upstream=$(git -C "$REPO_DIR" rev-parse --abbrev-ref 'main@{upstream}' 2>/dev/null || true)
    tracking=no
    if [ "$branch" = main ] && [ "$upstream" = origin/main ]; then
        tracking=yes
    fi
    # At most one bounded fetch an hour, and only where a fast-forward could
    # follow it. A stamp AHEAD of the clock means this clock moved back — the
    # fault issue #358 met on the cluster host — so it is due, not deferred.
    if [ "$tracking" = yes ] && [ "$REPO_UPDATE" = ff-only ] && [ -n "$HISTORY_DIR" ] && [ -f "$REPO_FETCH" ]; then
        stamp="$HISTORY_DIR/repo-update.stamp"
        last=$(cat "$stamp" 2>/dev/null || true)
        case "$last" in ''|*[!0-9]*) last=0 ;; esac
        now=$(/bin/date +%s)
        if [ $((now - last)) -ge "$FETCH_INTERVAL_SECONDS" ] || [ "$now" -lt "$last" ]; then
            { echo "$now" > "$stamp"; } 2>/dev/null || true
            stamped env GIT_TERMINAL_PROMPT=0 python3 -I -B "$REPO_FETCH" "$REPO_DIR" </dev/null || true
        fi
    fi
    git -C "$REPO_DIR" rev-parse --verify --quiet 'refs/remotes/origin/main^{commit}' >/dev/null 2>&1 || return 0
    behind=$(git -C "$REPO_DIR" rev-list --count HEAD..refs/remotes/origin/main 2>/dev/null || echo 0)
    [ "$behind" -gt 0 ] || return 0
    ahead=$(git -C "$REPO_DIR" rev-list --count refs/remotes/origin/main..HEAD 2>/dev/null || echo 0)
    if [ "$REPO_UPDATE" = off ]; then
        reason=off
    elif [ -z "$branch" ]; then
        reason=detached
    elif [ "$tracking" = no ]; then
        reason=not-main
    elif [ "$ahead" -gt 0 ]; then
        reason=diverged
    else
        fast_forward_main
    fi
    if [ "$reason" = updated ]; then
        log "UPDATED exporter $(git -C "$REPO_DIR" rev-parse --short=12 "$old")->$(git -C "$REPO_DIR" rev-parse --short=12 "$new")"
    else
        log "WARN DRIFT behind=$behind ahead=$ahead action=$action reason=$reason" >&2
    fi
    if [ -n "$repair" ]; then
        log "WARN repo-update repair: $repair" >&2
    fi
    if [ -n "$facts" ]; then
        log "WARN repo-update state: $facts" >&2
    fi
    if [ -n "$interrupted" ]; then
        log "WARN repo-update interrupted signal=$interrupted" >&2
    fi
    if [ "$action" = incomplete ]; then
        stage=repo-update
        fail "the checkout update stopped part-way; nothing was exported"
    fi
    if [ "$acknowledged" = no ]; then
        stage=repo-update
        fail "main moved without git acknowledging the update; the checkout agrees with it, and nothing was exported"
    fi
    # Another actor moved HEAD or main under the update. The checkout is back
    # as the job found it, but HEAD may now name a commit whose files are not
    # the worktree's, so this run exports nothing it would misname.
    if [ "$action" = rolled-back ]; then
        stage=repo-update
        fail "a ref moved under the update; the checkout was put back as it was found, and nothing was exported"
    fi
    if [ -n "$interrupted" ]; then
        exit 1
    fi
    if [ "$reason" = updated ]; then
        export NARANJO_USAGE_EXPORT_REEXEC=1
        exec /bin/sh "$0"
    fi
}

# The fast-forward, as ONE critical section under git's own index lock
# (review F1). Everything read above was read before a fetch that can take
# seconds, and another actor may have switched the checkout meanwhile; a merge
# then advances whatever HEAD names by the time it runs. Every porcelain
# checkout, switch, merge, reset and commit takes the index lock before it
# touches anything, so while this job holds it nobody else can switch the
# branch or write the index, and everything is re-read inside it. A lock that
# already exists is another git operation in progress: the job steps aside and
# never removes a lock it did not create.
#
# The lock file IS the job's working index (review F1 r2): the real index is
# copied into it and git updates it in place (git locks index.lock.lock and
# renames that over it, so the lock path never disappears). One rename
# installs that index and releases the lock together, and it happens while
# the prepared ref transaction holds HEAD's and main's locks (advance_main).
#
# A child's exit status never decides what state the checkout is in (review
# F1 r3): a git killed after it finished reports failure too, and so does an
# mv stopped after it renamed. After a failed checkout the lock's tree is read
# again; the install is decided by the lock's inode (advance_main); after a
# commit git never acknowledged, main is read again. Where a state is proven,
# ref, index and worktree are brought into agreement; where it is not,
# recovery material is kept and the run stops:
#   merge-refused         nothing written; the run goes on as it was
#   ref-moved             nothing was prepared or HEAD no longer named main, so
#                         the transaction was aborted and the worktree put back
#                         to OLD (action=rolled-back); the run stops
#   updated               committed with the index installed; when git never
#                         acknowledged the commit, the run stops unexported
#   checkout-partial      git wrote some files before refusing; ref and index
#                         are OLD, so git status shows them; the run stops
#   checkout-uncertain    the checkout failed, yet the lock no longer holds the
#                         index it held before; the lock is kept; the run stops
#   ref-uncertain         the NEW index was installed but the commit was never
#                         acknowledged and main is not NEW; the repair is
#                         logged as a compare-and-swap update-ref, or, when main
#                         cannot be read, as what to inspect first; the run
#                         stops
#   rollback-failed       nothing was prepared and the worktree could not be
#                         put back; the lock keeps the NEW index; the run stops
#   index-install-failed  prepared, but the lock still holds the index (or its
#                         identity could not be read, so no rename was tried);
#                         the transaction was aborted, main is OLD, the lock
#                         keeps the NEW index; the run stops
#   index-uncertain       prepared and the rename tried, but neither path
#                         holds the lock's file afterwards; the transaction was
#                         aborted, main is OLD, the worktree holds NEW, and
#                         the NEW index was renamed to index or is still
#                         index.lock; the run stops
# A kept lock is git's own recovery state: every git command names it as stale.
fast_forward_main() {
    # The ref transaction protocol (start/prepare/commit) is what makes the
    # advance verifiable; a git without it is told apart before any write.
    printf 'start\nabort\n' | git -C "$REPO_DIR" update-ref --stdin >/dev/null 2>&1 \
        || { reason=git-too-old; return 0; }
    gitdir=$(git -C "$REPO_DIR" rev-parse --absolute-git-dir 2>/dev/null) \
        || { reason=merge-refused; return 0; }
    top=$(git -C "$REPO_DIR" rev-parse --show-toplevel 2>/dev/null) \
        || { reason=merge-refused; return 0; }
    lock="$gitdir/index.lock"
    (set -C && : >"$lock") 2>/dev/null || { reason=busy; return 0; }
    drop_lock=yes
    trap 'rm -f "$lock"' EXIT
    trap 'rm -f "$lock"; exit 1' HUP INT TERM
    old=$(git -C "$REPO_DIR" rev-parse --verify --quiet 'refs/heads/main^{commit}' || true)
    new=$(git -C "$REPO_DIR" rev-parse --verify --quiet 'refs/remotes/origin/main^{commit}' || true)
    if [ "$(git -C "$REPO_DIR" symbolic-ref --quiet HEAD 2>/dev/null || true)" != refs/heads/main ]; then
        reason=not-main
    elif [ -n "$old" ] && [ "$old" = "$new" ]; then
        reason=none
    elif ! git -C "$REPO_DIR" merge-base --is-ancestor "$old" "$new" >/dev/null 2>&1; then
        reason=diverged
    # The checkout is shared, so what git writes takes the repository's
    # ordinary modes, not this run's private umask. The refresh is the one a
    # merge does: a file touched but unchanged is not a local change.
    elif ! (umask 022 && cp "$gitdir/index" "$lock" \
        && GIT_INDEX_FILE="$lock" git -C "$REPO_DIR" update-index -q --refresh) >/dev/null 2>&1; then
        reason=merge-refused
    # A local change on a path the update touches is refused before git can
    # write anything, so that after a failed checkout any difference on those
    # paths is git's own partial write.
    elif ! touched_paths_clean "$old" "$new"; then
        reason=merge-refused
    # The tree the lock holds now, so that a failed checkout can be told from
    # one that finished: writing tree objects to the object store is harmless.
    elif ! before=$(lock_tree) || [ -z "$before" ]; then
        reason=merge-refused
    else
        # From the checkout until the index is installed or rolled back, a
        # signal is recorded, never acted on: the run ends only once ref,
        # index and worktree agree, or once a recovery state is kept.
        trap - EXIT
        trap 'interrupted=HUP' HUP
        trap 'interrupted=INT' INT
        trap 'interrupted=TERM' TERM
        if (umask 022 && GIT_INDEX_FILE="$lock" git -C "$REPO_DIR" read-tree -m -u "$old" "$new") >/dev/null 2>&1; then
            advance_main
        elif [ "$(lock_tree || true)" != "$before" ]; then
            reason=checkout-uncertain action=incomplete drop_lock=no
        elif touched_paths_clean "$old" "$new"; then
            reason=merge-refused
        else
            reason=checkout-partial action=incomplete
        fi
    fi
    if [ "$drop_lock" = yes ]; then
        rm -f "$lock"
    fi
    trap - EXIT HUP INT TERM
}

# The tree the lock index describes, or nothing when it cannot be written.
lock_tree() {
    (umask 022 && GIT_INDEX_FILE="$lock" git -C "$REPO_DIR" write-tree 2>/dev/null)
}

# True when every path the update touches is in the worktree as the job's
# index has it: no tracked one modified or removed, and nothing at a path NEW
# adds. The paths are git's own NUL-separated list, matched literally.
touched_paths_clean() {
    list=$(mktemp) || return 1
    # shellcheck disable=SC2016 # $path is the inner shell's loop variable.
    if git -C "$REPO_DIR" diff --no-renames --name-only -z "$1" "$2" >"$list" \
        && (cd "$top" && GIT_LITERAL_PATHSPECS=1 GIT_INDEX_FILE="$lock" \
            xargs -0 -r git diff-files --quiet -- <"$list") \
        && git -C "$REPO_DIR" diff --no-renames --name-only -z --diff-filter=A "$1" "$2" >"$list" \
        && (cd "$top" && xargs -0 -r sh -c \
            'for path do if [ -e "$path" ] || [ -h "$path" ]; then exit 1; fi; done' sh <"$list"); then
        clean=yes
    else
        clean=no
    fi
    rm -f "$list"
    [ "$clean" = yes ]
}

# The ref transaction, with the index installed INSIDE it (review F1 r4).
# `update HEAD NEW OLD` is made through HEAD: `symref-verify HEAD
# refs/heads/main` cannot share a transaction with an update of HEAD's own
# branch (git refuses "multiple updates for 'HEAD'"). Once prepare answers,
# git holds HEAD's lock and the lock of the branch HEAD names, so no
# update-ref, symbolic-ref, checkout or commit can move either until commit
# or abort. Inside that window HEAD is verified to name main and the index is
# installed by the one rename (git's own lockfile commit, which also releases
# the index lock); only then is the commit sent. A state re-read after the
# commit would be a snapshot plumbing could change before the install.
#
# Whether the rename happened is decided by the file's identity, never by
# mv's exit status (review F1 r5): mv stopped by a signal after renaming
# reports failure too. A rename moves the inode, and no git command renames
# index.lock away (they refuse while it exists), so the inode recorded just
# before the mv says where the index went.
#   commit acknowledged       updated: nothing could move the refs between the
#                             verify, the install and the commit
#   installed, no answer      main re-read: NEW is updated but unacknowledged;
#                             anything else is ref-uncertain, the installed NEW
#                             index is kept and the repair is logged
#   lock still holds it       aborted: index-install-failed, the lock kept (also
#                             when its identity could not be read, and then no
#                             rename is tried)
#   neither path holds it     aborted: index-uncertain; the facts are logged
#   nothing prepared          aborted: the worktree is rolled back to OLD and
#                             the run stops (ref-moved)
advance_main() {
    verified=no installed=no committed=no install_unknown=no
    trap '' PIPE
    channel=$(mktemp -d) || channel=
    if [ -n "$channel" ] && mkfifo "$channel/in" "$channel/out"; then
        git -C "$REPO_DIR" update-ref -m 'usage-export: fast-forward' --stdin \
            <"$channel/in" >"$channel/out" 2>/dev/null &
        transaction=$!
        exec 3>"$channel/in" 4<"$channel/out"
        printf 'start\nupdate HEAD %s %s\nprepare\n' "$new" "$old" >&3 2>/dev/null || true
        if read -r line <&4 && [ "$line" = 'start: ok' ] \
            && read -r line <&4 && [ "$line" = 'prepare: ok' ] \
            && [ "$(git -C "$REPO_DIR" symbolic-ref --quiet HEAD 2>/dev/null || true)" = refs/heads/main ]; then
            verified=yes
            held=$(inode_of "$lock")
            if [ -n "$held" ]; then
                mv -f "$lock" "$gitdir/index" || true
                if [ "$(inode_of "$gitdir/index")" = "$held" ]; then
                    installed=yes
                    printf 'commit\n' >&3 2>/dev/null || true
                    if read -r line <&4 && [ "$line" = 'commit: ok' ]; then
                        committed=yes
                    fi
                elif [ "$(inode_of "$lock")" != "$held" ]; then
                    install_unknown=yes
                fi
            fi
        fi
        if [ "$installed" = no ]; then
            printf 'abort\n' >&3 2>/dev/null || true
        fi
        exec 3>&- 4<&-
        wait "$transaction" || true
    fi
    if [ -n "$channel" ]; then
        rm -rf "$channel"
    fi
    trap - PIPE
    if [ "$committed" = yes ]; then
        reason=updated drop_lock=no
    elif [ "$installed" = yes ]; then
        drop_lock=no
        if ! main=$(git -C "$REPO_DIR" rev-parse --verify --quiet 'refs/heads/main^{commit}' 2>/dev/null) || [ -z "$main" ]; then
            # An update-ref without the value it expects would overwrite
            # whatever main holds by then, so none is printed.
            reason=ref-uncertain action=incomplete
            repair="main could not be read; inspect it (git rev-parse refs/heads/main), then run git update-ref refs/heads/main $new <that value>"
        elif [ "$main" = "$new" ]; then
            reason=updated acknowledged=no
        else
            reason=ref-uncertain action=incomplete
            repair="git update-ref refs/heads/main $new $main"
        fi
    elif [ "$install_unknown" = yes ]; then
        reason=index-uncertain action=incomplete drop_lock=no
        facts="main is $old (the update was aborted), the worktree holds $new, and the $new index was renamed to .git/index or is still .git/index.lock; inspect with git status before the next run"
    elif [ "$verified" = yes ]; then
        reason=index-install-failed action=incomplete drop_lock=no
    elif (umask 022 && GIT_INDEX_FILE="$lock" git -C "$REPO_DIR" read-tree -m -u "$new" "$old") >/dev/null 2>&1; then
        reason=ref-moved action=rolled-back
    else
        reason=rollback-failed action=incomplete drop_lock=no
    fi
}

# The inode number at a path, or nothing when it cannot be read (`ls -i` is
# POSIX).
inode_of() {
    # shellcheck disable=SC2012 # one known path; only the leading inode field is read.
    ls -di "$1" 2>/dev/null | awk '{ print $1 }'
}

if [ -z "${NARANJO_USAGE_EXPORT_REEXEC:-}" ]; then
    update_checkout
fi

EXPORT_SCRIPT="$REPO_DIR/scripts/export_usage_series.py"
[ -f "$EXPORT_SCRIPT" ] || fail "export script not found under REPO_DIR"
CAPTURE_SCRIPT="$REPO_DIR/scripts/capture_usage_series.py"
[ -f "$CAPTURE_SCRIPT" ] || fail "capture script not found under REPO_DIR"
PUSH_WATCHDOG="$REPO_DIR/scripts/usage-export/bounded-ssh.py"
[ -f "$PUSH_WATCHDOG" ] || fail "bounded ssh runner not found under REPO_DIR"
# The one-time lifetime baselines are REPO DATA (issue #276): the owner's
# sanctioned vendor readings, committed where review can reproduce them,
# never operator configuration. A checkout without the table cannot keep the
# baselined lifetime tiles tracking, so it refuses rather than pushing a
# document the origin will reject on every tick.
BASELINES_FILE="$REPO_DIR/scripts/usage-export/lifetime-baselines.json"
[ -f "$BASELINES_FILE" ] || fail "lifetime baselines table not found under REPO_DIR"
[ -x "$USAGESEAL_BIN" ] || fail "usageseal binary not executable"

# The revision of the checkout this run exports from, read ONCE. The export
# records it beside every ledger row and the SUMMARY line below reports it, so
# the log and the record name the same tree rather than two reads that a
# mid-run checkout could make disagree (issue #288). It is a public
# repository's commit id, never a path or a host fact; "unknown" when REPO_DIR
# is not a checkout at all.
exporter_revision=$(git -C "$REPO_DIR" rev-parse --short=12 HEAD 2>/dev/null || echo unknown)

# Served verification (issue #358). The checksum below proves delivery to the
# host and nothing about what the PAGE serves: the origin once served its
# release snapshot for days while every run logged a verified push. So each
# run first asks the site's public token-usage envelope whether every source
# it serves is at least as new as in the LAST push — what a visitor's GET can
# show, never the exact document — at the start rather than after this push,
# so no run ever waits for the origin's next re-read. One bounded request,
# OUTSIDE the producer sandbox like the transport, and never a reason to fail
# or skip the push.
SERVED_CHECK="$REPO_DIR/scripts/usage-export/served-check.py"
[ -f "$SERVED_CHECK" ] || fail "served-check helper not found under REPO_DIR"
if [ -n "$SITE_URL" ]; then
    stamped stamped_out python3 -I -B "$SERVED_CHECK" check --site "$SITE_URL" --state "${HISTORY_DIR:+$HISTORY_DIR/push-state.json}" --exporter "$exporter_revision" </dev/null \
        || log "WARN served-check unavailable reason=helper-failed" >&2
fi

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
SCRATCH=$(mktemp -d) || fail "cannot create scratch directory"
trap 'rm -rf "$SCRATCH"' EXIT INT TERM

PLAIN="$SCRATCH/usage.json"
SEALED="$SCRATCH/usage.enc"

# 1. Recapture every merge source whose records live on this machine, so the
#    document carries one age of data rather than one fresh half beside a file
#    somebody last edited by hand.
#
#    ON A FAILED RECAPTURE THIS RUN REFUSES, and pushes nothing. The tempting
#    alternative — carry on with the sources that did work — is not available
#    here, and that is a property of the receiving end rather than a judgement
#    call: the origin refuses a document whose source set does not EQUAL the
#    set its embedded snapshot ships, because one envelope instant cannot
#    honestly describe a fresh half beside a release-time half (2026-08-24
#    security review, finding 7). A partial document would therefore be built,
#    sealed, pushed, and refused on arrival — a failure moved later and made
#    quieter. Refusing here keeps the last good sealed file serving on the
#    receiving host, and the panel's own envelope goes stale on its TTL, which
#    is the honest report of exactly what happened.
#
#    The capture runs inside the same sandbox the export does, for the same
#    reason: it walks raw records.
for triple in $MERGE_CAPTURES; do
    key=${triple%%=*}
    rest=${triple#*=}
    format=${rest%%=*}
    tree=${rest#*=}
    [ "$key" != "$triple" ] && [ "$format" != "$rest" ] && [ -n "$format" ] && [ -n "$tree" ] \
        || fail "MERGE_CAPTURES entries take the form KEY=FORMAT=DIRECTORY"
    # The key becomes a file name in the scratch directory, so it is held to
    # the same label shape the exporter enforces on it — before it is used to
    # build a path, not after.
    printf '%s' "$key" | grep -q '^[a-z][a-z0-9-]*$' \
        || fail "a MERGE_CAPTURES key must be label-shaped"
    set -- --transcripts "$tree" --source "$key" --format "$format"
    if [ -n "$HISTORY_DIR" ]; then
        set -- "$@" --history-store "$HISTORY_DIR/$key.json"
        # A verified readings file beside the store is applied over it
        # (issue #299); its absence is the ordinary state, never a refusal.
        if [ -f "$HISTORY_DIR/$key.verified.json" ]; then
            set -- "$@" --verified-readings "$HISTORY_DIR/$key.verified.json"
        fi
    fi
    begin "recapture-$key"
    stamped sandbox-exec -f "$PRODUCER_PROFILE" \
        /usr/bin/env python3 -I -B "$CAPTURE_SCRIPT" "$@" \
        > "$SCRATCH/$key.json" \
        || fail "a merge source could not be recaptured; nothing was pushed"
    finish
    MERGE_SOURCES="$MERGE_SOURCES $key=$SCRATCH/$key.json"
done

# 2. Export, inside the sandbox declared above: no process can be created and
#    no socket can be opened for the whole walk, enforced by the kernel rather
#    than asserted by the walked program's import list. The interpreter is
#    still isolated (-I ignores user site and environment hooks; -B writes no
#    bytecode), and the guard inside the script is still what limits the
#    emission to dates and integers — three independent controls, none of them
#    load-bearing alone.
#
#    The activity cache, when configured, is passed here rather than assumed:
#    a configured path that is not a readable file REFUSES, because a silently
#    dropped cache would shorten the published history with nothing to say so,
#    and a series that quietly loses two months of depth between runs is the
#    failure this whole work package exists to end (issue #170).
set -- --transcripts "$TRANSCRIPTS" --source "$SOURCE_LABEL" --out "$PLAIN" \
    --lifetime-baselines "$BASELINES_FILE"
if [ -n "$ACTIVITY_CACHE" ]; then
    [ -f "$ACTIVITY_CACHE" ] \
        || fail "ACTIVITY_CACHE does not name a file; a configured cache that cannot be read would silently shorten the series"
    set -- "$@" --activity-cache "$ACTIVITY_CACHE"
fi
if [ -n "$HISTORY_DIR" ]; then
    set -- "$@" --history-store "$HISTORY_DIR/$SOURCE_LABEL.json"
    if [ -f "$HISTORY_DIR/$SOURCE_LABEL.verified.json" ]; then
        set -- "$@" --verified-readings "$HISTORY_DIR/$SOURCE_LABEL.verified.json"
    fi
    # The graphing dataset is rebuilt from the stores on every run and lives
    # beside them (issue #299): machine-local, never sealed, never pushed.
    set -- "$@" --dataset "$HISTORY_DIR/dataset.json"
fi
# The lifelong record (issue #267): every reading this run measured, appended
# with the revision that measured it. It is written inside the same sandbox —
# the record lives under HISTORY_DIR, which the profile leaves writable, and
# the stage still has no network and cannot create a process.
if [ -n "$LEDGER_DIR" ]; then
    set -- "$@" --ledger "$LEDGER_DIR" --exporter-version "$exporter_revision"
fi
for pair in $MERGE_SOURCES; do
    set -- "$@" --merge-source "$pair"
done
begin export
stamped sandbox-exec -f "$PRODUCER_PROFILE" \
    /usr/bin/env python3 -I -B "$EXPORT_SCRIPT" "$@" || fail "export refused"
finish

# 3. Seal on this machine, before anything leaves it.
begin seal
stamped "$USAGESEAL_BIN" -mode seal -key-file "$KEY_FILE" < "$PLAIN" > "$SEALED" \
    || fail "sealing refused"
finish

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

# 4. Push. The connection is assembled ENTIRELY on this command line and
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
#      LogLevel=ERROR           OpenSSH prints the receiving host's pre-auth
#                               banner at INFO and above, which put ~9 lines
#                               of it into the scheduler's log on every run
#                               (issue #358). Errors still print, and the
#                               runner reduces them to a closed reason.
#
#    The receiving account's authorized_keys entry is `restrict` + a forced
#    command, so whatever is requested here, the host runs exactly its own
#    single-file write and answers with the landed file's checksum. Both
#    halves are stated because either side's configuration can drift.
push_ssh() {
    python3 -I -B "$PUSH_WATCHDOG" ssh -F /dev/null \
        -o BatchMode=yes \
        -o ConnectTimeout=15 \
        -o ConnectionAttempts=1 \
        -o ServerAliveInterval=15 \
        -o ServerAliveCountMax=2 \
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
        -o LogLevel=ERROR \
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
check_resolved connecttimeout 15
check_resolved connectionattempts 1
check_resolved serveraliveinterval 15
check_resolved serveralivecountmax 2
check_resolved loglevel ERROR

begin push
remote_line=$(stamped push_ssh "$PUSH_HOST" usage-export-receive < "$SEALED") || fail "push refused"

remote_sum=$(echo "$remote_line" | head -n 1 | cut -d' ' -f1)
[ "$remote_sum" = "$local_sum" ] || fail "checksum mismatch after push"
finish

# What the NEXT run's served check compares against (issue #358): this
# document's export instant, every source's capture instant, the oldest of
# them — the instant the origin serves as the envelope's generatedAt — the
# sealed checksum, and the push time. Instants and a digest only, private,
# beside the stores.
if [ -n "$HISTORY_DIR" ]; then
    stamped python3 -I -B "$SERVED_CHECK" record --state "$HISTORY_DIR/push-state.json" --document "$PLAIN" --sha256 "$local_sum" </dev/null \
        || log "WARN push-state unrecorded reason=helper-failed" >&2
fi

# One line per healthy run, printed only once the host's checksum matched.
log "SUMMARY pushed=${sealed_bytes}B sha256=$(echo "$local_sum" | cut -c1-12) exporter=$exporter_revision elapsed=$(elapsed)s stages:$timings"
