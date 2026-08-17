---
name: session-dashboard
description: "Open the LIVE session dashboard in Chrome, starting the session-hub watch loop if it isn't already running — one idempotent command that renders, ensures the loop, and opens Chrome. Use whenever @jwildfire says '/session-dashboard', 'open the dashboard', 'open the live dashboard', or 'show me the session hub'. Always opens the live view — the frozen wrapup report is session-wrapup's job."
---

# Session Dashboard

One command → the [session hub](../../tools/session-hub/README.md) live view, fresh
and self-refreshing, in Chrome. Requirement:
[obot.roadmap#24](https://github.com/jwildfire/obot.roadmap/issues/24) (D1: static
watch loop).

**Since 2026-08-15 this view is the second tab of one local site** (@jwildfire: "I want
the ops db and orginal ops hub to be merged. just make them 2 different tabs on the same
(local) site for now. new ops db should be default view"). The
[ops-dashboard](../../tools/ops-dashboard/README.md) server owns the port and serves this
view at `/live.html`; the watch loop below only renders `live.html` to disk — it runs
**without** `--serve`, because two servers writing `.claude/session-hub/serve.json` is
the one way to leave the status-line link pointing at the wrong one. Since
[obot.agent#142](https://github.com/jwildfire/obot.agent/issues/142) a second instance
declines the marker rather than taking it, so testing a change is safe — but the loop
still has no reason to serve.

## Procedure

Run everything from the **workspace root** (`~/Documents/obot2`). The generator is
`obot.agent/tools/session-hub/session-hub.mjs`.

**One idempotent compound call** — render, ensure exactly one watch loop, ensure the
site's server, open Chrome. Do not split these into round trips; the loop refreshes
within 60s anyway, so the fresh render rides along rather than blocking on its own. The
ops-dashboard server is what publishes the view on loopback HTTP, which is what the
status-line link opens, and the `open` below prefers that URL over the file:

```bash
cd ~/Documents/obot2 && \
node obot.agent/tools/session-hub/session-hub.mjs --workspace ~/Documents/obot2 && \
(pgrep -f "session-hub.mjs --watch" > /dev/null || \
  { nohup node obot.agent/tools/session-hub/session-hub.mjs --watch --workspace ~/Documents/obot2 \
      >> ~/Documents/obot2/.claude/session-hub/watch.log 2>&1 & \
    echo $! > ~/Documents/obot2/.claude/session-hub/watch.pid; }) && \
(pgrep -f "ops-dashboard.mjs --serve" > /dev/null || \
  { nohup node obot.agent/tools/ops-dashboard/ops-dashboard.mjs --serve --workspace ~/Documents/obot2 \
      >> ~/Documents/obot2/.claude/ops/serve.log 2>&1 & }) && \
sleep 1 && pgrep -f "session-hub.mjs --watch" && \
open -a "Google Chrome" "$(node obot.agent/tools/serve-marker --url \
  2>/dev/null || echo "file:///Users/jwildfire/Documents/obot2/.claude/session-hub/live.html")"
```

`serve-marker --url` answers only when the marker's server is **still running**, and
exits non-zero otherwise, so the fallback fires on a stale marker as well as a missing
one. Reading `serve.json` directly cannot tell those apart — that is how the status line
ended up pointing at a killed server ([obot.agent#142](https://github.com/jwildfire/obot.agent/issues/142)).

(macOS; a new `open` invocation makes a new tab — Chrome's tab search finds an
existing one by the "Session hub" title.)

If a loop is still running **with** `--serve` (from before the merge), kill it and
restart it without the flag — otherwise it competes with the merged site for the port
and the marker.

**Confirm in the same message as the command**: the URL opened, whether a watch loop
was started or reused (with PID), and how to stop it —
`kill $(cat .claude/session-hub/watch.pid)`.

## Notes

- The page auto-refreshes every 60s with scroll restore; the loop regenerates on
  the same cadence, so "always open the live version" holds without babysitting.
- After a session-hub upgrade merges, kill the loop and re-run the command above so it
  runs the new code — a running loop keeps executing the file it started from.
- The loopback server is why the [status-line link](../../tools/statusline/README.md)
  lands in Chrome: Ghostty hands a `file://` hyperlink to Finder, an `http://` one
  to the browser. Since the merge it is the ops-dashboard server, binding 127.0.0.1
  only, serving this view at `/live.html` and the dashboard at `/`.
