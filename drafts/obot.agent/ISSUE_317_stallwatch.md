<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/317 on 2026-08-21 21:44 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Assignee: @me, Parent: jwildfire/obot.roadmap#212 -->

## The remedy we wrote for a stalled worker cannot be used on a stalled worker

Measured today with transcript evidence ([obot.agent#315](https://github.com/jwildfire/obot.agent/issues/315), `docs/session-reachability.md`): a session sitting on a permission prompt cannot be reached. A cross-session message is enqueued unconditionally and drains at the receiver's next turn boundary — and a prompting session's next turn boundary is the permission decision itself, which only a human produces. The queue never drains. Two leads tried to unstick W0110; both sends returned `success: true` and neither was ever read.

So every "stop and tell the lead" instruction in the briefing is unreachable exactly when it applies, and the conversational remedy does not exist. Detection is the only one left.

## What it costs when nothing detects it

Three stalls this week, all found by a person happening to look: 67 minutes, 81 minutes, 59 minutes. The middle one was fatal — its work had to be finished by prime.

The wake channel does have a `waiting` reading, and it is too slow and keyed on the wrong field:

- It fires at fifteen minutes (`WAITING_GRACE_MIN` 10 + `WAITING_SETTLE_MIN` 5). That is a floor, not the report time: the sweep runs every five minutes, so the real first report lands at 15–20 minutes.
- It keys on `state`/`tempo`, which the harness derives from the session's own prose. `state: blocked` is true of a worker at a real prompt AND of a worker a classifier misread from a sentence it wrote — and those two need opposite responses. The settle window exists only to tell them apart after the fact.

## What this adds

A second reading beside the wake, keyed on the field that is measured rather than inferred.

- `status` from `claude agents --json` is the daemon's own record of the session: `waiting` means a real pending approval, `idle` and `busy` mean reachable. Probes B and C in #315 measured that separation — a `state: blocked` session whose `status` was `idle` answered a message in 8 milliseconds.
- `updatedAt`, `needs` and `inFlight.queued` come from `~/.claude/jobs/{id}/state.json`, joined to the agent row by job id. No new instrumentation.
- The finding names the worker, the age, and the pending approval verbatim; says the session cannot be messaged; and prints `inFlight.queued` when it is non-zero, because those messages die with the session and somebody may be waiting on an answer that will never come.

Note the brief's premise needs one correction, recorded here so the next reader does not lose an hour to it: `status` is NOT in `state.json`. No job record on this machine carries the key at all. It exists only in the `claude agents --json` view, which is why this detector reads both and joins them.

## Done when

- A session parked on a real permission prompt is reported by the five-minute sweep, with its age and its `needs` text, and the finding says it cannot be messaged.
- A session whose `blocked` is a classifier reading its own prose is NOT reported.
- Both cases are demonstrated against real sessions, not fixtures alone.
- The finding matches `ALARM_RE` imported from `tools/ops-dashboard/lib/navigator.mjs`, so it reaches the page red.

## Off the board

Board writes fail for everyone right now ([obot.roadmap#252](https://github.com/jwildfire/obot.roadmap/issues/252)) — the obotclaw App gets `FORBIDDEN` on a user-owned ProjectsV2 board. This issue is therefore off the board, which is a known blocked mechanism rather than an oversight.

---

Drafted by 👯🤖 W0113 (Claude Code, Opus 5).
