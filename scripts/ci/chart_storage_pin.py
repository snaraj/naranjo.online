#!/usr/bin/env python3
"""Whole-render storage pin for the panels data root (issue #142).

WHY THIS EXISTS. The data root mounts node bytes into the serving pod. Every
safety property of that mount is a rendered FACT — read-only at both the
claim reference and the mount, a `local` volume naming exactly the reviewed
directory under the enumerated local-volume root, static binding pinned from
both sides, the enumerated storageClassName named on BOTH objects, bounded
required nodeAffinity, a Retain reclaim policy, and an environment root that
equals the mount path — and a fact a template edit can move is a fact this
gate must hold. The disabled direction is pinned with equal force: a render
with the capability off must contain NONE of the objects, so the capability
cannot half-exist.

WHAT CHANGED IN THE 2026-08-24 ROUND-3 REVIEW (findings 3 and 7). The volumes
were hostPath with an explicitly empty storageClassName. website-infrastructure
#211 (now carried by website-infrastructure PR #212) denies hostPath
outright and admits only enumerated
classes, so the chart adopted the platform shape and this pin moved with it:
it now requires `local` and refuses a hostPath source, requires the enumerated
class rather than the empty one, and requires nodeAffinity to be REQUIRED,
singular, operator In, with a non-empty value. One further hole closed here:
the sibling check runs in BOTH directions over NORMALIZED paths, for the node
directories and the container mount paths alike. The old check compared raw
strings in one direction only, so `/x/data/../data/state` and a data root
nested inside the writable state root both passed.

WHAT CHANGED IN THE 2026-08-25 ROUND-4 REVIEW (finding 1). Round 3 also moved
the state pair to ReadWriteOncePod and this module REQUIRED that mode. The
reasoning was right — ReadWriteOnce is node-scoped, and on a one-node cluster
it restricts nothing — but the mechanism was not: Kubernetes supports
ReadWriteOncePod for CSI volumes only, and the live target runs zero CSI
drivers — its enumerated StorageClass provisions nothing. Requiring it here
made this gate enforce a
promise the target cannot keep, which is the worse failure: a reader who sees
the mode stops looking for the real mechanism. The state pair is
ReadWriteOnce again, and this module now does three things instead of one — it
requires the mode the target actually supports, it refuses any WIDENING of it,
and it separately refuses ANY object that claims ReadWriteOncePod, so the
overstatement cannot return through a values edit. The single-writer property
is carried where it is actually enforced: the origin's locked monotonic
compare-and-swap (internal/server/panelsdata.go) and the replica policy this
module also pins.

HOW IT READS THE RENDER. Through chart_render_census's own document reader —
the fail-closed YAML-subset reader issue #86 built precisely so no second,
weaker parser would ever grow beside it. This module contains no parsing of
its own; it walks canonical objects and compares values.

MODES (stdin is always one complete multi-document render):
  enabled       -- the panels.data.enabled render: BOTH claims (read-only
                   data + writable replay-floor state, 2026-08-24 review
                   finding H2) + deployment wiring, no PV.
  with-pv       -- the persistentVolume.enabled render: everything above
                   plus the exact pair of PersistentVolumes.
  disabled      -- the capability-off render: none of it.

Facts arrive on the command line (--path, --volume-name, --key-secret,
--capacity, --state-path, --state-volume-name, --state-capacity,
--namespace, --mount-path, --state-mount-path, --storage-class,
--local-root, --node) so the expectation is stated by the CALLER —
scripts/ci/chart-storage-pin.sh reads values.yaml, the single source the
deployment-provider contract designates — never re-derived from the very
template under test.
"""

from __future__ import annotations

import argparse
import posixpath
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import chart_render_census as census  # noqa: E402


class StoragePinError(ValueError):
    """The render violates a pinned storage invariant."""


