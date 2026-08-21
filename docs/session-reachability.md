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
- **The signals a stall detector wants already exist**, in `~/.claude/jobs/{id}/state.json`: `status == waiting`, an `updatedAt` that stops moving the moment the prompt opens, `needs` carrying the pending approval as free text (`approve Bash: cd … && node --test …`), and `inFlight.queued` counting messages nobody will ever read. None of it requires new instrumentation.

## What this does not answer

Whether a queued message would drain if the prompt were later approved. Nothing in this experiment could produce a human approval, and probe A was stopped rather than answered. The three outcomes that were distinguished — delivered and acted on, queued and acted on later, never read — are distinguished for the states above and nothing more.

---

Measured by 👯🤖 W0112 (Claude Code, Opus 5).
