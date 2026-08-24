# Usage export — sealed runtime data for the token-usage panel

How the token-usage panel gets fresh per-day, per-category figures without a
release per refresh, and without the workstation, the repository, or the
cluster learning anything they must not (issue #142). This is the operator
manual; the design rulings it implements are recorded on the issue.

## The pipeline

```
workstation (initiates everything)                     cluster host
─────────────────────────────────────                  ─────────────────────────
transcript trees (read-only)
  └─ scripts/export_usage_series.py     dates+ints only, guard-proven
       └─ cmd/usageseal -mode seal      AES-256-GCM, key never in any repo
            └─ ssh (dedicated key) ───────────▶ forced command writes ONE file
                                                 /mnt/local-pie-ssd/
                                                   naranjo-online/panels-data/
                                                   token-usage.series.enc
                                                └─ static PV/PVC (read-only)
                                                     └─ pod mounts read-only
                                                          └─ app re-reads every 5 min,
                                                             unseals with PANELS_DATA_KEY,
                                                             strict-decodes, serves
```

Each stage fails closed. A malformed, replayed, oversized, tampered, or
wrongly-keyed file never replaces what the origin is already serving: the app
keeps the last good payload and says so in the envelope `status`.

## Security properties, stage by stage

- **Capture cannot spawn or connect — enforced by the kernel, not by a
  lint.** The push script starts `scripts/export_usage_series.py` inside the
  sandbox profile `scripts/usage-export/producer.sb`, which denies
  `process-fork` and `network*`. For the whole walk of the raw records no
  process can be created by any spelling and no network endpoint can be
  opened, so a capture can never start a session or spend anything. There is
  no flag, environment variable, or configuration key that runs the producer
  unconfined: a workstation without the sandbox refuses to walk raw records
  at all.

  This replaced an overstatement (2026-08-24 security review, round 3,
  finding 1). The guarantee used to rest on an AST test
  (`scripts/ci/test_export_usage_series.py`) pinning the producer's import
  names to a closed allowlist. That test still runs and still earns its
  place — it holds the REVIEWED IMPORT SURFACE closed, against a refused set,
  so widening it is a conscious edit naming the module that got in — but it
  cannot prove a capability absent: `pathlib` is an allowed import and the
  module object it binds re-exports `os`, so `pathlib.os.system(":")` reached
  the launch callable with the import set unchanged and every producer test
  green. Any admitted module that imports `os` reopens the same hole, so no
  allowlist of import NAMES can close it.

  The residual is stated in the profile itself and is deliberate: seatbelt
  cannot express "allow exactly the first exec", so exec-in-place stays
  possible. It buys nothing — the sandbox is inherited across exec, so
  whatever the producer replaced itself with would still be unable to create
  a process or open a network endpoint, and the export it owed simply never
  appears, which the push reports as a refusal.
- **Only dates and integers leave the machine.** The export reuses the
  capture tool's `assert_only_dates_and_integers` guard — the same function,
  not a copy — over the complete payload immediately before writing.
  Diagnostics are counts, never paths.
- **Sealed before it travels.** `cmd/usageseal` applies AES-256-GCM with a
  fresh random nonce per seal; the format is versioned (`NJSEAL/1`, bound as
  AEAD associated data) and the key is 64 hex characters read from a
  0600-only file. The tool refuses a group- or world-readable key file.
- **No path back into the workstation.** The workstation initiates; the
  transport is ssh stdin (no file-transfer protocol parser runs on the
  workstation), the push identity is a dedicated keypair, and the receiving
  account's `authorized_keys` entry is `restrict` + a forced command that
  writes exactly one file and answers with its checksum. The only bytes that
  ever return are the exit status and that checksum line.
- **The push reads no ssh configuration file.** `-F /dev/null` makes the
  resolution start from nothing — OpenSSH documents that supplying `-F` also
  causes the system-wide `ssh_config` to be ignored — and every option the
  session depends on is stated on the command line, including several that
  are already defaults, because a default is only a default until a config
  file moves it (2026-08-24 round-3 review, finding 8).

  Hardening the options someone thought to name is not the same thing, and
  the difference is measurable rather than theoretical. A consulted config
  file can contribute parameters the command line never mentions — an extra
  `IdentityFile`, which ACCUMULATES rather than being overridden, or a
  `RemoteCommand` — and `scripts/ci/test_usage_export_scripts.py` runs the
  shipped invocation against a staged hostile config to show exactly that,
  then again with `-F /dev/null` to show it stops.

  Before connecting, the script asks `ssh -G` what the options actually
  resolved to and refuses unless the answer matches: exactly one identity
  and that identity, no `proxycommand`/`proxyjump`/`localcommand`/
  `controlpath` at all, and the pinned agent, forwarding and host-key
  settings. The identity check earns its place twice over, because `ssh`
  silently ignores an `-i` path that does not exist and falls back to the
  default `~/.ssh` keys.
- **Read-only into the pod, on the platform's own storage shape.** The chart
  projects the node directory through a statically bound `local`
  PersistentVolume/PersistentVolumeClaim pair on the enumerated
  `local-pie-ssd` StorageClass, pinned read-only at both the claim and the
  mount, with bounded required nodeAffinity (`panels.data` in
  `chart/values.yaml`; validated by `scripts/ci/chart-storage-pin.sh`). The
  decrypt key arrives only as the `PANELS_DATA_KEY` environment variable
  from a Secret the chart references but never contains.

  This was a hostPath pair with an explicitly empty storageClassName until
  the 2026-08-24 round-3 review (finding 7). That shape is not merely dated:
  website-infrastructure #211's storage acceptance denies hostPath outright
  and admits a persistent volume only as `local` or `csi`, under the
  enumerated local-volume root, carrying the enumerated class on both
  objects. **This alignment is not yet confirmed by the platform — #211 is
  open, and this work remains blocked on its five-part receipt either way.**
  What changed is the direction of the gap.
- **One writer, by construction.** `replicaCount` defaults to 1 whenever
  `panels.data` is enabled, the state claim is `ReadWriteOncePod`, and the
  render REFUSES `replicaCount > 1` with the capability on (2026-08-24
  round-3 review, finding 3). The floor marker is a single-writer structure
  and two pods writing it concurrently is a race whose loser silently lowers
  the floor. The availability tradeoff is stated in full in
  `chart/values.yaml`; the short version is that this is one personal site on
  a one-node cluster, where two replicas always shared the node's fate
  anyway, and `replicaCount: 2` remains fully supported with
  `panels.data.enabled: false`.
- **The two roots are disjoint, in both directions.** The read-only data root
  and the writable state root may not be equal, and neither may contain the
  other — checked over NORMALIZED paths, so `/x/data/../data/state`,
  `/x//data` and `/x/data/` cannot pass as different directories, and the
  same holds for the two container mount paths. The earlier check compared
  raw strings in one direction only, which missed both the reverse nesting
  and every alias (2026-08-24 round-3 review, finding 7).
- **Strict admission.** The app reads at most the one sealed-byte cap
  documented below, unseals, strict-decodes `usage-series/v1` (unknown
  fields refused, closed window/derived/CATEGORY vocabularies — a pushed
  file can never mint a category label; the five accounting classes are the
  whole set — categories must partition the day totals), refuses replays via
  a monotonic `generatedAt` floor, and re-checks the serving byte budget
  before publishing.
- **One producer owns the panel.** When `PANELS_DATA_ROOT` is set, the
  sealed data root OWNS the token-usage panel and the credentialed live
  refresh never fetches it — the pod logs that decision once at startup
  (`token-usage panel served from the sealed data root; its live refresh is
  suppressed`). Every OTHER refresh-backed panel keeps refreshing normally,
  so enabling the sealed feed never silently disables the rest. Both
  switches on used to start two independent producers writing the same panel
  with no precedence, so a live fetch could overwrite the sealed series and
  the next five-minute tick could overwrite it back (2026-08-24 security
  review, finding 8).
- **A document is whole or it is refused.** Its source set must EQUAL the
  set the embedded snapshot ships (2026-08-24 security review, finding 7).
  The envelope carries ONE `status` and ONE `generatedAt` for the whole
  payload, so a document refreshing some sources and not others cannot be
  described honestly by either; it is refused with that reason and the panel
  keeps its last good payload.
- **The replay floor survives restarts, and durable mode fails closed.** The
  floor starts at the embedded snapshot's capture instant and rises with
  every PUBLISHED push; the high-water mark is persisted as a sealed marker
  file in a SEPARATE writable state volume (`panels.data.statePath`), so
  a restarted pod refuses ciphertext older than what any previous process
  published — not merely older than the shipped snapshot (2026-08-24
  security review, finding H2). The marker is sealed under the same key as
  the series, so the host cannot forge it.

  Once a state volume is configured, the floor is a promise about what
  survives a restart, and a promise that cannot be kept is refused rather
  than downgraded (2026-08-24 security review, finding 2):

  - The marker is written BEFORE the payload is published. A write that
    fails means the payload is not published at all — the last good payload
    keeps serving, the envelope says `stale`, and the next five-minute tick
    retries the same file. The old order (publish, then try to persist,
    discard the error) let a pod serve an instant no restart could remember,
    after which an older but perfectly authentic file was re-admitted as
    fresh.
  - A marker that is genuinely ABSENT is a first boot and is benign. A
    marker that EXISTS and cannot be trusted — unreadable, oversized,
    unauthentic, unparsable, or dated in the future — refuses the tick and
    reports `stale` instead of quietly reverting to the embedded floor. The
    load is retried every tick, so repairing or removing the marker recovers
    the pod without a restart.

## The payload ceiling — one number, five stages

The pipeline enforces exactly one payload ceiling, **131,072 sealed bytes
(128 KiB)**, at every stage:

| Stage | What it does with the ceiling |
| --- | --- |
| `scripts/export_usage_series.py` | emits COMPACT JSON and refuses a document that would not seal within the ceiling — before sealing, before the wire |
| `cmd/usageseal` | refuses stdin past the ceiling: in `seal` mode measured as plaintext (ceiling minus the 36-byte AEAD overhead), in `open` mode as sealed bytes |
| `scripts/usage-export/push-usage-series.sh` | refuses an over-cap sealed file before the ssh connection is opened |
| the forced command (above) | reads one byte PAST the ceiling and refuses before any rename, so an over-cap push never displaces the last good file |
| the origin (`internal/panels`) | reads at most the ceiling, refusing rather than truncating |

The number is stated in `internal/seal/types.go` (`MaxSealedBytes`), restated
in the four places above, and pinned across all five by `CapParityTest` in
`scripts/ci/test_capture_usage_series.py` — the same hand-duplication pin the
repository uses for the category vocabulary.

**Why 128 KiB, and why it is not a relaxation.** Before the 2026-08-24
security review the five stages disagreed: the exporter pretty-printed with
no cap, the sealer accepted 1 MiB, the push checked only "not empty", the
forced command truncated at 128 KiB, and the origin refused past 64 KiB
(finding 4). A valid export could therefore be sealed and pushed and never
admitted, and an oversized one was truncated, atomically installed over the
last good file, and only then reported as a checksum mismatch.

The ceiling is measured, not guessed, and the measurement was REDONE at the
2026-08-24 round-3 review: the figures previously printed here had gone stale
against the document the producer now emits, because finding 5 made a
per-source `capturedAt` required and the complete window and derived sections
mandatory. The structural maximum the origin can admit is one document
covering both shipped snapshot sources, each at the 732-day series bound with
the complete five-key category vocabulary and every required section present.
Compact-encoded and sealed, that measures **98,958 bytes** at ten-digit daily
values — an order of magnitude above the shipped snapshot's own measured peak
day of 1,911,380,289. Pretty-printed, the identical document is 196,256
bytes, so compact output alone roughly halves it. 131,072 leaves **32,114
bytes** of headroom: the same maximum still seals to 125,340 bytes at
thirteen-digit values and only crosses the ceiling at fourteen, where it
reaches 134,134.

These figures are no longer transcribed into a test assertion. `CapParityTest`
BUILDS the maximum document from the shipped snapshot's own labels and the
producer's own vocabulary and measures it, so the drift that made the previous
paragraph wrong cannot recur silently — but the prose above is still hand-kept
and is checked by reading, so treat a disagreement between it and the suite as
the prose being wrong.

Raising the origin's own read from 64 KiB is therefore a unification of five
disagreeing numbers, not a weakening. The tighter gate is downstream and
unchanged: the merged payload must still fit the panels response budget
(`MaxPanelResponseBytes`) before it is served, so a document under this
ceiling is not promised to be servable — only to be transported and parsed
without truncation.

## Workstation setup

1. **Build the sealer** from the repository root:

   ```sh
   go build -o "$HOME/.local/bin/usageseal" ./cmd/usageseal
   ```

2. **Generate the data key** (once), outside every repository:

   ```sh
   mkdir -p "$HOME/.config/naranjo-usage-export"
   (umask 077 && openssl rand -hex 32 \
     > "$HOME/.config/naranjo-usage-export/data.key")
   ```

   The same hex string becomes the cluster Secret below. It must never enter
   a repository, a chart value, a ConfigMap, or a log.

3. **Generate the dedicated push keypair** (once):

   ```sh
   ssh-keygen -t ed25519 -N '' \
     -f "$HOME/.config/naranjo-usage-export/push_ed25519" \
     -C usage-export-push
   ```

   The private key is passphrase-less because launchd runs unattended; the
   forced command below is what bounds the blast radius of its theft to
   "overwrite one sealed file whose consumer fail-closes".

4. **Write the configuration** at
   `~/.config/naranjo-usage-export/config`, mode 0600 (the push script
   refuses anything laxer):

   ```sh
   REPO_DIR=/path/to/this/checkout
   USAGESEAL_BIN=$HOME/.local/bin/usageseal
   KEY_FILE=$HOME/.config/naranjo-usage-export/data.key
   SSH_IDENTITY=$HOME/.config/naranjo-usage-export/push_ed25519
   SSH_KNOWN_HOSTS=$HOME/.config/naranjo-usage-export/known_hosts
   PUSH_HOST=<push-user>@<cluster-host>
   SOURCE_LABEL=first-tool-label
   TRANSCRIPTS=$HOME/.claude/projects
   # PUSH_PORT=22
   # MERGE_SOURCES=other-label=/path/to/other-series.json
   ```

   **`PUSH_HOST` is a real `user@host`, not an `~/.ssh/config` alias, and
   `SSH_KNOWN_HOSTS` is required** (2026-08-24 round-3 review, finding 8).
   The push now runs with `-F /dev/null`, so no configuration file is
   consulted at all — neither `~/.ssh/config` nor the system-wide one — and
   every option is stated on the command line. An alias would resolve to
   nothing, and a bare hostname would fall back to the LOCAL username, which
   is a different account and very possibly one without the forced command.

   Create the known-hosts file by fetching the host key over a channel you
   trust and verifying its fingerprint out of band — for example:

   ```sh
   ssh-keyscan -t ed25519 <cluster-host> > \
     "$HOME/.config/naranjo-usage-export/known_hosts"
   ssh-keygen -lf "$HOME/.config/naranjo-usage-export/known_hosts"
   # compare the fingerprint against the host's own
   # `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`
   ```

   `StrictHostKeyChecking=yes` with this file means an unrecognized host key
   is a refusal, not a prompt and not a silent first-use trust.

   Before it opens a connection the push script asks `ssh -G` what the
   options above actually RESOLVED to, and refuses unless the answer is
   exactly what it asked for: one identity and that identity, no
   `proxycommand`, `proxyjump`, `localcommand` or `controlpath`, and the
   pinned host-key settings. One measured reason this matters more than it
   looks: `ssh` SILENTLY IGNORES an `-i` path that does not exist and falls
   back to the default `~/.ssh` identities, so a mistyped `SSH_IDENTITY`
   would otherwise authenticate with your ordinary key — quite possibly an
   admin key, and without the forced command.

   `MERGE_SOURCES` is how a second tool's captured series joins the same
   document: point it at that tool's capture output (the capture tool's
   stdout shape). The export validates and re-guards whatever it merges.

   **It is REQUIRED whenever the shipped snapshot carries more than one
   source.** The origin admits a document only when its source set EQUALS
   the set the embedded snapshot ships (2026-08-24 security review,
   finding 7). One envelope carries one `status` and one `generatedAt` for
   the whole payload, so a document that refreshed one source and left the
   other at release-time data could not be described honestly by either
   field — the origin used to backfill the omitted source from the snapshot
   and stamp the result wholly current. A partial document is now refused
   with that reason and the panel keeps its last good payload, so the
   symptom of a missing `MERGE_SOURCES` entry is `status: stale`, never a
   payload that quietly mixes two ages.

