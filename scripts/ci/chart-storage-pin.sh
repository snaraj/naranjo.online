#!/usr/bin/env bash
# chart-storage-pin — prove the rendered panels data root keeps every storage
# invariant (issue #142), in BOTH directions:
#
#   enabled (--set panels.data.enabled=true — deliberately NOT the default
#   since the 2026-08-24 review's finding M6: the capability binds to
#   admin-provisioned volumes, so a default render must never carry its
#   claims): exactly TWO PersistentVolumeClaims — the
#   read-only DATA claim carrying the pushed sealed series, and the writable
#   replay-floor STATE claim (2026-08-24 security review, finding H2) — each
#   pinned to its PersistentVolume by name and to the enumerated
#   storageClassName (an omitted name would let the default StorageClass
#   capture the claim; the empty name this replaced merely excluded a default
#   provisioner), ReadOnlyMany/ReadWriteOnce respectively, at the
#   declared capacities; the Deployment mounts the data claim readOnly at
#   BOTH the claim reference and the volumeMount, mounts the state claim
#   EXPLICITLY writable at both (a silently read-only state root loses the
#   durable floor), PANELS_DATA_ROOT and PANELS_DATA_STATE equal their mount
#   paths, and the key Secret reference is optional so its absence degrades
#   the panel rather than the pod. No PersistentVolume renders by default:
#   the release identity deliberately holds no PV authority.
#
#   with-pv (panels.data.persistentVolume.enabled=true, the admin ceremony):
#   additionally exactly TWO PersistentVolumes — each a `local` volume at its
#   reviewed path strictly under the enumerated local-volume root (hostPath
#   is refused outright: the platform storage acceptance denies it —
#   website-infrastructure #211, carried by PR #212), Retain, the
#   enumerated storageClassName, bounded REQUIRED nodeAffinity (one term, one
#   expression, operator In, one non-empty value), a claimRef pinning each
#   pair from the volume side too, and the two directories disjoint in BOTH
#   directions after normalization.
#
#   disabled — proven for BOTH the untouched DEFAULT render (the
#   fresh-install schedulability pin: nothing renders that could leave a
#   pod Pending on an unbindable claim) and an explicit
#   panels.data.enabled=false: NONE of it — no claim, no volume, no mount,
#   no PANELS_DATA_* environment. The capability cannot half-exist, and
#   turning it off is the documented as-of-release-snapshot decision, not
#   a silent surprise.
#
# The checker (chart_storage_pin.py) reads renders through the census's own
# fail-closed document reader, and the expected facts are read HERE from
# chart/values.yaml — never re-derived from the template under test. A
# self-mutation battery then proves the pin can actually fail: for each
# hostile rewrite of the render (a writable mount, a moved host path, a
# dropped storageClassName, a swapped claim, ...) the checker must go red,
# and the battery has a pinned floor so it cannot quietly shrink.
set -euo pipefail

cd "$(dirname "$0")/../.."

fail() {
  echo "chart-storage-pin: FAIL: $*" >&2
  exit 1
}

command -v helm >/dev/null || fail "helm is required"
command -v python3 >/dev/null || fail "python3 is required"

