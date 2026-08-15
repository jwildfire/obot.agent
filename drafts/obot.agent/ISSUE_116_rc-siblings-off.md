<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/116 on 2026-08-15 21:47 CEST -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->

Background siblings should not register with Remote Control any more. @jwildfire, 2026-08-15: "I think we can turn off the Remote control default for subagents." He means siblings — in-conversation subagents never had a bridge.

This follows from [D0013](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-15-delegation-lanes/), decided earlier the same day: obot-prime is his single front door and he no longer opens sibling sessions himself. A bridge he never uses is overhead. It reverses the 2026-07-23 always-bridged directive (canon in #42), deliberately and with a stated reason.

## The catch: removing the flag does nothing

`--remote-control` and the global `remoteControlAtStartup` setting are peers in one `||` in the CLI's startup expression, and that setting has been `true` in `~/.claude/settings.json` since 2026-07-29. A spawn with the flag simply removed still bridges.

Verified tonight on CLI 2.1.233 with three throwaway probes:

- `--bg`, no flag, no opt-out → bridged (`bridgeSessionId: cse_015k636z…`, `bridgeOutboundOnly: false`).
- `--bg --settings '{"remoteControlAtStartup": false}'` → unbridged.
- Same opt-out plus `--permission-mode auto` on sonnet → unbridged, and a Bash call ran with no permission prompt. `--settings` merges as an extra scope, so permission mode and workspace settings are unaffected.

An agent can pass `--settings`; it is a command-line flag, not a settings-file write, so the classifier block on that key does not apply. No settings edit is needed from @jwildfire.

## What does not change

- `scripts/obot-prime` keeps `--remote-control`. Prime is the session he reaches from his phone.
- `scripts/obot-auto` keeps it too. The autonomous lead runs unattended overnight and should stay drivable.
- `session-reviews` keeps it. That reviewer is an interactive sibling he converses with — the named opt-in.

## What is not affected, verified rather than assumed

- **Cross-session `SendMessage` does not use the bridge.** A message to the unbridged probe was delivered and processed, described by the tool as reaching "another Claude session on this machine". Prime's ability to message and resume siblings is untouched.
- **`claude agents` still lists unbridged siblings.** They are local jobs; the agents view reads job directories.
- **Nothing in the dashboard, session-hub, or Navigator reads bridge state.**

## What is lost

`session-spawn` step 6's bridge check was a continuous canary on the undocumented `--bg` + `--remote-control` combination, running ~20 times a day. It now runs only on opt-in spawns. The lead launchers still pass the flag every launch, so a CLI regression would still happen there — but it would surface as @jwildfire reporting prime missing from his phone rather than as an agent noticing.

## Scope

- `skills/session-spawn/SKILL.md` — step 3 rule, step 4 command, step 5 reach-it line, step 6 rescoped to the opt-in lane.
- `docs/remote-control.md` — record the reversal with its evidence; update the lane table, the triage table, the security note and the checklist.
- `docs/terminology.md` — the Spawned agent entry.
- `skills/session-reviews/SKILL.md` — mark it the named opt-in.
- `scripts/obot-auto` — the comment claiming this is sibling canon.
- `tools/session-hub/session-audit.mjs` — the audit-apply spawn lane, plus a test.
- `NEWS.md`.

---

This Issue was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
