#!/usr/bin/env bash
# chart-media-pin — prove the media boundary renders ON by default as exactly
# one READ-ONLY volume, stays unrepresentable when incompletely specified, and
# still renders nothing at all when it is deliberately turned off.
#
# WHY THIS GATE EXISTS, AND WHAT INVERTED ON 2026-08-27. Before issue #207 the
# values schema pinned `media.enabled` to the constant `false`, so "media is
# off" was true because nothing else could be written down. That also made the
# chart unable to DESCRIBE the enabled deployment ADR 0012's storage evidence
# was meant to unlock, so the constant had to go, and this gate carried the
# difference a mere default cannot: it pinned the default render as carrying no
# media capability at all.
#
# That storage evidence and the platform lane's provisioning receipt have since
# landed (issue #182), the owner directed enablement, and the shipped defaults
# now answer yes. THE PINNED TRUTH THEREFORE INVERTS — deliberately, as an
# owner-directed change of the deployed answer, not a relaxation of the check.
# What the gate pins is strictly the same shape of promise, stated about the
# other answer, and the middle assertion is untouched:
#
#   1. the DEFAULT render carries EXACTLY ONE media volume, read-only on both
#      the volume and the mount, mounted at the values' own mountPath, with
#      MEDIA_ENABLED="true", MEDIA_ROOT equal to that mount path, and the
#      measured MEDIA_MAX_CONCURRENT — and no other media variable, ever;
#   2. every INCOMPLETE enablement is refused by schema validation, BY NAME —
#      an unnamed claim, the unresolved-storage sentinel profile, and an
#      unmeasured transfer budget each fail on their own, now expressed as
#      OVERRIDES of the enabled defaults, so `enabled: true` is still only ever
#      representable together with the facts that make it real;
#   3. an explicitly DISABLED render carries no media volume, no media mount,
#      and no media environment beyond the honest MEDIA_ENABLED="false" — the
#      capability stays genuinely reversible by values override, and the off
#      shape stays rendered and checked on every pull request rather than
#      rotting while nobody looks at it.
#
# HOW IT READS THE RENDER — the part that has to be structural. It does not
# grep for `MEDIA_ROOT` and call absence proof: a value can be rendered under
# another key, and an extra volume can be introduced without the string this
# gate greps for ever appearing. Instead it PARSES the rendered Deployment's
# block sequences by indentation and then compares whole sub-trees:
#
#   * the container's `env:` list is parsed into name/value pairs, and the
#     complete set of MEDIA_* names is compared against an exact expected set
#     in both directions. An extra media variable fails; a missing one fails;
#     a renamed one fails. The non-media variables are deliberately NOT pinned
#     here, so this gate never breaks over an unrelated panels or port change.
#   * `volumeMounts:` and pod `volumes:` are compared as WHOLE BLOCKS against
#     the exact expected text. Whole-block equality is what makes a second
#     mount — writable or otherwise — impossible to add unseen. Since the
#     panels data root also defaults on (issue #142), those blocks now name its
#     two entries too. That is deliberate coupling, not leakage: the promise
#     "exactly one media volume and nothing else" is only checkable if the gate
#     states the whole list, so a panels storage change costs a reviewed edit
#     here. chart-storage-pin.sh remains the sole owner of what those two
#     entries MEAN; this file only counts them.
#
# The parser is stdlib Python (this repository is stdlib-only): no PyYAML, no
# yq, so it runs anywhere helm does. It fails closed — anything it cannot read
# is refused with the offending text named, never guessed at. An env entry
# whose value is a nested structure (the panels key's `valueFrom`) is read as
# an entry with a NAME and no `value`, which is what keeps a media variable
# smuggled in through `valueFrom` failing the exact-inventory comparison
# instead of matching a string it never rendered.
#
# Expectations that are configuration come from chart/values.yaml (the mount
# path, the transfer budget, the claim name, the service port); expectations
# that are DOCTRINE (read-only at both levels, exactly one media volume, the
# exact MEDIA_* inventory) are constants here, because a gate that reads its
# expectation out of the thing it checks passes for anything that thing
# renders.
set -euo pipefail