5. **Install the schedule**:

   ```sh
   scripts/usage-export/install-launchd.sh
   ```

   Hourly plus at load; logs under
   `~/Library/Logs/naranjo-online-usage-export/`. One manual run first is
   good practice: `scripts/usage-export/push-usage-series.sh`.

   The installed job is anchored to the PRIMARY checkout
   (`~/code/naranjo.online` by default; override with
   `NARANJO_USAGE_EXPORT_REPO_DIR`), never to wherever the installer itself
   happens to live — an install performed from a disposable worktree used
   to break silently at that worktree's cleanup (2026-08-24 security
   review, finding M4), and a worktree path is now refused outright.
   `--render-only` previews the exact plist without touching launchd.

## Cluster host setup (one-time, by an operator)

Placeholders in angle brackets; none of these values belong in this
repository.

1. **Data directory** — must match the chart's `panels.data.path` default,
   which lives under the platform's enumerated local-volume root
   (2026-08-24 round-3 review, finding 7: the chart moved from a hostPath
   volume, which the platform storage acceptance denies outright, to a
   `local` volume on the `local-pie-ssd` StorageClass):

   ```sh
   sudo install -d -m 0755 -o <push-user> -g <push-group> \
     /mnt/local-pie-ssd/naranjo-online/panels-data
   ```

   World-readable is intended: the payload is ciphertext, and the pod's
   non-root user reads it through the read-only PV.

   **State directory** — must match the chart's `panels.data.statePath`
   default, a SIBLING of the data directory (never inside it, and never
   containing it — the chart refuses to render either arrangement, in both
   directions, comparing normalized paths so an alias cannot slip past),
   owned by the
   pod's runtime user so the app can persist its sealed replay-floor marker
   (2026-08-24 security review, finding H2; 65532 is the chart's pinned
   `runAsUser`/`runAsGroup`):

   ```sh
   sudo install -d -m 0700 -o 65532 -g 65532 \
     /mnt/local-pie-ssd/naranjo-online/panels-state
   ```

   The push pipeline never touches this directory, and the pod never writes
   anywhere else. Two different states, deliberately: a deployment with NO
   state volume at all (`PANELS_DATA_STATE` unset) runs the documented
   process-memory mode and keeps serving with a floor that does not survive
   restarts, while a deployment that HAS one and cannot write to it refuses
   to publish and reports `stale` — it asked for durability, so it does not
   silently serve without it (2026-08-24 security review, finding 2). Create
   the directory with the PV so the durability the review required is real.