# The expected facts, read from the values file — the single designated
# binding point — with the same tolerance for quoting the ingress pin uses.
#
# The read is SCOPED to the panels.data block, and that scoping is
# load-bearing rather than tidiness. The earlier reader matched the first
# `<key>:` at any indentation anywhere in the file, which is only unambiguous
# while no other block declares a key of the same name. Issue #207's media
# block declares `mountPath` ABOVE panels.data, so the unscoped reader silently
# resolved the media mount path and the pin then measured the render against a
# value from a different subsystem. Reading exactly one designated block —
# refusing an absent block, an absent key, and a duplicate key alike — is
# strictly narrower than what it replaced: no unrelated key can capture it, in
# either direction, however the file is later reordered.
read_value() {
  python3 -I -B - "$1" <<'PY'
import sys

key = sys.argv[1]
lines = open("chart/values.yaml", encoding="utf-8").read().splitlines()


def indent_of(line):
    return len(line) - len(line.lstrip(" "))


def block(lines, header, indent):
    """The lines strictly nested under `header` at exactly `indent`."""
    want = " " * indent + header + ":"
    for start, line in enumerate(lines):
        if line.rstrip() == want:
            break
    else:
        sys.exit("chart/values.yaml carries no %s block" % header)
    body = []
    for line in lines[start + 1 :]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if indent_of(line) <= indent:
            break
        body.append(line)
    return body


scope = block(block(lines, "panels", 0), "data", 2)
found = []
for line in scope:
    stripped = line.strip()
    if indent_of(line) == 4 and stripped.startswith(key + ":"):
        found.append(stripped[len(key) + 1 :].strip())
if len(found) != 1:
    sys.exit("chart/values.yaml panels.data carries %d %s keys, want exactly 1" % (len(found), key))
print(found[0].strip("'\""))
PY
}

DATA_PATH="$(read_value path)"
MOUNT_PATH="$(read_value mountPath)"
STORAGE_CLASS="$(read_value storageClass)"
LOCAL_ROOT="$(read_value localVolumeRoot)"
VOLUME_NAME="$(read_value volumeName)"
KEY_SECRET="$(read_value keySecret)"
CAPACITY="$(read_value capacity)"
STATE_PATH="$(read_value statePath)"
STATE_MOUNT_PATH="$(read_value stateMountPath)"
STATE_VOLUME_NAME="$(read_value stateVolumeName)"
STATE_CAPACITY="$(read_value stateCapacity)"
# The node name never enters this repository (requirement 12): values.yaml
# ships an empty fail-closed sentinel, so the admin ceremony supplies one and
# so does this gate. A local PersistentVolume cannot render without it, which
# is itself one of the mutants below.
PIN_NODE=pin-node
RELEASE=smoke
NAMESPACE=default

render() {
  helm template "${RELEASE}" chart --kube-version v1.36.0 --namespace "${NAMESPACE}" "$@"
}

pin() {
  python3 -I -B scripts/ci/chart_storage_pin.py "$1" \
    --path "${DATA_PATH}" \
    --mount-path "${MOUNT_PATH}" \
    --storage-class "${STORAGE_CLASS}" \
    --local-root "${LOCAL_ROOT}" \
    --node "${PIN_NODE}" \
    --volume-name "${VOLUME_NAME}" \
    --key-secret "${KEY_SECRET}" \
    --capacity "${CAPACITY}" \
    --state-path "${STATE_PATH}" \
    --state-mount-path "${STATE_MOUNT_PATH}" \
    --state-volume-name "${STATE_VOLUME_NAME}" \
    --state-capacity "${STATE_CAPACITY}" \
    --namespace "${NAMESPACE}"
}

enabled_render="$(render --set panels.data.enabled=true)"
with_pv_render="$(render --set panels.data.enabled=true \
  --set panels.data.persistentVolume.enabled=true \
  --set panels.data.node="${PIN_NODE}")"
default_render="$(render)"
disabled_render="$(render --set panels.data.enabled=false)"

# (a) The four directions hold.
printf '%s' "${enabled_render}" | pin enabled ||
  fail "the enabled render violates the storage pin"
echo "chart-storage-pin: (a) enabled render: both claims + wiring (data ro, state rw), no PV"

printf '%s' "${with_pv_render}" | pin with-pv ||
  fail "the with-pv render violates the storage pin"
echo "chart-storage-pin: (b) admin render: the exact pair of local PersistentVolumes, node-pinned"

printf '%s' "${default_render}" | pin disabled ||
  fail "the DEFAULT render carries capability objects; a fresh install must never wait on admin volumes (review M6)"
echo "chart-storage-pin: (c) default render: capability fully absent — fresh installs schedule"

printf '%s' "${disabled_render}" | pin disabled ||
  fail "the disabled render still carries capability objects"
echo "chart-storage-pin: (d) explicit disabled render: no claim, no volume, no wiring"

