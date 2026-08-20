#!/usr/bin/env python3
"""Whole-render NetworkPolicy census for the Helm chart (issue #86).

WHY THIS EXISTS. `scripts/ci/chart-egress-pin.sh` used to recognise a YAML
document only by a raw line whose prefix was exactly `kind` and a raw line
exactly equal to `spec:`. YAML permits whitespace before a mapping key's
colon, permits the key to be quoted, and permits escapes inside a
double-quoted key, so a SECOND `NetworkPolicy` in the very same rendered
file could spell itself `kind :` / `spec :` and be invisible to that census
and to every one of its self-mutations -- while parsing, under a real YAML
implementation, as an empty-selector `policyTypes: [Egress]` policy with one
empty egress rule. Kubernetes NetworkPolicy allowances are ADDITIVE, so that
second document hands every Pod unrestricted outbound access while the first
one still reads "default deny". The independent security review of PR #80
reproduced exactly that at the merged head; issue #86 carries its minimum
fix, implemented here.

WHAT THIS MODULE DOES. It reads the COMPLETE installable Helm render -- every
template file, CRDs included, not one `--show-only` extract -- through a real
document reader that resolves keys to their canonical spelling before any
matching happens, flattens list wrappers so nothing can hide inside one, and
then requires the whole render to contain EXACTLY ONE NetworkPolicy whose
object equals an expectation this gate states itself. Nothing about the
expectation is read back out of the template under test: an expectation
derived from the thing it checks passes for anything that thing renders.

WHERE THE EXPECTED FACTS COME FROM.

- The deny itself (`policyTypes` including `Egress`, `egress: []`) and the
  document inventory are CONSTANTS in this file. "No outbound connection,
  ever" is not configuration.
- The workload selector's two facts are the chart name (`chart/Chart.yaml`
  metadata) and the release name/namespace this gate renders with (passed in
  on the command line).
- The ingress peer identity and service port come from `chart/values.yaml`,
  the deployment-provider binding point AGENTS.md designates -- the same
  source `chart-ingress-pin.sh` uses, and the reason no provider name
  appears anywhere in this file.

WHY THE READER IS WRITTEN HERE. Requirement 1 and requirement 9 keep this
repository free of third-party runtime and toolchain dependencies; CI runs
no unpinned interpreter package, so PyYAML and yq are both unavailable. This
module therefore implements the reader, in the same spirit as
`scripts/ci/dependabot_contract.py`, but over the wider YAML subset a Helm
render actually uses: comments, flow collections, quoted keys and scalars,
and block scalars.

FAIL-CLOSED IS THE STRUCTURAL DESIGN GOAL. This reader does not implement all
of YAML, and it does not try to: the goal every rule below serves is that it
REFUSE rather than misread. Every construct it does not fully understand is
refused with the offending line named, never guessed at, so an unreadable
render is a red gate rather than a quiet pass. That is the design goal, not a
proof -- what is PROVEN is the bounded, re-runnable differential claim stated
after the list, over a corpus three rounds of independent review have
extended. Refused outright:

- tabs, carriage returns, other C0 control characters, DEL, the C1 control
  characters U+0080-U+009F (a real YAML reader rejects the whole stream for
  one; the range STOPS at U+009F, so `©`, `é`, CJK and emoji all read
  normally), byte-order marks (U+FEFF, anywhere in the stream -- invisible,
  and readers disagree about whether a leading one belongs to the next
  token), and `%` directives;
- the Unicode line breaks NEL (U+0085), LINE SEPARATOR (U+2028) and
  PARAGRAPH SEPARATOR (U+2029), anywhere in the stream: a real YAML reader
  BREAKS THE LINE at each of them, so a stream carrying one has a different
  number of lines there than here. `\\N`, `\\L` and `\\P` inside a
  double-quoted scalar still PRODUCE those characters, exactly as PyYAML
  does -- the refusal is about what the render's own bytes contain;
- anchors (`&`), aliases (`*`), tags (`!`), explicit keys (`?`), and merge
  keys (`<<`) -- each of which lets one document's meaning be assembled
  somewhere else in the stream;
- every other indicator a plain scalar may not open with, in KEY and VALUE
  position alike and from one shared constant (`_INDICATOR_START`), because
  a set kept in two places drifted apart once already;
- duplicate mapping keys, in block and flow style alike, since a later
  duplicate silently replaces the pinned earlier one;
- non-string mapping keys, plain keys carrying a comment (`k #: v` is the
  plain scalar "k" to a real reader, not a mapping entry), and plain keys
  inside a flow mapping whose colon is glued to what follows (`{a:1}` is the
  single scalar `a:1` there, with no value at all);
- flow collections or quoted scalars that do not open and close on one line,
  and multi-line plain scalars;
- plain scalars whose meaning differs between YAML 1.1 and 1.2 (`yes`, `no`,
  `on`, `off`, `y`, `n`), sexagesimals (`1:30`, and `1_:0` -- the digit
  groups take underscores too), hex/octal/binary integers, exponent forms
  (`1e3`, `1.0e3`), digit-group underscores (`1_000`), timestamps
  (`2026-08-20`, `2026-08-20T10:30:00Z`), `.inf`/`.nan`, and integers with a
  leading zero;
- the plain scalars `=` and `<<`, YAML 1.1's value key and merge key:
  PyYAML's SAFE loader has no constructor for either tag and REFUSES a
  document that carries one as a VALUE, while reading the same bytes as an
  ordinary string in key position. Refused in BOTH positions here, so this
  reader is never the more permissive of the two;
- plain scalars opening with a block sequence indicator (`- `), which real
  YAML refuses too -- this reader must never be MORE permissive than the
  tools that install the render.

Floats are the one number form this reader RESOLVES rather than refuses, so
`_FLOAT_RE` is PyYAML's own float-resolver decimal branches transcribed
character for character; `.5` is 0.5 to both readers and `-.5` is the string
"-.5" to both, because the oracle's leading-dot branch carries no sign.

Both directions are checked against PyYAML 6.0.3 -- the oracle, never a
dependency; nothing in this repository imports it -- over a corpus of
Helm-render and hostile shapes. Three rounds of independent review have
extended that corpus, and each round measured divergences this file then
closed:

- round one (PR #94): `1_000`, the integer 1000 to PyYAML and ACCEPTED as
  the string "1_000" here; and a byte-order mark before a key, stripped by
  PyYAML, so `kind` behind one stopped being the key `kind` here.
- round two (PR #96): YAML 1.1 timestamps -- `2026-08-20`,
  `2026-08-20T10:30:00Z`, `2026-08-20 10:30:00`, `2001-12-14 21:59:43.10 -5`
  and the other forms of PyYAML's own timestamp pattern -- ACCEPTED here as
  strings where PyYAML builds `date`/`datetime` objects; and the plain
  scalar `=`, ACCEPTED here as the string "=" where PyYAML's safe loader
  REFUSES the document, the one measured input in the direction that could
  hide a policy.
- round three (PR #96): signed leading-dot floats (`-.5`, `+.5`), READ AS
  FLOATS here and strings there -- closed by transcribing the oracle's own
  float branches rather than by refusing, so `.5` still resolves on both
  sides; flow-context colon-glued keys (`{a:1}`); NEL/LS/PS and the C1
  controls; and plain keys opening with an indicator (`@foo:`, `` `foo: ``,
  `|foo:`, `>foo:`, `,foo:`) that `_scan_value` already refused. The same
  round's exhaustive fuzz of the number and indicator alphabets found four
  more members and closed them the same way: `<<` in value position,
  underscored sexagesimals (`1_:0`, the integer 60 there), a comment inside
  a plain key (`k #: v`), and plain scalars run past `?`, `[` or `{` inside
  a flow collection.

Every one of those classes is closed. The claim this file makes is therefore
a bounded, re-runnable one rather than a universal quantifier: over that
corpus there is no input this reader accepts and reads differently than
PyYAML, and none it accepts that PyYAML refuses. Every divergence that
remains runs the other way -- this reader refusing something PyYAML resolves
(`2026_08`, `=` in key position) -- which is the direction that cannot hide
a document.

CLI (stdin is the render for `census` and `mutate`):

    python3 -I -B scripts/ci/chart_render_census.py census \\
        --chart chart --release NAME --namespace NAMESPACE
    python3 -I -B scripts/ci/chart_render_census.py mutations
    python3 -I -B scripts/ci/chart_render_census.py mutate \\
        --chart chart --release NAME --namespace NAMESPACE --name MUTATION

Exit 0 on success. Exit 1, with a `chart-render-census:` line on stderr
naming the offending line or the failed assertion, on any refusal. Exit 2 is
argparse's own usage-error status for a malformed invocation.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# --- The pinned expectation -------------------------------------------------
#
# Constants, deliberately: the deny is not configuration, and an expectation
# read out of the template under test would pass for any template.

POLICY_KIND = "NetworkPolicy"
POLICY_API_VERSION = "networking.k8s.io/v1"
POLICY_NAME_PREFIX = "ingress-to-"
POLICY_TYPES = ["Ingress", "Egress"]
POLICY_SPEC_KEYS = ("podSelector", "policyTypes", "ingress", "egress")
POLICY_METADATA_KEYS = ("name", "namespace", "labels")

# The complete installable render, as (apiVersion, kind) pairs. A census that
# only counted NetworkPolicies would still miss a second policy written under
# a CNI's own CRD kind (CiliumNetworkPolicy, crd.projectcalico.org
# NetworkPolicy, ...), so the inventory is pinned whole. Growing the chart by
# one document is therefore a deliberate edit HERE, with a reviewer reading
# what the new document is -- which is the point.
EXPECTED_INVENTORY = (
    ("apps/v1", "Deployment"),
    ("networking.k8s.io/v1", "NetworkPolicy"),
    ("v1", "Service"),
    ("v1", "ServiceAccount"),
)

# A list wrapper may nest, but not indefinitely; a render that needs more
# than this is a render nobody is reading by hand.
MAX_WRAPPER_DEPTH = 4


class CensusError(ValueError):
    """The render could not be read, or it fails the census."""


# --- Reader -----------------------------------------------------------------

_AMBIGUOUS_PLAIN = frozenset(
    {"y", "Y", "yes", "Yes", "YES", "n", "N", "no", "No", "NO", "on", "On", "ON", "off", "Off", "OFF"}
)
_NULL_PLAIN = frozenset({"~", "null", "Null", "NULL"})
_TRUE_PLAIN = frozenset({"true", "True", "TRUE"})
_FALSE_PLAIN = frozenset({"false", "False", "FALSE"})
_INT_RE = re.compile(r"[-+]?[0-9]+")
# A float is the one number form this reader RESOLVES rather than refuses, so
# its pattern is PyYAML's own float resolver's two decimal branches,
# transcribed character for character:
#
#     [-+]?(?:[0-9][0-9_]*)\.[0-9_]*(?:[eE][-+][0-9]+)?
#     \.[0-9][0-9_]*(?:[eE][-+][0-9]+)?
#
# The leading-dot branch carries NO sign there -- only the branch with a digit
# BEFORE the dot does -- so `-.5` and `+.5` match neither, and PyYAML 6.0.3
# reads them as the STRINGS "-.5"/"+.5". A pattern that allowed a sign in front
# of a leading-dot mantissa made them the floats -0.5/0.5 here: the same shape
# as `1_000` and the timestamps, and PR #96's round-three review measured it.
# Unsigned `.5` stays a float on both sides. The resolver's other three
# branches -- sexagesimal floats, `.inf`, `.nan` -- and the exponent suffix are
# all refused further up, so only plain decimals ever reach this pattern and
# `float()` never sees an underscore or an exponent.
_FLOAT_RE = re.compile(
    r"[-+]?(?:[0-9][0-9_]*)\.[0-9_]*(?:[eE][-+][0-9]+)?"
    r"|\.[0-9][0-9_]*(?:[eE][-+][0-9]+)?"
)
# Exponent forms are refused outright: YAML 1.2 reads `1e3` and `1.0e3` as
# floats, while YAML 1.1 -- which is what sigs.k8s.io/yaml and PyYAML 6.0.3
# implement -- reads both as plain strings and wants `1.0e+3`. Three spellings,
# two answers, no way to be sure which one a cluster will see.
_EXPONENT_RE = re.compile(r"[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)[eE][-+]?[0-9]+")
# Sexagesimals carry digit-group underscores too, and the two YAML 1.1
# resolvers that VALUE them -- the int branch `[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+`
# and the float branch `[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*` -- both
# allow `_` inside every digit group. A pattern that allowed digits only left
# `1_:0` a string here and the integer 60 there, which PR #96's round-three
# exhaustive fuzz of the number alphabet found; `_` is in every class below so
# this pattern is a strict SUPERSET of both oracle branches, which is the
# direction that can only ever over-refuse.
_SEXAGESIMAL_RE = re.compile(r"[-+]?[0-9][0-9_]*(?::[0-9_]+)+(?:\.[0-9_]*)?")
# Timestamps are refused for the same reason, one step further along: YAML 1.1
# resolves a timestamp-shaped plain scalar to a date/datetime OBJECT -- PyYAML
# 6.0.3 reads `2026-08-20` as `datetime.date(2026, 8, 20)` and
# `2026-08-20 10:30:00` as a `datetime` -- while YAML 1.2's core schema has no
# timestamp type at all and reads the same bytes as a string. The pattern below
# is PyYAML's own resolver pattern, transcribed, so this reader refuses exactly
# the forms that reader VALUES and no more: the bare date form wants a two-digit
# month and day, which is why `2026-8-20` on its own stays the string both
# readers already agree it is, and `2026-08-20t10:30:00z` (lowercase zone) does
# too. Tabs never survive `_check_bytes`; `\t` is kept in the pattern only so it
# stays the oracle's, character for character.
_TIMESTAMP_RE = re.compile(
    r"(?:[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]"
    r"|[0-9][0-9][0-9][0-9]-[0-9][0-9]?-[0-9][0-9]?"
    r"(?:[Tt]|[ \t]+)[0-9][0-9]?:[0-9][0-9]:[0-9][0-9](?:\.[0-9]*)?"
    r"(?:[ \t]*(?:Z|[-+][0-9][0-9]?(?::[0-9][0-9])?))?)"
)
# `=` is YAML 1.1's "value key". PyYAML resolves a plain `=` to
# `tag:yaml.org,2002:value`, and its SAFE loader has no constructor for that
# tag, so `a: =` raises a ConstructorError instead of parsing; in KEY position
# the same bytes survive as the string "=", because `flatten_mapping` retags
# them first. One spelling, two answers, and one of those answers is a hard
# refusal in the tool that would install the render -- the one direction a
# reader must never be looser in. Refused in both positions.
_VALUE_KEY_PLAIN = "="
# `<<` is YAML 1.1's merge key, and it is the exact same shape as `=` one tag
# along: PyYAML resolves a plain `<<` to `tag:yaml.org,2002:merge`, its SAFE
# loader has no constructor for that tag, and `a: <<` therefore raises a
# ConstructorError instead of parsing -- while `_scan_key` already refused it
# in key position. PR #96's round-three hunt measured it in value position,
# where this reader handed back the string "<<" and read on. Refused in both,
# for the same reason: a gate that reads a document the installer will not read
# is a gate reporting on something else.
_MERGE_KEY_PLAIN = "<<"
# Digit-group underscores are refused for the same reason as the exponent
# forms: YAML 1.1 -- what PyYAML 6.0.3 and sigs.k8s.io/yaml implement -- lets
# `_` separate digit groups, so `1_000` is the integer 1000 there, while
# YAML 1.2 has no such form and reads the same bytes as the string "1_000".
# One spelling, two answers. The pattern requires a leading digit (after an
# optional sign) exactly as YAML 1.1 does, so `_1` stays the string both
# readers already agree it is; the caller checks for an underscore first, so
# ordinary numbers never reach it.
_UNDERSCORE_NUMBER_RE = re.compile(
    r"[-+]?(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9][0-9_]*)(?:[eE][-+]?[0-9_]+)?"
)
_RADIX_RE = re.compile(r"[-+]?0[xXoObB][0-9a-fA-F_]+")
_SPECIAL_FLOAT_RE = re.compile(r"[-+]?\.(?:inf|Inf|INF|nan|NaN|NAN)")
# The characters a plain scalar may not OPEN with. PyYAML's `check_plain`
# forbids `-?:,[]{}#&*!|>'"%@` plus a backtick, letting through only `-` when
# the next character is not a space, and `?`/`:` when the next character is not
# a space AND the scalar is not inside a flow collection. This reader refuses
# the same set from ONE constant used in
# all three plain-scalar entry points -- block value, block key, flow key --
# because a set that lived in two places drifted apart once already: `_scan_key`
# refused only `& * ! ?` while `_scan_value` refused the wider set, so `@foo:`,
# `` `foo: ``, `|foo:`, `>foo:` and `,foo:` were keys here and hard scanner
# errors in the tool that installs the render. Quotes, `[`, `{` and `#` never
# reach the check in value position -- they are dispatched to the quoted, flow
# and comment paths first -- and the two deliberate, measured asymmetries are
# `-` (refused only as the block sequence indicator `- `, since `-5` is a plain
# scalar both readers agree on) and `:` (a legal plain-scalar opener in BLOCK
# context, refused only inside a flow collection, exactly as PyYAML does).
_INDICATOR_START = "&*!?|>%@`,[]{}#"

# NEL, LINE SEPARATOR and PARAGRAPH SEPARATOR are LINE BREAKS to a YAML 1.1
# reader and ordinary characters to anything that only splits on `\n`. PyYAML
# 6.0.3 breaks the line at each of them, so `kind: Network<NEL>Policy` is two
# lines and a scanner error there while it was one line and the scalar
# "Network\x85Policy" here -- and a leading or trailing one silently vanished
# from a key or value here that PyYAML never saw at all. Refused everywhere in
# the stream, never translated: a reader that disagrees with the installer
# about how many LINES a document has is not reading the same document.
_UNICODE_LINE_BREAKS = {
    "\x85": "NEL (U+0085)",
    "\u2028": "LINE SEPARATOR (U+2028)",
    "\u2029": "PARAGRAPH SEPARATOR (U+2029)",
}

_SIMPLE_ESCAPES = {
    "0": "\0",
    "a": "\a",
    "b": "\b",
    "t": "\t",
    "n": "\n",
    "v": "\v",
    "f": "\f",
    "r": "\r",
    "e": "\x1b",
    " ": " ",
    '"': '"',
    "/": "/",
    "\\": "\\",
    "N": "\x85",
    "_": "\xa0",
    "L": "\u2028",
    "P": "\u2029",
}


def _indent_of(raw: str) -> int:
    return len(raw) - len(raw.lstrip(" "))


def _ignorable(raw: str) -> bool:
    stripped = raw.strip()
    return stripped == "" or stripped.startswith("#")


class Reader:
    """A fail-closed reader for the YAML subset a Helm render actually uses."""

    def __init__(self, text: str, origin: str) -> None:
        self.origin = origin
        self.lines = text.split("\n")
        # A trailing newline terminates the last line; it does not add an
        # empty one. Keeping the split artefact would give a `|+` block
        # scalar one newline more than it really has.
        if self.lines and self.lines[-1] == "":
            self.lines.pop()
        self.i = 0
        self._check_bytes()

    # -- diagnostics --------------------------------------------------------

    def fail(self, message: str, lineno: int | None = None) -> None:
        if lineno is None:
            lineno = min(self.i + 1, len(self.lines))
        raise CensusError("%s line %d: %s" % (self.origin, lineno, message))

    def _check_bytes(self) -> None:
        for lineno, raw in enumerate(self.lines, start=1):
            if "\t" in raw:
                self.fail("tab characters are refused; YAML forbids them as indentation and "
                          "they make every column ambiguous", lineno)
            if "\r" in raw:
                self.fail("carriage returns are refused; a line that ends differently than it "
                          "looks is a line this gate will not guess at", lineno)
            if "\ufeff" in raw:
                # A byte-order mark is invisible and readers disagree about it:
                # PyYAML and the YAML spec strip one at stream start, so `kind`
                # behind a BOM is the key `kind` there, while a reader that does
                # not strip it sees a DIFFERENT key and stops recognising the
                # document. Anywhere else in the stream it is not even a
                # separator. Refused everywhere rather than stripped, so no
                # rendered byte is ever silently discarded.
                self.fail("a byte-order mark (U+FEFF) is refused; it is invisible and readers "
                          "disagree about whether it is part of the next token", lineno)
            for ch in raw:
                code = ord(ch)
                if code < 0x20 or code == 0x7F:
                    self.fail("control character %r is refused" % ch, lineno)
                if ch in _UNICODE_LINE_BREAKS:
                    self.fail("%s is refused; a real YAML reader treats it as a LINE BREAK, so "
                              "the bytes after it start a new line there while they continue "
                              "this one here -- one stream, two different documents"
                              % _UNICODE_LINE_BREAKS[ch], lineno)
                if 0x80 <= code <= 0x9F:
                    # PyYAML's reader rejects the whole stream for any of these
                    # (its printable set skips U+0080-U+009F), so a render this
                    # gate read happily would be a render nothing installs. The
                    # range STOPS at U+009F: U+00A0 and every letter above it --
                    # `©`, `é`, CJK, emoji -- stay perfectly readable.
                    self.fail("the C1 control character U+%04X is refused; a real YAML reader "
                              "rejects the entire stream for it, so a render this gate could "
                              "read would be a render nothing can install" % code, lineno)
            if raw[:1] == "%":
                self.fail("YAML directives are refused; they can change how the rest of the "
                          "stream is interpreted", lineno)

    # -- documents ----------------------------------------------------------

    def documents(self) -> list[object]:
        docs: list[object] = []
        while True:
            self._skip_ignorable()
            if self.i >= len(self.lines):
                return docs
            raw = self.lines[self.i]
            stripped = raw.strip()
            if _indent_of(raw) == 0 and (stripped == "---" or stripped.startswith("--- ")):
                if stripped != "---":
                    self.fail("content on a document-start line is refused; write the document "
                              "on the following lines")
                self.i += 1
                docs.append(self._document_body())
                continue
            if _indent_of(raw) == 0 and (stripped == "..." or stripped.startswith("... ")):
                if stripped != "...":
                    self.fail("content on a document-end line is refused")
                self.i += 1
                continue
            docs.append(self._document_body())

    def _document_body(self) -> object:
        self._skip_ignorable()
        if self.i >= len(self.lines):
            return None
        raw = self.lines[self.i]
        if _indent_of(raw) == 0 and raw.strip() in ("---", "..."):
            return None
        start = self.i
        node = self._node(_indent_of(raw))
        if self.i == start:
            self.fail("this document consumed no input; refusing rather than looping")
        return node

    def _skip_ignorable(self) -> None:
        while self.i < len(self.lines) and _ignorable(self.lines[self.i]):
            self.i += 1

    # -- nodes --------------------------------------------------------------

    def _node(self, indent: int) -> object:
        raw = self.lines[self.i]
        body = raw[indent:]
        if body.rstrip() == "-" or body.startswith("- "):
            return self._sequence(indent)
        if body[:1] in ("[", "{"):
            return self._scalar_line(indent)
        if self._scan_key(body, self.i + 1) is not None:
            return self._mapping(indent)
        return self._scalar_line(indent)

    def _scalar_line(self, indent: int) -> object:
        raw = self.lines[self.i]
        lineno = self.i + 1
        value, end = self._scan_value(raw, indent, lineno, flow=False)
        self._require_trailing_blank(raw, end, lineno)
        self.i += 1
        if self.i < len(self.lines):
            nxt = self.lines[self.i]
            if not _ignorable(nxt) and _indent_of(nxt) > indent:
                self.fail("multi-line plain scalars are refused; a value that continues onto "
                          "the next line is a value this gate will not guess at", self.i + 1)
        return value

    def _mapping(self, indent: int) -> dict:
        out: dict = {}
        while self.i < len(self.lines):
            raw = self.lines[self.i]
            if _ignorable(raw):
                self.i += 1
                continue
            here = _indent_of(raw)
            if here == 0 and raw.strip() in ("---", "..."):
                break
            if here < indent:
                break
            if here > indent:
                self.fail("unexpected indentation inside a block mapping")
            body = raw[indent:]
            if body.rstrip() == "-" or body.startswith("- "):
                self.fail("a block sequence entry appears where a mapping key was expected")
            lineno = self.i + 1
            scanned = self._scan_key(body, lineno)
            if scanned is None:
                self.fail("this line is neither a mapping key nor anything else this reader "
                          "can parse")
            key, rest = scanned
            if key in out:
                self.fail("duplicate mapping key %r; a later duplicate silently replaces the "
                          "earlier one, so the pinned value could be overwritten unseen" % key,
                          lineno)
            self.i += 1
            out[key] = self._value_after_key(body[rest:], indent, lineno)
        return out

    def _sequence(self, indent: int) -> list:
        items: list = []
        while self.i < len(self.lines):
            raw = self.lines[self.i]
            if _ignorable(raw):
                self.i += 1
                continue
            here = _indent_of(raw)
            if here == 0 and raw.strip() in ("---", "..."):
                break
            if here < indent:
                break
            if here > indent:
                self.fail("unexpected indentation inside a block sequence")
            body = raw[indent:]
            if body.rstrip() == "-":
                self.i += 1
                items.append(self._child(indent, allow_sibling_sequence=False))
                continue
            if not body.startswith("- "):
                break
            offset = 2
            while indent + offset < len(raw) and raw[indent + offset] == " ":
                offset += 1
            # Rewriting the dash to spaces preserves every column, so the item
            # is parsed as an ordinary node at its own indentation.
            self.lines[self.i] = " " * (indent + offset) + raw[indent + offset:]
            items.append(self._node(indent + offset))
        return items

    def _value_after_key(self, text: str, parent_indent: int, lineno: int) -> object:
        stripped = text.strip()
        if stripped == "" or stripped.startswith("#"):
            return self._child(parent_indent, allow_sibling_sequence=True)
        if stripped[0] in ("|", ">"):
            return self._block_scalar(stripped, parent_indent, lineno)
        value, end = self._scan_value(text, 0, lineno, flow=False)
        self._require_trailing_blank(text, end, lineno)
        return value

    def _child(self, parent_indent: int, allow_sibling_sequence: bool) -> object:
        self._skip_ignorable()
        if self.i >= len(self.lines):
            return None
        raw = self.lines[self.i]
        here = _indent_of(raw)
        if here == 0 and raw.strip() in ("---", "..."):
            return None
        if here > parent_indent:
            return self._node(here)
        if allow_sibling_sequence and here == parent_indent:
            body = raw[here:]
            if body.rstrip() == "-" or body.startswith("- "):
                return self._sequence(here)
        return None

    def _block_scalar(self, header_text: str, parent_indent: int, lineno: int) -> str:
        parts = header_text.split(None, 1)
        header = parts[0]
        trailing = parts[1] if len(parts) > 1 else ""
        if trailing and not trailing.startswith("#"):
            self.fail("unexpected text after a block scalar header", lineno)
        style = header[0]
        chomp = ""
        explicit = None
        for ch in header[1:]:
            if ch in "+-":
                if chomp:
                    self.fail("a block scalar header carries two chomping indicators", lineno)
                chomp = ch
            elif ch in "123456789":
                if explicit is not None:
                    self.fail("a block scalar header carries two indentation indicators", lineno)
                explicit = int(ch)
            else:
                self.fail("unsupported block scalar header %r" % header, lineno)
        content: list[str] = []
        detected = parent_indent + explicit if explicit is not None else None
        while self.i < len(self.lines):
            raw = self.lines[self.i]
            if raw.strip() == "":
                content.append("")
                self.i += 1
                continue
            here = _indent_of(raw)
            if here <= parent_indent:
                break
            if detected is None:
                detected = here
            if here < detected:
                break
            content.append(raw[detected:])
            self.i += 1
        trailing_blanks = 0
        while content and content[-1] == "":
            content.pop()
            trailing_blanks += 1
        if style == "|":
            body = "\n".join(content)
        else:
            body = _fold(content)
        if not content:
            return "" if chomp != "+" else "\n" * trailing_blanks
        if chomp == "-":
            return body
        if chomp == "+":
            return body + "\n" * (1 + trailing_blanks)
        return body + "\n"

    # -- scalars ------------------------------------------------------------

    def _require_trailing_blank(self, text: str, end: int, lineno: int) -> None:
        rest = text[end:].strip()
        if rest and not rest.startswith("#"):
            self.fail("unexpected trailing content %r after a value" % rest, lineno)

    def _scan_key(self, body: str, lineno: int) -> tuple[str, int] | None:
        if body[:1] in ('"', "'"):
            text, end = self._scan_quoted(body, 0, lineno)
            j = end
            while j < len(body) and body[j] == " ":
                j += 1
            if j < len(body) and body[j] == ":" and (j + 1 == len(body) or body[j + 1] == " "):
                return text, j + 1
            return None
        j = 0
        while True:
            k = body.find(":", j)
            if k < 0:
                return None
            if k + 1 == len(body) or body[k + 1] == " ":
                key = body[:k].rstrip(" ")
                if key == "":
                    self.fail("a mapping key is empty", lineno)
                if key[0] in _INDICATOR_START or key.startswith("<<"):
                    self.fail("anchors, aliases, tags, explicit keys, and merge keys are "
                              "refused, and so is every other indicator a plain scalar may "
                              "not open with (%r); a key whose meaning is assembled elsewhere "
                              "in the stream, or that real YAML will not read as a key at "
                              "all, is a key this gate will not follow" % key[0], lineno)
                if '"' in key or "'" in key:
                    self.fail("unexpected quote character inside a plain mapping key", lineno)
                if " #" in key:
                    # ` #` opens a comment, so real YAML ends the scalar there
                    # and this line stops being a mapping entry at all: `k #: v`
                    # is the plain scalar "k" to PyYAML, and a mapping key "k #"
                    # here. Refused rather than re-implemented -- a rendered key
                    # carrying a comment is not a shape any chart needs.
                    self.fail("a plain mapping key may not carry a comment (%r); real YAML ends "
                              "the scalar at the ` #`, so this line is not the mapping entry it "
                              "looks like" % key, lineno)
                resolved = self._resolve_plain(key, lineno)
                if not isinstance(resolved, str):
                    self.fail("non-string mapping key %r is refused" % key, lineno)
                return resolved, k + 1
            j = k + 1

    def _scan_quoted(self, s: str, i: int, lineno: int) -> tuple[str, int]:
        quote = s[i]
        j = i + 1
        buf: list[str] = []
        if quote == "'":
            while j < len(s):
                if s[j] == "'":
                    if j + 1 < len(s) and s[j + 1] == "'":
                        buf.append("'")
                        j += 2
                        continue
                    return "".join(buf), j + 1
                buf.append(s[j])
                j += 1
            self.fail("unterminated single-quoted scalar; a quoted scalar must open and close "
                      "on one line here", lineno)
        while j < len(s):
            ch = s[j]
            if ch == '"':
                return "".join(buf), j + 1
            if ch == "\\":
                j += 1
                if j >= len(s):
                    self.fail("a double-quoted scalar ends with a dangling escape", lineno)
                esc = s[j]
                if esc in _SIMPLE_ESCAPES:
                    buf.append(_SIMPLE_ESCAPES[esc])
                    j += 1
                    continue
                if esc in ("x", "u", "U"):
                    width = {"x": 2, "u": 4, "U": 8}[esc]
                    digits = s[j + 1:j + 1 + width]
                    if len(digits) != width or any(c not in "0123456789abcdefABCDEF" for c in digits):
                        self.fail("malformed \\%s escape in a double-quoted scalar" % esc, lineno)
                    buf.append(chr(int(digits, 16)))
                    j += 1 + width
                    continue
                self.fail("unsupported escape sequence \\%s" % esc, lineno)
            buf.append(ch)
            j += 1
        self.fail("unterminated double-quoted scalar; a quoted scalar must open and close on "
                  "one line here", lineno)
        raise AssertionError("unreachable")  # pragma: no cover

    def _scan_value(self, s: str, i: int, lineno: int, flow: bool) -> tuple[object, int]:
        while i < len(s) and s[i] == " ":
            i += 1
        if i >= len(s) or s[i] == "#":
            return None, len(s)
        ch = s[i]
        if ch == "[":
            return self._flow_sequence(s, i, lineno)
        if ch == "{":
            return self._flow_mapping(s, i, lineno)
        if ch in ('"', "'"):
            return self._scan_quoted(s, i, lineno)
        if ch in _INDICATOR_START or (flow and ch == ":"):
            # `:` opens a legal plain scalar in BLOCK context (`a: :b` is the
            # string ":b" to PyYAML too) and an illegal one inside a flow
            # collection, which is why it is the one position-dependent member.
            self.fail("anchors, aliases, tags, explicit keys, block scalars in this position, "
                      "and every other indicator a plain scalar may not open with are "
                      "refused (%r)" % ch, lineno)
        if flow:
            j = i
            while j < len(s):
                cur = s[j]
                # PyYAML's `scan_plain` ends a plain scalar inside a flow
                # collection at any of `,?[]{}`, and at a `:` followed by a
                # space or one of `,[]{}`. Breaking on a narrower set left
                # `{b: 1 [}` the scalar "1 [" here and a parse error there.
                if cur in ",?[]{}":
                    break
                if cur == ":" and (j + 1 >= len(s) or s[j + 1] in " ,[]{}"):
                    break
                if cur == "#" and j > i and s[j - 1] == " ":
                    break
                j += 1
        else:
            j = len(s)
            k = i
            while k < len(s):
                if s[k] == "#" and (k == i or s[k - 1] == " "):
                    j = k
                    break
                k += 1
        raw = s[i:j].rstrip(" ")
        if raw == "":
            self.fail("empty scalar where a value was expected", lineno)
        if ": " in raw or raw.endswith(":"):
            self.fail("a plain scalar may not contain a mapping indicator (%r)" % raw, lineno)
        if raw == "-" or raw.startswith("- "):
            self.fail("a plain scalar may not open with a block sequence indicator (%r); "
                      "real YAML refuses this too, and refusing it keeps this reader from "
                      "being MORE permissive than the tools that install the render" % raw,
                      lineno)
        return self._resolve_plain(raw, lineno), j

    def _flow_sequence(self, s: str, i: int, lineno: int) -> tuple[list, int]:
        j = i + 1
        items: list = []
        while True:
            while j < len(s) and s[j] == " ":
                j += 1
            if j >= len(s):
                self.fail("unterminated flow sequence; a flow collection must open and close "
                          "on one line here", lineno)
            if s[j] == "]":
                return items, j + 1
            value, j = self._scan_value(s, j, lineno, flow=True)
            items.append(value)
            while j < len(s) and s[j] == " ":
                j += 1
            if j >= len(s):
                self.fail("unterminated flow sequence", lineno)
            if s[j] == ",":
                j += 1
                continue
            if s[j] == "]":
                return items, j + 1
            self.fail("unexpected character %r inside a flow sequence" % s[j], lineno)

    def _flow_mapping(self, s: str, i: int, lineno: int) -> tuple[dict, int]:
        j = i + 1
        out: dict = {}
        while True:
            while j < len(s) and s[j] == " ":
                j += 1
            if j >= len(s):
                self.fail("unterminated flow mapping; a flow collection must open and close "
                          "on one line here", lineno)
            if s[j] == "}":
                return out, j + 1
            if s[j] in ('"', "'"):
                key, j = self._scan_quoted(s, j, lineno)
            else:
                k = j
                while k < len(s) and s[k] not in ":,}]":
                    k += 1
                if k >= len(s) or s[k] != ":":
                    self.fail("flow mapping entry without a value", lineno)
                if k + 1 < len(s) and s[k + 1] not in " ,}]":
                    # Inside a flow collection a colon only ENDS a key when a
                    # space or a flow indicator follows it. PyYAML reads
                    # `{a:1}` as the single plain scalar `a:1` with no value,
                    # and `{a :1}` as `a :1`; this reader used to split both at
                    # the colon and hand back `{a: 1}` -- a mapping the tool
                    # that installs the render never sees. Refused rather than
                    # re-implemented: an empty flow value is not a shape any
                    # Helm render needs.
                    self.fail("a flow mapping key whose colon is glued to the next character "
                              "is refused; real YAML reads %r as one plain scalar with no "
                              "value, not as a key and a value" % s[j:], lineno)
                raw = s[j:k].rstrip(" ")
                if raw == "":
                    self.fail("a mapping key is empty", lineno)
                if raw == "-" or raw.startswith("- ") or any(c in raw for c in "?[{#"):
                    # The same `scan_plain` rule, on the key side: inside a flow
                    # collection a plain scalar ENDS at `?`, `[`, `{` and at a
                    # `#` that opens a comment, and may not open with `- `. A
                    # key scanned straight through them was a key real YAML
                    # never reads (`{1 [: v}`, `{- k: v}`).
                    self.fail("a plain key inside a flow mapping that carries a nested "
                              "collection, an explicit-key indicator, a comment, or a block "
                              "sequence indicator is refused (%r); real YAML ends the key "
                              "there" % raw, lineno)
                if raw[0] in _INDICATOR_START or raw.startswith("<<"):
                    self.fail("anchors, aliases, tags, explicit keys, and merge keys are "
                              "refused, and so is every other indicator a plain scalar may "
                              "not open with (%r)" % raw[0], lineno)
                resolved = self._resolve_plain(raw, lineno)
                if not isinstance(resolved, str):
                    self.fail("non-string mapping key %r is refused" % raw, lineno)
                key = resolved
                j = k
            while j < len(s) and s[j] == " ":
                j += 1
            if j >= len(s) or s[j] != ":":
                self.fail("flow mapping entry without a value", lineno)
            j += 1
            value, j = self._scan_value(s, j, lineno, flow=True)
            if key in out:
                self.fail("duplicate mapping key %r in a flow mapping" % key, lineno)
            out[key] = value
            while j < len(s) and s[j] == " ":
                j += 1
            if j >= len(s):
                self.fail("unterminated flow mapping", lineno)
            if s[j] == ",":
                j += 1
                continue
            if s[j] == "}":
                return out, j + 1
            self.fail("unexpected character %r inside a flow mapping" % s[j], lineno)

    def _resolve_plain(self, raw: str, lineno: int) -> object:
        if raw in _NULL_PLAIN:
            return None
        if raw in _TRUE_PLAIN:
            return True
        if raw in _FALSE_PLAIN:
            return False
        if raw in _AMBIGUOUS_PLAIN:
            self.fail("plain scalar %r resolves to a boolean under YAML 1.1 and to a string "
                      "under YAML 1.2; quote it or write true/false" % raw, lineno)
        if raw == _VALUE_KEY_PLAIN:
            self.fail("the plain scalar %r is refused; it is YAML 1.1's value key, which a "
                      "safe YAML loader REFUSES outright in value position and reads as an "
                      "ordinary string in key position -- quote it to mean the string" % raw,
                      lineno)
        if raw == _MERGE_KEY_PLAIN:
            self.fail("the plain scalar %r is refused; it is YAML 1.1's merge key, which a "
                      "safe YAML loader REFUSES outright in value position -- quote it to "
                      "mean the string" % raw, lineno)
        if _RADIX_RE.fullmatch(raw):
            self.fail("hexadecimal, octal, and binary integer forms are refused; "
                      "implementations disagree about them (%r)" % raw, lineno)
        if _SEXAGESIMAL_RE.fullmatch(raw):
            self.fail("sexagesimal number forms are refused; %r means 60-base arithmetic "
                      "under YAML 1.1 and a string under YAML 1.2" % raw, lineno)
        if _TIMESTAMP_RE.fullmatch(raw):
            self.fail("timestamp scalars are refused; %r is a date/datetime OBJECT under "
                      "YAML 1.1 and a plain string under YAML 1.2 -- quote it to mean the "
                      "string" % raw, lineno)
        if _SPECIAL_FLOAT_RE.fullmatch(raw):
            self.fail("infinity and not-a-number scalars are refused (%r)" % raw, lineno)
        if _EXPONENT_RE.fullmatch(raw):
            self.fail("exponent number forms are refused; %r reads as a float under YAML 1.2 "
                      "and as a string under YAML 1.1" % raw, lineno)
        if "_" in raw and _UNDERSCORE_NUMBER_RE.fullmatch(raw):
            self.fail("digit-group underscores are refused; %r reads as a number under "
                      "YAML 1.1 and as a string under YAML 1.2" % raw, lineno)
        if _INT_RE.fullmatch(raw):
            digits = raw.lstrip("+-")
            if len(digits) > 1 and digits[0] == "0":
                self.fail("an integer with a leading zero is refused; it is octal under "
                          "YAML 1.1 and decimal under YAML 1.2 (%r)" % raw, lineno)
            return int(raw)
        if _FLOAT_RE.fullmatch(raw):
            return float(raw)
        return raw


def _fold(content: list[str]) -> str:
    """Fold a `>` block scalar's lines, the common rule.

    More-indented lines and blank lines keep their breaks; consecutive lines
    at the base indentation join with a single space. No assertion in this
    module depends on folded text -- the census reads keys and short plain
    scalars -- but a `kind` written as a folded scalar must still resolve to
    the string it really is, which is what this supports.
    """
    parts: list[str] = []
    pending_breaks = 0
    previous_more_indented = False
    for line in content:
        if line == "":
            pending_breaks += 1
            continue
        more_indented = line[:1] == " "
        if not parts:
            parts.append(line)
        else:
            if pending_breaks:
                parts.append("\n" * pending_breaks)
            elif more_indented or previous_more_indented:
                parts.append("\n")
            else:
                parts.append(" ")
            parts.append(line)
        pending_breaks = 0
        previous_more_indented = more_indented
    return "".join(parts)


def parse_documents(text: str, origin: str) -> list[object]:
    """Parse a YAML stream into a list of documents, failing closed."""
    return Reader(text, origin).documents()


# --- Chart facts ------------------------------------------------------------


def _read_mapping(path: Path) -> dict:
    docs = parse_documents(path.read_text(encoding="utf-8"), str(path))
    real = [d for d in docs if d is not None]
    if len(real) != 1 or not isinstance(real[0], dict):
        raise CensusError("%s: expected exactly one mapping document" % path)
    return real[0]


def _require_str(mapping: dict, path: tuple[str, ...], origin: str) -> str:
    value = mapping
    for key in path:
        if not isinstance(value, dict) or key not in value:
            raise CensusError("%s declares no %s" % (origin, ".".join(path)))
        value = value[key]
    if not isinstance(value, str) or value == "":
        raise CensusError("%s.%s is not a non-empty string" % (origin, ".".join(path)))
    return value


class ChartFacts:
    """Every variable fact the expectation needs, and where each comes from."""

    def __init__(self, chart_dir: Path, release: str, namespace: str,
                 peer_instance: str | None = None) -> None:
        chart_yaml = _read_mapping(chart_dir / "Chart.yaml")
        values_yaml = _read_mapping(chart_dir / "values.yaml")
        self.chart_name = _require_str(chart_yaml, ("name",), "chart metadata")
        self.release = release
        self.namespace = namespace
        self.peer_namespace = _require_str(values_yaml, ("ingress", "peerNamespace"), "chart values")
        self.peer_app_name = _require_str(values_yaml, ("ingress", "peerAppName"), "chart values")
        # The peer instance is the ONE fact a caller may state instead of
        # reading it from values: the gate renders once with the instance
        # deliberately overridden, and the census must follow that override
        # exactly rather than be skipped for it.
        self.peer_instance = peer_instance or _require_str(
            values_yaml, ("ingress", "peerInstance"), "chart values")
        port = values_yaml.get("service", {})
        port = port.get("port") if isinstance(port, dict) else None
        if not isinstance(port, int) or isinstance(port, bool):
            raise CensusError("chart values declare no integer service.port")
        self.service_port = port

    def expected_policy(self) -> dict:
        return {
            "apiVersion": POLICY_API_VERSION,
            "kind": POLICY_KIND,
            "spec": {
                "podSelector": {
                    "matchLabels": {
                        "app.kubernetes.io/name": self.chart_name,
                        "app.kubernetes.io/instance": self.release,
                    }
                },
                "policyTypes": list(POLICY_TYPES),
                "ingress": [
                    {
                        "from": [
                            {
                                "namespaceSelector": {
                                    "matchLabels": {
                                        "kubernetes.io/metadata.name": self.peer_namespace,
                                    }
                                },
                                "podSelector": {
                                    "matchLabels": {
                                        "app.kubernetes.io/name": self.peer_app_name,
                                        "app.kubernetes.io/instance": self.peer_instance,
                                    }
                                },
                            }
                        ],
                        "ports": [{"port": self.service_port, "protocol": "TCP"}],
                    }
                ],
                "egress": [],
            },
        }


# --- Census -----------------------------------------------------------------


def _describe(value: object) -> str:
    return repr(value)


def flatten(documents: list[object]) -> list[dict]:
    """Return every installable object, list wrappers deliberately unwrapped."""
    out: list[dict] = []
    for index, doc in enumerate(documents, start=1):
        _flatten_one(doc, out, depth=0, where="document %d" % index)
    return out


def _flatten_one(doc: object, out: list[dict], depth: int, where: str) -> None:
    if doc is None:
        return
    if not isinstance(doc, dict):
        raise CensusError("%s is not a mapping (%s); a render this gate cannot read is a "
                          "render it refuses" % (where, _describe(doc)))
    kind = doc.get("kind")
    if not isinstance(kind, str) or kind == "":
        raise CensusError("%s declares no string `kind`; every installable object must say "
                          "what it is" % where)
    if kind == "List" or kind.endswith("List"):
        if depth >= MAX_WRAPPER_DEPTH:
            raise CensusError("%s nests list wrappers more than %d deep; refusing"
                              % (where, MAX_WRAPPER_DEPTH))
        extra = set(doc) - {"apiVersion", "kind", "items", "metadata"}
        if extra:
            raise CensusError("%s is a %s wrapper carrying unexpected keys %s; a wrapper this "
                              "gate cannot fully account for is refused"
                              % (where, kind, sorted(extra)))
        items = doc.get("items")
        if not isinstance(items, list):
            raise CensusError("%s is a %s wrapper whose `items` is %s, not a sequence; a "
                              "wrapper whose contents cannot be inspected is refused"
                              % (where, kind, _describe(items)))
        for position, item in enumerate(items, start=1):
            _flatten_one(item, out, depth + 1, "%s -> %s item %d" % (where, kind, position))
        return
    out.append(doc)


def census(text: str, facts: ChartFacts, origin: str = "<render>") -> dict:
    """Assert the whole render carries exactly one, exactly pinned, policy."""
    objects = flatten(parse_documents(text, origin))

    policies = [o for o in objects if o.get("kind") == POLICY_KIND]
    if len(policies) != 1:
        names = [o.get("metadata", {}).get("name") if isinstance(o.get("metadata"), dict) else None
                 for o in policies]
        raise CensusError(
            "the complete render carries %d NetworkPolicy objects (%s); exactly one is "
            "required. NetworkPolicy allowances are additive, so a second policy grants what "
            "the first one denies." % (len(policies), names))
    policy = policies[0]

    inventory = sorted((str(o.get("apiVersion")), str(o.get("kind"))) for o in objects)
    if inventory != sorted(EXPECTED_INVENTORY):
        raise CensusError(
            "the complete render's object inventory is not the pinned one.\nexpected:\n%s\n\n"
            "rendered:\n%s\n\nAdding a document to this chart is a deliberate edit of "
            "EXPECTED_INVENTORY in scripts/ci/chart_render_census.py, so a reviewer reads what "
            "the new document is -- including any policy written under a CNI's own kind."
            % ("\n".join("  %s %s" % pair for pair in sorted(EXPECTED_INVENTORY)),
               "\n".join("  %s %s" % pair for pair in inventory)))

    expected = facts.expected_policy()

    if policy.get("apiVersion") != expected["apiVersion"]:
        raise CensusError("the policy declares apiVersion %s; %s is pinned"
                          % (_describe(policy.get("apiVersion")), expected["apiVersion"]))

    metadata = policy.get("metadata")
    if not isinstance(metadata, dict):
        raise CensusError("the policy carries no metadata mapping")
    if sorted(metadata) != sorted(POLICY_METADATA_KEYS):
        raise CensusError("the policy's metadata keys are %s; exactly %s are pinned"
                          % (sorted(metadata), sorted(POLICY_METADATA_KEYS)))
    expected_name = POLICY_NAME_PREFIX + facts.chart_name
    if metadata.get("name") != expected_name:
        raise CensusError("the policy is named %s; %s is pinned"
                          % (_describe(metadata.get("name")), expected_name))
    if metadata.get("namespace") != facts.namespace:
        raise CensusError("the policy renders into namespace %s; this gate rendered with %s"
                          % (_describe(metadata.get("namespace")), facts.namespace))

    if sorted(policy) != sorted(("apiVersion", "kind", "metadata", "spec")):
        raise CensusError("the policy's top-level keys are %s; exactly apiVersion, kind, "
                          "metadata, spec are pinned" % sorted(policy))

    spec = policy.get("spec")
    if not isinstance(spec, dict):
        raise CensusError("the policy carries no spec mapping")
    if sorted(spec) != sorted(POLICY_SPEC_KEYS):
        raise CensusError("the policy's spec keys are %s; exactly %s are pinned. An unpinned "
                          "spec key is a field nobody reviewed."
                          % (sorted(spec), sorted(POLICY_SPEC_KEYS)))

    # Each half stated on its own, so a failure says which promise broke.
    if spec["podSelector"] != expected["spec"]["podSelector"]:
        raise CensusError("the policy's podSelector is %s; %s is pinned. A policy binds only "
                          "the Pods it selects, so a wrong or empty selector leaves this "
                          "workload with full outbound access while the manifest still reads "
                          "default deny."
                          % (_describe(spec["podSelector"]), _describe(expected["spec"]["podSelector"])))
    if spec["policyTypes"] != expected["spec"]["policyTypes"]:
        raise CensusError("the policy's policyTypes are %s; %s are pinned"
                          % (_describe(spec["policyTypes"]), _describe(expected["spec"]["policyTypes"])))
    if "Egress" not in spec["policyTypes"]:
        raise CensusError("the policy does not declare the Egress policy type, so Kubernetes "
                          "applies no egress rule at all and an empty egress list restricts "
                          "nothing")
    if not isinstance(spec["egress"], list) or spec["egress"] != []:
        raise CensusError("the policy's egress is %s; an exactly empty list is pinned. An "
                          "empty mapping, a single empty rule, or any rule at all is an "
                          "ALLOWANCE -- the emptiest-looking rule is the widest one there is."
                          % _describe(spec["egress"]))
    if spec["ingress"] != expected["spec"]["ingress"]:
        raise CensusError("the policy's ingress is not the one rule the chart values declare."
                          "\nexpected:\n%s\n\nrendered:\n%s"
                          % (_describe(expected["spec"]["ingress"]), _describe(spec["ingress"])))

    # And the whole object at once, so nothing above can drift out of step.
    actual = {
        "apiVersion": policy["apiVersion"],
        "kind": policy["kind"],
        "spec": spec,
    }
    if actual != expected:
        raise CensusError("the policy object does not equal the pinned expectation.\n"
                          "expected:\n%s\n\nrendered:\n%s" % (_describe(expected), _describe(actual)))

    return {"objects": len(objects), "policy": policy}


# --- Hostile mutations ------------------------------------------------------
#
# Every rejection path above is proven able to fire, against the REAL render,
# before this gate is allowed to pass. A guard that cannot fail is not a
# guard. Each entry rewrites the render into something a chart could really
# emit -- or into something no reader should accept -- and the census must
# refuse it.

_ALLOW_ALL_TAIL = """\
  podSelector: {}
  policyTypes: [Egress]
  egress: [{}]
