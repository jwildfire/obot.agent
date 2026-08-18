<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/205 on 2026-08-18 01:02 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, type:task -->

Requirement: jwildfire/obot.roadmap#238 — the morning fold, and the briefing it produces.

## Exactly two things interrupt him

- A release candidate goes ready, with its demo.
- Every active goal is blocked at once — the escalation `docs/rc-framework.md` already names as the one case the morning read is too slow for.

Nothing else. Everything else waits for the fold. And separately, the fold's own morning line — one push, counts and a link, skippable for free.

There is no path from this program to his phone today. The one wake channel that exists was deliberately built without one: `tools/navigator/wake.mjs` says so in its own comment — "the mechanism below was chosen partly because it has no path to him".

## The obvious construction is the one that cannot work

`PushNotification` is the only mechanism, and two things constrain it:

- It is a harness tool. A plain script cannot call it, and the fold is a script.
- It reaches a phone only when Remote Control is connected — and every scheduler-spawned session on this machine is deliberately unbridged since the sibling rule changed on 2026-08-15. None of the fleet or admiral job records carries a bridge. Dropping the opt-out flag does not fix that either: the flag and the global setting are peers in one `||`.

So a cron-spawned sibling that pushes is precisely the construction that provably cannot push.

## The lane to build

The fold appends a one-line payload to a watched file; a bridged standing session already running — prime or the Navigator — relays it with `PushNotification`. It is the `wake-listen` pattern with a different destination, it starts no agent on a clock so it moves no autonomy line, and it degrades honestly: with no standing session there is no interruption, and the briefing page still updates.

It is a **separate lane from the Navigator's wake**, which stays exactly as it is. Generalising one notifier into both would put worker-lifecycle noise on his phone, which is the thing that channel was shaped to prevent.

Two alternatives exist and should be weighed before building: a short bridged agent launched per push (works — the launchd sweep has demonstrably spawned a real background session — but it is A2 and reverses the sibling rule for this lane), and an external notifier (no dependency of that kind exists anywhere in the repo today). Pick one, state why, and do not leave it implicit.

## Verifying it, which is the actual work

The decision page flagged this as asserted rather than tested: "PushNotification reaching the phone from a cron-spawned background job is asserted from the tool contract but not yet exercised from that lane; the build must verify it."

`PushNotification` deliberately declines when he is at the terminal, and says it skipped. A build that verifies by checking the tool returned success will report a working phone lane that never rang — the exact failure class this program has hit nine times in one night. The only acceptable evidence is @jwildfire saying the phone buzzed, on a run started while he is away from the keyboard.

## Degrading honestly

"An RC going ready with its demo" needs the demo. The demo link is not in the sweep's data at all — it comes from parsing the PR body for a `**See it move:**` link, and the one live RC today parses to no demo. A push that promises a demo and links the PR instead is a small lie that costs the next push its credibility. If the body carries no demo, say so in the line.

The all-goals-blocked condition has no detector yet. Goal ancestry is computed; goal blocked-state is not, anywhere. It needs its own query over the five active goals plus the ancestor walk that already exists.

## Acceptance

- He confirms the phone buzzed, from a run he did not start, while away from the keyboard.
- A morning with a non-empty queue and no change since the last push sends nothing.
- An RC with no demo link says "demo owed" rather than linking the PR as one.
- With no bridged session alive, the fold completes, the page updates, and the run log records that the push had no relay — visibly, not silently.
- The Navigator's wake channel is unchanged, and still reaches nobody but the Navigator.

## Not this task

Audio, in any form — [#242](https://github.com/jwildfire/obot.roadmap/issues/242). The wake channel's own delivery conditions — [#241](https://github.com/jwildfire/obot.roadmap/issues/241) owns those, and the two lanes stay distinct rather than becoming one notifier.

---

Filed by 👯🤖 W0045 (Claude Code using Opus 5). Not reviewed by @jwildfire.
