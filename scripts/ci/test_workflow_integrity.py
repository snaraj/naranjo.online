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

  3. A custom `shell:` on a step in the required-checks set, or a
     `defaults.run.shell` at job or workflow level, which is the same construct
     written where no step carries it and reshells EVERY `run:` step beneath
     it. The runner default for `run:` on Linux is `bash -e {0}`, and this
     repository's convention is to open every `run: |` block with
     `set -euo pipefail`. A custom shell changes failure semantics underneath
     that convention -- `shell: sh` drops `pipefail` support entirely, so a
     failing command mid-pipeline stops being a failing step.

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
being inserted above it. Rule 3 has two further subjects for the positions no
step name can address: `<defaults.run.shell>` for the workflow-level default
and `<job>/<defaults.run.shell>` for a job's.

PARSING. `python3 -I` runs isolated with no site-packages, so there is no
`yaml` module; `dependabot_contract.py`'s parser is deliberately conservative
and refuses comments, which every workflow here has. This file therefore
carries a small structural reader that understands exactly what these rules
need: indentation, block scalars, and comments. It fails CLOSED -- anything it
cannot resolve, structure or value, fails the suite rather than passing
quietly, which is the only safe direction for a reader a gate depends on. The
next section is that boundary, and it is the most important part of this file.

THE READER'S BOUNDARY -- the part that bites, so do not re-derive it by hand.
A reader that SKIPS what it does not understand is worse than no reader: the
skipped construct is invisible to every rule, so the gate reports green on
precisely the thing it exists to refuse, while looking strict to a reviewer.

THE DEFAULT IS THE DEFECT, AND IT IS INVERTED HERE. Three successive 0.1.49
reviews each found "another valid form evades the reader", and each repair
that ADDED a form was overtaken by the next one:

  round 1 -- a step written `- {name: x}` was skipped as unparseable;
  round 2 -- six step SHAPES (a bare `-`, a sequence level with its own
             `steps:` key, a wider gap after the dash, ...) located no step;
  round 3 -- four `continue-on-error` VALUE forms -- the scalar on the next
             line, and `!!bool true`, at job and step level -- resolved to
             text that simply was not `true`, so the rule returned without
             refusing. Every one passed `actionlint` at rc=0.

That sequence does not end by enumerating forms, because a hand-rolled YAML
subset that recognises the spellings somebody thought of and treats everything
else as "not a match" leaks BY CONSTRUCTION. This repository cannot take a
PyYAML dependency (`python3 -I` runs with no site-packages, and requirement 9
keeps the Go module stdlib-only for the same reason), so the answer is not a
real parser -- it is fail-closed resolution:

  **the reader resolves a small, explicit set of forms, and REFUSES
  everything else, in every position a rule reads.**

Refusing is not a fallback here; it is the default, and recognition is the
exception. The test of whether that holds: a brand-new exotic-but-valid way of
writing `true` must turn the gate RED with no edit to this file.
`test_an_unrecognised_way_of_writing_true_is_refused` is that test, and
`UNRECOGNISED_TRUE_SPELLINGS` is a table of twelve rows none of which has a
branch anywhere in this module.

WHAT THE READER RESOLVES -- structure. Differential-tested against a real YAML
parser; `test_the_reader_resolves_every_step_shape_a_real_parser_accepts` is
the executable copy, so extending one means extending the other:

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
  - block scalars in every spelling (`|`, `>`, `|-`, `|2`, `|2-`): their
    bodies are skipped whole, so shell text that merely LOOKS like `shell:` or
    `env:` is never mistaken for structure.

WHAT THE READER RESOLVES -- values, which is the narrower and stricter half.
`resolve_scalar` accepts exactly three spellings and `resolve_boolean` narrows
that further:

  - nothing at all on the key's line AND nothing nested under it: YAML null.
    (Nothing on the line WITH something nested under it is refused -- that is
    round 3's evasion, and the two cases are indistinguishable to a reader
    that only looks at the same line.)
  - `'text'` with no `''` escape, and `"text"` with no backslash escape; the
    quotes are stripped, the way a real parser strips them.
  - a plain scalar of `[A-Za-z0-9_][A-Za-z0-9_./+-]*`, which cannot begin with
    a YAML indicator and cannot contain a tag, a flow marker, or a `${{ }}`.
  - for `continue-on-error` only: that resolved text must then be `true` or
    `false` in any casing. `yes`, `on`, `1`, `!!str true` and a folded scalar
    are REFUSED rather than compared, even though `actionlint` rejects some of
    them -- a fail-closed reader that depends on another tool catching what it
    waves through is not fail-closed.

Rule 1 is therefore TOTAL: every input either raises or resolves to one of two
booleans, so there is no third outcome for a spelling to hide in.

REFUSED, LOUDLY, with a message naming the construct (see
`_refuse_unresolvable`): flow mappings and flow sequences in any position a
rule depends on (`- {name: x}`, `steps: [...]`, `env: {...}`), YAML anchors,
aliases and tags, merge keys (`<<:`), explicit keys (`? k` / `: v`), a row in
an `env:` mapping this reader cannot name, a job that declares `steps:` and
resolves none, and multi-document files. Each raises rather than returning a
partial answer -- a partial answer is the silent pass. None of these appears
in any workflow here, and GitHub Actions accepts block style everywhere, so
the refusal costs nothing and closes the whole class at once.

