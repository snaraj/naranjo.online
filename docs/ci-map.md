# CI map — what each pin proves, and why the triggers are what they are

`AGENTS.md` "CI map" names the workflows, their triggers, and the rules that
bind an author. This document carries the per-pin detail and the reasoning
behind two trigger decisions. It adds no rule.

## What the four chart pins prove

- **`scripts/ci/chart-ingress-pin.sh`** — the ingress peer-identity pin.
  Beyond the default render, the refusal of an unpinned instance, and the
  proof that the instance is what separates one connector from another, it
  has since issue #95 proved two more things over the COMPLETE render rather
  than one `--show-only` extract: the single policy's ingress sub-tree,
  extracted through `chart_render_census.py`'s document reader and compared
  byte for byte against the canonical text built from values; and fourteen
  hostile whole-render shapes refused by that extraction ALONE. Four of those
  shapes are the ones PR #94 proved this gate used to exit 0 on, where a
  second policy spelled `kind :`, quoted, escaped, or wrapped in a List
  admitted a peer the raw-line extraction never saw.
- **`scripts/ci/chart-egress-pin.sh`** — the whole-render outbound-allowance
  census: exactly two egress rules (TCP/443, and cluster DNS over UDP+TCP/53),
  pinned as whole sub-trees and proven refusable against 31 text and 66
  census mutations. It replaced the total deny the owner retired on
  2026-08-27. The bound on WHICH hosts may be reached is not here — it is
  in-process, per `AGENTS.md` "Security invariants beyond the numbered
  requirements".
- **`scripts/ci/chart-media-pin.sh`** — the media enablement pin: media on by
  default as exactly one read-only volume at both levels, an incompletely
  specified enablement unrepresentable, and no media at all when it is
  explicitly disabled.
- **`scripts/ci/chart-storage-pin.sh`** — the panels storage pin.

## Why `container` has no main-push trigger

`container` remains a REQUIRED pull-request check. What it no longer does is
rebuild the identical tree a second time on the main push, where it gated
nothing: squash/rebase-only merges under strict required checks land the exact
tree it already built, and the released bytes are still built, scanned, signed
and attested by `release-publisher.yml`.

## Why `browser-lanes.yml` has no main-push trigger

The same reason, from the rendering side: the merged tree is the tree these
engines already rendered, and this lane reads nothing outside that tree, so a
repeat run measures identical bytes after merge authority has been exercised.

Its one honest limit, restated for a reviewer: the engine builds arrive from
Playwright's CDN over TLS and are not checksum-verified the way
`scripts/ci/install-tools.sh` verifies every other third-party binary, because
no per-build digest is published to verify against. What IS pinned is the
exact runner version, whose tarball integrity is in the committed lockfile and
which selects the engine revisions. The job installs that exact pinned
`@playwright/test` from the lockfile and restores the engine cache keyed on
that version.

## The documented GitHub behaviours the release path depends on

GitHub documents that `GITHUB_TOKEN`-created refs suppress recursive workflow
events except explicit dispatch, that `workflow_run` fires regardless of
conclusion and uses default-branch context, and that concurrency ordering is
not a release ledger. Therefore the success check, payload `head_sha`, tag-ref
dispatch, and independent per-SHA paths are load-bearing.

- <https://docs.github.com/en/actions/concepts/security/github_token>
- <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run>
- <https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency>