# (e) Self-mutation battery: each hostile rewrite of the render must turn
# the checker red. sed operates on the RENDER, so what is proven is that the
# checker catches the outcome, whatever template edit might produce it.
mutation_count=0
minimum_mutations=44

mutate_must_fail() {
  local description="$1" mode="$2" expression="$3" source="$4"
  mutation_count=$((mutation_count + 1))
  if printf '%s' "${source}" | sed -e "${expression}" | pin "${mode}" >/dev/null 2>&1; then
    fail "surviving mutant: ${description}"
  fi
}

mutate_must_fail "volumeMount flipped writable" enabled \
  '/mountPath: '"${MOUNT_PATH//\//\\/}"'/,/readOnly/ s/readOnly: true/readOnly: false/' \
  "${enabled_render}"
mutate_must_fail "claim reference flipped writable" enabled \
  '/persistentVolumeClaim:/,/readOnly/ s/readOnly: true/readOnly: false/' \
  "${enabled_render}"
mutate_must_fail "claim storageClassName dropped" enabled \
  '/storageClassName: '"${STORAGE_CLASS}"'/d' \
  "${enabled_render}"
mutate_must_fail "claim storageClassName emptied — the shape the platform refuses" enabled \
  's/storageClassName: '"${STORAGE_CLASS}"'/storageClassName: ""/' \
  "${enabled_render}"
mutate_must_fail "claim unpinned from its volume" enabled \
  's/volumeName: '"${VOLUME_NAME}"'/volumeName: somebody-elses-volume/' \
  "${enabled_render}"
mutate_must_fail "claim renamed away from the pair" enabled \
  's/name: '"${VOLUME_NAME}"'$/name: renamed-claim/' \
  "${enabled_render}"
mutate_must_fail "env root diverges from the mount" enabled \
  's|value: "'"${MOUNT_PATH}"'"|value: "/var/lib/other"|' \
  "${enabled_render}"
mutate_must_fail "key secret made mandatory" enabled \
  's/optional: true/optional: false/' \
  "${enabled_render}"
mutate_must_fail "access mode widened" enabled \
  's/- ReadOnlyMany/- ReadWriteMany/' \
  "${enabled_render}"
mutate_must_fail "a PV smuggled into the default render" enabled \
  's/kind: PersistentVolumeClaim/kind: PersistentVolume/' \
  "${enabled_render}"
mutate_must_fail "local path moved off the reviewed directory" with-pv \
  's|path: '"${DATA_PATH}"'|path: /etc|' \
  "${with_pv_render}"
mutate_must_fail "local source swapped back to hostPath — the denied shape" with-pv \
  's/^  local:/  hostPath:/' \
  "${with_pv_render}"
mutate_must_fail "PV storageClassName emptied" with-pv \
  's/storageClassName: '"${STORAGE_CLASS}"'/storageClassName: ""/' \
  "${with_pv_render}"
mutate_must_fail "nodeAffinity dropped — a local volume nothing can place" with-pv \
  '/^  nodeAffinity:/,/^                - '"${PIN_NODE}"'$/d' \
  "${with_pv_render}"
mutate_must_fail "node selector operator widened to Exists" with-pv \
  's/operator: In/operator: Exists/' \
  "${with_pv_render}"
mutate_must_fail "node selector bound to a node nobody provisioned" with-pv \
  's/- '"${PIN_NODE}"'$/- some-other-node/' \
  "${with_pv_render}"
mutate_must_fail "reclaim policy weakened to Delete" with-pv \
  's/persistentVolumeReclaimPolicy: Retain/persistentVolumeReclaimPolicy: Delete/' \
  "${with_pv_render}"
mutate_must_fail "PV claimRef unpinned" with-pv \
  '/claimRef:/,/name:/ s/name: '"${VOLUME_NAME}"'/name: another-claim/' \
  "${with_pv_render}"
mutate_must_fail "capability objects surviving a disabled render" disabled \
  's/x-never-matches/x/' \
  "${enabled_render}"

