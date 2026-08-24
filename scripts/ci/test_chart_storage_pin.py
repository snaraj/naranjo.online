"""Hostile tests for the panels data-root storage pin (issue #142).

chart-storage-pin.sh already runs a self-mutation battery against real helm
renders; this suite drives the checker module directly with synthetic
documents so the refusal logic itself is pinned hermetically — no helm, no
chart — including the corners a render mutation cannot conveniently reach
(absent sections, duplicated objects, a checker fed the wrong mode).
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


FACTS = SimpleNamespace(
    host_path="/srv/example/panels-data",
    volume_name="example-panels-data",
    key_secret="example-panels-data",
    capacity="16Mi",
    namespace="default",
    mount_path="/var/lib/panels-data",
)


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
      volumes:
        - name: panels-data
          persistentVolumeClaim:
            claimName: example-panels-data
            readOnly: true
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


class StoragePinAcceptsTheGoodRenders(unittest.TestCase):
    def test_enabled(self):
        PIN.run("enabled", CLAIM + DEPLOYMENT, FACTS)

    def test_with_pv(self):
        PIN.run("with-pv", CLAIM + VOLUME + DEPLOYMENT, FACTS)

    def test_disabled(self):
        PIN.run("disabled", BARE_DEPLOYMENT, FACTS)


class StoragePinRefusesHostileRenders(unittest.TestCase):
    def reject(self, mode: str, text: str, needle: str):
        with self.assertRaises(PIN.StoragePinError) as caught:
            PIN.run(mode, text, FACTS)
        self.assertIn(needle, str(caught.exception))

    def test_enabled_without_a_claim(self):
        self.reject("enabled", DEPLOYMENT, "exactly one PersistentVolumeClaim")

    def test_enabled_with_two_claims(self):
        self.reject("enabled", CLAIM + CLAIM + DEPLOYMENT, "exactly one PersistentVolumeClaim")

    def test_enabled_with_a_smuggled_pv(self):
        self.reject("enabled", CLAIM + VOLUME + DEPLOYMENT, "admin flag")

    def test_with_pv_missing_the_pv(self):
        self.reject("with-pv", CLAIM + DEPLOYMENT, "exactly one PersistentVolume")

    def test_disabled_still_carrying_the_claim(self):
        self.reject("disabled", CLAIM + BARE_DEPLOYMENT, "disabled render still carries")

    def test_disabled_still_wiring_the_env(self):
        self.reject("disabled", DEPLOYMENT, "still wires PANELS_DATA_ROOT")

    def test_deployment_without_the_mount(self):
        stripped = DEPLOYMENT.replace(
            "          volumeMounts:\n"
            "            - name: panels-data\n"
            "              mountPath: /var/lib/panels-data\n"
            "              readOnly: true\n", "")
        self.reject("enabled", CLAIM + stripped, "mounted exactly once")

    def test_writable_mount(self):
        mutated = DEPLOYMENT.replace(
            "              mountPath: /var/lib/panels-data\n              readOnly: true",
            "              mountPath: /var/lib/panels-data\n              readOnly: false")
        self.reject("enabled", CLAIM + mutated, "readOnly: true")

    def test_writable_claim_reference(self):
        mutated = DEPLOYMENT.replace(
            "            claimName: example-panels-data\n            readOnly: true",
            "            claimName: example-panels-data\n            readOnly: false")
        self.reject("enabled", CLAIM + mutated, "both levels")

    def test_claim_without_explicit_storage_class(self):
        mutated = CLAIM.replace('  storageClassName: ""\n', "")
        self.reject("enabled", mutated + DEPLOYMENT, "EXPLICIT empty storageClassName")

    def test_pv_host_path_moved(self):
        mutated = VOLUME.replace("path: /srv/example/panels-data", "path: /etc")
        self.reject("with-pv", CLAIM + mutated + DEPLOYMENT, "reviewed")

    def test_pv_type_weakened(self):
        mutated = VOLUME.replace("type: Directory", "type: DirectoryOrCreate")
        self.reject("with-pv", CLAIM + mutated + DEPLOYMENT, "Directory")

    def test_pv_reclaim_weakened(self):
        mutated = VOLUME.replace("Retain", "Delete")
        self.reject("with-pv", CLAIM + mutated + DEPLOYMENT, "Retain")

    def test_pv_claim_ref_unpinned(self):
        mutated = VOLUME.replace("    name: example-panels-data", "    name: another-claim")
        self.reject("with-pv", CLAIM + mutated + DEPLOYMENT, "claimRef")

    def test_mandatory_key_secret(self):
        mutated = DEPLOYMENT.replace("optional: true", "optional: false")
        self.reject("enabled", CLAIM + mutated, "optional")

    def test_env_root_diverges_from_mount(self):
        mutated = DEPLOYMENT.replace('value: "/var/lib/panels-data"', 'value: "/var/lib/other"')
        self.reject("enabled", CLAIM + mutated, "mount path")


class StoragePinCommandLine(unittest.TestCase):
    def run_main(self, mode: str, text: str) -> int:
        argv = [
            mode,
            "--host-path", FACTS.host_path,
            "--volume-name", FACTS.volume_name,
            "--key-secret", FACTS.key_secret,
            "--capacity", FACTS.capacity,
            "--namespace", FACTS.namespace,
        ]
        original = sys.stdin
        sys.stdin = _Reader(text)
        try:
            return PIN.main(argv)
        finally:
            sys.stdin = original

    def test_exit_codes(self):
        self.assertEqual(self.run_main("enabled", CLAIM + DEPLOYMENT), 0)
        self.assertEqual(self.run_main("enabled", BARE_DEPLOYMENT), 1)


class _Reader:
    def __init__(self, text: str):
        self._text = text

    def read(self) -> str:
        return self._text


if __name__ == "__main__":
    unittest.main()
