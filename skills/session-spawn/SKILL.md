---
name: session-spawn
description: "Spawn a sibling background claude agent carrying a context briefing from the current session plus the session-framework contract: 👯🤖 identity, auto permission mode, deliberate model/effort choice, and the scratchpad heartbeat (log key events, close out before finishing). Use when @jwildfire says 'spawn an agent for X', '/session-spawn', or work should fork to a parallel background sibling. Do NOT use for in-conversation subagents (the Agent tool) or ultracode/Workflow jobs (⚡️🤖, tracked separately)."
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

## When to Use

- @jwildfire asks to spawn/fork a background agent for a task.
- The lead session identifies work worth parallelizing into a sibling (a build,
  a long investigation, an independent deliverable).

**Do not use** for in-conversation subagents (the Agent tool — results return to
this session, no heartbeat needed) or for ultracode/Workflow jobs (`⚡️🤖
{description}` — tracked separately, 2026-07-12).

## Procedure

### 1. Write the briefing

A concise context briefing (under ~300 words) capturing what the new agent
needs from the current session:

- cwd and key file paths already touched
- Findings, decisions, or constraints established here
- Recent errors, command outputs, or state worth knowing
- What's already been tried and ruled out

Skip anything the agent can rediscover by reading the code.

### 2. Standing instructions — always in the briefing

- **Deliverables to disk**: commit or file mid-flight deliverables (design
  catalogs, review findings, decisions) to disk or an issue as they are
  produced — transcripts die with the session; on-disk work survives.
- **The heartbeat contract** (fill in the workspace root and the agent's tag):
  log key events — start, milestones, PRs/issues posted, blockers, completion —
  to the shared session scratchpad
  `{workspace root}/.claude/session-notes/{YYYY-MM-DD}.md` under
  `## Session log`, as tagged one-liners
  (`- HH:MM 👯🤖 {slug} — {event}`, links inline). Append-only via shell `>>` —
  never rewrite the file; other sessions share it (multi-writer rules in
  [`session-update`](../session-update/SKILL.md)). If the file is missing,
  create it via `>>` with the skeleton sections. **Before finishing, always
  append a final close-out line**: what shipped (with links) and what's
  unfinished — the wrapup folds the scratchpad, so an unlogged event is
  invisible to it. A workspace Stop hook nudges any session that goes quiet;
  respond by logging, not by ignoring it.
- **Merging**: never merge without Jeremy's explicit approval (operating
  contract — unchanged). Once a merge IS approved, use the policy-gated lane
  only: `obot.agent/scripts/obot-merge <pr#> -R <owner>/<repo>` (add `--check`
  to dry-run the policy first). It verifies the base branch against
  [`scripts/merge-policy.json`](../../scripts/merge-policy.json), merges as
  obotclaw[bot], and verifies the result. Protected/release branches
  (`approvalRequired` tier) additionally need
  `--jeremy-approved '<where/when he approved>'` — pass it ONLY when Jeremy
  explicitly approved that specific merge in-session; the note is posted on the
  PR as an audit comment. Raw `gh pr merge`, REST, and GraphQL merges are
  denied by the workspace `merge-gate-guard` PreToolUse hook — a denial there
  means "use obot-merge", not "find another route".

### 3. Pick the spawn parameters deliberately

As the lead agent this is your call — think strategically per sibling rather
than defaulting to your own settings:

- **Model** (`--model`): judgment-heavy, novel, or framework-shaping work → the
  strongest available model; well-specified template-following implementation →
  a mid-tier model (e.g. opus); light mechanical chores → a small fast model
  (e.g. sonnet or haiku). State the choice and why in your reply (allocation
  grant, 2026-07-11).
- **Effort** (`--effort`): inherit by default; raise it for hard verification or
  judgment work, lower it for mechanical tasks.
- **Name** (`-n`): `👯🤖 {YYYY-MM-DD} {slug}` per the workspace naming
  convention; siblings are **green** (a background session sets `color` in its
  own `~/.claude/jobs/{id}/state.json`).
- **Permission mode**: siblings always spawn in auto mode — pass
  `--permission-mode auto` explicitly rather than relying on inheritance.

### 4. Run it

```bash
claude --bg --permission-mode auto --model <model> -n "👯🤖 <date> <slug>" "<briefing>\n\n---\n\nTASK: $ARGUMENTS"
```

(add `--effort <level>` when deviating from the default)

### 5. Log the spawn

Append the spawn itself to the scratchpad's `## Session log`
(`- HH:MM 😺🤖 lead — spawned 👯🤖 {slug}: {task}`). The wrapup then knows the
sibling exists even if it never logs a line — that mismatch is exactly the
"known gap" that justifies transcript mining in
[`session-wrapup`](../session-wrapup/SKILL.md) step 1.
