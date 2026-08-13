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
- Exactly squash and rebase enabled; merge commits disabled in both repository
  settings and the active `Protect-Main` ruleset.
- Pull requests and linear history required on `main`.
- Every required PR and CodeQL job bound to the GitHub Actions integration,
  with strict current-branch testing enabled.
- Force pushes and deletion denied.
- No ruleset bypass actor and no `update` restriction that would require the
  repository owner to bypass the rules merely to merge a passing pull request.

The repository owner remains the only person who chooses squash or rebase and
performs the merge. The settings receipt grants no merge authority.

## Read-only authoritative preflight

The preflight uses `gh api --method GET` only, with GitHub REST API version
`2026-03-10`. It reads the repository settings, immutable-release setting,
ruleset inventory, and the one active repository-owned `Protect-Main` ruleset.
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
  "allow_deletions": false,
  "allow_force_pushes": false,
  "branch": "main",
  "bypass_actors": [],
  "immutable_releases": true,
  "merge_methods": ["rebase", "squash"],
  "repository": "snaraj/naranjo.online",
  "require_linear_history": true,
  "require_pull_request": true,
  "required_status_checks": [
    {"context": "analyze (go, manual)", "integration_id": 15368},
    {"context": "analyze (javascript-typescript, none)", "integration_id": 15368},
    {"context": "application", "integration_id": 15368},
    {"context": "chart", "integration_id": 15368},
    {"context": "container", "integration_id": 15368},
    {"context": "dependency-review", "integration_id": 15368},
    {"context": "security", "integration_id": 15368}
  ],
  "restrict_updates": false,
  "strict_status_checks": true
}
```

Missing, extra, duplicated, name-only, foreign-integration, inverted, stale, or
bypass-bearing state fails closed. A successful receipt is necessary but not
sufficient for Ready: exact-head CI, current base, resolved findings, and a
fresh independent approval are still required. The coordinator alone changes
the Draft/Ready state, and the repository owner alone merges.

GitHub documents the immutable-release control and its protected tag/asset
behavior in [Immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases),
and documents strict required checks in the
[repository rulesets REST contract](https://docs.github.com/en/rest/repos/rules).

- 5.6 Sol
