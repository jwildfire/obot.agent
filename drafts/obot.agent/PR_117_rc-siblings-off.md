<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/117 on 2026-08-15 21:53 CEST -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->

Background sibling sessions no longer register with Remote Control, so they stop appearing in claude.ai/code and the Claude mobile app. @jwildfire asked for this on 2026-08-15 — "I think we can turn off the Remote control default for subagents" — meaning siblings; in-conversation subagents never had a bridge to turn off. Siblings stay visible locally in `claude agents`, and obot-prime can still message and resume any of them. Only the phone/web view goes away.

Closes #116

## Roadmap context

This is the direct consequence of [D0013](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-15-delegation-lanes/), decided earlier the same day: both delegation lanes stay, and obot-prime is the single front door. Remote Control on a sibling existed so @jwildfire could drive it from his phone. Under D0013 he does not, so it is overhead.

It reverses the 2026-07-23 always-bridged directive, made canon in #42 and tracked as [obot.roadmap#46](https://github.com/jwildfire/obot.roadmap/issues/46). The docs record it as a deliberate reversal with its reason and date, not as a quiet edit of text that always said this.

## Evidence

Three throwaway probes on CLI 2.1.233, 2026-08-15 — the decisive result is the first row, because it means the obvious change would not have worked:

| Probe | Spawn | Result |
| --- | --- | --- |
| `rcoff-flagless-probe` | `--bg`, no flag, no opt-out | **still fully bridged** — `bridgeSessionId: cse_015k636z…`, `bridgeOutboundOnly: false` |
| `rcoff-nobridge-probe` | `--bg --settings '{"remoteControlAtStartup": false}'` | unbridged, no bridge fields |
| `rcoff-permcheck-probe` | same opt-out, `--permission-mode auto`, sonnet | unbridged; ran a Bash call with no permission prompt and completed — auto mode and workspace settings survive `--settings` |

`SendMessage` was tested against the unbridged probe: delivered and processed, reported by the tool as reaching "another Claude session on this machine". The unbridged probe also appeared in `ListAgents` as a normal `bg` row seconds after spawn. Prime's lane is untouched.

`node --test` over the CI file set: 137 pass, 0 fail. `obot-policy validate`: passed, 7 repos, 0 warnings.

## Technical briefing

The CLI decides the bridge once at process start: `!(cloud || teleport) && !CLAUDE_CODE_REMOTE && (rcFlag || remoteControlAtStartup())`. The `--remote-control` flag and the global setting are peers in that `||`, and the setting has been `true` in `~/.claude/settings.json` since 2026-07-29. So simply removing the flag from the spawn command changes nothing — the spawn bridges anyway.

The opt-out forces the key off for that one process through the `flagSettings` scope, which sits ahead of `userSettings` in the resolution chain. `--settings` merges as an additional scope rather than replacing user settings, so only that key changes. An agent can do this: it is a command-line flag, not a settings-file write, so the classifier block on the key does not apply. **No settings edit is needed from @jwildfire.**

Changed:

- `skills/session-spawn/SKILL.md` — step 3 states the new rule and the one-line opt-in; step 4 carries the `--settings` argument; step 5's "how to reach it" line drops the claude.ai/code route; step 6 is rescoped to opt-in spawns only, with an explicit note on what the always-on check was buying.
- `docs/remote-control.md` — a new "The 2026-08-15 reversal" section with the probe evidence, what the bridge was actually buying, what is verified unaffected, and what is lost; plus updates to the lane table, the "why is my session not bridged" triage table, the security note, the Claude Tag recommendation and the checklist.
- `docs/terminology.md` — the Spawned agent entry.
- `skills/session-reviews/SKILL.md` — the interactive reviewer is the named opt-in and keeps `--remote-control`.
- `scripts/obot-auto` — comment only; the flag stays. The autonomous lead runs unattended overnight and should stay drivable.
- `tools/session-hub/session-audit.mjs` — the audit-apply spawn lane gets the same opt-out, with a test asserting the `--settings` form specifically (a test for "no `--remote-control`" alone would pass while still bridging).
- `NEWS.md`.

**`scripts/obot-prime` is untouched** and still passes `--remote-control` on line 77. Prime is the session @jwildfire reaches from his phone.

### What is lost

Step 6's check ran on every spawn, roughly twenty times a day, which made it a continuous canary on the undocumented `--bg` + `--remote-control` combination. It now runs only on opt-in spawns, which are rare. The two lead launchers still pass the flag on every launch, so a CLI regression would still occur there — but nothing checks them automatically, so it would surface as @jwildfire reporting prime missing from his phone rather than as an agent noticing. The triage one-liner in the runbook is the check when that happens.

## Next steps

- The rule takes effect for siblings spawned after this merges; sessions already running keep whatever they started with, since the bridge is decided at process start.
- Agent-memory notes `remote-control-framework` and `bg-session-identity` are updated with the current rule and its date.
- A consequence note is added to the D0013 artifact in the hub.

---

This PR was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
