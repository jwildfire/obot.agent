#!/bin/bash
# Claude Code statusline: short session id, model name, current directory, git branch,
# context remaining %, cost, and a clickable hub link. The short id (first 8 chars of
# session_id) matches the job id used by `claude attach` / `claude agents`.
#
# Source of truth: obot.agent/tools/statusline/statusline.sh. The copy the harness runs
# is ~/.claude/statusline-command.sh — install it with tools/statusline/install.sh, do
# not hand-edit the installed copy (see tools/statusline/README.md).
#
# NOTE: jq is not installed on this machine, so JSON is parsed with python3
# (invoked once, resolved robustly since non-interactive bash does not source
# ~/.zprofile / homebrew shellenv, so PATH may not include python3).

input=$(cat)

PY=$(command -v python3 2>/dev/null || true)
[ -z "$PY" ] && [ -x /opt/homebrew/bin/python3 ] && PY=/opt/homebrew/bin/python3
[ -z "$PY" ] && [ -x /usr/bin/python3 ] && PY=/usr/bin/python3
[ -z "$PY" ] && [ -x /usr/local/bin/python3 ] && PY=/usr/local/bin/python3

model=""
dir=""
remaining=""
sid=""
cost=""

if [ -n "$PY" ]; then
  parsed=$("$PY" -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    data = {}
model = (data.get("model") or {}).get("display_name") or ""
cur_dir = (data.get("workspace") or {}).get("current_dir") or ""
remaining = (data.get("context_window") or {}).get("remaining_percentage")
remaining = "" if remaining is None else remaining
sid = (data.get("session_id") or "")[:8]
cost = (data.get("cost") or {}).get("total_cost_usd")
cost = "" if cost is None else ("<$0.01" if 0 < cost < 0.005 else f"${cost:.2f}")
print(model)
print(cur_dir)
print(remaining)
print(sid)
print(cost)
' <<<"$input" 2>/dev/null)
  model=$(sed -n '1p' <<<"$parsed")
  dir=$(sed -n '2p' <<<"$parsed")
  remaining=$(sed -n '3p' <<<"$parsed")
  sid=$(sed -n '4p' <<<"$parsed")
  cost=$(sed -n '5p' <<<"$parsed")
fi

# Graceful degradation: no python3 (or parse failure) → fall back to plain cwd.
if [ -z "$dir" ]; then
  dir="$PWD"
fi

# Keep the real path for git and workspace detection; `~` is only for display
# (git -C '~/...' does not resolve — the shell expands `~`, an argument does not).
raw_dir="$dir"
dir="${dir/#$HOME/~}"

branch=""
if git -C "$raw_dir" --no-optional-locks rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch=$(git -C "$raw_dir" --no-optional-locks branch --show-current 2>/dev/null)
fi

# --- hub link ---------------------------------------------------------------
# Working inside the obot workspace → the live session ops hub (the session-hub
# live view); anywhere else → the deployed obot roadmap hub. Emitted as an OSC 8
# terminal hyperlink: Claude Code decides whether the terminal supports those and
# drops the escape (keeping the label) when it does not, so this script does not
# second-guess it. See README.md for the terminal-support notes.
#
#   OBOT_STATUSLINE_LINK=auto   OSC 8 hyperlink on the label (default)
#   OBOT_STATUSLINE_LINK=text   print the bare URL instead — copy/paste friendly
#   OBOT_STATUSLINE_LINK=off    drop the segment entirely
OBOT_WORKSPACE="${OBOT_WORKSPACE:-$HOME/Documents/obot2}"
OBOT_HUB_URL="${OBOT_HUB_URL:-https://jwildfire.github.io/obot.roadmap/}"
OPS_HUB_FILE="$OBOT_WORKSPACE/.claude/session-hub/live.html"

link_mode="${OBOT_STATUSLINE_LINK:-auto}"
link_url=""
link_label=""

if [ "$link_mode" != "off" ]; then
  lower_dir=$(printf '%s' "$raw_dir" | tr '[:upper:]' '[:lower:]')
  lower_ws=$(printf '%s' "$OBOT_WORKSPACE" | tr '[:upper:]' '[:lower:]')
  lower_ws="${lower_ws%/}"

  # In-workspace (the macOS filesystem is case-insensitive, so compare lowercased)
  # and the live view actually rendered → ops hub; otherwise the deployed hub.
  if { [ "$lower_dir" = "$lower_ws" ] || [ "${lower_dir#"$lower_ws"/}" != "$lower_dir" ]; } \
     && [ -f "$OPS_HUB_FILE" ]; then
    link_url="file://$OPS_HUB_FILE"
    link_label="ops hub"
  else
    link_url="$OBOT_HUB_URL"
    link_label="obot hub"
  fi
fi

# Dimmed ANSI colors (terminal renders the statusline dimmed already)
COLOR_SID='\033[2;35m'    # dim magenta
COLOR_MODEL='\033[2;36m'  # dim cyan
COLOR_DIR='\033[2;34m'    # dim blue
COLOR_GIT='\033[2;32m'    # dim green
COLOR_CTX='\033[2;33m'    # dim yellow
COLOR_COST='\033[2;31m'   # dim red
COLOR_LINK='\033[2;36m'   # dim cyan
RESET='\033[0m'

if [ -n "$model" ]; then
  line="${COLOR_MODEL}${model}${RESET} ${COLOR_DIR}${dir}${RESET}"
else
  line="${COLOR_DIR}${dir}${RESET}"
fi

if [ -n "$sid" ]; then
  line="${COLOR_SID}[${sid}]${RESET} ${line}"
fi

if [ -n "$branch" ]; then
  line="${line} ${COLOR_GIT}(${branch})${RESET}"
fi

if [ -n "$remaining" ]; then
  line="${line} ${COLOR_CTX}${remaining}% left${RESET}"
fi

if [ -n "$cost" ]; then
  line="${line} ${COLOR_COST}${cost}${RESET}"
fi

if [ -n "$link_url" ]; then
  if [ "$link_mode" = "text" ]; then
    line="${line} ${COLOR_LINK}${link_url}${RESET}"
  else
    # OSC 8, BEL-terminated — the form Claude Code documents and emits itself.
    line="${line} ${COLOR_LINK}\033]8;;${link_url}\a↗ ${link_label}\033]8;;\a${RESET}"
  fi
fi

printf "%b\n" "$line"
