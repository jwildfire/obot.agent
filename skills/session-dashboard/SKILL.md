---
name: session-dashboard
description: "Open the LIVE session dashboard in Chrome, starting the session-hub watch loop if it isn't already running — one idempotent command that renders, ensures the loop, and opens Chrome. Use whenever @jwildfire says '/session-dashboard', 'open the dashboard', 'open the live dashboard', or 'show me the session hub'. Always opens the live view — the frozen wrapup report is session-wrapup's job."
---

# Session Dashboard

One command → the [session hub](../../tools/session-hub/README.md) live view, fresh
and self-refreshing, in Chrome. Requirement:
[obot.roadmap#24](https://github.com/jwildfire/obot.roadmap/issues/24) (D1: static
watch loop).

## Procedure

Run everything from the **workspace root** (`~/Documents/obot2`). The generator is
`obot.agent/tools/session-hub/session-hub.mjs`.

**One idempotent compound call** — render, ensure exactly one watch loop, open
Chrome. Do not split these into three round trips; the loop refreshes within 60s
anyway, so the fresh render rides along rather than blocking on its own. `--serve`
also publishes the view on loopback HTTP, which is what the status-line link opens,
and the `open` below prefers that URL over the file:

```bash
cd ~/Documents/obot2 && \
node obot.agent/tools/session-hub/session-hub.mjs --workspace ~/Documents/obot2 && \
(pgrep -f "session-hub.mjs --watch" > /dev/null || \
  { nohup node obot.agent/tools/session-hub/session-hub.mjs --watch --serve --workspace ~/Documents/obot2 \
      >> ~/Documents/obot2/.claude/session-hub/watch.log 2>&1 & \
    echo $! > ~/Documents/obot2/.claude/session-hub/watch.pid; }) && \
pgrep -f "session-hub.mjs --watch" && \
open -a "Google Chrome" "$(python3 -c 'import json;print(json.load(open("/Users/jwildfire/Documents/obot2/.claude/session-hub/serve.json"))["url"])' \
  2>/dev/null || echo "file:///Users/jwildfire/Documents/obot2/.claude/session-hub/live.html")"
```

(macOS; a new `open` invocation makes a new tab — Chrome's tab search finds an
existing one by the "Session hub" title.)

If a loop is already running **without** `--serve` (no live
`.claude/session-hub/serve.json`), restart it with the flag rather than leaving the
status-line link on `file://`.

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
  to the browser. It binds 127.0.0.1 only and serves nothing outside
  `.claude/session-hub/`.
