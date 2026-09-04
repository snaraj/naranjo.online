# Agent contract — naranjo.online

This is the CANONICAL, vendor-agnostic agent contract for this repository:
any frontier model — or hurried human — must be able to operate here cold
from this document alone. Tool-specific entrypoints (CLAUDE.md) only import
it; nothing is duplicated elsewhere. The platform repository's deeper
doctrine applies when the two meet.

## Cold start — first-session checklist

A new agent operates from this repository alone; nothing is relayed by
the owner. In order:

1. Read this file end to end — it is the whole briefing; CLAUDE.md only
   imports it.
2. `git fetch origin` and work from `origin/main`. Never trust a local
   `main`, a stale worktree, or another agent's summary of remote state —
   verify remote facts directly (`gh pr view`, `git ls-remote`).
3. Verify identity and tooling: `gh auth status` shows the owner's
   account; commits carry the noreply identity per "Commit identity
   mechanics"; know CI's pinned toolchain (Go 1.26.6, Node 24.19.0,
   npm 11.17.0 — the gate verifies these exactly).
4. Survey the live state yourself: `gh issue list`, `gh pr list` —
   including the open-agent-PR count against the PR budget below.
5. Claim work through an issue, branch from `origin/main`, and follow
   "Working a change end to end".

## Purpose and architecture

naranjo.online is the owner's personal corner of the internet: a Svelte
frontend embedded into a single dependency-free Go binary — `cmd/server` over
`internal/server` and `internal/web`, with `internal/panels` serving the panel
envelopes, `internal/seal` and `cmd/usageseal` sealing the data they carry,
`internal/doctrine` holding the repo-doctrine pins, and `internal/testsupport`
the shared test harness — shipped as a distroless multi-arch
container plus a Helm chart, and deployed by digest onto a self-hosted
Kubernetes platform. The origin speaks standard HTTP (RFC 9110/9111) only
and is provider-neutral per the deployment-provider contract below. The
fail-closed media subsystem — rooted filesystem capability, reserved
operator namespaces, bounded transfer concurrency — is ENABLED by default in
the chart since 2026-08-27, and every refusal that made the answer meaningful
stays exactly as it was. The site is becoming a media-rich visual experience
(music, high-quality video, graphics — a music player and visual blog
hybrid), and the test suite is built so that growth is a conscious edit,
never a fight (see Sanctioned evolution).

## Requirements

Numbered for citation, repo-scoped, none negotiable in code:

1. **Zero spend, no external services.** Everything runs on owner hardware
   and free CI. No paid API, SaaS, tracker, CDN, or third-party runtime
   dependency may be introduced — the frontend stays local-origin-only.
2. **Owner-only merges; protected history.** Work lands through PRs into
   `main`; the repository owner alone merges. An agent must NEVER merge,
   auto-merge, squash,
   rebase into, or push `main`; must never force-push or delete refs; and must
   stop and question even a later request to do so. Tags exist only through
   the release workflow.
3. **Commit-metadata privacy and attribution.** Commits are authored AND
   committed as the owner's GitHub noreply identity (both fields). No
   co-author trailers. Agent-authored commit messages and PR bodies end
   with the ACTING agent's own signature, exactly matching its agent
   label in the roster below (`- Fable5` ↔ `fable5`, `- Sonnet5` ↔
   `sonnet5`, `- Opus5` ↔ `opus5`, `- 5.6 Sol` ↔ `5.6-sol`) — never a
   fixed lane. This supersedes the single-signature owner attribution
   decision of 2026-08-10; `docs/agent-git-mechanics.md` records why it
   was superseded and which merged PR is the first under the corrected rule.
4. **Fail-closed doctrine — never weaken.** No security behavior may be
   made toggleable: no boolean, env var, build tag, or config field may
   silently disable signing, verification, probes, TLS, header policy, or
   fail-closed sentinels. Never weaken a check, guard, validator, or test;
   if one blocks you, fix the cause or surface the conflict. Narrow,
   justified exceptions only, stated where the owner will read them. Tests
   should make dangerous states unrepresentable.
5. **Site independence.** naranjo.online shares conventions with its
   sibling repository (lidersea.com) but depends on nothing from it: no
   shared code, secrets, infrastructure state, or cross-repo references
   in build or runtime.
6. **Provider neutrality (owner requirement R9).** The origin knows no
   ingress, DNS, edge, or access provider. Provider names live exclusively
   in chart values defaults; `TestProviderNeutrality` enforces zero
   occurrences anywhere else. See the deployment-provider contract below.
7. **Ratchet-only coverage floor.** The PR gate enforces
   `GO_COVERAGE_FLOOR` (currently 93.2%, measured 96.2% when last raised).
   Raise it as coverage grows; lowering it weakens an enforced check and is
   out of policy. That measured figure is ONE fact recorded in three places —
   here, the Quality-gates section, and `pr-gate.yml` — so the three move
   together or they become three claims that can disagree.
8. **Truthful serving contract.** Port 8080; `/livez` and `/readyz` stay
   truthful — readiness reflects real serving ability, never a hardcoded
   yes.
9. **Dependency-free Go.** The Go module stays standard-library only.
   Adding a dependency is an owner decision, not a convenience.
