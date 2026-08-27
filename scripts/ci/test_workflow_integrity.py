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

THE READER'S BOUNDARY -- the part that bites, so do not re-derive it by hand.
A reader that SKIPS what it does not understand is worse than no reader: the
skipped construct is invisible to every rule, so the gate reports green on
precisely the thing it exists to refuse, while looking strict to a reviewer.
The 0.1.49 review found exactly that, and the boundary below is the repair.
Every shape here was differential-tested against a real YAML parser;
`test_the_reader_resolves_every_step_shape_a_real_parser_accepts` and
`test_the_reader_refuses_what_it_cannot_resolve` are the executable copy of
this table, so extending one means extending the other.

READ CORRECTLY (all block style, all confirmed equivalent to a real parser):

  - `- name: x` -- the canonical item, and the only shape this repository
    actually writes today.
  - `-` alone with the step's keys on the following lines, at any deeper
    indent. Valid YAML, `actionlint` rc=0, and the runner executes it.
  - a sequence indented LEVEL with its own `steps:` key rather than deeper.
    This is the more common style in the wild; that no workflow here uses it
    is a habit, not a boundary.
  - a wider gap after the dash (`-   name: x`): the step's property column is
    derived from where its first key actually sits, never a fixed `+ 2`.
  - a comment between the dash and the first key.
  - quoted keys (`"name": x`).
  - quoted scalar values (`continue-on-error: "true"`), which rule 1
    normalises before comparing.
  - block scalars in every spelling (`|`, `>`, `|-`, `|2`): their bodies are
    skipped whole, so shell text that merely LOOKS like `shell:` or `env:` is
    never mistaken for structure.

REFUSED, LOUDLY, because the reader cannot resolve them (see
`_refuse_unresolvable`): flow mappings and flow sequences in any position a
rule depends on (`- {name: x}`, `steps: [...]`, `env: {...}`), YAML anchors
and aliases, merge keys (`<<:`), and multi-document files. Each raises rather
than returning a partial answer -- a partial answer is the silent pass. None
of these appears in any workflow here, and GitHub Actions accepts block style
everywhere, so the refusal costs nothing and closes the whole class at once.
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

# A YAML node this reader does not resolve: a flow mapping or flow sequence,
# an anchor, or an alias. Matched only in positions the three rules depend
# on -- never blanket-scanned, because `permissions: {}` is a flow mapping on
# every job in this repository and is none of this gate's business.
UNRESOLVABLE_NODE = re.compile(r"^[\[{&*]")
MERGE_KEY = re.compile(r"^<<\s*:")
DOCUMENT_SEPARATOR = "---"


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


KEY = re.compile(
    r"""^(?:"([A-Za-z_][\w.-]*)"|'([A-Za-z_][\w.-]*)'|([A-Za-z_][\w.-]*))\s*:\s*(.*)$"""
)


def _key(content: str) -> tuple[str, str] | None:
    """Split `key: value` into (key, value); None when the line is not a key.

    Quoted key spellings (`"name":`, `'shell':`) resolve to the same name a
    real parser gives them. An unquoted-only reader saw `"shell": sh` as a
    non-key and dropped the step's shell silently.
    """
    match = KEY.match(content)
    if not match:
        return None
    return (match.group(1) or match.group(2) or match.group(3)), match.group(4).strip()


def _refuse_unresolvable(path: Path, lineno: int, construct: str, detail: str) -> None:
    """Fail the suite on a construct the reader cannot resolve.

    The alternative -- skipping it -- is what the 0.1.49 review caught: an
    unresolved step is invisible to all three rules, so the gate passes on the
    exact construct it exists to refuse while still reading as strict. Refusing
    is the only safe direction for a reader a gate depends on.
    """
    raise AssertionError(
        f"{path.relative_to(ROOT)}:{lineno}: the structural reader cannot resolve "
        f"{construct}. {detail} This reader is BLOCK-style only, and it refuses "
        f"what it cannot resolve rather than skipping it: a skipped construct is "
        f"invisible to every rule in this file, which is a silent pass on exactly "
        f"what the rule refuses. Rewrite it in block style -- GitHub Actions "
        f"accepts that form in every one of these positions."
    )