"""

_SHADOW_SPACED = """\
apiVersion : networking.k8s.io/v1
kind : NetworkPolicy
metadata :
  name : shadow-allow-all
  namespace : shadow
spec :
  podSelector : {}
  policyTypes : [Egress]
  egress : [{}]
"""

_SHADOW_DOUBLE_QUOTED = """\
"apiVersion": "networking.k8s.io/v1"
"kind": "NetworkPolicy"
"metadata":
  "name": "shadow-allow-all"
  "namespace": "shadow"
"spec":
  "podSelector": {}
  "policyTypes": ["Egress"]
  "egress": [{}]
"""

_SHADOW_SINGLE_QUOTED = """\
'apiVersion': 'networking.k8s.io/v1'
'kind': 'NetworkPolicy'
'metadata':
  'name': 'shadow-allow-all'
  'namespace': 'shadow'
'spec':
  'podSelector': {}
  'policyTypes': ['Egress']
  'egress': [{}]
"""

# `\x6b` is `k` and `\x4e` is `N`: the key and its value only become `kind`
# and `NetworkPolicy` once the escapes are resolved, which is exactly what
# "canonical key normalisation" has to mean.
_SHADOW_ESCAPED = r"""apiVersion: networking.k8s.io/v1
"\x6bind": "\x4eetworkPolicy"
metadata:
  name: shadow-allow-all
  namespace: shadow
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress: [{}]
"""

_SHADOW_FLOW = ("{apiVersion: networking.k8s.io/v1, kind: NetworkPolicy, "
                "metadata: {name: shadow-allow-all, namespace: shadow}, "
                "spec: {podSelector: {}, policyTypes: [Egress], egress: [{}]}}\n")

_SHADOW_LITERAL_KIND = """\
apiVersion: networking.k8s.io/v1
kind: |-
  NetworkPolicy
