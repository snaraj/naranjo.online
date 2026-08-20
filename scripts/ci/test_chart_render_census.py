"""Hostile tests for the whole-render NetworkPolicy census (issue #86).

The census in `scripts/ci/chart_render_census.py` replaces a raw-line
document scan that a second `NetworkPolicy` could walk straight past by
spelling its keys `kind :` and `spec :` -- valid YAML, invisible to a
prefix match, and an additive allow-all for every Pod once Kubernetes has
it. The behavioural half of the proof lives in `chart-egress-pin.sh`, whose
assertions (d) and (g) rewrite the REAL Helm render into 32 hostile ones and
require the census to refuse every single one. This suite is the other half:
it pins the reader itself, one rejection per test, without needing helm --
so it runs in the `security` job alongside the other contract suites, which
`python3 -I -B -m unittest discover -s scripts/ci -p 'test_*.py'` picks up
automatically.

Two rules shape every test here, both taken from AGENTS.md:

- A guard that cannot fail is no guard. Each rejection test names one input
  and requires a refusal, and each acceptance test names one input the
  reader must read EXACTLY right -- a reader that refuses everything would
  be as useless as one that accepts everything.
- The expectation is never derived from the thing under test. The census
  fixtures build their render and their expectation from opposite ends: the
  chart facts come from a temporary Chart.yaml/values.yaml, the policy shape
  is the module's own pinned constants, and the hostile renders are written
  out by hand.
"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SPEC = importlib.util.spec_from_file_location("chart_render_census", HERE / "chart_render_census.py")
assert SPEC and SPEC.loader
CRC = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = CRC
SPEC.loader.exec_module(CRC)

GATE_SCRIPT = HERE / "chart-egress-pin.sh"
REAL_CHART = ROOT / "chart"

FIXTURE_CHART_NAME = "fixture-chart"
FIXTURE_RELEASE = "fixture-release"
FIXTURE_NAMESPACE = "fixture-namespace"
FIXTURE_PEER_NAMESPACE = "peer-namespace"
FIXTURE_PEER_APP = "peer-app"
FIXTURE_PEER_INSTANCE = "peer-instance"
FIXTURE_PORT = 8080


def parse(text: str) -> list[object]:
    return CRC.parse_documents(text, "<test>")


def fixture_chart(directory: Path) -> Path:
    chart = directory / "chart"
    (chart).mkdir()
    (chart / "Chart.yaml").write_text(
        textwrap.dedent(
            """\
            apiVersion: v2
            name: %s
            version: 0.0.1
            appVersion: "0.0.1"
            """
        )
        % FIXTURE_CHART_NAME,
        encoding="utf-8",
    )
    (chart / "values.yaml").write_text(
        textwrap.dedent(
            """\
            # A comment, because a real values file has them.
            service:
              port: %d
            ingress:
              peerNamespace: %s
              peerAppName: %s
              peerInstance: %s
            """
        )
        % (FIXTURE_PORT, FIXTURE_PEER_NAMESPACE, FIXTURE_PEER_APP, FIXTURE_PEER_INSTANCE),
        encoding="utf-8",
    )
    return chart


PINNED_POLICY = """\
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ingress-to-{chart}
  namespace: {namespace}
  labels:
    app.kubernetes.io/name: {chart}
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: {chart}
      app.kubernetes.io/instance: {release}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {peer_namespace}
          podSelector:
            matchLabels:
              app.kubernetes.io/name: {peer_app}
              app.kubernetes.io/instance: {peer_instance}
      ports:
        - port: {port}
          protocol: TCP
  # A comment inside the spec, exactly like the real template carries.
  egress: []
"""

REST_OF_RENDER = """\
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {chart}
---
apiVersion: v1
kind: Service
metadata:
  name: {chart}
spec:
  type: ClusterIP
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {chart}
spec:
  replicas: 2
"""


def render() -> str:
    """The pinned render, fully substituted. Tests rewrite the TEXT of this."""
    fields = dict(
        chart=FIXTURE_CHART_NAME,
        release=FIXTURE_RELEASE,
        namespace=FIXTURE_NAMESPACE,
        peer_namespace=FIXTURE_PEER_NAMESPACE,
        peer_app=FIXTURE_PEER_APP,
        peer_instance=FIXTURE_PEER_INSTANCE,
        port=FIXTURE_PORT,
    )
    return (PINNED_POLICY + REST_OF_RENDER).format(**fields)


SHADOW_ALLOW_ALL_SPACED = """\
---
apiVersion : networking.k8s.io/v1
kind : NetworkPolicy
metadata :
  name : shadow-allow-all
