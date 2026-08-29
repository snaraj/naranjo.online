#!/usr/bin/env bash
# chart-egress-pin — prove the rendered application NetworkPolicy carries the
# EXACT outbound allowance the owner directed and nothing wider: it declares the
# Egress policy type AND exactly two egress rules, over a pod selector that
# names this workload.
#
# WHAT CHANGED ON 2026-08-27, AND WHY THIS IS NOT A WEAKENED GATE. Until then
# this file pinned a total deny — the Egress policy type over an exactly empty
# rule list — and its own header promised that the day an allowance arrived it
# would be "an exact allow-list, never a widening of this one". The owner
# directed live panel fetches, so that day came. The pinned contract was
# REPLACED, not relaxed: one exactly-pinned shape gave way to another
# exactly-pinned shape, compared the same way (whole sub-tree equality), proven
# refusable the same way (a hostile mutation battery run against the real
# render), and with MORE hostile shapes covered than before, because an
# allowance has more moving parts than an empty list. Narrowing back to the
# retired deny is itself one of the refusals: this gate pins what the chart is
# meant to render, in both directions.
#
# THE TWO RULES, AND THE BOUND THAT IS NOT HERE. Rule 1 is TCP/443 to
# 0.0.0.0/0; rule 2 is UDP+TCP/53 to the cluster DNS Pods, selected by
# namespace AND pod labels inside ONE peer element so the two are ANDed. The
# fetch surface is the five HTTPS hosts in internal/panels/config/fetch.json,
# and a NetworkPolicy cannot express a host name at all — so the HOST bound is
# enforced in-process by internal/panels/fetch.go, at construction over every
# configured endpoint and again on every request, with private, loopback and
# link-local resolved addresses refused at dial time. The template header states
# that split in full. Reading 0.0.0.0/0 here and stopping is how a reader
# concludes the opposite of what is true.
#
# Why the policy type is still load-bearing. Egress rules alone are inert:
# Kubernetes applies them only to policies that list `Egress` in `policyTypes`,
# so a policy carrying rules WITHOUT that type restricts nothing and the Pod
# keeps unrestricted outbound connectivity. Conversely the emptiest-looking
# rule — `- {}` — is the widest one there is, and rules are ADDITIVE, so one
# extra rule grants everything the pinned two withhold. And every half only
# binds the Pods the policy selects, so a selector that names the wrong app or
# drops the instance leaves the workload governed by nothing while the manifest
# still reads like a bounded allowance.
#
# HOW THIS GATE READS THE RENDER. Like its ingress sibling it does not grep
# for a token: it extracts each `spec` child sub-tree by indentation and
# compares the WHOLE sub-tree against a pinned literal, so any extra rule,
# extra peer, added port, DNS exception, duplicate key, or flow-style
# rewrite fails — in block or flow style. The parser is stdlib Python (these
# repos are stdlib-only): no PyYAML, no yq, so it runs anywhere helm does.
#
# AND WHY THAT IS NOT ENOUGH ON ITS OWN (issue #86). The text pin below reads
# ONE template's render by raw line: a document is recognised by a line whose
# prefix is exactly `kind`, and the spec by a line exactly equal to `spec:`.
# YAML allows whitespace before a key's colon, allows the key to be quoted,
# and resolves escapes inside a double-quoted key — so a SECOND NetworkPolicy
# spelled `kind :` / `spec :`, in this same file, was invisible to that
# census and to all 19 mutations while parsing, under a real YAML
# implementation, as an empty-selector `policyTypes: [Egress]` policy with
# one empty egress rule. NetworkPolicy allowances are ADDITIVE: that second
# document hands every Pod unrestricted outbound access. The independent
# security review of PR #80 reproduced exactly that at the merged head.
# Assertions (c), (d) and (g) are the answer: a whole-render census through a real
# document reader that normalises keys to their canonical spelling BEFORE
# matching, flattens list wrappers, and requires exactly one NetworkPolicy in
# the complete installable render, equal to an expectation stated in the
# gate. It lives in scripts/ci/chart_render_census.py — too big to embed
# here, and it is unit-tested in scripts/ci/test_chart_render_census.py.
#
# WHERE THE EXPECTATIONS COME FROM. The ingress sibling reads the peer
# identity out of chart/values.yaml because that peer is configuration. This
# policy has none: the allowance is a reviewed constant, exactly as the deny
# before it was, so it is written here as a constant and NOT read back out of
# the template under test — an expectation derived from the template would pass
# for any template. The selector's two facts come from chart/Chart.yaml (the
# chart name) and this script (the release name and namespace it renders with).
#
# Seven assertions, all failing closed:
#   a. the DEFAULT render — no flags, shipped values — carries the pinned
#      selector, exactly [Ingress, Egress] policy types, and the exact two-rule
#      egress sub-tree, each compared in full;
#   b. every hostile mutation below is REFUSED. Each is applied to the real
#      render and fed back through assertion (a)'s own checker, which must
#      exit non-zero. A gate that cannot fail is not a gate, and a mutation
#      that survives is a hole this file would otherwise hide;
#   c. the COMPLETE installable render — every template, CRDs included —
#      parses, carries the pinned document inventory, and holds exactly one
#      NetworkPolicy equal to the pinned object, semantics compared, not
#      lines;
#   d. every hostile whole-render mutation is REFUSED by (c) — including the
#      shadow policies that defeated the text pin;
#   e. no values override moves the allowance — its SHAPE is unconditional,
#      not a default (requirement 4: security behavior is never toggleable), so
#      no value can widen it and none can silently close it either — and no
#      override adds a second policy anywhere in the render;
#   f. the text mutation battery has not been quietly shrunk;
#   g. the census battery has not been quietly shrunk either.
#
# Assertion (c) does compare the ingress rule, because a census that ignores
# half the spec cannot claim the object it found is the pinned one; it takes
# the peer identity from chart/values.yaml, the binding point, so this file
# still names no provider. chart-ingress-pin.sh keeps sole ownership of the
# ingress sub-tree's byte-for-byte canonical TEXT.
set -euo pipefail