metadata:
  name: shadow-allow-all
  namespace: shadow
spec:
""" + _ALLOW_ALL_TAIL

_SHADOW_FOLDED_KIND = """\
apiVersion: networking.k8s.io/v1
kind: >-
  NetworkPolicy
metadata:
  name: shadow-allow-all
  namespace: shadow
spec:
""" + _ALLOW_ALL_TAIL

_SHADOW_GENERIC_LIST = """\
apiVersion: v1
kind: List
items:
  - apiVersion: networking.k8s.io/v1
    kind: NetworkPolicy
    metadata:
      name: shadow-allow-all
      namespace: shadow
    spec:
      podSelector: {}
      policyTypes: [Egress]
      egress: [{}]
"""

_SHADOW_TYPED_LIST = """\
apiVersion: networking.k8s.io/v1
kind: NetworkPolicyList
items:
  - apiVersion: networking.k8s.io/v1
    kind: NetworkPolicy
    metadata:
      name: shadow-allow-all
      namespace: shadow
    spec:
      podSelector: {}
      policyTypes: [Egress]
      egress: [{}]
"""

_SHADOW_NESTED_LIST = """\
apiVersion: v1
kind: List
items:
  - apiVersion: v1
    kind: List
    items:
      - apiVersion: networking.k8s.io/v1
        kind: NetworkPolicy
        metadata:
          name: shadow-allow-all
          namespace: shadow
        spec:
          podSelector: {}
          policyTypes: [Egress]
          egress: [{}]
