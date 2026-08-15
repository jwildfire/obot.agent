---
name: session-scaffold
description: "Capture a continuous-improvement candidate (skill gap, convention drift, config friction, tooling idea) to the scratchpad's ## Scaffold list the moment the friction happens — a sub-10-second one-shot capture. Use when @jwildfire says 'scaffold: …', 'add that to the scaffold list', or the agent hits friction a scaffold change would fix. Do NOT use for tasks (that is session-update), diary color (that is session-note), durable facts (that is memory), or a product idea for the roadmap (that is session-idea)."
argument-hint: "The scaffold candidate"
---

# Session Scaffold

Capture scaffold candidates **when the friction happens**, not from end-of-session
recall. The [`session-wrapup`](../session-wrapup/SKILL.md) scaffold review (step 6)
then sweeps a real list instead of reconstructing one; the
[session hub](../../tools/session-hub/README.md) shows the list all session on its
**Scaffold improvements** panel. Entries go to the same **session scratchpad** used
by [`session-update`](../session-update/SKILL.md) (see that skill for the file's
location and skeleton): `.claude/session-notes/YYYY-MM-DD.md` in the workspace
root, `## Scaffold` section.

## When to Use

- @jwildfire says "scaffold: …", "add that to the scaffold list", "we should teach
  the skill that".
- The agent hits friction a scaffold change would fix: a skill gave stale or wrong
  guidance, a convention changed in-session, a permission prompt keeps repeating,
  a pattern was executed by hand for the second time.

**Do not use** for actionable project tasks (`session-update`), for observations
worth the diary (`session-note`), for durable facts and preferences (memory —
though a scaffold entry often *becomes* a memory or skill update at wrapup), or
for product ideas about what the program should build
([`session-idea`](../session-idea/SKILL.md) — scaffold is about how we work, ideas
are about what we make).

## Procedure

1. **Write the candidate in one idempotent shell call** — skeleton if the file is
   missing, heading-anchored insert under `## Scaffold`, shelled timestamp:

   ```bash
   WS=~/Documents/obot2
   LOG="$WS/.claude/session-notes/$(date +%F).md"
   LINE="- [ ] {candidate} — {where the friction hit, one clause} $(date '+*(added %H:%M)*')"
   python3 - "$LOG" "$LINE" <<'PY'
   import sys, pathlib
   p, line = pathlib.Path(sys.argv[1]), sys.argv[2]
   if not p.exists():
       p.parent.mkdir(parents=True, exist_ok=True)
       p.write_text(f"# Session scratchpad — {p.stem}\n\n## Overview\n\n## Todo\n\n## Notes\n\n## Scaffold\n\n## Session log\n")
   lines = p.read_text().splitlines()
   if "## Scaffold" not in lines:
       lines += ["", "## Scaffold"]
   i = lines.index("## Scaffold") + 1
   j = i
   while j < len(lines) and not lines[j].startswith("## "):
       j += 1
   while j > i and not lines[j-1].strip():
       j -= 1
   lines.insert(j, line)
   p.write_text("\n".join(lines) + "\n")
   PY
   ```

   One line, self-contained, cold-readable at wrapup: what to change and why,
   with the target named (a skill, AGENTS.md, workspace config, memory).
2. **Confirm** by echoing back **only the line written**, then return to the work
   in flight. Capturing a candidate is a **sub-10-second operation** that must
   never derail the work in flight (see
   [`docs/session-framework.md`](../../docs/session-framework.md)) — and it is not
   a license to apply the change mid-session.

## Lifecycle

`session-wrapup` step 6 sweeps this list as its scaffold-review input, proposes
the survivors at the checkpoint, applies what is approved (or falls under standing
grants), and checks entries off — never deletes them. Unchecked entries carry to
the next session via `session-init`.