def _is_item(content: str) -> bool:
    """A block-sequence item: `- value`, or a bare `-` carrying its body below."""
    return content == "-" or content.startswith("- ")


def _item_indent(rows: list[tuple[int, int, str]], at: int, parent_indent: int) -> int | None:
    """Indent of the block sequence under `rows[at]`, or None when there is none.

    YAML lets a sequence sit at the SAME indent as the key that owns it, and
    that is the commoner style in the wild; every workflow here happens to use
    the deeper one. Deriving the indent from the first item reads both, so
    "the style we happen to write" stops being a boundary of what the gate sees.
    """
    for _, indent, content in rows[at + 1 :]:
        if indent < parent_indent or not _is_item(content):
            return None
        return indent
    return None


def _first_deeper_indent(rows: list[tuple[int, int, str]], position: int, floor: int) -> int:
    """The indent of the row nested under `rows[position]`, for a bare `-` item."""
    for _, indent, _ in rows[position + 1 :]:
        if indent > floor:
            return indent
        break
    return floor + 2


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

    seen_content = False
    for position, (lineno, indent, content) in enumerate(rows):
        if content == DOCUMENT_SEPARATOR:
            # A second document would be merged into the first by this reader
            # while a real parser -- and the runner -- read only the first. A
            # benign later `jobs:` would then overwrite a dangerous earlier one.
            if seen_content:
                _refuse_unresolvable(
                    path, lineno, "a second YAML document in this file",
                    "The runner reads only the first; merging them here would let "
                    "a later job definition mask an earlier one.",
                )
            continue
        seen_content = True
        if indent != 0:
            continue
        parsed = _key(content)
        if not parsed:
            continue
        key, value = parsed
        if key == "env":
            if value:
                _refuse_unresolvable(
                    path, lineno, "the workflow-level `env:` value",
                    "An inline `env:` hides the outer declarations rule 2 compares "
                    "step keys against, so a shadowed pin would read as no shadow.",
                )
            workflow.env = _mapping_keys(rows, position + 1, _child_indent(rows, position))
        elif key == "jobs":
            if value:
                _refuse_unresolvable(
                    path, lineno, "the `jobs:` value", "It is not a block mapping."
                )
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
        if not parsed:
            continue
        if parsed[1]:
            if UNRESOLVABLE_NODE.match(parsed[1]):
                _refuse_unresolvable(
                    workflow.path, lineno, f"job {parsed[0]!r}",
                    "It is an anchor, an alias, or a flow node, so its steps cannot "
                    "be resolved and every rule below would see an empty job.",
                )
            continue
        job = Job(name=parsed[0], line=lineno)
        _read_job_body(rows, position, job_indent, job, workflow.path)
        workflow.jobs[job.name] = job


def _read_job_body(rows, job_at: int, job_indent: int, job: Job, path: Path) -> None:
    prop_indent = _child_indent(rows, job_at)
    for position, (lineno, indent, content) in enumerate(rows[job_at + 1 :], start=job_at + 1):
        if indent <= job_indent:
            break
        if indent != prop_indent:
            continue
        if MERGE_KEY.match(content):
            _refuse_unresolvable(
                path, lineno, f"the merge key in job {job.name!r}",
                "Merged keys are not expanded here, so a merged-in "
                "`continue-on-error`, `env`, or `steps` would be invisible.",
            )
        parsed = _key(content)
        if not parsed:
            continue
        key, value = parsed
        if key == "continue-on-error":
            if UNRESOLVABLE_NODE.match(value):
                _refuse_unresolvable(
                    path, lineno, f"the `continue-on-error:` value in job {job.name!r}",
                    "An alias or flow node is not resolved, so a value of `true` "
                    "reached through one would not be compared against.",
                )
            job.continue_on_error = (value, lineno)
        elif key == "env":
            if value:
                _refuse_unresolvable(
                    path, lineno, f"the inline `env:` in job {job.name!r}",
                    "Rule 2 compares step keys against this declaration; an "
                    "unresolved one reads as no declaration, so nothing shadows it.",
                )
            job.env = _mapping_keys(rows, position + 1, _child_indent(rows, position))
        elif key == "steps":
            if value:
                _refuse_unresolvable(
                    path, lineno, f"the inline `steps:` in job {job.name!r}",
                    "A flow sequence or alias of steps resolves to no steps here, "
                    "so every step in the job would evade all three rules.",
                )
            _read_steps(rows, position, prop_indent, job, path)


