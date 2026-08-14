<!-- Agent-authored PRs open Draft. Delete no section; write "none" where empty. -->

## Summary

## Issue

Closes #<!-- same-repository issue number -->

## Exact identity and release consequence

- Protected base: `main` @ <!-- 40-hex sha -->
- Exact head: <!-- 40-hex sha; update after every author push -->
- Next patch release: `vX.Y.Z`
- numeric `VERSION`/chart/changelog `X.Y.Z` maps exactly to plain `vX.Y.Z`
  Git/image tags and numeric Helm OCI chart tag: yes/no
- Release publication is separate from deployment/promotion: confirm

## Scope and exclusions

- Files owned:
- Deliberately excluded:
- Predecessors / successors / collision paths: none

## Evidence

| Command or check | Result |
| --- | --- |
| Release transition and hostile event/state suite | |
| Exact PR-gate jobs + exact-SHA CodeQL run/jobs and manual/unmerged dispatch denial | |
| Post-push image/chart alias rebind + strict raw platform SBOM hostile suite | |
| Deterministic manifest, dev-dependency vulnerability policy, and recurring alias-audit hostile suite | |
| Required CI, coverage, security, and quality checks | |

## Exact-head review

- `requires-review` applied only after author completion: pending/yes
- Immutable-release + strict required-checks/no-bypass settings receipt: pending/exact
- Independent normal-comment verdict bound to exact head: pending
- Main Worker exact-head bounded receipt (normal comment with exact
  `HEAD: <40-lowercase-hex>`, `ROLE: MAIN-WORKER`, `VERDICT: PASS`,
  `SCOPE: architecture,merge-order,authority,settings,base-freshness,required-checks`,
  one blank line, and final `- <distinct context> (Main Worker)`): pending
- Base freshness and successful required checks re-verified before Ready: pending

## Residual risks

## Rollback