spec :
  podSelector : {}
  policyTypes : [Egress]
  egress : [{}]
"""


class ReaderReadsRealYAML(unittest.TestCase):
    """The reader must be RIGHT, not merely strict."""

    def test_a_spaced_key_is_the_same_key(self):
        self.assertEqual(parse("kind : NetworkPolicy\n"), [{"kind": "NetworkPolicy"}])

    def test_a_double_quoted_key_is_the_same_key(self):
        self.assertEqual(parse('"kind": NetworkPolicy\n'), [{"kind": "NetworkPolicy"}])

    def test_a_single_quoted_key_is_the_same_key(self):
        self.assertEqual(parse("'kind': NetworkPolicy\n"), [{"kind": "NetworkPolicy"}])

    def test_escapes_inside_a_quoted_key_resolve_before_matching(self):
        # \\x6b is `k`; \\x4e is `N`. This is the shape a raw-line census
        # cannot see at all, and the reason normalisation happens first.
        self.assertEqual(parse(r'"\x6bind": "\x4eetworkPolicy"' + "\n"),
                         [{"kind": "NetworkPolicy"}])

    def test_flow_collections_parse(self):
        self.assertEqual(parse("spec: {podSelector: {}, policyTypes: [Ingress, Egress], egress: []}\n"),
                         [{"spec": {"podSelector": {}, "policyTypes": ["Ingress", "Egress"],
                                    "egress": []}}])

    def test_a_flow_sequence_of_empty_mappings_is_one_empty_rule(self):
        self.assertEqual(parse("egress: [{}]\n"), [{"egress": [{}]}])

    def test_block_sequences_compact_and_expanded(self):
        self.assertEqual(parse("a:\n  - x: 1\n    w: 2\n  -\n    z: 3\n"),
                         [{"a": [{"x": 1, "w": 2}, {"z": 3}]}])

    def test_a_sequence_may_sit_at_its_parent_indentation(self):
        self.assertEqual(parse("policyTypes:\n- Ingress\n- Egress\n"),
                         [{"policyTypes": ["Ingress", "Egress"]}])

    def test_a_literal_block_scalar_resolves_to_its_text(self):
        self.assertEqual(parse("kind: |-\n  NetworkPolicy\n"), [{"kind": "NetworkPolicy"}])

    def test_a_folded_block_scalar_resolves_to_its_text(self):
        self.assertEqual(parse("kind: >-\n  NetworkPolicy\n"), [{"kind": "NetworkPolicy"}])

    def test_block_scalar_chomping(self):
        # Each answer checked against PyYAML 6.0.3 on the same input; a
        # trailing newline in the stream is a line terminator, not a line.
        self.assertEqual(parse("a: |\n  x\n\n"), [{"a": "x\n"}])
        self.assertEqual(parse("a: |-\n  x\n\n"), [{"a": "x"}])
        self.assertEqual(parse("a: |+\n  x\n\n"), [{"a": "x\n\n"}])

    def test_a_document_marker_inside_a_block_scalar_does_not_split_the_stream(self):
        docs = parse("data: |\n  ---\n  kind: NetworkPolicy\nkind: ConfigMap\n")
        self.assertEqual(len(docs), 1)
        self.assertEqual(docs[0]["kind"], "ConfigMap")
        self.assertEqual(docs[0]["data"], "---\nkind: NetworkPolicy\n")

    def test_comments_are_ignored_wherever_they_appear(self):
        self.assertEqual(parse("# leading\nkind: NetworkPolicy  # trailing\n  # indented\n"),
                         [{"kind": "NetworkPolicy"}])

    def test_a_hash_inside_a_scalar_is_not_a_comment(self):
        self.assertEqual(parse("name: a#b\n"), [{"name": "a#b"}])

    def test_documents_split_and_empty_documents_are_none(self):
        self.assertEqual(parse("---\na: 1\n---\n---\nb: 2\n"), [{"a": 1}, None, {"b": 2}])

    def test_a_document_end_marker_closes_a_document(self):
        self.assertEqual(parse("a: 1\n...\n---\nb: 2\n"), [{"a": 1}, {"b": 2}])

    def test_scalars_resolve_the_way_kubernetes_yaml_resolves_them(self):
        docs = parse("i: 8080\nf: 1.5\nt: true\nf2: false\nnil: null\ntilde: ~\ns: 200m\nq: \"8080\"\n")
        self.assertEqual(docs, [{"i": 8080, "f": 1.5, "t": True, "f2": False, "nil": None,
                                 "tilde": None, "s": "200m", "q": "8080"}])

    def test_a_quoted_number_is_a_string_not_a_number(self):
        self.assertNotEqual(parse('port: "8080"\n'), parse("port: 8080\n"))


class ReaderFailsClosed(unittest.TestCase):
    """Anything the reader cannot read unambiguously is refused, not guessed."""

    def reject(self, text: str, needle: str):
        with self.assertRaises(CRC.CensusError) as caught:
            parse(text)
        self.assertIn(needle, str(caught.exception))

    def test_tabs(self):
        self.reject("a:\n\tb: 1\n", "tab characters are refused")

    def test_carriage_returns(self):
        self.reject("a: 1\r\n", "carriage returns are refused")

    def test_control_characters(self):
        self.reject("a: \x01\n", "control character")

    def test_directives(self):
        self.reject("%YAML 1.1\n---\na: 1\n", "YAML directives are refused")

    def test_anchors(self):
        self.reject("spec: &wide\n  egress: [{}]\n", "refused")

    def test_aliases(self):
        self.reject("spec: *wide\n", "refused")

    def test_merge_keys(self):
        self.reject("spec:\n  <<: *wide\n", "merge keys are refused")

    def test_explicit_tags(self):
        self.reject("kind: !!str NetworkPolicy\n", "refused")

    def test_duplicate_block_keys(self):
        self.reject("kind: NetworkPolicy\nkind: ConfigMap\n", "duplicate mapping key")

    def test_duplicate_flow_keys(self):
        self.reject("spec: {a: 1, a: 2}\n", "duplicate mapping key")

    def test_a_spaced_duplicate_is_still_a_duplicate(self):
        self.reject("kind: NetworkPolicy\nkind : ConfigMap\n", "duplicate mapping key")

    def test_non_string_keys(self):
        self.reject("8080: http\n", "non-string mapping key")

    def test_ambiguous_booleans(self):
        self.reject("enabled: yes\n", "resolves to a boolean under YAML 1.1")

    def test_sexagesimal_numbers(self):
        self.reject("value: 1:30\n", "sexagesimal")

    def test_leading_zero_integers(self):
        self.reject("value: 0755\n", "leading zero")

    def test_radix_integers(self):
        self.reject("value: 0x1F90\n", "hexadecimal, octal, and binary")

    def test_infinity(self):
        self.reject("value: .inf\n", "infinity")

    def test_exponent_numbers(self):
        # 1.2 says float, 1.1 says string, and 1.1 is what PyYAML 6.0.3 and
        # sigs.k8s.io/yaml implement. Two answers is one too many.
        for form in ("1e3", "1.0e3", "1.0e+3"):
            self.reject("value: %s\n" % form, "exponent number forms are refused")

    def test_digit_group_underscores(self):
        # PR #94's independent review measured this one: `a: 1_000` was ACCEPTED
        # and read as the string "1_000" while the oracle PyYAML 6.0.3 read the
        # integer 1000. Same class as the exponent forms above -- one spelling,
        # two answers -- so it is a refusal now, and the offending line is named.
        for form in ("1_000", "1_000_000", "+1_0", "-1_0", "1_0.5", "1.0_5",
                     ".5_0", "1_0e1_0", "1_"):
            self.reject("value: %s\n" % form, "digit-group underscores are refused")
        self.reject("value: 1_000\n", "line 1")

    def test_a_quoted_underscored_number_is_still_an_ordinary_string(self):
        # The refusal must not swallow legitimate text: only a PLAIN scalar is
        # ambiguous. Quoted, `1_000` is the string both YAML versions agree on,
        # and an identifier that merely contains an underscore is untouched.
        self.assertEqual(parse('value: "1_000"\n'), [{"value": "1_000"}])
        self.assertEqual(parse("value: '1_000'\n"), [{"value": "1_000"}])
        self.assertEqual(parse("value: app_name\n"), [{"value": "app_name"}])
        self.assertEqual(parse("value: _1\n"), [{"value": "_1"}])

    def test_byte_order_marks(self):
        # The other divergence PR #94's review measured: PyYAML and the YAML
        # spec strip a leading BOM, so THEY see the key `kind`; this reader kept
        # it and saw a different key, which is precisely how a document stops
        # being recognised as a policy. Refused everywhere, never stripped --
        # no rendered byte is silently discarded.
        self.reject("\ufeffkind: NetworkPolicy\n", "byte-order mark")
        self.reject("\ufeffkind: NetworkPolicy\n", "line 1")
        self.reject("kind: NetworkPolicy\n\ufeffmetadata:\n  name: a\n", "line 2")
        self.reject("kind: Network\ufeffPolicy\n", "byte-order mark")

    def test_yaml_11_timestamps(self):
        # PR #96's independent review measured this class: `a: 2026-08-20` was
        # ACCEPTED and read as the string "2026-08-20" while the oracle PyYAML
        # 6.0.3 built `datetime.date(2026, 8, 20)`. YAML 1.2's core schema has
        # no timestamp type, so one spelling has two meanings -- an object and
        # a string -- and this reader refuses to pick. The four forms the
        # receipt enumerated come first.
        for form in ("2026-08-20", "2026-08-20T10:30:00Z", "2026-08-20 10:30:00",
                     "2001-12-14 21:59:43.10 -5", "2026-8-20 10:30:00",
                     "2026-08-20 10:30:00.5", "2026-08-20 10:30:00 +5:30",
                     "2026-08-20 10:30:00-5", "2026-08-20T10:30:00+05:00"):
            self.reject("value: %s\n" % form, "timestamp scalars are refused")
        self.reject("value: 2026-08-20\n", "line 1")
        # In key position too: the census matches on keys before anything else.
        self.reject("2026-08-20: a\n", "timestamp scalars are refused")

    def test_a_quoted_timestamp_is_still_an_ordinary_string(self):
        # The refusal must not over-reach: only a PLAIN timestamp is ambiguous,
        # and only the shapes PyYAML's own resolver VALUES are timestamps. The
        # near-misses below are strings to both readers and must stay readable
        # -- version numbers especially, since this chart renders `v0.1.24`.
        self.assertEqual(parse('value: "2026-08-20"\n'), [{"value": "2026-08-20"}])
        self.assertEqual(parse("value: '2026-08-20'\n"), [{"value": "2026-08-20"}])
        self.assertEqual(parse("value: 2026-8-20\n"), [{"value": "2026-8-20"}])
        self.assertEqual(parse("value: 2026-08\n"), [{"value": "2026-08"}])
        self.assertEqual(parse("value: 2026-08-20x\n"), [{"value": "2026-08-20x"}])
        self.assertEqual(parse("value: 2026-08-20T10:30\n"), [{"value": "2026-08-20T10:30"}])
        self.assertEqual(parse("value: v0.1.24\n"), [{"value": "v0.1.24"}])
        self.assertEqual(parse("value: 0.1.24\n"), [{"value": "0.1.24"}])

    def test_the_value_key_plain_scalar(self):
        # The other class PR #96's review measured, and the one counterexample
        # to "nothing this reader accepts is refused by the oracle": plain `=`
        # was ACCEPTED here as the string "=" while PyYAML 6.0.3's safe loader
        # raises ConstructorError for it in VALUE position (no constructor for
        # tag:yaml.org,2002:value). Refused in BOTH positions -- in key
        # position the oracle reads "=", so refusing there is this reader being
        # the STRICTER of the two, which is the safe direction.
        self.reject("value: =\n", "YAML 1.1's value key")
        self.reject("value: =\n", "line 1")
        self.reject("=: a\n", "YAML 1.1's value key")
        self.reject("a:\n  - =\n", "YAML 1.1's value key")
        self.reject("a: {b: =}\n", "YAML 1.1's value key")

    def test_a_quoted_value_key_is_still_an_ordinary_string(self):
        # Only the bare, whole scalar `=` is the value key; quoted, or as part
        # of any longer scalar, it is ordinary text both readers agree on.
        self.assertEqual(parse('value: "="\n'), [{"value": "="}])
        self.assertEqual(parse("value: '='\n"), [{"value": "="}])
        self.assertEqual(parse("value: ==\n"), [{"value": "=="}])
        self.assertEqual(parse("value: =x\n"), [{"value": "=x"}])
        self.assertEqual(parse("value: x=\n"), [{"value": "x="}])

    def test_a_plain_scalar_opening_with_a_sequence_indicator(self):
        # Real YAML refuses this. So must this reader: being more permissive
        # than the tools that install the render is its own kind of hole.
        self.reject("a: - 1\n", "block sequence indicator")

    def test_unterminated_flow_collections(self):
        self.reject("egress: [{}\n", "unterminated flow")

    def test_unterminated_quoted_scalars(self):
        self.reject('name: "shadow\n', "unterminated double-quoted scalar")

    def test_a_plain_scalar_may_not_continue_on_the_next_line(self):
        # Real YAML folds this into "Network Policy". This reader refuses it
        # rather than fold, so a value that continues is never half-read.
        self.reject("kind: Network\n  Policy\n", "unexpected indentation")

    def test_a_plain_scalar_document_may_not_continue_on_the_next_line(self):
        self.reject("---\nNetwork\n  Policy\n", "multi-line plain scalars are refused")

    def test_content_on_a_document_start_line(self):
        self.reject("--- kind: NetworkPolicy\n", "content on a document-start line")

    def test_a_mapping_indicator_inside_a_plain_scalar(self):
        self.reject("a: b: c\n", "mapping indicator")

    def test_unexpected_indentation(self):
        self.reject("a: 1\n  b: 2\n", "unexpected indentation")


class CensusFixture(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.chart = fixture_chart(Path(self._tmp.name))
        self.facts = CRC.ChartFacts(self.chart, FIXTURE_RELEASE, FIXTURE_NAMESPACE)

    def census(self, text: str):
        return CRC.census(text, self.facts)

    def reject(self, text: str, needle: str):
        with self.assertRaises(CRC.CensusError) as caught:
            self.census(text)
        self.assertIn(needle, str(caught.exception))


class CensusAcceptsThePinnedRender(CensusFixture):
    def test_the_pinned_render_passes(self):
        self.assertEqual(self.census(render())["objects"], 4)

    def test_chart_facts_come_from_metadata_and_values(self):
        self.assertEqual(self.facts.chart_name, FIXTURE_CHART_NAME)
        self.assertEqual(self.facts.peer_namespace, FIXTURE_PEER_NAMESPACE)
        self.assertEqual(self.facts.peer_app_name, FIXTURE_PEER_APP)
        self.assertEqual(self.facts.peer_instance, FIXTURE_PEER_INSTANCE)
        self.assertEqual(self.facts.service_port, FIXTURE_PORT)

    def test_the_peer_instance_may_be_stated_by_the_caller(self):
        facts = CRC.ChartFacts(self.chart, FIXTURE_RELEASE, FIXTURE_NAMESPACE, "another-instance")
        self.assertEqual(facts.peer_instance, "another-instance")
        with self.assertRaises(CRC.CensusError):
            CRC.census(render(), facts)


class CensusRefusesASecondPolicy(CensusFixture):
    """The exact shapes from the PR #80 security receipt, and their cousins."""

    def test_the_spaced_key_same_file_shadow_policy(self):
        # The [P1] finding, verbatim: valid YAML, invisible to a raw-line
        # census, an additive allow-all for every Pod once applied.
        self.reject(render() + SHADOW_ALLOW_ALL_SPACED, "carries 2 NetworkPolicy objects")

    def test_a_quoted_key_shadow_policy(self):
        shadow = SHADOW_ALLOW_ALL_SPACED.replace("kind : NetworkPolicy", '"kind": NetworkPolicy')
        self.reject(render() + shadow, "carries 2 NetworkPolicy objects")

    def test_a_flow_style_shadow_document(self):
        shadow = ("---\n{apiVersion: networking.k8s.io/v1, kind: NetworkPolicy, "
                  "metadata: {name: shadow}, spec: {podSelector: {}, "
                  "policyTypes: [Egress], egress: [{}]}}\n")
        self.reject(render() + shadow, "carries 2 NetworkPolicy objects")

    def test_a_generic_list_wrapper_is_flattened_and_counted(self):
        wrapper = textwrap.dedent(
            """\
            ---
            apiVersion: v1
            kind: List
            items:
              - apiVersion: networking.k8s.io/v1
                kind: NetworkPolicy
                metadata:
                  name: shadow
                spec:
                  podSelector: {}
                  policyTypes: [Egress]
                  egress: [{}]
            """
        )
        self.reject(render() + wrapper, "carries 2 NetworkPolicy objects")

    def test_a_typed_list_wrapper_is_flattened_and_counted(self):
        wrapper = textwrap.dedent(
            """\
            ---
            apiVersion: networking.k8s.io/v1
            kind: NetworkPolicyList
            items:
              - apiVersion: networking.k8s.io/v1
                kind: NetworkPolicy
                metadata:
                  name: shadow
                spec:
                  podSelector: {}
                  policyTypes: [Egress]
                  egress: [{}]
            """
        )
        self.reject(render() + wrapper, "carries 2 NetworkPolicy objects")

    def test_a_wrapper_is_flattened_into_its_items_not_merely_rejected(self):
        # "Deliberately flattened and inspected", stated directly: the
        # wrapper disappears and the object it carried is what gets censused.
        # Without this, a wrapper could be refused for the wrong reason and
        # nobody would notice that flattening had stopped working.
        wrapper = textwrap.dedent(
            """\
            apiVersion: v1
            kind: List
            items:
              - apiVersion: v1
                kind: List
                items:
                  - apiVersion: networking.k8s.io/v1
                    kind: NetworkPolicy
                    metadata:
                      name: inner
              - apiVersion: v1
                kind: ConfigMap
                metadata:
                  name: also-inner
            """
        )
        flat = CRC.flatten(parse(wrapper))
        self.assertEqual([o["kind"] for o in flat], ["NetworkPolicy", "ConfigMap"])

    def test_a_wrapper_whose_items_cannot_be_inspected_is_refused(self):
        wrapper = "---\napiVersion: v1\nkind: List\nitems: elsewhere\n"
        self.reject(render() + wrapper, "cannot be inspected is refused")

    def test_a_wrapper_carrying_unaccounted_keys_is_refused(self):
        wrapper = "---\napiVersion: v1\nkind: List\nitems: []\nrules: [{}]\n"
        self.reject(render() + wrapper, "unexpected keys")

    def test_a_policy_under_another_kind_trips_the_inventory(self):
        foreign = textwrap.dedent(
            """\
            ---
            apiVersion: cilium.io/v2
            kind: CiliumNetworkPolicy
            metadata:
              name: shadow
            spec:
              endpointSelector: {}
            """
        )
        self.reject(render() + foreign, "object inventory is not the pinned one")

    def test_any_extra_document_trips_the_inventory(self):
        extra = "---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: extra\n"
        self.reject(render() + extra, "object inventory is not the pinned one")

    def test_a_missing_document_trips_the_inventory(self):
        text = render()
        head, _, _ = text.partition("---\napiVersion: apps/v1")
        self.reject(head, "object inventory is not the pinned one")