def _read_steps(rows, steps_at: int, prop_indent: int, job: Job, path: Path) -> None:
    """Read the step list.

    Items are located by the SEQUENCE's own indent, derived from its first
    item, and each step's properties by the column its first key actually sits
    in -- never by a fixed `+ 2` from the dash and never by assuming the
    sequence is indented deeper than its key. Three valid shapes broke the
    fixed-offset reader, each making the step, and therefore every rule below,
    invisible: a bare `-` with the keys on the following lines, a sequence
    level with its own `steps:` key, and a wider gap after the dash. All three
    pass `actionlint` at rc=0 and all three run. See the module docstring's
    boundary table for the full set, and the differential-parser fixture that
    pins it.
    """
    item_indent = _item_indent(rows, steps_at, prop_indent)
    if item_indent is None:
        return
    for position, (lineno, indent, content) in enumerate(rows[steps_at + 1 :], start=steps_at + 1):
        if indent < item_indent:
            break
        if indent == item_indent and not _is_item(content):
            break  # the sequence ended; this is the job's next property
        if indent != item_indent:
            continue  # a property line of the step already being read
        inline = content[1:].lstrip(" ")
        if UNRESOLVABLE_NODE.match(inline):
            _refuse_unresolvable(
                path, lineno, f"the step item `{content}` in job {job.name!r}",
                "A flow-mapping, anchored, or aliased step is not resolved into "
                "its keys, so it would evade all three rules.",
            )
        # The property column is where the first key LANDS, so `-   name: x`
        # reads the same as `- name: x` instead of losing every later key.
        step_indent = (
            indent + 1 + (len(content) - 1 - len(inline))
            if inline
            else _first_deeper_indent(rows, position, item_indent)
        )
        first = _key(inline) if inline else None
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
            if MERGE_KEY.match(inner_content):
                _refuse_unresolvable(
                    path, inner_line, f"the merge key in step {step.name or lineno!r}",
                    "Merged keys are not expanded, so a merged-in `shell`, "
                    "`continue-on-error`, or `env` would never be seen.",
                )
            parsed = _key(inner_content)
            if not parsed:
                continue
            key, value = parsed
            if key == "name" and not step.name:
                step.name = value.strip("\"'")
            elif key in ("shell", "continue-on-error") and UNRESOLVABLE_NODE.match(value):
                _refuse_unresolvable(
                    path, inner_line, f"the `{key}:` value in step {step.name or lineno!r}",
                    "An alias or flow node is not resolved, so the value this rule "
                    "compares against would be the alias text, never its target.",
                )
            elif key == "shell":
                step.shell = (value, inner_line)
            elif key == "continue-on-error":
                step.continue_on_error = (value, inner_line)
            elif key == "env":
                if value:
                    _refuse_unresolvable(
                        path, inner_line, f"the inline `env:` in step {step.name or lineno!r}",
                        "Rule 2 reads this mapping's KEYS; an unresolved one reads "
                        "as an empty step env, so nothing it declares can shadow.",
                    )
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


