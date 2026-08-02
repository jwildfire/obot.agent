# Terminology: tiers of agent execution

> Groundwork for [jwildfire/obot.roadmap#18](https://github.com/jwildfire/obot.roadmap/issues/18)
> (autonomous operations). Use these terms consistently in issues, designs, and diaries —
> they are not interchangeable.

## Session

A top-level Claude Code conversation — interactive or a background job — with its own
identity (name/color), scratchpad, and wrapup. Sessions are the unit of the session
lifecycle: they open with `session-init`, close with `session-wrapup`, and their work
lands in the diary.

*Example:* Jeremy runs `claude` in the obot2 workspace and works through a safety.viz
release. That conversation is one session, named and colored at kickoff.

## Spawned agent

A sibling session launched from another session via `claude --bg` with a context
briefing. A spawned agent is a **peer, not a child**: it runs its own full session
lifecycle — identity, scratchpad, wrapup — independent of the session that launched it.
The briefing is a hand-off, not a leash. Siblings spawn with Remote Control active
(`--remote-control`), so they appear in claude.ai/code and the Claude mobile app
alongside the lead session (see [`remote-control.md`](remote-control.md), 2026-07-23).

*Example:* during a planning session, the agent spawns a background "v0.2 renderer"
session with a briefing on scope and branch; that session works, then wraps up on its own.

## Subagent

A child task inside a session — an Agent-tool call or a workflow agent — that reports
its result back to its parent and has no independent session state: no identity, no
scratchpad, no wrapup.

*Example:* the P004 test-driver runs as a bounded subagent inside a migration session;
its coverage report returns to the parent session, which decides what to do with it.

## Which tier, when

The delegation rule the session framework rests on — the full contract is
[`docs/session-framework.md`](session-framework.md); this is which tier it applies to.

- **Spawned agents are the delegation primitive.** Anything that would cost the lead more
  than ~30 seconds goes to a sibling, briefed from
  [`templates/sibling-briefing.md`](../templates/sibling-briefing.md) via the
  [`session-spawn`](../skills/session-spawn/SKILL.md) contract.
- **Synchronous subagents are banned from the lead's response path.** A subagent blocks the
  turn it runs in, so it may only be used when its entire result is needed to answer *and*
  it is reliably bounded well inside the reply SLA. Verification sweeps, roadmap deltas,
  ideas triage, PR recon, and free-text investigation are **not** bounded — they are
  siblings. The evidence: a blocking init delta subagent measured 4m03s / 19 tool calls on
  2026-08-01 and returned zero corrections.
- **The lead's own jobs are render, spawn, relay, and stop.** If the lead is doing something
  else during a bookend, it is doing a sibling's job.

## Comparison

| | Lifecycle | Identity | Who reads its output | Blocks the lead? |
|---|---|---|---|---|
| **Session** | Full: init → work → wrapup → diary | Own name/color | Jeremy, and later sessions via diary/scratchpad | n/a |
| **Spawned agent** | Full, independent of the spawning session | Own name/color, set at kickoff | Jeremy; the spawner only via the artifacts it leaves | **No** |
| **Subagent** | Bounded by the parent task; none of its own | None — acts under its parent's | The parent session, which relays or acts on it | **Yes — which is why it stays off the response path** |
