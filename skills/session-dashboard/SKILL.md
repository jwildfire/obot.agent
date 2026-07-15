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
   one; otherwise start it detached so it outlives the session:

   ```bash
   nohup node obot.agent/tools/session-hub/session-hub.mjs --watch --workspace ~/Documents/obot2 \
     >> ~/Documents/obot2/.claude/session-hub/watch.log 2>&1 &
   echo $! > ~/Documents/obot2/.claude/session-hub/watch.pid
   ```

3. **Open Chrome** (macOS; a new invocation opens a new tab — Chrome's tab search
   finds an existing one by the "Session hub" title):

   ```bash
   open -a "Google Chrome" "file:///Users/jwildfire/Documents/obot2/.claude/session-hub/live.html"
   ```

4. **Confirm**: state the file URL, whether a watch loop was started or reused
   (with PID), and how to stop it — `kill $(cat .claude/session-hub/watch.pid)`.

## Notes

- The page auto-refreshes every 60s with scroll restore; the loop regenerates on
  the same cadence, so "always open the live version" holds without babysitting.
- After a session-hub upgrade merges, restart the loop (`kill` + step 2) so it
  runs the new code — a running loop keeps executing the file it started from.
