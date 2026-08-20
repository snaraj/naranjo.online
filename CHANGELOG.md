# Changelog

All notable changes to naranjo.online. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `VERSION`, chart
metadata, these headings, and Helm's strict OCI chart tag use numeric SemVer.
Git, image, and GitHub Release tags use the exact plain `vX.Y.Z` form.

## [Unreleased]

## [0.1.19] - 2026-08-20

### Added

- The boss-log panel becomes **Old School RuneScape Stats**: a skills grid of
  every level the hiscores report sits above the boss tallies, and the tally
  region claims the rest of the rail and scrolls inside itself. `boss-log/v1`
  gains an optional `skills` section (name, level, rank, xp, every figure
  nullable) — additive inside the same kind version, so a payload written
  before it existed still decodes. The panel id, kind, and URL are unchanged:
  they are public identity, and a heading is not.
- The complete icon set the panel always needed: **71 boss icons and 25 skill
  icons, 410,125 bytes**, all downscaled Old School RuneScape Wiki thumbnails
  shipped as files (`assetsInlineLimit: 0`). Sixty-five of the boss icons and
  the whole skills directory are new; the frontend pin that had to run
  one-directionally while sixty-five bosses rendered letter chips now runs in
  BOTH directions again — every served row has an icon, and every icon
  belongs to a served row. `ATTRIBUTION.md` records the batch, its byte
  count, the exact wiki file behind each row that does not name its own, and
  keeps the Jagex Fan Content Policy notice byte for byte.
- A force-refresh control replaces the `stale · 8d ago` badge in every panel
  header. `watchPanel` now returns a callable that also carries `refresh()`:
  a forced read is single-flight against the periodic one — a second press
  joins the request in flight instead of stacking behind it — and resolves
  only when that read lands, so the control is busy for exactly as long as
  the origin is. No honesty left with the badge: the status still drives a
  dot whose shape differs per state, and the full reading rides the button's
  accessible name and its tooltip.

### Changed

- Live refresh is reachable from a deployment for the first time.
  `chart/templates/deployment.yaml` renders `PANELS_REFRESH` from a new
  `panels.refresh.enabled` value — **unconditionally**, so the deployed state
  is readable off the manifest — defaulting to `false` and required by
  `chart/values.schema.json`, so a values file that omits the decision fails
  validation instead of letting the origin guess. Nothing is enabled
  anywhere: the egress allowance the switch also needs is issue #79.
- The upstream refresh TTL drops from 45 minutes to 5 (`ttlMinutes`), putting
  the origin inside the same 30s–5m freshness band the client poll already
  sat in; the backoff ladder is unchanged and is now pinned to stay outside
  that band, so a failing upstream still backs off past the healthy cadence.
- All three panel snapshots that can be regenerated without secrets were
  regenerated from fresh captures taken at cut time: `boss-log.json` (25
  skills, 71 bosses) and `vcs-activity.json` (53 weeks, 499 contributions),
  with their `testdata` captures replaced in the same commit so the
  snapshot-equals-capture pins still close the loop. `token-usage.json` needs
  admin credentials and is unchanged.

### Fixed

- The five confirmed layout collisions between fixed chrome and page content.
  Arbitration is now one ordered `--layer-*` scale in `styles.css` (base <
  activity < rail < menu) instead of three components that had each picked
  `10` or nothing, so the reading-mode control can no longer be buried under
  the side rail. The rail publishes its open state on the document root and
  the page reserves an inline gutter for it above 60rem; the activity bar
  publishes the strip it covers, bounds itself by that same token so it can
  never outgrow the reserve, and flows in the document below 45rem where a
  fixed bar has nowhere to go.
