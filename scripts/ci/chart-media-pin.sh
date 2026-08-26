#!/usr/bin/env bash
# chart-media-pin — prove the media enablement surface added for issue #207
# stays OFF by default, is unrepresentable when incompletely specified, and
# renders a READ-ONLY volume when it is deliberately turned on.
#
# WHY THIS GATE EXISTS. Before #207 the values schema pinned `media.enabled`
# to the constant `false`, so "media is off" was true because nothing else
# could be written down. That also made the chart unable to DESCRIBE the
# enabled deployment ADR 0012's storage evidence is meant to unlock, so the
# constant had to go. What replaces it must not be weaker, and "the default
# happens to be false" is not the same promise: the constant made an enabled
# render impossible, while a default makes it merely unrequested. This gate is
# what carries the difference, and it pins three separate properties:
#
#   1. the DEFAULT render carries no media volume, no media mount, and no
#      media environment beyond the honest MEDIA_ENABLED="false" — so the
#      process has no media capability at all rather than an unused one;
#   2. every INCOMPLETE enablement is refused by schema validation, BY NAME —
#      an unnamed claim, the unresolved-storage sentinel profile, and an
#      unmeasured transfer budget each fail on their own, so `enabled: true`
#      is only ever representable together with the facts that make it real;
#   3. the ENABLED render mounts exactly one extra volume, read-only on both
#      the volume and the mount, at the same path MEDIA_ROOT names.
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
#     the exact expected text. Those two lists are entirely within this gate's
#     subject, and whole-block equality is what makes a second mount — writable
#     or otherwise — impossible to add unseen.
#
# The parser is stdlib Python (this repository is stdlib-only): no PyYAML, no
# yq, so it runs anywhere helm does. It fails closed — anything it cannot read
# is refused with the offending text named, never guessed at.
#
# Expectations that are configuration come from chart/values.yaml (the mount
# path, the service port); expectations that are DOCTRINE (read-only, exactly
# one extra volume, the exact MEDIA_* inventory) are constants here, because a
# gate that reads its expectation out of the thing it checks passes for
# anything that thing renders.
set -euo pipefail

chart_dir="${CHART_DIR:-chart}"
kube_version="${KUBE_VERSION:-v1.36.0}"
release_name=media-pin
values_file="${chart_dir}/values.yaml"

# Probe enablement values. None of these is a recommendation and none is a
# default: they exist only so this gate can render the enabled shape. The
# claim name is deliberately not a name any environment uses, the budget is an
# arbitrary in-range integer, and the profile is the one real profile the
# schema admits.
probe_profile=pi-local-static
probe_claim=media-pin-probe-claim
probe_budget=7
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


def cmd_read_values(path):
    with open(path) as fh:
        lines = fh.read().split("\n")
    media = block_scalars(lines, "media")
    svc = block_scalars(lines, "service")
    if not media.get("mountPath"):
        die("chart values declare no media.mountPath")
    if not svc.get("port"):
        die("chart values declare no service.port")
    sys.stdout.write(media["mountPath"] + "\n" + svc["port"] + "\n")


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
    """A block sequence of `- name: X` / `  value: Y` items, as a list."""
    items = []
    for line in block:
        stripped = line.strip()
        if indent_of(line) == indent and stripped.startswith("- "):
            items.append({})
            stripped = stripped[2:]
        elif indent_of(line) == indent + 2:
            if not items:
                die("env value before any env item: %r" % line)
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
  IFS= read -r default_mount_path
  IFS= read -r service_port
} <<EOF
${readvals}
EOF

[ -n "${default_mount_path}" ] || fail "chart values declare no media.mountPath"
[ -n "${service_port}" ] || fail "chart values declare no service.port"
[ "${default_mount_path}" != "${probe_mount_path}" ] ||
  fail "the probe mount path must differ from the default, or assertion (d) proves nothing"

# The tmp volume and its mount are shared by every expectation below: they are
# what the media entries must be rendered BESIDE, never instead of.
tmp_mount='            - name: tmp
              mountPath: /tmp'
tmp_volume='        - name: tmp
          emptyDir:
            medium: Memory
            sizeLimit: 16Mi'

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

# --- (a) the default render carries no media capability at all --------------
render | python3 -c "${py_core}" assert-media \
  "$(expectation false '{"MEDIA_ENABLED": "false"}' "${tmp_mount}" "${tmp_volume}")"
echo "chart-media-pin: (a) the default render has no media volume, no media mount, and no media environment beyond MEDIA_ENABLED=false"

# --- (b) every incomplete enablement is refused, by name --------------------
# Each row is one fact withheld from an otherwise complete enablement, and the
# string the refusal must name. `enabled: true` alone must never be enough.
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

refuse "media.enabled=true with the shipped defaults" claimName \
  --set "media.enabled=true"
refuse "media.enabled=true with no claim name" claimName \
  --set "media.enabled=true" --set "media.profile=${probe_profile}" \
  --set "media.maxConcurrent=${probe_budget}"
refuse "media.enabled=true carrying the unresolved-storage sentinel profile" profile \
  --set "media.enabled=true" --set "media.claimName=${probe_claim}" \
  --set "media.maxConcurrent=${probe_budget}"
refuse "media.enabled=true with no measured transfer budget" maxConcurrent \
  --set "media.enabled=true" --set "media.profile=${probe_profile}" \
  --set "media.claimName=${probe_claim}"
refuse "media.enabled=true with a relative mount path" mountPath \
  --set "media.enabled=true" --set "media.profile=${probe_profile}" \
  --set "media.claimName=${probe_claim}" \
  --set "media.maxConcurrent=${probe_budget}" \
  --set "media.mountPath=data/media"
refuse "media.enabled=true with a dot-dot mount path" mountPath \
  --set "media.enabled=true" --set "media.profile=${probe_profile}" \
  --set "media.claimName=${probe_claim}" \
  --set "media.maxConcurrent=${probe_budget}" \
  --set "media.mountPath=/data/../etc"
echo "chart-media-pin: (b) an unnamed claim, the sentinel profile, an unmeasured budget, and a non-absolute mount path are each refused by name"

# --- (c) the enabled render mounts exactly one read-only volume -------------
enabled_flags=(
  --set "media.enabled=true"
  --set "media.profile=${probe_profile}"
  --set "media.claimName=${probe_claim}"
  --set "media.maxConcurrent=${probe_budget}"
)

assert_enabled() {
  mount_path="$1"
  shift
  render "${enabled_flags[@]}" "$@" | python3 -c "${py_core}" assert-media \
    "$(expectation true \
      "{\"MEDIA_ENABLED\": \"true\", \"MEDIA_ROOT\": \"${mount_path}\", \"MEDIA_MAX_CONCURRENT\": \"${probe_budget}\"}" \
      "${tmp_mount}
            - name: media
              mountPath: \"${mount_path}\"
              readOnly: true" \
      "${tmp_volume}
        - name: media
          persistentVolumeClaim:
            claimName: \"${probe_claim}\"
            readOnly: true")"
}

assert_enabled "${default_mount_path}"
echo "chart-media-pin: (c) the enabled render adds exactly one volume, read-only on the claim AND the mount, with MEDIA_ROOT at ${default_mount_path}"

# --- (d) the mount path is ONE fact, not two that must be kept in step ------
assert_enabled "${probe_mount_path}" --set "media.mountPath=${probe_mount_path}"
echo "chart-media-pin: (d) overriding the mount path moves the mount and MEDIA_ROOT together"

echo "chart-media-pin: media stays off by default, incomplete enablement is unrepresentable, and enablement is read-only"
