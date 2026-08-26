"""Hostile tests for the panels data-root storage pin (issue #142).

chart-storage-pin.sh already runs a self-mutation battery against real helm
renders; this suite drives the checker module directly with synthetic
documents so the refusal logic itself is pinned hermetically — no helm, no
chart — including the corners a render mutation cannot conveniently reach
(absent sections, duplicated objects, a checker fed the wrong mode, hostile
caller facts). The render carries TWO statically bound pairs since the
2026-08-24 security review's finding H2: the read-only DATA pair for the
pushed sealed series and the writable STATE pair for the replay-floor
marker, and this suite pins both — including that only the state side may
ever be writable.

The 2026-08-24 round-3 review moved the fixtures onto the platform storage
shape (findings 3 and 7): `local` volumes on the enumerated StorageClass with
bounded required nodeAffinity, a single replica, and disjointness proven in
BOTH directions over normalized paths. The refusals that shape adds are pinned
here alongside the ones it kept.

The 2026-08-25 round-4 review (finding 1) took the state pair back to
ReadWriteOnce. Round 3 had set ReadWriteOncePod, which Kubernetes supports for
CSI volumes only; the live target has no CSI driver, so the mode named a
guarantee nothing enforced. The fixtures therefore carry ReadWriteOnce, and
the suite pins the refusal in BOTH directions — a WIDENING to ReadWriteMany
and a re-CLAIM of the CSI-only ReadWriteOncePod both fail, so neither the
weaker mode nor the dishonest one can arrive quietly.
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("chart_storage_pin", HERE / "chart_storage_pin.py")
assert SPEC and SPEC.loader
PIN = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PIN
SPEC.loader.exec_module(PIN)


def facts(**overrides) -> SimpleNamespace:
    values = dict(
        path="/mnt/example-root/panels-data",
        storage_class="example-class",
        local_root="/mnt/example-root",
        node="example-node",
        volume_name="example-panels-data",
        key_secret="example-panels-data",
        capacity="16Mi",
        state_path="/mnt/example-root/panels-state",
        state_volume_name="example-panels-state",
        state_capacity="1Mi",
        namespace="default",
        mount_path="/var/lib/panels-data",
        state_mount_path="/var/lib/panels-state",
    )
    values.update(overrides)
    return SimpleNamespace(**values)


FACTS = facts()


CLAIM = """\
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: example-panels-data
  namespace: default
spec:
  accessModes:
    - ReadOnlyMany
  storageClassName: example-class
  volumeName: example-panels-data
  resources:
    requests:
      storage: 16Mi
"""

STATE_CLAIM = """\
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: example-panels-state
  namespace: default
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: example-class
  volumeName: example-panels-state
  resources:
    requests:
      storage: 1Mi
"""

VOLUME = """\
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: example-panels-data
spec:
  capacity:
    storage: 16Mi
  accessModes:
    - ReadOnlyMany
  persistentVolumeReclaimPolicy: Retain
  storageClassName: example-class
  claimRef:
    namespace: default
    name: example-panels-data
  local:
    path: /mnt/example-root/panels-data
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - example-node
"""

STATE_VOLUME = """\
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: example-panels-state
spec:
  capacity:
    storage: 1Mi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: example-class
  claimRef:
    namespace: default
    name: example-panels-state
  local:
    path: /mnt/example-root/panels-state
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - example-node
"""

DEPLOYMENT = """\
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: example
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: example
          env:
            - name: PANELS_DATA_ROOT
              value: "/var/lib/panels-data"
            - name: PANELS_DATA_STATE
              value: "/var/lib/panels-state"
            - name: PANELS_DATA_KEY
              valueFrom:
                secretKeyRef:
                  name: example-panels-data
                  key: PANELS_DATA_KEY
                  optional: true
          volumeMounts:
            - name: panels-data
              mountPath: /var/lib/panels-data
              readOnly: true
            - name: panels-state
              mountPath: /var/lib/panels-state
              readOnly: false
      volumes:
        - name: panels-data
          persistentVolumeClaim:
            claimName: example-panels-data
            readOnly: true
        - name: panels-state
          persistentVolumeClaim:
            claimName: example-panels-state
            readOnly: false
"""

BARE_DEPLOYMENT = """\
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: example
spec:
  template:
    spec:
      containers:
        - name: example
          env:
            - name: PORT
              value: "8080"
