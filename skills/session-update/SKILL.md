---
name: session-update
description: "Add an item to the running session todo list. Use mid-session when @jwildfire says 'session update: …', 'add that to the session todo', or work surfaces a task to pick up later — the item lands in the session scratchpad that session-wrapup sweeps and session-init re-reads. One-shot capture: a single idempotent write, echoing back only the line written. Do NOT use for already-scoped roadmap work (file/edit the issue directly), for prose observations (that is session-note), or for an idea aimed at the roadmap rather than this session (that is session-idea)."
argument-hint: "The todo item to add"
---

# Session Update

Capture a todo the moment it surfaces, so it survives the session without
interrupting the work in flight. Items go to the **session scratchpad** — the
mid-session capture channel between [`session-init`](../session-init/SKILL.md)
(which re-reads unfinished items at the next kickoff) and
[`session-wrapup`](../session-wrapup/SKILL.md) (which sweeps them into durable
homes: an issue, a diary loose end, or memory).

## The session scratchpad

One file per day, in the **workspace root** (not a git repo — nothing to commit):

```
.claude/session-notes/YYYY-MM-DD.md
```

Created on first write with this skeleton:

```markdown
# Session scratchpad — YYYY-MM-DD

## Overview

## Todo

## Notes

## Scaffold

## Session log
```

`## Overview` belongs to [`session-init`](../session-init/SKILL.md) (the
persisted kickoff list); `## Todo` belongs to this skill; `## Notes` belongs to
[`session-note`](../session-note/SKILL.md); `## Scaffold` belongs to
[`session-scaffold`](../session-scaffold/SKILL.md); `## Session log` belongs to
the heartbeat (below). Lines are checked off (`- [x]`) when captured elsewhere —
never deleted. The [session hub](../../tools/session-hub/README.md) renders
these sections live.

### The heartbeat: every agent logs key events

The scratchpad is shared by **all of the day's sessions** — lead, siblings, and
ultracode jobs — and [`session-wrapup`](../session-wrapup/SKILL.md) folds it as
the session inventory, so an unlogged event is invisible at wrapup. Three
mechanisms keep it current (the lean-bookends design, 2026-07-14):

- **Spawn briefing** — [`session-spawn`](../session-spawn/SKILL.md) instructs
  every sibling to log key events (start, milestones, PRs/issues posted,
  blockers, completion) and to append a final close-out line (what shipped,
  what's unfinished) before it ends.
- **Stop-hook nudge** — a workspace hook
  (`.claude/hooks/scratchpad-heartbeat.sh`) reminds any working session that
  goes >30 minutes without a scratchpad write, once per staleness window.
- **This skill and `session-note`** — @jwildfire's and the lead's own capture
  channels.

**Multi-writer rules:** log under `## Session log` as tagged one-liners —
`- $(date +%H:%M) {tag} — {event}` with the session's tag (`😺🤖 lead`,
`👯🤖 {slug}`, `⚡️🤖 {description}`) and links inline; the timestamp is
**shelled, never modeled**. The append is **heading-anchored**: insert the line
under `## Session log`, never blind-appended to end-of-file with `>>` — on any
scratchpad whose sections have drifted, a bare `>>` lands the line under
`## Scaffold` and corrupts the wrapup's inventory (obot.agent#57). The exact
command (skeleton-on-missing, insert-under-heading) is in
[`templates/sibling-briefing.md`](../../templates/sibling-briefing.md); use it
rather than improvising. Never rewrite the file with the Write tool from a
sibling; concurrent sessions share it. The lead may edit other sections
(check-offs, Overview refresh) after re-reading the file — **section-replacing
writes are a known lost-write hazard under concurrency (hub#147), so only the
lead does them**.

## When to Use

- @jwildfire says "session update: …", "add X to the session todo", "don't let me
  forget…", or similar mid-session.
- Work in flight surfaces a follow-up task that shouldn't derail the current
  thread.

**Do not use** for work that already has (or clearly deserves) an issue — file or
edit the issue directly instead; the scratchpad is for items too small or too raw
to scope yet. For non-task observations, use `session-note`; for something nobody
is committing to do this session, use [`session-idea`](../session-idea/SKILL.md) —
the test is whether it belongs to this session or to the roadmap.

## Procedure

Capture is a **sub-10-second operation** — one tool call, one sentence back (see
[`docs/session-framework.md`](../../docs/session-framework.md)). Do not resolve,
then read, then append: that is three round trips for a one-line write.

1. **Write the item in one idempotent shell call** — it creates the scratchpad
   with the skeleton if missing and inserts the line under `## Todo` in the same
   call. The timestamp is **shelled, never modeled**:

   ```bash
   WS=~/Documents/obot2
   LOG="$WS/.claude/session-notes/$(date +%F).md"
   LINE="- [ ] {item} $(date '+*(added %H:%M)*')"
   python3 - "$LOG" "$LINE" <<'PY'
   import sys, pathlib
   p, line = pathlib.Path(sys.argv[1]), sys.argv[2]
   if not p.exists():
       p.parent.mkdir(parents=True, exist_ok=True)
       p.write_text(f"# Session scratchpad — {p.stem}\n\n## Overview\n\n## Todo\n\n## Notes\n\n## Scaffold\n\n## Session log\n")
   lines = p.read_text().splitlines()
   if "## Todo" not in lines:
       lines += ["", "## Todo"]
   i = lines.index("## Todo") + 1
   j = i
   while j < len(lines) and not lines[j].startswith("## "):
       j += 1
   while j > i and not lines[j-1].strip():
       j -= 1
   lines.insert(j, line)
   p.write_text("\n".join(lines) + "\n")
   PY
   ```

   Keep the item one line and self-contained — it will be read cold at wrapup or
   next kickoff; include links/issue numbers if they exist.
2. **Confirm in one sentence** by echoing back **only the line just written**.
   Do not re-read the file and do not re-render the list: re-rendering the whole
   list is [`session-todo`](../session-todo/SKILL.md)'s job and costs a round trip
   the capture does not need. Then return to the interrupted work — adding the
   item is not a license to start it.

## Lifecycle

- [`session-todo`](../session-todo/SKILL.md) re-renders the full session list
  (kickoff priorities + these additions + notes) on demand and checks items off
  as they finish.
- `session-wrapup` sweeps unchecked items into durable homes and checks them off.
- `session-init` carries any still-unchecked items (e.g. from a session that
  ended without a wrapup) into the next kickoff list.
