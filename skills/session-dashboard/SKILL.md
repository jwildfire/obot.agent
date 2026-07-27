---
name: session-dashboard
description: "Open the LIVE session dashboard in Chrome, starting the session-hub watch loop if it isn't already running. Use whenever @jwildfire says '/session-dashboard', 'open the dashboard', 'open the live dashboard', or 'show me the session hub'. Always opens the live view — the frozen wrapup report is session-wrapup's job."
---

# Session Dashboard

One command → the [session hub](../../tools/session-hub/README.md) live view, fresh
and self-refreshing, in Chrome. Requirement:
[obot.roadmap#24](https://github.com/jwildfire/obot.roadmap/issues/24) (D1: static
watch loop).

## Procedure

Run everything from the **workspace root** (`~/Documents/obot2`). The generator is
`obot.agent/tools/session-hub/session-hub.mjs`; if that path does not exist yet
(session-hub PR not merged), fall back to the open PR's worktree copy
(`obot.agent/.claude/worktrees/*/tools/session-hub/session-hub.mjs`).

1. **Render fresh** so the first view is current, not the last loop tick:

   ```bash
   node obot.agent/tools/session-hub/session-hub.mjs --workspace ~/Documents/obot2
   ```

2. **Ensure one watch loop** — skip if `pgrep -f "session-hub.mjs --watch"` finds
   one; otherwise start it detached so it outlives the session. `--serve` also
   publishes the view on loopback HTTP, which is what the status-line link opens:

   ```bash
   nohup node obot.agent/tools/session-hub/session-hub.mjs --watch --serve --workspace ~/Documents/obot2 \
     >> ~/Documents/obot2/.claude/session-hub/watch.log 2>&1 &
   echo $! > ~/Documents/obot2/.claude/session-hub/watch.pid
   ```

   If a loop is already running **without** `--serve` (no live
   `.claude/session-hub/serve.json`), restart it with the flag rather than leaving
   the status-line link on `file://`.

3. **Open Chrome** (macOS; a new invocation opens a new tab — Chrome's tab search
   finds an existing one by the "Session hub" title). Prefer the served URL from
   `serve.json`, falling back to the file:

   ```bash
   open -a "Google Chrome" "$(python3 -c 'import json;print(json.load(open("/Users/jwildfire/Documents/obot2/.claude/session-hub/serve.json"))["url"])' \
     2>/dev/null || echo "file:///Users/jwildfire/Documents/obot2/.claude/session-hub/live.html")"
   ```

4. **Confirm**: state the URL opened, whether a watch loop was started or reused
   (with PID), and how to stop it — `kill $(cat .claude/session-hub/watch.pid)`.

## Notes

- The page auto-refreshes every 60s with scroll restore; the loop regenerates on
  the same cadence, so "always open the live version" holds without babysitting.
- After a session-hub upgrade merges, restart the loop (`kill` + step 2) so it
  runs the new code — a running loop keeps executing the file it started from.
- The loopback server is why the [status-line link](../../tools/statusline/README.md)
  lands in Chrome: Ghostty hands a `file://` hyperlink to Finder, an `http://` one
  to the browser. It binds 127.0.0.1 only and serves nothing outside
  `.claude/session-hub/`.
