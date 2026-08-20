#!/usr/bin/env bash
# chart-egress-pin — prove the rendered application NetworkPolicy denies ALL
# outbound traffic: it declares the Egress policy type AND an exactly empty
# egress rule list, over a pod selector that names this workload.
#
# Why both halves are load-bearing. `egress: []` alone is inert: Kubernetes
# applies egress rules only to policies that list `Egress` in `policyTypes`,
# so a policy carrying an empty egress list WITHOUT that type restricts
# nothing and the Pod keeps unrestricted outbound connectivity. Conversely
# `policyTypes: [Egress]` with any rule present is an allowance, and the
# emptiest-looking rule — `- {}` — is the widest one there is. And both
# halves only bind the Pods the policy selects, so a selector that names the
# wrong app or drops the instance leaves the workload with full egress while
# the manifest still reads "default deny".
#
# HOW THIS GATE READS THE RENDER. Like its ingress sibling it does not grep
# for a token: it extracts each `spec` child sub-tree by indentation and
# compares the WHOLE sub-tree against a pinned literal, so any extra rule,
# extra peer, added port, DNS exception, duplicate key, or flow-style
# rewrite fails — in block or flow style. The parser is stdlib Python (these
# repos are stdlib-only): no PyYAML, no yq, so it runs anywhere helm does.
#
# WHERE THE EXPECTATIONS COME FROM. The ingress sibling reads the peer
# identity out of chart/values.yaml because that peer is configuration. This
# policy has no configuration: "no outbound connection, ever" is a constant,
# so it is written here as a constant and NOT read back out of the template
# under test — an expectation derived from the template would pass for any
# template. The selector's two facts come from chart/Chart.yaml (the chart
# name) and this script (the release name it renders with).
#
# Four assertions, all failing closed:
#   a. the DEFAULT render — no flags, shipped values — carries the pinned
#      selector, exactly [Ingress, Egress] policy types, and exactly
#      `egress: []`, each compared in full;
#   b. every hostile mutation below is REFUSED. Each is applied to the real
#      render and fed back through assertion (a)'s own checker, which must
#      exit non-zero. A gate that cannot fail is not a gate, and a mutation
#      that survives is a hole this file would otherwise hide;
#   c. no values override re-opens egress — the deny is unconditional, not a
#      default (requirement 4: security behavior is never toggleable);
#   d. the mutation battery has not been quietly shrunk.
#
# This file asserts nothing about the ingress rule: chart-ingress-pin.sh owns
# that sub-tree byte for byte, and one owner per pin means one place to edit.
set -euo pipefail

chart_dir="${CHART_DIR:-chart}"
kube_version="${KUBE_VERSION:-v1.36.0}"
release_name=egress-pin
chart_file="${chart_dir}/Chart.yaml"

# Bumped only when a mutation is ADDED. It exists so deleting one is a red
# build rather than a silently smaller battery.
minimum_mutations=19

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
        ("egress", "  egress: []", []),
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