chart_dir="${CHART_DIR:-chart}"
kube_version="${KUBE_VERSION:-v1.36.0}"
release_name=egress-pin
release_namespace=egress-pin-namespace
chart_file="${chart_dir}/Chart.yaml"
script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
census_module="${script_dir}/chart_render_census.py"

# The exact size of each battery, so deleting a mutation is a red build rather
# than a silently smaller battery. Bumped when mutations are added -- and they
# were, from 19/48 to 29/61, when the total deny became the two-rule allowance
# on 2026-08-27: the replacement contract has more moving parts, so it needs
# more hostile shapes proven refused, not the same number aimed elsewhere.
minimum_mutations=31
minimum_census_mutations=66

fail() {
  printf 'chart-egress-pin: %s\n' "$1" >&2
  exit 1
}

# The structural core, stdlib Python only. It carries no provider name and no
# single-quote character, so it embeds cleanly here. Modes:
#   chart-name <Chart.yaml>            prints the chart name
#   assert <name> <release>            reads a render on stdin, asserts it
#   mutations                          prints every mutation name
#   mutate <name> <release> <mutation> reads a render, writes a hostile one
py_core='
import sys

def die(msg):
    sys.stderr.write("chart-egress-pin: " + msg + "\n")
    sys.exit(1)

def indent_of(s):
    return len(s) - len(s.lstrip(" "))

def cmd_chart_name(path):
    with open(path) as fh:
        for line in fh.read().split("\n"):
            if indent_of(line) == 0 and line.split(":", 1)[0] == "name":
                value = line.partition(":")[2].strip().strip(chr(34) + chr(39))
                if value:
                    sys.stdout.write(value + "\n")
                    return
    die("chart metadata declares no name")