# The replay-floor STATE pair's own battery (2026-08-24 review finding H2):
# the writable direction is pinned as hard as the read-only one.
mutate_must_fail "state mount flipped read-only" enabled \
  '/mountPath: '"${STATE_MOUNT_PATH//\//\\/}"'/,/readOnly/ s/readOnly: false/readOnly: true/' \
  "${enabled_render}"
mutate_must_fail "state claim reference flipped read-only" enabled \
  '/claimName: '"${STATE_VOLUME_NAME}"'/,/readOnly/ s/readOnly: false/readOnly: true/' \
  "${enabled_render}"
mutate_must_fail "state env diverges from the state mount" enabled \
  's|value: "'"${STATE_MOUNT_PATH}"'"|value: "/var/lib/other-state"|' \
  "${enabled_render}"
mutate_must_fail "state claim unpinned from its volume" enabled \
  's/volumeName: '"${STATE_VOLUME_NAME}"'/volumeName: somebody-elses-volume/' \
  "${enabled_render}"
mutate_must_fail "state access mode widened to ReadWriteMany" enabled \
  's/- ReadWriteOnce$/- ReadWriteMany/' \
  "${enabled_render}"
# The OPPOSITE direction, and the one round-4 finding 1 added: a render that
# CLAIMS the CSI-only ReadWriteOncePod must fail too. Round 3 required that
# mode here; the target has no CSI driver, so requiring it made this gate
# enforce a promise nothing keeps. Refusing it keeps the honest statement from
# regressing quietly the next time somebody reads "ReadWriteOnce" and reaches
# for the stronger-looking word.
mutate_must_fail "state access mode claiming the CSI-only ReadWriteOncePod" enabled \
  's/- ReadWriteOnce$/- ReadWriteOncePod/' \
  "${enabled_render}"
mutate_must_fail "state PV claiming the CSI-only ReadWriteOncePod" with-pv \
  's/- ReadWriteOnce$/- ReadWriteOncePod/' \
  "${with_pv_render}"
mutate_must_fail "a second replica racing the floor marker" enabled \
  's/^  replicas: 1$/  replicas: 2/' \
  "${enabled_render}"
mutate_must_fail "state PV local path moved off the reviewed directory" with-pv \
  's|path: '"${STATE_PATH}"'|path: /etc|' \
  "${with_pv_render}"

echo "chart-storage-pin: (e) render mutation battery held"

# The disjointness refusals need hostile FACTS, not a hostile render: the
# expected paths arrive from values.yaml, so a render alone cannot express
# them. Round-3 finding 7 asks for both directions and for aliases, so both
# guards are proven separately.
#
# (e1) The TEMPLATE refuses the geometry outright — nothing renders at all.
# This is the guard that protects a real deployment, since a chart that
# refuses to render cannot be applied.
render_must_fail() {
  local description="$1"
  shift
  mutation_count=$((mutation_count + 1))
  if render --set panels.data.enabled=true "$@" >/dev/null 2>&1; then
    fail "surviving mutant: ${description}"
  fi
}

render_must_fail "state directory nested inside the push directory" \
  --set panels.data.statePath="${DATA_PATH}/state"
render_must_fail "push directory nested inside the state directory" \
  --set panels.data.path="${STATE_PATH}/inner"
render_must_fail "state directory aliased onto the push directory" \
  --set panels.data.statePath="${DATA_PATH}"
render_must_fail "state mount nested inside the data mount" \
  --set panels.data.stateMountPath="${MOUNT_PATH}/state"
render_must_fail "data mount nested inside the state mount" \
  --set panels.data.mountPath="${STATE_MOUNT_PATH}/inner"
render_must_fail "a dot-dot alias of the push directory" \
  --set panels.data.statePath="${DATA_PATH}/../panels-data/state"
render_must_fail "a duplicated-separator alias of the push directory" \
  --set panels.data.path="${LOCAL_ROOT}//naranjo-online/panels-data"
render_must_fail "a trailing-separator alias of the push directory" \
  --set panels.data.path="${DATA_PATH}/"