def _documents(text: str) -> list[dict]:
    """Every installable object in the render, through the census's own reader.

    `parse_documents` answers `list[object]`, because a YAML stream may hold
    anything; `flatten` is the census's narrowing step and the one this module's
    header always claimed to use. It is not a cast: it drops empty documents,
    REFUSES a document that is not a mapping or that declares no string `kind`
    instead of letting it reach a `.get` call below, and unwraps `List`
    wrappers — so a PersistentVolume smuggled inside one is counted by the
    checks here rather than hidden from them.
    """
    return census.flatten(census.parse_documents(text, "<render>"))


def _of_kind(objects: list[dict], kind: str) -> list[dict]:
    return [o for o in objects if o.get("kind") == kind]


def _deployment(objects: list[dict]) -> dict:
    deployments = _of_kind(objects, "Deployment")
    if len(deployments) != 1:
        raise StoragePinError("the render must carry exactly one Deployment")
    return deployments[0]


def _pod_spec(deployment: dict) -> dict:
    try:
        return deployment["spec"]["template"]["spec"]
    except (KeyError, TypeError):
        raise StoragePinError("the Deployment carries no pod spec")


def _container(deployment: dict) -> dict:
    containers = _pod_spec(deployment).get("containers")
    if not isinstance(containers, list) or len(containers) != 1:
        raise StoragePinError("the Deployment must carry exactly one container")
    return containers[0]


def _named(entries, name: str) -> list[dict]:
    return [e for e in entries or [] if isinstance(e, dict) and e.get("name") == name]


def _normal(path: str) -> str:
    """The one normalization every path comparison in this module goes
    through. posixpath.normpath collapses duplicate separators, resolves .
    and .. lexically, and drops a trailing separator, so the three spellings
    that used to defeat the old raw-string check — /x/data/, /x//data and
    /x/data/../data — all reduce to the single directory the kernel would
    open. Comparing anything but normalized forms is comparing spellings."""
    return posixpath.normpath(path)


def _require_disjoint(a_name: str, a: str, b_name: str, b: str) -> None:
    """Neither path may BE the other, nor contain the other, either way.

    The two roots carry opposite trust: one is the pushed sealed series,
    mounted read-only in every layer, and the other is the origin's single
    writable surface. Overlap in EITHER direction collapses that separation —
    a writable root inside the read-only projection lets the origin write into
    what it must only read, and a read-only root inside the writable one is
    the identical breach stated backwards. The old check tested one direction
    with a raw prefix, so it missed both the reverse case and every alias.

    The ancestor test appends an explicit separator on purpose: without it,
    /x/panels-data-two reads as a child of /x/panels-data and the pin refuses
    a perfectly good sibling while still missing real nesting elsewhere."""
    left, right = _normal(a), _normal(b)
    if left == right:
        raise StoragePinError(
            "%s and %s resolve to the same directory (%s); the read-only projection "
            "and the writable surface may never be the same place" % (a_name, b_name, left))
    if right.startswith(left.rstrip("/") + "/"):
        raise StoragePinError(
            "%s (%s) sits inside %s (%s); the writable surface may never live within "
            "the read-only projection" % (b_name, right, a_name, left))
    if left.startswith(right.rstrip("/") + "/"):
        raise StoragePinError(
            "%s (%s) sits inside %s (%s); the read-only projection may never live "
            "within the writable surface" % (a_name, left, b_name, right))


def check_disabled(objects: list[dict]) -> None:
    """A disabled render carries no trace of the capability."""
    for kind in ("PersistentVolume", "PersistentVolumeClaim"):
        if _of_kind(objects, kind):
            raise StoragePinError("a disabled render still carries a %s" % kind)
    deployment = _deployment(objects)
    container = _container(deployment)
    for env in container.get("env") or []:
        if isinstance(env, dict) and str(env.get("name", "")).startswith("PANELS_DATA"):
            raise StoragePinError("a disabled render still wires %s" % env.get("name"))
    for volume_name in ("panels-data", "panels-state"):
        if _named(container.get("volumeMounts"), volume_name):
            raise StoragePinError("a disabled render still mounts %s" % volume_name)
        if _named(_pod_spec(deployment).get("volumes"), volume_name):
            raise StoragePinError("a disabled render still declares the %s volume" % volume_name)


