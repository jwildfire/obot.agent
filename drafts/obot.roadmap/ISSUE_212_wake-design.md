<!-- STATUS: Drafted on 2026-08-17 06:05 CEST -->
<!-- GITHUB_PROPERTIES: edit of the existing body — appended to hub#212, no new issue -->

These two blocks are appended to the body of jwildfire/obot.roadmap#212. The
amendment goes after the existing "The stronger finding underneath it" section; the
Design block replaces the placeholder "To be populated."

---

### Amendment, 2026-08-17 morning — the supervisor is the third case

It happened again overnight, in the shape the correction above cannot explain away.

- The Navigator sat idle from 23:20 to 05:25 with a full backlog and nothing running, after 👯🤖 W0013 closed out and nobody judged it.
- The power log was read before the host was blamed. No sleep and no wake events in that window: the machine was awake and the supervisor simply stalled.
- @jwildfire noticed before we did. Twice in two days.

Two cases join the original scope rather than being re-filed as their own requirements, because they are the same detection asked at a different level:

- The supervisor stalling is the same shape one level up. A queue with items and nothing running is itself a detection worth waking on, and it is precisely the state this machine was in for six hours.
- A worker in a waiting state that nobody resolves is a third stop-state. W0007 and W0008 sat on unanswered permission prompts for nineteen and twenty hours on 2026-08-16, and both read `working` in their job records the entire time.

That last one also settles what the load-bearing reading actually is. It is not `state`. Across all 78 job records on this machine, `state` is the field that lies about a stopped worker — it says `working` for one stuck on a prompt and `blocked` for one dead on a network error. `tempo` and `needs` are what separate them, and nothing was reading either.

### Design

Four stop-states, read from the fields the harness already writes:

| Reading | Kind | What it asks the Navigator to do |
|---|---|---|
| `firstTerminalAt` set, no verdict in the delivery journal | stopped | judge the closeout against GitHub |
| `tempo=blocked` + `needs="approve …"`, quiet 10m+ | waiting | resolve it, retask it, or stop it |
| `state=blocked` + an API/network error in `detail` | dead | look for the branch or PR its record does not mention |
| `tempo=active`, quiet 30m+ | stalled | go and look — the usual gap between a worker's actions is ~20 seconds |

Plus one at the level above: no worker running, the Navigator idle 20m+, and ready work in the queue.

No new data is collected. The job records and the delivery journal were already being read; ready work is counted off the GraphQL query the sweep already runs once per repo.

The wake mechanism, which is the call this requirement said must not be made silently:

- The delivery lane is a persistent `Monitor` in the Navigator session tailing an append-only log the five-minute sweep writes. Every line becomes one notification inside that session.
- It was measured rather than assumed. A background session was left genuinely idle — `tempo: idle`, last activity 2m28s earlier — and a line appended to the watched file reached it four seconds later (probe session `ea8238da`, 2026-08-17).
- The alternatives were checked and rejected on evidence. There is no `claude send` and no local API to prompt a running session, so a shell-scheduled sweep cannot message one. A cross-session message does wake an idle session — that is the lane obot-prime hit by accident on 2026-08-16, and the only reason anyone noticed W0006 — but sending one requires a second Claude session, which is a whole agent turn per wake and one more thing that can die quietly. The Stop hook's `decision: block` fires at the end of a turn an idle session is not having.
- Nothing here can reach @jwildfire. There is no `PushNotification`, no issue comment, no Reminder anywhere in the path, and the constraint is structural rather than a rule someone has to remember: the mechanism is a file tail inside one named session.

What it costs when it fails, which is the honest half:

- A `Monitor` dies with its session, so this lane can be silently absent. The listener therefore heartbeats a file, and the sweep reports `wake channel: armed` or `WAKE CHANNEL DOWN` beside the pending list every five minutes.
- The pending list is computed and rendered whether or not anything is delivered, and it is the first section of `navigator-state.md`, which is read #1 on the Navigator's cold start. So a missed wake degrades to exactly today's behaviour — the Navigator finds it on its next read — and never to a claim that everything is judged.
- Every bound reports itself: the 24-hour window prints how many older closeouts it skipped, the per-run cap of three prints what it held for the next sweep, and the backlog count says "at least" when its page filled.
- The one case this cannot cover: if the Navigator session is not running at all, there is nothing to wake, and the only reader of `WAKE CHANNEL DOWN` is the role that is absent. Relaunching is `obot.agent/scripts/obot-navigator`, and it stays @jwildfire's or the concierge's move — escalating an absent officer to him is the one thing this requirement forbids, so it is recorded as a known limit rather than closed with a notification.

Suppression is a comparison, not new state:

- A closeout stops waking when a verdict for it appears in the delivery journal. Nothing else silences it, which is the correct silencer — the wake is asking for exactly that verdict.
- Repeat wakes are spaced by a per-kind floor (30m for a closeout, 60m for the rest), derived from the last entry per key in the append-only wake log itself.

One guard the misdiagnosis of 2026-08-16 earned: when the gap since the previous sweep is longer than fifteen minutes, the host was away rather than the fleet stalled, and every elapsed-time detection is suppressed for that run with the reason printed. A detector cannot run on a suspended host, and reporting a suspended laptop as a stalled fleet is how the first amendment to this requirement came to be filed on a cause that was never checked.

Not in scope, unchanged: waking on anything other than a worker stop-state or an empty fleet, any wake that reaches @jwildfire, and acting automatically on what is found. The Navigator still judges.

---

This comment was drafted by 👯🤖 W0015 (Claude Code using Opus 5) and reviewed by @jwildfire.
