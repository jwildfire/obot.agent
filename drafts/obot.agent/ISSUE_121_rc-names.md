<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/121 on 2026-08-15 -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Assignee: @me -->

# RC PR naming: `{package} vX.Y.Z-RCn`, and the RC body contract

@jwildfire, 2026-08-15: *"(1) New rule for release candidate names: {package} Vx.x.x-RCx. No other summary allowed. (2) alwasy link to news.md in all RC PRs. format = 1 sentence exec summary then bulleted list with relevant links to demo page and news.md. then a list of all requirements closed in the PR. Then get in to the details as needed."*

## Item 1 supersedes a rule set hours earlier the same day

Earlier on 2026-08-15 the rule was "release candidate PRs should all start with a package name and a version number", shipped in #119 as a *derived* label of the form `pkg vX.Y.Z — {summary}`. Item 1 changes it twice:

- **No summary is allowed.** The title is exactly `{package} vX.Y.Z-RCn` and nothing else.
- **It adds an `-RCn` counter** that the earlier rule did not have.

So parts of #119 are now wrong, not merely extended. `rcLabel` in `tools/ops-dashboard/lib/collect.mjs` exists to synthesise `package version — what it is` out of a messy title; under the new rule the title already *is* the label and no summary is permitted, so most of that machinery is dead.

## Scope

- **The rule text**, wherever RC PRs are written: `docs/rc-framework.md`, `skills/rc-release-notes/SKILL.md`, `AGENTS.md`.
- **`-RCn` counter semantics** written as rules an agent can follow without judgement: when it increments, same-PR-vs-new-PR on a re-cut, per-version reset, and what the tag drops.
- **The RC body contract** (item 2), reconciled with the established five-section obot PR template and the `Closes #N` rule — one template, not a competitor. The "list of requirements closed" must *carry* the `Closes` keywords, or issues stop auto-closing and `obot-merge`'s release gate starts refusing.
- **The Operations Dashboard**: `rcLabel` and its tests and README line. A bare `gsm.safety v1.1.0-RC1` in a queue of five is less informative than what the page shows today, so the page needs a second line — see below.
- **`scripts/obot-merge`**: whether an RC title check belongs in the merge gate.

## The dashboard question

Titles now carry no description at all, and his queue leaned on that summary to tell items apart. Proposal: the row shows the title verbatim as its label, plus a **derived second line — the one-sentence exec summary from the PR body**, which item 2 guarantees exists and puts first. That is strictly better than today's derived label: today's summary is whatever the author wrote in the title, while the exec summary is contract-mandated and has to be accurate because it heads the PR he reads.

## Out of scope

The Navigator sweep (`tools/navigator/sweep.mjs`). `classifyRC()` classifies on base branch, review requests and `reviewDecision` — never on the title — so a naming change cannot blind it.

---

*This Issue was drafted by Claude Code using Opus 5 and reviewed by @jwildfire*
