#!/usr/bin/env python3
"""Whole-render storage pin for the panels data root (issue #142).

WHY THIS EXISTS. The data root mounts host bytes into the serving pod. Every
safety property of that mount is a rendered FACT — read-only at both the
claim reference and the mount, a hostPath that names exactly the reviewed
directory and refuses to create it, static binding pinned from both sides,
an explicit empty storageClassName so no default provisioner can intercept
the pair, a Retain reclaim policy, and an environment root that equals the
mount path — and a fact a template edit can move is a fact this gate must
hold. The disabled direction is pinned with equal force: a render with the
capability off must contain NONE of the objects, so the capability cannot
half-exist.

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

Facts arrive on the command line (--host-path, --volume-name, --key-secret,
--capacity, --state-host-path, --state-volume-name, --state-capacity,
--namespace, --mount-path, --state-mount-path) so the expectation is stated
by the CALLER — scripts/ci/chart-storage-pin.sh reads values.yaml, the
single source the deployment-provider contract designates — never re-derived
from the very template under test.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import chart_render_census as census  # noqa: E402


class StoragePinError(ValueError):
    """The render violates a pinned storage invariant."""


def _documents(text: str) -> list[dict]:
    return census.parse_documents(text, "<render>")


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


def check_disabled(objects: list[dict], facts: argparse.Namespace) -> None:
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


def _check_claim_common(claim: dict, facts: argparse.Namespace, name: str,
                        access_mode: str, capacity: str) -> None:
    metadata = claim.get("metadata") or {}
    if metadata.get("namespace") != facts.namespace:
        raise StoragePinError("claim %s is not in the release namespace" % name)
    spec = claim.get("spec") or {}
    if spec.get("accessModes") != [access_mode]:
        raise StoragePinError("claim %s's access mode is not exactly %s" % (name, access_mode))
    if "storageClassName" not in spec or spec.get("storageClassName") != "":
        raise StoragePinError(
            "claim %s must carry an EXPLICIT empty storageClassName; an omitted one "
            "lets the default StorageClass capture the claim" % name)
    if spec.get("volumeName") != name:
        raise StoragePinError("claim %s does not pin volumeName to itself" % name)
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
                         access_mode: str, capacity: str, host_path: str) -> None:
    spec = volume.get("spec") or {}
    if spec.get("accessModes") != [access_mode]:
        raise StoragePinError("PV %s's access mode is not exactly %s" % (name, access_mode))
    if spec.get("persistentVolumeReclaimPolicy") != "Retain":
        raise StoragePinError("PV %s's reclaim policy must be Retain" % name)
    if "storageClassName" not in spec or spec.get("storageClassName") != "":
        raise StoragePinError("PV %s must carry an EXPLICIT empty storageClassName" % name)
    if (spec.get("capacity") or {}).get("storage") != capacity:
        raise StoragePinError("PV %s does not declare the expected capacity" % name)
    claim_ref = spec.get("claimRef") or {}
    if claim_ref.get("namespace") != facts.namespace or claim_ref.get("name") != name:
        raise StoragePinError(
            "PV %s's claimRef must pin the pair: namespace %s, name %s"
            % (name, facts.namespace, name))
    rendered = spec.get("hostPath") or {}
    if rendered.get("path") != host_path:
        raise StoragePinError("PV %s's hostPath is not the reviewed %s" % (name, host_path))
    if rendered.get("type") != "Directory":
        raise StoragePinError(
            "PV %s's hostPath type must be Directory — it mounts only a directory an "
            "admin already created, never creates one" % name)


def check_volumes(objects: list[dict], facts: argparse.Namespace) -> None:
    """Exactly two PVs in the admin render: read-only data, writable state."""
    volumes = _of_kind(objects, "PersistentVolume")
    if len(volumes) != 2:
        raise StoragePinError(
            "the with-pv render must carry exactly two PersistentVolumes "
            "(data and state); found %d" % len(volumes))
    _check_volume_common(_one_volume(objects, facts.volume_name), facts,
                         facts.volume_name, "ReadOnlyMany", facts.capacity, facts.host_path)
    _check_volume_common(_one_volume(objects, facts.state_volume_name), facts,
                         facts.state_volume_name, "ReadWriteOnce", facts.state_capacity,
                         facts.state_host_path)
    # The state directory must be a genuine SIBLING: never the push
    # directory itself, and never nested inside it, so the origin's one
    # writable surface can never reach the pushed series file.
    if facts.state_host_path == facts.host_path or facts.state_host_path.startswith(
            facts.host_path.rstrip("/") + "/"):
        raise StoragePinError(
            "the state hostPath must be a sibling of the data hostPath, never the push "
            "directory or inside it")


def run(mode: str, text: str, facts: argparse.Namespace) -> None:
    objects = _documents(text)
    if mode == "disabled":
        check_disabled(objects, facts)
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
    parser.add_argument("--host-path", required=True)
    parser.add_argument("--volume-name", required=True)
    parser.add_argument("--key-secret", required=True)
    parser.add_argument("--capacity", required=True)
    parser.add_argument("--state-host-path", required=True)
    parser.add_argument("--state-volume-name", required=True)
    parser.add_argument("--state-capacity", required=True)
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--mount-path", default="/var/lib/panels-data")
    parser.add_argument("--state-mount-path", default="/var/lib/panels-state")
    facts = parser.parse_args(argv)
    try:
        run(facts.mode, sys.stdin.read(), facts)
    except (StoragePinError, census.CensusError) as error:
        print("chart-storage-pin: %s" % error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