chart_dir="${CHART_DIR:-chart}"
kube_version="${KUBE_VERSION:-v1.36.0}"
release_name=media-pin
values_file="${chart_dir}/values.yaml"

# The sentinel values the schema refuses beside `enabled: true`. They are the
# withheld facts assertion (b) puts back one at a time, and they are constants
# here rather than reads of values.yaml precisely because values.yaml no longer
# carries them.
sentinel_profile=UNRESOLVED_PI_MEDIA_STORAGE
sentinel_budget=0
sentinel_claim=""
# A second mount path, used to prove the path is ONE fact: overriding it must
# move the volumeMount and MEDIA_ROOT together, never one of them.
probe_mount_path=/srv/media-pin-probe

fail() {
  printf 'chart-media-pin: %s\n' "$1" >&2
  exit 1
}

# The structural core. Modes:
#   read-values <values.yaml>          prints mountPath, then service port
#   assert-media <expected-json>       reads a render on stdin and asserts
py_core='
import json
import sys


def die(msg):
    sys.stderr.write("chart-media-pin: " + msg + "\n")
    sys.exit(1)


def indent_of(s):
    return len(s) - len(s.lstrip(" "))


def block_scalars(lines, header):
    """The scalar keys nested one level under a top-level mapping key."""
    out = {}
    inside = False
    for line in lines:
        if line.rstrip() == header + ":":
            inside = True
            continue
        if inside:
            if line.strip() == "":
                continue
            if indent_of(line) == 0:
                break
            if indent_of(line) == 2 and not line.lstrip().startswith("#"):
                k, sep, v = line.strip().partition(":")
                if not sep:
                    continue
                v = v.split(" #", 1)[0].strip().strip(chr(34) + chr(39))
                out[k.strip()] = v
    return out


def nested_scalars(lines, outer, inner):
    """The scalar keys two levels down, under `outer:` then `  inner:`."""
    out = {}
    depth = 0
    for line in lines:
        if line.rstrip() == outer + ":":
            depth = 1
            continue
        if depth == 0 or line.strip() == "":
            continue
        if indent_of(line) == 0:
            break
        if line.rstrip() == "  " + inner + ":":
            depth = 2
            continue
        if depth == 2 and indent_of(line) <= 2:
            depth = 1
            continue
        if depth == 2 and indent_of(line) == 4 and not line.lstrip().startswith("#"):
            k, sep, v = line.strip().partition(":")
            if not sep:
                continue
            v = v.split(" #", 1)[0].strip().strip(chr(34) + chr(39))
            out[k.strip()] = v
    return out


def cmd_read_values(path):
    with open(path) as fh:
        lines = fh.read().split("\n")
    media = block_scalars(lines, "media")
    svc = block_scalars(lines, "service")
    panels = nested_scalars(lines, "panels", "data")
    media_keys = ("enabled", "profile", "claimName", "mountPath", "maxConcurrent")
    panels_keys = ("mountPath", "volumeName", "stateMountPath", "stateVolumeName")
    for key in media_keys:
        if not media.get(key):
            die("chart values declare no usable media." + key)
    for key in panels_keys:
        if not panels.get(key):
            die("chart values declare no usable panels.data." + key)
    if not svc.get("port"):
        die("chart values declare no service.port")
    sys.stdout.write("\n".join(
        [media[k] for k in media_keys]
        + [panels[k] for k in panels_keys]
        + [svc["port"]]) + "\n")


def block_under(lines, key, indent):
    """Every line strictly more indented than one unique `key:` header.

    The header must appear EXACTLY once at that indentation. A render that
    grew a second one is refused rather than read: which of the two this gate
    then pinned would be a coin toss, and a coin toss is not a gate.
    """
    header = (" " * indent) + key + ":"
    hits = [i for i, l in enumerate(lines) if l.rstrip() == header]
    if len(hits) != 1:
        die("expected exactly one %r at indent %d; found %d"
            % (key, indent, len(hits)))
    out = []
    j = hits[0] + 1
    while j < len(lines):
        l = lines[j]
        if l.strip() == "":
            j += 1
            continue
        if l.rstrip() == "---":
            break
        if indent_of(l) <= indent:
            break
        out.append(l)
        j += 1
    if not out:
        die("the %r block is empty" % key)
    return out


