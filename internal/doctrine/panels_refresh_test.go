// Package doctrine's third repository pin: the live-refresh switch, and the
// property that it can only ever fail closed.
//
// The problem this closes is a gap between a documented control and a
// deployable one. `PANELS_REFRESH` has always gated every background refresh
// loop in internal/panels — unset or `false` starts no goroutine at all, so
// egress is impossible rather than merely unattempted, and any other value
// fails the boot — but the Helm chart rendered only `PORT` and
// `MEDIA_ENABLED`. The switch was therefore unreachable from a deployment: an
// operator could not turn refresh on, and, more quietly, could not read off a
// rendered manifest whether it was on. A control nobody can see the state of
// is not a control (issue #78).
//
// Wiring it up is the moment to pin the direction it fails in, because the
// same edit that makes a switch reachable makes it flippable:
//
//   - the template renders the variable ALWAYS, never inside a conditional, so
//     the deployed state is legible from the manifest rather than inferred
//     from an absence;
//   - the shipped default is off, and the schema REQUIRES the key, so a values
//     file that forgot to decide fails validation instead of letting the
//     origin guess;
//   - the schema types it as a boolean and closes the object, so a typo, a
//     string, or an extra sibling key cannot render.
//
// Unlike media, the value is deliberately not frozen to a single constant:
// enabling refresh is an operational decision the operator is allowed to
// express, and it additionally needs credentials and an egress allowance that
// this repository does not grant (issue #79). Freezing it would move that
// decision into code, which is the opposite of what the fail-closed doctrine
// asks for — the doctrine asks that the OFF state be the one you get by
// default, by omission, and by mistake.
//
// The Go module is standard-library only, so these are text pins over the
// chart and code sources rather than a YAML or JSON unmarshal, exactly like
// the release-identity pins beside them.
package doctrine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// panelsRefreshEnv is the one variable name the whole contract turns on. It is
// stated once here and every assertion below derives from it.
const panelsRefreshEnv = "PANELS_REFRESH"

// readRepoFile reads a repository source outside chart/, with the same
// build-context capability boundary readChartFile applies: a reduced context
// that carries no such tree skips by name, while a full checkout — every pull
// request, every local gate — enforces every assertion.
func readRepoFile(t *testing.T, parts ...string) string {
	t.Helper()
	root := filepath.Join(append([]string{"..", ".."}, parts[0])...)
	if _, statErr := os.Stat(root); os.IsNotExist(statErr) {
		t.Skipf("%s absent from this build context; the full-checkout gate enforces this pin", parts[0])
	}
	path := filepath.Join(append([]string{"..", ".."}, parts...)...)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(raw)
}

// TestChartRendersTheRefreshSwitchUnconditionally is the reachability half:
// the variable must appear in the rendered Pod every time, bound to the value,
// and never wrapped in a conditional that would emit it only when it is on.
func TestChartRendersTheRefreshSwitchUnconditionally(t *testing.T) {
	deployment := readChartFile(t, "templates", "deployment.yaml")
	name := "- name: " + panelsRefreshEnv
	at := strings.Index(deployment, name)
	if at < 0 {
		t.Fatalf(
			"chart/templates/deployment.yaml renders no %s: the switch that gates every "+
				"background refresh loop is then unreachable from a deployment, which is "+
				"the exact defect this pin exists to prevent",
			panelsRefreshEnv,
		)
	}
	const binding = "value: {{ .Values.panels.refresh.enabled | quote }}"
	if !strings.Contains(deployment[at:], binding) {
		t.Errorf(
			"the %s entry must be bound to %s; a hardcoded literal would make the "+
				"values file and the schema decorative",
			panelsRefreshEnv, binding,
		)
	}
	// The conditional check: everything from the env block's start to the
	// variable must contain no template `if`, so the entry cannot become one
	// that renders only in the enabled case. An absent variable and a false one
	// reach the process identically today — which is precisely why a manifest
	// that omits it costs an operator the ability to read the deployed state.
	envAt := strings.Index(deployment, "env:")
	if envAt < 0 || envAt > at {
		t.Fatal("chart/templates/deployment.yaml has no env block before the refresh switch")
	}
	if strings.Contains(deployment[envAt:at], "{{ if") || strings.Contains(deployment[envAt:at], "{{- if") {
		t.Errorf(
			"%s must render unconditionally: a switch emitted only when it is on cannot "+
				"be read off the manifest when it is off",
			panelsRefreshEnv,
		)
	}
}

