<!-- STATUS: Posted to https://github.com/jwildfire/obot.roadmap/issues/46 on 2026-07-23 09:26 EDT -->
<!-- GITHUB_PROPERTIES: Assignee: jwildfire -->

# Session framework: Remote Control on every agent; Claude Tag not viable

## Summary

Directive (2026-07-23): all agents should start with Remote Control active, and set up Claude Tag on the main obot session. Investigation result: Remote Control is implementable across the framework and is now wired in; Claude Tag is structurally unable to do what was asked (plan tier + architecture), so Remote Control is the mobile/remote path for the main session too.

## What ships (agent-done)

- `obot.agent` PR (linked below): `session-spawn` now spawns every sibling with `--remote-control`, so background agents appear in claude.ai/code and the Claude mobile app with inbound control; plus `docs/remote-control.md` — the full runbook (activation lanes, verification evidence, security notes, Tag assessment).
- Verified end-to-end on CLI 2.1.218: probe spawns with `--bg --remote-control` got a `bridgeSessionId` (`bridgeOutboundOnly: false`) and showed up in the claude.ai/code session list; an unflagged control probe did not. Note this flag combination is undocumented (docs call RC interactive-only) — the runbook includes a cheap health check for CLI updates.

## Human steps (agent-blocked by design)

The permission classifier blocks agents from writing remote-control settings — correctly. Two one-time steps for @jwildfire:

1. `/config` → **Enable Remote Control for all sessions** → `true` (writes `remoteControlAtStartup: true` to `~/.claude/settings.json`; covers all future interactive sessions).
2. In the currently running lead 😺🤖 session, type `/remote-control` to bridge it now.

Optional: delete the throwaway `rc-flag-probe` / `rc-live-probe` sessions from claude.ai/code.

## Claude Tag verdict

Not viable for this use, per the July 2026 docs: Team/Enterprise plans only (not Pro/Max); every `@Claude` Slack thread runs in an ephemeral Anthropic-hosted sandbox and cannot attach to, observe, or control a local session. The legacy "Claude Code in Slack" (`/install-slack-app`) is Pro/Max-eligible but drives cloud sessions only and is being phased out. Recommendation implemented: Remote Control instead.

---

This Issue was drafted by Claude Code using Fable 5 and reviewed by @jwildfire
