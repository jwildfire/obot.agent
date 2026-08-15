---
name: ops-dashboard
description: "Open the Operations Dashboard in Chrome — @jwildfire's local todo list (release candidates, blockers, open decisions) and the place he answers decision artifacts. Starts the loopback server if it is not already up. Use when he says '/ops-dashboard', 'open the operations dashboard', 'open my todo list', 'what's waiting on me?', or asks to answer a decision in a UI rather than in chat. Do NOT use for the live session view (that is session-dashboard) or the public site (that is the hub)."
---

# Operations Dashboard

One command → his todo list, live, in Chrome. Requirement:
[obot.roadmap#180](https://github.com/jwildfire/obot.roadmap/issues/180). Tool:
[`tools/ops-dashboard`](../../tools/ops-dashboard/README.md).

**Vocabulary matters here** (@jwildfire, 2026-08-15): the **dashboard** is this local
page; the **hub** is the public site with the roadmap, news and artifacts. Do not use
the words interchangeably in anything he reads.

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
`.claude/ops/serve.log`.

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

- **Never publish anything from this page.** Blockers, staged answers, and the ops
  store are local only, permanently.
- Blocker rows show headlines only. Do not render or copy an item's body anywhere.
- If he answered something the artifact does not cover, ask rather than guessing which
  questions it resolves.
