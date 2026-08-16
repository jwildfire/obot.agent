<!-- STATUS: Posted to https://github.com/jwildfire/obot.roadmap/issues/194 on 2026-08-16 06:58 EDT -->
<!-- GITHUB_PROPERTIES: Labels: requirement, Milestone: 2026q3, Assignee: @me, Goal: #73 (sub-issue), Related: #184 -->

### Business Requirement

@jwildfire asked for it in one line on 2026-08-16: *"I also want each worker to get a unique ID moving forward W000x"*.

He asked because he cannot tell which agent did what. Every issue, pull request, comment and commit an agent writes is authored by the same GitHub identity — `obotclaw[bot]` — and GitHub has no field that separates one agent from another. The volume is no longer small: **33 sibling workers started in the last 24 hours, six of them running at once at the peak**. When he asks "what did that worker actually do", there is nothing to ask the question of.

What stands in for an identity today is the worker's display name, `👯🤖 {date} {slug}`. It is not an identifier and cannot become one. The slug is typed freehand by whichever lead spawns the worker, it is recorded nowhere before the spawn, nothing checks it, and nothing joins a write back to it. Across all 51 sibling jobs on this machine no two slugs have collided — but that is luck, not construction, and **none of the 51 carries any identifier at all**.

Success looks like: every worker has a permanent number that it, its writes, and its record all carry; the number is allocated once and never handed out twice even when two workers spawn seconds apart; and a worker that died still has its number, because a worker that produced nothing is exactly the case he needs to be able to see.

