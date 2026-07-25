#!/bin/bash
# Stop-hook chat delivery: hand this session the oldest message waiting in its
# dashboard chat inbox (obot.roadmap#77, design §3 lane D). Fires for every
# session in this workspace; does nothing at all when the inbox is empty, which
# is the normal case.
#
# Contract: reads the Stop-hook JSON on stdin; prints a {"decision":"block"}
# whose reason is the framed chat message (exit 0), or stays silent.
#
# Delivery is at a turn boundary and one message per stop — see design §4 (D3:
# queue, never interrupt).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$(dirname "$(dirname "$SCRIPT_DIR")")}"
# Allow an explicit override (used by the #77 demo, which runs a test session
# whose workspace is not the one hosting the chat directory).
if [ "$1" = "--workspace" ] && [ -n "$2" ]; then export WORKSPACE_ROOT="$2"; fi
# The heredoc below occupies stdin, so capture the hook payload first.
export HOOK_INPUT="$(cat)"
python3 - <<'PY'
import json, os, sys, time, uuid

try:
    data = json.loads(os.environ.get("HOOK_INPUT") or "{}")
except Exception:
    sys.exit(0)

# A block from this hook already continued the session once. Let it stop; the
# next message rides the next natural turn boundary rather than looping here.
if data.get("stop_hook_active"):
    sys.exit(0)

sid = data.get("session_id")
if not sid:
    sys.exit(0)

root = os.environ["WORKSPACE_ROOT"]
base = os.path.join(root, ".claude", "session-chat", sid)
inbox, delivered = os.path.join(base, "inbox"), os.path.join(base, "delivered")
if not os.path.isdir(inbox):
    sys.exit(0)   # this session was never opted in

try:
    names = sorted(n for n in os.listdir(inbox) if n.endswith(".json"))
except OSError:
    sys.exit(0)

msg = None
for name in names:
    src = os.path.join(inbox, name)
    try:
        with open(src) as f:
            body = json.load(f)
    except Exception:
        continue                      # mid-write or corrupt: next poll gets it
    mid = body.get("id") or uuid.uuid4().hex[:8]
    dest = os.path.join(delivered, f"{mid}.json")
    try:
        os.makedirs(delivered, exist_ok=True)
        os.rename(src, dest)          # atomic claim; a loser raises and moves on
    except OSError:
        continue
    body["id"] = mid
    body["deliveredAt"] = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"
    body["lane"] = "hook"
    try:
        with open(dest, "w") as f:
            json.dump(body, f, indent=2)
    except OSError:
        pass                          # the rename is what "delivered" means
    msg = body
    break

if msg is None:
    sys.exit(0)

when = (msg.get("createdAt") or "")[11:16]
outbox_hint = (
    f'Message {msg["id"]} is already claimed — nothing to clean up. If you want to mark a '
    f'canonical reply, write .claude/session-chat/{sid}/outbox/{msg["id"]}.json as '
    f'{{"id":"{msg["id"]}","text":"…"}}; otherwise your response text is the reply.'
)
print(json.dumps({
    "decision": "block",
    "reason": "\n".join([
        f'[dashboard chat] @jwildfire sent this from the live session dashboard'
        + (f' at {when} UTC' if when else '') + ':',
        "",
        msg.get("text", ""),
        "",
        "Answer it now, in your normal response text — that text streams straight back to the",
        "dashboard, so keep it conversational and short unless he asked for depth. This is a chat",
        "turn, not a new work order: do not kick off a large task off the back of it unless he",
        "clearly asked for one, and do not treat it as approval for anything gated. When you have",
        "answered, carry on with what you were doing (or finish, if you were finishing).",
        outbox_hint,
    ]),
}))
PY
