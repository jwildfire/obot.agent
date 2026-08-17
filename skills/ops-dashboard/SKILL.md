---
name: ops-dashboard
description: "Open the Operations Dashboard in Chrome — @jwildfire's local todo list (release candidates, open decisions, config items) and the place he answers decision artifacts. Starts the loopback server if it is not already up. Use when he says '/ops-dashboard', 'open the operations dashboard', 'open my todo list', 'what's waiting on me?', or asks to answer a decision in a UI rather than in chat. The session hub is now the second tab of this same site, so this command reaches both. Do NOT use for the public site (that is the hub)."
---

# Operations Dashboard

One command → his todo list, live, in Chrome. Requirement:
[obot.roadmap#180](https://github.com/jwildfire/obot.roadmap/issues/180). Tool:
[`tools/ops-dashboard`](../../tools/ops-dashboard/README.md).

**Vocabulary matters here** (@jwildfire, 2026-08-15): the **dashboard** is this local
page; the **hub** is the public site with the roadmap, news and artifacts; a **config**
item is one only his keyboard can apply (the label he replaced "your hands" with, each
one carrying a permanent `c0001` id). Do not use the words interchangeably in anything
he reads.

**One site, three tabs** (his, 2026-08-15): this server carries the dashboard at `/` —
the default view — the session hub at `/live.html`, and the Navigator's sweep at
`/navigator`. `/session-dashboard` opens the same site on its second tab. The
session-hub watch loop should run **without** `--serve`; this server owns the loopback
port and writes the marker the status line reads.

## Procedure

One idempotent compound call from the workspace root — ensure exactly one server, open
Chrome:

```bash
cd ~/Documents/obot2 && \
(pgrep -f "ops-dashboard.mjs --serve" > /dev/null || \
  { nohup node obot.agent/tools/ops-dashboard/ops-dashboard.mjs --serve --workspace ~/Documents/obot2 \
      >> ~/Documents/obot2/.claude/ops/serve.log 2>&1 & }) && \
sleep 1 && open -a "Google Chrome" "http://127.0.0.1:7326/"
```

If the port rolled forward (7326 was taken), the chosen URL is the first line of
`.claude/ops/serve.log`. It will **not** be in `.claude/session-hub/serve.json`: a server
that did not get the dashboard's port is not the dashboard, so it declines the marker and
says so in the log ([obot.agent#142](https://github.com/jwildfire/obot.agent/issues/142)).
Same for a deliberate `--port 7399` test server — serve it, poke it, kill it; the status
line never moves. Ask `node obot.agent/tools/serve-marker` what the marker actually says
(`none` / `unreadable` / `stale` / `live`) rather than reading the file.

The session tab needs the session hub's watch loop running to have anything to show
(`/session-dashboard` starts it); without one, the tab says so and names the command.

## Applying what he answered

Answers stage in `~/Documents/obot2/.claude/ops/answers/*.json` and wait for an agent.
Applying one means, for the named artifact:

1. Add the decision to the artifact's `<section id="decisions">` at the top — his words
   **verbatim** from the `words` field, with `data-date`, `data-channel="in chat"` and
   `data-resolves`. The markup contract is in the hub's
   `scripts/lib/collect/decision-log.mjs`.
2. Move the artifact's `README.md` status and its row in `reports/decisions/README.md`
   to Decided, in the same commit.
3. Push. The deploy regenerates the Decisions log; it fails if step 1 was skipped.
4. Mark the staged answer `"status": "applied"` — never delete it; the store is the
   audit trail of what he actually said.

A `verdict` of `adopt-all` means every recommendation on the page, as written.

## Rules

- **Never publish anything from this page.** Config items, staged answers, and the ops
  store are local only, permanently.
- Config rows show headlines only. Do not render or copy an item's body anywhere, and
  count-only on any public surface.
- **Never present a dead Navigator sweep as current.** The tab enforces the state
  file's rule (a `swept:` stamp older than 15 minutes means the observer is dead);
  say the same in chat rather than quoting its content as live.
- **Config ids are permanent.** `tools/blocker-log` claims the next one at capture time;
  never renumber an item, never reuse a retired number, never assign one by hand.
- If he answered something the artifact does not cover, ask rather than guessing which
  questions it resolves.