class CensusRefusesAWidenedPolicy(CensusFixture):
    """Every promise the census makes about the one policy it does find."""

    def widen(self, old: str, new: str) -> str:
        base = render()
        self.assertIn(old, base, "the mutation anchor is not in the render")
        mutated = base.replace(old, new, 1)
        self.assertNotEqual(mutated, base, "the mutation changed nothing")
        return mutated

    def test_one_empty_egress_rule_is_an_allowance(self):
        self.reject(self.widen("  egress: []", "  egress: [{}]"), "an exactly empty list is pinned")

    def test_an_empty_egress_mapping_is_refused(self):
        self.reject(self.widen("  egress: []", "  egress: {}"), "an exactly empty list is pinned")

    def test_a_dns_exception_is_refused(self):
        self.reject(self.widen("  egress: []",
                               "  egress:\n    - ports:\n        - port: 53\n          protocol: UDP"),
                    "an exactly empty list is pinned")

    def test_dropping_the_egress_policy_type_is_refused(self):
        self.reject(self.widen("    - Ingress\n    - Egress", "    - Ingress"), "policyTypes")

    def test_an_empty_pod_selector_is_refused(self):
        selector = ("  podSelector:\n    matchLabels:\n"
                    "      app.kubernetes.io/name: %s\n"
                    "      app.kubernetes.io/instance: %s" % (FIXTURE_CHART_NAME, FIXTURE_RELEASE))
        self.reject(self.widen(selector, "  podSelector: {}"), "podSelector")

    def test_a_pod_selector_naming_another_app_is_refused(self):
        self.reject(self.widen("      app.kubernetes.io/name: %s\n" % FIXTURE_CHART_NAME,
                               "      app.kubernetes.io/name: %s-elsewhere\n" % FIXTURE_CHART_NAME),
                    "podSelector")

    def test_a_second_ingress_rule_is_refused(self):
        self.reject(self.widen("          protocol: TCP", "          protocol: TCP\n    - {}"),
                    "ingress is not the one rule")

    def test_dropping_the_peer_instance_is_refused(self):
        self.reject(self.widen("\n              app.kubernetes.io/instance: %s" % FIXTURE_PEER_INSTANCE, ""),
                    "ingress is not the one rule")

    def test_an_unpinned_spec_key_is_refused(self):
        self.reject(self.widen("  egress: []", "  egress: []\n  shadowKey: true"), "spec keys")

    def test_a_respelled_but_widened_egress_is_still_refused(self):
        self.reject(self.widen("  egress: []", "  egress : [{}]"), "an exactly empty list is pinned")

    def test_a_respelled_but_unchanged_policy_still_passes(self):
        # Normalisation must not turn a legal respelling into a false alarm:
        # the census judges meaning, and this render means the same thing.
        base = render()
        respelled = (base
                     .replace("kind: NetworkPolicy", '"kind": NetworkPolicy', 1)
                     .replace("  egress: []", "  egress : []", 1))
        self.assertNotEqual(respelled, base)
        self.assertEqual(CRC.census(respelled, self.facts)["objects"], 4)

    def test_the_wrong_policy_entirely_is_refused(self):
        # The expectation is stated by the census, never read from the input:
        # a render whose policy is a different object cannot talk its way in.
        base = render()
        wrong = base.replace("  name: ingress-to-%s" % FIXTURE_CHART_NAME,
                             "  name: something-else", 1)
        self.reject(wrong, "is named")