def _one_claim(objects: list[dict], name: str) -> dict:
    claims = [
        c for c in _of_kind(objects, "PersistentVolumeClaim")
        if (c.get("metadata") or {}).get("name") == name
    ]
    if len(claims) != 1:
        raise StoragePinError(
            "the render must carry exactly one PersistentVolumeClaim named %s" % name)
    return claims[0]


def _refuse_unsupported_access_modes(kind: str, name: str, modes) -> None:
    """No rendered object may CLAIM ReadWriteOncePod on this target.

    2026-08-25 round-4 finding 1. Kubernetes supports ReadWriteOncePod for CSI
    volumes only, and this target runs zero CSI drivers; a native `local`
    volume that names the mode does not become single-writer,
    it becomes a manifest that READS as if it were. The check is explicit
    rather than implied by the expected-mode comparison below, so a regression
    fails with the reason rather than with a string mismatch that invites
    somebody to "fix" it by widening the expectation.
    """
    for mode in modes or []:
        if mode == "ReadWriteOncePod":
            raise StoragePinError(
                "%s %s claims ReadWriteOncePod; Kubernetes supports that mode for CSI "
                "volumes only and this target has no CSI driver, so it would name a "
                "guarantee nothing enforces. Single writing is held by the origin's "
                "locked monotonic compare-and-swap and by the single-replica render."
                % (kind, name))


def _check_claim_common(claim: dict, facts: argparse.Namespace, name: str,
                        access_mode: str, capacity: str) -> None:
    metadata = claim.get("metadata") or {}
    if metadata.get("namespace") != facts.namespace:
        raise StoragePinError("claim %s is not in the release namespace" % name)
    spec = claim.get("spec") or {}
    _refuse_unsupported_access_modes("claim", name, spec.get("accessModes"))
    if spec.get("accessModes") != [access_mode]:
        raise StoragePinError("claim %s's access mode is not exactly %s" % (name, access_mode))
    if spec.get("storageClassName") != facts.storage_class:
        raise StoragePinError(
            "claim %s must name the enumerated StorageClass %s; an omitted name lets "
            "the default StorageClass capture the claim, and the empty name this "
            "replaced only excluded a default provisioner rather than binding the "
            "pair to the class the platform admits" % (name, facts.storage_class))
    if spec.get("volumeName") != name:
        raise StoragePinError("claim %s does not pin volumeName to itself" % name)
    # Platform storage acceptance SR-12 and SR-15 (website-infrastructure
    # #211, carried by PR #212): a claim that names a data
    # source or a volume-attributes class is asking the platform to do
    # something other than bind the exact pre-provisioned volume above it.
    for forbidden in ("dataSource", "dataSourceRef", "volumeAttributesClassName"):
        if forbidden in spec:
            raise StoragePinError(
                "claim %s carries %s; a statically bound claim must ask for nothing "
                "but the volume it names" % (name, forbidden))
    requests = (spec.get("resources") or {}).get("requests") or {}
    if requests.get("storage") != capacity:
        raise StoragePinError("claim %s does not request the declared capacity" % name)


def check_claims(objects: list[dict], facts: argparse.Namespace) -> None:
    """Exactly two claims: the read-only data claim and the writable state
    claim (2026-08-24 review finding H2 — the replay-floor marker's home)."""
    claims = _of_kind(objects, "PersistentVolumeClaim")
    if len(claims) != 2:
        raise StoragePinError(
            "the enabled render must carry exactly two PersistentVolumeClaims "
            "(data and state); found %d" % len(claims))
    _check_claim_common(_one_claim(objects, facts.volume_name), facts,
                        facts.volume_name, "ReadOnlyMany", facts.capacity)
    _check_claim_common(_one_claim(objects, facts.state_volume_name), facts,
                        facts.state_volume_name, "ReadWriteOnce", facts.state_capacity)


