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

FAIL-CLOSED IS THE WHOLE DESIGN. This reader does not need to implement all
of YAML; it needs to be unable to MISREAD anything. Every construct it does
not fully understand is refused with the offending line named, never guessed
at, so an unreadable render is a red gate rather than a quiet pass. Refused
outright:

- tabs, carriage returns, other C0 control characters, and `%` directives;
- anchors (`&`), aliases (`*`), tags (`!`), explicit keys (`?`), and merge
  keys (`<<`) -- each of which lets one document's meaning be assembled
  somewhere else in the stream;
- duplicate mapping keys, in block and flow style alike, since a later
  duplicate silently replaces the pinned earlier one;
- non-string mapping keys;
- flow collections or quoted scalars that do not open and close on one line,
  and multi-line plain scalars;
- plain scalars whose meaning differs between YAML 1.1 and 1.2 (`yes`, `no`,
  `on`, `off`, `y`, `n`), sexagesimals (`1:30`), hex/octal/binary integers,
  exponent forms (`1e3`, `1.0e3`), `.inf`/`.nan`, and integers with a
  leading zero;
- plain scalars opening with a block sequence indicator (`- `), which real
  YAML refuses too -- this reader must never be MORE permissive than the
  tools that install the render.

Both directions were checked against PyYAML 6.0.3 on a 79-case corpus of
Helm-render and hostile shapes: identical results wherever both accept, and
zero cases where this reader accepts something PyYAML refuses. The remaining
divergences are all this reader refusing something PyYAML accepts -- the
safe direction, and each one an ambiguity listed above.

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
_FLOAT_RE = re.compile(r"[-+]?(?:[0-9]*\.[0-9]+|[0-9]+\.[0-9]*)")
# Exponent forms are refused outright: YAML 1.2 reads `1e3` and `1.0e3` as
# floats, while YAML 1.1 -- which is what sigs.k8s.io/yaml and PyYAML 6.0.3
# implement -- reads both as plain strings and wants `1.0e+3`. Three spellings,
# two answers, no way to be sure which one a cluster will see.
_EXPONENT_RE = re.compile(r"[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)[eE][-+]?[0-9]+")
_SEXAGESIMAL_RE = re.compile(r"[-+]?[0-9]+(?::[0-9]+)+(?:\.[0-9]*)?")
_RADIX_RE = re.compile(r"[-+]?0[xXoObB][0-9a-fA-F_]+")
_SPECIAL_FLOAT_RE = re.compile(r"[-+]?\.(?:inf|Inf|INF|nan|NaN|NAN)")
_INDICATOR_START = "&*!?|>%@`"

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
    "L": " ",
    "P": " ",
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
            for ch in raw:
                if ord(ch) < 0x20 or ord(ch) == 0x7F:
                    self.fail("control character %r is refused" % ch, lineno)
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
                if key[0] in "&*!?" or key.startswith("<<"):
                    self.fail("anchors, aliases, tags, explicit keys, and merge keys are "
                              "refused; a document whose meaning is assembled elsewhere in "
                              "the stream is a document this gate will not follow", lineno)
                if '"' in key or "'" in key:
                    self.fail("unexpected quote character inside a plain mapping key", lineno)
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
        if ch in _INDICATOR_START:
            self.fail("anchors, aliases, tags, explicit keys, block scalars in this position, "
                      "and reserved indicators are refused (%r)" % ch, lineno)
        if flow:
            j = i
            while j < len(s):
                cur = s[j]
                if cur in ",]}":
                    break
                if cur == ":" and (j + 1 >= len(s) or s[j + 1] in " ,]}"):
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
                raw = s[j:k].rstrip(" ")
                if raw == "":
                    self.fail("a mapping key is empty", lineno)
                if raw[0] in "&*!?" or raw.startswith("<<"):
                    self.fail("anchors, aliases, tags, explicit keys, and merge keys are "
                              "refused", lineno)
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
        if _RADIX_RE.fullmatch(raw):
            self.fail("hexadecimal, octal, and binary integer forms are refused; "
                      "implementations disagree about them (%r)" % raw, lineno)
        if _SEXAGESIMAL_RE.fullmatch(raw):
            self.fail("sexagesimal number forms are refused; %r means 60-base arithmetic "
                      "under YAML 1.1 and a string under YAML 1.2" % raw, lineno)
        if _SPECIAL_FLOAT_RE.fullmatch(raw):
            self.fail("infinity and not-a-number scalars are refused (%r)" % raw, lineno)
        if _EXPONENT_RE.fullmatch(raw):
            self.fail("exponent number forms are refused; %r reads as a float under YAML 1.2 "
                      "and as a string under YAML 1.1" % raw, lineno)
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