THE ONE VALUE DELIBERATELY OUTSIDE THAT BOUNDARY is a step's `name:`, which is
free text (`Test hostile contract suites (release, dependabot)`) and is not
compared by any rule -- it is only the allowlist SUBJECT. Mis-resolving a name
fails closed on its own: the `<where>` an entry names then does not match, so
the refusal stands rather than being lifted.
"""

from __future__ import annotations

import importlib.util
import re
import sys
import unittest
from dataclasses import dataclass, field
from pathlib import Path
from typing import NoReturn


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

# THE RESOLUTION BOUNDARY, stated as what the reader UNDERSTANDS.
#
# These three patterns are the complete set of scalar spellings this reader
# claims to resolve for a value a rule compares. They are deliberately written
# as a positive recognition rather than a list of forbidden characters, because
# the 0.1.49 review found three rounds of "another valid spelling evades the
# reader" and a blocklist loses that game by construction: the previous
# revision refused `^[\[{&*]` and was beaten by `!!bool true`, by an empty
# same-line value with the scalar on the next line, and by `${{ true }}`.
# Anything not matched here RAISES, so a spelling nobody anticipated is a red
# gate rather than a silent pass, with no code change needed to catch it.
PLAIN_SCALAR = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_./+-]*$")
SINGLE_QUOTED = re.compile(r"^'[^'\\]*'$")
DOUBLE_QUOTED = re.compile(r'^"[^"\\]*"$')

# Rule 1's value is boolean-typed, so its recognised set is smaller still: the
# two spellings `actionlint` itself accepts, case-insensitively, plus YAML null
# for a bare key. `yes`, `on`, `1`, `!!str true` and a folded scalar all resolve
# TRUTHY or STRING-"true" in a real parser and are refused here rather than
# compared -- which is what makes rule 1 total. See `resolve_boolean`.
BOOLEAN_SPELLINGS = {"true": True, "false": False}

MERGE_KEY = re.compile(r"^<<\s*:")
DOCUMENT_SEPARATOR = "---"
DOCUMENT_END = "..."

# `defaults.run.shell` sets the shell for every `run:` step beneath it, at
# workflow or job level, and is rule 3's construct written somewhere no step
# carries it. It needs an allowlist subject that cannot collide with a step
# name, hence the angle brackets: a step named this would have to be written
# `- name: <defaults.run.shell>`, which `actionlint` accepts but which is then
# exempted by the same line either way -- the subject is the construct, and
# both spellings of it are the thing being waived.
DEFAULT_SHELL_SUBJECT = "<defaults.run.shell>"


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
# Rule 1 compares a BOOLEAN, never text. Resolution happens once, in the
# reader, where an unrecognised spelling can still raise; by the time a value
# reaches the rule there is nothing left to normalise and therefore nothing
# left to normalise WRONG.
KeyedBool = tuple[bool, int]


@dataclass
class Step:
    name: str
    line: int
    shell: Keyed | None = None
    continue_on_error: KeyedBool | None = None
    env: dict[str, int] = field(default_factory=dict)


@dataclass
class Job:
    name: str
    line: int
    continue_on_error: KeyedBool | None = None
    default_shell: Keyed | None = None
    env: dict[str, int] = field(default_factory=dict)
    steps: list[Step] = field(default_factory=list)
    # Whether the job declared a `steps:` key at all. A reusable-workflow job
    # (`uses:` at job level) legitimately has none, so "every job has steps" is
    # a false pin; "every job that SAYS it has steps resolved some" is not.
    declares_steps: bool = False


@dataclass
class Workflow:
    path: Path
    env: dict[str, int] = field(default_factory=dict)
    default_shell: Keyed | None = None
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


def _refuse_unresolvable(path: Path, lineno: int, construct: str, detail: str) -> NoReturn:
    """Fail the suite on a construct the reader cannot resolve.

    The alternative -- skipping it -- is what the 0.1.49 review caught: an
    unresolved step is invisible to all three rules, so the gate passes on the
    exact construct it exists to refuse while still reading as strict. Refusing
    is the only safe direction for a reader a gate depends on.

    Declared `NoReturn` on purpose: every call site is a dead end, so a type
    checker proves no caller can fall through one and carry on with an
    unresolved value -- the exact bug this function exists to prevent.
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


def _has_body(rows: list[tuple[int, int, str]], position: int, column: int) -> bool:
    """Whether the key at `rows[position]` carries its value on FOLLOWING lines.

    Only the very next structural row can begin a nested node, so one lookahead
    is the whole question. An empty same-line value therefore means one of two
    completely different things -- YAML null, or a scalar/collection below --
    and comparing the empty string for both is how `continue-on-error:` with
    `true` on the next line read as "not true" and passed.
    """
    for _, indent, _ in rows[position + 1 :]:
        return indent > column
    return False


def resolve_scalar(
    rows: list[tuple[int, int, str]],
    position: int,
    column: int,
    value: str,
    path: Path,
    lineno: int,
    where: str,
) -> str:
    """Resolve a scalar a rule compares, or REFUSE. Never returns a guess.

    This is the value-level half of the fail-closed contract, and it is written
    as an ALLOWLIST of spellings on purpose. The 0.1.49 reviews found, in three
    successive rounds, that a reader which recognises "the ways of writing X I
    thought of" and treats everything else as "not X" leaks by construction:
    the leak is not any particular spelling, it is the default. Inverting the
    default is the repair -- an unrecognised form raises, so a spelling nobody
    anticipated turns the gate RED with no edit to this file.

    Recognised, and nothing else:

      - an absent same-line value with NO nested row under the key: YAML null,
        the only empty form this reader accepts;
      - `'text'` with no `''` escape, and `"text"` with no backslash escape;
      - a plain scalar of `PLAIN_SCALAR`'s characters, which cannot begin with
        any YAML indicator and cannot contain a tag, a flow marker, or a `${{`
        expression.

    Everything else -- `!!bool true`, `${{ true }}`, `>-` with the text below,
    `"tr\\u0075e"`, an anchor, an alias, a flow node, a multi-word plain scalar
    -- raises. The cost is one allowlist line for a legitimate exotic value,
    and no workflow in this repository writes one.
    """
    if not value:
        if _has_body(rows, position, column):
            _refuse_unresolvable(
                path, lineno, f"{where}, whose value is not on the same line",
                "The reader cannot tell a nested scalar from a nested collection "
                "here, and reading the empty same-line text as the value compares "
                "`\"\"` against a scalar a real parser resolves -- which is the "
                "silent pass. Write the value on the key's own line.",
            )
        return ""
    if SINGLE_QUOTED.match(value) or DOUBLE_QUOTED.match(value):
        return value[1:-1]
    if PLAIN_SCALAR.match(value):
        return value
    _refuse_unresolvable(
        path, lineno, f"{where}, written as `{value}`",
        "That is not one of the scalar spellings this reader resolves (a plain "
        "token, a quoted string without escapes, or nothing at all). It is "
        "refused rather than compared, because comparing text this reader did "
        "not resolve is how a value a real parser reads as `true` passes as "
        "`not true`.",
    )


