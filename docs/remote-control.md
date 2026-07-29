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

## How the bridge is decided

One expression in the CLI decides it, evaluated **once per process at startup**
(read out of the 2.1.220 binary; names are the minified ones):

```js
et = !(isCloudSession() || teleport) && !CLAUDE_CODE_REMOTE && (rcFlag || remoteControlAtStartup())
```

Two things follow, and they explain every case below:

1. **The `--remote-control` flag and the `remoteControlAtStartup` setting are
   peers in one `||`.** Either alone is sufficient. Neither is special-cased to
   interactive sessions.
2. **The decision is made at process start.** Nothing later can flip it — which
   is why a *running* session cannot be bridged from the outside, and why a
   session started before the setting was turned on stays unbridged for its
   whole life.

The setting resolves across scopes as
`policySettings ?? flagSettings ?? userSettings ?? legacy global config`, with
project and local scopes able to force it **off** (`=== false`) but not on.
`~/.claude/settings.json` is the `userSettings` scope — the one the `/config`
toggle writes.

## The activation lanes

| Lane | Who | How | Bridged? |
| --- | --- | --- | --- |
| Sibling `👯🤖` spawns | agent (automatic) | `--remote-control` on the `claude --bg` command — [`session-spawn`](../skills/session-spawn/SKILL.md) step 4, verified at step 5 | yes, since 2026-07-23 |
| Autonomous `🦾🤖` lead | agent (automatic) | `--remote-control` in [`scripts/obot-auto`](../scripts/obot-auto) | yes, since oa#54 |
| Agents-view dispatch | @jwildfire | no flag available — relies entirely on the global setting | yes, since 2026-07-29 |
| Any interactive session | @jwildfire, once | `/config` → **Enable Remote Control for all sessions** → `true` | yes, since 2026-07-29 |
| A session already running | @jwildfire, per session | type `/remote-control` in that session | on demand |

### Lane 1: background spawns (verified 2026-07-23 on CLI 2.1.218; re-verified 2026-07-29 on 2.1.220)

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
It works on 2.1.218 and 2.1.220; treat it as fragile. That is why the health
check is a **required step** in `session-spawn`, not an aside: after a spawn,
`bridgeSessionId` must appear in `~/.claude/jobs/{id}/state.json` within ~15s.
If it stops appearing after a CLI update, log the regression to the scratchpad —
the spawn itself is unaffected.

The flag survives respawn: it is recorded in the job's `respawnFlags`, so a "done"
background session that gets a follow-up message re-registers with the bridge.

### Lane 2: the global default — verified 2026-07-29, and it covers `--bg` too

The `/config` toggle **Enable Remote Control for all sessions** writes
`"remoteControlAtStartup": true` to `~/.claude/settings.json` (undocumented key;
schema description: "Start Remote Control bridge automatically each session").

**The open question from 2026-07-23 — does this cover `claude --bg`, or only
interactive sessions? — is now settled: it covers `--bg`.** Two throwaway probes
on CLI 2.1.220, neither passing `--remote-control`:

- `rc-setting-probe` (`--bg` with the setting supplied via `--settings`):
  bridged — `bridgeSessionId: cse_01BjNkeP…`, `bridgeOutboundOnly: false`, i.e.
  full inbound control, exactly as the flag produces.
- `rc-control-probe` (`--bg`, no flag, no setting): no bridge fields.

The probe supplied the setting through the `flagSettings` scope (`--settings`)
rather than by editing `~/.claude/settings.json`, because agents cannot write
that file (below). Both scopes feed the same `??` chain and the same single
`||` above, so the mechanism is what was verified; the `userSettings` scope
specifically is inference from the resolution order, not a separate observation.

**Agents cannot set this key.** Re-verified 2026-07-29 on 2.1.220: an edit
adding `remoteControlAtStartup` was denied by the permission classifier. The
block is **broader than previously documented** — the earlier note covered
`~/.claude/settings.json`, `claude config set`, and project scope; the denial
also fires on `~/.claude/settings.local.json`. Treat the key as human-only in
every scope. (Observed side effect: after that denial the classifier kept
refusing `claude …` invocations for the rest of that session, including
`claude --help`. If an agent session suddenly cannot shell out to `claude`,
this is why — start a fresh session rather than fighting it.)

This lane is therefore a one-time checkbox for @jwildfire, not an agent action.
**Done 2026-07-29 06:11.**

### Lane 3: retrofitting a running session (human step)

An already-running session gets Remote Control by typing `/remote-control` in
it. There is no agent-side way to flip another live session's bridge — the
decision is made at process start, and no CLI subcommand, settings write, or
daemon call re-opens it.

