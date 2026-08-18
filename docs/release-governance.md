# Release-control readiness receipt

Every protected-`main` integration must remain able to publish one release,
including a one-commit squash and a multi-commit linear rebase. Repository code
validates either topology, but code on a pull-request branch cannot make its own
checks mandatory, require the branch to contain the latest protected base, or
make a GitHub Release immutable. Those are server controls and are therefore a
separate readiness boundary.

The automatic-release pull request must remain Draft until the repository owner
has configured and observed all of these controls:

- GitHub immutable releases enabled before the first affected Release is
  published. Enabling the control later does not retrofit a release that was
  already published.
- Exactly squash and rebase enabled and merge commits disabled in the active
  `Protect-Main` ruleset. That ruleset is what enforces merge behaviour on
  `refs/heads/main`, so it is the receipt's authoritative `merge_methods`
  source. The repository-settings merge toggles stay an owner-configured
  expectation the receipt deliberately does not read: GitHub returns them only
  to credentials carrying Contents write, and the publisher's settings token
  holds Administration read alone.
- Pull requests and linear history required on `main`; zero platform approvals,
  no stale-review dismissal, no required reviewers/code-owner/latest-push
  approval, resolved review threads required, and only squash/rebase allowed.
- Signed commits required on `main`.
- Every required PR and CodeQL job bound to the GitHub Actions integration,
  with strict current-branch testing enabled.
- Creation, force pushes, and deletion denied.
- No ruleset bypass actor and no `update` restriction that would require the
  repository owner to bypass the rules merely to merge a passing pull request.
  The `update` half is CI-proven; the bypass half is owner-verified with the
  standalone command below, because GitHub returns `bypass_actors` only to a
  credential with write access to the ruleset. See "Which side proves which
  invariant" below.
- Actions enabled with full-SHA pinning required, default workflow-token
  permissions read-only, and workflow tokens unable to approve pull requests.
- Private Vulnerability Reporting, secret scanning, and push protection
  enabled. Non-provider-pattern and validity scanning are recorded as booleans
  rather than overstated as mandatory controls.
- Exact CodeQL merge protection (`high_or_higher` security alerts and `errors`
  analysis alerts), Code Quality `errors`, and Code Coverage minimum 80 with no
  maximum-drop threshold. These preview rules are retained, not silently
  discarded to fit a narrower API.

The repository owner remains the only person who chooses squash or rebase and
performs the merge. The settings receipt grants no merge authority.

## Publication authority

The successful-main orchestrator dispatches `release-publisher.yml` on
protected `main` and passes both the exact source SHA and the authoritative
completed PR-gate run ID. It creates no tag, registry object, Release, or other
publication state. The publisher first runs an unprivileged authorization job
with only Actions/content read access. That job
GETs the run by ID and requires the exact repository and head repository,
workflow name and path, `push` event, completed/success state, `main` branch,
and source SHA. It also GETs the exact run's complete job inventory and requires
exactly successful `application`, `chart`, `container`, `coverage-badges`, and
`security` jobs plus the context-appropriate skipped `dependency-review` job.
Workflow-level success alone is insufficient. In the same bounded authorization
window it resolves the separate `codeql.yml` `push` run for that exact source
SHA, then requires exactly the two completed/success matrix jobs `analyze (go,
manual)` and `analyze (javascript-typescript, none)`. Missing, duplicate,
foreign, skipped, failed, cancelled, wrong-SHA, or still-pending records fail
closed before publication authority exists.

Before any tag, registry, or Release side effect, a separate
`immutable_settings` job enters the `platform-release` environment. The
environment must use custom selected-branch policy exactly `main`, never the
broader protected-branches mode. The job mints one short-lived repository-only
GitHub App token from environment variable `PLATFORM_RELEASE_APP_ID` and
environment secret `PLATFORM_RELEASE_APP_PRIVATE_KEY`, with Administration
read as its only requested permission. The action masks and revokes the token;
only the one authoritative GET-only settings-preflight step receives it, named
`IMMUTABLE_SETTINGS_TOKEN`. That step reads the repository, immutable/PVR,
Actions/workflow, security, and complete ruleset endpoints below. No output
carries it into the separate publisher job. That publisher depends on both
read-only jobs, uses only its ordinary
short-lived `GITHUB_TOKEN` for contents/packages/OIDC publication, and cannot
start when the settings GET is denied, malformed, or disabled.

