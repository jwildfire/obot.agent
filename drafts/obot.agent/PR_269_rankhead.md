<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/269 on 2026-08-20 12:42 EDT -->
<!-- GITHUB_PROPERTIES: Labels: enhancement, Assignee: @me -->

## What this does

Sixty-odd open requirements and no statement of what comes next. This puts the next ten at the bottom of @jwildfire's queue, in order, each with the one line saying why it is where it is — read-only, below his three buckets, and asking him for nothing.

The requirement sets its own acceptance test: *"If it cannot reproduce a ranking that already exists, it is not ready to produce one that does not."* This reproduces the ranking given to him on 2026-08-19 exactly — same order, same reasons — but derived, ageing honestly, and steerable in one edit.

Closes jwildfire/obot.roadmap#278

Worker: W0077.

## Roadmap context

- Requirement: [obot.roadmap#278](https://github.com/jwildfire/obot.roadmap/issues/278) — *what comes next is written down: a ranked head, tiers below, before any clock runs*. Goal [#73](https://github.com/jwildfire/obot.roadmap/issues/73) (autonomy), milestone `2026q3`.
- One of two gates before scheduling starts; the other is [#272](https://github.com/jwildfire/obot.roadmap/issues/272).
- It sits *under* the three-bucket rule ([#220](https://github.com/jwildfire/obot.roadmap/issues/220)) rather than beside it. The moment it demands an action it is a fourth obligation and that rule dies quietly, so the absence of the ask is asserted by a test rather than remembered.
- The mechanism was decided on the requirement: the `top10` label carries **membership**, the file carries **order**. Both alternatives were rejected there — a rank line in ten issue bodies drifts, ten ordered labels clutter every issue view.
- Board state: this work is off the roadmap board, because board writes fail for every credential right now ([obot.roadmap#252](https://github.com/jwildfire/obot.roadmap/issues/252)). Recorded so it reads as a known blocked mechanism rather than an oversight.

## Evidence

- <a href="https://github.com/jwildfire/obot.agent/blob/rankhead/rank/top10.json">rank/top10.json</a> — the declared order. Ten rows, each `{issue, why}`, plus `review` on the two prime has flagged.
- <a href="https://github.com/jwildfire/obot.agent/blob/rankhead/rank/README.md">rank/README.md</a> — the contract: what is declared, what is derived, who edits it, how it ages.
- <a href="https://github.com/jwildfire/obot.agent/blob/rankhead/tools/navigator/rank.mjs">tools/navigator/rank.mjs</a> — the shared core: parse, git-derived age, the join, the findings.
- <a href="https://github.com/jwildfire/obot.agent/blob/rankhead/tools/navigator/rankhead.mjs">tools/navigator/rankhead.mjs</a> — the GitHub reader and the sweep's section.
- <a href="https://github.com/jwildfire/obot.agent/blob/rankhead/tools/ops-dashboard/lib/rankhead.mjs">tools/ops-dashboard/lib/rankhead.mjs</a> — the panel's collector.
- <a href="https://github.com/jwildfire/obot.agent/blob/rankhead/tools/ops-dashboard/README.md#the-ranked-head--what-comes-next-below-all-three">ops-dashboard README § The ranked head</a>.
- **46 new tests** across <a href="https://github.com/jwildfire/obot.agent/blob/rankhead/tools/navigator/test/rank.test.mjs">rank.test.mjs</a>, <a href="https://github.com/jwildfire/obot.agent/blob/rankhead/tools/navigator/test/rankhead.test.mjs">rankhead.test.mjs</a> and <a href="https://github.com/jwildfire/obot.agent/blob/rankhead/tools/ops-dashboard/test/rank-head.test.mjs">rank-head.test.mjs</a>. Full suite 1387 pass / 0 fail; `obot-policy validate` and `policy-sweep` clean.
- **Verified at a real 390px viewport** by iframe probe: 386px inner width, 386px document `scrollWidth`, and no element in the panel extending past the rail.
- **Verified against live GitHub**, not fixtures: the reader run against the real hub reproduces the ranking and currently reports three open slots.

## Technical briefing

**One declared store, everything else derived.** `rank/top10.json` holds an order and a one-line reason and nothing else — a test fails on any other key. Title, state, milestone, blocked-ness and sub-issue progress come from GitHub at read time off the `top10` label, in the single REST call @jwildfire asked for (REST rather than `gh issue list`, because it carries `sub_issues_summary`).

**Two clocks, never merged.** "Ranked 2026-08-19, 3d old" is the order; "State refreshed 4m ago" is everything beside it. The declaration is read inline on every render, so the order and the reasons survive an unauthenticated `gh`; only the derived half is cached and refreshed behind the page. A refresh that failed says so in its own sentence, with the age of what is actually on screen. An age nobody could measure prints "not known", never a zero.

**The order's age comes from git, not from the file.** `git log -1 -- rank/top10.json`, never mtime — a fresh clone stamps every file with the moment it was written, so an mtime reading would report a week-old rank as minutes old on any machine that had just updated its checkout, which is exactly the "stale and does not admit it" failure the requirement was filed about. An uncommitted edit is reported rather than dated, because the commit date then understates it.

**A slot open is computed, reported, and left alone.** A `top10` label on a closed issue is the same shape as a carve-out PR with no approval. The sweep raises it as a finding and the panel shows it; neither chooses the replacement, and the bench reaches both surfaces as a **count** rather than a list — a containment in the shape of the data rather than in anyone's restraint. Nothing about it reaches the config list; the escalation lane is not imported, and a test asserts that.

**One reader of GitHub, not two.** The dashboard refreshes by spawning `tools/navigator/rankhead.mjs` out of process rather than repeating its calls, so the page and the sweep cannot disagree about what the ten are — the same reasoning that has `collect.mjs` import the sweep's `classify.mjs`.

**A defect found by running it against the real hub.** Three of the first ten closed within a day of the label being created, and all three took `top10` with them on the way out — so the label query could not see them and they vanished from the head entirely, reported as "GitHub did not return it": true, unhelpful, and silent about the three slots that are the whole point. The reader now fetches by number any ranked issue the label query cannot see (zero calls on a clean pass), and a closed issue that has lost the label raises the slot only, not a duplicate membership finding.

## Next steps

- 🎩🤖 obot-prime has three slots to fill — ranks 7, 8 and 9 ([#264](https://github.com/jwildfire/obot.roadmap/issues/264), [#251](https://github.com/jwildfire/obot.roadmap/issues/251), [#256](https://github.com/jwildfire/obot.roadmap/issues/256) all closed 2026-08-20) — plus the two re-ranks it has already flagged in the store: [#275](https://github.com/jwildfire/obot.roadmap/issues/275) is smaller than rank 2 assumed, and [#279](https://github.com/jwildfire/obot.roadmap/issues/279) may need to be earlier. Each is one edit to `rank/top10.json`, and the edit dates itself.
- Tier assignment below the head is not declared here. The boundary is — one sentence, in the store, rendered on the panel — and the `on-deck` bench it names is real and currently holds ten. Ordering that bench is prime's call, and the label's own description already says the promotion order lives on #278.

---

Drafted by 👯🤖 W0077 using Opus 5.
