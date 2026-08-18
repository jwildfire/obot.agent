<!-- STATUS: Posted to https://github.com/jwildfire/obot.roadmap/issues/247 on 2026-08-18 01:02 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: 2026q3, Labels: enhancement, infrastructure, ws-delivery -->

Requirement: jwildfire/obot.roadmap#238 — the morning fold, and the briefing it produces.

## What he gets

One URL he can bookmark on his phone: `https://jwildfire.github.io/obot.roadmap/reports/briefing/`. It 404s today, at that address and at eight plausible variants.

The page is his queue, not a report of yesterday. Ten lines at most, one line per item, the ask at the front of the line, every line a link he can act on from the phone. It always shows current state — there are no dated briefings to catch up on, because the diary is the archive. Skip it for a week and the next one is still complete.

## Shape, from M3

```
☀️ obot briefing — Mon Aug 18

🚦 Release candidates (1)
1. open.gismo v0.2.0-RC1 — local-first engine + the study site → PR #10 · demo

🧭 Decisions (3)
1. Scheduled sessions: what is ready — 2 days open → Q&A #222
...

🙋 Todos (2)
- ...

Overnight
sv v1.7.0 released · 4 PRs merged · 10 config items open · diary
```

Numbered lists for the two headline queues, bullets for todos, one trailing paragraph for the record. Section headers carry their own counts. The blockers list appears as a count and never as item text — that list is local-only by design, and the deploy greps the assembled site for its sentinel and fails on a hit.

## Where the items come from

Not from a second sweep. `scripts/roadmap/queue.mjs` already builds exactly this item set for the Queue at `/roadmap.html` — "one ranked list of every item that cannot proceed without him, longest-waiting first" — already ranks them in his stated order (release candidates, then decisions, then config items), already renders the config bucket as a count, and already holds at 390px. The briefing is a second view of the same `buildItems()`, generated at deploy time beside the Queue, following the pattern `scripts/build_decisions.mjs` already uses for `_site/reports/decisions/index.html`.

Two inboxes that disagree would be worse than one inbox, so this is not negotiable detail — it is the reason the page is cheap.

## How the fold's own facts get in

The hub's build-time generators physically cannot read outside the repo: `scripts/lib/local-only-guard.mjs` installs on import and `check_local_only_guard.mjs` runs first in the deploy and fails any source naming a home-relative or `.claude` path. So the overnight line and the fold's timestamp travel the one sanctioned route — a committed `data/fold.json`, parsed on the public side through `scripts/lib/public-channel.mjs` into a fixed shape, exactly as `data/config-count.json` already does. `data/**` is a deploy trigger path, so the fold's commit refreshes the page without a second schedule.

That is also how the page carries its own freshness: a briefing whose `asOf` is a day old says so on its face, which is how a fold that did not run gets noticed without building an off-machine alarm.

## Acceptance

- The URL returns 200 and renders the current queue.
- Its counts equal the Queue page's counts for the same item classes, checked on the same build. If they can disagree, they will.
- It holds at a real 390px viewport, verified with the iframe probe rather than by eye. The site's own stylesheet records why this is not optional: `html { overflow-x: clip }` means overflow is not recoverable by scrolling — whatever runs past the viewport is simply gone, and it once silently ate four of seven columns.
- Ten lines is a bound the generator enforces, not a habit. The openclaw failure signature is monotonic growth against a fixed template — 136 words to 865 — so a template with sections that must be filled is itself the defect.
- The page carries a `<meta name="description">` of 40–260 characters directly after `<title>`. Without one `check_artifact_descriptions.mjs` fails the whole hub deploy, and "AI-generated report." is rejected by name.
- Zero blocker item text anywhere in the built site. The deploy's sentinel grep is the check.
- `docs/rc-framework.md`'s `## The nightly executive summary` section is amended to this shape — one stable `reports/briefing/` in place of dated `reports/exec/{date}/`, two queues plus todos plus one overnight line in place of its five sections. That amendment is Phase 0 of the adopted migration path, and `reports/exec/` was never built, so there is nothing to migrate.

## Not this task

The gate that decides whether to re-render (#TBD-1). The diary (#TBD-4). The push that links this URL (#TBD-7). The weekly's dated page is [#239](https://github.com/jwildfire/obot.roadmap/issues/239) and explicitly not this.

---

Filed by 👯🤖 W0045 (Claude Code using Opus 5) against @jwildfire's adoption of D0007/M3 on 2026-08-16. Not reviewed by him.
