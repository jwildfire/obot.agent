#!/bin/bash
# Stop-hook heartbeat: nudge a session to log key events to the shared
# session scratchpad when it has gone stale (obot lean-bookends design,
# 2026-07-14; obot.agent#29). Fires for every session in this workspace.
#
# Contract: reads the Stop-hook JSON on stdin; prints a {"decision":"block"}
# JSON nudge (exit 0) when the scratchpad is stale, otherwise stays silent.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$(dirname "$(dirname "$SCRIPT_DIR")")}"
# The heredoc below occupies stdin, so capture the hook payload first.
export HOOK_INPUT="$(cat)"
python3 - <<'PY'
import json, os, sys, time

try:
    data = json.loads(os.environ.get("HOOK_INPUT") or "{}")
except Exception:
    sys.exit(0)

# A block from this hook already continued the session once; let it stop now.
if data.get("stop_hook_active"):
    sys.exit(0)

root = os.environ["WORKSPACE_ROOT"]
today = time.strftime("%Y-%m-%d")
pad = os.path.join(root, ".claude", "session-notes", f"{today}.md")

# No scratchpad today -> no session-init ran; a nudge would be noise.
if not os.path.exists(pad):
    sys.exit(0)

# Tiny transcript -> quick Q&A session; don't nag it about logging.
tp = data.get("transcript_path", "")
if not tp or not os.path.exists(tp) or os.path.getsize(tp) < 100_000:
    sys.exit(0)

STALE_SECONDS = 30 * 60
age = time.time() - os.path.getmtime(pad)
if age < STALE_SECONDS:
    sys.exit(0)

# Rate-limit: at most one nudge per session per staleness window.
sid = data.get("session_id", "unknown")
marker = os.path.join("/tmp", f"scratchpad-heartbeat-{sid}")
if os.path.exists(marker) and time.time() - os.path.getmtime(marker) < STALE_SECONDS:
    sys.exit(0)
with open(marker, "w") as f:
    f.write(str(time.time()))

mins = int(age // 60)
print(json.dumps({
    "decision": "block",
    "reason": (
        f"heartbeat: the shared session scratchpad ({pad}) has had no writes in ~{mins} min. "
        "If this session did anything notable since its last entry (milestone, PR/issue posted, "
        "blocker, decision, completion), append tagged one-liners now under '## Session log' via "
        "shell >> (format: - HH:MM {tag} — {event}), then continue or finish. "
        "If nothing notable happened, just finish — this reminder will not repeat."
    ),
}))
PY
