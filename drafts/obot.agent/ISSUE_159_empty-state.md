<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/159 on 2026-08-17 06:41 BST -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: none, Assignee: @me, Parent: jwildfire/obot.roadmap#223 -->

# Every dashboard surface renders honestly on a machine with no history

Implementation task for [jwildfire/obot.roadmap#223](https://github.com/jwildfire/obot.roadmap/issues/223).

@jwildfire moves to a dedicated machine this week. On its first morning `~/.claude/jobs`, the worker ledger, the delivery record, the sweep's state file and the priced usage artifact are all absent, and no surface that reads them has ever been looked at in that state. The one case with coverage was added by accident, when CI — a runner with no job records — caught the sessions brief losing its feed and its record link.

## Scope

- Every surface gets a test that renders it against **absent** inputs, not merely sparse ones.
- The honest rendering is "nothing recorded yet, measurement begins here" — never a zero, never a blank panel, never a silent omission.
- Partial absence is in scope: job records but no usage artifact is what day two looks like.
- The design call is made deliberately: shared vocabulary or per-surface wording.

## Surfaces

- [x] `/` — the Operations dashboard: header counts, the three queue groups, the main panel, `/queue.json`
- [x] `/live.html` and `/session/log` — the agents roster and the full record
- [x] `/navigator` and `/navigator/record` — and the sweep that writes what they render
- [x] the session-hub live view and its published projections (the frozen report, `sessionState`)
- [x] the partial-absence states: day two and day three
- [x] the status line and the visit record

---

This Issue was drafted by 👯🤖 W0016 (Claude Code using Opus 5) and reviewed by @jwildfire.
