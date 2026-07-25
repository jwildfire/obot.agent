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
# Failures are swallowed — a stale session pill is cosmetic and must never surface
# as a session error — but they are *recorded*. Swallowing them silently is how a
# stale obot.agent clone (missing --emit-state after #44 merged) went unnoticed
# through every turn of a session: the hook ran, failed, and said nothing. The log
# below is the only trace, so read it first when the pill stops moving.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="${CLAUDE_PROJECT_DIR:-$(dirname "$(dirname "$SCRIPT_DIR")")}"
PUBLISHER="$WORKSPACE/obot.agent/scripts/obot-session-state"
MIN_INTERVAL=60   # seconds between publishes, workspace-wide
LOCK="/tmp/obot-session-state.lock"
STAMP="/tmp/obot-session-state.stamp"
LOG="$WORKSPACE/.claude/session-hub/cache/publish.log"

cat >/dev/null   # consume the hook payload; this hook does not read it

# One line per event: a node stack trace is many lines of stderr, and a log whose
# entries wrap is a log nobody greps. Keep the first meaningful line, clipped.
log() {
  mkdir -p "$(dirname "$LOG")" 2>/dev/null
  local msg
  msg="$(printf '%s' "$*" | tr '\n' ' ' | tr -s ' ' | cut -c1-300)"
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$msg" >>"$LOG" 2>/dev/null
}

if [[ ! -x "$PUBLISHER" ]]; then
  log "publisher not executable or missing: $PUBLISHER"
  exit 0
fi

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
  err="$(OBOT_WORKSPACE="$WORKSPACE" "$PUBLISHER" 2>&1 >/dev/null)" || {
    log "publish failed (exit $?): ${err:-no stderr}"
    exit 0
  }
  # Keep the log to the last 200 lines; it is a diagnostic tail, not an archive.
  if [[ -f "$LOG" ]] && (( $(wc -l <"$LOG") > 200 )); then
    tail -n 200 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
) &

exit 0
