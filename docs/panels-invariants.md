# Panels and UX floors — how the pinned numbers were arrived at

`AGENTS.md` carries the rules: payload caps ship as pinned suite assertions,
the UX floors are pinned where they are decided, and media enablement is chart
configuration plus evidence rather than code weakening. This document carries
the measurements and history behind those numbers. It adds no rule.

## The panels payload budgets

`MaxPanelResponseBytes` is 131072, raised from 32768 by the owner on
2026-08-24. Full-depth token-usage history structurally reaches 104,508 bytes
served with the v2 models section — issue #170 measured it; the 115,981 figure
recorded beforehand was a projection — and the old gate, chosen before any
real content existed, would have refused exactly the documents the sealed-data
pipeline exists to deliver.

It is now the same NUMBER as `seal.MaxSealedBytes`, which means the serve step
no longer hides a smaller ceiling than the transport steps. It does NOT mean
one ceiling governs both, and reading it that way was a finding of the
2026-08-25 round-4 review. The two bound different bytes: the sealed FILE
versus the finished ENVELOPE, which also carries the embedded snapshot,
measured at +875 bytes for the maximal admissible document. A file at exactly
the transport ceiling is refused at serve time, and the refusal — never a
truncation — is what the guarantee actually rests on.

## Why two of the rendering-lane pins are structural

A progressive value (a dynamic viewport unit, `env()`, `color-mix()`) must
have a fallback under it, because an unsupported value is DROPPED — so an
unguarded one degrades to nothing rather than to less. A reading-mode block
may declare only custom properties and `color-scheme`, which is what makes the
zero-CLS theme switch structural instead of a promise.

Both are swept across `styles.css` and every component `<style>` alike,
because a stylesheet-only sweep is blind to most of its own subject.

Stage 1 and stage 2 answer different questions and neither replaces the other:
a source pin binds the next build on every engine including the ones no runner
has, while a lane proves this build survived a real cascade. Stage 2 was
owner-approved on 2026-08-23 jointly with the sibling repository.

## The ratchet-pair exemplar

The canonical exemplar of a green behavior pin paired with an
expected-failure pending-contract test lives in the platform repository
(`tests/security/test_containerd_cri_health_contract_matrix.py`). Go suites
here express the same pair as a behavior pin plus a named pending-contract
test documented in its comment.

## How media enablement arrived

The fail-closed media plumbing stayed fail-closed until the reviewed root and
measured concurrency budget existed. Issue #207 made the chart able to
DESCRIBE an enabled deployment: the values schema admits `media.enabled: true`
only together with a reviewed profile, a named claim, a mount path, and a
measured transfer budget.

On 2026-08-27 the evidence landed — issue #182: a Bound claim on a `local`
volume, the tree published, the delivery contract proven against the running
binary, and the transfer budget measured — and the owner directed enablement,
so the shipped defaults now satisfy that conditional rather than decline it.
The conditional itself is unchanged, and turning media off remains a values
override rather than a code change.

## Live refresh enablement

Enabling live refresh was the separate owner-reviewed step of standing audit
item S2. The owner took it on 2026-08-27, shipping
`panels.refresh.enabled: true` together with the egress allowance, because
refresh without the allowance is a no-op and the allowance without refresh is
an opening nothing uses.
