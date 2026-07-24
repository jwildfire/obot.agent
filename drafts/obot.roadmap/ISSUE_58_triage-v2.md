<!-- STATUS: Posted to https://github.com/jwildfire/obot.roadmap/issues/58 on 2026-07-24 08:22 EDT -->
<!-- GITHUB_PROPERTIES: Labels: requirement, infrastructure, ai; Assignee: jwildfire -->

# Requirement: ideas-triage v2 — stronger model, richer context, bias-to-promote

### Business Requirement

@jwildfire's goal for the idea queue (2026-07-24, in-session): obot makes the judgment calls — ideas land as issues quickly, and refinement happens on the issue before build, not in the discussion thread. The v1 maiden runs promoted 2 of 7 ideas and answered the other 5 with clarifying questions; his assessment: "I'm pretty confident that if I'd provided those items as prompts here [in a session], we would've moved to issues/build almost immediately." The triage lane should behave like in-session obot, not like a cautious intake form. To be worked in the next manual session.

### Overview

Close the gap between the Action lane and in-session obot on three levers. (1) **Model**: v1 runs Sonnet 5 headless; in-session obot runs Fable/Opus — triage is minutes long, so judgment dominates cost. (2) **Context**: v1 sees only the thread + the design doc in checkout; in-session obot has the roadmap state, memories, conventions, and requirement history. Notably, v1's one context-driven win — [#55's reply](https://github.com/jwildfire/obot.roadmap/discussions/55) catching a conflict with design #18 decision O2 — shows context is the operative lever. (3) **Disposition**: v1's confidence bar files only when Business Requirement + Overview write themselves; v2 should default to filing with explicit assumptions and TBD sections, reserving in-thread questions for genuinely unparseable ideas. Affects: `obot.roadmap/.github/workflows/ideas-triage.yml` (prompt + model + context fetch), possibly obot.agent (context-pack maintenance).

### Data Requirement

n/a — GitHub state (issues, board, discussions) and workspace conventions only.

### Design

Candidates to decide in the next manual session:

- **Model bump**: `--model claude-opus-4-8` (or Fable) in the headless run; measure cost per triage before/after.
- **Bias-to-promote prompt rewrite**: default action = file the issue (Requirement or task) with an "Assumptions" block and TBD sections; questions in-thread only when the idea is a bare title with no inferable intent (v1 example: [#54](https://github.com/jwildfire/obot.roadmap/discussions/54)). Refinement then happens on the filed issue.
- **Context pack**: fetch at run time into the prompt — open requirement issues (titles + labels), board stages, the latest diary entry, hub AGENTS.md conventions; consider also checking out obot.agent for terminology/skills, or a distilled `triage-context.md` the session wrapup maintains.
- **Relation handling**: "this continues existing work" (v1 example: [#49](https://github.com/jwildfire/obot.roadmap/discussions/49) reading as a continuation of #45) should produce a comment or sub-issue on the existing requirement — filed, not asked about.
- **Follow-through**: filed issues get the board add and milestone v1 skips today.
- **Bigger option**: relocate triage into the Mac session framework (background spawn with Remote Control, full workspace context, subscription models) with the Action as fallback — evaluate against the simpler prompt/model fix first.

### Tasks

- [ ] Next manual session: decide the levers above, rewrite the triage prompt, ship v2 — obot.roadmap
- [ ] Re-triage the five open v1 threads under v2: [#49](https://github.com/jwildfire/obot.roadmap/discussions/49), [#51](https://github.com/jwildfire/obot.roadmap/discussions/51), [#52](https://github.com/jwildfire/obot.roadmap/discussions/52), [#54](https://github.com/jwildfire/obot.roadmap/discussions/54), [#55](https://github.com/jwildfire/obot.roadmap/discussions/55)

V1 baseline for reference: promoted [#50](https://github.com/jwildfire/obot.roadmap/discussions/50) → #53 and [#56](https://github.com/jwildfire/obot.roadmap/discussions/56) → #57 (threads closed resolved); parent requirement #48; pipeline history in [`ideas-triage.yml`](https://github.com/jwildfire/obot.roadmap/blob/main/.github/workflows/ideas-triage.yml).

---

This Issue was drafted by Claude Code using Fable 5 and reviewed by @jwildfire