2. **Forced-command key** — append ONE line to the push user's
   `~/.ssh/authorized_keys` (single line; wrapped here for reading):

   ```text
   restrict,command="d=/mnt/local-pie-ssd/naranjo-online/panels-data \
     && t=$(mktemp \"$d/.in.XXXXXX\") \
     && head -c 131073 > \"$t\" \
     && s=$(wc -c < \"$t\") \
     && if [ \"$s\" -gt 131072 ]; then rm -f \"$t\"; echo over-cap >&2; exit 1; fi \
     && chmod 0644 \"$t\" \
     && mv \"$t\" \"$d/token-usage.series.enc\" \
     && sha256sum \"$d/token-usage.series.enc\"" \
     ssh-ed25519 <public-key-from-push_ed25519.pub> usage-export-push
   ```

   `restrict` disables forwarding, PTY, X11, and agent access; the forced
   command ignores whatever the client asked for. It reads **one byte past**
   the 131,072-byte ceiling and REFUSES anything larger, deleting its
   staging file and exiting nonzero **before** the rename — so an over-cap
   push never displaces the last good file. That ordering is the fix for
   the 2026-08-24 security review's finding 4: the earlier line read
   `head -c 131072`, which silently TRUNCATED an oversized payload, renamed
   the truncated bytes over the last good file, and only then reported a
   checksum mismatch — destroying a working file to report a failure. Under
   the cap it lands the bytes with an atomic rename and answers with the
   checksum the push script verifies.

   Note what each side proves. The host verifies SIZE before it installs
   anything and reports the landed file's checksum, which the workstation
   compares against what it sealed; the host holds no key and therefore
   cannot — and must not be able to — verify the AEAD. That verification is
   the origin's, and a file that fails it leaves the panel on its last good
   payload reporting `stale`. This key can do nothing else on the host.

