#!/usr/bin/env bash
# Install the obot status line into the user-level Claude Code config.
#
#   obot.agent/tools/statusline/install.sh            # install into ~/.claude
#   obot.agent/tools/statusline/install.sh --home DIR # somewhere else
#   obot.agent/tools/statusline/install.sh --check    # report drift, change nothing
#
# Copies statusline.sh to <home>/statusline-command.sh and points that config's
# settings.json `statusLine` at it, merging into whatever else is configured
# rather than overwriting the file. Idempotent; the previous script is kept as a
# timestamped .bak next to it.
#
# Why user-level: the status line has to apply to every agent on the machine —
# lead sessions, spawned siblings, ultracode jobs — and only ~/.claude/settings.json
# is read by all of them. Same split as hooks/install.sh: this repo is the source,
# the installed copy is what the harness runs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOME="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
CHECK=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --home) CLAUDE_HOME="$2"; shift 2 ;;
    --check) CHECK=true; shift ;;
    -h|--help) sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

SRC="$SCRIPT_DIR/statusline.sh"
DEST="$CLAUDE_HOME/statusline-command.sh"
SETTINGS="$CLAUDE_HOME/settings.json"
COMMAND="bash ~/.claude/statusline-command.sh"

[[ -d "$CLAUDE_HOME" ]] || { echo "config dir not found: $CLAUDE_HOME" >&2; exit 1; }

PY=$(command -v python3 2>/dev/null || echo /usr/bin/python3)

registered() {
  "$PY" - "$SETTINGS" <<'EOF'
import json, sys
try:
    with open(sys.argv[1]) as fh:
        data = json.load(fh)
except Exception:
    sys.exit(1)
line = data.get("statusLine") or {}
print(line.get("command", ""))
EOF
}

if $CHECK; then
  status=0
  if [[ ! -f "$DEST" ]]; then
    echo "missing:  statusline-command.sh"; status=1
  elif ! diff -q "$SRC" "$DEST" >/dev/null; then
    echo "drifted:  statusline-command.sh"; status=1
  else
    echo "ok:       statusline-command.sh"
  fi
  current=$(registered || true)
  if [[ -z "$current" ]]; then
    echo "missing:  settings.json statusLine"; status=1
  elif [[ "$current" != *statusline-command.sh* ]]; then
    echo "drifted:  settings.json statusLine -> $current"; status=1
  else
    echo "ok:       settings.json statusLine"
  fi
  exit $status
fi

# Back up an existing script only when it differs, so re-running does not litter.
if [[ -f "$DEST" ]] && ! diff -q "$SRC" "$DEST" >/dev/null; then
  backup="$DEST.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$DEST" "$backup"
  echo "backed up existing script -> $backup"
fi

cp "$SRC" "$DEST"
chmod +x "$DEST"
echo "installed $DEST"

current=$(registered || true)
if [[ "$current" == *statusline-command.sh* ]]; then
  echo "settings.json statusLine already points at the installed script ($current)"
  exit 0
fi

"$PY" - "$SETTINGS" "$COMMAND" <<'EOF'
import json, os, sys
path, command = sys.argv[1], sys.argv[2]
data = {}
if os.path.exists(path):
    with open(path) as fh:
        data = json.load(fh)
    with open(path + ".bak-statusline", "w") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
line = data.get("statusLine")
data["statusLine"] = {**(line if isinstance(line, dict) else {}), "type": "command", "command": command}
with open(path, "w") as fh:
    json.dump(data, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
print(f"registered statusLine -> {command}")
EOF
