<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/89 on 2026-08-15 00:00 CEST -->
<!-- GITHUB_PROPERTIES: Milestone: v0.4.0, Labels: (none), Assignee: obotclaw[bot] -->

## The rule

**No work is done on an issue until a milestone is assigned** — @jwildfire, 2026-08-14, in response to safety.viz v1.6.0 shipping without closing or grouping anything.

Its companion, which failed the same night: **a release PR names the issues it ships, one `Closes #N` line each.** The milestone groups; the keyword closes. Both are required, not either.

## What actually went wrong in v1.6.0

- No `v1.6.0` milestone existed in safety.viz. The newest was `v1.4.0`; `v1.2.0` and `v1.3.0` sat open as scoping waves.
- The work *was* closed — [sv#46](https://github.com/jwildfire/safety.viz/issues/46), [#48](https://github.com/jwildfire/safety.viz/issues/48), [#54](https://github.com/jwildfire/safety.viz/issues/54), [#120](https://github.com/jwildfire/safety.viz/issues/120) all closed at their increment PRs' merges. But three of them still carried `v1.2.0`, the wave that *scoped* them, and #120 carried nothing. Nothing was grouped to the release it shipped in.
- The RC PR ([sv#124](https://github.com/jwildfire/safety.viz/pull/124), dev → main) carried no `Closes` lines, so the release had no manifest of its own.
- Two hub requirements it delivered against never moved stage: [obot.roadmap#35](https://github.com/jwildfire/obot.roadmap/issues/35) was still at *Design* after its Phase 1 shipped.

The release's own record had to be reconstructed from the diff afterwards. That reconstruction is done; this issue is about not needing it again.

## What this changes

**The rule, written where an agent hits it before branching:**

- `AGENTS.md` — a new *Milestone before work* section, plus a Non-negotiables bullet pointing at it.
- `skills/session-init/SKILL.md` — a milestone is eligibility criterion (e) for `--auto` increment selection. A milestone-less issue is not pickable as-is.
- `skills/rc-release-notes/SKILL.md` — a *Before the notes: the milestone* step: create the milestone, assign it from the window's `Closes` lines, close only what is fully delivered, carry the `Closes` lines into the RC body, close the milestone at ship.
- `docs/rc-framework.md` — the milestone joins the RC checklist, and the post-tag board moves are named as part of the release rather than follow-up.

**The mechanical backstop, at the one chokepoint every merge passes** — `scripts/obot-merge` gains a milestone gate with two narrow refusals:

1. any issue the PR closes, in this repo, that carries no milestone;
2. a release-role merge whose body names no issue at all.

`--no-milestone '<reason>'` and `--no-issues '<reason>'` are the escape hatches. Cross-repo references, stale milestones and unreadable issues are reported and waved through — the gate refuses on positive evidence only, so a GitHub hiccup never becomes a merge outage.

## What it would and would not have caught

| v1.6.0 event | Caught? |
| --- | --- |
| sv#121 closing sv#120, which had no milestone | **Yes** — refused on the standard lane |
| sv#124, the release merge, naming no issue | **Yes** — refused on the release lane |
| sv#118 / sv#122 closing issues that carried a *stale* `v1.2.0` | **No** — a wrong milestone is still a milestone |
| no `v1.6.0` milestone existing at all | **No** directly, but both refusals above force it to be created before anything can merge |
| hub#35 left at *Design* after shipping | **No** — that is the rc-framework board-move step, prose not code |

The stale-milestone blind spot is deliberate: telling a wrong milestone from a right one needs the release window, which lives in the release-notes step, not in the merge tool.

## Rejected alternatives

- **A per-repo CI check on PRs.** Catches latest of all the options (after the work is done), needs a workflow rolled out and maintained per repo, and fails PRs on a metadata question. `obot-merge` sees the same information at the same moment for every repo at once.
- **A default milestone on the issue template.** GitHub issue templates and issue forms cannot set a milestone — only labels, assignees, projects and type. The nearest equivalent is a bot stamping a default on open, which trades a missing milestone for a wrong one, which is the failure this issue exists to fix.

---

This Issue was drafted by Claude Code using Opus 5 in an unattended sibling session, at @jwildfire's explicit instruction to design the automation.