def spec_block(text):
    lines = text.split("\n")
    spec_idx = [i for i, l in enumerate(lines) if l.rstrip() == "spec:"]
    if len(spec_idx) != 1:
        die("expected exactly one top-level spec:; found %d. A second policy "
            "document in this file could allow what the first denies."
            % len(spec_idx))
    block = []
    j = spec_idx[0] + 1
    while j < len(lines):
        l = lines[j]
        if l.strip() == "":
            block.append(l)
            j += 1
            continue
        if l.rstrip() == "---" or indent_of(l) == 0:
            break
        block.append(l)
        j += 1
    while block and block[-1].strip() == "":
        block.pop()
    if not block:
        die("the rendered spec block is empty")
    return block

def key_positions(block, key):
    found = []
    for i, l in enumerate(block):
        if indent_of(l) != 2:
            continue
        s = l.strip()
        if s.startswith("#") or ":" not in s:
            continue
        if s.split(":", 1)[0] == key:
            found.append(i)
    return found

def child_block(block, i):
    out = []
    j = i + 1
    while j < len(block):
        l = block[j]
        if l.strip() == "":
            out.append(l)
            j += 1
            continue
        if indent_of(l) <= 2:
            break
        out.append(l)
        j += 1
    while out and out[-1].strip() == "":
        out.pop()
    return [l.rstrip() for l in out]

def shown(lines):
    return "\n".join(lines) if lines else "(nothing)"

def cmd_assert(name, release):
    text = sys.stdin.read()
    kinds = [l.rstrip() for l in text.split("\n")
             if indent_of(l) == 0 and l.split(":", 1)[0] == "kind"]
    if kinds != ["kind: NetworkPolicy"]:
        die("expected exactly one NetworkPolicy document; found %s" % shown(kinds))
    block = spec_block(text)
    pins = [
        ("podSelector", "  podSelector:", [
            "    matchLabels:",
            "      app.kubernetes.io/name: " + name,
            "      app.kubernetes.io/instance: " + release,
        ]),
        ("policyTypes", "  policyTypes:", [
            "    - Ingress",
            "    - Egress",
        ]),
        ("egress", "  egress:", EGRESS_BLOCK),
    ]
    for key, header, expected in pins:
        at = key_positions(block, key)
        if len(at) != 1:
            die("spec.%s appears %d times; exactly one is required, or a "
                "later duplicate key silently replaces the pinned one:\n%s"
                % (key, len(at), "\n".join(block)))
        rendered_header = block[at[0]].rstrip()
        if rendered_header != header:
            die("spec.%s rendered as [%s]; this gate pins the exact canonical "
                "render [%s], so any other spelling -- an empty mapping, a "
                "flow sequence with content, a block sequence, or different "
                "spacing -- stops here for a human to read"
                % (key, rendered_header, header))
        rendered = child_block(block, at[0])
        if rendered != expected:
            die("spec.%s does not equal the pinned block.\nexpected:\n%s\n\n"
                "rendered:\n%s" % (key, shown(expected), shown(rendered)))

# The pinned allowance, as the template renders it. A CONSTANT here, exactly
# like the total deny it replaced was a constant: an expectation read out of
# the template under test would pass for anything that template renders.
EGRESS_BLOCK = [
    "    - to:",
    "        - ipBlock:",
    "            cidr: 0.0.0.0/0",
    "            except:",
    "              - 10.0.0.0/8",
    "              - 172.16.0.0/12",
    "              - 192.168.0.0/16",
    "              - 169.254.0.0/16",
    "      ports:",
    "        - port: 443",
    "          protocol: TCP",
    "    - to:",
    "        - namespaceSelector:",
    "            matchLabels:",
    "              kubernetes.io/metadata.name: kube-system",
    "          podSelector:",
    "            matchLabels:",
    "              k8s-app: kube-dns",
    "      ports:",
    "        - port: 53",
    "          protocol: UDP",
    "        - port: 53",
    "          protocol: TCP",
]

EGRESS_ANCHOR = ["  egress:"] + EGRESS_BLOCK


def egress(*lines):
    return [(EGRESS_ANCHOR, list(lines))]


