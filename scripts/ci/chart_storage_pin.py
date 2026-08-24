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
  enabled       -- the default render: claim + deployment wiring, no PV.
  with-pv       -- the persistentVolume.enabled render: everything above
                   plus the exact PersistentVolume.
  disabled      -- the panels.data.enabled=false render: none of it.

Facts arrive on the command line (--host-path, --volume-name, --key-secret,
--capacity, --namespace, --mount-path) so the expectation is stated by the
CALLER — scripts/ci/chart-storage-pin.sh reads values.yaml, the single
source the deployment-provider contract designates — never re-derived from
the very template under test.
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
    if _named(container.get("volumeMounts"), "panels-data"):
        raise StoragePinError("a disabled render still mounts panels-data")
    if _named(_pod_spec(deployment).get("volumes"), "panels-data"):
        raise StoragePinError("a disabled render still declares the panels-data volume")


def check_claim(objects: list[dict], facts: argparse.Namespace) -> dict:
    claims = _of_kind(objects, "PersistentVolumeClaim")
    if len(claims) != 1:
        raise StoragePinError("the render must carry exactly one PersistentVolumeClaim")
    claim = claims[0]
    metadata = claim.get("metadata") or {}
    if metadata.get("name") != facts.volume_name:
        raise StoragePinError("the claim is not named %s" % facts.volume_name)
    if metadata.get("namespace") != facts.namespace:
        raise StoragePinError("the claim is not in the release namespace")
    spec = claim.get("spec") or {}
    if spec.get("accessModes") != ["ReadOnlyMany"]:
        raise StoragePinError("the claim's access mode is not exactly ReadOnlyMany")
    if "storageClassName" not in spec or spec.get("storageClassName") != "":
        raise StoragePinError(
            "the claim must carry an EXPLICIT empty storageClassName; an omitted one "
            "lets the default StorageClass capture the claim")
    if spec.get("volumeName") != facts.volume_name:
        raise StoragePinError("the claim does not pin volumeName to %s" % facts.volume_name)
    requests = (spec.get("resources") or {}).get("requests") or {}
    if requests.get("storage") != facts.capacity:
        raise StoragePinError("the claim does not request the declared capacity")
    return claim


def check_deployment_wiring(objects: list[dict], facts: argparse.Namespace) -> None:
    deployment = _deployment(objects)
    container = _container(deployment)

    roots = _named(container.get("env"), "PANELS_DATA_ROOT")
    if len(roots) != 1 or roots[0].get("value") != facts.mount_path:
        raise StoragePinError("PANELS_DATA_ROOT must equal the mount path %s" % facts.mount_path)
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

    volumes = _named(_pod_spec(deployment).get("volumes"), "panels-data")
    if len(volumes) != 1:
        raise StoragePinError("the panels-data volume must be declared exactly once")
    claim_ref = volumes[0].get("persistentVolumeClaim") or {}
    if claim_ref.get("claimName") != facts.volume_name:
        raise StoragePinError("the volume does not reference the %s claim" % facts.volume_name)
    if claim_ref.get("readOnly") is not True:
        raise StoragePinError("the claim reference must be readOnly: true — both levels, always")


def check_volume(objects: list[dict], facts: argparse.Namespace) -> None:
    volumes = _of_kind(objects, "PersistentVolume")
    if len(volumes) != 1:
        raise StoragePinError("the with-pv render must carry exactly one PersistentVolume")
    volume = volumes[0]
    if (volume.get("metadata") or {}).get("name") != facts.volume_name:
        raise StoragePinError("the PersistentVolume is not named %s" % facts.volume_name)
    spec = volume.get("spec") or {}
    if spec.get("accessModes") != ["ReadOnlyMany"]:
        raise StoragePinError("the PV's access mode is not exactly ReadOnlyMany")
    if spec.get("persistentVolumeReclaimPolicy") != "Retain":
        raise StoragePinError("the PV's reclaim policy must be Retain")
    if "storageClassName" not in spec or spec.get("storageClassName") != "":
        raise StoragePinError("the PV must carry an EXPLICIT empty storageClassName")
    if (spec.get("capacity") or {}).get("storage") != facts.capacity:
        raise StoragePinError("the PV does not declare the expected capacity")
    claim_ref = spec.get("claimRef") or {}
    if claim_ref.get("namespace") != facts.namespace or claim_ref.get("name") != facts.volume_name:
        raise StoragePinError(
            "the PV's claimRef must pin the pair: namespace %s, name %s"
            % (facts.namespace, facts.volume_name))
    host_path = spec.get("hostPath") or {}
    if host_path.get("path") != facts.host_path:
        raise StoragePinError("the PV's hostPath is not the reviewed %s" % facts.host_path)
    if host_path.get("type") != "Directory":
        raise StoragePinError(
            "the PV's hostPath type must be Directory — it mounts only a directory an "
            "admin already created, never creates one")


def run(mode: str, text: str, facts: argparse.Namespace) -> None:
    objects = _documents(text)
    if mode == "disabled":
        check_disabled(objects, facts)
        return
    check_claim(objects, facts)
    check_deployment_wiring(objects, facts)
    if mode == "with-pv":
        check_volume(objects, facts)
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
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--mount-path", default="/var/lib/panels-data")
    facts = parser.parse_args(argv)
    try:
        run(facts.mode, sys.stdin.read(), facts)
    except (StoragePinError, census.CensusError) as error:
        print("chart-storage-pin: %s" % error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
