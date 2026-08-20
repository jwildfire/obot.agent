<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/274 on 2026-08-20 -->
<!-- GITHUB_PROPERTIES: Milestone: v0.4.0, Assignee: @me -->

## What this gives him

When something finishes, he now finds out — in a sentence saying what he can do that he could not before, on the page he already reads, without anyone remembering to tell him.

Closes jwildfire/obot.roadmap#257

Two incidents, one missing lane. On 2026-08-18 he asked for an org chart, was told it was being drafted, and the page returned 404 for over a day across a dozen exchanges. On 2026-08-20 four workers finished inside twenty-five minutes and closed five requirements; nothing told him, he noticed the agent count had dropped, asked what had happened, and got a list of issue numbers back.

Neither made a false statement, which is why four days of alarms built for false statements caught neither. The admiral's trigger is a positive problem condition, so a clean finish never launches it. The wake fired three times and its state file read `wake: clear — every worker that stopped has been judged`. The loop ran and closed entirely inside the machine: no hop in that chain ended at a person.

## Roadmap context

- Requirement: [jwildfire/obot.roadmap#257](https://github.com/jwildfire/obot.roadmap/issues/257), rank 2 on the `top10` head, milestone `2026q3`.
- The live spec is the [scope note @jwildfire added on 2026-08-20](https://github.com/jwildfire/obot.roadmap/issues/257#issuecomment-5359155919); the issue body is the original org-chart incident and is also delivered here.
- His words in that exchange: *"I like the summary of the closed items in the top 10, but make them a plain language executive summary instead of a bunch of issue numbers. Make sure that those are passed to you properly (and passed to me) whenever they are created."*
- Sits beside the wake ([hub#212](https://github.com/jwildfire/obot.roadmap/issues/212)), which closed the same gap for failure, and the ranked head ([hub#278](https://github.com/jwildfire/obot.roadmap/issues/278)), whose panel this one sits under.

## Evidence

- Full CI suite: <b>1,517 tests, 0 failures</b> — `node --test` over all six globs, plus `obot-policy validate` (7 repos, 0 warnings) and `policy-sweep` (30 verdicts, identical to baseline).
- <b>The acceptance test the scope note asks for</b>, in `tools/ops-dashboard/test/delivery-acceptance.test.mjs`: a requirement closed by an agent with no human in the loop, then verified by <i>fetching what was actually received</i> — the bytes a live `wake-listen` process printed, and the bytes an HTTP GET of the dashboard returned. Nothing in it asserts that something was sent.
- <b>Both traps the task names, paid rather than assumed.</b> A check that cannot fail is not a check: blanking the dashboard panel turned the two page tests red, and disabling the once-only rule turned the repeat-delivery test red. That second mutation also caught a weak assertion — the original test used a one-hour-old wake line, which the re-wake floor alone would have held, so it now uses three days.
- <b>One real defect found by its own test</b>: `gopher://nowhere/x` contains a slash, fell through to the filesystem branch, and was reported as `not-landed` — an absence asserted by a look that never happened. Fixed, and the honesty rule is now explicit in the code.

## Technical briefing

Four pieces, and the first is what makes the rest structural rather than advisory.

<b>1. A closure carries a sentence at the moment it is created.</b> `tools/landing-log` (with `tools/lib/landing_ledger.py`, sharing the lock/journal/high-water mechanism with the config, worker and delivery ledgers). `closure --issue hub#264 --summary '…'` refuses anything that is not a plain-English summary and prints every reason: under 40 characters, under 8 words, more than a quarter issue-reference tokens, opening with a number, opening with `Closes`, or the issue title verbatim. `#251, #256 and #264 closed` fails four of those.

<b>2. It is a finding when it is missing, not an instruction.</b> `tools/navigator/closures.mjs` compares GitHub's closed hub requirements against the record — off `ORPHAN_QUERY`, which `checks.mjs` already runs once per repo every five minutes, so no new API call and, more importantly, one reader. A closure with no sentence becomes `**CLOSURE SUMMARY GAP**` in `navigator-state.md`, with the command that fixes it. The alarm headlines are asserted against the dashboard's real exported `ALARM_RE` rather than a copy, because a headline that does not match renders as ordinary grey text.

<b>3. It reaches the lead on the channel that already exists.</b> `wake.mjs` gains a `delivered` kind and an `ONCE_KINDS` rule keyed on the wake log itself: every other kind repeats on a floor because the condition persists, but a finish is done and repeating it would teach the reader to ignore the one channel that reaches a person. Completions are budgeted separately from stop-state wakes (5 per run — five is what actually happened on 2026-08-20), so a fleet with three unjudged closeouts cannot starve the delivery.

<b>4. It reaches him.</b> A `Delivered` panel on the Operations Dashboard rail, below the three buckets, read-only and asking nothing. The sentence is the row; the issue number is small print under it. Beneath, only the promises <i>not</i> found where they were meant to land, each with its age and what the fetch actually returned.

<b>And the delivery state from the original body.</b> `landing-log promise --asked '<his words>' --landing <url|issue|path>` records what he asked for and where it should appear; `landing-log check` goes and looks — `curl` for a URL, `gh` for an issue, the filesystem for a path — recording `landed`, `not-landed` or `unchecked`. The third never collapses into the second: a fetch that could not run is not evidence of absence. It is bounded (a handful per run, each re-checked at most twice an hour) so a growing promise list can never hold the five-minute cadence open on the network. A promise unfound after a day becomes `**PROMISE DELIVERY GAP**`.

<b>Honest note on process.</b> `landing_ledger.py` was drafted before its tests; everything after it is test-first, and every check here is additionally proven to fire by a seeded failure or a mutation, which is the stronger claim.

## Next steps

- Merging on the standard lane (`obot.agent/main`, `profile: auto`), then recording this requirement's own closure through the tool it adds — the first real use of the lane.
- The first live sweep will report the five requirements closed on 2026-08-20 as `CLOSURE SUMMARY GAP`. That is correct and is the incident itself surfacing; they are not backfilled here, because writing summaries for work I did not do would hide the thing the requirement asked to be shown.
- Deferred by the requirement's own boundary: the concierge's obligation to close the loop on anything it says is coming is a change to a role's contract and is @jwildfire's call, not this one's.
- Board write not attempted — the obotclaw App gets `FORBIDDEN` on the user-owned board ([hub#252](https://github.com/jwildfire/obot.roadmap/issues/252)), so this requirement's stage is unset for a known reason rather than an oversight.

---

Drafted by 👯🤖 W0080 using Claude Opus 5.
