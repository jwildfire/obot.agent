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

# The age of a file that CAME FROM A CLONE, which mtime cannot answer: every file in a
# fresh clone was written the moment it was cloned, so on a new machine a three-day-old
# diary entry reads as minutes old — and the age is printed precisely so a session knows
# when not to trust what is under it (jwildfire/obot.roadmap#223). A dated day-file
# carries the answer in its own name, so that is what is used; anything else falls back
# to mtime, and where the two disagree the OLDER one wins, because a hand-off that
# understates staleness is the failure and one that overstates it is a nuisance.
dated_age() { # dated_age <path> → "NNm" / "NNd" / "cold"
  local f base y md secs by_name by_mtime
  f="${1:-}"
  [ -e "$f" ] || { echo "cold"; return; }
  by_mtime=$(age "$f")
  base=$(basename "$f" .md)
  case "$base" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*)
      y=${base%%-*}; md=${base#*-}
      secs=$(date -j -f '%Y-%m-%d' "$y-${md%%-*}-$(echo "$md" | cut -d- -f2)" '+%s' 2>/dev/null \
             || date -d "$y-${md%%-*}-$(echo "$md" | cut -d- -f2)" '+%s' 2>/dev/null) || { echo "$by_mtime"; return; }
      by_name=$(( (now_s - secs) / 60 ))
      [ "$by_name" -lt 0 ] && by_name=0
      case "$by_mtime" in
        cold) ;;
        *m) [ "${by_mtime%m}" -gt "$by_name" ] && by_name=${by_mtime%m} ;;
      esac
      if [ "$by_name" -ge 1440 ]; then echo "$(( by_name / 1440 ))d"; else echo "${by_name}m"; fi
      ;;
    *) echo "$by_mtime" ;;
  esac
}

section() { # section <file> <start-regex> — print from heading to next H2
  awk -v start="$2" '$0 ~ start {f=1} f && /^## / && $0 !~ start {exit} f' "$1" 2>/dev/null
}

echo "=== HANDOFF (preprocessed $(date '+%Y-%m-%d %H:%M')) ==="

echo "=== SCRATCHPAD ==="
n=0
for p in $(ls -t "$WS"/.claude/session-notes/2*.md 2>/dev/null | grep -v -- '-init-delta' | head -2); do
  [ "$n" -gt 0 ] && echo "--- previous scratchpad (pointer-chase guard) ---"
  echo "file: $p (age: $(age "$p"))"
  section "$p" '^## Overview'
  grep '^- \[ \]' "$p" 2>/dev/null | head -20
  n=$((n + 1))
done
# A heading with nothing under it reads as "there was nothing worth noting". On a new
# machine the scratchpad is simply not there — it is local-only and no clone brings it.
[ "$n" -gt 0 ] || echo "no session scratchpad on this machine yet at $WS/.claude/session-notes/ — it is local-only and does not travel between machines; the first session-note or sibling heartbeat writes one."

echo "=== DIARY ==="
found_diary=0
for d in "$WS/obot.roadmap/diary" "$WS/../obot.roadmap/diary"; do
  [ -d "$d" ] || continue
  latest=$(ls -t "$d"/2*.md 2>/dev/null | head -1)
  [ -n "$latest" ] || continue
  found_diary=1
  echo "file: $latest (age: $(dated_age "$latest"))"
  section "$latest" '^## 🚦 Release candidates'
  section "$latest" '^## 🧭 Decisions needed'
  section "$latest" '^## Next session: loose ends'
  section "$latest" '^## 🙋 ToDo'
  break
done
[ "$found_diary" -eq 1 ] || echo "no diary entry readable on this machine yet — the hub clone carries them at obot.roadmap/diary/; clone it, or the last wrapup has not written one."

echo "=== MEMORY ==="
mem=$(ls "$HOME"/.claude/projects/*obot2/memory/next-session-todo.md 2>/dev/null | head -1)
if [ -n "${mem:-}" ]; then
  echo "file: $mem (age: $(age "$mem"))"
  cat "$mem" 2>/dev/null
else
  echo "no next-session memory on this machine yet at $HOME/.claude/projects/*obot2/memory/ — memory is per-machine and no clone brings it; the next wrapup writes one."
fi

echo "=== SWEEP CACHE ==="
cache="$WS/.claude/session-hub/cache/gh-sweep.json"
echo "cache age: $(age "$cache")"
cat "$cache" 2>/dev/null; echo

echo "=== NOW ==="
date '+%Y-%m-%d %H:%M'
exit 0
