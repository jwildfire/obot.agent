<!-- STATUS: Posted to https://github.com/jwildfire/obot.roadmap/issues/48 on 2026-07-23 10:00 EDT -->
<!-- GITHUB_PROPERTIES: Labels: requirement, infrastructure, ai; Assignee: jwildfire -->

# Requirement: idea queue — Siri/Reminders + hub Ideas Discussions intake with obot triage

### Business Requirement

@jwildfire needs a friction-free way to capture ideas and todos from anywhere (especially the phone) so they reliably enter the roadmap. The current flow — draft in Apple Notes, eventually paste into a Claude session — is fragile and loses items. Success: an idea spoken to Siri or typed into the hub Ideas board lands as a triaged roadmap artifact (todo, requirement draft, issue update, or design note) within a session cycle, with zero-token capture and bounded triage cost — no persistent "ideas" session accumulating context.

### Overview

Two intake lanes feed one queue, and the queue is public and chat-shaped: (1) direct GitHub Discussions in the hub **Ideas** category (enabled 2026-07-23; seed post [#47](https://github.com/jwildfire/obot.roadmap/discussions/47); obotclaw[bot] write access verified); (2) "Hey Siri, add … to my obot list" → Apple Reminders → a no-LLM script files each item as an Ideas discussion (adapting the proven OpenClaw-era `ingest-reminders.sh`). obot sweeps the category at session kickoff, replies in-thread as obotclaw[bot] for back-and-forth, and promotes ripe ideas to Requirement issues via this lifecycle. Affects: obot.agent (new `session-inbox` skill + scripts, `session-init` wiring), obot.roadmap (Ideas board usage).

### Data Requirement

n/a — no clinical data. Dependencies: GitHub Discussions GraphQL API (obotclaw[bot] read/write **confirmed** 2026-07-23) and Apple Reminders via osascript (**confirmed** working in the prior obot iteration).

### Design

- **Queue**: Ideas-category discussions, one idea per thread, any polish level; back-and-forth happens in-thread (GitHub mobile notifications close the loop).
- **Intake lane A (direct)**: new Ideas discussion from GitHub mobile/web.
- **Intake lane B (Siri)**: Reminders "obot" list → `reminders-to-ideas` script (no LLM): posts each item as a discussion (verbatim body + capture timestamp), marks the reminder complete; items prefixed `private:` stay in a local inbox file and are never posted (the hub is public).
- **Triage** (`session-inbox` skill, run from `session-init`): sweep threads new/updated since a watermark (workspace state file); classify each — quick todo → session todo / priority Reminder; requirement candidate → `requirement-drafting` draft; update to existing work → drafted issue comment; design fragment → attached to its requirement. Reply in-thread with the proposed shape or clarifying questions; surface the batch in the kickoff list for @jwildfire review.
- **Promotion**: on approval, file the Requirement issue, link it back to the thread, close the thread as resolved.
- **Gates unchanged**: in-thread replies and filing ride the standing hub grant; requirement posting and anything beyond follows the existing approval conventions; nothing is deleted.
- **Cost profile**: capture is zero-token; triage is one bounded pass per session over one-liners.

### Tasks

- [ ] `session-inbox` skill + Discussions-sweep and Reminders-filing scripts — obot.agent — extends PR jwildfire/obot.agent#42
- [ ] `session-init` wiring (sequenced after jwildfire/obot.agent#40 merges to avoid conflict) — obot.agent
- [ ] Reminders "obot" list + Siri → discussion end-to-end verification — workspace

---

This Issue was drafted by Claude Code using Fable 5 and reviewed by @jwildfire
