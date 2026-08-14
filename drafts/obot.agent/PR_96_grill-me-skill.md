<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/96 on 2026-08-15 -->
<!-- GITHUB_PROPERTIES: Milestone: v0.4.0, Labels: enhancement -->

## Summary

Adds the `grill-me` skill — a resumable, multi-session elicitation interview that extracts what @jwildfire wants built for a goal (tacit knowledge included) and lands it in durable artifacts: a ratified goal body and filed requirements. Built for how he works: reactive artifacts he corrects rather than blank-page questions, AskUserQuestion menus with an open turn first, 15–30 minute sessions, and a hub-side ledger that makes the interview resumable across days.

Closes #95

## Roadmap context

Direct response to @jwildfire's 2026-08-15 direction on the app-plan decision review ([discussion #149](https://github.com/jwildfire/obot.roadmap/discussions/149)): "I basically want you to interview me to figure out what I want... I remember seeing a 'grill-me' skill somewhere." A3/A4 of that artifact are held open pending this exercise; goal [#79](https://github.com/jwildfire/obot.roadmap/issues/79) is the first intended subject.

## Evidence

- Method decision artifact (research + forks E1–E4): https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-15-app-elicitation-method/
- The remembered skill, found: [mattpocock/skills grill-me](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md) + its `grilling` engine — stateless/single-session, so adapted rather than adopted; local precedents `interviews/p004-grill-queue.md` and `skills/stakeholder-interview/SKILL.md` (Telegram-era) supplied the capture schema.
- CSR precedent (2026-07-27 framework exercise): tacit content surfaced as an objection to a concrete proposal (hub#131); decide-by-exception draft positions got answered same-day while the open-ended 12-item menu (hub#114 D5) never was.

## Technical briefing

- One new file: `skills/grill-me/SKILL.md`. Protocol: prep agent (context-rich, offline) / interviewer (context-light, live) / critic (role-based devil's advocate — soft "push back" prompts are empirically worthless); ledger state at `obot.roadmap/reports/goal-<N>-elicitation/` (log.md + answers.json + frontier.md with a fog-of-war section, commit per answer batch); phases prep → reactive review → grill rounds → wrap (goal capture + requirement filing with bidirectional question-ID traceability).
- Wiring is a manual one-time symlink (session-aliases only handles `session-*`): `ln -s ../../obot.agent/skills/grill-me ~/Documents/obot2/.claude/skills/grill-me` — applied at merge time; slash command resolves on the directory name, so `/grill-me 79` works in a fresh session.

## Next steps

- @jwildfire: pick E1–E4 on the method artifact's Q&A thread (defaults are pre-recommended; silence = defaults).
- Then any session runs `/grill-me 79 --prep` to build the Phase-0 artifacts, and he starts Phase 1 whenever he has ~30 minutes.

---

This PR was drafted by Claude Code using Fable 5 in an unattended session (not yet reviewed by @jwildfire)
