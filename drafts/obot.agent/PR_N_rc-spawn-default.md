<!-- STATUS: Drafted on 2026-07-23 09:27 EDT -->
<!-- GITHUB_PROPERTIES: Assignee: jwildfire, Base: main, Draft: true -->

# Session framework: siblings spawn with Remote Control active

## Summary

Every sibling spawned via `session-spawn` now starts with Remote Control active: the spawn command gains `--remote-control`, so background agents appear in claude.ai/code and the Claude mobile app with inbound control the moment they start. A new `docs/remote-control.md` runbook captures the activation lanes (including the two one-time human steps agents are correctly blocked from performing), the verification evidence, security notes, and the Claude Tag assessment that led here.

Closes jwildfire/obot.roadmap#46

## Roadmap context

Directive from the 2026-07-23 lead session (tracked as [obot.roadmap#46](https://github.com/jwildfire/obot.roadmap/issues/46)): (1) all agents start with Remote Control active; (2) set up Claude Tag on the main obot session. Part (2) is not viable — Claude Tag is Team/Enterprise-only and its Slack threads run in ephemeral Anthropic-hosted sandboxes that cannot attach to local sessions — so Remote Control is the implemented path for the main session and siblings alike. Session-framework home is obot.agent, hence this PR.

## Evidence

- Verified end-to-end on CLI 2.1.218 (2026-07-23): a probe spawned with `claude --bg --remote-control` registered a bridge (`bridgeSessionId: cse_01Rjoc…`, `bridgeOutboundOnly: false`) and was listed at [claude.ai/code](https://claude.ai/code) (`rc-flag-probe`, `rc-live-probe`); an identical spawn without the flag got no bridge and no listing.
- The `--bg` + `--remote-control` combination is undocumented (official docs describe Remote Control as interactive-only), so the skill and runbook include a ~15s `bridgeSessionId` health check and instructions to log a regression rather than fail the spawn.
- Full detail, lanes, and security notes: [`docs/remote-control.md`](https://github.com/jwildfire/obot.agent/blob/rc-spawn-default/docs/remote-control.md).

## Tech briefing

- `skills/session-spawn/SKILL.md`: new Remote Control bullet in step 3 (what the flag does, health check, regression handling) and `--remote-control` added to the step-4 spawn command.
- `docs/remote-control.md` (new): what Remote Control is; the three activation lanes (spawn flag for siblings — agent-automatic; `/config` global toggle writing `remoteControlAtStartup: true` and per-session `/remote-control` — human steps, since the permission classifier blocks agent writes of remote-control settings at every scope, a guard this design respects); `claude remote-control` server mode as a bonus lane; security notes (`disableRemoteControl` kill switch, `isolatePeerMachines`, outbound-only transport); Claude Tag verdict with doc citations; @jwildfire checklist.
- `docs/terminology.md`: one sentence on the Spawned agent entry noting siblings start Remote Control-active.
- `drafts/`: posted hub issue draft (`ISSUE_46`) and this PR draft, per the draft-file convention.

## Next steps

- @jwildfire: the two one-time steps in the [runbook checklist](https://github.com/jwildfire/obot.agent/blob/rc-spawn-default/docs/remote-control.md#jwildfire-checklist-the-two-human-steps--one-optional) — `/config` → Enable Remote Control for all sessions → `true`, and `/remote-control` in the running lead session — plus optional cleanup of the two probe sessions on claude.ai/code.
- Review and merge (main is approval-gated; merge via `obot-merge` after explicit approval).
- Watch for the flag regressing on CLI updates (health check in the skill); revisit if Remote Control for background sessions becomes documented behavior.

---

This PR was drafted by Claude Code using Fable 5 and reviewed by @jwildfire