def resolve_boolean(
    rows: list[tuple[int, int, str]],
    position: int,
    column: int,
    value: str,
    path: Path,
    lineno: int,
    where: str,
) -> bool:
    """Resolve a boolean-typed value, or REFUSE. Rule 1's whole normalisation.

    Total by construction: every input either resolves to one of exactly two
    booleans or raises. There is no third outcome and therefore no "some other
    spelling of true" to discover -- `yes`, `on`, `y`, `1`, `!!str true`, a
    folded scalar and a `${{ }}` expression are all REFUSED rather than
    silently compared as not-`true`, even though `actionlint` rejects some of
    them for us. Depending on another tool to catch what this one waves through
    is exactly the coupling a fail-closed reader must not have.

    A bare `continue-on-error:` with nothing under it is YAML null, which is
    falsy in every parser and in the runner; it resolves `False` rather than
    raising, so a legitimate null is not false-reddened.
    """
    text = resolve_scalar(rows, position, column, value, path, lineno, where)
    if not text:
        return False
    resolved = BOOLEAN_SPELLINGS.get(text.lower())
    if resolved is None:
        _refuse_unresolvable(
            path, lineno, f"{where}, written as `{value}`",
            f"A boolean here is `true` or `false` in any casing and nothing else. "
            f"{text!r} may well resolve truthy in a real YAML parser -- `yes`, "
            f"`on` and `1` all do -- so it is refused rather than compared, "
            f"because comparing it would pass it.",
        )
    return resolved


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


def _mapping_keys(
    rows: list[tuple[int, int, str]], start: int, indent: int, path: Path, where: str
) -> dict[str, int]:
    """Collect `key: value` names declared at exactly `indent`, from `start`.

    Rule 2 reads these NAMES, so a row at the mapping's own column that this
    reader cannot read as a key is not a curiosity -- it is a declaration the
    rule will never see. Skipping it hid three real shapes on the real
    `pr-gate.yml`, all of them resolved by a real parser: an explicit key
    (`? GO_COVERAGE_FLOOR` / `: '0'`, which `actionlint` accepts at rc=0 and
    which shadows the coverage floor invisibly), a merge key pulling an entire
    mapping in by alias, and a key spelling `KEY` does not match. Refusing is
    the same inversion the value layer applies: understand it, or say so.
    """
    keys: dict[str, int] = {}
    for lineno, row_indent, content in rows[start:]:
        if row_indent < indent:
            break
        if row_indent != indent:
            continue
        parsed = _key(content)
        if not parsed:
            _refuse_unresolvable(
                path, lineno, f"the entry `{content}` in {where}",
                "Every entry of a mapping rule 2 reads must be a plain `KEY: value` "
                "line. An entry this reader cannot name is a declaration the rule "
                "cannot see, so it could shadow an outer pin unnoticed.",
            )
        keys[parsed[0]] = lineno
    return keys