def check_deployment_wiring(objects: list[dict], facts: argparse.Namespace) -> None:
    deployment = _deployment(objects)
    container = _container(deployment)

    # Single writer, ENFORCED HERE (round-3 finding 3, corrected by round-4
    # finding 1). Round 3 read this as the render-time echo of a claim-level
    # ReadWriteOncePod enforcement. There is no such enforcement on this
    # target — RWOP is CSI-only and the target has no CSI driver — so this
    # check is not an echo of anything: together with the origin's locked
    # monotonic compare-and-swap it is the whole mechanism, and a replica
    # count that would race the floor marker must fail HERE, at render, rather
    # than in a cluster that would happily schedule the second writer.
    replicas = (deployment.get("spec") or {}).get("replicas")
    if replicas != 1:
        raise StoragePinError(
            "the data-root render declares %r replicas; the replay-floor state is a "
            "single-writer surface and this capability renders only at 1" % (replicas,))

    # The container mount paths must be disjoint for the same reason the node
    # directories are: a writable mount inside a read-only mount point is a
    # writable window into it.
    _require_disjoint("the data mount path", facts.mount_path,
                      "the state mount path", facts.state_mount_path)

    roots = _named(container.get("env"), "PANELS_DATA_ROOT")
    if len(roots) != 1 or roots[0].get("value") != facts.mount_path:
        raise StoragePinError("PANELS_DATA_ROOT must equal the mount path %s" % facts.mount_path)
    states = _named(container.get("env"), "PANELS_DATA_STATE")
    if len(states) != 1 or states[0].get("value") != facts.state_mount_path:
        raise StoragePinError(
            "PANELS_DATA_STATE must equal the state mount path %s" % facts.state_mount_path)
    keys = _named(container.get("env"), "PANELS_DATA_KEY")
    if len(keys) != 1:
        raise StoragePinError("PANELS_DATA_KEY must be wired exactly once")
    key_ref = ((keys[0].get("valueFrom") or {}).get("secretKeyRef")) or {}
    if key_ref.get("name") != facts.key_secret or key_ref.get("key") != "PANELS_DATA_KEY":
        raise StoragePinError("PANELS_DATA_KEY must come from the %s Secret" % facts.key_secret)
    if key_ref.get("optional") is not True:
        raise StoragePinError(
            "the key Secret reference must be optional: its absence degrades the panel, "
            "never the pod")

    mounts = _named(container.get("volumeMounts"), "panels-data")
    if len(mounts) != 1:
        raise StoragePinError("the panels-data volume must be mounted exactly once")
    if mounts[0].get("mountPath") != facts.mount_path:
        raise StoragePinError("the mount path is not %s" % facts.mount_path)
    if mounts[0].get("readOnly") is not True:
        raise StoragePinError("the volumeMount must be readOnly: true")

    # The state mount is the ONE writable projection (2026-08-24 review
    # finding H2), and its writability is pinned EXPLICITLY in both
    # directions: read-only would silently lose the durable replay floor,
    # and it must never be the data mount that gains the writability.
    state_mounts = _named(container.get("volumeMounts"), "panels-state")
    if len(state_mounts) != 1:
        raise StoragePinError("the panels-state volume must be mounted exactly once")
    if state_mounts[0].get("mountPath") != facts.state_mount_path:
        raise StoragePinError("the state mount path is not %s" % facts.state_mount_path)
    if state_mounts[0].get("readOnly") is not False:
        raise StoragePinError(
            "the state volumeMount must be EXPLICITLY readOnly: false — a read-only "
            "state root silently loses the durable replay floor")

    volumes = _named(_pod_spec(deployment).get("volumes"), "panels-data")
    if len(volumes) != 1:
        raise StoragePinError("the panels-data volume must be declared exactly once")
    claim_ref = volumes[0].get("persistentVolumeClaim") or {}
    if claim_ref.get("claimName") != facts.volume_name:
        raise StoragePinError("the volume does not reference the %s claim" % facts.volume_name)
    if claim_ref.get("readOnly") is not True:
        raise StoragePinError("the claim reference must be readOnly: true — both levels, always")

    state_volumes = _named(_pod_spec(deployment).get("volumes"), "panels-state")
    if len(state_volumes) != 1:
        raise StoragePinError("the panels-state volume must be declared exactly once")
    state_claim_ref = state_volumes[0].get("persistentVolumeClaim") or {}
    if state_claim_ref.get("claimName") != facts.state_volume_name:
        raise StoragePinError(
            "the state volume does not reference the %s claim" % facts.state_volume_name)
    if state_claim_ref.get("readOnly") is not False:
        raise StoragePinError(
            "the state claim reference must be EXPLICITLY readOnly: false — both levels, "
            "matching the mount")


