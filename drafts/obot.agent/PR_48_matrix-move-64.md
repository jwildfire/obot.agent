<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/48 on 2026-07-25 00:07 EDT -->
<!-- GITHUB_PROPERTIES: Assignee: @me, Reviewers: @jwildfire -->

## Summary

The companion half of the requirement-matrix relocation: the 13 renderer matrices are removed from `docs/requirements/`, which becomes a pointer to their new home in safety.viz. Harvesting stays here as agent tooling, retargeted to write into the safety.viz checkout.

Refs jwildfire/obot.roadmap#64

**Merge this after jwildfire/safety.viz#111**, which adds the matrices there. Merging it first would break safety.viz CI for the gap.

## Reviewer notes

**UAT — what to read.** [`docs/requirements/README.md`](docs/requirements/README.md) is the artifact worth reading: where the matrices went, why, what stayed behind and why, and how to line the pre-move git history up with the files in their new home (`git log --follow -- docs/requirements/<renderer>.md` still works — filenames are unchanged).

**Code-review anchors.**

- `scripts/harvest_wiki_requirements.py` — three changes. Output goes to `REQUIREMENTS_OUT` (default `../safety.viz/requirements`); existing matrices are **skipped unless `--force`**; the script no longer writes its own `README.md` index. The skip guard matters more than the retarget: the matrices have been reviewed and extended far past the raw harvest, and before this a re-run would silently overwrite ~1 000 reviewed rows with first-draft output. Verified both paths against a scratch directory.
- `skills/requirements-harvesting/SKILL.md` — the description and Output step now say to author into the safety.viz checkout and regenerate the extract there in the same PR.
- `AGENTS.md`, `README.md`, `docs/test-framework.md` — per-renderer required-artifact and done-gate references point at the new location.
- Deletions are pure removals: the matrices in safety.viz are byte-identical copies, which the sibling PR verifies by regenerating every extract byte-for-byte from them.

**Security.** Documentation, a skill, and a local bootstrap script. No credentials, workflows, or published artifacts are touched. The one behavioral change — refusing to overwrite existing matrices — is strictly protective.

## Roadmap context

[obot.roadmap#64](https://github.com/jwildfire/obot.roadmap/issues/64), promoted from [discussion #63](https://github.com/jwildfire/obot.roadmap/discussions/63). Every safety.viz feature used to need two PRs: the implementation there and its matrix rows here, in a fixed merge order, followed by an extract regen. The issue's Design section carries the inventory and the cutover plan.

This also settles the ownership line the [obot.agent orchestration vision](https://github.com/jwildfire/obot.roadmap/issues/64) implies: obot.agent keeps the harness, the skills, and the program record; product requirements live with the product.

## Evidence

- **Nothing is lost** — the safety.viz PR regenerates all 11 requirement extracts byte-identical from the relocated matrices, and every requirement ID and text block on all 11 published evidence pages renders identically (1 105 blocks compared).
- **The snapshot includes this repo's in-flight rows** — the 21 rows from #47 (hep-explorer / hep-waterfall, filed tonight for safety.viz#110) are carried into the moved matrices, so #47 can merge before this or be closed as superseded; either way the rows survive.
- **The harvester's guard** — a scratch run wrote 9 matrices into an empty directory; the second run skipped all 9 with `matrix already exists — skipping (use --force to overwrite)`.

## Technical briefing

**What stayed, and why.** Three things did not move:

- `docs/requirements/agentic-ai-review.md` — the harvest-phase AI review record. It documents *how* the matrices were prepared for human review (reviewer scopes, method, per-renderer findings), which is program history about this repo's process, not a specification of the charts. Its companion, `interviews/p004-grill-queue.md`, is already here.
- The harvesting skill and script — they read local RhoInc wiki clones and belong to the agent harness. safety.viz has no reason to carry a Python bootstrap tool; only its output location changes.
- `docs/p004-test-driver-trial.md` and `interviews/` — dated records, left verbatim, including the paths that were true when they were written.

**Why the deletions are safe to review quickly.** The matrices are ~1 590 lines of very wide Markdown tables. Rather than eyeballing them, the check is mechanical and lives in the sibling PR: same files, same parser, byte-identical extracts, identical rendered evidence pages. If a single character of requirement text had changed in transit, the extract diff would have caught it.

**Branch note.** This branch is stacked on #47's head so the deletions apply cleanly whether or not #47 merges first — without that, deleting files #47 modifies would leave GitHub reporting a delete/modify conflict for you to resolve by hand. The side effect is that #47's two `drafts/` files appear in this diff; they land in this repo either way.

**Merge order.** safety.viz#110 → obot.agent#47 *(or close it as superseded)* → safety.viz#111 → **this PR** → `npm run requirements` on safety.viz `dev` as a no-op confirmation.

## Next steps

- After this merges, `docs/requirements/` holds only the pointer and the review record. A future cleanup could fold that pointer into `docs/` proper once nobody is following old links.
- The P004 renderers still queued for migration (paneled-outlier-explorer, web-codebook) already have matrices in safety.viz, so their migration PRs start with the matrix already in hand.

---

*This PR was drafted by Claude Code using Opus 5 (👯🤖 matrix-move, overnight session 2026-07-24) and reviewed by @jwildfire.*
