# Remote Control in the obot session framework

@jwildfire directive (2026-07-23): every agent in the session framework should start
with Remote Control active, so any session — lead or sibling — can be watched and
driven from claude.ai/code or the Claude mobile app. This doc records how that is
implemented, what was verified, the human steps the agent cannot perform, and the
Claude Tag assessment that motivated Remote Control as the chosen path.

## What Remote Control is

Remote Control bridges a **local** Claude Code session to claude.ai/code and the
Claude mobile app: the web/mobile UI becomes a window into the local session — you
can read the transcript, send messages, and answer permission prompts from a phone.
The local session makes outbound HTTPS calls only (no inbound ports); it registers
with the Anthropic API and polls for work. Requires claude.ai login (`/login`);
API-key auth is not supported. Docs:
<https://code.claude.com/docs/en/remote-control.md>.

## The three activation lanes

| Lane | Who | How |
| --- | --- | --- |
| Sibling / background spawns | agent (automatic) | `--remote-control` on the `claude --bg` spawn command — now part of [`session-spawn`](../skills/session-spawn/SKILL.md) |
| Every interactive session | @jwildfire, once | `/config` → **Enable Remote Control for all sessions** → `true` |
| A session already running | @jwildfire, per session | type `/remote-control` in that session |

### Lane 1: background spawns (verified 2026-07-23, CLI 2.1.218)

`claude --bg --remote-control …` registers the background session with the bridge at
spawn. Evidence from throwaway probes in the obot2 workspace:

- `rc-flag-probe` (`--bg --remote-control`): `state.json` gained
  `bridgeSessionId: cse_01Rjoc…` and `bridgeOutboundOnly: false` (inbound control
  enabled) within seconds.
- `rc-live-probe` (same flags, held at a permission prompt): appeared in the
  claude.ai/code session list while live, alongside the flagged probe.
- `rc-control-probe` (`--bg` without the flag): no bridge fields, not listed.

**Caveat: this is undocumented behavior.** The official docs say Remote Control
supports one remote session per *interactive* process and don't mention `--bg`.
It works on 2.1.218; treat it as fragile. The health check is cheap: after a spawn,
`bridgeSessionId` should appear in `~/.claude/jobs/{id}/state.json` within ~15s.
If it stops appearing after a CLI update, log the regression to the scratchpad —
the spawn itself is unaffected.

The flag survives respawn: it is recorded in the job's `respawnFlags`, so a "done"
background session that gets a follow-up message re-registers with the bridge.

### Lane 2: the global default (human step)

The `/config` toggle **Enable Remote Control for all sessions** writes
`"remoteControlAtStartup": true` to `~/.claude/settings.json` (undocumented key;
schema description: "Start Remote Control bridge automatically each session").
Agent-side writes of this setting — direct file edit, `claude config set`, project
scope — are all blocked by the permission classifier, which is a sensible guard:
enabling remote control of sessions is a state change a human should make. So this
lane is a one-time checkbox for @jwildfire, not an agent action.

### Lane 3: retrofitting a running session (human step)

An already-running interactive session (e.g. the current lead 😺🤖 session) gets
Remote Control by typing `/remote-control` in it. There is no agent-side way to
flip another live session's bridge.

### Bonus lane: spawning fresh sessions from the phone

`claude remote-control` (subcommand, not flag) runs a persistent server on the Mac:
sessions started from claude.ai/code or the phone land in the chosen directory,
`--spawn worktree` isolates each in a git worktree, `--capacity N` caps concurrency
(default 32). Useful when the need is "start new work from the phone" rather than
"drive existing agents". Not wired into the framework; run ad hoc if wanted.

## Security notes

- Inbound control (`bridgeOutboundOnly: false`) means anyone with the claude.ai
  account can drive the session — single-owner account here, so acceptable by
  design. The transport never opens inbound ports on the Mac.
- Kill switch: `"disableRemoteControl": true` in any settings scope disables the
  feature entirely (documented, v2.1.128+).
- `isolatePeerMachines` (settings) requires explicit approval before a
  cross-machine `SendMessage` can reach a peer session via Remote Control —
  relevant only if a second machine ever joins.

## Claude Tag assessment (the "tag on the main session" ask)

**Claude Tag cannot do what was asked.** Verified against the July 2026 docs
(<https://claude.com/docs/claude-tag/overview.md>,
<https://claude.com/docs/claude-tag/concepts/how-it-works.md>):

- Team/Enterprise plans only — not available on Pro/Max, so not available to this
  account at all.
- Every `@Claude` Slack thread runs in an ephemeral **Anthropic-hosted sandbox**;
  it cannot attach to, observe, or control a session on the Mac. The sandbox is
  discarded when the thread goes idle.
- Requires a Claude org Owner + Slack workspace admin pairing flow
  (`@Claude connect`), and is blocked for ZDR-configured orgs.

Adjacent options, for completeness:

- `/install-slack-app` exists as a Claude Code slash command (undocumented; it
  belongs to the legacy "Claude Code in Slack" integration — Pro/Max-eligible, but
  each Slack thread drives a **cloud** session on claude.ai, not a local one, and
  the integration is being phased out in favor of Tag).
- The CLI internals contain a `slack_bot` inbound peer origin, suggesting some
  Slack→session messaging may be coming to the harness; nothing usable or
  documented today.

**Recommendation (implemented): Remote Control is the mobile/remote path for the
main obot session and all siblings.** It gives exactly the asked-for capability —
watch and steer the live local sessions from anywhere — without a plan upgrade.

## @jwildfire checklist (the two human steps + one optional)

1. In any interactive Claude Code session: `/config` → set **Enable Remote Control
   for all sessions** to `true` (covers every future interactive session; likely
   covers plain `--bg` spawns too, but that's unverified — the spawn flag makes it
   moot for siblings).
2. In the currently running lead 😺🤖 session: type `/remote-control` to bridge it
   now (one-time; future lead sessions are covered by step 1).
3. Optional: skim the probe sessions on <https://claude.ai/code> (`rc-flag-probe`,
   `rc-live-probe`) and delete them; they were throwaway verification runs.
