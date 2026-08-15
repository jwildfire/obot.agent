<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/123 on 2026-08-16 00:05 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->

## What this does

You answered a decision at 22:22 tonight and asked twice whether it had landed. It had not — and nothing in the system knew, because the click wrote a file into a state (`staged`) that no agent, script or sweep was watching. This makes the click reach the artifact on its own, and makes the page say where your answer is at every step.

Closes #120

Three defects, all closed here:

1. **Every click appended a file.** Six records existed tonight for two decisions, in triples 19 seconds apart. Now an identical re-click counts as a click on the *same* answer, and a changed answer supersedes the earlier record explicitly (`supersedes` / `supersededBy`) rather than sitting beside it — the old one stamped and kept, because a changed mind is a fact worth keeping.
2. **`decisionId` was always `null`, and per-question answers held nothing.** The id is joined from the hub's `reports/decisions/registry.json` at capture time; per-question answers are keyed by sub-id (`D0003.1`) with the code you read (`S1`); prose with no verdict is recorded as prose instead of being mislabelled "per-question" with an empty map; and a lookup that fails is written down as a failure instead of a silent null. Records written before tonight get their id resolved on read — your two open answers already show as **D0003** and **D0008**.
3. **Nothing watched `staged`.** The states now name their consumer: `captured` → `delivered` → `applied` (plus `superseded`). The 🧭🤖 Navigator sweep is the deliverer — launchd, every five minutes, running whether or not a session is — and it announces each answer in `navigator-state.md` and the session scratchpad, then marks it delivered. The agent that updates the artifact marks it applied with an evidence link.

## Roadmap context

Requirement [obot.roadmap#180](https://github.com/jwildfire/obot.roadmap/issues/180) (the Operations Dashboard), second follow-through after #118. The decision lane is the tab you called broken tonight: *"decision framework isn't working. Not at all clear to me what happens when i click accept."*

## What you will see

- **After a click:** *"Recorded as D0003. The Navigator picks it up within five minutes, then an agent updates the artifact — nothing else for you to do."* A repeat click says so instead of silently adding a row.
- **In the sidebar:** one row per decision, not one per click, each carrying its state — `captured 3m ago · the Navigator picks it up within five minutes`, `delivered · an agent has it`, `applied · the artifact was updated — see it` (a link, so you can confirm it yourself).
- **When nothing is listening:** the panel leads with *"1 answer of yours is going nowhere — the Navigator sweep is not running"* and the restart command. A hand-off with no consumer must never look like success; that failure class (green CI over a stale evidence baseline, a widget rendering a pre-fix calculation for three weeks) is one this program keeps paying for.

## Evidence

- <a href="https://github.com/jwildfire/obot.agent/issues/120">Issue #120</a> — the three defects, with the records that show them.
- Test suite: 173 tests pass (`node --test tools/session-hub/test/*.test.mjs tools/ops-dashboard/test/*.test.mjs tools/statusline/test/*.test.mjs tools/navigator/test/*.test.mjs scripts/test/*.test.mjs`), 16 of them new and written first — dedup, supersede, the id join, the refusal of an empty per-question verdict, the three-state pipeline, the "nothing is listening" banner, and the CLI.
- Live check against tonight's real store: six files collapse to two current answers, both now resolving to `D0003` and `D0008`, the older one flagged `OVERDUE`.

## Technical briefing

- `tools/ops-dashboard/lib/answers.mjs` (new) — the whole lane: capture with the registry join, content fingerprint for dedup, explicit supersede, status transitions that touch only status/history/pointers (an answer's verdict, words and per-question calls are written once and never edited), and `answersSection()` for the Navigator's state file.
- `tools/ops-answers` (new) — the bounded read: `pending`, `pending --json`, `deliver`, `apply <id> --evidence <url>`, `show`, `section`. `--exit-code` returns 1 when anything is pending and 2 when anything is overdue, so a wrapper can act on it. `prime-rehydrate` now carries `pending`, so a cold prime knows what you have decided without asking.
- `tools/navigator/sweep.mjs` — delivers on every sweep and renders the answers section; answer events carry an `[ops store HH:MM]` stamp rather than the RC lane's `[verified gh]`, because the provenance is different. A broken answer store degrades the sweep to a reported error and never breaks the RC queue.
- The store's local-only contract is unchanged and untouched: `.claude/ops/answers/` never publishes and never commits, every file still opens with the sentinel the hub deploy greps for, and no test fixture writes a real answer anywhere but a temp dir.

## Next steps

- **Nothing launches an agent by itself.** The sweep announces within five minutes whether or not a session is running; a session still applies. Closing that last gap unattended means letting a scheduled job start an agent, which is your call, not a code detail — until then an unapplied answer ages loudly (OVERDUE on the page, in the state file and in the CLI) rather than silently.
- Your two open answers (D0003, D0008) are delivered by the first sweep after this merges; D0003's artifact content is landing separately.

---

This PR was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