class MutationBattery(CensusFixture):
    def test_every_mutation_name_is_unique(self):
        names = [name for name, _ in CRC.mutations(self.facts)]
        self.assertEqual(len(names), len(set(names)))

    def test_an_unknown_mutation_is_refused(self):
        with self.assertRaises(CRC.CensusError):
            CRC.mutate(render(), self.facts, "no-such-mutation")

    def test_the_gate_script_pins_the_battery_at_its_real_size(self):
        # One fact in two files: the shell floor and the battery itself.
        # If they can disagree, the floor is decoration.
        script = GATE_SCRIPT.read_text(encoding="utf-8")
        line = [l for l in script.split("\n") if l.startswith("minimum_census_mutations=")]
        self.assertEqual(len(line), 1, "the gate script must pin the census battery exactly once")
        pinned = int(line[0].split("=", 1)[1])
        self.assertEqual(pinned, len(CRC.mutations(self.facts)))


class RealChartFiles(unittest.TestCase):
    """The reader must read this repository's own chart files, not just fixtures."""

    def test_the_real_chart_metadata_and_values_parse(self):
        facts = CRC.ChartFacts(REAL_CHART, "release", "namespace")
        self.assertEqual(facts.chart_name, "naranjo-online")
        self.assertTrue(facts.peer_namespace)
        self.assertTrue(facts.peer_app_name)
        self.assertTrue(facts.peer_instance)
        self.assertIsInstance(facts.service_port, int)

    def test_the_template_source_parses_only_after_helm_renders_it(self):
        # Guards a tempting shortcut: the TEMPLATE is not YAML (it carries Go
        # template actions), so nothing here may census template source in
        # place of a render.
        template = (REAL_CHART / "templates" / "network-policy.yaml").read_text(encoding="utf-8")
        self.assertIn("{{", template)
        with self.assertRaises(CRC.CensusError):
            CRC.parse_documents(template, "<template>")


if __name__ == "__main__":
    unittest.main()
