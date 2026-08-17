<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/161 on 2026-08-17 06:41 BST -->
<!-- GITHUB_PROPERTIES: Labels: enhancement, Milestone: v0.5.0, Assignee: @me -->

The Agents tab is a table with a filter sidebar, one row per agent, priced from the analytics page's own feed.

Closes #154

## Roadmap context

Requirement [obot.roadmap#227](https://github.com/jwildfire/obot.roadmap/issues/227), Action 1. @jwildfire, 2026-08-17: *"I want the db session manager view to be a table with a sidebar with filters. Each row is an agent. It should share a data feed as the price analytics page."*

That is the third description of this view and the most concrete of the three, which the requirement reads as the finding rather than as a preference: each earlier build improved on the ask instead of meeting it. So this one is literal. A `<table>`, a sidebar of filters, one row per agent, and nothing beside them.

The consequence of taking it literally is that the brief which shipped the night before — headline tiles, the what-changed feed, the running and ended-badly groups — is not above the table. It moved whole to `/session/log`, which the table links, so nothing that shipped is discarded and nothing competes with the thing he asked for.

## What is on the page

**A table.** Six columns — agent, status, cost, closeout verdict, roadmap impact, last active — sorted most expensive first. Every header sorts. Any row opens into the evidence behind it, with every reference still a link, because a row's references are how a claim gets checked and a table cell is not a reason to drop them.

**A sidebar of filters.** Six groups: status, produced, active period, repo touched, closeout verdict, kind. Boxes inside a group are OR, groups are AND. The count beside each option is over the whole roster rather than over the current selection, so it says what ticking it would give you. An option is only offered when something has it — a box that can never match teaches the reader that the filter is decorative, and after that an empty result is indistinguishable from a broken one.

**One row per agent, including the ones that are hard to name.** Subagents roll into the worker that claimed them. Pre-ledger sessions keep their collapsed unattributed row, as the requirement instructs — it sorts last by default whatever it cost, because 147 agents added together is not an agent and ranking a sum against single agents by money puts it at the top of a table whose first question is which agent spent the most.

## The shared feed, which is the load-bearing constraint

It is met by not touching it. The model is `lib/roster.mjs`, unchanged: it reads the priced artifact `obot.roadmap/scripts/build_usage_data.py` writes and computes no price of its own.

The proof is arithmetic rather than assertion — unfiltered, the table's own total reads `$5,249.49`, which is `usage.json`'s `totals.cost` to the cent. Two cost numbers that disagree would be the registry-versus-index failure again, and this time about money.

## Evidence

- <a href="https://github.com/jwildfire/obot.agent/blob/w0019-agents-table/tools/ops-dashboard/lib/roster-table.mjs">`lib/roster-table.mjs`</a> — the facets, the filter groups, the table and its inline script
- <a href="https://github.com/jwildfire/obot.agent/blob/w0019-agents-table/tools/ops-dashboard/test/roster-table.test.mjs">`test/roster-table.test.mjs`</a> — 19 tests, aimed at the failures the page can have while looking fine
- <a href="https://github.com/jwildfire/obot.agent/blob/w0019-agents-table/tools/ops-dashboard/lib/roster.mjs">`lib/roster.mjs`</a> — two additions only: the priced days a cost bucket covers, and each row's active days and last activity, so the date filter is built from the same feed the money is
- <a href="https://github.com/jwildfire/obot.agent/blob/w0019-agents-table/tools/ops-dashboard/README.md">`README.md`</a> — the route table and the tab's section, rewritten to describe what is there

**461 tests pass** (the full CI command across all five tool suites).

**Verified in Chrome, not in the markup.** At 1440px the sidebar sits beside the table and stays put while the table scrolls. At a real 390px viewport, measured in an iframe probe: `documentElement.scrollWidth` is 390 with zero page overflow, the sidebar is one collapsed bar carrying the live count, the table scrolls sideways in a 366px box with the agent column pinned, and the drawer opens and closes. Filtering, sorting and row expansion were driven live — `status=died` gives 7 rows and `$58.74`, adding `running` gives 16 and `$169.69`, adding `repo=obot.agent` narrows to 1, clear restores every row, and `Today` resolves to a server-side cutoff of `2026-08-17`. No console errors.

**Two defects were caught by looking at the page, and both have a test.** The filter groups were typed `check`, which is not an input type, so every checkbox rendered as a text field with its own value typed into it — nothing threw, and the page had silently stopped being a filter. And a long agent name ran out of the pinned column and over the status beside it, because the roster's own `.ag-id` sets `white-space:nowrap` and `overflow-wrap` cannot break a line that is not allowed to break at all.

**@jwildfire's dashboard on port 7326 was never touched.** The preview was a static render served from a scratch directory on port 7391, so no second instance could take the port or steal the serve marker ([#142](https://github.com/jwildfire/obot.agent/issues/142)).

## Tech briefing

`lib/roster-table.mjs` is a new renderer over the existing model, in the shape `roster-view.mjs` established: `facetsOf(row)` classifies, `buildFilters(rows)` tallies, `agentsTableHtml(model)` renders. `kindOf` is imported from `roster-view.mjs` rather than reimplemented, so there is one classifier and the two renderings cannot disagree about what a standing session is.

Facets are multi-valued where the truth is: an agent that moved a requirement and merged a pull request answers both filters. Forcing it into one bucket is how a filtered list starts under-reporting the agents that did the most, which is the same failure grouping by worker id would have caused in the other direction.

The narrow-screen answer for the sidebar is a decision rather than a reflow. It is the same `<details>` element at every width — script opens it above 60rem and leaves it closed below — so there is one code path and one behaviour to explain. A media query that drops a sidebar under the content puts a screenful of checkboxes between him and the table he came for.

Two fields were added to `roster.mjs` and nothing else changed there: `cost.days` (the priced days a bucket covers) and, per row, `days` and `lastAt` unioned across the usage feed and the job records. Neither record alone is complete — a worker that started at 22:48 and ran to 04:03 has its money on one date and its job activity on the next — and that mismatch has already produced one wrong roster once.

## What I would change, having built it literally

Four things, in the order I would do them. None is in this PR.

1. **Refresh the priced feed more than once a day.** This is the real one, and the table makes it impossible to miss where the brief hid it: 22 of 39 rows read `unpriced` right now, because `build_usage_data.py` runs only during `/session-wrapup` and the artifact is 22 hours old. Over half of the cost column — the column this page exists for — is empty for the reason that the feed is refreshed by hand. Running it on the five-minute sweep would fix the table without changing a line of it.
2. **Give the sidebar a text box.** With 39 rows and more every night, the fastest filter is typing `W0019` or `d0003`. It is about eight lines. I left it out because it is not among the filters he named and the instruction was to stop improving on the ask — but it is the first thing I would add if he wants it.
3. **Make the filters survive a reload.** This is a live page he refreshes; three ticked boxes are lost every time. Reflecting the selection in the URL would also make a filtered view something he can send: here are the four agents that drifted.
4. **Stop the pre-ledger row pretending to be a row.** It sits in the same grid as single agents while standing for 147 of them and carrying the largest number on the page. The requirement is explicit that it stays, and it should — but it should look like a bucket rather than like an agent.

One thing I deliberately did not do: a cost-per-outcome column. "Did this agent earn its tokens" is a ratio, not a total, and the table only answers half of it. But worker ids are two days old and the delivery record is younger, so a returns metric computed over this window would be a lie with a slope — the requirement's own warning about trend lines, applied to a ratio.

## Next steps

- Restart the dashboard to see it: `pkill -f 'ops-dashboard.mjs --serve'`, then `/session-dashboard`. Kill before relaunch and never overlap ([#142](https://github.com/jwildfire/obot.agent/issues/142)).
- Action 2 of the requirement — the Navigator tab as a metrics dashboard with a period selector and repo/goal filters — is unfiled and unclaimed. The period list here (`PERIODS` in `lib/roster-table.mjs`) already uses the 1/3/7/30 vocabulary that action needs, so the two views will not each invent their own word for a week.

---

This PR was drafted by 👯🤖 W0019 (Claude Code using Opus 5) and reviewed by @jwildfire.
