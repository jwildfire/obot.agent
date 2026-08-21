# The constraint ledger

What @jwildfire actually said, recorded where the judging happens. Requirement
[obot.roadmap#267](https://github.com/jwildfire/obot.roadmap/issues/267), task
[obot.agent#293](https://github.com/jwildfire/obot.agent/issues/293).

## The failure, measured

On 2026-08-18 the Navigator objected twice, on the record, that three audio episodes ran
over @jwildfire's five-minute maximum. Two of the three did. The objection was wrong,
because he had granted the exception in the same sentence that set the number:

> "5 minutes or less is the guideline, though you can go over on critical items."

All five numbers in question were his. 🎩🤖 prime had the message; the Navigator did not.
The withdrawal is `n0220` in `.claude/session-hub/delivery.md`.

Constraints arrive in chat, with the concierge. Work arrives in the queue, with the
Navigator. The party that knows the exception is not the party doing the judging, and
nothing carried one to the other — so this is a class of wrong verdict that is structurally
likely rather than accidental.

The same gap runs sideways, recorded as call `n0233`: a worker cannot see what its siblings
were dispatched to do. Three collisions in one week, all on 2026-08-18 — two workers writing
a correction on the same decision page, a worker dispatched at an incident prime had fixed
four hours earlier, and a staged-file sweep that put a false attribution on `main` which
cannot be rewritten ([#289](https://github.com/jwildfire/obot.agent/issues/289)). The
constraint a worker most needs is often not a rule but a fact: *someone else is already
doing this*. That is knowable at dispatch and known by exactly one party.

## The dangerous failure mode, and the design against it

Neither wrong verdict is the thing to be afraid of. An objection that turns out wrong twice
teaches the judge to stop objecting, and the check this role exists to run then degrades
quietly — because a silent judge and a satisfied one look identical from outside.

Three things in this design exist for that and nothing else:

- **`--against none` is a first-class answer.** A judge that cannot find a constraint behind
  its own objection must still be able to record the judgment. The alternative is a tool
  that refuses, and a judge with no way to speak is precisely the silent judge. Declining to
  cite is written on the line, so it is visible rather than indistinguishable from
  agreement.
- **`last cited` is printed for every constraint, every sweep, and alarms about nothing.** A
  constraint nobody has cited in a week of judging proves nothing on its own. It is also the
  only visible symptom this machine has that the check is decaying.
- **The section renders every pass, clean or not.** A section that appears only when
  something is wrong is indistinguishable from one that has stopped running.

## What is writable, and what is not

The test is narrow and it is enforced by the tool rather than stated in prose: **did he set
a bound, grant an exception, or forbid something.** Three kinds — `bound`, `grant`,
`forbid` — and nothing else is accepted. His conversation is not an input to this ledger. A
channel that carries everything carries nothing, and nothing from his chat that is not a
constraint reaches any surface.

## A bound and its exception are one record

`constraint-log add` REFUSES a quote that hedges — *though*, *unless*, *except*, *you can go
over* — with no `--exception` recorded:

```
constraint-log: REFUSED — the quote hedges ("though") and no exception is recorded with it.
Half of that sentence was worse than neither half …
```

Holding only "5 minutes or less" produced an objection. Holding neither half would have
produced a question. So half a sentence is not a writable state — the only version of "they
travel together" that survives a tired agent at three in the morning.

## The commands

```bash
# the concierge, in the same turn he says it
constraint-log add --kind bound --scope hub#242 --heard chat \
  --said '5 minutes or less is the guideline' \
  --exception 'though you can go over on critical items'

# the dispatcher, before it spawns
worker-id claim --slug audio --task '…' --requirement hub#242
constraint-log brief --worker W0101 --scope hub#242      # → pasted into the briefing

# the judge, at the moment it judges
delivery-log verdict --worker W0101 --produced … --requirement hub#242 \
  --verdict none --against K0001        # or --against none, said out loud

# anybody, read-only; exit 1 on a finding
constraint-log --audit [--since 2026-08-14]
```

## Where it is read

- `navigator-state.md`, section **Constraints in force — his words, where the judging
  happens**, written by the five-minute sweep. This is what the Navigator reads before it
  judges, what prime reads to answer him, and what the Operations Dashboard renders.
- A worker's briefing, under **What you are working under**, filled from
  `constraint-log brief`.
- `delivery-log verdict --against K0003`, which refuses a citation that definitely does not
  resolve and lets the sweep re-check every one that does.

## The findings

| headline | what it means |
|---|---|
| `**UNCITED JUDGMENT FINDING**` | a judgment made against something he said which cites no constraint — the audio case exactly |
| `**HALF A CONSTRAINT FINDING**` | a hedged quote with no exception recorded; only reachable by hand-editing the journal |
| `**DISPATCH OVERLAP FINDING**` | two or more workers in flight under one requirement |
| `**DISPATCH COVERAGE GAP**` | a fleet is running and not one claim says what it is working under, so overlap cannot be checked at all — which is not the same as none |
| `**CONSTRAINT READING BROKEN**` | the record exists and could not be read. Unknown, not clean |

The window opens when the record was ARMED on this machine, never on the day he said the
thing — `K0002` is from 2026-08-04, five days older than any of this. Defaulting to a
constraint's own date would make every judgment ever written a finding on the first sweep, a
list that can only grow, which is the shape of every check this programme has had to retire
(the Navigator's own `n0072`). `--since` re-opens the window deliberately; that is how the
retrospective answer to *"would any verdict this week have been different"* is produced.

## Two things it does not do

- **It does not know that a constraint has expired.** "defer any heavy design or build work
  until next week when my limit resets" was true for two days and false afterwards. Nothing
  here notices that. Expiry is the claim-currency mechanism's question
  ([#264](https://github.com/jwildfire/obot.roadmap/issues/264),
  [#266](https://github.com/jwildfire/obot.roadmap/issues/266)), and a constraint is not a
  premise; record time-bounded instructions in the `--note`, and reread them like any quote.
- **It cannot detect an overlap nobody recorded.** The two claims behind the real collision
  carried a slug and nothing else, so the check reports its coverage — how many in-flight
  workers are placed under a requirement at all — rather than reading silence as clean.

## Local only

The record holds his words. It lives at `.claude/constraints.md` with an append-only
`.claude/constraints.journal` beside it, in the workspace folder that cannot reach a
published site by accident. Nothing here is published anywhere.