3. **Decrypt-key Secret** in the site's namespace, from the same hex string
   as the workstation's `data.key` (name and key must match the chart's
   `panels.data.keySecret` default):

   ```sh
   kubectl -n <namespace> create secret generic naranjo-online-panels-data \
     --from-file=PANELS_DATA_KEY=<path-to-data.key>
   ```

4. **The PersistentVolumes** — cluster-scoped, so they are applied by an
   operator from the chart's OWN render rather than by the namespaced
   release (see the `panels.data.persistentVolume` comment in
   `chart/values.yaml` for the RBAC/PSA reasoning). Two render now: the
   read-only DATA volume and the writable replay-floor STATE volume
   (2026-08-24 security review, finding H2):

   Both are `local` volumes and a local volume is node-bound, so the render
   needs the node name. It is supplied on the command line and never stored
   in this repository (requirement 12); the chart's default is an empty
   fail-closed sentinel and rendering a PersistentVolume without it fails
   the render rather than emitting a volume no scheduler can place.

   ```sh
   helm template naranjo-online chart --kube-version v1.36.0 \
     --set panels.data.persistentVolume.enabled=true \
     --set panels.data.node=<node-name> \
     --show-only chart/templates/panels-data.yaml > /tmp/panels-data.yaml
   # The render carries both PVs and both PVCs. Delete the two
   # PersistentVolumeClaim documents from the file — the claims are the
   # release's to manage — review what remains, then:
   kubectl apply -f /tmp/panels-data.yaml --dry-run=server   # inspect first
   kubectl apply -f /tmp/panels-data.yaml
   ```

   The claims themselves are part of every enabled release; only the PV
   documents are the admin ceremony. Apply the PVs (and create both host
   directories) BEFORE deploying a release with `panels.data.enabled=true`,
   or the new pod waits Pending on an unbindable claim.

