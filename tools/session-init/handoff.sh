#!/usr/bin/env bash
# handoff.sh — emit the session-init Tier-0 hand-off bundle in one tolerant pass.
#
# The single source of truth for the init read. Every source is optional, every
# failure is silent, and the script always exits 0: a zero-match grep must never
# cost the lead a model round trip (the 2026-08-04 acceptance run lost a full
# round trip — and the <1 min SLA — to a grep exiting 1 inside an `&&` chain).
#
# Invoked two ways:
#   - by commands/s-init.md as `!` preprocessing → the bundle arrives WITH the
#     prompt and the first paint needs zero tool calls (the only route to
#     hub#91's <10s first-paint bar);
#   - by skills/session-init/SKILL.md step 1 as the one batched read when the
#     skill is reached without preprocessing (long-form /session-init).
#
# Output: ===-delimited sections parsed in one pass. Source ages are precomputed
# so the freshness header needs no arithmetic. The two newest scratchpads are
# both emitted because a wrapup has left "see YYYY-MM-DD.md" pointers before
# (2026-08-02 → 2026-08-01); the pair kills the pointer chase.

set -u
WS="${OBOT_WORKSPACE:-$PWD}"
now_s=$(date +%s)

age() { # age <path> → "NNm" or "cold"
  [ -e "${1:-}" ] || { echo "cold"; return; }
  local m
  m=$(stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null) || { echo "cold"; return; }
  echo "$(( (now_s - m) / 60 ))m"
}

section() { # section <file> <start-regex> — print from heading to next H2
  awk -v start="$2" '$0 ~ start {f=1} f && /^## / && $0 !~ start {exit} f' "$1" 2>/dev/null
}

echo "=== HANDOFF (preprocessed $(date '+%Y-%m-%d %H:%M')) ==="

echo "=== SCRATCHPAD ==="
n=0
for p in $(ls -t "$WS"/.claude/session-notes/2*.md 2>/dev/null | head -2); do
  [ "$n" -gt 0 ] && echo "--- previous scratchpad (pointer-chase guard) ---"
  echo "file: $p (age: $(age "$p"))"
  section "$p" '^## Overview'
  grep '^- \[ \]' "$p" 2>/dev/null | head -20
  n=$((n + 1))
done

echo "=== DIARY ==="
for d in "$WS/obot.roadmap/diary" "$WS/../obot.roadmap/diary"; do
  [ -d "$d" ] || continue
  latest=$(ls -t "$d"/2*.md 2>/dev/null | head -1)
  [ -n "$latest" ] || continue
  echo "file: $latest (age: $(age "$latest"))"
  section "$latest" '^## Next session: loose ends'
  section "$latest" '^## 🙋 ToDo'
  break
done

echo "=== MEMORY ==="
mem=$(ls "$HOME"/.claude/projects/*obot2/memory/next-session-todo.md 2>/dev/null | head -1)
if [ -n "${mem:-}" ]; then
  echo "file: $mem (age: $(age "$mem"))"
  cat "$mem" 2>/dev/null
fi

echo "=== SWEEP CACHE ==="
cache="$WS/.claude/session-hub/cache/gh-sweep.json"
echo "cache age: $(age "$cache")"
cat "$cache" 2>/dev/null; echo

echo "=== NOW ==="
date '+%Y-%m-%d %H:%M'
exit 0
