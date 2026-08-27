"""Three narrow refusals in `.github/workflows/` -- and deliberately no step
inventory.

WHAT THIS REFUSES. Each rule names ONE construct that silently changes what a
gate means, rather than one that merely changes what a gate does:

  1. `continue-on-error: true` on a job or step in the required-checks set.
     It converts a red gate into a green one with no other visible change. The
     release publisher authorizes against `pr-gate.yml`'s exact job inventory
     and CodeQL's exact run/job inventory, and both read a CONCLUSION. A job
     that fails but is told to continue still reports `success`, so this one
     key is the difference between "the gate passed" and "the gate ran".

  2. A step-level `env:` key that SHADOWS a workflow- or job-level declaration
     of the same key. Scope precedence means the innermost wins silently, so a
     step can run against a different value than the one every reader sees
     declared above it -- while the outer declaration still reads correct.
     `GO_COVERAGE_FLOOR` and `SOURCE_SHA` are the sharp cases here: a shadowed
     floor passes any coverage, and a shadowed source SHA lets a step act on a
     commit other than the authorized one.

  3. A custom `shell:` on a step in the required-checks set. The runner default
     for `run:` on Linux is `bash -e {0}`, and this repository's convention is
     to open every `run: |` block with `set -euo pipefail`. A custom shell
     changes failure semantics underneath that convention -- `shell: sh` drops
     `pipefail` support entirely, so a failing command mid-pipeline stops being
     a failing step.

WHAT THIS DELIBERATELY DOES NOT DO -- READ THIS BEFORE "COMPLETING" IT.

There is no closed step inventory here. This gate will never assert "the chart
job has exactly these N steps", "the workflows declare exactly these job
names", or "these are all the env keys". That pin is tempting because it looks
thorough, and it is precisely the failure mode this gate was written to avoid:
an exhaustive-inventory assertion breaks on every legitimate addition, so it
burns a release cycle per discovery, teaches whoever hits it to update the pin
rather than think about the change, and converts a security control into a
chore. A validator in the sibling platform lane pinned a pristine object shape
and spent six releases, six owner merges and six cluster slots learning -- one
per cycle -- that Flux writes ownership labels, Calico writes pod annotations,
and the Deployment controller writes `pod-template-hash`. Every one of those
refusals was individually correct and collectively a waste.

So: pin BEHAVIOUR, not inventory. Refuse a specific dangerous construct;
never assert that the complete set of anything is exactly X, when normal
evolution extends it. Adding a step, a job, or an env key must need no edit
here. If you are about to add an inventory assertion to this file, add a rule
that refuses a construct instead -- and give it a lift path.

The one thing this file DOES enumerate is derived, not maintained: the
required-checks set comes from `EXPECTED_MAIN_JOBS` and `EXPECTED_CODEQL_JOBS`
in `release_contract.py`, which the release contract already keeps exact
because the publisher authorizes against them. Reading them here adds no
second copy to keep in sync.

LIFTING IT. Every refusal lifts through
`scripts/ci/workflow-integrity-allowlist.txt`: one line, one written reason,
one PR. Steps are located by NAME, not index, so an entry survives a step
being inserted above it.

PARSING. `python3 -I` runs isolated with no site-packages, so there is no
`yaml` module; `dependabot_contract.py`'s parser is deliberately conservative
and refuses comments, which every workflow here has. This file therefore
carries a small structural reader that understands exactly what these rules
need: indentation, block scalars, and comments. It fails CLOSED -- a workflow
it cannot resolve into jobs and steps fails the suite rather than passing
quietly, which is the only safe direction for a reader a gate depends on.
"""

from __future__ import annotations

import importlib.util
import re
import sys
import unittest
from dataclasses import dataclass, field
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
INSTALL_TOOLS = HERE / "install-tools.sh"
ALLOWLIST = HERE / "workflow-integrity-allowlist.txt"

SPEC = importlib.util.spec_from_file_location("release_contract", HERE / "release_contract.py")
assert SPEC and SPEC.loader
RC = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = RC
SPEC.loader.exec_module(RC)

