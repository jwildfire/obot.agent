# Standing goals

Goal definitions for autonomous (`--auto`) sessions, per the approved
[#18 design](https://jwildfire.github.io/obot.roadmap/requirements/design/18_design.html)
(§2). One file per goal: YAML frontmatter over prose, the same shape as skills —
agent-parsable, human-reviewable, versioned next to the machinery that consumes
them (`scripts/obot-auto`, the `session-init` `--auto` mode).

A goal records the standing **direction** of work; the hub stays the source of
truth for the **work itself** (requirements, stages, sub-issues). The `--auto`
selection rules read `anchors` first, then `backlog`, and never select outside
the grant matrix (`scripts/autonomy-grants.json`).

## Format

```markdown
---
name: <slug>                  # unique, kebab-case; obot-auto --goal <slug>
title: "<display title>"
status: active                # active | paused — paused goals are never selected
anchors:                      # hub requirements that feed this goal, priority order
  - jwildfire/obot.roadmap#N
backlog:                      # secondary feed, worked only when no anchor is eligible
  - jwildfire/<repo>          # a repo reference means its issue backlog
grant_profile: standard       # row set in scripts/autonomy-grants.json
---

Prose: intent, boundaries, what "done" looks like, anything a selecting
session should weigh that the issues don't say.
```

## Semantics

- **Pausing** a goal is a one-line `status: paused` edit; **retiring** one is
  deleting the file (deletion needs @jwildfire's approval, as everywhere).
- Goal edits ride the scaffold-lane review path and sit inside the policy-file
  carve-out: **PRs touching `goals/` always wait for @jwildfire**, even at
  autonomy level A1.

---

Decided 2026-07-22 (design #18 O2): goal definitions live here, not in the hub.
