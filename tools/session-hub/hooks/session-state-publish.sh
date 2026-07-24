#!/bin/bash
# Stop-hook publisher: refresh the roadmap page's session indicator at the end of
# each agent turn (obot.roadmap#57 D5; @jwildfire chose the Stop hook over the
# --watch loop on 2026-07-24).
#
# Install: copy to <workspace>/.claude/hooks/ and add to the workspace
# settings.json Stop array, alongside scratchpad-heartbeat.sh.
#
# Three properties this hook must have, because it fires on every turn of every
# agent in the workspace:
#
#   silent   — prints nothing, so it never blocks or annotates a session's stop
#              (the Stop contract reads stdout as a decision)
#   detached — the publish is a render plus a network round-trip; it runs in the
#              background so a slow or hanging API never delays a turn ending
#   single   — siblings all stop independently, and they would race on the same
#              file; an atomic lock plus a minimum interval keeps that to one
#              publisher at a time and one commit per interval, workspace-wide
#
# Failures are deliberately swallowed: a stale session pill is a cosmetic problem
# and must never surface as a session error.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="${CLAUDE_PROJECT_DIR:-$(dirname "$(dirname "$SCRIPT_DIR")")}"
PUBLISHER="$WORKSPACE/obot.agent/scripts/obot-session-state"
MIN_INTERVAL=60   # seconds between publishes, workspace-wide
LOCK="/tmp/obot-session-state.lock"
STAMP="/tmp/obot-session-state.stamp"

cat >/dev/null   # consume the hook payload; this hook does not read it

[[ -x "$PUBLISHER" ]] || exit 0

# Rate limit before taking the lock, so the common case is two stat calls.
if [[ -f "$STAMP" ]]; then
  now=$(date +%s)
  last=$(stat -f %m "$STAMP" 2>/dev/null || stat -c %Y "$STAMP" 2>/dev/null || echo 0)
  (( now - last < MIN_INTERVAL )) && exit 0
fi

# mkdir is atomic on every filesystem we care about; a stale lock older than five
# minutes is assumed dead (a killed publisher would otherwise wedge the pill).
if ! mkdir "$LOCK" 2>/dev/null; then
  lock_age=$(( $(date +%s) - $(stat -f %m "$LOCK" 2>/dev/null || stat -c %Y "$LOCK" 2>/dev/null || echo 0) ))
  (( lock_age > 300 )) && rmdir "$LOCK" 2>/dev/null
  exit 0
fi

touch "$STAMP"
(
  trap 'rmdir "$LOCK" 2>/dev/null' EXIT
  OBOT_WORKSPACE="$WORKSPACE" "$PUBLISHER" >/dev/null 2>&1
) &

exit 0