RULES = ("continue-on-error", "env-shadow", "custom-shell")
BLOCK_SCALAR = re.compile(r":\s*[|>][+-]?\d*\s*$")


# --------------------------------------------------------------------------
# A small structural reader for GitHub workflow YAML
# --------------------------------------------------------------------------


# A key's value together with the line it was declared on. Every rule below
# reports the line of the OFFENDING KEY, never the line of the job or step
# that contains it: a message that points at `chart:` when the problem is a
# `continue-on-error:` three lines below sends the next agent to the wrong
# place, and "exactly what to fix and where" is the whole point of the
# message.
Keyed = tuple[str, int]


@dataclass
class Step:
    name: str
    line: int
    shell: Keyed | None = None
    continue_on_error: Keyed | None = None
    env: dict[str, int] = field(default_factory=dict)


@dataclass
class Job:
    name: str
    line: int
    continue_on_error: Keyed | None = None
    env: dict[str, int] = field(default_factory=dict)
    steps: list[Step] = field(default_factory=list)


@dataclass
class Workflow:
    path: Path
    env: dict[str, int] = field(default_factory=dict)
    jobs: dict[str, Job] = field(default_factory=dict)

    @property
    def name(self) -> str:
        return self.path.name


def _strip_comment(line: str) -> str:
    """Cut an unquoted `#` comment. Quote state is tracked per line."""
    single = double = False
    for index, char in enumerate(line):
        if char == "'" and not double:
            single = not single
        elif char == '"' and not single:
            double = not double
        elif char == "#" and not single and not double and (index == 0 or line[index - 1] in " \t"):
            return line[:index]
    return line


def structural_lines(text: str) -> list[tuple[int, int, str]]:
    """Return (lineno, indent, content) for lines that carry YAML structure.

    Block-scalar bodies -- everything under a `run: |` -- are skipped whole.
    That is load-bearing rather than tidy: those bodies are shell scripts full
    of `#` comments and lines that look like `env:` or `shell:` keys, and
    parsing them as structure would invent constructs that do not exist.
    """
    out: list[tuple[int, int, str]] = []
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        raw = lines[index]
        index += 1
        stripped = _strip_comment(raw)
        if not stripped.strip():
            continue
        indent = len(stripped) - len(stripped.lstrip(" "))
        content = stripped.strip()
        out.append((index, indent, content))
        if BLOCK_SCALAR.search(stripped):
            # Consume the body: every following blank line, or line indented
            # deeper than the key that opened it.
            while index < len(lines):
                body = lines[index]
                if body.strip() and (len(body) - len(body.lstrip(" "))) <= indent:
                    break
                index += 1
    return out


def _key(content: str) -> tuple[str, str] | None:
    """Split `key: value` into (key, value); None when the line is not a key."""
    match = re.match(r"^([A-Za-z_][\w.-]*)\s*:\s*(.*)$", content)
    if not match:
        return None
    return match.group(1), match.group(2).strip()


def _mapping_keys(rows: list[tuple[int, int, str]], start: int, indent: int) -> dict[str, int]:
    """Collect `key: value` names declared at exactly `indent`, from `start`."""
    keys: dict[str, int] = {}
    for lineno, row_indent, content in rows[start:]:
        if row_indent < indent:
            break
        if row_indent != indent:
            continue
        parsed = _key(content)
        if parsed:
            keys[parsed[0]] = lineno
    return keys


def read_workflow(path: Path) -> Workflow:
    """Resolve a workflow file into its env, jobs, and steps."""
    return parse_workflow(path.read_text(encoding="utf-8"), path)


def _parse_synthetic(text: str) -> Workflow:
    """Parse workflow TEXT through the identical reader the gate uses.

    The synthetic-fixture tests must exercise the same code path as the real
    sweep; a separate parser for tests would prove nothing about the sweep.
    """
    return parse_workflow(text, WORKFLOWS / "<synthetic>.yml")


