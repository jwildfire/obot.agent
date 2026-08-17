<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/153 on 2026-08-17 06:28 CEST -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Base: main, Lane: standard (non-RC) -->

A worker that stops — finished, stalled, dead or waiting — now reaches the Navigator within one sweep cycle instead of waiting for someone to notice.

Closes #151

## Why this now

Twice in two days a worker stopped and nobody judged it.

- 2026-08-16: W0006 and W0007 both finished with work open and sat about twenty minutes on a fully awake machine. What surfaced them was obot-prime sending an unrelated message.
- 2026-08-17: the Navigator sat idle from 23:20 to 05:25 with a full backlog and nothing running, after W0013 closed out. The power log was checked before the host was blamed — no sleep or wake events in that window — so the machine was awake and the supervisor stalled. @jwildfire noticed first, again.

The sweep already knew. `firstTerminalAt` has been its closeout watermark since day one and the delivery journal has been the ledger of which closeouts carry a verdict. What it could not do was get anyone's attention.

Requirement: [roadmap #212](https://github.com/jwildfire/obot.roadmap/issues/212), whose Design section this PR fills in, under goal [#73](https://github.com/jwildfire/obot.roadmap/issues/73). The two extensions @jwildfire named this morning — the supervisor stalling as the same shape one level up, and a waiting worker nobody resolves — are recorded in the requirement as an amendment rather than built silently.

## Evidence

- <a href="https://github.com/jwildfire/obot.roadmap/issues/212">roadmap #212</a> — the requirement, with the Design section and the 2026-08-17 amendment now filled in.
- <a href="https://github.com/jwildfire/obot.agent/issues/151">obot.agent #151</a> — the task, linked as a sub-issue.
- Probe session `ea8238da` — a background session left genuinely idle (`tempo: idle`, last activity 2m28s earlier) received a line appended to the watched file four seconds later. The same probe confirmed a cross-session message wakes a `blocked` session.
- Probe session `ed30599b` — the full chain on real data. The sweep wrote at `04:57:21Z`; a stand-in Navigator tailing `wake-listen` woke and acted at `04:57:39Z`.
- That run found what was actually wrong on this machine: W0017's closeout unjudged one minute old, W0009 and `d0003` dead on network errors, and W0007, W0008 and W0002 waiting 19 to 22 hours on prompts nobody had answered.
- The `## Wake` section was opened in Chrome at a real 390px viewport (iframe probe) rather than read in the source: 386px viewport, 386px scroll width, the channel alarm rendering as an alarm box.
- 442 tests pass locally, 27 of them new; `obot-policy validate` and the policy verdict sweep are clean.

## Technical briefing

The reading is the part that took the work. A stopped worker's `state` field lies, and that was only learnable by reading all 78 job records on this machine:

| Reading | Kind | Real case |
|---|---|---|
| `firstTerminalAt` set, no verdict in the delivery journal | stopped | W0013, unjudged six hours |
| `tempo=blocked` + `needs="approve …"` | waiting | W0007 and W0008, twenty hours each, both reading `working` |
| `state=blocked` + an API/network error | dead | W0009 |
| `tempo=active`, quiet 30m+ | stalled | the usual gap between a worker's actions is ~20 seconds |
| Navigator idle, no worker running, ready work in the queue | idle | last night, for six hours |

Delivery is a persistent `Monitor` in the Navigator session tailing an append-only log the sweep writes. It is the only mechanism available: there is no `claude send` and no local API to prompt a running session, so a shell-scheduled sweep cannot message one, and the Stop hook fires at the end of a turn an idle session is not having. Nothing in the path can reach @jwildfire — no notification, no comment, no Reminder — and that is structural rather than a rule someone has to remember.

Failing loudly, everywhere it can fail:

- The pending list and the channel's own state are computed and rendered before anything is delivered, so the section can never read as a judged fleet because the delivery lane broke.
- A `Monitor` dies with its session, so the listener heartbeats and the sweep prints `wake channel: armed` or `WAKE CHANNEL DOWN` beside the list every five minutes.
- The pending list is the first section of `navigator-state.md`, which is read #1 on the Navigator's cold start — a missed wake degrades to exactly today's behaviour.
- Every bound reports itself: the 24-hour window, the three-per-run cap, and a backlog count that says "at least" when its page filled.
- A sweep gap longer than fifteen minutes means the host was away rather than the fleet stalled, and elapsed-time detections are suppressed for that run with the reason printed. That misreading is what produced the first amendment to #212.
- The one case it cannot cover, recorded in the requirement rather than in a comment: if the Navigator session is not running at all, there is nothing to wake and the only reader of `WAKE CHANNEL DOWN` is the role that is absent. Escalating an absent officer to @jwildfire is what #212 forbids, so it is a known limit rather than something closed with a notification.

Suppression is a comparison rather than new state: the delivery journal says which closeouts are judged, and the append-only wake log's own last entry per key is the re-wake floor. Nothing new is stored.

Two defects were found by checking the rendering against the real parser instead of eyeballing it, and both are fixed here:

- The status lines were indented, and an indented line is a *detail* of the line above it, which carries no alarm flag — `WAKE CHANNEL DOWN` would have arrived as small print under a headline reporting a quiet fleet. That is [#129](https://github.com/jwildfire/obot.agent/issues/129) for the third time.
- `ALARM_RE` matched GAP, FINDING, BREACHED and FAILED. DOWN and BROKEN are added, so the one alarm that says the alarms are not being delivered is not the only one rendering as ordinary text.

One adjacent fix, from looking at the page at 390px: an alarm box carrying a filesystem path pushed the page to 452px in a 386px viewport, because a path is one unbreakable token and `.dead` had no `overflow-wrap`.

## Next steps

- Merge clearance from 🧭🤖 obot-navigator on the standard lane (non-RC, base `main`, operational repo). The launchd sweep runs from the main clone, so it picks this up on its next five-minute run with no install step.
- The Navigator arms the channel once with a single `Monitor` call — the cold-start block in `skills/navigator/SKILL.md` now opens with it. Until then the sweep will report `WAKE CHANNEL DOWN`, correctly.
- Six unresolved stop-states are waiting on this machine right now, including three workers that have been waiting 19 to 22 hours. They are the first thing the channel will deliver.

---

This PR was drafted by 👯🤖 W0015 (Claude Code using Opus 5) and reviewed by @jwildfire.
