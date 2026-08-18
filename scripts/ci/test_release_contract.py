"""Hostile tests for the per-main-merge release contract."""

from __future__ import annotations

import base64
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SPEC = importlib.util.spec_from_file_location("release_contract", HERE / "release_contract.py")
assert SPEC and SPEC.loader
RC = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = RC
SPEC.loader.exec_module(RC)


def snapshot(version: str) -> dict[str, str]:
    return {
        "VERSION": version + "\n",
        "chart/Chart.yaml": f"apiVersion: v2\nversion: {version}\nappVersion: \"{version}\"\n",
        "chart/values.yaml": f"image:\n  tag: v{version}\n",
        "CHANGELOG.md": f"# Changelog\n\n## [Unreleased]\n\n## [{version}] - 2026-08-13\n\n- release\n",
    }


def event(sha: str) -> dict[str, object]:
    return {
        "repository": {"full_name": "owner/site"},
        "workflow_run": {
            "name": "PR gate",
            "path": ".github/workflows/pr-gate.yml@refs/heads/main",
            "event": "push",
            "status": "completed",
            "conclusion": "success",
            "head_branch": "main",
            "head_sha": sha,
            "head_repository": {"full_name": "owner/site"},
        },
    }


def main_run_record(sha: str, run_id: int = 123) -> dict[str, object]:
    return {
        "id": run_id,
        "name": "PR gate",
        "path": ".github/workflows/pr-gate.yml",
        "event": "push",
        "status": "completed",
        "conclusion": "success",
        "head_branch": "main",
        "head_sha": sha,
        "repository": {"full_name": "owner/site"},
        "head_repository": {"full_name": "owner/site"},
    }


def main_jobs_record(sha: str, run_id: int = 123) -> dict[str, object]:
    jobs = [
        {
            "id": index,
            "run_id": run_id,
            "head_sha": sha,
            "name": name,
            "status": "completed",
            "conclusion": conclusion,
        }
        for index, (name, conclusion) in enumerate(RC.EXPECTED_MAIN_JOBS.items(), start=1)
    ]
    return {"total_count": len(jobs), "jobs": jobs}


def codeql_run_record(sha: str, *, run_id: int = 456) -> dict[str, object]:
    run = {
        "id": run_id,
        "name": "CodeQL",
        "path": ".github/workflows/codeql.yml",
        "event": "push",
        "status": "completed",
        "conclusion": "success",
        "head_branch": "main",
        "head_sha": sha,
        "repository": {"full_name": "owner/site"},
        "head_repository": {"full_name": "owner/site"},
    }
    return {"total_count": 1, "workflow_runs": [run]}


def codeql_jobs_record(sha: str, *, run_id: int = 456) -> dict[str, object]:
    jobs = [
        {
            "id": index,
            "run_id": run_id,
            "head_sha": sha,
            "name": name,
            "status": "completed",
            "conclusion": "success",
        }
        for index, name in enumerate(RC.EXPECTED_CODEQL_JOBS, start=10)
    ]
    return {"total_count": len(jobs), "jobs": jobs}


def sbom_registry_fixture() -> dict[str, object]:
    image = "ghcr.io/owner/site"
    subject_digests = {
        "linux/amd64": "sha256:" + "1" * 64,
        "linux/arm64": "sha256:" + "2" * 64,
    }
    statements: dict[str, bytes] = {}
    attestation_manifests: dict[str, bytes] = {}
    attestation_digests: dict[str, str] = {}
    for platform, subject_digest in subject_digests.items():
        statement = {
            "_type": RC.SBOM_STATEMENT_TYPE,
            "subject": [
                {
                    "name": (
                        f"pkg:docker/{image}@{subject_digest}"
                        f"?platform={platform.replace('/', '%2F')}"
                    ),
                    "digest": {"sha256": subject_digest[len("sha256:") :]},
                }
            ],
            "predicateType": RC.SBOM_PREDICATE_TYPE,
            "predicate": {
                "SPDXID": "SPDXRef-DOCUMENT",
                "creationInfo": {
                    "created": "2026-08-14T00:00:00Z",
                    "creators": ["Tool: fixture"],
                },
                "dataLicense": "CC0-1.0",
                "documentNamespace": "https://example.test/spdx/fixture",
                "name": "fixture",
                "packages": [
                    {
                        "SPDXID": "SPDXRef-Package",
                        "name": "fixture",
                        "downloadLocation": "NOASSERTION",
                        "filesAnalyzed": False,
                    }
                ],
                "relationships": [],
                "spdxVersion": "SPDX-2.3",
            },
        }
        statement_bytes = json.dumps(statement, sort_keys=True).encode("utf-8")
        statements[platform] = statement_bytes
        layer_digest = "sha256:" + hashlib.sha256(statement_bytes).hexdigest()
        provenance_digest = "sha256:" + hashlib.sha256(
            f"provenance:{platform}".encode("utf-8")
        ).hexdigest()
        manifest = {
            "schemaVersion": 2,
            "mediaType": RC.OCI_MANIFEST_MEDIA_TYPE,
            "config": {
                "mediaType": RC.OCI_EMPTY_CONFIG_MEDIA_TYPE,
                "digest": "sha256:" + "0" * 64,
                "size": 2,
            },
            "layers": [
                {
                    "mediaType": RC.INTOTO_LAYER_MEDIA_TYPE,
                    "digest": provenance_digest,
                    "size": 100,
                    "annotations": {
                        "in-toto.io/predicate-type": RC.SLSA_PREDICATE_TYPE
                    },
                },
                {
                    "mediaType": RC.INTOTO_LAYER_MEDIA_TYPE,
                    "digest": layer_digest,
                    "size": len(statement_bytes),
                    "annotations": {
                        "in-toto.io/predicate-type": RC.SBOM_PREDICATE_TYPE
                    },
                },
            ],
        }
        manifest_bytes = json.dumps(manifest, sort_keys=True).encode("utf-8")
        attestation_manifests[platform] = manifest_bytes
        attestation_digests[platform] = "sha256:" + hashlib.sha256(manifest_bytes).hexdigest()
    descriptors: list[dict[str, object]] = []
    for platform, subject_digest in subject_digests.items():
        os_name, architecture = platform.split("/", 1)
        descriptors.append(
            {
                "mediaType": RC.OCI_MANIFEST_MEDIA_TYPE,
                "digest": subject_digest,
                "size": 1000,
                "platform": {"architecture": architecture, "os": os_name},
            }
        )
    for platform, subject_digest in subject_digests.items():
        descriptors.append(
            {
                "mediaType": RC.OCI_MANIFEST_MEDIA_TYPE,
                "digest": attestation_digests[platform],
                "size": len(attestation_manifests[platform]),
                "annotations": {
                    "vnd.docker.reference.digest": subject_digest,
                    "vnd.docker.reference.type": "attestation-manifest",
                },
                "platform": {"architecture": "unknown", "os": "unknown"},
            }
        )
    index_bytes = json.dumps(
        {
            "schemaVersion": 2,
            "mediaType": RC.OCI_INDEX_MEDIA_TYPE,
            "manifests": descriptors,
        },
        sort_keys=True,
    ).encode("utf-8")
    return {
        "image": image,
        "index": index_bytes,
        "image_digest": "sha256:" + hashlib.sha256(index_bytes).hexdigest(),
        "subjects": subject_digests,
        "attestation_manifests": attestation_manifests,
        "attestation_digests": attestation_digests,
        "statements": statements,
    }


def embedded_predicate(source: str, revision: str, marker: str) -> dict[str, object]:
    return {
        "buildDefinition": {
            "buildType": "https://mobyproject.org/buildkit@v1",
            "externalParameters": {"marker": marker},
            "internalParameters": {},
        },
        "runDetails": {
            "builder": {"id": source + "/actions/runs/123"},
            "metadata": {"buildkit_metadata": {"vcs": {"source": source, "revision": revision}}},
        },
    }


def verified_record(statement: dict[str, object]) -> dict[str, str]:
    payload = base64.b64encode(json.dumps(statement, sort_keys=True).encode("utf-8")).decode("ascii")
    return {"payload": payload}


def exact_tag_records(tag: str, source: str, message: str, date: str) -> tuple[dict[str, object], dict[str, object]]:
    tag_object = "b" * 40
    return (
        {"ref": f"refs/tags/{tag}", "object": {"type": "tag", "sha": tag_object}},
        {
            "sha": tag_object,
            "tag": tag,
            "message": message,
            "object": {"type": "commit", "sha": source},
            "tagger": {
                "name": "github-actions[bot]",
                "email": "41898282+github-actions[bot]@users.noreply.github.com",
                "date": date,
            },
        },
    )


def exact_release_manifest(
    *, source: str = "a" * 40, main_run_id: int = 123, version: str = "0.1.10"
) -> dict[str, object]:
    return RC.build_release_manifest(
        repository=RC.EXPECTED_REPOSITORY,
        source_sha=source,
        main_run_id=main_run_id,
        version=version,
        image=RC.EXPECTED_IMAGE,
        image_digest="sha256:" + "c" * 64,
        chart=RC.EXPECTED_CHART,
        chart_digest="sha256:" + "d" * 64,
    )


