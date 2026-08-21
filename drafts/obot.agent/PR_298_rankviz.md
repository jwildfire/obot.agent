## What this does

He asked for a page tonight: *"I'd like you to make me a page visualizing the high priority and top 10 requirements with cards. include an option to animate how it has changed over time."*

This is the generator behind it. One command produces one self-contained page: the ten carrying `top10` as ranked cards with the one line saying why each sits there, the eleven carrying `on-deck` as bench cards that are unranked and drawn that way, and a player that replays every re-rank there has been.

There is no `high priority` label. He asked for one on 2026-08-19 and then said *"Let's just make a 'top10' label for those requirements"*, and the second replaced the first — so this is one population in two tiers, and nothing here invents a third.

The page is already live: [reports/ranked-head](https://jwildfire.github.io/obot.roadmap/reports/ranked-head/), committed to the hub as `a46abbd`.

Closes jwildfire/obot.roadmap#297

## Roadmap context

Requirement [obot.roadmap#297](https://github.com/jwildfire/obot.roadmap/issues/297), milestone `2026q3`. The mechanism it reads is [#278](https://github.com/jwildfire/obot.roadmap/issues/278) — one declared order, everything else derived.

Before this there were two surfaces showing the ranked head and both showed only the order as it stands right now: the Operations Dashboard panel and the Navigator sweep section. Neither shows how the ranking has moved, which is where prime's reasoning actually lives — the reversals, the promises kept, the slot that opened because something shipped.

## Evidence

- The published page — <https://jwildfire.github.io/obot.roadmap/reports/ranked-head/>
- Its provenance and assumptions — <https://github.com/jwildfire/obot.roadmap/blob/main/reports/ranked-head/README.md>
- The store this reads — <https://github.com/jwildfire/obot.agent/blob/main/rank/top10.json>
- 47 tests, added to the CI glob in `.github/workflows/test.yml`

Read back from the build on 2026-08-21: 10 ranked, 11 on the bench, 6 frames with none unreconstructed, 1 live finding, 10 acts of labelling.

Verified at a real 390px viewport in an iframe probe — 390px inner width, 390px document scrollWidth, no element extending past the rail — with the player both closed and open.

## Technical briefing

`tools/rankviz/`, beside the store it reads.

- `history.mjs` — one frame per commit against `rank/top10.json`. The store's bytes at each commit are asked for directly rather than replayed from a patch: a patch has to be replayed to be understood and a mis-replay produces a plausible order that never existed, while a blob request produces the committed bytes or an error with nothing in between. `parseRank` from `tools/navigator/rank.mjs` is borrowed rather than re-implemented, so there is one definition of what a valid store is.
- `membership.mjs` — GitHub's `labeled`/`unlabeled` events replayed into sets over time. This is the only part of the page that reaches back past the store's first commit.
- `github.mjs` — the derived fields. REST rather than `gh issue list`, because the REST issues endpoint carries `sub_issues_summary`.
- `render.mjs` — the page. `assets/obot.css` is imported and inlined; the local block is layout only and declares no colour.
- `build.mjs` — collect and write. The join is `joinRank` from `tools/navigator/rank.mjs`, so this page, the sweep and the dashboard cannot disagree about what the ten are.

Most of the code is the honesty contract, and so are most of the tests:

- Ranked order goes back to a single commit on 2026-08-20 at 12:39. The masthead states that span in words; the rails are the only thing drawn against time and they stop at the last commit; the scrubber steps by commit and says it is not a time axis.
- A commit whose store will not parse produces a frame with `reconstructed: false` and `order: null`, and the transitions on both sides are `known: false`. The tests assert the hole rather than the fill.
- The reversal search reports how many frames it could not read.
- `labelEvents` pages until it reaches a page carrying none of the wanted labels; a fetch that hits its cap instead is reported as truncated rather than as the beginning of the record. Without that, a page cap produces a start date that is merely where the reading stopped.
- A field GitHub did not answer for prints as unanswered rather than blank.

The bench is listed here and counted in the sweep, deliberately. The sweep reduces it to a number so nothing it prints can read as a recommendation about who gets promoted; this page names it because he asked to see it.

Every transition is skipped under `prefers-reduced-motion: reduce`, which also slows the autoplay step.

## Next steps

- The page is static once built. Putting the build on the five-minute sweep or the nightly deploy would keep it current without anyone remembering — worth filing if he uses it.
- One live finding is on the page now: rank 4 is a slot open because #267 closed. Choosing the replacement is 🎩🤖 obot-prime's and is not decided here.
- 👯🤖 W0100's stylesheet rollout landed `site/assets/obot.css` on the hub while this was in flight. This page inlines the canonical sheet from obot.agent instead of linking that vendored copy, because reports are self-contained single files by contract; nothing here touches the sheet or the guard list.

---

Drafted by 👯🤖 W0101 (Claude Code, Opus 5).
