<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/120 on 2026-08-15 23:35 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->

# An answer you click has to reach the artifact on its own

On 2026-08-15 at 22:22 @jwildfire answered a decision in the Operations Dashboard, then asked twice whether it had landed. It had not, and nothing in the system knew that — he noticed before any part of it did. The click wrote a file and the file sat there. Capture works; **delivery does not exist**, and the page says nothing about which state his answer is in ("decision framework isn't working. Not at all clear to me what happens when i click accept").

Three files exist for that one decision, 19 seconds apart, and three more for a second decision at 21:09–21:10. Every one of them carries `decisionId: null`, and the first of each triple carries `verdict: "per-question"` with `questions: {}` — a verdict naming per-question answers, holding none.

## What is actually broken

**1. Every click appends a new answer file.** Three records for one decision. Today they happen to agree, so last-write-wins is harmless by luck; two genuinely different answers would sit side by side with nothing in the data marking which one is his. Supersede has to be explicit and readable, and the older answers must be kept — a changed mind is itself a fact.

**2. `decisionId` is never joined, and per-question answers capture nothing.** The store knows the artifact slug; the hub's `reports/decisions/registry.json` maps that slug to `D0003` and carries the sub-ids (`D0003.1` … `D0003.6`, each with a code like S1 and the question text). Nothing joins them, so the field that exists for exactly this purpose is empty on every record and the ids he asked for cannot be used to reference his own answer. A `per-question` verdict with an empty `questions` map is silent data loss — and in this case a mislabel: he typed words, picked no verdict, and the client called that "per-question".

**3. `status: "staged"` — and nothing watches staged.** This is the one that cost him the evening. A record in a terminal state with no consumer is not a hand-off, it is a note in a drawer. The vocabulary has to separate *captured* from *delivered* from *applied*, so "did it land?" is answerable from the store alone, and something that runs when no session is open has to do the delivering.

## What this issue changes

- **Dedup, then supersede.** An identical re-click (same verdict, same words, same per-question answers) returns the record already on disk instead of writing another — three rapid clicks are one decision. A *different* answer writes a new record that names what it supersedes, and the superseded record is stamped rather than deleted, so the history reads forward.
- **The ids get joined at capture time.** `decisionId` is resolved from the hub registry by slug when the answer is written, and a lookup that fails is recorded as a failure on the record rather than as a silent `null`. Per-question answers are stored keyed by sub-id with their code, and a verdict of `per-question` with nothing in it is rejected at the door.
- **A three-state pipeline with a scheduled deliverer.** `captured` → `delivered` → `applied` (plus `superseded`). The 🧭🤖 Navigator sweep — launchd, every five minutes, session-independent, the one observer that survived a context reset — picks up captured answers, announces them in `navigator-state.md` and the session scratchpad, and stamps them `delivered`. The agent that updates the artifact stamps `applied` with its evidence link. `tools/ops-answers pending` is the one bounded read that answers "has he decided anything I haven't acted on?", and `prime-rehydrate` carries it.
- **The page shows the state.** After a click he is told what just happened and what happens next; each answer shows where it is in the pipeline; an applied answer links the updated artifact so he can confirm it himself. And when nothing is listening — the Navigator dead or never installed — the page says so on the answer itself instead of showing a quiet row that looks like success. That failure class (green CI over a stale baseline, a widget rendering a pre-fix calculation for three weeks) is the one this program keeps paying for.

Local-only is unchanged and absolute: `.claude/ops/answers/` never publishes and never commits.

---

This Issue was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
