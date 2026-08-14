<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/95 on 2026-08-15 -->
<!-- GITHUB_PROPERTIES: Milestone: v0.4.0, Labels: enhancement, Assignee: @me -->

## Summary

Ship a `grill-me` skill: a resumable, multi-session elicitation interview that extracts what @jwildfire wants built for a goal — including tacit knowledge and not-yet-known scope — and lands it in durable artifacts (goal body + filed requirements).

## Why now

@jwildfire reviewed the app-plan decision artifact (A1–A4, [discussion #149](https://github.com/jwildfire/obot.roadmap/discussions/149)) and asked for exactly this: "I basically want you to interview me to figure out what I want... I remember seeing a 'grill-me' skill somewhere that might be along the right lines." A3/A4 are held open pending the exercise; goal [#79](https://github.com/jwildfire/obot.roadmap/issues/79) needs its Intent/Boundaries recaptured.

## Design basis

Method research and forks are in the hub decision artifact [reports/decisions/2026-08-15-app-elicitation-method/](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-15-app-elicitation-method/). Key sources: Matt Pocock's public `grill-me`/`grilling` skills (the thing he remembered — found), the local P004 grill-queue + stakeholder-interview precedents, the CSR gap-analysis exercise (reactive artifacts + decide-by-exception worked; open-ended menus did not), and the requirements-elicitation literature (reactive comparison sets, IDEA anchoring discipline, role-based devil's advocate, no yes/no read-backs).

## Scope

- `skills/grill-me/SKILL.md` — the protocol (roles, ledger state on the hub, phases, question rules, capture path, honest time budget).
- Workspace wiring: relative symlink `obot2/.claude/skills/grill-me` (manual step, recorded in the PR).

---

This Issue was drafted by Claude Code using Fable 5 in an unattended session (not yet reviewed by @jwildfire)
