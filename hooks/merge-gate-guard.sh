#!/usr/bin/env python3
# merge-gate-guard.sh — PreToolUse guard (matcher: Bash) for the obot2 workspace.
#
# Denies raw PR-merge commands so the only mechanical merge lane is the wrapper
#   obot.agent/scripts/obot-merge   (branch policy + obotclaw[bot] auth + verify).
# The wrapper's own invocation string contains no denied pattern, so it defers here
# and is admitted by its narrow allow rule in .claude/settings.json.
#
# Denied patterns (anywhere in the command, including env-var/compound prefixes):
#   - raw `gh pr merge`                        (CLI merge)
#   - `pulls/<n>/merge` REST endpoint          (gh api / curl PR merge)
#   - `repos/<owner>/<repo>/merges` endpoint   (branch-merge REST endpoint)
#   - `mergePullRequest` / `mergeBranch`       (GraphQL mutations)
# Mentions wrapped in backticks or quotes (prose, scratchpad notes) are ignored.
#
# Everything else: exit 0 with no output = defer to normal permission evaluation.
# Parse failures also defer — this guard must never block unrelated work.

import json
import re
import sys

try:
    payload = json.load(sys.stdin)
    command = payload.get("tool_input", {}).get("command", "") or ""
except Exception:
    sys.exit(0)  # defer

PATTERNS = [
    (r"""(?<!["'`\w./-])gh\s+pr\s+merge\b""", "raw `gh pr merge`"),
    (r"""(?<!["'`])\bpulls/\d+/merge\b""", "REST PR-merge endpoint"),
    (r"""(?<!["'`])\brepos/[^\s"'`]+/merges\b""", "REST branch-merge endpoint"),
    (r"""(?<!["'`])\bmerge(PullRequest|Branch)\b""", "GraphQL merge mutation"),
]

for pattern, label in PATTERNS:
    if re.search(pattern, command):
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    f"merge-gate-guard: {label} is blocked in this workspace. "
                    "Merges go through obot.agent/scripts/obot-merge, which enforces the "
                    "base-branch policy and merges as obotclaw[bot]. Jeremy's explicit "
                    "approval is still required before any merge (operating contract)."
                ),
            }
        }))
        sys.exit(0)

sys.exit(0)  # defer