render_must_fail "a local path outside the enumerated volume root" \
  --set panels.data.path=/etc/naranjo-online
render_must_fail "a local path AT the enumerated volume root" \
  --set panels.data.path="${LOCAL_ROOT}"
render_must_fail "a second replica beside the single-writer floor" \
  --set replicaCount=2
render_must_fail "a node-bound volume with no node" \
  --set panels.data.persistentVolume.enabled=true

# A sibling that merely SHARES A PREFIX is not nesting, and refusing it would
# be a pin that cannot be satisfied rather than one that catches anything.
render --set panels.data.enabled=true \
  --set panels.data.statePath="${DATA_PATH}-two" >/dev/null ||
  fail "the disjointness guard refuses a legitimate prefix-sharing sibling"

# (e2) The PIN refuses the same geometry even when the render and the stated
# facts AGREE with each other — the case a template edit could otherwise walk
# past, since the template guard and the pin are the same idea implemented
# twice on purpose.
pin_with_paths() {
  local mode="$1" data="$2" state="$3" mount="$4" state_mount="$5"
  python3 -I -B scripts/ci/chart_storage_pin.py "${mode}" \
    --path "${data}" \
    --mount-path "${mount}" \
    --storage-class "${STORAGE_CLASS}" \
    --local-root "${LOCAL_ROOT}" \
    --node "${PIN_NODE}" \
    --volume-name "${VOLUME_NAME}" \
    --key-secret "${KEY_SECRET}" \
    --capacity "${CAPACITY}" \
    --state-path "${state}" \
    --state-mount-path "${state_mount}" \
    --state-volume-name "${STATE_VOLUME_NAME}" \
    --state-capacity "${STATE_CAPACITY}" \
    --namespace "${NAMESPACE}"
}

facts_must_fail() {
  local description="$1" mode="$2" source="$3"
  shift 3
  mutation_count=$((mutation_count + 1))
  if printf '%s' "${source}" | pin_with_paths "${mode}" "$@" >/dev/null 2>&1; then
    fail "surviving mutant: ${description}"
  fi
}

nested_state_render="$(printf '%s' "${with_pv_render}" |
  sed "s|path: ${STATE_PATH}\$|path: ${DATA_PATH}/state|")"
facts_must_fail "state path nested inside the data path, render and facts agreeing" \
  with-pv "${nested_state_render}" \
  "${DATA_PATH}" "${DATA_PATH}/state" "${MOUNT_PATH}" "${STATE_MOUNT_PATH}"

nested_data_render="$(printf '%s' "${with_pv_render}" |
  sed "s|path: ${DATA_PATH}\$|path: ${STATE_PATH}/inner|")"
facts_must_fail "data path nested inside the state path, render and facts agreeing" \
  with-pv "${nested_data_render}" \
  "${STATE_PATH}/inner" "${STATE_PATH}" "${MOUNT_PATH}" "${STATE_MOUNT_PATH}"

alias_state_render="$(printf '%s' "${with_pv_render}" |
  sed "s|path: ${STATE_PATH}\$|path: ${DATA_PATH}/../panels-data|")"
facts_must_fail "an alias of the data path that a raw string compare calls different" \
  with-pv "${alias_state_render}" \
  "${DATA_PATH}" "${DATA_PATH}/../panels-data" "${MOUNT_PATH}" "${STATE_MOUNT_PATH}"

facts_must_fail "state mount nested inside the data mount, facts agreeing" \
  enabled "${enabled_render}" \
  "${DATA_PATH}" "${STATE_PATH}" "${MOUNT_PATH}" "${MOUNT_PATH}"

echo "chart-storage-pin: (f) disjointness proven in both directions, template and pin, with aliases"

[ "${mutation_count}" -ge "${minimum_mutations}" ] ||
  fail "only ${mutation_count} mutations ran; at least ${minimum_mutations} are required. Mutations are added, never removed."
echo "chart-storage-pin: (g) mutation battery held (${mutation_count} mutants, all caught)"

echo "chart-storage-pin: the data root renders read-only, pinned, and absent by default and when disabled"