5. **Enable the capability — deliberately, last.** `panels.data.enabled`
   defaults to `false` (2026-08-24 security review, finding M6): a fresh
   install renders none of the storage and schedules everywhere, serving
   the token-usage panel from its embedded release-time snapshot — honest
   recorded data whose envelope `generatedAt` says exactly how old it is.
   Once steps 1–4 exist, set `panels.data.enabled=true` in the deployment
   values. Turning it back off is the same explicit decision in reverse:
   the sealed feed stops being read and the panel returns to as-of-release
   data — documented behavior chosen in values, never a silent fallback.

## Verifying end to end

```sh
# On the workstation: one manual push.
scripts/usage-export/push-usage-series.sh
# -> usage-export: pushed <N> sealed bytes; checksum verified

# Against the cluster: the panel now reports the pushed instant.
kubectl -n <namespace> port-forward deploy/naranjo-online 8080:8080 &
curl -s localhost:8080/api/panels/token-usage | head -c 400
# "generatedAt" equals the pushed document's; "status" is "ok";
# each source carries series + categories + windows + derived.
```

## Failure modes (all deliberate)

| Symptom | Meaning |
| --- | --- |
| `configuration must be private` | config file mode laxer than 0600 |
| `sealing refused` / key-file refusal | key file missing, malformed, or group/world-readable |
| `push refused` | ssh transport failed; nothing landed |
| `checksum mismatch after push` | landed bytes differ from sealed bytes — investigate before trusting the panel |
| panel `status: stale` | the origin refused the newest file (tamper, replay, wrong key, over-cap, malformed) and kept the last good payload |
| panel `status: stale` after every push, panel never advances | the document does not cover every shipped source — add the missing `MERGE_SOURCES` entry (see step 4) — or one of its sections is malformed |
| panel `status: stale`, sealed file gone from the data dir | the runtime document this pod had already served from was deleted or unmounted: the data is retained, the freshness claim is not (2026-08-24 security review, finding 5). Before the FIRST push an absent file is the ordinary cold state and stays `ok` on the embedded snapshot |
| panel serves embedded snapshot | `panels.data.enabled=false` (the default — the documented as-of-release decision), or no sealed file yet — the shipped state, not an error |
| floor marker absent in the state dir, no `token-usage.floor.init` beside it | a first boot: benign, the floor is the embedded snapshot's, and the first published push writes both files |
| floor marker absent but `token-usage.floor.init` present | the durable floor was INITIALIZED and its marker is now gone — deleted, or lost with the volume. Durable mode refuses the tick and reports `stale` instead of cold-starting on a floor of zero (2026-08-24 round-3 review, finding 4). Recover by pushing a fresh document, or run the reset ceremony below and accept what it costs |
| floor marker present but corrupt, unauthentic, or future-dated | durable mode refuses the tick and reports `stale` rather than serving on a silently lowered floor. Push a fresh document; if the marker is genuinely unrecoverable, run the reset ceremony below |
| boot log line `panel=token-usage` describing the floor state | the one operator-facing statement of WHICH state the state directory is in — recovered, rotated, lost, or untrusted. It carries no path, no key, and no payload |
| floor marker present but sealed under a previous key | the key was rotated without the floor being reset. Durable mode refuses rather than migrating: the marker's key identifier is UNAUTHENTICATED, so honouring it would let anyone who can write the state directory lower the floor by editing a header. Run the reset ceremony below as part of the rotation |
| panel `status: stale` right after a push, state volume full or read-only | the floor could not be persisted, so the payload was not published; free or remount the state directory and the next tick publishes the same file |
| pod Pending on the state claim | the state PV or its host directory was not created before enabling `panels.data` — finish the ceremony above |

