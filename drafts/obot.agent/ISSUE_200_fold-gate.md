<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/200 on 2026-08-18 01:02 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, type:task -->

Requirement: jwildfire/obot.roadmap#238 — the morning fold, and the briefing it produces.

## Why this one is first

Everything else in the fold hangs off one question: is there anything to say? The requirement calls it "the whole design", and it is right — the last time this program published on a clock without asking, it produced 559 words on a day it described as quiet, and trained its only reader to skip.

This task builds the runner and the answer to that question, and nothing else. It writes no diary entry, renders no page and sends no push. It decides, it records what it decided, and it can be run against real history to show that the decision is correct.

## What it does

`obot.agent/tools/fold` — a script, invoked with no arguments to fold, or:

- `--dry-run` — print the verdict and the evidence behind it; touch nothing.
- `--since <iso>` — fold a stated window instead of the watermark's.
- `--force` — fold regardless of the gate, for a rehearsal.
- `--json` — the verdict as data, for the tasks that follow.

Three gates, not one, because the requirement's single phrase covers three outputs whose false positives cost different amounts:

| Output | Gate |
|---|---|
| Diary entry | **Activity** since the last fold |
| Briefing page | **Change** in the queue's content |
| Push | **Change, and a non-empty queue** |

- **Activity** — at least one of: a commit in a project repo, a GitHub event in the Navigator's swept stream, a new line under `## Session log` in a daily scratchpad. Measured from real instants (git author date, `updatedAt`, the event's `ts`), never from a wall-clock string: the `HH:MM` on a swept event and the shelled time on a scratchpad line have both been written under at least three timezones and currently disagree with each other across this machine's BST-to-EDT move.
- **Change** — a canonical hash over the queue's items (release candidates, decisions awaiting him, mechanical todos, the open blocker count) differing from the hash behind the last published briefing. The fold's own stamp and any ordering churn are outside the hash by construction, so a re-run five minutes later is not a change.
- The queue is cumulative. An item he has not closed carries every morning and never pushes twice.

Where the facts come from, all machine-readable:

- Release candidates — `.claude/session-hub/cache/navigator-rc.json` (`snapshot` + `events`). Not `navigator-state.md`, which is a prose render that truncates its event list at fifteen and says so.
- Decisions awaiting him — the hub clone's `scripts/lib/collect/decision-log.mjs` → `collectDecisionLog().open` (3 today: D0019, D0020, D0021).
- Open blocker count — unchecked bullets under `## Open` in `.claude/blockers.md` (10 today). Not the sweep's `config ledger:` line, which is an integrity audit reading `14 allocated` and would be wrong by four.
- Scratchpad activity — the two newest `^\d{4}-\d{2}-\d{2}\.md$` files, per the two-day read in `tools/prime-rehydrate`, whose strict regex is the version to copy rather than `handoff.sh`'s looser glob.

State, in the fold's own directory:

- `.claude/fold/watermark` — the instant the last fold covered up to.
- `.claude/fold/last-briefing.json` — the hash behind the last published briefing.
- `.claude/fold/runs.jsonl` — one line per run, including quiet ones. Local, never committed.

It also stamps a `fold` bookend into the timing ledger at `.claude/session-hub/cache/init-timings.jsonl`, and extends the documented `init|wrapup` enum in `docs/session-framework.md` in the same change — the doc reads `"bookend":"init|wrapup"` literally, and a `fold` row against it is a schema violation until the sentence moves.

Everything the fold writes goes under `.claude/fold/`. The Navigator's sweep is the declared sole writer of `.claude/session-hub/` and a second writer there is reported as a ledger fault; the timing ledger is the one exception, and it is an append to a file the skills already share.

## Acceptance

- A quiet window produces zero writes outside `.claude/fold/runs.jsonl`: no diary entry, no hub commit, no push, exit 0. Demonstrated, not asserted — `git status` clean in both repos afterwards.
- Calibrated against measured windows of real history, as a test, rather than against fixtures alone.
  Correction to this issue as filed: 5–13 August is the **diary's** gap, not a work gap — those nine days carry 29 commits across obot.agent and obot.roadmap, so they are a bad calibration point for "quiet". The measured windows are 2026-08-11T09:00Z→2026-08-12T08:00Z (zero commits across all seven project repos) and the night of 16 August (116).
- A failed `gh` query is never read as "no content". The sweep's canonical defect is a line reading "seven repos, two release candidates, workers clean" while all seven queries had failed; `/tmp/com.obot.navigator-sweep.err` holds 33 KB of connection resets, so this is a live condition rather than a hypothetical. The gate reports `unknown` and folds nothing rather than reporting quiet.
- `--dry-run` prints which of the three gates opened and the specific evidence for each, so the verdict can be argued with.
- A second run inside the same window is a no-op. launchd does not replay a calendar fire missed while the machine slept — it fires once on wake, at an arbitrary hour — so the fold must fold the window its watermark defines, never the window its wall clock implies.

## Not this task

The briefing page ([jwildfire/obot.roadmap#247](https://github.com/jwildfire/obot.roadmap/issues/247)), the marker (#201), the diary entry (#202), the ideas sweep (#203), the schedule (#204), the push (#205). This one decides; the others act on the decision.

---

Filed by 👯🤖 W0045 (Claude Code using Opus 5) against @jwildfire's adoption of D0007/M2 on 2026-08-16. Not reviewed by him.