def _read_default_shell(
    rows: list[tuple[int, int, str]], defaults_at: int, path: Path, where: str
) -> Keyed | None:
    """Resolve `defaults: run: shell:`, rule 3's construct written above a step.

    `defaults.run.shell` at workflow or job level replaces the runner default
    for EVERY `run:` step beneath it. It is exactly what rule 3 refuses on a
    step, spelled somewhere no step carries it -- and it was invisible: both
    positions pass `actionlint` at rc=0 and left the suite green.
    """
    run_indent = _child_indent(rows, defaults_at)
    for run_at, (lineno, indent, content) in enumerate(
        rows[defaults_at + 1 :], start=defaults_at + 1
    ):
        if indent < run_indent:
            break
        if indent != run_indent:
            continue
        parsed = _key(content)
        if not parsed:
            _refuse_unresolvable(
                path, lineno, f"the entry `{content}` in the `defaults:` of {where}",
                "A `defaults:` block this reader cannot read as a mapping could "
                "carry a `run.shell` that silently reshells every step below it.",
            )
        if parsed[0] != "run":
            continue
        if parsed[1]:
            _refuse_unresolvable(
                path, lineno, f"the inline `defaults.run:` of {where}",
                "An inline or aliased `run:` mapping resolves to no shell here, so "
                "a default shell it declares would evade rule 3.",
            )
        shell_indent = _child_indent(rows, run_at)
        for shell_at, (shell_line, shell_row_indent, shell_content) in enumerate(
            rows[run_at + 1 :], start=run_at + 1
        ):
            if shell_row_indent < shell_indent:
                break
            if shell_row_indent != shell_indent:
                continue
            shell_parsed = _key(shell_content)
            if not shell_parsed:
                _refuse_unresolvable(
                    path, shell_line,
                    f"the entry `{shell_content}` in the `defaults.run:` of {where}",
                    "It could be the `shell:` key rule 3 refuses.",
                )
            if shell_parsed[0] == "shell":
                return (
                    resolve_scalar(
                        rows, shell_at, shell_indent, shell_parsed[1], path, shell_line,
                        f"the `defaults.run.shell:` of {where}",
                    ),
                    shell_line,
                )
    return None


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
        if content == DOCUMENT_END:
            continue
        parsed = _key(content)
        if not parsed:
            # The root is a mapping, so every row at column 0 is one of its
            # keys. A row that is not -- a merge key aliasing a whole mapping
            # in, an explicit key, a directive -- can introduce `env:` or
            # `jobs:` without this reader seeing where they came from.
            _refuse_unresolvable(
                path, lineno, f"the root-level row `{content}`",
                "The root of a workflow is a block mapping; a row here this reader "
                "cannot name could introduce `env:` or `jobs:` invisibly.",
            )
        key, value = parsed
        if key == "env":
            if value:
                _refuse_unresolvable(
                    path, lineno, "the workflow-level `env:` value",
                    "An inline `env:` hides the outer declarations rule 2 compares "
                    "step keys against, so a shadowed pin would read as no shadow.",
                )
            workflow.env = _mapping_keys(
                rows, position + 1, _child_indent(rows, position), path,
                "the workflow-level `env:`",
            )
        elif key == "defaults":
            if value:
                _refuse_unresolvable(
                    path, lineno, "the workflow-level `defaults:` value",
                    "An inline or aliased `defaults:` resolves to no shell here, so "
                    "a `run.shell` it declares would evade rule 3.",
                )
            workflow.default_shell = _read_default_shell(
                rows, position, path, "this workflow"
            )
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
            _refuse_unresolvable(
                workflow.path, lineno, f"the row `{content}` under `jobs:`",
                "`jobs:` is a block mapping of job ids; a row here this reader "
                "cannot name could be a job whose steps no rule would then see.",
            )
        if parsed[1]:
            # A job is always a mapping. A job id carrying ANY same-line value
            # is an anchor, an alias, or a flow node -- something whose steps
            # this reader does not resolve, so every rule would see an empty
            # job. Refused positively rather than pattern-matched, so a spelling
            # nobody listed is still refused.
            _refuse_unresolvable(
                workflow.path, lineno, f"job {parsed[0]!r}, written as `{content}`",
                "A job is a block mapping. A same-line value here is an anchor, an "
                "alias, or a flow node, so its steps cannot be resolved and every "
                "rule below would see an empty job.",
            )
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
            if _is_item(content):
                continue  # a block sequence written level with its own key
            _refuse_unresolvable(
                path, lineno, f"the row `{content}` in job {job.name!r}",
                "A job's properties are a block mapping; a row here this reader "
                "cannot name could be `continue-on-error`, `env`, `defaults` or "
                "`steps` under a spelling every rule below would then miss.",
            )
        key, value = parsed
        if key == "continue-on-error":
            job.continue_on_error = (
                resolve_boolean(
                    rows, position, prop_indent, value, path, lineno,
                    f"the `continue-on-error:` of job {job.name!r}",
                ),
                lineno,
            )
        elif key == "env":
            if value:
                _refuse_unresolvable(
                    path, lineno, f"the inline `env:` in job {job.name!r}",
                    "Rule 2 compares step keys against this declaration; an "
                    "unresolved one reads as no declaration, so nothing shadows it.",
                )
            job.env = _mapping_keys(
                rows, position + 1, _child_indent(rows, position), path,
                f"the `env:` of job {job.name!r}",
            )
        elif key == "defaults":
            if value:
                _refuse_unresolvable(
                    path, lineno, f"the inline `defaults:` in job {job.name!r}",
                    "An inline or aliased `defaults:` resolves to no shell here, so "
                    "a `run.shell` it declares would evade rule 3.",
                )
            job.default_shell = _read_default_shell(
                rows, position, path, f"job {job.name!r}"
            )
        elif key == "steps":
            if value:
                _refuse_unresolvable(
                    path, lineno, f"the inline `steps:` in job {job.name!r}",
                    "A flow sequence or alias of steps resolves to no steps here, "
                    "so every step in the job would evade all three rules.",
                )
            job.declares_steps = True
            _read_steps(rows, position, prop_indent, job, path)
            if not job.steps:
                _refuse_unresolvable(
                    path, lineno, f"the `steps:` sequence in job {job.name!r}",
                    "The job declares steps and this reader resolved none, so every "
                    "rule below would see an empty job and pass it. A job with no "
                    "steps at all is a reusable-workflow call, which writes `uses:` "
                    "at job level and no `steps:` key.",
                )


