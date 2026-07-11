---
name: session-init
description: "Open a working session: sweep the evidence via subagents (requirement issues, open PRs, the project board, recent diaries, scratchpad, memory), then present and persist a prioritized list split into agent-actionable vs @jwildfire-gated items. Use at the start of any coding session — 'session init', 'session overview', 'prioritized list of open tasks', 'what's on deck'. Do NOT use mid-session (session-todo re-renders the persisted list) or for closing out (that is session-wrapup)."
argument-hint: "Optional: session focus to weight the priorities toward"
---

# Session Init

Open a working session with a shared picture of what matters. The opening bookend
to [`session-wrapup`](../session-wrapup/SKILL.md): wrapup writes the state down at
the end of a session; init reads it back and turns it into priorities at the
start of the next. Formerly named `session-overview`. The canonical trigger is
@jwildfire's standing kickoff prompt:

> give me a prioritized list of open tasks from obot.roadmap. review the
> requirement issues, open PRs and the last few session summaries to inform the
> list. format as a numbered list with short bullets with links to relevant
> roadmap items, issues and prs.

The init is done when four things are true:

1. **Evidence swept** — open issues, open PRs, the project board, and the recent
   diary entries have all been read; nothing is prioritized from memory alone.
2. **Priorities presented** — a single numbered list, ordered by importance, each
   item with short bullets and links to the roadmap items, issues, and PRs it
   draws on.
3. **Ownership clear** — every item is marked as agent-actionable now or gated on
   @jwildfire (review, sign-off, decision), so the session can start on the right
   work immediately.
4. **List persisted** — the presented list is written to the session scratchpad's
   `## Overview` section, so [`session-todo`](../session-todo/SKILL.md) can
   re-render it on demand all session.

## When to Use

- First thing in a coding session, when @jwildfire asks for the kickoff prompt
  above or any variant ("session init", "session overview", "what should we work
  on", "what's open").

**Do not invoke** mid-session (use `session-todo` for the running list, or the
conversation's own context) or at the end of a session (that is
`session-wrapup`).

## Procedure

### 0. Session identity reminder

Sessions are named by convention: `😺🤖 {YYYY-MM-DD} {session # (only if > 1 that day)}`
(template per Jeremy 2026-07-11; applies to spawned siblings too, numbered in day order).
Colors: **orange** for the main/lead session, **green** for spawned siblings
(per Jeremy 2026-07-11). In an interactive session these are the built-in slash commands
`/name 😺🤖 YYYY-MM-DD` and `/color orange`, which the model **cannot
run** — remind @jwildfire to type them if the session isn't named yet. A
background session can set `name` and `color` directly in its own
`~/.claude/jobs/{id}/state.json`.

### 1. Sweep the evidence — in subagents, not inline

The sweep reads far more than the session ever needs again (issue lists, board
JSON, whole diary entries): run it in **parallel subagents** and keep only their
digests in the conversation — do not paste raw listings. Launch both in a single
message; read-only `Explore`-type agents suffice. Do not prioritize from recall
alone: everything below must come back from the sweep.

**Latency budget: the whole init should land in ~2 minutes** (@jwildfire,
2026-07-10 — the first run took ~5 and that was too slow). Two rules keep it
fast: the sweep runs **unattended** — kickoff sessions launch in auto mode, every
command here is read-only, and if something would stall on a permission prompt
the agent skips it, notes the gap in its digest, and moves on; and the GitHub
pull is **batched, not per-repo/per-item** — three calls total, no drill-downs.

- **GitHub sweep agent** — open issues and PRs across the active repos, plus the
  project board, in **three batched calls** (not a per-repo loop):

  ```bash
  gh search issues --owner jwildfire --state open --limit 100 \
    --json repository,number,title,updatedAt
  gh search prs --owner jwildfire --state open --limit 100 \
    --json repository,number,title,isDraft,updatedAt
  gh project item-list 1 --owner jwildfire --format json --limit 80   # board stages
  ```

  Filter to the active repos (obot.roadmap, safety.viz, gsm.safety,
  safety-histogram, obot.agent) in the parse step (`jq` is not installed —
  use `python3`). Do **not** run `gh pr view` / `gh pr checks` per item — list
  fields plus board stage are enough to prioritize; drill into a specific PR
  only when its next step is genuinely ambiguous from title/state/draft flag.
  Digest to return, one line per item: `repo#N — title — board stage —
  draft/open — whether the next step is agent work or an @jwildfire gate`.

- **Hand-off sweep agent** — what previous sessions left behind: the **two most
  recent** entries in [`diary/`](../../../obot.roadmap/diary/) (skip `README.md`; their
  "Next session: loose ends" and "🙋 ToDo" sections are the wrapup's hand-off to
  this skill), any `.claude/session-notes/*.md` scratchpads with unchecked
  items, and the `next-session-todo` memory. Digest to return: every still-open
  carried item, one line each with source and links.

Reconcile the two digests so nothing silently drops; where they disagree (a
diary loose end that GitHub shows already closed), trust GitHub.

### 2. Prioritize

Order the swept items by what most advances the roadmap, weighing:

- **Unblocking value** — items that gate other work (reviews holding up merges,
  decisions holding up designs) rank high even when small.
- **Momentum** — in-flight work near done beats starting something new.
- **Staleness** — carried items that keep slipping get surfaced explicitly, not
  re-buried.
- **Session focus** — if @jwildfire supplied a focus argument, weight matching
  items up without hiding the rest.

### 3. Present the list

Format exactly as the kickoff prompt asks: a **numbered list** ordered by
priority, each item with **short bullets** and **links** to the relevant roadmap
items, issues, and PRs. Split it into two groups:

- **Agent-actionable** — work the agent can start now under standing grants.
- **Waiting on @jwildfire** — reviews, sign-offs, and decisions only he can make,
  each with a one-line ask and a direct link.

**The list is the deliverable — presenting it ends the init.** Do **not** close
with a "which item should I start?" decision prompt, and do not start on any
item: @jwildfire reads the list and directs the session from there (his call,
2026-07-09). The Decision Prompt Convention does not apply to this closing step.

### 4. Persist the list

Write the presented list into today's session scratchpad —
`.claude/session-notes/YYYY-MM-DD.md` in the workspace root (skeleton in
[`session-update`](../session-update/SKILL.md); create the file with it if
missing) — replacing the `## Overview` section:

```markdown
## Overview
<!-- session-init YYYY-MM-DD HH:MM -->

### Agent-actionable
- [ ] 1. {item, one line} ([#N](url), [PR #N](url))

### Waiting on @jwildfire
- [ ] 5. {ask, one line} ([PR #N](url))
```

One checkbox per numbered item, numbering and grouping kept, key links inline —
condense each item's bullets to a single self-contained line. From here the
scratchpad owns the state: [`session-todo`](../session-todo/SKILL.md) re-renders
the list and checks items off as they finish; a later init re-run replaces the
section with the fresh sweep, preserving the check-state of items that carry
over.
