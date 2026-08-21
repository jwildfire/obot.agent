# Can a session sitting on a permission prompt receive a message?

No. The message is enqueued, never dequeued, and dies with the session.

This was measured on 2026-08-21 for [obot.agent#315](https://github.com/jwildfire/obot.agent/issues/315), after two attempts to unstick worker W0110 — one from the Navigator at 47 minutes, one from prime at 59 — both went unanswered and nobody could say why. It is written down here because "we tried and it seemed not to work" is not a finding, and because the answer decides whether a conversational remedy is worth building at all.

## What was run

Three throwaway sessions were spawned, messaged with `SendMessage`, and read back from their own transcript JSONL (`~/.claude/projects/…/{sessionId}.jsonl`), where a cross-session message appears as a `queue-operation` entry before it reaches the model. The transcript is the evidence, not the sender's return value.

| probe | condition | `status` | `state` | result |
|---|---|---|---|---|
| A | a real permission prompt on the old ten-glob CI test command | `waiting` | `blocked` | `enqueue` at 20:51:13.448Z, **no dequeue ever** |
| B | idle; `blocked` only because a classifier read its prose (`needs input:`, no tool ever called) | `idle` | `blocked` | enqueue → dequeue in **8 ms**, acted on **2.2 s** after the send |
| C | busy mid-tool, not prompting (a 75 s `Bash` call) | `busy` | `working` | enqueue 20:53:06.421Z → dequeue 20:54:11.787Z, acted on at 20:54:18.9Z |

Probe A was then left sitting for a further 13 minutes 18 seconds after the send: still one `enqueue`, zero dequeues, and its last model turn still predated the message. When it was finally stopped, its job record closed with `inFlight.queued: 1` — the message was still in the queue at the moment the session died, and went with it.

## The mechanism, which is one rule

A cross-session message is enqueued unconditionally and drains at the receiver's **next turn boundary**.

- A busy session reaches one when its tool returns. The message is late — 65 seconds, in probe C — but it lands.
- An idle session is already at one. Probe B is the 2026-08-18 case that worked, and it is not evidence about prompting sessions: `blocked` there was a classifier reading prose, not a prompt.
- A prompting session's next turn boundary is the permission decision itself, and only a human produces one. The queue therefore never drains.

No timeout and no auto-decline are involved. Nothing expires. The message simply waits for a turn that never comes.

## What follows from it

- **Every "stop and tell the lead" instruction is unreachable exactly when it applies.** A worker that has already begun waiting cannot be reached, and cannot be told to stop waiting. The remedy for a stall has to be structural — a call site that does not prompt — rather than conversational.
- **The sender gets `success: true` either way.** `SendMessage` returned success for all three probes, including the one whose message was never read. A lead attempting an unstick has no signal that it failed, which is why two of them believed they had tried something. If a conversational lane is kept at all, this is the part to fix first: the send is a false positive by construction.
- **`state` cannot tell a prompting worker from a prose-blocked one.** Both A and B read `state: blocked`. Only `status` separates them — `waiting` against `idle`. Anything that acts on `blocked` alone will conflate a worker that needs a permission decision with one that has merely said it is stuck, and those need opposite responses. It is the same trap the ledger pid set: an inferred field standing in for a measured one.
- **The signals a stall detector wants already exist**, and no new instrumentation is needed — but they are in two files rather than one, and one of them lies. Corrected 2026-08-21 while building the detector ([obot.agent#317](https://github.com/jwildfire/obot.agent/issues/317)); the original bullet placed all four in `state.json`:
  - `status` is in `claude agents --json` and ONLY there. No job record on this machine carries the key — 194 were checked and the count of matches is zero. The live daemon view also carries `waitingFor`, which reads `permission prompt`. The join to the record is on `id`, which is the job directory name.
  - `updatedAt` and `needs` are in `~/.claude/jobs/{id}/state.json`, and both behave as described: the clock stops the moment the prompt opens, and `needs` carries the pending approval as free text.
  - `inFlight.queued` is in the record too, and it reads **nought for exactly the sessions it is about**. The file is rewritten only when the session publishes state and a parked session publishes nothing, so the number frozen there predates the prompt. Measured: a message sent to a parked probe enqueued at 21:48:27.301Z and its record still read `queued: 0` at 21:48:54 and stayed there — it flipped to `1` only when the session was stopped and its record was written one last time, which is the same moment this experiment saw it. The count that is true while it matters comes from the transcript's `queue-operation` entries after the prompt opened, which is what `tools/navigator/stallwatch.mjs` reads.

## What this does not answer

Whether a queued message would drain if the prompt were later approved. Nothing in this experiment could produce a human approval, and probe A was stopped rather than answered. The three outcomes that were distinguished — delivered and acted on, queued and acted on later, never read — are distinguished for the states above and nothing more.

## What was built on it

`tools/navigator/stallwatch.mjs`, on the five-minute sweep ([obot.agent#317](https://github.com/jwildfire/obot.agent/issues/317)). It is keyed on `status` and never on `state`, for the reason three bullets up, and it reports a parked session at three minutes rather than the wake's fifteen — the wake's ten minutes of grace plus five of settling exist to tell a real prompt from a prose misread, and that is the distinction `status` makes for free.

Both probes were reproduced live against it on 2026-08-21, independently of the run above: a parked session was reported with its age, its `needs` verbatim and one undelivered message; a `state: blocked` session whose block came from its own prose was excluded by name and answered a message in **9 ms**, against this experiment's 8.

---

Measured by 👯🤖 W0112 (Claude Code, Opus 5), corrected and extended by 👯🤖 W0113.