10. **Every artifact merge releases after the server gate; deploy remains
    separate.** Every PR whose range touches any artifact surface advances
    exactly one patch from its current protected base: numeric `VERSION`,
    chart `version`, `appVersion`, and changelog `X.Y.Z`, plus plain `vX.Y.Z`
    image tag. A range whose every commit is individually confined to the
    closed documentation allowlist — root `AGENTS.md`, `README.md`,
    `.gitignore`, and Markdown files under `docs/` — classifies no-artifact:
    it advances nothing, and the orchestrator proves that class against
    evidence the VERDICT CANNOT CHOOSE before skipping the publisher, then
    logs that verdict explicitly instead of dispatching. The anchor it proves
    against, the anchor-advance walk, and the gap re-classification are
    specified in `docs/release-classifier.md`, with the working attack that
    retired "it re-derives the class from git" as a sufficient answer.
    Removing the release from a documentation-only merge
    weakens nothing: the artifact is unchanged, so there is
    nothing to version, sign, scan, or attest. The classifier has exactly
    two verdicts and no flag, environment variable, or configuration input;
    a non-allowlisted path with an unchanged version, a mixed range without
    its one exact patch, an unparseable diff entry, or a non-regular file
    mode all deny; renames decompose into add plus delete, so a rename
    crossing the allowlist boundary denies through its non-allowlisted side.
    Widening the allowlist is itself an artifact-classified gate change that
    releases. Two denial modes are deliberate and must not be mistaken for
    bugs, and they behave differently — conflating them misleads whoever is
    on the other end of the red build. The BOUNDARY denial, from the
    recovered last release boundary, is STICKY: a documentation merge whose
    retained release never completed fails red, and every later
    documentation merge fails the same way until an artifact merge moves the
    boundary past it. It is reachable under the ordinary rebase convention
    of a separate slot commit, not only under exotic histories. The ANCHOR
    denial, from the four-lock comparison against the newest earlier
    successful protected-main gate run, does not persist the same way: it
    needs no artifact merge to clear, because the denied merge's own gate
    run becomes a later anchor. It is NOT, however, promised to clear on
    the very NEXT merge, and an earlier revision of this contract wrongly
    said it was. Main pushes each get their own concurrency group, so gate
    runs can complete out of order and `select(.id < $current)` can filter
    a newer run out of an older orchestration — two racing documentation
    merges can therefore both deny, reporting the identical anchor. Both
    denials are the intended trade — loud and recoverable, never a wrong
    release — but only the boundary denial requires an artifact merge to
    clear, and neither promises green on any particular next merge.
    Successful main CI publishes that exact SHA as one
    server-locked plain `vX.Y.Z` release, gated by the read-only
    authorization job stated under Releases below, so an ordinary manual
    dispatch, skipped job, or aggregate-only success cannot publish. Squash
    and rebase are both supported: the protected-main push must be one
    merge-free linear base-to-head range whose final snapshot is the exact
    next patch, and that complete final SHA gets one release. There is no
    skip or force path; the owner-observed release-control receipt and the
    separate bypass check that gate the first Release under this path are
    specified in `docs/release-governance.md` and required by Merge
    readiness below. Every created or reused GitHub Release must
    report authoritative `immutable: true` and exactly one canonical evidence
    manifest whose digest and downloaded bytes are verified before and after
    publication. Images deploy by digest; `vX.Y.Z@sha256:<digest>` is a
    reference, never a tag, and publication is never deployment or promotion.
11. **Media stays out of the control plane.** Heavy media never enters
    git, the bundle, the embed, the image, or a ConfigMap/Secret. Small
    assets respect the documented category and size ceilings. Frontend
    URLs come from `src/lib/media.ts`; components never know hosts,
    volumes, or origins.
12. **No secrets, no noncanonical personal data.** No credential, token,
    private host fact, private contact detail, or new personal data enters this
    repository — including tests, fixtures, and docs. The already-public owner
    name/noreply commit identity and license/portfolio authorship are the narrow
    canonical attribution exceptions; never expand them or use a personal name
    as authorization. Access control is always expressed by role.

### Deployment-provider contract

The origin speaks standard HTTP (RFC 9110/9111) only. Ingress, DNS, edge,
and access are injected deployment concerns and never appear in application
code, frontend source, or chart templates. Provider names live exclusively
in the chart's values defaults — `ingress.peerNamespace`,
`ingress.peerAppName`, and `ingress.peerInstance` in `chart/values.yaml`,
the single binding point the NetworkPolicy consumes — so a provider swap is
a values override, never a template or code edit. The pin test
(`internal/doctrine/provider_neutrality_test.go`) enforces this, failing
closed on any provider name under `cmd/`, `internal/`, `frontend/src/`, or
`chart/templates/`.

The peer identity is all three facts together, and the instance is not
decoration: the peer namespace is shared by several per-site connectors
that carry the SAME app name and are told apart only by
`app.kubernetes.io/instance`, so a namespace+app selector admits every
connector deployed there. `values.schema.json` requires the instance
non-empty — a blank or absent value fails validation instead of rendering a
wide policy — and `scripts/ci/chart-ingress-pin.sh` proves the pin over the
COMPLETE render, never one `--show-only` extract: the default render, refusal
of an unpinned instance, the instance as the separator, the single policy's
ingress sub-tree compared byte for byte against the canonical text built from
values, and fourteen hostile whole-render shapes refused by that extraction
ALONE. `docs/ci-map.md` records the four shapes this gate used to exit 0 on.

## Testing doctrine (v0.1.8+)

- Coverage is enforced per requirement 7. `internal/testsupport` is test
  scaffolding — it runs only inside test binaries — and is the profile
  filter's only exclusion (see "Quality gates").
- Lifecycle bounds are proven under `testing/synctest` against
  hand-written fakes (the `httpRunner` seam), so the exact shutdown
  window is exercised in microseconds with no sockets and no sleeps.
- Filesystem boundaries are proven with deep fakes: a read-counting,
  fault-injecting `fs.FS` pins that construction reads everything exactly
  once and the request path never touches the filesystem. The media root
  is deliberately never mocked — it is a security boundary, and its
  faults are staged on a real filesystem.
- End-to-end suites boot `run()` over real TCP and drain on a real
  SIGTERM. Visitor-scenario suites (`cmd/server/visitor_test.go`) drive
  the same boots through the `testsupport.Visitor` mock browser — ETag
  replay, asset following, Range seeking, security baseline on every
  navigation — and must read as user stories.
- Fixture text is sentinel-only: tests assert structure and markers
  (`data-static-fallback`, fixture sentinels), never site copy.
- Repo-doctrine pins live in `internal/doctrine` (currently provider
  neutrality); parity pins guard hand-duplicated lists on both sides
  (Go `TestReservedMediaSegmentsParity` and the frontend media test),
  each failure naming the other file.
- Tests are stdlib-only with hand-written fakes; no assertion libraries,
  no mock frameworks.

## Package layout

- Each Go package keeps its type/struct declarations and package-level
  const/var blocks in `types.go`; methods stay beside the logic they
  serve. A `utils.go` exists only where a genuinely shared cross-file
  utility does — never create an empty or speculative one.
- Shared API-level fixtures and the mock-browser harness live in
  `internal/testsupport`; white-box fakes that need unexported access
  stay in the package they observe (testsupport never imports the
  packages under test). Visitor scenarios live in
  `cmd/server/visitor_test.go`.

## Build, test, and release flows

Build and test in the exact order given under "Quality gates — exact
commands and patterns" below; that battery is canonical and CI enforces the
same one. Two facts belong beside it: the frontend build lands in
`internal/web/dist`, which the Go embed test needs, and all FOUR chart pin
scripts run in CI's `chart` job at `--kube-version v1.36.0`, because the
chart requires the platform's Kubernetes target and plain `helm template`
defaults to older capabilities.