That publisher's first source-bound check also requires the explicit production
identity tuple `snaraj/naranjo.online`, `ghcr.io/snaraj/naranjo-online`, and
`ghcr.io/snaraj/charts/naranjo-online`. The dotted GitHub repository name is
never reused or heuristically rewritten as a registry package name. A missing,
dotted, foreign, or otherwise changed package input fails before annotated-tag
or registry publication begins.

Owner-observed state on 2026-08-14 proves that `platform-release` exists with
`protected_branches: false`, `custom_branch_policies: true`, and exactly one
branch policy `{name: main, type: branch}`. It currently has zero variables and
zero secrets, so App-backed publication remains technically blocked until the
owner provisions those two frozen names. This repository contains no
credential value and grants no authority to provision one.

The same owner-observed transaction proves immutable releases enabled, Actions
full-SHA pinning enabled, Actions otherwise enabled/allowed-all unchanged, and
Private Vulnerability Reporting enabled. Those closed controls do not override
the missing App names; the PR remains Draft.

That same 2026-08-14 transaction recorded the `Protect-Main` ruleset as
inexact on five counts: a bypass actor, an update restriction, merge commits in
its pull-request rule, unresolved threads allowed, and no required-status-check
rule. GitHub's public REST and GraphQL mutation schemas cannot represent the
existing preview Code Quality and Code Coverage inputs, so an API update was
rejected before mutation and preserving those controls while correcting the
ruleset took a signed-in owner UI transaction. That transaction has since
happened. Owner-observed GET-only state on 2026-08-18 refutes all five clauses:
the full preflight below returns `exact`, the bypass check below returns `[]`,
and the live `rules[]` carries required status checks, pull request, linear
history, signatures, code scanning, code quality, code coverage, creation,
deletion, and non-fast-forward. The ruleset is no longer the open blocker; the
`platform-release` variables and secrets above are still unprovisioned, and
that gap remains an external Ready blocker.

`workflow_dispatch` remains callable through GitHub's normal interfaces, but
callability is not publication authority: an unmerged branch, pull-request
run, foreign workflow or repository, failed or incomplete run, stale SHA, and
mismatched run ID all fail before a privileged job starts. The protected-main
workflow identity signs the resulting artifacts; the annotated tag and every
artifact statement independently bind the authorized source SHA.

The publisher verifies the complete annotated-tag REST identity before
artifact work, but GitHub does not lock that tag until its Release becomes
immutable. PR/main CI scans source dependencies, explicitly including frontend
development dependencies, and the publisher scans the final image digest with
direct checksum-verified Trivy v0.72.0, severity set exactly `HIGH,CRITICAL`,
`ignore-unfixed=false`. After registry publication or exact reuse and immediately
before manifest construction, the publisher re-fetches image alias `vX.Y.Z` and
chart alias `X.Y.Z`; each response body digest, registry digest header, and the
produced/reused expected digest must be identical. It then reads the raw OCI
attestation carriers and SPDX in-toto statements for exactly `linux/amd64` and
`linux/arm64`, rejecting null, malformed, duplicate, extra, foreign-platform,
or foreign-subject payloads. The deterministic JSON
manifest binds the source SHA, successful-main run ID, version/tag, exact
image/chart repositories, semantic aliases and digests, two-platform signer
and provenance contract, and both scan policies/results.

