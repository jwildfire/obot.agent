# rankviz — the ranked head as a page you can watch move

@jwildfire, 2026-08-21: *"I'd like you to make me a page visualizing the high priority and
top 10 requirements with cards. include an option to animate how it has changed over time."*

```bash
node tools/rankviz/build.mjs --out ../obot.roadmap/reports/ranked-head/index.html
```

One self-contained HTML file, published at
[reports/ranked-head](https://jwildfire.github.io/obot.roadmap/reports/ranked-head/).
Nothing on it is hand-maintained: running the build again re-reads both records.

## One population, two tiers

There is no `high priority` label. He asked for one on 2026-08-19 and then said *"Let's
just make a 'top10' label for those requirements"*, and the second replaced the first. So
the page renders `top10` — the ranked head — and `on-deck` — the bench — and invents no
third tier. The bench is unranked in the data and drawn unranked on screen; ordering it
would invent a decision nobody has made.

## What is declared and what is derived

Exactly the split [`rank/README.md`](../../rank/README.md) sets out. `rank/top10.json`
holds an order and a one-line reason and nothing else; the title, whether an issue is
still open, its milestone, whether it is blocked and how far its sub-issues have got are
all read from GitHub at build time. The join is `joinRank` from
[`tools/navigator/rank.mjs`](../navigator/rank.mjs) — the same function the five-minute
sweep and the Operations Dashboard use — so the three surfaces cannot disagree about what
the ten are or about which of them is a finding.

The bench is listed here and counted in the sweep, on purpose. The sweep reduces it to a
number so nothing it prints can read as a recommendation about who gets promoted; this
page names it because he asked to see it, and naming the shelf to the person whose shelf
it is is not the sweep recommending a successor to itself.

## The files

| file | what it is |
|---|---|
| `history.mjs` | every commit against `rank/top10.json`, turned into frames — the order as it stood, the commit that argues for it, and what changed since the frame before |
| `membership.mjs` | GitHub's `labeled`/`unlabeled` events replayed into membership sets over time; the only part of the page that reaches back past the store's first commit |
| `github.mjs` | the derived fields, and the readings that failed |
| `render.mjs` | the page — cards, rails, and the player |
| `build.mjs` | collect and write |

## Why `git show <sha>:<path>` rather than parsing `git log -p`

Both read the same history. A patch has to be replayed to be understood, and a mis-replay
produces a plausible order that never existed; asking git for the blob at that commit
produces the bytes that were committed, or an error, with nothing in between. The failure
mode of the first is a wrong answer and of the second a missing one, and this program has
decided repeatedly that a missing answer is the better one.

## The honesty contract, which is most of the code

The ranked order goes back to one commit on 2026-08-20 at 12:39. A page that animated
that behind a month-shaped axis would be this program's defining defect in a new format,
so:

- The true span is stated in words in the masthead and drawn to scale on rails that stop
  at the last commit. They are the only thing on the page drawn against time.
- The scrubber steps by commit and says it is not a time axis.
- A commit whose store will not parse produces a frame with `reconstructed: false` and
  `order: null`; the frame prints its reason, draws nothing, and the transitions into and
  out of it are `known: false`. Carrying the previous order forward would render a state
  nobody can vouch for, indistinguishable on screen from the frames that are real.
- The reversal search reports how many frames it could not read.
- Membership is a second record with a truncation trap: GitHub's events endpoint pages
  newest-first, so a fetch that stops at its cap produces a record whose oldest event
  looks exactly like the first event. `labelEvents` pages until it finds a page with none
  of the wanted labels on it, and a fetch that hits the cap instead is reported as
  truncated rather than as a beginning.
- A field GitHub did not answer for prints as unanswered rather than blank.

## Reduced motion, and 390px

He reads on a phone. The layout is verified at a real 390px viewport in an iframe probe —
390px inner width, 390px document scrollWidth, nothing extending past the rail, with the
player both closed and open — and every transition is skipped under
`prefers-reduced-motion: reduce`, which also slows the autoplay step.

## The stylesheet

`assets/obot.css`, imported and inlined. Reports are self-contained single files by
contract, which is the case that sheet's own header names for inlining. Nothing here
declares a colour; the local block is layout, which the sheet deliberately does not set.
