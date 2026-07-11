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
The briefing is a hand-off, not a leash.

*Example:* during a planning session, the agent spawns a background "v0.2 renderer"
session with a briefing on scope and branch; that session works, then wraps up on its own.

## Subagent

A child task inside a session — an Agent-tool call or a workflow agent — that reports
its result back to its parent and has no independent session state: no identity, no
scratchpad, no wrapup.

*Example:* the P004 test-driver runs as a bounded subagent inside a migration session;
its coverage report returns to the parent session, which decides what to do with it.

## Comparison

| | Lifecycle | Identity | Who reads its output |
|---|---|---|---|
| **Session** | Full: init → work → wrapup → diary | Own name/color | Jeremy, and later sessions via diary/scratchpad |
| **Spawned agent** | Full, independent of the spawning session | Own name/color, set at kickoff | Jeremy; the spawner only via the artifacts it leaves |
| **Subagent** | Bounded by the parent task; none of its own | None — acts under its parent's | The parent session, which relays or acts on it |