New publication creates a draft Release with exactly that one manifest asset,
requires the closed REST asset metadata/digest, downloads and compares the
bytes, and only then publishes the draft. Every observed draft, retry winner,
and immutable Release must identify `github-actions[bot]` with numeric ID
`41898282` as its author; every staged or published manifest asset must identify
that same login and ID as its sole uploader. Missing, null, or foreign writers
fail closed. An exact zero-asset `prepared` draft
is the sole recoverable response-loss state: the publisher uploads without
clobber, re-reads the one-asset `staged` state, and continues. Existing,
response-lost, and concurrent-winner paths may resume only from those exact
states. The terminal step
re-fetches the authoritative `immutable: true` Release, revalidates the closed
one-asset inventory, downloads and compares the manifest again, and then
re-fetches both live tag records. It binds ref type/object SHA, tag, source
commit, message, tagger identity, and tagger instant to the signed source one
last time. No mutation follows. A moved, lightweight, missing, foreign,
malformed, response-lost, or byte-mismatched record fails closed even if the
immutable Release has already exposed the race.

`release-audit.yml` runs weekly and manually with contents/packages read only.
For the latest Release it repeats the exact Release/manifest/successful-run/tag
bindings; resolves image `vX.Y.Z` and chart `X.Y.Z` aliases and requires the
manifest digests; verifies both Cosign identities, the exact two-platform SLSA
and strict raw SBOM set, the chart archive against the release source tree, and
the final image vulnerability policy including development dependencies. This
scheduled detection is defense in depth, never a substitute for the post-push
pre-manifest alias/SBOM proof. It has no settings App token, OIDC, or publication
method.

## Read-only authoritative preflight

The preflight uses `gh api --method GET` only, with GitHub REST API version
`2026-03-10`. It reads repository/security-analysis settings, immutable-release
and `/private-vulnerability-reporting` settings, Actions policy, default
workflow permissions, the exhaustive ruleset inventory, and the one active
repository-owned `Protect-Main` ruleset.
It does not create, update, or delete a setting, ref, Release, package, or other
resource. An authentication or schema error is a denial.

Run it only after the repository owner has made the required settings change in
GitHub. Keep the value-only receipt outside the repository and remove it after
recording the result on the pull request:

```bash
receipt="$(mktemp)"
trap 'rm -f -- "${receipt}"' EXIT
python3 -I -B scripts/ci/release_contract.py settings-preflight \
  --repository snaraj/naranjo.online > "${receipt}"
python3 -I -B scripts/ci/release_contract.py settings-receipt \
  --receipt "${receipt}" --repository snaraj/naranjo.online
sha256sum "${receipt}"
```

The first command emits no receipt unless every live value is exact. The second
command revalidates the closed schema offline. Post the canonical receipt and
its digest as the bounded observation; never post API tokens, actor IDs, or a
raw ruleset response.

The exact successful receipt is:

```json
{
  "actions_allowed_actions": "all",
  "actions_can_approve_pull_request_reviews": false,
  "actions_enabled": true,
  "actions_sha_pinning_required": true,
  "allow_deletions": false,
  "allow_force_pushes": false,
  "branch": "main",
  "code_quality_severity": "errors",
  "code_scanning_tools": [
    {
      "alerts_threshold": "errors",
      "security_alerts_threshold": "high_or_higher",
      "tool": "CodeQL"
    }
  ],
  "default_workflow_permissions": "read",
  "dismiss_stale_reviews_on_push": false,
  "immutable_releases": true,
  "maximum_code_coverage_drop": null,
  "merge_methods": ["rebase", "squash"],
  "minimum_code_coverage": 80,
  "private_vulnerability_reporting": true,
  "repository": "snaraj/naranjo.online",
  "require_code_owner_review": false,
  "require_last_push_approval": false,
  "require_linear_history": true,
  "require_pull_request": true,
  "required_approving_review_count": 0,
  "required_review_thread_resolution": true,
  "required_reviewers": [],
  "require_signed_commits": true,
  "required_status_checks": [
    {"context": "analyze (go, manual)", "integration_id": 15368},
    {"context": "analyze (javascript-typescript, none)", "integration_id": 15368},
    {"context": "application", "integration_id": 15368},
    {"context": "chart", "integration_id": 15368},
    {"context": "container", "integration_id": 15368},
    {"context": "dependency-review", "integration_id": 15368},
    {"context": "security", "integration_id": 15368}
  ],
  "restrict_creations": true,
  "restrict_updates": false,
  "secret_scanning": true,
  "secret_scanning_non_provider_patterns": false,
  "secret_scanning_push_protection": true,
  "secret_scanning_validity_checks": false,
  "strict_status_checks": true
}
```