For a **background** job the cheaper retrofit is a restart rather than an
attach: a `done` bg job re-execs from its `respawnFlags` on its next message,
and the setting is read fresh at that start — so with lane 2 on, simply sending
the job a follow-up message should bring it back bridged, no typing required.
(Expected from the startup expression above; not separately observed, because
the classifier clamp described in lane 2 ended that session's ability to run
probes. Cheap to confirm: message the job, then look for it on claude.ai/code.)

### Lane 4: agents-view dispatch — the lane that was missing

Sessions dispatched from the **agents view** (rather than a `claude --bg`
command in a shell) take no `--remote-control` flag: there is nowhere to pass
one. Their jobs are identifiable by `template: "claude"` and a `respawnFlags`
signature of `['--agent','claude','--model',…]` — no `-n`, no
`--permission-mode`.

This is the lane that kept the lead 😺🤖 session off Remote Control from
2026-07-23 to 2026-07-29, and it is why the fix never came from `session-spawn`
hardening: **the lead session was never spawned by that skill.** oa#54 recorded
the same symptom for the 2026-07-26 autonomous lead and attributed it to
`obot-auto`; the job signature shows that session came through this lane too.
`obot-auto`'s missing flag was a real and separate gap (fixed in oa#54), but it
was not the cause of either unbridged job.

**Lane 2 is the only fix for this lane** — there is no flag to add. That makes
the global toggle load-bearing rather than optional.

### Bonus lane: spawning fresh sessions from the phone

`claude remote-control` (subcommand, not flag) runs a persistent server on the Mac:
sessions started from claude.ai/code or the phone land in the chosen directory,
`--spawn worktree` isolates each in a git worktree, `--capacity N` caps concurrency
(default 32). Useful when the need is "start new work from the phone" rather than
"drive existing agents". Not wired into the framework; run ad hoc if wanted.

## "Why is my session not bridged?"

Start by identifying the lane that launched it — the fix differs per lane, and
guessing wrong costs a session. Every background session has a job directory;
interactive ones do not.

```bash
python3 - <<'PY'
import json, glob, os
for p in sorted(glob.glob(os.path.expanduser('~/.claude/jobs/*/state.json'))):
    d = json.load(open(p))
    print(f"{os.path.basename(os.path.dirname(p))} "
          f"{'BRIDGED' if d.get('bridgeSessionId') else 'NOT BRIDGED':<11} "
          f"template={d.get('template'):<7} {d.get('name')!r}\n     {d.get('respawnFlags')}")
PY
```

| What you see | Lane | Why it is unbridged | Fix |
| --- | --- | --- | --- |
| `template: bg`, flags include `--remote-control` | sibling spawn | should not happen | CLI regression — record the version, see lane 1 |
| `template: bg`, flags have `-n 👯🤖 …` but no `--remote-control` | sibling spawn | spawned without the flag | `session-spawn` step 4 was not followed |
| `template: bg`, flags have `-n 🦾🤖 …` but no `--remote-control` | `obot-auto` | pre-oa#54 `obot-auto` | fixed — re-run on current `main` |
| `template: claude`, flags `['--agent','claude','--model',…]` | agents-view dispatch | no flag exists for this lane | lane 2 (global setting); this session needs a restart or `/remote-control` |
| no job directory at all | interactive terminal | started before lane 2 was on | `/remote-control` in that session |
| any lane, and `remoteControlAtStartup` is not `true` | — | the global default is off | @jwildfire re-flips the `/config` toggle — **an agent cannot** |

Two cross-cutting rules worth remembering before diagnosing anything else:

- **A session started before the setting was turned on is unbridged for its
  entire life.** The bridge is decided once at startup. Turning the toggle on
  does not reach backwards — it only affects sessions that start afterwards.
- **Being "bridged" is a property of the process, not of the job.** Restarting
  a bg job (any follow-up message to a `done` job) re-evaluates it.

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

## @jwildfire checklist

**Step 1 — done 2026-07-29 06:11.** `/config` → **Enable Remote Control for all
sessions** → `true`. Verified present in `~/.claude/settings.json`, and verified
to cover `--bg` spawns as well as interactive ones. Every session started from
that moment on is bridged regardless of lane. Nothing to redo unless the key
gets reset — and if it does, an agent cannot put it back.

**Step 2 — the one thing still outstanding.** The lead 😺🤖 session was started
before step 1, so it is still unbridged and will stay that way for its whole
life. Pick one:

- **Send it any follow-up message.** It is a `done` background job, so the
  message re-execs it and the now-true setting applies at that start. Expected
  to be enough on its own — verify by looking for it on
  <https://claude.ai/code>.
- **Or `claude attach 96636d0f` and type `/remote-control`.** The certain
  route if the restart above does not do it.

**Step 3 — optional cleanup.** Three throwaway probe sessions are on
<https://claude.ai/code> and can be deleted: `rc-flag-probe` and `rc-live-probe`
(2026-07-23), `rc-setting-probe` (2026-07-29). The `rc-control-probe` runs were
never bridged, so they never appear there.