def parse_workflow(text: str, path: Path) -> Workflow:
    """Resolve workflow text into its env, jobs, and steps. Fails closed."""
    rows = structural_lines(text)
    workflow = Workflow(path=path)

    for position, (_, indent, content) in enumerate(rows):
        if indent != 0:
            continue
        parsed = _key(content)
        if not parsed:
            continue
        key, value = parsed
        if key == "env" and not value:
            workflow.env = _mapping_keys(rows, position + 1, _child_indent(rows, position))
        elif key == "jobs" and not value:
            _read_jobs(rows, position, workflow)

    if not workflow.jobs:
        raise AssertionError(
            f"{path.relative_to(ROOT)}: the structural reader resolved no jobs. "
            f"This gate refuses to pass on a workflow it cannot read."
        )
    return workflow


def _child_indent(rows: list[tuple[int, int, str]], position: int) -> int:
    """The indent of the first row nested under `rows[position]`."""
    parent = rows[position][1]
    for _, indent, _ in rows[position + 1 :]:
        if indent > parent:
            return indent
        break
    return parent + 2


def _read_jobs(rows: list[tuple[int, int, str]], jobs_at: int, workflow: Workflow) -> None:
    job_indent = _child_indent(rows, jobs_at)
    for position, (lineno, indent, content) in enumerate(rows[jobs_at + 1 :], start=jobs_at + 1):
        if indent < job_indent:
            break
        if indent != job_indent:
            continue
        parsed = _key(content)
        if not parsed or parsed[1]:
            continue
        job = Job(name=parsed[0], line=lineno)
        _read_job_body(rows, position, job_indent, job)
        workflow.jobs[job.name] = job


def _read_job_body(rows, job_at: int, job_indent: int, job: Job) -> None:
    prop_indent = _child_indent(rows, job_at)
    for position, (lineno, indent, content) in enumerate(rows[job_at + 1 :], start=job_at + 1):
        if indent <= job_indent:
            break
        if indent != prop_indent:
            continue
        parsed = _key(content)
        if not parsed:
            continue
        key, value = parsed
        if key == "continue-on-error":
            job.continue_on_error = (value, lineno)
        elif key == "env" and not value:
            job.env = _mapping_keys(rows, position + 1, _child_indent(rows, position))
        elif key == "steps" and not value:
            _read_steps(rows, position, prop_indent, job)


def _read_steps(rows, steps_at: int, prop_indent: int, job: Job) -> None:
    """Read the step list. Items start with `- `; properties align after it."""
    for position, (lineno, indent, content) in enumerate(rows[steps_at + 1 :], start=steps_at + 1):
        if indent <= prop_indent:
            break
        if not content.startswith("- "):
            continue
        step_indent = indent + 2
        first = _key(content[2:].strip())
        step = Step(name=(first[1].strip("\"'") if first and first[0] == "name" else ""), line=lineno)
        # A step written as `- shell: sh` carries the key on the item line
        # itself, so that line IS the key's line.
        if first and first[0] == "shell":
            step.shell = (first[1], lineno)
        if first and first[0] == "continue-on-error":
            step.continue_on_error = (first[1], lineno)
        for inner, (inner_line, inner_indent, inner_content) in enumerate(
            rows[position + 1 :], start=position + 1
        ):
            if inner_indent < step_indent:
                break
            if inner_indent != step_indent:
                continue
            parsed = _key(inner_content)
            if not parsed:
                continue
            key, value = parsed
            if key == "name" and not step.name:
                step.name = value.strip("\"'")
            elif key == "shell":
                step.shell = (value, inner_line)
            elif key == "continue-on-error":
                step.continue_on_error = (value, inner_line)
            elif key == "env" and not value:
                step.env = _mapping_keys(rows, inner + 1, _child_indent(rows, inner))
        if not step.name:
            step.name = f"<unnamed step at line {lineno}>"
        job.steps.append(step)


# --------------------------------------------------------------------------
# The required-checks set, DERIVED from the release contract
# --------------------------------------------------------------------------


def required_jobs(workflow: Workflow) -> set[str]:
    """Which of this workflow's jobs the release publisher authorizes against.

    Derived from `release_contract.py`, never re-listed here. `pr-gate.yml`
    job IDs appear verbatim in `EXPECTED_MAIN_JOBS`. CodeQL's expected names
    are matrix-expanded (`analyze (go, manual)`), so a job ID counts when an
    expected name is that ID or begins `<id> (`.
    """
    if workflow.name == "pr-gate.yml":
        return {job for job in workflow.jobs if job in RC.EXPECTED_MAIN_JOBS}
    if workflow.name == "codeql.yml":
        return {
            job
            for job in workflow.jobs
            for expected in RC.EXPECTED_CODEQL_JOBS
            if expected == job or expected.startswith(f"{job} (")
        }
    return set()