def egress_plus(*lines):
    return [(EGRESS_ANCHOR, EGRESS_ANCHOR + list(lines))]


def mutations(name, release):
    """Every hostile render this gate must refuse, as (name, [(target, repl)]).

    A target is a list of CONSECUTIVE lines that must appear EXACTLY ONCE in
    the render; it was a single line while egress was one empty list, and it
    could not stay one. The allowance carries two rules, two `to:` lines and
    three `ports:` lines, so no single line inside it is unique any more and a
    single-line anchor would either miss or match ambiguously -- both of which
    are ways for a battery to report on itself instead of on the render.
    """
    app_line = "      app.kubernetes.io/name: " + name
    instance_line = "      app.kubernetes.io/instance: " + release
    return [
        # The inert-policy trap: rules Kubernetes never applies, because the
        # policy does not claim the Egress type. Still the first mutation,
        # because the allowance depends on that type exactly as the deny did.
        ("omit-egress-policy-type", [(["    - Egress"], [])]),
        ("omit-policy-types", [
            (["  policyTypes:", "    - Ingress", "    - Egress"], []),
        ]),
        # --- the allowance emptied, widened, or replaced wholesale ----------
        ("omit-egress-rules", egress()),
        ("egress-empty-mapping", egress("  egress: {}")),
        ("egress-single-empty-rule", egress("  egress:", "    - {}")),
        ("egress-inline-empty-rule", egress("  egress: [{}]")),
        # Narrowing back to the retired total deny is not a danger, it is
        # DRIFT: this gate pins the shape the owner directed, so a render that
        # quietly went back to the old contract stops here for a human.
        ("egress-narrowed-back-to-the-retired-deny", egress("  egress: []")),
        ("egress-allow-all-ipv6-peer-appended", egress_plus(
            "    - to:",
            "        - ipBlock:",
            "            cidr: ::/0",
        )),
        ("egress-third-rule-appended", egress_plus("    - {}")),
        ("egress-extra-port-rule-appended", egress_plus(
            "    - to:",
            "        - ipBlock:",
            "            cidr: 0.0.0.0/0",
            "      ports:",
            "        - port: 22",
            "          protocol: TCP",
        )),
        ("egress-duplicate-key", egress_plus("  egress:", "    - {}")),
        # A key spelled with a space before the colon is a DIFFERENT raw line
        # and the same YAML key; the gate pins the canonical render, so it
        # stops rather than trying to decide which one it read.
        ("egress-noncanonical-header", egress("  egress :", *EGRESS_BLOCK)),
        # --- rule 1: the TLS fetch surface ---------------------------------
        # Ports removed is every port to every address, which is the widest
        # rule expressible and the easiest one to produce by accident.
        ("egress-tls-rule-loses-its-ports", egress(
            "  egress:",
            *EGRESS_BLOCK[:8],
            *EGRESS_BLOCK[11:],
        )),
        ("egress-tls-port-widened-to-a-range", egress(
            "  egress:",
            *EGRESS_BLOCK[:8],
            "      ports:",
            "        - port: 1",
            "          endPort: 65535",
            "          protocol: TCP",
            *EGRESS_BLOCK[11:],
        )),
        ("egress-tls-port-moved-off-443", egress(
            "  egress:",
            *EGRESS_BLOCK[:9],
            "        - port: 8080",
            "          protocol: TCP",
            *EGRESS_BLOCK[11:],
        )),
        ("egress-tls-rule-gains-udp", egress(
            "  egress:",
            *EGRESS_BLOCK[:11],
            "        - port: 443",
            "          protocol: UDP",
            *EGRESS_BLOCK[11:],
        )),
        # The except list makes the fabric state the same refusal guardedDial
        # makes in-process: 443 into private or link-local space is never a
        # legitimate panel fetch. Dropping the list restores the pre-2026-08-27
        # rule 1 exactly, which is why it is refused BY NAME rather than left
        # to the block equality alone; dropping one entry is the subtler edit,
        # a narrower except being a wider allowance, and the entry chosen for
        # the probe is the RFC1918 block the production LAN actually sits in.
        ("egress-tls-except-list-dropped", egress(
            "  egress:",
            *EGRESS_BLOCK[:3],
            *EGRESS_BLOCK[8:],
        )),
        ("egress-tls-except-loses-the-lan-block", egress(
            "  egress:",
            *EGRESS_BLOCK[:6],
            *EGRESS_BLOCK[7:],
        )),
        # --- rule 2: the cluster DNS peer ----------------------------------
        # The two selectors sit in ONE peer element and are therefore ANDed.
        # Dropping either half, or splitting them into two peer elements,
        # turns a kube-dns allowance into a namespace-wide or cluster-wide one
        # while the rendered text still mentions both names.
        ("egress-dns-peer-loses-its-namespace-selector", egress(
            "  egress:",
            *EGRESS_BLOCK[:12],
            "        - podSelector:",
            "            matchLabels:",
            "              k8s-app: kube-dns",
            *EGRESS_BLOCK[18:],
        )),
        ("egress-dns-peer-loses-its-pod-selector", egress(
            "  egress:", *EGRESS_BLOCK[:15], *EGRESS_BLOCK[18:],
        )),
        ("egress-dns-peer-split-into-two-peers", egress(
            "  egress:",
            *EGRESS_BLOCK[:15],
            "        - podSelector:",
            "            matchLabels:",
            "              k8s-app: kube-dns",
            *EGRESS_BLOCK[18:],
        )),
        ("egress-dns-namespace-label-dropped", egress(
            "  egress:", *EGRESS_BLOCK[:14], *EGRESS_BLOCK[15:],
        )),
        ("egress-dns-pod-label-repointed", egress(
            "  egress:",
            *EGRESS_BLOCK[:17],
            "              k8s-app: not-the-cluster-dns",
            *EGRESS_BLOCK[18:],
        )),
        ("egress-dns-rule-loses-its-ports", egress(
            "  egress:", *EGRESS_BLOCK[:18],
        )),
        ("egress-dns-port-widened-to-a-range", egress(
            "  egress:",
            *EGRESS_BLOCK[:19],
            "        - port: 1",
            "          endPort: 65535",
            "          protocol: UDP",
            *EGRESS_BLOCK[21:],
        )),
        ("egress-dns-loses-its-tcp-half", egress(
            "  egress:", *EGRESS_BLOCK[:21],
        )),
        ("policy-types-inline", [
            (["  policyTypes:", "    - Ingress", "    - Egress"],
             ["  policyTypes: [Ingress, Egress]"]),
        ]),
        # The allowance, like the deny before it, binds only the Pods the
        # policy selects: a selector that names the wrong app or drops the
        # instance leaves this workload governed by no policy at all.
        ("pod-selector-wrong-app", [([app_line], [app_line + "-elsewhere"])]),
        ("pod-selector-drop-instance", [([instance_line], [])]),
        ("pod-selector-empty", [
            (["  podSelector:", "    matchLabels:", app_line, instance_line],
             ["  podSelector: {}"]),
        ]),
        ("second-policy-document", [(["apiVersion: networking.k8s.io/v1"], [
            "apiVersion: networking.k8s.io/v1",
            "kind: NetworkPolicy",
            "metadata:",
            "  name: shadow-allow-all",
            "spec:",
            "  podSelector: {}",
            "  policyTypes:",
            "    - Egress",
            "  egress:",
            "    - {}",
            "---",
            "apiVersion: networking.k8s.io/v1",
        ])]),
    ]

