---
name: session-init
description: "Open a working session by rendering the previous wrapup's hand-off immediately — first paint in under a minute — then delegating the GitHub delta, the ideas sweep, and any free-text focus recon to one background sibling that revises the list when it lands. Use at the start of any coding session — 'session init', 'session overview', 'prioritized list of open tasks', 'what's on deck'. With --auto (hub #18, launched via obot-auto), the same init then selects the top eligible increment and proceeds as a fully autonomous dev session instead of stopping at the list. Do NOT use mid-session (session-todo re-renders the persisted list) or for closing out (that is session-wrapup)."
argument-hint: "Optional: session focus — weighted at Tier 2 by the recon sibling, never investigated inline"
allowed-tools: Bash(bash obot.agent/tools/session-init/handoff.sh)
---

## Tier-0 hand-off bundle (pre-read — paint directly from this, zero tool calls)

!`bash obot.agent/tools/session-init/handoff.sh`

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
Latency is governed by the
[responsiveness contract](../../docs/session-framework.md): first paint in under
a minute, <= 2 lead round trips, everything model-bound after the paint.

The init is done when five things are true:

1. **First paint delivered** — the carried list rendered inside the bar,
   explicitly provisional, under its freshness header.
2. **Ownership clear** — every item is marked agent-actionable now or waiting on
   @jwildfire (review, sign-off, decision), carried from the hand-off's own
   grouping rather than re-derived.
3. **List persisted** — the painted list is written to the session scratchpad's
   `## Overview` section with the session marker, so
   [`session-todo`](../session-todo/SKILL.md) can re-render it on demand all
   session.
4. **Recon delegated** — one sibling carries the GitHub delta, the ideas-inbox
   sweep, and any focus argument, acked to @jwildfire by slug.
5. **Corrections relayed** — the sibling's Tier 2 digest lands as a one-line
   revision at the next turn, or as an explicit `no changes` line.

## When to Use

