<!-- STATUS: Posted to https://github.com/jwildfire/obot.roadmap/issues/297 on 2026-08-21 00:36 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: 2026q3, Labels: requirement, Assignee: @me -->

### Business Requirement

@jwildfire, 2026-08-21: *"I'd like you to make me a page visualizing the high priority and top 10 requirements with cards. include an option to animate how it has changed over time."*

He can read the ranked head today in two places, and neither is the shape he asked for: the Operations Dashboard prints it as a list at the bottom of the queue, and the Navigator sweep prints it as text in a state file. Both show only the order as it stands right now. Nothing anywhere shows how the ranking has MOVED — which is the part that carries the argument, because the moves are where prime's reasoning is written down.

Success is a page he can open on his phone that shows both tiers as cards, and that will replay the re-ranking on request while being honest that the record it is replaying is one day deep.

### Overview

One generated page, published to the hub where he reads, built by `tools/rankviz/build.mjs` in `jwildfire/obot.agent`.

There is no `high priority` label. He asked for one on 2026-08-19 and then said *"Let's just make a 'top10' label for those requirements"*, and the second replaced the first. So "high priority and top 10" is one population in two tiers — `top10`, the ranked head, and `on-deck`, the bench — and the page builds those two and invents no third.

- Cards for both tiers, visually distinct: the head carries a rank and its one-line reason, the bench carries neither because it is unranked by design.
- Title, state, milestone, blocked and sub-issue progress are derived from GitHub at build time rather than written into the page. The join is `joinRank` from `tools/navigator/rank.mjs` — the same function the sweep and the dashboard use — so the three surfaces cannot disagree about what the ten are.
- The animation is an option, not the default: he lands on today's state and opens a player to watch it move.
- Each frame is one commit against `rank/top10.json`, with the store's bytes at that commit asked for directly rather than replayed from a patch.

The hard part is honesty rather than rendering. The ranked order goes back to a single commit on 2026-08-20 at 12:39, so the page states that span in the masthead, draws the commits to scale on a rail that stops where the record stops, steps the scrubber by commit while saying it is not a time axis, and prints a frame's own failure text instead of an interpolated order when a frame cannot be rebuilt.

### Data Requirement

**Required sources:**

- `rank/top10.json` in `jwildfire/obot.agent` — the declared order and the one-line reason per item. Order only; a test fails on any other key.
- The `top10` and `on-deck` labels on `jwildfire/obot.roadmap` — membership, one API call each.
- `git log` / `git show` over `rank/top10.json` — the history of the order. Six commits, all on 2026-08-20.
- GitHub `labeled` / `unlabeled` issue events for the two labels — the membership record, which reaches back to 2026-08-18 21:32 EDT and is the only part of the page that extends past the store's first commit.

**Availability status:** Confirmed — all four read cleanly on 2026-08-21.

### Design

Self-contained HTML at `reports/ranked-head/` on the hub, generated rather than hand-written, dressed in the shared stylesheet `assets/obot.css` (obot.agent#15) with page-local layout only.

**Affected repos:** `jwildfire/obot.agent` (the generator and its tests), `jwildfire/obot.roadmap` (the published page).

The honesty contract, which is the design:

- The true span is stated in words in the masthead and drawn to scale on a rail that ends at the last commit.
- The scrubber steps by commit and says so; the rails are the only thing on the page drawn against time.
- Reversals are found across the whole record and named as reversals, with both ends and the commit subject at each. #260 was benched at 19:41 and restored at 21:41 the same evening; the page shows that as a return rather than smoothing it.
- A frame that cannot be rebuilt from its commit prints its reason, draws nothing in its place, and leaves the transitions across it blank. The reversal search reports how many frames it could not read.
- A field GitHub did not answer for prints as unanswered rather than blank.

### Tasks

- [ ] `tools/rankviz/` — history reconstruction, membership replay, GitHub derivation, renderer, and the tests behind them — jwildfire/obot.agent
- [ ] `reports/ranked-head/` — the published page and its README — jwildfire/obot.roadmap

---

Authored by: 👯🤖 W0101 (Claude Code, Opus 5)
Approved by: EMPTY
