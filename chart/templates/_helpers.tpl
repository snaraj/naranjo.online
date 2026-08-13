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
