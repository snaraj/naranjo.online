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

## Why coverage badges publish outside the PR gate

Until issue #350 the badge push was a `coverage-badges` job inside
`pr-gate.yml`, and two facts made that wrong. The release publisher authorizes
against that workflow's exact job inventory, so a transport failure on a
generated branch held back a release whose tests, chart and scans had all
passed. And main pushes share no gate concurrency group, so two runs could
finish out of order and the older one force-push its numbers over the newer.

Now the gate's `application` job hands its two measured totals, with its
commit and run ID, to the `coverage-totals` artifact on main pushes, after
both measurement steps passed, and `coverage-badges.yml` publishes them after
a successful protected-main gate run. Nothing is re-measured, and no release
input reads the outcome: `EXPECTED_MAIN_JOBS` has no badge job (one carried
back into the gate is refused as foreign), and `release-after-main.yml`
follows the PR gate alone. `scripts/ci/coverage_badges.py` refuses totals
bound to another commit or run, and orders publications by history: the
badge commit's subject (`coverage badges for <sha>`) and `source.json` record
the measured commit, a newer or equal commit replaces the badges, an older one
stands down successfully, and a badge head it cannot place fails. The push is
leased on the badge head the decision read and bounded at five attempts; a
lost answer is recognised as published. Deleting the `badges` branch is the
recovery from a head nobody can place. `scripts/ci/test_coverage_badges.py`
proves each of those against real git, including two runs completing in
reverse order and a race lost to a newer publisher.

## What the compliance gate proves, and where it cannot reach

`compliance.json` states what the site stores on a visitor's device and when,
which third-party origins a page may contact (none today), which legal pages
exist, and which edge behaviours are known and why (issue #355). Three
checks hold the site to it, and each answers a different question:

- `scripts/ci/test_compliance_manifest.py`, in the PR gate's contract suites,
  keeps the manifest valid and current: a closed schema (a present section,
  `null` included, must be a list); a storage entry only while a frontend file
  still WRITES that name as that kind, and no write the manifest leaves
  undeclared; evidence files that still exist; and the judging rules
  themselves, each refused on its own. A write is what
  `compliance_manifest.py`'s `storage_writes` grammar reads -- a
  `document.cookie` assignment by literal name, or a `setItem` whose key is a
  literal or a bound constant on a named store, found in code only -- so a
  read, a string, template or regular expression however write-shaped, a
  comment, Svelte markup or a test file keeps nothing alive, and a write the
  grammar cannot attribute, a key built at run time included, is refused
  rather than ignored.
- `frontend/e2e/compliance.spec.mjs`, in the browser lanes, drives the shipped
  binary in every engine: no request to an undeclared origin, no CSP
  violation, nothing written to the device before the visitor acts, the
  WCAG 2.1 floors a browser can measure (page language, image `alt`, an
  accessible name on every visible control, no positive `tabindex`, and on
  every keyboard stop a focus indicator that PAINTS -- an outline or a
  box-shadow whose colour is not transparent and whose width or extent is not
  zero; its contrast against the page is not measured), no credential-shaped
  literal in the served document, scripts or stylesheets, and every published
  legal page linked and served. The focus measurement is itself proven able
  to refuse, in every engine, against indicators that paint nothing.
- `compliance-live.yml`, weekly and on demand, GETs production and judges what
  the edge serves: the answer read whole (a body past 2 MiB, or short of its
  `Content-Length`, fails rather than being judged by its prefix); CSP fetch
  directives admit no undeclared origin, wildcard, bare scheme or
  `'unsafe-inline'` script source; a declared injected script passes only
  while some enforced policy blocks every inline script, because that block is
  the declaration's reason; framing is denied; HSTS lasts a year; nosniff and
  a Referrer-Policy are present; the document sets no cookie; every reporting
  endpoint and every script, stylesheet or embed in the served HTML is this
  origin's or declared; every published legal page answers 200. It also runs
  on a pull request that changes the judge, so the judge is proven against
  the live site before it merges, but not on one that only edits the
  manifest, which often declares what the next deployment ships.

A declared entry that no longer occurs is refused as stale, so no exemption
outlives its case. A refusal a manifest line can lift prints that line; the
rest -- a missing header, a cookie on the document, a write on load, an
injected script the CSP can let run, an incomplete answer -- print none,
because they need a code, policy or owner decision. What none of the three
can see: what a visitor's device writes after they act, a screen reader's
actual reading, and anything only a lawyer can judge. The manifest's
`storage` list is the disclosure for the first, kept honest against the
writes the source makes, in both directions.

## The documented GitHub behaviours the release path depends on

GitHub documents that `GITHUB_TOKEN`-created refs suppress recursive workflow
events except explicit dispatch, that `workflow_run` fires regardless of
conclusion and uses default-branch context, and that concurrency ordering is
not a release ledger. Therefore the success check, payload `head_sha`, tag-ref
dispatch, and independent per-SHA paths are load-bearing.

- <https://docs.github.com/en/actions/concepts/security/github_token>
- <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run>
- <https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency>
