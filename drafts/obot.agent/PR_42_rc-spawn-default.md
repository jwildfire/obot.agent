<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/42 on 2026-07-23 09:30 EDT; body updated 2026-07-24 06:43 EDT -->
<!-- GITHUB_PROPERTIES: Assignee: jwildfire, Base: main, Draft: true -->

# Session framework: Remote Control on every agent + idea-queue intake (session-inbox)

## Summary

Two session-framework additions from today's directives. (1) Every sibling spawned via `session-spawn` now starts with Remote Control active (`--remote-control` on the spawn command), so background agents appear in claude.ai/code and the Claude mobile app with inbound control; `docs/remote-control.md` is the runbook. (2) The idea queue ([obot.roadmap#48](https://github.com/jwildfire/obot.roadmap/issues/48)): a new `session-inbox` skill plus two no-LLM scripts turn hub Ideas Discussions + a Siri/Reminders lane into a zero-token capture queue that obot triages at session kickoff. Plus one quality-of-life addition from the same directive set: the main session now pins itself to the top of the `claude agents` view at init, so @jwildfire never reaches for `ctrl+T`.

Closes jwildfire/obot.roadmap#46

## Roadmap context

Directives from the 2026-07-23 session. Remote Control: tracked as [obot.roadmap#46](https://github.com/jwildfire/obot.roadmap/issues/46) — Claude Tag was investigated and ruled out (Team/Enterprise-only; sandbox cannot attach to local sessions), Remote Control is the implemented path. Idea queue: requirement [obot.roadmap#48](https://github.com/jwildfire/obot.roadmap/issues/48) (approved in-session) — this PR implements its obot.agent tasks; the requirement stays open through its lifecycle (Siri end-to-end verification pending), so no closing keyword.

## Evidence

- Remote Control verified end-to-end on CLI 2.1.218: probe spawned with `claude --bg --remote-control` registered a bridge (`bridgeSessionId`, `bridgeOutboundOnly: false`) and was listed at [claude.ai/code](https://claude.ai/code); an identical unflagged spawn was not. Undocumented combination — the skill carries a ~15s `bridgeSessionId` health check. Details: [`docs/remote-control.md`](https://github.com/jwildfire/obot.agent/blob/rc-spawn-default/docs/remote-control.md).
- Idea queue mechanics verified live: Discussions enabled on the hub, Ideas category seeded and explained ([discussion #47](https://github.com/jwildfire/obot.roadmap/discussions/47), posted as obotclaw[bot] — write access proven), `ideas-sweep` run against the live queue (returns empty with only the excluded seed present, exit 0). `reminders-to-ideas` is syntax-checked but deliberately not executed — it would file real pending reminders; first run is a checklist item.
- Auto-pin verified live: a job id appended to `~/.claude/jobs/pins.json` by file edit rendered as pinned in @jwildfire's `claude agents` view ("test worked", 2026-07-24); pins persist across view restarts, and no CLI flag or setting exists for this — the file is the only lane.

## Tech briefing

- `skills/session-spawn/SKILL.md`: Remote Control bullet (health check, regression handling) + `--remote-control` in the spawn command.
- `docs/remote-control.md` (new): activation lanes, human steps (the permission classifier blocks agent writes of remote-control settings at every scope — respected by design), security notes, Claude Tag verdict.
- `skills/session-inbox/SKILL.md` (new): the triage pass — Reminders ingest, watermark sweep, classification table (todo / requirement candidate / update / design note), in-thread replies as obotclaw[bot], promotion + `closeDiscussion` on approval, watermark advance only after replies post (idempotent on abort).
- `scripts/reminders-to-ideas` (new, no LLM): Apple Reminders "obot" list → Ideas discussions via GraphQL as obotclaw[bot]; marks reminders complete only after successful post; `private:` prefix diverts to a local never-posted inbox file (the hub is public). Adapted from the OpenClaw-era `ingest-reminders.sh`.
- `scripts/ideas-sweep` (new, no LLM, read-only): lists Ideas discussions new/updated since the watermark (`--advance` to move it); seed #47 excluded.
- `skills/session-init/SKILL.md`: new step 2.5 calling session-inbox (small section; may need a trivial rebase against #40, which also touches this file); step 0 now has the main session auto-pin itself in the `claude agents` view (append own job id to `~/.claude/jobs/pins.json`, prune ids of deleted jobs; siblings stay unpinned).
- `docs/terminology.md`: Spawned agent entry notes siblings start Remote Control-active.
- `drafts/`: posted hub drafts (`ISSUE_46`, `ISSUE_48`) and this PR draft.

## Next steps

- @jwildfire, Remote Control (from [#46](https://github.com/jwildfire/obot.roadmap/issues/46)): `/config` → **Enable Remote Control for all sessions** → `true`; `/remote-control` in the running lead session; optionally delete the two `rc-*probe` sessions on claude.ai/code.
- @jwildfire, idea queue: create/keep a Reminders list named **obot** (Siri: "add … to my obot list"); approve the first supervised `reminders-to-ideas` run; optionally pin [discussion #47](https://github.com/jwildfire/obot.roadmap/discussions/47) (API pinning unavailable).
- Post-merge: add the `session-inbox` symlink in `obot2/.claude/skills/` (same pattern as the other session skills); rebase or re-apply the session-init step 2.5 edit if #40 merges first.
- Review and merge via `obot-merge` after explicit approval (main is approval-gated).

---

This PR was drafted by Claude Code using Fable 5 and reviewed by @jwildfire
