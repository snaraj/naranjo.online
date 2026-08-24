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
                                                 /srv/naranjo-online/panels-data/
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

- **Capture cannot spawn or connect.** `scripts/export_usage_series.py` is
  standard-library file reading; its import surface is pinned by an AST test
  (`scripts/ci/test_export_usage_series.py`) against a closed allowlist that
  is itself pinned against a refused set, so no process-, network-, or
  loader-capable module can be admitted without a test naming the module
  that got in. `os` is on the refused side — it carries `system`, `popen`,
  `fork`, `spawn*` and `exec*`, and an attribute denylist around those
  spellings does not hold, because a computed `getattr` rebuilds the
  callable (2026-08-24 security review, finding 1). The capture tool's own
  `pathlib` walk does the same job, and the pin covers that transitive
  surface too. It never executes any agent binary, so a capture can never
  start a session or spend anything.
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
- **Read-only into the pod.** The chart projects the host directory through
  a static PersistentVolume/PersistentVolumeClaim pair pinned read-only at
  both the claim and the mount (`panels.data` in `chart/values.yaml`;
  validated by `scripts/ci/chart-storage-pin.sh`). The decrypt key arrives
  only as the `PANELS_DATA_KEY` environment variable from a Secret the chart
  references but never contains.
- **Strict admission.** The app reads at most 64 KiB of sealed bytes,
  unseals, strict-decodes `usage-series/v1` (unknown fields refused, closed
  window/derived/CATEGORY vocabularies — a pushed file can never mint a
  category label; the five accounting classes are the whole set — categories
  must partition the day totals), refuses replays via a monotonic
  `generatedAt` floor, and re-checks the serving byte budget before
  publishing.
- **The replay floor survives restarts.** The floor starts at the embedded
  snapshot's capture instant and rises with every accepted push; the
  accepted high-water mark is persisted as a sealed marker file in a
  SEPARATE writable state volume (`panels.data.stateHostPath`), so a
  restarted pod refuses ciphertext older than what any previous process
  accepted — not merely older than the shipped snapshot (2026-08-24 security
  review, finding H2). The marker is sealed under the same key as the
  series, so the host cannot forge it; an absent or corrupt marker degrades
  to the embedded floor, never lower, and a failed marker write degrades
  durability, never admission or serving.

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
   PUSH_HOST=cluster-host-alias
   SOURCE_LABEL=first-tool-label
   TRANSCRIPTS=$HOME/.claude/projects
   # MERGE_SOURCES=other-label=/path/to/other-series.json
   ```

   `MERGE_SOURCES` is how a second tool's captured series joins the same
   document: point it at that tool's capture output (the capture tool's
   stdout shape). The export validates and re-guards whatever it merges.

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

1. **Data directory** — must match the chart's `panels.data.hostPath`
   default:

   ```sh
   sudo install -d -m 0755 -o <push-user> -g <push-group> \
     /srv/naranjo-online/panels-data
   ```

   World-readable is intended: the payload is ciphertext, and the pod's
   non-root user reads it through the read-only PV.

   **State directory** — must match the chart's `panels.data.stateHostPath`
   default, a SIBLING of the data directory (never inside it), owned by the
   pod's runtime user so the app can persist its sealed replay-floor marker
   (2026-08-24 security review, finding H2; 65532 is the chart's pinned
   `runAsUser`/`runAsGroup`):

   ```sh
   sudo install -d -m 0700 -o 65532 -g 65532 \
     /srv/naranjo-online/panels-state
   ```

   The push pipeline never touches this directory, and the pod never writes
   anywhere else. If the directory is missing or unwritable the app still
   serves — the floor simply stops surviving restarts — but create it with
   the PV so the durability the review required is real.

2. **Forced-command key** — append ONE line to the push user's
   `~/.ssh/authorized_keys` (single line; wrapped here for reading):

   ```text
   restrict,command="t=$(mktemp /srv/naranjo-online/panels-data/.in.XXXXXX) \
     && head -c 131072 > \"$t\" \
     && chmod 0644 \"$t\" \
     && mv \"$t\" /srv/naranjo-online/panels-data/token-usage.series.enc \
     && sha256sum /srv/naranjo-online/panels-data/token-usage.series.enc" \
     ssh-ed25519 <public-key-from-push_ed25519.pub> usage-export-push
   ```

   `restrict` disables forwarding, PTY, X11, and agent access; the forced
   command ignores whatever the client asked for, bounds the write to
   128 KiB (double the app's own 64 KiB admission cap), lands it with an
   atomic rename, and answers with the checksum the push script verifies.
   This key can do nothing else on the host.

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

   ```sh
   helm template naranjo-online chart --kube-version v1.36.0 \
     --set panels.data.persistentVolume.enabled=true \
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
| panel serves embedded snapshot | `panels.data.enabled=false` (the default — the documented as-of-release decision), or no sealed file yet — the shipped state, not an error |
| floor marker absent/corrupt in the state dir | the app falls back to the embedded snapshot's floor — replay protection degrades to the pre-marker guarantee, never below it; the next accepted push rewrites the marker |
| pod Pending on the state claim | the state PV or its host directory was not created before enabling `panels.data` — finish the ceremony above |

Rotation: generate a new hex key, update the Secret, restart the deployment,
replace `data.key`, push again. The old file fails to unseal during the
overlap and the panel honestly reports `stale` until the next push lands.
