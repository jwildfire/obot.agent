# voice — he answers an open decision from the car

@jwildfire, 2026-08-17:

> *"Remember that I'm mostly listening to these in the car and then maybe dictating a
> response, so I don't have a screen and I don't expect that I remember any GitHub issue
> numbers."*

Requirement: [obot.roadmap#265](https://github.com/jwildfire/obot.roadmap/issues/265).

Two halves, one vocabulary between them, and one command:

```
obot.agent/tools/voice-decisions script     # the narration an episode reads out
obot.agent/tools/voice-decisions poll       # what he said, routed back
```

And, above both of them, the standing property that decides when an episode gets made at
all — [obot.roadmap#280](https://github.com/jwildfire/obot.roadmap/issues/280):

```
obot.agent/tools/voice-decisions episodes             # which open decisions are owed one
obot.agent/tools/voice-decisions episode <handle>     # the shape and the close for one
obot.agent/tools/voice-decisions episode-record …     # what shipped, and what it was made from
```

## The out half

`script` renders every open decision as speech. Each one is named the way a person
would name it — "branch protections", never `D0022` and never `#272` — its choices are
stated so they can be said back, and the last thing he hears is exactly what to say.

It writes the queue snapshot as it goes. That is deliberate: **the moment the words are
read out is the moment they become the vocabulary**, so there is no second list for the
router to consult and nothing to keep in sync. `tools/voice/test/speech.test.mjs`
round-trips the example sentence the script reads out through the router and requires
it to land on the decision it was read out for.

The text is plain — no markdown, no URLs, no identifiers, nothing a synthesiser would
read as a symbol — because the reader is Kokoro via `save-to-spotify`, whose input is
plain text with no SSML anywhere in it. It reports its own length against the five
minutes he set (#242) rather than leaving that to whoever renders it.

Twenty-one of the twenty-two decision artifacts have no `Option A/B/C` cards; their
choices live in prose with the pick in a recommendation line. So there are two shapes,
the script says which one it used, and an artifact it could not open produces a sentence
saying so rather than a decision read out with nothing in it.

## The standing property: an open decision HAS an episode

`script` reads the whole queue out in one sitting. That is a queue read-out; an episode is
per artifact, and the three he answered from a car on 2026-08-18 were per artifact.

The requirement is not "make episodes for the open ones" — that produced nothing on the day
it was written and would produce nothing next week either. It is that an open decision
artifact HAS an episode: one is published, an episode follows, he answers, it stops
mattering. So `episodeCoverage` in `lib/episodes.mjs` makes it a **condition the sweep
detects every five minutes**, in exactly the way a closed requirement with no closure
summary already is, and `safeEpisodes` in `tools/navigator/sweep.mjs` renders it on his
page — verdict on an unindented line, spelled for the real `ALARM_RE`, clean line printed
when nothing is owed so the section cannot be confused with a dead one.

An episode is *current* while a fingerprint of its artifact's **spoken text** — the page
with the markup taken off — still matches what was recorded when it shipped. Restyling a
page is not a correction; a reworded sentence is. What happens when it does go stale is
`CORRECTION_POLICY`, stated in one place and taken from
[hub#266](https://github.com/jwildfire/obot.roadmap/issues/266) rather than invented here:
the shipped episode stays up because he may already have heard it, the decision goes back
to owing one, and the fresh episode opens with a correction he can hear.

Writing one is `EPISODE-BRIEF.md`, next to this file. Rendering one is `render.py`, which
is in the repository because the first three episodes were rendered by a script that lived
only in a job's scratch directory.

Two things this cannot see, and says so rather than reporting them as "nothing owed":

- **A hub clone behind its remote.** Nothing on this machine pulls it — the five-minute
  self-update fast-forwards the harness checkout and nothing else — so a decision published
  an hour ago can be invisible rather than absent. The section prints how far behind it is.
- **A decision he has already answered that nobody applied.** Its page still says open, so
  its episode is genuinely current against the page it was made from. The staleness lives
  one layer up, in the artifact, which is hub#266's half of the problem and not this one's.

## The back half

He dictates into the Apple Reminders list named `obot` — the list Siri reaches
hands-free from CarPlay, and the one `scripts/reminders-to-ideas` has read since July.
Every sentence on it now goes to the router first, and only what comes back as `idea` is
posted to the public board. That order is not a preference: his verbatim decision is
local-only, and the board is public.

Four destinations and no fifth:

| | what happens | what he sees without a screen |
|---|---|---|
| `answer` | recorded in `.claude/ops/answers/`, the same store his dashboard writes to | the item is stamped and completed — the list empties |
| `unrouted` | kept whole in `.claude/ops/voice/unrouted/` | the item is stamped and **left on the list** |
| `idea` | untouched, filed by `reminders-to-ideas` as always | it becomes a hub discussion |
| `private:` | untouched, local inbox as always | nothing leaves the machine |

Because a routed answer becomes an ordinary record in the answer store, everything built
around that store covers a car answer for free: the Navigator announces it, and the
answered-but-unapplied detection shipped for [hub#241](https://github.com/jwildfire/obot.roadmap/issues/241)
flags it if nobody acts.

## The whole design turns on one asymmetry

An **unrouted** sentence costs him one repeat. A **misrouted** one puts his words on a
decision he was not talking about — and nothing looks wrong afterwards: the store shows
an answer, the sweep announces it, an agent applies it, and the decision he was actually
answering is still open with nothing on it.

So every close call is refused, and refusing is loud:

- **Ambiguous** returns no decision under any score. Two open decisions that fit
  equally, a handle the vocabulary already knows sounds like another one, an ordinal
  against a queue that has moved since the episode — all refused with the reason.
- **Unsure** — one candidate, not close enough — is refused the same way.
- A sentence that **declares** an answer ("answer: …") and matches nothing can never
  fall through to the idea queue. It is UNROUTED, because that is a loss.
- The **receipt is the item itself**. A routed sentence leaves the list; an unrouted one
  stays on it wearing the reason. Asking Siri what is on the list is the confirmation,
  and it needs no screen. Nothing new is ever added to that list — it is his voice-note
  inbox, and stamping a note he wrote is not the same as filing into it.

## What a review found, and what each fix is

The lane was reviewed adversarially before anyone armed it, with every finding required
to be reproduced rather than argued. Four of them would have answered the wrong decision
or published one of his answers, so the guards that came out of them are the load-bearing
part of this module and each has a test named after the sentence that broke it:

| what broke it | what it did | the rule now |
|---|---|---|
| "No, two weeks is plenty" | `no` was a position marker, so a refusal was filed as an answer to decision two at full confidence | markers are words nobody starts an answer with |
| "Number one priority: leave branch protections alone" | the position was consulted before any name was scored | a position and a name that disagree is the ambiguous case |
| "note format", "decision log" | the first word was stripped as filler, halving the score of the decision's own name | a filler word that is a handle's first word is never stripped |
| "number eleven" | there was no word for the eleventh position, so it went to the ideas board | any position, in words or digits |
| an idea sitting on the list for two days | a decision published later matched it and it became his answer to it | an answer must post-date the queue he was read |
| a sentence about a decision decided yesterday | nothing open, so it was an idea, so it was published | recently decided decisions match too, as UNROUTED |
| a registry whose shape changed | read as "he has decided everything", so every answer was an idea | a missing `artifacts` array is a failed read |
| a rename that failed | the receipt never happened and the item repeated every five minutes | write results are checked and reported |
| an unreadable unrouted store | rendered the same line as a clean lane | the read flag is carried into the section |
| "Private: …" with a capital P | two rules disagreed; counted as kept, written nowhere | one rule, beside the routing, refusing a checkout |

## Matching, and why it is loose

Transcription mangles words, so a handle that has to be said perfectly is a handle he
cannot use at 70mph. Matching is per-token and fuzzy: exact, then sounds-the-same
(`protection` for `protections`), then mostly-the-same-letters, and below a real
resemblance, zero rather than a small number so noise cannot accumulate into a match.

Handles start at two words and grow only when another open decision would answer to the
same words — literally, or after a transcription has had its way with them. When growing
cannot separate two, that is recorded on both and the episode says so out loud; the
router then refuses to resolve either by name, and he uses the number.

## Arming

Nothing has ever polled that Reminders list — no LaunchAgent, no cron, and the idea fold
skips it on purpose because `osascript` can stall on a permission prompt. That objection
is answered rather than argued with: every call goes through one runner with a hard
timeout and a failure comes back as a failed read.

But the automation grant is his, so the lane is **off until armed** and the Navigator
sweep says which state it is in on every pass:

```
obot.agent/tools/voice-decisions arm       # the sweep polls every five minutes
obot.agent/tools/voice-decisions armed     # exit 0 armed, 1 not
obot.agent/tools/voice-decisions disarm
```

## Files

| | |
|---|---|
| `lib/handles.mjs` | the vocabulary: open decisions → speakable names, ordinals, collisions, the queue fingerprint |
| `lib/match.mjs` | fuzzy matching, and the three ways it refuses |
| `lib/artifact.mjs` | reading a decision page for its options and recommendations, degrading honestly |
| `lib/speech.mjs` | the narration and the close that tells him what to say |
| `lib/route.mjs` | the four destinations, the unrouted store, the Navigator section |
| `lib/reminders.mjs` | the Reminders door, bounded, and the stamp that is his receipt |
| `lib/armed.mjs` | whether anything is polling, default off |
| `../voice-decisions` | the CLI |

Everything written is under `.claude/ops/`, which is local-only by construction: it holds
his verbatim words and is never committed or published.
