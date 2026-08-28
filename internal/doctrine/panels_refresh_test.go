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
//   - the schema REQUIRES the key, so a values file that forgot to decide fails
//     validation instead of letting the origin guess;
//   - the schema types it as a boolean and closes the object, so a typo, a
//     string, or an extra sibling key cannot render.
//
// Unlike media, the value is deliberately not frozen to a single constant:
// enabling refresh is an operational decision the operator is allowed to
// express. Freezing it would move that decision into code, which is the
// opposite of what the fail-closed doctrine asks for.
//
// WHAT THE OWNER CHANGED ON 2026-08-27, AND WHAT THIS FILE PINS NOW. The third
// precondition — an egress allowance for the fetch.json hosts — was the one
// this repository withheld: the chart's NetworkPolicy denied every outbound
// connection, so the shipped default was off and this file pinned it off. The
// owner directed live panel fetches, so the chart now ships the switch ON
// together with an exact two-rule allowance. That retires the old assertion
// ("off is what you get by default, by omission, and by mistake") and replaces
// it with the assertions the new arrangement needs, which are strictly more
// than the old one, because an allowance has more that can go wrong than a
// deny:
//
//   - the switch and the allowance move TOGETHER. Refresh on with no allowance
//     is a no-op that only produces failed attempts; an allowance with refresh
//     off is an opening nothing uses. Either alone is a half-made decision, so
//     both are asserted here and a values file that flips one without the
//     other fails this suite.
//   - the allowance is EXACTLY two bounded rules. An unported rule, a third
//     rule, or a rule list emptied into the allow-everything shapes is refused
//     here as well as by scripts/ci/chart-egress-pin.sh, which renders the
//     chart and runs a 29-mutation battery. The two are deliberate duplicates:
//     that gate lives in the CI chart job, this pin travels with the module
//     and reads the template source itself.
//   - the HOST bound stays in the process. A NetworkPolicy cannot express a
//     host name, so rule 1 leaves the destination open and
//     internal/panels/fetch.go is what confines the five configured hosts —
//     at construction AND again per request. That in-process check was always
//     load-bearing; with the policy no longer denying everything, it is now
//     the ONLY thing bounding where the origin may talk, so this file pins
//     that both halves still exist.
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

// egressAllowance is the exact outbound rule list the chart is meant to render,
// stated here as a constant. It is the same shape scripts/ci/chart-egress-pin.sh
// pins against a real helm render; this copy reads the template source, so the
// two fail independently rather than sharing one point of trust.
const egressAllowance = `  egress:
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
      ports:
        - port: 443
          protocol: TCP
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP
`

