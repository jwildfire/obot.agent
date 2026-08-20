<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/279 on 2026-08-20 15:45 EDT -->
<!-- GITHUB_PROPERTIES: Assignee: @me, Base: main -->

He can now answer an open decision out loud, from the car, with no screen in front of him and no identifier in his head — and when the lane cannot tell which decision he meant, it says so rather than picking one.

Closes jwildfire/obot.roadmap#265

## Roadmap context

His constraint, 2026-08-17: *"Remember that I'm mostly listening to these in the car and then maybe dictating a response, so I don't have a screen and I don't expect that I remember any GitHub issue numbers."*

Three decisions are open on him as this lands. Every one of them was unanswerable without reaching a keyboard, which is why a decision he had already made stayed open until he got to one. The audio half of this already exists and has shipped — `save-to-spotify` plus local Kokoro produced three decision episodes on 18 August and he answered all three within two hours. What did not exist was the way back.

Pairs with [jwildfire/obot.roadmap#242](https://github.com/jwildfire/obot.roadmap/issues/242) (the brief read aloud, five minutes, derived from the text) and [jwildfire/obot.roadmap#280](https://github.com/jwildfire/obot.roadmap/issues/280) (an open artifact has an episode he can answer from a car). The dictation close that requirement specifies — *"subject word plus choice, spoken once and repeated slowly, no identifiers of any kind"* — is generated here rather than remembered by whoever writes the next script.

## Evidence

<ul>
<li><b>1,604 tests pass</b> — the whole CI suite, including 62 new ones under <code>tools/voice/test/</code> and 5 under <code>scripts/test/</code>. Every one was seen to fail first.</li>
<li><b>The round trip is asserted, not assumed</b> — <code>speech.test.mjs</code> takes the example sentence the script reads out, hands it to the router unchanged, and requires it to land on the decision it was read out for. If the two ever grow separate vocabularies, that test fails rather than a dictated answer going missing.</li>
<li><b>Run against the real hub</b> — "branch protections, option A" → D0022, verdict <code>Option A</code>. "branch protection option a please" → the same, at 96%. "number two, option A" → D0022 by ordinal. "answer: the thing about the branches" → UNROUTED, kept whole. "a goals page in the hub would be good" → still an idea.</li>
<li><b>Run against the real Reminders list</b> — the automation grant is in place, the list exists, and <code>poll --no-stamp</code> reads it and reports honestly.</li>
<li><b>The public-board guard is tested behaviourally</b> — <code>scripts/test/reminders-answers.test.mjs</code> runs the real script against a stubbed Reminders and a stubbed <code>gh</code> and asserts what <code>gh</code> was and was not asked to do. A grep for the guard would pass whether or not the guard works.</li>
<li><code>python3 scripts/obot-policy validate</code> and <code>python3 scripts/test/policy-sweep</code> both clean.</li>
</ul>

## Technical briefing

**One vocabulary.** `tools/voice/lib/handles.mjs` derives a speakable name for every open decision from its artifact slug — the one string a person already wrote as the decision's name. Names start at two words and grow only when another open decision would answer to the same words, literally or after a transcription has had its way with them. When growing cannot separate two, that is recorded on both and the episode says so out loud. Both consumers read this module and neither keeps a list.

**The asymmetry the design turns on.** An unrouted sentence costs him one repeat. A misrouted one puts his words on a decision he was not talking about, and nothing looks wrong from any surface afterwards — the store shows an answer, the sweep announces it, an agent applies it, and the decision he was answering is still open with nothing on it. So `ambiguous` is a first-class outcome that returns no decision under any score: two candidates within the margin, a handle known to collide, an ordinal against a queue whose fingerprint has moved since the episode, an ordinal past the end, or no snapshot at all. Matching is otherwise deliberately loose — exact, then sounds-the-same, then mostly-the-same-letters, and below a real resemblance zero rather than a small number so noise cannot accumulate into a match.

**It flows through the existing path.** A routed sentence is written by `recordAnswer` into `.claude/ops/answers/`, the same store the dashboard writes to, with his sentence verbatim and a new `channel` field. So the Navigator announcement and the answered-but-unapplied detection that shipped this morning (jwildfire/obot.agent#277, PR jwildfire/obot.agent#278) cover a car answer with no new code, and a test asserts exactly that.

**The receipt is the item.** A receipt he has to open something to read is not one. A routed reminder is stamped with the decision it reached and completed, so the list empties; an unrouted one is stamped with the reason and left there, because completing it would remove the only evidence he has that it failed. Nothing new is ever added to that list.

**The lane that files that list is now fail-closed.** `reminders-to-ideas` posts to a public discussion board, and some of what is on the list is now a decision of his, which is local-only by construction. Every item goes to the router first and only `idea` is posted; if the router cannot be run, the item is left pending rather than posted. The bot token is minted lazily and checked non-empty (obot.agent#207).

**Nothing polled that list.** No LaunchAgent, no cron, and the fold skips it on purpose because `osascript` can stall on a permission prompt. The sweep is now the listener with that objection answered — one runner, a hard timeout, failures reported as failed reads — but the automation grant is his, so it is **off until armed** and the Navigator section says which of three states it is in on every pass. `**VOICE LANE BROKEN**` is spelled for the real `ALARM_RE`, asserted against the imported regex rather than a copy of it.

**Honest degradation.** Twenty-one of the twenty-two decision artifacts carry no `Option A/B/C` cards; their choices live in prose with the pick in a recommendation line. The script has two shapes, says which one it used, and an artifact it could not open produces a sentence saying so rather than a decision read out with nothing in it.

## Next steps

<ul>
<li><code>obot.agent/tools/voice-decisions arm</code> — one command, and the five-minute sweep starts polling. Left to him because the first poll under launchd may raise a macOS automation prompt that only he can answer.</li>
<li>The episodes themselves are still hand-produced. <code>voice-decisions script</code> now generates the words and reports its own length against the five minutes he set; wiring that into <code>save-to-spotify</code> on a schedule is <a href="https://github.com/jwildfire/obot.roadmap/issues/280">jwildfire/obot.roadmap#280</a>.</li>
<li>Per-question answers by voice are out of scope: a spoken answer records a verdict when it names one the page has, and his words verbatim when it does not. Nothing paraphrases him into a cleaner decision.</li>
<li>Board write is still blocked for every agent (<a href="https://github.com/jwildfire/obot.roadmap/issues/252">jwildfire/obot.roadmap#252</a>), so the requirement is not moved on the board by this.</li>
</ul>

---

Drafted by 👯🤖 W0083 using Opus 5.