def _one_volume(objects: list[dict], name: str) -> dict:
    volumes = [
        v for v in _of_kind(objects, "PersistentVolume")
        if (v.get("metadata") or {}).get("name") == name
    ]
    if len(volumes) != 1:
        raise StoragePinError(
            "the with-pv render must carry exactly one PersistentVolume named %s" % name)
    return volumes[0]


def _check_volume_common(volume: dict, facts: argparse.Namespace, name: str,
                         access_mode: str, capacity: str, path: str) -> None:
    spec = volume.get("spec") or {}
    _refuse_unsupported_access_modes("PV", name, spec.get("accessModes"))
    if spec.get("accessModes") != [access_mode]:
        raise StoragePinError("PV %s's access mode is not exactly %s" % (name, access_mode))
    if spec.get("persistentVolumeReclaimPolicy") != "Retain":
        raise StoragePinError("PV %s's reclaim policy must be Retain" % name)
    if spec.get("storageClassName") != facts.storage_class:
        raise StoragePinError(
            "PV %s must name the enumerated StorageClass %s" % (name, facts.storage_class))
    if (spec.get("capacity") or {}).get("storage") != capacity:
        raise StoragePinError("PV %s does not declare the expected capacity" % name)
    claim_ref = spec.get("claimRef") or {}
    if claim_ref.get("namespace") != facts.namespace or claim_ref.get("name") != name:
        raise StoragePinError(
            "PV %s's claimRef must pin the pair: namespace %s, name %s"
            % (name, facts.namespace, name))
    # Platform storage acceptance SR-2 (website-infrastructure #211, carried
    # by PR #212): hostPath is denied outright. It is the
    # admin-only loophole through restricted pod security, which is exactly
    # why the shape this replaced needed a manual admin ceremony to exist at
    # all. Naming it here rather than only checking for `local` means a
    # regression reports the actual reason it is refused.
    if "hostPath" in spec:
        raise StoragePinError(
            "PV %s declares a hostPath; the platform storage acceptance denies hostPath "
            "volumes outright — a local volume under the enumerated root is the "
            "admitted shape" % name)
    if "mountOptions" in spec:
        raise StoragePinError("PV %s declares mountOptions; the enumerated shape carries none" % name)
    local = spec.get("local")
    if not isinstance(local, dict):
        raise StoragePinError(
            "PV %s must declare a `local` volume source; it is one of the two sources "
            "the platform admits, and the only one this chart provisions" % name)
    if local.get("path") != path:
        raise StoragePinError("PV %s's local path is not the reviewed %s" % (name, path))
    if not _normal(path).startswith(_normal(facts.local_root).rstrip("/") + "/"):
        raise StoragePinError(
            "PV %s's local path must live strictly under the enumerated local-volume "
            "root %s" % (name, facts.local_root))
    # A local volume is node-bound by definition: without REQUIRED
    # nodeAffinity the scheduler has nothing to place the pod against, and a
    # `preferred` affinity would be a suggestion where the platform demands a
    # constraint. Bounded means bounded — one term, one expression, operator
    # In, exactly the reviewed node — because a wider match is a volume that
    # can bind on a machine nobody provisioned the directory on.
    affinity = spec.get("nodeAffinity")
    if not isinstance(affinity, dict) or "required" not in affinity:
        raise StoragePinError(
            "PV %s must carry REQUIRED nodeAffinity; a local volume without one is "
            "unplaceable, and a preferred one is a suggestion" % name)
    if set(affinity) != {"required"}:
        raise StoragePinError(
            "PV %s's nodeAffinity must carry nothing but `required`" % name)
    terms = (affinity["required"] or {}).get("nodeSelectorTerms")
    if not isinstance(terms, list) or len(terms) != 1:
        raise StoragePinError(
            "PV %s must carry exactly one nodeSelectorTerm; alternatives widen the "
            "set of nodes the volume may bind on" % name)
    expressions = (terms[0] or {}).get("matchExpressions")
    if not isinstance(expressions, list) or len(expressions) != 1:
        raise StoragePinError("PV %s must carry exactly one matchExpression" % name)
    expression = expressions[0] or {}
    if expression.get("key") != "kubernetes.io/hostname":
        raise StoragePinError(
            "PV %s must select its node by kubernetes.io/hostname" % name)
    if expression.get("operator") != "In":
        raise StoragePinError(
            "PV %s's node selector must use operator In; Exists and NotIn match sets "
            "of nodes rather than the one node the directory exists on" % name)
    values = expression.get("values")
    if not isinstance(values, list) or len(values) != 1 or not values[0]:
        raise StoragePinError(
            "PV %s's node selector must carry exactly one non-empty value" % name)
    if values[0] != facts.node:
        raise StoragePinError(
            "PV %s is bound to node %r, not the stated %r" % (name, values[0], facts.node))