"""

CLAIMS = CLAIM + STATE_CLAIM
VOLUMES = VOLUME + STATE_VOLUME

# The exact bounded nodeAffinity block both volumes carry, so a test can
# remove it wholesale without re-spelling it.
AFFINITY = """\
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - example-node
"""


class StoragePinAcceptsTheGoodRenders(unittest.TestCase):
    def test_enabled(self):
        PIN.run("enabled", CLAIMS + DEPLOYMENT, FACTS)

    def test_with_pv(self):
        PIN.run("with-pv", CLAIMS + VOLUMES + DEPLOYMENT, FACTS)

    def test_disabled(self):
        PIN.run("disabled", BARE_DEPLOYMENT, FACTS)


class StoragePinRefusesHostileRenders(unittest.TestCase):
    def reject(self, mode: str, text: str, needle: str, pin_facts=FACTS):
        with self.assertRaises(PIN.StoragePinError) as caught:
            PIN.run(mode, text, pin_facts)
        self.assertIn(needle, str(caught.exception))

    def test_enabled_without_any_claim(self):
        self.reject("enabled", DEPLOYMENT, "exactly two PersistentVolumeClaims")

    def test_enabled_missing_the_state_claim(self):
        self.reject("enabled", CLAIM + DEPLOYMENT, "exactly two PersistentVolumeClaims")

    def test_enabled_missing_the_data_claim(self):
        self.reject("enabled", STATE_CLAIM + DEPLOYMENT, "exactly two PersistentVolumeClaims")

    def test_enabled_with_a_duplicated_claim(self):
        self.reject("enabled", CLAIM + CLAIMS + DEPLOYMENT, "exactly two PersistentVolumeClaims")

    def test_enabled_with_a_smuggled_pv(self):
        self.reject("enabled", CLAIMS + VOLUME + DEPLOYMENT, "admin flag")

    def test_with_pv_missing_both_pvs(self):
        self.reject("with-pv", CLAIMS + DEPLOYMENT, "exactly two PersistentVolumes")

    def test_with_pv_missing_the_state_pv(self):
        self.reject("with-pv", CLAIMS + VOLUME + DEPLOYMENT, "exactly two PersistentVolumes")

    def test_disabled_still_carrying_a_claim(self):
        self.reject("disabled", CLAIM + BARE_DEPLOYMENT, "disabled render still carries")
        self.reject("disabled", STATE_CLAIM + BARE_DEPLOYMENT, "disabled render still carries")

    def test_disabled_still_wiring_the_env(self):
        self.reject("disabled", DEPLOYMENT, "still wires PANELS_DATA_ROOT")

    def test_deployment_without_the_mount(self):
        stripped = DEPLOYMENT.replace(
            "            - name: panels-data\n"
            "              mountPath: /var/lib/panels-data\n"
            "              readOnly: true\n", "")
        self.reject("enabled", CLAIMS + stripped, "mounted exactly once")

    def test_deployment_without_the_state_mount(self):
        stripped = DEPLOYMENT.replace(
            "            - name: panels-state\n"
            "              mountPath: /var/lib/panels-state\n"
            "              readOnly: false\n", "")
        self.reject("enabled", CLAIMS + stripped, "panels-state volume must be mounted")

    def test_writable_mount(self):
        mutated = DEPLOYMENT.replace(
            "              mountPath: /var/lib/panels-data\n              readOnly: true",
            "              mountPath: /var/lib/panels-data\n              readOnly: false")
        self.reject("enabled", CLAIMS + mutated, "readOnly: true")

    def test_read_only_state_mount(self):
        mutated = DEPLOYMENT.replace(
            "              mountPath: /var/lib/panels-state\n              readOnly: false",
            "              mountPath: /var/lib/panels-state\n              readOnly: true")
        self.reject("enabled", CLAIMS + mutated, "readOnly: false")

    def test_state_mount_with_implicit_writability(self):
        # An OMITTED readOnly is writable in Kubernetes, but the pin demands
        # the decision EXPLICIT so a reader of the render sees it was made.
        mutated = DEPLOYMENT.replace(
            "              mountPath: /var/lib/panels-state\n              readOnly: false\n",
            "              mountPath: /var/lib/panels-state\n")
        self.reject("enabled", CLAIMS + mutated, "EXPLICITLY readOnly: false")

    def test_writable_claim_reference(self):
        mutated = DEPLOYMENT.replace(
            "            claimName: example-panels-data\n            readOnly: true",
            "            claimName: example-panels-data\n            readOnly: false")
        self.reject("enabled", CLAIMS + mutated, "both levels")

    def test_read_only_state_claim_reference(self):
        mutated = DEPLOYMENT.replace(
            "            claimName: example-panels-state\n            readOnly: false",
            "            claimName: example-panels-state\n            readOnly: true")
        self.reject("enabled", CLAIMS + mutated, "readOnly: false")

    def test_claim_without_a_storage_class(self):
        mutated = CLAIM.replace("  storageClassName: example-class\n", "")
        self.reject("enabled", mutated + STATE_CLAIM + DEPLOYMENT, "enumerated StorageClass")

    def test_claim_with_the_empty_storage_class_this_replaced(self):
        # The pre-round-3 shape. An empty class excludes a DEFAULT provisioner
        # and nothing else; it does not bind the claim to the one class the
        # platform admits, so the render would be refused on arrival.
        mutated = CLAIM.replace("storageClassName: example-class", 'storageClassName: ""')
        self.reject("enabled", mutated + STATE_CLAIM + DEPLOYMENT, "enumerated StorageClass")

    def test_claim_asking_for_more_than_the_volume_it_names(self):
        for field in ("dataSource", "dataSourceRef", "volumeAttributesClassName"):
            mutated = CLAIM.replace(
                "  volumeName: example-panels-data\n",
                "  volumeName: example-panels-data\n  %s: something\n" % field)
            self.reject("enabled", mutated + STATE_CLAIM + DEPLOYMENT, field)

    def test_state_claim_access_mode_widened(self):
        mutated = STATE_CLAIM.replace("- ReadWriteOnce", "- ReadWriteMany")
        self.reject("enabled", CLAIM + mutated + DEPLOYMENT, "ReadWriteOnce")

    def test_state_claim_reclaiming_the_csi_only_mode(self):
        # 2026-08-25 round-4 finding 1. ReadWriteOncePod is the mode round 3
        # required here, and it is CSI-only; this target has no CSI driver, so
        # a claim naming it would advertise single-writer enforcement that
        # nothing performs. The refusal must name the REASON, not merely a
        # mismatch, or the next reader "fixes" it by widening the expectation.
        mutated = STATE_CLAIM.replace("- ReadWriteOnce", "- ReadWriteOncePod")
        self.reject("enabled", CLAIM + mutated + DEPLOYMENT, "no CSI driver")

    def test_state_volume_reclaiming_the_csi_only_mode(self):
        mutated = STATE_VOLUME.replace("- ReadWriteOnce", "- ReadWriteOncePod")
        self.reject("with-pv", CLAIMS + VOLUME + mutated + DEPLOYMENT, "no CSI driver")

    def test_data_claim_reclaiming_the_csi_only_mode(self):
        # The refusal is not scoped to the state pair: no object may claim it.
        mutated = CLAIM.replace("- ReadOnlyMany", "- ReadWriteOncePod")
        self.reject("enabled", mutated + STATE_CLAIM + DEPLOYMENT, "no CSI driver")

    def test_a_second_replica_racing_the_floor(self):
        mutated = DEPLOYMENT.replace("  replicas: 1", "  replicas: 2")
        self.reject("enabled", CLAIMS + mutated, "single-writer")

    def test_an_unstated_replica_count(self):
        mutated = DEPLOYMENT.replace("  replicas: 1\n", "")
        self.reject("enabled", CLAIMS + mutated, "single-writer")

    def test_pv_local_path_moved(self):
        mutated = VOLUME.replace("path: /mnt/example-root/panels-data", "path: /mnt/example-root/elsewhere")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "reviewed")

    def test_state_pv_local_path_moved(self):
        mutated = STATE_VOLUME.replace("path: /mnt/example-root/panels-state", "path: /mnt/example-root/elsewhere")
        self.reject("with-pv", CLAIMS + VOLUME + mutated + DEPLOYMENT, "reviewed")

    def test_pv_reverted_to_the_denied_host_path_shape(self):
        mutated = VOLUME.replace("  local:", "  hostPath:")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "denies hostPath")

    def test_pv_carrying_both_sources(self):
        mutated = VOLUME.replace(
            "  local:\n    path: /mnt/example-root/panels-data\n",
            "  local:\n    path: /mnt/example-root/panels-data\n"
            "  hostPath:\n    path: /mnt/example-root/panels-data\n")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "denies hostPath")

    def test_pv_with_no_volume_source_at_all(self):
        mutated = VOLUME.replace(
            "  local:\n    path: /mnt/example-root/panels-data\n", "")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "`local` volume source")

    def test_pv_local_path_outside_the_enumerated_root(self):
        mutated = VOLUME.replace("path: /mnt/example-root/panels-data", "path: /etc/panels-data")
        outside = facts(path="/etc/panels-data")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT,
                    "strictly under", outside)

    def test_pv_storage_class_emptied(self):
        mutated = VOLUME.replace("storageClassName: example-class", 'storageClassName: ""')
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "enumerated StorageClass")

    def test_pv_declaring_mount_options(self):
        mutated = VOLUME.replace(
            "  local:\n", "  mountOptions:\n    - ro\n  local:\n")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "mountOptions")

    def test_pv_reclaim_weakened(self):
        mutated = VOLUME.replace("Retain", "Delete")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "Retain")

    def test_state_pv_reclaim_weakened(self):
        mutated = STATE_VOLUME.replace("Retain", "Delete")
        self.reject("with-pv", CLAIMS + VOLUME + mutated + DEPLOYMENT, "Retain")

    def test_pv_claim_ref_unpinned(self):
        mutated = VOLUME.replace("    name: example-panels-data", "    name: another-claim")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "claimRef")

    # --- nodeAffinity: a local volume is node-bound, so the binding must be
    # a CONSTRAINT and a narrow one. Every widening below is a volume that
    # can bind on a machine nobody provisioned the directory on.

    def test_pv_without_node_affinity(self):
        mutated = VOLUME.replace(AFFINITY, "")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "REQUIRED nodeAffinity")

    def test_pv_with_only_a_preferred_affinity(self):
        mutated = VOLUME.replace("  nodeAffinity:\n    required:", "  nodeAffinity:\n    preferred:")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "REQUIRED nodeAffinity")

    def test_pv_with_a_preferred_affinity_beside_the_required_one(self):
        mutated = VOLUME.replace(
            "  nodeAffinity:\n    required:",
            "  nodeAffinity:\n    preferred: []\n    required:")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "nothing but `required`")

    def test_pv_with_alternative_node_selector_terms(self):
        mutated = VOLUME.replace(
            "                - example-node\n",
            "                - example-node\n"
            "        - matchExpressions:\n"
            "            - key: kubernetes.io/hostname\n"
            "              operator: In\n"
            "              values:\n"
            "                - another-node\n")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "exactly one nodeSelectorTerm")

    def test_pv_node_selector_operator_widened(self):
        for operator in ("Exists", "NotIn"):
            mutated = VOLUME.replace("operator: In", "operator: %s" % operator)
            self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "operator In")

    def test_pv_node_selector_keyed_off_the_hostname(self):
        mutated = VOLUME.replace("key: kubernetes.io/hostname", "key: example.io/anything")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "kubernetes.io/hostname")

    def test_pv_node_selector_listing_several_nodes(self):
        mutated = VOLUME.replace(
            "                - example-node\n",
            "                - example-node\n                - another-node\n")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "one non-empty value")

    def test_pv_bound_to_a_node_nobody_provisioned(self):
        mutated = VOLUME.replace("- example-node", "- another-node")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "not the stated")

    # --- disjointness, in BOTH directions, over NORMALIZED paths (round-3
    # finding 7). The pre-round-3 check compared raw strings in one
    # direction, so it caught only the first of these five.

    def test_state_directory_nested_inside_the_push_directory(self):
        nested = facts(state_path="/mnt/example-root/panels-data/state")
        volume = STATE_VOLUME.replace(
            "path: /mnt/example-root/panels-state", "path: /mnt/example-root/panels-data/state")
        self.reject("with-pv", CLAIMS + VOLUME + volume + DEPLOYMENT,
                    "may never live within the read-only projection", nested)

    def test_push_directory_nested_inside_the_state_directory(self):
        # The direction the old one-way check missed entirely. It is the same
        # breach: the read-only projection sits inside the surface the origin
        # may write, so the origin can reach the pushed series file.
        nested = facts(path="/mnt/example-root/panels-state/inner")
        volume = VOLUME.replace(
            "path: /mnt/example-root/panels-data", "path: /mnt/example-root/panels-state/inner")
        self.reject("with-pv", CLAIMS + volume + STATE_VOLUME + DEPLOYMENT,
                    "may never live within the writable surface", nested)

    def test_state_directory_equal_to_the_push_directory(self):
        equal = facts(state_path="/mnt/example-root/panels-data")
        volume = STATE_VOLUME.replace(
            "path: /mnt/example-root/panels-state", "path: /mnt/example-root/panels-data")
        self.reject("with-pv", CLAIMS + VOLUME + volume + DEPLOYMENT,
                    "same directory", equal)

    def test_an_alias_of_the_push_directory(self):
        # Three spellings the kernel resolves to the push directory and a raw
        # string comparison calls different. Each must be refused.
        for alias in (
            "/mnt/example-root/panels-data/../panels-data",
            "/mnt/example-root//panels-data",
            "/mnt/example-root/panels-data/",
        ):
            aliased = facts(state_path=alias)
            volume = STATE_VOLUME.replace("path: /mnt/example-root/panels-state", "path: %s" % alias)
            self.reject("with-pv", CLAIMS + VOLUME + volume + DEPLOYMENT,
                        "same directory", aliased)

    def test_an_alias_that_nests_inside_the_push_directory(self):
        alias = "/mnt/example-root/panels-state/../panels-data/state"
        aliased = facts(state_path=alias)
        volume = STATE_VOLUME.replace("path: /mnt/example-root/panels-state", "path: %s" % alias)
        self.reject("with-pv", CLAIMS + VOLUME + volume + DEPLOYMENT,
                    "may never live within the read-only projection", aliased)

    def test_a_sibling_that_merely_shares_a_prefix_is_accepted(self):
        # The vacuity guard for everything above: a pin that refuses this is
        # not strict, it is broken, and the ancestor test is written with an
        # explicit separator precisely so this passes.
        sibling = facts(state_path="/mnt/example-root/panels-data-two")
        volume = STATE_VOLUME.replace(
            "path: /mnt/example-root/panels-state", "path: /mnt/example-root/panels-data-two")
        PIN.run("with-pv", CLAIMS + VOLUME + volume + DEPLOYMENT, sibling)

    def test_state_mount_nested_inside_the_data_mount(self):
        nested = facts(state_mount_path="/var/lib/panels-data/state")
        mutated = DEPLOYMENT.replace("/var/lib/panels-state", "/var/lib/panels-data/state")
        self.reject("enabled", CLAIMS + mutated,
                    "may never live within the read-only projection", nested)

    def test_data_mount_nested_inside_the_state_mount(self):
        nested = facts(mount_path="/var/lib/panels-state/inner")
        mutated = DEPLOYMENT.replace("/var/lib/panels-data\n", "/var/lib/panels-state/inner\n")
        mutated = mutated.replace('value: "/var/lib/panels-data"', 'value: "/var/lib/panels-state/inner"')
        self.reject("enabled", CLAIMS + mutated,
                    "may never live within the writable surface", nested)

    def test_mandatory_key_secret(self):
        mutated = DEPLOYMENT.replace("optional: true", "optional: false")
        self.reject("enabled", CLAIMS + mutated, "optional")

    def test_env_root_diverges_from_mount(self):
        mutated = DEPLOYMENT.replace('value: "/var/lib/panels-data"', 'value: "/var/lib/other"')
        self.reject("enabled", CLAIMS + mutated, "mount path")

    def test_env_state_diverges_from_state_mount(self):
        mutated = DEPLOYMENT.replace(
            'value: "/var/lib/panels-state"', 'value: "/var/lib/other-state"')
        self.reject("enabled", CLAIMS + mutated, "state mount path")


class StoragePinCommandLine(unittest.TestCase):
    def run_main(self, mode: str, text: str) -> int:
        argv = [
            mode,
            "--path", FACTS.path,
            "--mount-path", FACTS.mount_path,
            "--storage-class", FACTS.storage_class,
            "--local-root", FACTS.local_root,
            "--node", FACTS.node,
            "--volume-name", FACTS.volume_name,
            "--key-secret", FACTS.key_secret,
            "--capacity", FACTS.capacity,
            "--state-path", FACTS.state_path,
            "--state-mount-path", FACTS.state_mount_path,
            "--state-volume-name", FACTS.state_volume_name,
            "--state-capacity", FACTS.state_capacity,
            "--namespace", FACTS.namespace,
        ]
        original = sys.stdin
        sys.stdin = _Reader(text)
        try:
            return PIN.main(argv)
        finally:
            sys.stdin = original

    def test_exit_codes(self):
        self.assertEqual(self.run_main("enabled", CLAIMS + DEPLOYMENT), 0)
        self.assertEqual(self.run_main("enabled", BARE_DEPLOYMENT), 1)


class _Reader:
    def __init__(self, text: str):
        self._text = text

    def read(self) -> str:
        return self._text


if __name__ == "__main__":
    unittest.main()