def parse_env(block, indent):
    """A block sequence of `- name: X` / `  value: Y` items, as a list.

    An entry whose value is a nested structure rather than a scalar -- the
    panels key`s `valueFrom:` -> `secretKeyRef:` -> ... -- records the
    OUTER key with an empty string and skips the deeper lines. It does NOT
    record a `value`, which is the point: a media variable smuggled in
    through `valueFrom` then reaches the exact-inventory comparison as a
    name with no value and fails it, rather than matching a string it never
    rendered. Anything shallower than an item, or deeper with no item open,
    is still refused outright.
    """
    items = []
    for line in block:
        stripped = line.strip()
        if indent_of(line) == indent and stripped.startswith("- "):
            items.append({})
            stripped = stripped[2:]
        elif indent_of(line) == indent + 2:
            if not items:
                die("env value before any env item: %r" % line)
        elif indent_of(line) > indent + 2:
            if not items:
                die("nested env content before any env item: %r" % line)
            continue
        else:
            die("unreadable env line %r" % line)
        k, sep, v = stripped.partition(":")
        if not sep:
            die("unreadable env entry %r" % line)
        items[-1][k.strip()] = v.strip().strip(chr(34))
    for item in items:
        if "name" not in item:
            die("an env entry carries no name: %r" % item)
    return items


def cmd_assert(expected_json):
    expected = json.loads(expected_json)
    lines = sys.stdin.read().split("\n")

    annotations = [l for l in lines
                   if l.strip().startswith("platform.snaraj.dev/media-storage-ready:")]
    if len(annotations) != 1:
        die("expected exactly one media-storage-ready annotation; found %d"
            % len(annotations))
    got = annotations[0].split(":", 1)[1].strip().strip(chr(34))
    if got != expected["annotation"]:
        die("media-storage-ready annotation is %r, expected %r"
            % (got, expected["annotation"]))

    env = parse_env(block_under(lines, "env", 10), 12)
    names = [e["name"] for e in env]
    if len(names) != len(set(names)):
        die("the env list repeats a name: %r" % names)
    media_env = {e["name"]: e.get("value") for e in env
                 if e["name"].startswith("MEDIA")}
    if media_env != expected["mediaEnv"]:
        die("the rendered MEDIA_* environment is %s, expected %s"
            % (json.dumps(media_env, sort_keys=True),
               json.dumps(expected["mediaEnv"], sort_keys=True)))

    for key, indent in (("volumeMounts", 10), ("volumes", 6)):
        block = block_under(lines, key, indent)
        if block != expected[key]:
            die("the rendered %s block does not equal the expected one.\n"
                "expected:\n%s\n\nrendered:\n%s"
                % (key, "\n".join(expected[key]), "\n".join(block)))


mode = sys.argv[1]
if mode == "read-values":
    cmd_read_values(sys.argv[2])
elif mode == "assert-media":
    cmd_assert(sys.argv[2])
else:
    die("unknown mode " + mode)
'

# render prints the Deployment alone, at the platform Kubernetes target.
render() {
  helm template "${release_name}" "${chart_dir}" \
    --kube-version "${kube_version}" \
    --show-only templates/deployment.yaml "$@"
}

if ! readvals="$(python3 -c "${py_core}" read-values "${values_file}")"; then
  fail "could not read the media defaults from ${values_file}"
fi
{
  IFS= read -r default_enabled
  IFS= read -r default_profile
  IFS= read -r default_claim
  IFS= read -r default_mount_path
  IFS= read -r default_budget
  IFS= read -r panels_mount
  IFS= read -r panels_volume
  IFS= read -r panels_state_mount
  IFS= read -r panels_state_volume
  IFS= read -r service_port
} <<EOF
${readvals}
EOF

