---
name: session-note
description: "Capture a mid-session note for inclusion in the session-wrapup diary entry. Use when @jwildfire says 'session note: …', 'note this for the wrapup', or a decision/blocker/observation worth the diary surfaces mid-session. Do NOT use for tasks (that is session-update) or durable facts/preferences (that is memory)."
argument-hint: "The note text"
---

# Session Note

Capture color while it's fresh: decisions made in passing, blockers as they were
hit, observations worth the diary — so the
[`session-wrapup`](../session-wrapup/SKILL.md) entry is written from the record,
not from end-of-day recall. Notes go to the same **session scratchpad** used by
[`session-update`](../session-update/SKILL.md) (see that skill for the file's
location and skeleton): `.claude/session-notes/YYYY-MM-DD.md` in the workspace
root, `## Notes` section.

## When to Use

- @jwildfire says "session note: …", "note that for the wrapup", "make sure the
  diary mentions…".
- A moment worth the diary happens mid-session — a decision and its why, a
  blocker and what was tried, a surprise worth remembering.

**Do not use** for actionable tasks (`session-update`), for durable facts or
preferences that outlive the diary (memory), or for anything already captured on
an issue (comment there instead).

## Procedure

1. **Resolve today's scratchpad** — `.claude/session-notes/YYYY-MM-DD.md` under
   the workspace root; create it with the skeleton from `session-update` if
   missing.
2. **Append the note** under `## Notes`:

   ```markdown
   - HH:MM — {note}
   ```

   Write it diary-ready: one or two sentences, self-contained, links inline.
3. **Confirm** the note as written, then return to the work in flight.

## Lifecycle

`session-wrapup` folds Notes into the day's diary entry (they are raw material,
not verbatim copy) and marks them captured. Notes never block anything — if one
turns out to be a task, move it to `## Todo` via `session-update`.
