<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/165 on 2026-08-17 07:24 BST -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Assignee: none (App bots cannot be assignees), Reviewers: none — standard lane, not an RC -->

## The Navigator tab is the dashboard you described, one period at a time

You asked for the db roadmap view to be a metric-driven dashboard showing trends over a selectable time period, filterable by repo and by goal, and confirmed which view you meant: "db roadmap = navigator page." That is what this is. Each metric is now a tile carrying the count for the period you picked, the change against the period before it, and a bar trend across it; the periods are the five you named; the old five-column table is still there, folded, underneath.

Closes jwildfire/obot.agent#155

## Roadmap context

Requirement [jwildfire/obot.roadmap#227](https://github.com/jwildfire/obot.roadmap/issues/227) (the dashboard's two views, literally), Action 2, task [jwildfire/obot.agent#155](https://github.com/jwildfire/obot.agent/issues/155), under goal [#73](https://github.com/jwildfire/obot.roadmap/issues/73). Action 1 — the Agents tab as a table — is not in this PR.

This builds on what shipped in [#149](https://github.com/jwildfire/obot.agent/pull/149) rather than replacing it: the metrics, the epoch stamps and the typed feed are the foundation, and everything that page carried is still reachable. The hub's published roadmap page is out of scope and is not touched — the diff is eleven files, all under `obot.agent/tools`.

## What changed

- **A period selector, and a trend per metric.** 1, 3, 7, 30 and 365 days, unchanged. Each of the eleven series becomes a stat tile: total, change against the previous complete period, and a bar chart of the period. The five-window table is folded below, because comparing two horizons at once is still the fastest way to do that.
- **Filters for repo and goal, as links.** This page ships no JavaScript, so a dropdown would need a submit button beside it to do anything; links also make a filtered view a URL you can keep or send. Both filters and the period compose, and a name the record does not hold is reported and ignored rather than silently zeroing the page.
- **Goal membership reuses the audit's own walk.** Ancestors at any depth, structural sub-issue links only, cycle-safe — copied from `GOALLESS-REQUIREMENT` deliberately, since a dashboard disagreeing with the check that polices the same question is worse than no filter. Verified in the field: both name only hub#182 as goalless. Chips read `autonomy` and `charts` from the same `goal-slug` comment the published goal pages use.
- **Where measurement begins is drawn on the chart.** The span before a series could record anything is hatched, its boundary ruled, and its date printed under the chart. The twenty-one decisions on record read as three days of a 365-day window rather than as a collapse from an earlier peak. Where the comparison period sits inside that span, the change figure is withheld and says why.
- **Every filtered claim states what it could not attribute.** Only 183 of 341 issues and 88 of 232 pull requests carry a structural goal link; releases and decision artifacts carry none. A goal-filtered page opens by saying so, each tile reports how many of its own class in its own window carry no goal link, and a series the filter cannot answer prints the reason where the number would be — never a zero.

## Evidence

- 479 tests pass across the five CI suites; `obot-policy validate` and `policy-sweep` both clean.
- Verified in a real browser against a live collection, at a 390px viewport and at desktop, in both palettes: no horizontal overflow, eleven tiles in two 178px columns, filter chips wrapping cleanly, hatch and bars legible on the light surface. Tapping a chip moves the URL, repaints the coverage line, and moves every epoch.
- Live collection: 341 issues, 232 PRs, 23 releases, 5 goals, 228 parented issues, 146 PRs with closing links, zero errors, 18s.
- Counts re-derived independently: all 55 tile totals and all 55 table cells match a from-scratch count over the raw record; bucket sums equal tile totals in 1,970 tiles across 240 filtered views; no double counting.
- Zero caption-versus-chart contradictions across all 2,640 tiles (every period × repo × goal combination).

Four defects were found by looking at the page rather than reading the code, and six more by an eighteen-agent adversarial review whose every claim was handed to a second agent told to refute it — fourteen tested, eight refuted, six fixed. The three worth naming:

- The collector reported success while silently dropping 42 of 146 pull-request links. `gh api graphql` exits 0 when the response carries an `errors` array, and a pull request GitHub declined to answer for was recorded as one that closes nothing — while the cache it wrote reported no errors, no bounds and no gaps at all. Found by running it twice and comparing, not by reading it.
- A goal whose slug was null was applied as the active filter by a URL naming no goal, because `find` matched `null === null`. Bare `/navigator` would have rendered every tile as 0.
- The band captioned "before this series could record anything" was floored at the selected goal's creation date — but sub-issue links are granted retroactively, so real bars stood inside it, 38 times.

## Technical briefing

- `tools/navigator/goals.mjs` — the ancestor walk. Four verdicts, not two: `yes`, `other` (a different goal), `none` (walked, no goal — the GOALLESS finding), `unattributable` (nothing to walk). The last two are one fact from where you read and are counted together; they are kept apart here because one is fixable and one is a fact about what GitHub records.
- `tools/navigator/metrics.mjs` — `trendSeries` cuts a period into buckets on a fixed UTC grid, spans exactly the period asked for, and returns a complete-buckets-only pair for the comparison. `collectCloses` is the one new API call, GraphQL, and refuses a degraded answer. Parents come from `parent_issue_url`, already in the response, at no extra cost.
- `tools/ops-dashboard/lib/spark.mjs` — the SVG bar sparkline. No prior art existed for a server-side chart here, so it follows the house conventions the hub's one accessible chart established: colour from CSS tokens only, `role="img"` with an accurate label, and the bucket table as the mandatory fallback and the tap equivalent. Bars are placed and sized by the time they cover, so the year view's one short bucket is not drawn as wide as a week.
- `tools/ops-dashboard/lib/metrics-view.mjs` — the model, the tiles and the filter bar. `clampToData` is the general guard that a band may never claim a span its own series has data in.
- `tools/ops-dashboard/ops-dashboard.mjs` — three lines: the query string reaches the model.

## Next steps

- Merge on the standard lane (`obot-merge`, base `main`, v0.5.0), then pull on the workstation and restart the dashboard — it serves whatever build it started with and says so.
- For up to an hour after the merge the live cache still predates goal links. The page says so where the goal row would be, rather than showing an empty filter.
- Two things I would change after you have looked, neither built here: the goal filter is honest about covering half the record, but the fix is upstream — linking the unparented work, which the discipline checks already list. And Action 1 (the Agents tab as a table sharing the priced feed) is still unstarted.

---

This PR was drafted by 👯🤖 W0020 (Claude Code using Opus 5) and reviewed by @jwildfire; posted by obotclaw[bot].

Worker: W0020