def cmd_mutations(name, release):
    sys.stdout.write("\n".join(n for n, _ in mutations(name, release)) + "\n")

def find_run(lines, target):
    """Every index where the consecutive run `target` starts."""
    span = len(target)
    hits = []
    for i in range(len(lines) - span + 1):
        if [l.rstrip() for l in lines[i:i + span]] == target:
            hits.append(i)
    return hits


def cmd_mutate(name, release, wanted):
    table = dict(mutations(name, release))
    if wanted not in table:
        die("unknown mutation " + wanted)
    text = sys.stdin.read()
    lines = text.split("\n")
    for target, replacement in table[wanted]:
        hits = find_run(lines, target)
        if len(hits) != 1:
            die("mutation %s anchored on the run starting [%s], which matched "
                "%d places; the self-test needs exactly one"
                % (wanted, target[0], len(hits)))
        at = hits[0]
        lines = lines[:at] + replacement + lines[at + len(target):]
    mutated = "\n".join(lines)
    if mutated == text:
        die("mutation %s changed nothing, so refusing it would prove nothing"
            % wanted)
    sys.stdout.write(mutated)

mode = sys.argv[1]
if mode == "chart-name":
    cmd_chart_name(sys.argv[2])
elif mode == "assert":
    cmd_assert(sys.argv[2], sys.argv[3])
