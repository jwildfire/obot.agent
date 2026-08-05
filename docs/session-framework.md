# The session framework: responsiveness contract

The lead session is a **router, not a worker**. Its job at a bookend, and in every chat
reply, is to read the carried record, present it, and spawn — the actual work happens in
siblings. Anything the lead does inline that a sibling could do is latency @jwildfire pays
for at the keyboard. This document is the single canonical statement of that contract;
every other file in this repo links here in one line rather than restating it.

## The SLAs

- [`session-init`](../skills/session-init/SKILL.md) — the first rendered priority list is in
  @jwildfire's hands in **< 1 minute**.
- [`session-wrapup`](../skills/session-wrapup/SKILL.md) — the checkpoint draft is in front of
  him in **< 1 minute**.
- **Any chat message** — a substantive reply in **< 30 seconds** whenever possible.
- Work that would exceed **~30 seconds of lead time is delegated, never absorbed**.

Source: @jwildfire, live mandate 2026-08-01 — "obot is here to help me multitask." Tasks
may take a long time; the lead may not.

## The round-trip budget

Wall-clock is the symptom; **sequential model round trips are the cause**. The budget:

- **<= 2 sequential lead round trips** from command invocation to first visible output.
- The whole network surface of init is **~4s cold / ~2ms warm** (the session-hub sweep
  cache), so ~99% of a 7-minute init was model round trips, not API latency.
- The 2026-08-01 blocking init delta agent cost **4m03s / 19 tool calls** and produced
  **zero** corrections to the hand-off list — the clearest available evidence that
  render-first-from-the-hand-off is both faster and safe.

Optimize round trips, not tool calls: batch reads into one block, chain shell steps with
`&&`, and put the ack and the spawn in the same message.

## Ack -> delegate -> report

The 30-second rule as a procedure:

1. **Ack in one line** — name exactly what is being delegated and to which
   `👯🤖 {slug}`.
2. **Spawn** per [`session-spawn`](../skills/session-spawn/SKILL.md), briefed from
   [`templates/sibling-briefing.md`](../templates/sibling-briefing.md).
3. **Return to @jwildfire immediately.** Never end a turn with the lead blocked on a
   sibling.
4. **Relay the result at the top of the next turn**, as a short revision.

There is no lane for pushing into a live session, so **the lead relays at its own next turn
boundary**: at the start of each reply, if a corrections file it is expecting exists and
holds unrelayed content, lead with a one-line `Since the first paint: …` /
`Since the draft: …` revision, then answer whatever @jwildfire actually asked.

## First paint

**Time-to-first-paint is the clock that stops the SLA** — not time-to-final-answer
(hub#91 D1).

- The first paint **may be provisional, and must say so**.
- The clock stops at first paint, not at the last revision.
- Every first paint carries a **freshness header**: the hand-off source and its age, the
  delta-cache age, and which sibling is carrying the judgment pass.
- The freshness header is **load-bearing and may not be dropped for tidiness** — it is what
  makes a provisional paint honest.

## The three tiers

Generic to both bookends:

- **Tier 0 — the carried record, verbatim.** No synthesis, no re-prioritization: the
  previous wrapup already ranked it.
- **Tier 1 — mechanical reconciliation only.** Exact `repo#N` string matching against the
  warm sweep cache, never judgment: strike items the cache reports closed or merged, append
  unranked `New since the hand-off` items with their event, print a pending-Ideas count.
- **Tier 2 — everything model-bound.** Delta digest, ideas triage, hygiene, re-ranking,
  free-text recon. It runs **in the sibling, after the first paint**, as a non-blocking
  revision. Tier 2 must announce **`no changes` in exactly one line** when it finds
  nothing, so a silently-skipped Tier 2 is detectable.

## The revision protocol

Tier 2 surfaces (hub#91 D5) as:

- a short **`since the first paint`** message — one line per arrival, and
- a **silent rewrite** of the scratchpad `## Overview`.

Never a full re-print of the list. The mechanism tolerates **multiple arrivals** — the
delta, the ideas inbox, and a free-text answer can land at different times; each is one
line. The Overview rewrite is **re-read-then-replace, and only the lead does it**.

## Free-text arguments are never executed inline

(hub#91 D8, promoted here as a general session-command rule.)

- Every session command takes an `argument-hint`.
- A free-text argument is **context for the sibling's briefing**, never a licence for the
  lead to investigate inline.
- This applies to all of them: init focus, wrapup focus, reviews scope.

## Lists over prose

- Bulleted lists in **all** agent output — diary sections, drafts, chat, sibling
  report-backs — unless @jwildfire asks for a technical deep dive (his preference,
  2026-07-31).
- A sibling that reports in prose forces the lead to re-render it, which costs a round trip.

## Multi-writer safety

- Siblings are **append-only** under the scratchpad `## Session log`, **inserted under the
  heading** — never a blind end-of-file append. The exact command lives in
  [`templates/sibling-briefing.md`](../templates/sibling-briefing.md).
- Only the **lead** performs section-replacing writes (`## Overview`), and only after
  re-reading the file.
- Any deferred or backgrounded write lane introduced by a faster bookend **must not widen
  the lost-write window** (hub#147 hazards 1-2).
- Timestamps in every appended line are **shelled** — `$(date +%H:%M)` — never modeled
  (obot.agent#57).

## The timing ledger

(hub#91 §9.) Every bookend run appends one JSON line per step to
`{workspace}/.claude/session-hub/cache/init-timings.jsonl` — created on first write,
appended, **never committed**:

```json
{"ts":"<ISO>","bookend":"init|wrapup","step":"<slug>","tier":0,"ms":0,"session":"<job id or slug>"}
```

Shell the timestamps. The SLA is a **checkable fact, not a vibe**.

## Exemptions — announce them

Three, and each must say out loud that it fired:

- **init's [fallback full sweep](../skills/session-init/SKILL.md#fallback-full-sweep)** —
  when no usable hand-off exists.
- **an `--auto` session waiting for Tier 2 before *selecting* an increment** — eligibility
  needs judgment the mechanical tier cannot supply (hub#91 §7, the asymmetric rule). The
  list still paints first.
- **[`session-reviews --here`](../skills/session-reviews/SKILL.md)** — @jwildfire explicitly
  asked for that walkthrough to run inline.

Out of scope and unchanged: claude CLI process boot, MCP server startup, machine-level
factors.

## Budgets that still hold

- obot.agent#29 lean bookends: the whole init **through Tier 2 under ~2 minutes**, and
  **under ~10% of context** at each bookend.
- Speed may **not** be bought by regressing these.
- None of the wrapup's five done-conditions may be traded for speed (hub#148 assumption 2).

## Provenance

- **SLAs** — @jwildfire's live mandate, 2026-08-01.
- **Design decisions D1-D7** (and **D8**, promoted here from the 2026-07-31
  orchestrator-responsiveness comment) come from
  [hub#91](https://github.com/jwildfire/obot.roadmap/issues/91) and its design doc, whose
  formal sign-off is still pending — they are **adopted pending formal sign-off**, on the
  strength of the live mandate.
- **Closing-bookend decisions** — [hub#148](https://github.com/jwildfire/obot.roadmap/issues/148).
- **Heartbeat / timestamp / report-back corrections** —
  [obot.agent#57](https://github.com/jwildfire/obot.agent/issues/57).
- hub#91's design bar for init first paint is **`<10 seconds`** — stricter than the
  1-minute SLA, and therefore satisfying it. The stricter number stands; it is not loosened
  here.