// TestRefreshShipsOnTogetherWithItsEgressAllowance is the fail-closed half,
// restated for the arrangement the owner directed on 2026-08-27. The switch
// and the allowance are two halves of ONE decision, so each is asserted
// against the other: flipping either alone fails here, which is what stops a
// values edit from producing a deployment that fetches nothing, or a template
// edit from producing an opening nothing uses.
func TestRefreshShipsOnTogetherWithItsEgressAllowance(t *testing.T) {
	values := readChartFile(t, "values.yaml")
	policy := readChartFile(t, "templates", "network-policy.yaml")

	refreshOn := strings.Contains(values, "panels:\n  refresh:\n    enabled: true\n")
	allowanceRendered := strings.Contains(policy, egressAllowance)
	if refreshOn != allowanceRendered {
		t.Errorf(
			"chart/values.yaml ships panels.refresh.enabled: true = %t while "+
				"chart/templates/network-policy.yaml renders the pinned allowance = %t. "+
				"These are two halves of one owner decision: refresh without the allowance "+
				"only produces failed fetches, and the allowance without refresh is an "+
				"opening nothing uses. Move both or neither",
			refreshOn, allowanceRendered,
		)
	}
	if !refreshOn {
		t.Error(
			"chart/values.yaml must ship panels.refresh.enabled: true — the owner directed " +
				"live panel fetches on 2026-08-27, and this pin is where turning that back " +
				"off becomes a conscious edit rather than a quiet one",
		)
	}

	schema := readChartFile(t, "values.schema.json")
	for name, required := range map[string]string{
		"the top-level block is required":    `"required": ["replicaCount", "deploymentReady", "image", "service", "ingress", "media", "panels", "resources"]`,
		"the refresh object is required":     `"required": ["refresh"]`,
		"the decision itself is required":    `"required": ["enabled"]`,
		"it is a boolean, not free text":     `"type": "boolean"`,
		"and the default it documents is on": `"default": true`,
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

// TestTheEgressAllowanceStaysExactlyTwoBoundedRules pins the shape of the
// opening itself. The allowance replaced a total deny, so the failure mode
// this repository has to keep out is no longer "somebody turned egress on" but
// "somebody widened it" — and NetworkPolicy rules are additive, so a widening
// reads as an addition rather than an edit and looks harmless in a diff.
func TestTheEgressAllowanceStaysExactlyTwoBoundedRules(t *testing.T) {
	policy := readChartFile(t, "templates", "network-policy.yaml")
	if !strings.Contains(policy, egressAllowance) {
		t.Fatal(
			"chart/templates/network-policy.yaml no longer renders the pinned two-rule " +
				"allowance. Changing what the origin may reach is an owner decision: state " +
				"the new rules here and in scripts/ci/chart-egress-pin.sh together, so the " +
				"opening is described in the same commit that makes it",
		)
	}
	// Every rule the template emits must be one of the two pinned ones. Rules
	// are counted by their leading `- to:` at the egress list indentation,
	// which is exactly where a third would appear.
	if got := strings.Count(policy, "\n    - to:"); got != 2 {
		t.Errorf(
			"chart/templates/network-policy.yaml renders %d egress rules; exactly 2 are "+
				"pinned. An extra rule GRANTS what the pinned two withhold, because "+
				"NetworkPolicy allowances are additive",
			got,
		)
	}
	// The shapes that mean "everything", spelled the ways a template can spell
	// them. Each is refused by name so a failure says which one appeared.
	for name, forbidden := range map[string]string{
		"an empty rule, which is the widest rule there is": "egress:\n    - {}",
		"an inline empty rule":                             "egress: [{}]",
		"an empty mapping in place of the rule list":       "egress: {}",
		"an unported peer, which is every port":            "cidr: 0.0.0.0/0\n    - ",
	} {
		if strings.Contains(policy, forbidden) {
			t.Errorf(
				"chart/templates/network-policy.yaml contains %q (%s): the allowance is "+
					"bounded by protocol and port, and a rule without those bounds is not a "+
					"narrower version of it",
				forbidden, name,
			)
		}
	}
	if strings.Contains(policy, "egress: []") {
		t.Error(
			"chart/templates/network-policy.yaml renders the retired total deny. That was " +
				"the contract until 2026-08-27 and returning to it is a decision, not a " +
				"cleanup: with refresh on, it produces a deployment whose every panel fetch " +
				"fails silently into a stale snapshot",
		)
	}
}

// TestTheHostBoundStaysInTheProcess pins the half of the two-layer split that
// the NetworkPolicy structurally cannot carry. Rule 1 above allows TCP/443 to
// any address, because a policy selects Pods, namespaces and CIDRs and can
// never name a host. Which hosts the origin may actually reach is therefore
// decided entirely in internal/panels/fetch.go — and unlike before the
// allowance, there is no longer a blanket deny standing behind it if one of
// these checks is dropped.
func TestTheHostBoundStaysInTheProcess(t *testing.T) {
	fetch := readRepoFile(t, "internal", "panels", "fetch.go")
	for name, required := range map[string]string{
		"the allowlist membership test itself":                   "func hostAllowed(hosts []string, host string) bool {",
		"the admission check every URL goes through":             "func admitURL(parsed *url.URL, hosts []string) error {",
		"the construction-time check over configured endpoints":  "func validateEndpoint(endpoint string, hosts []string) error {",
		"and the per-request re-check, after the URL is rebuilt": "admitURL(parsed, s.config.Hosts)",
	} {
		if !strings.Contains(fetch, required) {
			t.Errorf(
				"internal/panels/fetch.go must keep %q (%s): the chart's egress rule bounds "+
					"protocol and port only, so this is the ONLY place the set of reachable "+
					"hosts is decided. Dropping either the construction check or the "+
					"per-request one leaves a bound that a redirect or a rewritten URL walks "+
					"straight past",
				required, name,
			)
		}
	}
	// The construction path must actually CALL the construction check, not
	// merely define it: a validator nothing invokes is decoration.
	if strings.Count(fetch, "validateEndpoint(") < 2 {
		t.Error(
			"internal/panels/fetch.go defines validateEndpoint but never calls it: a config " +
				"naming an unlisted host must refuse to build, not fail later at request time",
		)
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
		"the chart value an operator actually sets":                                 "panels.refresh.enabled",
		"the variable it renders":                                                   panelsRefreshEnv,
		"where the egress allowance is written":                                     "chart/templates/network-policy.yaml",
		"and where the host bound actually lives, since the policy cannot carry it": "internal/panels/fetch.go",
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
