// Package doctrine's second repository pin: the release identity a deployed
// workload states about itself.
//
// The problem this closes is operational rather than cryptographic. A Pod
// rendered by this chart used to name its image as `repository@sha256:<hex>`
// and carry no version label at all, so `kubectl describe pod` answered "what
// is running" with a content address and an operator holding an incident had
// to resolve a digest by hand to recover the release name.
//
// The fix carries BOTH halves of the identity, and the whole point of pinning
// it here is that the two halves must not drift:
//
//   - the digest stays mandatory, stays in front of nothing, and remains the
//     only thing Kubernetes resolves and the only thing cosign and the
//     platform's admission policies verify (platform safety invariant 6);
//   - the tag is exactly this chart's own release name, so a chart that claims
//     appVersion X can never ship the image tag of release Y. A legible
//     reference that lies is worse than the illegible one it replaced.
//
// The Go module is standard-library only, so these are text pins over the
// chart sources rather than a YAML unmarshal. That is deliberate: the shapes
// asserted are the exact bytes a reviewer reads.
package doctrine

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The published tag carries the conventional `v` prefix (the platform's
// ADR 0014), while Chart.yaml's appVersion is the bare SemVer. One relation,
// stated once, so every assertion below derives from it instead of repeating a
// literal version that would rot at the next release.
func expectedImageTag(appVersion string) string { return "v" + appVersion }

func readChartFile(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "chart"}, parts...)...)
	raw, err := os.ReadFile(path)
	if err != nil {
		// Reduced build contexts do not contain the chart: the image's test
		// stage copies only the module sources and the built frontend assets,
		// so `go test ./...` inside the container has no chart/ to read.
		// Absence is a context capability, NOT a pass — the full-checkout gate
		// runs this file on every pull request and enforces every assertion
		// below. Skipping here and passing here are different outcomes, and
		// only one of them is honest.
		if os.IsNotExist(err) {
			t.Skipf("%s absent from this build context; the full-checkout gate enforces this pin", path)
		}
		t.Fatalf("read %s: %v", path, err)
	}
	return string(raw)
}

// scalar returns the value of the first `key: value` line at any indentation,
// with surrounding quotes removed. Enough for the four scalars pinned here and
// nothing more; a real parser would be a dependency (requirement 9).
func scalar(t *testing.T, text, key string) string {
	t.Helper()
	for _, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, key+":") {
			value := strings.TrimSpace(strings.TrimPrefix(trimmed, key+":"))
			return strings.Trim(value, `"'`)
		}
	}
	t.Fatalf("chart source has no %q line", key)
	return ""
}

func TestChartImageTagIsThisChartsOwnRelease(t *testing.T) {
	appVersion := scalar(t, readChartFile(t, "Chart.yaml"), "appVersion")
	if appVersion == "" {
		t.Fatal("Chart.yaml appVersion is empty")
	}
	tag := scalar(t, readChartFile(t, "values.yaml"), "tag")
	if want := expectedImageTag(appVersion); tag != want {
		t.Errorf(
			"chart/values.yaml image.tag is %q but appVersion %q means the "+
				"published release is %q; the rendered reference is what an "+
				"operator reads in `kubectl describe pod`, so a chart that "+
				"claims one release and ships another release's tag makes that "+
				"reading confidently wrong",
			tag, appVersion, want,
		)
	}
}

func TestRenderedImageReferenceCarriesTheTagAndTheDigest(t *testing.T) {
	deployment := readChartFile(t, "templates", "deployment.yaml")
	const want = `image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}@{{ .Values.image.digest }}"`
	if !strings.Contains(deployment, want) {
		t.Errorf(
			"chart/templates/deployment.yaml must render %s: the tag is "+
				"legibility and the digest is what actually resolves, so "+
				"dropping either one defeats a different half of this contract",
			want,
		)
	}
	// The digest must never become the optional half. This is the assertion
	// that fails if a future edit "simplifies" the reference back to a tag.
	if strings.Contains(deployment, `{{ .Values.image.tag }}"`) {
		t.Error("the rendered reference must not end at the tag; the digest is mandatory")
	}
}

func TestValuesSchemaRequiresBothHalvesAndClosesTheTagGrammar(t *testing.T) {
	schema := readChartFile(t, "values.schema.json")
	for _, required := range []string{
		`"required": ["repository", "tag", "digest", "pullPolicy"]`,
		`"pattern": "^sha256:[0-9a-f]{64}$"`,
		`"pattern": "^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$"`,
	} {
		if !strings.Contains(schema, required) {
			t.Errorf(
				"chart/values.schema.json must contain %s: an override supplies "+
					"these values in the cluster, so the schema is where a "+
					"floating alias like `latest`, a branch name, or a missing "+
					"digest is refused before Helm ever renders",
				required,
			)
		}
	}
}

func TestEveryRenderedObjectCanCarryTheVersionLabel(t *testing.T) {
	helpers := readChartFile(t, "templates", "_helpers.tpl")
	const want = `app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}`
	if !strings.Contains(helpers, want) {
		t.Errorf(
			"chart/templates/_helpers.tpl must emit %s from the shared labels "+
				"helper: it is the standard Kubernetes recommended label and "+
				"the reason `kubectl get po -L app.kubernetes.io/version` can "+
				"answer which release is running",
			want,
		)
	}
	// Derived, never supplied. A values-sourced version label could be
	// overridden to disagree with the chart that rendered it, which is the
	// exact lie this whole contract exists to make unrepresentable.
	if strings.Contains(helpers, "app.kubernetes.io/version: {{ .Values") {
		t.Error("the version label must derive from .Chart.AppVersion, never from values")
	}
}

// Selectors are immutable on a live Deployment, and a Service or NetworkPolicy
// whose selector gained a version key would stop matching Pods across the very
// next release. The label therefore belongs to metadata only, and every
// selector block in this chart states its keys literally so that adding a
// label to the shared helper cannot leak into one by accident.
func TestNoSelectorEverSelectsOnTheVersionLabel(t *testing.T) {
	selectorBlock := regexp.MustCompile(`(?s)(selector|podSelector):\n(?:\s+matchLabels:\n)?((?:\s{4,}\S[^\n]*\n)+)`)
	for _, name := range []string{"deployment.yaml", "service.yaml", "network-policy.yaml"} {
		text := readChartFile(t, "templates", name)
		for _, match := range selectorBlock.FindAllStringSubmatch(text, -1) {
			if strings.Contains(match[2], "app.kubernetes.io/version") {
				t.Errorf(
					"chart/templates/%s selects on app.kubernetes.io/version; "+
						"selectors are immutable and a version-scoped selector "+
						"stops matching at the next release",
					name,
				)
			}
		}
		if strings.Contains(text, `include "`) && strings.Contains(text, "matchLabels:\n    {{- include") {
			t.Errorf("chart/templates/%s builds a selector from the labels helper; selector keys must be literal", name)
		}
	}
}
