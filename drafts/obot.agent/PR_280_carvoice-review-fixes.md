<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/280 on 2026-08-20 16:05 EDT -->
<!-- GITHUB_PROPERTIES: Base: main -->

An adversarial review of the car-voice lane reproduced four ways it could have recorded his words against a decision he was not talking about, and three ways one of his answers could have reached a public discussion board. All are closed, each with a test named after the sentence that broke it.

The lane shipped disarmed, so none of these reached him.

## Roadmap context

Follows jwildfire/obot.agent#279, which closed jwildfire/obot.roadmap#265 — "he answers a decision from the car, by voice, without a screen or an issue number".

The requirement is explicit about which failure matters: *"An answer whose subject word matches nothing must surface as UNROUTED with the text preserved verbatim. Never silently dropped, never quietly filed as an idea."* The module shipped with a header claiming a misroute was impossible. It was not, and four sentences a person would actually say proved it.

## Evidence

<ul>
<li><b>1,652 tests pass</b> — 91 under <code>tools/voice/test/</code>. Every fix has a test that was seen to fail first, named after the sentence that broke it.</li>
<li><b>Verified on the live queue, not a fixture</b>: "No, two weeks is plenty." → idea, not decision two. "No one has asked for that." → idea. "Number one priority: leave branch protections alone." → UNROUTED (ambiguous), naming both. "branch protections, option A" → still D0022 at 100%. "number two, option A" → still D0022 by ordinal.</li>
<li><b>The coverage claim is checked the same way the review checked it</b> — <code>verdictFrom</code>'s body was emptied and 64 tests still passed; with the new tests, gutting it fails two. That check was run, not assumed.</li>
<li><code>obot-policy validate</code> and <code>policy-sweep</code> clean.</li>
</ul>

## Technical briefing

**The four misroutes.**

- `no` was a position marker. "No, two weeks is plenty" resolved to decision two at confidence 1 — and `no` is the most common first word of a dictated answer, with the number after it a quantity in his answer. Markers are now words nobody starts an answer with.
- The position was consulted before any name was scored, so "Number one priority: leave branch protections alone" filed against decision one while naming decision two by its published name. A position and a name that disagree is now the ambiguous case, resolved by a full-sentence scan rather than the head window.
- A filler word that is also a decision's first word was stripped with the rest of the filler, capping "note format" and "decision log" at half a match — unanswerable by the name the episode had just read out, and handed to whichever other decision his answer mentioned. Handle-initial words now survive stripping.
- Positions stopped at ten, so "number eleven" parsed as no position at all and went to the ideas board — which publishes. Any position now parses, in words or digits.
- One name that is a prefix of another made the longer one permanently ambiguous. The fuller name wins when he says all of it; the shorter one still goes to the decision named exactly that.

**The three publication paths.**

- With nothing open, a sentence naming a decision was not an answer to anything, fell through to `idea`, and was posted and completed — the likeliest case being a correction minutes after his last answer was applied. Decisions decided in the last three weeks are matched too, as UNROUTED with the date.
- A registry whose top-level shape changed read as "he has decided everything", making every subsequent answer an idea. A missing `artifacts` array is now a failed read.
- The poll re-reads every uncompleted item every five minutes and leaves ideas alone; nothing drains them. An idea sitting for two days became his answer to a decision published since. **An answer must now post-date the queue he was read** — Reminders carry a creation date, and anything older is left exactly as it is and counted on the page.

**Receipts and readings.** Rename and completion results were discarded, and those two writes are the whole mechanism that stops an item being re-read; a failed one is now an alarm. The unrouted store's read flag was dropped before rendering, so an unreadable directory produced the clean line — a positive claim about his sentences from a failed read. And `private:` was enforced by two rules that disagreed about case and whitespace, so "Private: …" was counted as kept while nothing was kept anywhere; one rule now, beside the routing, refusing to write into a git checkout.

**Coverage.** `verdictFrom` could be emptied with the suite green; the default `osascript` runner was a seam every test routed around; the sweep wiring was untested at both call sites. All three now have assertions that fail when the behaviour is removed.

## Next steps

<ul>
<li>Still one command for him: <code>obot.agent/tools/voice-decisions arm</code>.</li>
<li>Findings the verifiers refuted are not fixed here and are listed in the session notes rather than silently dropped — including the printing of his sentence to stdout, which is the house convention for a local tool.</li>
<li>Two low findings are left standing and named: <code>spawnSync</code>'s timeout does not escalate past SIGTERM, and the unrouted store is read-then-written without a lock. Neither is reachable from one five-minute sweep.</li>
</ul>

---

Drafted by 👯🤖 W0083 using Opus 5.
