{{- define "naranjo-online.name" -}}
naranjo-online
{{- end -}}

{{/*
app.kubernetes.io/version is the standard Kubernetes recommended label and
is what makes `kubectl get po -L app.kubernetes.io/version` answer "which
release is running" without anyone resolving a digest by hand. It is DERIVED
from .Chart.AppVersion rather than read from values, so no override can make
the label disagree with the chart that rendered it. It is a label and never a
selector key: the Deployment selector, the Service selector and the
NetworkPolicy podSelector each state their keys literally and are untouched,
which is what keeps this addable to a live Deployment at all (selectors are
immutable).
*/}}
{{- define "naranjo-online.labels" -}}
app.kubernetes.io/name: {{ include "naranjo-online.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end -}}

{{/*
naranjo-online.panelsDataPaths validates the panels-data storage geometry and
is included by BOTH templates that consume it, so a render that would produce
an unsafe geometry produces nothing at all instead (2026-08-24 round-3 review,
findings 3 and 7).

What it refuses, and why each one is a real hazard rather than tidiness:

  * A path that is not absolute, or that does not stay strictly UNDER the
    platform's local-volume root after normalization. `local` volumes are
    admitted by the platform only beneath that root; a path outside it is
    rejected at admission, and a path EQUAL to the root would hand the pod
    the whole storage class.

  * Either root failing to survive normalization unchanged. This is the
    alias hazard: `/mnt/x/data/../state`, `/mnt/x//data`, and
    `/mnt/x/data/` all name directories a string comparison would call
    different from `/mnt/x/data` while the kernel calls them the same. The
    checks below compare NORMALIZED forms, and requiring the authored value
    to already equal its normalized form keeps the values file honest about
    what it binds rather than merely safe by accident.

  * The data root and the state root overlapping in EITHER direction —
    equal, or one an ancestor of the other. The two roots carry opposite
    trust: the data root is the pushed sealed series and is mounted
    read-only everywhere, and the state root is the origin's one writable
    surface. Nesting the writable root inside the read-only one would put
    the origin's own writes inside the projection it must never influence;
    nesting the read-only root inside the WRITABLE one is the same breach
    read the other way, and the previous one-direction check missed it
    entirely.

  * The two container mount paths overlapping the same way, for the same
    reason one level up: a writable mount inside a read-only mount point
    is a writable window into it.

Sprig's `clean` is path.Clean: it collapses duplicate separators, resolves
. and .. lexically, and drops a trailing separator. Comparing cleaned forms
with an explicit trailing separator is what makes the ancestor test exact —
`/mnt/x/panels-data-two` must NOT read as a child of `/mnt/x/panels-data`,
and a bare prefix test says it does.
*/}}
{{- define "naranjo-online.panelsDataPaths" -}}
{{- $data := .Values.panels.data -}}
{{- $root := clean $data.localVolumeRoot -}}
{{- if not (hasPrefix "/" $root) -}}
{{- fail "panels.data.localVolumeRoot must be an absolute path" -}}
{{- end -}}
{{- $pairs := list
  (dict "name" "panels.data.path" "value" $data.path)
  (dict "name" "panels.data.statePath" "value" $data.statePath) -}}
{{- range $pairs -}}
{{- $cleaned := clean .value -}}
{{- if ne $cleaned .value -}}
{{- fail (printf "%s must already be in normalized form (%q normalizes to %q); an alias of a reviewed directory is not the reviewed directory" .name .value $cleaned) -}}
{{- end -}}
{{- if not (hasPrefix (printf "%s/" $root) $cleaned) -}}
{{- fail (printf "%s must live strictly under panels.data.localVolumeRoot (%s)" .name $root) -}}
{{- end -}}
{{- end -}}
{{- $mounts := list
  (dict "name" "panels.data.mountPath" "value" $data.mountPath)
  (dict "name" "panels.data.stateMountPath" "value" $data.stateMountPath) -}}
{{- range $mounts -}}
{{- $cleaned := clean .value -}}
{{- if or (ne $cleaned .value) (not (hasPrefix "/" $cleaned)) -}}
{{- fail (printf "%s must be an absolute path in normalized form (%q)" .name .value) -}}
{{- end -}}
{{- if eq $cleaned "/" -}}
{{- fail (printf "%s must not be the filesystem root" .name) -}}
{{- end -}}
{{- end -}}
{{- $disjoint := list
  (dict "a" "panels.data.path" "av" (clean $data.path) "b" "panels.data.statePath" "bv" (clean $data.statePath))
  (dict "a" "panels.data.mountPath" "av" (clean $data.mountPath) "b" "panels.data.stateMountPath" "bv" (clean $data.stateMountPath)) -}}
{{- range $disjoint -}}
{{- if eq .av .bv -}}
{{- fail (printf "%s and %s must be different directories; the read-only projection and the origin's one writable surface may never be the same place" .a .b) -}}
{{- end -}}
{{- if hasPrefix (printf "%s/" .av) .bv -}}
{{- fail (printf "%s must not sit inside %s; the writable surface may never live within the read-only projection" .b .a) -}}
{{- end -}}
{{- if hasPrefix (printf "%s/" .bv) .av -}}
{{- fail (printf "%s must not sit inside %s; the read-only projection may never live within the writable surface" .a .b) -}}
{{- end -}}
{{- end -}}
{{- if gt (int .Values.replicaCount) 1 -}}
{{- fail "panels.data.enabled requires replicaCount 1: the replay-floor state claim is a single-writer surface (ReadWriteOncePod), and a second replica would either be refused the volume or race the floor marker" -}}
{{- end -}}
{{- end -}}
