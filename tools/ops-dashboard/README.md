# ops-dashboard — the Operations Dashboard

@jwildfire's **local** page: his todo list with blockers included, and the place he
answers decision artifacts instead of reading them on the public site and typing the
answer somewhere else.

Requirement: [jwildfire/obot.roadmap#180](https://github.com/jwildfire/obot.roadmap/issues/180) ·
decision that produced it: [Recording your decisions](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-15-decision-recording/).

## Vocabulary (@jwildfire, 2026-08-15)

- **Dashboard** — this local page. The Operations Dashboard.
- **Hub** — the public site with the roadmap, news and artifacts.

Both words were used loosely for both things before today. They are not interchangeable now.

## Usage

From the workspace root:

```bash
node obot.agent/tools/ops-dashboard/ops-dashboard.mjs --serve   # http://127.0.0.1:7326/
node obot.agent/tools/ops-dashboard/ops-dashboard.mjs           # render once to stdout
```

| Option | Meaning |
|---|---|
| `--serve` | run the loopback server (without it, one render to stdout) |
| `--port <n>` | port, default 7326; rolls forward if taken |
| `--workspace <dir>` | workspace root (default: cwd) |
| `--hub <dir>` | obot.roadmap clone (default: `<workspace>/obot.roadmap`) |
| `--open` | print the URL once the server is up |

## What it shows

One queue, three sources:

- **Release candidates** — from the sweep `scripts/reviews-queue` already does, cached
  in the ops store so the page opens instantly and works offline. Clicking one opens
  the pull request on GitHub; release candidates are reviewed there.
- **Only your hands** — the blockers, read from `<workspace>/.claude/blockers.md` and
  nowhere else. **Headlines only**: an item's body describes exactly which control
  stopped an agent, and there is no reason to render that on a queue row.
- **Decisions** — every open decision artifact, read from the hub clone's own
  collector (`scripts/lib/collect/decision-log.mjs`) rather than the deployed
  `decisions.json`, so a decision recorded five minutes ago is already here.

Clicking a decision opens the artifact in the main area and the answer controls in
the sidebar. **Adopt all is one click** — it is repeatedly his complete answer, and
it must never be six.

## Why local, and why the page holds no credential

The hub is a static, public site. A published page cannot write anywhere by itself,
so every "approve in the doc" scheme is really a scheme about where the click's write
goes — and because the page is public, whatever receives that write must also prove
the click came from him. That is an authentication product, not a button, and it
would put an approval-forgery surface on the internet to save one chat message. A
click on a page served from 127.0.0.1 is his by construction.

The dashboard still does not hold a write credential. An answer is written to the
local ops store, and an agent applies it to the artifact's Decisions section, the
decision log and the index. Anything able to write to the hub on his behalf holds
real capability; a browser page that also renders artifact content is the wrong place
to keep it.

## The ops store

`<workspace>/.claude/ops/` — local only, never committed, never published.

- `answers/` — one file per answer, **append-only**. Nothing is ever edited in place,
  so "what did he say, and when" survives an agent that applies it badly.
- `cache/` — GitHub sweeps.
- Every file opens with the same local-only sentinel the hub's deploy greps for, so
  if one ever reaches an assembled site the build fails instead of publishing it.

The workspace's `.claude/` is not a git repository, so the containment does not depend
on a gitignore rule being right — the same reasoning that settled where the blockers
list lives.

## Not in this version

- Reviewing a release candidate inside the dashboard (it links out).
- Anything reachable from his phone.
- The apply step that pushes a staged answer to the hub — staged answers accumulate in
  `answers/` until an agent applies them.
- Notification. How pending work reaches him when he is *not* looking at this page is
  the daily-briefing design, not this.

## Tests

```bash
node --test obot.agent/tools/ops-dashboard/test/*.test.mjs
```
