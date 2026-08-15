# ops-dashboard — the Operations Dashboard

@jwildfire's **local** page: his todo list — release candidates, decisions, config —
and the place he answers decision artifacts instead of reading them on the public site
and typing the answer somewhere else. It is also the site's default view: the session
hub lives on the second tab of the same server.

Requirement: [jwildfire/obot.roadmap#180](https://github.com/jwildfire/obot.roadmap/issues/180) ·
decision that produced it: [Recording your decisions](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-15-decision-recording/).

## Vocabulary (@jwildfire, 2026-08-15)

- **Dashboard** — this local page. The Operations Dashboard.
- **Hub** — the public site with the roadmap, news and artifacts.
- **Config** — an item only his keyboard can apply: a settings line, a grant, a
  device-side step. Called "your hands" until 2026-08-15 ("let's call 'your hands' ->
  'config' and give them IDs. c0001, etc.").

Both words were used loosely for both things before today. They are not interchangeable now.

## Usage

From the workspace root:

```bash
node obot.agent/tools/ops-dashboard/ops-dashboard.mjs --serve   # http://127.0.0.1:7326/
node obot.agent/tools/ops-dashboard/ops-dashboard.mjs           # render once to stdout
```

| Route | View |
|---|---|
| `/` | the Operations Dashboard — the default view |
| `/live.html`, `/session` | the session hub, under the same header |
| `/session/frame` | the session hub's own render, served unchanged |
| `/navigator` | what the 🧭🤖 Navigator sweep has seen |
| `/artifact/<slug>/` | a decision artifact from the hub clone |

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
- **Decisions** — every open decision artifact, read from the hub clone's own
  collector (`scripts/lib/collect/decision-log.mjs`) rather than the deployed
  `decisions.json`, so a decision recorded five minutes ago is already here.
- **Config** — the workspace list at `<workspace>/.claude/blockers.md` and nowhere
  else. **Headlines only**: an item's body describes exactly which control stopped an
  agent, and there is no reason to render that on a queue row.

In that order, his (2026-08-15): "RCs first. then decisions, then config items."


Clicking a decision opens the artifact in the main area and the answer controls in
the sidebar. **Adopt all is one click** — it is repeatedly his complete answer, and
it must never be six.

### Release-candidate labels

A release candidate reads `package version — what it is` (`gsm.safety v1.1.0 — the
participant-level metrics phase`). That is the naming rule for RC PRs — it is in the
[RC framework](../../docs/rc-framework.md) — but the queue also carries PRs written
before it, so the label is *derived*: package from the repo, version from the title
when the title names this package's version, otherwise from the `(Upcoming)` heading of
the local clone's `NEWS.md`. It is idempotent, so a correctly-titled PR is not doubled,
and a version is never invented — with no evidence, the label is the package alone.

### Config ids

Every config item carries a permanent `c0001`-style id, claimed once at capture time by
[`tools/blocker-log`](../blocker-log) and stored in the list itself, so it survives the
item being reworded. The next id is one above the highest in the **whole** file,
retired entries included — a number is never reused, because he approves things by
quoting them ("c0007 is done") and the record has to stay unambiguous. Same rule as the
hub's decision ids (`scripts/lib/decision-ids.mjs`), deliberately: two schemes that
behave differently would be worse than either.

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

## One site, two tabs

@jwildfire, 2026-08-15: *"I want the ops db and orginal ops hub to be merged. just make
them 2 different tabs on the same (local) site for now. new ops db should be default
view."*

So this server is the site — three tabs now (he added the Navigator an hour later: "I
think i almost certainly want a navigator tab in the ops db"). The strip is a list in
`lib/render.mjs` (`TABS`); a fourth tab is one entry and one route.

It serves the dashboard at `/`, and the session hub's live
view at `/live.html` inside a shell that carries the same header — an **iframe**, not an
injection, because that view is generated by a different tool on its own watch loop and
wrapping it costs neither generator a line of layout (the news feed included). One port:
**7326**, the dashboard's.

The status line finds it the way it always has. On start-up this server writes
`<workspace>/.claude/session-hub/serve.json` — the same `{port, pid, url}` marker
session-hub's own `--serve` writes — pointing at `/live.html` here. Which means the
watch loop should now run **without** `--serve`:

```bash
node obot.agent/tools/session-hub/session-hub.mjs --watch   # renders live.html; no server
```

Two servers both writing that marker is the one way to confuse the status line, and the
loop no longer needs to serve anything.

## The Navigator tab

`/navigator` renders `<workspace>/.claude/session-hub/navigator-state.md` — the RC queue
and event log the [Navigator sweep](../navigator/) writes every five minutes, read fresh
on every request.

Two things it is careful about:

- **A dead observer says so.** The state file's own rule is that a `swept:` stamp older
  than three cadences means the sweep is not running; the tab then leads with a banner
  and the restart command, and never presents what follows as current. A surface he
  would trust to tell him a review landed is the worst place to render stale data
  quietly.
- **Every `##` section renders, including ones this code has never seen.** That is the
  seam for the per-agent ledger he actually asked for ("a list of issues/PRs that were
  created/updated by each agent"). It is not built here because it is not derivable
  from GitHub — every agent-authored issue and PR is authored by `obotclaw[bot]`, so
  "which agent" needs a join against the scratchpad's per-sibling lines. When the sweep
  starts writing a `## By agent` section, this tab shows it unchanged.

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