elif mode == "mutations":
    cmd_mutations(sys.argv[2], sys.argv[3])
elif mode == "mutate":
    cmd_mutate(sys.argv[2], sys.argv[3], sys.argv[4])
else:
    die("unknown mode " + mode)
'

# render prints the NetworkPolicy document alone, at the platform Kubernetes
# target. Extra arguments go straight to helm.
render() {
  helm template "${release_name}" "${chart_dir}" \
    --kube-version "${kube_version}" \
    --namespace "${release_namespace}" \
    --show-only templates/network-policy.yaml "$@"
}

# render_all prints the COMPLETE installable render instead: every template
# file, plus `crds/` — the same set `helm install` would apply. No
# --show-only, because --show-only is exactly the blindfold assertions (e)
# through (g) exist to remove.
render_all() {
  helm template "${release_name}" "${chart_dir}" \
    --kube-version "${kube_version}" \
    --namespace "${release_namespace}" \
    --include-crds "$@"
}

check() {
  python3 -c "${py_core}" assert "${chart_name}" "${release_name}"
}

# Extra arguments go straight to the census (assertion (e) uses this to state
# the peer instance it deliberately overrode).
census() {
  python3 -I -B "${census_module}" census \
    --chart "${chart_dir}" \
    --release "${release_name}" \
    --namespace "${release_namespace}" "$@"
}

if ! chart_name="$(python3 -c "${py_core}" chart-name "${chart_file}")"; then
  fail "could not read the chart name from ${chart_file}"
fi
[ -n "${chart_name}" ] || fail "chart metadata declares no name"

[ -f "${census_module}" ] || fail "the whole-render census module is missing at ${census_module}"

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

# (a) The default render carries the exact allowance, over this workload's own
# selector.
render >"${work}/render.yaml"
check <"${work}/render.yaml"
echo "chart-egress-pin: (a) default render pins the selector, [Ingress, Egress], and the exact two-rule egress allowance"

# (b) Every hostile mutation is refused. The list comes from the checker
# itself, so the loop cannot drift away from what is actually covered.
mutation_count=0
while IFS= read -r mutation; do
  [ -n "${mutation}" ] || continue
  python3 -c "${py_core}" mutate "${chart_name}" "${release_name}" "${mutation}" \
    <"${work}/render.yaml" >"${work}/mutant.yaml"
  if check <"${work}/mutant.yaml" 2>/dev/null; then
    fail "the hostile mutation '${mutation}' was ACCEPTED — this gate would not catch it in a real render"
  fi
  mutation_count=$((mutation_count + 1))
done <<EOF
$(python3 -c "${py_core}" mutations "${chart_name}" "${release_name}")
EOF
echo "chart-egress-pin: (b) ${mutation_count} hostile mutations of the real render all refused"

# (c) The COMPLETE installable render — not one --show-only extract — carries
# exactly one NetworkPolicy, and it is the pinned object. Documents are
# recognised by their parsed, canonically spelled keys, so `kind :`, a quoted
# `"kind"`, an escaped `"\x6bind"`, a flow-style document, and a policy tucked
# inside a List wrapper are all just NetworkPolicies to this census.
render_all >"${work}/whole-render.yaml"
census <"${work}/whole-render.yaml"
echo "chart-egress-pin: (c) the complete render holds exactly one NetworkPolicy, equal to the pinned object"