// TestRefreshDefaultsOffAndTheSchemaRefusesAnUndecidedValuesFile is the
// fail-closed half. Each required fragment is asserted separately so a failure
// names the exact guard that went missing.
func TestRefreshDefaultsOffAndTheSchemaRefusesAnUndecidedValuesFile(t *testing.T) {
	values := readChartFile(t, "values.yaml")
	if !strings.Contains(values, "panels:\n  refresh:\n    enabled: false\n") {
		t.Errorf(
			"chart/values.yaml must ship panels.refresh.enabled: false — off is the state " +
				"an operator gets by default, and turning it on needs credentials and an " +
				"egress allowance this repository does not grant",
		)
	}
	schema := readChartFile(t, "values.schema.json")
	for name, required := range map[string]string{
		"the top-level block is required":     `"required": ["replicaCount", "deploymentReady", "image", "service", "ingress", "media", "panels", "resources"]`,
		"the refresh object is required":      `"required": ["refresh"]`,
		"the decision itself is required":     `"required": ["enabled"]`,
		"it is a boolean, not free text":      `"type": "boolean"`,
		"and the default it documents is off": `"default": false`,
	} {
		if !strings.Contains(schema, required) {
			t.Errorf(
				"chart/values.schema.json must contain %s (%s): an override supplies this "+
					"value in the cluster, so the schema is where an undecided, misspelled, "+
					"or non-boolean switch is refused before Helm ever renders",
				required, name,
			)
		}
	}
	// Closed objects: an extra sibling key next to `enabled` would be a second
	// switch nobody reads, and the top-level block is closed for the same
	// reason every other block in this schema is.
	if strings.Count(schema, `"additionalProperties": false`) < 6 {
		t.Error("every object in chart/values.schema.json must stay closed; the panels block is not an exception")
	}
}

// TestTheProcessStillRefusesAnythingButTrueOrFalse guards the far end of the
// same contract: the chart can now deliver any string, so the boot-time parser
// must keep refusing everything that is not an explicit decision. A switch
// that silently treated an unrecognized value as "off" would be friendlier and
// strictly worse — the operator who typed `True` would believe refresh was on.
func TestTheProcessStillRefusesAnythingButTrueOrFalse(t *testing.T) {
	source := readRepoFile(t, "cmd", "server", "main.go")
	for _, required := range []string{
		`case "", "false":`,
		`case "true":`,
		panelsRefreshEnv + " must be true or false",
	} {
		if !strings.Contains(source, required) {
			t.Errorf(
				"cmd/server/main.go must keep %q: an unrecognized value has to fail the "+
					"boot rather than be guessed into the off state",
				required,
			)
		}
	}
}

// TestTheOperatorDocumentationMovesWithTheSwitch keeps README's operator
// section and the chart honest about each other. The security invariants make
// that pairing explicit — "README's 'Enabling live refresh' section is the
// operator-facing copy of this, and both must move together" — and this is
// what turns that sentence into a check.
func TestTheOperatorDocumentationMovesWithTheSwitch(t *testing.T) {
	readme := readRepoFile(t, "README.md")
	for name, required := range map[string]string{
		"the chart value an operator actually sets": "panels.refresh.enabled",
		"the variable it renders":                   panelsRefreshEnv,
		"and the egress half that is still missing": "issue #79",
	} {
		if !strings.Contains(readme, required) {
			t.Errorf(
				"README.md must name %q (%s): the operator section is the copy an operator "+
					"reads instead of the chart, so a switch documented in only one of the "+
					"two is a switch somebody turns on wrong",
				required, name,
			)
		}
	}
}
