---
name: session-scaffold
description: "Capture a continuous-improvement candidate (skill gap, convention drift, config friction, tooling idea) to the scratchpad's ## Scaffold list the moment the friction happens. Use when @jwildfire says 'scaffold: …', 'add that to the scaffold list', or the agent hits friction a scaffold change would fix. Do NOT use for tasks (that is session-update), diary color (that is session-note), or durable facts (that is memory)."
argument-hint: "The scaffold candidate"
---

# Session Scaffold

Capture scaffold candidates **when the friction happens**, not from end-of-session
recall. The [`session-wrapup`](../session-wrapup/SKILL.md) scaffold review (step 3)
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
worth the diary (`session-note`), or for durable facts and preferences (memory —
though a scaffold entry often *becomes* a memory or skill update at wrapup).

## Procedure

1. **Resolve today's scratchpad** — `.claude/session-notes/YYYY-MM-DD.md` under
   the workspace root; create it with the skeleton from `session-update` if
   missing (the skeleton includes the `## Scaffold` section).
2. **Append the candidate** under `## Scaffold`:

   ```markdown
   - [ ] {candidate} — {where the friction hit, one clause} *(added HH:MM)*
   ```

   One line, self-contained, cold-readable at wrapup: what to change and why,
   with the target named (a skill, AGENTS.md, workspace config, memory).
3. **Confirm** the entry as written, then return to the work in flight — capturing
   a candidate is not a license to apply it mid-session.

## Lifecycle

`session-wrapup` step 3 sweeps this list as its scaffold-review input, proposes
the survivors at the checkpoint, applies what is approved (or falls under standing
grants), and checks entries off — never deletes them. Unchecked entries carry to
the next session via `session-init`.
