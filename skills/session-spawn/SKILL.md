---
name: session-spawn
description: "Spawn a sibling background claude agent carrying a context briefing from the current session plus the session-framework contract: 👯🤖 identity, auto permission mode, deliberate model/effort choice, and the scratchpad heartbeat (log key events, close out before finishing). The briefing comes from templates/sibling-briefing.md and carries the report-back contract, the shelled-timestamp heartbeat, and the responsiveness contract siblings inherit. Use when @jwildfire says 'spawn an agent for X', '/session-spawn', or work should fork to a parallel background sibling. Do NOT use for in-conversation subagents (the Agent tool) or ultracode/Workflow jobs (⚡️🤖, tracked separately)."
argument-hint: "The task for the spawned agent"
---

# Session Spawn

Fork work to a background sibling without it falling out of the session
framework: the sibling gets a context briefing from the current session, the
workspace identity conventions, and the scratchpad heartbeat contract — so its
work stays visible to [`session-todo`](../session-todo/SKILL.md) all session and
foldable by [`session-wrapup`](../session-wrapup/SKILL.md) at close. Formerly
the `scaffold:spawn` plugin command; moved here 2026-07-14 when the heartbeat
made it session machinery rather than a general-purpose personal command.

Spawn is the delegation primitive of the
[responsiveness contract](../../docs/session-framework.md): anything that would
cost the lead more than ~30 seconds forks here.

## When to Use

- @jwildfire asks to spawn/fork a background agent for a task.
- The lead session identifies work worth parallelizing into a sibling (a build,
  a long investigation, an independent deliverable).
- Routine recon that would otherwise block a chat reply: a GitHub delta, an ideas
  sweep, a PR queue, a free-text investigation. The trigger is not "this is a big
  build", it is "**this would cost me more than ~30 seconds**".

**Do not use** for in-conversation subagents (the Agent tool — results return to
this session, no heartbeat needed) or for ultracode/Workflow jobs (`⚡️🤖
{description}` — tracked separately, 2026-07-12).

## Procedure

### 1. Write the briefing

Fill in [`templates/sibling-briefing.md`](../../templates/sibling-briefing.md).
The `## Context` block is the only part composed per spawn — cwd and key paths
already touched, findings/decisions/constraints established here, recent errors
or state worth knowing, what has already been tried and ruled out. One line each,
under ~300 words. Everything below `## Context` is fixed text, so a spawn is a
fill-in, not an essay.

Skip anything the agent can rediscover by reading the code.

### 2. Standing instructions — always in the briefing

The template carries them as fixed sections: the **report-back contract** (lists
not prose, deliverable to disk, `nothing changed` in exactly one line, close out
with what the lead must relay, the lead is not waiting on you), the **heartbeat
contract**, **ending your session** with a terminal `result:` line, and the
**standing rules** (merges, org scope, deletions, attribution, GitHub bodies).
Do not retype them here; fill in the placeholders.

Two things stay spawn-specific:

- **The heartbeat append is heading-anchored** — inserted under `## Session log`
  with a shelled `$(date +%H:%M)`, per the exact command in the template. Never a
  bare end-of-file `>>` (it lands under `## Scaffold` on a drifted scratchpad and
  corrupts the wrapup's inventory, obot.agent#57), and never a modeled timestamp.
  Fill in the workspace root and the sibling's `{slug}`; multi-writer rules are in
  [`session-update`](../session-update/SKILL.md).
- **Merging**: never merge without Jeremy's explicit approval (operating
  contract — unchanged). Once a merge IS approved, use the policy-gated lane
  only: `obot.agent/scripts/obot-merge <pr#> -R <owner>/<repo>` (add `--check`
  to dry-run the policy first). It resolves the base branch against
  [`scripts/policy.json`](../../scripts/policy.json), merges as
  obotclaw[bot], and verifies the result. Only the **integration** branch of an
  **`auto`**-profile repo merges on the standard lane; every branch of a
  `protected` repo, and every **release**-role branch anywhere (a release
  branch, or a published surface like demo-301's `site`), is on the *attested*
  lane and additionally needs
  `--jeremy-approved '<where/when he approved>'` — pass it ONLY when Jeremy
  explicitly approved that specific merge in-session; the note is posted on the
  PR as an audit comment. Raw `gh pr merge`, REST, and GraphQL merges are
  denied by the workspace `merge-gate-guard` PreToolUse hook — a denial there
  means "use obot-merge", not "find another route".
  `scripts/obot-policy explain <owner/repo>` prints a repo's effective
  permissions if you need to check before starting work.

### 3. Pick the spawn parameters deliberately

As the lead agent this is your call — think strategically per sibling rather
than defaulting to your own settings:

- **Model** (`--model`): judgment-heavy, novel, or framework-shaping work → the
  strongest available model (fable — siblings and subagents are where Fable
  lives: leads default to opus, @jwildfire 2026-08-04); well-specified
  template-following implementation → a mid-tier model (e.g. opus); light
  mechanical chores → a small fast model (e.g. sonnet or haiku). State the
  choice and why in your reply (allocation grant, 2026-07-11).
- **Effort** (`--effort`): inherit by default; raise it for hard verification or
  judgment work, lower it for mechanical tasks.
- **Name** (`-n`): `👯🤖 {YYYY-MM-DD} {slug}` per the workspace naming
  convention; siblings are **green** (a background session sets `color` in its
  own `~/.claude/jobs/{id}/state.json`).
- **Permission mode**: siblings always spawn in auto mode — pass
  `--permission-mode auto` explicitly rather than relying on inheritance.
- **Remote Control**: siblings always spawn with `--remote-control` so the
  session shows up in claude.ai/code and the Claude mobile app and can be
  driven from there (@jwildfire directive, 2026-07-23). On success the job's
  `~/.claude/jobs/{id}/state.json` gains a `bridgeSessionId` within ~15s of
  spawn. This flag combination is undocumented for `--bg` (verified working on
  CLI 2.1.218; see [`docs/remote-control.md`](../../docs/remote-control.md)) —
  if `bridgeSessionId` never appears after a CLI update, log the regression to
  the scratchpad and keep going; the spawn itself is unaffected.

### 4. Run it

```bash
claude --bg --permission-mode auto --remote-control --model <model> -n "👯🤖 <date> <slug>" "<briefing>\n\n---\n\nTASK: $ARGUMENTS"
```

(add `--effort <level>` when deviating from the default)

### 5. Log the spawn — in the same call, and ack in the same message

Do **not** spend a second round trip on the log line. Batch it into the spawn
call: run the `claude --bg …` command and the heading-anchored `## Session log`
append in one Bash call (`&&`-chained, or the spawn backgrounded and the append
after it), with the lead's own tag and a shelled timestamp:

```
- $(date +%H:%M) 😺🤖 lead — spawned 👯🤖 {slug}: {task}
```

(the insert-under-the-heading command is the one in
[`templates/sibling-briefing.md`](../../templates/sibling-briefing.md), with
`😺🤖 lead` as the tag).

The **ack to @jwildfire goes in the same message as the spawn** — one line: what
was delegated, to which slug, and how to reach it (`claude agents`, or
claude.ai/code via Remote Control). Then return to whatever he asked, and relay
the sibling's result at your next turn.

The wrapup then knows the sibling exists even if it never logs a line — that
mismatch is exactly the "known gap" that justifies transcript mining in
[`session-wrapup`](../session-wrapup/SKILL.md) step 0.