- Rendering-lane floors (issue #26): `100vh` is gone from `styles.css` in
  favour of `100dvh`, with a frontend pin that refuses the static spelling
  anywhere in the file; the viewport meta opts into `viewport-fit=cover` and
  every fixed element pads itself by the `env(safe-area-inset-*)` values, so
  the rail, the bar, and the reading-mode control all clear a notch and a
  home indicator. The hero gives the activity bar's reserve back, so a page
  with nothing below it is still exactly one viewport tall.

## [0.1.18] - 2026-08-19

### Fixed

- Raw SBOM statement binding pins the in-toto type BuildKit actually
  emits: `SBOM_STATEMENT_TYPE` moves from
  `https://in-toto.io/Statement/v0.1` to `https://in-toto.io/Statement/v1`.
  Proven live by the first v0.1.17 publish attempt (run 32208827873): every
  earlier release attempt died before the SBOM re-bind step, so this pin
  had never met a real BuildKit statement — the fixture built its
  statement FROM the module constant, a self-referential oracle that
  passes under any value. The raw statement fetched from the registry for
  the v0.1.17 image carries `_type: https://in-toto.io/Statement/v1`
  (predicateType, subject purl, platform query, and digest binding all
  already exact). This is the opposite polarity from the cosign-generated
  attestation statement, which correctly remains pinned at v0.1
  (`INTOTO_STATEMENT_TYPE`, the value cosign emits, proven live in the
  same run): two generators, two separate constants, opposite correct
  values. A new literal-pin test
  (`test_sbom_statement_type_literal_is_the_pinned_in_toto_v1_uri`)
  guards the constant against silent reversion — the vacuity the
  self-referential fixture allowed — and the statement-mutant matrix now
  rejects the old `v0.1` value, proving exactness in both directions.
  The weekly release audit shares the same `sbom-statement` subcommand,
  so both the publisher and the audit converge on the real emission.

## [0.1.17] - 2026-08-19

### Fixed

- The release publisher's draft-observe loop could never see its own draft
  (#71): `classify_release`'s by-tag GET (`GET .../releases/tags/${tag}`) is
  documented to return a PUBLISHED release only, so the retry loop after
  `gh release create ... --draft` read a permanent 404 ("absent") and denied
  when `test "${race_verified}" = true` failed — the resumable-draft design
  was unreachable as written. lidersea.com proved this live (run
  32201373323, v0.1.16): the draft's manifest, image, and chart were all
  complete and correctly signed, but the Release object itself was
  stranded `draft: true`. Fixed by keeping the by-tag GET as the first
  probe and, only on its 404, adding a list probe
  (`GET .../releases?per_page=100`) that selects `tag_name == TAG`: exactly
  one match writes that object into the same `existing-release.json` file
  `classify_release` and `verify_asset_bytes` already consume and
  reclassifies through the unchanged `release-state` CLI; zero matches keep
  the original absent classification; more than one is refused (`DENY: ...
  a stranded draft needs operator resolution`, exit 1) rather than guessed
  at, since GitHub only lets multiple Releases share a `tag_name` when none
  of them is the published owner of that ref. `release_contract.py`'s
  `classify_release_state` needed no change: it already classifies
  correctly from either a by-tag or a list-selected object, since GitHub
  returns the same Release shape either way. This repo's own v0.1.16
  publish attempts never reached this step live — they died earlier, first
  on the cosign predicate defect this changelog's 0.1.16 entry fixed, then
  on the trivy defect below — so the fix lands from the shared code shape
  and lidersea's live proof rather than a local reproduction.
- Closes the mutant-proven gap in `WorkflowStructureTests` (#70):
  `require_vulnerability_and_alias_audit`'s `audit_requirements` pinned
  `attestation-statement` for `release-audit.yml` but not the
  `--predicate-output` flag that makes it write the exact object cosign
  signs, so deleting that flag from the audit workflow survived the full
  suite while the identical deletion on the publisher side was already
  caught. The flag is now a pinned literal for both surfaces, with a
  hostile mutant proving the audit-side deletion goes red.
- The release publisher's and recurring audit's final-image vulnerability
  gate had never executed (#73): both `trivy image --scanners vuln
  --include-dev-deps ...` invocations FATAL on the installed trivy
  (`unknown flag: --include-dev-deps` — a source/lockfile concept `trivy
  fs` understands, not one `trivy image` accepts), proven directly by this
  repo's own v0.1.16 publish attempt (run 32203707053, step "Reject high or
  critical vulnerabilities in the final image digest"). Because the step
  ordering signs before scanning (#69), this left ghcr.io holding
  signed-but-never-scanned images at v0.1.15 and v0.1.16. Fixed by dropping
  the flag from both `trivy image` call sites (`release-publisher.yml`,
  `release-audit.yml`); `pr-gate.yml`'s `trivy fs --include-dev-deps` source
  scan is unaffected — the flag is valid there and unimplicated by the
  failure. `WorkflowStructureTests` now pins the flag-free invocation on
  both surfaces and explicitly forbids `--include-dev-deps` from
  reappearing on either `trivy image` line; the two hostile mutants that
  previously asserted the opposite (that removing the flag was the
  regression) are replaced with mutants proving reintroducing it is
  caught.
- Chart rollout strategy swaps pods in place instead of surging (#72): the
  namespace quota (`pods: 2`, `limits.memory: 256Mi`) leaves no room for a
  third pod once `replicaCount` is at its default/maximum of 2, so
  `maxSurge: 1` could never schedule its new pod — cluster-proven during
  the lidersea.com v0.1.16 deploy, where the controller filled the quota by
  scaling the OLD ReplicaSet to 2 first (holding the `maxUnavailable: 0`
  floor) and wedged the rollout permanently. `maxSurge: 0` /
  `maxUnavailable: 1` is now the only rolling path at 2 replicas, and works
  cleanly at 1 too. No existing test or pin in this repository asserted
  the old strategy values (verified by a full-repository grep for
  `maxSurge`/`maxUnavailable`/`rollingUpdate`); `helm lint` and a rendered
  `helm template` grep are this change's evidence.
- `replicaCount` accepts 1..2 instead of a fixed `const: 2` (owner
  directive 2026-08-19, mirroring lidersea.com commit `bab253b`):
  workloads should not be scale-rigid, and the cluster doubles as the dev
  environment, so the schema now expresses the namespace quota's real
  budget (`minimum: 1`, `maximum: 2`) rather than a single fixed shape.
  Default stays 2 for availability; `chart/values.yaml` carries the same
  head comment as lidersea.com explaining the range. `maxSurge: 0` /
  `maxUnavailable: 1` above roll cleanly at either value. Verified:
  `helm template` renders at `replicaCount=1` and the unset default
  (`2`); `replicaCount=3` is rejected by schema validation.

## [0.1.16] - 2026-08-18

### Fixed

- The release publisher's "Attach the BuildKit SLSA provenance as cosign
  attestations" step could not pass either: run 32195803008 advanced past
  0.1.15's settings fix, signed the image
  (`sha256:2fe2171286418d0be4f0ad36ac792e9f0edc2dce5922442a8afdc5605fbc94f8`),
  and then denied with `predicate cannot be empty`, burning tag v0.1.15.
  The pinned cosign v3.1.3's `attest` (`cmd/cosign/cli/attest/attest.go`)
  unconditionally requires `PredicatePath` before it looks at anything
  else; `--statement` parses as a flag but is never read anywhere in
  `attest`'s execution path, so `cosign attest --yes --statement
  "${statement}" ...` could never have signed anything.
- The fix signs the release-bound MODIFIED PREDICATE through the flag
  cosign actually consumes, with the predicate-type URI passed literally
  rather than through the `slsaprovenance1` alias: `cosign attest --yes
  --predicate "${modified_predicate}" --type
  "https://slsa.dev/provenance/v1" "${IMAGE}@${DIGEST}"`. The alias
  resolves, via `cmd/cosign/cli/options/predicate.go`'s
  `PredicateTypeMap`, to cosign's typed SLSA decoder
  (`protojson.UnmarshalOptions{DiscardUnknown: true}`), which would have
  silently dropped BuildKit's `runDetails.metadata.buildkit_metadata` and
  `buildkit_completeness` before signing. Our injected
  `buildDefinition.internalParameters.release` binding survives either
  path — `internalParameters` is typed as a `google.protobuf.Struct`,
  which protojson's unknown-field discarding never reaches — but the
  literal URI is still the correct choice: losing the two BuildKit fields
  alone already breaks this step's later exact-statement comparison, and
  the literal URI instead takes cosign's generic/custom path, which embeds
  the predicate verbatim rather than dropping anything. Both paths set the
  signed statement's envelope `_type` to `https://in-toto.io/Statement/v0.1`
  (`in_toto.StatementInTotoV01` upstream), never the `.../Statement/v1`
  this repo previously expected and cosign never actually emitted, so
  `INTOTO_STATEMENT_TYPE` in `scripts/ci/release_contract.py` now matches
  reality. The existing `cosign verify-attestation --type slsaprovenance1`
  calls are unchanged: that alias resolves through the identical
  `PredicateTypeMap` to the same `https://slsa.dev/provenance/v1` URI used
  for signing, and verification filters on `predicateType`, never the
  envelope `_type` — confirmed directly against cosign's
  `pkg/policy/attestation.go`.
- `attestation-statement` now also writes the modified predicate to a
  required `--predicate-output` path — the exact object cosign embeds —
  threaded through both the existing-image classification loop and the
  signing loop, so a previously-published and a freshly-signed image are
  verified identically. Reproduced locally end-to-end against the burned
  v0.1.15 digest with the pinned cosign v3.1.3: the old `--statement`
  invocation still dies with `predicate cannot be empty`; the new form,
  driven by this fix's own `attestation-statement` output, clears predicate
  loading, statement generation, and digest resolution, and fails only at
  a deliberately-invalid `--identity-token deadbeef` with `open deadbeef:
  no such file or directory` — the first failure a real GitHub Actions
  OIDC token clears.

### Security

- Go toolchain bumped 1.26.5 -> 1.26.6, remediating 8 HIGH-severity (zero
  CRITICAL) Go standard-library CVEs that lidersea.com's v0.1.15
  release-publisher run surfaced via its Trivy vulnerability gate:
  CVE-2026-33818 (`encoding/asn1` DoS), CVE-2026-39821 (`net/http` IDNA
  punycode), CVE-2026-46600 (`dns/dnsmessage` DoS), CVE-2026-56853
  (`net/http` h2c DoS), CVE-2026-56858 (`html/template` XSS), CVE-2026-56859
  (`encoding/xml` DoS), CVE-2026-56860 (`net/url` DoS), and CVE-2026-56862
  (`crypto/tls` KeyUpdate DoS). naranjo.online builds with the identical
  pinned Go 1.26.5 toolchain as lidersea.com, so its own just-triggered
  v0.1.15 publisher run was expected to fail the same gate; this bump is
  the remediation either way.
- The pin moves everywhere it is asserted, with no application code
  changes: `go.mod`'s `toolchain` directive (`go 1.26.0`'s language-version
  floor is unchanged), the Dockerfile's `golang:1.26.6-trixie` builder stage
  (digest re-pinned to the new image), the `go-version` inputs in
  `.github/workflows/codeql.yml` and `.github/workflows/pr-gate.yml`, and
  `pr-gate.yml`'s `go env GOVERSION` verification step. `AGENTS.md` and
  `README.md`'s toolchain callouts move with it so the documented pin never
  lags the enforced one.

## [0.1.15] - 2026-08-18

### Fixed

- The release publisher's `immutable_settings` job still could not pass after
  0.1.14 re-anchored the merge-method proof: run 32188959219, dispatched at the
  0.1.14 merge commit, advanced past every previously failing layer and then
  denied with `DENY: Protect-Main bypass actors must be a JSON array`. The
  sibling repository's identical code family denied the same way in run
  32188071417. `build_settings_receipt` in `scripts/ci/release_contract.py`
  read `bypass_actors` off the `Protect-Main` ruleset detail, but GitHub's REST
  reference for "Get a repository ruleset" states that "to prevent leaking
  sensitive information, the bypass_actors property is only returned if the user
  making the API request has write access to the ruleset". The job's App token
  holds `permission-administration: read` and no ruleset write access, so the
  property is absent from its response and the read denied unconditionally —
  and it denied before `rules[]` was parsed, so 0.1.14's re-anchored
  merge-method derivation had never once executed under the CI credential.
- The receipt no longer reads or carries `bypass_actors`, matching 0.1.14's
  philosophy: CI asserts exactly what the enforcing surface exposes to the CI
  credential, with no conditional assertion and no credential-dependent branch.
  `validate_settings_receipt`'s closed field set drops the key with it, so a
  dangling bypass field is foreign and fails closed.

### Changed

- `docs/release-governance.md` now records which release-control invariants are
  CI-proven and which are owner-verified, quoting GitHub's field visibility
  rule verbatim. Bypass-actor emptiness moves to the owner-verified column and
  that column carries the standalone GET-only `gh api` command that discharges
  it, star-witnessed like the rest of the runbook. The deleted read is
  credential-independent, so the preflight itself reads the property for
  nobody and re-running it proves nothing about bypass actors; the requirement
  remains a Ready gate at step 8 of "Working a change end to end" and is now
  performed by a command that can actually fail. `AGENTS.md` (requirement 10,
  merge readiness, step 8) and `README.md` stop saying the receipt proves it.
  The runbook's 2026-08-14 ruleset-inexactness note is corrected against
  owner-observed 2026-08-18 state. CI cannot see the field and no longer
  pretends to.

## [0.1.14] - 2026-08-18

### Fixed

- The release publisher's `immutable_settings` job could never pass, so no
  release has been published since v0.1.9 even though `main` advanced to
  0.1.13. `build_settings_receipt` in `scripts/ci/release_contract.py`
  derived the receipt's `merge_methods` from the repository record's
  `allow_merge_commit` / `allow_rebase_merge` / `allow_squash_merge`
  booleans, but the job mints a GitHub App token holding only
  `permission-administration: read`, and GitHub returns those booleans
  only to credentials that also carry Contents write ("To view
  merge-related settings, you must have the contents:read and
  contents:write permissions"). Every run therefore denied with
  `DENY: repository setting allow_merge_commit is not boolean` before any
  publication side effect. The receipt now derives `merge_methods` from
  the active `Protect-Main` ruleset's `allowed_merge_methods` — the
  control that actually enforces merge behaviour on `refs/heads/main` and
  one the least-privilege token can read. The receipt's external shape is
  unchanged, the pull-request rule's parameters remain pinned exactly, and
  the downstream receipt validator still requires exactly rebase and
  squash, so the fix restores publication without relaxing any control or
  widening the publisher's credential.

## [0.1.13] - 2026-08-18

### Changed

- `AGENTS.md` catches up to owner directives its prose predated:
  - Requirement 3 and the commit-identity-mechanics section no longer
    hardcode a single fixed signature (`- Fable5`); the acting agent
    signs its own commits, PR bodies, and issue bodies, exactly matching
    its agent label in the roster (`- Fable5` ↔ `fable5`, `- Sonnet5` ↔
    `sonnet5`, `- Opus5` ↔ `opus5`, `- 5.6 Sol` ↔ `5.6-sol`). This
    supersedes the single-signature owner attribution decision of
    2026-08-10, corrected by the re-tiering directive of 2026-08-18
    (routes simple/dependabot work to lighter models) and evidenced by
    merged precedent #56, the first PR signed under the corrected rule.
  - The agent-labels roster gains `sonnet5` (Claude Sonnet 5, color
    `0EA5E9`) — the label already existed server-side; the roster text
    lagged it.
  - Commit identity mechanics gains a new bullet documenting per-command
    SSH commit signing with the owner-registered Mac key (`git -c
    gpg.format=ssh -c user.signingkey="key::$(ssh-add -L | grep
    ssh-ed25519)" commit -S`), never via `git config`; the owner
    registered the key as a GitHub signing key on 2026-08-18, and
    signature enforcement on `main` is a protected-branch setting so
    non-Mac owner merges stay unblocked.
  - The Dependabot bullet documents the lockstep-pair practice already
    twice-proven in this repository: when Dependabot splits a
    version-locked pair into separate PRs (precedents:
    `github/codeql-action` `init`+`analyze`, #53/#54; `svelte`+
    `svelte-check`, #51/#52), one agent PR supersedes both and fixes the
    root cause in the same commit via a `dependabot.yml` `groups:`
    stanza (merged precedents #56, #58).
  - The branch-prefix example generalizes from the single hardcoded
    `fable5/<topic>` to `<lane>/<topic>`, with live examples.
  - No behavioral, requirement-numbering, or gate change; the prose now
    matches what the roster, the label API, and two merged PRs already
    do.

## [0.1.12] - 2026-08-18

### Changed

- `svelte` and `svelte-check` move together from 5.56.8 to 5.56.9 and from
  4.7.5 to 4.7.6 respectively in `frontend/package.json` (and their lockfile
  entries, including the transitive `@sveltejs/load-config` bump to 0.2.3
  that `svelte-check` 4.7.6 requires). Dependabot had opened the two bumps
  as separate PRs (#51, #52); `svelte` and `svelte-check` are a compatibility
  pair released in lockstep, and this repository's practice is to bundle
  such pairs into one PR rather than merge them independently. This release
  lands both bumps in one commit. `.github/dependabot.yml` gains a `groups`
  stanza on the `npm` ecosystem scoped to `svelte` and `svelte-check`, so
  future coordinated releases of this pair arrive as one grouped PR instead
  of two.

## [0.1.11] - 2026-08-18

### Changed

- `github/codeql-action/init` and `github/codeql-action/analyze` move
  together from 4.37.6 to 4.37.7 (full-SHA pinned, version comments
  updated) in `.github/workflows/codeql.yml`. Dependabot had opened the two
  bumps as separate PRs (#53, #54); because both actions are pinned in the
  same workflow and CodeQL requires `init` and `analyze` to run the same
  released version, merging either alone fails CI with a configuration/
  runtime version mismatch. This release lands both bumps in one commit.
  `.github/dependabot.yml` gains a `groups` stanza on the `github-actions`
  ecosystem scoped to `github/codeql-action*`, so future coordinated
  `codeql-action` releases arrive as one grouped PR instead of two
  mutually-blocking ones.

## [0.1.10] - 2026-08-13

### Added

- Every protected-main merge now carries and publishes its own immutable
  semantic patch release. Pull requests (including docs and dependency
  updates) must advance the four committed source locks by exactly one patch
  from their protected base. Successful main CI is bound to its exact source
  SHA, creates the plain version tag, and explicitly dispatches the publisher
  definition from protected `main` without relying on recursive tag-push
  events. The dispatch carries the authoritative completed-run ID; a separate
  read-only job validates the exact successful PR-gate push, its closed job
  inventory, and the separate exact-SHA CodeQL main run/job inventory before
  the write/packages/OIDC job can start, so manual unmerged source, aggregate
  success with a skipped job, and stale CodeQL evidence are denied. Rapid merges have
  independent release paths; exact complete artifact state is retryable, while
  partial, foreign, or conflicting immutable state fails closed as burned.
  Both enabled owner merge modes are executable release paths: one-commit
  squashes and multi-commit linear rebases validate the exact base-to-final-tree
  patch transition without dropping the final source SHA.
  The change must remain Draft until a GET-only owner preflight proves GitHub
  immutable releases enabled plus exact GitHub-Actions-bound, strict
  current-base required checks with no ruleset bypass or update restriction.
  Source dependencies including frontend development dependencies and the final
  image digest are scanned for high/critical vulnerabilities with a
  checksum-pinned Trivy binary. Immediately before manifest construction, the
  publisher re-resolves the actual image/chart aliases to the produced digests
  and validates the strict raw two-platform SBOM schemas and subjects. Created and reused
  Releases must bind exact metadata and one deterministic evidence manifest.
  New publication stages a draft, verifies the manifest REST digest and bytes,
  then publishes; a terminal REST/asset re-read binds the immutable Release,
  manifest, and now-locked annotated tag to the exact signed source. A weekly
  read-only audit rechecks aliases, signatures, provenance/SBOM, chart source,
  and vulnerabilities as later detection rather than publication proof. A move between the initial tag check and Release
  publication fails closed. Ready additionally requires the canonical
  exact-head Main Worker bounded receipt,
  independently of the adversarial implementation approval.
  Git/image/Release tags use one plain `vX.Y.Z`. Helm's documented exception
  stays numeric `X.Y.Z` because its OCI tag must equal valid chart SemVer.
  `tag@sha256:digest` is a deploy reference, never a tag.

- The chart now says which release is running. Every rendered object carries
  `app.kubernetes.io/version`, derived from the chart's own `appVersion` so no
  override can make the label disagree with the chart that emitted it, and the
  workload reference renders as
  `ghcr.io/snaraj/naranjo-online:vMAJOR.MINOR.PATCH@sha256:<hex>`. Before this,
  `kubectl describe pod` answered "what is running" with a bare digest and the
  Pod carried no version at all.

  The digest did not move and is not optional: Kubernetes still resolves it,
  cosign and the platform's admission policies still verify it, and the values
  schema requires it alongside the tag (requirement 10). The tag is legibility
  only. The gate's version lock gains a fourth leg — VERSION, chart `version`,
  `appVersion`, and the image tag now move together — plus a render assertion
  that the emitted reference still carries a full digest. New doctrine pins in
  `internal/doctrine/release_identity_test.go` hold all of it, including that
  no selector ever matches on the version label, because selectors are
  immutable and a version-scoped selector stops matching one release later.

- A zero-secret GitHub contribution producer for the version-control panel
  (#41): the public, unauthenticated contributions document is fetched and
  scanned into the calendar the panel already rendered. Exact daily counts
  come from the document's own label elements, not from its coarse level
  attribute, and the scanner fails closed on markup drift — a refused
  document keeps the last good payload serving as stale.
- `vcs-activity/v1` gains `endDate` additively: the final week is padded to
  seven days like every other, so without an anchor the padding is
  indistinguishable from genuine quiet days. The frontend now draws days past
  it as labelled holes.
- Per-endpoint request byte caps. Each spec may declare a `maxBytes`, which is
  validated to be at or below the shared bound, so a per-endpoint value can
  only ever tighten and never widen.
- The version-control calendar renders through `ContributionGrid`, the same
  component the token panel's activity heatmap uses.
- Panels refresh themselves while a visitor watches (#40). `watchPanel` in
  `frontend/src/lib/panels.ts` re-reads each panel envelope on a 60s cadence
  and every panel now mounts through it; `watchClock` ticks the freshness
  badge so a rendered age keeps telling the truth instead of freezing at the
  mount instant. A hidden tab is not polled at all and catches up the moment
  it is shown, at most one read per panel is ever in flight, and stopping a
  watcher ends delivery even from a read already in flight. Every timer,
  transport, and visibility read is injected through one host seam, so the
  loop is executed by tests rather than described by them.
- Token-usage panel rebuilt to the owner's referenced surface (#40): a
  headline tile grid (a final odd tile spans the row), the usage windows with
  their meters, a "Token activity" section whose Daily / Weekly / Cumulative
  segmented toggle re-reads ONE daily series through three lenses with no
  extra payload, and an "Activity insights" list.
- `token-usage/v1` gains `account`, `stats`, `series`, and `insights` —
  additively, inside the same kind version: every field is optional, and a
  payload written before they existed still decodes and still renders. Stats
  and insights carry a `recorded` flag, so a figure captured out of band
  says so instead of borrowing the panel's live freshness.
- `ContributionGrid.svelte` plus `lib/grid.ts`: one contribution-heatmap
  implementation, a month axis, a five-level ramp shipped as themeable custom
  properties, and days outside the window rendered as labelled holes rather
  than as zeros. The token-activity grid renders through it today and the
  version-control calendar follows, so the two can never drift.
- README and AGENTS.md document the reviewed prerequisites for enabling live
  panel refresh in a cluster, and state that the enablement itself is a
  separate owner-reviewed step.
- Release publisher attaches the BuildKit SLSA v1 provenance as keyless
  cosign attestations (`slsaprovenance1`) on the immutable image digest,
  immediately after image signing — one per architecture, each read back
  from the just-pushed index and re-asserted about the index digest the
  deployment references, over a platform set derived from the index and
  asserted to equal the build's exactly. Each predicate is bound to this
  release before it is attached (this repository's source, this tag's
  commit, an Actions run of this repository) and the two are required to
  differ; the step then verifies its own attestations under this
  workflow's identity, so a release whose attestations are not
  discoverable or verifiable fails in the publisher rather than later at
  promotion. Cosign normalizes the predicate on attach, dropping
  BuildKit's `buildkit_metadata` and `buildkit_completeness` — the
  attestation is a lossy copy, and the index-embedded provenance remains
  the authoritative content evidence. No new permissions, actions, or
  skip paths, and the job's unused `attestations: write` grant is
  dropped; effective from the next tagged release. Completes this site's
  precondition for the platform promotion ratchet
  (website-infrastructure#58).
- Version-control activity status bar (#19): a fixed strip rendering
  the `vcs-activity/v1` panel inside the shared PanelShell — a per-day
  contribution heatmap (five-level single-hue cell ramp shipped as
  themeable custom properties with validated dark-native defaults),
  contribution total and current streak, and the latest commits — fed
  exclusively through the same-origin panel data layer. Geometry is
  fixed per region so data arriving never shifts layout, a wide window
  scrolls inside the strip rather than the page, an admission-refused
  or absent payload renders an explicit empty state, and the data's
  origin is never named in frontend source (pinned by test alongside
  the strip's local-origin scan).

### Changed

- **The shared per-request read bound is RAISED, 262144 -> 524288 bytes.** The
  contribution document is markup around a small amount of data and does not
  fit under the old bound. Stated plainly because an earlier draft of these
  notes described this change as tightening, which was wrong: the shared
  ceiling went up. What each endpoint may actually read is now
  hiscores 65536 (down from 262144), version-control 524288 (new), and each
  usage endpoint 262144 (unchanged) — so the aggregate a hostile set of
  upstreams could make this process hold at once moves
  **768 KiB -> 1088 KiB**. The bound is now pinned by a ratchet-style test at
  or below 524288, so raising it again is a conscious edit with a reason.
- **Host allowlist: `github.com` added** (now four hosts). Security-sensitive
  by definition, so: exact host match, https only, checked at construction
  AND again at request time, bounded by its own byte cap and the shared
  timeout, redirects refused outright, and no credential is read on this path
  at all. Tests pin the list in both directions, including that
  `api.github.com`, `raw.githubusercontent.com`, and
  `github.com.evil.example.test` are all refused.
- The boss grid renders the complete table: thousands-separated counts,
  `Unranked` where the hiscores return rank `-1`, muted unranked tiles, and
  its own internal scroll so a rail stays a rail.
- The vendor-name doctrine pin now also covers the version-control host, so
  the compiled binary stays uncoupled from where the calendar comes from.
- `frontend/tsconfig.json` enables `allowImportingTsExtensions`: Node's
  type-stripping test runner resolves specifiers literally, so a value import
  between two `src` modules must carry its extension to be testable at all.
- The live usage window widens from 7 to 30 daily buckets (`limit=31`,
  `lookbackDays=30` in `internal/panels/config/fetch.json`) so the activity
  grid has a month to draw. Pagination is still not implemented, so a month
  is the ceiling one request can deliver.
- `GO_COVERAGE_FLOOR` ratchets 91.1 -> 93.2 (measured 96.2 on this branch).

### Fixed

- The boss log serves EVERY boss the hiscores report — 71 for the configured
  account — instead of the six that were enumerated in config (#41). The
  direction is inverted on purpose: config now names the NON-boss activities
  (clue tiers, minigame ranks, point totals) and everything else the upstream
  reports is served in upstream order, so a boss Jagex ships tomorrow appears
  on its own instead of being silently dropped until somebody edits a list.
- The boss log's live refresh could never have worked. The upstream document
  is `{name, skills, activities}` and the shipped grammar declared only two
  of those three, so the strict decoder rejected every response on the
  unknown `name` field and the panel could only ever serve its snapshot. The
  grammar is completed and pinned against a REAL captured response.
- The shipped boss figures were invented and wrong (Zulrah 1408 against a
  real 1192, Chambers of Xeric 118 against a real 10, and so on). The
  snapshot is now generated from the captured upstream response, and a test
  fails if the two ever disagree.

### Removed

- The fabricated version-control payload — five weeks of invented counts, an
  invented streak, and three invented commit rows. The calendar is now real;
  the commit rows are an empty list, because the contributions document
  carries none and inventing them is exactly the defect being removed. A
  commit producer is a separate piece of work with its own allowlist
  question.
- The invented figures in `snapshots/token-usage.json`. Nothing in the
  repository could support them, and the "honest states" floor forbids
  fabricated data outright. The snapshot now carries only recorded, dated
  values for the source that has them, and the other source renders its
  explicit empty state until live refresh is enabled or the owner records an
  export. This is a deliberate, visible loss of fake content.

### Security

- The chart's ingress NetworkPolicy can finally express the **whole peer
  identity**. It admitted a peer by namespace and `app.kubernetes.io/name`,
  which are the only peer facts the values exposed — but the peer namespace is
  shared by several per-site connectors that carry the same app name and
  differ only by `app.kubernetes.io/instance`. A name-only selector therefore
  admitted every connector in that namespace, not just this site's. The
  deployed policy was hand-tightened with the instance pin (dated observation,
  2026-08-11; revalidate read-only before relying on it), so applying the
  chart as it stood would have WIDENED what is running — a security regression
  delivered by a routine release rather than by a bad edit. `ingress` now
  carries `peerInstance`, defaulting to this site's own connector so the safe
  policy is the out-of-the-box render, and `values.schema.json` requires it
  non-empty: a blank or absent instance fails validation instead of rendering
  an unpinned policy. `scripts/ci/chart-ingress-pin.sh` renders the chart in
  the PR gate and proves all three properties — the default pins
  namespace + app name + instance byte for byte against the values, blank and
  absent are both refused, and moving the instance moves the pin while the app
  name stays put, which is exactly why the app name alone cannot tell two
  connectors apart.
- Outbound endpoints are **https only**. Plain `http` was previously tolerated
  by endpoint validation; the same allowlist governs the credential-bearing
  usage endpoints, so a cleartext hop would have put a credential on the wire.
- Outbound endpoints may carry **no userinfo**. `https://user:secret@host/x`
  is a credential in a URL — the same class of exposure — and config data is
  not where one belongs. Scheme, userinfo, and host are now one admission
  rule, applied at construction AND again at request time.
- The public version-control producer may send **only an `Accept` header**. It
  carries no credential field, but a free-form header map was a general escape
  hatch: config data could have attached an `Authorization` header to a
  producer this repository documents as unauthenticated. That is now
  unrepresentable rather than merely undocumented.
- The contribution scanner refuses a **partially parsed** document. The count
  floor and the span ceiling together still admitted one dropped cell, whose
  day would have been zero-filled — a plausible, fresh, WRONG total. Every day
  inside the covered span must now be accounted for by its own cell.
- The scanner also requires the calendar to **start on a Sunday**, because week
  columns and the frontend's trailing padding line up only if a column is a
  calendar week. A grid starting on any other weekday is refused rather than
  shifting every rendered date.

- The panel refresh loop's stop contract is pinned on the delivery side, not
  only the dispatch side: a watcher stopped WHILE a read is outstanding
  delivers nothing when that read finally settles. The previous test stopped
  the watcher after its read had already settled, which a watcher missing the
  guard survives — there was nothing left in flight to deliver.

- Origin-side HTTPS enforcement (#33): every request the edge declares
  as plain HTTP (`X-Forwarded-Proto: http`) is answered with a `308`
  permanent redirect to the identical URL over TLS — host from the
  request's Host header, escaped path and query preserved byte for
  byte, on every route, HEAD and POST bodiless like GET — as defense
  in depth behind the edge's own HTTPS enforcement. `308` (not `301`)
  preserves the request method and body, so the origin backstop keeps
  this repository byte-identical to the sibling's, whose gated write
  routes a `301` would silently rewrite to `GET`; the edge's own
  Always-Use-HTTPS remains the primary redirect. Matching is a
  byte-exact equality (pinned against any future trim/prefix/contains
  regression): trailing/leading whitespace and comma-list proto values
  are "not our edge" and neither redirect nor mint the promise. The
  HSTS header keeps its
  exact value (`max-age=31536000`: the application is the sole HSTS
  owner, edge-managed HSTS stays off, and includeSubDomains/preload
  remain deferred owner decisions pending a subdomain inventory and a
  rollback path) but now rides only responses the edge declares as TLS
  (`X-Forwarded-Proto: https`). Behavior change for undeclared
  traffic: probe, port-forward, and local-dev responses — which
  previously carried HSTS on connections that never demonstrated TLS —
  now serve without it; nothing else about undeclared serving changes.
  Matching is exact and fail-closed: case variants and unknown proto
  values neither redirect nor mint the promise, and the forwarded
  header is trusted for this scheme decision only.

## [0.1.9] - 2026-08-11

### Added
- Boss-log side rail (#20): the first visible panel — a collapsible
  fixed right rail recreating RuneLite's chrome purely in CSS from its
  published palette values as component-scoped, theme-overridable
  custom properties, collapsed by default on narrow viewports and
  overlaid so it can never shift layout. Inside, the boss log renders a
  dense three-column grid of fixed-height cells: a lazy-loaded boss
  icon beside a right-aligned KC, null KC rendered as `--`, and a
  hover/focus tooltip with full boss name, rank, and KC. The shared
  panel-UI foundation lands with it: `src/lib/panels.ts`, a same-origin
  typed data layer over `/api/panels` pinning the `panel/v1` envelope
  against the Go types (strict admission, exactly one request with no
  retries, every transport/status/shape fault degraded to an honest
  `unavailable` envelope); `PanelShell.svelte`, the one shared chrome —
  title plus status badge (ok/stale/unavailable dot and coarse
  `generatedAt` age) — reading `--panel-*` custom properties so the
  theme layer overrides variables, never components; and a
  comment-fenced one-line-per-panel mount region in `App.svelte` so
  parallel panel PRs merge cleanly. Six OSRS Wiki boss thumbnails ship
  as content-hashed same-origin assets (`assetsInlineLimit: 0` keeps
  the CSP free of `data:` URIs) with the Jagex Fan Content Policy
  notice and wiki credit in `ATTRIBUTION.md`; boss names stay API data
  — the only name-shaped code is the icon slug lookup with an
  initials-glyph fallback. A `TestVisitorChecksTheBossLog` visitor
  chapter pins the page render and boss-log payload contract over real
  transport, including both branches of the null-KC `--` path.
- Reading modes (#22): named color schemes like the OSRS wiki — light,
  dark, and a sepia placeholder seeded from the wiki's browntown values
  — instead of a binary toggle. `styles.css` becomes a custom-property
  token layer: light is the default `:root` palette, each further mode
  is one `[data-theme]` override block with its own `color-scheme`, and
  with no explicit choice `prefers-color-scheme: dark` maps the dark
  tokens in. Zero flash with no inline script and no CSP change: the
  origin precomputes one `data-theme`-stamped `index.html` variant per
  mode at construction — own bytes and digest ETag each, from memory,
  no request-path templating — and selects by the `theme` cookie,
  failing closed to the unstamped default on anything unregistered; the
  document response now carries `Vary: Cookie` so storing caches key
  copies per variant. The toggle is the wiki's, dependency-free: a
  compact moon button opening a popover of three round swatches — each
  swatch's background is its theme's own page surface with a sun,
  cratered-moon, or plain dark-moon glyph (inline SVG) — that sets the
  cookie (`path=/`, 365 days, `SameSite=Lax`) and swaps `data-theme`
  instantly, same stylesheet, no reload, no asset refetch; fully
  keyboard-driven (arrows/Home/End, Escape with focus return, focus-out
  dismissal) with 44px targets and reduced-motion-aware animation, its
  open/close logic an extracted, behavior-tested state machine whose
  press-in-flight guard keeps dismissal and pointer selection correct
  across engine focus differences. `styles.css`
  holds every palette value exactly once as `--palette-*` definitions
  that theme blocks and swatches only reference. A bundle whose
  index.html cannot be stamped now fails construction; parity pins hold
  the Go theme list, the frontend registry, and the CSS blocks together.
- Panel framework (#21): a versioned read-only JSON API under
  `/api/panels` (index) and `/api/panels/<id>` (full panel), served
  through the existing security wrappers in the site's revalidated
  no-cache class with digest ETags. One stable `panel/v1` envelope —
  `{schema, id, kind, title, generatedAt, status: ok|stale|unavailable,
  data}` — over kind-versioned payloads: `token-usage/v1` (per-source
  windows; source labels are data, never Go identifiers),
  `vcs-activity/v1` (contribution weeks, totals, streak, recent
  commits), and `boss-log/v1` (account plus bosses with nullable
  kc/rank rendered as "--"). Panels are FETCH-FIRST per owner review:
  boss-log refreshes from the official hiscores JSON endpoint (mapped
  data-driven onto a configured boss list) and token-usage from the
  two vendors' official usage-report APIs, with every vendor string —
  endpoints, labels, credential env-var names, the outbound host
  allowlist — living in embedded config DATA, never Go source.
  Refresh runs ONLY in background loops (TTL cadence with exponential
  backoff), enabled by an explicit `PANELS_REFRESH=true` opt-in at the
  composition root following the media-enablement precedent; fetched
  documents pass the same strict decoders as snapshots, bodies are
  size- and time-bounded, credentials are read from named env vars at
  fetch time only (unset means that source serves its snapshot section
  as `stale`), HTTP redirects are refused outright so neither the
  client nor a credential header can ever be steered off the
  allowlist, and every failure keeps the last good payload serving
  with an honest `stale` signal. Embedded snapshots remain the
  cold-start/failure default: fresh = `ok`, fallback or last-good =
  `stale`, nothing = `unavailable`. The zero-egress pin evolved into a
  confinement pin (a conscious narrowing, documented in the PR): all
  egress machinery lives in one file, the production host allowlist is
  test-pinned to exactly the three approved hosts with off-list hosts
  refused at construction AND at request time, and an instrumented
  transport proves requests never trigger fetches. Owner performance
  budgets are structural: index responses at or under 4 KiB and panel
  envelopes at or under 32 KiB are enforced at build/refresh time and
  as tests, panel JSON deliberately serves whole documents (no byte
  ranges), and a read-counting filesystem proves the request path
  never leaves memory. Visitor scenarios cover the index, every panel
  with honest cold-start statuses, revalidation to 304s, and the
  opaque 404 over real transport.
- Visitor-scenario end-to-end suites: a hand-written stdlib mock-browser
  harness (`internal/testsupport.Visitor`) remembers and replays ETags
  like a browser cache, follows the document's asset references, seeks
  media by Range like a player, and asserts the security-header baseline
  on every navigation; scenarios cover first visit, repeat visit,
  missing deep links, media playback, and hostile probing (including
  all seven reserved namespaces) over real transport.
- Reserved-namespace parity pins: exact-seven-list tests on both the Go
  side (`TestReservedMediaSegmentsParity`) and the frontend side
  (`media.test.mjs`), each naming the other file, so the hand-duplicated
  Go and TypeScript lists cannot drift silently.
- `internal/testsupport`: shared API-level fixtures — the canonical
  frontend bundle and on-disk media tree — excluded from the coverage
  denominator as test scaffolding; white-box fakes stay in the packages
  whose internals they observe.

### Changed
- Provider neutrality (owner requirement R9): the NetworkPolicy's ingress
  peer is now values-driven (`ingress.peerNamespace`,
  `ingress.peerAppName`, defaulting to the current Cloudflare Tunnel
  connector) and the policy resource is renamed
  `cloudflared-to-naranjo-online` to `ingress-to-naranjo-online`; a
  provider swap is a values override, never a template or code edit.
  A fail-closed pin test asserts zero provider names in application
  code, frontend source, and chart templates — chart values defaults
  are the only sanctioned location.
- Package layout convention: each Go package keeps its types and
  package-level const/var declarations in `types.go` (genuine shared
  utilities in `utils.go`); the one-year immutable cache policy is one
  named constant shared by hashed assets and immutable media.
- A media-enabled boot constructs the site exactly once; previously it
  built and discarded a throwaway media-less `Site` first — a full walk
  plus SHA-256 of every embedded file.
- Embedded files with unregistered extensions now serve pinned
  `application/octet-stream` instead of leaving `http.ServeContent` to
  sniff the body; the media path already pinned unknown types.
- Tests assert structure and sentinel fixtures, never placeholder copy,
  so the temporary hello-world shell can become the real media-rich site
  without breaking behavior tests; AGENTS.md documents this and the
  other sanctioned-evolution paths.
- Go coverage floor raised 90.0% to 91.1% (ratchet-only; measured 94.1%
  on the scaffolding-excluded production denominator).

## [0.1.8] - 2026-08-11

### Added
- Production-readiness test sweep. A 28-row RFC 9110 precondition matrix
  locks when an abusive `Range` header may be answered with the
  application's `416` and when a standard `200`, `304`, or `412` must win;
  `testing/synctest` lifecycle tests prove the exact 10-second shutdown
  bound against a hand-written `httpRunner` fake; real-socket end-to-end
  suites boot `run()` — media-disabled and media-enabled — wait for
  readiness, exercise the public contracts over the wire (including
  fail-closed saturation with recovery), and drain on a real SIGTERM;
  deep-mock filesystem fault injection proves a broken embedded bundle can
  never become a ready pod and that the request path never touches the
  filesystem; and real-filesystem media-boundary faults (unreadable leaf,
  named pipe, file-as-directory, post-Close straggler, name-limit
  overflow) are pinned to opaque responses. Go statement coverage rises
  from 71.4% to 93.7%.
- The PR gate enforces a ratchet-only Go coverage floor (90.0%). Raising
  it as coverage grows is expected; lowering it is out of policy.

### Changed
- Every embedded frontend response — body, digest ETag, content type,
  cache policy — is prepared once at construction. Any unreadable embedded
  file now fails startup before the pod reports ready instead of surfacing
  as per-visitor errors, and the serving hot path performs no hashing and
  no filesystem access.
- `main()` now owns the process signal contract and passes `run()` its
  lifecycle context plus an environment-lookup function, the same
  entrypoint seam the lidersea.com sibling uses, so both repos test
  configuration, bind, serve, and drain identically and hermetically.

## [0.1.7] - 2026-08-11

### Changed
- Serve the application shell as `no-cache` instead of `no-store`, so the
  edge and browser may store it while still revalidating every navigation.
  An unchanged site now answers with a small `304` instead of shipping the
  whole document from the origin through the tunnel each time; the shell
  was the one uncacheable resource on an otherwise fully cached site. The
  document is public and its `ETag` is a content digest, so nothing is
  traded for the gain. Content-hashed assets keep their immutable caching.

### Added
- `TestNoRequestMethodCanEverMutate` pins that every route refuses every
  mutating method — the executable safety contract that makes TLS 1.3
  0-RTT (early data, which can be replayed) admissible at the edge.

## [0.1.6] - 2026-08-10

### Fixed
- Release pipeline: capture helm push's stderr so the chart digest is
  read for signing and the Release notes. v0.1.5 published a signed
  image and an unsigned chart artifact before the digest parse refused;
  the release process did not reuse or move that published tag, so v0.1.6 is
  the first complete signed release
  (image + signed OCI chart + GitHub Release).

## [0.1.5] - 2026-08-10

### Fixed
- Release pipeline: removed the invalid GitHub attestation step (buildx
  SLSA provenance + SBOM and the Cosign signature remain the integrity
  evidence). v0.1.4 published a valid signed image but no chart or
  GitHub Release; the release process did not reuse or move that published
  tag, so v0.1.5 is the first complete release.

## [0.1.4] - 2026-08-10

### Added
- Go module renamed to the standalone identity github.com/snaraj/naranjo.online.
- Standalone repository: complete history imported from the
  `website-infrastructure` monorepo with authorship preserved.
- Production CI: PR gate (frontend + Go tests with coverage, chart lint,
  dual-arch container build, secret/history scanning, actionlint,
  dependency review) and CodeQL.
- Tag-triggered release publisher: multi-arch image + OCI Helm chart to
  GHCR, Cosign keyless signing, SBOM, SLSA provenance, GitHub Releases.
- Documentation: README, agent contract (AGENTS.md), security policy,
  MIT license with all-rights-reserved site content.

## [0.1.3] and earlier

Released from the monorepo publishers (`ghcr.io/snaraj/naranjo-online`
`v0.1.2`, `v0.1.3`): hello-world frontend contract, health/readiness
endpoints, embedded-serving hardening, fail-closed media subsystem. See
the monorepo history (imported here) for details.
