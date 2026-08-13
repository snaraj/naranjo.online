"""Hostile tests for the per-main-merge release contract."""

from __future__ import annotations

import base64
import contextlib
import copy
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
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
            intent = RC.validate_publisher(root, self.SHA, self.SHA, "refs/tags/v0.1.10", "workflow_dispatch")
            self.assertEqual(intent, RC.ReleaseIntent(self.SHA, RC.Version.parse("0.1.10")))
            for source, github, ref, event_name in (
                ("b" * 40, self.SHA, "refs/tags/v0.1.10", "workflow_dispatch"),
                (self.SHA, "b" * 40, "refs/tags/v0.1.10", "workflow_dispatch"),
                (self.SHA, self.SHA, "refs/tags/0.1.10", "workflow_dispatch"),
                (self.SHA, self.SHA, "refs/tags/v0.1.10", "push"),
            ):
                with self.subTest(source=source, github=github, ref=ref, event=event_name), self.assertRaises(RC.ContractError):
                    RC.validate_publisher(root, source, github, ref, event_name)


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

    def test_release_metadata_and_zero_asset_inventory_are_exact(self):
        exact = {
            "tag_name": self.TAG,
            "name": f"naranjo.online {self.TAG}",
            "body": "exact notes\n",
            "draft": False,
            "prerelease": False,
            "assets": [],
        }
        RC.validate_release_record(exact, tag=self.TAG, title=f"naranjo.online {self.TAG}", body="exact notes")
        for key, value in (
            ("tag_name", "v0.1.11"),
            ("name", "foreign"),
            ("body", "foreign"),
            ("body", None),
            ("draft", True),
            ("prerelease", True),
            ("assets", [{"name": "foreign.bin"}]),
            ("assets", None),
        ):
            changed = copy.deepcopy(exact)
            changed[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(RC.ContractError):
                RC.validate_release_record(changed, tag=self.TAG, title=f"naranjo.online {self.TAG}", body="exact notes")


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

    def release(self) -> dict[str, object]:
        return {
            "tag_name": self.TAG,
            "name": f"naranjo.online {self.TAG}",
            "body": "exact notes\n",
            "draft": False,
            "prerelease": False,
            "assets": [],
        }

    def test_absent_create_verify_and_concurrent_retry_need_no_local_tag_ref(self):
        ref, tag = exact_tag_records(self.TAG, self.SOURCE, self.MESSAGE, self.DATE)
        # Both racers can observe absence. The winner creates the exact REST
        # records; the loser re-queries those records after its create fails.
        self.assertEqual(RC.classify_tag_state(404, None, None, **self.tag_expected()), "absent")
        self.assertEqual(RC.classify_tag_state(404, None, None, **self.tag_expected()), "absent")
        self.assertEqual(RC.classify_tag_state(200, ref, tag, **self.tag_expected()), "exact")
        self.assertEqual(RC.classify_tag_state(200, ref, tag, **self.tag_expected()), "exact")

        expected_release = self.release()
        for _racer in range(2):
            self.assertEqual(
                RC.classify_release_state(
                    404, None, tag=self.TAG, title=f"naranjo.online {self.TAG}", body="exact notes"
                ),
                "absent",
            )
        for _retry in range(2):
            self.assertEqual(
                RC.classify_release_state(
                    200,
                    expected_release,
                    tag=self.TAG,
                    title=f"naranjo.online {self.TAG}",
                    body="exact notes",
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
                    status, None, tag=self.TAG, title=f"naranjo.online {self.TAG}", body="exact notes"
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
            )

    def test_exact_shell_state_assertions_kill_deletion_and_inversion_mutants(self):
        for state in ("absent", "exact"):
            self.assertEqual(RC.require_publication_state(state, state), state)
        for actual, required in (("absent", "exact"), ("exact", "absent"), ("foreign", "exact")):
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


class WorkflowStructureTests(unittest.TestCase):
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
            "tag-state",
            "classify_tag exact >/dev/null",
            "classify_tag absent >/dev/null",
            'tagger[name]=${tagger_name}',
            'tagger[email]=${tagger_email}',
            'tagger[date]=${tagger_date}',
        ):
            if required not in orchestrator:
                raise ValueError(f"orchestrator lost exact release wiring: {required}")
        for required in (
            "tag-record",
            "cosign attest --yes --statement",
            "cosign verify-attestation --type slsaprovenance1 --output json",
            "release-state",
            "classify_release exact >/dev/null",
            "classify_release absent >/dev/null",
            "/releases/tags/${tag}",
            "for attempt in 1 2 3 4 5",
            'test "${race_verified}" = true',
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
        if orchestrator.count("classify_tag exact >/dev/null") < 3:
            raise ValueError("orchestrator must verify exact tag state before reuse, after a race, and after create")
        if publisher.count("classify_release exact >/dev/null") < 3:
            raise ValueError("publisher must verify exact Release state before reuse, after a race, and after create")
        for forbidden in ("cosign download attestation", 'git rev-list -n 1 "${tag}"'):
            if forbidden in publisher:
                raise ValueError(f"publisher contains unauthenticated or local-ref verifier: {forbidden}")

    def test_no_distinct_main_sha_can_be_canceled_or_share_release_identity(self):
        gate = (ROOT / ".github/workflows/pr-gate.yml").read_text(encoding="utf-8")
        orchestrator = (ROOT / ".github/workflows/release-after-main.yml").read_text(encoding="utf-8")
        publisher = (ROOT / ".github/workflows/release-publisher.yml").read_text(encoding="utf-8")
        self.assertIn("github.event.pull_request.number || github.run_id", gate)
        self.assertNotIn("queue:", gate + orchestrator + publisher)
        self.assertIn("workflow_run:", orchestrator)
        self.assertIn("github.event.workflow_run.head_sha", orchestrator)
        self.assertIn("actions: write", orchestrator)
        self.assertIn("workflow_dispatch:", publisher)
        self.assertIn("source_sha:", publisher)
        self.assertNotRegex(publisher, r"(?ms)^\s+push:\s*\n\s+tags:")
        self.assertIn("--ref \"${TAG}\"", orchestrator)
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
        self.assertIn('gh release create "${tag}" --verify-tag', publisher)
        self.require_exact_release_wiring(orchestrator, publisher)
        for owner, token in (
            ("orchestrator", "fetch-depth: 0"),
            ("orchestrator", "release-window"),
            ("orchestrator", "tag-state"),
            ("orchestrator", "classify_tag exact >/dev/null"),
            ("orchestrator", "classify_tag absent >/dev/null"),
            ("orchestrator", 'tagger[name]=${tagger_name}'),
            ("orchestrator", 'tagger[email]=${tagger_email}'),
            ("orchestrator", 'tagger[date]=${tagger_date}'),
            ("publisher", "tag-record"),
            ("publisher", "cosign attest --yes --statement"),
            ("publisher", "cosign verify-attestation --type slsaprovenance1 --output json"),
            ("publisher", "release-state"),
            ("publisher", "classify_release exact >/dev/null"),
            ("publisher", "classify_release absent >/dev/null"),
            ("publisher", "/releases/tags/${tag}"),
            ("publisher", "for attempt in 1 2 3 4 5"),
            ("publisher", 'test "${race_verified}" = true'),
            ("publisher", "attestation-statement"),
            ("publisher", "attestation-set"),
        ):
            changed_orchestrator = orchestrator.replace(token, "", 1) if owner == "orchestrator" else orchestrator
            changed_publisher = publisher.replace(token, "", 1) if owner == "publisher" else publisher
            with self.subTest(wiring_mutation=token), self.assertRaises(ValueError):
                self.require_exact_release_wiring(changed_orchestrator, changed_publisher)
        for forbidden in ("cosign download attestation", 'git rev-list -n 1 "${tag}"'):
            with self.subTest(forbidden_mutation=forbidden), self.assertRaises(ValueError):
                self.require_exact_release_wiring(orchestrator, publisher + forbidden)
        template = (ROOT / ".github/PULL_REQUEST_TEMPLATE.md").read_text(encoding="utf-8")
        for required in ("Closes #", "Protected base", "Exact head", "Next patch release", "requires-review", "architecture sanity review"):
            self.assertIn(required, template)


if __name__ == "__main__":
    unittest.main()
