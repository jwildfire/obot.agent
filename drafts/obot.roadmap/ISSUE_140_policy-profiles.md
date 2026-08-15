<!-- STATUS: Posted to https://github.com/jwildfire/obot.roadmap/issues/140 on 2026-07-29 06:42 EDT -->
<!-- GITHUB_PROPERTIES: Labels: requirement, infrastructure, Assignee: @me, Parent goal: #73 (autonomy) -->

## Business Requirement

Adding a repo to the agent's write policy currently takes **two** decisions in **two** files that must be kept in sync by hand — `scripts/merge-policy.json` (which branches merge, and on what lane) and `scripts/autonomy-grants.json` (what an unattended `--auto` session may do there). Nobody wants to make two decisions per repo, and the pair has already drifted: `jwildfire/open.csr` (added 2026-07-25) and `jwildfire/demo-301` (added 2026-07-29) are in the merge policy but absent from the autonomy matrix, so their effective permissions depend on which file a session happens to consult.

Success: **one decision per repo.** @jwildfire picks a repo's *profile*; everything else follows. A repo he has not explicitly promoted is locked down by default, and any deviation from a profile is a separate, recorded approval — so the guardrail stays legible at a glance instead of being reconstructed from prose comments in two files.

## Overview

Replace the pair with a single `scripts/policy.json` built on **two profiles**:

- **`protected`** — the default for every repo. Nothing merges without @jwildfire's explicit in-session approval, attested on the PR; unattended sessions may not write to the repo at all.
- **`auto`** — an explicit promotion he approves per repo. The integration branch merges on the standard lane under the standing operating contract; release branches still need attestation; unattended sessions may branch, open draft PRs, merge integration, and manage issues.

Branches are declared by **role** (`integration`, `release`), not by name, so a repo whose branches aren't called `dev`/`main` needs no special-casing — `demo-301` maps `main`→integration and its live GitHub Pages branch `site`→release. A repo absent from the file is still refused outright; a branch with no declared role is refused under every profile.

A new `scripts/obot-policy` becomes the single place the resolution rules live: `resolve` (used by `obot-merge`), `explain`, `matrix`, `validate` (gated on by `obot-auto`), `diff-legacy`, `add`, and `promote`. Per-repo approvals move out of prose `_comment` blocks into structured `approved: {by, date, where}` records, and anything beyond a profile lives in a `custom` block that carries its own approval stamp — so "who approved `auto` for this repo, and when" is a field, not archaeology.

Affects `jwildfire/obot.agent` only (scripts, skills, docs). No product repos change.

## Data Requirement

Not applicable — configuration and tooling change, no clinical or study data involved.

## Design

**Profile semantics** (both axes, in one table):

| | `protected` (default) | `auto` (promoted per repo) |
|---|---|---|
| merge into **integration** branch | attested | standard lane |
| merge into **release** branch(es) | attested | attested |
| merge into any other branch | refused | refused |
| `--auto` branch / draft PR | no | yes, draft PR into integration |
| `--auto` unattended merge | none | integration branch only |
| `--auto` issues | read-only | full + closes |

**Lanes.** `standard` = mergeable via `obot-merge` with no extra flag (contract-gated: his approval of the *work* is still required; the lane only removes the mechanical block). `attested` = mergeable only with `--jeremy-approved '<where/when>'`, posted on the PR as an audit comment, and never available to an unattended session. `refused` = not a merge target.

**Invariants** apply under every profile and no repo entry can opt out: no unattested release-branch merge; no unattended merge of a PR touching a carve-out path; no tagging or publishing; no deletes without approval; no writes outside the `jwildfire` org; no merge into an unroled branch.

**Globals** (autonomy level A0/A1/A2, halt file, budgets, issue-close rules, release prep/publish, carve-out paths) stay exactly as they were, moved under an `autonomy` key in the same file. The per-repo profile gates each write; the global level gates the whole run. Effective unattended merge = profile `auto` AND role `integration` AND level ≠ A0 AND no carve-out path touched.

**Auditability.** Every repo carries `approved: {by, date, where}`; `auto` without a complete record fails `obot-policy validate`. `obot-policy promote <repo> --jeremy-approved '<note>'` stamps the record at the moment of promotion, and the PR carrying it still needs his sign-off because the file is inside its own carve-out.

**Adding a repo** is one command plus one decision: `obot-policy add <owner/repo>` reads the default branch from GitHub and writes a `protected` entry that grants nothing; promotion to `auto` is a separate approval-stamped step.

## Migration

Behaviour-preserving except for two deliberate narrowings, verified by running the real tooling rather than by reading it: 78 of 80 repo × branch verdicts from `obot-merge --check` are byte-identical before and after, and `obot-policy diff-legacy` reports **0 WIDENED** across all 14 declared branches. The two changes are `open.csr` `dev` and `demo-301` `main`, both standard → attested — the repos that were in the merge policy but not the autonomy matrix, whose old combination ("interactive standard merges yes, unattended writes no") the two-profile model deliberately does not reproduce. They were written as `protected` because that is the strictly-narrowing choice; which profile they should actually hold is @jwildfire's call.

## Implementation

`jwildfire/obot.agent` — see the linked PR.

---
This Issue was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