def canonical_manifest_bytes(manifest: dict[str, object]) -> bytes:
    return (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode("utf-8")


def exact_release_record(
    manifest: bytes, *, tag: str = "v0.1.10", state: str = "exact", body: str = "exact notes\n"
) -> dict[str, object]:
    asset = {
        "name": f"naranjo-online-{tag}-release-manifest.json",
        "content_type": "application/json",
        "state": "uploaded",
        "size": len(manifest),
        "digest": "sha256:" + hashlib.sha256(manifest).hexdigest(),
        "url": "https://api.github.test/assets/1",
        "uploader": {
            "login": RC.GITHUB_ACTIONS_BOT_LOGIN,
            "id": RC.GITHUB_ACTIONS_BOT_ID,
        },
    }
    return {
        "tag_name": tag,
        "name": f"naranjo.online {tag}",
        "body": body,
        "draft": state in {"prepared", "staged"},
        "prerelease": False,
        "immutable": state == "exact",
        "author": {
            "login": RC.GITHUB_ACTIONS_BOT_LOGIN,
            "id": RC.GITHUB_ACTIONS_BOT_ID,
        },
        "assets": [] if state == "prepared" else [asset],
    }


REQUIRED_CHECKS = (
    "analyze (go, manual)",
    "analyze (javascript-typescript, none)",
    "application",
    "chart",
    "container",
    "dependency-review",
    "security",
)


def settings_receipt() -> dict[str, object]:
    return {
        "repository": "owner/site",
        "branch": "main",
        "actions_enabled": True,
        "actions_allowed_actions": "all",
        "actions_sha_pinning_required": True,
        "default_workflow_permissions": "read",
        "actions_can_approve_pull_request_reviews": False,
        "merge_methods": ["rebase", "squash"],
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": False,
        "required_reviewers": [],
        "require_code_owner_review": False,
        "require_last_push_approval": False,
        "required_review_thread_resolution": True,
        "required_status_checks": [
            {"context": context, "integration_id": 15368} for context in REQUIRED_CHECKS
        ],
        "strict_status_checks": True,
        "require_pull_request": True,
        "require_linear_history": True,
        "require_signed_commits": True,
        "restrict_creations": True,
        "allow_force_pushes": False,
        "allow_deletions": False,
        "restrict_updates": False,
        "code_scanning_tools": [
            {
                "tool": "CodeQL",
                "security_alerts_threshold": "high_or_higher",
                "alerts_threshold": "errors",
            }
        ],
        "code_quality_severity": "errors",
        "minimum_code_coverage": 80,
        "maximum_code_coverage_drop": None,
        "immutable_releases": True,
        "private_vulnerability_reporting": True,
        "secret_scanning": True,
        "secret_scanning_push_protection": True,
        "secret_scanning_non_provider_patterns": False,
        "secret_scanning_validity_checks": False,
    }


def settings_api() -> dict[str, object]:
    ruleset_id = 42
    checks = [
        {"context": context, "integration_id": 15368} for context in REQUIRED_CHECKS
    ]
    return {
        # The exact shape GitHub returns to the publisher's least-privilege App
        # token: no allow_*_merge booleans, because those are only returned to
        # credentials carrying Contents write.  The merge-method proof therefore
        # binds to the Protect-Main ruleset below, which is the control that
        # actually enforces merge behaviour on refs/heads/main.
        "repos/owner/site": {
            "full_name": "owner/site",
            "default_branch": "main",
            "security_and_analysis": {
                "secret_scanning": {"status": "enabled"},
                "secret_scanning_push_protection": {"status": "enabled"},
                "secret_scanning_non_provider_patterns": {"status": "disabled"},
                "secret_scanning_validity_checks": {"status": "disabled"},
            },
        },
        "repos/owner/site/immutable-releases": {
            "enabled": True,
            "enforced_by_owner": False,
        },
        "repos/owner/site/private-vulnerability-reporting": {"enabled": True},
        "repos/owner/site/actions/permissions": {
            "enabled": True,
            "allowed_actions": "all",
            "sha_pinning_required": True,
        },
        "repos/owner/site/actions/permissions/workflow": {
            "default_workflow_permissions": "read",
            "can_approve_pull_request_reviews": False,
        },
        "repos/owner/site/rulesets": [
            {
                "id": ruleset_id,
                "name": "Protect-Main",
                "target": "branch",
                "source_type": "Repository",
                "source": "owner/site",
                "enforcement": "active",
            }
        ],
        f"repos/owner/site/rulesets/{ruleset_id}": {
            "id": ruleset_id,
            "name": "Protect-Main",
            "target": "branch",
            "source_type": "Repository",
            "source": "owner/site",
            "enforcement": "active",
            "conditions": {
                "ref_name": {"exclude": [], "include": ["refs/heads/main"]},
            },
            # No bypass_actors: GitHub returns that property only to a
            # credential with write access to the ruleset, and the publisher's
            # token holds Administration read alone.  This is the exact shape
            # CI sees, so the receipt must build from it.
            "rules": [
                {"type": "creation"},
                {"type": "deletion"},
                {"type": "non_fast_forward"},
                {"type": "required_linear_history"},
                {
                    "type": "pull_request",
                    "parameters": {
                        "required_approving_review_count": 0,
                        "dismiss_stale_reviews_on_push": False,
                        "required_reviewers": [],
                        "require_code_owner_review": False,
                        "require_last_push_approval": False,
                        "required_review_thread_resolution": True,
                        "allowed_merge_methods": ["squash", "rebase"],
                    },
                },
                {
                    "type": "required_status_checks",
                    "parameters": {
                        "do_not_enforce_on_create": False,
                        "required_status_checks": checks,
                        "strict_required_status_checks_policy": True,
                    },
                },
                {"type": "required_signatures"},
                {
                    "type": "code_scanning",
                    "parameters": {
                        "code_scanning_tools": [
                            {
                                "tool": "CodeQL",
                                "security_alerts_threshold": "high_or_higher",
                                "alerts_threshold": "errors",
                            }
                        ]
                    },
                },
                {"type": "code_quality", "parameters": {"severity": "errors"}},
                {
                    "type": "code_coverage",
                    "parameters": {"minimum_coverage": 80, "max_coverage_drop": None},
                },
            ],
        },
    }


class VersionTests(unittest.TestCase):
    def test_next_patch_is_arithmetic_not_decimal_concatenation(self):
        RC.require_next_patch(RC.Version.parse("0.1.9"), RC.Version.parse("0.1.10"))
        for wrong in ("0.0.20", "0.1.9", "0.1.11", "0.2.0", "1.0.0"):
            with self.subTest(wrong=wrong), self.assertRaises(RC.ContractError):
                RC.require_next_patch(RC.Version.parse("0.1.9"), RC.Version.parse(wrong))

    def test_source_locks_and_changelog_are_one_identity(self):
        self.assertEqual(RC.validate_snapshot(snapshot("0.1.10")).tag, "v0.1.10")
        extended = snapshot("0.1.10")
        extended["chart/Chart.yaml"] += "dependencies:\n  - name: database\n    version: 1.2.3\n"
        extended["chart/values.yaml"] += "sidecar:\n  tag: unrelated\n"
        self.assertEqual(RC.validate_snapshot(extended).tag, "v0.1.10")
        mutations = []
        for path, replacement in (
            ("chart/Chart.yaml", "apiVersion: v2\nversion: 0.1.9\nappVersion: \"0.1.10\"\n"),
            ("chart/Chart.yaml", "apiVersion: v2\nversion: 0.1.10\nappVersion: \"v0.1.10\"\n"),
            ("chart/Chart.yaml", "apiVersion: v2\nversion: vv0.1.10\nappVersion: \"v0.1.10\"\n"),
            ("chart/values.yaml", "image:\n  tag: vv0.1.10\n"),
            ("chart/values.yaml", "image:\n  tag: v0.1.10\n  tag: v0.1.10\n"),
            ("chart/values.yaml", "image:\n  tag: v0.0.20\n"),
            ("CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\n- not released\n"),
        ):
            changed = snapshot("0.1.10")
            changed[path] = replacement
            mutations.append(changed)
        for changed in mutations:
            with self.assertRaises(RC.ContractError):
                RC.validate_snapshot(changed)


class EventTests(unittest.TestCase):
    SHA = "a" * 40

    def test_exact_successful_main_push_is_accepted(self):
        self.assertEqual(RC.plan_workflow_run(event(self.SHA), "owner/site"), self.SHA)

    def test_event_branch_conclusion_sha_path_and_identity_mutants_fail(self):
        mutations = (
            ("repository", "full_name", "attacker/site"),
            ("workflow_run", "name", "PR Gate"),
            ("workflow_run", "path", ".github/workflows/other.yml"),
            ("workflow_run", "event", "pull_request"),
            ("workflow_run", "status", "in_progress"),
            ("workflow_run", "conclusion", "failure"),
            ("workflow_run", "head_branch", "release"),
            ("workflow_run", "head_sha", "1234567"),
        )
        for parent, key, value in mutations:
            payload = json.loads(json.dumps(event(self.SHA)))
            payload[parent][key] = value
            with self.subTest(parent=parent, key=key), self.assertRaises(RC.ContractError):
                RC.plan_workflow_run(payload, "owner/site")
        payload = event(self.SHA)
        payload["workflow_run"]["head_repository"]["full_name"] = "attacker/site"
        with self.assertRaises(RC.ContractError):
            RC.plan_workflow_run(payload, "owner/site")

    def test_two_and_three_rapid_merges_are_unique_even_out_of_order(self):
        versions = [RC.Version.parse(v) for v in ("0.1.10", "0.1.11", "0.1.12")]
        shas = [character * 40 for character in "abc"]
        intents = [RC.ReleaseIntent(sha, version) for sha, version in zip(shas, versions)]
        completion_order = [intents[2], intents[0], intents[1]]
        self.assertEqual({intent.tag for intent in completion_order}, {"v0.1.10", "v0.1.11", "v0.1.12"})
        self.assertEqual(len({intent.source_sha for intent in completion_order}), 3)
        self.assertEqual(RC.ReleaseIntent(shas[0], versions[0]), RC.ReleaseIntent(shas[0], versions[0]))


class MainRunBindingTests(unittest.TestCase):
    SHA = "a" * 40

    @staticmethod
    def invoke(record: dict[str, object], *, run_id: int = 123, source_sha: str | None = None) -> int:
        with tempfile.TemporaryDirectory() as temporary:
            run_json = Path(temporary) / "main-run.json"
            run_json.write_text(json.dumps(record), encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                return RC.main(
                    [
                        "main-run-record",
                        "--run-json",
                        str(run_json),
                        "--run-id",
                        str(run_id),
                        "--repository",
                        "owner/site",
                        "--source-sha",
                        source_sha or MainRunBindingTests.SHA,
                    ]
                )

    def test_exact_authoritative_successful_main_run_is_accepted(self):
        exact = main_run_record(self.SHA)
        self.assertEqual(
            RC.validate_main_run_record(
                exact,
                expected_repository="owner/site",
                expected_run_id=123,
                expected_source_sha=self.SHA,
            ),
            self.SHA,
        )
        self.assertEqual(self.invoke(exact), 0)

    def test_ordinary_manual_unmerged_dispatch_is_executable_denial(self):
        unmerged = main_run_record(self.SHA)
        unmerged["event"] = "pull_request"
        unmerged["head_branch"] = "ci/unmerged-source"
        self.assertEqual(self.invoke(unmerged), 1)

    def test_foreign_failed_stale_path_identity_and_id_mutants_fail(self):
        exact = main_run_record(self.SHA)
        mutations: list[dict[str, object]] = []
        for path, value in (
            (("id",), 124),
            (("name",), "PR Gate"),
            (("path",), ".github/workflows/other.yml"),
            (("event",), "pull_request"),
            (("status",), "in_progress"),
            (("conclusion",), "failure"),
            (("head_branch",), "release"),
            (("head_sha",), "b" * 40),
            (("repository", "full_name"), "attacker/site"),
            (("head_repository", "full_name"), "attacker/site"),
        ):
            changed = copy.deepcopy(exact)
            parent = changed
            for key in path[:-1]:
                parent = parent[key]
            parent[path[-1]] = value
            mutations.append(changed)
        for index, changed in enumerate(mutations):
            with self.subTest(record_mutation=index):
                self.assertEqual(self.invoke(changed), 1)
        self.assertEqual(self.invoke(exact, run_id=124), 1)
        self.assertEqual(self.invoke(exact, source_sha="b" * 40), 1)


class MainJobBindingTests(unittest.TestCase):
    SHA = "a" * 40

    def test_exact_main_job_inventory_and_contextual_skip_are_accepted(self):
        record = main_jobs_record(self.SHA)
        self.assertEqual(
            RC.validate_main_jobs_record(
                record, expected_run_id=123, expected_source_sha=self.SHA
            ),
            self.SHA,
        )

    def test_skipped_critical_missing_duplicate_extra_and_foreign_jobs_fail(self):
        exact = main_jobs_record(self.SHA)
        mutations: list[dict[str, object]] = []
        for name in ("security", "application", "chart", "container", "coverage-badges"):
            changed = copy.deepcopy(exact)
            job = next(job for job in changed["jobs"] if job["name"] == name)
            job["conclusion"] = "skipped"
            mutations.append(changed)
        changed = copy.deepcopy(exact)
        changed["jobs"] = changed["jobs"][:-1]
        changed["total_count"] -= 1
        mutations.append(changed)
        changed = copy.deepcopy(exact)
        changed["jobs"][-1]["name"] = changed["jobs"][0]["name"]
        mutations.append(changed)
        changed = copy.deepcopy(exact)
        changed["jobs"].append(
            {
                "id": 99,
                "run_id": 123,
                "head_sha": self.SHA,
                "name": "foreign",
                "status": "completed",
                "conclusion": "success",
            }
        )
        changed["total_count"] += 1
        mutations.append(changed)
        for path, value in (
            (("jobs", 0, "run_id"), 999),
            (("jobs", 0, "head_sha"), "b" * 40),
            (("jobs", 0, "status"), "in_progress"),
            (("jobs", 0, "conclusion"), "cancelled"),
            (("total_count",), 99),
        ):
            changed = copy.deepcopy(exact)
            target = changed
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            mutations.append(changed)
        for index, changed in enumerate(mutations):
            with self.subTest(job_mutant=index), self.assertRaises(RC.ContractError):
                RC.validate_main_jobs_record(
                    changed, expected_run_id=123, expected_source_sha=self.SHA
                )


class CodeQLAuthorizationTests(unittest.TestCase):
    SHA = "a" * 40

    def test_exact_source_run_and_both_matrix_jobs_are_accepted(self):
        run = codeql_run_record(self.SHA)
        self.assertEqual(
            RC.classify_codeql_run_record(
                run, expected_repository="owner/site", expected_source_sha=self.SHA
            ),
            456,
        )
        self.assertEqual(
            RC.validate_codeql_jobs_record(
                codeql_jobs_record(self.SHA),
                expected_run_id=456,
                expected_source_sha=self.SHA,
            ),
            self.SHA,
        )

    def test_absent_and_in_progress_exact_source_runs_remain_bounded_pending(self):
        self.assertIsNone(
            RC.classify_codeql_run_record(
                {"total_count": 0, "workflow_runs": []},
                expected_repository="owner/site",
                expected_source_sha=self.SHA,
            )
        )
        pending = codeql_run_record(self.SHA)
        pending["workflow_runs"][0]["status"] = "in_progress"
        pending["workflow_runs"][0]["conclusion"] = None
        self.assertIsNone(
            RC.classify_codeql_run_record(
                pending, expected_repository="owner/site", expected_source_sha=self.SHA
            )
        )

    def test_failed_skipped_wrong_sha_duplicate_and_foreign_runs_fail(self):
        exact = codeql_run_record(self.SHA)
        mutations: list[dict[str, object]] = []
        for path, value in (
            (("workflow_runs", 0, "conclusion"), "failure"),
            (("workflow_runs", 0, "conclusion"), "skipped"),
            (("workflow_runs", 0, "head_sha"), "b" * 40),
            (("workflow_runs", 0, "head_branch"), "release"),
            (("workflow_runs", 0, "event"), "pull_request"),
            (("workflow_runs", 0, "path"), ".github/workflows/foreign.yml"),
            (("workflow_runs", 0, "repository", "full_name"), "attacker/site"),
        ):
            changed = copy.deepcopy(exact)
            target = changed
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            mutations.append(changed)
        duplicate = copy.deepcopy(exact)
        duplicate["workflow_runs"].append(copy.deepcopy(duplicate["workflow_runs"][0]))
        duplicate["total_count"] = 2
        mutations.append(duplicate)
        for index, changed in enumerate(mutations):
            with self.subTest(run_mutant=index), self.assertRaises(RC.ContractError):
                RC.classify_codeql_run_record(
                    changed,
                    expected_repository="owner/site",
                    expected_source_sha=self.SHA,
                )

    def test_skipped_failed_missing_duplicate_extra_and_wrong_sha_jobs_fail(self):
        exact = codeql_jobs_record(self.SHA)
        mutations: list[dict[str, object]] = []
        for conclusion in ("skipped", "failure", "cancelled"):
            changed = copy.deepcopy(exact)
            changed["jobs"][0]["conclusion"] = conclusion
            mutations.append(changed)
        for path, value in (
            (("jobs", 0, "head_sha"), "b" * 40),
            (("jobs", 0, "status"), "in_progress"),
            (("jobs", 0, "name"), "analyze (ruby, none)"),
            (("jobs", 0, "run_id"), 999),
        ):
            changed = copy.deepcopy(exact)
            target = changed
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            mutations.append(changed)
        missing = copy.deepcopy(exact)
        missing["jobs"] = missing["jobs"][:1]
        missing["total_count"] = 1
        mutations.append(missing)
        duplicate = copy.deepcopy(exact)
        duplicate["jobs"][1]["name"] = duplicate["jobs"][0]["name"]
        mutations.append(duplicate)
        extra = copy.deepcopy(exact)
        extra["jobs"].append(copy.deepcopy(extra["jobs"][0]))
        extra["jobs"][-1]["id"] = 99
        extra["jobs"][-1]["name"] = "foreign"
        extra["total_count"] = 3
        mutations.append(extra)
        for index, changed in enumerate(mutations):
            with self.subTest(codeql_job_mutant=index), self.assertRaises(RC.ContractError):
                RC.validate_codeql_jobs_record(
                    changed, expected_run_id=456, expected_source_sha=self.SHA
                )


class RawSBOMBindingTests(unittest.TestCase):
    def test_exact_two_platform_raw_sbom_chain_is_accepted(self):
        fixture = sbom_registry_fixture()
        plan = RC.validate_sbom_index(
            fixture["index"], expected_image_digest=fixture["image_digest"]
        )
        self.assertEqual(set(plan), {"linux/amd64", "linux/arm64"})
        for platform in RC.RELEASE_MANIFEST_PLATFORMS:
            layer_digest = RC.validate_sbom_attestation_manifest(
                fixture["attestation_manifests"][platform],
                expected_attestation_digest=fixture["attestation_digests"][platform],
            )
            RC.validate_sbom_statement(
                fixture["statements"][platform],
                expected_layer_digest=layer_digest,
                image=fixture["image"],
                expected_subject_digest=fixture["subjects"][platform],
                platform=platform,
            )

    def test_null_malformed_wrong_platform_wrong_subject_duplicate_and_extra_fail(self):
        fixture = sbom_registry_fixture()
        exact = json.loads(fixture["statements"]["linux/amd64"])
        statements: list[dict[str, object]] = []
        for path, value in (
            (("predicate",), None),
            (("_type",), "https://in-toto.io/Statement/v1"),
            (("predicateType",), "https://example.test/foreign"),
            (("predicate", "spdxVersion"), "SPDX-2.2"),
            (("predicate", "packages"), None),
            (("subject", 0, "name"), "pkg:docker/ghcr.io/owner/site@x?platform=linux%2Farm64"),
            (("subject", 0, "digest", "sha256"), "f" * 64),
        ):
            changed = copy.deepcopy(exact)
            target = changed
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            statements.append(changed)
        duplicate_subject = copy.deepcopy(exact)
        duplicate_subject["subject"].append(copy.deepcopy(duplicate_subject["subject"][0]))
        statements.append(duplicate_subject)
        extra_top = copy.deepcopy(exact)
        extra_top["foreign"] = True
        statements.append(extra_top)
        for index, changed in enumerate(statements):
            payload = json.dumps(changed, sort_keys=True).encode("utf-8")
            digest = "sha256:" + hashlib.sha256(payload).hexdigest()
            with self.subTest(statement_mutant=index), self.assertRaises(RC.ContractError):
                RC.validate_sbom_statement(
                    payload,
                    expected_layer_digest=digest,
                    image=fixture["image"],
                    expected_subject_digest=fixture["subjects"]["linux/amd64"],
                    platform="linux/amd64",
                )

    def test_duplicate_extra_foreign_and_missing_carriers_fail(self):
        fixture = sbom_registry_fixture()
        exact_index = json.loads(fixture["index"])
        index_mutants: list[dict[str, object]] = []
        for mutate in (
            lambda value: value["manifests"].pop(),
            lambda value: value["manifests"].append(copy.deepcopy(value["manifests"][0])),
            lambda value: value["manifests"][0]["platform"].update(architecture="s390x"),
            lambda value: value["manifests"][2]["annotations"].update(
                {"vnd.docker.reference.digest": "sha256:" + "f" * 64}
            ),
        ):
            changed = copy.deepcopy(exact_index)
            mutate(changed)
            index_mutants.append(changed)
        for index, changed in enumerate(index_mutants):
            payload = json.dumps(changed, sort_keys=True).encode("utf-8")
            digest = "sha256:" + hashlib.sha256(payload).hexdigest()
            with self.subTest(index_mutant=index), self.assertRaises(RC.ContractError):
                RC.validate_sbom_index(payload, expected_image_digest=digest)

        exact_manifest = json.loads(fixture["attestation_manifests"]["linux/amd64"])
        manifest_mutants: list[dict[str, object]] = []
        for mutate in (
            lambda value: value["layers"].pop(),
            lambda value: value["layers"].append(copy.deepcopy(value["layers"][1])),
            lambda value: value["layers"][0]["annotations"].update(
                {"in-toto.io/predicate-type": RC.SBOM_PREDICATE_TYPE}
            ),
            lambda value: value["layers"][1].update(
                {"mediaType": "application/octet-stream"}
            ),
        ):
            changed = copy.deepcopy(exact_manifest)
            mutate(changed)
            manifest_mutants.append(changed)
        for index, changed in enumerate(manifest_mutants):
            payload = json.dumps(changed, sort_keys=True).encode("utf-8")
            digest = "sha256:" + hashlib.sha256(payload).hexdigest()
            with self.subTest(carrier_mutant=index), self.assertRaises(RC.ContractError):
                RC.validate_sbom_attestation_manifest(
                    payload, expected_attestation_digest=digest
                )


class SettingsReceiptTests(unittest.TestCase):
    @staticmethod
    def require_documented_contract(text: str) -> None:
        for token in (
            "Release-control readiness receipt",
            '"immutable_releases": true',
            '"private_vulnerability_reporting": true',
            '"actions_enabled": true',
            '"actions_allowed_actions": "all"',
            '"actions_sha_pinning_required": true',
            '"default_workflow_permissions": "read"',
            '"actions_can_approve_pull_request_reviews": false',
            '"merge_methods": ["rebase", "squash"]',
            '"context": "security", "integration_id": 15368',
            '"context": "dependency-review", "integration_id": 15368',
            '"strict_status_checks": true',
            '"require_pull_request": true',
            '"required_approving_review_count": 0',
            '"dismiss_stale_reviews_on_push": false',
            '"required_reviewers": []',
            '"require_code_owner_review": false',
            '"require_last_push_approval": false',
            '"required_review_thread_resolution": true',
            '"require_linear_history": true',
            '"require_signed_commits": true',
            '"restrict_creations": true',
            '"allow_force_pushes": false',
            '"allow_deletions": false',
            '"restrict_updates": false',
            '"code_scanning_tools": [',
            '"security_alerts_threshold": "high_or_higher"',
            '"alerts_threshold": "errors"',
            '"code_quality_severity": "errors"',
            '"minimum_code_coverage": 80',
            '"maximum_code_coverage_drop": null',
            "Owner-verified",
            "has write access to the ruleset",
            "--jq '.bypass_actors'",
            "# must print: []",
            '"secret_scanning": true',
            '"secret_scanning_push_protection": true',
            '"secret_scanning_non_provider_patterns": false',
            '"secret_scanning_validity_checks": false',
            "private-vulnerability-reporting",
            "settings-preflight",
            "settings-receipt",
            "zero variables",
            "zero secrets",
            "signed-in owner UI transaction",
            "remains an external Ready blocker",
            "must remain Draft",
        ):
            if token not in text:
                raise ValueError(f"release settings contract lost: {token}")

    def test_only_the_exact_immutable_no_bypass_receipt_is_ready(self):
        exact = settings_receipt()
        RC.validate_settings_receipt(exact, "owner/site")
        mutations: list[dict[str, object]] = []
        for key, value in (
            ("repository", "other/site"),
            ("branch", "release"),
            ("merge_methods", ["squash"]),
            ("merge_methods", ["merge", "rebase", "squash"]),
            ("merge_methods", ["rebase", "rebase", "squash"]),
            ("actions_enabled", False),
            ("actions_allowed_actions", "foreign"),
            ("actions_sha_pinning_required", False),
            ("default_workflow_permissions", "write"),
            ("actions_can_approve_pull_request_reviews", True),
            ("strict_status_checks", False),
            ("require_pull_request", False),
            ("required_approving_review_count", 1),
            ("dismiss_stale_reviews_on_push", True),
            ("required_reviewers", [{"foreign": True}]),
            ("require_code_owner_review", True),
            ("require_last_push_approval", True),
            ("required_review_thread_resolution", False),
            ("require_linear_history", False),
            ("require_signed_commits", False),
            ("restrict_creations", False),
            ("allow_force_pushes", True),
            ("allow_deletions", True),
            ("restrict_updates", True),
            ("code_scanning_tools", []),
            (
                "code_scanning_tools",
                [
                    {
                        "tool": "CodeQL",
                        "security_alerts_threshold": "critical",
                        "alerts_threshold": "errors",
                    }
                ],
            ),
            ("code_quality_severity", "warnings"),
            ("minimum_code_coverage", 79),
            ("maximum_code_coverage_drop", 1),
            ("immutable_releases", False),
            ("private_vulnerability_reporting", False),
            ("secret_scanning", False),
            ("secret_scanning_push_protection", False),
            ("secret_scanning_non_provider_patterns", "false"),
            ("secret_scanning_validity_checks", None),
        ):
            changed = copy.deepcopy(exact)
            changed[key] = value
            mutations.append(changed)
        checks = copy.deepcopy(exact["required_status_checks"])
        for replacement in (
            checks[:-1],
            [*checks, {"context": "foreign", "integration_id": 15368}],
            [*checks, copy.deepcopy(checks[0])],
            [{**check, "integration_id": 1} for check in checks],
            [{"context": check["context"]} for check in checks],
        ):
            changed = copy.deepcopy(exact)
            changed["required_status_checks"] = replacement
            mutations.append(changed)
        for index, changed in enumerate(mutations):
            with self.subTest(mutation=index), self.assertRaises(RC.ContractError):
                RC.validate_settings_receipt(changed, "owner/site")
        for key in exact:
            changed = copy.deepcopy(exact)
            del changed[key]
            with self.subTest(missing=key), self.assertRaises(RC.ContractError):
                RC.validate_settings_receipt(changed, "owner/site")
        changed = copy.deepcopy(exact)
        changed["ruleset_id"] = 42
        with self.assertRaises(RC.ContractError):
            RC.validate_settings_receipt(changed, "owner/site")

    @staticmethod
    def observe(records: dict[str, object]) -> dict[str, object]:
        with mock.patch.object(
            RC,
            "_github_api_get",
            side_effect=lambda endpoint, **_options: records[endpoint],
        ) as getter:
            receipt = RC.observe_live_settings("owner/site")
        self_calls = [call.args[0] for call in getter.call_args_list]
        if self_calls != [
            "repos/owner/site",
            "repos/owner/site/immutable-releases",
            "repos/owner/site/private-vulnerability-reporting",
            "repos/owner/site/actions/permissions",
            "repos/owner/site/actions/permissions/workflow",
            "repos/owner/site/rulesets",
            "repos/owner/site/rulesets/42",
        ]:
            raise AssertionError(f"unexpected settings endpoints: {self_calls}")
        if getter.call_args_list[5].kwargs != {"paginate": True}:
            raise AssertionError("ruleset inventory must use exhaustive pagination")
        if any(call.kwargs for index, call in enumerate(getter.call_args_list) if index != 5):
            raise AssertionError("only the list endpoint should paginate")
        return receipt

    def test_authoritative_raw_preflight_rejects_every_control_mutant(self):
        exact = settings_api()
        self.assertEqual(self.observe(copy.deepcopy(exact)), settings_receipt())

        mutations: list[dict[str, object]] = []
        for endpoint, path, value in (
            ("repos/owner/site", ("default_branch",), "release"),
            ("repos/owner/site/immutable-releases", ("enabled",), False),
            ("repos/owner/site/private-vulnerability-reporting", ("enabled",), False),
            ("repos/owner/site/actions/permissions", ("enabled",), False),
            (
                "repos/owner/site/actions/permissions",
                ("sha_pinning_required",),
                False,
            ),
            (
                "repos/owner/site/actions/permissions/workflow",
                ("default_workflow_permissions",),
                "write",
            ),
            (
                "repos/owner/site/actions/permissions/workflow",
                ("can_approve_pull_request_reviews",),
                True,
            ),
            (
                "repos/owner/site",
                ("security_and_analysis", "secret_scanning", "status"),
                "disabled",
            ),
            (
                "repos/owner/site",
                (
                    "security_and_analysis",
                    "secret_scanning_push_protection",
                    "status",
                ),
                "disabled",
            ),
            ("repos/owner/site/rulesets/42", ("enforcement",), "disabled"),
            ("repos/owner/site/rulesets/42", ("conditions", "ref_name", "include"), ["~ALL"]),
        ):
            changed = copy.deepcopy(exact)
            parent = changed[endpoint]
            for key in path[:-1]:
                parent = parent[key]
            parent[path[-1]] = value
            mutations.append(changed)

        detail = exact["repos/owner/site/rulesets/42"]
        rules = detail["rules"]
        for rule_type in (
            "creation",
            "deletion",
            "non_fast_forward",
            "required_linear_history",
            "pull_request",
            "required_status_checks",
            "required_signatures",
            "code_scanning",
            "code_quality",
            "code_coverage",
        ):
            changed = copy.deepcopy(exact)
            changed["repos/owner/site/rulesets/42"]["rules"] = [
                rule for rule in rules if rule["type"] != rule_type
            ]
            mutations.append(changed)
        changed = copy.deepcopy(exact)
        changed["repos/owner/site/rulesets/42"]["rules"].append({"type": "update"})
        mutations.append(changed)

        changed = copy.deepcopy(exact)
        changed["repos/owner/site/rulesets/42"]["rules"][1]["parameters"] = {}
        mutations.append(changed)

        for field, value in (
            ("allowed_merge_methods", ["merge", "rebase", "squash"]),
            ("allowed_merge_methods", ["squash"]),
            ("allowed_merge_methods", ["rebase", "squash"]),
            ("required_approving_review_count", 1),
            ("dismiss_stale_reviews_on_push", True),
            ("required_reviewers", [{"foreign": True}]),
            ("require_code_owner_review", True),
            ("require_last_push_approval", True),
            ("required_review_thread_resolution", False),
        ):
            changed = copy.deepcopy(exact)
            pull = next(
                rule
                for rule in changed["repos/owner/site/rulesets/42"]["rules"]
                if rule["type"] == "pull_request"
            )
            pull["parameters"][field] = value
            mutations.append(changed)
        for field in RC.EXPECTED_PULL_REQUEST_PARAMETERS:
            changed = copy.deepcopy(exact)
            pull = next(
                rule
                for rule in changed["repos/owner/site/rulesets/42"]["rules"]
                if rule["type"] == "pull_request"
            )
            del pull["parameters"][field]
            mutations.append(changed)
        changed = copy.deepcopy(exact)
        pull = next(
            rule
            for rule in changed["repos/owner/site/rulesets/42"]["rules"]
            if rule["type"] == "pull_request"
        )
        pull["parameters"]["foreign"] = False
        mutations.append(changed)
        for field, value in (
            ("strict_required_status_checks_policy", False),
            ("do_not_enforce_on_create", True),
        ):
            changed = copy.deepcopy(exact)
            status = next(
                rule
                for rule in changed["repos/owner/site/rulesets/42"]["rules"]
                if rule["type"] == "required_status_checks"
            )
            status["parameters"][field] = value
            mutations.append(changed)
        changed = copy.deepcopy(exact)
        status = next(
            rule
            for rule in changed["repos/owner/site/rulesets/42"]["rules"]
            if rule["type"] == "required_status_checks"
        )
        status["parameters"]["foreign"] = False
        mutations.append(changed)
        for replacement in (
            [{"context": context, "integration_id": 15368} for context in REQUIRED_CHECKS[:-1]],
            [
                *[{"context": context, "integration_id": 15368} for context in REQUIRED_CHECKS],
                {"context": "foreign", "integration_id": 15368},
            ],
            [{"context": context, "integration_id": 1} for context in REQUIRED_CHECKS],
        ):
            changed = copy.deepcopy(exact)
            status = next(
                rule
                for rule in changed["repos/owner/site/rulesets/42"]["rules"]
                if rule["type"] == "required_status_checks"
            )
            status["parameters"]["required_status_checks"] = replacement
            mutations.append(changed)
        for rule_type, field, value in (
            ("code_scanning", "code_scanning_tools", []),
            (
                "code_scanning",
                "code_scanning_tools",
                [
                    {
                        "tool": "CodeQL",
                        "security_alerts_threshold": "critical",
                        "alerts_threshold": "errors",
                    }
                ],
            ),
            ("code_quality", "severity", "warnings"),
            ("code_coverage", "minimum_coverage", 79),
            ("code_coverage", "max_coverage_drop", 1),
        ):
            changed = copy.deepcopy(exact)
            rule = next(
                item
                for item in changed["repos/owner/site/rulesets/42"]["rules"]
                if item["type"] == rule_type
            )
            rule["parameters"][field] = value
            mutations.append(changed)
        for rule_type in ("code_scanning", "code_quality", "code_coverage"):
            changed = copy.deepcopy(exact)
            rule = next(
                item
                for item in changed["repos/owner/site/rulesets/42"]["rules"]
                if item["type"] == rule_type
            )
            rule["parameters"]["foreign"] = False
            mutations.append(changed)
        changed = copy.deepcopy(exact)
        changed["repos/owner/site/rulesets"].append(copy.deepcopy(changed["repos/owner/site/rulesets"][0]))
        mutations.append(changed)

        for index, changed in enumerate(mutations):
            with self.subTest(raw_mutation=index), self.assertRaises(RC.ContractError):
                self.observe(changed)

    def test_merge_methods_bind_to_the_enforcing_ruleset_under_the_ci_credential(self):
        # The publisher mints an Administration-read App token, and GitHub
        # documents that "to view merge-related settings, you must have the
        # contents:read and contents:write permissions".  Deriving the receipt's
        # merge methods from repos/{owner}/{repo}'s allow_*_merge booleans was
        # therefore unsatisfiable in CI: every release-publisher run since
        # 2026-08-14 denied with "repository setting allow_merge_commit is not
        # boolean" before any release could be published.  The Protect-Main
        # ruleset is both readable by that credential and the control that
        # actually governs refs/heads/main, so it is the authoritative source.
        expected = settings_receipt()
        credential_shape = settings_api()
        repository_record = credential_shape["repos/owner/site"]
        for absent in ("allow_merge_commit", "allow_rebase_merge", "allow_squash_merge"):
            self.assertNotIn(absent, repository_record)
        self.assertEqual(self.observe(copy.deepcopy(credential_shape)), expected)
        self.assertEqual(expected["merge_methods"], ["rebase", "squash"])
        RC.validate_settings_receipt(expected, "owner/site")

        # A contents-write credential additionally returns the booleans.  The
        # receipt must be byte-identical either way, and must never be steered
        # by a field the enforcing ruleset does not own.
        for booleans in (
            {
                "allow_merge_commit": False,
                "allow_rebase_merge": True,
                "allow_squash_merge": True,
            },
            {
                "allow_merge_commit": True,
                "allow_rebase_merge": False,
                "allow_squash_merge": False,
            },
            {"allow_merge_commit": "false", "allow_rebase_merge": None},
        ):
            widened = copy.deepcopy(credential_shape)
            widened["repos/owner/site"].update(booleans)
            with self.subTest(repository_booleans=sorted(booleans)):
                self.assertEqual(self.observe(widened), expected)

        # The ruleset half stays fail-closed: a merge-commit-capable, narrowed,
        # duplicated, empty, missing, or non-list value can never build a
        # receipt, so no credential shape can smuggle merge commits onto main.
        for value in (
            ["merge", "squash"],
            ["merge", "rebase", "squash"],
            ["squash"],
            ["rebase"],
            ["squash", "squash"],
            [],
            "squash",
            None,
            {"squash": True, "rebase": True},
        ):
            changed = copy.deepcopy(credential_shape)
            pull = next(
                rule
                for rule in changed["repos/owner/site/rulesets/42"]["rules"]
                if rule["type"] == "pull_request"
            )
            pull["parameters"]["allowed_merge_methods"] = value
            with self.subTest(allowed_merge_methods=value), self.assertRaises(
                RC.ContractError
            ):
                self.observe(changed)
        missing = copy.deepcopy(credential_shape)
        pull = next(
            rule
            for rule in missing["repos/owner/site/rulesets/42"]["rules"]
            if rule["type"] == "pull_request"
        )
        del pull["parameters"]["allowed_merge_methods"]
        with self.assertRaises(RC.ContractError):
            self.observe(missing)

        # And the downstream validator keeps demanding exactly rebase+squash of
        # whatever the builder produced.
        for wrong in (["merge", "rebase", "squash"], ["squash"], ["rebase"], []):
            changed = copy.deepcopy(expected)
            changed["merge_methods"] = wrong
            with self.subTest(receipt_merge_methods=wrong), self.assertRaises(
                RC.ContractError
            ):
                RC.validate_settings_receipt(changed, "owner/site")

    def test_bypass_actors_are_unreadable_by_the_ci_credential_and_not_asserted(self):
        # GitHub's REST reference for "Get a repository ruleset" states: "To
        # prevent leaking sensitive information, the bypass_actors property is
        # only returned if the user making the API request has write access to
        # the ruleset."  The publisher mints an Administration-read App token,
        # which has no write access to the ruleset, so the property is absent
        # from its response entirely.  Reading it denied the first run after the
        # merge-method re-anchor with "Protect-Main bypass actors must be a JSON
        # array" — and it denied there before rules[] was ever parsed, so the
        # re-anchored merge-method derivation had never once executed under the
        # CI credential.  CI now asserts exactly what the enforcing surface
        # exposes to the CI credential.  The no-bypass invariant is not
        # abandoned; it moves to the owner-verified column, discharged by the
        # standalone GET-only bypass command in docs/release-governance.md,
        # whose ruleset-write credential does return the property.  This
        # deletion is credential-independent, so no preflight run — CI's or the
        # owner's — reads the property (that document records which invariants
        # each side proves).
        expected = settings_receipt()
        credential_shape = settings_api()
        detail = credential_shape["repos/owner/site/rulesets/42"]
        self.assertNotIn("bypass_actors", detail)
        self.assertEqual(self.observe(copy.deepcopy(credential_shape)), expected)
        self.assertNotIn("bypass_actors", expected)
        RC.validate_settings_receipt(expected, "owner/site")

        # A write-access credential additionally returns the property, in any
        # shape.  The receipt must be byte-identical either way: no conditional
        # assertion, no credential-dependent branch, and no field the CI
        # credential cannot see may steer the outcome.
        for actors in (
            [],
            [{"actor_type": "RepositoryRole", "actor_id": 5, "bypass_mode": "always"}],
            [{"actor_type": "OrganizationAdmin"}, {"actor_type": "DeployKey"}],
            "none",
            None,
            {},
        ):
            widened = copy.deepcopy(credential_shape)
            widened["repos/owner/site/rulesets/42"]["bypass_actors"] = actors
            with self.subTest(bypass_actors=actors):
                self.assertEqual(self.observe(widened), expected)

        # The receipt schema is closed and carries no bypass field at all, so a
        # dangling one is foreign and fails rather than being quietly tolerated.
        dangling = copy.deepcopy(expected)
        dangling["bypass_actors"] = []
        with self.assertRaises(RC.ContractError):
            RC.validate_settings_receipt(dangling, "owner/site")

        # rules[] parsing is now actually reachable under the CI-credential
        # shape: a rules-layer defect must deny for its own reason, never for
        # the bypass read that used to preempt it.
        for mutate, expected_error in (
            (lambda detail: detail.__setitem__("rules", None), "Protect-Main rules"),
            (
                lambda detail: detail["rules"].append({"type": "update"}),
                "Protect-Main rule types",
            ),
        ):
            changed = copy.deepcopy(credential_shape)
            mutate(changed["repos/owner/site/rulesets/42"])
            with self.subTest(rules_mutation=expected_error):
                with self.assertRaises(RC.ContractError) as caught:
                    self.observe(changed)
                self.assertIn(expected_error, str(caught.exception))
                self.assertNotIn("bypass", str(caught.exception))
        broken_merge = copy.deepcopy(credential_shape)
        pull = next(
            rule
            for rule in broken_merge["repos/owner/site/rulesets/42"]["rules"]
            if rule["type"] == "pull_request"
        )
        del pull["parameters"]["allowed_merge_methods"]
        with self.assertRaises(RC.ContractError) as caught:
            self.observe(broken_merge)
        self.assertNotIn("bypass", str(caught.exception))

    def test_github_settings_reader_is_get_only_and_fails_closed(self):
        completed = subprocess.CompletedProcess([], 0, stdout='{"enabled": true}', stderr="")
        with mock.patch.object(RC.subprocess, "run", return_value=completed) as run:
            self.assertEqual(RC._github_api_get("repos/owner/site/immutable-releases"), {"enabled": True})
        command = run.call_args.args[0]
        self.assertEqual(command[:4], ["gh", "api", "--method", "GET"])
        self.assertIn("X-GitHub-Api-Version: 2026-03-10", command)
        self.assertNotIn("POST", command)
        self.assertNotIn("PUT", command)
        self.assertNotIn("PATCH", command)
        self.assertNotIn("DELETE", command)
        pages = subprocess.CompletedProcess(
            [],
            0,
            stdout='[[{"id": 1}], [{"id": 2}]]',
            stderr="",
        )
        with mock.patch.object(RC.subprocess, "run", return_value=pages) as run:
            self.assertEqual(RC._github_api_get("repos/owner/site/rulesets", paginate=True), [{"id": 1}, {"id": 2}])
        paginated_command = run.call_args.args[0]
        self.assertIn("--paginate", paginated_command)
        self.assertIn("--slurp", paginated_command)
        for result in (
            subprocess.CompletedProcess([], 1, stdout="", stderr="denied"),
            subprocess.CompletedProcess([], 0, stdout="not-json", stderr=""),
        ):
            with mock.patch.object(RC.subprocess, "run", return_value=result), self.assertRaises(
                RC.ContractError
            ):
                RC._github_api_get("repos/owner/site/immutable-releases")

    def test_immutable_settings_cli_and_private_reporting_kill_field_mutants(self):
        immutable = {"enabled": True, "enforced_by_owner": False}
        RC.validate_immutable_settings(immutable)
        for changed in (
            {"enabled": False, "enforced_by_owner": False},
            {"enabled": True, "enforced_by_owner": "false"},
            {"enabled": True},
            {**immutable, "foreign": True},
        ):
            with self.subTest(immutable=changed), self.assertRaises(RC.ContractError):
                RC.validate_immutable_settings(changed)
        private = {"enabled": True}
        RC.validate_private_vulnerability_reporting(private)
        for changed in ({"enabled": False}, {}, {"enabled": True, "foreign": True}):
            with self.subTest(private=changed), self.assertRaises(RC.ContractError):
                RC.validate_private_vulnerability_reporting(changed)

        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "immutable.json"
            path.write_text(json.dumps(immutable), encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(
                    RC.main(["immutable-settings", "--settings-json", str(path)]),
                    0,
                )
            self.assertEqual(output.getvalue().strip(), "exact")

    def test_settings_cli_and_runbook_are_load_bearing(self):
        with tempfile.TemporaryDirectory() as temporary:
            receipt = Path(temporary) / "settings.json"
            receipt.write_text(json.dumps(settings_receipt()), encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(
                    RC.main(
                        [
                            "settings-receipt",
                            "--receipt",
                            str(receipt),
                            "--repository",
                            "owner/site",
                        ]
                    ),
                    0,
                )
            self.assertEqual(output.getvalue().strip(), "exact")
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(
                    RC.main(
                        [
                            "settings-receipt",
                            "--receipt",
                            str(receipt),
                            "--repository",
                            "other/site",
                        ]
                    ),
                    1,
                )

        runbook = (ROOT / "docs" / "release-governance.md").read_text(encoding="utf-8")
        self.require_documented_contract(runbook)
        tokens = (
            "Release-control readiness receipt",
            '"immutable_releases": true',
            '"private_vulnerability_reporting": true',
            '"actions_enabled": true',
            '"actions_allowed_actions": "all"',
            '"actions_sha_pinning_required": true',
            '"default_workflow_permissions": "read"',
            '"actions_can_approve_pull_request_reviews": false',
            '"merge_methods": ["rebase", "squash"]',
            '"context": "security", "integration_id": 15368',
            '"strict_status_checks": true',
            '"require_pull_request": true',
            '"require_linear_history": true',
            '"require_signed_commits": true',
            '"allow_force_pushes": false',
            '"allow_deletions": false',
            '"restrict_updates": false',
            "Owner-verified",
            "has write access to the ruleset",
            "--jq '.bypass_actors'",
            "# must print: []",
            '"secret_scanning": true',
            '"secret_scanning_push_protection": true',
            '"secret_scanning_non_provider_patterns": false',
            '"secret_scanning_validity_checks": false',
            "private-vulnerability-reporting",
            "settings-preflight",
            "settings-receipt",
            "zero variables",
            "zero secrets",
            "signed-in owner UI transaction",
            "remains an external Ready blocker",
            "must remain Draft",
        )
        for token in tokens:
            with self.subTest(deletion=token), self.assertRaises(ValueError):
                self.require_documented_contract(runbook.replace(token, ""))
        for old, new in (
            ('"immutable_releases": true', '"immutable_releases": false'),
            (
                '"private_vulnerability_reporting": true',
                '"private_vulnerability_reporting": false',
            ),
            ('"actions_sha_pinning_required": true', '"actions_sha_pinning_required": false'),
            ('"default_workflow_permissions": "read"', '"default_workflow_permissions": "write"'),
            ('"strict_status_checks": true', '"strict_status_checks": false'),
            ('"allow_force_pushes": false', '"allow_force_pushes": true'),
            ('"allow_deletions": false', '"allow_deletions": true'),
            ('"restrict_updates": false', '"restrict_updates": true'),
            ('"require_signed_commits": true', '"require_signed_commits": false'),
            ('"secret_scanning": true', '"secret_scanning": false'),
            (
                '"secret_scanning_push_protection": true',
                '"secret_scanning_push_protection": false',
            ),
        ):
            with self.subTest(inversion=old), self.assertRaises(ValueError):
                self.require_documented_contract(runbook.replace(old, new, 1))


class ArtifactStateTests(unittest.TestCase):
    def test_absent_complete_and_every_partial_state(self):
        self.assertEqual(RC.classify_artifact(present=False, source_match=False, signature_match=False, evidence_count=0, expected_evidence=2), "absent")
        self.assertEqual(RC.classify_artifact(present=True, source_match=True, signature_match=True, evidence_count=2, expected_evidence=2), "complete")
        for source, signed, count in ((False, True, 2), (True, False, 2), (True, True, 0), (True, True, 1), (True, True, 3)):
            with self.subTest(source=source, signed=signed, count=count):
                self.assertEqual(RC.classify_artifact(present=True, source_match=source, signature_match=signed, evidence_count=count, expected_evidence=2), "burned")
        with self.assertRaises(RC.ContractError):
            RC.classify_artifact(present=False, source_match=True, signature_match=False, evidence_count=0, expected_evidence=2)

    def test_only_an_authoritative_404_means_absent(self):
        self.assertEqual(RC.classify_registry_response(200), "present")
        self.assertEqual(RC.classify_registry_response(404), "absent")
        for status in (0, 301, 401, 403, 408, 409, 429, 500, 502, 503, 504):
            with self.subTest(status=status), self.assertRaises(RC.ContractError):
                RC.classify_registry_response(status)


class PublisherBindingTests(unittest.TestCase):
    SHA = "a" * 40

    def test_source_sha_ref_event_and_snapshot_checks_are_executable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, contents in snapshot("0.1.10").items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(contents, encoding="utf-8")
            workflow_ref = (
                f"{RC.EXPECTED_REPOSITORY}/.github/workflows/"
                "release-publisher.yml@refs/heads/main"
            )
            intent = RC.validate_publisher(
                root,
                self.SHA,
                self.SHA,
                "refs/heads/main",
                "workflow_dispatch",
                RC.EXPECTED_REPOSITORY,
                workflow_ref,
                RC.EXPECTED_IMAGE,
                RC.EXPECTED_CHART,
            )
            self.assertEqual(intent, RC.ReleaseIntent(self.SHA, RC.Version.parse("0.1.10")))
            valid = (
                self.SHA,
                self.SHA,
                "refs/heads/main",
                "workflow_dispatch",
                RC.EXPECTED_REPOSITORY,
                workflow_ref,
                RC.EXPECTED_IMAGE,
                RC.EXPECTED_CHART,
            )
            mutants = (
                ("b" * 40, *valid[1:]),
                (valid[0], "b" * 40, *valid[2:]),
                (*valid[:2], "refs/tags/v0.1.10", *valid[3:]),
                (*valid[:3], "push", *valid[4:]),
                (*valid[:4], "other/site", *valid[5:]),
                (
                    self.SHA,
                    self.SHA,
                    "refs/heads/main",
                    "workflow_dispatch",
                    RC.EXPECTED_REPOSITORY,
                    f"{RC.EXPECTED_REPOSITORY}/.github/workflows/"
                    "release-publisher.yml@refs/tags/v0.1.10",
                    RC.EXPECTED_IMAGE,
                    RC.EXPECTED_CHART,
                ),
                (*valid[:6], "ghcr.io/snaraj/naranjo.online", valid[7]),
                (*valid[:7], "ghcr.io/snaraj/charts/naranjo.online"),
            )
            for source, checkout, ref, event_name, repository, selected_workflow, image, chart in mutants:
                with self.subTest(
                    source=source,
                    checkout=checkout,
                    ref=ref,
                    event=event_name,
                    repository=repository,
                    workflow=selected_workflow,
                    image=image,
                    chart=chart,
                ), self.assertRaises(RC.ContractError):
                    RC.validate_publisher(
                        root,
                        source,
                        checkout,
                        ref,
                        event_name,
                        repository,
                        selected_workflow,
                        image,
                        chart,
                    )

    def test_real_dotted_repository_maps_only_to_explicit_hyphenated_packages(self):
        RC.validate_release_destinations(
            "snaraj/naranjo.online",
            "ghcr.io/snaraj/naranjo-online",
            "ghcr.io/snaraj/charts/naranjo-online",
        )
        for repository, image, chart in (
            (
                "snaraj/naranjo.online",
                "ghcr.io/snaraj/naranjo.online",
                RC.EXPECTED_CHART,
            ),
            (
                "snaraj/naranjo.online",
                RC.EXPECTED_IMAGE,
                "ghcr.io/snaraj/charts/naranjo.online",
            ),
            ("snaraj/naranjo-online", RC.EXPECTED_IMAGE, RC.EXPECTED_CHART),
        ):
            with self.subTest(repository=repository, image=image, chart=chart), self.assertRaises(
                RC.ContractError
            ):
                RC.validate_release_destinations(repository, image, chart)


class ImmutableMetadataTests(unittest.TestCase):
    TAG = "v0.1.10"
    SOURCE = "a" * 40
    MESSAGE = f"Release {TAG} from {SOURCE}"
    DATE = "2026-08-13T15:21:32Z"

    def test_annotated_tag_type_target_message_and_tagger_are_exact(self):
        ref, tag = exact_tag_records(self.TAG, self.SOURCE, self.MESSAGE, self.DATE)
        RC.validate_tag_record(
            ref,
            tag,
            tag=self.TAG,
            source_sha=self.SOURCE,
            message=self.MESSAGE,
            tagger_name="github-actions[bot]",
            tagger_email="41898282+github-actions[bot]@users.noreply.github.com",
            tagger_date="2026-08-13T08:21:32-07:00",
        )
        mutations: list[tuple[dict[str, object], dict[str, object]]] = []
        for target, path, value in (
            ("ref", ("ref",), "refs/tags/v0.1.11"),
            ("ref", ("object", "type"), "commit"),
            ("ref", ("object", "sha"), "c" * 40),
            ("tag", ("tag",), "v0.1.11"),
            ("tag", ("message",), self.MESSAGE + " foreign"),
            ("tag", ("object", "type"), "tree"),
            ("tag", ("object", "sha"), "d" * 40),
            ("tag", ("tagger", "name"), "snaraj"),
            ("tag", ("tagger", "email"), "foreign@example.invalid"),
            ("tag", ("tagger", "date"), "2026-08-13T15:21:33Z"),
        ):
            changed_ref, changed_tag = copy.deepcopy(ref), copy.deepcopy(tag)
            changed = changed_ref if target == "ref" else changed_tag
            parent = changed
            for key in path[:-1]:
                parent = parent[key]
            parent[path[-1]] = value
            mutations.append((changed_ref, changed_tag))
        for index, (changed_ref, changed_tag) in enumerate(mutations):
            with self.subTest(index=index), self.assertRaises(RC.ContractError):
                RC.validate_tag_record(
                    changed_ref,
                    changed_tag,
                    tag=self.TAG,
                    source_sha=self.SOURCE,
                    message=self.MESSAGE,
                    tagger_name="github-actions[bot]",
                    tagger_email="41898282+github-actions[bot]@users.noreply.github.com",
                    tagger_date=self.DATE,
                )

    def test_release_metadata_and_one_manifest_asset_are_exact(self):
        manifest = canonical_manifest_bytes(exact_release_manifest(source=self.SOURCE))
        exact = exact_release_record(manifest, tag=self.TAG)
        RC.validate_release_record(
            exact,
            tag=self.TAG,
            title=f"naranjo.online {self.TAG}",
            body="exact notes",
            manifest=manifest,
        )
        prepared = exact_release_record(manifest, tag=self.TAG, state="prepared")
        RC.validate_release_record(
            prepared,
            tag=self.TAG,
            title=f"naranjo.online {self.TAG}",
            body="exact notes",
            manifest=manifest,
            state="prepared",
        )
        actor_mutants = (
            None,
            {},
            {"login": RC.GITHUB_ACTIONS_BOT_LOGIN},
            {"id": RC.GITHUB_ACTIONS_BOT_ID},
            {"login": "foreign-writer", "id": RC.GITHUB_ACTIONS_BOT_ID},
            {"login": RC.GITHUB_ACTIONS_BOT_LOGIN, "id": 1},
            {"login": RC.GITHUB_ACTIONS_BOT_LOGIN, "id": True},
            {"login": RC.GITHUB_ACTIONS_BOT_LOGIN, "id": float(RC.GITHUB_ACTIONS_BOT_ID)},
        )
        for state in ("prepared", "staged", "exact"):
            for actor in actor_mutants:
                changed = exact_release_record(manifest, tag=self.TAG, state=state)
                changed["author"] = actor
                with self.subTest(state=state, release_author=actor), self.assertRaises(
                    RC.ContractError
                ):
                    RC.validate_release_record(
                        changed,
                        tag=self.TAG,
                        title=f"naranjo.online {self.TAG}",
                        body="exact notes",
                        manifest=manifest,
                        state=state,
                    )
        for state in ("staged", "exact"):
            for uploader in actor_mutants:
                changed = exact_release_record(manifest, tag=self.TAG, state=state)
                changed["assets"][0]["uploader"] = uploader
                with self.subTest(state=state, asset_uploader=uploader), self.assertRaises(
                    RC.ContractError
                ):
                    RC.validate_release_record(
                        changed,
                        tag=self.TAG,
                        title=f"naranjo.online {self.TAG}",
                        body="exact notes",
                        manifest=manifest,
                        state=state,
                    )
        for key, value in (
            ("tag_name", "v0.1.11"),
            ("name", "foreign"),
            ("body", "foreign"),
            ("body", None),
            ("draft", True),
            ("prerelease", True),
            ("immutable", False),
            ("immutable", None),
            ("assets", []),
            ("assets", [exact["assets"][0], {"name": "foreign.bin"}]),
            ("assets", None),
        ):
            changed = copy.deepcopy(exact)
            changed[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(RC.ContractError):
                RC.validate_release_record(
                    changed,
                    tag=self.TAG,
                    title=f"naranjo.online {self.TAG}",
                    body="exact notes",
                    manifest=manifest,
                )
        for field, value in (
            ("name", "foreign.json"),
            ("content_type", "application/octet-stream"),
            ("state", "new"),
            ("size", len(manifest) + 1),
            ("digest", "sha256:" + "0" * 64),
        ):
            changed = copy.deepcopy(exact)
            changed["assets"][0][field] = value
            with self.subTest(asset_field=field), self.assertRaises(RC.ContractError):
                RC.validate_release_record(
                    changed,
                    tag=self.TAG,
                    title=f"naranjo.online {self.TAG}",
                    body="exact notes",
                    manifest=manifest,
                )
        with self.assertRaises(RC.ContractError):
            RC.validate_release_record(
                exact,
                tag=self.TAG,
                title=f"naranjo.online {self.TAG}",
                body="exact notes",
                manifest=manifest + b" ",
            )

    def test_manifest_binds_source_run_artifacts_scans_and_notes_exactly(self):
        exact = exact_release_manifest(source=self.SOURCE)
        expected = {
            "repository": RC.EXPECTED_REPOSITORY,
            "source_sha": self.SOURCE,
            "main_run_id": 123,
            "version": "0.1.10",
            "image": RC.EXPECTED_IMAGE,
            "image_digest": "sha256:" + "c" * 64,
            "chart": RC.EXPECTED_CHART,
            "chart_digest": "sha256:" + "d" * 64,
        }
        RC.validate_release_manifest_record(exact, **expected)
        notes = RC.build_release_notes(exact)
        self.assertIn("naranjo-online-v0.1.10-release-manifest.json", notes)
        self.assertIn("sha256:" + hashlib.sha256(canonical_manifest_bytes(exact)).hexdigest(), notes)
        mutations = (
            (("schema",), "foreign"),
            (("source_sha",), "b" * 40),
            (("main_run_id",), 124),
            (("release", "version"), "0.1.11"),
            (("release", "tag"), "v0.1.11"),
            (("publisher", "workflow"), ".github/workflows/foreign.yml"),
            (("publisher", "ref"), "refs/tags/v0.1.10"),
            (("artifacts", "image", "digest"), "sha256:" + "e" * 64),
            (("artifacts", "image", "tag"), "0.1.10"),
            (("artifacts", "image", "platforms"), ["linux/amd64"]),
            (("artifacts", "image", "signature_identity"), "foreign"),
            (("artifacts", "image", "provenance"), "none"),
            (("artifacts", "chart", "digest"), "sha256:" + "e" * 64),
            (("artifacts", "chart", "tag"), "v0.1.10"),
            (("vulnerability_scans", "source", "scanner_version"), "latest"),
            (("vulnerability_scans", "source", "main_run_id"), 124),
            (("vulnerability_scans", "source", "result"), "unknown"),
            (("vulnerability_scans", "image", "target"), "foreign"),
            (("vulnerability_scans", "image", "severities"), ["CRITICAL"]),
            (("vulnerability_scans", "image", "ignore_unfixed"), True),
        )
        for path, value in mutations:
            changed = copy.deepcopy(exact)
            parent = changed
            for key in path[:-1]:
                parent = parent[key]
            parent[path[-1]] = value
            with self.subTest(path=path), self.assertRaises(RC.ContractError):
                RC.validate_release_manifest_record(changed, **expected)
        changed = copy.deepcopy(exact)
        changed["foreign"] = True
        with self.assertRaises(RC.ContractError):
            RC.validate_release_manifest_record(changed, **expected)


class PublicationTransactionTests(unittest.TestCase):
    TAG = "v0.1.10"
    SOURCE = "a" * 40
    MESSAGE = f"Release {TAG} from {SOURCE}"
    DATE = "2026-08-13T15:21:32Z"

    def tag_expected(self) -> dict[str, str]:
        return {
            "tag": self.TAG,
            "source_sha": self.SOURCE,
            "message": self.MESSAGE,
            "tagger_name": "github-actions[bot]",
            "tagger_email": "41898282+github-actions[bot]@users.noreply.github.com",
            "tagger_date": self.DATE,
        }

    def manifest(self) -> bytes:
        return canonical_manifest_bytes(exact_release_manifest(source=self.SOURCE))

    def release(self, state: str = "exact") -> dict[str, object]:
        return exact_release_record(self.manifest(), tag=self.TAG, state=state)

    def test_absent_create_verify_and_concurrent_retry_need_no_local_tag_ref(self):
        ref, tag = exact_tag_records(self.TAG, self.SOURCE, self.MESSAGE, self.DATE)
        # Both racers can observe absence. The winner creates the exact REST
        # records; the loser re-queries those records after its create fails.
        self.assertEqual(RC.classify_tag_state(404, None, None, **self.tag_expected()), "absent")
        self.assertEqual(RC.classify_tag_state(404, None, None, **self.tag_expected()), "absent")
        self.assertEqual(RC.classify_tag_state(200, ref, tag, **self.tag_expected()), "exact")
        self.assertEqual(RC.classify_tag_state(200, ref, tag, **self.tag_expected()), "exact")

        manifest = self.manifest()
        prepared_release = self.release("prepared")
        staged_release = self.release("staged")
        expected_release = self.release()
        for _racer in range(2):
            self.assertEqual(
                RC.classify_release_state(
                    404,
                    None,
                    tag=self.TAG,
                    title=f"naranjo.online {self.TAG}",
                    body="exact notes",
                    manifest=manifest,
                ),
                "absent",
            )
        self.assertEqual(
            RC.classify_release_state(
                200,
                prepared_release,
                tag=self.TAG,
                title=f"naranjo.online {self.TAG}",
                body="exact notes",
                manifest=manifest,
            ),
            "prepared",
        )
        self.assertEqual(
            RC.classify_release_state(
                200,
                staged_release,
                tag=self.TAG,
                title=f"naranjo.online {self.TAG}",
                body="exact notes",
                manifest=manifest,
            ),
            "staged",
        )
        for _retry in range(2):
            self.assertEqual(
                RC.classify_release_state(
                    200,
                    expected_release,
                    tag=self.TAG,
                    title=f"naranjo.online {self.TAG}",
                    body="exact notes",
                    manifest=manifest,
                ),
                "exact",
            )

    def test_missing_records_conflicts_and_non_authoritative_absence_fail_closed(self):
        ref, tag = exact_tag_records(self.TAG, self.SOURCE, self.MESSAGE, self.DATE)
        for status in (0, 301, 401, 403, 409, 422, 429, 500, 503):
            with self.subTest(kind="tag-status", status=status), self.assertRaises(RC.ContractError):
                RC.classify_tag_state(status, None, None, **self.tag_expected())
            with self.subTest(kind="release-status", status=status), self.assertRaises(RC.ContractError):
                RC.classify_release_state(
                    status,
                    None,
                    tag=self.TAG,
                    title=f"naranjo.online {self.TAG}",
                    body="exact notes",
                    manifest=self.manifest(),
                )
        for changed_ref, changed_tag in ((None, tag), (ref, None)):
            with self.assertRaises(RC.ContractError):
                RC.classify_tag_state(200, changed_ref, changed_tag, **self.tag_expected())
        with self.assertRaises(RC.ContractError):
            RC.classify_tag_state(404, ref, tag, **self.tag_expected())
        with self.assertRaises(RC.ContractError):
            RC.classify_release_state(
                404,
                self.release(),
                tag=self.TAG,
                title=f"naranjo.online {self.TAG}",
                body="exact notes",
                manifest=self.manifest(),
            )

    def test_exact_shell_state_assertions_kill_deletion_and_inversion_mutants(self):
        for state in ("absent", "prepared", "staged", "exact"):
            self.assertEqual(RC.require_publication_state(state, state), state)
        for actual, required in (
            ("absent", "staged"),
            ("prepared", "staged"),
            ("staged", "exact"),
            ("exact", "absent"),
            ("foreign", "exact"),
        ):
            with self.subTest(actual=actual, required=required), self.assertRaises(RC.ContractError):
                RC.require_publication_state(actual, required)

    def test_cli_require_flag_is_load_bearing_for_tag_and_release_transactions(self):
        def invoke(arguments: list[str]) -> int:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                return RC.main(arguments)

        tag_args = [
            "tag-state",
            "--http-status",
            "404",
            "--tag",
            self.TAG,
            "--source-sha",
            self.SOURCE,
            "--message",
            self.MESSAGE,
            "--tagger-name",
            "github-actions[bot]",
            "--tagger-email",
            "41898282+github-actions[bot]@users.noreply.github.com",
            "--tagger-date",
            self.DATE,
        ]
        self.assertEqual(invoke([*tag_args, "--require", "absent"]), 0)
        self.assertEqual(invoke([*tag_args, "--require", "exact"]), 1)

        with tempfile.TemporaryDirectory() as temporary:
            notes = Path(temporary) / "notes.md"
            notes.write_text("exact notes\n", encoding="utf-8")
            manifest = Path(temporary) / "manifest.json"
            manifest.write_bytes(self.manifest())
            release_args = [
                "release-state",
                "--http-status",
                "404",
                "--tag",
                self.TAG,
                "--title",
                f"naranjo.online {self.TAG}",
                "--body",
                str(notes),
                "--manifest",
                str(manifest),
            ]
            self.assertEqual(invoke([*release_args, "--require", "absent"]), 0)
            self.assertEqual(invoke([*release_args, "--require", "exact"]), 1)


class AttestationSetTests(unittest.TestCase):
    IMAGE = "ghcr.io/owner/site"
    DIGEST = "sha256:" + "d" * 64
    SOURCE = "https://github.com/owner/site"
    REVISION = "a" * 40
    PLATFORMS = ("linux/amd64", "linux/arm64")

    def expected(self) -> dict[str, dict[str, object]]:
        return {
            platform: RC.build_attestation_statement(
                embedded_predicate(self.SOURCE, self.REVISION, platform),
                image=self.IMAGE,
                digest=self.DIGEST,
                source=self.SOURCE,
                revision=self.REVISION,
                platform=platform,
            )
            for platform in self.PLATFORMS
        }

    def encode(self, statements) -> str:
        return "\n".join(json.dumps(verified_record(statement)) for statement in statements)

    def test_exact_authenticated_subject_predicate_and_platform_set(self):
        expected = self.expected()
        self.assertEqual(RC.validate_attestation_set(self.encode(expected.values()), expected), 2)

    def test_authentic_plus_foreign_missing_duplicate_and_inverted_bindings_fail(self):
        expected = self.expected()
        amd = expected["linux/amd64"]
        foreign = copy.deepcopy(expected["linux/arm64"])
        foreign["predicate"]["buildDefinition"]["internalParameters"]["release"]["source"] = "https://github.com/attacker/site"
        wrong_subject = copy.deepcopy(expected["linux/arm64"])
        wrong_subject["subject"][0]["digest"]["sha256"] = "e" * 64
        wrong_type = copy.deepcopy(expected["linux/arm64"])
        wrong_type["predicateType"] = "https://example.invalid/foreign"
        for statements in (
            [amd],
            [amd, amd],
            [amd, foreign],
            [amd, wrong_subject],
            [amd, wrong_type],
            [*expected.values(), foreign],
        ):
            with self.subTest(count=len(statements)), self.assertRaises(RC.ContractError):
                RC.validate_attestation_set(self.encode(statements), expected)

    def test_embedded_source_revision_builder_and_reserved_binding_mutants_fail(self):
        base = embedded_predicate(self.SOURCE, self.REVISION, "linux/amd64")
        mutations = []
        for path, value in (
            (("runDetails", "builder", "id"), "https://github.com/attacker/site/actions/runs/1"),
            (("runDetails", "metadata", "buildkit_metadata", "vcs", "source"), "https://github.com/attacker/site"),
            (("runDetails", "metadata", "buildkit_metadata", "vcs", "revision"), "b" * 40),
            (("buildDefinition", "internalParameters", "release"), {"platform": "linux/amd64"}),
        ):
            changed = copy.deepcopy(base)
            parent = changed
            for key in path[:-1]:
                parent = parent[key]
            parent[path[-1]] = value
            mutations.append(changed)
        for index, predicate in enumerate(mutations):
            with self.subTest(index=index), self.assertRaises(RC.ContractError):
                RC.build_attestation_statement(
                    predicate,
                    image=self.IMAGE,
                    digest=self.DIGEST,
                    source=self.SOURCE,
                    revision=self.REVISION,
                    platform="linux/amd64",
                )


class GitTransitionTests(unittest.TestCase):
    def git(self, root: Path, *args: str) -> str:
        return subprocess.run(["git", "-C", str(root), *args], check=True, text=True, stdout=subprocess.PIPE).stdout.strip()

    def commit(self, root: Path, version: str) -> str:
        files = snapshot(version)
        for name, contents in files.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(contents, encoding="utf-8")
        self.git(root, "add", ".")
        self.git(root, "-c", "user.name=Release Test", "-c", "user.email=release@example.invalid", "commit", "-m", version)
        return self.git(root, "rev-parse", "HEAD")

    def metadata_commit(self, root: Path, marker: str) -> str:
        (root / "README.md").write_text(marker + "\n", encoding="utf-8")
        self.git(root, "add", "README.md")
        self.git(root, "-c", "user.name=Release Test", "-c", "user.email=release@example.invalid", "commit", "-m", marker)
        return self.git(root, "rev-parse", "HEAD")

    def remove_version(self, root: Path, marker: str) -> str:
        (root / "VERSION").unlink()
        self.git(root, "add", "-u", "VERSION")
        self.git(
            root,
            "-c",
            "user.name=Release Test",
            "-c",
            "user.email=release@example.invalid",
            "commit",
            "-m",
            marker,
        )
        return self.git(root, "rev-parse", "HEAD")

    def test_three_sequential_main_commits_and_stale_base_rejection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.git(root, "init", "-q")
            self.git(root, "branch", "-m", "main")
            commits = [self.commit(root, version) for version in ("0.1.9", "0.1.10", "0.1.11", "0.1.12")]
            for index in range(1, len(commits)):
                intent = RC.validate_transition(root, commits[index - 1], commits[index], first_parent=True)
                self.assertEqual(intent.tag, f"v0.1.{9 + index}")
            with self.assertRaises(RC.ContractError):
                RC.validate_transition(root, commits[1], commits[3], first_parent=True)
            with self.assertRaises(RC.ContractError):
                RC.validate_transition(root, commits[2], commits[1], first_parent=True)

            # GitHub's enabled rebase merge can land several linear commits in
            # one push. The exact base -> final-tree patch step is the release
            # intent even when an earlier commit in the same atomic push has
            # not updated the locks yet; the final SHA is the one released.
            self.git(root, "checkout", "-q", "-b", "rebase-range", commits[0])
            intermediate = self.metadata_commit(root, "unreleased change")
            final_head = self.commit(root, "0.1.10")
            intent = RC.validate_transition(root, commits[0], final_head, first_parent=True)
            self.assertEqual(intent, RC.ReleaseIntent(final_head, RC.Version.parse("0.1.10")))
            window = RC.discover_transition_window(root, final_head)
            self.assertEqual(window.base_sha, intermediate)
            self.assertEqual(window.intent, intent)
            self.assertNotEqual(intermediate, final_head)

            # A later metadata commit that preserves the final release locks
            # is also one exact rebase-merge intent and remains discoverable.
            preserved_head = self.metadata_commit(root, "post-bump repair")
            preserved = RC.validate_transition(root, commits[0], preserved_head, first_parent=True)
            self.assertEqual(preserved, RC.ReleaseIntent(preserved_head, RC.Version.parse("0.1.10")))
            preserved_window = RC.discover_transition_window(root, preserved_head)
            self.assertEqual(preserved_window.base_sha, intermediate)
            self.assertEqual(preserved_window.intent, preserved)

            # A second patch in the same integration would collapse two
            # release intents into one tag and is rejected at the endpoint.
            self.git(root, "checkout", "-q", "-b", "double-bump", commits[0])
            self.commit(root, "0.1.10")
            double_head = self.commit(root, "0.1.11")
            with self.assertRaises(RC.ContractError):
                RC.validate_transition(root, commits[0], double_head, first_parent=True)

            self.git(root, "checkout", "-q", "-b", "stale", commits[0])
            stale_head = self.commit(root, "0.1.12")
            with self.assertRaises(RC.ContractError):
                RC.validate_transition(root, commits[2], stale_head, first_parent=False)

    def test_real_two_parent_commit_is_denied_in_pr_and_main_modes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.git(root, "init", "-q")
            self.git(root, "branch", "-m", "main")
            base = self.commit(root, "0.1.9")
            self.git(root, "checkout", "-q", "-b", "topic", base)
            self.commit(root, "0.1.10")
            self.git(root, "checkout", "-q", "main")
            self.metadata_commit(root, "independent main change")
            self.git(
                root,
                "-c",
                "user.name=Release Test",
                "-c",
                "user.email=release@example.invalid",
                "merge",
                "--no-ff",
                "topic",
                "-m",
                "two-parent mutant",
            )
            merge_head = self.git(root, "rev-parse", "HEAD")
            self.assertEqual(
                len(self.git(root, "rev-list", "--parents", "-n", "1", merge_head).split()),
                3,
            )
            for first_parent in (False, True):
                with self.subTest(first_parent=first_parent), self.assertRaises(RC.ContractError):
                    RC.validate_transition(root, base, merge_head, first_parent=first_parent)

    def test_every_intermediate_version_state_is_load_bearing(self):
        builders = (
            lambda root: (
                self.commit(root, "0.1.11"),
                self.commit(root, "0.1.9"),
                self.commit(root, "0.1.10"),
            )[-1],
            lambda root: (
                self.commit(root, "0.1.10"),
                self.commit(root, "0.1.9"),
                self.commit(root, "0.1.10"),
            )[-1],
            lambda root: (
                self.remove_version(root, "delete VERSION transiently"),
                self.commit(root, "0.1.10"),
            )[-1],
        )
        for index, build in enumerate(builders):
            with self.subTest(history_mutant=index), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                self.git(root, "init", "-q")
                self.git(root, "branch", "-m", "main")
                base = self.commit(root, "0.1.9")
                head = build(root)
                for first_parent in (False, True):
                    with self.assertRaises(RC.ContractError):
                        RC.validate_transition(root, base, head, first_parent=first_parent)
                with self.assertRaises(RC.ContractError):
                    RC.discover_transition_window(root, head)

    def test_clean_endpoint_range_cannot_hide_a_poisoned_history_prefix(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.git(root, "init", "-q")
            self.git(root, "branch", "-m", "main")
            self.commit(root, "0.1.9")
            self.commit(root, "0.1.10")
            base = self.commit(root, "0.1.9")
            head = self.commit(root, "0.1.10")
            for first_parent in (False, True):
                with self.assertRaises(RC.ContractError):
                    RC.validate_transition(root, base, head, first_parent=first_parent)
            with self.assertRaises(RC.ContractError):
                RC.discover_transition_window(root, head)


class ExistingImageShellPathTests(unittest.TestCase):
    @staticmethod
    def workflow_run_block(step_name: str) -> str:
        lines = (ROOT / ".github" / "workflows" / "release-publisher.yml").read_text(
            encoding="utf-8"
        ).splitlines()
        marker = f"      - name: {step_name}"
        try:
            start = lines.index(marker)
            run = lines.index("        run: |", start)
        except ValueError as exc:
            raise AssertionError(f"workflow step is missing: {step_name}") from exc
        body: list[str] = []
        for line in lines[run + 1 :]:
            if line.startswith("      - name:"):
                break
            if line.startswith("          "):
                body.append(line[10:])
            elif not line:
                body.append("")
            else:
                break
        if not body:
            raise AssertionError(f"workflow step has no executable run block: {step_name}")
        return "\n".join(body) + "\n"

    @staticmethod
    def bash_executable() -> str:
        discovered = shutil.which("bash")
        if discovered:
            return discovered
        if os.name == "nt":
            candidate = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git" / "bin" / "bash.exe"
            if candidate.is_file():
                return str(candidate)
        raise AssertionError("bash is required to execute the release workflow shell path")

    @staticmethod
    def bash_path(path: str) -> str:
        normalized = Path(path).resolve().as_posix()
        if len(normalized) >= 3 and normalized[1:3] == ":/":
            return f"/{normalized[0].lower()}/{normalized[3:]}"
        return normalized

    def execute(self, block: str) -> tuple[subprocess.CompletedProcess[str], str]:
        source = "https://github.com/owner/site"
        revision = "a" * 40
        with tempfile.TemporaryDirectory(dir=ROOT, prefix=".release-shell-") as temporary:
            runner = Path(temporary)
            runner_relative = runner.relative_to(ROOT).as_posix()
            sbom_fixture = sbom_registry_fixture()
            (runner / "registry-index.json").write_bytes(sbom_fixture["index"])
            sbom_environment: dict[str, str] = {}
            for architecture in ("amd64", "arm64"):
                platform = f"linux/{architecture}"
                (runner / f"registry-attestation-{architecture}.json").write_bytes(
                    sbom_fixture["attestation_manifests"][platform]
                )
                (runner / f"registry-sbom-{architecture}.json").write_bytes(
                    sbom_fixture["statements"][platform]
                )
                sbom_environment[f"{architecture.upper()}_ATTESTATION_DIGEST"] = (
                    sbom_fixture["attestation_digests"][platform]
                )
                sbom_environment[f"{architecture.upper()}_SBOM_LAYER_DIGEST"] = (
                    "sha256:"
                    + hashlib.sha256(sbom_fixture["statements"][platform]).hexdigest()
                )
            for architecture in ("amd64", "arm64"):
                predicate = embedded_predicate(source, revision, f"linux/{architecture}")
                (runner / f"fixture-{architecture}.json").write_text(
                    json.dumps(predicate), encoding="utf-8"
                )
            output = runner / "github-output.txt"
            prelude = r'''
python3() {
  "${TEST_PYTHON}" "$@"
}

jq() {
  local expression='' input='' platform=''
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --arg)
        if [ "$2" = platform ]; then platform="$3"; fi
        shift 3
        ;;
      -*) shift ;;
      *)
        if [ -z "${expression}" ]; then
          expression="$1"
        else
          input="$1"
        fi
        shift
        ;;
    esac
  done
  case "${expression}" in
    '.token // .access_token')
      "${TEST_PYTHON}" -c 'import json,sys; value=json.load(open(sys.argv[1], encoding="utf-8")); print(value.get("token") or value["access_token"])' "${input}"
      ;;
    'keys[]')
      "${TEST_PYTHON}" -c 'import json,sys; value=json.load(open(sys.argv[1], encoding="utf-8")); sys.stdout.buffer.write(("\n".join(value.keys())+"\n").encode("utf-8"))' "${input}"
      ;;
    '.[$platform].subject_digest'|'.[$platform].attestation_digest')
      "${TEST_PYTHON}" -c 'import json,sys; value=json.load(open(sys.argv[1], encoding="utf-8")); field=sys.argv[3].rsplit(".",1)[-1]; print(value[sys.argv[2]][field])' "${input}" "${platform}" "${expression}"
      ;;
    *) return 2 ;;
  esac
}

curl() {
  local all="$*" output='' headers='' url="${!#}"
  if [[ "${all}" == *'https://ghcr.io/token'* ]]; then
    printf '{"token":"fixture-token"}'
    return 0
  fi
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --output) output="$2"; shift 2 ;;
      --dump-header) headers="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  case "${url}" in
    *"/blobs/${AMD64_SBOM_LAYER_DIGEST}")
      cp "${RUNNER_TEMP}/registry-sbom-amd64.json" "${output}"
      return 0
      ;;
    *"/blobs/${ARM64_SBOM_LAYER_DIGEST}")
      cp "${RUNNER_TEMP}/registry-sbom-arm64.json" "${output}"
      return 0
      ;;
    *"/manifests/${AMD64_ATTESTATION_DIGEST}")
      cp "${RUNNER_TEMP}/registry-attestation-amd64.json" "${output}"
      ;;
    *"/manifests/${ARM64_ATTESTATION_DIGEST}")
      cp "${RUNNER_TEMP}/registry-attestation-arm64.json" "${output}"
      ;;
    *) cp "${RUNNER_TEMP}/registry-index.json" "${output}" ;;
  esac
  local digest
  digest="$(sha256sum "${output}" | awk '{print $1}')"
  printf 'docker-content-digest: sha256:%s\r\n' "${digest}" > "${headers}"
  printf '200'
}

docker() {
  case "$*" in
    *linux/amd64*) cat "${RUNNER_TEMP}/fixture-amd64.json" ;;
    *linux/arm64*) cat "${RUNNER_TEMP}/fixture-arm64.json" ;;
    *'.Provenance'*) printf '{"linux/amd64":{},"linux/arm64":{}}' ;;
    *'.SBOM'*) printf '{"linux/amd64":{},"linux/arm64":{}}' ;;
    *) return 2 ;;
  esac
}

cosign() {
  case "$1" in
    verify) return 0 ;;
    verify-attestation)
      "${TEST_PYTHON}" -c 'import base64,json,sys; [print(json.dumps({"payload":base64.b64encode(open(path,"rb").read()).decode("ascii")})) for path in sys.argv[1:]]' \
        "${RUNNER_TEMP}/existing-linux-amd64.statement.json" \
        "${RUNNER_TEMP}/existing-linux-arm64.statement.json"
      ;;
    *) return 2 ;;
  esac
}
'''
            environment = os.environ.copy()
            environment.update(
                {
                    "TEST_PYTHON": self.bash_path(sys.executable),
                    "RUNNER_TEMP": runner_relative,
                    "GITHUB_OUTPUT": f"{runner_relative}/github-output.txt",
                    "GITHUB_ACTOR": "release-fixture",
                    "GHCR_PASSWORD": "fixture-password",
                    "GITHUB_SERVER_URL": "https://github.com",
                    "GITHUB_REPOSITORY": "owner/site",
                    "SOURCE_SHA": revision,
                    "GITHUB_REF": "refs/tags/v0.1.10",
                    "IMAGE": "ghcr.io/owner/site",
                    "TAG": "v0.1.10",
                }
            )
            environment.update(sbom_environment)
            completed = subprocess.run(
                [self.bash_executable()],
                cwd=ROOT,
                env=environment,
                check=False,
                input=prelude + "\n" + block,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                timeout=30,
            )
            return completed, output.read_text(encoding="utf-8") if output.exists() else ""

    def test_actual_complete_image_retry_path_uses_validated_logical_count(self):
        block = self.workflow_run_block("Classify an absent, complete, or burned image tag")
        completed, output = self.execute(block)
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertIn("existing image state: complete", completed.stdout)
        self.assertIn("state=complete\n", output)
        self.assertRegex(output, r"digest=sha256:[0-9a-f]{64}\n")

        assignment = 'verified_count="${validated_count}"'
        self.assertIn(assignment, block)
        mutants = (
            block.replace(assignment, "", 1),
            block.replace(assignment, 'verified_count="${#expected_attestations[@]}"', 1),
        )
        for index, mutant in enumerate(mutants):
            with self.subTest(count_mutant=index):
                killed, _output = self.execute(mutant)
                self.assertNotEqual(killed.returncode, 0, killed.stdout + killed.stderr)
                self.assertIn("existing image state: burned", killed.stdout)


class MainAndCodeQLAuthorizationShellPathTests(unittest.TestCase):
    STEP = "Bind dispatch to one successful protected-main PR gate"
    SHA = "a" * 40

    @staticmethod
    def require_workflow_contract(gate: str, publisher: str) -> None:
        security = gate.split("\n  security:\n", 1)[1].split("\n  dependency-review:\n", 1)[0]
        dependency = gate.split("\n  dependency-review:\n", 1)[1].split(
            "\n  application:\n", 1
        )[0]
        if re.search(r"(?m)^    if:", security):
            raise ValueError("security main job may not be conditionally skipped")
        if "if: github.event_name == 'pull_request'" not in dependency:
            raise ValueError("dependency-review must be skipped only outside pull requests")
        for required in (
            "main-jobs-record",
            "codeql-run-record",
            "codeql-jobs-record",
            "actions/workflows/codeql.yml/runs",
            "head_sha=\"${SOURCE_SHA}\"",
            "for attempt in {1..36}",
            "sleep 15",
            "jobs?filter=latest&per_page=100",
        ):
            if required not in publisher:
                raise ValueError(f"exact main/CodeQL authorization lost: {required}")

    def execute(
        self,
        block: str,
        *,
        main_jobs: dict[str, object] | None = None,
        codeql_run: dict[str, object] | None = None,
        codeql_jobs: dict[str, object] | None = None,
        pending_attempts: int = 0,
    ) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory(dir=ROOT, prefix=".authorize-shell-") as temporary:
            runner = Path(temporary)
            runner_relative = runner.relative_to(ROOT).as_posix()
            pending = codeql_run_record(self.SHA)
            pending["workflow_runs"][0]["status"] = "in_progress"
            pending["workflow_runs"][0]["conclusion"] = None
            fixtures = {
                "main-run.json": main_run_record(self.SHA),
                "main-jobs.json": main_jobs or main_jobs_record(self.SHA),
                "codeql-run.json": codeql_run or codeql_run_record(self.SHA),
                "codeql-pending.json": pending,
                "codeql-jobs.json": codeql_jobs or codeql_jobs_record(self.SHA),
            }
            for name, record in fixtures.items():
                (runner / name).write_text(json.dumps(record), encoding="utf-8")
            block = block.replace(
                "authority/scripts/ci/release_contract.py", "scripts/ci/release_contract.py"
            )
            prelude = r'''
python3() {
  "${TEST_PYTHON}" "$@"
}

sleep() { :; }

gh() {
  local all="$*" count
  case "${all}" in
    *'/actions/runs/123/jobs?'*) cat "${RUNNER_TEMP}/main-jobs.json" ;;
    *'/actions/runs/123') cat "${RUNNER_TEMP}/main-run.json" ;;
    *'/actions/workflows/codeql.yml/runs'*)
      count=0
      if [ -f "${RUNNER_TEMP}/codeql-count" ]; then count="$(<"${RUNNER_TEMP}/codeql-count")"; fi
      count=$((count + 1))
      printf '%s\n' "${count}" > "${RUNNER_TEMP}/codeql-count"
      if [ "${count}" -le "${PENDING_ATTEMPTS}" ]; then
        cat "${RUNNER_TEMP}/codeql-pending.json"
      else
        cat "${RUNNER_TEMP}/codeql-run.json"
      fi
      ;;
    *'/actions/runs/456/jobs?'*) cat "${RUNNER_TEMP}/codeql-jobs.json" ;;
    *) return 2 ;;
  esac
}
'''
            environment = os.environ.copy()
            environment.update(
                {
                    "TEST_PYTHON": ExistingImageShellPathTests.bash_path(sys.executable),
                    "RUNNER_TEMP": runner_relative,
                    "GITHUB_OUTPUT": f"{runner_relative}/github-output.txt",
                    "GITHUB_REPOSITORY": "owner/site",
                    "MAIN_RUN_ID": "123",
                    "SOURCE_SHA": self.SHA,
                    "PENDING_ATTEMPTS": str(pending_attempts),
                }
            )
            return subprocess.run(
                [ExistingImageShellPathTests.bash_executable()],
                cwd=ROOT,
                env=environment,
                check=False,
                input=prelude + "\n" + block,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                timeout=30,
            )

    def test_exact_and_slow_exact_source_authorization_paths_pass(self):
        block = ExistingImageShellPathTests.workflow_run_block(self.STEP)
        for pending_attempts in (0, 3):
            completed = self.execute(block, pending_attempts=pending_attempts)
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)

    def test_absent_failed_skipped_wrong_sha_duplicate_and_foreign_api_fixtures_fail(self):
        block = ExistingImageShellPathTests.workflow_run_block(self.STEP)
        absent = {"total_count": 0, "workflow_runs": []}
        failed = codeql_run_record(self.SHA)
        failed["workflow_runs"][0]["conclusion"] = "failure"
        wrong_sha = codeql_run_record(self.SHA)
        wrong_sha["workflow_runs"][0]["head_sha"] = "b" * 40
        duplicate = codeql_run_record(self.SHA)
        duplicate["workflow_runs"].append(copy.deepcopy(duplicate["workflow_runs"][0]))
        duplicate["total_count"] = 2
        skipped_jobs = codeql_jobs_record(self.SHA)
        skipped_jobs["jobs"][0]["conclusion"] = "skipped"
        foreign_jobs = codeql_jobs_record(self.SHA)
        foreign_jobs["jobs"].append(copy.deepcopy(foreign_jobs["jobs"][0]))
        foreign_jobs["jobs"][-1]["id"] = 99
        foreign_jobs["jobs"][-1]["name"] = "foreign"
        foreign_jobs["total_count"] = 3
        skipped_security = main_jobs_record(self.SHA)
        next(job for job in skipped_security["jobs"] if job["name"] == "security")[
            "conclusion"
        ] = "skipped"
        cases = (
            {"codeql_run": absent},
            {"codeql_run": failed},
            {"codeql_run": wrong_sha},
            {"codeql_run": duplicate},
            {"codeql_jobs": skipped_jobs},
            {"codeql_jobs": foreign_jobs},
            {"main_jobs": skipped_security},
        )
        for index, kwargs in enumerate(cases):
            with self.subTest(api_mutant=index):
                completed = self.execute(block, **kwargs)
                self.assertNotEqual(completed.returncode, 0)

    def test_if_false_and_authorization_deletion_mutants_are_killed(self):
        gate = (ROOT / ".github/workflows/pr-gate.yml").read_text(encoding="utf-8")
        publisher = (ROOT / ".github/workflows/release-publisher.yml").read_text(
            encoding="utf-8"
        )
        self.require_workflow_contract(gate, publisher)
        mutants = (
            (gate.replace("  security:\n", "  security:\n    if: false\n", 1), publisher),
            (gate, publisher.replace("main-jobs-record", "deleted-main-jobs", 1)),
            (gate, publisher.replace("codeql-run-record", "deleted-codeql-run", 1)),
            (gate, publisher.replace("codeql-jobs-record", "deleted-codeql-jobs", 1)),
            (gate, publisher.replace('head_sha="${SOURCE_SHA}"', 'head_sha="foreign"', 1)),
            (gate, publisher.replace("for attempt in {1..36}", "for attempt in 1", 1)),
        )
        for index, (mutant_gate, mutant_publisher) in enumerate(mutants):
            with self.subTest(static_mutant=index), self.assertRaises(ValueError):
                self.require_workflow_contract(mutant_gate, mutant_publisher)


class RegistryAliasRebindShellPathTests(unittest.TestCase):
    STEP = "Re-bind both public aliases and exact platform SBOMs before sealing evidence"

    @staticmethod
    def require_step_contract(block: str) -> None:
        for required in (
            'fetch_exact_alias "${image_repository}" "${IMAGE_ALIAS}"',
            'image "${IMAGE_DIGEST}" "${image_token}"',
            'fetch_exact_alias "${chart_repository}" "${CHART_ALIAS}"',
            'chart "${CHART_DIGEST}" "${chart_token}"',
            "for attempt in 1 2 3 4 5",
            'test "${observed}" = "${expected}"',
            "sbom-index-record",
            "sbom-layer-record",
            "sbom-statement",
            "for platform in linux/amd64 linux/arm64",
        ):
            if required not in block:
                raise ValueError(f"post-push alias/SBOM binding lost: {required}")

    def execute(
        self,
        block: str,
        *,
        image_state: str = "exact",
        chart_state: str = "exact",
    ) -> subprocess.CompletedProcess[str]:
        fixture = sbom_registry_fixture()
        with tempfile.TemporaryDirectory(dir=ROOT, prefix=".alias-shell-") as temporary:
            runner = Path(temporary)
            runner_relative = runner.relative_to(ROOT).as_posix()
            (runner / "registry-index.json").write_bytes(fixture["index"])
            chart_bytes = b'{"schemaVersion":2,"artifact":"chart"}'
            foreign_bytes = b'{"schemaVersion":2,"artifact":"foreign"}'
            (runner / "registry-chart.json").write_bytes(chart_bytes)
            (runner / "registry-foreign.json").write_bytes(foreign_bytes)
            environment = os.environ.copy()
            environment.update(
                {
                    "TEST_PYTHON": ExistingImageShellPathTests.bash_path(sys.executable),
                    "RUNNER_TEMP": runner_relative,
                    "GITHUB_ACTOR": "release-fixture",
                    "GHCR_PASSWORD": "fixture-password",
                    "IMAGE": "ghcr.io/owner/site",
                    "CHART": "ghcr.io/owner/charts/site",
                    "IMAGE_ALIAS": "v0.1.10",
                    "CHART_ALIAS": "0.1.10",
                    "IMAGE_DIGEST": fixture["image_digest"],
                    "CHART_DIGEST": "sha256:" + hashlib.sha256(chart_bytes).hexdigest(),
                    "IMAGE_ALIAS_STATE": image_state,
                    "CHART_ALIAS_STATE": chart_state,
                }
            )
            for architecture in ("amd64", "arm64"):
                platform = f"linux/{architecture}"
                (runner / f"registry-attestation-{architecture}.json").write_bytes(
                    fixture["attestation_manifests"][platform]
                )
                (runner / f"registry-sbom-{architecture}.json").write_bytes(
                    fixture["statements"][platform]
                )
                environment[f"{architecture.upper()}_ATTESTATION_DIGEST"] = fixture[
                    "attestation_digests"
                ][platform]
                environment[f"{architecture.upper()}_SBOM_LAYER_DIGEST"] = (
                    "sha256:" + hashlib.sha256(fixture["statements"][platform]).hexdigest()
                )
            prelude = r'''
python3() {
  "${TEST_PYTHON}" "$@"
}

jq() {
  local expression='' input='' platform=''
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --arg)
        if [ "$2" = platform ]; then platform="$3"; fi
        shift 3
        ;;
      -*) shift ;;
      *)
        if [ -z "${expression}" ]; then expression="$1"; else input="$1"; fi
        shift
        ;;
    esac
  done
  case "${expression}" in
    '.token // .access_token')
      "${TEST_PYTHON}" -c 'import json,sys; value=json.load(open(sys.argv[1], encoding="utf-8")); print(value.get("token") or value["access_token"])' "${input}"
      ;;
    '.[$platform].subject_digest'|'.[$platform].attestation_digest')
      "${TEST_PYTHON}" -c 'import json,sys; value=json.load(open(sys.argv[1], encoding="utf-8")); field=sys.argv[3].rsplit(".",1)[-1]; print(value[sys.argv[2]][field])' "${input}" "${platform}" "${expression}"
      ;;
    *) return 2 ;;
  esac
}

sleep() { :; }

serve_manifest() {
  local source="$1" output="$2" headers="$3" digest
  cp "${source}" "${output}"
  digest="$(sha256sum "${output}" | awk '{print $1}')"
  printf 'docker-content-digest: sha256:%s\r\n' "${digest}" > "${headers}"
  printf '200'
}

curl() {
  local all="$*" output='' headers='' url="${!#}"
  if [[ "${all}" == *'https://ghcr.io/token'* ]]; then
    printf '{"token":"fixture-token"}'
    return 0
  fi
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --output) output="$2"; shift 2 ;;
      --dump-header) headers="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  case "${url}" in
    *"/blobs/${AMD64_SBOM_LAYER_DIGEST}") cp "${RUNNER_TEMP}/registry-sbom-amd64.json" "${output}" ;;
    *"/blobs/${ARM64_SBOM_LAYER_DIGEST}") cp "${RUNNER_TEMP}/registry-sbom-arm64.json" "${output}" ;;
    *"/manifests/${AMD64_ATTESTATION_DIGEST}") serve_manifest "${RUNNER_TEMP}/registry-attestation-amd64.json" "${output}" "${headers}" ;;
    *"/manifests/${ARM64_ATTESTATION_DIGEST}") serve_manifest "${RUNNER_TEMP}/registry-attestation-arm64.json" "${output}" "${headers}" ;;
    *'/owner/site/manifests/v0.1.10')
      if [ "${IMAGE_ALIAS_STATE}" = absent ]; then : > "${output}"; : > "${headers}"; printf '404'
      elif [ "${IMAGE_ALIAS_STATE}" = retarget ]; then serve_manifest "${RUNNER_TEMP}/registry-foreign.json" "${output}" "${headers}"
      else serve_manifest "${RUNNER_TEMP}/registry-index.json" "${output}" "${headers}"
      fi
      ;;
    *'/owner/charts/site/manifests/0.1.10')
      if [ "${CHART_ALIAS_STATE}" = absent ]; then : > "${output}"; : > "${headers}"; printf '404'
      elif [ "${CHART_ALIAS_STATE}" = retarget ]; then serve_manifest "${RUNNER_TEMP}/registry-foreign.json" "${output}" "${headers}"
      else serve_manifest "${RUNNER_TEMP}/registry-chart.json" "${output}" "${headers}"
      fi
      ;;
    *) : > "${output}"; if [ -n "${headers}" ]; then : > "${headers}"; fi; printf '500' ;;
  esac
}
'''
            return subprocess.run(
                [ExistingImageShellPathTests.bash_executable()],
                cwd=ROOT,
                env=environment,
                check=False,
                input=prelude + "\n" + block,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                timeout=30,
            )

    def test_actual_post_push_image_chart_alias_and_sbom_path_is_exact(self):
        block = ExistingImageShellPathTests.workflow_run_block(self.STEP)
        self.require_step_contract(block)
        completed = self.execute(block)
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)

    def test_deleted_retargeted_and_foreign_aliases_are_executable_denials(self):
        block = ExistingImageShellPathTests.workflow_run_block(self.STEP)
        for image_state, chart_state in (
            ("absent", "exact"),
            ("retarget", "exact"),
            ("exact", "absent"),
            ("exact", "retarget"),
        ):
            with self.subTest(image=image_state, chart=chart_state):
                completed = self.execute(
                    block, image_state=image_state, chart_state=chart_state
                )
                self.assertNotEqual(completed.returncode, 0)
        for mutant in (
            block.replace(
                '"${image_repository}" "${IMAGE_ALIAS}"',
                '"${image_repository}" "${CHART_ALIAS}"',
                1,
            ),
            block.replace(
                '"${chart_repository}" "${CHART_ALIAS}"',
                '"${chart_repository}" "${IMAGE_ALIAS}"',
                1,
            ),
        ):
            completed = self.execute(mutant)
            self.assertNotEqual(completed.returncode, 0)

    def test_deletion_inversion_and_digest_mutants_are_killed_structurally(self):
        block = ExistingImageShellPathTests.workflow_run_block(self.STEP)
        mutants = (
            block.replace(
                'fetch_exact_alias "${image_repository}" "${IMAGE_ALIAS}"',
                'true # deleted image alias check',
                1,
            ),
            block.replace(
                'fetch_exact_alias "${chart_repository}" "${CHART_ALIAS}"',
                'true # deleted chart alias check',
                1,
            ),
            block.replace('test "${observed}" = "${expected}"', "true", 1),
            block.replace('"${IMAGE_ALIAS}"', '"${CHART_ALIAS}"', 1),
            block.replace('"${CHART_ALIAS}"', '"${IMAGE_ALIAS}"', 1),
            block.replace('image "${IMAGE_DIGEST}"', 'image "${CHART_DIGEST}"', 1),
            block.replace('chart "${CHART_DIGEST}"', 'chart "${IMAGE_DIGEST}"', 1),
        )
        for index, mutant in enumerate(mutants):
            with self.subTest(static_mutant=index), self.assertRaises(ValueError):
                self.require_step_contract(mutant)


class TerminalTagRebindShellPathTests(unittest.TestCase):
    SOURCE = "a" * 40
    MOVED_SOURCE = "c" * 40
    TAG_OBJECT = "b" * 40
    TAG = "v0.1.10"
    DATE = "2026-08-13T15:21:32Z"

    def execute(self, block: str, *, target: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory(dir=ROOT, prefix=".terminal-tag-shell-") as temporary:
            runner = Path(temporary)
            runner_relative = runner.relative_to(ROOT).as_posix()
            manifest_record = exact_release_manifest(source=self.SOURCE)
            manifest = canonical_manifest_bytes(manifest_record)
            manifest_name = f"naranjo-online-{self.TAG}-release-manifest.json"
            manifest_path = runner / manifest_name
            manifest_path.write_bytes(manifest)
            notes = RC.build_release_notes(manifest_record)
            (runner / "release-notes.md").write_text(notes, encoding="utf-8")
            (runner / "release-fixture.json").write_text(
                json.dumps(exact_release_record(manifest, tag=self.TAG, body=notes)),
                encoding="utf-8",
            )
            block = block.replace(
                "${{ steps.manifest.outputs.path }}", f"{runner_relative}/{manifest_name}"
            ).replace("${{ steps.manifest.outputs.name }}", manifest_name)
            prelude = r'''
python3() {
  "${TEST_PYTHON}" "$@"
}

jq() {
  local all="$*"
  case "${all}" in
    *'.object.sha'*) printf '%s\n' "${TAG_OBJECT_SHA}" ;;
    *'.assets | select(length == 1)'*) printf '%s\n' 'https://api.github.test/assets/1' ;;
    *) return 2 ;;
  esac
}

curl() {
  local all="$*" output=''
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --output) output="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  case "${all}" in
    *'/releases/tags/'*)
      cp "${RUNNER_TEMP}/release-fixture.json" "${output}"
      ;;
    *'api.github.test/assets/1'*)
      cp "${RUNNER_TEMP}/naranjo-online-v0.1.10-release-manifest.json" "${output}"
      return 0
      ;;
    *'/git/ref/tags/'*)
      printf '{"ref":"refs/tags/%s","object":{"type":"tag","sha":"%s"}}' \
        "${TAG}" "${TAG_OBJECT_SHA}" > "${output}"
      ;;
    *'/git/tags/'*)
      printf '{"sha":"%s","tag":"%s","message":"Release %s from %s","object":{"type":"commit","sha":"%s"},"tagger":{"name":"github-actions[bot]","email":"41898282+github-actions[bot]@users.noreply.github.com","date":"%s"}}' \
        "${TAG_OBJECT_SHA}" "${TAG}" "${TAG}" "${SOURCE_SHA}" \
        "${TAG_TARGET_SHA}" "${TAGGER_DATE}" > "${output}"
      ;;
    *) return 2 ;;
  esac
  printf '200'
}

git() {
  test "$1" = show
  printf '%s\n' "${TAGGER_DATE}"
}
'''
            environment = os.environ.copy()
            environment.update(
                {
                    "TEST_PYTHON": ExistingImageShellPathTests.bash_path(sys.executable),
                    "RUNNER_TEMP": runner_relative,
                    "GH_TOKEN": "fixture-token",
                    "GITHUB_API_URL": "https://api.github.com",
                    "GITHUB_REPOSITORY": RC.EXPECTED_REPOSITORY,
                    "SOURCE_SHA": self.SOURCE,
                    "TAG_TARGET_SHA": target,
                    "TAG_OBJECT_SHA": self.TAG_OBJECT,
                    "TAGGER_DATE": self.DATE,
                    "TAG": self.TAG,
                }
            )
            return subprocess.run(
                [ExistingImageShellPathTests.bash_executable(), "-c", prelude + "\n" + block],
                cwd=ROOT,
                env=environment,
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                timeout=30,
            )

    def execute_concurrent_winner_transaction(
        self, *, terminal_target: str
    ) -> subprocess.CompletedProcess[str]:
        initial = ExistingImageShellPathTests.workflow_run_block(
            "Create or verify the exact annotated tag"
        )
        release = ExistingImageShellPathTests.workflow_run_block(
            "Stage, verify, and publish the exact GitHub release"
        )
        terminal = ExistingImageShellPathTests.workflow_run_block(
            "Re-bind the immutable Release to the exact annotated tag"
        )
        with tempfile.TemporaryDirectory(dir=ROOT, prefix=".release-race-shell-") as temporary:
            runner = Path(temporary)
            runner_relative = runner.relative_to(ROOT).as_posix()
            manifest_record = RC.build_release_manifest(
                repository=RC.EXPECTED_REPOSITORY,
                source_sha=self.SOURCE,
                main_run_id=123,
                version="0.1.10",
                image=RC.EXPECTED_IMAGE,
                image_digest="sha256:" + "d" * 64,
                chart=RC.EXPECTED_CHART,
                chart_digest="sha256:" + "e" * 64,
            )
            manifest = canonical_manifest_bytes(manifest_record)
            manifest_name = f"naranjo-online-{self.TAG}-release-manifest.json"
            (runner / manifest_name).write_bytes(manifest)
            notes = RC.build_release_notes(manifest_record)
            (runner / "release-fixture.json").write_text(
                json.dumps(exact_release_record(manifest, tag=self.TAG, body=notes)),
                encoding="utf-8",
            )
            replacements = {
                "${{ steps.release.outputs.tag }}": self.TAG,
                "${{ steps.release.outputs.version }}": "0.1.10",
                "${{ steps.image.outputs.digest }}": "sha256:" + "d" * 64,
                "${{ steps.chart.outputs.digest }}": "sha256:" + "e" * 64,
                "${{ steps.manifest.outputs.path }}": f"{runner_relative}/{manifest_name}",
                "${{ steps.manifest.outputs.name }}": manifest_name,
            }
            for old, new in replacements.items():
                release = release.replace(old, new)
                terminal = terminal.replace(old, new)
            prelude = r'''
python3() {
  "${TEST_PYTHON}" "$@"
}

jq() {
  local all="$*"
  case "${all}" in
    *'.object.sha'*) printf '%s\n' "${TAG_OBJECT_SHA}" ;;
    *'.assets | select(length == 1)'*) printf '%s\n' 'https://api.github.test/assets/1' ;;
    *) return 2 ;;
  esac
}

curl() {
  local all="$*" output=''
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --output) output="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  case "${all}" in
    *'/releases/tags/'*)
      local release_count=0
      if [ -f "${RUNNER_TEMP}/release-count" ]; then
        release_count="$(<"${RUNNER_TEMP}/release-count")"
      fi
      release_count=$((release_count + 1))
      printf '%s\n' "${release_count}" > "${RUNNER_TEMP}/release-count"
      if [ "${release_count}" -le 2 ]; then
        printf '{}' > "${output}"
        printf '404'
      else
        cp "${RUNNER_TEMP}/release-fixture.json" "${output}"
        printf '200'
      fi
      ;;
    *'api.github.test/assets/1'*)
      cp "${RUNNER_TEMP}/naranjo-online-v0.1.10-release-manifest.json" "${output}"
      return 0
      ;;
    *'/git/ref/tags/'*)
      printf '{"ref":"refs/tags/%s","object":{"type":"tag","sha":"%s"}}' \
        "${TAG}" "${TAG_OBJECT_SHA}" > "${output}"
      printf '200'
      ;;
    *'/git/tags/'*)
      local object_count=0 target="${SOURCE_SHA}"
      if [ -f "${RUNNER_TEMP}/tag-object-count" ]; then
        object_count="$(<"${RUNNER_TEMP}/tag-object-count")"
      fi
      object_count=$((object_count + 1))
      printf '%s\n' "${object_count}" > "${RUNNER_TEMP}/tag-object-count"
      if [ "${object_count}" -gt 1 ]; then
        target="${TERMINAL_TAG_TARGET_SHA}"
      fi
      printf '{"sha":"%s","tag":"%s","message":"Release %s from %s","object":{"type":"commit","sha":"%s"},"tagger":{"name":"github-actions[bot]","email":"41898282+github-actions[bot]@users.noreply.github.com","date":"%s"}}' \
        "${TAG_OBJECT_SHA}" "${TAG}" "${TAG}" "${SOURCE_SHA}" \
        "${target}" "${TAGGER_DATE}" > "${output}"
      printf '200'
      ;;
    *) return 2 ;;
  esac
}

gh() {
  test "$1" = release
  test "$2" = create
  return 1
}

git() {
  test "$1" = show
  printf '%s\n' "${TAGGER_DATE}"
}
'''
            environment = os.environ.copy()
            environment.update(
                {
                    "TEST_PYTHON": ExistingImageShellPathTests.bash_path(sys.executable),
                    "RUNNER_TEMP": runner_relative,
                    "GH_TOKEN": "fixture-token",
                    "GITHUB_API_URL": "https://api.github.com",
                    "GITHUB_REPOSITORY": RC.EXPECTED_REPOSITORY,
                    "SOURCE_SHA": self.SOURCE,
                    "MAIN_RUN_ID": "123",
                    "TERMINAL_TAG_TARGET_SHA": terminal_target,
                    "TAG_OBJECT_SHA": self.TAG_OBJECT,
                    "TAGGER_DATE": self.DATE,
                    "TAG": self.TAG,
                    "IMAGE": RC.EXPECTED_IMAGE,
                    "CHART": RC.EXPECTED_CHART,
                }
            )
            return subprocess.run(
                [ExistingImageShellPathTests.bash_executable()],
                cwd=ROOT,
                env=environment,
                check=False,
                input=prelude + "\n" + initial + "\n" + release + "\n" + terminal,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                timeout=30,
            )

    def execute_staged_manifest_transaction(
        self, block: str, *, corrupt_first_download: bool
    ) -> tuple[subprocess.CompletedProcess[str], str]:
        with tempfile.TemporaryDirectory(dir=ROOT, prefix=".release-manifest-shell-") as temporary:
            runner = Path(temporary)
            runner_relative = runner.relative_to(ROOT).as_posix()
            manifest_record = RC.build_release_manifest(
                repository=RC.EXPECTED_REPOSITORY,
                source_sha=self.SOURCE,
                main_run_id=123,
                version="0.1.10",
                image=RC.EXPECTED_IMAGE,
                image_digest="sha256:" + "d" * 64,
                chart=RC.EXPECTED_CHART,
                chart_digest="sha256:" + "e" * 64,
            )
            manifest = canonical_manifest_bytes(manifest_record)
            manifest_name = f"naranjo-online-{self.TAG}-release-manifest.json"
            (runner / manifest_name).write_bytes(manifest)
            notes = RC.build_release_notes(manifest_record)
            (runner / "prepared-release.json").write_text(
                json.dumps(exact_release_record(manifest, tag=self.TAG, state="prepared", body=notes)),
                encoding="utf-8",
            )
            (runner / "staged-release.json").write_text(
                json.dumps(exact_release_record(manifest, tag=self.TAG, state="staged", body=notes)),
                encoding="utf-8",
            )
            (runner / "exact-release.json").write_text(
                json.dumps(exact_release_record(manifest, tag=self.TAG, body=notes)),
                encoding="utf-8",
            )
            replacements = {
                "${{ steps.release.outputs.tag }}": self.TAG,
                "${{ steps.release.outputs.version }}": "0.1.10",
                "${{ steps.image.outputs.digest }}": "sha256:" + "d" * 64,
                "${{ steps.chart.outputs.digest }}": "sha256:" + "e" * 64,
                "${{ steps.manifest.outputs.path }}": f"{runner_relative}/{manifest_name}",
                "${{ steps.manifest.outputs.name }}": manifest_name,
            }
            for old, new in replacements.items():
                block = block.replace(old, new)
            prelude = r'''
python3() {
  "${TEST_PYTHON}" "$@"
}

jq() {
  case "$*" in
    *'.assets | select(length == 1)'*) printf '%s\n' 'https://api.github.test/assets/1' ;;
    *) return 2 ;;
  esac
}

curl() {
  local all="$*" output='' state='absent'
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --output) output="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  if [ -f "${RUNNER_TEMP}/release-state" ]; then
    state="$(<"${RUNNER_TEMP}/release-state")"
  fi
  case "${all}" in
    *'/releases/tags/'*)
      if [ "${state}" = absent ]; then
        printf '{}' > "${output}"
        printf '404'
      else
        cp "${RUNNER_TEMP}/${state}-release.json" "${output}"
        printf '200'
      fi
      ;;
    *'api.github.test/assets/1'*)
      local count=0
      if [ -f "${RUNNER_TEMP}/asset-count" ]; then
        count="$(<"${RUNNER_TEMP}/asset-count")"
      fi
      count=$((count + 1))
      printf '%s\n' "${count}" > "${RUNNER_TEMP}/asset-count"
      cp "${RUNNER_TEMP}/naranjo-online-v0.1.10-release-manifest.json" "${output}"
      if [ "${CORRUPT_FIRST_DOWNLOAD}" = true ] && [ "${state}" = staged ]; then
        printf 'foreign\n' >> "${output}"
      fi
      ;;
    *) return 2 ;;
  esac
}

gh() {
  test "$1" = release
  printf '%s\n' "$2" >> "${RUNNER_TEMP}/gh-calls"
  case "$2" in
    create)
      printf 'prepared\n' > "${RUNNER_TEMP}/release-state"
      return 1
      ;;
    upload)
      printf 'staged\n' > "${RUNNER_TEMP}/release-state"
      return 1
      ;;
    edit)
      printf 'exact\n' > "${RUNNER_TEMP}/release-state"
      return 1
      ;;
    *) return 2 ;;
  esac
}
'''
            environment = os.environ.copy()
            environment.update(
                {
                    "TEST_PYTHON": ExistingImageShellPathTests.bash_path(sys.executable),
                    "RUNNER_TEMP": runner_relative,
                    "GH_TOKEN": "fixture-token",
                    "GITHUB_API_URL": "https://api.github.com",
                    "GITHUB_REPOSITORY": RC.EXPECTED_REPOSITORY,
                    "SOURCE_SHA": self.SOURCE,
                    "MAIN_RUN_ID": "123",
                    "IMAGE": RC.EXPECTED_IMAGE,
                    "CHART": RC.EXPECTED_CHART,
                    "CORRUPT_FIRST_DOWNLOAD": "true" if corrupt_first_download else "false",
                }
            )
            completed = subprocess.run(
                [ExistingImageShellPathTests.bash_executable()],
                cwd=ROOT,
                env=environment,
                check=False,
                input=prelude + "\n" + block,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                timeout=30,
            )
            calls = (runner / "gh-calls").read_text(encoding="utf-8") if (runner / "gh-calls").exists() else ""
            return completed, calls

    def test_actual_terminal_step_rejects_a_tag_moved_before_immutable_publication(self):
        block = ExistingImageShellPathTests.workflow_run_block(
            "Re-bind the immutable Release to the exact annotated tag"
        )
        exact = self.execute(block, target=self.SOURCE)
        self.assertEqual(exact.returncode, 0, exact.stdout + exact.stderr)
        self.assertIn("exact", exact.stdout)

        moved = self.execute(block, target=self.MOVED_SOURCE)
        self.assertNotEqual(moved.returncode, 0, moved.stdout + moved.stderr)
        self.assertIn("annotated tag target is not the exact source commit", moved.stderr)

        marker = "python3 -I -B scripts/ci/release_contract.py tag-record"
        prefix, separator, _validator = block.partition(marker)
        self.assertEqual(separator, marker)
        deletion_mutant = prefix + "true\n"
        survived_without_rebind = self.execute(deletion_mutant, target=self.MOVED_SOURCE)
        self.assertEqual(
            survived_without_rebind.returncode,
            0,
            survived_without_rebind.stdout + survived_without_rebind.stderr,
        )

    def test_concurrent_release_winner_rebinds_after_an_initially_exact_tag(self):
        exact = self.execute_concurrent_winner_transaction(terminal_target=self.SOURCE)
        self.assertEqual(exact.returncode, 0, exact.stdout + exact.stderr)
        self.assertIn("checking exact server state", exact.stderr)

        moved = self.execute_concurrent_winner_transaction(terminal_target=self.MOVED_SOURCE)
        self.assertNotEqual(moved.returncode, 0, moved.stdout + moved.stderr)
        self.assertIn("checking exact server state", moved.stderr)
        self.assertIn("annotated tag target is not the exact source commit", moved.stderr)

    def test_actual_draft_manifest_is_verified_before_publish_and_response_loss_resumes(self):
        block = ExistingImageShellPathTests.workflow_run_block(
            "Stage, verify, and publish the exact GitHub release"
        )
        exact, calls = self.execute_staged_manifest_transaction(
            block, corrupt_first_download=False
        )
        self.assertEqual(exact.returncode, 0, exact.stdout + exact.stderr)
        self.assertEqual(calls, "create\nupload\nedit\n")
        self.assertIn("draft Release create did not succeed; checking exact server state", exact.stderr)
        self.assertIn("manifest upload did not succeed; checking exact server state", exact.stderr)
        self.assertIn("draft publication did not succeed; checking exact server state", exact.stderr)

        corrupt, corrupt_calls = self.execute_staged_manifest_transaction(
            block, corrupt_first_download=True
        )
        self.assertNotEqual(corrupt.returncode, 0, corrupt.stdout + corrupt.stderr)
        self.assertEqual(corrupt_calls, "create\nupload\n")

        prepublish = '  verify_asset_bytes\n  if ! gh release edit "${tag}" --draft=false; then'
        self.assertIn(prepublish, block)
        deletion_mutant = block.replace(
            prepublish,
            '  true\n  if ! gh release edit "${tag}" --draft=false; then',
            1,
        )
        survived, survived_calls = self.execute_staged_manifest_transaction(
            deletion_mutant, corrupt_first_download=True
        )
        self.assertEqual(survived.returncode, 0, survived.stdout + survived.stderr)
        self.assertEqual(survived_calls, "create\nupload\nedit\n")


class ReleaseSettingsShellPathTests(unittest.TestCase):
    STEP = "Require authoritative release settings before side effects"
    _native_tool_directory: tempfile.TemporaryDirectory[str] | None = None

    @classmethod
    def setUpClass(cls) -> None:
        if os.name != "nt":
            return
        go = shutil.which("go")
        if go is None:
            raise unittest.SkipTest("Go is required for the Windows-only local gh fixture")
        cls._native_tool_directory = tempfile.TemporaryDirectory(
            dir=ROOT, prefix=".release-settings-gh-"
        )
        directory = Path(cls._native_tool_directory.name)
        source = directory / "main.go"
        source.write_text(
            r'''package main

import (
	"fmt"
	"os"
	"path/filepath"
)

func deny() {
	os.Exit(1)
}

func main() {
	if os.Getenv("GH_TOKEN") != "fixture-admin-read-token" {
		deny()
	}
	args := os.Args[1:]
	if len(args) < 4 || args[0] != "api" || args[1] != "--method" || args[2] != "GET" {
		deny()
	}
	endpoint := args[len(args)-1]
	if endpoint == os.Getenv("DENIED_ENDPOINT") {
		deny()
	}
	if endpoint == os.Getenv("MALFORMED_ENDPOINT") {
		fmt.Print("{malformed")
		return
	}
	files := map[string]string{
		"repos/owner/site": "repository.json",
		"repos/owner/site/immutable-releases": "immutable.json",
		"repos/owner/site/private-vulnerability-reporting": "private.json",
		"repos/owner/site/actions/permissions": "actions.json",
		"repos/owner/site/actions/permissions/workflow": "workflow.json",
		"repos/owner/site/rulesets": "rulesets.json",
		"repos/owner/site/rulesets/42": "ruleset.json",
	}
	name, ok := files[endpoint]
	if !ok {
		deny()
	}
	data, err := os.ReadFile(filepath.Join(os.Getenv("SETTINGS_FIXTURES_WIN"), name))
	if err != nil {
		deny()
	}
	if endpoint == "repos/owner/site/rulesets" {
		fmt.Printf("[%s]", data)
	} else {
		_, _ = os.Stdout.Write(data)
	}
}
''',
            encoding="utf-8",
        )
        environment = os.environ.copy()
        environment["CGO_ENABLED"] = "0"
        environment["GOTOOLCHAIN"] = "local"
        built = subprocess.run(
            [go, "build", "-o", str(directory / "gh.exe"), str(source)],
            cwd=directory,
            env=environment,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            timeout=60,
        )
        if built.returncode != 0:
            raise AssertionError(built.stdout + built.stderr)

    @classmethod
    def tearDownClass(cls) -> None:
        if cls._native_tool_directory is not None:
            cls._native_tool_directory.cleanup()
            cls._native_tool_directory = None

    def execute(
        self,
        records: Mapping[str, object],
        *,
        block: str | None = None,
        denied_endpoint: str = "",
        malformed_endpoint: str = "",
    ) -> subprocess.CompletedProcess[str]:
        if block is None:
            block = ExistingImageShellPathTests.workflow_run_block(self.STEP)
        with tempfile.TemporaryDirectory(dir=ROOT, prefix=".release-settings-shell-") as temporary:
            runner = Path(temporary)
            runner_relative = runner.relative_to(ROOT).as_posix()
            paths = {
                "repository": "repos/owner/site",
                "immutable": "repos/owner/site/immutable-releases",
                "private": "repos/owner/site/private-vulnerability-reporting",
                "actions": "repos/owner/site/actions/permissions",
                "workflow": "repos/owner/site/actions/permissions/workflow",
                "rulesets": "repos/owner/site/rulesets",
                "ruleset": "repos/owner/site/rulesets/42",
            }
            for name, endpoint in paths.items():
                (runner / f"{name}.json").write_text(
                    json.dumps(records[endpoint]), encoding="utf-8"
                )
            gh_body = r'''#!/usr/bin/env bash
set -euo pipefail
test "${GH_TOKEN:-}" = fixture-admin-read-token
if [ "${1:-}" = api ]; then
  shift
fi
test "$1" = --method
test "$2" = GET
endpoint="${!#}"
if [ "${endpoint}" = "${DENIED_ENDPOINT}" ]; then
  exit 1
fi
if [ "${endpoint}" = "${MALFORMED_ENDPOINT}" ]; then
  printf '{malformed'
  exit 0
fi
case "${endpoint}" in
  repos/owner/site) cat "${SETTINGS_FIXTURES}/repository.json" ;;
  repos/owner/site/immutable-releases) cat "${SETTINGS_FIXTURES}/immutable.json" ;;
  repos/owner/site/private-vulnerability-reporting) cat "${SETTINGS_FIXTURES}/private.json" ;;
  repos/owner/site/actions/permissions) cat "${SETTINGS_FIXTURES}/actions.json" ;;
  repos/owner/site/actions/permissions/workflow) cat "${SETTINGS_FIXTURES}/workflow.json" ;;
  repos/owner/site/rulesets)
    printf '['
    cat "${SETTINGS_FIXTURES}/rulesets.json"
    printf ']'
    ;;
  repos/owner/site/rulesets/42) cat "${SETTINGS_FIXTURES}/ruleset.json" ;;
  *) exit 2 ;;
esac
'''
            if os.name == "nt":
                assert self._native_tool_directory is not None
                gh_directory = Path(self._native_tool_directory.name)
            else:
                gh_stub = runner / "gh"
                gh_stub.write_text(gh_body, encoding="utf-8")
                gh_stub.chmod(0o700)
                gh_directory = runner
            prelude = r'''
python3() {
  "${TEST_PYTHON}" "$@"
}
'''
            environment = os.environ.copy()
            environment.update(
                {
                    "TEST_PYTHON": ExistingImageShellPathTests.bash_path(sys.executable),
                    "RUNNER_TEMP": ".",
                    "SETTINGS_FIXTURES": ExistingImageShellPathTests.bash_path(str(runner)),
                    "SETTINGS_FIXTURES_WIN": str(runner.resolve()),
                    "DENIED_ENDPOINT": denied_endpoint,
                    "MALFORMED_ENDPOINT": malformed_endpoint,
                    "IMMUTABLE_SETTINGS_TOKEN": "fixture-admin-read-token",
                    "GITHUB_REPOSITORY": "owner/site",
                    "PATH": str(gh_directory.resolve())
                    + os.pathsep
                    + os.environ.get("PATH", ""),
                }
            )
            contract = ExistingImageShellPathTests.bash_path(
                str(ROOT / "scripts" / "ci" / "release_contract.py")
            )
            block = block.replace("scripts/ci/release_contract.py", contract)
            return subprocess.run(
                [ExistingImageShellPathTests.bash_executable(), "-c", prelude + "\n" + block],
                cwd=runner,
                env=environment,
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                timeout=30,
            )

    def test_actual_full_settings_preflight_is_closed_and_load_bearing(self):
        block = ExistingImageShellPathTests.workflow_run_block(self.STEP)
        exact_records = settings_api()
        exact = self.execute(exact_records, block=block)
        self.assertEqual(exact.returncode, 0, exact.stdout + exact.stderr)
        self.assertEqual(exact.stdout.strip(), "exact")

        disabled = copy.deepcopy(exact_records)
        disabled["repos/owner/site/immutable-releases"]["enabled"] = False
        foreign = copy.deepcopy(exact_records)
        foreign["repos/owner/site/rulesets/42"]["rules"].append({"type": "update"})
        for name, records in (("disabled", disabled), ("foreign", foreign)):
            with self.subTest(settings=name):
                rejected = self.execute(records, block=block)
                self.assertNotEqual(rejected.returncode, 0, rejected.stdout + rejected.stderr)
        for endpoint in (
            "repos/owner/site/immutable-releases",
            "repos/owner/site/rulesets/42",
        ):
            denied = self.execute(exact_records, block=block, denied_endpoint=endpoint)
            self.assertNotEqual(denied.returncode, 0, denied.stdout + denied.stderr)
            malformed = self.execute(exact_records, block=block, malformed_endpoint=endpoint)
            self.assertNotEqual(malformed.returncode, 0, malformed.stdout + malformed.stderr)

        token_assignment = 'GH_TOKEN="${IMMUTABLE_SETTINGS_TOKEN}"'
        self.assertIn(token_assignment, block)
        without_token = self.execute(
            exact_records,
            block=block.replace(token_assignment, "GH_TOKEN=''", 1),
        )
        self.assertNotEqual(without_token.returncode, 0, without_token.stdout + without_token.stderr)

        receipt_assignment = 'receipt="${RUNNER_TEMP}/release-settings-receipt.json"'
        self.assertIn(receipt_assignment, block)
        deletion_mutant = block.split(receipt_assignment, 1)[0] + "true\n"
        disabled_survives = self.execute(disabled, block=deletion_mutant)
        self.assertEqual(
            disabled_survives.returncode,
            0,
            disabled_survives.stdout + disabled_survives.stderr,
        )

class GovernanceParityTests(unittest.TestCase):
    @staticmethod
    def adversarial_receipt_denial(
        text: str,
        expected_head: str,
        *,
        author_context: str,
        resource_kind: str,
    ) -> str | None:
        if resource_kind != "pull-request":
            return "exact-head review receipts apply only to pull requests"
        if re.fullmatch(r"[0-9a-f]{40}", expected_head) is None:
            return "expected head is not one lowercase 40-hex SHA"
        lines = text.replace("\r\n", "\n").splitlines()
        heads = [line[6:] for line in lines if line.startswith("HEAD: ")]
        verdicts = [line[9:] for line in lines if line.startswith("VERDICT: ")]
        if heads != [expected_head]:
            return "receipt must bind exactly one expected HEAD line"
        if len(verdicts) != 1 or verdicts[0] not in {"APPROVE", "REQUEST-CHANGES"}:
            return "receipt must contain exactly one supported VERDICT line"
        nonempty = [line for line in lines if line.strip()]
        if not nonempty:
            return "receipt is empty"
        signature = re.fullmatch(r"- (.+?) \(adversarial reviewer\)", nonempty[-1])
        if signature is None:
            return "final non-empty line must be adversarial reviewer signature"
        reviewer = signature.group(1).strip().casefold()
        if not reviewer or reviewer == author_context.strip().casefold():
            return "reviewer context must differ textually from author context"
        if "mutation" not in text.casefold() or "claim" not in text.casefold():
            return "receipt must report mutation and claim audit evidence"
        return None

    @classmethod
    def require_adversarial_review_governance(cls, agents: str) -> str:
        try:
            receipt = agents.split("**Exact-head receipt.**", 1)[1].split(
                "**The review must:**", 1
            )[0]
            label = agents.split(
                "- **`requires-review` — the review-readiness signal.**", 1
            )[1].split("- **Agent labels.**", 1)[0]
            working = agents.split("## Working a change end to end", 1)[1].split(
                "## Commit identity mechanics", 1
            )[0]
        except IndexError as exc:
            raise ValueError("canonical adversarial-review governance is missing") from exc

        for token in (
            "one normal PR comment in this exact shape",
            "HEAD: <40-lowercase-hex>",
            "VERDICT: APPROVE",
            "VERDICT: REQUEST-CHANGES",
            "Mutation audit:",
            "Claim audit:",
            "Full-gate and flake evidence:",
            "Scratch cleanup:",
            "- <Agent> (adversarial reviewer)",
        ):
            if token not in receipt:
                raise ValueError(f"canonical adversarial receipt lost: {token}")
        label_flat = " ".join(label.split())
        working_flat = " ".join(working.split())
        for token in (
            "`requires-review` is PR-head-only",
            "The author applies it only when the exact PR head, body,",
            "commits, and evidence are author-complete",
            "Its absence means the author PR is in flight",
            "The reviewer removes it when posting either verdict",
            "after repairs, the author reapplies it",
            "only for the complete replacement head",
            "Never apply or interpret it on an issue",
            "an issue has no head and cannot satisfy a PR receipt or Ready gate",
            "an explicit normal comment for issue-spec review",
        ):
            if token not in label_flat:
                raise ValueError(f"PR-head-only review handoff lost: {token}")
        if "Never apply or interpret `requires-review` on the issue" not in working_flat:
            raise ValueError("issue workflow regained requires-review semantics")

        try:
            sample = receipt.split("```text\n", 1)[1].split("\n```", 1)[0]
        except IndexError as exc:
            raise ValueError("canonical adversarial receipt sample is missing") from exc
        rendered = (
            sample.replace("<40-lowercase-hex>", "a" * 40)
            .replace("<numbered finding, or explicit no-finding scope>", "No finding in scope.")
            .replace("<hostile mutation results>", "all hostile mutants killed")
            .replace("<SUPPORTED and OVERSTATED results>", "SUPPORTED: exact scope")
            .replace(
                "<commands, results, and capability boundaries>",
                "focused and full gates passed",
            )
            .replace(
                "<disposable workspace and residue result>",
                "disposable workspace removed",
            )
            .replace("<Agent>", "Fable5")
        )
        denial = cls.adversarial_receipt_denial(
            rendered,
            "a" * 40,
            author_context="5.6 Sol",
            resource_kind="pull-request",
        )
        if denial is not None:
            raise ValueError(f"documented adversarial receipt is invalid: {denial}")
        return rendered

    @staticmethod
    def require_manifest_scan_audit_docs(
        agents: str, readme: str, security: str, runbook: str, changelog: str
    ) -> None:
        agents_flat = " ".join(agents.split())
        readme_flat = " ".join(readme.split())
        security_flat = " ".join(security.split())
        runbook_flat = " ".join(runbook.split())
        changelog_flat = " ".join(changelog.split())
        requirements = (
            (agents_flat, "exactly one canonical evidence"),
            (agents_flat, "exact PR-gate job inventory"),
            (agents_flat, "frontend development dependencies"),
            (agents_flat, "raw per-platform SBOM binding"),
            (agents_flat, "weekly read-only audit"),
            (agents_flat, "performs no publication mutation"),
            (readme_flat, "canonical JSON evidence manifest"),
            (readme_flat, "exact-SHA successful CodeQL"),
            (readme_flat, "frontend development dependencies"),
            (readme_flat, "strict raw SBOM schema"),
            (readme_flat, "pre-manifest alias and SBOM proof"),
            (readme_flat, "checksum-pinned Trivy binary"),
            (readme_flat, "weekly read-only audit"),
            (security_flat, "exact job inventory"),
            (security_flat, "strict raw platform SBOM subject"),
            (security_flat, "stages exactly one canonical"),
            (security_flat, "public semantic aliases"),
            (security_flat, "not publication authorization"),
            (runbook_flat, "Workflow-level success alone is insufficient"),
            (runbook_flat, "analyze (go, manual)"),
            (runbook_flat, "analyze (javascript-typescript, none)"),
            (runbook_flat, "direct checksum-verified Trivy v0.72.0"),
            (runbook_flat, "raw OCI attestation carriers"),
            (runbook_flat, "New publication creates a draft Release"),
            (runbook_flat, "downloads and compares the manifest again"),
            (runbook_flat, "`release-audit.yml` runs weekly and manually"),
            (runbook_flat, "scheduled detection is defense in depth"),
            (runbook_flat, "It has no settings App token, OIDC, or publication"),
            (changelog_flat, "closed job inventory"),
            (changelog_flat, "strict raw two-platform SBOM schemas"),
            (changelog_flat, "one deterministic evidence manifest"),
            (changelog_flat, "weekly"),
        )
        for document, token in requirements:
            if token not in document:
                raise ValueError(f"manifest/scan/audit doctrine lost: {token}")
        combined = agents + readme + security + runbook + changelog
        for forbidden in (
            "zero-asset inventory",
            "exact metadata and zero assets",
            "only the authoritative `GET /immutable-releases` step receives it",
        ):
            if forbidden in combined:
                raise ValueError(f"obsolete release doctrine survived: {forbidden}")

    @staticmethod
    def require_owner_role_privacy(agents: str) -> None:
        try:
            requirements = agents.split("## Requirements", 1)[1].split(
                "### Deployment-provider contract", 1
            )[0]
        except IndexError as exc:
            raise ValueError("canonical Requirements section is missing") from exc
        exact = "`main`; the repository owner alone merges."
        if requirements.count(exact) != 1:
            raise ValueError("owner-only merge authority must use the exact role, not a personal name")
        privacy_flat = " ".join(requirements.split())
        for token in (
            "No secrets, no noncanonical personal data",
            "already-public owner",
            "canonical attribution exceptions",
            "never expand them or use a personal name",
            "Access control is always expressed by role",
        ):
            if token not in privacy_flat:
                raise ValueError(f"privacy/attribution boundary lost: {token}")
        if "No secrets, no personal data." in requirements:
            raise ValueError("absolute no-personal-data claim contradicts canonical public attribution")
        if "PERSON_NAME_SENTINEL alone merges" in requirements:
            raise ValueError("canonical merge authority contains a personal-name regression")

    @staticmethod
    def require_main_worker_receipt(agents: str, template: str, runbook: str) -> None:
        try:
            section = agents.split("### Main Worker receipt", 1)[1].split(
                "## GitHub conventions", 1
            )[0]
        except IndexError as exc:
            raise ValueError("canonical Main Worker receipt section is missing") from exc
        for token in (
            "distinct Main Worker",
            "one bounded",
            "HEAD: <40-lowercase-hex>",
            "ROLE: MAIN-WORKER",
            "VERDICT: PASS",
            "SCOPE: architecture,merge-order,authority,settings,base-freshness,required-checks",
            "- <distinct context> (Main Worker)",
            "architecture,",
            "merge order",
            "authority",
            "settings",
            "base freshness",
            "required checks",
            "not repeat",
            "any later author push",
        ):
            if token not in section:
                raise ValueError(f"canonical Main Worker receipt lost: {token}")
        for token in (
            "Obtain the Main Worker receipt",
            "exact-head canonical `ROLE: MAIN-WORKER` / `VERDICT: PASS` receipt",
        ):
            if token not in agents:
                raise ValueError(f"agent Ready sequence lost Main Worker parity: {token}")
        for token in (
            "Main Worker exact-head bounded receipt",
            "HEAD: <40-lowercase-hex>",
            "ROLE: MAIN-WORKER",
            "VERDICT: PASS",
            "SCOPE: architecture,merge-order,authority,settings,base-freshness,required-checks",
            "- <distinct context> (Main Worker)",
            "): pending",
        ):
            if token not in template:
                raise ValueError(f"PR template lost Main Worker receipt parity: {token}")
        runbook_flat = " ".join(runbook.split())
        for token in (
            "separate Main Worker gate",
            "distinct Main Worker",
            "HEAD: <40-lowercase-hex>",
            "ROLE: MAIN-WORKER",
            "VERDICT: PASS",
            "SCOPE: architecture,merge-order,authority,settings,base-freshness,required-checks",
            "- <distinct context> (Main Worker)",
            "later push",
        ):
            if token not in runbook_flat:
                raise ValueError(f"release runbook lost Main Worker receipt parity: {token}")
        for legacy in (
            "MAIN-WORKER-ARCHITECTURE",
            "Main Worker (architecture coordinator)",
        ):
            if legacy in agents + template + runbook:
                raise ValueError(f"legacy Main Worker receipt survived: {legacy}")

    def test_owner_only_merge_requirement_rejects_the_personal_name_mutant(self):
        agents = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
        self.require_owner_role_privacy(agents)
        exact = "`main`; the repository owner alone merges."
        mutant = agents.replace(exact, "`main`; PERSON_NAME_SENTINEL alone merges.", 1)
        with self.assertRaises(ValueError):
            self.require_owner_role_privacy(mutant)
        for token in (
            "canonical attribution exceptions",
            "never expand them or use a personal name",
            "Access control is always expressed by role",
        ):
            with self.subTest(privacy_deletion=token), self.assertRaises(ValueError):
                self.require_owner_role_privacy(agents.replace(token, "", 1))
        with self.assertRaises(ValueError):
            self.require_owner_role_privacy(
                agents.replace(
                    "No secrets, no noncanonical personal data.",
                    "No secrets, no personal data.",
                    1,
                )
            )

    def test_adversarial_review_governance_is_pr_head_only_and_load_bearing(self):
        agents = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
        self.require_adversarial_review_governance(agents)
        for token in (
            "VERDICT: APPROVE",
            "Mutation audit:",
            "Claim audit:",
            "`requires-review` is\n  PR-head-only",
            "The author applies it only",
            "The reviewer\n  removes it when posting either verdict",
            "Never apply or interpret it on an\n  issue",
            "Never apply or interpret `requires-review` on the\n   issue",
        ):
            self.assertIn(token, agents)
            with self.subTest(deletion=token), self.assertRaises(ValueError):
                self.require_adversarial_review_governance(agents.replace(token, "", 1))
        for source, replacement in (
            (
                "The author applies it only",
                "The reviewer applies it only",
            ),
            (
                "The reviewer\n  removes it when posting either verdict",
                "The author\n  removes it when posting either verdict",
            ),
            (
                "Never apply or interpret it on an\n  issue",
                "Apply and interpret it on an\n  issue",
            ),
            (
                "Never apply or interpret `requires-review` on the\n   issue",
                "Apply and interpret `requires-review` on the\n   issue",
            ),
        ):
            self.assertIn(source, agents)
            with self.subTest(inversion=source), self.assertRaises(ValueError):
                self.require_adversarial_review_governance(
                    agents.replace(source, replacement, 1)
                )

    def test_documented_adversarial_receipt_rejects_invalid_samples(self):
        agents = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
        valid = self.require_adversarial_review_governance(agents)
        head = "a" * 40
        self.assertIsNone(
            self.adversarial_receipt_denial(
                valid,
                head,
                author_context="5.6 Sol",
                resource_kind="pull-request",
            )
        )
        self.assertIsNone(
            self.adversarial_receipt_denial(
                valid.replace("VERDICT: APPROVE", "VERDICT: REQUEST-CHANGES", 1),
                head,
                author_context="5.6 Sol",
                resource_kind="pull-request",
            )
        )
        invalid = {
            "bare verdict": valid.replace("VERDICT: APPROVE", "APPROVE", 1),
            "missing mutation evidence": valid.replace("Mutation audit:", "Evidence:", 1),
            "missing claim evidence": valid.replace("Claim audit:", "Evidence:", 1),
            "duplicate verdict": valid.replace(
                "VERDICT: APPROVE", "VERDICT: APPROVE\nVERDICT: REQUEST-CHANGES", 1
            ),
        }
        for name, sample in invalid.items():
            with self.subTest(invalid_sample=name):
                self.assertIsNotNone(
                    self.adversarial_receipt_denial(
                        sample,
                        head,
                        author_context="5.6 Sol",
                        resource_kind="pull-request",
                    )
                )
        self.assertIsNotNone(
            self.adversarial_receipt_denial(
                valid,
                head,
                author_context="5.6 Sol",
                resource_kind="issue",
            )
        )

    def test_main_worker_actor_scope_evidence_and_exact_head_are_parity_pinned(self):
        agents = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
        template = (ROOT / ".github" / "PULL_REQUEST_TEMPLATE.md").read_text(
            encoding="utf-8"
        )
        runbook = (ROOT / "docs" / "release-governance.md").read_text(encoding="utf-8")
        self.require_main_worker_receipt(agents, template, runbook)
        for owner, token in (
            ("agents", "distinct Main Worker"),
            ("agents", "HEAD: <40-lowercase-hex>"),
            ("agents", "ROLE: MAIN-WORKER"),
            ("agents", "VERDICT: PASS"),
            ("agents", "SCOPE: architecture,merge-order,authority,settings,base-freshness,required-checks"),
            ("agents", "- <distinct context> (Main Worker)"),
            ("agents", "Obtain the Main Worker receipt"),
            ("agents", "exact-head canonical `ROLE: MAIN-WORKER` / `VERDICT: PASS` receipt"),
            ("template", "HEAD: <40-lowercase-hex>"),
            ("template", "ROLE: MAIN-WORKER"),
            ("template", "VERDICT: PASS"),
            ("template", "SCOPE: architecture,merge-order,authority,settings,base-freshness,required-checks"),
            ("template", "- <distinct context> (Main Worker)"),
            ("runbook", "the distinct\nMain Worker"),
            ("runbook", "HEAD: <40-lowercase-hex>"),
            ("runbook", "ROLE: MAIN-WORKER"),
            ("runbook", "VERDICT: PASS"),
            ("runbook", "SCOPE: architecture,merge-order,authority,settings,base-freshness,required-checks"),
            ("runbook", "- <distinct context> (Main Worker)"),
            ("runbook", "later push"),
        ):
            changed = {"agents": agents, "template": template, "runbook": runbook}
            if owner == "agents":
                prefix, marker, suffix = changed[owner].partition(
                    "### Main Worker receipt"
                )
                self.assertTrue(marker)
                changed[owner] = prefix + marker + suffix.replace(token, "", 1)
            else:
                changed[owner] = changed[owner].replace(token, "", 1)
            with self.subTest(deletion=owner + ":" + token), self.assertRaises(ValueError):
                self.require_main_worker_receipt(
                    changed["agents"], changed["template"], changed["runbook"]
                )
        for owner in ("agents", "template", "runbook"):
            changed = {"agents": agents, "template": template, "runbook": runbook}
            changed[owner] = changed[owner].replace(
                "VERDICT: PASS",
                "VERDICT: BLOCKED",
                1,
            )
            with self.subTest(inversion=owner), self.assertRaises(ValueError):
                self.require_main_worker_receipt(
                    changed["agents"], changed["template"], changed["runbook"]
                )

    def test_manifest_scan_and_alias_audit_doctrine_is_truthful_and_load_bearing(self):
        paths = {
            "agents": ROOT / "AGENTS.md",
            "readme": ROOT / "README.md",
            "security": ROOT / "SECURITY.md",
            "runbook": ROOT / "docs/release-governance.md",
            "changelog": ROOT / "CHANGELOG.md",
        }
        documents = {name: path.read_text(encoding="utf-8") for name, path in paths.items()}
        self.require_manifest_scan_audit_docs(**documents)
        for owner, token in (
            ("agents", "weekly read-only audit"),
            ("agents", "raw per-platform SBOM binding"),
            ("readme", "canonical JSON evidence manifest"),
            ("readme", "strict raw SBOM schema"),
            ("security", "public semantic aliases"),
            ("security", "strict raw platform SBOM subject"),
            ("runbook", "Workflow-level success alone is insufficient"),
            ("runbook", "New publication creates a draft Release"),
            ("runbook", "downloads and compares the manifest again"),
            ("runbook", "scheduled detection is defense in depth"),
            ("changelog", "one deterministic evidence manifest"),
            ("changelog", "strict raw two-platform SBOM schemas"),
        ):
            changed = dict(documents)
            changed[owner] = changed[owner].replace(token, "", 1)
            with self.subTest(document=owner, token=token), self.assertRaises(ValueError):
                self.require_manifest_scan_audit_docs(**changed)
        changed = dict(documents)
        changed["readme"] += "\nzero-asset inventory\n"
        with self.assertRaises(ValueError):
            self.require_manifest_scan_audit_docs(**changed)


class TrivyDevelopmentDependencyShellPathTests(unittest.TestCase):
    STEP = "Reject high or critical source dependency vulnerabilities"

    @staticmethod
    def folded_run_block() -> str:
        lines = (ROOT / ".github/workflows/pr-gate.yml").read_text(
            encoding="utf-8"
        ).splitlines()
        marker = f"      - name: {TrivyDevelopmentDependencyShellPathTests.STEP}"
        start = lines.index(marker)
        run = lines.index("        run: >-", start)
        body: list[str] = []
        for line in lines[run + 1 :]:
            if line.startswith("      - name:"):
                break
            if line.startswith("          "):
                body.append(line[10:])
            elif line:
                break
        return " ".join(body) + "\n"

    def execute(self, block: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory(dir=ROOT, prefix=".trivy-dev-shell-") as temporary:
            fixture = Path(temporary)
            frontend = fixture / "frontend"
            frontend.mkdir()
            (frontend / "package.json").write_text(
                json.dumps(
                    {
                        "name": "fixture",
                        "devDependencies": {"fixture-vulnerable-dev": "1.0.0"},
                    }
                ),
                encoding="utf-8",
            )
            (frontend / "package-lock.json").write_text(
                json.dumps(
                    {
                        "name": "fixture",
                        "lockfileVersion": 3,
                        "packages": {
                            "": {
                                "devDependencies": {"fixture-vulnerable-dev": "1.0.0"}
                            },
                            "node_modules/fixture-vulnerable-dev": {
                                "version": "1.0.0",
                                "dev": True,
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )
            prelude = r'''
trivy() {
  if [[ " $* " != *' --include-dev-deps '* ]]; then
    return 0
  fi
  "${TEST_PYTHON}" -c 'import json,sys; value=json.load(open("frontend/package-lock.json", encoding="utf-8")); package=value["packages"].get("node_modules/fixture-vulnerable-dev"); sys.exit(42 if package == {"version":"1.0.0","dev":True} else 3)'
}
'''
            environment = os.environ.copy()
            environment.update(
                {
                    "TEST_PYTHON": ExistingImageShellPathTests.bash_path(sys.executable),
                    "RUNNER_TEMP": ".",
                }
            )
            return subprocess.run(
                [ExistingImageShellPathTests.bash_executable()],
                cwd=fixture,
                env=environment,
                check=False,
                input=prelude + "\n" + block,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                timeout=30,
            )

    def test_vulnerable_frontend_dev_dependency_reaches_scanner_input(self):
        block = self.folded_run_block()
        self.assertIn("trivy fs --scanners vuln --include-dev-deps", block)
        detected = self.execute(block)
        self.assertEqual(detected.returncode, 42, detected.stdout + detected.stderr)
        suppressed = self.execute(block.replace(" --include-dev-deps", "", 1))
        self.assertEqual(suppressed.returncode, 0, suppressed.stdout + suppressed.stderr)


class CoverageBadgeShellPathTests(unittest.TestCase):
    @staticmethod
    def run_block(step_name: str) -> str:
        lines = (ROOT / ".github/workflows/pr-gate.yml").read_text(
            encoding="utf-8"
        ).splitlines()
        marker = f"      - name: {step_name}"
        start = lines.index(marker)
        run = lines.index("        run: |", start)
        body: list[str] = []
        for line in lines[run + 1 :]:
            if line.startswith("      - name:"):
                break
            if line.startswith("          "):
                body.append(line[10:])
            elif line:
                break
        return "\n".join(body) + "\n"

    @staticmethod
    def execute(block: str, prelude: str, environment: dict[str, str]) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory(dir=ROOT, prefix=".coverage-badge-shell-") as temporary:
            fixture = Path(temporary)
            output = fixture / "github-output.txt"
            env = os.environ.copy()
            env.update(environment)
            env.update(
                {
                    "RUNNER_TEMP": ExistingImageShellPathTests.bash_path(fixture),
                    "GITHUB_OUTPUT": ExistingImageShellPathTests.bash_path(output),
                }
            )
            return subprocess.run(
                [ExistingImageShellPathTests.bash_executable()],
                cwd=fixture,
                env=env,
                check=False,
                input=prelude + "\n" + block,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                timeout=30,
            )

    def test_compute_block_exits_on_the_first_failed_tool(self):
        block = self.run_block("Compute coverage percentages")
        prelude = r'''
pushd() { return 0; }
popd() { return 0; }
npm() {
  if [ "${1-}" = ci ]; then
    return 47
  fi
  return 0
}
node() { printf 'all files|100|\n'; }
go() {
  if [ "${1-}" = tool ]; then
    printf 'total: (statements) 100.0%%\n'
  fi
  return 0
}
grep() { printf 'mode: atomic\n'; }
'''
        strict = self.execute(block, prelude, {})
        self.assertEqual(strict.returncode, 47, strict.stdout + strict.stderr)
        fail_open = self.execute(block.replace("set -euo pipefail\n", "", 1), prelude, {})
        self.assertEqual(fail_open.returncode, 0, fail_open.stdout + fail_open.stderr)

    def test_publish_block_and_guarded_directory_transition_fail_closed(self):
        block = self.run_block("Publish badge JSONs to the badges branch")
        prelude = r'''
mkdir() { return 48; }
cd() { return 49; }
git() { return 0; }
'''
        environment = {
            "GH_TOKEN": "fixture-token",
            "GO_PCT": "96.3",
            "FRONT_PCT": "100",
            "GITHUB_SHA": "a" * 40,
            "GITHUB_REPOSITORY": "snaraj/naranjo.online",
        }
        strict = self.execute(block, prelude, environment)
        self.assertEqual(strict.returncode, 48, strict.stdout + strict.stderr)
        fail_open = self.execute(
            block.replace("set -euo pipefail\n", "", 1).replace(
                'cd "${work}" || exit 1', 'cd "${work}"', 1
            ),
            prelude,
            environment,
        )
        self.assertEqual(fail_open.returncode, 0, fail_open.stdout + fail_open.stderr)


class WorkflowStructureTests(unittest.TestCase):
    @staticmethod
    def require_publication_identity_oracles(contract: str, publisher: str) -> None:
        contract_literals = (
            'EXPECTED_REPOSITORY = "snaraj/naranjo.online"\n',
            'EXPECTED_IMAGE = "ghcr.io/snaraj/naranjo-online"\n',
            'EXPECTED_CHART = "ghcr.io/snaraj/charts/naranjo-online"\n',
            'GITHUB_ACTIONS_BOT_LOGIN = "github-actions[bot]"\n',
            "GITHUB_ACTIONS_BOT_ID = 41898282\n",
        )
        publisher_literals = (
            "  IMAGE: ghcr.io/snaraj/naranjo-online\n",
            "  CHART: ghcr.io/snaraj/charts/naranjo-online\n",
        )
        for literal in contract_literals:
            if contract.count(literal) != 1:
                raise ValueError(f"release identity oracle changed: {literal.strip()}")
        for literal in publisher_literals:
            if publisher.count(literal) != 1:
                raise ValueError(f"publisher identity oracle changed: {literal.strip()}")

    @staticmethod
    def require_coverage_badge_fail_fast(gate: str) -> None:
        marker = "\n  coverage-badges:\n"
        if gate.count(marker) != 1:
            raise ValueError("coverage-badges job identity is not exact")
        coverage = gate.split(marker, 1)[1]
        compute_heading = "      - name: Compute coverage percentages\n"
        publish_heading = "      - name: Publish badge JSONs to the badges branch\n"
        if coverage.count(compute_heading) != 1 or coverage.count(publish_heading) != 1:
            raise ValueError("coverage-badges step inventory is not exact")
        compute = coverage.split(compute_heading, 1)[1].split(publish_heading, 1)[0]
        publish = coverage.split(publish_heading, 1)[1]
        if compute.count("          set -euo pipefail\n") != 1:
            raise ValueError("coverage computation must have one exact fail-fast boundary")
        if publish.count("          set -euo pipefail\n") != 1:
            raise ValueError("badge publication must have one exact fail-fast boundary")
        for required in (
            "          pushd frontend >/dev/null\n",
            "          popd >/dev/null\n",
        ):
            if required not in compute:
                raise ValueError(f"coverage computation directory guard lost: {required.strip()}")
        guarded_cd = '          cd "${work}" || exit 1\n'
        if publish.count(guarded_cd) != 1:
            raise ValueError("badge publication directory transition is not fail closed")
        if re.search(r'(?m)^          cd "\$\{work\}"\s*$', publish):
            raise ValueError("badge publication retained an unguarded directory change")

    @staticmethod
    def require_vulnerability_and_alias_audit(
        gate: str, publisher: str, audit: str, installer: str
    ) -> None:
        installer_requirements = (
            "TRIVY_VERSION=v0.72.0",
            "TRIVY_SHA256=bbb64b9695866ce4a7a8f5c9592002c5961cab378577fa3f8a040df362b9b2ea",
            "https://github.com/aquasecurity/trivy/releases/download/${TRIVY_VERSION}/trivy_${TRIVY_VERSION#v}_Linux-64bit.tar.gz",
            'test "$("${install_root}/trivy" --version | awk \'NR == 1 {print $2}\')" = "${TRIVY_VERSION#v}"',
        )
        for required in installer_requirements:
            if required not in installer:
                raise ValueError(f"checksum-verified Trivy installer changed: {required}")
        combined = gate + publisher + audit + installer
        for forbidden in ("aquasecurity/trivy-action@", "aquasecurity/setup-trivy@", "trivy:latest"):
            if forbidden in combined:
                raise ValueError(f"mutable Trivy installation path introduced: {forbidden}")

        source_scan = (
            "trivy fs --scanners vuln --include-dev-deps\n"
            "          --severity HIGH,CRITICAL --exit-code 1\n"
            '          --ignore-unfixed=false --timeout 10m\n'
            '          --cache-dir "${RUNNER_TEMP}/trivy-source-cache" .'
        )
        image_scan = (
            "trivy image --scanners vuln --include-dev-deps\n"
            "          --severity HIGH,CRITICAL --exit-code 1\n"
            '          --ignore-unfixed=false --timeout 10m\n'
            '          --cache-dir "${RUNNER_TEMP}/trivy-image-cache"\n'
            '          "${IMAGE}@${{ steps.image.outputs.digest }}"'
        )
        if source_scan not in gate or image_scan not in publisher:
            raise ValueError("source or final-digest vulnerability gate is not exact")

        audit_requirements = (
            "schedule:",
            "cron: '17 8 * * 1'",
            "workflow_dispatch:",
            "group: release-alias-audit-${{ github.sha }}",
            "cancel-in-progress: false",
            "timeout-minutes: 45",
            "contents: read",
            "packages: read",
            "ref: main",
            "persist-credentials: false",
            "fetch-depth: 0",
            "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
            "docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c # v4.2.0",
            "sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6 # v4.1.2",
            '"repos/${GITHUB_REPOSITORY}/releases/latest"',
            "manifest-record",
            "release-notes",
            "release-record",
            '"repos/${GITHUB_REPOSITORY}/actions/runs/${main_run_id}"',
            "main-run-record",
            'git merge-base --is-ancestor "${source_sha}" HEAD',
            '"repos/${GITHUB_REPOSITORY}/git/ref/tags/${tag}"',
            '"repos/${GITHUB_REPOSITORY}/git/tags/${tag_object}"',
            "tag-record",
            'manifests/${reference}',
            'test "$(registry_digest "${image_repository}" "${tag}"',
            'test "$(registry_digest "${chart_repository}" "${version}"',
            '"${IMAGE}@${image_digest}"',
            '"${CHART}@${chart_digest}"',
            "cosign verify-attestation --type slsaprovenance1 --output json",
            "attestation-statement",
            "attestation-set",
            'git archive "${source_sha}" chart | tar -x -C "${expected_source}"',
            'diff -ru --no-dereference "${expected_tree}/${chart_name}" "${published_tree}/${chart_name}"',
            "trivy image --scanners vuln --include-dev-deps",
            "--severity HIGH,CRITICAL --exit-code 1",
            "sbom-index-record",
            "sbom-layer-record",
            "sbom-statement",
            '"${IMAGE}@${image_digest}"',
        )
        for required in audit_requirements:
            if required not in audit:
                raise ValueError(f"recurring alias audit lost exact binding: {required}")
        for forbidden in (
            "contents: write",
            "packages: write",
            "id-token: write",
            "gh api --method POST",
            "gh api --method PUT",
            "gh api --method PATCH",
            "gh api --method DELETE",
            "gh release create",
            "gh release edit",
            "cosign sign",
            "cosign attest",
            "helm push",
            "docker buildx build",
            "PLATFORM_RELEASE_APP_PRIVATE_KEY",
            "IMMUTABLE_SETTINGS_TOKEN",
        ):
            if forbidden in audit:
                raise ValueError(f"read-only alias audit gained mutation or App authority: {forbidden}")

    @staticmethod
    def require_tag_partition(publisher: str) -> None:
        image = publisher.split("id: image_state", 1)[1].split("id: chart_state", 1)[0]
        chart = publisher.split("id: chart_state", 1)[1]
        if 'manifests/${TAG}' not in image or 'manifests/${VERSION}' in image:
            raise ValueError("image registry tag must be plain vX.Y.Z exactly once")
        if 'manifests/${VERSION}' not in chart or 'manifests/${TAG}' in chart:
            raise ValueError("Helm registry tag must be numeric SemVer exactly once")
        if 'helm package chart --version "${TAG}"' in publisher or '--version "v${version}"' in publisher:
            raise ValueError("Helm package version must not gain a v or double-v prefix")

    @staticmethod
    def require_exact_release_wiring(orchestrator: str, publisher: str) -> None:
        for required in (
            "fetch-depth: 0",
            "release-window",
        ):
            if required not in orchestrator:
                raise ValueError(f"orchestrator lost exact release wiring: {required}")
        for forbidden in (
            "tag-state",
            "tag-record",
            "classify_tag",
            "git/tags",
            "git/refs",
            "gh api --method POST",
            "gh release create",
            "cosign sign",
            "helm push",
            "docker build",
        ):
            if forbidden in orchestrator:
                raise ValueError(f"orchestrator gained publication mutation: {forbidden}")
        for required in (
            "tag-record",
            "tag-state",
            "classify_tag exact >/dev/null",
            "classify_tag absent >/dev/null",
            'tagger[name]=${tagger_name}',
            'tagger[email]=${tagger_email}',
            'tagger[date]=${tagger_date}',
            "cosign attest --yes --statement",
            "cosign verify-attestation --type slsaprovenance1 --output json",
            "release-state",
            "release-manifest",
            "manifest-record",
            "release-notes",
            'state="$(classify_release)"',
            '[ "${state}" = prepared ]',
            '[ "${state}" = staged ]',
            '[ "${state}" = exact ]',
            'gh release create "${tag}" "${manifest}" --draft --verify-tag',
            'gh release upload "${tag}" "${manifest}"',
            'gh release edit "${tag}" --draft=false',
            'test "${upload_verified}" = true',
            "verify_asset_bytes",
            'cmp --silent "${manifest}" "${observed}"',
            "/releases/tags/${tag}",
            "X-GitHub-Api-Version: 2026-03-10",
            "for attempt in 1 2 3 4 5",
            'test "${race_verified}" = true',
            "Re-bind the immutable Release to the exact annotated tag",
            "terminal-tag-ref.json",
            "terminal-tag-object.json",
            "terminal-release.json",
            "terminal-release-manifest.json",
        ):
            if required not in publisher:
                raise ValueError(f"publisher lost exact release wiring: {required}")
        for repeated in (
            "attestation-statement",
            "attestation-set",
            "cosign verify-attestation --type slsaprovenance1 --output json",
        ):
            if publisher.count(repeated) < 2:
                raise ValueError(f"publisher must use {repeated} for both existing and new images")
        if publisher.count("classify_tag exact >/dev/null") < 3:
            raise ValueError("publisher must verify exact tag state before reuse, after a race, and after create")
        if publisher.count('state="$(classify_release)"') < 3:
            raise ValueError("publisher must reclassify Release state across create and publish response loss")
        if publisher.count("verify_asset_bytes") < 3:
            raise ValueError("publisher must verify manifest bytes before and after publication")
        if publisher.count("tag-state") < 1 or publisher.count("tag-record") < 1:
            raise ValueError("publisher must bind the tag both before artifacts and after immutable Release state")
        if publisher.count("X-GitHub-Api-Version: 2026-03-10") < 4:
            raise ValueError(
                "publisher must version the main-run, Release, and both terminal tag REST reads"
            )
        build_heading = "      - name: Build and publish both production architectures"
        image_resolver_heading = "      - name: Resolve the one image digest for later stages"
        if publisher.count(build_heading) != 1 or publisher.count(image_resolver_heading) != 1:
            raise ValueError("publisher must have one exact Buildx step and image resolver")
        build_step = publisher.split(build_heading, 1)[1].split(image_resolver_heading, 1)[0]
        tags = re.search(
            r"(?m)^          tags: \|\n((?:            .*\n)+?)          labels: \|$",
            build_step,
        )
        exact_image_tag = "            ${{ env.IMAGE }}:${{ steps.release.outputs.tag }}\n"
        if tags is None or tags.group(1) != exact_image_tag:
            raise ValueError("Buildx must push only the intended semantic image alias")
        sbom_values = re.findall(r"(?m)^          sbom:\s*(.*?)\s*$", build_step)
        if sbom_values != ["true"]:
            raise ValueError("Buildx must produce exactly one enabled SBOM source")
        chart_heading = "      - name: Publish and sign an absent chart version"
        chart_resolver_heading = "      - name: Resolve the one chart digest for release notes"
        if publisher.count(chart_heading) != 1 or publisher.count(chart_resolver_heading) != 1:
            raise ValueError("publisher must have one exact Helm push step and chart resolver")
        chart_step = publisher.split(chart_heading, 1)[1].split(chart_resolver_heading, 1)[0]
        exact_chart_push = (
            'helm push "${RUNNER_TEMP}/${chart_name}-${version}.tgz" '
            '"oci://${CHART%/*}"'
        )
        if chart_step.count("helm push") != 1 or exact_chart_push not in chart_step:
            raise ValueError("Helm must push only the intended numeric chart alias")
        alias_heading = (
            "      - name: Re-bind both public aliases and exact platform SBOMs before sealing evidence"
        )
        if publisher.count(alias_heading) != 1:
            raise ValueError("publisher must have exactly one terminal registry-alias rebind")
        alias_step = publisher.split(alias_heading, 1)[1].split(
            "      - name: Build the deterministic release evidence manifest", 1
        )[0]
        for required in (
            'fetch_exact_alias "${image_repository}" "${IMAGE_ALIAS}"',
            'image "${IMAGE_DIGEST}" "${image_token}"',
            'fetch_exact_alias "${chart_repository}" "${CHART_ALIAS}"',
            'chart "${CHART_DIGEST}" "${chart_token}"',
            'test "${observed}" = "${expected}"',
            "sbom-index-record",
            "sbom-layer-record",
            "sbom-statement",
        ):
            if required not in alias_step:
                raise ValueError(f"terminal registry-alias rebind lost exact proof: {required}")
        tag_index = publisher.index("      - name: Create or verify the exact annotated tag")
        registry_index = publisher.index("      - name: Classify an absent, complete, or burned image tag")
        if tag_index >= registry_index:
            raise ValueError("exact tag transaction must precede registry side effects")
        scan_index = publisher.index(
            "      - name: Reject high or critical vulnerabilities in the final image digest"
        )
        alias_index = publisher.index(alias_heading)
        manifest_index = publisher.index(
            "      - name: Build the deterministic release evidence manifest"
        )
        release_index = publisher.index(
            "      - name: Stage, verify, and publish the exact GitHub release"
        )
        terminal_index = publisher.index(
            "      - name: Re-bind the immutable Release to the exact annotated tag"
        )
        if not (
            registry_index < scan_index < alias_index < manifest_index < release_index < terminal_index
        ):
            raise ValueError(
                "scan, alias rebind, manifest, Release, and terminal binding order is not exact"
            )
        if terminal_index <= release_index or publisher.rfind("      - name:") != terminal_index:
            raise ValueError("the post-immutable tag rebind must be the terminal publisher step")
        terminal = publisher[terminal_index:]
        for required in (
            "/git/ref/tags/${TAG}",
            "/git/tags/${tag_object}",
            "/releases/tags/${TAG}",
            "release-record",
            "terminal-release-manifest.json",
            'cmp --silent "${manifest}" "${observed_manifest}"',
            '--source-sha "${SOURCE_SHA}"',
            '--message "Release ${TAG} from ${SOURCE_SHA}"',
            "--tagger-name 'github-actions[bot]'",
            "--tagger-email '41898282+github-actions[bot]@users.noreply.github.com'",
            '--tagger-date "$(git show -s --format=%cI "${SOURCE_SHA}")"',
        ):
            if required not in terminal:
                raise ValueError(f"terminal post-immutable tag binding lost: {required}")
        for forbidden in (
            "gh release create",
            "gh api --method POST",
            "cosign sign",
            "helm push",
            "docker build",
            "git push",
            "git tag",
        ):
            if forbidden in terminal:
                raise ValueError(f"publication mutation follows terminal tag binding: {forbidden}")
        for forbidden in ("cosign download attestation", 'git rev-list -n 1 "${tag}"'):
            if forbidden in publisher:
                raise ValueError(f"publisher contains unauthenticated or local-ref verifier: {forbidden}")
        if "--clobber" in publisher:
            raise ValueError("manifest retry must never replace an existing Release asset")

    @staticmethod
    def require_successful_main_privilege_boundary(orchestrator: str, publisher: str) -> None:
        for expected in (
            f"  IMAGE: {RC.EXPECTED_IMAGE}\n",
            f"  CHART: {RC.EXPECTED_CHART}\n",
        ):
            if publisher.count(expected) != 1:
                raise ValueError(f"publisher package destination is not exact: {expected.strip()}")
        if any(marker not in publisher for marker in (
            '\n  authorize:\n', '\n  immutable_settings:\n', '\n  publish:\n'
        )):
            raise ValueError("publisher must separate authorization, settings, and publication")
        authorize = publisher.split('\n  authorize:\n', 1)[1].split('\n  immutable_settings:\n', 1)[0]
        settings = publisher.split('\n  immutable_settings:\n', 1)[1].split('\n  publish:\n', 1)[0]
        publish = publisher.split('\n  publish:\n', 1)[1]
        authorize_exact_counts = {
            'actions/runs/${MAIN_RUN_ID}': 2,
            '--run-id "${MAIN_RUN_ID}"': 2,
            '--repository "${GITHUB_REPOSITORY}"': 2,
            '--source-sha "${SOURCE_SHA}"': 4,
        }
        for required, expected_count in authorize_exact_counts.items():
            actual_count = authorize.count(required)
            if actual_count != expected_count:
                raise ValueError(
                    "read-only authorization binding count changed: "
                    f"{required} expected {expected_count}, got {actual_count}"
                )
        for required in (
            "actions: read",
            "contents: read",
            "main-run-record",
            'actions/runs/${MAIN_RUN_ID}',
            "authority/scripts/ci/release_contract.py",
            "ref: ${{ github.sha }}",
            "path: authority",
            '--run-id "${MAIN_RUN_ID}"',
            '--repository "${GITHUB_REPOSITORY}"',
            '--source-sha "${SOURCE_SHA}"',
            'test "${authorized_sha}" = "${SOURCE_SHA}"',
            'source_sha=%s\\n',
        ):
            if required not in authorize:
                raise ValueError(f"read-only main-run authorization lost: {required}")
        for forbidden in ("contents: write", "packages: write", "id-token: write"):
            if forbidden in authorize:
                raise ValueError(f"authorization job gained privilege: {forbidden}")
        for required in (
            "needs: authorize",
            "if: needs.authorize.result == 'success'",
            "environment: platform-release",
            "timeout-minutes: 10",
            "contents: read",
            "ref: ${{ needs.authorize.outputs.source_sha }}",
            "persist-credentials: false",
            "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0",
            "app-id: ${{ vars.PLATFORM_RELEASE_APP_ID }}",
            "private-key: ${{ secrets.PLATFORM_RELEASE_APP_PRIVATE_KEY }}",
            "owner: ${{ github.repository_owner }}",
            "repositories: ${{ github.event.repository.name }}",
            "permission-administration: read",
            "skip-token-revoke: false",
            "IMMUTABLE_SETTINGS_TOKEN: ${{ steps.immutable_settings.outputs.token }}",
            "Require authoritative release settings before side effects",
            'GH_TOKEN="${IMMUTABLE_SETTINGS_TOKEN}"',
            "release_contract.py settings-preflight",
            "release_contract.py settings-receipt",
            '--repository "${GITHUB_REPOSITORY}"',
        ):
            if required not in settings:
                raise ValueError(f"authoritative settings boundary lost: {required}")
        for forbidden in (
            "contents: write", "packages: write", "id-token: write",
            "permission-administration: write", "skip-token-revoke: true",
        ):
            if forbidden in settings:
                raise ValueError(f"settings job gained mutation authority: {forbidden}")
        if re.search(r"(?m)^    outputs:", settings):
            raise ValueError("settings job must not export its App token or any output")
        confined = (
            "${{ vars.PLATFORM_RELEASE_APP_ID }}",
            "${{ secrets.PLATFORM_RELEASE_APP_PRIVATE_KEY }}",
            "${{ steps.immutable_settings.outputs.token }}",
            "IMMUTABLE_SETTINGS_TOKEN",
        )
        for token in confined:
            if publisher.count(token) != settings.count(token):
                raise ValueError(f"settings authority crossed its job boundary: {token}")
            if token in orchestrator or token in publish or token in authorize:
                raise ValueError(f"settings authority crossed into mutation path: {token}")
        for required in (
            "needs: [authorize, immutable_settings]",
            "needs.authorize.result == 'success' &&",
            "needs.immutable_settings.result == 'success'",
            "ref: ${{ needs.authorize.outputs.source_sha }}",
            "fetch-depth: 0",
            "persist-credentials: false",
            "SOURCE_SHA: ${{ needs.authorize.outputs.source_sha }}",
            'workflow-ref "${GITHUB_WORKFLOW_REF}"',
            '--image "${IMAGE}"',
            '--chart "${CHART}"',
            "@refs/heads/main",
        ):
            if required not in publish:
                raise ValueError(f"privileged publication lost main-run dependency: {required}")
        bind_heading = "      - name: Bind protected workflow, authorized checkout, and committed locks"
        install_heading = "      - name: Install checksum-verified tools"
        tag_heading = "      - name: Create or verify the exact annotated tag"
        if publish.count(bind_heading) != 1 or publish.count(install_heading) != 1:
            raise ValueError("publisher pre-side-effect binding step is not exact")
        binding = publish.split(bind_heading, 1)[1].split(install_heading, 1)[0]
        for required in (
            '--repository "${GITHUB_REPOSITORY}"',
            '--workflow-ref "${GITHUB_WORKFLOW_REF}"',
            '--image "${IMAGE}"',
            '--chart "${CHART}"',
        ):
            if binding.count(required) != 1:
                raise ValueError(f"pre-side-effect package identity binding lost: {required}")
        if publish.index(bind_heading) >= publish.index(tag_heading):
            raise ValueError("package identities must bind before the first publication side effect")
        for required in (
            "MAIN_RUN_ID: ${{ github.event.workflow_run.id }}",
            "--ref main",
            '-f main_run_id="${MAIN_RUN_ID}"',
        ):
            if required not in orchestrator:
                raise ValueError(f"orchestrator lost exact main-run dispatch binding: {required}")
        orchestrator_exact_counts = {
            "MAIN_RUN_ID: ${{ github.event.workflow_run.id }}": 2,
            "--ref main": 1,
            '-f main_run_id="${MAIN_RUN_ID}"': 1,
        }
        for required, expected_count in orchestrator_exact_counts.items():
            actual_count = orchestrator.count(required)
            if actual_count != expected_count:
                raise ValueError(
                    "orchestrator dispatch binding count changed: "
                    f"{required} expected {expected_count}, got {actual_count}"
                )
        if '--ref "${TAG}"' in orchestrator:
            raise ValueError("publisher workflow must never be selected from a mutable tag ref")
        for required in ("main_run_id:", "source_sha:", "release-${{ inputs.source_sha }}"):
            if required not in publisher:
                raise ValueError(f"publisher dispatch interface lost: {required}")
        for forbidden in ("GITHUB_SHA", "GITHUB_REF_NAME", "@${GITHUB_REF}"):
            if forbidden in publisher:
                raise ValueError(f"publisher retained tag-selected or event-SHA authority: {forbidden}")

    @staticmethod
    def require_deadlines_and_concurrency(
        gate: str, codeql: str, orchestrator: str, publisher: str
    ) -> None:
        expected_deadlines = (
            (gate, (20, 10, 30, 15, 45, 30)),
            (codeql, (30,)),
            (orchestrator, (15,)),
            (publisher, (10, 10, 90)),
        )
        for workflow, minutes in expected_deadlines:
            actual = tuple(
                int(value)
                for value in re.findall(r"(?m)^    timeout-minutes: ([0-9]+)$", workflow)
            )
            if actual != minutes:
                raise ValueError(f"job deadlines changed: expected {minutes}, got {actual}")
        requirements = (
            (gate, "group: pr-gate-${{ github.event.pull_request.number || github.run_id }}"),
            (gate, "cancel-in-progress: true"),
            (codeql, "group: codeql-${{ github.event.pull_request.number || github.sha }}"),
            (codeql, "cancel-in-progress: true"),
            (orchestrator, "group: release-after-main-${{ github.event.workflow_run.head_sha }}"),
            (orchestrator, "cancel-in-progress: false"),
            (publisher, "group: release-${{ inputs.source_sha }}"),
            (publisher, "cancel-in-progress: false"),
        )
        for workflow, required in requirements:
            if required not in workflow:
                raise ValueError(f"source-SHA concurrency contract changed: {required}")
        if "github.ref" in codeql:
            raise ValueError("CodeQL main runs must not share a branch-ref cancellation key")

    def test_no_distinct_main_sha_can_be_canceled_or_share_release_identity(self):
        gate = (ROOT / ".github/workflows/pr-gate.yml").read_text(encoding="utf-8")
        codeql = (ROOT / ".github/workflows/codeql.yml").read_text(encoding="utf-8")
        orchestrator = (ROOT / ".github/workflows/release-after-main.yml").read_text(encoding="utf-8")
        publisher = (ROOT / ".github/workflows/release-publisher.yml").read_text(encoding="utf-8")
        contract = (ROOT / "scripts/ci/release_contract.py").read_text(encoding="utf-8")
        self.require_publication_identity_oracles(contract, publisher)
        tuple_contract_mutant = contract.replace(
            'EXPECTED_IMAGE = "ghcr.io/snaraj/naranjo-online"',
            'EXPECTED_IMAGE = "ghcr.io/snaraj/naranjo.online"',
            1,
        ).replace(
            'EXPECTED_CHART = "ghcr.io/snaraj/charts/naranjo-online"',
            'EXPECTED_CHART = "ghcr.io/snaraj/charts/naranjo.online"',
            1,
        )
        tuple_publisher_mutant = publisher.replace(
            "  IMAGE: ghcr.io/snaraj/naranjo-online",
            "  IMAGE: ghcr.io/snaraj/naranjo.online",
            1,
        ).replace(
            "  CHART: ghcr.io/snaraj/charts/naranjo-online",
            "  CHART: ghcr.io/snaraj/charts/naranjo.online",
            1,
        )
        bot_contract_mutant = contract.replace(
            'GITHUB_ACTIONS_BOT_LOGIN = "github-actions[bot]"',
            'GITHUB_ACTIONS_BOT_LOGIN = "foreign-writer"',
            1,
        ).replace(
            "GITHUB_ACTIONS_BOT_ID = 41898282",
            "GITHUB_ACTIONS_BOT_ID = 1",
            1,
        )
        for name, changed_contract, changed_publisher in (
            ("paired package config", tuple_contract_mutant, tuple_publisher_mutant),
            ("paired bot login and ID", bot_contract_mutant, publisher),
        ):
            with self.subTest(identity_oracle_mutant=name), self.assertRaises(ValueError):
                self.require_publication_identity_oracles(
                    changed_contract, changed_publisher
                )
        self.require_coverage_badge_fail_fast(gate)
        badge_mutants = (
            gate.replace(
                "        run: |\n          set -euo pipefail\n          pushd frontend",
                "        run: |\n          pushd frontend",
                1,
            ),
            gate.replace(
                "        run: |\n          set -euo pipefail\n          color()",
                "        run: |\n          color()",
                1,
            ),
            gate.replace('          cd "${work}" || exit 1', '          cd "${work}"', 1),
        )
        combined_badge_mutant = gate.replace(
            "        run: |\n          set -euo pipefail\n          pushd frontend",
            "        run: |\n          pushd frontend",
            1,
        ).replace(
            "        run: |\n          set -euo pipefail\n          color()",
            "        run: |\n          color()",
            1,
        ).replace('          cd "${work}" || exit 1', '          cd "${work}"', 1)
        for index, mutant in enumerate((*badge_mutants, combined_badge_mutant)):
            with self.subTest(coverage_badge_mutant=index), self.assertRaises(ValueError):
                self.require_coverage_badge_fail_fast(mutant)
        self.assertIn("github.event.pull_request.number || github.run_id", gate)
        self.assertNotIn("queue:", gate + orchestrator + publisher)
        self.assertIn("workflow_run:", orchestrator)
        self.assertIn("github.event.workflow_run.head_sha", orchestrator)
        self.assertIn("actions: write", orchestrator)
        self.assertIn("workflow_dispatch:", publisher)
        self.assertIn("source_sha:", publisher)
        self.assertNotRegex(publisher, r"(?ms)^\s+push:\s*\n\s+tags:")
        self.require_successful_main_privilege_boundary(orchestrator, publisher)
        package_mutants = (
            publisher.replace(
                f"  IMAGE: {RC.EXPECTED_IMAGE}",
                "  IMAGE: ghcr.io/snaraj/naranjo.online",
                1,
            ),
            publisher.replace(
                f"  CHART: {RC.EXPECTED_CHART}",
                "  CHART: ghcr.io/snaraj/charts/naranjo.online",
                1,
            ),
            publisher.replace('--image "${IMAGE}"', "", 1),
            publisher.replace('--chart "${CHART}"', "", 1),
        )
        for index, mutant in enumerate(package_mutants):
            with self.subTest(package_identity_mutant=index), self.assertRaises(ValueError):
                self.require_successful_main_privilege_boundary(orchestrator, mutant)
        self.require_deadlines_and_concurrency(gate, codeql, orchestrator, publisher)
        self.assertGreaterEqual(publisher.count("registry-state --http-status"), 2)
        self.assertGreaterEqual(publisher.count("--data-urlencode \"scope=repository:"), 2)
        self.assertGreaterEqual(publisher.count("docker-content-digest:"), 2)
        self.assertNotIn("if ! docker buildx imagetools inspect \"${IMAGE}:${TAG}\"", publisher)
        self.assertNotIn("if ! helm show chart", publisher)
        self.require_tag_partition(publisher)
        for mutation in (
            publisher.replace('manifests/${VERSION}', 'manifests/${TAG}'),
            publisher.replace('manifests/${VERSION}', 'manifests/v${VERSION}'),
            publisher.replace('--version "${version}"', '--version "v${version}"'),
        ):
            with self.assertRaises(ValueError):
                self.require_tag_partition(mutation)
        self.assertIn('helm package chart --version "${version}" --app-version "${version}"', publisher)
        self.assertNotIn("targetCommitish", publisher)
        self.assertIn('gh release create "${tag}" "${manifest}" --draft --verify-tag', publisher)
        self.require_exact_release_wiring(orchestrator, publisher)
        for value in ("false", "null", "enabled", ""):
            mutant = publisher.replace(
                "          sbom: true",
                f"          sbom: {value}" if value else "",
                1,
            )
            with self.subTest(sbom_producer_mutant=value or "removed"), self.assertRaises(
                ValueError
            ):
                self.require_exact_release_wiring(orchestrator, mutant)
        for owner, token in (
            ("orchestrator", "MAIN_RUN_ID: ${{ github.event.workflow_run.id }}"),
            ("orchestrator", "--ref main"),
            ("orchestrator", '-f main_run_id="${MAIN_RUN_ID}"'),
            ("publisher", "actions: read"),
            ("publisher", "main-run-record"),
            ("publisher", 'actions/runs/${MAIN_RUN_ID}'),
            ("publisher", '--run-id "${MAIN_RUN_ID}"'),
            ("publisher", '--repository "${GITHUB_REPOSITORY}"'),
            ("publisher", '--source-sha "${SOURCE_SHA}"'),
            ("publisher", 'test "${authorized_sha}" = "${SOURCE_SHA}"'),
            ("publisher", "needs: [authorize, immutable_settings]"),
            ("publisher", "needs.immutable_settings.result == 'success'"),
            ("publisher", "ref: ${{ needs.authorize.outputs.source_sha }}"),
            ("publisher", 'workflow-ref "${GITHUB_WORKFLOW_REF}"'),
            ("publisher", '--image "${IMAGE}"'),
            ("publisher", '--chart "${CHART}"'),
            ("publisher", "environment: platform-release"),
            ("publisher", "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0"),
            ("publisher", "app-id: ${{ vars.PLATFORM_RELEASE_APP_ID }}"),
            ("publisher", "private-key: ${{ secrets.PLATFORM_RELEASE_APP_PRIVATE_KEY }}"),
            ("publisher", "owner: ${{ github.repository_owner }}"),
            ("publisher", "repositories: ${{ github.event.repository.name }}"),
            ("publisher", "permission-administration: read"),
            ("publisher", "skip-token-revoke: false"),
            ("publisher", "IMMUTABLE_SETTINGS_TOKEN: ${{ steps.immutable_settings.outputs.token }}"),
            ("publisher", "release_contract.py settings-preflight"),
            ("publisher", "release_contract.py settings-receipt"),
        ):
            changed_orchestrator = orchestrator.replace(token, "", 1) if owner == "orchestrator" else orchestrator
            changed_publisher = publisher.replace(token, "", 1) if owner == "publisher" else publisher
            with self.subTest(main_run_mutation=token), self.assertRaises(ValueError):
                self.require_successful_main_privilege_boundary(changed_orchestrator, changed_publisher)
        with self.assertRaises(ValueError):
            self.require_successful_main_privilege_boundary(
                orchestrator.replace("--ref main", '--ref "${TAG}"', 1),
                publisher,
            )
        for poison in (
            "permission-administration: write",
            "skip-token-revoke: true",
        ):
            with self.subTest(settings_privilege_poison=poison), self.assertRaises(ValueError):
                self.require_successful_main_privilege_boundary(
                    orchestrator,
                    publisher.replace(
                        "permission-administration: read" if "administration" in poison else "skip-token-revoke: false",
                        poison,
                        1,
                    ),
                )
        publish_marker = "\n  publish:\n"
        for crossover in (
            "    app-id: ${{ vars.PLATFORM_RELEASE_APP_ID }}\n",
            "    private-key: ${{ secrets.PLATFORM_RELEASE_APP_PRIVATE_KEY }}\n",
            "    IMMUTABLE_SETTINGS_TOKEN: ${{ steps.immutable_settings.outputs.token }}\n",
        ):
            with self.subTest(token_crossover=crossover.strip()), self.assertRaises(ValueError):
                self.require_successful_main_privilege_boundary(
                    orchestrator,
                    publisher.replace(publish_marker, publish_marker + crossover, 1),
                )
        settings_marker = "\n  immutable_settings:\n"
        with self.assertRaises(ValueError):
            self.require_successful_main_privilege_boundary(
                orchestrator,
                publisher.replace(settings_marker, settings_marker + "    outputs:\n      token: leaked\n", 1),
            )
        workflow_mutants = (
            (gate.replace("    timeout-minutes: 20\n", "", 1), codeql, orchestrator, publisher),
            (gate, codeql.replace("github.sha", "github.ref", 1), orchestrator, publisher),
            (gate, codeql, orchestrator.replace("cancel-in-progress: false", "cancel-in-progress: true", 1), publisher),
            (gate, codeql, orchestrator, publisher.replace("group: release-${{ inputs.source_sha }}", "group: release-main", 1)),
            (gate, codeql, orchestrator, publisher.replace("    timeout-minutes: 90\n", "", 1)),
        )
        for mutation in workflow_mutants:
            with self.subTest(deadline_or_concurrency_mutant=True), self.assertRaises(ValueError):
                self.require_deadlines_and_concurrency(*mutation)
        for owner, token in (
            ("orchestrator", "fetch-depth: 0"),
            ("orchestrator", "release-window"),
            ("publisher", "tag-state"),
            ("publisher", "classify_tag exact >/dev/null"),
            ("publisher", "classify_tag absent >/dev/null"),
            ("publisher", 'tagger[name]=${tagger_name}'),
            ("publisher", 'tagger[email]=${tagger_email}'),
            ("publisher", 'tagger[date]=${tagger_date}'),
            ("publisher", "tag-record"),
            ("publisher", "      - name: Re-bind both public aliases and exact platform SBOMs before sealing evidence"),
            ("publisher", "            ${{ env.IMAGE }}:${{ steps.release.outputs.tag }}"),
            ("publisher", 'helm push "${RUNNER_TEMP}/${chart_name}-${version}.tgz" "oci://${CHART%/*}"'),
            ("publisher", 'test "${observed}" = "${expected}"'),
            ("publisher", "cosign attest --yes --statement"),
            ("publisher", "cosign verify-attestation --type slsaprovenance1 --output json"),
            ("publisher", "release-state"),
            ("publisher", "release-manifest"),
            ("publisher", "manifest-record"),
            ("publisher", "release-notes"),
            ("publisher", 'state="$(classify_release)"'),
            ("publisher", '[ "${state}" = prepared ]'),
            ("publisher", '[ "${state}" = staged ]'),
            ("publisher", 'gh release create "${tag}" "${manifest}" --draft --verify-tag'),
            ("publisher", 'gh release upload "${tag}" "${manifest}"'),
            ("publisher", 'gh release edit "${tag}" --draft=false'),
            ("publisher", 'test "${upload_verified}" = true'),
            ("publisher", "verify_asset_bytes"),
            ("publisher", 'cmp --silent "${manifest}" "${observed}"'),
            ("publisher", "/releases/tags/${tag}"),
            ("publisher", "X-GitHub-Api-Version: 2026-03-10"),
            ("publisher", "for attempt in 1 2 3 4 5"),
            ("publisher", 'test "${race_verified}" = true'),
            ("publisher", "Re-bind the immutable Release to the exact annotated tag"),
            ("publisher", "terminal-tag-ref.json"),
            ("publisher", "terminal-tag-object.json"),
            ("publisher", "terminal-release.json"),
            ("publisher", "terminal-release-manifest.json"),
            ("publisher", 'cmp --silent "${manifest}" "${observed_manifest}"'),
            ("publisher", "attestation-statement"),
            ("publisher", "attestation-set"),
        ):
            changed_orchestrator = orchestrator.replace(token, "") if owner == "orchestrator" else orchestrator
            changed_publisher = publisher.replace(token, "") if owner == "publisher" else publisher
            with self.subTest(wiring_mutation=token), self.assertRaises(ValueError):
                self.require_exact_release_wiring(changed_orchestrator, changed_publisher)
        exact_image_tag = "            ${{ env.IMAGE }}:${{ steps.release.outputs.tag }}"
        exact_chart_target = '"oci://${CHART%/*}"'
        alias_heading = (
            "      - name: Re-bind both public aliases and exact platform SBOMs before sealing evidence"
        )
        manifest_heading = "      - name: Build the deterministic release evidence manifest"
        displaced_alias = publisher.replace(alias_heading, "      - name: Displaced alias proof", 1)
        displaced_alias = displaced_alias.replace(
            manifest_heading, manifest_heading + "\n" + alias_heading, 1
        )
        for mutant_name, mutation in (
            (
                "foreign image alias",
                publisher.replace(exact_image_tag, "            ghcr.io/foreign/repo:latest", 1),
            ),
            (
                "extra image alias",
                publisher.replace(
                    exact_image_tag,
                    exact_image_tag + "\n            ghcr.io/foreign/repo:latest",
                    1,
                ),
            ),
            (
                "foreign chart alias",
                publisher.replace(exact_chart_target, '"oci://ghcr.io/foreign/charts"', 1),
            ),
            ("alias proof moved after manifest", displaced_alias),
        ):
            with self.subTest(registry_alias_mutant=mutant_name), self.assertRaises(ValueError):
                self.require_exact_release_wiring(orchestrator, mutation)
        for forbidden in (
            "tag-state",
            "gh api --method POST",
            "gh release create",
            "cosign sign",
            "helm push",
        ):
            with self.subTest(orchestrator_mutation=forbidden), self.assertRaises(ValueError):
                self.require_exact_release_wiring(orchestrator + forbidden, publisher)
        for forbidden in ("cosign download attestation", 'git rev-list -n 1 "${tag}"'):
            with self.subTest(forbidden_mutation=forbidden), self.assertRaises(ValueError):
                self.require_exact_release_wiring(orchestrator, publisher + forbidden)
        template = (ROOT / ".github/PULL_REQUEST_TEMPLATE.md").read_text(encoding="utf-8")
        for required in (
            "Closes #",
            "Protected base",
            "Exact head",
            "Next patch release",
            "Exact PR-gate jobs + exact-SHA CodeQL run/jobs and manual/unmerged dispatch denial",
            "Post-push image/chart alias rebind + strict raw platform SBOM hostile suite",
            "Deterministic manifest, dev-dependency vulnerability policy, and recurring alias-audit hostile suite",
            "Author applies `requires-review`",
            "reviewer removes it with either verdict",
            "VERDICT: APPROVE",
            "mutation and claim-audit",
            "(adversarial reviewer)",
            "Main Worker exact-head bounded receipt",
        ):
            self.assertIn(required, template)

    def test_vulnerability_policy_and_recurring_alias_audit_are_closed_and_load_bearing(self):
        gate = (ROOT / ".github/workflows/pr-gate.yml").read_text(encoding="utf-8")
        publisher = (ROOT / ".github/workflows/release-publisher.yml").read_text(encoding="utf-8")
        audit = (ROOT / ".github/workflows/release-audit.yml").read_text(encoding="utf-8")
        installer = (ROOT / "scripts/ci/install-tools.sh").read_text(encoding="utf-8")
        self.require_vulnerability_and_alias_audit(gate, publisher, audit, installer)
        mutants = (
            (gate.replace("--severity HIGH,CRITICAL", "--severity CRITICAL", 1), publisher, audit, installer),
            (gate.replace(" --include-dev-deps", "", 1), publisher, audit, installer),
            (gate, publisher.replace(" --include-dev-deps", "", 1), audit, installer),
            (gate, publisher, audit.replace(" --include-dev-deps", "", 1), installer),
            (gate, publisher.replace("--ignore-unfixed=false", "--ignore-unfixed=true", 1), audit, installer),
            (gate, publisher, audit.replace("cron: '17 8 * * 1'", "cron: '17 8 * * 0'", 1), installer),
            (gate, publisher, audit.replace("packages: read", "packages: write", 1), installer),
            (gate, publisher, audit.replace('"${IMAGE}@${image_digest}"', '"${IMAGE}:${tag}"'), installer),
            (gate, publisher, audit.replace('"${CHART}@${chart_digest}"', '"${CHART}:${version}"'), installer),
            (gate, publisher, audit.replace("release-record", "", 1), installer),
            (gate, publisher, audit.replace("main-run-record", "", 1), installer),
            (gate, publisher, audit.replace("tag-record", "", 1), installer),
            (gate, publisher, audit.replace("attestation-set", "", 1), installer),
            (gate, publisher, audit.replace("diff -ru --no-dereference", "true #", 1), installer),
            (gate, publisher, audit + "\n      contents: write\n", installer),
            (gate, publisher, audit + "\n      gh api --method POST foreign\n", installer),
            (gate, publisher, audit, installer.replace("TRIVY_SHA256=", "TRIVY_SHA256_MUTATED=", 1)),
            (gate, publisher, audit, installer + "\n# aquasecurity/trivy-action@v0.36.0\n"),
        )
        for index, mutant in enumerate(mutants):
            with self.subTest(hostile_mutant=index), self.assertRaises(ValueError):
                self.require_vulnerability_and_alias_audit(*mutant)


if __name__ == "__main__":
    unittest.main()