"""

_SHADOW_OPAQUE_LIST = """\
apiVersion: v1
kind: List
items: shadow-allow-all
"""

_SHADOW_FOREIGN_KIND = """\
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: shadow-allow-all
  namespace: shadow
spec:
  endpointSelector: {}
  egress:
    - toEntities:
        - all
"""

_SHADOW_CONFIGMAP = """\
apiVersion: v1
kind: ConfigMap
metadata:
  name: shadow-config
  namespace: shadow
data:
  shadow: enabled
"""

_SHADOW_ANCHORED = """\
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shadow-allow-all
  namespace: shadow
spec: &wide
  podSelector: {}
  policyTypes: [Egress]
  egress: [{}]
"""

_SHADOW_MERGE_KEY = """\
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shadow-allow-all
  namespace: shadow
spec:
  <<: *wide
  egress: [{}]
"""

_SHADOW_TAGGED = """\
apiVersion: networking.k8s.io/v1
kind: !!str NetworkPolicy
metadata:
  name: shadow-allow-all
  namespace: shadow
spec:
""" + _ALLOW_ALL_TAIL

_SHADOW_TAB_INDENTED = (
    "apiVersion: networking.k8s.io/v1\n"
    "kind: NetworkPolicy\n"
    "metadata:\n"
    "\tname: shadow-allow-all\n"
    "spec:\n"
    "\tpodSelector: {}\n"
    "\tpolicyTypes: [Egress]\n"
    "\tegress: [{}]\n"
)

# A BOM in front of `kind` is the whole trick: PyYAML and the spec strip a
# leading one, so THEY see the key `kind`, and a reader that keeps it sees a
# different key and stops recognising the document as a policy at all.
_SHADOW_BOM_PREFIXED = (
    "\ufeff"
    "apiVersion: networking.k8s.io/v1\n"
    "kind: NetworkPolicy\n"
    "metadata:\n"
    "  name: shadow-allow-all\n"
    "  namespace: shadow\n"
    "spec:\n"
) + _ALLOW_ALL_TAIL

# `1_000` is the integer 1000 under YAML 1.1 and the string "1_000" under
# YAML 1.2; a shadow policy that carries one is a document two readers do not
# agree about, so this reader refuses to be either of them.
_SHADOW_UNDERSCORE_NUMBER = """\
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shadow-allow-all
  namespace: shadow
  generation: 1_000
