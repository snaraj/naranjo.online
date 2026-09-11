# Panels and UX floors — how the pinned numbers were arrived at

`AGENTS.md` carries the rules: payload caps ship as pinned suite assertions,
the UX floors are pinned where they are decided, and media enablement is chart
configuration plus evidence rather than code weakening. This document carries
the measurements and history behind those numbers. It adds no rule.

## The panels payload budgets

`MaxPanelResponseBytes` is 131072, raised from 32768 by the owner on
2026-08-24. Full-depth token-usage history structurally reaches 119,128 bytes
served — re-measured 2026-09-11 against the thirteen-member model vocabulary
over its seventy-day window; issue #170 measured 104,508 against the five-member
one, and the 115,981 figure recorded before that was a projection — and the old
gate, chosen before any real content existed, would have refused exactly the
documents the sealed-data pipeline exists to deliver.

It is now the same NUMBER as `seal.MaxSealedBytes`, which means the serve step
no longer hides a smaller ceiling than the transport steps. It does NOT mean
one ceiling governs both, and reading it that way was a finding of the
2026-08-25 round-4 review. The two bound different bytes: the sealed FILE
versus the finished ENVELOPE, which also carries the embedded snapshot,
measured at +1,625 bytes for the maximal admissible document. A file at exactly
the transport ceiling is refused at serve time, and the refusal — never a
truncation — is what the guarantee actually rests on.

That +1,625 measures the sections the snapshot also ships. A pushed section a
source's snapshot ships none of is transported and then discarded, so it adds
to the sealed file and nothing to the envelope — which is why the producer-side
measurement in `docs/usage-export.md` is the larger of the two and the one the
transport ceiling answers to.

### The headroom digit is spent (issue #267)

The sealed structural maximum measures 123,668 bytes at ten-digit daily
values, 7,404 under the 131,072 ceiling. It used to leave one further decimal
digit on every value; it no longer does, reaching 134,426 at eleven digits.
The per-model lifetime split costs 3,904 bytes there — thirteen vocabulary
members times five accounting classes on both sources — against the 610 bytes
the ceiling had left, and the longest-session tile costs 60 more.

Neither lever was pulled. The ceiling is one number five stages agree on, and
`MAX_MODEL_DAYS` is a product decision about how deep the per-model breakdown
reaches. So `CapParityTest` carries the gap as the ratchet pair AGENTS.md
prescribes: a green pin on the measured behaviour and a named
pending-contract test that turns the suite red as an unexpected success the
day the headroom returns, which forces the note to become an enforced rule
again rather than rot.

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
