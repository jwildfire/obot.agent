---
name: session-init
description: "Open a working session from the previous wrapup's hand-off: read the carried list (scratchpad Overview, latest diary loose ends, next-session memory), reconcile it with one cheap GitHub delta sweep, then present and persist a prioritized list split into agent-actionable vs @jwildfire-gated items. Use at the start of any coding session — 'session init', 'session overview', 'prioritized list of open tasks', 'what's on deck'. With --auto (hub #18, launched via obot-auto), the same init then selects the top eligible increment and proceeds as a fully autonomous dev session instead of stopping at the list. Do NOT use mid-session (session-todo re-renders the persisted list) or for closing out (that is session-wrapup)."
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

**The lean contract** (@jwildfire, 2026-07-12; superseding the sweep-first
design): the previous wrapup already persisted the priorities — in the
scratchpad's `## Overview`, the diary's hand-off sections, and the
`next-session-todo` memory. Init **trusts that hand-off and checks a delta**; it
does not re-derive the list from a full GitHub/board/diary sweep. Budgets: the
whole init lands in **~2 minutes** (2026-07-10) and a **small slice of context —
well under 10%** (2026-07-12). The full sweep survives only as the
[fallback](#fallback-full-sweep) for when the hand-off is missing or stale.

The init is done when four things are true:

1. **Hand-off read and reconciled** — the carried list has been read from the
   previous wrapup's outputs and checked against a single GitHub delta sweep;
   nothing is prioritized from memory alone, and nothing is re-derived that the
   wrapup already wrote down.
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

Sessions are named `😺🤖 {YYYY-MM-DD} {session # (only if > 1 that day)}`; the
main/lead session is **orange**, spawned siblings are **green** and tagged
`👯🤖 {date} {slug}` (@jwildfire, 2026-07-11). Ultracode/Workflow jobs are
tracked separately as `⚡️🤖 {description}` — description-based, no date
(2026-07-12). Interactive sessions set these with the built-in `/name` and
`/color` slash commands, which the model **cannot run** — remind @jwildfire to
type them if the session isn't named yet. A background session sets `name` and
`color` directly in its own `~/.claude/jobs/{id}/state.json`.

The main session also **pins itself to the top of the `claude agents` view**:
append its own job id to `~/.claude/jobs/pins.json` — the view's persistent pin
store, a plain JSON array of job ids. Manually-added entries render as pinned
and survive view restarts (verified live 2026-07-24); while editing, drop ids
that no longer have a `~/.claude/jobs/{id}` directory (inert pins from deleted
jobs). Siblings stay unpinned so the pinned group stays the lead-session lane —
`ctrl+T` in the view remains for ad-hoc pins (@jwildfire, 2026-07-23).

### 1. Read the hand-off — inline, no subagents

The carried list lives in three small places the wrapup maintains; read them
directly (they are cheap) and merge:

- **Session scratchpad(s)** — `.claude/session-notes/{YYYY-MM-DD}.md` in the
  workspace root: the most recent file's `## Overview` check-state, plus any
  unchecked `## Todo` stragglers from sessions that ended without a wrapup.
- **The latest diary entry** in [`diary/`](../../../obot.roadmap/diary/) — only
  its "Next session: loose ends" and "🙋 ToDo" sections (skip the rest; skip
  `README.md`).
- **The `next-session-todo` memory** — the agreed priorities from the last
  wrapup checkpoint.

These converge on the same list; where they disagree, the newest wins. Do not
pull the board or list issues yet — that is the delta agent's job. If all three
sources are missing or stale (no wrapup ran, or the newest hand-off is more than
~3 days old), skip to the [fallback](#fallback-full-sweep).

### 2. Delta check — one subagent

Launch a single read-only `Explore`-type subagent to reconcile the carried list
against live GitHub state — **three batched calls, no per-item drill-downs**:

```bash
gh search issues --owner jwildfire --state open --limit 100 \
  --json repository,number,title,updatedAt
gh search prs --owner jwildfire --state open --limit 100 \
  --json repository,number,title,isDraft,updatedAt
gh project item-list 1 --owner jwildfire --format json --limit 80   # board stages
```

Filter to the active repos in the parse step (`jq` is not installed — use
`python3`). Digest to return, one line per item: `repo#N — title — board stage —
draft/open — updated date`. The sweep runs **unattended** — every command is
read-only; if something would stall on a permission prompt the agent skips it,
notes the gap in its digest, and moves on.

The delta's only jobs: mark carried items that GitHub shows already
closed/merged/changed, and surface genuinely **new** items the hand-off predates.
Where the hand-off and GitHub disagree, trust GitHub. Drill into a specific item
(`gh pr view`, `gh pr checks`) only when its next step is genuinely ambiguous
from title/state/draft flag — and note that you did.

### 2.5. Ideas inbox sweep

Run [`session-inbox`](../session-inbox/SKILL.md): ingest the Siri/Reminders lane,
sweep new/updated Ideas discussions on the hub, and triage them — the batch joins
the kickoff list alongside the delta results (obot.roadmap#48, 2026-07-23). If
the sweep comes back empty this step costs two script calls and no tokens.

### 3. Prioritize

Order the reconciled items by what most advances the roadmap, weighing:

- **Unblocking value** — items that gate other work (reviews holding up merges,
  decisions holding up designs) rank high even when small.
- **Momentum** — in-flight work near done beats starting something new.
- **Staleness** — carried items that keep slipping get surfaced explicitly, not
  re-buried.
- **Session focus** — if @jwildfire supplied a focus argument, weight matching
  items up without hiding the rest.

### 4. Present the list

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

### 5. Persist the list

Write the presented list into today's session scratchpad —
`.claude/session-notes/YYYY-MM-DD.md` in the workspace root (skeleton in
[`session-update`](../session-update/SKILL.md); create the file with it if
missing) — replacing the `## Overview` section:

```markdown
## Overview
<!-- session-init YYYY-MM-DD HH:MM session #N (job {id}) -->

### Agent-actionable
- [ ] 1. {item, one line} ([#N](url), [PR #N](url))

### Waiting on @jwildfire
- [ ] 5. {ask, one line} ([PR #N](url))
```

The marker line is load-bearing: it is the **session-boundary anchor** the
[session hub](../../tools/session-hub/README.md) uses to scope agents and roadmap
activity (design #24, D4). Always include the `HH:MM`; add `session #N` on a
day's second-plus session and `(job {id})` when running as a background job.

One checkbox per numbered item, numbering and grouping kept, key links inline —
condense each item's bullets to a single self-contained line. From here the
scratchpad owns the state: [`session-todo`](../session-todo/SKILL.md) re-renders
the list and checks items off as they finish; the scratchpad heartbeat (spawn
briefing + workspace Stop hook — see `session-update`) keeps the `## Session
log` current as the session runs; a later init re-run replaces the section with
the fresh delta, preserving the check-state of items that carry over.

After persisting, mention in the closing response that the live dashboard is
available for the session:

```bash
node obot.agent/tools/session-hub/session-hub.mjs --watch --open   # from the workspace root
```

## Fallback: full sweep

Only when step 1 finds no usable hand-off (first session in a workspace, no
wrapup ran for days, scratchpad and memory both missing): run the old two-agent
sweep — launch **in parallel, in one message** a GitHub sweep agent (the three
batched calls above, digested one line per item with an agent-work vs
@jwildfire-gate call) and a hand-off sweep agent (the two most recent diary
entries' hand-off sections, recent scratchpads with unchecked items, and the
`next-session-todo` memory, digested one line per carried item with source and
links). Reconcile the two digests so nothing silently drops — where they
disagree, trust GitHub — then continue from step 3. Note in the presented list
that the fallback ran and why.

## `--auto`: the autonomous session

Design and decisions: [hub #18](https://github.com/jwildfire/obot.roadmap/issues/18)
and its [design doc](https://jwildfire.github.io/obot.roadmap/requirements/design/18_design.html)
(approved 2026-07-22). With the `--auto` flag the init opens a **fully
autonomous dev session** at autonomy level **A1**
([`scripts/autonomy-grants.json`](../../scripts/autonomy-grants.json)): same
init, then select-and-proceed instead of present-and-stop. Launched via
[`scripts/obot-auto`](../../scripts/obot-auto), which owns the fail-fast
pre-flight (halt file, goal active, obotclaw token mintable, no concurrent
autonomous session). Identity: `🦾🤖 {YYYY-MM-DD} {slug}`, color `purple`, set
in the job's own `state.json` (step 0 applies otherwise unchanged).

### Mode changes

Steps 1–5 run exactly as above — hand-off, one delta agent, prioritized list
persisted to the scratchpad. Then, instead of ending the init, **select the
increment and proceed**:

1. **Directed** — `--increment owner/repo#N` was passed: take it, still subject
   to the eligibility checks below; if it fails them, refuse and stop with
   `needs input:` explaining why.
2. **Resume** — an unchecked agent-actionable item from a previous `--auto`
   run's hand-off that is still eligible: continue it before starting anything
   new.
3. **Implementation-ready** — the highest-priority hand-off item that (a)
   belongs to an active goal in [`goals/`](../../goals/), (b) traces to a hub
   requirement whose Design is signed off, (c) has its repo work scoped, and
   (d) touches only repos its grant profile allows.
4. **Pipeline-advancement** — nothing implementation-ready: take the goal's
   next requirement stuck earliest in the lifecycle and advance the *artifact*
   (draft the requirement/design doc, publish it, end at the review gate).

**Hard skips, never selected:** anything gated on @jwildfire; anything without
a filed hub requirement (roadmap-first); anything outside the grant matrix;
release *publishing* (prep is allowed — notes draft + staged promotion PR);
ultracode launches. **One increment per run.** If selection exhausts, report
"no eligible increment" with the per-candidate reason — that is itself useful
roadmap signal — and end.

### Execution contract

- Set the in-session **`/goal`** to the selected increment's exit criteria
  (e.g. "draft PR on safety.viz implementing sv#85 with CI green, heartbeat
  close-out logged, wrapup draft written") so doneness is checked
  independently of the session's own judgment (the built-in evaluates the
  condition after each turn).
- Product work goes to **spawned siblings** (`session-spawn`, standard
  briefing); the `--auto` lead stays thin per the orchestration model. All
  conventions apply unchanged: TDD, worktrees, draft PRs as obotclaw with the
  obot PR template, heartbeat lines for every phase transition, push
  verification by `headRefOid`.
- **Merges**: standard-tier `obot-merge` only. The approval tier is **never**
  used unattended — there is no in-session approval to attest. PRs touching
  the policy-file carve-out (`merge-policy.json`, `autonomy-grants.json`,
  `goals/`, workspace hooks) are never merged unattended either.
- **Halt file**: check `{workspace}/.claude/autonomy-halt` at every phase
  boundary (init → select → execute → wrapup) and between sibling waves; if
  present, park cleanly (heartbeat line, digest of state so far,
  `needs input:`).
- **Budgets**: 4h wall-clock default, one increment; hitting a cap parks the
  increment with a digest rather than pushing on.
- **Failures** (guardrail denial, CI red after honest attempts, stall, token
  expiry): park, log, digest, `needs input:` — never silent, never
  retry-forever, never route around a denial.

### Ending

Close with the **Unattended variant** of
[`session-wrapup`](../session-wrapup/SKILL.md): mechanical standing-grant
applies only, diary as a committed *draft* file, morning digest in the
scratchpad, session state ending `needs input:`. Nothing publishes without
@jwildfire's morning review.