spec:
""" + _ALLOW_ALL_TAIL

# A YAML 1.1 timestamp is a date/datetime OBJECT to the reader that installs
# the render and a plain string to a YAML 1.2 one. `creationTimestamp` is a
# field every Kubernetes object really carries, so this is the shape a shadow
# policy would wear without looking odd at all.
_SHADOW_TIMESTAMP = """\
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shadow-allow-all
  namespace: shadow
  creationTimestamp: 2026-08-20T10:30:00Z
spec:
""" + _ALLOW_ALL_TAIL

# `=` is YAML 1.1's value key: a safe YAML loader REFUSES the document that
# carries one in value position, where this reader used to hand back the
# string "=" and read on. An installer that refuses a render installs nothing
# and says so, but a gate that reads a document the installer will not read is
# a gate reporting on something else.
_SHADOW_VALUE_KEY = """\
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shadow-allow-all
  namespace: shadow
  labels:
    shadow-marker: =
spec:
""" + _ALLOW_ALL_TAIL


# The eight constructs PR #96's round-three review and the author's own hunt
# measured, each written into a shadow policy the way a chart could really emit
# it. Every one of them is a shape where this reader and the reader that
# INSTALLS the render used to disagree -- about how many lines the document
# has, about whether the stream is readable at all, or about what a scalar
# means -- and a gate that reads a different document than the installer is a
# gate reporting on something else.
_SHADOW_UNICODE_LINE_BREAK = (
    "apiVersion: networking.k8s.io/v1\n"
    "kind: NetworkPolicy\n"
    "metadata:\n"
    "  name: shadow-allow-all\n"
    "  namespace: shadow\n"
    "  labels:\n"
    "    shadow-marker: a\u2028b\n"
    "spec:\n"
) + _ALLOW_ALL_TAIL

_SHADOW_C1_CONTROL = (
    "apiVersion: networking.k8s.io/v1\n"
    "kind: NetworkPolicy\n"
    "metadata:\n"
    "  name: shadow-allow-all\n"
    "  namespace: shadow\n"
    "  labels:\n"
    "    shadow-marker: a\u009fb\n"
    "spec:\n"
) + _ALLOW_ALL_TAIL

_SHADOW_FLOW_GLUED_COLON = """\
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shadow-allow-all
  namespace: shadow
  labels: {shadow-marker:enabled}
