# Writing a decision episode

The standing brief for whoever the sweep sends here. Requirement:
[jwildfire/obot.roadmap#280](https://github.com/jwildfire/obot.roadmap/issues/280).

You are here because `obot.agent/tools/voice-decisions episodes` reported a gap: an open
decision artifact with no current episode. The property is that an open decision HAS one —
not that somebody runs a batch when they think of it.

## Why this exists at all, in his behaviour rather than in an argument

Three decision episodes went out on 2026-08-18. All three came back answered within about
two hours, dictated from a car. In each case he answered questions the episode RAISED, not
questions he had gone looking for; one of them had sat unanswered since 16 August.

## The four properties, and what each one costs you

**Length follows the guideline he set.** Five minutes, longer only when the decision
genuinely needs it — and the episode says why, out loud, near the top. He granted the
exception in the same sentence that set the number: *"5 minutes or less is the guideline,
though you can go over on critical items."*

Five minutes is about **880 words**, not 750. That number was wrong in this repo until
2026-08-20 (`speech.mjs` assumed 150 words per minute; Kokoro reads at about 176), so
scripts were being cut to fit a bound they were already inside. `render.py` prints the
measured rate on every run — check it against what you assumed.

**The dictation close is part of the episode, not an extra.** Subject word plus choice,
spoken once and repeated slowly, with **no identifiers of any kind**. No decision id, no
issue number, no URL, no slug, no date he would have to hold in his head. He has said
twice that he will not have a screen. `voice-decisions episode <handle>` generates a close
that is mechanically correct and round-trips through the router that has to recognise his
answer; take it from there rather than composing your own, because
[#265](https://github.com/jwildfire/obot.roadmap/issues/265) is explicit that whatever the
scripts tell him to say IS the vocabulary, and a second list is the two-sources-of-truth
defect that cost ten decisions their state.

**Read the artifact, not a summary of it.** Every claim checked against the page or against
GitHub. This is not a quality nicety: audio is the one format where he cannot see the
source, so an error you inherit from a briefing reaches him with nothing to check it
against. On 2026-08-18 the SafetyCensus episode caught its own artifact's central premise
being sixteen minutes stale, and that catch happened only because the writer read the page.
Expect to find something; report it whether or not you find it.

**The episode must not outlive the truth it was derived from.** See below.

## What happens when the artifact is corrected afterwards

`CORRECTION_POLICY` in `lib/episodes.mjs` is the single statement of this, and it is
[#266](https://github.com/jwildfire/obot.roadmap/issues/266)'s rule for the page carried
into audio — *"a published artifact he may already have read gets a correction he can see,
not a quiet replacement"* — where "see" is "hear":

- The shipped episode **stays up**. He may already have heard it, and nothing here removes
  what he has heard. Spotify metadata is immutable after creation anyway, so a "fix" would
  mean deleting an episode, which needs his approval and is the wrong instinct regardless.
- The decision **goes back to owing an episode**. `episodeCoverage` reports it as `stale`,
  which is a gap, and the sweep says so every five minutes until a fresh one is recorded.
- The fresh episode **opens with the correction, spoken**: what changed, and that an
  earlier one may have been listened to. Do not open as though the first one never existed.

Staleness is detected by fingerprinting the artifact's *spoken text* — the page with its
markup stripped — so restyling a page does not cry wolf, and a reworded sentence does.

## The sequence

Check the spend guard before a long run: `obot.agent/tools/spend-guard check`. Synthesis is
local and free; the writing is what costs.

```bash
# 1. What is owed
obot.agent/tools/voice-decisions episodes

# 2. The shape and the close for one of them — writes nothing, and deliberately does not
#    stamp the queue snapshot (a one-item snapshot breaks ordinals from earlier episodes)
obot.agent/tools/voice-decisions episode 'branch protections'

# 3. Write the script yourself, from the artifact page. Plain text. Blank line between
#    paragraphs — that is the synthesiser's chunk boundary. No markdown, no URLs, no
#    identifiers, no em dashes. Keep the generated close.

# 4. Render (local, offline, ~1 min for a 5-minute episode)
/Users/jwildfire/.config/save-to-spotify/kokoro-env/bin/python3 \
  obot.agent/tools/voice/render.py script.txt episode.mp3

# 5. Publish to his private show
save-to-spotify --json episodes create \
  --title 'Decision: branch protections' \
  --file episode.mp3 \
  --show-id spotify:show:1knemFC9f42HMOrUq3YEfw \
  --summary '<two sentences, ending in the exact phrases he can say back>'

# 6. Record it, or the sweep will report the gap forever
obot.agent/tools/voice-decisions episode-record --id D0022 \
  --uri spotify:episode:... --title 'Decision: branch protections' \
  --words 699 --minutes 4.0 --script <path> --by W0000
```

## The traps, all of them paid for once already

- **`--json` goes before the subcommand**, not after.
- **Never pipe `2>&1` into a JSON parser.** A banner on stderr makes a successful response
  unparseable. On 2026-08-18 that is exactly what happened, the agent retried, and the
  first upload had already succeeded — two duplicate episodes had to be deleted. **Before
  any retry, list the episodes and check whether the first one landed.**
- **Extract the uri with `grep -oE 'spotify:episode:[A-Za-z0-9]+'`.** `jq` is not installed
  on this machine, so the skill's copy-paste snippets do not run as written.
- **Cover images are the shakiest step.** Pillow is not installed anywhere, and an
  ffmpeg-generated JPEG got a 503 from the image endpoint on 2026-08-18. Try `--image` once
  and, on any image error, re-issue without it. All three published decision episodes have
  no cover of their own and the show's own artwork carries them.
- **Episode metadata is immutable after creation.** A wrong title means delete and
  re-create, which means asking him. Get the title right: `Decision: <the handle>`, never
  an identifier.
- **The hub clone can be behind.** `voice-decisions episodes` says so when it is, because a
  decision published since the last fetch is invisible rather than absent — which reads as
  "nothing is owed". The checkout sweep fast-forwards it every five minutes.

## Shape that worked

Stakes-first opening sentence → only the context that changes the answer → the options with
the recommendation and why that one → the cost of each path, including the cost of not
deciding → what happens the moment he answers → the dictation close, said once and then
repeated slowly, with an escape hatch for answering in his own words.

Short sentences, one idea each. Numbers rounded and rare. No "welcome to", no "in summary",
no recap. He is deciding, not learning: the episode exists so that he arrives at the
question already knowing which way he leans.