Missing, extra, duplicated, name-only, foreign-integration, inverted, or stale
state fails closed. A successful receipt is necessary but not sufficient for
Ready: exact-head CI, current base, resolved findings, and a fresh independent
approval are still required.

### Which side proves which invariant

The receipt above is built by the same code on both sides, but the two sides
run it under different credentials, and GitHub does not show both credentials
the same fields. The split is therefore recorded rather than blurred, and the
preflight makes no conditional assertion: it asserts exactly what the enforcing
surface exposes to the credential in hand.

**CI-proven** (asserted by the release publisher's `settings-preflight` step on
every dispatch, under an Administration-read App token): repository identity and
default branch; immutable releases; private vulnerability reporting; secret
scanning, push protection, non-provider-pattern and validity states; Actions
enablement, allow policy and full-SHA pinning; default workflow permissions and
workflow-token approval; the `Protect-Main` ruleset's identity, source,
enforcement and `refs/heads/main`-only condition; and every field of its
`rules[]` — required pull request and its exact parameters (including
`allowed_merge_methods`, the authoritative merge-method source), required status
checks and their GitHub-Actions integration binding, linear history, signatures,
creation/deletion/non-fast-forward restrictions, and the CodeQL/code-quality/
code-coverage rules.

**Owner-verified** (asserted only by the repository owner, GET-only, under
their own credential, with the standalone command below): that `Protect-Main`
has no bypass actor. GitHub's REST reference for "Get a repository ruleset"
states that "to prevent leaking sensitive information, the bypass_actors
property is only returned if the user making the API request
has write access to the ruleset." The publisher's least-privilege token
carries no such write access, so the property is absent from its response;
asserting it in CI made the receipt unbuildable and denied every release
before `rules[]` was read at all.

The receipt therefore carries no bypass field — and the deletion is
credential-independent, so the preflight above reads the property for nobody.
Re-running that preflight under the owner credential proves nothing about
bypass actors. The owner runs this instead, resolving the ruleset id in the
same block:

```bash
ruleset_id="$(gh api --method GET -H "X-GitHub-Api-Version: 2026-03-10" \
  /repos/snaraj/naranjo.online/rulesets \
  --jq '.[] | select(.name == "Protect-Main") | .id')"
gh api --method GET -H "X-GitHub-Api-Version: 2026-03-10" \
  "/repos/snaraj/naranjo.online/rulesets/${ruleset_id}" --jq '.bypass_actors'
# must print: []
```

The property is returned only at ruleset write-access-level visibility, which
the owner credential has and the publisher's does not, per the redaction rule
quoted above. The command prints the value rather than a count because a
redacted property reads as `null` here, and `length` would reduce that same
`null` to the `0` an empty list gives — a count cannot tell "no bypass actor"
from "you cannot see bypass actors". Exactly `[]` passes. `null` means the
credential lacks that visibility and the check has not been performed. Any
other output is a bypass actor: the owner clears it before Ready and posts only
the `[]` result, never the actor entries, per the value-only rule above. This
is the observation "Working a change end to end" step 8 requires; CI cannot
make it and will not pretend to.

The separate Main Worker gate in `AGENTS.md` is also load-bearing for Ready.
After the final author push and exact-head adversarial approval, the distinct
Main Worker posts one normal PR comment bound to the same head in this exact
shape:

```text
HEAD: <40-lowercase-hex>
ROLE: MAIN-WORKER
VERDICT: PASS
SCOPE: architecture,merge-order,authority,settings,base-freshness,required-checks

- <distinct context> (Main Worker)
```

That bounded receipt covers architecture, merge order, authority, settings,
base freshness, and required checks; it is not another implementation review
or merge authorization. A later push invalidates both exact-head receipts.
The coordinator alone changes the Draft/Ready state, and the repository owner
alone merges.

GitHub documents the immutable-release control and its protected tag/asset
behavior in [Immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases),
and documents strict required checks in the
[repository rulesets REST contract](https://docs.github.com/en/rest/repos/rules).

- 5.6 Sol