[ -n "${default_mount_path}" ] || fail "chart values declare no media.mountPath"
[ -n "${service_port}" ] || fail "chart values declare no service.port"
[ "${default_mount_path}" != "${probe_mount_path}" ] ||
  fail "the probe mount path must differ from the default, or assertion (d) proves nothing"

# The production-true default is DOCTRINE here, not a value read back out of
# the file under test: media is on, under a real profile, with a real claim and
# a real measured budget. Silently flipping any of these off in values.yaml is
# a red build rather than a quieter gate that still says "all caught".
[ "${default_enabled}" = "true" ] ||
  fail "chart values ship media.enabled=${default_enabled}; this gate pins the enabled default the owner directed on 2026-08-27 (issue #182 storage receipts). Turning media off in a deployment is a values override; turning it off in the SHIPPED defaults is a change this gate exists to surface"
[ "${default_profile}" != "${sentinel_profile}" ] ||
  fail "chart values ship the unresolved-storage sentinel profile beside an enabled media boundary"
[ -n "${default_claim}" ] ||
  fail "chart values name no media claim beside an enabled media boundary"
[ "${default_budget}" != "${sentinel_budget}" ] ||
  fail "chart values ship the unmeasured-budget sentinel beside an enabled media boundary"

# The volumes every expectation below shares. The media entries must be
# rendered BESIDE these, never instead of them, and stating the whole list is
# what makes an unreviewed extra mount impossible rather than merely unlikely.
# The panels pair is here because panels.data also defaults on (issue #142);
# scripts/ci/chart-storage-pin.sh owns what those two entries mean.
base_mounts="            - name: tmp
              mountPath: /tmp
            - name: panels-data
              mountPath: ${panels_mount}
              readOnly: true
            - name: panels-state
              mountPath: ${panels_state_mount}
              readOnly: false"
base_volumes="        - name: tmp
          emptyDir:
            medium: Memory
            sizeLimit: 16Mi
        - name: panels-data
          persistentVolumeClaim:
            claimName: ${panels_volume}
            readOnly: true
        - name: panels-state
          persistentVolumeClaim:
            claimName: ${panels_state_volume}
            readOnly: false"
# The disabled direction still renders the panels pair -- only the media
# entries disappear -- so the off-shape expectation is the base lists exactly.
off_mounts="${base_mounts}"
off_volumes="${base_volumes}"

expectation() {
  # $1 annotation, $2 MEDIA_* env JSON, $3 volumeMounts text, $4 volumes text
  python3 -c '
import json, sys
sys.stdout.write(json.dumps({
    "annotation": sys.argv[1],
    "mediaEnv": json.loads(sys.argv[2]),
    "volumeMounts": sys.argv[3].split("\n"),
    "volumes": sys.argv[4].split("\n"),
}))
' "$1" "$2" "$3" "$4"
}

# assert_enabled pins the enabled shape: exactly one media volume beside the
# base list, read-only on BOTH the claim reference and the mount, at the mount
# path MEDIA_ROOT also names, with the measured budget and no other MEDIA_*.
assert_enabled() {
  mount_path="$1"
  claim="$2"
  budget="$3"
  shift 3
  render "$@" | python3 -c "${py_core}" assert-media \
    "$(expectation true \
      "{\"MEDIA_ENABLED\": \"true\", \"MEDIA_ROOT\": \"${mount_path}\", \"MEDIA_MAX_CONCURRENT\": \"${budget}\"}" \
      "${base_mounts}
            - name: media
              mountPath: \"${mount_path}\"
              readOnly: true" \
      "${base_volumes}
        - name: media
          persistentVolumeClaim:
            claimName: \"${claim}\"
            readOnly: true")"
}

# --- (a) the DEFAULT render is the enabled, read-only media boundary ---------
assert_enabled "${default_mount_path}" "${default_claim}" "${default_budget}"
echo "chart-media-pin: (a) the default render carries exactly one media volume, read-only on the claim AND the mount, claim ${default_claim}, mounted at ${default_mount_path}, with MEDIA_ROOT equal to it and MEDIA_MAX_CONCURRENT=${default_budget}"

# --- (b) every incomplete enablement is still refused, by name --------------
# Each row now withholds one fact from the ENABLED defaults by overriding it
# back to its sentinel — the same refusals as before, read from the other
# direction. `enabled: true` is still only representable together with all
# four facts, and no override can reach a half-specified media boundary.
refuse() {
  description="$1"
  expect_name="$2"
  shift 2
  if refusal="$(render "$@" 2>&1)"; then
    fail "${description} rendered instead of failing validation — an incompletely specified enablement must be unrepresentable"
  fi
  case "${refusal}" in
    *"${expect_name}"*) ;;
    *) fail "${description} was refused, but not over ${expect_name}: ${refusal}" ;;
  esac
}

