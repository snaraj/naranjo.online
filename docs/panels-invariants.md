# Panels and UX floors — how the pinned numbers were arrived at

`AGENTS.md` carries the rules: payload caps ship as pinned suite assertions,
the UX floors are pinned where they are decided, and media enablement is chart
configuration plus evidence rather than code weakening. This document carries
the measurements and history behind those numbers. It adds no rule.

## The panels payload budgets

`MaxPanelResponseBytes` is 131072, raised from 32768 by the owner on
2026-08-24. A large full-depth token-usage document served at 113,304 bytes
when re-measured on 2026-09-11 (105,091 at 0.1.93, once each source carried
only its own vendor's models; fixture measurements, not proven maxima) against
the thirteen-member model vocabulary
over its fifty-six-day window; issue #170 measured 104,508 against the five-member
one, and the 115,981 figure recorded before that was a projection — and the old
gate, chosen before any real content existed, would have refused exactly the
documents the sealed-data pipeline exists to deliver.

It is now the same NUMBER as `seal.MaxSealedBytes`, which means the serve step
no longer hides a smaller ceiling than the transport steps. It does NOT mean
one ceiling governs both, and reading it that way was a finding of the
2026-08-25 round-4 review. The two bound different bytes: the sealed FILE
versus the finished ENVELOPE, which also carries the embedded snapshot,
measured at +1,247 bytes for the Go suite's large admissible document at 0.1.93
(103,844 sealed, 105,091 served; the figure moves with the fixture). A file at
exactly the transport ceiling is refused at serve time, and the refusal — never
a truncation — is what the guarantee actually rests on.

That overhead measures the sections the snapshot also ships. A pushed section a
source's snapshot ships none of is transported and then discarded, so it adds
to the sealed file and nothing to the envelope — which is why the producer-side
measurement in `docs/usage-export.md` is the larger of the two and the one the
transport ceiling answers to.

### The window moved again (issue #267)

The sealed structural maximum measures 119,664 bytes at ten-digit daily
values, 11,408 under the 131,072 ceiling, and still 130,058 at eleven digits.
The per-model lifetime split and the longest-session tile together cost 3,904
bytes at eleven digits — thirteen vocabulary members times five accounting
classes on both sources, plus one tile — against the 610 bytes the ceiling
had left at the ten-week window, so the model window is now eight weeks. The
ceiling is one number five stages agree on and never the lever; the window is,
exactly as it was when issue #302 cut it from a quarter to ten weeks.

### Each source carries only its own vendor's models (issue #369)

Four Anthropic members joined the vocabulary, taking it to sixteen keys. The
capacity check's fixture had put every member on every source. Measured that
way it would reach 135,028 sealed bytes at eleven digits, over the 131,072
ceiling.

The owner's ruling was that each tool's data carries only its own vendor's
models. A source's model keys are now its own vendor group's members plus the
residual: the group `internal/panels/config/sources.json` binds it to. The
capture folds any other member to the residual, and the exporter, the origin
and the page refuse one. The measurement therefore follows the rule: each
source pays one row per window day for its own group's size plus one.

| Digits | Sealed size of the capacity fixture |
|---|---|
| 10 | 112,642 bytes |
| 11 | 122,487 bytes |
| 12 | 132,332 bytes |

It fits at eleven digits and crosses the ceiling at twelve, the same one-digit
headroom as before, and the eight-week window did not move. These are
measurements of one fixed shape, not proven maxima: larger admissible shapes
exist. The Go suite's large admissible document
(`TestTheMaximalDocumentFitsTheRaisedBudget`) seals to 103,844 bytes and serves
at 105,091 under the same rule. Giving its second source a category partition
as well, which admission also accepts, seals to 116,313 and serves at 117,577.
Every stage refuses an over-budget document rather than truncating it, and
that refusal is what bounds a document.

### Three more members (issue #373)

Haiku 4.5 joined the Anthropic group, and GPT-6.1 Sol and GPT-6 Sol joined
the OpenAI group: 19 keys, the residual plus 10 and 8 members. The measurements
above move with them. These figures supersede that table:

| Digits | Sealed size of the capacity fixture |
|---|---|
| 10 | 114,962 bytes |
| 11 | 124,990 bytes |
| 12 | 135,018 bytes |

The one-digit headroom holds and the window did not move. The Go suite's large
admissible document seals to 106,688 bytes and serves at 108,061. With its
second source given the same one-category partition, it seals to 119,157 and
serves at 120,547.

### The version-control and repository payloads (issues #315, #317)

Two payloads grew on 2026-09-11 and both were measured against the same
131,072-byte ceiling rather than argued about.

`vcs-activity/v1` raised its served row cap from 12 to 30 and gained
`privateActivity`, one counted entry per day of the thirty-day log window. The
MAXIMAL document — a full year of week columns at five-digit daily counts, 30
commit rows each carrying a forty-hex identity, a hundred-character repository
name and a subject at the truncation bound, plus 33 private days (every date
the admission window, its slack and its skew can touch) at their widest
figures — measures **14,667 bytes** served, 116,405 under the ceiling.
Nothing a live round can produce is larger, because every term is at the bound
its own admission enforces. `TestActivityPayloadFitsTheOwnerBudget` builds it
and fails if it grows past its recorded ceiling without somebody re-measuring.

Re-measured 2026-10-16, when the payload gained `commitWeeks` and
`totalCommits` (the commits pushed each day, read in the calendar's own
request): the commit weeks take the calendar weeks' own shape and a day's
commits never exceed that day's contributions, so the widest commit cell is
the widest calendar cell. The maximal document now measures **17,259 bytes**,
113,813 under the ceiling, and the pinned ceiling is 17,500.

The calendar ANSWER that carries those commit buckets is bounded separately,
against the calendar spec's own cap. A single collection over the year could
not carry the buckets — the upstream pages a repository's days at 100, and the
first live capture found two repositories with 163 and 148 — so the commit half
is asked for in four aliased sub-collections, thirteen weeks each, chained from
the calendar's own `$from` to its `$to` through three seams computed from that
same `$from` (no sub-window reports more than 93 days, so no page can fill).
Both sub-windows meeting at a seam report the seam's day, either whole or split
at the seam instant; the mapper counts equal reports once and adds unequal
halves, and accepts the result only when the placed days equal the calendar
collection's own commit total for the whole window, which a day counted twice
or a half dropped cannot. The worst case is four times the old one: in every
sub-window every repository's whole page at its bound (25 repositories, 100
buckets each, five-digit counts), beside the widest calendar this package
admits, each page carrying its `pageInfo { hasNextPage }` (how a cut page
is told: a repository's `totalCount` is its commit count, not its bucket
count, and its buckets must add up to it). With the query renaming each
bucket's two fields to `at` and `count`, that measures **469,424 bytes**, so
the calendar cap rose from 262,144 to 524,288 — the shared bound, no wider —
leaving 54,864 bytes of headroom.
`TestTheWorstCaseCalendarAnswerFitsItsByteCap` fails if it ever stops fitting,
because an answer over the cap would refuse the calendar itself rather than
only its commit figure.

`coding-projects/v2` replaces `coding-projects/v1`: it carries `closedPulls`,
`release` and `pinned`, and no longer carries `openIssues`/`openPulls` or the
two columns that drew them — a breaking payload change, so a new kind version
rather than a mutated one (the envelope doctrine). Its maximal
document — twelve rows at the name, description and tag bounds, with both
tallies at `maxCountValue` — measures **7,988 bytes**, 123,084 under the
ceiling, pinned the same way by `TestProjectsPayloadFitsTheOwnerBudget`.

Both were captured live on 2026-09-11 as well, which is the other half of the
measurement: the real documents are 13,311 and 3,850 bytes on disk (pretty
printed), so the structural maxima above are roughly an order of magnitude of
headroom rather than a number that happens to fit today.

The two query documents the commit log posts were measured on the same day
against the owner's own account: the discovery answer 5,707 bytes for eight
repositories, the history answer 12,833 bytes for seven repositories at ten
commits each. Both endpoints cap at 262,144 — exactly half the shared bound,
unchanged from the cap the retired REST commit documents carried — so the
producer's worst-case transient read did not grow when its shape changed.

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