def mutations(name, release):
    app_line = "      app.kubernetes.io/name: " + name
    instance_line = "      app.kubernetes.io/instance: " + release
    return [
        # The inert-policy trap: an empty egress list that Kubernetes never
        # applies, because the policy does not claim the Egress type.
        ("omit-egress-policy-type", [("    - Egress", [])]),
        ("omit-policy-types", [
            ("  policyTypes:", []),
            ("    - Ingress", []),
            ("    - Egress", []),
        ]),
        ("omit-egress-rule", [("  egress: []", [])]),
        ("egress-empty-mapping", [("  egress: []", ["  egress: {}"])]),
        ("egress-empty-rule", [("  egress: []", ["  egress:", "    - {}"])]),
        ("egress-allow-all-ipv4", [("  egress: []", [
            "  egress:",
            "    - to:",
            "        - ipBlock:",
            "            cidr: 0.0.0.0/0",
        ])]),
        ("egress-allow-all-ipv6", [("  egress: []", [
            "  egress:",
            "    - to:",
            "        - ipBlock:",
            "            cidr: ::/0",
        ])]),
        ("egress-ports-only", [("  egress: []", [
            "  egress:",
            "    - ports:",
            "        - port: 443",
            "          protocol: TCP",
        ])]),
        ("egress-dns-exception", [("  egress: []", [
            "  egress:",
            "    - ports:",
            "        - port: 53",
            "          protocol: UDP",
        ])]),
        ("egress-namespace-peer", [("  egress: []", [
            "  egress:",
            "    - to:",
            "        - namespaceSelector:",
            "            matchLabels:",
            "              kubernetes.io/metadata.name: kube-system",
        ])]),
        ("egress-pod-peer", [("  egress: []", [
            "  egress:",
            "    - to:",
            "        - podSelector:",
            "            matchLabels:",
            "              app.kubernetes.io/name: any-workload",
        ])]),
        ("egress-inline-rule", [("  egress: []", ["  egress: [{}]"])]),
        # Semantically still empty, so this one is drift detection rather
        # than a danger: the gate pins the exact canonical render, and a
        # render that changed shape is a render a human should look at.
        ("egress-noncanonical-empty", [("  egress: []", ["  egress: [ ]"])]),
        ("egress-duplicate-key", [("  egress: []", [
            "  egress: []",
            "  egress:",
            "    - {}",
        ])]),
        ("policy-types-inline", [
            ("  policyTypes:", ["  policyTypes: [Ingress, Egress]"]),
            ("    - Ingress", []),
            ("    - Egress", []),
        ]),
        # The deny binds only the Pods it selects.
        ("pod-selector-wrong-app", [(app_line, [app_line + "-elsewhere"])]),
        ("pod-selector-drop-instance", [(instance_line, [])]),
        ("pod-selector-empty", [
            ("  podSelector:", ["  podSelector: {}"]),
            ("    matchLabels:", []),
            (app_line, []),
            (instance_line, []),
        ]),
        ("second-policy-document", [("apiVersion: networking.k8s.io/v1", [
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

def cmd_mutate(name, release, wanted):
    table = dict(mutations(name, release))
    if wanted not in table:
        die("unknown mutation " + wanted)
    text = sys.stdin.read()
    lines = text.split("\n")
    for target, replacement in table[wanted]:
        out = []
        hits = 0
        for l in lines:
            if l.rstrip() == target:
                hits += 1
                out.extend(replacement)
            else:
                out.append(l)
        if hits != 1:
            die("mutation %s anchored on [%s], which matched %d lines; the "
                "self-test needs exactly one" % (wanted, target, hits))
        lines = out
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
    --show-only templates/network-policy.yaml "$@"
}

check() {
  python3 -c "${py_core}" assert "${chart_name}" "${release_name}"
}

if ! chart_name="$(python3 -c "${py_core}" chart-name "${chart_file}")"; then
  fail "could not read the chart name from ${chart_file}"
fi
[ -n "${chart_name}" ] || fail "chart metadata declares no name"

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

# (a) The default render denies every outbound connection, over this
# workload's own selector.
render >"${work}/render.yaml"
check <"${work}/render.yaml"
echo "chart-egress-pin: (a) default render pins the selector, [Ingress, Egress], and egress: []"

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

# (c) The deny is unconditional. No shipped value toggles it, so every value
# the schema lets a deployment move must leave the egress answer identical.
# (Values the schema pins outright — service.port, image.pullPolicy,
# media.enabled — cannot render at all, so they never reach this loop; a
# typo here fails the render and the pipeline rather than passing quietly.)
while IFS= read -r override; do
  [ -n "${override}" ] || continue
  render --set "${override}" | check ||
    fail "the override '${override}' changed the egress answer — a deny that a value can move is not a deny"
done <<'EOF'
replicaCount=1
deploymentReady=true
ingress.peerInstance=another-connector-instance
resources.limits.cpu=500m
resources.requests.cpu=50m
EOF
echo "chart-egress-pin: (c) no shipped value override re-opens egress"

# (d) The battery has not been quietly shrunk.
[ "${mutation_count}" -ge "${minimum_mutations}" ] ||
  fail "only ${mutation_count} mutations ran; at least ${minimum_mutations} are required. Mutations are added, never removed."
echo "chart-egress-pin: (d) mutation battery is at or above its pinned floor of ${minimum_mutations}"

echo "chart-egress-pin: the rendered policy makes every outbound connection unrepresentable"