This is the identity primitive that the worker closeout check (#184) needs and does not have. That requirement's design evaluated four ways to attribute a write to an agent and found the only sound one is a stamp applied **at write time** — which is impossible until each worker knows what to stamp. This requirement supplies that; #184 consumes it.

### Overview

Allocate every worker agent a permanent `W0001`-style identifier at spawn time, carried in the worker's own name so it propagates everywhere the name already goes, and back it with the same append-only journal that makes the config list trustworthy.

Three pieces, all in `obot.agent`:

- **Allocation** — a `tools/worker-id` tool that claims the next free id inside an exclusive `flock` and appends one JSON line to `.claude/workers.journal`. Ids come from the journal's high-water mark, never from scraped text, and are never recycled.
- **The name** — the spawn convention becomes `👯🤖 W0042 2026-08-16 workerids`. The id then rides through `claude agents`, `ListAgents`, `SendMessage` addressing, the harness job records, scratchpad heartbeat lines, commit trailers and PR bodies with no new plumbing on any of those paths.
- **The audit** — a read-only `--audit` whose exit code is the verdict, wired into the Navigator's existing 5-minute sweep beside the config-ledger reading. Its most important check is not that the journal is intact but that the convention is actually being *used*: a worker that spawned without an id is a finding.

The pattern is not new here and is deliberately not reinvented. `tools/lib/blockers_ledger.py` already implements locked allocation, an append-only journal, high-water ids and an allocated-vs-present audit for config-item ids (`c0001`), shipped in obot.agent#127/#129. That module gets generalised into a shared `tools/lib/id_ledger.py` parameterised by id scheme, with the blockers module kept as a thin specialisation so its existing behaviour and tests are unchanged. A second, subtly different journal implementation would be a worse outcome than a shared one.

Affects: `obot.agent` only — the ledger library, a new tool, the Navigator sweep, and the spawn conventions (`skills/session-spawn`, `templates/sibling-briefing.md`, `scripts/obot-auto`). No hub or dashboard change; the Navigator tab that reads this data is #184's.

### Data Requirement

**Data source / system:**

- `.claude/workers.journal` — new, created by this requirement. One JSON line per mutation, append-only, written under an exclusive `flock`. Workspace-local operational state, alongside `.claude/blockers.journal`.
- `~/.claude/jobs/*/state.json` — the harness job ledger, the independent reality the audit checks the journal against. Confirmed present: 59 records, 51 of them sibling-tagged, each carrying `name`, `state` (`done` / `stopped` / `working`), `startedAt` and `firstTerminalAt`.
- The spawn lanes that must claim an id: `skills/session-spawn` (siblings) and `scripts/obot-auto` (the autonomous 🦾🤖 lead).

**Availability status:** Confirmed for the job records; the journal is created by this requirement.

**Not required:** GitHub. Nothing here reads or writes GitHub, and the audit makes no network call — which is what keeps it inside the Navigator sweep's zero-token, five-minute budget.

### Design

Four calls (I1–I4). Each is a recommendation with its cost stated; none is blocking.

**I1 — the name shape: `👯🤖 W0042 2026-08-16 workerids`.**

The id goes immediately after the emoji tag, before the date. Two reasons, and they point the same way. It is the field that must survive truncation in a narrow `claude agents` row or a log line, so it goes where truncation cannot reach it. And because the counter is monotonic, sorting by id sorts chronologically anyway — putting the date first would buy nothing that the id does not already give.

The date stays, at a cost of eleven characters in a name with no hard limit. An id makes a name *unique*; it does not make it *readable*. `W0042` carries no recency, and last week's workers sit in the same `claude agents` list as tonight's — the date is the only field that answers "is this from tonight" without a lookup, and he triages that list on a phone.

Addressing by a short prefix is preserved: `W0042` is unambiguous across every worker that will ever exist, which is strictly better than today's slug.

**I2 — subagents get the parent's id with a `.n` suffix (`W0042.1`), not an id of their own.**

He said "each worker", and in-process subagents are workers by that reading — but they are not sessions. They have no row in `~/.claude/jobs/`, so an independent top-level id could never be joined back to anything and would look permanently unlaunched to the audit. The `.n` form is already house style for exactly this belongs-to-but-distinguishable relationship (the hub's `D0001.n` decision sub-ids), and it agrees with the rule #184 already settled: a subagent's output belongs to its parent worker's closeout, because the parent is what gets checked.

**What degrades for subagents, stated plainly rather than discovered later:**

- **No harness job row.** No independent start or terminal timestamp, so nothing can detect a subagent going terminal, and the audit's unstamped-worker check cannot see subagents at all. The parent's closeout is the only coverage.
- **The name does not carry it.** `Agent` takes a `description`, not a `-n` name, and `ListAgents` shows the agent type — so unlike the sibling lane, where the id rides the name for free, a sub-id must be written into the subagent's prompt and the subagent must be *told* to stamp it. That is an instruction, not a mechanism, and instructions are followed less reliably than mechanisms.
- **Allocation is voluntary.** Nothing forces a lead to claim a sub-id before calling `Agent`. A subagent that writes without one is attributed to the bare parent id — lossy, but never *wrong*: the parent is accountable either way.

Measured context for the cost being accepted: #184 found **zero Task calls across all 134 transcripts** in this workspace, because the delegation rule (D0013) sends anything that leaves an artifact behind to a sibling and reserves subagents for answer-only research. The degraded lane is the one that is barely used, and the mechanical lane is the one that carries the deliverables.

**I3 — forward-only, with no backfill.**

He said "moving forward" and that is also the right call on the evidence. A retroactive pass could never be complete: #184 measured that **7 of 41 terminal jobs left no machine-recoverable trace at all**, and once throwaway probes and prime itself are set aside, three of those were real workers whose contribution cannot be reconstructed from anything that still exists. A partial backfill rendered as clean rows would assert a completeness it does not have — the same failure class as an evidence baseline going stale while CI stays green.

The cost of forward-only is that the by-agent ledger starts empty and last night's 33 workers are never in it. That is accepted. If a backfill is ever wanted it must be labelled incomplete on its face, and it is a separate piece of work, not a quiet part of this one.

The convention epoch is recorded, not assumed: the journal's seed record stamps the moment the ledger was adopted, and the audit only judges workers that started after it. A worker from before the epoch is out of scope by record rather than by silence.

**I4 — the journal is the only source of truth; the roster is rendered, never stored.**

This is where the design deliberately departs from the two ledgers already in the house. The config list keeps `blockers.md` as a hand-editable primary with the journal as its shadow, which is right there — @jwildfire reads and ticks off that file. The hub's decision registry keeps a `status` field that is written and never read, while the Index row is the real authority: two sources, one decorative, silently diverging.

A worker roster has no reason to be hand-edited, so it gets no stored copy at all. `worker-id list` renders the roster from the journal on demand, joined live to the harness job records for liveness. There is nothing to drift.

**What the audit checks, worst first. Exit code is the verdict — 0 agree, 1 a finding — and the verdict is the first line of output**, because the Navigator summarises by first line and a note printed first displaced the verdict on nearly every sweep last time (obot.agent#129).

| Check | Verdict | Why |
|---|---|---|
| An id issued twice | finding, exit 1 | The allocator broke. This is the one that must never happen. |
| A hole in the sequence | finding, exit 1 | Under `flock` + append-only this is unreachable, so it means a write escaped the lock or the journal was edited. |
| Two live jobs carrying the same id | finding, exit 1 | A lead reused an id in a name. The journal is intact but reality disagrees with it. |
| A worker that spawned with no id | finding, exit 1 | The convention is not being applied. |
| An id claimed but never launched | note | A spawn that failed after the claim. The id is burned, which is correct, and burned ids are not losses. |

The fourth check is the one that earns its place. It is the guard against this requirement's specific failure mode: the tool ships, the skill is updated, everything reports success, and no worker ever actually gets an id. Only a check against the harness's own records — reality, not self-report — can tell adoption from the appearance of it.

**Collision-safety is a measured requirement, not a precaution.** The closest two sibling spawns on this machine were **2.4 seconds apart**, and 9 spawn pairs landed inside 60 seconds of each other. The unlocked read-modify-write in the config list failed at exactly this: 24 concurrent captures left 20, then 5, then 22 entries across three measured runs, one with a duplicated id (obot.agent#126). Allocation therefore happens inside the same exclusive `flock` the fix already proved, and the concurrency test is part of the deliverable.

**Ids are burned, never recycled.** Two workers died on the night of 2026-08-15 — one went `blocked`, one stalled three hours and was stopped. Their ids stay allocated. The whole purpose is being able to ask what each worker did, *including the ones that did nothing*, and an id freed by death is an id that lies about history. The high-water mark comes from the journal and only ever grows; nothing in the tool deletes or restores a record.

**Out of scope, and why.** The `PostToolUse` write-time mutation hook that #184's design recommends — one line per GitHub write, `{timestamp, agent, verb, url}` — is not in this requirement. It belongs to #184, it needs the id this requirement creates, and it touches `hooks/`, which is a guardrail path on `obot.agent` and therefore requires @jwildfire's explicit attestation to merge. Splitting it out keeps this requirement on the standard lane and keeps it to one release, per the one-requirement-one-release rule.

The Navigator tab that renders the result is also #184's, and needs no new rendering code: the tab renders any `## Heading` in `navigator-state.md` generically, so a `## By agent` section becomes visible as soon as the data exists.

### Tasks

- jwildfire/obot.agent — the ledger generalisation, the `worker-id` tool, the sweep wiring, and the spawn conventions.

---

This Issue was drafted by Claude Code using Opus 5 in an unattended sibling session (👯🤖 workerids) and reviewed by @jwildfire
