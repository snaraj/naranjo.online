# Agent git mechanics — the traps behind the pinned commands

`AGENTS.md` "Commit identity mechanics" carries the commands an agent runs.
This document carries the evidence behind them: why each command is shaped
the way it is, and what went wrong when it was not. It adds no rule.

## Why the signature is the acting lane's, not a fixed one

Requirement 3 supersedes the single-signature owner attribution decision of
2026-08-10. The re-tiering directive of 2026-08-18 — which routes
simple and Dependabot work to lighter models — made a fixed signature false
on its face: the lane that wrote the commit is no longer the lane that always
writes commits. Merged precedent #56 (signed `- Sonnet5`, labeled `sonnet5`,
owner-merged the same day) is the first PR under the corrected rule.

## The multi-key signing trap

The obvious signing-key selection is broken:

    # BROKEN whenever more than one ed25519 key is loaded
    -c user.signingkey="key::$(ssh-add -L | grep ssh-ed25519)"

`grep` matches EVERY ed25519 line, so `key::` receives a multi-line value and
signing fails on a malformed key. This is not an exotic setup — any agent
that also loads a deploy or push key hits it, and four sessions hit it in a
single day. The `signing_key()` helper in `AGENTS.md` exists for exactly this
reason: it asks GitHub which key is registered for SIGNING, intersects that
with what the agent actually holds, and requires exactly one match. That
selection names no key comment, no hostname, and no ordering, so it works
unchanged from any machine the owner signs on.

## The allowed-signers principal trap, and why both controls must differ

Local verification reads an allowed-signers file whose first field is a
principal. Use the BARE email. Writing `Samuel Naranjo <39077795+snaraj@…>`
makes ssh read the space as a field break, report `line 1: invalid key`, and
match nothing.

That is the trap: a genuine WRONG-KEY negative control also reports
`No principal matched.`, so the two failures are indistinguishable at the
verdict line, and a malformed file silently false-passes the negative control
while proving nothing at all. Run BOTH controls and require them to DIFFER —
the positive control must print `G` (`Good "git" signature for <principal>`),
and the negative control, with only some OTHER key in the file, must print
`U`. If the positive control is not `G`, the file is broken; repair it before
believing anything the negative one says.

## Dependabot split precedents

`AGENTS.md` "GitHub conventions" states the rule: when Dependabot splits a
version-locked pair into separate PRs, one agent PR supersedes BOTH, bundling
the pair AND fixing the root cause in the same commit with a `dependabot.yml`
`groups:` stanza scoped to that pair, so the split cannot recur.

The splits that produced the rule were `github/codeql-action` `init` +
`analyze` (#53/#54) and `svelte` + `svelte-check` (#51/#52). The merged
precedents under the rule are #56 and #58.
