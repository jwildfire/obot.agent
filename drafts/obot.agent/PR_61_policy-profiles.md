<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/61 on 2026-07-29 06:52 EDT -->
<!-- GITHUB_PROPERTIES: Assignee: @me, Draft: yes -->

## Summary

One write-policy decision per repo. `scripts/merge-policy.json` and `scripts/autonomy-grants.json` — two files that had to be edited separately for every repo, and that had already drifted — become a single `scripts/policy.json` built on **two profiles**: `protected` (the default; nothing merges without your attestation, unattended sessions may not write at all) and `auto` (an explicit promotion you approve per repo; the integration branch merges on the standard lane). Anything beyond a profile lives in a `custom` block carrying its own approval stamp.

Closes #140 in the hub is not applicable — the requirement lives in the roadmap repo. Requirement: jwildfire/obot.roadmap#140.

**Approved by @jwildfire in session on 2026-07-29** via a decision prompt: the shape, the per-repo assignments, clearing the stale `open.gismo` blocker, and folding in the halt-switch fix. **Not merged** — `policy.json` is inside its own carve-out, so the merge itself is a separate go-ahead from you.

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

**Every change is accounted for.** `obot-policy diff-legacy` compares every verdict against the old pair on both axes:

```
repo                         branch    merge:before  merge:after  --auto:before  --auto:after  delta
jwildfire/demo-301           main      standard      standard     no             yes           WIDENED
jwildfire/demo-301           site      attested      attested     no             no            unchanged
jwildfire/gsm.safety         dev       standard      standard     yes            yes           unchanged
jwildfire/gsm.safety         main      attested      attested     no             no            unchanged
jwildfire/obot.agent         main      standard      standard     yes            yes           unchanged
jwildfire/obot.roadmap       main      standard      standard     yes            yes           unchanged
jwildfire/open.csr           dev       standard      standard     no             yes           WIDENED
jwildfire/open.csr           main      attested      attested     no             no            unchanged
jwildfire/open.gismo         dev       standard      standard     yes            yes           unchanged
jwildfire/open.gismo         main      attested      attested     no             no            unchanged
jwildfire/safety-histogram   dev       standard      standard     yes            yes           unchanged
jwildfire/safety-histogram   master    attested      attested     no             no            unchanged
jwildfire/safety.viz         dev       standard      standard     yes            yes           unchanged
jwildfire/safety.viz         main      attested      attested     no             no            unchanged

14 branch verdicts compared: 12 unchanged, 0 narrowed, 2 WIDENED
  [approved] jwildfire/demo-301 main: unattended False->True
  [approved] jwildfire/open.csr  dev:  unattended False->True
```

**No merge lane changed anywhere.** The two WIDENED rows are purely on the `--auto` axis: promoting `open.csr` and `demo-301` to `auto` (your call) gives unattended sessions merge authority on their integration branches, which the old grants matrix did not. Both are declared approved on the command line; **any undeclared widening exits 1** and fails the run:

```
$ obot-policy diff-legacy                      # no declarations
obot-policy: 2 unapproved widening(s) — this is a migration defect.   (exit 1)

$ obot-policy diff-legacy --approved-widening jwildfire/open.csr:dev \
                          --approved-widening jwildfire/demo-301:main
obot-policy: every widening is declared approved.                     (exit 0)
```

**End-to-end, through the real binary.** A stub `gh` feeds synthetic PR JSON to the actual `obot-merge --check`, so the whole script runs — arg parsing, refusal precedence, exit codes. Across **80 repo × branch pairs (10 repos × 8 branches)** the verdicts are **byte-identical** before and after:

```
ALL 80 repo x branch merge verdicts IDENTICAL to before the migration
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

## Your decisions, applied

**1. `open.csr` and `demo-301` → `auto`.** Both were in the merge policy but not the autonomy matrix — "interactive standard merges yes, unattended writes no", a combination the two-profile model deliberately does not reproduce. You chose `auto` for both, a deliberate widening on the unattended axis. Applied via `obot-policy promote`, which stamped the approval into each repo's `approved` block, citing this session's decision prompt. For `open.csr` this also closes a real gap: obot.agent#51 intended "makes it selectable by `--auto` sessions", and the `csr` goal is registered active with `open.csr` as its backlog, so until now an `--auto` session selecting csr work would have been blocked by a matrix nobody meant to omit it from.

**2. `open.gismo` blocker cleared.** The old matrix carried `prereq: "obotclaw App install pending — until installed, no pushes/merges"`. The App **is** installed (verified against `installation/repositories`, 2026-07-29), so the blocker's own condition is satisfied. Removed; the repo's full `auto` grants are restored.

**3. Halt-switch fix folded in (closes #60).** `obot-auto` derived the workspace root from its own path, so the `autonomy-halt` kill switch looked in the wrong directory when run from a linked worktree and **silently failed to fire**. It now resolves the workspace from the git common dir, with an `OBOT_WORKSPACE` override. Verified both ways:

```
# before the fix, from a linked worktree, halt file present:
obot-auto: pre-flight OK (level=A1, goal=charts → hub#78)          # kill switch ignored

# after:
obot-auto: halt file present (…/obot2/.claude/autonomy-halt) — remove it to launch   (exit 1)
```

Both the main clone and the worktree now resolve `WORKSPACE=/Users/jwildfire/Documents/obot2`, and preflight output is unchanged across all four goals.

**4. Naming, left alone.** The goal registry's per-goal `grant_profile: "standard"` is unread by anything today and sits on a different axis from a repo's profile. Documented the distinction in `goals/README.md` rather than edit a second carve-out file; retiring the dead field is a follow-up if you want it.

## Next steps

Ready for your review. Nothing merges until you say so — and when you do, it is an attested merge: `policy.json` is in the carve-out, so `obot-merge 61 -R jwildfire/obot.agent --jeremy-approved '<note>'`.

---
This PR was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