### The floor reset ceremony, and what it costs

There is one supported way to declare a cold start, and it is deliberately
not "delete a file until the error goes away". An earlier revision of this
document told operators to delete the marker; that instruction was the
finding-4 hole written down, because a deleted marker was indistinguishable
from a first boot and silently reset the replay floor to the embedded
snapshot's instant.

**Say plainly what it does: it LOWERS the replay protection.** Every sealed
document whose capture instant is after the embedded snapshot's becomes
admissible again, so anyone holding a copy of an older push — a backup, a
stale mount, an intercepted file — can have it accepted as current until a
newer document arrives. Run it only when the alternative is a panel that
cannot recover at all, and push a fresh document immediately afterwards so
the floor climbs back.

```sh
# On the node, as the operator. BOTH files, together — removing only the
# marker is the state the origin now refuses on purpose.
sudo rm -f /mnt/local-pie-ssd/naranjo-online/panels-state/token-usage.floor.enc \
           /mnt/local-pie-ssd/naranjo-online/panels-state/token-usage.floor.init
# Then, from the workstation, immediately:
scripts/usage-export/push-usage-series.sh
```

No restart is needed: the next tick sees an uninitialized state directory,
cold-starts on the embedded snapshot's floor, and the fresh push raises it
again.

### Key rotation

Generate a new hex key, update the Secret, replace `data.key` on the
workstation, **run the floor reset ceremony above**, restart the deployment,
and push again.

The reset is part of the ceremony rather than an optional extra. The floor
marker is sealed under the same key as the series, so after rotation the
origin cannot open it; it refuses the tick and reports `stale` rather than
guessing. It deliberately does NOT migrate the marker on its own: the marker
carries a key identifier in a plain header, that header is outside the AEAD,
and honouring an unauthenticated header would hand anyone who can write the
state directory a way to lower the floor by editing one string — reopening
exactly the hole the initialization tombstone closes.

The rollback window the reset opens is narrower than it looks in this one
case: documents sealed under the OLD key cannot be opened under the new one
at all, so they are refused whatever the floor says. What becomes replayable
is only material already sealed under the NEW key, of which there is none
until the first post-rotation push — which is why the ceremony ends with one.

During the overlap the old file fails to unseal and the panel honestly
reports `stale` until the new push lands.
