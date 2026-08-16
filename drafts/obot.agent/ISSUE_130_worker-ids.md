<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/130 on 2026-08-16 07:06 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: jwildfire, Requirement: jwildfire/obot.roadmap#194 -->

Implements the roadmap requirement **[jwildfire/obot.roadmap#194](https://github.com/jwildfire/obot.roadmap/issues/194)** — *every worker agent gets a permanent W0001 identity, allocated once and never recycled* — which carries the business case, the measurements, and the four design calls (I1–I4). This issue is the obot.agent-side build only.

Prerequisite for [jwildfire/obot.roadmap#184](https://github.com/jwildfire/obot.roadmap/issues/184) (the worker closeout check): that requirement's design concluded the only sound way to attribute a GitHub write to an agent is a stamp applied at write time, which is impossible until each worker knows what to stamp.

## The problem, in this repo's terms

Every agent write is authored by `obotclaw[bot]`, and a worker's only handle is its display name — `👯🤖 {date} {slug}` — which is typed freehand at spawn, recorded nowhere beforehand, and checked by nothing. Of the 51 sibling jobs on this machine, **none carries an identifier**, and 26 of 56 terminal jobs (46%) captured zero `children` in the harness ledger, so that fallback cannot stand in for one.

## What to build

**1. Generalise the ledger — `tools/lib/id_ledger.py` (new).**

`tools/lib/blockers_ledger.py` already implements exactly the right pattern (obot.agent#127/#129): allocation inside an exclusive `flock`, an append-only JSON-lines journal, ids from the journal high-water mark rather than scraped prose, an allocated-vs-present audit, and verdict-first reporting. Lift that into a scheme-parameterised module and keep `blockers_ledger.py` as a thin specialisation binding `c`/4 — its public API stays byte-identical so `tools/blocker-log`, `tools/navigator/sweep.mjs` and the 12 existing tests are untouched.

A second, subtly different journal implementation would be a worse outcome than a shared one. If generalising turns out messy, say so in the PR and generalise anyway.

**2. `tools/worker-id` (new)** — three lanes:

- `claim --slug <slug> [--task <text>] [--sub W0042]` → allocates inside the lock, appends one journal line, prints the bare id on stdout so a spawn command can capture it.
- `list` → renders the roster from the journal, joined live to `~/.claude/jobs/*/state.json` for liveness. **Rendered on demand, never stored** — a worker roster has no reason to be hand-edited, so it gets no second copy that can drift (I4; the hub decision registry's write-only `status` field is the shape being avoided).
- `--audit` → read-only, exit code is the verdict, verdict is the first line.

**3. The audit's checks** (worst first; findings exit 1):

- an id issued twice — the allocator broke;
- a hole in the sequence — unreachable under `flock` + append-only, so it means a write escaped the lock;
- two live jobs carrying the same id — a lead reused one in a name;
- **a worker that spawned with no id** — the convention is not being applied;
- an id claimed but never launched — a *note*, not a finding. Burned ids are correct, not losses.

The fourth check is the one that matters most. It is the guard against this issue's own failure mode: the tool ships, the skill is updated, everything reports success, and no worker ever actually gets an id. Only a check against the harness's own records can tell adoption from the appearance of it.

**4. Wire `--audit` into the Navigator sweep** (`tools/navigator/sweep.mjs`), beside the existing config-ledger reading, shelled rather than reimplemented in JS for the same reason that one is. Reported even when clean — a detector that only ever speaks up on failure is indistinguishable from a dead one. **Verify it fires on the live launchd sweep**, not merely that the code path exists.

**5. The conventions** — `skills/session-spawn/SKILL.md`, `templates/sibling-briefing.md`, `scripts/obot-auto`:

- Name shape `👯🤖 W0042 2026-08-16 workerids`: id first so it survives truncation in a narrow `claude agents` row, date kept because an id makes a name unique but not readable (I1).
- Claim before spawn, and export the id into the sibling's environment so its own writes are stamped without it having to remember.
- The id appears in scratchpad `## Session log` lines, commit trailers and PR bodies. `tools/scratchpad-log` already takes an arbitrary tag, so that path needs no code change.
- Subagents take the parent's id with a `.n` suffix (`W0042.1`), and the skill states plainly what degrades for them (I2).

## Tests

TDD, extending the existing `node --test` suite (248 passing on `main`). Non-negotiable coverage:

- **concurrent claims** — the closest two real sibling spawns were 2.4 seconds apart, and the unlocked allocator this pattern replaces lost entries at exactly that (24 concurrent captures left 20, then 5, then 22, one run with a duplicate id);
- **a dead worker keeps its number** — an id freed by death is an id that lies about history;
- **prose never burns an id** — the `c0010`/`c0011` phantom, in the new scheme;
- **sub-ids do not advance the top-level counter**;
- **the verdict is the first line, even when there is a note** — obot.agent#129's regression;
- **an unstamped worker is a finding**, and one from before the convention epoch is not.

Add the new test directory to `.github/workflows/test.yml`.

## Out of scope

The `PostToolUse` write-time mutation hook and the `## By agent` Navigator tab belong to [obot.roadmap#184](https://github.com/jwildfire/obot.roadmap/issues/184). The hook touches `hooks/`, a guardrail path on this repo, so it needs @jwildfire's attestation to merge; keeping it out keeps this work on the standard lane and keeps the requirement to one release.

Forward-only, no backfill (I3): three of last night's workers left no machine-recoverable trace at all, so a retroactive pass could never be complete, and a partial one rendered as clean rows would assert a completeness it does not have.

---

This Issue was drafted by Claude Code using Opus 5 in an unattended sibling session (👯🤖 workerids) and reviewed by @jwildfire