def check_volumes(objects: list[dict], facts: argparse.Namespace) -> None:
    """Exactly two PVs in the admin render: read-only data, writable state."""
    volumes = _of_kind(objects, "PersistentVolume")
    if len(volumes) != 2:
        raise StoragePinError(
            "the with-pv render must carry exactly two PersistentVolumes "
            "(data and state); found %d" % len(volumes))
    _check_volume_common(_one_volume(objects, facts.volume_name), facts,
                         facts.volume_name, "ReadOnlyMany", facts.capacity, facts.path)
    _check_volume_common(_one_volume(objects, facts.state_volume_name), facts,
                         facts.state_volume_name, "ReadWriteOnce", facts.state_capacity,
                         facts.state_path)
    _require_disjoint("the data path", facts.path, "the state path", facts.state_path)


def run(mode: str, text: str, facts: argparse.Namespace) -> None:
    objects = _documents(text)
    if mode == "disabled":
        # A disabled render is checked for ABSENCE, so it reads no values fact:
        # every expectation it has is "none of it is here".
        check_disabled(objects)
        return
    check_claims(objects, facts)
    check_deployment_wiring(objects, facts)
    if mode == "with-pv":
        check_volumes(objects, facts)
    elif _of_kind(objects, "PersistentVolume"):
        raise StoragePinError(
            "the default render carries a PersistentVolume; the release identity holds "
            "no PV authority, so the PV renders only under the explicit admin flag")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("enabled", "with-pv", "disabled"))
    parser.add_argument("--path", required=True)
    parser.add_argument("--storage-class", required=True)
    parser.add_argument("--local-root", required=True)
    # Required like every other stated fact. It defaulted to "" and the node
    # comparison was guarded by `if facts.node and ...`, so omitting it did
    # not relax the check loudly — it SKIPPED it silently, and a PV bound to
    # the wrong node passed the pin. A fact the checker asserts against is a
    # fact the caller must state.
    parser.add_argument("--node", required=True)
    parser.add_argument("--volume-name", required=True)
    parser.add_argument("--key-secret", required=True)
    parser.add_argument("--capacity", required=True)
    parser.add_argument("--state-path", required=True)
    parser.add_argument("--state-volume-name", required=True)
    parser.add_argument("--state-capacity", required=True)
    parser.add_argument("--namespace", required=True)
    # No defaults: the mount paths are values-file facts now (round-3 finding
    # 7), and a default here would let the caller stop stating them while the
    # template moved underneath.
    parser.add_argument("--mount-path", required=True)
    parser.add_argument("--state-mount-path", required=True)
    facts = parser.parse_args(argv)
    try:
        run(facts.mode, sys.stdin.read(), facts)
    except (StoragePinError, census.CensusError) as error:
        print("chart-storage-pin: %s" % error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