# (d) Every hostile whole-render mutation is refused. Same discipline as (b):
# the list comes from the census itself, each mutant is built from the REAL
# render, and a mutant that survives is a hole this file would otherwise
# hide. The shadow-policy entries are the exact attack shapes that passed the
# pinned gate before issue #86.
census_mutation_count=0
while IFS= read -r mutation; do
  [ -n "${mutation}" ] || continue
  python3 -I -B "${census_module}" mutate \
    --chart "${chart_dir}" --release "${release_name}" \
    --namespace "${release_namespace}" --name "${mutation}" \
    <"${work}/whole-render.yaml" >"${work}/census-mutant.yaml"
  if census <"${work}/census-mutant.yaml" >/dev/null 2>&1; then
    fail "the hostile whole-render mutation '${mutation}' was ACCEPTED — this gate would not catch it in a real render"
  fi
  census_mutation_count=$((census_mutation_count + 1))
done <<EOF
$(python3 -I -B "${census_module}" mutations)
EOF
echo "chart-egress-pin: (d) ${census_mutation_count} hostile whole-render mutations all refused"

# (e) The allowance is unconditional. No shipped value toggles its shape, so
# every value the schema lets a deployment move must leave the egress answer
# identical — including the two switches whose FEATURES this allowance exists
# for, since a policy that widened when a capability turned on, or that leaned
# on a capability being on, would be a policy nobody could reason about from the
# template alone. It must not add a second policy to the render either, which is
# why the whole-render census runs under each override too. This is a fixed
# sample of the overrides the schema admits, not an exhaustive sweep: the
# exact-render pin in (a) and the object census in (c) are what stand behind a
# values-conditional change nobody sampled.
while IFS= read -r override; do
  [ -n "${override}" ] || continue
  render --set "${override}" | check ||
    fail "the override '${override}' changed the egress answer — an allowance a value can move is not an allowance"
  # One override deliberately moves the ingress peer identity, which the
  # census pins as well. Telling the census which instance was rendered keeps
  # the assertion exact under the override instead of skipping it — and
  # proves the ingress expectation really does track the values, rather than
  # being a constant that would match anything.
  case "${override}" in
    ingress.peerInstance=*)
      render_all --set "${override}" |
        census --peer-instance "${override#ingress.peerInstance=}" >/dev/null ||
        fail "the override '${override}' changed the whole-render census — an allowance a value can move is not an allowance"
      ;;
    *)
      render_all --set "${override}" | census >/dev/null ||
        fail "the override '${override}' changed the whole-render census — an allowance a value can move is not an allowance"
      ;;
  esac
done <<'EOF'
replicaCount=1
deploymentReady=true
ingress.peerInstance=another-connector-instance
resources.limits.cpu=500m
resources.requests.cpu=50m
panels.refresh.enabled=false
media.enabled=false
EOF
echo "chart-egress-pin: (e) no shipped value override moves the allowance or adds a policy"

# (f) The text battery has not been quietly shrunk.
[ "${mutation_count}" -ge "${minimum_mutations}" ] ||
  fail "only ${mutation_count} mutations ran; at least ${minimum_mutations} are required. Mutations are added, never removed."
echo "chart-egress-pin: (f) mutation battery is at or above its pinned floor of ${minimum_mutations}"

# (g) And the census battery has not been quietly shrunk either.
[ "${census_mutation_count}" -ge "${minimum_census_mutations}" ] ||
  fail "only ${census_mutation_count} census mutations ran; at least ${minimum_census_mutations} are required. Mutations are added, never removed."
echo "chart-egress-pin: (g) census battery is at or above its pinned floor of ${minimum_census_mutations}"

echo "chart-egress-pin: the rendered policy allows exactly TCP/443 outbound and cluster DNS, nothing else is representable, and it is the only policy the chart installs"
