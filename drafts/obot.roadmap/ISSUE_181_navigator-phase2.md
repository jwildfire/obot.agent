<!-- STATUS: Posted to https://github.com/jwildfire/obot.roadmap/issues/181 on 2026-08-15 11:04 EDT -->
<!-- GITHUB_PROPERTIES: Labels: requirement, Milestone: 2026q3, Assignee: @me -->

### Business Requirement

Split from [#157](https://github.com/jwildfire/obot.roadmap/issues/157) under the single-release rule: #157 now covers exactly the RC-review sweep (shipped in [obot.agent#110](https://github.com/jwildfire/obot.agent/pull/110), releases with obot.agent v0.5.0); this requirement carries the remainder of the approved day-one Navigator scope — working-set verification. @jwildfire needs prime's broader bookkeeping (what each worker agent is doing, whether their claims still match GitHub) verified on a cadence, so cold-turn answers rest on `[verified gh HH:MM]` stamps and the 2026-08-14 class of provenance error (four summaries-of-summaries incidents in one night) stops recurring.

### Overview

Extends the shipped Navigator sweep (`obot.agent tools/navigator/sweep.mjs`, launchd, sole writer of `navigator-state.md`) beyond RCs: read prime-state.md and the scratchpad working set (read-only), verify `[asserted …]` / `[self, unverified]` lines against live GitHub, and record confirmations or drift as stamped report lines in navigator-state.md. Boundaries fixed by the approved [context-management artifact](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-14-prime-context-management/) (C2): file-writing verifier only, never on prime's response path, never writes prime-state.md or its Claims, observe-and-report only — it never corrects another agent's work. Audit updates stay in their existing lane until this proves reliable.

### Data Requirement

**Data source / system:** live GitHub state across the jwildfire repos (gh CLI); `prime-state.md` and the session scratchpad (read-only); the shipped navigator snapshot cache.

**Availability status:** Confirmed — all sources exist today.

### Design

Blank at creation, per the lifecycle. Must settle: which stamp types are verifiable mechanically vs need a model pass (the sweep is deliberately model-free today); drift-report format; whether this shares the 5-minute launchd job or runs a slower cadence.

### Tasks

Populated after Design, per the lifecycle.

---

This Issue was drafted by Claude Code using Fable 5 in an unattended sibling session (👯🤖 nav), executing the single-release split @jwildfire's operating rules require.
