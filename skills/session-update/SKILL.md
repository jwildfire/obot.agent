---
name: session-update
description: "Add an item to the running session todo list. Use mid-session when @jwildfire says 'session update: …', 'add that to the session todo', or work surfaces a task to pick up later — the item lands in the session scratchpad that session-wrapup sweeps and session-init re-reads. Do NOT use for already-scoped roadmap work (file/edit the issue directly) or for prose observations (that is session-note)."
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
```

`## Overview` belongs to [`session-init`](../session-init/SKILL.md) (the
persisted kickoff list); `## Todo` belongs to this skill; `## Notes` belongs to
[`session-note`](../session-note/SKILL.md). Lines are checked off (`- [x]`) when
captured elsewhere — never deleted.

## When to Use

- @jwildfire says "session update: …", "add X to the session todo", "don't let me
  forget…", or similar mid-session.
- Work in flight surfaces a follow-up task that shouldn't derail the current
  thread.

**Do not use** for work that already has (or clearly deserves) an issue — file or
edit the issue directly instead; the scratchpad is for items too small or too raw
to scope yet. For non-task observations, use `session-note`.

## Procedure

1. **Resolve today's scratchpad** — `.claude/session-notes/YYYY-MM-DD.md` under
   the workspace root; create it (and the directory) with the skeleton above if
   missing.
2. **Append the item** under `## Todo`:

   ```markdown
   - [ ] {item} *(added HH:MM)*
   ```

   Keep the item one line and self-contained — it will be read cold at wrapup or
   next kickoff; include links/issue numbers if they exist.
3. **Confirm** by echoing the current Todo list back, so @jwildfire sees the
   running state. Then return to the interrupted work — adding the item is not a
   license to start it.

## Lifecycle

- [`session-todo`](../session-todo/SKILL.md) re-renders the full session list
  (kickoff priorities + these additions + notes) on demand and checks items off
  as they finish.
- `session-wrapup` sweeps unchecked items into durable homes and checks them off.
- `session-init` carries any still-unchecked items (e.g. from a session that
  ended without a wrapup) into the next kickoff list.