spec:
""" + _ALLOW_ALL_TAIL

_SHADOW_FLOW_NESTED_INDICATOR = """\
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shadow-allow-all
  namespace: shadow
  labels: {shadow-marker: enabled [}
spec:
""" + _ALLOW_ALL_TAIL

_SHADOW_INDICATOR_LEADING_KEY = """\
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shadow-allow-all
  namespace: shadow
  labels:
    @shadow-marker: enabled
spec:
""" + _ALLOW_ALL_TAIL

_SHADOW_COMMENTED_KEY = """\
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shadow-allow-all
  namespace: shadow
  labels:
    shadow-marker #hidden: enabled
spec:
""" + _ALLOW_ALL_TAIL

_SHADOW_MERGE_KEY_SCALAR = """\
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shadow-allow-all
  namespace: shadow
  labels:
    shadow-marker: <<
spec:
""" + _ALLOW_ALL_TAIL

_SHADOW_UNDERSCORED_SEXAGESIMAL = """\
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shadow-allow-all
  namespace: shadow
  generation: 1_:0
spec:
""" + _ALLOW_ALL_TAIL


def _split(text: str) -> list[str]:
    return text.split("\n")


def _find_block(lines: list[str], anchor: list[str]) -> int:
    hits = [i for i in range(len(lines) - len(anchor) + 1)
            if [l.rstrip() for l in lines[i:i + len(anchor)]] == anchor]
    if len(hits) != 1:
        raise CensusError("mutation anchor %r matched %d places in the render; the self-test "
                          "needs exactly one" % (anchor, len(hits)))
    return hits[0]


def _replace_block(text: str, anchor: list[str], replacement: list[str]) -> str:
    lines = _split(text)
    at = _find_block(lines, anchor)
    return "\n".join(lines[:at] + replacement + lines[at + len(anchor):])


def _insert_into_policy_file(text: str, document: str) -> str:
    """Add a second document to the file the policy already renders from."""
    lines = _split(text)
    at = _find_block(lines, ["kind: NetworkPolicy"])
    end = at + 1
    while end < len(lines) and lines[end].rstrip() != "---":
        end += 1
    block = ["---"] + _split(document.rstrip("\n"))
    return "\n".join(lines[:end] + block + lines[end:])


def _append_new_file(text: str, document: str, source: str) -> str:
    tail = ["---", "# Source: %s" % source] + _split(document.rstrip("\n")) + [""]
    return text.rstrip("\n") + "\n" + "\n".join(tail)


def mutations(facts: ChartFacts) -> list[tuple[str, object]]:
    """Every hostile render this census must refuse, as (name, rewriter)."""
    name = facts.chart_name
    selector_anchor = [
        "  podSelector:",
        "    matchLabels:",
        "      app.kubernetes.io/name: " + name,
        "      app.kubernetes.io/instance: " + facts.release,
    ]
    ports_anchor = [
        "      ports:",
        "        - port: %d" % facts.service_port,
        "          protocol: TCP",
    ]
    peer_instance_anchor = ["              app.kubernetes.io/instance: " + facts.peer_instance]
    shadow_source = "%s/templates/shadow-policy.yaml" % name

    def same_file(document: str):
        return lambda text: _insert_into_policy_file(text, document)

    def new_file(document: str):
        return lambda text: _append_new_file(text, document, shadow_source)

    return [
        # --- a second policy the old raw-line census could not see ---------
        ("shadow-same-file-spaced-keys", same_file(_SHADOW_SPACED)),
        ("shadow-new-file-spaced-keys", new_file(_SHADOW_SPACED)),
        ("shadow-double-quoted-keys", new_file(_SHADOW_DOUBLE_QUOTED)),
        ("shadow-single-quoted-keys", new_file(_SHADOW_SINGLE_QUOTED)),
        ("shadow-escaped-quoted-kind", new_file(_SHADOW_ESCAPED)),
        ("shadow-flow-style-document", new_file(_SHADOW_FLOW)),
        ("shadow-literal-block-scalar-kind", new_file(_SHADOW_LITERAL_KIND)),
        ("shadow-folded-block-scalar-kind", new_file(_SHADOW_FOLDED_KIND)),
        # --- a second policy hidden inside a wrapper ------------------------
        ("shadow-generic-list-wrapper", new_file(_SHADOW_GENERIC_LIST)),
        ("shadow-typed-list-wrapper", new_file(_SHADOW_TYPED_LIST)),
        ("shadow-nested-list-wrapper", new_file(_SHADOW_NESTED_LIST)),
        ("shadow-uninspectable-list-wrapper", new_file(_SHADOW_OPAQUE_LIST)),
        # --- a second policy under another kind, and any extra document -----
        ("shadow-foreign-policy-kind", new_file(_SHADOW_FOREIGN_KIND)),
        ("shadow-extra-configmap", new_file(_SHADOW_CONFIGMAP)),
        # --- constructs no reader should accept -----------------------------
        ("shadow-anchored-spec", new_file(_SHADOW_ANCHORED)),
        ("shadow-merge-key", new_file(_SHADOW_MERGE_KEY)),
        ("shadow-explicit-tag", new_file(_SHADOW_TAGGED)),
        ("shadow-tab-indented", new_file(_SHADOW_TAB_INDENTED)),
        ("shadow-bom-prefixed", new_file(_SHADOW_BOM_PREFIXED)),
        ("shadow-underscore-number", new_file(_SHADOW_UNDERSCORE_NUMBER)),
        ("shadow-timestamp-scalar", new_file(_SHADOW_TIMESTAMP)),
        ("shadow-value-key-scalar", new_file(_SHADOW_VALUE_KEY)),
        ("shadow-unicode-line-break", new_file(_SHADOW_UNICODE_LINE_BREAK)),
        ("shadow-c1-control-character", new_file(_SHADOW_C1_CONTROL)),
        ("shadow-flow-glued-colon-key", new_file(_SHADOW_FLOW_GLUED_COLON)),
        ("shadow-flow-nested-indicator", new_file(_SHADOW_FLOW_NESTED_INDICATOR)),
        ("shadow-indicator-leading-key", new_file(_SHADOW_INDICATOR_LEADING_KEY)),
        ("shadow-commented-plain-key", new_file(_SHADOW_COMMENTED_KEY)),
        ("shadow-merge-key-scalar", new_file(_SHADOW_MERGE_KEY_SCALAR)),
        ("shadow-underscored-sexagesimal", new_file(_SHADOW_UNDERSCORED_SEXAGESIMAL)),
        # --- the pinned policy itself, widened ------------------------------
        ("policy-egress-allow-all",
         lambda text: _replace_block(text, ["  egress: []"], ["  egress: [{}]"])),
        ("policy-egress-respelled-and-widened",
         lambda text: _replace_block(text, ["  egress: []"], ["  egress : [{}]"])),
        ("policy-egress-empty-mapping",
         lambda text: _replace_block(text, ["  egress: []"], ["  egress: {}"])),
        ("policy-drop-egress-policy-type",
         lambda text: _replace_block(text,
                                     ["  policyTypes:", "    - Ingress", "    - Egress"],
                                     ["  policyTypes:", "    - Ingress"])),
        ("policy-empty-pod-selector",
         lambda text: _replace_block(text, selector_anchor, ["  podSelector: {}"])),
        ("policy-wrong-pod-selector-app",
         lambda text: _replace_block(text, selector_anchor,
                                     selector_anchor[:2]
                                     + ["      app.kubernetes.io/name: " + name + "-elsewhere"]
                                     + selector_anchor[3:])),
        ("policy-extra-spec-key",
         lambda text: _replace_block(text, ["  egress: []"],
                                     ["  egress: []", "  shadowKey: true"])),
        ("policy-second-ingress-rule",
         lambda text: _replace_block(text, ports_anchor, ports_anchor + ["    - {}"])),
        ("policy-drop-peer-instance",
         lambda text: _replace_block(text, peer_instance_anchor, [])),
        ("policy-duplicate-kind-key",
         lambda text: _replace_block(text, ["kind: NetworkPolicy"],
                                     ["kind: NetworkPolicy", "kind: ConfigMap"])),
    ]


def mutate(text: str, facts: ChartFacts, wanted: str) -> str:
    table = dict(mutations(facts))
    if wanted not in table:
        raise CensusError("unknown mutation %s" % wanted)
    mutated = table[wanted](text)
    if mutated == text:
        raise CensusError("mutation %s changed nothing, so refusing it would prove nothing"
                          % wanted)
    return mutated


# --- CLI --------------------------------------------------------------------


def _add_facts_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--chart", required=True, help="chart directory")
    parser.add_argument("--release", required=True, help="release name the render used")
    parser.add_argument("--namespace", required=True, help="namespace the render used")
    parser.add_argument("--peer-instance", default=None,
                        help="expected ingress peer instance; defaults to the chart values")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="chart_render_census", description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    census_parser = sub.add_parser("census", help="assert the whole render on stdin")
    _add_facts_arguments(census_parser)
    sub.add_parser("mutations", help="print every hostile mutation name")
    mutate_parser = sub.add_parser("mutate", help="rewrite the render on stdin into a hostile one")
    _add_facts_arguments(mutate_parser)
    mutate_parser.add_argument("--name", required=True, help="mutation to apply")
    args = parser.parse_args(argv)

    try:
        if args.mode == "mutations":
            names = [n for n, _ in mutations(_STATIC_FACTS)]
            sys.stdout.write("\n".join(names) + "\n")
            return 0
        facts = ChartFacts(Path(args.chart), args.release, args.namespace, args.peer_instance)
        if args.mode == "census":
            result = census(sys.stdin.read(), facts)
            sys.stdout.write("chart-render-census: %d installable objects, exactly one "
                             "NetworkPolicy, equal to the pinned expectation\n"
                             % result["objects"])
            return 0
        sys.stdout.write(mutate(sys.stdin.read(), facts, args.name))
        return 0
    except CensusError as error:
        sys.stderr.write("chart-render-census: %s\n" % error)
        return 1
    except OSError as error:
        sys.stderr.write("chart-render-census: %s\n" % error)
        return 1


class _StaticFacts:
    """Names only. `mutations` is listed without reading the chart at all."""

    chart_name = "chart"
    release = "release"
    namespace = "namespace"
    peer_namespace = "peer-namespace"
    peer_app_name = "peer-app"
    peer_instance = "peer-instance"
    service_port = 0


_STATIC_FACTS = _StaticFacts()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