def _read_steps(rows, steps_at: int, prop_indent: int, job: Job, path: Path) -> None:
    """Read the step list.

    Items are located by the SEQUENCE's own indent, derived from its first
    item, and each step's properties by the column its first key actually sits
    in -- never by a fixed `+ 2` from the dash and never by assuming the
    sequence is indented deeper than its key. Three valid shapes broke the
    fixed-offset reader, each making the step, and therefore every rule below,
    invisible: a bare `-` with the keys on the following lines, a sequence
    level with its own `steps:` key, and a wider gap after the dash. All three
    pass `actionlint` at rc=0 and all three run.

    Every row this reader meets at the item column or the property column must
    RESOLVE -- as a sequence item, or as a key it can name. A row it cannot
    read is refused rather than skipped, because a skipped property is a
    `shell:`, `continue-on-error:` or `env:` that all three rules then miss.
    See the module docstring's boundary section for the full set, and the
    differential-parser fixture that pins it.
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
        # The property column is where the first key LANDS, so `-   name: x`
        # reads the same as `- name: x` instead of losing every later key.
        step_indent = (
            indent + 1 + (len(content) - 1 - len(inline))
            if inline
            else _first_deeper_indent(rows, position, item_indent)
        )
        first = _key(inline) if inline else None
        if inline and first is None:
            # A step is a mapping. An item whose content is not a `key: value`
            # is a flow mapping, an anchor, an alias, or a plain scalar -- none
            # of which this reader resolves into keys, so the step would evade
            # all three rules. Refused by NOT recognising it, rather than by
            # matching a list of leading characters.
            _refuse_unresolvable(
                path, lineno, f"the step item `{content}` in job {job.name!r}",
                "A step is a block mapping. An item this reader cannot read as a "
                "`key: value` is a flow mapping, an anchor, an alias, or a bare "
                "scalar, and none of them resolves into the keys all three rules "
                "read.",
            )
        step = Step(name=(first[1].strip("\"'") if first and first[0] == "name" else ""), line=lineno)
        # A step written as `- shell: sh` carries the key on the item line
        # itself, so that line IS the key's line, and `step_indent` is the
        # column that key starts in -- which is what decides whether an empty
        # same-line value has a scalar nested under it.
        if first and first[0] == "shell":
            step.shell = (
                resolve_scalar(
                    rows, position, step_indent, first[1], path, lineno,
                    f"the `shell:` of the step at line {lineno}",
                ),
                lineno,
            )
        if first and first[0] == "continue-on-error":
            step.continue_on_error = (
                resolve_boolean(
                    rows, position, step_indent, first[1], path, lineno,
                    f"the `continue-on-error:` of the step at line {lineno}",
                ),
                lineno,
            )
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
                if _is_item(inner_content):
                    continue  # a block sequence written level with its own key
                _refuse_unresolvable(
                    path, inner_line,
                    f"the row `{inner_content}` in step {step.name or lineno!r}",
                    "A step's properties are a block mapping; a row here this reader "
                    "cannot name could be `shell`, `continue-on-error` or `env` under "
                    "a spelling all three rules would then miss.",
                )
            key, value = parsed
            if key == "name" and not step.name:
                step.name = value.strip("\"'")
            elif key == "shell":
                step.shell = (
                    resolve_scalar(
                        rows, inner, inner_indent, value, path, inner_line,
                        f"the `shell:` of step {step.name or lineno!r}",
                    ),
                    inner_line,
                )
            elif key == "continue-on-error":
                step.continue_on_error = (
                    resolve_boolean(
                        rows, inner, inner_indent, value, path, inner_line,
                        f"the `continue-on-error:` of step {step.name or lineno!r}",
                    ),
                    inner_line,
                )
            elif key == "env":
                if value:
                    _refuse_unresolvable(
                        path, inner_line, f"the inline `env:` in step {step.name or lineno!r}",
                        "Rule 2 reads this mapping's KEYS; an unresolved one reads "
                        "as an empty step env, so nothing it declares can shadow.",
                    )
                step.env = _mapping_keys(
                    rows, inner + 1, _child_indent(rows, inner), path,
                    f"the `env:` of step {step.name or lineno!r}",
                )
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

    `where` is `<job>`, `<job>/<step>`, `<job>/<step>/<key>`, or -- for the two
    `defaults.run.shell` positions rule 3 also covers -- the bare
    `DEFAULT_SHELL_SUBJECT` (workflow level) or `<job>/DEFAULT_SHELL_SUBJECT`.
    """
    workflow = next((w for w in workflows if w.name == workflow_name), None)
    if workflow is None:
        return None  # already refused by test_allowlist_entries_name_real_workflows
    if rule == "custom-shell" and where == DEFAULT_SHELL_SUBJECT:
        if workflow.default_shell is None:
            return (
                f"exempts the workflow-level `defaults.run.shell`, which "
                f"{workflow_name} does not set"
            )
        return None
    job_name, _, rest = where.partition("/")
    job = workflow.jobs.get(job_name)
    if job is None:
        return f"names job {job_name!r}, which {workflow_name} does not declare"
    if rule == "custom-shell" and rest == DEFAULT_SHELL_SUBJECT:
        if job.default_shell is None:
            return (
                f"exempts `defaults.run.shell` on job {job_name!r}, which does not "
                f"set one"
            )
        return None

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

        PER JOB, not `any()` across the workflow. The 0.1.49 round-2 review
        found the `any()` form could let one job resolving steps mask another
        resolving none -- and could not exploit it, because the reader refuses
        every shape that produces a silent zero-step job. It was closed by the
        reader, not by this test, which is a fragile place for it to be closed.
        `all(job.steps ...)` would be WRONG: a reusable-workflow job (`uses:` at
        job level) legitimately has no steps, so that form false-reds the day
        one lands. `declares_steps` is the exact predicate -- a job that WROTE
        `steps:` must have resolved some -- and the reader now refuses a
        declared-but-empty `steps:` outright, so the two agree by construction.
        If you are here because a reusable-workflow job went red, the bug is in
        the reader setting `declares_steps`, never in relaxing this back to
        `any()`.
        """
        self.assertTrue(self.workflows, "no workflows were discovered")
        declaring = 0
        for workflow in self.workflows:
            with self.subTest(workflow=workflow.name):
                self.assertTrue(workflow.jobs, "resolved no jobs")
                for name, job in sorted(workflow.jobs.items()):
                    if not job.declares_steps:
                        continue  # a reusable-workflow call has no steps to resolve
                    declaring += 1
                    self.assertTrue(
                        job.steps,
                        f"job {name!r} declares `steps:` and the reader resolved none",
                    )
        self.assertTrue(declaring, "no job in any workflow declares `steps:`")

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
        # A resolved BOOLEAN, not the text `true`: rule 1 never sees a string,
        # so there is no spelling left for it to compare wrong.
        self.assertEqual(step.continue_on_error, (True, 6))
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
        # Quotes are STRIPPED by the resolver, the way a real parser strips
        # them -- the rule compares a resolved value, never a spelling.
        "single-quoted scalar value":
            ("      - name: Probe\n        shell: 'sh'\n", "Probe", "sh"),
        "double-quoted scalar value":
            ('      - name: Probe\n        shell: "sh"\n', "Probe", "sh"),
    }

    UNRESOLVABLE_SHAPES = {
        "flow-mapping step item": "      - {name: Probe, shell: sh}\n",
        "aliased step item": "      - *a_step\n",
        "anchored step item": "      - &a_step\n        name: Probe\n",
        "bare scalar step item": "      - checkout\n",
        "merge key inside a step": "      - name: Probe\n        <<: *defaults\n",
        "explicit key inside a step": "      - name: Probe\n        ? shell\n        : sh\n",
        # Rule 3 keys on PRESENCE, so an unresolvable `shell:` value would
        # still redden -- but it would redden with text this reader never
        # resolved in the message, and `stale_reason` would compare that text.
        # The value layer is uniform across both rules that read one.
        "tagged step shell": "      - name: Probe\n        shell: !!str sh\n",
        "expression step shell": "      - name: Probe\n        shell: ${{ env.S }}\n",
        "step shell on the following line":
            "      - name: Probe\n        shell:\n          sh\n",
        "inline step env": "      - name: Probe\n        env: {A: 1}\n",
        "merge key inside a step env":
            "      - name: Probe\n        env:\n          <<: *outer\n",
        "explicit key inside a step env":
            "      - name: Probe\n        env:\n          ? GO_COVERAGE_FLOOR\n          : '0'\n",
        "step env entry this reader cannot name":
            "      - name: Probe\n        env:\n          0BAD: 1\n",
        "step env written as a sequence":
            "      - name: Probe\n        env:\n          - GO_COVERAGE_FLOOR\n",
    }

    # THE POINT OF THE WHOLE INVERSION, as an executable table.
    #
    # Every row is valid YAML that a real parser resolves TRUTHY or to the
    # string "true" -- so every row is a way of writing `continue-on-error:
    # true` that the runner would honour or that at minimum this reader cannot
    # honestly call "not true". None of them has a branch anywhere in this
    # file. They go red because the reader refuses what it does not recognise,
    # which is the only property that survives the next spelling nobody here
    # has thought of.
    #
    # `actionlint` rc=0 on `!!bool true`, `${{ true }}` and the next-line
    # scalar: those four SHIPPED past this gate at the 0.1.49 round-2 head and
    # are the review's finding 1. The rest `actionlint` happens to reject
    # today, and they are refused here anyway -- a fail-closed reader that
    # depends on another tool catching what it waves through is not fail-closed.
    UNRECOGNISED_TRUE_SPELLINGS = {
        "the scalar on the following line": "continue-on-error:\n          true\n",
        "an explicit `!!bool` tag": "continue-on-error: !!bool true\n",
        "an expression": "continue-on-error: ${{ true }}\n",
        "an `!!str` tag": "continue-on-error: !!str true\n",
        "a folded block scalar": "continue-on-error: >-\n          true\n",
        "a literal block scalar": "continue-on-error: |-\n          true\n",
        "a YAML 1.1 `yes`": "continue-on-error: yes\n",
        "a YAML 1.1 `on`": "continue-on-error: on\n",
        "an integer": "continue-on-error: 1\n",
        "a double-quoted escape": 'continue-on-error: "tr\\u0075e"\n',
        "an anchored value": "continue-on-error: &c true\n",
        "a flow sequence": "continue-on-error: [true]\n",
    }

    # The complete set of spellings the reader DOES resolve, and what it
    # resolves them to. Rule 1 is total across these two tables: every input is
    # in one or the other, so there is no third outcome for a spelling to hide
    # in. `True` here means rule 1 refuses; `False` means it passes.
    RECOGNISED_BOOLEANS = {
        "true": True, "True": True, "TRUE": True, '"true"': True, "'true'": True,
        "false": False, "False": False, "FALSE": False, '"false"': False,
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
            ("merge key at the root",
             "<<: *root\njobs:\n  gate:\n    steps:\n      - name: P\n"),
            ("explicit key among a job's properties",
             "jobs:\n  gate:\n    ? shell\n    : sh\n    steps:\n      - name: P\n"),
            ("row under `jobs:` that is not a job id",
             "jobs:\n  <<: *jobs\n  gate:\n    steps:\n      - name: P\n"),
            ("inline job defaults",
             "jobs:\n  gate:\n    defaults: {run: {shell: sh}}\n    steps:\n      - name: P\n"),
            ("inline workflow defaults",
             "defaults: *d\njobs:\n  gate:\n    steps:\n      - name: P\n"),
            ("aliased defaults.run",
             "jobs:\n  gate:\n    defaults:\n      run: *r\n    steps:\n      - name: P\n"),
            ("second document",
             "jobs:\n  gate:\n    steps:\n      - name: P\n---\njobs:\n  gate:\n"
             "    steps:\n      - name: Q\n"),
        ):
            with self.subTest(shape=label):
                with self.assertRaises(AssertionError) as caught:
                    _parse_synthetic(text)
                self.assertIn("cannot resolve", str(caught.exception))

    def test_a_job_that_declares_steps_must_resolve_some(self):
        """The silent zero-step job, closed at the reader rather than the test.

        A job whose `steps:` resolves to nothing is invisible to all three
        rules while still counting as a job, and the anti-vacuity test above
        can only see it if the reader hands it over. So the reader refuses it,
        and a reusable-workflow job -- `uses:` at job level, no `steps:` key at
        all -- must NOT be refused, which is the whole reason the predicate is
        `declares_steps` rather than "has steps".
        """
        with self.assertRaises(AssertionError) as caught:
            _parse_synthetic("jobs:\n  application:\n    steps:\n    runs-on: x\n")
        self.assertIn("cannot resolve", str(caught.exception))
        self.assertIn("resolved none", str(caught.exception))
        reusable = _parse_synthetic(
            "jobs:\n  call:\n    uses: ./.github/workflows/other.yml\n"
            "  application:\n    steps:\n      - name: Probe\n        run: true\n"
        )
        self.assertFalse(reusable.jobs["call"].declares_steps)
        self.assertEqual(reusable.jobs["call"].steps, [])
        self.assertTrue(reusable.jobs["application"].declares_steps)

    def test_the_step_floor_still_bites_on_a_job_the_reader_cannot_produce(self):
        """Drive the per-job floor over a state the READER now refuses to emit.

        `test_every_workflow_resolves_into_jobs_and_steps` asserts, per job,
        that a job which declared `steps:` resolved some. The reader refuses a
        declared-but-empty `steps:` outright (the test above), so NO workflow
        text can reach that assertion any more -- which would leave it
        decorative and its deletion undetectable, the exact surviving-mutant
        class these reviews keep finding. Constructing the `Job` directly is
        the honest way to prove it still bites: it is the same shadow-the-
        instance seam `_drive` uses for the three rules, and it drives the
        SHIPPED assertion rather than a copy of it.
        """
        probe = WorkflowIntegrityTests("test_every_workflow_resolves_into_jobs_and_steps")
        hollow = Workflow(path=WORKFLOWS / "pr-gate.yml")
        hollow.jobs["application"] = Job(name="application", line=1, declares_steps=True)
        probe.workflows = [hollow]
        with self.assertRaises(probe.failureException) as caught:
            probe.test_every_workflow_resolves_into_jobs_and_steps()
        self.assertIn("resolved none", str(caught.exception))
        # Positive control, both directions: the floor passes once that job
        # resolves a step, AND a reusable-workflow job that declares none is
        # never asked to -- which is why `all(job.steps ...)` would be wrong.
        hollow.jobs["application"].steps.append(Step(name="Probe", line=2))
        hollow.jobs["call"] = Job(name="call", line=3)
        probe.test_every_workflow_resolves_into_jobs_and_steps()

    def test_the_default_shell_subject_is_the_spelling_the_allowlist_documents(self):
        """Code and lift file must agree on the one subject an operator types.

        `DEFAULT_SHELL_SUBJECT` is the allowlist `<where>` for the two
        `defaults.run.shell` positions, and it is the only rule-3 subject that
        is not simply a step's name. Renaming the constant would move the rule
        and its own fixtures together and leave the allowlist header -- the
        thing a human reads before typing the line -- documenting a spelling
        nothing accepts. This is a parity pin, not an inventory: it names ONE
        string, and adding subjects needs no edit here.
        """
        self.assertEqual(DEFAULT_SHELL_SUBJECT, "<defaults.run.shell>")
        self.assertIn(
            DEFAULT_SHELL_SUBJECT,
            ALLOWLIST.read_text(encoding="utf-8"),
            f"{ALLOWLIST.relative_to(ROOT)} does not document the "
            f"`{DEFAULT_SHELL_SUBJECT}` subject its readers have to type.",
        )

    def test_an_unrecognised_way_of_writing_true_is_refused(self):
        """The inversion, stated as a test: refuse what you cannot resolve.

        Three review rounds found "another valid form evades the reader", and
        enumerating forms is why -- a hand-rolled YAML subset that recognises
        the spellings of `true` somebody listed, and treats everything else as
        "not true", leaks by construction. The default is the defect.

        So the reader now refuses any scalar outside a small, explicit set, and
        this table is the proof: none of these rows has a branch in this file,
        and every one of them raises. Add another exotic-but-valid spelling
        here and it goes red with NO code change -- that is the property being
        pinned, not the twelve particular rows.
        """
        # A floor, never a count: emptying the table would make the loop
        # vacuous and its deletion undetectable, which is the exact
        # surviving-mutant class the 0.1.49 reviews kept finding. Adding rows
        # needs no edit here.
        self.assertTrue(self.UNRECOGNISED_TRUE_SPELLINGS, "the spelling table is empty")
        for label, construct in self.UNRECOGNISED_TRUE_SPELLINGS.items():
            for position, text in (
                ("job", "jobs:\n  application:\n    " + construct
                        + "    steps:\n      - name: Probe\n        run: true\n"),
                ("step", "jobs:\n  application:\n    steps:\n      - name: Probe\n"
                         "        " + construct),
            ):
                with self.subTest(spelling=label, position=position):
                    with self.assertRaises(AssertionError) as caught:
                        _parse_synthetic(text)
                    self.assertIn("cannot resolve", str(caught.exception))

    def test_rule_one_resolves_every_spelling_it_does_recognise(self):
        """The positive control, and the other half of rule 1's totality.

        Without this the test above could pass on a reader that refuses every
        `continue-on-error` ever written, which would be a gate nobody can use
        and would hide a rule that no longer fires. Between the two tables
        every input either refuses or resolves to one of exactly two booleans:
        `true` in any casing or quoting REFUSES, `false` and a bare null PASS.
        """
        self.assertTrue(self.RECOGNISED_BOOLEANS, "the recognised-boolean table is empty")
        self.assertIn(True, self.RECOGNISED_BOOLEANS.values(), "no refusing spelling")
        self.assertIn(False, self.RECOGNISED_BOOLEANS.values(), "no passing spelling")
        for spelling, expected in self.RECOGNISED_BOOLEANS.items():
            with self.subTest(spelling=spelling):
                job = _parse_synthetic(
                    f"jobs:\n  application:\n    continue-on-error: {spelling}\n"
                    f"    steps:\n      - name: Probe\n        run: true\n"
                ).jobs["application"]
                self.assertEqual(job.continue_on_error, (expected, 3))
                refused = bool(
                    self._drive(
                        "test_no_required_check_continues_on_error",
                        f"jobs:\n  application:\n    continue-on-error: {spelling}\n"
                        f"    steps:\n      - name: Probe\n        run: true\n",
                    )
                )
                self.assertEqual(refused, expected, "the rule disagreed with the reader")
        # A bare `continue-on-error:` with nothing under it is YAML null, which
        # is falsy in every parser and in the runner. It must NOT false-red --
        # the fail-closed repair has to distinguish "no value" from "a value
        # this reader cannot see", and this is the boundary between them.
        job = _parse_synthetic(
            "jobs:\n  application:\n    continue-on-error:\n"
            "    steps:\n      - name: Probe\n        run: true\n"
        ).jobs["application"]
        self.assertEqual(job.continue_on_error, (False, 3))

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
    # Rule 3's construct written where no step carries it. Both positions pass
    # `actionlint` at rc=0 and both reshell every `run:` step beneath them.
    JOB_DEFAULT_SHELL = (
        "jobs:\n  application:\n    defaults:\n      run:\n        shell: sh\n"
        "    steps:\n      - name: Probe\n        run: true\n"
    )
    WORKFLOW_DEFAULT_SHELL = (
        "defaults:\n  run:\n    shell: sh\n"
        "jobs:\n  application:\n    steps:\n      - name: Probe\n        run: true\n"
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
            ("rule 3 / job defaults", "test_no_gate_step_sets_a_custom_shell",
             self.JOB_DEFAULT_SHELL, "defaults.run.shell: sh"),
            ("rule 3 / workflow defaults", "test_no_gate_step_sets_a_custom_shell",
             self.WORKFLOW_DEFAULT_SHELL, "at workflow level"),
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
            ("rule 3 / job defaults", "test_no_gate_step_sets_a_custom_shell",
             self.JOB_DEFAULT_SHELL,
             ("pr-gate.yml", "custom-shell", f"application/{DEFAULT_SHELL_SUBJECT}")),
            ("rule 3 / workflow defaults", "test_no_gate_step_sets_a_custom_shell",
             self.WORKFLOW_DEFAULT_SHELL,
             ("pr-gate.yml", "custom-shell", DEFAULT_SHELL_SUBJECT)),
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
        # `keyed` carries a BOOLEAN the reader already resolved -- or the reader
        # raised. There is no text normalisation left to do here, and that is
        # the point: every "another spelling of true" this gate leaked came
        # from comparing text at this line instead of resolving it at the
        # reader. `None` means the key is absent; `False` covers `false` in any
        # casing and a bare `continue-on-error:` (YAML null).
        if keyed is None:
            return
        value, line = keyed
        if not value:
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
        """A custom shell changes failure semantics under `set -euo pipefail`.

        Three positions, not one. `defaults.run.shell` at workflow or job level
        reshells EVERY `run:` step beneath it and is the same construct written
        where no step carries it; both positions pass `actionlint` at rc=0 and
        both left this rule green until the 0.1.49 round-3 audit.
        """
        for workflow in self.workflows:
            required = sorted(required_jobs(workflow))
            if required and workflow.default_shell is not None:
                # Workflow-level defaults reach every job, so any required job
                # at all makes this in scope; the subject carries no job name
                # because the construct is not written inside one.
                shell, line = workflow.default_shell
                self._refuse_shell(
                    workflow, shell, line, DEFAULT_SHELL_SUBJECT,
                    f"`defaults.run.shell: {shell}` at workflow level, which replaces "
                    f"the runner default for every `run:` step in every job -- "
                    f"including the required-checks jobs {', '.join(required)}",
                )
            for name in required:
                job = workflow.jobs[name]
                if job.default_shell is not None:
                    shell, line = job.default_shell
                    self._refuse_shell(
                        workflow, shell, line, f"{name}/{DEFAULT_SHELL_SUBJECT}",
                        f"`defaults.run.shell: {shell}` on required-checks job "
                        f"{name!r}, which replaces the runner default for every "
                        f"`run:` step in it",
                    )
                for step in job.steps:
                    if step.shell is None:
                        continue
                    shell, line = step.shell
                    self._refuse_shell(
                        workflow, shell, line, f"{name}/{step.name}",
                        f"step {step.name!r} in required-checks job {name!r} sets "
                        f"`shell: {shell}`",
                    )

    def _refuse_shell(self, workflow, shell, line, where, subject):
        if (workflow.name, "custom-shell", where) in self.allowlist:
            return
        self.fail(
            f"{workflow.path.relative_to(ROOT)}:{line}: {subject}. The "
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
            "defaults:\n"
            "  run:\n"
            "    shell: sh\n"
            "jobs:\n"
            "  application:\n"
            "    continue-on-error: true\n"
            "    defaults:\n"
            "      run:\n"
            "        shell: sh\n"
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
            "  chart:\n"
            "    steps:\n"
            "      - name: Plain\n"
            "        run: true\n"
        )
        workflows = [parse_workflow(text, WORKFLOWS / "pr-gate.yml")]
        live = (
            ("continue-on-error", "application"),
            ("continue-on-error", "application/Probe"),
            ("custom-shell", "application/Probe"),
            ("custom-shell", DEFAULT_SHELL_SUBJECT),
            ("custom-shell", f"application/{DEFAULT_SHELL_SUBJECT}"),
            ("env-shadow", "application/Probe/GO_COVERAGE_FLOOR"),
        )
        for rule, where in live:
            with self.subTest(live=f"{rule}|{where}"):
                self.assertIsNone(stale_reason(workflows, "pr-gate.yml", rule, where))
        stale = (
            ("continue-on-error", "no-such-job", "does not declare"),
            ("custom-shell", "application/No Such Step", "does not have"),
            ("custom-shell", "application/Plain", "does not set one"),
            ("custom-shell", f"chart/{DEFAULT_SHELL_SUBJECT}", "does not set one"),
            ("continue-on-error", "application/Plain", "does not set it"),
            ("env-shadow", "application/Probe/NOT_DECLARED", "does not declare it"),
            ("env-shadow", "application/Probe", "is missing the"),
        )
        for rule, where, expected in stale:
            with self.subTest(stale=f"{rule}|{where}"):
                reason = stale_reason(workflows, "pr-gate.yml", rule, where)
                self.assertIsNotNone(reason, "a stale entry was not refused")
                self.assertIn(expected, str(reason))
        # The workflow-level subject needs a workflow that does NOT set one,
        # which the fixture above deliberately does.
        plain = [parse_workflow(self.CLEAN, WORKFLOWS / "pr-gate.yml")]
        reason = stale_reason(plain, "pr-gate.yml", "custom-shell", DEFAULT_SHELL_SUBJECT)
        self.assertIsNotNone(reason, "a stale workflow-level entry was not refused")
        self.assertIn("does not set", str(reason))


if __name__ == "__main__":
    unittest.main()