def pinned_tool_variables() -> set[str]:
    """Names `install-tools.sh` pins -- tool versions and their checksums."""
    text = INSTALL_TOOLS.read_text(encoding="utf-8")
    return set(re.findall(r"^([A-Z][A-Z0-9_]*(?:_VERSION|_SHA256))=", text, flags=re.MULTILINE))


# --------------------------------------------------------------------------
# Allowlist -- the lift mechanism
# --------------------------------------------------------------------------


def read_allowlist(text: str | None = None) -> dict[tuple[str, str, str], str]:
    """Parse `<workflow> | <rule> | <where> | <reason>` lines.

    `text` exists so these refusals are TESTABLE without writing a broken line
    into the real allowlist. A parser whose only probe is "edit the file it
    guards and see what happens" is a parser nobody re-checks; the shipped call
    passes nothing and reads the file exactly as before.
    """
    entries: dict[tuple[str, str, str], str] = {}
    if text is None:
        text = ALLOWLIST.read_text(encoding="utf-8")
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [part.strip() for part in line.split("|")]
        if len(parts) != 4:
            raise AssertionError(
                f"{ALLOWLIST.relative_to(ROOT)}:{number}: expected exactly four "
                f"`|`-separated fields -- `<workflow> | <rule> | <where> | <reason>`."
            )
        workflow, rule, where, reason = parts
        if not all((workflow, rule, where, reason)):
            raise AssertionError(
                f"{ALLOWLIST.relative_to(ROOT)}:{number}: every field must be "
                f"non-empty. An allowlist without reasons is a mute button."
            )
        if rule not in RULES:
            raise AssertionError(
                f"{ALLOWLIST.relative_to(ROOT)}:{number}: unknown rule {rule!r}; "
                f"expected one of {', '.join(RULES)}."
            )
        entries[(workflow, rule, where)] = reason
    return entries


def lift_instruction(workflow: str, rule: str, where: str) -> str:
    return (
        f"\n\nTo lift this refusal, add ONE line to "
        f"{ALLOWLIST.relative_to(ROOT).as_posix()}:\n\n"
        f"    {workflow} | {rule} | {where} | <why this construct is correct here>\n\n"
        f"Widening this allowlist is a normal, expected part of active "
        f"development -- one line, one PR, no release train. Prefer removing "
        f"the construct when it is not load-bearing."
    )


def all_workflows() -> list[Workflow]:
    return [read_workflow(path) for path in sorted(WORKFLOWS.glob("*.yml"))]


# --------------------------------------------------------------------------


class WorkflowIntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.workflows = all_workflows()
        cls.allowlist = read_allowlist()

    # -- the reader itself must not pass vacuously ---------------------------

    def test_every_workflow_resolves_into_jobs_and_steps(self):
        """Fail closed if the structural reader stops seeing structure.

        A floor of one, never a count: this proves the reader works, without
        pinning how many jobs or steps any workflow has.
        """
        self.assertTrue(self.workflows, "no workflows were discovered")
        for workflow in self.workflows:
            with self.subTest(workflow=workflow.name):
                self.assertTrue(workflow.jobs, "resolved no jobs")
                self.assertTrue(
                    any(job.steps for job in workflow.jobs.values()),
                    "resolved no steps in any job",
                )

    def test_the_required_checks_set_is_non_empty(self):
        """The rules below are scoped by this set; an empty one disarms them."""
        covered = {w.name: required_jobs(w) for w in self.workflows}
        self.assertTrue(
            covered.get("pr-gate.yml"), "no required jobs resolved for pr-gate.yml"
        )
        self.assertTrue(
            covered.get("codeql.yml"), "no required jobs resolved for codeql.yml"
        )

    def test_the_reader_ignores_constructs_inside_a_run_block(self):
        """A `shell:` line inside a shell script is text, not a step key.

        Without block-scalar skipping this gate would invent violations from
        the bash it is reading over -- and an agent would then "fix" a script.
        """
        synthetic = (
            "jobs:\n"
            "  gate:\n"
            "    steps:\n"
            "      - name: Probe\n"
            "        run: |\n"
            "          # shell: sh\n"
            "          printf 'continue-on-error: true\\n'\n"
            "          env:\n"
            "            NOT_A_KEY: 1\n"
        )
        rows = structural_lines(synthetic)
        contents = [content for _, _, content in rows]
        self.assertNotIn("# shell: sh", contents)
        self.assertNotIn("env:", contents)
        self.assertIn("- name: Probe", contents)

    def test_the_reader_sees_a_real_step_key(self):
        """The positive control for the test above.

        Block-scalar skipping must hide only what is INSIDE a `run:` body. If
        it also swallowed genuine step keys, all three rules would silently
        stop finding anything and this suite would pass on any workflow.
        """
        synthetic = (
            "jobs:\n"
            "  gate:\n"
            "    steps:\n"
            "      - name: Probe\n"
            "        shell: sh\n"
            "        continue-on-error: true\n"
            "        env:\n"
            "          REAL_KEY: 1\n"
            "        run: |\n"
            "          shell: hidden\n"
            "      - uses: ./.github/actions/probe\n"
            "        name: Named On An Inner Line\n"
        )
        job = _parse_synthetic(synthetic).jobs["gate"]
        step = job.steps[0]
        self.assertEqual(step.name, "Probe")
        # Value AND the line the key sits on -- the failure messages report
        # the key's own line, so parsing it wrong would misdirect the reader.
        self.assertEqual(step.shell, ("sh", 5))
        self.assertEqual(step.continue_on_error, ("true", 6))
        self.assertEqual(sorted(step.env), ["REAL_KEY"])
        # A step may open with `uses:` and carry its name on an inner line.
        # Every rule keys its allowlist entry on `<job>/<step name>`, so a name
        # resolved ONLY from the `- ` item line would report such a step as
        # `<unnamed step at line N>` and force a line-number-brittle entry --
        # exactly the inventory pin this file refuses to become. No workflow
        # here is written that way today, which is why the branch survived the
        # 0.1.49 mutation sweep until this fixture landed.
        self.assertEqual(job.steps[1].name, "Named On An Inner Line")

    # -- rule 1: continue-on-error ------------------------------------------

    def test_no_required_check_continues_on_error(self):
        """`continue-on-error: true` turns a red required gate green."""
        for workflow in self.workflows:
            for name in sorted(required_jobs(workflow)):
                job = workflow.jobs[name]
                self._refuse_continue_on_error(workflow, job.continue_on_error, name)
                for step in job.steps:
                    self._refuse_continue_on_error(
                        workflow, step.continue_on_error, f"{name}/{step.name}"
                    )

    def _refuse_continue_on_error(self, workflow, keyed, where):
        if keyed is None:
            return
        value, line = keyed
        if value.strip().strip("\"'").lower() != "true":
            return
        if (workflow.name, "continue-on-error", where) in self.allowlist:
            return
        self.fail(
            f"{workflow.path.relative_to(ROOT)}:{line}: `continue-on-error: true` on "
            f"{where}, which is in the required-checks set the release publisher "
            f"authorizes against. A job that fails but continues still reports "
            f"`success`, so this converts a red gate into a green one with no "
            f"other visible change."
            + lift_instruction(workflow.name, "continue-on-error", where)
        )

    # -- rule 2: env shadowing ----------------------------------------------

    def test_no_step_env_shadows_an_outer_declaration(self):
        """Innermost scope wins silently, so a shadowed pin reads correct."""
        pinned = pinned_tool_variables()
        self.assertTrue(pinned, "no pinned tool variables read from install-tools.sh")
        for workflow in self.workflows:
            for job_name, job in workflow.jobs.items():
                outer = {**workflow.env, **job.env}
                for step in job.steps:
                    for key, line in sorted(step.env.items()):
                        where = f"{job_name}/{step.name}/{key}"
                        if (workflow.name, "env-shadow", where) in self.allowlist:
                            continue
                        if key in outer:
                            # Name the scope `outer[key]`'s line actually came
                            # from. `job.env` wins the merge above, so a key
                            # declared at BOTH levels must report `job` -- the
                            # innermost declaration being shadowed -- or the
                            # message points a reader at the wrong line.
                            scope = "job" if key in job.env else "workflow"
                            self.fail(
                                f"{workflow.path.relative_to(ROOT)}:{line}: step-level "
                                f"`env: {key}` shadows the {scope}-level declaration at "
                                f"line {outer[key]}. The inner value wins silently, so "
                                f"this step can run against a value no reader of the "
                                f"outer declaration would expect -- while the outer "
                                f"declaration still reads correct."
                                + lift_instruction(workflow.name, "env-shadow", where)
                            )
                        if key in pinned:
                            self.fail(
                                f"{workflow.path.relative_to(ROOT)}:{line}: step-level "
                                f"`env: {key}` redeclares a tool pin that "
                                f"`scripts/ci/install-tools.sh` owns. A workflow that "
                                f"sets a pinned version or checksum name can run an "
                                f"unpinned tool while the pin in install-tools.sh "
                                f"still reads correct."
                                + lift_instruction(workflow.name, "env-shadow", where)
                            )

    # -- rule 3: custom shell ------------------------------------------------

    def test_no_gate_step_sets_a_custom_shell(self):
        """A custom shell changes failure semantics under `set -euo pipefail`."""
        for workflow in self.workflows:
            for name in sorted(required_jobs(workflow)):
                job = workflow.jobs[name]
                for step in job.steps:
                    if step.shell is None:
                        continue
                    shell, line = step.shell
                    where = f"{name}/{step.name}"
                    if (workflow.name, "custom-shell", where) in self.allowlist:
                        continue
                    self.fail(
                        f"{workflow.path.relative_to(ROOT)}:{line}: step {step.name!r} "
                        f"in required-checks job {name!r} sets `shell: {shell}`. The "
                        f"runner default is `bash -e {{0}}` and this repository opens every "
                        f"`run:` block with `set -euo pipefail`; a custom shell changes "
                        f"failure semantics underneath that convention -- `sh` has no "
                        f"`pipefail`, so a failing command mid-pipeline stops failing the "
                        f"step."
                        + lift_instruction(workflow.name, "custom-shell", where)
                    )

    # -- allowlist hygiene ---------------------------------------------------

    def test_a_malformed_allowlist_entry_is_refused(self):
        """The lift mechanism must never degrade into a mute button.

        The allowlist is empty by design, so nothing else in this file drives
        `read_allowlist`'s three refusals -- they were reachable only by
        hand-editing the file they guard, which is a probe nobody re-runs.
        """
        for bad in (
            "pr-gate.yml | continue-on-error | security",  # three fields
            "pr-gate.yml | continue-on-error | security | ",  # blank reason
            "pr-gate.yml | bogus-rule | security | a reason",  # unknown rule
            " |  |  | ",  # every field blank
        ):
            with self.subTest(entry=bad):
                with self.assertRaises(AssertionError):
                    read_allowlist(bad + "\n")
        # Positive control: a well-formed entry still parses, so the loop above
        # cannot pass merely because the parser refuses everything.
        self.assertEqual(
            read_allowlist("pr-gate.yml | custom-shell | security/Probe | a real reason\n"),
            {("pr-gate.yml", "custom-shell", "security/Probe"): "a real reason"},
        )

    def test_allowlist_entries_name_real_workflows(self):
        names = {workflow.name for workflow in self.workflows}
        for (workflow, rule, where) in sorted(self.allowlist):
            with self.subTest(entry=f"{workflow}|{rule}|{where}"):
                self.assertIn(
                    workflow,
                    names,
                    f"{ALLOWLIST.relative_to(ROOT)} exempts a construct in {workflow!r}, "
                    f"which is not a workflow in {WORKFLOWS.relative_to(ROOT)}. Remove "
                    f"the line -- it protects nothing.",
                )


if __name__ == "__main__":
    unittest.main()