def stale_reason(
    workflows: list[Workflow], workflow_name: str, rule: str, where: str
) -> str | None:
    """Why this allowlist entry protects nothing any more, or None if it is live.

    A lift mechanism must ratchet SHUT as well as open. Checking only that the
    WORKFLOW field names a real file lets an entry outlive its subject: the
    exempted step is renamed or deleted, the line stays, and it silently
    pre-authorises whatever later takes that name. `subcommand-callers-
    allowlist.txt` already refuses both a subject that does not exist and one
    that no longer needs exempting; this is the same contract for this file,
    which the 0.1.49 changelog claimed and only half delivered.

    `where` is `<job>`, `<job>/<step>`, or `<job>/<step>/<key>` by rule.
    """
    workflow = next((w for w in workflows if w.name == workflow_name), None)
    if workflow is None:
        return None  # already refused by test_allowlist_entries_name_real_workflows
    job_name, _, rest = where.partition("/")
    job = workflow.jobs.get(job_name)
    if job is None:
        return f"names job {job_name!r}, which {workflow_name} does not declare"

    if rule == "continue-on-error" and not rest:
        if job.continue_on_error is None:
            return f"exempts `continue-on-error` on job {job_name!r}, which does not set it"
        return None

    step_name, key = rest, ""
    if rule == "env-shadow":
        # The KEY is the last segment; a step name may itself contain a slash.
        # Key off the SEPARATOR, not the key: `rpartition` on a `<job>/<step>`
        # subject puts the step name in `key` and leaves the step name empty,
        # which reads as a plausible parse of a malformed entry.
        step_name, separator, key = rest.rpartition("/")
        if not separator:
            return "is missing the `<job>/<step>/<key>` subject the env-shadow rule needs"
    if not step_name:
        return f"names no step in job {job_name!r}"
    step = next((s for s in job.steps if s.name == step_name), None)
    if step is None:
        return f"names step {step_name!r}, which job {job_name!r} does not have"
    if rule == "continue-on-error" and step.continue_on_error is None:
        return f"exempts `continue-on-error` on step {step_name!r}, which does not set it"
    if rule == "custom-shell" and step.shell is None:
        return f"exempts `shell:` on step {step_name!r}, which does not set one"
    if rule == "env-shadow" and key not in step.env:
        return f"exempts `env: {key}` on step {step_name!r}, which does not declare it"
    return None


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

    # -- the reader's boundary, pinned shape by shape -------------------------

    # Every entry was differential-tested against a real YAML parser: the
    # reader's resolution equals the parser's for each shape below. This table
    # is the executable copy of the module docstring's boundary; extending one
    # means extending the other. `python3 -I` has no `yaml` module, so the
    # comparison cannot run here -- the EXPECTATIONS are what that comparison
    # produced, and re-deriving them means re-running it, not guessing.
    STEP_SHAPES = {
        "canonical `- name:`":
            ("      - name: Probe\n        shell: sh\n", "Probe", "sh"),
        "bare dash, keys below":
            ("      -\n        name: Probe\n        shell: sh\n", "Probe", "sh"),
        "sequence level with its `steps:` key":
            ("    - name: Probe\n      shell: sh\n", "Probe", "sh"),
        "wider gap after the dash":
            ("      -   name: Probe\n          shell: sh\n", "Probe", "sh"),
        "comment between dash and first key":
            ("      -\n        # a comment\n        name: Probe\n        shell: sh\n",
             "Probe", "sh"),
        "quoted keys":
            ('      - "name": Probe\n        "shell": sh\n', "Probe", "sh"),
        "single-quoted step name":
            ("      - name: 'Probe'\n        shell: sh\n", "Probe", "sh"),
        "shell on the item line itself":
            ("      - shell: sh\n        name: Probe\n", "Probe", "sh"),
        "block scalar body is not structure":
            ("      - name: Probe\n        shell: sh\n        run: |\n"
             "          shell: hidden\n          env:\n            NOT_A_KEY: 1\n",
             "Probe", "sh"),
        "folded block scalar body":
            ("      - name: Probe\n        shell: sh\n        run: >\n"
             "          echo shell: hidden\n", "Probe", "sh"),
        "explicitly indented block scalar":
            ("      - name: Probe\n        shell: sh\n        run: |2\n"
             "          echo hi\n", "Probe", "sh"),
        "quoted scalar value":
            ("      - name: Probe\n        shell: 'sh'\n", "Probe", "'sh'"),
    }

    UNRESOLVABLE_SHAPES = {
        "flow-mapping step item": "      - {name: Probe, shell: sh}\n",
        "aliased step item": "      - *a_step\n",
        "anchored step item": "      - &a_step\n        name: Probe\n",
        "merge key inside a step": "      - name: Probe\n        <<: *defaults\n",
        "inline step env": "      - name: Probe\n        env: {A: 1}\n",
    }

    def test_the_reader_resolves_every_step_shape_a_real_parser_accepts(self):
        """Read each valid shape the way a real YAML parser reads it.

        A reader that SKIPS a shape it does not understand is the worst kind of
        gate: the skipped step is invisible to all three rules, so the suite is
        green on exactly the construct being refused, while still reading as
        strict to a reviewer. The 0.1.49 review found one such shape; a
        differential sweep against a real parser found that the fixed `+ 2`
        offset and the `- `-prefix test between them hid SIX more. Each shape
        here is valid YAML that `actionlint` accepts at rc=0 and the runner
        executes.
        """
        for label, (item, name, shell) in self.STEP_SHAPES.items():
            with self.subTest(shape=label):
                job = _parse_synthetic("jobs:\n  gate:\n    steps:\n" + item).jobs["gate"]
                self.assertEqual(len(job.steps), 1, "the step was not resolved")
                self.assertEqual(job.steps[0].name, name)
                resolved = job.steps[0].shell
                # The first assertion carries the check; the `else ""` exists
                # only so a type checker can follow the narrowing.
                self.assertIsNotNone(resolved, "the step's shell was dropped")
                self.assertEqual(resolved[0] if resolved else "", shell)

    def test_the_reader_refuses_what_it_cannot_resolve(self):
        """Fail closed rather than skip, for every shape outside the boundary.

        These are resolvable by a real parser and NOT by this reader. Returning
        a partial answer for them is the silent pass; refusing is the only safe
        direction, costs nothing (no workflow here uses one), and leaves a
        message naming the construct.
        """
        for label, item in self.UNRESOLVABLE_SHAPES.items():
            with self.subTest(shape=label):
                with self.assertRaises(AssertionError) as caught:
                    _parse_synthetic("jobs:\n  gate:\n    steps:\n" + item)
                self.assertIn("cannot resolve", str(caught.exception))
        # Whole-file and job-level shapes, same rule.
        for label, text in (
            ("inline steps:", "jobs:\n  gate:\n    steps: [{name: Probe}]\n"),
            ("aliased job", "jobs:\n  gate: *template\n"),
            ("inline job env", "jobs:\n  gate:\n    env: {A: 1}\n    steps:\n      - name: P\n"),
            ("inline workflow env", "env: {A: 1}\njobs:\n  gate:\n    steps:\n      - name: P\n"),
            ("merge key in a job", "jobs:\n  gate:\n    <<: *d\n    steps:\n      - name: P\n"),
            ("second document",
             "jobs:\n  gate:\n    steps:\n      - name: P\n---\njobs:\n  gate:\n"
             "    steps:\n      - name: Q\n"),
        ):
            with self.subTest(shape=label):
                with self.assertRaises(AssertionError) as caught:
                    _parse_synthetic(text)
                self.assertIn("cannot resolve", str(caught.exception))

    def test_a_run_block_heredoc_is_not_a_merge_key(self):
        """The positive control for the merge-key refusal.

        `release-after-main.yml` is full of `jq … <<<"${x}"` inside `run:`
        blocks. Block-scalar skipping must keep those out of the reader, or the
        refusal above would red the suite on shell text. The real sweep in
        `setUpClass` covers this, but only while those files keep that shape.
        """
        job = _parse_synthetic(
            "jobs:\n  gate:\n    steps:\n      - name: Probe\n        run: |\n"
            '          class="$(jq -er .class <<<"${verdict}")"\n'
        ).jobs["gate"]
        self.assertEqual([step.name for step in job.steps], ["Probe"])

    # -- every rule must be REACHABLE, not merely correct --------------------

    def _drive(self, method: str, text: str, allowlist=None) -> str:
        """Run ONE shipped rule over a synthetic workflow; return its message.

        Returns the refusal message, or `""` when the rule passed -- a plain
        `str` rather than `str | None` so callers can assert on the message
        without an Optional narrowing dance a type checker does not follow.

        `parse_workflow(..., WORKFLOWS / "pr-gate.yml")` is the whole seam: the
        path decides `required_jobs()`, so a synthetic job named like a real
        required one lands inside the set the rules are scoped by. Shadowing
        `workflows` and `allowlist` on a fresh instance drives the SHIPPED rule
        methods rather than a copy of their logic -- a reimplementation here
        would pass while the real rule was deleted, which is the very failure
        these fixtures exist to close. No production code exists to make this
        reachable.
        """
        probe = WorkflowIntegrityTests(method)
        probe.workflows = [parse_workflow(text, WORKFLOWS / "pr-gate.yml")]
        probe.allowlist = {} if allowlist is None else allowlist
        try:
            getattr(probe, method)()
        except probe.failureException as failure:
            return str(failure)
        return ""

    # `application` is a real `EXPECTED_MAIN_JOBS` entry, so these fixtures are
    # inside the required-checks set exactly as a real offending job would be.
    CONTINUE_ON_ERROR_JOB = (
        "jobs:\n  application:\n    continue-on-error: true\n"
        "    steps:\n      - name: Probe\n        run: exit 1\n"
    )
    CONTINUE_ON_ERROR_STEP = (
        "jobs:\n  application:\n    steps:\n"
        "      - name: Probe\n        continue-on-error: true\n        run: exit 1\n"
    )
    ENV_SHADOW = (
        "jobs:\n  application:\n    env:\n      GO_COVERAGE_FLOOR: 93.2\n"
        "    steps:\n      - name: Probe\n        env:\n          GO_COVERAGE_FLOOR: 0\n"
    )
    ENV_PINNED_TOOL = (
        "jobs:\n  application:\n    steps:\n"
        "      - name: Probe\n        env:\n          GITLEAKS_VERSION: 0.0.0\n"
    )
    CUSTOM_SHELL = (
        "jobs:\n  application:\n    steps:\n      - name: Probe\n        shell: sh\n"
    )
    CLEAN = "jobs:\n  application:\n    steps:\n      - name: Probe\n        run: true\n"

    def test_every_rule_refuses_its_own_construct(self):
        """Drive all three rules to an actual refusal.

        Every workflow in this repository is clean, so before this fixture NO
        input reached any of the three `self.fail` calls -- each rule could be
        DELETED OUTRIGHT with the suite staying green. The rules were correct
        (mutating the real workflows proved each fires) but their removal was
        undetectable, which is not a gate, it is a comment.

        This is the same gap `test_the_reader_sees_a_real_step_key` closed one
        layer down for the reader's inner-`name:` branch. It was found there
        and not extended upward; the 0.1.49 review caught that, and these
        fixtures are the extension.
        """
        for label, method, text, expected in (
            ("rule 1 / job", "test_no_required_check_continues_on_error",
             self.CONTINUE_ON_ERROR_JOB, "continue-on-error"),
            ("rule 1 / step", "test_no_required_check_continues_on_error",
             self.CONTINUE_ON_ERROR_STEP, "continue-on-error"),
            ("rule 2 / shadows job env", "test_no_step_env_shadows_an_outer_declaration",
             self.ENV_SHADOW, "shadows the job-level declaration"),
            ("rule 2 / redeclares a tool pin", "test_no_step_env_shadows_an_outer_declaration",
             self.ENV_PINNED_TOOL, "redeclares a tool pin"),
            ("rule 3 / custom shell", "test_no_gate_step_sets_a_custom_shell",
             self.CUSTOM_SHELL, "shell: sh"),
        ):
            with self.subTest(rule=label):
                message = self._drive(method, text)
                self.assertTrue(message, "the rule did not refuse its own construct")
                self.assertIn(expected, message)
                # The lift path must be printed with the refusal, or the next
                # agent's only route past a correct refusal is to weaken it.
                self.assertIn("To lift this refusal", message)

    def test_no_rule_refuses_a_clean_workflow(self):
        """The positive control: these fixtures fail for their construct only.

        Without this, a rule mutated into always-failing would satisfy every
        assertion above and look like proof.
        """
        for method in (
            "test_no_required_check_continues_on_error",
            "test_no_step_env_shadows_an_outer_declaration",
            "test_no_gate_step_sets_a_custom_shell",
        ):
            with self.subTest(rule=method):
                self.assertEqual(self._drive(method, self.CLEAN), "")

    def test_the_allowlist_lifts_every_rule(self):
        """Each refusal above must clear through one allowlist line, and only
        through the line that names it.

        A lift path nobody exercises is a lift path that turns out to be broken
        on the day a real refusal needs it -- the sibling repository shipped
        exactly that, an allowlist pinned so the documented lift reddened the
        suite.
        """
        for label, method, text, entry in (
            ("rule 1 / job", "test_no_required_check_continues_on_error",
             self.CONTINUE_ON_ERROR_JOB, ("pr-gate.yml", "continue-on-error", "application")),
            ("rule 1 / step", "test_no_required_check_continues_on_error",
             self.CONTINUE_ON_ERROR_STEP,
             ("pr-gate.yml", "continue-on-error", "application/Probe")),
            ("rule 2 / shadow", "test_no_step_env_shadows_an_outer_declaration",
             self.ENV_SHADOW,
             ("pr-gate.yml", "env-shadow", "application/Probe/GO_COVERAGE_FLOOR")),
            ("rule 3 / shell", "test_no_gate_step_sets_a_custom_shell",
             self.CUSTOM_SHELL, ("pr-gate.yml", "custom-shell", "application/Probe")),
        ):
            with self.subTest(rule=label):
                self.assertTrue(self._drive(method, text), "not refused without the entry")
                self.assertEqual(
                    self._drive(method, text, {entry: "a written reason"}),
                    "",
                    "the exempting entry did not lift the refusal",
                )
                wrong = (entry[0], entry[1], entry[2] + "-not-this-one")
                self.assertTrue(
                    self._drive(method, text, {wrong: "a written reason"}),
                    "an entry naming a DIFFERENT subject lifted this refusal",
                )

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

    def test_allowlist_entries_still_have_a_live_subject(self):
        """The other half of the ratchet: the `<where>` subject must still exist
        AND still carry the construct being exempted.

        The test above reads the WORKFLOW field and nothing else, so an entry
        naming a step that does not exist sat green -- while the changelog
        claimed both allowlists ratchet shut. That was true of
        `subcommand-callers-allowlist.txt` and only half true here.
        """
        for (workflow, rule, where) in sorted(self.allowlist):
            with self.subTest(entry=f"{workflow}|{rule}|{where}"):
                reason = stale_reason(self.workflows, workflow, rule, where)
                self.assertIsNone(
                    reason,
                    f"{ALLOWLIST.relative_to(ROOT)} carries an entry that {reason}. "
                    f"Remove the line -- it protects nothing now, and it will "
                    f"silently pre-authorise whatever later takes that name.",
                )

    def test_the_subject_ratchet_refuses_a_stale_entry(self):
        """Drive that ratchet, because the shipped allowlist is EMPTY.

        An empty allowlist makes the loop above vacuous: the ratchet could be
        deleted outright with the suite staying green, which is precisely the
        surviving-mutant class the 0.1.49 review found for the three rules.
        Each row below pairs a LIVE subject with a stale one, so the check
        cannot pass by refusing everything either.
        """
        text = (
            "jobs:\n"
            "  application:\n"
            "    continue-on-error: true\n"
            "    env:\n"
            "      GO_COVERAGE_FLOOR: 93.2\n"
            "    steps:\n"
            "      - name: Probe\n"
            "        shell: sh\n"
            "        continue-on-error: true\n"
            "        env:\n"
            "          GO_COVERAGE_FLOOR: 0\n"
            "      - name: Plain\n"
            "        run: true\n"
        )
        workflows = [parse_workflow(text, WORKFLOWS / "pr-gate.yml")]
        live = (
            ("continue-on-error", "application"),
            ("continue-on-error", "application/Probe"),
            ("custom-shell", "application/Probe"),
            ("env-shadow", "application/Probe/GO_COVERAGE_FLOOR"),
        )
        for rule, where in live:
            with self.subTest(live=f"{rule}|{where}"):
                self.assertIsNone(stale_reason(workflows, "pr-gate.yml", rule, where))
        stale = (
            ("continue-on-error", "no-such-job", "does not declare"),
            ("custom-shell", "application/No Such Step", "does not have"),
            ("custom-shell", "application/Plain", "does not set one"),
            ("continue-on-error", "application/Plain", "does not set it"),
            ("env-shadow", "application/Probe/NOT_DECLARED", "does not declare it"),
            ("env-shadow", "application/Probe", "is missing the"),
        )
        for rule, where, expected in stale:
            with self.subTest(stale=f"{rule}|{where}"):
                reason = stale_reason(workflows, "pr-gate.yml", rule, where)
                self.assertIsNotNone(reason, "a stale entry was not refused")
                self.assertIn(expected, str(reason))


if __name__ == "__main__":
    unittest.main()
