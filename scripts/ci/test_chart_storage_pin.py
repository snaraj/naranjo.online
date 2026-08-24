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
        host_path="/srv/example/panels-data",
        volume_name="example-panels-data",
        key_secret="example-panels-data",
        capacity="16Mi",
        state_host_path="/srv/example/panels-state",
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
  storageClassName: ""
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
  storageClassName: ""
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
  storageClassName: ""
  claimRef:
    namespace: default
    name: example-panels-data
  hostPath:
    path: /srv/example/panels-data
    type: Directory
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
  storageClassName: ""
  claimRef:
    namespace: default
    name: example-panels-state
  hostPath:
    path: /srv/example/panels-state
    type: Directory
"""

DEPLOYMENT = """\
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

    def test_claim_without_explicit_storage_class(self):
        mutated = CLAIM.replace('  storageClassName: ""\n', "")
        self.reject("enabled", mutated + STATE_CLAIM + DEPLOYMENT, "EXPLICIT empty storageClassName")

    def test_state_claim_access_mode_widened(self):
        mutated = STATE_CLAIM.replace("- ReadWriteOnce", "- ReadWriteMany")
        self.reject("enabled", CLAIM + mutated + DEPLOYMENT, "ReadWriteOnce")

    def test_pv_host_path_moved(self):
        mutated = VOLUME.replace("path: /srv/example/panels-data", "path: /etc")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "reviewed")

    def test_state_pv_host_path_moved(self):
        mutated = STATE_VOLUME.replace("path: /srv/example/panels-state", "path: /etc")
        self.reject("with-pv", CLAIMS + VOLUME + mutated + DEPLOYMENT, "reviewed")

    def test_pv_type_weakened(self):
        mutated = VOLUME.replace("type: Directory", "type: DirectoryOrCreate")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "Directory")

    def test_pv_reclaim_weakened(self):
        mutated = VOLUME.replace("Retain", "Delete")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "Retain")

    def test_state_pv_reclaim_weakened(self):
        mutated = STATE_VOLUME.replace("Retain", "Delete")
        self.reject("with-pv", CLAIMS + VOLUME + mutated + DEPLOYMENT, "Retain")

    def test_pv_claim_ref_unpinned(self):
        mutated = VOLUME.replace("    name: example-panels-data", "    name: another-claim")
        self.reject("with-pv", CLAIMS + mutated + STATE_VOLUME + DEPLOYMENT, "claimRef")

    def test_state_directory_nested_inside_the_push_directory(self):
        # The one refusal driven by FACTS rather than the render: a state
        # directory inside the push directory hands the origin's writable
        # surface a path to the pushed series file, whatever the render says.
        nested = facts(state_host_path="/srv/example/panels-data/state")
        volume = STATE_VOLUME.replace(
            "path: /srv/example/panels-state", "path: /srv/example/panels-data/state")
        self.reject("with-pv", CLAIMS + VOLUME + volume + DEPLOYMENT, "sibling", nested)

    def test_state_directory_equal_to_the_push_directory(self):
        equal = facts(state_host_path="/srv/example/panels-data")
        volume = STATE_VOLUME.replace(
            "path: /srv/example/panels-state", "path: /srv/example/panels-data")
        self.reject("with-pv", CLAIMS + VOLUME + volume + DEPLOYMENT, "sibling", equal)

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
            "--host-path", FACTS.host_path,
            "--volume-name", FACTS.volume_name,
            "--key-secret", FACTS.key_secret,
            "--capacity", FACTS.capacity,
            "--state-host-path", FACTS.state_host_path,
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
