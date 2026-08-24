#!/usr/bin/env bash
# chart-storage-pin — prove the rendered panels data root keeps every storage
# invariant (issue #142), in BOTH directions:
#
#   enabled (the default values): exactly one PersistentVolumeClaim, pinned
#   to its PersistentVolume by name with an EXPLICIT empty storageClassName
#   (an omitted one would let the default StorageClass capture the claim),
#   ReadOnlyMany, the declared capacity; the Deployment mounts it readOnly
#   at BOTH the claim reference and the volumeMount, PANELS_DATA_ROOT equals
#   the mount path, and the key Secret reference is optional so its absence
#   degrades the panel rather than the pod. No PersistentVolume renders by
#   default: the release identity deliberately holds no PV authority.
#
#   with-pv (panels.data.persistentVolume.enabled=true, the admin ceremony):
#   additionally exactly one PersistentVolume — hostPath at the reviewed
#   path with type Directory (mounts only what an admin already created),
#   Retain, explicit empty storageClassName, and a claimRef pinning the pair
#   from the volume side too.
#
#   disabled (panels.data.enabled=false): NONE of it — no claim, no volume,
#   no mount, no PANELS_DATA_* environment. The capability cannot half-exist.
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
read_value() {
  python3 -I -B - "$1" <<'PY'
import re
import sys

key = sys.argv[1]
text = open("chart/values.yaml", encoding="utf-8").read()
match = re.search(r"^\s+%s:\s*(\S+)\s*$" % re.escape(key), text, re.MULTILINE)
if not match:
    sys.exit("chart/values.yaml carries no %s" % key)
print(match.group(1).strip("'\""))
PY
}

HOST_PATH="$(read_value hostPath)"
VOLUME_NAME="$(read_value volumeName)"
KEY_SECRET="$(read_value keySecret)"
CAPACITY="$(read_value capacity)"
RELEASE=smoke
NAMESPACE=default

render() {
  helm template "${RELEASE}" chart --kube-version v1.36.0 --namespace "${NAMESPACE}" "$@"
}

pin() {
  python3 -I -B scripts/ci/chart_storage_pin.py "$1" \
    --host-path "${HOST_PATH}" \
    --volume-name "${VOLUME_NAME}" \
    --key-secret "${KEY_SECRET}" \
    --capacity "${CAPACITY}" \
    --namespace "${NAMESPACE}"
}

enabled_render="$(render)"
with_pv_render="$(render --set panels.data.persistentVolume.enabled=true)"
disabled_render="$(render --set panels.data.enabled=false)"

# (a) The three directions hold.
printf '%s' "${enabled_render}" | pin enabled ||
  fail "the default render violates the storage pin"
echo "chart-storage-pin: (a) default render: claim + read-only wiring, no PV"

printf '%s' "${with_pv_render}" | pin with-pv ||
  fail "the with-pv render violates the storage pin"
echo "chart-storage-pin: (b) admin render: the exact hostPath PersistentVolume"

printf '%s' "${disabled_render}" | pin disabled ||
  fail "the disabled render still carries capability objects"
echo "chart-storage-pin: (c) disabled render: no claim, no volume, no wiring"

# (d) Self-mutation battery: each hostile rewrite of the render must turn
# the checker red. sed operates on the RENDER, so what is proven is that the
# checker catches the outcome, whatever template edit might produce it.
mutation_count=0
minimum_mutations=12

mutate_must_fail() {
  local description="$1" mode="$2" expression="$3" source="$4"
  mutation_count=$((mutation_count + 1))
  if printf '%s' "${source}" | sed -e "${expression}" | pin "${mode}" >/dev/null 2>&1; then
    fail "surviving mutant: ${description}"
  fi
}

mutate_must_fail "volumeMount flipped writable" enabled \
  '/mountPath: \/var\/lib\/panels-data/,/readOnly/ s/readOnly: true/readOnly: false/' \
  "${enabled_render}"
mutate_must_fail "claim reference flipped writable" enabled \
  '/persistentVolumeClaim:/,/readOnly/ s/readOnly: true/readOnly: false/' \
  "${enabled_render}"
mutate_must_fail "claim storageClassName dropped" enabled \
  '/storageClassName: ""/d' \
  "${enabled_render}"
mutate_must_fail "claim unpinned from its volume" enabled \
  's/volumeName: '"${VOLUME_NAME}"'/volumeName: somebody-elses-volume/' \
  "${enabled_render}"
mutate_must_fail "claim renamed away from the pair" enabled \
  's/name: '"${VOLUME_NAME}"'$/name: renamed-claim/' \
  "${enabled_render}"
mutate_must_fail "env root diverges from the mount" enabled \
  's|value: "/var/lib/panels-data"|value: "/var/lib/other"|' \
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
mutate_must_fail "hostPath moved off the reviewed directory" with-pv \
  's|path: '"${HOST_PATH}"'|path: /etc|' \
  "${with_pv_render}"
mutate_must_fail "hostPath type weakened to DirectoryOrCreate" with-pv \
  's/type: Directory$/type: DirectoryOrCreate/' \
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

[ "${mutation_count}" -ge "${minimum_mutations}" ] ||
  fail "only ${mutation_count} mutations ran; at least ${minimum_mutations} are required. Mutations are added, never removed."
echo "chart-storage-pin: (d) mutation battery held (${mutation_count} mutants, all caught)"

echo "chart-storage-pin: the data root renders read-only, pinned, and absent when disabled"
