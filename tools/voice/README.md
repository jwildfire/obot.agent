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
