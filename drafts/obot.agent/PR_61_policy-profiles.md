<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/61 on 2026-07-29 06:52 EDT -->
<!-- GITHUB_PROPERTIES: Assignee: @me, Draft: yes -->

## Summary

One write-policy decision per repo. `scripts/merge-policy.json` and `scripts/autonomy-grants.json` — two files that had to be edited separately for every repo, and that had already drifted — become a single `scripts/policy.json` built on **two profiles**: `protected` (the default; nothing merges without your attestation, unattended sessions may not write at all) and `auto` (an explicit promotion you approve per repo; the integration branch merges on the standard lane). Anything beyond a profile lives in a `custom` block carrying its own approval stamp.

Closes #140 in the hub is not applicable — the requirement lives in the roadmap repo. Requirement: jwildfire/obot.roadmap#140.

**This PR needs your approval and I have not merged it.** `policy.json` is inside its own carve-out, and the shape here (two profiles, protected default, customizations gated) is what you approved — the specific grant contents, the per-repo assignments, and the migration itself are still yours to sign off. Two repos need a decision from you before this is right; see **Decisions needed**.

## Roadmap context

Requirement: jwildfire/obot.roadmap#140, a sub-issue of the **autonomy** goal jwildfire/obot.roadmap#73. Follows obot.agent#59 (demo-301 added to the merge policy last night, without a matching grants entry — the drift that prompted this).

## What a repo looks like now

| | `protected` (the default) | `auto` (you promote a repo to it) |
|---|---|---|
| merge into **integration** branch | attested | **standard lane** |
| merge into **release** branch(es) | attested | attested |
| merge into any other branch | refused | refused |
| `--auto` branch / draft PR | no | yes, draft PR into integration |
| `--auto` unattended merge | none | integration branch only |
| `--auto` issues | read-only | full + closes |

Branches are declared by **role**, not name, so a repo whose branches aren't `dev`/`main` needs no special-casing — `demo-301` maps `main`→integration and its live GitHub Pages branch `site`→release, which is exactly the case that forced a prose exception in the old file. A repo absent from the file is still refused outright; a branch with no declared role is refused under both profiles.

Approvals are now structured, not prose. Every repo carries `approved: {by, date, where}`, and `obot-policy validate` fails an `auto` repo whose record is incomplete — so "who approved this, and when" is a field rather than archaeology in a `_comment`.

## Evidence — verified by running, not by reading

**0 WIDENED.** `obot-policy diff-legacy` compares every verdict against the old pair on both axes:

```
repo                         branch    merge:before  merge:after  --auto:before  --auto:after  delta
jwildfire/demo-301           main      standard      attested     no             no            narrowed
jwildfire/demo-301           site      attested      attested     no             no            unchanged
jwildfire/gsm.safety         dev       standard      standard     yes            yes           unchanged
jwildfire/gsm.safety         main      attested      attested     no             no            unchanged
jwildfire/obot.agent         main      standard      standard     yes            yes           unchanged
jwildfire/obot.roadmap       main      standard      standard     yes            yes           unchanged
jwildfire/open.csr           dev       standard      attested     no             no            narrowed
jwildfire/open.csr           main      attested      attested     no             no            unchanged
jwildfire/open.gismo         dev       standard      standard     yes            no            narrowed
jwildfire/open.gismo         main      attested      attested     no             no            unchanged
jwildfire/safety-histogram   dev       standard      standard     yes            yes           unchanged
jwildfire/safety-histogram   master    attested      attested     no             no            unchanged
jwildfire/safety.viz         dev       standard      standard     yes            yes           unchanged
jwildfire/safety.viz         main      attested      attested     no             no            unchanged

14 branch verdicts compared: 11 unchanged, 3 narrowed, 0 WIDENED
```

`diff-legacy` **exits 1 on any WIDENED row** — a repo gaining authority it did not have is treated as a build failure, not a note.

**End-to-end, through the real binary.** A stub `gh` feeds synthetic PR JSON to the actual `obot-merge --check`, so the whole script runs — arg parsing, refusal precedence, exit codes. Across **80 repo × branch pairs (10 repos × 8 branches)** the verdicts are identical before and after except the two intended narrowings:

```
33c33
< jwildfire/open.csr   dev    ALLOW:standard
> jwildfire/open.csr   dev    ALLOW:approval
42c42
< jwildfire/demo-301   main   ALLOW:standard
> jwildfire/demo-301   main   ALLOW:approval
```

