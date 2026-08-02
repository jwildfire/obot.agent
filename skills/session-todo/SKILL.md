---
name: session-todo
description: "Render the session todo list: the prioritized kickoff list persisted by session-init, plus mid-session additions from session-update and notes from session-note. Use when @jwildfire asks 'session todo', 'show the list', 'what's left this session', or after finishing items. Also checks items off when told they're done. Straggler files are bounded (three most recent, none older than 7 days) and it points at the live session-hub page when the watch loop is running. Do NOT use to regenerate priorities from scratch (that is session-init)."
argument-hint: "Optional: item(s) to check off before rendering"
---

# Session Todo

One command that answers "where are we?" — render the session's running state as
a single nicely formatted todo list: the prioritized list
[`session-init`](../session-init/SKILL.md) generated at kickoff, any
items added mid-session by [`session-update`](../session-update/SKILL.md), and
the notes captured by [`session-note`](../session-note/SKILL.md). Everything
comes from the **session scratchpad** (see `session-update` for the file's
location and skeleton): `.claude/session-notes/YYYY-MM-DD.md` in the workspace
root. Formerly named `session-checklist`.

## When to Use

- @jwildfire asks "session todo", "show the list", "what's left", or wants the
  running state after adding or finishing items.
- After a batch of work, to confirm what's still open this session.

**Do not use** to *regenerate* the priorities — that is `session-init`,
which sweeps the live roadmap and re-persists the list. This skill only renders
what the scratchpad already holds.

## Procedure

**Batch the whole flow**: the check-offs (edits) and the reads go out in **one
tool block**, then one render — three sequential round trips become one plus the
render.

1. **Check off first, if asked** — if the request (or the argument) names
   finished items, mark them in the scratchpad, in whichever section they live
   (`## Overview` or `## Todo`):

   ```markdown
   - [x] {item} *(done HH:MM)*
   ```

   The `HH:MM` is **shelled, never modeled** (obot.agent#57) — write the line with
   the same heading-anchored shell helper the heartbeat uses, substituting
   `$(date '+*(done %H:%M)*')`, so a check-off never carries a hallucinated clock.

   Check off, never delete.
2. **Read the scratchpad** — today's file plus **at most the three most recent
   prior files, and none older than 7 days**, in **one batched call** (not a
   glob-then-read sequence). Older unchecked items were the previous wrapup's job
   and are carried in the hand-off; they are not re-swept here.
3. **Take the cheap path when the ask is just "what's left?"** — render today's
   `## Overview` and unchecked `## Todo` first, and note stragglers as a one-line
   trailing count rather than expanding them. Expand only if he asks.
4. **Point at the live view when it exists** — if a session-hub watch loop is
   running (`pgrep -f "session-hub.mjs --watch"`), say so and point at the live
   page rather than re-deriving what the loop already renders every 60s;
   [`session-dashboard`](../session-dashboard/SKILL.md) opens it.
5. **Render one formatted list**, top to bottom:

   - A one-line status summary: `N open / M done`.
   - **The kickoff priorities** (`## Overview`) as a markdown task list, keeping
     the numbering and the two groups — *Agent-actionable* and *Waiting on
     @jwildfire* — from `session-init`.
   - **Mid-session additions** (`## Todo`), unchecked first; carry-over items
     from earlier files labeled with their date.
   - **Notes** (`## Notes`) as a short trailing section — context, not
     checkboxes. A note that clearly refers to a specific item renders with that
     item instead.

   If the scratchpad has no `## Overview` yet, render what exists and point to
   `session-init` to seed the priorities; if there is no scratchpad at all,
   say so and point to `session-init` / `session-update`.

Render-only otherwise: this skill never adds items (that is `session-update`),
never regenerates priorities (that is `session-init`), and never gives todos
durable homes (that is [`session-wrapup`](../session-wrapup/SKILL.md)).
