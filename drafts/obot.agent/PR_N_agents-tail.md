<!-- STATUS: Drafted on 2026-08-17 20:35 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->

The Agents tab now says what every agent is doing, and every date on it turns over at his midnight rather than UTC's.

Closes #178
Closes #179
Closes #174

Two asks from the same morning, done in one pass because they land on the same cells. Built by 👯🤖 W0036.

## What changed, in the row

The table used to answer "what is this agent" and leave "what is it doing" to a view he had to leave the page for. It now carries a task tag under 100 characters, and the two columns that were answering a different question — Roadmap impact and the closeout verdict — moved into the expansion.

- A live agent's tag is the harness job record's line for this minute. That is the same field `claude agents` renders, which is why that view read better than this one did.
- A finished agent's tag is the delivery record's produced line, written at closeout by the Navigator and checked against GitHub — what it did, rather than what it said it did.
- Failing that, the closeout line the agent wrote itself. Failing that, the one-line task on its worker-ledger claim.
- A chip in front of each tag says which of those is being read, because "doing now" and "did" are different questions to put in one column.
- Never the worker slug. `mergegate` and `landseven` are addresses, not descriptions.
- Nothing is inferred. A row no record describes shows a dash and says why on expand, because a plausible tag describing the wrong thing is worse than a blank one.

On the live roster that is 54 rows, 52 tagged, longest tag 99 characters, and both blanks honest — a probe and a fleet session that died on the transport with nothing else recorded.

## What changed, in the dates

Every date was a UTC day, so between midnight and 01:00 local a row read as yesterday — and the rows it misdated were the overnight ones this page exists to report on. There is now one day boundary, his, applied to every date, every time and every period cutoff.

- Created and Last active each carry a clock under the date. Stacked rather than beside, so the column is exactly as wide as it was and the 390px cost of the change is nothing.
- The zone is stated, not implied: both column headers carry the offset and the foot note names the zone. Read at render — this machine's own offset moved from +01:00 to -04:00 inside one day of the ledger this reads.
- Absolute, never "12m ago". This is a static render and a relative time is true only at the instant it is written.
- Unknown stays unknown. A row neither record dates gains no plausible time.

## Roadmap context

- Requirement [obot.agent#178](https://github.com/jwildfire/obot.agent/issues/178) — times on Created and Last active, and one local day boundary. Closes [#174](https://github.com/jwildfire/obot.agent/issues/174).
- Requirement [obot.agent#179](https://github.com/jwildfire/obot.agent/issues/179) — a task tag in the row, a summary on expand, Roadmap impact demoted.
- Both under milestone v0.5.0, both his own words from 2026-08-17.
- Parent requirement [obot.roadmap#227](https://github.com/jwildfire/obot.roadmap/issues/227), the Agents tab as a table with a filter sidebar.

## Evidence

- 702 tests pass across the CI suite, 25 of them new.
- Verified in Chrome against the live roster at a real 386px viewport and at desktop width: no page-level horizontal overflow, the table scrolls inside its own box with the agent column pinned, and the task tag is readable at 390px without a sideways swipe.
- Expand verified at 386px: the evidence list fits the viewport and the page does not overflow after opening a row.
- Verified on a test server on port 7411. His dashboard on 7326 was not restarted or touched.

## Technical briefing

### obot.agent#177 was filtered, not fixed

The sibling briefing's opening HTML comment lands in the job status detail on sixteen entries across ten jobs, and it is not inert — one of them re-asserted `blocked` forty-five seconds before a clean closeout. The Agents tab needs a filter regardless of what happens to the template, because a template fix cannot reach entries already on disk. So `cleanDetail` refuses text that is structurally a comment, an unfilled placeholder, a markdown heading, or the bare state word, and the tag falls through to the next authored source. The root fix stays open on [#177](https://github.com/jwildfire/obot.agent/issues/177) for the spawn lane.

### The two-clock trap, and where it bit again

The worker ledger writes local time with an offset and the harness writes UTC. Both go through `Date.parse` and neither is sliced out of its characters; the existing test that holds that shut is untouched and three more were added around it.

It then bit one level up, and only the live render found it. The priced usage feed counts UTC days and keeps no instants, so preferring its day whenever it sorted higher as a string put "2026-08-18, no time recorded" against three sessions that were running as the page rendered, on his evening of the 17th. A UTC day string and a local day string cannot answer "later" about each other. The instant now wins whenever there is one, and the priced day is used only when nothing on this machine timed the agent at all.

### A transport failure is not an agent's account of its work

Also found by rendering rather than by reading the diff. The fleet row read "closed out: API Error: Unable to connect to API: SSL certificate hostname mismatch" under a chip saying that was what the agent finished. The agent finished nothing; a connection failed, and the status column beside it already read `died`. Harness error text is now held apart — never a tag, and surfaced on expand as "ended on", labelled as the harness rather than the agent. The match is anchored at the start of the line so a worker's own closeout sentence naming an error it fixed survives.

### Cost stays in the row, the verdict expands

He named only Roadmap impact. The principle under it — the row says what a thing is and what it is doing, everything else expands — was applied to the closeout verdict too, and deliberately not to Cost.

- The verdict is the delivery record's judgement of the very references the impact column listed. Split across a row and its expansion they were one concept in two places, and a Confirmed chip with nothing beside it to confirm is not a fact anyone can act on. Both stay filters in the sidebar, which is a better place to ask either question across the whole roster than a column of chips.
- Cost stays. It is the number this page exists to reconcile against the hub's analytics page, it is six characters wide, and it is read against the Model column beside it — which is the only way the allocation grant is checkable at all.

### One line outside the two issues

`roster-view.mjs` gained one changed string. The fleet role's `resting` text is rendered as a task tag now and was 101 characters, so it shipped clipped by one word. The replacement is 👯🤖 W0038's own text, agreed ahead of its rename in #182, so that rebase carries one line rather than a conflict. A test now enforces the ceiling for every standing role rather than trusting it — W0038's suggestion, and worth more than the message that raised it.

## Next steps

- The root fix for #177 stays open for the spawn lane.
- The dispatch convention is worth making explicit: 33 of 50 ledger claims carry a task line, and the 17 that do not are exactly the rows that fall back furthest. A brief that always carries one costs a line and makes the tag authored for every worker.
- 👯🤖 W0038 (#182, fleet → admiral) and 👯🤖 W0037 (#180/#181) both touch this area and both agreed to rebase on top of this.

---

This PR was drafted by 👯🤖 W0036 (Claude Code using Opus 5) and reviewed by @jwildfire.