**Real PRs, real `gh`.** `obot-merge --check` against one open PR per profile — obot.agent#52 (`auto`, integration → CHECK PASSED, rc 0), safety.viz#121 and #119 (`auto`, integration, drafts → REFUSED, rc 2). Verdicts and exit codes unchanged; the only new output is an informational `policy: profile auto, role integration` line.

**Refusal precedence preserved.** An unknown repo still outranks the PR's own state, then draft, then state, then the branch lane — checked by diff against the pre-change run. Also exercised: attested lane refuses without `--jeremy-approved` and mints no token; `demo-301` `site` and `safety.viz` `main` both refuse; an unroled branch refuses and names the declared roles.

**`obot-auto` unchanged.** `--preflight-only` output is byte-identical across all four registered goals (`charts`, `app`, `autonomy`, `csr`) and on the unknown-goal path. It now additionally refuses to launch when `obot-policy validate` fails — verified by breaking the file two ways (a `protected` profile putting a branch on the standard lane, and an `auto` repo with no approval record): validate exits 1, `obot-auto` exits 1 and does not spawn.

## Technical briefing

| File | Change |
|---|---|
| `scripts/policy.json` | **new.** Profiles, roles, lanes, invariants, per-repo entries with approval records, and the globals (`autonomy.level`, halt file, budgets, issue-close rules, release prep/publish, carve-out paths) moved over verbatim. |
| `scripts/obot-policy` | **new.** The single place the resolution rules live: `resolve` `explain` `matrix` `validate` `diff-legacy` `add` `promote`. |
| `scripts/obot-merge` | Calls `obot-policy resolve` instead of carrying its own copy of the rules, so the merge lane and the `--auto` session can never disagree. Fails closed if the policy file or resolver is missing — there is deliberately no fallback to a permissive path. |
| `scripts/obot-auto` | Reads `autonomy.level` from `policy.json`; gates launch on `obot-policy validate`. |
| `scripts/merge-policy.json`, `scripts/autonomy-grants.json` | **removed** — superseded. `obot-policy diff-legacy --legacy-dir` can still audit against a checkout that has them. |
| `README.md` | New "Write policy: one decision per repo" section with the profile table. |
| `skills/session-init/SKILL.md`, `skills/session-spawn/SKILL.md`, `goals/README.md` | Describe profiles and branch roles instead of the two-file tiers. |

**Adding a repo is now one command plus one decision:** `obot-policy add <owner/repo>` reads the default branch from GitHub and writes a `protected` entry that grants nothing; `obot-policy promote <owner/repo> --jeremy-approved '<where/when>'` is the separate, stamped step.

## Decisions needed

**1. `open.csr` and `demo-301` don't fit either profile cleanly.** Both were in the merge policy but not the autonomy matrix, i.e. "interactive standard merges yes, unattended writes no" — a combination the two-profile model deliberately does not reproduce. I wrote both as `protected`, the strictly-narrowing choice, which costs you the standard merge lane you have there today. For `open.csr` the evidence points the other way: obot.agent#51 says the intent was "makes it selectable by `--auto` sessions", and the `csr` goal is registered active with `open.csr` as its backlog — so today an `--auto` session selecting csr work would be blocked by a grants matrix nobody meant to omit it from. Promoting either is one stamped command.

**2. `open.gismo`'s blocker is stale.** The old grants matrix carried `prereq: "obotclaw App install pending — until installed, no pushes/merges"`. The App **is** installed now (verified against `installation/repositories`, 2026-07-29). I carried the blocker forward as `custom.blocked` rather than drop it, because dropping a blocker is a widening. Clearing it restores its `auto` grants. Note the old prereq was prose an agent had to notice and honour; as a `custom.blocked` field the resolver enforces it.

**3. Naming.** The goal registry has a per-goal `grant_profile: "standard"` field, unread by anything today, on a different axis from a repo's profile. I documented the distinction rather than touch a carve-out file; retiring the unused field is a follow-up if you want it.

## Also found

**jwildfire/obot.agent#60 — pre-existing, not from this change.** `obot-auto` derives the workspace root from its own path, so the `autonomy-halt` kill switch is looked for in the wrong directory when run from a linked worktree and silently fails to fire. Low exposure today (the settings allowlist points at the main clone) but worth closing before A2 scheduled runs. Left out of this PR to keep the guardrail diff reviewable.

## Next steps

Your call on the two repos above and on clearing the `open.gismo` blocker; I'll stamp whatever you pick with `obot-policy promote` and push. Nothing merges until you say so.

---
This PR was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
