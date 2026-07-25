#!/usr/bin/env bash
# Install the obot workspace hooks into a workspace's .claude/ directory.
#
#   obot.agent/hooks/install.sh                 # install into ~/Documents/obot2
#   obot.agent/hooks/install.sh --workspace DIR # somewhere else
#   obot.agent/hooks/install.sh --check         # report drift, change nothing
#
# Copies the hook scripts and registers each in the workspace settings.json under
# the event it belongs to, merging into whatever is already configured rather
# than overwriting it. Idempotent: re-running after an edit re-copies the script
# and leaves the registration alone.
#
# Why this exists: the hooks used to live only in ~/Documents/obot2/.claude/hooks/,
# which is not a git repository — so the merge guard and the scratchpad heartbeat
# existed on exactly one machine, with no history and no way to notice drift. The
# workspace copy is still the one the harness runs; this repo is the source it is
# installed from.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="${OBOT_WORKSPACE:-$HOME/Documents/obot2}"
CHECK=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace) WORKSPACE="$2"; shift 2 ;;
    --check) CHECK=true; shift ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

[[ -d "$WORKSPACE" ]] || { echo "workspace not found: $WORKSPACE" >&2; exit 1; }
DEST="$WORKSPACE/.claude/hooks"
SETTINGS="$WORKSPACE/.claude/settings.json"

# hook script  ->  the settings.json event it registers under
declare -a HOOKS=(
  "merge-gate-guard.sh:PreToolUse:Bash"
  "scratchpad-heartbeat.sh:Stop:"
  "session-state-publish.sh:Stop:"
)

if $CHECK; then
  status=0
  for entry in "${HOOKS[@]}"; do
    name="${entry%%:*}"
    if [[ ! -f "$DEST/$name" ]]; then
      echo "missing:  $name"; status=1
    elif ! diff -q "$SCRIPT_DIR/$name" "$DEST/$name" >/dev/null; then
      echo "drifted:  $name"; status=1
    else
      echo "ok:       $name"
    fi
  done
  exit $status
fi

mkdir -p "$DEST"
for entry in "${HOOKS[@]}"; do
  name="${entry%%:*}"
  cp "$SCRIPT_DIR/$name" "$DEST/$name"
  chmod +x "$DEST/$name"
  echo "installed $name"
done

# Register anything not already registered. Matching is by script basename, so a
# hand-edited command string (different quoting, a timeout added) is left alone.
SETTINGS="$SETTINGS" HOOK_SPEC="${HOOKS[*]}" python3 <<'PY'
import json, os, pathlib

path = pathlib.Path(os.environ["SETTINGS"])
data = json.loads(path.read_text()) if path.exists() else {}
hooks = data.setdefault("hooks", {})
changed = False

for entry in os.environ["HOOK_SPEC"].split():
    name, event, matcher = entry.split(":")
    command = f'"$CLAUDE_PROJECT_DIR"/.claude/hooks/{name}'
    groups = hooks.setdefault(event, [])

    group = next(
        (g for g in groups if (g.get("matcher") or "") == matcher),
        None,
    )
    if group is None:
        group = {"hooks": []} if not matcher else {"matcher": matcher, "hooks": []}
        groups.append(group)

    if any(name in h.get("command", "") for h in group["hooks"]):
        continue
    group["hooks"].append({"type": "command", "command": command})
    changed = True
    print(f"registered {name} under {event}")

if changed:
    path.write_text(json.dumps(data, indent=2) + "\n")
else:
    print("settings.json already registers every hook")
PY
