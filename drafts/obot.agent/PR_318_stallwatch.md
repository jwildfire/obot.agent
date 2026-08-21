<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/318 on 2026-08-21 21:58 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Assignee: @me -->

## What this does

A worker stuck at a permission prompt is now found by the machine in about three minutes, instead of by somebody happening to look after an hour. The five-minute sweep gained a reading that names the worker, how long it has been sitting there, the approval it is waiting on verbatim, and — the part a lead cannot work without — that the session cannot be messaged at all.

Closes #317

## Why it is not a nice-to-have

Measured today with transcript evidence (#315, `docs/session-reachability.md`): a session sitting on a permission prompt cannot be reached. A cross-session message is enqueued unconditionally and drains at the receiver's next turn boundary, and a prompting session's next turn boundary is the permission decision itself — which only a human produces. The queue never drains. Two leads tried to unstick W0110; both sends returned `success: true` and neither was ever read.

So every "stop and tell the lead" instruction in the briefing is unreachable exactly when it applies. The conversational remedy does not exist and detection is the only one left. Three stalls this week: 67 minutes, 81 minutes, 59 minutes — the middle one fatal, its work finished by prime.

## Roadmap context

Sub-issue of [jwildfire/obot.roadmap#212](https://github.com/jwildfire/obot.roadmap/issues/212) — the requirement that a worker which stops wakes the Navigator. That requirement's wake answers "who stopped"; this answers "who cannot be reached", which is the more expensive of the two and until now was answered by nobody.

The issue is off the board: board writes fail for everyone while [obot.roadmap#252](https://github.com/jwildfire/obot.roadmap/issues/252) is open.

## Evidence — both cases driven live, not mocked

Two throwaway probe sessions were spawned in this workspace, one parked on a real permission prompt and one whose `blocked` came only from a sentence it wrote. Both read `state: blocked`. Only `status` separates them, and it did.

The parked one, rendered by the real collector against the live daemon:

```
**STALL FINDING** — 1 background session is parked on a permission prompt and cannot be messaged. A send to one returns `success: true` and is never delivered: the queue drains at the receiver's next turn boundary and a prompting session's next turn boundary IS the permission decision (docs/session-reachability.md). Answer the prompt at the session, or stop it and respawn the work — there is no third option and nothing here expires on its own.
reachable: 1 session read blocked in the job record but the daemon says W0113.2 is idle — that is a classifier reading the session's own prose, not a pending prompt, and a message reaches it in milliseconds. Not reported above, on purpose (obot.agent#315 probe B).

### Parked

- W0113.1 · waiting 4m · needs: approve Bash: cd /Users/jwildfire/Documents/obot2/obot.agent && node --test tools/navigator/test/wake.test.mjs tools/ops-dashboard/test/*.test.mjs · 1 message(s) queued and undelivered — they die with the session, so somebody may be waiting on an answer that will never come
```

The prose-blocked one alone, after the parked session was stopped — reported by nothing, and named as reachable rather than dropped:

```
stalls: clear — no background session in this workspace is parked on a permission prompt (5 watched, `claude agents --json` joined to the job records on `id`)
reachable: 1 session read blocked in the job record but the daemon says W0113.2 is idle — that is a classifier reading the session's own prose, not a pending prompt, and a message reaches it in milliseconds. Not reported above, on purpose (obot.agent#315 probe B).
```

Three measurements taken while doing it, each independently reproducing or correcting #315:

- A message sent to the parked probe recorded one `enqueue` at 21:48:27.301Z in its transcript and never a `dequeue`. Its record closed with `inFlight.queued: 1` at the moment it was stopped.
- A message sent to the prose-blocked probe was dequeued in **9 ms** (#315 measured 8). It is healthy, and messaging it is the correct response — which is why reporting it as stalled would be the expensive mistake.
- `status` is NOT in `state.json`. No job record on this machine carries the key: 194 checked, zero matches. It exists only in `claude agents --json`. `docs/session-reachability.md` said otherwise and is corrected in this PR.

## Technical briefing

- `tools/navigator/stallwatch.mjs` — the reading. `collectStalls` joins the daemon view to the job records on `id` (falling back to `sessionId`), watches background sessions in this workspace only, and reports at `STALL_PROMPT_MIN = 3`. The threshold's justification is in the source: the briefing's own "couple of minutes" bar, the sweep's five-minute period, and the fact that none of the wake's fifteen minutes is inheritable because ten is grace and five is a settle window for a misread this reading cannot have.
- No suspension guard, deliberately, and the reason is in the source: `status: waiting` is a present-tense reading from the live daemon, so a nap cannot manufacture one — it can only inflate the age, and an inflated age on a genuinely open prompt is still an open prompt.
- `queueDepth` reads the transcript's `queue-operation` entries after the record froze, because `inFlight.queued` reads nought for exactly the sessions it is about — the record is only rewritten when a session publishes state, and a parked one publishes nothing. The record's number is kept as a floor.
- `readJobs` in `wake.mjs` gained `sessionId`, `queued` and `transcript`. Additive, and put there rather than in a second reader for the reason that function's own header gives.
- Delivery rides the existing wake channel as kind `stall` with its own per-run budget and a fifteen-minute re-wake floor, so the finding is pushed to the Navigator's Monitor and not only published. It does not suppress the wake's own `waiting` reading of the same session: documented duplication is cheaper than changing a detector three other things depend on, inside the change that adds a second one.
- The finding matches `ALARM_RE` imported from `tools/ops-dashboard/lib/navigator.mjs`, on an unindented line, and a test asserts the effect through `parseNavigatorState` rather than the regex. A reading that did not happen is alarmed rather than omitted, at both ends.

## Tests

29 new tests in `tools/navigator/test/stallwatch.test.mjs`, including the two cases asserted against each other from one fixture. Full run: **1913 of 1914 pass**. The one failure is `the workspace is clean: no surface carries an unregistered palette`, which is pre-existing on `main` — it reports `obot.roadmap/scripts/lib/premise-status.mjs` and a grown `obot.roadmap/reports` archive, is the known live-workspace census gap described in the v0.5.0 notes, and is untouched by this change.

## Next steps

- The workspace `.claude/settings.json` has no allowlist entry for `scripts/obot-test`, so the call site shipped for #315 still falls through to the classifier. Only @jwildfire can add it; it is already captured as c0025.
- If the duplicate reading of one parked session on the wake channel proves noisy in practice, the follow-up is to make `wake.mjs`'s `waiting` kind defer to this one rather than to widen this.

---

Drafted by 👯🤖 W0113 (Claude Code, Opus 5).