- First thing in a coding session, when @jwildfire asks for the kickoff prompt
  above or any variant ("session init", "session overview", "what should we work
  on", "what's open").

**Do not invoke** mid-session (use `session-todo` for the running list, or the
conversation's own context) or at the end of a session (that is
`session-wrapup`).

## Procedure

The lead's only init jobs are **read, paint, spawn, stop**. Everything
model-bound happens in the sibling.

### 1. Read the hand-off — or skip it: the command pre-injects it

**Fast path (zero tool calls):** when the invocation already carries a
`=== HANDOFF (preprocessed …) ===` block — the skill itself now pre-runs
[`tools/session-init/handoff.sh`](../../tools/session-init/handoff.sh) at load,
so **both** `/session-init` and `/s-init` inject it — the Tier-0 read is **already done. Make no tool calls
before the paint**: go straight to step 2 and paint from the injected bundle.
This is the route to hub#91's <10s first-paint bar, on both command forms.

Otherwise (the bundle is missing — e.g. inline shell execution disabled), all Tier 0
sources are read in a **single** Bash call — the same script, never a bespoke
inline chain. The whole read is ~40ms locally, so any latency here is round
trips, not I/O:

```bash
cd {workspace root} && bash obot.agent/tools/session-init/handoff.sh
```

The script is the single source of truth for the Tier-0 read, and it is
failure-tolerant by construction: every source optional, zero-match greps
harmless, always exits 0. (The 2026-08-04 acceptance run lost a full round
trip — and the SLA — to a `grep` exiting 1 inside a hand-rolled `&&` chain;
that is why there is no inline block to copy here.) It emits, `===`-delimited
with precomputed ages: the **two** newest scratchpads (both, because a wrapup
has left "see YYYY-MM-DD.md" pointers before), the latest diary hand-off
sections, the `next-session-todo` memory, and the sweep cache.

- **Session scratchpad(s)** — the newest `.claude/session-notes/*.md`: its
  `## Overview` block with check state, plus any unchecked `## Todo` stragglers
  from sessions that ended without a wrapup.
- **The latest diary entry** in [`diary/`](../../../obot.roadmap/diary/) — only
  its `## Next session: loose ends` and `## 🙋 ToDo` sections (skip the rest;
  skip `README.md`).
- **The `next-session-todo` memory** — the agreed priorities from the last
  wrapup checkpoint.
- **The session-hub sweep cache** under `.claude/session-hub/cache/`, with its
  **mtime** — the mtime feeds the freshness header, the contents feed the Tier 1
  mechanical match.

These converge on the same list; where they disagree, the newest wins. Do not
pull the board or list issues — that is the recon sibling's job. If all three
hand-off sources are missing or stale (no wrapup ran, or the newest hand-off is
more than ~3 days old), skip to the [fallback](#fallback-full-sweep).

### 2. First paint, immediately (Tier 0 + Tier 1)

The painted list is the deliverable and it must be reachable in **<= 2 lead
round trips** from invocation.

**Paint mid-turn, not end-of-turn.** Emit the painted list as visible text the
moment the hand-off is in context — on the fast path that is the **first text
of the first response, before any tool call**; on the script path it
immediately follows the one read. The persist write and the sibling spawn
(steps 3–4) come **after** the paint as tool calls in the same turn, and the
turn closes with the one-line ack — never a re-print of the list. Holding the
paint until after the persist/spawn calls cost a full visible round trip on
2026-08-04.

**Tier 0 — render the hand-off verbatim.** Reproduce the scratchpad
`## Overview` numbering, its check state, and its `Agent-actionable` /
`Waiting on @jwildfire` grouping, plus the diary loose ends and the
`next-session-todo` additions. **Do not synthesize and do not re-prioritize** —
this is a prohibition, not a preference: the wrapup already ranked this list, and
re-ranking it from a cold read is exactly the model-bound work the bar excludes.

**Freshness header** — one line above the list, **load-bearing; it may not be
dropped for tidiness**:

```
Provisional — hand-off: {scratchpad file} ({age}); delta cache: {age or "cold"}; judgment pass running in 👯🤖 {slug}
```

(use `judgment pass not yet spawned` if the paint precedes the spawn message).

**Tier 1 — mechanical reconciliation**, against the warm cache only and by
**exact `repo#N` string match, never judgment**:

- **Strike** (do not delete) carried items the cache reports closed or merged.
- **Append**, unranked, a `New since the hand-off` group — one line per item with
  the event that surfaced it.
- **Print** a one-line pending-Ideas count.

If the cache is cold or absent, say so in the freshness header and paint Tier 0
alone — **do not fetch to fill it**.

**The list is the deliverable — presenting it ends the init.** Do **not** close
with a "which item should I start?" decision prompt, and do not start on any
item: @jwildfire reads the list and directs the session from there (his call,
2026-07-09). The Decision Prompt Convention does not apply to this closing step.
If the session is still unnamed, add one clause to the closing line asking
@jwildfire to type `/name` and `/color` (see
[Housekeeping](#housekeeping--after-the-first-paint)).

### 3. Persist the list — same tool block as the spawn

Write the painted list into today's session scratchpad —
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

The marker line is load-bearing: it is the **session-boundary anchor**
`findSessionMarker()` reads in the
[session hub](../../tools/session-hub/README.md) to scope agents and roadmap
activity (design #24, D4). Always include the `HH:MM`; add `session #N` on a
day's second-plus session and `(job {id})` when running as a background job. The
timestamp is **shelled** (`$(date +%H:%M)`) — never modeled.

The `## Overview` rewrite is a **re-read-then-replace performed only by the
lead** — siblings append under `## Session log` and never replace a section
(multi-writer hazard, [hub#147](https://github.com/jwildfire/obot.roadmap/issues/147)).

One checkbox per numbered item, numbering and grouping kept, key links inline —
condense each item's bullets to a single self-contained line. From here the
scratchpad owns the state: [`session-todo`](../session-todo/SKILL.md) re-renders
the list and checks items off as they finish; the scratchpad heartbeat (spawn
briefing + workspace Stop hook — see `session-update`) keeps the `## Session
log` current as the session runs; a later init re-run replaces the section with
the fresh delta, preserving the check-state of items that carry over.

### 4. Spawn ONE recon sibling, and ack

Batched into the **same message** as step 3. One sibling carries **all three**
model-bound jobs:

1. the **GitHub delta** against the carried list,
2. the **ideas-inbox sweep** ([`session-inbox`](../session-inbox/SKILL.md),
   which no longer runs inline), and
3. any **free-text focus recon** from the command argument.

Brief it from
[`templates/delta-sweep-briefing.md`](../../templates/delta-sweep-briefing.md) —
resolve it as **`obot.agent/templates/delta-sweep-briefing.md` from the
workspace root**; the relative link does not resolve through the workspace
skill symlink, and the 2026-08-04 run concluded the template was "missing",
composed a drifted bespoke briefing, and reproduced obot.agent#57's symptom
through exactly that drift. Never compose the briefing from scratch while the
template exists. Lay it over the
[`session-spawn`](../session-spawn/SKILL.md) contract (identity, auto
permission mode, remote control, heartbeat, terminal `result:` line).

Ack in **one line** — what was delegated, the slug, where the corrections will
land, and, folded into the same line rather than a separate step, the live
dashboard command:

> Delegated delta + ideas + focus recon to 👯🤖 {slug}; corrections land in
> `.claude/session-notes/{YYYY-MM-DD}-init-delta.md` — live dashboard:
> `node obot.agent/tools/session-hub/session-hub.mjs --watch --open`

### 5. Relay corrections (Tier 2)

At the top of each subsequent turn, check
`{workspace}/.claude/session-notes/{YYYY-MM-DD}-init-delta.md`. If it holds
content not yet relayed:

- Open the reply with a short `Since the first paint: …` bulleted revision.
- Silently rewrite the scratchpad `## Overview` to match. **Never re-print the
  whole list.**
- Tolerate multiple arrivals — the delta, the inbox batch, and the focus answer
  land at different times; relay each as it appears.
- If the sibling reports nothing, say `no changes` in one line. A silently
  skipped Tier 2 must be detectable.

**Tier 2 re-ranking** is the *only* place ranking may change, and the change must
be named ("moved sv#122 up: CI went green"). Weigh:

- **Unblocking value** — items that gate other work (reviews holding up merges,
  decisions holding up designs) rank high even when small.
- **Momentum** — in-flight work near done beats starting something new.
- **Staleness** — carried items that keep slipping get surfaced explicitly, not
  re-buried.
- **Session focus** — a focus argument weights matching items up here, without
  hiding the rest. It is **never investigated inline** (contract rule); the
  sibling investigates it and the lead only relays.

### Timing ledger

At steps 2 and 5, append one JSON line per step to
`.claude/session-hub/cache/init-timings.jsonl` using **exactly** the contract
schema — non-schema keys made the 2026-08-04 acceptance line unscoreable
against the SLA it existed to prove:

```json
{"ts":"<ISO, shelled>","bookend":"init","step":"first-paint|tier2-relay","tier":0,"ms":0,"session":"<job id>"}
```

`ms` is elapsed from invocation to the step; the `=== NOW ===` stamp in the
hand-off bundle anchors the start. The ledger is local telemetry — **never
commit it**.

## Housekeeping — after the first paint

Off the critical path; do these once the list is in @jwildfire's hands.

- **Naming and colour** — sessions are `😺🤖 {YYYY-MM-DD} {session # (only if
  > 1 that day)}`; the lead is **orange**, siblings **green** and tagged
  `👯🤖 {date} {slug}`; ultracode jobs are `⚡️🤖 {description}`, no date.
  Interactive sessions set these with `/name` and `/color`, which the model
  **cannot run** — remind @jwildfire once. A background session sets `name` and
  `color` directly in its own `~/.claude/jobs/{id}/state.json`.
- **Pin the lead** — append the lead's job id to `~/.claude/jobs/pins.json` (a
  plain JSON array of job ids; manual entries render as pinned and survive view
  restarts). While editing, drop ids with no `~/.claude/jobs/{id}` directory.
  Siblings stay unpinned so the pinned group stays the lead-session lane.
- Identity for anything **attributed to obotclaw[bot]** (tokens, bot-authored
  commits/PRs) follows [`obot-identity`](../obot-identity/SKILL.md) — do not
  restate it here.

## Fallback: full sweep

Only when step 1 finds no usable hand-off (first session in a workspace, no
wrapup ran for days, scratchpad and memory both missing). The fallback is
**exempt from the latency bar, and must announce that it fired and why in the
first message** — an unannounced exemption is indistinguishable from a slow init.

Spawn **in parallel, in one message, as siblings** (not blocking subagents) a
GitHub sweep agent and a hand-off sweep agent, both briefed from
[`templates/delta-sweep-briefing.md`](../../templates/delta-sweep-briefing.md) —
the `gh` command block and its capped-limit traps live there so they exist in one
place:

- **GitHub sweep** — the batched calls from the briefing, digested one line per
  item with an agent-work vs @jwildfire-gate call.
- **Hand-off sweep** — the two most recent diary entries' hand-off sections,
  recent scratchpads with unchecked items, and the `next-session-todo` memory,
  digested one line per carried item with source and links.

The lead does **not wait**: paint whatever partial hand-off exists, or an
explicit `no usable hand-off` line, then relay both digests at Tier 2 (step 5),
reconciling them so nothing silently drops — where they disagree, trust GitHub.

## `--auto`: the autonomous session

Design and decisions: [hub #18](https://github.com/jwildfire/obot.roadmap/issues/18)
and its [design doc](https://jwildfire.github.io/obot.roadmap/requirements/design/18_design.html)
(approved 2026-07-22). With the `--auto` flag the init opens a **fully
autonomous dev session** at autonomy level **A1**
([`scripts/policy.json`](../../scripts/policy.json) → `autonomy.level`): same
init, then select-and-proceed instead of present-and-stop. Launched via
[`scripts/obot-auto`](../../scripts/obot-auto), which owns the fail-fast
pre-flight (halt file, goal active, obotclaw token mintable, no concurrent
autonomous session). Identity: `🦾🤖 {YYYY-MM-DD} {slug}`, color `purple`, set
in the job's own `state.json` (see
[Housekeeping](#housekeeping--after-the-first-paint), otherwise unchanged).

### Mode changes

The paint and persist steps run exactly as above — batched hand-off read, first
paint under its freshness header, list persisted to the scratchpad, one recon
sibling spawned. Then, **asymmetrically** (hub#91 §7): unlike an interactive
session, which presents at Tier 1 and lets Tier 2 revise, the `--auto` lead
**waits for the recon sibling's Tier 2 digest before selecting an increment** —
eligibility (closed? merged? already in flight? signed off?) needs judgment the
mechanical tier cannot supply, and selecting on a stale list burns a whole run.
The list still **paints first**; the wait is a **declared exemption from the
reply SLA** and is logged as a heartbeat line
(`- $(date +%H:%M) 🦾🤖 lead — waiting on Tier 2 digest before selection`). Once
the digest lands, resolve the goal and **select the increment and proceed**.

**Goal resolution** (hub #53/#71 + v2, supersedes #18 O2): look the `--goal`
slug up in [`goals/registry.json`](../../goals/registry.json) — it must exist
with `status: active`; the entry gives the hub goal issue number,
`grant_profile`, and the repo-level `backlog` feeds. Fetch the goal issue
live: the body prose is the goal's boundaries and weights — binding context
for selection — and **membership is the sub-issue links, generated at read
time** (GraphQL `subIssues`; a newly linked sub-issue is automatically a
member, requirement-wrapped or not). **Priority among members is this
session's judgment call**, made at selection time from the boundary prose, the
#18 eligibility criteria, stages, and labels — sub-issue list order carries no
priority semantics (@jwildfire, #53 v2; priority labels may come later).
Registry `backlog` repos are the secondary feed after the goal's members.

Selection order:

1. **Directed** — `--increment owner/repo#N` was passed: take it, still subject
   to the eligibility checks below; if it fails them, refuse and stop with
   `needs input:` explaining why.
2. **Resume** — an unchecked agent-actionable item from a previous `--auto`
   run's hand-off that is still eligible: continue it before starting anything
   new.
3. **Implementation-ready** — the highest-priority hand-off item that (a)
   belongs to an active goal in
   [`goals/registry.json`](../../goals/registry.json), (b) traces to a hub
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
- **Merges**: standard-lane `obot-merge` only — that is the **integration**
  branch of a repo whose [`scripts/policy.json`](../../scripts/policy.json)
  profile is **`auto`**. The *attested* lane is **never** used unattended —
  there is no in-session approval to attest — which means a `protected`-profile
  repo is entirely off-limits to an unattended session (no branch, no draft PR,
  no merge, issues read-only). PRs touching the carve-out (`scripts/policy.json`,
  `goals/`, workspace hooks and settings) are never merged unattended either.
  `scripts/obot-policy explain <owner/repo>` is the authority on what a repo
  permits; cite it verbatim when refusing.
- **Goal issues are read-only for autonomous sessions**: never edit a goal
  issue's body or sub-issue links — membership feeds selection eligibility, so
  a session must not widen the goal it is selecting from. Propose membership
  or boundary changes as a comment on the goal issue for @jwildfire to apply.
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
