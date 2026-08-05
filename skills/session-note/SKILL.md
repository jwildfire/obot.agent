---
name: session-note
description: "Capture a mid-session note for inclusion in the session-wrapup diary entry. Use when @jwildfire says 'session note: …', 'note this for the wrapup', or a decision/blocker/observation worth the diary surfaces mid-session. One-shot capture: one idempotent write, no research inline. Do NOT use for tasks (that is session-update) or durable facts/preferences (that is memory)."
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

**Do not use** for actionable tasks (`session-update`), for scaffold/tooling
improvement candidates (`session-scaffold`), for durable facts or preferences
that outlive the diary (memory), or for anything already captured on an issue
(comment there instead).

## Procedure

Capture is a **sub-10-second operation** and must never derail the work in flight
(see [`docs/session-framework.md`](../../docs/session-framework.md)).

1. **Write the note in one idempotent shell call** — skeleton if the file is
   missing, heading-anchored insert under `## Notes`, shelled timestamp:

   ```bash
   WS=~/Documents/obot2
   LOG="$WS/.claude/session-notes/$(date +%F).md"
   LINE="- $(date +%H:%M) — {note}"
   python3 - "$LOG" "$LINE" <<'PY'
   import sys, pathlib
   p, line = pathlib.Path(sys.argv[1]), sys.argv[2]
   if not p.exists():
       p.parent.mkdir(parents=True, exist_ok=True)
       p.write_text(f"# Session scratchpad — {p.stem}\n\n## Overview\n\n## Todo\n\n## Notes\n\n## Scaffold\n\n## Session log\n")
   lines = p.read_text().splitlines()
   if "## Notes" not in lines:
       lines += ["", "## Notes"]
   i = lines.index("## Notes") + 1
   j = i
   while j < len(lines) and not lines[j].startswith("## "):
       j += 1
   while j > i and not lines[j-1].strip():
       j -= 1
   lines.insert(j, line)
   p.write_text("\n".join(lines) + "\n")
   PY
   ```

   Write it diary-ready, but **bounded**: one or two sentences, self-contained,
   links inline, and **no research and no re-reading to get it right**. A note
   that needs investigation is a todo
   ([`session-update`](../session-update/SKILL.md)) or an idea
   ([`session-idea`](../session-idea/SKILL.md)), not a note.
2. **Confirm** by echoing back **only the line written** — no re-read of the
   section — then return to the work in flight.

## Lifecycle

`session-wrapup` folds Notes into the day's diary entry (they are raw material,
not verbatim copy) and marks them captured. Notes never block anything — if one
turns out to be a task, move it to `## Todo` via `session-update`.
