<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/151 on 2026-08-17 06:18 CEST -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Assignee: @me, Parent: jwildfire/obot.roadmap#212 -->

The five-minute sweep already knows when a worker has stopped. It has no way to tell the Navigator, so workers stop and then wait — twenty minutes on 2026-08-16, and six hours overnight on 2026-08-17 with a full backlog and nothing running.

This is the obot.agent half of [roadmap #212](https://github.com/jwildfire/obot.roadmap/issues/212): the detection, the delivery, and the already-judged suppression.

## What ships

- `tools/navigator/wake.mjs` — four stop-states read from the fields the harness already writes, plus the idle detection one level up. `state` is not one of them: it says `working` for a worker stuck twenty hours on a permission prompt and `blocked` for one dead on a network error. `tempo` and `needs` are what separate them.
- `tools/navigator/wake-listen` — the delivery lane. The Navigator arms it as a persistent `Monitor`; every line it prints is one notification inside that session. It heartbeats, because a `Monitor` dies with its session and a wake log nobody tails looks exactly like a fleet with nothing wrong.
- `tools/navigator/sweep.mjs` — computes the pending list, renders it above the RC queue, and appends the log. The list and the channel's own state are rendered whether or not anything is delivered.
- `skills/navigator/SKILL.md` — arm the channel before the first read, and what each kind of wake asks for.

## Why it cannot fail quietly

- The pending list is the first section of `navigator-state.md`, which is read #1 on the Navigator's cold start. A missed wake degrades to today's behaviour, never to a claim that everything is judged.
- The sweep prints `wake channel: armed` or `WAKE CHANNEL DOWN` beside the list, every five minutes.
- Every bound reports itself: the 24-hour window, the three-per-run cap, and a backlog count that says "at least" when its page filled.
- A sweep gap longer than fifteen minutes means the host was away rather than the fleet stalled, and the elapsed-time detections are suppressed for that run with the reason printed. That misreading is what produced the first amendment to #212.

## Verified, not asserted

- A background session left genuinely idle (`tempo: idle`, last activity 2m28s earlier) received a line appended to the watched file four seconds later.
- Full chain on real data: the sweep wrote at `04:57:21Z` and a stand-in Navigator session tailing `wake-listen` woke and acted at `04:57:39Z`.
- The same run found what was actually wrong on this machine: W0017's closeout unjudged, W0009 and `d0003` dead on network errors, and W0007, W0008 and W0002 waiting 19 to 22 hours on prompts nobody had answered.

## Not in it

Waking on anything other than a worker stop-state or an empty fleet, any wake that reaches @jwildfire, and acting automatically on what is found. The Navigator still judges.

---

This Issue was drafted by 👯🤖 W0015 (Claude Code using Opus 5) and reviewed by @jwildfire.