refuse "the enabled defaults with the claim name cleared" claimName \
  --set "media.claimName=${sentinel_claim}"
refuse "the enabled defaults returned to the unresolved-storage sentinel profile" profile \
  --set "media.profile=${sentinel_profile}"
refuse "the enabled defaults with the transfer budget returned to its unmeasured sentinel" maxConcurrent \
  --set "media.maxConcurrent=${sentinel_budget}"
refuse "the enabled defaults with a relative mount path" mountPath \
  --set "media.mountPath=data/media"
refuse "the enabled defaults with a dot-dot mount path" mountPath \
  --set "media.mountPath=/data/../etc"
refuse "the enabled defaults with every fact cleared at once" claimName \
  --set "media.claimName=${sentinel_claim}" \
  --set "media.profile=${sentinel_profile}" \
  --set "media.maxConcurrent=${sentinel_budget}"
echo "chart-media-pin: (b) a cleared claim, the sentinel profile, an unmeasured budget, and a non-absolute mount path are each refused by name"

# --- (c) an explicitly disabled render carries no media at all --------------
# The capability stays reversible by values override, and the OFF shape stays
# rendered and checked rather than only described. MEDIA_ROOT and
# MEDIA_MAX_CONCURRENT must vanish entirely, not merely go empty: cmd/server's
# mediaConfiguration REFUSES TO BOOT when MEDIA_ENABLED is false and either is
# set anyway, so a disabled render that still emitted them would fail closed at
# start-up instead of serving without media.
render --set "media.enabled=false" | python3 -c "${py_core}" assert-media \
  "$(expectation false '{"MEDIA_ENABLED": "false"}' "${off_mounts}" "${off_volumes}")"
echo "chart-media-pin: (c) media.enabled=false renders no media volume, no media mount, and no media environment beyond MEDIA_ENABLED=false"

# --- (d) the mount path is ONE fact, not two that must be kept in step ------
assert_enabled "${probe_mount_path}" "${default_claim}" "${default_budget}" \
  --set "media.mountPath=${probe_mount_path}"
echo "chart-media-pin: (d) overriding the mount path moves the mount and MEDIA_ROOT together"

# --- (e) the claim and the budget are one fact each, too --------------------
# Overriding either must move the render with it. Without this, assertion (a)
# would pass for a template that hardcoded the shipped claim name or budget and
# ignored the values entirely — which is the failure a gate reading its
# expectation from configuration has to rule out.
probe_claim=media-pin-probe-claim
probe_budget=7
[ "${probe_claim}" != "${default_claim}" ] ||
  fail "the probe claim must differ from the default, or assertion (e) proves nothing"
[ "${probe_budget}" != "${default_budget}" ] ||
  fail "the probe budget must differ from the default, or assertion (e) proves nothing"
assert_enabled "${default_mount_path}" "${probe_claim}" "${probe_budget}" \
  --set "media.claimName=${probe_claim}" \
  --set "media.maxConcurrent=${probe_budget}"
echo "chart-media-pin: (e) overriding the claim and the budget moves the volume and MEDIA_MAX_CONCURRENT with them"

echo "chart-media-pin: media renders on by default as exactly one read-only volume, incomplete enablement is unrepresentable, and disabling it renders nothing"