Releases: every artifact-classified PR advances numeric `VERSION`, chart
`version`, `appVersion`, and changelog `X.Y.Z`, plus plain `vX.Y.Z`
`image.tag`, by exactly one patch from its current protected base; a
documentation-only range (requirement 10's closed allowlist) advances nothing
and skips release orchestration entirely. Successful main CI creates NO tag: it
explicitly dispatches the protected-main publisher with that successful run's
ID, and the PUBLISHER creates the annotated plain `vX.Y.Z` tag at the exact
merged SHA from inside its privileged job, so no tag exists before
authorization. The split is enforced by permissions, not convention —
`release-after-main.yml`'s only job holds `actions: write` plus `contents:
read` and therefore cannot create a ref at all, while `release-publisher.yml`'s
`publish` job holds `contents: write` and POSTs the tag object and
`refs/tags/`. A token-created tag is never assumed to trigger another push
workflow, which is exactly why the dispatch is explicit rather than
tag-triggered. The publisher's read-only authorization job verifies
the exact run, repository, workflow path, push event, successful conclusion,
main branch, source SHA, exact PR-gate job inventory, and the separate exact-SHA
CodeQL main run and job inventory before its write/packages/OIDC job can start.
The publisher emits the signed multi-arch image, signed OCI chart, and GitHub
Release only after checksum-pinned high/critical source and final-image scans;
source scanning includes frontend development dependencies. It re-resolves the
actual image and chart aliases to the exact produced digests and validates each
raw platform SBOM subject before sealing the manifest.
The Release carries one deterministic manifest binding source/run, artifacts,
aliases, signer/provenance, and scan policy/results; a weekly read-only audit
revalidates that complete chain. Histories and tags are append-only; stale
concurrent PRs must resync
and take the new next patch when they carry an artifact change; a
documentation-only PR has no patch to retake. Deployment RESOLVES digests, never tags. The
Helm chart/OCI tag is the documented numeric `X.Y.Z` exception because Helm
requires its registry tag to equal valid chart SemVer; Git/image/Release tags
remain plain `vX.Y.Z`.
Before the first Release governed by this path, the repository owner must make
the release-control settings receipt exact. The receipt is a required Ready
gate, never permission for an agent to change settings or merge. A failed or
unknown preflight leaves the PR Draft.
The rendered image reference carries both —
`repository:vX.Y.Z@sha256:<hex>` — so a Pod
says which release it is, but only the digest selects bytes, and only the
digest is signed, attested and verified at admission (requirement 10).

## Sanctioned evolution

The following are expected changes, and the suite is built to make them
conscious edits, never fights:

- Adding media MIME types (`mediaTypes` in `internal/server/types.go`)
  together with their rows in `TestMediaMIMETypes`.
- New asset classes under the documented category and size ceilings, and
  real frontend growth: components, routes, and content replacing the
  placeholder shell. Content is not a contract — tests pin structure and
  markers, so shipping real copy must not break a handler test.
- CSP changes happen in lockstep: `securityHeaders` in
  `internal/server/server.go`, `testsupport.SiteContentSecurityPolicy`,
  and every pinned test value move in the same commit.
- Media enablement: the fail-closed media plumbing (reserved namespaces,
  root validation, concurrency budget) IS the music/video path. Enabling
  media is chart configuration plus discovery evidence — never code
  weakening: the values schema admits `media.enabled: true` only together
  with a reviewed profile, a named claim, a mount path, and a measured
  transfer budget, and the shipped defaults now SATISFY that conditional
  rather than decline it. The conditional itself is unchanged, and
  `scripts/ci/chart-media-pin.sh` still pins three directions — the default
  render as exactly one read-only media volume, every incomplete enablement
  refused by name, and an explicit `media.enabled=false` rendering no media
  at all. Turning media off stays a values override, never a code change.
  The gallery reads its items from a runtime `gallery/v1` manifest on that
  volume when one is served and falls back to the vendored bootstrap set
  when it is not, so publishing media becomes an operator file copy with no
  git, CI, or release consequence (`docs/media-manifest.md`).
- Ingress provider changes: a values override of the `ingress` block per
  the deployment-provider contract.

None of this relaxes the requirements above: security behavior stays
non-toggleable, the reserved-namespace lists stay exact and pinned
against each other on both sides, provider names stay confined to values
defaults, and the coverage floor only rises.

## Adversarial review protocol

Every substantive PR receives an independent adversarial review BEFORE it
leaves draft. The mechanism is vendor-agnostic: any capable agent — or a
human — runs it with git, a shell, and this repository's own gates; no
step assumes a particular AI tool, and no vendor gets a different protocol.

**Review depth is risk-based.** Not every PR earns identical depth:

- **Security-surface changes** — request/input handling, authn/authz, CI
  workflows, chart/deploy, dependencies, secrets, signing/release
  machinery, binary or vendored assets — take focused tests, one full CI
  cycle, live validation, ONE independent adversarial review, and owner
  merge.
- **Normal code changes** take focused tests and one full local gate; a
  live check only when runtime behavior changes; one review.
- **Docs, comments, and formatting** (requirement 10's no-artifact class)
  run the relevant checks only; adversarial review is the coordinator's
  routing decision, not a mandate.

Exact-head discipline is unchanged for whatever review DOES run: a
verdict binds the head it names.

**Reviewer independence.** The reviewer is a different agent or context
than the author — a fresh session of the same vendor qualifies; a
different lane is better. Independence is established by the POSTING
ACTOR, never by signature wording: a verdict receipt is posted by the
`snaraj-agent-reviews[bot]` GitHub App — a principal distinct from the
account that authors and pushes branches, and one granted Contents
write in no repository, so a compromised review lane can never alter
what it reviews. The signature line is lane provenance, content rather
than identity, so any current or future model name is valid there and
this contract pins no model roster. No rule compares the reviewer's
name to the author's: that textual same-lane denial retired with issue
#64, because a reviewer satisfies it by writing a different-looking
signature. Same-lane review is therefore permitted and stays legible, and
the actor is what a reader verifies. The reviewer works disposably, per
"Parallel agents in one checkout".

**Exact-head receipt.** The receipt binds one exact head, and the bot
actor above is what makes it a second party rather than a self-approval.
The reviewer posts one normal PR comment in this exact shape (replacing
every placeholder):

```text
HEAD: <40-lowercase-hex>
VERDICT: APPROVE

1. <numbered finding, or explicit no-finding scope>

Mutation audit: <hostile mutation results>
Claim audit: <SUPPORTED and OVERSTATED results>
Full-gate and flake evidence: <commands, results, and capability boundaries>
Scratch cleanup: <disposable workspace and residue result>

- <Agent> (adversarial reviewer)
```

The verdict line may instead be exactly `VERDICT: REQUEST-CHANGES`. Any head
change invalidates the receipt. The author replies with reproduction and repair
evidence; a fresh independent context re-reviews the new exact head. If the
owner merges first, record a post-merge audit and classify—not erase—the gap.

**The review must:**

1. Audit every claim in the PR body and commit messages against the
   actual diffs, reproducing every number the body cites. Overstatement
   is a finding even when the code is right.
2. Build a mutation kill matrix: for each guard or test the PR adds or
   changes, apply the exact regression it claims to prevent — the suite
   must go red. Revert between mutations. A surviving mutant is a
   finding.
3. Probe for vacuity: a guard that cannot fail is no guard. For each new
   or changed assertion, demonstrate at least one input that turns it
   red; an assertion no input can fail is decorative, and decorative
   checks are findings.
4. Probe for flakes: run the focused checks the findings need, plus the
   race detector where the language has one, and re-run the full suite
   when there is specific cause. Any nondeterminism is a finding naming
   the test.
5. Check hygiene: commit identity (owner noreply in BOTH author and
   committer), signature conventions and agent labels, no co-author
   trailers, secret scan clean, out-of-lane paths untouched.
6. Check doctrine: nothing weakened — every gate, validator, or test
   change is additive or strengthening; exceptions are narrow, named,
   and justified where the owner will read them.
7. For CI-invisible paths (jobs that run only on pushes to main), demand
   simulated evidence of both directions in the PR and treat the first
   post-merge run as part of the change under review.

**Verdict format** — posted as a normal PR comment, so every vendor and the
owner see the identical record: one exact `HEAD:` line and one exact
`VERDICT: APPROVE` or `VERDICT: REQUEST-CHANGES` line; numbered findings with
severity and file:line; the mutation kill matrix; flake
results; a claim-audit table (SUPPORTED / OVERSTATED per claim); explicit
"no finding — checked X, Y, Z" statements so silence is never ambiguous;
confirmation the scratch workspace was removed; the reviewing agent's
signature in the form `- <Agent> (adversarial reviewer)`, matching its
agent label. Posting the verdict also removes the `requires-review`
label, whichever way the verdict went — the item is no longer waiting on
review attention. A REQUEST-CHANGES verdict returns the work to the same
branch owner — fixes land on the same branch and receive a delta
re-review of the changed scope. A PR flips from draft to ready only
after an APPROVE verdict (or after findings are fixed and re-verified),
and the evidence comment remains on the PR as the permanent record.

A green check, a peer approval, or a ready state is evidence, never
authority: the owner alone merges.

### After review, Ready

Once the independent adversarial review has approved the exact final head and
all required checks are green, the coordinator flips Ready and the owner
merges. No third distinct-context pass is required.

## GitHub conventions

- **Issues first.** Substantive work is tracked as a labeled issue before or
  alongside its PR; PRs use an exact standalone `Closes #N` line for an issue
  in the same repository so GitHub closes it only when the owner merges.
  Feature intake lands as a `features`-labeled issue with the architectural
  constraints stated, even when implementation waits.
- **Labels.** One taxonomy, identical names/colors/meanings across all
  three repositories: `production-readiness`, `conventions`, `security`,
  `tests`, `ci`, `docs`, `release`, `fix`, `provider-neutrality`,
  `delivery-lane`, `features`, `requires-review`,
  `cybersecurity-review-requested` (routing label for the security-specialist
  fleet — must not be removed until the security verdict clears),
  `daybreak-blue`, `priority-high`, `inprogress`, `dependencies` (auto-applied
  by Dependabot; no `labels:` key exists in `dependabot.yml`). New labels are
  added to all three at once.
- **`requires-review` — the review-readiness signal.** `requires-review` is
  PR-head-only. The author applies it only when the exact PR head, body,
  commits, and evidence are author-complete. Its absence means the author PR is
  in flight; its presence requests exact-head independent review. The reviewer
  removes it when posting either verdict; after repairs, the author reapplies it
  only for the complete replacement head. Never apply or interpret it on an
  issue; an issue has no head and cannot satisfy a PR receipt or Ready gate. Use
  an explicit normal comment for issue-spec review until a separately approved
  issue-review label exists. It is a coordination signal only: never a
  substitute for draft/ready state, for the APPROVE verdict that flips a PR
  ready, or for owner merge authority. Ordinary labels, body text, and
  process comments are coordination signals, never security invariants;
  the App-posted exact-head review verdict — its posting actor and the
  head it binds — remains control evidence, alongside the signed-commit
  and protected-main chain.
- **Agent labels.** Every agent-created PR and issue carries TWO further
  labels: the umbrella `agent-authored` AND the acting agent's own label —
  `fable5` (Claude Fable 5), `5.6-sol` (ChatGPT 5.6 SOL ULTRA), `opus5`
  (Claude Opus 5), `opus4.8` (Claude Opus 4.8), `sonnet5` (Claude
  Sonnet 5, color `0EA5E9`). The body signature must match the label
  (`- Fable5` ↔ `fable5`), and adversarial-review verdicts carry the
  same identity as `- <Agent> (adversarial reviewer)`. Labels plus
  signatures keep authorship auditable across the parallel frontier-model
  lanes with no owner relay. When a new model joins, its label — description "Authored by
  <model>" — is created in ALL THREE repositories before its first PR,
  per the one-taxonomy rule.
- **PR budget.** At most 3 agent PRs open in this repository by default;
  parallel pushes beyond that need explicit owner authorization first.
- **Merge authority.** THE OWNER ALONE MERGES. Never merge, never
  self-approve, never treat a peer approval or a green check as
  authority, and never force-push a shared ref. Every PR opens as a
  draft.
- **Milestones.** Every PR and issue carries one. Release milestones close
  when the release ships; completed arcs close their milestone.
- **Assignee.** The owner is assignee on every PR and issue (authorship is
  already the owner's account by token identity).
- **Linear history.** Merge commits are disabled in repository settings;
  the owner merges by squash or rebase. The release contract accepts either
  the one-commit squash range or a multi-commit rebase range and binds one
  release to its exact final tree. Branches auto-delete on merge; stale local
  branches are pruned as work lands. History is append-only and never rewritten.
- **Commits.** Detailed bodies to the review protocol's evidence standard —
  problem, mechanism, enumerated changes, evidence — signed per lane.
- **Dependabot.** Dependency PRs obey the same issue/milestone/assignee,
  next-patch, changelog, exact-head review, CI, and base-freshness controls.
  Infrastructure/tool outages are reported as infrastructure failures; they do
  not waive a real product failure or justify lowering this repository's
  coverage floor. When Dependabot splits a version-locked pair into
  separate PRs, one agent PR supersedes BOTH, bundling the pair AND fixing
  the root cause in the same commit with a `dependabot.yml` `groups:` stanza
  scoped to that pair, so the split cannot recur; the split and merged
  precedents are listed in `docs/agent-git-mechanics.md`.
- **Merge readiness.** Draft remains Draft until every check is successful at
  the exact head, the base equals current protected `main`, all discussions and
  findings are resolved, a fresh exact-head APPROVE receipt exists, the next patch
  still follows that base for an artifact-classified PR (a documentation-only
  PR reserves no patch at all), the automatic release consequence is proven, and
  the owner-observed release-control receipt proves immutable releases plus
  strict exact required checks, and the owner's separate bypass check reports
  no bypass actor — the receipt carries no bypass field. Only the coordinator
  flips Ready. The author and reviewer never do.

## Parallel agents in one checkout

Several agents — different models and vendors, executors and reviewers — work
this repository at once, sometimes on one machine. Git worktrees are the
isolation mechanism, and these rules bind every lane whether or not any
vendor-specific tooling is present.

- **The shared checkout is nobody's workspace.** It stays on `main`, clean, and
  is used only for coordination — `git fetch`, worktree creation and removal,
  ceremony reads. No agent builds, edits, or checks out a branch there. It may
  lag `origin/main` harmlessly: every actor works from `origin/main` after its
  own `git fetch origin`, never from a local `main`.
- **One worktree per acting context, named for its lane.** Branch names
  follow the grammar in "Working a change end to end" step 2. Executors run
  `git worktree add .claude/worktrees/<lane>-<effort>-<issue#>-<topic> -b
  <lane>-<effort>/<issue#>-<topic> origin/main`; the legacy
  `git worktree add .claude/worktrees/<lane>-<topic> -b <lane>/<topic>
  origin/main` form remains accepted during the transition. Either way, the
  directory and the branch carry the SAME lane, because the
  cleanup rule below depends on ownership being legible to every other agent.
  A worktree whose name and branch disagree, or a branch with no lane prefix,
  is a contract violation.
- **Reviewers work disposably.** A detached-HEAD worktree at the exact pull
  request head (`git worktree add .claude/worktrees/<lane>-review-<PR#>
  <headSHA>`), removed once the receipt posts. A reviewer stays read-only
  toward every other workspace and reverts every experiment inside its own.
- **One writer per branch, one branch per worktree.** A worktree that is not
  yours is a worktree you never write to. Treat reads with care: a tree that
  advances under you mid-operation is a live executor, not stale state.
- **Some git state is shared — that is the trap.** HEAD, index, and working
  tree are per-worktree; refs, remotes, config, and stash are repository-wide.
  So `git fetch`, `git branch -d/-D`, and `git worktree prune` act on every lane
  at once: run them only from the main checkout during deliberate cleanup,
  never mid-task. Never `git config` anything — identity is env-pinned per
  command per "Commit identity mechanics", and one lane's config write poisons
  all of them. A branch checked out in any worktree cannot be deleted or
  checked out elsewhere; that lock marks live ownership.
- **Clean only your own lane, and only after the owner merges.** Confirm the
  merge against the remote, then remove your worktree and delete your branch
  from the main checkout with `git worktree remove` and `git branch -d` — no
  `--force`, no `-D`. Those refusals are the safety net: a dirty tree or an
  unmerged branch is somebody's live work, very possibly another lane running
  right now. Another lane's leftovers are that lane's to remove.
- **Shared machines contend.** Heavy suites in several worktrees compete for CPU
  and load-sensitive tests can flake under contention. Treat a contention flake
  as an environment finding — name it, rerun it, never weaken the test — and
  stagger the heaviest batteries when many lanes run at once. Browser-lane runs
  on a shared machine must also set `SITE_PORT` to a private port, because
  `frontend/playwright.config.mjs` defaults to 8080 with `reuseExistingServer`
  outside CI, and cross-lane servers have been measured answering another
  lane's probes.

## Working a change end to end

The complete delivery loop, each step gated by the sections around it:

1. **Claim the work.** File (or take) the issue; state intent and
   constraints. Label it — including both agent labels — assign the
   owner, set a milestone. Never apply or interpret `requires-review` on the
   issue; use an explicit normal comment when its specification needs review.
2. **Branch from `origin/main`** after `git fetch origin`; branch names
   are lane-prefixed. The preferred grammar for new branches is
   `<lane>-<effort>/<issue#>-<topic>` (e.g. `sonnet5-med/155-rail-idle-ink`,
   `fable5-high/142-usage-export`), carrying the dispatched reasoning effort
   (`low | med | high | xhigh | max`; `xhigh` admitted by owner ruling,
   2026-09-03) and the tracking issue number; `<lane>` is
   parsed by longest match against the repository-registered label set
   (`fable5`, `5.6-sol`, `opus5`, `opus4.8`, `sonnet5`), then the
   `-<effort>` suffix. A branch with genuinely no issue states why in its PR
   body. The legacy form (`<lane>/<topic>`, e.g. `sonnet5/contracts-0.1.13`,
   `opus5/panels-fix`) remains accepted during the transition. One writer
   per branch, always —
   a branch that is not yours is a branch you never push to. Reserve the exact
   next patch from that base when the change touches any artifact surface; a
   documentation-only change (requirement 10's closed allowlist) reserves no
   patch and must leave every release lock untouched. If another PR lands, create a fresh branch from
   current main, carry the still-valid diff without rewriting published
   history, take the new next patch, and close/supersede the stale PR.
3. **Build the change** inside the requirements and doctrine above.
   Docs-only diffs still run the gates.
4. **Run the full local gate** ("Quality gates" below), then both secret
   scans, then commit under the pinned identity with a body to the
   evidence standard, ending with your signature.
5. **Push and open a DRAFT PR**: `Closes #N`, the same labels, owner as
   assignee, a milestone, body signed. Every number in the body must be
   reproducible — the adversarial review will reproduce it. Apply
   `requires-review` once the PR is complete-from-author — every commit
   pushed, the body final; until it carries that label, nobody reviews
   it.
6. **Adversarial review** per the protocol above; findings are fixed on
   the same branch by the same writer and delta re-reviewed before the
   flip to ready.
7. **Prove server release controls.** For an automatic-release change, the
   repository owner runs the GET-only preflight in
   `docs/release-governance.md` AND, separately, that document's standalone
   bypass command — the preflight reads no bypass field under any credential.
   Immutable releases and strict current-base required checks must be exact,
   and the bypass-actor list must be empty, before Ready.
8. **Owner comments** are handled per the owner review protocol below.
9. **The owner merges.** Nothing you can do — approval, green checks,
   ready state — substitutes for that.

## Commit identity mechanics

Requirement 3, made operational. The identity — BOTH author and
committer, on every outgoing commit — is exactly:

    Samuel Naranjo <39077795+snaraj@users.noreply.github.com>

- Pin it per command with environment variables, never with `git config`
  (repository or global): configuration outlives the session, leaks into
  unrelated work, and hides identity decisions from review.

      GIT_AUTHOR_NAME='Samuel Naranjo' \
      GIT_AUTHOR_EMAIL='39077795+snaraj@users.noreply.github.com' \
      GIT_COMMITTER_NAME='Samuel Naranjo' \
      GIT_COMMITTER_EMAIL='39077795+snaraj@users.noreply.github.com' \
      git commit ...

- Agent commits are SSH-signed per command with the owner-registered
  signing key, never via `git config`. **Select that key explicitly.** The
  obvious form is broken:

      # BROKEN whenever more than one ed25519 key is loaded
      -c user.signingkey="key::$(ssh-add -L | grep ssh-ed25519)"

  `grep` matches EVERY ed25519 line, so `key::` receives a multi-line
  value and signing fails on a malformed key — not an exotic setup, and
  `docs/agent-git-mechanics.md` records how often it has bitten. Ask GitHub
  which key is registered for SIGNING, intersect that with what the agent
  actually holds, and require exactly one match. That selection names no key
  comment, no hostname, and no ordering, so it works unchanged from any
  machine the owner signs on:

      signing_key() {
        local matched
        matched="$(comm -12 \
          <(gh api /users/snaraj/ssh_signing_keys --jq '.[].key' | sort) \
          <(ssh-add -L | awk '{print $1, $2}' | sort))"
        test "$(printf '%s' "${matched}" | grep -c '')" -eq 1 || {
          printf 'expected exactly one registered signing key in the agent\n' >&2
          return 1
        }
        printf '%s' "${matched}"
      }

      git -c gpg.format=ssh \
          -c user.signingkey="key::$(signing_key)" \
          commit -S ...

  Every agent commit must show as Verified. Signature enforcement on
  `main` is a protected-branch setting, not repository-wide, so it never
  blocks the owner's own merges from a machine without this key.
- **Verifying a signature locally needs a SPACE-FREE principal — and the
  negative control lies when it is wrong.** Local verification reads an
  allowed-signers file whose first field is a principal:

      printf '%s %s\n' '39077795+snaraj@users.noreply.github.com' \
        "$(signing_key)" > "${allowed}"
      git -c gpg.ssh.allowedSignersFile="${allowed}" \
          log --format='%H %G? %GS' -1 <sha>

  Use the BARE email: a name-plus-angle-brackets principal makes ssh read
  the space as a field break and match nothing, and that failure is
  indistinguishable from a genuine wrong key. Run BOTH controls and require
  them to DIFFER — the positive control must print `G`, and the negative
  control, with only some OTHER key in the file, must print `U`. If the
  positive control is not `G`, the file is broken; repair it before
  believing anything the negative one says. `docs/agent-git-mechanics.md`
  records the trap in full.
- EVERY authorized commit runs under the same pinned environment. Agents do
  not amend, rebase, cherry-pick onto a published branch, or rewrite history;
  use additive commits or a fresh branch from current main.
- No `Co-Authored-By` trailers, ever. Agent-authored commit bodies, PR
  bodies, and issue bodies end with the ACTING agent's own signature,
  matching its agent label per the roster (`- Fable5` ↔ `fable5`,
  `- Sonnet5` ↔ `sonnet5`, `- Opus5` ↔ `opus5`, `- 5.6 Sol` ↔
  `5.6-sol`) — never a different lane's name and never a fixed default.
- Treat the Git index as public (requirement 12): no hostname, IP
  address, machine or account identifier, username, workspace path,
  token, or private operational fact enters any commit, message,
  fixture, or doc — what reaches history cannot be unpublished.

## Owner review protocol

Comments the owner leaves on PRs ARE code reviews — address each
promptly, reply IN-THREAD per comment describing the resolution, then
notify the owner the PR is ready to re-check; never mark a PR ready
with unaddressed owner comments.

## Dependent pull requests

Dependent work may be described as a merge order, but every eventual
artifact-classified PR to protected main must independently carry its next
patch release; a documentation-only PR carries none and is never a release
dependency. Keep a
dependent PR Draft until its predecessor lands. Then fetch current main, create
a fresh branch without force/rebase, port only the residual diff, allocate the
new exact patch, rerun every gate, open a replacement Draft PR, and obtain a
fresh exact-head review. Never retarget or merge a dependency stack in a way
that duplicates predecessor content.

## Quality gates — exact commands and patterns

The full local gate, in order, before every push — docs-only diffs
included; it is the same battery CI enforces:

    cd frontend && npm ci --ignore-scripts --no-audit --no-fund && \
      npm run check && npm test && npm run build && cd ..
    test -z "$(gofmt -l .)"
    go vet ./...
    CGO_ENABLED=0 go test ./...
    go test -race ./...
    helm lint chart && helm template smoke chart \
      --kube-version v1.36.0                    # chart changes
    ./scripts/ci/chart-ingress-pin.sh           # chart changes
    ./scripts/ci/chart-egress-pin.sh            # chart changes
    ./scripts/ci/chart-storage-pin.sh           # chart changes
    ./scripts/ci/chart-media-pin.sh             # chart changes
    docker build .                              # Dockerfile/build-input changes
    gitleaks git --no-banner --redact --max-target-megabytes=2 .
    gitleaks dir --no-banner --redact .

The rendering-lane smoke matrix is its own workflow and its own local command,
because it needs browser engines rather than only Node. Run it for any change
that touches layout, the stylesheet, or a component's rendered shape:

    cd frontend && npm run build && \
      npx playwright install chromium firefox webkit && \
      npm run test:browsers                     # frontend rendering changes

The full local gate does not substitute for the server boundary. Automatic
release work additionally requires the owner-observed, value-only receipt in
`docs/release-governance.md`; because the current branch has no authority to
repair its own protection, an inexact receipt is an intentional Ready blocker.

- **Coverage floor.** `GO_COVERAGE_FLOOR` is 93.2 (measured 96.2 when
  last raised), enforced in `.github/workflows/pr-gate.yml` on total
  production statements with `internal/testsupport` filtered from the
  profile — the ONLY exclusion, and it may never grow to cover
  production packages. Ratchet only (requirement 7).
- **Perf budgets are tests.** Payload caps ship as pinned suite
  assertions, so a budget regression is a red build, never a discussion:
  the panels API pins `MaxIndexResponseBytes` = 4096 and
  `MaxPanelResponseBytes` = 131072. That second cap is the same NUMBER as
  `seal.MaxSealedBytes` and NOT the same ceiling — the two bound different
  bytes, the sealed FILE versus the finished ENVELOPE, so a file at exactly
  the transport ceiling is refused at serve time. A budget the owner
  revises is still a budget: the bound stays refuse-not-truncate and stays
  pinned (`TestResponsesStayWithinTheOwnerBudgets`,
  `internal/panels/handler_test.go`), and construction/refresh refuse
  over-budget payloads instead of serving them. Every new surface lands
  with its caps pinned the same way; `docs/panels-invariants.md` records
  how the current numbers were measured and set.
- **Ratchet pairs.** When a stated requirement and shipped behavior
  disagree across lanes, record the gap loudly instead of greenwashing
  it: one green test pins current behavior, and a paired
  expected-failure test asserts the pending contract, flipping the
  suite red the day the implementation tightens — which forces the
  marker's removal and turns the note into an enforced rule. Go suites here
  express that pair as a behavior pin plus a named pending-contract test
  documented in its comment.
- **Secret scan, both modes.** `gitleaks git` (full history) AND
  `gitleaks dir` (working tree) run before every push — the same scans
  CI runs. Exceptions live only in `.gitleaksignore` as commit-scoped
  fingerprints (`commit:file:rule:line`) with an in-file justification,
  admitted only for verified false positives already in pushed history;
  the working tree must always scan clean WITHOUT them.
- **Flake probe.** The author runs the complete local gate ONCE on the
  final head; the reviewer runs the focused checks its findings need and
  MAY re-run the full suite when it has specific cause. Any
  nondeterminism is a finding naming the test.

## CI map

- **pr-gate.yml** — pull requests AND pushes to `main` (plus manual
  dispatch): `security` (checksum-verified tool install, actionlint,
  `gitleaks git` over full history, `gitleaks dir`),
  `dependency-review` (PRs only; fails on high severity), `application`
  (toolchain pinned AND verified — Node 24.19.0, npm 11.17.0,
  Go 1.26.6; frontend check/test/build; gofmt/vet/tests/race; the
  coverage floor), `chart` (the four chart pin scripts; helm lint + render
  at `--kube-version v1.36.0`; the numeric VERSION ↔ numeric chart
  `version` ↔ numeric `appVersion` ↔ plain-v chart `image.tag` four-way
  lock, plus a render assertion that the emitted reference still carries a
  full digest), `container` (PRs only, like `dependency-review`; both
  production architectures built, never published). `container` remains a
  REQUIRED pull-request check; `EXPECTED_MAIN_JOBS` in
  `scripts/ci/release_contract.py` expects `container` and
  `dependency-review` `skipped` on a main push and the other four
  successful, exact in both directions. What each chart pin proves, and why
  the two PR-only jobs carry no main trigger, is in `docs/ci-map.md`.
- **coverage-badges** — `main` pushes only: recomputes both coverages
  with the gate's own recipe and force-updates the generated
  single-commit `badges` branch. Badge numbers are CI-computed, never
  hand-edited; the badge publishes the identical number the gate
  enforced.
- **browser-lanes.yml** — pull requests and manual dispatch (no `main` push
  trigger): the rendering-lane smoke matrix (issue #26 stage 2), five
  projects against the real Go binary on localhost. It holds `contents:
  read` and nothing else, receives no secret, and publishes nothing.
  Deliberately NOT a job in `pr-gate.yml`: the release publisher authorizes
  against that workflow's exact job inventory. One honest limit: the engine
  builds are not checksum-verified the way `scripts/ci/install-tools.sh`
  verifies every other third-party binary, because no per-build digest is
  published — the exact pinned runner version, whose tarball integrity IS in
  the lockfile, is what selects and bounds them (`docs/ci-map.md`).
- **codeql.yml** — pull requests, `main` pushes, weekly cron.
- **release-after-main.yml** — success-only exact-SHA main-CI completion;
  performs no publication mutation and explicitly dispatches the publisher
  definition on protected `main` with the exact completed-run ID.
  It re-proves the gate's published transition class against an anchor the
  verdict cannot choose — not from the claimed base alone, which is
  forgeable — and gates every release-effect step on `artifact`; a
  no-artifact range logs its verdict and dispatches nothing. Distinct main
  SHAs share no cancellation group.
- **release-publisher.yml** — explicit dispatch on protected `main`. Its
  read-only authorization job, exact source/tag/lock checks, checksum-pinned
  vulnerability gates including development dependencies, post-push
  image/chart alias resolution, raw per-platform SBOM binding, exact
  one-asset manifest staging, and terminal immutable Release/manifest/tag
  state are stated under Releases above; an ordinary manual/unmerged
  dispatch, skip flag, or force path cannot publish (requirement 10).
- **release-audit.yml** — weekly and manual, read-only audit of the latest
  immutable Release. It re-binds the successful run, annotated tag, exact
  manifest bytes, image/chart semantic aliases and digests, signatures,
  per-platform provenance/SBOM, chart source tree, and final image scan.
- **GitHub event basis.** Documented GitHub behaviour for
  `GITHUB_TOKEN`-created refs, `workflow_run` context, and concurrency
  ordering is why the success check, payload `head_sha`, tag-ref dispatch,
  and independent per-SHA paths are load-bearing. `docs/ci-map.md` states
  each documented behaviour and cites the three references.
- **Zero-spend guardrails.** Workflows declare top-level
  `permissions: {}` with narrow per-job read grants;
  `persist-credentials: false` on every checkout; GitHub-hosted
  `ubuntu-24.04` runners only; every action pinned to a full commit SHA
  with a version comment; third-party tools installed only through the
  checksum-verifying `scripts/ci/install-tools.sh`. No external service
  ever receives repository content or measurements — the self-hosted
  badge pipeline exists precisely so no coverage processor does.

## Frontend and UX floors

Owner directives (2026-08-11) for both site repositories; each
implements them independently — patterns may rhyme, but code, values,
and tests re-derive per repository (requirement 5):

- **Design tokens only.** `styles.css` is a CSS custom-property token
  layer: the light palette on `:root`, every further reading mode one
  `[data-theme]` override block, `prefers-color-scheme` mapping the
  dark tokens absent an explicit choice. Components consume tokens —
  never raw palette literals.
- **Dataviz floors.** A value is never encoded by color alone: pair
  color with position, text, or shape, and use palettes validated for
  contrast under every reading mode.
- **Rendering lanes, stage 1** (issue #26; static cross-browser floors
  pinned by frontend tests — iPhone/Android plus
  Safari/Chrome/Firefox/Edge): viewport meta with safe-area-inset
  padding; touch targets ≥ 44px; input font-size ≥ 16px; `svh`/`dvh`,
  never `100vh`; `@supports` fallbacks so rails and grids degrade
  gracefully; no horizontal body scroll at ≥ 320px (wide content
  scrolls inside its own container); `prefers-reduced-motion`
  respected; autoplaying video is `playsinline` and muted.
  Every floor is pinned where it is DECIDED — in the declarations,
  swept across `styles.css` and every component `<style>` alike, since
  a stylesheet-only sweep is blind to most of its own subject. Two of
  those pins are structural rather than textual and carry the load:
  a progressive value (a dynamic viewport unit, `env()`, `color-mix()`)
  must have a fallback under it, either an earlier plain declaration of
  the same property or an `@supports` block whose base sits outside the
  guard; and a reading-mode block may declare only custom properties and
  `color-scheme`, which is what makes the zero-CLS theme switch structural
  instead of a promise (`docs/panels-invariants.md`).
- **Rendering lanes, stage 2** (issue #26): `browser-lanes.yml` drives the
  built binary through Chromium (Chrome and Edge), Firefox and WebKit
  (Safari and every iOS browser), each at a desktop viewport plus an
  Android and an iPhone one, asserting the same floors as MEASURED
  boxes, computed styles and emulated preferences. It is a separate
  workflow on purpose: the publisher authorizes releases against
  `pr-gate.yml`'s exact job inventory, and a rendering smoke lane must
  not touch a release-authorization surface. The two halves answer
  different questions and neither replaces the other, so a floor lands
  with both.
- **Zero CLS.** Theme switches and async data arrivals cause no layout
  shift; space for late content is reserved up front.
- **Honest states.** Empty, loading, disabled, and unavailable states
  tell the truth: a missing backend renders an explicit unavailable
  state, never fabricated data or a pretend success path — the panels'
  provenance-truthful `status` field is the model.

## Security invariants beyond the numbered requirements

Structural promises of the panels subsystem, pinned by
`internal/panels`'s doctrine test:

- **Confined egress.** `internal/panels/fetch.go` is the ONLY
  egress-capable production file — HTTP client construction, request
  building, URL handling, and environment reads may exist nowhere
  else — and every other production file keeps a reviewed zero-egress
  import surface. Outbound requests are refused unless the host is on
  the configured allowlist (checked at construction AND again at
  request time), bounded by timeout and byte cap; credentials are read
  from the environment at fetch time only, flow straight into a request
  header, and are never stored, logged, or served.
- **Envelope versioning.** Every panel response is the `panel/v1`
  envelope `{schema, id, kind, title, generatedAt, status, data}` —
  stable forever by design. Evolution happens inside the kind-versioned
  payloads: a breaking payload change mints a NEW kind version, never
  mutates an existing one, never bends the outer shape.
- **Live refresh is a switch, and flipping it is an operational decision.**
  `PANELS_REFRESH` gates every background refresh loop; unset or `false`
  launches no loop at all, so egress is impossible rather than merely
  unattempted, and any other value fails the boot. Enabling it in a cluster
  needs three things together — `PANELS_REFRESH=true`, the credential
  variables named by `keyEnvName` in `internal/panels/config/fetch.json`
  supplied as Secrets, and an egress allowance for that file's `hosts`
  list. Enablement is a separate owner-reviewed step, and the chart ships
  `panels.refresh.enabled: true` TOGETHER with the egress allowance,
  because refresh without the allowance is a no-op and the allowance without
  refresh is an opening nothing uses, so the two move as one change or not at
  all. That allowance is EXACTLY two rules — TCP/443 to any address, and
  UDP+TCP/53 to the cluster DNS Pods selected by namespace AND pod labels —
  and it is NOT the host bound. A NetworkPolicy cannot express a host name,
  so the five hosts stay bounded in-process by `internal/panels/fetch.go`,
  checked at construction over every configured endpoint and again on every
  request, with private, loopback and link-local resolved addresses refused
  at dial time. Two layers, two different jobs; neither substitutes for the
  other, and a reader who sees the policy alone will reach the wrong
  conclusion. No key, and no reference to a key, ever lands here
  (requirement 12); a source whose variable is unset is skipped, never
  faked. README's "Enabling live refresh" section is the operator-facing
  copy of this, and both must move together.
- **Panels tell the truth about where a number came from.** The envelope's
  `status` carries provenance for the whole payload, and inside
  `token-usage/v1` each stat tile and insight carries `recorded` for its
  own. A figure captured out of band says so rather than borrowing the
  panel's freshness, an unreported figure serves `null` and renders as a
  dash rather than a zero, and an invented figure is a doctrine violation
  no matter how good the panel looks with it.
- **Vendor names are data, never code.** Tool and vendor names appear
  only as data labels inside snapshots and the embedded fetch config
  (see `vendorMarks` in `internal/panels/doctrine_test.go`); the pin
  scans production source bytes — identifiers, strings, and comments
  alike — so a provider swap is a data edit and the compiled binary
  carries no vendor coupling.

## Docs and attribution conventions

- **CHANGELOG discipline.** Keep a Changelog format; every artifact-classified
  PR immediately follows an empty `[Unreleased]` heading with its exact
  next-version and ISO date, matching every source lock; a documentation-only
  PR leaves `CHANGELOG.md` untouched (the file sits outside the documentation
  allowlist precisely so a no-release range can never claim one). There is no
  later release PR. Released history below that new heading is APPEND-ONLY and
  the gate proves it (issue #105): `release_contract.py` refuses a snapshot
  whose released ladder is not strictly descending with non-increasing dates,
  and refuses any base-to-head range that removes, reorders, duplicates, or
  rewrites one byte of a released block; `docs/release-classifier.md` records
  the plausible mechanical edit this closes. Exactly one narrow lift exists: a released heading's
  DATE may move from one stated value to another through a reasoned line in
  `scripts/ci/changelog-correction-allowlist.txt`, which is spent the moment it
  lands. Nothing lifts a deletion, a reorder, or a rewritten entry.
- **Truthful README.** Badges and claims report only what CI actually
  measured or the repository can demonstrate — the coverage badges
  publish the gate's own numbers, and prose never advertises a
  capability or deployment state that does not exist yet.
- **Attribution for third-party assets.** Every third-party asset lands
  with its reviewed license; any webfont lands together with its license
  in `frontend/src/assets/fonts/` (JetBrains Mono and Archivo ship there
  beside their OFL texts). Where Jagex game art or intellectual property is
  used — the OSRS boss-log panel — the exact Fan Content Policy notice is
  recorded in `ATTRIBUTION.md`, word for word, pinned by a frontend test. The
  page itself does not print it (owner directive, 2026-09-04, issue #292).
