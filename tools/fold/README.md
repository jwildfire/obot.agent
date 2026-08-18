# fold — the morning fold's gate

`node obot.agent/tools/fold/fold.mjs --dry-run`

Decides, every morning, whether there is anything to say. That is the whole of
this tool today: it writes no diary entry, renders no page and sends no push.
Those are [obot.agent#202](https://github.com/jwildfire/obot.agent/issues/202),
[obot.roadmap#247](https://github.com/jwildfire/obot.roadmap/issues/247) and
[obot.agent#205](https://github.com/jwildfire/obot.agent/issues/205), and each
acts on the verdict this produces.

Requirement: [obot.roadmap#238](https://github.com/jwildfire/obot.roadmap/issues/238),
from @jwildfire's adoption of the session-model decision (M2/M3) on 2026-08-16.

## Three gates, not one

The decision uses one phrase — *content-gated* — for three outputs whose false
positives cost wildly different amounts. One threshold for all three is how this
becomes the openclaw daily summary again, which was measured before it was
replaced: 559 words on a day it called quiet, seven real asks starting at line 38,
and length growing from 136 words to 865 against a template that had to be filled.

| Output | Gate | Why that one |
|---|---|---|
| Diary entry | **activity** since the last fold | A wrong yes costs a thin entry; the record still exists, and the diary is the keynote's raw material |
| Briefing page | **change** in the queue | A wrong yes costs nothing — it is one stable URL, rewritten in place |
| Push | **change, and a non-empty queue** | A wrong yes costs the next push, which is the only currency this has |

Underneath all three, one rule that is not symmetric: **an unknown is never
reported as quiet.** A source that could not answer returns `unknown`, and the run
exits 3 having published nothing. The failure it guards against has a name here —
the Navigator's sweep once reported "seven repos, two release candidates, workers
clean" while every one of its seven queries had failed.

## What it reads, and what it refuses to read

- Release candidates — `.claude/session-hub/cache/navigator-rc.json`. **Not**
  `navigator-state.md`, which is a prose render that caps its event list at
  fifteen while the snapshot behind it keeps sixty.
- Decisions awaiting him — the hub clone's `scripts/lib/collect/decision-log.mjs`,
  the same collector the Operations Dashboard uses. Only id, title and the
  discussion link cross the boundary; the collector's status prose runs to
  hundreds of words and a briefing line is fifteen.
- Open config items — unchecked bullets under `## Open` in `.claude/blockers.md`.
  **Not** the sweep's `config ledger: 14 id(s) allocated` line, which is a
  ledger-integrity audit and would be wrong by four. The **count** is the entire
  permitted payload; that list is local-only and the hub deploy fails on its
  sentinel.
- Activity — commits across the repos `scripts/policy.json` names, events from the
  sweep snapshot, and byte growth in the `## Session log` of the two newest daily
  scratchpads. Two files, never one: right after midnight the new day-file is
  nearly empty while the session still lives in yesterday's.

Every time comparison uses a real instant. An event's `at` is a bare local `HH:MM`
with no date and no zone, and this machine's own records disagree with themselves
across the BST-to-EDT move.

## State

Everything the fold owns is under `.claude/fold/` — its own directory, because the
Navigator's sweep declares itself sole writer of `.claude/session-hub/`.

- `state.json` — the watermark, the last published queue hash, and the session-log
  sizes at the last fold.
- `runs.jsonl` — one line per run, **including quiet ones**. A quiet night and a
  dead scheduler produce identical output, which is nothing; this file is what
  tells them apart.

The one shared file it touches is the timing ledger at
`.claude/session-hub/cache/init-timings.jsonl`, where it stamps a `fold` bookend
beside `init` and `wrapup`.

## Why it is a script and not a session

The open readiness question ([D0019](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-16-scheduled-sessions-assessment/),
answer "not yet") and `scripts/policy.json`'s A2 both concern whether a scheduled
job may start an **agent** unattended. Neither concerns a scheduled script, and
this machine already runs one with @jwildfire's acceptance — `com.obot.navigator-sweep`,
a node script under launchd every 300 seconds. The fold is that class of thing.

The single part of the requirement that needs a model is the diary entry's
narrative paragraph, and it is deliberately the only piece held behind A2.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Decided — `fold` or `quiet` |
| 3 | Unknown — a source could not answer, so nothing was published |
| 1 | Bad arguments |

## Tests

`node --test tools/fold/test/*.test.mjs`

The acceptance is on the filesystem, not on the tool's own report: after a quiet
run, nothing has changed except the run log and the ledger. Two of the tests are
calibrated against real history and skip, loudly, when the clones are absent.
