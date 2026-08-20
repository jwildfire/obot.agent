# The ranked head

`top10.json` is the one place the order of the next ten requirements lives.

Requirement: [obot.roadmap#278](https://github.com/jwildfire/obot.roadmap/issues/278).
@jwildfire, 2026-08-18: *"I think we should probably just maintain a ranked list of
requirements … Next 10 requirements show up at the bottom of the queue maybe. you're
responsible for strategy, so you get the decision and then i can steer when i want to."*

## What is declared here, and what is not

This file holds **an order and a one-line reason per item, and nothing else**. A test
enforces that literally — `rank.test.mjs` fails if a row carries any key other than
`issue`, `why` and `review`.

Everything else a reader wants to know is **derived from GitHub at read time**, keyed
off the `top10` label: the title, whether the issue is still open, its milestone,
whether it is blocked, how far its sub-issues have got. Copying any of those in here
would create a second store of one fact, and this program has already paid for that
once — ten decisions disagreed with themselves because two stores were both
hand-writable.

Two mechanisms, deliberately:

| | carries | lives in |
|---|---|---|
| `top10` label | **membership** — which ten | GitHub, one API call |
| `rank/top10.json` | **order** and the reason | this file |

They can disagree, so every disagreement is reported rather than silently resolved.
The two rejected alternatives are on
[#278's mechanism comment](https://github.com/jwildfire/obot.roadmap/issues/278#issuecomment-5336410588):
a rank line in each of ten issue bodies drifts, and ten ordered labels clutter every
issue view.

## Who edits it

🎩🤖 obot-prime. Rank is strategy and @jwildfire said so. He steers when he wants and
his steering overrides the order without discussion.

To re-rank, edit the array and commit. Nothing else has to change — the surfaces
re-derive on their next read, and the age they print comes from the commit that last
touched this file, so a re-rank dates itself.

`review` is optional and holds one line when a rank is known to be under question. It
is part of the declaration, not derived state: it exists so a re-rank costs one edit
rather than a re-derivation of the argument.

## Where it appears

- **Operations Dashboard**, at the bottom of the queue, below the three buckets and
  read-only — [`tools/ops-dashboard/lib/rankhead.mjs`](../tools/ops-dashboard/lib/rankhead.mjs).
  It never asks @jwildfire for anything; the moment it does it is a fourth obligation
  and the three-bucket rule ([#220](https://github.com/jwildfire/obot.roadmap/issues/220))
  dies quietly.
- **Navigator sweep**, every five minutes, above the RC queue in `navigator-state.md`
  — [`tools/navigator/rankhead.mjs`](../tools/navigator/rankhead.mjs). A `top10` label
  on a closed issue is a **slot open**: the sweep says so and stops there. Choosing the
  replacement is prime's, and the bench reaches the section as a count so that nothing
  it prints can be read as a recommendation.

Both read GitHub through the same module, so the page and the sweep cannot disagree
about what the ten are.

## Ageing

Two clocks, never merged:

- **the order** — the commit that last touched this file (`git log -1 -- rank/top10.json`),
  never the file's mtime, which a fresh clone stamps with the moment it was written.
- **the state beside it** — when `gh` last answered.

An age nobody could measure prints as "not known", never as a zero.
