---
description: "Run this session as 🚦🤖 obot-admiral — the short-lived triggered actor that moves finished work which has stopped moving, then exits."
argument-hint: "The path to the brief JSON written by scripts/obot-admiral"
allowed-tools: Bash(cat *)
---

## Your brief — the conditions that launched you (pre-read)

!`cat "$1" 2>/dev/null || echo '{"error":"no brief passed — refuse to act: your conditions are unknown, and acting without them would make you a standing session with no trigger"}'`

@.claude/skills/admiral/SKILL.md
